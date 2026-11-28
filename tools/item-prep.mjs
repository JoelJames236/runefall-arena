// Put a generated item into grip space (docs/remodel/03-weapons-and-sockets.md §4): origin = the fist's grip,
// +Y = toward the tip / head / muzzle / the shield's top, +X = the leading edge (weapons) / along the handle
// (shields), +Z = X × Y. Scaled to the blueprint size in metres, cut to its triangle budget, with the named empties
// of 03 §7 as child nodes (assemble-champion turns them into <item>_<empty> nodes on the socket joint).
//
//   node tools/item-prep.mjs --all [--only id,id] [--dry] [--no-simplify] [-v]      every item whose raw exists
//   node tools/item-prep.mjs [<raw.glb> <out.glb>] --spec <id> [--tris N] [--no-simplify] [-v]   (default <dir>/<id>_raw.glb → <dir>/<id>.glb)
//   node tools/item-prep.mjs <raw.glb> <out.glb> --kind sword|shield --size <m> [--flipz] [--flipy]   (legacy, pilot)
//   options: --items <items.json> (default assets/models/items/items.json), --dir <items folder>, --outdir <folder>
//   (batch output elsewhere, e.g. a preview: viewer.html?itemdir=<folder>/)
//
// The rules live in assets/models/items/items.json: per kind how the frame is derived (which end of the long axis is
// the head, how +X is picked), per item its size, origin rule, empties, triangle budget, expected handle Ø and
// overrides (flipX / flipY / flipZ, rot, mirror, offsets). Raws are read as `<dir>/<id>_raw.glb`, written as
// `<dir>/<id>.glb`. Axes are derived from the geometry (principal axes, plane sections, the handle's centre line);
// the generation convention (head up = file +Y, front toward the viewer = file +Z) is used only where a rule says so
// (`up`, `front`, `frontZ`: the stable choice for symmetric parts) and is reported as a check everywhere else.
//
// The legacy --kind path is the pilot's original algorithm, kept as it was so old command lines reproduce old files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb, readAccessor, worldMatrices, xform, xdir, sub, add, scl, dot, cross, norm, pca, GlbWriter } from './glb-lib.mjs';
import { simplify } from './mesh-simplify.mjs';
import { writeArrow } from './make-arrow.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UP = [0, 1, 0], FRONT = [0, 0, 1];                 // generation convention: head up, front toward the viewer

// ------------------------------------------------------------------ CLI
const args = process.argv.slice(2);
const VALUED = new Set(['--kind', '--size', '--spec', '--items', '--tris', '--only', '--dir', '--outdir']);
const flag = k => args.includes(k);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith('-') && !(i > 0 && VALUED.has(args[i - 1])));
const DIR = path.resolve(opt('--dir', path.join(ROOT, 'assets/models/items')));
const SPEC_FILE = path.resolve(opt('--items', path.join(DIR, 'items.json'))), OUTDIR = path.resolve(opt('--outdir', DIR));
const VERBOSE = flag('-v') || flag('--verbose'), DRY = flag('--dry'), NO_SIMPLIFY = flag('--no-simplify');

function usage() {
  console.error('usage: node tools/item-prep.mjs --all [--only id,id] [--dry] [-v]\n' +
    '       node tools/item-prep.mjs <raw.glb> <out.glb> --spec <id> [--tris N] [--no-simplify]\n' +
    '       node tools/item-prep.mjs <raw.glb> <out.glb> --kind sword|shield --size <m> [--flipz] [--flipy]');
  process.exit(2);
}

// ------------------------------------------------------------------ specs
export function loadSpecs(file = SPEC_FILE) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { kinds: j.kinds || {}, items: j.items || {} };
}
export function specFor(id, specs = loadSpecs()) {
  const it = specs.items[id]; if (!it) throw new Error(`no item "${id}" in ${SPEC_FILE}`);
  const kd = specs.kinds[it.kind]; if (!kd) throw new Error(`${id}: unknown kind "${it.kind}"`);
  return { ...kd, ...it, origin: { ...(kd.origin || {}), ...(it.origin || {}) }, empties: { ...(kd.empties || {}), ...(it.empties || {}) } };
}

