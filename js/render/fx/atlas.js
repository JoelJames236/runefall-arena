// Procedural VFX atlas (docs/remodel/06 §2.1), painted once at load. The layout lives in atlas-layout.js so the
// later KTX2 bake reuses it; this module only paints the cells.
//
// Output: an RGBA8 buffer (straight alpha, rows top-down) uploaded as a mip-mapped DataTexture. Vector cells are
// drawn with canvas 2D and read back; noise cells (flipbooks, mist, dust, noise, ramps) are written straight into
// the buffer — canvas storage is premultiplied and would lose the colour of faint pixels. Mask cells are white
// (rgb = brightness detail, alpha = coverage) and get tinted at draw time; fully transparent texels are set to white
// so mip levels don't darken the edges.
import * as THREE from 'three';
import { ATLAS, CELLS, cellRect } from './atlas-layout.js';

const S = ATLAS.cell, TAU = Math.PI * 2;

// ------------------------------------------------------------------ helpers
function rng(seed) {
  return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// periodic value noise + fbm (periods in lattice units, so cells can tile / flipbooks can loop)
function makeNoise(seed) {
  const R = rng(seed), L = new Float32Array(256 * 256);
  for (let i = 0; i < L.length; i++) L[i] = R();
  const sm = t => t * t * (3 - 2 * t);
  const n = (x, y, px, py) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = sm(x - xi), fy = sm(y - yi);
    const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py, x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const a = L[x0 + y0 * 256], b = L[x1 + y0 * 256], c = L[x0 + y1 * 256], d = L[x1 + y1 * 256];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const fbm = (x, y, oct, px = 256, py = 256) => {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) { s += amp * n(x * f, y * f, Math.min(256, px * f), Math.min(256, py * f)); norm += amp; amp *= 0.5; f *= 2; }
    return s / norm;
  };
  return { n, fbm };
}
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const radial = (g, x, y, r, stops) => { const grd = g.createRadialGradient(x, y, 0, x, y, r); for (const [o, a] of stops) grd.addColorStop(o, `rgba(255,255,255,${a})`); return grd; };
const W = a => `rgba(255,255,255,${a})`;
const grey = (v, a = 1) => `rgba(${v},${v},${v},${a})`;
function poly(g, pts, close = true) { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); if (close) g.closePath(); }
function glow(g, blur, a = 0.9) { g.shadowColor = W(a); g.shadowBlur = blur; }
function noGlow(g) { g.shadowBlur = 0; g.shadowColor = 'transparent'; }
// carve (erase) with the next fill / stroke
function carve(g, a = 1) { g.globalCompositeOperation = 'destination-out'; g.fillStyle = g.strokeStyle = `rgba(0,0,0,${a})`; }
function paint(g) { g.globalCompositeOperation = 'source-over'; }
// a rune-like glyph of 2–4 straight strokes on a 3 × 4 point grid (no font needed, the same in every browser)
function rune(g, x, y, w, h, R, lw) {
  const P = (i, j) => [x + (i / 2 - 0.5) * w, y + (j / 3 - 0.5) * h];
  g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); const s = Math.floor(R() * 3); let [a, b] = P(s, 0); g.moveTo(a, b); [a, b] = P(s, 3); g.lineTo(a, b);
  const k = 1 + Math.floor(R() * 3);
  for (let i = 0; i < k; i++) { [a, b] = P(Math.floor(R() * 3), Math.floor(R() * 4)); g.moveTo(a, b); [a, b] = P(Math.floor(R() * 3), Math.floor(R() * 4)); g.lineTo(a, b); }
  g.stroke();
}
function runeCircle(g, cx, cy, r, n, size, R, lw) {
  for (let i = 0; i < n; i++) { const a = i / n * TAU; g.save(); g.translate(cx + Math.sin(a) * r, cy - Math.cos(a) * r); g.rotate(a); rune(g, 0, 0, size * 0.7, size, R, lw); g.restore(); }
}
function star(g, cx, cy, ro, ri, n, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) { const r = i % 2 ? ri : ro, a = rot + i / (n * 2) * TAU; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.closePath();
}
// a tapered stroke along a polyline: circles of decreasing radius (tendrils, claws, wisps)
function taper(g, pts, r0, r1, a0 = 1, a1 = 1) {
  const n = pts.length / 2 - 1; let len = 0; const seg = [];
  for (let i = 0; i < n; i++) { const d = Math.hypot(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1]); seg.push(d); len += d; }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const steps = Math.max(1, Math.ceil(seg[i] / 1.5));
    for (let s = 0; s < steps; s++) {
      const t = s / steps, u = (acc + seg[i] * t) / len;
      const x = pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * t, y = pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * t;
      g.fillStyle = W(a0 + (a1 - a0) * u); g.beginPath(); g.arc(x, y, r0 + (r1 - r0) * u, 0, TAU); g.fill();
    }
    acc += seg[i];
  }
}
// sample a smooth curve through control points (Catmull-Rom) as a flat [x, y, …] list
function curve(ctrl, per = 12) {
  const out = [], n = ctrl.length / 2, P = i => { i = Math.max(0, Math.min(n - 1, i)); return [ctrl[i * 2], ctrl[i * 2 + 1]]; };
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < per; s++) {
    const t = s / per, [x0, y0] = P(i - 1), [x1, y1] = P(i), [x2, y2] = P(i + 1), [x3, y3] = P(i + 2), t2 = t * t, t3 = t2 * t;
    out.push(0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3),
      0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3));
  }
  out.push(ctrl[ctrl.length - 2], ctrl[ctrl.length - 1]);
  return out;
}
function jagged(R, x0, y0, x1, y1, n, amp) {
  const pts = [x0, y0];
  for (let i = 1; i < n; i++) { const t = i / n; pts.push(x0 + (x1 - x0) * t + (R() - 0.5) * amp * 0.4, y0 + (y1 - y0) * t + (R() - 0.5) * amp); }
  pts.push(x1, y1); return pts;
}
function strokePts(g, pts) { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.stroke(); }

