// Druid forms (docs/remodel/04-pets-summons-forms.md §4): Cat Form and Bear Form (Feral), Tree of Life
// (Restoration). A form runs its own state machine instead of reacting to the actions meant for the hidden humanoid:
//   basic attack     the claw strike lands on the sim's hitAt (cat: random without repeat, bear: alternating)
//   abilities        a named action each (Rake, Shred, Ferocious Bite, Wild Pounce, Maul, Thrash, roars, tree casts …)
//   move             run / walk / back / strafe;  stunned / disoriented: a dazed loop;  frozen: the pose holds
//   hit              additive on top of whatever plays;  hit-stop: the form slows with the champion's body
//   swap             a 0.25 s cover burst: the old model goes at +0.05 s, the new one plays its shift-in
//                    (the tree folds down first, tr_shift_out; a dead beast gives way to the druid's corpse)
// Every state looks up its manifest clip id (ca_* / be_* / tr_*, generated on the creature's own rig in Phase 5,
// through resolveClip so the manifest's fallbacks apply). A state whose clip hasn't shipped — today all of them —
// runs the procedural driver: the gait and idle of creatures.js / beasts.js (the tree's own below) plus the motions
// in MOTION, laid on through the driver's pose layer (rig.rot / lift / push, model-space x = pitch, y = yaw, z = roll).
// Material treatment (07 §4): rim light like the champions, stealth opacity (Character.setOpacity forwards it) and
// the hit flash on every material as an additive uFlash term, so materials with a glow of their own keep it.
import * as THREE from 'three';
import { makeBeast } from './beasts.js';
import { makeCreature } from './creatures.js';
import { MANIFEST, MANIFEST_CLIPS, clipMeta, resolveClip } from './attack-anims.js';

const HITSTOP = 0.06;      // Character.update's hit-stop time scale: the form holds on the blow like the body does
const SWAP_HIDE = 0.05;    // s into the cover burst at which the old model goes and the new one appears
const DEAD_SWAP = 1.8;     // s a dead beast lies before the druid's corpse replaces it (04 §3.5 ca_death)
const ABILITY_LEAD = 0.08; // instant abilities deal their damage at the press: the motion strikes this soon after (05 §6)
const FADE_IN = 0.06, FADE_OUT = 0.1, CLIP_BLEND = 0.12;
const RIM = 'vec3(0.34, 0.33, 0.38)'; // the champions' rim colour (heroes.js addRim)
const NO_LIB = () => false;            // form clips come from the manifest only: a humanoid library clip can't play on a beast
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ------------------------------------------------------------------ states → clip ids (04 §3.5–3.7, §4)
// abilities: ability id → clip id, a { cast: [ids], release: id } sequence (the last cast id loops until released),
// 'rush' (the tree's fast walk), or null (Bear Form / Cat Form: the swap is their animation). The manifest's own
// `abilities` table wins ("cat:rake" or "rake" naming a clip of this form). kinds: what an action means when the ability
// id isn't known (play(kind) from older callers; 'attack' without an id is the basic attack).
const POUNCE = f => ({ cast: [f + '_pounce_start', f + '_pounce_air'], release: f + '_pounce_land' });
const FORM = {
  cat: {
    prefix: 'ca_', shiftIn: 'ca_shift_in', idle: 'ca_idle', walk: 'ca_walk', run: 'ca_run', back: 'ca_back', strafeL: 'ca_strafe_l', strafeR: 'ca_strafe_r',
    hit: 'ca_hit', stun: 'ca_stun', death: 'ca_death', attacks: ['ca_atk_1', 'ca_atk_2', 'ca_atk_3'], alternate: false,
    abilities: { rake: 'ca_rake', shred: 'ca_shred', ferocious_bite: 'ca_rend', wild_pounce: POUNCE('ca'), berserk_instinct: 'ca_roar', bear_form: null, cat_form: null },
    kinds: { slash: 'ca_shred', stab: 'ca_shred', finisher: 'ca_rend', bash: 'ca_rake', slam: 'ca_rake', raise: 'ca_roar', release: 'ca_roar', charge: 'pounce', dash: 'pounce' },
    burst: [0x8ad86a, 0xe8a05a, 0xffffff], y: 0.8,
  },
  bear: {
    prefix: 'be_', shiftIn: 'be_shift_in', idle: 'be_idle', walk: 'be_walk', run: 'be_run', back: 'be_back', strafeL: 'be_strafe_l', strafeR: 'be_strafe_r',
    hit: 'be_hit', stun: 'be_stun', death: 'be_death', attacks: ['be_atk_1', 'be_atk_2'], alternate: true,
    abilities: { maul: 'be_maul', thrash: 'be_thrash', frenzied_regen: 'be_roar', berserk_instinct: 'be_roar', wild_pounce: POUNCE('be'), cat_form: null, bear_form: null },
    kinds: { slash: 'be_maul', stab: 'be_maul', finisher: 'be_maul', bash: 'be_maul', slam: 'be_thrash', raise: 'be_roar', release: 'be_roar', charge: 'pounce', dash: 'pounce' },
    burst: [0x8ad86a, 0xc89060, 0xffffff], y: 1.0,
  },
  tree: {
    prefix: 'tr_', shiftIn: 'tr_shift_in', shiftOut: 'tr_shift_out', after: 'tr_bless', idle: 'tr_idle', walk: 'tr_walk', run: 'tr_walk', back: 'tr_walk', strafeL: 'tr_walk', strafeR: 'tr_walk',
    hit: 'tr_hit', stun: 'tr_stun', death: null, attacks: ['tr_rel_dir'], alternate: true, cast: 'regrowth',
    abilities: { regrowth: { cast: ['tr_pre_loop'], release: 'tr_rel_ally' }, rejuvenation: 'tr_rel_ally', moonfire: 'tr_rel_dir', entangling_roots: 'tr_root_grasp', wild_charge: 'rush', tree_of_life: 'tr_bless' },
    kinds: { release: 'tr_rel_dir', raise: 'tr_rel_ally', slam: 'tr_root_grasp', dash: 'rush', charge: 'rush' },
    burst: [0x5aff7a, 0x8ad86a, 0xe8d0e0], y: 1.4,
  },
};
const stateIds = F => [F.shiftIn, F.shiftOut, F.idle, F.walk, F.run, F.back, F.strafeL, F.strafeR, F.hit, F.stun, F.death, ...F.attacks,
  ...Object.values(F.abilities).flatMap(e => (typeof e === 'string' ? [e] : e && e.cast ? [...e.cast, e.release] : []))].filter(Boolean);

