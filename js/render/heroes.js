// Realistic champions built from CC0 assets (Quaternius Universal Base Characters,
// Modular Fantasy Outfits, Universal Animation Library 1+2, Fantasy Props MegaKit).
//
// Each class = an outfit (skinned, shares the UE-mannequin style skeleton) + a base-body head
// transplanted onto the outfit skeleton + hair + weapon props, with a per-class colour grade.
// Animation: one AnimationMixer per champion with a layered state machine — the lower body
// keeps running the locomotion clip while the upper body plays attacks / casts / hit reactions.
//
// Public API matches the old procedural Character: constructor(cls), root, cls, act, opacity,
// update(dt, st), play(kind, dur), hit(strength), setOpacity(a), focusWorld(out), weaponTipWorld(out).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { makeMaterials, makeClassWeapon, equipArmor } from './armory.js';

const M = 'assets/models/', P = 'assets/props/', TX = 'assets/tex/';
const GL = {};        // loaded glTFs by name
const CLIPS = {};     // clip name -> { full, upper, lower }
let TEX = null;       // shared PBR textures for procedural weapons
let ready = false;

// ------------------------------------------------------------------ class looks
const LOOKS = {
  warrior: { outfit: 'Male_Ranger', head: 'Superhero_Male_FullBody', hair: ['Hair_Buzzed', 'Hair_Beard'], hide: ['Head_Hood'],
    tint: [0.34, 0.31, 0.3], tintAmt: 0.55, skinTint: [1, 0.92, 0.86], scale: 1.06, weapons: ['runesword', 'kiteshield'], idle: 'Idle_Shield_Loop' },
  rogue: { outfit: 'Female_Ranger', head: 'Superhero_Female_FullBody', hair: [], hide: [],
    tint: [0.16, 0.13, 0.2], tintAmt: 0.82, skinTint: [0.95, 0.88, 0.85], scale: 0.98, weapons: ['fang', 'fangL'], idle: 'Crouch_Idle_Loop' },
  mage: { outfit: 'Male_Ranger', head: 'Superhero_Male_FullBody', hair: ['Hair_Beard'], hide: [],
    tint: [0.16, 0.2, 0.46], tintAmt: 0.8, skinTint: [1, 0.95, 0.92], scale: 1.0, weapons: ['archstaff'], idle: 'Idle_Loop', glow: 0xa070ff },
  berserker: { outfit: 'Superhero_Male_FullBody', head: null, parts: [{ src: 'Male_Peasant', only: ['Legs', 'Feet'] }], hair: ['Hair_Long', 'Hair_Beard'], hide: [],
    tint: [0.22, 0.16, 0.12], tintAmt: 0.65, skinTint: [0.96, 0.82, 0.72], scale: 1.13, weapons: ['warAxe', 'warAxeL'], idle: 'Sword_Idle', weaponScale: 1.15, axeTint: [0.5, 0.48, 0.46] },
  priest: { outfit: 'Female_Peasant', head: 'Superhero_Female_FullBody', hair: ['Hair_Buns'], hide: [],
    tint: [0.9, 0.85, 0.72], tintAmt: 0.72, skinTint: [1, 0.96, 0.94], scale: 1.0, weapons: ['sunmace'], idle: 'Idle_Loop', halo: true, glow: 0xffd98a },
  shaman: { outfit: 'Male_Peasant', head: 'Superhero_Male_FullBody', hair: ['Hair_Long', 'Hair_Beard'], hide: ['Arms_1'],
    tint: [0.42, 0.3, 0.2], tintAmt: 0.6, skinTint: [0.86, 0.72, 0.62], scale: 1.03, weapons: ['stormaxe', 'fireOrb'], idle: 'Idle_Loop', glow: 0x4ad8ff },
};
// spec looks ("class:spec"): overrides on top of the class look
LOOKS['mage:fire'] = { ...LOOKS.mage, tint: [0.44, 0.11, 0.07], tintAmt: 0.82, glow: 0xff7a2a }; // crimson robes, burning staff crystal
LOOKS['berserker:executioner'] = { ...LOOKS.berserker, weapons: ['greatAxe'], weaponScale: 1.08, tint: [0.14, 0.12, 0.11], tintAmt: 0.75, castPose: 'Sword_Block' }; // castPose: Skullsplitter wind-up