// ------------------------------------------------------------------ vector cells (canvas 2D, white on clear, 256² each)
const C = S / 2;
const VECTOR = {
  soft_dot(g) { g.fillStyle = radial(g, C, C, 124, [[0, 1], [0.18, 0.85], [0.42, 0.42], [0.7, 0.12], [1, 0]]); g.fillRect(0, 0, S, S); },
  hard_dot(g) {
    g.fillStyle = radial(g, C, C, 118, [[0, 0.6], [0.6, 0.5], [0.62, 0.32], [0.8, 0.1], [1, 0]]); g.fillRect(0, 0, S, S);
    g.fillStyle = W(1); g.beginPath(); g.arc(C, C, 70, 0, TAU); g.fill();
  },
  spark(g) {
    g.save(); g.translate(C, C); g.scale(0.13, 1); g.fillStyle = radial(g, 0, 0, 120, [[0, 1], [0.35, 0.75], [0.7, 0.2], [1, 0]]); g.beginPath(); g.arc(0, 0, 120, 0, TAU); g.fill(); g.restore();
    g.fillStyle = radial(g, C, 70, 34, [[0, 1], [1, 0]]); g.fillRect(0, 0, S, S);
  },
  ember(g, R) {
    for (let i = 0; i < 4; i++) { const x = C + (R() - 0.5) * 50, y = C + (R() - 0.5) * 50; g.fillStyle = radial(g, x, y, 60 + R() * 30, [[0, 0.45], [1, 0]]); g.fillRect(0, 0, S, S); }
    g.fillStyle = radial(g, C, C, 42, [[0, 1], [0.5, 0.9], [1, 0]]); g.fillRect(0, 0, S, S);
  },
  flame_tongue(g) {
    g.beginPath(); g.moveTo(C, 14); g.bezierCurveTo(C + 30, 80, C + 78, 130, C + 62, 186); g.bezierCurveTo(C + 50, 236, C - 50, 236, C - 62, 186); g.bezierCurveTo(C - 78, 130, C - 30, 80, C, 14); g.closePath();
    const grd = g.createLinearGradient(0, 14, 0, 240); grd.addColorStop(0, W(0.05)); grd.addColorStop(0.45, W(0.7)); grd.addColorStop(1, W(1));
    glow(g, 18, 0.6); g.fillStyle = grd; g.fill(); noGlow(g);
    g.fillStyle = radial(g, C, 182, 46, [[0, 0.9], [1, 0]]); g.fillRect(0, 0, S, S);
  },
  wisp(g) {
    const pts = curve([C, 78, C + 26, 120, C - 16, 168, C + 12, 214, C - 4, 244], 10);
    taper(g, pts, 26, 2, 0.5, 0.02);
    g.fillStyle = radial(g, C, 78, 64, [[0, 1], [0.3, 0.75], [1, 0]]); g.fillRect(0, 0, S, S);
  },
  frost_crystal_1(g) {
    glow(g, 14, 0.7); g.fillStyle = W(1); poly(g, [C, 10, C + 34, 120, C, 246, C - 34, 120]); g.fill(); noGlow(g);
    g.fillStyle = grey(200); poly(g, [C, 10, C + 34, 120, C, 246]); g.fill();
    g.fillStyle = grey(235); poly(g, [C, 10, C + 10, 120, C, 246, C - 8, 120]); g.fill();
    g.strokeStyle = W(1); g.lineWidth = 2; poly(g, [C, 10, C + 34, 120, C, 246, C - 34, 120]); g.stroke();
  },
  frost_crystal_2(g) {
    const shard = (x, y, w, h, a) => { g.save(); g.translate(x, y); g.rotate(a); glow(g, 10, 0.6); g.fillStyle = W(1); poly(g, [0, -h, w, -h * 0.25, 0, 0, -w, -h * 0.25]); g.fill(); noGlow(g); g.fillStyle = grey(195); poly(g, [0, -h, w, -h * 0.25, 0, 0]); g.fill(); g.strokeStyle = W(1); g.lineWidth = 2; poly(g, [0, -h, w, -h * 0.25, 0, 0, -w, -h * 0.25]); g.stroke(); g.restore(); };
    shard(C - 18, 236, 26, 150, -0.5); shard(C + 20, 236, 26, 160, 0.45); shard(C, 240, 34, 222, 0);
  },
  frost_crystal_3(g) {
    const hex = r => { const p = []; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + Math.PI / 6; p.push(C + Math.cos(a) * r, C + Math.sin(a) * r); } return p; };
    glow(g, 14, 0.6); g.fillStyle = W(0.92); poly(g, hex(112)); g.fill(); noGlow(g);
    for (let i = 0; i < 6; i++) { const a0 = i / 6 * TAU + Math.PI / 6, a1 = a0 + TAU / 6; g.fillStyle = grey(i % 2 ? 205 : 245, 0.95); poly(g, [C, C, C + Math.cos(a0) * 112, C + Math.sin(a0) * 112, C + Math.cos(a1) * 112, C + Math.sin(a1) * 112]); g.fill(); }
    g.strokeStyle = W(1); g.lineWidth = 3; poly(g, hex(112)); g.stroke(); g.lineWidth = 2; poly(g, hex(62)); g.stroke();
  },
  snowflake(g) {
    glow(g, 10, 0.8); g.strokeStyle = W(1); g.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      g.save(); g.translate(C, C); g.rotate(i / 6 * TAU);
      g.lineWidth = 9; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -112); g.stroke();
      g.lineWidth = 6; for (const [y, l] of [[-50, 30], [-84, 22]]) { g.beginPath(); g.moveTo(0, y); g.lineTo(l, y - l * 0.9); g.moveTo(0, y); g.lineTo(-l, y - l * 0.9); g.stroke(); }
      g.restore();
    }
    noGlow(g); g.fillStyle = W(1); g.beginPath(); g.arc(C, C, 14, 0, TAU); g.fill();
  },
  ice_crack(g, R) {
    g.strokeStyle = W(1); g.lineCap = 'round'; g.lineJoin = 'round'; glow(g, 6, 0.6);
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * TAU + R() * 0.5, len = 80 + R() * 40;
      const pts = [C, C]; let x = C, y = C;
      for (let k = 1; k <= 6; k++) { const r = len * k / 6, aa = a + (R() - 0.5) * 0.35; x = C + Math.cos(aa) * r; y = C + Math.sin(aa) * r; pts.push(x, y); }
      for (let k = 0; k < 6; k++) { g.lineWidth = 6 - k * 0.8; g.beginPath(); g.moveTo(pts[k * 2], pts[k * 2 + 1]); g.lineTo(pts[k * 2 + 2], pts[k * 2 + 3]); g.stroke(); }
      if (R() < 0.7) { const k = 2 + Math.floor(R() * 3), bx = pts[k * 2], by = pts[k * 2 + 1], ba = a + (R() < 0.5 ? 0.7 : -0.7); g.lineWidth = 2.5; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(ba) * 30, by + Math.sin(ba) * 30); g.stroke(); }
    }
    noGlow(g); g.fillStyle = W(0.9); g.beginPath(); g.arc(C, C, 10, 0, TAU); g.fill();
  },
  lightning_1(g, R) {
    const pts = jagged(R, 0, C, S, C, 14, 70);
    g.strokeStyle = W(0.55); g.lineWidth = 10; g.lineJoin = 'round'; glow(g, 20, 0.9); strokePts(g, pts);
    noGlow(g); g.strokeStyle = W(1); g.lineWidth = 3.5; strokePts(g, pts);
  },
  lightning_2(g, R) {
    const pts = jagged(R, 0, C, S, C, 12, 60);
    g.lineJoin = 'round'; g.strokeStyle = W(0.5); g.lineWidth = 9; glow(g, 18, 0.9); strokePts(g, pts);
    for (const k of [3, 8]) { const x = pts[k * 2], y = pts[k * 2 + 1]; const f = jagged(R, x, y, x + 70, y + (R() < 0.5 ? -60 : 60), 5, 26); g.lineWidth = 5; strokePts(g, f); }
    noGlow(g); g.strokeStyle = W(1); g.lineWidth = 3; strokePts(g, pts);
  },
  shockwave_ring(g) { g.fillStyle = radial(g, C, C, 124, [[0, 0], [0.55, 0], [0.8, 0.18], [0.9, 0.85], [0.94, 1], [0.97, 0.45], [1, 0]]); g.fillRect(0, 0, S, S); },
  rune_ring_1(g, R) {
    glow(g, 8, 0.7); g.strokeStyle = W(1); g.lineWidth = 4; g.beginPath(); g.arc(C, C, 118, 0, TAU); g.stroke();
    g.lineWidth = 2.5; g.beginPath(); g.arc(C, C, 88, 0, TAU); g.stroke();
    runeCircle(g, C, C, 103, 16, 20, R, 3);
  },
  rune_ring_2(g) {
    glow(g, 8, 0.7); g.strokeStyle = W(1); g.fillStyle = W(1);
    g.lineWidth = 3; g.beginPath(); g.arc(C, C, 112, 0, TAU); g.stroke();
    for (let i = 0; i < 72; i++) { const a = i / 72 * TAU, l = i % 6 === 0 ? 18 : 8; g.lineWidth = i % 6 === 0 ? 3 : 1.5; g.beginPath(); g.moveTo(C + Math.sin(a) * 112, C - Math.cos(a) * 112); g.lineTo(C + Math.sin(a) * (112 - l), C - Math.cos(a) * (112 - l)); g.stroke(); }
    for (let i = 0; i < 24; i++) { const a = (i + 0.5) / 24 * TAU; g.beginPath(); g.arc(C + Math.sin(a) * 84, C - Math.cos(a) * 84, i % 2 ? 2.5 : 4.5, 0, TAU); g.fill(); }
    g.lineWidth = 1.5; g.beginPath(); g.arc(C, C, 72, 0, TAU); g.stroke();
  },
  cast_circle(g, R) {
    glow(g, 8, 0.75); g.strokeStyle = W(1); g.fillStyle = W(1);
    g.lineWidth = 5; g.beginPath(); g.arc(C, C, 120, 0, TAU); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.arc(C, C, 110, 0, TAU); g.stroke(); g.beginPath(); g.arc(C, C, 80, 0, TAU); g.stroke();
    runeCircle(g, C, C, 95, 12, 22, R, 3.2);
    g.lineWidth = 2.5; for (const rot of [-Math.PI / 2, Math.PI / 2]) { star(g, C, C, 78, 78, 3, rot); g.stroke(); }
    g.lineWidth = 2; g.beginPath(); g.arc(C, C, 30, 0, TAU); g.stroke();
    g.save(); g.translate(C, C); rune(g, 0, 0, 22, 34, R, 4); g.restore();
  },
  hexagram(g) {
    glow(g, 10, 0.8); g.strokeStyle = W(1); g.lineJoin = 'round';
    g.lineWidth = 4; g.beginPath(); g.arc(C, C, 118, 0, TAU); g.stroke();
    g.lineWidth = 5; for (const rot of [-Math.PI / 2, Math.PI / 2]) { star(g, C, C, 110, 110, 3, rot); g.stroke(); }
    g.lineWidth = 2; g.beginPath(); g.arc(C, C, 56, 0, TAU); g.stroke();
  },
  holy_ray(g) {
    const h = g.createLinearGradient(0, 0, S, 0); h.addColorStop(0, W(0)); h.addColorStop(0.3, W(0.25)); h.addColorStop(0.5, W(1)); h.addColorStop(0.7, W(0.25)); h.addColorStop(1, W(0));
    g.fillStyle = h; g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'destination-in';
    const v = g.createLinearGradient(0, 0, 0, S); v.addColorStop(0, W(0)); v.addColorStop(0.2, W(1)); v.addColorStop(0.75, W(1)); v.addColorStop(1, W(0));
    g.fillStyle = v; g.fillRect(0, 0, S, S); paint(g);
  },
  sunburst(g) {
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU, l = i % 2 ? 96 : 124, w = i % 2 ? 0.07 : 0.1;
      g.fillStyle = radial(g, C, C, l, [[0, 1], [0.4, 0.7], [1, 0]]);
      g.beginPath(); g.moveTo(C + Math.cos(a - w) * 18, C + Math.sin(a - w) * 18); g.lineTo(C + Math.cos(a) * l, C + Math.sin(a) * l); g.lineTo(C + Math.cos(a + w) * 18, C + Math.sin(a + w) * 18); g.closePath(); g.fill();
    }
    g.fillStyle = radial(g, C, C, 64, [[0, 1], [0.5, 0.8], [1, 0]]); g.fillRect(0, 0, S, S);
  },
  feather(g) {
    g.save(); g.translate(C, C); g.rotate(0.12);
    g.beginPath(); g.moveTo(0, -116); g.bezierCurveTo(46, -90, 52, 20, 10, 92); g.lineTo(-6, 92); g.bezierCurveTo(-48, 30, -40, -84, 0, -116); g.closePath();
    const grd = g.createLinearGradient(0, -116, 0, 100); grd.addColorStop(0, W(0.95)); grd.addColorStop(1, W(0.7));
    glow(g, 10, 0.5); g.fillStyle = grd; g.fill(); noGlow(g);
    carve(g, 0.45); g.lineWidth = 2;
    for (let i = 0; i < 14; i++) { const y = -96 + i * 13; g.beginPath(); g.moveTo(0, y); g.lineTo(40, y - 20); g.moveTo(0, y + 4); g.lineTo(-38, y - 16); g.stroke(); }
    paint(g); g.strokeStyle = W(1); g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, -110); g.quadraticCurveTo(4, 0, 2, 120); g.stroke();
    g.restore();
  },
  star(g) { glow(g, 14, 0.8); g.fillStyle = W(1); g.lineJoin = 'round'; star(g, C, C + 6, 112, 46, 5); g.fill(); noGlow(g); g.fillStyle = grey(225); star(g, C, C + 6, 60, 26, 5); g.fill(); },
  leaf_1(g) {
    g.beginPath(); g.moveTo(C, 14); g.quadraticCurveTo(C + 88, 110, C, 228); g.quadraticCurveTo(C - 88, 110, C, 14); g.closePath();
    glow(g, 8, 0.5); g.fillStyle = W(0.95); g.fill(); noGlow(g);
    carve(g, 0.5); g.lineWidth = 3; g.beginPath(); g.moveTo(C, 24); g.lineTo(C, 226); g.stroke();
    g.lineWidth = 2; for (let i = 0; i < 6; i++) { const y = 60 + i * 26; g.beginPath(); g.moveTo(C, y + 18); g.lineTo(C + 40 - i * 3, y); g.moveTo(C, y + 18); g.lineTo(C - 40 + i * 3, y); g.stroke(); }
    paint(g); g.strokeStyle = W(1); g.lineWidth = 4; g.beginPath(); g.moveTo(C, 226); g.lineTo(C, 248); g.stroke();
  },
  leaf_2(g) {
    g.fillStyle = W(0.95); glow(g, 8, 0.5);
    for (const [x, y, r] of [[C, 92, 56], [C - 52, 120, 44], [C + 52, 120, 44], [C - 30, 168, 40], [C + 30, 168, 40]]) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
    noGlow(g); carve(g, 0.5); g.lineWidth = 2.5;
    for (const [x, y] of [[C, 50], [C - 86, 110], [C + 86, 110], [C - 56, 196], [C + 56, 196]]) { g.beginPath(); g.moveTo(C, 200); g.lineTo(x, y); g.stroke(); }
    paint(g); g.strokeStyle = W(1); g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(C, 196); g.lineTo(C, 246); g.stroke();
  },
  petal(g) {
    g.beginPath(); g.moveTo(C, 236); g.bezierCurveTo(C + 110, 150, C + 70, 20, C, 30); g.bezierCurveTo(C - 70, 20, C - 110, 150, C, 236); g.closePath();
    const grd = g.createLinearGradient(0, 30, 0, 236); grd.addColorStop(0, W(1)); grd.addColorStop(1, W(0.6));
    glow(g, 10, 0.5); g.fillStyle = grd; g.fill(); noGlow(g);
    g.fillStyle = grey(225, 0.8); g.beginPath(); g.ellipse(C, 190, 14, 40, 0, 0, TAU); g.fill();
  },
  vine(g) {
    const pts = []; for (let i = 0; i <= 64; i++) { const x = i / 64 * S; pts.push(x, C + Math.sin(i / 64 * TAU) * 40); }
    g.strokeStyle = W(1); g.lineWidth = 12; g.lineCap = 'round'; glow(g, 8, 0.5); strokePts(g, pts); noGlow(g);
    for (let k = 0; k < 4; k++) {
      const x = (k + 0.5) / 4 * S, y = C + Math.sin((k + 0.5) / 4 * TAU) * 40, up = k % 2 ? 1 : -1;
      g.save(); g.translate(x, y); g.rotate(up * 0.6); g.fillStyle = W(0.95); g.beginPath(); g.ellipse(0, up * 30, 13, 28, 0, 0, TAU); g.fill(); g.restore();
      g.strokeStyle = W(0.9); g.lineWidth = 4; g.beginPath(); g.moveTo(x + 18, y); g.quadraticCurveTo(x + 30, y - up * 40, x + 14, y - up * 52); g.stroke();
    }
  },
  thorn(g) {
    g.beginPath(); g.moveTo(C - 44, 244); g.quadraticCurveTo(C - 20, 120, C + 30, 14); g.quadraticCurveTo(C + 8, 130, C + 44, 244); g.closePath();
    const grd = g.createLinearGradient(0, 14, 0, 244); grd.addColorStop(0, W(1)); grd.addColorStop(1, W(0.85));
    glow(g, 8, 0.5); g.fillStyle = grd; g.fill(); noGlow(g);
    g.fillStyle = grey(190); g.beginPath(); g.moveTo(C + 30, 14); g.quadraticCurveTo(C + 8, 130, C + 44, 244); g.lineTo(C + 10, 244); g.quadraticCurveTo(C - 4, 130, C + 30, 14); g.fill();
  },
  poison_bubble(g) {
    g.fillStyle = radial(g, C, C, 104, [[0, 0.12], [0.75, 0.22], [0.92, 0.95], [1, 0]]); g.beginPath(); g.arc(C, C, 106, 0, TAU); g.fill();
    g.fillStyle = W(1); g.beginPath(); g.ellipse(C - 40, C - 44, 22, 13, -0.7, 0, TAU); g.fill();
    g.fillStyle = W(0.6); g.beginPath(); g.arc(C + 46, C + 44, 8, 0, TAU); g.fill();
  },
  drip(g) {
    g.beginPath(); g.moveTo(C, 16); g.bezierCurveTo(C + 20, 80, C + 66, 120, C + 66, 172); g.arc(C, 172, 66, 0, Math.PI); g.bezierCurveTo(C - 66, 120, C - 20, 80, C, 16); g.closePath();
    glow(g, 10, 0.5); g.fillStyle = W(0.95); g.fill(); noGlow(g);
    g.fillStyle = grey(255, 1); g.beginPath(); g.ellipse(C - 26, 160, 10, 22, 0.3, 0, TAU); g.fill();
    g.fillStyle = grey(200, 0.9); g.beginPath(); g.arc(C + 20, 196, 30, 0, Math.PI * 0.6); g.lineTo(C + 20, 196); g.fill();
  },
  blood_drop(g, R) {
    glow(g, 6, 0.4); g.fillStyle = W(1);
    g.beginPath(); g.arc(C, C, 66, 0, TAU); g.fill();
    for (let i = 0; i < 7; i++) { const a = R() * TAU, r = 80 + R() * 34, s = 6 + R() * 12; g.beginPath(); g.arc(C + Math.cos(a) * r, C + Math.sin(a) * r, s, 0, TAU); g.fill(); g.lineWidth = s * 0.9; g.strokeStyle = W(1); g.beginPath(); g.moveTo(C + Math.cos(a) * 50, C + Math.sin(a) * 50); g.lineTo(C + Math.cos(a) * r, C + Math.sin(a) * r); g.stroke(); }
    noGlow(g); g.fillStyle = grey(210); g.beginPath(); g.arc(C + 14, C + 16, 44, 0, TAU); g.fill();
  },
  tendril_1(g, R) {
    const pts = curve([C - 10, 246, C + 30, 190, C - 34, 130, C + 26, 72, C - 6, 30, C + 24, 12], 12);
    for (let i = 0; i < pts.length; i += 2) pts[i] += (R() - 0.5) * 3;
    glow(g, 10, 0.5); taper(g, pts, 22, 2, 1, 0.75); noGlow(g);
  },
  tendril_2(g) {
    glow(g, 8, 0.5);
    taper(g, curve([C - 20, 248, C - 40, 180, C - 90, 130, C - 70, 70, C - 30, 70, C - 40, 100], 10), 18, 2, 1, 0.7);
    taper(g, curve([C + 20, 248, C + 36, 170, C + 92, 120, C + 80, 50, C + 40, 44, C + 44, 76], 10), 18, 2, 1, 0.7);
    noGlow(g);
  },
  void_eye(g) {
    const eye = () => { g.beginPath(); g.moveTo(16, C); g.quadraticCurveTo(C, 20, S - 16, C); g.quadraticCurveTo(C, S - 20, 16, C); g.closePath(); };
    g.fillStyle = radial(g, C, C, 124, [[0, 0.6], [0.6, 0.3], [1, 0]]); g.fillRect(0, 0, S, S);
    glow(g, 12, 0.8); eye(); g.fillStyle = W(0.9); g.fill(); noGlow(g);
    carve(g, 0.85); g.beginPath(); g.arc(C, C, 52, 0, TAU); g.fill();
    paint(g); g.fillStyle = W(1); g.beginPath(); g.ellipse(C, C, 12, 50, 0, 0, TAU); g.fill();
    g.strokeStyle = W(1); g.lineWidth = 3; g.beginPath(); g.arc(C, C, 52, 0, TAU); g.stroke();
  },
  skull(g) {
    g.strokeStyle = W(1); g.lineCap = 'round'; g.lineWidth = 16; glow(g, 8, 0.6);
    g.beginPath(); g.moveTo(40, 172); g.lineTo(216, 240); g.moveTo(216, 172); g.lineTo(40, 240); g.stroke();
    g.fillStyle = W(1); for (const [x, y] of [[36, 164], [30, 180], [220, 164], [226, 180], [36, 240], [30, 228], [220, 240], [226, 228]]) { g.beginPath(); g.arc(x, y, 10, 0, TAU); g.fill(); }
    g.beginPath(); g.arc(C, 100, 78, 0, TAU); g.fill();
    g.beginPath(); g.roundRect(C - 46, 130, 92, 66, 14); g.fill(); noGlow(g);
    carve(g); g.beginPath(); g.ellipse(C - 32, 104, 21, 24, 0.2, 0, TAU); g.ellipse(C + 32, 104, 21, 24, -0.2, 0, TAU); g.fill();
    poly(g, [C, 128, C - 11, 152, C + 11, 152]); g.fill();
    g.lineWidth = 4; for (const x of [-24, -8, 8, 24]) { g.beginPath(); g.moveTo(C + x, 172); g.lineTo(C + x, 196); g.stroke(); }
    paint(g);
  },
  flag(g) {
    glow(g, 8, 0.6); g.fillStyle = W(1); g.strokeStyle = W(1); g.lineCap = 'round';
    g.lineWidth = 12; g.beginPath(); g.moveTo(62, 26); g.lineTo(62, 238); g.stroke();
    g.beginPath(); g.moveTo(68, 34); g.bezierCurveTo(120, 14, 160, 64, 226, 40); g.lineTo(226, 128); g.bezierCurveTo(160, 152, 120, 102, 68, 122); g.closePath(); g.fill();
    noGlow(g); g.fillStyle = grey(205); g.beginPath(); g.moveTo(130, 44); g.bezierCurveTo(160, 64, 190, 56, 226, 40); g.lineTo(226, 128); g.bezierCurveTo(190, 140, 160, 146, 130, 132); g.fill();
    g.fillStyle = W(1); g.beginPath(); g.arc(62, 22, 10, 0, TAU); g.fill();
  },
  scales(g) {
    glow(g, 8, 0.6); g.strokeStyle = W(1); g.fillStyle = W(1); g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = 9; g.beginPath(); g.moveTo(C, 34); g.lineTo(C, 218); g.moveTo(34, 64); g.lineTo(222, 64); g.moveTo(88, 230); g.lineTo(168, 230); g.stroke();
    g.beginPath(); g.arc(C, 30, 12, 0, TAU); g.fill();
    g.lineWidth = 3; for (const x of [52, 204]) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x - 34, 150); g.moveTo(x, 64); g.lineTo(x + 34, 150); g.stroke(); g.beginPath(); g.moveTo(x - 42, 150); g.quadraticCurveTo(x, 196, x + 42, 150); g.closePath(); g.fill(); }
  },
  sigil_hex(g) {
    glow(g, 10, 0.75); g.strokeStyle = W(1); g.fillStyle = W(1); g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = 5; g.beginPath(); g.arc(C, C, 114, 0, TAU); g.stroke();
    g.lineWidth = 6; g.beginPath(); for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + (i * 2 % 5) / 5 * TAU; const x = C + Math.cos(a) * 100, y = C + Math.sin(a) * 100; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    g.lineWidth = 4; for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i / 5 * TAU, x = C + Math.cos(a) * 100, y = C + Math.sin(a) * 100; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a + 1.9) * 22, y + Math.sin(a + 1.9) * 22); g.stroke(); }
    g.beginPath(); g.arc(C, C, 12, 0, TAU); g.fill();
  },
  sigil_weak(g) {
    glow(g, 10, 0.7); g.strokeStyle = W(1); g.fillStyle = W(1);
    g.lineWidth = 3; g.beginPath(); g.arc(C, C, 118, 0, TAU); g.stroke();
    poly(g, [C - 16, 66, C + 16, 66, C + 16, 196, C, 228, C - 16, 196]); g.fill();
    g.beginPath(); g.roundRect(C - 54, 56, 108, 14, 6); g.fill(); g.beginPath(); g.roundRect(C - 7, 20, 14, 40, 4); g.fill(); g.beginPath(); g.arc(C, 18, 11, 0, TAU); g.fill();
    noGlow(g); carve(g); g.lineWidth = 7; g.lineJoin = 'miter'; strokePts(g, [C - 24, 108, C + 6, 124, C - 10, 140, C + 24, 158]); paint(g);
  },
  sigil_doom(g) {
    glow(g, 10, 0.75); g.strokeStyle = W(1); g.fillStyle = W(1); g.lineCap = 'round';
    g.lineWidth = 6; g.beginPath(); g.arc(C, C, 114, 0, TAU); g.stroke();
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; g.lineWidth = i % 3 ? 3 : 6; g.beginPath(); g.moveTo(C + Math.sin(a) * 102, C - Math.cos(a) * 102); g.lineTo(C + Math.sin(a) * (i % 3 ? 90 : 82), C - Math.cos(a) * (i % 3 ? 90 : 82)); g.stroke(); }
    poly(g, [C - 40, 70, C + 40, 70, C + 6, C, C + 40, 186, C - 40, 186, C - 6, C]); g.fill();
    g.lineWidth = 6; g.beginPath(); g.moveTo(C - 48, 66); g.lineTo(C + 48, 66); g.moveTo(C - 48, 190); g.lineTo(C + 48, 190); g.stroke();
    noGlow(g); carve(g, 0.8); poly(g, [C - 26, 80, C + 26, 80, C, 116]); g.fill(); paint(g);
  },
  bone_shard_1(g) {
    glow(g, 6, 0.4); g.fillStyle = grey(240); poly(g, [C - 6, 14, C + 22, 60, C + 26, 150, C + 14, 214, C + 24, 244, C - 4, 226, C - 22, 244, C - 24, 150, C - 26, 70]); g.fill(); noGlow(g);
    g.fillStyle = grey(190); poly(g, [C - 6, 14, C + 22, 60, C + 26, 150, C + 14, 214, C + 2, 150]); g.fill();
  },
  bone_shard_2(g) {
    glow(g, 6, 0.4); g.fillStyle = grey(240);
    g.beginPath(); g.arc(C - 22, 56, 30, 0, TAU); g.arc(C + 22, 56, 30, 0, TAU); g.fill();
    poly(g, [C - 20, 70, C + 20, 70, C + 18, 190, C + 30, 214, C + 4, 206, C - 8, 234, C - 16, 200, C - 18, 190]); g.fill(); noGlow(g);
    g.fillStyle = grey(195); poly(g, [C + 4, 70, C + 20, 70, C + 18, 190, C + 30, 214, C + 4, 206]); g.fill();
  },
  stone_chip_1(g) {
    const P = [C - 70, 90, C - 20, 26, C + 64, 46, C + 104, 130, C + 56, 216, C - 40, 226, C - 100, 160];
    glow(g, 4, 0.3); g.fillStyle = grey(235); poly(g, P); g.fill(); noGlow(g);
    g.fillStyle = grey(185); poly(g, [C + 64, 46, C + 104, 130, C + 56, 216, C + 10, 120]); g.fill();
    g.fillStyle = grey(140); poly(g, [C + 56, 216, C - 40, 226, C - 100, 160, C + 10, 120]); g.fill();
  },
  stone_chip_2(g) {
    const P = [C - 110, 140, C - 60, 90, C + 30, 84, C + 106, 112, C + 92, 160, C + 10, 180, C - 80, 172];
    glow(g, 4, 0.3); g.fillStyle = grey(230); poly(g, P); g.fill(); noGlow(g);
    g.fillStyle = grey(170); poly(g, [C + 106, 112, C + 92, 160, C + 10, 180, C - 80, 172, C - 110, 140, C - 10, 132]); g.fill();
  },
  moon_disc(g) {
    g.fillStyle = radial(g, C, C, 126, [[0, 0.5], [0.8, 0.35], [1, 0]]); g.fillRect(0, 0, S, S);
    g.fillStyle = W(1); g.beginPath(); g.arc(C, C, 100, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = grey(150); g.beginPath(); g.arc(C + 52, C - 20, 100, 0, TAU); g.fill();
    g.fillStyle = grey(205); for (const [x, y, r] of [[C - 40, C - 30, 16], [C - 56, C + 30, 10], [C - 14, C + 52, 13]]) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
    paint(g);
  },
  arrow_streak(g) {
    const grd = g.createLinearGradient(0, 30, 0, 248); grd.addColorStop(0, W(1)); grd.addColorStop(1, W(0));
    glow(g, 8, 0.6); g.strokeStyle = grd; g.lineWidth = 5; g.beginPath(); g.moveTo(C, 40); g.lineTo(C, 248); g.stroke();
    g.fillStyle = W(1); poly(g, [C, 8, C + 14, 46, C - 14, 46]); g.fill(); noGlow(g);
  },
  paw(g) {
    glow(g, 6, 0.4); g.fillStyle = W(0.95);
    g.beginPath(); g.moveTo(C, 120); g.bezierCurveTo(C + 70, 120, C + 80, 220, C, 214); g.bezierCurveTo(C - 80, 220, C - 70, 120, C, 120); g.fill();
    for (const [x, y, a] of [[C - 74, 104, -0.5], [C - 28, 66, -0.15], [C + 28, 66, 0.15], [C + 74, 104, 0.5]]) { g.beginPath(); g.ellipse(x, y, 20, 28, a, 0, TAU); g.fill(); }
    noGlow(g);
  },
  claw(g) {
    glow(g, 8, 0.6);
    for (const dx of [-54, 0, 54]) {
      const pts = curve([C + dx + 56, 20, C + dx + 22, 90, C + dx - 10, 160, C + dx - 44, 236], 12), n = pts.length / 2;
      for (let i = 0; i < n; i++) { const u = i / (n - 1), r = 2 + Math.sin(u * Math.PI) * 11; g.fillStyle = W(0.4 + Math.sin(u * Math.PI) * 0.6); g.beginPath(); g.arc(pts[i * 2], pts[i * 2 + 1], r, 0, TAU); g.fill(); }
    }
    noGlow(g);
  },
  cracked_heart(g) {
    g.beginPath(); g.moveTo(C, 224); g.bezierCurveTo(C - 140, 130, C - 90, 22, C, 74); g.bezierCurveTo(C + 90, 22, C + 140, 130, C, 224); g.closePath();
    glow(g, 12, 0.7); g.fillStyle = W(1); g.fill(); noGlow(g);
    carve(g); g.lineWidth = 8; g.lineJoin = 'miter'; strokePts(g, [C - 2, 70, C + 16, 106, C - 14, 132, C + 12, 164, C - 4, 196]); paint(g);
    g.fillStyle = grey(210); g.beginPath(); g.ellipse(C + 50, 120, 22, 34, 0.5, 0, TAU); g.fill();
  },
};

