// Generated creature models (Tripo Studio → retopology → auto-rig "other" / four-legged): the Druid's Cat Form and
// Bear Form. The GLB brings the textured mesh and a skeleton; the motion stays procedural (the same walk / gallop,
// idle breathing, tail sway, pounce, rear-up maul and death roll as the code-built beasts in beasts.js), now
// driven on the generated bones.
//
// The auto-rig's bone names are not relied on (they mix up legs and tail): the rig is read from its rest pose.
// The model faces along its long axis towards its highest bone (the head). The four lowest leaf bones are the
// feet (the front pair is the one further forward, left / right within each pair); walking up from each foot to
// the bone where a pair's chains meet gives the legs, the path between the two junctions is the spine, the
// chain leaving the front junction forward is neck → head (a bone below the head pointing forward is the jaw)
// and the unused chain reaching furthest backward is the tail.
//
// Rotations are authored around model-space axes (x = pitch, y = yaw, z = roll) and converted into each bone's
// own rest frame, so the gait code is the same for any rig orientation.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// kind -> GLB (relative to assets/models/creatures/). Missing / failed files fall back to beasts.js.
export const CREATURE_MODELS = { cat: 'druid_cat.glb', bear: 'druid_bear.glb' };
// standing height (top of the bounding box at rest, metres) each model is scaled to
const HEIGHT = { cat: 1.25, bear: 1.75 };
// generated poses aren't always straight: the cat was modelled looking over its left shoulder. A constant
// yaw (radians, + = to its left) on neck and head brings the face back in line with the body.
export const HEAD_FIX = { cat: -1.4, bear: 0 };
const DIR = 'assets/models/creatures/';
const loaded = {}, pending = {};

export const creatureModel = kind => loaded[kind] || null;
export function loadCreature(loader, kind) {
  if (!CREATURE_MODELS[kind]) return Promise.resolve(null);
  if (kind in loaded) return Promise.resolve(loaded[kind]);
  if (pending[kind]) return pending[kind];
  return (pending[kind] = new Promise(res => loader.load(DIR + CREATURE_MODELS[kind], g => {
    try { loaded[kind] = { scene: g.scene, rig: readRig(g.scene) }; }
    catch (e) { console.warn('creature rig not understood, using the code-built beast:', kind, e); loaded[kind] = null; }
    res(loaded[kind]);
  }, undefined, err => { console.warn('creature model failed, using the code-built beast:', kind, err); loaded[kind] = null; res(null); })));
}
export async function preloadCreatures(loader) { for (const k of Object.keys(CREATURE_MODELS)) await loadCreature(loader, k); }

