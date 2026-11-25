// Runefall Arena — app entry: screens, match flow, game loop, rooms/parties and network glue.
//
// Modes:  duel     — 1v1 vs an AI (offline)
//         bots2v2  — you + ally bot vs Zigi & Jöggu (offline)
//         host     — you host a room (1v1 or 2v2; empty slots can be bots); authoritative sim
//         guest    — you joined a room; inputs go to the host, state comes back as snapshots
import { World } from './render/world.js';
import { loadHeroAssets } from './render/heroes.js';
import { HUD, iconHTML, emblemStyle } from './ui/hud.js';
import { Input } from './input.js';
import { Audio, AB_SOUND, HIT_SOUND, CAST_SOUND } from './audio.js';
import { Sim, moveFighter, RULES } from './sim/sim.js';
import { AI } from './sim/ai.js';
import { Net } from './net.js';
import { CLASSES, CLASS_ORDER, BOT_NAMES } from './data/classes.js';

const $ = id => document.getElementById(id);
const STEP = 1 / 60;
const rand = a => a[Math.floor(Math.random() * a.length)];

// ------------------------------------------------------------------ settings
const DEFAULTS = { music: 55, sfx: 80, sens: 100, invert: false, quality: 'high', fps: false };
let settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('runefall-settings') || '{}') };
function saveSettings() { localStorage.setItem('runefall-settings', JSON.stringify(settings)); applySettings(); }

// ------------------------------------------------------------------ core objects
const canvas = $('scene');
let world;
try { world = new World(canvas); }
catch (e) { $('loadmsg').textContent = 'WebGL could not start in this browser: ' + e.message; throw e; }
const hud = new HUD();
const input = new Input(canvas);
const audio = new Audio();

const S = {
  screen: 'splash', mode: null, sim: null, ais: new Map(), net: null, myId: 0,
  myCls: localStorage.getItem('runefall-class') || 'mage', difficulty: localStorage.getItem('runefall-diff') || 'normal',
  playerName: localStorage.getItem('runefall-name') || ('Champion' + Math.floor(100 + Math.random() * 900)),
  team: { ally: 'random', foe1: 'random', foe2: 'random' },
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
  if (world.quality !== settings.quality) world.setQuality(settings.quality);
  $('fps').classList.toggle('hidden', !settings.fps);
}
applySettings();

// ------------------------------------------------------------------ screens & transitions
function show(id) {
  S.screen = id;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
}
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
  $('record').innerHTML = `Record <b>${REC.w}</b> W · <b>${REC.l}</b> L${REC.streak > 1 ? ` · <b>${REC.streak}</b> win streak` : ''}${REC.best > 1 ? ` · best streak ${REC.best}` : ''}`;
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
  else if (act === 'create') startHost();
  else if (act === 'join') { show('join'); $('joinStatus').textContent = ''; $('joinCode').focus(); }
  else if (act === 'browse') openClassSelect('browse');
  else if (act === 'settings') openSettings('menu');
  else if (act === 'howto') { S.howtoBack = 'menu'; show('howto'); }
});

// settings
function openSettings(back) {
  S.settingsBack = back;
  $('setMusic').value = settings.music; $('setSfx').value = settings.sfx; $('setSens').value = settings.sens;
  $('setInvert').checked = settings.invert; $('setQuality').value = settings.quality; $('setFps').checked = settings.fps;
  if (back === 'pause') showOverlay('pause', false);
  show('settings');
}
for (const [id, key, conv] of [['setMusic', 'music', Number], ['setSfx', 'sfx', Number], ['setSens', 'sens', Number], ['setQuality', 'quality', String]]) $(id).addEventListener('input', e => { settings[key] = conv(e.target.value); saveSettings(); });
$('setInvert').addEventListener('change', e => { settings.invert = e.target.checked; saveSettings(); });
$('setFps').addEventListener('change', e => { settings.fps = e.target.checked; saveSettings(); });
$('settingsBack').addEventListener('click', () => { if (S.settingsBack === 'pause') { show(null); showOverlay('pause', true); } else show(S.settingsBack || 'menu'); });
$('howtoBack').addEventListener('click', () => { if (S.howtoBack === 'pause') { show(null); showOverlay('pause', true); } else show('menu'); });

// ------------------------------------------------------------------ class selection
function openClassSelect(mode) {
  S.csMode = mode;
  show('classSelect');
  $('csTitle').textContent = { browse: 'The Champions', room: 'Choose Your Champion', duel: 'Duel — Choose Your Champion', bots2v2: '2v2 — Choose Your Champion' }[mode];
  $('csDifficulty').classList.toggle('hidden', mode !== 'duel' && mode !== 'bots2v2');
  $('csTeam').classList.toggle('hidden', mode !== 'bots2v2');
  $('csConfirm').classList.toggle('hidden', mode === 'browse');
  $('csConfirm').textContent = mode === 'room' ? 'Confirm' : 'Enter the Arena';
  document.querySelectorAll('#csDifficulty .chip').forEach(c => c.classList.toggle('on', c.dataset.diff === S.difficulty));
  const list = $('csList'); list.innerHTML = '';
  for (const id of CLASS_ORDER) {
    const C = CLASSES[id];
    const el = document.createElement('div'); el.className = 'cs-card'; el.dataset.cls = id;
    el.innerHTML = `<div class="emblem" style="${emblemStyle(C)}">${C.emblem}</div><div><div class="cname" style="color:${C.color}">${C.name}</div><div class="crole">${C.role}</div></div>`;
    el.addEventListener('click', () => selectClass(id));
    list.appendChild(el);
  }
  if (mode === 'bots2v2') renderTeamPanel();
  selectClass(S.myCls);
}

