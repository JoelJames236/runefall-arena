// In-game interface: unit frames, action bar with cooldown sweeps, cast bars,
// round score, nameplate, floating combat text and announcements.
import * as THREE from 'three';
import { CLASSES, BUFF_ICONS } from '../data/classes.js';
import { RULES, segBlocked } from '../sim/sim.js';

const $ = id => document.getElementById(id);
const SCHOOL = { frost: '#8fd8ff', fire: '#ff9a4a', arcane: '#d29aff', holy: '#ffe680', nature: '#7ae0ff', shadow: '#c08aff', phys: '#ffffff' };

export function iconHTML(ab, size) {
  const c = ab.color;
  return `<div class="icon" style="${size ? `width:${size}px;height:${size}px;font-size:${size * 0.52}px;` : ''}background:radial-gradient(circle at 35% 30%, ${c}cc, ${c}55 45%, #120c18 100%);color:${c}"><span class="glyph">${ab.glyph}</span></div>`;
}

export class HUD {
  constructor() {
    this.root = $('hud');
    this.floaters = $('floaters');
    this.texts = [];
    this.errT = 0;
    this.v = new THREE.Vector3();
    this.nameplate = document.createElement('div');
    this.nameplate.className = 'nameplate';
    this.nameplate.innerHTML = '<div class="np-name"></div><div class="np-bar"><div></div></div><div class="np-cast"><div></div></div>';
    this.floaters.appendChild(this.nameplate);
    this.lastCd = [];
  }

  show(v) { this.root.classList.toggle('hidden', !v); this.nameplate.style.display = v ? '' : 'none'; if (!v) this.clearTexts(); }

  setup(fighters, myId, names) {
    this.myId = myId;
    const me = fighters[myId], foe = fighters[1 - myId];
    const CM = CLASSES[me.cls], CF = CLASSES[foe.cls];
    $('nameA').textContent = names[myId]; $('nameB').textContent = names[1 - myId];
    $('classA').textContent = CM.name; $('classB').textContent = CF.name;
    $('scoreNameA').textContent = names[myId]; $('scoreNameB').textContent = names[1 - myId];
    for (const [el, C] of [[$('portA'), CM], [$('portB'), CF]]) { el.textContent = C.emblem; el.style.borderColor = C.color; el.style.color = C.color; el.style.background = `radial-gradient(circle at 40% 35%, ${C.color}55, #120c18 75%)`; }
    for (const [el, f] of [[$('resA'), me], [$('resB'), foe]]) el.className = 'fill res-' + f.resType;
    this.nameplate.querySelector('.np-name').textContent = names[1 - myId];
    const bar = $('actionbar'); bar.innerHTML = '';
    this.slots = CM.abilities.map((ab, i) => {
      const s = document.createElement('div'); s.className = 'slot';
      s.innerHTML = `${iconHTML(ab)}<div class="cd"></div><div class="cdtext"></div><div class="key">${i + 1}</div><div class="cost">${ab.cost || ''}</div>`;
      s.title = `${ab.name}: ${ab.desc}`;
      bar.appendChild(s);
      return { el: s, cd: s.querySelector('.cd'), txt: s.querySelector('.cdtext'), ab, wasCd: false };
    });
    const pips = n => Array.from({ length: RULES.winsNeeded }, () => '<div class="pip"></div>').join('');
    $('pipsA').innerHTML = pips(); $('pipsB').innerHTML = pips();
    $('cpA').style.display = me.cls === 'rogue' ? '' : 'none';
    $('cpA').innerHTML = '<i></i>'.repeat(5);
    this.lastBuffKey = ['', ''];
    this.hintT = 12; $('controlsHint').style.opacity = 1;
  }

  flashSlot(i) { const s = this.slots && this.slots[i]; if (!s) return; s.el.classList.remove('flash'); void s.el.offsetWidth; s.el.classList.add('flash'); }

