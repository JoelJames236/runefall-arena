// Authoritative combat simulation. Runs on the host (or locally vs. AI).
// Pure logic — no rendering — so it can be serialized and driven over the network.
import { CLASSES } from '../data/classes.js';

export const ARENA_R = 29;
export const PILLARS = [0, 1, 2, 3].map(i => {
  const a = Math.PI / 4 + i * Math.PI / 2;
  return { x: Math.sin(a) * 13, z: Math.cos(a) * 13, r: 2.0 };
});
export const RULES = { winsNeeded: 4, countdown: 3.5, roundEnd: 4.0, dampStart: 60, dampRate: 1.2, gcd: 1.0 };
export const FIGHTER_R = 0.6;
const MOVE_ABS = new Set(['arcane_shift', 'shadow_leap', 'bull_rush', 'gale_dash']);
const STUNLIKE = ['stun', 'disorient'];
const RES_NAME = { mana: 'mana', energy: 'energy', rage: 'rage' };

// ---------------------------------------------------------------- helpers
export const getBuff = (f, type) => f.buffs.find(b => b.type === type);
export const hasBuff = (f, type) => f.buffs.some(b => b.type === type);
export const isStunned = f => f.buffs.some(b => b.type === 'stun' || b.type === 'disorient');
export function speedMult(f) {
  let slow = 0, fast = 0;
  for (const b of f.buffs) {
    if (b.type === 'slow') slow = Math.max(slow, b.value);
    else if (b.type === 'speed') fast = Math.max(fast, b.value);
  }
  return (1 + fast) * (1 - slow);
}
export const angleTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
export function angleDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }

export function segBlocked(ax, az, bx, bz) {
  for (const p of PILLARS) {
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz || 1e-6;
    let t = ((p.x - ax) * dx + (p.z - az) * dz) / L2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + dx * t - p.x, cz = az + dz * t - p.z;
    if (cx * cx + cz * cz < (p.r - 0.15) * (p.r - 0.15)) return true;
  }
  return false;
}

export function collide(f, other) {
  for (const p of PILLARS) {
    const dx = f.x - p.x, dz = f.z - p.z, d = Math.hypot(dx, dz), min = p.r + FIGHTER_R;
    if (d < min) { const k = (min - d) / (d || 1e-6); f.x += dx * k; f.z += dz * k; }
  }
  const d = Math.hypot(f.x, f.z), max = ARENA_R - FIGHTER_R;
  if (d > max) { f.x *= max / d; f.z *= max / d; }
  if (other && other.alive) {
    const dx = f.x - other.x, dz = f.z - other.z, dd = Math.hypot(dx, dz), min = FIGHTER_R * 2;
    if (dd < min && Math.abs(f.y - other.y) < 1.6) { const k = (min - dd) / (dd || 1e-6); f.x += dx * k; f.z += dz * k; }
  }
}

// Shared movement integration (used by the host sim and by the guest for prediction).
// inp: { mx (strafe right +), mz (forward +), yaw, jump, sprint }
export function moveFighter(f, inp, dt, other, canAct = true) {
  if (!f.alive) return;
  const stunned = isStunned(f), rooted = hasBuff(f, 'root');
  if (!stunned) f.yaw = inp.yaw;
  let mx = inp.mx || 0, mz = inp.mz || 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  let speed = CLASSES[f.cls].speed * speedMult(f);
  if (hasBuff(f, 'tempest')) speed *= 0.8;
  const wantsSprint = inp.sprint && mz > 0.2 && len > 0 && canAct && !stunned && !rooted;
  if (wantsSprint && f.stamina > 0.5) { speed *= 1.3; f.stamina = Math.max(0, f.stamina - 30 * dt); f.sprinting = true; }
  else { f.sprinting = false; if (!inp.sprint || len === 0) f.stamina = Math.min(100, f.stamina + 15 * dt); }
  if (mz < -0.1) speed *= 0.65;
  if (!canAct || stunned || rooted || f.locked) { mx = 0; mz = 0; }
  const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
  const vx = (sy * mz - cy * mx) * speed, vz = (cy * mz + sy * mx) * speed;
  const ox = f.x, oz = f.z;
  f.x += vx * dt; f.z += vz * dt;
  // jumping & gravity
  if (inp.jump && f.y <= 0.001 && canAct && !stunned && !rooted && !f.locked) { f.vy = 7.8; }
  if (f.y > 0 || f.vy > 0) { f.vy -= 24 * dt; f.y += f.vy * dt; if (f.y <= 0) { f.y = 0; f.vy = 0; } }
  collide(f, other);
  const moved = Math.hypot(f.x - ox, f.z - oz);
  f.moving = moved > 0.2 * dt;
  f.moveDir = f.moving ? { x: (f.x - ox) / moved, z: (f.z - oz) / moved } : null;
}