// ------------------------------------------------------------------ procedural motions
// kf: smooth curve through flat [x0, v0, x1, v1, …] keys (x ascending), flat outside them. Phase p: 0 → 1 is the
// wind-up up to the strike, 1 → 2 the follow-through and recovery; v: the action's natural time in s.
function kf(x, K) {
  if (x <= K[0]) return K[1];
  for (let i = 2; i < K.length; i += 2) if (x <= K[i]) { const u = (x - K[i - 2]) / (K[i] - K[i - 2]); return K[i - 1] + (K[i + 1] - K[i - 1]) * u * u * (3 - 2 * u); }
  return K[K.length - 1];
}
const K = {
  raise: [0, 0, 0.75, 1, 1.0, 0.75, 1.35, 0.25, 2, 0], across: [0, 0, 0.7, -1, 1.3, 1, 2, 0], rise: [0, 0, 0.75, 1, 1.15, 0.6, 2, 0],
  lunge: [0, 0, 0.6, -0.1, 1.05, 1, 1.4, 0.7, 2, 0], snarl: [0, 0, 0.8, 0.5, 1.1, 1, 1.6, 0.3, 2, 0],
  high: [0, 0, 0.8, 1, 1.0, 0.5, 1.25, 0.1, 2, 0], down: [0, 0, 0.8, 0, 1.05, 1, 1.4, 0.8, 2, 0], rear: [0, 0, 0.8, 1, 1.1, 0.45, 1.5, 0.1, 2, 0],
  rendRear: [0, 0, 0.7, 1, 1.15, 0.7, 1.5, 0.2, 2, 0], rendUp: [0, 0, 0.75, 1, 1.0, 0.4, 1.3, 0.1, 2, 0], rendX: [0, 0, 0.75, -1, 1.25, 1, 1.6, 0.5, 2, 0],
  rendDown: [0, 0, 0.75, 0, 1.1, 1, 1.6, 0.5, 2, 0], rip: [0, 0, 1.2, 0, 1.55, 1, 2, 0],
  env: [0, 0, 0.15, 1, 0.75, 1, 1, 0], crouch: [0, 0, 0.6, 1, 1, 1], land: [0, 1, 0.5, 0.8, 1, 0], dip: [0, 0, 0.12, 1, 0.45, 0.5, 1, 0],
  roar: [0, 0, 0.33, 1, 0.75, 1, 1, 0], hit: [0, 0, 0.25, 1, 1, 0], inAir: [0, 1, 0.25, 0], inLand: [0, 0, 0.25, 1, 0.55, 0.6, 1, 0],
  slamRear: [0, 1, 0.27, 0], slam: [0, 0, 0.27, 1, 0.45, 0, 1, 0], shake: [0, 0, 0.35, 0, 0.5, 1, 1, 0],
  thYaw: [0, 0, 0.12, -0.55, 0.32, 0.95, 0.44, 0.15, 0.62, 0], thArms: [0, 0, 0.12, 0.6, 0.3, 1, 0.4, 0.3, 0.5, 0],
  thRear: [0, 0, 0.3, 0, 0.4, 1, 0.45, 0, 0.9, 0], thDip: [0, 0, 0.44, 0, 0.47, 1, 0.65, 0],
  unfoldS: [0, -0.4, 0.72, 0.08, 1, 0], unfoldF: [0, 1, 0.6, 0], unfoldW: [0, 0, 0.45, 0, 0.7, 1, 1, 0],
  push: [0, 0.65, 0.15, 1, 0.35, 0.85, 0.6, 0], pushLean: [0, 0, 0.15, 1, 0.6, 0],
  flickX: [0, 0, 0.06, -0.4, 0.12, 1.4, 0.3, 1.1, 0.55, 0], flickE: [0, 0, 0.06, 1, 0.3, 1, 0.55, 0],
  graspX: [0, 0, 0.18, -0.5, 0.28, 2.3, 0.5, 2.2, 0.75, 0], graspB: [0, 0, 0.18, -0.08, 0.28, 0.35, 0.5, 0.3, 0.75, 0],
  graspD: [0, 0, 0.26, 0, 0.3, 1, 0.5, 0.4, 0.75, 0], graspE: [0, 0, 0.12, 1, 0.55, 1, 0.75, 0],
  blessHi: [0, 0, 0.3, 1, 0.45, 0.6, 0.6, 0], blessWide: [0, 0, 0.32, 0, 0.5, 1, 0.8, 0],
};
// gains per beast: paw reach / sweep, body rise on a swipe, lunge (m), rear-up (rad) and its lift (m)
const CAT = { reach: 1.7, sweep: 0.5, rise: 0.22, lunge: 0.3, rear: 0.55, lift: 0.1, bear: false };
const BEAR = { reach: 1.35, sweep: 0.55, rise: 0.38, lunge: 0.18, rear: 0.75, lift: 0.14, bear: true };
// a sub-strike's phase from natural time v: its strike at S, pre / post s around it
const sub = (v, S, pre, post) => (v < S ? 1 - (S - v) / pre : 1 + (v - S) / post);