// ------------------------------------------------------------------ pixel cells (written straight into the buffer)
const RAMPS = {
  ramp_fire: [[0, 0xffffff], [0.15, 0xfff2a0], [0.35, 0xffb040], [0.6, 0xff5a10], [0.8, 0x8a1a08], [1, 0x100404]],
  ramp_frost: [[0, 0xffffff], [0.3, 0xd8f6ff], [0.6, 0x8fd8ff], [1, 0x1a3a78]],
  ramp_void: [[0, 0xf4e8ff], [0.35, 0xb98cff], [0.7, 0x5a1aa8], [1, 0x0a0418]],
  ramp_nature: [[0, 0xf8ffe0], [0.35, 0xc8f06a], [0.7, 0x4aa82a], [1, 0x14300c]],
};
function pixelCell(D, cell, N) {
  const { x: X, y: Y } = cellRect(cell), id = cell.id;
  const put = (x, y, r, g, b, a) => { const i = ((Y + y) * ATLAS.size + X + x) * 4; D[i] = r; D[i + 1] = g; D[i + 2] = b; D[i + 3] = a; };
  if (RAMPS[id]) {
    const st = RAMPS[id];
    for (let x = 0; x < S; x++) {
      const u = x / (S - 1); let k = 0; while (k < st.length - 2 && u > st[k + 1][0]) k++;
      const [u0, c0] = st[k], [u1, c1] = st[k + 1], t = clamp01((u - u0) / (u1 - u0));
      const r = ((c0 >> 16) & 255) * (1 - t) + ((c1 >> 16) & 255) * t, g = ((c0 >> 8) & 255) * (1 - t) + ((c1 >> 8) & 255) * t, b = (c0 & 255) * (1 - t) + (c1 & 255) * t;
      for (let y = 0; y < S; y++) put(x, y, r, g, b, 255);
    }
    return;
  }
  if (id === 'smoke' || id === 'fire') {
    const F = ATLAS.frame;
    for (let f = 0; f < 16; f++) {
      const fx = (f % 4) * F, fy = Math.floor(f / 4) * F, u = f / 15;
      for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) {
        const px = (x + 0.5) / F * 2 - 1, py = (y + 0.5) / F * 2 - 1; // py: -1 top … +1 bottom
        let r, a;
        if (id === 'smoke') {
          // a billowing puff: low-frequency lumps push the outline, finer noise gives the texture; it grows and thins
          const R0 = 0.6 + 0.34 * u;
          const n1 = N.fbm(px * 1.2 + 10, py * 1.2 - u * 0.9 + 10, 4), n2 = N.fbm(px * 2.6 + 3, py * 2.6 - u * 1.4 + 7, 4);
          const d = Math.hypot(px, py) + (n1 - 0.5) * 0.55;
          const shape = smooth(R0, R0 * 0.5, d);
          a = shape * (0.92 - 0.55 * u) * clamp01(0.45 + 0.85 * n2);
          r = 0.5 + 0.5 * clamp01(0.55 - py * 0.55 + (n2 - 0.5) * 0.9); // lit from above, lumps catch the light
        } else {
          // a teardrop flame with licking tongues; the noise scrolls up by exactly one period over the 16 frames (loops)
          const t = f / 16, h = (1 - (py * 0.5 + 0.5) - 0.05) / 0.92; // h: 0 at the flame's foot … 1 at its tip
          const n1 = N.fbm(px * 1.5 + 5, py * 1.5 + t * 4, 3, 4, 4), n2 = N.fbm(px * 3 + 1, py * 3 + t * 8, 3, 8, 8);
          const x = px - (n1 - 0.5) * 0.7 * Math.max(0, h);
          const base = 0.3;
          let w = h < 0 ? 0 : h < base ? 0.52 * Math.sqrt(Math.max(0, 1 - ((base - h) / base) ** 2)) : 0.52 * Math.pow(Math.max(0, 1 - (h - base) / (1 - base)), 0.85);
          w *= 0.85 + 0.35 * n2;
          const body = w > 0 ? smooth(w, w * 0.4, Math.abs(x)) : 0;
          const tongues = smooth(0.2, 0.5, n2 + 0.75 - h * 0.85);
          a = clamp01(body * tongues * 1.15);
          r = clamp01(0.35 + 0.85 * (w > 0 ? smooth(w * 0.85, 0, Math.abs(x)) : 0) * (1 - Math.max(0, h) * 0.75));
        }
        put(fx + x, fy + y, 255 * r, 255 * r, 255 * r, 255 * clamp01(a));
      }
    }
    return;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const px = (x + 0.5) / S * 2 - 1, py = (y + 0.5) / S * 2 - 1, d = Math.hypot(px, py);
    let v = 1, a = 0;
    if (id === 'mist') { const n = N.fbm(px * 1.6 + 30, py * 1.6 + 30, 4); a = smooth(1, 0.1, d + (n - 0.5) * 0.5) * (0.35 + 0.65 * n) * 0.8; }
    else if (id === 'dust') { const n = N.fbm(px * 3 + 50, py * 3 + 50, 5), rid = 1 - Math.abs(n * 2 - 1); a = smooth(0.95, 0.2, d + (n - 0.5) * 0.6) * Math.pow(rid, 1.6) * 0.95; v = 0.75 + 0.25 * n; }
    else if (id === 'noise') { const n = N.fbm(x / S * 4, y / S * 4, 5, 4, 4); v = a = clamp01((n - 0.5) * 1.6 + 0.5); }
    else if (id === 'hex_pattern') {
      // pointy hex grid, 7 across × 4 rows-pairs: tiles in both axes (cells ~1 % taller than regular)
      const qx = x / S * 7, qy = y / S * 4 * 1.7320508, rx = 1, ry = 1.7320508;
      const ax = ((qx % rx) + rx) % rx - 0.5, ay = ((qy % ry) + ry) % ry - ry / 2;
      const bx = (((qx - 0.5) % rx) + rx) % rx - 0.5, by = (((qy - ry / 2) % ry) + ry) % ry - ry / 2;
      const [gx, gy] = ax * ax + ay * ay < bx * bx + by * by ? [ax, ay] : [bx, by];
      const e = Math.max(Math.abs(gx), Math.abs(gx) * 0.5 + Math.abs(gy) * 0.8660254); // 0 centre … 0.5 edge
      a = smooth(0.40, 0.5, e) * 0.95 + smooth(0.2, 0.5, e) * 0.12;
    }
    put(x, y, 255 * v, 255 * v, 255 * v, 255 * clamp01(a));
  }
}

