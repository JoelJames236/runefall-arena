// Reduce an item GLB (tools/item-prep.mjs output: one mesh, POSITION / NORMAL / TEXCOORD_0, the empties) to a
// triangle budget (docs/remodel/03-weapons-and-sockets.md §7) when Tripo's retopology stops above it.
//   node tools/item-simplify.mjs <item.glb> <out.glb> --tris 900
// Half-edge collapses ordered by quadric error (Garland–Heckbert) on the position-welded mesh (Tripo meshes split
// vertices at every hard normal and cut the UVs into small islands, so the topology is welded by position first):
// a welded vertex moves onto a neighbour's position. Every moved corner keeps its own normal and gets the UV its own
// triangle's texture mapping gives at the new position, so the texture inside each triangle does not shift. Vertices
// on an open edge (the outline) are locked. A collapse that flips or squashes a neighbouring triangle is skipped.
import { readGlb, readAccessor, sub, cross, dot, norm, GlbWriter } from './glb-lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [inp, out] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const TARGET = Number(opt('--tris', 900));
if (!inp || !out || !(TARGET > 0)) { console.error('usage: node tools/item-simplify.mjs <item.glb> <out.glb> --tris 900'); process.exit(2); }

const G = readGlb(inp), J = G.json;
const mi = J.nodes.findIndex(n => n.mesh !== undefined), prim = J.meshes[J.nodes[mi].mesh].primitives[0];
const P = readAccessor(G, prim.attributes.POSITION), N = readAccessor(G, prim.attributes.NORMAL), T = readAccessor(G, prim.attributes.TEXCOORD_0);
const I = Array.from(readAccessor(G, prim.indices));
const PA = Array.from(P), NA = Array.from(N), TA = Array.from(T); // grow: moved corners become new vertices
let nv = P.length / 3; const vpos = k => [PA[k * 3], PA[k * 3 + 1], PA[k * 3 + 2]], vnrm = k => [NA[k * 3], NA[k * 3 + 1], NA[k * 3 + 2]];
let tris = []; for (let t = 0; t < I.length; t += 3) tris.push([I[t], I[t + 1], I[t + 2]]);
const start = tris.length;

// weld by position: group of every vertex, the copies of every group
const grp = [], key = new Map(), copies = [];
for (let v = 0; v < nv; v++) {
  const k = vpos(v).map(x => Math.round(x * 1e5)).join(',');
  let g = key.get(k); if (g === undefined) { g = copies.length; key.set(k, g); copies.push([]); }
  grp[v] = g; copies[g].push(v);
}
const ng = copies.length, gpos = g => vpos(copies[g][0]);
const locked = new Uint8Array(ng);
const ek = (a, b) => (a < b ? a * ng + b : b * ng + a), edgeCount = new Map();
for (const t of tris) { const [a, b, c] = t.map(v => grp[v]); for (const [u, v] of [[a, b], [b, c], [c, a]]) edgeCount.set(ek(u, v), (edgeCount.get(ek(u, v)) || 0) + 1); }
for (const [k, n] of edgeCount) if (n === 1) { locked[Math.floor(k / ng)] = 1; locked[k % ng] = 1; }
const lockedCount = locked.reduce((s, x) => s + x, 0);

// quadrics per group (the symmetric 4×4 as 10 floats), area-weighted plane of every triangle
const Q = new Float64Array(ng * 10);
const addPlane = (o, [a, b, c, d], w) => { Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d; Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d; Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d; };
for (const t of tris) {
  const [a, b, c] = t.map(vpos), n = cross(sub(b, a), sub(c, a)), area = Math.hypot(...n) / 2; if (!(area > 0)) continue;
  const u = norm(n), pl = [...u, -dot(u, a)];
  for (const v of t) addPlane(grp[v] * 10, pl, area);
}
const err = (u, v, x) => { const q = i => Q[u * 10 + i] + Q[v * 10 + i], [X, Y, Z] = x; return q(0) * X * X + 2 * q(1) * X * Y + 2 * q(2) * X * Z + 2 * q(3) * X + q(4) * Y * Y + 2 * q(5) * Y * Z + 2 * q(6) * Y + q(7) * Z * Z + 2 * q(8) * Z + q(9); };
const triN = t => { const [a, b, c] = t.map(vpos); return cross(sub(b, a), sub(c, a)); };