// ------------------------------------------------------------------ small maths
const quant = (a, q) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };
const median = a => quant(a, 0.5);
const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const maxOf = (a, f = x => x) => { let m = -Infinity; for (const x of a) { const v = f(x); if (v > m) m = v; } return m; };
const minOf = (a, f = x => x) => { let m = Infinity; for (const x of a) { const v = f(x); if (v < m) m = v; } return m; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const deg = r => r * 180 / Math.PI, rad = d => d * Math.PI / 180;
const projPerp = (v, a) => { const p = sub(v, scl(a, dot(v, a))), l = Math.hypot(...p); return l < 0.25 ? null : scl(p, 1 / l); };
const toLocal = (pts, o, X, Y, Z, k = 1) => pts.map(p => { const d = sub(p, o); return [dot(d, X) * k, dot(d, Y) * k, dot(d, Z) * k]; });
function bbox3(pts) { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const p of pts) for (let c = 0; c < 3; c++) { if (p[c] < mn[c]) mn[c] = p[c]; if (p[c] > mx[c]) mx[c] = p[c]; } return { min: mn, max: mx }; }
const bmid = b => [0, 1, 2].map(c => (b.min[c] + b.max[c]) / 2);
function bbox2(s) { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of s) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; } return [x0, x1, z0, z1]; }
function linfit(xs, ys) { const mx = mean(xs), my = mean(ys); let a = 0, b = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; }); const m = b > 0 ? a / b : 0; return { m, b: my - m * mx }; }
function pca2(pts) { // 2D principal directions
  const mx = mean(pts.map(p => p[0])), my = mean(pts.map(p => p[1])); let a = 0, b = 0, c = 0;
  for (const [x, y] of pts) { a += (x - mx) ** 2; b += (x - mx) * (y - my); c += (y - my) ** 2; }
  const th = 0.5 * Math.atan2(2 * b, a - c);
  return { major: [Math.cos(th), Math.sin(th)], minor: [-Math.sin(th), Math.cos(th)] };
}
function quatEuler([x, y, z]) { // degrees, XYZ order (three.js)
  const c1 = Math.cos(rad(x) / 2), c2 = Math.cos(rad(y) / 2), c3 = Math.cos(rad(z) / 2), s1 = Math.sin(rad(x) / 2), s2 = Math.sin(rad(y) / 2), s3 = Math.sin(rad(z) / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
function quatRotate([qx, qy, qz, qw], v) { const u = [qx, qy, qz], t = scl(cross(u, v), 2); return add(add(v, scl(t, qw)), cross(u, t)); }
// a decision: sign ±1, how decisive it was
const ratioRule = (a, b, need = 1.25) => { const lo = Math.min(a, b), hi = Math.max(a, b), m = lo > 1e-12 ? hi / lo : (hi > 0 ? Infinity : 1); return { sign: a >= b ? 1 : -1, margin: m, decisive: m >= need, txt: m === Infinity ? 'clear' : m.toFixed(2) + '×' }; };
const dirRule = (v, need = 0.5) => ({ sign: v >= 0 ? 1 : -1, margin: Math.abs(v), decisive: Math.abs(v) >= need, txt: 'dot ' + v.toFixed(2) });
const diffRule = (a, b, scale, need = 0.12) => { const d = (a - b) / (scale || 1); return { sign: d >= 0 ? 1 : -1, margin: Math.abs(d), decisive: Math.abs(d) >= need, txt: (d >= 0 ? '+' : '') + d.toFixed(2) }; };
// the first decisive rule wins; with none decisive, the first rule that gave an answer (and a warning)
function decide(label, rules, evalRule, D, W) {
  const res = [];
  for (const r of [].concat(rules)) {
    let v = null; try { v = evalRule(r); } catch (e) { v = null; }
    if (!v) { res.push({ r, v: null }); continue; }
    res.push({ r, v });
    if (v.decisive) { D.push(`${label}: ${r} ${v.txt}`); return v; }
  }
  const first = res.find(x => x.v); if (!first) throw new Error(`${label}: no rule applies (${[].concat(rules).join(', ')})`);
  D.push(`${label}: ${first.r} ${first.v.txt} (not decisive)`);
  W.push(`${label} is ambiguous (${res.map(x => `${x.r} ${x.v ? x.v.txt : 'n/a'}`).join(', ')}): check in the viewer, set a flip if wrong`);
  return first.v;
}

// ------------------------------------------------------------------ mesh access
const asFloat = (G, i) => {
  const a = G.json.accessors[i], r = readAccessor(G, i); if (a.componentType === 5126) return r;
  const d = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 1;
  return Float32Array.from(r, x => Math.max(x / d, -1));
};
function loadRaw(file) {
  const G = readGlb(file), J = G.json, { W } = worldMatrices(J);
  const roots = J.scenes ? J.scenes[J.scene ?? 0].nodes : J.nodes.map((_, i) => i);
  const seen = new Set(), walk = i => { if (seen.has(i)) return; seen.add(i); (J.nodes[i].children || []).forEach(walk); }; roots.forEach(walk);
  const V = [], N = [], T = [], I = [], mats = new Set(); let material = null, skinned = false, noNormals = false;
  for (const ni of seen) {
    const n = J.nodes[ni]; if (n.mesh === undefined) continue; if (n.skin !== undefined) skinned = true;
    for (const p of J.meshes[n.mesh].primitives) {
      if ((p.mode ?? 4) !== 4) throw new Error(`${file}: only triangle lists`);
      const P = asFloat(G, p.attributes.POSITION), Nn = p.attributes.NORMAL !== undefined ? asFloat(G, p.attributes.NORMAL) : null;
      const Tt = p.attributes.TEXCOORD_0 !== undefined ? asFloat(G, p.attributes.TEXCOORD_0) : null, base = V.length;
      if (!Nn) noNormals = true;
      for (let k = 0; k < P.length / 3; k++) {
        V.push(xform(W[ni], [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]));
        N.push(Nn ? norm(xdir(W[ni], [Nn[k * 3], Nn[k * 3 + 1], Nn[k * 3 + 2]])) : null);
        T.push(Tt ? [Tt[k * 2], Tt[k * 2 + 1]] : [0, 0]);
      }
      const ix = p.indices !== undefined ? readAccessor(G, p.indices) : Array.from({ length: P.length / 3 }, (_, k) => k);
      for (const i of ix) I.push(base + i);
      mats.add(p.material ?? -1); if (material === null && p.material !== undefined) material = p.material;
    }
  }
  if (!V.length) throw new Error(`${file}: no mesh`);
  if (noNormals) { // area-weighted vertex normals where the file has none
    const acc = V.map(() => [0, 0, 0]);
    for (let t = 0; t < I.length; t += 3) { const [a, b, c] = [I[t], I[t + 1], I[t + 2]], n = cross(sub(V[b], V[a]), sub(V[c], V[a])); for (const v of [a, b, c]) acc[v] = add(acc[v], n); }
    N.forEach((n, i) => { if (!n) N[i] = norm(acc[i]); });
  }
  return { G, J, V, N, T, I: Uint32Array.from(I), material, nMaterials: mats.size, skinned };
}
// deterministic area-weighted surface samples (+ the vertices): low-poly meshes have long triangles, so measuring on
// vertices alone misses most of a blade or a haft
function sampleSurface(V, I, n = 24000) {
  const areas = []; let A = 0;
  for (let t = 0; t < I.length; t += 3) { const a = V[I[t]], b = V[I[t + 1]], c = V[I[t + 2]], s = Math.hypot(...cross(sub(b, a), sub(c, a))) / 2; areas.push(s); A += s; }
  const out = V.slice(), g = 1.32471795724474602596, a1 = 1 / g, a2 = 1 / (g * g); let carry = 0, j = 0;
  areas.forEach((s, t) => {
    carry += s / A * n; const m = Math.floor(carry); carry -= m;
    const a = V[I[t * 3]], e1 = sub(V[I[t * 3 + 1]], a), e2 = sub(V[I[t * 3 + 2]], a);
    for (let k = 0; k < m; k++, j++) { let r1 = (0.5 + a1 * j) % 1, r2 = (0.5 + a2 * j) % 1; if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; } out.push(add(a, add(scl(e1, r1), scl(e2, r2)))); }
  });
  return out;
}
// exact plane section y = y0 of a triangle mesh → [x, z] points where its edges cross the plane
function sectionY(L, I, y0) {
  const out = [];
  const edge = (p, q) => { const dp = p[1] - y0, dq = q[1] - y0; if ((dp < 0) !== (dq < 0)) { const s = dp / (dp - dq); out.push([p[0] + s * (q[0] - p[0]), p[2] + s * (q[2] - p[2])]); } };
  for (let t = 0; t < I.length; t += 3) { const a = L[I[t]], b = L[I[t + 1]], c = L[I[t + 2]]; edge(a, b); edge(b, c); edge(c, a); }
  return out;
}
function profileY(L, I, n, lo, hi) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const y = lo + (hi - lo) * (k + 0.5) / n, s = sectionY(L, I, y);
    if (!s.length) { out.push({ y, n: 0, spread: 0, sx: 0, sz: 0, cx: 0, cz: 0 }); continue; }
    const [x0, x1, z0, z1] = bbox2(s);
    out.push({ y, n: s.length, x0, x1, z0, z1, sx: x1 - x0, sz: z1 - z0, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, spread: Math.max(x1 - x0, z1 - z0) });
  }
  return out;
}
// the centre of a handle in a section (metres): the cluster of section points around the seed (the handle line, else
// the median) — sorted by distance, cut at the first jump of more than 12 mm (bands, trigger guards, chains and
// decorations farther out are ignored) — then its bbox centre, iterated; d = mean of the cluster's two extents
function ringCentre(s, seed = null) {
  if (s.length < 3) return null;
  let c = seed ? seed.slice() : [median(s.map(p => p[0])), median(s.map(p => p[1]))], inl = s;
  for (let it = 0; it < 8; it++) {
    const d = s.map(p => Math.hypot(p[0] - c[0], p[1] - c[1])), order = d.map((_, i) => i).sort((a, b) => d[a] - d[b]);
    let cut = order.length;
    for (let k = 1; k < order.length; k++) if (d[order[k]] > 0.13 || (k >= 4 && d[order[k]] - d[order[k - 1]] > 0.012)) { cut = Math.max(k, 3); break; }
    inl = order.slice(0, cut).map(i => s[i]);
    const b = bbox2(inl), nc = [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2], moved = Math.hypot(nc[0] - c[0], nc[1] - c[1]); c = nc; if (moved < 1e-5) break;
  }
  const b = bbox2(inl);
  // dr: twice the median distance from the centre — the core's Ø, not inflated by a few protruding shards / bands
  return { c, dims: [b[1] - b[0], b[3] - b[2]], d: (b[1] - b[0] + b[3] - b[2]) / 2, dr: 2 * median(inl.map(p => Math.hypot(p[0] - c[0], p[1] - c[1]))) };
}
// in-plane axes of a plate: the minimum-area bounding rectangle (a near-square tome or a decorated shield turns its
// principal axes; the outline's rectangle does not)
function rectAxes(pts2) {
  const area = th => { const c = Math.cos(th), s = Math.sin(th); let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity; for (const [x, y] of pts2) { const a = x * c + y * s, b = -x * s + y * c; if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b; } return { A: (a1 - a0) * (b1 - b0), ea: a1 - a0, eb: b1 - b0 }; };
  let best = 0, bv = Infinity;
  for (let d = 0; d < 180; d += 1) { const v = area(rad(d)).A; if (v < bv) { bv = v; best = d; } }
  for (let d = best - 1; d <= best + 1; d += 0.05) { const v = area(rad(d)).A; if (v < bv) { bv = v; best = d; } }
  const r = area(rad(best)), th = rad(best), u = [Math.cos(th), Math.sin(th)], v = [-Math.sin(th), Math.cos(th)];
  return r.ea >= r.eb ? { long: u, short: v } : { long: v, short: u };
}
// profile features, unit-free (work in file units and in metres)
function guardFromProfile(prof) { // the crossguard: widest section; its slab ends where the width falls a quarter of the way back
  const n = prof.length, a = Math.max(1, Math.round(n * 0.03)); let g = a;
  for (let i = a; i < n - a; i++) if (prof[i].spread > prof[g].spread) g = i;
  const ymin = prof[0].y, ymax = prof[n - 1].y, yg = prof[g].y, Wd = prof[g].spread;
  const sp = (y0, y1) => prof.filter(p => p.n && p.y >= y0 && p.y <= y1).map(p => p.spread);
  const grip = median(sp(ymin + 0.3 * (yg - ymin), ymin + 0.85 * (yg - ymin))) || 0, blade = median(sp(yg + 0.15 * (ymax - yg), yg + 0.6 * (ymax - yg))) || 0;
  const tLo = grip + 0.25 * (Wd - grip), tHi = blade + 0.25 * (Wd - blade);
  let lo = ymin, hi = ymax;
  for (let i = g; i > 0; i--) if (prof[i - 1].spread < tLo) { const p = prof[i - 1], q = prof[i]; lo = p.y + (tLo - p.spread) / Math.max(1e-12, q.spread - p.spread) * (q.y - p.y); break; }
  for (let i = g; i < n - 1; i++) if (prof[i + 1].spread < tHi) { const p = prof[i], q = prof[i + 1]; hi = p.y + (p.spread - tHi) / Math.max(1e-12, p.spread - q.spread) * (q.y - p.y); break; }
  return { lo, hi, peak: yg, width: Wd, grip, blade };
}
function headFromProfile(prof) { // the head: from the lowest section in the upper half wider than 1.8 × the haft
  const n = prof.length, a = Math.round(n * 0.04), hs = quant(prof.slice(a, n - a).filter(p => p.n).map(p => p.spread), 0.25);
  const ymin = prof[0].y, ymax = prof[n - 1].y, mid = (ymin + ymax) / 2, step = (ymax - ymin) / n;
  const cand = prof.filter(p => p.y > mid && p.spread > 1.8 * hs);
  return { lo: cand.length ? minOf(cand, p => p.y) - step / 2 : ymax - 0.25 * (ymax - ymin), hs, found: cand.length > 0 };
}
function lineSlices(prof, mode) { // sections that lie on the handle's centre line
  const n = prof.length, a = Math.round(n * 0.04);
  if (mode === 'grip') { // butt → guard on the guard's short side (curved blades bend away from the grip's line)
    const g = guardFromProfile(prof), ymin = prof[0].y, ymax = prof[n - 1].y;
    const up = ymax - g.peak > g.peak - ymin, from = up ? ymin : ymax, to = up ? g.lo : g.hi;
    const y0 = Math.min(from + 0.25 * (to - from), from + 0.85 * (to - from)), y1 = Math.max(from + 0.25 * (to - from), from + 0.85 * (to - from));
    return prof.filter(p => p.n && p.y >= y0 && p.y <= y1);
  }
  // the longest run of thin sections (gaps of ≤ 2 allowed): the haft / shaft / blade, not a stray spike of the head
  const p30 = quant(prof.slice(a, n - a).filter(p => p.n).map(p => p.spread), 0.3), runs = [];
  let cur = null, gap = 0;
  for (let i = a; i < n - a; i++) {
    const thin = prof[i].n && prof[i].spread <= 1.5 * p30;
    if (thin) { if (!cur) { cur = []; runs.push(cur); } cur.push(prof[i]); gap = 0; } else if (cur && ++gap > 2) cur = null;
  }
  const best = runs.reduce((b, r) => (r.length && r[r.length - 1].y - r[0].y > (b.length ? b[b.length - 1].y - b[0].y : -1) ? r : b), []);
  if (best.length < 6) return best;
  // drop sections off the line (bands, wraps): residual > 3 × the median residual
  const fx = linfit(best.map(p => p.y), best.map(p => p.cx)), fz = linfit(best.map(p => p.y), best.map(p => p.cz));
  const res = best.map(p => Math.hypot(p.cx - (fx.m * p.y + fx.b), p.cz - (fz.m * p.y + fz.b))), lim = 3 * (median(res) || 1e-9);
  return best.filter((p, i) => res[i] <= lim);
}
// convexity of a surface seen along +h vs −h: grid over (p, q), per cell the extreme h; the centre cells against the rim
function bulge(pts) { // pts: [p, q, h]
  const b = bbox3(pts.map(([p, q, h]) => [p, q, h])), cp = (b.min[0] + b.max[0]) / 2, cq = (b.min[1] + b.max[1]) / 2, hp = (b.max[0] - b.min[0]) / 2 || 1, hq = (b.max[1] - b.min[1]) / 2 || 1;
  const G = 20, cells = new Map();
  for (const [p, q, h] of pts) {
    const i = clamp(Math.floor((p - b.min[0]) / (2 * hp) * G), 0, G - 1), j = clamp(Math.floor((q - b.min[1]) / (2 * hq) * G), 0, G - 1), k = i * G + j;
    const c = cells.get(k) || { hi: -Infinity, lo: Infinity, r: Math.hypot(((i + 0.5) / G * 2 * hp + b.min[0] - cp) / hp, ((j + 0.5) / G * 2 * hq + b.min[1] - cq) / hq) };
    c.hi = Math.max(c.hi, h); c.lo = Math.min(c.lo, h); cells.set(k, c);
  }
  const cs = [...cells.values()], ctr = cs.filter(c => c.r < 0.35), rim = cs.filter(c => c.r > 0.7);
  if (ctr.length < 2 || rim.length < 2) return null;
  const plus = median(ctr.map(c => c.hi)) - median(rim.map(c => c.hi)), minus = median(rim.map(c => c.lo)) - median(ctr.map(c => c.lo));
  return diffRule(plus, minus, b.max[2] - b.min[2], 0.12);
}

