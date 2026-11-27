// Runefall Arena — app entry: screens, match flow, game loop, rooms/parties and network glue.
//
// Modes:  duel     — 1v1 vs an AI (offline)
//         bots2v2  — you + ally bot vs Zigi & Jöggu (offline)
//         bg       — the 5v5 flag battleground (Thornwater Gorge): you + 4 bots vs 5 bots (offline)
//         host     — you host a room (1v1, 2v2 or the 5v5 battleground; empty slots can be bots); authoritative sim
//         guest    — you joined a room; inputs go to the host, state comes back as snapshots
import { World } from './render/world.js';
import { loadHeroAssets, preloadChampions } from './render/heroes.js';
import { HUD, iconHTML, emblemStyle } from './ui/hud.js';
import { Input, DEFAULT_BINDS, RESERVED_KEYS, keyLabel } from './input.js';
import { Audio, AB_SOUND, HIT_SOUND, CAST_SOUND } from './audio.js';
import { Sim, moveFighter, RULES, rangeDist, segBlocked, angleTo, angleDiff, FACE_ARC, meleeBonus, airborne, MOVE_ABS, aimPick, assistPick, MELEE_AIM_WIDTH, MELEE_AUTO_RANGE } from './sim/sim.js';
import { AI } from './sim/ai.js';
import { useMap } from './sim/sim.js';
import { FlagSim, FLAG_RULES, POWERUPS } from './sim/flag.js';
import { FlagAI } from './sim/flagai.js';
import { THORNWATER } from './sim/maps/thornwater.js';
import { Net } from './net.js';
import { ARENAS } from './render/arenas.js';
import { CLASSES, CLASS_ORDER, BOT_NAMES, kit, kitOf, specsOf, validSpec } from './data/classes.js';
import { tuningOf } from './data/tuning.js';

const $ = id => document.getElementById(id);
const STEP = 1 / 60;
const rand = a => a[Math.floor(Math.random() * a.length)];

// ------------------------------------------------------------------ settings
const DEFAULTS = { music: 55, sfx: 80, sens: 100, invert: false, quality: 'high', fps: false, arena: 'runefall', binds: DEFAULT_BINDS, mouseover: true };
let settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('runefall-settings') || '{}') };
if (!Array.isArray(settings.binds) || settings.binds.length !== 6) settings.binds = DEFAULT_BINDS;
settings.binds = settings.binds.map(l => (Array.isArray(l) ? l : []).filter(c => typeof c === 'string').slice(0, 2));
function saveSettings() { localStorage.setItem('runefall-settings', JSON.stringify(settings)); applySettings(); }

// ------------------------------------------------------------------ core objects
const canvas = $('scene');
let world;
try { world = new World(canvas); }
catch (e) { $('loadmsg').textContent = 'WebGL could not start in this browser: ' + e.message; throw e; }

// Arena picker on the main menu. The choice is saved in the settings.
function buildArenaPicker() {
  const row = $('arenaPick'); if (!row || !world) return;
  for (const a of ARENAS) {
    if (a.battleground) continue; // battleground maps belong to their mode
    const b = document.createElement('button');
    b.className = 'chip' + (world.arenaId === a.id ? ' on' : ''); b.textContent = a.name; b.dataset.arena = a.id;
    b.addEventListener('click', () => {
      settings.arena = a.id; saveSettings(); world.setArena(a.id);
      row.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.arena === a.id));
    });
    row.appendChild(b);
  }
}
buildArenaPicker();
const hud = new HUD();
const input = new Input(canvas);
const audio = new Audio();

const S = {
  screen: 'splash', mode: null, sim: null, ais: new Map(), net: null, myId: 0,
  myCls: localStorage.getItem('runefall-class') || 'mage', difficulty: localStorage.getItem('runefall-diff') || 'normal',
  playerName: localStorage.getItem('runefall-name') || ('Champion' + Math.floor(100 + Math.random() * 900)),
  // bot opponents / allies picked on the champion screen ('random' = rolled at the start of every match); remembered
  ...(() => {
    const d = { team: { duel: 'random', ally: 'random', foe1: 'random', foe2: 'random' }, teamSpec: { duel: 'random', ally: 'random', foe1: 'random', foe2: 'random' } };
    try { const s = JSON.parse(localStorage.getItem('runefall-bots')) || {}; for (const k of Object.keys(d.team)) { if (s.team?.[k] === 'random' || CLASSES[s.team?.[k]]) d.team[k] = s.team[k]; if (typeof s.teamSpec?.[k] === 'string') d.teamSpec[k] = s.teamSpec[k]; } } catch {}
    return d;
  })(),
  mySpecs: (() => { try { return JSON.parse(localStorage.getItem('runefall-specs')) || {}; } catch { return {}; } })(), // chosen spec per class
  csMode: 'duel', inGame: false, paused: false, acc: 0, roster: null,
  room: null, roomView: null, mySlot: 0, queueing: false,
  // guest-side
  local: null, snaps: [], lastSnap: null, lastSnapT: 0, ack: 0, lastForceYaw: -1, sendT: 0,
  // host-side
  remotes: new Map(), cidToFid: new Map(), snapT: 0,
  lastCount: null, lastWinner: -1, endTimer: null, lastFrame: performance.now(),
};

function applySettings() {
  audio.setVolumes(settings.music / 100, settings.sfx / 100);
  input.sens = settings.sens / 100; input.invert = settings.invert;
  input.setBinds(settings.binds); hud.setBinds(settings.binds);
  if (world.quality !== settings.quality) world.setQuality(settings.quality);
  $('fps').classList.toggle('hidden', !settings.fps);
}
applySettings();

// ------------------------------------------------------------------ screens & transitions
function show(id) {
  S.screen = id;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  menuShift();
}
// the main menu's sidebar: the 3D scene is centred in the space beside it
function menuShift() { const side = $('menu').querySelector('.side'); world.menuShift = S.screen === 'menu' && innerWidth > 800 && side ? side.offsetWidth : 0; }
addEventListener('resize', menuShift);
function showOverlay(id, v) { $(id).classList.toggle('active', v); }
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); }
// fade to black, run fn, fade back in
function transition(fn) {
  const f = $('fade'); f.classList.add('on');
  setTimeout(() => { try { fn(); } finally { setTimeout(() => f.classList.remove('on'), 60); } }, 330);
}

document.addEventListener('click', e => { if (e.target.closest('button')) audio.play('ui_click'); });
document.addEventListener('mouseover', e => { const b = e.target.closest('button, .cs-card'); if (b && b !== S._hov) { S._hov = b; audio.play('ui_hover'); } });

// name
$('playerName').value = S.playerName;
$('playerName').addEventListener('input', e => { S.playerName = e.target.value.trim().slice(0, 16) || 'Champion'; localStorage.setItem('runefall-name', S.playerName); });

// win/loss record (kept locally)
const REC = JSON.parse(localStorage.getItem('runefall-record') || '{"w":0,"l":0,"streak":0,"best":0}');
function renderRecord() {
  $('record').innerHTML = `<span class="w"><b>${REC.w}</b> W</span><span class="l"><b>${REC.l}</b> L</span>${REC.streak > 1 ? `<span class="hot"><b>${REC.streak}</b> in a row</span>` : ''}${REC.best > Math.max(1, REC.streak) ? `<span><b>${REC.best}</b> best</span>` : ''}`;
}
function recordResult(won) {
  if (won) { REC.w++; REC.streak++; REC.best = Math.max(REC.best, REC.streak); } else { REC.l++; REC.streak = 0; }
  localStorage.setItem('runefall-record', JSON.stringify(REC)); renderRecord();
}
renderRecord();

// splash
const joinParam = new URLSearchParams(location.search).get('join');
if (joinParam) $('loadmsg').textContent = `You have been invited to a match (room ${joinParam.toUpperCase()}).`;
// champion + world assets load behind the splash screen
let assetsReady = false;
const inviteMsg = $('loadmsg').textContent;
$('splash').querySelector('.enter').style.visibility = 'hidden';
loadHeroAssets(p => { if (!assetsReady) $('loadmsg').textContent = `Summoning the champions… ${Math.round(p * 100)}%`; })
  .catch(e => console.warn('Champion assets failed to load, using fallback models', e))
  .then(() => world.arena.ready)
  .catch(() => {})
  .finally(() => {
    assetsReady = true;
    preloadChampions([S.myCls + ':' + mySpec()]).catch(() => {});
    world.showMenuScene();
    $('loadmsg').textContent = inviteMsg;
    $('splash').querySelector('.enter').style.visibility = '';
  });
$('splash').addEventListener('click', () => {
  if (!assetsReady) return;
  audio.init(); applySettings(); audio.setTrack('menu');
  if (joinParam) { show('join'); $('joinCode').value = joinParam.toUpperCase(); startJoin(joinParam); }
  else show('menu');
});

// main menu
$('menu').addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
  if (act === 'duel') openClassSelect('duel');
  else if (act === 'bots2v2') openClassSelect('bots2v2');
  else if (act === 'bg') openClassSelect('bg');
  else if (act === 'create') startHost();
  else if (act === 'join') { show('join'); $('joinStatus').textContent = ''; $('joinCode').focus(); }
  else if (act === 'browse') openClassSelect('browse');
  else if (act === 'settings') openSettings('menu');
  else if (act === 'howto') { S.howtoBack = 'menu'; show('howto'); }
});

// the corner panel describes the highlighted menu entry (mouse or keyboard focus)
function showModeInfo(b) {
  if (!b || !b.dataset.title) return;
  $('menu').querySelectorAll('.mi').forEach(x => x.classList.toggle('hl', x === b));
  const box = $('modeInfo');
  box.querySelector('.mf-t').innerHTML = b.dataset.title + (b.dataset.new ? ' <i>New</i>' : '');
  box.querySelector('.mf-d').innerHTML = b.dataset.desc;
  box.querySelector('.mf-f').innerHTML = (b.dataset.facts || '').split('|').filter(Boolean).map(f => `<span>${f}</span>`).join('');
  box.style.setProperty('--hide', b.dataset.facts === '' ? 'none' : 'flex');
  box.classList.remove('in'); void box.offsetWidth; box.classList.add('in');
}
$('menu').addEventListener('mouseover', e => { const b = e.target.closest('.mi'); if (b && !b.classList.contains('hl')) showModeInfo(b); });
$('menu').addEventListener('focusin', e => showModeInfo(e.target.closest('.mi')));
showModeInfo($('menu').querySelector('.mi'));

// settings
function openSettings(back) {
  S.settingsBack = back;
  $('setMusic').value = settings.music; $('setSfx').value = settings.sfx; $('setSens').value = settings.sens;
  $('setInvert').checked = settings.invert; $('setQuality').value = settings.quality; $('setFps').checked = settings.fps; $('setMouseover').checked = settings.mouseover;
  renderBinds();
  if (back === 'pause') showOverlay('pause', false);
  show('settings');
}
// ability key rows: two keys per slot; click one, then press the new key (or a mouse button)
function renderBinds() {
  const rows = $('bindRows'); if (!rows) return;
  input.capture = null;
  rows.innerHTML = settings.binds.map((codes, i) => `<div class="bind-row"><span>Ability ${i + 1}</span>${[0, 1].map(k =>
    `<button class="bind-key${codes[k] ? '' : ' empty'}" data-i="${i}" data-k="${k}" title="${codes[k] || 'not bound'}">${codes[k] ? keyLabel(codes[k]) : '—'}</button>`).join('')}</div>`).join('');
  rows.querySelectorAll('.bind-key').forEach(b => {
    const i = +b.dataset.i, k = +b.dataset.k;
    b.addEventListener('click', e => {
      e.stopPropagation();
      rows.querySelectorAll('.bind-key.wait').forEach(x => x.classList.remove('wait'));
      b.classList.add('wait'); b.textContent = 'Press…';
      input.capture = code => {
        if (code === 'Escape') { renderBinds(); return; }
        if (RESERVED_KEYS.has(code)) { toast(`${keyLabel(code)} is already used for movement or targeting`); renderBinds(); return; }
        // a key can only do one thing: take it away from any other slot first
        settings.binds = settings.binds.map(l => l.filter(c => c !== code));
        const l = settings.binds[i]; l[k] = code; settings.binds[i] = l.filter(Boolean);
        saveSettings(); renderBinds();
      };
    });
    b.addEventListener('contextmenu', e => { e.preventDefault(); settings.binds[i] = settings.binds[i].filter((_, j) => j !== k); saveSettings(); renderBinds(); });
  });
}
$('bindsReset').addEventListener('click', () => { settings.binds = DEFAULT_BINDS.map(l => [...l]); saveSettings(); renderBinds(); });
for (const [id, key, conv] of [['setMusic', 'music', Number], ['setSfx', 'sfx', Number], ['setSens', 'sens', Number], ['setQuality', 'quality', String]]) $(id).addEventListener('input', e => { settings[key] = conv(e.target.value); saveSettings(); });
$('setInvert').addEventListener('change', e => { settings.invert = e.target.checked; saveSettings(); });
$('setFps').addEventListener('change', e => { settings.fps = e.target.checked; saveSettings(); });
$('setMouseover').addEventListener('change', e => { settings.mouseover = e.target.checked; saveSettings(); });
$('settingsBack').addEventListener('click', () => { input.capture = null; if (S.settingsBack === 'pause') { show(null); showOverlay('pause', true); } else show(S.settingsBack || 'menu'); });
$('howtoBack').addEventListener('click', () => { if (S.howtoBack === 'pause') { show(null); showOverlay('pause', true); } else show('menu'); });

