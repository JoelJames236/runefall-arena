// In-game interface: unit frames (player / target / party / arena enemies), action bar with
// cooldown sweeps and a basic-attack swing timer, cast bars, round score, nameplates,
// floating combat text (with crits) and announcements. DOM writes are cached so the HUD
// costs almost nothing per frame.
import * as THREE from 'three';
import { CLASSES, BUFF_ICONS, kitOf } from '../data/classes.js';
import { RULES, segBlocked, rangeDist } from '../sim/sim.js';

const $ = id => document.getElementById(id);
const SCHOOL = { frost: '#8fd8ff', fire: '#ff9a4a', arcane: '#d29aff', holy: '#ffe680', nature: '#7ae0ff', shadow: '#c08aff', phys: '#ffffff' };
const RES_NAME = { mana: 'Mana', energy: 'Energy', rage: 'Rage' };

export function iconHTML(ab, size) {
  const c = ab.color;
  return `<div class="icon" style="${size ? `width:${size}px;height:${size}px;font-size:${size * 0.52}px;` : ''}background:radial-gradient(circle at 35% 30%, ${c}dd, ${c}55 45%, #120c18 100%);color:${c}"><span class="glyph">${ab.glyph}</span></div>`;
}
export function emblemStyle(C) { return `border-color:${C.color};color:${C.color};background:radial-gradient(circle at 40% 35%, ${C.color}55, #120c18 75%)`; }

// cached DOM setters
const cache = new WeakMap();
function setStyle(el, prop, v) { let c = cache.get(el); if (!c) cache.set(el, c = {}); if (c[prop] !== v) { c[prop] = v; el.style[prop] = v; } }
function setText(el, v) { let c = cache.get(el); if (!c) cache.set(el, c = {}); if (c._t !== v) { c._t = v; el.textContent = v; } }
function setCls(el, cls, on) { let c = cache.get(el); if (!c) cache.set(el, c = {}); const k = 'c_' + cls; if (c[k] !== on) { c[k] = on; el.classList.toggle(cls, on); } }

function buffsHTML(list, small) {
  return list.map(b => {
    const meta = BUFF_ICONS[b.type] || { icon: '?', color: '#888' };
    return `<div class="buff ${meta.debuff ? 'debuff' : ''}" title="${b.name}" style="background:radial-gradient(circle at 35% 30%, ${meta.color}aa, #120c18 90%)">${b.icon || meta.icon}${small ? '' : `<b>${b.t < 60 ? Math.ceil(b.t) : ''}</b>`}</div>`;
  }).join('');
}

export class HUD {
  constructor() {
    this.root = $('hud');
    this.floaters = $('floaters');
    this.texts = [];
    this.errT = 0;
    this.v = new THREE.Vector3();
    this.plates = [];
    this.lastBuffKey = {};
  }

  show(v) { this.root.classList.toggle('hidden', !v); for (const p of this.plates) p.el.style.display = 'none'; if (!v) this.clearTexts(); }

