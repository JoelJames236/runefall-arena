// Put a generated item into grip space (docs/remodel/03-weapons-and-sockets.md §4): origin = the fist's grip,
// +Y = toward the tip / the shield's top, +X = the leading edge (swords) / along the handle (shields),
// +Z = X × Y (swords) / the shield's face. Scaled to the blueprint size in metres. Named empty nodes mark the
// weapon tip, trail base and effect core.
//
//   node tools/item-prep.mjs <raw.glb> <out.glb> --kind sword|shield --size <metres> [--flipz] [--flipy]
//
// sword : longest axis = the blade; the widest slice is the crossguard, the longer side of it the blade; the grip
//         centre sits 6 cm below the guard. size = overall length.
// shield: thinnest axis = the face normal (the convex side is the front), the wider end is the top; the origin is
//         behind the centre, 35 mm off the back. size = height.
import { readGlb, readAccessor, worldMatrices, xform, xdir, sub, scl, dot, cross, norm, pca, GlbWriter } from './glb-lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [inp, out] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--flipz', '--flipy'].includes(args[i - 1])));
const KIND = opt('--kind', 'sword'), SIZE = Number(opt('--size', 1)), FLIPZ = args.includes('--flipz'), FLIPY = args.includes('--flipy');
const G = readGlb(inp), J = G.json, { W } = worldMatrices(J);

// all primitives of all mesh nodes, in scene space
const pos = [], nrm = [], uv = [], idx = []; let material = null;
J.nodes.forEach((n, ni) => {
  if (n.mesh === undefined) return;
  for (const p of J.meshes[n.mesh].primitives) {
    const P = readAccessor(G, p.attributes.POSITION), N = p.attributes.NORMAL !== undefined ? readAccessor(G, p.attributes.NORMAL) : null;
    const T = p.attributes.TEXCOORD_0 !== undefined ? readAccessor(G, p.attributes.TEXCOORD_0) : null, base = pos.length;
    for (let k = 0; k < P.length / 3; k++) {
      pos.push(xform(W[ni], [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]));
      nrm.push(N ? norm(xdir(W[ni], [N[k * 3], N[k * 3 + 1], N[k * 3 + 2]])) : [0, 1, 0]);
      uv.push(T ? [T[k * 2], T[k * 2 + 1]] : [0, 0]);
    }
    const I = p.indices !== undefined ? readAccessor(G, p.indices) : Array.from({ length: P.length / 3 }, (_, k) => k);
    for (const i of I) idx.push(base + i);
    if (material === null && p.material !== undefined) material = p.material;
  }
});
const { centroid, axes } = pca(pos);
const proj = (p, a) => dot(sub(p, centroid), a);
const pct = (arr, q) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))]; };

let X, Y, Z, origin, k, empties = {};
if (KIND === 'sword') {
  const A = axes[0], B = axes[1];
  const t = pos.map(p => proj(p, A)), lo = Math.min(...t), hi = Math.max(...t), bins = 60, width = new Array(bins).fill(0);
  const wmin = new Array(bins).fill(Infinity), wmax = new Array(bins).fill(-Infinity);
  pos.forEach((p, i) => { const b = Math.min(bins - 1, Math.floor((t[i] - lo) / (hi - lo) * bins)); const w = proj(p, B); wmin[b] = Math.min(wmin[b], w); wmax[b] = Math.max(wmax[b], w); });
  for (let b = 0; b < bins; b++) width[b] = wmax[b] > wmin[b] ? wmax[b] - wmin[b] : 0;
  let g = 0; for (let b = 0; b < bins; b++) if (width[b] > width[g]) g = b;          // the crossguard
  const guardT = lo + (g + 0.5) / bins * (hi - lo);
  const bladeUp = (hi - guardT) > (guardT - lo);                                      // the blade is the longer side
  Y = scl(A, (bladeUp ? 1 : -1) * (FLIPY ? -1 : 1)); X = B; Z = norm(cross(X, Y));
  k = SIZE / (hi - lo);
  const guardP = scl(Y, (bladeUp ? 1 : -1) * guardT);
  // grip centre: 6 cm below the guard, on the handle's own axis (mean of the handle slice)
  const handle = pos.filter((p, i) => { const d = (t[i] - guardT) * (bladeUp ? 1 : -1); return d < -0.02 / k && d > -0.12 / k; });
  const hc = handle.length ? scl(handle.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]), 1 / handle.length) : centroid;
  origin = [hc[0], hc[1], hc[2]];
  const gy = dot(sub(scl(A, guardT), sub(origin, centroid)), Y); // guard height above the grip, in file units
  const oy = dot(sub(origin, centroid), Y), guardY = (guardT * (bladeUp ? 1 : -1)) - oy;
  const shift = guardY - 0.06 / k;                                                     // put the guard 6 cm above the origin
  origin = [origin[0] + Y[0] * shift, origin[1] + Y[1] * shift, origin[2] + Y[2] * shift];
  const tipY = (bladeUp ? hi : -lo) - (oy + shift), endY = (bladeUp ? lo : -hi) - (oy + shift);
  empties = { tip: [0, tipY * k, 0], trail_base: [0, 0.06, 0], fx_core: [0, 0.06, 0], pommel: [0, endY * k, 0] };
  void gy; void guardP;
} else if (KIND === 'shield') {
  const Zc = axes[2], Yc = axes[0];
  const t = pos.map(p => proj(p, Yc)), lo = Math.min(...t), hi = Math.max(...t), xb = axes[1];
  const widthAt = (a, b) => { const w = pos.filter((p, i) => t[i] >= a && t[i] <= b).map(p => proj(p, xb)); return w.length ? Math.max(...w) - Math.min(...w) : 0; };
  const span = hi - lo, topWider = widthAt(hi - 0.15 * span, hi) >= widthAt(lo, lo + 0.15 * span);
  Y = scl(Yc, (topWider ? 1 : -1) * (FLIPY ? -1 : 1));
  // front = the convex side: the centre of the face stands out further than the rim
  const r = pos.map(p => Math.hypot(proj(p, xb), proj(p, Yc))), rmax = Math.max(...r), z = pos.map(p => proj(p, Zc));
  const centre = z.filter((_, i) => r[i] < 0.25 * rmax), rim = z.filter((_, i) => r[i] > 0.8 * rmax);
  const avg = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const frontSign = (pct(centre, 0.9) - avg(rim)) >= 0 ? 1 : -1;
  Z = scl(Zc, frontSign * (FLIPZ ? -1 : 1)); X = norm(cross(Y, Z)); Y = norm(cross(Z, X));
  k = SIZE / span;
  const zz = pos.map(p => dot(sub(p, centroid), Z)), back = pct(zz, 0.02), front = pct(zz, 0.98);
  const yMid = (lo + hi) / 2 * (topWider ? 1 : -1);
  origin = [centroid[0] + Y[0] * yMid + Z[0] * (back - 0.035 / k), centroid[1] + Y[1] * yMid + Z[1] * (back - 0.035 / k), centroid[2] + Y[2] * yMid + Z[2] * (back - 0.035 / k)];
  empties = { fx_core: [0, 0, (front - back) * k + 0.035], rim_top: [0, span / 2 * k, 0.035] };
} else throw new Error('unknown --kind ' + KIND);