// ------------------------------------------------------------------ class selection
function openClassSelect(mode) {
  S.csMode = mode;
  show('classSelect');
  $('csTitle').textContent = { browse: 'The Champions', room: 'Choose Your Champion', duel: 'Duel — Choose Your Champion', bots2v2: '2v2 — Choose Your Champion', bg: 'Thornwater Gorge — Choose Your Champion' }[mode];
  const vsBots = mode === 'duel' || mode === 'bots2v2' || mode === 'bg';
  $('csDifficulty').classList.toggle('hidden', !vsBots);
  $('csTeam').classList.toggle('hidden', !vsBots);
  $('csConfirm').classList.toggle('hidden', mode === 'browse');
  $('csConfirm').textContent = mode === 'room' ? 'Confirm' : mode === 'bg' ? 'Enter the Gorge' : 'Enter the Arena';
  document.querySelectorAll('#csDifficulty .chip').forEach(c => c.classList.toggle('on', c.dataset.diff === S.difficulty));
  const list = $('csList'); list.innerHTML = '';
  for (const id of CLASS_ORDER) {
    const C = CLASSES[id];
    const el = document.createElement('div'); el.className = 'cs-card'; el.dataset.cls = id;
    el.innerHTML = `<div class="emblem" style="${emblemStyle(C)}">${C.emblem}</div><div><div class="cname" style="color:${C.color}">${C.name}</div><div class="crole">${C.role}</div></div>`;
    el.addEventListener('click', () => selectClass(id));
    list.appendChild(el);
  }
  if (vsBots) renderTeamPanel();
  selectClass(S.myCls);
}

// ---- specs: every class has two; the choice is remembered per class and locked for the match
const mySpec = () => validSpec(S.myCls, S.mySpecs[S.myCls]);
const playableSpecs = cls => specsOf(cls).filter(s => !s.soon);
// 'random' (or an unplayable id) -> a random playable spec of that class
const pickSpec = (cls, v) => playableSpecs(cls).some(s => s.id === v) ? v : rand(playableSpecs(cls)).id;
const specLabel = (cls, spec) => { const K = kit(cls, spec); return `${K.specIcon} ${K.specName} ${K.name}`; };
const specOptions = (cls, v, withRandom = true) => (withRandom ? `<option value="random"${v === 'random' ? ' selected' : ''}>Random spec</option>` : '') +
  playableSpecs(cls).map(s => `<option value="${s.id}"${v === s.id ? ' selected' : ''}>${s.icon} ${s.name}</option>`).join('');

const saveBots = () => localStorage.setItem('runefall-bots', JSON.stringify({ team: S.team, teamSpec: S.teamSpec }));
// a class for a bot: the chosen one, or (for 'random') any class not in `avoid` (falls back to any class)
const botClass = (v, avoid = []) => CLASSES[v] ? v : rand(CLASS_ORDER.filter(c => !avoid.includes(c)).length ? CLASS_ORDER.filter(c => !avoid.includes(c)) : CLASS_ORDER);

// a bot's class in a 5v5 team: random, but at most two of a class per team (design: FUTURE_BATTLEGROUNDS.md)
function bgClass(v, mates) {
  if (CLASSES[v]) return v;
  const n = c => mates.filter(m => m === c).length;
  const fresh = CLASS_ORDER.filter(c => n(c) === 0), ok = CLASS_ORDER.filter(c => n(c) < 2);
  return rand(fresh.length ? fresh : ok.length ? ok : CLASS_ORDER);
}
const BG_NAMES = [['Aldor', 'Brann', 'Selka', 'Tovi', 'Maelis'], ['Zigi', 'Jöggu', 'Rasko', 'Vendra', 'Ilk', 'Grummar']];
function bgRoster() {
  const roster = [{ cls: S.myCls, spec: mySpec(), team: 0, name: S.playerName }];
  for (const team of [0, 1]) {
    const names = BG_NAMES[team].filter(n => n !== S.playerName);
    while (roster.filter(r => r.team === team).length < 5) {
      const mates = roster.filter(r => r.team === team).map(r => r.cls), cls = bgClass('random', mates);
      roster.push({ cls, spec: pickSpec(cls, 'random'), team, name: names.shift() || 'Bot', bot: true, diff: S.difficulty });
    }
  }
  return roster;
}

function renderTeamPanel() {
  const opts = v => `<option value="random"${v === 'random' ? ' selected' : ''}>🎲 Random</option>` + CLASS_ORDER.map(c => `<option value="${c}"${v === c ? ' selected' : ''}>${CLASSES[c].name}</option>`).join('');
  // a bot row: class picker + spec picker (spec picker only once a class is chosen)
  const row = (label, k) => `<div class="tm"><span>${label}</span><select data-k="${k}">${opts(S.team[k])}</select>${S.team[k] !== 'random' ? `<select data-ks="${k}">${specOptions(S.team[k], S.teamSpec[k])}</select>` : ''}</div>`;
  const me = `<div class="tm"><span>${esc(S.playerName)}</span><b style="color:${CLASSES[S.myCls].color}">${specLabel(S.myCls, mySpec())}</b></div>`;
  if (S.csMode === 'bg') {
    $('csTeam').innerHTML = `<div class="ally"><h4>Gold Team</h4>${me}<div class="tm"><span>+ 4 bots</span><b>🎲 random classes</b></div></div>
      <div class="foe"><h4>Crimson Team</h4><div class="tm"><span>5 bots</span><b>🎲 random classes</b></div></div>
      <div class="bg-rules muted">Capture the enemy flag 3 times · 15 minutes · respawn every 20 s · at most 2 of a class per team</div>`;
    return;
  }
  $('csTeam').innerHTML = S.csMode === 'duel'
    ? `<div class="ally"><h4>You</h4>${me}</div><div class="foe"><h4>Opponent</h4>${row('Bot', 'duel')}</div>`
    : `<div class="ally"><h4>Your Team</h4>${me}${row(`${BOT_NAMES.ally[0]} (bot)`, 'ally')}</div>
    <div class="foe"><h4>Enemy Team</h4>${row(BOT_NAMES.enemy[0], 'foe1')}${row(BOT_NAMES.enemy[1], 'foe2')}</div>`;
  $('csTeam').querySelectorAll('select[data-k]').forEach(s => s.addEventListener('change', () => { S.team[s.dataset.k] = s.value; S.teamSpec[s.dataset.k] = 'random'; saveBots(); renderTeamPanel(); }));
  $('csTeam').querySelectorAll('select[data-ks]').forEach(s => s.addEventListener('change', () => { S.teamSpec[s.dataset.ks] = s.value; saveBots(); }));
}

function selectSpec(cls, spec) {
  S.mySpecs[cls] = spec; localStorage.setItem('runefall-specs', JSON.stringify(S.mySpecs));
  selectClass(cls);
}

// the spec's arena tuning (data/tuning.js) as text: "1v1 −4 % · 2v2 +6 % damage and healing"
function tuneText(cls, spec) {
  const f = v => (Math.abs(v - 1) < 0.005 ? '±0 %' : (v > 1 ? '+' : '−') + Math.round(Math.abs(v - 1) * 100) + ' %');
  return `1v1 ${f(tuningOf('duel', cls, spec))} · 2v2 ${f(tuningOf('team', cls, spec))} damage and healing`;
}

function statRow(label, rating, value) {
  return `<div class="stat"><span>${label}</span><div class="track"><div style="width:${rating * 20}%"></div></div><span class="v">${value}</span></div>`;
}

function selectClass(id) {
  S.myCls = id; localStorage.setItem('runefall-class', id);
  document.querySelectorAll('.cs-card').forEach(c => c.classList.toggle('on', c.dataset.cls === id));
  const spec = mySpec(), C = kit(id, spec);
  world.showPreview(id, spec);
  const resName = { mana: 'Mana', energy: 'Energy', rage: 'Rage', focus: 'Focus' }[C.resType];
  const A = C.auto;
  // spec cards: pick one of the class's two specs (unbuilt ones are shown as "coming soon")
  const specCards = `<div class="spec-pick"><div class="sp-h">Choose a spec <span>locked for the match</span></div><div class="sp-cards">${specsOf(id).map(s => `
    <button class="spec-card${s.id === spec ? ' on' : ''}${s.soon ? ' soon' : ''}" data-spec="${s.id}"${s.soon ? ' disabled' : ''} style="--sc:${s.color}">
      <span class="si">${s.icon}</span><span class="sx"><span class="sn">${s.name}</span><span class="st">${s.tag}</span></span>${s.soon ? '<span class="sb">Coming soon</span>' : s.id === spec ? '<span class="sb on">Selected</span>' : ''}
    </button>`).join('')}</div></div>`;
  $('csDetails').innerHTML = `
    <h3 style="color:${C.color}">${C.name} <span class="spec-name" style="color:${C.specColor}">${C.specIcon} ${C.specName}</span></h3>
    <div class="role">${C.role}${C.race ? ` · <span class="race">Race: ${C.race}</span>` : ''}</div>
    ${specCards}
    <p>${C.desc}</p>
    <div class="gear"><b>Weapon:</b> ${C.weapon}<br><b>Armor:</b> ${C.armor}<br><b>Resource:</b> ${resName} (${C.res})<br><b title="A power factor on all damage and healing of this spec, found by the balance lab so every spec wins about half its fights in each format">Arena tuning:</b> ${tuneText(id, spec)}</div>
    ${statRow('Health', C.rating.health, C.hp)}
    ${statRow('Damage', C.rating.damage, ['', 'Low', 'Low-Med', 'Medium', 'Med-High', 'High'][C.rating.damage])}
    ${statRow('Mobility', C.rating.mobility, C.speed.toFixed(1))}
    ${statRow('Defense', C.rating.defense, Math.round(C.defense * 100) + '%')}
    <div class="abilities">
      <div class="ab-row" data-i="-1" style="cursor:pointer">${iconHTML(A)}
        <div><div class="aname" style="color:${A.color}">${A.name} <span class="key">LEFT CLICK</span></div>
        <div class="meta">${A.ranged ? A.range + ' yd' : 'Melee'} · ${A.speed}s attack speed · ${A.dmg} damage</div>
        <div class="adesc">${A.desc}</div></div></div>
      ${C.abilities.map((ab, i) => `
      <div class="ab-row" data-i="${i}" style="cursor:pointer">${iconHTML(ab)}
        <div><div class="aname" style="color:${ab.color}">${ab.name} <span class="key">KEY ${keyLabel(settings.binds[i]?.[0]) || '—'}</span></div>
        <div class="meta">${[ab.cost ? `${ab.cost} ${resName}` : 'No cost', ab.cast ? `${ab.cast}s cast` : 'Instant', ab.cd ? `${ab.cd}s cooldown` : '', ab.range ? `${ab.range} yd` : ''].filter(Boolean).join(' · ')}</div>
        <div class="adesc">${ab.desc}</div></div></div>`).join('')}
    </div>`;
  $('csDetails').querySelectorAll('.spec-card:not(.soon)').forEach(b => b.addEventListener('click', () => { if (b.dataset.spec !== spec) { selectSpec(id, b.dataset.spec); audio.play('ui_click'); } }));
  $('csDetails').querySelectorAll('.ab-row').forEach(r => r.addEventListener('click', () => {
    const i = +r.dataset.i;
    if (i < 0) { world.previewAttack(); audio.play(A.ranged ? 'auto_' + id : (id === 'rogue' ? 'dagger' : 'swing')); return; }
    const ab = C.abilities[i];
    world.previewAbility(ab);
    audio.play(AB_SOUND[ab.id]);
  }));
  if (S.csMode === 'bots2v2' || S.csMode === 'duel' || S.csMode === 'bg') renderTeamPanel();
}

