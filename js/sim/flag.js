// The 5v5 flag battleground (Thornwater Gorge) — rules on top of the arena simulation.
// Design and the reasoning behind every number: docs/FUTURE_BATTLEGROUNDS.md.
//
// One long match instead of rounds: preparation behind closed gates, then the fight. Touch the enemy flag to take
// it, carry it to your own flag stand while your own flag is at home to score. The dead come back in waves at their
// graveyard. Three captures win, otherwise the clock decides. Power-ups spawn in mirrored pairs every minute.
import { Sim, floorAt, hasBuff, getBuff, currentMap } from './sim.js';
import { kit, kitOf } from '../data/classes.js';
import { THORNWATER } from './maps/thornwater.js';

export const FLAG_RULES = {
  caps: 3,             // captures to win
  time: 15 * 60,       // match length after the gates open (s)
  prep: 20,            // preparation behind closed gates (s)
  wave: 20,            // respawn wave interval (s)
  minDead: 4,          // shortest time dead: a death just before a wave waits for the next one
  protect: 3,          // spawn protection (s), broken by acting or leaving the graveyard
  touch: 1.8,          // reach for flags and power-ups (yd, horizontal)
  dropReturn: 10,      // a dropped flag nobody touches goes home after this (s)
  exposedAfter: 60,    // both flags carried this long → both carriers Exposed
  exposedEvery: 30,    // one more Exposed stack this often
  exposedMax: 5,       // up to +50 % damage taken
  buffEvery: 60,       // power-up wave interval (s)
  buffPairs: 3,        // mirrored pairs lit per wave
};
export const POWERUPS = {
  haste: { name: 'Haste', icon: '»', color: '#7ae0ff', desc: '+40 % movement speed for 10 s' },
  fury: { name: 'Fury', icon: '⚔', color: '#ff6a4a', desc: '+25 % damage dealt and +10 % damage taken for 20 s' },
  mending: { name: 'Mending', icon: '✚', color: '#8aff9a', desc: '40 % of health and resources over 6 s; damage breaks it' },
  stoneskin: { name: 'Stoneskin', icon: '⬢', color: '#d8c8a0', desc: 'absorbs 20 % of your health for 15 s' },
  shockwave: { name: 'Shockwave', icon: '✸', color: '#ffd27a', desc: 'your next ability also stuns enemies within 6 yd for 1.5 s (use within 30 s)' },
  clarity: { name: 'Clarity', icon: '✦', color: '#c8a0ff', desc: '−30 % cooldown on your next three abilities (20 s)' },
};
const POWER_KEYS = Object.keys(POWERUPS);
// match points (the end screen and the scoreboard)
export const POINTS = { cap: 50, ret: 15, fcKill: 15, pick: 5, kill: 4, healK: 3, win: 40, draw: 20, loss: 10 };
export const matchPoints = (st, result) => Math.round((st.caps || 0) * POINTS.cap + (st.returns || 0) * POINTS.ret + (st.fcKills || 0) * POINTS.fcKill + (st.picks || 0) * POINTS.pick
  + (st.kills || 0) * POINTS.kill + Math.floor((st.heal || 0) / 1000) * POINTS.healK + (result === 'win' ? POINTS.win : result === 'draw' ? POINTS.draw : result === 'loss' ? POINTS.loss : 0));

