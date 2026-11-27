// The Armory: detailed, class-specific armor and weapons for the rigged champions.
//
// Armor is authored in WORLD space against the champion's rest (idle) pose using bone
// landmarks (shoulders, chest, hips, knees, forearms, head), then re-parented to the right
// bone with Object3D.attach() so it keeps its placement and follows every animation.
// Weapons are built along +Y with the grip at the origin (heroes.js solves the hand grip).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { validSpec } from '../data/classes.js';
import { buildRace, buildOutfit } from './outfits.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PI = Math.PI;
const BLACK = new THREE.MeshStandardMaterial({ color: 0x050302, roughness: 1 }); // eye sockets, visor slits (shared)

// ------------------------------------------------------------------ materials (cached per palette)
const cache = new Map();
function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 4;
  return t;
}
// subtle noise used as leather / cloth grain (as a bump map)
let GRAIN = null, WEAVE = null;
function grain() {
  return GRAIN || (GRAIN = canvasTex(256, (g, S) => {
    const img = g.createImageData(S, S);
    for (let i = 0; i < S * S; i++) { const v = 128 + (Math.random() - 0.5) * 70; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    for (let k = 0; k < 60; k++) { g.strokeStyle = `rgba(0,0,0,${Math.random() * 0.25})`; g.lineWidth = 1 + Math.random() * 2; g.beginPath(); const x = Math.random() * S, y = Math.random() * S; g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 60); g.stroke(); }
  }, 2));
}
function weave() {
  return WEAVE || (WEAVE = canvasTex(128, (g, S) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S; i += 4) { g.fillStyle = i % 8 ? '#909090' : '#707070'; g.fillRect(i, 0, 2, S); g.fillStyle = i % 8 ? '#6a6a6a' : '#949494'; g.fillRect(0, i, S, 2); }
  }, 6));
}

// hand-painted albedo textures for weapons (generated once on a canvas, deterministic noise)
const PAINT = {};
function painted(kind) {
  if (PAINT[kind]) return PAINT[kind];
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const t = canvasTex(256, (g, S) => {
    const fill = c => { g.fillStyle = c; g.fillRect(0, 0, S, S); };
    const blot = (n, cols, rmin, rmax, a) => { for (let i = 0; i < n; i++) { g.globalAlpha = a * (0.4 + rnd() * 0.6); g.fillStyle = cols[i % cols.length]; g.beginPath(); g.ellipse(rnd() * S, rnd() * S, rmin + rnd() * (rmax - rmin), rmin + rnd() * (rmax - rmin), rnd() * 3, 0, 7); g.fill(); } g.globalAlpha = 1; };
    const lines = (n, col, w, len, a, vert = false) => { g.strokeStyle = col; for (let i = 0; i < n; i++) { g.globalAlpha = a * (0.3 + rnd() * 0.7); g.lineWidth = w * (0.5 + rnd()); g.beginPath(); const x = rnd() * S, y = rnd() * S, d = (rnd() - 0.5) * len; g.moveTo(x, y); vert ? g.lineTo(x + d * 0.08, y + len * (0.5 + rnd())) : g.lineTo(x + len * (0.4 + rnd()), y + d * 0.3); g.stroke(); } g.globalAlpha = 1; };
    switch (kind) {
      case 'iron': fill('#4b4845'); blot(70, ['#3a3734', '#5a5652', '#433f3b'], 6, 22, 0.5); blot(14, ['#6a3a20', '#5a2e18'], 4, 12, 0.35); lines(90, '#8a8680', 1, 30, 0.35); lines(30, '#26241f', 1.5, 22, 0.4); break;
      case 'steel': fill('#8c9096'); blot(60, ['#7a7e84', '#a0a4aa', '#868a90'], 6, 26, 0.45); lines(120, '#c8ccd2', 1, 40, 0.35); lines(40, '#5a5e64', 1, 24, 0.35); break;
      case 'wood': case 'darkwood': {
        const dark = kind === 'darkwood'; fill(dark ? '#3a2618' : '#6a4a2e');
        for (let x = 0; x < S; x += 3) { g.globalAlpha = 0.25 + rnd() * 0.35; g.fillStyle = rnd() < 0.5 ? (dark ? '#24170e' : '#4a321e') : (dark ? '#4c3422' : '#86603c'); g.fillRect(x + Math.sin(x * 0.07) * 2, 0, 1 + rnd() * 2, S); }
        g.globalAlpha = 1; blot(6, [dark ? '#1a0f08' : '#3a2412'], 4, 9, 0.6); lines(20, dark ? '#120a05' : '#2a1a0c', 1, 60, 0.5, true); break; }
      case 'leather': fill('#4a2e1c'); blot(50, ['#3a2214', '#5a3a24', '#2e1c10'], 5, 18, 0.5); lines(40, '#22140a', 1, 18, 0.4);
        g.strokeStyle = '#c8b090'; g.lineWidth = 2; g.globalAlpha = 0.7; for (let y = 12; y < S; y += 32) { g.setLineDash([6, 6]); g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); } g.setLineDash([]); g.globalAlpha = 1; break;
      case 'bone': fill('#d8ccb0'); blot(50, ['#c8b898', '#e8dcc4', '#b8a888'], 5, 20, 0.5); lines(30, '#8a7a5a', 1, 20, 0.4); break;
      case 'gold': fill('#c8962e'); blot(60, ['#e0b450', '#a87a24', '#f0cc70'], 5, 22, 0.45); lines(60, '#fff0b0', 1, 30, 0.3); break;
      case 'feather': g.clearRect(0, 0, S, S); for (let i = 0; i < S; i += 2) { const w = Math.sin((i / S) * Math.PI) * S * 0.45; g.fillStyle = i % 8 < 4 ? '#7a2a1a' : '#3a1a12'; g.fillRect(S / 2 - w, i, w * 2, 2); } g.fillStyle = '#e8e0d0'; g.fillRect(S / 2 - 2, 0, 4, S); break;
    }
  }, kind === 'feather' ? 1 : 3);
  t.colorSpace = THREE.SRGBColorSpace;
  return (PAINT[kind] = t);
}

export function makeMaterials(TEX) {
  if (cache.has('mats')) return cache.get('mats');
  const metal = (color, rough = 0.32, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 1, normalMap: TEX.metal.normalMap, normalScale: new THREE.Vector2(0.45, 0.45), roughnessMap: TEX.metal.arm, envMapIntensity: 1.3, ...extra });
  const M = {
    steel: metal(0xa4a3a0, 0.34, { envMapIntensity: 1.0 }), darksteel: metal(0x4e4a46, 0.4, { envMapIntensity: 0.9 }), blacksteel: metal(0x2c2a2a, 0.45, { envMapIntensity: 0.8 }),
    gold: metal(0xd2a24c, 0.28), brass: metal(0xb08a48, 0.34), bronze: metal(0x9a6a3a, 0.36), silver: metal(0xd8dce4, 0.22),
    leather: new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.78, metalness: 0, bumpMap: grain(), bumpScale: 0.6 }),
    darkleather: new THREE.MeshStandardMaterial({ color: 0x1c1614, roughness: 0.8, metalness: 0, bumpMap: grain(), bumpScale: 0.6 }),
    crimson: new THREE.MeshStandardMaterial({ color: 0x6a0f12, roughness: 0.92, bumpMap: weave(), bumpScale: 0.4, side: THREE.DoubleSide }),
    royal: new THREE.MeshStandardMaterial({ color: 0x1e2a6a, roughness: 0.9, bumpMap: weave(), bumpScale: 0.4, side: THREE.DoubleSide }),
    ivory: new THREE.MeshStandardMaterial({ color: 0xd8d0bc, roughness: 0.9, bumpMap: weave(), bumpScale: 0.4, side: THREE.DoubleSide }),
    shadowcloth: new THREE.MeshStandardMaterial({ color: 0x15101c, roughness: 0.95, bumpMap: weave(), bumpScale: 0.4, side: THREE.DoubleSide }),
    earth: new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.95, bumpMap: weave(), bumpScale: 0.4, side: THREE.DoubleSide }),
    fur: new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1, metalness: 0, bumpMap: grain(), bumpScale: 1.2, flatShading: true }),
    greyfur: new THREE.MeshStandardMaterial({ color: 0x7a746c, roughness: 1, metalness: 0, bumpMap: grain(), bumpScale: 1.2, flatShading: true }),
    bone: new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.7, metalness: 0, bumpMap: grain(), bumpScale: 0.5 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5a3e2a, roughness: 0.85, map: TEX.wood.map, normalMap: TEX.wood.normalMap, normalScale: new THREE.Vector2(0.7, 0.7) }),
    darkwood: new THREE.MeshStandardMaterial({ color: 0x3a281c, roughness: 0.85, map: TEX.wood.map, normalMap: TEX.wood.normalMap, normalScale: new THREE.Vector2(0.7, 0.7) }),
    rope: new THREE.MeshStandardMaterial({ color: 0x6a5238, roughness: 1, bumpMap: weave(), bumpScale: 1 }),
  };
  // shared per (colour, strength): identical glows reuse one material, so they merge into one draw call
  const memo = (fn) => { const c = new Map(); return (...a) => { const key = a.join('|'); if (!c.has(key)) { const m = fn(...a); m.userData.shared = true; c.set(key, m); } return c.get(key); }; };
  M.rune = memo((color, i = 2.6) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i, roughness: 0.3, metalness: 0 }));
  M.glow = memo((color, o = 0.3) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false }));
  M.gem = memo((color) => new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 }));
  // hand-painted weapon materials (match the painted look of the generated champions)
  M.pIron = new THREE.MeshStandardMaterial({ map: painted('iron'), roughness: 0.55, metalness: 0.75, envMapIntensity: 0.9 });
  M.pSteel = new THREE.MeshStandardMaterial({ map: painted('steel'), roughness: 0.32, metalness: 0.9, envMapIntensity: 1.2 });
  M.pEdge = new THREE.MeshStandardMaterial({ color: 0xe6e8ec, roughness: 0.18, metalness: 1, envMapIntensity: 1.5 });
  M.pWood = new THREE.MeshStandardMaterial({ map: painted('wood'), roughness: 0.8, metalness: 0 });
  M.pDarkWood = new THREE.MeshStandardMaterial({ map: painted('darkwood'), roughness: 0.8, metalness: 0 });
  M.pLeather = new THREE.MeshStandardMaterial({ map: painted('leather'), roughness: 0.75, metalness: 0 });
  M.pBone = new THREE.MeshStandardMaterial({ map: painted('bone'), roughness: 0.65, metalness: 0 });
  M.pGold = new THREE.MeshStandardMaterial({ map: painted('gold'), roughness: 0.3, metalness: 1, envMapIntensity: 1.3 });
  M.pRed = new THREE.MeshStandardMaterial({ color: 0x7a1410, roughness: 0.9, side: THREE.DoubleSide });
  M.pFeather = new THREE.MeshStandardMaterial({ map: painted('feather'), roughness: 0.95, side: THREE.DoubleSide, alphaTest: 0.4, transparent: false });
  for (const v of Object.values(M)) if (v && v.isMaterial) v.userData.shared = true; // shared by every champion (see Character.setOpacity)
  BLACK.userData.shared = true;
  cache.set('mats', M);
  return M;
}

// ------------------------------------------------------------------ geometry helpers
const mesh = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; return m; };
const sph = (r, ws = 18, hs = 12, ...rest) => new THREE.SphereGeometry(r, ws, hs, ...rest);
const cyl = (rt, rb, h, s = 14, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
const cone = (r, h, s = 10) => new THREE.ConeGeometry(r, h, s);
const tor = (r, t, rs = 8, ts = 24, arc = PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
function tube(points, r, seg = 20, rs = 6) { return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), seg, r, rs, false); }
function extrude(pts, depth, bevel = 0.004) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth / 2); g.computeVertexNormals();
  return g;
}
// curved horn: a tapered tube along an arc
function horn(len, r, curl, mat) {
  const g = new THREE.Group(); const n = 8;
  for (let i = 0; i < n; i++) {
    const u0 = i / n, u1 = (i + 1) / n;
    const p = u => V(0, Math.sin(u * curl) * len / curl, (1 - Math.cos(u * curl)) * len / curl);
    const a = p(u0), b = p(u1), mid = a.clone().add(b).multiplyScalar(0.5);
    const seg = mesh(cyl(r * (1 - u1 * 0.85), r * (1 - u0 * 0.85), a.distanceTo(b) * 1.05, 8), mat);
    seg.position.copy(mid); seg.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
    g.add(seg);
  }
  return g;
}
function rivets(group, pts, r, mat) { for (const p of pts) { const m = mesh(sph(r, 6, 4), mat, false); m.position.copy(p); group.add(m); } }
function spike(r, h, mat) { return mesh(cone(r, h, 8), mat); }