// ------------------------------------------------------------------ frames (file space): { c, X, Y, Z }
const HEAD = { // which end of the long axis is the head (+Y); prof ascends along A
  wide: ({ prof }) => { const n = prof.length, m = Math.max(1, Math.round(n * 0.3)), e = a => a.reduce((s, p) => s + p.spread * p.spread, 0); return ratioRule(e(prof.slice(n - m)), e(prof.slice(0, m))); },
  narrow: ({ prof }) => { const n = prof.length, h = n >> 1, e = a => mean(a.map(p => p.spread * p.spread)); return ratioRule(e(prof.slice(0, h)), e(prof.slice(n - h))); },
  sword: ({ prof }) => { const g = guardFromProfile(prof), n = prof.length; return ratioRule(prof[n - 1].y - g.peak, g.peak - prof[0].y, 1.3); },
  arrow: ({ prof }) => { // the fletching's wide run is longer than the arrowhead's: the head is the end with the shorter run
    const n = prof.length, shaft = median(prof.slice(Math.round(n * 0.3), Math.round(n * 0.7)).filter(p => p.n).map(p => p.spread));
    const reach = at => { let far = 0; for (let k = 0; k < Math.round(n * 0.3); k++) if (prof[at(k)].spread > 2.2 * shaft) far = k + 1; return far; };
    return ratioRule(reach(k => k), reach(k => n - 1 - k), 1.3);
  },
  up: ({ A }) => dirRule(dot(A, UP)),
};
// sign of the X axis d (⟂ Y): pts = region samples as { y, a (along d, from the handle line), b (along d × Y) }
const XSIGN = {
  farthest: ({ pts }) => ratioRule(maxOf(pts, p => p.a), -minOf(pts, p => p.a)),
  blunt: ({ pts }) => { const ap = maxOf(pts, p => p.a), am = minOf(pts, p => p.a), area = P => P.length < 3 ? 0 : (maxOf(P, p => p.y) - minOf(P, p => p.y)) * (maxOf(P, p => p.b) - minOf(P, p => p.b)); return ratioRule(area(pts.filter(p => p.a > 0.6 * ap)), area(pts.filter(p => p.a < 0.6 * am))); },
  tipSide: ({ all, hi, lo }) => { const t = all.filter(p => p.y > hi - 0.12 * (hi - lo)); if (!t.length) return null; const m = mean(t.map(p => p.a)), r = m / (0.01 * (hi - lo)); return { sign: m >= 0 ? 1 : -1, margin: Math.abs(r), decisive: Math.abs(r) >= 1, txt: `tip ${(100 * m / (hi - lo)).toFixed(1)} % of L` }; },
  bulge: ({ pts }) => bulge(pts.map(p => [p.y, p.b, p.a])),
  front: ({ d }) => dirRule(dot(d, FRONT)),
  frontZ: ({ d, Y }) => dirRule(dot(cross(d, Y), FRONT)),
};
function orientLong(sp, M, D, W) {
  const { centroid: c, axes } = pca(M.S);
  let A = axes[0], e2, e3, L, prof, lo, hi;
  const build = () => {
    let b = sub(axes[1], scl(A, dot(A, axes[1]))); if (Math.hypot(...b) < 1e-6) b = sub(axes[2], scl(A, dot(A, axes[2])));
    e2 = norm(b); e3 = cross(A, e2); L = toLocal(M.V, c, e2, A, e3);
    lo = minOf(L, p => p[1]); hi = maxOf(L, p => p[1]); prof = profileY(L, M.I, 160, lo, hi);
  };
  build();
  const axisFrom = sp.axisFrom || 'thin';
  if (axisFrom !== 'pca') for (let it = 0; it < 3; it++) { // tilt the axis onto the handle's centre line
    const sel = lineSlices(prof, axisFrom); if (sel.length < 4) break;
    const fx = linfit(sel.map(p => p.y), sel.map(p => p.cx)), fz = linfit(sel.map(p => p.y), sel.map(p => p.cz));
    if (Math.hypot(fx.m, fz.m) < 2e-4) break;
    A = norm(add(A, add(scl(e2, fx.m), scl(e3, fz.m)))); build();
  }
  const tilt = deg(Math.acos(Math.min(1, Math.abs(dot(A, axes[0])))));
  if (tilt > 0.3) D.push(`axis: handle centre line (${axisFrom}), ${tilt.toFixed(1)}° off the principal axis`);
  const h = decide('head (+Y)', sp.head || ['wide', 'up'], r => HEAD[r]({ prof, A }), D, W);
  const s = h.sign * (sp.flipY ? -1 : 1); if (sp.flipY) D.push('head: flipY');
  const Y = scl(A, s), P2 = s > 0 ? prof : prof.slice().reverse().map(p => ({ ...p, y: -p.y, cx: p.cx, cz: p.cz }));
  const lo2 = s > 0 ? lo : -hi, hi2 = s > 0 ? hi : -lo;
  const line = lineSlices(P2, 'thin'), cx0 = median(line.map(p => p.cx)) || 0, cz0 = median(line.map(p => p.cz)) || 0;
  const rel = M.S.map(p => { const d = sub(p, c); return { y: dot(d, Y), u: dot(d, e2) - cx0, w: dot(d, e3) - cz0 }; });
  let region = [lo2, hi2];
  const xr = sp.xRegion || 'head';
  if (xr === 'head') region = [headFromProfile(P2).lo, hi2];
  else if (xr === 'guard') { const g = guardFromProfile(P2); region = [g.lo, g.hi]; }
  else if (xr === 'blade') region = [guardFromProfile(P2).hi, hi2];
  else if (xr === 'tip') region = [hi2 - 0.15 * (hi2 - lo2), hi2];
  let R = rel.filter(p => p.y >= region[0] && p.y <= region[1]);
  if (R.length < 10) { W.push(`xRegion ${xr} found nothing: the whole item is used`); R = rel; }
  let d;
  if ((sp.xAxis || 'wide') === 'front') { d = projPerp(FRONT, Y); if (!d) { d = norm(cross(Y, [1, 0, 0])); W.push('xAxis front: the long axis points at the viewer; X taken ⟂ to it'); } }
  else {
    const { major, minor } = pca2(R.map(p => [p.u, p.w])), v = sp.xAxis === 'thin' ? minor : major;
    d = norm(add(scl(e2, v[0]), scl(e3, v[1])));
  }
  const Zc = cross(d, Y), dv = [dot(d, e2), dot(d, e3)], zv = [dot(Zc, e2), dot(Zc, e3)];
  const proj = p => ({ y: p.y, a: p.u * dv[0] + p.w * dv[1], b: p.u * zv[0] + p.w * zv[1] });
  const pts = R.map(proj), all = rel.map(proj);
  const xs = decide('edge (+X)', sp.xSign || ['frontZ'], r => XSIGN[r]({ pts, all, d, Y, lo: lo2, hi: hi2 }), D, W);
  const sx = xs.sign * (sp.flipX || sp.flipZ ? -1 : 1); if (sp.flipX || sp.flipZ) D.push('edge: flipX');
  const X = scl(d, sx);
  return { c, X, Y, Z: cross(X, Y), line: add(c, add(scl(e2, cx0), scl(e3, cz0))) };
}
const PLATE_TOP = {
  wideTop: ({ L, I }) => { // heater / tower outlines: the widest band lies toward the top
    const lo = minOf(L, p => p[1]), hi = maxOf(L, p => p[1]), prof = profileY(L, I, 80, lo, hi);
    let g = 0; prof.forEach((p, i) => { if (p.sx > prof[g].sx) g = i; });
    const m = (prof[g].y - (lo + hi) / 2) / ((hi - lo) / 2); return { sign: m >= 0 ? 1 : -1, margin: Math.abs(m), decisive: Math.abs(m) >= 0.12, txt: `widest band ${(50 + 50 * Math.abs(m)).toFixed(0)} % of the height toward +Y` };
  },
  wide: ({ L, I }) => { const lo = minOf(L, p => p[1]), hi = maxOf(L, p => p[1]); return HEAD.wide({ prof: profileY(L, I, 80, lo, hi) }); },
  up: ({ Yu }) => dirRule(dot(Yu, UP)),
};
// the tome's spine: rounded, full thickness at its edge; the fore-edge has recessed pages between the covers
function spineSide(L, I) {
  const lo = minOf(L, p => p[1]), hi = maxOf(L, p => p[1]); let cp = 0, cm = 0, th = 0, n = 0;
  for (const f of [0.2, 0.32, 0.68, 0.8]) {
    const s = sectionY(L, I, lo + f * (hi - lo)); if (s.length < 6) continue;
    const [, , z0, z1] = bbox2(s), zc = (z0 + z1) / 2, t = z1 - z0; th += t; n++;
    for (const side of [1, -1]) {
      const mid = maxOf(s.filter(p => Math.abs(p[1] - zc) < 0.2 * t), p => side * p[0]), cov = maxOf(s.filter(p => Math.abs(p[1] - zc) > 0.3 * t), p => side * p[0]);
      if (isFinite(mid) && isFinite(cov)) { if (side > 0) cp += mid - cov; else cm += mid - cov; }
    }
  }
  if (!n) return null;
  return diffRule(cp / n, cm / n, th / n, 0.06); // sign +1: the spine is at +x
}
const PLATE_FACE = { // sign of the face normal Zu
  bulge: ({ SL }) => bulge(SL),
  front: ({ Zu }) => dirRule(dot(Zu, FRONT)),
  spine: ({ L, I, sy }) => { const r = spineSide(L, I); if (!r) return null; return { ...r, sign: -r.sign * sy, txt: `spine at ${r.sign > 0 ? '+' : '−'}x ${r.txt}` }; },
};
function orientPlate(sp, M, D, W) {
  const { centroid: c, axes } = pca(M.S), Zu = axes[2];
  let Yu = axes[0];
  { const r = rectAxes(M.S.map(p => { const d = sub(p, c); return [dot(d, axes[0]), dot(d, axes[1])]; })); Yu = norm(add(scl(axes[0], r.long[0]), scl(axes[1], r.long[1]))); }
  if (sp.yAxis === 'up') { const y = projPerp(UP, Zu); if (y) Yu = y; else W.push('yAxis up: the plate faces up in the file; its long axis is used'); }
  const Xu = cross(Yu, Zu), L = toLocal(M.V, c, Xu, Yu, Zu), SL = toLocal(M.S, c, Xu, Yu, Zu);
  let sy = 1;
  if (sp.yAxis !== 'up' || sp.head) { const h = decide('top (+Y)', sp.head || ['wideTop', 'up'], r => PLATE_TOP[r]({ L, I: M.I, Yu }), D, W); sy = h.sign; }
  else D.push('top (+Y): file up projected onto the plate (round)');
  if (sp.flipY) { sy = -sy; D.push('top: flipY'); }
  const Ls = sy > 0 ? L : L.map(([x, y, z]) => [-x, -y, z]);
  const f = decide('face (+Z)', sp.zSign || ['bulge', 'front'], r => PLATE_FACE[r]({ L: Ls, I: M.I, SL, Zu, sy: 1 }), D, W);
  const sz = f.sign * (sp.flipZ || sp.flipX ? -1 : 1); if (sp.flipZ || sp.flipX) D.push('face: flipZ');
  const Y = scl(Yu, sy), Z = scl(Zu, sz);
  return { c, X: cross(Y, Z), Y, Z };
}
function orientUpright(sp, M, D, W) { // relic: the principal axis nearest the file's up, the face toward the viewer
  const { centroid: c, axes } = pca(M.S);
  let A = axes.reduce((b, a) => (Math.abs(dot(a, UP)) > Math.abs(dot(b, UP)) ? a : b)); A = scl(A, dot(A, UP) >= 0 ? 1 : -1);
  D.push(`up: principal axis nearest file +Y (dot ${dot(A, UP).toFixed(2)})`);
  { const other = axes.reduce((b, a) => (Math.abs(dot(a, A)) < Math.abs(dot(b, A)) ? a : b)), e2 = norm(sub(other, scl(A, dot(other, A)))), L = toLocal(M.V, c, e2, A, cross(A, e2));
    const w = HEAD.wide({ prof: profileY(L, M.I, 80, minOf(L, p => p[1]), maxOf(L, p => p[1])) });
    if (w.decisive && w.sign < 0) W.push(`the wider end is at the bottom (${w.txt}): is the relic upside down? (flipY)`); }
  const Y = scl(A, sp.flipY ? -1 : 1); if (sp.flipY) D.push('up: flipY');
  let Z = projPerp(FRONT, Y); if (!Z) { Z = norm(cross([1, 0, 0], Y)); W.push('front: the item points at the viewer; Z guessed'); }
  if (sp.flipZ || sp.flipX) { Z = scl(Z, -1); D.push('face: flipZ'); }
  D.push('face (+Z): file front');
  return { c, X: cross(Y, Z), Y, Z };
}
function orientBow(sp, M, D, W) {
  // +Y = the chord tip → tip (the string line), +Z = from the riser toward the chord (the string side, the archer)
  const { centroid: c, axes } = pca(M.S), A0 = axes[0];
  const t = M.S.map(p => dot(sub(p, c), A0)), tlo = minOf(t), thi = maxOf(t), len = thi - tlo;
  const tip = sel => pca(M.S.filter((_, i) => sel(t[i]))).centroid, T1 = tip(v => v > thi - 0.015 * len), T0 = tip(v => v < tlo + 0.015 * len);
  const Ac = norm(sub(T1, T0));
  D.push(`limb axis: tip to tip, ${deg(Math.acos(Math.min(1, Math.abs(dot(Ac, A0))))).toFixed(1)}° off the principal axis`);
  const e2 = norm(projPerp(axes[1], Ac) || projPerp(axes[2], Ac)), L = toLocal(M.V, c, e2, Ac, cross(Ac, e2));
  const h = decide('top limb (+Y)', sp.head || ['up'], r => HEAD[r]({ prof: profileY(L, M.I, 120, minOf(L, p => p[1]), maxOf(L, p => p[1])), A: Ac }), D, W);
  const Y = scl(Ac, h.sign * (sp.flipY ? -1 : 1)); if (sp.flipY) D.push('top limb: flipY');
  // the riser: mean offset of the mid-length samples from the chord (a modelled string lies on the chord and adds ~0)
  const ym = (dot(sub(T1, c), Ac) + dot(sub(T0, c), Ac)) / 2, mid = M.S.filter((_, i) => Math.abs(t[i] - ym) < 0.06 * len);
  const off = mid.reduce((s, p) => { const d = sub(p, T0); return add(s, sub(d, scl(Y, dot(d, Y)))); }, [0, 0, 0]), o = scl(off, 1 / Math.max(1, mid.length)), m = Math.hypot(...o) / len;
  D.push(`string side (+Z): riser ${(100 * m).toFixed(1)} % of L off the chord`);
  if (m < 0.03) W.push(`string side ambiguous (riser ${(100 * m).toFixed(1)} % of L off the chord): check, flipZ if wrong`);
  let Z = m > 1e-4 ? scl(norm(o), -1) : norm(projPerp(axes[1], Y)); if (sp.flipZ || sp.flipX) { Z = scl(Z, -1); D.push('string side: flipZ'); }
  return { c, X: cross(Y, Z), Y, Z };
}
function orientBore(sp, M, D, W) { // gun: the barrel's axis, the stock hangs on +X
  const { centroid: c, axes } = pca(M.S), A0 = axes[0];
  const e2 = norm(projPerp(axes[1], A0)), L = toLocal(M.V, c, e2, A0, cross(A0, e2)), lo = minOf(L, p => p[1]), hi = maxOf(L, p => p[1]);
  const h = decide('muzzle (+Y)', sp.head || ['narrow', 'up'], r => HEAD[r]({ prof: profileY(L, M.I, 120, lo, hi), A: A0 }), D, W);
  const Yh = scl(A0, h.sign * (sp.flipY ? -1 : 1)); if (sp.flipY) D.push('muzzle: flipY');
  const yOf = p => dot(sub(p, c), Yh), ys = M.S.map(yOf), ylo = minOf(ys), len = maxOf(ys) - ylo;
  const barrel = M.S.filter((p, i) => ys[i] > ylo + 0.55 * len && ys[i] < ylo + 0.92 * len);
  let Y = Yh;
  if (barrel.length > 20) { const b = pca(barrel).axes[0]; Y = scl(b, dot(b, Yh) >= 0 ? 1 : -1); D.push(`bore: barrel axis, ${deg(Math.acos(Math.min(1, dot(Y, Yh)))).toFixed(1)}° off the gun's long axis`); }
  const cb = pca(barrel.length > 20 ? barrel : M.S).centroid, butt = M.S.filter((p, i) => ys[i] < ylo + 0.3 * len), cu = pca(butt).centroid;
  const off = sub(sub(cu, cb), scl(Y, dot(sub(cu, cb), Y))), m = Math.hypot(...off) / len;
  D.push(`trigger side (+X): stock drop ${(100 * m).toFixed(1)} % of L`); if (m < 0.02) W.push('the stock hardly drops below the bore: +X (underside) is a guess — check, flipX if wrong');
  let X = m > 1e-4 ? norm(off) : norm(cross(Y, FRONT)); if (sp.flipX || sp.flipZ) { X = scl(X, -1); D.push('trigger side: flipX'); }
  return { c, X, Y, Z: cross(X, Y) };
}
const ORIENT = { long: orientLong, plate: orientPlate, upright: orientUpright, bow: orientBow, bore: orientBore };

