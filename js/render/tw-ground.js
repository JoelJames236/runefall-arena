// Thornwater Gorge — the ground: four hand-painted, seamlessly tiling textures (grass, dirt, cobblestone, rock)
// painted on canvases at load time, and a terrain material that blends them per vertex (`splat` = weights) with a
// height blend, so the edges between grass and stone look like stones poking through the grass, not a smear.
// Matte on purpose: a glossy ground mirrors the sky and reads as water.
import * as THREE from 'three';

const N = 512; // texture size (one tile)
// ---------------------------------------------------------------- tiling noise
function makeNoise(seed) {
  const hash = (x, y) => { const s = Math.sin((x * 127.1 + y * 311.7 + seed * 74.7)) * 43758.5453; return s - Math.floor(s); };
  // value noise on a lattice that wraps every `p` cells → tiles seamlessly
  const vn = (x, y, p) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const m = a => ((a % p) + p) % p, h = (a, b) => hash(m(a), m(b));
    return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
  };
  // fbm of the texture coordinate (0..1), base period p cells
  return (s, t, p = 4, oct = 4) => { let a = 0, w = 0.5, f = p, n = 0; for (let o = 0; o < oct; o++) { a += vn(s * f, t * f, f) * w; n += w; w *= 0.5; f *= 2; } return a / n; };
}
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function canvas() { const c = document.createElement('canvas'); c.width = c.height = N; return c; }
function paintPixels(cv, fn) {
  const ctx = cv.getContext('2d'), img = ctx.createImageData(N, N), d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = fn(x / N, y / N), i = (y * N + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }
  ctx.putImageData(img, 0, 0); return ctx;
}
// draw something at (x, y) and at its wrapped copies, so strokes across an edge continue on the other side
function wrapDraw(ctx, x, y, r, draw) {
  for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { const X = x + ox, Y = y + oy; if (X > -r && X < N + r && Y > -r && Y < N + r) draw(X, Y); }
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------------------------------------------------------------- the four materials
function paintGrass() {
  const cv = canvas(), nz = makeNoise(3);
  const dark = [50, 80, 36], mid = [80, 116, 50], light = [118, 150, 66];
  const ctx = paintPixels(cv, (s, t) => { const n = nz(s, t, 3, 5), m = nz(s + 0.3, t + 0.7, 8, 3); const c = n < 0.5 ? mixc(dark, mid, n * 2) : mixc(mid, light, (n - 0.5) * 2); return mixc(c, [118, 132, 62], clamp(m - 0.55) * 1.2); });
  // painted blade strokes: clumps of short curved lines, lighter on top
  const R = rng(11); ctx.lineCap = 'round';
  for (let i = 0; i < 9000; i++) {
    const x = R() * N, y = R() * N, len = 3 + R() * 7, a = -Math.PI / 2 + (R() - 0.5) * 0.9, k = R();
    const col = k < 0.45 ? `rgba(48,82,30,${0.35 + R() * 0.3})` : k < 0.85 ? `rgba(108,146,62,${0.3 + R() * 0.3})` : `rgba(160,182,96,${0.35 + R() * 0.3})`;
    ctx.strokeStyle = col; ctx.lineWidth = 1 + R() * 1.6;
    wrapDraw(ctx, x, y, 12, (X, Y) => { ctx.beginPath(); ctx.moveTo(X, Y); ctx.quadraticCurveTo(X + Math.cos(a + 0.4) * len * 0.5, Y + Math.sin(a + 0.4) * len * 0.5, X + Math.cos(a) * len, Y + Math.sin(a) * len); ctx.stroke(); });
  }
  // a few tiny flowers
  for (let i = 0; i < 70; i++) { const x = R() * N, y = R() * N, c = R() < 0.6 ? '#f2e27a' : '#f4f0ea'; ctx.fillStyle = c; wrapDraw(ctx, x, y, 3, (X, Y) => { ctx.beginPath(); ctx.arc(X, Y, 1.4, 0, 6.3); ctx.fill(); }); }
  return cv;
}
function paintDirt() {
  const cv = canvas(), nz = makeNoise(7);
  const a = [92, 78, 62], b = [128, 110, 86], c2 = [156, 138, 110];
  const ctx = paintPixels(cv, (s, t) => { const n = nz(s, t, 4, 5), m = nz(s, t, 16, 2); let c = n < 0.5 ? mixc(a, b, n * 2) : mixc(b, c2, (n - 0.5) * 2); return mixc(c, [92, 70, 48], clamp((0.45 - m) * 2)); });
  // pebbles: small ellipses with a light top and a dark shadow
  const R = rng(5);
  for (let i = 0; i < 520; i++) {
    const x = R() * N, y = R() * N, r = 1.5 + R() * 4.5, g = 110 + R() * 70 | 0;
    wrapDraw(ctx, x, y, r * 2, (X, Y) => {
      ctx.fillStyle = 'rgba(40,28,18,0.45)'; ctx.beginPath(); ctx.ellipse(X + 1, Y + 1.5, r, r * 0.7, 0, 0, 6.3); ctx.fill();
      ctx.fillStyle = `rgb(${g},${g - 8},${g - 20})`; ctx.beginPath(); ctx.ellipse(X, Y, r, r * 0.7, 0, 0, 6.3); ctx.fill();
      ctx.fillStyle = 'rgba(255,245,220,0.35)'; ctx.beginPath(); ctx.ellipse(X - r * 0.25, Y - r * 0.25, r * 0.45, r * 0.3, 0, 0, 6.3); ctx.fill();
    });
  }
  return cv;
}
function paintCobble() {
  // Voronoi stones on a wrapping 7×7 jittered grid: grout in the gaps, each stone bevelled and tinted on its own
  const cv = canvas(), nz = makeNoise(13), R = rng(21), G = 7, pts = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) pts.push({ x: (i + 0.2 + R() * 0.6) / G, y: (j + 0.2 + R() * 0.6) / G, t: R() });
  paintPixels(cv, (s, t) => {
    let d1 = 9, d2 = 9, best = null;
    const ci = Math.floor(s * G), cj = Math.floor(t * G);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj, p = pts[((j % G + G) % G) * G + ((i % G + G) % G)];
      const px = p.x + Math.floor(i / G), py = p.y + Math.floor(j / G), d = Math.hypot(s - px, t - py);
      if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
    }
    const edge = (d2 - d1) * G, n = nz(s, t, 8, 3);
    if (edge < 0.09) return mixc([58, 52, 46], [84, 90, 52], clamp(n * 1.5 - 0.4)); // grout, a little moss
    const bevel = clamp((edge - 0.09) / 0.22), base = 150 + best.t * 50 - (1 - bevel) * 55 + (n - 0.5) * 40;
    return [base, base - 4, base - 12];
  });
  return cv;
}
function paintRock() {
  const cv = canvas(), nz = makeNoise(17);
  paintPixels(cv, (s, t) => {
    const strata = nz(s * 0.5, t * 2, 2, 4), n = nz(s, t, 6, 5), crack = Math.abs(nz(s, t, 5, 3) - 0.5);
    let v = 92 + strata * 70 + (n - 0.5) * 60;
    if (crack < 0.025) v *= 0.55;
    const c = [v + 6, v, v - 10];
    return mixc(c, [96, 112, 66], clamp((nz(s + 0.5, t, 4, 3) - 0.62) * 3)); // moss patches
  });
  return cv;
}
// ---------------------------------------------------------------- architecture (keeps)
// Sunward ashlar: courses of cut pale stone blocks, bevelled (light top edge, shadow under), mortar lines
function paintAshlar() {
  const cv = canvas(), ctx = cv.getContext('2d'), nz = makeNoise(31), R = rng(41), rows = 6, rh = N / rows;
  ctx.fillStyle = '#6e685e'; ctx.fillRect(0, 0, N, N);
  for (let r = 0; r < rows; r++) {
    let x = R() * N * 0.3;
    const y = r * rh, end = x + N;
    while (x < end) {
      const w = N / 3 * (0.6 + R() * 0.5), v = 188 + (R() - 0.5) * 36, warm = R() * 10;
      wrapDraw(ctx, x + w / 2, y + rh / 2, w, X => {
        const x0 = X - w / 2 + 2, y0 = y + 2, ww = w - 4, hh = rh - 4;
        ctx.fillStyle = `rgb(${v + warm | 0},${v | 0},${v - 10 - warm | 0})`; ctx.fillRect(x0, y0, ww, hh);
        ctx.fillStyle = 'rgba(255,250,235,0.35)'; ctx.fillRect(x0, y0, ww, 4);
        ctx.fillStyle = 'rgba(40,34,28,0.35)'; ctx.fillRect(x0, y0 + hh - 5, ww, 5); ctx.fillRect(x0 + ww - 4, y0, 4, hh);
      });
      x += w;
    }
  }
  // weathering: soft stains and a few chips, so the stone isn't plastic
  const img = ctx.getImageData(0, 0, N, N), d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const k = 0.86 + nz(x / N, y / N, 4, 5) * 0.26, i = (y * N + x) * 4; d[i] *= k; d[i + 1] *= k; d[i + 2] *= k; }
  ctx.putImageData(img, 0, 0);
  return cv;
}
// Ember basalt: big irregular dark stones (stretched Voronoi), black mortar, a red-brown cast
function paintBasalt() {
  const cv = canvas(), nz = makeNoise(37), R = rng(43), GX = 4, GY = 7, pts = [];
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) pts.push({ x: (i + 0.15 + R() * 0.7) / GX, y: (j + 0.15 + R() * 0.7) / GY, t: R() });
  paintPixels(cv, (s, t) => {
    let d1 = 9, d2 = 9, best = null; const ci = Math.floor(s * GX), cj = Math.floor(t * GY);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj, p = pts[((j % GY + GY) % GY) * GX + ((i % GX + GX) % GX)];
      const px = p.x + Math.floor(i / GX), py = p.y + Math.floor(j / GY), d = Math.hypot((s - px) * GX, (t - py) * GY);
      if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
    }
    const e = d2 - d1, n = nz(s, t, 6, 4);
    if (e < 0.07) return [24, 20, 19];
    const b = clamp((e - 0.07) / 0.3), v = 62 + best.t * 26 - (1 - b) * 26 + (n - 0.5) * 30;
    return [v + 10, v + 2, v - 2];
  });
  return cv;
}
// Sunward roof: rows of scalloped royal-blue slates
function paintSlate() {
  const cv = canvas(), ctx = cv.getContext('2d'), R = rng(47), rows = 12, rh = N / rows, tw = N / 10;
  ctx.fillStyle = '#16233f'; ctx.fillRect(0, 0, N, N);
  for (let r = rows; r >= -1; r--) for (let k = -1; k <= 10; k++) {
    const x = k * tw + (r % 2) * tw / 2, y = r * rh, v = R();
    const col = `rgb(${38 + v * 22 | 0},${62 + v * 30 | 0},${128 + v * 40 | 0})`;
    wrapDraw(ctx, x + tw / 2, y, tw, X => {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(X - tw / 2 + 1, y - rh * 0.4); ctx.lineTo(X + tw / 2 - 1, y - rh * 0.4); ctx.lineTo(X + tw / 2 - 1, y + rh * 0.55);
      ctx.arc(X, y + rh * 0.55, tw / 2 - 1, 0, Math.PI); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(200,220,255,0.22)'; ctx.fillRect(X - tw / 2 + 2, y - rh * 0.4, tw - 4, 3);
    });
  }
  return cv;
}
// Ember roof: rough dark shingles with ragged edges and gaps, some patched with red-dyed hide
function paintShingle() {
  const cv = canvas(), ctx = cv.getContext('2d'), R = rng(53), rows = 10, rh = N / rows;
  ctx.fillStyle = '#1a1210'; ctx.fillRect(0, 0, N, N);
  for (let r = rows; r >= -1; r--) {
    let x = R() * 30;
    while (x < N + 40) {
      const w = 28 + R() * 30, v = R(), y = r * rh, hide = R() < 0.12;
      const col = hide ? `rgb(${120 + v * 30 | 0},${28 + v * 10 | 0},${24 | 0})` : `rgb(${70 + v * 30 | 0},${48 + v * 20 | 0},${34 + v * 12 | 0})`;
      wrapDraw(ctx, x + w / 2, y, w, X => {
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(X - w / 2, y - rh * 0.5); ctx.lineTo(X + w / 2 - 2, y - rh * 0.5);
        ctx.lineTo(X + w / 2 - 2 + (R() - 0.5) * 4, y + rh * 0.6 + R() * 6); ctx.lineTo(X - w / 2 + (R() - 0.5) * 4, y + rh * 0.6 + R() * 6); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(20,12,8,0.5)'; ctx.lineWidth = 1; for (let g = 0; g < 3; g++) { const gx = X - w / 2 + 4 + R() * (w - 8); ctx.beginPath(); ctx.moveTo(gx, y - rh * 0.4); ctx.lineTo(gx + (R() - 0.5) * 3, y + rh * 0.5); ctx.stroke(); }
      });
      x += w;
    }
  }
  return cv;
}
// weathered vertical planks with grain, dark gaps and iron nails
function paintPlanks() {
  const cv = canvas(), nz = makeNoise(59), pw = N / 8;
  const ctx = paintPixels(cv, (s, t) => {
    const k = Math.floor(s * 8), u = s * 8 - k;
    if (u < 0.04 || u > 0.96) return [22, 15, 10];
    const tone = makeNoiseTone(k), grain = nz(s * 0.2 + k * 0.13, t, 2, 4), streak = Math.sin((t * 40 + grain * 9) * Math.PI) * 0.5 + 0.5;
    const v = 82 + tone * 30 + streak * 14 - (grain - 0.5) * 30;
    return [v + 14, v, v - 14];
  });
  ctx.fillStyle = '#2a2a2e'; for (let k = 0; k < 8; k++) for (const y of [0.12, 0.88]) { ctx.beginPath(); ctx.arc(k * pw + pw / 2, y * N, 3, 0, 6.3); ctx.fill(); }
  return cv;
}
const makeNoiseTone = k => { const s = Math.sin(k * 91.7 + 3.1) * 43758.5453; return s - Math.floor(s); };
// team crests for banners and the gate tympanum (256 × 512, banner-shaped, cut swallowtail at the bottom)
export function paintCrest(side) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512; const c = cv.getContext('2d');
  const field = side ? '#8e1616' : '#23479e', edge = side ? '#141010' : '#e3b341';
  c.fillStyle = edge; c.beginPath(); c.moveTo(0, 0); c.lineTo(256, 0); c.lineTo(256, 470); c.lineTo(128, 400); c.lineTo(0, 470); c.closePath(); c.fill();
  c.fillStyle = field; c.beginPath(); c.moveTo(14, 14); c.lineTo(242, 14); c.lineTo(242, 446); c.lineTo(128, 382); c.lineTo(14, 446); c.closePath(); c.fill();
  if (side === 0) {
    // the Sunward Crown: a golden sun rising behind a white tower
    c.save(); c.translate(128, 190);
    c.fillStyle = '#f0c445'; for (let i = 0; i < 16; i++) { c.rotate(Math.PI / 8); c.beginPath(); c.moveTo(-9, -52); c.lineTo(0, -98 - (i % 2) * 14); c.lineTo(9, -52); c.fill(); }
    c.beginPath(); c.arc(0, 0, 54, 0, 6.3); c.fill();
    c.fillStyle = '#f4f1ea'; c.fillRect(-26, -30, 52, 130); for (let i = 0; i < 3; i++) c.fillRect(-26 + i * 21, -46, 12, 18);
    c.fillStyle = '#23479e'; c.beginPath(); c.moveTo(-9, 100); c.lineTo(-9, 64); c.arc(0, 64, 9, Math.PI, 0); c.lineTo(9, 100); c.fill();
    c.restore();
  } else {
    // the Ember Warband: a horned skull wreathed in flame
    c.save(); c.translate(128, 200);
    c.fillStyle = '#ff6a1a'; for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + (i - 4) * 0.33; c.beginPath(); c.moveTo(Math.cos(a) * 40, Math.sin(a) * 40 + 10); c.quadraticCurveTo(Math.cos(a) * 110, Math.sin(a) * 110 - 10, Math.cos(a + 0.15) * 88, Math.sin(a + 0.15) * 88); c.lineTo(Math.cos(a + 0.3) * 40, Math.sin(a + 0.3) * 40 + 10); c.fill(); }
    c.fillStyle = '#e9e2d2';
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * 34, -26); c.quadraticCurveTo(s * 96, -44, s * 92, -110); c.quadraticCurveTo(s * 78, -54, s * 30, -6); c.fill(); }
    c.beginPath(); c.ellipse(0, 0, 46, 52, 0, 0, 6.3); c.fill(); c.fillRect(-28, 34, 56, 34);
    c.fillStyle = '#141010'; for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * 19, -2, 12, 15, s * 0.3, 0, 6.3); c.fill(); }
    c.beginPath(); c.moveTo(0, 16); c.lineTo(-7, 30); c.lineTo(7, 30); c.fill(); for (let i = -2; i <= 2; i++) c.fillRect(i * 11 - 3, 46, 6, 22);
    c.restore();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