// one-shot actions: kind -> per-class clip list (alternated) + whether it should use the full body
const ACTIONS = {
  attack: { 'berserker:executioner': ['TreeChopping_Loop'], berserker: ['Sword_Regular_A', 'Sword_Regular_B'], warrior: ['Sword_Regular_A', 'Sword_Regular_B'], rogue: ['Punch_Jab', 'Punch_Cross'], mage: ['Spell_Simple_Shoot'], priest: ['Spell_Simple_Shoot'], shaman: ['Spell_Simple_Shoot'] },
  slash: { any: ['Sword_Regular_A', 'Sword_Regular_B'], rogue: ['Punch_Cross'] },
  stab: { any: ['Punch_Cross', 'Punch_Jab'] },
  finisher: { any: ['Sword_Attack'], rogue: ['Melee_Hook'], berserker: ['Sword_Regular_C'], 'berserker:executioner': ['Sword_Attack'] },
  bash: { any: ['Shield_OneShot'], rogue: ['Melee_Hook'] },
  release: { any: ['Spell_Simple_Shoot'] },
  raise: { any: ['Spell_Simple_Shoot'], berserker: ['Punch_Cross'] },
  slam: { any: ['Sword_Attack'], shaman: ['OverhandThrow'], berserker: ['OverhandThrow'], 'berserker:executioner': ['Sword_Regular_C'] },
  dash: { any: ['Roll'], full: true },
  charge: { any: ['Shield_Dash'], berserker: ['Sword_Dash'], full: true },
  flinch: { any: ['Hit_Chest'] },
};

const LOWER_ROOTS = ['pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r', 'root'];

// ------------------------------------------------------------------ loading
function loadGLTF(loader, url) { return new Promise((res, rej) => loader.load(url, res, undefined, rej)); }

function texSet(loader, name, rep = 1) {
  const f = s => { const t = loader.load(TX + name + s); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 8; return t; };
  const map = f('_Diffuse.jpg'); map.colorSpace = THREE.SRGBColorSpace;
  return { map, normalMap: f('_nor_gl.jpg'), arm: f('_arm.jpg') };
}

// Keep only bone rotations (+ pelvis translation) so any clip fits any body proportions.
function cleanClip(clip) {
  const tracks = clip.tracks.filter(t => t.name.endsWith('.quaternion') || t.name === 'pelvis.position');
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
function splitClip(clip, lowerSet) {
  const lower = [], upper = [];
  for (const t of clip.tracks) { const bone = t.name.slice(0, t.name.lastIndexOf('.')); (lowerSet.has(bone) ? lower : upper).push(t); }
  return { full: clip, upper: new THREE.AnimationClip(clip.name + '_U', clip.duration, upper), lower: new THREE.AnimationClip(clip.name + '_L', clip.duration, lower) };
}

export async function loadHeroAssets(onProgress = () => {}) {
  if (ready) return;
  const manager = new THREE.LoadingManager();
  manager.onProgress = (url, loaded, total) => onProgress(loaded / Math.max(1, total));
  const loader = new GLTFLoader(manager);
  const models = ['Male_Ranger', 'Female_Ranger', 'Male_Peasant', 'Female_Peasant', 'Superhero_Male_FullBody', 'Superhero_Female_FullBody', 'Hair_Buzzed', 'Hair_Beard', 'Hair_Long', 'Hair_Buns'];
  const props = ['Sword_Bronze', 'Shield_Wooden', 'Axe_Bronze'];
  const jobs = [
    ...models.map(n => loadGLTF(loader, M + n + '.gltf').then(g => { GL[n] = g; })),
    ...props.map(n => loadGLTF(loader, P + n + '.gltf').then(g => { GL[n] = g; })),
    loadGLTF(loader, M + 'UAL1.glb').then(g => { GL.UAL1 = g; }),
    loadGLTF(loader, M + 'UAL2.glb').then(g => { GL.UAL2 = g; }),
  ];
  await Promise.all(jobs);
  // lower-body bone set (pelvis and both legs, recursively)
  const lowerSet = new Set();
  GL.Male_Ranger.scene.traverse(o => { if (o.isBone && LOWER_ROOTS.includes(o.name)) o.traverse(c => { if (c.isBone && !c.name.startsWith('spine') ) lowerSet.add(c.name); }); });
  // spine chain must not be classified lower even though it's under pelvis
  GL.Male_Ranger.scene.traverse(o => { if (o.isBone && o.name === 'spine_01') o.traverse(c => lowerSet.delete(c.name)); });
  for (const clip of [...GL.UAL1.animations, ...GL.UAL2.animations]) CLIPS[clip.name] = splitClip(cleanClip(clip), lowerSet);
  const tl = new THREE.TextureLoader(manager);
  TEX = { wood: texSet(tl, 'weathered_planks', 0.6), metal: texSet(tl, 'rusty_metal_02', 0.5) };
  prepareHeads();
  ready = true;
}
export const heroesReady = () => ready;

// Base-body heads: keep only triangles skinned to the neck/head so the head can sit on any outfit.
const HEADS = {};
function prepareHeads() {
  for (const name of ['Superhero_Male_FullBody', 'Superhero_Female_FullBody']) {
    const out = [];
    GL[name].scene.traverse(o => {
      if (!o.isSkinnedMesh) return;
      if (/Eye/i.test(o.name)) { out.push({ src: o, geo: o.geometry }); return; }
      const bones = o.skeleton.bones;
      const keep = new Set(bones.map((b, i) => (b.name === 'Head' || b.name === 'neck_01') ? i : -1).filter(i => i >= 0));
      const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
      const vOk = new Uint8Array(si.count);
      for (let v = 0; v < si.count; v++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (keep.has(si.getComponent(v, k))) w += sw.getComponent(v, k);
        vOk[v] = w > 0.5 ? 1 : 0;
      }
      const idx = o.geometry.index.array, kept = [];
      for (let t = 0; t < idx.length; t += 3) if (vOk[idx[t]] && vOk[idx[t + 1]] && vOk[idx[t + 2]]) kept.push(idx[t], idx[t + 1], idx[t + 2]);
      const geo = o.geometry.clone(); geo.setIndex(kept);
      out.push({ src: o, geo });
    });
    HEADS[name] = out;
  }
}

// ------------------------------------------------------------------ materials
// Colour-grade an outfit texture toward a class tint while keeping its detail.
function gradeMaterial(mat, tint, amt) {
  const m = mat.clone();
  m.userData.grade = { tint: new THREE.Color(...tint), amt };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTint = { value: m.userData.grade.tint }; sh.uniforms.uAmt = { value: amt };
    sh.fragmentShader = 'uniform vec3 uTint; uniform float uAmt;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      { float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 graded = uTint * (0.35 + l * 1.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, graded, uAmt); }`);
  };
  m.customProgramCacheKey = () => 'grade' + tint.join(',') + amt;
  return m;
}