// ---------------------------------------------------------------- fighter
function makeFighter(id, cls) {
  const C = CLASSES[cls];
  return {
    id, cls, x: 0, y: 0, z: 0, vy: 0, yaw: 0, hp: C.hp, maxHp: C.hp,
    res: C.resStart ?? C.res, maxRes: C.res, resType: C.resType,
    cds: [0, 0, 0, 0, 0, 0], gcd: 0, cast: null, buffs: [], cp: 0, stamina: 100, alive: true,
    moving: false, sprinting: false, autoT: 0, forceSeq: 0, forceYaw: 0, locked: false, dash: null,
    target: 1 - id, dr: {}, queued: null, moveDir: null,
    stats: { dmg: 0, heal: 0, absorbed: 0, ccs: 0, interrupts: 0 },
  };
}

let NEXT_ID = 1;

export class Sim {
  constructor(clsA, clsB) {
    this.fighters = [makeFighter(0, clsA), makeFighter(1, clsB)];
    this.projectiles = [];
    this.zones = [];
    this.events = [];
    this.score = [0, 0];
    this.round = 0;
    this.state = 'countdown';
    this.stateT = 0;
    this.fightT = 0;
    this.damp = 0;
    this.time = 0;
    this.winner = -1;
    this.startRound();
  }

  // ------------------------------------------------------------ flow
  startRound() {
    this.round++;
    this.projectiles = []; this.zones = [];
    for (const f of this.fighters) {
      const C = CLASSES[f.cls];
      Object.assign(f, {
        hp: C.hp, maxHp: C.hp, res: C.resStart ?? C.res, maxRes: C.res, cds: [0, 0, 0, 0, 0, 0], gcd: 0, cast: null, buffs: [],
        cp: 0, stamina: 100, alive: true, vy: 0, y: 0, dash: null, locked: false, dr: {}, queued: null, autoT: 0, target: 1 - f.id,
      });
      f.x = 0; f.z = f.id === 0 ? -20 : 20; f.yaw = f.id === 0 ? 0 : Math.PI;
      f.forceSeq++; f.forceYaw++;
    }
    this.state = 'countdown'; this.stateT = RULES.countdown; this.fightT = 0; this.damp = 0;
    this.event({ e: 'roundStart', round: this.round });
  }

  resetMatch(clsA, clsB) {
    if (clsA) { this.fighters[0] = makeFighter(0, clsA); }
    if (clsB) { this.fighters[1] = makeFighter(1, clsB); }
    for (const f of this.fighters) f.stats = { dmg: 0, heal: 0, absorbed: 0, ccs: 0, interrupts: 0 };
    this.score = [0, 0]; this.round = 0; this.winner = -1;
    this.startRound();
  }

