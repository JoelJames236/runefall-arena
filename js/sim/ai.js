// AI opponent. Produces the same input structure a human player does, so it plays
// by exactly the same rules (cooldowns, ranges, line of sight, GCD, resources).
import { CLASSES } from '../data/classes.js';
import { PILLARS, ARENA_R, hasBuff, isStunned, angleTo, segBlocked } from './sim.js';

const DIFF = {
  easy: { react: 0.65, interrupt: 0.15, defensive: 0.5, kite: 0.3, dodge: 0.2 },
  normal: { react: 0.35, interrupt: 0.55, defensive: 0.85, kite: 0.7, dodge: 0.6 },
  hard: { react: 0.14, interrupt: 0.9, defensive: 1.0, kite: 1.0, dodge: 0.95 },
};

const MELEE_CLASSES = new Set(['rogue', 'warrior']);

export class AI {
  constructor(sim, id, difficulty = 'normal') {
    this.sim = sim; this.id = id; this.d = DIFF[difficulty] || DIFF.normal;
    this.think = 0; this.strafe = 1; this.strafeT = 0; this.jumpT = 3 + Math.random() * 4;
    this.kiteT = 0; this.plan = null; this.lastFoeCast = null; this.reactCast = 0;
  }

  idx(f, id) { return CLASSES[f.cls].abilities.findIndex(a => a.id === id); }
  ok(f, id) { const i = this.idx(f, id); return i >= 0 && !this.sim.check(f, i, true) ? i : -1; }

