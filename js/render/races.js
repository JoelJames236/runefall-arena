// Races: real body proportions for the rigged champions.
//
// Every champion shares one humanoid rig (Quaternius Universal Base Characters). A race changes the
// rig's PROPORTIONS — limb length and thickness, chest width, neck, head size — and reshapes the
// face (jaw, brow, nose, muzzle, chin). Doing that with bone scale at runtime would shear the limbs
// as soon as a joint bends (three.js bones inherit non-uniform scale), so the change is BAKED into
// the bind pose instead:
//   1. each bone gets a "segment scale" S (x/z = thickness, y = length; bone axes run along +Y),
//   2. child joints move to p' = p ⊙ S_parent (rotations untouched, so every animation clip still fits),
//   3. every skinned vertex is re-skinned through D_b = W'_b · S_b · W_b⁻¹ (old rest → new rest, per
//      influencing bone, blended by its skin weights) and the head term also runs the face morph,
//   4. the bone inverses are rebuilt from the new rest pose.
// The skeleton stays rigid (unit scale), so animations deform the baked mesh without any shear.
// Baked geometry is cached per (source geometry, race, outfit) — champions of the same look share it.
import * as THREE from 'three';

// segment scales by bone name (side suffix _l/_r stripped). Missing = [1,1,1].
// face: morph strengths in normalised head space (see faceMorph). hunch: forward lean of the upper
// spine added every frame (rad). lift: extra body height compensation is computed automatically.
export const RACES = {
  human: { id: 'human', name: 'Human', bones: {}, face: null },
  elf: { id: 'elf', name: 'Sun Elf', // tall, slender, long neck, narrow refined face with a pointed chin
    bones: { spine_01: [0.9, 1.04, 0.9], spine_02: [0.9, 1.04, 0.9], spine_03: [0.92, 1.03, 0.9], clavicle: [1, 0.96, 1], neck_01: [0.86, 1.25, 0.86], Head: [0.95, 1.03, 0.97],
      upperarm: [0.84, 1.05, 0.84], lowerarm: [0.84, 1.05, 0.84], hand: [0.88, 1.06, 0.88], thigh: [0.86, 1.07, 0.86], calf: [0.86, 1.07, 0.86] },
    face: { chin: 0.28, narrow: 0.12, cheek: 0.05, brow: -0.01 } },
  orc: { id: 'orc', name: 'Orc', // massive shoulders and arms, bull neck, heavy jaw with an underbite, brutal brow
    bones: { spine_01: [1.14, 1, 1.12], spine_02: [1.2, 1, 1.15], spine_03: [1.24, 1.02, 1.15], clavicle: [1.15, 1.32, 1.15], neck_01: [1.5, 0.72, 1.45], Head: [1.07, 0.98, 1.06],
      upperarm: [1.32, 1.04, 1.32], lowerarm: [1.3, 1.04, 1.3], hand: [1.28, 1.1, 1.28], thigh: [1.2, 0.97, 1.2], calf: [1.16, 0.97, 1.16], foot: [1.15, 1.05, 1.15] },
    face: { jawWide: 0.3, jawFwd: 0.22, brow: 0.12, nose: -0.03, noseWide: 0.25 }, hunch: 0.14 },
  dwarf: { id: 'dwarf', name: 'Dwarf', // short and enormously stocky: short thick legs, barrel chest, big head and nose
    bones: { pelvis: [1.25, 1, 1.15], spine_01: [1.34, 0.9, 1.25], spine_02: [1.4, 0.9, 1.3], spine_03: [1.36, 0.92, 1.22], clavicle: [1.2, 1.18, 1.2], neck_01: [1.45, 0.55, 1.45], Head: [1.14, 1.06, 1.1],
      upperarm: [1.4, 0.84, 1.4], lowerarm: [1.38, 0.84, 1.38], hand: [1.3, 1.0, 1.3], thigh: [1.42, 0.7, 1.42], calf: [1.36, 0.7, 1.36], foot: [1.3, 1.0, 1.2] },
    face: { nose: 0.1, noseWide: 0.35, brow: 0.08, jawWide: 0.12 } },
  troll: { id: 'troll', name: 'Jungle Troll', // tall and rangy: long arms and legs, big hands, long jaw, hunched
    bones: { spine_01: [0.94, 1.05, 0.94], spine_02: [0.94, 1.05, 0.94], spine_03: [1.02, 1.04, 0.98], clavicle: [1, 1.12, 1], neck_01: [0.92, 1.1, 0.92], Head: [1.0, 1.02, 1.04],
      upperarm: [0.98, 1.14, 0.98], lowerarm: [0.96, 1.16, 0.96], hand: [1.22, 1.18, 1.22], thigh: [0.92, 1.06, 0.92], calf: [0.9, 1.08, 0.9], foot: [1.1, 1.15, 1.05] },
    face: { jawFwd: 0.2, chin: 0.12, nose: 0.12, brow: 0.06, narrow: 0.04 }, hunch: 0.24 },
  undead: { id: 'undead', name: 'Undead', // gaunt: wasted limbs, thin neck, sunken cheeks, slack jaw
    bones: { spine_01: [0.82, 1, 0.8], spine_02: [0.84, 1, 0.82], spine_03: [0.92, 1, 0.88], neck_01: [0.68, 1.06, 0.68], Head: [0.97, 1, 0.98],
      upperarm: [0.74, 1.02, 0.74], lowerarm: [0.72, 1.02, 0.72], hand: [0.86, 1.08, 0.86], thigh: [0.76, 1, 0.76], calf: [0.74, 1, 0.74] },
    face: { sunken: 0.22, chin: 0.1, narrow: 0.06 }, hunch: 0.16 },
  tauren: { id: 'tauren', name: 'Bull-folk', // huge: bull neck, massive arms and hands, the face drawn out into a muzzle
    bones: { spine_01: [1.25, 1.02, 1.22], spine_02: [1.3, 1.02, 1.26], spine_03: [1.3, 1.04, 1.22], clavicle: [1.2, 1.2, 1.2], neck_01: [1.65, 0.66, 1.55], Head: [1.18, 1.04, 1.18],
      upperarm: [1.36, 1.03, 1.36], lowerarm: [1.36, 1.03, 1.36], hand: [1.42, 1.1, 1.42], thigh: [1.28, 0.95, 1.28], calf: [1.22, 0.95, 1.22], foot: [1.25, 1.0, 1.2] },
    face: { muzzle: 0.5, noseWide: 0.4, jawWide: 0.2, brow: 0.08 }, hunch: 0.12 },
};
// class -> race (both specs of a class share the race; see docs/CLASSES_AND_SPECS.md)
export const RACE_OF = { mage: 'elf', rogue: 'human', warrior: 'orc', berserker: 'dwarf', paladin: 'human', priest: 'human', shaman: 'orc', hunter: 'troll', necromancer: 'undead', druid: 'tauren' };

