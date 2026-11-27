// The central bridge (shared by every arena): a stone arch bridge with plank decking, ramps at both
// ends, low parapet curbs, iron lanterns and a keystone emblem. Dimensions come from BRIDGE in sim.js,
// so what you see is exactly what blocks movement and line of sight.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BRIDGE, archY } from '../sim/sim.js';

const TEX_DIR = 'assets/tex/'; // relative: the site is served from a sub-path
const loader = new THREE.TextureLoader();
const texCache = new Map();
function tex(file, srgb) {
  let t = texCache.get(file);
  if (!t) {
    t = loader.load(TEX_DIR + file); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(file, t);
  }
  return t;
}
function pbr(name, o = {}) {
  const arm = tex(name + '_arm.jpg');
  const m = new THREE.MeshStandardMaterial({ map: tex(name + '_Diffuse.jpg', true), normalMap: tex(name + '_nor_gl.jpg'), aoMap: arm, roughnessMap: arm, roughness: 1, metalness: o.metal ? 1 : 0, color: o.color ?? 0xffffff });
  if (o.metal) m.metalnessMap = arm;
  return m;
}

// world-space box-projected UVs (geometry already in world coordinates), `size` metres per tile
function worldUV(g, size) {
  g = g.index ? g.toNonIndexed() : g;
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let u, v;
    if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u / size; uv[i * 2 + 1] = v / size;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
const boxAt = (w, h, d, x, y, z, rz = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rz) g.rotateZ(rz); g.translate(x, y, z); return g; };
const extrudeZ = (pts, z0, depth) => { const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))); const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 24 }); g.translate(0, 0, z0); return g; };