// one forepaw swipe (s: +1 right paw sweeping right → left, -1 the left paw), k: strength
function swipeAt(Q, p, s, g, k) {
  if (!(p > 0 && p < 2)) return;
  const r = Q.r, F = Q.leg(s > 0 ? 'FR' : 'FL'), O = Q.leg(s > 0 ? 'FL' : 'FR');
  const raise = kf(p, K.raise) * k, across = kf(p, K.across) * k, rise = kf(p, K.rise) * k, sn = kf(p, K.snarl) * k;
  Q.rot(F.up, -g.reach * raise, 0, g.sweep * across * s); Q.rot(F.lo, 0.9 * raise); Q.rot(F.pw, -0.8 * raise);
  Q.rot(O.lo, 0.25 * rise);
  Q.rear(g.rise * rise); Q.rot(r.chest, -0.1 * rise, 0.22 * across * s);
  Q.rot(r.neck, 0.2 * sn, -0.12 * across * s); Q.rot(r.jaw, 0.6 * sn);
  Q.push(g.lunge * kf(p, K.lunge) * k);
}
const swipe = (Q, a) => swipeAt(Q, a.p, a.m, a.g, 1);
// ca_atk_3: right then left, the second 0.14 s after the first
function doubleSwipe(Q, a) { swipeAt(Q, sub(a.v, a.S, a.S, 0.22), a.m, a.g, 0.9); swipeAt(Q, sub(a.v, a.S + 0.14, 0.14, 0.26), -a.m, a.g, 0.9); }
// both forepaws reach high and rake down through the target (Rake; the bear's Maul rears higher)
function rake(Q, a) {
  const p = a.p, g = a.g, r = Q.r, hi = kf(p, K.high), dn = kf(p, K.down), re = kf(p, K.rear), sn = kf(p, K.snarl);
  for (let i = 0; i < 2; i++) {
    const L = Q.leg(i ? 'FL' : 'FR'), s = i ? 1 : -1;
    Q.rot(L.up, -(g.reach + 0.4) * hi - 0.7 * dn, 0, 0.22 * hi * s); Q.rot(L.lo, 0.5 * hi + 0.4 * dn); Q.rot(L.pw, -0.5 * hi - 0.9 * dn);
  }
  Q.rear(g.rear * re); Q.lift(g.lift * re);
  Q.rot(r.neck, -0.25 * hi + 0.35 * dn); Q.rot(r.jaw, 0.7 * sn);
  Q.push(g.lunge * kf(p, K.lunge));
}
// rapid alternating slashes: right on the strike, left 0.16 s later (hit2), a lighter right after
function shred(Q, a) {
  const v = a.v, g = a.g, r = Q.r, e = kf(v / a.L, K.env);
  swipeAt(Q, sub(v, a.S, a.S, 0.2), 1, g, 0.8); swipeAt(Q, sub(v, a.S + 0.16, 0.14, 0.2), -1, g, 0.8); swipeAt(Q, sub(v, a.S + 0.3, 0.13, 0.19), 1, g, 0.5);
  Q.rear(-0.08 * e); Q.lift(-0.04 * e); Q.push(0.15 * e); Q.rot(r.chest, 0, Math.sin(v * 40) * 0.05 * e);
}
// Ferocious Bite: rears onto the hind legs, both claws tear down across in an X, then rips back
function rend(Q, a) {
  const p = a.p, g = a.g, r = Q.r, re = kf(p, K.rendRear), up = kf(p, K.rendUp), x = kf(p, K.rendX), xd = kf(p, K.rendDown), sn = kf(p, K.snarl);
  Q.rear((g.rear + 0.25) * re); Q.lift((g.lift + 0.08) * re);
  for (let i = 0; i < 2; i++) {
    const L = Q.leg(i ? 'FL' : 'FR'), s = i ? -1 : 1;
    Q.rot(L.up, -2.0 * up - 0.8 * xd, 0, 0.45 * x * s); Q.rot(L.lo, 0.5 * up + 0.3 * xd); Q.rot(L.pw, -0.6 * up - 0.9 * xd);
  }
  Q.rot(r.neck, -0.35 * up + 0.4 * xd); Q.rot(r.jaw, 0.9 * sn);
  Q.push(0.22 * kf(p, K.lunge) - 0.28 * kf(p, K.rip));
}
// Wild Pounce: crouch, stretched flight with the claws out, landing pinned on the target
function pounceStart(Q, a) {
  const c = kf(a.v / a.L, K.crouch), r = Q.r;
  Q.lift(-0.1 * c); Q.rear(-0.12 * c); Q.rot(r.neck, 0.2 * c);
  for (let i = 0; i < 4; i++) { const L = Q.leg(LEG_KEYS[i]); if (i < 2) { Q.rot(L.lo, 0.6 * c); Q.rot(L.pw, -0.3 * c); } else { Q.rot(L.up, 0.35 * c); Q.rot(L.lo, -0.6 * c); Q.rot(L.pw, 0.4 * c); } }
}
function pounceAir(Q) {
  const r = Q.r;
  for (let i = 0; i < 4; i++) { const L = Q.leg(LEG_KEYS[i]); if (i < 2) { Q.rot(L.up, -1.4); Q.rot(L.lo, 0.2); Q.rot(L.pw, -0.7); } else { Q.rot(L.up, 1.0); Q.rot(L.lo, -0.25); Q.rot(L.pw, 0.3); } }
  Q.rot(r.mid, -0.08); Q.rot(r.neck, 0.08); Q.rot(r.jaw, 0.6);
}
function pounceLand(Q, a) {
  const u = a.v / a.L, k = kf(u, K.land), d = kf(u, K.dip), r = Q.r, claw = Math.sin(a.v * 30) * 0.25;
  for (let i = 0; i < 4; i++) { const L = Q.leg(LEG_KEYS[i]); if (i < 2) { Q.rot(L.up, -0.9 * k); Q.rot(L.lo, 0.35 * k); Q.rot(L.pw, (-0.9 + claw) * k); } else { Q.rot(L.up, 0.25 * d); Q.rot(L.lo, -0.45 * d); } }
  Q.lift(-0.12 * d); Q.push(0.15 * k); Q.rear(-0.12 * d); Q.rot(r.neck, 0.3 * k); Q.rot(r.jaw, 0.8 * k);
}
// Berserk Instinct / Frenzied Regeneration: rears the head (the bear the whole body) and roars, claws spread
function roar(Q, a) {
  const u = a.v / a.L, k = kf(u, K.roar), g = a.g, r = Q.r, b = g.bear;
  Q.rear((b ? 0.9 : 0.35) * k); Q.lift((b ? 0.2 : 0.06) * k);
  Q.rot(r.neck, -0.55 * k); Q.rot(r.head, -0.25 * k); Q.rot(r.jaw, 1.0 * k); Q.rot(r.chest, -0.12 * k, Math.sin(a.v * 38) * 0.04 * k);
  for (let i = 0; i < 2; i++) { const L = Q.leg(i ? 'FL' : 'FR'), s = i ? 1 : -1; Q.rot(L.up, -(b ? 0.9 : 0.3) * k, 0, (b ? 0.5 : 0.1) * k * s); Q.rot(L.pw, -0.5 * k); }
  if (r.tail && r.tail.length) Q.rot(r.tail[0], -0.4 * k);
}
// hit: flinch away, snarl (a.m: the side the head turns to, a.k: strength) — additive on top of everything
function flinch(Q, a) {
  const h = kf(a.v / a.L, K.hit) * a.k, r = Q.r;
  Q.push(-0.08 * h); Q.rot(r.neck, -0.3 * h, 0.2 * h * a.m); Q.rot(r.chest, -0.1 * h, 0.08 * h * a.m); Q.rot(r.jaw, 0.5 * h);
  Q.rot(Q.leg('FR').lo, 0.2 * h); Q.rot(Q.leg('FL').lo, 0.2 * h); Q.tilt(0.03 * h * a.m);
}
// stunned / disoriented: dazed, swaying, head low
function daze(Q, a) {
  const t = a.v, r = Q.r;
  Q.rot(r.neck, 0.5, Math.sin(t * 1.7) * 0.4, Math.sin(t * 1.3) * 0.12); Q.rot(r.chest, 0.05, Math.sin(t * 1.7 + 0.8) * 0.12); Q.rot(r.jaw, 0.25);
  Q.lift(-0.05); Q.tilt(Math.sin(t * 1.2) * 0.06);
  Q.rot(Q.leg('FR').up, 0, 0, -0.08); Q.rot(Q.leg('FL').up, 0, 0, 0.08); Q.rot(Q.leg('FR').lo, 0.15); Q.rot(Q.leg('FL').lo, 0.15);
  if (r.tail) for (let i = 0; i < r.tail.length; i++) Q.rot(r.tail[i], 0.12);
}
// cat shift-in: lands heavily on all fours out of a leap, snarling
function landIn(Q, a) {
  const u = a.v / a.L, air = kf(u, K.inAir), ld = kf(u, K.inLand), r = Q.r;
  Q.lift(0.45 * air - 0.09 * ld);
  for (let i = 0; i < 4; i++) { const L = Q.leg(LEG_KEYS[i]), f = i < 2; Q.rot(L.up, (f ? -0.8 : 0.6) * air); Q.rot(L.lo, (f ? 0.4 : -0.4) * ld); }
  Q.rot(r.neck, 0.2 * ld); Q.rot(r.jaw, 0.8 * ld); Q.squash(0.08 * ld);
}
// bear shift-in: slams down onto all fours, shakes itself
function slamIn(Q, a) {
  const u = a.v / a.L, re = kf(u, K.slamRear), sl = kf(u, K.slam), sh = kf(u, K.shake), r = Q.r;
  Q.rear(0.6 * re); Q.lift(0.15 * re - 0.06 * sl); Q.squash(0.07 * sl);
  Q.rot(Q.leg('FR').up, -0.8 * re); Q.rot(Q.leg('FL').up, -0.8 * re);
  Q.tilt(Math.sin(a.v * 30) * 0.06 * sh); Q.rot(r.neck, 0.1 * sl, Math.sin(a.v * 26) * 0.35 * sh); Q.rot(r.jaw, 0.6 * sl);
}
// Thrash: spins half around raking with both front claws, then rears and stomps (strike 0.22, hit2 0.45)
function thrash(Q, a) {
  const v = a.v, r = Q.r, yaw = kf(v, K.thYaw), arms = kf(v, K.thArms), re = kf(v, K.thRear), dip = kf(v, K.thDip);
  Q.turn(yaw);
  for (let i = 0; i < 2; i++) { const L = Q.leg(i ? 'FL' : 'FR'), s = i ? 1 : -1; Q.rot(L.up, -0.8 * arms - 0.9 * re, 0, 0.6 * arms * s); Q.rot(L.lo, 0.4 * arms); Q.rot(L.pw, -0.8 * arms); }
  Q.rear(0.55 * re); Q.lift(0.1 * re - 0.07 * dip); Q.squash(0.05 * dip);
  Q.rot(r.chest, 0, -0.3 * yaw); Q.rot(r.neck, 0.15 * arms); Q.rot(r.jaw, 0.6 * arms);
}
const LEG_KEYS = ['FR', 'FL', 'BR', 'BL'];
// tree: arm(side, forward pitch, raise toward the head)
const arm = (Q, side, x, raise) => { const A = Q.r.arms[side]; Q.rot(A.pivot, x, 0, raise * A.s); };
function unfold(Q, a) { // tr_shift_in: unfolds upward from a crouch (scale 0.6 → 1, overshoot), arms stretching wide
  const u = a.v / a.L, f = kf(u, K.unfoldF), w = kf(u, K.unfoldW);
  Q.grow(kf(u, K.unfoldS)); Q.rot(Q.r.body, 0.35 * f);
  arm(Q, 'L', 0.6 * f - 0.15 * w, -0.6 * f - 0.35 * w); arm(Q, 'R', 0.6 * f - 0.15 * w, -0.6 * f - 0.35 * w);
}
function fold(Q, a) { // tr_shift_out: folds down into a crouch, arms closing (held until the swap)
  const u = clamp(a.v / a.L, 0, 1), f = u * u * (3 - 2 * u);
  Q.grow(-0.3 * f); Q.rot(Q.r.body, 0.3 * f); arm(Q, 'L', 0.7 * f, -0.6 * f); arm(Q, 'R', 0.7 * f, -0.6 * f);
}
function gather(Q, a) { // tr_pre_loop: both hands before the face, light gathering between them
  const tr = Math.sin(a.v * 24) * 0.03;
  arm(Q, 'L', 1.0 + tr, 0.55); arm(Q, 'R', 1.0 - tr, 0.55); Q.rot(Q.r.body, -0.05);
}
function pushBoth(Q, a) { // tr_rel_ally: pushes both open hands toward the ally (release 0.15)
  const k = kf(a.v, K.push);
  arm(Q, 'L', 1.5 * k, 0.55 * k); arm(Q, 'R', 1.5 * k, 0.55 * k); Q.rot(Q.r.body, 0.12 * kf(a.v, K.pushLean));
}
function flick(Q, a) { // tr_rel_dir: flicks one hand at the enemy (release 0.12; a.m: +1 right hand)
  const e = kf(a.v, K.flickE);
  arm(Q, a.m > 0 ? 'R' : 'L', kf(a.v, K.flickX), 0.5 * e); Q.rot(Q.r.body, 0.05 * e, 0.12 * e * a.m);
}
function grasp(Q, a) { // tr_root_grasp: slams one hand flat onto the ground (strike 0.28)
  const d = kf(a.v, K.graspD);
  arm(Q, a.m > 0 ? 'R' : 'L', kf(a.v, K.graspX), 0.55 * kf(a.v, K.graspE)); Q.rot(Q.r.body, kf(a.v, K.graspB), 0.1 * a.m * kf(a.v, K.graspE));
  Q.lift(-0.06 * d); Q.squash(0.04 * d);
}
function bless(Q, a) { // tr_bless: both hands high over the canopy, then the arms open wide (release 0.3)
  const hi = kf(a.v, K.blessHi), wide = kf(a.v, K.blessWide);
  arm(Q, 'L', 0.15 * hi - 0.15 * wide, 0.75 * hi - 0.5 * wide); arm(Q, 'R', 0.15 * hi - 0.15 * wide, 0.75 * hi - 0.5 * wide);
  Q.rot(Q.r.body, -0.1 * hi); Q.grow(0.04 * hi);
}
function creak(Q, a) { // tr_hit: creaks back, a hand raised to shield the face
  const h = kf(a.v / a.L, K.hit) * a.k;
  Q.rot(Q.r.body, -0.15 * h, 0, 0.04 * h * a.m); arm(Q, a.m > 0 ? 'R' : 'L', 0.9 * h, 0.4 * h);
}
function droop(Q, a) { // tr_stun: swaying, hands hanging limp
  const t = a.v;
  Q.rot(Q.r.body, 0.08, 0, Math.sin(t * 1.4) * 0.07); arm(Q, 'L', Math.sin(t * 1.4) * 0.15, -0.55); arm(Q, 'R', Math.sin(t * 1.4 + 1) * 0.15, -0.55);
}
// clip id → procedural stand-in: S = strike / release (s), L = length (s), as the clip tables in 04 §3.5–3.7
const MOTION = {
  ca_atk_1: { S: 0.16, L: 0.55, m: 1, g: CAT, fn: swipe }, ca_atk_2: { S: 0.16, L: 0.55, m: -1, g: CAT, fn: swipe },
  ca_atk_3: { S: 0.18, L: 0.6, m: 1, g: CAT, fn: doubleSwipe }, ca_rake: { S: 0.18, L: 0.6, g: CAT, fn: rake },
  ca_shred: { S: 0.16, L: 0.65, g: CAT, fn: shred }, ca_rend: { S: 0.26, L: 0.75, g: CAT, fn: rend },
  ca_pounce_start: { S: 0.04, L: 0.12, g: CAT, fn: pounceStart }, ca_pounce_air: { S: 0, L: 0.4, loop: true, g: CAT, fn: pounceAir },
  ca_pounce_land: { S: 0.05, L: 0.45, g: CAT, fn: pounceLand }, ca_roar: { S: 0.3, L: 0.9, g: CAT, fn: roar, noLead: true },
  ca_hit: { S: 0.08, L: 0.3, g: CAT, fn: flinch }, ca_stun: { S: 0, L: 1.2, loop: true, g: CAT, fn: daze },
  ca_shift_in: { S: 0.1, L: 0.4, g: CAT, fn: landIn },
  be_atk_1: { S: 0.18, L: 0.7, m: 1, g: BEAR, fn: swipe }, be_atk_2: { S: 0.18, L: 0.7, m: -1, g: BEAR, fn: swipe },
  be_maul: { S: 0.24, L: 0.9, g: BEAR, fn: rake }, be_thrash: { S: 0.22, L: 0.9, g: BEAR, fn: thrash },
  be_roar: { S: 0.3, L: 1.0, g: BEAR, fn: roar, noLead: true },
  be_pounce_start: { S: 0.05, L: 0.15, g: BEAR, fn: pounceStart }, be_pounce_air: { S: 0, L: 0.4, loop: true, g: BEAR, fn: pounceAir },
  be_pounce_land: { S: 0.05, L: 0.45, g: BEAR, fn: pounceLand },
  be_hit: { S: 0.08, L: 0.35, g: BEAR, fn: flinch }, be_stun: { S: 0, L: 1.5, loop: true, g: BEAR, fn: daze },
  be_shift_in: { S: 0.12, L: 0.45, g: BEAR, fn: slamIn },
  tr_shift_in: { S: 0.45, L: 0.6, fn: unfold, guard: true }, tr_shift_out: { S: 0.4, L: 0.4, hold: true, fn: fold },
  tr_pre_loop: { S: 0, L: 1.2, loop: true, fn: gather }, tr_rel_ally: { S: 0.15, L: 0.6, fn: pushBoth },
  tr_rel_dir: { S: 0.12, L: 0.55, m: 1, fn: flick }, tr_root_grasp: { S: 0.28, L: 0.75, m: 1, fn: grasp },
  tr_bless: { S: 0.3, L: 0.8, fn: bless, noLead: true, guard: true }, tr_hit: { S: 0.1, L: 0.4, fn: creak }, tr_stun: { S: 0, L: 1.5, loop: true, fn: droop },
};

