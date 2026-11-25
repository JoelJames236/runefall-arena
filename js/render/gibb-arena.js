// GIBB arena: the gibb Lorraine square in Bern as a fight arena.
// Buildings are simplified swissBUILDINGS3D roof prisms (© swisstopo), the ground is SWISSIMAGE (© swisstopo).
// Origin = E 2600470 / N 1200485 (LV95). x = east, z = south, 1 unit = 1 m.
// Same contract as Arena: group, ready, update(dt, vfx), crowdHype, flames.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PILLARS, ARENA_R } from '../sim/sim.js';

const TAU = Math.PI * 2;
const DIR = 'assets/gibb/';
const WALL_R = ARENA_R + 2.5;
const GIBB_IDS = new Set(['C8023B86', 'F6D8F845', '9D2F2078', '8A5F26D5', '583B5E0E', '0989AED7']);
const AULA = 'F6D8F845';
const ORTHO = { x: -35, z: -46, size: 600 };
const GF_H = 4.2;

function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function tex(c, rx = 1, ry = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  return t;
}
function mergeParts(parts) {
  if (!parts.length) return null;
  const norm = [];
  for (const raw of parts) {
    const g = raw.index ? raw.toNonIndexed() : raw.clone();
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    norm.push(g);
    raw.dispose();
  }
  const merged = mergeGeometries(norm, false);
  for (const g of norm) g.dispose();
  if (merged) merged.computeBoundingSphere();
  return merged;
}