// ---- weapon detail helpers
// spiral leather / cord wrap around a shaft from y0 to y1
function helixWrap(y0, y1, r, turns, mat, w = 0.0065) {
  const pts = [], n = Math.max(8, Math.round(turns * 10));
  for (let i = 0; i <= n; i++) { const u = i / n, a = u * turns * PI * 2; pts.push(V(Math.cos(a) * r, y0 + (y1 - y0) * u, Math.sin(a) * r)); }
  return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, w, 4, false), mat, false);
}
// turned (lathe) part from [radius, y] pairs, bottom → top
function turned(profile, mat, seg = 14) { return mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat); }
// tube whose radius tapers from r0 to r1 along its length
function taperTube(points, r0, r1, mat, seg = 24, rs = 7) {
  const curve = new THREE.CatmullRomCurve3(points), geo = new THREE.TubeGeometry(curve, seg, 1, rs, false), p = geo.attributes.position;
  const frames = curve.computeFrenetFrames(seg, false), c = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const u = i / seg, r = r0 + (r1 - r0) * u; curve.getPointAt(u, c);
    for (let j = 0; j <= rs; j++) { const k = i * (rs + 1) + j; const v = V(p.getX(k), p.getY(k), p.getZ(k)).sub(c).multiplyScalar(r).add(c); p.setXYZ(k, v.x, v.y, v.z); }
  }
  geo.computeVertexNormals(); return mesh(geo, mat);
}
// a hanging charm: cord + bead + feather / tooth
function charm(M, x, y, z, { len = 0.12, feather = true, tooth = false, bead = 0xc83a1a } = {}) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  g.add(mesh(cyl(0.0025, 0.0025, len, 3), M.pLeather, false).translateY(-len / 2));
  const b = mesh(sph(0.011, 6, 4), M.rune(bead, 0.4), false); b.position.y = -len * 0.55; g.add(b);
  if (feather) { const f = mesh(new THREE.PlaneGeometry(0.035, 0.12), M.pFeather, false); f.position.y = -len - 0.05; f.rotation.y = 0.4; g.add(f); }
  if (tooth) { const t = mesh(cone(0.009, 0.05, 5), M.pBone, false); t.rotation.x = PI; t.position.y = -len - 0.02; g.add(t); }
  return g;
}
// detailed axe head (+X = cutting edge), centred on the haft; opts: size, notches, beard, back ('spike'|'hammer'|'blade'), runes
function axeHead(M, { s = 1, notches = 3, beard = 1, back = 'spike', runes = null, bodyMat = M.pIron, lash = true, trophy = false } = {}) {
  const h = new THREE.Group();
  // crescent blade with a bearded lower horn; nicks along the edge
  const edgePts = [];
  const N = 24, step = Math.max(2, Math.round(N / (notches + 1)));
  for (let i = 0; i <= N; i++) {
    const u = i / N, a = -1.05 + u * 2.0;
    let r = 0.34 + Math.sin(u * PI) * 0.025;
    if (notches && i > 2 && i < N - 2 && i % step === 0) r -= 0.03; // battle nicks
    edgePts.push([Math.cos(a) * r * s, (Math.sin(a) * 0.3 - (u < 0.4 ? (0.4 - u) * 0.22 * beard : 0)) * s]);
  }
  // the body stops short of the edge; a thinner, bright honed band forms the cutting edge (a tapered look)
  const inner = edgePts.map(([x, y]) => [x - 0.045 * s * Math.cos(Math.atan2(y, x)), y - 0.045 * s * Math.sin(Math.atan2(y, x))]);
  const top = [[0.05 * s, 0.1 * s], [0.13 * s, 0.16 * s]], bot = [[0.15 * s, -0.34 * s * (0.75 + 0.25 * beard)], [0.1 * s, -0.17 * s], [0.05 * s, -0.09 * s]];
  const outline = [...top, ...inner.slice().reverse(), ...bot];
  const sides = back === 'double' ? [1, -1] : [1]; // double-bit: a mirrored second blade on the back
  for (const sx of sides) {
    const mx = pts => pts.map(([x, y]) => [x * sx, y]);
    h.add(mesh(extrude(mx(outline), 0.03 * s, 0.008 * s), bodyMat));
    h.add(mesh(extrude(mx([...edgePts, ...inner.slice().reverse()]), 0.016 * s, 0.004 * s), M.pEdge, false));
  }
  // fuller groove + punched hole
  for (const sx of sides) { const groove = mesh(tube([V(sx * 0.1 * s, 0.1 * s, 0), V(sx * 0.2 * s, 0.02 * s, 0), V(sx * 0.2 * s, -0.12 * s, 0)], 0.008 * s, 10, 4), M.pIron, false); groove.scale.z = 2.4; h.add(groove); }
  for (const sx of sides) {
    const hole = mesh(cyl(0.028 * s, 0.028 * s, 0.05 * s, 12), BLACK, false); hole.rotation.x = PI / 2; hole.position.set(sx * 0.13 * s, -0.05 * s, 0); h.add(hole);
    for (const z of [-1, 1]) { const holeRim = mesh(tor(0.03 * s, 0.006 * s, 5, 16), M.pIron, false); holeRim.position.set(sx * 0.13 * s, -0.05 * s, z * 0.022 * s); h.add(holeRim); }
  }
  // socket with raised bands and rivets
  h.add(turned([[0.036 * s, -0.13 * s], [0.042 * s, -0.12 * s], [0.042 * s, -0.09 * s], [0.038 * s, -0.08 * s], [0.038 * s, 0.08 * s], [0.042 * s, 0.09 * s], [0.042 * s, 0.12 * s], [0.036 * s, 0.13 * s]], M.pIron, 12));
  rivets(h, [V(0.07 * s, 0.07 * s, 0.017 * s), V(0.07 * s, -0.06 * s, 0.017 * s), V(0.07 * s, 0.07 * s, -0.017 * s), V(0.07 * s, -0.06 * s, -0.017 * s)], 0.011 * s, M.pIron);
  // back: spike, hammer poll or a second smaller bit
  if (back === 'spike') { const sp = mesh(extrude([[-0.03 * s, 0.05 * s], [-0.2 * s, 0.02 * s], [-0.26 * s, -0.03 * s], [-0.18 * s, -0.04 * s], [-0.03 * s, -0.05 * s]], 0.024 * s, 0.006 * s), M.pIron); h.add(sp); }
  else if (back === 'hammer') { const hp = mesh(box(0.1 * s, 0.09 * s, 0.07 * s), M.pIron); hp.position.x = -0.08 * s; h.add(hp); const f = mesh(box(0.02 * s, 0.1 * s, 0.08 * s), M.pIron); f.position.x = -0.135 * s; h.add(f); }
  else if (back === 'blade') { const b2 = mesh(extrude([[-0.03 * s, 0.07 * s], [-0.14 * s, 0.14 * s], [-0.2 * s, 0.02 * s], [-0.15 * s, -0.12 * s], [-0.03 * s, -0.06 * s]], 0.022 * s, 0.006 * s), bodyMat); h.add(b2); }
  const tsp = spike(0.02 * s, 0.13 * s, M.pIron); tsp.position.y = 0.19 * s; h.add(tsp);
  // rope lashing above and below the head
  if (lash) { h.add(helixWrap(0.135 * s, 0.2 * s, 0.03 * s, 3, M.pLeather, 0.006 * s)); h.add(helixWrap(-0.2 * s, -0.135 * s, 0.03 * s, 3, M.pLeather, 0.006 * s)); }
  if (runes) for (const sx of sides) for (let i = 0; i < 3; i++) { const r = mesh(box(0.05 * s, 0.012 * s, 0.032 * s), M.rune(runes, 2.6), false); r.position.set(sx * 0.22 * s, (0.08 - i * 0.07) * s, 0); r.rotation.z = sx * 0.3; h.add(r); }
  if (trophy) { h.add(charm(M, 0.02 * s, -0.2 * s, 0.02, { len: 0.1, feather: false, tooth: true, bead: 0x8a1a14 })); h.add(charm(M, -0.02 * s, -0.2 * s, -0.02, { len: 0.14, feather: false, tooth: true, bead: 0xe8dcc0 })); }
  return h;
}
// shaft with grain, wrapped grip, ferrules and a pommel
function haft(M, { y0 = -0.26, y1 = 0.75, r = 0.024, mat = M.pDarkWood, grip = [-0.18, 0.12], wrapMat = M.pLeather, pommel = 'spike', bands = [] } = {}) {
  const g = new THREE.Group();
  g.add(turned([[r * 0.9, y0], [r, y0 + 0.02], [r * 1.05, (y0 + y1) / 2], [r * 0.95, y1]], mat, 10));
  g.add(mesh(cyl(r * 1.12, r * 1.12, grip[1] - grip[0], 10), wrapMat).translateY((grip[0] + grip[1]) / 2));
  g.add(helixWrap(grip[0], grip[1], r * 1.16, (grip[1] - grip[0]) / 0.03, M.pLeather, 0.0045));
  for (const y of [grip[0] - 0.012, grip[1] + 0.012, ...bands]) g.add(turned([[r * 1.1, y - 0.016], [r * 1.35, y - 0.008], [r * 1.35, y + 0.008], [r * 1.1, y + 0.016]], M.pIron, 10));
  if (pommel === 'spike') { g.add(turned([[0.001, y0 - 0.09], [r * 0.7, y0 - 0.04], [r * 1.3, y0 - 0.01], [r * 1.1, y0 + 0.02]], M.pIron, 10)); }
  else if (pommel === 'ball') { const p = mesh(sph(r * 1.6, 12, 8), M.pGold); p.position.y = y0 - 0.02; g.add(p); }
  return g;
}

// ------------------------------------------------------------------ armor pieces (local space, +X = outward, +Y = up, +Z = forward)
function pauldron(M, { r = 0.14, plates = 3, mat, trim, spikes = 0, skull = false, wing = null }) {
  const g = new THREE.Group();
  for (let i = 0; i < plates; i++) {
    const rr = r * (1 - i * 0.1);
    const p = mesh(sph(rr, 20, 10, 0, PI * 2, 0, PI * 0.5), mat);
    p.scale.set(1.15, 0.72, 1.05); p.position.set(i * r * 0.18, -i * r * 0.42, 0); p.rotation.z = -0.35 - i * 0.12;
    g.add(p);
    // trim rides the plate's rim (child of the plate, so it shares its scale and tilt)
    const t = mesh(tor(rr, 0.012 / 0.9, 6, 28), trim, false); t.rotation.x = PI / 2; p.add(t);
  }
  rivets(g, [V(r * 0.2, r * 0.55, r * 0.6), V(r * 0.2, r * 0.55, -r * 0.6), V(r * 0.7, r * 0.2, 0)], 0.012, trim);
  for (let i = 0; i < spikes; i++) { const s = spike(0.028, 0.14 + i * 0.03, M.darksteel); s.position.set(r * (0.1 + i * 0.25), r * 0.62 - i * 0.03, (i - (spikes - 1) / 2) * 0.07); s.rotation.z = -0.5 - i * 0.2; g.add(s); }
  if (skull) { const sk = skullMesh(M, 0.07); sk.position.set(r * 0.85, r * 0.05, 0); sk.rotation.y = PI / 2; g.add(sk); }
  if (wing) {
    for (let k = 0; k < 4; k++) { const f = mesh(extrude([[0, 0], [0.05, 0.01], [0.2 - k * 0.03, 0.09 + k * 0.04], [0.02, 0.03]], 0.008, 0.002), wing); f.position.set(r * 0.3, r * 0.4, -0.02 - k * 0.02); f.rotation.set(0, -0.3, 0.6 + k * 0.18); g.add(f); }
  }
  return g;
}

