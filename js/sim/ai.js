// AI combatant. Produces the same input structure a human player does, so it plays
// by exactly the same rules (cooldowns, ranges, line of sight, GCD, resources, swing timers).
// Works for 1v1 and 2v2: picks a focus target, kites the nearest threat, interrupts
// casters, peels for and heals its teammate.
import { CLASSES, kitOf } from '../data/classes.js';
import { PILLARS, ARENA_R, BRIDGE, ARCH_OPEN, hasBuff, isStunned, angleTo, segBlocked, floorAt, solidAt, airborne, currentMap } from './sim.js';

const DIFF = {
  // aim: how far (m) a bot's aim drifts off the target's chest; lead: how much of a ranged shot's lead it gets right.
  // Squire and Knight aim like people do (they miss strafing targets now and then); Champion is the expert.
  easy: { react: 0.65, interrupt: 0.15, defensive: 0.5, kite: 0.3, dodge: 0.2, focus: 0.3, aim: 1.3, lead: 0.15 },
  normal: { react: 0.4, interrupt: 0.45, defensive: 0.85, kite: 0.6, dodge: 0.5, focus: 0.7, aim: 0.75, lead: 0.55 },
  hard: { react: 0.15, interrupt: 0.9, defensive: 1.0, kite: 1.0, dodge: 0.95, focus: 1.0, aim: 0.2, lead: 1.0 },
};

// debuff an ability leaves on its target when it isn't named after the ability (see AI.filler)
const FILLER_DEBUFF = { rending_axes: 'Bleeding', crippling_slash: 'Crippled' };
const MELEE_CLASSES = new Set(['rogue', 'warrior', 'berserker', 'paladin']);
// melee or not: a spec can override its class (e.g. Enhancement Shaman fights in melee)
const isMelee = f => { const k = kitOf(f); return k.melee ?? MELEE_CLASSES.has(f.cls); };
const HEALERS = new Set(['priest']);
const INTERRUPTS = { paladin: ['sentinels_shield', 'hammer_of_light'], berserker: [], warrior: ['shield_slam'], rogue: ['skull_crack'], priest: ['blinding_light', 'psychic_scream'], mage: [], shaman: ['quake_totem'], hunter: ['intimidation'], necromancer: [], druid: [] };

export class AI {
  constructor(sim, id, difficulty = 'normal') {
    this.sim = sim; this.id = id; this.d = DIFF[difficulty] || DIFF.normal;
    if (sim.fighters[id]) sim.fighters[id].bot = true; // bots aim themselves: no player aim assist (sim.shootAuto)
    this.think = Math.random() * 0.3; this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 0; this.jumpT = 3 + Math.random() * 4;
    this.focus = -1; this.focusT = 0; this.closeT = 0;
    this.seenCasts = new Map(); // enemy id -> { cast, react, will }
  }

  idx(f, id) { return kitOf(f).abilities.findIndex(a => a.id === id); }
  ok(f, id, tid) { const i = this.idx(f, id); return i >= 0 && !this.sim.check(f, i, true, tid !== undefined ? { tid } : {}) ? i : -1; }

  // The bot's aim ray (basic attacks are aimed): from its eyes at the foe's chest, leading a ranged shot by the
  // foe's movement (how well depends on difficulty), plus an aim error that drifts every ~0.7 s.
  aimAt(me, foe, A, dt, dist) {
    const pv = this.foePrev;
    if (pv && pv.id === foe.id && dt > 0) {
      const k = Math.min(1, dt * 8);
      this.foeV = [(this.foeV?.[0] || 0) * (1 - k) + (foe.x - pv.x) / dt * k, (this.foeV?.[1] || 0) * (1 - k) + (foe.z - pv.z) / dt * k];
    } else this.foeV = [0, 0];
    this.foePrev = { id: foe.id, x: foe.x, z: foe.z };
    this.aimErrT = (this.aimErrT || 0) - dt;
    if (this.aimErrT <= 0) { const e = this.d.aim; this.aimErrT = 0.5 + Math.random() * 0.4; this.aimErr = [(Math.random() * 2 - 1) * e, (Math.random() * 2 - 1) * e * 0.5, (Math.random() * 2 - 1) * e]; }
    const lead = A && A.ranged ? dist / A.projSpeed * this.d.lead : 0;
    const ex = me.x, ey = me.y + 1.5, ez = me.z;
    const tx = foe.x + this.foeV[0] * lead + this.aimErr[0], ty = foe.y + 1.05 + this.aimErr[1], tz = foe.z + this.foeV[1] * lead + this.aimErr[2];
    const dx = tx - ex, dy = ty - ey, dz = tz - ez, l = Math.hypot(dx, dy, dz) || 1;
    return [ex, ey, ez, dx / l, dy / l, dz / l];
  }