// ------------------------------------------------------------------ pose writer (what the motions draw with)
const NO_LEG = { up: null, lo: null, pw: null };
class Pose {
  constructor() { this.r = null; this.w = 1; this.hind = null; this.yaw = 0; this.roll = 0; this.g = 0; this.sq = 0; }
  begin(rig, hind) { this.r = rig; this.hind = hind; this.w = 1; this.yaw = this.roll = this.g = this.sq = 0; }
  rot(b, x = 0, y = 0, z = 0) { const w = this.w; if (b) this.r.rot(b, x * w, y * w, z * w); }
  leg(k) { return (this.r.legs && this.r.legs[k]) || NO_LEG; }
  lift(y) { this.r.lift(y * this.w); }
  push(z) { this.r.push(z * this.w); }
  // the front of the body rises (a: rad); hind legs hanging from the pelvis turn back so the hind feet stay down
  rear(a) { this.rot(this.r.pelvis, -a); for (let i = 0; i < this.hind.length; i++) this.rot(this.hind[i], a); }
  turn(a) { this.yaw += a * this.w; }      // whole body: yaw, roll, uniform scale, squash (y down, x / z out)
  tilt(a) { this.roll += a * this.w; }
  grow(k) { this.g += k * this.w; }
  squash(k) { this.sq += k * this.w; }
}

