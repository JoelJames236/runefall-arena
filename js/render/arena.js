// Runefall Arena — the fighting pit. A weathered gladiatorial ring sunk into a gothic fortress
// at dusk: a monastery-stone floor that blends into trampled dirt toward the walls, four massive
// mossy columns (the line-of-sight blockers) crowned with iron braziers, a buttressed podium
// wall with torches and ivy, two portcullis gatehouses (Gold at -z, Crimson at +z), tiered
// stone stands with a sparse crowd of shadowed figures and ragged banners, and beyond the
// walls dark towers and cliffs that dissolve into the fog.
// Real PBR texture sets (assets/tex) on generated geometry merged per material; glTF props
// (assets/props) are instanced. Sky, IBL, sun, hemisphere light, fog, tone mapping and post
// processing are owned by world.js — this module only adds geometry, ≤ 6 point lights and
// cheap additive effects.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PILLARS, ARENA_R } from '../sim/sim.js';

const TAU = Math.PI * 2;
const TEX_DIR = 'assets/tex/', PROP_DIR = 'assets/props/';     // relative: the site is served from a sub-path
const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
const RUNE_FONT = '"Segoe UI Historic", "Noto Sans Runic", "Segoe UI Symbol", serif';
const FLOOR_R = ARENA_R + 3.5;              // 32.5 — reaches under the podium wall
const WALL_R = ARENA_R + 2.5;               // 31.5 — inner face of the podium wall
const GATE_G = 0.145;                       // angular half-gap left in the ring for each gatehouse
const TIER0_R = WALL_R + 1.5, TIER0_Y = 4.9, TIER_D = 0.95, TIER_H = 0.5, TIERS = 7;
const PROM_R = TIER0_R + TIERS * TIER_D;    // 39.65 upper promenade
const PROM_Y = TIER0_Y + TIERS * TIER_H;    // 8.4
const BACK_R = PROM_R + 1.35, BACK_T = 0.9, BACK_Y = 14.0;
const BAY = Math.PI / 20;                   // pilaster spacing (40 around the ring)
const FIRE_HEX = 0xff8a3c;
const WHITE = new THREE.Color(1, 1, 1);
const STONE = { grime: true };
const IRON = { tint: new THREE.Color(0.66, 0.6, 0.56) };
const WOOD = { tint: new THREE.Color(0.82, 0.76, 0.7) };
const ROCK = { vary: true };
// brazier bowl profile [r, y, smoothCorner] — inner surface, rim, outer surface, stem, foot
const BOWL = [[0, 0.52], [0.62, 0.86, 1], [0.78, 0.98], [0.9, 0.98], [0.86, 0.82, 1], [0.62, 0.5, 1], [0.32, 0.32], [0.2, 0.26], [0.2, 0.1], [0.5, 0.1], [0.55, 0.05], [0.55, 0]];

const QUALITY = {
  high:   { crowd: 420, embers: 560, mist: true,  extra: true,  lights: 6, decal: 2048, decals: 12, propShadow: true,  vines: 14, towers: 8, keeps: 3 },
  medium: { crowd: 300, embers: 400, mist: true,  extra: true,  lights: 6, decal: 2048, decals: 9,  propShadow: false, vines: 9,  towers: 8, keeps: 3 },
  low:    { crowd: 140, embers: 200, mist: false, extra: false, lights: 4, decal: 1024, decals: 5,  propShadow: false, vines: 0,  towers: 5, keeps: 2 },
};
const CORE_PROPS = new Set(['Torch_Metal', 'Barrel', 'Crate_Wooden', 'WeaponStand', 'Chest_Wood', 'Roof_Tower_RoundTiles']);

// ------------------------------------------------------------------ small helpers
function rng(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
function hash3(x, y, z) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123; return h - Math.floor(h); }
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let u = x - xi, v = y - yi, w = z - zi;
  u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v); w = w * w * (3 - 2 * w);
  const a = lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), b = lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u);
  const c = lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), d = lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u);
  return lerp(lerp(a, b, v), lerp(c, d, v), w);
}
function fbm3(x, y, z, oct = 3) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += amp * noise3(x * f, y * f, z * f); n += amp; amp *= 0.5; f *= 2.03; }
  return s / n;
}
function inSector(a, m = 0) {
  a = ((a % TAU) + TAU) % TAU;
  return (a > GATE_G + m && a < Math.PI - GATE_G - m) || (a > Math.PI + GATE_G + m && a < TAU - GATE_G - m);
}
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3();
function mtx(x, y, z, ry = 0, s = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(s, s, s));
}
// a box whose local +z points radially outward at angle a (x = sin a · r, z = cos a · r)
function radialBox(a, r, y0, y1, w, d) {
  const g = new THREE.BoxGeometry(w, y1 - y0, d);
  g.applyMatrix4(mtx(Math.sin(a) * r, (y0 + y1) / 2, Math.cos(a) * r, a));
  return g;
}
function cylBetween(a, b, r0, r1, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, true);
  g.translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q).setPosition(a));
  return g;
}

// Sweep an (r, y) profile around the y axis from angle a0 to a1. Points are [r, y, smooth, dispAmp].
// Traversing the profile "from the axis side upward / outward" makes the faces point toward the axis
// (arena walls); reverse it for outward-facing solids (columns). Hard corners get their own vertex rows.
function sweep(prof, a0, a1, segs, uvS, o = {}) {
  const cx = o.cx || 0, cz = o.cz || 0, y0 = o.y || 0, disp = o.disp || null;
  const n = prof.length, pos = [], uv = [], idx = [], L = [0];
  for (let k = 1; k < n; k++) L[k] = L[k - 1] + Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]);
  const span = a1 - a0, forward = span > 0;
  const addRow = k => {
    const r = prof[k][0], y = prof[k][1], amp = prof[k][3] || 0, base = pos.length / 3;
    const tiles = Math.max(1, Math.round(Math.abs(span) * Math.max(r, 0.3) / uvS));
    for (let i = 0; i <= segs; i++) {
      const f = i / segs, a = a0 + span * f;
      const rr = Math.max(0, r + (disp && amp ? disp(a, y, amp) : 0));
      pos.push(cx + Math.sin(a) * rr, y0 + y, cz + Math.cos(a) * rr);
      if (o.swapUV) uv.push(L[k] / uvS, f * tiles); else uv.push(f * tiles, L[k] / uvS);
    }
    return base;
  };
  const link = (A0, B0) => {
    for (let i = 0; i < segs; i++) {
      const a = A0 + i, b = a + 1, d = B0 + i, c = d + 1;
      if (forward) idx.push(a, d, b, b, d, c); else idx.push(a, b, d, b, c, d);
    }
  };
  let prev = addRow(0);
  for (let k = 1; k < n; k++) {
    const row = addRow(k);
    link(prev, row);
    prev = (k < n - 1 && !prof[k][2]) ? addRow(k) : row;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function bowlGeo(x, y0, z, s) {
  return sweep(BOWL.map(([r, y, sm]) => [r * s, y * s, sm]), 0, TAU, 20, 0.8, { cx: x, cz: z, y: y0 });
}
// world-space planar UVs: horizontal faces use xz, vertical faces use (tangent, y)
function planarUV(g, s) {
  const p = g.attributes.position, nr = g.attributes.normal, n = p.count, uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), nx = nr.getX(i), ny = nr.getY(i), nz = nr.getZ(i);
    const h = Math.hypot(nx, nz);
    if (Math.abs(ny) > h) { uv[i * 2] = x / s; uv[i * 2 + 1] = z / s; }
    else { uv[i * 2] = (x * -nz + z * nx) / (h || 1) / s; uv[i * 2 + 1] = y / s; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
// normalise a geometry for merging: position/normal/uv/color, indexed; colour = tint × grime × variation
function prep(g, o = {}) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  g.morphAttributes = {};
  if (!g.attributes.normal) g.computeVertexNormals();
  if (o.planar) planarUV(g, o.planar);
  const p = g.attributes.position, n = p.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.index) { const a = new (n > 65535 ? Uint32Array : Uint16Array)(n); for (let i = 0; i < n; i++) a[i] = i; g.setIndex(new THREE.BufferAttribute(a, 1)); }
  const t = o.tint || WHITE, col = new Float32Array(n * 3), vary = o.vary !== false;
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let k = 1;
    if (o.grime) k *= 0.6 + 0.4 * smooth(-0.3, 2.8, y);
    if (vary) k *= 0.8 + 0.36 * noise3(x * 0.07 + 5.1, y * 0.09, z * 0.07);
    col[i * 3] = t.r * k; col[i * 3 + 1] = t.g * k; col[i * 3 + 2] = t.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
class Bucket {
  constructor() { this.parts = []; }
  add(g, o = {}) { this.parts.push(prep(g, o)); return this; }
  build() {
    if (!this.parts.length) return null;
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!g) { console.warn('[arena] geometry merge failed'); return null; }
    g.computeBoundingSphere();
    return g;
  }
}

