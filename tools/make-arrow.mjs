// The Beastmaster's arrow, built procedurally in grip space (docs/remodel/03-weapons-and-sockets.md §4.3, §7): the
// Tripo raw came out as a javelin. Origin = the nock (the arrow's rear end), +Y toward the arrowhead, 0.85 m overall:
// a 6-sided shaft Ø 9 mm, a flared nock, an iron ferrule and a leaf-shaped head 6 cm long (width along X, ridge on ±Z),
// three grey vanes 0.10 m at the rear (the cock vane on +Z). 69 triangles. Colours come from a 64×64 PNG with four flat
// patches (wood, iron, feather, nock) — a base-colour map, because the assembler atlases maps and ignores vertex
// colours; the material is double-sided (the vanes are single faces, as are the champion bodies' materials).
// Empty: `tip` at the head's point.
//
//   node tools/make-arrow.mjs [out.glb] [--length 0.85]        (tools/item-prep.mjs --all builds it from items.json)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { GlbWriter, sub, cross, norm } from './glb-lib.mjs';

const PATCH = { wood: [0.25, 0.25], iron: [0.75, 0.25], feather: [0.25, 0.75], nock: [0.75, 0.75] }; // UV centres
const COLOUR = { wood: [138, 90, 50], iron: [93, 100, 107], feather: [190, 190, 184], nock: [43, 33, 27] };  // sRGB

// minimal RGB PNG (8 bit, no filter), deflated with node:zlib
function png(w, h, rgbAt) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = rgbAt(x, y), o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type, 'ascii'), len = Buffer.alloc(4), cr = Buffer.alloc(4); len.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function buildArrow({ length: L = 0.85 } = {}) {
  const P = [], N = [], T = [], I = [];
  const vert = (p, n, mat) => { P.push(...p); N.push(...norm(n)); T.push(...PATCH[mat]); return P.length / 3 - 1; };
  const tri = (a, b, c) => I.push(a, b, c);
  const SIDES = 6, ang = k => (k / SIDES) * Math.PI * 2;
  // a smooth-shaded ring band between two heights (outward normals), optional end cap
  const band = (y0, r0, y1, r1, mat, capAt = null) => {
    const slope = (r0 - r1) / (y1 - y0), a = [], b = [];
    for (let k = 0; k < SIDES; k++) { const c = Math.cos(ang(k)), s = Math.sin(ang(k)), n = [c, slope, s]; a.push(vert([r0 * c, y0, r0 * s], n, mat)); b.push(vert([r1 * c, y1, r1 * s], n, mat)); }
    for (let k = 0; k < SIDES; k++) { const k1 = (k + 1) % SIDES; tri(a[k], b[k], b[k1]); tri(a[k], b[k1], a[k1]); } // outward (CCW seen from outside)
    if (capAt !== null) { // flat cap (fan without centre: SIDES − 2 triangles)
      const y = capAt === 0 ? y0 : y1, r = capAt === 0 ? r0 : r1, dn = capAt === 0 ? -1 : 1, ring = [];
      for (let k = 0; k < SIDES; k++) ring.push(vert([r * Math.cos(ang(k)), y, r * Math.sin(ang(k))], [0, dn, 0], mat));
      for (let k = 1; k < SIDES - 1; k++) dn < 0 ? tri(ring[0], ring[k], ring[k + 1]) : tri(ring[0], ring[k + 1], ring[k]);
    }
  };
  const R = 0.0045, headLen = 0.06, yb = L - headLen;
  band(0, 0.0055, 0.018, 0.0048, 'nock', 0);                 // nock, rear cap
  band(0.015, R, yb - 0.012, R, 'wood');                      // shaft
  band(yb - 0.016, R, yb + 0.004, 0.0056, 'iron');            // ferrule (socket of the head)
  // leaf head: outline in the XY plane, a ridge apex on each face (±Z)
  const out = [[0, 0], [0.0085, 0.008], [0.0115, 0.022], [0.009, 0.038], [0.004, 0.051], [0, headLen], [-0.004, 0.051], [-0.009, 0.038], [-0.0115, 0.022], [-0.0085, 0.008]];
  for (const side of [1, -1]) {
    const apex = [0, yb + 0.022, side * 0.0028];
    for (let k = 0; k < out.length; k++) {
      const p = [out[k][0], yb + out[k][1], 0], q = [out[(k + 1) % out.length][0], yb + out[(k + 1) % out.length][1], 0];
      let n = cross(sub(p, apex), sub(q, apex)); if (n[2] * side < 0) n = n.map(v => -v);
      const a = vert(apex, n, 'iron'), b = vert(p, n, 'iron'), c = vert(q, n, 'iron');
      const fn = cross(sub(P.slice(b * 3, b * 3 + 3), P.slice(a * 3, a * 3 + 3)), sub(P.slice(c * 3, c * 3 + 3), P.slice(a * 3, a * 3 + 3)));
      fn[2] * side > 0 ? tri(a, b, c) : tri(a, c, b);         // wind toward the face's side
    }
  }
  // three vanes, single faces in the plane of the shaft axis; the cock vane on +Z
  const vane = [[R, 0.020], [0.012, 0.028], [0.014, 0.050], [0.010, 0.085], [R, 0.120]];
  for (const deg of [90, 210, 330]) {
    const th = deg * Math.PI / 180, rd = [Math.cos(th), 0, Math.sin(th)], tn = [-Math.sin(th), 0, Math.cos(th)];
    const vs = vane.map(([rho, y]) => vert([rd[0] * rho, y, rd[2] * rho], tn, 'feather'));
    for (let k = 1; k < vs.length - 1; k++) tri(vs[0], vs[k], vs[k + 1]);
  }
  const image = png(64, 64, (x, y) => COLOUR[x < 32 ? (y < 32 ? 'wood' : 'feather') : (y < 32 ? 'iron' : 'nock')]);
  return { P: Float32Array.from(P), N: Float32Array.from(N), T: Float32Array.from(T), I: Uint32Array.from(I), image, empties: { tip: [0, L, 0] } };
}