document.querySelectorAll('#csDifficulty .chip').forEach(c => c.addEventListener('click', () => {
  S.difficulty = c.dataset.diff; localStorage.setItem('runefall-diff', S.difficulty);
  document.querySelectorAll('#csDifficulty .chip').forEach(x => x.classList.toggle('on', x === c));
}));

$('csBack').addEventListener('click', () => {
  if (S.csMode === 'room') { show('room'); renderRoom(); world.showMenuScene(); }
  else { world.showMenuScene(); show('menu'); }
});
$('csConfirm').addEventListener('click', () => {
  if (S.csMode === 'duel') {
    const foe = botClass(S.team.duel, [S.myCls]);
    startMatch([{ cls: S.myCls, spec: mySpec(), team: 0, name: S.playerName }, { cls: foe, spec: pickSpec(foe, S.team.duel === 'random' ? 'random' : S.teamSpec.duel), team: 1, name: rand(BOT_NAMES.enemy), bot: true, diff: S.difficulty }], 'duel', 0);
  } else if (S.csMode === 'bots2v2') {
    const ally = botClass(S.team.ally, [S.myCls]);
    const f1 = botClass(S.team.foe1, S.team.foe2 !== 'random' ? [S.team.foe2] : []);
    const f2 = botClass(S.team.foe2, [f1]);
    startMatch([
      { cls: S.myCls, spec: mySpec(), team: 0, name: S.playerName },
      { cls: ally, spec: pickSpec(ally, S.teamSpec.ally), team: 0, name: BOT_NAMES.ally[0], bot: true, diff: S.difficulty },
      { cls: f1, spec: pickSpec(f1, S.teamSpec.foe1), team: 1, name: BOT_NAMES.enemy[0], bot: true, diff: S.difficulty },
      { cls: f2, spec: pickSpec(f2, S.teamSpec.foe2), team: 1, name: BOT_NAMES.enemy[1], bot: true, diff: S.difficulty },
    ], 'bots2v2', 0);
  } else if (S.csMode === 'bg') {
    startMatch(bgRoster(), 'bg', 0, true);
  } else if (S.csMode === 'room') {
    if (S.net?.role === 'host') { const s = S.room.slots[S.mySlot]; s.cls = S.myCls; s.spec = mySpec(); s.ready = false; roomBroadcast(); }
    else if (S.net) { S.net.send({ t: 'pick', cls: S.myCls, spec: mySpec() }); S.net.send({ t: 'ready', v: false }); }
    world.showMenuScene(); show('room'); renderRoom();
  }
});

// ------------------------------------------------------------------ rooms (parties)
// A room always has 10 slots. 1v1 / 2v2: slots 0,1 = Gold, 2,3 = Crimson (1v1 uses 0 and 2).
// 5v5 battleground: slots 0–4 = Gold, 5–9 = Crimson.
const SLOT_TEAM = [0, 0, 1, 1];
const slotTeam = (room, i) => (room.format === '5v5' ? (i < 5 ? 0 : 1) : SLOT_TEAM[i] ?? 1);
const activeSlots = room => room.format === '1v1' ? [0, 2] : room.format === '5v5' ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] : [0, 1, 2, 3];
const TEAM_CAP = { '1v1': 1, '2v2': 2, '5v5': 5 };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const emptySlots = () => Array.from({ length: 10 }, () => ({ kind: 'empty' }));

function newRoom() {
  const slots = emptySlots(); slots[0] = { kind: 'human', name: S.playerName, cls: S.myCls, spec: mySpec(), ready: false, cid: 'host' };
  return { format: '2v2', botDiff: 'normal', slots };
}
// lay a room out for another format: each team keeps its players (humans first, then bots) up to the new size;
// players who no longer fit are told why
function relayoutRoom(room, fmt) {
  const teams = [[], []];
  for (const i of activeSlots(room)) { const s = room.slots[i]; if (s.kind !== 'empty') teams[slotTeam(room, i)].push(s); }
  const cap = TEAM_CAP[fmt], slots = emptySlots();
  room.format = fmt;
  const order = activeSlots(room);
  for (const t of [0, 1]) {
    const list = teams[t].sort((a, b) => (b.cid === 'host') - (a.cid === 'host') || (b.kind === 'human') - (a.kind === 'human'));
    const free = order.filter(i => slotTeam(room, i) === t);
    list.forEach((s, k) => {
      if (k < cap) slots[free[k]] = s;
      else if (s.kind === 'human') { S.net.sendTo(s.cid, { t: 'kicked', msg: `The lobby switched to ${fmt} and is full.` }); S.net.kick(s.cid); }
    });
  }
  room.slots = slots;
  S.mySlot = slots.findIndex(s => s.cid === 'host');
}
function botFor(i) {
  const enemy = slotTeam(S.room, i) === 1;
  const used = S.room.slots.filter(s => s.kind === 'bot').map(s => s.name);
  const names = S.room.format === '5v5' ? [...BG_NAMES[enemy ? 1 : 0], ...BG_NAMES[enemy ? 0 : 1]] : enemy ? BOT_NAMES.enemy : [...BOT_NAMES.ally, ...BOT_NAMES.enemy];
  const name = names.find(n => !used.includes(n)) || (enemy ? 'Zigi' : 'Aldor');
  // new bots are a surprise: class and spec are rolled when the match starts (the host can pick one instead)
  return { kind: 'bot', name, cls: 'random', spec: 'random', ready: true };
}
// lobby label + emblem for a slot whose class may still be 'random'
const RANDOM_C = { name: 'Random', color: '#c8b98a', emblem: '?' };
const slotC = s => CLASSES[s.cls] || RANDOM_C;
const slotLabel = s => !CLASSES[s.cls] ? '🎲 Random champion' : s.spec === 'random' ? `🎲 Random ${CLASSES[s.cls].name}` : specLabel(s.cls, s.spec);

function startHost() {
  closeNet();
  S.room = newRoom(); S.mySlot = 0; S.queueing = false;
  const net = S.net = new Net();
  bindNet(net);
  net.role = 'host'; net.maxGuests = 9; // a 5v5 battleground room: the host + 9 guests (smaller formats turn extra guests away in onGuestHello)
  show('room'); renderRoom();
  $('roomStatus').textContent = 'Opening the arena gates…';
  net.host(code => { $('roomCode').textContent = code; renderRoom(); });
}

function roomLink() { const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('join', S.net?.code || ''); return url.toString(); }
$('copyLink').addEventListener('click', () => { navigator.clipboard?.writeText(roomLink()).then(() => toast('Invite link copied!'), () => toast(roomLink(), 6000)); });

function publicRoom() { return { format: S.room.format, botDiff: S.room.botDiff, slots: S.room.slots.map(s => ({ kind: s.kind, name: s.name, cls: s.cls, spec: s.spec, ready: s.ready, host: s.cid === 'host' })) }; }
function roomBroadcast() {
  if (!S.net || S.net.role !== 'host' || S.inGame) return; // a 'room' message sends guests back to the lobby
  const pub = publicRoom();
  S.room.slots.forEach((s, i) => { if (s.kind === 'human' && s.cid !== 'host') S.net.sendTo(s.cid, { t: 'room', room: pub, you: i, code: S.net.code }); });
  if (S.screen === 'room') renderRoom();
}

function renderRoom() {
  const isHost = S.net?.role === 'host';
  const room = isHost ? publicRoom() : S.roomView;
  if (!room) return;
  $('roomCode').textContent = S.net?.code || '······';
  $('roomTitle').textContent = room.format === '5v5' ? '5v5 Battleground — Thornwater Gorge' : room.format === '2v2' ? '2v2 Party Lobby' : '1v1 Duel Lobby';
  $('room').classList.toggle('bg5', room.format === '5v5');
  document.querySelectorAll('#roomFormat .chip').forEach(c => { c.classList.toggle('on', c.dataset.format === room.format); c.disabled = !isHost; });
  const act = activeSlots(room);
  const card = i => {
    const s = room.slots[i], me = i === S.mySlot;
    if (s.kind === 'empty') return `<div class="slot-card empty" data-i="${i}">Open slot ${isHost ? `<span class="sbtns"><button class="btn small" data-act="bot" data-i="${i}">+ Bot</button></span>` : ''}</div>`;
    const C = slotC(s);
    const ctrl = isHost ? (s.kind === 'bot'
      ? `<select data-act="botcls" data-i="${i}"><option value="random"${CLASSES[s.cls] ? '' : ' selected'}>🎲 Random</option>${CLASS_ORDER.map(c => `<option value="${c}"${c === s.cls ? ' selected' : ''}>${CLASSES[c].name}</option>`).join('')}</select>${CLASSES[s.cls] ? `<select data-act="botspec" data-i="${i}">${specOptions(s.cls, s.spec === 'random' ? 'random' : validSpec(s.cls, s.spec))}</select>` : ''}<button class="btn small" data-act="kick" data-i="${i}" title="Remove bot">✕</button>`
      : `<button class="btn small" data-act="swap" data-i="${i}" title="Move to the other team">⇄</button>${s.host ? '' : `<button class="btn small" data-act="kick" data-i="${i}" title="Kick">✕</button>`}`) : '';
    return `<div class="slot-card ${me ? 'me' : ''}"><div class="emblem" style="${emblemStyle(C)}">${C.emblem}</div>
      <div class="sinfo"><div class="sname">${esc(s.name)}${s.host ? ' <span class="muted">♛</span>' : ''}${me ? ' <span class="muted">(you)</span>' : ''}</div><div class="ssub" style="color:${C.color}">${slotLabel(s)}${s.kind === 'bot' ? ' · Bot' : ''}</div></div>
      <span class="sready ${s.ready ? 'ok' : 'no'}">${s.kind === 'bot' ? 'BOT' : s.ready ? '✔ READY' : 'NOT READY'}</span><span class="sbtns">${ctrl}</span></div>`;
  };
  $('slotsA').innerHTML = act.filter(i => slotTeam(room, i) === 0).map(card).join('');
  $('slotsB').innerHTML = act.filter(i => slotTeam(room, i) === 1).map(card).join('');
  $('room').querySelector('.room-actions').classList.toggle('guest', !isHost);
  const mine = room.slots[S.mySlot];
  // everyone (host included) readies up; the host then starts the match
  $('roomReady').classList.remove('hidden');
  $('roomReady').textContent = mine?.ready ? 'Cancel Ready' : 'Ready';
  $('roomReady').classList.toggle('on', !!mine?.ready);
  const waiting = act.map(i => room.slots[i]).filter(s => s.kind === 'human' && !s.ready).map(s => s.name);
  const open = act.filter(i => room.slots[i].kind === 'empty').length;
  if (!S.queueing) $('roomStatus').textContent = open ? `${open} open slot${open > 1 ? 's' : ''} — invite a friend${isHost ? ' or add a bot' : ''}.`
    : waiting.length ? `Waiting for ${waiting.join(', ')} to press Ready.`
    : isHost ? 'Everyone is ready — press Start Match!' : 'Everyone is ready — waiting for the host to start.';
  if (isHost) {
    const teamBHumans = [2, 3].some(i => room.slots[i].kind === 'human');
    $('roomQueue').classList.toggle('gone', room.format !== '2v2' || teamBHumans);
    $('roomQueue').textContent = S.queueing ? 'Cancel Search' : 'Find Opponents';
    $('roomQueue').classList.toggle('searching', S.queueing);
    $('roomBotDiff').value = room.botDiff;
    $('roomStart').disabled = !canStart();
  }
}

function canStart() {
  if (!S.room) return false;
  return activeSlots(S.room).every(i => S.room.slots[i].kind !== 'empty' && (S.room.slots[i].kind === 'bot' || S.room.slots[i].ready));
}

