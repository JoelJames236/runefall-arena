// Basic-attack animations made with Tripo Studio's AI animation (text → motion on a rigged human with a Mixamo
// skeleton), extracted to JSON by tools/anim-extract.mjs (assets/models/anims/<name>.json).
//
// At load: the skeleton is rebuilt with UAL bone names (so the champion retargeting in champions.js reads it like
// the UAL clips), every clip gets its strike moment measured (the striking hand's peak speed) and is trimmed to
// wind-up + strike + follow-through + recovery around it. heroes.js plays them like any other clip and times the
// strike to land when the sim deals the blow.
//
// The remodel's clip sets (docs/remodel/05-animations.md) come through the animation manifest instead
// (assets/models/anims/manifest.json → loadManifest below): one JSON per stance set, cut and timed by the manifest's
// trim / markers, with a fallback to today's clips for every clip that isn't made yet.
import * as THREE from 'three';
import { restOf } from './champions.js';
import { validSpec } from '../data/classes.js';

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
// Make a clip end the way it starts: the difference between its last and first key is taken out of every key in
// proportion to its time (quaternions: the rotation from the last to the first key, slerped in). A loop then has no
// pop, and a pelvis that ran or stepped away (AI motions carry root motion) stays in place.
function closeLoop(clip, only = null) {
  const q = new THREE.Quaternion(), c = new THREE.Quaternion(), e = new THREE.Quaternion(), I = new THREE.Quaternion();
  for (const tr of clip.tracks) {
    if (only && !only.test(tr.name)) continue;
    const n = tr.times.length, v = tr.values, d = tr.times[n - 1] - tr.times[0]; if (n < 2 || !(d > 0)) continue;
    if (tr.name.endsWith('.quaternion')) {
      c.fromArray(v, (n - 1) * 4).invert().multiply(q.fromArray(v, 0)).normalize(); // last^-1 · first
      for (let i = 1; i < n; i++) { q.fromArray(v, i * 4).multiply(e.slerpQuaternions(I, c, (tr.times[i] - tr.times[0]) / d)).normalize().toArray(v, i * 4); }
    } else {
      const k = tr.getValueSize(), err = Array.from({ length: k }, (_, j) => v[(n - 1) * k + j] - v[j]);
      for (let i = 1; i < n; i++) { const f = (tr.times[i] - tr.times[0]) / d; for (let j = 0; j < k; j++) v[i * k + j] -= err[j] * f; }
    }
  }
}
// The hips of a trimmed clip start where the AI's root motion had carried them by the trim's start (a run cut at
// 0.4 s starts ~1.5 m ahead): take the horizontal offset of the first key from the rest pose out of every key, so the
// body runs on its champion's spot. The height (the bob) stays. "Up" is the world up in the pelvis's parent frame.
function recenter(clip, src) {
  const pt = clip.tracks.find(t => t.name === 'pelvis.position'); if (!pt || !src.bones) return;
  const i = src.bones.findIndex(b => /^mixamorig\d*[:_]?hips$/i.test(b.name) || b.name === 'pelvis'); if (i < 0) return;
  const sk = buildSkeleton(src.bones), hips = sk.nodes[i], parentQ = hips.parent.getWorldQuaternion(new THREE.Quaternion());
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(parentQ.invert());
  const d = new THREE.Vector3().fromArray(pt.values, 0).sub(hips.position); d.addScaledVector(up, -d.dot(up));
  for (let k = 0; k < pt.values.length; k += 3) { pt.values[k] -= d.x; pt.values[k + 1] -= d.y; pt.values[k + 2] -= d.z; }
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
  SOURCE = { root: sk.root, rest: restOf(sk.root), key: 'attacks', nodes: sk.nodes, sig: sigOf(d.bones), bones: d.bones, probe }; PROBE = probe;
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

// ------------------------------------------------------------------ animation manifest (remodel)
// assets/models/anims/manifest.json (format: docs/remodel/05-animations.md §7):
//   clips:    id → { file, src, trim: [a, b] | null, layer: 'full'|'upper'|'lower'|'additive', loop, markers, speed,
//               optional hand ('r'/'l'), grip, offL, stride, ikL, keepTurn, measured }
//   sets:     'class:spec' (or 'class') → set;  attacks: set → [ids] (or [[right ids], [left ids]]);  idle: set → id
//   abilities: ability id → clip id / { cast: [ids], release: id };  fallback: id (or 'pattern_*') → id | [ids]
//   files:    set file → false while it isn't produced (not fetched: no 404 in the console)
// Set files are made by tools/anim-extract.mjs --set <set>. A set file that is missing, or a clip missing in it,
// leaves that clip unloaded: resolveClip() then follows `fallback` to today's clips.
const MANIFEST_FILE = 'assets/models/anims/manifest.json';
const LAYERS = ['full', 'upper', 'lower', 'additive'];
const TABLES = ['clips', 'sets', 'attacks', 'idle', 'abilities', 'fallback', 'files'];
export const MANIFEST = Object.fromEntries(TABLES.map(k => [k, {}])); // the parsed manifest (empty tables until loaded / when missing)
export const MANIFEST_CLIPS = {}; // id → THREE.AnimationClip (UAL bone names, heading steadied, trimmed); userData = clipMeta(id) + { src: 'tripo' }
export const MANIFEST_RAW = {};   // id → the same motion untrimmed (for checking a trim / measuring a marker)
const META = {};                  // id → clipMeta (every manifest clip, loaded or not)
const SOURCES = [];               // the animation skeletons the set files were made on ({ key, root, rest, nodes, sig, bones })
const CLIP_SRC = {};              // id → its source
let manifestP = null;

// a skeleton's identity: bone names, hierarchy and rest pose (sets made on the same master share one source)
function sigOf(bones) { return bones.map(b => b.name + '>' + b.parent + '@' + b.t.join(',') + '/' + b.r.join(',')).join('|'); }
function sourceFor(bones, file) {
  const sig = sigOf(bones);
  if (SOURCE && SOURCE.sig === sig) return SOURCE; // the attacks.json skeleton (K12 guard): heroes.js has analysed it already
  let s = SOURCES.find(x => x.sig === sig);
  if (!s) { const sk = buildSkeleton(bones); s = { key: 'set:' + file, root: sk.root, nodes: sk.nodes, rest: restOf(sk.root), sig, bones }; SOURCES.push(s); }
  return s;
}
function metaOf(id, e) {
  const markers = { ...(e.markers || {}) };
  return {
    id, file: e.file || null, src: e.src || id, trim: Array.isArray(e.trim) ? [+e.trim[0], +e.trim[1]] : null,
    layer: LAYERS.includes(e.layer) ? e.layer : 'full', loop: !!e.loop, markers, speed: e.speed ?? 1,
    impact: markers.strike ?? markers.release ?? null, // s into the trimmed clip at which the blow lands / the spell leaves
    hand: e.hand || 'r', grip: e.grip ?? null, offL: !!e.offL, stride: e.stride ?? null, ikL: e.ikL ?? null,
    keepTurn: e.keepTurn ?? 0.25, measured: e.measured !== false, loaded: false, from: 0, to: null, source: null,
    inPlace: e.inPlace ?? true, // the pelvis ends where it started (the sim moves the champion; loops: every track closes)
  };
}
function buildClip(id, c, src) {
  const m = META[id];
  // markers carried in the set file (anim-extract map meta) are defaults; the manifest wins
  if (c.meta?.markers) { m.markers = { ...c.meta.markers, ...m.markers }; m.impact = m.markers.strike ?? m.markers.release ?? null; }
  const raw = toClip(c, src.nodes); raw.name = id;
  steadyHeading(raw, src, m.keepTurn);
  let a = 0, b = raw.duration;
  if (m.trim) {
    a = Math.max(0, m.trim[0]); b = Math.min(raw.duration, m.trim[1]);
    if (!(b > a)) { console.warn('manifest: bad trim for', id, m.trim, '(clip is', raw.duration.toFixed(2), 's) — using the whole clip'); a = 0; b = raw.duration; }
  }
  const clip = a > 0 || b < raw.duration ? trim(raw, a, b) : raw.clone(); clip.name = id;
  if (m.loop) closeLoop(clip); else if (m.inPlace) closeLoop(clip, /^pelvis\.position$/);
  if (m.inPlace) recenter(clip, src);
  Object.assign(m, { loaded: true, from: a, to: b, source: src.key });
  clip.userData = { ...m, clip: m.src, src: 'tripo' }; // src: 'tripo' like ANIM_CLIPS (clip: its name in the set file)
  MANIFEST_CLIPS[id] = clip; MANIFEST_RAW[id] = raw; CLIP_SRC[id] = src;
}
const fetchJSON = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);

