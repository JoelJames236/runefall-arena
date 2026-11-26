// Authoritative combat simulation. Runs on the host (or locally vs. AI).
// Pure logic — no rendering — so it can be serialized and driven over the network.
// Supports any number of fighters split into two teams (1v1 and 2v2).
import { CLASSES, kitOf, validSpec } from '../data/classes.js';

export const ARENA_R = 29;
export const PILLARS = [0, 1, 2, 3].map(i => {
  const a = Math.PI / 4 + i * Math.PI / 2;
  return { x: Math.sin(a) * 13, z: Math.cos(a) * 13, r: 2.0 };
});
export const RULES = { winsNeeded: 4, countdown: 3.5, roundEnd: 4.0, dampStart: 60, dampRate: 1.2, gcd: 1.0, critChance: 0.08, critMult: 1.5, backMult: 1.1 };
export const FIGHTER_R = 0.6;
export const MOVE_CAST_SPEED = 0.65;
const MOVE_ABS = new Set(['arcane_shift', 'shadow_leap', 'bull_rush', 'gale_dash', 'skull_leap', 'blazing_step']);
// Berserker passive: up to +60% damage as health drops (linear with missing health)
export const bloodrage = f => f.cls === 'berserker' ? 1 + (CLASSES.berserker.passive.maxBonus) * (1 - Math.max(0, f.hp) / f.maxHp) : 1;
const STUNLIKE = ['stun', 'disorient'];
const RES_NAME = { mana: 'mana', energy: 'energy', rage: 'rage' };
const MELEE_AUTO_RANGE = 4.5;

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
// true when `src` stands behind `tgt` (outside the target's front ~220° arc)
export const isBehind = (src, tgt) => Math.abs(angleDiff(tgt.yaw, angleTo(tgt, src))) > 1.92;

// ---------------------------------------------------------------- the central bridge
// A stone arch bridge across the middle along the x axis (between the two spawns, which sit on the z axis).
// Deck: |x| <= hx, |z| <= hz at height H — walk on top, or run through the vaulted arch underneath.
// Ramps: hx < |x| <= hx + ramp, solid embankments sloping from H down to the floor.
export const BRIDGE = { hx: 6.5, hz: 1.9, H: 4.4, ramp: 9, slab: 0.45 };
const BR = BRIDGE, BR_END = BRIDGE.hx + BRIDGE.ramp, BW = BRIDGE.hz + 0.25; // BW: half width incl. parapets
// one edge for everything: inside it you either stand on the bridge or are blocked by it (never trapped in between)
export const EDGE = BW + 0.3;
export const rampH = ax => BR.H * Math.max(0, Math.min(1, (BR_END - ax) / BR.ramp));
// height of the walkable surface under a fighter whose feet are at y
export function floorAt(x, z, y) {
  if (Math.abs(z) > EDGE) return 0;
  const ax = Math.abs(x);
  if (ax <= BR.hx) return y >= BR.H - 0.9 ? BR.H : 0;
  if (ax <= BR_END) { const h = rampH(ax); return y >= h - 0.75 ? h : 0; }
  return 0;
}
// The arch: a barrel vault through the whole bridge. archY = height of its underside at |x|
// (flattened ellipse, so the opening is wide). Above it, up to the deck, is solid stone.
const ARCH_TOP = BRIDGE.H - BRIDGE.slab - 0.3, ARCH_P = 2.6;
export const archY = ax => ax >= BR.hx ? 0 : ARCH_TOP * Math.pow(1 - Math.pow(ax / BR.hx, ARCH_P), 1 / ARCH_P);
export const HEAD_ROOM = 2.35; // tallest champion (horns included) fits where the vault is at least this high
// half width of the walkable passage through the arch (body radius included)
export const ARCH_OPEN = BRIDGE.hx * Math.pow(1 - Math.pow(HEAD_ROOM / ARCH_TOP, ARCH_P), 1 / ARCH_P) - 0.35;
// true when a fighter with feet at y can't stand here (inside a ramp embankment or the arch masonry)
export function solidAt(x, z, y) {
  const ax = Math.abs(x), az = Math.abs(z);
  if (az > EDGE) return false;
  if (ax <= BR.hx) return y < BR.H - 0.9 && ax > ARCH_OPEN;
  return ax <= BR_END + 0.3 && y < rampH(ax) - 0.75;
}
// where a leap/teleport ending at height y comes to rest (never inside a ramp)
export function landAt(x, z, y) {
  if (Math.abs(z) > EDGE) return 0;
  const ax = Math.abs(x);
  if (ax <= BR.hx) return y >= BR.H - 1.4 ? BR.H : 0;
  return ax <= BR_END ? rampH(ax) : 0;
}
// under the vault a jump bumps the ceiling: highest feet position at this spot (Infinity = open sky)
export function ceilAt(x, z, y) {
  const ax = Math.abs(x);
  if (ax > BR.hx + 0.2 || Math.abs(z) > EDGE || y >= BR.H - 0.9) return Infinity;
  return Math.max(0, archY(Math.min(BR.hx, ax + 0.3)) - 2.1);
}
export const airborne = f => f.y - floorAt(f.x, f.z, f.y) > 0.05;
// shoved into the masonry (by another fighter, a pillar push, lag...): move out the shortest way
export function unstick(f) {
  if (!solidAt(f.x, f.z, f.y)) return;
  const ax = Math.abs(f.x), az = Math.abs(f.z);
  const opts = [{ c: EDGE + 0.02 - az, go: () => { f.z = Math.sign(f.z || 1) * (EDGE + 0.02); } }];
  if (ax <= BR.hx) opts.push({ c: ax - ARCH_OPEN + 0.02, go: () => { f.x = Math.sign(f.x) * (ARCH_OPEN - 0.02); } });
  else { const h = rampH(ax); opts.push({ c: (h - f.y) * 0.6, go: () => { f.y = h; f.vy = 0; } }); }
  opts.sort((a, b) => a.c - b.c)[0].go();
}
// distance used for ranges: a level difference counts double (no melee from under the bridge)
export function rangeDist(a, b) {
  const dh = floorAt(a.x, a.z, a.y) - floorAt(b.x, b.z, b.y);
  return Math.hypot(a.x - b.x, a.z - b.z, dh * 2);
}
// Liang-Barsky: does segment A + tD (t in 0..1) intersect the convex region { n·P <= b for all planes }?
function clipSeg(A, D, planes) {
  let t0 = 0, t1 = 1;
  for (const [nx, ny, nz, b] of planes) {
    const p = nx * A[0] + ny * A[1] + nz * A[2], q = nx * D[0] + ny * D[1] + nz * D[2];
    if (Math.abs(q) < 1e-9) { if (p > b) return false; continue; }
    const t = (b - p) / q;
    if (q > 0) t1 = Math.min(t1, t); else t0 = Math.max(t0, t);
    if (t0 > t1) return false;
  }
  return true;
}
const RS = BRIDGE.H * BR_END - 0.1 * BRIDGE.ramp;
const RAMP_SOLIDS = [ // triangular prisms: x beyond the deck, under the slope
  [[-1, 0, 0, -BR.hx], [0, 0, 1, BW], [0, 0, -1, BW], [BR.H, BR.ramp, 0, RS]],
  [[1, 0, 0, -BR.hx], [0, 0, 1, BW], [0, 0, -1, BW], [-BR.H, BR.ramp, 0, RS]],
];
// does the 3D segment a->b pass through the bridge masonry (ramps, or deck + vault above the arch)?
function bridgeBlocks(ax, ay, az, bx, by, bz) {
  if ((ax > BR_END && bx > BR_END) || (ax < -BR_END && bx < -BR_END) || (az > BW && bz > BW) || (az < -BW && bz < -BW)) return false;
  const A = [ax, ay, az], D = [bx - ax, by - ay, bz - az];
  for (const s of RAMP_SOLIDS) if (clipSeg(A, D, s)) return true;
  // middle section: clip to |x| <= hx, |z| <= BW. Below the arch (a convex tunnel) and above the deck
  // (a half-space) are open; anything else is stone. So test the clipped endpoints only.
  let t0 = 0, t1 = 1;
  for (const [p, d, h] of [[ax, D[0], BR.hx], [az, D[2], BW]]) {
    if (Math.abs(d) < 1e-9) { if (Math.abs(p) > h) return false; continue; }
    let u0 = (-h - p) / d, u1 = (h - p) / d; if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0); t1 = Math.min(t1, u1); if (t0 > t1) return false;
  }
  const kind = t => { const x = Math.abs(ax + D[0] * t), y = ay + D[1] * t; return y >= BR.H - 0.05 ? 'A' : y <= archY(x) ? 'T' : 'S'; };
  const k0 = kind(t0), k1 = kind(t1);
  return k0 === 'S' || k1 === 'S' || k0 !== k1;
}

