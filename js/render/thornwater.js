// Thornwater Gorge — the look of the 5v5 flag battleground (the rules are js/sim/flag.js, the geometry
// js/sim/maps/thornwater.js). Built from the same block list the simulation uses, so what you see is exactly what
// blocks movement and line of sight. Arena contract (see arenas.js) plus sync(view, chars, dt, myTeam) for the
// flags, gates and power-ups.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THORNWATER as M } from '../sim/maps/thornwater.js';
import { POWERUPS } from '../sim/flag.js';
import { mapGround } from '../sim/sim.js';
import { ThornwaterProps } from './thornwater-props.js';
import { groundMaterial, groundTextures, archTextures } from './tw-ground.js';
import { KeepArchitecture } from './tw-keep.js';
import { outerGround, buildEdges } from './tw-edges.js';

const TEX_DIR = 'assets/tex/';
export const TEAM_COLORS = [0xe8b04a, 0xc8302a]; // Gold, Crimson
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v; }
const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.15;

// world-space box-projected UVs, `size` metres per texture tile
function worldUV(g, size) {
  g = g.index ? g.toNonIndexed() : g;
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let u, v; if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u / size; uv[i * 2 + 1] = v / size;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
const boxAt = (x0, x1, y0, y1, z0, z1) => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
// a rough rock: a subdivided box pushed in and out with noise (the bottom stays flat)
function rockGeo(b, seed, rough = 0.35) {
  const w = b.x1 - b.x0, h = b.y1 - b.y0, d = b.z1 - b.z0;
  const g = new THREE.BoxGeometry(w, h, d, Math.max(2, Math.round(w / 1.2)), Math.max(2, Math.round(h / 1.2)), Math.max(2, Math.round(d / 1.2)));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < -h / 2 + 0.05) continue;
    const n = fbm(x * 0.6 + seed, z * 0.6 + y * 0.4 + seed * 1.7) - 0.5;
    const k = rough * (0.6 + 0.4 * (y + h / 2) / h);
    p.setXYZ(i, x * (1 + n * k * 0.35), y + n * k * 0.6, z * (1 + n * k * 0.35));
  }
  return g.translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
}