// Load the manifest and every set file it uses that exists. Never throws: whatever is missing falls back.
// `url` / `data` are for tests (another manifest file, or a manifest object; set files are read next to `url`).
export function loadManifest(url = MANIFEST_FILE, data = null) {
  if (url === MANIFEST_FILE && !data) return manifestP || (manifestP = readManifest(url, null));
  return readManifest(url, data);
}
async function readManifest(url, data) {
  try {
    const m = data || await fetchJSON(url);
    if (!m || typeof m !== 'object') return MANIFEST;
    for (const o of [MANIFEST, META, MANIFEST_CLIPS, MANIFEST_RAW, CLIP_SRC]) for (const k of Object.keys(o)) delete o[k];
    Object.assign(MANIFEST, m); // version, _doc …
    for (const k of TABLES) MANIFEST[k] = m[k] && typeof m[k] === 'object' ? m[k] : {};
    for (const [id, e] of Object.entries(MANIFEST.clips)) META[id] = metaOf(id, e || {});
    const dir = url.slice(0, url.lastIndexOf('/') + 1);
    const files = [...new Set(Object.values(MANIFEST.clips).map(e => e && e.file).filter(f => f && MANIFEST.files[f] !== false))];
    const sets = await Promise.all(files.map(f => fetchJSON(dir + f).then(d => [f, d])));
    for (const [f, d] of sets) {
      if (!d?.bones?.length || !d.clips?.length) continue; // missing / empty: its clips use the fallback
      const src = sourceFor(d.bones, f), byName = new Map();
      for (const c of d.clips) if (!byName.has(c.name)) byName.set(c.name, c);
      for (const [id, e] of Object.entries(MANIFEST.clips)) {
        if (!e || e.file !== f) continue;
        const c = byName.get(META[id].src); if (!c) continue;
        try { buildClip(id, c, src); } catch (err) { console.warn('manifest: clip', id, 'failed, using its fallback', err); }
      }
    }
  } catch (err) { console.warn('animation manifest failed, using the old clips', err); }
  return MANIFEST;
}

