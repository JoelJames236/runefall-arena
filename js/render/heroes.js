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
import { FormController } from './forms.js';
import { applyRace, RACES, RACE_OF } from './races.js';
import { consolidate } from './consolidate.js';
import { CHAMPION_MODELS, RACE_HEIGHT, championModel, loadChampion, setRetargetSource, analyse, retargetClip } from './champions.js';
import { preloadCreatures } from './creatures.js';
import { loadAttackAnims, ANIM_CLIPS, RAW_CLIPS, ATTACK_ANIMS, animSource, loadManifest, MANIFEST_CLIPS, MANIFEST_RAW, clipMeta, clipSource, attacksFor, idleFor, resolveClip, abilityClips } from './attack-anims.js';
export { ANIM_CLIPS }; // for the test harness (cut times)
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
// Dread Knight (Risen): pale undead knight in dark plate, two frost runeblades / a blood-runed greatsword
LOOKS.dreadknight = { outfit: 'Male_Ranger', head: 'Superhero_Male_FullBody', hair: [], hide: ['Head_Hood', 'Acc_Pauldron'],
  tint: [0.16, 0.2, 0.3], tintAmt: 0.8, skinTint: [0.7, 0.76, 0.84], scale: 1.07, weapons: ['runesword', 'runeswordL'], idle: 'Sword_Idle', glow: 0x7ad0ff, race: 'undead', hunch: 0 }; // Risen: upright, no undead stoop
LOOKS['dreadknight:blood'] = { ...LOOKS.dreadknight, weapons: ['greatsword'], tint: [0.22, 0.07, 0.09], glow: 0xff3a4a };
// undead summons (minions)
LOOKS.ghoul = { outfit: 'Male_Peasant', head: 'Superhero_Male_FullBody', hair: [], hide: [], tint: [0.2, 0.24, 0.16], tintAmt: 0.8, skinTint: [0.5, 0.6, 0.42], scale: 0.95, weapons: [], idle: 'Zombie_Idle_Loop', walk: 'Zombie_Walk_Fwd_Loop', noArmor: true, race: 'undead' };
LOOKS.abomination = { ...LOOKS.ghoul, outfit: 'Superhero_Male_FullBody', head: null, parts: [{ src: 'Male_Peasant', only: ['Legs', 'Feet'] }], skinTint: [0.55, 0.66, 0.46], scale: 1.4, race: 'orc' };
// Beastmaster's silverback gorilla (generated model only; without it the pet falls back to the procedural jungle cat).
// ape: a deep forward lean and bent knees on top of the human clips (see Character.update)
LOOKS.gorilla = { outfit: 'Male_Peasant', head: null, hair: [], hide: [], tint: [0.2, 0.2, 0.2], tintAmt: 0.5, skinTint: [0.3, 0.3, 0.3], scale: 1.0, weapons: [], idle: 'Idle_Loop', walk: 'Jog_Fwd_Loop', noArmor: true, race: 'ape', hunch: 0.42, knee: -0.32 };

// one-shot actions: kind -> per-class clip list (alternated) + whether it should use the full body
const ACTIONS = {
  // basic attacks: motions made with Tripo's AI animation for each weapon (attack-anims.js); a list alternates
  attack: { 'berserker:executioner': ['axe2h', 'sweep2h'], 'warrior:arms': ['axe2h', 'sweep2h'], paladin: ['smash2h', 'axe2h'], 'paladin:protection': ['sword_fore', 'sword_back'],
    'shaman:enhancement': ['chop_r', 'chop_l'], berserker: ['chop_r', 'chop_l'], warrior: ['chop_r', 'sword_back'], rogue: ['stab_r', 'hook_l'], mage: ['wand'], priest: ['scepter'], shaman: ['scepter'],
    hunter: ['bow'], necromancer: ['staff'], druid: ['staff'], dreadknight: ['chop_r', 'chop_l'], 'dreadknight:blood': ['axe2h', 'sweep2h'], ghoul: ['Zombie_Scratch'], abomination: ['Zombie_Scratch'], gorilla: ['Punch_Jab', 'Punch_Cross'] },
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

// the library clips basic attacks used before (and still use when assets/models/anims/attacks.json can't load)
const ATTACK_FALLBACK = { 'berserker:executioner': ['TreeChopping_Loop'], 'warrior:arms': ['TreeChopping_Loop'], paladin: ['TreeChopping_Loop'], 'paladin:protection': ['Sword_Regular_A', 'Sword_Regular_B'],
  'shaman:enhancement': ['Sword_Regular_A', 'Sword_Regular_B'], berserker: ['Sword_Regular_A', 'Sword_Regular_B'], warrior: ['Sword_Regular_A', 'Sword_Regular_B'], rogue: ['Punch_Jab', 'Punch_Cross'],
  mage: ['Spell_Simple_Shoot'], priest: ['Spell_Simple_Shoot'], shaman: ['Spell_Simple_Shoot'], hunter: ['Pistol_Shoot'], necromancer: ['Spell_Simple_Shoot'], druid: ['Spell_Simple_Shoot'],
  dreadknight: ['Sword_Regular_A', 'Sword_Regular_B'], 'dreadknight:blood': ['TreeChopping_Loop'] };
// s into each attack clip at which the blow lands (measured: peak speed / furthest reach of the striking hand)
const IMPACT = { Sword_Regular_A: 0.25, Sword_Regular_B: 0.27, Sword_Regular_C: 0.65, Sword_Attack: 0.4, TreeChopping_Loop: 0.13, Punch_Jab: 0.17, Punch_Cross: 0.22,
  Melee_Hook: 0.25, Shield_OneShot: 0.1, OverhandThrow: 0.38, Zombie_Scratch: 0.58 };
const STRIKE_LEAD = 0.07; // s between pressing an instant strike and its animation connecting
const RUN_RATE_MAX = 1.7; // highest playback rate of a manifest run clip (stride-matched below it)
const RANGED_LEAD = 0.14; // s from a ranged basic attack (the bolt leaves at once) to the release of its Tripo motion

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
  // basic-attack animations made with Tripo (attack-anims.js): authored on another skeleton, retargeted per body
  try {
    await loadAttackAnims();
    if (animSource()) TRIPO_ON_UAL = analyse(GL.Male_Ranger.scene, animSource().rest);
    for (const [n, c] of Object.entries(ANIM_CLIPS)) {
      const cc = cleanClip(c); CLIPS[n] = splitClip(cc, lowerSet); CLIPS[n].clean = cc;
      CLIPS[n].src = 'tripo'; CLIPS[n].speed = c.userData.speed; IMPACT[n] = c.userData.impact;
      const rc = cleanClip(RAW_CLIPS[n]); CLIPS['raw:' + n] = splitClip(rc, lowerSet); CLIPS['raw:' + n].clean = rc; CLIPS['raw:' + n].src = 'tripo';
    }
  } catch (e) { console.warn('attack animations failed, using the library clips', e); }
  // remodel clips from the animation manifest (docs/ATTACK_ANIMATIONS.md "Manifest-driven clips"): each set file has
  // its own source skeleton; markers come from the manifest (strike / release -> IMPACT)
  try {
    await loadManifest();
    for (const [n, c] of Object.entries(MANIFEST_CLIPS)) {
      const m = clipMeta(n), source = clipSource(n);
      const cc = cleanClip(c); CLIPS[n] = splitClip(cc, lowerSet); Object.assign(CLIPS[n], { clean: cc, src: 'tripo', speed: m.speed, source });
      if (m.impact != null) IMPACT[n] = m.impact;
      const rc = cleanClip(MANIFEST_RAW[n]); CLIPS['raw:' + n] = splitClip(rc, lowerSet); Object.assign(CLIPS['raw:' + n], { clean: rc, src: 'tripo', source });
    }
  } catch (e) { console.warn('animation manifest failed, using the old clips', e); }
  const tl = new THREE.TextureLoader(manager);
  TEX = { wood: texSet(tl, 'weathered_planks', 0.6), metal: texSet(tl, 'rusty_metal_02', 0.5) };
  prepareHeads();
  ready = true;
}
export const heroesReady = () => ready;
let LOADER = null;
let TRIPO_ON_UAL = null;          // retarget of the Tripo animation skeleton onto the UAL body (code-built champions)
const TRIPO_UAL_CLIPS = {};       // its clips, retargeted once
const TRIPO_ON = {};              // other animation skeletons (manifest set files) onto the UAL body, by source key
const has = n => !!CLIPS[n];      // for the manifest's resolve helpers: names this module can play
// Stream the generated champion models in the background, one at a time, `first` keys first. A champion
// whose model has not arrived yet is built the old way for that match.
export async function preloadChampions(first = []) {
  if (!LOADER) return;
  // your own champion first, then the pet / shapeshift models (small, and needed the moment a fight starts), then the rest
  const head = first.filter(k => CHAMPION_MODELS[k]);
  for (const k of head) await loadChampion(LOADER, k);
  await loadChampion(LOADER, 'gorilla');
  await preloadCreatures(LOADER); // Druid Cat / Bear form models
  for (const k of Object.keys(CHAMPION_MODELS)) if (!head.includes(k)) await loadChampion(LOADER, k);
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
export const ARMORY_KINDS = new Set(['orcaxe', 'longbow', 'frostwand', 'firewand', 'tome', 'stormmace', 'relic', 'sunhammer', 'holysword', 'towershield', 'cleaver', 'orcshield', 'flamestaff', 'runesword', 'kiteshield', 'warAxe', 'warAxeL', 'greatAxe', 'greatsword', 'stormaxeL', 'bow', 'crossbow', 'bonestaff', 'druidstaff', 'fang', 'fangL', 'archstaff', 'sunmace', 'stormaxe', 'runeswordL']);
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
  bonestaff: { bone: 'hand_r', dir: [0, 1, 0.12], side: [-1, 0, 0], palm: 0.085 }, druidstaff: { bone: 'hand_r', dir: [0, 1, 0.12], side: [-1, 0, 0], palm: 0.085 },
  runeswordL: { bone: 'hand_l', dir: [0, 0.55, 1], side: [1, 0, 0], palm: 0.085 } });
