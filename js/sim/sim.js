// Authoritative combat simulation. Runs on the host (or locally vs. AI).
// Pure logic — no rendering — so it can be serialized and driven over the network.
// Supports any number of fighters split into two teams (1v1 and 2v2).
import { CLASSES, kit, kitOf, validSpec } from '../data/classes.js';
import { tuningOf } from '../data/tuning.js';

export const ARENA_R = 29;
export const PILLARS = [0, 1, 2, 3].map(i => {
  const a = Math.PI / 4 + i * Math.PI / 2;
  return { x: Math.sin(a) * 13, z: Math.cos(a) * 13, r: 2.0 };
});
export const RULES = { winsNeeded: 4, countdown: 3.5, roundEnd: 4.0, dampStart: 60, dampRate: 1.2, gcd: 1.0, critChance: 0.08, critMult: 1.5, backMult: 1.1 };
export const FIGHTER_R = 0.6;
export const MOVE_CAST_SPEED = 0.65;
export const MOVE_ABS = new Set(['arcane_shift', 'shadow_leap', 'bull_rush', 'gale_dash', 'skull_leap', 'blazing_step']);
// Berserker passive: up to +60% damage as health drops (linear with missing health)
export const bloodrage = f => f.cls === 'berserker' ? 1 + (CLASSES.berserker.passive.maxBonus) * (1 - Math.max(0, f.hp) / f.maxHp) : 1;
const STUNLIKE = ['stun', 'disorient'];
const RES_NAME = { mana: 'mana', energy: 'energy', rage: 'rage', focus: 'focus', runic: 'Runic Power' };
// an ability's cost right now (Dread Knight Blood: Reaping Strike is free during Sanguine Covenant)
const costOf = (f, ab) => ab.freeWith && hasBuff(f, ab.freeWith) ? 0 : ab.cost;
// Berserk (Berserker) and Heart of Winter (Dread Knight Frost) share their mechanics: + damage, faster basic attacks, immune to slows and roots
const frenzyOf = f => getBuff(f, 'berserk') || getBuff(f, 'winter');
export const MELEE_AUTO_RANGE = 4.5;
// Melee leeway: when attacker and target are BOTH on the move, melee reaches this much further. Chasing a
// running target otherwise means standing right behind it and still being "out of range" every other swing.
export const MELEE_LEEWAY = 0.8;
export const meleeBonus = (f, t) => (f.moving && t.moving ? MELEE_LEEWAY : 0);
// Arena vitality: in team fights everyone has this much more health, so focus fire doesn't end a fight
// before heals, interrupts and defensive cooldowns get a say (first kill: median 11 s → ~16 s)
export const TEAM_VITALITY = 1.5;
export const ATTACK_BUFFER = 0.4; // s a left click stays queued while the swing timer finishes
export const FACE_ARC = 1.75;     // rad to either side: melee swings and strikes need the target inside this frontal arc (200°)
export const QUEUE_WINDOW = 0.5;  // s before the GCD / current cast ends in which the next ability press is buffered
const MOVE_QUEUE = 0.45;          // s a cast pressed while still moving waits for you to stop before it gives up
// A melee swing lands a moment after it starts (the weapon has to travel): heavier weapons take longer.
// The renderer lines the swing animation up with this, so the blow, the number and the sound coincide.
export const meleeHitT = A => Math.max(0.13, Math.min(0.24, 0.06 + A.speed * 0.065));

// ---------------------------------------------------------------- aimed basic attacks
// Basic attacks go where the player aims — the dot in the middle of the screen — not to the selected target.
// A melee blow lands if, at the moment of impact, the aim ray passes through an enemy's hitbox within reach in
// front of you; a ranged shot flies straight at the aim point and hits whichever hitbox it passes through.
// Every champion has the same hitbox, a vertical capsule, whatever the size of its model.
export const HITBOX = { r: 0.55, y0: 0.1, y1: 1.95 };
// pets and summons (ghoul, abomination, gorilla, spirit wolf …) share one smaller hitbox — also independent of the model
export const MINION_HITBOX = { r: 0.45, y0: 0.1, y1: 1.5 };
const boxOf = t => (t.owner !== undefined && t.cls === undefined ? MINION_HITBOX : HITBOX);
export const MELEE_AIM_WIDTH = 0.25; // a weapon swing sweeps a little: for melee the aim ray counts this much wider
const PROJ_R = 0.12;                 // radius of an aimed bolt / arrow
// Closest approach between the segment p + s·u (s in 0..1) and the axis of t's hitbox: { d, s }
export function hitboxDist(px, py, pz, ux, uy, uz, t) {
  const H = boxOf(t), qx = t.x, qy = t.y + H.y0, qz = t.z, vy = H.y1 - H.y0; // axis: q + w·(0, vy, 0), w in 0..1
  const rx = px - qx, ry = py - qy, rz = pz - qz;
  const a = ux * ux + uy * uy + uz * uz, e = vy * vy, b = uy * vy, c = ux * rx + uy * ry + uz * rz, f = vy * ry;
  const den = a * e - b * b, cl = v => Math.max(0, Math.min(1, v));
  let s = den > 1e-9 ? cl((b * f - c * e) / den) : 0, w = (b * s + f) / e;
  if (w < 0) { w = 0; s = cl(-c / a); } else if (w > 1) { w = 1; s = cl((b - c) / a); }
  const dx = px + ux * s - qx, dy = py + uy * s - (qy + vy * w), dz = pz + uz * s - qz;
  return { d: Math.sqrt(dx * dx + dy * dy + dz * dz), s };
}
// a champion or a minion (pet / summon) that an aimed basic attack can hit — minions have the same hitbox
export const isMinion = u => u.owner !== undefined && u.cls === undefined;
const hittable = u => (isMinion(u) ? u.hp > 0 : u.alive && !u.buffs.some(b => b.type === 'stealth'));
// aim = [ox, oy, oz, dx, dy, dz] (a ray, unit direction). The first enemy unit of `me` (champions and minions)
// whose hitbox the ray passes through within `len` metres (ray widened by `thick`) and that passes `ok`:
// { f, dist } or null.
export function aimPick(units, me, aim, len, thick = 0, ok = null) {
  let best = null;
  for (const t of units) {
    if (t.team === me.team || !hittable(t)) continue;
    const r = hitboxDist(aim[0], aim[1], aim[2], aim[3] * len, aim[4] * len, aim[5] * len, t);
    if (r.d > boxOf(t).r + thick || r.s * len < 0.3 || (ok && !ok(t))) continue;
    if (!best || r.s * len < best.dist) best = { f: t, dist: r.s * len };
  }
  return best;
}
// Aim assist for players' ranged basic attacks (bots aim themselves). Hitting a strafing enemy with a bolt that
// flies half a second meant aiming 3–4 m ahead of it by hand, while bots hit nearly every shot — so ranged specs
// felt hopeless for people. Now an enemy counts as aimed at when the dot is within ASSIST_M (+ a little per metre
// of distance) of its hitbox; the shot then leads it (shootAuto) and bends towards it a little (stepStraight).
export const ASSIST_M = 0.45, ASSIST_PER_M = 0.035, ASSIST_TURN = 2.2;
// the enemy nearest to the aim ray within the assist cone: { f, dist } or null (the line of sight check is `ok`'s)
export function assistPick(units, me, aim, len, ok = null) {
  let best = null, bestOff = Infinity;
  for (const t of units) {
    if (t.team === me.team || !hittable(t)) continue;
    const r = hitboxDist(aim[0], aim[1], aim[2], aim[3] * len, aim[4] * len, aim[5] * len, t);
    const along = r.s * len, off = r.d - boxOf(t).r;
    if (along < 0.3 || off > ASSIST_M + ASSIST_PER_M * along || (ok && !ok(t))) continue;
    const score = off / (1 + along * 0.05); // the nearest to the dot (in angle), then the nearest in distance
    if (score < bestOff) { bestOff = score; best = { f: t, dist: along }; }
  }
  return best;
}
// a ray from the input, or null: finite numbers, unit direction, origin near the fighter (the camera can't be further)
function readAim(a, f) {
  if (!Array.isArray(a) || a.length !== 6 || !a.every(Number.isFinite)) return null;
  const l = Math.hypot(a[3], a[4], a[5]); if (l < 1e-6) return null;
  if (Math.hypot(a[0] - f.x, a[1] - f.y, a[2] - f.z) > 22) return null;
  return [a[0], a[1], a[2], a[3] / l, a[4] / l, a[5] / l];
}

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
  slow *= 1 - (kitOf(f).passive?.slowResist || 0); // some melee specs shrug off part of every slow (they must stick to their target)
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
// ---------------------------------------------------------------- the map
// null = the arena (a ring of radius ARENA_R with four pillars). A battleground map (js/sim/maps/) adds box
// geometry on top of the central bridge: solid blocks (walls, cliffs, floor slabs, parapets, gates), ramps
// (solid wedges you walk up), a rectangular boundary and water. Every geometry query below consults it.
let GEO = null;
export const currentMap = () => GEO;
export function useMap(map) { GEO = map || null; if (GEO) GEO.gatesOpen = !!GEO.gatesOpen; }
const BOX_M = 0.45;                                   // body radius used against boxes (feet are a point)
const inFoot = (b, x, z, m = BOX_M) => x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m;
const live = b => !b.gate || !GEO.gatesOpen;          // gates are solid until they open
export const rampAt = (r, x, z) => { const u = Math.max(0, Math.min(1, r.axis === 'x' ? (x - r.x0) / (r.x1 - r.x0) : (z - r.z0) / (r.z1 - r.z0))); return r.h0 + (r.h1 - r.h0) * u; };
// Hills { x0, x1, z0, z1, r, h }: soft mounds of ground — a flat top over the rectangle that falls away over r
// with a cosine profile (steepest slope h·π / 2r). They are the ground itself: always walkable, never a wall, and
// they block sight and shots like terrain. Pure, so the renderer builds the same surface.
export function hillH(H, x, z) {
  const dx = Math.max(H.x0 - x, 0, x - H.x1), dz = Math.max(H.z0 - z, 0, z - H.z1), d = Math.hypot(dx, dz) / H.r;
  return d >= 1 ? 0 : H.h * 0.5 * (1 + Math.cos(Math.PI * d));
}
export function mapGround(map, x, z) {
  let g = 0;
  if (map && map.hills) for (const H of map.hills) { const v = hillH(H, x, z); if (v > g) g = v; }
  return g;
}
// does the segment a->b dip into a hill? (sampled every half yard over the part that crosses its footprint)
function hillBlocks(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dz = bz - az, dy = by - ay;
  for (const H of GEO.hills) {
    if (H.h < Math.min(ay, by)) continue;
    let t0 = 0, t1 = 1;
    for (const [p, d, lo, hi] of [[ax, dx, H.x0 - H.r, H.x1 + H.r], [az, dz, H.z0 - H.r, H.z1 + H.r]]) {
      if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { t1 = -1; break; } continue; }
      let u0 = (lo - p) / d, u1 = (hi - p) / d; if (u0 > u1) [u0, u1] = [u1, u0];
      t0 = Math.max(t0, u0); t1 = Math.min(t1, u1); if (t0 > t1) break;
    }
    if (t0 > t1) continue;
    const n = Math.max(1, Math.ceil((t1 - t0) * Math.hypot(dx, dz) / 0.5));
    for (let i = 0; i <= n; i++) { const t = t0 + (t1 - t0) * i / n; if (ay + dy * t < hillH(H, ax + dx * t, az + dz * t) - 0.05) return true; }
  }
  return false;
}
function boxFloor(x, z, y, tol = 0.9) {
  let fl = GEO.hills ? mapGround(GEO, x, z) : 0;
  for (const b of GEO.blocks) if (b.y1 > fl && b.y1 <= y + tol && live(b) && inFoot(b, x, z)) fl = b.y1;
  for (const r of GEO.ramps) if (inFoot(r, x, z, 0.05)) { const h = rampAt(r, x, z); if (h > fl && h <= y + tol - 0.15) fl = h; }
  return fl;
}
function boxSolid(x, z, y) {
  for (const b of GEO.blocks) if (y < b.y1 - 0.6 && y + 1.9 > b.y0 && live(b) && inFoot(b, x, z)) return b;
  for (const r of GEO.ramps) if (inFoot(r, x, z, 0.05) && y < rampAt(r, x, z) - 0.75) return r;
  return null;
}
function boxCeil(x, z, y) {
  let c = Infinity;
  for (const b of GEO.blocks) if (b.y0 > y + 0.5 && b.y0 - 2.0 < c && live(b) && inFoot(b, x, z)) c = b.y0 - 2.0;
  return c;
}
// inside the playable area (with a margin)?
export function inBounds(x, z, m = FIGHTER_R) {
  if (!GEO) return Math.hypot(x, z) <= ARENA_R - m;
  const B = GEO.bounds; return x >= B.x0 + m && x <= B.x1 - m && z >= B.z0 + m && z <= B.z1 - m;
}
export function clampToBounds(o, m = FIGHTER_R) {
  if (!GEO) { const d = Math.hypot(o.x, o.z), max = ARENA_R - m; if (d > max) { o.x *= max / d; o.z *= max / d; } return; }
  const B = GEO.bounds; o.x = Math.max(B.x0 + m, Math.min(B.x1 - m, o.x)); o.z = Math.max(B.z0 + m, Math.min(B.z1 - m, o.z));
}
export const inWater = (x, z, y) => !!(GEO && GEO.water && y < 0.3 && Math.abs(x - GEO.water.x) < GEO.water.hw && !(Math.abs(z) <= EDGE && Math.abs(x) <= BR.hx));
// is the point inside map masonry? (camera collision)
export function pointBlocked(x, y, z) {
  if (!GEO) return false;
  for (const b of GEO.blocks) if (y > b.y0 && y < b.y1 && live(b) && inFoot(b, x, z, 0.2)) return true;
  for (const r of GEO.ramps) if (inFoot(r, x, z, 0) && y < rampAt(r, x, z)) return true;
  return !!GEO.hills && y < mapGround(GEO, x, z);
}

