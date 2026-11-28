// Mesh simplification shared by tools/item-simplify.mjs (items to their triangle budget) and
// tools/assemble-champion.mjs (LOD1 / LOD2 and the shadow proxy, docs/remodel/07-performance.md §5).
//
// Half-edge collapses ordered by quadric error (Garland–Heckbert) on the position-welded mesh (Tripo meshes split
// vertices at every hard normal and cut the UVs into small islands, so the topology is welded by position first):
// a welded vertex moves onto a neighbour's position. Every moved corner keeps its own normal and gets the UV its own
// triangle's texture mapping gives at the new position, so the texture inside each triangle does not shift; it takes
// the skin (joints + weights) of the vertex it moved onto, so it deforms with it. Vertices on an open edge (the
// outline) are locked; a collapse between differently skinned vertices costs more and is refused across a skin
// border (the vertices' weights differ by more than `skinBorder`), so joints keep their shape. A collapse that flips
// or squashes a neighbouring triangle is skipped.
//
//   simplify({ P, N, T, J?, W?, I }, targetTris, { skinBorder = 0.6, skinCost = 4, uvClamp?, lockNonManifold? }) →
//     { P, N, T, J, W, I, stats: { start, end, welded, locked, passes } }
// P / N: xyz per vertex, T: uv, J / W: 4 joints / 4 weights per vertex (optional), I: triangle indices.
// uvClamp(uv, triUVs) may move a re-derived UV back into its atlas tile (it gets [u, v] and the triangle's 3 UVs).
// lockNonManifold: also lock the vertices of edges shared by more than two triangles (Tripo item meshes have many;
// collapsing them deletes whole strips — a wand lost its shaft). Off by default (the champion LODs keep their result).
import { sub, cross, dot, norm } from './glb-lib.mjs';