export const GRIPS = GRIP; // exposed for tuning
export let TROLL_KNEE = -0.22; // knee crouch for jungle trolls (bone-local X in the base skeleton's axes)
export const setTrollKnee = v => { TROLL_KNEE = v; };
// generated champions (champions.js) have their own sculpted forearms and gauntlets: shields are fitted to
// the measured arm instead of a fixed grip (fitShield)
const SHIELDS = new Set(['shield', 'orcshield', 'kiteshield', 'towershield']);
const GRIP_GEN = {};
// code-built two-handed weapons (armory.js: origin = the right fist, +Y = the haft toward the head): the centre of the
// left fist on the haft, m along +Y. An empty `grip2` there is the two-hand IK's target (only with HAND_LAYER.ikCodeBuilt)
const GRIP2 = { greatAxe: -0.25, sunhammer: -0.2, greatsword: -0.2, bonestaff: -0.35, druidstaff: -0.35 };

// ------------------------------------------------------------------ assembled champions: hand poses (docs/remodel/03 §5)
// An assembled champion (tools/assemble-champion.mjs) has its items merged into its skin on socket joints, so the
// fingers are posed around them by a layer after the mixer. Flexion in degrees (positive = toward the palm) of the
// 01 / 02 / 03 joints of index, middle, ring, pinky; spread turns the 01 joints about the palm normal (positive = away
// from the middle finger); thumb = [opposition of thumb_01 toward the palm about the hand's long axis, 02, 03].
export const HAND_POSES = {
  fist_1h: { f: [[70, 95, 55], [75, 95, 55], [80, 95, 55], [85, 95, 55]], spread: -4, thumb: [45, 25, 35] },
  trigger: { f: [[10, 20, 10], [75, 95, 55], [80, 95, 55], [85, 95, 55]], spread: -4, thumb: [45, 25, 35] }, // gun hand: index along the trigger guard
  fist_2h: { f: [[62, 85, 50], [66, 88, 50], [70, 88, 50], [75, 88, 50]], spread: -4, thumb: [40, 25, 30] },
  wand_pinch: { f: [[25, 30, 15], [55, 70, 40], [75, 90, 50], [85, 90, 50]], spread: 0, thumb: [50, 20, 25] },
  bow_grip: { f: [[55, 78, 45], [60, 82, 45], [65, 82, 45], [70, 82, 45]], spread: -2, thumb: [35, 30, 30] },
  bow_draw: { f: [[20, 80, 40], [20, 80, 40], [20, 80, 40], [80, 90, 60]], spread: 0, thumb: [30, 40, 40] },
  tome: { f: [[10, 15, 10], [10, 15, 10], [12, 15, 10], [15, 18, 10]], spread: 3, thumb: [10, 40, 20] },
  orb_cup: { f: [[30, 35, 25], [30, 35, 25], [32, 35, 25], [35, 38, 25]], spread: 8, thumb: [20, 15, 15] },
  spell_open: { f: [[8, 10, 5], [8, 10, 5], [10, 10, 5], [12, 12, 5]], spread: 15, thumb: [0, 5, 5] },
  claw: { f: [[-10, 60, 70], [-10, 60, 70], [-10, 60, 70], [-10, 60, 70]], spread: 15, thumb: [10, 40, 50] },
  fist_unarmed: { f: [[90, 100, 70], [90, 100, 70], [92, 100, 70], [95, 100, 70]], spread: -4, thumb: [60, 40, 40] },
  relaxed: { f: [[15, 22, 12], [18, 25, 12], [22, 28, 14], [26, 30, 16]], spread: 2, thumb: [15, 15, 10] },
};
// tuning: blend time (s) when a hand's pose changes, wrist-lock strength with a shield (03 §4.2), how much of the
// curl the model already has at rest is taken off the table's angles (1 = the table's angles are from a straight finger),
// and how far a shield is rolled on the forearm so its top stays up and its tip points down (0 = rigid on the socket).
// Two-hand IK (03 §6): reach limit (share of the arm's length), weight blend time (s), and whether code-built weapons
// (an empty `grip2` from GRIP2) get it too — off: the live game keeps today's look until assembled two-handers ship.
export const HAND_LAYER = { blend: 0.08, wristLock: 0.8, restComp: 1, shieldUpright: 1, ikReach: 0.98, ikBlend: 0.12, ikCodeBuilt: false };
const FINGERS = ['index', 'middle', 'ring', 'pinky'], SPREAD_K = [1, 0, -0.5, -1]; // spread share, + = toward the thumb side
const DEG = Math.PI / 180;
// the hand pose an item asks for (an item entry of the GLB may name its own)
function itemPose(id, it) {
  if (it && HAND_POSES[it.pose]) return it.pose;
  const n = String(id).toLowerCase();
  if (/wand/.test(n)) return 'wand_pinch';
  if (/blunderbuss|rifle|musket|gun/.test(n)) return 'trigger';
  if (/crossbow/.test(n)) return 'fist_1h';
  if (/bow/.test(n)) return 'bow_grip';
  if (/tome|book/.test(n)) return 'tome';
  if (/relic|orb/.test(n)) return 'orb_cup';
  if (/staff|great|hammer|headsman|2h/.test(n)) return 'fist_2h';
  return 'fist_1h'; // swords, axes, maces, scepters, daggers, shield handles
}
// the socket a look weapon sits on (03 §3.1)
const socketOf = w => (SHIELDS.has(w) ? 'shield_l' : /_l$/.test(GRIP[w]?.bone || '') ? 'grip_l' : 'grip_r');

