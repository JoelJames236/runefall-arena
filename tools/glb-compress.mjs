// Compress a shipped GLB (docs/remodel/07-performance.md §3 step 6): textures to KTX2 (KHR_texture_basisu) — base
// colour, emissive and ORM as ETC1S, normal maps as UASTC — and geometry with EXT_meshopt_compression (vertices
// reordered for locality first). The game loads both with three's KTX2Loader + MeshoptDecoder (champions.js).
//
//   node tools/glb-compress.mjs <in.glb> <out.glb> [--etc1s-q 160] [--normal-q 255] [--normal uastc] [--uastc-q 2]
//
// Normal maps default to ETC1S at a high quality level (UASTC is ~4× bigger: --normal uastc). Vertex data is quantized
// first (KHR_mesh_quantization): normals int8, UVs uint16, joints / weights uint8 — positions stay float, so skins and
// bind matrices are untouched.
//
// Needs KTX-Software's toktx (installed per user: %LOCALAPPDATA%\Programs\KTX-Software\bin, or on PATH, or --toktx
// <exe>) and the meshoptimizer npm package in tools/node_modules (npm install --prefix tools --no-save
// meshoptimizer@1.3.0).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readGlb, readAccessor, GlbWriter } from './glb-lib.mjs';
import { MeshoptEncoder } from './node_modules/meshoptimizer/index.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [inp, out] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!inp || !out) { console.error('usage: node tools/glb-compress.mjs <in.glb> <out.glb> [--etc1s-q 160] [--uastc-q 2] [--normal etc1s]'); process.exit(2); }
const QL = opt('--etc1s-q', '160'), NQL = opt('--normal-q', '255'), UQ = opt('--uastc-q', '2'), NORMAL_ETC1S = opt('--normal', 'etc1s') !== 'uastc';
const TOKTX = opt('--toktx', [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'KTX-Software', 'bin', 'toktx.exe'), 'toktx'].find(p => p === 'toktx' || fs.existsSync(p)));

const G = readGlb(inp), J = JSON.parse(JSON.stringify(G.json));
const bvBytes = i => { const v = G.json.bufferViews[i]; return G.bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength); };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }, BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

