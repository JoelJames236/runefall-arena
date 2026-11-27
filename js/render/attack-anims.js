// Basic-attack animations made with Tripo Studio's AI animation (text → motion on a rigged human with a Mixamo
// skeleton), extracted to JSON by tools/anim-extract.mjs (assets/models/anims/<name>.json).
//
// At load: the skeleton is rebuilt with UAL bone names (so the champion retargeting in champions.js reads it like
// the UAL clips), every clip gets its strike moment measured (the striking hand's peak speed) and is trimmed to
// wind-up + strike + follow-through + recovery around it. heroes.js plays them like any other clip and times the
// strike to land when the sim deals the blow.
import * as THREE from 'three';
import { restOf } from './champions.js';

const FILE = 'assets/models/anims/attacks.json';
// name → how to cut and play it.
//   hand: the striking hand ('r' / 'l');  at: the strike (s into the generated clip) — where the weapon tip moves
//   fastest with the blade in front of the body, measured on the champions with their real weapons (see
//   docs/ATTACK_ANIMATIONS.md);  pre / post: s kept before / after the strike;  speed: playback rate;
//   grip: how the weapon sits in the fist during this motion — 'fist' (through the fist toward the thumb), 'rev'
//   (turned over: toward the little finger), 'palmRev' (along the palm's normal: the upright bow) or 'idle' (the
//   hold of the idle pose), whichever points the blade at the enemy when the blow lands.
export const ATTACK_ANIMS = {
  sword_fore: { hand: 'r', at: 1.33, pre: 0.45, post: 0.7, speed: 1.1, grip: 'rev' },   // diagonal forehand cut
  sword_back: { hand: 'r', at: 1.25, pre: 0.45, post: 0.7, speed: 1.1, grip: 'rev' },   // backhand cut, left → right
  chop_r: { hand: 'r', at: 1.52, pre: 0.6, post: 0.75, speed: 1.05, grip: 'fist' },     // big one-handed axe chop over the right shoulder
  chop_l: { hand: 'l', at: 1.2, pre: 0.55, post: 0.75, speed: 1.05, grip: 'fist' },     // the same with the left hand
  smash2h: { hand: 'r', at: 1.32, pre: 0.6, post: 0.8, speed: 1.0, grip: 'fist' },      // warhammer raised overhead, slammed into the ground
  axe2h: { hand: 'r', at: 0.93, pre: 0.55, post: 0.85, speed: 1.0, grip: 'fist' },      // two-handed diagonal chop
  sweep2h: { hand: 'r', at: 0.45, pre: 0.45, post: 0.85, speed: 1.0, grip: 'rev' },     // two-handed horizontal sweep
  stab_r: { hand: 'r', at: 0.56, pre: 0.4, post: 0.5, speed: 1.15, grip: 'idle' },     // lunging dagger stab
  hook_l: { hand: 'l', at: 0.57, pre: 0.35, post: 0.5, speed: 1.15, grip: 'idle' },     // dagger hook slash, left hand
  wand: { hand: 'r', at: 0.53, pre: 0.35, post: 0.7, speed: 1.0, grip: 'rev' },         // wand flick, the wand ends pointing at the target
  scepter: { hand: 'r', at: 1.05, pre: 0.5, post: 0.65, speed: 1.0, grip: 'fist' },     // scepter raised, then swung to point
  staff: { hand: 'r', at: 0.55, pre: 0.45, post: 0.7, speed: 1.0, grip: 'fist' },       // staff thrust, the head at the target
  bow: { hand: 'r', at: 1.2, pre: 0.35, post: 1.1, speed: 1.0, grip: 'palmRev' },       // loose at full draw, then nock and draw again (bow upright)
};
const MIX = {
  hips: 'pelvis', spine: 'spine_01', spine1: 'spine_02', spine2: 'spine_03', neck: 'neck_01', head: 'Head',
  shoulder: 'clavicle', arm: 'upperarm', forearm: 'lowerarm', hand: 'hand', upleg: 'thigh', leg: 'calf', foot: 'foot', toebase: 'ball',
  handmiddle1: 'middle_01', handmiddle2: 'middle_02', handmiddle3: 'middle_03', handindex1: 'index_01', handindex2: 'index_02', handindex3: 'index_03',
  handring1: 'ring_01', handring2: 'ring_02', handring3: 'ring_03', handpinky1: 'pinky_01', handpinky2: 'pinky_02', handpinky3: 'pinky_03',
  handthumb1: 'thumb_01', handthumb2: 'thumb_02', handthumb3: 'thumb_03',
};
// Mixamo name → UAL name ("mixamorig:LeftForeArm" → "lowerarm_l"); unknown bones keep a neutral name
function ualName(raw) {
  const n = raw.replace(/^mixamorig\d*[:_]?/i, '').toLowerCase();
  const side = n.startsWith('left') ? '_l' : n.startsWith('right') ? '_r' : '';
  const base = side ? n.slice(side === '_l' ? 4 : 5) : n;
  const m = MIX[base];
  return m ? (side ? m + side : m) : 'x_' + n;
}

