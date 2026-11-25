// AI combatant. Produces the same input structure a human player does, so it plays
// by exactly the same rules (cooldowns, ranges, line of sight, GCD, resources, swing timers).
// Works for 1v1 and 2v2: picks a focus target, kites the nearest threat, interrupts
// casters, peels for and heals its teammate.
import { CLASSES } from '../data/classes.js';
import { PILLARS, ARENA_R, hasBuff, isStunned, angleTo, segBlocked } from './sim.js';

const DIFF = {
  easy: { react: 0.65, interrupt: 0.15, defensive: 0.5, kite: 0.3, dodge: 0.2, focus: 0.3 },
  normal: { react: 0.35, interrupt: 0.55, defensive: 0.85, kite: 0.7, dodge: 0.6, focus: 0.7 },
  hard: { react: 0.15, interrupt: 0.9, defensive: 1.0, kite: 1.0, dodge: 0.95, focus: 1.0 },
};

const MELEE_CLASSES = new Set(['rogue', 'warrior', 'berserker']);
const INTERRUPTS = { berserker: [], warrior: ['shield_slam'], rogue: ['skull_crack'], priest: ['blinding_light'], mage: [], shaman: ['quake_totem'] };

export class AI {
  constructor(sim, id, difficulty = 'normal') {
    this.sim = sim; this.id = id; this.d = DIFF[difficulty] || DIFF.normal;
    this.think = Math.random() * 0.3; this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 0; this.jumpT = 3 + Math.random() * 4;
    this.focus = -1; this.focusT = 0; this.closeT = 0;
    this.seenCasts = new Map(); // enemy id -> { cast, react, will }
  }

  idx(f, id) { return CLASSES[f.cls].abilities.findIndex(a => a.id === id); }
  ok(f, id, tid) { const i = this.idx(f, id); return i >= 0 && !this.sim.check(f, i, true, tid !== undefined ? { tid } : {}) ? i : -1; }

