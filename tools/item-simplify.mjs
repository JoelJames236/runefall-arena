// Reduce an item GLB (tools/item-prep.mjs output: one mesh, POSITION / NORMAL / TEXCOORD_0, the empties) to a
// triangle budget (docs/remodel/03-weapons-and-sockets.md §7) when Tripo's retopology stops above it.
//   node tools/item-simplify.mjs <item.glb> <out.glb> --tris 900
// The simplifier itself (welded quadric collapses, outline locked, per-corner normals and UVs kept) is
// tools/mesh-simplify.mjs, shared with the champion LODs.
import { readGlb, readAccessor, GlbWriter } from './glb-lib.mjs';
import { simplify } from './mesh-simplify.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [inp, out] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const TARGET = Number(opt('--tris', 900));
if (!inp || !out || !(TARGET > 0)) { console.error('usage: node tools/item-simplify.mjs <item.glb> <out.glb> --tris 900'); process.exit(2); }

const G = readGlb(inp), J = G.json;
const mi = J.nodes.findIndex(n => n.mesh !== undefined), prim = J.meshes[J.nodes[mi].mesh].primitives[0];
const r = simplify({ P: readAccessor(G, prim.attributes.POSITION), N: readAccessor(G, prim.attributes.NORMAL), T: readAccessor(G, prim.attributes.TEXCOORD_0), I: readAccessor(G, prim.indices) }, TARGET);

// write: same material, images and empties
const o = JSON.parse(JSON.stringify(J)), images = (J.images || []).map(im => { const bv = J.bufferViews[im.bufferView]; return G.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength); });
const Wr = new GlbWriter(o);
(o.images || []).forEach((im, i) => { im.bufferView = Wr.view(images[i]); });
const p2 = o.meshes[o.nodes[mi].mesh].primitives[0];
p2.attributes = { POSITION: Wr.accessor(r.P, 'VEC3', 5126, { minmax: true, target: 34962 }), NORMAL: Wr.accessor(r.N, 'VEC3', 5126, { target: 34962 }), TEXCOORD_0: Wr.accessor(r.T, 'VEC2', 5126, { target: 34962 }) };
p2.indices = Wr.accessor(r.I, 'SCALAR', 5125, { target: 34963 });
o.asset.generator = (o.asset.generator || '') + ' + item-simplify';
const bytes = Wr.write(out);
const s = r.stats;
console.log(out.split(/[\\/]/).pop(), s.start, '->', s.end, 'tris | vertices', s.vertices[0], '->', s.vertices[1], '| welded', s.welded, 'locked', s.locked, '| passes', s.passes, '|', (bytes / 1024).toFixed(0), 'kB');