// ------------------------------------------------------------------ grip-space mesh (metres) and its measurements
class Grip {
  constructor(L, I, S, seed = null) { this.L = L; this.I = I; this.S = S; this.seed = seed; this.bb = bbox3(L); } // seed: [x, z] of the handle line
  get len() { return this.bb.max[1] - this.bb.min[1]; }
  section(y) { return sectionY(this.L, this.I, y); }
  sectionIn(y) { return this.section(clamp(y, this.bb.min[1] + 0.003, this.bb.max[1] - 0.003)); }
  get prof() { return this._p ||= profileY(this.L, this.I, clamp(Math.round(this.len / 0.004), 120, 600), this.bb.min[1], this.bb.max[1]); }
  get guard() { return this._g ||= guardFromProfile(this.prof); }
  get head() { if (!this._h) { const h = headFromProfile(this.prof); this._h = { ...h, pts: this.S.filter(p => p[1] >= h.lo) }; } return this._h; }
  get chord() { // bow: the string line between the tips (their string-side extreme), z at height y
    if (!this._c) {
      const b = this.bb, t1 = this.S.filter(p => p[1] > b.max[1] - 0.03), t0 = this.S.filter(p => p[1] < b.min[1] + 0.03);
      const z1 = maxOf(t1, p => p[2]), z0 = maxOf(t0, p => p[2]);
      this._c = y => z0 + (z1 - z0) * (y - b.min[1]) / ((b.max[1] - b.min[1]) || 1);
    }
    return this._c;
  }
  riserAt(y) { // bow: the riser's section at y, without the string
    const zc = this.chord(y), s = this.sectionIn(y), r = s.filter(p => p[1] < zc - 0.03);
    if (r.length < 3) return null; const b = bbox2(r); return { c: [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2], b, string: s.filter(p => p[1] >= zc - 0.025) };
  }
  // the handle ring at y: the bow's riser (the section without the string), else the cluster around the seed
  ring(y, seed, fixed) { // fixed (m): keep the centre on the handle line, Ø from the points within that radius (twisted strands)
    if (fixed) { const c = seed || [0, 0], p = this.sectionIn(y).filter(q => Math.hypot(q[0] - c[0], q[1] - c[1]) < fixed); if (p.length < 3) return null; const b = bbox2(p); return { c: c.slice(), dims: [b[1] - b[0], b[3] - b[2]], d: (b[1] - b[0] + b[3] - b[2]) / 2, dr: 2 * median(p.map(q => Math.hypot(q[0] - c[0], q[1] - c[1]))) }; }
    if (!this.isBow) return ringCentre(this.sectionIn(y), seed);
    const r = this.riserAt(y); if (!r) return null; const pts = this.sectionIn(y).filter(p => p[1] < this.chord(y) - 0.03);
    return { c: r.c, dims: [r.b[1] - r.b[0], r.b[3] - r.b[2]], d: (r.b[1] - r.b[0] + r.b[3] - r.b[2]) / 2, dr: 2 * median(pts.map(p => Math.hypot(p[0] - r.c[0], p[1] - r.c[1]))) };
  }
  muzzleCentre() { const s = this.section(this.bb.max[1] - 0.006); if (!s.length) return null; const b = bbox2(s); return [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2]; }
}
function bit(G, dir) { // the axe bit's edge corners: top / bottom of the outer 4 cm of the head on +X
  const P = G.head.pts; if (P.length < 10) return null;
  const xm = maxOf(P, p => p[0]), strip = P.filter(p => p[0] >= xm - 0.04); let best = strip[0];
  for (const p of strip) if (dir * p[1] > dir * best[1]) best = p;
  return [best[0], best[1], median(strip.map(p => p[2]))];
}
const EMPTY = {
  top: G => { const y = G.bb.max[1], s = G.section(y - 0.004); const b = s.length ? bbox2(s) : [0, 0, 0, 0]; return [(b[0] + b[1]) / 2, y, (b[2] + b[3]) / 2]; },
  butt: G => { const y = G.bb.min[1], s = G.section(y + 0.004); const b = s.length ? bbox2(s) : [0, 0, 0, 0]; return [(b[0] + b[1]) / 2, y, (b[2] + b[3]) / 2]; },
  axisTop: G => [0, G.bb.max[1], 0],
  axisButt: G => [0, G.bb.min[1], 0],
  guard: G => [0, (G.guard.lo + G.guard.hi) / 2, 0],
  guardTop: G => [0, G.guard.hi, 0],
  bladeMid: G => [0, (G.guard.hi + G.bb.max[1]) / 2, 0],
  bitTop: G => bit(G, 1),
  bitBottom: G => bit(G, -1),
  bitCheek: G => { const t = bit(G, 1), b = bit(G, -1); if (!t || !b) return null; return [0.5 * maxOf(G.head.pts, p => p[0]), (t[1] + b[1]) / 2, median(G.head.pts.map(p => p[2]))]; },
  headCentre: G => (G.head.pts.length ? bmid(bbox3(G.head.pts)) : null),
  headBottom: G => [0, G.head.lo, 0],
  headCheek: G => { // the head's +Z face at its centre (a hammer's sun disc on the cheek)
    const P = G.head.pts; if (!P.length) return null; const c = bmid(bbox3(P)), w = maxOf(P, p => p[0]) - minOf(P, p => p[0]);
    const f = P.filter(p => Math.abs(p[0] - c[0]) < 0.15 * w && Math.abs(p[1] - c[1]) < 0.15 * (G.bb.max[1] - G.head.lo)); return f.length ? [c[0], c[1], maxOf(f, p => p[2])] : null;
  },
  headFace: G => { const P = G.head.pts; if (!P.length) return null; const xm = maxOf(P, p => p[0]), f = P.filter(p => p[0] > xm - 0.012); return [xm, mean(f.map(p => p[1])), mean(f.map(p => p[2]))]; },
  handle: (G, e) => { const r = ringCentre(G.sectionIn(e.y ?? 0), G.seed); return r ? [r.c[0], e.y ?? 0, r.c[1]] : null; },
  boss: G => { // the face's front-most point near the centre (boss / emblem)
    const b = G.bb, hx = (b.max[0] - b.min[0]) / 2, hy = (b.max[1] - b.min[1]) / 2, P = G.S.filter(p => Math.abs(p[0]) < 0.3 * hx && Math.abs(p[1]) < 0.3 * hy);
    if (!P.length) return null; const zm = maxOf(P, p => p[2]), f = P.filter(p => p[2] > zm - 0.008); return [mean(f.map(p => p[0])), mean(f.map(p => p[1])), zm];
  },
  rimTop: G => { const f = G.S.filter(p => p[1] > G.bb.max[1] - 0.01); return [mean(f.map(p => p[0])), G.bb.max[1], mean(f.map(p => p[2]))]; },
  cover: G => { // tome: centre of the +Z cover (the sigil)
    const b = G.bb, c = bmid(b), w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], P = G.S.filter(p => Math.abs(p[0] - c[0]) < 0.2 * w && Math.abs(p[1] - c[1]) < 0.2 * h);
    return P.length ? [c[0], c[1], quant(P.map(p => p[2]), 0.95)] : null;
  },
  eyes: (G, e) => { // relic: on the face, f of the height up
    const ye = G.bb.min[1] + (e.f ?? 0.62) * G.len, P = G.S.filter(p => Math.abs(p[0]) < 0.04 && Math.abs(p[1] - ye) < 0.03);
    return P.length ? [0, ye, maxOf(P, p => p[2]) - 0.005] : null;
  },
  muzzle: G => { const c = G.muzzleCentre(); return c ? [c[0], G.bb.max[1], c[1]] : null; },
  stock: G => { const s = G.section(G.bb.min[1] + 0.006); if (!s.length) return null; const b = bbox2(s); return [(b[0] + b[1]) / 2, G.bb.min[1], (b[2] + b[3]) / 2]; },
  pan: (G, e) => { // gun: the flash pan on the lock side (+Z) at the breech (barrel length behind the muzzle)
    const m = G.muzzleCentre(); if (!m) return null; const yp = G.bb.max[1] - (e.barrel ?? 0.70);
    const P = G.S.filter(p => Math.abs(p[1] - yp) < 0.04 && Math.abs(p[0] - m[0]) < 0.05 && p[2] > m[1]);
    return [m[0], yp, P.length ? maxOf(P, p => p[2]) : m[1]];
  },
  string: G => { // bow: the string at the grip's height (a modelled string near the chord, else the chord)
    const zc = G.chord(0), s = G.sectionIn(0).filter(p => p[1] >= zc - 0.025);
    return s.length ? [mean(s.map(p => p[0])), 0, mean(s.map(p => p[1]))] : [0, 0, zc];
  },
  shelf: (G, e) => { // bow: the arrow rest, beside the riser just above the fist (side −1 = the archer's left, see items.json)
    const y = e.y ?? 0.06, r = G.riserAt(y); if (!r) return null; const side = e.side ?? -1;
    return [side > 0 ? r.b[1] + 0.004 : r.b[0] - 0.004, y, r.c[1]];
  },
  riser: (G, e) => { const y = e.y ?? 0.1, r = G.riserAt(y); return r ? [r.c[0], y, r.c[1]] : null; },
};