// clip id → { layer, loop, markers, impact, speed, trim, hand, grip, offL, stride, ikL, keepTurn, measured, loaded,
// from, to, source } (read-only), or null for an id that isn't in the manifest (a library / attacks.json clip)
export const clipMeta = id => META[id] || null;
// the skeleton a manifest clip was authored on ({ key, root, rest }); attacks.json clips → animSource()
export const clipSource = id => CLIP_SRC[id] || (ATTACK_ANIMS[id] ? SOURCE : null);

// stance set of a champion: setOf('warrior', 'protection'), setOf('paladin:protection'); no / unknown spec → the
// class's default spec (validSpec), then the bare class
function keysOf(cls, spec) {
  if (spec === undefined && typeof cls === 'string' && cls.includes(':')) [cls, spec] = cls.split(':');
  const s = validSpec(cls, spec);
  return s ? [cls + ':' + s, cls] : [cls];
}
export function setOf(cls, spec) { for (const k of keysOf(cls, spec)) if (MANIFEST.sets[k]) return MANIFEST.sets[k]; return null; }

const fallbackOf = id => {
  const F = MANIFEST.fallback;
  if (id in F) return F[id];
  for (const k of Object.keys(F)) if (k.includes('*') && new RegExp('^' + k.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(id)) return F[k];
  return null;
};
// The clip to play for `id`: the id itself once its manifest clip has loaded; else its fallback (followed through
// other manifest ids, an array tries each in turn) down to a clip that isn't in the manifest — a UAL library or
// attacks.json name, returned as it is (heroes.js knows it; pass has(name) to skip names it doesn't). null: nothing.
export function resolveClip(id, has = null, seen = new Set()) {
  if (!id || seen.has(id)) return null;
  seen.add(id);
  if (MANIFEST_CLIPS[id]) return id;
  if (!(id in MANIFEST.clips) && (!has || has(id))) return id;
  for (const c of [].concat(fallbackOf(id) ?? [])) { const r = resolveClip(c, has, seen); if (r) return r; }
  return null;
}
const anyLoaded = ids => ids.some(x => (Array.isArray(x) ? anyLoaded(x) : !!MANIFEST_CLIPS[x]));
const resolveAll = (ids, has) => ids.map(x => (Array.isArray(x) ? resolveAll(x, has) : resolveClip(x, has))).filter(x => (Array.isArray(x) ? x.length : x));
// Basic-attack clips of a champion's set, resolved (a list, or [[right], [left]] for dual wield). null while the
// champion has no set or none of the set's attack clips has loaded — heroes.js then keeps its own ACTIONS.attack
// list (today's look stays exactly as it is until the first clip of the set ships). opts.always: resolve anyway.
export function attacksFor(cls, spec, opts = {}) {
  const set = setOf(cls, spec), ids = set && MANIFEST.attacks[set];
  if (!Array.isArray(ids) || !ids.length || (!opts.always && !anyLoaded(ids))) return null;
  const out = resolveAll(ids, opts.has);
  return out.length ? out : null;
}
// Idle (stance) clip of a champion's set, resolved; null while it hasn't loaded (keep look.idle) unless opts.always.
export function idleFor(cls, spec, opts = {}) {
  const set = setOf(cls, spec), id = set && MANIFEST.idle[set];
  if (!id || (!opts.always && !MANIFEST_CLIPS[id])) return null;
  return resolveClip(id, opts.has);
}
// Production helper (05 §8.3): measure a loaded clip's strike on its source skeleton — the striking hand's peak
// "speed × reach" (or speed alone: metric 'speed') — in raw and trimmed time, next to the manifest's value.
export function measureStrike(id, win, metric) {
  const raw = MANIFEST_RAW[id], m = META[id], src = CLIP_SRC[id]; if (!raw || !m || !src) return null;
  src.probe = src.probe || buildSkeleton(src.bones);
  const { at, score } = measureImpact(raw, src.probe, m.hand, win, metric);
  return { id, raw: +at.toFixed(3), trimmed: +(at - m.from).toFixed(3), manifest: m.impact, score: +score.toFixed(2) };
}
