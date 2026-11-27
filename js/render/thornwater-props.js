// Thornwater Gorge — the dressing: the map's fixtures (towers, shelters, racks, braziers… see GOLD_FIXTURES in
// js/sim/maps/thornwater.js) and the generated Tripo models (docs/THORNWATER_REDESIGN.md §6).
//
// Every fixture has a footprint from the map. It is drawn at once as a simple placeholder in its faction's
// colours; when its GLB (assets/models/thornwater/<id>.glb) loads, the placeholder is swapped for the model, fitted
// into the same footprint. A model that is missing or fails to load leaves the placeholder, so the map always works.
// Repeated models are InstancedMeshes: one draw call per material, however many copies stand on the map.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THORNWATER as M, SHELTER_POST } from '../sim/maps/thornwater.js';

export const MODEL_DIR = 'assets/models/thornwater/';
// fixture kind → model id per side [Sunward (x < 0), Ember (x > 0)]; null = keep the placeholder
export const FIXTURE_MODELS = {
  // towers, turrets and the gatehouse are architecture (tw-keep.js), built to the colliders
  tower: [null, null], turret: [null, null], gatehouse: [null, null], shelter: ['S05', 'E05'],
  brazier: ['S11', 'E12'], lantern: ['S10', 'E12'], rack: ['S09', 'E09'], armor: ['S08', 'E08'],
  throne: ['S13', 'E14'], drum: ['S06', 'E10'], spirit: ['N12', 'N12'], grave: ['N11a', 'N11b'],
  waymarker: ['N15', 'N15'], oak: ['N06', 'N08'], bigtree: ['N06', 'N06'], post: [null, null],
};
// how a model fills its footprint: 'contain' = uniform scale that fits w, d and h; 'stretch' = fits w and d, and
// is stretched (within limits) to the height — for towers, whose proportions the footprint dictates
const FIT = { tower: 'stretch', turret: 'stretch', gatehouse: 'stretch', shelter: 'posts', oak: 'height', bigtree: 'height', armor: 'height', lantern: 'height', brazier: 'height', waymarker: 'height' };
// shelter models: where their posts stand (fraction of the model's bounding box, measured) and how high their stone
// base is (fraction of the height) — scaled so the posts stand on the map's post colliders, sunk so the base's top
// is at the ground (the sim floor there is flat)
const POSTS = { S05: { r: 0.201, base: 0.145 }, E05: { r: 0.30, base: 0.182 } };
// faction palettes for the placeholders and the procedural decor
export const PALETTE = [
  { stone: 0xd6d0c2, roof: 0x2a55b8, trim: 0xe3b341, wood: 0x7a5a3a, cloth: 0x2a55b8, glow: 0xfff0c0, dark: 0x8a8478 },
  { stone: 0x4f4a47, roof: 0x8e1a1a, trim: 0x1b1716, wood: 0x5e4029, cloth: 0x9e1b1b, glow: 0xff7a30, dark: 0x2a2624 },
];

