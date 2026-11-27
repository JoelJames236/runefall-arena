// Kingsreach Colosseum — the crowd. Thousands of spectators in one draw call:
// 1. 12 rigged Tripo characters (K01–K12: townsfolk of every race, nobles, the king, a guard) are posed at load
//    time — seated idle, leaning, clapping, fist up, cheering; standing idle, fist up, cheering — and rendered from
//    three angles into one sprite atlas (impostors). Until a character's GLB has loaded (or if it is missing) a
//    simple procedural figure in its colours stands in, so the stands are never empty.
// 2. Every seat is an instanced quad that turns to the camera; the vertex shader picks the atlas cell from the
//    character, the pose (crowd excitement, a wave running round the stands, each spectator's own rhythm) and the
//    angle to the camera. Clapping and fist pumping alternate two poses; cheering bobs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const DIR = 'assets/models/colosseum/';
export const CROWD_IDS = ['K01', 'K02', 'K03', 'K04', 'K05', 'K06', 'K07', 'K08', 'K09', 'K10', 'K11', 'K12'];
const NCH = CROWD_IDS.length, NPOSE = 8, NYAW = 3, COLS = 32;
const YAWS = [-0.62, 0, 0.62];                    // the character turned this much (rad) in the three views
const SPRITE_W = 1.3, SPRITE_H = 2.6;             // world size of a cell (m), feet at the bottom
// body height (m) per character: townsman, townswoman, dwarf, orc, elf, troll, undead, bull-folk, lord, lady, king, guard
const HEIGHT = [1.78, 1.68, 1.32, 1.95, 1.86, 2.02, 1.74, 2.15, 1.8, 1.7, 1.82, 1.84];
// procedural stand-in colours: [skin, top, bottom, hair/hat]
const LOOK = [
  [0xe0b090, 0x4f7a3a, 0x6a4a30, 0x6a4022], [0xe8c0a0, 0x2f5aa8, 0x2f5aa8, 0xd8c8a0], [0xd8a080, 0xc8962e, 0x5a3a22, 0xb04a1a],
  [0x6a9a4a, 0x6a4a30, 0x5a4a3a, 0x1a1a1a], [0xf0d0b0, 0x1f6f78, 0x1f6f78, 0xf0dc8a], [0x4a7ab0, 0xa3232a, 0x6a5a3a, 0xd02020],
  [0x9aa0a0, 0x5a2d82, 0x3a2a3a, 0x3a2a3a], [0x7a5030, 0x8a6a3a, 0x6a4a2a, 0xe0d8c8], [0xe0b090, 0x7a1d24, 0x2a2a2a, 0x3a2a1a],
  [0xf0d0b0, 0x5a2d82, 0x5a2d82, 0x8a5a2a], [0xe0b090, 0x5a2d82, 0x5a2d82, 0xe3b341], [0xe0b090, 0xefe3c8, 0x6a6a6a, 0x8a8a8a],
];