// ------------------------------------------------------------------ procedural canvas textures
function makeCanvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function blob(g, x, y, s, rgb, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, s);
  gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(x - s, y - s, s * 2, s * 2);
}
// a chiselled groove: faint light lip, dark groove, optional ember glow in the emissive canvas
function engrave(g, ge, path, w, glow, gw) {
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  g.translate(w * 0.4, w * 0.4); path(g); g.strokeStyle = 'rgba(170,150,125,0.16)'; g.lineWidth = w; g.stroke();
  g.restore();
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  path(g); g.strokeStyle = 'rgba(12,9,7,0.82)'; g.lineWidth = w; g.stroke();
  g.restore();
  if (glow && gw > 0) { ge.save(); ge.lineCap = 'round'; ge.lineJoin = 'round'; path(ge); ge.strokeStyle = glow; ge.lineWidth = gw; ge.stroke(); ge.restore(); }
}
function drawSigil(g, ge, cx, cy, R, o) {
  const glow = o.glow;
  const circ = rad => c => { c.beginPath(); c.arc(cx, cy, rad, 0, TAU); };
  engrave(g, ge, circ(R * 0.985), R * 0.024, glow, R * 0.007);
  engrave(g, ge, circ(R * 0.925), R * 0.01, null, 0);
  engrave(g, ge, circ(R * 0.765), R * 0.01, null, 0);
  engrave(g, ge, circ(R * 0.72), R * 0.02, glow, R * 0.006);
  engrave(g, ge, c => {
    c.beginPath();
    for (let k = 0; k < o.ticks; k++) {
      const a = k / o.ticks * TAU;
      c.moveTo(cx + Math.cos(a) * R * 0.925, cy + Math.sin(a) * R * 0.925);
      c.lineTo(cx + Math.cos(a) * R * 0.96, cy + Math.sin(a) * R * 0.96);
    }
  }, R * 0.007, null, 0);
  const fs = Math.max(8, Math.round(R * 0.1));
  for (let k = 0; k < o.runes; k++) {
    const a = k / o.runes * TAU, ch = RUNES[(k * 7 + o.seed) % RUNES.length];
    const x = cx + Math.cos(a) * R * 0.845, y = cy + Math.sin(a) * R * 0.845;
    for (const [c, fill] of [[g, 'rgba(12,9,7,0.8)'], [ge, glow]]) {
      c.save(); c.translate(x, y); c.rotate(a + Math.PI / 2);
      c.font = `${fs}px ${RUNE_FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = fill; c.fillText(ch, 0, 0); c.restore();
    }
  }
  engrave(g, ge, c => {
    c.beginPath();
    for (let k = 0; k <= o.star; k++) {
      const a = ((k * o.step) % o.star) / o.star * TAU - Math.PI / 2;
      const x = cx + Math.cos(a) * R * 0.7, y = cy + Math.sin(a) * R * 0.7;
      if (k) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.closePath();
  }, R * 0.016, glow, R * 0.005);
  engrave(g, ge, circ(R * 0.34), R * 0.014, null, 0);
  engrave(g, ge, circ(R * 0.1), R * 0.02, glow, R * 0.008);
  engrave(g, ge, c => {
    c.beginPath();
    for (let k = 0; k < o.star; k++) {
      const a = k / o.star * TAU - Math.PI / 2;
      c.moveTo(cx + Math.cos(a) * R * 0.12, cy + Math.sin(a) * R * 0.12);
      c.lineTo(cx + Math.cos(a) * R * 0.34, cy + Math.sin(a) * R * 0.34);
    }
  }, R * 0.009, null, 0);
}
function erode(g, ge, x0, y0, W, n, r) {
  for (let k = 0; k < n; k++) {
    const x = x0 + W * (0.08 + r() * 0.84), y = y0 + W * (0.08 + r() * 0.84), s = W * (0.008 + r() * r() * 0.06), a = 0.3 + r() * 0.65;
    g.globalCompositeOperation = 'destination-out'; blob(g, x, y, s, '0,0,0', a);
    blob(ge, x, y, s, '0,0,0', a);
  }
  g.globalCompositeOperation = 'source-over';
}
function scorch(g, x, y, R, r) {
  const gr = g.createRadialGradient(x, y, 0, x, y, R);
  gr.addColorStop(0, 'rgba(10,8,6,0.78)'); gr.addColorStop(0.5, 'rgba(14,10,8,0.5)'); gr.addColorStop(1, 'rgba(14,10,8,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, TAU); g.fill();
  for (let k = 0; k < 40; k++) { const a = r() * TAU, d = R * (0.2 + r() * 0.55), s = R * (0.05 + r() * 0.15); blob(g, x + Math.cos(a) * d, y + Math.sin(a) * d, s, '12,9,7', 0.3 + r() * 0.3); }
  g.strokeStyle = 'rgba(8,6,5,0.3)'; g.lineCap = 'round';
  for (let k = 0; k < 26; k++) {
    const a = r() * TAU, l = R * (0.55 + r() * 0.35);
    g.lineWidth = R * (0.008 + r() * 0.02);
    g.beginPath(); g.moveTo(x + Math.cos(a) * R * 0.2, y + Math.sin(a) * R * 0.2); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
}
function blood(g, x, y, R, r) {
  for (let k = 0; k < 14; k++) blob(g, x + (r() - 0.5) * R * 0.6, y + (r() - 0.5) * R * 0.6, R * (0.15 + r() * 0.25), '58,8,6', 0.5 + r() * 0.3);
  g.fillStyle = 'rgba(48,7,5,0.55)';
  for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(x + (r() - 0.5) * R * 0.4, y + (r() - 0.5) * R * 0.4, R * (0.08 + r() * 0.14), 0, TAU); g.fill(); }
  g.fillStyle = 'rgba(52,7,5,0.75)';
  for (let k = 0; k < 40; k++) { const a = r() * TAU, d = R * (0.35 + r() * 0.55), s = R * (0.012 + r() * 0.035); g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, s, 0, TAU); g.fill(); }
}
function burnRing(g, x, y, R) {
  const gr = g.createRadialGradient(x, y, 0, x, y, R);
  gr.addColorStop(0, 'rgba(10,8,6,0.15)'); gr.addColorStop(0.55, 'rgba(10,8,6,0.72)'); gr.addColorStop(0.8, 'rgba(10,8,6,0.35)'); gr.addColorStop(1, 'rgba(10,8,6,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, TAU); g.fill();
}
function cracks(g, x, y, R, r) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let b = 0; b < 7; b++) {
    let a = r() * TAU, px = x + (r() - 0.5) * R * 0.2, py = y + (r() - 0.5) * R * 0.2;
    const pts = [[px, py]], steps = 6 + Math.floor(r() * 6);
    for (let k = 0; k < steps; k++) {
      a += (r() - 0.5) * 1.0; const l = R * (0.06 + r() * 0.08);
      px += Math.cos(a) * l; py += Math.sin(a) * l;
      if (Math.hypot(px - x, py - y) > R * 0.95) break;
      pts.push([px, py]);
    }
    for (const [col, off, w] of [['rgba(160,140,115,0.14)', R * 0.012, R * 0.022], ['rgba(10,8,6,0.8)', 0, R * 0.018]]) {
      g.beginPath(); pts.forEach(([u, v], i) => i ? g.lineTo(u + off, v + off) : g.moveTo(u + off, v + off));
      g.strokeStyle = col; g.lineWidth = w; g.stroke();
    }
  }
}
// 2×2 atlas: centre sigil | gold spawn sigil / crimson spawn sigil | 4 small decals
function paintDecalAtlas(S) {
  const c = makeCanvas(S), g = c.getContext('2d'), e = makeCanvas(S), ge = e.getContext('2d');
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  const C = S / 2, D = C / 2, r = rng(4242);
  drawSigil(g, ge, C * 0.5, C * 0.5, C * 0.47, { runes: 24, star: 8, step: 3, ticks: 72, seed: 3, glow: 'rgba(200,86,30,0.55)' });
  erode(g, ge, 0, 0, C, 280, r);
  drawSigil(g, ge, C * 1.5, C * 0.5, C * 0.47, { runes: 14, star: 7, step: 3, ticks: 42, seed: 11, glow: 'rgba(235,170,60,0.9)' });
  erode(g, ge, C, 0, C, 170, r);
  drawSigil(g, ge, C * 0.5, C * 1.5, C * 0.47, { runes: 14, star: 7, step: 3, ticks: 42, seed: 17, glow: 'rgba(220,40,26,0.9)' });
  erode(g, ge, 0, C, C, 170, r);
  scorch(g, C + D * 0.5, C + D * 0.5, D * 0.44, r);
  blood(g, C + D * 1.5, C + D * 0.5, D * 0.42, r);
  burnRing(g, C + D * 0.5, C + D * 1.5, D * 0.44);
  cracks(g, C + D * 1.5, C + D * 1.5, D * 0.45, r);
  return { map: canvasTex(c), emissive: canvasTex(e) };
}
// three ragged swallow-tailed banners: dark crimson, bone, tarnished gold
function paintBanners() {
  const W = 256, H = 640, c = makeCanvas(W * 3, H), g = c.getContext('2d'), r = rng(31);
  const D = [
    { base: [74, 14, 14], trim: '#b9ab8c', em: '#c8b994' },
    { base: [150, 140, 118], trim: '#4a1010', em: '#3c0c0c' },
    { base: [128, 92, 30], trim: '#2a1a08', em: '#24160a' },
  ];
  D.forEach((d, i) => {
    const ox = i * W;
    g.save();
    g.beginPath(); g.moveTo(ox + 6, 0); g.lineTo(ox + W - 6, 0); g.lineTo(ox + W - 6, H - 8); g.lineTo(ox + W / 2, H - 120); g.lineTo(ox + 6, H - 8); g.closePath();
    g.clip();
    g.fillStyle = `rgb(${d.base[0]},${d.base[1]},${d.base[2]})`; g.fillRect(ox, 0, W, H);
    for (let k = 0; k < 420; k++) { const s = r() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${s},${s},${s},${0.03 + r() * 0.06})`; g.fillRect(ox + r() * W, r() * H, 1 + r() * 2, 20 + r() * 200); }
    for (let x = 0; x < W; x += 2) { const f = Math.sin(x / W * Math.PI * 5 + i) * 0.5 + 0.5; g.fillStyle = `rgba(0,0,0,${(f * 0.18).toFixed(3)})`; g.fillRect(ox + x, 0, 2, H); }
    g.strokeStyle = d.trim; g.lineWidth = 7; g.strokeRect(ox + 20, 18, W - 40, H - 170);
    g.lineWidth = 2; g.strokeRect(ox + 30, 28, W - 60, H - 190);
    const cx = ox + W / 2, cy = 230;
    g.strokeStyle = d.em; g.fillStyle = d.em; g.lineWidth = 9;
    g.beginPath(); g.arc(cx, cy, 72, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(cx - 9, cy - 110); g.lineTo(cx + 9, cy - 110); g.lineTo(cx + 7, cy + 80); g.lineTo(cx, cy + 112); g.lineTo(cx - 7, cy + 80); g.closePath(); g.fill();
    g.fillRect(cx - 46, cy - 72, 92, 12);
    g.beginPath(); g.arc(cx, cy - 122, 12, 0, TAU); g.fill();
    g.font = `bold 46px ${RUNE_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(RUNES[i * 3] + ' ' + RUNES[i * 3 + 5] + ' ' + RUNES[i * 3 + 9], cx, 400);
    for (let k = 0; k < 8; k++) blob(g, ox + r() * W, r() * H, 20 + r() * 50, '20,14,10', 0.15 + r() * 0.2);
    let gr = g.createLinearGradient(0, H * 0.45, 0, H); gr.addColorStop(0, 'rgba(20,14,10,0)'); gr.addColorStop(1, 'rgba(20,14,10,0.6)');
    g.fillStyle = gr; g.fillRect(ox, 0, W, H);
    gr = g.createLinearGradient(0, 0, 0, 60); gr.addColorStop(0, 'rgba(10,8,6,0.5)'); gr.addColorStop(1, 'rgba(10,8,6,0)');
    g.fillStyle = gr; g.fillRect(ox, 0, W, 60);
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
    for (let k = 0; k < 26; k++) {
      const t = r(), left = r() < 0.5;
      const x = left ? lerp(ox + 6, ox + W / 2, t) : lerp(ox + W - 6, ox + W / 2, t), y = lerp(H - 8, H - 120, t);
      g.beginPath(); g.moveTo(x - 6 - r() * 8, y + 4); g.lineTo(x + 6 + r() * 8, y + 4); g.lineTo(x + (r() - 0.5) * 6, y - 10 - r() * 30); g.closePath(); g.fill();
    }
    for (let k = 0; k < 10; k++) { g.beginPath(); g.arc(ox + 20 + r() * (W - 40), H * 0.5 + r() * H * 0.3, 2 + r() * 6, 0, TAU); g.fill(); }
    g.globalCompositeOperation = 'source-over';
    g.restore();
  });
  return canvasTex(c);
}
// tileable value noise (for the ground mist)
function noiseTex(S = 128) {
  const d = new Uint8Array(S * S * 4);
  const layers = [[8, 0.55, 11], [16, 0.3, 12], [32, 0.15, 13]].map(([P, w, seed]) => { const r = rng(seed), a = new Float32Array(P * P); for (let i = 0; i < a.length; i++) a[i] = r(); return [P, w, a]; });
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0;
    for (const [P, w, L] of layers) {
      const fx = x / S * P, fy = y / S * P, x0 = Math.floor(fx), y0 = Math.floor(fy);
      let u = fx - x0, t = fy - y0; u = u * u * (3 - 2 * u); t = t * t * (3 - 2 * t);
      const x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
      v += w * lerp(lerp(L[y0 * P + x0], L[y0 * P + x1], u), lerp(L[y1 * P + x0], L[y1 * P + x1], u), t);
    }
    const o = (y * S + x) * 4, b = Math.round(v * 255);
    d[o] = d[o + 1] = d[o + 2] = b; d[o + 3] = 255;
  }
  const t = new THREE.DataTexture(d, S, S);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ shaders
const OUT_CHUNKS = `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;
const FLAME_VS = `attribute float aSeed; uniform float uTime; varying vec2 vUv; varying float vSeed;
void main(){
  vUv = uv; vSeed = aSeed;
  vec3 p = position; float k = uv.y * uv.y;
  p.x += sin(uTime * 3.1 + aSeed * 7.0) * 0.08 * k;
  p.z += cos(uTime * 2.7 + aSeed * 5.0) * 0.08 * k;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FLAME_FS = `uniform float uTime; uniform float uBoost; varying vec2 vUv; varying float vSeed;
float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h1(i), h1(i + vec2(1.0, 0.0)), f.x), mix(h1(i + vec2(0.0, 1.0)), h1(i + vec2(1.0, 1.0)), f.x), f.y); }
void main(){
  float t = uTime + vSeed * 13.0;
  vec2 uv = vUv;
  float n = n2(vec2(uv.x * 3.5 + vSeed, uv.y * 2.5 - t * 2.2)) * 0.65 + n2(vec2(uv.x * 7.0 - vSeed, uv.y * 5.0 - t * 3.6)) * 0.35;
  float x = (uv.x - 0.5) * 2.0 + (n - 0.5) * 0.5 * uv.y;
  float w = mix(0.95, 0.05, pow(uv.y, 0.8)) * (0.7 + 0.6 * n);
  float shape = 1.0 - smoothstep(w * 0.55, w, abs(x));
  shape *= smoothstep(0.0, 0.1, uv.y) * (1.0 - smoothstep(0.45, 0.95, uv.y + (n - 0.5) * 0.35));
  float core = shape * (1.0 - smoothstep(0.05, 0.55, uv.y + abs(x) * 0.9));
  vec3 col = mix(vec3(0.85, 0.16, 0.03), vec3(1.0, 0.5, 0.1), shape);
  col = mix(col, vec3(1.0, 0.86, 0.55), core);
  gl_FragColor = vec4(col * 1.6 * uBoost, shape * 0.9);
  ${OUT_CHUNKS}
}`;
// camera-facing soft halos (fire glow, lit windows); fade out with the scene fog
const GLOW_VS = `attribute vec2 aCorner; attribute vec4 aInfo; attribute vec3 aColor;
uniform float uTime; uniform float uBoost;
varying vec2 vC; varying vec3 vCol;
#include <fog_pars_vertex>
void main(){
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float fl = aInfo.z > 0.5 ? 1.0 : (0.82 + 0.12 * sin(uTime * 9.0 + aInfo.y * 7.0) + 0.06 * sin(uTime * 23.0 + aInfo.y * 3.0)) * uBoost;
  mvPosition.xy += aCorner * aInfo.x;
  mvPosition.z += aInfo.x * 0.6;
  vC = aCorner; vCol = aColor * fl;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const GLOW_FS = `varying vec2 vC; varying vec3 vCol;
#include <fog_pars_fragment>
void main(){
  float a = max(0.0, 1.0 - length(vC)); a = a * a * a;
  vec3 col = vCol * a;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogF = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    col *= 1.0 - fogF;
  #endif
  gl_FragColor = vec4(col, 1.0);
  ${OUT_CHUNKS}
}`;
const MOTE_VS = `attribute vec4 aMove; attribute vec3 aMisc; attribute vec3 aColor;
uniform float uTime; uniform float uScale;
varying vec3 vCol; varying float vA;
void main(){
  vec3 p = position;
  float vy = aMove.x, ph = aMisc.x, H = aMisc.y;
  float yy = mod(uTime * abs(vy) + ph * 7.0, H);
  if (vy < 0.0) yy = H - yy;
  p.y += yy;
  float fade = smoothstep(0.0, H * 0.15, yy) * (1.0 - smoothstep(H * 0.7, H, yy));
  fade *= 0.55 + 0.45 * sin(uTime * (1.5 + fract(ph) * 3.0) + ph * 11.0);
  p.x += sin(uTime * 0.7 + ph * 3.0) * aMove.y;
  p.z += cos(uTime * 0.6 + ph * 5.0) * aMove.y;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aMove.w * uScale / max(-mv.z, 0.5), 1.0, 64.0);
  vCol = aColor; vA = fade * aMisc.z;
}`;
const MOTE_FS = `varying vec3 vCol; varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = 1.0 - smoothstep(0.0, 0.5, d); a *= a;
  gl_FragColor = vec4(vCol, a * vA);
  ${OUT_CHUNKS}
}`;
const MIST_VS = `attribute vec3 aA; varying vec3 vA; varying vec3 vW;
void main(){ vA = aA; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const MIST_FS = `uniform sampler2D uNoise; uniform float uTime; uniform vec3 uColor; varying vec3 vA; varying vec3 vW;
void main(){
  vec2 p = vW.xz * vA.y;
  float n = texture2D(uNoise, p + vec2(uTime * 0.012, uTime * 0.005)).r * 0.6 + texture2D(uNoise, p * 2.3 - vec2(uTime * 0.008, uTime * 0.017)).r * 0.4;
  gl_FragColor = vec4(uColor * vA.z, smoothstep(0.38, 0.78, n) * vA.x);
  ${OUT_CHUNKS}
}`;
const MIST_ADD = new THREE.Color(0.05, 0.045, 0.05);

// ------------------------------------------------------------------ the arena
export class Arena {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = QUALITY[quality] ? quality : 'high';
    this.Q = QUALITY[this.quality];
    this.group = new THREE.Group(); this.group.name = 'arena'; scene.add(this.group);
    this.flames = [];        // contract: big fire positions {x,y,z}
    this.fires = []; this.glows = []; this.sparkSrc = []; this.lights = []; this.lightSpots = [];
    this.torchSpots = []; this.bannerList = []; this.chainM = []; this.place = {}; this._propFires = {};
    this.propMats = new Map();
    this.time = 0; this.crowdHype = 0;
    this.U = { time: { value: 0 }, hype: { value: 0 } };
    this._texCache = new Map(); this._texWait = [];
    this._tl = new THREE.TextureLoader();
    this.buildMaterials();
    this.B = { blocks: new Bucket(), far: new Bucket(), mossy: new Bucket(), iron: new Bucket(), wood: new Bucket(), rock: new Bucket() };
    this.buildFloor();
    this.buildDecals();
    this.buildPillars();
    this.buildWallAndStands();
    this.buildGates();
    this.buildBackdrop();
    this.buildBanners();
    this.buildCrowd();
    this.finalizeBuckets();
    this.buildChains();
    this.planProps();
    this.buildLights();
    this.rebuildFire();
    this.buildEmbers();
    if (this.Q.mist) this.buildMist();
    this.ready = this.loadAsync();
  }

  // ---------------------------------------------------------------- textures & materials
  tex(file, srgb = false) {
    let t = this._texCache.get(file);
    if (t) return t;
    let done = null;
    this._texWait.push(new Promise(res => { done = res; }));
    t = this._tl.load(TEX_DIR + file, () => done(), undefined, () => { console.warn('[arena] texture failed to load:', file); done(); });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    this._texCache.set(file, t);
    return t;
  }
  pbr(name, o = {}) {
    const arm = this.tex(name + '_arm.jpg');
    const m = new THREE.MeshStandardMaterial({
      map: this.tex(name + '_Diffuse.jpg', true), normalMap: this.tex(name + '_nor_gl.jpg'),
      aoMap: arm, roughnessMap: arm, roughness: 1, metalness: o.metal ? 1 : 0,
      color: o.color ?? 0xffffff, vertexColors: true,
    });
    if (o.metal) m.metalnessMap = arm;
    const ns = o.normalScale ?? 1; m.normalScale.set(ns, ns);
    return m;
  }
  buildMaterials() {
    this.mats = {
      floor: this.pbr('monastery_stone_floor'),
      blocks: this.pbr('medieval_blocks_02', { color: 0xd8d2ca }),
      mossy: this.pbr('mossy_stone_wall', { color: 0xc8c4bc }),
      rock: this.pbr('rock_wall_08', { color: 0x8f8a84 }),
      wood: this.pbr('weathered_planks'),
      iron: this.pbr('rusty_metal_02', { metal: true, color: 0xb0a49a }),
    };
    this.dirtMap = this.tex('rocks_ground_02_Diffuse.jpg', true);
  }

  // ---------------------------------------------------------------- floor
  buildFloor() {
    const NR = 44, NA = 176, row = NA + 1, n = (NR + 1) * row;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3), dirt = new Float32Array(n);
    let v = 0;
    for (let j = 0; j <= NR; j++) {
      const r = FLOOR_R * Math.pow(j / NR, 0.75);
      for (let i = 0; i <= NA; i++, v++) {
        const a = i / NA * TAU, x = Math.sin(a) * r, z = Math.cos(a) * r;
        pos[v * 3] = x; pos[v * 3 + 2] = z; nor[v * 3 + 1] = 1;
        uv[v * 2] = x / 4; uv[v * 2 + 1] = -z / 4;
        const n1 = fbm3(x * 0.11, 0.5, z * 0.11, 3), n2 = noise3(x * 0.4 + 7, 1.3, z * 0.4);
        const edge = smooth(23.5, 30.0, r);
        let d = edge * (0.55 + 0.6 * n1) + smooth(0.6, 0.78, n1) * 0.45 + (n2 - 0.5) * 0.25 * edge;
        for (const p of PILLARS) d += smooth(4.2, 2.0, Math.hypot(x - p.x, z - p.z)) * 0.5;
        d += smooth(3.5, 1.0, Math.abs(x)) * smooth(20, 27, Math.abs(z)) * 0.4;   // trampled path from each gate
        d *= 0.5 + 0.5 * smooth(5, 9, r);                                          // the centre sigil stays cleaner
        dirt[v] = Math.min(1, Math.max(0, d * 1.1 - 0.08));
        const c = (0.8 + 0.3 * fbm3(x * 0.05 + 3, 2.0, z * 0.05, 2)) * (1 - 0.34 * smooth(27.5, 31.5, r));
        col[v * 3] = c; col[v * 3 + 1] = c * 0.96; col[v * 3 + 2] = c * 0.92;
      }
    }
    const idx = [];
    for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aDirt', new THREE.BufferAttribute(dirt, 1));
    g.setIndex(idx);
    const m = this.mats.floor, dirtMap = this.dirtMap;
    m.onBeforeCompile = sh => {
      sh.uniforms.uDirt = { value: dirtMap };
      sh.vertexShader = 'attribute float aDirt;\nvarying float vDirt;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vDirt = aDirt;');
      sh.fragmentShader = 'uniform sampler2D uDirt;\nvarying float vDirt;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
  { vec3 dc = texture2D(uDirt, vMapUv * 0.85 + vec2(0.37, 0.11)).rgb * vec3(0.84, 0.77, 0.7);
    diffuseColor.rgb = mix(diffuseColor.rgb, dc, clamp(vDirt, 0.0, 1.0)); }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.97, clamp(vDirt, 0.0, 1.0));');
    };
    m.customProgramCacheKey = () => 'arena-floor-dirt';
    const floor = new THREE.Mesh(g, m);
    floor.receiveShadow = true; floor.name = 'arenaFloor';
    this.group.add(floor);
    this.floor = floor;
  }

  // ---------------------------------------------------------------- sigils & decals (one draw)
  buildDecals() {
    const atlas = paintDecalAtlas(this.Q.decal);
    const quads = [
      { x: 0, z: 0, h: 6.9, rot: 0, cell: [0, 0, 0.5], y: 0.012 },
      { x: 0, z: -20, h: 4.9, rot: 0, cell: [0.5, 0, 0.5], y: 0.012 },           // Gold spawn
      { x: 0, z: 20, h: 4.9, rot: Math.PI, cell: [0, 0.5, 0.5], y: 0.012 },      // Crimson spawn
    ];
    const r = rng(808), cells = [[0.5, 0.5], [0.75, 0.5], [0.5, 0.75], [0.75, 0.75]];
    let n = 0, tries = 0;
    while (n < this.Q.decals && tries++ < 400) {
      const a = r() * TAU, rr = 6 + r() * 21, x = Math.sin(a) * rr, z = Math.cos(a) * rr;
      if (rr < 7.6 || Math.hypot(x, z - 20) < 5.6 || Math.hypot(x, z + 20) < 5.6) continue;
      if (PILLARS.some(p => Math.hypot(x - p.x, z - p.z) < 2.4)) continue;
      const c = cells[n % 4];
      quads.push({ x, z, h: 0.7 + r() * 1.0, rot: r() * TAU, cell: [c[0], c[1], 0.25], y: 0.016 + n * 0.0015 });
      n++;
    }
    const pos = [], uv = [], nor = [], idx = [];
    quads.forEach((q, i) => {
      const cs = Math.cos(q.rot), sn = Math.sin(q.rot), [u0, cy0, sz] = q.cell;
      for (const [sx, sz2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lx = sx * q.h, lz = sz2 * q.h;
        pos.push(q.x + lx * cs - lz * sn, q.y, q.z + lx * sn + lz * cs);
        nor.push(0, 1, 0);
        uv.push(u0 + (sx + 1) / 2 * sz, 1 - cy0 - sz + (sz2 + 1) / 2 * sz);
      }
      const b = i * 4; idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.decalMat = new THREE.MeshStandardMaterial({
      map: atlas.map, emissiveMap: atlas.emissive, emissive: 0xffffff, emissiveIntensity: 0.9,
      roughness: 0.95, metalness: 0, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(g, this.decalMat);
    mesh.receiveShadow = true; mesh.renderOrder = 1;
    this.group.add(mesh);
  }

  // ---------------------------------------------------------------- fire bookkeeping
  addFire(x, y, z, s, o = {}) {
    const f = { x, y, z, s, halo: o.halo ?? (0.7 + s * 2.4), hk: o.hk ?? 0.2, rate: o.rate ?? 0 };
    this.fires.push(f);
    if (o.big) this.flames.push({ x, y: y + s * 0.9, z });
    if (f.rate) this.sparkSrc.push(f);
    return f;
  }

  // ---------------------------------------------------------------- pillars (LoS blockers, r = 2.0)
  buildPillars() {
    const B = this.B;
    const shaftR = y => 1.70 - (y - 1.1) / (8.75 - 1.1) * 0.15;
    const prof = [[2.06, -0.1, 0, 0.25], [2.06, 0.34, 0, 0.25], [1.97, 0.43], [1.93, 0.43], [1.93, 0.8, 0, 0.2], [1.86, 0.86],
      [1.8, 0.86], [1.87, 0.93, 1], [1.86, 1.01, 1], [1.76, 1.07], [shaftR(1.1), 1.1, 0, 0.6]];
    let y = 1.1;
    for (const j of [2.37, 3.64, 4.91, 6.18, 7.45, 8.75]) {
      for (const t of [0.33, 0.66]) { const yy = y + (j - y) * t; prof.push([shaftR(yy), yy, 1, 1]); }
      if (j < 8.75) prof.push([shaftR(j), j - 0.035, 0, 1], [shaftR(j) - 0.045, j, 0, 0.5], [shaftR(j), j + 0.035, 0, 1]);
      else prof.push([shaftR(j), j, 0, 0.6]);
      y = j;
    }
    prof.push([1.6, 8.78], [1.6, 8.95], [1.56, 8.98], [1.6, 9.02], [1.76, 9.14, 1], [1.96, 9.26, 1], [2.16, 9.34, 1], [2.27, 9.42], [0, 9.42]);
    prof.reverse();
    PILLARS.forEach((p, i) => {
      const seed = i * 7.3 + 1.1;
      const disp = (a, yy, amp) => amp * ((fbm3(Math.cos(a) * 1.7 + seed, yy * 0.8, Math.sin(a) * 1.7, 3) - 0.5) * 0.13
        - smooth(0.62, 0.78, noise3(Math.cos(a) * 4.5, yy * 2.2 + seed, Math.sin(a) * 4.5)) * 0.07);
      B.mossy.add(sweep(prof, 0, TAU, 44, 2.4, { cx: p.x, cz: p.z, disp }), STONE);
      const pa = Math.atan2(p.x, p.z);
      B.mossy.add(new THREE.BoxGeometry(4.7, 0.42, 4.7).applyMatrix4(mtx(p.x, 9.63, p.z, pa)), { ...STONE, planar: 2.4 });
      B.mossy.add(new THREE.BoxGeometry(4.4, 0.14, 4.4).applyMatrix4(mtx(p.x, 9.91, p.z, pa)), { ...STONE, planar: 2.4 });
      for (const by of [3.0, 5.55]) {
        const rs = shaftR(by);
        B.iron.add(sweep([[rs - 0.03, by + 0.2], [rs + 0.075, by + 0.2], [rs + 0.075, by], [rs - 0.03, by]], 0, TAU, 44, 1.5, { cx: p.x, cz: p.z }), IRON);
      }
      B.iron.add(bowlGeo(p.x, 9.98, p.z, 1.15), IRON);
      this.addFire(p.x, 9.98 + 0.72 * 1.15, p.z, 1.05, { big: true, rate: 2.6, halo: 3.4, hk: 0.24 });
      this.lightSpots.push({ x: p.x * 0.95, y: 11.6, z: p.z * 0.95, base: 150, dist: 42 });
      // hanging chains on the flanks, ending in shackles
      for (const da of [Math.PI / 2, -Math.PI / 2]) {
        const ca = pa + da, cx = p.x + Math.sin(ca) * 1.98, cz = p.z + Math.cos(ca) * 1.98;
        let n = 0;
        for (let yy = 9.2; yy > 4.3; yy -= 0.125, n++) this.chainM.push(mtx(cx, yy, cz, ca + (n % 2) * Math.PI / 2, 1));
        this.chainM.push(mtx(cx, 4.12, cz, ca, 2.0));
      }
    });
  }
  buildChains() {
    if (!this.chainM.length) return;
    const g = prep(new THREE.TorusGeometry(0.05, 0.014, 4, 10).scale(1, 1.5, 1), { tint: new THREE.Color(0.5, 0.46, 0.42), vary: false });
    const im = new THREE.InstancedMesh(g, this.mats.iron, this.chainM.length);
    this.chainM.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.receiveShadow = true;
    this.group.add(im);
    this.chainM = null;
  }

  // ---------------------------------------------------------------- podium wall, stands, back wall
  buildWallAndStands() {
    const B = this.B, Q = this.Q, r = rng(31337), W = WALL_R;
    const prof = [
      [W - 0.38, -0.2], [W - 0.38, 0.62], [W - 0.3, 0.7], [W, 0.7],                    // plinth course
      [W, 4.0], [W - 0.22, 4.0], [W - 0.22, 4.26], [W - 0.06, 4.36],                   // face, string course
      [W - 0.06, 5.35], [W - 0.16, 5.35], [W - 0.16, 5.62], [W + 0.62, 5.62],          // parapet & coping
      [W + 0.62, TIER0_Y], [TIER0_R, TIER0_Y],                                         // walkway
    ];
    for (let k = 0; k < TIERS; k++) { const rr = TIER0_R + k * TIER_D, yy = TIER0_Y + (k + 1) * TIER_H; prof.push([rr, yy], [rr + TIER_D, yy]); }
    prof.push([BACK_R, PROM_Y], [BACK_R, 13.3], [BACK_R - 0.18, 13.3], [BACK_R - 0.18, 13.6], [BACK_R, 13.6], [BACK_R, BACK_Y], [BACK_R + BACK_T, BACK_Y], [BACK_R + BACK_T, 2.0]);
    for (const [a0, a1] of [[GATE_G, Math.PI - GATE_G], [Math.PI + GATE_G, TAU - GATE_G]]) {
      B.blocks.add(sweep(prof, a0, a1, 120, 3.0), STONE);
      for (let k = 0; k < TIERS; k++) {   // wooden bench boards on every tread
        const r0 = TIER0_R + k * TIER_D, ty = TIER0_Y + (k + 1) * TIER_H;
        B.wood.add(sweep([[r0 + 0.08, ty - 0.01], [r0 + 0.08, ty + 0.065], [r0 + 0.64, ty + 0.065], [r0 + 0.64, ty - 0.01]], a0, a1, 120, 2.0, { swapUV: true }), WOOD);
      }
    }
    // pilasters on the podium wall (torches on every other one) and on the back wall
    for (let k = 0; k < 40; k++) {
      const a = k * BAY;
      if (inSector(a, 0.05)) {
        B.blocks.add(radialBox(a, W - 0.36, -0.2, 0.95, 1.3, 0.74), { ...STONE, planar: 3 });
        B.blocks.add(radialBox(a, W - 0.24, 0.95, 4.0, 1.0, 0.5), { ...STONE, planar: 3 });
        B.blocks.add(radialBox(a, W - 0.3, 4.0, 4.3, 1.25, 0.62), { ...STONE, planar: 3 });
        if (k % 2) { const tr = W - 0.5; this.torchSpots.push({ x: Math.sin(a) * tr, y: 2.85, z: Math.cos(a) * tr, ry: a + Math.PI }); }
      }
      if (inSector(a, 0.03)) B.blocks.add(radialBox(a, BACK_R - 0.2, PROM_Y - 0.05, 13.3, 1.15, 0.42), { ...STONE, planar: 3 });
    }
    // banners in the back-wall bays
    for (let k = 0; k < 40; k++) {
      const a = (k + 0.5) * BAY;
      if (!inSector(a, 0.06) || (!Q.extra && k % 2)) continue;
      const br = BACK_R - 0.12;
      this.bannerList.push({ x: Math.sin(a) * br, z: Math.cos(a) * br, y: 13.05, nx: -Math.sin(a), nz: -Math.cos(a), w: 2.0, h: 4.4, d: k % 2 });
    }
    // fire baskets and merlons along the top of the back wall
    const mr = BACK_R + BACK_T * 0.5, step = 2.1 / mr, basketA = [];
    for (let k = 2; k < 40; k += 5) { const a = k * BAY; if (inSector(a, 0.05)) basketA.push(a); }
    for (let a = step * 0.5; a < TAU; a += step) {
      if (!inSector(a, 0.012) || basketA.some(b => Math.abs(a - b) < 1.1 / mr)) continue;
      B.blocks.add(radialBox(a, mr, BACK_Y, BACK_Y + 1.1, 0.95, BACK_T), { ...STONE, planar: 3 });
    }
    for (const a of basketA) {
      const x = Math.sin(a) * mr, z = Math.cos(a) * mr;
      B.iron.add(new THREE.CylinderGeometry(0.05, 0.08, 0.72, 6).translate(x, BACK_Y + 0.36, z), IRON);
      B.iron.add(bowlGeo(x, BACK_Y + 0.68, z, 0.5), IRON);
      this.addFire(x, BACK_Y + 0.68 + 0.35, z, 0.55, { rate: 0.8, halo: 2.2, hk: 0.2 });
    }
    // ivy hanging from the coping
    const vines = ['Prop_Vine1', 'Prop_Vine2', 'Prop_Vine4'];
    let nv = 0;
    for (let k = 0; k < 40 && nv < Q.vines; k++) {
      const a = (k + 0.5) * BAY + (r() - 0.5) * 0.04;
      if (!inSector(a, 0.1) || r() > 0.42) continue;
      const name = vines[nv % 3];
      (this.place[name] || (this.place[name] = [])).push(mtx(Math.sin(a) * (W - 0.07), 5.45, Math.cos(a) * (W - 0.07), a + Math.PI, 0.9 + r() * 0.45));
      nv++;
    }
  }

  // ---------------------------------------------------------------- gatehouses (built at +z, rotated for -z)
  buildGates() {
    const B = this.B;
    for (const [ga, design] of [[0, 0], [Math.PI, 2]]) {     // +z Crimson, -z Gold
      const base = new THREE.Matrix4().makeRotationY(ga);
      const put = (g, bucket, o) => { g.applyMatrix4(base); bucket.add(g, o); };
      const box = (x0, x1, y0, y1, z0, z1, bucket = B.blocks, o = { ...STONE, planar: 3 }) =>
        put(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), bucket, o);
      const P = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(base);
      const Dir = (x, z) => new THREE.Vector3(x, 0, z).applyMatrix4(base);
      for (const sx of [-1, 1]) {
        const X = (a, b) => (sx < 0 ? [-b, -a] : [a, b]);
        box(...X(2.2, 6.2), -0.2, 17.0, 29.9, 42.6);                 // flanking tower
        box(...X(2.2, 6.5), -0.2, 0.9, 29.6, 33.5);                  // plinth
        box(...X(2.2, 6.4), 4.0, 4.3, 29.72, 33.5);                  // string course
        box(...X(1.9, 6.5), 16.4, 17.0, 29.6, 42.9);                 // corbel band
        for (const x of [2.6, 3.8, 5.0, 6.1]) box(...X(x - 0.35, x + 0.35), 17.0, 18.2, 29.6, 30.3);
        for (let z = 31.4; z < 42.4; z += 1.5) box(...X(5.8, 6.5), 17.0, 18.2, z, z + 0.8);
        // gate brazier on an iron tripod
        const lx = sx * 4.2, lz = 29.25, top = 2.05, s = 0.62;
        put(new THREE.CylinderGeometry(0.06, 0.08, top, 8).translate(lx, top / 2, lz), B.iron, IRON);
        for (let k = 0; k < 3; k++) {
          const a = k * TAU / 3 + 0.3;
          put(cylBetween(new THREE.Vector3(lx + Math.cos(a) * 0.5, 0, lz + Math.sin(a) * 0.5), new THREE.Vector3(lx, 0.8, lz), 0.035, 0.03, 5), B.iron, IRON);
        }
        put(bowlGeo(lx, top - 0.02, lz, s), B.iron, IRON);
        const fp = P(lx, top - 0.02 + 0.72 * s, lz);
        this.addFire(fp.x, fp.y, fp.z, 0.62, { big: true, rate: 2.2, halo: 2.4, hk: 0.24 });
        // team banner on the tower front
        const bp = P(sx * 4.2, 0, 29.84), bn = Dir(0, -1);
        this.bannerList.push({ x: bp.x, z: bp.z, y: 11.1, nx: bn.x, nz: bn.z, w: 2.0, h: 4.6, d: design });
        // torch inside the tunnel (visible through the portcullis)
        const tp = P(sx * -2.2, 2.5, 36.5);
        this.torchSpots.push({ x: tp.x, y: tp.y, z: tp.z, ry: ga + (sx < 0 ? -Math.PI / 2 : Math.PI / 2) });
      }
      // between the towers: vault mass, wall above the arch, arch with voussoirs and keystone
      box(-2.2, 2.2, 6.2, 15.6, 31.4, 42.6);
      box(-2.2, 2.2, 11.7, 15.6, 29.9, 31.4);
      box(-2.2, 2.2, 11.4, 11.7, 29.7, 31.4);
      for (const x of [-1.65, -0.55, 0.55, 1.65]) box(x - 0.3, x + 0.3, 15.6, 16.6, 29.9, 30.5);
      const sp = new THREE.Shape();
      sp.moveTo(-2.2, 4.0); sp.lineTo(-2.2, 11.4); sp.lineTo(2.2, 11.4); sp.lineTo(2.2, 4.0);
      sp.absarc(0, 4.0, 2.2, 0, Math.PI, false);
      put(new THREE.ExtrudeGeometry(sp, { depth: 1.5, bevelEnabled: false, curveSegments: 18 }).translate(0, 0, 29.9), B.blocks, { ...STONE, planar: 3 });
      const vs = new THREE.Shape();
      vs.absarc(0, 4.0, 2.75, 0, Math.PI, false); vs.lineTo(-2.2, 4.0);
      vs.absarc(0, 4.0, 2.2, Math.PI, 0, true); vs.lineTo(2.75, 4.0);
      put(new THREE.ExtrudeGeometry(vs, { depth: 0.18, bevelEnabled: false, curveSegments: 18 }).translate(0, 0, 29.72), B.mossy, { ...STONE, planar: 2.4 });
      box(-0.3, 0.3, 6.05, 6.95, 29.6, 29.9, B.mossy, { ...STONE, planar: 2.4 });
      // tunnel floor, end wall, barred wooden door
      box(-2.2, 2.2, -0.25, -0.005, 32.3, 42.6);
      box(-2.2, 2.2, 0, 6.2, 42.2, 42.6);
      box(-1.4, 1.4, 0, 3.6, 42.05, 42.2, B.wood, { ...WOOD, planar: 2 });
      for (const y of [0.6, 2.6]) box(-1.45, 1.45, y, y + 0.15, 42.0, 42.05, B.iron, { ...IRON, planar: 1.5 });
      // portcullis, slightly raised
      for (let i = 0; i <= 10; i++) {
        const x = -2.0 + i * 0.4;
        box(x - 0.043, x + 0.043, 0.75, 6.6, 31.555, 31.645, B.iron, { ...IRON, planar: 1.5 });
        put(new THREE.ConeGeometry(0.05, 0.28, 5).rotateX(Math.PI).translate(x, 0.61, 31.6), B.iron, IRON);
      }
      for (const y of [1.4, 2.5, 3.6, 4.7, 5.8]) box(-2.25, 2.25, y - 0.035, y + 0.035, 31.5, 31.57, B.iron, { ...IRON, planar: 1.5 });
      const lp = P(0, 3.6, 27.0);
      this.lightSpots.push({ x: lp.x, y: lp.y, z: lp.z, base: 34, dist: 22 });
      const gp = P(0, 2.2, 41.6);
      this.glows.push({ x: gp.x, y: gp.y, z: gp.z, size: 2.6, r: 0.14, g: 0.06, b: 0.02, seed: ga * 3 + 1, steady: 0 });
    }
  }

  // ---------------------------------------------------------------- beyond the walls
  rockRing(rows, NA, U) {
    const nr = rows.length, pos = [], uv = [], idx = [];
    for (let i = 0; i <= NA; i++) {
      const a = i / NA * TAU;
      let L = 0, px = 0, py = 0, pz = 0;
      for (let j = 0; j < nr; j++) {
        const [rr, y] = rows[j](a, j), x = Math.sin(a) * rr, z = Math.cos(a) * rr;
        if (j) L += Math.hypot(x - px, y - py, z - pz);
        pos.push(x, y, z); uv.push(i / NA * U, L / 14);
        px = x; py = y; pz = z;
      }
    }
    for (let i = 0; i < NA; i++) for (let j = 0; j < nr - 1; j++) {
      const a = i * nr + j, b = a + nr, d = a + 1, c = b + 1;
      idx.push(a, d, b, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  buildBackdrop() {
    const B = this.B, Q = this.Q, r = rng(2024);
    const h = a => { const f = fbm3(Math.cos(a) * 1.6 + 3, 0.5, Math.sin(a) * 1.6, 4); return 14 + 70 * f * f + 6 * noise3(Math.cos(a) * 9, 2, Math.sin(a) * 9); };
    const jag = (a, j) => (noise3(Math.cos(a) * 7 + j, j * 1.7, Math.sin(a) * 7) - 0.5) * 10;
    B.rock.add(this.rockRing([
      () => [BACK_R + 0.5, 1.0],
      (a, j) => [68 + jag(a, j) * 0.3, 2.5 + 3 * noise3(Math.cos(a) * 3, 0, Math.sin(a) * 3)],
      (a, j) => [92 + jag(a, j), 6 + 0.12 * h(a)],
      (a, j) => [97 + jag(a, j), 0.45 * h(a)],
      (a, j) => [101 + jag(a, j), 0.78 * h(a)],
      (a, j) => [106 + jag(a, j), h(a)],
      (a, j) => [116 + jag(a, j), 0.92 * h(a)],
      (a, j) => [138 + jag(a, j), 0.6 * h(a)],
      () => [175, 12],
    ], 180, Math.round(TAU * 100 / 14)), ROCK);
    const H = a => { const f = fbm3(Math.cos(a) * 1.2 + 11, 1.5, Math.sin(a) * 1.2, 4); return 60 + 110 * f * f; };
    B.rock.add(this.rockRing([
      () => [200, -5],
      (a, j) => [215 + jag(a, j) * 2, 0.4 * H(a)],
      (a, j) => [228 + jag(a, j) * 2, 0.8 * H(a)],
      (a, j) => [238 + jag(a, j) * 2, H(a)],
      (a, j) => [260 + jag(a, j) * 2, 0.7 * H(a)],
      () => [300, 20],
    ], 120, Math.round(TAU * 230 / 14)), ROCK);
    // dark fortress towers with conical slate roofs and a few lit windows
    const TW = [[0.55, 58, 3.2, 34], [2.7, 80, 4.6, 50], [4.3, 76, 3.8, 42], [1.2, 72, 4.2, 44], [5.75, 84, 5.0, 54], [2.05, 64, 3.0, 30], [3.6, 60, 3.4, 36], [5.05, 66, 3.1, 32]];
    const roofs = this.place.Roof_Tower_RoundTiles = [];
    for (const [a, d, R, Ht] of TW.slice(0, Q.towers)) {
      const cx = Math.sin(a) * d, cz = Math.cos(a) * d;
      const prof = [[R + 0.7, -4], [R + 0.7, 1.2], [R, 1.9], [R, Ht - 3.4], [R + 0.5, Ht - 2.8], [R + 0.5, Ht], [0, Ht]].reverse();
      B.far.add(sweep(prof, 0, TAU, 22, 3.0, { cx, cz }), {});
      roofs.push(mtx(cx, Ht - 0.05, cz, r() * TAU, (R + 0.55) / 2.62));
      const toC = Math.atan2(-cx, -cz);
      for (let w = 0; w < 3; w++) {
        const wa = toC + (r() - 0.5) * 1.2, wy = Ht * (0.35 + r() * 0.45), k = 0.5 + r() * 0.5;
        this.glows.push({ x: cx + Math.sin(wa) * (R + 0.08), y: wy, z: cz + Math.cos(wa) * (R + 0.08), size: 0.5, r: 0.9 * k, g: 0.42 * k, b: 0.14 * k, seed: w, steady: 1 });
      }
    }
    // keeps: blocky halls with battlements
    const KP = [[0.9, 92, 26], [3.3, 96, 30], [4.75, 90, 24]];
    for (const [a, d, Ht] of KP.slice(0, Q.keeps)) {
      const cx = Math.sin(a) * d, cz = Math.cos(a) * d, wd = 14, dp = 12;
      const M = mtx(cx, 0, cz, a);
      B.far.add(new THREE.BoxGeometry(wd, Ht + 4, dp).translate(0, Ht / 2 - 2, 0).applyMatrix4(M), { planar: 3 });
      for (let i = 0; i < 7; i++) {
        const x = -wd / 2 + 1 + i * (wd - 2) / 6;
        for (const z of [-dp / 2 + 0.4, dp / 2 - 0.4]) B.far.add(new THREE.BoxGeometry(0.9, 1.3, 0.8).translate(x, Ht + 0.65, z).applyMatrix4(M), { planar: 3 });
      }
      for (let w = 0; w < 4; w++) {
        const p = new THREE.Vector3(-wd / 2 + 2 + r() * (wd - 4), Ht * (0.3 + r() * 0.55), -dp / 2 - 0.08).applyMatrix4(M), k = 0.5 + r() * 0.5;
        this.glows.push({ x: p.x, y: p.y, z: p.z, size: 0.55, r: 0.9 * k, g: 0.4 * k, b: 0.13 * k, seed: w + 3, steady: 1 });
      }
    }
  }

  // ---------------------------------------------------------------- banners (one draw, vertex-shader wave)
  buildBanners() {
    const list = this.bannerList;
    if (!list.length) return;
    const SX = 3, SY = 12, pos = [], nor = [], uv = [], wave = [], idx = [];
    list.forEach((b, bi) => {
      const tx = b.nz, tz = -b.nx, base = pos.length / 3;
      for (let j = 0; j <= SY; j++) for (let i = 0; i <= SX; i++) {
        const u = i / SX, v = j / SY;
        pos.push(b.x + tx * (u - 0.5) * b.w + b.nx * 0.03, b.y - v * b.h, b.z + tz * (u - 0.5) * b.w + b.nz * 0.03);
        nor.push(b.nx, 0, b.nz);
        uv.push((b.d + u) / 3, 1 - v);
        wave.push(Math.pow(v, 1.2), bi * 1.37 + u * 0.6);
      }
      for (let j = 0; j < SY; j++) for (let i = 0; i < SX; i++) {
        const a = base + j * (SX + 1) + i, bb = a + 1, d = a + SX + 1, c = d + 1;
        idx.push(a, d, bb, bb, d, c);
      }
      // iron hanging rod
      const rod = new THREE.CylinderGeometry(0.035, 0.035, b.w + 0.3, 6).rotateZ(Math.PI / 2).rotateY(Math.atan2(b.nx, b.nz))
        .translate(b.x + b.nx * 0.06, b.y + 0.04, b.z + b.nz * 0.06);
      this.B.iron.add(rod, IRON);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aWave', new THREE.Float32BufferAttribute(wave, 2));
    g.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ map: paintBanners(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
    const U = this.U;
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = U.time;
      sh.vertexShader = 'uniform float uTime;\nattribute vec2 aWave;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  float bwv = sin(uTime * 1.6 + aWave.y + position.y * 0.9) * 0.16 + sin(uTime * 2.7 + aWave.y * 1.7 + position.y * 2.1) * 0.05;
  transformed += normal * bwv * aWave.x;`);
    };
    mat.customProgramCacheKey = () => 'arena-banner-wave';
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  // ---------------------------------------------------------------- crowd: sparse dark silhouettes
  buildCrowd() {
    const N = this.Q.crowd;
    if (!N) return;
    const body = new THREE.CapsuleGeometry(0.2, 0.4, 2, 7); body.translate(0, 0.42, 0); body.scale(1.15, 1, 0.9);
    const head = new THREE.SphereGeometry(0.125, 7, 5); head.translate(0, 0.96, 0);
    const geo = mergeGeometries([body, head], false);
    if (!geo) return;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    const U = this.U;
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = U.time; sh.uniforms.uHype = U.hype;
      sh.vertexShader = 'uniform float uTime;\nuniform float uHype;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  float cid = float(gl_InstanceID);
  float cph = fract(sin(cid * 12.9898) * 43758.5453) * 6.2831;
  float cb = max(0.0, sin(uTime * (5.0 + fract(cph) * 4.0) + cph));
  transformed.y += cb * cb * (0.03 + uHype * 0.3);
  transformed.x += sin(uTime * 0.7 + cph) * 0.02;`);
    };
    mat.customProgramCacheKey = () => 'arena-crowd-bob';
    const im = new THREE.InstancedMesh(geo, mat, N);
    const r = rng(99), c = new THREE.Color();
    let n = 0, tries = 0;
    while (n < N && tries++ < N * 40) {
      const k = Math.floor(r() * (TIERS + 1)), a = r() * TAU;
      if (!inSector(a, 0.03)) continue;
      if (noise3(Math.cos(a) * 5, k * 0.6, Math.sin(a) * 5) < 0.42) continue;
      let rr, y, sc, sy;
      if (k < TIERS) { rr = TIER0_R + k * TIER_D + 0.38 + (r() - 0.5) * 0.08; y = TIER0_Y + (k + 1) * TIER_H + 0.065; sc = 0.92 + r() * 0.16; sy = sc; }
      else { rr = PROM_R + 0.25 + r() * 0.35; y = PROM_Y; sc = 1.0 + r() * 0.1; sy = sc * 1.6; }
      const m = mtx(Math.sin(a) * rr, y, Math.cos(a) * rr, a + Math.PI + (r() - 0.5) * 0.5, 1, (r() - 0.5) * 0.12, (r() - 0.5) * 0.1);
      m.scale(_s.set(sc, sy, sc));
      im.setMatrixAt(n, m);
      c.setHSL(0.05 + r() * 0.06, 0.12 + r() * 0.2, 0.05 + r() * 0.09);
      im.setColorAt(n, c);
      n++;
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.receiveShadow = true;
    this.group.add(im);
  }

  // ---------------------------------------------------------------- merge everything static
  finalizeBuckets() {
    const B = this.B, m = this.mats;
    const add = (bucket, mat, cast, recv, name) => {
      const g = bucket.build();
      if (!g) return null;
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = cast; mesh.receiveShadow = recv; mesh.name = name;
      this.group.add(mesh);
      return mesh;
    };
    add(B.blocks, m.blocks, true, true, 'arenaWalls');
    add(B.mossy, m.mossy, true, true, 'arenaPillars');
    add(B.iron, m.iron, true, true, 'arenaIron');
    add(B.wood, m.wood, true, true, 'arenaWood');
    add(B.far, m.blocks, false, false, 'arenaFortress');
    add(B.rock, m.rock, false, false, 'arenaCliffs');
    this.B = null;
  }

  // ---------------------------------------------------------------- prop placement (instanced after load)
  planProps() {
    const P = this.place, Q = this.Q, r = rng(555);
    const add = (name, m) => { if (!Q.extra && !CORE_PROPS.has(name)) return m; (P[name] || (P[name] = [])).push(m); return m; };
    const pend = (name, pts, m, s, o = {}) => {
      const list = this._propFires[name] || (this._propFires[name] = []);
      for (const p of pts) { const w = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(m); list.push({ x: w.x, y: w.y, z: w.z, s, o }); }
    };
    for (const t of this.torchSpots) {
      const m = add('Torch_Metal', mtx(t.x, t.y, t.z, t.ry, 1.4));
      pend('Torch_Metal', [[0, 0.33, 0.28]], m, 0.3, { rate: 0.5, halo: 1.5, hk: 0.2 });
    }
    // clusters in the bays between pilasters (bay k centre = (k + 0.5) · BAY)
    const W = (k, off, rr, y = 0, rot = 0, s = 1, rx = 0, rz = 0) => {
      const a = (k + 0.5) * BAY + off / rr;
      return mtx(Math.sin(a) * rr, y, Math.cos(a) * rr, a + Math.PI + rot, s, rx, rz);
    };
    const candle = (k, off) => {
      const m = add('CandleStick_Stand', W(k, off, 30.6, 0, r() * TAU));
      if (Q.extra) pend('CandleStick_Stand', [[0, 1.3, 0.3], [0, 1.3, -0.3], [0.31, 1.3, 0], [-0.31, 1.3, 0], [0.215, 1.3, -0.215], [-0.215, 1.3, 0.215]], m, 0.07, { halo: 0.35, hk: 0.12 });
    };
    // beside the Crimson gate (+z)
    add('Barrel', W(1, -0.6, 30.55, 0, r() * TAU)); add('Barrel', W(1, 0.25, 30.7, 0, r() * TAU)); add('Crate_Wooden', W(1, 1.2, 30.5, 0, 0.3));
    add('Crate_Wooden', W(38, 0.4, 30.5, 0, -0.2)); add('Crate_Wooden', W(38, 0.4, 30.5, 0.86, 0.5)); add('Barrel', W(38, -0.7, 30.6, 0, r() * TAU));
    // beside the Gold gate (-z)
    add('Barrel', W(18, -0.8, 30.6, 0, r() * TAU)); add('Barrel', W(18, 0.0, 30.7, 0, r() * TAU)); add('Barrel', W(18, -0.4, 30.0, 0, r() * TAU));
    add('Chain_Coil', W(18, 1.0, 30.4, 0, r() * TAU));
    add('Crate_Metal', W(21, -0.6, 30.5, 0, 0.2)); add('Crate_Wooden', W(21, 0.5, 30.5, 0, -0.3)); add('Pot_1', W(21, 0.5, 30.5, 0.86, r() * TAU));
    // weapon racks on the flanks
    add('WeaponStand', W(9, 0, 30.45)); add('Shield_Wooden', W(9, 1.25, 30.85, 0.31, 0.2, 1, -0.25)); add('Sword_Bronze', W(9, -1.3, 30.4, 0.72, r(), 1, Math.PI + 0.12, 0.1));
    add('WeaponStand', W(30, 0, 30.45)); add('Shield_Wooden', W(30, -1.2, 30.85, 0.31, -0.2, 1, -0.25)); add('Axe_Bronze', W(30, 1.3, 30.9, 0.45, 0, 1, -0.3));
    // chests guarded by candles
    add('Chest_Wood', W(6, 0, 30.5)); candle(6, -1.25); candle(6, 1.25); add('Vase_Rubble_Medium', W(6, 1.9, 30.3, 0, r() * TAU));
    add('Chest_Wood', W(26, 0.2, 30.5, 0, 0.15)); candle(26, -1.1); add('Pot_1', W(26, 1.2, 30.5, 0, r() * TAU));
    // cauldrons, coils, dummies, rubble, abandoned blades
    add('Cauldron', W(13, -0.4, 30.4, 0, r() * TAU, 1.1)); add('Chain_Coil', W(13, 0.9, 30.4, 0, r() * TAU)); add('Barrel', W(13, 1.6, 30.6, 0, r() * TAU));
    add('Cauldron', W(33, 0.3, 30.4, 0, r() * TAU, 1.1)); add('Crate_Metal', W(33, -0.9, 30.5, 0, 0.4));
    add('Dummy', W(11, 0, 30.2, 0, 0.3)); add('Dummy', W(28, 0.3, 30.2, 0, -0.4));
    for (const k of [15, 24, 35]) {
      add('Vase_Rubble_Medium', W(k, 0, 30.3, 0, r() * TAU));
      for (let i = 0; i < 4; i++) add(i % 2 ? 'Prop_Brick2' : 'Prop_Brick1', W(k, (r() - 0.5) * 2.6, 30.0 + r() * 0.9, 0.09, r() * TAU, 0.9 + r() * 0.3));
    }
    for (const k of [3, 16, 23, 36]) add('Sword_Bronze', W(k, (r() - 0.5) * 1.5, 29.9, 0.72, r() * TAU, 1, Math.PI + (r() - 0.5) * 0.3, (r() - 0.5) * 0.3));
  }

  // ---------------------------------------------------------------- lights
  buildLights() {
    this.lightSpots.slice(0, this.Q.lights).forEach((s, i) => {
      const L = new THREE.PointLight(FIRE_HEX, s.base, s.dist, 2);
      L.position.set(s.x, s.y, s.z); L.castShadow = false;
      this.group.add(L);
      this.lights.push({ light: L, base: s.base, ph: i * 1.93 });
    });
  }

  // ---------------------------------------------------------------- flames + halos (rebuilt when torches arrive)
  rebuildFire() {
    const F = this.fires, N = F.length * 3;
    const pos = new Float32Array(N * 12), uv = new Float32Array(N * 8), seed = new Float32Array(N * 4), idx = [];
    let v = 0;
    F.forEach((f, i) => {
      const w = 1.3 * f.s, h = 2.3 * f.s;
      for (let k = 0; k < 3; k++) {
        const a = k * Math.PI / 3 + i * 0.7, cx = Math.cos(a) * w / 2, cz = Math.sin(a) * w / 2;
        for (const [sx, sy] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
          pos[v * 3] = f.x + cx * sx; pos[v * 3 + 1] = f.y + sy * h; pos[v * 3 + 2] = f.z + cz * sx;
          uv[v * 2] = (sx + 1) / 2; uv[v * 2 + 1] = sy; seed[v] = i * 1.37 + k * 0.31; v++;
        }
        const b = v - 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    });
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    fg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    fg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    fg.setIndex(idx);
    if (!this.flameMesh) {
      this.flameMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uBoost: { value: 1 } }, vertexShader: FLAME_VS, fragmentShader: FLAME_FS,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      });
      this.flameMesh = new THREE.Mesh(fg, this.flameMat);
      this.flameMesh.frustumCulled = false; this.flameMesh.renderOrder = 3;
      this.group.add(this.flameMesh);
    } else { this.flameMesh.geometry.dispose(); this.flameMesh.geometry = fg; }
    // halos
    const G = F.map((f, i) => ({ x: f.x, y: f.y + f.s * 0.8, z: f.z, size: f.halo, r: f.hk, g: f.hk * 0.42, b: f.hk * 0.12, seed: i, steady: 0 })).concat(this.glows);
    const M = G.length, gp = new Float32Array(M * 12), gc = new Float32Array(M * 8), gi = new Float32Array(M * 16), gcol = new Float32Array(M * 12), gidx = [];
    G.forEach((q, i) => {
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([cx, cy], k) => {
        const o = i * 4 + k;
        gp[o * 3] = q.x; gp[o * 3 + 1] = q.y; gp[o * 3 + 2] = q.z;
        gc[o * 2] = cx; gc[o * 2 + 1] = cy;
        gi[o * 4] = q.size; gi[o * 4 + 1] = q.seed; gi[o * 4 + 2] = q.steady; gi[o * 4 + 3] = 0;
        gcol[o * 3] = q.r; gcol[o * 3 + 1] = q.g; gcol[o * 3 + 2] = q.b;
      });
      const b = i * 4; gidx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
    gg.setAttribute('aCorner', new THREE.BufferAttribute(gc, 2));
    gg.setAttribute('aInfo', new THREE.BufferAttribute(gi, 4));
    gg.setAttribute('aColor', new THREE.BufferAttribute(gcol, 3));
    gg.setIndex(gidx);
    if (!this.glowMesh) {
      this.glowMat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uBoost: { value: 1 } }]),
        vertexShader: GLOW_VS, fragmentShader: GLOW_FS, fog: true,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      this.glowMesh = new THREE.Mesh(gg, this.glowMat);
      this.glowMesh.frustumCulled = false; this.glowMesh.renderOrder = 4;
      this.group.add(this.glowMesh);
    } else { this.glowMesh.geometry.dispose(); this.glowMesh.geometry = gg; }
  }

  // ---------------------------------------------------------------- embers & ash (GPU animated points)
  buildEmbers() {
    const N = this.Q.embers, r = rng(4711), big = this.fires.filter(f => f.s >= 0.5);
    const pos = new Float32Array(N * 3), mv = new Float32Array(N * 4), misc = new Float32Array(N * 3), col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const k = r();
      let d;
      if (k < 0.4 && big.length) {        // sparks rising off the braziers
        const f = big[Math.floor(r() * big.length)];
        d = [f.x + (r() - 0.5) * 0.8 * f.s, f.y + 0.4 * f.s, f.z + (r() - 0.5) * 0.8 * f.s, 0.9 + r() * 1.3, 0.35 + r() * 0.4, 0.05 + r() * 0.05, r() * 50, 5 + r() * 6, 1.0, 1.0, 0.42 + r() * 0.2, 0.1];
      } else if (k < 0.65) {              // stray embers drifting through the pit
        const a = r() * TAU, rr = Math.sqrt(r()) * 30;
        d = [Math.sin(a) * rr, 0, Math.cos(a) * rr, 0.2 + r() * 0.35, 0.9 + r() * 0.9, 0.04 + r() * 0.04, r() * 50, 12 + r() * 6, 0.55, 1.0, 0.5, 0.18];
      } else {                            // ash falling slowly
        const a = r() * TAU, rr = Math.sqrt(r()) * 42;
        d = [Math.sin(a) * rr, 0, Math.cos(a) * rr, -(0.35 + r() * 0.4), 1.4, 0.05 + r() * 0.05, r() * 50, 20, 0.22, 0.62, 0.56, 0.52];
      }
      pos[i * 3] = d[0]; pos[i * 3 + 1] = d[1]; pos[i * 3 + 2] = d[2];
      mv[i * 4] = d[3]; mv[i * 4 + 1] = d[4]; mv[i * 4 + 2] = 0; mv[i * 4 + 3] = d[5];
      misc[i * 3] = d[6]; misc[i * 3 + 1] = d[7]; misc[i * 3 + 2] = d[8];
      col[i * 3] = d[9]; col[i * 3 + 1] = d[10]; col[i * 3 + 2] = d[11];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aMove', new THREE.BufferAttribute(mv, 4));
    g.setAttribute('aMisc', new THREE.BufferAttribute(misc, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    this.emberMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 800 } }, vertexShader: MOTE_VS, fragmentShader: MOTE_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    const pts = new THREE.Points(g, this.emberMat);
    pts.frustumCulled = false; pts.renderOrder = 5;
    this.group.add(pts);
  }

  // ---------------------------------------------------------------- low ground mist (two noisy layers)
  buildMist() {
    const rings = [[10, FLOOR_R - 0.3, 0.22, 0.05, 1.0, 0.2], [14, FLOOR_R - 0.3, 0.62, 0.032, 0.85, 0.14]];
    const geos = rings.map(([ri, ro, y, sc, br, al]) => {
      const g = new THREE.RingGeometry(ri, ro, 128, 6);
      g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
      const p = g.attributes.position, A = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) {
        const rr = Math.hypot(p.getX(k), p.getZ(k));
        A[k * 3] = al * smooth(ri, ri + 9, rr); A[k * 3 + 1] = sc; A[k * 3 + 2] = br;
      }
      g.setAttribute('aA', new THREE.BufferAttribute(A, 3));
      return g;
    });
    const geo = mergeGeometries(geos, false);
    if (!geo) return;
    this.mistMat = new THREE.ShaderMaterial({
      uniforms: { uNoise: { value: noiseTex(128) }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0.13, 0.12, 0.13) } },
      vertexShader: MIST_VS, fragmentShader: MIST_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const mesh = new THREE.Mesh(geo, this.mistMat);
    mesh.frustumCulled = false; mesh.renderOrder = 2;
    this.group.add(mesh);
  }

  // ---------------------------------------------------------------- async: glTF props + textures
  propMat(m) {
    const key = `${m.name || m.uuid}|${m.vertexColors ? 1 : 0}|${m.normalScale ? Math.sign(m.normalScale.y) : 0}`;
    const hit = this.propMats.get(key);
    if (hit) return hit;
    const n = m.name || '';
    if (/Vine/.test(n)) {
      m.alphaMap = m.map; m.alphaTest = 0.5; m.transparent = false; m.side = THREE.DoubleSide;
      if (m.color) m.color.setRGB(0.1, 0.15, 0.07);
    } else if (m.color) {
      if (/RoundTiles/.test(n)) m.color.setRGB(0.36, 0.34, 0.36);
      else if (/Metal/.test(n)) m.color.setRGB(0.55, 0.52, 0.5);
      else m.color.multiplyScalar(0.72);
    }
    m.needsUpdate = true;
    this.propMats.set(key, m);
    return m;
  }
  instanceProp(name, gltf) {
    const mats = this.place[name];
    if (!mats || !mats.length) return;
    const far = /Roof/.test(name), vine = /Vine/.test(name);
    gltf.scene.updateMatrixWorld(true);
    const meshes = [];
    gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
    for (const o of meshes) {
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      const mat = Array.isArray(o.material) ? this.propMat(o.material[0]) : this.propMat(o.material);
      const im = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = this.Q.propShadow && !far && !vine;
      im.receiveShadow = !far;
      im.name = 'prop_' + name;
      this.group.add(im);
    }
  }
  async loadAsync() {
    try {
      const loader = new GLTFLoader();
      const names = Object.keys(this.place).filter(n => this.place[n] && this.place[n].length);
      const results = await Promise.all(names.map(n => loader.loadAsync(PROP_DIR + n + '.gltf')
        .then(g => [n, g])
        .catch(err => { console.warn('[arena] prop failed to load:', n, err); return [n, null]; })));
      let added = false;
      for (const [n, g] of results) {
        if (!g) continue;
        try { this.instanceProp(n, g); } catch (err) { console.warn('[arena] prop failed to instance:', n, err); continue; }
        for (const f of this._propFires[n] || []) { this.addFire(f.x, f.y, f.z, f.s, f.o); added = true; }
      }
      if (added) this.rebuildFire();
      await Promise.all(this._texWait);
    } catch (err) {
      console.warn('[arena] async load error', err);
    }
    return this;
  }

  // ---------------------------------------------------------------- per frame (O(fires + lights))
  update(dt, vfx) {
    dt = Math.min(dt || 0, 0.1);
    this.time += dt;
    const t = this.time;
    this.crowdHype = Math.max(0, Math.min(1, this.crowdHype || 0) - dt * 0.35);
    const hype = this.crowdHype, boost = 1 + hype * 0.35;
    this.U.time.value = t; this.U.hype.value = hype;
    if (this.flameMat) { this.flameMat.uniforms.uTime.value = t; this.flameMat.uniforms.uBoost.value = boost; }
    if (this.glowMat) { this.glowMat.uniforms.uTime.value = t; this.glowMat.uniforms.uBoost.value = boost; }
    if (this.emberMat) {
      this.emberMat.uniforms.uTime.value = t;
      this.emberMat.uniforms.uScale.value = (window.innerHeight || 900) * Math.min(window.devicePixelRatio || 1, 1.75) * 0.866;
    }
    if (this.mistMat) {
      this.mistMat.uniforms.uTime.value = t;
      const fog = this.scene.fog;
      if (fog && fog.color) this.mistMat.uniforms.uColor.value.copy(fog.color).multiplyScalar(2.0).add(MIST_ADD);
    }
    if (this.decalMat) this.decalMat.emissiveIntensity = 0.9 + Math.sin(t * 1.1) * 0.12 + hype * 0.5;
    for (let i = 0; i < this.lights.length; i++) {
      const L = this.lights[i];
      L.light.intensity = L.base * boost * (0.86 + Math.sin(t * 10.3 + L.ph) * 0.07 + Math.sin(t * 23.1 + L.ph * 2.3) * 0.05 + Math.sin(t * 3.7 + L.ph) * 0.03);
    }
    if (vfx && vfx.emit) {
      for (let i = 0; i < this.sparkSrc.length; i++) {
        const f = this.sparkSrc[i];
        if (Math.random() >= dt * f.rate) continue;
        vfx.emit({
          x: f.x + (Math.random() - 0.5) * 0.5 * f.s, y: f.y + f.s * 0.9, z: f.z + (Math.random() - 0.5) * 0.5 * f.s,
          vx: (Math.random() - 0.5) * 0.8, vy: 1.4 + Math.random() * 2.0, vz: (Math.random() - 0.5) * 0.8,
          life: 0.8 + Math.random() * 0.8, size: (0.1 + Math.random() * 0.1) * (0.6 + f.s * 0.6),
          color: Math.random() < 0.5 ? 0xff7a24 : 0xffb050, grow: -0.6, drag: 0.5, gravity: -0.3,
        });
      }
    }
  }
}