// ------------------------------------------------------------------ material treatment (07 §4)
const FLASH = new WeakMap(); // material → its form's flash uniform
// one program for every form material: the flash is an extra emissive term (eyes and glowing leaves keep their own)
function flashPatch(sh) {
  const u = FLASH.get(this); if (!u) return;
  sh.uniforms.uFlash = u;
  sh.fragmentShader = 'uniform vec3 uFlash;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += uFlash;');
}
function prepMaterials(root, U) {
  const list = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || list.some(r => r.m === m)) continue;
      list.push({ m, op: m.opacity, tr: m.transparent, dw: m.depthWrite });
      if (!m.transparent && !m.isMeshBasicMaterial && !(m.defines && m.defines.USE_RIM !== undefined)) m.defines = { ...(m.defines || {}), USE_RIM: '', RIM_COLOR: RIM };
      if (m.emissive) {
        FLASH.set(m, U);
        const prev = m.onBeforeCompile;
        if (prev === THREE.Material.prototype.onBeforeCompile) m.onBeforeCompile = flashPatch;
        else if (prev !== flashPatch && !m.userData.formFx) { m.userData.formFx = true; m.onBeforeCompile = function (sh, r) { prev.call(this, sh, r); flashPatch.call(this, sh, r); }; m.customProgramCacheKey = () => prev.toString() + '|formFlash'; }
      }
      m.needsUpdate = true;
    }
  });
  return list;
}
function applyOpacity(list, a) {
  for (let i = 0; i < list.length; i++) {
    const r = list[i], m = r.m, tr = a < 0.999 || r.tr;
    if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } // the OPAQUE define goes with it (three r170)
    m.opacity = r.op * a; m.depthWrite = a > 0.99 ? r.dw : false;
  }
}

// ------------------------------------------------------------------ Tree of Life (code-built treant until Phase 5's model)
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...o });
function makeTree() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body); // body: everything above the root feet (sways, bends)
  const bark = std(0x5a3a22, { roughness: 1, flatShading: true }), leaf = std(0x3a8a2a, { roughness: 0.9, emissive: 0x1a5a10, emissiveIntensity: 0.4, flatShading: true });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 1.9, 9), bark); trunk.position.y = 0.95; trunk.castShadow = true; body.add(trunk);
  const arms = {};
  for (const s of [-1, 1]) {
    // branch arm on a shoulder pivot (where it leaves the trunk): at rest exactly where the old static arm was
    const pivot = new THREE.Group(); pivot.position.set(s * 0.216, 1.314, 0); pivot.rotation.z = -s * 0.9; body.add(pivot);
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 1.0, 6), bark); a.position.y = 0.3; a.castShadow = true; pivot.add(a);
    arms[s > 0 ? 'L' : 'R'] = { pivot, s, z0: -s * 0.9 };
    const foot = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.6, 5), bark); foot.position.set(s * 0.3, 0.12, 0.1); foot.rotation.z = s * 1.1; root.add(foot);
  }
  for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45 + (i % 3) * 0.08, 0), leaf); c.position.set(Math.sin(a) * 0.45, 2.2 + Math.cos(a * 2) * 0.15, Math.cos(a) * 0.45); c.castShadow = true; body.add(c); }
  const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), leaf); top.position.y = 2.6; body.add(top);
  const face = new THREE.Group(); face.position.set(0, 1.45, 0.28);
  const eyeM = new THREE.MeshBasicMaterial({ color: 0xbaff6a });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), eyeM); e.position.x = s * 0.1; face.add(e); }
  body.add(face);
  const rig = { kind: 'tree', body, arms, face, legs: null, pelvis: null, tail: null,
    rot(o, x = 0, y = 0, z = 0) { if (o) { o.rotation.x += x; o.rotation.y += y; o.rotation.z += z; } },
    lift(y) { body.position.y += y; }, push(z) { body.position.z += z; } };
  const AL = arms.L.pivot, AR = arms.R.pivot;
  let t = 0, T = 0;
  function update(dt, moving, _atk, st0 = {}) {
    body.rotation.set(0, 0, 0); body.position.set(0, 0, 0);
    AL.rotation.set(0, 0, arms.L.z0); AR.rotation.set(0, 0, arms.R.z0);
    const rush = st0.rush ? 2.2 : 1;
    t += dt * (moving ? 6 * rush : 1.5); T += dt;
    body.rotation.z = Math.sin(t) * (moving ? 0.05 : 0.015); // the sway it always had
    if (moving) { const sw = Math.sin(t) * 0.3; AL.rotation.x += sw; AR.rotation.x -= sw; body.position.y = Math.abs(Math.cos(t)) * 0.04; }
    else { AL.rotation.x += Math.sin(T * 0.8) * 0.04; AR.rotation.x += Math.sin(T * 0.8 + 1.3) * 0.04; }
    if (st0.rush) body.rotation.x += 0.18; // Wild Charge: leaning into the rush
    if (st0.layer) st0.layer(rig);
  }
  return { root, update, rig, dispose() { root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); } };
}