// ---------------------------------------------------------------- what the ground is made of
// Laid out for the Gold half and mirrored (x, z) → (−x, −z) like the map. Weights: g grass, d dirt, c cobble, r rock.
const segDist = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz))); return Math.hypot(px - ax - dx * t, pz - az - dz * t); };
const STREETS = [ // cobbled: [ax, az, bx, bz, half width]
  [-60, 0, -42, 0, 3.4], [-42, 0, -36, 0, 2.2],   // from the gate across the yard, fading into the middle lane
  [-15.5, 0, -21.5, 0, 2.8],                       // the bridgehead
  [-64.2, 14.5, -63, 20, 1.7],                     // the side door's step
  [-87, -15, -87, -21, 1.8],                       // under the balcony
];
const SQUARES = [[-47, 10, 3.4], [-24, 24, 3.4], [-12, -6, 3.4], [-24, -24, 3.4], [-50, -10.5, 4.6], [-50, 0, 5.5]]; // shelters, graveyard, the yard
function gold(x, z) {
  const n = fbm(x * 0.21, z * 0.21), wob = (n - 0.5) * 1.6; // ragged edges
  let c = 0;
  for (const [ax, az, bx, bz, hw] of STREETS) c = Math.max(c, 1 - smooth(hw - 0.6, hw + 0.4, segDist(x, z, ax, az, bx, bz) + wob * 0.5));
  for (const [cx, cz, r] of SQUARES) c = Math.max(c, 1 - smooth(r - 0.7, r + 0.4, Math.hypot(x - cx, z - cz) + wob * 0.5));
  // a paved apron round the keep
  const kd = Math.max(-97.5 - x, x + 58.3, Math.abs(z) - 16.6);
  c = Math.max(c, 1 - smooth(0, 1.2, kd + wob * 0.4));
  // dirt: the three lanes, the cross path, the yard, the way round the keep. The paths wander (low-frequency noise
  // on the centre line), change width, and fade out raggedly, so they read as trodden ground, not a grid of strips.
  let d = 0;
  if (x < 2) {
    const wander = (u, s) => (fbm(u * 0.035 + s, s * 1.7) - 0.5) * 7, width = (u, s) => 0.7 + fbm(u * 0.06 + s * 3, s) * 0.7;
    const soft = (hw, dist) => 1 - smooth(hw * 0.35, hw * 1.25, dist + wob * 1.4);
    const nl = Math.abs(z - (24 + 2.2 * Math.sin(x * 0.07) + wander(x, 1))), sl = Math.abs(z - (-24 + 2.2 * Math.sin(x * 0.07 + 1.3) + wander(x, 2)));
    d = Math.max(d, soft(3.6 * width(x, 1), nl), soft(3.6 * width(x, 2), sl));
    d = Math.max(d, soft(2.9 * width(x, 3), Math.abs(z - 1.5 * Math.sin(x * 0.1) - wander(x, 3) * 0.6)) * smooth(-48, -40, x) * (1 - smooth(-18, -11, x)));
    if (x > -58) d = Math.max(d, soft(2.2 * width(z, 4), Math.abs(x + 29 + 1.6 * Math.sin(z * 0.13) + wander(z, 4) * 0.5)) * (1 - smooth(20, 27, Math.abs(z))));
  }
  const yard = 1 - smooth(-3, 3, Math.max(x + 41, -59 - x, Math.abs(z) - 20) + wob * 2);
  d = Math.max(d, yard * smooth(0.35, 0.65, fbm(x * 0.11 + 3, z * 0.11)) * 0.8); // worn patches in the yard
  d = Math.max(d, 1 - smooth(0.5, 3, kd - 1.5 + wob));
  // river banks: wet earth and pebbles
  const ax = Math.abs(x);
  d = Math.max(d, 1 - smooth(6, 9, ax + wob + (fbm(x * 0.05 + 2, z * 0.05) - 0.5) * 5));
  return { c, d };
}
function groundWeights(x, z, y) {
  const a = gold(x, z), b = gold(-x, -z);
  let c = Math.max(a.c, b.c), d = Math.max(a.d, b.d);
  const oz = Math.max(0, Math.abs(z) - 36), ox = Math.max(0, Math.abs(x) - 100), n = fbm(x * 0.09 + 7, z * 0.09);
  // rock: the slopes up to the cliffs, the crests of the hills, a few patches poking through the grass
  const og = outerGround(x, z);
  let r = smooth(0.8, 4, og) * (0.55 + 0.45 * n) + smooth(6, 14, og) * 0.4;
  r = Math.max(r, smooth(1.5, 2.2, mapGround(M, x, z)) * 0.5 * n, smooth(0.68, 0.8, n) * 0.7);
  const ax = Math.abs(x); r = Math.max(r, (1 - smooth(5, 7, ax)) * 0.6);
  c = c * (1 - smooth(0.3, 1.5, og));
  d = d * (1 - c); r = r * (1 - c);
  const g = Math.max(0.04, 1 - c - d - r);
  return { g, d, c, r };
}

