// Kingsreach Colosseum — the default 1v1 / 2v2 arena (docs/COLOSSEUM_REDESIGN.md).
// An ancient amphitheatre reclaimed by a medieval kingdom, at sunset: a raked sand floor, four plinths carrying
// bronze champions (the line-of-sight pillars), a marble podium wall with the shields of the noble houses, the
// Gold and Crimson gates, cushioned podium rows for the nobles, the royal box and the herald's box, stone tiers,
// a timber gallery, the facade with velarium masts and striped sails, four watchtowers on the rim and a crowd of
// every people of the realm (kr-crowd.js).
// The fight zone is the shared one (ARENA_R, PILLARS, BRIDGE in sim.js): plinths are round with the pillar radius,
// nothing else stands inside r = 29.
// Contract (arenas.js): group, ready, update(dt, vfx), crowdHype, flames, env, bridgeSkin.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PILLARS, ARENA_R } from '../sim/sim.js';
import { krTextures, HOUSES } from './kr-textures.js';
import { loadModel, fitMatrix, instance } from './thornwater-props.js';
import { Crowd } from './kr-crowd.js';

export const KR_DIR = 'assets/models/colosseum/';
const TAU = Math.PI * 2;
// ring layout (yd) — see the table in docs/COLOSSEUM_REDESIGN.md §3
export const KR = {
  floorR: 31.6, curb0: 28.85, curb1: 29.55, wallR: 31.5, wallTop: 4.3, podY: 5.0,
  pod0: 33.0, podRows: 3, podD: 0.9, podH: 0.55,
  walk0: 35.7, walk1: 37.2,
  mid0: 37.2, midY: 7.3, midRows: 9, midD: 0.9, midH: 0.55,
  upper0: 45.3, gal0: 47.0, galY: 13.6, gal1: 51.5, roofLo: 18.2, roofHi: 20.6,
  fac0: 51.5, fac1: 53.2, facTop: 24.2,
  gateHalf: 0.145,
};
const BAY = TAU / 40;
const GATES = [0, Math.PI];                      // +z Crimson, −z Gold
const ROYAL = Math.PI / 2, HERALD = -Math.PI / 2; // +x the king, −x the herald
const VOMS = [1, 3, 5, 7, 9, 11, 13, 15].map(k => k * Math.PI / 8);
const TOWERS = [1, 3, 5, 7].map(k => k * Math.PI / 4);
const angDist = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const nearGate = (a, m = 0) => GATES.some(g => angDist(a, g) < KR.gateHalf + m);

const QUALITY = {
  high: { crowd: 1.0, segs: 240, embers: 360, lights: 6, cell: 128, outside: true },
  medium: { crowd: 0.75, segs: 180, embers: 220, lights: 6, cell: 96, outside: true },
  low: { crowd: 0.45, segs: 120, embers: 90, lights: 4, cell: 64, outside: false },
};

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const mtx = (x, y, z, ry = 0, s = 1, rx = 0) => new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, 0, 'YXZ')), _s.set(s, s, s));
const polar = (a, r) => [Math.sin(a) * r, Math.cos(a) * r];

// Revolve an (r, y) profile around the y axis from a0 to a1. Every profile segment is its own strip (hard edges
// between them, smooth around). u runs around in tiles of uvS metres, v along the profile.
// Faces point to the left of the profile's direction in the (r, y) plane: a profile running outward and upward
// (tiers, walls seen from the arena) faces up and toward the centre. o.out flips that (solids seen from outside:
// the plinths).
function revolve(prof, a0, a1, segs, uvS = 3, o = {}) {
  const geos = [], span = a1 - a0, cx = o.cx || 0, cz = o.cz || 0;
  let vAcc = 0;
  for (let k = 0; k < prof.length - 1; k++) {
    const [r0, y0] = prof[k], [r1, y1] = prof[k + 1], L = Math.hypot(r1 - r0, y1 - y0);
    if (L < 1e-5) continue;
    const pos = [], uv = [], idx = [], rm = Math.max(0.3, (r0 + r1) / 2), tiles = Math.max(1, Math.round(Math.abs(span) * rm / uvS));
    for (let i = 0; i <= segs; i++) {
      const f = i / segs, a = a0 + span * f, s = Math.sin(a), c = Math.cos(a);
      pos.push(cx + s * r0, y0, cz + c * r0, cx + s * r1, y1, cz + c * r1);
      uv.push(f * tiles, vAcc / uvS, f * tiles, (vAcc + L) / uvS);
    }
    const flip = (span > 0) !== !!o.out;
    for (let i = 0; i < segs; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    geos.push(g); vAcc += L;
  }
  return geos;
}
// a box whose local +z points outward at angle a
function radialBox(a, r, y0, y1, w, d, ry = 0) {
  const g = new THREE.BoxGeometry(w, y1 - y0, d);
  g.applyMatrix4(mtx(Math.sin(a) * r, (y0 + y1) / 2, Math.cos(a) * r, a + ry));
  return g;
}
// world box-projected UVs, size metres per tile
function worldUV(g, size) {
  g = g.index ? g.toNonIndexed() : g;
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let u, v; if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u / size; uv[i * 2 + 1] = v / size;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// geometry collected per material, merged once
class Bin {
  constructor() { this.list = []; }
  add(g, o = {}) { const list = Array.isArray(g) ? g : [g]; for (let x of list) { if (o.box) x = worldUV(x, o.box); else if (x.index) x = x.toNonIndexed(); if (!x.attributes.normal) x.computeVertexNormals(); for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k); if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2)); this.list.push(x); } }
  mesh(mat, cast = false) { if (!this.list.length) return null; const m = new THREE.Mesh(mergeGeometries(this.list, false), mat); m.castShadow = cast; m.receiveShadow = true; this.list = []; return m; }
}

