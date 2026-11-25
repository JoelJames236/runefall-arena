// Runefall Arena — app entry: screens, match flow, game loop, and network glue.
import { World } from './render/world.js';
import { HUD, iconHTML } from './ui/hud.js';
import { Input } from './input.js';
import { Audio, AB_SOUND, HIT_SOUND, CAST_SOUND } from './audio.js';
import { Sim, moveFighter, RULES } from './sim/sim.js';
import { AI } from './sim/ai.js';
import { Net } from './net.js';
import { CLASSES, CLASS_ORDER } from './data/classes.js';

const $ = id => document.getElementById(id);
const STEP = 1 / 60;

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
  screen: 'splash', mode: null, sim: null, ai: null, net: null, myId: 0,
  myCls: localStorage.getItem('runefall-class') || 'mage', difficulty: localStorage.getItem('runefall-diff') || 'normal',
  csMode: 'ai', inGame: false, paused: false, acc: 0, names: ['You', 'Enemy'],
  lobby: { ready: false, oppCls: null, oppReady: false }, rematch: { me: false, opp: false },
  // guest-side
  local: null, snaps: [], lastSnap: null, ack: 0, lastForceYaw: -1, sendT: 0,
  // host-side
  remote: null, remoteAbs: [], remoteTarget: false, snapT: 0,
  lastCount: null, lastWinner: -1, endTimer: null, lastFrame: performance.now(),
};

function applySettings() {
  audio.setVolumes(settings.music / 100, settings.sfx / 100);
  input.sens = settings.sens / 100; input.invert = settings.invert;
  if (world.quality !== settings.quality) world.setQuality(settings.quality);
  $('fps').classList.toggle('hidden', !settings.fps);
}
applySettings();

// ------------------------------------------------------------------ screens
function show(id) {
  S.screen = id;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
}
function showOverlay(id, v) { $(id).classList.toggle('active', v); }
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); }

document.addEventListener('click', e => { if (e.target.closest('button')) audio.play('ui_click'); });
document.addEventListener('mouseover', e => { const b = e.target.closest('button, .cs-card'); if (b && b !== S._hov) { S._hov = b; audio.play('ui_hover'); } });

// splash
const joinParam = new URLSearchParams(location.search).get('join');
if (joinParam) $('loadmsg').textContent = `You have been invited to a duel (room ${joinParam.toUpperCase()}).`;
$('splash').addEventListener('click', () => {
  audio.init(); applySettings(); audio.setTrack('menu');
  if (joinParam) { show('join'); $('joinCode').value = joinParam.toUpperCase(); startJoin(joinParam); }
  else show('menu');
});