// ------------------------------------------------------------------ rig analysis (on the loaded scene, once)
function readRig(scene) {
  scene.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const bones = []; scene.traverse(o => { if (o.isBone) bones.push(o); });
  if (bones.length < 8) throw new Error('too few bones: ' + bones.length);
  const P = new Map(), byName = new Map();
  for (const b of bones) { P.set(b, new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld))); byName.set(b.name, b); }
  const kids = b => b.children.filter(c => c.isBone);
  const parent = b => (b.parent && b.parent.isBone ? b.parent : null);
  const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3());
  // facing: along the model's long horizontal axis, towards the end with the highest bone (the head)
  const longX = size.x > size.z;
  const top = bones.reduce((a, b) => (P.get(b).y > P.get(a).y ? b : a), bones[0]);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const F = longX ? new THREE.Vector3(Math.sign(P.get(top).x - cx) || 1, 0, 0) : new THREE.Vector3(0, 0, Math.sign(P.get(top).z - cz) || 1);
  const Lft = new THREE.Vector3(0, 1, 0).cross(F); // the creature's left (facing F, up +Y)
  const fwd = v => v.dot(F), side = v => v.dot(Lft);
  // feet: the four lowest leaf bones (the tail tip, if it hangs low, is still higher than the paws). The auto-rig
  // sometimes gives a leg a single bone that stops at the hip: it still counts (that leg then swings as a whole)
  const leaves = bones.filter(b => !kids(b).length && b !== top).sort((a, b) => P.get(a).y - P.get(b).y);
  const feet = leaves.slice(0, 4);
  if (feet.length < 4 || P.get(feet[2]).y > box.min.y + size.y * 0.3 || P.get(feet[3]).y > box.min.y + size.y * 0.6) throw new Error('feet not found');
  // front pair = the two feet furthest forward; left / right within each pair
  feet.sort((a, b) => fwd(P.get(b)) - fwd(P.get(a)));
  const pair = (a, b) => (side(P.get(a)) >= side(P.get(b)) ? [a, b] : [b, a]);
  const [FLf, FRf] = pair(feet[0], feet[1]), [BLf, BRf] = pair(feet[2], feet[3]);
  const quad = { FL: FLf, FR: FRf, BL: BLf, BR: BRf };
  const chainUp = b => { const c = []; for (let x = b; x; x = parent(x)) c.push(x); return c; }; // foot → root
  // junction of a leg pair: the deepest bone shared by both chains
  const meet = (a, b) => { const A = chainUp(a), B = new Set(chainUp(b)); return A.find(x => B.has(x)); };
  const front = meet(quad.FL, quad.FR), back = meet(quad.BL, quad.BR);
  // a leg: bones from just below the junction down to the foot (a bone sitting on top of the previous one is skipped)
  const legOf = (foot, j) => { const c = chainUp(foot); return c.slice(0, c.indexOf(j)).reverse().filter((b, i, a) => i === 0 || P.get(b).distanceTo(P.get(a[i - 1])) > size.y * 0.03); };
  const legs = {}; for (const k of ['FL', 'FR', 'BL', 'BR']) legs[k] = legOf(quad[k], k[0] === 'F' ? front : back);
  // spine: path from the back junction up to the front junction (or the other way round)
  let spine = [];
  { const up = chainUp(front); const i = up.indexOf(back);
    if (i >= 0) spine = up.slice(0, i + 1).reverse(); else { const up2 = chainUp(back), j = up2.indexOf(front); spine = j >= 0 ? up2.slice(0, j + 1) : [back, front]; } }
  // neck / head: from the front end of the spine, follow the child that heads forward and up (not a leg, not the spine)
  const used = new Set([...spine, ...Object.values(legs).flat()]);
  const frontEnd = fwd(P.get(front)) > fwd(P.get(back)) ? front : back, backEnd = frontEnd === front ? back : front;
  const follow = (start, score) => { const c = []; let x = start; for (;;) { const ks = kids(x).filter(k => !used.has(k)); if (!ks.length) break; x = ks.sort((a, b) => score(b) - score(a))[0]; c.push(x); used.add(x); } return c; };
  const neckHead = follow(frontEnd, k => fwd(P.get(k)) * 1.0 + P.get(k).y * 0.5);
  // head = the neck chain bone where the chain stops climbing (the highest one in the front third), jaw = a lower forward child
  let head = neckHead.length ? neckHead.reduce((h, b) => (P.get(b).y > P.get(h).y - 0.02 * size.y ? b : h), neckHead[0]) : null;
  const neck = head ? neckHead.slice(0, neckHead.indexOf(head)) : [];
  const jaw = head ? kids(head).find(k => P.get(k).y < P.get(head).y && fwd(P.get(k)) > fwd(P.get(head))) || null : null;
  // tail: the unused chain (hanging off the spine or the root) that reaches furthest backward
  let tail = [];
  for (const b of bones) {
    if (used.has(b) || !(parent(b) && (used.has(parent(b)) || !parent(parent(b))))) continue;
    const c = [b]; let x = b; for (;;) { const ks = kids(x).filter(k => !used.has(k)); if (!ks.length) break; x = ks.sort((p, q) => fwd(P.get(p)) - fwd(P.get(q)))[0]; c.push(x); }
    if (c.length >= 2 && fwd(P.get(c[c.length - 1])) < fwd(P.get(backEnd)) && (!tail.length || fwd(P.get(c[c.length - 1])) < fwd(P.get(tail[tail.length - 1])))) tail = c;
  }
  // turn that brings the model's facing onto +Z (the game's forward)
  const yaw = -Math.atan2(F.x, F.z);
  return { legs: mapNames(legs), spine: spine.map(b => b.name), neck: neck.map(b => b.name), head: head?.name || null, jaw: jaw?.name || null, tail: tail.map(b => b.name), yaw, height: size.y, minY: box.min.y };
}
const mapNames = legs => Object.fromEntries(Object.entries(legs).map(([k, c]) => [k, c.map(b => b.name)]));

