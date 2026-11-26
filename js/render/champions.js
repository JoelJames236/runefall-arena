// Generated champion models (Tripo Studio → retopology → auto-rig with the UE5 Mannequin skeleton).
//
// One GLB per spec replaces the code-assembled body (base outfit + race bake + code armor). Weapons,
// spec effects, animations and every gameplay hook stay in code: the UAL animation clips are
// retargeted onto each model's own rest pose.
//
// Bone mapping: UAL uses the UE4-style chain (spine_01..03, neck_01, Head); the UE5 Mannequin has
// spine_01..05, neck_01..02, head and twist / metacarpal bones. Source bones map by name, with
// spine_02 → spine_03 and spine_03 → spine_05; target bones without a source keep their rest pose.
//
// Retarget, per source bone s mapped to target bone t (rest world rotations Ws / Wt):
//   q_t = inv(Wt[parent(t)]) · Ws[parent(s)] · q_s · inv(Ws[s]) · Wt[t]
// Wt is first aligned (swing only) so each target bone points the same way as its source bone at
// rest, which makes an A-pose source and a T-pose target line up.
import * as THREE from 'three';

// spec key -> GLB (relative to assets/models/champions/). Missing / failed files fall back to the old champion.
export const CHAMPION_MODELS = {
  'warrior:protection': 'warrior_protection.glb',
  'warrior:arms': 'warrior_arms.glb',
  'berserker:fury': 'berserker_fury.glb',
  'berserker:executioner': 'berserker_executioner.glb',
  'paladin:crusader': 'paladin_crusader.glb',
  'paladin:protection': 'paladin_protection.glb',
  'mage:frost': 'mage_frost.glb',
  'mage:fire': 'mage_fire.glb',
  'rogue:subtlety': 'rogue_subtlety.glb',
  'rogue:assassination': 'rogue_assassination.glb',
  'priest:discipline': 'priest_discipline.glb',
  'priest:shadow': 'priest_shadow.glb',
  'shaman:elemental': 'shaman_elemental.glb',
  'shaman:enhancement': 'shaman_enhancement.glb',
  'hunter:beastmaster': 'hunter_beastmaster.glb',
  'hunter:sharpshooter': 'hunter_sharpshooter.glb',
  'necromancer:summoner': 'necromancer_summoner.glb',
  'necromancer:curser': 'necromancer_curser.glb',
  'druid:feral': 'druid_feral.glb',
  'druid:restoration': 'druid_restoration.glb',
  // pets on the same humanoid rig (UE5 Mannequin) and UAL clips
  gorilla: 'hunter_gorilla.glb', // Beastmaster's silverback gorilla
};
// Tripo normalises every model to the same height: races that should stand shorter / taller get a factor
// (applied on top of the class look's scale)
export const RACE_HEIGHT = { dwarf: 0.8 };
const DIR = 'assets/models/champions/';

const loaded = {};   // key -> { scene, clips, A, fit } once loaded, null if failed
const pending = {};

export const DISABLED = new Set(); // keys forced back to the code-built champion (viewer comparison)
export const championModel = key => (DISABLED.has(key) ? null : loaded[key] || null);

export function loadChampion(loader, key) {
  if (!key || !CHAMPION_MODELS[key]) return Promise.resolve(null);
  if (key in loaded) return Promise.resolve(loaded[key]);
  if (pending[key]) return pending[key];
  pending[key] = new Promise(res => loader.load(DIR + CHAMPION_MODELS[key], g => {
    loaded[key] = { scene: g.scene, clips: {} }; res(loaded[key]);
  }, undefined, err => { console.warn('champion model failed, using fallback:', key, err); loaded[key] = null; res(null); }));
  return pending[key];
}

// ------------------------------------------------------------------ rest-pose analysis
const lc = s => s.toLowerCase();
const parentBone = b => (b.parent && b.parent.isBone ? b.parent : null);
function bonesOf(root) { const m = {}; root.traverse(o => { if (o.isBone) m[lc(o.name)] = o; }); return m; }
function childFor(b, bones) {
  const n = lc(b.name);
  if (n.startsWith('hand_')) return bones['middle_01_' + n.slice(-1)] || null;
  if (n === 'pelvis') return bones.spine_01 || null;
  const kids = b.children.filter(c => c.isBone && !/leaf|twist|ik_/.test(lc(c.name)));
  return kids.find(c => /^(spine|neck|head)/.test(lc(c.name))) || kids[0] || null;
}
function restInfo(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const bones = bonesOf(root), R = {}, M = {}, P = {};
  for (const [n, b] of Object.entries(bones)) {
    const m = new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld);
    M[n] = m; P[n] = new THREE.Vector3().setFromMatrixPosition(m);
    m.decompose(new THREE.Vector3(), R[n] = new THREE.Quaternion(), new THREE.Vector3());
  }
  // frame of whatever holds each root bone (often an Armature node rotated for Z-up exports)
  const parentM = b => new THREE.Matrix4().multiplyMatrices(inv, b.parent.matrixWorld);
  return { bones, R, M, P, parentM };
}
const rotOf = m => { const q = new THREE.Quaternion(); m.decompose(new THREE.Vector3(), q, new THREE.Vector3()); return q; };