// main menu
$('menu').addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
  if (act === 'play') openClassSelect('ai');
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
  $('csTitle').textContent = mode === 'browse' ? 'The Champions' : mode === 'online' ? 'Prepare for the Duel' : 'Choose Your Champion';
  $('csDifficulty').classList.toggle('hidden', mode !== 'ai');
  $('csLobby').classList.toggle('hidden', mode !== 'online');
  $('csConfirm').classList.toggle('hidden', mode === 'browse');
  document.querySelectorAll('#csDifficulty .chip').forEach(c => c.classList.toggle('on', c.dataset.diff === S.difficulty));
  const list = $('csList'); list.innerHTML = '';
  for (const id of CLASS_ORDER) {
    const C = CLASSES[id];
    const el = document.createElement('div'); el.className = 'cs-card'; el.dataset.cls = id;
    el.innerHTML = `<div class="emblem" style="border-color:${C.color};color:${C.color};background:radial-gradient(circle at 40% 35%, ${C.color}44, #120c18 75%)">${C.emblem}</div><div><div class="cname" style="color:${C.color}">${C.name}</div><div class="crole">${C.role}</div></div>`;
    el.addEventListener('click', () => selectClass(id));
    list.appendChild(el);
  }
  if (mode === 'online') { S.lobby.ready = false; updateLobbyPanel(); }
  selectClass(S.myCls);
  updateConfirm();
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
  $('csDetails').innerHTML = `
    <h3 style="color:${C.color}">${C.name}</h3>
    <div class="role">${C.role}</div>
    <p>${C.desc}</p>
    <div class="gear"><b>Weapon:</b> ${C.weapon}<br><b>Armor:</b> ${C.armor}<br><b>Resource:</b> ${resName} (${C.res})</div>
    ${statRow('Health', C.rating.health, C.hp)}
    ${statRow('Damage', C.rating.damage, ['', 'Low', 'Low-Med', 'Medium', 'Med-High', 'High'][C.rating.damage])}
    ${statRow('Mobility', C.rating.mobility, C.speed.toFixed(1))}
    ${statRow('Defense', C.rating.defense, Math.round(C.defense * 100) + '%')}
    <div class="abilities">${C.abilities.map((ab, i) => `
      <div class="ab-row" data-i="${i}" style="cursor:pointer">${iconHTML(ab)}
        <div><div class="aname" style="color:${ab.color}">${i + 1}. ${ab.name}</div>
        <div class="meta">${[ab.cost ? `${ab.cost} ${resName}` : 'No cost', ab.cast ? `${ab.cast}s cast` : 'Instant', ab.cd ? `${ab.cd}s cooldown` : '', ab.range ? `${ab.range} yd` : ''].filter(Boolean).join(' · ')}</div>
        <div class="adesc">${ab.desc}</div></div></div>`).join('')}
    </div>`;
  $('csDetails').querySelectorAll('.ab-row').forEach(r => r.addEventListener('click', () => {
    const ab = C.abilities[+r.dataset.i];
    world.previewAbility(ab);
    audio.play(AB_SOUND[ab.id]);
  }));
  if (S.csMode === 'online' && S.net) { S.lobby.ready = false; S.net.send({ t: 'pick', cls: id }); S.net.send({ t: 'ready', v: false }); updateLobbyPanel(); }
  updateConfirm();
}

document.querySelectorAll('#csDifficulty .chip').forEach(c => c.addEventListener('click', () => {
  S.difficulty = c.dataset.diff; localStorage.setItem('runefall-diff', S.difficulty);
  document.querySelectorAll('#csDifficulty .chip').forEach(x => x.classList.toggle('on', x === c));
}));

function updateConfirm() {
  const b = $('csConfirm');
  if (S.csMode === 'online') { b.textContent = S.lobby.ready ? 'Cancel Ready' : 'Ready'; b.disabled = !S.net || !S.net.connected; }
  else { b.textContent = 'Enter the Arena'; b.disabled = false; }
}

$('csBack').addEventListener('click', () => {
  if (S.csMode === 'online') leaveOnline('You left the match.');
  else { world.showMenuScene(); show('menu'); }
});
$('csConfirm').addEventListener('click', () => {
  if (S.csMode === 'ai') {
    const foe = CLASS_ORDER.filter(c => c !== S.myCls)[Math.floor(Math.random() * 4)];
    S.names = ['You', `${CLASSES[foe].name} AI`];
    startMatch(S.myCls, foe, 'ai');
  } else if (S.csMode === 'online') {
    S.lobby.ready = !S.lobby.ready;
    S.net.send({ t: 'ready', v: S.lobby.ready });
    updateLobbyPanel(); updateConfirm();
    hostMaybeStart();
  }
});

function updateLobbyPanel() {
  const L = S.lobby;
  const opp = L.oppCls ? CLASSES[L.oppCls] : null;
  $('csLobby').innerHTML = `<div class="who"><span>You — <b style="color:${CLASSES[S.myCls].color}">${CLASSES[S.myCls].name}</b></span><span class="${L.ready ? 'ok' : 'wait'}">${L.ready ? '✔ Ready' : 'Choosing'}</span></div>
    <div class="who"><span>Opponent — ${opp ? `<b style="color:${opp.color}">${opp.name}</b>` : '<i>…</i>'}</span><span class="${L.oppReady ? 'ok' : 'wait'}">${L.oppReady ? '✔ Ready' : 'Choosing'}</span></div>
    <div class="muted" style="margin-top:6px;font-size:14px">Room ${S.net?.code || ''}</div>`;
}