$('roomFormat').addEventListener('click', e => {
  const f = e.target.closest('[data-format]')?.dataset.format; if (!f || S.net?.role !== 'host' || f === S.room.format) return;
  if (f === '1v1') {
    // 1v1: the host plus the first other player, on opposite sides; anyone beyond two can't fit and is told why
    const humans = activeSlots(S.room).map(i => S.room.slots[i]).filter(s => s.kind === 'human').sort((a, b) => (b.cid === 'host') - (a.cid === 'host'));
    const bots = activeSlots(S.room).map(i => S.room.slots[i]).filter(s => s.kind === 'bot');
    for (const s of humans.slice(2)) { S.net.sendTo(s.cid, { t: 'kicked', msg: 'The lobby switched to 1v1 and is full.' }); S.net.kick(s.cid); }
    const slots = emptySlots();
    slots[0] = humans[0] || bots.shift() || { kind: 'empty' };
    slots[2] = humans[1] || bots.find(b => BOT_NAMES.enemy.includes(b.name)) || bots[0] || { kind: 'empty' };
    S.room.format = f; S.room.slots = slots;
    S.mySlot = slots.findIndex(s => s.cid === 'host');
  } else relayoutRoom(S.room, f);
  stopQueue();
  roomBroadcast();
});
$('room').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || S.net?.role !== 'host' || b.tagName === 'SELECT') return;
  const i = +b.dataset.i, s = S.room.slots[i];
  if (b.dataset.act === 'bot') S.room.slots[i] = botFor(i);
  else if (b.dataset.act === 'kick') {
    if (s.kind === 'human' && s.cid !== 'host') { S.net.sendTo(s.cid, { t: 'kicked', msg: 'You were removed from the lobby.' }); S.net.kick(s.cid); }
    S.room.slots[i] = { kind: 'empty' };
  } else if (b.dataset.act === 'swap') {
    const other = activeSlots(S.room).filter(j => slotTeam(S.room, j) !== slotTeam(S.room, i));
    const j = other.find(j => S.room.slots[j].kind !== 'human') ?? other[0];
    [S.room.slots[i], S.room.slots[j]] = [S.room.slots[j], S.room.slots[i]];
    if (S.room.slots[j].cid === 'host') S.mySlot = j; else if (S.room.slots[i].cid === 'host') S.mySlot = i;
  }
  roomBroadcast();
});
$('room').addEventListener('change', e => {
  if (S.net?.role !== 'host') return;
  const sel = e.target.closest('[data-act="botcls"]'), ssel = e.target.closest('[data-act="botspec"]');
  if (sel) { const sl = S.room.slots[+sel.dataset.i]; sl.cls = CLASSES[sel.value] ? sel.value : 'random'; sl.spec = 'random'; roomBroadcast(); }
  else if (ssel) { const sl = S.room.slots[+ssel.dataset.i]; sl.spec = ssel.value === 'random' ? 'random' : validSpec(sl.cls, ssel.value); roomBroadcast(); }
});
$('roomBotDiff').addEventListener('change', e => { if (S.room) { S.room.botDiff = e.target.value; roomBroadcast(); } });
$('roomFill').addEventListener('click', () => { for (const i of activeSlots(S.room)) if (S.room.slots[i].kind === 'empty') S.room.slots[i] = botFor(i); roomBroadcast(); });
$('roomClass').addEventListener('click', () => openClassSelect('room'));
$('roomReady').addEventListener('click', () => {
  if (S.net?.role === 'host') { const s = S.room.slots[S.mySlot]; if (s) { s.ready = !s.ready; roomBroadcast(); } return; }
  if (!S.net || !S.roomView) return; const v = !S.roomView.slots[S.mySlot]?.ready; S.net.send({ t: 'ready', v });
});
$('roomLeave').addEventListener('click', () => leaveOnline());
$('roomStart').addEventListener('click', () => { if (canStart()) startOnline(); });
$('roomQueue').addEventListener('click', () => { if (S.queueing) stopQueue(); else startQueue(); });

// ---- matchmaking
function startQueue() {
  const net = S.net; if (!net || net.role !== 'host' || !net.code) return;
  // the opposing slots will be taken by the other party
  for (const i of [2, 3]) if (S.room.slots[i].kind === 'bot') S.room.slots[i] = { kind: 'empty' };
  S.queueing = true; roomBroadcast();
  net.startQueue(net.code, {
    onStatus: m => { $('roomStatus').textContent = m; },
    onWaiting: () => { $('roomStatus').textContent = 'In queue — waiting for another party to search…'; },
    onHosting: () => { S.queueing = false; $('roomStatus').textContent = 'Opponents found! They are joining your arena…'; roomBroadcast(); audio.play('round_win'); },
    onFound: code => {
      // move our whole party into the waiting party's room as the Crimson team
      S.queueing = false;
      toast('Opponents found! Joining their arena…');
      net.send({ t: 'goto', code });
      setTimeout(() => { closeNet(); startJoin(code, 1); }, 400);
    },
  });
}
function stopQueue() { if (S.net) S.net.stopQueue(); if (S.queueing) { S.queueing = false; roomBroadcast(); $('roomStatus').textContent = 'Search cancelled.'; } }

// ---- joining
function startJoin(code, wantTeam = 0) {
  code = (code || '').trim().toUpperCase();
  if (code.length < 4) { $('joinStatus').textContent = 'Enter a valid room code.'; return; }
  closeNet();
  $('joinStatus').textContent = 'Connecting to the arena…';
  const net = S.net = new Net();
  bindNet(net);
  net.join(code, () => {
    $('joinStatus').textContent = 'Connected!';
    net.send({ t: 'hello', name: S.playerName, cls: S.myCls, spec: mySpec(), want: wantTeam });
  });
}
$('joinGo').addEventListener('click', () => startJoin($('joinCode').value));
$('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') startJoin($('joinCode').value); });
$('joinBack').addEventListener('click', () => { closeNet(); show('menu'); });

function bindNet(net) {
  net.on('error', type => {
    if (S.net !== net) return;
    const msg = { 'peer-unavailable': 'Room not found. Check the code and make sure the host is still in the lobby.', timeout: 'Could not reach that room (timed out).', network: 'Network error — check your connection.', 'browser-incompatible': 'Your browser does not support WebRTC.' }[type] || `Connection error (${type}).`;
    if (S.screen === 'join') $('joinStatus').textContent = msg;
    else if (S.screen === 'room') $('roomStatus').textContent = msg;
    else if (!S.inGame) toast(msg);
  });
  net.on('full', () => { if (S.screen === 'join') $('joinStatus').textContent = 'That match is already full.'; else toast('That arena is full.'); if (S.net === net) { closeNet(); show('menu'); } });
  net.on('kicked', m => { if (S.net === net) leaveOnline(m.msg || 'You left the lobby.', true); });
  net.on('disconnected', (_, cid) => {
    if (S.net !== net) return;
    if (net.role === 'guest') { if (!S.moving) leaveOnline('The host closed the arena.'); return; }
    onGuestLeft(cid);
  });
  // ---- host side
  net.on('hello', (m, cid) => { if (net.role === 'host') onGuestHello(cid, m); });
  net.on('pick', (m, cid) => { const s = slotOf(cid); if (s && CLASSES[m.cls]) { s.cls = m.cls; s.spec = validSpec(m.cls, m.spec); s.ready = false; roomBroadcast(); } });
  net.on('ready', (m, cid) => { const s = slotOf(cid); if (s) { s.ready = !!m.v; roomBroadcast(); } });
  net.on('in', (m, cid) => { const r = remoteOf(cid); if (r) r.remote = m; });
  net.on('ab', (m, cid) => {
    const r = remoteOf(cid); if (!r) return;
    // a mouseover heal names its ally; only accept it for an ally spell, so a hostile ability can't be redirected
    const fid = S.cidToFid.get(cid), ab = S.sim && kitOf(S.sim.fighters[fid])?.abilities[m.i];
    r.abs.push(Number.isInteger(m.tid) && ab?.ally ? { i: m.i, dir: m.dir, tid: m.tid } : { i: m.i, dir: m.dir });
  });
  net.on('tg', (m, cid) => { const r = remoteOf(cid); if (r) r.targetReq = true; });
  net.on('atk', (m, cid) => { const r = remoteOf(cid); if (r) { r.attack = true; if (m.tid >= 0) r.setTarget = m.tid; } });
  net.on('drop', (m, cid) => { const r = remoteOf(cid); if (r) r.drop = true; }); // battleground: drop the flag (G)
  net.on('sel', (m, cid) => { const r = remoteOf(cid); if (r) { if (m.tid !== undefined) r.setTarget = m.tid; if (m.fid !== undefined) r.setFriend = m.fid; } });
  // ---- guest side
  net.on('room', m => {
    if (net.role !== 'guest') return;
    S.roomView = m.room; S.mySlot = m.you;
    if (S.inGame) { endGame(); world.showMenuScene(); audio.setTrack('menu'); }
    if (S.screen !== 'room' && S.screen !== 'classSelect') show('room');
    if (S.screen === 'room') renderRoom();
  });
  net.on('start', m => { if (net.role === 'guest') transition(() => startMatch(m.roster, 'guest', m.you, !!m.bg)); });
  net.on('snap', m => onSnapshot(m.s));
  net.on('ev', m => { if (S.inGame && S.mode === 'guest') handleEvents(m.l, buildGuestView()); });
  net.on('goto', m => { if (net.role === 'guest') { S.moving = true; toast('Your party found opponents — moving to their arena…'); setTimeout(() => { S.moving = false; closeNet(); startJoin(m.code, 1); }, 900); } });
  net.on('leave', () => { if (net.role === 'guest') leaveOnline('The host closed the arena.'); });
}

function slotOf(cid) { return S.room?.slots.find(s => s.kind === 'human' && s.cid === cid) || null; }
function remoteOf(cid) { const fid = S.cidToFid.get(cid); return fid !== undefined ? S.remotes.get(fid) : null; }

function onGuestHello(cid, m) {
  if (S.inGame) { S.net.sendTo(cid, { t: 'full' }); return; }
  const room = S.room, want = m.want === 1 ? 1 : 0;
  const act = activeSlots(room);
  const order = [...act.filter(i => slotTeam(room, i) === want), ...act.filter(i => slotTeam(room, i) !== want)];
  const i = order.find(j => room.slots[j].kind === 'empty') ?? order.find(j => room.slots[j].kind === 'bot');
  if (i === undefined) { S.net.sendTo(cid, { t: 'full' }); setTimeout(() => S.net?.kick(cid), 300); return; }
  const cls = CLASSES[m.cls] ? m.cls : 'warrior';
  room.slots[i] = { kind: 'human', name: String(m.name || 'Champion').slice(0, 16), cls, spec: validSpec(cls, m.spec), ready: false, cid };
  $('roomStatus').textContent = `${room.slots[i].name} joined the lobby.`;
  audio.play('round_win');
  roomBroadcast();
}

function onGuestLeft(cid) {
  const room = S.room; if (!room) return;
  const i = room.slots.findIndex(s => s.kind === 'human' && s.cid === cid);
  if (i < 0) return;
  const name = room.slots[i].name;
  if (S.inGame) {
    // keep the match going: a bot takes over the departed player's champion
    const fid = S.cidToFid.get(cid);
    if (fid !== undefined && S.sim) { S.remotes.delete(fid); S.ais.set(fid, S.bg ? new FlagAI(S.sim, fid, room.botDiff) : new AI(S.sim, fid, room.botDiff)); S.sim.fighters[fid].bot = true; }
    S.cidToFid.delete(cid);
    room.slots[i] = { kind: 'bot', name: name, cls: room.slots[i].cls, spec: room.slots[i].spec, ready: true };
    toast(`${name} left — a bot takes over their champion.`, 3500);
  } else {
    room.slots[i] = { kind: 'empty' };
    $('roomStatus').textContent = `${name} left the lobby.`;
  }
  roomBroadcast();
}

function startOnline() {
  stopQueue();
  const room = S.room, act = activeSlots(room), bg = room.format === '5v5';
  const roster = [], owners = [];
  for (const i of act) {
    const s = room.slots[i];
    // random bots are rolled now (a fresh roll every match), avoiding classes already on their team
    const mates = act.filter(j => j !== i && slotTeam(room, j) === slotTeam(room, i)).map(j => roster[act.indexOf(j)]?.cls || room.slots[j].cls);
    const cls = bg ? bgClass(s.cls, mates) : botClass(s.cls, mates), spec = s.spec === 'random' ? pickSpec(cls, 'random') : validSpec(cls, s.spec);
    roster.push({ cls, spec, team: slotTeam(room, i), name: s.name, bot: s.kind === 'bot', diff: room.botDiff });
    owners.push(s.kind === 'human' ? s.cid : null);
  }
  const myFid = owners.indexOf('host');
  S.cidToFid = new Map();
  owners.forEach((cid, fid) => { if (cid && cid !== 'host') { S.cidToFid.set(cid, fid); S.net.sendTo(cid, { t: 'start', roster, you: fid, bg }); } });
  for (const s of room.slots) if (s.kind === 'human') s.ready = false; // everyone readies again next time
  transition(() => startMatch(roster, 'host', myFid, bg));
}