function metalMat(color, rough = 0.35, metal = 1) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, map: TEX.metal.map, normalMap: TEX.metal.normalMap, roughnessMap: TEX.metal.arm, metalnessMap: TEX.metal.arm, envMapIntensity: 1.2 });
}
function woodMat(color = 0x6a4a32) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, map: TEX.wood.map, normalMap: TEX.wood.normalMap, normalScale: new THREE.Vector2(0.6, 0.6) });
}
function glowMat(color, intensity = 3) { return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.2, metalness: 0 }); }
function addGlow(color, opacity = 0.35) { return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }); }

// ------------------------------------------------------------------ weapons (props + crafted)
function propClone(name, gradeTint) {
  const g = GL[name].scene.clone(true);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material = gradeTint ? gradeMaterial(o.material, gradeTint, 0.55) : o.material.clone(); } });
  return g;
}
function makeWeapon(kind, look) {
  if (ARMORY_KINDS.has(kind)) return makeClassWeapon(kind, makeMaterials(TEX), look);
  const g = new THREE.Group();
  let tip = new THREE.Object3D();
  switch (kind) {
    case 'sword': { const s = propClone('Sword_Bronze', [0.62, 0.64, 0.68]); s.rotation.set(0, 0, 0); s.position.set(0, -0.12, 0); g.add(s); tip.position.set(0, 0.95, 0); break; }
    case 'shield': { const s = propClone('Shield_Wooden', [0.36, 0.24, 0.18]); g.add(s); break; }
    case 'axe': case 'axeL': { const s = propClone('Axe_Bronze', look.axeTint || null); s.position.set(0, -0.2, 0); g.add(s); tip.position.set(0, 0.6, 0); break; }
    case 'daggerR': case 'daggerL': {
      const shape = new THREE.Shape(); shape.moveTo(-0.022, 0); shape.lineTo(0.022, 0); shape.lineTo(0.016, 0.24); shape.lineTo(0, 0.31); shape.lineTo(-0.016, 0.24); shape.lineTo(-0.022, 0);
      const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 1 }), new THREE.MeshStandardMaterial({ color: 0xb8bec8, roughness: 0.22, metalness: 1, envMapIntensity: 1.5 }));
      blade.position.set(0, 0.06, -0.003); blade.castShadow = true; g.add(blade);
      const edge = new THREE.Mesh(blade.geometry, addGlow(0x6aff4a, 0.25)); edge.position.copy(blade.position); edge.scale.set(1.15, 1.02, 1.6); g.add(edge);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.018, 0.028), metalMat(0x2a2a30, 0.4)); guard.position.y = 0.055; g.add(guard);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.11, 8), new THREE.MeshStandardMaterial({ color: 0x1e1612, roughness: 0.9 })); grip.position.y = 0; g.add(grip);
      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), metalMat(0x2a2a30, 0.4)); pommel.position.y = -0.06; g.add(pommel);
      tip.position.set(0, 0.37, 0); break; }
    case 'staff': {
      const pts = []; for (let i = 0; i <= 10; i++) { const u = i / 10; pts.push(new THREE.Vector3(Math.sin(u * 7) * 0.018, -0.55 + u * 1.75, Math.cos(u * 5) * 0.015)); }
      const shaft = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.024, 7), woodMat(0x5a4030)); shaft.castShadow = true; g.add(shaft);
      // twisted wooden claws cradling the crystal
      for (let k = 0; k < 3; k++) {
        const a = k / 3 * Math.PI * 2, cp = [];
        for (let i = 0; i <= 6; i++) { const u = i / 6; cp.push(new THREE.Vector3(Math.sin(a) * (0.03 + Math.sin(u * Math.PI) * 0.09), 1.12 + u * 0.3, Math.cos(a) * (0.03 + Math.sin(u * Math.PI) * 0.09))); }
        g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cp), 12, 0.012, 5), woodMat(0x4a3424)));
      }
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), new THREE.MeshPhysicalMaterial({ color: look.glow, emissive: look.glow, emissiveIntensity: 2.2, roughness: 0.05, metalness: 0, clearcoat: 1 }));
      crystal.scale.set(0.8, 1.6, 0.8); crystal.position.y = 1.27; g.add(crystal);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), addGlow(look.glow, 0.18)); halo.position.y = 1.27; g.add(halo);
      g.userData.pulse = halo; g.userData.crystal = crystal;
      tip.position.set(0, 1.27, 0); break; }
    case 'mace': {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.62, 10), woodMat(0x3a2a20)); shaft.position.y = 0.16; g.add(shaft);
      const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.16, 10), new THREE.MeshStandardMaterial({ color: 0x2a1e18, roughness: 0.95 })); wrap.position.y = -0.04; g.add(wrap);
      const gold = metalMat(0xd4a752, 0.3);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), gold); head.position.y = 0.52; head.castShadow = true; g.add(head);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const fl = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.13, 0.07), gold); fl.position.set(Math.sin(a) * 0.065, 0.52, Math.cos(a) * 0.065); fl.rotation.y = a; g.add(fl); }
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), glowMat(look.glow, 3)); core.position.y = 0.6; g.add(core);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), addGlow(look.glow, 0.16)); halo.position.y = 0.55; g.add(halo);
      g.userData.pulse = halo;
      tip.position.set(0, 0.56, 0); break; }
    case 'fireOrb': {
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), glowMat(0xff8a2a, 4)); g.add(core);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), addGlow(0xff6a1a, 0.4)); g.add(halo);
      g.userData.pulse = halo; g.userData.fire = true; break; }
  }
  g.add(tip); g.userData.tip = tip;
  return g;
}