  setup(fighters, myId) {
    this.myId = myId;
    const me = fighters[myId], CM = kitOf(me);
    this.myTeam = me.team;
    setText($('nameA'), me.name); setText($('classA'), `${CM.specIcon || ''} ${CM.specName || ''} ${CM.name}`.trim());
    const pA = $('portA'); pA.firstChild && pA.firstChild.nodeType === 3 && pA.removeChild(pA.firstChild);
    pA.innerHTML = `${CM.emblem}<span class="lvl">60</span>`; pA.style.cssText = emblemStyle(CM) + ';font-size:34px';
    $('resA').className = 'fill res-' + me.resType;
    const two = fighters.length > 2;
    setText($('scoreNameA'), two ? 'Your Team' : me.name);
    const foes = fighters.filter(f => f.team !== me.team);
    setText($('scoreNameB'), two ? 'Enemy Team' : foes[0]?.name || 'Enemy');
    // nameplates for everyone but me
    for (const p of this.plates) p.el.remove();
    this.plates = fighters.map(f => {
      if (f.id === myId) return null;
      const el = document.createElement('div');
      el.className = 'nameplate ' + (f.team === me.team ? 'ally' : 'foe');
      el.innerHTML = `<div class="np-name">${f.name}</div><div class="np-bar"><div></div></div><div class="np-cast"><div></div></div>`;
      this.floaters.appendChild(el);
      return { el, bar: el.querySelector('.np-bar div'), cast: el.querySelector('.np-cast'), castFill: el.querySelector('.np-cast div') };
    }).filter(Boolean).map((p, i, arr) => p);
    this.plateFor = {};
    let k = 0; for (const f of fighters) if (f.id !== myId) this.plateFor[f.id] = this.plates[k++];
    // party (allies) and arena (enemies) mini frames
    const mini = (f, kind, key) => `<div class="mini ${kind}" data-id="${f.id}"><span class="mkey">${key}</span><div class="mic" style="${emblemStyle(kitOf(f))}">${kitOf(f).emblem}</div>
      <div><div class="mname"><span>${f.name}</span><i>${kitOf(f).specIcon || ''} ${kitOf(f).name}</i></div><div class="bar hp"><div class="fill"></div><span></span></div><div class="bar res"><div class="fill res-${f.resType}"></div></div><div class="mcast"><div></div></div><div class="mbuffs"></div></div></div>`;
    const allies = fighters.filter(f => f.team === me.team && f.id !== myId);
    $('partyFrames').innerHTML = allies.map(f => mini(f, 'ally', 'F2')).join('');
    $('arenaFrames').innerHTML = two ? foes.map((f, i) => mini(f, 'foe', 'Arena ' + (i + 1))).join('') : '';
    this.minis = [...document.querySelectorAll('#partyFrames .mini, #arenaFrames .mini')].map(el => ({
      el, id: +el.dataset.id, hp: el.querySelector('.bar.hp .fill'), hpt: el.querySelector('.bar.hp span'), res: el.querySelector('.bar.res .fill'), cast: el.querySelector('.mcast div'), buffs: el.querySelector('.mbuffs'),
    }));
    // action bar: basic attack + six abilities
    const bar = $('actionbar'); bar.innerHTML = '';
    const tip = (ab, meta) => `<div class="tip"><div class="tn" style="color:${ab.color}">${ab.name}</div><div class="tm">${meta}</div>${ab.desc}</div>`;
    const A = CM.auto;
    const atk = document.createElement('div'); atk.className = 'slot atk';
    atk.innerHTML = `${iconHTML(A)}<div class="cd"></div><div class="cdtext"></div><div class="key">LMB</div>${tip(A, `${A.ranged ? A.range + ' yd' : 'Melee'} · ${A.speed}s attack speed`)}`;
    bar.appendChild(atk);
    this.atkSlot = { el: atk, cd: atk.querySelector('.cd') };
    this.slots = CM.abilities.map((ab, i) => {
      const s = document.createElement('div'); s.className = 'slot';
      const meta = [ab.cost ? `${ab.cost} ${RES_NAME[CM.resType]}` : 'No cost', ab.cast ? `${ab.cast}s cast` : 'Instant', ab.cd ? `${ab.cd}s cooldown` : '', ab.range ? `${ab.range} yd` : ''].filter(Boolean).join(' · ');
      s.innerHTML = `${iconHTML(ab)}<div class="cd"></div><div class="cdtext"></div><div class="key">${i + 1}</div><div class="cost">${ab.cost || ''}</div>${ab.charges ? '<div class="chg"></div>' : ''}${tip(ab, meta)}`;
      bar.appendChild(s);
      return { el: s, cd: s.querySelector('.cd'), txt: s.querySelector('.cdtext'), chg: s.querySelector('.chg'), ab, wasCd: false };
    });
    const pips = () => Array.from({ length: RULES.winsNeeded }, () => '<div class="pip"></div>').join('');
    $('pipsA').innerHTML = pips(); $('pipsB').innerHTML = pips();
    $('cpA').style.display = me.cls === 'rogue' || me.cls === 'berserker' ? '' : 'none';
    $('cpA').innerHTML = me.cls === 'berserker' ? '<span class="bloodrage"></span>' : '<i></i>'.repeat(5);
    this.lastBuffKey = {};
    this.hintT = 14; $('controlsHint').style.opacity = 1;
  }