  getInput(dt) {
    const sim = this.sim, me = sim.fighters[this.id], foe = sim.fighters[1 - this.id];
    const inp = { mx: 0, mz: 0, yaw: me.yaw, jump: false, sprint: false, abilities: [], targetReq: false };
    if (!me.alive || sim.state !== 'fight') { inp.yaw = angleTo(me, foe); return inp; }

    const visible = sim.visibleTo(foe, me);
    const dist = sim.dist(me, foe);
    const melee = MELEE_CLASSES.has(me.cls);
    const foeMelee = MELEE_CLASSES.has(foe.cls);
    const hpPct = me.hp / me.maxHp, foeHp = foe.hp / foe.maxHp;
    const foeCC = isStunned(foe) || hasBuff(foe, 'root');
    this.closeT = dist < 7 ? (this.closeT || 0) + dt : 0;

    // ---------------- decide abilities (throttled by reaction time)
    this.think -= dt;
    if (foe.cast && foe.cast !== this.lastFoeCast) { this.lastFoeCast = foe.cast; this.reactCast = this.d.react + Math.random() * 0.2; this.willInterrupt = Math.random() < this.d.interrupt; }
    if (!foe.cast) this.lastFoeCast = null;
    if (this.reactCast > 0) this.reactCast -= dt;
    this.kiting = false;
    if (this.think <= 0 && !me.cast && me.y < 0.05) {
      this.think = this.d.react * (0.6 + Math.random() * 0.8);
      const pick = this.choose(me, foe, dist, hpPct, foeHp, foeCC, visible);
      if (pick) inp.abilities.push(pick);
    }
    // off-GCD reactive abilities (interrupts) also checked when a cast is spotted
    if (foe.cast && this.willInterrupt && this.reactCast <= 0 && foe.cast.t / foe.cast.dur > 0.35) {
      const pick = this.interrupt(me, foe, dist);
      if (pick) { inp.abilities.push(pick); this.willInterrupt = false; }
    }
    if (!visible && me.target !== foe.id) inp.targetReq = true;
    if (visible && me.target !== foe.id) inp.targetReq = true;

    // ---------------- movement
    let desired = melee ? 2.2 : (foeMelee ? 22 : 20);
    let tx = foe.x, tz = foe.z;
    if (!visible) { desired = melee ? 1.5 : 14; }
    const casting = !!me.cast || inp.abilities.some(a => CLASSES[me.cls].abilities[a.i].cast > 0);
    let wantX = 0, wantZ = 0;
    const toX = (tx - me.x) / (dist || 1), toZ = (tz - me.z) / (dist || 1);

    if (!casting) {
      if (dist > desired + 1.5) { wantX = toX; wantZ = toZ; }
      else if (!melee && dist < desired - 6 && (foeMelee || foeCC)) {
        if (Math.random() < this.d.kite || foeCC) {
          // circle-kite: run away but bend around the arena so we never get pinned on the wall
          const r = Math.hypot(me.x, me.z) || 1;
          let tX = -me.z / r, tZ = me.x / r;
          if (tX * -toX + tZ * -toZ < 0) { tX = -tX; tZ = -tZ; }
          const wall = Math.max(0, Math.min(1, (r - (ARENA_R - 12)) / 10));
          wantX = -toX * (1 - wall * 0.7) + tX * (0.4 + wall) - me.x / r * wall * 0.6;
          wantZ = -toZ * (1 - wall * 0.7) + tZ * (0.4 + wall) - me.z / r * wall * 0.6;
          this.kiting = true;
        }
      } else if (melee) { wantX = toX * 0.4; wantZ = toZ * 0.4; }
      // lateral strafing for ranged
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeT = 1.5 + Math.random() * 2.5; }
      if (!melee && dist <= desired + 1.5 && dist >= desired - 6) { wantX += -toZ * this.strafe * 0.6; wantZ += toX * this.strafe * 0.6; }
      // ranged: if no line of sight, step sideways to regain it
      if (!melee && visible && segBlocked(me.x, me.z, foe.x, foe.z)) { wantX += -toZ * this.strafe; wantZ += toX * this.strafe; }
      // avoid hugging the outer wall
      const r = Math.hypot(me.x, me.z);
      if (r > ARENA_R - 5) { wantX -= me.x / r * 1.2; wantZ -= me.z / r * 1.2; }
      // steer around pillars
      for (const p of PILLARS) {
        const dx = me.x - p.x, dz = me.z - p.z, d = Math.hypot(dx, dz);
        if (d < p.r + 2.5) { wantX += dx / d * 0.9; wantZ += dz / d * 0.9; wantX += -dz / d * 0.6 * this.strafe; wantZ += dx / d * 0.6 * this.strafe; }
      }
      // dodge enemy quake totems
      for (const z of sim.zones) {
        if (z.owner === me.id || z.type !== 'quake') continue;
        const dx = me.x - z.x, dz = me.z - z.z, d = Math.hypot(dx, dz);
        if (d < z.r + 1 && Math.random() < this.d.dodge + 0.05) { wantX = dx / (d || 1) * 2; wantZ = dz / (d || 1) * 2; }
      }
      // stay in own stoneskin totem
      for (const z of sim.zones) {
        if (z.owner !== me.id || z.type !== 'stoneskin') continue;
        const dx = z.x - me.x, dz = z.z - me.z, d = Math.hypot(dx, dz);
        if (d > z.r - 2) { wantX += dx / d * 1.5; wantZ += dz / d * 1.5; }
      }
    }

