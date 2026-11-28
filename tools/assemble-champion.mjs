// Assemble a shipped champion (docs/remodel/07-performance.md §3): the rigged body and its items in grip space become
// ONE skinned mesh with ONE primitive and ONE material (one draw call). Each item hangs on a new joint named after its
// socket (a child of the socket's bone, every item vertex weighted 1.0 to it), and every map of the body material
// becomes a 2048×1024 atlas: the body in the left 1024², the items shelf-packed into the right half.
//
//   node tools/assemble-champion.mjs --body <champion.glb> --key <sockets.json key> --item <socket>=<item.glb> [--item …]
//        --out <out.glb> [--sockets assets/models/champions/sockets.json] [--quality 88] [--lods 0.5,0.2]
//
// --lods: also write LOD meshes on the same skin (07 §5): fractions of the triangle count, made by
// tools/mesh-simplify.mjs (outline and skin borders kept); the last one doubles as the shadow proxy. They are listed
// in extras.remodel.lods (node names + triangles); the game shows LOD0, renders the proxy into the shadow map only.
//
// Socket frames come from tools/fit-sockets.mjs (`mesh` = the frame in the skinned mesh's bind space), items from
// tools/item-prep.mjs (metres, origin = the grip, named empties). The atlas is drawn with Windows' System.Drawing
// through PowerShell (like glb-optimize.mjs), so nothing needs installing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readGlb, readAccessor, imageBytes, worldMatrices, inv, mul, xform, xdir, sub, scl, dot, cross, norm, decompose, GlbWriter } from './glb-lib.mjs';
import { simplify } from './mesh-simplify.mjs';

const args = process.argv.slice(2);
const die = msg => { console.error('assemble-champion: ' + msg); process.exit(1); };
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BODY = opt('--body'), KEY = opt('--key'), OUT = opt('--out'), SOCKETS = opt('--sockets', 'assets/models/champions/sockets.json');
const QUALITY = Number(opt('--quality', 88));
const LODS = opt('--lods', '') ? opt('--lods').split(',').map(Number).filter(f => f > 0 && f < 1) : [];
const ITEMS = args.flatMap((a, i) => a === '--item' ? [args[i + 1]] : []).map(s => {
  const e = (s || '').indexOf('='); if (e < 1) die('--item wants <socket>=<item.glb>, got ' + s);
  return { socket: s.slice(0, e), file: s.slice(e + 1) };
});
if (!BODY || !KEY || !OUT) die('usage: node tools/assemble-champion.mjs --body <glb> --key <key> --item <socket>=<item.glb> [--item ...] --out <glb> [--sockets file]');
const AW = 2048, AH = 1024, HALF = 1024;                                       // atlas; items live in x >= HALF

// ------------------------------------------------------------------ helpers
const asFloat = (G, i) => {                                                    // accessor as floats (dequantised)
  const a = G.json.accessors[i], r = readAccessor(G, i); if (a.componentType === 5126) return r;
  const d = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 1;
  return Float32Array.from(r, x => Math.max(x / d, -1));
};
const clamp01 = x => Math.min(1, Math.max(0, x));
const lin2srgb = x => { x = clamp01(x); return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055; };
const ratio = (a, b) => (b > 1e-6 ? a / b : 1);                                // item factor relative to the body's
function imageSize(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let o = 2; o + 9 < b.length;) {
      if (b[o] !== 0xff) { o++; continue; }
      const m = b[o + 1]; if (m === 0xff || m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += m === 0xff ? 1 : 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(o + 5), w: b.readUInt16BE(o + 7) };
      o += 2 + b.readUInt16BE(o + 2);
    }
  }
  throw new Error('unsupported image (JPEG and PNG only)');
}
const p2 = x => 2 ** Math.floor(Math.log2(Math.max(1, x)));
// orthonormal, right-handed socket frame (sockets.json stores 6 decimals)
function socketFrame(m, name) {
  const X0 = [m[0], m[1], m[2]], Y0 = [m[4], m[5], m[6]], Z0 = [m[8], m[9], m[10]];
  if (dot(cross(X0, Y0), Z0) < 0) die(`socket ${name}: mirrored frame`);
  if ([X0, Y0, Z0].some(a => Math.abs(Math.hypot(...a) - 1) > 1e-3)) die(`socket ${name}: frame is scaled (expected unit axes in mesh space)`);
  const X = norm(X0), Y = norm(sub(Y0, scl(X, dot(X, Y0)))), Z = cross(X, Y);
  return [...X, 0, ...Y, 0, ...Z, 0, m[12], m[13], m[14], 1];
}
// material map roles; maps that share one body texture (e.g. packed ORM) share one atlas
const ROLES = {
  baseColor: m => m.pbrMetallicRoughness?.baseColorTexture,
  metallicRoughness: m => m.pbrMetallicRoughness?.metallicRoughnessTexture,
  normal: m => m.normalTexture,
  occlusion: m => m.occlusionTexture,
  emissive: m => m.emissiveTexture,
};
const NEUTRAL = { baseColor: f => { f[0] = f[1] = f[2] = 128; }, metallicRoughness: f => { f[1] = 255; f[2] = 0; }, normal: f => { f[0] = 128; f[1] = 128; f[2] = 255; }, occlusion: f => { f[0] = 255; }, emissive: f => { f[0] = f[1] = f[2] = 0; } };