// height of the walkable surface under a fighter whose feet are at y
export function floorAt(x, z, y) {
  const g = GEO ? boxFloor(x, z, y) : 0;
  if (Math.abs(z) > EDGE) return g;
  const ax = Math.abs(x);
  if (ax <= BR.hx) return Math.max(g, y >= BR.H - 0.9 ? BR.H : 0);
  if (ax <= BR_END) { const h = rampH(ax); return Math.max(g, y >= h - 0.75 ? h : 0); }
  return g;
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
  if (GEO && boxSolid(x, z, y)) return true;
  const ax = Math.abs(x), az = Math.abs(z);
  if (az > EDGE) return false;
  if (ax <= BR.hx) return y < BR.H - 0.9 && ax > ARCH_OPEN;
  return ax <= BR_END + 0.3 && y < rampH(ax) - 0.75;
}
// where a leap/teleport ending at height y comes to rest (never inside a ramp)
export function landAt(x, z, y) {
  const g = GEO ? boxFloor(x, z, y, 1.4) : 0;
  if (Math.abs(z) > EDGE) return g;
  const ax = Math.abs(x);
  if (ax <= BR.hx) return Math.max(g, y >= BR.H - 1.4 ? BR.H : 0);
  return Math.max(g, ax <= BR_END ? rampH(ax) : 0);
}
// under the vault (or a floor slab) a jump bumps the ceiling: highest feet position at this spot (Infinity = open sky)
export function ceilAt(x, z, y) {
  const g = GEO ? boxCeil(x, z, y) : Infinity;
  const ax = Math.abs(x);
  if (ax > BR.hx + 0.2 || Math.abs(z) > EDGE || y >= BR.H - 0.9) return g;
  return Math.min(g, Math.max(0, archY(Math.min(BR.hx, ax + 0.3)) - 2.1));
}
export const airborne = f => f.y - floorAt(f.x, f.z, f.y) > 0.05;
// shoved into the masonry (by another fighter, a pillar push, lag...): move out the shortest way
export function unstick(f) {
  if (!solidAt(f.x, f.z, f.y)) return;
  if (GEO) { const b = boxSolid(f.x, f.z, f.y); if (b) { unstickBox(f, b); return; } }
  const ax = Math.abs(f.x), az = Math.abs(f.z);
  const opts = [{ c: EDGE + 0.02 - az, go: () => { f.z = Math.sign(f.z || 1) * (EDGE + 0.02); } }];
  if (ax <= BR.hx) opts.push({ c: ax - ARCH_OPEN + 0.02, go: () => { f.x = Math.sign(f.x) * (ARCH_OPEN - 0.02); } });
  else { const h = rampH(ax); opts.push({ c: (h - f.y) * 0.6, go: () => { f.y = h; f.vy = 0; } }); }
  opts.sort((a, b) => a.c - b.c)[0].go();
}
// pushed into a block or ramp: out through the nearest side (or onto it, if it is only a step up)
function unstickBox(f, b) {
  const top = b.axis ? rampAt(b, f.x, f.z) : b.y1;
  const opts = [
    { c: f.x - (b.x0 - BOX_M - 0.02), go: () => { f.x = b.x0 - BOX_M - 0.02; } },
    { c: (b.x1 + BOX_M + 0.02) - f.x, go: () => { f.x = b.x1 + BOX_M + 0.02; } },
    { c: f.z - (b.z0 - BOX_M - 0.02), go: () => { f.z = b.z0 - BOX_M - 0.02; } },
    { c: (b.z1 + BOX_M + 0.02) - f.z, go: () => { f.z = b.z1 + BOX_M + 0.02; } },
    { c: (top - f.y) * 1.2, go: () => { f.y = top; f.vy = 0; } },
  ];
  opts.sort((a, c) => a.c - c.c)[0].go();
}
// 3D segment vs an axis-aligned block (slab test)
function segBox(ax, ay, az, bx, by, bz, b) {
  let t0 = 0, t1 = 1;
  for (const [p, d, lo, hi] of [[ax, bx - ax, b.x0, b.x1], [ay, by - ay, b.y0, b.y1], [az, bz - az, b.z0, b.z1]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; }
    let u0 = (lo - p) / d, u1 = (hi - p) / d; if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0); t1 = Math.min(t1, u1); if (t0 > t1) return false;
  }
  return true;
}
// a ramp as a solid wedge: footprint, ground, and the sloping top
function rampPlanes(r) {
  if (r._planes) return r._planes;
  const P = [[-1, 0, 0, -r.x0], [1, 0, 0, r.x1], [0, 0, -1, -r.z0], [0, 0, 1, r.z1], [0, -1, 0, 0]];
  if (r.axis === 'x') { const k = (r.h1 - r.h0) / (r.x1 - r.x0); P.push([-k, 1, 0, r.h0 - k * r.x0]); }
  else { const k = (r.h1 - r.h0) / (r.z1 - r.z0); P.push([0, 1, -k, r.h0 - k * r.z0]); }
  return (r._planes = P);
}
function boxBlocks(ax, ay, az, bx, by, bz) {
  const lx = Math.min(ax, bx), hx = Math.max(ax, bx), lz = Math.min(az, bz), hz = Math.max(az, bz), ly = Math.min(ay, by), hy = Math.max(ay, by);
  for (const b of GEO.blocks) {
    if (b.x1 < lx || b.x0 > hx || b.z1 < lz || b.z0 > hz || b.y1 < ly || b.y0 > hy || b.noSight || !live(b)) continue;
    if (segBox(ax, ay, az, bx, by, bz, b)) return true;
  }
  for (const r of GEO.ramps) {
    if (r.x1 < lx || r.x0 > hx || r.z1 < lz || r.z0 > hz || Math.max(r.h0, r.h1) < ly) continue;
    if (clipSeg([ax, ay, az], [bx - ax, by - ay, bz - az], rampPlanes(r))) return true;
  }
  return !!GEO.hills && hillBlocks(ax, ay, az, bx, by, bz);
}
// a straight walk from a to b at ground level: possible without climbing, and without dropping unless allowed?
// (bots use this to link their waypoints; y follows the floor along the way)
export function walkLine(ax, ay, az, bx, bz, allowDrop = false) {
  const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 0.5));
  let y = ay;
  for (let i = 1; i <= n; i++) {
    const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n;
    if (!inBounds(x, z, 0.3)) return null;
    const fl = floorAt(x, z, y);
    if (y - fl > 0.6) { if (!allowDrop) return null; y = fl; }
    else y = fl;
    if (solidAt(x, z, y)) return null;
  }
  return y;
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
  if (GEO) return boxBlocks(ax, ay, az, bx, by, bz);
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
  if (!GEO) for (const p of PILLARS) {
    const dx = f.x - p.x, dz = f.z - p.z, d = Math.hypot(dx, dz), min = p.r + FIGHTER_R;
    if (d < min) { const k = (min - d) / (d || 1e-6); f.x += dx * k; f.z += dz * k; }
  }
  clampToBounds(f);
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
  if (GEO && inWater(f.x, f.z, f.y)) speed *= 0.85; // wading through the river
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
  // "moving" means moving on your own input: being shoved by someone who walks into you must not
  // break your cast (or Steady Aim)
  f.moving = moved > 0.2 * dt && (mx !== 0 || mz !== 0);
  f.moveDir = moved > 0.2 * dt ? { x: (f.x - ox) / moved, z: (f.z - oz) / moved } : null;
}