// transform into grip space (metres)
const P2 = new Float32Array(pos.length * 3), N2 = new Float32Array(pos.length * 3), T2 = new Float32Array(pos.length * 2);
pos.forEach((p, i) => { const d = sub(p, origin); P2.set([dot(d, X) * k, dot(d, Y) * k, dot(d, Z) * k], i * 3); const n = nrm[i]; N2.set(norm([dot(n, X), dot(n, Y), dot(n, Z)]), i * 3); T2.set(uv[i], i * 2); });
const I2 = new Uint32Array(idx);

// output GLB: one mesh, the source material and its images, plus the empties
const mat = material !== null ? JSON.parse(JSON.stringify(J.materials[material])) : { pbrMetallicRoughness: { baseColorFactor: [0.7, 0.7, 0.7, 1] } };
const out_ = { asset: { version: '2.0', generator: 'runefall item-prep', extras: { item: { kind: KIND, size: SIZE } } }, scene: 0, scenes: [{ nodes: [0] }], nodes: [], meshes: [], materials: [mat], samplers: J.samplers || [{}], textures: [], images: [] };
const Wr = new GlbWriter(out_);
const texMap = new Map();
const copyTex = ti => {
  if (texMap.has(ti)) return texMap.get(ti);
  const tx = J.textures[ti], im = J.images[tx.source], bv = J.bufferViews[im.bufferView];
  const bytes = G.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  out_.images.push({ mimeType: im.mimeType, bufferView: Wr.view(bytes), name: im.name }); out_.textures.push({ source: out_.images.length - 1, sampler: tx.sampler ?? 0 });
  texMap.set(ti, out_.textures.length - 1); return out_.textures.length - 1;
};
const pb = mat.pbrMetallicRoughness || {};
if (pb.baseColorTexture) pb.baseColorTexture = { index: copyTex(pb.baseColorTexture.index) };
if (pb.metallicRoughnessTexture) pb.metallicRoughnessTexture = { index: copyTex(pb.metallicRoughnessTexture.index) };
if (mat.normalTexture) mat.normalTexture = { index: copyTex(mat.normalTexture.index) };
if (mat.emissiveTexture) mat.emissiveTexture = { index: copyTex(mat.emissiveTexture.index) };
delete mat.extensions;
const prim = { attributes: { POSITION: Wr.accessor(P2, 'VEC3', 5126, { minmax: true, target: 34962 }), NORMAL: Wr.accessor(N2, 'VEC3', 5126, { target: 34962 }), TEXCOORD_0: Wr.accessor(T2, 'VEC2', 5126, { target: 34962 }) }, indices: Wr.accessor(I2, 'SCALAR', 5125, { target: 34963 }), material: 0 };
out_.meshes.push({ name: 'item', primitives: [prim] });
out_.nodes.push({ name: 'item', mesh: 0, children: [] });
for (const [name, p] of Object.entries(empties)) { out_.nodes.push({ name, translation: p.map(v => +v.toFixed(5)) }); out_.nodes[0].children.push(out_.nodes.length - 1); }
const bytes = Wr.write(out);
let ymin = Infinity, ymax = -Infinity, xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
for (let i = 0; i < P2.length; i += 3) { xmin = Math.min(xmin, P2[i]); xmax = Math.max(xmax, P2[i]); ymin = Math.min(ymin, P2[i + 1]); ymax = Math.max(ymax, P2[i + 1]); zmin = Math.min(zmin, P2[i + 2]); zmax = Math.max(zmax, P2[i + 2]); }
console.log(out, KIND, (I2.length / 3) + ' tris', 'x', xmin.toFixed(2), xmax.toFixed(2), 'y', ymin.toFixed(2), ymax.toFixed(2), 'z', zmin.toFixed(2), zmax.toFixed(2), JSON.stringify(empties), (bytes / 1024).toFixed(0) + ' kB');
