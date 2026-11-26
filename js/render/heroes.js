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
import { makeFormModel } from './minions.js';
import { applyRace, RACES, RACE_OF } from './races.js';
import { consolidate } from './consolidate.js';
import { CHAMPION_MODELS, RACE_HEIGHT, championModel, loadChampion, setRetargetSource, analyse, retargetClip } from './champions.js';
import { validSpec } from '../data/classes.js';

// Rim light for champions: a cheap view-dependent fresnel glow added to the emissive term of any
// material that defines USE_RIM, so every silhouette reads clearly against the arena at any distance.
THREE.ShaderChunk.emissivemap_fragment += `
#ifdef USE_RIM
  { float rimV = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0); totalEmissiveRadiance += RIM_COLOR * (rimV * rimV * rimV); }
#endif`;
export function addRim(m, color = 'vec3(0.34, 0.33, 0.38)') { if (!m || m.isMeshBasicMaterial || m.isSpriteMaterial || (m.defines && m.defines.USE_RIM !== undefined)) return; m.defines = { ...(m.defines || {}), USE_RIM: '', RIM_COLOR: color }; m.needsUpdate = true; }

const M = 'assets/models/', P = 'assets/props/', TX = 'assets/tex/';
const GL = {};        // loaded glTFs by name
const CLIPS = {};     // clip name -> { full, upper, lower }
let TEX = null;       // shared PBR textures for procedural weapons
let ready = false;
let LOWER = null;     // lower-body bone names (for the upper / lower clip split)