function skullMesh(M, s) {
  const g = new THREE.Group();
  const cr = mesh(sph(s, 14, 10), M.bone); cr.scale.set(0.9, 0.85, 1.05); g.add(cr);
  const jaw = mesh(box(s * 1.1, s * 0.45, s * 0.8), M.bone); jaw.position.set(0, -s * 0.75, s * 0.2); g.add(jaw);
  const eyeM = BLACK;
  for (const x of [-1, 1]) { const e = mesh(sph(s * 0.26, 8, 6), eyeM, false); e.position.set(x * s * 0.36, -s * 0.15, s * 0.82); g.add(e); }
  const nose = mesh(cone(s * 0.12, s * 0.25, 3), eyeM, false); nose.position.set(0, -s * 0.45, s * 0.9); nose.rotation.x = PI; g.add(nose);
  return g;
}

// cloth panel (cape / tabard): slightly curved plane, optional ragged hem
function clothPanel(w, h, mat, { curve = 0.05, ragged = 0, trim = null } = {}) {
  const geo = new THREE.PlaneGeometry(w, h, 6, 10);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, -Math.cos((x / w) * PI) * curve + (y < -h * 0.42 && ragged ? Math.sin(x * 60) * ragged : 0));
    if (ragged && y < -h * 0.45) p.setY(i, y + (Math.abs(Math.sin(x * 37)) * ragged * 3));
  }
  geo.translate(0, -h / 2, 0); geo.computeVertexNormals();
  const m = mesh(geo, mat); const g = new THREE.Group(); g.add(m);
  if (trim) { const t = mesh(box(w, 0.025, 0.012), trim, false); t.position.y = -0.02; g.add(t); }
  return g;
}

function helmGreat(M, r, { crest = M.crimson, horns = false }) {
  const g = new THREE.Group();
  const dome = mesh(sph(r, 22, 16, 0, PI * 2, 0, PI * 0.62), M.steel); dome.scale.set(1, 1.08, 1.08); g.add(dome);
  const face = mesh(cyl(r * 0.98, r * 1.02, r * 1.05, 22, true), M.steel); face.position.y = -r * 0.42; face.scale.z = 1.08; g.add(face);
  const slit = mesh(box(r * 1.25, r * 0.08, r * 0.2), BLACK, false); slit.position.set(0, -r * 0.12, r * 1.0); g.add(slit);
  const ridge = mesh(box(r * 0.08, r * 1.1, r * 0.08), M.gold); ridge.position.set(0, -r * 0.3, r * 1.05); g.add(ridge);
  const brow = mesh(tor(r * 1.03, 0.012, 6, 36), M.gold, false); brow.rotation.x = PI / 2; brow.position.y = r * 0.02; brow.scale.z = 1.08; g.add(brow);
  for (let i = 0; i < 6; i++) { const h = mesh(sph(r * 0.05, 6, 4), M.blacksteel, false); h.position.set(Math.sin(i * 0.35 - 0.9) * r * 0.75, -r * 0.6, r * 0.84 + Math.cos(i) * 0.005); g.add(h); }
  if (crest) { const c = mesh(box(r * 0.12, r * 0.5, r * 1.6), crest); c.position.set(0, r * 1.15, -r * 0.1); g.add(c); }
  if (horns) for (const s of [-1, 1]) { const h = horn(r * 2.4, r * 0.2, 1.8, M.bone); h.position.set(s * r * 0.85, r * 0.35, 0); h.rotation.set(-0.3, 0, -s * 1.25); g.add(h); }
  return g;
}