// ------------------------------------------------------------------ online: host / join
function startHost() {
  closeNet();
  show('lobby');
  $('roomCode').textContent = '······'; $('roomLink').value = ''; $('lobbyStatus').textContent = 'Opening the arena gates…';
  const net = S.net = new Net();
  bindNetCommon(net);
  net.host(code => {
    $('roomCode').textContent = code;
    const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('join', code);
    $('roomLink').value = url.toString();
    $('lobbyStatus').textContent = 'Waiting for an opponent to join…';
  });
  net.on('connected', () => {
    $('lobbyStatus').textContent = 'Opponent joined!';
    S.lobby = { ready: false, oppCls: null, oppReady: false };
    net.send({ t: 'welcome' });
    setTimeout(() => { if (S.net === net) { S.names = ['You', 'Opponent']; openClassSelect('online'); net.send({ t: 'pick', cls: S.myCls }); } }, 500);
  });
}
$('copyLink').addEventListener('click', () => { navigator.clipboard?.writeText($('roomLink').value).then(() => toast('Invite link copied!'), () => { $('roomLink').select(); toast('Press Ctrl+C to copy'); }); });
$('lobbyBack').addEventListener('click', () => { closeNet(); show('menu'); });

function startJoin(code) {
  code = (code || '').trim().toUpperCase();
  if (code.length < 4) { $('joinStatus').textContent = 'Enter a valid room code.'; return; }
  closeNet();
  $('joinStatus').textContent = 'Connecting to the arena…';
  const net = S.net = new Net();
  bindNetCommon(net);
  net.join(code, () => {
    $('joinStatus').textContent = 'Connected!';
    S.lobby = { ready: false, oppCls: null, oppReady: false };
    S.names = ['Opponent', 'You'];
    openClassSelect('online');
    net.send({ t: 'pick', cls: S.myCls });
  });
}
$('joinGo').addEventListener('click', () => startJoin($('joinCode').value));
$('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') startJoin($('joinCode').value); });
$('joinBack').addEventListener('click', () => { closeNet(); show('menu'); });

function bindNetCommon(net) {
  net.on('error', type => {
    if (S.net !== net) return;
    const msg = { 'peer-unavailable': 'Room not found. Check the code and make sure your friend is still hosting.', timeout: 'Could not reach that room (timed out).', network: 'Network error — check your connection.', 'browser-incompatible': 'Your browser does not support WebRTC.' }[type] || `Connection error (${type}).`;
    if (S.screen === 'join') $('joinStatus').textContent = msg;
    else if (S.screen === 'lobby') $('lobbyStatus').textContent = msg;
    else if (!S.inGame) toast(msg);
  });
  net.on('full', () => { $('joinStatus').textContent = 'That match is already full.'; });
  net.on('disconnected', () => { if (S.net === net) leaveOnline('Your opponent disconnected.'); });
  net.on('pick', m => { S.lobby.oppCls = m.cls; updateLobbyPanel(); });
  net.on('ready', m => { S.lobby.oppReady = m.v; updateLobbyPanel(); hostMaybeStart(); });
  net.on('start', m => { if (net.role === 'guest') { S.names = ['Opponent', 'You']; startMatch(m.a, m.b, 'guest'); } });
  net.on('snap', m => onSnapshot(m.s));
  net.on('ev', m => { if (S.inGame && S.mode === 'guest') handleEvents(m.l, buildGuestView()); });
  net.on('in', m => { S.remote = m; });
  net.on('ab', m => { S.remoteAbs.push({ i: m.i, dir: m.dir }); });
  net.on('tg', () => { S.remoteTarget = true; });
  net.on('rematch', () => { S.rematch.opp = true; $('endStatus').textContent = 'Your opponent wants a rematch!'; hostMaybeRematch(); });
  net.on('lobby', () => { if (S.inGame || S.screen !== 'classSelect') backToLobby(false); });
  net.on('leave', () => leaveOnline('Your opponent left the match.'));
}

function hostMaybeStart() {
  const net = S.net;
  if (!net || net.role !== 'host' || !S.lobby.ready || !S.lobby.oppReady || !S.lobby.oppCls || S.inGame) return;
  net.send({ t: 'start', a: S.myCls, b: S.lobby.oppCls });
  S.names = ['You', 'Opponent'];
  startMatch(S.myCls, S.lobby.oppCls, 'host');
}
function hostMaybeRematch() {
  if (!S.net || S.net.role !== 'host' || !S.rematch.me || !S.rematch.opp) return;
  S.net.send({ t: 'start', a: S.sim.fighters[0].cls, b: S.sim.fighters[1].cls });
  startMatch(S.sim.fighters[0].cls, S.sim.fighters[1].cls, 'host');
}