// ------------------------------------------------------------------ class looks
// Every class has a fixed race (races.js bakes its proportions and face); every spec has its own
// look: base outfit, hair, skin, weapons and (in outfits.js) a complete equipment set of its own.
//   outfit/head/parts: CC0 body pieces   hide: outfit meshes to drop   tint/tintAmt: cloth colour grade
//   skinTint: race skin colour            hair/hairTint: hair meshes     weapons: hand props   idle: stance clip
const ORC_SKIN = [0.42, 0.62, 0.3], ELF_SKIN = [1.0, 0.88, 0.8], DWARF_SKIN = [1.0, 0.76, 0.64];
const LOOKS = {
  // Sun Elf magisters: slender, long platinum hair, glowing eyes
  mage: { outfit: 'Male_Ranger', head: 'Superhero_Male_FullBody', hair: ['Hair_Long'], hairTint: [0.92, 0.88, 0.74], hide: ['Head_Hood', 'Acc_Pauldron'],
    tint: [0.12, 0.18, 0.48], tintAmt: 0.82, skinTint: ELF_SKIN, scale: 1.0, weapons: ['frostwand', 'tome'], idle: 'Idle_Loop', glow: 0x7fd0ff },
  // Human rogue: hooded black leathers
  rogue: { outfit: 'Female_Ranger', head: 'Superhero_Female_FullBody', hair: [], hide: ['Head_Hood', 'Acc_Pauldron'],
    tint: [0.12, 0.1, 0.15], tintAmt: 0.85, skinTint: [0.95, 0.86, 0.8], scale: 0.98, weapons: ['fang', 'fangL'], idle: 'Crouch_Idle_Loop' },
  // Orc warrior: green skin, heavy black-iron plate, cleaver and spiked round shield
  warrior: { outfit: 'Male_Ranger', head: 'Superhero_Male_FullBody', hair: [], hide: ['Head_Hood', 'Acc_Pauldron'],
    tint: [0.2, 0.17, 0.15], tintAmt: 0.75, skinTint: ORC_SKIN, scale: 1.08, weapons: ['orcaxe', 'orcshield'], idle: 'Idle_Shield_Loop' },
  // Dwarf berserker: bare-chested slayer with a blazing crest and beard
  berserker: { outfit: 'Superhero_Male_FullBody', head: null, parts: [{ src: 'Male_Peasant', only: ['Legs', 'Feet'] }], hair: [], hairTint: [0.86, 0.32, 0.07], hide: [],
    tint: [0.22, 0.16, 0.12], tintAmt: 0.65, skinTint: DWARF_SKIN, scale: 1.0, weapons: ['warAxe', 'warAxeL'], idle: 'Sword_Idle', weaponScale: 1.0, axeTint: [0.5, 0.48, 0.46] },
  // Human paladin: gilded plate and a two-handed sun hammer
  paladin: { outfit: 'Male_Ranger', head: 'Superhero_Male_FullBody', hair: ['Hair_Beard'], hairTint: [0.36, 0.24, 0.12], hide: ['Head_Hood', 'Acc_Pauldron'],
    tint: [0.8, 0.74, 0.6], tintAmt: 0.7, skinTint: [1, 0.9, 0.82], scale: 1.06, weapons: ['sunhammer'], idle: 'Sword_Idle', glow: 0xffe08a },
  // Human priest: vestments and a radiant mace
  priest: { outfit: 'Female_Peasant', head: 'Superhero_Female_FullBody', hair: ['Hair_Buns'], hide: [],
    tint: [0.9, 0.85, 0.72], tintAmt: 0.72, skinTint: [1, 0.96, 0.94], scale: 1.0, weapons: ['sunmace'], idle: 'Idle_Loop', halo: true, glow: 0xffd98a },
  // Orc shaman: brown-green skin, long black hair, fur and bone
  shaman: { outfit: 'Male_Peasant', head: 'Superhero_Male_FullBody', hair: ['Hair_Long'], hairTint: [0.08, 0.06, 0.05], hide: ['Arms_1'],
    tint: [0.4, 0.3, 0.2], tintAmt: 0.6, skinTint: [0.5, 0.6, 0.32], scale: 1.06, weapons: ['stormmace', 'relic'], idle: 'Idle_Loop', glow: 0x4ad8ff },
  // Jungle troll hunter: tall, blue-green skin
  hunter: { outfit: 'Male_Ranger', head: 'Superhero_Male_FullBody', hair: [], hide: ['Head_Hood', 'Acc_Pauldron'],
    tint: [0.28, 0.3, 0.22], tintAmt: 0.6, skinTint: [0.42, 0.62, 0.66], scale: 1.1, weapons: ['bow'], idle: 'Idle_Loop', hairTint: [0.62, 0.12, 0.08] },
  // Undead necromancer: grey-green skin, hooded grave robes
  necromancer: { outfit: 'Male_Ranger', head: 'Superhero_Male_FullBody', hair: [], hide: ['Head_Hood', 'Acc_Pauldron'],
    tint: [0.14, 0.17, 0.13], tintAmt: 0.85, skinTint: [0.55, 0.62, 0.5], scale: 1.0, weapons: ['bonestaff'], idle: 'Idle_Loop', glow: 0x7aff6a },
  // Bull-folk druid: huge, brown fur; hooves instead of boots
  druid: { outfit: 'Superhero_Male_FullBody', head: null, parts: [{ src: 'Male_Peasant', only: ['Legs'] }], hair: [], hide: [],
    tint: [0.3, 0.24, 0.14], tintAmt: 0.6, skinTint: [0.52, 0.36, 0.24], scale: 1.12, weapons: ['druidstaff'], idle: 'Idle_Loop', glow: 0x8ad86a, hairTint: [0.18, 0.11, 0.07] },
};
// spec looks ("class:spec"): overrides on top of the class look
LOOKS['mage:fire'] = { ...LOOKS.mage, tint: [0.44, 0.1, 0.06], hairTint: [0.95, 0.62, 0.3], weapons: ['firewand', 'tome'], glow: 0xff7a2a };
LOOKS['rogue:assassination'] = { ...LOOKS.rogue, hair: ['Hair_Buns'], hairTint: [0.32, 0.08, 0.05], tint: [0.1, 0.18, 0.08], tintAmt: 0.85 };
LOOKS['warrior:arms'] = { ...LOOKS.warrior, outfit: 'Superhero_Male_FullBody', head: null, parts: [{ src: 'Male_Peasant', only: ['Legs', 'Feet'] }], hide: [], weapons: ['greatAxe'], axeStyle: 'orc', idle: 'Sword_Idle', tint: [0.3, 0.2, 0.16] };
LOOKS['berserker:executioner'] = { ...LOOKS.berserker, hairTint: [0.1, 0.08, 0.07], beardLen: 0.42, weapons: ['greatAxe'], weaponScale: 1.0, tint: [0.14, 0.12, 0.11], tintAmt: 0.75, castPose: 'Sword_Block' }; // castPose: Skullsplitter wind-up
LOOKS['paladin:protection'] = { ...LOOKS.paladin, weapons: ['holysword', 'towershield'], idle: 'Idle_Shield_Loop', tint: [0.3, 0.36, 0.52] };
LOOKS['priest:shadow'] = { ...LOOKS.priest, hair: [], tint: [0.26, 0.14, 0.36], tintAmt: 0.82, halo: false, glow: 0xa060ff, voidOrb: true };
LOOKS['shaman:enhancement'] = { ...LOOKS.shaman, hair: [], weapons: ['stormaxe', 'stormaxeL'], idle: 'Sword_Idle', tint: [0.3, 0.34, 0.4], glow: 0x9ae8ff };
LOOKS['hunter:sharpshooter'] = { ...LOOKS.hunter, weapons: ['longbow'], idle: 'Idle_Loop', tint: [0.24, 0.2, 0.16] };
LOOKS['necromancer:curser'] = { ...LOOKS.necromancer, tint: [0.15, 0.1, 0.2], glow: 0xb070ff };
LOOKS['druid:feral'] = { ...LOOKS.druid, weapons: [] };
// undead summons (minions)
LOOKS.ghoul = { outfit: 'Male_Peasant', head: 'Superhero_Male_FullBody', hair: [], hide: [], tint: [0.2, 0.24, 0.16], tintAmt: 0.8, skinTint: [0.5, 0.6, 0.42], scale: 0.95, weapons: [], idle: 'Zombie_Idle_Loop', walk: 'Zombie_Walk_Fwd_Loop', noArmor: true, race: 'undead' };
LOOKS.abomination = { ...LOOKS.ghoul, outfit: 'Superhero_Male_FullBody', head: null, parts: [{ src: 'Male_Peasant', only: ['Legs', 'Feet'] }], skinTint: [0.55, 0.66, 0.46], scale: 1.4, race: 'orc' };