// distance of probe points to a triangle mesh (closest point on triangle, Ericson): p99 and max, in metres
function deviation(probe, P, I) {
  const v = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], tris = [];
  for (let t = 0; t < I.length; t += 3) { const a = v(I[t]), b = v(I[t + 1]), c = v(I[t + 2]); tris.push({ a, b, c, lo: [0, 1, 2].map(k => Math.min(a[k], b[k], c[k])), hi: [0, 1, 2].map(k => Math.max(a[k], b[k], c[k])) }); }
  const closest = (p, { a, b, c }) => {
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return a;
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return b;
    const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scl(ab, d1 / (d1 - d3)));
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return c;
    const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scl(ac, d2 / (d2 - d6)));
    const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scl(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
    const dn = 1 / (va + vb + vc); return add(a, add(scl(ab, vb * dn), scl(ac, vc * dn)));
  };
  const ds = probe.map(p => {
    let best = Infinity;
    for (const t of tris) {
      const gx = Math.max(t.lo[0] - p[0], 0, p[0] - t.hi[0]), gy = Math.max(t.lo[1] - p[1], 0, p[1] - t.hi[1]), gz = Math.max(t.lo[2] - p[2], 0, p[2] - t.hi[2]);
      if (gx * gx + gy * gy + gz * gz >= best * best) continue;
      const q = closest(p, t), d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (d < best) best = d;
    }
    return best;
  });
  return { p99: quant(ds, 0.99), max: maxOf(ds) };
}

// ------------------------------------------------------------------ origin rules
function originOf(sp, G, D, W) {
  const o = sp.origin || {}, b = G.bb; let x0, y0, z0, how;
  if (o.belowGuard !== undefined) { const g = G.guard; y0 = g.lo - o.belowGuard; how = `${o.belowGuard} below the guard (guard ${(g.lo - b.min[1]).toFixed(3)}…${(g.hi - b.min[1]).toFixed(3)} from the butt, ${(g.width * 1000).toFixed(0)} mm wide)`; }
  else if (o.fromButt !== undefined) { y0 = b.min[1] + o.fromButt; how = `${o.fromButt} above the butt`; }
  else if (o.fromTop !== undefined) { y0 = b.max[1] - o.fromTop; how = `${o.fromTop} below the top`; }
  else if (o.neck) { // gun: the narrowest section of the stock between neck[0] and neck[1] above the butt (the wrist)
    let best = null;
    for (let y = b.min[1] + o.neck[0]; y <= b.min[1] + o.neck[1] + 1e-9; y += 0.005) { const r = ringCentre(G.section(y)); if (r && (!best || r.dims[0] * r.dims[1] < best.A)) best = { y, A: r.dims[0] * r.dims[1], r }; }
    if (!best) throw new Error('origin neck: no section in the window');
    y0 = best.y; x0 = best.r.c[0]; z0 = best.r.c[1]; how = `the stock's narrowest section ${o.neck[0]}…${o.neck[1]} above the butt: ${(y0 - b.min[1]).toFixed(3)} (butt plate at y ${(b.min[1] - y0).toFixed(2)})`;
  }
  else if (o.centre) { // shields: behind the plate's centre; the back plane (the plate's back at the centre, or the rearmost 2 %) at z = +0.035
    const c = bmid(b), w = b.max[0] - b.min[0], h = b.max[1] - b.min[1]; x0 = c[0]; y0 = c[1];
    let zb;
    if (o.back === 'rearmost') zb = quant(G.S.map(p => p[2]), 0.02);
    else {
      const P = G.S.filter(p => Math.abs(p[0] - x0) < 0.12 * w && Math.abs(p[1] - y0) < 0.12 * h), cells = new Map();
      for (const p of P) { const k = Math.floor((p[0] - x0 + 0.12 * w) / (0.04 * w)) * 64 + Math.floor((p[1] - y0 + 0.12 * h) / (0.04 * h)); cells.set(k, Math.min(cells.get(k) ?? Infinity, p[2])); }
      zb = cells.size ? median([...cells.values()]) : quant(G.S.map(p => p[2]), 0.02);
    }
    z0 = zb - 0.035; how = `plate centre, back plane (${o.back === 'rearmost' ? 'rearmost 2 %' : 'plate back at the centre'}) at z +0.035`;
    const rear = quant(G.S.map(p => p[2]), 0.02) - z0; if (rear < -0.02) D.push(`shield: the rim reaches ${(-rear * 100).toFixed(0)} cm behind the fist (curved)`);
  } else if (o.bottom) { y0 = b.min[1]; how = 'bottom centre'; }
  else if (o.spine) { // tome: the spine's centre (half the thickness in from its edge), mid-height, mid-thickness
    const r = spineSide(G.L, G.I), side = r ? r.sign : -1, t = b.max[2] - b.min[2];
    x0 = side < 0 ? b.min[0] + t / 2 : b.max[0] - t / 2; y0 = (b.min[1] + b.max[1]) / 2; z0 = (b.min[2] + b.max[2]) / 2;
    how = `spine at ${side < 0 ? '−' : '+'}X${r ? ' ' + r.txt : ''}`;
    if (side > 0) W.push('tome: the spine is on +X (the book lies over the wrist, toward −X): flipY turns it over');
  } else if (o.riser) { // bow: the riser grip's centre at mid-length (+ o.y)
    y0 = (b.min[1] + b.max[1]) / 2 + (o.y || 0); const r = G.riserAt(y0); if (r) { x0 = r.c[0]; z0 = r.c[1]; } how = 'riser grip, mid-length';
  } else throw new Error('origin: give fromButt, belowGuard, fromTop, centre, bottom, spine or riser');
  if (x0 === undefined) { const r = ringCentre(G.sectionIn(y0), G.seed); x0 = r ? r.c[0] : 0; z0 = r ? r.c[1] : 0; }
  const off = o.offset || [0, 0, 0];
  D.push('origin: ' + how + (o.offset ? ` + offset [${off.join(', ')}]` : ''));
  return [x0 + off[0], y0 + off[1], z0 + off[2]];
}