  flashSlot(i) { const s = this.slots && this.slots[i]; if (!s) return; s.el.classList.remove('flash'); void s.el.offsetWidth; s.el.classList.add('flash'); }

  update(dt, view, camera, myId) {
    const F = view.fighters, me = F[myId];
    if (!me) return;
    const tgt = me.target >= 0 ? F[me.target] : null;
    const tgtVisible = tgt && tgt.alive && tgt.team !== me.team && !tgt.buffs.some(b => b.type === 'stealth');
    this.frame('A', me, 'A');
    // target frame
    const tf = $('frameB');
    setCls(tf, 'empty', !tgtVisible);
    if (tgtVisible) {
      const C = kitOf(tgt);
      if (this.lastTarget !== tgt.id) {
        this.lastTarget = tgt.id;
        $('portB').innerHTML = C.emblem; $('portB').style.cssText = emblemStyle(C) + ';font-size:34px';
        $('resB').className = 'fill res-' + tgt.resType;
        setText($('nameB'), tgt.name); setText($('classB'), `${C.specIcon || ''} ${C.specName || ''} ${C.name}`.trim());
        $('nameB').parentElement.className = 'uf-name hostile';
        this.lastBuffKey.B = '';
      }
      this.frame('B', tgt, 'B', true);
      this.castbar($('castB'), tgt);
    } else if (this.lastTarget !== -1) {
      this.lastTarget = -1;
      setText($('nameB'), 'No Target'); setText($('classB'), ''); $('portB').innerHTML = '?'; $('portB').style.cssText = 'font-size:30px;color:#666';
      setStyle($('hpB'), 'width', '0%'); setStyle($('resB'), 'width', '0%'); setText($('hpTextB'), ''); setText($('resTextB'), ''); $('buffsB').innerHTML = ''; $('castB').classList.add('hidden');
    }
    if (me.cls === 'rogue') [...$('cpA').children].forEach((c, i) => setCls(c, 'on', i < me.cp));
    if (me.cls === 'berserker') { const bonus = Math.round(CLASSES.berserker.passive.maxBonus * (1 - Math.max(0, me.hp) / me.maxHp) * 100); const el = $('cpA').firstChild; setText(el, `Bloodrage +${bonus}% damage`); setStyle(el, 'color', bonus > 35 ? '#ff4a3a' : bonus > 15 ? '#ff9a6a' : '#c8a080'); }
    this.castbar($('castA'), me, true);
    setStyle($('stamFill'), 'width', (me.stamina ?? 100) + '%');
    // mini frames
    for (const m of this.minis || []) {
      const f = F[m.id]; if (!f) continue;
      const stealth = f.team !== me.team && f.buffs.some(b => b.type === 'stealth');
      setStyle(m.hp, 'width', (stealth ? 100 : Math.max(0, f.hp) / f.maxHp * 100) + '%');
      setText(m.hpt, stealth ? 'Stealthed' : f.alive ? `${Math.round(Math.max(0, f.hp) / f.maxHp * 100)}%` : 'Dead');
      setStyle(m.res, 'width', (f.res / f.maxRes * 100) + '%');
      setStyle(m.cast, 'width', f.cast ? (f.cast.t / f.cast.dur * 100) + '%' : '0%');
      setCls(m.el, 'dead', !f.alive);
      setCls(m.el, 'targeted', me.target === f.id && f.team !== me.team);
      setCls(m.el, 'friended', me.friend === f.id);
      const key = stealth ? '' : f.buffs.map(b => b.type + b.name).join('|');
      if (this.lastBuffKey['m' + m.id] !== key) { this.lastBuffKey['m' + m.id] = key; m.buffs.innerHTML = stealth ? '' : buffsHTML(f.buffs.slice(0, 7), true); }
    }
    // action bar
    const t = tgtVisible ? tgt : null;
    const dist = t ? rangeDist(me, t) : 999;
    const los = t ? !segBlocked(me.x, me.z, t.x, t.z, me.y + 1.5, t.y + 1.5) : false;
    const A = kitOf(me).auto;
    if (this.atkSlot) {
      const frac = Math.min(1, (me.autoT || 0) / A.speed);
      setStyle(this.atkSlot.cd, 'background', frac > 0.02 ? `conic-gradient(transparent ${(1 - frac) * 360}deg, rgba(0,0,0,0.6) 0)` : 'none');
      setCls(this.atkSlot.el, 'active', !!me.autoOn);
      setCls(this.atkSlot.el, 'oor', !t || dist > A.range + 0.3 || (A.ranged && !los));
    }
    this.slots && this.slots.forEach((s, i) => {
      const ab = s.ab;
      // charges (e.g. 2 blinks): usable while any charge is left; the badge shows how many
      const chN = ab.charges ? (me.ch?.[i] ?? ab.charges) : 0;
      if (s.chg) setText(s.chg, String(chN));
      const cd = ab.charges && chN > 0 ? 0 : me.cds[i];
      let rem = cd, tot = ab.cd;
      if (ab.gcd && me.gcd > cd) { rem = me.gcd; tot = RULES.gcd; }
      if (rem > 0.05 && tot > 0) {
        const frac = Math.min(1, rem / tot);
        setStyle(s.cd, 'background', `conic-gradient(transparent ${((1 - frac) * 360).toFixed(1)}deg, rgba(0,0,0,0.72) 0)`);
        setText(s.txt, cd > 1.5 ? String(Math.ceil(cd)) : cd > 0.05 ? cd.toFixed(1) : '');
      } else { setStyle(s.cd, 'background', 'none'); setText(s.txt, ''); }
      if (s.wasCd && cd <= 0) { s.el.classList.remove('ready'); void s.el.offsetWidth; s.el.classList.add('ready'); }
      s.wasCd = cd > 0;
      setCls(s.el, 'nores', ab.cost > me.res || (ab.needsCp && me.cp < 1));
      setCls(s.el, 'oor', !!(ab.target && t && (dist > ab.range + 0.3 || (ab.minRange && dist < ab.minRange) || (!ab.melee && !los))));
    });
    // score
    const sA = view.score[me.team], sB = view.score[1 - me.team];
    [...$('pipsA').children].forEach((p, i) => setCls(p, 'won', i < sA));
    [...$('pipsB').children].forEach((p, i) => setCls(p, 'won', i < sB));
    setText($('roundLabel'), `Round ${view.round}`);
    const tt = Math.floor(view.fightT || 0);
    setText($('roundTimer'), `${Math.floor(tt / 60)}:${String(tt % 60).padStart(2, '0')}`);
    const dl = $('dampLabel');
    if (view.damp > 0) { setCls(dl, 'hidden', false); setText(dl, `Dampening ${Math.round(view.damp)}%`); } else setCls(dl, 'hidden', true);
    if (this.errT > 0) { this.errT -= dt; if (this.errT <= 0) $('errorText').classList.remove('show'); }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) $('controlsHint').style.opacity = 0; }
    this.updateNameplates(camera, F, me);
    this.updateTexts(dt, camera);
  }

  frame(s, f, key, isFoe) {
    const hp = Math.max(0, f.hp) / f.maxHp;
    setStyle($('hp' + s), 'width', (hp * 100) + '%');
    setCls($('hp' + s).parentElement, 'low', hp < 0.25 && f.alive);
    const abs = f.buffs.reduce((a, b) => a + (b.type === 'absorb' ? b.value : 0), 0);
    const absEl = $('abs' + s);
    const aw = Math.min(100, abs / f.maxHp * 100);
    setStyle(absEl, 'left', (Math.min(hp * 100, 100 - aw)) + '%'); setStyle(absEl, 'width', aw + '%');
    setText($('hpText' + s), `${Math.max(0, Math.round(f.hp))} / ${f.maxHp}${abs > 0 ? `  (+${Math.round(abs)})` : ''}`);
    setStyle($('res' + s), 'width', (f.res / f.maxRes * 100) + '%');
    setText($('resText' + s), `${Math.round(f.res)} / ${f.maxRes}`);
    const list = f.buffs;
    const k = list.map(b => b.type + b.name + Math.ceil(b.t)).join('|');
    if (k !== this.lastBuffKey[key]) { this.lastBuffKey[key] = k; $('buffs' + s).innerHTML = buffsHTML(list); }
  }

  castbar(el, f, mine) {
    if (f.cast) {
      const ab = kitOf(f).abilities[f.cast.idx];
      el.classList.remove('hidden', 'interrupted', 'done');
      setStyle(el.querySelector('.fill'), 'width', Math.min(100, f.cast.t / f.cast.dur * 100) + '%');
      setText(el.querySelector('span'), ab.name);
      const ct = el.querySelector('.ct'); if (ct) setText(ct, Math.max(0, f.cast.dur - f.cast.t).toFixed(1));
      el._hideT = 0; el._had = true;
    } else if (!el.classList.contains('hidden')) {
      if (el.classList.contains('interrupted') || el.classList.contains('done')) { el._hideT = (el._hideT || 0) + 1 / 60; if (el._hideT > 0.5) el.classList.add('hidden'); }
      else if (el._had && mine) { el.classList.add('done'); el._had = false; el._hideT = 0.2; }
      else el.classList.add('hidden');
    }
  }
  castInterrupted(isMe) {
    const el = $(isMe ? 'castA' : 'castB');
    el.classList.remove('hidden', 'done'); el.classList.add('interrupted'); el.querySelector('span').textContent = 'Interrupted'; el._hideT = 0; el._had = false;
  }

  updateNameplates(camera, F, me) {
    for (const f of F) {
      const p = this.plateFor && this.plateFor[f.id]; if (!p) continue;
      const hostile = f.team !== me.team;
      const stealthed = hostile && f.buffs.some(b => b.type === 'stealth');
      this.v.set(f.x, f.y + 2.75, f.z).project(camera);
      if (this.v.z > 1 || stealthed || !f.alive) { setStyle(p.el, 'display', 'none'); continue; }
      setStyle(p.el, 'display', '');
      const x = (this.v.x * 0.5 + 0.5) * innerWidth - 60, y = (-this.v.y * 0.5 + 0.5) * innerHeight - 30;
      p.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      setStyle(p.bar, 'width', (Math.max(0, f.hp) / f.maxHp * 100) + '%');
      setStyle(p.cast, 'visibility', f.cast ? 'visible' : 'hidden');
      if (f.cast) setStyle(p.castFill, 'width', (f.cast.t / f.cast.dur * 100) + '%');
      setCls(p.el, 'targeted', hostile ? me.target === f.id : me.friend === f.id);
    }
  }

  // ------------------------------------------------------------ floating combat text
  floatText(pos, text, color, cls = '', side = 0) {
    if (this.texts.length > 40) { const old = this.texts.shift(); old.el.remove(); }
    const el = document.createElement('div');
    el.className = 'ftext ' + cls; el.textContent = text; el.style.color = color;
    this.floaters.appendChild(el);
    const big = cls.includes('crit') || cls.includes('big');
    this.texts.push({ el, x: pos.x, y: pos.y, z: pos.z, t: 0, dur: big ? 1.5 : 1.1, dx: (Math.random() - 0.5) * 60 + side * 40, pop: big ? 2.2 : 1.6 });
  }
  updateTexts(dt, camera) {
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]; t.t += dt;
      const u = t.t / t.dur;
      if (u >= 1) { t.el.remove(); this.texts.splice(i, 1); continue; }
      this.v.set(t.x, t.y, t.z).project(camera);
      if (this.v.z > 1) { t.el.style.display = 'none'; continue; }
      t.el.style.display = '';
      const x = (this.v.x * 0.5 + 0.5) * innerWidth + t.dx * u, y = (-this.v.y * 0.5 + 0.5) * innerHeight - 70 * u;
      const sc = u < 0.12 ? t.pop - (t.pop - 1) * (u / 0.12) : 1;
      t.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%,-50%) scale(${sc.toFixed(2)})`;
      t.el.style.opacity = u > 0.7 ? ((1 - u) / 0.3).toFixed(2) : '1';
    }
  }
  clearTexts() { for (const t of this.texts) t.el.remove(); this.texts = []; }

  // show numbers involving me (dealt or taken) prominently; others' fights small
  combatText(ev, F, myId) {
    const tgt = F[ev.id]; if (!tgt) return;
    const me = F[myId];
    const pos = { x: tgt.x, y: tgt.y + 2.2, z: tgt.z };
    const mine = ev.id === myId, byMe = ev.src === myId;
    const relevant = mine || byMe || (me && F[ev.src] && F[ev.src].team === me.team);
    if (ev.e === 'dmg') {
      if (!relevant && !ev.big) return;
      if (ev.amt <= 0 && ev.abs > 0) { this.floatText(pos, 'Absorb', '#9ac8ff', 'small', mine ? -1 : 1); return; }
      const col = mine ? '#ff5a4a' : (SCHOOL[ev.school] || '#fff');
      let cls = ev.crit ? 'crit' : ev.big ? 'big' : ev.dot || ev.ab === 'auto' ? 'small' : '';
      if (!byMe && !mine) cls += ' small';
      this.floatText(pos, (mine ? '-' : '') + ev.amt + (ev.abs ? ` (${ev.abs})` : '') + (ev.back && byMe ? '' : ''), col, cls, mine ? -1 : 1);
    } else if (ev.e === 'heal' && ev.amt > 0) {
      if (!relevant && tgt.team !== me?.team) return;
      this.floatText(pos, '+' + ev.amt, '#6aff7a', 'heal' + (ev.crit ? ' crit' : ev.amt > 150 ? ' big' : ''), 0);
    } else if (ev.e === 'immune') {
      this.floatText(pos, 'Immune', '#ffffff', 'small');
    } else if (ev.e === 'buff' && ['stun', 'root', 'silence', 'disorient'].includes(ev.type)) {
      this.floatText({ ...pos, y: pos.y + 0.6 }, ev.name, '#ffd27a', 'small');
    } else if (ev.e === 'interrupted') {
      this.floatText({ ...pos, y: pos.y + 0.6 }, 'Interrupted', '#ff7a5a', '');
    }
  }

  error(msg) { const el = $('errorText'); el.textContent = msg; el.classList.add('show'); this.errT = 1.4; }

  announce(text, cls = '', hold = false, sub = '') {
    const el = $('announce');
    el.className = 'announce'; void el.offsetWidth;
    el.textContent = text;
    el.classList.add(hold ? 'hold' : 'show'); for (const c of cls.split(' ')) if (c) el.classList.add(c);
    const s = $('subAnnounce'); s.textContent = sub; s.classList.toggle('show', !!sub);
    clearTimeout(this._subT); if (sub && !hold) this._subT = setTimeout(() => s.classList.remove('show'), 1800);
  }
  clearAnnounce() { $('announce').className = 'announce'; $('subAnnounce').classList.remove('show'); }
}