function backToLobby(notify) {
  if (notify && S.net) S.net.send({ t: 'lobby' });
  endGame();
  S.lobby.ready = false; S.lobby.oppReady = false;
  openClassSelect('online');
  S.net && S.net.send({ t: 'pick', cls: S.myCls });
}

function closeNet() { if (S.net) { S.net.close(); S.net = null; } }
function leaveOnline(msg) {
  if (S.net) { S.net.send({ t: 'leave' }); }
  closeNet();
  endGame();
  world.showMenuScene();
  show('menu');
  audio.setTrack('menu');
  if (msg) toast(msg, 3500);
}

// ------------------------------------------------------------------ match lifecycle
function startMatch(clsA, clsB, mode) {
  clearTimeout(S.endTimer);
  S.mode = mode; S.inGame = true; S.paused = false; S.acc = 0;
  S.myId = mode === 'guest' ? 1 : 0;
  S.lastCount = null; S.lastWinner = -1; S.rematch = { me: false, opp: false };
  S.remote = null; S.remoteAbs = []; S.snaps = []; S.lastSnap = null; S.ack = 0; S.lastForceYaw = -1;
  if (mode === 'guest') {
    S.sim = null;
    S.local = { id: 1, cls: clsB, x: 0, y: 0, z: 20, vy: 0, yaw: Math.PI, stamina: 100, buffs: [], alive: true, locked: false, moving: false };
  } else {
    S.sim = new Sim(clsA, clsB);
    S.ai = mode === 'ai' ? new AI(S.sim, 1, S.difficulty) : null;
  }
  world.setFighters(clsA, clsB);
  const v = currentView();
  hud.setup(v.fighters, S.myId, S.names);
  hud.show(true); hud.clearAnnounce();
  show(null); showOverlay('pause', false); showOverlay('matchEnd', false);
  input.enabled = true; input.yaw = S.myId === 0 ? 0 : Math.PI; input.pitch = 0.3; input.keys.clear();
  world.camPos.set(0, 6, S.myId === 0 ? -30 : 30);
  audio.setTrack('arena');
  input.requestLock();
  $('lockHint').classList.add('hidden');
}

function endGame() {
  S.inGame = false; S.sim = null; S.ai = null; S.local = null;
  input.enabled = false; input.exitLock();
  hud.show(false);
  showOverlay('pause', false); showOverlay('matchEnd', false);
  clearTimeout(S.endTimer);
}

input.onEscape = () => {
  if (!S.inGame || input.locked) return; // when locked, the browser releases the lock and onUnlock fires
  if ($('pause').classList.contains('active')) { showOverlay('pause', false); S.paused = false; }
  else if (!$('matchEnd').classList.contains('active')) openPause();
};
input.onFallback = () => toast('Mouse capture unavailable here — hold a mouse button and drag to look around.', 5000);
input.onUnlock = () => {
  if (!S.inGame || S.screen === 'settings' || S.screen === 'howto' || $('matchEnd').classList.contains('active')) return;
  openPause();
};
function openPause() {
  if (S.mode === 'ai') S.paused = true;
  $('pauseNote').textContent = S.mode === 'ai' ? 'The duel is paused.' : 'Online match — the fight continues while this menu is open!';
  showOverlay('pause', true);
}
$('pauseResume').addEventListener('click', () => { showOverlay('pause', false); S.paused = false; input.requestLock(); });
$('pauseSettings').addEventListener('click', () => openSettings('pause'));
$('pauseHowto').addEventListener('click', () => { S.howtoBack = 'pause'; showOverlay('pause', false); show('howto'); });
$('pauseLeave').addEventListener('click', () => {
  if (S.mode === 'ai') { endGame(); world.showMenuScene(); show('menu'); audio.setTrack('menu'); }
  else leaveOnline();
});
canvas.addEventListener('click', () => { if (S.inGame && !input.active && !$('pause').classList.contains('active') && !$('matchEnd').classList.contains('active')) input.requestLock(); });