  update(dt, view, camera, myId) {
    const F = view.fighters, me = F[myId], foe = F[1 - myId];
    if (!me || !foe) return;
    // frames
    this.frame('A', me);
    this.frame('B', foe, true);
    // combo points
    if (me.cls === 'rogue') [...$('cpA').children].forEach((c, i) => c.classList.toggle('on', i < me.cp));
    // cast bars
    this.castbar($('castA'), me);
    this.castbar($('castB'), foe);
    // stamina
    $('stamFill').style.width = (me.stamina ?? 100) + '%';
    // action bar
    const dist = Math.hypot(me.x - foe.x, me.z - foe.z);
    const foeVisible = foe.alive && !foe.buffs.some(b => b.type === 'stealth');
    this.slots && this.slots.forEach((s, i) => {
      const ab = s.ab;
      const cd = me.cds[i];
      let rem = cd, tot = ab.cd;
      if (ab.gcd && me.gcd > cd) { rem = me.gcd; tot = RULES.gcd; }
      if (rem > 0.05 && tot > 0) {
        const frac = Math.min(1, rem / tot);
        s.cd.style.background = `conic-gradient(transparent ${(1 - frac) * 360}deg, rgba(0,0,0,0.72) 0)`;
        s.txt.textContent = cd > 1.5 ? Math.ceil(cd) : '';
      } else { s.cd.style.background = 'none'; s.txt.textContent = ''; }
      if (s.wasCd && cd <= 0) { s.el.classList.remove('ready'); void s.el.offsetWidth; s.el.classList.add('ready'); }
      s.wasCd = cd > 0;
      s.el.classList.toggle('nores', ab.cost > me.res || (ab.needsCp && me.cp < 1));
      s.el.classList.toggle('oor', !!(ab.target && (!foeVisible || dist > ab.range + 0.3 || (ab.minRange && dist < ab.minRange) || (!ab.melee && segBlocked(me.x, me.z, foe.x, foe.z)))));
    });
    // score
    const sA = view.score[myId], sB = view.score[1 - myId];
    [...$('pipsA').children].forEach((p, i) => p.classList.toggle('won', i < sA));
    [...$('pipsB').children].forEach((p, i) => p.classList.toggle('won', i < sB));
    $('roundLabel').textContent = `Round ${view.round}`;
    const t = Math.floor(view.fightT || 0);
    $('roundTimer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const dl = $('dampLabel');
    if (view.damp > 0) { dl.classList.remove('hidden'); dl.textContent = `Dampening ${Math.round(view.damp)}%`; } else dl.classList.add('hidden');
    // error fade
    if (this.errT > 0) { this.errT -= dt; if (this.errT <= 0) $('errorText').classList.remove('show'); }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) $('controlsHint').style.opacity = 0; }
    // nameplate
    this.updateNameplate(camera, foe, me);
    this.updateTexts(dt, camera);
  }

  frame(s, f, isFoe) {
    const hp = Math.max(0, f.hp) / f.maxHp;
    $('hp' + s).style.width = (hp * 100) + '%';
    const abs = f.buffs.reduce((a, b) => a + (b.type === 'absorb' ? b.value : 0), 0);
    const absEl = $('abs' + s);
    absEl.style.left = (hp * 100) + '%'; absEl.style.width = Math.min(100 - hp * 100, abs / f.maxHp * 100) + '%';
    if (abs > 0 && hp > 0.98) { absEl.style.left = (100 - Math.min(100, abs / f.maxHp * 100)) + '%'; }
    $('hpText' + s).textContent = `${Math.max(0, Math.round(f.hp))} / ${f.maxHp}${abs > 0 ? `  (+${Math.round(abs)})` : ''}`;
    $('res' + s).style.width = (f.res / f.maxRes * 100) + '%';
    $('resText' + s).textContent = `${Math.round(f.res)} / ${f.maxRes}`;
    // buffs (rebuild only when the set changes)
    const stealthed = isFoe && f.buffs.some(b => b.type === 'stealth');
    const list = stealthed ? [] : f.buffs.filter(b => b.type !== 'stoneskin' || true);
    const key = list.map(b => b.type + b.name + Math.ceil(b.t)).join('|');
    const idx = s === 'A' ? 0 : 1;
    if (key !== this.lastBuffKey[idx]) {
      this.lastBuffKey[idx] = key;
      $('buffs' + s).innerHTML = list.map(b => {
        const meta = BUFF_ICONS[b.type] || { icon: '?', color: '#888' };
        const icon = b.icon || meta.icon;
        return `<div class="buff ${meta.debuff ? 'debuff' : ''}" title="${b.name}" style="background:radial-gradient(circle at 35% 30%, ${meta.color}aa, #120c18 90%)">${icon}<b>${b.t < 60 ? Math.ceil(b.t) : ''}</b></div>`;
      }).join('');
    }
  }

  castbar(el, f) {
    if (f.cast) {
      const ab = CLASSES[f.cls].abilities[f.cast.idx];
      el.classList.remove('hidden', 'interrupted');
      el.querySelector('.fill').style.width = Math.min(100, f.cast.t / f.cast.dur * 100) + '%';
      el.querySelector('span').textContent = ab.name;
      el._hideT = 0;
    } else if (!el.classList.contains('hidden')) {
      if (el.classList.contains('interrupted')) { el._hideT = (el._hideT || 0) + 1 / 60; if (el._hideT > 0.6) el.classList.add('hidden'); }
      else el.classList.add('hidden');
    }
  }
  castInterrupted(isMe) {
    const el = $(isMe ? 'castA' : 'castB');
    el.classList.remove('hidden'); el.classList.add('interrupted'); el.querySelector('span').textContent = 'Interrupted'; el._hideT = 0;
  }

  updateNameplate(camera, foe, me) {
    const np = this.nameplate;
    const stealthed = foe.buffs.some(b => b.type === 'stealth');
    this.v.set(foe.x, foe.y + 2.75, foe.z).project(camera);
    if (this.v.z > 1 || stealthed || !foe.alive && false) { np.style.display = 'none'; return; }
    np.style.display = '';
    np.style.left = ((this.v.x * 0.5 + 0.5) * innerWidth) + 'px';
    np.style.top = ((-this.v.y * 0.5 + 0.5) * innerHeight) + 'px';
    np.querySelector('.np-bar div').style.width = (Math.max(0, foe.hp) / foe.maxHp * 100) + '%';
    np.querySelector('.np-cast').style.visibility = foe.cast ? 'visible' : 'hidden';
    if (foe.cast) np.querySelector('.np-cast div').style.width = (foe.cast.t / foe.cast.dur * 100) + '%';
    np.classList.toggle('targeted', me.target === foe.id || me.target === (1 - this.myId));
  }

  // ------------------------------------------------------------ floating combat text
  floatText(pos, text, color, size = '', side = 0) {
    const el = document.createElement('div');
    el.className = 'ftext ' + size; el.textContent = text; el.style.color = color;
    this.floaters.appendChild(el);
    this.texts.push({ el, x: pos.x, y: pos.y, z: pos.z, t: 0, dur: size === 'big' ? 1.5 : 1.15, dx: (Math.random() - 0.5) * 60 + side * 40 });
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
      const sc = u < 0.12 ? 1.6 - u * 5 : 1;
      t.el.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%) scale(${sc})`;
      t.el.style.left = '0'; t.el.style.top = '0';
      t.el.style.opacity = u > 0.7 ? (1 - u) / 0.3 : 1;
    }
  }
  clearTexts() { for (const t of this.texts) t.el.remove(); this.texts = []; }

  combatText(ev, F, myId) {
    const tgt = F[ev.id]; if (!tgt) return;
    const pos = { x: tgt.x, y: tgt.y + 2.2, z: tgt.z };
    const mine = ev.id === myId;
    if (ev.e === 'dmg') {
      if (ev.amt <= 0 && ev.abs > 0) { this.floatText(pos, 'Absorb', '#9ac8ff', 'small', mine ? -1 : 1); return; }
      const col = mine ? '#ff5a4a' : (SCHOOL[ev.school] || '#fff');
      const size = ev.big ? 'big' : ev.dot || ev.ab === 'auto' ? 'small' : '';
      this.floatText(pos, (mine ? '-' : '') + ev.amt + (ev.abs ? ` (${ev.abs})` : ''), col, size, mine ? -1 : 1);
    } else if (ev.e === 'heal' && ev.amt > 0) {
      this.floatText(pos, '+' + ev.amt, '#6aff7a', ev.amt > 150 ? 'big' : '', 0);
    } else if (ev.e === 'immune') {
      this.floatText(pos, 'Immune', '#ffffff', 'small');
    } else if (ev.e === 'buff' && ['stun', 'root', 'silence', 'disorient'].includes(ev.type)) {
      this.floatText({ ...pos, y: pos.y + 0.6 }, ev.name, '#ffd27a', 'small');
    } else if (ev.e === 'interrupted') {
      this.floatText({ ...pos, y: pos.y + 0.6 }, 'Interrupted', '#ff7a5a', '');
    }
  }

  error(msg) {
    const el = $('errorText'); el.textContent = msg; el.classList.add('show'); this.errT = 1.4;
  }

  announce(text, cls = '', hold = false) {
    const el = $('announce');
    el.className = 'announce'; void el.offsetWidth;
    el.textContent = text;
    el.classList.add(hold ? 'hold' : 'show'); if (cls) el.classList.add(cls);
  }
  clearAnnounce() { $('announce').className = 'announce'; }
}