// one-shot actions: kind -> per-class clip list (alternated) + whether it should use the full body
const ACTIONS = {
  attack: { 'berserker:executioner': ['TreeChopping_Loop'], 'warrior:arms': ['TreeChopping_Loop'], paladin: ['TreeChopping_Loop'], 'paladin:protection': ['Sword_Regular_A', 'Sword_Regular_B'], 'shaman:enhancement': ['Sword_Regular_A', 'Sword_Regular_B'], berserker: ['Sword_Regular_A', 'Sword_Regular_B'], warrior: ['Sword_Regular_A', 'Sword_Regular_B'], rogue: ['Punch_Jab', 'Punch_Cross'], mage: ['Spell_Simple_Shoot'], priest: ['Spell_Simple_Shoot'], shaman: ['Spell_Simple_Shoot'], hunter: ['Pistol_Shoot'], necromancer: ['Spell_Simple_Shoot'], druid: ['Spell_Simple_Shoot'], ghoul: ['Zombie_Scratch'], abomination: ['Zombie_Scratch'] },
  slash: { any: ['Sword_Regular_A', 'Sword_Regular_B'], rogue: ['Punch_Cross'] },
  stab: { any: ['Punch_Cross', 'Punch_Jab'] },
  finisher: { any: ['Sword_Attack'], rogue: ['Melee_Hook'], berserker: ['Sword_Regular_C'], paladin: ['Sword_Regular_C'], 'paladin:protection': ['Sword_Attack'], 'berserker:executioner': ['Sword_Attack'], 'warrior:arms': ['Sword_Attack'] },
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
  for (const t of clip.tracks) { const bone = t.name.slice(0, t.name.lastIndexOf('.')); (lowerSet.has(bone) || lowerSet.has(bone.toLowerCase()) ? lower : upper).push(t); }
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
  // generated champion models (champions.js): retargeted from the UAL-skinned base body; a failed file falls back
  setRetargetSource(GL.Male_Ranger.scene);
  LOADER = new GLTFLoader(); // champion GLBs stream in afterwards (preloadChampions), so startup stays fast
  // lower-body bone set (pelvis and both legs, recursively)
  const lowerSet = new Set();
  GL.Male_Ranger.scene.traverse(o => { if (o.isBone && LOWER_ROOTS.includes(o.name)) o.traverse(c => { if (c.isBone && !c.name.startsWith('spine') ) lowerSet.add(c.name); }); });
  // spine chain must not be classified lower even though it's under pelvis
  GL.Male_Ranger.scene.traverse(o => { if (o.isBone && o.name === 'spine_01') o.traverse(c => lowerSet.delete(c.name)); });
  for (const clip of [...GL.UAL1.animations, ...GL.UAL2.animations]) { const c = cleanClip(clip); CLIPS[clip.name] = splitClip(c, lowerSet); CLIPS[clip.name].clean = c; }
  LOWER = new Set([...lowerSet, ...[...lowerSet].map(n => n.toLowerCase())]);
  const tl = new THREE.TextureLoader(manager);
  TEX = { wood: texSet(tl, 'weathered_planks', 0.6), metal: texSet(tl, 'rusty_metal_02', 0.5) };
  prepareHeads();
  ready = true;
}
export const heroesReady = () => ready;
let LOADER = null;
// Stream the generated champion models in the background, one at a time, `first` keys first. A champion
// whose model has not arrived yet is built the old way for that match.
export async function preloadChampions(first = []) {
  if (!LOADER) return;
  const keys = [...new Set([...first.filter(k => CHAMPION_MODELS[k]), ...Object.keys(CHAMPION_MODELS)])];
  for (const k of keys) await loadChampion(LOADER, k);
}
export const loadChampionNow = key => (LOADER ? loadChampion(LOADER, key) : Promise.resolve(null));

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
export function makeWeapon(kind, look) {
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
export const ARMORY_KINDS = new Set(['orcaxe', 'longbow', 'frostwand', 'firewand', 'tome', 'stormmace', 'relic', 'sunhammer', 'holysword', 'towershield', 'cleaver', 'orcshield', 'flamestaff', 'runesword', 'kiteshield', 'warAxe', 'warAxeL', 'greatAxe', 'greatsword', 'stormaxeL', 'bow', 'crossbow', 'bonestaff', 'druidstaff', 'fang', 'fangL', 'archstaff', 'sunmace', 'stormaxe']);
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
Object.assign(GRIP, { runesword: GRIP.sword, kiteshield: GRIP.shield, holysword: GRIP.sword, towershield: GRIP.shield, cleaver: GRIP.sword, orcshield: GRIP.shield, flamestaff: GRIP.staff,
  sunhammer: { bone: 'hand_r', dir: [0, 0.92, 0.3], side: [-1, 0, 0.35], palm: 0.085 }, fang: GRIP.daggerR, fangL: GRIP.daggerL, archstaff: GRIP.staff, sunmace: GRIP.mace, 
  // axes held upright-forward with the cutting edge facing the enemy
  warAxe: { bone: 'hand_r', dir: [0, 0.75, 0.65], side: [0, -0.3, 1], palm: 0.085 }, warAxeL: { bone: 'hand_l', dir: [0, 0.75, 0.65], side: [0, -0.3, 1], palm: 0.085 },
  stormaxe: { bone: 'hand_r', dir: [0, 0.75, 0.65], side: [0, -0.3, 1], palm: 0.085 },
  // two-handed executioner axe: haft up through the fist, blade turned outward so its crescent reads
  greatAxe: { bone: 'hand_r', dir: [0, 0.92, 0.3], side: [-1, 0, 0.35], palm: 0.085 },
  greatsword: { bone: 'hand_r', dir: [0, 0.92, 0.3], side: [-1, 0, 0.35], palm: 0.085 },
  stormaxeL: { bone: 'hand_l', dir: [0, 0.75, 0.65], side: [0, -0.3, 1], palm: 0.085 },
  frostwand: { bone: 'hand_r', dir: [0, 0.6, 0.8], side: [-1, 0, 0], palm: 0.075 }, firewand: { bone: 'hand_r', dir: [0, 0.6, 0.8], side: [-1, 0, 0], palm: 0.075 },
  tome: { bone: 'hand_l', dir: [0, 1, 0.1], side: [1, 0, 0.25], palm: 0.06 }, relic: { bone: 'hand_l', dir: [0, 1, 0.2], side: [1, 0, 0], palm: 0.07 },
  stormmace: { bone: 'hand_r', dir: [0, 0.8, 0.6], side: [-1, 0, 0], palm: 0.085 },
  bow: { bone: 'hand_l', dir: [0, 1, 0.08], side: [0, 0, 1], palm: 0.07 }, longbow: { bone: 'hand_l', dir: [0, 1, 0.08], side: [0, 0, 1], palm: 0.07 }, orcaxe: { bone: 'hand_r', dir: [0, 0.75, 0.65], side: [0, -0.3, 1], palm: 0.085 }, crossbow: { bone: 'hand_r', dir: [0, 0.05, 1], side: [-1, 0, 0], palm: 0.07 },
  bonestaff: { bone: 'hand_r', dir: [0, 1, 0.12], side: [-1, 0, 0], palm: 0.085 }, druidstaff: { bone: 'hand_r', dir: [0, 1, 0.12], side: [-1, 0, 0], palm: 0.085 } });
export const GRIPS = GRIP; // exposed for tuning
export let TROLL_KNEE = -0.22; // knee crouch for jungle trolls (bone-local X in the base skeleton's axes)
export const setTrollKnee = v => { TROLL_KNEE = v; };
// generated champions (champions.js) have their own sculpted forearms and gauntlets: shields are fitted to
// the measured arm instead of a fixed grip (fitShield)
const SHIELDS = new Set(['shield', 'orcshield', 'kiteshield', 'towershield']);
const GRIP_GEN = {};

// Strap a shield along the OUTER side of the left forearm, held by the fist behind it: measure the skinned
// forearm + hand + fingers in the rest pose, then place the shield's back just outside that surface.
function fitShield(ch, wp) {
  const B = ch.bones, el = B.lowerarm_l, wr = B.hand_l; if (!el || !wr) return null;
  const E = el.getWorldPosition(new THREE.Vector3()), W = wr.getWorldPosition(new THREE.Vector3());
  const a = W.clone().sub(E), len = a.length(); a.normalize();
  const C = (B.spine_03 || B.spine_02 || B.pelvis).getWorldPosition(new THREE.Vector3());
  const n = E.clone().lerp(W, 0.5).sub(C); n.addScaledVector(a, -n.dot(a)).normalize(); // away from the body
  let t = 0.04;
  const ARM = /^(lowerarm|hand|index|middle|ring|pinky|thumb)(_twist_\d+)?(_\d+|_metacarpal)?_l$/i;
  ch.body.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const set = new Set(o.skeleton.bones.map((b, i) => ARM.test(b.name) ? i : -1).filter(i => i >= 0)); if (!set.size) return;
    const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight, p = new THREE.Vector3();
    for (let v = 0; v < si.count; v++) {
      let w = 0; for (let k = 0; k < 4; k++) if (set.has(si.getComponent(v, k))) w += sw.getComponent(v, k);
      if (w < 0.5) continue;
      o.getVertexPosition(v, p); p.applyMatrix4(o.matrixWorld).sub(E);
      const ax = p.dot(a); if (ax < -0.1 * len || ax > 1.6 * len) continue;
      t = Math.max(t, p.addScaledVector(a, -ax).dot(n));
    }
  });
  const box = new THREE.Box3().setFromObject(wp), back = Math.max(0.01, -box.min.z); // shield face is local +Z
  const centre = E.clone().addScaledVector(a, len * 0.82).addScaledVector(n, t + back + 0.012);
  const y = a.clone(), z = n.clone(), x = new THREE.Vector3().crossVectors(y, z).normalize();
  y.crossVectors(z, x).normalize();
  const worldQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  wp.quaternion.copy(el.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldQ));
  wp.position.copy(el.worldToLocal(centre));
  const s = el.getWorldScale(new THREE.Vector3()); wp.scale.set(1 / s.x, 1 / s.y, 1 / s.z);
  return el;
}

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
    // a generated model for this spec (champions.js) replaces body, race and code armor
    let ck = null; try { ck = cls + ':' + validSpec(cls, spec); } catch (e) { ck = null; }
    const champ = ck && championModel(ck);
    this.race = look.race || RACE_OF[cls] || 'human'; this.raceDef = RACES[this.race] || RACES.human;
    this.materials = [];
    let body;
    if (champ) body = this.buildGenerated(champ, look);
    else {
    body = SkeletonUtils.clone(GL[look.outfit].scene);
    body.scale.setScalar(look.scale);
    this.body = body; this.root.add(body);
    this.bones = {};
    body.traverse(o => { if (o.isBone) this.bones[o.name] = o; });
    const skinMats = new Map();
    const skin = m => { if (!skinMats.has(m)) { const c = m.clone(); c.color.setRGB(...look.skinTint); skinMats.set(m, c); this.skinMat = this.skinMat || c; } return skinMats.get(m); };
    const gradedMats = new Map(); // one graded copy per source material, so the pieces can merge into one draw
    const graded = m => { if (!gradedMats.has(m)) gradedMats.set(m, gradeMaterial(m, look.tint, look.tintAmt)); return gradedMats.get(m); };
    // outfit meshes: grade cloth, keep skin, hide parts
    body.traverse(o => {
      if (!o.isSkinnedMesh) return;
      o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true;
      if (look.hide.some(h => o.name.includes(h))) { o.visible = false; return; }
      const isSkin = /Regular|Superhero/i.test(o.material.name);
      if (/Hair|Eye/i.test(o.material.name)) { o.material = o.material.clone(); if (look.hairTint && /Hair/i.test(o.material.name)) o.material.color.setRGB(...look.hairTint); return; }
      o.material = isSkin ? skin(o.material) : graded(o.material);
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
      if (o.isSkinnedMesh && part.only.some(n => o.name.includes(n))) attach(o, o.geometry, graded(o.material));
    });
    for (const hn of look.hair) GL[hn].scene.traverse(o => { if (o.isSkinnedMesh) { const mat = o.material.clone(); if (look.hairTint) mat.color.setRGB(...look.hairTint); attach(o, o.geometry, mat); } });
    // RACE: bake the race's proportions and face into this champion's bind pose (see races.js)
    const { lift } = applyRace(this, this.race, look.outfit);
    if (lift) body.position.y -= lift * look.scale;
    }
    // weapons: grips are solved from the hand's pose in the idle clip, so a weapon points
    // the intended world direction at rest and then simply follows the hand bone.
    this.weapons = {};
    this.mixer0 = new THREE.AnimationMixer(body);
    const rest = this.mixer0.clipAction(this.clip(look.idle).full); rest.play(); this.mixer0.update(0.01);
    this.root.updateMatrixWorld(true);
    for (const w of look.weapons) {
      const wp = makeWeapon(w, look), gp = (this.generated && GRIP_GEN[w]) || GRIP[w];
      let bone = (this.generated && SHIELDS.has(w)) ? fitShield(this, wp) : null;
      if (!bone) { bone = this.bones[gp.bone] || this.bones.hand_r; solveGrip(wp, bone, gp, this.bones); }
      if (look.weaponScale) wp.scale.multiplyScalar(look.weaponScale);
      // static weapon parts fold into the champion mesh (consolidate.js); pulsing / spinning parts stay separate
      const U = wp.userData; if (U.fire) U.noMerge = true; else for (const p of [U.pulse, U.crystal, U.spin, U.drop]) if (p) p.userData.noMerge = true;
      bone.add(wp);
      this.weapons[w] = wp;
    }
    // class armor, fitted to this body in the same rest pose
    this.armor = (look.noArmor || champ) ? null : equipArmor(this, cls, makeMaterials(TEX), spec);
    rest.stop(); this.mixer0.uncacheRoot(body); this.mixer0 = null;
    if (look.halo) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.008, 6, 40), glowMat(0xffe2a0, 2.5));
      const glowR = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 40), addGlow(0xffd27a, 0.22));
      const h = new THREE.Group(); h.add(ring, glowR); h.position.set(0, 0.26, -0.06); h.rotation.x = Math.PI / 2 - 0.25;
      const head = this.bones.Head;
      if (this.generated) { // generated rigs: different bone axes and scale — place the ring in world terms above the head
        this.root.updateMatrixWorld(true);
        const hp = head.getWorldPosition(new THREE.Vector3()), top = hp.clone().add(new THREE.Vector3(0, 0.27 * look.scale, -0.05));
        const wq = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.25, 0, 0));
        h.quaternion.copy(head.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(wq));
        h.position.copy(head.worldToLocal(top));
        const s = head.getWorldScale(new THREE.Vector3()); h.scale.set(1 / s.x, 1 / s.y, 1 / s.z);
      }
      head.add(h); this.halo = h; h.userData.noMerge = true;
    }
    // fold the body, outfit, head, hair and rigid armor into one skinned mesh per material (draw calls)
    this.drawGroups = consolidate(this);
    this.root.traverse(o => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const mm of ms) if (!this.materials.includes(mm)) { mm.userData.baseOpacity = mm.opacity; mm.userData.baseTransparent = mm.transparent; this.materials.push(mm); if (!mm.transparent) addRim(mm); } } });

    // ---- animation
    this.mixer = new THREE.AnimationMixer(body);
    this.actions = {};
    this.loco = { name: null, prev: null, fade: 1 };
    this.cur = null;   // active one-shot { kind, name, t, dur, full, weight }
    this.deadT = 0; this.vic = false; this.hitT = 0; this.hitBig = 0;
    const W = this.weapons, tipOf = k => W[k] && (W[k].userData.tip || W[k]);
    this.focus = ['frostwand', 'firewand', 'stormmace', 'relic', 'archstaff', 'flamestaff', 'sunhammer', 'holysword', 'cleaver', 'sunmace', 'fireOrb', 'bonestaff', 'druidstaff', 'crossbow', 'bow', 'longbow', 'orcaxe', 'stormaxe', 'runesword', 'greatsword', 'warAxe', 'greatAxe', 'fang'].map(tipOf).find(Boolean) || this.bones.hand_r;
    this.tipR = ['orcaxe', 'frostwand', 'firewand', 'stormmace', 'runesword', 'sunhammer', 'holysword', 'cleaver', 'greatsword', 'warAxe', 'greatAxe', 'fang', 'stormaxe', 'sunmace', 'archstaff'].map(k => W[k]?.userData.tip).find(Boolean);
    this.tipL = (W.fangL || W.warAxeL || W.stormaxeL)?.userData.tip;
    this.tmpQ = new THREE.Quaternion(); this.tmpE = new THREE.Euler();
    this.setLoco(look.idle, 0);
  }

  // generated champion: clone the rigged GLB, fit it to the base body's height and analyse its rest pose once
  buildGenerated(champ, look) {
    const body = SkeletonUtils.clone(champ.scene);
    if (!champ.fit) {
      const h = new THREE.Box3().setFromObject(champ.scene).getSize(new THREE.Vector3()).y;
      const hs = new THREE.Box3().setFromObject(GL.Male_Ranger.scene).getSize(new THREE.Vector3()).y;
      champ.fit = hs / Math.max(0.01, h);
    }
    this.body = body; this.root.add(body);
    this.bones = {};
    body.traverse(o => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; }
    });
    if (!champ.A) champ.A = analyse(body); // rest-pose frames are scale-free (relative to the body)
    // gameplay code addresses bones by the base skeleton's names (hand_r, spine_03, Head …): alias them
    const byLc = {}; for (const [n, b] of Object.entries(this.bones)) byLc[n.toLowerCase()] = b;
    for (const [s, t] of Object.entries(champ.A.map)) { const b = byLc[t]; if (b) { this.bones[s] = b; if (s === 'head') this.bones.Head = b; } }
    if (byLc.head) this.bones.Head = byLc.head;
    body.scale.setScalar(champ.fit * look.scale * (RACE_HEIGHT[this.race] || 1));
    this.retarget = champ.A; this.clipCache = champ.clips;
    this.generated = true;
    return body;
  }

  // clip set { full, upper, lower } for this champion (retargeted + cached per generated model)
  clip(name) {
    if (!this.retarget) return CLIPS[name];
    const cache = this.clipCache;
    if (name in cache) return cache[name];
    const src = CLIPS[name];
    return (cache[name] = src ? splitClip(retargetClip(src.clean, this.retarget), LOWER) : null);
  }

  // get (or create) an action for clip `name`, part = 'full' | 'upper' | 'lower'
  action(name, part) {
    const key = name + ':' + part;
    if (this.actions[key]) return this.actions[key];
    const c = this.clip(name); if (!c) return null;
    const a = this.mixer.clipAction(c[part]);
    a.enabled = true; a.setEffectiveWeight(0); a.play();
    this.actions[key] = a;
    return a;
  }

  setLoco(name, fade = 0.18) {
    if (this.loco.name === name || !this.clip(name)) return;
    this.loco.prev = this.loco.name; this.loco.name = name; this.loco.fade = fade > 0 ? 0 : 1; this.loco.fadeDur = fade;
    const lo = this.action(name, 'lower'), up = this.action(name, 'upper');
    lo.time = up.time = (this.loco.prev && this.actions[this.loco.prev + ':lower']) ? (this.actions[this.loco.prev + ':lower'].time / this.clip(this.loco.prev).full.duration) * this.clip(name).full.duration : 0;
  }

  play(kind, dur = 0.5) {
    if (kind === 'flinch') { this.hit(1); return; }
    const spec = ACTIONS[kind]; if (!spec) return;
    const list = spec[this.lookKey] || spec[this.cls] || spec.any; if (!list) return;
    this.side = 1 - this.side;
    const name = list[this.side % list.length];
    const clip = this.clip(name); if (!clip) return;
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
      this.cur = { kind: 'hit', name, t: 0, len: this.clip(name).full.duration / 1.4, a, fullA: null, full: false, w: 0 };
    }
  }

  setOpacity(a) {
    if (Math.abs(a - this.opacity) < 0.01) return;
    this.opacity = a;
    // armor materials are shared by every champion: the first fade gives this champion its own copies
    if (a < 0.999 && !this.privateMats) {
      this.privateMats = true; const map = new Map();
      this.root.traverse(o => {
        if (!o.material || Array.isArray(o.material) || !o.material.userData.shared) return;
        let c = map.get(o.material);
        if (!c) { const s = o.material; c = s.clone(); c.userData.shared = false; c.userData.baseOpacity = s.userData.baseOpacity ?? s.opacity; c.userData.baseTransparent = s.userData.baseTransparent ?? s.transparent; map.set(s, c); }
        o.material = c;
      });
      this.materials = this.materials.map(m => map.get(m) || m);
    }
    for (const m of this.materials) {
      m.transparent = a < 0.999 || m.userData.baseTransparent;
      m.opacity = m.userData.baseOpacity * a;
      m.depthWrite = a > 0.99 && !m.userData.baseTransparent;
    }
    this.root.visible = a > 0.02;
  }

  // st: { speed, back, strafe, air, casting, castProgress, stunned, disoriented, dead, victory, tempest }
  update(dt, st = {}) {
    // Druid shapeshift (cat / bear) and Tree of Life: swap the humanoid for a beast / treant model
    const fk = st.tree ? 'tree' : (st.form || null);
    if (fk !== (this.formKey || null)) {
      this.formKey = fk;
      if (this.formModel) { this.root.remove(this.formModel.root); this.formModel = null; }
      if (fk) { this.formModel = makeFormModel(fk); this.root.add(this.formModel.root); }
      this.body.visible = !fk;
    }
    if (this.formModel) this.formModel.update(dt, (st.speed || 0) > 0.1, !!(this.cur && this.cur.t < 0.35 && this.cur.kind !== 'hit'), st);
    this.time += dt;
    const speed = st.speed || 0;
    // ---- choose the locomotion / pose clip
    let loco = this.look.idle, rate = 1;
    if (st.dead) loco = 'Death01';
    else if (st.victory) loco = this.cls === 'warrior' ? 'Sword_Idle' : 'Dance_Loop';
    else if (st.tempest) { loco = 'Sword_Regular_Combo'; rate = 1.6; }
    else if (st.air) loco = 'Jump_Loop';
    else if (speed > 1.12) { loco = 'Sprint_Loop'; rate = speed / 1.3; }
    else if (speed > 0.08) { loco = this.look.walk || 'Jog_Fwd_Loop'; rate = Math.max(0.55, speed) * (st.back ? -0.85 : 1); }
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
    // orcs, trolls, undead and bull-folk lean into the world; the head stays level. Jungle trolls stoop the most:
    // a deep rounded back, head thrust forward and a loose crouch in the knees.
    const troll = this.race === 'troll';
    const hunch = this.raceDef.hunch * (troll ? 1.7 : 1);
    if (hunch && !dying) { this.addRot(b.spine_02, hunch * 0.45, 0, 0); this.addRot(b.spine_03, hunch * 0.55, 0, 0); this.addRot(b.neck_01, -hunch * 0.6, 0, 0); this.addRot(b.Head, -hunch * 0.35, 0, 0); }
    if (this.baseY === undefined) this.baseY = this.body.position.y;
    const crouch = troll && !dying && !st.air;
    this.body.position.y = this.baseY - (crouch ? 0.2 * -TROLL_KNEE * this.look.scale : 0); // keep the feet on the ground
    if (crouch) { const k = TROLL_KNEE; this.addRot(b.thigh_l, k, 0, 0); this.addRot(b.thigh_r, k, 0, 0); this.addRot(b.calf_l, -k * 1.6, 0, 0); this.addRot(b.calf_r, -k * 1.6, 0, 0); this.addRot(b.foot_l, k * 0.6, 0, 0); this.addRot(b.foot_r, k * 0.6, 0, 0); }
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
    // procedural offsets are authored in the base skeleton's bone axes: convert for a generated rig
    const R = this.retarget, n = R && bone.name.toLowerCase();
    if (R && R.postT[n]) this.tmpQ.premultiply(R.postTInv[n]).multiply(R.postT[n]);
    bone.quaternion.multiply(this.tmpQ);
  }

  focusWorld(out = new THREE.Vector3()) { return (this.focus || this.root).getWorldPosition(out); }
  weaponTipWorld(out = new THREE.Vector3()) { const o = (this.lastSide === 1 && this.tipL) ? this.tipL : (this.tipR || this.bones.hand_r); return o.getWorldPosition(out); }
}
