// The Runefall Arena: a ruined elven colosseum at dusk. Hand-painted canvas textures,
// glowing rune circles, ornate rune pillars (line-of-sight blockers), tiered stands with
// an instanced crowd, an arcade crown with banners, statues and braziers, and beyond the
// walls a rolling terrain ring with trees, mountains, a castle and floating islands under
// a stylized dusk sky. Static geometry is merged per material and repeated objects are
// instanced, so the whole arena is only ~30 draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PILLARS, ARENA_R } from '../sim/sim.js';

const TAU = Math.PI * 2;
const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
const RUNE_FONT = '"Segoe UI Historic", "Noto Sans Runic", "Segoe UI Symbol", serif';
const FLOOR_R = ARENA_R + 2.6;          // painted floor disc (reaches under the wall)
const WALL_R = ARENA_R + 2.5;           // inner face of the arena wall
const WALK_R = ARENA_R + 0.45;          // raised brazier walkway starts here
const BRAZ_R = ARENA_R + 1.3;
const TIER_R = WALL_R + 0.5, TIER_W = 1.6, TIER_H = 0.9, TIERS = 6, TIER_Y0 = 3.9;
const STAND_TOP = TIER_Y0 + (TIERS - 1) * TIER_H;    // 8.4
const ARC_R = TIER_R + TIERS * TIER_W + 1.4;          // arcade centre radius (43)
const ARC_BAYS = 30;
const BAN_R = ARC_R - 1.25, BAN_TOP = STAND_TOP + 7.9, BAN_W = 1.9, BAN_H = 4.4;
const GATE_GAP = 0.128;                 // angular half-gap in wall/stands for each gatehouse
const DIAG = PILLARS.map(p => Math.atan2(p.x, p.z));
const BRAZIER_A = Array.from({ length: 8 }, (_, k) => k * Math.PI / 4 + Math.PI / 8);
const GOLD = 0xd9a84a, IRON = 0x34302c, IRON2 = 0x1c1816, ROOF = 0x3a5a9a;
const GLYPH_C = new THREE.Color(0x7fd8ff);

const QUALITY = {
  high: { floor: 2048, nrm: 1024, crowd: 1100, pines: 360, oaks: 130, rocks: 140, motes: 520, oct: 5, mist: true, shafts: true },
  medium: { floor: 2048, nrm: 1024, crowd: 800, pines: 240, oaks: 90, rocks: 90, motes: 360, oct: 4, mist: true, shafts: true },
  low: { floor: 1024, nrm: 512, crowd: 450, pines: 120, oaks: 40, rocks: 50, motes: 180, oct: 3, mist: false, shafts: false },
};

// ------------------------------------------------------------------ small helpers
function rng(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
function angDist(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }
function v3(x, y, z) { return new THREE.Vector3(x, y, z); }
function glowC(hex, k) { return new THREE.Color(hex).multiplyScalar(k); }
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s, P) {
  let xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  let x1 = xi + 1, y1 = yi + 1;
  if (P) { xi = ((xi % P) + P) % P; yi = ((yi % P) + P) % P; x1 = ((x1 % P) + P) % P; y1 = ((y1 % P) + P) % P; }
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(x1, yi, s), c = hash2(xi, y1, s), d = hash2(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm2(x, y, s, oct = 4, P = 0) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) { sum += vnoise(x * f, y * f, s + i * 31, P ? P * f : 0) * amp; norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}
function terrainH(x, z) {
  const r = Math.hypot(x, z);
  const ramp = smooth(46, 150, r);
  const n = fbm2(x * 0.011 + 3.1, z * 0.011 - 7.7, 11, 4);
  const n2 = fbm2(x * 0.045, z * 0.045, 23, 2);
  return -0.6 + ramp * (10 + Math.max(0, r - 150) * 0.055) + (n - 0.42) * (6 + 46 * ramp) * smooth(48, 95, r) + (n2 - 0.5) * 2.5 * ramp;
}
function mat4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, order = 'XYZ') {
  const sc = Array.isArray(s) ? new THREE.Vector3(s[0], s[1], s[2]) : new THREE.Vector3(s, s, s);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, order)), sc);
}
// cylinder from point a (radius r0) to point b (radius r1): returns [geometry, matrix]
function cylBetween(a, b, r0, r1, seg = 6) {
  const dir = new THREE.Vector3().subVectors(b, a), L = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return [g, new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1))];
}
// writes a flat (XZ-plane) decal instance matrix: translate * rotY(ang) * scale(s)
function setFlat(a, i, x, y, z, ang, s) {
  const c = Math.cos(ang) * s, sn = Math.sin(ang) * s, o = i * 16;
  a[o] = c; a[o + 1] = 0; a[o + 2] = -sn; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = s; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = sn; a[o + 9] = 0; a[o + 10] = c; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}
// Surface of revolution with flat-shaded bands. profile: [[r, y], ...]; the front face of
// each band has normal (dy, -dx) in (r, y): go upward for outward faces, top→bottom for
// inward faces, outer→inner for upward faces.
function revolve(profile, segs, o = {}) {
  const a0 = o.a0 ?? 0, a1 = o.a1 ?? TAU, vS = o.v ?? 1, cols = o.colors;
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const cc = new THREE.Color();
  let vAcc = 0;
  for (let k = 0; k < profile.length - 1; k++) {
    const [r0, y0] = profile[k], [r1, y1] = profile[k + 1];
    const dx = r1 - r0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;
    const nr = dy / L, ny = -dx / L;
    const uRep = o.uw ? (a1 - a0) * Math.max((r0 + r1) / 2, 0.5) * o.uw : (o.u ?? 1);
    if (cols) cc.set(cols[k % cols.length]); else cc.setRGB(1, 1, 1);
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, a = a0 + (a1 - a0) * t, s = Math.sin(a), c = Math.cos(a);
      pos.push(r0 * s, y0, r0 * c, r1 * s, y1, r1 * c);
      nor.push(nr * s, ny, nr * c, nr * s, ny, nr * c);
      uv.push(t * uRep, vAcc * vS, t * uRep, (vAcc + L) * vS);
      col.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b);
    }
    for (let i = 0; i < segs; i++) { const p = base + i * 2, q = p + 2; idx.push(p, q, p + 1, q + 1, p + 1, q); }
    vAcc += L;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
function flutedShaft(rb, rt, h, flutes = 12, seg = 48) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), k = 1 - 0.05 * (0.5 + 0.5 * Math.cos(Math.atan2(x, z) * flutes));
    p.setXYZ(i, x * k, p.getY(i), z * k);
  }
  g.computeVertexNormals();
  return g;
}
function gradientGeo(geo, color, k0, k1, y0, y1) {
  const g = geo.clone(), p = g.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color(color);
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0))), f = k0 + (k1 - k0) * t;
    c[i * 3] = col.r * f; c[i * 3 + 1] = col.g * f; c[i * 3 + 2] = col.b * f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function jitter(geo, amt, seed, freq = 0.05) {
  const p = geo.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    const f = 1 + (fbm2(x * freq + 11, (y + z) * freq, seed, 2) - 0.5) * amt;
    p.setXYZ(k, x * f, y, z * f);
  }
  return geo;
}

// Collects transformed, vertex-coloured parts and merges them into one geometry.
const KEEP = { position: 1, normal: 1, uv: 1, color: 1 };
class Merger {
  constructor() { this.parts = []; }
  add(geo, matrix = null, color = null, uv = null) { this.parts.push({ geo, matrix, color, uv }); return this; }
  build() {
    if (!this.parts.length) return null;
    const flat = this.parts.some(p => !p.geo.index);
    const c = new THREE.Color(), out = [];
    for (const p of this.parts) {
      const g = flat && p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      for (const k of Object.keys(g.attributes)) if (!KEEP[k]) g.deleteAttribute(k);
      g.morphAttributes = {};
      const n = g.attributes.position.count;
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      if (p.uv) {
        const a = g.attributes.uv;
        for (let i = 0; i < n; i++) a.setXY(i, a.getX(i) * p.uv[0] + (p.uv[2] || 0), a.getY(i) * p.uv[1] + (p.uv[3] || 0));
      }
      if (p.color !== null && p.color !== undefined) c.set(p.color); else c.setRGB(1, 1, 1);
      if (g.attributes.color) {
        const a = g.attributes.color;
        for (let i = 0; i < n; i++) a.setXYZ(i, a.getX(i) * c.r, a.getY(i) * c.g, a.getZ(i) * c.b);
      } else {
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      }
      if (p.matrix) g.applyMatrix4(p.matrix);
      out.push(g);
    }
    return mergeGeometries(out, false) || null;
  }
}