// ---------------------------------------------------------------- posing
// Poses are limb directions in the character's own frame (facing +z, its left = +x, up = +y). A pose is applied
// by turning each bone so the segment to its child points that way — this works whatever the rig's bone axes are.
const P = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const SIT = { thighL: P(0.12, -0.15, 1), thighR: P(-0.12, -0.15, 1), shinL: P(0.02, -1, 0.12), shinR: P(-0.02, -1, 0.12) };
const STAND = { thighL: P(0.06, -1, 0), thighR: P(-0.06, -1, 0), shinL: P(0, -1, 0), shinR: P(0, -1, 0) };
const ARMS = {
  rest: { uaL: P(0.2, -0.8, 0.55), uaR: P(-0.2, -0.8, 0.55), laL: P(-0.05, -0.35, 1), laR: P(0.05, -0.35, 1) },          // hands on knees
  lean: { uaL: P(0.35, -0.6, 0.7), uaR: P(-0.35, -0.6, 0.7), laL: P(-0.35, 0.1, 1), laR: P(0.35, 0.1, 1), spine: 0.28 },  // leaning in, hands apart
  clap: { uaL: P(0.25, -0.45, 0.85), uaR: P(-0.25, -0.45, 0.85), laL: P(-0.75, 0.3, 0.6), laR: P(0.75, 0.3, 0.6), spine: 0.1 },
  fist: { uaL: P(0.2, -0.8, 0.55), uaR: P(-0.35, 0.92, 0.15), laL: P(-0.05, -0.35, 1), laR: P(-0.1, 1, 0.1) },
  cheer: { uaL: P(0.5, 0.85, 0.15), uaR: P(-0.5, 0.85, 0.15), laL: P(0.2, 1, 0.05), laR: P(-0.2, 1, 0.05), spine: -0.08 },
  side: { uaL: P(0.25, -0.95, 0.1), uaR: P(-0.25, -0.95, 0.1), laL: P(0.05, -1, 0.15), laR: P(-0.05, -1, 0.15) },           // standing, arms down
};
// pose index → [legs, arms]: 0 sit idle, 1 sit lean, 2 sit clap, 3 sit fist, 4 sit cheer, 5 stand idle, 6 stand fist, 7 stand cheer
const POSES = [[SIT, 'rest'], [SIT, 'lean'], [SIT, 'clap'], [SIT, 'fist'], [SIT, 'cheer'], [STAND, 'side'], [STAND, 'fist'], [STAND, 'cheer']];

// find the limb bones of a rig by name (Mixamo, UE mannequin, Tripo and similar) and side (by rest position)
function limbBones(root) {
  const bones = []; root.traverse(o => { if (o.isBone) bones.push(o); });
  root.updateMatrixWorld(true);
  const wp = b => b.getWorldPosition(new THREE.Vector3());
  const nm = b => b.name.toLowerCase().replace(/mixamorig[:_]?/, '');
  const pick = (re, side, not) => bones.filter(b => re.test(nm(b)) && !(not && not.test(nm(b))) && (side === 0 || Math.sign(wp(b).x) === side))
    .sort((a, b) => nm(a).length - nm(b).length)[0];
  const B = {
    hips: pick(/hips|pelvis/, 0), spine: pick(/spine|chest/, 0), head: pick(/head/, 0, /end|top/),
    uaL: pick(/upper_?arm|(^|[^e])arm/, 1, /fore|lower|twist/), uaR: pick(/upper_?arm|(^|[^e])arm/, -1, /fore|lower|twist/),
    laL: pick(/fore_?arm|lower_?arm/, 1, /twist/), laR: pick(/fore_?arm|lower_?arm/, -1, /twist/),
    hL: pick(/hand/, 1, /thumb|index|middle|ring|pinky/), hR: pick(/hand/, -1, /thumb|index|middle|ring|pinky/),
    thighL: pick(/thigh|up_?leg|upper_?leg/, 1), thighR: pick(/thigh|up_?leg|upper_?leg/, -1),
    shinL: pick(/calf|shin|lower_?leg|(^|[^p])leg/, 1, /up|upper|thigh/), shinR: pick(/calf|shin|lower_?leg|(^|[^p])leg/, -1, /up|upper|thigh/),
    fL: pick(/foot|ankle/, 1), fR: pick(/foot|ankle/, -1),
  };
  return B;
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qd = new THREE.Quaternion();
function aim(bone, child, dir) {
  if (!bone || !child) return;
  bone.updateMatrixWorld(true);
  bone.getWorldPosition(_a); child.getWorldPosition(_b);
  const cur = _b.sub(_a).normalize();
  _qd.setFromUnitVectors(cur, dir);
  bone.getWorldQuaternion(_qw);
  const parentQ = bone.parent ? bone.parent.getWorldQuaternion(_qp) : _qp.identity();
  bone.quaternion.copy(parentQ.clone().invert().multiply(_qd.multiply(_qw)));
  bone.updateMatrixWorld(true);
}
function applyPose(rig, pose) {
  const { B, rest } = rig, [legs, armsKey] = POSES[pose], arms = ARMS[armsKey];
  for (const [b, q] of rest) b.quaternion.copy(q);
  rig.root.updateMatrixWorld(true);
  if (arms.spine && B.spine) { B.spine.rotateX(arms.spine); B.spine.updateMatrixWorld(true); }
  aim(B.thighL, B.shinL, legs.thighL); aim(B.thighR, B.shinR, legs.thighR);
  aim(B.shinL, B.fL, legs.shinL); aim(B.shinR, B.fR, legs.shinR);
  aim(B.uaL, B.laL, arms.uaL); aim(B.uaR, B.laR, arms.uaR);
  aim(B.laL, B.hL, arms.laL); aim(B.laR, B.hR, arms.laR);
  // seated: the hips drop until the feet are back on the ground
  rig.root.position.y = 0; rig.root.updateMatrixWorld(true);
  const fy = Math.min(B.fL ? B.fL.getWorldPosition(_a).y : 0.08, B.fR ? B.fR.getWorldPosition(_b).y : 0.08);
  rig.root.position.y = -(fy - rig.ankle); rig.root.updateMatrixWorld(true);
}

// ---------------------------------------------------------------- procedural stand-in figure
function figure(ch, pose) {
  const L = LOOK[ch], [legs, armsKey] = POSES[pose], arms = ARMS[armsKey], H = HEIGHT[ch];
  const g = new THREE.Group(), m = c => new THREE.MeshLambertMaterial({ color: c });
  const k = H / 1.78, sit = legs === SIT, hip = sit ? 0.47 * k : 0.92 * k;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * k, 0.17 * k, 0.6 * k, 8), m(L[1])); torso.position.y = hip + 0.32 * k;
  if (arms.spine) { torso.rotation.x = arms.spine; }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13 * k, 10, 8), m(L[0])); head.position.set(0, hip + 0.76 * k, (arms.spine || 0) * 0.3);
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.135 * k, 10, 6, 0, 6.3, 0, 1.3), m(L[3])); hat.position.copy(head.position).y += 0.03 * k;
  g.add(torso, head, hat);
  const limb = (from, dir, len, r, col) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, len, 6), m(col)); c.position.copy(from).addScaledVector(dir, len / 2); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); g.add(c); return from.clone().addScaledVector(dir, len); };
  for (const s of [1, -1]) {
    const sh = new THREE.Vector3(s * 0.22 * k, hip + 0.55 * k, (arms.spine || 0) * 0.15);
    const el = limb(sh, s > 0 ? arms.uaL : arms.uaR, 0.3 * k, 0.055 * k, L[1]);
    limb(el, s > 0 ? arms.laL : arms.laR, 0.28 * k, 0.045 * k, L[0]);
    const hp = new THREE.Vector3(s * 0.1 * k, hip, 0);
    const kn = limb(hp, s > 0 ? legs.thighL : legs.thighR, 0.45 * k, 0.075 * k, L[2]);
    limb(kn, s > 0 ? legs.shinL : legs.shinR, 0.45 * k, 0.06 * k, L[2]);
  }
  return g;
}