    const wl = Math.hypot(wantX, wantZ);
    // Facing: face the foe (melee abilities need it); when fleeing, face the movement direction.
    let yaw = angleTo(me, foe);
    if (wl > 0.1) {
      const moveYaw = Math.atan2(wantX, wantZ);
      const fleeing = (wantX * toX + wantZ * toZ) / wl < -0.3;
      if (fleeing || !visible) yaw = moveYaw;
      // convert world direction into local strafe/forward input
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      const nx = wantX / wl, nz = wantZ / wl;
      inp.mz = nx * sy + nz * cy;
      inp.mx = -(nx * cy - nz * sy);
      inp.sprint = (dist > 12 || (this.kiting && dist < 8)) && me.stamina > 20 && inp.mz > 0.5;
    }
    inp.yaw = yaw;
    this.jumpT -= dt;
    if (this.jumpT <= 0 && !casting) { inp.jump = Math.random() < 0.5; this.jumpT = 4 + Math.random() * 6; }
    return inp;
  }

  freeCast(dist, foeCC, foe) {
    // Hard-cast when safe. Against melee: run while they are rooted, cast while they are stunned
    // or far away, and give up kiting if they have been glued to us for a while.
    if (!MELEE_CLASSES.has(foe.cls) || dist > 9) return true;
    if (isStunned(foe)) return true;
    if (hasBuff(foe, 'root')) return false;
    return this.closeT > 3;
  }

  interrupt(me, foe, dist) {
    const tries = { warrior: ['shield_slam'], rogue: ['skull_crack'], priest: ['blinding_light'], mage: [], shaman: [] }[me.cls];
    for (const id of tries) { const i = this.ok(me, id); if (i >= 0) return { i }; }
    return null;
  }

  choose(me, foe, dist, hp, foeHp, foeCC, visible) {
    const ok = id => this.ok(me, id);
    const use = (id, extra) => { const i = ok(id); return i >= 0 ? { i, ...extra } : null; };
    const away = () => { const L = dist || 1; return { x: (me.x - foe.x) / L, z: (me.z - foe.z) / L }; };
    const def = Math.random() < this.d.defensive;
    const foeSlowed = hasBuff(foe, 'slow');
    let p = null;
    switch (me.cls) {
      case 'mage':
        if (def && hp < 0.55 && (p = use('mana_ward'))) return p;
        if (dist < 7 && !foeCC && (p = use('glacial_nova'))) return p;
        if (def && dist < 5 && !foeCC && (p = use('arcane_shift', { dir: away() }))) return p;
        if (hasBuff(me, 'root') && dist < 8 && (p = use('arcane_shift', { dir: away() }))) return p;
        if (visible && (dist > 9 || foeCC) && (p = use('arcane_comet'))) return p;
        if (visible && (p = use('flame_burst'))) return p;
        if (visible && this.freeCast(dist, foeCC, foe) && (p = use('frost_lance'))) return p;
        return null;
      case 'rogue':
        if (def && hp < 0.35 && (p = use('fade'))) return p;
        if (!visible) return null;
        if (dist > 7 && (p = use('shadow_leap'))) return p;
        if (dist < 6 && foeHp > 0.25 && (p = use('death_mark'))) return p;
        if (me.cp >= 4 && !foeCC && (p = use('skull_crack'))) return p;
        if (me.cp >= 5 && (p = use('gutting_edge'))) return p;
        if (me.cp >= 3 && foeHp < 0.25 && (p = use('gutting_edge'))) return p;
        if ((p = use('viper_strike'))) return p;
        return null;
      case 'warrior':
        if (def && hp < 0.45 && (p = use('iron_bulwark'))) return p;
        if (!visible) return null;
        if (dist > 6 && (p = use('bull_rush'))) return p;
        if (dist < 5 && me.res >= 40 && (foeHp < 0.6 || hp < 0.5) && (p = use('steel_tempest'))) return p;
        if ((p = use('rending_blow'))) return p;
        if (!foeSlowed && (p = use('crippling_slash'))) return p;
        if (me.res > 70 && (p = use('crippling_slash'))) return p;
        return null;
      case 'priest':
        if (def && hp < 0.75 && (p = use('divine_aegis'))) return p;
        if (def && (isStunned(me) === false) && (hasBuff(me, 'root') || foeSlowed === false && hasBuff(me, 'slow')) && dist < 8 && (p = use('seraph_step'))) return p;
        if (dist < 7 && !foeCC && MELEE_CLASSES.has(foe.cls) && (p = use('blinding_light'))) return p;
        if (visible && (hp < 0.7 || foeHp < 0.3) && (p = use('halo_judgment'))) return p;
        if (hp < 0.6 && this.freeCast(dist, foeCC, foe) && (p = use('mend'))) return p;
        if (visible && this.freeCast(dist, foeCC, foe) && (p = use('sacred_bolt'))) return p;
        return null;
      case 'shaman':
        if (def && (hp < 0.6 || (dist < 6 && MELEE_CLASSES.has(foe.cls))) && (p = use('stoneskin_totem'))) return p;
        if (dist < 6 && !foeCC && (p = use('quake_totem'))) return p;
        if (def && hasBuff(me, 'root') && dist < 8 && (p = use('gale_dash', { dir: away() }))) return p;
        if (def && dist < 4 && foeCC && (p = use('gale_dash', { dir: away() }))) return p;
        if (visible && (p = use('fire_spirit'))) return p;
        if (visible && (p = use('magma_burst'))) return p;
        if (visible && this.freeCast(dist, foeCC, foe) && (p = use('lightning_lash'))) return p;
        return null;
    }
    return null;
  }
}