  // Damage filler: the strongest short-cooldown hostile ability that is ready (never a big cooldown, a
  // signature, a spender or crowd control). Cast-time spells only when no enemy stands within 8 yards.
  filler(me, foe, living) {
    const K = kitOf(me), crowded = living.some(e => this.sim.dist(me, e) < 8);
    let best = null, bestCd = -1;
    K.abilities.forEach((ab, i) => {
      if (!ab || !ab.target || ab.ally || ab.signature || ab.needsCp || ab.needsPet || ab.minRange || ab.cd > 9) return;
      if (ab.cast > 0 && !ab.moveCast && (crowded || me.moving)) return;
      if (ab.cost > me.res * 0.8) return; // keep a reserve for the priority list
      // never re-apply our own damage over time / debuff while most of it is still running (wastes resources)
      const deb = FILLER_DEBUFF[ab.id] || ab.name;
      if (foe.buffs.some(b => b.src === me.id && b.name === deb && b.t > b.dur * 0.35)) return;
      if (this.ok(me, ab.id, foe.id) < 0) return;
      if (ab.cd > bestCd) { bestCd = ab.cd; best = { i, tid: foe.id }; }
    });
    return best;
  }

  // How hard an enemy is to kill right now: health through armor and damage reduction, plus shields.
  effectiveHp(e) {
    let ehp = e.hp / (1 - (kitOf(e).defense || 0));
    for (const b of e.buffs) {
      if ((b.type === 'dr' || b.type === 'stoneskin') && b.value) ehp /= 1 - b.value;
      if (b.type === 'absorb' && b.value) ehp += b.value;
    }
    return ehp;
  }
  // Kill-target score (lower = better). Same inputs give the same answer every round, so a bot
  // keeps a consistent, sensible focus: the softest reachable target, healers a bit preferred,
  // never one it can't see or reach, and the target its partner is already hitting.
  focusScore(me, e, allies) {
    const sim = this.sim;
    if (!sim.visibleTo(e, me)) return Infinity;
    let score = this.effectiveHp(e) / 12;                      // ~83 for a full mage, ~135 for a full warrior
    score += sim.dist(me, e) * (isMelee(me) ? 1.4 : 0.6);
    if (!sim.los(me, e)) score += 25;                                                  // hiding behind cover: worth switching
    if (HEALERS.has(e.cls)) score -= 15 * this.d.focus;                                // pressure the healer
    if (e.buffs.some(b => b.type === 'stun' || b.type === 'root')) score -= 10;        // free damage
    if (e.buffs.some(b => b.type === 'divine')) score += 80;                             // Divine Shield: hit someone else
    if (e.buffs.some(b => b.type === 'disorient' && sim.fighters[b.src]?.team === me.team)) score += 60; // don't break our own CC
    if (sim.fightT > 1.5) for (const a of allies) if (a.alive && a.target === e.id) score -= 22 * this.d.focus; // team up
    return score;
  }
  pickFocus(me, enemies, allies) {
    let best = null, bestScore = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const s = this.focusScore(me, e, allies);
      if (s < bestScore) { bestScore = s; best = e; }
    }
    // only switch away from a valid current focus for a clearly better target (no flip-flopping)
    const cur = this.sim.fighters[this.focus];
    if (best && cur && cur.alive && cur !== best && cur.team !== me.team) {
      const cs = this.focusScore(me, cur, allies);
      if (cs < Infinity && cs - bestScore < 18) return cur;
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

    // ---- focus target (chosen fresh each round: last round's kill order must not carry over)
    if (this.round !== sim.round) { this.round = sim.round; this.focus = -1; this.focusT = 0; this.seenCasts.clear(); }
    this.focusT -= dt;
    let foe = sim.fighters[this.focus];
    // Challenged by a Protection Paladin: a bot has to turn on him (that's what a taunt is for)
    // (only while the challenge is fresh — the tank has to keep re-challenging to hold a bot)
    const tn = me.buffs.find(b => b.type === 'taunt' && b.age < 2.5), taunter = tn && sim.fighters[tn.src];
    if (taunter && taunter.alive && sim.visibleTo(taunter, me)) { this.focus = taunter.id; foe = taunter; this.focusT = Math.max(this.focusT, 2.5 - tn.age); }
    else if (!foe || !foe.alive || this.focusT <= 0 || !sim.visibleTo(foe, me)) {
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
    const melee = isMelee(me);
    const threatMelee = isMelee(threat);
    const foeCC = isStunned(foe) || hasBuff(foe, 'root');
    const threatCC = isStunned(threat) || hasBuff(threat, 'root');
    this.closeT = (td < 7 && threatMelee) ? this.closeT + dt : 0;

    // bots "hold the attack button" on their focus — but only while a swing could land (in reach, in front, in
    // sight): a swing always goes off, so swinging at air would waste it. Like a player they aim at the foe.
    const A = kitOf(me).auto;
    inp.atkHold = visible && !sim.autoBlock(me, foe, A);
    inp.aim = this.aimAt(me, foe, A, dt, dist);

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
    if (this.think <= 0 && !me.cast && !airborne(me)) {
      this.think = this.d.react * (0.6 + Math.random() * 0.8);
      let pick = this.choose(me, foe, { dist, foeCC, visible, threat, td, threatCC, allies, living });
      // the priority list had nothing to say: rather than idle on a free global cooldown, use a damage filler
      if (!pick && visible && Math.random() < this.d.focus) pick = this.filler(me, foe, living);
      if (pick) inp.abilities.push(pick);
    }

    // ---- movement
    // standing still to cast (moveCast spells, e.g. Fire Mage, are cast on the move)
    const casting = (!!me.cast && !kitOf(me).abilities[me.cast.idx]?.moveCast) || inp.abilities.some(a => { const ab = kitOf(me).abilities[a.i]; return ab.cast > 0 && !ab.moveCast; });
    let wantX = 0, wantZ = 0;
    const toX = (foe.x - me.x) / (dist || 1), toZ = (foe.z - me.z) / (dist || 1);
    const thX = (threat.x - me.x) / (td || 1), thZ = (threat.z - me.z) / (td || 1);
    this.kiting = false;

    if (!casting) {
      if (melee) {
        const desired = visible ? 2.2 : 1.5;
        if (dist > desired) { const n = this.nav(me, foe); wantX = n.x; wantZ = n.z; }
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
          const wall = currentMap() ? 0 : Math.max(0, Math.min(1, (r - (ARENA_R - 12)) / 10)); // battlegrounds: no ring to bend around
          wantX = -thX * (1 - wall * 0.7) + tX * (0.4 + wall) - me.x / r * wall * 0.6;
          wantZ = -thZ * (1 - wall * 0.7) + tZ * (0.4 + wall) - me.z / r * wall * 0.6;
          this.kiting = true;
        } else if (dist > desired + 1.5) { const n = this.nav(me, foe); wantX = n.x; wantZ = n.z; }
        else if (!threatMelee && dist < desired - 8) { wantX = -toX * 0.5; wantZ = -toZ * 0.5; }
        // lateral strafing
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeT = 1.5 + Math.random() * 2.5; }
        if (!this.kiting && dist <= desired + 1.5) { wantX += -toZ * this.strafe * 0.5; wantZ += toX * this.strafe * 0.5; }
        // regain line of sight
        if (visible && segBlocked(me.x, me.z, foe.x, foe.z, me.y + 1.5, foe.y + 1.5)) { wantX += -toZ * this.strafe; wantZ += toX * this.strafe; }
        // healers stay near their partner
        if (me.cls === 'priest' && allies.length) {
          const a = allies[0], ad = sim.dist(me, a);
          if (ad > 22) { wantX += (a.x - me.x) / ad * 1.2; wantZ += (a.z - me.z) / ad * 1.2; }
        }
      }
      // avoid hugging the outer wall
      const r = Math.hypot(me.x, me.z);
      if (!currentMap() && r > ARENA_R - 5) { wantX -= me.x / r * 1.2; wantZ -= me.z / r * 1.2; }
      // steer around pillars
      if (!currentMap()) for (const p of PILLARS) {
        const dx = me.x - p.x, dz = me.z - p.z, d = Math.hypot(dx, dz);
        if (d < p.r + 2.5) {
          // chasing: slide around the side that keeps us heading to the goal (no dead-lock); kiting keeps its strafe side
          let tx = -dz / d * this.strafe, tz = dx / d * this.strafe;
          if (!this.kiting && Math.hypot(wantX, wantZ) > 0.1 && tx * wantX + tz * wantZ < 0) { tx = -tx; tz = -tz; }
          wantX += dx / d * 0.9 + tx * 0.6; wantZ += dz / d * 0.9 + tz * 0.6;
        }
      }
      // step around a teammate in the way (e.g. one standing still to cast) instead of pushing into them
      for (const a of allies) {
        const dx = me.x - a.x, dz = me.z - a.z, d = Math.hypot(dx, dz);
        if (d < 1.9 && d > 1e-3 && Math.abs(a.y - me.y) < 1.6) {
          const tx = -dz / d, tz = dx / d, s = tx * wantX + tz * wantZ >= 0 ? 1 : -1;
          wantX += dx / d * 0.7 + tx * s * 0.9; wantZ += dz / d * 0.7 + tz * s * 0.9;
        }
      }
      // don't grind against the bridge ramps while kiting
      { const l = Math.hypot(wantX, wantZ); if (l > 0.1 && this.pathSolid(me, me.x + wantX / l * 1.5, me.z + wantZ / l * 1.5)) wantZ += (me.z >= 0 ? 1 : -1) * 1.2; }
      // dodge enemy quake totems; stay inside friendly stoneskin
      for (const z of sim.zones) {
        const owner = sim.fighters[z.owner];
        const dx = me.x - z.x, dz = me.z - z.z, d = Math.hypot(dx, dz);
        if ((z.type === 'quake' || z.type === 'meteor' || z.type === 'plague' || z.type === 'trap') && owner.team !== me.team && d < z.r + 1 && Math.random() < this.d.dodge + 0.05) { wantX = dx / (d || 1) * 2; wantZ = dz / (d || 1) * 2; }
        if (z.type === 'stoneskin' && owner.team === me.team && !melee && d > z.r - 2 && d < z.r + 6) { wantX -= dx / d * 1.2; wantZ -= dz / d * 1.2; }
      }
    }