let SOURCE = null;          // { root, rest } — the animation skeleton in its rest pose (for retargeting)
export const ANIM_CLIPS = {}; // name → THREE.AnimationClip (UAL bone names, trimmed), with userData.impact
export const RAW_CLIPS = {};  // name → the untrimmed clip
export const animSource = () => SOURCE;
// debugging: the striking hand's path through a raw clip, relative to the hips (x = left, y = up, z = forward), every dt s
export function handPath(name, dt = 0.05) {
  const clip = RAW_CLIPS[name], spec = ATTACK_ANIMS[name]; if (!clip || !PROBE) return null;
  const mixer = new THREE.AnimationMixer(PROBE.root), act = mixer.clipAction(clip); act.play();
  const h = PROBE.root.getObjectByName('hand_' + spec.hand), hips = PROBE.root.getObjectByName('pelvis'), p = new THREE.Vector3(), q = new THREE.Vector3(), prev = new THREE.Vector3();
  const rows = [];
  for (let t = 0; t <= clip.duration + 1e-6; t += dt) {
    mixer.setTime(t); PROBE.root.updateMatrixWorld(true); h.getWorldPosition(p); hips.getWorldPosition(q); p.sub(q);
    rows.push([+t.toFixed(2), +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), t ? +(p.distanceTo(prev) / dt).toFixed(1) : 0]);
    prev.copy(p);
  }
  act.stop(); mixer.uncacheRoot(PROBE.root);
  return rows;
}
let PROBE = null;