export function writeArrow(out, opts = {}) {
  const a = buildArrow(opts), extras = { id: 'arrow', kind: 'arrow', size: opts.length ?? 0.85, procedural: 'tools/make-arrow.mjs', tris: a.I.length / 3, ...(opts.extras || {}) };
  const o = { asset: { version: '2.0', generator: 'runefall make-arrow', extras: { item: extras } }, scene: 0, scenes: [{ nodes: [0] }], nodes: [], meshes: [],
    materials: [{ name: 'arrow', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.75 }, doubleSided: true }],
    samplers: [{}], textures: [{ source: 0, sampler: 0 }], images: [] };
  const W = new GlbWriter(o);
  o.images.push({ name: 'arrow_basecolor.png', mimeType: 'image/png', bufferView: W.view(a.image) });
  o.meshes.push({ name: 'item', primitives: [{ attributes: { POSITION: W.accessor(a.P, 'VEC3', 5126, { minmax: true, target: 34962 }), NORMAL: W.accessor(a.N, 'VEC3', 5126, { target: 34962 }), TEXCOORD_0: W.accessor(a.T, 'VEC2', 5126, { target: 34962 }) }, indices: W.accessor(a.I, 'SCALAR', 5125, { target: 34963 }), material: 0 }] });
  o.nodes.push({ name: 'item', mesh: 0, children: [] });
  for (const [name, p] of Object.entries(a.empties)) { o.nodes.push({ name, translation: p.map(v => +v.toFixed(5)) }); o.nodes[0].children.push(o.nodes.length - 1); }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const bytes = W.write(out);
  const bb = [0, 1, 2].map(c => { let lo = Infinity, hi = -Infinity; for (let i = c; i < a.P.length; i += 3) { lo = Math.min(lo, a.P[i]); hi = Math.max(hi, a.P[i]); } return [lo, hi]; });
  return { tris: a.I.length / 3, bytes, size: bb.map(([lo, hi]) => hi - lo), empties: a.empties };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), li = args.indexOf('--length'), length = li >= 0 ? Number(args[li + 1]) : 0.85;
  const out = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--length') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets/models/items/arrow.glb');
  const r = writeArrow(out, { length });
  console.log(`${path.basename(out)}: ${r.tris} tris, ${r.size.map(v => v.toFixed(3)).join(' × ')} m, empties ${Object.keys(r.empties).join(' ')}, ${(r.bytes / 1024).toFixed(1)} kB`);
}
