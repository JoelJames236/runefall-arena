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
    case 'runesword': {
      // broad longsword with fuller, curved crossguard, wrapped grip, glowing runes
      const blade = mesh(extrude([[-0.038, 0], [0.038, 0], [0.032, 0.86], [0, 0.98], [-0.032, 0.86]], 0.012, 0.004), M.silver); blade.position.y = 0.1; g.add(blade);
      const fuller = mesh(box(0.012, 0.66, 0.02), M.darksteel, false); fuller.position.y = 0.46; g.add(fuller);
      for (let i = 0; i < 5; i++) { const r = mesh(box(0.016, 0.05, 0.022), M.rune(0xff7a2a, 2.2), false); r.position.y = 0.22 + i * 0.12; g.add(r); }
      const guard = mesh(tube([V(-0.15, 0.06, 0), V(-0.07, 0.09, 0), V(0, 0.085, 0), V(0.07, 0.09, 0), V(0.15, 0.06, 0)], 0.016, 16, 6), M.gold); g.add(guard);
      for (const s of [-1, 1]) { const e = mesh(sph(0.022, 8, 6), M.gold); e.position.set(s * 0.155, 0.055, 0); g.add(e); }
      const gem = mesh(sph(0.018, 10, 8), M.gem(0xff3a1a)); gem.position.set(0, 0.09, 0.016); g.add(gem);
      const grip = mesh(cyl(0.017, 0.019, 0.2, 10), M.darkleather); grip.position.y = -0.02; g.add(grip);
      for (let i = 0; i < 5; i++) { const w = mesh(tor(0.019, 0.004, 4, 12), M.leather, false); w.rotation.x = PI / 2; w.position.y = -0.1 + i * 0.04; g.add(w); }
      const pom = mesh(new THREE.OctahedronGeometry(0.03, 0), M.gold); pom.position.y = -0.14; g.add(pom);
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
      const face = mesh(extrude(outline, 0.035, 0.008), [new THREE.MeshStandardMaterial({ map: crest, roughness: 0.75 }), M.darkwood]);
      // map UVs for the front cap so the crest fills the shield
      const uv = face.geometry.attributes.uv, pos = face.geometry.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 0.6 + 0.5, pos.getY(i) / 0.8 + 0.5);
      g.add(face);
      const rimPts = [...outline, outline[0]].map(([x, y]) => V(x * 1.02, y * 1.02, 0.02));
      const rim = mesh(tube(rimPts, 0.016, 60, 6), M.steel); g.add(rim);
      const boss = mesh(sph(0.065, 16, 10, 0, PI * 2, 0, PI / 2), M.steel); boss.rotation.x = PI / 2; boss.position.z = 0.02; g.add(boss);
      const bossSpike = spike(0.02, 0.07, M.steel); bossSpike.rotation.x = PI / 2; bossSpike.position.z = 0.08; g.add(bossSpike);
      rivets(g, outline.map(([x, y]) => V(x * 0.9, y * 0.9, 0.024)), 0.01, M.gold);
      break; }
    case 'warAxe': case 'warAxeL': {
      // berserker bearded axe: long haft, double-bit head with beard, glowing blood runes
      const haft = mesh(cyl(0.022, 0.026, 0.95, 10), M.darkwood); haft.position.y = 0.25; g.add(haft);
      for (let i = 0; i < 4; i++) { const w = mesh(tor(0.026, 0.006, 4, 12), M.darkleather, false); w.rotation.x = PI / 2; w.position.y = -0.12 + i * 0.05; g.add(w); }
      const head = new THREE.Group(); head.position.y = 0.62;
      const bit = mesh(extrude([[0.02, 0.1], [0.1, 0.16], [0.22, 0.17], [0.26, 0.05], [0.24, -0.12], [0.16, -0.22], [0.08, -0.12], [0.02, -0.06]], 0.022, 0.006), M.steel); head.add(bit);
      const edge = mesh(extrude([[0.22, 0.17], [0.27, 0.05], [0.25, -0.13], [0.16, -0.23], [0.2, -0.13], [0.23, 0.04], [0.2, 0.15]], 0.012, 0.002), M.silver, false); head.add(edge);
      const back = mesh(extrude([[-0.02, 0.07], [-0.1, 0.1], [-0.14, 0.02], [-0.1, -0.07], [-0.02, -0.04]], 0.02, 0.005), M.darksteel); head.add(back);
      const sock = mesh(cyl(0.034, 0.034, 0.16, 10), M.blacksteel); head.add(sock);
      for (let i = 0; i < 3; i++) { const r = mesh(box(0.05, 0.012, 0.025), M.rune(0xff2a1a, 2.6), false); r.position.set(0.12, 0.06 - i * 0.06, 0); r.rotation.z = 0.3; head.add(r); }
      const top = spike(0.02, 0.1, M.darksteel); top.position.y = 0.12; head.add(top);
      g.add(head);
      const pom = spike(0.02, 0.06, M.darksteel); pom.rotation.z = PI; pom.position.y = -0.24; g.add(pom);
      tip.position.set(0.25, 0.62, 0); break; }
    case 'greatAxe': {
      // Executioner: a colossal two-handed axe. Long iron-banded haft (both hands fit on it), a huge
      // crescent blade with a bearded lower horn, a back spike, skull trophy and glowing blood runes.
      const haft = mesh(cyl(0.028, 0.034, 1.62, 12), M.darkwood); haft.position.y = 0.42; g.add(haft);
      for (const y of [-0.2, 0.08, 0.36, 0.64, 0.92]) { const b = mesh(cyl(0.038, 0.038, 0.05, 12), M.blacksteel); b.position.y = y; g.add(b); }
      for (let i = 0; i < 6; i++) { const w = mesh(tor(0.032, 0.006, 4, 12), M.darkleather, false); w.rotation.x = PI / 2; w.position.y = -0.14 + i * 0.045; g.add(w); }
      for (let i = 0; i < 4; i++) { const w = mesh(tor(0.032, 0.006, 4, 12), M.darkleather, false); w.rotation.x = PI / 2; w.position.y = 0.42 + i * 0.045; g.add(w); }
      const head = new THREE.Group(); head.position.y = 1.08;
      const blade = mesh(extrude([[0.03, 0.15], [0.16, 0.24], [0.33, 0.3], [0.44, 0.17], [0.47, -0.02], [0.43, -0.22], [0.3, -0.36], [0.2, -0.4], [0.14, -0.26], [0.08, -0.12], [0.03, -0.08]], 0.03, 0.008), M.steel); head.add(blade);
      const edge = mesh(extrude([[0.42, 0.18], [0.48, -0.02], [0.44, -0.24], [0.3, -0.38], [0.34, -0.26], [0.42, -0.05], [0.39, 0.16]], 0.016, 0.002), M.silver, false); head.add(edge);
      const back = mesh(extrude([[-0.03, 0.08], [-0.16, 0.06], [-0.26, 0.0], [-0.16, -0.06], [-0.03, -0.08]], 0.026, 0.006), M.darksteel); head.add(back);
      const sock = mesh(cyl(0.05, 0.05, 0.26, 12), M.blacksteel); head.add(sock);
      rivets(head, [V(0.08, 0.1, 0.022), V(0.08, -0.06, 0.022), V(0.08, 0.1, -0.022), V(0.08, -0.06, -0.022)], 0.012, M.brass);
      for (let i = 0; i < 4; i++) { const r = mesh(box(0.07, 0.014, 0.034), M.rune(0xff2a1a, 2.8), false); r.position.set(0.24, 0.12 - i * 0.08, 0); r.rotation.z = 0.25; head.add(r); }
      const sk = skullMesh(M, 0.05); sk.position.set(0.02, -0.2, 0.0); sk.rotation.y = PI / 2; head.add(sk);
      const topSpike = spike(0.03, 0.2, M.darksteel); topSpike.position.y = 0.2; head.add(topSpike);
      g.add(head);
      const pom = spike(0.028, 0.09, M.darksteel); pom.rotation.z = PI; pom.position.y = -0.4; g.add(pom);
      tip.position.set(0.46, 1.06, 0); break; }
    case 'bow': {
      // Hunter recurve bow: two curved limbs of dark wood, leather grip, taut string, bone tips
      const pts = s => [V(0, 0, 0), V(0, 0.25 * s, 0.05), V(0, 0.5 * s, 0.03), V(0, 0.62 * s, -0.04)];
      for (const s of [1, -1]) { g.add(mesh(tube(pts(s), 0.015, 16, 6), M.darkwood)); const tipB = spike(0.012, 0.05, M.bone); tipB.position.set(0, 0.64 * s, -0.05); if (s < 0) tipB.rotation.x = PI; g.add(tipB); }
      const string = mesh(cyl(0.002, 0.002, 1.24, 3), M.bone, false); string.position.z = -0.05; g.add(string);
      const grip = mesh(cyl(0.022, 0.022, 0.12, 8), M.darkleather); grip.position.z = 0.01; g.add(grip);
      tip.position.set(0, 0, 0.06); break; }
    case 'crossbow': {
      // Sharpshooter heavy crossbow: wooden stock along +Y (pointing forward), steel prod, bone stock end
      const stock = mesh(box(0.05, 0.62, 0.06), M.darkwood); stock.position.y = 0.18; g.add(stock);
      const butt = mesh(box(0.07, 0.16, 0.09), M.bone); butt.position.y = -0.18; g.add(butt);
      const prod = mesh(tube([V(-0.32, 0.36, 0), V(-0.16, 0.45, 0), V(0, 0.47, 0), V(0.16, 0.45, 0), V(0.32, 0.36, 0)], 0.016, 16, 6), M.darksteel); g.add(prod);
      const str = mesh(tube([V(-0.32, 0.36, 0), V(0, 0.3, 0), V(0.32, 0.36, 0)], 0.003, 8, 3), M.bone, false); g.add(str);
      const bolt = mesh(cyl(0.006, 0.006, 0.4, 5), M.wood, false); bolt.position.y = 0.5; g.add(bolt);
      const head = spike(0.012, 0.05, M.steel); head.position.y = 0.72; g.add(head);
      const scope = mesh(cyl(0.016, 0.016, 0.16, 8), M.brass); scope.position.set(0, 0.2, 0.05); g.add(scope);
      tip.position.set(0, 0.75, 0); break; }
    case 'bonestaff': case 'druidstaff': {
      // Necromancer bone staff (spine segments, floating skull) / Druid living-wood staff (twisted wood, leaves, glowing seed)
      const druid = kind === 'druidstaff';
      const shaft = mesh(tube([V(0, -0.35, 0), V(0.02, 0.2, 0.01), V(-0.015, 0.7, -0.01), V(0.01, 1.2, 0)], 0.024, 16, 7), druid ? M.wood : M.bone); g.add(shaft);
      if (!druid) for (let i = 0; i < 9; i++) { const v = mesh(cyl(0.032, 0.032, 0.03, 8), M.bone); v.position.y = -0.2 + i * 0.15; g.add(v); }
      const head = new THREE.Group(); head.position.y = 1.32;
      if (druid) {
        for (let i = 0; i < 5; i++) { const a = i / 5 * PI * 2; const br = mesh(tube([V(0, -0.12, 0), V(Math.sin(a) * 0.08, 0, Math.cos(a) * 0.08), V(Math.sin(a) * 0.05, 0.12, Math.cos(a) * 0.05)], 0.01, 8, 5), M.wood); head.add(br);
          const leaf = mesh(new THREE.CircleGeometry(0.04, 5), M.rune(0x6ac84a, 0.8), false); leaf.position.set(Math.sin(a) * 0.1, 0.02, Math.cos(a) * 0.1); leaf.rotation.y = a; head.add(leaf); }
        const seed = mesh(sph(0.055, 12, 10), M.gem(look.glow || 0x8ad86a)); head.add(seed);
      } else {
        const sk = skullMesh(M, 0.07); head.add(sk);
        for (let i = 0; i < 4; i++) { const h = horn(0.12, 0.012, 1.2, M.bone); h.rotation.set(0, i * PI / 2, 0.6); h.position.y = -0.06; head.add(h); }
      }
      const halo = mesh(sph(0.16, 12, 10), M.glow(look.glow || 0x7aff6a, 0.16), false); head.add(halo);
      g.add(head); g.userData.pulse = halo;
      tip.position.set(0, 1.32, 0); break; }
    case 'greatsword': {
      // Arms: a two-handed rune greatsword — long wrapped grip (both hands), wide crossguard, broad fullered blade
      const blade = mesh(extrude([[-0.055, 0], [0.055, 0], [0.05, 1.18], [0, 1.34], [-0.05, 1.18]], 0.016, 0.005), M.silver); blade.position.y = 0.2; g.add(blade);
      const fuller = mesh(box(0.02, 1.0, 0.036), M.darksteel, false); fuller.position.y = 0.76; g.add(fuller);
      for (let i = 0; i < 4; i++) { const r = mesh(box(0.034, 0.05, 0.04), M.rune(0xff5a3a, 2.2), false); r.position.y = 0.38 + i * 0.13; g.add(r); }
      const guard = mesh(tube([V(-0.24, 0.12, 0), V(-0.12, 0.17, 0), V(0, 0.18, 0), V(0.12, 0.17, 0), V(0.24, 0.12, 0)], 0.022, 12, 6), M.darksteel); g.add(guard);
      for (const s of [-1, 1]) { const k2 = spike(0.022, 0.07, M.gold); k2.rotation.z = -s * PI / 2; k2.position.set(s * 0.27, 0.11, 0); g.add(k2); }
      const grip = mesh(cyl(0.024, 0.026, 0.46, 10), M.darkleather); grip.position.y = -0.06; g.add(grip);
      for (let i = 0; i < 6; i++) { const w = mesh(tor(0.026, 0.005, 4, 12), M.leather, false); w.rotation.x = PI / 2; w.position.y = -0.24 + i * 0.07; g.add(w); }
      const pom = mesh(sph(0.04, 12, 8), M.gold); pom.position.y = -0.31; g.add(pom);
      tip.position.set(0, 1.5, 0); break; }
    case 'fang': case 'fangL': {
      // rogue curved, serrated fang dagger with poison channel
      const pts = []; for (let i = 0; i <= 8; i++) { const u = i / 8; pts.push([0.026 * (1 - u) + Math.sin(u * 2.2) * 0.04, u * 0.34]); }
      const back = []; for (let i = 8; i >= 0; i--) { const u = i / 8; back.push([-0.018 * (1 - u) + Math.sin(u * 2.2) * 0.04 - (i % 2 && u > 0.2 ? 0.006 : 0), u * 0.33]); }
      const blade = mesh(extrude([...pts, ...back], 0.006, 0.003), M.silver); blade.position.y = 0.06; g.add(blade);
      const channel = mesh(extrude(pts.slice(1, 7).map(([x, y]) => [x - 0.012, y]).concat(pts.slice(1, 7).reverse().map(([x, y]) => [x - 0.02, y])), 0.008, 0), M.rune(0x6aff4a, 2.2), false); channel.position.y = 0.06; g.add(channel);
      const guard = mesh(tube([V(-0.06, 0.05, 0.0), V(0, 0.06, 0), V(0.06, 0.045, 0.01)], 0.009, 10, 5), M.darksteel); g.add(guard);
      const grip = mesh(cyl(0.014, 0.016, 0.11, 8), M.darkleather); g.add(grip);
      const pom = mesh(sph(0.018, 8, 6), M.darksteel); pom.position.y = -0.06; g.add(pom);
      const drop = mesh(sph(0.008, 6, 4), M.rune(0x6aff4a, 3), false); drop.position.set(0.04, 0.4, 0); g.add(drop); g.userData.drop = drop;
      tip.position.set(0.04, 0.42, 0); break; }
    case 'archstaff': {
      // mage: tall ornate staff, gold-banded, crowned crystal with orbiting rings and shards
      const pts = []; for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push(V(Math.sin(u * 7) * 0.014, -0.62 + u * 1.86, Math.cos(u * 5) * 0.012)); }
      g.add(mesh(tube(pts, 0.024, 30, 8), M.darkwood));
      for (const y of [-0.5, -0.1, 0.4, 1.0]) { const b = mesh(cyl(0.03, 0.03, 0.04, 12), M.gold); b.position.y = y; g.add(b); }
      for (let k = 0; k < 4; k++) {
        const a = k / 4 * PI * 2, cp = [];
        for (let i = 0; i <= 6; i++) { const u = i / 6; cp.push(V(Math.sin(a) * (0.03 + Math.sin(u * PI) * 0.11), 1.12 + u * 0.36, Math.cos(a) * (0.03 + Math.sin(u * PI) * 0.11))); }
        g.add(mesh(tube(cp, 0.011, 12, 5), M.gold));
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
      g.add(mesh(cyl(0.02, 0.024, 0.72, 10), M.darkwood).translateY(0.18));
      const wrap = mesh(cyl(0.026, 0.026, 0.18, 10), M.ivory); wrap.position.y = -0.04; g.add(wrap);
      for (const y of [0.06, 0.52]) { const b = mesh(cyl(0.032, 0.032, 0.03, 12), M.gold); b.position.y = y; g.add(b); }
      const head = new THREE.Group(); head.position.y = 0.64;
      head.add(mesh(sph(0.07, 16, 12), M.gold));
      for (let i = 0; i < 8; i++) { const a = i / 8 * PI * 2; const fl = mesh(extrude([[0, -0.1], [0.07, -0.06], [0.09, 0.02], [0.05, 0.1], [0, 0.12]], 0.012, 0.003), M.gold); fl.position.set(Math.sin(a) * 0.06, 0, Math.cos(a) * 0.06); fl.rotation.y = a - PI / 2; head.add(fl); }
      for (const s of [-1, 1]) { const w = mesh(extrude([[0, 0], [0.08, 0.03], [0.16, 0.12], [0.07, 0.06], [0.02, 0.04]], 0.008, 0.002), M.silver); w.position.set(s * 0.05, 0.08, 0); w.scale.x = s; head.add(w); }
      const core = mesh(sph(0.04, 12, 10), M.rune(0xfff0b0, 4)); core.position.y = 0.06; head.add(core);
      const halo = mesh(sph(0.2, 12, 10), M.glow(look.glow || 0xffd98a, 0.16), false); head.add(halo);
      const top = spike(0.02, 0.09, M.gold); top.position.y = 0.14; head.add(top);
      g.add(head); g.userData.pulse = halo;
      tip.position.y = 0.7; break; }
    case 'stormaxe': case 'stormaxeL': {
      // shaman: stormcaller axe with crescent blade, crackling cyan runes, feathers and beads
      g.add(mesh(cyl(0.022, 0.026, 0.88, 10), M.wood).translateY(0.24));
      const head = new THREE.Group(); head.position.y = 0.6;
      head.add(mesh(extrude([[0.02, 0.09], [0.14, 0.18], [0.24, 0.12], [0.28, 0], [0.24, -0.12], [0.14, -0.18], [0.02, -0.09]], 0.02, 0.006), M.bronze));
      head.add(mesh(extrude([[0.24, 0.12], [0.29, 0], [0.24, -0.12], [0.22, -0.1], [0.26, 0], [0.22, 0.1]], 0.012, 0.002), M.silver, false));
      for (let i = 0; i < 3; i++) { const r = mesh(box(0.012, 0.07, 0.024), M.rune(0x5ae0ff, 3), false); r.position.set(0.1 + i * 0.045, 0, 0); r.rotation.z = (i - 1) * 0.4; head.add(r); }
      head.add(mesh(cyl(0.032, 0.032, 0.14, 10), M.blacksteel));
      const back = mesh(extrude([[-0.02, 0.05], [-0.13, 0.02], [-0.16, 0], [-0.13, -0.02], [-0.02, -0.05]], 0.016, 0.004), M.bronze); head.add(back);
      g.add(head);
      for (let i = 0; i < 3; i++) {
        const f = mesh(new THREE.PlaneGeometry(0.035, 0.16), new THREE.MeshStandardMaterial({ color: [0x7a2a1a, 0xe8e0d0, 0x2a2a2a][i], roughness: 1, side: THREE.DoubleSide }), false);
        f.position.set(-0.03 + i * 0.02, 0.38 - i * 0.03, 0.02); f.rotation.z = 0.25 - i * 0.2; g.add(f);
        const bead = mesh(sph(0.012, 6, 4), i === 1 ? M.bone : M.rune(0x5ae0ff, 1.2), false); bead.position.set(-0.03 + i * 0.02, 0.47 - i * 0.02, 0.02); g.add(bead);
      }
      const orb = mesh(sph(0.05, 10, 8), M.glow(0x5ae0ff, 0.25), false); orb.position.set(0.16, 0.6, 0); g.add(orb); g.userData.pulse = orb;
      tip.position.set(0.28, 0.6, 0); break; }
    case 'sunhammer': {
      // Paladin Crusader: two-handed war hammer — long gilded haft, a massive silver head with a
      // radiant sun disc on its striking face, a back spike and a glowing core
      const haft = mesh(cyl(0.026, 0.03, 1.5, 12), M.darkwood); haft.position.y = 0.4; g.add(haft);
      for (const y of [-0.32, 0.12, 0.55, 0.98]) { const b = mesh(cyl(0.036, 0.036, 0.045, 12), M.gold); b.position.y = y; g.add(b); }
      for (let i = 0; i < 6; i++) { const w = mesh(tor(0.031, 0.006, 4, 12), M.ivory, false); w.rotation.x = PI / 2; w.position.y = -0.2 + i * 0.05; g.add(w); }
      const head = new THREE.Group(); head.position.y = 1.2;
      head.add(mesh(box(0.36, 0.2, 0.19), M.silver));
      for (const x of [-0.12, 0.12]) { const band = mesh(box(0.03, 0.215, 0.205), M.gold); band.position.x = x; head.add(band); }
      const face = mesh(cyl(0.12, 0.11, 0.06, 20), M.gold); face.rotation.z = PI / 2; face.position.x = 0.2; head.add(face);
      const disc = mesh(cyl(0.075, 0.075, 0.02, 20), M.rune(0xfff0a0, 2.4), false); disc.rotation.z = PI / 2; disc.position.x = 0.235; head.add(disc);
      for (let i = 0; i < 10; i++) { const a = i / 10 * PI * 2, r = spike(0.016, 0.07, M.gold); r.position.set(0.2, Math.sin(a) * 0.14, Math.cos(a) * 0.14); r.rotation.x = a; head.add(r); }
      const back = spike(0.05, 0.2, M.silver); back.rotation.z = PI / 2; back.position.x = -0.27; head.add(back);
      const top = spike(0.03, 0.16, M.gold); top.position.y = 0.17; head.add(top);
      g.add(head);
      const glow = mesh(sph(0.2, 12, 10), M.glow(0xffe08a, 0.14), false); glow.position.set(0.22, 1.2, 0); g.add(glow); g.userData.pulse = glow;
      const pom = mesh(sph(0.045, 12, 8), M.gold); pom.position.y = -0.36; g.add(pom);
      tip.position.set(0.24, 1.2, 0); break; }
    case 'holysword': {
      // Paladin Protection: a blessed arming sword — bright blade with a light-filled fuller, winged gold guard
      const blade = mesh(extrude([[-0.042, 0], [0.042, 0], [0.036, 0.82], [0, 0.95], [-0.036, 0.82]], 0.012, 0.004), M.silver); blade.position.y = 0.1; g.add(blade);
      const fuller = mesh(box(0.014, 0.64, 0.02), M.rune(0xfff0b0, 1.8), false); fuller.position.y = 0.44; g.add(fuller);
      for (const s of [-1, 1]) { const w = mesh(extrude([[0, 0], [0.09, 0.02], [0.17, 0.09], [0.11, 0.05], [0.05, 0.05]], 0.012, 0.003), M.gold); w.position.set(0, 0.07, 0); w.scale.x = s; g.add(w); }
      const gem = mesh(sph(0.02, 10, 8), M.gem(0x6ab0ff)); gem.position.set(0, 0.085, 0.014); g.add(gem);
      const grip = mesh(cyl(0.017, 0.019, 0.19, 10), M.royal); grip.position.y = -0.02; g.add(grip);
      for (let i = 0; i < 4; i++) { const w = mesh(tor(0.019, 0.004, 4, 12), M.gold, false); w.rotation.x = PI / 2; w.position.y = -0.09 + i * 0.045; g.add(w); }
      const pom = mesh(sph(0.03, 12, 8), M.gold); pom.position.y = -0.14; g.add(pom);
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
      const face = mesh(extrude(outline, 0.04, 0.01), [new THREE.MeshStandardMaterial({ map: crest, roughness: 0.55, metalness: 0.35 }), M.steel]);
      const uv = face.geometry.attributes.uv, pos = face.geometry.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 0.66 + 0.5, pos.getY(i) / 1.18 + 0.5);
      g.add(face);
      const rimPts = [...outline, outline[0]].map(([x, y]) => V(x * 1.02, y * 1.02, 0.024));
      g.add(mesh(tube(rimPts, 0.022, 70, 6), M.gold));
      const boss = mesh(sph(0.07, 16, 10, 0, PI * 2, 0, PI / 2), M.gold); boss.rotation.x = PI / 2; boss.position.set(0, 0.0, 0.024); g.add(boss);
      const gem = mesh(sph(0.026, 10, 8), M.gem(0xfff0a0)); gem.position.set(0, 0.0, 0.08); g.add(gem);
      rivets(g, outline.map(([x, y]) => V(x * 0.9, y * 0.9, 0.028)), 0.012, M.gold);
      const foot = spike(0.03, 0.12, M.steel); foot.rotation.x = PI; foot.position.y = -0.66; g.add(foot);
      break; }
    case 'cleaver': {
      // Orc warrior: a brutal, notched cleaver-sword — wide single-edged blade, iron spine, bone grip, tooth trophies
      const blade = mesh(extrude([[-0.03, 0], [0.07, 0], [0.13, 0.5], [0.14, 0.78], [0.04, 0.9], [-0.03, 0.84], [-0.035, 0.6], [0.0, 0.55], [-0.035, 0.5]], 0.016, 0.005), M.steel); blade.position.y = 0.1; g.add(blade);
      const spine = mesh(box(0.02, 0.8, 0.026), M.blacksteel, false); spine.position.set(-0.03, 0.5, 0); g.add(spine);
      for (let i = 0; i < 4; i++) { const n = mesh(box(0.03, 0.02, 0.03), M.blacksteel, false); n.position.set(0.12, 0.42 + i * 0.12, 0); g.add(n); }
      rivets(g, [V(0.02, 0.2, 0.012), V(0.03, 0.35, 0.012), V(0.04, 0.5, 0.012)], 0.012, M.bronze);
      const guard = mesh(box(0.2, 0.04, 0.05), M.blacksteel); guard.position.y = 0.08; g.add(guard);
      for (const s of [-1, 1]) { const t = horn(0.09, 0.012, 1.2, M.bone); t.position.set(s * 0.1, 0.08, 0); t.rotation.z = -s * 1.2; g.add(t); }
      const grip = mesh(cyl(0.02, 0.022, 0.2, 10), M.bone); grip.position.y = -0.03; g.add(grip);
      for (let i = 0; i < 3; i++) { const w = mesh(tor(0.022, 0.005, 4, 12), M.darkleather, false); w.rotation.x = PI / 2; w.position.y = -0.1 + i * 0.06; g.add(w); }
      const pom = spike(0.025, 0.07, M.blacksteel); pom.rotation.z = PI; pom.position.y = -0.16; g.add(pom);
      tip.position.set(0.06, 0.98, 0); break; }
    case 'orcshield': {
      // Orc warrior: round war shield — iron-banded planks, a fanged red war-sigil, spiked rim
      const crest = canvasTex(256, (c, S) => {
        c.fillStyle = '#4a3020'; c.fillRect(0, 0, S, S);
        for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? '#563824' : '#3e2818'; c.fillRect(i * S / 6, 0, S / 6 - 2, S); }
        c.fillStyle = '#8a1a14'; c.beginPath(); c.moveTo(S * 0.5, S * 0.16); c.lineTo(S * 0.7, S * 0.5); c.lineTo(S * 0.5, S * 0.84); c.lineTo(S * 0.3, S * 0.5); c.closePath(); c.fill();
        c.fillStyle = '#e8dcc0'; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(S * 0.5 + s * S * 0.06, S * 0.42); c.lineTo(S * 0.5 + s * S * 0.13, S * 0.62); c.lineTo(S * 0.5 + s * S * 0.02, S * 0.5); c.fill(); }
      });
      crest.colorSpace = THREE.SRGBColorSpace;
      const disc = mesh(cyl(0.34, 0.34, 0.04, 28), [new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.9 }), new THREE.MeshStandardMaterial({ map: crest, roughness: 0.85 }), new THREE.MeshStandardMaterial({ map: crest, roughness: 0.85 })]);
      disc.rotation.x = PI / 2; g.add(disc);
      const rim = mesh(tor(0.34, 0.022, 6, 32), M.darksteel); g.add(rim);
      for (let i = 0; i < 10; i++) { const a = i / 10 * PI * 2, s = spike(0.022, 0.09, M.darksteel); s.position.set(Math.cos(a) * 0.37, Math.sin(a) * 0.37, 0); s.rotation.z = a - PI / 2; g.add(s); }
      for (const y of [-0.16, 0.16]) { const band = mesh(box(0.66, 0.035, 0.05), M.blacksteel); band.position.y = y; g.add(band); }
      const boss = mesh(sph(0.08, 14, 10, 0, PI * 2, 0, PI / 2), M.darksteel); boss.rotation.x = PI / 2; boss.position.z = 0.02; g.add(boss);
      const bs = spike(0.03, 0.12, M.darksteel); bs.rotation.x = PI / 2; bs.position.z = 0.1; g.add(bs);
      break; }
    case 'flamestaff': {
      // Fire mage: sun-gold staff — a burning orb cradled by swept phoenix wings, ember-red gems along the shaft
      const pts = []; for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push(V(Math.sin(u * 6) * 0.012, -0.62 + u * 1.84, Math.cos(u * 4) * 0.01)); }
      g.add(mesh(tube(pts, 0.024, 30, 8), M.crimson));
      for (const y of [-0.5, -0.05, 0.45, 0.98]) { const b = mesh(cyl(0.031, 0.031, 0.045, 12), M.gold); b.position.y = y; g.add(b); const gm = mesh(sph(0.014, 8, 6), M.gem(0xff5a1a), false); gm.position.set(0, y, 0.03); g.add(gm); }
      for (const s of [-1, 1]) for (let f = 0; f < 3; f++) {
        const w = mesh(extrude([[0, 0], [0.06, 0.05 + f * 0.02], [0.2 - f * 0.03, 0.2 + f * 0.04], [0.05, 0.08]], 0.008, 0.002), M.gold);
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