function backToLobby() {
  // host only: everybody returns to the room screen
  endGame();
  world.showMenuScene(); audio.setTrack('menu');
  show('room'); roomBroadcast(); renderRoom();
  $('roomStatus').textContent = 'Back in the lobby. Ready up for the next match!';
}

function closeNet() { if (S.net) { S.net.close(); S.net = null; } S.queueing = false; }
function leaveOnline(msg, quiet) {
  if (S.net && !quiet) S.net.send({ t: 'leave' });
  closeNet();
  endGame();
  world.showMenuScene();
  show('menu');
  audio.setTrack('menu');
  if (msg) toast(msg, 3500);
}

// ------------------------------------------------------------------ match lifecycle
function startMatch(roster, mode, myId, bg = false) {
  clearTimeout(S.endTimer);
  S.mode = mode; S.bg = bg; S.inGame = true; S.paused = false; S.acc = 0; S.prev = null;
  S.bgWasDead = false; S.lastRespawnN = null;
  // the battleground has its own map; every other mode plays in the arena picked on the main menu
  world.setArena(bg ? 'thornwater' : menuArena());
  useMap(bg ? THORNWATER : null); // guests: their own movement prediction collides with the map too (a host's FlagSim sets it itself)
  if (bg) THORNWATER.gatesOpen = false;
  S.roster = roster; S.myId = myId;
  S.lastCount = null; S.lastWinner = -1;
  S.snaps = []; S.lastSnap = null; S.ack = 0; S.lastForceYaw = -1; S.pred = newPred();
  S.ais = new Map(); S.remotes = new Map(); S.pend = null;
  const me = roster[myId];
  if (mode === 'guest') {
    S.sim = null;
    const sp = startSpot(roster, myId, bg);
    S.local = { id: myId, cls: me.cls, spec: validSpec(me.cls, me.spec), team: me.team, x: sp.x, y: sp.y, z: sp.z, vy: 0, yaw: sp.yaw, stamina: 100, buffs: [], alive: true, locked: false, moving: false };
  } else {
    S.sim = bg ? new FlagSim(roster) : new Sim(roster);
    roster.forEach((r, fid) => {
      if (fid === myId) return;
      if (r.bot || offlineMode(mode)) S.ais.set(fid, bg ? new FlagAI(S.sim, fid, r.diff || S.difficulty) : new AI(S.sim, fid, r.diff || S.difficulty));
      else S.remotes.set(fid, { remote: null, abs: [], targetReq: false, attack: false });
    });
    if (S.local === null || mode !== 'guest') S.local = null;
  }
  world.setFighters(roster, myId);
  const v = currentView();
  hud.setBg(bg ? { caps: FLAG_RULES.caps } : null);
  hud.setup(v.fighters, myId);
  hud.show(true); hud.clearAnnounce();
  show(null); showOverlay('pause', false); showOverlay('matchEnd', false);
  const sp = startSpot(roster, myId, bg);
  input.enabled = true; input.yaw = sp.yaw; input.pitch = 0.3; input.keys.clear();
  world.camPos.set(sp.x - Math.sin(sp.yaw) * 9, sp.y + 5, sp.z - Math.cos(sp.yaw) * 9);
  $('bgHint').classList.toggle('hidden', !bg);
  audio.setTrack('arena');
  input.requestLock();
  $('lockHint').classList.add('hidden');
}

// the arena picked on the main menu (never a battleground map)
const menuArena = () => (ARENAS.some(a => a.id === settings.arena && !a.battleground) ? settings.arena : 'runefall');
// where my champion starts (the camera starts behind it): the arena's two sides, or my team's great hall
function startSpot(roster, myId, bg) {
  const me = roster[myId];
  if (!bg) return { x: 0, y: 0, z: me.team === 0 ? -20 : 20, yaw: me.team === 0 ? 0 : Math.PI };
  const p = THORNWATER.prep.find(q => q.team === me.team), mates = roster.filter(r => r.team === me.team), k = mates.indexOf(me);
  return { x: p.x, y: 0, z: p.z + (k - (mates.length - 1) / 2) * 2.6, yaw: p.yaw };
}

function endGame() {
  if (S.bg) { useMap(null); S.bg = false; world.setArena(menuArena()); hud.setBg(null); $('bgHint').classList.add('hidden'); $('bgBoard').classList.add('hidden'); $('bgRespawn').classList.add('hidden'); }
  S.inGame = false; S.sim = null; S.ais = new Map(); S.local = null; S.remotes = new Map();
  input.enabled = false; input.exitLock(); canvas.style.cursor = '';
  hud.show(false);
  showOverlay('pause', false); showOverlay('matchEnd', false);
  $('spectate').classList.add('hidden');
  clearTimeout(S.endTimer);
}

input.onUnlock = () => {
  if (!S.inGame || S.screen === 'settings' || S.screen === 'howto' || $('matchEnd').classList.contains('active')) return;
  openPause();
};
input.onEscape = () => {
  if (!S.inGame || input.locked) return; // when locked, the browser releases the lock and onUnlock fires
  if ($('pause').classList.contains('active')) { showOverlay('pause', false); S.paused = false; }
  else if (!$('matchEnd').classList.contains('active')) openPause();
};
input.onFallback = () => toast('Mouse capture is not possible here: the cursor aims, hold the right mouse button and drag to look around.', 6000);
const offlineMode = m => m === 'duel' || m === 'bots2v2' || m === 'bg';
const offline = () => offlineMode(S.mode);
function openPause() {
  if (offline()) S.paused = true;
  $('pauseNote').textContent = offline() ? 'The match is paused.' : 'Online match — the fight continues while this menu is open!';
  showOverlay('pause', true);
}
$('pauseResume').addEventListener('click', () => { showOverlay('pause', false); S.paused = false; input.requestLock(); });
$('pauseSettings').addEventListener('click', () => openSettings('pause'));
$('pauseHowto').addEventListener('click', () => { S.howtoBack = 'pause'; showOverlay('pause', false); show('howto'); });
$('pauseLeave').addEventListener('click', () => {
  if (offline()) transition(() => { endGame(); world.showMenuScene(); show('menu'); audio.setTrack('menu'); });
  else leaveOnline();
});
canvas.addEventListener('click', () => { if (S.inGame && !input.active && !$('pause').classList.contains('active') && !$('matchEnd').classList.contains('active')) input.requestLock(); });

function showMatchEnd(winner) {
  if (S.bg) { showBgEnd(winner); return; }
  const v = currentView();
  const F = v.fighters, me = F[S.myId];
  const won = winner === me.team;
  input.exitLock();
  showOverlay('pause', false);
  const t = $('endTitle'); t.textContent = won ? 'Victory' : 'Defeat'; t.classList.toggle('defeat', !won);
  $('endScore').textContent = `${v.score[me.team]} – ${v.score[1 - me.team]}`;
  const st = f => f.stats || { dmg: 0, heal: 0, absorbed: 0, ccs: 0, interrupts: 0, crits: 0, kills: 0 };
  const mvp = F.reduce((b, f) => (st(f).dmg + st(f).heal > st(b).dmg + st(b).heal ? f : b), F[0]);
  const rows = [...F].sort((a, b) => a.team - b.team).map(f => { const s = st(f); return `<tr class="t${f.team === me.team ? 0 : 1} ${f.id === S.myId ? 'me' : ''}"><td>${esc(f.name)} <span class="muted">${specLabel(f.cls, f.spec)}</span>${f.id === mvp.id ? '<span class="mvp">★ MVP</span>' : ''}</td><td>${s.dmg}</td><td>${s.heal}</td><td>${s.absorbed}</td><td>${s.kills}</td><td>${s.ccs}</td><td>${s.interrupts}</td><td>${s.crits}</td></tr>`; }).join('');
  $('endStats').innerHTML = `<table class="end-stats"><tr><th>Champion</th><th>Damage</th><th>Healing</th><th>Absorbed</th><th>Kills</th><th>CC</th><th>Interrupts</th><th>Crits</th></tr>${rows}</table>`;
  $('endStatus').textContent = S.mode === 'guest' ? 'Waiting for the host to start a rematch or return to the lobby…' : '';
  recordResult(won);
  if (won && REC.streak > 1) $('endStatus').textContent = `${REC.streak} victories in a row!` + ($('endStatus').textContent ? ' ' + $('endStatus').textContent : '');
  const host = S.mode === 'host', guest = S.mode === 'guest';
  $('endRematch').classList.toggle('hidden', guest);
  $('endClass').classList.toggle('hidden', guest);
  $('endClass').textContent = host ? 'Back to Lobby' : 'Change Class';
  $('endMenu').textContent = offline() ? 'Main Menu' : 'Leave';
  $('endRematch').disabled = false;
  showOverlay('matchEnd', true);
  audio.play(won ? 'victory' : 'defeat');
  audio.play('crowd', null, { big: true });
  setTimeout(() => { if ($('matchEnd').classList.contains('active')) audio.setTrack('menu'); }, 4500);
}
// battleground end screen: captures, returns, carrier kills and match points for all ten
function showBgEnd(winner) {
  const v = currentView(), F = v.fighters, me = F[S.myId];
  const won = winner === me.team, draw = winner < 0;
  input.exitLock(); showOverlay('pause', false);
  const t = $('endTitle'); t.textContent = draw ? 'Draw' : won ? 'Victory' : 'Defeat'; t.classList.toggle('defeat', !won && !draw);
  $('endScore').textContent = `${v.score[me.team]} – ${v.score[1 - me.team]}`;
  const st = f => f.stats || {};
  const pts = f => st(f).points ?? 0;
  const mvp = F.reduce((b, f) => (pts(f) > pts(b) ? f : b), F[0]);
  const rows = [...F].sort((a, b) => (a.team === me.team ? 0 : 1) - (b.team === me.team ? 0 : 1) || pts(b) - pts(a)).map(f => { const s = st(f);
    return `<tr class="t${f.team === me.team ? 0 : 1} ${f.id === S.myId ? 'me' : ''}"><td>${esc(f.name)} <span class="muted">${specLabel(f.cls, f.spec)}</span>${f.id === mvp.id ? '<span class="mvp">★ MVP</span>' : ''}</td><td>${s.caps || 0}</td><td>${s.returns || 0}</td><td>${s.fcKills || 0}</td><td>${s.kills || 0}</td><td>${s.dmg || 0}</td><td>${s.heal || 0}</td><td><b>${pts(f)}</b></td></tr>`; }).join('');
  $('endStats').innerHTML = `<table class="end-stats bg"><tr><th>Champion</th><th>Captures</th><th>Returns</th><th>Carrier kills</th><th>Kills</th><th>Damage</th><th>Healing</th><th>Points</th></tr>${rows}</table>`;
  $('endStatus').textContent = (S.mode === 'guest' ? 'Waiting for the host to start a rematch or return to the lobby… ' : '') + `You earned ${pts(me)} match points.`;
  if (!draw) recordResult(won);
  const host = S.mode === 'host', guest = S.mode === 'guest';
  $('endRematch').classList.toggle('hidden', guest);
  $('endClass').classList.toggle('hidden', guest);
  $('endClass').textContent = host ? 'Back to Lobby' : 'Change Class';
  $('endMenu').textContent = offline() ? 'Main Menu' : 'Leave';
  $('endRematch').disabled = false;
  showOverlay('matchEnd', true);
  audio.play(draw ? 'gong' : won ? 'victory' : 'defeat');
  audio.play('crowd', null, { big: true });
  setTimeout(() => { if ($('matchEnd').classList.contains('active')) audio.setTrack('menu'); }, 4500);
}
$('endRematch').addEventListener('click', () => {
  const roster = S.roster;
  if (S.mode === 'host') { // restart with the same lineup; departed players stay bots
    const humans = new Set(S.cidToFid.values());
    const r2 = roster.map((r, fid) => ({ ...r, bot: fid !== S.myId && !humans.has(fid) }));
    const bg = S.bg;
    S.cidToFid.forEach((fid, cid) => S.net.sendTo(cid, { t: 'start', roster: r2, you: fid, bg }));
    transition(() => startMatch(r2, 'host', S.myId, bg));
    return;
  }
  // offline battleground: a fresh roll of bot classes every match
  if (S.mode === 'bg') { transition(() => startMatch(bgRoster(), 'bg', 0, true)); return; }
  transition(() => startMatch(roster, S.mode, S.myId));
});
$('endClass').addEventListener('click', () => {
  if (S.mode === 'host') { backToLobby(); return; }
  transition(() => { const m = S.mode; endGame(); world.showMenuScene(); openClassSelect(m === 'bots2v2' || m === 'bg' ? m : 'duel'); audio.setTrack('menu'); });
});
$('endMenu').addEventListener('click', () => {
  if (offline()) transition(() => { endGame(); world.showMenuScene(); show('menu'); audio.setTrack('menu'); });
  else leaveOnline();
});