function showMatchEnd(winner) {
  const won = winner === S.myId;
  input.exitLock();
  showOverlay('pause', false);
  const t = $('endTitle'); t.textContent = won ? 'Victory' : 'Defeat'; t.classList.toggle('defeat', !won);
  const v = currentView();
  $('endScore').textContent = `${v.score[S.myId]} – ${v.score[1 - S.myId]}`;
  const F = v.fighters, me = F[S.myId], foe = F[1 - S.myId];
  const st = f => f.stats || { dmg: 0, heal: 0, absorbed: 0, ccs: 0, interrupts: 0 };
  const a = st(me), b = st(foe);
  $('endStats').innerHTML = `<span class="h"></span><span class="h">${S.names[S.myId]}</span><span class="h">${S.names[1 - S.myId]}</span>
    <span>Damage dealt</span><span>${a.dmg}</span><span>${b.dmg}</span>
    <span>Healing done</span><span>${a.heal}</span><span>${b.heal}</span>
    <span>Damage absorbed</span><span>${a.absorbed}</span><span>${b.absorbed}</span>
    <span>Crowd control applied</span><span>${a.ccs}</span><span>${b.ccs}</span>
    <span>Interrupts</span><span>${a.interrupts}</span><span>${b.interrupts}</span>`;
  $('endStatus').textContent = '';
  $('endRematch').disabled = false;
  showOverlay('matchEnd', true);
  audio.play(won ? 'victory' : 'defeat');
  audio.play('crowd', null, { big: true });
  setTimeout(() => { if (!S.inGame || $('matchEnd').classList.contains('active')) audio.setTrack('menu'); }, 4500);
}
$('endRematch').addEventListener('click', () => {
  if (S.mode === 'ai') { startMatch(S.sim.fighters[0].cls, S.sim.fighters[1].cls, 'ai'); return; }
  S.rematch.me = true; $('endRematch').disabled = true;
  $('endStatus').textContent = S.rematch.opp ? 'Starting…' : 'Waiting for your opponent…';
  S.net.send({ t: 'rematch' });
  hostMaybeRematch();
});
$('endClass').addEventListener('click', () => {
  if (S.mode === 'ai') { endGame(); openClassSelect('ai'); audio.setTrack('menu'); }
  else { backToLobby(true); audio.setTrack('menu'); }
});
$('endMenu').addEventListener('click', () => {
  if (S.mode === 'ai') { endGame(); world.showMenuScene(); show('menu'); audio.setTrack('menu'); }
  else leaveOnline();
});

// ------------------------------------------------------------------ views
function currentView() {
  if (S.mode === 'guest') return buildGuestView();
  const sim = S.sim;
  return { fighters: sim.fighters, projectiles: sim.projectiles, zones: sim.zones, state: sim.state, stateT: sim.stateT, round: sim.round, score: sim.score, fightT: sim.fightT, damp: sim.damp, lastWinner: S.lastWinner };
}

function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }

function buildGuestView() {
  const snaps = S.snaps;
  const last = S.lastSnap;
  if (!last) {
    const L = S.local;
    const dummy = cls => ({ cls, x: 0, y: 0, z: -20, yaw: 0, hp: CLASSES[cls].hp, maxHp: CLASSES[cls].hp, res: CLASSES[cls].res, maxRes: CLASSES[cls].res, resType: CLASSES[cls].resType, cds: [0, 0, 0, 0, 0, 0], gcd: 0, cast: null, buffs: [], cp: 0, alive: true, stamina: 100, target: 1, id: 0 });
    return { fighters: [dummy(world.chars[0]?.cls || 'mage'), { ...dummy(L.cls), ...L }], projectiles: [], zones: [], state: 'countdown', stateT: 3, round: 1, score: [0, 0], fightT: 0, damp: 0, lastWinner: -1 };
  }
  // interpolate the opponent & projectiles ~100ms in the past
  const rt = performance.now() - 100;
  let a = snaps[0], b = snaps[snaps.length - 1];
  for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].t <= rt && snaps[i + 1].t >= rt) { a = snaps[i]; b = snaps[i + 1]; break; }
  const u = b.t > a.t ? Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t))) : 1;
  const oa = a.s.f[0], ob = b.s.f[0];
  const opp = { ...last.f[0], id: 0, x: oa.x + (ob.x - oa.x) * u, y: oa.y + (ob.y - oa.y) * u, z: oa.z + (ob.z - oa.z) * u, yaw: lerpAngle(oa.yaw, ob.yaw, u) };
  const L = S.local;
  const me = { ...last.f[1], id: 1, x: L.x, y: L.y, z: L.z, yaw: L.yaw, stamina: L.stamina };
  const pa = new Map(a.s.p.map(p => [p.id, p]));
  const projectiles = b.s.p.map(p => { const q = pa.get(p.id); return q ? { ...p, x: q.x + (p.x - q.x) * u, y: q.y + (p.y - q.y) * u, z: q.z + (p.z - q.z) * u } : p; });
  const age = (performance.now() - S.lastSnapT) / 1000;
  const zones = last.z.map(z => ({ ...z, t: Math.min(z.dur, z.t + age) }));
  return { fighters: [opp, me], projectiles, zones, state: last.s, stateT: last.st - age, round: last.r, score: last.sc, fightT: last.ft + (last.s === 'fight' ? age : 0), damp: last.dp, lastWinner: S.lastWinner };
}