function renderTeamPanel() {
  const opts = v => `<option value="random"${v === 'random' ? ' selected' : ''}>Random</option>` + CLASS_ORDER.map(c => `<option value="${c}"${v === c ? ' selected' : ''}>${CLASSES[c].name}</option>`).join('');
  $('csTeam').innerHTML = `<div class="ally"><h4>Your Team</h4><div class="tm"><span>${esc(S.playerName)}</span><b style="color:${CLASSES[S.myCls].color}">${CLASSES[S.myCls].name}</b></div>
    <div class="tm"><span>${BOT_NAMES.ally[0]} (bot)</span><select data-k="ally">${opts(S.team.ally)}</select></div></div>
    <div class="foe"><h4>Enemy Team</h4><div class="tm"><span>${BOT_NAMES.enemy[0]}</span><select data-k="foe1">${opts(S.team.foe1)}</select></div>
    <div class="tm"><span>${BOT_NAMES.enemy[1]}</span><select data-k="foe2">${opts(S.team.foe2)}</select></div></div>`;
  $('csTeam').querySelectorAll('select').forEach(s => s.addEventListener('change', () => { S.team[s.dataset.k] = s.value; }));
}

function statRow(label, rating, value) {
  return `<div class="stat"><span>${label}</span><div class="track"><div style="width:${rating * 20}%"></div></div><span class="v">${value}</span></div>`;
}