// ---------------------------------------------------------------- fire: billboarded flame quads + glow + embers
const FLAME_VS = `
  attribute vec4 aFire; // x y z = base, w = size
  attribute float aSeed;
  uniform float uTime;
  varying vec2 vUv; varying float vSeed;
  void main() {
    vUv = uv; vSeed = aSeed;
    float s = aFire.w * (0.92 + 0.12 * sin(uTime * 9.0 + aSeed * 13.0));
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 wp = aFire.xyz + right * position.x * s * 0.8 + vec3(0.0, 1.0, 0.0) * (position.y + 0.5) * s * 1.6;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;
const FLAME_FS = `
  uniform float uTime;
  varying vec2 vUv; varying float vSeed;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    vec2 p = vUv; float t = uTime * 2.4 + vSeed * 7.0;
    float q = n(vec2(p.x * 4.0, p.y * 3.0 - t * 1.7)) * 0.6 + n(vec2(p.x * 9.0, p.y * 7.0 - t * 3.1)) * 0.4;
    float w = (1.0 - p.y) * 0.55 + 0.08;                      // narrower toward the tip
    float d = abs(p.x - 0.5 + (q - 0.5) * 0.25 * p.y) / w;
    float a = smoothstep(1.0, 0.35, d) * smoothstep(1.0, 0.25, p.y + (q - 0.5) * 0.5) * smoothstep(0.0, 0.08, p.y);
    vec3 c = mix(vec3(1.0, 0.35, 0.06), vec3(1.0, 0.86, 0.45), smoothstep(0.75, 0.15, d) * (1.0 - p.y));
    gl_FragColor = vec4(c * a * 2.2, a);
  }`;

export class Kingsreach {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = QUALITY[quality] ? quality : 'high';
    this.Q = QUALITY[this.quality];
    this.group = new THREE.Group(); this.group.name = 'kingsreach'; scene.add(this.group);
    this.crowdHype = 0; this.flames = []; this.time = 0;
    this.fires = []; this.lightSpots = []; this.extraFires = [];
    // golden sunset: low sun from the west-south-west, warm haze, the sky turned so the glow sits behind the sun
    this.env = {
      sun: new THREE.Vector3(-58, 30, 20), sunColor: 0xffb070, sunIntensity: 3.6,
      sky: 0x9a88a8, ground: 0x4a2e1e, hemi: 0.3, fog: 0x9a7a6a, fogDensity: 0.0011,
      exposure: 0.86, skyRot: 1.2, skyIntensity: 0.62, envIntensity: 0.3,
    };
    this.T = krTextures();
    this.buildMaterials();
    this.bridgeSkin = { stone: this.mats.sandstone, trim: this.mats.marble, planks: this.mats.timber, iron: this.mats.iron };
    this.buildFloor();
    this.buildPillars();
    this.buildWall();
    this.buildStands();
    this.buildGallery();
    this.buildFacade();
    this.buildVelarium();
    this.buildBanners();
    this.buildSky();
    if (this.Q.outside) this.buildOutside();
    this.buildFireSystem();
    this.buildLights();
    this.crowd = new Crowd(this);
    this.ready = Promise.all([
      Promise.race([this.loadModels(), new Promise(r => setTimeout(r, 12000))]),
      Promise.race([this.crowd.ready, new Promise(r => setTimeout(r, 12000))]),
    ]);
  }

  // ---------------------------------------------------------------- materials
  buildMaterials() {
    const T = this.T, std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
    this.mats = {
      sand: std({ map: T.sand, color: 0xcfc2b2, vertexColors: true, roughness: 0.97 }),
      sandstone: std({ map: T.sandstone }),
      darkstone: std({ map: T.darkstone }),
      marble: std({ map: T.marble, roughness: 0.7 }),
      terracotta: std({ map: T.terracotta, roughness: 0.85 }),
      timber: std({ map: T.timber }),
      iron: std({ color: 0x3a3430, metalness: 0.75, roughness: 0.5 }),
      bronze: std({ color: 0xb08a4a, metalness: 0.85, roughness: 0.4 }),
      cushion: std({ vertexColors: true, roughness: 0.95 }),
      dark: new THREE.MeshBasicMaterial({ color: 0x0c0806 }),
    };
    // anti-tiling and raked rings for the sand: a second, larger sampling and faint concentric rake lines
    this.mats.sand.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWpS;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWpS = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWpS;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          { vec3 big = texture2D(map, vWpS.xz * 0.043 + 0.31).rgb; diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * big * 1.35, 0.45);
            float r = length(vWpS.xz), rake = abs(fract(r / 0.42) - 0.5) * 2.0;
            float zone = smoothstep(8.0, 10.0, r) * smoothstep(27.5, 25.0, r);
            diffuseColor.rgb *= 1.0 - 0.09 * zone * smoothstep(0.7, 1.0, rake) + 0.05 * zone * smoothstep(0.35, 0.0, rake); }`);
    };
    this.mats.sand.customProgramCacheKey = () => 'kr-sand';
  }
  add(mesh) { if (mesh) this.group.add(mesh); return mesh; }

  // ---------------------------------------------------------------- the floor
  buildFloor() {
    const R = KR.floorR, NR = 48, NA = 192, row = NA + 1, n = (NR + 1) * row;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
    let v = 0;
    for (let j = 0; j <= NR; j++) {
      const r = R * Math.pow(j / NR, 0.8);
      for (let i = 0; i <= NA; i++, v++) {
        const a = i / NA * TAU, x = Math.sin(a) * r, z = Math.cos(a) * r;
        pos[v * 3] = x; pos[v * 3 + 2] = z; nor[v * 3 + 1] = 1; uv[v * 2] = x / 5; uv[v * 2 + 1] = -z / 5;
        let d = smooth(24, 31, r) * 0.35;                                                   // darker toward the wall
        for (const p of PILLARS) d += smooth(4.5, 2.0, Math.hypot(x - p.x, z - p.z)) * 0.25;  // trampled round the plinths
        d += smooth(3.5, 1.0, Math.abs(x)) * smooth(18, 26, Math.abs(z)) * 0.2;               // paths from the gates
        const k = 1 - d;
        col[v * 3] = k; col[v * 3 + 1] = k * 0.97; col[v * 3 + 2] = k * 0.93;
      }
    }
    const idx = [];
    for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) { const a = j * row + i, b = a + 1, c = a + row, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
    const floor = new THREE.Mesh(g, this.mats.sand); floor.receiveShadow = true; floor.name = 'krFloor'; this.add(floor);

    // the boundary curb: a low granite ring just outside the reach of the fighters (they stop at r = 29 − body)
    const curb = new Bin();
    curb.add(revolve([[KR.curb0, 0], [KR.curb0, 0.07], [KR.curb0 + 0.06, 0.1], [KR.curb1 - 0.06, 0.1], [KR.curb1, 0.07], [KR.curb1, 0]], 0, TAU, this.Q.segs, 1.2));
    this.add(curb.mesh(this.mats.darkstone));

    // decals: the kingdom crest in the middle, team rings at the spawns, hypogeum trapdoors
    const decal = (map, x, z, s, rot = 0, color = 0xffffff, opacity = 1, y = 0.012) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshStandardMaterial({ map, color, transparent: true, opacity, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.rotation.set(-Math.PI / 2, 0, rot); m.position.set(x, y, z); m.receiveShadow = true; m.renderOrder = 1; this.add(m); return m;
    };
    decal(this.T.crest, 0, 0, 13.8, 0, 0xffffff, 0.92);
    decal(this.T.ringMark, 0, -20, 6.2, 0, 0xf0c050, 0.75);   // Gold
    decal(this.T.ringMark, 0, 20, 6.2, 0, 0xd03030, 0.75);    // Crimson
    for (const [x, z] of [[22, 0], [-22, 0], [0, 11.5], [0, -11.5]]) decal(this.T.trapdoor, x, z, 2.6, 0, 0xffffff, 1, 0.014);
  }

  // ---------------------------------------------------------------- the four plinths (line-of-sight pillars, r = 2.0)
  buildPillars() {
    const stone = new Bin(), dark = new Bin(), marble = new Bin(), r = 2.0;
    this.statueSpots = [];
    this.shieldSpots = [];
    const prof = [[r + 0.18, 0], [r + 0.18, 0.32], [r + 0.08, 0.4], [r, 0.48]];            // base
    const drum = [[r, 0.48], [r, 4.05]];
    const top = [[r, 4.05], [r + 0.12, 4.15], [r + 0.22, 4.4], [r + 0.22, 4.62], [r + 0.1, 4.7], [r - 0.05, 4.75], [0, 4.75]];
    PILLARS.forEach((p, i) => {
      const o = { cx: p.x, cz: p.z, out: true };
      dark.add(revolve(prof, 0, TAU, 48, 1.5, o));
      stone.add(revolve(drum, 0, TAU, 48, 2.2, o));
      // two carved bands
      for (const by of [1.35, 3.25]) dark.add(revolve([[r, by - 0.12], [r + 0.06, by - 0.08], [r + 0.06, by + 0.08], [r, by + 0.12]], 0, TAU, 48, 1, o));
      marble.add(revolve(top, 0, TAU, 48, 1.5, o));
      // shields of the houses round the drum, facing out
      for (let k = 0; k < 8; k++) { const a = k * TAU / 8 + i * 0.2; this.shieldSpots.push({ x: p.x + Math.sin(a) * (r + 0.03), y: 2.3, z: p.z + Math.cos(a) * (r + 0.03), a, s: 0.95, house: (k + i * 3) % 8 }); }
      // two fire bowls on the cornice, across the line to the centre
      const toC = Math.atan2(-p.x, -p.z);
      for (const s of [-1, 1]) {
        const a = toC + s * Math.PI / 2, fx = p.x + Math.sin(a) * 1.75, fz = p.z + Math.cos(a) * 1.75;
        this.bowl(fx, 4.75, fz, 0.42);
        this.fire(fx, 4.75 + 0.32, fz, 0.75, { big: s > 0, embers: 1.6 });
      }
      this.statueSpots.push({ x: p.x, y: 4.75, z: p.z, yaw: toC, id: ['S01', 'S02', 'S03', 'S04'][i] });
      this.lightSpots.push({ x: p.x * 0.92, y: 6.5, z: p.z * 0.92, base: 70, dist: 30 });
    });
    this.add(dark.mesh(this.mats.darkstone, true));
    this.add(stone.mesh(this.mats.sandstone, true));
    this.add(marble.mesh(this.mats.marble, true));
  }
  bowl(x, y, z, s) {
    if (!this.bowlBin) this.bowlBin = new Bin();
    const g = new THREE.LatheGeometry([[0, 0], [0.22, 0], [0.24, 0.05], [0.12, 0.12], [0.1, 0.3], [0.5, 0.42], [0.62, 0.62], [0.56, 0.64], [0.4, 0.5], [0, 0.5]].map(([a, b]) => new THREE.Vector2(a * s / 0.62, b * s / 0.62)), 12);
    g.translate(x, y, z); this.bowlBin.add(g);
  }
  fire(x, y, z, s, o = {}) {
    const f = { x, y, z, s, seed: Math.random() * 10, embers: o.embers || 0 };
    this.fires.push(f);
    if (o.big) this.flames.push({ x, y: y + s * 0.9, z });
    return f;
  }

  // ---------------------------------------------------------------- the podium wall and the gates
  buildWall() {
    const W = KR.wallR, segs = this.Q.segs, stone = new Bin(), marble = new Bin(), dark = new Bin(), sand = new Bin();
    const sectors = [[KR.gateHalf, Math.PI - KR.gateHalf], [Math.PI + KR.gateHalf, TAU - KR.gateHalf]];
    const face = [[W - 0.25, 0], [W - 0.25, 0.55], [W - 0.1, 0.62], [W, 0.62]];
    const marbleFace = [[W, 0.62], [W, 3.15]];
    const frieze = [[W, 3.15], [W - 0.08, 3.2], [W - 0.08, 3.85], [W, 3.9]];
    const cope = [[W, 3.9], [W - 0.22, 4.0], [W - 0.22, KR.wallTop], [W + 0.2, KR.wallTop + 0.08], [KR.pod0, KR.wallTop + 0.08]];
    for (const [a0, a1] of sectors) {
      dark.add(revolve(face, a0, a1, segs, 1.5));
      marble.add(revolve(marbleFace, a0, a1, segs, 2.5));
      stone.add(revolve(frieze, a0, a1, segs, 1.2));
      marble.add(revolve(cope, a0, a1, segs, 1.5));
    }
    // pilasters, house shields between them, torches on every other one; a balustrade on the coping
    this.torchSpots = [];
    for (let k = 0; k < 40; k++) {
      const a = k * BAY;
      if (nearGate(a, 0.04)) continue;
      stone.add(radialBox(a, W - 0.18, 0, 4.0, 0.9, 0.42), { box: 1.5 });
      dark.add(radialBox(a, W - 0.24, 3.9, 4.12, 1.12, 0.55), { box: 1.2 });
      if (k % 2) { const [x, z] = polar(a, W - 0.55); this.torchSpots.push({ x, z, a }); }
      const am = a + BAY / 2;
      if (!nearGate(am, 0.04)) { const [x, z] = polar(am, W - 0.02); this.shieldSpots.push({ x, y: 2.05, z, a: am + Math.PI, s: 1.25, house: k % 8 }); }
    }
    // balustrade posts and rail on the podium edge
    for (let a = 0; a < TAU; a += 0.035) {
      if (nearGate(a, 0.01) || angDist(a, ROYAL) < 0.2 || angDist(a, HERALD) < 0.17) continue;
      marble.add(radialBox(a, W + 0.05, KR.wallTop + 0.08, KR.wallTop + 0.8, 0.16, 0.16), { box: 1 });
    }
    for (const [a0, a1] of sectors) marble.add(revolve([[W - 0.06, KR.wallTop + 0.8], [W - 0.06, KR.wallTop + 0.95], [W + 0.16, KR.wallTop + 0.95], [W + 0.16, KR.wallTop + 0.8]], a0, a1, segs, 1.5));
    for (const t of this.torchSpots) {
      const y = 2.8, [bx, bz] = polar(t.a, W - 0.32);
      this.ironBin = this.ironBin || new Bin();
      this.ironBin.add(new THREE.CylinderGeometry(0.06, 0.04, 0.55, 6).rotateX(-0.5).rotateY(t.a + Math.PI).translate(bx, y, bz));
      const cup = new THREE.CylinderGeometry(0.16, 0.08, 0.22, 7); cup.translate(t.x, y + 0.25, t.z); this.ironBin.add(cup);
      this.fire(t.x, y + 0.34, t.z, 0.42, { embers: 0.3 });
    }
    // the gate tunnels: dark passages behind each gate (the gatehouse model stands in front of them), so the arch
    // never shows the sky; plus a stand-in frame that the gatehouse model replaces when it has loaded
    const frame = new Bin();
    for (const g of GATES) {
      const [x, z] = polar(g, W + 7.5);
      const tun = new THREE.Mesh(new THREE.BoxGeometry(8.5, 7.7, 10), this.mats.dark);
      tun.position.set(x, 3.85, z); tun.rotation.y = g; this.add(tun);
      const fl = new THREE.BoxGeometry(8.6, 0.1, 13); fl.applyMatrix4(mtx(...polar(g, W + 5.5).flatMap((v, i) => i ? [0.02, v] : [v]), g)); sand.add(fl, { box: 4 });
      for (const s of [-1, 1]) frame.add(radialBox(g + s * (KR.gateHalf + 0.012), W + 0.6, 0, 9.5, 1.4, 1.8), { box: 1.5 });
      frame.add(radialBox(g, W + 0.6, 7.6, 9.5, 2 * W * Math.sin(KR.gateHalf) + 1.2, 1.8), { box: 1.5 });
    }
    this.gateFrame = this.add(frame.mesh(this.mats.sandstone, true));
    // gate blocks: the stands are cut at each gate; a solid block of masonry fills the cut behind the gatehouse —
    // side walls closing the tiers, a lintel over the tunnel, a flat top level with the upper walkway, battlements
    const gb = new Bin(), caps = new Bin(), top = this.upperY ?? 12.1, r0 = KR.pod0 + 0.3, r1 = KR.gal0 + 0.2, ga = KR.gateHalf + 0.022;
    for (const g of GATES) {
      gb.add(revolve([[r0, 7.6], [r0, top], [r1, top], [r1, 0]], g - ga, g + ga, 16, 2.5));
      for (const s of [-1, 1]) {
        const a = g + s * ga, [x0, z0] = polar(a, W - 0.2), [x1, z1] = polar(a, r1), n = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(-s);
        const q = new THREE.BufferGeometry(), P = [x0, 0, z0, x1, 0, z1, x1, top, z1, x0, top, z0];
        q.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        q.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, (r1 - W) / 2.5, 0, (r1 - W) / 2.5, top / 2.5, 0, top / 2.5], 2));
        q.setIndex([0, 1, 2, 0, 2, 3]); q.computeVertexNormals(); caps.add(q);
      }
      const chord = 2 * r0 * Math.sin(ga);
      for (let u = -chord / 2 + 0.5; u < chord / 2; u += 1.25) {
        const a = g + Math.asin(u / r0); gb.add(radialBox(a, r0 + 0.35, top, top + 0.85, 0.7, 0.6), { box: 1.2 });
      }
    }
    this.add(gb.mesh(this.mats.sandstone, true));
    const capMat = this.mats.sandstone.clone(); capMat.side = THREE.DoubleSide;
    this.add(caps.mesh(capMat, true));
    this.add(dark.mesh(this.mats.darkstone, true));
    this.add(stone.mesh(this.mats.sandstone, true));
    this.add(marble.mesh(this.mats.marble, true));
    this.add(sand.mesh(this.mats.sandstone));
  }

  // ---------------------------------------------------------------- stands: podium rows, walkway, middle tiers
  buildStands() {
    const segs = this.Q.segs, stone = new Bin(), marble = new Bin(), timber = new Bin(), cushionG = [];
    const sectors = [[KR.gateHalf + 0.02, Math.PI - KR.gateHalf - 0.02], [Math.PI + KR.gateHalf + 0.02, TAU - KR.gateHalf - 0.02]];
    this.seatRows = [];
    // podium: three cushioned rows for the nobles
    const pp = [[KR.pod0, KR.wallTop + 0.08]];
    for (let k = 0; k < KR.podRows; k++) {
      const r0 = KR.pod0 + k * KR.podD, y = KR.podY + k * KR.podH;
      pp.push([r0, y], [r0 + KR.podD, y]);
      this.seatRows.push({ r: r0 + KR.podD * 0.42, y, tier: 'podium', row: k });
    }
    pp.push([KR.walk0, KR.podY + (KR.podRows - 1) * KR.podH], [KR.walk0, KR.podY + KR.podRows * KR.podH - 0.25]);
    const walkY = KR.podY + KR.podRows * KR.podH - 0.25;
    pp.push([KR.walk1, walkY]);
    // middle tiers rise from a low marble parapet
    const mp = [[KR.mid0, walkY], [KR.mid0, KR.midY]];
    for (let k = 0; k < KR.midRows; k++) {
      const r0 = KR.mid0 + k * KR.midD, y = KR.midY + k * KR.midH;
      mp.push([r0, y], [r0 + KR.midD, y]);
      if (k + 1 < KR.midRows) mp.push([r0 + KR.midD, y + KR.midH]);
      this.seatRows.push({ r: r0 + KR.midD * 0.42, y, tier: 'middle', row: k });
    }
    const topY = KR.midY + (KR.midRows - 1) * KR.midH;
    mp.push([KR.upper0, topY], [KR.upper0, topY + 0.4], [KR.gal0, topY + 0.4]);
    this.upperY = topY + 0.4;
    for (const [a0, a1] of sectors) {
      stone.add(revolve(pp, a0, a1, segs, 2.5));
      stone.add(revolve(mp, a0, a1, segs, 2.5));
      marble.add(revolve([[KR.mid0 - 0.05, walkY], [KR.mid0 - 0.05, KR.midY + 0.45], [KR.mid0 + 0.25, KR.midY + 0.45], [KR.mid0 + 0.25, KR.midY]], a0, a1, segs, 1.5));
      // wooden bench boards on every middle row
      for (let k = 0; k < KR.midRows; k++) {
        const r0 = KR.mid0 + k * KR.midD, y = KR.midY + k * KR.midH;
        timber.add(revolve([[r0 + 0.1, y], [r0 + 0.1, y + 0.06], [r0 + 0.62, y + 0.06], [r0 + 0.62, y]], a0, a1, segs, 2.0));
      }
    }
    // podium cushions in house colours, one run per bay
    const cush = HOUSES.map(h => new THREE.Color(h.field));
    for (let k = 0; k < 40; k++) {
      const a0 = k * BAY + 0.004, a1 = (k + 1) * BAY - 0.004;
      if (nearGate(a0, 0.02) || nearGate(a1, 0.02)) continue;
      for (let row = 0; row < KR.podRows; row++) {
        const r0 = KR.pod0 + row * KR.podD, y = KR.podY + row * KR.podH;
        for (const g of revolve([[r0 + 0.12, y], [r0 + 0.12, y + 0.12], [r0 + 0.6, y + 0.12], [r0 + 0.6, y]], a0, a1, 6, 1)) {
          const c = cush[(k * 3 + row) % 8], n = g.attributes.position.count, ca = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; }
          g.setAttribute('color', new THREE.BufferAttribute(ca, 3)); cushionG.push(g);
        }
      }
    }
    this.add(stone.mesh(this.mats.sandstone));
    this.add(marble.mesh(this.mats.marble));
    this.add(timber.mesh(this.mats.timber));
    if (cushionG.length) this.add(new THREE.Mesh(mergeGeometries(cushionG, false), this.mats.cushion));
    // striped canopies over some podium bays (cloth on two poles each)
    const canopy = [];
    for (let k = 1; k < 40; k += 4) {
      const a0 = k * BAY, a1 = (k + 2) * BAY;
      if (nearGate(a0, 0.1) || nearGate(a1, 0.1) || angDist((a0 + a1) / 2, ROYAL) < 0.35 || angDist((a0 + a1) / 2, HERALD) < 0.3) continue;
      const inner = 33.1, outer = 35.9, yIn = 8.1, yOut = 9.1, n = 8, pos = [], uv = [], idx = [];
      for (let i = 0; i <= n; i++) {
        const a = a0 + (a1 - a0) * i / n, sag = Math.sin(i / n * Math.PI) * 0.12;
        const [xi, zi] = polar(a, inner), [xo, zo] = polar(a, outer);
        pos.push(xi, yIn - sag, zi, xo, yOut - sag, zo); uv.push(i / n, 0, i / n, 0.5);
      }
      for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      canopy.push(g.toNonIndexed());
      for (const a of [a0, a1]) for (const [rr, yy] of [[inner, yIn], [outer, yOut]]) {
        const [x, z] = polar(a, rr); this.timberBin = this.timberBin || new Bin();
        this.timberBin.add(new THREE.CylinderGeometry(0.06, 0.07, yy - (rr < 34 ? KR.podY : KR.podY + 1.1), 6).translate(x, (yy + (rr < 34 ? KR.podY : KR.podY + 1.1)) / 2, z));
      }
    }
    if (canopy.length) {
      const m = new THREE.Mesh(mergeGeometries(canopy, false), new THREE.MeshStandardMaterial({ map: this.T.sail, side: THREE.DoubleSide, roughness: 0.95, emissive: 0xffe0b0, emissiveIntensity: 0.12, emissiveMap: this.T.sail }));
      m.receiveShadow = true; this.add(m);
    }
  }

  // ---------------------------------------------------------------- the timber gallery (standing crowd) and its roof
  buildGallery() {
    const segs = this.Q.segs, timber = new Bin(), roof = new Bin(), stone = new Bin();
    const y0 = this.upperY, g0 = KR.gal0;
    // upper walkway wall and three standing steps
    stone.add(revolve([[KR.upper0, y0], [KR.upper0 - 0.02, y0 + 1.05], [KR.upper0 + 0.3, y0 + 1.05], [KR.upper0 + 0.3, y0]], 0, TAU, segs, 1.5));
    // three standing steps, 1.45 deep and 0.5 high, the last one running to the facade
    const steps = [[g0, y0], [g0, KR.galY]];
    for (let k = 0; k < 3; k++) {
      const r = g0 + k * 1.45, y = KR.galY + k * 0.5;
      if (k) steps.push([r, y]);
      steps.push([k < 2 ? r + 1.45 : KR.fac0, y]);
      this.seatRows.push({ r: r + 0.7, y, tier: 'gallery', row: k });
    }
    timber.add(revolve(steps, 0, TAU, segs, 2.2));
    // posts, braces and a rail along the front, every 4.5°
    for (let a = 0; a < TAU - 1e-4; a += BAY / 2) {
      for (const [rr, yTop] of [[g0 + 0.15, KR.roofLo], [KR.fac0 - 0.2, KR.roofHi]]) {
        const [x, z] = polar(a, rr), yb = rr < 48 ? KR.galY : KR.galY + 1.0;
        timber.add(new THREE.BoxGeometry(0.22, yTop - yb, 0.22).translate(x, (yTop + yb) / 2, z), { box: 1.5 });
      }
      timber.add(radialBox(a, (g0 + KR.fac0) / 2, KR.roofLo - 0.1, KR.roofLo + 0.12, 0.16, KR.fac0 - g0, 0), { box: 1.5 });
    }
    timber.add(revolve([[g0 + 0.05, KR.galY + 1.0], [g0 + 0.05, KR.galY + 1.12], [g0 + 0.28, KR.galY + 1.12], [g0 + 0.28, KR.galY + 1.0]], 0, TAU, segs, 2));
    // lean-to roof: low at the front, high against the facade, with a fascia board
    roof.add(revolve([[g0 - 0.6, KR.roofLo - 0.15], [KR.fac0, KR.roofHi + 0.2]], 0, TAU, segs, 3.2));
    timber.add(revolve([[g0 - 0.62, KR.roofLo - 0.5], [g0 - 0.62, KR.roofLo - 0.1]], 0, TAU, segs, 2));
    this.add(stone.mesh(this.mats.sandstone));
    this.add(timber.mesh(this.mats.timber));
    const rm = roof.mesh(this.mats.terracotta); if (rm) rm.material = this.mats.terracotta.clone(), rm.material.side = THREE.DoubleSide; this.add(rm);
    if (this.timberBin) this.add(this.timberBin.mesh(this.mats.timber));
  }

  // ---------------------------------------------------------------- the facade, merlons and masts
  buildFacade() {
    const segs = this.Q.segs, stone = new Bin(), dark = new Bin(), timber = new Bin();
    const F0 = KR.fac0, F1 = KR.fac1, top = KR.facTop;
    stone.add(revolve([[F0, KR.galY + 1.0], [F0, top], [F1, top], [F1, 0]], 0, TAU, segs, 3));
    dark.add(revolve([[F0 - 0.15, top - 0.6], [F0 - 0.15, top - 0.3], [F0, top - 0.3]], 0, TAU, segs, 1.5)); // string course
    // merlons and the masts (every 9°, between merlons); masts carry the velarium
    this.masts = [];
    const mstep = TAU / 80;
    for (let k = 0; k < 80; k++) {
      const a = k * mstep;
      if (TOWERS.some(t => angDist(a, t) < 0.09)) continue;
      if (k % 2) { stone.add(radialBox(a, (F0 + F1) / 2, top, top + 1.1, 1.6, F1 - F0), { box: 1.5 }); continue; }
      const [x, z] = polar(a, (F0 + F1) / 2);
      timber.add(new THREE.CylinderGeometry(0.16, 0.22, 9, 7).translate(x, top + 4.5, z), { box: 1.5 });
      dark.add(radialBox(a, (F0 + F1) / 2, top, top + 0.5, 0.8, 0.8), { box: 1 });
      this.masts.push({ a, x, z, top: top + 9 });
    }
    // arcade: dark arch openings along the outside of the upper gallery wall face (seen between the posts)
    for (let k = 0; k < 80; k++) {
      const a = (k + 0.5) * mstep; if (TOWERS.some(t => angDist(a, t) < 0.09)) continue;
      const g = new THREE.PlaneGeometry(1.6, 2.6); g.applyMatrix4(mtx(Math.sin(a) * (F0 - 0.02), KR.galY + 3.0, Math.cos(a) * (F0 - 0.02), a + Math.PI));
      this.archBin = this.archBin || []; this.archBin.push(g);
    }
    // the outside: three storeys of arcades (dark arch openings framed by string courses), as on the old amphitheatres
    const arch = (w, h) => { const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - w / 2); s.absarc(0, h - w / 2, w / 2, 0, Math.PI, false); s.lineTo(-w / 2, 0); return new THREE.ShapeGeometry(s, 8); };
    for (const [y0, h, w] of [[0.6, 6.2, 3.0], [8.4, 5.6, 2.8], [15.8, 5.0, 2.5]]) {
      dark.add(revolve([[F1 + 0.25, y0 - 0.6], [F1 + 0.25, y0 - 0.25], [F1, y0 - 0.25]], 0, TAU, segs, 1.5, { out: true }));
      for (let k = 0; k < 64; k++) {
        const a = (k + 0.5) * TAU / 64; if (TOWERS.some(t => angDist(a, t) < 0.12)) continue;
        const g = arch(w, h); g.applyMatrix4(mtx(Math.sin(a) * (F1 + 0.02), y0, Math.cos(a) * (F1 + 0.02), a));
        (this.archBin = this.archBin || []).push(g);
      }
    }
    this.add(stone.mesh(this.mats.sandstone));
    this.add(dark.mesh(this.mats.darkstone));
    this.add(timber.mesh(this.mats.timber));
    if (this.archBin) this.add(new THREE.Mesh(mergeGeometries(this.archBin.map(g => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k); return g; }), false), this.mats.dark));
  }

  // ---------------------------------------------------------------- the velarium: striped sails between the masts and an inner rope ring
  buildVelarium() {
    const pos = [], uv = [], wav = [], idx = [], ropes = [];
    // nearly level, so the camera down in the arena sees the sails' undersides instead of their edges
    const rIn = 38.5, yIn = 30.2, n = 6;
    const masts = this.masts;
    masts.forEach((m, i) => {
      const m2 = masts[(i + 1) % masts.length]; if (!m2 || angDist(m.a, m2.a) > 0.2) return; // no sail across a tower
      const base = pos.length / 3;
      for (let u = 0; u <= n; u++) {
        const f = u / n;
        let a1 = m.a, a2 = m2.a; if (a2 < a1) a2 += TAU;
        const a = a1 + (a2 - a1) * f;
        for (let v = 0; v <= n; v++) {
          const g = v / n, r = THREE.MathUtils.lerp(KR.fac0 + 0.6, rIn, g), y = THREE.MathUtils.lerp(m.top - 0.4, yIn, g) - Math.sin(g * Math.PI) * 0.7 - Math.sin(f * Math.PI) * 0.6 * g;
          pos.push(Math.sin(a) * r, y, Math.cos(a) * r); uv.push(f, g); wav.push(Math.sin(f * Math.PI) * Math.sin(g * Math.PI));
        }
      }
      for (let u = 0; u < n; u++) for (let v = 0; v < n; v++) { const a = base + u * (n + 1) + v, b = a + n + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    });
    for (const m of masts) { const [xi, zi] = polar(m.a, rIn); ropes.push(m.x, m.top, m.z, xi, yIn, zi); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aWave', new THREE.Float32BufferAttribute(wav, 1)); g.setIndex(idx); g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: this.T.sail, side: THREE.DoubleSide, roughness: 0.95, emissive: 0xffd8a8, emissiveMap: this.T.sail, emissiveIntensity: 0.28 });
    this.sailU = { time: { value: 0 } };
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.sailU.time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aWave;\nuniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += aWave * (sin(uTime * 1.3 + position.x * 0.15 + position.z * 0.11) * 0.35 + sin(uTime * 2.7 + position.z * 0.3) * 0.12);');
    };
    mat.customProgramCacheKey = () => 'kr-sail';
    const sail = new THREE.Mesh(g, mat); sail.receiveShadow = true; this.add(sail);
    // ring rope and the stays
    for (let i = 0; i < 120; i++) { const a = i / 120 * TAU, b = (i + 1) / 120 * TAU; ropes.push(Math.sin(a) * rIn, yIn, Math.cos(a) * rIn, Math.sin(b) * rIn, yIn, Math.cos(b) * rIn); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(ropes, 3));
    this.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x3a2a1c })));
  }

  // ---------------------------------------------------------------- banners and shields of the noble houses
  buildBanners() {
    // shields: one instanced quad per spot, atlas cell = house
    const sh = this.shieldSpots, geo = new THREE.CircleGeometry(0.5, 20);
    const mat = new THREE.MeshStandardMaterial({ map: this.T.shields, roughness: 0.55, metalness: 0.25 });
    mat.onBeforeCompile = s => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aHouse;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vec2((aHouse + uv.x) / 8.0, uv.y);');
    };
    mat.customProgramCacheKey = () => 'kr-shield';
    const im = new THREE.InstancedMesh(geo, mat, sh.length), house = new Float32Array(sh.length);
    sh.forEach((p, i) => { im.setMatrixAt(i, mtx(p.x, p.y, p.z, p.a, p.s)); house[i] = p.house; });
    geo.setAttribute('aHouse', new THREE.InstancedBufferAttribute(house, 1));
    im.receiveShadow = true; this.add(im);
    // hanging banners: from the gallery roof fascia every few bays, and long ones down the watchtowers' inner faces
    const spots = [];
    for (let k = 0; k < 40; k++) {
      const a = (k + 0.25) * BAY; if (nearGate(a, 0.05) || k % 2) continue;
      const [x, z] = polar(a, KR.gal0 - 0.68);
      spots.push({ x, y: KR.roofLo - 0.55, z, a: a + Math.PI, w: 1.3, h: 2.8, house: (k / 2) % 8 });
    }
    for (const g of GATES) for (const s of [-1, 1]) { const a = g + s * (KR.gateHalf + 0.05), [x, z] = polar(a, KR.wallR - 0.05); spots.push({ x, y: 4.2, z, a: a + Math.PI, w: 1.2, h: 3.4, house: g ? 7 : 0 }); }
    const bg = new THREE.PlaneGeometry(1, 1, 1, 6).translate(0, -0.5, 0);
    const bm = new THREE.MeshStandardMaterial({ map: this.T.banners, side: THREE.DoubleSide, roughness: 0.92, alphaTest: 0.5 });
    this.bannerU = { time: { value: 0 } };
    bm.onBeforeCompile = s => {
      s.uniforms.uTime = this.bannerU.time;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aHouse;\nuniform float uTime;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vec2((aHouse + uv.x) / 8.0, uv.y);')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += sin(uTime * 1.6 + aHouse * 1.7 - position.y * 2.0) * 0.08 * (-position.y);');
    };
    bm.customProgramCacheKey = () => 'kr-banner';
    const bi = new THREE.InstancedMesh(bg, bm, spots.length), bh = new Float32Array(spots.length);
    spots.forEach((p, i) => { const m = mtx(p.x, p.y, p.z, p.a); m.scale(_s.set(p.w, p.h, 1)); bi.setMatrixAt(i, m); bh[i] = p.house; });
    bg.setAttribute('aHouse', new THREE.InstancedBufferAttribute(bh, 1));
    this.add(bi);
  }

  // ---------------------------------------------------------------- the sunset sky: a dome over the HDRI (which still lights the scene)
  buildSky() {
    const sun = this.env.sun.clone().normalize();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: sun }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 uSun; uniform float uTime; varying vec3 vDir;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p) { float a = 0.0, w = 0.5; for (int i = 0; i < 5; i++) { a += n(p) * w; p *= 2.03; w *= 0.5; } return a; }
        void main() {
          vec3 d = normalize(vDir); float y = max(d.y, -0.2), s = max(dot(d, uSun), 0.0);
          vec3 zen = vec3(0.1, 0.14, 0.36), mid = vec3(0.52, 0.3, 0.44), hor = vec3(1.0, 0.52, 0.22);
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.13, y)); c = mix(c, zen, smoothstep(0.1, 0.55, y));
          c += vec3(1.0, 0.5, 0.18) * pow(s, 8.0) * 0.4 + vec3(1.0, 0.78, 0.45) * pow(s, 96.0) * 1.0 + vec3(1.0, 0.95, 0.8) * smoothstep(0.9993, 0.9997, s) * 3.0;
          // long painted cloud streaks, lit from below by the sun
          vec2 uv = d.xz / (y + 0.12) * 0.9;
          float cl = smoothstep(0.52, 0.8, fbm(uv * vec2(0.55, 1.6) + vec2(uTime * 0.004, 0.0))) * smoothstep(0.02, 0.12, y) * (1.0 - smoothstep(0.5, 0.9, y));
          vec3 cc = mix(vec3(0.5, 0.32, 0.42), vec3(1.0, 0.62, 0.36), pow(s, 2.0) * 0.9 + 0.15);
          c = mix(c, cc, cl * 0.85);
          c = mix(c, vec3(0.42, 0.3, 0.3), smoothstep(0.0, -0.15, d.y));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.skyU = mat.uniforms;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1800, 48, 24), mat);
    dome.renderOrder = -10; dome.frustumCulled = false; dome.name = 'krSky';
    this.add(dome);
  }

  // ---------------------------------------------------------------- beyond the rim: hills, mountains (models added in loadModels)
  buildOutside() {
    const NA = 128, NR = 22, pos = [], col = [], idx = [];
    for (let j = 0; j <= NR; j++) {
      const r = KR.fac1 - 0.2 + Math.pow(j / NR, 1.7) * 700;
      for (let i = 0; i <= NA; i++) {
        const a = i / NA * TAU, x = Math.sin(a) * r, z = Math.cos(a) * r, n = Math.sin(a * 3 + 1.3) * 0.5 + Math.sin(a * 7 + 0.4) * 0.3 + Math.sin(a * 13) * 0.2;
        pos.push(x, terrainH(x, z), z);
        // a cobbled plaza at the wall, fields and meadows beyond, hazy blue-green hills far away
        const plaza = smooth(70, 62, r), far = smooth(260, 650, r), road = smooth(9, 4, Math.abs(x)) * smooth(60, 70, r);
        const f = 0.85 + 0.15 * Math.sin(x * 0.05) * Math.sin(z * 0.043) + 0.1 * n;
        let c = [0.34 * f, 0.42 * f, 0.2 * f];                                          // meadow
        if (Math.sin(x * 0.021 + 1.7) * Math.sin(z * 0.017) > 0.35) c = [0.52 * f, 0.44 * f, 0.22 * f]; // wheat fields
        c = c.map((v, k) => v + ([0.3, 0.33, 0.36][k] - v) * far);
        c = c.map((v, k) => v + ([0.56, 0.47, 0.36][k] - v) * Math.max(plaza, road));
        col.push(...c);
      }
    }
    for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    this.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })));
  }

  // ---------------------------------------------------------------- fires (one draw for every flame) and embers
  buildFireSystem() {
    if (this.bowlBin) { this.add(this.bowlBin.mesh(this.mats.iron, true)); this.bowlBin = null; }
    if (this.ironBin) { this.add(this.ironBin.mesh(this.mats.iron)); this.ironBin = null; }
    for (const o of this.fireObjs || []) { this.group.remove(o); o.geometry.dispose(); }
    this.fireObjs = [];
    const F = this.fires, n = F.length, geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); geo.setIndex([0, 1, 2, 0, 2, 3]);
    const fire = new Float32Array(n * 4), seed = new Float32Array(n);
    F.forEach((f, i) => { fire.set([f.x, f.y, f.z, f.s], i * 4); seed[i] = f.seed; });
    geo.setAttribute('aFire', new THREE.InstancedBufferAttribute(fire, 4)); geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    geo.instanceCount = n;
    this.fireU = this.fireU || { uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({ vertexShader: FLAME_VS, fragmentShader: FLAME_FS, uniforms: this.fireU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 5; this.add(mesh); this.fireObjs.push(mesh);
    // glow halos
    const gc = document.createElement('canvas'); gc.width = gc.height = 64; const c = gc.getContext('2d'), gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,190,110,0.9)'); gr.addColorStop(0.4, 'rgba(255,140,60,0.3)'); gr.addColorStop(1, 'rgba(255,120,40,0)'); c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
    const halo = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(gc), size: 2.6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, color: 0xffffff });
    const hp = new THREE.BufferGeometry(); hp.setAttribute('position', new THREE.Float32BufferAttribute(F.flatMap(f => [f.x, f.y + f.s * 0.45, f.z]), 3));
    const hm = new THREE.Points(hp, halo); hm.renderOrder = 4; this.add(hm); this.fireObjs.push(hm);
    // embers rising from the bigger fires
    const src = F.filter(f => f.embers > 0), E = src.length ? this.Q.embers : 0;
    if (E) {
      const ep = new Float32Array(E * 3), es = new Float32Array(E * 4);
      for (let i = 0; i < E; i++) { const f = src[i % src.length]; es.set([f.x, f.y, f.z, Math.random()], i * 4); }
      const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(ep, 3)); eg.setAttribute('aSrc', new THREE.BufferAttribute(es, 4));
      const em = new THREE.ShaderMaterial({
        uniforms: { uTime: this.fireU.uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `attribute vec4 aSrc; uniform float uTime; varying float vA;
          void main() { float t = fract(uTime * 0.22 + aSrc.w); vec3 p = aSrc.xyz + vec3(sin(aSrc.w * 40.0 + uTime) * 0.6 * t, t * 5.5, cos(aSrc.w * 31.0 + uTime * 0.7) * 0.6 * t);
            vA = (1.0 - t) * smoothstep(0.0, 0.1, t); vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = 70.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying float vA; void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0, 0.6, 0.25) * vA * smoothstep(0.5, 0.0, d) * 1.6, 1.0); }`,
      });
      const pts = new THREE.Points(eg, em); pts.frustumCulled = false; this.add(pts); this.fireObjs.push(pts);
    }
  }
  buildLights() {
    const spots = this.lightSpots.slice(0, this.Q.lights - 2);
    for (const g of GATES) { const [x, z] = polar(g, KR.wallR - 2); spots.push({ x, y: 4.5, z, base: 40, dist: 18 }); }
    this.lights = spots.map(s => { const l = new THREE.PointLight(0xff9a50, s.base, s.dist, 1.6); l.position.set(s.x, s.y, s.z); l.userData = s; this.group.add(l); return l; });
  }

  // ---------------------------------------------------------------- Tripo models (docs/COLOSSEUM_REDESIGN.md §2)
  async loadModels() {
    const ids = ['G01', 'G02', 'B01', 'B02', 'S01', 'S02', 'S03', 'S04', 'S05', 'T01', 'V01', 'P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'O01', 'O02', 'O03', 'O04', 'O05'];
    const M = {}; (await Promise.all(ids.map(id => loadModel(id, KR_DIR)))).forEach((m, i) => { M[ids[i]] = m; });
    this.models = M;
    const put = (id, list, o = {}) => { if (!M[id] || !list.length) return null; const g = instance(M[id], list, { fit: o.fit || 'contain', cast: !!o.cast }); this.group.add(g); return g; };
    const facing = a => a + Math.PI;  // models face +z; turn them toward the arena centre
    // statues on the plinths
    for (const s of this.statueSpots) put(s.id, [{ x: s.x, y: s.y, z: s.z, yaw: s.yaw, w: 3.0, d: 3.0, h: 6.4 }], { fit: 'height', cast: true });
    // gates (team): fill the opening in the podium wall
    const gw = 2 * KR.wallR * Math.sin(KR.gateHalf) + 3.2;
    // 'box' fills the footprint exactly: a gatehouse facade squashed in depth, spanning the whole opening
    const g2 = put('G02', [{ ...xz(0, KR.wallR + 1.0), yaw: facing(0), w: gw, d: 3.0, h: 12 }], { fit: 'box', cast: true });
    const g1 = put('G01', [{ ...xz(Math.PI, KR.wallR + 1.0), yaw: facing(Math.PI), w: gw, d: 3.0, h: 12 }], { fit: 'box', cast: true });
    if (g1 && g2 && this.gateFrame) this.gateFrame.visible = false;
    // the royal box and the herald's box sit on the podium, over the cushioned rows
    const box = put('B01', [{ ...xz(ROYAL, KR.pod0 + 1.6), y: KR.wallTop, yaw: facing(ROYAL), w: 11.5, d: 5.4, h: 10.5 }], { fit: 'box', cast: true });
    // the king and his lady: find the box's floor under the canopy and seat them there, facing the sand
    if (box) {
      box.updateMatrixWorld(true);
      const rc = new THREE.Raycaster(), [fx, fz] = polar(ROYAL, KR.pod0 + 0.9);
      rc.set(new THREE.Vector3(fx, KR.wallTop + 5.5, fz), new THREE.Vector3(0, -1, 0));
      const hit = rc.intersectObject(box, true).find(h => h.point.y < KR.wallTop + 5);
      const fy = hit ? hit.point.y : KR.wallTop + 2.4, [kx, kz] = polar(ROYAL, KR.pod0 + 1.75);
      this.crowd.addRoyals(kx, fy, kz, facing(ROYAL));
    }
    put('B02', [{ ...xz(HERALD, KR.pod0 + 1.4), y: KR.wallTop, yaw: facing(HERALD), w: 9.5, d: 4.8, h: 8.5 }], { fit: 'box', cast: true });
    put('S05', [-1, 1].map(s => ({ ...xz(ROYAL + s * 0.2, KR.wallR + 0.35), y: KR.wallTop + 0.08, yaw: facing(ROYAL + s * 0.2), w: 1.6, d: 1.6, h: 2.6 })));
    // watchtowers on the rim
    // 'height': as tall as asked whatever the bounding box (the long pennant makes the box wide)
    put('T01', TOWERS.map(a => ({ ...xz(a, KR.fac1 + 2.0), yaw: facing(a), w: 9, d: 9, h: 40 })), { fit: 'height' });
    // vomitoria: tunnel mouths in the front of the middle tiers
    const walkY = KR.podY + KR.podRows * KR.podH - 0.25;
    put('V01', VOMS.map(a => ({ ...xz(a, KR.mid0 + 0.35), y: walkY, yaw: facing(a), w: 3.6, d: 1.6, h: 3.6 })));
    // braziers and gear on the strip between the curb and the wall (outside the fight zone)
    const ring = (list, r) => list.map(([a, extra]) => ({ ...xz(a, r), yaw: facing(a), ...extra }));
    put('P01', ring([1, 3, 5, 7, 9, 11, 13, 15].map(k => [k * Math.PI / 8 + 0.06, { w: 1.3, d: 1.3, h: 2.3 }]), 30.45), { fit: 'height' });
    for (const k of [1, 3, 5, 7, 9, 11, 13, 15]) { const [x, z] = polar(k * Math.PI / 8 + 0.06, 30.45); this.extraFires.push({ x, y: 2.3, z, s: 0.6 }); }
    put('P02', ring([[0.42, { w: 2.4, d: 0.9, h: 2.0 }], [Math.PI + 0.42, { w: 2.4, d: 0.9, h: 2.0 }], [2.0, { w: 2.4, d: 0.9, h: 2.0 }], [-1.15, { w: 2.4, d: 0.9, h: 2.0 }]], 31.0));
    put('P03', ring([[-0.42, { w: 1.8, d: 1.2, h: 1.5 }], [Math.PI - 0.42, { w: 1.8, d: 1.2, h: 1.5 }], [1.2, { w: 1.8, d: 1.2, h: 1.5 }], [-2.0, { w: 1.8, d: 1.2, h: 1.5 }]], 30.85));
    put('P05', ring([[0.62, { w: 1.4, d: 1.0, h: 1.8 }], [Math.PI + 0.62, { w: 1.4, d: 1.0, h: 1.8 }], [2.5, { w: 1.4, d: 1.0, h: 1.8 }], [-0.7, { w: 1.4, d: 1.0, h: 1.8 }]], 30.9));
    put('P06', GATES.flatMap(g => [-1, 1].map(s => ({ ...xz(g + s * (KR.gateHalf + 0.09), 30.6), yaw: facing(g), w: 1.2, d: 0.8, h: 5.2 }))), { fit: 'height' });
    // food stalls on the walkway between the podium and the middle tiers
    put('P04', VOMS.filter((_, i) => i % 2 === 0).map(a => ({ ...xz(a + 0.12, (KR.walk0 + KR.walk1) / 2), y: walkY, yaw: facing(a + 0.12), w: 2.4, d: 1.3, h: 2.6 })));
    // landmarks beyond the rim (seen above it)
    if (this.Q.outside) {
      // the town round the colosseum (roads left free toward the gates), cypresses, the castle and the cathedral on hills
      const at = (x, z, o) => ({ x, z, y: terrainH(x, z), ...o }), R = rng(77), houses = [[], []], trees = [];
      for (let k = 0; k < 46; k++) {
        const a = R() * TAU, r = 74 + R() * 70, [x, z] = polar(a, r);
        if (Math.abs(x) < 12 || (Math.abs(z) < 10 && Math.abs(x) < 200)) continue;          // the two roads
        houses[k % 2].push(at(x, z, { yaw: Math.atan2(-x, -z) + (R() - 0.5) * 0.6, w: 18, d: 18, h: 11 + R() * 5 }));
      }
      for (let k = 0; k < 30; k++) { const a = R() * TAU, r = 64 + R() * 110, [x, z] = polar(a, r); if (Math.abs(x) < 10) continue; trees.push(at(x, z, { yaw: R() * TAU, w: 8, d: 8, h: 11 + R() * 6 })); }
      put('O03', houses[0]); put('O04', houses[1]);
      put('O05', trees, { fit: 'height' });
      put('O01', [at(210, -250, { yaw: -0.6, w: 120, d: 120, h: 70 })]);
      put('O02', [at(-190, 205, { yaw: 2.4, w: 70, d: 70, h: 62 })]);
    }
    this.rebuildExtraFires();
  }
  // fires that belong to loaded models (brazier bowls): add them and rebuild the flame instances
  rebuildExtraFires() {
    if (!this.extraFires.length) return;
    for (const f of this.extraFires) this.fire(f.x, f.y, f.z, f.s, { embers: 0.8 });
    this.extraFires = [];
    this.buildFireSystem();
  }

  dispose() { this.crowd?.rt.dispose(); }

  // ---------------------------------------------------------------- per frame
  update(dt, vfx) {
    this.time += dt;
    this.crowdHype = Math.max(0, Math.min(1, this.crowdHype || 0) - dt * 0.3);
    const t = this.time;
    this.fireU.uTime.value = t;
    this.sailU.time.value = t; this.bannerU.time.value = t; this.skyU.uTime.value = t;
    for (const l of this.lights) { const s = l.userData; l.intensity = s.base * (0.85 + Math.sin(t * 7.3 + s.x) * 0.08 + Math.sin(t * 17.1 + s.z) * 0.05); }
    this.crowd.update(dt, this.crowdHype, this.camera);
  }
}
function xz(a, r) { return { x: Math.sin(a) * r, z: Math.cos(a) * r }; }
// ground height beyond the colosseum: flat plaza at the wall, gentle fields, hills rising far away
function terrainH(x, z) {
  const r = Math.hypot(x, z), a = Math.atan2(x, z), n = Math.sin(a * 3 + 1.3) * 0.5 + Math.sin(a * 7 + 0.4) * 0.3 + Math.sin(a * 13) * 0.2;
  const rolling = (Math.sin(x * 0.018) * Math.cos(z * 0.015) + Math.sin(x * 0.007 + z * 0.009)) * 4;
  return smooth(70, 140, r) * (rolling + 4) + smooth(240, 650, r) * (60 + n * 55) - 0.05;
}