const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class FlagSim extends Sim {
  static MAP = THORNWATER;

  // ------------------------------------------------------------ setup
  spawnOf(f) {
    const M = THORNWATER, p = M.prep.find(s => s.team === f.team);
    const mates = this.fighters.filter(o => o.team === f.team), k = mates.indexOf(f), n = mates.length;
    const side = (k - (n - 1) / 2) * 2.6;
    return { x: p.x, z: p.z + side, yaw: p.yaw };
  }
  startRound() {
    super.startRound();
    this.fmt = 'bg5'; this.noDamp = true; this.isFlag = true;
    const M = THORNWATER; M.gatesOpen = false;
    this.flags = M.flags.map(fl => ({ team: fl.team, state: 'home', carrier: -1, x: fl.x, y: fl.y, z: fl.z, t: 0 }));
    this.powerups = []; this.puT = 0; this.bothT = 0; this.lastCap = -1;
    for (const f of this.fighters) { f.respawnAt = -1; f.stats.caps = 0; f.stats.returns = 0; f.stats.fcKills = 0; f.stats.picks = 0; }
    this.state = 'countdown'; this.stateT = FLAG_RULES.prep;
    this.events = this.events.filter(e => e.e !== 'roundStart');
    this.event({ e: 'bgStart', prep: FLAG_RULES.prep });
  }
  resetMatch() { for (const f of this.fighters) f.stats = { dmg: 0, heal: 0, absorbed: 0, ccs: 0, interrupts: 0, crits: 0, kills: 0 }; this.score = [0, 0]; this.round = 0; this.winner = -1; this.startRound(); }

  // ------------------------------------------------------------ tick
  step(dt, inputs) {
    const M = currentMap();
    if (this.state === 'countdown') {
      // preparation: walk around inside your own keep (the gates are shut), no fighting
      this.time += dt; this.stateT -= dt; M.gatesOpen = false;
      for (const f of this.fighters) {
        const inp = inputs[f.id] || {};
        this.state = 'fight'; this.moveStep(f, inp, dt, true); this.state = 'countdown';
        this.applyTargeting(f, inp);
      }
      if (this.stateT <= 0) {
        this.state = 'fight'; this.fightT = 0; M.gatesOpen = true;
        for (const f of this.fighters) f.petT = 0;
        this.event({ e: 'fight' }); this.event({ e: 'gates' });
        this.spawnPowerups();
      }
      return;
    }
    if (this.state !== 'fight') { super.step(dt, inputs); return; }
    M.gatesOpen = true;
    for (const f of this.fighters) { const inp = inputs[f.id]; if (inp && (inp.dropFlag || inp.remote?.dropFlag)) this.dropFlagOf(f, true); }
    const evStart = this.events.length;
    super.step(dt, inputs);
    if (this.state !== 'fight') return;
    this.afterAbilities(evStart);
    this.updateRespawns();
    this.updateFlags(dt);
    this.updatePowerups(dt);
    this.updateProtection();
    if (this.fightT >= FLAG_RULES.time) this.endMatch(this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : this.lastCap);
  }

  // ------------------------------------------------------------ death and respawn
  checkDeaths() {
    for (const f of this.fighters) {
      if (!f.alive || f.hp > 0) continue;
      this.dropFlagOf(f, false);
      f.stats.deaths = (f.stats.deaths || 0) + 1;
      f.alive = false; f.cast = null; f.dash = null; f.locked = false; f.atkReq = 0; f.atkHold = false; f.swing = null; f.queued = null; f.buffs = [];
      const k = this.fighters[f.killer];
      if (k && k.team !== f.team) { k.stats.kills++; if (f.wasCarrier) k.stats.fcKills++; }
      f.wasCarrier = false;
      // the next wave, but at least minDead from now
      const w = FLAG_RULES.wave; let at = Math.ceil((this.fightT + 0.001) / w) * w;
      if (at - this.fightT < FLAG_RULES.minDead) at += w;
      f.respawnAt = at;
      this.event({ e: 'death', id: f.id, killer: f.killer ?? -1 });
      for (const o of this.fighters) if (o.target === f.id) { o.atkReq = 0; if (o.cast && o.cast.tid === f.id) this.cancelCast(o, false); }
    }
  }
  updateRespawns() {
    const gyOf = t => THORNWATER.graveyards.find(g => g.team === t);
    let wave = false;
    for (const f of this.fighters) {
      if (f.alive || f.respawnAt < 0 || this.fightT < f.respawnAt) continue;
      const C = kitOf({ cls: f.cls, spec: f.spec, form: kit(f.cls, f.spec).defaultForm || null }), g = gyOf(f.team);
      const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 2.2;
      Object.assign(f, { alive: true, hp: f.maxHp, res: C.res, form: kit(f.cls, f.spec).defaultForm || null, buffs: [], cast: null, dash: null, locked: false, vy: 0, swing: null, queued: null, cp: 0, stamina: 100, killer: undefined, petT: 0,
        x: g.x + Math.cos(a) * r, z: g.z + Math.sin(a) * r, yaw: g.yaw, respawnAt: -1 });
      f.y = floorAt(f.x, f.z, 0);
      f.forceSeq++; f.forceYaw++;
      this.addBuff(f, 'sanctuary', FLAG_RULES.protect, { src: f.id, name: 'Sanctuary', icon: '☩', value: 0 });
      this.event({ e: 'respawn', id: f.id, x: f.x, z: f.z });
      wave = true;
    }
    if (wave) this.event({ e: 'wave' });
  }
  // spawn protection: gone once you act or leave the graveyard
  updateProtection() {
    for (const f of this.fighters) {
      if (!f.alive || !hasBuff(f, 'sanctuary')) continue;
      const g = THORNWATER.graveyards.find(q => q.team === f.team);
      if (f.cast || f.swing || f.gcd > 0.05 || hdist(f, g) > 7) this.removeBuff(f, 'sanctuary');
    }
  }

  // ------------------------------------------------------------ flags
  flagCarriedBy(f) { return this.flags.find(F => F.state === 'carried' && F.carrier === f.id) || null; }
  dropFlagOf(f, onPurpose) {
    const F = this.flagCarriedBy(f); if (!F) return;
    F.state = 'dropped'; F.carrier = -1; F.t = FLAG_RULES.dropReturn;
    F.lock = onPurpose ? f.id : -1; F.lockT = 2; // dropped on purpose (G): not straight back into your own hands
    F.x = f.x; F.z = f.z; F.y = floorAt(f.x, f.z, f.y);
    this.removeBuff(f, 'exposed'); this.removeBuff(f, 'flagcarrier');
    f.wasCarrier = !onPurpose;
    this.event({ e: 'flag', act: 'drop', team: F.team, id: f.id, x: F.x, y: F.y, z: F.z });
  }
  touching(f, p) { return f.alive && hdist(f, p) <= FLAG_RULES.touch && Math.abs(f.y - p.y) < 1.7; }
  updateFlags(dt) {
    const M = THORNWATER;
    for (const F of this.flags) {
      const home = M.flags.find(h => h.team === F.team);
      if (F.state === 'home') {
        const taker = this.fighters.find(f => f.team !== F.team && this.touching(f, home) && !this.flagCarriedBy(f) && !hasBuff(f, 'sanctuary'));
        if (taker) this.pickUp(F, taker);
      } else if (F.state === 'carried') {
        const c = this.fighters[F.carrier];
        if (!c || !c.alive) { if (c) this.dropFlagOf(c, false); continue; }
        // untouchable or hidden carriers drop the flag
        if (hasBuff(c, 'stealth') || hasBuff(c, 'divine')) { this.dropFlagOf(c, true); continue; }
        F.x = c.x; F.y = c.y; F.z = c.z;
        const own = this.flags[c.team], stand = M.flags.find(h => h.team === c.team);
        if (own.state === 'home' && this.touching(c, stand)) this.capture(F, c);
      } else if (F.state === 'dropped') {
        F.t -= dt; F.lockT = (F.lockT || 0) - dt;
        const toucher = this.fighters.find(f => this.touching(f, F) && (f.team === F.team || !this.flagCarriedBy(f)) && !(f.id === F.lock && F.lockT > 0));
        if (toucher && toucher.team === F.team) { this.returnHome(F, toucher); continue; }
        if (toucher) { this.pickUp(F, toucher); continue; }
        if (F.t <= 0) this.returnHome(F, null);
      }
    }
    // Exposed: both flags out at once for too long
    const carried = this.flags.filter(F => F.state === 'carried');
    if (carried.length === 2) {
      this.bothT += dt;
      if (this.bothT >= FLAG_RULES.exposedAfter) {
        const stacks = Math.min(FLAG_RULES.exposedMax, 1 + Math.floor((this.bothT - FLAG_RULES.exposedAfter) / FLAG_RULES.exposedEvery));
        for (const F of carried) {
          const c = this.fighters[F.carrier], b = getBuff(c, 'exposed');
          if (!b) { this.addBuff(c, 'exposed', 9999, { src: c.id, value: 0.1 * stacks, name: 'Exposed', icon: '◎' }); this.event({ e: 'flag', act: 'exposed', team: F.team, id: c.id, stacks }); }
          else if (Math.round(b.value * 10) !== stacks) { b.value = 0.1 * stacks; b.t = 9999; this.event({ e: 'flag', act: 'exposed', team: F.team, id: c.id, stacks }); }
        }
      }
    } else if (this.bothT) { this.bothT = 0; for (const f of this.fighters) this.removeBuff(f, 'exposed'); }
  }
  pickUp(F, f) {
    F.state = 'carried'; F.carrier = f.id; f.stats.picks++;
    this.removeBuff(f, 'stealth');
    this.addBuff(f, 'flagcarrier', 9999, { src: f.id, name: 'Carrying the enemy flag', icon: '⚑', value: 0 });
    this.event({ e: 'flag', act: 'pick', team: F.team, id: f.id });
  }
  returnHome(F, by) {
    const home = THORNWATER.flags.find(h => h.team === F.team);
    F.state = 'home'; F.carrier = -1; F.x = home.x; F.y = home.y; F.z = home.z; F.t = 0;
    if (by) by.stats.returns++;
    this.event({ e: 'flag', act: by ? 'return' : 'autoreturn', team: F.team, id: by ? by.id : -1 });
  }
  capture(F, c) {
    this.score[c.team]++; this.lastCap = c.team; c.stats.caps++;
    this.removeBuff(c, 'flagcarrier'); this.removeBuff(c, 'exposed');
    const home = THORNWATER.flags.find(h => h.team === F.team);
    F.state = 'home'; F.carrier = -1; F.x = home.x; F.y = home.y; F.z = home.z;
    this.bothT = 0;
    this.event({ e: 'flag', act: 'capture', team: F.team, id: c.id, score: [...this.score] });
    if (this.score[c.team] >= FLAG_RULES.caps) this.endMatch(c.team);
  }
  endMatch(winner) {
    if (this.state === 'matchEnd') return;
    this.state = 'matchEnd'; this.winner = winner ?? -1;
    for (const f of this.fighters) f.stats.points = matchPoints(f.stats, this.winner < 0 ? 'draw' : f.team === this.winner ? 'win' : 'loss');
    this.event({ e: 'matchEnd', winner: this.winner, score: [...this.score], bg: true });
  }

  // ------------------------------------------------------------ power-ups
  spawnPowerups() {
    const M = THORNWATER, free = M.buffPairs.map((p, i) => i).filter(i => !this.powerups.some(u => u.pair === i));
    for (let n = 0; n < FLAG_RULES.buffPairs && free.length; n++) {
      const i = free.splice(Math.floor(Math.random() * free.length), 1)[0];
      const type = POWER_KEYS[Math.floor(Math.random() * POWER_KEYS.length)];
      M.buffPairs[i].forEach((p, side) => this.powerups.push({ id: 'p' + i + side, pair: i, type, x: p.x, z: p.z, y: floorAt(p.x, p.z, 0) }));
    }
    this.event({ e: 'powerups' });
  }
  updatePowerups(dt) {
    this.puT += dt;
    if (this.puT >= FLAG_RULES.buffEvery) { this.puT = 0; this.spawnPowerups(); }
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const u = this.powerups[i];
      const f = this.fighters.find(o => this.touching(o, u));
      if (!f) continue;
      this.powerups.splice(i, 1);
      this.applyPowerup(f, u.type);
      this.event({ e: 'powerup', id: f.id, type: u.type, x: u.x, z: u.z });
    }
    // Mending: heal over time, broken by damage
    for (const f of this.fighters) {
      const m = f.alive && getBuff(f, 'mending');
      if (m) {
        if (f.hp < (f._mendHp ?? f.hp) - 0.5) { this.removeBuff(f, 'mending'); f._mendHp = undefined; continue; }
        f.hp = Math.min(f.maxHp, f.hp + f.maxHp * 0.4 / 6 * dt); f.res = Math.min(f.maxRes, f.res + f.maxRes * 0.4 / 6 * dt); f._mendHp = f.hp;
      } else f._mendHp = undefined;
    }
  }
  applyPowerup(f, type) {
    const P = POWERUPS[type], o = { src: f.id, name: P.name, icon: P.icon };
    if (type === 'haste') this.addBuff(f, 'speed', 10, { ...o, value: 0.4 });
    else if (type === 'fury') this.addBuff(f, 'fury', 20, { ...o, value: 0.25 });
    else if (type === 'mending') { this.addBuff(f, 'mending', 6, { ...o, value: 0 }); f._mendHp = f.hp; }
    else if (type === 'stoneskin') this.addBuff(f, 'absorb', 15, { ...o, value: Math.round(f.maxHp * 0.2) });
    else if (type === 'shockwave') this.addBuff(f, 'shockcharge', 30, { ...o, value: 0 });
    else if (type === 'clarity') { const b = this.addBuff(f, 'clarity', 20, { ...o, value: 3 }); if (b) b.data.n = 3; }
  }
  // Shockwave / Clarity react to the abilities used this tick
  afterAbilities(from) {
    for (let i = from; i < this.events.length; i++) {
      const ev = this.events[i]; if (ev.e !== 'ab') continue;
      const f = this.fighters[ev.id]; if (!f || !f.alive) continue;
      if (hasBuff(f, 'shockcharge')) {
        this.removeBuff(f, 'shockcharge');
        for (const t of this.fighters) if (t.alive && t.team !== f.team && hdist(t, f) <= 6) this.addBuff(t, 'stun', 1.5, { src: f.id, cc: 'cc', name: 'Shockwave', icon: '✸' });
        this.event({ e: 'fx', fx: 'shockwave', id: f.id, x: f.x, z: f.z });
      }
      const cl = getBuff(f, 'clarity');
      if (cl) {
        const idx = kitOf(f).abilities.findIndex(a => a && a.id === ev.ab);
        if (idx >= 0 && f.cds[idx] > 0) f.cds[idx] *= 0.7;
        cl.data.n = (cl.data.n ?? 3) - 1; cl.value = cl.data.n; if (cl.data.n <= 0) this.removeBuff(f, 'clarity');
      }
    }
  }

  // ------------------------------------------------------------ network
  // what the view needs on top of the arena state (the host draws it directly, guests get it in every snapshot)
  bgState() {
    const r = v => Math.round(v * 100) / 100;
    return {
      flags: this.flags.map(F => ({ team: F.team, state: F.state, carrier: F.carrier, x: r(F.x), y: r(F.y), z: r(F.z), t: r(F.t) })),
      pu: this.powerups.map(u => ({ id: u.id, type: u.type, x: u.x, y: u.y, z: u.z })),
      rs: this.fighters.map(f => (f.alive || f.respawnAt < 0 ? 0 : r(f.respawnAt - this.fightT))),
      tl: r(Math.max(0, FLAG_RULES.time - this.fightT)), gates: !!THORNWATER.gatesOpen, both: r(this.bothT),
      nextWave: r(FLAG_RULES.wave - (this.fightT % FLAG_RULES.wave)), puIn: r(FLAG_RULES.buffEvery - this.puT),
    };
  }
  snapshot(lite) { const s = super.snapshot(lite); s.bg = this.bgState(); return s; }
}