// Druid shapeshift models: 'cat' / 'bear' (the generated model once loaded — creatures.js — else the code-built beast
// of beasts.js) and 'tree' (the Tree of Life treant). { root, update(dt, moving, attacking, st), rig, body, dispose }
export function makeFormModel(form) {
  const root = new THREE.Group();
  let m = null, gen = false;
  if (form === 'tree') m = makeTree();
  else { m = makeCreature(form === 'bear' ? 'bear' : 'cat'); gen = !!m; if (!m) m = makeBeast(form === 'bear' ? 'bear' : 'cat'); }
  root.add(m.root);
  return { root, kind: form, rig: m.rig, body: m.body || null, update: m.update, generated: gen,
    dispose() { m.dispose?.(); if (!gen && form !== 'tree') root.traverse(o => { if (o.isMesh) o.material.dispose(); }); } }; // the beast's materials are its own
}

// ------------------------------------------------------------------ clip layer (Phase 5: clips made on the form's rig)
// A clip is sampled at the state machine's own clock and laid over the procedural pose by weight, so a state with a
// clip and one without hand over smoothly. Only tracks whose bone this model has are kept.
const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
class ClipLayer {
  constructor(body) { this.body = body; this.cache = new Map(); this.cur = null; this.prev = null; this.t = 0; this.pt = 0; this.w = 0; this.f = 1; }
  // the playable clip for a state id (through the manifest's fallbacks), or null
  get(id) {
    if (!id) return null;
    let c = this.cache.get(id);
    if (c !== undefined) return c;
    c = null;
    const rid = resolveClip(id, NO_LIB), src = rid && MANIFEST_CLIPS[rid];
    if (src) {
      const ch = [];
      for (const tr of src.tracks) {
        const pn = THREE.PropertyBinding.parseTrackName(tr.name), node = this.body.getObjectByName(pn.nodeName);
        const kind = pn.propertyName === 'quaternion' ? 0 : pn.propertyName === 'position' ? 1 : pn.propertyName === 'scale' ? 2 : -1;
        if (node && kind >= 0) ch.push({ node, kind, it: tr.createInterpolant() });
      }
      if (ch.length && ch.length >= src.tracks.length * 0.6) c = { id: rid, dur: src.duration, ch, meta: clipMeta(rid) || src.userData || {} };
      else console.warn('form clip', rid, "doesn't fit this model's rig: its procedural motion plays instead");
    }
    this.cache.set(id, c);
    return c;
  }
  // rec: the clip the state machine plays now (null: procedural), at time t
  update(dt, rec, t, loop) {
    if (rec && rec !== this.cur) { this.prev = this.cur; this.pt = this.t; this.f = this.prev ? 0 : 1; this.cur = rec; }
    if (rec) this.t = loop ? t % rec.dur : Math.min(t, rec.dur);
    this.w = clamp(this.w + (rec ? dt : -dt) / CLIP_BLEND, 0, 1);
    this.f = Math.min(1, this.f + dt / CLIP_BLEND);
    if (this.w <= 0 || !this.cur) { this.cur = this.prev = null; return; }
    if (this.prev && this.f < 1) sample(this.prev, this.pt, this.w); else this.prev = null;
    sample(this.cur, this.t, this.prev ? this.f : this.w);
  }
}
function sample(rec, t, w) {
  for (let i = 0; i < rec.ch.length; i++) {
    const c = rec.ch[i], r = c.it.evaluate(t);
    if (c.kind === 0) c.node.quaternion.slerp(_q.fromArray(r), w);
    else if (c.kind === 1) c.node.position.lerp(_v.fromArray(r), w);
    else c.node.scale.lerp(_v.fromArray(r), w);
  }
}

// ------------------------------------------------------------------ the state machine
const newAct = () => ({ id: null, mo: null, clip: null, g: null, v: 0, t: 0, S: 0, L: 1, rs: 1, p: 0, w: 0, m: 1, k: 1, loop: false, hold: false, next: null, release: null, land: false });
// The form controller of one champion (heroes.js Character: this.form). Character.update calls update(dt, st, form)
// first thing; play / hit / flash / setOpacity forward the champion's events.
export class FormController {
  constructor(ch) {
    this.ch = ch;
    this.key = null;   // the form on screen (null: the humanoid)
    this.want = null;  // the form it is changing to
    this.model = null; this.next = null; this.swapT = -1; this.outT = -1;
    this.Q = new Pose(); this.clips = null;
    this.acts = [newAct(), newAct()]; this.act = null; this.prev = null;
    this.hitA = { v: 9, L: 0.3, m: 1, k: 1, g: null, fn: null };
    this.stunA = { v: 0, L: 1, m: 1, k: 1, g: null, fn: null };
    this.stunW = 0; this.backW = 0; this.strafeW = 0; this.calm = 0;
    this.atkN = 0; this.lastAtk = null; this.castMem = 0; this.deadT = 0; this.rushT = 0; this.airSeen = false; this.pounceT = 0; this.locoT = 0;
    this.flashK = 0; this.flashU = { value: new THREE.Color(0, 0, 0) };
    this.st = null; this.stunned = false; this.frozen = false;
    this.cst = { speed: 0, dead: false, air: false, dir: 1, calm: 0, rush: false, layer: null };
    this.cst.layer = rig => this.layer(rig);
  }

  // ---- per frame
  update(dt, st, fk) {
    this.st = st;
    // a dead beast lies a moment, then the druid's corpse takes its place; the tree ends at death (the sim drops it)
    this.deadT = st.dead ? this.deadT + dt : 0;
    const want = st.dead && (fk === 'tree' || this.deadT > DEAD_SWAP) ? null : fk;
    if (want !== this.want) this.request(want, st);
    if (this.outT >= 0 && (this.outT += dt) >= MOTION.tr_shift_out.L) this.cover(st);
    if (this.swapT >= 0 && (this.swapT += dt) >= SWAP_HIDE) this.show();
    // hit flash: the champion's curve (Character.update), on this form's own uniform
    if (this.flashK > 0) { this.flashK = Math.max(0, this.flashK - dt * 5.5); const k = this.flashK * this.flashK * 0.42; this.flashU.value.setRGB(k, k * 0.82, k * 0.62); }
    // animation time: hit-stop slows the form with the body, frozen (Freezing Trap) holds the pose
    this.frozen = !st.dead && (st.frozen || frozenBy(st.buffs));
    if (this.model) this.drive(this.frozen ? 0 : this.ch.stopT > 0 ? dt * HITSTOP : dt, dt, st);
  }