// ------------------------------------------------------------------ textures → KTX2
// colour space per image from the material slots that use it (normal / ORM linear, base colour / emissive sRGB)
const role = new Map();
const mark = (ti, r) => { if (ti == null) return; const src = J.textures[ti.index].source; if (src != null && !role.has(src)) role.set(src, r); };
for (const m of J.materials || []) {
  mark(m.pbrMetallicRoughness?.baseColorTexture, 'srgb'); mark(m.emissiveTexture, 'srgb');
  mark(m.normalTexture, 'normal'); mark(m.pbrMetallicRoughness?.metallicRoughnessTexture, 'linear'); mark(m.occlusionTexture, 'linear');
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glb-compress-'));
const ktx = [];
for (const [i, im] of (J.images || []).entries()) {
  if (im.mimeType === 'image/ktx2') { ktx[i] = Buffer.from(bvBytes(im.bufferView)); continue; }
  const ext = im.mimeType === 'image/png' ? '.png' : '.jpg', src = path.join(tmp, `img${i}${ext}`), dst = path.join(tmp, `img${i}.ktx2`);
  fs.writeFileSync(src, bvBytes(im.bufferView));
  const r = role.get(i) || 'srgb';
  const enc = r === 'normal' && !NORMAL_ETC1S
    ? ['--encode', 'uastc', '--uastc_quality', UQ, '--uastc_rdo_l', '1.0', '--zcmp', '18']
    : ['--encode', 'etc1s', '--clevel', '2', '--qlevel', r === 'normal' ? NQL : QL];
  execFileSync(TOKTX, ['--t2', '--genmipmap', ...enc, '--assign_oetf', r === 'srgb' ? 'srgb' : 'linear', '--assign_primaries', r === 'srgb' ? 'bt709' : 'none', dst, src], { stdio: ['ignore', 'ignore', 'pipe'] });
  ktx[i] = fs.readFileSync(dst);
  console.log(`  image ${i} (${im.name || ''}, ${r}): ${(bvBytes(im.bufferView).length / 1024).toFixed(0)} kB ${ext.slice(1)} -> ${(ktx[i].length / 1024).toFixed(0)} kB ktx2 (${r === 'normal' && !NORMAL_ETC1S ? 'UASTC' : 'ETC1S'})`);
}
fs.rmSync(tmp, { recursive: true, force: true });
for (const t of J.textures || []) {
  if (t.source == null) continue;
  t.extensions = { ...(t.extensions || {}), KHR_texture_basisu: { source: t.source } }; delete t.source;
}

// ------------------------------------------------------------------ geometry → EXT_meshopt_compression
await MeshoptEncoder.ready;
const acc = J.accessors, owner = new Map(); // bufferView → { mode, accessor }
// reorder every primitive's vertices for locality (meshopt compresses neighbouring vertices best)
const data = new Map();                     // accessor → Uint8Array (quantized and/or remapped)
const stride = new Map();                   // accessor → bytes per element when padded (int8 normals: 4)
const strideOf = a => stride.get(a) || SIZE[acc[a].type] * BYTES[acc[a].componentType];
// KHR_mesh_quantization: smaller vertices, and integers compress far better than floats
let quantized = 0;
const qDone = new Set();
for (const m of J.meshes || []) for (const p of m.primitives) for (const [name, a] of Object.entries(p.attributes)) {
  if (qDone.has(a)) continue; qDone.add(a);
  const A = acc[a]; if (A.componentType !== 5126 && !(name === 'JOINTS_0')) continue;
  const f = readAccessor(G, a), n = A.count;
  if (name === 'NORMAL') {
    const q = new Int8Array(n * 4);
    for (let v = 0; v < n; v++) { const x = f[v * 3], y = f[v * 3 + 1], z = f[v * 3 + 2], l = Math.hypot(x, y, z) || 1; q[v * 4] = Math.round(x / l * 127); q[v * 4 + 1] = Math.round(y / l * 127); q[v * 4 + 2] = Math.round(z / l * 127); }
    data.set(a, new Uint8Array(q.buffer)); stride.set(a, 4); Object.assign(A, { componentType: 5120, normalized: true }); delete A.min; delete A.max; quantized++;
  } else if (name.startsWith('TEXCOORD') && f.every(x => x >= 0 && x <= 1)) {
    const q = new Uint16Array(n * 2); for (let k = 0; k < n * 2; k++) q[k] = Math.round(f[k] * 65535);
    data.set(a, new Uint8Array(q.buffer)); Object.assign(A, { componentType: 5123, normalized: true }); delete A.min; delete A.max; quantized++;
  } else if (name === 'JOINTS_0' && f.every(x => x < 256)) {
    data.set(a, Uint8Array.from(f)); A.componentType = 5121; delete A.min; delete A.max; quantized++;
  } else if (name === 'WEIGHTS_0') {
    const q = new Uint8Array(n * 4);
    for (let v = 0; v < n; v++) {
      let sum = 0, big = 0; for (let c = 0; c < 4; c++) { q[v * 4 + c] = Math.round(f[v * 4 + c] * 255); sum += q[v * 4 + c]; if (q[v * 4 + c] > q[v * 4 + big]) big = c; }
      q[v * 4 + big] = Math.max(0, Math.min(255, q[v * 4 + big] + 255 - sum)); // weights still sum to 1
    }
    data.set(a, q); Object.assign(A, { componentType: 5121, normalized: true }); delete A.min; delete A.max; quantized++;
  }
}
const accBytes = a => { const A = acc[a]; const v = G.json.bufferViews[A.bufferView]; const n = A.count * SIZE[A.type] * BYTES[A.componentType]; return new Uint8Array(G.bin.buffer, G.bin.byteOffset + (v.byteOffset || 0) + (A.byteOffset || 0), n).slice(); };
for (const m of J.meshes || []) for (const p of m.primitives) {
  if (p.indices === undefined || (p.mode ?? 4) !== 4) continue;
  const ia = acc[p.indices], raw = accBytes(p.indices);
  const idx = ia.componentType === 5125 ? new Uint32Array(raw.buffer) : Uint32Array.from(new Uint16Array(raw.buffer));
  const [remap, unique] = MeshoptEncoder.reorderMesh(idx, true, true);
  const attrs = Object.values(p.attributes);
  for (const a of attrs) {
    const A = acc[a], es = strideOf(a), src = data.get(a) || accBytes(a), dst = new Uint8Array(unique * es);
    for (let v = 0; v < A.count; v++) { const t = remap[v]; if (t !== 0xffffffff) dst.set(src.subarray(v * es, v * es + es), t * es); }
    data.set(a, dst); A.count = unique;
  }
  data.set(p.indices, ia.componentType === 5125 ? new Uint8Array(idx.buffer) : new Uint8Array(Uint16Array.from(idx).buffer));
  for (const a of attrs) owner.set(acc[a].bufferView, { mode: 'ATTRIBUTES', a });
  owner.set(ia.bufferView, { mode: 'TRIANGLES', a: p.indices });
}
// remaining accessors (inverse bind matrices, animation keys): attribute mode too
for (const [a, A] of acc.entries()) if (A.bufferView !== undefined && !owner.has(A.bufferView)) {
  const es = SIZE[A.type] * BYTES[A.componentType]; if (es % 4 === 0 && es <= 256) owner.set(A.bufferView, { mode: 'ATTRIBUTES', a });
}

// ------------------------------------------------------------------ write: one data buffer + a fallback buffer
const Wr = new GlbWriter(J); // resets bufferViews / accessors / buffers
const oldViews = G.json.bufferViews, newView = [];
let fallbackLen = 0;
for (const [i, v] of oldViews.entries()) {
  const own = owner.get(i);
  if (own) {
    const A = acc[own.a], es = own.mode === 'TRIANGLES' ? BYTES[A.componentType] : strideOf(own.a);
    const src = data.get(own.a) || accBytes(own.a);
    const enc = MeshoptEncoder.encodeGltfBuffer(src, own.mode === 'TRIANGLES' ? A.count : A.count, es, own.mode);
    const at = Wr.view(enc); const cv = J.bufferViews[at];
    const size = src.length, off = fallbackLen; fallbackLen += Math.ceil(size / 4) * 4;
    newView[i] = { buffer: 1, byteOffset: off, byteLength: size, ...(own.mode === 'ATTRIBUTES' && v.target === 34962 ? { byteStride: es } : {}), ...(v.target ? { target: v.target } : {}),
      extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: cv.byteOffset, byteLength: cv.byteLength, byteStride: es, mode: own.mode, count: A.count } } };
  } else {
    const isImage = (J.images || []).findIndex(im => im.bufferView === i);
    const bytes = isImage >= 0 && ktx[isImage] ? ktx[isImage] : bvBytes(i);
    const at = Wr.view(bytes); newView[i] = { ...J.bufferViews[at], ...(v.target ? { target: v.target } : {}) };
  }
}
J.bufferViews = newView;
J.accessors = acc.map(a => { const A = { ...a }; if (A.byteOffset && owner.has(A.bufferView)) delete A.byteOffset; return A; }); // a decoded view holds exactly its accessor
for (const im of J.images || []) if (ktx[J.images.indexOf(im)]) im.mimeType = 'image/ktx2';

const used = new Set([...(J.extensionsUsed || []), 'KHR_texture_basisu', 'EXT_meshopt_compression']);
if (quantized) used.add('KHR_mesh_quantization');
J.extensionsUsed = [...used]; J.extensionsRequired = [...new Set([...(J.extensionsRequired || []), 'KHR_texture_basisu', 'EXT_meshopt_compression', ...(quantized ? ['KHR_mesh_quantization'] : [])])];
// buffer 0 = the GLB's binary chunk (GlbWriter.write sets its length), buffer 1 = the uncompressed fallback (no data)
J.buffers = [{ byteLength: 0 }, { byteLength: fallbackLen, extensions: { EXT_meshopt_compression: { fallback: true } } }];
const bytes = Wr.write(out);
const before = fs.statSync(inp).size;
console.log(`${path.basename(out)}: ${(before / 1024).toFixed(0)} kB -> ${(bytes / 1024).toFixed(0)} kB (KTX2 ${ktx.filter(Boolean).length} images, ${quantized} attributes quantized, meshopt ${owner.size} buffer views)`);