// ------------------------------------------------------------------ one item
export function prepItem(id, sp, rawPath, outPath, opts = {}) {
  const D = [], W = [], t0 = Date.now();
  const M = loadRaw(rawPath);
  if (M.skinned) W.push('the raw is skinned: written rigid (no skin)');
  if (M.nMaterials > 1) W.push(`${M.nMaterials} materials: only the first is kept (the assembler wants one)`);
  M.S = sampleSurface(M.V, M.I);
  const orient = ORIENT[sp.frame]; if (!orient) throw new Error(`frame "${sp.frame}" unknown (long, plate, upright, bow, bore)`);
  const F = orient(sp, M, D, W);
  // grip-space transform: rotate into the frame, scale to the blueprint size, optional rot / mirror, then the origin
  const L0 = toLocal(M.V, F.c, F.X, F.Y, F.Z), b0 = bbox3(L0), ext = sub(b0.max, b0.min);
  const sizeOf = sp.sizeBy === 'diameter' ? Math.max(ext[0], ext[1]) : ext[1], k = sp.size / sizeOf;
  const q = sp.rot ? quatEuler(sp.rot) : null, mir = sp.mirror ? { x: 0, y: 1, z: 2 }[sp.mirror] : -1;
  if (sp.mirror && mir < 0) throw new Error('mirror: x, y or z');
  const fix = v => { let r = q ? quatRotate(q, v) : v; if (mir >= 0) { r = r.slice(); r[mir] = -r[mir]; } return r; };
  if (q) D.push(`rot [${sp.rot.join(', ')}]°`); if (mir >= 0) D.push(`mirror ${sp.mirror} (geometry mirrored, winding reversed)`);
  let L = L0.map(p => fix(scl(p, k))), S = toLocal(M.S, F.c, F.X, F.Y, F.Z, k).map(fix);
  let N = M.N.map(n => fix(norm([dot(n, F.X), dot(n, F.Y), dot(n, F.Z)])));
  const I = Uint32Array.from(M.I); if (mir >= 0) for (let t = 0; t < I.length; t += 3) { const a = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = a; }
  const ls = F.line ? fix(scl(toLocal([F.line], F.c, F.X, F.Y, F.Z)[0], k)) : null;
  let G = new Grip(L, I, S, ls && [ls[0], ls[2]]); G.isBow = sp.frame === 'bow';
  const o = originOf(sp, G, D, W);
  L = L.map(p => sub(p, o)); S = S.map(p => sub(p, o)); G = new Grip(L, I, S, ls ? [ls[0] - o[0], ls[2] - o[2]] : null); G.isBow = sp.frame === 'bow';

  // handleFit (opt-in): thin the grip zone radially to the expected Ø (03 §4.1/§5: the finger poses are built for
  // 34 / 38 mm; Tripo hafts come out 2–4× thicker). Zone: from / to (m, default ±0.08 around the origin, down past
  // grip2 on two-handers, up to 5 mm under the guard on swords), blended over `blend`; only vertices within rMax of
  // the handle's centre line move (hanging feathers, beards and chains stay), normals follow the scaling.
  if (sp.handleFit && sp.handle) {
    const hf = sp.handleFit === true ? {} : sp.handleFit, r0 = G.ring(0, [0, 0], sp.handleFit.fixed);
    if (!r0) W.push('handleFit: no handle section at the origin');
    else {
      const want = (hf.d ?? sp.handle) / 1000, g2 = typeof sp.empties?.grip2 === 'object' ? sp.empties.grip2.y : undefined;
      // zone "haft": the whole haft, from `butt` above the butt (its cap / flare keeps its shape) to `below` under the head
      const haft = hf.zone === 'haft';
      const from = hf.from ?? (haft ? G.bb.min[1] + (hf.butt ?? 0.06) : Math.min(-0.08, g2 !== undefined && g2 < 0 ? g2 - 0.08 : -0.08));
      const to = hf.to ?? (haft ? G.head.lo - (hf.below ?? 0.05) : sp.origin?.belowGuard !== undefined ? sp.origin.belowGuard - 0.005 : Math.max(0.08, g2 !== undefined && g2 > 0 ? g2 + 0.08 : 0.08));
      const blend = hf.blend ?? 0.03, lo = Math.max(G.bb.min[1] + 0.003, from - blend), hi = Math.min(G.bb.max[1] - 0.003, to + blend);
      // the handle section by section (1 cm), seeded from the origin outward: centre, Ø; each section is scaled to Ø want
      const cs = [];
      for (const dir of [1, -1]) { let c = [0, 0]; for (let y = dir > 0 ? 0 : -0.01; dir > 0 ? y <= hi + 0.01 : y >= lo - 0.01; y += dir * 0.01) { const r = G.ring(y, hf.fixed ? [0, 0] : c, hf.fixed); if (r && Math.hypot(r.c[0] - c[0], r.c[1] - c[1]) < 0.02) { c = r.c; cs.push([y, c[0], c[1], r.dr]); } } }
      cs.sort((a, b) => a[0] - b[0]);
      cs.forEach((e, i) => { e[4] = median(cs.slice(Math.max(0, i - 2), i + 3).map(x => x[3])); }); // Ø smoothed over ±2 cm
      const at = y => { let i = cs.findIndex(e => e[0] >= y); if (i <= 0) return cs[Math.max(0, i)]; const a = cs[i - 1], b = cs[i], t = (y - a[0]) / ((b[0] - a[0]) || 1); return a.map((v, j) => v + t * (b[j] - v)); };
      const sm = t => t * t * (3 - 2 * t), wAt = y => (y < from - blend || y > to + blend ? 0 : y < from ? sm((y - from + blend) / blend) : y > to ? sm((to + blend - y) / blend) : 1);
      const kAt = p => { const w = wAt(p[1]); if (!w || !cs.length) return null; const [, cx, cz, , d] = at(p[1]); if (Math.hypot(p[0] - cx, p[2] - cz) > (hf.rMax ?? 0.75 * d + 0.01)) return null; return { k: 1 + (Math.min(1, want / d) - 1) * w, cc: [cx, cz] }; };
      const ks = L.map(kAt), thin = (p, t) => (t ? [t.cc[0] + (p[0] - t.cc[0]) * t.k, p[1], t.cc[1] + (p[2] - t.cc[1]) * t.k] : p);
      N = N.map((n, i) => { const t = ks[i]; return t ? norm([n[0] / t.k, n[1], n[2] / t.k]) : n; });
      L = L.map((p, i) => thin(p, ks[i])); S = S.map(p => thin(p, kAt(p))); G = new Grip(L, I, S, G.seed); G.isBow = sp.frame === 'bow';
      // re-centre the origin on the fitted handle (each section was scaled about its own centre)
      const rc = G.ring(0, [0, 0], hf.fixed);
      if (rc && Math.hypot(rc.c[0], rc.c[1]) > 0.001) { const sh = [rc.c[0], 0, rc.c[1]]; L = L.map(p => sub(p, sh)); S = S.map(p => sub(p, sh)); G = new Grip(L, I, S, G.seed && [G.seed[0] - sh[0], G.seed[1] - sh[2]]); G.isBow = sp.frame === 'bow'; D.push(`handleFit: origin re-centred by ${(Math.hypot(sh[0], sh[2]) * 1000).toFixed(0)} mm`); }
      const ds = cs.filter(e => wAt(e[0]) === 1).map(e => e[4] * 1000);
      D.push(`handleFit: Ø ${ds.length ? `${minOf(ds).toFixed(0)}…${maxOf(ds).toFixed(0)}` : (r0.d * 1000).toFixed(0)} → ${(want * 1000).toFixed(0)} mm for y ${from.toFixed(2)} … ${to.toFixed(2)} (blend ${blend})`);
    }
  }

  // empties
  const empties = {}, missing = [];
  for (const [name, e0] of Object.entries(sp.empties || {})) {
    const e = typeof e0 === 'string' ? { rule: e0 } : e0;
    let p = null;
    if (e.at) p = e.at.slice();
    else if (e.same) p = empties[e.same] ? empties[e.same].p.slice() : null;
    else { const fn = EMPTY[e.rule]; if (!fn) throw new Error(`${id}: empty ${name}: unknown rule "${e.rule}"`); try { p = fn(G, e); } catch (err) { p = null; } }
    if (!p || p.some(v => !isFinite(v))) { missing.push(name); continue; }
    if (e.offset) p = add(p, e.offset);
    empties[name] = { p, q: e.rot ? quatEuler(e.rot) : null, rule: e.at ? 'at' : e.same ? '=' + e.same : e.rule };
  }
  if (missing.length) W.push(`empties missing (rule found nothing): ${missing.join(', ')}`);
  for (const [name, e] of Object.entries(empties)) { // sanity: inside the item's box (2 cm slack)
    const out = [0, 1, 2].some(c => e.p[c] < G.bb.min[c] - 0.02 || e.p[c] > G.bb.max[c] + 0.02);
    if (out) W.push(`empty ${name} lies outside the mesh's box (${e.p.map(v => v.toFixed(3)).join(', ')})`);
  }
  for (const n of ['tip', 'muzzle']) if (empties[n] && empties[n].p[1] < 0) W.push(`${n} is below the origin (y ${empties[n].p[1].toFixed(2)}): is the head at the wrong end? (flipY)`);
  for (const n of sp.frame === 'bore' ? ['stock'] : ['pommel', 'grip2']) if (empties[n] && empties[n].p[1] > 0) W.push(`${n} is above the origin (y ${empties[n].p[1].toFixed(2)}): is the head at the wrong end? (flipY)`);

  // measurements and checks
  const bb = G.bb, size = sub(bb.max, bb.min);
  let handle = null;
  if (sp.handle) {
    const r = G.ring(0, [0, 0], sp.handleFit && sp.handleFit.fixed);
    if (r) {
      handle = { d: r.dr * 1000, dims: r.dims.map(v => v * 1000), want: sp.handle, off: r.dr * 1000 / sp.handle - 1 }; // Ø = 2 × median radius; dims = the cluster's box
      if (Math.abs(handle.off) > 0.25) W.push(`handle Ø ${handle.d.toFixed(0)} mm (box ${handle.dims.map(v => v.toFixed(0)).join('×')}) at the origin vs Ø ${sp.handle} (${handle.off > 0 ? '+' : ''}${(100 * handle.off).toFixed(0)} %)`);
      const c = Math.hypot(...r.c) * 1000; if (c > 4) W.push(`the handle's centre is ${c.toFixed(0)} mm off the origin`);
    } else W.push('no handle section at the origin');
  }
  const EXP = { x: size[0], y: size[1], z: size[2], xmin: bb.min[0], xmax: bb.max[0], ymin: bb.min[1], ymax: bb.max[1], zmin: bb.min[2], zmax: bb.max[2] };
  for (const [key, want] of Object.entries(sp.expect || {})) {
    if (!(key in EXP) || !want) continue; const got = EXP[key], off = got / want - 1;
    if (Math.abs(off) > 0.25) W.push(`${key} ${got.toFixed(3)} m vs ${want} (${off > 0 ? '+' : ''}${(100 * off).toFixed(0)} %)`);
  }
  // generation-convention cross-checks (the raws were made head up, front toward the viewer)
  const upDot = dot(F.Y, UP), frontDot = dot(F.Z, FRONT);
  D.push(`frame in the file: +Y ${deg(Math.acos(clamp(upDot, -1, 1))).toFixed(1)}° from file up, +Z ${deg(Math.acos(clamp(frontDot, -1, 1))).toFixed(1)}° from file front, +X ${deg(Math.acos(clamp(F.X[0], -1, 1))).toFixed(1)}° from file +X`);
  if (upDot < 0.5) W.push(`derived +Y is ${deg(Math.acos(clamp(upDot, -1, 1))).toFixed(0)}° from the file's up (raws are generated head-up): check, flipY if the head is at the wrong end`);
  if (sp.frame === 'plate' && frontDot < 0.5) W.push(`derived face (+Z) is ${deg(Math.acos(clamp(frontDot, -1, 1))).toFixed(0)}° from the file's front: check, flipZ if the face is backwards`);
  if (sp.frame === 'bore') { // lock (hammer + pan) protrudes on +Z near the breech; the bore lies above the fist at x ≈ −0.07
    const m = G.muzzleCentre(); if (m) D.push(`bore at x ${m[0].toFixed(3)} z ${m[1].toFixed(3)} (03 §4.5: x ≈ −0.07)`);
    const P = G.S.filter(p => p[1] > 0.03 && p[1] < bb.max[1] - (sp.empties?.fx_core?.barrel ?? 0.70) + 0.08);
    if (P.length) { const zp = maxOf(P, p => p[2]), zm = -minOf(P, p => p[2]); D.push(`lock side: +Z ${(zp * 1000).toFixed(0)} mm vs −Z ${(zm * 1000).toFixed(0)} mm`); if (zm > 1.2 * zp) W.push('the lock seems to be on −Z (a left-hand gun): set "mirror": "z" if so'); }
  }
  if (sp.frame === 'bow' && empties.string_mid) D.push(`brace: string ${(empties.string_mid.p[2] * 1000).toFixed(0)} mm from the grip centre (03 §7: 0.18)`);

  // triangle budget: the shared simplifier, UVs kept in 0..1
  const budget = opts.tris ?? sp.tris, tris0 = I.length / 3;
  let P = Float32Array.from(L.flat()), Nn = Float32Array.from(N.flat()), T = Float32Array.from(M.T.flat()), Ix = I, uvOut = 0;
  let dev = null, why = '';
  if (budget && tris0 > budget && !NO_SIMPLIFY && !opts.noSimplify) {
    // the budget, as long as the shape survives: the deviation of the prepped surface from the result (p99) may reach
    // tol = 1 % of the length freely and hard = 3 % with a warning; past that, the non-manifold edges are locked
    // (Tripo's fins and flames); past that too, the lowest triangle count that keeps the shape within tol is searched
    // and the item stays over budget (a wand whose head is all locked fins otherwise loses its whole shaft)
    const probe = S.filter((_, i) => i % Math.max(1, Math.floor(S.length / 2500)) === 0);
    const tol = Math.max(0.004, 0.01 * G.len), hard = Math.max(0.008, 0.03 * G.len), uvClamp = uv => [clamp(uv[0], 0, 1), clamp(uv[1], 0, 1)];
    const run = (target, lock) => { const r = simplify({ P, N: Nn, T, I: Ix }, target, { uvClamp, lockNonManifold: lock }); return { r, d: deviation(probe, r.P, r.I), lock, tris: r.I.length / 3 }; };
    const mm = x => (x * 1000).toFixed(0) + ' mm';
    let pick = run(budget, false);
    if (pick.d.p99 > tol) {
      const locked = run(budget, true), fits = [pick, locked].filter(x => x.d.p99 <= hard && x.tris <= budget).sort((x, y) => x.d.p99 - y.d.p99);
      if (fits.length) { if (fits[0] === locked) why = `plain collapses p99 ${mm(pick.d.p99)}, non-manifold edges locked: ${mm(locked.d.p99)}`; pick = fits[0]; }
      else {
        let lo = budget, hi = tris0, good = null;
        while (hi - lo > Math.max(8, 0.02 * tris0)) { const mid = Math.round((lo + hi) / 2), r = run(mid, false); if (r.d.p99 <= tol) { good = r; hi = mid; } else lo = mid; }
        why = `${budget} tris lose the shape (p99 ${mm(Math.min(pick.d.p99, locked.d.p99))}): stopped at the lowest count within ${mm(tol)}`;
        pick = good || { r: { P, N: Nn, T, I: Ix }, d: { p99: 0, max: 0 }, lock: false, tris: tris0 };
        W.push(`over budget: ${why} → ${pick.tris} tris (re-generate with fewer polygons, or raise tris)`);
      }
    }
    P = pick.r.P; Nn = pick.r.N; T = pick.r.T; Ix = pick.r.I; dev = pick.d;
    D.push(`simplify: ${tris0} → ${Ix.length / 3} tris, surface deviation p99 ${(dev.p99 * 1000).toFixed(1)} mm, max ${(dev.max * 1000).toFixed(1)} mm${pick.lock ? ' (non-manifold edges locked)' : ''}${why ? ' — ' + why : ''}`);
    if (dev.p99 > tol) W.push(`simplifying moved the surface: p99 ${mm(dev.p99)}, max ${mm(dev.max)} (free up to ${mm(tol)}) — check the shape in the viewer`);
  }
  for (let i = 0; i < T.length; i++) { if (T[i] < -1e-4 || T[i] > 1 + 1e-4) uvOut++; T[i] = clamp(T[i], 0, 1); }
  if (uvOut) W.push(`${uvOut} UV components outside 0..1 clamped`);
  const tris = Ix.length / 3; if (budget && tris > budget && !why) W.push(`${tris} tris, over the ${budget} budget (the simplifier stopped: locked outline)`);
  if (Ix !== I) { // the simplified mesh's box: extremities (spikes, wing tips) the collapses shaved off
    const fb = bbox3(Array.from({ length: P.length / 3 }, (_, i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]])), fs = sub(fb.max, fb.min);
    const lost = [0, 1, 2].map(c => 1 - fs[c] / (size[c] || 1)), worst = Math.max(...lost);
    if (worst > 0.03) W.push(`simplifying shrank the box by ${(100 * worst).toFixed(0)} % along ${'xyz'[lost.indexOf(worst)]} (${size.map(v => v.toFixed(2)).join(' × ')} → ${fs.map(v => v.toFixed(2)).join(' × ')})`);
    size.splice(0, 3, ...fs);
  }

  const extras = { id, kind: sp.kind, size: sp.size, tris, budget, origin: sp.origin, handleMm: handle ? +handle.d.toFixed(1) : null, frame: D, source: path.basename(rawPath) };
  const bytes = DRY ? 0 : writeItem(M, outPath, { P, N: Nn, T, I: Ix }, empties, extras);
  return { id, kind: sp.kind, out: outPath, tris0, tris, budget, size, handle, empties, dev, D, W, bytes, ms: Date.now() - t0 };
}