// ------------------------------------------------------------------ canvas textures
function makeCanvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function toTex(c, srgb = true, wrap = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function normalFromHeight(hc, strength, wrap) {
  const W = hc.width, H = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, W, H).data;
  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) h[i] = src[i * 4] / 255;
  const out = makeCanvas(W, H), og = out.getContext('2d'), img = og.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) {
    const ym = wrap ? (y - 1 + H) % H : Math.max(0, y - 1), yp = wrap ? (y + 1) % H : Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const xm = wrap ? (x - 1 + W) % W : Math.max(0, x - 1), xp = wrap ? (x + 1) % W : Math.min(W - 1, x + 1);
      const nx = -(h[y * W + xp] - h[y * W + xm]) * strength, ny = (h[yp * W + x] - h[ym * W + x]) * strength;
      const il = 1 / Math.sqrt(nx * nx + ny * ny + 1), o = (y * W + x) * 4;
      d[o] = (nx * il * 0.5 + 0.5) * 255; d[o + 1] = (ny * il * 0.5 + 0.5) * 255; d[o + 2] = (il * 0.5 + 0.5) * 255; d[o + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  return toTex(out, false, wrap);
}
function blob(g, x, y, rad, col, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, rad);
  gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
}
function polyLine(g, pts, lw, style, dx = 0, dy = 0) {
  g.beginPath();
  pts.forEach(([a, r], i) => { const x = Math.cos(a) * r + dx, y = Math.sin(a) * r + dy; i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.lineWidth = lw; g.strokeStyle = style; g.stroke();
}

// Floor: colour (hand-painted flagstones), height (→ normal map) and metal/roughness
// (bronze inlays are metallic) drawn in one pass in world units (canvas x = world x,
// canvas y = world z) so all three line up.
function paintFloor(sizeC, sizeH) {
  const cc = makeCanvas(sizeC), ch = makeCanvas(sizeH), cm = makeCanvas(sizeH);
  const T = [[cc, 'c'], [ch, 'h'], [cm, 'm']].map(([cv, m]) => {
    const g = cv.getContext('2d'), k = cv.width / 2 / FLOOR_R;
    g.setTransform(k, 0, 0, k, cv.width / 2, cv.width / 2);
    return { g, m };
  });
  const each = fn => { for (const t of T) { t.g.save(); fn(t.g, t.m); t.g.restore(); } };
  const C = T[0].g, r = rng(7), E = FLOOR_R + 0.5;
  each((g, m) => { g.fillStyle = m === 'c' ? '#2a231e' : m === 'h' ? '#262626' : '#00f000'; g.fillRect(-E, -E, 2 * E, 2 * E); });

  // concentric rings of flagstones
  const bands = [[3.88, 9.36, 3], [9.88, 18.64, 5], [19.16, 28.8, 5], [29.32, FLOOR_R + 0.4, 1]];
  const gap = 0.045;
  for (const [b0, b1, nr] of bands) {
    const w = (b1 - b0) / nr;
    for (let ri = 0; ri < nr; ri++) {
      const r0 = b0 + ri * w, r1 = r0 + w, rm = (r0 + r1) / 2;
      const n = Math.max(8, Math.round(TAU * rm / (b0 > 29 ? 3.2 : 2.15)));
      const lens = []; let tot = 0;
      for (let j = 0; j < n; j++) { const L = 0.7 + r() * 0.6; lens.push(L); tot += L; }
      let a = r() * TAU;
      for (let j = 0; j < n; j++) {
        const da = lens[j] / tot * TAU, a0 = a, a1 = a + da; a = a1;
        const v = 0.40 + r() * 0.17, kind = r(), hb = r();
        const am = (a0 + a1) / 2, cx = Math.cos(am) * rm, cy = Math.sin(am) * rm;
        const spots = [], ns = 2 + Math.floor(r() * 4);
        for (let q = 0; q < ns; q++) spots.push([a0 + da * r(), r0 + w * r(), 0.15 + r() * 0.45, r() < 0.6, 0.06 + r() * 0.12]);
        let crack = null;
        if (r() < 0.3) {
          crack = []; let ca = a0 + da * (0.2 + r() * 0.6), cr = r0 + w * r(); crack.push([ca, cr]);
          for (let q = 0; q < 4; q++) { ca += (r() - 0.5) * da * 0.5; cr += (r() - 0.5) * w * 0.6; crack.push([ca, cr]); }
        }
        let dmin = 99; for (const p of PILLARS) dmin = Math.min(dmin, Math.hypot(cx - p.x, cy - p.z));
        const moss = [];
        if (r() < (rm > 26 ? 0.55 : dmin < 4.6 ? 0.55 : 0.06)) {
          const nm = 3 + Math.floor(r() * 5);
          for (let q = 0; q < nm; q++) { const edge = r() < 0.5; moss.push([a0 + da * r(), edge ? (r() < 0.5 ? r0 + 0.05 : r1 - 0.05) : r0 + w * r(), 0.12 + r() * 0.35]); }
        }
        const rad = Math.max(w, da * rm) * 0.8;
        each((g, m) => {
          const ga = gap / rm;
          g.beginPath(); g.arc(0, 0, r1 - gap, a0 + ga, a1 - ga); g.arc(0, 0, r0 + gap, a1 - ga, a0 + ga, true); g.closePath();
          if (m === 'm') { g.fillStyle = '#00e000'; g.fill(); return; }
          g.save(); g.clip();
          if (m === 'c') {
            let R = 1.02, G = 0.96, B = 0.86;
            if (kind >= 0.85) { R = 0.9; G = 0.94; B = 1.02; } else if (kind >= 0.6) { R = 1.08; G = 0.97; B = 0.76; }
            const base = v * 255;
            g.fillStyle = `rgb(${base * R | 0},${base * G | 0},${base * B | 0})`; g.fill();
            const gr = g.createRadialGradient(cx - 0.2, cy - 0.25, 0, cx, cy, rad);
            gr.addColorStop(0, 'rgba(255,236,200,0.20)'); gr.addColorStop(0.55, 'rgba(255,236,200,0)'); gr.addColorStop(1, 'rgba(20,10,0,0.35)');
            g.fillStyle = gr; g.fill();
            g.lineWidth = 0.14; g.strokeStyle = 'rgba(25,16,8,0.45)'; g.stroke();
            for (const [sa, sr, ss, dark, al] of spots) blob(g, Math.cos(sa) * sr, Math.sin(sa) * sr, ss, dark ? '40,28,16' : '235,220,190', al);
            for (const [ma, mr, ms] of moss) blob(g, Math.cos(ma) * mr, Math.sin(ma) * mr, ms, '64,94,36', 0.45);
            if (crack) { polyLine(g, crack, 0.05, 'rgba(18,12,8,0.8)'); polyLine(g, crack, 0.025, 'rgba(255,235,200,0.25)', 0.035, 0.035); }
          } else {
            const hv = 150 + hb * 55 | 0;
            g.fillStyle = `rgb(${hv},${hv},${hv})`; g.fill();
            const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
            gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(0.6, 'rgba(128,128,128,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.45)');
            g.fillStyle = gr; g.fill();
            g.lineWidth = 0.12; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.stroke();
            for (const [sa, sr, ss, dark] of spots) if (dark) blob(g, Math.cos(sa) * sr, Math.sin(sa) * sr, ss * 0.6, '0,0,0', 0.18);
            if (crack) polyLine(g, crack, 0.06, 'rgba(0,0,0,0.75)');
          }
          g.restore();
        });
      }
    }
  }
  // central medallion
  each((g, m) => {
    g.beginPath(); g.arc(0, 0, 3.42, 0, TAU);
    if (m === 'm') { g.fillStyle = '#00d000'; g.fill(); return; }
    if (m === 'c') { const gr = g.createRadialGradient(-0.6, -0.8, 0, 0, 0, 3.42); gr.addColorStop(0, '#a99d88'); gr.addColorStop(1, '#6a6052'); g.fillStyle = gr; } else g.fillStyle = '#c8c8c8';
    g.fill();
    g.strokeStyle = m === 'c' ? 'rgba(35,25,15,0.55)' : '#707070'; g.lineWidth = 0.05;
    for (const rr of [1.15, 2.75, 3.15]) { g.beginPath(); g.arc(0, 0, rr, 0, TAU); g.stroke(); }
  });
  // inlaid bronze rings, spokes, star and studs
  const inlay = (pathFn, lw) => each((g, m) => {
    pathFn(g); g.lineCap = 'round'; g.lineJoin = 'round';
    if (m === 'c') {
      g.strokeStyle = '#3e2a12'; g.lineWidth = lw * 1.35; g.stroke();
      g.strokeStyle = '#a8772f'; g.lineWidth = lw; g.stroke();
      g.strokeStyle = 'rgba(255,222,140,0.85)'; g.lineWidth = lw * 0.3; g.stroke();
    } else if (m === 'h') { g.strokeStyle = '#f0f0f0'; g.lineWidth = lw * 1.2; g.stroke(); }
    else { g.strokeStyle = 'rgb(0,80,240)'; g.lineWidth = lw * 1.3; g.stroke(); }
  });
  const circ = rr => g => { g.beginPath(); g.arc(0, 0, rr, 0, TAU); };
  const RINGS = [3.62, 9.62, 18.9, ARENA_R + 0.06];
  RINGS.forEach((rr, i) => inlay(circ(rr), i === 3 ? 0.26 : 0.2));
  inlay(g => { g.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g.moveTo(Math.cos(a) * 3.62, Math.sin(a) * 3.62); g.lineTo(Math.cos(a) * 9.62, Math.sin(a) * 9.62); } }, 0.12);
  inlay(g => { g.beginPath(); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; g.moveTo(Math.cos(a) * 9.62, Math.sin(a) * 9.62); g.lineTo(Math.cos(a) * 18.9, Math.sin(a) * 18.9); } }, 0.12);
  inlay(g => { g.beginPath(); for (let s = 0; s < 2; s++) for (let k = 0; k <= 4; k++) { const a = k * Math.PI / 2 + s * Math.PI / 4, x = Math.cos(a) * 2.45, y = Math.sin(a) * 2.45; k ? g.lineTo(x, y) : g.moveTo(x, y); } }, 0.1);
  const studs = [];
  for (const rr of RINGS) { const n = Math.round(TAU * rr / 1.7); for (let k = 0; k < n; k++) studs.push([k / n * TAU + 0.1, rr]); }
  each((g, m) => {
    for (const [a, rr] of studs) {
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr, s = 0.17;
      g.beginPath(); g.moveTo(x + s, y); g.lineTo(x, y + s); g.lineTo(x - s, y); g.lineTo(x, y - s); g.closePath();
      g.fillStyle = m === 'c' ? '#e2b65a' : m === 'h' ? '#ffffff' : 'rgb(0,70,250)'; g.fill();
      if (m === 'c') { g.strokeStyle = '#3e2a12'; g.lineWidth = 0.035; g.stroke(); }
    }
  });
  // colour-only wear: dirt, scuffs, edge grime, moss, speckle
  C.save();
  for (let i = 0; i < 55; i++) { const a = r() * TAU, rr = Math.sqrt(r()) * 28; blob(C, Math.cos(a) * rr, Math.sin(a) * rr, 1.2 + r() * 3.2, '45,32,20', 0.1 + r() * 0.12); }
  for (const z of [-20, 20]) for (let i = 0; i < 10; i++) blob(C, (r() - 0.5) * 9, z + (r() - 0.5) * 6, 0.8 + r() * 1.8, '230,205,165', 0.06 + r() * 0.06);
  let gr = C.createRadialGradient(0, 0, 23, 0, 0, 29.4);
  gr.addColorStop(0, 'rgba(28,20,12,0)'); gr.addColorStop(1, 'rgba(28,20,12,0.42)');
  C.fillStyle = gr; C.beginPath(); C.arc(0, 0, 29.4, 0, TAU); C.fill();
  gr = C.createRadialGradient(0, 0, 0, 0, 0, 14);
  gr.addColorStop(0, 'rgba(255,225,180,0.07)'); gr.addColorStop(1, 'rgba(255,225,180,0)');
  C.fillStyle = gr; C.beginPath(); C.arc(0, 0, 14, 0, TAU); C.fill();
  for (let i = 0; i < 260; i++) { const a = r() * TAU, rr = 26.8 + r() * 2.6; blob(C, Math.cos(a) * rr, Math.sin(a) * rr, 0.15 + r() * 0.55, r() < 0.5 ? '62,92,34' : '88,110,40', 0.22 + r() * 0.2); }
  for (const p of PILLARS) for (let i = 0; i < 45; i++) { const a = r() * TAU, rr = 2.1 + r() * 1.8; blob(C, p.x + Math.cos(a) * rr, p.z + Math.sin(a) * rr, 0.12 + r() * 0.45, '62,92,34', 0.2 + r() * 0.2); }
  for (let i = 0; i < 4000; i++) {
    const a = r() * TAU, rr = Math.sqrt(r()) * FLOOR_R, s = 0.02 + r() * 0.05;
    C.fillStyle = r() < 0.5 ? `rgba(255,240,215,${0.06 + r() * 0.1})` : `rgba(15,10,5,${0.08 + r() * 0.12})`;
    C.fillRect(Math.cos(a) * rr, Math.sin(a) * rr, s, s);
  }
  C.restore();
  return { map: toTex(cc), normal: normalFromHeight(ch, 3 * sizeH / 1024, false), mr: toTex(cm, false) };
}

// Tiling hand-painted masonry (colour + normal map).
function paintMasonry(S, seed, tint, opt = {}) {
  const cc = makeCanvas(S), ch = makeCanvas(S);
  const T = [{ g: cc.getContext('2d'), m: 'c' }, { g: ch.getContext('2d'), m: 'h' }];
  const r = rng(seed), rows = opt.rows || 8, rh = S / rows, gap = Math.max(2, S / 200);
  for (const { g, m } of T) { g.fillStyle = m === 'c' ? '#2e2823' : '#303030'; g.fillRect(0, 0, S, S); }
  for (let y = 0; y < rows; y++) {
    let x = -r() * S * 0.2, done = false;
    const end = x + S;
    while (!done) {
      let w = opt.single ? S : S * (0.16 + r() * 0.16);
      if (x + w > end - S * 0.08) { w = end - x; done = true; }
      const v = 0.82 + r() * 0.3, hb = r(), moss = r() < (opt.moss ?? 0.15), chip = r() < 0.5, chipA = r(), crack = r() < 0.18, cr = [r(), r(), r(), r()];
      for (const dx of [0, -S, S]) {
        const bx = x + dx + gap / 2, by = y * rh + gap / 2, bw = w - gap, bh = rh - gap;
        if (bx > S || bx + bw < 0) continue;
        for (const { g, m } of T) {
          g.save(); g.beginPath(); g.rect(bx, by, bw, bh); g.clip();
          if (m === 'c') {
            g.fillStyle = `rgb(${tint.map(t => Math.min(255, t * v | 0))})`; g.fillRect(bx, by, bw, bh);
            const lg = g.createLinearGradient(bx, by, bx + bw * 0.3, by + bh);
            lg.addColorStop(0, 'rgba(255,238,205,0.22)'); lg.addColorStop(0.5, 'rgba(255,238,205,0)'); lg.addColorStop(1, 'rgba(15,8,0,0.30)');
            g.fillStyle = lg; g.fillRect(bx, by, bw, bh);
            g.strokeStyle = 'rgba(20,12,6,0.45)'; g.lineWidth = gap * 1.6; g.strokeRect(bx, by, bw, bh);
            g.strokeStyle = 'rgba(255,240,210,0.18)'; g.lineWidth = gap * 0.6;
            g.beginPath(); g.moveTo(bx + gap, by + bh - gap); g.lineTo(bx + gap, by + gap); g.lineTo(bx + bw - gap, by + gap); g.stroke();
            if (moss) { const mg = g.createLinearGradient(0, by, 0, by + bh * 0.6); mg.addColorStop(0, 'rgba(70,100,40,0.55)'); mg.addColorStop(1, 'rgba(70,100,40,0)'); g.fillStyle = mg; g.fillRect(bx, by, bw, bh); }
          } else {
            const hv = 150 + hb * 60 | 0;
            g.fillStyle = `rgb(${hv},${hv},${hv})`; g.fillRect(bx, by, bw, bh);
            g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = gap * 2; g.strokeRect(bx, by, bw, bh);
          }
          const ink = m === 'c' ? 'rgba(25,15,8,0.7)' : 'rgba(0,0,0,0.7)';
          if (chip) {
            const cxp = chipA < 0.5 ? bx : bx + bw, cyp = chipA < 0.25 || chipA > 0.75 ? by : by + bh, s = rh * 0.25;
            g.fillStyle = ink; g.beginPath(); g.moveTo(cxp, cyp); g.lineTo(cxp + (cxp === bx ? s : -s), cyp); g.lineTo(cxp, cyp + (cyp === by ? s * 0.7 : -s * 0.7)); g.closePath(); g.fill();
          }
          if (crack) {
            g.strokeStyle = ink; g.lineWidth = gap * 0.6; g.beginPath();
            g.moveTo(bx + bw * cr[0], by); g.lineTo(bx + bw * cr[1], by + bh * 0.5); g.lineTo(bx + bw * cr[2], by + bh * cr[3]); g.stroke();
          }
          g.restore();
        }
      }
      x += w;
    }
  }
  return { map: toTex(cc, true, true), normal: normalFromHeight(ch, 2.5, true) };
}