// source = a UAL-skinned body (the skeleton the clips were authored for), in its bind pose
let SRC = null;
export function setRetargetSource(sourceScene) { SRC = restInfo(sourceScene); }

const ALIAS = { spine_02: ['spine_03', 'spine_02'], spine_03: ['spine_05', 'spine_04', 'spine_03'] };
function targetOf(n, T) { for (const c of (ALIAS[n] || [n])) if (T.bones[c]) return c; return null; }

// analyse a champion body in its bind pose (frames are relative to the body: scale-free)
export function analyse(body) {
  const T = restInfo(body), S = SRC;
  const map = {}, rev = {};                       // source -> target, target -> source
  for (const n of Object.keys(S.bones)) { const t = targetOf(n, T); if (t && !rev[t]) { map[n] = t; rev[t] = n; } }
  // swing alignment of target bones onto source bone directions (parents first)
  const order = []; body.traverse(o => { if (o.isBone) order.push(lc(o.name)); });
  const align = {};
  for (const t of order) {
    const p = parentBone(T.bones[t]); let q = p && align[lc(p.name)] ? align[lc(p.name)].clone() : new THREE.Quaternion();    const s = rev[t];
    if (s && /spine|neck|clavicle|upperarm|lowerarm|hand|thigh|calf|foot/.test(s)) {
      const tc = childFor(T.bones[t], T.bones), sc = childFor(S.bones[s], S.bones);
      if (tc && sc) {
        const dt = T.P[lc(tc.name)].clone().sub(T.P[t]).normalize();
        const ds = S.P[lc(sc.name)].clone().sub(S.P[s]).normalize();
        q = new THREE.Quaternion().setFromUnitVectors(dt, ds);
      }
    }
    align[t] = q;
  }
  const Wt = {}; for (const t of order) Wt[t] = align[t].clone().multiply(T.R[t]);
  const pre = {}, post = {}, postT = {}, postTInv = {}, names = {};
  for (const [s, t] of Object.entries(map)) {
    const tp = parentBone(T.bones[t]), sp = parentBone(S.bones[s]);
    const WtP = tp ? Wt[lc(tp.name)] : rotOf(T.parentM(T.bones[t])), WsP = sp ? S.R[lc(sp.name)] : rotOf(S.parentM(S.bones[s]));
    pre[s] = WtP.clone().invert().multiply(WsP);
    post[s] = S.R[s].clone().invert().multiply(Wt[t]);
    postT[t] = post[s]; postTInv[t] = post[s].clone().invert();
    names[s] = T.bones[t].name;
  }
  // pelvis translation: scaled by leg length, expressed in the target pelvis parent's frame
  const sp = S.bones.pelvis && parentBone(S.bones.pelvis), tp = T.bones.pelvis && parentBone(T.bones.pelvis);
  const k = (T.P.pelvis && S.P.pelvis) ? Math.max(0.05, T.P.pelvis.y / Math.max(1e-4, S.P.pelvis.y)) : 1;
  const tParInv = (tp ? T.M[lc(tp.name)] : T.parentM(T.bones.pelvis)).clone().invert();
  return { map, rev, pre, post, postT, postTInv, names, k,
    sParM: sp ? S.M[lc(sp.name)] : S.parentM(S.bones.pelvis), tParRot: new THREE.Matrix3().setFromMatrix4(tParInv),
    sPelvisRest: S.P.pelvis ? S.P.pelvis.clone() : new THREE.Vector3(),
    tPelvisRestLocal: T.bones.pelvis ? T.bones.pelvis.position.clone() : new THREE.Vector3() };
}

// retarget one (cleaned) UAL clip onto an analysed body
export function retargetClip(clip, A) {
  const tracks = [], q = new THREE.Quaternion(), v = new THREE.Vector3();
  for (const tr of clip.tracks) {
    const dot = tr.name.lastIndexOf('.'), s = lc(tr.name.slice(0, dot)), prop = tr.name.slice(dot + 1);
    const tn = A.names[s]; if (!tn) continue;
    if (prop === 'quaternion') {
      const out = new Float32Array(tr.values.length);
      for (let i = 0; i < tr.values.length; i += 4) { q.fromArray(tr.values, i); q.premultiply(A.pre[s]).multiply(A.post[s]); q.toArray(out, i); }
      tracks.push(new THREE.QuaternionKeyframeTrack(tn + '.quaternion', tr.times, out));
    } else if (prop === 'position' && s === 'pelvis') {
      const out = new Float32Array(tr.values.length);
      for (let i = 0; i < tr.values.length; i += 3) {
        v.fromArray(tr.values, i).applyMatrix4(A.sParM).sub(A.sPelvisRest).multiplyScalar(A.k); // body-space offset from rest
        v.applyMatrix3(A.tParRot).add(A.tPelvisRestLocal).toArray(out, i);
      }
      tracks.push(new THREE.VectorKeyframeTrack(tn + '.position', tr.times, out));
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
