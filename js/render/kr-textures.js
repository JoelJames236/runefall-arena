// Kingsreach Colosseum — hand-painted textures, painted on canvases at load time (same look as the Thornwater
// textures in tw-ground.js): the arena sand, warm sandstone blocks, cream marble, terracotta roof tiles, striped
// sail cloth, the crests of the eight noble houses, the kingdom crest for the floor and a trapdoor grate.
import * as THREE from 'three';

const N = 512;
function makeNoise(seed) {
  const hash = (x, y) => { const s = Math.sin((x * 127.1 + y * 311.7 + seed * 74.7)) * 43758.5453; return s - Math.floor(s); };
  const vn = (x, y, p) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const m = a => ((a % p) + p) % p, h = (a, b) => hash(m(a), m(b));
    return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
  };
  return (s, t, p = 4, oct = 4) => { let a = 0, w = 0.5, f = p, n = 0; for (let o = 0; o < oct; o++) { a += vn(s * f, t * f, f) * w; n += w; w *= 0.5; f *= 2; } return a / n; };
}
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function canvas(w = N, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function paintPixels(cv, fn) {
  const W = cv.width, H = cv.height, ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = fn(x / W, y / H), i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }
  ctx.putImageData(img, 0, 0); return ctx;
}
function wrapDraw(ctx, x, y, r, draw) {
  for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { const X = x + ox, Y = y + oy; if (X > -r && X < N + r && Y > -r && Y < N + r) draw(X, Y); }
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const tex = (cv, rep = true) => { const t = new THREE.CanvasTexture(cv); if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

// ---------------------------------------------------------------- arena sand: warm, fine grain, darker trampled clumps,
// pebbles and the odd footprint scuff
function paintSand() {
  const cv = canvas(), nz = makeNoise(61), R = rng(7);
  const a = [176, 142, 98], b = [206, 172, 124], c2 = [226, 198, 152];
  const ctx = paintPixels(cv, (s, t) => {
    const n = nz(s, t, 4, 5), m = nz(s + 0.4, t, 10, 3), g = nz(s, t, 64, 2);
    let c = n < 0.5 ? mixc(a, b, n * 2) : mixc(b, c2, (n - 0.5) * 2);
    c = mixc(c, [150, 112, 74], clamp((0.42 - m) * 2.2));                 // trampled, darker sand
    return mixc(c, [240, 222, 186], clamp((g - 0.6) * 1.6) * 0.5);        // grain sparkle
  });
  for (let i = 0; i < 380; i++) {
    const x = R() * N, y = R() * N, r = 1 + R() * 2.6, v = 120 + R() * 80 | 0;
    wrapDraw(ctx, x, y, r * 2, (X, Y) => {
      ctx.fillStyle = 'rgba(90,60,30,0.35)'; ctx.beginPath(); ctx.ellipse(X + 0.8, Y + 1.2, r, r * 0.7, 0, 0, 6.3); ctx.fill();
      ctx.fillStyle = `rgb(${v + 20},${v + 6},${v - 14})`; ctx.beginPath(); ctx.ellipse(X, Y, r, r * 0.7, 0, 0, 6.3); ctx.fill();
    });
  }
  return cv;
}
// warm honey sandstone in courses, bevelled blocks, some lighter and some sun-faded
function paintSandstone(seed = 71, rows = 5, base = [206, 170, 120]) {
  const cv = canvas(), ctx = cv.getContext('2d'), nz = makeNoise(seed), R = rng(seed + 3), rh = N / rows;
  ctx.fillStyle = '#7a5e40'; ctx.fillRect(0, 0, N, N);
  for (let r = 0; r < rows; r++) {
    let x = R() * N * 0.3; const y = r * rh, end = x + N;
    while (x < end) {
      const w = N / 3 * (0.55 + R() * 0.55), k = 0.88 + R() * 0.22, warm = (R() - 0.5) * 16;
      wrapDraw(ctx, x + w / 2, y + rh / 2, w, X => {
        const x0 = X - w / 2 + 2, y0 = y + 2, ww = w - 4, hh = rh - 4;
        ctx.fillStyle = `rgb(${base[0] * k + warm | 0},${base[1] * k | 0},${base[2] * k - warm | 0})`; ctx.fillRect(x0, y0, ww, hh);
        ctx.fillStyle = 'rgba(255,240,205,0.4)'; ctx.fillRect(x0, y0, ww, 4); ctx.fillRect(x0, y0, 3, hh);
        ctx.fillStyle = 'rgba(70,44,22,0.4)'; ctx.fillRect(x0, y0 + hh - 5, ww, 5); ctx.fillRect(x0 + ww - 4, y0, 4, hh);
      });
      x += w;
    }
  }
  const img = ctx.getImageData(0, 0, N, N), d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = 0.84 + nz(x / N, y / N, 4, 5) * 0.3, e = clamp((nz(x / N, y / N, 16, 2) - 0.7) * 4) * 0.25, i = (y * N + x) * 4;
    d[i] = d[i] * k * (1 - e); d[i + 1] = d[i + 1] * k * (1 - e); d[i + 2] = d[i + 2] * k * (1 - e * 0.6);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
// cream marble slabs with soft grey-gold veins
function paintMarble() {
  const cv = canvas(), nz = makeNoise(83);
  const ctx = paintPixels(cv, (s, t) => {
    const w = nz(s, t, 3, 5), v = Math.abs(Math.sin((s * 3 + t * 1.4 + w * 2.6) * Math.PI * 2)), vein = clamp(1 - v * 14);
    const base = 226 + (nz(s, t, 6, 3) - 0.5) * 22;
    return mixc([base + 4, base - 2, base - 16], [168, 150, 120], vein * 0.55);
  });
  ctx.strokeStyle = 'rgba(120,96,70,0.5)'; ctx.lineWidth = 3;          // slab joints
  for (const p of [0, N / 2]) { ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(N, p); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, N); ctx.stroke(); }
  return cv;
}
// terracotta roof: overlapping rows of round barrel tiles
function paintTerracotta() {
  const cv = canvas(), ctx = cv.getContext('2d'), R = rng(91), rows = 9, rh = N / rows, tw = N / 12;
  ctx.fillStyle = '#5a2414'; ctx.fillRect(0, 0, N, N);
  for (let r = rows; r >= -1; r--) for (let k = -1; k <= 12; k++) {
    const x = k * tw, y = r * rh, v = R();
    wrapDraw(ctx, x + tw / 2, y, tw, X => {
      const g = ctx.createLinearGradient(X - tw / 2, 0, X + tw / 2, 0);
      g.addColorStop(0, `rgb(${120 + v * 20 | 0},${48 + v * 10 | 0},${28})`); g.addColorStop(0.45, `rgb(${196 + v * 30 | 0},${96 + v * 24 | 0},${58 + v * 10 | 0})`); g.addColorStop(1, `rgb(${110 + v * 20 | 0},${44 + v * 8 | 0},${26})`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(X - tw / 2 + 1, y - rh * 0.3); ctx.lineTo(X + tw / 2 - 1, y - rh * 0.3); ctx.lineTo(X + tw / 2 - 1, y + rh * 0.55);
      ctx.quadraticCurveTo(X, y + rh * 0.85, X - tw / 2 + 1, y + rh * 0.55); ctx.closePath(); ctx.fill();
    });
  }
  return cv;
}
// weathered timber: horizontal boards for the galleries
function paintTimber() {
  const cv = canvas(), nz = makeNoise(97), rows = 8;
  return paintPixels(cv, (s, t) => {
    const k = Math.floor(t * rows), u = t * rows - k;
    if (u < 0.05 || u > 0.95) return [40, 26, 16];
    const tone = (Math.sin(k * 91.7 + 3.1) * 43758.5453) % 1, grain = nz(s, t * 0.25 + k * 0.17, 2, 4), streak = Math.sin((s * 34 + grain * 8) * Math.PI) * 0.5 + 0.5;
    const v = 108 + Math.abs(tone) * 34 + streak * 14 - (grain - 0.5) * 34;
    return [v + 20, v + 2, v - 18];
  }).canvas;
}
// sail cloth: wide stripes with woven texture; the colours repeat around the velarium
const SAIL_COLOURS = ['#efe3c8', '#a3232a', '#efe3c8', '#1f6f78', '#efe3c8', '#d9a332'];
function paintSail() {
  const cv = canvas(), ctx = cv.getContext('2d'), nz = makeNoise(103), sw = N / SAIL_COLOURS.length;
  SAIL_COLOURS.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * sw, 0, sw + 1, N); });
  const img = ctx.getImageData(0, 0, N, N), d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const weave = ((x >> 1) + (y >> 1)) % 2 ? 0.96 : 1.02, k = (0.86 + nz(x / N, y / N, 4, 4) * 0.22) * weave, i = (y * N + x) * 4;
    d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(60,30,10,0.35)'; for (let i = 0; i <= SAIL_COLOURS.length; i++) ctx.fillRect(i * sw - 1, 0, 2, N); // seams
  return cv;
}