// ---------------------------------------------------------------- the crowd
const VS = `
  attribute vec4 aSeat;   // x y z, facing angle (toward the centre)
  attribute vec4 aInfo;   // character, standing, seed, light
  uniform float uTime, uHype, uWave, uWaveOn, uCols, uRows;
  uniform vec2 uSize;
  varying vec2 vUv; varying float vLight;
  #include <fog_pars_vertex>
  void main() {
    float ch = aInfo.x, stand = aInfo.y, seed = aInfo.z;
    // excitement: the match, a wave running round, each spectator's own mood
    float wa = atan(aSeat.x, aSeat.z), dw = atan(sin(wa - uWave), cos(wa - uWave));
    float mood = 0.5 + 0.5 * sin(uTime * (0.05 + seed * 0.07) + seed * 40.0);
    float e = uHype * (0.7 + 0.6 * seed) + uWaveOn * exp(-dw * dw * 40.0) + mood * 0.28 - 0.18;
    float beat = floor(uTime * (3.0 + seed * 2.0) + seed * 9.0), alt = mod(beat, 2.0);
    float kind = mod(floor(seed * 7.0 + floor(uTime * 0.25 + seed * 3.0)), 3.0); // what they do when excited
    float pose, bob = 0.0;
    if (stand > 0.5) {
      if (e < 0.35) pose = 5.0;
      else if (kind < 1.0 || e < 0.6) pose = alt > 0.5 ? 6.0 : 5.0;
      else { pose = 7.0; bob = abs(sin(uTime * 7.0 + seed * 20.0)) * 0.12; }
    } else {
      if (e < 0.25) pose = 0.0;
      else if (e < 0.45) pose = 1.0;
      else if (kind < 1.0) pose = alt > 0.5 ? 2.0 : 1.0;
      else if (kind < 2.0) pose = alt > 0.5 ? 3.0 : 0.0;
      else { pose = 4.0; bob = abs(sin(uTime * 6.0 + seed * 20.0)) * 0.1; }
    }
    // view angle: which of the three baked turns faces the camera best
    vec3 toCam = cameraPosition - aSeat.xyz; vec2 tc = normalize(toCam.xz), f = vec2(sin(aSeat.w), cos(aSeat.w));
    float rel = atan(f.x * tc.y - f.y * tc.x, dot(f, tc));
    float yaw = rel < -0.32 ? 0.0 : (rel > 0.32 ? 2.0 : 1.0);
    float cell = (ch * ${NPOSE}.0 + pose) * ${NYAW}.0 + yaw;
    vec2 c = vec2(mod(cell, uCols), floor(cell / uCols));
    vUv = vec2((c.x + uv.x) / uCols, 1.0 - (c.y + 1.0 - uv.y) / uRows);
    vLight = aInfo.w;
    // cylindrical billboard
    vec3 right = normalize(vec3(tc.y, 0.0, -tc.x));
    vec3 wp = aSeat.xyz + right * (uv.x - 0.5) * uSize.x + vec3(0.0, uv.y * uSize.y + bob, 0.0);
    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const FS = `
  uniform sampler2D uAtlas;
  varying vec2 vUv; varying float vLight;
  #include <fog_pars_fragment>
  void main() {
    vec4 c = texture2D(uAtlas, vUv);
    if (c.a < 0.5) discard;
    gl_FragColor = vec4(c.rgb * vLight, 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

export class Crowd {
  constructor(arena) {
    this.arena = arena;
    const Q = arena.Q;
    this.cell = Q.cell;
    this.rows = Math.ceil(NCH * NPOSE * NYAW / COLS);
    // rendering into a target writes linear colour, so the atlas is linear (the crowd shader encodes on output)
    this.rt = new THREE.WebGLRenderTarget(COLS * this.cell, this.rows * this.cell * 2, { samples: 4, type: THREE.UnsignedByteType });
    this.rt.texture.generateMipmaps = false; this.rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.U = {
      uAtlas: { value: this.rt.texture }, uTime: { value: 0 }, uHype: { value: 0 }, uWave: { value: 0 }, uWaveOn: { value: 0 },
      uCols: { value: COLS }, uRows: { value: this.rows }, uSize: { value: new THREE.Vector2(SPRITE_W, SPRITE_H) },
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    };
    this.buildSeats(arena, Q.crowd);
    this.waveT = -1; this.lastHype = 0;
    this.ready = this.bake();
  }

  // ---------------------------------------------------------------- seats
  buildSeats(A, density) {
    const R = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(4242);
    const gate = [0, Math.PI], royal = Math.PI / 2, herald = -Math.PI / 2, towers = [1, 3, 5, 7].map(k => k * Math.PI / 4);
    const voms = [1, 3, 5, 7, 9, 11, 13, 15].map(k => k * Math.PI / 8);
    const d = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    const sun = new THREE.Vector2(A.env.sun.x, A.env.sun.z).normalize();
    const seats = [];
    for (const row of A.seatRows) {
      const standing = row.tier === 'gallery', step = (standing ? 0.62 : 0.72) / row.r;
      for (let a = R() * step; a < Math.PI * 2; a += step * (0.9 + R() * 0.25)) {
        if (gate.some(g => d(a, g) < 0.2)) continue;
        if (row.tier === 'podium' && (d(a, royal) < 0.2 || d(a, herald) < 0.17)) continue;
        if (row.tier === 'middle' && row.row < 5 && voms.some(v => d(a, v) < 0.065)) continue;
        if (standing && towers.some(t => d(a, t) < 0.12)) continue;
        const occ = (row.tier === 'podium' ? 0.72 : row.tier === 'middle' ? 0.86 : 0.8) * density;
        if (R() > occ) continue;
        let ch;
        if (row.tier === 'podium') ch = R() < 0.62 ? (R() < 0.5 ? 8 : 9) : Math.floor(R() * 8);
        else { const u = R(); ch = u < 0.2 ? 0 : u < 0.38 ? 1 : 2 + Math.floor(R() * 6); }
        const facing = Math.atan2(-Math.sin(a), -Math.cos(a));
        const lit = 0.62 + 0.38 * Math.max(0, -Math.sin(a) * sun.x - Math.cos(a) * sun.y) - (row.tier === 'gallery' ? 0.12 : 0);
        const rr = row.r + (R() - 0.5) * 0.12;
        seats.push([Math.sin(a) * rr, row.y + (standing ? 0 : 0.02), Math.cos(a) * rr, facing, ch, standing ? 1 : 0, R(), lit * (0.92 + R() * 0.16)]);
      }
    }
    // guards beside the gates and the royal box, the king and his lady in the box (placed by the arena when the box
    // model has loaded: A.kingSpot)
    for (const g of gate) for (const s of [-1, 1]) { const a = g + s * 0.19, r = 33.4; seats.push([Math.sin(a) * r, 5.0, Math.cos(a) * r, Math.atan2(-Math.sin(a), -Math.cos(a)), 11, 1, R(), 0.85]); }
    for (const s of [-1, 1]) { const a = royal + s * 0.26, r = 33.3; seats.push([Math.sin(a) * r, 5.0, Math.cos(a) * r, Math.atan2(-Math.sin(a), -Math.cos(a)), 11, 1, R(), 0.95]); }
    this.count = seats.length;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); geo.setIndex([0, 1, 2, 0, 2, 3]);
    const seat = new Float32Array(this.count * 4), info = new Float32Array(this.count * 4);
    seats.forEach((s, i) => { seat.set(s.slice(0, 4), i * 4); info.set(s.slice(4), i * 4); });
    geo.setAttribute('aSeat', new THREE.InstancedBufferAttribute(seat, 4)); geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
    geo.instanceCount = this.count;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: this.U, fog: true });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.name = 'crowd';
    this.mesh.visible = false; // shown once the atlas is baked
    A.group.add(this.mesh);
    this.addRoyals = (x, y, z, facing) => {   // the king (seated) and the lady beside him
      const extra = [[x, y, z, facing, 10, 0, 0.3, 1.0], [x + Math.cos(facing) * 1.3, y, z - Math.sin(facing) * 1.3, facing, 9, 0, 0.7, 1.0]];
      const n = this.count + extra.length, s2 = new Float32Array(n * 4), i2 = new Float32Array(n * 4);
      s2.set(seat); i2.set(info); extra.forEach((e, k) => { s2.set(e.slice(0, 4), (this.count + k) * 4); i2.set(e.slice(4), (this.count + k) * 4); });
      geo.setAttribute('aSeat', new THREE.InstancedBufferAttribute(s2, 4)); geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(i2, 4));
      geo.instanceCount = n;
    };
  }

  // ---------------------------------------------------------------- impostor atlas
  async loadRig(id) {
    return new Promise(res => new GLTFLoader().load(DIR + id + '.glb', g => res(g.scene), undefined, () => res(null)));
  }
  async bake() {
    const scenes = await Promise.all(CROWD_IDS.map(id => Promise.race([this.loadRig(id), new Promise(r => setTimeout(() => r(null), 15000))])));
    while (!this.arena.renderer) await new Promise(r => setTimeout(r, 50));
    const renderer = this.arena.renderer;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff0dc, 0x5a4636, 1.6));
    const key = new THREE.DirectionalLight(0xffe2c0, 2.2); key.position.set(-1.2, 2.2, 3); scene.add(key);
    const cam = new THREE.OrthographicCamera(-SPRITE_W / 2, SPRITE_W / 2, SPRITE_H, 0, -10, 10); cam.position.set(0, 0, 5); cam.lookAt(0, 0, 0);
    cam.position.set(0, -0.0, 5);
    const holder = new THREE.Group(); scene.add(holder);
    const rigs = scenes.map((s, i) => s && this.prepRig(s, i));
    this.usedModels = rigs.map(r => !!r);
    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    const prevTone = renderer.toneMapping;
    renderer.setRenderTarget(this.rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.autoClear = false;
    renderer.toneMapping = THREE.NoToneMapping;
    const cw = this.cell, chh = this.cell * 2;
    for (let ch = 0; ch < NCH; ch++) for (let p = 0; p < NPOSE; p++) {
      holder.clear();
      let obj;
      if (rigs[ch]) { applyPose(rigs[ch], p); obj = rigs[ch].root; } else obj = figure(ch, p);
      holder.add(obj);
      for (let y = 0; y < NYAW; y++) {
        holder.rotation.y = YAWS[y];
        const cell = (ch * NPOSE + p) * NYAW + y, cx = cell % COLS, cy = Math.floor(cell / COLS);
        const vy = (this.rows - 1 - cy) * chh;
        this.rt.viewport.set(cx * cw, vy, cw, chh); this.rt.scissor.set(cx * cw, vy, cw, chh); this.rt.scissorTest = true;
        renderer.setRenderTarget(this.rt);
        renderer.render(scene, cam);
      }
    }
    this.rt.scissorTest = false; this.rt.viewport.set(0, 0, this.rt.width, this.rt.height);
    this.rt.texture.generateMipmaps = true;
    renderer.setRenderTarget(this.rt); renderer.render(new THREE.Scene(), cam); // resolves MSAA and builds the mipmaps
    renderer.setRenderTarget(prevRT); renderer.autoClear = prevAuto; renderer.setClearColor(prevClear, prevAlpha); renderer.toneMapping = prevTone;
    this.mesh.visible = true;
  }
  // scale a rig to its body height, feet on the ground, facing +z; remember its rest pose
  prepRig(root, ch) {
    root = SkeletonUtils.clone(root);
    root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; if (o.material) { o.material = o.material.clone(); o.material.metalness = 0; o.material.roughness = 0.85; o.material.envMapIntensity = 0; } } });
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), h = box.max.y - box.min.y;
    if (!(h > 0)) return null;
    const k = HEIGHT[ch] / h;
    const wrap = new THREE.Group(); wrap.add(root);
    root.scale.multiplyScalar(k); root.position.set(-(box.min.x + box.max.x) / 2 * k, -box.min.y * k, -(box.min.z + box.max.z) / 2 * k);
    wrap.updateMatrixWorld(true);
    const B = limbBones(root);
    if (!B.uaL || !B.uaR || !B.thighL || !B.thighR) { console.warn('[crowd] rig without limbs', CROWD_IDS[ch], B); return null; }
    const rest = []; root.traverse(o => { if (o.isBone) rest.push([o, o.quaternion.clone()]); });
    const ankle = Math.min(B.fL ? B.fL.getWorldPosition(new THREE.Vector3()).y : 0.08, B.fR ? B.fR.getWorldPosition(new THREE.Vector3()).y : 0.08);
    return { root: wrap, B, rest, ch, ankle };
  }

  // ---------------------------------------------------------------- per frame
  update(dt, hype) {
    const U = this.U; U.uTime.value += dt;
    U.uHype.value += (hype - U.uHype.value) * Math.min(1, dt * 4);
    // a big jump in excitement (round start, a kill) starts a wave round the stands
    if (hype > 0.95 && this.lastHype < 0.9 && this.waveT < 0) this.waveT = 0;
    this.lastHype = hype;
    if (this.waveT >= 0) {
      this.waveT += dt;
      U.uWave.value = -Math.PI + this.waveT * 1.6; U.uWaveOn.value = Math.min(1, this.waveT * 2) * (this.waveT < 3.6 ? 1 : Math.max(0, 1 - (this.waveT - 3.6) * 2));
      if (this.waveT > 4.2) { this.waveT = -1; U.uWaveOn.value = 0; }
    }
  }
}
