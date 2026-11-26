// Draw-call consolidation for rigged champions.
//
// A geared champion is made of ~10 skinned body / outfit / head / hair meshes plus dozens of rigid
// armor pieces hanging off bones. After races.js re-binds every skinned mesh to the rest pose, all of
// them share the same bone inverses, so we can fold the whole champion into ONE skinned mesh per
// material: skinned pieces keep their weights (indices remapped to one shared skeleton), rigid armor
// becomes single-bone skinned geometry. Capes, tabards, orbiting motes and weapons stay separate
// (they animate on their own). Typically 50+ draws per champion become ~12 (and the same in the
// shadow pass).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KEEP = new Set(['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight']);
function clean(g) {
  for (const n of Object.keys(g.attributes)) if (!KEEP.has(n)) g.deleteAttribute(n);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const c = g.attributes.color; // vertex colours (the CC0 outfits use them): float RGB so every piece matches
  if (c && (c.itemSize !== 3 || c.normalized || !(c.array instanceof Float32Array))) { const a = new Float32Array(c.count * 3); for (let i = 0; i < c.count; i++) { a[i * 3] = c.getX(i); a[i * 3 + 1] = c.getY(i); a[i * 3 + 2] = c.getZ(i); } g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3)); }
  g.morphAttributes = {}; g.clearGroups();
  return g;
}

// swap the 2nd and 3rd vertex of every triangle (non-indexed geometry)
function flip(g) {
  for (const a of Object.values(g.attributes)) { const s = a.itemSize, arr = a.array; for (let t = 0; t < a.count; t += 3) for (let k = 0; k < s; k++) { const i1 = (t + 1) * s + k, i2 = (t + 2) * s + k, v = arr[i1]; arr[i1] = arr[i2]; arr[i2] = v; } }
}

// ch: Character (bones at any pose; skeleton inverses = rest pose). keep: objects that must stay as they are.
export function consolidate(ch, keep = new Set()) {
  const body = ch.body;
  body.updateMatrixWorld(true);
  // one shared skeleton: every bone, rest inverses taken from whichever skinned mesh knows it
  const bones = []; body.traverse(o => { if (o.isBone) bones.push(o); });
  const bIndex = new Map(bones.map((b, i) => [b, i]));
  const inv = new Array(bones.length).fill(null);
  const skinned = [];
  body.traverse(o => { if (o.isSkinnedMesh) { skinned.push(o); o.skeleton.bones.forEach((b, j) => { const i = bIndex.get(b); if (i !== undefined && !inv[i]) inv[i] = o.skeleton.boneInverses[j]; }); } });
  if (inv.some(m => !m)) { // bones no mesh is skinned to (e.g. leaf bones): derive their rest from the parent chain
    for (let i = 0; i < bones.length; i++) if (!inv[i]) { const p = bones[i].parent, pi = bIndex.get(p); const pw = pi !== undefined && inv[pi] ? inv[pi].clone().invert() : new THREE.Matrix4(); inv[i] = pw.multiply(new THREE.Matrix4().compose(bones[i].position, bones[i].quaternion, bones[i].scale)).invert(); }
  }
  const restW = inv.map(m => m.clone().invert()); // bone rest matrices in body space
  const buckets = new Map(); // material -> { geos, cast }
  const add = (mat, g, cast, src) => { if (!buckets.has(mat)) buckets.set(mat, { geos: [], cast: false, srcs: [] }); const b = buckets.get(mat); b.geos.push(g); b.srcs.push(src); b.cast = b.cast || cast; };
  const remove = [];
  // skinned pieces: into body space, indices remapped
  for (const m of skinned) {
    if (!m.visible || Array.isArray(m.material) || keep.has(m)) { if (!m.visible) remove.push(m); continue; }
    const g = clean(m.geometry.clone());
    g.applyMatrix4(m.bindMatrix);
    const si = g.attributes.skinIndex, map = m.skeleton.bones.map(b => bIndex.get(b) ?? 0);
    const out = new Uint16Array(si.count * 4); for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) out[i * 4 + k] = map[si.getComponent(i, k)];
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(out, 4));
    const sw0 = g.attributes.skinWeight, swo = new Float32Array(sw0.count * 4); for (let i = 0; i < sw0.count; i++) for (let k = 0; k < 4; k++) swo[i * 4 + k] = sw0.getComponent(i, k); // denormalised
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(swo, 4));
    add(m.material, g, m.castShadow, m);
  }
  // rigid armor anywhere under a bone (merged per bone by armory.js, plus mirrored / nested leftovers):
  // single-bone skinning. Objects flagged userData.noMerge (capes, tabards, orbiting motes, weapons,
  // halo) keep animating on their own.
  const rel = new THREE.Matrix4(), binv = new THREE.Matrix4();
  const rigid = [];
  const visit = (o, bone) => {
    if (o.userData.noMerge) return;
    if (o.isBone) bone = o;
    else if (o.isMesh && !o.isSkinnedMesh && bone && !Array.isArray(o.material) && o.visible) rigid.push([o, bone]);
    for (const c of o.children) visit(c, bone);
  };
  visit(body, null);
  for (const [o, bone] of rigid) {
    if (keep.has(o)) continue;
    const j = bIndex.get(bone);
    binv.copy(bone.matrixWorld).invert(); rel.multiplyMatrices(binv, o.matrixWorld);
    const det = rel.determinant(); if (Math.abs(det) < 1e-12) continue;
    const g = clean(o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
    g.applyMatrix4(rel.premultiply(restW[j]));
    if (det < 0) flip(g); // mirrored piece: restore the triangle winding
    const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = j; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    add(o.material, g, o.castShadow, o);
  }
  if (!buckets.size) return 0;
  const skel = new THREE.Skeleton(bones, inv);
  const ident = new THREE.Matrix4();
  let made = 0;
  for (const [mat, { geos, cast, srcs }] of buckets) {
    // indexed and non-indexed geometries can't merge together: give the non-indexed ones a trivial index
    for (const g of geos) if (!g.index) { const n = g.attributes.position.count, ix = n > 65535 ? new Uint32Array(n) : new Uint16Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); }
    const white = g => g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    if (geos.some(g => g.attributes.color) || mat.vertexColors) { for (const g of geos) if (!g.attributes.color) white(g); }
    const list = geos;
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!merged) continue; // incompatible pieces: leave the originals in place
    remove.push(...srcs);
    const sm = new THREE.SkinnedMesh(merged, mat);
    sm.name = 'champion'; sm.frustumCulled = false; sm.castShadow = cast; sm.receiveShadow = true;
    body.add(sm); sm.bind(skel, ident);
    made++;
  }
  for (const o of remove) o.removeFromParent();
  return made;
}