  event(ev) { this.events.push(ev); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // inputs[i]: { mx, mz, yaw, jump, sprint, abilities: [{i, dir}], targetReq, remote: {x,y,z,yaw,moving,ack} }
  step(dt, inputs) {
    this.time += dt;
    if (this.state === 'countdown') {
      this.stateT -= dt;
      for (const f of this.fighters) {
        const inp = inputs[f.id] || {};
        if (inp.remote) { f.yaw = inp.remote.yaw; } else if (inp.yaw !== undefined) f.yaw = inp.yaw;
      }
      if (this.stateT <= 0) { this.state = 'fight'; this.fightT = 0; this.event({ e: 'fight' }); }
      return;
    }
    if (this.state === 'roundEnd') {
      this.stateT -= dt;
      for (const f of this.fighters) this.moveStep(f, inputs[f.id] || {}, dt, false);
      if (this.stateT <= 0) {
        if (this.score[0] >= RULES.winsNeeded || this.score[1] >= RULES.winsNeeded) {
          this.state = 'matchEnd'; this.winner = this.score[0] > this.score[1] ? 0 : 1;
          this.event({ e: 'matchEnd', winner: this.winner, score: [...this.score] });
        } else this.startRound();
      }
      return;
    }
    if (this.state === 'matchEnd') { for (const f of this.fighters) this.moveStep(f, inputs[f.id] || {}, dt, false); return; }

    // ---- fight
    this.fightT += dt;
    this.damp = Math.min(100, Math.max(0, (this.fightT - RULES.dampStart) * RULES.dampRate));

    for (const f of this.fighters) {
      const inp = inputs[f.id] || {};
      this.moveStep(f, inp, dt, true);
      if (inp.targetReq) this.retarget(f);
      if (inp.abilities) for (const a of inp.abilities) this.tryAbility(f, a.i, a);
    }
    for (const f of this.fighters) this.updateFighter(f, dt);
    this.updateProjectiles(dt);
    this.updateZones(dt);
    this.checkDeaths();
  }

  moveStep(f, inp, dt, canAct) {
    const other = this.fighters[1 - f.id];
    if (f.dash) { this.updateDash(f, dt); return; }
    if (inp.remote) {
      const r = inp.remote;
      // Remote client owns its position, unless we forced a move it has not yet acknowledged.
      if (r.ack === f.forceSeq && f.alive) {
        const stunned = isStunned(f), rooted = hasBuff(f, 'root');
        if (!stunned && !rooted && canAct) { f.x = r.x; f.z = r.z; }
        if (canAct || r.y < f.y) f.y = r.y;
        if (!stunned) f.yaw = r.yaw;
        f.moving = !!r.moving && canAct && !stunned && !rooted;
        f.sprinting = !!r.sprinting; f.stamina = r.stamina ?? f.stamina;
        collide(f, other);
      }
    } else {
      moveFighter(f, inp, dt, other, canAct && this.state === 'fight');
    }
  }

  retarget(f) {
    const o = this.fighters[1 - f.id];
    if (this.visibleTo(o, f)) f.target = o.id;
  }

  // ------------------------------------------------------------ queries
  enemiesOf(f) { return this.fighters.filter(o => o.id !== f.id && o.alive); }
  dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  los(a, b) { return !segBlocked(a.x, a.z, b.x, b.z); }
  forward(f) { return { x: Math.sin(f.yaw), z: Math.cos(f.yaw) }; }
  visibleTo(t, viewer) { return t.alive && !hasBuff(t, 'stealth'); }
  shieldAmt(v) { return Math.round(v * (1 - this.damp / 100)); }

  // Dry-run check; returns an error string or null.
  check(f, idx, ignoreGcd = false) {
    const ab = CLASSES[f.cls].abilities[idx];
    if (!ab || this.state !== 'fight' || !f.alive) return 'Not now';
    if (f.dash) return 'Busy';
    if (f.cast && ab.gcd) return 'Already casting';
    if (isStunned(f) && !ab.allowCC) return 'You can\'t do that while stunned';
    if (hasBuff(f, 'tempest') && ab.id !== 'steel_tempest') return 'Can\'t do that while spinning';
    if (hasBuff(f, 'silence') && ab.school !== 'phys') return 'You are silenced';
    if (hasBuff(f, 'root') && MOVE_ABS.has(ab.id) && !ab.allowRooted) return 'You are rooted';
    if (ab.cast > 0 && f.y > 0.05) return "You can't cast while jumping";
    if (f.cds[idx] > 0) return 'Ability not ready yet';
    if (ab.gcd && f.gcd > 0 && !ignoreGcd) return 'GCD';
    if (ab.cost > f.res) return `Not enough ${RES_NAME[f.resType]}`;
    if (ab.needsCp && f.cp < 1) return 'No combo points';
    if (ab.target) {
      const t = this.fighters[1 - f.id];
      if (!this.visibleTo(t, f)) return 'No target';
      const d = this.dist(f, t);
      if (d > ab.range + 0.3) return 'Out of range';
      if (ab.minRange && d < ab.minRange) return 'Too close';
      if (!ab.melee && !this.los(f, t)) return 'Target not in line of sight';
      if (ab.melee && Math.abs(angleDiff(f.yaw, angleTo(f, t))) > 1.45) return 'You must face your target';
    }
    return null;
  }

  tryAbility(f, idx, opts = {}) {
    const ab = CLASSES[f.cls].abilities[idx];
    if (!ab) return 'bad';
    if (this.state !== 'fight') return 'Not now';
    if (f.cast && !ab.gcd && MOVE_ABS.has(ab.id)) this.cancelCast(f, false);
    const err = this.check(f, idx);
    if (err) {
      if (err === 'GCD') {
        // Spell queue window: buffer the press so it fires the moment the GCD ends.
        if (f.gcd <= 0.4) f.queued = { i: idx, dir: opts.dir, t: 0.5 };
        return null;
      }
      if (err !== 'Not now') this.event({ e: 'err', id: f.id, msg: err });
      return err;
    }
    const t = this.fighters[1 - f.id];
    if (ab.target) f.target = t.id;
    if (ab.gcd) f.gcd = RULES.gcd;
    if (ab.cast > 0) {
      f.cast = { idx, t: 0, dur: ab.cast };
      this.event({ e: 'caststart', id: f.id, ab: ab.id, dur: ab.cast });
      return null;
    }
    this.execute(f, idx, opts);
    return null;
  }

  execute(f, idx, opts) {
    const ab = CLASSES[f.cls].abilities[idx];
    const t = this.fighters[1 - f.id];
    f.res -= ab.cost;
    f.cds[idx] = ab.cd;
    if (!ab.keepStealth) this.removeBuff(f, 'stealth');
    this.event({ e: 'ab', id: f.id, ab: ab.id, tid: ab.target ? t.id : -1 });
    ab.exec(this, f, t, opts || {});
  }

  cancelCast(f, interrupted) {
    if (!f.cast) return;
    const ab = CLASSES[f.cls].abilities[f.cast.idx];
    f.cast = null;
    this.event({ e: interrupted ? 'interrupted' : 'castfail', id: f.id, ab: ab.id });
  }

  interrupt(t, lock) { if (t.cast) { this.cancelCast(t, true); const src = this.fighters[1 - t.id]; src.stats.interrupts++; } }

  dropTarget(c) {
    for (const o of this.fighters) if (o.id !== c.id && o.target === c.id) o.target = -1;
    for (const o of this.fighters) if (o.id !== c.id && o.cast) {
      const ab = CLASSES[o.cls].abilities[o.cast.idx];
      if (ab.target) { this.cancelCast(o, false); this.event({ e: 'err', id: o.id, msg: 'Your target vanished' }); }
    }
  }

  // ------------------------------------------------------------ per-tick fighter logic
  updateFighter(f, dt) {
    if (!f.alive) return;
    const C = CLASSES[f.cls];
    f.gcd = Math.max(0, f.gcd - dt);
    for (let i = 0; i < 6; i++) f.cds[i] = Math.max(0, f.cds[i] - dt);
    // resource
    if (f.resType === 'rage') f.res = Math.min(f.maxRes, f.res + C.regen * dt);
    else f.res = Math.min(f.maxRes, f.res + C.regen * dt);
    // queued ability
    if (f.queued) {
      f.queued.t -= dt;
      if (f.gcd <= 0) { const q = f.queued; f.queued = null; this.tryAbility(f, q.i, q); }
      else if (f.queued.t <= 0) f.queued = null;
    }
    // casting
    if (f.cast) {
      if (f.moving || f.y > 0.05) { this.cancelCast(f, false); }
      else if (isStunned(f) || (hasBuff(f, 'silence'))) { this.cancelCast(f, true); }
      else {
        f.cast.t += dt;
        if (f.cast.t >= f.cast.dur) {
          const idx = f.cast.idx, ab = C.abilities[idx];
          f.cast = null;
          const t = this.fighters[1 - f.id];
          let err = null;
          if (ab.cost > f.res) err = `Not enough ${RES_NAME[f.resType]}`;
          else if (ab.target) {
            if (!this.visibleTo(t, f)) err = 'No target';
            else if (this.dist(f, t) > ab.range + 2) err = 'Out of range';
            else if (!this.los(f, t)) err = 'Target not in line of sight';
          }
          if (err) { this.event({ e: 'castfail', id: f.id, ab: ab.id }); this.event({ e: 'err', id: f.id, msg: err }); }
          else this.execute(f, idx, {});
        }
      }
    }
    // auto attack
    if (C.auto) {
      f.autoT = Math.max(0, f.autoT - dt);
      const t = this.fighters[1 - f.id];
      if (f.autoT <= 0 && f.target === t.id && this.visibleTo(t, f) && !isStunned(f) && !f.cast && !f.dash && !hasBuff(f, 'stealth') && !hasBuff(f, 'tempest')
        && this.dist(f, t) <= 4.5 && Math.abs(angleDiff(f.yaw, angleTo(f, t))) < 1.45) {
        f.autoT = C.auto.speed;
        this.event({ e: 'auto', id: f.id, tid: t.id });
        this.damage(f, t, C.auto.dmg, { school: 'phys', ab: 'auto', auto: true });
      }
    }
    // buffs
    for (let i = f.buffs.length - 1; i >= 0; i--) {
      const b = f.buffs[i];
      b.t -= dt; b.age = (b.age || 0) + dt;
      if (b.type === 'dot') {
        b.data.acc += dt;
        while (b.data.acc >= 1 && b.data.ticks > 0) {
          b.data.acc -= 1; b.data.ticks--;
          this.damage(this.fighters[b.src], f, b.data.per, { school: b.data.school, ab: 'dot', dot: true });
        }
      } else if (b.type === 'tempest') {
        b.data.tick -= dt;
        if (b.data.tick <= 0) {
          b.data.tick += 0.5;
          for (const e of this.enemiesOf(f)) if (this.dist(f, e) <= 6) this.damage(f, e, 38, { school: 'phys', ab: 'steel_tempest', tick: true });
        }
      } else if (b.type === 'spirit') {
        b.data.tick -= dt;
        if (b.data.tick <= 0) {
          b.data.tick += 1.2;
          const t = this.fighters[1 - f.id];
          if (this.visibleTo(t, f) && this.dist(f, t) <= 32 && this.los(f, t)) {
            this.event({ e: 'fx', fx: 'spirit_cast', id: f.id });
            this.spawnProjectile(f, t, 'spirit_bolt', 30, () => this.damage(f, t, 40, { school: 'fire', ab: 'fire_spirit' }), 1.0);
          }
        }
      }
      if (b.t <= 0) {
        f.buffs.splice(i, 1);
        if (b.type === 'mark') {
          const src = this.fighters[b.src];
          this.event({ e: 'fx', fx: 'death_mark_pop', id: f.id, x: f.x, z: f.z });
          if (f.alive) this.damage(src, f, 120 + b.data.stored, { school: 'shadow', ab: 'death_mark', big: true, noMark: true });
        }
        this.event({ e: 'buffEnd', id: f.id, type: b.type, name: b.name });
      }
    }
    for (const k in f.dr) { f.dr[k].t += dt; }
  }

  updateDash(f, dt) {
    const d = f.dash;
    d.t -= dt;
    let tx, tz;
    if (d.homing !== undefined) { const t = this.fighters[d.homing]; tx = t.x; tz = t.z; }
    let vx = d.vx, vz = d.vz;
    if (d.homing !== undefined) {
      const dx = tx - f.x, dz = tz - f.z, L = Math.hypot(dx, dz);
      if (L <= 1.8) { this.endDash(f, true); return; }
      vx = dx / L; vz = dz / L; f.yaw = Math.atan2(vx, vz);
    }
    const step = d.speed * dt;
    const nx = f.x + vx * step, nz = f.z + vz * step;
    let blocked = false;
    for (const p of PILLARS) if (Math.hypot(nx - p.x, nz - p.z) < p.r + FIGHTER_R) blocked = true;
    if (Math.hypot(nx, nz) > ARENA_R - FIGHTER_R) blocked = true;
    if (!blocked) { f.x = nx; f.z = nz; }
    if (blocked || d.t <= 0) this.endDash(f, false);
  }

  endDash(f, arrived) {
    const d = f.dash; f.dash = null; f.locked = false; f.forceSeq++; f.forceYaw++;
    if (arrived && d.onArrive) d.onArrive();
    this.event({ e: 'dashEnd', id: f.id, fx: d.fx });
  }

  // ------------------------------------------------------------ effects API (used by abilities)
  damage(src, tgt, amount, o = {}) {
    if (!tgt.alive || this.state !== 'fight') return 0;
    let amt = amount * (0.93 + Math.random() * 0.14);
    const amb = getBuff(src, 'ambush');
    if (amb && !o.dot && !o.auto && !o.tick) { amt *= 1.6; this.removeBuff(src, 'ambush'); o.big = true; }
    amt *= 1 - CLASSES[tgt.cls].defense;
    for (const b of tgt.buffs) if (b.type === 'dr' || b.type === 'stoneskin') amt *= 1 - b.value;
    amt = Math.max(1, Math.round(amt));
    let absorbed = 0;
    for (const b of tgt.buffs) {
      if (b.type !== 'absorb' || amt <= 0) continue;
      const a = Math.min(b.value, amt); b.value -= a; amt -= a; absorbed += a;
      if (b.value <= 0) b.t = 0;
    }
    tgt.hp -= amt;
    src.stats.dmg += amt;
    tgt.stats.absorbed += absorbed;
    if (src.resType === 'rage') src.res = Math.min(src.maxRes, src.res + (amt + absorbed) * 0.075);
    if (tgt.resType === 'rage') tgt.res = Math.min(tgt.maxRes, tgt.res + (amt + absorbed) * 0.06);
    if (!o.noMark) {
      const m = tgt.buffs.find(b => b.type === 'mark' && b.src === src.id);
      if (m) m.data.stored = Math.round(m.data.stored + (amt + absorbed) * 0.35);
    }
    if (!o.dot) {
      // direct damage breaks disorient and stealth
      const dis = tgt.buffs.find(b => b.type === 'disorient' && b.age > 0.3);
      if (dis) { this.removeBuff(tgt, 'disorient'); }
      if (hasBuff(tgt, 'stealth')) this.removeBuff(tgt, 'stealth');
    }
    this.event({ e: 'dmg', id: tgt.id, src: src.id, amt, abs: absorbed, school: o.school || 'phys', ab: o.ab, big: !!o.big, dot: !!o.dot });
    if (tgt.hp <= 0) tgt.hp = 0;
    return amt;
  }

  heal(src, tgt, amount, ab) {
    if (!tgt.alive) return 0;
    let amt = amount * (0.95 + Math.random() * 0.1);
    const hr = tgt.buffs.reduce((m, b) => b.type === 'healred' ? Math.max(m, b.value) : m, 0);
    amt *= (1 - hr) * (1 - this.damp / 100);
    amt = Math.round(Math.min(amt, tgt.maxHp - tgt.hp));
    tgt.hp += amt;
    src.stats.heal += amt;
    this.event({ e: 'heal', id: tgt.id, amt, ab });
    return amt;
  }

  addBuff(f, type, dur, o = {}) {
    if (!f.alive) return null;
    if (o.cc) {
      if (hasBuff(f, 'tempest') || hasBuff(f, 'ccimmune')) { this.event({ e: 'immune', id: f.id }); return null; }
      const dr = f.dr[o.cc];
      if (dr && dr.t > 15) delete f.dr[o.cc];
      const n = f.dr[o.cc] ? f.dr[o.cc].n : 0;
      if (n >= 3) { this.event({ e: 'immune', id: f.id }); return null; }
      dur *= [1, 0.5, 0.25][n];
      f.dr[o.cc] = { n: n + 1, t: 0 };
      this.fighters[o.src]?.stats && (this.fighters[o.src].stats.ccs++);
    }
    // refresh same-named buff from the same source
    const ex = f.buffs.find(b => b.type === type && b.name === o.name && b.src === o.src);
    if (ex) { ex.t = Math.max(ex.t, dur); ex.dur = Math.max(ex.t, ex.dur); if (o.value !== undefined) ex.value = Math.max(ex.value, o.value); if (o.data) ex.data = o.data; return ex; }
    const b = { id: NEXT_ID++, type, t: dur, dur, value: o.value ?? 0, src: o.src ?? f.id, name: o.name || type, icon: o.icon || '', data: o.data || {}, age: 0, fx: o.fx || '' };
    f.buffs.push(b);
    if (STUNLIKE.includes(type) && f.cast) this.cancelCast(f, true);
    if (type === 'stun' || type === 'disorient') f.queued = null;
    this.event({ e: 'buff', id: f.id, type, name: b.name, src: b.src, fx: b.fx, dur });
    return b;
  }

  addDot(src, tgt, name, total, dur, school, icon) {
    const ticks = Math.round(dur);
    this.addBuff(tgt, 'dot', dur + 0.05, { src: src.id, name, icon, data: { acc: 0, ticks, per: total / ticks, school } });
    const b = tgt.buffs.find(x => x.type === 'dot' && x.name === name && x.src === src.id);
    if (b) { b.data = { acc: 0, ticks, per: total / ticks, school }; b.t = dur + 0.05; }
  }

  removeBuff(f, type) {
    const had = f.buffs.some(b => b.type === type);
    f.buffs = f.buffs.filter(b => b.type !== type);
    if (had) this.event({ e: 'buffEnd', id: f.id, type });
  }

  cleanse(f, types) {
    const before = f.buffs.length;
    f.buffs = f.buffs.filter(b => !(types.includes(b.type) && b.src !== f.id));
    if (f.buffs.length !== before) this.event({ e: 'cleanse', id: f.id });
  }

  spawnProjectile(src, tgt, kind, speed, onHit, yOff = 0) {
    const fw = this.forward(src);
    this.projectiles.push({ id: NEXT_ID++, kind, owner: src.id, target: tgt.id, x: src.x + fw.x * 0.8, y: src.y + 1.7 + yOff, z: src.z + fw.z * 0.8, speed, onHit, life: 4 });
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const t = this.fighters[p.target];
      p.life -= dt;
      if (!t.alive || hasBuff(t, 'stealth') || p.life <= 0) {
        this.event({ e: 'fizzle', kind: p.kind, x: p.x, y: p.y, z: p.z });
        this.projectiles.splice(i, 1); continue;
      }
      const tx = t.x, ty = t.y + 1.2, tz = t.z;
      const dx = tx - p.x, dy = ty - p.y, dz = tz - p.z, d = Math.hypot(dx, dy, dz);
      const step = p.speed * dt;
      if (d <= step + 0.4) {
        this.projectiles.splice(i, 1);
        this.event({ e: 'hit', kind: p.kind, id: t.id, x: tx, y: ty, z: tz });
        p.onHit();
      } else { p.x += dx / d * step; p.y += dy / d * step; p.z += dz / d * step; }
    }
  }