// ---------------------------------------------------------------- fighter
const freshStats = () => ({ dmg: 0, heal: 0, absorbed: 0, ccs: 0, interrupts: 0, crits: 0, kills: 0 });

function makeFighter(id, spec) {
  const sid = validSpec(spec.cls, spec.spec), C = kitOf({ cls: spec.cls, spec: sid });
  return {
    id, cls: spec.cls, spec: sid, form: C.defaultForm || null, team: spec.team, name: spec.name || C.name, bot: !!spec.bot,
    x: 0, y: 0, z: 0, vy: 0, yaw: 0, hp: C.hp, maxHp: C.hp,
    res: C.resStart ?? C.res, maxRes: C.res, resType: C.resType,
    cds: [0, 0, 0, 0, 0, 0], ch: C.abilities.map(a => a.charges || 0), gcd: 0, cast: null, buffs: [], cp: 0, stamina: 100, alive: true,
    moving: false, sprinting: false, autoT: 0, atkReq: 0, atkHold: false, atkWarn: false, swing: null, forceSeq: 0, forceYaw: 0, locked: false, dash: null,
    target: -1, friend: -1, dr: {}, queued: null, moveDir: null,
    stats: freshStats(),
  };
}

let NEXT_ID = 1;

export class Sim {
  // roster: [{ cls, team, name, bot }]  — or legacy (clsA, clsB) for a 1v1
  constructor(roster, clsB) {
    if (typeof roster === 'string') roster = [{ cls: roster, team: 0 }, { cls: clsB, team: 1 }];
    useMap(this.constructor.MAP || null); // the arena, or a battleground subclass's map
    this.fighters = roster.map((s, i) => makeFighter(i, s));
    this.teamSize = [0, 1].map(t => this.fighters.filter(f => f.team === t).length);
    this.fmt = this.teamSize[0] >= 2 && this.teamSize[1] >= 2 ? 'team' : 'duel'; // which arena tuning applies (data/tuning.js)
    this.projectiles = [];
    this.zones = [];
    this.minions = []; // pets & summons (max 1 per player)
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
    this.projectiles = []; this.zones = []; this.minions = [];
    for (const f of this.fighters) {
      const C = kitOf(f);
      Object.assign(f, {
        hp: Math.round(C.hp * this.vitality(f)), maxHp: Math.round(C.hp * this.vitality(f)), res: C.resStart ?? C.res, maxRes: C.res, cds: [0, 0, 0, 0, 0, 0], ch: C.abilities.map(a => a.charges || 0), gcd: 0, cast: null, buffs: [],
        cp: 0, stamina: 100, alive: true, vy: 0, y: 0, dash: null, locked: false, dr: {}, queued: null, autoT: 0, atkReq: 0, atkHold: false, atkWarn: false, swing: null, form: kit(f.cls, f.spec).defaultForm || null, petT: 0,
        target: this.defaultTarget(f), friend: -1, kc: false, autoN: 0, taken: [],
      });
      const s = this.spawnOf(f);
      f.x = s.x; f.z = s.z; f.yaw = s.yaw;
      f.forceSeq++; f.forceYaw++;
    }
    this.state = 'countdown'; this.stateT = RULES.countdown; this.fightT = 0; this.damp = 0;
    this.event({ e: 'roundStart', round: this.round });
  }

  vitality(f) { return this.teamSize[f.team] >= 2 && this.teamSize[1 - f.team] >= 2 ? TEAM_VITALITY : 1; }

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
      if (this.stateT <= 0) { this.state = 'fight'; this.fightT = 0; for (const f of this.fighters) f.petT = 0; this.event({ e: 'fight' }); } // pets appear when the gates open
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
    this.damp = this.noDamp ? 0 : Math.min(100, Math.max(0, (this.fightT - RULES.dampStart) * RULES.dampRate)); // battlegrounds: no dampening