// ------------------------------------------------------------------ weapons (+Y = blade/shaft, grip at origin)
export function makeClassWeapon(kind, M, look) {
  const g = new THREE.Group();
  const tip = new THREE.Object3D();
  switch (kind) {
    case 'runesword': case 'runeswordL': {
      // broad longsword with fuller, curved crossguard, wrapped grip, glowing runes
      const blade = mesh(extrude([[-0.038, 0], [0.038, 0], [0.032, 0.86], [0, 0.98], [-0.032, 0.86]], 0.012, 0.004), M.silver); blade.position.y = 0.1; g.add(blade);
      const fuller = mesh(box(0.012, 0.66, 0.02), M.pIron, false); fuller.position.y = 0.46; g.add(fuller);
      for (let i = 0; i < 5; i++) { const r = mesh(box(0.016, 0.05, 0.022), M.rune(look.glow || 0xff7a2a, 2.2), false); r.position.y = 0.22 + i * 0.12; g.add(r); }
      const guard = mesh(tube([V(-0.15, 0.06, 0), V(-0.07, 0.09, 0), V(0, 0.085, 0), V(0.07, 0.09, 0), V(0.15, 0.06, 0)], 0.016, 16, 6), M.pGold); g.add(guard);
      for (const s of [-1, 1]) { const e = mesh(sph(0.022, 8, 6), M.pGold); e.position.set(s * 0.155, 0.055, 0); g.add(e); }
      const gem = mesh(sph(0.018, 10, 8), M.gem(look.glow || 0xff3a1a)); gem.position.set(0, 0.09, 0.016); g.add(gem);
      const grip = mesh(cyl(0.017, 0.019, 0.2, 10), M.pLeather); grip.position.y = -0.02; g.add(grip);
      g.add(helixWrap(-0.115, 0.075, 0.0195, 7, M.pLeather, 0.0042));
      const pom = mesh(new THREE.OctahedronGeometry(0.03, 0), M.pGold); pom.position.y = -0.14; g.add(pom);
      tip.position.y = 1.06; break; }
    case 'kiteshield': {
      // heater/kite shield: layered wood core, steel rim, boss, painted crest
      const outline = [[0, 0.36], [0.24, 0.32], [0.27, 0.12], [0.2, -0.16], [0, -0.38], [-0.2, -0.16], [-0.27, 0.12], [-0.24, 0.32]];
      const crest = canvasTex(256, (c, S) => {
        const grd = c.createLinearGradient(0, 0, S, S); grd.addColorStop(0, '#7a1416'); grd.addColorStop(1, '#3a0808'); c.fillStyle = grd; c.fillRect(0, 0, S, S);
        c.fillStyle = '#d2a24c'; c.font = `bold ${S * 0.5}px serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('⚜', S / 2, S * 0.5);
        c.strokeStyle = '#d2a24c'; c.lineWidth = 8; c.beginPath(); c.moveTo(S / 2, 0); c.lineTo(S / 2, S * 0.18); c.moveTo(S / 2, S * 0.82); c.lineTo(S / 2, S); c.stroke();
      });
      crest.colorSpace = THREE.SRGBColorSpace;
      const face = mesh(extrude(outline, 0.035, 0.008), [new THREE.MeshStandardMaterial({ map: crest, roughness: 0.75 }), M.pDarkWood]);
      // map UVs for the front cap so the crest fills the shield
      const uv = face.geometry.attributes.uv, pos = face.geometry.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 0.6 + 0.5, pos.getY(i) / 0.8 + 0.5);
      g.add(face);
      const rimPts = [...outline, outline[0]].map(([x, y]) => V(x * 1.02, y * 1.02, 0.02));
      const rim = mesh(tube(rimPts, 0.016, 60, 6), M.pSteel); g.add(rim);
      const boss = mesh(sph(0.065, 16, 10, 0, PI * 2, 0, PI / 2), M.pSteel); boss.rotation.x = PI / 2; boss.position.z = 0.02; g.add(boss);
      const bossSpike = spike(0.02, 0.07, M.pSteel); bossSpike.rotation.x = PI / 2; bossSpike.position.z = 0.08; g.add(bossSpike);
      rivets(g, outline.map(([x, y]) => V(x * 0.9, y * 0.9, 0.024)), 0.01, M.pGold);
      break; }
    case 'warAxe': case 'warAxeL': {
      // berserker bearded axe: grained haft with a spiral grip, notched crescent head, blood runes, tooth trophies
      g.add(haft(M, { y0: -0.24, y1: 0.74, r: 0.022, grip: [-0.17, 0.08], bands: [0.42] }));
      const head = axeHead(M, { s: 0.78, notches: 3, beard: 1, back: 'spike', runes: 0xff2a1a, bodyMat: M.pSteel, trophy: true }); head.position.y = 0.62; g.add(head);
      tip.position.set(0.27, 0.62, 0); break; }
    case 'orcaxe': {
      // Orc warrior: a heavy black-iron war axe — thick notched crescent with a bearded horn, hammer poll,
      // rope-lashed socket, red war rag and tusk trophies, iron-banded haft with a spiral leather grip
      g.add(haft(M, { y0: -0.27, y1: 0.8, r: 0.026, grip: [-0.19, 0.1], bands: [0.3, 0.5] }));
      const head = axeHead(M, { s: 0.95, notches: 4, beard: 1.3, back: 'hammer', bodyMat: M.pIron, trophy: true }); head.position.y = 0.66; g.add(head);
      const rag = clothPanel(0.06, 0.2, M.pRed, { curve: 0.01, ragged: 0.01 }); rag.position.set(-0.03, 0.5, 0.0); rag.rotation.set(0, 0.6, 0.08); g.add(rag);      tip.position.set(0.33, 0.66, 0); break; }
    case 'greatAxe': {
      // Executioner: a colossal two-handed axe. Long iron-banded haft (both hands fit on it), a huge
      // crescent blade with a bearded lower horn, a back spike, skull trophy and glowing blood runes.
      const orc = !!(look && look.axeStyle === 'orc'); // Arms orc: black iron, hammer poll, war rag instead of runes / skull
      g.add(haft(M, { y0: -0.36, y1: 1.24, r: 0.03, grip: [-0.26, 0.2], bands: [0.36, 0.62, 0.9] }));
      g.add(helixWrap(0.42, 0.56, 0.036, 5, M.pLeather, 0.005));
      const head = axeHead(M, { s: 1.12, notches: 5, beard: 1.3, back: 'double', runes: orc ? null : 0xff2a1a, bodyMat: orc ? M.pIron : M.pSteel, trophy: true });
      head.position.y = 1.08; g.add(head);
      if (orc) { const rag = clothPanel(0.08, 0.26, M.pRed, { curve: 0.01, ragged: 0.012 }); rag.position.set(-0.04, 0.86, 0); rag.rotation.set(0, 0.5, 0.06); g.add(rag); }
      else { const sk = skullMesh(M, 0.05); sk.position.set(0.02, -0.26, 0.0); sk.rotation.y = PI / 2; head.add(sk); }
      tip.position.set(0.4, 1.08, 0); break; }
    case 'bow': case 'longbow': {
      // bow is built along +Y (limbs), the string on -Z, the back (facing the target) on +Z.
      //  bow:     Beastmaster recurve — carved riser, tapered recurved limbs with bone-capped tips, horn
      //           nocks, a wrapped grip with an arrow shelf, feathers and tooth charms
      //  longbow: Sharpshooter war longbow — tall deep-bellied limbs, steel-capped grip, horn tips, red fletching charms
      const long = kind === 'longbow', L = long ? 0.86 : 0.64;
      const limb = s => long
        ? [V(0, 0.08 * s, 0.012), V(0, 0.3 * s, 0.05), V(0, 0.58 * s, 0.05), V(0, L * s, 0.01)]
        : [V(0, 0.08 * s, 0.012), V(0, 0.26 * s, 0.065), V(0, 0.48 * s, 0.045), V(0, 0.6 * s, -0.01), V(0, L * s, -0.05)];
      const wood = long ? M.pWood : M.pDarkWood;
      for (const s of [1, -1]) {
        g.add(taperTube(limb(s), long ? 0.02 : 0.019, 0.008, wood, 28, 7));
        const end = limb(s)[limb(s).length - 1];
        const nock = turned([[0.0105, -0.02], [0.013, 0], [0.006, 0.04], [0.001, 0.055]], long ? M.pBone : M.pBone, 8);
        nock.position.copy(end); if (s < 0) nock.rotation.x = PI; g.add(nock);
        g.add(helixWrap(0.1 * s, 0.13 * s, 0.021, 2, M.rope, 0.004));
      }
      // riser: thicker carved centre with the grip and an arrow shelf
      g.add(taperTube([V(0, -0.1, 0.012), V(0, 0, 0.018), V(0, 0.1, 0.012)], 0.026, 0.024, wood, 10, 8));
      g.add(mesh(cyl(0.029, 0.029, 0.11, 10), M.pLeather).translateY(-0.01).translateZ(0.016));
      g.add(helixWrap(-0.06, 0.045, 0.031, 4, M.pLeather, 0.004).translateZ(0.016));
      const shelf = mesh(box(0.012, 0.012, 0.03), M.pBone, false); shelf.position.set(0.026, 0.055, 0.01); g.add(shelf);
      if (long) for (const y of [-0.075, 0.07]) g.add(turned([[0.03, y - 0.012], [0.034, y], [0.03, y + 0.012]], M.pSteel, 10).translateZ(0.016));
      // string: from nock to nock
      const top = limb(1)[limb(1).length - 1], bot = limb(-1)[limb(-1).length - 1];
      const str = mesh(cyl(0.0018, 0.0018, top.distanceTo(bot), 3), M.ivory, false); str.position.set(0, 0, (top.z + bot.z) / 2 - 0.004); g.add(str);
      // charms hanging from the riser
      if (long) { g.add(charm(M, 0.0, -0.09, 0.03, { len: 0.1, feather: true, bead: 0xc83a1a })); }
      else { g.add(charm(M, 0.0, -0.08, 0.03, { len: 0.12, feather: true, bead: 0x3aa0c8 })); g.add(charm(M, 0.0, -0.08, 0.04, { len: 0.08, feather: false, tooth: true, bead: 0xc83a1a })); }
      tip.position.set(0, 0, 0.06); break; }
    case 'crossbow': {
      // Sharpshooter heavy crossbow: wooden stock along +Y (pointing forward), steel prod, bone stock end
      const stock = mesh(box(0.05, 0.62, 0.06), M.pDarkWood); stock.position.y = 0.18; g.add(stock);
      const butt = mesh(box(0.07, 0.16, 0.09), M.pBone); butt.position.y = -0.18; g.add(butt);
      const prod = mesh(tube([V(-0.32, 0.36, 0), V(-0.16, 0.45, 0), V(0, 0.47, 0), V(0.16, 0.45, 0), V(0.32, 0.36, 0)], 0.016, 16, 6), M.pIron); g.add(prod);
      const str = mesh(tube([V(-0.32, 0.36, 0), V(0, 0.3, 0), V(0.32, 0.36, 0)], 0.003, 8, 3), M.pBone, false); g.add(str);
      const bolt = mesh(cyl(0.006, 0.006, 0.4, 5), M.pWood, false); bolt.position.y = 0.5; g.add(bolt);
      const head = spike(0.012, 0.05, M.pSteel); head.position.y = 0.72; g.add(head);
      const scope = mesh(cyl(0.016, 0.016, 0.16, 8), M.brass); scope.position.set(0, 0.2, 0.05); g.add(scope);
      tip.position.set(0, 0.75, 0); break; }
    case 'bonestaff': {
      // Necromancer: a staff of fused vertebrae twisting around a black-iron core; a crown of ribs cages a
      // floating skull wreathed in soul-fire, chains and bone charms hang from the cage
      const glow = look.glow || 0x7aff6a;
      const core = []; for (let i = 0; i <= 10; i++) { const u = i / 10; core.push(V(Math.sin(u * 5) * 0.012, -0.42 + u * 1.56, Math.cos(u * 4) * 0.01)); }
      g.add(taperTube(core, 0.02, 0.016, M.pIron, 30, 7));
      for (let i = 0; i < 11; i++) { // vertebrae with side processes
        const y = -0.3 + i * 0.12, v = new THREE.Group(); v.position.set(core[Math.min(10, i)].x, y, 0); v.rotation.y = i * 0.5;
        v.add(turned([[0.024, -0.022], [0.034, -0.012], [0.036, 0.006], [0.028, 0.02]], M.pBone, 9));
        for (const s of [-1, 1]) { const p = mesh(cone(0.009, 0.05, 5), M.pBone, false); p.rotation.z = -s * PI / 2.4; p.position.set(s * 0.04, 0.004, 0); v.add(p); }
        const sp = mesh(cone(0.008, 0.04, 5), M.pBone, false); sp.rotation.x = -PI / 2.6; sp.position.z = -0.035; v.add(sp);
        g.add(v);
      }
      g.add(helixWrap(-0.12, 0.12, 0.04, 4, M.pLeather, 0.005));
      g.add(turned([[0.001, -0.56], [0.018, -0.5], [0.03, -0.44], [0.024, -0.42]], M.pIron, 10));
      // crown: curved ribs rising from a bone collar and meeting above the skull
      const crown = new THREE.Group(); crown.position.y = 1.16;
      crown.add(turned([[0.03, -0.04], [0.05, -0.01], [0.055, 0.02], [0.04, 0.04]], M.pBone, 12));
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * PI * 2, pts = [];
        for (let i = 0; i <= 8; i++) { const u = i / 8, r = 0.04 + Math.sin(u * PI) * 0.14; pts.push(V(Math.sin(a) * r, 0.02 + u * 0.36, Math.cos(a) * r)); }
        crown.add(taperTube(pts, 0.012, 0.005, M.pBone, 14, 5));
      }
      const top = spike(0.012, 0.12, M.pBone); top.position.y = 0.42; crown.add(top);
      const sk = skullMesh(M, 0.065); sk.position.y = 0.19; crown.add(sk);
      for (const s of [-1, 1]) { const e = mesh(sph(0.012, 6, 4), M.rune(glow, 4), false); e.position.set(s * 0.023, 0.18, 0.06); crown.add(e); }
      const fire = mesh(cone(0.05, 0.16, 8), M.glow(glow, 0.35), false); fire.position.y = 0.3; crown.add(fire);
      for (let k = 0; k < 4; k++) { // chains of iron links hanging from the collar
        const a = k / 4 * PI * 2 + 0.4, ch = new THREE.Group(); ch.position.set(Math.sin(a) * 0.055, -0.02, Math.cos(a) * 0.055);
        for (let i = 0; i < 4; i++) { const l = mesh(tor(0.009, 0.0025, 4, 8), M.pIron, false); l.position.y = -i * 0.016; l.rotation.y = i % 2 ? PI / 2 : 0; ch.add(l); }
        const t = mesh(cone(0.008, 0.035, 5), M.pBone, false); t.rotation.x = PI; t.position.y = -0.08; ch.add(t);
        crown.add(ch);
      }
      const halo = mesh(sph(0.2, 12, 10), M.glow(glow, 0.14), false); halo.position.y = 0.19; crown.add(halo);
      const motes = new THREE.Group(); motes.position.y = 0.19;
      for (let i = 0; i < 4; i++) { const m = mesh(sph(0.011, 6, 4), M.rune(glow, 4), false); m.position.set(Math.sin(i * 1.6) * 0.2, (i % 2 ? 0.05 : -0.05), Math.cos(i * 1.6) * 0.2); motes.add(m); }
      crown.add(motes);
      g.add(crown); g.userData.pulse = halo; g.userData.spin = motes;
      tip.position.set(0, 1.35, 0); break; }
    case 'druidstaff': {
      // Druid: two living vines spiral around a gnarled heartwood shaft and burst into a crown of
      // branches cradling a glowing seed; leaves, blossoms, moss and tiny antlers; fireflies circle it
      const glow = look.glow || 0x8ad86a;
      const heart = []; for (let i = 0; i <= 10; i++) { const u = i / 10; heart.push(V(Math.sin(u * 6) * 0.018, -0.45 + u * 1.55, Math.cos(u * 5) * 0.014)); }
      g.add(taperTube(heart, 0.028, 0.02, M.pWood, 30, 8));
      for (let v = 0; v < 2; v++) { // vines
        const pts = []; for (let i = 0; i <= 24; i++) { const u = i / 24, a = u * 9 + v * PI; pts.push(V(Math.cos(a) * 0.032, -0.4 + u * 1.48, Math.sin(a) * 0.032)); }
        g.add(taperTube(pts, 0.011, 0.007, M.pDarkWood, 60, 5));
      }
      for (const y of [-0.2, 0.3, 0.75]) { const moss = mesh(sph(0.04, 8, 6), M.rune(0x3a6a2a, 0.15), false); moss.scale.set(1, 0.6, 1); moss.position.set(0.02, y, 0.01); g.add(moss); }
      g.add(helixWrap(-0.1, 0.12, 0.033, 3, M.pLeather, 0.005));
      const crown = new THREE.Group(); crown.position.y = 1.08;
      for (let k = 0; k < 5; k++) { // branches curling up and inward around the seed
        const a = k / 5 * PI * 2, pts = [];
        for (let i = 0; i <= 8; i++) { const u = i / 8, r = 0.03 + Math.sin(u * PI * 0.9) * 0.15; pts.push(V(Math.sin(a + u * 0.8) * r, u * 0.34, Math.cos(a + u * 0.8) * r)); }
        crown.add(taperTube(pts, 0.016, 0.004, M.pWood, 14, 5));
        const lf = mesh(extrude([[0, 0], [0.025, 0.03], [0.02, 0.07], [0, 0.1], [-0.02, 0.07], [-0.025, 0.03]], 0.004, 0.001), M.rune(0x5ab83a, 0.5), false);
        const p = pts[5]; lf.position.copy(p); lf.rotation.set(0.6, a, 0.4); crown.add(lf);
        const bl = new THREE.Group(); bl.position.copy(pts[7]); // blossom
        for (let q = 0; q < 5; q++) { const pt = mesh(sph(0.014, 6, 4), M.rune(0xf0a8d8, 0.6), false); pt.scale.set(1, 0.4, 0.6); pt.position.set(Math.sin(q * 1.26) * 0.014, 0, Math.cos(q * 1.26) * 0.014); bl.add(pt); }
        const c = mesh(sph(0.007, 5, 4), M.rune(0xffe06a, 2), false); bl.add(c); crown.add(bl);
      }
      for (const s of [-1, 1]) { const ant = horn(0.12, 0.008, 1.4, M.pBone); ant.position.set(s * 0.05, 0.02, -0.02); ant.rotation.set(-0.5, 0, -s * 0.9); crown.add(ant); }
      const seed = mesh(sph(0.055, 14, 12), M.gem(glow)); seed.position.y = 0.17; crown.add(seed);
      const halo = mesh(sph(0.2, 12, 10), M.glow(glow, 0.15), false); halo.position.y = 0.17; crown.add(halo);
      const flies = new THREE.Group(); flies.position.y = 0.17;
      for (let i = 0; i < 5; i++) { const f = mesh(sph(0.008, 5, 4), M.rune(0xe8ff8a, 4), false); f.position.set(Math.sin(i * 1.3) * 0.22, Math.cos(i * 2.1) * 0.08, Math.cos(i * 1.3) * 0.22); flies.add(f); }
      crown.add(flies);
      g.add(crown); g.userData.pulse = halo; g.userData.crystal = seed; g.userData.spin = flies;
      tip.position.set(0, 1.25, 0); break; }
    case 'frostwand': case 'firewand': {
      // Mage one-hand wand: gilded grip with a gem pommel, a tapering carved shaft with a gold inlay spiral,
      // a head of prongs (frost: ice claws round a crystal / fire: flame-shaped gold tongues round an ember)
      const fire = kind === 'firewand', glow = look.glow || (fire ? 0xff7a2a : 0x7fd0ff);
      g.add(turned([[0.004, -0.13], [0.017, -0.12], [0.021, -0.1], [0.014, -0.085], [0.016, -0.07], [0.016, 0.05], [0.021, 0.06], [0.013, 0.075]], M.pGold, 12));
      g.add(helixWrap(-0.065, 0.045, 0.0175, 5, fire ? M.crimson : M.royal, 0.0038));
      const pom = mesh(sph(0.015, 10, 8), M.gem(glow)); pom.position.y = -0.135; g.add(pom);
      const sh = []; for (let i = 0; i <= 6; i++) { const u = i / 6; sh.push(V(Math.sin(u * 4) * 0.004, 0.07 + u * 0.3, 0)); }
      g.add(taperTube(sh, 0.012, 0.007, fire ? M.pDarkWood : M.pWood, 16, 7));
      g.add(helixWrap(0.09, 0.34, 0.0105, 4, M.pGold, 0.0022));
      g.add(turned([[0.007, 0.35], [0.016, 0.365], [0.02, 0.38], [0.012, 0.395]], M.pGold, 12));
      const head = new THREE.Group(); head.position.y = 0.4;
      for (let k = 0; k < 3; k++) {
        const a = k / 3 * PI * 2, pts = [];
        for (let i = 0; i <= 6; i++) { const u = i / 6, r = 0.012 + Math.sin(u * PI) * (fire ? 0.045 : 0.04); pts.push(V(Math.sin(a + (fire ? u * 0.9 : 0)) * r, u * 0.11, Math.cos(a + (fire ? u * 0.9 : 0)) * r)); }
        head.add(taperTube(pts, 0.006, 0.0015, fire ? M.pGold : M.silver, 10, 5));
      }
      if (fire) {
        const ember = mesh(sph(0.026, 12, 10), M.rune(0xff8a2a, 3.4)); ember.position.y = 0.05; head.add(ember);
        const flame = mesh(cone(0.022, 0.08, 8), M.glow(0xffb04a, 0.45), false); flame.position.y = 0.1; head.add(flame);
        g.userData.fireCore = ember;
      } else {
        const cr = mesh(new THREE.OctahedronGeometry(0.026, 0), M.gem(glow)); cr.scale.set(0.7, 1.6, 0.7); cr.position.y = 0.055; head.add(cr); g.userData.crystal = cr;
      }
      const halo = mesh(sph(0.09, 10, 8), M.glow(glow, 0.18), false); halo.position.y = 0.055; head.add(halo);
      const motes = new THREE.Group(); motes.position.y = 0.055;
      for (let i = 0; i < 3; i++) { const m = fire ? mesh(sph(0.007, 5, 4), M.rune(0xffc06a, 4), false) : mesh(new THREE.OctahedronGeometry(0.009, 0), M.gem(glow), false); m.position.set(Math.sin(i * 2.1) * 0.075, 0, Math.cos(i * 2.1) * 0.075); motes.add(m); }
      head.add(motes);
      g.add(head); g.userData.pulse = halo; g.userData.spin = motes;
      tip.position.set(0, 0.455, 0); break; }
    case 'tome': {
      // Mage spellbook (off hand): leather covers with gilded corners and a clasp, a glowing sigil on the front,
      // gilt page edges, ribbon markers; a ring of runes slowly circles it. Built around the spine (grip) at x = 0.
      const fire = (look.glow === 0xff7a2a), glow = look.glow || 0x7fd0ff;
      const coverMat = fire ? M.crimson : M.royal;
      const W = 0.19, H = 0.25, T = 0.055, bk = new THREE.Group(); bk.position.set(W / 2, 0.06, 0);
      for (const z of [-1, 1]) { const c = mesh(box(W + 0.01, H + 0.012, 0.009), coverMat); c.position.z = z * (T / 2); bk.add(c); }
      const spineC = mesh(cyl(T / 2 + 0.004, T / 2 + 0.004, H + 0.012, 10, false), coverMat); spineC.position.x = -W / 2; bk.add(spineC);
      for (const y of [-H * 0.32, 0, H * 0.32]) { const r = mesh(tor(T / 2 + 0.006, 0.004, 4, 12, PI), M.pGold, false); r.rotation.set(PI / 2, 0, PI / 2); r.position.set(-W / 2, y, 0); bk.add(r); }
      const pages = mesh(box(W - 0.006, H - 0.006, T - 0.012), M.ivory); pages.position.x = 0.004; bk.add(pages);
      const gilt = mesh(box(0.004, H - 0.008, T - 0.014), M.pGold, false); gilt.position.x = W / 2 - 0.001; bk.add(gilt);
      for (const z of [-1, 1]) for (const [x, y] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const cn = mesh(extrude([[0, 0], [0.035, 0], [0, 0.035]], 0.004, 0.001), M.pGold, false); cn.position.set(x * (W / 2 + 0.002), y * (H / 2 + 0.003), z * (T / 2 + 0.005)); cn.rotation.z = x > 0 ? (y > 0 ? PI : PI / 2) : (y > 0 ? -PI / 2 : 0); bk.add(cn);
      }
      const clasp = mesh(box(0.045, 0.03, T + 0.02), M.pGold); clasp.position.set(W / 2 + 0.012, 0, 0); bk.add(clasp);
      const sig = new THREE.Group(); sig.position.set(0.01, 0.01, T / 2 + 0.007); // front sigil
      sig.add(mesh(tor(0.045, 0.004, 4, 28), M.pGold, false));
      if (fire) { const f = mesh(extrude([[0, -0.03], [0.022, 0], [0.008, 0.01], [0.012, 0.04], [0, 0.018], [-0.012, 0.04], [-0.008, 0.01], [-0.022, 0]], 0.004, 0.001), M.rune(0xff8a2a, 2.6), false); f.rotation.z = PI; sig.add(f); }
      else for (let i = 0; i < 3; i++) { const b = mesh(box(0.006, 0.07, 0.004), M.rune(glow, 2.6), false); b.rotation.z = i * PI / 3; sig.add(b); }
      const gem = mesh(sph(0.011, 8, 6), M.gem(glow), false); gem.position.z = 0.004; sig.add(gem);
      bk.add(sig);
      for (let i = 0; i < 2; i++) { const rb = mesh(new THREE.PlaneGeometry(0.012, 0.1), i ? M.pRed : coverMat, false); rb.position.set(-0.03 + i * 0.03, -H / 2 - 0.045, 0); bk.add(rb); }
      g.add(bk);
      const ring = new THREE.Group(); ring.position.copy(bk.position);
      for (let i = 0; i < 5; i++) { const r = mesh(box(0.018, 0.03, 0.002), M.rune(glow, 3), false); const a = i / 5 * PI * 2; r.position.set(Math.cos(a) * 0.2, Math.sin(a * 2) * 0.03, Math.sin(a) * 0.2); r.rotation.y = -a; ring.add(r); }
      g.add(ring); g.userData.spin = ring;
      tip.position.set(W / 2, 0.06, T / 2 + 0.02); break; }
    case 'stormmace': {
      // Shaman one-hand mace: a storm-stone head bound by six bronze flanges etched with lightning runes,
      // rope-lashed and hung with feathers; crackling cyan glow
      const glow = 0x5ae0ff;
      g.add(haft(M, { y0: -0.2, y1: 0.48, r: 0.02, mat: M.pWood, grip: [-0.14, 0.07], bands: [0.3] }));
      const head = new THREE.Group(); head.position.y = 0.54;
      const stone = mesh(new THREE.DodecahedronGeometry(0.058, 1), M.pIron); stone.scale.set(1, 1.15, 1); head.add(stone);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * PI * 2, fl = mesh(extrude([[0, -0.09], [0.05, -0.06], [0.075, 0.0], [0.05, 0.07], [0, 0.1]], 0.012, 0.003), M.pGold);
        fl.position.set(Math.sin(a) * 0.04, 0, Math.cos(a) * 0.04); fl.rotation.y = a - PI / 2; head.add(fl);
        const rn = mesh(box(0.006, 0.05, 0.016), M.rune(glow, 3), false); rn.position.set(Math.sin(a) * 0.085, 0, Math.cos(a) * 0.085); rn.rotation.set(0, a, 0.5); head.add(rn);
      }
      head.add(turned([[0.026, -0.12], [0.034, -0.105], [0.034, -0.09], [0.026, -0.08]], M.pGold, 10));
      head.add(helixWrap(-0.14, -0.1, 0.024, 3, M.rope, 0.005));
      const top = spike(0.014, 0.08, M.pGold); top.position.y = 0.12; head.add(top);
      g.add(head);
      g.add(charm(M, 0.025, 0.42, 0.01, { len: 0.12, feather: true, bead: 0x3aa0c8 }));
      g.add(charm(M, -0.025, 0.42, -0.01, { len: 0.09, feather: false, tooth: true, bead: 0xe8dcc0 }));
      const orb = mesh(sph(0.11, 10, 8), M.glow(glow, 0.16), false); orb.position.y = 0.54; g.add(orb); g.userData.pulse = orb;
      tip.position.set(0, 0.6, 0); break; }
    case 'relic': {
      // Shaman off-hand relic: a carved totem idol — stone-faced spirit mask with horns and a feather crest on a
      // short wrapped handle; four elemental motes (fire, water, earth, air) circle it
      g.add(mesh(cyl(0.017, 0.019, 0.12, 9), M.pWood).translateY(-0.01));
      g.add(helixWrap(-0.06, 0.04, 0.0195, 4, M.pLeather, 0.004));
      g.add(turned([[0.001, -0.09], [0.02, -0.08], [0.026, -0.065], [0.02, -0.06]], M.pGold, 10));
      const idol = new THREE.Group(); idol.position.y = 0.12;
      idol.add(turned([[0.02, -0.07], [0.042, -0.05], [0.05, 0.0], [0.046, 0.05], [0.03, 0.08]], M.pDarkWood, 12));
      // carved spirit mask: domed bone face, heavy brow, deep sockets with glowing eyes, a hooked nose, tusks, war paint
      const face = mesh(sph(0.042, 14, 12), M.pBone); face.scale.set(0.95, 1.15, 0.55); face.position.set(0, 0.005, 0.03); idol.add(face);
      const brow = mesh(tube([V(-0.036, 0.02, 0.046), V(0, 0.032, 0.058), V(0.036, 0.02, 0.046)], 0.008, 10, 5), M.pBone); idol.add(brow);
      for (const s of [-1, 1]) {
        const sock = mesh(sph(0.011, 8, 6), BLACK, false); sock.scale.set(1.2, 0.8, 0.6); sock.position.set(s * 0.016, 0.013, 0.051); idol.add(sock);
        const e = mesh(sph(0.0055, 6, 4), M.rune(0x5ae0ff, 4), false); e.position.set(s * 0.016, 0.013, 0.055); idol.add(e);
        const tk = mesh(cone(0.005, 0.028, 5), M.pBone, false); tk.position.set(s * 0.017, -0.026, 0.05); tk.rotation.z = s * 0.25; idol.add(tk);
        for (let k = 0; k < 2; k++) { const st = mesh(box(0.004, 0.022, 0.003), M.pRed, false); st.position.set(s * (0.028 + k * 0.006), -0.006, 0.043 - k * 0.004); st.rotation.z = s * 0.2; idol.add(st); }
        const hn = horn(0.075, 0.009, 1.5, M.pBone); hn.position.set(s * 0.038, 0.045, 0.005); hn.rotation.set(-0.2, 0, -s * 1.1); idol.add(hn);
      }
      const nose = mesh(cone(0.009, 0.03, 5), M.pBone, false); nose.rotation.x = PI / 2.2; nose.position.set(0, -0.002, 0.058); idol.add(nose);
      const mouth = mesh(tor(0.013, 0.003, 4, 10, PI), BLACK, false); mouth.rotation.z = PI; mouth.position.set(0, -0.02, 0.052); idol.add(mouth);
      for (let i = 0; i < 3; i++) { const f = mesh(new THREE.PlaneGeometry(0.03, 0.1), M.pFeather, false); f.position.set((i - 1) * 0.02, 0.12, -0.01); f.rotation.z = (i - 1) * 0.35; idol.add(f); }
      g.add(idol);
      const orbit = new THREE.Group(); orbit.position.y = 0.13;
      [0xff6a1a, 0x3aa8ff, 0x8a6a3a, 0xe8f4ff].forEach((c, i) => { const o = mesh(sph(0.014, 8, 6), M.rune(c, 1.8), false); const a = i / 4 * PI * 2; o.position.set(Math.cos(a) * 0.11, Math.sin(a * 2) * 0.02, Math.sin(a) * 0.11); orbit.add(o); });
      g.add(orbit); g.userData.spin = orbit;
      const halo = mesh(sph(0.12, 10, 8), M.glow(0x5ae0ff, 0.12), false); halo.position.y = 0.13; g.add(halo); g.userData.pulse = halo;
      tip.position.set(0, 0.13, 0.06); break; }
    case 'greatsword': {
      // Arms: a two-handed rune greatsword — long wrapped grip (both hands), wide crossguard, broad fullered blade
      const blade = mesh(extrude([[-0.055, 0], [0.055, 0], [0.05, 1.18], [0, 1.34], [-0.05, 1.18]], 0.016, 0.005), M.silver); blade.position.y = 0.2; g.add(blade);
      const fuller = mesh(box(0.02, 1.0, 0.036), M.pIron, false); fuller.position.y = 0.76; g.add(fuller);
      for (let i = 0; i < 4; i++) { const r = mesh(box(0.034, 0.05, 0.04), M.rune(look.glow || 0xff5a3a, 2.2), false); r.position.y = 0.38 + i * 0.13; g.add(r); }
      const guard = mesh(tube([V(-0.24, 0.12, 0), V(-0.12, 0.17, 0), V(0, 0.18, 0), V(0.12, 0.17, 0), V(0.24, 0.12, 0)], 0.022, 12, 6), M.pIron); g.add(guard);
      for (const s of [-1, 1]) { const k2 = spike(0.022, 0.07, M.pGold); k2.rotation.z = -s * PI / 2; k2.position.set(s * 0.27, 0.11, 0); g.add(k2); }
      const grip = mesh(cyl(0.024, 0.026, 0.46, 10), M.pLeather); grip.position.y = -0.06; g.add(grip);
      g.add(helixWrap(-0.28, 0.16, 0.0265, 13, M.pLeather, 0.0048));
      const pom = mesh(sph(0.04, 12, 8), M.pGold); pom.position.y = -0.31; g.add(pom);
      tip.position.set(0, 1.5, 0); break; }
    case 'fang': case 'fangL': {
      // rogue curved, serrated fang dagger with poison channel
      const pts = []; for (let i = 0; i <= 8; i++) { const u = i / 8; pts.push([0.026 * (1 - u) + Math.sin(u * 2.2) * 0.04, u * 0.34]); }
      const back = []; for (let i = 8; i >= 0; i--) { const u = i / 8; back.push([-0.018 * (1 - u) + Math.sin(u * 2.2) * 0.04 - (i % 2 && u > 0.2 ? 0.006 : 0), u * 0.33]); }
      const blade = mesh(extrude([...pts, ...back], 0.006, 0.003), M.silver); blade.position.y = 0.06; g.add(blade);
      const channel = mesh(extrude(pts.slice(1, 7).map(([x, y]) => [x - 0.012, y]).concat(pts.slice(1, 7).reverse().map(([x, y]) => [x - 0.02, y])), 0.008, 0), M.rune(0x6aff4a, 2.2), false); channel.position.y = 0.06; g.add(channel);
      const guard = mesh(tube([V(-0.06, 0.05, 0.0), V(0, 0.06, 0), V(0.06, 0.045, 0.01)], 0.009, 10, 5), M.pIron); g.add(guard);
      const grip = mesh(cyl(0.014, 0.016, 0.11, 8), M.pLeather); g.add(grip);
      const pom = mesh(sph(0.018, 8, 6), M.pIron); pom.position.y = -0.06; g.add(pom);
      const drop = mesh(sph(0.008, 6, 4), M.rune(0x6aff4a, 3), false); drop.position.set(0.04, 0.4, 0); g.add(drop); g.userData.drop = drop;
      tip.position.set(0.04, 0.42, 0); break; }
    case 'archstaff': {
      // mage: tall ornate staff, gold-banded, crowned crystal with orbiting rings and shards
      const pts = []; for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push(V(Math.sin(u * 7) * 0.014, -0.62 + u * 1.86, Math.cos(u * 5) * 0.012)); }
      g.add(mesh(tube(pts, 0.024, 30, 8), M.pDarkWood));
      g.add(helixWrap(-0.14, 0.12, 0.026, 6, M.pLeather, 0.0045)); g.add(turned([[0.001, -0.7], [0.02, -0.66], [0.03, -0.6], [0.026, -0.58]], M.pGold, 12)); g.add(charm(M, 0.03, 1.0, 0, { len: 0.14, feather: true, bead: 0x7fd0ff }));
      for (const y of [-0.5, -0.1, 0.4, 1.0]) { const b = mesh(cyl(0.03, 0.03, 0.04, 12), M.pGold); b.position.y = y; g.add(b); }
      for (let k = 0; k < 4; k++) {
        const a = k / 4 * PI * 2, cp = [];
        for (let i = 0; i <= 6; i++) { const u = i / 6; cp.push(V(Math.sin(a) * (0.03 + Math.sin(u * PI) * 0.11), 1.12 + u * 0.36, Math.cos(a) * (0.03 + Math.sin(u * PI) * 0.11))); }
        g.add(mesh(tube(cp, 0.011, 12, 5), M.pGold));
      }
      const crystal = mesh(new THREE.OctahedronGeometry(0.085, 0), M.gem(look.glow)); crystal.scale.set(0.75, 1.7, 0.75); crystal.position.y = 1.3; g.add(crystal);
      const halo = mesh(sph(0.22, 12, 10), M.glow(look.glow, 0.16), false); halo.position.y = 1.3; g.add(halo);
      const rings = new THREE.Group(); rings.position.y = 1.3;
      for (let i = 0; i < 2; i++) { const r = mesh(tor(0.16 + i * 0.04, 0.005, 4, 40), M.rune(look.glow, 2), false); r.rotation.x = PI / 2 + i * 0.6; rings.add(r); }
      for (let i = 0; i < 3; i++) { const s = mesh(new THREE.OctahedronGeometry(0.022, 0), M.gem(look.glow), false); s.position.set(Math.sin(i * 2.1) * 0.2, 0, Math.cos(i * 2.1) * 0.2); rings.add(s); }
      g.add(rings);
      g.userData.pulse = halo; g.userData.crystal = crystal; g.userData.spin = rings;
      tip.position.y = 1.3; break; }
    case 'sunmace': {
      // priest: gilded flanged greatmace with winged head and radiant core
      g.add(mesh(cyl(0.02, 0.024, 0.72, 10), M.pDarkWood).translateY(0.18));
      g.add(turned([[0.001, -0.22], [0.024, -0.19], [0.03, -0.15], [0.024, -0.13]], M.pGold, 12));
      const wrap = mesh(cyl(0.026, 0.026, 0.18, 10), M.ivory); wrap.position.y = -0.04; g.add(wrap);
      for (const y of [0.06, 0.52]) { const b = mesh(cyl(0.032, 0.032, 0.03, 12), M.pGold); b.position.y = y; g.add(b); }
      const head = new THREE.Group(); head.position.y = 0.64;
      head.add(mesh(sph(0.07, 16, 12), M.pGold));
      for (let i = 0; i < 8; i++) { const a = i / 8 * PI * 2; const fl = mesh(extrude([[0, -0.1], [0.07, -0.06], [0.09, 0.02], [0.05, 0.1], [0, 0.12]], 0.012, 0.003), M.pGold); fl.position.set(Math.sin(a) * 0.06, 0, Math.cos(a) * 0.06); fl.rotation.y = a - PI / 2; head.add(fl); }
      for (const s of [-1, 1]) { const w = mesh(extrude([[0, 0], [0.08, 0.03], [0.16, 0.12], [0.07, 0.06], [0.02, 0.04]], 0.008, 0.002), M.silver); w.position.set(s * 0.05, 0.08, 0); w.scale.x = s; head.add(w); }
      const core = mesh(sph(0.04, 12, 10), M.rune(0xfff0b0, 4)); core.position.y = 0.06; head.add(core);
      const halo = mesh(sph(0.2, 12, 10), M.glow(look.glow || 0xffd98a, 0.16), false); head.add(halo);
      const top = spike(0.02, 0.09, M.pGold); top.position.y = 0.14; head.add(top);
      g.add(head); g.userData.pulse = halo;
      tip.position.y = 0.7; break; }
    case 'stormaxe': case 'stormaxeL': {
      // shaman: stormcaller axe with crescent blade, crackling cyan runes, feathers and beads
      g.add(haft(M, { y0: -0.2, y1: 0.68, r: 0.022, mat: M.pWood, grip: [-0.14, 0.08], bands: [0.36] }));
      const head = axeHead(M, { s: 0.72, notches: 0, beard: 0.6, back: 'spike', runes: 0x5ae0ff, bodyMat: M.pGold, lash: true }); head.position.y = 0.6;
      g.add(head);
      for (let i = 0; i < 3; i++) {
        const f = mesh(new THREE.PlaneGeometry(0.035, 0.16), new THREE.MeshStandardMaterial({ color: [0x7a2a1a, 0xe8e0d0, 0x2a2a2a][i], roughness: 1, side: THREE.DoubleSide }), false);
        f.position.set(-0.03 + i * 0.02, 0.38 - i * 0.03, 0.02); f.rotation.z = 0.25 - i * 0.2; g.add(f);
        const bead = mesh(sph(0.012, 6, 4), i === 1 ? M.pBone : M.rune(0x5ae0ff, 1.2), false); bead.position.set(-0.03 + i * 0.02, 0.47 - i * 0.02, 0.02); g.add(bead);
      }
      const orb = mesh(sph(0.05, 10, 8), M.glow(0x5ae0ff, 0.25), false); orb.position.set(0.16, 0.6, 0); g.add(orb); g.userData.pulse = orb;
      tip.position.set(0.28, 0.6, 0); break; }
    case 'sunhammer': {
      // Paladin Crusader: two-handed war hammer — long gilded haft, a massive silver head with a
      // radiant sun disc on its striking face, a back spike and a glowing core
      const haft = mesh(cyl(0.026, 0.03, 1.5, 12), M.pDarkWood); haft.position.y = 0.4; g.add(haft);
      g.add(turned([[0.001, -0.46], [0.03, -0.42], [0.038, -0.38], [0.03, -0.35]], M.pGold, 12)); for (const s of [-1, 1]) g.add(charm(M, s * 0.03, 1.04, 0, { len: 0.12, feather: false, bead: 0xffd27a }));
      for (const y of [-0.32, 0.12, 0.55, 0.98]) { const b = mesh(cyl(0.036, 0.036, 0.045, 12), M.pGold); b.position.y = y; g.add(b); }
      g.add(helixWrap(-0.24, 0.07, 0.0315, 9, M.ivory, 0.0055)); for (const y of [-0.26, 0.09]) g.add(turned([[0.031, y - 0.014], [0.038, y], [0.031, y + 0.014]], M.pGold, 12));
      const head = new THREE.Group(); head.position.y = 1.2;
      head.add(mesh(box(0.36, 0.2, 0.19), M.silver));
      for (const x of [-0.12, 0.12]) { const band = mesh(box(0.03, 0.215, 0.205), M.pGold); band.position.x = x; head.add(band); }
      const face = mesh(cyl(0.12, 0.11, 0.06, 20), M.pGold); face.rotation.z = PI / 2; face.position.x = 0.2; head.add(face);
      const disc = mesh(cyl(0.075, 0.075, 0.02, 20), M.rune(0xfff0a0, 2.4), false); disc.rotation.z = PI / 2; disc.position.x = 0.235; head.add(disc);
      for (let i = 0; i < 10; i++) { const a = i / 10 * PI * 2, r = spike(0.016, 0.07, M.pGold); r.position.set(0.2, Math.sin(a) * 0.14, Math.cos(a) * 0.14); r.rotation.x = a; head.add(r); }
      const back = spike(0.05, 0.2, M.silver); back.rotation.z = PI / 2; back.position.x = -0.27; head.add(back);
      const top = spike(0.03, 0.16, M.pGold); top.position.y = 0.17; head.add(top);
      g.add(head);
      const glow = mesh(sph(0.2, 12, 10), M.glow(0xffe08a, 0.14), false); glow.position.set(0.22, 1.2, 0); g.add(glow); g.userData.pulse = glow;
      const pom = mesh(sph(0.045, 12, 8), M.pGold); pom.position.y = -0.36; g.add(pom);
      tip.position.set(0.24, 1.2, 0); break; }
    case 'holysword': {
      // Paladin Protection: a blessed arming sword — bright blade with a light-filled fuller, winged gold guard
      const blade = mesh(extrude([[-0.042, 0], [0.042, 0], [0.036, 0.82], [0, 0.95], [-0.036, 0.82]], 0.012, 0.004), M.silver); blade.position.y = 0.1; g.add(blade);
      const fuller = mesh(box(0.014, 0.64, 0.02), M.rune(0xfff0b0, 1.8), false); fuller.position.y = 0.44; g.add(fuller);
      for (const s of [-1, 1]) { const w = mesh(extrude([[0, 0], [0.09, 0.02], [0.17, 0.09], [0.11, 0.05], [0.05, 0.05]], 0.012, 0.003), M.pGold); w.position.set(0, 0.07, 0); w.scale.x = s; g.add(w); }
      const gem = mesh(sph(0.02, 10, 8), M.gem(0x6ab0ff)); gem.position.set(0, 0.085, 0.014); g.add(gem);
      const grip = mesh(cyl(0.017, 0.019, 0.19, 10), M.royal); grip.position.y = -0.02; g.add(grip);
      g.add(helixWrap(-0.105, 0.065, 0.0195, 6, M.pGold, 0.0036));
      const pom = mesh(sph(0.03, 12, 8), M.pGold); pom.position.y = -0.14; g.add(pom);
      tip.position.y = 1.03; break; }
    case 'towershield': {
      // Paladin Protection: a tall tower shield — steel field, blue-and-gold sun crest, heavy gilded rim, ground spike
      const outline = [[0, 0.56], [0.2, 0.54], [0.31, 0.46], [0.32, -0.3], [0.21, -0.5], [0, -0.6], [-0.21, -0.5], [-0.32, -0.3], [-0.31, 0.46], [-0.2, 0.54]];
      const crest = canvasTex(256, (c, S) => {
        const grd = c.createLinearGradient(0, 0, 0, S); grd.addColorStop(0, '#2a4a8a'); grd.addColorStop(1, '#14244a'); c.fillStyle = grd; c.fillRect(0, 0, S, S);
        c.fillStyle = '#e8eef8'; c.fillRect(S * 0.44, 0, S * 0.12, S); c.fillRect(0, S * 0.36, S, S * 0.1);
        c.fillStyle = '#f2c45a'; c.beginPath(); c.arc(S / 2, S * 0.41, S * 0.16, 0, PI * 2); c.fill();
        c.strokeStyle = '#f2c45a'; c.lineWidth = 6; for (let i = 0; i < 12; i++) { const a = i / 12 * PI * 2; c.beginPath(); c.moveTo(S / 2 + Math.cos(a) * S * 0.18, S * 0.41 + Math.sin(a) * S * 0.18); c.lineTo(S / 2 + Math.cos(a) * S * 0.27, S * 0.41 + Math.sin(a) * S * 0.27); c.stroke(); }
      });
      crest.colorSpace = THREE.SRGBColorSpace;
      const face = mesh(extrude(outline, 0.04, 0.01), [new THREE.MeshStandardMaterial({ map: crest, roughness: 0.55, metalness: 0.35 }), M.pSteel]);
      const uv = face.geometry.attributes.uv, pos = face.geometry.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 0.66 + 0.5, pos.getY(i) / 1.18 + 0.5);
      g.add(face);
      const rimPts = [...outline, outline[0]].map(([x, y]) => V(x * 1.02, y * 1.02, 0.024));
      g.add(mesh(tube(rimPts, 0.022, 70, 6), M.pGold));
      const boss = mesh(sph(0.07, 16, 10, 0, PI * 2, 0, PI / 2), M.pGold); boss.rotation.x = PI / 2; boss.position.set(0, 0.0, 0.024); g.add(boss);
      const gem = mesh(sph(0.026, 10, 8), M.gem(0xfff0a0)); gem.position.set(0, 0.0, 0.08); g.add(gem);
      rivets(g, outline.map(([x, y]) => V(x * 0.9, y * 0.9, 0.028)), 0.012, M.pGold);
      const foot = spike(0.03, 0.12, M.pSteel); foot.rotation.x = PI; foot.position.y = -0.66; g.add(foot);
      break; }
    case 'cleaver': {
      // Orc warrior: a brutal, notched cleaver-sword — wide single-edged blade, iron spine, bone grip, tooth trophies
      const blade = mesh(extrude([[-0.03, 0], [0.07, 0], [0.13, 0.5], [0.14, 0.78], [0.04, 0.9], [-0.03, 0.84], [-0.035, 0.6], [0.0, 0.55], [-0.035, 0.5]], 0.016, 0.005), M.pSteel); blade.position.y = 0.1; g.add(blade);
      const spine = mesh(box(0.02, 0.8, 0.026), M.pIron, false); spine.position.set(-0.03, 0.5, 0); g.add(spine);
      for (let i = 0; i < 4; i++) { const n = mesh(box(0.03, 0.02, 0.03), M.pIron, false); n.position.set(0.12, 0.42 + i * 0.12, 0); g.add(n); }
      rivets(g, [V(0.02, 0.2, 0.012), V(0.03, 0.35, 0.012), V(0.04, 0.5, 0.012)], 0.012, M.pGold);
      const guard = mesh(box(0.2, 0.04, 0.05), M.pIron); guard.position.y = 0.08; g.add(guard);
      for (const s of [-1, 1]) { const t = horn(0.09, 0.012, 1.2, M.pBone); t.position.set(s * 0.1, 0.08, 0); t.rotation.z = -s * 1.2; g.add(t); }
      const grip = mesh(cyl(0.02, 0.022, 0.2, 10), M.pBone); grip.position.y = -0.03; g.add(grip);
      g.add(helixWrap(-0.12, 0.06, 0.0225, 6, M.pLeather, 0.0048));
      const pom = spike(0.025, 0.07, M.pIron); pom.rotation.z = PI; pom.position.y = -0.16; g.add(pom);
      tip.position.set(0.06, 0.98, 0); break; }
    case 'orcshield': {
      // Orc warrior: round war shield — iron-banded planks, a fanged red war-sigil, spiked rim
      const crest = canvasTex(256, (c, S) => {
        c.fillStyle = '#2a1a10'; c.fillRect(0, 0, S, S);
        let sd = 3; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 6; i++) { // planks with grain, knots and dark seams
          const x0 = i * S / 6; c.fillStyle = i % 2 ? '#5a3a24' : '#4a2e1a'; c.fillRect(x0 + 1, 0, S / 6 - 3, S);
          for (let k = 0; k < 14; k++) { c.globalAlpha = 0.25 + rnd() * 0.3; c.fillStyle = rnd() < 0.5 ? '#2e1c10' : '#7a5434'; c.fillRect(x0 + 2 + rnd() * (S / 6 - 6), 0, 1, S); }
          c.globalAlpha = 0.7; c.fillStyle = '#24140a'; c.beginPath(); c.ellipse(x0 + S / 12, rnd() * S, 3, 6, 0, 0, 7); c.fill(); c.globalAlpha = 1;
        }
        c.strokeStyle = '#d8c8a8'; c.globalAlpha = 0.25; for (let k = 0; k < 40; k++) { c.lineWidth = 1; c.beginPath(); const x = rnd() * S, y = rnd() * S; c.moveTo(x, y); c.lineTo(x + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 12); c.stroke(); } c.globalAlpha = 1;
        c.fillStyle = '#8a1a14'; c.beginPath(); c.moveTo(S * 0.5, S * 0.16); c.lineTo(S * 0.7, S * 0.5); c.lineTo(S * 0.5, S * 0.84); c.lineTo(S * 0.3, S * 0.5); c.closePath(); c.fill();
        c.fillStyle = '#e8dcc0'; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(S * 0.5 + s * S * 0.06, S * 0.42); c.lineTo(S * 0.5 + s * S * 0.13, S * 0.62); c.lineTo(S * 0.5 + s * S * 0.02, S * 0.5); c.fill(); }
      });
      crest.colorSpace = THREE.SRGBColorSpace;
      const disc = mesh(cyl(0.34, 0.34, 0.04, 28), [new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.9 }), new THREE.MeshStandardMaterial({ map: crest, roughness: 0.85 }), new THREE.MeshStandardMaterial({ map: crest, roughness: 0.85 })]);
      disc.rotation.x = PI / 2; g.add(disc);
      const rim = mesh(tor(0.34, 0.022, 6, 32), M.pIron); g.add(rim);
      for (let i = 0; i < 10; i++) { const a = i / 10 * PI * 2, s = spike(0.022, 0.09, M.pIron); s.position.set(Math.cos(a) * 0.37, Math.sin(a) * 0.37, 0); s.rotation.z = a - PI / 2; g.add(s); }
      for (const y of [-0.16, 0.16]) { const band = mesh(box(0.62, 0.035, 0.05), M.pIron); band.position.y = y; g.add(band);
        rivets(g, [-0.24, -0.12, 0, 0.12, 0.24].map(x => V(x, y, 0.027)), 0.009, M.pGold); }
      for (const s of [-1, 1]) { const t = horn(0.11, 0.013, 1.0, M.pBone); t.position.set(s * 0.08, -0.06, 0.03); t.rotation.set(-0.3, 0, PI + s * 0.5); g.add(t); } // tusk trophies
      const boss = mesh(sph(0.08, 14, 10, 0, PI * 2, 0, PI / 2), M.pIron); boss.rotation.x = PI / 2; boss.position.z = 0.02; g.add(boss);
      const bs = spike(0.03, 0.12, M.pIron); bs.rotation.x = PI / 2; bs.position.z = 0.1; g.add(bs);
      break; }
    case 'flamestaff': {
      // Fire mage: sun-gold staff — a burning orb cradled by swept phoenix wings, ember-red gems along the shaft
      const pts = []; for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push(V(Math.sin(u * 6) * 0.012, -0.62 + u * 1.84, Math.cos(u * 4) * 0.01)); }
      g.add(mesh(tube(pts, 0.024, 30, 8), M.crimson));
      g.add(helixWrap(-0.14, 0.12, 0.026, 6, M.pLeather, 0.0045)); g.add(turned([[0.001, -0.7], [0.02, -0.66], [0.03, -0.6], [0.026, -0.58]], M.pGold, 12)); g.add(charm(M, 0.03, 1.0, 0, { len: 0.14, feather: true, bead: 0xff6a1a }));
      for (const y of [-0.5, -0.05, 0.45, 0.98]) { const b = mesh(cyl(0.031, 0.031, 0.045, 12), M.pGold); b.position.y = y; g.add(b); const gm = mesh(sph(0.014, 8, 6), M.gem(0xff5a1a), false); gm.position.set(0, y, 0.03); g.add(gm); }
      for (const s of [-1, 1]) for (let f = 0; f < 3; f++) {
        const w = mesh(extrude([[0, 0], [0.06, 0.05 + f * 0.02], [0.2 - f * 0.03, 0.2 + f * 0.04], [0.05, 0.08]], 0.008, 0.002), M.pGold);
        w.position.set(s * 0.03, 1.08 + f * 0.04, -0.01 * f); w.scale.x = s; w.rotation.z = s * (0.1 + f * 0.12); g.add(w);
      }
      const orb = mesh(sph(0.075, 16, 12), M.rune(0xff8a2a, 3.2)); orb.position.y = 1.3; g.add(orb);
      const halo = mesh(sph(0.22, 12, 10), M.glow(0xff6a1a, 0.2), false); halo.position.y = 1.3; g.add(halo);
      g.userData.pulse = halo; g.userData.fireCore = orb;
      tip.position.y = 1.3; break; }
  }
  g.add(tip); g.userData.tip = tip;
  g.traverse(o => { if (o.isMesh && o.castShadow === undefined) o.castShadow = true; });
  const U = g.userData;
  mergeUnder(g, [...g.children], new Set([tip, U.drop, U.pulse, U.crystal, U.spin].filter(Boolean)));
  return g;
}

// ------------------------------------------------------------------ fitting armor onto a champion
// Collapse every static armor mesh on a bone into one mesh per material (+shadow flag): a fully
// armored champion goes from 100+ draw calls to roughly 15-25. Animated subtrees (capes, tabards,
// orbiting motes) and mirrored meshes stay as they are.
function mergeStatic(placed, keep) {
  const byBone = new Map();
  for (const obj of placed) { const bone = obj.parent; if (!byBone.has(bone)) byBone.set(bone, []); byBone.get(bone).push(obj); }
  for (const [bone, objs] of byBone) mergeUnder(bone, objs, keep);
}
// merge the static meshes found in objs (descendants of root) into meshes parented to root
function mergeUnder(root, objs, keep) {
  const rel = new THREE.Matrix4(), inv = new THREE.Matrix4();
  {
    const bone = root;
    bone.updateMatrixWorld(true); inv.copy(bone.matrixWorld).invert();
    const groups = new Map();
    const visit = o => {
      if (keep.has(o)) return;
      if (o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && !Array.isArray(o.material)) { // multi-material meshes (painted shield faces) stay whole
        rel.multiplyMatrices(inv, o.matrixWorld);
        if (rel.determinant() > 0) {
          let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
          for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
          if (!g.attributes.normal) g.computeVertexNormals();
          if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
          g.morphAttributes = {}; g.clearGroups(); g.applyMatrix4(rel);
          const key = o.material.uuid + (o.castShadow ? '+' : '-');
          if (!groups.has(key)) groups.set(key, { mat: o.material, cast: o.castShadow, geos: [], src: [] });
          const gr = groups.get(key); gr.geos.push(g); gr.src.push(o);
        }
      }
      for (const c of [...o.children]) visit(c);
    };
    for (const obj of objs) { obj.updateMatrixWorld(true); visit(obj); }
    for (const { mat, cast, geos, src } of groups.values()) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue; // incompatible attributes: keep the originals
      const m = new THREE.Mesh(merged, mat); m.castShadow = cast; m.receiveShadow = true; m.name = 'armor'; bone.add(m);
      for (const o of src) { const p = o.parent; for (const c of [...o.children]) p.attach(c); o.removeFromParent(); }
    }
  }
}

// ch: Character in its rest pose (matrices updated); returns { update(dt, st) } for animated parts.
export function equipArmor(ch, cls, M, spec) {
  const b = ch.bones;
  const W = n => (b[n] ? b[n].getWorldPosition(new THREE.Vector3()) : new THREE.Vector3());
  const L = { lsh: W('upperarm_l'), rsh: W('upperarm_r'), lcl: W('clavicle_l'), rcl: W('clavicle_r'), chest: W('spine_03'), belly: W('spine_01'), pelvis: W('pelvis'), neck: W('neck_01'), head: W('Head'),
    lel: W('lowerarm_l'), rel: W('lowerarm_r'), lha: W('hand_l'), rha: W('hand_r'), lkn: W('calf_l'), rkn: W('calf_r'), lft: W('foot_l'), rft: W('foot_r'), lth: W('thigh_l'), rth: W('thigh_r') };
  const shoulderW = L.lsh.distanceTo(L.rsh);
  const k = shoulderW / 0.36; // body size factor relative to an average frame
  // limb thickness follows the race's arm / leg proportions (a dwarf's calves are thicker than his shoulders are wide)
  const RB = (ch.raceDef && ch.raceDef.bones) || {}, sc0 = (ch.look && ch.look.scale) || 1;
  const ka = sc0 * ((RB.lowerarm || [1])[0]), kl = sc0 * ((RB.calf || [1])[0]);
  const animated = { capes: [], spinners: [], tabards: [] };
  const placed = []; // every armor piece attached to a bone (merged into few meshes at the end)
  // place an object at world position/orientation, then parent it to a bone keeping that placement
  const put = (boneName, obj, pos, { yaw = 0, pitch = 0, roll = 0, scale = 1 } = {}) => {
    obj.position.copy(pos); obj.rotation.set(pitch, yaw, roll, 'YXZ'); obj.scale.multiplyScalar(scale);
    ch.root.add(obj); obj.updateMatrixWorld(true);
    (b[boneName] || b.spine_03).attach(obj); placed.push(obj);
    return obj;
  };
  const along = (boneName, obj, a, c, offset = 0) => {
    // orient obj's +Y from a to c (e.g. forearm), placed at the midpoint
    const dir = c.clone().sub(a); const len = dir.length(); dir.normalize();
    obj.position.copy(a).addScaledVector(dir, len * (0.5 + offset));
    obj.quaternion.setFromUnitVectors(V(0, 1, 0), dir);
    ch.root.add(obj); obj.updateMatrixWorld(true); (b[boneName]).attach(obj); placed.push(obj); return obj;
  };
  const side = (s, p) => p.clone().setX(p.x * s); // mirror helper not used for bones (we use L/R landmarks)
  const fwd = V(0, 0, 1);
  const chestFront = (dz = 0.1) => L.chest.clone().add(V(0, 0.02, dz * k));

  const gauntlets = (mat, trim, flare = 1) => {
    for (const [el, ha, bone, s] of [[L.lel, L.lha, 'lowerarm_l', 1], [L.rel, L.rha, 'lowerarm_r', -1]]) {
      const g = new THREE.Group();
      const c = mesh(cyl(0.05 * ka * flare, 0.042 * ka, 0.17 * ka, 14), mat); g.add(c);
      const cuff = mesh(cyl(0.062 * ka * flare, 0.058 * ka * flare, 0.04 * ka, 14), trim); cuff.position.y = 0.08 * ka; g.add(cuff);
      for (let i = 0; i < 3; i++) { const r = mesh(sph(0.008, 6, 4), trim, false); r.position.set(Math.sin(i * 2) * 0.05 * ka, -0.02, Math.cos(i * 2) * 0.05 * ka); g.add(r); }
      along(bone, g, el, ha, 0.12);
    }
  };
  const greaves = (mat, trim) => {
    for (const [kn, ft, bone] of [[L.lkn, L.lft, 'calf_l'], [L.rkn, L.rft, 'calf_r']]) {
      const g = new THREE.Group();
      const shin = mesh(cyl(0.062 * kl, 0.052 * kl, 0.3 * kl, 14, false), mat); shin.scale.z = 1.15; shin.position.z = 0.012; g.add(shin);
      along(bone, g, kn, ft, -0.12);
      const cop = new THREE.Group(); const dome = mesh(sph(0.05 * kl, 14, 10, 0, PI * 2, 0, PI * 0.5), mat); dome.scale.y = 0.6; cop.add(dome); const t = mesh(tor(0.05 * kl, 0.007, 6, 20), trim, false); t.rotation.x = PI / 2; t.position.y = 0.0; cop.add(t);
      put(bone, cop, kn.clone().add(V(0, 0.02, 0.06 * kl)), { pitch: PI / 2 - 0.2 });
    }
  };
  const belt = (mat, buckleMat, r = 0.19) => {
    const g = new THREE.Group();
    const t = mesh(tor(r * k, 0.017 * k, 6, 30), mat); t.rotation.x = PI / 2; t.scale.set(1.08, 0.85, 1); t.scale.z = 1.6; g.add(t);
    const bk = mesh(box(0.08 * k, 0.07 * k, 0.02), buckleMat); bk.position.set(0, 0, r * k * 0.88); g.add(bk);
    put('pelvis', g, L.pelvis.clone().add(V(0, 0.05 * k, 0)));
    return g;
  };
  const tassets = (mat, trim, n = 4) => {
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * 2.2; // front arc
      const p = mesh(box(0.13 * k, 0.17 * k, 0.012), mat); p.position.y = -0.085 * k;
      const t = mesh(box(0.13 * k, 0.012, 0.016), trim, false); t.position.y = -0.17 * k;
      const g = new THREE.Group(); g.add(p, t);
      put('pelvis', g, L.pelvis.clone().add(V(Math.sin(a) * 0.2 * k, 0.0, Math.cos(a) * 0.19 * k)), { yaw: a, pitch: 0.18 });
    }
  };
  const cape = (mat, w, h, opts = {}) => {
    const c = clothPanel(w * k, h * k, mat, { curve: 0.06, ragged: opts.ragged || 0, trim: opts.trim });
    const pivot = new THREE.Group(); pivot.add(c); pivot.userData.noMerge = true; // animated: stays its own mesh
    put('spine_03', pivot, L.chest.clone().add(V(0, 0.12 * k, -0.13 * k)), { yaw: PI, pitch: -0.08 });
    animated.capes.push(c); return c;
  };
  const tabard = (mat, w, h, trim) => {
    const c = clothPanel(w * k, h * k, mat, { curve: 0.02, trim });
    const pivot = new THREE.Group(); pivot.add(c); pivot.userData.noMerge = true; // animated: stays its own mesh
    put('pelvis', pivot, L.pelvis.clone().add(V(0, 0.04 * k, 0.17 * k)), { pitch: 0.05 });
    animated.tabards.push(c); return c;
  };
  const shoulders = (opts) => {
    for (const [p, bone, s] of [[L.lcl.clone().lerp(L.lsh, 0.75), 'clavicle_l', 1], [L.rcl.clone().lerp(L.rsh, 0.75), 'clavicle_r', -1]]) {
      const pd = pauldron(M, { ...opts, r: (opts.r || 0.14) * k });
      put(bone, pd, p.add(V(s * 0.025 * k, 0.06 * k, 0)), { yaw: s > 0 ? 0 : PI });
    }
  };
  const breastplate = (mat, trim, emblem) => {
    const g = new THREE.Group();
    const shell = mesh(sph(0.2 * k, 24, 16, -PI * 0.42, PI * 0.84, PI * 0.18, PI * 0.56), mat); shell.scale.set(1.15, 1.15, 0.85); g.add(shell);
    const ridge = mesh(box(0.025, 0.3 * k, 0.03), trim); ridge.position.set(0, -0.02, 0.17 * k); g.add(ridge);
    const collar = mesh(tor(0.13 * k, 0.018 * k, 6, 24, PI), trim); collar.position.set(0, 0.16 * k, 0.02); collar.rotation.set(-0.3, 0, 0); g.add(collar);
    if (emblem) { const e = mesh(new THREE.CircleGeometry(0.05 * k, 20), emblem, false); e.position.set(0, 0.04 * k, 0.172 * k); g.add(e); }
    put('spine_03', g, L.chest.clone().add(V(0, 0.0, 0.01 * k)));
    // back plate
    const bp = mesh(sph(0.2 * k, 20, 12, PI * 0.58, PI * 0.84, PI * 0.2, PI * 0.5), mat); bp.scale.set(1.15, 1.15, 0.8);
    put('spine_03', bp, L.chest.clone());
  };
  // fur pelt: shaggy tufts piled on both shoulders and across the upper back
  const furMantle = (mat, size) => {
    for (const [cl, sh, bone, s] of [[L.lcl, L.lsh, 'clavicle_l', 1], [L.rcl, L.rsh, 'clavicle_r', -1]]) {
      const g = new THREE.Group();
      for (let i = 0; i < 14; i++) {
        const u = i / 13, a = (u - 0.5) * 2.4;
        const t = mesh(cone(0.05 * k * size, (0.15 + Math.random() * 0.08) * k * size, 5), mat);
        t.position.set(Math.cos(a) * 0.04 * k, 0.03 * k + Math.random() * 0.02, Math.sin(a) * 0.1 * k);
        t.rotation.set(Math.sin(a) * 0.9 + PI, 0, -s * (0.9 + Math.random() * 0.4));
        g.add(t);
      }
      const pad = mesh(sph(0.09 * k * size, 10, 8), mat); pad.scale.set(1.2, 0.6, 1.3); g.add(pad);
      put(bone, g, cl.clone().lerp(sh, 0.55).add(V(0, 0.07 * k, -0.01)));
    }
    const back = clothPanel(0.42 * k * size, 0.42 * k * size, mat, { curve: 0.08, ragged: 0.03 });
    put('spine_03', back, L.chest.clone().add(V(0, 0.16 * k, -0.12 * k)), { yaw: PI, pitch: -0.15 });
  };
  const headPos = (up = 0.1) => L.head.clone().add(V(0, up * k, 0.015 * k));

  // race features (ears, tusks, beards, horns, hooves …) and the spec's own gear set (outfits.js)
  const K = { ch, cls, spec: validSpec(cls, spec), race: ch.race || 'human', b, L, k, M, put, along, gauntlets, greaves, belt, tassets, cape, tabard, shoulders, breastplate, furMantle, headPos, chestFront, animated,
    H: { mesh, sph, cyl, cone, tor, box, tube, extrude, horn, rivets, spike, pauldron, skullMesh, clothPanel, helmGreat, canvasTex, V, PI } };
  buildRace(K);
  buildOutfit(K);
  for (const s of animated.spinners) s.userData.noMerge = true;
  mergeStatic(placed, new Set([...animated.capes, ...animated.tabards, ...animated.spinners]));
  return {
    update(dt, st, t) {
      const run = Math.min(1, st.speed || 0);
      for (const c of animated.capes) c.rotation.x = -0.08 + run * 0.5 + Math.sin(t * 3.1) * 0.03 * (1 + run) + (st.air ? 0.4 : 0);
      for (const c of animated.tabards) c.rotation.x = 0.05 + run * 0.25 + Math.sin(t * 6.2) * 0.04 * run;
      for (const s of animated.spinners) s.rotation.y += dt * 1.4;
    },
  };
}