// ------------------------------------------------------------------ write: one mesh, the source material + its images, the empties
function writeItem(M, out, mesh, empties, extras) {
  const { G, J } = M;
  const mat = M.material !== null ? JSON.parse(JSON.stringify(J.materials[M.material])) : { pbrMetallicRoughness: { baseColorFactor: [0.7, 0.7, 0.7, 1] } };
  const o = { asset: { version: '2.0', generator: 'runefall item-prep', extras: { item: extras } }, scene: 0, scenes: [{ nodes: [0] }], nodes: [], meshes: [], materials: [mat], samplers: J.samplers?.length ? J.samplers : [{}], textures: [], images: [] };
  const Wr = new GlbWriter(o), texMap = new Map();
  const copyTex = ti => {
    if (texMap.has(ti)) return texMap.get(ti);
    const tx = J.textures[ti], im = J.images[tx.source], bv = J.bufferViews[im.bufferView];
    o.images.push({ mimeType: im.mimeType, bufferView: Wr.view(G.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)), name: im.name });
    o.textures.push({ source: o.images.length - 1, sampler: tx.sampler ?? 0 }); texMap.set(ti, o.textures.length - 1); return o.textures.length - 1;
  };
  const pb = mat.pbrMetallicRoughness || {};
  for (const [holder, key] of [[pb, 'baseColorTexture'], [pb, 'metallicRoughnessTexture'], [mat, 'normalTexture'], [mat, 'emissiveTexture'], [mat, 'occlusionTexture']]) {
    if (!holder[key]) continue; const t = holder[key], keep = {}; if (t.scale !== undefined) keep.scale = t.scale; if (t.strength !== undefined) keep.strength = t.strength;
    holder[key] = { index: copyTex(t.index), ...keep };
  }
  delete mat.extensions;
  const prim = { attributes: { POSITION: Wr.accessor(mesh.P, 'VEC3', 5126, { minmax: true, target: 34962 }), NORMAL: Wr.accessor(mesh.N, 'VEC3', 5126, { target: 34962 }), TEXCOORD_0: Wr.accessor(mesh.T, 'VEC2', 5126, { target: 34962 }) }, indices: Wr.accessor(Uint32Array.from(mesh.I), 'SCALAR', 5125, { target: 34963 }), material: 0 };
  o.meshes.push({ name: 'item', primitives: [prim] });
  o.nodes.push({ name: 'item', mesh: 0, children: [] });
  for (const [name, e] of Object.entries(empties)) {
    const n = { name, translation: e.p.map(v => +v.toFixed(5)) }; if (e.q) n.rotation = e.q.map(v => +v.toFixed(7));
    o.nodes.push(n); o.nodes[0].children.push(o.nodes.length - 1);
  }
  if (!o.nodes[0].children.length) delete o.nodes[0].children;
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  return Wr.write(out);
}