  pickFocus(me, enemies, allies) {
    const sim = this.sim;
    let best = null, bestScore = Infinity;
    const allyTarget = allies.length ? allies[0].target : -1;
    for (const e of enemies) {
      if (!e.alive) continue;
      const vis = sim.visibleTo(e, me);
      let score = (e.hp / e.maxHp) * 100 + sim.dist(me, e) * 1.2;
      if (!vis) score += 80;
      if (e.id === allyTarget) score -= 25 * this.d.focus; // team up on one target
      if (e.cls === 'priest') score -= 8 * this.d.focus;   // pressure healers
      if (e.id === this.focus) score -= 10;                // stickiness
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  getInput(dt) {
    const sim = this.sim, me = sim.fighters[this.id];
    const inp = { mx: 0, mz: 0, yaw: me.yaw, jump: false, sprint: false, abilities: [], targetReq: false };
    const enemies = sim.fighters.filter(f => f.team !== me.team);
    const allies = sim.fighters.filter(f => f.team === me.team && f.id !== me.id && f.alive);
    const living = enemies.filter(e => e.alive);
    if (!living.length) return inp;

    // ---- focus target
    this.focusT -= dt;
    let foe = sim.fighters[this.focus];
    if (!foe || !foe.alive || this.focusT <= 0 || !sim.visibleTo(foe, me)) {
      const f = this.pickFocus(me, living, allies);
      if (f) { this.focus = f.id; foe = f; }
      this.focusT = 1.5 + Math.random();
    }
    if (!me.alive || sim.state !== 'fight') { inp.yaw = angleTo(me, foe); inp.setTarget = foe.id; return inp; }
    if (me.target !== foe.id && sim.visibleTo(foe, me)) inp.setTarget = foe.id;

    // nearest threat (for kiting)
    let threat = foe, td = Infinity;
    for (const e of living) { const d = sim.dist(me, e); if (d < td) { td = d; threat = e; } }

    const visible = sim.visibleTo(foe, me);
    const dist = sim.dist(me, foe);
    const melee = MELEE_CLASSES.has(me.cls);
    const threatMelee = MELEE_CLASSES.has(threat.cls);
    const foeCC = isStunned(foe) || hasBuff(foe, 'root');
    const threatCC = isStunned(threat) || hasBuff(threat, 'root');
    this.closeT = (td < 7 && threatMelee) ? this.closeT + dt : 0;

    // keep auto-attack running on the focus
    if (visible && (!me.autoOn || me.target !== foe.id)) inp.attack = true;

    // ---- react to enemy casts (interrupts), with human-like reaction time
    for (const e of living) {
      if (!e.cast) { this.seenCasts.delete(e.id); continue; }
      let s = this.seenCasts.get(e.id);
      if (!s || s.cast !== e.cast) { s = { cast: e.cast, react: this.d.react + Math.random() * 0.25, will: Math.random() < this.d.interrupt }; this.seenCasts.set(e.id, s); }
      s.react -= dt;
      if (s.will && s.react <= 0 && e.cast.t / e.cast.dur > 0.3) {
        const pick = this.interrupt(me, e);
        if (pick) { inp.abilities.push(pick); s.will = false; }
      }
    }

    // ---- choose an ability (throttled by reaction time)
    this.think -= dt;
    if (this.think <= 0 && !me.cast && me.y < 0.05) {
      this.think = this.d.react * (0.6 + Math.random() * 0.8);
      const pick = this.choose(me, foe, { dist, foeCC, visible, threat, td, threatCC, allies, living });
      if (pick) inp.abilities.push(pick);
    }

    // ---- movement
    const casting = !!me.cast || inp.abilities.some(a => CLASSES[me.cls].abilities[a.i].cast > 0);
    let wantX = 0, wantZ = 0;
    const toX = (foe.x - me.x) / (dist || 1), toZ = (foe.z - me.z) / (dist || 1);
    const thX = (threat.x - me.x) / (td || 1), thZ = (threat.z - me.z) / (td || 1);
    this.kiting = false;

    if (!casting) {
      if (melee) {
        const desired = visible ? 2.2 : 1.5;
        if (dist > desired) { wantX = toX; wantZ = toZ; }
        // circle behind the target for the 10% back-attack bonus (cheap flanking)
        if (dist < 4 && visible && this.d.focus > 0.5) {
          const fx = Math.sin(foe.yaw), fz = Math.cos(foe.yaw);
          const bx = foe.x - fx * 1.8, bz = foe.z - fz * 1.8;
          const bl = Math.hypot(bx - me.x, bz - me.z);
          if (bl > 0.8) { wantX += (bx - me.x) / bl * 0.6; wantZ += (bz - me.z) / bl * 0.6; }
        }
      } else {
        const desired = threatMelee ? 22 : 20;
        if (threatMelee && td < desired - 6 && (Math.random() < this.d.kite || threatCC)) {
          // circle-kite away from the closest melee, bending around the arena so we never get pinned
          const r = Math.hypot(me.x, me.z) || 1;
          let tX = -me.z / r, tZ = me.x / r;
          if (tX * -thX + tZ * -thZ < 0) { tX = -tX; tZ = -tZ; }
          const wall = Math.max(0, Math.min(1, (r - (ARENA_R - 12)) / 10));
          wantX = -thX * (1 - wall * 0.7) + tX * (0.4 + wall) - me.x / r * wall * 0.6;
          wantZ = -thZ * (1 - wall * 0.7) + tZ * (0.4 + wall) - me.z / r * wall * 0.6;
          this.kiting = true;
        } else if (dist > desired + 1.5) { wantX = toX; wantZ = toZ; }
        else if (!threatMelee && dist < desired - 8) { wantX = -toX * 0.5; wantZ = -toZ * 0.5; }
        // lateral strafing
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeT = 1.5 + Math.random() * 2.5; }
        if (!this.kiting && dist <= desired + 1.5) { wantX += -toZ * this.strafe * 0.5; wantZ += toX * this.strafe * 0.5; }
        // regain line of sight
        if (visible && segBlocked(me.x, me.z, foe.x, foe.z)) { wantX += -toZ * this.strafe; wantZ += toX * this.strafe; }
        // healers stay near their partner
        if (me.cls === 'priest' && allies.length) {
          const a = allies[0], ad = sim.dist(me, a);
          if (ad > 22) { wantX += (a.x - me.x) / ad * 1.2; wantZ += (a.z - me.z) / ad * 1.2; }
        }
      }
      // avoid hugging the outer wall
      const r = Math.hypot(me.x, me.z);
      if (r > ARENA_R - 5) { wantX -= me.x / r * 1.2; wantZ -= me.z / r * 1.2; }
      // steer around pillars
      for (const p of PILLARS) {
        const dx = me.x - p.x, dz = me.z - p.z, d = Math.hypot(dx, dz);
        if (d < p.r + 2.5) { wantX += dx / d * 0.9; wantZ += dz / d * 0.9; wantX += -dz / d * 0.6 * this.strafe; wantZ += dx / d * 0.6 * this.strafe; }
      }
      // dodge enemy quake totems; stay inside friendly stoneskin
      for (const z of sim.zones) {
        const owner = sim.fighters[z.owner];
        const dx = me.x - z.x, dz = me.z - z.z, d = Math.hypot(dx, dz);
        if (z.type === 'quake' && owner.team !== me.team && d < z.r + 1 && Math.random() < this.d.dodge + 0.05) { wantX = dx / (d || 1) * 2; wantZ = dz / (d || 1) * 2; }
        if (z.type === 'stoneskin' && owner.team === me.team && !melee && d > z.r - 2 && d < z.r + 6) { wantX -= dx / d * 1.2; wantZ -= dz / d * 1.2; }
      }
    }

    const wl = Math.hypot(wantX, wantZ);
    let yaw = angleTo(me, foe);
    if (wl > 0.1) {
      const moveYaw = Math.atan2(wantX, wantZ);
      const fleeing = (wantX * toX + wantZ * toZ) / wl < -0.3;
      if (fleeing || !visible) yaw = moveYaw;
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      const nx = wantX / wl, nz = wantZ / wl;
      inp.mz = nx * sy + nz * cy;
      inp.mx = -(nx * cy - nz * sy);
      inp.sprint = (dist > 12 || (this.kiting && td < 8)) && me.stamina > 20 && inp.mz > 0.5;
    }
    inp.yaw = yaw;
    this.jumpT -= dt;
    if (this.jumpT <= 0 && !casting) { inp.jump = Math.random() < 0.4; this.jumpT = 4 + Math.random() * 6; }
    return inp;
  }

  interrupt(me, e) {
    for (const id of INTERRUPTS[me.cls]) {
      const ab = CLASSES[me.cls].abilities[this.idx(me, id)];
      if (!ab.target && this.sim.dist(me, e) > (id === 'quake_totem' ? 5 : 8.5)) continue; // AoE interrupts need proximity
      const i = this.ok(me, id, e.id);
      if (i >= 0) return { i, tid: e.id };
    }
    return null;
  }

  // Healing/shielding target: the most injured friend (self included) in range.
  hurtFriend(me, allies, below) {
    let best = null, low = below;
    for (const a of [me, ...allies]) {
      const p = a.hp / a.maxHp;
      if (p < low && (a === me || (this.sim.dist(me, a) <= 30 && this.sim.los(me, a)))) { low = p; best = a; }
    }
    return best;
  }

  choose(me, foe, ctx) {
    const sim = this.sim;
    const { dist, foeCC, visible, threat, td, threatCC, allies, living } = ctx;
    const hp = me.hp / me.maxHp, foeHp = foe.hp / foe.maxHp;
    const tid = foe.id;
    const use = (id, extra = {}) => { const i = this.ok(me, id, extra.tid ?? (CLASSES[me.cls].abilities[this.idx(me, id)].target ? tid : undefined)); return i >= 0 ? { i, tid: extra.tid ?? tid, ...extra } : null; };
    const away = () => { const L = td || 1; return { x: (me.x - threat.x) / L, z: (me.z - threat.z) / L }; };
    const near = r => living.filter(e => sim.dist(me, e) <= r).length;
    const def = Math.random() < this.d.defensive;
    const threatMelee = MELEE_CLASSES.has(threat.cls);
    // Hard-cast when safe: run from a melee that is rooted, cast when it is stunned or far.
    const freeCast = !threatMelee || td > 9 || isStunned(threat) || (!hasBuff(threat, 'root') && this.closeT > 3);
    let p = null;
    switch (me.cls) {
      case 'mage':
        if (def && hp < 0.55 && (p = use('mana_ward'))) return p;
        if (near(8) && !threatCC && (p = use('glacial_nova'))) return p;
        if (def && td < 5 && threatMelee && !threatCC && (p = use('arcane_shift', { dir: away() }))) return p;
        if (hasBuff(me, 'root') && td < 8 && (p = use('arcane_shift', { dir: away() }))) return p;
        if (visible && (dist > 9 || foeCC) && freeCast && (p = use('arcane_comet'))) return p;
        if (visible && (p = use('flame_burst'))) return p;
        if (visible && freeCast && (p = use('frost_lance'))) return p;
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
        if (near(5) >= 1 && me.res >= 40 && (foeHp < 0.6 || hp < 0.5 || near(6) >= 2) && (p = use('steel_tempest'))) return p;
        if ((p = use('rending_blow'))) return p;
        if (!hasBuff(foe, 'slow') && (p = use('crippling_slash'))) return p;
        if (me.res > 70 && (p = use('crippling_slash'))) return p;
        return null;
      case 'berserker':
        // low health = more damage: only pop the defensive when truly close to death
        if (def && hp < 0.3 && (p = use('undying_rage'))) return p;
        if (!visible) return null;
        if (dist > 7 && (p = use('skull_leap'))) return p;
        if (dist > 6 && !foeCC && (p = use('axe_throw'))) return p;
        if (dist < 6 && (hp < 0.75 || foeHp < 0.5) && hp > 0.25 && (p = use('berserk'))) return p;
        if (foeHp < 0.35 && (p = use('headtaker'))) return p;
        if (!foe.buffs.some(b => b.name === 'Bleeding' && b.src === me.id) && (p = use('rending_axes'))) return p;
        if ((p = use('headtaker'))) return p;
        if (me.res > 55 && (p = use('rending_axes'))) return p;
        return null;
      case 'priest': {
        const hurt = this.hurtFriend(me, allies, 0.75);
        if (def && hurt && !hurt.buffs.some(b => b.type === 'absorb') && (p = use('divine_aegis', { tid: hurt.id }))) return p;
        if (def && !isStunned(me) && hasBuff(me, 'root') && td < 8 && (p = use('seraph_step'))) return p;
        if (near(7) && !threatCC && threatMelee && (p = use('blinding_light'))) return p;
        if (visible && (hp < 0.7 || foeHp < 0.3 || (hurt && hurt !== me)) && (p = use('halo_judgment'))) return p;
        const heal = this.hurtFriend(me, allies, 0.62);
        if (heal && freeCast && (p = use('mend', { tid: heal.id }))) return p;
        if (visible && freeCast && (p = use('sacred_bolt'))) return p;
        return null; }
      case 'shaman':
        if (def && (hp < 0.6 || (td < 6 && threatMelee) || allies.some(a => a.hp / a.maxHp < 0.5 && sim.dist(me, a) < 6)) && (p = use('stoneskin_totem'))) return p;
        if (near(6) && !threatCC && (p = use('quake_totem'))) return p;
        if (def && hasBuff(me, 'root') && td < 8 && (p = use('gale_dash', { dir: away() }))) return p;
        if (def && td < 4 && threatCC && (p = use('gale_dash', { dir: away() }))) return p;
        if (visible && (p = use('fire_spirit'))) return p;
        if (visible && (p = use('magma_burst'))) return p;
        if (visible && freeCast && (p = use('lightning_lash'))) return p;
        return null;
    }
    return null;
  }
}