// How each weapon is held, in WORLD terms at the idle pose of a champion facing +Z:
//   dir  = where the weapon's +Y (blade / shaft) points,  side = where its +X points,
//   palm = offset from the bone toward the fingers (m),   up/fwd = extra world offsets.
const ARMORY_KINDS = new Set(['runesword', 'kiteshield', 'warAxe', 'warAxeL', 'greatAxe', 'fang', 'fangL', 'archstaff', 'sunmace', 'stormaxe']);
const GRIP = {
  sword: { bone: 'hand_r', dir: [0, 0.55, 1], side: [-1, 0, 0], palm: 0.085 },
  axe: { bone: 'hand_r', dir: [0, 0.35, 1], side: [-1, 0, 0], palm: 0.085 },
  axeL: { bone: 'hand_l', dir: [0, 0.35, 1], side: [1, 0, 0], palm: 0.085 },
  mace: { bone: 'hand_r', dir: [0, 0.8, 0.6], side: [-1, 0, 0], palm: 0.085 },
  staff: { bone: 'hand_r', dir: [0, 1, 0.12], side: [-1, 0, 0], palm: 0.085 },
  daggerR: { bone: 'hand_r', dir: [0.15, -0.15, 1], side: [-1, 0, 0], palm: 0.08 },
  daggerL: { bone: 'hand_l', dir: [-0.15, -0.15, 1], side: [-1, 0, 0], palm: 0.08 },
  shield: { bone: 'lowerarm_l', dir: [0, 1, 0], side: [0, 0, -1], palm: 0.14, out: [0.14, 0, 0.05] },
  fireOrb: { bone: 'hand_l', dir: [0, 1, 0], side: [1, 0, 0], palm: 0.06, up: 0.05 },
};
Object.assign(GRIP, { runesword: GRIP.sword, kiteshield: GRIP.shield, fang: GRIP.daggerR, fangL: GRIP.daggerL, archstaff: GRIP.staff, sunmace: GRIP.mace, 
  // axes held upright-forward with the cutting edge facing the enemy
  warAxe: { bone: 'hand_r', dir: [0, 0.75, 0.65], side: [0, -0.3, 1], palm: 0.085 }, warAxeL: { bone: 'hand_l', dir: [0, 0.75, 0.65], side: [0, -0.3, 1], palm: 0.085 },
  stormaxe: { bone: 'hand_r', dir: [0, 0.75, 0.65], side: [0, -0.3, 1], palm: 0.085 },
  // two-handed executioner axe: haft up through the fist, blade turned outward so its crescent reads
  greatAxe: { bone: 'hand_r', dir: [0, 0.92, 0.3], side: [-1, 0, 0.35], palm: 0.085 } });