export class Thornwater {
  constructor(scene, quality = 'high') {
    this.scene = scene; this.quality = quality;
    this.group = new THREE.Group(); this.group.name = 'thornwater';
    scene.add(this.group);
    this.crowdHype = 0; this.flames = []; this.wide = true; this.time = 0;
    const waits = [];
    const manager = new THREE.LoadingManager();
    this.tl = new THREE.TextureLoader(manager);
    const texReady = new Promise(res => { manager.onLoad = res; manager.onError = () => {}; setTimeout(res, 8000); });
    this.texCache = new Map();
    this.buildMaterials();
    this.buildTerrain();
    this.buildRiver();
    this.keep = new KeepArchitecture(this); // towers, roofs, galleries… (its stone is the walls' too)
    this.buildBlocks();
    this.buildStairs();
    this.buildKeepDetail();
    this.edges = buildEdges(this); // cliffs, boulders, forest round the playable area
    this.buildDynamic();
    this.props = new ThornwaterProps(this);
    this.ready = Promise.all([texReady, Promise.race([this.props.ready, new Promise(r => setTimeout(r, 8000))])]);
  }
  tex(file, srgb = false, rep = 1) {
    const key = file + rep;
    let t = this.texCache.get(key); if (t) return t;
    t = this.tl.load(TEX_DIR + file); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.repeat.set(rep, rep);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    this.texCache.set(key, t); return t;
  }
  pbr(name, o = {}) {
    const arm = this.tex(name + '_arm.jpg');
    return new THREE.MeshStandardMaterial({ map: this.tex(name + '_Diffuse.jpg', true), normalMap: this.tex(name + '_nor_gl.jpg'), aoMap: arm, roughnessMap: arm, roughness: 1, metalness: 0, color: o.color ?? 0xffffff, vertexColors: !!o.vc });
  }
  buildMaterials() {
    this.mats = {
      wall: this.pbr('medieval_blocks_02', { color: 0xcfc6b8 }),
      // keep floors, stairs and the flag-room slab: the painted cobble, pale Sunward / dark Ember
      floor0: new THREE.MeshStandardMaterial({ map: groundTextures().cobble, color: 0xf0ebe0, roughness: 0.92 }),
      floor1: new THREE.MeshStandardMaterial({ map: groundTextures().cobble, color: 0x6c625c, roughness: 0.92 }),
      mossy: new THREE.MeshStandardMaterial({ map: archTextures().ashlar, color: 0xa9ad98, roughness: 0.95 }), // old ruins: weathered, greenish
      rock: new THREE.MeshStandardMaterial({ map: groundTextures().rock, color: 0xc4bcae, roughness: 0.95 }),
      wood: this.pbr('weathered_planks', { color: 0xb09a80 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x3a3632, metalness: 0.8, roughness: 0.45 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x2a4a2a, roughness: 0.95, flatShading: true }),
      bark: new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 }),
    };
  }
  add(geo, mat, o = {}) { const m = new THREE.Mesh(geo, mat); m.castShadow = o.cast !== false; m.receiveShadow = true; this.group.add(m); return m; }

  // ---------------------------------------------------------------- ground and river
  buildTerrain() {
    const W = 340, D = 130, SX = 425, SZ = 162; // 0.8 yd grid: fine enough for the paths' edges; ±170 for the citadels
    const g = new THREE.PlaneGeometry(W, D, SX, SZ).rotateX(-Math.PI / 2);
    g.deleteAttribute('uv');
    const p = g.attributes.position, col = new Float32Array(p.count * 3), spl = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      let y = 0;
      // river bed (the sim floor stays at 0: champions wade with their feet in the water)
      const ax = Math.abs(x);
      y -= 0.45 * (1 - smooth(4.2, 6.8, ax));
      y += mapGround(M, x, z); // the hills (the same surface the sim walks on)
      y += outerGround(x, z); // outside the playable area: the rocky bank, the mountainsides, the waterfall ledge (tw-edges.js)
      p.setY(i, y);
      // what the ground is made of: cobbled streets and squares by the keeps, dirt lanes, grass, rock on the slopes
      const w = groundWeights(x, z, y), n = fbm(x * 0.05 + 4, z * 0.05);
      spl.set([w.g, w.d, w.c, w.r], i * 4);
      // tint: Sunward stone pale, Ember stone dark basalt; the Ember half's grass a little scorched near its keep
      const side = x > 0 ? 1 : 0, v = 0.8 + fbm(x * 0.03 + 9, z * 0.03) * 0.3 + n * 0.08;
      const cob = side ? [0.56, 0.52, 0.52] : [1.02, 1, 0.96], dry = side ? smooth(40, 70, ax) * 0.6 : 0;
      const gt = [1 + 0.08 * dry, 1 - 0.06 * dry, 1 - 0.3 * dry];
      for (let k = 0; k < 3; k++) col[i * 3 + k] = v * (1 + (cob[k] - 1) * w.c) * (1 + (gt[k] - 1) * w.g);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
    g.computeVertexNormals();
    const t = this.add(g, groundMaterial(), { cast: false }); t.name = 'terrain';
    // flag-room / hall floors: dressed stone inside each keep
    for (const s of [1, -1]) {
      const f = worldUV(boxAt(-96 * s < 0 ? -96 : 60, -96 * s < 0 ? -60 : 96, -0.05, 0.03, -15, 15), 3);
      this.add(f, this.mats[s > 0 ? 'floor0' : 'floor1'], { cast: false });
    }
  }
  buildRiver() {
    // Phong, not PBR: a physically based surface mirrors the bright dusk sky at the grazing angles you see a river
    // from and turned it into a pale band. Dark green-blue, lit from within a little, with the sun's glints.
    const water = new THREE.MeshPhongMaterial({ color: 0x22525a, emissive: 0x143a42, specular: 0x6a8a8a, shininess: 90, transparent: true, opacity: 0.86, normalMap: this.tex('rocks_ground_02_nor_gl.jpg', false, 1), depthWrite: false });
    water.normalScale.set(0.35, 0.35);
    const w = new THREE.Mesh(new THREE.PlaneGeometry(13, 140, 1, 1).rotateX(-Math.PI / 2), water);
    w.position.set(0, 0.16, 0); w.renderOrder = 1; this.group.add(w); this.water = w;
    w.geometry.attributes.uv.array.forEach((v, i, a) => { a[i] = i % 2 ? v * 20 : v * 2; });
    // the waterfall at the north end of the gorge
    // painted falling water: blue-white streaks with foam, tiling down, scrolled in update()
    const wc = document.createElement('canvas'); wc.width = 128; wc.height = 512; const g2 = wc.getContext('2d');
    const grad = g2.createLinearGradient(0, 0, 128, 0); grad.addColorStop(0, 'rgba(110,170,200,0.55)'); grad.addColorStop(0.5, 'rgba(150,205,225,0.85)'); grad.addColorStop(1, 'rgba(110,170,200,0.55)');
    g2.fillStyle = grad; g2.fillRect(0, 0, 128, 512);
    for (let i = 0; i < 260; i++) { const x = hash(i, 71) * 128, y = hash(i, 72) * 512, l = 30 + hash(i, 73) * 120, w = 1 + hash(i, 74) * 3; g2.fillStyle = hash(i, 75) < 0.7 ? `rgba(235,248,255,${0.25 + hash(i, 76) * 0.45})` : 'rgba(40,90,120,0.35)'; for (const oy of [-512, 0, 512]) g2.fillRect(x, y + oy, w, l); }
    const wtex = new THREE.CanvasTexture(wc); wtex.wrapS = wtex.wrapT = THREE.RepeatWrapping; wtex.repeat.set(2, 2); wtex.colorSpace = THREE.SRGBColorSpace;
    const fall = new THREE.MeshBasicMaterial({ map: wtex, transparent: true, depthWrite: false, color: 0xffffff });
    // a sheet of water down the face of the ledge (tw-edges outerGround: 13.5 yd high at z ≈ 41.6), a hand above the rock
    const wfg = new THREE.BufferGeometry(), top = 13.9, zt = 41.3, zb = 38.3;
    wfg.setAttribute('position', new THREE.Float32BufferAttribute([-4.6, top, zt, 4.6, top, zt, -5.4, -0.3, zb, 4.6, top, zt, 5.4, -0.3, zb, -5.4, -0.3, zb], 3));
    wfg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0], 2));
    wfg.computeVertexNormals();
    fall.side = THREE.DoubleSide;
    const wf = new THREE.Mesh(wfg, fall); this.group.add(wf); this.fall = wf;
    const mist = new THREE.Mesh(new THREE.CircleGeometry(6, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe8f4f8, transparent: true, opacity: 0.35, depthWrite: false }));
    mist.position.set(0, 0.25, 38); this.group.add(mist); this.mist = mist;
  }

  // ---------------------------------------------------------------- the simulation's blocks
  buildBlocks() {
    // ruins and boulders in meshes of their own: thornwater-props.js swaps them for the Tripo models
    const bins = { wall: [], floor0: [], floor1: [], mossy: [], rock: [], wood: [], ruinCol: [], ruinWall: [], boulder: [] };
    let seed = 1;
    for (const b of M.blocks) {
      seed++;
      if (b.kind === 'gate' || b.kind === 'fixture') continue; // gates: animated (buildDynamic); fixtures: thornwater-props.js
      if (b.kind === 'rock') { bins.rock.push(worldUV(rockGeo({ ...b, y1: b.y1 + 0.6 }, seed, 0.6), 4)); continue; }
      if (b.kind === 'boulder') {
        const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position;
        for (let i = 0; i < p.count; i++) { const n = fbm(p.getX(i) * 2 + seed, p.getZ(i) * 2 + p.getY(i)) - 0.5; p.setXYZ(i, p.getX(i) * (1 + n * 0.3), Math.max(-0.35, p.getY(i)) * (1 + n * 0.3), p.getZ(i) * (1 + n * 0.3)); }
        g.scale((b.x1 - b.x0) / 2 * 1.08, (b.y1 - b.y0) / 1.3, (b.z1 - b.z0) / 2 * 1.08).translate((b.x0 + b.x1) / 2, 0.45, (b.z0 + b.z1) / 2);
        bins.boulder.push(worldUV(g, 3)); continue;
      }
      if (b.kind === 'column') {
        const r = (b.x1 - b.x0) / 2, g = new THREE.CylinderGeometry(r * 0.9, r * 1.05, b.y1 - b.y0, 14).translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
        bins.mossy.push(worldUV(g, 2)); continue;
      }
      if (b.kind === 'ruin' && Math.abs(b.x1 - b.x0) < 1.6 && Math.abs(b.z1 - b.z0) < 1.6) { // a broken column
        const r = (b.x1 - b.x0) / 2, g = new THREE.CylinderGeometry(r * 0.85, r, b.y1 - b.y0, 12).translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
        const top = new THREE.CylinderGeometry(r * 1.15, r * 1.15, 0.35, 12).translate((b.x0 + b.x1) / 2, b.y1 - 0.2, (b.z0 + b.z1) / 2);
        bins.ruinCol.push(worldUV(g, 2), worldUV(top, 2)); continue;
      }
      const g = worldUV(boxAt(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1), b.kind === 'slab' ? 3 : 2.5);
      const bin = b.kind === 'slab' || b.kind === 'plinth' ? (b.x0 < 0 ? 'floor0' : 'floor1') : b.kind === 'ruin' || b.kind === 'lowwall' || b.kind === 'rail' ? 'mossy' : 'wall';
      if (b.kind === 'ruin') { bins.ruinWall.push(g); continue; }
      if (bin === 'wall') { const k = b.x0 < 0 ? 'wall0' : 'wall1'; (bins[k] || (bins[k] = [])).push(worldUV(boxAt(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1), 3)); continue; }
      bins[bin].push(g);
    }
    const mat = k => k === 'wall0' ? this.keep.mats.stone[0] : k === 'wall1' ? this.keep.mats.stone[1] : k === 'boulder' ? this.mats.rock : k === 'ruinCol' || k === 'ruinWall' ? this.mats.mossy : this.mats[k];
    this.blockMeshes = {};
    for (const [k, list] of Object.entries(bins)) if (list.length) this.blockMeshes[k] = this.add(mergeGeometries(list), mat(k));
  }
  // ramps: solid stone stairs (each step filled down to the ground, like the wedge the sim uses)
  buildStairs() {
    const list = [[], []];
    for (const r of M.ramps) {
      const side = r.x0 < 0 ? 0 : 1;
      const hi = Math.max(r.h0, r.h1), n = Math.round(hi / 0.3), along = r.axis === 'x' ? r.x1 - r.x0 : r.z1 - r.z0;
      for (let i = 0; i < n; i++) {
        const u0 = i / n, u1 = (i + 1) / n, h = hi * (i + 1) / n;
        // the step's top surface sits where the ramp height reaches h
        const lowEnd = r.h0 < r.h1; // height grows towards the high coordinate?
        const a = lowEnd ? u0 : 1 - u1, b = lowEnd ? u1 : 1 - u0;
        if (r.axis === 'x') list[side].push(worldUV(boxAt(r.x0 + along * a, r.x0 + along * b, 0, h, r.z0, r.z1), 2));
        else list[side].push(worldUV(boxAt(r.x0, r.x1, 0, h, r.z0 + along * a, r.z0 + along * b), 2));
      }
    }
    list.forEach((l, side) => l.length && this.add(mergeGeometries(l), this.keep.mats.stone[side])); // cut stone steps
  }
  // battlements, banners, braziers, graveyards, flag stands
  buildKeepDetail() {
    const merl = [[], []], stakes = [];
    for (const b of M.blocks) {
      if (b.kind !== 'wall' || b.y1 < 9) continue;
      const lx = b.x1 - b.x0, lz = b.z1 - b.z0, along = lx > lz ? 'x' : 'z', L = Math.max(lx, lz);
      for (let s = 0.6; s < L - 0.4; s += 2.2) {
        const cx = along === 'x' ? b.x0 + s + 0.55 : (b.x0 + b.x1) / 2, cz = along === 'x' ? (b.z0 + b.z1) / 2 : b.z0 + s + 0.55;
        if (b.x0 < 0) merl[0].push(worldUV(along === 'x' ? boxAt(b.x0 + s, b.x0 + s + 1.1, b.y1, b.y1 + 0.9, b.z0, b.z1) : boxAt(b.x0, b.x1, b.y1, b.y1 + 0.9, b.z0 + s, b.z0 + s + 1.1), 2));
        else for (const o of [-0.35, 0.35]) { const px = along === 'x' ? cx + o : cx, pz = along === 'x' ? cz : cz + o; stakes.push(worldUV(new THREE.CylinderGeometry(0.2, 0.24, 1.3, 6).translate(px, b.y1 + 0.65, pz), 1), worldUV(new THREE.ConeGeometry(0.2, 0.5, 6).translate(px, b.y1 + 1.55, pz), 1)); }
      }
    }
    this.add(mergeGeometries(merl[0]), this.keep.mats.stone[0]);
    this.add(mergeGeometries(stakes), this.keep.mats.wood);
    // banners in team colours on each keep's front wall and over the flag stand
    for (const team of [0, 1]) {
      const s = team === 0 ? 1 : -1, mat = new THREE.MeshStandardMaterial({ map: this.keep.crest[team], alphaTest: 0.5, roughness: 0.85, side: THREE.DoubleSide });
      const ban = (x, y, z, ry, w = 1.6, h = 3.2) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 1, 6), mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; this.group.add(m); };
      const out = s > 0 ? Math.PI / 2 : -Math.PI / 2, inn = -out;
      ban(-59.9 * s, 6.3, 8.15 * s, out); ban(-59.9 * s, 6.3, -8.15 * s, out);              // front wall, beside the turrets
      ban(-94.4 * s, 6.9, 0, out, 2.1, 4.2);                                                // over the flag stand
      ban(-61.6 * s, 6.4, 6.5 * s, inn); ban(-61.6 * s, 6.4, -6.5 * s, inn);               // inside the gate
      for (const x of [-81, -66.5]) { ban(x * s, 6.2, 15.08 * s, s > 0 ? 0 : Math.PI); ban(x * s, 6.2, -15.08 * s, s > 0 ? Math.PI : 0); } // the side walls
      // (braziers, gravestones and the spirit shrine are fixtures now: thornwater-props.js)
      // the graveyard's pale spirit ring
      const gy = M.graveyards[team];
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.75, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.position.set(gy.x, 0.05, gy.z); this.group.add(ring);
      // the flag stand: a rune ring on the plinth
      const fl = M.flags[team];
      const rune = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      rune.position.set(fl.x, fl.y + 0.4, fl.z); this.group.add(rune); (this.runes || (this.runes = [])).push(rune);
    }
  }
  // the gorge around the playable area: cliffs and pines
  buildSurroundings() {
    const cliffs = [];
    let seed = 50;
    for (let x = -112; x < 112; x += 9) for (const s of [1, -1]) {
      const h = 9 + hash(x, s) * 9, d = 6 + hash(x * 2, s) * 4;
      cliffs.push(worldUV(rockGeo({ x0: x, x1: x + 9.6, y0: -0.5, y1: h, z0: s > 0 ? 37 : -37 - d, z1: s > 0 ? 37 + d : -37 }, seed++, 1.4), 5));
    }
    for (let z = -40; z < 40; z += 9) for (const s of [1, -1]) {
      if (z > -26 && z + 9.6 < 26) continue; // behind the keeps: their back buildings
      const h = 10 + hash(z, s * 3) * 8;
      cliffs.push(worldUV(rockGeo({ x0: s > 0 ? 101 : -109, x1: s > 0 ? 109 : -101, y0: -0.5, y1: h, z0: z, z1: z + 9.6 }, seed++, 1.4), 5));
    }
    this.add(mergeGeometries(cliffs), this.mats.rock);
    // pines on the slopes above the gorge
    const trunks = [], crowns = [];
    for (let i = 0; i < 140; i++) {
      const s = i % 2 ? 1 : -1, x = (hash(i, 1) - 0.5) * 230, z = s * (46 + hash(i, 2) * 18), y = Math.pow(Math.abs(z) - 36, 1.3) * 0.9 - 0.5, h = 6 + hash(i, 3) * 6;
      trunks.push(new THREE.CylinderGeometry(0.2, 0.35, h * 0.4, 6).translate(x, y + h * 0.2, z));
      for (let k = 0; k < 3; k++) crowns.push(new THREE.ConeGeometry(h * (0.28 - k * 0.06), h * 0.45, 7).translate(x, y + h * (0.35 + k * 0.2), z));
    }
    this.add(mergeGeometries(trunks), this.mats.bark);
    this.add(mergeGeometries(crowns), this.mats.leaf);
  }

  // ---------------------------------------------------------------- gates, flags, power-ups
  buildDynamic() {
    this.gates = M.blocks.filter(b => b.gate).map(b => {
      const g = new THREE.Group();
      const door = new THREE.Mesh(worldUV(boxAt(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1), 2), this.mats.wood); door.castShadow = true; g.add(door);
      for (const y of [1.2, 3.4]) { const band = new THREE.Mesh(boxAt(b.x0 - 0.05, b.x1 + 0.05, y, y + 0.25, b.z0, b.z1), this.mats.iron); g.add(band); }
      this.group.add(g); return { g, open: 0 };
    });
    this.flagObjs = [0, 1].map(team => {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 8), this.mats.iron); pole.position.y = 1.3; g.add(pole);
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.85, 10, 4), new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team], roughness: 0.8, side: THREE.DoubleSide, emissive: TEAM_COLORS[team], emissiveIntensity: 0.25 }));
      cloth.geometry.translate(0.65, 0, 0); cloth.position.set(0.05, 2.15, 0); cloth.castShadow = true; g.add(cloth);
      cloth.userData.base = Float32Array.from(cloth.geometry.attributes.position.array);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffc860, emissiveIntensity: 1.2 })); tip.position.y = 2.65; g.add(tip);
      // a beam of light above the flag, seen from anywhere on the map
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 30, 10, 1, true), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 17; g.add(beam);
      this.group.add(g);
      return { g, cloth, beam };
    });
    this.pus = new Map();
  }
  sync(view, chars, dt, myTeam) {
    const bg = view.bg; if (!bg) return;
    // gates sink into the ground once preparation is over
    for (const gt of this.gates) { gt.open += ((bg.gates ? 1 : 0) - gt.open) * Math.min(1, dt * 1.5); gt.g.position.y = -5.6 * gt.open; gt.g.visible = gt.open < 0.98; }
    // flags at home, on a carrier's back, or lying where they dropped
    for (const F of bg.flags) {
      const o = this.flagObjs[F.team];
      if (F.state === 'carried' && chars[F.carrier]) {
        const r = chars[F.carrier].root;
        o.g.position.set(r.position.x - Math.sin(r.rotation.y) * 0.35, r.position.y + 0.4, r.position.z - Math.cos(r.rotation.y) * 0.35);
        o.g.rotation.set(0, r.rotation.y + Math.PI / 2, 0.12); o.g.scale.setScalar(0.85); o.beam.visible = true;
      } else {
        const home = M.flags[F.team];
        if (F.state === 'home') o.g.position.set(home.x, home.y + 0.35, home.z); else o.g.position.set(F.x, F.y, F.z);
        o.g.rotation.set(0, this.time * 0.2, F.state === 'dropped' ? 0.5 : 0); o.g.scale.setScalar(1); o.beam.visible = true;
      }
      o.beam.material.opacity = F.state === 'home' ? 0.12 : 0.22 + Math.sin(this.time * 6) * 0.06;
    }
    // power-ups: create / remove to match the snapshot
    const seen = new Set();
    for (const u of bg.pu || []) {
      seen.add(u.id);
      let m = this.pus.get(u.id);
      if (!m) {
        const P = POWERUPS[u.type], col = new THREE.Color(P.color);
        m = new THREE.Group();
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.6, roughness: 0.25 })); m.add(gem);
        const halo = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })); halo.position.y = -1.0; m.add(halo);
        m.position.set(u.x, u.y + 1.1, u.z); m.userData.gem = gem; this.group.add(m); this.pus.set(u.id, m);
      }
      m.userData.gem.rotation.y += dt * 2; m.userData.gem.position.y = Math.sin(this.time * 2.5 + u.x) * 0.15;
    }
    for (const [id, m] of this.pus) if (!seen.has(id)) { this.group.remove(m); this.pus.delete(id); }
  }
  update(dt) {
    this.time += dt;
    const n = this.water?.material.normalMap; if (n) n.offset.y -= dt * 0.08; // the river flows
    if (this.fall) this.fall.material.map.offset.y += dt * 0.9;
    for (const f of this.flames) { f.scale.y = 1 + Math.sin(this.time * 13 + f.position.z) * 0.15; f.material.opacity = 0.75 + Math.sin(this.time * 9) * 0.1; }
    for (const r of this.runes || []) r.material.opacity = 0.45 + Math.sin(this.time * 2) * 0.15;
    this.props?.update(dt, this.time);
    this.keep?.update(dt);
    // the flag cloth ripples
    for (const o of this.flagObjs || []) {
      const p = o.cloth.geometry.attributes.position, b = o.cloth.userData.base;
      for (let i = 0; i < p.count; i++) { const x = b[i * 3]; p.setZ(i, Math.sin(x * 3.2 - this.time * 6) * 0.12 * x); }
      p.needsUpdate = true;
    }
  }
}