// ------------------------------------------------------------------ views
// The simulation advances in fixed 60 Hz steps, the screen refreshes whenever it likes (60 / 120 / 144 Hz,
// uneven frame times). Drawing the raw sim state makes everything move in visible 16 ms hops, so the view
// is drawn BETWEEN the last two sim states instead: positions are blended by how far the current frame is
// into the next step (S.acc / STEP). Teleports (blinks, round resets) are not blended.
const lerpPos = (o, p, a) => {
  if (!p) return o;
  const dx = o.x - p[0], dy = o.y - p[1], dz = o.z - p[2];
  if (!dx && !dy && !dz) return o;
  if (dx * dx + dy * dy + dz * dz > 2.25) return o; // moved > 1.5 in one step: a teleport, show it as one
  return { ...o, x: p[0] + dx * a, y: p[1] + dy * a, z: p[2] + dz * a };
};
function capturePrev(sim) {
  const P = S.prev || (S.prev = { f: [], p: new Map(), m: new Map() });
  sim.fighters.forEach((f, i) => { const a = P.f[i] || (P.f[i] = [0, 0, 0]); a[0] = f.x; a[1] = f.y; a[2] = f.z; });
  P.p.clear(); for (const p of sim.projectiles) P.p.set(p.id, [p.x, p.y, p.z]);
  P.m.clear(); for (const m of sim.minions) P.m.set(m.id, [m.x, m.y, m.z]);
}
function currentView(raw = false) {
  if (S.mode === 'guest') return buildGuestView();
  const sim = S.sim, P = raw ? null : S.prev, a = Math.max(0, Math.min(1, S.acc / STEP));
  return {
    fighters: P ? sim.fighters.map((f, i) => lerpPos(f, P.f[i], a)) : sim.fighters,
    projectiles: P ? sim.projectiles.map(p => lerpPos(p, P.p.get(p.id), a)) : sim.projectiles,
    minions: P ? sim.minions.map(m => lerpPos(m, P.m.get(m.id), a)) : sim.minions,
    zones: sim.zones, state: sim.state, stateT: sim.stateT, round: sim.round, score: sim.score, fightT: sim.fightT, damp: sim.damp, lastWinner: S.lastWinner,
    bg: sim.bgState ? sim.bgState() : null };
}

function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }

function dummyFighter(r, id) {
  const C = kit(r.cls, r.spec);
  return { id, cls: r.cls, spec: validSpec(r.cls, r.spec), team: r.team, name: r.name, x: 0, y: 0, z: r.team === 0 ? -20 : 20, yaw: r.team === 0 ? 0 : Math.PI, hp: C.hp, maxHp: C.hp, res: C.res, maxRes: C.res, resType: C.resType, cds: [0, 0, 0, 0, 0, 0], gcd: 0, cast: null, buffs: [], cp: 0, alive: true, stamina: 100, target: -1, friend: -1, autoT: 0, autoOn: false };
}

function buildGuestView() {
  const snaps = S.snaps, last = S.lastSnap, L = S.local;
  if (!last) {
    const fighters = S.roster.map((r, i) => i === S.myId ? { ...dummyFighter(r, i), ...L } : dummyFighter(r, i));
    return { fighters, projectiles: [], zones: [], state: 'countdown', stateT: S.bg ? FLAG_RULES.prep : 3, round: 1, score: [0, 0], fightT: 0, damp: 0, lastWinner: -1, bg: null };
  }
  // interpolate everyone else ~100ms in the past
  const rt = performance.now() - 100;
  let a = snaps[0], b = snaps[snaps.length - 1];
  for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].t <= rt && snaps[i + 1].t >= rt) { a = snaps[i]; b = snaps[i + 1]; break; }
  const u = b.t > a.t ? Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t))) : 1;
  const age = (performance.now() - S.lastSnapT) / 1000;
  const fighters = last.f.map((f, i) => {
    if (i === S.myId) return applyPred({ ...f, id: i, x: L.x, y: L.y, z: L.z, yaw: L.yaw, stamina: L.stamina, moving: L.moving }, age);
    const fa = a.s.f[i], fb = b.s.f[i];
    return { ...f, id: i, x: fa.x + (fb.x - fa.x) * u, y: fa.y + (fb.y - fa.y) * u, z: fa.z + (fb.z - fa.z) * u, yaw: lerpAngle(fa.yaw, fb.yaw, u) };
  });
  const pa = new Map(a.s.p.map(p => [p.id, p]));
  const projectiles = b.s.p.map(p => { const q = pa.get(p.id); return q ? { ...p, x: q.x + (p.x - q.x) * u, y: q.y + (p.y - q.y) * u, z: q.z + (p.z - q.z) * u } : p; });
  const zones = last.z.map(z => ({ ...z, t: Math.min(z.dur, z.t + age) }));
  const bg = last.bg ? { ...last.bg, tl: Math.max(0, last.bg.tl - (last.s === 'fight' ? age : 0)), rs: last.bg.rs.map(v => (v > 0 ? Math.max(0, v - age) : 0)) } : null;
  return { fighters, projectiles, zones, minions: last.m || [], state: last.s, stateT: last.st - age, round: last.r, score: last.sc, fightT: last.ft + (last.s === 'fight' ? age : 0), damp: last.dp, lastWinner: S.lastWinner, bg };
}

// ---- guest prediction. An online guest's ability press used to show nothing until the host's answer came back
// (one round trip). Now the press shows at once — GCD sweep, cooldown, cast bar + casting pose, the animation and
// sound of an instant — and the host's snapshots then confirm it (and take over) or, if the host refused or
// queued it, the prediction runs out after PRED_HOLD and the HUD shows the host's state again.
const PRED_HOLD = 450; // ms a prediction stands without the host confirming it
function newPred() { return { gcd: null, cds: new Map(), cast: null, anim: new Map(), castSnd: null }; }
function guestPredict(view, i, tid) {
  const me = view.fighters[S.myId], L = S.local, P = S.pred;
  if (!me || !L || !P || view.state !== 'fight' || !me.alive) return;
  const ab = kitOf(me).abilities[i]; if (!ab) return;
  const has = type => me.buffs.some(b => b.type === type);
  // the host's own checks, as far as the guest can see them; anything doubtful is left to the host
  if (ab.gcd && (me.gcd > 0.05 || me.cast)) return; // goes into the host's spell queue
  if (ab.charges ? (me.ch?.[i] ?? ab.charges) <= 0 : me.cds[i] > 0.05) return;
  if (ab.cost > me.res || (ab.needsCp && me.cp < 1) || ab.needsPet) return;
  if ((has('stun') || has('disorient')) && !ab.allowCC) return;
  if (has('silence') && ab.school !== 'phys') return;
  if (has('tempest') || (has('root') && MOVE_ABS.has(ab.id))) return;
  if (ab.cast > 0 && ((L.moving && !ab.moveCast) || airborne(L))) return; // the host holds it until you stop
  if (ab.target) {
    const t = view.fighters[me.target];
    if (!t || !t.alive || t.team === me.team || t.buffs.some(b => b.type === 'stealth')) return;
    const d = rangeDist(me, t);
    if (d > ab.range + 0.3 + (ab.melee ? meleeBonus(me, t) : 0) || (ab.minRange && d < ab.minRange)) return;
    if (!ab.melee && segBlocked(me.x, me.z, t.x, t.z, me.y + 1.5, t.y + 1.5)) return;
    if (ab.melee && Math.abs(angleDiff(me.yaw, angleTo(me, t))) > FACE_ARC) return;
  }
  if (ab.ally) {
    const a = view.fighters[tid ?? me.friend];
    if (a && a.alive && a.team === me.team && a.id !== me.id && (rangeDist(me, a) > ab.range + 0.3 || segBlocked(me.x, me.z, a.x, a.z, me.y + 1.5, a.y + 1.5))) return;
  }
  const now = performance.now();
  if (ab.gcd) P.gcd = { start: now, seen: false };
  if (ab.cast > 0) {
    const t = ab.target ? me.target : -1;
    P.cast = { idx: i, start: now, dur: ab.cast, tid: t };
    P.castSnd = { ab: ab.id, t: now };
    audio.play(CAST_SOUND[ab.school] || 'cast_arcane', { x: me.x, z: me.z });
    return;
  }
  if (!ab.charges && ab.cd > 0) P.cds.set(i, { start: now, cd: ab.cd, seen: false });
  P.anim.set(ab.id, now);
  world.onAbilityAnim(S.myId, ab.id);
  audio.play(AB_SOUND[ab.id], { x: me.x, z: me.z });
  hud.flashSlot(i);
}
// my fighter in the guest view, with the predictions laid over the last snapshot
function applyPred(o, age) {
  const P = S.pred, now = performance.now();
  if (o.cast) o.cast = { ...o.cast, t: Math.min(o.cast.dur, o.cast.t + age) }; // the host's cast, advanced to now
  if (!P) return o;
  if (P.gcd) {
    const el = now - P.gcd.start;
    if ((!P.gcd.seen && el > PRED_HOLD) || el > RULES.gcd * 1000) P.gcd = null;
    else o.gcd = Math.max(o.gcd, RULES.gcd - el / 1000);
  }
  if (P.cds.size) {
    o.cds = o.cds.slice();
    for (const [i, c] of P.cds) {
      const el = now - c.start;
      if (c.seen || el > PRED_HOLD) P.cds.delete(i); else o.cds[i] = Math.max(o.cds[i], c.cd - el / 1000);
    }
  }
  if (P.cast) {
    const el = now - P.cast.start;
    if (el > PRED_HOLD && !o.cast) { P.cast = null; $('castA')._had = false; } // refused / held by the host: the bar just goes away (no "done" flash)
    else if (!o.cast) o.cast = { idx: P.cast.idx, t: Math.min(P.cast.dur, el / 1000), dur: P.cast.dur, tid: P.cast.tid };
  }
  return o;
}

function onSnapshot(s) {
  if (!S.inGame || S.mode !== 'guest') return;
  const now = performance.now();
  // a lite snapshot carries no statistics: keep the last ones
  if (S.lastSnap) s.f.forEach((f, i) => { if (!f.stats) f.stats = S.lastSnap.f[i]?.stats; });
  S.snaps.push({ t: now, s }); if (S.snaps.length > 12) S.snaps.shift();
  S.lastSnap = s; S.lastSnapT = now;
  if (s.bg) THORNWATER.gatesOpen = !!s.bg.gates; // the guest's own collision: the keep gates are walls until they open
  const me = s.f[S.myId], L = S.local;
  if (!me || !L) return;
  // the host has caught up with a prediction: from here on its state is shown
  const P = S.pred;
  if (P) {
    if (P.gcd && me.gcd > 0.05) P.gcd.seen = true;
    for (const [i, c] of P.cds) if (me.cds[i] > 0.05) c.seen = true;
    if (P.cast && me.cast && me.cast.idx === P.cast.idx) P.cast = null;
  }
  L.buffs = me.buffs; L.alive = me.alive; L.locked = me.locked; L.cast = me.cast; L.form = me.form; // cast: moving casts slow you; form: druid shape
  // server-forced movement (blinks, charges, round resets) overrides our prediction
  if (me.forceSeq !== S.ack || me.locked) {
    L.x = me.x; L.y = me.y; L.z = me.z; L.vy = 0;
    if (!me.locked) S.ack = me.forceSeq;
  }
  if (me.forceYaw !== S.lastForceYaw) { S.lastForceYaw = me.forceYaw; L.yaw = me.yaw; input.yaw = me.yaw; }
}