// ---------------------------------------------------------------- heraldry
// eight noble houses: field colour, charge colour, charge
export const HOUSES = [
  { name: 'Aldren', field: '#1f3f8a', metal: '#e3b341', charge: 'sun' },
  { name: 'Corvane', field: '#7a1d24', metal: '#efe3c8', charge: 'tower' },
  { name: 'Hartwood', field: '#2f6b3a', metal: '#e3b341', charge: 'stag' },
  { name: 'Morrow', field: '#2b2b33', metal: '#d8d8d8', charge: 'wolf' },
  { name: 'Velmont', field: '#5a2d82', metal: '#e3b341', charge: 'key' },
  { name: 'Rosalind', field: '#efe3c8', metal: '#a3232a', charge: 'rose' },
  { name: 'Tidemere', field: '#1f6f78', metal: '#efe3c8', charge: 'anchor' },
  { name: 'Leonis', field: '#c8962e', metal: '#7a1d24', charge: 'lion' },
];
function drawCharge(c, kind, col, s) {
  c.save(); c.fillStyle = col; c.strokeStyle = col; c.lineWidth = 10 * s; c.lineCap = 'round'; c.lineJoin = 'round';
  const P = (pts) => { c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x * s, y * s) : c.moveTo(x * s, y * s)); c.closePath(); c.fill(); };
  switch (kind) {
    case 'sun': for (let i = 0; i < 12; i++) { c.rotate(Math.PI / 6); P([[-8, -36], [0, -66], [8, -36]]); } c.beginPath(); c.arc(0, 0, 36 * s, 0, 6.3); c.fill(); break;
    case 'tower': P([[-28, 60], [-28, -30], [-36, -30], [-36, -56], [-22, -56], [-22, -44], [-7, -44], [-7, -56], [7, -56], [7, -44], [22, -44], [22, -56], [36, -56], [36, -30], [28, -30], [28, 60]]); break;
    case 'stag': c.beginPath(); c.ellipse(0, 14 * s, 18 * s, 30 * s, 0, 0, 6.3); c.fill();
      for (const k of [-1, 1]) { c.beginPath(); c.moveTo(k * 8 * s, -12 * s); c.quadraticCurveTo(k * 40 * s, -30 * s, k * 30 * s, -70 * s); c.moveTo(k * 26 * s, -30 * s); c.lineTo(k * 46 * s, -42 * s); c.moveTo(k * 30 * s, -50 * s); c.lineTo(k * 52 * s, -62 * s); c.stroke(); } break;
    case 'wolf': P([[-34, 50], [-30, -10], [-44, -56], [-14, -30], [14, -30], [44, -56], [30, -10], [34, 50], [0, 66]]); break;
    case 'key': c.beginPath(); c.arc(0, -36 * s, 20 * s, 0, 6.3); c.stroke(); c.beginPath(); c.moveTo(0, -16 * s); c.lineTo(0, 62 * s); c.moveTo(0, 46 * s); c.lineTo(18 * s, 46 * s); c.moveTo(0, 30 * s); c.lineTo(14 * s, 30 * s); c.stroke(); break;
    case 'rose': for (let i = 0; i < 5; i++) { c.rotate(Math.PI * 2 / 5); c.beginPath(); c.ellipse(0, -26 * s, 20 * s, 24 * s, 0, 0, 6.3); c.fill(); } c.fillStyle = '#e3b341'; c.beginPath(); c.arc(0, 0, 14 * s, 0, 6.3); c.fill(); break;
    case 'anchor': c.beginPath(); c.moveTo(0, -52 * s); c.lineTo(0, 54 * s); c.moveTo(-24 * s, -30 * s); c.lineTo(24 * s, -30 * s); c.moveTo(-44 * s, 20 * s); c.quadraticCurveTo(-36 * s, 58 * s, 0, 56 * s); c.quadraticCurveTo(36 * s, 58 * s, 44 * s, 20 * s); c.stroke(); c.beginPath(); c.arc(0, -60 * s, 9 * s, 0, 6.3); c.stroke(); break;
    case 'lion': c.beginPath(); for (let i = 0; i < 14; i++) { const a = i / 14 * 6.283; c.lineTo(Math.cos(a) * (i % 2 ? 50 : 38) * s, Math.sin(a) * (i % 2 ? 50 : 38) * s); } c.closePath(); c.fill();
      c.fillStyle = '#e3b341'; c.beginPath(); c.arc(0, 0, 28 * s, 0, 6.3); c.fill(); break;
  }
  c.restore();
}
// banner (256 × 512, swallowtail) per house, and a round shield per house, in one atlas each
function paintBanners() {
  const cv = canvas(256 * 8, 512), c = cv.getContext('2d');
  HOUSES.forEach((H, i) => {
    c.save(); c.translate(i * 256, 0);
    c.fillStyle = H.metal; c.beginPath(); c.moveTo(0, 0); c.lineTo(256, 0); c.lineTo(256, 470); c.lineTo(128, 400); c.lineTo(0, 470); c.closePath(); c.fill();
    c.fillStyle = H.field; c.beginPath(); c.moveTo(14, 14); c.lineTo(242, 14); c.lineTo(242, 446); c.lineTo(128, 382); c.lineTo(14, 446); c.closePath(); c.fill();
    c.translate(128, 200); drawCharge(c, H.charge, H.metal, 1.35); c.restore();
  });
  return cv;
}
function paintShields() {
  const cv = canvas(256 * 8, 256), c = cv.getContext('2d');
  HOUSES.forEach((H, i) => {
    c.save(); c.translate(i * 256 + 128, 128);
    c.fillStyle = '#6a4a22'; c.beginPath(); c.arc(0, 0, 124, 0, 6.3); c.fill();              // bronze rim
    c.fillStyle = '#c89a4a'; c.beginPath(); c.arc(0, 0, 118, 0, 6.3); c.fill();
    c.fillStyle = H.field; c.beginPath(); c.arc(0, 0, 104, 0, 6.3); c.fill();
    drawCharge(c, H.charge, H.metal, 1.05);
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.ellipse(-30, -40, 50, 26, -0.6, 0, 6.3); c.fill();
    c.restore();
  });
  return cv;
}
// the kingdom of Kingsreach: a golden crown over crossed swords inside a laurel ring — painted as a floor mosaic
function paintFloorCrest() {
  const cv = canvas(1024), c = cv.getContext('2d'), R = rng(5);
  c.clearRect(0, 0, 1024, 1024); c.translate(512, 512);
  const ring = (r0, r1, col) => { c.fillStyle = col; c.beginPath(); c.arc(0, 0, r1, 0, 6.3); c.arc(0, 0, r0, 0, 6.3, true); c.fill(); };
  ring(440, 500, '#8a6a3c'); ring(452, 488, '#d8b26a');
  for (let i = 0; i < 64; i++) { const a = i / 64 * 6.283; c.fillStyle = i % 2 ? '#7a1d24' : '#1f3f8a'; c.save(); c.rotate(a); c.fillRect(-14, -486, 28, 30); c.restore(); }
  c.fillStyle = 'rgba(236,222,190,0.9)'; c.beginPath(); c.arc(0, 0, 440, 0, 6.3); c.fill();
  // mosaic tesserae
  for (let i = 0; i < 2600; i++) { const a = R() * 6.283, r = Math.sqrt(R()) * 436; c.fillStyle = `rgba(${200 + R() * 40 | 0},${180 + R() * 30 | 0},${140 + R() * 30 | 0},0.5)`; c.fillRect(Math.cos(a) * r, Math.sin(a) * r, 9, 9); }
  // laurel
  c.strokeStyle = '#4f7a3a'; c.lineWidth = 10; c.beginPath(); c.arc(0, 0, 360, 0.5, Math.PI - 0.5); c.stroke(); c.beginPath(); c.arc(0, 0, 360, Math.PI + 0.5, 6.283 - 0.5); c.stroke();
  for (let i = 0; i < 28; i++) { const a = (i % 14) / 14 * (Math.PI - 1) + 0.5 + (i >= 14 ? Math.PI : 0); c.save(); c.rotate(a); c.translate(360, 0); c.rotate(0.6); c.fillStyle = i % 2 ? '#5f8c44' : '#3f6a30'; c.beginPath(); c.ellipse(0, 0, 34, 13, 0, 0, 6.3); c.fill(); c.restore(); }
  // crossed swords
  for (const k of [-1, 1]) {
    c.save(); c.rotate(k * 0.62);
    c.fillStyle = '#c8ccd2'; c.beginPath(); c.moveTo(-14, 210); c.lineTo(-14, -250); c.lineTo(0, -290); c.lineTo(14, -250); c.lineTo(14, 210); c.fill();
    c.fillStyle = '#8a6a2a'; c.fillRect(-60, 200, 120, 22); c.fillRect(-11, 222, 22, 70); c.beginPath(); c.arc(0, 300, 18, 0, 6.3); c.fill();
    c.restore();
  }
  // crown
  c.fillStyle = '#e3b341'; c.beginPath(); c.moveTo(-150, 40); c.lineTo(-170, -110); c.lineTo(-90, -40); c.lineTo(0, -150); c.lineTo(90, -40); c.lineTo(170, -110); c.lineTo(150, 40); c.closePath(); c.fill();
  c.fillStyle = '#b8862a'; c.fillRect(-150, 30, 300, 46);
  for (const [x, col] of [[-90, '#a3232a'], [0, '#1f3f8a'], [90, '#2f6b3a']]) { c.fillStyle = col; c.beginPath(); c.arc(x, 53, 15, 0, 6.3); c.fill(); }
  for (const x of [-170, 0, 170]) { c.fillStyle = '#efe3c8'; c.beginPath(); c.arc(x, x ? -112 : -154, 14, 0, 6.3); c.fill(); }
  return cv;
}
// a square iron grate set in a timber frame (the hypogeum trapdoors), with a dark pit below
function paintTrapdoor() {
  const cv = canvas(256), c = cv.getContext('2d');
  c.fillStyle = '#5a3c22'; c.fillRect(0, 0, 256, 256);
  c.fillStyle = '#120c08'; c.fillRect(22, 22, 212, 212);
  c.fillStyle = '#3a3634';
  for (let i = 0; i < 7; i++) { c.fillRect(22 + i * 34, 22, 8, 212); c.fillRect(22, 22 + i * 34, 212, 8); }
  c.fillStyle = 'rgba(255,220,170,0.15)'; for (let i = 0; i < 7; i++) c.fillRect(22 + i * 34, 22, 2, 212);
  c.strokeStyle = '#2a1a0e'; c.lineWidth = 6; c.strokeRect(14, 14, 228, 228);
  return cv;
}
// a soft round spawn mark (team colour applied by the material)
function paintRingMark() {
  const cv = canvas(256), c = cv.getContext('2d');
  c.translate(128, 128);
  c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 10; c.beginPath(); c.arc(0, 0, 110, 0, 6.3); c.stroke();
  c.lineWidth = 4; c.beginPath(); c.arc(0, 0, 92, 0, 6.3); c.stroke();
  for (let i = 0; i < 8; i++) { c.save(); c.rotate(i * Math.PI / 4); c.fillStyle = 'rgba(255,255,255,0.95)'; c.beginPath(); c.moveTo(0, -84); c.lineTo(10, -64); c.lineTo(-10, -64); c.fill(); c.restore(); }
  return cv;
}

let KT = null;
export function krTextures() {
  if (KT) return KT;
  KT = {
    sand: tex(paintSand()), sandstone: tex(paintSandstone()), darkstone: tex(paintSandstone(77, 4, [150, 112, 82])),
    marble: tex(paintMarble()), terracotta: tex(paintTerracotta()), timber: tex(paintTimber()), sail: tex(paintSail()),
    banners: tex(paintBanners(), false), shields: tex(paintShields(), false), crest: tex(paintFloorCrest(), false),
    trapdoor: tex(paintTrapdoor(), false), ringMark: tex(paintRingMark(), false),
  };
  return KT;
}