let ARCH = null;
export function archTextures() {
  if (ARCH) return ARCH;
  const mk = cv => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  ARCH = { ashlar: mk(paintAshlar()), basalt: mk(paintBasalt()), slate: mk(paintSlate()), shingle: mk(paintShingle()), planks: mk(paintPlanks()) };
  return ARCH;
}

let TEX = null;
export function groundTextures() {
  if (TEX) return TEX;
  const mk = cv => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
  TEX = { grass: mk(paintGrass()), dirt: mk(paintDirt()), cobble: mk(paintCobble()), rock: mk(paintRock()) };
  return TEX;
}

// ---------------------------------------------------------------- the blended terrain material
// geometry needs: position, normal, color (tint), splat (vec4: grass, dirt, cobble, rock)
// scales: metres per tile of each texture
export function groundMaterial(scales = [4.5, 5, 3.2, 7]) {
  const T = groundTextures();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.96, metalness: 0 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { tG: { value: T.grass }, tD: { value: T.dirt }, tC: { value: T.cobble }, tR: { value: T.rock }, uSc: { value: new THREE.Vector4(...scales.map(s => 1 / s)) } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWp;\nvarying vec3 vWn;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvWp = (modelMatrix * vec4(position, 1.0)).xyz;\nvWn = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tG, tD, tC, tR;\nuniform vec4 uSc;\nvarying vec4 vSplat;\nvarying vec3 vWp;\nvarying vec3 vWn;\nfloat lum3(vec3 c) { return dot(c, vec3(0.3, 0.5, 0.2)); }')
      .replace('#include <map_fragment>', `
        vec2 xz = vWp.xz;
        // two scales of grass against visible repetition; rock is projected from the side on steep ground
        vec3 cG = mix(texture2D(tG, xz * uSc.x).rgb, texture2D(tG, xz * uSc.x * 0.31 + 0.37).rgb, 0.4);
        vec3 cD = texture2D(tD, xz * uSc.y).rgb;
        vec3 cC = texture2D(tC, xz * uSc.z).rgb;
        // rock from three sides, so cliffs and steep banks don't smear; steep ground turns to rock whatever the weights say
        vec3 an = abs(normalize(vWn)), bw = pow(an, vec3(4.0)); bw /= dot(bw, vec3(1.0));
        vec3 cR = texture2D(tR, xz * uSc.w).rgb * bw.y + texture2D(tR, vWp.zy * uSc.w).rgb * bw.x + texture2D(tR, vWp.xy * uSc.w).rgb * bw.z;
        vec4 h = vec4(lum3(cG), lum3(cD), lum3(cC) * 1.3, lum3(cR));
        vec4 sp = vSplat; sp.w += smoothstep(0.62, 0.42, an.y) * 2.5;
        vec4 w = sp * (h + 0.25);
        w = w * w * w * w; w /= dot(w, vec4(1.0)) + 1e-6;   // height blend: the taller detail wins at the edge
        diffuseColor.rgb *= cG * w.x + cD * w.y + cC * w.z + cR * w.w;`);
  };
  m.customProgramCacheKey = () => 'tw-ground';
  return m;
}