// line of sight between eye points (y = eye height; defaults to standing on the floor)
export function segBlocked(ax, az, bx, bz, ay = 1.5, by = 1.5) {
  if (bridgeBlocks(ax, ay, az, bx, by, bz)) return true;
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

// others: array of fighters to keep distance from (may include f itself; it is skipped)
export function collide(f, others) {
  for (const p of PILLARS) {
    const dx = f.x - p.x, dz = f.z - p.z, d = Math.hypot(dx, dz), min = p.r + FIGHTER_R;
    if (d < min) { const k = (min - d) / (d || 1e-6); f.x += dx * k; f.z += dz * k; }
  }
  const d = Math.hypot(f.x, f.z), max = ARENA_R - FIGHTER_R;
  if (d > max) { f.x *= max / d; f.z *= max / d; }
  if (others) for (const o of others) {
    if (!o || o === f || o.id === f.id || !o.alive) continue;
    const dx = f.x - o.x, dz = f.z - o.z, dd = Math.hypot(dx, dz), min = FIGHTER_R * 2;
    if (dd < min && Math.abs(f.y - o.y) < 1.6) { const k = (min - dd) / (dd || 1e-6); f.x += dx * k; f.z += dz * k; }
  }
  unstick(f);
}

// Shared movement integration (used by the host sim and by guests for prediction).
// inp: { mx (strafe right +), mz (forward +), yaw, jump, sprint }
export function moveFighter(f, inp, dt, others, canAct = true) {
  if (!f.alive) return;
  const stunned = isStunned(f), rooted = hasBuff(f, 'root');
  if (!stunned && inp.yaw !== undefined) f.yaw = inp.yaw;
  let mx = inp.mx || 0, mz = inp.mz || 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  let speed = kitOf(f).speed * speedMult(f);
  if (hasBuff(f, 'tempest')) speed *= 0.8;
  if (f.cast && kitOf(f).abilities[f.cast.idx]?.moveCast) speed *= MOVE_CAST_SPEED; // casting on the move (Fire Mage) is slower
  const wantsSprint = inp.sprint && mz > 0.2 && len > 0 && canAct && !stunned && !rooted;
  if (wantsSprint && f.stamina > 0.5) { speed *= 1.3; f.stamina = Math.max(0, f.stamina - 30 * dt); f.sprinting = true; }
  else { f.sprinting = false; if (!inp.sprint || len === 0) f.stamina = Math.min(100, f.stamina + 15 * dt); }
  if (mz < -0.1) speed *= 0.65;
  if (!canAct || stunned || rooted || f.locked) { mx = 0; mz = 0; }
  const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
  const vx = (sy * mz - cy * mx) * speed, vz = (cy * mz + sy * mx) * speed;
  const ox = f.x, oz = f.z;
  const grounded = f.vy <= 0 && f.y <= floorAt(ox, oz, f.y) + 0.001;
  f.x += vx * dt; f.z += vz * dt;
  if (solidAt(f.x, f.z, f.y)) { // slide along the ramp embankments
    if (!solidAt(ox, f.z, f.y)) f.x = ox; else if (!solidAt(f.x, oz, f.y)) f.z = oz; else { f.x = ox; f.z = oz; }
  }
  if (inp.jump && grounded && canAct && !stunned && !rooted && !f.locked) { f.vy = 7.8; }
  let fl = floorAt(f.x, f.z, f.y);
  if (f.vy > 0 || f.y > fl + 0.001) {
    if (grounded && f.vy <= 0 && f.y - fl < 0.6) f.y = fl; // follow the slope down a ramp
    else {
      const y0 = f.y; f.vy -= 24 * dt; f.y += f.vy * dt;
      fl = floorAt(f.x, f.z, Math.max(y0, f.y));
      if (f.y <= fl) { f.y = fl; f.vy = 0; }
    }
  } else if (f.y < fl) f.y = fl; // step up onto a ramp
  { const c = ceilAt(f.x, f.z, f.y); if (f.y > c) { f.y = c; f.vy = Math.min(0, f.vy); } } // bump the vault
  collide(f, others);
  const moved = Math.hypot(f.x - ox, f.z - oz);
  f.moving = moved > 0.2 * dt;
  f.moveDir = f.moving ? { x: (f.x - ox) / moved, z: (f.z - oz) / moved } : null;
}

// ---------------------------------------------------------------- fighter
const freshStats = () => ({ dmg: 0, heal: 0, absorbed: 0, ccs: 0, interrupts: 0, crits: 0, kills: 0 });

function makeFighter(id, spec) {
  const sid = validSpec(spec.cls, spec.spec), C = kitOf({ cls: spec.cls, spec: sid });
  return {
    id, cls: spec.cls, spec: sid, team: spec.team, name: spec.name || C.name, bot: !!spec.bot,
    x: 0, y: 0, z: 0, vy: 0, yaw: 0, hp: C.hp, maxHp: C.hp,
    res: C.resStart ?? C.res, maxRes: C.res, resType: C.resType,
    cds: [0, 0, 0, 0, 0, 0], ch: C.abilities.map(a => a.charges || 0), gcd: 0, cast: null, buffs: [], cp: 0, stamina: 100, alive: true,
    moving: false, sprinting: false, autoT: 0, autoOn: false, forceSeq: 0, forceYaw: 0, locked: false, dash: null,
    target: -1, friend: -1, dr: {}, queued: null, moveDir: null,
    stats: freshStats(),
  };
}

let NEXT_ID = 1;

export class Sim {
  // roster: [{ cls, team, name, bot }]  — or legacy (clsA, clsB) for a 1v1
  constructor(roster, clsB) {
    if (typeof roster === 'string') roster = [{ cls: roster, team: 0 }, { cls: clsB, team: 1 }];
    this.fighters = roster.map((s, i) => makeFighter(i, s));
    this.teamSize = [0, 1].map(t => this.fighters.filter(f => f.team === t).length);
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
  spawnOf(f) {
    const mates = this.fighters.filter(o => o.team === f.team);
    const k = mates.indexOf(f), n = mates.length;
    const x = n === 1 ? 0 : (k - (n - 1) / 2) * 7;
    return { x: f.team === 0 ? x : -x, z: f.team === 0 ? -20 : 20, yaw: f.team === 0 ? 0 : Math.PI };
  }

  startRound() {
    this.round++;
    this.projectiles = []; this.zones = [];
    for (const f of this.fighters) {
      const C = kitOf(f);
      Object.assign(f, {
        hp: C.hp, maxHp: C.hp, res: C.resStart ?? C.res, maxRes: C.res, cds: [0, 0, 0, 0, 0, 0], ch: C.abilities.map(a => a.charges || 0), gcd: 0, cast: null, buffs: [],
        cp: 0, stamina: 100, alive: true, vy: 0, y: 0, dash: null, locked: false, dr: {}, queued: null, autoT: 0, autoOn: false,
        target: this.defaultTarget(f), friend: -1,
      });
      const s = this.spawnOf(f);
      f.x = s.x; f.z = s.z; f.yaw = s.yaw;
      f.forceSeq++; f.forceYaw++;
    }
    this.state = 'countdown'; this.stateT = RULES.countdown; this.fightT = 0; this.damp = 0;
    this.event({ e: 'roundStart', round: this.round });
  }

  defaultTarget(f) {
    const foes = this.fighters.filter(o => o.team !== f.team);
    if (!foes.length) return -1;
    // face-off: target the enemy standing opposite you
    const mates = this.fighters.filter(o => o.team === f.team);
    return foes[Math.min(foes.length - 1, mates.indexOf(f))].id;
  }

  resetMatch() {
    for (const f of this.fighters) f.stats = freshStats();
    this.score = [0, 0]; this.round = 0; this.winner = -1;
    this.startRound();
  }

  event(ev) { this.events.push(ev); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // inputs[i]: { mx, mz, yaw, jump, sprint, abilities: [{i, dir, tid}], attack, setTarget, setFriend, targetReq,
  //              remote: {x,y,z,yaw,moving,ack} }
  step(dt, inputs) {
    this.time += dt;
    if (this.state === 'countdown') {
      this.stateT -= dt;
      for (const f of this.fighters) {
        const inp = inputs[f.id] || {};
        if (inp.remote) { f.yaw = inp.remote.yaw; } else if (inp.yaw !== undefined) f.yaw = inp.yaw;
        this.applyTargeting(f, inp);
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
      this.applyTargeting(f, inp);
      if (f.alive && inp.abilities) for (const a of inp.abilities) this.tryAbility(f, a.i, a);
      if (f.alive && inp.attack) this.startAttack(f, true);
    }
    for (const f of this.fighters) this.updateFighter(f, dt);
    this.updateProjectiles(dt);
    this.updateZones(dt);
    this.checkDeaths();
  }

  applyTargeting(f, inp) {
    if (inp.setTarget !== undefined && inp.setTarget !== null) {
      const t = this.fighters[inp.setTarget];
      if (t && t.team !== f.team && this.visibleTo(t, f)) f.target = t.id;
    }
    if (inp.setFriend !== undefined && inp.setFriend !== null) {
      const a = this.fighters[inp.setFriend];
      f.friend = (a && a.team === f.team) ? a.id : -1;
    }
    if (inp.targetReq) this.cycleTarget(f);
  }

  moveStep(f, inp, dt, canAct) {
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
        collide(f, this.fighters);
      }
    } else {
      moveFighter(f, inp, dt, this.fighters, canAct && this.state === 'fight');
    }
  }

  // Tab: cycle through visible enemies (nearest first after the current one)
  cycleTarget(f) {
    const list = this.enemiesOf(f).filter(o => this.visibleTo(o, f)).sort((a, b) => this.dist(f, a) - this.dist(f, b));
    if (!list.length) return;
    const i = list.findIndex(o => o.id === f.target);
    f.target = list[(i + 1) % list.length].id;
  }

  // ------------------------------------------------------------ queries
  enemiesOf(f) { return this.fighters.filter(o => o.team !== f.team && o.alive); }
  alliesOf(f) { return this.fighters.filter(o => o.team === f.team && o.id !== f.id && o.alive); }
  dist(a, b) { return rangeDist(a, b); }
  los(a, b) { return !segBlocked(a.x, a.z, b.x, b.z, a.y + 1.5, b.y + 1.5); }
  forward(f) { return { x: Math.sin(f.yaw), z: Math.cos(f.yaw) }; }
  visibleTo(t, viewer) { return !!t && t.alive && (!hasBuff(t, 'stealth') || (viewer && t.team === viewer.team)); }
  shieldAmt(v) { return Math.round(v * (1 - this.damp / 100)); }

  // Current hostile target, or the best visible enemy (in front, nearest) when there is none.
  hostileFor(f, tid, autoPick = true) {
    const pick = tid ?? f.target;
    const t = this.fighters[pick];
    if (t && t.team !== f.team && this.visibleTo(t, f)) return t;
    if (!autoPick) return null;
    let best = null, bestScore = Infinity;
    for (const o of this.enemiesOf(f)) {
      if (!this.visibleTo(o, f)) continue;
      const facing = Math.abs(angleDiff(f.yaw, angleTo(f, o)));
      const score = this.dist(f, o) + facing * 8;
      if (score < bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  // Friendly target for ally-cast spells: explicit tid / selected friend if valid, else self.
  friendlyFor(f, tid) {
    const pick = tid ?? f.friend;
    const a = this.fighters[pick];
    if (a && a.team === f.team && a.alive) return a;
    return f;
  }

  resolveTarget(f, ab, opts = {}) {
    if (ab.target) return this.hostileFor(f, opts.tid);
    if (ab.ally) return this.friendlyFor(f, opts.tid);
    return null;
  }

  // Dry-run check; returns an error string or null.
  check(f, idx, ignoreGcd = false, opts = {}) {
    const ab = kitOf(f).abilities[idx];
    if (!ab || this.state !== 'fight' || !f.alive) return 'Not now';
    if (f.dash) return 'Busy';
    if (f.cast && ab.gcd) return 'Already casting';
    if (isStunned(f) && !ab.allowCC) return "You can't do that while stunned";
    if (hasBuff(f, 'tempest') && ab.id !== 'steel_tempest' && ab.id !== 'bladestorm') return "Can't do that while spinning";
    if (hasBuff(f, 'silence') && ab.school !== 'phys') return 'You are silenced';
    if (hasBuff(f, 'root') && MOVE_ABS.has(ab.id) && !ab.allowRooted) return 'You are rooted';
    if (ab.cast > 0 && airborne(f)) return "You can't cast while jumping";
    if (ab.charges ? f.ch[idx] <= 0 : f.cds[idx] > 0) return 'Ability not ready yet';
    if (ab.gcd && f.gcd > 0 && !ignoreGcd) return 'GCD';
    if (ab.cost > f.res) return `Not enough ${RES_NAME[f.resType]}`;
    if (ab.needsCp && f.cp < 1) return 'No combo points';
    if (ab.target) {
      const t = this.hostileFor(f, opts.tid);
      if (!t) return 'No target';
      const d = this.dist(f, t);
      if (d > ab.range + 0.3) return 'Out of range';
      if (ab.minRange && d < ab.minRange) return 'Too close';
      if (!ab.melee && !this.los(f, t)) return 'Target not in line of sight';
      if (ab.melee && Math.abs(angleDiff(f.yaw, angleTo(f, t))) > 1.45) return 'You must face your target';
    }
    if (ab.ally) {
      const a = this.friendlyFor(f, opts.tid);
      if (a !== f) {
        if (this.dist(f, a) > ab.range + 0.3) return 'Ally out of range';
        if (!this.los(f, a)) return 'Ally not in line of sight';
      }
    }
    return null;
  }

  tryAbility(f, idx, opts = {}) {
    const ab = kitOf(f).abilities[idx];
    if (!ab) return 'bad';
    if (this.state !== 'fight') return 'Not now';
    if (f.cast && !ab.gcd && MOVE_ABS.has(ab.id)) this.cancelCast(f, false);
    const err = this.check(f, idx, false, opts);
    if (err) {
      if (err === 'GCD') {
        // Spell queue window: buffer the press so it fires the moment the GCD ends.
        if (f.gcd <= 0.4) f.queued = { i: idx, dir: opts.dir, tid: opts.tid, t: 0.5 };
        return null;
      }
      if (err !== 'Not now') this.event({ e: 'err', id: f.id, msg: err });
      return err;
    }
    const t = this.resolveTarget(f, ab, opts);
    if (ab.target && t) { f.target = t.id; if (ab.melee) f.autoOn = true; }
    if (ab.gcd) f.gcd = RULES.gcd;
    if (ab.cast > 0) {
      f.cast = { idx, t: 0, dur: ab.cast, tid: t ? t.id : -1 };
      this.event({ e: 'caststart', id: f.id, ab: ab.id, dur: ab.cast, tid: t ? t.id : -1 });
      return null;
    }
    this.execute(f, idx, t, opts);
    return null;
  }

  execute(f, idx, t, opts) {
    const ab = kitOf(f).abilities[idx];
    f.res -= ab.cost;
    if (ab.charges) { f.ch[idx]--; if (f.cds[idx] <= 0) f.cds[idx] = ab.cd; } // charges refill one at a time
    else f.cds[idx] = ab.cd;
    if (!ab.keepStealth) this.removeBuff(f, 'stealth');
    this.event({ e: 'ab', id: f.id, ab: ab.id, tid: t ? t.id : -1 });
    ab.exec(this, f, t || f, opts || {});
  }

  cancelCast(f, interrupted) {
    if (!f.cast) return;
    const ab = kitOf(f).abilities[f.cast.idx];
    f.cast = null;
    this.event({ e: interrupted ? 'interrupted' : 'castfail', id: f.id, ab: ab.id });
  }

  interrupt(t, src) { if (t.cast) { this.cancelCast(t, true); if (src && src.stats) src.stats.interrupts++; } }

  dropTarget(c) {
    for (const o of this.fighters) if (o.team !== c.team && o.target === c.id) { o.target = -1; o.autoOn = false; }
    for (const o of this.fighters) if (o.team !== c.team && o.cast && o.cast.tid === c.id) {
      this.cancelCast(o, false); this.event({ e: 'err', id: o.id, msg: 'Your target vanished' });
    }
  }

  // ------------------------------------------------------------ basic attacks
  // Left click: turn on auto-attack against the current (or best) target. The swing timer
  // limits the rate, so clicking faster never attacks faster.
  startAttack(f, explicit) {
    if (!f.alive || this.state !== 'fight') return;
    const t = this.hostileFor(f);
    if (!t) { if (explicit) this.event({ e: 'err', id: f.id, msg: 'No target' }); return; }
    f.target = t.id;
    f.autoOn = true;
    if (explicit) {
      const A = kitOf(f).auto, d = this.dist(f, t);
      if (d > A.range + 0.3) this.event({ e: 'err', id: f.id, msg: 'Out of range' });
      else if (A.ranged && !this.los(f, t)) this.event({ e: 'err', id: f.id, msg: 'Target not in line of sight' });
      else if (!A.ranged && Math.abs(angleDiff(f.yaw, angleTo(f, t))) > 1.45) this.event({ e: 'err', id: f.id, msg: 'You must face your target' });
    }
  }

  updateAuto(f, dt) {
    const A = kitOf(f).auto;
    f.autoT = Math.max(0, f.autoT - dt);
    if (!A || !f.autoOn) return;
    const t = this.fighters[f.target];
    if (!t || t.team === f.team || !this.visibleTo(t, f)) { f.autoOn = false; return; }
    if (f.autoT > 0 || isStunned(f) || f.cast || f.dash || hasBuff(f, 'tempest')) return;
    const d = this.dist(f, t);
    if (A.ranged) { if (d > A.range + 0.3 || !this.los(f, t)) return; }
    else if (d > MELEE_AUTO_RANGE || Math.abs(angleDiff(f.yaw, angleTo(f, t))) > 1.45) return;
    f.autoT = A.speed / (hasBuff(f, 'berserk') ? 1.3 : 1);
    this.removeBuff(f, 'stealth');
    this.event({ e: 'auto', id: f.id, tid: t.id, ranged: !!A.ranged });
    if (A.ranged) this.spawnProjectile(f, t, A.proj, A.projSpeed, () => { this.damage(f, t, A.dmg, { school: A.school, ab: 'auto', auto: true }); if (A.burn) this.kindle(f, t); });
    else { this.damage(f, t, A.dmg, { school: A.school, ab: 'auto', auto: true }); if (A.poison) this.poison(f, t); }
  }

  // ------------------------------------------------------------ per-tick fighter logic
  updateFighter(f, dt) {
    if (!f.alive) return;
    const C = kitOf(f);
    f.gcd = Math.max(0, f.gcd - dt);
    for (let i = 0; i < 6; i++) {
      f.cds[i] = Math.max(0, f.cds[i] - dt);
      const mx = C.abilities[i]?.charges; // recharge: one charge per cooldown, then restart while not full
      if (mx && f.cds[i] <= 0 && f.ch[i] < mx) { f.ch[i]++; if (f.ch[i] < mx) f.cds[i] = C.abilities[i].cd; }
    }
    f.res = Math.min(f.maxRes, f.res + C.regen * dt);
    // queued ability
    if (f.queued) {
      f.queued.t -= dt;
      if (f.gcd <= 0) { const q = f.queued; f.queued = null; this.tryAbility(f, q.i, q); }
      else if (f.queued.t <= 0) f.queued = null;
    }
    // casting
    if (f.cast) {
      if ((f.moving && !C.abilities[f.cast.idx].moveCast) || airborne(f)) { this.cancelCast(f, false); } // moveCast: castable on the move
      else if (isStunned(f) || hasBuff(f, 'silence')) { this.cancelCast(f, true); }
      else {
        f.cast.t += dt;
        if (f.cast.t >= f.cast.dur) {
          const { idx, tid } = f.cast, ab = C.abilities[idx];
          f.cast = null;
          let t = tid >= 0 ? this.fighters[tid] : null;
          let err = null;
          if (ab.cost > f.res) err = `Not enough ${RES_NAME[f.resType]}`;
          else if (ab.target) {
            if (!this.visibleTo(t, f)) err = 'No target';
            else if (this.dist(f, t) > ab.range + 2) err = 'Out of range';
            else if (!this.los(f, t)) err = 'Target not in line of sight';
          } else if (ab.ally) {
            if (!t || !t.alive) t = f;
            if (t !== f && (this.dist(f, t) > ab.range + 2 || !this.los(f, t))) err = 'Ally out of range';
          }
          if (err) { this.event({ e: 'castfail', id: f.id, ab: ab.id }); this.event({ e: 'err', id: f.id, msg: err }); }
          else this.execute(f, idx, t, {});
        }
      }
    }
    this.updateAuto(f, dt);
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
          for (const e of this.enemiesOf(f)) if (this.dist(f, e) <= 6) this.damage(f, e, b.data.dmg || 38, { school: 'phys', ab: b.data.ab || 'steel_tempest', tick: true });
        }
      } else if (b.type === 'spirit') {
        b.data.tick -= dt;
        if (b.data.tick <= 0) {
          b.data.tick += 1.2;
          const t = this.hostileFor(f);
          if (t && this.dist(f, t) <= 32 && this.los(f, t)) {
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
    let vx = d.vx, vz = d.vz;
    if (d.homing !== undefined) {
      const t = this.fighters[d.homing];
      const dx = t.x - f.x, dz = t.z - f.z, L = Math.hypot(dx, dz);
      // a charge can't reach a target on another level (e.g. on the bridge above): it stops short
      if (L <= 1.8) { this.endDash(f, d.arc || Math.abs(t.y - f.y) < 1.6); return; }
      vx = dx / L; vz = dz / L; f.yaw = Math.atan2(vx, vz);
    }
    // leaps travel along a parabolic arc (from the start height to the target's height)
    if (d.arc) {
      const t = this.fighters[d.homing];
      if (d.total === undefined) { d.total = Math.max(1, Math.hypot(t.x - f.x, t.z - f.z)); d.y0 = f.y; }
      d.done = (d.done || 0) + d.speed * dt; const u = Math.min(1, d.done / d.total);
      f.y = d.y0 + (t.y - d.y0) * u + 4 * d.arc * u * (1 - u);
    }
    const step = d.speed * dt;
    const nx = f.x + vx * step, nz = f.z + vz * step;
    let blocked = false;
    if (!d.arc) {
      for (const p of PILLARS) if (Math.hypot(nx - p.x, nz - p.z) < p.r + FIGHTER_R) blocked = true; // leaps clear pillars
      if (solidAt(nx, nz, f.y)) blocked = true;
    }
    if (Math.hypot(nx, nz) > ARENA_R - FIGHTER_R) blocked = true;
    if (!blocked) {
      f.x = nx; f.z = nz;
      if (!d.arc) { const fl = floorAt(nx, nz, f.y); if (fl > f.y || f.y - fl < 0.6) f.y = fl; } // dashes follow ramps
      if (!d.arc) f.y = Math.min(f.y, ceilAt(f.x, f.z, f.y));
      else if (Math.abs(f.z) <= BW + 0.5 && Math.abs(f.x) <= BR_END + 0.3) { // leaps sail over the bridge, not through it
        const ax = Math.abs(f.x), top = ax <= BR.hx ? BR.H : rampH(ax);
        if (f.y < top + 0.1 && f.y > archY(ax) - 2.1) f.y = top + 0.1;
      }
    }
    if (blocked || d.t <= 0) this.endDash(f, false);
  }

  endDash(f, arrived) {
    const d = f.dash; f.dash = null; f.locked = false; f.forceSeq++; f.forceYaw++;
    if (d.arc) { f.y = landAt(f.x, f.z, f.y); f.vy = 0; }
    if (arrived && d.onArrive) d.onArrive();
    this.event({ e: 'dashEnd', id: f.id, fx: d.fx });
  }

  // ------------------------------------------------------------ effects API (used by abilities)
  damage(src, tgt, amount, o = {}) {
    if (!tgt.alive || this.state !== 'fight') return 0;
    let amt = amount * (0.94 + Math.random() * 0.12);
    const direct = !o.dot && !o.tick;
    const amb = getBuff(src, 'ambush');
    if (amb && direct && !o.auto) { amt *= 1.4; this.removeBuff(src, 'ambush'); o.big = true; }
    // positional bonus: hits from behind deal 10% more damage
    const back = src !== tgt && !o.dot && isBehind(src, tgt);
    if (back) amt *= RULES.backMult;
    const SP = kitOf(src).passive || {}; // e.g. Executioner "Heavy Hands": more and bigger crits
    const crit = direct && !o.noCrit && (o.forceCrit || Math.random() < RULES.critChance + (SP.critBonus || 0) + (SP.critVsRooted && hasBuff(tgt, 'root') ? SP.critVsRooted : 0)); // Frost Shatter
    if (crit) { amt *= SP.critMult || RULES.critMult; src.stats.crits++; }
    amt *= bloodrage(src);
    // spec passives: execute bonus (Arms), poison bonus (Assassination), school bonus / damage taken (Shadowform)
    if (SP.executeBonus && tgt.hp / tgt.maxHp < SP.executeAt) amt *= 1 + SP.executeBonus;
    if (SP.poisonBonus) amt *= 1 + SP.poisonBonus * this.stacksOf(src, tgt, 'Deadly Poison');
    if (SP.schoolBonus) amt *= 1 + (SP.schoolBonus[o.school] || 0);
    const TP = kitOf(tgt).passive; if (TP && TP.takenMult) amt *= TP.takenMult;
    const bz = getBuff(src, 'berserk'); if (bz) amt *= 1 + bz.value;
    amt *= 1 - kitOf(tgt).defense;
    for (const b of tgt.buffs) if (b.type === 'dr' || b.type === 'stoneskin') amt *= 1 - b.value;
    amt *= this.shieldwall(tgt);
    if (src.cls === 'warrior' && this.teamSize[src.team] >= 2) amt *= 1 + (SP.dmg || 0); // Shieldwall: team-play damage
    // Berserker Bloodrage, team play only: up to 25% less damage taken as health drops
    if (tgt.cls === 'berserker' && this.teamSize[tgt.team] >= 2) amt *= 1 - 0.25 * (1 - Math.max(0, tgt.hp) / tgt.maxHp);
    amt = Math.max(1, Math.round(amt));
    let absorbed = 0;
    for (const b of tgt.buffs) {
      if (b.type !== 'absorb' || amt <= 0) continue;
      const a = Math.min(b.value, amt); b.value -= a; amt -= a; absorbed += a;
      if (b.value <= 0) b.t = 0;
    }
    tgt.hp -= amt;
    src.stats.dmg += amt;
    const ls = getBuff(src, 'lifesteal');
    if (ls && src !== tgt && src.alive) { const h = Math.round((amt + absorbed) * ls.value * (1 - this.damp / 100)); if (h > 0) { src.hp = Math.min(src.maxHp, src.hp + h); src.stats.heal += h; this.event({ e: 'heal', id: src.id, src: src.id, amt: h, ab: 'lifesteal' }); } }
    tgt.stats.absorbed += absorbed;
    if (src.resType === 'rage') src.res = Math.min(src.maxRes, src.res + (amt + absorbed) * 0.075);
    if (tgt.resType === 'rage') tgt.res = Math.min(tgt.maxRes, tgt.res + (amt + absorbed) * 0.07);
    // Shieldwall, team play: a warrior near a hurt ally gains rage from the blows the ally takes
    if (this.teamSize[tgt.team] >= 2) for (const w of this.fighters) if (w.cls === 'warrior' && w.alive && w !== tgt && w.team === tgt.team && kitOf(w).passive.rageShare && this.dist(w, tgt) <= kitOf(w).passive.radius) w.res = Math.min(w.maxRes, w.res + (amt + absorbed) * kitOf(w).passive.rageShare);
    if (!o.noMark) {
      const m = tgt.buffs.find(b => b.type === 'mark' && b.src === src.id);
      if (m) m.data.stored = Math.round(m.data.stored + (amt + absorbed) * 0.3);
    }
    if (!o.dot) {
      // direct damage breaks disorient and stealth
      const dis = tgt.buffs.find(b => b.type === 'disorient' && b.age > 0.3);
      if (dis) { this.removeBuff(tgt, 'disorient'); }
      if (hasBuff(tgt, 'stealth')) this.removeBuff(tgt, 'stealth');
    }
    this.event({ e: 'dmg', id: tgt.id, src: src.id, amt, abs: absorbed, school: o.school || 'phys', ab: o.ab, big: !!o.big, dot: !!o.dot, crit, back });
    if (tgt.hp <= 0) { tgt.hp = 0; tgt.killer = src.id; }
    return amt;
  }

  // Warrior passive Shieldwall (team play only): damage-taken multiplier. The warrior himself always
  // takes `self` less (he is the frontline); allies within `radius` of a living warrior take `ally` less.
  shieldwall(t) {
    if (this.teamSize[t.team] < 2) return 1;
    const P = kitOf(t).passive || {};
    if (t.cls === 'warrior') return 1 - (P.self || 0); // only Protection has Shieldwall
    for (const w of this.fighters) { const WP = kitOf(w).passive; if (w.cls === 'warrior' && WP.ally && w.alive && w.team === t.team && w !== t && this.dist(w, t) <= WP.radius) return 1 - WP.ally; }
    return 1;
  }

  heal(src, tgt, amount, ab) {
    if (!tgt.alive) return 0;
    let amt = amount * (0.95 + Math.random() * 0.1);
    const crit = Math.random() < RULES.critChance;
    if (crit) amt *= RULES.critMult;
    const hr = tgt.buffs.reduce((m, b) => b.type === 'healred' ? Math.max(m, b.value) : m, 0);
    amt *= (1 - hr) * (1 - this.damp / 100);
    amt = Math.round(Math.min(amt, tgt.maxHp - tgt.hp));
    tgt.hp += amt;
    src.stats.heal += amt;
    this.event({ e: 'heal', id: tgt.id, src: src.id, amt, ab, crit });
    return amt;
  }

  addBuff(f, type, dur, o = {}) {
    if (!f.alive) return null;
    if (type === 'slow' && o.src !== f.id && hasBuff(f, 'berserk')) return null; // berserk: immune to slows
    if (o.cc) {
      if (hasBuff(f, 'tempest') || hasBuff(f, 'ccimmune')) { this.event({ e: 'immune', id: f.id }); return null; }
      if (o.cc === 'root' && hasBuff(f, 'berserk')) { this.event({ e: 'immune', id: f.id }); return null; }
      const dr = f.dr[o.cc];
      if (dr && dr.t > 15) delete f.dr[o.cc];
      const n = f.dr[o.cc] ? f.dr[o.cc].n : 0;
      if (n >= 3) { this.event({ e: 'immune', id: f.id }); return null; }
      dur *= [1, 0.5, 0.25][n];
      f.dr[o.cc] = { n: n + 1, t: 0 };
      const s = this.fighters[o.src]; if (s) s.stats.ccs++;
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
  // Fire Mage passive Kindling: a stacking Burning DoT (max 3 stacks, 25 damage over 4 sec per stack)
  // stacking DoT: each application adds a stack (up to max) and refreshes the duration
  stackDot(src, tgt, name, perStack, dur, max, school, icon) {
    if (!tgt.alive) return 0;
    const find = () => tgt.buffs.find(x => x.type === 'dot' && x.name === name && x.src === src.id);
    const n = Math.min(max, (find()?.data.stacks || 0) + 1);
    this.addDot(src, tgt, name, perStack * n, dur, school, icon);
    const b = find(); if (b) b.data.stacks = n;
    return n;
  }
  stacksOf(src, tgt, name) { return tgt.buffs.find(x => x.type === 'dot' && x.name === name && x.src === src.id)?.data.stacks || 0; }
  // Fire Mage passive Kindling: Burning stacks up to 3 (25 damage over 4 sec per stack)
  kindle(src, tgt) { return this.stackDot(src, tgt, 'Burning', 25, 4, 3, 'fire', '🔥'); }
  // Assassination passive Venom Mastery: Deadly Poison stacks up to 5 (14 damage over 4 sec per stack)
  poison(src, tgt) { return this.stackDot(src, tgt, 'Deadly Poison', 14, 4, 5, 'nature', '☠'); }

  addDot(src, tgt, name, total, dur, school, icon) {
    const ticks = Math.round(dur);
    this.addBuff(tgt, 'dot', dur + 0.05, { src: src.id, name, icon, data: { acc: 0, ticks, per: total / ticks, school } });
    const b = tgt.buffs.find(x => x.type === 'dot' && x.name === name && x.src === src.id);
    if (b) { b.data = { acc: 0, ticks, per: total / ticks, school }; b.t = dur + 0.05; }
  }

  removeBuff(f, type) {
    const had = f.buffs.some(b => b.type === type);
    if (!had) return;
    f.buffs = f.buffs.filter(b => b.type !== type);
    this.event({ e: 'buffEnd', id: f.id, type });
  }

  // remove harmful effects of the given types (anything applied by an enemy)
  cleanse(f, types) {
    const before = f.buffs.length;
    f.buffs = f.buffs.filter(b => !(types.includes(b.type) && this.fighters[b.src]?.team !== f.team));
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
      if (!t.alive || (hasBuff(t, 'stealth')) || p.life <= 0) {
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
    const o = this.fighters[zone.owner];
    const yr = zone.yRef !== undefined ? this.fighters[zone.yRef] : o; // yRef: sits on that fighter's level (e.g. Meteor on its target)
    if (zone.y === undefined) zone.y = floorAt(zone.x, zone.z, yr ? yr.y : 0); // totems sit on the level they were dropped on
    this.zones.push(zone);
    this.event({ e: 'zone', zone: { id: zone.id, type: zone.type, x: zone.x, y: zone.y, z: zone.z, r: zone.r, dur: zone.dur, owner: zone.owner } });
  }
  // inside a ground zone: in radius and on the same level (bridge deck vs. floor below)
  inZone(f, z) { return Math.hypot(f.x - z.x, f.z - z.z) <= z.r && Math.abs(floorAt(f.x, f.z, f.y) - z.y) < 1.2; }

  updateZones(dt) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.t += dt;
      const owner = this.fighters[z.owner];
      if (z.type === 'quake' && z.t >= z.dur) {
        this.event({ e: 'fx', fx: 'quake_erupt', id: z.owner, x: z.x, z: z.z });
        for (const f of this.enemiesOf(owner)) if (this.inZone(f, z) && f.y - z.y < 1.5) {
          this.damage(owner, f, 35, { school: 'nature', ab: 'quake_totem' });
          this.interrupt(f, owner);
          this.addBuff(f, 'stun', 1.75, { src: owner.id, cc: 'cc', name: 'Quaked', icon: '⛰' });
        }
      } else if (z.type === 'meteor' && z.t >= z.dur) {
        // Fire Mage signature: the meteor lands where the target stood when it was called
        this.event({ e: 'fx', fx: 'meteor_impact', id: z.owner, x: z.x, y: z.y, z: z.z });
        for (const f of this.enemiesOf(owner)) if (this.inZone(f, z)) {
          this.damage(owner, f, z.data.dmg || 170, { school: 'fire', ab: 'meteor', big: true });
          this.addBuff(f, 'stun', 1, { src: owner.id, cc: 'cc', name: 'Meteor Strike', icon: '☄' });
          if (z.data.burn) this.kindle(owner, f);
        }
      } else if (z.type === 'plague') {
        // Assassination signature: every second, enemies inside take damage and gain a Deadly Poison stack
        z.data.acc = (z.data.acc || 0) + dt;
        if (z.data.acc >= 1) { z.data.acc -= 1; for (const e of this.enemiesOf(owner)) if (this.inZone(e, z)) { this.damage(owner, e, 16, { school: 'nature', ab: 'plague_cloud', tick: true }); this.poison(owner, e); } }
      } else if (z.type === 'stoneskin') {
        z.data.acc = (z.data.acc || 0) + dt;
        const tick = z.data.acc >= 1; if (tick) z.data.acc -= 1;
        for (const a of this.fighters) {
          if (!a.alive || a.team !== owner.team || !this.inZone(a, z)) continue;
          const b = a.buffs.find(b => b.type === 'stoneskin');
          if (b) b.t = 0.3; else this.addBuff(a, 'stoneskin', 0.3, { value: 0.2, src: owner.id, name: 'Stoneskin', icon: '⬢' });
          if (tick) this.heal(owner, a, 20, 'stoneskin');
        }
        for (const e of this.enemiesOf(owner)) if (this.inZone(e, z)) {
          const s = e.buffs.find(b => b.type === 'slow' && b.name === 'Earthbound');
          if (s) s.t = 0.3; else this.addBuff(e, 'slow', 0.3, { value: 0.3, src: owner.id, name: 'Earthbound', icon: '⬢' });
        }
      }
      if (z.t >= z.dur) { this.zones.splice(i, 1); this.event({ e: 'zoneEnd', id: z.id }); }
    }
  }

  // ------------------------------------------------------------ movement abilities
  validSpot(x, z, y = 0) {
    if (Math.hypot(x, z) > ARENA_R - FIGHTER_R) return false;
    for (const p of PILLARS) if (Math.hypot(x - p.x, z - p.z) < p.r + FIGHTER_R) return false;
    return !solidAt(x, z, y);
  }

  blink(f, dx, dz, dist, fx) {
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const x0 = f.x, z0 = f.z;
    let bx = f.x, bz = f.z, by = f.y;
    for (let s = 0.5; s <= dist; s += 0.5) {
      const nx = x0 + dx * s, nz = z0 + dz * s;
      if (!this.validSpot(nx, nz, by)) break;
      const fl = floorAt(nx, nz, by); if (fl > by || by - fl < 0.6) by = fl; // follow ramps; past the deck edge we drop
      bx = nx; bz = nz;
    }
    f.x = bx; f.z = bz; f.y = by; f.forceSeq++;
    this.event({ e: 'blink', id: f.id, fx, x0, z0, x1: bx, z1: bz });
  }

  dashDir(f, dx, dz, dist, dur, fx) {
    const L = Math.hypot(dx, dz) || 1;
    f.dash = { vx: dx / L, vz: dz / L, speed: dist / dur, t: dur, fx };
    f.locked = true; f.forceSeq++;
    this.event({ e: 'dash', id: f.id, fx });
  }

  charge(f, t, onArrive, o = {}) {
    f.dash = { homing: t.id, speed: o.speed || 40, t: o.arc ? 1.6 : 1.0, fx: o.fx || 'bull_rush', onArrive, arc: o.arc || 0 };
    f.locked = true; f.forceSeq++;
    this.event({ e: 'dash', id: f.id, fx: f.dash.fx });
  }

  shadowLeap(f, t) {
    const x0 = f.x, z0 = f.z;
    const fw = this.forward(t);
    const cands = [[-fw.x, -fw.z], [fw.z, -fw.x], [-fw.z, fw.x], [fw.x, fw.z]];
    const tf = floorAt(t.x, t.z, t.y);
    let done = false;
    for (const strict of [true, false]) { // prefer a spot on the target's own level
      for (const [cx, cz] of cands) {
        const nx = t.x + cx * 1.6, nz = t.z + cz * 1.6;
        if (!this.validSpot(nx, nz, tf)) continue;
        const fl = landAt(nx, nz, tf);
        if (strict && Math.abs(fl - tf) > 0.5) continue;
        f.x = nx; f.z = nz; f.y = Math.max(fl, tf); f.vy = 0; done = true; break;
      }
      if (done) break;
    }
    f.yaw = angleTo(f, t);
    f.forceSeq++; f.forceYaw++;
    this.event({ e: 'blink', id: f.id, fx: 'shadow_leap', x0, z0, x1: f.x, z1: f.z });
  }

  // ------------------------------------------------------------ round resolution
  checkDeaths() {
    const dead = this.fighters.filter(f => f.alive && f.hp <= 0);
    if (!dead.length) return;
    for (const f of dead) {
      f.alive = false; f.cast = null; f.dash = null; f.locked = false; f.autoOn = false; f.buffs = [];
      const k = this.fighters[f.killer]; if (k && k.team !== f.team) k.stats.kills++;
      this.event({ e: 'death', id: f.id, killer: f.killer ?? -1 });
      for (const o of this.fighters) if (o.target === f.id) { o.autoOn = false; if (o.cast && o.cast.tid === f.id) this.cancelCast(o, false); }
    }
    const aliveTeams = [0, 1].map(t => this.fighters.some(f => f.team === t && f.alive));
    if (aliveTeams[0] && aliveTeams[1]) return;
    let winner = -1;
    if (aliveTeams[0] !== aliveTeams[1]) { winner = aliveTeams[0] ? 0 : 1; this.score[winner]++; }
    this.state = 'roundEnd'; this.stateT = RULES.roundEnd;
    this.event({ e: 'roundEnd', winner, score: [...this.score], round: this.round });
  }

  // ------------------------------------------------------------ network snapshot
  snapshot() {
    const r = v => Math.round(v * 100) / 100;
    return {
      s: this.state, st: r(this.stateT), r: this.round, sc: this.score, ft: r(this.fightT), dp: r(this.damp), w: this.winner,
      f: this.fighters.map(f => ({
        id: f.id, cls: f.cls, spec: f.spec, team: f.team, name: f.name, bot: f.bot,
        x: r(f.x), y: r(f.y), z: r(f.z), yaw: r(f.yaw), hp: Math.round(f.hp), maxHp: f.maxHp, res: Math.round(f.res), maxRes: f.maxRes, resType: f.resType,
        cds: f.cds.map(r), ch: f.ch, gcd: r(f.gcd), cast: f.cast ? { idx: f.cast.idx, t: r(f.cast.t), dur: f.cast.dur, tid: f.cast.tid } : null,
        buffs: f.buffs.map(b => ({ type: b.type, t: r(b.t), dur: r(b.dur), value: r(b.value), name: b.name, icon: b.icon, src: b.src, fx: b.fx })),
        cp: f.cp, alive: f.alive, forceSeq: f.forceSeq, forceYaw: f.forceYaw, locked: f.locked, target: f.target, friend: f.friend,
        autoOn: f.autoOn, autoT: r(f.autoT), moving: f.moving, sprinting: f.sprinting, stamina: Math.round(f.stamina),
        stats: f.stats,
      })),
      p: this.projectiles.map(p => ({ id: p.id, kind: p.kind, x: r(p.x), y: r(p.y), z: r(p.z), owner: p.owner })),
      z: this.zones.map(z => ({ id: z.id, type: z.type, x: z.x, y: z.y, z: z.z, r: z.r, t: r(z.t), dur: z.dur, owner: z.owner })),
    };
  }
}