// ------------------------------------------------------------------ body + socket entry
const B = readGlb(BODY), BJ = B.json, { W } = worldMatrices(BJ);
const meshNodes = BJ.nodes.map((n, i) => (n.mesh !== undefined ? i : -1)).filter(i => i >= 0);
const meshNode = meshNodes.find(i => BJ.nodes[i].skin !== undefined);
if (meshNode === undefined) die('no skinned mesh in ' + BODY);
if (meshNodes.length !== 1 || BJ.meshes.length !== 1 || BJ.meshes[0].primitives.length !== 1) die('the body must be one mesh node with one primitive');
const bodyMesh = BJ.meshes[BJ.nodes[meshNode].mesh], prim = bodyMesh.primitives[0], skinIdx = BJ.nodes[meshNode].skin, skin = BJ.skins[skinIdx];
if (prim.targets) die('morph targets are not supported');
if ((prim.mode ?? 4) !== 4) die('the body primitive must be a triangle list');
const ATTRS = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'];
const extraAttrs = Object.keys(prim.attributes).filter(a => !ATTRS.includes(a));
if (extraAttrs.length) die('unsupported body attributes: ' + extraAttrs.join(', '));
for (const a of ATTRS) if (prim.attributes[a] === undefined) die('the body has no ' + a);
if (BJ.asset?.extras?.remodel || ITEMS.some(it => BJ.nodes.some(n => n.name === it.socket))) die('the body already has socket joints (already assembled?) — assemble from the source body');

const allSockets = JSON.parse(fs.readFileSync(SOCKETS, 'utf8')), entry = allSockets[KEY];
if (!entry) die(`no key "${KEY}" in ${SOCKETS}`);
const M = entry.metresPerUnit;
if (entry.file && entry.file !== path.basename(BODY)) console.warn(`warning: sockets entry "${KEY}" was fitted on ${entry.file}, assembling ${path.basename(BODY)}`);

const bP = asFloat(B, prim.attributes.POSITION), bN = asFloat(B, prim.attributes.NORMAL), bT = asFloat(B, prim.attributes.TEXCOORD_0);
const bJ = Uint16Array.from(readAccessor(B, prim.attributes.JOINTS_0)), bW = asFloat(B, prim.attributes.WEIGHTS_0);
const bI = prim.indices !== undefined ? readAccessor(B, prim.indices) : Uint32Array.from({ length: bP.length / 3 }, (_, k) => k);
const bodyIBM = readAccessor(B, skin.inverseBindMatrices), nJ0 = skin.joints.length;
const Wm = W[meshNode];
{ // the entry must belong to this mesh: same bind height in the scene
  let lo = Infinity, hi = -Infinity; for (let k = 0; k < bP.length; k += 3) { const y = xform(Wm, [bP[k], bP[k + 1], bP[k + 2]])[1]; lo = Math.min(lo, y); hi = Math.max(hi, y); }
  if (Math.abs((hi - lo) - entry.bodyHeightScene) > 1e-3 * entry.bodyHeightScene) console.warn(`warning: body height ${(hi - lo).toFixed(5)} ≠ sockets entry ${entry.bodyHeightScene} — the sockets were fitted on another mesh`);
}

