// Shrink a GLB for the game: every embedded texture is resized to at most --max px (JPEG, or PNG when it has
// alpha) and the binary chunk is repacked. Geometry is left as it is (reduce it in Tripo: Smart Low Poly / Retopo).
// Uses only Node and Windows' System.Drawing (through PowerShell), so nothing needs installing.
//
//   node tools/glb-optimize.mjs <in.glb> <out.glb> [--max 1024] [--quality 85]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const [inFile, outFile] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const MAX = opt('--max', 1024), Q = opt('--quality', 85);
if (!inFile || !outFile) { console.error('usage: node tools/glb-optimize.mjs <in.glb> <out.glb> [--max 1024] [--quality 85]'); process.exit(2); }

const buf = fs.readFileSync(inFile);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + inFile);
let off = 12, json = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8')); else if (type === 0x004e4942) bin = data;
  off += 8 + len;
}
const views = json.bufferViews || [];
const viewData = views.map(v => bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength));

// ---- textures: resize every embedded image in one PowerShell run
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glbopt-'));
const jobs = [];
(json.images || []).forEach((im, i) => {
  if (im.bufferView === undefined) return;
  const src = path.join(tmp, `in${i}` + (im.mimeType === 'image/png' ? '.png' : '.jpg'));
  fs.writeFileSync(src, viewData[im.bufferView]);
  jobs.push({ i, src, dst: path.join(tmp, `out${i}`) });
});
if (jobs.length) {
  const ps = `
Add-Type -AssemblyName System.Drawing
$jobs = Get-Content -Raw '${path.join(tmp, 'jobs.json').replace(/'/g, "''")}' | ConvertFrom-Json
$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]${Q})
foreach ($j in $jobs) {
  $img = [System.Drawing.Image]::FromFile($j.src)
  $k = [Math]::Min(1.0, ${MAX} / [Math]::Max($img.Width, $img.Height))
  $w = [Math]::Max(1, [int]($img.Width * $k)); $h = [Math]::Max(1, [int]($img.Height * $k))
  $alpha = [System.Drawing.Image]::IsAlphaPixelFormat($img.PixelFormat)
  $fmt = if ($alpha) { [System.Drawing.Imaging.PixelFormat]::Format32bppArgb } else { [System.Drawing.Imaging.PixelFormat]::Format24bppRgb }
  $bmp = New-Object System.Drawing.Bitmap $w, $h, $fmt
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($img, 0, 0, $w, $h)
  if ($alpha) { $bmp.Save($j.dst + '.png', [System.Drawing.Imaging.ImageFormat]::Png) } else { $bmp.Save($j.dst + '.jpg', $jpeg, $ep) }
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
  Write-Output ("{0} {1}x{2} -> {3}x{4} {5}" -f $j.i, $img.Width, $img.Height, $w, $h, $(if ($alpha) { 'png' } else { 'jpg' }))
}`;
  fs.writeFileSync(path.join(tmp, 'jobs.json'), JSON.stringify(jobs));
  fs.writeFileSync(path.join(tmp, 'resize.ps1'), ps);
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(tmp, 'resize.ps1')], { encoding: 'utf8' });
  process.stdout.write(out);
  for (const j of jobs) {
    const png = fs.existsSync(j.dst + '.png'), file = j.dst + (png ? '.png' : '.jpg');
    viewData[json.images[j.i].bufferView] = fs.readFileSync(file);
    json.images[j.i].mimeType = png ? 'image/png' : 'image/jpeg';
  }
}
fs.rmSync(tmp, { recursive: true, force: true });

// ---- repack the binary chunk (4-byte aligned views)
const parts = []; let at = 0;
views.forEach((v, i) => {
  const d = viewData[i], pad = (4 - (at % 4)) % 4;
  if (pad) { parts.push(Buffer.alloc(pad)); at += pad; }
  v.byteOffset = at; v.byteLength = d.length; v.buffer = 0;
  parts.push(d); at += d.length;
});
const padEnd = (4 - (at % 4)) % 4; if (padEnd) { parts.push(Buffer.alloc(padEnd)); at += padEnd; }
json.buffers = [{ byteLength: at }];
let js = Buffer.from(JSON.stringify(json), 'utf8');
if (js.length % 4) js = Buffer.concat([js, Buffer.alloc(4 - (js.length % 4), 0x20)]);
const binBuf = Buffer.concat(parts);
const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + binBuf.length, 8);
jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, Buffer.concat([head, jh, js, bh, binBuf]));

// ---- report: triangles, textures, size
let tris = 0;
for (const m of json.meshes || []) for (const p of m.primitives) {
  const a = p.indices !== undefined ? json.accessors[p.indices] : json.accessors[p.attributes.POSITION];
  tris += (p.indices !== undefined ? a.count : a.count) / 3;
}
console.log(`${path.basename(outFile)}: ${Math.round(tris)} tris, ${(json.images || []).length} textures, ${(buf.length / 1048576).toFixed(1)} MB -> ${(fs.statSync(outFile).size / 1048576).toFixed(2)} MB`);