function runeCircleTex(S, o) {
  const c = makeCanvas(S), g = c.getContext('2d'), h = S / 2, R = h * 0.96;
  g.translate(h, h);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
  gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.04)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = S * 0.012;
  const ring = (f, w) => { g.lineWidth = Math.max(1, w * S); g.beginPath(); g.arc(0, 0, f * R, 0, TAU); g.stroke(); };
  ring(1, 0.006); ring(0.965, 0.002); ring(0.80, 0.0035); ring(0.78, 0.0015);
  g.font = `${Math.floor(S * 0.06)}px ${RUNE_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < o.count; i++) {
    const a = i / o.count * TAU;
    g.save(); g.rotate(a); g.translate(0, -0.882 * R); g.fillText(RUNES[(i * 5 + 3) % RUNES.length], 0, 0); g.restore();
    const b = a + Math.PI / o.count;
    g.beginPath(); g.arc(Math.sin(b) * 0.882 * R, -Math.cos(b) * 0.882 * R, S * 0.004, 0, TAU); g.fill();
  }
  g.lineWidth = Math.max(1, S * 0.0018);
  for (let i = 0; i < 120; i++) {
    const a = i / 120 * TAU, r0 = (i % 5 ? 0.74 : 0.71) * R, r1 = 0.765 * R;
    g.beginPath(); g.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0); g.lineTo(Math.sin(a) * r1, -Math.cos(a) * r1); g.stroke();
  }
  const ir = o.inner * R;
  ring(o.inner, 0.003);
  const star = (n, step, rad, rot) => {
    g.lineWidth = Math.max(1, S * 0.0028); g.beginPath();
    for (let i = 0; i <= n; i++) { const a = rot + i * step / n * TAU, x = Math.sin(a) * rad, y = -Math.cos(a) * rad; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  };
  if (o.flower) {
    star(3, 1, ir, 0); star(3, 1, ir, Math.PI / 3);
    g.lineWidth = Math.max(1, S * 0.0018);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; g.beginPath(); g.arc(Math.sin(a) * ir * 0.5, -Math.cos(a) * ir * 0.5, ir * 0.5, 0, TAU); g.stroke(); }
    ring(o.inner * 0.5, 0.002);
  } else {
    star(8, 3, ir, 0);
    ring(o.inner * 0.42, 0.0025);
  }
  g.beginPath(); g.arc(0, 0, S * 0.012, 0, TAU); g.fill();
  return toTex(c);
}
function glyphStripTex() {
  const c = makeCanvas(1024, 128), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 8;
  g.lineWidth = 3; for (const y of [12, 116]) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  g.lineWidth = 1.5; for (const y of [24, 104]) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  g.font = `60px ${RUNE_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const n = 12;
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * 1024 / n;
    g.fillText(RUNES[(i * 7) % RUNES.length], x, 66);
    g.beginPath(); g.moveTo(x + 42, 58); g.lineTo(x + 48, 64); g.lineTo(x + 42, 70); g.lineTo(x + 36, 64); g.closePath(); g.fill();
  }
  return toTex(c, true, true);
}
function glyphColumnTex() {
  const c = makeCanvas(512, 512), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 10;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `56px ${RUNE_FONT}`;
  for (let col = 0; col < 4; col++) {
    const x0 = col * 128;
    g.lineWidth = 3; g.beginPath(); g.moveTo(x0 + 22, 18); g.lineTo(x0 + 22, 494); g.moveTo(x0 + 106, 18); g.lineTo(x0 + 106, 494); g.stroke();
    g.lineWidth = 2;
    for (const y of [18, 494]) { g.beginPath(); g.moveTo(x0 + 22, y); g.lineTo(x0 + 64, y + (y < 100 ? -14 : 14)); g.lineTo(x0 + 106, y); g.stroke(); }
    for (let k = 0; k < 5; k++) g.fillText(RUNES[(col * 5 + k * 3) % RUNES.length], x0 + 64, 70 + k * 93);
    for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(x0 + 64, 116 + k * 93, 4, 0, TAU); g.fill(); }
  }
  return toTex(c);
}
function poolTex() {
  const S = 128, c = makeCanvas(S), g = c.getContext('2d'), gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return toTex(c);
}
function noiseTex(S) {
  const c = makeCanvas(S), g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data, P = 8;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = fbm2(x / S * P, y / S * P, 5, 4, P) * 255, o = (y * S + x) * 4;
    d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTex(c, false, true);
}
const EMBLEMS = [
  g => { // crossed swords
    for (const s of [-1, 1]) {
      g.save(); g.rotate(s * 0.75);
      g.beginPath(); g.moveTo(-7, 52); g.lineTo(-7, -48); g.lineTo(0, -64); g.lineTo(7, -48); g.lineTo(7, 52); g.closePath(); g.fill(); g.stroke();
      g.fillRect(-24, 44, 48, 9); g.strokeRect(-24, 44, 48, 9); g.fillRect(-5, 53, 10, 18);
      g.beginPath(); g.arc(0, 76, 7, 0, TAU); g.fill(); g.stroke();
      g.restore();
    }
  },
  g => { // eight-point star
    g.beginPath();
    for (let k = 0; k < 16; k++) { const a = k / 16 * TAU, rr = k % 2 ? 26 : 66; g.lineTo(Math.sin(a) * rr, -Math.cos(a) * rr); }
    g.closePath(); g.fill(); g.stroke();
  },
  g => { // lightning bolt
    const P = [[12, -68], [-28, 6], [-4, 6], [-16, 68], [30, -10], [6, -10], [22, -68]];
    g.beginPath(); P.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); g.stroke();
  },
  g => { // crescent moon
    const R0 = 60, R1 = 50, d = 24, ix = (R0 * R0 - R1 * R1 + d * d) / (2 * d), iy = Math.sqrt(R0 * R0 - ix * ix);
    g.rotate(-0.4); g.beginPath();
    g.arc(0, 0, R0, Math.atan2(iy, ix), Math.atan2(-iy, ix) + TAU);
    g.arc(d, 0, R1, Math.atan2(-iy, ix - d), Math.atan2(iy, ix - d), true);
    g.closePath(); g.fill(); g.stroke();
  },
  g => { // flame
    g.beginPath(); g.moveTo(0, 66);
    g.bezierCurveTo(-52, 50, -48, -4, -16, -30); g.bezierCurveTo(-18, -6, -4, 2, 0, 6);
    g.bezierCurveTo(-6, -24, 10, -50, 4, -72); g.bezierCurveTo(40, -40, 54, 20, 0, 66);
    g.closePath(); g.fill(); g.stroke();
  },
];
function bannerAtlas() {
  const W = 256, H = 512, c = makeCanvas(W * 5, H), g = c.getContext('2d');
  const designs = [['#9a1c1c', '#3a0808'], ['#1c3c8a', '#0a1438'], ['#1f6a32', '#0a2a12'], ['#5e2a86', '#22103a'], ['#a8741a', '#3e2606']];
  designs.forEach(([c1, c2], i) => {
    g.save(); g.translate(i * W, 0);
    const shape = () => { g.beginPath(); g.moveTo(14, 0); g.lineTo(W - 14, 0); g.lineTo(W - 14, H - 8); g.lineTo(W / 2, H - 92); g.lineTo(14, H - 8); g.closePath(); };
    shape(); g.save(); g.clip();
    let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    gr = g.createLinearGradient(0, 0, W, 0);
    for (let k = 0; k <= 6; k++) gr.addColorStop(k / 6, k % 2 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.07)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.025)'; for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
    shape(); g.strokeStyle = 'rgba(40,20,0,0.7)'; g.lineWidth = 22; g.stroke();
    shape(); g.strokeStyle = '#d9b061'; g.lineWidth = 16; g.stroke();
    g.fillStyle = '#d9b061'; g.fillRect(0, 0, W, 30); g.fillStyle = 'rgba(60,30,0,0.5)'; g.fillRect(0, 30, W, 4);
    g.fillStyle = '#e8c477';
    for (let k = -1; k <= 1; k++) { const x = W / 2 + k * 44, y = 360; g.beginPath(); g.moveTo(x, y - 10); g.lineTo(x + 8, y); g.lineTo(x, y + 10); g.lineTo(x - 8, y); g.closePath(); g.fill(); }
    g.translate(W / 2, 210);
    g.strokeStyle = '#e8c477'; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 82, 0, TAU); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 92, 0, TAU); g.stroke();
    g.fillStyle = '#f0cf7a'; g.strokeStyle = 'rgba(40,20,0,0.7)'; g.lineWidth = 3; g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 8;
    EMBLEMS[i](g);
    g.restore();
    g.restore();
  });
  return toTex(c);
}

// ------------------------------------------------------------------ shaders
const OUT_CHUNKS = `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;
const SKY_VS = `varying vec3 vP;
void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FS = `varying vec3 vP;
uniform float uTime; uniform vec3 uSun; uniform vec3 uMoon; uniform vec3 uFog;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < OCT; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
float hash3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
void main(){
  vec3 d = normalize(vP);
  float y = d.y, yy = max(y, 0.0);
  float sunAmt = max(dot(d, uSun), 0.0);
  float side = dot(normalize(d.xz + vec2(1e-4)), normalize(uSun.xz + vec2(1e-4))) * 0.5 + 0.5;
  float warm = pow(side, 2.2);
  vec3 hor = mix(vec3(0.30, 0.17, 0.30), vec3(1.15, 0.50, 0.20), warm);
  vec3 mid = mix(vec3(0.13, 0.08, 0.22), vec3(0.42, 0.15, 0.20), warm);
  vec3 col = mix(hor, mid, smoothstep(0.0, 0.18, yy));
  col = mix(col, vec3(0.06, 0.05, 0.17), smoothstep(0.12, 0.45, yy));
  col = mix(col, vec3(0.015, 0.02, 0.07), smoothstep(0.4, 0.95, yy));
  col += vec3(1.0, 0.45, 0.16) * pow(sunAmt, 5.0) * 0.5;
  col += vec3(1.0, 0.72, 0.42) * pow(sunAmt, 40.0) * 0.9;
  col += vec3(5.0, 3.6, 2.0) * smoothstep(0.9988, 0.9993, sunAmt);
  // soft stylized clouds, projected onto a dome so they squash toward the horizon
  vec2 cp = d.xz / (yy + 0.16) * 1.4 + vec2(uTime * 0.010, uTime * 0.0035);
  float n = fbm(cp);
  float band = smoothstep(-0.01, 0.06, y) * (1.0 - smoothstep(0.3, 0.7, y));
  float cl = smoothstep(0.5, 0.75, n) * band;
  float rim = smoothstep(0.5, 0.58, n) * (1.0 - smoothstep(0.6, 0.75, n));
  vec3 cDark = mix(vec3(0.07, 0.05, 0.12), vec3(0.26, 0.10, 0.14), warm);
  vec3 cLit = mix(vec3(0.40, 0.28, 0.48), vec3(1.5, 0.66, 0.30), warm);
  vec3 cc = mix(cDark, cLit, clamp(rim * 1.3 + pow(sunAmt, 6.0) * 0.9, 0.0, 1.0));
  col = mix(col, cc, cl * 0.9);
  // stars
  vec3 sq = d * 240.0; float hs = hash3(floor(sq));
  float st = step(0.991, hs) * (1.0 - smoothstep(0.08, 0.42, length(fract(sq) - 0.5)));
  st *= 0.55 + 0.45 * sin(uTime * (1.3 + hs * 5.0) + hs * 70.0);
  st *= smoothstep(0.1, 0.45, y) * (1.0 - cl) * (1.0 - warm * 0.6);
  col += vec3(0.85, 0.9, 1.0) * st * 1.3;
  // moon
  float md = dot(d, uMoon);
  float disk = smoothstep(0.99955, 0.99972, md);
  float maria = noise(d.xy * 700.0) * 0.5 + noise(d.zy * 1300.0) * 0.5;
  col = mix(col, vec3(1.05, 1.0, 0.92) * (0.85 + 0.25 * maria), disk * (1.0 - cl * 0.8));
  col += vec3(0.30, 0.40, 0.70) * (pow(max(md, 0.0), 300.0) * 0.6 + pow(max(md, 0.0), 30.0) * 0.08);
  // below the horizon fade into the scene fog colour
  col = mix(col, uFog, 1.0 - smoothstep(-0.1, 0.02, y));
  gl_FragColor = vec4(col, 1.0);
  ${OUT_CHUNKS}
}`;
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
  vec3 col = mix(vec3(0.9, 0.18, 0.03), vec3(1.0, 0.55, 0.12), shape);
  col = mix(col, vec3(1.0, 0.9, 0.6), core);
  gl_FragColor = vec4(col * 1.7 * uBoost, shape * 0.9);
  ${OUT_CHUNKS}
}`;
const MOTE_VS = `attribute vec4 aMove; attribute vec3 aMisc; attribute vec3 aColor;
uniform float uTime; uniform float uScale;
varying vec3 vCol; varying float vA;
void main(){
  vec3 p = position;
  float vy = aMove.x, ph = aMisc.x, H = aMisc.y, fade = 1.0;
  if (abs(vy) > 0.0001) {
    float yy = mod(uTime * abs(vy) + ph * 7.0, H);
    if (vy < 0.0) yy = H - yy;
    p.y += yy;
    fade = smoothstep(0.0, H * 0.15, yy) * (1.0 - smoothstep(H * 0.7, H, yy));
    fade *= 0.55 + 0.45 * sin(uTime * (1.5 + fract(ph) * 3.0) + ph * 11.0);
  } else {
    p.y += sin(uTime * 1.3 + ph) * aMove.z;
    fade = 0.85 + 0.15 * sin(uTime * 2.0 + ph);
  }
  p.x += sin(uTime * 0.7 + ph * 3.0) * aMove.y;
  p.z += cos(uTime * 0.6 + ph * 5.0) * aMove.y;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aMove.w * uScale / max(-mv.z, 0.5), 1.0, 160.0);
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
const SHAFT_VS = `attribute vec2 aCorner; attribute vec3 aStart; attribute vec3 aInfo;
uniform vec3 uDir; varying vec2 vUv; varying float vSeed;
void main(){
  vec3 p = aStart + uDir * aCorner.y * aInfo.y;
  vec3 toCam = normalize(cameraPosition - p);
  vec3 sideV = normalize(cross(uDir, toCam) + vec3(1e-5));
  p += sideV * aCorner.x * aInfo.x * (0.6 + 0.4 * aCorner.y);
  vUv = vec2(aCorner.x * 0.5 + 0.5, aCorner.y); vSeed = aInfo.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const SHAFT_FS = `uniform float uTime; uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; varying float vSeed;