    // watchdog: wanting to move but pinned (pillar, wall, teammate) for 0.8 s -> go around the other way
    if (Math.hypot(wantX, wantZ) > 0.3 && !casting && !me.dash) {
      if (!this.pin || Math.hypot(me.x - this.pin.x, me.z - this.pin.z) > 0.5) this.pin = { x: me.x, z: me.z, t: 0 };
      else if ((this.pin.t += dt) > 0.8) { this.strafe = -this.strafe; this.strafeT = 2; this.pin = null; this.unpin = 0.6; }
    } else this.pin = null;
    if (this.unpin > 0) { this.unpin -= dt; const l = Math.hypot(wantX, wantZ) || 1, px = -wantZ / l, pz = wantX / l; wantX += px * this.strafe * 1.2; wantZ += pz * this.strafe * 1.2; }
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

  // Steering toward a goal that knows the bridge: take a ramp to get up, hop off the side to get
  // down, and go around the ramp embankments (through the arch or past the ramp foot). Returns a unit vector.
  nav(me, goal) {
    const B = BRIDGE, end = B.hx + B.ramp;
    const myF = floorAt(me.x, me.z, me.y), gF = floorAt(goal.x, goal.z, goal.y);
    let wx = goal.x, wz = goal.z;
    if (gF - myF > 1.2) { // goal is up on the bridge: nearer ramp foot, then straight up the ramp
      const s = Math.hypot(me.x - end, me.z) + Math.hypot(goal.x - end, goal.z) < Math.hypot(me.x + end, me.z) + Math.hypot(goal.x + end, goal.z) ? 1 : -1;
      if (Math.abs(me.z) <= B.hz && me.x * s > B.hx) { wx = s * (B.hx - 1); wz = 0; } else { wx = s * (end + 2); wz = 0; }
    } else if (myF - gF > 1.2 && Math.hypot(goal.x - me.x, goal.z - me.z) < 5) { // we're above it: step off the side
      wx = me.x; wz = ((goal.z || me.z) >= 0 ? 1 : -1) * (B.hz + 2);
    }
    if (this.pathSolid(me, wx, wz)) {
      const W = B.hz + 0.25, O = ARCH_OPEN - 0.8;
      const side = Math.abs(wz) > W ? Math.sign(wz) : Math.sign(me.z || 1); // goal beyond the bridge side, else our own side
      const ux = Math.max(-O, Math.min(O, (me.x + wx) / 2)); // where to pass through the arch
      if (Math.abs(me.z) <= W + 0.6) { // inside the arch / in line with the ramps: leave toward the goal's side
        wx = Math.abs(me.x) <= B.hx ? Math.max(-O, Math.min(O, me.x)) : me.x; wz = side * (W + 1.6);
      } else { // beside the bridge: through the arch, or around the ramp foot
        const across = Math.abs(wz) > B.hz && Math.sign(wz) !== Math.sign(me.z); // the arch only helps to reach the far side
        const fx = (across ? (me.x >= 0 ? 1 : -1) : (wx >= 0 ? 1 : -1)) * (end + 1.5);
        const viaArch = across && Math.abs(me.x - ux) + Math.abs(ux - wx) <= Math.abs(me.x - fx) + Math.abs(fx - wx) + 4;
        if (viaArch) { wx = ux; wz = Math.sign(me.z) * (W + 1.4); } // the arch entrance on our side (then straight through)
        else { wx = fx; wz = me.z; }
      }
      // already standing on the detour point (arch entrance / beyond the ramp foot): go through
      if (Math.hypot(wx - me.x, wz - me.z) < 0.8) wz = -Math.sign(me.z || 1) * (W + 1.6); // reached it: cross to the other side
    }
    // a pillar in the way: aim past its side instead (the side we're already on)
    for (const p of PILLARS) {
      const sx = wx - me.x, sz = wz - me.z, L2 = sx * sx + sz * sz || 1e-6;
      const t = ((p.x - me.x) * sx + (p.z - me.z) * sz) / L2;
      if (t <= 0 || t >= 1) continue;
      const cx = me.x + sx * t - p.x, cz = me.z + sz * t - p.z, cd = Math.hypot(cx, cz);
      if (cd >= p.r + 1.0) continue;
      const L = Math.sqrt(L2); let px = -sz / L, pz = sx / L; // perpendicular to the path
      if (px * cx + pz * cz < 0) { px = -px; pz = -pz; }
      wx = p.x + px * (p.r + 1.8); wz = p.z + pz * (p.r + 1.8);
      break;
    }
    const dx = wx - me.x, dz = wz - me.z, L = Math.hypot(dx, dz) || 1;
    return { x: dx / L, z: dz / L };
  }
  // would walking straight to (x, z) run into a wall? (follows ramps up and down like moveFighter)
  pathSolid(me, x, z) {
    const n = Math.min(60, Math.max(3, Math.ceil(Math.hypot(x - me.x, z - me.z) / 0.4)));
    let y = me.y;
    for (let i = 1; i <= n; i++) {
      const u = i / n, px = me.x + (x - me.x) * u, pz = me.z + (z - me.z) * u;
      if (solidAt(px, pz, y)) return true;
      const fl = floorAt(px, pz, y); if (fl > y || y - fl < 0.6) y = fl;
    }
    return false;
  }