let pass = 0;
while (tris.length > TARGET && pass < 80) {
  pass++;
  const around = Array.from({ length: ng }, () => []); tris.forEach((t, i) => { for (const v of t) { const g = grp[v]; if (around[g][around[g].length - 1] !== i) around[g].push(i); } });
  const cand = [], seen = new Set();
  for (const t of tris) { const [a, b, c] = t.map(v => grp[v]); for (const [u, v] of [[a, b], [b, c], [c, a]]) {
    const k = ek(u, v); if (u === v || seen.has(k)) continue; seen.add(k);
    if (!locked[v]) cand.push([err(u, v, gpos(u)), v, u]); // group v moves onto u
    if (!locked[u]) cand.push([err(u, v, gpos(v)), u, v]);
  } }
  if (!cand.length) break;
  cand.sort((x, y) => x[0] - y[0]);
  const touched = new Uint8Array(ng); let removed = 0, done = 0;
  for (const [, gf, gt] of cand) {
    if (tris.length - removed <= TARGET) break;
    if (touched[gf] || touched[gt]) continue;
    const has = (t, g) => t.some(v => grp[v] === g);
    // copies of gt in the triangles that vanish (they share the edge): the moved corners' chart
    const keep = new Set(); let ok = true, gone = 0;
    for (const ti of around[gf]) { const t = tris[ti]; if (t && has(t, gt)) { gone++; for (const v of t) if (grp[v] === gt) keep.add(v); } }
    if (!gone) continue;
    // the moved corner: at gt's position, its own normal, the UV of its triangle's (affine) mapping at that point
    const x = gpos(gt), plan = [];
    const moved = (t, j) => {
      const [a, b, c] = t, e1 = sub(vpos(b), vpos(a)), e2 = sub(vpos(c), vpos(a)), d = sub(x, vpos(a));
      const d11 = dot(e1, e1), d12 = dot(e1, e2), d22 = dot(e2, e2), den = d11 * d22 - d12 * d12;
      const s1 = den ? (d22 * dot(d, e1) - d12 * dot(d, e2)) / den : 0, s2 = den ? (d11 * dot(d, e2) - d12 * dot(d, e1)) / den : 0;
      const uv = k => [TA[k * 2], TA[k * 2 + 1]], [ua, ub, uc] = [uv(a), uv(b), uv(c)];
      return { p: x, n: vnrm(t[j]), t: [ua[0] + s1 * (ub[0] - ua[0]) + s2 * (uc[0] - ua[0]), ua[1] + s1 * (ub[1] - ua[1]) + s2 * (uc[1] - ua[1])] };
    };
    for (const ti of around[gf]) {
      const t = tris[ti]; if (!t || has(t, gt)) continue;
      const j = t.findIndex(v => grp[v] === gf), nvx = moved(t, j);
      const n0 = triN(t), pb = t.map(v => vpos(v)); pb[j] = nvx.p;
      const n1 = cross(sub(pb[1], pb[0]), sub(pb[2], pb[0])), l0 = Math.hypot(...n0), l1 = Math.hypot(...n1);
      if (l1 < l0 * 0.05 || dot(n0, n1) < 0.3 * l0 * l1) { ok = false; break; }
      plan.push([ti, j, nvx]);
    }
    if (!ok) continue;
    for (const ti of around[gf]) { const t = tris[ti]; if (t && has(t, gt)) { tris[ti] = null; removed++; } }
    for (const [ti, j, v] of plan) { PA.push(...v.p); NA.push(...v.n); TA.push(...v.t); grp.push(gt); copies[gt].push(nv); tris[ti][j] = nv; nv++; }
    for (let i = 0; i < 10; i++) Q[gt * 10 + i] += Q[gf * 10 + i];
    for (const ti of around[gf]) { const t = tris[ti]; if (t) for (const v of t) touched[grp[v]] = 1; }
    touched[gf] = touched[gt] = 1; done++;
  }
  tris = tris.filter(Boolean);
  if (!done) break;
}

// compact and write (same material, images and empties)
const used = new Int32Array(nv).fill(-1); let m = 0; /* nv grew with the moved corners */ for (const t of tris) for (const v of t) if (used[v] < 0) used[v] = m++;
const P2 = new Float32Array(m * 3), N2 = new Float32Array(m * 3), T2 = new Float32Array(m * 2);
for (let v = 0; v < nv; v++) { const k = used[v]; if (k < 0) continue; P2.set(PA.slice(v * 3, v * 3 + 3), k * 3); N2.set(NA.slice(v * 3, v * 3 + 3), k * 3); T2.set(TA.slice(v * 2, v * 2 + 2), k * 2); }
const I2 = new Uint32Array(tris.length * 3); tris.forEach((t, i) => t.forEach((v, j) => { I2[i * 3 + j] = used[v]; }));
const o = JSON.parse(JSON.stringify(J)), images = (J.images || []).map(im => { const bv = J.bufferViews[im.bufferView]; return G.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength); });
const Wr = new GlbWriter(o);
(o.images || []).forEach((im, i) => { im.bufferView = Wr.view(images[i]); });
const p2 = o.meshes[o.nodes[mi].mesh].primitives[0];
p2.attributes = { POSITION: Wr.accessor(P2, 'VEC3', 5126, { minmax: true, target: 34962 }), NORMAL: Wr.accessor(N2, 'VEC3', 5126, { target: 34962 }), TEXCOORD_0: Wr.accessor(T2, 'VEC2', 5126, { target: 34962 }) };
p2.indices = Wr.accessor(I2, 'SCALAR', 5125, { target: 34963 });
o.asset.generator = (o.asset.generator || '') + ' + item-simplify';
const bytes = Wr.write(out);
console.log(out.split(/[\\/]/).pop(), start, '->', tris.length, 'tris | vertices', nv, '->', m, '| welded', ng, 'locked', lockedCount, '| passes', pass, '|', (bytes / 1024).toFixed(0), 'kB');
