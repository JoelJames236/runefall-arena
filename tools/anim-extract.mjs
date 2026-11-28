// Extract the skeleton (rest pose) and the animations from a GLB exported by Tripo Studio (a rigged character with
// its animations) into a small JSON the game loads (js/render/attack-anims.js) — no mesh, no textures.
//   node tools/anim-extract.mjs <in.glb> <out.json> [--name clipName] [--map map.json]
//   node tools/anim-extract.mjs <in.glb> [more.glb …] --set <set> [--map map.json] [--out out.json]
//     one clip set of the animation manifest (docs/remodel/05-animations.md §7): writes assets/models/anims/<set>.json
//     (or --out), the map defaults to assets/models/anims/<set>.map.json; several exports of the same skeleton merge.
//     It then lists the manifest's clips of <set>.json that are still missing and, written to the default place,
//     switches the set on in manifest.json (files: { "<set>.json": false → true })
// JSON: { bones: [{ name, parent, t, r, s }], clips: [{ name, prompt, duration, tracks: [{ node, path, times, values }] }] }
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

//   --map <file.json>: [[regex, id], …] or { id: regex, … } — clips whose (prompt) name matches regex get that id
//   (any manifest id: sword_fore, sns_atk_1, cm_run …); others are dropped. An optional third element
//   [regex, id, { markers: {…} }] is copied onto the clip as `meta` (markers measured elsewhere; the manifest wins).
const args = process.argv.slice(2);
const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const OPTS = ['--name', '--map', '--set', '--out'];
const pos = args.filter((a, i) => !a.startsWith('--') && !OPTS.includes(args[i - 1]));
const ROOT = fileURLToPath(new URL('..', import.meta.url)), ANIMS = join(ROOT, 'assets', 'models', 'anims');
const SET = opt('--set');
const inputs = SET ? pos.filter(p => !/\.json$/i.test(p)) : pos.slice(0, 1);
const out = opt('--out') || (SET ? pos.find(p => /\.json$/i.test(p)) || join(ANIMS, SET + '.json') : pos[1]);
if (!inputs.length || !out) {
  console.error('usage: node tools/anim-extract.mjs <in.glb> <out.json> [--name clip] [--map map.json]\n' +
    '       node tools/anim-extract.mjs <in.glb> [more.glb …] --set <set> [--map map.json] [--out out.json]');
  process.exit(1);
}
const rename = opt('--name');
const mapFile = opt('--map') || (SET && existsSync(join(ANIMS, SET + '.map.json')) ? join(ANIMS, SET + '.map.json') : null);
const rawMap = mapFile ? JSON.parse(readFileSync(mapFile, 'utf8')) : null;
const MAP = rawMap ? (Array.isArray(rawMap) ? rawMap : Object.entries(rawMap).map(([id, re]) => [re, id])).map(([re, id, meta]) => {
  // ids become clip names in the game: heroes.js reserves "raw:<id>" and "<id>|offL"
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(id)) { console.error('bad clip id in the map:', JSON.stringify(id)); process.exit(1); }
  return [new RegExp(re, 'i'), id, meta];
}) : null;
if (SET && !MAP) console.warn('--set without a map: clips keep their Tripo (prompt) names');
// finger curls are dropped (Mixamo "LeftHandIndex1", UE "index_01_l" / "index_metacarpal_l"): the game poses the hands
const FINGER = /(index|middle|ring|pinky|thumb)\d|(^|[^a-z])(index|middle|ring|pinky|thumb)_(\d|metacarpal)/i;
const COMP = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const round = (arr, k = 5) => arr.map(v => +v.toFixed(k));