// ------------------------------------------------------------------ instances
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
export function makeCreature(kind) {
  const src = loaded[kind]; if (!src) return null;
  const R = src.rig, body = SkeletonUtils.clone(src.scene);
  const bones = {}; body.traverse(o => { if (o.isBone) bones[o.name] = o; if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; o.material = o.material.clone(); } });
  // the model faces +Z in the game: turn it from the way it was generated
  const turn = new THREE.Group(); turn.add(body);
  turn.rotation.y = R.yaw;
  const grp = new THREE.Group(); grp.add(turn);
  const s = (HEIGHT[kind] || 1.2) / Math.max(0.01, R.height); turn.scale.setScalar(s); turn.position.y = -R.minY * s;
  // rest frames: local rest quaternion and the bone's rest rotation in model space (for axis conversion)
  grp.updateMatrixWorld(true);
  const gInv = new THREE.Quaternion(); grp.getWorldQuaternion(gInv).invert();
  const rest = new Map();
  for (const b of Object.values(bones)) rest.set(b, { q: b.quaternion.clone(), W: gInv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion())), Wi: null });
  for (const r of rest.values()) r.Wi = r.W.clone().invert();
  const B = n => (n ? bones[n] : null);
  const legs = Object.fromEntries(Object.entries(R.legs).map(([k, c]) => {
    const ch = c.map(B).filter(Boolean);
    // three joints that matter for the gait, from the top: shoulder / hip, elbow / knee, wrist / hock (a toe bone is left alone)
    const up = ch[0], lo = ch[1] || null, pw = ch[2] || null;
    return [k, { up, lo, pw }];
  }));
  const spine = R.spine.map(B).filter(Boolean), chest = spine[spine.length - 1];
  // pelvis: the first spine bone above the root (a root bone sits on the ground: pitching it would sink the rear)
  const pelvis = spine[0] && !(spine[0].parent && spine[0].parent.isBone) && spine[1] ? spine[1] : spine[0];
  const midSpine = spine[Math.floor(spine.length / 2)] || pelvis;
  const neck = R.neck.map(B).filter(Boolean), head = B(R.head), jaw = B(R.jaw), tail = R.tail.map(B).filter(Boolean);
  // a pose is a set of model-space rotations per bone, applied on top of the rest pose (one preallocated entry per
  // bone: nothing is allocated per frame)
  const restList = [...rest].map(([b, r]) => ({ b, r, x: 0, y: 0, z: 0, on: false }));
  const pose = new Map(restList.map(e => [e.b, e]));
  const rot = (b, x = 0, y = 0, z = 0) => { if (!b) return; const p = pose.get(b); if (p) { p.x += x; p.y += y; p.z += z; p.on = true; } };
  const apply = () => {
    for (let i = 0; i < restList.length; i++) {
      const p = restList[i], b = p.b, r = p.r;
      b.quaternion.copy(r.q);
      if (!p.on) continue;
      _q.setFromEuler(_e.set(p.x, p.y, p.z));
      b.quaternion.multiply(_q2.copy(r.Wi).multiply(_q).multiply(r.W)); // model-space rotation in the bone's own frame
      p.x = p.y = p.z = 0; p.on = false;
    }
  };
  const LEGS = ['FL', 'FR', 'BL', 'BR'].map(k => ({ key: k, L: legs[k], front: k[0] === 'F' })).filter(e => e.L && e.L.up);
  const OFF_GALLOP = { FL: 0, FR: 0.35, BL: Math.PI, BR: Math.PI + 0.35 }, OFF_WALK = { FL: 0, FR: Math.PI, BL: Math.PI * 1.5, BR: Math.PI * 0.5 };
  const smooth = t => t * t * (3 - 2 * t);
  const state = { phase: 0, speed: 0, atk: 0, atkWas: false, swipeSide: 1, dead: 0, t: Math.random() * 10 };
  const cat = kind !== 'bear';
  const baseY = turn.position.y;
  const n0 = neck[0] || head;
  // the bones and offsets a pose layer (forms.js: the druid form state machine) adds its motions to, in the same
  // model-space terms as the gait below (x = pitch, y = yaw, z = roll; lift / push move the body up / forward, m)
  const rig = { kind, legs, pelvis, mid: midSpine, chest, neck: n0, head: head && head !== n0 ? head : null, jaw, tail, rot,
    lift: y => { turn.position.y += y; }, push: z => { turn.position.z += z; } };
  // st0.dir: -1 runs the gait backwards (backing off); st0.layer(rig): extra motion on top of gait, idle and air
  function update(dt, moving, attacking, st0 = {}) {
    const S = state; S.t += dt;
    const targetSpeed = st0.dead ? 0 : (st0.speed !== undefined ? Math.min(1.4, st0.speed) : (moving ? 1 : 0));
    S.speed += (targetSpeed - S.speed) * Math.min(1, dt * 6);
    const gallop = S.speed > 1.05;
    const freq = cat ? (gallop ? 2.7 : 1.9) : (gallop ? 1.9 : 1.35);
    S.phase += dt * Math.PI * 2 * freq * Math.max(0.25, S.speed) * (S.speed > 0.05 ? 1 : 0) * (st0.dir < 0 ? -1 : 1);
    if (attacking && !S.atkWas) { S.atk = 1; S.swipeSide = -S.swipeSide; } S.atkWas = attacking;
    S.atk = Math.max(0, S.atk - dt / (cat ? 0.42 : 0.6));
    S.dead = st0.dead ? Math.min(1, S.dead + dt * 2.2) : Math.max(0, S.dead - dt * 3);
    const m = Math.min(1, S.speed), P = S.phase;
    // legs: walk = lateral sequence; gallop = front pair / back pair with a small lead (as in beasts.js)
    const off = gallop ? OFF_GALLOP : OFF_WALK;
    const amp = (cat ? 0.55 : 0.42) * (gallop ? 1.35 : 1) * m;
    for (let i = 0; i < LEGS.length; i++) {
      const { key, L, front: fr } = LEGS[i], ph = P + off[key], sw = Math.sin(ph), lift = Math.max(0, Math.cos(ph)) * m;
      rot(L.up, -sw * amp);
      if (fr) { rot(L.lo, lift * (cat ? 1.1 : 0.8)); rot(L.pw, -lift * 0.9); }
      else { rot(L.up, -lift * 0.25); rot(L.lo, -lift * 0.9); rot(L.pw, lift * 1.1); }
    }
    const bob = Math.abs(Math.sin(P)) * (gallop ? 0.06 : 0.025) * m;
    turn.position.y = baseY + bob; turn.position.z = 0;
    rot(midSpine, (gallop ? Math.sin(P) * 0.18 : 0) * m);
    rot(chest, (gallop ? -Math.sin(P) * 0.1 : 0) * m, -Math.sin(P) * 0.06 * m);
    rot(pelvis, 0, Math.sin(P) * 0.05 * m);
    // idle: looking around, head bob; tail sway
    const idle = 1 - m, T = S.t;
    const fix = HEAD_FIX[kind] || 0;
    if (fix) { rot(n0, 0, fix * (head && head !== n0 ? 0.6 : 1)); if (head && head !== n0) rot(head, 0, fix * 0.4); }
    // a pose layer can calm the idle look-around (st0.calm 0..1: a form busy fighting keeps its head on the enemy)
    const look = idle * (1 - (st0.calm || 0));
    rot(n0, -Math.sin(P * 2) * 0.05 * m + (cat ? 0.05 : -0.05) * idle, Math.sin(T * 0.37) * 0.35 * look);
    rot(head, Math.sin(T * 0.9) * 0.04 * idle);
    for (let i = 0; i < tail.length; i++) rot(tail[i], (cat ? (i < 2 ? 0.12 : -0.18) * (1 - m * 0.6) : 0.1) * 0.6 + (gallop ? -0.1 : 0), Math.sin(T * (cat ? 1.6 : 2.2) - i * 0.7) * (cat ? 0.2 : 0.1) * (0.5 + idle * 0.5));
    // attack: the cat pounces and rakes with a front paw, the bear rears up and mauls with both
    const a = S.atk;
    if (a > 0) {
      const k = Math.sin((1 - a) * Math.PI);
      if (cat) {
        turn.position.z = k * 0.35; rot(pelvis, -k * 0.25); rot(chest, -k * 0.15);
        const L = S.swipeSide > 0 ? legs.FL : legs.FR; rot(L.up, -k * 1.6); rot(L.lo, k * 0.6); rot(L.pw, -k * 0.8);
        rot(n0, k * 0.25); rot(jaw, k * 0.55);
      } else {
        const r = Math.sin(Math.min(1, (1 - a) * 1.4) * Math.PI);
        rot(pelvis, -r * 0.75); turn.position.y += r * 0.12;
        for (let i = 0; i < LEGS.length; i++) { const { L, front } = LEGS[i]; if (front) { rot(L.up, -r * 1.2 - (1 - a > 0.55 ? k * 0.6 : 0)); rot(L.lo, r * 0.5); } else rot(L.up, r * 0.75); }
        rot(n0, -r * 0.1); rot(head, r * 0.3); rot(jaw, k * 0.7);
      }
    }
    if (st0.air) for (let i = 0; i < LEGS.length; i++) { const { L, front } = LEGS[i]; rot(L.up, front ? -0.5 : 0.5); rot(L.lo, 0.4); }
    if (st0.layer) st0.layer(rig);
    // death: roll onto the side, legs limp
    if (S.dead > 0) { const d = smooth(S.dead); grp.rotation.z = d * Math.PI / 2 * 0.96; turn.position.y = baseY - d * 0.04 + bob * (1 - d); rot(n0, d * 0.3); }
    else grp.rotation.z = 0;
    apply();
  }
  update(0, false, false, {});
  // body: the skinned model (an AnimationMixer root for clips made on this rig); bones: name → bone
  return { root: grp, update, rig, body, bones, dispose() { body.traverse(o => { if (o.isMesh) o.material.dispose(); }); }, generated: true };
}