function buildSkeleton(bones) {
  const nodes = bones.map(b => {
    const isBone = /^mixamorig/i.test(b.name);
    const o = isBone ? new THREE.Bone() : new THREE.Object3D();
    o.name = isBone ? ualName(b.name) : b.name;
    o.position.fromArray(b.t); o.quaternion.fromArray(b.r); o.scale.fromArray(b.s);
    return o;
  });
  const root = new THREE.Group();
  bones.forEach((b, i) => (b.parent >= 0 ? nodes[b.parent] : root).add(nodes[i]));
  root.updateMatrixWorld(true);
  return { root, nodes };
}
function toClip(c, nodes) {
  const tracks = [];
  for (const t of c.tracks) {
    const name = nodes[t.node].name;
    if (t.path === 'rotation') tracks.push(new THREE.QuaternionKeyframeTrack(name + '.quaternion', t.times, t.values));
    else if (t.path === 'translation' && name === 'pelvis') tracks.push(new THREE.VectorKeyframeTrack(name + '.position', t.times, t.values));
  }
  return new THREE.AnimationClip(c.name, c.duration, tracks);
}
// The striking moment. A blow lands when the striking hand is fast AND out in front of the body (a wind-up is
// fast too, but close to the shoulder): score = speed × (0.25 + forward reach). metric 'speed' (the bow's release,
// when the string hand snaps back) uses the speed alone. Positions are relative to the hips, so a step doesn't count.
function measureImpact(clip, sk, hand, win, metric = 'reach') {
  const mixer = new THREE.AnimationMixer(sk.root), act = mixer.clipAction(clip); act.play();
  const h = sk.root.getObjectByName('hand_' + hand), hips = sk.root.getObjectByName('pelvis');
  const p = new THREE.Vector3(), q = new THREE.Vector3(), prev = new THREE.Vector3();
  let best = 0, at = clip.duration / 2, first = true;
  const t0 = win ? win[0] * clip.duration : 0.15, t1 = win ? win[1] * clip.duration : clip.duration - 0.2;
  for (let t = 0; t <= clip.duration; t += 1 / 60) {
    mixer.setTime(t); sk.root.updateMatrixWorld(true);
    h.getWorldPosition(p); hips.getWorldPosition(q); p.sub(q);
    if (!first && t >= t0 && t <= t1) {
      const v = p.distanceTo(prev) * 60, s = metric === 'speed' ? v : v * (0.25 + Math.min(0.8, Math.max(0, p.z)));
      if (s > best) { best = s; at = t; }
    }
    prev.copy(p); first = false;
  }
  act.stop(); mixer.uncacheRoot(sk.root);
  return { at, score: best };
}
// The generated motions turn the whole body (a backhand spins the hips ~120°). In the game the champion keeps
// facing where its player aims, so most of the hips' heading is taken out (the spine's twist stays): the heading
// of the hips relative to the rest pose (straight ahead) is measured and `keep` of it is left in.
function steadyHeading(clip, sk, keep = 0.25) {
  const tr = clip.tracks.find(t => t.name === 'pelvis.quaternion'); if (!tr) return;
  const hips = sk.root.getObjectByName('pelvis'), parentQ = hips.parent.getWorldQuaternion(new THREE.Quaternion()), parentInv = parentQ.clone().invert();
  const q = new THREE.Quaternion(), wq = new THREE.Quaternion(), fwd = new THREE.Vector3(), corr = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  // the character's forward in the hips' local frame, from the rest pose (character faces +z)
  const restW = parentQ.clone().multiply(hips.quaternion), localFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(restW.clone().invert());
  const heading = i => { q.fromArray(tr.values, i * 4); wq.copy(parentQ).multiply(q); fwd.copy(localFwd).applyQuaternion(wq); return Math.atan2(fwd.x, fwd.z); };
  const h0 = 0; // the rest pose faces straight ahead, like the game's idle
  for (let i = 0; i < tr.times.length; i++) {
    let dh = heading(i) - h0; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    q.fromArray(tr.values, i * 4); wq.copy(parentQ).multiply(q);
    corr.setFromAxisAngle(up, -dh * (1 - keep)); wq.premultiply(corr);
    q.copy(parentInv).multiply(wq).toArray(tr.values, i * 4);
  }
  // root motion follows the same turn (a step to the side stays a step to the side)
  const pt = clip.tracks.find(t => t.name === 'pelvis.position');
  if (pt) { const v = new THREE.Vector3(), p0 = new THREE.Vector3().fromArray(pt.values, 0); for (let i = 0; i < pt.times.length; i++) { v.fromArray(pt.values, i * 3); v.x = p0.x + (v.x - p0.x) * 0.6; v.z = p0.z + (v.z - p0.z) * 0.6; v.toArray(pt.values, i * 3); } }
}
// cut [a, b] out of a clip, sampling every track at its own keys inside the window plus both ends
function trim(clip, a, b) {
  const tracks = clip.tracks.map(tr => {
    const I = tr.createInterpolant(), n = tr.getValueSize(), times = [a], vals = [...I.evaluate(a)];
    for (let k = 0; k < tr.times.length; k++) { const t = tr.times[k]; if (t > a + 1e-4 && t < b - 1e-4) { times.push(t); for (let j = 0; j < n; j++) vals.push(tr.values[k * n + j]); } }
    times.push(b); vals.push(...I.evaluate(b));
    const T = tr.constructor; return new T(tr.name, times.map(t => t - a), vals);
  });
  return new THREE.AnimationClip(clip.name, b - a, tracks);
}

export async function loadAttackAnims() {
  const d = await fetch(FILE).then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (!d || !d.clips?.length) return ANIM_CLIPS;
  const sk = buildSkeleton(d.bones), probe = buildSkeleton(d.bones);
  SOURCE = { root: sk.root, rest: restOf(sk.root) }; PROBE = probe;
  for (const c of d.clips) {
    const spec = ATTACK_ANIMS[c.name]; if (!spec) continue;
    const raw = toClip(c, sk.nodes);
    steadyHeading(raw, sk, spec.keepTurn ?? 0.25);
    const at = spec.at ?? measureImpact(raw, probe, spec.hand, spec.window, spec.metric).at; // spec.at: set by eye
    const a = Math.max(0, at - spec.pre), b = Math.min(raw.duration, at + spec.post);
    const clip = trim(raw, a, b); clip.name = c.name;
    clip.userData = { impact: at - a, speed: spec.speed || 1, src: 'tripo', raw: at, from: a, to: b };
    ANIM_CLIPS[c.name] = clip;
    RAW_CLIPS[c.name] = raw; // the whole generated motion (for checking the cut by eye: heroes.js registers it as "raw:<name>")
  }
  return ANIM_CLIPS;
}