// ------------------------------------------------------------------ build
export function paintAtlas() {
  const N = ATLAS.size, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const t0 = performance.now();
  let seed = 7;
  for (const cell of CELLS) {
    const fn = VECTOR[cell.id]; if (!fn) continue;
    const r = cellRect(cell);
    g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip(); g.translate(r.x, r.y);
    g.lineCap = 'butt'; g.lineJoin = 'miter';
    fn(g, rng(seed++ * 7919));
    g.restore(); paint(g); noGlow(g);
  }
  const img = g.getImageData(0, 0, N, N), D = img.data;
  // vector cells: fully transparent texels take white, so the mip chain doesn't pull edges toward black
  for (const cell of CELLS) {
    if (!VECTOR[cell.id]) continue;
    const r = cellRect(cell);
    for (let y = r.y; y < r.y + r.h; y++) for (let i = (y * N + r.x) * 4, e = i + r.w * 4; i < e; i += 4) if (D[i + 3] === 0) { D[i] = D[i + 1] = D[i + 2] = 255; }
  }
  const noise = makeNoise(1337);
  for (const cell of CELLS) if (!VECTOR[cell.id]) pixelCell(D, cell, noise);
  return { data: D, canvas: cv, ctx: g, image: img, ms: performance.now() - t0 };
}

export function createAtlas() {
  const A = paintAtlas();
  const tex = new THREE.DataTexture(new Uint8Array(A.data.buffer), ATLAS.size, ATLAS.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace; // masks are data; ramps are decoded from sRGB in the shaders
  tex.flipY = false; tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.anisotropy = 4;
  tex.needsUpdate = true;
  // the canvas holds only the vector cells until a preview / bake asks for the full picture
  let full = false;
  const canvas = () => { if (!full) { A.ctx.putImageData(A.image, 0, 0); full = true; } return A.canvas; };
  return { texture: tex, canvas, data: A.data, paintMs: A.ms };
}