export const GRIPS = GRIP; // exposed for tuning

const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
function solveGrip(wp, bone, gp, bones) {
  const y = _v.set(...gp.dir).normalize();
  const x = _v2.set(...gp.side); x.addScaledVector(y, -x.dot(y)).normalize();
  const z = _v3.crossVectors(x, y).normalize();
  const worldQ = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(x, y, z));
  const boneQ = bone.getWorldQuaternion(_q);
  wp.quaternion.copy(boneQ.clone().invert().multiply(worldQ));
  // position: from the bone toward the fingers (palm), plus optional world offsets
  const bp = bone.getWorldPosition(new THREE.Vector3());
  const child = bone.name.startsWith('hand') ? (bones['middle_01_' + bone.name.slice(-1)] || bone.children[0]) : (bones['hand_' + bone.name.slice(-1)] || bone.children[0]);
  const target = bp.clone();
  if (child) { const cp = child.getWorldPosition(new THREE.Vector3()); target.addScaledVector(cp.sub(bp).normalize(), gp.palm); }
  if (gp.up) target.y += gp.up;
  if (gp.out) target.add(new THREE.Vector3(...gp.out));
  const local = bone.worldToLocal(target.clone());
  wp.position.copy(local);
  // cancel any bone scale (skeletons exported from engines often carry 0.01 / 100 factors)
  const s = bone.getWorldScale(new THREE.Vector3());
  wp.scale.set(1 / s.x, 1 / s.y, 1 / s.z);
}