  interrupt(me, e) {
    for (const id of INTERRUPTS[me.cls]) {
      const ab = kitOf(me).abilities[this.idx(me, id)]; if (!ab) continue; // not in this spec
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
    const use = (id, extra = {}) => { const k = this.idx(me, id); if (k < 0) return null; const i = this.ok(me, id, extra.tid ?? (kitOf(me).abilities[k].target ? tid : undefined)); return i >= 0 ? { i, tid: extra.tid ?? tid, ...extra } : null; }; // null if this spec lacks the ability
    const away = () => { const L = td || 1; return { x: (me.x - threat.x) / L, z: (me.z - threat.z) / L }; };
    const near = r => living.filter(e => sim.dist(me, e) <= r).length;
    const def = Math.random() < this.d.defensive;
    const threatMelee = isMelee(threat);
    // Hard-cast when safe: run from a melee that is rooted, cast when it is stunned or far.
    const freeCast = !threatMelee || td > 9 || isStunned(threat) || (!hasBuff(threat, 'root') && this.closeT > 3);
    let p = null;
    switch (me.cls) {
      case 'mage': {
        const fire = me.spec === 'fire', step = fire ? 'blazing_step' : 'arcane_shift';
        if (def && hp < 0.55 && (p = use('mana_ward'))) return p;
        if (near(8) && !threatCC && (p = use('glacial_nova'))) return p;
        if (def && td < 5 && threatMelee && !threatCC && (p = use(step, { dir: away() }))) return p;
        if (hasBuff(me, 'root') && td < 8 && (p = use(step, { dir: away() }))) return p;
        if (fire) {
          // everything casts on the move; the meteor is saved for a target that can't walk out of it
          if (near(8) && (p = use('flame_ring'))) return p;
          if (visible && (foeCC || foe.cast) && (p = use('meteor'))) return p;
          if (visible && (p = use('flame_burst'))) return p;
          if (visible && (p = use('fireball'))) return p;
          return null;
        }
        if (visible && (dist > 9 || foeCC) && freeCast && (p = use('arcane_comet'))) return p;
        if (visible && !hasBuff(foe, 'slow') && (p = use('frostbite'))) return p;
        if (visible && freeCast && (p = use('frost_lance'))) return p;
        if (visible && (p = use('frostbite'))) return p;
        return null;
      }
      case 'rogue':
        if (me.spec === 'assassination') {
          // stack poison, cripple runners, cloud them, then Envenom with full combo points
          if (!visible) return null;
          if (dist > 7 && (p = use('shadow_leap'))) return p;
          if (dist < 5 && (p = use('plague_cloud'))) return p;
          if (dist < 5 && !hasBuff(foe, 'slow') && (p = use('crippling_poison'))) return p;
          if (me.cp >= 4 && !foeCC && (p = use('skull_crack'))) return p;
          if ((me.cp >= 5 || (me.cp >= 3 && foeHp < 0.25)) && (p = use('envenom'))) return p;
          if ((p = use('viper_strike'))) return p;
          return null;
        }
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
        if (me.spec === 'arms') {
          if (def && hp < 0.45 && (p = use('die_by_the_sword'))) return p;
          if (!visible) return null;
          if (dist > 6 && (p = use('bull_rush'))) return p;
          if (dist > 5 && (p = use('bladestorm'))) return p;
          if (foeHp < 0.3 && (p = use('execute'))) return p;
          if (near(6) >= 1 && foeHp < 0.55 && (p = use('bladestorm'))) return p;
          if ((p = use('rending_blow'))) return p;
          if (!hasBuff(foe, 'slow') && (p = use('crippling_slash'))) return p;
          if (me.res > 70 && (p = use('execute'))) return p;
          return null;
        }
        if (def && hp < 0.45 && (p = use('iron_bulwark'))) return p;
        if (!visible) return null;
        if (dist > 6 && (p = use('bull_rush'))) return p;
        if (near(5) >= 1 && me.res >= 40 && (foeHp < 0.6 || hp < 0.5 || near(6) >= 2) && (p = use('steel_tempest'))) return p;
        if ((p = use('rending_blow'))) return p;
        if (!hasBuff(foe, 'slow') && (p = use('crippling_slash'))) return p;
        if (me.res > 70 && (p = use('crippling_slash'))) return p;
        return null;
      case 'berserker':
        if (me.spec === 'executioner') {
          // great axe: knock down, then land the slow Skullsplitter on a target that can't walk away
          if (def && hp < 0.4 && (p = use('iron_hide'))) return p;
          if (!visible) return null;
          if (dist > 7 && (p = use('skull_leap'))) return p;
          if (foeHp < 0.35 && (p = use('headtaker'))) return p;
          if (dist < 5.5 && !foeCC && (p = use('ground_breaker'))) return p;
          if (dist < 4.5 && (foeCC || isStunned(foe)) && (p = use('skullsplitter'))) return p;
          if (!foe.buffs.some(b => b.name === 'Bleeding' && b.src === me.id) && (p = use('rending_axes'))) return p;
          if (dist < 4.5 && me.res > 60 && (p = use('skullsplitter'))) return p;
          return null;
        }
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
        if (me.spec === 'shadow') {
          const hurtS = this.hurtFriend(me, allies, 0.6);
          if (def && hurtS && !hurtS.buffs.some(b => b.type === 'absorb') && (p = use('divine_aegis', { tid: hurtS.id }))) return p;
          if (def && !isStunned(me) && hasBuff(me, 'root') && td < 8 && (p = use('seraph_step'))) return p;
          if (near(7) && !threatCC && threatMelee && (p = use('psychic_scream'))) return p;
          if (!visible) return null;
          const dots = foe.buffs.filter(b => b.type === 'dot' && b.src === me.id).length;
          if (!foe.buffs.some(b => b.name === 'Shadow Word: Pain' && b.src === me.id && b.t > 2) && (p = use('shadow_word_pain'))) return p;
          if (dots >= 1 && (foeHp < 0.4 || hp < 0.5) && (p = use('void_eruption'))) return p;
          if (freeCast && (p = use('mind_blast'))) return p;
          return null;
        }
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
        if (me.spec === 'enhancement') {
          // melee hybrid: wolf + earthbind to stick, heal itself when low, otherwise strike
          if (def && hp < 0.45 && freeCast && (p = use('healing_surge', { tid: me.id }))) return p;
          const hurtE = this.hurtFriend(me, allies, 0.45); if (def && hurtE && hurtE !== me && freeCast && (p = use('healing_surge', { tid: hurtE.id }))) return p;
          if (def && hasBuff(me, 'root') && td < 8 && (p = use('gale_dash', { dir: away() }))) return p;
          if (!visible) return null;
          if (dist < 12 && (p = use('spirit_wolf'))) return p;
          if (dist < 7 && !hasBuff(foe, 'slow') && (p = use('earthbind_totem'))) return p;
          if (dist > 9 && (p = use('gale_dash', { dir: { x: (foe.x - me.x) / dist, z: (foe.z - me.z) / dist } }))) return p;
          if ((p = use('stormstrike'))) return p;
          if ((p = use('lava_lash'))) return p;
          return null;
        }
        if (def && (hp < 0.6 || (td < 6 && threatMelee) || allies.some(a => a.hp / a.maxHp < 0.5 && sim.dist(me, a) < 6)) && (p = use('stoneskin_totem'))) return p;
        if (near(6) && !threatCC && (p = use('quake_totem'))) return p;
        if (def && hasBuff(me, 'root') && td < 8 && (p = use('gale_dash', { dir: away() }))) return p;
        if (def && td < 4 && threatCC && (p = use('gale_dash', { dir: away() }))) return p;
        if (visible && (p = use('fire_spirit'))) return p;
        if (visible && (p = use('magma_burst'))) return p;
        if (visible && freeCast && (p = use('lightning_lash'))) return p;
        return null;
      case 'hunter': {
        if (me.spec === 'sharpshooter') {
          if (def && td < 6 && threatMelee && (p = use('disengage'))) return p;
          if (!visible) return null;
          if (td < 9 && threatMelee && !threatCC && (p = use('freezing_trap', { tid: threat.id }))) return p;
          if (foeHp < 0.45 && (p = use('piercing_volley'))) return p;
          if (!hasBuff(foe, 'slow') && dist < 20 && (p = use('concussive_bolt'))) return p;
          if (!foe.buffs.some(b => b.name === 'Serpent Sting' && b.src === me.id) && (p = use('serpent_sting'))) return p;
          if (freeCast && (p = use('aimed_shot'))) return p;
          return null;
        }
        const pet = sim.minionOf(me);
        if (!pet && (p = use('bestial_bond'))) return p;
        if (def && (hp < 0.5 || (pet && pet.hp / pet.maxHp < 0.3)) && (p = use('bestial_bond'))) return p;
        if (def && td < 6 && threatMelee && (p = use('disengage'))) return p;
        if (!visible) return null;
        if (pet && (foeHp < 0.6 || hp < 0.6) && (p = use('bestial_wrath'))) return p;
        if ((foe.cast || (td < 6 && threatMelee)) && (p = use('intimidation', { tid: foe.cast ? foe.id : threat.id }))) return p;
        if (!foe.buffs.some(b => b.name === 'Serpent Sting' && b.src === me.id) && (p = use('serpent_sting'))) return p;
        if ((p = use('kill_command'))) return p;
        return null; }
      case 'necromancer': {
        if (def && hp < 0.5 && (p = use('bone_shield'))) return p;
        if (def && (hasBuff(me, 'root') || (td < 5 && threatMelee && !threatCC)) && (p = use('grave_step'))) return p;
        if (!visible) return null;
        if (me.spec === 'curser') {
          const n = sim.curses(me, foe);
          if (!foe.buffs.some(b => b.name === 'Curse of Agony' && b.src === me.id && b.t > 2) && (p = use('curse_of_agony'))) return p;
          if (!foe.buffs.some(b => b.name === 'Curse of Weakness' && b.src === me.id) && (p = use('curse_of_weakness'))) return p;
          if (n >= 2 && (p = use('doom'))) return p;
          if (n >= 2 && (p = use('soul_siphon'))) return p;
          if (!hasBuff(foe, 'slow') && (p = use('bone_spear'))) return p;
          return null;
        }
        const servant = sim.minionOf(me);
        if (servant && (foeHp < 0.7 || td < 8) && (p = use('abomination'))) return p;
        if (servant && Math.hypot(servant.x - foe.x, servant.z - foe.z) < 4 && (servant.hp / servant.maxHp < 0.4 || foeHp < 0.3) && (p = use('corpse_explosion'))) return p;
        if (!hasBuff(foe, 'slow') && (p = use('bone_spear'))) return p;
        if (freeCast && (p = use('soul_rot'))) return p;
        if ((p = use('bone_spear'))) return p;
        return null; }
      case 'paladin': {
        if (me.spec === 'protection') {
          // tank: keep Holy Shield up when hurt, hold the enemies on Consecration, challenge whoever hits the partner
          if (def && hp < 0.4 && (p = use('guardians_resolve'))) return p;
          if (allies.length && def && allies.some(a => a.hp / a.maxHp < 0.4) && near(15) && (p = use('guardians_resolve'))) return p;
          if (me.cp >= 3 || (me.cp >= 1 && hp < 0.5 && !me.buffs.some(b => b.name === 'Holy Shield'))) { if ((p = use('holy_shield'))) return p; }
          if (!visible) return null;
          // challenge an enemy that is busy with our partner
          const loose = allies.length ? living.find(e => e.target !== me.id && !e.buffs.some(b => b.type === 'taunt' && b.src === me.id) && sim.dist(me, e) <= 25) : null;
          if (loose && (p = use('sentinels_shield', { tid: loose.id }))) return p;
          if (dist < 7 && (p = use('consecration'))) return p;
          if ((p = use('pal_shield_slam'))) return p;
          if (dist > 6 && (p = use('judgment'))) return p;
          if ((p = use('judgment'))) return p;
          if (dist > 8 && !foeCC && (p = use('sentinels_shield'))) return p;
          return null;
        }
        // Crusader: build to 3 Holy Power, then Radiant Storm; Divine Wrath for the kill, bubble when about to die
        if (def && hp < 0.25 && (p = use('divine_shield'))) return p;
        if (def && isStunned(me) && hp < 0.45 && (p = use('divine_shield'))) return p;
        if (!visible) return null;
        if (dist > 9 && !foeCC && (p = use('hammer_of_light'))) return p;
        if (dist < 9 && (foeHp < 0.6 || hp < 0.5) && (p = use('divine_wrath'))) return p;
        if (dist < 7.5 && (me.cp >= 3 || (me.cp >= 2 && (foeHp < 0.2 || hp < 0.35))) && (p = use('radiant_storm'))) return p;
        if (me.cp < 3 && (p = use('holy_strike'))) return p;
        if (me.cp < 3 && (p = use('judgment'))) return p;
        return null; }
      case 'druid': {
        if (me.spec === 'feral') {
          if (me.form !== 'bear' && def && hp < 0.35 && (p = use('bear_form'))) return p;
          if (me.form === 'bear') {
            if (def && hp < 0.6 && (p = use('frenzied_regen'))) return p;
            if (hp > 0.7 && (p = use('cat_form'))) return p;
            if (!visible) return null;
            if (dist > 7 && (p = use('wild_pounce'))) return p;
            if (near(6) >= 1 && (p = use('thrash'))) return p;
            if ((p = use('maul'))) return p;
            return null;
          }
          if (!visible) return null;
          if (dist > 7 && (p = use('wild_pounce'))) return p;
          if (dist < 5 && foeHp < 0.6 && (p = use('berserk_instinct'))) return p;
          if ((me.cp >= 5 || (me.cp >= 3 && foeHp < 0.25)) && (p = use('ferocious_bite'))) return p;
          if (!foe.buffs.some(b => b.name === 'Rake' && b.src === me.id) && (p = use('rake'))) return p;
          if ((p = use('shred'))) return p;
          return null;
        }
        // Restoration: keep everyone topped up with stacking heals, root melee, kite
        const low = this.hurtFriend(me, allies, 0.5);
        if (low && (p = use('tree_of_life'))) return p;
        if (def && (hasBuff(me, 'root') || (td < 5 && threatMelee && !threatCC)) && (p = use('wild_charge', { dir: away() }))) return p;
        if (td < 8 && threatMelee && !threatCC && (p = use('entangling_roots', { tid: threat.id }))) return p;
        const hurt = this.hurtFriend(me, allies, 0.85);
        if (hurt && (hurt.buffs.find(b => b.name === 'Rejuvenation' && b.src === me.id)?.data.stacks || 0) < 3 && (p = use('rejuvenation', { tid: hurt.id }))) return p;
        const heal = this.hurtFriend(me, allies, 0.6);
        if (heal && freeCast && (p = use('regrowth', { tid: heal.id }))) return p;
        if (visible && !foe.buffs.some(b => b.name === 'Moonfire' && b.src === me.id) && (p = use('moonfire'))) return p;
        return null; }
    }
    return null;
  }
}