// ---------------------------------------------------------------- GLB models
const loader = new GLTFLoader();
const cache = new Map();
// a model as merged parts (one geometry per material, node transforms baked) plus its bounding box
export function loadModel(id) {
  if (!id) return Promise.resolve(null);
  if (!cache.has(id)) cache.set(id, new Promise(res => loader.load(MODEL_DIR + id + '.glb', g => res(prepModelAs(id, g.scene)), undefined, () => res(null))));
  return cache.get(id);
}
function prepModel(root) {
  root.updateMatrixWorld(true);
  const byMat = new Map();
  root.traverse(o => {
    if (!o.isMesh) return;
    let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const m = o.material;
    if (!byMat.has(m)) byMat.set(m, []);
    byMat.get(m).push(g);
  });
  if (!byMat.size) return null;
  const parts = [...byMat].map(([mat, gs]) => {
    // mergeGeometries wants all indexed or none
    const list = gs.every(g => g.index) || gs.every(g => !g.index) ? gs : gs.map(g => g.index ? g.toNonIndexed() : g);
    const geo = list.length > 1 ? mergeGeometries(list, false) || list[0] : list[0];
    return { geo, mat: styleMaterial(mat) };
  });
  const box = new THREE.Box3();
  for (const p of parts) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
  return { parts, box };
}
function prepModelAs(id, root) {
  const m = prepModel(root); if (m) m.id = id; return m;
}
// Tripo materials arrive as glossy PBR; the hand-painted look wants them matte and lit mostly by their own texture
function styleMaterial(m) {
  const s = m.clone();
  if (s.isMeshStandardMaterial) {
    if (!s.metalnessMap) s.metalness = Math.min(s.metalness, 0.15);
    if (!s.roughnessMap) s.roughness = Math.max(s.roughness, 0.75);
    s.envMapIntensity = 0.6;
  }
  if (s.map) { s.map.colorSpace = THREE.SRGBColorSpace; s.map.anisotropy = 4; }
  return s;
}
const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _s = new THREE.Matrix4(), _t = new THREE.Matrix4();
// the matrix that puts `model` into footprint p ({ x, y, z, yaw, w, d, h }), bottom on y, centred on x/z
export function fitMatrix(model, p, fit = 'contain', out = new THREE.Matrix4()) {
  const b = model.box, bx = b.max.x - b.min.x, by = b.max.y - b.min.y, bz = b.max.z - b.min.z;
  if (fit === 'posts' && POSTS[model.id]) {
    const P = POSTS[model.id], k = SHELTER_POST / P.r, sink = P.base * by * k - 0.06;
    _t.makeTranslation(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    _s.makeScale(k, k, k); _r.makeRotationY(p.yaw || 0);
    return out.makeTranslation(p.x, (p.y || 0) - sink, p.z).multiply(_r).multiply(_s).multiply(_t);
  }
  if (fit === 'posts') fit = 'stretch';
  if (fit === 'box') { // fill the footprint exactly (yaw 0 or a quarter turn): ruins and rocks over their colliders
    const q = Math.abs(Math.sin(p.yaw || 0)) > 0.5, sx = (q ? p.d : p.w) / bx, sz = (q ? p.w : p.d) / bz;
    _t.makeTranslation(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    _s.makeScale(sx, p.h / by, sz); _r.makeRotationY(p.yaw || 0);
    return out.makeTranslation(p.x, p.y || 0, p.z).multiply(_r).multiply(_s).multiply(_t);
  }
  if (fit === 'height') { // trees: as tall as the footprint says, centred on the trunk (the collider), crown overhead
    const k = p.h / by;
    _t.makeTranslation(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    _s.makeScale(k, k, k); _r.makeRotationY(p.yaw || 0);
    return out.makeTranslation(p.x, (p.y || 0) - 0.15, p.z).multiply(_r).multiply(_s).multiply(_t);
  }
  const c = Math.abs(Math.cos(p.yaw || 0)), s = Math.abs(Math.sin(p.yaw || 0));
  const ex = c * bx + s * bz, ez = s * bx + c * bz;      // the model's footprint once turned
  let k = Math.min(p.w / ex, p.d / ez), ky;
  if (fit === 'stretch') ky = Math.max(0.7 * k, Math.min(1.45 * k, p.h / by));
  else { k = Math.min(k, p.h / by); ky = k; }
  _t.makeTranslation(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  _s.makeScale(k, ky, k); _r.makeRotationY(p.yaw || 0);
  out.makeTranslation(p.x, p.y || 0, p.z).multiply(_r).multiply(_s).multiply(_t);
  return out;
}
// one InstancedMesh per part of the model, a copy per placement. chunk > 0 splits the copies into square cells of
// that size: an InstancedMesh is culled as a whole, so a map-wide one would always be drawn (and in the shadow pass)
export function instance(model, placements, { fit = 'contain', cast = true, matrices, chunk = 0 } = {}) {
  if (chunk > 0) {
    const cells = new Map();
    placements.forEach((p, i) => { const k = Math.floor(p.x / chunk) + ',' + Math.floor(p.z / chunk); if (!cells.has(k)) cells.set(k, { list: [], mats: [] }); const c = cells.get(k); c.list.push(p); if (matrices) c.mats.push(matrices[i]); });
    const g = new THREE.Group();
    for (const c of cells.values()) g.add(instance(model, c.list, { fit, cast, matrices: matrices ? c.mats : undefined }));
    return g;
  }
  const g = new THREE.Group();
  for (const part of model.parts) {
    const im = new THREE.InstancedMesh(part.geo, part.mat, placements.length);
    placements.forEach((p, i) => im.setMatrixAt(i, matrices ? matrices[i] : fitMatrix(model, p, p.fit || fit, _m)));
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.computeBoundingBox?.();
    im.castShadow = cast; im.receiveShadow = true;
    g.add(im);
  }
  return g;
}

// ---------------------------------------------------------------- placeholders
// simple faction-coloured shapes, built from the footprint; merged per kind and side (one draw call each)
const tint = (g, hex) => {
  g = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
};
const at = (g, x, y, z, ry = 0) => g.rotateY(ry).translate(x, y, z);
function placeholderParts(f) {
  const P = PALETTE[f.side], out = [], add = (g, col) => out.push(tint(g, col));
  const { x, y, z, w, d, h, yaw } = f;
  // local helper: a point in the fixture's own frame (u across, v forward) → world
  const L = (u, v) => [x + Math.cos(yaw) * u + Math.sin(yaw) * v, z - Math.sin(yaw) * u + Math.cos(yaw) * v];
  switch (f.kind) {
    case 'post': add(at(new THREE.CylinderGeometry(w * 0.42, w * 0.5, h, 8), x, y + h / 2, z), f.side ? P.wood : P.stone); break;
    case 'shelter': {
      add(at(new THREE.CylinderGeometry(w * 0.55, w * 0.58, 0.18, f.side ? 10 : 4, 1), x, y + 0.09, z, Math.PI / 4), f.side ? P.dark : P.stone);
      const roof = f.side ? new THREE.ConeGeometry(w * 0.72, 1.9, 6) : new THREE.ConeGeometry(w * 0.7, 1.6, 4);
      add(at(roof, x, y + 3.3 + (f.side ? 0.95 : 0.8), z, Math.PI / 4), P.roof);
      add(at(new THREE.BoxGeometry(w * 0.95, 0.25, w * 0.95), x, y + 3.25, z, 0), f.side ? P.wood : P.trim);
      break;
    }
    case 'tower-placeholder': {
      const r = Math.min(w, d) / 2;
      if (f.side === 0) {
        add(at(new THREE.CylinderGeometry(r * 0.92, r, h * 0.78, 14), x, y + h * 0.39, z), P.stone);
        add(at(new THREE.CylinderGeometry(r * 1.12, r * 0.95, 0.9, 14), x, y + h * 0.78, z), P.stone);
        add(at(new THREE.ConeGeometry(r * 1.2, h * 0.24, 14), x, y + h * 0.78 + 0.45 + h * 0.12, z), P.roof);
        add(at(new THREE.SphereGeometry(r * 0.16, 8, 6), x, y + h * 1.02 + 0.45, z), P.trim);
      } else {
        add(at(new THREE.BoxGeometry(w, h * 0.8, d), x, y + h * 0.4, z), P.stone);
        add(at(new THREE.BoxGeometry(w * 1.15, h * 0.12, d * 1.15), x, y + h * 0.86, z), P.wood);
        add(at(new THREE.ConeGeometry(Math.max(w, d) * 0.85, h * 0.16, 4), x, y + h * 0.92 + h * 0.08, z, Math.PI / 4), P.trim);
        for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(at(new THREE.ConeGeometry(0.12, 1.2, 5).rotateZ(a * 0.6).rotateX(-b * 0.6), x + a * w * 0.6, y + h * 0.9, z + b * d * 0.6), 0xe8e0cc);
      }
      break;
    }
    case 'brazier': case 'lantern': {
      add(at(new THREE.CylinderGeometry(w * 0.18, w * 0.3, h * 0.85, 8), x, y + h * 0.425, z), f.side ? P.wood : P.dark);
      add(at(new THREE.CylinderGeometry(w * 0.5, w * 0.3, h * 0.18, 10), x, y + h * 0.9, z), f.side ? P.trim : P.trim);
      break;
    }
    case 'rack': {
      const [cx, cz] = L(0, 0);
      add(at(new THREE.BoxGeometry(w * 0.95, 0.12, 0.25), cx, y + h * 0.55, cz, yaw), P.wood);
      add(at(new THREE.BoxGeometry(w * 0.95, 0.12, 0.25), cx, y + 0.2, cz, yaw), P.wood);
      for (let i = 0; i < 4; i++) { const [px, pz] = L(-w * 0.36 + i * w * 0.24, 0); add(at(new THREE.BoxGeometry(0.08, h * 0.9, 0.04), px, y + h * 0.45, pz, yaw), 0xb8bcc4); }
      break;
    }
    case 'armor': {
      add(at(new THREE.CylinderGeometry(w * 0.4, w * 0.45, 0.15, 10), x, y + 0.075, z), P.wood);
      add(at(new THREE.CylinderGeometry(w * 0.26, w * 0.18, h * 0.45, 10), x, y + h * 0.55, z), f.side ? 0x3a3634 : 0xc8ccd4);
      add(at(new THREE.SphereGeometry(w * 0.16, 10, 8), x, y + h * 0.88, z), f.side ? 0x3a3634 : 0xc8ccd4);
      break;
    }
    case 'throne': {
      const [bx, bz] = L(0, -Math.min(w, d) * 0.35);
      add(at(new THREE.BoxGeometry(w * 0.8, 0.7, d * 0.8), x, y + 0.35, z), P.stone);
      add(at(new THREE.BoxGeometry(d * 0.8, h, 0.35), bx, y + h / 2, bz, yaw), P.stone);
      add(at(new THREE.BoxGeometry(d * 0.5, h * 0.4, 0.38), bx, y + h * 0.6, bz, yaw), P.cloth);
      break;
    }
    case 'drum': add(at(new THREE.CylinderGeometry(w * 0.45, w * 0.45, h * 0.8, 14), x, y + h * 0.5, z), f.side ? 0x8a6a48 : P.trim); break;
    case 'spirit': {
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; add(at(new THREE.BoxGeometry(0.3, 1.1, 0.25), x + Math.cos(a) * w * 0.4, y + 0.55, z + Math.sin(a) * w * 0.4, -a), 0x8a8a80); }
      add(at(new THREE.CylinderGeometry(0.25, 0.35, 1.2, 8), x, y + 0.6, z), 0x9a968c);
      break;
    }
    case 'grave': add(at(new THREE.BoxGeometry(Math.max(w, d), h, Math.min(w, d)), x, y + h / 2, z, Math.abs(Math.sin(yaw)) > 0.5 ? Math.PI / 2 : 0), 0x8f8c84); break;
    case 'waymarker': {
      add(at(new THREE.CylinderGeometry(0.08, 0.1, h, 6), x, y + h / 2, z), P.wood);
      add(at(new THREE.BoxGeometry(1.0, 0.22, 0.05), x + 0.3, y + h * 0.8, z, yaw), P.wood);
      add(at(new THREE.BoxGeometry(0.9, 0.22, 0.05), x - 0.25, y + h * 0.62, z, yaw + 0.5), P.wood);
      break;
    }
    case 'oak': case 'bigtree': {
      add(at(new THREE.CylinderGeometry(0.3, 0.45, h * 0.55, 8), x, y + h * 0.275, z), 0x5a4030);
      if (f.side === 0 || f.kind === 'bigtree') add(at(new THREE.IcosahedronGeometry(h * 0.32, 1), x, y + h * 0.72, z), 0x4a7a32);
      else for (let i = 0; i < 4; i++) add(at(new THREE.CylinderGeometry(0.06, 0.14, 2.6, 5).translate(0, 1.3, 0).rotateZ(0.7).rotateY(i * 1.6), x, y + h * 0.45, z), 0x4a4038);
      break;
    }
  }
  return out;
}

// a carpet runner: Sunward royal blue with a gold border and suns, Ember blood red with a black border and fangs
function carpetTexture(side, aspect) {
  const W = 128, H = Math.min(1024, Math.round(128 * aspect)), c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = side ? '#1a1212' : '#c99a2e'; g.fillRect(0, 0, W, H);
  g.fillStyle = side ? '#7e1414' : '#23479e'; g.fillRect(10, 0, W - 20, H);
  g.fillStyle = side ? '#1a1212' : '#e3b341';
  for (let y = 40; y < H - 20; y += 90) {
    if (side) { g.beginPath(); g.moveTo(W / 2 - 18, y - 16); g.lineTo(W / 2, y + 20); g.lineTo(W / 2 + 18, y - 16); g.closePath(); g.fill(); }
    else { g.beginPath(); g.arc(W / 2, y, 12, 0, 6.3); g.fill(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g.fillRect(W / 2 + Math.cos(a) * 18 - 2, y + Math.sin(a) * 18 - 2, 4, 4); } }
  }
  for (const x of [16, W - 20]) { g.fillStyle = side ? '#3a0c0c' : '#e8c060'; g.fillRect(x, 0, 4, H); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// ---------------------------------------------------------------- the dressing
export class ThornwaterProps {
  // tw: the Thornwater arena (group, flames, quality)
  constructor(tw) {
    this.tw = tw;
    this.group = new THREE.Group(); this.group.name = 'tw-props'; tw.group.add(this.group);
    this.slots = new Map(); // 'kind:side' → { fixtures, placeholder, model }
    for (const f of M.fixtures) {
      const key = f.kind + ':' + f.side;
      if (!this.slots.has(key)) this.slots.set(key, { kind: f.kind, side: f.side, fixtures: [] });
      this.slots.get(key).fixtures.push(f);
    }
    this.phMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true });
    for (const s of this.slots.values()) {
      const geos = s.fixtures.flatMap(placeholderParts);
      if (!geos.length) continue;
      s.placeholder = new THREE.Mesh(mergeGeometries(geos), this.phMat);
      s.placeholder.castShadow = true; s.placeholder.receiveShadow = true;
      this.group.add(s.placeholder);
    }
    this.buildGlows();
    this.ready = Promise.all([this.loadModels(), this.reskinBlocks()]);
  }
  // fire, lantern light and the spirit crystal stay procedural whatever model stands under them
  buildGlows() {
    // carpets (painted runners) and the buff daises (a stone ring with glowing runes) are flat: no model, no collider
    for (const f of M.fixtures) {
      if (f.kind === 'carpet') {
        const turned = Math.abs(Math.sin(f.yaw)) > 0.5, len = turned ? f.w : f.d, wid = turned ? f.d : f.w;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(wid, len).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: carpetTexture(f.side, len / wid), roughness: 0.95 }));
        m.rotation.y = f.yaw; m.position.set(f.x, f.y + 0.035, f.z); m.receiveShadow = true; this.group.add(m);
      } else if (f.kind === 'dais') {
        const P = PALETTE[f.side];
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(f.w / 2, f.w / 2 + 0.08, 0.08, 32), new THREE.MeshStandardMaterial({ color: P.stone, roughness: 0.9 }));
        ring.position.set(f.x, f.y + 0.04, f.z); ring.receiveShadow = true; this.group.add(ring);
        const rune = new THREE.Mesh(new THREE.RingGeometry(f.w * 0.3, f.w * 0.42, 6, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: P.glow, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
        rune.position.set(f.x, f.y + 0.09, f.z); this.group.add(rune);
      }
    }
    const fireMat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const f of M.fixtures) {
      const P = PALETTE[f.side];
      if (f.kind === 'brazier' || (f.kind === 'lantern' && f.side === 1)) {
        const fire = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.85, 8), fireMat(0xffa040)); fire.position.set(f.x, f.y + f.h + 0.3, f.z); this.group.add(fire); this.tw.flames.push(fire);
      } else if (f.kind === 'lantern') {
        const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshBasicMaterial({ color: P.glow })); lamp.position.set(f.x, f.y + f.h - 0.35, f.z); this.group.add(lamp);
      } else if (f.kind === 'spirit') {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x7ac8ff, emissiveIntensity: 1.4 }));
        gem.position.set(f.x, f.y + 1.75, f.z); gem.scale.y = 1.6; this.group.add(gem); (this.gems || (this.gems = [])).push(gem);
      }
    }
    // a few warm lights where the fires are (no shadows): one per brazier pair, one per bridgehead
    for (const side of [0, 1]) {
      const s = side ? -1 : 1, P = PALETTE[side];
      const gate = new THREE.PointLight(P.glow, 16, 15, 1.6); gate.position.set(-57.3 * s, 2.6, 0); this.group.add(gate);
      const bh = new THREE.PointLight(P.glow, 8, 10, 1.6); bh.position.set(-16.3 * s, 3, 0); this.group.add(bh);
    }
  }
  async loadModels() {
    const jobs = [];
    for (const s of this.slots.values()) {
      const id = FIXTURE_MODELS[s.kind]?.[s.side];
      if (!id) continue;
      jobs.push(loadModel(id).then(model => {
        if (!model) return;
        s.model = instance(model, s.fixtures, { fit: FIT[s.kind] || 'contain' });
        this.group.add(s.model);
        if (s.placeholder) { this.group.remove(s.placeholder); s.placeholder.geometry.dispose(); s.placeholder = null; }
        // a shelter model brings its own posts
        if (s.kind === 'shelter') { const p = this.slots.get('post:' + s.side); if (p?.placeholder) { this.group.remove(p.placeholder); p.placeholder = null; } }
      }));
    }
    await Promise.all(jobs);
  }
  // the lane ruins and boulders: Tripo models filling their colliders exactly (the procedural ones stay until they load)
  async reskinBlocks() {
    const tw = this.tw, small = b => b.x1 - b.x0 < 1.6 && b.z1 - b.z0 < 1.6;
    const fp = (b, k, yaw) => ({ x: (b.x0 + b.x1) / 2, y: b.y0 - 0.1, z: (b.z0 + b.z1) / 2, w: (b.x1 - b.x0) * k, d: (b.z1 - b.z0) * k, h: (b.y1 - b.y0) * k + 0.1, yaw });
    const sets = [
      { ids: ['N09a'], mesh: 'ruinCol', list: M.blocks.filter(b => b.kind === 'ruin' && small(b)).map((b, i) => fp(b, 1.05, (i % 4) * Math.PI / 2)) },
      { ids: ['N10'], mesh: 'ruinWall', list: M.blocks.filter(b => b.kind === 'ruin' && !small(b)).map(b => fp(b, 1.0, (b.z1 - b.z0 > b.x1 - b.x0 ? Math.PI / 2 : 0) + (b.x0 < 0 ? 0 : Math.PI))) },
      { ids: ['N03a', 'N03b'], mesh: 'boulder', list: M.blocks.filter(b => b.kind === 'boulder').map((b, i) => fp(b, 1.06, ((i * 3) % 4) * Math.PI / 2)) },
    ];
    await Promise.all(sets.map(async S => {
      const models = (await Promise.all(S.ids.map(loadModel))).filter(Boolean); if (!models.length || !S.list.length) return;
      models.forEach((m, k) => { const list = S.list.filter((p, i) => i % models.length === k); if (list.length) this.group.add(instance(m, list, { fit: 'box' })); });
      if (tw.blockMeshes?.[S.mesh]) tw.blockMeshes[S.mesh].visible = false;
    }));
  }
  update(dt, t) {
    for (const g of this.gems || []) { g.rotation.y += dt * 0.8; g.position.y += Math.sin(t * 2 + g.position.x) * 0.002; }
  }
}