  // ---- swap: request → (tree folds down) → cover burst → +0.05 s: old model out, new in with its shift-in
  request(want, st) {
    this.want = want;
    if (this.swapT < 0 && want === this.key) { if (this.outT >= 0) { this.outT = -1; this.endAct(); } return; } // changed its mind mid-fold
    if (this.key === 'tree' && this.model && this.swapT < 0 && !st.dead) { // the tree folds down first
      if (this.outT < 0) { this.outT = 0; this.startAct('tr_shift_out'); }
      return;
    }
    this.cover(st);
  }
  cover(st) {
    this.outT = -1; this.swapT = 0;
    const F = FORM[this.want] || FORM[this.key], vfx = st.vfx, p = this.ch.root.position;
    if (vfx && F && this.ch.opacity > 0.05) { // the burst that hides the change (stealth: nothing to see)
      vfx.burst(p.x, p.y + F.y, p.z, F.burst, 26, 3.2, 0.32, 0.42, { up: 1.2 });
      vfx.smokeBurst(p.x, p.y + 0.5, p.z, 0x3a5a2a, 6, 2, 0.5, 0.9, 0.35);
    }
    if (this.next) { this.dropModel(this.next); this.next = null; }
    if (this.want) { // built now, shown at +SWAP_HIDE
      const m = makeFormModel(this.want);
      m.mats = prepMaterials(m.root, this.flashU); applyOpacity(m.mats, this.ch.opacity);
      m.hind = [];
      const R = m.rig;
      if (R && R.legs && R.pelvis) for (const k of ['BL', 'BR']) { const b = R.legs[k] && R.legs[k].up; for (let o = b && b.parent; o; o = o.parent) if (o === R.pelvis) { m.hind.push(b); break; } }
      m.root.visible = false; this.ch.root.add(m.root);
      this.next = m;
    }
  }
  show() {
    this.swapT = -1;
    if (this.model) this.dropModel(this.model);
    this.model = this.next; this.next = null; this.key = this.want;
    this.act = this.prev = null; this.hitA.v = 9; this.stunW = 0; this.strafeW = 0; this.backW = 0; this.lastAtk = null; this.rushT = 0;
    this.clips = null;
    if (this.model) {
      this.model.root.visible = true;
      const F = FORM[this.key];
      // Phase 5 clips: a clip layer only when one of this form's clips has loaded and the model has a skeleton
      if (this.model.body && stateIds(F).some(id => resolveClip(id, NO_LIB))) this.clips = new ClipLayer(this.model.body);
      this.hitA.L = (MOTION[F.hit] || MOTION.ca_hit).L; this.hitA.fn = (MOTION[F.hit] || MOTION.ca_hit).fn; this.hitA.g = MOTION[F.hit]?.g || null;
      this.stunA.L = (MOTION[F.stun] || MOTION.ca_stun).L; this.stunA.fn = (MOTION[F.stun] || MOTION.ca_stun).fn; this.stunA.g = MOTION[F.stun]?.g || null;
      if (!this.st?.dead) this.startAct(F.shiftIn, { next: F.after || null });
    }
    this.ch.body.visible = !this.model;
  }
  dropModel(m) { this.ch.root.remove(m.root); m.dispose?.(); }

  // ---- events from the champion
  // kind: the humanoid's action kind ('attack', 'raise', 'release', 'charge' …), hitAt: s until a melee basic attack
  // lands (the claw strikes then), ab: the ability id when the caller knows it
  play(kind, dur, hitAt, ab) {
    // (a cast's start is the form's own business: st.casting starts it, so the humanoid's 'caststart' is skipped)
    if (!this.model || this.swapT >= 0 || this.outT >= 0 || kind === 'flinch' || kind === 'caststart' || this.st?.dead) return;
    const F = FORM[this.key];
    if (this.stunned) return; // CC holds the form in its daze (Frenzied Regeneration, usable stunned, shows as its heal)
    const inPounce = this.act && this.act.land;
    let e;
    if (ab && ab in F.abilities) { e = manifestAbility(this.key, ab); if (e === undefined) e = F.abilities[ab]; if (e === null) return; }
    else if (kind === 'attack') return this.attack(hitAt); // a basic attack (abilities come with their id)
    else if (this.key === 'tree' && (kind === 'release' || kind === 'raise') && (this.castMem > 0 || (this.act && this.act.release))) e = F.abilities.regrowth;
    else e = F.kinds[kind];
    if (!e) return;
    if (e === 'pounce') e = F.abilities.wild_pounce;
    if (e === 'rush') { this.rushT = 0.4; return; }
    if (typeof e === 'string') { this.startAct(e, { ability: true }); return; }
    if (e.cast) {
      // a sequence: already running → this is its release (Regrowth's cast ends), or a repeat (the pounce's dash event)
      if (this.act && this.act.release === e.release) { if (!this.act.land) this.startAct(e.release, { ability: true }); return; }
      if (inPounce) return;
      this.startSeq(e);
    }
  }
  startSeq(e) {
    const land = e.cast[0].includes('pounce');
    const n = e.cast.length;
    this.startAct(e.cast[0], { next: n > 1 ? e.cast[n - 1] : null, release: e.release, land, loop: n === 1 });
    if (land) { this.airSeen = false; this.pounceT = 0; }
  }
  attack(hitAt) {
    if (this.act && this.act.mo && this.act.mo.guard) return; // the tree's unfolding and blessing aren't cut short by a Wrath
    const F = FORM[this.key], A = F.attacks;
    let id, m;
    if (F.alternate) { this.atkN++; id = A[this.atkN % A.length]; m = A.length === 1 ? (this.atkN % 2 ? 1 : -1) : undefined; }
    else { id = A[Math.floor(Math.random() * A.length)]; if (id === this.lastAtk && A.length > 1) id = A[(A.indexOf(id) + 1 + Math.floor(Math.random() * (A.length - 1))) % A.length]; }
    this.lastAtk = id;
    this.startAct(id, { hitAt, m });
  }
  hit(strength = 1) {
    if (!this.model || this.st?.dead || this.swapT >= 0) return;
    const h = this.hitA;
    if (h.v < 0.05) { h.k = Math.max(h.k, strength >= 2 ? 1.4 : 1); return; } // already flinching this frame
    h.v = 0; h.k = strength >= 2 ? 1.4 : 1; h.m = Math.random() < 0.5 ? -1 : 1;
  }
  // a blow landed: the flash on every form material (not while faded) and the flinch
  flash(k = 1) {
    if (this.ch.opacity > 0.9) this.flashK = Math.max(this.flashK, k);
    this.hit(k >= 1 ? 2 : 1);
  }
  setOpacity(a) { if (this.model) applyOpacity(this.model.mats, a); if (this.next) applyOpacity(this.next.mats, a); }

  // ---- actions
  startAct(id, o = {}) {
    if (!id) return null;
    const mo = MOTION[id] || null, clip = this.clips ? this.clips.get(id) : null;
    if (!mo && !clip) return null;
    // the slot not in use; the old action fades out from where it is (one already fading before it is dropped)
    const old = this.act, a = (old || this.prev) === this.acts[0] ? this.acts[1] : this.acts[0];
    if (old) this.prev = old;
    const S = clip ? (clip.meta.impact ?? clip.meta.markers?.strike ?? clip.meta.markers?.release ?? (mo ? mo.S : 0)) : mo.S;
    a.id = id; a.mo = mo; a.clip = clip; a.g = mo ? mo.g : null; a.S = S; a.L = clip ? clip.dur : mo.L;
    a.loop = o.loop ?? !!(clip ? clip.meta.loop : mo.loop); a.hold = !!(mo && mo.hold);
    a.m = o.m ?? (mo && mo.m) ?? 1; a.k = 1; a.t = 0; a.w = 0;
    a.next = o.next || null; a.release = o.release || null; a.land = !!o.land;
    // timing (05 §6): a basic attack's strike lands on hitAt (the wind-up played at S / hitAt); an ability strikes
    // ABILITY_LEAD s after the press (it starts part-way into its wind-up); anything else plays from its start
    a.rs = 1; a.v = 0;
    if (o.hitAt > 0 && S > 0) a.rs = clamp(S / o.hitAt, 0.4, 2.5);
    else if (o.ability && S > ABILITY_LEAD && !(mo && mo.noLead)) a.v = S - ABILITY_LEAD;
    a.p = a.v < a.S ? a.v / Math.max(1e-3, a.S) : 1;
    this.act = a;
    return a;
  }
  endAct() { if (this.act) { this.prev = this.act; this.act = null; } }
  advance(adt, a) {
    a.t += adt; a.v += adt * (a.v < a.S ? a.rs : 1);
    if (a.hold && a.v > a.L) a.v = a.L;
    a.p = a.v < a.S ? a.v / Math.max(1e-3, a.S) : 1 + (a.v - a.S) / Math.max(1e-3, a.L - a.S);
  }