  spawnZone(z) {
    const zone = { id: NEXT_ID++, t: 0, data: {}, ...z };
    this.zones.push(zone);
    this.event({ e: 'zone', zone: { id: zone.id, type: zone.type, x: zone.x, z: zone.z, r: zone.r, dur: zone.dur, owner: zone.owner } });
  }

  updateZones(dt) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.t += dt;
      const owner = this.fighters[z.owner];
      if (z.type === 'quake' && z.t >= z.dur) {
        this.event({ e: 'fx', fx: 'quake_erupt', id: z.owner, x: z.x, z: z.z });
        for (const f of this.enemiesOf(owner)) if (Math.hypot(f.x - z.x, f.z - z.z) <= z.r && f.y < 1.5) {
          this.damage(owner, f, 35, { school: 'nature', ab: 'quake_totem' });
          this.interrupt(f, 0);
          this.addBuff(f, 'stun', 1.75, { src: owner.id, cc: 'cc', name: 'Quaked', icon: '⛰' });
        }
      } else if (z.type === 'stoneskin') {
        if (owner.alive && Math.hypot(owner.x - z.x, owner.z - z.z) <= z.r) {
          const b = owner.buffs.find(b => b.type === 'stoneskin');
          if (b) b.t = 0.3; else this.addBuff(owner, 'stoneskin', 0.3, { value: 0.2, src: owner.id, name: 'Stoneskin', icon: '⬢' });
          z.data.acc = (z.data.acc || 0) + dt;
          if (z.data.acc >= 1) { z.data.acc -= 1; this.heal(owner, owner, 25, 'stoneskin'); }
        }
        for (const e of this.enemiesOf(owner)) if (Math.hypot(e.x - z.x, e.z - z.z) <= z.r) {
          const s = e.buffs.find(b => b.type === 'slow' && b.name === 'Earthbound');
          if (s) s.t = 0.3; else this.addBuff(e, 'slow', 0.3, { value: 0.3, src: owner.id, name: 'Earthbound', icon: '⬢' });
        }
      }
      if (z.t >= z.dur) { this.zones.splice(i, 1); this.event({ e: 'zoneEnd', id: z.id }); }
    }
  }

  // ------------------------------------------------------------ movement abilities
  validSpot(x, z) {
    if (Math.hypot(x, z) > ARENA_R - FIGHTER_R) return false;
    for (const p of PILLARS) if (Math.hypot(x - p.x, z - p.z) < p.r + FIGHTER_R) return false;
    return true;
  }

  blink(f, dx, dz, dist, fx) {
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const x0 = f.x, z0 = f.z;
    let bx = f.x, bz = f.z;
    for (let s = 0.5; s <= dist; s += 0.5) {
      const nx = x0 + dx * s, nz = z0 + dz * s;
      if (!this.validSpot(nx, nz)) break;
      bx = nx; bz = nz;
    }
    f.x = bx; f.z = bz; f.forceSeq++;
    this.event({ e: 'blink', id: f.id, fx, x0, z0, x1: bx, z1: bz });
  }

  dashDir(f, dx, dz, dist, dur, fx) {
    const L = Math.hypot(dx, dz) || 1;
    f.dash = { vx: dx / L, vz: dz / L, speed: dist / dur, t: dur, fx };
    f.locked = true; f.forceSeq++;
    this.event({ e: 'dash', id: f.id, fx });
  }

  charge(f, t, onArrive) {
    f.dash = { homing: t.id, speed: 40, t: 1.0, fx: 'bull_rush', onArrive };
    f.locked = true; f.forceSeq++;
    this.event({ e: 'dash', id: f.id, fx: 'bull_rush' });
  }

  shadowLeap(f, t) {
    const x0 = f.x, z0 = f.z;
    const fw = this.forward(t);
    const cands = [[-fw.x, -fw.z], [fw.z, -fw.x], [-fw.z, fw.x], [fw.x, fw.z]];
    for (const [cx, cz] of cands) {
      const nx = t.x + cx * 1.6, nz = t.z + cz * 1.6;
      if (this.validSpot(nx, nz)) { f.x = nx; f.z = nz; break; }
    }
    f.yaw = angleTo(f, t);
    f.forceSeq++; f.forceYaw++;
    this.event({ e: 'blink', id: f.id, fx: 'shadow_leap', x0, z0, x1: f.x, z1: f.z });
  }

  // ------------------------------------------------------------ round resolution
  checkDeaths() {
    const dead = this.fighters.filter(f => f.alive && f.hp <= 0);
    if (!dead.length) return;
    for (const f of dead) { f.alive = false; f.cast = null; f.dash = null; f.locked = false; this.event({ e: 'death', id: f.id }); }
    const alive = this.fighters.filter(f => f.alive);
    let winner = -1;
    if (alive.length === 1) { winner = alive[0].id; this.score[winner]++; }
    this.state = 'roundEnd'; this.stateT = RULES.roundEnd;
    this.event({ e: 'roundEnd', winner, score: [...this.score], round: this.round });
  }

  // ------------------------------------------------------------ network snapshot
  snapshot() {
    const r = v => Math.round(v * 100) / 100;
    return {
      s: this.state, st: r(this.stateT), r: this.round, sc: this.score, ft: r(this.fightT), dp: r(this.damp), w: this.winner,
      f: this.fighters.map(f => ({
        cls: f.cls, x: r(f.x), y: r(f.y), z: r(f.z), yaw: r(f.yaw), hp: Math.round(f.hp), maxHp: f.maxHp, res: Math.round(f.res), maxRes: f.maxRes, resType: f.resType,
        cds: f.cds.map(r), gcd: r(f.gcd), cast: f.cast ? { idx: f.cast.idx, t: r(f.cast.t), dur: f.cast.dur } : null,
        buffs: f.buffs.map(b => ({ type: b.type, t: r(b.t), dur: r(b.dur), value: r(b.value), name: b.name, icon: b.icon, src: b.src, fx: b.fx })),
        cp: f.cp, alive: f.alive, forceSeq: f.forceSeq, forceYaw: f.forceYaw, locked: f.locked, target: f.target, moving: f.moving, sprinting: f.sprinting, stamina: Math.round(f.stamina),
        stats: f.stats,
      })),
      p: this.projectiles.map(p => ({ id: p.id, kind: p.kind, x: r(p.x), y: r(p.y), z: r(p.z), owner: p.owner })),
      z: this.zones.map(z => ({ id: z.id, type: z.type, x: z.x, z: z.z, r: z.r, t: r(z.t), dur: z.dur, owner: z.owner })),
    };
  }
}