// body material + its maps (one atlas per distinct body texture)
const bmat = JSON.parse(JSON.stringify(BJ.materials?.[prim.material ?? -1] || { pbrMetallicRoughness: {} }));
bmat.pbrMetallicRoughness = bmat.pbrMetallicRoughness || {};
const groups = new Map();
for (const [role, get] of Object.entries(ROLES)) {
  const ti = get(bmat); if (!ti) continue;
  if (ti.texCoord) die(`body ${role} map uses TEXCOORD_${ti.texCoord}`);
  if (ti.extensions?.KHR_texture_transform) die(`body ${role} map uses KHR_texture_transform`);
  if (!groups.has(ti.index)) groups.set(ti.index, { tex: ti.index, roles: [] });
  groups.get(ti.index).roles.push(role);
}
if (!bmat.pbrMetallicRoughness.baseColorTexture) { groups.set('base', { tex: null, roles: ['baseColor'] }); bmat.pbrMetallicRoughness.baseColorTexture = { index: 'base' }; }
const bodyTexImage = ti => {
  const tx = BJ.textures[ti]; if (tx.source === undefined) die('body texture without a PNG/JPEG source');
  return imageBytes(B, tx.source);
};

// ------------------------------------------------------------------ items
const jointName = new Map(skin.joints.map((n, k) => [BJ.nodes[n].name, k]));
const seenSockets = new Set(), baseNames = ITEMS.map(it => path.basename(it.file).replace(/\.glb$/i, ''));
const items = ITEMS.map((it, ii) => {
  const sk = entry.sockets?.[it.socket]; if (!sk) die(`socket ${it.socket} is not in the sockets entry "${KEY}"`);
  if (seenSockets.has(it.socket)) die('two items on socket ' + it.socket); seenSockets.add(it.socket);
  const jp = jointName.get(sk.bone); if (jp === undefined) die(`socket ${it.socket}: bone ${sk.bone} is not a joint of the body's skin`);
  const G = readGlb(it.file), J = G.json, { W: IW } = worldMatrices(J);
  const roots = J.scenes ? J.scenes[J.scene ?? 0].nodes : J.nodes.map((_, i) => i).filter(i => !J.nodes.some(n => (n.children || []).includes(i)));
  const inScene = []; const walk = i => { inScene.push(i); (J.nodes[i].children || []).forEach(walk); }; roots.forEach(walk);
  const pos = [], nrm = [], uv = [], idx = [], empties = []; let mat, uvOut = false;
  for (const ni of inScene) {
    const n = J.nodes[ni];
    if (n.mesh === undefined) { if (!(n.children || []).length && n.name) empties.push({ name: n.name, m: IW[ni] }); continue; }
    if (n.skin !== undefined) die(`${it.file}: rigged items (bows) are not supported yet`);
    for (const p of J.meshes[n.mesh].primitives) {
      if ((p.mode ?? 4) !== 4) die(`${it.file}: only triangle lists`);
      if (mat !== undefined && p.material !== mat) die(`${it.file}: an item must use one material`);
      mat = p.material;
      if (p.attributes.NORMAL === undefined) die(`${it.file}: no NORMAL (run tools/item-prep.mjs)`);
      const P = asFloat(G, p.attributes.POSITION), N = asFloat(G, p.attributes.NORMAL), T = p.attributes.TEXCOORD_0 !== undefined ? asFloat(G, p.attributes.TEXCOORD_0) : null;
      const base = pos.length / 3;
      for (let k = 0; k < P.length / 3; k++) {
        pos.push(...xform(IW[ni], [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]));
        nrm.push(...norm(xdir(IW[ni], [N[k * 3], N[k * 3 + 1], N[k * 3 + 2]])));
        const u = T ? T[k * 2] : 0, v = T ? T[k * 2 + 1] : 0; if (u < -1e-3 || u > 1.001 || v < -1e-3 || v > 1.001) uvOut = true;
        uv.push(clamp01(u), clamp01(v));
      }
      const I = p.indices !== undefined ? readAccessor(G, p.indices) : Array.from({ length: P.length / 3 }, (_, k) => k);
      for (const i of I) idx.push(base + i);
    }
  }
  if (!pos.length) die(`${it.file}: no mesh`);
  if (uvOut) console.warn(`warning: ${it.file}: UVs outside 0..1 were clamped (they would bleed into other atlas tiles)`);
  const material = mat !== undefined ? J.materials[mat] : { pbrMetallicRoughness: { baseColorFactor: [0.7, 0.7, 0.7, 1] } };
  const image = ti => {
    if (ti.texCoord) die(`${it.file}: maps on TEXCOORD_${ti.texCoord} are not supported`);
    if (ti.extensions?.KHR_texture_transform) console.warn(`warning: ${it.file}: KHR_texture_transform ignored`);
    const tx = J.textures[ti.index]; if (tx.source === undefined) die(`${it.file}: texture without a PNG/JPEG source`);
    const img = imageBytes(G, tx.source); return { ...img, size: imageSize(img.bytes) };
  };
  const name = baseNames.filter(b => b === baseNames[ii]).length > 1 ? `${baseNames[ii]}_${it.socket}` : baseNames[ii];
  return { ...it, name, sk, jp, S: socketFrame(sk.mesh, it.socket), pos, nrm, uv, idx, empties, material, image };
});