// Rest-pose rig of one hand for the finger layer. nodes: lower-case name -> node, world matrices at rest (bind pose).
// Per finger / thumb joint: its rest local rotation and, in its own local frame, the flex axis (boneDir × N: a positive
// angle curls toward the palm), the spread axis (01 joints) and the thumb's opposition axis (thumb_01).
// Palm normal N = ±normalize((middle_01 − hand) × (index_01 − pinky_01)), − for the right hand, + for the left
// (fingers × thumb side is the back of a right hand and the palm of a left one). Checked on every champion GLB:
// N ≈ −Y in the palms-down T-pose, the thumb lies on the +N side, and a 90° flex moves middle_03 onto the palm side.
function restHand(nodes, s) {
  const V = THREE.Vector3, at = o => new V().setFromMatrixPosition(o.matrixWorld);
  const hand = nodes['hand_' + s], m1 = nodes['middle_01_' + s] || nodes['ring_01_' + s], i1 = nodes['index_01_' + s], p1 = nodes['pinky_01_' + s] || nodes['ring_01_' + s];
  if (!hand || !m1 || !i1 || !p1 || i1 === p1) return null;
  const H = at(hand), L = at(m1).sub(H);
  if (L.lengthSq() < 1e-12) return null; L.normalize();                     // wrist -> knuckles
  const W = at(i1).sub(at(p1)); W.addScaledVector(L, -W.dot(L));
  if (W.lengthSq() < 1e-12) return null; W.normalize();                     // thumb side
  const N = new V().crossVectors(L, W).normalize().multiplyScalar(s === 'r' ? -1 : 1);
  const oppAxis = new V().crossVectors(W, N).normalize();                   // turns the thumb (on +W) toward the palm (+N)
  const wq = new THREE.Quaternion(), tv = new V(), ts = new V();
  const toLocal = (o, v) => { o.matrixWorld.decompose(tv, wq, ts); return v.clone().applyQuaternion(wq.invert()).normalize(); };
  const joints = [];
  for (let d = 0; d < 5; d++) {
    const name = d < 4 ? FINGERS[d] : 'thumb';
    for (let j = 1; j <= 3; j++) {
      const node = nodes[`${name}_0${j}_${s}`]; if (!node) continue;
      const P = at(node), next = nodes[`${name}_0${j + 1}_${s}`];
      const prev = j > 1 ? nodes[`${name}_0${j - 1}_${s}`] : (nodes[`${name}_metacarpal_${s}`] || hand);
      // bone direction: toward the next joint; the last joint continues the segment that leads to it
      const dir = next ? at(next).sub(P) : prev ? P.clone().sub(at(prev)) : L.clone();
      if (dir.lengthSq() < 1e-12) dir.copy(L); dir.normalize();
      const flex = new V().crossVectors(dir, N); if (flex.lengthSq() < 0.04) flex.crossVectors(L, N); flex.normalize();
      // curl the model already has at this joint (Tripo hands are often modelled half closed), from the segment before it
      let restFlex = 0;
      if (next && prev && (d < 4 || j > 1)) {
        const a = P.clone().sub(at(prev)), b = dir.clone();
        a.addScaledVector(flex, -a.dot(flex)); b.addScaledVector(flex, -b.dot(flex));
        if (a.lengthSq() > 1e-12 && b.lengthSq() > 1e-12) { a.normalize(); b.normalize(); restFlex = THREE.MathUtils.clamp(Math.atan2(new V().crossVectors(a, b).dot(flex), a.dot(b)), -0.5, 0.8); }
      }
      const spread = d < 4 && j === 1 ? new V().crossVectors(dir, W) : null; // a positive angle swings the finger toward the thumb side
      joints.push({ node, d, j, rest: node.quaternion.clone(), restFlex, flex: toLocal(node, flex),
        spread: spread && spread.lengthSq() > 0.04 ? toLocal(node, spread) : null,
        opp: d === 4 && j === 1 ? toLocal(node, oppAxis) : null });
    }
  }
  return joints.length ? { joints } : null;
}
// flexion / spread / opposition (radians) of one rest joint in a pose
function poseAngles(p, J, out) {
  const comp = HAND_LAYER.restComp;
  if (J.d < 4) { out[0] = p.f[J.d][J.j - 1] * DEG - J.restFlex * comp; out[1] = J.j === 1 ? p.spread * SPREAD_K[J.d] * DEG : 0; out[2] = 0; }
  else { out[0] = J.j === 1 ? 0 : p.thumb[J.j - 1] * DEG - J.restFlex * comp; out[1] = 0; out[2] = J.j === 1 ? p.thumb[0] * DEG : 0; }
  return out;
}
const _hq = new THREE.Quaternion(), _hr = new THREE.Quaternion(), _ha = [0, 0, 0];
const _sq = new THREE.Quaternion(), _sx = new THREE.Vector3(), _sy = new THREE.Vector3(), _sz = new THREE.Vector3(), _su = new THREE.Vector3(), _Z = new THREE.Vector3(0, 0, 1);
// two-hand IK scratch (no allocation per frame)
const _iA = new THREE.Vector3(), _iB = new THREE.Vector3(), _iC = new THREE.Vector3(), _iT = new THREE.Vector3(), _iD = new THREE.Vector3(), _iP = new THREE.Vector3();
const _iE = new THREE.Vector3(), _iW = new THREE.Vector3(), _iV = new THREE.Vector3(), _iV2 = new THREE.Vector3(), _iS = new THREE.Vector3(), _iS2 = new THREE.Vector3();
const _iQt = new THREE.Quaternion(), _iQh = new THREE.Quaternion(), _iQ1 = new THREE.Quaternion(), _iQ2 = new THREE.Quaternion();
const _iQu = new THREE.Quaternion(), _iQp = new THREE.Quaternion(), _iQl = new THREE.Quaternion(), _iQl2 = new THREE.Quaternion(), _iQh2 = new THREE.Quaternion();
// one hand of the finger layer
const handState = (side, rig) => { const n = rig.joints.length; return { side, joints: rig.joints, pose: null, w: 0, t: 1, tracked: false, from: new Float32Array(n * 3), cur: new Float32Array(n * 3) }; };
// the two-hand IK weight a clip asks for at time t (s into the trimmed clip): manifest ikL (0 without it; 1 when only
// markers are given), 0 from an ikL_off marker to an ikL_on marker (05 §2.5)
function ikOf(id, t) {
  const m = id ? clipMeta(id) : null; if (!m) return 0;
  const off = m.markers.ikL_off, on = m.markers.ikL_on, w = m.ikL ?? (off != null || on != null ? 1 : 0);
  if (off == null && on == null) return w;
  if (off != null && on != null) return (off < on ? t >= off && t < on : t < on || t >= off) ? 0 : w;
  return (off != null ? t >= off : t < on) ? 0 : w;
}
// a manifest clip on the 'additive' layer (05 §2.6): made additive against its own first frame once it is retargeted
// (retargetClip needs absolute rotations); the upper / lower parts share the full clip's tracks
function additive(name, set) {
  if (!set || clipMeta(name)?.layer !== 'additive') return set;
  THREE.AnimationUtils.makeClipAdditive(set.full);
  set.upper.blendMode = set.lower.blendMode = THREE.AdditiveAnimationBlendMode;
  return set;
}

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
    this.idle = idleFor(cls, spec, { has }) || look.idle; // the stance set's idle (animation manifest), else the look's
    this.act = null; this.opacity = 1; this.time = Math.random() * 10; this.side = 0;
    this.root = new THREE.Group();
    // a generated model for this spec (champions.js) replaces body, race and code armor
    let ck = null; try { ck = CHAMPION_MODELS[cls] ? cls : cls + ':' + validSpec(cls, spec); } catch (e) { ck = null; } // pets (gorilla) are keyed by kind
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
    this.offHand = look.weapons.some(w => /shield|tome|relic|fireOrb/i.test(w)); // the left hand holds something that stays in guard
    // an assembled champion already carries (some of) its items in its skin: those get no code-built weapon
    const merged = this.assembled ? this.mergedItems(look) : {};
    this.mixer0 = new THREE.AnimationMixer(body);
    const rest = this.mixer0.clipAction(this.clip(look.idle).full); rest.play(); this.mixer0.update(0.01);
    this.root.updateMatrixWorld(true);
    for (const w of look.weapons) {
      if (merged[w]) { this.weapons[w] = this.itemMarker(w, merged[w]); continue; }
      const wp = makeWeapon(w, look), gp = (this.generated && GRIP_GEN[w]) || GRIP[w];
      if (GRIP2[w] !== undefined) { const g2 = new THREE.Object3D(); g2.name = 'grip2'; g2.position.y = GRIP2[w]; wp.add(g2); wp.userData.grip2 = g2; } // two-hand IK target
      let bone = (this.generated && SHIELDS.has(w)) ? fitShield(this, wp) : null;
      if (!bone) { bone = this.bones[gp.bone] || this.bones.hand_r; solveGrip(wp, bone, gp, this.bones); }
      if (look.weaponScale) wp.scale.multiplyScalar(look.weaponScale);
      // static weapon parts fold into the champion mesh (consolidate.js); pulsing / spinning parts stay separate
      const U = wp.userData; if (U.fire) U.noMerge = true; else for (const p of [U.pulse, U.crystal, U.spin, U.drop]) if (p) p.userData.noMerge = true;
      bone.add(wp);
      this.weapons[w] = wp;
    }
    this.fistGrips(look);
    if (this.assembled) this.setupHands(look, merged);
    this.setupIK(merged);
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
    // fold the body, outfit, head, hair and rigid armor into one skinned mesh per material (draw calls). An assembled
    // champion's skin (body + items) is already one draw per material: it stays as loaded (its geometry shared by
    // every champion of that spec); only code-built extras are folded.
    let keep; if (this.assembled) { keep = new Set(); body.traverse(o => { if (o.isSkinnedMesh) keep.add(o); }); }
    this.drawGroups = consolidate(this, keep);
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
    this.tipL = (W.fangL || W.warAxeL || W.stormaxeL || W.runeswordL)?.userData.tip;
    this.tmpQ = new THREE.Quaternion(); this.tmpE = new THREE.Euler();
    this.setLoco(this.idle, 0);
  }

  // The weapons' idle grips are set by eye for the hanging idle hand. The Tripo attack motions hold a weapon the real
  // way: through the fist, the shaft along the thumb side of the hand, the edge where the knuckles point. For every
  // held weapon this works out that "fist grip" in the hand's own frame; during a Tripo attack the weapon turns
  // into it (and back to the idle grip as the attack fades), so a thrust points the staff at the enemy, a cut leads
  // with the edge.
  fistGrips(look) {
    const B = this.bones, V = THREE.Vector3;
    for (const [w, wp] of Object.entries(this.weapons)) {
      if (/shield|tome|relic|fireOrb/i.test(w) || wp.userData.assembled) continue; // merged items never turn in the hand
      const hand = wp.parent; if (!hand || !/^hand_[lr]$/i.test(Object.keys(B).find(k => B[k] === hand) || hand.name)) continue;
      const s = /_l$/i.test(Object.keys(B).find(k => B[k] === hand) || hand.name) ? 'l' : 'r';
      // the fingers' direction, and the thumb side (from the thumb, or index minus little / ring finger: some rigs lack one)
      const idx = B['index_01_' + s], pin = B['pinky_01_' + s] || B['ring_01_' + s], mid = B['middle_01_' + s] || idx, th = B['thumb_01_' + s];
      if (!mid || !(th || (idx && pin))) continue;
      const local = o => hand.worldToLocal(o.getWorldPosition(new V()));
      const f = local(mid).normalize(), l = idx && pin ? local(idx).sub(local(pin)) : local(th);
      const Y = l.addScaledVector(f, -l.dot(f)).normalize();            // the fist's tube, toward the thumb
      let X = f.clone();                                                   // the edge leads where the knuckles point
      if (/bow/i.test(w)) X.crossVectors(Y, f).normalize();               // a bow faces the target, square to the fingers
      const Z = new V().crossVectors(X, Y).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
      wp.userData.idleQ = wp.quaternion.clone(); wp.userData.fistQ = q;
      wp.userData.revQ = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new V(0, 0, 1), Math.PI)); // turned over in the fist
      // 'palm': the shaft along the palm's normal — a bow held in a hand whose thumb points at the target stands upright
      const n = new V().crossVectors(f, Y).normalize(), px = new V().crossVectors(n, f).normalize();
      wp.userData.palmQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(px, n, new V().crossVectors(px, n).normalize()));
      wp.userData.palmRevQ = wp.userData.palmQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new V(0, 0, 1), Math.PI));
      wp.userData.noMerge = true; // it turns in the hand, so it can't be folded into the body mesh (consolidate.js)
      (this.fistWeapons || (this.fistWeapons = [])).push(wp);
    }
  }
  // generated champion: clone the rigged GLB, fit it to the base body's height and analyse its rest pose once
  buildGenerated(champ, look) {
    const body = SkeletonUtils.clone(champ.scene);
    if (!champ.fit) {
      // an assembled model's merged items would stretch its bounding box: it states the body's own height instead
      const hb = champ.remodel ? Number(champ.remodel.bodyHeightScene) : 0;
      const h = hb > 0 && Number.isFinite(hb) ? hb : new THREE.Box3().setFromObject(champ.scene).getSize(new THREE.Vector3()).y;
      const hs = new THREE.Box3().setFromObject(GL.Male_Ranger.scene).getSize(new THREE.Vector3()).y;
      champ.fit = hs / Math.max(0.01, h);
    }
    this.body = body; this.root.add(body);
    this.bones = {};
    body.traverse(o => {
      if (o.isBone) this.bones[o.name] = o;
      // each champion gets its own copy of the model's material (textures stay shared): otherwise two
      // champions of the same spec would share one material, and a stealth fade or hit flash on one would show on both
      // LOD meshes (champions.js markLods): LOD0 leaves the shadow to the proxy (the last LOD, on SHADOW_LAYER)
      if (o.isMesh) { o.frustumCulled = false; o.castShadow = !o.userData.noShadow; o.receiveShadow = !o.userData.shadowProxy; o.material = o.material.clone(); (this.flashMats || (this.flashMats = [])).push(o.material); }
      if (o.isMesh && o.userData.lod !== undefined) (this.lods || (this.lods = []))[o.userData.lod] = o;
    });
    if (!champ.A) champ.A = analyse(body); // rest-pose frames are scale-free (relative to the body)
    // gameplay code addresses bones by the base skeleton's names (hand_r, spine_03, Head …): alias them
    const byLc = {}; for (const [n, b] of Object.entries(this.bones)) byLc[n.toLowerCase()] = b;
    for (const [s, t] of Object.entries(champ.A.map)) { const b = byLc[t]; if (b) { this.bones[s] = b; if (s === 'head') this.bones.Head = b; } }
    if (byLc.head) this.bones.Head = byLc.head;
    body.scale.setScalar(champ.fit * look.scale * (RACE_HEIGHT[this.race] || 1));
    this.retarget = champ.A; this.clipCache = champ.clips; this.champ = champ;
    this.generated = true;
    if (champ.remodel) {
      // assembled (tools/assemble-champion.mjs): items merged into the skin on socket joints (grip_r, grip_l, shield_l)
      // with their marker empties (<item>_tip, <item>_fx_core …). The hand rig is read here, while the body is at rest.
      this.assembled = true;
      const nodes = this.nodesLc = {};
      body.traverse(o => { const n = (o.name || '').toLowerCase(); if (n && !(n in nodes)) nodes[n] = o; });
      body.updateMatrixWorld(true);
      this.handRest = { r: restHand(nodes, 'r'), l: restHand(nodes, 'l'), wristL: nodes.hand_l ? nodes.hand_l.quaternion.clone() : null };
    }
    return body;
  }

  // ---- assembled champions
  // look weapon id -> the GLB's item entry: the same id first, then a still unmatched item on the socket that weapon uses
  mergedItems(look) {
    const items = (Array.isArray(this.champ?.remodel?.items) ? this.champ.remodel.items : []).filter(it => it && it.name);
    const lc = s => String(s || '').toLowerCase(), out = {}, used = new Set();
    for (const w of look.weapons) { const it = items.find(i => !used.has(i) && lc(i.name) === lc(w)); if (it) { out[w] = it; used.add(it); } }
    for (const it of items) {
      if (used.has(it)) continue;
      const w = look.weapons.find(k => !out[k] && socketOf(k) === lc(it.socket)); if (w) { out[w] = it; used.add(it); }
    }
    return out;
  }
  // a merged item's stand-in in this.weapons: an empty on its socket joint whose userData.tip is the item's tip empty
  // (its fx_core for shields / items without a tip), so focus, tipR / tipL, weaponTipWorld and trails keep working
  itemMarker(w, it) {
    const lc = s => String(s || '').toLowerCase(), nodes = this.nodesLc || {};
    const sock = nodes[lc(it.socket || socketOf(w))] || null, pre = lc(it.name) + '_', markers = {};
    const scan = root => root.traverse(o => { const n = lc(o.name); if (o !== sock && !o.isBone && n.startsWith(pre) && !markers[n.slice(pre.length)]) markers[n.slice(pre.length)] = o; });
    if (sock) scan(sock);
    if (!Object.keys(markers).length) scan(this.body);
    const holder = sock || this.bones[GRIP[w]?.bone] || this.bones.hand_r || this.body;
    const wp = new THREE.Object3D(); wp.name = 'item_' + w; holder.add(wp);
    wp.userData = { assembled: true, item: it.name, socket: sock ? sock.name : null, markers, noMerge: true,
      tip: markers.tip || markers.fx_core || markers.rim_top || wp };
    return wp;
  }
  // Finger layer (03 §5) and shield wrist lock (03 §4.2), assembled champions only: every hand that holds an item
  // gets that item's pose; an empty hand keeps the animation's fingers.
  setupHands(look, merged) {
    const R = this.handRest; if (!R) return;
    const lc = s => String(s || '').toLowerCase(), want = {};
    for (const w of look.weapons) {
      const it = merged[w], side = /_l$/.test(lc(it ? it.socket || socketOf(w) : socketOf(w))) ? 'l' : 'r';
      if (!want[side]) want[side] = itemPose(w, it);
    }
    // the bones this layer writes: their animated value is put back before the mixer runs, because the mixer only
    // writes a bone whose value changed since its last frame (a held clip would otherwise build on the posed value)
    this.layerSaved = [];
    // a shield's strap holds the fist on its handle: hand_l is pulled toward its rest (bind) rotation each frame
    const shield = Object.entries(merged).some(([w, it]) => lc(it.socket || socketOf(w)) === 'shield_l');
    const hl = this.nodesLc.hand_l;
    this.wristLock = shield && hl && R.wristL ? { node: hl, rest: R.wristL } : null;
    if (this.wristLock) this.layerSaved.push({ node: hl, q: hl.quaternion.clone() });
    // the shield's socket joint (no animation track): rolled about its face normal each frame, from its bind rotation
    const sn = shield && this.nodesLc.shield_l;
    this.shieldUp = sn ? { node: sn, rest: sn.quaternion.clone() } : null;
    // weapon sockets (grip_r / grip_l with a merged weapon): turned over in the fist for clips whose manifest grip is
    // 'rev' (the blade leaves the fist on the little-finger side), blended, so the motions' hand roll fits the blade
    this.baseGrip = clipMeta(this.idle)?.grip || 'fist';
    this.gripTurn = ['grip_r', 'grip_l'].map(s => this.nodesLc[s]).filter(n => n && Object.entries(merged).some(([w, it]) => !SHIELDS.has(w) && lc(it.socket || socketOf(w)) === lc(n.name)))
      .map(n => ({ node: n, rest: n.quaternion.clone(), k: this.baseGrip === 'rev' ? 1 : 0 }));
    this.hands = []; this.handWant = want; // want: each hand's item pose (the two-hand IK returns to it)
    for (const s of ['r', 'l']) {
      const rig = R[s]; if (!rig) continue;
      const h = handState(s, rig);
      this.hands.push(h);
      if (want[s]) { this.setHandPose(s, want[s]); h.w = 1; } // held from the first frame, no blend in
    }
  }
  // change a hand's pose ('fist_1h', 'bow_draw' …, or null to hand the fingers back to the animation): blended in HAND_LAYER.blend s
  setHandPose(side, pose) {
    const h = this.hands && this.hands.find(x => x.side === side); if (!h) return;
    pose = pose && HAND_POSES[pose] ? pose : null; if (h.pose === pose) return;
    if (pose && !h.tracked) { h.tracked = true; for (const J of h.joints) this.layerSaved.push({ node: J.node, q: J.node.quaternion.clone() }); }
    h.from.set(h.cur); h.t = pose && h.w > 0 ? 0 : 1; h.pose = pose;
  }
  // Order: wrist lock (hand_l's local pull toward its rest, the animation-level fix) → grip turn (moves the weapon, so
  // grip2, in the right fist) → two-hand IK (reads grip2; writes upperarm_l / lowerarm_l / hand_l, so it overrides the
  // wrist lock by its weight) → shield roll (reads the forearm's world rotation, which the IK may have moved) → fingers
  // (local rotations under the hands, independent of the arm). The body's procedural layers that run after this
  // (hunch, hit jolt, stun sway on spine / head, strafe yaw) turn both arms together, so the hands stay on the haft.
  handLayer(dt) {
    for (const S of this.layerSaved) S.q.copy(S.node.quaternion); // the animation's own values (restored before the next mixer update)
    if (this.wristLock) this.wristLock.node.quaternion.slerp(this.wristLock.rest, HAND_LAYER.wristLock);
    if (this.gripTurn?.length) this.turnGrips(dt);
    if (this.ik) this.armIK(dt);
    if (this.shieldUp) this.uprightShield();
    const bt = Math.max(1e-3, HAND_LAYER.blend), q = _hq, r = _hr, a = _ha;
    for (const h of this.hands || []) {
      const P = h.pose && HAND_POSES[h.pose];
      h.w = P ? Math.min(1, h.w + dt / bt) : Math.max(0, h.w - dt / bt);
      if (h.w <= 0) continue;
      if (h.t < 1) h.t = Math.min(1, h.t + dt / bt);
      const k = h.t * h.t * (3 - 2 * h.t), J = h.joints, cur = h.cur, from = h.from;
      for (let i = 0; i < J.length; i++) {
        const e = J[i], o = i * 3;
        if (P) { poseAngles(P, e, a); for (let c = 0; c < 3; c++) cur[o + c] = from[o + c] + (a[c] - from[o + c]) * k; }
        q.copy(e.rest);
        if (cur[o + 1] && e.spread) q.multiply(r.setFromAxisAngle(e.spread, cur[o + 1]));
        if (cur[o + 2] && e.opp) q.multiply(r.setFromAxisAngle(e.opp, cur[o + 2]));
        if (cur[o]) q.multiply(r.setFromAxisAngle(e.flex, cur[o]));
        if (h.w < 1) e.node.quaternion.slerp(q, h.w); else e.node.quaternion.copy(q);
      }
    }
  }

  // ---- two-hand IK (docs/remodel/03 §6): the left hand is snapped onto the two-handed item's `grip2` — an assembled
  // item's <item>_grip2 empty, or GRIP2's empty on a code-built weapon (only with HAND_LAYER.ikCodeBuilt). The left
  // hand's grip frame (03 §3.1: +X knuckles, +Y thumb side, origin in the fist's channel) is the model's grip_l socket
  // when it has one, else it is built from the hand's bones the way grip_r sits in the right hand. Read in the rest pose.
  setupIK(merged) {
    const B = this.bones, U = B.upperarm_l, Lo = B.lowerarm_l, Hd = B.hand_l; if (!U || !Lo || !Hd) return;
    const under = (o, p) => { for (let x = o.parent; x; x = x.parent) if (x === p) return true; return false; };
    if (!under(Lo, U) || !under(Hd, Lo)) return;
    let target = null, code = false;
    for (const [w, wp] of Object.entries(this.weapons)) {
      const g2 = SHIELDS.has(w) ? null : merged[w] ? wp.userData.markers?.grip2 : wp.userData.grip2;
      if (g2 && !under(g2, Hd)) { target = g2; code = !merged[w]; break; } // not an item in the left hand itself
    }
    if (!target) return;
    this.root.updateMatrixWorld(true);
    const V = THREE.Vector3, at = o => new V().setFromMatrixPosition(o.matrixWorld), ph = new V(), qh = new THREE.Quaternion(), pg = new V(), qg = new THREE.Quaternion();
    Hd.matrixWorld.decompose(ph, qh, new V());
    const gl = this.nodesLc?.grip_l;
    if (gl && under(gl, Hd)) gl.matrixWorld.decompose(pg, qg, new V());
    else {
      // a hand's frame from its bones: X = wrist → middle knuckle, Y = thumb side, N = palm normal (as restHand)
      const frame = s => {
        const h = B['hand_' + s], m = B['middle_01_' + s] || B['ring_01_' + s], i = B['index_01_' + s], p = B['pinky_01_' + s] || B['ring_01_' + s];
        if (!h || !m || !i || !p || i === p) return null;
        const H = at(h), X = at(m).sub(H).normalize(), Y = at(i).sub(at(p)); Y.addScaledVector(X, -Y.dot(X)).normalize();
        return { H, X, Y, N: new V().crossVectors(X, Y).multiplyScalar(s === 'r' ? -1 : 1) };
      };
      const F = frame('l'); if (!F) return;
      const gr = this.nodesLc?.grip_r, R = gr && frame('r'), mir = k => F.X.clone().multiplyScalar(k.dot(R.X)).addScaledVector(F.Y, k.dot(R.Y)).addScaledVector(F.N, k.dot(R.N));
      if (R) { // grip_r mirrored: its place and axes in the right hand's bone frame, laid into the left's (paladin: 9 mm, 3° from the fitted grip_l)
        const q = new THREE.Quaternion(); gr.matrixWorld.decompose(new V(), q, new V());
        const X = mir(new V(1, 0, 0).applyQuaternion(q)).normalize(), Y = mir(new V(0, 1, 0).applyQuaternion(q)); Y.addScaledVector(X, -Y.dot(X)).normalize();
        pg.copy(F.H).add(mir(at(gr).sub(R.H)));
        qg.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, new V().crossVectors(X, Y)));
      } else { // as the code-built weapons sit in the right fist (solveGrip: 0.085 m toward the fingers; fistGrips' axes)
        pg.copy(F.H).addScaledVector(F.X, 0.085);
        qg.setFromRotationMatrix(new THREE.Matrix4().makeBasis(F.X, F.Y, new V().crossVectors(F.X, F.Y)));
      }
    }
    const A = at(U), D = at(Hd).sub(A).normalize(), pole = at(Lo).sub(A); pole.addScaledVector(D, -pole.dot(D));
    if (pole.lengthSq() < 1e-12) pole.set(0, -1, 0);
    this.ik = { upper: U, lower: Lo, hand: Hd, target, code, w: 0, want: 0, posed: false, short: 0, live: false,
      relInv: qg.clone().invert().multiply(qh),                 // hand world = grip2 world · relInv
      off: pg.clone().sub(ph).applyQuaternion(qh.clone().invert()), // wrist → the grip's centre, in the hand's frame (world units)
      pole: pole.normalize(), qU: new THREE.Quaternion(), qL: new THREE.Quaternion(), qH: new THREE.Quaternion() };
    // the arm joins the layer's restore-before-mixer list; a body without the finger layer (code-built weapon) gets a
    // hand rig for the IK's fist_2h only (no item poses)
    this.layerSaved = this.layerSaved || [];
    for (const n of [U, Lo, Hd]) if (!this.layerSaved.some(S => S.node === n)) this.layerSaved.push({ node: n, q: n.quaternion.clone() });
    if (!this.hands) {
      const nodes = {}; for (const [n, b] of Object.entries(B)) { const k = n.toLowerCase(); if (!(k in nodes)) nodes[k] = b; }
      this.hands = []; this.handWant = {};
      for (const s of ['r', 'l']) { const rig = restHand(nodes, s); if (rig) this.hands.push(handState(s, rig)); }
    }
  }
  // the IK weight the playing clips ask for: the action over the cast pose over the locomotion, by their blend weights
  ikWant(c, actW, castName, castA) {
    if (this.ik.code && !HAND_LAYER.ikCodeBuilt) return 0;
    const L = this.loco, cw = this.castW || 0;
    let w = ikOf(L.name, L.a ? L.a.time : 0);
    if (cw > 0) w += (ikOf(castName, castA ? castA.time : 0) - w) * cw;
    if (c && actW > 0) w += (ikOf(c.id || c.name, c.a.time) - w) * actW;
    return w;
  }
  // analytic two-bone IK: upperarm_l → lowerarm_l with the clip's own elbow as the pole, then hand_l turned so its grip
  // frame lies on grip2; the wrist stops at HAND_LAYER.ikReach × the arm's length (no stretched arm: ik.short > 0)
  armIK(dt) {
    const K = this.ik, step = Math.max(dt, 0) / Math.max(1e-3, HAND_LAYER.ikBlend);
    K.w += Math.max(-step, Math.min(step, K.want - K.w)); if (K.w < 1e-4) K.w = 0;
    const on = K.w > 0;
    if (on !== K.posed) { // both hands fist_2h while the left hand is on the haft (03 §6); back to the items' poses after
      K.posed = on; const W = this.handWant || {};
      this.setHandPose('l', on ? 'fist_2h' : W.l || null); this.setHandPose('r', W.r || (on ? 'fist_2h' : null));
    }
    if (!on) { K.short = 0; K.live = false; return; }
    const U = K.upper, Lo = K.lower, Hd = K.hand, A = _iA, Bp = _iB, C = _iC, T = _iT, D = _iD, P = _iP, E = _iE, Wr = _iW;
    Hd.updateWorldMatrix(true, false); K.target.updateWorldMatrix(true, false); // the arm as animated, grip2 after the grip turn
    A.setFromMatrixPosition(U.matrixWorld); Bp.setFromMatrixPosition(Lo.matrixWorld); C.setFromMatrixPosition(Hd.matrixWorld);
    K.target.matrixWorld.decompose(T, _iQt, _iS2);
    const Qh = _iQh.copy(_iQt).multiply(K.relInv);   // the hand's world rotation with its grip frame on grip2 …
    T.sub(_iV.copy(K.off).applyQuaternion(Qh));      // … and the wrist's place then
    const l1 = A.distanceTo(Bp), l2 = Bp.distanceTo(C);
    D.subVectors(T, A); const d = D.length(); if (!(d > 1e-6 && l1 > 1e-6 && l2 > 1e-6)) return;
    D.multiplyScalar(1 / d);
    const reach = (l1 + l2) * HAND_LAYER.ikReach, dc = Math.min(reach, Math.max(Math.abs(l1 - l2) * 1.02 + 1e-4, d));
    K.short = Math.max(0, d - reach);
    // pole: the clip's own elbow bend (the elbow's offset from the animated shoulder → wrist line; measured against the
    // line to the target it flips whenever that line sweeps past the elbow), a little of last frame's for an almost
    // straight arm, then square to the line to the target
    _iV.subVectors(C, A).normalize(); P.subVectors(Bp, A); P.addScaledVector(_iV, -P.dot(_iV));
    P.addScaledVector(K.pole, l1 * 0.05); P.addScaledVector(D, -P.dot(D));
    if (P.lengthSq() < 1e-12) { P.set(0, -1, 0).addScaledVector(D, D.y); if (P.lengthSq() < 1e-12) P.set(1, 0, 0); }
    P.normalize();
    // the elbow's plane turns at most 720°/s (no pop when an out-of-reach target's line swings past the elbow); it
    // snaps when the IK comes on
    const turn = K.live ? P.angleTo(K.pole) : 0, mx = Math.max(dt, 0) * 4 * Math.PI;
    if (turn > mx) {
      _iV.crossVectors(K.pole, P); if (_iV.lengthSq() < 1e-12) _iV.copy(D);
      _iV2.copy(P); P.copy(K.pole).applyAxisAngle(_iV.normalize(), mx); P.addScaledVector(D, -P.dot(D));
      if (P.lengthSq() < 1e-6) P.copy(_iV2); P.normalize();
    }
    K.pole.copy(P); K.live = true;
    const ca = Math.min(1, Math.max(-1, (l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc))), sa = Math.sqrt(1 - ca * ca);
    E.copy(A).addScaledVector(D, ca * l1).addScaledVector(P, sa * l1); // the new elbow
    Wr.copy(A).addScaledVector(D, dc);                                // the new wrist
    const q1 = _iQ1.setFromUnitVectors(_iV.subVectors(Bp, A).normalize(), _iV2.subVectors(E, A).normalize()); // swing the upper arm
    C.sub(A).applyQuaternion(q1).add(A);                                                                          // the wrist after it
    const q2 = _iQ2.setFromUnitVectors(_iV.subVectors(C, E).normalize(), _iV2.subVectors(Wr, E).normalize());   // swing the forearm
    // world swings → local rotations: a bone's new world = swing · old world, and so is its parent's below the swung bone
    U.parent.matrixWorld.decompose(_iS, _iQp, _iS2); U.matrixWorld.decompose(_iS, _iQu, _iS2); Lo.matrixWorld.decompose(_iS, _iQl, _iS2);
    const Pl = Lo.parent === U ? _iQu : (Lo.parent.matrixWorld.decompose(_iS, _iQl2, _iS2), _iQl2);
    const Ph = Hd.parent === Lo ? _iQl : (Hd.parent.matrixWorld.decompose(_iS, _iQh2, _iS2), _iQh2);
    K.qU.copy(_iQp).invert().multiply(q1).multiply(_iQu);
    K.qL.copy(q1).multiply(Pl).invert().multiply(q2).multiply(q1).multiply(_iQl);
    K.qH.copy(q2).multiply(q1).multiply(Ph).invert().multiply(Qh);
    if (K.w >= 1) { U.quaternion.copy(K.qU); Lo.quaternion.copy(K.qL); Hd.quaternion.copy(K.qH); }
    else { U.quaternion.slerp(K.qU, K.w); Lo.quaternion.slerp(K.qL, K.w); Hd.quaternion.slerp(K.qH, K.w); }
  }
  // an additive one-shot (manifest layer 'additive', 05 §2.6): its upper body is added on top of whatever plays (a hit
  // jolt during an attack); in over 0.05 s, out over its last 0.1 s
  playAdditive(name, ts = 1) {
    const a = this.action(name, 'upper'); if (!a) return false;
    a.blendMode = THREE.AdditiveAnimationBlendMode;
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = ts; a.play();
    const L = this.adds || (this.adds = []);
    let s = L.find(x => x.a === a); if (!s) L.push(s = { a, t: 0, len: 0, w: 0 });
    s.t = 0; s.len = this.clip(name).full.duration / ts;
    return true;
  }

  // The shield sits on the forearm (socket shield_l, +Y = its top, +Z = its face). Its bind frame follows the thumb,
  // which is only "up" with the forearm held level across the chest; in every other pose (arm hanging, swinging, a clip's
  // own guard) the shield would lie on its side. Roll it about its face normal so +Y points as close to world up as
  // the face allows: the face direction (what the shield covers) stays the forearm's. Fades out when the face points
  // up or down (no "up" left in the shield's plane).
  // the grip a merged weapon needs now: the playing attack's manifest grip once it is mostly in, else the locomotion
  // clip's, else the idle's (library clips carry none)
  gripMode() {
    const g = n => (n ? clipMeta(n.split('|')[0])?.grip ?? null : null), c = this.cur;
    return (c && c.w > 0.5 && g(c.name)) || g(this.loco.name) || this.baseGrip;
  }
  turnGrips(dt) {
    const want = this.gripMode() === 'rev' ? 1 : 0, step = Math.max(dt, 0) / 0.12;
    for (const G of this.gripTurn) {
      G.k += Math.max(-step, Math.min(step, want - G.k));
      G.node.quaternion.copy(G.rest); if (G.k > 0) G.node.quaternion.multiply(_hr.setFromAxisAngle(_Z, Math.PI * G.k));
    }
  }
  uprightShield() {
    const S = this.shieldUp, n = S.node, k = HAND_LAYER.shieldUpright;
    if (!(k > 0) || !n.parent) { n.quaternion.copy(S.rest); return; }
    n.parent.getWorldQuaternion(_sq).multiply(S.rest);                 // the shield's world rotation, unrolled
    _sz.set(0, 0, 1).applyQuaternion(_sq); _sy.set(0, 1, 0).applyQuaternion(_sq);
    _su.set(0, 1, 0).addScaledVector(_sz, -_sz.y); const l = _su.length(); // world up in the shield's plane
    const w = k * THREE.MathUtils.smoothstep(l, 0.15, 0.45);
    if (w <= 0) { n.quaternion.copy(S.rest); return; }
    _su.multiplyScalar(1 / l);
    const ang = Math.atan2(_sz.dot(_sx.crossVectors(_sy, _su)), _sy.dot(_su));
    n.quaternion.copy(S.rest).multiply(_hr.setFromAxisAngle(_Z, ang * w));
  }

  // clip set { full, upper, lower } for this champion (retargeted + cached per generated model)
  clip(name) {
    // "<clip>|offL": the clip with the left arm held in the idle pose — a shield, tome or relic stays in guard while
    // the right arm attacks (the generated motions swing the free arm for balance)
    if (name.endsWith('|offL')) {
      const cache = this.retarget ? this.clipCache : (this.offCache || (this.offCache = {}));
      const key = name + ':' + this.idle;
      if (key in cache) return cache[key];
      const base = this.clip(name.slice(0, -5)), idle = this.clip(this.idle);
      if (!base || !idle) return (cache[key] = base);
      const LEFT = /^(clavicle|upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)(_twist)?(_\d+|_metacarpal)?(_\d+)?_l$/i;
      const hold = (clip, from) => {
        const d = clip.duration, tracks = clip.tracks.filter(t => !LEFT.test(t.name.slice(0, t.name.lastIndexOf('.'))));
        for (const t of from.tracks) {
          const bone = t.name.slice(0, t.name.lastIndexOf('.'));
          if (!LEFT.test(bone) || !t.name.endsWith('.quaternion')) continue;
          const v = t.values.slice(0, 4);
          tracks.push(new THREE.QuaternionKeyframeTrack(t.name, [0, d], [...v, ...v]));
        }
        return new THREE.AnimationClip(clip.name + '|offL', d, tracks);
      };
      return (cache[key] = { full: hold(base.full, idle.full), upper: hold(base.upper, idle.upper), lower: base.lower });
    }
    const S = CLIPS[name];
    if (S && S.src === 'tripo') { // authored on a Tripo animation skeleton: retarget onto this body (cached per model)
      const src = S.source || animSource(), sk = src && src.key !== 'attacks' ? src.key : null; // sk: a manifest set's own skeleton
      if (!this.retarget) {
        if (!(name in TRIPO_UAL_CLIPS)) {
          const on = sk ? (TRIPO_ON[sk] ||= analyse(GL.Male_Ranger.scene, src.rest)) : TRIPO_ON_UAL;
          TRIPO_UAL_CLIPS[name] = on ? additive(name, splitClip(retargetClip(S.clean, on), LOWER)) : null;
        }
        return TRIPO_UAL_CLIPS[name];
      }
      const cache = this.clipCache, key = 'tripo:' + name;
      if (key in cache) return cache[key];
      const champ = this.champ;
      const AT = sk ? ((champ.ATs ||= {})[sk] ||= analyse(champ.scene, src.rest)) : (champ.AT ||= analyse(champ.scene, animSource().rest));
      return (cache[key] = additive(name, splitClip(retargetClip(S.clean, AT), LOWER)));
    }
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
    const lo = this.action(name, 'lower'), up = this.action(name, 'upper'); this.loco.a = up; // (its time: the IK's markers)
    lo.time = up.time = (this.loco.prev && this.actions[this.loco.prev + ':lower']) ? (this.actions[this.loco.prev + ':lower'].time / this.clip(this.loco.prev).full.duration) * this.clip(name).full.duration : 0;
  }

  // hitAt (basic melee swings): s from now at which the sim lands the blow. The clip is started / paced so
  // its impact frame falls exactly there. Ability strikes deal their damage at once, so without hitAt the
  // clip starts just before its impact frame (STRIKE_LEAD) instead of 0.2–0.3 s of wind-up after the number.
  // ability (optional): the ability's id — its own clip from the manifest's `abilities` table replaces the kind's ACTIONS
  // clip (kind may then be unknown); kind 'caststart' plays the start of its cast (the first of two `cast` clips)
  play(kind, dur = 0.5, hitAt, ability) {
    if (this.form) this.form.play(kind, dur, hitAt, ability); // a druid form plays its own action (forms.js)
    if (kind === 'flinch') { this.hit(1); return; }
    const abc = ability ? abilityClips(ability, { has }) : null;
    const own = abc ? (kind === 'caststart' ? (abc.cast.length > 1 ? abc.cast[0] : null) : abc.release) : null;
    const spec = ACTIONS[kind] || (own ? {} : null); if (!spec) return;
    // the stance set's attacks (animation manifest): a flat list picks at random without repeating the last one,
    // a nested list ([[right], [left]], dual wield) alternates its sub-lists on its own counter (05 §4.3 / §4.5)
    const man = !own && kind === 'attack' && attacksFor(this.cls, this.spec, { has });
    let list = own ? [own] : man || spec[this.lookKey] || spec[this.cls] || spec.any; if (!list) return;
    if (kind === 'attack' && !man && !own && !CLIPS[list[0]]) list = ATTACK_FALLBACK[this.lookKey] || ATTACK_FALLBACK[this.cls] || list;
    let base;
    if (own) base = own; // (an ability's clip leaves the attack counters alone)
    else if (man) {
      if (Array.isArray(list[0])) { this.dwSide = 1 - (this.dwSide || 0); list = list[this.dwSide % list.length]; }
      const pool = list.length > 1 ? list.filter(x => x !== this.lastAtk) : list;
      base = this.lastAtk = pool[Math.floor(Math.random() * pool.length)];
    } else { this.side = 1 - this.side; base = list[this.side % list.length]; }
    const m = clipMeta(base);
    if (m && m.layer === 'additive' && MANIFEST_CLIPS[base]) { this.playAdditive(base); return; } // on top: the action goes on
    // a Tripo right-hand attack keeps a shield / tome / relic in the left hand still (manifest clips say so: offL)
    const name = CLIPS[base]?.src === 'tripo' && this.offHand && (m ? m.offL : ATTACK_ANIMS[base]?.hand !== 'l') ? base + '|offL' : base;
    const clip = this.clip(name); if (!clip) return;
    if (this.cur) { this.cur.out = true; }
    const full = m ? m.layer === 'full' : !!spec.full;
    const a = this.action(name, full ? 'full' : 'upper');
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play();
    // fit the clip into roughly the requested time (attacks follow the swing timer)
    const len = clip.full.duration;
    const want = Math.max(dur, 0.25);
    // Tripo attack animations are already cut to one attack and play at their natural speed (real-world timing)
    const natural = CLIPS[base]?.speed;
    const ts = natural || Math.max(0.8, Math.min(2.4, len / Math.max(want, len * 0.45)));
    const I = IMPACT[base];
    let t0 = 0, pre = 0, lead = 0;
    if (I !== undefined && natural) {
      // Tripo attacks: the whole wind-up is shown, sped up (≤ 2.2×) so the blow lands at hitAt; strike, follow-through
      // and recovery then run at natural speed. A ranged shot leaves at the click, so its release is played a moment
      // after it (RANGED_LEAD) — the bolt and the flick read as one motion.
      lead = hitAt !== undefined ? hitAt : (kind === 'attack' ? RANGED_LEAD : STRIKE_LEAD);
      const ws = Math.min(2.2, Math.max(ts, I / lead));
      t0 = Math.max(0, I - lead * ws); pre = ws;
    } else if (I !== undefined) {
      lead = hitAt !== undefined ? hitAt : STRIKE_LEAD;
      if (I / ts > lead) t0 = I - lead * ts;               // long wind-up: start part-way into it
      else if (I / ts < lead - 0.02) pre = I / lead;       // short wind-up: play it slower up to the blow
    }
    a.time = t0; a.timeScale = pre || ts;
    const fullA = full ? null : this.action(name, 'full');
    if (fullA) { fullA.reset(); fullA.setLoop(THREE.LoopOnce, 1); fullA.clampWhenFinished = true; fullA.time = t0; fullA.timeScale = a.timeScale; fullA.play(); }
    this.prevAct = this.cur;
    this.cur = { kind, name, id: base, t: 0, len: pre ? lead + (len - I) / ts : (len - t0) / ts, a, fullA, full, w: 0, ts, pre: pre ? lead : 0 };
    this.act = this.cur;
    this.lastSide = own && m ? (m.hand === 'l' ? 1 : 0) : this.side;
  }

  hit(strength = 1) {
    if (this.deadT > 0) return;
    if (this.form) this.form.hit(strength); // the form flinches too (additive, also during its attacks)
    this.hitT = 0.3; this.hitBig = strength >= 2 ? 1 : 0;
    if (!this.cur || this.cur.kind === 'hit') {
      const name = strength >= 2 ? 'Hit_Knockback' : MANIFEST_CLIPS.cm_hit_front ? 'cm_hit_front' : Math.random() < 0.5 ? 'Hit_Chest' : 'Hit_Head';
      if (MANIFEST_CLIPS[name] && clipMeta(name).layer === 'additive') { this.playAdditive(name, 1.4); return; }
      const a = this.action(name, 'upper'); if (!a) return;
      a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = 1.4; a.play();
      if (this.cur) this.cur.out = true;
      this.cur = { kind: 'hit', name, t: 0, len: this.clip(name).full.duration / 1.4, a, fullA: null, full: false, w: 0 };
    } else if (MANIFEST_CLIPS.cm_hit_add && clipMeta('cm_hit_add').layer === 'additive') this.playAdditive('cm_hit_add'); // 05 §4.2: a jolt on top of the action (else swallowed)
  }

  hitStop(t) { this.stopT = Math.max(this.stopT || 0, t); }
  hasAbilityClip(ab) { return !!abilityClips(ab, { has })?.release; } // the manifest names a clip for this ability (world.js)
  flash(k = 1) { if (this.form) this.form.flash(k); if (this.flashMats && this.opacity > 0.9) this.flashK = Math.max(this.flashK || 0, k); }

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
      const tr = a < 0.999 || !!m.userData.baseTransparent;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } // three r170 compiles opaque materials with alpha forced to 1
      m.opacity = m.userData.baseOpacity * a;
      m.depthWrite = a > 0.99 && !m.userData.baseTransparent;
    }
    if (this.form) this.form.setOpacity(a); // a druid form fades with the champion
    this.root.visible = a > 0.02;
  }

  // st: { speed, back, strafe, air, casting, castProgress, stunned, disoriented, dead, victory, tempest }
  update(dt, st = {}) {
    // Druid shapeshift (cat / bear) and Tree of Life: forms.js swaps the humanoid for the form's model (cover burst,
    // shift-in) and runs the form's own state machine; it takes this.stopT's hit-stop slow-down like the body below
    const fk = st.tree ? 'tree' : (st.form || null);
    if (fk || this.form) (this.form ||= new FormController(this)).update(dt, st, fk);
    this.time += dt;
    // hit flash: a short warm glow on the body when a blow lands on this champion
    if (this.flashK > 0) { this.flashK = Math.max(0, this.flashK - dt * 5.5); const k = this.flashK * this.flashK * 0.42; for (const m of this.flashMats || []) m.emissive.setRGB(k, k * 0.82, k * 0.62); }
    // hit-stop: the body holds for a few frames on the moment its weapon connects
    if (this.stopT > 0) { this.stopT -= dt; dt *= 0.06; }
    const speed = st.speed || 0;
    // an ability's own cast clips (manifest `abilities[id].cast`: [start, loop] or [loop]; st.castAb = the id of the
    // ability being cast): the start plays as a one-shot, the loop replaces the cast pose (standing: the whole body)
    if ((st.castAb || null) !== (this.castAb || null)) {
      this.castAb = st.castAb || null;
      const cc = this.castAb ? abilityClips(this.castAb, { has }) : null, loop = cc && cc.cast.length ? cc.cast[cc.cast.length - 1] : null;
      this.castLoop = loop && this.clip(loop) ? loop : null;
      if (cc && cc.cast.length > 1) this.play('caststart', 0.3, undefined, this.castAb);
    }
    // ---- choose the locomotion / pose clip
    let loco = this.idle, rate = 1;
    if (st.dead) loco = 'Death01';
    else if (st.victory) loco = this.cls === 'warrior' ? 'Sword_Idle' : 'Dance_Loop';
    else if (st.tempest) { loco = 'Sword_Regular_Combo'; rate = 1.6; }
    else if (st.air) loco = 'Jump_Loop';
    else if (speed > 1.12) { loco = 'Sprint_Loop'; rate = speed / 1.3; }
    else if (speed > 0.08) {
      loco = this.look.walk || resolveClip('cm_run', has) || 'Jog_Fwd_Loop'; rate = Math.max(0.55, speed) * (st.back ? -0.85 : 1);
      // a manifest run: playback rate = ground speed / (stride x height / 1.95), so the feet don't slide (capped: a
      // short-strided clip on a fast champion would spin its legs; it slides a little instead)
      const rm = clipMeta(loco);
      if (rm?.stride && st.v) { const h = 1.865 * (this.look.scale || 1) * (RACE_HEIGHT[this.race] || 1); rate = Math.min(RUN_RATE_MAX, Math.max(0.55, st.v * this.clip(loco).full.duration / (rm.stride * h / 1.95))) * (st.back ? -0.85 : 1); }
    }
    else if (st.casting) loco = this.castLoop || this.look.castPose || 'Spell_Simple_Idle_Loop';
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
      if (c.pre && c.t >= c.pre) { c.a.timeScale = c.ts; if (c.fullA) c.fullA.timeScale = c.ts; c.pre = 0; } // slowed wind-up is over: follow through at full speed
      const fadeIn = 0.08, fadeOut = Math.min(0.2, c.len * 0.35);
      c.w = c.out ? Math.max(0, c.w - dt / 0.12) : c.t < fadeIn ? c.t / fadeIn : c.t > c.len - fadeOut ? Math.max(0, (c.len - c.t) / fadeOut) : 1;
      if (c.t >= c.len || (c.out && c.w <= 0)) { c.a.setEffectiveWeight(0); c.fullA && c.fullA.setEffectiveWeight(0); this.cur = c.out ? this.cur : null; if (this.cur === c) this.cur = null; this.act = this.cur; }
      else actW = c.w;
    }
    if (this.prevAct && this.prevAct !== this.cur) { const p = this.prevAct; p.w = Math.max(0, p.w - dt / 0.1); p.a.setEffectiveWeight(p.w); p.fullA && p.fullA.setEffectiveWeight(0); if (p.w <= 0) this.prevAct = null; }
    // casting holds the spell pose on the upper body even while moving
    const castPose = this.castLoop || this.look.castPose || 'Spell_Simple_Idle_Loop';
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
      if (a.blendMode === THREE.AdditiveAnimationBlendMode) continue; // additive one-shots: weighted below
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
    if (this.adds) for (let i = 0; i < this.adds.length; i++) { // additive one-shots on top (playAdditive)
      const s = this.adds[i]; if (!(s.len > 0)) continue;
      s.t += dt;
      if (dying || s.t >= s.len) { s.len = 0; s.w = 0; } else s.w = Math.min(1, s.t / 0.05, (s.len - s.t) / 0.1);
      s.a.setEffectiveWeight(s.w);
    }
    if (this.layerSaved) for (const S of this.layerSaved) S.node.quaternion.copy(S.q); // hand layer: back to the animated values
    this.mixer.update(dt);
    // weapons turn into the fist grip while a Tripo attack plays (see fistGrips)
    if (this.fistWeapons) {
      // the attack that is fading in (or the one fading out) decides the grip; 'idle' clips keep the idle hold
      const gripOf = x => { const id = x && x.name.split('|')[0]; return id && CLIPS[id]?.src === 'tripo' ? (clipMeta(id)?.grip ?? ATTACK_ANIMS[id]?.grip) || 'fist' : null; };
      const a = gripOf(c) ? c : gripOf(this.prevAct) ? this.prevAct : null, mode = gripOf(a);
      const lm = gripOf({ name: this.loco.name }), same = lm && lm !== 'idle' && (!a || mode === lm);
      const g = same ? 1 : !a || mode === 'idle' ? 0 : a === c ? actW : a.w;
      const key = { rev: 'revQ', palm: 'palmQ', palmRev: 'palmRevQ' }[same ? lm : mode] || 'fistQ';
      for (const wp of this.fistWeapons) wp.quaternion.slerpQuaternions(wp.userData.idleQ, wp.userData[key] || wp.userData.fistQ, g);
    }
    // hand layer (assembled champions: fingers on the merged items, shield wrist lock; two-hand IK): after the weapons'
    // turn in the fist above, so the IK reads grip2 where the weapon is this frame
    if (this.ik) this.ik.want = this.ikWant(c, actW, castPose, castA);
    if (this.layerSaved) this.handLayer(dt);

    // ---- procedural layers on top of the animation
    const b = this.bones;
    if (st.tempest) this.body.rotation.y += dt * 16; else this.body.rotation.y += (this.strafeYaw(st) - this.body.rotation.y) * Math.min(1, dt * 10);
    if (st.stunned && !dying) { this.addRot(b.Head, 0.45 + Math.sin(this.time * 3) * 0.12, 0, Math.sin(this.time * 2) * 0.2); this.addRot(b.spine_03, 0.25, 0, 0); }
    if (st.disoriented && !dying) { this.addRot(b.Head, -0.2, Math.sin(this.time * 2.4) * 0.5, 0); this.addRot(b.spine_02, 0, Math.sin(this.time * 2.4) * 0.25, 0); }
    if (this.hitT > 0) { this.hitT -= dt; const k = Math.max(0, this.hitT / 0.3); this.addRot(b.spine_02, -0.25 * k * (1 + this.hitBig), 0, 0); }
    if (st.casting && b.hand_r) { this.addRot(b.spine_03, -0.05, 0, 0); }
    // orcs, trolls, undead and bull-folk lean into the world; the head stays level. Jungle trolls stoop the most:
    // a deep rounded back, head thrust forward and a loose crouch in the knees.
    // The silverback gorilla (look.hunch / look.knee) leans further still, on bent knees.
    const troll = this.race === 'troll';
    const hunch = this.look.hunch ?? this.raceDef.hunch * (troll ? 1.7 : 1);
    if (hunch && !dying) { this.addRot(b.spine_02, hunch * 0.45, 0, 0); this.addRot(b.spine_03, hunch * 0.55, 0, 0); this.addRot(b.neck_01, -hunch * 0.6, 0, 0); this.addRot(b.Head, -hunch * 0.35, 0, 0); }
    if (this.baseY === undefined) this.baseY = this.body.position.y;
    const knee = this.look.knee ?? (troll ? TROLL_KNEE : 0);
    const crouch = knee && !dying && !st.air;
    this.body.position.y = this.baseY - (crouch ? 0.2 * -knee * this.look.scale : 0); // keep the feet on the ground
    if (crouch) { const k = knee; this.addRot(b.thigh_l, k, 0, 0); this.addRot(b.thigh_r, k, 0, 0); this.addRot(b.calf_l, -k * 1.6, 0, 0); this.addRot(b.calf_r, -k * 1.6, 0, 0); this.addRot(b.foot_l, k * 0.6, 0, 0); this.addRot(b.foot_r, k * 0.6, 0, 0); }
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

  // 5v5 level of detail (docs/remodel/07 §5): LOD0 below 22 m, LOD1 to 45 m, then the last LOD (the shadow proxy,
  // which then also draws in colour); 5 % hysteresis each way. 1v1 / 2v2 never call this (LOD0 always).
  setLodDistance(d) {
    const L = this.lods; if (!L || L.length < 2) return;
    const last = L.length - 1, T = last === 2 ? [22, 45] : [45];
    let k = this.lodK || 0;
    while (k < T.length && d > T[k] * 1.05) k++;
    while (k > 0 && d < T[k - 1] * 0.95) k--;
    if (k === (this.lodK || 0)) return;
    this.lodK = k;
    L.forEach((m, i) => { if (!m) return; if (i === last) { if (k === last) m.layers.enable(0); else m.layers.disable(0); } else m.visible = i === k; });
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