// ------------------------------------------------------------------ procedural textures
// Crisp bold lowercase "gibb" lettering with subtle architectural green accent rule.
function logoCanvas(w = 1024, h = 384, bg = '#f1f1ec', fg = '#15181c', accent = '#4d7a4c') {
  const c = canvas(w, h), g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = fg;
  g.font = `900 ${Math.round(h * 0.72)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // Tight geometric letter-spacing characteristic of the gibb wordmark.
  const letters = ['g', 'i', 'b', 'b'];
  const widths = letters.map(ch => g.measureText(ch).width);
  const kern = -h * 0.035;
  const total = widths.reduce((a, b) => a + b, 0) + kern * (letters.length - 1);
  let x = (w - total) / 2;
  const y = h * 0.46;
  for (let i = 0; i < letters.length; i++) {
    g.fillText(letters[i], x + widths[i] / 2, y);
    x += widths[i] + kern;
  }
  if (accent) {
    g.fillStyle = accent;
    g.fillRect(w * 0.12, h * 0.85, w * 0.76, Math.max(6, h * 0.045));
  }
  return c;
}

// Upper facade of gibb glass buildings: white bands, dark glass, mullions, green parapet trim, warm evening rooms.
function gibbUpperMaps() {
  const W = 512, H = 512, r = rng(1939);
  const col = canvas(W, H), g = col.getContext('2d');
  const emi = canvas(W, H), ge = emi.getContext('2d');
  const rgh = canvas(W, H), gr = rgh.getContext('2d');

  g.fillStyle = '#e7e6df'; g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000000'; ge.fillRect(0, 0, W, H);
  gr.fillStyle = '#dcdcdc'; gr.fillRect(0, 0, W, H);

  const floors = 2, fh = H / floors, bays = 6, bw = W / bays;
  for (let row = 0; row < floors; row++) {
    const y0 = row * fh;
    // White concrete floor slab + faint drip shadow under sill
    g.fillStyle = '#d3d2c9'; g.fillRect(0, y0, W, 10);
    g.fillStyle = '#eeede7'; g.fillRect(0, y0 + 10, W, 38);
    // Subtle vertical concrete panel seams
    g.fillStyle = 'rgba(130,132,126,0.28)';
    for (let b = 0; b < bays; b++) g.fillRect(Math.round(b * bw), y0, 2, 54);
    // Distinctive Neues Bauen muted green parapet band & crisp dark-green window rail
    g.fillStyle = '#3f6848'; g.fillRect(0, y0 + 46, W, 19);
    g.fillStyle = '#213c2b'; g.fillRect(0, y0 + 65, W, 8);
    g.fillStyle = '#213c2b'; g.fillRect(0, y0 + fh - 12, W, 12);

    const wy = y0 + 73, wh = fh - 85;
    gr.fillStyle = '#282828'; gr.fillRect(0, wy, W, wh);

    for (let b = 0; b < bays; b++) {
      const bx = Math.round(b * bw);
      const lit = r() < 0.34;
      const grad = g.createLinearGradient(0, wy, 0, wy + wh);
      if (lit) {
        grad.addColorStop(0, '#6e614d');
        grad.addColorStop(0.55, '#4d4336');
        grad.addColorStop(1, '#27292d');
      } else {
        grad.addColorStop(0, '#2a4354');
        grad.addColorStop(0.5, '#172733');
        grad.addColorStop(1, '#0d151c');
      }
      g.fillStyle = grad;
      g.fillRect(bx + 3, wy, bw - 6, wh);

      // Subtle interior Venetian blind at top of some panes
      if (!lit && r() < 0.45) {
        g.fillStyle = 'rgba(210,214,208,0.22)';
        g.fillRect(bx + 3, wy, bw - 6, Math.round(wh * (0.18 + r() * 0.25)));
      }
      if (lit) {
        const eg = ge.createLinearGradient(0, wy, 0, wy + wh);
        const warm = r() < 0.5 ? '#ffd494' : '#f7ba6e';
        eg.addColorStop(0, warm);
        eg.addColorStop(0.7, '#b57b3c');
        eg.addColorStop(1, '#3b2814');
        ge.fillStyle = eg;
        ge.fillRect(bx + 5, wy + 4, bw - 10, wh - 8);
      }
      // Crisp light mullion between window bays
      g.fillStyle = '#d4d8d4'; g.fillRect(bx, wy - 4, 5, wh + 8);
      gr.fillStyle = '#a8a8a8'; gr.fillRect(bx, wy - 4, 5, wh + 8);
      ge.fillStyle = '#000000'; ge.fillRect(bx, wy - 4, 5, wh + 8);
    }
    // Thin horizontal transom bar across glass band
    g.fillStyle = '#334d3e'; g.fillRect(0, wy + Math.round(wh * 0.28), W, 4);
    ge.fillStyle = '#000000'; ge.fillRect(0, wy + Math.round(wh * 0.28), W, 4);
  }
  return {
    map: tex(col, 1, 1, true),
    emissiveMap: tex(emi, 1, 1, true),
    roughnessMap: tex(rgh, 1, 1, false),
  };
}

// Ground floor glazed hall behind concrete columns (pilotis) for gibb buildings.
function gibbGroundMaps() {
  const W = 512, H = 256, r = rng(1998);
  const col = canvas(W, H), g = col.getContext('2d');
  const emi = canvas(W, H), ge = emi.getContext('2d');
  const rgh = canvas(W, H), gr = rgh.getContext('2d');

  // Deep recessed glass foyer
  const glass = g.createLinearGradient(0, 0, 0, H);
  glass.addColorStop(0, '#2a373f');
  glass.addColorStop(0.55, '#4c463d');
  glass.addColorStop(1, '#262422');
  g.fillStyle = glass; g.fillRect(0, 0, W, H);

  ge.fillStyle = '#000000'; ge.fillRect(0, 0, W, H);
  gr.fillStyle = '#303030'; gr.fillRect(0, 0, W, H);

  // Warm interior hall glow through glazing
  const eg = ge.createLinearGradient(0, 34, 0, H - 18);
  eg.addColorStop(0, '#ffcf8a');
  eg.addColorStop(0.6, '#b88246');
  eg.addColorStop(1, '#3d2a16');
  ge.fillStyle = eg;
  ge.fillRect(0, 34, W, H - 52);

  // Fine dark-green glazing bars and door mullions
  for (let x = 0; x < W; x += 64) {
    g.fillStyle = '#253c2e'; g.fillRect(x, 28, 4, H - 40);
    ge.fillStyle = '#000000'; ge.fillRect(x, 28, 4, H - 40);
    gr.fillStyle = '#999999'; gr.fillRect(x, 28, 4, H - 40);
  }
  g.fillStyle = '#253c2e'; g.fillRect(0, 88, W, 5);
  ge.fillStyle = '#000000'; ge.fillRect(0, 88, W, 5);

  // Concrete floor slab overhang at top (y = 0..34) & low concrete plinth at bottom
  g.fillStyle = '#e5e4dc'; g.fillRect(0, 0, W, 24);
  g.fillStyle = '#989a94'; g.fillRect(0, 24, W, 10);
  g.fillStyle = '#b4b3ab'; g.fillRect(0, H - 16, W, 16);
  ge.fillStyle = '#000000'; ge.fillRect(0, 0, W, 34); ge.fillRect(0, H - 16, W, 16);
  gr.fillStyle = '#e4e4e4'; gr.fillRect(0, 0, W, 34); gr.fillRect(0, H - 16, W, 16);

  // Freestanding concrete columns (2 per 11m tile -> ~5.5m spacing) with soft drop shadow on glass
  for (const cx of [118, 374]) {
    const cw = 30;
    g.fillStyle = 'rgba(0,0,0,0.34)'; g.fillRect(cx + cw, 34, 14, H - 50);
    ge.fillStyle = '#000000'; ge.fillRect(cx - 2, 24, cw + 4, H - 24);
    const cg = g.createLinearGradient(cx, 0, cx + cw, 0);
    cg.addColorStop(0, '#c8c7bf'); cg.addColorStop(0.45, '#e2e1d9'); cg.addColorStop(1, '#a9a8a0');
    g.fillStyle = cg; g.fillRect(cx, 20, cw, H - 20);
    gr.fillStyle = '#e0e0e0'; gr.fillRect(cx, 20, cw, H - 20);
    // Subtle dark panel variation in one bay
    if (r() < 0.3) { ge.fillStyle = 'rgba(0,0,0,0.45)'; ge.fillRect(cx + cw + 14, 34, 110, H - 50); }
  }
  return {
    map: tex(col, 1, 1, true),
    emissiveMap: tex(emi, 1, 1, true),
    roughnessMap: tex(rgh, 1, 1, false),
  };
}

// Neighbour Bernese Altbau houses: warm plaster, punched windows, green shutters, warm evening rooms.
function houseMaps() {
  const W = 512, H = 512, r = rng(3013);
  const col = canvas(W, H), g = col.getContext('2d');
  const emi = canvas(W, H), ge = emi.getContext('2d');

  g.fillStyle = '#d7c8ae'; g.fillRect(0, 0, W, H);
  // Subtle stucco grain
  for (let i = 0; i < 1600; i++) {
    const shade = r() < 0.5 ? 'rgba(255,250,240,0.06)' : 'rgba(90,78,60,0.06)';
    g.fillStyle = shade;
    g.fillRect(r() * W, r() * H, 4 + r() * 8, 4 + r() * 8);
  }
  ge.fillStyle = '#000000'; ge.fillRect(0, 0, W, H);

  const rows = 2, cols = 4, rh = H / rows, cw = W / cols;
  for (let row = 0; row < rows; row++) {
    const y0 = row * rh;
    // Pale sandstone stringcourse between floors
    g.fillStyle = '#c2b296'; g.fillRect(0, y0, W, 8);
    g.fillStyle = '#e5d8c0'; g.fillRect(0, y0 + 8, W, 6);

    for (let c = 0; c < cols; c++) {
      const x0 = c * cw;
      const wx = x0 + 36, wy = y0 + 54, ww = 56, wh = 132;
      // Bernese green shutters flanking most windows
      if ((c + row) % 2 === 0 || r() < 0.6) {
        g.fillStyle = '#334d39';
        g.fillRect(wx - 22, wy + 2, 19, wh - 4);
        g.fillRect(wx + ww + 3, wy + 2, 19, wh - 4);
        g.fillStyle = 'rgba(20,32,22,0.45)';
        for (let sy = wy + 8; sy < wy + wh - 6; sy += 9) {
          g.fillRect(wx - 20, sy, 15, 2);
          g.fillRect(wx + ww + 5, sy, 15, 2);
        }
      }
      // Stone window surround & sill
      g.fillStyle = '#b9a88d'; g.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
      g.fillStyle = '#e4d8c3'; g.fillRect(wx - 8, wy + wh + 2, ww + 16, 8);

      const lit = r() < 0.24;
      g.fillStyle = lit ? '#8e6d43' : '#252c33';
      g.fillRect(wx, wy, ww, wh);
      if (lit) {
        const eg = ge.createLinearGradient(0, wy, 0, wy + wh);
        eg.addColorStop(0, '#ffd088');
        eg.addColorStop(1, '#a96b2e');
        ge.fillStyle = eg;
        ge.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
      }
      // White wooden window cross
      g.fillStyle = '#dfdcd3';
      g.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      g.fillRect(wx, wy + Math.round(wh * 0.36), ww, 4);
      ge.fillStyle = '#000000';
      ge.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      ge.fillRect(wx, wy + Math.round(wh * 0.36), ww, 4);
    }
  }
  return { map: tex(col, 1, 1, true), emissiveMap: tex(emi, 1, 1, true) };
}

// Weathered cast-concrete texture for perimeter wall and planters.
function concreteTex() {
  const c = canvas(256), g = c.getContext('2d'), r = rng(707);
  g.fillStyle = '#bab9b2'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1200; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,250,0.08)' : 'rgba(65,65,60,0.09)';
    g.fillRect(r() * 256, r() * 256, 2 + r() * 6, 2 + r() * 6);
  }
  // Formwork seams
  g.fillStyle = 'rgba(70,70,66,0.22)';
  g.fillRect(0, 126, 256, 2);
  g.fillRect(126, 0, 2, 256);
  return tex(c, 1, 1, true);
}

// Schoolyard asphalt with court markings, basketball keys/arcs, and centre gibb lettering.
function yardTexture(S = 2048) {
  const c = canvas(S), g = c.getContext('2d'), r = rng(2026);
  g.fillStyle = '#484c50'; g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 24;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  const m = S / (2 * (WALL_R + 1)), C = S / 2;
  // Subtle darker perimeter shading & worn centre play area
  const rimShade = g.createRadialGradient(C, C, (ARENA_R - 4) * m, C, C, (WALL_R + 1) * m);
  rimShade.addColorStop(0, 'rgba(0,0,0,0)');
  rimShade.addColorStop(1, 'rgba(18,20,24,0.38)');
  g.fillStyle = rimShade;
  g.fillRect(0, 0, S, S);

  // Subtle asphalt patching texture
  for (let i = 0; i < 28; i++) {
    const a = r() * TAU, rad = r() * ARENA_R * 0.85 * m, sz = (1.5 + r() * 4.5) * m;
    const gr = g.createRadialGradient(C + Math.cos(a) * rad, C + Math.sin(a) * rad, 0, C + Math.cos(a) * rad, C + Math.sin(a) * rad, sz);
    gr.addColorStop(0, r() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(15,18,22,0.06)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(C + Math.cos(a) * rad, C + Math.sin(a) * rad, sz, 0, TAU); g.fill();
  }

  // Soft shadow ring around each planter base
  for (const p of PILLARS) {
    const px = C + p.x * m, pz = C + p.z * m;
    const sg = g.createRadialGradient(px, pz, p.r * 0.9 * m, px, pz, (p.r + 1.4) * m);
    sg.addColorStop(0, 'rgba(10,12,15,0.42)');
    sg.addColorStop(1, 'rgba(10,12,15,0)');
    g.fillStyle = sg;
    g.beginPath(); g.arc(px, pz, (p.r + 1.4) * m, 0, TAU); g.fill();
  }

  // White court perimeter, centre circle & half-court line
  g.strokeStyle = 'rgba(242,242,236,0.82)';
  g.lineWidth = 0.13 * m;
  g.beginPath(); g.arc(C, C, ARENA_R * m, 0, TAU); g.stroke();
  g.beginPath(); g.arc(C, C, 6 * m, 0, TAU); g.stroke();
  g.beginPath(); g.moveTo(C - ARENA_R * m, C); g.lineTo(C + ARENA_R * m, C); g.stroke();

  // Warm ochre basketball keys, free-throw circles, and 3-point arcs aligned under West & East hoops
  g.strokeStyle = 'rgba(235,198,68,0.82)';
  g.lineWidth = 0.11 * m;
  for (const s of [-1, 1]) {
    const baseEdge = C + s * (ARENA_R - 0.3) * m;
    const keyLen = 5.2 * m, keyHalfW = 2.2 * m;
    const keyLeft = s > 0 ? baseEdge - keyLen : baseEdge;
    g.strokeRect(keyLeft, C - keyHalfW, keyLen, keyHalfW * 2);
    const ftX = C + s * (ARENA_R - 5.5) * m;
    g.beginPath(); g.arc(ftX, C, 1.8 * m, 0, TAU); g.stroke();
    const hoopX = C + s * (ARENA_R - 1.1) * m;
    g.beginPath();
    g.arc(hoopX, C, 7.2 * m, s > 0 ? Math.PI * 0.62 : -Math.PI * 0.38, s > 0 ? Math.PI * 1.38 : Math.PI * 0.38);
    g.stroke();
  }

  // Crisp bold lowercase "gibb" painted in centre circle (upright from player start facing +z)
  g.save();
  g.translate(C, C);
  g.rotate(Math.PI);
  g.globalAlpha = 0.88;
  g.drawImage(logoCanvas(1024, 384, null, '#efefe9', '#6e9b64'), -4.6 * m, -1.72 * m, 9.2 * m, 3.45 * m);
  g.restore();

  const t = tex(c, 1, 1, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Feathered concrete-paver apron outside the fence that dissolves softly into the ortho photo.
function apronTexture(S = 1024) {
  const c = canvas(S), g = c.getContext('2d'), r = rng(419);
  const C = S / 2;
  // Inner radius of apron mesh = WALL_R + 0.5 (32.0m), outer = WALL_R + 10.5 (42.0m).
  // Draw full radial disc with alpha feathering from sidewalk pavers into park gravel/ortho.
  const grad = g.createRadialGradient(C, C, C * 0.74, C, C, C);
  grad.addColorStop(0.0, 'rgba(138,136,129,0.98)');
  grad.addColorStop(0.24, 'rgba(126,125,118,0.92)');
  grad.addColorStop(0.48, 'rgba(104,106,96,0.68)');
  grad.addColorStop(0.76, 'rgba(84,92,76,0.28)');
  grad.addColorStop(1.0, 'rgba(72,82,66,0.0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);

  // Subtle concrete paver radial seams in the inner sidewalk belt
  g.strokeStyle = 'rgba(55,56,52,0.22)';
  g.lineWidth = 2;
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * TAU;
    g.beginPath();
    g.moveTo(C + Math.cos(a) * C * 0.75, C + Math.sin(a) * C * 0.75);
    g.lineTo(C + Math.cos(a) * C * 0.87, C + Math.sin(a) * C * 0.87);
    g.stroke();
  }
  g.beginPath(); g.arc(C, C, C * 0.86, 0, TAU); g.stroke();
  // Fine gravel/paver speckle
  for (let i = 0; i < 2400; i++) {
    const a = r() * TAU, rad = C * (0.76 + r() * 0.2);
    const fade = Math.max(0, 1 - (rad / C - 0.76) / 0.22);
    g.fillStyle = r() < 0.5 ? `rgba(220,218,210,${0.12 * fade})` : `rgba(40,42,38,${0.14 * fade})`;
    g.fillRect(C + Math.cos(a) * rad, C + Math.sin(a) * rad, 3, 3);
  }
  const t = tex(c, 1, 1, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function backboardTex() {
  const c = canvas(256, 170), g = c.getContext('2d');
  g.fillStyle = '#edf0f2'; g.fillRect(0, 0, 256, 170);
  g.strokeStyle = '#c83a2b'; g.lineWidth = 8;
  g.strokeRect(8, 8, 240, 154);
  g.lineWidth = 7;
  g.strokeRect(88, 66, 80, 62);
  const t = tex(c, 1, 1, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function lampHaloTex() {
  const c = canvas(128), g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,222,165,0.9)');
  gr.addColorStop(0.28, 'rgba(255,186,108,0.36)');
  gr.addColorStop(0.7, 'rgba(255,158,76,0.08)');
  gr.addColorStop(1, 'rgba(255,140,60,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = tex(c, 1, 1, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ------------------------------------------------------------------ raw buffer builders
function makeBuf() { return { p: [], n: [], u: [] }; }
function pushQuad(b, ax, az, bx, bz, y0, y1, u0, u1, v0, v1, nx, nz) {
  b.p.push(
    ax, y0, az,  bx, y0, bz,  bx, y1, bz,
    ax, y0, az,  bx, y1, bz,  ax, y1, az,
  );
  for (let i = 0; i < 6; i++) b.n.push(nx, 0, nz);
  b.u.push(u0, v0,  u1, v0,  u1, v1,  u0, v0,  u1, v1,  u0, v1);
}
function pushTriTop(b, pts, y) {
  const [a, c, d] = pts;
  b.p.push(a[0], y, a[1],  c[0], y, c[1],  d[0], y, d[1]);
  b.n.push(0, 1, 0,  0, 1, 0,  0, 1, 0);
  b.u.push(a[0] / 8, a[1] / 8,  c[0] / 8, c[1] / 8,  d[0] / 8, d[1] / 8);
}
function bufToGeo(b) {
  if (!b.p.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
  g.computeBoundingSphere();
  return g;
}

export class GibbArena {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'arena-gibb';
    scene.add(this.group);
    this.flames = [];
    this.crowdHype = 0;
    this.time = 0;
    this.lampLights = [];
    this.lampHalos = [];

    const upper = gibbUpperMaps();
    const ground = gibbGroundMaps();
    const house = houseMaps();
    const conc = concreteTex();

    this.mats = {
      gibbUpper: new THREE.MeshStandardMaterial({
        map: upper.map, roughnessMap: upper.roughnessMap, roughness: 0.95, metalness: 0.18,
        emissive: 0xffd296, emissiveMap: upper.emissiveMap, emissiveIntensity: 0.62,
      }),
      gibbGround: new THREE.MeshStandardMaterial({
        map: ground.map, roughnessMap: ground.roughnessMap, roughness: 0.92, metalness: 0.16,
        emissive: 0xffcf8c, emissiveMap: ground.emissiveMap, emissiveIntensity: 0.72,
      }),
      house: new THREE.MeshStandardMaterial({
        map: house.map, roughness: 0.88,
        emissive: 0xffc87c, emissiveMap: house.emissiveMap, emissiveIntensity: 0.58,
      }),
      flatRoof: new THREE.MeshStandardMaterial({ color: 0x5c6064, roughness: 0.95 }),
      tileRoof: new THREE.MeshStandardMaterial({ color: 0x7b4c3b, roughness: 0.92 }),
      concrete: new THREE.MeshStandardMaterial({ map: conc, roughness: 0.9 }),
      concreteLight: new THREE.MeshStandardMaterial({ color: 0xdeddd5, roughness: 0.86 }),
      soil: new THREE.MeshStandardMaterial({ color: 0x3b3126, roughness: 1.0 }),
      fence: new THREE.MeshStandardMaterial({ color: 0x4b5c4c, roughness: 0.55, metalness: 0.55 }),
      darkSteel: new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.45, metalness: 0.68 }),
      galvSteel: new THREE.MeshStandardMaterial({ color: 0xaab2b6, roughness: 0.35, metalness: 0.78 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x9b724b, roughness: 0.82 }),
      rimOrange: new THREE.MeshStandardMaterial({ color: 0xd94e24, roughness: 0.4, metalness: 0.3 }),
      netWhite: new THREE.MeshStandardMaterial({ color: 0xebebea, roughness: 0.9, transparent: true, opacity: 0.78, side: THREE.DoubleSide }),
      lampGlow: new THREE.MeshStandardMaterial({ color: 0xfff0d4, emissive: 0xffca7a, emissiveIntensity: 1.45, roughness: 0.25 }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x574435, roughness: 0.96 }),
      leafA: new THREE.MeshStandardMaterial({ color: 0x456b38, roughness: 0.88, flatShading: true }),
      leafB: new THREE.MeshStandardMaterial({ color: 0x597a3c, roughness: 0.88, flatShading: true }),
      leafPark: new THREE.MeshStandardMaterial({ color: 0x406035, roughness: 0.9, flatShading: true }),
    };

    this.buildGround();
    this.buildYard();
    this.buildPillars();
    this.buildYardProps();
    this.buildPerimeterTrees();
    this.ready = this.buildBuildings();
  }

  buildGround() {
    const t = new THREE.TextureLoader().load(DIR + 'ortho.jpg');
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(ORTHO.size, ORTHO.size),
      new THREE.MeshStandardMaterial({ map: t, roughness: 1 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(ORTHO.x, -0.06, ORTHO.z);
    m.receiveShadow = true;
    this.group.add(m);

    // Feathered sidewalk-to-park transition apron around the fence so ortho blends softly.
    const apron = new THREE.Mesh(
      new THREE.CircleGeometry(WALL_R + 10.5, 96),
      new THREE.MeshStandardMaterial({
        map: apronTexture(), transparent: true, depthWrite: false, roughness: 0.96,
      })
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.025;
    apron.receiveShadow = true;
    this.group.add(apron);
  }

  buildYard() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(WALL_R + 0.7, 96),
      new THREE.MeshStandardMaterial({ map: yardTexture(), roughness: 0.94 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Solid low concrete perimeter curb wall (inner face, outer face, top coping merged).
    const rIn = WALL_R + 0.3, rOut = WALL_R + 0.9, wallH = 0.85;
    const wIn = new THREE.CylinderGeometry(rIn, rIn, wallH, 96, 1, true);
    wIn.scale(-1, 1, 1); // flip normals inward toward the fight zone
    wIn.translate(0, wallH / 2, 0);
    const wOut = new THREE.CylinderGeometry(rOut, rOut, wallH, 96, 1, true);
    wOut.translate(0, wallH / 2, 0);
    const wCap = new THREE.RingGeometry(rIn - 0.04, rOut + 0.04, 96);
    wCap.rotateX(-Math.PI / 2);
    wCap.translate(0, wallH + 0.01, 0);
    const wallMesh = new THREE.Mesh(mergeParts([wIn, wOut, wCap]), this.mats.concrete);
    wallMesh.castShadow = wallMesh.receiveShadow = true;
    this.group.add(wallMesh);

    // Ball-catch schoolyard fence: instanced posts + top/bottom steel rails + diamond wire mesh.
    const rFence = WALL_R + 0.6;
    const postCount = 80;
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 2.1, 6), this.mats.fence, postCount);
    const mt = new THREE.Matrix4();
    for (let i = 0; i < postCount; i++) {
      const a = (i / postCount) * TAU;
      mt.makeTranslation(Math.sin(a) * rFence, wallH + 1.05, Math.cos(a) * rFence);
      posts.setMatrixAt(i, mt);
    }
    posts.instanceMatrix.needsUpdate = true;
    this.group.add(posts);

    const railParts = [];
    for (const ry of [wallH + 0.12, wallH + 2.02]) {
      const rail = new THREE.TorusGeometry(rFence, 0.032, 6, 96);
      rail.rotateX(Math.PI / 2);
      rail.translate(0, ry, 0);
      railParts.push(rail);
    }
    this.group.add(new THREE.Mesh(mergeParts(railParts), this.mats.fence));

    const meshC = canvas(64), g = meshC.getContext('2d');
    g.strokeStyle = 'rgba(72,88,72,0.88)';
    g.lineWidth = 3;
    for (let i = -64; i < 128; i += 16) {
      g.beginPath();
      g.moveTo(i, 0); g.lineTo(i + 64, 64);
      g.moveTo(i + 64, 0); g.lineTo(i, 64);
      g.stroke();
    }
    const fenceTex = new THREE.CanvasTexture(meshC);
    fenceTex.wrapS = fenceTex.wrapT = THREE.RepeatWrapping;
    fenceTex.repeat.set(160, 2);
    const fence = new THREE.Mesh(
      new THREE.CylinderGeometry(rFence, rFence, 1.9, 96, 1, true),
      new THREE.MeshStandardMaterial({
        map: fenceTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.58,
      })
    );
    fence.position.y = wallH + 1.07;
    this.group.add(fence);
  }

  // The four sim pillars: cast-concrete seating planters with branching shade trees.
  buildPillars() {
    const concParts = [], soilParts = [], trunkParts = [], leafAParts = [], leafBParts = [];
    const r = rng(441);
    for (const p of PILLARS) {
      const base = new THREE.CylinderGeometry(p.r * 0.98, p.r * 1.03, 0.88, 32);
      base.translate(p.x, 0.44, p.z);
      concParts.push(base);

      // Slightly overhanging concrete seating rim
      const lip = new THREE.CylinderGeometry(p.r * 1.04, p.r * 1.01, 0.14, 32);
      lip.translate(p.x, 0.94, p.z);
      concParts.push(lip);

      const soil = new THREE.CylinderGeometry(p.r * 0.84, p.r * 0.84, 0.08, 24);
      soil.translate(p.x, 0.99, p.z);
      soilParts.push(soil);

      // Trunk + 3 upward-forking limbs emerging cleanly into the canopy
      const trunk = new THREE.CylinderGeometry(0.22, 0.34, 4.4, 8);
      trunk.translate(p.x, 3.1, p.z);
      trunkParts.push(trunk);

      for (let b = 0; b < 3; b++) {
        const ba = b * (TAU / 3) + r() * 0.5;
        const limb = new THREE.CylinderGeometry(0.08, 0.15, 2.0, 6);
        limb.rotateZ(-0.46);
        limb.rotateY(ba);
        limb.translate(p.x + Math.cos(ba) * 0.4, 5.15, p.z - Math.sin(ba) * 0.4);
        trunkParts.push(limb);
      }

      // Layered low-poly foliage crown (varied shade lobes)
      const lobes = [
        [0, 6.9, 0, 1.85],
        [1.15, 6.1, 0.65, 1.45],
        [-1.05, 6.25, 0.7, 1.5],
        [0.15, 6.15, -1.25, 1.5],
        [-0.7, 7.25, -0.5, 1.35],
        [0.85, 7.1, -0.35, 1.3],
      ];
      for (let k = 0; k < lobes.length; k++) {
        const [ox, oy, oz, rad] = lobes[k];
        const lobe = new THREE.IcosahedronGeometry(rad * (0.94 + r() * 0.14), 1);
        lobe.scale(1.06, 0.84, 1.06);
        lobe.rotateY(r() * TAU);
        lobe.translate(p.x + ox, oy, p.z + oz);
        (k % 2 === 0 ? leafAParts : leafBParts).push(lobe);
      }
    }

    const add = (parts, mat, shadow = true) => {
      const m = new THREE.Mesh(mergeParts(parts), mat);
      m.castShadow = m.receiveShadow = shadow;
      this.group.add(m);
    };
    add(concParts, this.mats.concrete, true);
    add(soilParts, this.mats.soil, false);
    add(trunkParts, this.mats.trunk, true);
    add(leafAParts, this.mats.leafA, true);
    add(leafBParts, this.mats.leafB, true);
  }

  // Schoolyard props: basketball hoops, Bernese concrete/wood benches, bike stands, evening lamp posts.
  buildYardProps() {
    this.buildBasketballHoops();
    this.buildBenches();
    this.buildBikeStands();
    this.buildLampPosts();
  }

  buildBasketballHoops() {
    const steelParts = [], orangeParts = [], netParts = [];
    const boardMat = new THREE.MeshStandardMaterial({ map: backboardTex(), roughness: 0.3, metalness: 0.05 });

    for (const side of [-1, 1]) {
      const postX = side * (ARENA_R + 1.45);
      const boardX = side * (ARENA_R + 0.25);
      const rimX = side * (ARENA_R - 0.18);

      // Vertical galvanized steel mast + diagonal neck
      const post = new THREE.CylinderGeometry(0.085, 0.1, 3.85, 8);
      post.translate(postX, 1.925, 0);
      steelParts.push(post);

      const arm = new THREE.BoxGeometry(1.22, 0.11, 0.11);
      arm.translate((postX + boardX) / 2, 3.45, 0);
      steelParts.push(arm);

      const brace = new THREE.CylinderGeometry(0.035, 0.035, 1.35, 6);
      brace.rotateZ(side * 0.85);
      brace.translate((postX + boardX) / 2, 3.02, 0);
      steelParts.push(brace);

      // Backboard (thin box with red shooter's square facing inward)
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.15, 1.8), boardMat);
      board.position.set(boardX, 3.55, 0);
      board.castShadow = true;
      this.group.add(board);

      // Orange rim + net
      const rim = new THREE.TorusGeometry(0.24, 0.024, 8, 20);
      rim.rotateX(Math.PI / 2);
      rim.translate(rimX, 3.08, 0);
      orangeParts.push(rim);

      const net = new THREE.CylinderGeometry(0.23, 0.14, 0.44, 12, 1, true);
      net.translate(rimX, 2.86, 0);
      netParts.push(net);
    }

    const sm = new THREE.Mesh(mergeParts(steelParts), this.mats.galvSteel);
    sm.castShadow = true;
    this.group.add(sm);
    this.group.add(new THREE.Mesh(mergeParts(orangeParts), this.mats.rimOrange));
    this.group.add(new THREE.Mesh(mergeParts(netParts), this.mats.netWhite));
  }

  buildBenches() {
    // One bench: two cast-concrete block legs + 3 warm timber seat slats (instanced cleanly).
    const legL = new THREE.BoxGeometry(0.18, 0.42, 0.46); legL.translate(-0.78, 0.21, 0);
    const legR = new THREE.BoxGeometry(0.18, 0.42, 0.46); legR.translate(0.78, 0.21, 0);
    const legGeo = mergeParts([legL, legR]);

    const planks = [];
    for (const zOff of [-0.16, 0, 0.16]) {
      const p = new THREE.BoxGeometry(2.15, 0.065, 0.13);
      p.translate(0, 0.455, zOff);
      planks.push(p);
    }
    const seatGeo = mergeParts(planks);

    // 8 benches tucked cleanly along the perimeter inside the wall (away from hoops at ±x),
    // plus 4 concrete-wood benches in a neat row outside on the north plaza toward the Aula.
    const placements = [];
    const innerAngles = [0.28, 0.62, 1.1, 2.04, 2.52, 2.86, -0.45, -2.68];
    for (const a of innerAngles) {
      placements.push({ x: Math.sin(a) * (WALL_R - 0.65), z: Math.cos(a) * (WALL_R - 0.65), ry: a + Math.PI });
    }
    for (let i = 0; i < 4; i++) {
      const x = -14 + i * 3.4, z = -34.2;
      placements.push({ x, z, ry: 0.18 });
    }

    const legs = new THREE.InstancedMesh(legGeo, this.mats.concrete, placements.length);
    const seats = new THREE.InstancedMesh(seatGeo, this.mats.wood, placements.length);
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    placements.forEach((b, i) => {
      q.setFromAxisAngle(up, b.ry);
      mt.compose(v.set(b.x, 0, b.z), q, s);
      legs.setMatrixAt(i, mt);
      seats.setMatrixAt(i, mt);
    });
    legs.instanceMatrix.needsUpdate = seats.instanceMatrix.needsUpdate = true;
    legs.castShadow = legs.receiveShadow = seats.castShadow = seats.receiveShadow = true;
    this.group.add(legs, seats);
  }

  buildBikeStands() {
    // Classic Swiss galvanized inverted-U hoop bike stands + a few simple parked bikes outside the fence.
    const rackParts = [], bikeFrameParts = [], tireParts = [];
    const clusters = [
      { x: -17.8, z: -29.8, ry: 0.54, count: 6, bikes: [0, 2, 4] },
      { x: 25.2, z: -22.5, ry: -0.78, count: 5, bikes: [1, 3] },
    ];
    const tmp = new THREE.Matrix4();

    for (const cl of clusters) {
      const base = new THREE.BoxGeometry(cl.count * 0.85, 0.04, 0.36);
      tmp.makeRotationY(cl.ry).setPosition(cl.x, 0.02, cl.z);
      base.applyMatrix4(tmp);
      rackParts.push(base);

      for (let i = 0; i < cl.count; i++) {
        const localX = (i - (cl.count - 1) / 2) * 0.82;
        const cos = Math.cos(cl.ry), sin = Math.sin(cl.ry);
        const hx = cl.x + localX * cos, hz = cl.z - localX * sin;

        const hoop = new THREE.TorusGeometry(0.32, 0.026, 6, 14, Math.PI);
        hoop.rotateY(cl.ry + Math.PI / 2);
        hoop.translate(hx, 0.44, hz);
        rackParts.push(hoop);

        for (const legOff of [-0.32, 0.32]) {
          const leg = new THREE.CylinderGeometry(0.026, 0.026, 0.44, 6);
          leg.translate(hx + legOff * sin, 0.22, hz + legOff * cos);
          rackParts.push(leg);
        }

        // Minimal stylized parked bicycle leaning beside selected hoops
        if (cl.bikes.includes(i)) {
          const bx = hx + 0.2 * cos, bz = hz - 0.2 * sin;
          const bMat = new THREE.Matrix4().makeRotationY(cl.ry + Math.PI / 2 + 0.08).setPosition(bx, 0, bz);
          for (const wx of [-0.52, 0.52]) {
            const wheel = new THREE.TorusGeometry(0.31, 0.028, 6, 16);
            wheel.translate(wx, 0.33, 0);
            wheel.applyMatrix4(bMat);
            tireParts.push(wheel);
          }
          const bar = new THREE.CylinderGeometry(0.02, 0.02, 0.86, 5);
          bar.rotateZ(Math.PI / 2 - 0.14);
          bar.translate(0, 0.64, 0);
          bar.applyMatrix4(bMat);
          bikeFrameParts.push(bar);

          const fork = new THREE.CylinderGeometry(0.02, 0.02, 0.68, 5);
          fork.rotateZ(-0.22);
          fork.translate(0.45, 0.62, 0);
          fork.applyMatrix4(bMat);
          bikeFrameParts.push(fork);

          const handle = new THREE.CylinderGeometry(0.018, 0.018, 0.5, 5);
          handle.rotateX(Math.PI / 2);
          handle.translate(0.38, 0.94, 0);
          handle.applyMatrix4(bMat);
          bikeFrameParts.push(handle);
        }
      }
    }

    this.group.add(new THREE.Mesh(mergeParts(rackParts), this.mats.galvSteel));
    if (bikeFrameParts.length) {
      this.group.add(new THREE.Mesh(mergeParts(bikeFrameParts), new THREE.MeshStandardMaterial({ color: 0x3b6078, roughness: 0.4, metalness: 0.5 })));
    }
    if (tireParts.length) this.group.add(new THREE.Mesh(mergeParts(tireParts), this.mats.darkSteel));
  }

  buildLampPosts() {
    const count = 8;
    const rPost = WALL_R + 1.2;
    const postParts = [], glowParts = [];
    const haloMat = new THREE.SpriteMaterial({
      map: lampHaloTex(), color: 0xffd296, transparent: true, opacity: 0.65,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + Math.PI / 8;
      const sx = Math.sin(a), sz = Math.cos(a);
      const px = sx * rPost, pz = sz * rPost;

      const mast = new THREE.CylinderGeometry(0.06, 0.095, 5.9, 8);
      mast.translate(px, 2.95, pz);
      postParts.push(mast);

      // Slim inward cantilevered arm + flat modern luminaire head
      const arm = new THREE.BoxGeometry(0.08, 0.08, 1.3);
      arm.rotateY(a);
      arm.translate(px - sx * 0.6, 5.82, pz - sz * 0.6);
      postParts.push(arm);

      const hood = new THREE.BoxGeometry(0.34, 0.1, 0.56);
      hood.rotateY(a);
      hood.translate(px - sx * 1.15, 5.8, pz - sz * 1.15);
      postParts.push(hood);

      const diff = new THREE.BoxGeometry(0.28, 0.04, 0.46);
      diff.rotateY(a);
      diff.translate(px - sx * 1.15, 5.73, pz - sz * 1.15);
      glowParts.push(diff);

      const hx = px - sx * 1.15, hz = pz - sz * 1.15;
      const halo = new THREE.Sprite(haloMat);
      halo.position.set(hx, 5.6, hz);
      halo.scale.set(3.2, 3.2, 1);
      this.group.add(halo);
      this.lampHalos.push({ sprite: halo, phase: i * 1.3 });

      // Every other lamp carries a warm soft evening point light (4 around the yard, no shadow cost).
      if (i % 2 === 0) {
        const pt = new THREE.PointLight(0xffbd73, 18, 34, 1.7);
        pt.position.set(hx - sx * 1.2, 5.2, hz - sz * 1.2);
        this.group.add(pt);
        this.lampLights.push({ light: pt, base: 18, phase: i * 1.7 });
      }
    }

    const postMesh = new THREE.Mesh(mergeParts(postParts), this.mats.darkSteel);
    postMesh.castShadow = true;
    this.group.add(postMesh);
    this.group.add(new THREE.Mesh(mergeParts(glowParts), this.mats.lampGlow));
  }

  // Park trees along Lorrainestrasse (east) and south park edge, keeping Aula/BMS sightlines clear.
  buildPerimeterTrees() {
    const spots = [
      // East Lorrainestrasse tree row
      [35.8, -18, 1.15], [36.5, -7, 1.05], [36.2, 4.5, 1.2], [35.5, 16, 1.1], [31.5, 27, 1.0],
      // South-east park edge (between yard and Gewerbeschule, keeping centre sightline open)
      [21, 34.5, 1.25], [11.5, 36.2, 1.1], [-10.5, 36.8, 1.05],
      // North-east Lorrainepark corner
      [19.5, -35.5, 1.15], [29.5, -28.5, 1.05],
      // West garden edge
      [-37.5, -5.5, 1.05], [-38.5, 7.5, 1.15], [-34.5, 19, 0.95],
    ];
    const r = rng(808);
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.32, 4.2, 7);
    trunkGeo.translate(0, 2.1, 0);

    const crownParts = [];
    const offsets = [[0, 5.6, 0, 2.1], [1.2, 4.9, 0.6, 1.5], [-1.1, 5.0, -0.7, 1.6], [0.2, 6.7, -0.2, 1.4]];
    for (const [ox, oy, oz, rad] of offsets) {
      const g = new THREE.IcosahedronGeometry(rad, 1);
      g.scale(1.05, 0.85, 1.05);
      g.translate(ox, oy, oz);
      crownParts.push(g);
    }
    const crownGeo = mergeParts(crownParts);

    const trunks = new THREE.InstancedMesh(trunkGeo, this.mats.trunk, spots.length);
    const crowns = new THREE.InstancedMesh(crownGeo, this.mats.leafPark, spots.length);
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    spots.forEach(([x, z, sc], i) => {
      q.setFromAxisAngle(up, r() * TAU);
      mt.compose(v.set(x, -0.05, z), q, s.set(sc, sc * (0.9 + r() * 0.25), sc));
      trunks.setMatrixAt(i, mt);
      crowns.setMatrixAt(i, mt);
    });
    trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true;
    this.group.add(trunks, crowns);
  }

  // ------------------------------------------------------------------ buildings
  async buildBuildings() {
    const data = await (await fetch(DIR + 'buildings.json')).json();
    const gibbUpper = makeBuf(), gibbGround = makeBuf(), houseWall = makeBuf();
    const flatRoof = makeBuf(), tileRoof = makeBuf();

    const keyOf = p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

    for (const b of data) {
      if (b.id === AULA) continue; // built separately as a smooth round landmark

      const isGibb = GIBB_IDS.has(b.id);
      const valid = b.r.filter(([h]) => h >= 1.5);
      const kept = valid.filter(([, ring]) => !ring.some(([x, z]) => Math.hypot(x, z) < WALL_R + 1.5));
      if (!kept.length || kept.length < valid.length * 0.5) continue;

      let minH = Infinity, maxH = -Infinity;
      const edgeMap = new Map();
      for (const [h, ring] of kept) {
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
        const pts = ring.slice(0, -1);
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], c = pts[(i + 1) % pts.length];
          const k = `${keyOf(a)}|${keyOf(c)}`;
          const prev = edgeMap.get(k);
          if (!prev || h > prev.h) edgeMap.set(k, { a, c, h });
        }
      }

      const roofBuf = (!isGibb && maxH - minH > 1.8) ? tileRoof : flatRoof;
      for (const [h, ring] of kept) {
        pushTriTop(roofBuf, ring.slice(0, 3), h + 0.02);
      }

      // Emit only outer boundary walls and roof step walls (eliminates ~65% internal triangle walls).
      for (const { a, c, h } of edgeMap.values()) {
        const opp = edgeMap.get(`${keyOf(c)}|${keyOf(a)}`);
        const yMin = opp ? opp.h : 0;
        if (yMin >= h - 0.15) continue;

        const dx = c[0] - a[0], dz = c[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const nx = -dz / len, nz = dx / len;
        // Exact arc-length UV projection along wall tangent (no distortion on 45° facades).
        const uBase = (a[0] * dx + a[1] * dz) / len;

        if (isGibb) {
          if (yMin < GF_H) {
            const topGF = Math.min(h, GF_H);
            pushQuad(gibbGround, a[0], a[1], c[0], c[1], yMin, topGF, uBase / 11, (uBase + len) / 11, yMin / GF_H, topGF / GF_H, nx, nz);
          }
          if (h > GF_H) {
            const botUp = Math.max(yMin, GF_H);
            pushQuad(gibbUpper, a[0], a[1], c[0], c[1], botUp, h, uBase / 10.8, (uBase + len) / 10.8, (botUp - GF_H) / 7, (h - GF_H) / 7, nx, nz);
          }
        } else {
          pushQuad(houseWall, a[0], a[1], c[0], c[1], yMin, h, uBase / 10.4, (uBase + len) / 10.4, yMin / 6.8, h / 6.8, nx, nz);
        }
      }
    }

    const addBuf = (buf, mat) => {
      const geo = bufToGeo(buf);
      if (!geo) return;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    };
    addBuf(gibbUpper, this.mats.gibbUpper);
    addBuf(gibbGround, this.mats.gibbGround);
    addBuf(houseWall, this.mats.house);
    addBuf(flatRoof, this.mats.flatRoof);
    addBuf(tileRoof, this.mats.tileRoof);

    const aulaInfo = this.buildRoundAula(data);
    this.buildSigns(aulaInfo);
  }

  // Smooth circular Aula (F6D8F845): glazed ground colonnade, curved banded drum, upper skylight crown, BMS bridge.
  buildRoundAula(data) {
    const aula = data.find(b => b.id === AULA);
    if (!aula) return null;

    // Derive centre from main circular ring (excluding the west walkway bridge at x < -21.6).
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, mainH = 12.9, crownH = 14.7;
    for (const [h, ring] of aula.r) {
      if (h > 13.5) crownH = Math.max(crownH, h);
      else mainH = Math.max(mainH, h);
      for (const [x, z] of ring) {
        if (x < -21.6) continue;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const R = 10.1, gfH = 3.95, segs = 48;

    // 1. Recessed glazed circular ground floor
    const gfGeo = new THREE.CylinderGeometry(R - 0.85, R - 0.85, gfH, segs, 1, true);
    const gfUv = gfGeo.attributes.uv;
    for (let i = 0; i < gfUv.count; i++) gfUv.setX(i, gfUv.getX(i) * 5);
    gfGeo.translate(cx, gfH / 2, cz);
    const gfMesh = new THREE.Mesh(gfGeo, this.mats.gibbGround);
    gfMesh.castShadow = gfMesh.receiveShadow = true;
    this.group.add(gfMesh);

    // 2. Ring of 16 freestanding round concrete pilotis around the glazed foyer
    const colParts = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const col = new THREE.CylinderGeometry(0.24, 0.24, gfH + 0.1, 10);
      col.translate(cx + Math.sin(a) * (R - 0.22), (gfH + 0.1) / 2, cz + Math.cos(a) * (R - 0.22));
      colParts.push(col);
    }
    // Overhanging white concrete ring soffit & upper parapet coping
    const slabBot = new THREE.CylinderGeometry(R + 0.12, R + 0.12, 0.34, segs);
    slabBot.translate(cx, gfH + 0.12, cz);
    colParts.push(slabBot);
    const parapet = new THREE.CylinderGeometry(R + 0.2, R + 0.2, 0.45, segs, 1, true);
    parapet.translate(cx, mainH - 0.1, cz);
    colParts.push(parapet);
    const parapetCap = new THREE.RingGeometry(R - 0.3, R + 0.22, segs);
    parapetCap.rotateX(-Math.PI / 2);
    parapetCap.translate(cx, mainH + 0.13, cz);
    colParts.push(parapetCap);
    // Support piers under the west skybridge to BMS
    for (const bx of [-23.4, -21.8]) {
      const pier = new THREE.CylinderGeometry(0.26, 0.28, gfH + 0.1, 8);
      pier.translate(bx, (gfH + 0.1) / 2, -46.6);
      colParts.push(pier);
    }
    const trimMesh = new THREE.Mesh(mergeParts(colParts), this.mats.concreteLight);
    trimMesh.castShadow = trimMesh.receiveShadow = true;
    this.group.add(trimMesh);

    // 3. Smooth curved upper drum with seamless integer-tiled cylindrical UVs
    const upH = mainH - gfH;
    const upGeo = new THREE.CylinderGeometry(R, R, upH, segs, 1, true);
    const uv = upGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * (upH / 7));
    upGeo.translate(cx, gfH + upH / 2, cz);
    const upMesh = new THREE.Mesh(upGeo, this.mats.gibbUpper);
    upMesh.castShadow = upMesh.receiveShadow = true;
    this.group.add(upMesh);

    // 4. Recessed upper rooftop drum (lantern/clerestory) + dark flat roof discs
    const crownR = 7.7, crownBodyH = crownH - mainH;
    const crownWall = new THREE.CylinderGeometry(crownR, crownR, crownBodyH, 40, 1, true);
    const cuv = crownWall.attributes.uv;
    for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cuv.getX(i) * 4, 0.25 + cuv.getY(i) * 0.4);
    crownWall.translate(cx, mainH + crownBodyH / 2, cz);
    const crownMesh = new THREE.Mesh(crownWall, this.mats.gibbUpper);
    crownMesh.castShadow = true;
    this.group.add(crownMesh);

    const mainRoof = new THREE.CircleGeometry(R - 0.1, segs);
    mainRoof.rotateX(-Math.PI / 2);
    mainRoof.translate(cx, mainH + 0.04, cz);
    const crownRoof = new THREE.CircleGeometry(crownR + 0.08, 40);
    crownRoof.rotateX(-Math.PI / 2);
    crownRoof.translate(cx, crownH + 0.04, cz);
    // Connecting bridge to BMS slab (x = -24.6..-20.8, z = -48.0..-45.3)
    const bridge = new THREE.BoxGeometry(3.8, mainH - gfH - 0.3, 2.7);
    bridge.translate(-22.7, gfH + (mainH - gfH - 0.3) / 2, -46.65);
    this.group.add(new THREE.Mesh(bridge, this.mats.gibbUpper));
    this.group.add(new THREE.Mesh(mergeParts([mainRoof, crownRoof]), this.mats.flatRoof));

    // Soft warm evening foyer light spilling from the glazed round Aula ground hall
    const foyerLight = new THREE.PointLight(0xffcb84, 24, 34, 1.6);
    foyerLight.position.set(cx + 2.5, 3.0, cz + R + 1.4);
    this.group.add(foyerLight);
    this.lampLights.push({ light: foyerLight, base: 24, phase: 4.2 });

    return { cx, cz, R, mainH, crownH };
  }

  // Architectural bold lowercase "gibb" signs on the Aula roof, BMS gable, and Gewerbeschule facade.
  buildSigns(aulaInfo) {
    // High-contrast dark anthracite architectural fascia with crisp glowing white lowercase "gibb"
    // and gibb-green accent rule so it stays razor-sharp against the bright dusk sky.
    const frontTex = tex(logoCanvas(1024, 384, '#1b2025', '#f5f5f0', '#5a9256'), 1, 1, true);
    frontTex.wrapS = frontTex.wrapT = THREE.ClampToEdgeWrapping;
    const glowTex = tex(logoCanvas(1024, 384, '#000000', '#fff7e8', '#4f8a4b'), 1, 1, true);
    glowTex.wrapS = glowTex.wrapT = THREE.ClampToEdgeWrapping;

    const faceMat = new THREE.MeshStandardMaterial({
      map: frontTex, roughness: 0.42, metalness: 0.12,
      emissive: 0xffffff, emissiveMap: glowTex, emissiveIntensity: 0.72,
    });
    const frameMat = this.mats.darkSteel;

    const makeCabinet = (w, h, d, doubleSided = false) => {
      const mats = [frameMat, frameMat, frameMat, frameMat, faceMat, doubleSided ? faceMat : frameMat];
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
      m.castShadow = true;
      return m;
    };

    // 1. Rooftop steel-mounted sign standing cleanly on the round Aula parapet (facing the yard).
    if (aulaInfo) {
      const { cx, cz, R, mainH } = aulaInfo;
      const a = Math.atan2(-cx, -cz);
      const sx = Math.sin(a), sz = Math.cos(a);
      const dist = R - 1.15;
      const px = cx + sx * dist, pz = cz + sz * dist;
      const w = 7.2, h = 2.45;

      const sign = makeCabinet(w, h, 0.28, true);
      sign.position.set(px, mainH + 2.05, pz);
      sign.rotation.y = a;
      this.group.add(sign);

      // Two slim steel roof legs connecting the cabinet solidly onto the parapet
      const legParts = [];
      const rx = Math.cos(a), rz = -Math.sin(a);
      for (const off of [-2.2, 2.2]) {
        const leg = new THREE.CylinderGeometry(0.085, 0.095, 1.1, 8);
        leg.translate(px + rx * off, mainH + 0.48, pz + rz * off);
        legParts.push(leg);
      }
      this.group.add(new THREE.Mesh(mergeParts(legParts), frameMat));
    }

    // 2. Wall-mounted sign flush on the BMS south gable (C8023B86, edge (-31.5,-22.8)->(-21.8,-26.4)).
    const bmsAngle = Math.atan2(0.35, 0.94);
    const bmsSign = makeCabinet(6.2, 2.05, 0.22, false);
    bmsSign.position.set(-26.6 + 0.35 * 0.22, 16.4, -24.6 + 0.94 * 0.22);
    bmsSign.rotation.y = bmsAngle;
    this.group.add(bmsSign);

    // 3. Wall-mounted sign flush on the Gewerbeschule main NE slab (8A5F26D5, clear of top-centre HUD).
    const gsAngle = Math.atan2(0.74, -0.67);
    const gsSign = makeCabinet(7.8, 2.55, 0.24, false);
    gsSign.position.set(2.4 + 0.74 * 0.32, 15.8, 68.1 - 0.67 * 0.32);
    gsSign.rotation.y = gsAngle;
    this.group.add(gsSign);
  }

  update(dt) {
    dt = Math.min(dt || 0, 0.1);
    this.time += dt;
    this.crowdHype = Math.max(0, (this.crowdHype || 0) - dt * 0.4);
    const t = this.time;
    const boost = 1 + this.crowdHype * 0.22;
    for (let i = 0; i < this.lampLights.length; i++) {
      const L = this.lampLights[i];
      L.light.intensity = L.base * boost * (0.97 + Math.sin(t * 2.1 + L.phase) * 0.03);
    }
    for (let i = 0; i < this.lampHalos.length; i++) {
      const H = this.lampHalos[i];
      const sc = 3.1 + Math.sin(t * 1.8 + H.phase) * 0.12 + this.crowdHype * 0.35;
      H.sprite.scale.set(sc, sc, 1);
    }
  }
}