// ------------------------------------------------------------------ events → feedback
// abilities whose damage is a weapon blow (melee impact sound, hit-stop); basic melee swings carry ev.melee
const MELEE_HIT_ABS = new Set(['viper_strike', 'rending_blow', 'crippling_slash', 'gutting_edge', 'steel_tempest', 'skull_crack', 'shield_slam', 'rending_axes', 'headtaker', 'skull_leap',
  'skullsplitter', 'ground_breaker', 'envenom', 'crippling_poison', 'execute', 'bladestorm', 'stormstrike', 'lava_lash', 'holy_strike', 'pal_shield_slam', 'rake', 'shred', 'ferocious_bite', 'maul', 'thrash', 'wild_pounce', 'bull_rush']);
function handleEvents(evs, view) {
  const F = view.fighters, my = S.myId, me = F[my];
  const myTeam = me ? me.team : 0;
  const ctx = { fighters: F, chars: world.chars, focus: id => world.chars[id] ? world.chars[id].focusWorld() : { x: F[id].x, y: 1.5, z: F[id].z, clone() { return this; } } };
  const pos = id => F[id] ? { x: F[id].x, z: F[id].z } : null;
  for (const ev of evs) {
    world.vfx.onEvent(ev, ctx);
    switch (ev.e) {
      case 'ab': {
        // guest: an instant we already showed when the key went down (guestPredict) doesn't play twice
        const shown = ev.id === my && S.pred?.anim.get(ev.ab) > performance.now() - 1000;
        if (shown) S.pred.anim.delete(ev.ab);
        if (!shown) { world.onAbilityAnim(ev.id, ev.ab); audio.play(AB_SOUND[ev.ab], pos(ev.id)); }
        if (ev.id === my) { if (!shown) { const i = kitOf(F[my]).abilities.findIndex(a => a.id === ev.ab); hud.flashSlot(i); } }
        // callout when an enemy pops a big cooldown (30 s+ or its signature ability)
        else if (me && F[ev.id] && F[ev.id].team !== myTeam) {
          const ab = kitOf(F[ev.id]).abilities.find(a => a && a.id === ev.ab);
          // battleground: only enemies near you or the one you are fighting (ten champions would flood the line)
          const near = !S.bg || me.target === ev.id || Math.hypot(F[ev.id].x - me.x, F[ev.id].z - me.z) < 25;
          if (ab && near && (ab.cd >= 30 || ab.signature)) hud.callout(F[ev.id].name, ab.name, ab.color);
        }
        if (ev.ab === 'glacial_nova' || ev.ab === 'blinding_light' || ev.ab === 'halo_judgment') world.addShake(0.25);
        break; }
      case 'caststart': {
        const ab = kitOf(F[ev.id]).abilities.find(a => a.id === ev.ab);
        const P = S.pred, shown = ev.id === my && P?.castSnd && P.castSnd.ab === ev.ab && P.castSnd.t > performance.now() - 1000;
        if (shown) P.castSnd = null; else audio.play(CAST_SOUND[ab?.school] || 'cast_arcane', pos(ev.id));
        break; }
      case 'auto': {
        world.onAuto(ev.id, ev.hit); // ev.hit: s until the melee blow lands (the swing animation is lined up with it)
        const c = F[ev.id].cls;
        audio.play(ev.ranged ? 'auto_' + c : c === 'rogue' ? 'dagger' : 'swing', pos(ev.id));
        break; }
      case 'hit': audio.play(HIT_SOUND[ev.kind] || 'fire_hit', { x: ev.x, z: ev.z }); if (ev.kind === 'arcane_comet') world.addShake(ev.id === my ? 0.7 : 0.3); break;
      case 'fizzle': // a big projectile shattered on cover: tell both sides
        if (ev.blocked) { audio.play('immune', { x: ev.x, z: ev.z }); if (ev.id === my || ev.src === my) hud.floatText({ x: ev.x, y: ev.y + 0.6, z: ev.z }, ev.id === my ? 'Dodged!' : 'Blocked', ev.id === my ? '#9aff9a' : '#c8c8c8', ev.id === my ? 'big' : ''); }
        break;
      case 'dmg': {
        hud.combatText(ev, F, my);
        const meleeHit = ev.melee || MELEE_HIT_ABS.has(ev.ab); // ranged impacts get their sound from 'hit'
        if (meleeHit) audio.play(ev.crit || ev.big || ev.ab === 'rending_blow' ? 'melee_heavy' : 'melee_hit', pos(ev.id));
        if (ev.crit && (ev.src === my || ev.id === my)) audio.play('crit', pos(ev.id));
        const direct = !ev.dot && ev.amt > 0;
        if (direct) world.onHit(ev.id, ev.src, { crit: ev.crit, big: ev.big, melee: meleeHit, pet: ev.pet });
        if (ev.id === my && ev.amt >= 90) world.addShake(Math.min(0.6, ev.amt / 400));
        // my own blows: a confirming tick on the crosshair and a little weight on the camera
        if (ev.src === my && ev.id !== my && direct && !ev.pet) {
          hud.hitMarker(ev.crit || ev.big);
          world.addShake(ev.crit ? 0.16 : ev.big ? 0.12 : meleeHit ? 0.05 : 0);
        }
        if (ev.big || ev.crit) world.arena.crowdHype = Math.min(1, world.arena.crowdHype + 0.3);
        break; }
      case 'heal': case 'immune': hud.combatText(ev, F, my); if (ev.e === 'immune') audio.play('immune', pos(ev.id)); break;
      case 'buff':
        hud.combatText(ev, F, my);
        if (ev.type === 'stun' || ev.type === 'disorient') audio.play('stun', pos(ev.id));
        break;
      case 'interrupted': if (ev.id === my || ev.id === me?.target) hud.castInterrupted(ev.id === my); hud.combatText(ev, F, my); audio.play('interrupt', pos(ev.id)); break;
      case 'minionHit': // your basic attack hit a pet / summon: its number, the crosshair tick and the impact
        if (ev.src === my && ev.amt) { hud.floatText({ x: ev.x, y: (ev.y || 0) + 1.6, z: ev.z }, String(ev.amt), '#ffd9a0', ev.crit ? 'crit' : 'small'); hud.hitMarker(ev.crit); if (ev.melee) audio.play('melee_hit', { x: ev.x, z: ev.z }); }
        break;
      case 'miss': if (ev.id === my) hud.floatText({ x: ev.x, y: ev.y, z: ev.z }, 'Miss', '#b8b8b8', 'small'); break; // a melee swing that found no hitbox
      case 'err': if (ev.id === my) { hud.error(ev.msg); audio.play('error'); if (S.mode === 'guest') { if (S.pred?.cast) $('castA')._had = false; S.pred = newPred(); } } break; // the host refused: drop what we predicted
      case 'blink': if (ev.fx === 'arcane_shift' || ev.fx === 'shadow_leap') audio.play('blink', { x: ev.x1, z: ev.z1 }); break;
      case 'dash': world.onDash(ev.id, ev.fx); break;
      case 'death': {
        audio.play('death', pos(ev.id)); world.addShake(ev.id === my ? 0.5 : 0.2);
        const f = F[ev.id], k = F[ev.killer];
        if (S.bg) { // ten champions: a kill feed instead of a banner for every death
          if (f && ev.id === my) hud.announce('You have fallen', 'kill red', false, k ? `by ${k.name} · back with the next wave` : 'back with the next wave');
          else if (f) hud.feed(k ? `${k.name} ⚔ ${f.name}` : `${f.name} died`, f.team === myTeam ? '#ff8a7a' : '#9ad8ff');
          break;
        }
        if (f && F.length > 2) hud.announce(f.team === myTeam ? `${f.name} has fallen` : `${f.name} defeated`, f.team === myTeam ? 'kill red' : 'kill', false, k ? `by ${k.name}` : '');
        break; }
      case 'roundStart': hud.announce(`Round ${ev.round}`); S.lastCount = null; S.lastWinner = -1; break;
      case 'fight': if (S.bg) { hud.announce('The gates are open!', '', false, 'Capture the enemy flag · 3 captures win'); audio.play('gong'); world.arena.crowdHype = 1; break; }
        hud.announce('Fight!'); audio.play('gong'); audio.play('crowd', null, { big: true }); world.arena.crowdHype = 1; break;
      case 'roundEnd':
        S.lastWinner = ev.winner;
        if (ev.winner === myTeam) { hud.announce('Round Won', '', false, `${ev.score[myTeam]} – ${ev.score[1 - myTeam]}`); audio.play('round_win'); }
        else if (ev.winner === -1) { hud.announce('Draw'); }
        else { hud.announce('Round Lost', 'red', false, `${ev.score[myTeam]} – ${ev.score[1 - myTeam]}`); audio.play('round_lose'); }
        audio.play('crowd', null, { big: true }); world.arena.crowdHype = 1;
        break;
      case 'bgStart': hud.announce('Thornwater Gorge', '', false, `The gates open in ${ev.prep} seconds`); S.lastCount = null; break;
      case 'flag': bgFlagEvent(ev, F, myTeam); break;
      case 'powerup': {
        const P = POWERUPS[ev.type];
        if (P) { audio.play('blink', { x: ev.x, z: ev.z }); if (ev.id === my) { hud.announce(P.name, '', false, P.desc); audio.play('round_win'); } else if (F[ev.id]?.team === myTeam) hud.feed(`${F[ev.id].name} took ${P.icon} ${P.name}`, P.color); }
        break; }
      case 'powerups': hud.feed('Power-ups have appeared', '#ffe6a0'); break;
      case 'respawn': if (ev.id === my) { hud.clearAnnounce(); audio.play('immune', pos(ev.id)); input.yaw = F[my]?.yaw ?? input.yaw; } break;
      case 'matchEnd': {
        const won = ev.winner === myTeam;
        if (ev.bg && ev.winner < 0) hud.announce('Draw', '', true, `${ev.score[myTeam]} – ${ev.score[1 - myTeam]}`);
        else hud.announce(won ? 'Victory' : 'Defeat', won ? '' : 'red', true, ev.bg ? `${ev.score[myTeam]} – ${ev.score[1 - myTeam]} captures` : '');
        if (won) world.celebrate(F.filter(f => f.team === myTeam));
        clearTimeout(S.endTimer);
        S.endTimer = setTimeout(() => { hud.clearAnnounce(); showMatchEnd(ev.winner); }, 2800);
        break; }
      case 'fx':
        if (ev.fx === 'quake_erupt') { audio.play('quake', { x: ev.x, z: ev.z }); world.addShake(0.6); }
        else if (ev.fx === 'death_mark_pop') { audio.play('mark_pop', { x: ev.x, z: ev.z }); world.addShake(0.3); }
        else if (ev.fx === 'spirit_cast') audio.play('spirit_bolt', pos(ev.id));
        else if (ev.fx === 'bull_rush_hit') { audio.play('melee_heavy', { x: ev.x, z: ev.z }); world.addShake(0.3); }
        else if (ev.fx === 'shockwave') { audio.play('quake', { x: ev.x, z: ev.z }); world.addShake(0.35); }
        break;
    }
  }
}

// battleground flag news: who took, dropped, returned or captured which flag (from my side's point of view)
const TEAM_NAME = ['Gold', 'Crimson'];
function bgFlagEvent(ev, F, myTeam) {
  const who = F[ev.id]?.name || 'Someone', ours = ev.team === myTeam, flag = ours ? 'our flag' : `the ${TEAM_NAME[ev.team]} flag`;
  const good = '#9aff9a', bad = '#ff7a6a', pos = ev.x !== undefined ? { x: ev.x, z: ev.z } : null;
  switch (ev.act) {
    case 'pick':
      if (ours) { hud.announce(`${who} has taken our flag!`, 'red small'); audio.play('round_lose'); }
      else { hud.announce(ev.id === S.myId ? 'You have the enemy flag!' : `${who} has the ${TEAM_NAME[ev.team]} flag!`, 'small', false, ev.id === S.myId ? 'Bring it to your own flag stand · G drops it' : ''); audio.play('round_win'); }
      break;
    case 'drop': hud.feed(`${who} dropped ${flag}`, ours ? good : bad); audio.play('interrupt', pos); break;
    case 'return': hud.feed(ours ? `${who} returned our flag` : `The ${TEAM_NAME[ev.team]} flag was returned`, ours ? good : bad); audio.play('immune', null); break;
    case 'autoreturn': hud.feed(`The ${TEAM_NAME[ev.team]} flag went back to its keep`, '#ffe6a0'); break;
    case 'capture': {
      const mine = !ours;
      hud.announce(mine ? `${who} captured the ${TEAM_NAME[ev.team]} flag!` : `${who} captured our flag`, mine ? '' : 'red', false, `${ev.score[myTeam]} – ${ev.score[1 - myTeam]}`);
      audio.play('gong'); audio.play(mine ? 'round_win' : 'round_lose'); audio.play('crowd', null, { big: true });
      if (mine) world.arena.crowdHype = 1;
      break; }
    case 'exposed': if (ev.team !== myTeam) hud.feed(`Both carriers are Exposed: +${ev.stacks * 10} % damage taken`, '#ffb04a'); break;
  }
}