const segS = (R, name) => { const s = R.bones[name] || R.bones[name.replace(/_[lr]$/, '')]; return s || null; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bump = (c, w, x) => Math.max(0, 1 - Math.abs(x - c) / w); // triangular bump

// Face morph in normalised head coordinates: U = 0 (neck) .. 1 (crown), F = -1 (back) .. 1 (nose tip),
// S = -1 .. 1 (side). Works on the head-local position; returns the displaced position.
function faceMorph(p, A, f, H) {
  const u = p.dot(A.up), fw = p.dot(A.fwd), sd = p.dot(A.side);
  const U = (u - H.u0) / (H.u1 - H.u0), F = (fw - H.fc) / (H.fr), S = sd / H.sr;
  let du = 0, df = 0, ds = 0;
  const front = smooth(-0.1, 0.6, F); // only the face side of the head
  if (f.jawWide) ds += sd * f.jawWide * bump(0.3, 0.28, U) * smooth(-0.4, 0.3, F);
  if (f.jawFwd) df += H.fr * f.jawFwd * bump(0.28, 0.2, U) * front;
  if (f.brow) df += H.fr * f.brow * bump(0.62, 0.08, U) * smooth(0.45, 0.85, F);
  if (f.nose) df += H.fr * f.nose * bump(0.5, 0.09, U) * smooth(0.65, 0.95, F) * (1 - Math.min(1, Math.abs(S) * 3));
  if (f.noseWide) ds += sd * f.noseWide * bump(0.48, 0.1, U) * smooth(0.6, 0.95, F) * (1 - Math.min(1, Math.abs(S) * 2.2));
  if (f.chin) { const k = smooth(0.42, 0.05, U) * front; du -= (H.u1 - H.u0) * f.chin * 0.25 * k; ds -= sd * f.chin * 0.6 * k; }
  if (f.narrow) ds -= sd * f.narrow * smooth(0.65, 0.2, U);
  if (f.cheek) ds += sd * f.cheek * bump(0.52, 0.1, U) * front;
  if (f.sunken) ds -= sd * f.sunken * bump(0.42, 0.12, U) * front * smooth(0.25, 0.6, Math.abs(S));
  if (f.muzzle) { const k = smooth(0.62, 0.3, U) * smooth(0.0, 0.7, F); df += H.fr * f.muzzle * k; du -= (H.u1 - H.u0) * 0.04 * k; }
  return p.clone().addScaledVector(A.up, du).addScaledVector(A.fwd, df).addScaledVector(A.side, ds);
}

const BAKED = new Map();   // geometry uuid|race|outfit -> baked geometry
const HEADBOX = new Map(); // geometry uuid -> head extents in head space

// ch: Character (body cloned, every skinned mesh attached, bones at the bind pose).
// Returns { lift } — how far the body must drop so the feet stay on the ground (shorter legs).
export function applyRace(ch, raceId, outfit) {
  const R = RACES[raceId];
  if (!R) return { lift: 0 }; // (humans are re-bound too: every mesh then shares the same rest inverses, see consolidate.js)
  const body = ch.body;
  body.updateMatrixWorld(true);
  const invBody = new THREE.Matrix4().copy(body.matrixWorld).invert();
  const rel = b => invBody.clone().multiply(b.matrixWorld);
  const bones = []; body.traverse(o => { if (o.isBone) bones.push(o); });
  const footY = () => { body.updateMatrixWorld(true); const b = ch.bones.ball_l || ch.bones.foot_l; return b ? rel(b).elements[13] : 0; };
  const foot0 = footY();
  const W = new Map(bones.map(b => [b, rel(b)]));
  // move the joints: a child sits at its offset scaled by its parent's segment scale
  for (const b of bones) { const s = b.parent && b.parent.isBone && segS(R, b.parent.name); if (s) b.position.multiply(new THREE.Vector3(...s)); }
  const foot1 = footY();
  const W2 = new Map(bones.map(b => [b, rel(b)]));
  // head axes (in head-local space at rest): up = bone axis, forward = the character's +Z
  const head = ch.bones.Head;
  const Ahead = (() => {
    const q = new THREE.Quaternion(); new THREE.Matrix4().extractRotation(W.get(head)).decompose(new THREE.Vector3(), q, new THREE.Vector3());
    const qi = q.clone().invert();
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(qi), up = new THREE.Vector3(0, 1, 0);
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    return { up, fwd, side: new THREE.Vector3().crossVectors(up, fwd).normalize() };
  })();

  // original bind inverses, captured before any skeleton is rebound (transplanted heads share arrays with their source)
  const INV0 = new Map(); body.traverse(o => { if (o.isSkinnedMesh && !INV0.has(o.skeleton)) INV0.set(o.skeleton, o.skeleton.boneInverses.slice()); });
  body.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const sk = o.skeleton, n = sk.bones.length, inv0 = INV0.get(sk);
    const key = o.geometry.uuid + '|' + R.id + '|' + outfit;
    // per-bone deformation D_b = W'_b * S_b * W_b^-1 (with W_b^-1 = this mesh's own bind inverse)
    const D = [], P = [], N = [];
    for (let j = 0; j < n; j++) {
      const b = sk.bones[j]; const s = segS(R, b.name);
      const Sm = new THREE.Matrix4().makeScale(...(s || [1, 1, 1]));
      P.push(inv0[j]); // world(bind) -> bone local
      const d = new THREE.Matrix4().multiplyMatrices(W2.get(b) || W.get(b), Sm).multiply(inv0[j]);
      D.push(d); N.push(new THREE.Matrix3().getNormalMatrix(d));
    }
    let geo = BAKED.get(key);
    if (!geo) {
      const g0 = o.geometry, pos = g0.attributes.position, nor = g0.attributes.normal, si = g0.attributes.skinIndex, sw = g0.attributes.skinWeight;
      geo = g0.clone();
      const B = o.bindMatrix, BI = new THREE.Matrix4().copy(B).invert(), BN = new THREE.Matrix3().getNormalMatrix(B), BIN = new THREE.Matrix3().getNormalMatrix(BI);
      const hj = sk.bones.indexOf(head);
      // head extents (for the face morph), measured on vertices mostly skinned to the head
      let H = null;
      if (R.face && hj >= 0) {
        H = HEADBOX.get(g0.uuid);
        if (!H) {
          let u0 = Infinity, u1 = -Infinity, f0 = Infinity, f1 = -Infinity, s1 = 0, cnt = 0; const v = new THREE.Vector3();
          for (let i = 0; i < pos.count; i++) {
            let w = 0; for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === hj) w += sw.getComponent(i, k);
            if (w < 0.9) continue;
            v.fromBufferAttribute(pos, i).applyMatrix4(B).applyMatrix4(P[hj]);
            const u = v.dot(Ahead.up), f = v.dot(Ahead.fwd), s = Math.abs(v.dot(Ahead.side));
            u0 = Math.min(u0, u); u1 = Math.max(u1, u); f0 = Math.min(f0, f); f1 = Math.max(f1, f); s1 = Math.max(s1, s); cnt++;
          }
          H = cnt > 50 ? { u0, u1, fc: (f0 + f1) / 2, fr: (f1 - f0) / 2, sr: s1 } : null;
          if (H) HEADBOX.set(g0.uuid, H);
        }
      }
      const v = new THREE.Vector3(), out = new THREE.Vector3(), t = new THREE.Vector3(), nv = new THREE.Vector3(), nout = new THREE.Vector3(), tn = new THREE.Vector3();
      const gp = geo.attributes.position, gn = geo.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(B);
        if (nor) nv.fromBufferAttribute(nor, i).applyMatrix3(BN);
        out.set(0, 0, 0); nout.set(0, 0, 0); let wsum = 0;
        for (let k = 0; k < 4; k++) {
          const w = sw.getComponent(i, k); if (w <= 0) continue;
          const j = si.getComponent(i, k); wsum += w;
          if (j === hj && H) { // face morph in head space, then the head's segment scale + new rest
            const lp = faceMorph(t.copy(v).applyMatrix4(P[j]), Ahead, R.face, H);
            const s = segS(R, 'Head') || [1, 1, 1];
            lp.multiply(t.set(...s)).applyMatrix4(W2.get(head));
            out.addScaledVector(lp, w);
          } else out.addScaledVector(t.copy(v).applyMatrix4(D[j]), w);
          if (nor) nout.addScaledVector(tn.copy(nv).applyMatrix3(N[j]), w);
        }
        if (wsum > 0) { out.multiplyScalar(1 / wsum); } else out.copy(v);
        out.applyMatrix4(BI); gp.setXYZ(i, out.x, out.y, out.z);
        if (nor) { nout.applyMatrix3(BIN).normalize(); gn.setXYZ(i, nout.x, nout.y, nout.z); }
      }
      if (geo.attributes.tangent) geo.deleteAttribute('tangent');
      geo.computeBoundingBox(); geo.computeBoundingSphere();
      BAKED.set(key, geo);
    }
    o.geometry = geo;
    // new bind: the rest pose of the reshaped skeleton
    sk.boneInverses = sk.bones.map(b => (W2.get(b) || W.get(b)).clone().invert());
    sk.boneMatrices && sk.update();
  });
  return { lift: (foot1 - foot0) };
}