void main(){
  float e = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float a = e * e * smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
  a *= 0.75 + 0.25 * sin(uTime * 0.6 + vSeed * 7.0 + vUv.y * 3.0);
  gl_FragColor = vec4(uColor, a * uOpacity);
  ${OUT_CHUNKS}
}`;

function findSunDir(scene) {
  let best = null;
  scene.traverse(o => { if (o.isDirectionalLight && (!best || o.intensity > best.intensity)) best = o; });
  const v = best ? best.position.clone().sub(best.target ? best.target.position : new THREE.Vector3()) : new THREE.Vector3(-35, 45, 28);
  if (v.lengthSq() < 1e-6 || Math.hypot(v.x, v.z) < 1e-3) v.set(-35, 45, 28);
  return v.normalize();
}
function addPine(m, M, tint = 1) {
  const at = (x, y, z, ry = 0) => (M ? M.clone().multiply(mat4(x, y, z, 0, ry, 0)) : mat4(x, y, z, 0, ry, 0));
  m.add(new THREE.CylinderGeometry(0.22, 0.34, 2.2, 5), at(0, 1.1, 0), 0x5a3a22);
  m.add(new THREE.ConeGeometry(2.3, 3.4, 7), at(0, 3.2, 0), glowC(0x1f4a2a, tint));
  m.add(new THREE.ConeGeometry(1.8, 3.0, 7), at(0, 4.9, 0, 0.4), glowC(0x2a5a30, tint));
  m.add(new THREE.ConeGeometry(1.25, 2.6, 7), at(0, 6.5, 0, 0.8), glowC(0x3a6a34, tint));
}
function wingShape(s) {
  const P = [[0, 0.4], [0.5, 1.2], [1.2, 1.9], [2.1, 2.5], [3.0, 2.9], [3.5, 2.8], [3.2, 2.2], [3.4, 1.7], [2.9, 1.3], [3.1, 0.7], [2.5, 0.4], [2.6, -0.3], [1.9, -0.4], [1.8, -1.1], [1.2, -0.8], [0.9, -1.6], [0.5, -0.6], [0.15, -0.9]];
  const sh = new THREE.Shape();
  P.forEach(([x, y], i) => (i ? sh.lineTo(x * s, y) : sh.moveTo(x * s, y)));
  sh.closePath();
  return new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false });
}
const WINGS = {};
function addStatue(mg, gl, S, v, eye) {
  const at = (x, y, z, rx = 0, ry = 0, rz = 0, sc = 1) => S.clone().multiply(mat4(x, y, z, rx, ry, rz, sc));
  const C = 0xf4eee4, uv = [0.08, 0.08];
  mg.add(new THREE.CylinderGeometry(1.0, 1.1, 0.3, 12), at(0, 0.15, 0), C, uv);
  mg.add(new THREE.CylinderGeometry(0.55, 1.05, 3.2, 12), at(0, 1.9, 0), C, uv);
  mg.add(new THREE.CylinderGeometry(0.85, 0.58, 1.6, 12), at(0, 4.3, 0), C, uv);
  mg.add(new THREE.TorusGeometry(0.6, 0.09, 5, 14), at(0, 3.55, 0, Math.PI / 2), C, uv);
  for (const s of [-1, 1]) mg.add(new THREE.SphereGeometry(0.5, 10, 6), at(s * 0.82, 5.0, 0, 0, 0, 0, [1.15, 0.75, 1.0]), C, uv);
  mg.add(new THREE.SphereGeometry(0.42, 12, 8), at(0, 5.55, 0.02), C, uv);
  if (v % 2 === 0) mg.add(new THREE.ConeGeometry(0.6, 1.0, 12), at(0, 6.0, -0.05), C, uv);
  else {
    mg.add(new THREE.SphereGeometry(0.47, 12, 8, 0, TAU, 0, Math.PI / 2), at(0, 5.62, 0), C, uv);
    for (const s of [-1, 1]) mg.add(new THREE.ConeGeometry(0.13, 0.9, 6), at(s * 0.45, 6.1, 0, 0, 0, -s * 0.6), C, uv);
  }
  mg.add(new THREE.BoxGeometry(1.7, 3.8, 0.14), at(0, 3.0, -0.55, 0.1), C, uv);
  for (const s of [-1, 1]) {
    if (!WINGS[s]) WINGS[s] = wingShape(s);
    mg.add(WINGS[s], at(s * 0.25, 4.3, -0.62, 0, s * 0.45, 0), C, uv);
  }
  mg.add(new THREE.BoxGeometry(0.24, 3.4, 0.08), at(0, 2.35, 0.95), C, uv);
  mg.add(new THREE.BoxGeometry(1.3, 0.16, 0.24), at(0, 4.1, 0.95), C, uv);
  mg.add(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 6), at(0, 4.45, 0.95), C, uv);
  mg.add(new THREE.SphereGeometry(0.13, 8, 6), at(0, 4.8, 0.95), C, uv);
  for (const s of [-1, 1]) {
    const [g1, m1] = cylBetween(v3(s * 0.8, 4.9, 0.05), v3(s * 0.16, 4.55, 0.88), 0.22, 0.17, 8);
    mg.add(g1, S.clone().multiply(m1), C, uv);
    mg.add(new THREE.SphereGeometry(0.17, 8, 6), at(s * 0.12, 4.55, 0.92), C, uv);
  }
  gl.add(new THREE.BoxGeometry(0.42, 0.06, 0.04), at(0, 5.6, 0.44), glowC(eye, 2.2));
}

// ------------------------------------------------------------------ the arena
export class Arena {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = QUALITY[quality] ? quality : 'high';
    this.Q = QUALITY[this.quality];
    this.group = new THREE.Group(); this.group.name = 'arena'; scene.add(this.group);
    this.animated = []; this.flames = []; this.lights = []; this.flameSrc = [];
    this.time = 0; this.crowdHype = 0; this._frame = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
    this.sunDir = findSunDir(scene);
    this.M = { near: new Merger(), far: new Merger(), pillar: new Merger(), metal: new Merger(), plain: new Merger(), glow: new Merger(), glyph: new Merger(), castle: new Merger(), mountains: new Merger() };
    this.buildTextures();
    this.buildSky();
    this.buildFloor();
    this.buildPillars();
    this.buildWalls();
    this.buildGates();
    this.buildStatues();
    this.buildBraziers();
    this.buildArcade();
    this.buildBanners();
    this.buildCrowd();
    this.buildTerrain();
    this.buildTrees();
    this.buildMountains();
    this.buildCastle();
    this.buildIslands();
    this.finalize();
    this.buildFlames();
    this.buildMotes();
    if (this.Q.mist) this.buildMist();
    if (this.Q.shafts) this.buildShafts();
  }

  buildTextures() {
    const Q = this.Q;
    const floor = paintFloor(Q.floor, Q.nrm);
    const mason = paintMasonry(512, 5, [168, 156, 138]);
    const pillar = paintMasonry(512, 11, [204, 194, 176], { rows: 3, single: true, moss: 0.25 });
    this.tex = {
      floor, mason, pillar,
      rune: runeCircleTex(1024, { count: 24, inner: 0.52, flower: true }),
      pad: runeCircleTex(512, { count: 16, inner: 0.6, flower: false }),
      strip: glyphStripTex(), column: glyphColumnTex(), pool: poolTex(), banners: bannerAtlas(), noise: noiseTex(256),
    };
    const t = this.tex;
    this.mats = {
      floor: new THREE.MeshStandardMaterial({ map: floor.map, normalMap: floor.normal, roughnessMap: floor.mr, metalnessMap: floor.mr, roughness: 1, metalness: 1 }),
      stone: new THREE.MeshStandardMaterial({ map: t.mason.map, normalMap: t.mason.normal, vertexColors: true, roughness: 0.92 }),
      pillar: new THREE.MeshStandardMaterial({ map: t.pillar.map, normalMap: t.pillar.normal, vertexColors: true, roughness: 0.8 }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.8, roughness: 0.38 }),
      plain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      scenery: new THREE.MeshLambertMaterial({ vertexColors: true }),
      sceneryFlat: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    };
    this.glyphMat = new THREE.MeshBasicMaterial({ map: t.column, color: GLYPH_C.clone().multiplyScalar(1.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  }

  buildSky() {
    const sd = this.sunDir, az = Math.atan2(sd.x, sd.z), el = 0.2;
    const sun = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const maz = az + Math.PI * 0.82, mel = 0.52;
    const moon = new THREE.Vector3(Math.sin(maz) * Math.cos(mel), Math.sin(mel), Math.cos(maz) * Math.cos(mel));
    const fogC = new THREE.Color(0x3a2638);
    if (this.scene.fog && this.scene.fog.color) fogC.copy(this.scene.fog.color);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      defines: { OCT: this.Q.oct },
      uniforms: { uTime: { value: 0 }, uSun: { value: sun }, uMoon: { value: moon }, uFog: { value: fogC } },
      vertexShader: SKY_VS, fragmentShader: SKY_FS,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), m);
    this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  buildFloor() {
    const t = this.tex, g = this.group;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(FLOOR_R, 128), this.mats.floor);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
    const rm = (map, color, opacity) => new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const flat = s => new THREE.PlaneGeometry(s, s).rotateX(-Math.PI / 2);
    // central rune circle with a counter-rotating golden inner seal
    this.centerRune = new THREE.Mesh(flat(13), rm(t.rune, 0x8fd4ff, 0.8)); this.centerRune.position.y = 0.03; g.add(this.centerRune);
    this.innerRune = new THREE.Mesh(flat(6.6), rm(t.rune, 0xffc878, 0.45)); this.innerRune.position.y = 0.035; g.add(this.innerRune);
    // outer ring of runes just inside the playable edge
    this.outerRune = new THREE.Mesh(revolve([[ARENA_R - 0.35, 0], [ARENA_R - 1.85, 0]], 192, { u: 14, v: 1 / 1.5 }), rm(t.strip, 0xffb46a, 0.5));
    this.outerRune.position.y = 0.035; g.add(this.outerRune);
    // spawn pads (each wide enough for a 2v2 pair at x = ±3.5) + pillar base circles
    this.decalInfo = [
      { x: 0, y: 0.04, z: -20, s: 10.5, sp: 0.2, c: 0xffd27a }, { x: 0, y: 0.04, z: 20, s: 10.5, sp: 0.2, c: 0xff7060 },
      ...PILLARS.map(p => ({ x: p.x, y: 0.045, z: p.z, s: 7.6, sp: -0.15, c: 0x7fd8ff })),
    ];
    this.decals = new THREE.InstancedMesh(flat(1), rm(t.pad, 0xffffff, 0.65), this.decalInfo.length);
    this.decalInfo.forEach((d, i) => { this.decals.setColorAt(i, new THREE.Color(d.c)); setFlat(this.decals.instanceMatrix.array, i, d.x, d.y, d.z, 0, d.s); });
    this.decals.frustumCulled = false; g.add(this.decals);
    // fake light pools (warm under braziers, cool under pillars, team colour at the gates)
    const pools = [];
    for (const a of BRAZIER_A) pools.push([Math.sin(a) * 28.6, Math.cos(a) * 28.6, 8, 0xff8a3a, 0.5]);
    for (const p of PILLARS) pools.push([p.x, p.z, 9, 0x4ab8ff, 0.35]);
    pools.push([0, -29.3, 9, 0xffb050, 0.45], [0, 29.3, 9, 0xff5040, 0.45]);
    const pm = new THREE.MeshBasicMaterial({ map: t.pool, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const pi = new THREE.InstancedMesh(flat(1), pm, pools.length);
    pools.forEach(([x, z, s, c, k], i) => { setFlat(pi.instanceMatrix.array, i, x, 0.02, z, 0, s); pi.setColorAt(i, glowC(c, k)); });
    pi.instanceMatrix.needsUpdate = true; pi.frustumCulled = false; g.add(pi);
  }

  buildPillars() {
    const pm = this.M.pillar, mm = this.M.metal, gm = this.M.glow, glyph = this.M.glyph;
    const shaft = flutedShaft(1.6, 1.42, 6.5), r = rng(21);
    const CYAN = glowC(0x5ac8ff, 1.6);
    this.crystalPh = PILLARS.map((p, i) => i * 1.7);
    PILLARS.forEach((p, i) => {
      const P = mat4(p.x, 0, p.z, 0, Math.atan2(p.x, p.z), 0);   // local +z points away from the centre
      const at = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1, ord) => P.clone().multiply(mat4(x, y, z, rx, ry, rz, s, ord));
      // stepped octagonal plinth (footprint ≈ the 2.0 collision radius)
      pm.add(new THREE.CylinderGeometry(2.2, 2.3, 0.45, 8), at(0, 0.225, 0, 0, Math.PI / 8), 0xa09484, [2, 0.25]);
      pm.add(new THREE.CylinderGeometry(1.95, 2.05, 0.4, 8), at(0, 0.65, 0, 0, Math.PI / 8), 0xc0b4a2, [2, 0.25]);
      pm.add(new THREE.TorusGeometry(1.7, 0.17, 6, 32), at(0, 0.92, 0, Math.PI / 2), 0xd2c6b4, [3, 0.2]);
      pm.add(shaft, at(0, 4.15, 0), 0xf2e8d8, [3, 2.2]);
      // capital with carved leaves
      pm.add(new THREE.TorusGeometry(1.47, 0.15, 6, 32), at(0, 7.42, 0, Math.PI / 2), 0xd2c6b4, [3, 0.2]);
      pm.add(new THREE.CylinderGeometry(1.95, 1.45, 0.6, 16), at(0, 7.82, 0), 0xd8ccba, [3, 0.3]);
      pm.add(new THREE.CylinderGeometry(2.25, 2.25, 0.38, 8), at(0, 8.31, 0, 0, Math.PI / 8), 0xb0a492, [2, 0.2]);
      pm.add(new THREE.CylinderGeometry(1.5, 1.95, 0.32, 8), at(0, 8.66, 0, 0, Math.PI / 8), 0xc0b4a2, [2, 0.2]);
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; pm.add(new THREE.ConeGeometry(0.3, 0.8, 4), at(Math.sin(a) * 1.62, 7.7, Math.cos(a) * 1.62, 0.55, a, 0, 1, 'YXZ'), 0xd8ccba, [0.3, 0.3]); }
      // fallen rubble
      for (let k = 0; k < 3; k++) { const a = r() * TAU, d = 2.4 + r() * 0.4, s = 0.16 + r() * 0.16; pm.add(new THREE.DodecahedronGeometry(s, 0), at(Math.sin(a) * d, s * 0.5, Math.cos(a) * d, r() * 3, r() * 3, 0), 0xa89c8a, [0.1, 0.1]); }
      // gold bands and the crystal cradle
      mm.add(new THREE.TorusGeometry(1.575, 0.06, 6, 40), at(0, 1.4, 0, Math.PI / 2), GOLD);
      mm.add(new THREE.TorusGeometry(1.46, 0.055, 6, 40), at(0, 6.7, 0, Math.PI / 2), GOLD);
      mm.add(new THREE.TorusGeometry(0.8, 0.06, 6, 24), at(0, 9.35, 0, Math.PI / 2), GOLD);
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + Math.PI / 4;
        const [lg, lm] = cylBetween(v3(Math.sin(a) * 1.25, 8.8, Math.cos(a) * 1.25), v3(Math.sin(a) * 0.62, 10.0, Math.cos(a) * 0.62), 0.09, 0.03, 5);
        mm.add(lg, P.clone().multiply(lm), GOLD);
      }
      // glowing carved runes
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + Math.PI / 4;
        glyph.add(new THREE.PlaneGeometry(0.62, 2.7), at(Math.sin(a) * 1.55, 4.2, Math.cos(a) * 1.55, 0, a, 0), null, [0.25, 1, ((i + k) % 4) * 0.25, 0]);
      }
      gm.add(new THREE.TorusGeometry(1.64, 0.035, 4, 40), at(0, 1.12, 0, Math.PI / 2), CYAN);
      gm.add(new THREE.TorusGeometry(1.5, 0.03, 4, 40), at(0, 7.2, 0, Math.PI / 2), CYAN);
    });
    // floating crystals + orbiting shards (instanced, animated)
    const cg = new THREE.OctahedronGeometry(0.75, 0); cg.scale(0.7, 1.55, 0.7);
    const cm = new THREE.MeshStandardMaterial({ color: 0xaeeaff, emissive: 0x3ab8ff, emissiveIntensity: 2.0, roughness: 0.15, metalness: 0.1, flatShading: true });
    this.crystals = new THREE.InstancedMesh(cg, cm, PILLARS.length);
    const sg = new THREE.OctahedronGeometry(0.16, 0); sg.scale(0.6, 1.6, 0.6);
    this.shards = new THREE.InstancedMesh(sg, cm, PILLARS.length * 3);
    this.crystals.frustumCulled = this.shards.frustumCulled = false;
    this.group.add(this.crystals, this.shards);
    this.updateCrystals(0);
  }

  updateCrystals(t) {
    const m = this._m, q = this._q, e = this._e, v = this._v, s = this._s.set(1, 1, 1);
    PILLARS.forEach((p, i) => {
      const ph = this.crystalPh[i], y = 10.2 + Math.sin(t * 1.3 + ph) * 0.3;
      m.compose(v.set(p.x, y, p.z), q.setFromEuler(e.set(0, t * 0.8 + ph, 0)), s);
      this.crystals.setMatrixAt(i, m);
      for (let k = 0; k < 3; k++) {
        const a = t * 1.1 + ph + k * TAU / 3;
        m.compose(v.set(p.x + Math.sin(a) * 1.25, y + Math.sin(t * 2 + k * 2) * 0.35, p.z + Math.cos(a) * 1.25), q.setFromEuler(e.set(0, a, 0.3)), s);
        this.shards.setMatrixAt(i * 3 + k, m);
      }
    });
    this.crystals.instanceMatrix.needsUpdate = true;
    this.shards.instanceMatrix.needsUpdate = true;
  }

  buildWalls() {
    const near = this.M.near, metal = this.M.metal;
    // one profile from the top of the stands down to the arena floor (inward/upward faces)
    const SEAT = 0xe4d9c8, RISER = 0xb3a795, COPE = 0xf0e6d6, WALL = 0xd8ccba, PLINTH = 0x9a8e7e;
    const prof = [[ARC_R + 1.0, STAND_TOP]], cols = [];
    for (let i = TIERS - 1; i >= 0; i--) {
      const y = TIER_Y0 + i * TIER_H, ro = TIER_R + (i + 1) * TIER_W, ri = TIER_R + i * TIER_W;
      prof.push([ro, y]); cols.push(i === TIERS - 1 ? SEAT : RISER);
      prof.push([ri, y]); cols.push(SEAT);
    }
    for (const [rr, y, c] of [[TIER_R, 3.4, RISER], [31.3, 3.4, COPE], [31.3, 3.0, COPE], [WALL_R, 3.0, COPE], [WALL_R, 0.6, WALL], [31.4, 0.6, PLINTH], [31.4, 0.25, PLINTH]]) { prof.push([rr, y]); cols.push(c); }
    for (const [a0, a1] of [[GATE_GAP, Math.PI - GATE_GAP], [Math.PI + GATE_GAP, TAU - GATE_GAP]]) near.add(revolve(prof, 120, { a0, a1, uw: 0.28, v: 0.28, colors: cols }));
    // raised walkway the braziers stand on
    near.add(revolve([[31.42, 0.25], [WALK_R, 0.25], [WALK_R, 0]], 200, { uw: 0.3, v: 0.3, colors: [0xb8ac9a, 0x8f8474] }));
    // pilasters with bronze/iron shields along the inner wall
    const NP = 32;
    for (let k = 0; k < NP; k++) {
      const a = (k + 0.5) / NP * TAU;
      if (angDist(a, 0) < 0.3 || angDist(a, Math.PI) < 0.3 || DIAG.some(d => angDist(a, d) < 0.12)) continue;
      const R = mat4(0, 0, 0, 0, a, 0), at = (x, y, z, rx = 0) => R.clone().multiply(mat4(x, y, z, rx));
      near.add(new THREE.BoxGeometry(1.1, 0.3, 0.65), at(0, 0.4, 31.27), PLINTH, [0.28, 0.28]);
      near.add(new THREE.BoxGeometry(0.9, 3.3, 0.5), at(0, 1.9, 31.28), WALL, [0.28, 0.28]);
      near.add(new THREE.BoxGeometry(1.15, 0.22, 0.72), at(0, 3.56, 31.25), COPE, [0.28, 0.28]);
      metal.add(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 14), at(0, 2.35, 30.99, Math.PI / 2), k % 2 ? GOLD : IRON);
      metal.add(new THREE.SphereGeometry(0.1, 8, 6), at(0, 2.35, 30.93), GOLD);
    }
  }

  buildGates() {
    const near = this.M.near, metal = this.M.metal, plain = this.M.plain, glow = this.M.glow;
    const facade = new THREE.Shape();
    facade.moveTo(-5.4, 0); facade.lineTo(-2.2, 0); facade.lineTo(-2.2, 4.6); facade.absarc(0, 4.6, 2.2, Math.PI, 0, true);
    facade.lineTo(2.2, 0); facade.lineTo(5.4, 0); facade.lineTo(5.4, 10.4); facade.lineTo(-5.4, 10.4); facade.closePath();
    const fGeo = new THREE.ExtrudeGeometry(facade, { depth: 2.4, bevelEnabled: false, curveSegments: 12 });
    const portal = new THREE.Shape();
    portal.moveTo(-2.2, 0); portal.lineTo(2.2, 0); portal.lineTo(2.2, 4.6); portal.absarc(0, 4.6, 2.2, 0, Math.PI, false); portal.closePath();
    const pGeo = new THREE.ShapeGeometry(portal, 12);
    for (const side of [-1, 1]) {
      const G = mat4(0, 0, 0, 0, side > 0 ? 0 : Math.PI, 0);
      const at = (x, y, z, rx = 0, ry = 0, rz = 0) => G.clone().multiply(mat4(x, y, z, rx, ry, rz));
      const team = side < 0 ? 0xffb050 : 0xff5a4a;
      near.add(fGeo, at(0, 0, 31.2), 0xe8dccb, [0.28, 0.28]);
      near.add(new THREE.BoxGeometry(10.8, 10, 8.8), at(0, 5, 38.0), 0xc0b4a2, [0.28, 0.28]);
      near.add(new THREE.BoxGeometry(4.6, 7.2, 0.3), at(0, 3.6, 33.55), 0x2a2220, [0.28, 0.28]);
      near.add(new THREE.BoxGeometry(4.6, 0.3, 2.6), at(0, 0.1, 32.3), 0x8a7e70, [0.28, 0.28]);
      for (let k = 0; k < 9; k++) near.add(new THREE.BoxGeometry(0.72, 0.85, 0.7), at(-5.0 + k * 1.25, 10.82, 31.55), 0xe0d4c2, [0.28, 0.28]);
      // flanking towers with slate roofs
      for (const s of [-1, 1]) {
        const tx = s * 6.6, tz = 32.7;
        near.add(new THREE.CylinderGeometry(1.95, 2.2, 12.6, 14), at(tx, 6.3, tz), 0xe0d4c2, [3.9, 3.5]);
        near.add(new THREE.CylinderGeometry(2.4, 1.95, 0.7, 14), at(tx, 12.95, tz), 0xc8bcaa, [4, 0.2]);
        for (let m = 0; m < 8; m++) { const a = m / 8 * TAU; near.add(new THREE.BoxGeometry(0.62, 0.75, 0.42), at(tx + Math.sin(a) * 2.15, 13.67, tz + Math.cos(a) * 2.15, 0, a, 0), 0xe0d4c2, [0.28, 0.28]); }
        plain.add(new THREE.ConeGeometry(2.65, 5.2, 14), at(tx, 15.9, tz), ROOF);
        metal.add(new THREE.SphereGeometry(0.22, 8, 6), at(tx, 18.7, tz), GOLD);
        metal.add(new THREE.ConeGeometry(0.1, 1.3, 6), at(tx, 19.4, tz), GOLD);
        for (const wy of [5.2, 9.6]) glow.add(new THREE.PlaneGeometry(0.32, 1.25), at(tx, wy, tz - (2.2 - 0.25 * wy / 12.6) - 0.05), glowC(0xffa040, 1.6));
      }
      // portcullis, glowing portal, crest
      for (let k = 0; k < 9; k++) { const x = -2.0 + k * 0.5, h = 4.6 + Math.sqrt(Math.max(0, 2.2 * 2.2 - x * x)) - 0.1; metal.add(new THREE.BoxGeometry(0.1, h, 0.1), at(x, h / 2, 32.75), IRON); }
      for (const y of [1.4, 2.9, 4.4]) metal.add(new THREE.BoxGeometry(4.4, 0.1, 0.1), at(0, y, 32.75), IRON);
      glow.add(gradientGeo(pGeo, team, 1.4, 0.05, 0, 6.8), at(0, 0.02, 32.25));
      metal.add(new THREE.CylinderGeometry(0.95, 0.95, 0.2, 18), at(0, 8.55, 31.12, Math.PI / 2), GOLD);
      glow.add(new THREE.OctahedronGeometry(0.38, 0), at(0, 8.55, 30.95), glowC(team, 2.0));
      // wall torches either side of the arch
      for (const s of [-1, 1]) {
        metal.add(new THREE.ConeGeometry(0.22, 0.5, 6), at(s * 3.4, 5.15, 31.0, Math.PI), IRON);
        const fp = new THREE.Vector3(s * 3.4, 5.4, 30.95).applyMatrix4(G);
        this.flameSrc.push({ x: fp.x, y: fp.y, z: fp.z, s: 0.5 });
      }
    }
  }

  buildStatues() {
    const near = this.M.near, glow = this.M.glow;
    const eyes = [0x8fd8ff, 0xffb050, 0xff6a5a, 0x9be36a];
    const dia = new THREE.Shape(); dia.moveTo(0, 0.6); dia.lineTo(0.42, 0); dia.lineTo(0, -0.6); dia.lineTo(-0.42, 0); dia.closePath();
    const diaGeo = new THREE.ShapeGeometry(dia);
    DIAG.forEach((a, i) => {
      const R = mat4(0, 0, 0, 0, a, 0), at = (x, y, z) => R.clone().multiply(mat4(x, y, z));
      near.add(new THREE.BoxGeometry(3.9, 0.45, 3.5), at(0, 0.48, 32.8), 0xb3a795, [0.28, 0.28]);
      near.add(new THREE.BoxGeometry(3.4, 4.2, 3.0), at(0, 2.8, 32.8), 0xd8ccba, [0.28, 0.28]);
      near.add(new THREE.BoxGeometry(3.9, 0.4, 3.5), at(0, 5.0, 32.8), 0xc8bcaa, [0.28, 0.28]);
      glow.add(diaGeo, at(0, 2.9, 31.27), glowC(eyes[i % 4], 1.0));
      addStatue(near, glow, R.clone().multiply(mat4(0, 5.2, 32.7, 0, Math.PI, 0, 1.2)), i, eyes[i % 4]);
    });
  }

  buildBraziers() {
    const metal = this.M.metal, glow = this.M.glow;
    const bowlOut = revolve([[0.14, 1.72], [0.5, 1.9], [0.82, 2.28], [0.9, 2.52]], 16);
    const bowlIn = revolve([[0.84, 2.52], [0.5, 2.05], [0.2, 1.95]], 16);
    const coal = new THREE.CircleGeometry(0.8, 14).rotateX(-Math.PI / 2);
    BRAZIER_A.forEach((a, i) => {
      const x = Math.sin(a) * BRAZ_R, z = Math.cos(a) * BRAZ_R;
      const B = mat4(x, 0.25, z, 0, a, 0), at = (px, py, pz, rx = 0) => B.clone().multiply(mat4(px, py, pz, rx));
      metal.add(new THREE.CylinderGeometry(0.55, 0.68, 0.2, 8), at(0, 0.1, 0), IRON);
      metal.add(new THREE.CylinderGeometry(0.11, 0.17, 1.65, 8), at(0, 0.95, 0), IRON);
      metal.add(new THREE.TorusGeometry(0.2, 0.055, 6, 12), at(0, 1.25, 0, Math.PI / 2), GOLD);
      for (let k = 0; k < 3; k++) {
        const b = k / 3 * TAU;
        const [lg, lm] = cylBetween(v3(Math.sin(b) * 0.52, 0.12, Math.cos(b) * 0.52), v3(Math.sin(b) * 0.22, 1.8, Math.cos(b) * 0.22), 0.06, 0.045, 5);
        metal.add(lg, B.clone().multiply(lm), IRON);
      }
      metal.add(bowlOut, at(0, 0, 0), IRON); metal.add(bowlIn, at(0, 0, 0), IRON2);
      metal.add(new THREE.TorusGeometry(0.88, 0.075, 6, 24), at(0, 2.52, 0, Math.PI / 2), GOLD);
      for (let k = 0; k < 6; k++) { const b = k / 6 * TAU; metal.add(new THREE.ConeGeometry(0.07, 0.4, 5), at(Math.sin(b) * 0.92, 2.72, Math.cos(b) * 0.92), GOLD); }
      glow.add(coal, at(0, 2.42, 0), glowC(0xff5a10, 1.4));
      this.flameSrc.push({ x, y: 2.7, z, s: 1 });
      this.flames.push({ x, y: 2.8, z });
      if (i % 2 === 0 && this.lights.length < 4) {
        const L = new THREE.PointLight(0xff8a3a, 30, 20, 1.8); L.position.set(x * 0.95, 3.6, z * 0.95);
        this.group.add(L); this.lights.push(L);
      }
    });
  }

  buildArcade() {
    const far = this.M.far, half = TAU / ARC_BAYS / 2, hw = ARC_R * Math.sin(half) + 0.06;
    const bay = new THREE.Shape();
    bay.moveTo(-hw, 0); bay.lineTo(hw, 0); bay.lineTo(hw, 8.4); bay.lineTo(-hw, 8.4); bay.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-3.3, 0.55); hole.lineTo(3.3, 0.55); hole.lineTo(3.3, 4.3); hole.absarc(0, 4.3, 3.3, 0, Math.PI, false); hole.closePath();
    bay.holes.push(hole);
    const bayGeo = new THREE.ExtrudeGeometry(bay, { depth: 1.2, bevelEnabled: false, curveSegments: 10 });
    const B = STAND_TOP, UV = [0.28, 0.28];
    for (let k = 0; k < ARC_BAYS; k++) {
      const a = (k + 0.5) / ARC_BAYS * TAU, ap = k / ARC_BAYS * TAU;
      far.add(bayGeo, mat4(0, 0, 0, 0, a, 0).multiply(mat4(0, B, ARC_R - 0.6)), 0xd8ccba, UV);
      const R = mat4(0, 0, 0, 0, ap, 0);
      far.add(new THREE.BoxGeometry(1.0, 9.8, 1.9), R.clone().multiply(mat4(0, B + 4.9, ARC_R)), 0xc8bcaa, UV);
      far.add(new THREE.BoxGeometry(1.3, 1.1, 1.3), R.clone().multiply(mat4(0, B + 10.35, ARC_R)), 0xd8ccba, UV);
      far.add(new THREE.ConeGeometry(0.95, 2.2, 4), R.clone().multiply(mat4(0, B + 12.0, ARC_R, 0, Math.PI / 4, 0)), 0xc8bcaa, [0.2, 0.2]);
      for (const off of [-0.45, 0.45]) far.add(new THREE.BoxGeometry(1.2, 0.75, 1.0), mat4(0, 0, 0, 0, a + off * half, 0).multiply(mat4(0, B + 9.73, ARC_R)), 0xd8ccba, UV);
    }
    far.add(revolve([[ARC_R + 0.75, B + 8.35], [ARC_R + 0.75, B + 9.35], [ARC_R - 0.75, B + 9.35], [ARC_R - 0.75, B + 8.35], [ARC_R + 0.75, B + 8.35]], 120, { uw: 0.28, v: 0.28, colors: [0xc8bcaa, 0xe0d4c2, 0xc8bcaa, 0x9a8e7e] }));
  }

  buildBanners() {
    const SX = 4, SY = 10, pos = [], uvs = [], idx = [], par = [];
    let vi = 0, bi = 0;
    for (let k = 1; k < ARC_BAYS; k += 3) {
      const a = k / ARC_BAYS * TAU, col = bi % 5, th = a + Math.PI, ct = Math.cos(th), st = Math.sin(th);
      const cx = Math.sin(a) * BAN_R, cz = Math.cos(a) * BAN_R;
      for (let iy = 0; iy <= SY; iy++) for (let ix = 0; ix <= SX; ix++) {
        const lx = (ix / SX - 0.5) * BAN_W, ly = -iy / SY * BAN_H;
        pos.push(cx + lx * ct, BAN_TOP + ly, cz - lx * st);
        uvs.push((col + ix / SX) / 5, 1 - iy / SY);
        par.push(-Math.sin(a), -Math.cos(a), iy / SY, a * 3.0, lx, ly);
      }
      for (let iy = 0; iy < SY; iy++) for (let ix = 0; ix < SX; ix++) {
        const p = vi + iy * (SX + 1) + ix, q = p + SX + 1;
        idx.push(p, q, p + 1, p + 1, q, q + 1);
      }
      vi += (SX + 1) * (SY + 1); bi++;
      const P = mat4(0, 0, 0, 0, a, 0);
      this.M.metal.add(new THREE.CylinderGeometry(0.05, 0.05, BAN_W + 0.4, 6), P.clone().multiply(mat4(0, BAN_TOP + 0.08, BAN_R - 0.05, 0, 0, Math.PI / 2)), GOLD);
      for (const s of [-1, 1]) this.M.metal.add(new THREE.SphereGeometry(0.1, 6, 4), P.clone().multiply(mat4(s * (BAN_W / 2 + 0.22), BAN_TOP + 0.08, BAN_R - 0.05)), GOLD);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    this.banBase = new Float32Array(pos); this.banPar = new Float32Array(par);
    this.banners = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.tex.banners, side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.85 }));
    this.banners.frustumCulled = false;
    this.group.add(this.banners);
  }

  buildCrowd() {
    const N = this.Q.crowd;
    const body = new Merger();
    body.add(new THREE.CylinderGeometry(0.19, 0.3, 0.78, 6), mat4(0, 0.39, 0));
    body.add(new THREE.SphereGeometry(0.26, 6, 3, 0, TAU, 0, Math.PI / 2), mat4(0, 0.76, 0, 0, 0, 0, [1.1, 0.5, 0.9]));
    for (const s of [-1, 1]) body.add(new THREE.BoxGeometry(0.11, 0.5, 0.11), mat4(s * 0.3, 0.98, -0.02, 0, 0, -s * 0.45));
    const headGeo = new THREE.SphereGeometry(0.155, 7, 5).translate(0, 0.99, 0);
    this.crowd = new THREE.InstancedMesh(body.build(), new THREE.MeshLambertMaterial(), N);
    this.crowdHeads = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial(), N);
    this.crowdHeads.instanceMatrix = this.crowd.instanceMatrix;   // shared: one update moves both
    const BODY = [0x7a2020, 0x203a7a, 0x3a5a24, 0x5a3a7a, 0x8a6a24, 0x3a3a40, 0x6a4a2a, 0x24585a, 0x9a8a6a, 0x8a3a1a];
    const SKIN = [0xe0b090, 0xc68e64, 0x8d5a3b, 0xf1c9a5, 0x6b8f4a, 0x7a6aa8, 0x9a7a5a, 0xb0b8c8, 0x4a4048];
    const r = rng(42), m = new THREE.Matrix4(), sv = new THREE.Vector3(), col = new THREE.Color();
    this.cBaseY = new Float32Array(N); this.cPh = new Float32Array(N); this.cAmp = new Float32Array(N); this.cSp = new Float32Array(N);
    let i = 0, guard = 0;
    while (i < N && guard++ < N * 20) {
      const tier = Math.floor(r() * TIERS), a = r() * TAU, rr = TIER_R + tier * TIER_W + 0.45 + r() * 0.6;
      const tg = Math.min(angDist(a, 0), angDist(a, Math.PI)) * rr;
      if (tg < (rr < 35.5 ? 9.0 : 5.9)) continue;                      // gatehouses
      if (rr < 35.2 && DIAG.some(d => angDist(a, d) * rr < 2.3)) continue; // statue plinths
      const y = TIER_Y0 + tier * TIER_H, s = 0.9 + r() * 0.25;
      m.makeRotationY(a + (r() - 0.5) * 0.5); m.scale(sv.set(s, s, s)); m.setPosition(Math.sin(a) * rr, y, Math.cos(a) * rr);
      this.crowd.setMatrixAt(i, m);
      this.cBaseY[i] = y; this.cPh[i] = r() * 10; this.cAmp[i] = 0.04 + r() * 0.14; this.cSp[i] = 2 + r() * 4;
      this.crowd.setColorAt(i, col.set(BODY[Math.floor(r() * BODY.length)]).multiplyScalar(0.7 + r() * 0.5));
      this.crowdHeads.setColorAt(i, col.set(SKIN[Math.floor(r() * SKIN.length)]).multiplyScalar(0.85 + r() * 0.3));
      i++;
    }
    this.crowd.count = this.crowdHeads.count = i;
    this.crowd.frustumCulled = this.crowdHeads.frustumCulled = false;
    this.group.add(this.crowd, this.crowdHeads);
    this.updateCrowd(0);
  }

  updateCrowd(t) {
    const arr = this.crowd.instanceMatrix.array, n = this.crowd.count, hype = this.crowdHype, k = 1 + hype, ha = hype * 0.35;
    const by = this.cBaseY, ph = this.cPh, amp = this.cAmp, sp = this.cSp;
    for (let i = 0; i < n; i++) { const s = Math.sin(t * sp[i] * k + ph[i]); arr[i * 16 + 13] = by[i] + (s > 0 ? s * (amp[i] + ha) : 0); }
    this.crowd.instanceMatrix.needsUpdate = true;
  }

  buildTerrain() {
    const J = 48, A = 160, n = (J + 1) * A, pos = new Float32Array(n * 3);
    for (let j = 0; j <= J; j++) {
      const rr = 40 + 860 * Math.pow(j / J, 1.9);
      for (let i = 0; i < A; i++) {
        const a = i / A * TAU, x = Math.sin(a) * rr, z = Math.cos(a) * rr, o = (j * A + i) * 3;
        pos[o] = x; pos[o + 1] = terrainH(x, z); pos[o + 2] = z;
      }
    }
    const idx = [];
    for (let j = 0; j < J; j++) for (let i = 0; i < A; i++) {
      const a = j * A + i, b = (j + 1) * A + i, c = j * A + (i + 1) % A, d = (j + 1) * A + (i + 1) % A;
      idx.push(a, b, c, c, b, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const nrm = geo.attributes.normal, cols = new Float32Array(n * 3), c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2], rr = Math.hypot(x, z), ny = nrm.getY(k);
      const n1 = fbm2(x * 0.018, z * 0.018, 41, 3), n2 = fbm2(x * 0.06, z * 0.06, 43, 2);
      let R = 0.20, G = 0.28, B = 0.12;
      const gl = smooth(0.35, 0.68, n1); R += 0.14 * gl; G += 0.13 * gl; B += 0.03 * gl;
      const gold = smooth(0.55, 0.75, n2) * 0.7; R = lerp(R, 0.55, gold); G = lerp(G, 0.45, gold); B = lerp(B, 0.17, gold);
      const rock = Math.max(1 - smooth(0.72, 0.9, ny), smooth(40, 70, y) * 0.6); R = lerp(R, 0.38, rock); G = lerp(G, 0.35, rock); B = lerp(B, 0.39, rock);
      const dirt = Math.max(1 - smooth(46, 60, rr), (1 - smooth(4, 9, Math.abs(x))) * (1 - smooth(120, 170, rr)));
      R = lerp(R, 0.36, dirt); G = lerp(G, 0.29, dirt); B = lerp(B, 0.21, dirt);
      c.setRGB(R, G, B, THREE.SRGBColorSpace);
      cols[k * 3] = c.r; cols[k * 3 + 1] = c.g; cols[k * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.group.add(new THREE.Mesh(geo, this.mats.scenery));
  }

  buildTrees() {
    const Q = this.Q, r = rng(1234);
    const pine = new Merger(); addPine(pine, null);
    const oak = new Merger();
    oak.add(new THREE.CylinderGeometry(0.28, 0.42, 3.0, 6), mat4(0, 1.5, 0), 0x6a4a32);
    oak.add(new THREE.IcosahedronGeometry(2.2, 0), mat4(0, 4.3, 0));
    oak.add(new THREE.IcosahedronGeometry(1.6, 0), mat4(1.3, 3.7, 0.5), 0xf0f0f0);
    oak.add(new THREE.IcosahedronGeometry(1.5, 0), mat4(-1.1, 3.9, -0.6), 0xe8e8e8);
    const rock = new Merger(); rock.add(new THREE.DodecahedronGeometry(1, 0));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const place = (geo, n, minR, maxR, sMin, sMax, flatY, colorFn, clump) => {
      const mesh = new THREE.InstancedMesh(geo, this.mats.sceneryFlat, Math.max(1, n));
      const c = new THREE.Color();
      let i = 0, tries = 0;
      while (i < n && tries++ < n * 30) {
        const a = r() * TAU, rr = minR + (maxR - minR) * Math.pow(r(), 0.8), x = Math.sin(a) * rr, z = Math.cos(a) * rr;
        if (Math.abs(x) < 14 && rr < 170) continue;   // keep the roads to the gates open
        const h = terrainH(x, z);
        if (Math.abs(terrainH(x + 2, z) - h) + Math.abs(terrainH(x, z + 2) - h) > 2.2) continue;
        if (clump && fbm2(x * 0.02, z * 0.02, 99, 2) < 0.45 && r() < 0.75) continue;
        const sc = sMin + (sMax - sMin) * r();
        m.compose(p.set(x, h - 0.3, z), q.setFromEuler(e.set((r() - 0.5) * 0.1, r() * TAU, (r() - 0.5) * 0.1)), flatY ? s.set(sc * (0.7 + r() * 0.8), sc * (0.4 + r() * 0.5), sc * (0.7 + r() * 0.8)) : s.set(sc, sc * (0.85 + r() * 0.3), sc));
        mesh.setMatrixAt(i, m); mesh.setColorAt(i, colorFn(c)); i++;
      }
      mesh.count = i;
      if (i > 0) this.group.add(mesh);
      return mesh;
    };
    place(pine.build(), Q.pines, 55, 420, 1.0, 2.6, false, c => c.setRGB(0.8 + r() * 0.35, 0.85 + r() * 0.3, 0.8 + r() * 0.3), true);
    const AUT = [0xe0a030, 0xd87020, 0xc84a28, 0xe8c050, 0xa8b040];
    place(oak.build(), Q.oaks, 55, 300, 0.9, 1.9, false, c => c.set(AUT[Math.floor(r() * AUT.length)]).multiplyScalar(0.75 + r() * 0.35), true);
    place(rock.build(), Q.rocks, 46, 320, 1.0, 3.5, true, c => c.setRGB(0.42, 0.4, 0.45).multiplyScalar(0.7 + r() * 0.5), false);
  }

  buildMountains() {
    const M = this.M.mountains, r = rng(99), c = new THREE.Color();
    const rings = [{ n: 20, d: 430, dv: 90, h: 90, hv: 90, w: 120, wv: 70, tone: 1.0 }, { n: 15, d: 660, dv: 120, h: 200, hv: 140, w: 180, wv: 90, tone: 0.8 }];
    rings.forEach((R, ri) => {
      for (let i = 0; i < R.n; i++) {
        const a = (i / R.n) * TAU + r() * 0.25 + ri * 0.17;
        const dist = R.d + r() * R.dv, h = R.h + r() * R.hv, w = R.w + r() * R.wv, seed = Math.floor(r() * 1000);
        const geo = new THREE.ConeGeometry(w, h, 10, 6), p = geo.attributes.position;
        for (let k = 0; k < p.count; k++) {
          const x = p.getX(k), y = p.getY(k), z = p.getZ(k), hn = (y + h / 2) / h;
          if (hn > 0.999) continue;
          const ang = Math.atan2(x, z), sa = Math.sin(ang), ca = Math.cos(ang);
          const f = 0.75 + fbm2(sa * 1.5 + hn * 2.0 + 5, ca * 1.5 + hn * 1.3, seed, 3) * 0.55;
          p.setXYZ(k, x * f, y + (fbm2(sa * 3 + 2, ca * 3 + hn * 5, seed + 7, 2) - 0.5) * h * 0.12 * (1 - hn), z * f);
        }
        const cols = new Float32Array(p.count * 3), snow = 0.58 + r() * 0.12;
        for (let k = 0; k < p.count; k++) {
          const hn = (p.getY(k) + h / 2) / h, nn = fbm2(p.getX(k) * 0.02, p.getZ(k) * 0.02, seed + 3, 2);
          if (hn > snow + (nn - 0.5) * 0.2) c.setRGB(0.86, 0.87, 0.95, THREE.SRGBColorSpace);
          else { const t = hn / snow; c.setRGB(0.20 + t * 0.12, 0.17 + t * 0.1, 0.24 + t * 0.12, THREE.SRGBColorSpace); }
          c.multiplyScalar(R.tone);
          cols[k * 3] = c.r; cols[k * 3 + 1] = c.g; cols[k * 3 + 2] = c.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        M.add(geo, mat4(Math.sin(a) * dist, h / 2 - 25, Math.cos(a) * dist, 0, r() * TAU, 0));
      }
    });
  }

  buildCastle() {
    const M = this.M.castle, G = this.M.glow;
    const az = Math.atan2(this.sunDir.x, this.sunDir.z) - 0.45, dist = 360;
    const C = mat4(Math.sin(az) * dist, 0, Math.cos(az) * dist, 0, az + Math.PI, 0);   // local +z faces the arena
    const at = (x, y, z, rx = 0, ry = 0, rz = 0) => C.clone().multiply(mat4(x, y, z, rx, ry, rz));
    const WALL = 0x6a6070, DARK = 0x3a3442, CROOF = 0x2a3a6a, ROCK = 0x3a3238, top = 50;
    M.add(jitter(new THREE.CylinderGeometry(40, 72, 110, 9, 3), 0.35, 31), at(0, -5, 0), ROCK);
    M.add(revolve([[30, top - 2], [30, top + 12]], 10), at(0, 0, 0), WALL);
    for (let k = 0; k < 20; k++) { const a = k / 20 * TAU; M.add(new THREE.BoxGeometry(3, 2.4, 2), at(Math.sin(a) * 30, top + 13, Math.cos(a) * 30, 0, a, 0), WALL); }
    M.add(new THREE.BoxGeometry(18, 48, 18), at(0, top + 24, -4), WALL);
    M.add(new THREE.ConeGeometry(14.5, 20, 4), at(0, top + 58, -4, 0, Math.PI / 4, 0), CROOF);
    const towers = [[-24, 6, 5.5, 36], [24, 8, 5.5, 40], [-15, -20, 5, 32], [17, -18, 5, 34], [6, 24, 4.5, 26], [-6, 20, 4.2, 30], [-3, -8, 3.6, 66]];
    for (const [x, z, rr, h] of towers) {
      M.add(new THREE.CylinderGeometry(rr * 0.9, rr, h, 10), at(x, top + h / 2, z), WALL);
      M.add(new THREE.CylinderGeometry(rr * 1.18, rr * 0.9, 2.2, 10), at(x, top + h + 1.1, z), DARK);
      M.add(new THREE.ConeGeometry(rr * 1.3, h * 0.5, 10), at(x, top + h + 2.2 + h * 0.25, z), CROOF);
      for (let k = 0; k < 3; k++) G.add(new THREE.PlaneGeometry(1.4, 2.6), at(x, top + h * (0.35 + k * 0.2), z + rr * 0.95 + 0.25), glowC(0xffa050, 2.4));
    }
    for (let k = 0; k < 8; k++) G.add(new THREE.PlaneGeometry(1.6, 3), at(-6 + (k % 4) * 4, top + 20 + Math.floor(k / 4) * 12, 5.1), glowC(0xffb060, 2.2));
  }

  buildIslands() {
    const r = rng(555), isl = new Merger();
    const rock = new THREE.ConeGeometry(10, 20, 8, 3); rock.rotateX(Math.PI); rock.translate(0, -10, 0); jitter(rock, 0.4, 61, 0.12);
    isl.add(rock, null, 0x4a3e44);
    isl.add(new THREE.CylinderGeometry(10.4, 10, 1.4, 8), mat4(0, 0.5, 0), 0x3f6a2e);
    addPine(isl, mat4(3, 1, 2, 0, 0, 0, 0.6));
    addPine(isl, mat4(-4, 1, -1, 0, 1, 0, 0.5));
    isl.add(new THREE.CylinderGeometry(0.7, 0.8, 4, 8), mat4(-2, 2.7, -4), 0xb8b0a4);
    const n = 5;
    this.islands = new THREE.InstancedMesh(isl.build(), this.mats.sceneryFlat, n);
    const cg = new THREE.OctahedronGeometry(2.4, 0); cg.scale(1, 2.2, 1); cg.translate(0, 8, 0);
    this.islandCrystals = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: 0xc8b0ff, emissive: 0x7a5aff, emissiveIntensity: 1.6, flatShading: true, roughness: 0.2 }), n);
    this.islandCrystals.instanceMatrix = this.islands.instanceMatrix;
    this.islandData = [];
    for (let i = 0; i < n; i++) { const a = r() * TAU, d = 190 + r() * 130; this.islandData.push({ x: Math.sin(a) * d, y: 85 + r() * 70, z: Math.cos(a) * d, s: 0.6 + r() * 0.6, ph: r() * 6, rot: r() * TAU }); }
    this.islands.frustumCulled = this.islandCrystals.frustumCulled = false;
    this.group.add(this.islands, this.islandCrystals);
    this.updateIslands(0);
  }

  updateIslands(t) {
    const m = this._m, q = this._q, e = this._e, v = this._v, s = this._s;
    this.islandData.forEach((d, i) => {
      m.compose(v.set(d.x, d.y + Math.sin(t * 0.3 + d.ph) * 3, d.z), q.setFromEuler(e.set(0, d.rot + t * 0.02, 0)), s.set(d.s, d.s, d.s));
      this.islands.setMatrixAt(i, m);
    });
    this.islands.instanceMatrix.needsUpdate = true;
  }

  finalize() {
    const M = this.M, m = this.mats;
    const add = (merger, mat, cast, recv) => {
      const geo = merger.build(); if (!geo) return null;
      const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = cast; mesh.receiveShadow = recv;
      this.group.add(mesh); return mesh;
    };
    add(M.near, m.stone, true, true);
    add(M.far, m.stone, false, false);
    add(M.pillar, m.pillar, true, true);
    add(M.metal, m.metal, true, true);
    add(M.plain, m.plain, true, true);
    add(M.glyph, this.glyphMat, false, false);
    add(M.glow, m.glow, false, false);
    add(M.castle, m.sceneryFlat, false, false);
    add(M.mountains, m.sceneryFlat, false, false);
    this.M = null;   // release the part lists
  }

  // ------------------------------------------------------------------ atmosphere
  buildFlames() {
    const src = this.flameSrc, N = src.length * 3;
    const pos = new Float32Array(N * 12), uv = new Float32Array(N * 8), seed = new Float32Array(N * 4), idx = [];
    let v = 0;
    src.forEach((f, i) => {
      const w = 1.3 * f.s, h = 2.3 * f.s;
      for (let k = 0; k < 3; k++) {
        const a = k * Math.PI / 3, cx = Math.cos(a) * w / 2, cz = Math.sin(a) * w / 2;
        for (const [sx, sy] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
          pos[v * 3] = f.x + cx * sx; pos[v * 3 + 1] = f.y + sy * h; pos[v * 3 + 2] = f.z + cz * sx;
          uv[v * 2] = (sx + 1) / 2; uv[v * 2 + 1] = sy; seed[v] = i * 1.37 + k * 0.31; v++;
        }
        const b = v - 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setIndex(idx);
    this.flameMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uBoost: { value: 1 } }, vertexShader: FLAME_VS, fragmentShader: FLAME_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    const mesh = new THREE.Mesh(geo, this.flameMat); mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  buildMotes() {
    const r = rng(77), list = [], N = this.Q.motes;
    for (let i = 0; i < N; i++) {
      const k = r();
      // [x, y, z, vy, sway, bob, size, phase, H, alpha, r, g, b]
      if (k < 0.5) { // golden dust drifting up through the arena
        const a = r() * TAU, rr = Math.sqrt(r()) * 30;
        list.push([Math.sin(a) * rr, 0, Math.cos(a) * rr, 0.12 + r() * 0.3, 0.6 + r() * 0.8, 0, 0.12 + r() * 0.12, r() * 50, 16, 0.7, 1.0, 0.78, 0.42]);
      } else if (k < 0.7) { // arcane wisps around the pillars
        const p = PILLARS[Math.floor(r() * PILLARS.length)], a = r() * TAU, rr = 2.4 + r() * 2.5;
        list.push([p.x + Math.sin(a) * rr, 0, p.z + Math.cos(a) * rr, 0.25 + r() * 0.5, 0.4, 0, 0.12 + r() * 0.1, r() * 50, 11, 0.9, 0.45, 0.85, 1.0]);
      } else if (k < 0.85 && this.flames.length) { // embers above the braziers
        const f = this.flames[Math.floor(r() * this.flames.length)];
        list.push([f.x + (r() - 0.5) * 0.8, f.y + 0.5, f.z + (r() - 0.5) * 0.8, 0.9 + r() * 1.2, 0.35, 0, 0.08 + r() * 0.07, r() * 50, 7 + r() * 4, 1.0, 1.0, 0.5, 0.15]);
      } else { // glowing petals falling across the bowl
        const a = r() * TAU, rr = Math.sqrt(r()) * 45;
        list.push([Math.sin(a) * rr, 0, Math.cos(a) * rr, -(0.5 + r() * 0.7), 1.6, 0, 0.13 + r() * 0.08, r() * 50, 22, 0.55, 1.0, 0.62, 0.22]);
      }
    }
    // crystal halos (bob in sync with the crystals)
    PILLARS.forEach((p, i) => list.push([p.x, 10.2, p.z, 0, 0, 0.3, 4.6, this.crystalPh[i], 1, 0.55, 0.35, 0.75, 1.0]));
    const n = list.length, pos = new Float32Array(n * 3), mv = new Float32Array(n * 4), misc = new Float32Array(n * 3), col = new Float32Array(n * 3);
    list.forEach((d, i) => {
      pos.set([d[0], d[1], d[2]], i * 3); mv.set([d[3], d[4], d[5], d[6]], i * 4);
      misc.set([d[7], d[8], d[9]], i * 3); col.set([d[10], d[11], d[12]], i * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aMove', new THREE.BufferAttribute(mv, 4));
    geo.setAttribute('aMisc', new THREE.BufferAttribute(misc, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    this.moteMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 800 } }, vertexShader: MOTE_VS, fragmentShader: MOTE_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.motes = new THREE.Points(geo, this.moteMat); this.motes.frustumCulled = false;
    this.group.add(this.motes);
  }

  buildMist() {
    // [inner, outer, height, noise scale, brightness, alpha]
    const rings = [[60, 700, 7, 0.0045, 0.9, 0.55], [160, 900, 26, 0.0025, 0.8, 0.45], [25.5, 31.4, 0.45, 0.06, 2.2, 0.28]];
    const geos = rings.map(([ri, ro, y, sc, br, al]) => {
      const g = new THREE.RingGeometry(ri, ro, 96, 8).rotateX(-Math.PI / 2).translate(0, y, 0);
      const p = g.attributes.position, A = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) {
        const t = (Math.hypot(p.getX(k), p.getZ(k)) - ri) / (ro - ri);
        const f = ri < 30 ? smooth(0, 0.5, t) : smooth(0, 0.25, t) * (1 - smooth(0.6, 1, t));
        A[k * 3] = al * f; A[k * 3 + 1] = sc; A[k * 3 + 2] = br;
      }
      g.setAttribute('aA', new THREE.BufferAttribute(A, 3));
      return g;
    });
    const geo = mergeGeometries(geos, false);
    if (!geo) return;
    this.mistMat = new THREE.ShaderMaterial({
      uniforms: { uNoise: { value: this.tex.noise }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0.2, 0.13, 0.18) } },
      vertexShader: MIST_VS, fragmentShader: MIST_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const mesh = new THREE.Mesh(geo, this.mistMat); mesh.frustumCulled = false; mesh.renderOrder = 1;
    this.group.add(mesh);
  }

  buildShafts() {
    const d = this.sunDir.clone().negate();
    if (d.y > -0.15) { d.y = -0.15; d.normalize(); }
    const az = Math.atan2(this.sunDir.x, this.sunDir.z), sy = STAND_TOP + 4.3;
    const items = [[-0.32, 3.2, 0.95], [-0.12, 2.4, 1.05], [0.1, 3.6, 0.9], [0.27, 2.6, 1.0]];
    const n = items.length, pos = new Float32Array(n * 12), corner = new Float32Array(n * 8), start = new Float32Array(n * 12), info = new Float32Array(n * 12), idx = [];
    items.forEach(([da, w, lk], i) => {
      const a = az + da, sx = Math.sin(a) * (ARC_R - 0.5), sz = Math.cos(a) * (ARC_R - 0.5), L = sy / -d.y * lk;
      [[-1, 0], [1, 0], [1, 1], [-1, 1]].forEach(([cx, cy], k) => {
        const v = i * 4 + k;
        pos.set([sx, sy, sz], v * 3); start.set([sx, sy, sz], v * 3); corner.set([cx, cy], v * 2); info.set([w, L, i * 1.9], v * 3);
      });
      const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    geo.setAttribute('aStart', new THREE.BufferAttribute(start, 3));
    geo.setAttribute('aInfo', new THREE.BufferAttribute(info, 3));
    geo.setIndex(idx);
    this.shaftMat = new THREE.ShaderMaterial({
      uniforms: { uDir: { value: d }, uTime: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.72, 0.42) }, uOpacity: { value: 0.09 } },
      vertexShader: SHAFT_VS, fragmentShader: SHAFT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    const mesh = new THREE.Mesh(geo, this.shaftMat); mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  // ------------------------------------------------------------------ per frame (O(small))
  update(dt, vfx) {
    this.time += dt; this._frame++;
    const t = this.time, hype = this.crowdHype, fog = this.scene.fog;
    const su = this.sky.material.uniforms;
    su.uTime.value = t;
    if (fog && fog.color) su.uFog.value.copy(fog.color);
    if (this.flameMat) { this.flameMat.uniforms.uTime.value = t; this.flameMat.uniforms.uBoost.value = 1 + hype * 0.5; }
    if (this.moteMat) { this.moteMat.uniforms.uTime.value = t; this.moteMat.uniforms.uScale.value = (window.innerHeight || 900) * Math.min(window.devicePixelRatio || 1, 1.75) * 0.866; }
    if (this.mistMat) {
      this.mistMat.uniforms.uTime.value = t;
      if (fog && fog.color) this.mistMat.uniforms.uColor.value.copy(fog.color).multiplyScalar(1.5).add(MIST_ADD);
    }
    if (this.shaftMat) this.shaftMat.uniforms.uTime.value = t;
    // runes
    this.centerRune.rotation.y = t * 0.08;
    this.centerRune.material.opacity = 0.7 + Math.sin(t * 1.5) * 0.12 + hype * 0.2;
    this.innerRune.rotation.y = -t * 0.15;
    this.outerRune.rotation.y = -t * 0.03;
    this.outerRune.material.opacity = 0.42 + Math.sin(t * 0.9) * 0.06 + hype * 0.35;
    const da = this.decals.instanceMatrix.array;
    for (let i = 0; i < this.decalInfo.length; i++) { const d = this.decalInfo[i]; setFlat(da, i, d.x, d.y, d.z, t * d.sp, d.s); }
    this.decals.instanceMatrix.needsUpdate = true;
    this.glyphMat.color.copy(GLYPH_C).multiplyScalar(1.3 + Math.sin(t * 2.0) * 0.35 + hype * 0.8);
    this.updateCrystals(t);
    this.updateIslands(t);
    for (const f of this.animated) f(t);
    for (let i = 0; i < this.lights.length; i++) this.lights[i].intensity = 26 + Math.sin(t * 13 + i) * 4 + Math.sin(t * 7.3 + i * 2) * 3 + hype * 8;
    // banner cloth ripple (≈550 vertices)
    const p = this.banners.geometry.attributes.position, pa = p.array, b = this.banBase, q = this.banPar;
    for (let i = 0, n = b.length / 3; i < n; i++) {
      const o = i * 6, w = q[o + 2];
      const dd = (Math.sin(t * 2.1 + q[o + 5] * 1.3 + q[o + 4] * 0.9 + q[o + 3]) * 0.22 + Math.sin(t * 3.3 + q[o + 5] * 2.1 + q[o + 3]) * 0.06) * w;
      pa[i * 3] = b[i * 3] + q[o] * dd; pa[i * 3 + 2] = b[i * 3 + 2] + q[o + 1] * dd;
    }
    p.needsUpdate = true;
    if ((this._frame & 1) === 0) this.updateCrowd(t);
    this.crowdHype = Math.max(0, this.crowdHype - dt * 0.4);
    // brazier sparks (the flame bodies themselves are a shader)
    if (vfx) for (const f of this.flames) if (Math.random() < dt * 9) {
      vfx.emit({ x: f.x + (Math.random() - 0.5) * 0.6, y: f.y + 0.6, z: f.z + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 0.6, vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5) * 0.6, life: 0.8 + Math.random() * 0.6, size: 0.22 + Math.random() * 0.2, color: Math.random() < 0.5 ? 0xff8a2a : 0xffc860, grow: -0.6, drag: 0.4 });
    }
  }
}
const MIST_ADD = new THREE.Color(0.03, 0.025, 0.035);