// skin (optional): { stone, trim, planks, iron } materials that replace the default PBR sets — an arena can dress
// the shared bridge in its own stone. The shape never changes (it is the collider).
export function buildBridge(skin = null) {
  const { hx, hz, H, ramp, slab } = BRIDGE, end = hx + ramp, W = hz + 0.25, Hb = H - slab;
  const stone = [], trim = [], planks = [], iron = [];

  // deck slab
  stone.push(boxAt(2 * hx + 0.6, slab, 2 * W, 0, H - slab / 2 - 0.03, 0));
  // ramps: solid wedges from the deck down to the floor
  for (const s of [1, -1]) {
    const pts = s > 0 ? [[hx, 0], [end, 0], [hx, H - 0.03]] : [[-hx, 0], [-hx, H - 0.03], [-end, 0]];
    stone.push(extrudeZ(pts, -W, 2 * W));
    // abutment piers where ramp meets deck (frame the arch)
    trim.push(boxAt(0.7, Hb + 0.05, 2 * W + 0.3, s * (hx + 0.2), Hb / 2, 0));
  }
  // the vault: solid masonry between the arch curve and the deck, through the whole bridge width
  // (the curve is sampled by angle so the steep ends of the flattened arch stay smooth)
  const P = 2.6, A = archY(0), curve = [];
  for (let i = 0; i <= 40; i++) {
    const th = Math.PI * i / 40, c = Math.cos(th), s = Math.sin(th);
    curve.push([hx * Math.sign(c) * Math.pow(Math.abs(c), 2 / P), A * Math.pow(s, 2 / P)]);
  }
  stone.push(extrudeZ([[-hx, 0], [-hx, Hb], [hx, Hb], ...curve], -W, 2 * W));
  // arch ring (voussoirs) on both faces, following the curve and standing slightly proud of the face
  for (const zf of [1, -1]) for (let i = 0; i < 40; i += 2) {
    const [x0, y0] = curve[i], [x1, y1] = curve[i + 2];
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, len = Math.hypot(x1 - x0, y1 - y0) * 0.94;
    let nx = -(y1 - y0), ny = x1 - x0; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; } // point into the masonry
    const g = new THREE.BoxGeometry(len, 0.42, 0.16);
    g.rotateZ(Math.atan2(y1 - y0, x1 - x0));
    g.translate(mx + nx * 0.21, my + ny * 0.21, zf * (W + 0.06));
    trim.push(g);
  }
  // keystone with an emblem disc
  for (const zf of [1, -1]) trim.push(boxAt(0.6, 0.7, 0.3, 0, A + 0.3, zf * (W + 0.1)));
  // cornice band under the deck edge
  for (const zf of [1, -1]) trim.push(boxAt(2 * hx + 0.8, 0.16, 0.24, 0, Hb + 0.02, zf * (W + 0.04)));

  // walking surface: planks on the deck and the ramps
  planks.push(boxAt(2 * hx + 0.2, 0.06, 2 * hz, 0, H, 0));
  const slope = Math.atan2(H, ramp), sl = Math.hypot(H, ramp);
  for (const s of [1, -1]) planks.push(boxAt(sl, 0.06, 2 * hz, s * (hx + ramp / 2), H / 2, 0, -s * slope));
  // low parapet curbs (outside the walkable strip) along deck and ramps
  for (const zf of [1, -1]) {
    trim.push(boxAt(2 * hx + 0.6, 0.32, 0.26, 0, H + 0.13, zf * (hz + 0.12)));
    for (const s of [1, -1]) trim.push(boxAt(sl, 0.32, 0.26, s * (hx + ramp / 2), H / 2 + 0.13, zf * (hz + 0.12), -s * slope));
  }
  // corner posts with iron lanterns on the deck ends
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, emissive: 0xffa040, emissiveIntensity: 3.2 });
  const flames = [];
  for (const s of [1, -1]) for (const zf of [1, -1]) {
    const x = s * (hx - 0.2), z = zf * (hz + 0.12);
    trim.push(boxAt(0.42, 0.9, 0.42, x, H + 0.45, z));
    trim.push(boxAt(0.52, 0.12, 0.52, x, H + 0.94, z));
    iron.push(boxAt(0.06, 0.7, 0.06, x, H + 1.35, z));
    const cage = new THREE.CylinderGeometry(0.17, 0.12, 0.34, 6, 1, true); cage.translate(x, H + 1.78, z); iron.push(cage);
    const cap = new THREE.ConeGeometry(0.22, 0.2, 6); cap.translate(x, H + 2.05, z); iron.push(cap);
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), glowMat); fl.position.set(x, H + 1.76, z); flames.push(fl);
  }
  // ramp foot caps
  for (const s of [1, -1]) for (const zf of [1, -1]) trim.push(boxAt(0.5, 0.45, 0.5, s * (end - 0.1), 0.22, zf * (hz + 0.12)));

  const group = new THREE.Group(); group.name = 'bridge';
  const add = (geos, mat, size) => {
    const g = mergeGeometries(geos.map(x => worldUV(x, size)), false);
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; group.add(m); return m;
  };
  add(stone, skin?.stone || pbr('medieval_blocks_02', { color: 0xd0c8bc }), 2.2);
  add(trim, skin?.trim || pbr('rock_wall_08', { color: 0xa09a92 }), 1.6);
  add(planks, skin?.planks || pbr('weathered_planks', { color: 0xc8b8a4 }), 1.4);
  add(iron, skin?.iron || pbr('rusty_metal_02', { metal: true, color: 0x8a8078 }), 0.8);
  for (const f of flames) group.add(f);
  // emblem discs on the keystones (team-neutral gold rune)
  const embl = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 1, roughness: 0.35, emissive: 0xffb040, emissiveIntensity: 0.25 });
  for (const zf of [1, -1]) {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 20), embl);
    d.rotation.x = Math.PI / 2; d.position.set(0, archY(0) + 0.3, zf * (W + 0.27)); group.add(d);
  }
  group.userData.update = (t) => { glowMat.emissiveIntensity = 3 + Math.sin(t * 9) * 0.4 + Math.sin(t * 23) * 0.25; };
  return group;
}
