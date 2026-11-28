// Small GLB toolkit for the remodel tools (fit-sockets, item-prep, assemble-champion): read accessors, walk the node
// tree, 4×4 matrix maths, and write a new GLB from typed arrays. Node only, nothing to install.
import fs from 'node:fs';

// ------------------------------------------------------------------ read
export function readGlb(path) {
  const buf = fs.readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + path);
  let off = 12, json = null, bin = Buffer.alloc(0);
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8')); else if (type === 0x004e4942) bin = Buffer.from(data);
    off += 8 + len;
  }
  return { json, bin };
}
const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
export const compSize = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
// an accessor as a fresh typed array (de-interleaved, normalized integers left as they are)
export function readAccessor({ json, bin }, i) {
  const a = json.accessors[i], T = COMP[a.componentType], n = SIZE[a.type], out = new T(a.count * n);
  if (a.bufferView === undefined) return out;
  const bv = json.bufferViews[a.bufferView], base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const es = T.BYTES_PER_ELEMENT, stride = bv.byteStride || es * n;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = dv[get](base + k * stride + c * es, true);
  return out;
}
export function imageBytes({ json, bin }, imgIndex) {
  const im = json.images[imgIndex], bv = json.bufferViews[im.bufferView];
  return { bytes: bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength), mime: im.mimeType };
}

// ------------------------------------------------------------------ matrices (column-major, like glTF)
export const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}
export function inv(m) {
  const a = m, o = new Array(16);
  const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
  const b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6], b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
  const b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; if (!det) throw new Error('singular matrix');
  const d = 1 / det;
  o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * d; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * d; o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * d; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * d;
  o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * d; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * d; o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * d; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * d;
  o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * d; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * d; o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * d; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * d;
  o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * d; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * d; o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * d; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * d;
  return o;
}
export function compose(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0, (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
}
export const nodeMatrix = n => n.matrix ? n.matrix.slice() : compose(n.translation, n.rotation, n.scale);
export function decompose(m) {
  const sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
  const r = [m[0] / sx, m[1] / sx, m[2] / sx, m[4] / sy, m[5] / sy, m[6] / sy, m[8] / sz, m[9] / sz, m[10] / sz];
  return { t: [m[12], m[13], m[14]], q: quatFromBasis(r), s: [sx, sy, sz] };
}
// rotation (3×3, column-major: x axis, y axis, z axis) → quaternion [x, y, z, w]
export function quatFromBasis(r) {
  const m11 = r[0], m21 = r[1], m31 = r[2], m12 = r[3], m22 = r[4], m32 = r[5], m13 = r[6], m23 = r[7], m33 = r[8], tr = m11 + m22 + m33;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); return [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s]; }
  if (m11 > m22 && m11 > m33) { const s = 2 * Math.sqrt(1 + m11 - m22 - m33); return [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s]; }
  if (m22 > m33) { const s = 2 * Math.sqrt(1 + m22 - m11 - m33); return [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s]; }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22); return [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s];
}
export const basis = (x, y, z, t = [0, 0, 0]) => [...x, 0, ...y, 0, ...z, 0, ...t, 1];
export const xform = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
export const xdir = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
// vectors
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// world matrices of every node (scene space)
export function worldMatrices(json) {
  const W = new Array(json.nodes.length).fill(null), parent = {};
  json.nodes.forEach((n, i) => (n.children || []).forEach(c => { parent[c] = i; }));
  const get = i => { if (W[i]) return W[i]; const m = nodeMatrix(json.nodes[i]); W[i] = parent[i] === undefined ? m : mul(get(parent[i]), m); return W[i]; };
  json.nodes.forEach((_, i) => get(i));
  return { W, parent };
}

// principal axes of a point cloud (Jacobi eigen-decomposition of the 3×3 covariance), largest first
export function pca(points) {
  const n = points.length, c = [0, 0, 0]; for (const p of points) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; } c[0] /= n; c[1] /= n; c[2] /= n;
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) { const d = sub(p, c); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) A[i][j] += d[i] * d[j] / n; }
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let p = 0, q = 1; for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(A[i][j]) > Math.abs(A[p][q])) { p = i; q = j; }
    if (Math.abs(A[p][q]) < 1e-14) break;
    const th = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]), cs = Math.cos(th), sn = Math.sin(th);
    for (let k = 0; k < 3; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = cs * akp - sn * akq; A[k][q] = sn * akp + cs * akq; }
    for (let k = 0; k < 3; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = cs * apk - sn * aqk; A[q][k] = sn * apk + cs * aqk; }
    for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = cs * vkp - sn * vkq; V[k][q] = sn * vkp + cs * vkq; }
  }
  const ev = [0, 1, 2].map(i => ({ val: A[i][i], vec: norm([V[0][i], V[1][i], V[2][i]]) })).sort((a, b) => b.val - a.val);
  return { centroid: c, axes: ev.map(e => e.vec), vals: ev.map(e => e.val) };
}

// ------------------------------------------------------------------ write
// collect views + accessors from typed arrays and images, then write one GLB
export class GlbWriter {
  constructor(json) { this.json = json; this.chunks = []; this.len = 0; json.bufferViews = []; json.accessors = []; json.buffers = [{ byteLength: 0 }]; }
  view(bytes, target) {
    const pad = (4 - (this.len % 4)) % 4; if (pad) { this.chunks.push(Buffer.alloc(pad)); this.len += pad; }
    const b = Buffer.from(bytes.buffer ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes);
    const v = { buffer: 0, byteOffset: this.len, byteLength: b.length }; if (target) v.target = target;
    this.chunks.push(b); this.len += b.length; this.json.bufferViews.push(v); return this.json.bufferViews.length - 1;
  }
  accessor(arr, type, componentType, o = {}) {
    const n = SIZE[type], count = arr.length / n;
    const bv = this.view(arr, o.target);
    const a = { bufferView: bv, componentType, count, type };
    if (o.minmax) { const mn = new Array(n).fill(Infinity), mx = new Array(n).fill(-Infinity); for (let k = 0; k < count; k++) for (let c = 0; c < n; c++) { const v = arr[k * n + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; } a.min = mn; a.max = mx; }
    if (o.normalized) a.normalized = true;
    this.json.accessors.push(a); return this.json.accessors.length - 1;
  }
  write(path) {
    const pad = (4 - (this.len % 4)) % 4; if (pad) { this.chunks.push(Buffer.alloc(pad)); this.len += pad; }
    this.json.buffers[0].byteLength = this.len;
    let js = Buffer.from(JSON.stringify(this.json), 'utf8'); const jp = (4 - (js.length % 4)) % 4; if (jp) js = Buffer.concat([js, Buffer.alloc(jp, 0x20)]);
    const bin = Buffer.concat(this.chunks), total = 12 + 8 + js.length + 8 + bin.length;
    const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
    const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
    const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
    fs.writeFileSync(path, Buffer.concat([h, jh, js, bh, bin]));
    return total;
  }
}