// procedural items (no raw): "procedural": "arrow" → tools/make-arrow.mjs, built in grip space at the item's size
function prepProcedural(id, sp, out) {
  if (sp.procedural !== 'arrow') throw new Error(`procedural "${sp.procedural}" unknown (arrow)`);
  const W = [], r = DRY ? null : writeArrow(out, { length: sp.size, extras: { id, budget: sp.tris } }), info = r || { tris: 69, size: [0.024, sp.size, 0.021], empties: { tip: [0, sp.size, 0] } };
  if (sp.tris && info.tris > sp.tris) W.push(`${info.tris} tris, over the ${sp.tris} budget`);
  const empties = Object.fromEntries(Object.entries(info.empties).map(([n, p]) => [n, { p, rule: 'procedural' }]));
  return { id, kind: sp.kind + '*', out, tris0: info.tris, tris: info.tris, budget: sp.tris, size: info.size, handle: null, empties, dev: null, D: ['procedural: tools/make-arrow.mjs (the raw is not used)'], W, bytes: r ? r.bytes : 0 };
}

// ------------------------------------------------------------------ batch + printing
function batch() {
  const specs = loadSpecs(), only = opt('--only') ? opt('--only').split(',').map(s => s.trim()).filter(Boolean) : null;
  const ids = only || Object.keys(specs.items), rows = [], none = [], failed = [];
  for (const id of ids) {
    if (!specs.items[id]) { failed.push({ id, err: 'not in items.json' }); continue; }
    const sp = specFor(id, specs), raw = path.resolve(DIR, sp.raw || `${id}_raw.glb`), out = path.resolve(OUTDIR, sp.out || `${id}.glb`);
    if (sp.procedural) { try { rows.push(prepProcedural(id, sp, out)); } catch (e) { failed.push({ id, err: e.message }); } continue; }
    if (!fs.existsSync(raw)) { none.push(id); continue; }
    try { rows.push(prepItem(id, sp, raw, out)); } catch (e) { failed.push({ id, err: e.message }); }
  }
  console.log(`item-prep ${DRY ? '(dry run) ' : ''}— ${rows.length} item${rows.length === 1 ? '' : 's'} from ${path.relative(ROOT, SPEC_FILE)}`);
  printRows(rows);
  if (none.length) console.log(`no raw yet (${none.length}): ${none.join(' ')}`);
  for (const f of failed) console.log(`FAILED ${f.id}: ${f.err}`);
  printWarnings(rows);
  if (failed.length) process.exitCode = 1;
}
function printRows(rows) {
  const pad = (s, n) => String(s).padEnd(n), lpad = (s, n) => String(s).padStart(n);
  console.log(pad('id', 19) + pad('kind', 12) + pad('tris', 18) + pad('size x × y × z (m)', 20) + pad('handle Ø at origin', 22) + 'empties');
  for (const r of rows) {
    const tris = r.tris0 === r.tris ? `${r.tris}` : `${r.tris0}→${r.tris}`, bud = r.budget ? ` /${r.budget}` : '';
    const h = r.handle ? `${r.handle.d.toFixed(0)} mm (${r.handle.want}) ${r.handle.off > 0 ? '+' : ''}${(100 * r.handle.off).toFixed(0)} %` : '—';
    console.log(pad(r.id, 19) + pad(r.kind, 12) + pad(tris + bud + (r.budget && r.tris > r.budget ? '!' : ''), 18) + pad(r.size.map(v => v.toFixed(2)).join(' × '), 20) + pad(h, 22) + Object.keys(r.empties).join(' ') + (r.W.length ? `  [${r.W.length} warning${r.W.length > 1 ? 's' : ''}]` : ''));
    if (VERBOSE) {
      for (const d of r.D) console.log('      ' + d);
      for (const [n, e] of Object.entries(r.empties)) console.log(`      ${pad(n, 11)} ${e.p.map(v => lpad(v.toFixed(3), 7)).join(' ')}  (${e.rule}${e.q ? ', rotated' : ''})`);
    }
  }
}
function printWarnings(rows) {
  const w = rows.filter(r => r.W.length); if (!w.length) { console.log('no warnings'); return; }
  console.log('warnings:'); for (const r of w) for (const m of r.W) console.log(`  ${r.id}: ${m}`);
}

// ------------------------------------------------------------------ legacy (the pilot's algorithm, unchanged)
function legacy() {
  const [inp, out] = positional; if (!inp || !out) usage();
  const KIND = opt('--kind', 'sword'), SIZE = Number(opt('--size', 1)), FLIPZ = flag('--flipz'), FLIPY = flag('--flipy');
  const G = readGlb(inp), J = G.json, { W } = worldMatrices(J);
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
    let g = 0; for (let b = 0; b < bins; b++) if (width[b] > width[g]) g = b;
    const guardT = lo + (g + 0.5) / bins * (hi - lo), bladeUp = (hi - guardT) > (guardT - lo);
    Y = scl(A, (bladeUp ? 1 : -1) * (FLIPY ? -1 : 1)); X = B; Z = norm(cross(X, Y)); k = SIZE / (hi - lo);
    const handle = pos.filter((p, i) => { const d = (t[i] - guardT) * (bladeUp ? 1 : -1); return d < -0.02 / k && d > -0.12 / k; });
    const hc = handle.length ? scl(handle.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]), 1 / handle.length) : centroid;
    origin = [hc[0], hc[1], hc[2]];
    const oy = dot(sub(origin, centroid), Y), guardY = (guardT * (bladeUp ? 1 : -1)) - oy, shift = guardY - 0.06 / k;
    origin = [origin[0] + Y[0] * shift, origin[1] + Y[1] * shift, origin[2] + Y[2] * shift];
    const tipY = (bladeUp ? hi : -lo) - (oy + shift), endY = (bladeUp ? lo : -hi) - (oy + shift);
    empties = { tip: [0, tipY * k, 0], trail_base: [0, 0.06, 0], fx_core: [0, 0.06, 0], pommel: [0, endY * k, 0] };
  } else if (KIND === 'shield') {
    const Zc = axes[2], Yc = axes[0];
    const t = pos.map(p => proj(p, Yc)), lo = Math.min(...t), hi = Math.max(...t), xb = axes[1];
    const widthAt = (a, b) => { const w = pos.filter((p, i) => t[i] >= a && t[i] <= b).map(p => proj(p, xb)); return w.length ? Math.max(...w) - Math.min(...w) : 0; };
    const span = hi - lo, topWider = widthAt(hi - 0.15 * span, hi) >= widthAt(lo, lo + 0.15 * span);
    Y = scl(Yc, (topWider ? 1 : -1) * (FLIPY ? -1 : 1));
    const r = pos.map(p => Math.hypot(proj(p, xb), proj(p, Yc))), rmax = Math.max(...r), z = pos.map(p => proj(p, Zc));
    const centre = z.filter((_, i) => r[i] < 0.25 * rmax), rim = z.filter((_, i) => r[i] > 0.8 * rmax);
    const avg = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    const frontSign = (pct(centre, 0.9) - avg(rim)) >= 0 ? 1 : -1;
    Z = scl(Zc, frontSign * (FLIPZ ? -1 : 1)); X = norm(cross(Y, Z)); Y = norm(cross(Z, X)); k = SIZE / span;
    const zz = pos.map(p => dot(sub(p, centroid), Z)), back = pct(zz, 0.02), front = pct(zz, 0.98);
    const yMid = (lo + hi) / 2 * (topWider ? 1 : -1);
    origin = [centroid[0] + Y[0] * yMid + Z[0] * (back - 0.035 / k), centroid[1] + Y[1] * yMid + Z[1] * (back - 0.035 / k), centroid[2] + Y[2] * yMid + Z[2] * (back - 0.035 / k)];
    empties = { fx_core: [0, 0, (front - back) * k + 0.035], rim_top: [0, span / 2 * k, 0.035] };
  } else { console.error('legacy --kind is sword or shield; other items: --spec <id> (assets/models/items/items.json)'); process.exit(2); }
  const P2 = new Float32Array(pos.length * 3), N2 = new Float32Array(pos.length * 3), T2 = new Float32Array(pos.length * 2);
  pos.forEach((p, i) => { const d = sub(p, origin); P2.set([dot(d, X) * k, dot(d, Y) * k, dot(d, Z) * k], i * 3); const n = nrm[i]; N2.set(norm([dot(n, X), dot(n, Y), dot(n, Z)]), i * 3); T2.set(uv[i], i * 2); });
  const em = Object.fromEntries(Object.entries(empties).map(([n, p]) => [n, { p }]));
  const bytes = writeItem({ G, J, material }, out, { P: P2, N: N2, T: T2, I: Uint32Array.from(idx) }, em, { kind: KIND, size: SIZE, legacy: true });
  const b = bbox3(Array.from({ length: P2.length / 3 }, (_, i) => [P2[i * 3], P2[i * 3 + 1], P2[i * 3 + 2]]));
  console.log(out, KIND, (idx.length / 3) + ' tris', 'x', b.min[0].toFixed(2), b.max[0].toFixed(2), 'y', b.min[1].toFixed(2), b.max[1].toFixed(2), 'z', b.min[2].toFixed(2), b.max[2].toFixed(2), JSON.stringify(empties), (bytes / 1024).toFixed(0) + ' kB', '(legacy; use --spec <id>)');
}

// ------------------------------------------------------------------ main
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (flag('--all')) batch();
  else if (opt('--spec')) {
    const id = opt('--spec'), [inp = path.join(DIR, `${id}_raw.glb`), out = path.join(DIR, `${id}.glb`)] = positional;
    const sp = specFor(id), r = sp.procedural ? prepProcedural(id, sp, positional[1] || path.join(DIR, `${id}.glb`)) : prepItem(id, sp, inp, out, { tris: opt('--tris') ? Number(opt('--tris')) : undefined });
    printRows([r]); printWarnings([r]);
  } else if (opt('--kind')) legacy();
  else usage();
}