function onSnapshot(s) {
  if (!S.inGame || S.mode !== 'guest') return;
  const now = performance.now();
  S.snaps.push({ t: now, s }); if (S.snaps.length > 12) S.snaps.shift();
  S.lastSnap = s; S.lastSnapT = now;
  const me = s.f[1], L = S.local;
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
  const F = view.fighters, my = S.myId;
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
      case 'auto': world.onAuto(ev.id); audio.play(F[ev.id].cls === 'rogue' ? 'dagger' : 'swing', pos(ev.id)); break;
      case 'hit': audio.play(HIT_SOUND[ev.kind] || 'fire_hit', { x: ev.x, z: ev.z }); if (ev.kind === 'arcane_comet') world.addShake(ev.id === my ? 0.7 : 0.3); break;
      case 'dmg':
        hud.combatText(ev, F, my);
        if (ev.ab === 'auto' || ['viper_strike', 'rending_blow', 'crippling_slash', 'gutting_edge', 'steel_tempest', 'skull_crack', 'shield_slam'].includes(ev.ab)) audio.play(ev.big || ev.ab === 'rending_blow' ? 'melee_heavy' : 'melee_hit', pos(ev.id));
        if (!ev.dot && ev.amt > 0) world.onHitFlinch(ev.id);
        if (ev.id === my && ev.amt >= 100) world.addShake(Math.min(0.6, ev.amt / 400));
        if (ev.big) world.arena.crowdHype = Math.min(1, world.arena.crowdHype + 0.4);
        break;
      case 'heal': case 'immune': hud.combatText(ev, F, my); if (ev.e === 'immune') audio.play('immune', pos(ev.id)); break;
      case 'buff':
        hud.combatText(ev, F, my);
        if (ev.type === 'stun' || ev.type === 'disorient') audio.play('stun', pos(ev.id));
        break;
      case 'interrupted': hud.castInterrupted(ev.id === my); hud.combatText(ev, F, my); audio.play('interrupt', pos(ev.id)); break;
      case 'err': if (ev.id === my) { hud.error(ev.msg); audio.play('error'); } break;
      case 'blink': if (ev.fx === 'arcane_shift' || ev.fx === 'shadow_leap') audio.play('blink', { x: ev.x1, z: ev.z1 }); break;
      case 'dash': world.onDash(ev.id, ev.fx); break;
      case 'death': audio.play('death', pos(ev.id)); world.addShake(0.5); break;
      case 'roundStart': hud.announce(`Round ${ev.round}`); S.lastCount = null; S.lastWinner = -1; break;
      case 'fight': hud.announce('Fight!'); audio.play('gong'); audio.play('crowd', null, { big: true }); world.arena.crowdHype = 1; break;
      case 'roundEnd':
        S.lastWinner = ev.winner;
        if (ev.winner === my) { hud.announce('Round Won'); audio.play('round_win'); }
        else if (ev.winner === -1) { hud.announce('Draw'); }
        else { hud.announce('Round Lost', 'red'); audio.play('round_lose'); }
        audio.play('crowd', null, { big: true }); world.arena.crowdHype = 1;
        break;
      case 'matchEnd':
        hud.announce(ev.winner === my ? 'Victory' : 'Defeat', ev.winner === my ? '' : 'red', true);
        clearTimeout(S.endTimer);
        S.endTimer = setTimeout(() => { hud.clearAnnounce(); showMatchEnd(ev.winner); }, 2600);
        break;
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
function tickSim(dt, localInp, maxSteps = 5) {
  const sim = S.sim;
  S.acc += dt;
  let first = true, steps = 0;
  while (S.acc >= STEP && steps < maxSteps) {
    const inputs = [];
    const mine = { ...localInp, abilities: first ? localInp.abilities : [], jump: first && localInp.jump, targetReq: first && localInp.targetReq };
    inputs[S.myId] = mine;
    if (S.mode === 'ai') inputs[1] = S.ai.getInput(STEP);
    else {
      const f1 = sim.fighters[1];
      inputs[1] = S.remote ? { remote: S.remote, abilities: first ? S.remoteAbs.splice(0) : [], targetReq: first && S.remoteTarget } : { mx: 0, mz: 0, yaw: f1.yaw, abilities: [] };
      if (first) S.remoteTarget = false;
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
  let dt = Math.min(0.05, (now - S.lastFrame) / 1000);
  S.lastFrame = now;
  fpsCounter(dt);
  if (S.inGame) gameFrame(dt);
  world.render(dt);
}

function gameFrame(dt) {
  const raw = input.poll();
  const overlay = $('pause').classList.contains('active') || $('matchEnd').classList.contains('active');
  const canControl = input.active && !overlay;
  if (!canControl) { raw.mx = 0; raw.mz = 0; raw.jump = false; raw.sprint = false; raw.abilities = []; }
  const dir = worldDir(raw);
  const local = { mx: raw.mx, mz: raw.mz, yaw: input.yaw, jump: raw.jump, sprint: raw.sprint, abilities: raw.abilities.map(i => ({ i, dir })), targetReq: raw.targetReq };

  let view;
  if (S.mode === 'guest') {
    const L = S.local, last = S.lastSnap;
    const opp = last ? buildGuestView().fighters[0] : null;
    const state = last ? last.s : 'countdown';
    if (L && L.alive !== false) {
      moveFighter(L, local, dt, opp, state === 'fight');
      if (state === 'countdown' && last) { L.x = last.f[1].x; L.z = last.f[1].z; }
    }
    S.sendT -= dt;
    // an ability press must reach the host together with our latest movement state
    if (local.abilities.length) S.sendT = 0;
    if (S.net && S.sendT <= 0) { S.sendT = 1 / 30; S.net.send({ t: 'in', x: +L.x.toFixed(3), y: +L.y.toFixed(3), z: +L.z.toFixed(3), yaw: +L.yaw.toFixed(3), moving: L.moving, sprinting: L.sprinting, stamina: Math.round(L.stamina), ack: S.ack }); }
    for (const a of local.abilities) S.net && S.net.send({ t: 'ab', i: a.i, dir: a.dir });
    if (local.targetReq) S.net && S.net.send({ t: 'tg' });
    view = buildGuestView();
  } else {
    let evs = [];
    if (!S.paused) evs = tickSim(dt, local);
    view = currentView();
    // camera follows forced facing changes (shadow leap, charge, round reset)
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
  audio.listener = { x: me.x, z: me.z, yaw: input.yaw };
  world.updateGame(dt, view, S.myId, input);
  hud.update(dt, view, world.camera, S.myId);
  $('lockHint').classList.toggle('hidden', input.active || $('pause').classList.contains('active') || $('matchEnd').classList.contains('active'));
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
function fpsCounter(dt) { if (!settings.fps) return; fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { $('fps').textContent = Math.round(fpsN / fpsAcc) + ' fps'; fpsAcc = 0; fpsN = 0; } }

world.showMenuScene();
// debug handle (used for automated testing; harmless in production)
window.__rf = { world, S, CLASSES, input, audio, hud, tick: dt => { if (S.inGame) gameFrame(dt); } };
requestAnimationFrame(frame);