// per item and atlas: the tile's source image, fill colour (where the item has no map) and channel scale (item
// factors relative to the body's, baked in: base colour / emissive in sRGB, metallic-roughness linear)
for (const it of items) {
  const im = it.material, ipb = im.pbrMetallicRoughness || {}, bpb = bmat.pbrMetallicRoughness;
  it.layers = new Map(); let w = 0, h = 0;
  for (const [key, g] of groups) {
    const fill = [255, 255, 255], scale = [1, 1, 1]; let src = null;
    for (const role of g.roles) {
      const ti = ROLES[role](im), img = ti ? it.image(ti) : null; if (img && !src) src = img;
      if (role === 'baseColor') {
        const f = [0, 1, 2].map(c => ratio((ipb.baseColorFactor || [1, 1, 1, 1])[c], (bpb.baseColorFactor || [1, 1, 1, 1])[c]));
        f.forEach((x, c) => { fill[c] = Math.round(255 * lin2srgb(x)); if (img) scale[c] = Math.max(0, x) ** (1 / 2.2); });
      } else if (role === 'metallicRoughness') {
        const r = ratio(ipb.roughnessFactor ?? 1, bpb.roughnessFactor ?? 1), m = ratio(ipb.metallicFactor ?? 1, bpb.metallicFactor ?? 1);
        fill[1] = Math.round(255 * clamp01(r)); fill[2] = Math.round(255 * clamp01(m)); if (img) { scale[1] = r; scale[2] = m; }
      } else if (role === 'normal') { fill[0] = 128; fill[1] = 128; fill[2] = 255; }
      else if (role === 'occlusion') fill[0] = 255;
      else if (role === 'emissive') {
        const f = [0, 1, 2].map(c => ratio((im.emissiveFactor || [0, 0, 0])[c], (bmat.emissiveFactor || [0, 0, 0])[c]));
        f.forEach((x, c) => { fill[c] = Math.round(255 * lin2srgb(x)); if (img) scale[c] = Math.max(0, x) ** (1 / 2.2); });
      }
    }
    if (src) { w = Math.max(w, src.size.w); h = Math.max(h, src.size.h); }
    it.layers.set(key, { src, fill, scale });
  }
  it.textured = w > 0;
  it.tile = { w: it.textured ? Math.min(HALF, Math.max(64, p2(w))) : 64, h: it.textured ? Math.min(HALF, Math.max(64, p2(h))) : 64 };
  // factors that have no map to be baked into are lost: the merged material keeps the body's
  if (!bmat.pbrMetallicRoughness.metallicRoughnessTexture) {
    const dm = Math.abs((ipb.metallicFactor ?? 1) - (bpb.metallicFactor ?? 1)), dr = Math.abs((ipb.roughnessFactor ?? 1) - (bpb.roughnessFactor ?? 1));
    if (dm > 0.1 || dr > 0.1) console.warn(`note: ${it.name}: metallic/roughness ${ipb.metallicFactor ?? 1}/${ipb.roughnessFactor ?? 1} → the body's ${bpb.metallicFactor ?? 1}/${bpb.roughnessFactor ?? 1} (the body has no metallic-roughness map)`);
  }
}