// ------------------------------------------------------------------ input → intents
function worldDir(inp) {
  if (!inp.mx && !inp.mz) return null;
  const sy = Math.sin(inp.yaw), cy = Math.cos(inp.yaw);
  const x = sy * inp.mz - cy * inp.mx, z = cy * inp.mz + sy * inp.mx, L = Math.hypot(x, z);
  return { x: x / L, z: z / L };
}

// ------------------------------------------------------------------ main loop
function tickSim(dt, inp, maxSteps = 5) {
  const sim = S.sim;
  S.acc += dt;
  // one-shot inputs (presses, clicks, target keys) are buffered until a sim step consumes
  // them, so frames without a fixed step (high refresh rates) never drop a key press
  const P = S.pend || (S.pend = { abilities: [] });
  P.abilities.push(...(inp.abilities || []));
  if (inp.jump) P.jump = true; if (inp.targetReq) P.targetReq = true; if (inp.attack) P.attack = true; if (inp.dropFlag) P.dropFlag = true;
  if (inp.setTarget !== undefined) P.setTarget = inp.setTarget; if (inp.setFriend !== undefined) P.setFriend = inp.setFriend;
  const localInp = { ...inp, abilities: P.abilities, jump: !!P.jump, targetReq: !!P.targetReq, attack: !!P.attack, dropFlag: !!P.dropFlag, setTarget: P.setTarget, setFriend: P.setFriend };
  if (S.acc >= STEP) S.pend = null;
  let first = true, steps = 0;
  while (S.acc >= STEP && steps < maxSteps) {
    const inputs = [];
    for (const f of sim.fighters) {
      const id = f.id;
      if (id === S.myId) {
        inputs[id] = first ? localInp : { ...localInp, abilities: [], jump: false, targetReq: false, attack: false, dropFlag: false, setTarget: undefined, setFriend: undefined };
      } else if (S.ais.has(id)) inputs[id] = S.ais.get(id).getInput(STEP);
      else {
        const r = S.remotes.get(id);
        if (r && r.remote) {
          inputs[id] = { remote: r.remote };
          if (first) { Object.assign(inputs[id], { abilities: r.abs.splice(0), targetReq: r.targetReq, attack: r.attack, dropFlag: !!r.drop, setTarget: r.setTarget, setFriend: r.setFriend }); r.targetReq = false; r.attack = false; r.drop = false; r.setTarget = undefined; r.setFriend = undefined; }
        } else inputs[id] = { mx: 0, mz: 0, yaw: f.yaw, abilities: [] };
      }
    }
    capturePrev(sim); // the state before this step, for drawing between steps (currentView)
    sim.step(STEP, inputs);
    first = false; S.acc -= STEP; steps++;
  }
  if (steps >= maxSteps) S.acc = 0;
  const evs = sim.drainEvents();
  if (S.mode === 'host' && S.net) {
    if (evs.length) S.net.send({ t: 'ev', l: evs });
    S.snapT -= dt;
    // 20 snapshots a second; the 10-player battleground sends 15 and its statistics only in every 8th (upload)
    if (S.snapT <= 0) { S.snapT = S.bg ? 1 / 15 : 0.05; S.snapN = (S.snapN || 0) + 1; S.net.send({ t: 'snap', s: sim.snapshot(S.bg && S.snapN % 8 !== 0) }); }
  }
  return evs;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - S.lastFrame) / 1000);
  S.lastFrame = now;
  fpsCounter(dt);
  if (S.inGame) gameFrame(dt);
  world.render(dt);
}

function gameFrame(dt) {
  const raw = input.poll();
  const overlay = $('pause').classList.contains('active') || $('matchEnd').classList.contains('active');
  const canControl = input.active && !overlay;
  if (!canControl) { raw.mx = 0; raw.mz = 0; raw.jump = false; raw.sprint = false; raw.abilities = []; raw.attack = false; raw.atkHeld = false; raw.friendKey = 0; }
  const dir = worldDir(raw);
  const pre = currentView(true);
  const meV = pre.fighters[S.myId];
  // Left click = a basic attack where the crosshair dot points (aimed: it hits whichever hitbox the dot is on,
  // or nothing). An enemy under the dot when you click also becomes your target, for your abilities.
  let setTarget, setFriend;
  // the aim: the dot in the middle while the mouse is captured; where mouse capture is impossible (embedded views)
  // the cursor itself aims — the dot follows it and the system cursor is hidden over the arena
  const freeAim = !input.locked;
  const aim = freeAim ? world.aimRay(raw.aimPos.x, raw.aimPos.y) : world.aimRay();
  { const ch = $('crosshair'); ch.style.left = freeAim ? raw.aimPos.x * 100 + '%' : ''; ch.style.top = freeAim ? raw.aimPos.y * 100 + '%' : '';
    canvas.style.cursor = input.fallback && !overlay ? 'none' : ''; }
  const myA = meV ? kitOf(meV).auto : null;
  if (raw.attack && meV) {
    const pick = aimPick(pre.fighters, meV, aim, 80); // clicking a champion targets it (pets / summons are hit, never targeted)
    if (pick && pick.f.id !== meV.target) setTarget = pick.f.id;
  }
  // crosshair feedback: is an enemy hitbox under the dot that this basic attack can reach right now?
  if (meV && myA) {
    const reachOk = myA.ranged ? (t => rangeDist(meV, t) <= myA.range + 1)
      : (t => rangeDist(meV, t) <= MELEE_AUTO_RANGE + meleeBonus(meV, t) && Math.abs(angleDiff(meV.yaw, angleTo(meV, t))) <= FACE_ARC);
    const units = [...pre.fighters, ...(pre.minions || [])];
    // ranged: the dot also counts as on target inside the aim assist (the shot will lead and bend towards that enemy)
    hud.aimOn = !!(aimPick(units, meV, aim, 80, myA.ranged ? 0 : MELEE_AIM_WIDTH, reachOk) || (myA.ranged && assistPick(units, meV, aim, 80, t => reachOk(t) && !segBlocked(meV.x, meV.z, t.x, t.z, meV.y + 1.5, t.y + 1.2))));
  }
  const atkHold = !!raw.atkHeld;
  if (raw.friendKey === 1) setFriend = S.myId;
  if (raw.friendKey === 2) {
    const allies = pre.fighters.filter(f => f.team === meV.team && f.id !== S.myId);
    // F2 again: the next ally (cycles through a 5v5 team)
    const k = allies.findIndex(f => f.id === meV.friend);
    setFriend = allies.length ? allies[(k + 1) % allies.length].id : S.myId;
  }
  // mouseover healing: an ally under the crosshair (or cursor) takes your ally spells without changing your friendly target
  const mo = settings.mouseover && meV && canControl ? world.pickAlly(pre, S.myId, raw.aimPos.x, raw.aimPos.y) : -1;
  hud.mouseover = mo;
  const myKit = meV ? kitOf(meV) : null;
  const abInput = i => (mo >= 0 && myKit?.abilities[i]?.ally ? { i, dir, tid: mo } : { i, dir });
  const local = { mx: raw.mx, mz: raw.mz, yaw: input.yaw, jump: raw.jump, sprint: raw.sprint, abilities: raw.abilities.map(abInput), targetReq: raw.targetReq, attack: raw.attack, atkHold, aim, setTarget, setFriend, dropFlag: !!(S.bg && raw.dropFlag) };

  let view;
  if (S.mode === 'guest') {
    const L = S.local, last = S.lastSnap;
    const state = last ? last.s : 'countdown';
    if (L && L.alive !== false) {
      // the battleground's preparation lets you walk around your keep; an arena countdown holds you in place
      moveFighter(L, local, dt, pre.fighters, state === 'fight' || (S.bg && state === 'countdown'));
      if (state === 'countdown' && last && !S.bg) { L.x = last.f[S.myId].x; L.z = last.f[S.myId].z; }
    }
    S.sendT -= dt;
    if (local.abilities.length || local.attack || atkHold !== !!S.sentHold) S.sendT = 0; // an ability press or attack click must reach the host with our latest movement and aim
    const net = S.net;
    if (net && S.sendT <= 0) { S.sendT = 1 / 30; net.send({ t: 'in', x: +L.x.toFixed(3), y: +L.y.toFixed(3), z: +L.z.toFixed(3), yaw: +L.yaw.toFixed(3), moving: L.moving, sprinting: L.sprinting, stamina: Math.round(L.stamina), h: atkHold ? 1 : 0, a: aim.map(v => +v.toFixed(3)), ack: S.ack }); S.sentHold = atkHold; }
    if (net) {
      if (setTarget !== undefined || setFriend !== undefined) net.send({ t: 'sel', tid: setTarget, fid: setFriend });
      for (const a of local.abilities) { net.send({ t: 'ab', i: a.i, dir: a.dir, tid: a.tid }); guestPredict(pre, a.i, a.tid); }
      if (local.targetReq) net.send({ t: 'tg' });
      if (local.dropFlag) net.send({ t: 'drop' });
      if (local.attack) net.send({ t: 'atk', tid: setTarget ?? -1 });
    }
    view = buildGuestView();
  } else {
    let evs = [];
    if (!S.paused) evs = tickSim(dt, local);
    view = currentView();
    const me = S.sim.fighters[S.myId];
    if (me.forceYaw !== S.lastForceYaw) { S.lastForceYaw = me.forceYaw; input.yaw = me.yaw; }
    handleEvents(evs, view);
  }

  // countdown numbers
  if (view.state === 'countdown') {
    const n = Math.ceil(view.stateT);
    if (n !== S.lastCount && n >= 1 && n <= 3) { S.lastCount = n; hud.announce(String(n)); audio.play('tick'); }
  }
  const me = view.fighters[S.myId];
  // when dead in 2v2, follow a living teammate; on the battleground you wait for the next wave at your corpse
  const ally = !me.alive && !S.bg ? view.fighters.find(f => f.team === me.team && f.alive && f.id !== me.id) : null;
  $('spectate').classList.toggle('hidden', !(ally && view.state === 'fight'));
  hud.boardHeld = !!(S.bg && raw.scoreHeld && canControl);
  audio.listener = { x: me.x, z: me.z, yaw: input.yaw };
  world.updateGame(dt, view, S.myId, input, ally ? ally.id : S.myId);
  hud.update(dt, view, world.camera, S.myId);
  $('lockHint').classList.toggle('hidden', input.active || overlay);
}

// Keep the host simulation alive when its tab is in the background (browsers pause
// requestAnimationFrame and throttle timers there), catching up on real elapsed time.
let bgLast = performance.now();
setInterval(() => {
  const now = performance.now();
  if (S.inGame && S.mode === 'host' && now - S.lastFrame > 150) {
    const dt = Math.min(1, (now - bgLast) / 1000);
    const evs = tickSim(dt, { mx: 0, mz: 0, yaw: input.yaw, abilities: [] }, 70);
    if (evs.length) handleEvents(evs, currentView());
  }
  bgLast = now;
}, 50);

let fpsAcc = 0, fpsN = 0;
function fpsCounter(dt) { if (!settings.fps) return; fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { $('fps').textContent = Math.round(fpsN / fpsAcc) + ' fps · ' + world.renderer.info.render.calls + ' draws'; fpsAcc = 0; fpsN = 0; } }

// debug handle (used for automated testing; harmless in production)
window.__rf = { world, S, CLASSES, input, audio, hud, tick: dt => { if (S.inGame) gameFrame(dt); }, startMatch, onSnapshot, handleEvents, buildGuestView };
requestAnimationFrame(frame);