export function simplify(mesh, TARGET, opts = {}) {
  const skinBorder = opts.skinBorder ?? 0.6, skinCost = opts.skinCost ?? 4, uvClamp = opts.uvClamp || null;
  const PA = Array.from(mesh.P), NA = Array.from(mesh.N), TA = Array.from(mesh.T);
  const skinned = !!(mesh.J && mesh.W), JA = skinned ? Array.from(mesh.J) : null, WA = skinned ? Array.from(mesh.W) : null;
  let nv = PA.length / 3;
  const vpos = k => [PA[k * 3], PA[k * 3 + 1], PA[k * 3 + 2]], vnrm = k => [NA[k * 3], NA[k * 3 + 1], NA[k * 3 + 2]];
  let tris = []; for (let t = 0; t < mesh.I.length; t += 3) tris.push([mesh.I[t], mesh.I[t + 1], mesh.I[t + 2]]);
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
  for (const [k, n] of edgeCount) if (n === 1 || (opts.lockNonManifold && n > 2)) { locked[Math.floor(k / ng)] = 1; locked[k % ng] = 1; }
  const lockedCount = locked.reduce((s, x) => s + x, 0);

  // skin distance between two vertices: L1 over their joint weights (0 = same skinning, 2 = disjoint)
  const skinDist = (a, b) => {
    if (!skinned) return 0;
    let s = 0; const seen = [];
    for (let c = 0; c < 4; c++) { const j = JA[a * 4 + c], w = WA[a * 4 + c]; if (!w) continue; let wb = 0; for (let e = 0; e < 4; e++) if (JA[b * 4 + e] === j) wb += WA[b * 4 + e]; s += Math.abs(w - wb); seen.push(j); }
    for (let e = 0; e < 4; e++) { const j = JA[b * 4 + e], w = WA[b * 4 + e]; if (w && !seen.includes(j)) s += w; }
    return s;
  };

  // quadrics per group (the symmetric 4×4 as 10 floats), area-weighted plane of every triangle
  const Q = new Float64Array(ng * 10);
  const addPlane = (o, [a, b, c, d], w) => { Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d; Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d; Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d; };
  let areaSum = 0;
  for (const t of tris) {
    const [a, b, c] = t.map(vpos), n = cross(sub(b, a), sub(c, a)), area = Math.hypot(...n) / 2; if (!(area > 0)) continue;
    const u = norm(n), pl = [...u, -dot(u, a)]; areaSum += area;
    for (const v of t) addPlane(grp[v] * 10, pl, area);
  }
  const err = (u, v, x) => { const q = i => Q[u * 10 + i] + Q[v * 10 + i], [X, Y, Z] = x; return q(0) * X * X + 2 * q(1) * X * Y + 2 * q(2) * X * Z + 2 * q(3) * X + q(4) * Y * Y + 2 * q(5) * Y * Z + 2 * q(6) * Y + q(7) * Z * Z + 2 * q(8) * Z + q(9); };
  const triN = t => { const [a, b, c] = t.map(vpos); return cross(sub(b, a), sub(c, a)); };
  // a floor for the error so the skin factor also ranks flat collapses (area × (0.1 % of the mean edge)²)
  const eps = (areaSum / Math.max(1, start)) * (areaSum / Math.max(1, start)) * 1e-6;

  let pass = 0;
  while (tris.length > TARGET && pass < 120) {
    pass++;
    const around = Array.from({ length: ng }, () => []); tris.forEach((t, i) => { for (const v of t) { const g = grp[v]; if (around[g][around[g].length - 1] !== i) around[g].push(i); } });
    const cand = [], seen = new Set();
    for (const t of tris) { const [a, b, c] = t.map(v => grp[v]); for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = ek(u, v); if (u === v || seen.has(k)) continue; seen.add(k);
      const sd = skinDist(copies[u][0], copies[v][0]); if (sd > skinBorder) continue;
      const f = 1 + skinCost * sd;
      if (!locked[v]) cand.push([(err(u, v, gpos(u)) + eps) * f, v, u]); // group v moves onto u
      if (!locked[u]) cand.push([(err(u, v, gpos(v)) + eps) * f, u, v]);
    } }
    if (!cand.length) break;
    cand.sort((x, y) => x[0] - y[0]);
    const touched = new Uint8Array(ng); let removed = 0, done = 0;
    for (const [, gf, gt] of cand) {
      if (tris.length - removed <= TARGET) break;
      if (touched[gf] || touched[gt]) continue;
      const has = (t, g) => t.some(v => grp[v] === g);
      let ok = true, gone = 0, skinFrom = copies[gt][0];
      for (const ti of around[gf]) { const t = tris[ti]; if (t && has(t, gt)) { gone++; skinFrom = t.find(v => grp[v] === gt); } }
      if (!gone) continue;
      // the moved corner: at gt's position, its own normal, the UV of its triangle's (affine) mapping at that point
      const x = gpos(gt), plan = [];
      for (const ti of around[gf]) {
        const t = tris[ti]; if (!t || has(t, gt)) continue;
        const j = t.findIndex(v => grp[v] === gf), [a, b, c] = t;
        const e1 = sub(vpos(b), vpos(a)), e2 = sub(vpos(c), vpos(a)), d = sub(x, vpos(a));
        const d11 = dot(e1, e1), d12 = dot(e1, e2), d22 = dot(e2, e2), den = d11 * d22 - d12 * d12;
        const s1 = den ? (d22 * dot(d, e1) - d12 * dot(d, e2)) / den : 0, s2 = den ? (d11 * dot(d, e2) - d12 * dot(d, e1)) / den : 0;
        const tri = [a, b, c].map(k => [TA[k * 2], TA[k * 2 + 1]]);
        let uv = [tri[0][0] + s1 * (tri[1][0] - tri[0][0]) + s2 * (tri[2][0] - tri[0][0]), tri[0][1] + s1 * (tri[1][1] - tri[0][1]) + s2 * (tri[2][1] - tri[0][1])];
        if (uvClamp) uv = uvClamp(uv, tri);
        const pb = t.map(v => vpos(v)); pb[j] = x;
        const n0 = triN(t), n1 = cross(sub(pb[1], pb[0]), sub(pb[2], pb[0])), l0 = Math.hypot(...n0), l1 = Math.hypot(...n1);
        if (l1 < l0 * 0.05 || dot(n0, n1) < 0.3 * l0 * l1) { ok = false; break; }
        plan.push([ti, j, uv, vnrm(t[j])]);
      }
      if (!ok) continue;
      for (const ti of around[gf]) { const t = tris[ti]; if (t && has(t, gt)) { tris[ti] = null; removed++; } }
      for (const [ti, j, uv, n] of plan) {
        PA.push(...x); NA.push(...n); TA.push(...uv);
        if (skinned) { for (let c = 0; c < 4; c++) { JA.push(JA[skinFrom * 4 + c]); WA.push(WA[skinFrom * 4 + c]); } }
        grp.push(gt); copies[gt].push(nv); tris[ti][j] = nv; nv++;
      }
      for (let i = 0; i < 10; i++) Q[gt * 10 + i] += Q[gf * 10 + i];
      for (const ti of around[gf]) { const t = tris[ti]; if (t) for (const v of t) touched[grp[v]] = 1; }
      touched[gf] = touched[gt] = 1; done++;
    }
    tris = tris.filter(Boolean);
    if (!done) break;
  }

  // compact
  const used = new Int32Array(nv).fill(-1); let m = 0; for (const t of tris) for (const v of t) if (used[v] < 0) used[v] = m++;
  const P2 = new Float32Array(m * 3), N2 = new Float32Array(m * 3), T2 = new Float32Array(m * 2);
  const J2 = skinned ? new Uint16Array(m * 4) : null, W2 = skinned ? new Float32Array(m * 4) : null;
  for (let v = 0; v < nv; v++) {
    const k = used[v]; if (k < 0) continue;
    for (let c = 0; c < 3; c++) { P2[k * 3 + c] = PA[v * 3 + c]; N2[k * 3 + c] = NA[v * 3 + c]; }
    T2[k * 2] = TA[v * 2]; T2[k * 2 + 1] = TA[v * 2 + 1];
    if (skinned) for (let c = 0; c < 4; c++) { J2[k * 4 + c] = JA[v * 4 + c]; W2[k * 4 + c] = WA[v * 4 + c]; }
  }
  const I2 = new Uint32Array(tris.length * 3); tris.forEach((t, i) => t.forEach((v, j) => { I2[i * 3 + j] = used[v]; }));
  return { P: P2, N: N2, T: T2, J: J2, W: W2, I: I2, stats: { start, end: tris.length, welded: ng, locked: lockedCount, passes: pass, vertices: [mesh.P.length / 3, m] } };
}