    for (const f of this.fighters) {
      const inp = inputs[f.id] || {};
      this.moveStep(f, inp, dt, true);
      this.applyTargeting(f, inp);
      if (f.alive && inp.abilities) for (const a of inp.abilities) this.tryAbility(f, a.i, a);
      f.atkHold = f.alive && !!(inp.atkHold || (inp.remote && inp.remote.h));
      f.aim = readAim(inp.aim || (inp.remote && inp.remote.a), f); // where the player aims (null: straight ahead)
      if (f.alive && inp.attack) this.startAttack(f, true);
    }
    for (const f of this.fighters) this.updateFighter(f, dt);
    this.trackVelocity(dt);
    this.updateProjectiles(dt);
    this.updateZones(dt);
    this.updateMinions(dt);
    this.checkDeaths();
  }

  applyTargeting(f, inp) {
    if (inp.setTarget !== undefined && inp.setTarget !== null) {
      const t = this.fighters[inp.setTarget];
      if (t && t.team !== f.team && this.visibleTo(t, f) && f.target !== t.id) { f.target = t.id; f.atkReq = 0; } // switching targets drops a buffered click
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
    f.target = list[(i + 1) % list.length].id; f.atkReq = 0;
  }

  // ------------------------------------------------------------ queries
  enemiesOf(f) { return this.fighters.filter(o => o.team !== f.team && o.alive); }
  alliesOf(f) { return this.fighters.filter(o => o.team === f.team && o.id !== f.id && o.alive); }
  // Paladin Holy Power (combo points capped at 3): builders add, spenders consume all of it
  holyPower(f, n) { f.cp = Math.min(kitOf(f).passive?.maxHp || 3, f.cp + n); }
  spendHoly(f) { const n = f.cp; f.cp = 0; return n; }
  // Paladin Challenge (taunt): the enemy deals less damage to anyone but the paladin; bots turn on him
  taunt(src, t, dur) { if (!t.alive) return; const v = kitOf(src).passive?.taunt || 0.25; this.addBuff(t, 'taunt', dur, { value: v, src: src.id, name: 'Challenged', icon: '⚑' }); }
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
    if (costOf(f, ab) > f.res) return `Not enough ${RES_NAME[f.resType]}`;
    if (ab.needsCp && f.cp < 1) return f.cls === 'paladin' ? 'No Holy Power' : 'No combo points';
    if (ab.needsPet && !this.minionOf(f)) return 'Your pet is not here';
    if (ab.target) {
      const t = this.hostileFor(f, opts.tid);
      if (!t) return 'No target';
      const d = this.dist(f, t);
      if (d > ab.range + 0.3 + (ab.melee ? meleeBonus(f, t) : 0)) return 'Out of range';
      if (ab.minRange && d < ab.minRange) return 'Too close';
      if (!ab.melee && !this.los(f, t)) return 'Target not in line of sight';
      if (ab.melee && Math.abs(angleDiff(f.yaw, angleTo(f, t))) > FACE_ARC) return 'You must face your target';
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
    let err = this.check(f, idx, false, opts);
    // Spell queue: a press shortly before the GCD or the current cast ends is buffered and fires the
    // moment it can, so chaining abilities never drops an input.
    if (err === 'GCD' || err === 'Already casting') {
      const wait = Math.max(f.gcd, f.cast ? f.cast.dur - f.cast.t : 0);
      if (wait <= QUEUE_WINDOW) { f.queued = { i: idx, dir: opts.dir, tid: opts.tid, t: wait + 0.3 }; return null; }
      if (err === 'GCD') return null;
    }
    // A cast pressed while still running is held for a moment and starts as soon as you stop, instead of
    // starting and breaking at once (which cost the GCD and felt like a dropped input).
    const still = ab.cast > 0 && !ab.moveCast && f.moving;
    if (!err && still) {
      if (!opts.fromQueue) { f.queued = { i: idx, dir: opts.dir, tid: opts.tid, t: MOVE_QUEUE }; return null; }
      err = "Can't cast while moving";
    }
    if (err) {
      if (err !== 'Not now') this.event({ e: 'err', id: f.id, msg: err });
      return err;
    }
    const t = this.resolveTarget(f, ab, opts);
    if (ab.target && t && f.target !== t.id) { f.target = t.id; f.atkReq = 0; }
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
    f.res -= costOf(f, ab);
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
    for (const o of this.fighters) if (o.team !== c.team && o.target === c.id) { o.target = -1; o.atkReq = 0; }
    for (const o of this.fighters) if (o.team !== c.team && o.cast && o.cast.tid === c.id) {
      this.cancelCast(o, false); this.event({ e: 'err', id: o.id, msg: 'Your target vanished' });
    }
  }

  // ------------------------------------------------------------ basic attacks
  // Basic attacks only happen on player input: a left click requests ONE swing (buffered for
  // ATTACK_BUFFER s, so a click just before the swing timer is ready still goes off), and holding the
  // button keeps swinging. The swing timer (autoT) is the only rate limit. A swing always goes off —
  // whether it hits is up to the aim (see aimPick): no target is needed and none is chosen for you.
  startAttack(f) {
    if (!f.alive || this.state !== 'fight') return;
    f.atkReq = ATTACK_BUFFER;
  }

  // everything an aimed basic attack can hit: champions and their pets / summons
  units() { return this.minions.length ? [...this.fighters, ...this.minions] : this.fighters; }
  // the fighter's aim ray this tick; without one (bots that don't aim, old clients) straight ahead at chest height
  aimOf(f) { return f.aim || [f.x, f.y + 1.3, f.z, Math.sin(f.yaw), 0, Math.cos(f.yaw)]; }
  // what you hit becomes your target when you have none (so abilities follow your basic attacks)
  claimTarget(f, t) { const c = this.fighters[f.target]; if (!c || !c.alive || c.team === f.team || !this.visibleTo(c, f)) f.target = t.id; }

  // every unit's smoothed ground velocity (players' aim assist leads moving targets with it); teleports are skipped
  trackVelocity(dt) {
    const k = Math.min(1, dt * 8);
    for (const u of this.units()) {
      if (u._px !== undefined) {
        const vx = (u.x - u._px) / dt, vz = (u.z - u._pz) / dt;
        if (vx * vx + vz * vz < 225) { u.vx = (u.vx || 0) * (1 - k) + vx * k; u.vz = (u.vz || 0) * (1 - k) + vz * k; }
      }
      u._px = u.x; u._pz = u.z;
    }
  }

  // a ranged basic attack: a straight bolt from the weapon towards the aim point (the first hitbox under the
  // aim ray, or where the ray ends at the weapon's range / meets the ground). Returns the fighter aimed at.
  // Players (not bots — they aim themselves) get aim assist: a dot on or near an enemy (assistPick) fires at
  // where that enemy will be when the bolt arrives, and the bolt bends a little towards it in flight.
  shootAuto(f, A) {
    const aim = this.aimOf(f), fw = this.forward(f);
    const M = [f.x + fw.x * 0.8, f.y + 1.6, f.z + fw.z * 0.8];
    const reach = A.range + 1;
    const L = Math.hypot(aim[0] - f.x, aim[1] - f.y - 1.5, aim[2] - f.z) + reach; // camera → beyond the weapon's range
    const inReach = t => this.dist(f, t) <= reach;
    let pick = aimPick(this.units(), f, aim, L, 0, inReach);
    if (!pick && !f.bot) pick = assistPick(this.units(), f, aim, L, t => inReach(t) && !segBlocked(f.x, f.z, t.x, t.z, f.y + 1.5, t.y + 1.2));
    let dx, dy, dz;
    if (pick && !f.bot) {
      // lead: aim at the target's chest where it will be when the bolt gets there (two passes for the flight time)
      const t = pick.f; let px = t.x, pz = t.z;
      for (let n = 0; n < 2; n++) { const tt = Math.hypot(px - M[0], pz - M[2]) / A.projSpeed; px = t.x + (t.vx || 0) * tt; pz = t.z + (t.vz || 0) * tt; }
      dx = px - M[0]; dy = t.y + (isMinion(t) ? 0.8 : 1.05) - M[1]; dz = pz - M[2];
    } else {
      let s = pick ? pick.dist : L;
      if (!pick && aim[4] < -1e-3) s = Math.min(s, (aim[1] - floorAt(f.x, f.z, f.y) - 0.05) / -aim[4]); // into the ground
      dx = aim[0] + aim[3] * s - M[0]; dy = aim[1] + aim[4] * s - M[1]; dz = aim[2] + aim[5] * s - M[2];
    }
    let l = Math.hypot(dx, dy, dz);
    if (l < 1.5) { dx = aim[3]; dy = aim[4]; dz = aim[5]; l = 1; } // aim point right at the muzzle: fly along the aim
    const t0 = pick ? pick.f : null;
    this.projectiles.push({ id: NEXT_ID++, kind: A.proj, owner: f.id, team: f.team, target: -1, straight: true, x: M[0], y: M[1], z: M[2], dx: dx / l, dy: dy / l, dz: dz / l, speed: A.projSpeed, left: reach + 2,
      home: t0 && !f.bot ? t0 : null,
      onHit: t => {
        if (isMinion(t)) { this.hitMinion(f, t, A.dmg, { school: A.school }); return; }
        this.claimTarget(f, t);
        this.damage(f, t, A.dmg, { school: A.school, ab: 'auto', auto: true });
        if (A.burn) this.kindle(f, t); // Fire Mage: Kindling
        if (A.hex) { const b = this.addBuff(t, 'hexed', 4, { src: f.id, name: 'Hex', icon: '☠' }); if (b) b.data.curse = true; } // Curser: Hex
      } });
    return t0;
  }

  // why a basic attack on t couldn't land right now (null = it could) — what bots use to decide when to swing
  autoBlock(f, t, A) {
    const d = this.dist(f, t);
    if (A.ranged) return d > A.range + 0.3 ? 'Out of range' : !this.los(f, t) ? 'Target not in line of sight' : null;
    return d > MELEE_AUTO_RANGE + meleeBonus(f, t) ? 'Out of range' : Math.abs(angleDiff(f.yaw, angleTo(f, t))) > FACE_ARC ? 'You must face your target' : null;
  }

  updateAuto(f, dt) {
    const A = kitOf(f).auto;
    f.autoT = Math.max(0, f.autoT - dt);
    // a melee swing that is already under way lands now (see meleeHitT)
    if (f.swing && (f.swing.t -= dt) <= 0) { const s = f.swing; f.swing = null; this.landSwing(f, s, A); }
    const had = f.atkReq > 0;
    f.atkReq = Math.max(0, f.atkReq - dt);
    if (!A || !(f.atkHold || had)) return;
    if (f.autoT > 0 || f.swing || isStunned(f) || f.cast || f.dash || hasBuff(f, 'tempest')) return;
    f.autoT = A.speed / (frenzyOf(f) ? 1.3 : 1); f.atkReq = 0;
    this.removeBuff(f, 'stealth');
    if (A.ranged) {
      const aimed = this.shootAuto(f, A), aim = this.aimOf(f);
      this.event({ e: 'auto', id: f.id, tid: aimed ? aimed.id : -1, ranged: true, hit: 0, dx: aim[3], dz: aim[5] });
    } else {
      const hit = meleeHitT(A);
      f.swing = { t: hit };
      this.event({ e: 'auto', id: f.id, tid: -1, ranged: false, hit });
    }
  }

  // The blow of a melee swing, a moment after it started: it hits the first enemy under the aim ray that is
  // within reach and in front of you — or nothing (a miss: the swing is spent all the same).
  landSwing(f, s, A) {
    if (!f.alive || !A || A.ranged) return;
    const aim = this.aimOf(f);
    const pick = aimPick(this.units(), f, aim, 40, MELEE_AIM_WIDTH, t => this.dist(f, t) <= MELEE_AUTO_RANGE + (isMinion(t) ? 0 : meleeBonus(f, t)) && Math.abs(angleDiff(f.yaw, angleTo(f, t))) <= FACE_ARC);
    if (!pick) {
      const fw = this.forward(f);
      this.event({ e: 'miss', id: f.id, x: f.x + fw.x * 2.2, y: f.y + 1.4, z: f.z + fw.z * 2.2, melee: true });
      return;
    }
    const t = pick.f;
    if (isMinion(t)) { this.hitMinion(f, t, A.dmg, { school: A.school, melee: true }); return; } // a ghoul / pet in the way takes the blow
    this.claimTarget(f, t);
    this.damage(f, t, A.dmg, { school: A.school, ab: 'auto', auto: true, melee: true });
    if (A.poison) this.poison(f, t); // Assassination: Venom Mastery
    if (A.zap && Math.random() < A.zap) this.damage(f, t, 24, { school: 'nature', ab: 'maelstrom' }); // Enhancement: Maelstrom
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
    f.stillT = f.moving ? 0 : (f.stillT || 0) + dt; // Sharpshooter Steady Aim
    // permanent pets (Hunter Beastmaster, Necromancer Summoner): appear at the fight start, rise again after dying
    const PET = C.passive && C.passive.pet;
    if (PET && this.state === 'fight' && !this.minionOf(f)) { f.petT = (f.petT ?? 0) - dt; if (f.petT <= 0) { this.summon(f, PET.kind, PET); f.petT = PET.respawn; } }
    // queued ability
    if (f.queued) {
      const q = f.queued, qa = C.abilities[q.i]; q.t -= dt;
      const busy = !qa || (qa.gcd && (f.gcd > 0 || !!f.cast));            // still on the GCD / finishing a cast
      const running = !!qa && qa.cast > 0 && !qa.moveCast && f.moving;     // a cast waiting for you to stop
      if (!busy && !running) { f.queued = null; this.tryAbility(f, q.i, { dir: q.dir, tid: q.tid, fromQueue: true }); }
      else if (q.t <= 0) { f.queued = null; if (!busy && running) this.event({ e: 'err', id: f.id, msg: "Can't cast while moving" }); }
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
          if (costOf(f, ab) > f.res) err = `Not enough ${RES_NAME[f.resType]}`;
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
      } else if (b.type === 'hot') { // heal over time (Druid)
        b.data.acc += dt;
        while (b.data.acc >= 1 && b.data.ticks > 0) { b.data.acc -= 1; b.data.ticks--; this.heal(this.fighters[b.src], f, b.data.per, b.data.ab || 'hot'); }
      } else if (b.type === 'tempest') {
        b.data.tick -= dt;
        if (b.data.tick <= 0) {
          b.data.tick += 0.5;
          this.aoeMinions(f, f.x, f.z, 6, b.data.dmg || 38);
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
        if (b.type === 'doom' && f.alive) { // Necromancer Curser signature: detonates when it runs out
          const src = this.fighters[b.src], n = f.buffs.filter(x => x.src === b.src && x.data?.curse).length;
          this.event({ e: 'fx', fx: 'doom_pop', id: f.id, x: f.x, z: f.z });
          this.damage(src, f, b.data.dmg + b.data.per * n, { school: 'shadow', ab: 'doom', big: true });
        }
        if (b.type === 'covenant' && b.data.base) { f.maxHp = b.data.base; f.hp = Math.min(f.hp, f.maxHp); } // the covenant's extra health goes again
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
      if (!GEO) for (const p of PILLARS) if (Math.hypot(nx - p.x, nz - p.z) < p.r + FIGHTER_R) blocked = true; // leaps clear pillars
      if (solidAt(nx, nz, f.y)) blocked = true;
    } else if (GEO && solidAt(nx, nz, f.y) && f.y < 7) blocked = true; // leaps don't pass through keep walls
    if (!inBounds(nx, nz)) blocked = true;
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
    if (src !== tgt && (hasBuff(tgt, 'divine') || hasBuff(tgt, 'sanctuary'))) { this.event({ e: 'immune', id: tgt.id }); return 0; } // Paladin Divine Shield / battleground spawn protection
    let amt = amount * (0.94 + Math.random() * 0.12) * tuningOf(this.fmt, src.cls, src.spec); // arena tuning: per spec and format
    if (hasBuff(src, 'divine')) amt *= 0.5; // ...but the shielded paladin hits half as hard
    // Paladin: Judged targets take more holy damage from that paladin; a Challenged (taunted) enemy
    // deals less damage to anyone but the paladin who challenged it
    if (o.school === 'holy') { const j = tgt.buffs.find(b => b.type === 'judged' && b.src === src.id); if (j) amt *= 1 + j.value; }
    const tn = src.buffs.find(b => b.type === 'taunt'); if (tn && tn.src !== tgt.id && this.fighters[tn.src]?.alive) amt *= 1 - tn.value;
    const direct = !o.dot && !o.tick;
    const amb = getBuff(src, 'ambush');
    if (amb && direct && !o.auto) { amt *= 1.4; this.removeBuff(src, 'ambush'); o.big = true; }
    // positional bonus: hits from behind deal 10% more damage
    const back = src !== tgt && !o.dot && isBehind(src, tgt);
    if (back) amt *= RULES.backMult;
    const SP = kitOf(src).passive || {}; // e.g. Executioner "Heavy Hands": more and bigger crits
    const crit = direct && !o.noCrit && (o.forceCrit || Math.random() < RULES.critChance + (SP.critBonus || 0) + (SP.critVsRooted && hasBuff(tgt, 'root') ? SP.critVsRooted : 0) + (SP.steadyCrit && (src.stillT || 0) >= 1 ? SP.steadyCrit : 0)); // Frost Shatter, Steady Aim
    if (crit) { amt *= SP.critMult || RULES.critMult; src.stats.crits++; }
    amt *= bloodrage(src);
    // spec passives: execute bonus (Arms), poison bonus (Assassination), school bonus / damage taken (Shadowform)
    if (SP.executeBonus && tgt.hp / tgt.maxHp < SP.executeAt) amt *= 1 + SP.executeBonus;
    if (SP.poisonBonus) amt *= 1 + SP.poisonBonus * this.stacksOf(src, tgt, 'Deadly Poison');
    if (SP.schoolBonus) amt *= 1 + (SP.schoolBonus[o.school] || 0);
    const TP = kitOf(tgt).passive; if (TP && TP.takenMult) amt *= TP.takenMult;
    const wk = src.buffs.find(b => b.type === 'weaken'); if (wk) amt *= 1 - wk.value; // Curse of Weakness
    // Martyr's Curse (Necromancer Curser): every curse on the target = +6% damage taken (max 5);
    // the curser itself takes +3% per curse it keeps on enemies
    const cursed = tgt.buffs.filter(b => b.data && b.data.curse && kitOf(this.fighters[b.src] || src).passive?.martyr).length; if (cursed) amt *= 1 + 0.06 * Math.min(5, cursed);
    const wr = getBuff(src, 'wrath'); if (wr) amt *= 1 + wr.value; // Bestial Wrath / Berserk Instinct
    if (TP && TP.martyr) { let mine = 0; for (const e of this.fighters) if (e.team !== tgt.team) mine += e.buffs.filter(b => b.src === tgt.id && b.data && b.data.curse).length; amt *= 1 + 0.03 * Math.min(5, mine); }
    if (SP.steadyAim && (src.stillT || 0) >= 1 && !o.dot) amt *= 1 + SP.steadyAim; // Sharpshooter: standing still
    const bz = frenzyOf(src); if (bz) amt *= 1 + bz.value;
    // battleground effects: the Fury power-up (+ damage dealt, + damage taken) and a flag carrier's Exposed stacks
    const fu = getBuff(src, 'fury'); if (fu) amt *= 1 + fu.value;
    if (hasBuff(tgt, 'fury')) amt *= 1.1;
    const ex = getBuff(tgt, 'exposed'); if (ex) amt *= 1 + ex.value;
    amt *= 1 - kitOf(tgt).defense;
    for (const b of tgt.buffs) if (b.type === 'dr' || b.type === 'stoneskin') amt *= 1 - b.value;
    amt *= this.shieldwall(tgt);
    if (src.cls === 'warrior' && this.teamSize[src.team] >= 2) amt *= 1 + (SP.dmg || 0); // Shieldwall: team-play damage
    // Berserker Bloodrage, team play only: up to 25% less damage taken as health drops
    if (tgt.cls === 'berserker' && this.teamSize[tgt.team] >= 2) amt *= 1 - 0.25 * (1 - Math.max(0, tgt.hp) / tgt.maxHp);
    amt = Math.max(1, Math.round(amt));
    let absorbed = 0;
    for (const b of tgt.buffs) {
      if (b.type !== 'absorb' || amt <= 0 || o.pierce) continue; // pierce: ignores shields
      if (b.data.magicOnly && (o.school || 'phys') === 'phys') continue; // Rune Ward: spells only
      const a = Math.min(b.value, amt); b.value -= a; amt -= a; absorbed += a;
      if (b.data.rpPer) this.gainRes(tgt, a / b.data.rpPer);
      if (b.value <= 0) b.t = 0;
    }
    tgt.hp -= amt;
    src.stats.dmg += amt;
    if (src.resType === 'runic' && src !== tgt) this.runicDealt(src, tgt, amt, o, SP);
    if (tgt.resType === 'runic' && tgt !== src && amt > 0) this.runicTaken(tgt, amt);
    const ls = getBuff(src, 'lifesteal');
    if (ls && src !== tgt && src.alive) { const h = Math.round((amt + absorbed) * ls.value * (1 - this.damp / 100)); if (h > 0) { src.hp = Math.min(src.maxHp, src.hp + h); src.stats.heal += h; this.event({ e: 'heal', id: src.id, src: src.id, amt: h, ab: 'lifesteal' }); } }
    tgt.stats.absorbed += absorbed;
    if (src.resType === 'rage') src.res = Math.min(src.maxRes, src.res + (amt + absorbed) * 0.09); // rage from dealing damage
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
    this.event({ e: 'dmg', id: tgt.id, src: src.id, amt, abs: absorbed, school: o.school || 'phys', ab: o.ab, big: !!o.big, dot: !!o.dot, crit, back, melee: !!o.melee, pet: !!o.pet });
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
    let amt = amount * (0.95 + Math.random() * 0.1) * (src ? tuningOf(this.fmt, src.cls, src.spec) : 1);
    const crit = Math.random() < RULES.critChance;
    if (crit) amt *= RULES.critMult;
    if (src && hasBuff(src, 'treeform')) amt *= 1.4; // Druid Tree of Life: +40% healing done
    const cv = getBuff(tgt, 'covenant'); if (cv) amt *= 1 + (cv.data.heal || 0); // Dread Knight Blood: Sanguine Covenant
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
    if ((hasBuff(f, 'divine') || hasBuff(f, 'sanctuary')) && o.src !== undefined && this.fighters[o.src] && this.fighters[o.src].team !== f.team) { this.event({ e: 'immune', id: f.id }); return null; } // Divine Shield: immune to harmful effects
    if (type === 'slow' && o.src !== f.id && (frenzyOf(f) || hasBuff(f, 'treeform'))) return null; // berserk, Heart of Winter, Tree of Life: immune to slows
    if (o.cc) {
      if (hasBuff(f, 'tempest') || hasBuff(f, 'ccimmune')) { this.event({ e: 'immune', id: f.id }); return null; }
      if (o.cc === 'root' && frenzyOf(f)) { this.event({ e: 'immune', id: f.id }); return null; }
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
  // heal over time; stacking adds a stack (up to max) and refreshes (Druid Rejuvenation stacks 3x)
  addHot(src, tgt, name, total, dur, ab, max = 1) {
    if (!tgt.alive) return 0;
    const find = () => tgt.buffs.find(x => x.type === 'hot' && x.name === name && x.src === src.id);
    const n = Math.min(max, (find()?.data.stacks || 0) + 1), ticks = Math.round(dur);
    const b = this.addBuff(tgt, 'hot', dur + 0.05, { src: src.id, name, icon: '✿', data: { acc: 0, ticks, per: total * n / ticks, ab, stacks: n } });
    if (b) { b.data = { acc: 0, ticks, per: total * n / ticks, ab, stacks: n }; b.t = dur + 0.05; }
    return n;
  }
  // curse = any of a Necromancer's effects flagged data.curse (counted by Martyr's Curse and Doom)
  curses(src, tgt) { return tgt.buffs.filter(b => b.src === src.id && b.data && b.data.curse).length; }
  curseDot(src, tgt, name, total, dur, icon) { this.addDot(src, tgt, name, total, dur, 'shadow', icon); const b = tgt.buffs.find(x => x.type === 'dot' && x.name === name && x.src === src.id); if (b) b.data.curse = true; }
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

  // o.block: a big, slow projectile (Arcane Comet, Aimed Shot) that shatters on a pillar or the bridge if the
  // target gets behind cover while it flies — the counterplay to a long cast is to break line of sight in time
  spawnProjectile(src, tgt, kind, speed, onHit, yOff = 0, o = {}) {
    const fw = this.forward(src);
    this.projectiles.push({ id: NEXT_ID++, kind, owner: src.id, target: tgt.id, x: src.x + fw.x * 0.8, y: src.y + 1.7 + yOff, z: src.z + fw.z * 0.8, speed, onHit, life: 4, block: !!o.block });
  }

  // an aimed basic-attack bolt: flies straight, hits the first enemy hitbox on its way, breaks on cover / the ground
  stepStraight(p, i, dt) {
    // aim assist: a player's bolt bends towards the target it was fired at (a strafe still beats it at long range)
    const h = p.home;
    if (h && hittable(h)) {
      const tx = h.x - p.x, ty = h.y + (isMinion(h) ? 0.8 : 1.05) - p.y, tz = h.z - p.z, tl = Math.hypot(tx, ty, tz);
      if (tl > 0.3) {
        const k = Math.min(1, ASSIST_TURN * dt);
        let dx = p.dx + (tx / tl - p.dx) * k, dy = p.dy + (ty / tl - p.dy) * k, dz = p.dz + (tz / tl - p.dz) * k;
        const l = Math.hypot(dx, dy, dz) || 1; p.dx = dx / l; p.dy = dy / l; p.dz = dz / l;
      }
    }
    const step = Math.min(p.speed * dt, p.left); p.left -= step;
    const ux = p.dx * step, uy = p.dy * step, uz = p.dz * step;
    let hit = null, hs = 2;
    for (const t of this.units()) {
      if (t.team === p.team || !hittable(t)) continue;
      const r = hitboxDist(p.x, p.y, p.z, ux, uy, uz, t);
      if (r.d <= boxOf(t).r + PROJ_R && r.s < hs) { hs = r.s; hit = t; }
    }
    const ex = p.x + ux * (hit ? hs : 1), ey = p.y + uy * (hit ? hs : 1), ez = p.z + uz * (hit ? hs : 1);
    const end = () => { this.projectiles.splice(i, 1); this.event({ e: 'fizzle', kind: p.kind, x: p.x, y: p.y, z: p.z }); };
    if (segBlocked(p.x, p.z, ex, ez, p.y, ey) || ey < floorAt(ex, ez, ey) + 0.02) { end(); return; }
    if (hit) {
      this.projectiles.splice(i, 1);
      this.event({ e: 'hit', kind: p.kind, id: isMinion(hit) ? -1 : hit.id, src: p.owner, x: ex, y: ey, z: ez });
      if (this.fighters[p.owner]) p.onHit(hit);
      return;
    }
    p.x = ex; p.y = ey; p.z = ez;
    if (p.left <= 0) end();
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.straight) { this.stepStraight(p, i, dt); continue; }
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
        this.event({ e: 'hit', kind: p.kind, id: t.id, src: p.owner, x: tx, y: ty, z: tz });
        p.onHit();
      } else {
        const nx = p.x + dx / d * step, ny = p.y + dy / d * step, nz = p.z + dz / d * step;
        if (p.block && segBlocked(p.x, p.z, nx, nz, p.y, ny)) {
          this.projectiles.splice(i, 1);
          this.event({ e: 'fizzle', kind: p.kind, x: p.x, y: p.y, z: p.z, blocked: true, id: t.id, src: p.owner });
          continue;
        }
        p.x = nx; p.y = ny; p.z = nz;
      }
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
        this.event({ e: 'fx', fx: 'quake_erupt', id: z.owner, x: z.x, z: z.z }); this.aoeMinions(owner, z.x, z.z, z.r, 35);
        for (const f of this.enemiesOf(owner)) if (this.inZone(f, z) && f.y - z.y < 1.5) {
          this.damage(owner, f, 35, { school: 'nature', ab: 'quake_totem' });
          this.interrupt(f, owner);
          this.addBuff(f, 'stun', 1.75, { src: owner.id, cc: 'cc', name: 'Quaked', icon: '⛰' });
        }
      } else if (z.type === 'meteor' && z.t >= z.dur) {
        // Fire Mage signature: the meteor lands where the target stood when it was called
        this.event({ e: 'fx', fx: 'meteor_impact', id: z.owner, x: z.x, y: z.y, z: z.z }); this.aoeMinions(owner, z.x, z.z, z.r, z.data.dmg || 170);
        for (const f of this.enemiesOf(owner)) if (this.inZone(f, z)) {
          this.damage(owner, f, z.data.dmg || 170, { school: 'fire', ab: 'meteor', big: true });
          this.addBuff(f, 'stun', 1, { src: owner.id, cc: 'cc', name: 'Meteor Strike', icon: '☄' });
          if (z.data.burn) this.kindle(owner, f);
        }
      } else if (z.type === 'trap') {
        // Sharpshooter Freezing Trap: arms after 1 sec, freezes the first enemy that steps in, then breaks
        if (z.t > 1) for (const e of this.enemiesOf(owner)) if (this.inZone(e, z)) {
          this.event({ e: 'fx', fx: 'trap_spring', id: z.owner, x: z.x, y: z.y, z: z.z });
          this.interrupt(e, owner); this.addBuff(e, 'disorient', 4, { src: owner.id, cc: 'cc', name: 'Frozen Trap', icon: '❄' });
          z.t = z.dur; break;
        }
      } else if (z.type === 'earthbind') {
        // Enhancement totem: enemies inside are slowed by 50%
        for (const e of this.enemiesOf(owner)) if (this.inZone(e, z)) {
          const s = e.buffs.find(b => b.type === 'slow' && b.name === 'Earthbind');
          if (s) s.t = 0.3; else this.addBuff(e, 'slow', 0.3, { value: 0.5, src: owner.id, name: 'Earthbind', icon: '⛓' });
        }
      } else if (z.type === 'plague') {
        // Assassination signature: every second, enemies inside take damage and gain a Deadly Poison stack
        z.data.acc = (z.data.acc || 0) + dt;
        if (z.data.acc >= 1) { z.data.acc -= 1; this.aoeMinions(owner, z.x, z.z, z.r, 16); for (const e of this.enemiesOf(owner)) if (this.inZone(e, z)) { this.damage(owner, e, 16, { school: 'nature', ab: 'plague_cloud', tick: true }); this.poison(owner, e); } }
      } else if (z.type === 'consecration') {
        // Protection Paladin: holy ground — enemies inside burn and are Challenged, the paladin inside takes 10% less damage
        z.data.acc = (z.data.acc || 0) + dt;
        const tick = z.data.acc >= 1; if (tick) { z.data.acc -= 1; this.aoeMinions(owner, z.x, z.z, z.r, 12); }
        for (const e of this.enemiesOf(owner)) if (this.inZone(e, z)) {
          if (tick) this.damage(owner, e, 12, { school: 'holy', ab: 'consecration', tick: true });
          const tb = e.buffs.find(b => b.type === 'taunt' && b.src === owner.id);
          if (tb) tb.t = Math.max(tb.t, 1); else if (tick) this.taunt(owner, e, 1);
        }
        if (owner.alive && this.inZone(owner, z)) { const b = owner.buffs.find(b => b.type === 'dr' && b.name === 'Consecrated Ground'); if (b) b.t = 0.3; else this.addBuff(owner, 'dr', 0.3, { value: 0.1, src: owner.id, name: 'Consecrated Ground', icon: '❂' }); }
      } else if (z.type === 'stoneskin') {
        z.data.acc = (z.data.acc || 0) + dt;
        const tick = z.data.acc >= 1; if (tick) z.data.acc -= 1;
        for (const a of this.fighters) {
          if (!a.alive || a.team !== owner.team || !this.inZone(a, z)) continue;
          const b = a.buffs.find(b => b.type === 'stoneskin');
          if (b) b.t = 0.3; else this.addBuff(a, 'stoneskin', 0.3, { value: 0.25, src: owner.id, name: 'Stoneskin', icon: '⬢' });
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

  // ------------------------------------------------------------ minions (pets & summons)
  // Max one per player. A minion chases its owner's target (or the nearest visible enemy), attacks in
  // melee and follows the bridge rules. It can't be targeted, but enemy area damage hurts it
  // (aoeMinions), its lifetime can run out, and it dies with its owner.
  // o: { hp, dmg, atkSpeed, speed, life, range, aoeTaken, onHit(sim, m, target) }
  summon(owner, kind, o = {}) {
    this.minions = this.minions.filter(m => { if (m.owner === owner.id) { this.event({ e: 'minionDie', id: m.id, x: m.x, z: m.z, kind: m.kind }); return false; } return true; });
    const fw = this.forward(owner);
    const m = { id: NEXT_ID++, kind, owner: owner.id, team: owner.team, x: owner.x + fw.z * 1.2, y: owner.y, z: owner.z - fw.x * 1.2, yaw: owner.yaw,
      hp: o.hp || 300, maxHp: o.hp || 300, dmg: o.dmg || 20, atkSpeed: o.atkSpeed || 1.5, atkT: 0.4, speed: o.speed || 8, life: o.life ?? Infinity,
      range: o.range || 2.2, aoeTaken: o.aoeTaken ?? 1, onHit: o.onHit || null, moving: false, atkFlash: 0 };
    if (!this.validSpot(m.x, m.z, m.y)) { m.x = owner.x; m.z = owner.z; }
    this.minions.push(m);
    this.event({ e: 'summon', id: m.id, owner: owner.id, kind, x: m.x, z: m.z });
    return m;
  }
  minionOf(owner) { return this.minions.find(m => m.owner === owner.id) || null; }
  // Druid Feral: change form (the ability bar, stats and model follow the form); breaks roots and slows
  shapeshift(f, form) {
    if (f.form === form) return;
    f.form = form; this.cleanse(f, ['root', 'slow']);
    this.event({ e: 'fx', fx: 'shapeshift', id: f.id, x: f.x, z: f.z, form });
  }
  killMinion(m) { m.hp = 0; }
  // An aimed basic attack on a pet / summon (ghoul, abomination, gorilla, spirit wolf …): the attacker's own
  // bonuses and crits count; the minion has no armor or defensives. Rage users gain rage as on champions.
  hitMinion(src, m, amount, o = {}) {
    if (m.hp <= 0 || this.state !== 'fight') return 0;
    let amt = amount * (0.94 + Math.random() * 0.12);
    if (hasBuff(src, 'divine')) amt *= 0.5;
    const SP = kitOf(src).passive || {};
    const crit = Math.random() < RULES.critChance + (SP.critBonus || 0);
    if (crit) amt *= SP.critMult || RULES.critMult;
    amt *= bloodrage(src);
    if (SP.schoolBonus) amt *= 1 + (SP.schoolBonus[o.school] || 0);
    const wr = getBuff(src, 'wrath'); if (wr) amt *= 1 + wr.value;
    const bz = frenzyOf(src); if (bz) amt *= 1 + bz.value;
    amt = Math.max(1, Math.round(amt));
    m.hp -= amt;
    if (src.resType === 'rage') src.res = Math.min(src.maxRes, src.res + amt * 0.09);
    this.event({ e: 'minionHit', id: m.id, src: src.id, amt, crit, melee: !!o.melee, x: m.x, y: m.y, z: m.z });
    return amt;
  }
  // enemy area damage also hits minions inside the area
  aoeMinions(src, x, z, r, amt) {
    for (const m of this.minions) if (m.team !== src.team && m.hp > 0 && Math.hypot(m.x - x, m.z - z) <= r) {
      const d = Math.round(amt * m.aoeTaken * (m.rageT > 0 ? 0 : 1)); m.hp -= d; // Bestial Wrath: ignores area damage
      this.event({ e: 'minionHit', id: m.id, amt: d, x: m.x, y: m.y, z: m.z });
    }
  }
  updateMinions(dt) {
    for (let i = this.minions.length - 1; i >= 0; i--) {
      const m = this.minions[i], owner = this.fighters[m.owner];
      m.life -= dt; m.atkT = Math.max(0, m.atkT - dt); m.atkFlash = Math.max(0, m.atkFlash - dt); m.rageT = Math.max(0, (m.rageT || 0) - dt);
      if (m.hp <= 0 || m.life <= 0 || !owner.alive || this.state !== 'fight') {
        this.minions.splice(i, 1); this.event({ e: 'minionDie', id: m.id, x: m.x, z: m.z, kind: m.kind }); continue;
      }
      // target: the owner's hostile target, else the nearest visible enemy within 30 yards
      let t = this.fighters[owner.target];
      if (!t || t.team === m.team || !this.visibleTo(t, owner)) {
        t = null; let best = 30;
        for (const e of this.enemiesOf(owner)) { if (!this.visibleTo(e, owner)) continue; const d = Math.hypot(e.x - m.x, e.z - m.z); if (d < best) { best = d; t = e; } }
      }
      m.moving = false;
      const ox = m.x, oz = m.z;
      if (t) {
        const dx = t.x - m.x, dz = t.z - m.z, d = Math.hypot(dx, dz), dy = Math.abs(floorAt(t.x, t.z, t.y) - floorAt(m.x, m.z, m.y));
        m.yaw = Math.atan2(dx, dz);
        if (d > m.range * 0.8 || dy > 1.2) {
          const step = Math.min(d, m.speed * speedMult(owner) * dt);
          m.x += dx / (d || 1) * step; m.z += dz / (d || 1) * step; m.moving = true;
        } else if (m.atkT <= 0) {
          m.atkT = m.atkSpeed; m.atkFlash = 0.35;
          this.event({ e: 'minionAtk', id: m.id, tid: t.id });
          this.damage(owner, t, m.dmg * (m.rageT > 0 ? 2 : 1), { school: 'phys', ab: 'pet_' + m.kind, pet: true });
          if (m.onHit) m.onHit(this, m, t);
        }
      } else if (Math.hypot(owner.x - m.x, owner.z - m.z) > 3) { // no enemy: heel at the owner's side
        const dx = owner.x - m.x, dz = owner.z - m.z, d = Math.hypot(dx, dz), step = Math.min(d - 2.5, m.speed * dt);
        m.x += dx / d * step; m.z += dz / d * step; m.yaw = Math.atan2(dx, dz); m.moving = true;
      }
      // walls, pillars and the bridge: same rules as fighters
      if (solidAt(m.x, m.z, m.y)) { if (!solidAt(ox, m.z, m.y)) m.x = ox; else if (!solidAt(m.x, oz, m.y)) m.z = oz; else { m.x = ox; m.z = oz; } }
      if (!GEO) for (const p of PILLARS) { const px = m.x - p.x, pz = m.z - p.z, pd = Math.hypot(px, pz), min = p.r + 0.5; if (pd < min) { m.x += px / pd * (min - pd); m.z += pz / pd * (min - pd); } }
      clampToBounds(m, 0.6);
      const fl = floorAt(m.x, m.z, m.y); if (fl > m.y || m.y - fl < 0.6) m.y = fl; else m.y = Math.max(fl, m.y - 12 * dt);
    }
  }

  // ------------------------------------------------------------ Runic Power (Dread Knight)
  gainRes(f, n) { f.res = Math.min(f.maxRes, f.res + n); }
  // dealing damage gives no Runic Power (unlike rage): basic attacks give their fixed amount, Killing Cold counts them
  runicDealt(src, tgt, amt, o, SP) {
    if (o.auto) {
      this.gainRes(src, kitOf(src).auto.rp || 0);
      if (SP.killingCold && ++src.autoN % SP.killingCold === 0 && !src.kc) { src.kc = true; this.gainRes(src, 40); this.event({ e: 'fx', fx: 'killing_cold', id: src.id }); }
    }
    if (SP.bond && amt > 0 && src.alive) this.heal(src, src, amt * SP.bond, 'blood_bond'); // Blood Bond
    if (amt > 0 && hasBuff(src, 'winter')) this.addBuff(tgt, 'slow', 3, { value: 0.2, src: src.id, name: 'Chilled', icon: '❄' }); // Heart of Winter
  }
  // damage taken: remembered for Reaping Strike; Blood turns it into Runic Power
  runicTaken(f, amt) {
    (f.taken || (f.taken = [])).push([this.fightT, amt]);
    while (f.taken.length && this.fightT - f.taken[0][0] > 6) f.taken.shift();
    const P = kitOf(f).passive; if (P && P.takenRP) this.gainRes(f, amt / (P.takenRP * f.maxHp));
  }
  takenSince(f, secs) { let s = 0; for (const [t, a] of f.taken || []) if (this.fightT - t <= secs && this.fightT >= t) s += a; return s; }

  // ------------------------------------------------------------ movement abilities
  // drag a fighter toward another one, stopping `stop` metres in front of it (Dread Knight Grave Chains).
  // The victim slides along the ground like a dash: walls, pillars and the bridge edge stop it; it can't act meanwhile.
  pull(t, to, stop, dur) {
    const dx = to.x - t.x, dz = to.z - t.z, d = Math.hypot(dx, dz);
    if (d <= stop + 0.1) return;
    this.dashDir(t, dx, dz, d - stop, dur, 'grave_chains');
  }
  validSpot(x, z, y = 0) {
    if (!inBounds(x, z)) return false;
    if (!GEO) for (const p of PILLARS) if (Math.hypot(x - p.x, z - p.z) < p.r + FIGHTER_R) return false;
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
      f.alive = false; f.cast = null; f.dash = null; f.locked = false; f.atkReq = 0; f.atkHold = false; f.swing = null; f.queued = null; f.buffs = [];
      const k = this.fighters[f.killer]; if (k && k.team !== f.team) k.stats.kills++;
      this.event({ e: 'death', id: f.id, killer: f.killer ?? -1 });
      for (const o of this.fighters) if (o.target === f.id) { o.atkReq = 0; if (o.cast && o.cast.tid === f.id) this.cancelCast(o, false); }
    }
    const aliveTeams = [0, 1].map(t => this.fighters.some(f => f.team === t && f.alive));
    if (aliveTeams[0] && aliveTeams[1]) return;
    let winner = -1;
    if (aliveTeams[0] !== aliveTeams[1]) { winner = aliveTeams[0] ? 0 : 1; this.score[winner]++; }
    this.state = 'roundEnd'; this.stateT = RULES.roundEnd;
    this.event({ e: 'roundEnd', winner, score: [...this.score], round: this.round });
  }

  // ------------------------------------------------------------ network snapshot
  // lite: without the match statistics (they change slowly; a big match sends them only now and then)
  snapshot(lite = false) {
    const r = v => Math.round(v * 100) / 100;
    return {
      s: this.state, st: r(this.stateT), r: this.round, sc: this.score, ft: r(this.fightT), dp: r(this.damp), w: this.winner,
      f: this.fighters.map(f => ({
        id: f.id, cls: f.cls, spec: f.spec, form: f.form, team: f.team, name: f.name, bot: f.bot,
        x: r(f.x), y: r(f.y), z: r(f.z), yaw: r(f.yaw), hp: Math.round(f.hp), maxHp: f.maxHp, res: Math.round(f.res), maxRes: f.maxRes, resType: f.resType,
        cds: f.cds.map(r), ch: f.ch, gcd: r(f.gcd), cast: f.cast ? { idx: f.cast.idx, t: r(f.cast.t), dur: f.cast.dur, tid: f.cast.tid } : null,
        buffs: f.buffs.map(b => ({ type: b.type, t: r(b.t), dur: r(b.dur), value: r(b.value), name: b.name, icon: b.icon, src: b.src, fx: b.fx })),
        cp: f.cp, alive: f.alive, forceSeq: f.forceSeq, forceYaw: f.forceYaw, locked: f.locked, target: f.target, friend: f.friend,
        autoOn: f.atkHold || f.atkReq > 0, autoT: r(f.autoT), moving: f.moving, sprinting: f.sprinting, stamina: Math.round(f.stamina),
        stats: lite ? undefined : f.stats,
      })),
      p: this.projectiles.map(p => ({ id: p.id, kind: p.kind, x: r(p.x), y: r(p.y), z: r(p.z), owner: p.owner })),
      m: this.minions.map(m => ({ id: m.id, kind: m.kind, owner: m.owner, team: m.team, x: r(m.x), y: r(m.y), z: r(m.z), yaw: r(m.yaw), hp: Math.round(m.hp), maxHp: m.maxHp, moving: m.moving, atk: m.atkFlash > 0 })),
      z: this.zones.map(z => ({ id: z.id, type: z.type, x: z.x, y: z.y, z: z.z, r: z.r, t: r(z.t), dur: z.dur, owner: z.owner })),
    };
  }
}
