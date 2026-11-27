// Extract the skeleton (rest pose) and the animations from a GLB exported by Tripo Studio (a rigged character with
// its animations) into a small JSON the game loads (js/render/attack-anims.js) — no mesh, no textures.
//   node tools/anim-extract.mjs <in.glb> <out.json> [--name clipName]
// JSON: { bones: [{ name, parent, t, r, s }], clips: [{ name, duration, tracks: [{ node, path, times, values }] }] }
import { readFileSync, writeFileSync } from 'node:fs';

//   --map <file.json>: [[regex, id], …] — clips whose (prompt) name matches regex get that id; others are dropped
const [inp, out, ...rest] = process.argv.slice(2);
const rename = rest.includes('--name') ? rest[rest.indexOf('--name') + 1] : null;
const MAP = rest.includes('--map') ? JSON.parse(readFileSync(rest[rest.indexOf('--map') + 1], 'utf8')).map(([re, id]) => [new RegExp(re, 'i'), id]) : null;
const FINGER = /(index|middle|ring|pinky|thumb)\d/i;
const buf = readFileSync(inp);
const jsonLen = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
const binStart = 20 + jsonLen + 8, bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));
const COMP = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function read(ai) {
  const a = json.accessors[ai], bv = json.bufferViews[a.bufferView], T = COMP[a.componentType], n = a.count * SIZE[a.type];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride;
  if (!stride || stride === T.BYTES_PER_ELEMENT * SIZE[a.type]) return Array.from(new T(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + n * T.BYTES_PER_ELEMENT)));
  const outA = [];
  for (let i = 0; i < a.count; i++) { const v = new T(bin.buffer.slice(bin.byteOffset + off + i * stride, bin.byteOffset + off + i * stride + SIZE[a.type] * T.BYTES_PER_ELEMENT)); outA.push(...v); }
  return outA;
}
const round = (arr, k = 5) => arr.map(v => +v.toFixed(k));
// every node that is not a mesh (armature, bones) keeps its rest transform and parent
const parent = {}; json.nodes.forEach((n, i) => (n.children || []).forEach(c => { parent[c] = i; }));
const keep = json.nodes.map((n, i) => n.mesh === undefined && !n.camera ? i : -1).filter(i => i >= 0);
const index = new Map(keep.map((n, k) => [n, k]));
const bones = keep.map(i => {
  const n = json.nodes[i];
  let p = parent[i]; while (p !== undefined && !index.has(p)) p = parent[p];
  return { name: n.name, parent: p === undefined ? -1 : index.get(p), t: round(n.translation || [0, 0, 0]), r: round(n.rotation || [0, 0, 0, 1], 6), s: round(n.scale || [1, 1, 1]) };
});
const clips = (json.animations || []).map((a, k) => {
  let duration = 0;
  // rotations of every bone, the hips' translation (root motion); constant translation / scale tracks are dropped
  // (finger curls are dropped: the game's hands grip their weapons in the idle pose)
  const tracks = a.channels.filter(c => index.has(c.target.node) && !FINGER.test(json.nodes[c.target.node].name) && (c.target.path === 'rotation' || (c.target.path === 'translation' && /hips|pelvis/i.test(json.nodes[c.target.node].name)))).map(c => {
    const s = a.samplers[c.sampler], times = read(s.input), values = read(s.output);
    duration = Math.max(duration, times[times.length - 1]);
    return { node: index.get(c.target.node), path: c.target.path, times: round(times, 4), values: round(values, 4) };
  });
  const id = MAP ? (MAP.find(([re]) => re.test(a.name)) || [])[1] : null;
  return { name: MAP ? id : rename ? (json.animations.length > 1 ? rename + '_' + k : rename) : a.name, prompt: a.name, duration, tracks };
}).filter(c => c.name);
writeFileSync(out, JSON.stringify({ bones, clips }));
console.log(out, 'bones', bones.length, 'clips', clips.map(c => c.name + ' ' + c.duration.toFixed(2) + 's ' + c.tracks.length + 'tr').join(', '), ((JSON.stringify({ bones, clips }).length) / 1024).toFixed(0) + ' kB');