// ------------------------------------------------------------------ champion
export class Character {
  constructor(cls, spec) {
    const lookKey = spec && LOOKS[cls + ':' + spec] ? cls + ':' + spec : cls;
    const look = LOOKS[lookKey] || LOOKS.warrior;
    this.cls = cls; this.spec = spec; this.lookKey = lookKey; this.look = look;
    this.act = null; this.opacity = 1; this.time = Math.random() * 10; this.side = 0;
    this.root = new THREE.Group();
    const body = SkeletonUtils.clone(GL[look.outfit].scene);
    body.scale.setScalar(look.scale);
    this.body = body; this.root.add(body);
    this.bones = {};
    body.traverse(o => { if (o.isBone) this.bones[o.name] = o; });
    this.materials = [];
    const skinMats = new Map();
    const skin = m => { if (!skinMats.has(m)) { const c = m.clone(); c.color.setRGB(...look.skinTint); skinMats.set(m, c); } return skinMats.get(m); };
    // outfit meshes: grade cloth, keep skin, hide parts
    body.traverse(o => {
      if (!o.isSkinnedMesh) return;
      o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true;
      if (look.hide.some(h => o.name.includes(h))) { o.visible = false; return; }
      const isSkin = /Regular|Superhero/i.test(o.material.name);
      if (/Hair|Eye/i.test(o.material.name)) { o.material = o.material.clone(); if (cls === 'berserker' && /Hair/i.test(o.material.name)) o.material.color.setRGB(0.16, 0.1, 0.07); return; }
      o.material = isSkin ? skin(o.material) : gradeMaterial(o.material, look.tint, look.tintAmt);
    });
    // transplant head (+ eyes) and hair onto the outfit skeleton
    const holder = body.children.find(c => c.isSkinnedMesh)?.parent || body;
    const attach = (srcMesh, geo, mat) => {
      const m = new THREE.SkinnedMesh(geo, mat);
      m.name = srcMesh.name; m.frustumCulled = false; m.castShadow = true;
      m.position.copy(srcMesh.position); m.quaternion.copy(srcMesh.quaternion); m.scale.copy(srcMesh.scale);
      holder.add(m);
      const bones = srcMesh.skeleton.bones.map(b => this.bones[b.name]);
      m.bind(new THREE.Skeleton(bones, srcMesh.skeleton.boneInverses), srcMesh.bindMatrix);
      return m;
    };
    if (look.head) for (const h of HEADS[look.head]) attach(h.src, h.geo, /Eye/i.test(h.src.name) ? h.src.material : skin(h.src.material));
    // extra clothing pieces borrowed from other outfits (e.g. trousers + boots on a bare body)
    for (const part of look.parts || []) GL[part.src].scene.traverse(o => {
      if (o.isSkinnedMesh && part.only.some(n => o.name.includes(n))) attach(o, o.geometry, gradeMaterial(o.material, look.tint, look.tintAmt));
    });
    for (const hn of look.hair) GL[hn].scene.traverse(o => { if (o.isSkinnedMesh) { const mat = o.material.clone(); if (cls === 'mage') mat.color.setRGB(0.75, 0.75, 0.78); if (cls === 'shaman') mat.color.setRGB(0.35, 0.25, 0.2); if (cls === 'berserker') mat.color.setRGB(0.16, 0.1, 0.07); attach(o, o.geometry, mat); } });
    // weapons: grips are solved from the hand's pose in the idle clip, so a weapon points
    // the intended world direction at rest and then simply follows the hand bone.
    this.weapons = {};
    this.mixer0 = new THREE.AnimationMixer(body);
    const rest = this.mixer0.clipAction(CLIPS[look.idle].full); rest.play(); this.mixer0.update(0.01);
    this.root.updateMatrixWorld(true);
    for (const w of look.weapons) {
      const wp = makeWeapon(w, look), gp = GRIP[w];
      const bone = this.bones[gp.bone] || this.bones.hand_r;
      solveGrip(wp, bone, gp, this.bones);
      if (look.weaponScale) wp.scale.multiplyScalar(look.weaponScale);
      bone.add(wp);
      this.weapons[w] = wp;
    }
    // class armor, fitted to this body in the same rest pose
    this.armor = equipArmor(this, cls, makeMaterials(TEX), spec);
    rest.stop(); this.mixer0.uncacheRoot(body); this.mixer0 = null;
    if (look.halo) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.008, 6, 40), glowMat(0xffe2a0, 2.5));
      const glowR = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 40), addGlow(0xffd27a, 0.22));
      const h = new THREE.Group(); h.add(ring, glowR); h.position.set(0, 0.26, -0.06); h.rotation.x = Math.PI / 2 - 0.25;
      this.bones.Head.add(h); this.halo = h;
    }
    this.root.traverse(o => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const mm of ms) if (!this.materials.includes(mm)) { mm.userData.baseOpacity = mm.opacity; mm.userData.baseTransparent = mm.transparent; this.materials.push(mm); } } });

    // ---- animation
    this.mixer = new THREE.AnimationMixer(body);
    this.actions = {};
    this.loco = { name: null, prev: null, fade: 1 };
    this.cur = null;   // active one-shot { kind, name, t, dur, full, weight }
    this.deadT = 0; this.vic = false; this.hitT = 0; this.hitBig = 0;
    const W = this.weapons, tipOf = k => W[k] && (W[k].userData.tip || W[k]);
    this.focus = ['archstaff', 'sunmace', 'fireOrb', 'stormaxe', 'runesword', 'warAxe', 'greatAxe', 'fang'].map(tipOf).find(Boolean) || this.bones.hand_r;
    this.tipR = ['runesword', 'warAxe', 'greatAxe', 'fang', 'stormaxe', 'sunmace', 'archstaff'].map(k => W[k]?.userData.tip).find(Boolean);
    this.tipL = (W.fangL || W.warAxeL)?.userData.tip;
    this.tmpQ = new THREE.Quaternion(); this.tmpE = new THREE.Euler();
    this.setLoco(look.idle, 0);
  }

  // get (or create) an action for clip `name`, part = 'full' | 'upper' | 'lower'
  action(name, part) {
    const key = name + ':' + part;
    if (this.actions[key]) return this.actions[key];
    const c = CLIPS[name]; if (!c) return null;
    const a = this.mixer.clipAction(c[part]);
    a.enabled = true; a.setEffectiveWeight(0); a.play();
    this.actions[key] = a;
    return a;
  }

  setLoco(name, fade = 0.18) {
    if (this.loco.name === name || !CLIPS[name]) return;
    this.loco.prev = this.loco.name; this.loco.name = name; this.loco.fade = fade > 0 ? 0 : 1; this.loco.fadeDur = fade;
    const lo = this.action(name, 'lower'), up = this.action(name, 'upper');
    lo.time = up.time = (this.loco.prev && this.actions[this.loco.prev + ':lower']) ? (this.actions[this.loco.prev + ':lower'].time / CLIPS[this.loco.prev].full.duration) * CLIPS[name].full.duration : 0;
  }

  play(kind, dur = 0.5) {
    if (kind === 'flinch') { this.hit(1); return; }
    const spec = ACTIONS[kind]; if (!spec) return;
    const list = spec[this.lookKey] || spec[this.cls] || spec.any; if (!list) return;
    this.side = 1 - this.side;
    const name = list[this.side % list.length];
    const clip = CLIPS[name]; if (!clip) return;
    if (this.cur) { this.cur.out = true; }
    const full = !!spec.full;
    const a = this.action(name, full ? 'full' : 'upper');
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play();
    // fit the clip into roughly the requested time (attacks follow the swing timer)
    const len = clip.full.duration;
    const want = Math.max(dur, 0.25);
    a.timeScale = Math.max(0.8, Math.min(2.4, len / Math.max(want, len * 0.45)));
    const fullA = full ? null : this.action(name, 'full');
    if (fullA) { fullA.reset(); fullA.setLoop(THREE.LoopOnce, 1); fullA.clampWhenFinished = true; fullA.timeScale = a.timeScale; fullA.play(); }
    this.prevAct = this.cur;
    this.cur = { kind, name, t: 0, len: len / a.timeScale, a, fullA, full, w: 0 };
    this.act = this.cur;
    this.lastSide = this.side;
  }

  hit(strength = 1) {
    if (this.deadT > 0) return;
    this.hitT = 0.3; this.hitBig = strength >= 2 ? 1 : 0;
    if (!this.cur || this.cur.kind === 'hit') {
      const name = strength >= 2 ? 'Hit_Knockback' : Math.random() < 0.5 ? 'Hit_Chest' : 'Hit_Head';
      const a = this.action(name, 'upper'); if (!a) return;
      a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = 1.4; a.play();
      if (this.cur) this.cur.out = true;
      this.cur = { kind: 'hit', name, t: 0, len: CLIPS[name].full.duration / 1.4, a, fullA: null, full: false, w: 0 };
    }
  }

  setOpacity(a) {
    if (Math.abs(a - this.opacity) < 0.01) return;
    this.opacity = a;
    for (const m of this.materials) {
      m.transparent = a < 0.999 || m.userData.baseTransparent;
      m.opacity = m.userData.baseOpacity * a;
      m.depthWrite = a > 0.99 && !m.userData.baseTransparent;
    }
    this.root.visible = a > 0.02;
  }

  // st: { speed, back, strafe, air, casting, castProgress, stunned, disoriented, dead, victory, tempest }
  update(dt, st = {}) {
    this.time += dt;
    const speed = st.speed || 0;
    // ---- choose the locomotion / pose clip
    let loco = this.look.idle, rate = 1;
    if (st.dead) loco = 'Death01';
    else if (st.victory) loco = this.cls === 'warrior' ? 'Sword_Idle' : 'Dance_Loop';
    else if (st.tempest) { loco = 'Sword_Regular_Combo'; rate = 1.6; }
    else if (st.air) loco = 'Jump_Loop';
    else if (speed > 1.12) { loco = 'Sprint_Loop'; rate = speed / 1.3; }
    else if (speed > 0.08) { loco = 'Jog_Fwd_Loop'; rate = Math.max(0.55, speed) * (st.back ? -0.85 : 1); }
    else if (st.casting) loco = this.look.castPose || 'Spell_Simple_Idle_Loop';
    this.setLoco(loco, st.dead ? 0.15 : 0.2);
    const dying = st.dead;
    const deathA = this.actions['Death01:lower'];
    for (const part of ['lower', 'upper']) {
      const a = this.action(this.loco.name, part);
      if (dying) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } else a.setLoop(THREE.LoopRepeat, Infinity);
      a.timeScale = rate;
    }
    if (!dying && deathA) { for (const p of ['lower', 'upper']) { const d = this.actions['Death01:' + p]; if (d && d.time > 0 && this.loco.name !== 'Death01') d.reset(); } }

    // ---- one-shot layer
    const c = this.cur;
    let actW = 0;
    if (c) {
      c.t += dt;
      const fadeIn = 0.08, fadeOut = Math.min(0.2, c.len * 0.35);
      c.w = c.out ? Math.max(0, c.w - dt / 0.12) : c.t < fadeIn ? c.t / fadeIn : c.t > c.len - fadeOut ? Math.max(0, (c.len - c.t) / fadeOut) : 1;
      if (c.t >= c.len || (c.out && c.w <= 0)) { c.a.setEffectiveWeight(0); c.fullA && c.fullA.setEffectiveWeight(0); this.cur = c.out ? this.cur : null; if (this.cur === c) this.cur = null; this.act = this.cur; }
      else actW = c.w;
    }
    if (this.prevAct && this.prevAct !== this.cur) { const p = this.prevAct; p.w = Math.max(0, p.w - dt / 0.1); p.a.setEffectiveWeight(p.w); p.fullA && p.fullA.setEffectiveWeight(0); if (p.w <= 0) this.prevAct = null; }
    // casting holds the spell pose on the upper body even while moving
    const castPose = this.look.castPose || 'Spell_Simple_Idle_Loop';
    const castW = st.casting && !dying && this.loco.name !== castPose ? 1 : 0;
    const castA = this.action(castPose, 'upper');
    this.castW = (this.castW || 0) + (castW - (this.castW || 0)) * Math.min(1, dt * 10);

    // ---- weights
    const L = this.loco;
    if (L.fade < 1) L.fade = Math.min(1, L.fade + dt / Math.max(0.01, L.fadeDur));
    const stillFull = c && !c.full && speed < 0.08 && !st.air && !dying; // standing: let the action drive the legs too
    for (const [key, a] of Object.entries(this.actions)) {
      const [name, part] = key.split(':');
      if (c && a === c.a) continue; if (c && a === c.fullA) continue;
      if (this.prevAct && (a === this.prevAct.a)) continue;
      if (a === castA && part === 'upper') continue;
      let w = 0;
      if (name === L.name) w = L.fade; else if (name === L.prev) w = 1 - L.fade;
      if (part === 'upper') w *= (1 - actW) * (1 - this.castW);
      if (part === 'lower' && c && (c.full || stillFull)) w *= (1 - actW);
      a.setEffectiveWeight(w);
    }
    castA.setEffectiveWeight(this.castW * (1 - actW));
    if (c) {
      c.a.setEffectiveWeight(actW);
      if (c.fullA) {
        // full-body copy only drives the legs while standing still
        const lowerOnly = stillFull ? actW : 0;
        c.fullA.setEffectiveWeight(lowerOnly * 0.999);
      }
    }
    this.mixer.update(dt);

    // ---- procedural layers on top of the animation
    const b = this.bones;
    if (st.tempest) this.body.rotation.y += dt * 16; else this.body.rotation.y += (this.strafeYaw(st) - this.body.rotation.y) * Math.min(1, dt * 10);
    if (st.stunned && !dying) { this.addRot(b.Head, 0.45 + Math.sin(this.time * 3) * 0.12, 0, Math.sin(this.time * 2) * 0.2); this.addRot(b.spine_03, 0.25, 0, 0); }
    if (st.disoriented && !dying) { this.addRot(b.Head, -0.2, Math.sin(this.time * 2.4) * 0.5, 0); this.addRot(b.spine_02, 0, Math.sin(this.time * 2.4) * 0.25, 0); }
    if (this.hitT > 0) { this.hitT -= dt; const k = Math.max(0, this.hitT / 0.3); this.addRot(b.spine_02, -0.25 * k * (1 + this.hitBig), 0, 0); }
    if (st.casting && b.hand_r) { this.addRot(b.spine_03, -0.05, 0, 0); }
    // props
    const T = this.time;
    for (const w of Object.values(this.weapons)) {
      if (w.userData.pulse) w.userData.pulse.scale.setScalar(1 + Math.sin(T * 4) * 0.12 + (st.casting ? 0.7 : 0));
      if (w.userData.crystal) w.userData.crystal.rotation.y += dt * 1.5;
      if (w.userData.spin) { w.userData.spin.rotation.y += dt * 1.8; w.userData.spin.rotation.z = Math.sin(T * 0.7) * 0.3; }
      if (w.userData.drop) w.userData.drop.position.y = 0.4 - ((T * 0.6) % 1) * 0.12;
      if (w.userData.fire) w.scale.setScalar(0.85 + Math.sin(T * 13) * 0.12 + Math.sin(T * 7) * 0.08);
    }
    if (this.halo) this.halo.rotation.z += dt * 0.6;
    if (this.armor) this.armor.update(dt, st, this.time);
  }

  // turn the body toward the strafe direction while running sideways (no strafe clips in the kit)
  strafeYaw(st) { return st.strafe && (st.speed || 0) > 0.08 && !st.back ? -st.strafe * 0.7 : 0; }

  addRot(bone, x, y, z) {
    if (!bone) return;
    this.tmpE.set(x, y, z); this.tmpQ.setFromEuler(this.tmpE);
    bone.quaternion.multiply(this.tmpQ);
  }

  focusWorld(out = new THREE.Vector3()) { return (this.focus || this.root).getWorldPosition(out); }
  weaponTipWorld(out = new THREE.Vector3()) { const o = (this.lastSide === 1 && this.tipL) ? this.tipL : (this.tipR || this.bones.hand_r); return o.getWorldPosition(out); }
}