// shelf-pack the tiles into the right 1024²; halve the biggest tile until everything fits
function shelfPack(tiles) {
  const order = tiles.map((t, i) => i).sort((a, b) => tiles[b].h - tiles[a].h || tiles[b].w - tiles[a].w);
  let x = 0, y = 0, shelf = 0; const at = [];
  for (const i of order) {
    const t = tiles[i]; if (x + t.w > HALF) { y += shelf; x = 0; shelf = 0; }
    if (y + t.h > AH || t.w > HALF) return null;
    at[i] = { x, y }; x += t.w; shelf = Math.max(shelf, t.h);
  }
  return at;
}
for (let place; !(place = shelfPack(items.map(it => it.tile)));) {
  const big = items.reduce((a, b) => (b.tile.w * b.tile.h > a.tile.w * a.tile.h ? b : a));
  if (big.tile.w <= 64 && big.tile.h <= 64) die('too many items for the atlas');
  if (big.tile.w >= big.tile.h) big.tile.w /= 2; else big.tile.h /= 2;
}
shelfPack(items.map(it => it.tile)).forEach((p, i) => Object.assign(items[i].tile, p));

// ------------------------------------------------------------------ atlases (System.Drawing)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-'));
const ext = mime => ({ 'image/png': '.png', 'image/jpeg': '.jpg' }[mime] || die('unsupported image type ' + mime));
let nFile = 0; const dump = img => { const f = path.join(tmp, `src${nFile++}${ext(img.mime)}`); fs.writeFileSync(f, img.bytes); return f; };
const atlases = [...groups.entries()].map(([key, g], gi) => {
  const neutral = [255, 255, 255]; g.roles.forEach(r => NEUTRAL[r](neutral));
  const layers = [{ x: 0, y: 0, w: HALF, h: AH, fill: g.tex === null ? [255, 255, 255] : neutral, src: g.tex === null ? null : dump(bodyTexImage(g.tex)), scale: [1, 1, 1] },
    { x: HALF, y: 0, w: HALF, h: AH, fill: neutral, src: null, scale: [1, 1, 1] }];
  for (const it of items) { const l = it.layers.get(key); layers.push({ x: HALF + it.tile.x, y: it.tile.y, w: it.tile.w, h: it.tile.h, fill: l.fill, src: l.src ? dump(l.src) : null, scale: l.scale }); }
  return { key, roles: g.roles, out: path.join(tmp, `atlas${gi}.jpg`), w: AW, h: AH, layers };
});
const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$jobs = Get-Content -Raw '${path.join(tmp, 'atlas.json').replace(/'/g, "''")}' | ConvertFrom-Json
$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]${QUALITY})
foreach ($a in $jobs) {
  $bmp = New-Object System.Drawing.Bitmap ([int]$a.w), ([int]$a.h), ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  foreach ($l in $a.layers) {
    $br = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, [int]$l.fill[0], [int]$l.fill[1], [int]$l.fill[2]))
    $g.FillRectangle($br, [int]$l.x, [int]$l.y, [int]$l.w, [int]$l.h); $br.Dispose()
    if ($l.src) {
      $img = [System.Drawing.Image]::FromFile($l.src)
      $ia = New-Object System.Drawing.Imaging.ImageAttributes
      $ia.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
      $cm = New-Object System.Drawing.Imaging.ColorMatrix
      $cm.Matrix00 = [single]$l.scale[0]; $cm.Matrix11 = [single]$l.scale[1]; $cm.Matrix22 = [single]$l.scale[2]
      $ia.SetColorMatrix($cm)
      $dst = New-Object System.Drawing.Rectangle ([int]$l.x), ([int]$l.y), ([int]$l.w), ([int]$l.h)
      $g.DrawImage($img, $dst, 0, 0, $img.Width, $img.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia)
      $ia.Dispose(); $img.Dispose()
    }
  }
  $bmp.Save($a.out, $jpeg, $ep); $g.Dispose(); $bmp.Dispose()
}`;
fs.writeFileSync(path.join(tmp, 'atlas.json'), JSON.stringify(atlases));
fs.writeFileSync(path.join(tmp, 'atlas.ps1'), ps);
try { execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(tmp, 'atlas.ps1')], { encoding: 'utf8' }); }
catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); die('atlas failed: ' + (e.stderr || e.message)); }
const atlasBytes = atlases.map(a => fs.readFileSync(a.out));
fs.rmSync(tmp, { recursive: true, force: true });

// ------------------------------------------------------------------ merge geometry, add socket joints
const nvB = bP.length / 3, nvAll = nvB + items.reduce((s, it) => s + it.pos.length / 3, 0);
const P = new Float32Array(nvAll * 3), N = new Float32Array(nvAll * 3), T = new Float32Array(nvAll * 2);
const JN = new Uint16Array(nvAll * 4), WT = new Float32Array(nvAll * 4);
P.set(bP); N.set(bN); JN.set(bJ); WT.set(bW);
for (let k = 0; k < nvB; k++) { T[k * 2] = bT[k * 2] * (HALF / AW); T[k * 2 + 1] = bT[k * 2 + 1]; }   // body → left half
const idx = [Array.from(bI)];
const OJ = JSON.parse(JSON.stringify(BJ));
const newJoints = [], ibmNew = [], report = [];
let vo = nvB, restBind = 0;
for (const it of items) {
  const ji = nJ0 + newJoints.length, S = it.S, parentNode = skin.joints[it.jp];
  // local = IBM(parent) × S: the joint moves with the bone exactly as the bone's own vertices do (equal to
  // inverse(W(parent)) × W(mesh) × S when the node tree's rest pose is the bind pose — the difference is printed)
  const L = mul(Array.from(bodyIBM.slice(it.jp * 16, it.jp * 16 + 16)), S);
  const Ltree = mul(mul(inv(W[parentNode]), Wm), S);
  restBind = Math.max(restBind, ...L.map((x, i) => Math.abs(x - Ltree[i])));
  const node = { name: it.socket, matrix: L.map(x => +x.toPrecision(9)), children: [] };
  OJ.nodes.push(node); const nodeIdx = OJ.nodes.length - 1;
  (OJ.nodes[parentNode].children = OJ.nodes[parentNode].children || []).push(nodeIdx);
  newJoints.push(nodeIdx); ibmNew.push(inv(S));
  // vertices: v_mesh = S × (v_item / metresPerUnit), normals by S's rotation
  const { x: tx, y: ty, w: tw, h: th } = it.tile, n = it.pos.length / 3;
  for (let k = 0; k < n; k++) {
    P.set(xform(S, [it.pos[k * 3] / M, it.pos[k * 3 + 1] / M, it.pos[k * 3 + 2] / M]), (vo + k) * 3);
    N.set(norm(xdir(S, [it.nrm[k * 3], it.nrm[k * 3 + 1], it.nrm[k * 3 + 2]])), (vo + k) * 3);
    const u = it.textured ? it.uv[k * 2] : 0.5, v = it.textured ? it.uv[k * 2 + 1] : 0.5;           // untextured: tile centre
    T[(vo + k) * 2] = (HALF + tx + u * tw) / AW; T[(vo + k) * 2 + 1] = (ty + v * th) / AH;            // glTF UV origin = image top-left
    JN[(vo + k) * 4] = ji; WT[(vo + k) * 4] = 1;
  }
  idx.push(it.idx.map(i => i + vo)); vo += n;
  // named empties: plain children of the socket joint; the joint's frame is S (mesh units), so local = p / metresPerUnit
  const emptyNames = [];
  for (const e of it.empties) {
    const d = decompose(e.m), en = { name: `${it.name}_${e.name}`, translation: d.t.map(x => +(x / M).toPrecision(9)) };
    if (Math.hypot(d.q[0], d.q[1], d.q[2]) > 1e-7) en.rotation = d.q.map(x => +x.toPrecision(9));
    if (d.s.some(s => Math.abs(s - 1) > 1e-6)) en.scale = d.s.map(x => +x.toPrecision(9));
    OJ.nodes.push(en); node.children.push(OJ.nodes.length - 1); emptyNames.push(en.name);
  }
  if (!node.children.length) delete node.children;
  report.push({ name: it.name, socket: it.socket, file: path.basename(it.file), tris: it.idx.length / 3, tile: [HALF + tx, ty, tw, th], bone: it.sk.bone, empties: emptyNames });
}
const I = Uint32Array.from(idx.flat());
if (JN.some(j => j >= nJ0 + newJoints.length)) die('joint index out of range');

// ------------------------------------------------------------------ write
const Wr = new GlbWriter(OJ);
const copied = new Map(), copyAcc = i => {                                     // accessors kept as they are (animations, other skins)
  if (copied.has(i)) return copied.get(i);
  const a = BJ.accessors[i]; if (a.sparse) die('sparse accessors are not supported');
  const n = Wr.accessor(readAccessor(B, i), a.type, a.componentType, { minmax: a.min !== undefined, normalized: a.normalized });
  copied.set(i, n); return n;
};
const newPrim = { ...JSON.parse(JSON.stringify(prim)), mode: 4, material: 0 };
if (newPrim.extensions) { delete newPrim.extensions.FB_ngon_encoding; if (!Object.keys(newPrim.extensions).length) delete newPrim.extensions; }
newPrim.attributes = {
  POSITION: Wr.accessor(P, 'VEC3', 5126, { minmax: true, target: 34962 }),
  NORMAL: Wr.accessor(N, 'VEC3', 5126, { target: 34962 }),
  TEXCOORD_0: Wr.accessor(T, 'VEC2', 5126, { target: 34962 }),
  JOINTS_0: Wr.accessor(JN, 'VEC4', 5123, { target: 34962 }),
  WEIGHTS_0: Wr.accessor(WT, 'VEC4', 5126, { target: 34962 }),
};
newPrim.indices = Wr.accessor(I, 'SCALAR', 5125, { target: 34963 });
OJ.meshes = [{ ...JSON.parse(JSON.stringify(bodyMesh)), primitives: [newPrim] }];
OJ.nodes[meshNode].mesh = 0;
// LODs: same material, same skin, sibling nodes of the mesh node. A re-derived UV stays in its half of the atlas
// (body left, items right), so a LOD never samples across the seam between the two.
const lodInfo = [{ node: OJ.nodes[meshNode].name || 'mesh', tris: I.length / 3 }];
if (LODS.length) {
  const half = (uv, tri) => { const right = (tri[0][0] + tri[1][0] + tri[2][0]) / 3 >= 0.5, e = 1 / AW;
    return [Math.min(right ? 1 : 0.5 - e, Math.max(right ? 0.5 + e : 0, uv[0])), Math.min(1, Math.max(0, uv[1]))]; };
  const parentOf = OJ.nodes.findIndex(n => (n.children || []).includes(meshNode));
  const base = OJ.nodes[meshNode], baseName = base.name || 'mesh';
  for (const [li, f] of LODS.entries()) {
    const r = simplify({ P, N, T, J: JN, W: WT, I }, Math.round(I.length / 3 * f), { uvClamp: half });
    const lp = { ...JSON.parse(JSON.stringify(newPrim)), attributes: {
      POSITION: Wr.accessor(r.P, 'VEC3', 5126, { minmax: true, target: 34962 }),
      NORMAL: Wr.accessor(r.N, 'VEC3', 5126, { target: 34962 }),
      TEXCOORD_0: Wr.accessor(r.T, 'VEC2', 5126, { target: 34962 }),
      JOINTS_0: Wr.accessor(r.J, 'VEC4', 5123, { target: 34962 }),
      WEIGHTS_0: Wr.accessor(r.W, 'VEC4', 5126, { target: 34962 }),
    }, indices: Wr.accessor(r.I, 'SCALAR', 5125, { target: 34963 }) };
    OJ.meshes.push({ name: `${baseName}_LOD${li + 1}`, primitives: [lp] });
    const node = { name: `${baseName}_LOD${li + 1}`, mesh: OJ.meshes.length - 1, skin: base.skin };
    for (const k of ['matrix', 'translation', 'rotation', 'scale']) if (base[k]) node[k] = JSON.parse(JSON.stringify(base[k]));
    OJ.nodes.push(node); const ni = OJ.nodes.length - 1;
    if (parentOf >= 0) OJ.nodes[parentOf].children.push(ni); else OJ.scenes[OJ.scene ?? 0].nodes.push(ni);
    lodInfo.push({ node: node.name, tris: r.stats.end, fraction: f });
  }
}
const ibm = new Float32Array((nJ0 + ibmNew.length) * 16); ibm.set(bodyIBM); ibmNew.forEach((m, k) => ibm.set(m, (nJ0 + k) * 16));
OJ.skins = BJ.skins.map((s, si) => si === skinIdx
  ? { ...s, joints: [...s.joints, ...newJoints], inverseBindMatrices: Wr.accessor(ibm, 'MAT4', 5126) }
  : { ...s, ...(s.inverseBindMatrices !== undefined ? { inverseBindMatrices: copyAcc(s.inverseBindMatrices) } : {}) });
for (const an of OJ.animations || []) for (const s of an.samplers) { s.input = copyAcc(s.input); s.output = copyAcc(s.output); }
// one image + texture per atlas; the material keeps its settings, its maps point at the atlases
OJ.images = []; OJ.textures = [];
const texOf = new Map();
atlases.forEach((a, k) => {
  OJ.images.push({ name: `${KEY}_${a.roles.join('_')}_atlas.jpg`, mimeType: 'image/jpeg', bufferView: Wr.view(atlasBytes[k]) });
  const sampler = a.key === 'base' ? undefined : BJ.textures[a.key].sampler;
  OJ.textures.push(sampler !== undefined ? { source: k, sampler } : { source: k });
  texOf.set(a.key, k);
});
for (const get of Object.values(ROLES)) { const ti = get(bmat); if (ti) ti.index = texOf.get(ti.index); }
OJ.materials = [bmat];
if (OJ.textures.some(t => t.sampler !== undefined) && !OJ.samplers) die('sampler missing');
if (OJ.samplers && !OJ.textures.some(t => t.sampler !== undefined)) delete OJ.samplers;
// extensions: keep only the ones still in use
const used = new Set(), scan = o => { if (o && typeof o === 'object') { if (o.extensions && typeof o.extensions === 'object') Object.keys(o.extensions).forEach(k => used.add(k)); Object.values(o).forEach(scan); } };
scan({ ...OJ, extensionsUsed: undefined, extensionsRequired: undefined });
for (const k of ['extensionsUsed', 'extensionsRequired']) if (OJ[k]) { OJ[k] = OJ[k].filter(e => used.has(e)); if (!OJ[k].length) delete OJ[k]; }
OJ.asset = { ...BJ.asset, extras: { ...(BJ.asset?.extras || {}), remodel: {
  key: KEY, bodyHeightScene: entry.bodyHeightScene, metresPerUnit: M, atlas: [AW, AH],
  items: report.map(r => ({ name: r.name, socket: r.socket, file: r.file, tris: r.tris, tile: r.tile })), sockets: items.map(it => it.socket),
  ...(lodInfo.length > 1 ? { lods: lodInfo, shadowProxy: lodInfo[lodInfo.length - 1].node } : {}),
} } };
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
const bytes = Wr.write(OUT);

// ------------------------------------------------------------------ summary
const trisBody = bI.length / 3, trisAll = I.length / 3;
for (const r of report) console.log(`  ${r.socket} <- ${r.file} (${r.tris} tris) on ${r.bone}, tile ${r.tile[2]}x${r.tile[3]} at ${r.tile[0]},${r.tile[1]}${r.empties.length ? ', empties ' + r.empties.join(' ') : ''}`);
if (lodInfo.length > 1) console.log('  LODs ' + lodInfo.map((l, i) => `${i}: ${l.tris}`).join(', ') + ` (shadow proxy: ${lodInfo[lodInfo.length - 1].node})`);
console.log(`${path.basename(OUT)}: tris ${trisBody} -> ${trisAll}, joints ${nJ0} -> ${nJ0 + newJoints.length}, meshes ${OJ.meshes.length}, primitives ${OJ.meshes[0].primitives.length}, ` +
  `atlas ${AW}x${AH} (${atlases.map(a => a.roles.join('+')).join(', ')}), ${(bytes / 1024).toFixed(0)} kB` + (items.length ? `, rest-vs-bind ${restBind.toExponential(1)}` : ''));
if (!items.length) console.warn('warning: no --item given; only the atlas layout was applied');