function extract(inp) {
  const buf = readFileSync(inp);
  const jsonLen = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
  const binStart = 20 + jsonLen + 8, bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));
  function read(ai) {
    const a = json.accessors[ai], bv = json.bufferViews[a.bufferView], T = COMP[a.componentType], n = a.count * SIZE[a.type];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride;
    if (!stride || stride === T.BYTES_PER_ELEMENT * SIZE[a.type]) return Array.from(new T(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + n * T.BYTES_PER_ELEMENT)));
    const outA = [];
    for (let i = 0; i < a.count; i++) { const v = new T(bin.buffer.slice(bin.byteOffset + off + i * stride, bin.byteOffset + off + i * stride + SIZE[a.type] * T.BYTES_PER_ELEMENT)); outA.push(...v); }
    return outA;
  }
  // every node that is not a mesh (armature, bones) keeps its rest transform and parent
  const parent = {}; json.nodes.forEach((n, i) => (n.children || []).forEach(c => { parent[c] = i; }));
  const keep = json.nodes.map((n, i) => n.mesh === undefined && !n.camera ? i : -1).filter(i => i >= 0);
  const index = new Map(keep.map((n, k) => [n, k]));
  const bones = keep.map(i => {
    const n = json.nodes[i];
    let p = parent[i]; while (p !== undefined && !index.has(p)) p = parent[p];
    return { name: n.name, parent: p === undefined ? -1 : index.get(p), t: round(n.translation || [0, 0, 0]), r: round(n.rotation || [0, 0, 0, 1], 6), s: round(n.scale || [1, 1, 1]) };
  });
  const used = new Set();
  const clips = (json.animations || []).map((a, k) => {
    let duration = 0;
    // rotations of every bone, the hips' translation (root motion); constant translation / scale tracks are dropped
    // (finger curls are dropped: the game's hands grip their weapons in the idle pose)
    const tracks = a.channels.filter(c => index.has(c.target.node) && !FINGER.test(json.nodes[c.target.node].name) && (c.target.path === 'rotation' || (c.target.path === 'translation' && /hips|pelvis/i.test(json.nodes[c.target.node].name)))).map(c => {
      const s = a.samplers[c.sampler], times = read(s.input), values = read(s.output);
      duration = Math.max(duration, times[times.length - 1]);
      return { node: index.get(c.target.node), path: c.target.path, times: round(times, 4), values: round(values, 4) };
    });
    const hit = MAP ? MAP.find(([re]) => re.test(a.name)) : null, id = hit ? hit[1] : null;
    if (hit) used.add(hit);
    const clip = { name: MAP ? id : rename ? (json.animations.length > 1 ? rename + '_' + k : rename) : a.name, prompt: a.name, duration, tracks };
    if (hit && hit[2]) clip.meta = hit[2];
    return clip;
  }).filter(c => c.name);
  return { bones, clips, used };
}

const parts = inputs.map(extract);
const { bones } = parts[0];
const sig = b => b.map(x => x.name + '>' + x.parent).join('|');
for (let i = 1; i < parts.length; i++) {
  if (sig(parts[i].bones) !== sig(bones)) { console.error(inputs[i], 'has another skeleton than', inputs[0], '— one set needs one animation master'); process.exit(1); }
}
let clips = parts.flatMap(p => p.clips);
// an id given to two motions: the set keeps the first (the game looks clips up by name)
const seen = new Map();
for (const c of clips) { if (seen.has(c.name)) console.warn('two motions map to', c.name + ':', JSON.stringify(seen.get(c.name).slice(0, 64)), 'and', JSON.stringify(c.prompt.slice(0, 64)) + (SET ? ' — keeping the first' : '')); else seen.set(c.name, c.prompt); }
if (SET) clips = clips.filter((c, i) => clips.findIndex(d => d.name === c.name) === i);
if (MAP) for (const m of MAP) if (!parts.some(p => p.used.has(m))) console.warn('map entry matched no motion:', m[1], m[0]);
writeFileSync(out, JSON.stringify({ bones, clips }));
console.log(out, 'bones', bones.length, 'clips', clips.map(c => c.name + ' ' + c.duration.toFixed(2) + 's ' + c.tracks.length + 'tr').join(', '), ((JSON.stringify({ bones, clips }).length) / 1024).toFixed(0) + ' kB');

// a clip set: say which manifest clips of this file are still missing, and which motions no manifest entry uses
if (SET) {
  const mf = join(ANIMS, 'manifest.json');
  const man = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')) : null;
  const file = SET + '.json', names = new Set(clips.map(c => c.name));
  const want = man ? Object.entries(man.clips || {}).filter(([, e]) => e.file === file) : [];
  if (!man) console.log('no manifest.json yet');
  else if (!want.length) console.log('manifest.json has no clips in', file);
  else {
    const missing = want.filter(([id, e]) => !names.has(e.src || id)).map(([id, e]) => id + (e.src && e.src !== id ? ' (src ' + e.src + ')' : ''));
    const srcs = new Set(want.map(([id, e]) => e.src || id)), unused = [...names].filter(n => !srcs.has(n));
    console.log('manifest', file + ':', want.length - missing.length + '/' + want.length, 'clips found' + (missing.length ? '; missing: ' + missing.join(', ') : '') + (unused.length ? '; not in the manifest: ' + unused.join(', ') : ''));
  }
  // the set file now exists where the game reads it: switch it on in the manifest (files: { "<set>.json": false })
  const atHome = resolve(out) === resolve(join(ANIMS, file));
  if (!atHome) console.log('(written to', out, '— the game reads', join('assets', 'models', 'anims', file) + ')');
  else if (man) {
    const text = readFileSync(mf, 'utf8'), key = new RegExp('("' + file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\s*:\\s*)false');
    if (key.test(text)) { writeFileSync(mf, text.replace(key, '$1true')); console.log('manifest.json: files["' + file + '"] → true'); }
  }
}