function selectClass(id) {
  S.myCls = id; localStorage.setItem('runefall-class', id);
  document.querySelectorAll('.cs-card').forEach(c => c.classList.toggle('on', c.dataset.cls === id));
  const C = CLASSES[id];
  world.showPreview(id);
  const resName = { mana: 'Mana', energy: 'Energy', rage: 'Rage' }[C.resType];
  const A = C.auto;
  $('csDetails').innerHTML = `
    <h3 style="color:${C.color}">${C.name}</h3>
    <div class="role">${C.role}</div>
    <p>${C.desc}</p>
    <div class="gear"><b>Weapon:</b> ${C.weapon}<br><b>Armor:</b> ${C.armor}<br><b>Resource:</b> ${resName} (${C.res})</div>
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
        <div><div class="aname" style="color:${ab.color}">${ab.name} <span class="key">KEY ${i + 1}</span></div>
        <div class="meta">${[ab.cost ? `${ab.cost} ${resName}` : 'No cost', ab.cast ? `${ab.cast}s cast` : 'Instant', ab.cd ? `${ab.cd}s cooldown` : '', ab.range ? `${ab.range} yd` : ''].filter(Boolean).join(' · ')}</div>
        <div class="adesc">${ab.desc}</div></div></div>`).join('')}
    </div>`;
  $('csDetails').querySelectorAll('.ab-row').forEach(r => r.addEventListener('click', () => {
    const i = +r.dataset.i;
    if (i < 0) { world.previewAttack(); audio.play(A.ranged ? 'auto_' + id : (id === 'rogue' ? 'dagger' : 'swing')); return; }
    const ab = C.abilities[i];
    world.previewAbility(ab);
    audio.play(AB_SOUND[ab.id]);
  }));
  if (S.csMode === 'bots2v2') renderTeamPanel();
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
    const foe = rand(CLASS_ORDER.filter(c => c !== S.myCls));
    startMatch([{ cls: S.myCls, team: 0, name: S.playerName }, { cls: foe, team: 1, name: rand(BOT_NAMES.enemy), bot: true, diff: S.difficulty }], 'duel', 0);
  } else if (S.csMode === 'bots2v2') {
    const pick = (v, avoid) => v !== 'random' ? v : rand(CLASS_ORDER.filter(c => !avoid.includes(c)));
    const ally = pick(S.team.ally, [S.myCls]);
    const f1 = pick(S.team.foe1, []);
    const f2 = pick(S.team.foe2, [f1]);
    startMatch([
      { cls: S.myCls, team: 0, name: S.playerName },
      { cls: ally, team: 0, name: BOT_NAMES.ally[0], bot: true, diff: S.difficulty },
      { cls: f1, team: 1, name: BOT_NAMES.enemy[0], bot: true, diff: S.difficulty },
      { cls: f2, team: 1, name: BOT_NAMES.enemy[1], bot: true, diff: S.difficulty },
    ], 'bots2v2', 0);
  } else if (S.csMode === 'room') {
    if (S.net?.role === 'host') { const s = S.room.slots[S.mySlot]; s.cls = S.myCls; s.ready = false; roomBroadcast(); }
    else if (S.net) { S.net.send({ t: 'pick', cls: S.myCls }); S.net.send({ t: 'ready', v: false }); }
    world.showMenuScene(); show('room'); renderRoom();
  }
});

// ------------------------------------------------------------------ rooms (parties)
// Slots 0,1 = Gold team, 2,3 = Crimson team. 1v1 uses slots 0 and 2.
const SLOT_TEAM = [0, 0, 1, 1];
const activeSlots = room => room.format === '1v1' ? [0, 2] : [0, 1, 2, 3];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function newRoom() {
  return { format: '2v2', botDiff: 'normal', slots: [
    { kind: 'human', name: S.playerName, cls: S.myCls, ready: true, cid: 'host' },
    { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' },
  ] };
}
function botFor(i) {
  const enemy = SLOT_TEAM[i] === 1;
  const used = S.room.slots.filter(s => s.kind === 'bot').map(s => s.name);
  const names = enemy ? BOT_NAMES.enemy : [...BOT_NAMES.ally, ...BOT_NAMES.enemy];
  const name = names.find(n => !used.includes(n)) || (enemy ? 'Zigi' : 'Aldor');
  return { kind: 'bot', name, cls: rand(CLASS_ORDER), ready: true };
}

function startHost() {
  closeNet();
  S.room = newRoom(); S.mySlot = 0; S.queueing = false;
  show('room'); renderRoom();
  $('roomStatus').textContent = 'Opening the arena gates…';
  const net = S.net = new Net();
  bindNet(net);
  net.host(code => {
    $('roomCode').textContent = code;
    $('roomStatus').textContent = 'Invite friends with the link — or fill empty slots with bots.';
  });
}

function roomLink() { const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('join', S.net?.code || ''); return url.toString(); }
$('copyLink').addEventListener('click', () => { navigator.clipboard?.writeText(roomLink()).then(() => toast('Invite link copied!'), () => toast(roomLink(), 6000)); });

function publicRoom() { return { format: S.room.format, botDiff: S.room.botDiff, slots: S.room.slots.map(s => ({ kind: s.kind, name: s.name, cls: s.cls, ready: s.ready, host: s.cid === 'host' })) }; }
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
  $('roomTitle').textContent = room.format === '2v2' ? '2v2 Party Lobby' : '1v1 Duel Lobby';
  document.querySelectorAll('#roomFormat .chip').forEach(c => { c.classList.toggle('on', c.dataset.format === room.format); c.disabled = !isHost; });
  const act = activeSlots(room);
  const card = i => {
    const s = room.slots[i], me = i === S.mySlot;
    if (s.kind === 'empty') return `<div class="slot-card empty" data-i="${i}">Open slot ${isHost ? `<span class="sbtns"><button class="btn small" data-act="bot" data-i="${i}">+ Bot</button></span>` : ''}</div>`;
    const C = CLASSES[s.cls];
    const ctrl = isHost ? (s.kind === 'bot'
      ? `<select data-act="botcls" data-i="${i}">${CLASS_ORDER.map(c => `<option value="${c}"${c === s.cls ? ' selected' : ''}>${CLASSES[c].name}</option>`).join('')}</select><button class="btn small" data-act="kick" data-i="${i}" title="Remove bot">✕</button>`
      : `<button class="btn small" data-act="swap" data-i="${i}" title="Move to the other team">⇄</button>${s.host ? '' : `<button class="btn small" data-act="kick" data-i="${i}" title="Kick">✕</button>`}`) : '';
    return `<div class="slot-card ${me ? 'me' : ''}"><div class="emblem" style="${emblemStyle(C)}">${C.emblem}</div>
      <div class="sinfo"><div class="sname">${esc(s.name)}${s.host ? ' <span class="muted">♛</span>' : ''}${me ? ' <span class="muted">(you)</span>' : ''}</div><div class="ssub" style="color:${C.color}">${C.name}${s.kind === 'bot' ? ' · Bot' : ''}</div></div>
      <span class="sready ${s.ready ? 'ok' : 'no'}">${s.kind === 'bot' ? 'BOT' : s.ready ? '✔ READY' : 'NOT READY'}</span><span class="sbtns">${ctrl}</span></div>`;
  };
  $('slotsA').innerHTML = act.filter(i => SLOT_TEAM[i] === 0).map(card).join('');
  $('slotsB').innerHTML = act.filter(i => SLOT_TEAM[i] === 1).map(card).join('');
  $('room').querySelector('.room-actions').classList.toggle('guest', !isHost);
  const mine = room.slots[S.mySlot];
  $('roomReady').classList.toggle('hidden', isHost);
  $('roomReady').textContent = mine?.ready ? 'Cancel Ready' : 'Ready';
  $('roomReady').classList.toggle('on', !!mine?.ready);
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
  const f = e.target.closest('[data-format]')?.dataset.format; if (!f || S.net?.role !== 'host') return;
  S.room.format = f;
  if (f === '1v1') { // move humans out of slots 1/3 if possible
    for (const [from, to] of [[1, 2], [3, 2], [1, 0]]) {
      const a = S.room.slots[from], b = S.room.slots[to];
      if (a.kind === 'human' && b.kind !== 'human') { S.room.slots[to] = a; S.room.slots[from] = { kind: 'empty' }; if (a.cid === 'host') S.mySlot = to; }
    }
    for (const i of [1, 3]) if (S.room.slots[i].kind === 'human') { S.net.sendTo(S.room.slots[i].cid, { t: 'kicked', msg: 'The lobby switched to 1v1 and is full.' }); S.net.kick(S.room.slots[i].cid); S.room.slots[i] = { kind: 'empty' }; }
    else S.room.slots[1] = S.room.slots[3] = { kind: 'empty' };
    stopQueue();
  }
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
    const other = activeSlots(S.room).filter(j => SLOT_TEAM[j] !== SLOT_TEAM[i]);
    const j = other.find(j => S.room.slots[j].kind !== 'human') ?? other[0];
    [S.room.slots[i], S.room.slots[j]] = [S.room.slots[j], S.room.slots[i]];
    if (S.room.slots[j].cid === 'host') S.mySlot = j; else if (S.room.slots[i].cid === 'host') S.mySlot = i;
  }
  roomBroadcast();
});
$('room').addEventListener('change', e => {
  const sel = e.target.closest('[data-act="botcls"]'); if (!sel || S.net?.role !== 'host') return;
  S.room.slots[+sel.dataset.i].cls = sel.value; roomBroadcast();
});
$('roomBotDiff').addEventListener('change', e => { if (S.room) { S.room.botDiff = e.target.value; roomBroadcast(); } });
$('roomFill').addEventListener('click', () => { for (const i of activeSlots(S.room)) if (S.room.slots[i].kind === 'empty') S.room.slots[i] = botFor(i); roomBroadcast(); });
$('roomClass').addEventListener('click', () => openClassSelect('room'));
$('roomReady').addEventListener('click', () => { if (!S.net || !S.roomView) return; const v = !S.roomView.slots[S.mySlot]?.ready; S.net.send({ t: 'ready', v }); });
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
    net.send({ t: 'hello', name: S.playerName, cls: S.myCls, want: wantTeam });
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
  net.on('pick', (m, cid) => { const s = slotOf(cid); if (s && CLASSES[m.cls]) { s.cls = m.cls; s.ready = false; roomBroadcast(); } });
  net.on('ready', (m, cid) => { const s = slotOf(cid); if (s) { s.ready = !!m.v; roomBroadcast(); } });
  net.on('in', (m, cid) => { const r = remoteOf(cid); if (r) r.remote = m; });
  net.on('ab', (m, cid) => { const r = remoteOf(cid); if (r) r.abs.push({ i: m.i, dir: m.dir }); });
  net.on('tg', (m, cid) => { const r = remoteOf(cid); if (r) r.targetReq = true; });
  net.on('atk', (m, cid) => { const r = remoteOf(cid); if (r) { r.attack = true; if (m.tid >= 0) r.setTarget = m.tid; } });
  net.on('sel', (m, cid) => { const r = remoteOf(cid); if (r) { if (m.tid !== undefined) r.setTarget = m.tid; if (m.fid !== undefined) r.setFriend = m.fid; } });
  // ---- guest side
  net.on('room', m => {
    if (net.role !== 'guest') return;
    S.roomView = m.room; S.mySlot = m.you;
    if (S.inGame) { endGame(); world.showMenuScene(); audio.setTrack('menu'); }
    if (S.screen !== 'room' && S.screen !== 'classSelect') show('room');
    if (S.screen === 'room') renderRoom();
    $('roomStatus').textContent = 'Waiting for the host to start the match…';
  });
  net.on('start', m => { if (net.role === 'guest') transition(() => startMatch(m.roster, 'guest', m.you)); });
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
  const order = [...act.filter(i => SLOT_TEAM[i] === want), ...act.filter(i => SLOT_TEAM[i] !== want)];
  const i = order.find(j => room.slots[j].kind === 'empty') ?? order.find(j => room.slots[j].kind === 'bot');
  if (i === undefined) { S.net.sendTo(cid, { t: 'full' }); setTimeout(() => S.net?.kick(cid), 300); return; }
  room.slots[i] = { kind: 'human', name: String(m.name || 'Champion').slice(0, 16), cls: CLASSES[m.cls] ? m.cls : 'warrior', ready: false, cid };
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
    if (fid !== undefined && S.sim) { S.remotes.delete(fid); S.ais.set(fid, new AI(S.sim, fid, room.botDiff)); S.sim.fighters[fid].bot = true; }
    S.cidToFid.delete(cid);
    room.slots[i] = { kind: 'bot', name: name, cls: room.slots[i].cls, ready: true };
    toast(`${name} left — a bot takes over their champion.`, 3500);
  } else {
    room.slots[i] = { kind: 'empty' };
    $('roomStatus').textContent = `${name} left the lobby.`;
  }
  roomBroadcast();
}

function startOnline() {
  stopQueue();
  const room = S.room, act = activeSlots(room);
  const roster = [], owners = [];
  for (const i of act) {
    const s = room.slots[i];
    roster.push({ cls: s.cls, team: SLOT_TEAM[i], name: s.name, bot: s.kind === 'bot', diff: room.botDiff });
    owners.push(s.kind === 'human' ? s.cid : null);
  }
  const myFid = owners.indexOf('host');
  S.cidToFid = new Map();
  owners.forEach((cid, fid) => { if (cid && cid !== 'host') { S.cidToFid.set(cid, fid); S.net.sendTo(cid, { t: 'start', roster, you: fid }); } });
  for (const s of room.slots) if (s.kind === 'human') s.ready = s.cid === 'host';
  transition(() => startMatch(roster, 'host', myFid));
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
function startMatch(roster, mode, myId) {
  clearTimeout(S.endTimer);
  S.mode = mode; S.inGame = true; S.paused = false; S.acc = 0;
  S.roster = roster; S.myId = myId;
  S.lastCount = null; S.lastWinner = -1;
  S.snaps = []; S.lastSnap = null; S.ack = 0; S.lastForceYaw = -1;
  S.ais = new Map(); S.remotes = new Map(); S.pend = null;
  const me = roster[myId];
  if (mode === 'guest') {
    S.sim = null;
    S.local = { id: myId, cls: me.cls, team: me.team, x: 0, y: 0, z: me.team === 0 ? -20 : 20, vy: 0, yaw: me.team === 0 ? 0 : Math.PI, stamina: 100, buffs: [], alive: true, locked: false, moving: false };
  } else {
    S.sim = new Sim(roster);
    roster.forEach((r, fid) => {
      if (fid === myId) return;
      if (r.bot || mode === 'duel' || mode === 'bots2v2') S.ais.set(fid, new AI(S.sim, fid, r.diff || S.difficulty));
      else S.remotes.set(fid, { remote: null, abs: [], targetReq: false, attack: false });
    });
    if (S.local === null || mode !== 'guest') S.local = null;
  }
  world.setFighters(roster, myId);
  const v = currentView();
  hud.setup(v.fighters, myId);
  hud.show(true); hud.clearAnnounce();
  show(null); showOverlay('pause', false); showOverlay('matchEnd', false);
  input.enabled = true; input.yaw = me.team === 0 ? 0 : Math.PI; input.pitch = 0.3; input.keys.clear();
  world.camPos.set(0, 6, me.team === 0 ? -30 : 30);
  audio.setTrack('arena');
  input.requestLock();
  $('lockHint').classList.add('hidden');
}

function endGame() {
  S.inGame = false; S.sim = null; S.ais = new Map(); S.local = null; S.remotes = new Map();
  input.enabled = false; input.exitLock();
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
input.onFallback = () => toast('Mouse capture unavailable here — hold the right mouse button and drag to look around.', 5000);
const offline = () => S.mode === 'duel' || S.mode === 'bots2v2';
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
  const v = currentView();
  const F = v.fighters, me = F[S.myId];
  const won = winner === me.team;
  input.exitLock();
  showOverlay('pause', false);
  const t = $('endTitle'); t.textContent = won ? 'Victory' : 'Defeat'; t.classList.toggle('defeat', !won);
  $('endScore').textContent = `${v.score[me.team]} – ${v.score[1 - me.team]}`;
  const st = f => f.stats || { dmg: 0, heal: 0, absorbed: 0, ccs: 0, interrupts: 0, crits: 0, kills: 0 };
  const mvp = F.reduce((b, f) => (st(f).dmg + st(f).heal > st(b).dmg + st(b).heal ? f : b), F[0]);
  const rows = [...F].sort((a, b) => a.team - b.team).map(f => { const s = st(f); return `<tr class="t${f.team === me.team ? 0 : 1} ${f.id === S.myId ? 'me' : ''}"><td>${esc(f.name)} <span class="muted">${CLASSES[f.cls].name}</span>${f.id === mvp.id ? '<span class="mvp">★ MVP</span>' : ''}</td><td>${s.dmg}</td><td>${s.heal}</td><td>${s.absorbed}</td><td>${s.kills}</td><td>${s.ccs}</td><td>${s.interrupts}</td><td>${s.crits}</td></tr>`; }).join('');
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
$('endRematch').addEventListener('click', () => {
  const roster = S.roster;
  if (S.mode === 'host') { // restart with the same lineup; departed players stay bots
    const humans = new Set(S.cidToFid.values());
    const r2 = roster.map((r, fid) => ({ ...r, bot: fid !== S.myId && !humans.has(fid) }));
    S.cidToFid.forEach((fid, cid) => S.net.sendTo(cid, { t: 'start', roster: r2, you: fid }));
    transition(() => startMatch(r2, 'host', S.myId));
    return;
  }
  transition(() => startMatch(roster, S.mode, S.myId));
});
$('endClass').addEventListener('click', () => {
  if (S.mode === 'host') { backToLobby(); return; }
  transition(() => { const m = S.mode; endGame(); openClassSelect(m === 'bots2v2' ? 'bots2v2' : 'duel'); audio.setTrack('menu'); });
});
$('endMenu').addEventListener('click', () => {
  if (offline()) transition(() => { endGame(); world.showMenuScene(); show('menu'); audio.setTrack('menu'); });
  else leaveOnline();
});

// ------------------------------------------------------------------ views
function currentView() {
  if (S.mode === 'guest') return buildGuestView();
  const sim = S.sim;
  return { fighters: sim.fighters, projectiles: sim.projectiles, zones: sim.zones, state: sim.state, stateT: sim.stateT, round: sim.round, score: sim.score, fightT: sim.fightT, damp: sim.damp, lastWinner: S.lastWinner };
}

function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }

function dummyFighter(r, id) {
  const C = CLASSES[r.cls];
  return { id, cls: r.cls, team: r.team, name: r.name, x: 0, y: 0, z: r.team === 0 ? -20 : 20, yaw: r.team === 0 ? 0 : Math.PI, hp: C.hp, maxHp: C.hp, res: C.res, maxRes: C.res, resType: C.resType, cds: [0, 0, 0, 0, 0, 0], gcd: 0, cast: null, buffs: [], cp: 0, alive: true, stamina: 100, target: -1, friend: -1, autoT: 0, autoOn: false };
}

function buildGuestView() {
  const snaps = S.snaps, last = S.lastSnap, L = S.local;
  if (!last) {
    const fighters = S.roster.map((r, i) => i === S.myId ? { ...dummyFighter(r, i), ...L } : dummyFighter(r, i));
    return { fighters, projectiles: [], zones: [], state: 'countdown', stateT: 3, round: 1, score: [0, 0], fightT: 0, damp: 0, lastWinner: -1 };
  }
  // interpolate everyone else ~100ms in the past
  const rt = performance.now() - 100;
  let a = snaps[0], b = snaps[snaps.length - 1];
  for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].t <= rt && snaps[i + 1].t >= rt) { a = snaps[i]; b = snaps[i + 1]; break; }
  const u = b.t > a.t ? Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t))) : 1;
  const fighters = last.f.map((f, i) => {
    if (i === S.myId) return { ...f, id: i, x: L.x, y: L.y, z: L.z, yaw: L.yaw, stamina: L.stamina };
    const fa = a.s.f[i], fb = b.s.f[i];
    return { ...f, id: i, x: fa.x + (fb.x - fa.x) * u, y: fa.y + (fb.y - fa.y) * u, z: fa.z + (fb.z - fa.z) * u, yaw: lerpAngle(fa.yaw, fb.yaw, u) };
  });
  const pa = new Map(a.s.p.map(p => [p.id, p]));
  const projectiles = b.s.p.map(p => { const q = pa.get(p.id); return q ? { ...p, x: q.x + (p.x - q.x) * u, y: q.y + (p.y - q.y) * u, z: q.z + (p.z - q.z) * u } : p; });
  const age = (performance.now() - S.lastSnapT) / 1000;
  const zones = last.z.map(z => ({ ...z, t: Math.min(z.dur, z.t + age) }));
  return { fighters, projectiles, zones, state: last.s, stateT: last.st - age, round: last.r, score: last.sc, fightT: last.ft + (last.s === 'fight' ? age : 0), damp: last.dp, lastWinner: S.lastWinner };
}

function onSnapshot(s) {
  if (!S.inGame || S.mode !== 'guest') return;
  const now = performance.now();
  S.snaps.push({ t: now, s }); if (S.snaps.length > 12) S.snaps.shift();
  S.lastSnap = s; S.lastSnapT = now;
  const me = s.f[S.myId], L = S.local;
  if (!me || !L) return;
  L.buffs = me.buffs; L.alive = me.alive; L.locked = me.locked;
  // server-forced movement (blinks, charges, round resets) overrides our prediction
  if (me.forceSeq !== S.ack || me.locked) {
    L.x = me.x; L.y = me.y; L.z = me.z; L.vy = 0;
    if (!me.locked) S.ack = me.forceSeq;
  }
  if (me.forceYaw !== S.lastForceYaw) { S.lastForceYaw = me.forceYaw; L.yaw = me.yaw; input.yaw = me.yaw; }
}

// ------------------------------------------------------------------ events → feedback
function handleEvents(evs, view) {
  const F = view.fighters, my = S.myId, me = F[my];
  const myTeam = me ? me.team : 0;
  const ctx = { fighters: F, chars: world.chars, focus: id => world.chars[id] ? world.chars[id].focusWorld() : { x: F[id].x, y: 1.5, z: F[id].z, clone() { return this; } } };
  const pos = id => F[id] ? { x: F[id].x, z: F[id].z } : null;
  for (const ev of evs) {
    world.vfx.onEvent(ev, ctx);
    switch (ev.e) {
      case 'ab': {
        world.onAbilityAnim(ev.id, ev.ab);
        audio.play(AB_SOUND[ev.ab], pos(ev.id));
        if (ev.id === my) { const i = CLASSES[F[my].cls].abilities.findIndex(a => a.id === ev.ab); hud.flashSlot(i); }
        if (ev.ab === 'glacial_nova' || ev.ab === 'blinding_light' || ev.ab === 'halo_judgment') world.addShake(0.25);
        break; }
      case 'caststart': {
        const ab = CLASSES[F[ev.id].cls].abilities.find(a => a.id === ev.ab);
        audio.play(CAST_SOUND[ab?.school] || 'cast_arcane', pos(ev.id));
        break; }
      case 'auto': {
        world.onAuto(ev.id);
        const c = F[ev.id].cls;
        audio.play(ev.ranged ? 'auto_' + c : c === 'rogue' ? 'dagger' : 'swing', pos(ev.id));
        break; }
      case 'hit': audio.play(HIT_SOUND[ev.kind] || 'fire_hit', { x: ev.x, z: ev.z }); if (ev.kind === 'arcane_comet') world.addShake(ev.id === my ? 0.7 : 0.3); break;
      case 'dmg':
        hud.combatText(ev, F, my);
        if (ev.ab === 'auto' && F[ev.src] && !['rogue', 'warrior', 'berserker'].includes(F[ev.src].cls)) { /* ranged auto impact sound comes from 'hit' */ }
        else if (ev.ab === 'auto' || ['viper_strike', 'rending_blow', 'crippling_slash', 'gutting_edge', 'steel_tempest', 'skull_crack', 'shield_slam', 'rending_axes', 'headtaker', 'skull_leap'].includes(ev.ab)) audio.play(ev.crit || ev.big || ev.ab === 'rending_blow' ? 'melee_heavy' : 'melee_hit', pos(ev.id));
        if (ev.crit && (ev.src === my || ev.id === my)) audio.play('crit', pos(ev.id));
        if (!ev.dot && ev.amt > 0) world.onHitFlinch(ev.id, ev.crit);
        if (ev.id === my && ev.amt >= 90) world.addShake(Math.min(0.6, ev.amt / 400));
        if (ev.src === my && ev.crit) world.addShake(0.12);
        if (ev.big || ev.crit) world.arena.crowdHype = Math.min(1, world.arena.crowdHype + 0.3);
        break;
      case 'heal': case 'immune': hud.combatText(ev, F, my); if (ev.e === 'immune') audio.play('immune', pos(ev.id)); break;
      case 'buff':
        hud.combatText(ev, F, my);
        if (ev.type === 'stun' || ev.type === 'disorient') audio.play('stun', pos(ev.id));
        break;
      case 'interrupted': if (ev.id === my || ev.id === me?.target) hud.castInterrupted(ev.id === my); hud.combatText(ev, F, my); audio.play('interrupt', pos(ev.id)); break;
      case 'err': if (ev.id === my) { hud.error(ev.msg); audio.play('error'); } break;
      case 'blink': if (ev.fx === 'arcane_shift' || ev.fx === 'shadow_leap') audio.play('blink', { x: ev.x1, z: ev.z1 }); break;
      case 'dash': world.onDash(ev.id, ev.fx); break;
      case 'death': {
        audio.play('death', pos(ev.id)); world.addShake(0.5);
        const f = F[ev.id], k = F[ev.killer];
        if (f && F.length > 2) hud.announce(f.team === myTeam ? `${f.name} has fallen` : `${f.name} defeated`, f.team === myTeam ? 'kill red' : 'kill', false, k ? `by ${k.name}` : '');
        break; }
      case 'roundStart': hud.announce(`Round ${ev.round}`); S.lastCount = null; S.lastWinner = -1; break;
      case 'fight': hud.announce('Fight!'); audio.play('gong'); audio.play('crowd', null, { big: true }); world.arena.crowdHype = 1; break;
      case 'roundEnd':
        S.lastWinner = ev.winner;
        if (ev.winner === myTeam) { hud.announce('Round Won', '', false, `${ev.score[myTeam]} – ${ev.score[1 - myTeam]}`); audio.play('round_win'); }
        else if (ev.winner === -1) { hud.announce('Draw'); }
        else { hud.announce('Round Lost', 'red', false, `${ev.score[myTeam]} – ${ev.score[1 - myTeam]}`); audio.play('round_lose'); }
        audio.play('crowd', null, { big: true }); world.arena.crowdHype = 1;
        break;
      case 'matchEnd': {
        const won = ev.winner === myTeam;
        hud.announce(won ? 'Victory' : 'Defeat', won ? '' : 'red', true);
        if (won) world.celebrate(F.filter(f => f.team === myTeam));
        clearTimeout(S.endTimer);
        S.endTimer = setTimeout(() => { hud.clearAnnounce(); showMatchEnd(ev.winner); }, 2800);
        break; }
      case 'fx':
        if (ev.fx === 'quake_erupt') { audio.play('quake', { x: ev.x, z: ev.z }); world.addShake(0.6); }
        else if (ev.fx === 'death_mark_pop') { audio.play('mark_pop', { x: ev.x, z: ev.z }); world.addShake(0.3); }
        else if (ev.fx === 'spirit_cast') audio.play('spirit_bolt', pos(ev.id));
        else if (ev.fx === 'bull_rush_hit') { audio.play('melee_heavy', { x: ev.x, z: ev.z }); world.addShake(0.3); }
        break;
    }
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
  if (inp.jump) P.jump = true; if (inp.targetReq) P.targetReq = true; if (inp.attack) P.attack = true;
  if (inp.setTarget !== undefined) P.setTarget = inp.setTarget; if (inp.setFriend !== undefined) P.setFriend = inp.setFriend;
  const localInp = { ...inp, abilities: P.abilities, jump: !!P.jump, targetReq: !!P.targetReq, attack: !!P.attack, setTarget: P.setTarget, setFriend: P.setFriend };
  if (S.acc >= STEP) S.pend = null;
  let first = true, steps = 0;
  while (S.acc >= STEP && steps < maxSteps) {
    const inputs = [];
    for (const f of sim.fighters) {
      const id = f.id;
      if (id === S.myId) {
        inputs[id] = first ? localInp : { ...localInp, abilities: [], jump: false, targetReq: false, attack: false, setTarget: undefined, setFriend: undefined };
      } else if (S.ais.has(id)) inputs[id] = S.ais.get(id).getInput(STEP);
      else {
        const r = S.remotes.get(id);
        if (r && r.remote) {
          inputs[id] = { remote: r.remote };
          if (first) { Object.assign(inputs[id], { abilities: r.abs.splice(0), targetReq: r.targetReq, attack: r.attack, setTarget: r.setTarget, setFriend: r.setFriend }); r.targetReq = false; r.attack = false; r.setTarget = undefined; r.setFriend = undefined; }
        } else inputs[id] = { mx: 0, mz: 0, yaw: f.yaw, abilities: [] };
      }
    }
    sim.step(STEP, inputs);
    first = false; S.acc -= STEP; steps++;
  }
  if (steps >= maxSteps) S.acc = 0;
  const evs = sim.drainEvents();
  if (S.mode === 'host' && S.net) {
    if (evs.length) S.net.send({ t: 'ev', l: evs });
    S.snapT -= dt;
    if (S.snapT <= 0) { S.snapT = 0.05; S.net.send({ t: 'snap', s: sim.snapshot() }); }
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
  if (!canControl) { raw.mx = 0; raw.mz = 0; raw.jump = false; raw.sprint = false; raw.abilities = []; raw.attack = false; raw.friendKey = 0; }
  const dir = worldDir(raw);
  const pre = currentView();
  const meV = pre.fighters[S.myId];
  // click-targeting: the enemy under the crosshair / cursor becomes the target
  let setTarget, setFriend;
  if (raw.attack) { const pick = world.pickEnemy(pre, S.myId, raw.clickPos.x, raw.clickPos.y); if (pick >= 0) setTarget = pick; }
  if (raw.friendKey === 1) setFriend = S.myId;
  if (raw.friendKey === 2) {
    const allies = pre.fighters.filter(f => f.team === meV.team && f.id !== S.myId);
    setFriend = allies.length ? (meV.friend === allies[0].id && allies[1] ? allies[1].id : allies[0].id) : S.myId;
  }
  const local = { mx: raw.mx, mz: raw.mz, yaw: input.yaw, jump: raw.jump, sprint: raw.sprint, abilities: raw.abilities.map(i => ({ i, dir })), targetReq: raw.targetReq, attack: raw.attack, setTarget, setFriend };

  let view;
  if (S.mode === 'guest') {
    const L = S.local, last = S.lastSnap;
    const state = last ? last.s : 'countdown';
    if (L && L.alive !== false) {
      moveFighter(L, local, dt, pre.fighters, state === 'fight');
      if (state === 'countdown' && last) { L.x = last.f[S.myId].x; L.z = last.f[S.myId].z; }
    }
    S.sendT -= dt;
    if (local.abilities.length) S.sendT = 0; // an ability press must reach the host with our latest movement
    const net = S.net;
    if (net && S.sendT <= 0) { S.sendT = 1 / 30; net.send({ t: 'in', x: +L.x.toFixed(3), y: +L.y.toFixed(3), z: +L.z.toFixed(3), yaw: +L.yaw.toFixed(3), moving: L.moving, sprinting: L.sprinting, stamina: Math.round(L.stamina), ack: S.ack }); }
    if (net) {
      if (setTarget !== undefined || setFriend !== undefined) net.send({ t: 'sel', tid: setTarget, fid: setFriend });
      for (const a of local.abilities) net.send({ t: 'ab', i: a.i, dir: a.dir });
      if (local.targetReq) net.send({ t: 'tg' });
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
  // when dead in 2v2, follow a living teammate
  const ally = !me.alive ? view.fighters.find(f => f.team === me.team && f.alive && f.id !== me.id) : null;
  $('spectate').classList.toggle('hidden', !(ally && view.state === 'fight'));
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
window.__rf = { world, S, CLASSES, input, audio, hud, tick: dt => { if (S.inGame) gameFrame(dt); }, startMatch };
requestAnimationFrame(frame);