  drive(adt, dt, st) {
    const F = FORM[this.key], m = this.model, c = this.cst;
    const dead = !!st.dead, stunned = !dead && !this.frozen && !!(st.stunned || st.disoriented);
    this.stunned = stunned;
    this.castMem = st.casting ? 0.3 : Math.max(0, this.castMem - dt);
    this.rushT = Math.max(0, this.rushT - adt);
    if ((stunned || dead) && this.act && this.outT < 0) this.endAct(); // CC and death interrupt every action
    // Tree of Life: Regrowth's cast holds the hands up (tr_pre_loop) until it releases; an interrupted cast lets go
    if (this.key === 'tree' && !stunned && !dead && this.outT < 0) {
      const seq = F.abilities[F.cast];
      if (st.casting && !(this.act && this.act.release)) this.startSeq(seq);
      else if (!st.casting && this.castMem <= 0 && this.act && this.act.release && this.act.loop) this.endAct();
    }
    // Wild Pounce in flight: lands when the sim brings the druid down (or after a short hop that never left the ground)
    const a = this.act;
    if (a && a.land) {
      this.pounceT += adt;
      if (st.air) this.airSeen = true;
      if ((this.airSeen && !st.air && this.pounceT > 0.06) || (!this.airSeen && this.pounceT > 0.35) || this.pounceT > 1.8) this.startAct(a.release, {});
    }
    // advance the actions; one that ends hands over to its follow-up (or fades out from its rest pose)
    if (this.act) {
      const b = this.act;
      this.advance(adt, b); b.w = Math.min(1, b.w + adt / FADE_IN);
      if (!b.loop && !b.hold && b.v >= b.L) { if (b.next) this.startAct(b.next, { release: b.release, land: b.land }); else this.endAct(); }
    }
    if (this.prev) { const p = this.prev; this.advance(adt, p); p.w = Math.max(0, p.w - adt / FADE_OUT); if (p.w <= 0) this.prev = null; }
    // smoothed weights: stun, backing off, strafing, calm (no idle look-around while fighting)
    const k = Math.min(1, adt * 10), moving = (st.speed || 0) > 0.1;
    this.stunW += ((stunned ? 1 : 0) - this.stunW) * k;
    this.stunA.v = this.stunW > 0.01 ? this.stunA.v + adt : 0;
    this.backW += ((moving && st.back && !dead ? 1 : 0) - this.backW) * k;
    this.strafeW += ((moving && !st.back && !dead ? st.strafe || 0 : 0) - this.strafeW) * Math.min(1, adt * 6);
    this.calm += ((this.act || stunned ? 1 : 0) - this.calm) * Math.min(1, adt * 4);
    if (this.hitA.v < this.hitA.L) this.hitA.v += adt;
    // the procedural driver: gait / idle / death of the model, then this.layer(rig) adds the form's motions
    c.speed = st.speed || 0; c.dead = dead; c.air = !!st.air && !(this.act && this.act.land); c.dir = st.back ? -1 : 1;
    c.calm = this.calm; c.rush = this.rushT > 0;
    m.update(adt, moving, false, c);
    // Phase 5 clips over it: the action's clip, else the stun / locomotion / death clip of the state
    if (this.clips) {
      const CL = this.clips, b = this.act;
      let rec = null, t = 0, loop = false;
      if (b && b.clip) { rec = b.clip; t = b.v; loop = b.loop; }
      else if (stunned && (rec = CL.get(F.stun))) { t = this.stunA.v; loop = true; }
      else if (dead && (rec = CL.get(F.death))) t = this.deadT;
      else if (!dead && !st.air && (rec = CL.get(this.locoId(st)))) {
        const stride = rec.meta.stride; // m per loop: playback follows the ground speed (04 §2 rule 3)
        this.locoT += adt * (stride && st.v ? clamp(st.v * rec.dur / stride, 0.5, 2.2) : 1); t = this.locoT; loop = true;
      }
      CL.update(adt, rec, t, loop);
    }
    // whole-body offsets on the form's root
    const Q = this.Q, R = m.root;
    R.rotation.set(0, Q.yaw, Q.roll);
    const g = Q.g, s = Q.sq; R.scale.set(1 + g + s * 0.5, 1 + g - s, 1 + g + s * 0.5);
  }
  locoId(st) {
    const F = FORM[this.key], sp = st.speed || 0;
    if (sp < 0.08) return F.idle;
    if (st.back) return F.back;
    if (st.strafe) return st.strafe > 0 ? F.strafeL : F.strafeR;
    return sp < 0.5 ? F.walk : F.run;
  }

  // the pose layer: called by the model's driver after its gait, before its pose is applied
  layer(rig) {
    const Q = this.Q, m = this.model;
    Q.begin(rig, m.hind || NONE);
    if (this.st && this.st.dead) return;
    // backing off low, head on the enemy; strafing: the body turns toward where it goes, the head stays on the enemy
    if (this.backW > 0.01) { Q.w = this.backW; Q.lift(-0.05); Q.rot(rig.neck, 0.18); }
    const sw = this.strafeW;
    if (Math.abs(sw) > 0.01) { Q.w = 1; Q.turn(0.55 * sw); Q.rot(rig.chest, 0, -0.15 * sw); Q.rot(rig.neck, 0, -0.4 * sw); }
    // the actions (a clip-driven one is drawn by the clip layer)
    const p = this.prev, a = this.act;
    if (p && p.w > 0 && p.mo && !p.clip) { Q.w = p.w; p.mo.fn(Q, p); }
    if (a && a.mo && !a.clip) { Q.w = a.w; a.mo.fn(Q, a); }
    if (this.stunW > 0.01 && this.stunA.fn && !(this.clips && this.clips.get(FORM[this.key].stun))) { Q.w = this.stunW; this.stunA.fn(Q, this.stunA); }
    // hit: additive, on top of attacks too
    const h = this.hitA;
    if (h.v < h.L && h.fn) { Q.w = 1; h.fn(Q, h); }
  }
}
const NONE = [];
// frozen solid: Freezing Trap's disorient (the sim names it; no closure per frame)
function frozenBy(buffs) {
  if (buffs) for (let i = 0; i < buffs.length; i++) if (buffs[i].name === 'Frozen Trap') return true;
  return false;
}

// the manifest's abilities table naming one of this form's clips for an ability ("cat:rake" first, then "rake")
function manifestAbility(form, ab) {
  const A = MANIFEST.abilities; if (!A) return undefined;
  const e = A[form + ':' + ab] ?? A[ab]; if (e == null) return undefined;
  const pre = FORM[form].prefix, ok = id => typeof id === 'string' && id.startsWith(pre);
  if (ok(e)) return e;
  if (typeof e === 'object' && Array.isArray(e.cast) && e.cast.length && e.cast.every(ok) && (!e.release || ok(e.release))) return e;
  return undefined;
}
