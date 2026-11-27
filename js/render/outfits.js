// Race anatomy and spec gear sets for the rigged champions.
//
// buildRace(K): ears, tusks, beards, horns, hooves … for the champion's race (proportions and face
// shape are already baked into the body by races.js).
// buildOutfit(K): every class + spec has its OWN equipment set — different pauldrons, helm, chest,
// arms, legs, belt, back items and accessories (different geometry and materials, not a recolour).
// Pieces are authored in world space on the rest pose and re-parented to bones by K.put / K.along
// (armory.js), then merged into a handful of meshes per bone, so a fully geared champion stays cheap.
//
// K: { ch, cls, spec, race, b (bones), L (world landmarks), k (torso size), M (materials), put, along,
//      gauntlets, greaves, belt, tassets, cape, tabard, shoulders, breastplate, furMantle, animated, H (helpers) }
import * as THREE from 'three';
import { RACES } from './races.js';

// extra materials (cached)
const SHADOW = new THREE.MeshBasicMaterial({ color: 0x050308 }); // hood interiors, visor slits (shared)
const MX = new Map();
function mats(M) {
  if (MX.has(M)) return MX.get(M);
  const X = {
    ice: new THREE.MeshStandardMaterial({ color: 0xbfeaff, emissive: 0x3a8acf, emissiveIntensity: 0.9, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88 }),
    ember: new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff5a10, emissiveIntensity: 2.4, roughness: 0.4 }),
    void: new THREE.MeshStandardMaterial({ color: 0x2a1040, emissive: 0x6a2aaf, emissiveIntensity: 1.1, roughness: 0.5 }),
    moss: new THREE.MeshStandardMaterial({ color: 0x4a6a2a, roughness: 1, flatShading: true }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x5aa83a, emissive: 0x1a4a0a, emissiveIntensity: 0.4, roughness: 0.8, side: THREE.DoubleSide }),
    petal: new THREE.MeshStandardMaterial({ color: 0xffc8e8, emissive: 0x803060, emissiveIntensity: 0.3, roughness: 0.7, side: THREE.DoubleSide }),
    hoof: new THREE.MeshStandardMaterial({ color: 0x1e1814, roughness: 0.55, metalness: 0.1 }),
    feather: new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.9, side: THREE.DoubleSide }),
    redFeather: new THREE.MeshStandardMaterial({ color: 0xa82a1a, roughness: 0.9, side: THREE.DoubleSide }),
    paint: new THREE.MeshStandardMaterial({ color: 0x9a1a14, roughness: 0.9 }),
    chain: new THREE.MeshStandardMaterial({ color: 0x6a6a70, roughness: 0.45, metalness: 1, bumpMap: M.ivory.bumpMap, bumpScale: 1.5 }),
    whiteSteel: new THREE.MeshStandardMaterial({ color: 0xe6e8ee, roughness: 0.2, metalness: 1, normalMap: M.steel.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 1.4 }),
    blueSteel: new THREE.MeshStandardMaterial({ color: 0x8aa0c8, roughness: 0.28, metalness: 1, normalMap: M.steel.normalMap, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.3 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x3a3634, roughness: 0.55, metalness: 0.9, normalMap: M.steel.normalMap, normalScale: new THREE.Vector2(0.8, 0.8) }),
    rust: new THREE.MeshStandardMaterial({ color: 0x6a3a22, roughness: 0.75, metalness: 0.6, normalMap: M.steel.normalMap, normalScale: new THREE.Vector2(1, 1) }),
    venom: new THREE.MeshStandardMaterial({ color: 0x5aff3a, emissive: 0x3aff2a, emissiveIntensity: 1.8, roughness: 0.2, transparent: true, opacity: 0.85 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xa0c0a0, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.45 }),
    jade: new THREE.MeshStandardMaterial({ color: 0x3aa87a, emissive: 0x0a4a2a, emissiveIntensity: 0.6, roughness: 0.3 }),
    teal: new THREE.MeshStandardMaterial({ color: 0x1a5a6a, roughness: 0.9, bumpMap: M.ivory.bumpMap, bumpScale: 0.4, side: THREE.DoubleSide }),
    olive: new THREE.MeshStandardMaterial({ color: 0x2a3a1a, roughness: 0.9, bumpMap: M.ivory.bumpMap, bumpScale: 0.4, side: THREE.DoubleSide }),
    violet: new THREE.MeshStandardMaterial({ color: 0x3a1a52, roughness: 0.92, bumpMap: M.ivory.bumpMap, bumpScale: 0.4, side: THREE.DoubleSide }),
    white: new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.85, bumpMap: M.ivory.bumpMap, bumpScale: 0.4, side: THREE.DoubleSide }),
    sky: new THREE.MeshStandardMaterial({ color: 0x2a4a8a, roughness: 0.85, bumpMap: M.ivory.bumpMap, bumpScale: 0.4, side: THREE.DoubleSide }),
  };
  for (const v of Object.values(X)) v.userData.shared = true; SHADOW.userData.shared = true;
  MX.set(M, X); return X;
}
const HAIR = new Map();
const hairMat = (rgb, M) => { const key = rgb.join(','); if (!HAIR.has(key)) { const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(...rgb), roughness: 0.85, bumpMap: M.fur.bumpMap, bumpScale: 1.5 }); m.userData.shared = true; HAIR.set(key, m); } return HAIR.get(key); };

// ------------------------------------------------------------------ shared builders
function setup(K) {
  const { ch, L, H } = K, { V } = H;
  const R = RACES[K.race] || RACES.human, sc = ch.look.scale || 1;
  const hs = R.bones.Head || [1, 1, 1];
  K.kh = sc * (hs[0] + hs[2]) / 2;                         // head size
  K.ka = sc * ((R.bones.lowerarm || [1])[0]);               // forearm thickness
  K.kl = sc * ((R.bones.calf || [1])[0]);                   // calf thickness
  K.X = mats(K.M);
  // face-space point: origin at eye level on the head's centre line (x = side, y = up, z = forward)
  K.F = (x, y, z) => L.head.clone().add(V(x * K.kh, (0.1 + y) * K.kh, (0.015 + z) * K.kh));
  K.onHead = (obj, x, y, z, o) => K.put('Head', obj, K.F(x, y, z), o);
  // both shoulders: make(s) builds a pauldron (+X outward); placed on the clavicles
  K.pads = (make, { up = 0.06, out = 0.025, along = 0.75 } = {}) => {
    for (const [cl, sh, bone, s] of [[L.lcl, L.lsh, 'clavicle_l', 1], [L.rcl, L.rsh, 'clavicle_r', -1]]) {
      const p = cl.clone().lerp(sh, along).add(V(s * out * K.k, up * K.k, 0));
      K.put(bone, make(s), p, { yaw: s > 0 ? 0 : Math.PI });
    }
  };
  K.chest = (obj, dy = 0, dz = 0, o, dx = 0) => K.put('spine_03', obj, L.chest.clone().add(V(dx * K.k, dy * K.k, dz * K.k)), o);
  K.hips = (obj, dx = 0, dy = 0, dz = 0, o) => K.put('pelvis', obj, L.pelvis.clone().add(V(dx * K.k, dy * K.k, dz * K.k)), o);
  // forearms / shins: build(s) along the limb
  K.forearms = (build, off = 0.12) => { for (const [el, ha, bone, s] of [[L.lel, L.lha, 'lowerarm_l', 1], [L.rel, L.rha, 'lowerarm_r', -1]]) K.along(bone, build(s), el, ha, off); };
  K.shins = (build, off = -0.12) => { for (const [kn, ft, bone, s] of [[L.lkn, L.lft, 'calf_l', 1], [L.rkn, L.rft, 'calf_r', -1]]) K.along(bone, build(s), kn, ft, off); };
}

// a robe / skirt hanging from the hips (lathe), with an optional trim ring at the hem
function skirt(K, mat, { len = 0.82, top = 0.17, flare = 0.33, trim = null, open = false } = {}) {
  const { H } = K, { V, mesh } = H, k = K.k;
  const pts = [V(flare * k, -len * k), V((top + flare * 0.55) * k, -len * 0.7 * k), V((top + 0.05) * k, -len * 0.25 * k), V(top * k, 0)]; // bottom → top: normals face outward
  const geo = new THREE.LatheGeometry(pts, 24, open ? 0.5 : 0, open ? Math.PI * 2 - 1.0 : Math.PI * 2);
  const s = mesh(geo, mat); s.scale.z = 0.9;
  const g = new THREE.Group(); g.add(s);
  if (trim && !open) { const t = mesh(H.tor(flare * k, 0.012, 6, 36), trim, false); t.rotation.x = Math.PI / 2; t.position.y = -len * k; t.scale.y = 0.9; g.add(t); }
  K.hips(g, 0, 0.04, 0);
  return g;
}
// strips hanging from the belt (kilt / loincloth)
function kilt(K, matA, matB, { n = 7, len = 0.26, arc = 3.4, w = 0.075 } = {}) {
  const { H } = K, k = K.k;
  for (let i = 0; i < n; i++) { const a = (i / (n - 1) - 0.5) * arc; const f = H.mesh(H.box(w * k, len * k, 0.02), i % 2 ? matA : matB); f.position.y = -len * 0.5 * k; const g = new THREE.Group(); g.add(f); K.hips(g, Math.sin(a) * 0.165, -0.03, Math.cos(a) * 0.15, { yaw: a, pitch: 0.16 }); }
}
// straps crossing the chest (harness / baldric)
function strap(K, mat, { dir = 1, r = 0.012, dz = 0.15 } = {}) {
  const { H } = K, { V } = H, k = K.k, pts = [];
  for (let i = 0; i <= 10; i++) { const u = i / 10, x = (u - 0.5) * 0.4 * k * dir, y = (u - 0.5) * 0.46 * k; const z = Math.cos((u - 0.5) * 2.2) * dz * k; pts.push(V(x, y, z)); }
  const back = pts.map(p => V(p.x, p.y, -p.z * 0.95)).reverse();
  const g = new THREE.Group(); g.add(H.mesh(H.tube(pts, r * k, 20, 5), mat), H.mesh(H.tube(back, r * k, 20, 5), mat));
  K.chest(g, -0.02, 0);
  return g;
}
// big beard (dwarves): full volume from the jaw onto the chest, moustache and two ringed braids
function beard(K, mat, { len = 0.36, ring = null } = {}) {
  const { H } = K, { V, mesh } = H;
  const g = new THREE.Group();
  const prof = []; for (let i = 0; i <= 8; i++) { const u = i / 8; prof.push(V(0.092 * Math.sin(Math.min(1, u * 2.4) * Math.PI * 0.5) * (1 - u * 0.7) + 0.004, -u * len)); }
  const main = mesh(new THREE.LatheGeometry(prof, 14), mat); main.scale.set(1.25, 1, 0.62); main.rotation.x = 0.28; g.add(main);
  for (const s of [-1, 1]) {
    const mo = mesh(H.tube([V(0, 0, 0), V(s * 0.03, -0.01, 0.01), V(s * 0.06, -0.035, 0.0), V(s * 0.07, -0.07, -0.01)], 0.012, 10, 5), mat); mo.position.set(s * 0.008, 0.045, 0.035); g.add(mo);
    const br = new THREE.Group();
    for (let i = 0; i < 6; i++) { const bead = mesh(H.sph(0.018 - i * 0.0015, 7, 5), mat); bead.position.set(0, -i * 0.032, 0); br.add(bead); }
    if (ring) { const r = mesh(H.cyl(0.016, 0.016, 0.025, 8), ring); r.position.y = -0.17; br.add(r); }
    br.position.set(s * 0.05, -0.1, 0.03); br.rotation.set(0.25, 0, s * 0.06); g.add(br);
  }
  const brows = []; for (const s of [-1, 1]) { const b = mesh(H.box(0.05, 0.018, 0.024), mat); b.position.set(s * 0.036, 0.125, 0.012); b.rotation.z = -s * 0.2; brows.push(b); }
  g.scale.setScalar(K.kh); K.onHead(g, 0, -0.105, 0.075);
  const bw = new THREE.Group(); bw.add(...brows); bw.scale.setScalar(K.kh); K.onHead(bw, 0, -0.105, 0.075);
}
// mohawk / crest of hair spikes along the skull
function mohawk(K, mat, { n = 9, h = 0.11, w = 0.022 } = {}) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) { const u = i / (n - 1); const m = K.H.mesh(K.H.cone(w, h * (0.75 + Math.sin(u * Math.PI) * 0.45), 5), mat); m.position.set(0, 0.11 + Math.sin(u * Math.PI) * 0.012, 0.08 - u * 0.21); m.rotation.x = -0.3 - u * 0.6; g.add(m); }
  g.scale.setScalar(K.kh); K.onHead(g, 0, 0, -0.015);
}
// topknot: a tied bun at the back of the crown with a falling tail
function topknot(K, mat, ringMat) {
  const { H } = K, { V } = H, g = new THREE.Group();
  const bun = H.mesh(H.sph(0.035, 10, 8), mat); bun.position.set(0, 0.13, -0.03); g.add(bun);
  g.add(H.mesh(H.tube([V(0, 0.13, -0.04), V(0, 0.12, -0.11), V(0, 0.03, -0.14), V(0, -0.08, -0.13)], 0.02, 12, 6), mat));
  if (ringMat) { const r = H.mesh(H.cyl(0.026, 0.026, 0.03, 10), ringMat); r.position.set(0, 0.125, -0.07); r.rotation.x = 1.2; g.add(r); }
  g.scale.setScalar(K.kh); K.onHead(g, 0, -0.02, 0);
}
// hood / cowl: deep, open at the face, dark inside
function hood(K, mat, { eyes = null, peak = 0.06 } = {}) {
  const { H } = K, { V, mesh } = H, g = new THREE.Group();
  const shell = mesh(H.sph(0.155, 22, 16, Math.PI * 0.72, Math.PI * 1.56, 0, Math.PI * 0.72), mat); shell.scale.set(1.0, 1.08, 1.12); g.add(shell); // open at the face (+Z)
  const tip = mesh(H.cone(0.06, peak + 0.06, 10), mat); tip.position.set(0, 0.165, -0.04); tip.rotation.x = -0.5; g.add(tip);
  const dark = mesh(H.sph(0.14, 16, 12), SHADOW); dark.scale.set(0.92, 1.0, 0.55); dark.position.set(0, -0.01, 0.025); g.add(dark);
  const drape = mesh(new THREE.LatheGeometry([V(0.12, 0), V(0.17, -0.08), V(0.24, -0.16)], 18, Math.PI * 0.2, Math.PI * 1.6), mat); drape.position.y = -0.1; g.add(drape);
  if (eyes) for (const s of [-1, 1]) { const e = mesh(H.sph(0.011, 8, 6), eyes, false); e.position.set(s * 0.035, 0.0, 0.1); g.add(e); }
  g.scale.setScalar(K.kh); K.onHead(g, 0, 0.01, -0.01);
}
// pauldron styles (local: +X outward, +Y up, +Z forward), r = radius
const P = {
  spiked(K, r, mat, trim, { n = 3, tusk = false } = {}) {
    const { H } = K, g = H.pauldron(K.M, { r, plates: 3, mat, trim, spikes: 0 });
    for (let i = 0; i < n; i++) { const s = H.spike(r * 0.2, r * (1.1 + (i === 1 ? 0.4 : 0)), trim === K.M.bone ? K.M.bone : K.X.iron); s.position.set(r * (0.15 + i * 0.12), r * 0.55, (i - (n - 1) / 2) * r * 0.55); s.rotation.set((i - 1) * 0.35, 0, -0.55 - i * 0.1); g.add(s); }
    if (tusk) { const t = H.horn(r * 1.1, r * 0.13, 1.6, K.M.bone); t.position.set(r * 0.8, -r * 0.1, r * 0.4); t.rotation.set(0.4, 0, -1.9); g.add(t); }
    return g;
  },
  square(K, r, mat, trim) {
    const { H } = K, g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const p = H.mesh(H.box(r * 1.9 * (1 - i * 0.08), r * 0.16, r * 2.0 * (1 - i * 0.06)), mat); p.position.set(i * r * 0.2, r * 0.25 - i * r * 0.36, 0); p.rotation.z = -0.32 - i * 0.2; g.add(p);
      const t = H.mesh(H.box(r * 0.08, r * 0.2, r * 2.04 * (1 - i * 0.06)), trim, false); t.position.set(r * 0.95 * (1 - i * 0.08), 0, 0); p.add(t);
    }
    const ridge = H.mesh(H.box(r * 1.4, r * 0.18, r * 0.12), trim); ridge.position.set(-r * 0.1, r * 0.48, 0); ridge.rotation.z = -0.32; g.add(ridge);
    const disc = H.mesh(H.cyl(r * 0.32, r * 0.32, r * 0.08, 18), trim); disc.position.set(r * 0.62, -r * 0.05, 0); disc.rotation.z = Math.PI / 2 - 0.5; g.add(disc);
    const gem = H.mesh(H.sph(r * 0.12, 10, 8), K.M.gem(0x6ab0ff), false); gem.position.set(r * 0.68, -r * 0.0, 0); g.add(gem);
    return g;
  },
  sun(K, r) {
    const { H } = K, g = H.pauldron(K.M, { r, plates: 2, mat: K.X.whiteSteel, trim: K.M.gold });
    for (let i = 0; i < 9; i++) { const a = (i / 8 - 0.5) * 2.6; const ray = H.spike(r * 0.09, r * (0.55 + (i % 2) * 0.35), K.M.gold); ray.position.set(r * 0.55 + Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5 + r * 0.15, Math.sin(a * 0.6) * 0.0); ray.rotation.z = a - Math.PI / 2; g.add(ray); }
    const core = H.mesh(H.sph(r * 0.16, 10, 8), K.M.rune(0xfff0a0, 2.4), false); core.position.set(r * 0.62, r * 0.12, 0); g.add(core);
    return g;
  },
  crystal(K, r) {
    const { H } = K, g = H.pauldron(K.M, { r: r * 0.85, plates: 2, mat: K.M.silver, trim: K.X.blueSteel });
    const sh = [[0.2, 0.6, 0, 1.2, -0.3], [0.45, 0.4, 0.35, 0.9, -0.7], [0.45, 0.4, -0.35, 0.85, -0.7], [0.05, 0.55, 0.4, 0.7, 0.1], [0.05, 0.55, -0.4, 0.75, 0.1]];
    for (const [x, y, z, l, rz] of sh) { const c = H.mesh(new THREE.OctahedronGeometry(r * 0.22, 0), K.X.ice); c.scale.set(0.55, l * 2.2, 0.55); c.position.set(x * r, y * r + l * r * 0.35, z * r); c.rotation.set(z * 0.8, 0, rz); g.add(c); }
    return g;
  },
  phoenix(K, r) {
    const { H } = K, g = H.pauldron(K.M, { r: r * 0.9, plates: 2, mat: K.M.gold, trim: K.M.crimson });
    for (let f = 0; f < 4; f++) { const w = H.mesh(H.extrude([[0, 0], [0.05, 0.03], [0.24 - f * 0.03, 0.2 + f * 0.03], [0.03, 0.06]].map(([x, y]) => [x * r / 0.14, y * r / 0.14]), 0.01, 0.003), f % 2 ? K.M.gold : K.M.crimson); w.position.set(r * 0.2, r * 0.2, -r * 0.3 + f * r * 0.12); w.rotation.set(0, 0.5, 0.35 + f * 0.12); g.add(w); }
    const gem = H.mesh(H.sph(r * 0.14, 10, 8), K.X.ember, false); gem.position.set(r * 0.62, r * 0.18, 0); g.add(gem);
    return g;
  },
  tendril(K, r) {
    const { H } = K, g = H.pauldron(K.M, { r: r * 0.85, plates: 2, mat: K.M.blacksteel, trim: K.X.void });
    for (let i = 0; i < 4; i++) { const t = H.horn(r * (1.2 + i * 0.15), r * 0.1, 2.2 + i * 0.2, K.M.blacksteel); t.position.set(r * 0.2 + i * r * 0.12, r * 0.4, (i - 1.5) * r * 0.32); t.rotation.set(-0.3 + i * 0.2, 0, -0.5 - i * 0.15); g.add(t);
      const tip = H.mesh(H.sph(r * 0.06, 6, 4), K.X.void, false); tip.position.set(r * (0.75 + i * 0.12), r * (1.1 + i * 0.1), (i - 1.5) * r * 0.32); g.add(tip); }
    return g;
  },
  bark(K, r) {
    const { H } = K, g = H.pauldron(K.M, { r, plates: 3, mat: K.M.darkwood, trim: K.M.wood });
    for (let i = 0; i < 6; i++) { const m = H.mesh(H.sph(r * (0.18 + (i % 3) * 0.05), 6, 5), K.X.moss); m.position.set(r * (0.05 + (i % 3) * 0.25), r * (0.55 - (i % 3) * 0.12), (i < 3 ? 1 : -1) * r * (0.25 + (i % 2) * 0.25)); g.add(m); }
    for (let i = 0; i < 5; i++) { const lf = H.mesh(new THREE.CircleGeometry(r * 0.22, 5), K.X.leaf, false); lf.scale.y = 1.8; lf.position.set(r * (0.3 + i * 0.1), r * 0.7, (i - 2) * r * 0.3); lf.rotation.set(-0.8, (i - 2) * 0.4, -0.4); g.add(lf); }
    const fl = H.mesh(H.sph(r * 0.1, 8, 6), K.X.petal, false); fl.position.set(r * 0.4, r * 0.78, 0); g.add(fl);
    return g;
  },
  skull(K, r, mat, trim) { return K.H.pauldron(K.M, { r, plates: 2, mat, trim, spikes: 2, skull: true }); },
  beast(K, r) { // a great beast skull worn as a pauldron, with tusks
    const { H } = K, g = H.pauldron(K.M, { r: r * 0.8, plates: 2, mat: K.M.leather, trim: K.M.bone });
    const sk = H.skullMesh(K.M, r * 0.6); sk.scale.set(1.2, 1.0, 1.5); sk.position.set(r * 0.45, r * 0.55, r * 0.1); sk.rotation.y = Math.PI / 2 - 0.3; g.add(sk);
    for (const z of [-1, 1]) { const t = H.horn(r * 0.9, r * 0.09, 1.8, K.M.bone); t.position.set(r * 0.5, r * 0.4, z * r * 0.32); t.rotation.set(z * 0.5, 0, -1.2); g.add(t); }
    return g;
  },
  storm(K, r) { // Enhancement: banded leather pad with a crackling storm orb and a wolf-fang fringe
    const { H } = K, g = H.pauldron(K.M, { r, plates: 3, mat: K.X.rust, trim: K.M.bronze });
    const orb = H.mesh(H.sph(r * 0.22, 12, 10), K.M.rune(0x7ae8ff, 2.6), false); orb.position.set(r * 0.55, r * 0.5, 0); g.add(orb);
    const cage = H.mesh(H.tor(r * 0.26, r * 0.03, 4, 12), K.M.bronze); cage.position.copy(orb.position); cage.rotation.x = Math.PI / 2; g.add(cage);
    for (let i = 0; i < 6; i++) { const t = H.mesh(H.cone(r * 0.05, r * 0.26, 4), K.M.bone, false); t.position.set(r * 0.9, -r * 0.2, (i - 2.5) * r * 0.22); t.rotation.z = Math.PI + 0.3; g.add(t); }
    return g;
  },
};

// ------------------------------------------------------------------ race anatomy
export function buildRace(K) {
  setup(K);
  const { H, M, X, ch } = K, { V, mesh } = H, skin = ch.skinMat || M.leather;
  switch (K.race) {
    case 'elf': {
      // long, swept-back ears; bright eyes
      for (const s of [-1, 1]) {
        const ear = mesh(H.cone(0.022, 0.17, 7), skin); ear.scale.set(1, 1, 0.38);
        const dir = V(s * 0.8, 0.42, -0.42).normalize(); ear.quaternion.setFromUnitVectors(V(0, 1, 0), dir);
        const e = new THREE.Group(); e.add(ear); ear.position.copy(dir.clone().multiplyScalar(0.075));
        e.scale.setScalar(K.kh); K.onHead(e, s * 0.088, -0.005, -0.02);
      }
      ch.body.traverse(o => { if (o.isSkinnedMesh && /Eye/i.test(o.name) && !/brow/i.test(o.name)) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0x7affb0); o.material.emissiveIntensity = 0.9; } });
      break; }
    case 'orc': {
      for (const s of [-1, 1]) {
        const t = H.horn(0.085, 0.016, 1.5, M.bone); const g = new THREE.Group(); g.add(t); t.rotation.set(-0.15, 0, s * 0.3);
        g.scale.setScalar(K.kh); K.onHead(g, s * 0.036, -0.085, 0.075);
        const ear = mesh(H.cone(0.02, 0.08, 6), skin); ear.scale.set(1, 1, 0.45); const dir = V(s, 0.25, -0.35).normalize(); ear.quaternion.setFromUnitVectors(V(0, 1, 0), dir); ear.position.copy(dir.clone().multiplyScalar(0.035));
        const eg = new THREE.Group(); eg.add(ear); eg.scale.setScalar(K.kh); K.onHead(eg, s * 0.09, -0.01, -0.02);
      }
      break; }
    case 'dwarf': {
      const hc = ch.look.hairTint || [0.5, 0.2, 0.08];
      beard(K, hairMat(hc, M), { len: ch.look.beardLen || 0.36, ring: M.gold });
      break; }
    case 'troll': {
      const face = new THREE.Group();
      for (const s of [-1, 1]) {
        const ear = mesh(H.cone(0.035, 0.2, 6), skin); ear.position.set(s * 0.1, 0.0, -0.02); ear.rotation.set(-0.6, 0, -s * 1.25); face.add(ear);
        const tusk = H.horn(0.13, 0.017, 1.4, M.bone); tusk.position.set(s * 0.04, -0.08, 0.085); tusk.rotation.set(-0.3, 0, s * 0.45); face.add(tusk);
        const ring = mesh(H.tor(0.014, 0.003, 4, 10), M.gold, false); ring.position.set(s * 0.13, -0.03, -0.04); face.add(ring);
      }
      face.scale.setScalar(K.kh); K.onHead(face, 0, 0, 0);
      mohawk(K, hairMat(ch.look.hairTint || [0.62, 0.12, 0.08], M), { n: 10, h: 0.13 });
      break; }
    case 'undead': {
      const face = new THREE.Group(), eyeM = M.rune(ch.look.eyeGlow || 0x7aff6a, 3.2);
      for (const s of [-1, 1]) { const e = mesh(H.sph(0.012, 8, 6), eyeM, false); e.position.set(s * 0.034, 0.0, 0.095); face.add(e); }
      const jaw = mesh(H.box(0.06, 0.025, 0.05), M.bone); jaw.position.set(0, -0.075, 0.07); face.add(jaw);
      for (let i = 0; i < 6; i++) { const t = mesh(H.box(0.008, 0.012, 0.008), M.bone, false); t.position.set((i - 2.5) * 0.009, -0.06, 0.095); face.add(t); }
      face.scale.setScalar(K.kh); K.onHead(face, 0, 0, 0);
      const ribs = new THREE.Group(), k = K.k;
      for (let i = 0; i < 4; i++) { const r = mesh(H.tor(0.1 * k, 0.008 * k, 4, 18, Math.PI * 0.9), M.bone, false); r.rotation.set(0, 0, Math.PI * 0.05); r.position.set(0, -i * 0.045 * k, 0.03 * k); r.scale.set(1.1, 1, 0.9); ribs.add(r); }
      K.chest(ribs, -0.02, 0.06, { pitch: -Math.PI / 2 });
      break; }
    case 'tauren': {
      const face = new THREE.Group();
      for (const s of [-1, 1]) { const h = H.horn(0.36, 0.042, 1.9, M.bone); h.position.set(s * 0.1, 0.07, 0.0); h.rotation.set(-0.15, 0, -s * 1.45); face.add(h);
        const tip = mesh(H.cone(0.012, 0.05, 6), M.gold, false); tip.position.set(s * 0.34, 0.2, 0.0); tip.rotation.z = -s * 0.5; face.add(tip);
        const ear = mesh(H.sph(0.032, 8, 6), skin); ear.scale.set(1.7, 0.55, 0.85); ear.position.set(s * 0.13, 0.02, -0.02); ear.rotation.z = s * 0.3; face.add(ear); }
      const nose = mesh(H.sph(0.042, 10, 8), M.darkleather); nose.scale.set(1.35, 0.75, 0.7); nose.position.set(0, -0.045, 0.165); face.add(nose);
      const ringN = mesh(H.tor(0.024, 0.004, 6, 14), M.gold, false); ringN.position.set(0, -0.078, 0.17); face.add(ringN);
      face.scale.setScalar(K.kh); K.onHead(face, 0, 0, 0);
      // mane braids down the back
      const mane = new THREE.Group(), hm = hairMat(ch.look.hairTint || [0.16, 0.1, 0.06], M);
      for (const s of [-1, 0, 1]) mane.add(mesh(H.tube([V(s * 0.05, 0.12, -0.06), V(s * 0.07, 0.02, -0.13), V(s * 0.06, -0.14, -0.12)], 0.022, 10, 5), hm));
      mane.scale.setScalar(K.kh); K.onHead(mane, 0, -0.02, 0);
      // hooves over the feet and a tufted tail
      for (const [ft, bone] of [[K.L.lft, 'foot_l'], [K.L.rft, 'foot_r']]) {
        const g = new THREE.Group(), r = 0.075 * K.kl;
        const hoof = mesh(H.cyl(r * 0.9, r * 1.12, 0.1 * K.kl, 12), X.hoof); hoof.position.y = 0.0; g.add(hoof);
        const split = mesh(H.box(0.012, 0.1 * K.kl, r * 1.2), M.blacksteel, false); split.position.z = r * 0.5; g.add(split);
        const fringe = mesh(H.cyl(r * 1.15, r * 1.25, 0.05 * K.kl, 12, true), hm); fringe.position.y = 0.07 * K.kl; g.add(fringe);
        K.put(bone, g, ft.clone().add(V(0, -0.05 * K.kl, 0.03 * K.kl)));
      }
      const tail = new THREE.Group(); tail.add(mesh(H.tube([V(0, 0, 0), V(0, -0.05, -0.12), V(0, -0.35, -0.2), V(0, -0.6, -0.16)], 0.016 * K.k, 16, 5), skin));
      const tuft = mesh(H.cone(0.05 * K.k, 0.16 * K.k, 7), hm); tuft.position.set(0, -0.66, -0.15); tuft.rotation.x = Math.PI; tail.add(tuft);
      K.hips(tail, 0, -0.02, -0.17);
      break; }
  }
}

// ------------------------------------------------------------------ gear sets (one per class + spec)
export function buildOutfit(K) {
  if (K.ch.look.noArmor) return;
  const set = SETS[K.cls + ':' + K.spec] || SETS[K.cls];
  if (set) set(K);
}

const SETS = {
  // ---------------- MAGE (sun elf)
  'mage:frost'(K) { // Frost magister: sapphire robes, crystal-shard pauldrons, an ice crown and floating frost shards
    const { H, M, X, k } = K, { mesh, V } = H;
    K.pads(s => P.crystal(K, 0.135 * K.k), { up: 0.07 });
    const collar = mesh(H.cyl(0.115 * k, 0.15 * k, 0.2 * k, 20, true), M.royal); collar.scale.z = 0.88;
    const ct = mesh(H.tor(0.115 * k, 0.01, 6, 30), M.silver, false); ct.rotation.x = Math.PI / 2; ct.position.y = 0.1 * k;
    const cg = new THREE.Group(); cg.add(collar, ct); K.put('spine_03', cg, K.L.neck.clone().add(V(0, 0.01, -0.02)));
    const sash = K.tabard(X.white, 0.16, 0.7, M.silver);
    skirt(K, M.royal, { len: 0.86, flare: 0.34, trim: M.silver });
    K.belt(M.silver, K.M.gem(0x8fd8ff), 0.18);
    K.gauntlets(M.royal, M.silver, 1.3);
    const crown = new THREE.Group(); crown.add(mesh(H.tor(0.12, 0.009, 6, 32), M.silver).rotateX(Math.PI / 2 - 0.1));
    for (let i = 0; i < 7; i++) { const a = (i / 6 - 0.5) * 1.7, h = 0.07 + (3 - Math.abs(i - 3)) * 0.025; const c = mesh(H.cone(0.012, h, 5), X.ice); c.position.set(Math.sin(a) * 0.12, h / 2, Math.cos(a) * 0.12); c.rotation.x = -0.15; crown.add(c); }
    crown.scale.setScalar(K.kh); K.onHead(crown, 0, 0.06, -0.005);
    const orbit = new THREE.Group(); for (let i = 0; i < 4; i++) { const s = mesh(new THREE.OctahedronGeometry(0.035, 0), X.ice, false); s.scale.y = 2; s.position.set(Math.sin(i * 1.57) * 0.5, Math.sin(i * 2.1) * 0.15, Math.cos(i * 1.57) * 0.5); orbit.add(s); }
    const op = new THREE.Group(); op.add(orbit); K.chest(op, 0.12, 0); K.animated.spinners.push(orbit);
    K.cape(M.royal, 0.46, 1.08, { trim: M.silver });
  },
  'mage:fire'(K) { // Sunfire magister: crimson-gold robes, phoenix-feather pauldrons, a flame crest, burning motes
    const { H, M, X, k } = K, { mesh, V } = H;
    K.pads(s => P.phoenix(K, 0.14 * K.k), { up: 0.07 });
    const mantle = mesh(H.sph(0.21 * k, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.32), M.gold); mantle.scale.set(1.15, 0.7, 1.0); K.chest(mantle, 0.13, -0.01);
    for (let i = 0; i < 5; i++) { const a = (i / 4 - 0.5) * 1.6; const d = mesh(H.extrude([[-0.02, 0], [0.02, 0], [0, 0.07]], 0.006, 0.002), M.crimson, false); d.position.set(Math.sin(a) * 0.2 * k, 0.12 * k, Math.cos(a) * 0.18 * k); d.rotation.set(0, a, Math.PI); K.chest(d, 0, 0); }
    skirt(K, M.crimson, { len: 0.84, flare: 0.36, trim: M.gold });
    const front = K.tabard(M.gold, 0.14, 0.66, M.crimson);
    K.belt(M.gold, X.ember, 0.18);
    K.gauntlets(M.crimson, M.gold, 1.35);
    const crest = new THREE.Group(); crest.add(mesh(H.tor(0.118, 0.01, 6, 32), M.gold).rotateX(Math.PI / 2 - 0.15));
    const gem = mesh(H.sph(0.016, 8, 6), X.ember, false); gem.position.set(0, 0.01, 0.12); crest.add(gem);
    for (let i = 0; i < 5; i++) { const f = mesh(H.extrude([[0, 0], [0.03, 0.02], [0.02, 0.16 - Math.abs(i - 2) * 0.03], [-0.01, 0.05]], 0.006, 0.002), i % 2 ? M.crimson : M.gold); f.position.set((i - 2) * 0.03, 0.04, -0.06 - Math.abs(i - 2) * 0.01); f.rotation.set(-0.55, 0, (i - 2) * 0.15); crest.add(f); }
    crest.scale.setScalar(K.kh); K.onHead(crest, 0, 0.05, -0.005);
    const orbit = new THREE.Group(); for (let i = 0; i < 3; i++) { const s = mesh(H.sph(0.03, 8, 6), X.ember, false); s.position.set(Math.sin(i * 2.1) * 0.45, 0, Math.cos(i * 2.1) * 0.45); orbit.add(s); }
    const op = new THREE.Group(); op.add(orbit); K.chest(op, 0.1, 0); K.animated.spinners.push(orbit);
    K.cape(M.crimson, 0.48, 1.05, { trim: M.gold });
  },
  // ---------------- ROGUE (human)
  'rogue:subtlety'(K) { // Shadow stalker: black leathers, hood and face mask, knife bandolier, layered strap pads, ragged cloak
    const { H, M, X, k } = K, { mesh, V } = H;
    K.pads(s => { const g = H.pauldron(M, { r: 0.11 * K.k, plates: 3, mat: M.darkleather, trim: M.blacksteel }); const b = H.spike(0.012 * K.k, 0.06 * K.k, M.silver); b.position.set(0.06 * K.k, 0.06 * K.k, 0); b.rotation.z = -0.8; g.add(b); return g; });
    strap(K, M.darkleather, { dir: 1, r: 0.012 });
    for (let i = 0; i < 6; i++) { const kn = mesh(H.extrude([[-0.008, 0], [0.008, 0], [0, 0.09]], 0.004, 0.001), M.silver); const u = i / 5; K.chest(kn, 0.12 - u * 0.24, 0.165, { roll: 0.75 }, -0.1 + u * 0.2); }
    K.gauntlets(M.darkleather, M.blacksteel, 1.0);
    K.forearms(s => mesh(H.extrude([[0, 0], [0.012, 0], [0.004, 0.16], [-0.004, 0.16]], 0.004, 0.001), M.silver), 0.25);
    K.belt(M.darkleather, M.blacksteel, 0.18);
    for (const s of [-1, 1]) { const p = mesh(H.box(0.06 * k, 0.07 * k, 0.05 * k), M.leather); K.hips(p, s * 0.17, -0.02, 0.1, { yaw: s * 0.5 }); }
    const mask = mesh(H.sph(0.108, 18, 10, Math.PI * 0.08, Math.PI * 0.84, Math.PI * 0.52, Math.PI * 0.3), X.violet); mask.scale.set(1.05, 1.0, 1.25);
    const mg = new THREE.Group(); mg.add(mask); mg.scale.setScalar(K.kh); K.onHead(mg, 0, -0.04, 0);
    hood(K, M.shadowcloth, { peak: 0.05 });
    K.cape(M.shadowcloth, 0.4, 0.8, { ragged: 0.03 });
    K.greaves(M.darkleather, M.blacksteel);
  },
  'rogue:assassination'(K) { // Poisoner: dark-green leathers, venom vials, goggled half-mask, one spiked pauldron, poison satchel
    const { H, M, X, k } = K, { mesh, V } = H;
    const pd = P.spiked(K, 0.12 * k, X.olive, M.blacksteel, { n: 2 }); K.put('clavicle_l', pd, K.L.lcl.clone().lerp(K.L.lsh, 0.78).add(V(0.025 * k, 0.06 * k, 0)));
    const rp = H.pauldron(M, { r: 0.1 * k, plates: 2, mat: M.darkleather, trim: M.blacksteel }); K.put('clavicle_r', rp, K.L.rcl.clone().lerp(K.L.rsh, 0.78).add(V(-0.025 * k, 0.055 * k, 0)), { yaw: Math.PI });
    strap(K, M.darkleather, { dir: -1, r: 0.014 });
    for (let i = 0; i < 5; i++) { const u = i / 4, v = new THREE.Group(); v.add(mesh(H.cyl(0.014, 0.014, 0.055, 8), X.glass)); const liq = mesh(H.cyl(0.012, 0.012, 0.035, 8), X.venom, false); liq.position.y = -0.008; v.add(liq); const cork = mesh(H.cyl(0.009, 0.009, 0.015, 6), M.wood, false); cork.position.y = 0.032; v.add(cork); v.scale.setScalar(k); K.chest(v, -0.13 + u * 0.24, 0.17, undefined, 0.12 - u * 0.24); }
    K.gauntlets(M.darkleather, X.olive, 1.05);
    K.forearms(s => { const g = new THREE.Group(); for (let i = 0; i < 3; i++) { const t = H.spike(0.008, 0.045, M.blacksteel); t.position.set(s * 0.05 * K.ka, -0.04 + i * 0.04, 0); t.rotation.z = -s * Math.PI / 2; g.add(t); } return g; }, 0.3);
    K.belt(M.darkleather, M.blacksteel, 0.18);
    const sat = new THREE.Group(); sat.add(mesh(H.box(0.12 * k, 0.1 * k, 0.06 * k), M.leather)); const flap = mesh(H.box(0.125 * k, 0.04 * k, 0.065 * k), X.olive); flap.position.y = 0.04 * k; sat.add(flap); K.hips(sat, 0.19, -0.06, 0.03, { yaw: Math.PI / 2 });
    const mask = new THREE.Group(); const cloth = mesh(H.sph(0.108, 18, 10, Math.PI * 0.05, Math.PI * 0.9, Math.PI * 0.55, Math.PI * 0.32), X.olive); cloth.scale.set(1.05, 1, 1.22); mask.add(cloth);
    for (const s of [-1, 1]) { const gl = mesh(H.cyl(0.024, 0.024, 0.02, 12), M.brass); gl.rotation.x = Math.PI / 2; gl.position.set(s * 0.036, 0.1, 0.1); mask.add(gl); const lens = mesh(H.cyl(0.018, 0.018, 0.022, 12), X.venom, false); lens.rotation.x = Math.PI / 2; lens.position.set(s * 0.036, 0.1, 0.102); mask.add(lens); }
    const strapG = mesh(H.tor(0.11, 0.008, 4, 30), M.darkleather, false); strapG.rotation.x = Math.PI / 2; strapG.position.y = 0.1; mask.add(strapG);
    mask.scale.setScalar(K.kh); K.onHead(mask, 0, -0.1, 0);
    K.cape(X.olive, 0.34, 0.6, { ragged: 0.03 });
    K.greaves(M.darkleather, X.olive);
  },
  // ---------------- WARRIOR (orc)
  'warrior:protection'(K) { // Orcish bulwark: black-iron plate with tusked, spiked pauldrons, horned war helm, chain skirt
    const { H, M, X, k } = K, { mesh, V } = H;
    K.pads(s => P.spiked(K, 0.135 * k, X.iron, M.bronze, { n: 3, tusk: true }), { up: 0.06 });
    K.breastplate(X.iron, M.bronze, M.rune(0xff4a1a, 1.2));
    strap(K, M.darkleather, { dir: 1, r: 0.016, dz: 0.2 });
    K.gauntlets(X.iron, M.bronze, 1.2);
    K.forearms(s => { const g = new THREE.Group(); for (let i = 0; i < 2; i++) { const t = H.spike(0.014, 0.07, X.iron); t.position.set(s * 0.065 * K.ka, -0.03 + i * 0.06, 0); t.rotation.z = -s * Math.PI / 2; g.add(t); } return g; }, 0.3);
    K.greaves(X.iron, M.bronze);
    K.belt(M.darkleather, M.bronze, 0.2);
    skirt(K, X.chain, { len: 0.36, flare: 0.27, top: 0.19 });
    K.tassets(X.iron, M.bronze, 3);
    const sk = H.skullMesh(M, 0.05 * k); K.hips(sk, 0, 0.05, 0.21);
    const helm = new THREE.Group();
    const cap = mesh(H.sph(0.135, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), X.iron); cap.scale.set(1.04, 1.0, 1.1); helm.add(cap);
    const band = mesh(H.tor(0.135, 0.014, 6, 30), M.bronze); band.rotation.x = Math.PI / 2; band.position.y = 0.03; band.scale.z = 1.1; helm.add(band);
    for (const s of [-1, 1]) { const cheek = mesh(H.box(0.04, 0.1, 0.09), X.iron); cheek.position.set(s * 0.12, -0.04, 0.04); cheek.rotation.z = s * 0.15; helm.add(cheek);
      const hr = H.horn(0.3, 0.032, 2.0, M.bone); hr.position.set(s * 0.12, 0.06, 0.02); hr.rotation.set(0.3, 0, -s * 1.1); helm.add(hr); }
    for (let i = 0; i < 4; i++) { const sp = H.spike(0.018, 0.09 - i * 0.012, X.iron); sp.position.set(0, 0.13 - i * 0.012, 0.06 - i * 0.05); sp.rotation.x = -0.3 - i * 0.25; helm.add(sp); }
    helm.scale.setScalar(K.kh); K.onHead(helm, 0, 0.02, -0.01);
    K.cape(M.crimson, 0.5, 0.95, { ragged: 0.025, trim: M.bronze });
  },
  'warrior:arms'(K) { // Orc warlord: bare-armed, one colossal spiked pauldron on chains, war paint, topknot, bone-and-leather kilt
    const { H, M, X, k } = K, { mesh, V } = H;
    const big = P.spiked(K, 0.155 * k, X.iron, M.bronze, { n: 4, tusk: true }); K.put('clavicle_l', big, K.L.lcl.clone().lerp(K.L.lsh, 0.8).add(V(0.035 * k, 0.08 * k, 0)));
    strap(K, X.chain, { dir: 1, r: 0.014, dz: 0.18 }); strap(K, M.darkleather, { dir: -1, r: 0.018, dz: 0.18 });
    const disc = mesh(H.cyl(0.05 * k, 0.05 * k, 0.02, 14), X.iron); disc.rotation.x = Math.PI / 2; K.chest(disc, -0.02, 0.19);
    K.forearms(s => { const g = new THREE.Group(); g.add(mesh(H.cyl(0.05 * K.ka, 0.044 * K.ka, 0.13, 12), M.darkleather)); for (let i = 0; i < 3; i++) { const r = mesh(H.cyl(0.054 * K.ka, 0.054 * K.ka, 0.012, 12), X.iron, false); r.position.y = -0.05 + i * 0.05; g.add(r); } return g; }, 0.2);
    K.belt(M.darkleather, X.iron, 0.2);
    kilt(K, M.darkleather, M.fur, { n: 7, len: 0.3 });
    for (let i = 0; i < 3; i++) { const sk = H.skullMesh(M, 0.035 * k); K.hips(sk, (i - 1) * 0.12, 0.0, 0.2); }
    K.greaves(X.iron, M.bronze);
    // war paint: two red stripes on the face
    const paint = new THREE.Group(); for (const s of [-1, 1]) { const p = mesh(H.box(0.012, 0.07, 0.01), X.paint, false); p.position.set(s * 0.04, -0.01, 0.1); p.rotation.z = s * 0.2; paint.add(p); }
    paint.scale.setScalar(K.kh); K.onHead(paint, 0, 0, 0);
    topknot(K, hairMat([0.06, 0.05, 0.04], M), M.bronze);
  },
  // ---------------- BERSERKER (dwarf)
  'berserker:fury'(K) { // Dwarf slayer: bare chest with glowing blood runes, a blazing crest of hair, spiked bracers, chains, fur kilt
    const { H, M, X, k } = K, { mesh, V } = H;
    mohawk(K, hairMat(K.ch.look.hairTint || [0.85, 0.3, 0.06], M), { n: 11, h: 0.16, w: 0.026 });
    K.furMantle(M.fur, 0.7);
    const runes = new THREE.Group(); for (let i = 0; i < 5; i++) { const r = mesh(H.box(0.05 * k, 0.012 * k, 0.01), M.rune(0xff3a1a, 2.2), false); r.position.set((i - 2) * 0.045 * k, -Math.abs(i - 2) * 0.02 * k, 0.185 * k - Math.abs(i - 2) * 0.012 * k); r.rotation.z = (i - 2) * 0.3; runes.add(r); }
    K.chest(runes, 0.02, 0);
    strap(K, X.chain, { dir: 1, r: 0.012, dz: 0.2 });
    K.forearms(s => { const g = new THREE.Group(); g.add(mesh(H.cyl(0.058 * K.ka, 0.05 * K.ka, 0.14, 12), X.iron)); for (let i = 0; i < 3; i++) { const t = H.spike(0.014, 0.07, X.iron); t.position.set(s * 0.07 * K.ka, -0.04 + i * 0.04, 0); t.rotation.z = -s * Math.PI / 2; g.add(t); } return g; }, 0.15);
    K.belt(M.darkleather, M.gold, 0.2);
    const buckle = H.skullMesh(M, 0.055 * k); K.hips(buckle, 0, 0.05, 0.22);
    kilt(K, M.fur, M.darkleather, { n: 7, len: 0.24 });
    K.greaves(M.darkleather, X.iron);
  },
  'berserker:executioner'(K) { // Dwarf headsman: black-iron half plate, masked horned helm, chain baldric, heavy greaves
    const { H, M, X, k } = K, { mesh, V } = H;
    K.pads(s => P.skull(K, 0.15 * k, M.blacksteel, M.bronze), { up: 0.07 });
    K.breastplate(M.blacksteel, M.bronze, null);
    strap(K, X.chain, { dir: -1, r: 0.016, dz: 0.22 });
    K.gauntlets(M.blacksteel, M.bronze, 1.15);
    K.belt(M.darkleather, M.bronze, 0.2);
    K.tassets(M.blacksteel, M.bronze, 4);
    K.greaves(M.blacksteel, M.bronze);
    const helm = new THREE.Group();
    const cap = mesh(H.sph(0.14, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), M.blacksteel); cap.scale.set(1.05, 1.0, 1.08); helm.add(cap);
    const maskP = mesh(H.cyl(0.143, 0.14, 0.09, 20, true, ), M.blacksteel); maskP.position.y = -0.02; maskP.scale.z = 1.08; helm.add(maskP);
    for (const s of [-1, 1]) { const sl = mesh(H.box(0.045, 0.012, 0.02), SHADOW, false); sl.position.set(s * 0.04, -0.005, 0.15); helm.add(sl);
      const hr = H.horn(0.26, 0.034, 2.6, M.bone); hr.position.set(s * 0.13, 0.04, -0.02); hr.rotation.set(-0.6, 0, -s * 1.5); helm.add(hr); }
    const ridge = mesh(H.box(0.02, 0.14, 0.24), M.bronze); ridge.position.set(0, 0.1, -0.01); helm.add(ridge);
    H.rivets(helm, [V(-0.1, -0.03, 0.11), V(0.1, -0.03, 0.11), V(-0.13, -0.03, 0.04), V(0.13, -0.03, 0.04)], 0.008, M.bronze);
    helm.scale.setScalar(K.kh); K.onHead(helm, 0, 0.03, -0.005);
  },
  // ---------------- PALADIN (human)
  'paladin:crusader'(K) { // Sunforged crusader: gilded white plate, sunburst pauldrons, winged helm, white tabard and cape
    const { H, M, X, k } = K, { mesh, V } = H;
    K.pads(s => P.sun(K, 0.17 * k), { up: 0.07 });
    K.breastplate(X.whiteSteel, M.gold, M.rune(0xffe08a, 2));
    K.gauntlets(X.whiteSteel, M.gold, 1.2);
    K.greaves(X.whiteSteel, M.gold);
    K.belt(M.leather, M.gold, 0.19);
    K.tassets(X.whiteSteel, M.gold, 4);
    K.tabard(X.white, 0.22, 0.56, M.gold);
    const helm = new THREE.Group();
    const dome = mesh(H.sph(0.135, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), X.whiteSteel); dome.scale.set(1, 1.05, 1.1); helm.add(dome);
    const brow = mesh(H.tor(0.136, 0.014, 6, 32), M.gold); brow.rotation.x = Math.PI / 2; brow.position.y = 0.02; brow.scale.z = 1.1; helm.add(brow);
    const nasal = mesh(H.box(0.022, 0.09, 0.02), M.gold); nasal.position.set(0, -0.02, 0.15); helm.add(nasal);
    const sun = mesh(H.sph(0.02, 10, 8), M.rune(0xfff0a0, 3), false); sun.position.set(0, 0.06, 0.14); helm.add(sun);
    for (const s of [-1, 1]) for (let f = 0; f < 4; f++) { const w = mesh(H.extrude([[0, 0], [0.03, 0.02], [0.17 - f * 0.025, 0.12 + f * 0.035], [0.01, 0.05]], 0.006, 0.002), f % 2 ? X.whiteSteel : M.gold); w.position.set(s * 0.12, 0.02 + f * 0.012, -0.02 - f * 0.02); w.scale.x = s; w.rotation.set(0, -s * 0.5, s * (0.15 + f * 0.12)); helm.add(w); }
    helm.scale.setScalar(K.kh); K.onHead(helm, 0, 0.02, -0.005);
    K.cape(X.white, 0.52, 1.05, { trim: M.gold });
  },
  'paladin:protection'(K) { // Holy bastion: heavy blue-steel plate, layered square pauldrons, visored great helm with a slit of light
    const { H, M, X, k } = K, { mesh, V } = H;
    K.pads(s => P.square(K, 0.17 * k, X.blueSteel, M.gold), { up: 0.08, out: 0.035 });
    K.breastplate(X.blueSteel, M.gold, M.gem(0x6ab0ff));
    const gorget = mesh(H.cyl(0.11 * k, 0.15 * k, 0.09 * k, 20, true), X.blueSteel); K.put('spine_03', gorget, K.L.neck.clone().add(V(0, -0.02, 0.0)));
    K.gauntlets(X.blueSteel, M.gold, 1.25);
    K.greaves(X.blueSteel, M.gold);
    K.belt(M.darkleather, M.gold, 0.2);
    K.tassets(X.blueSteel, M.gold, 5);
    skirt(K, X.chain, { len: 0.4, flare: 0.28, top: 0.19 });
    K.tabard(X.sky, 0.24, 0.6, M.gold);
    const helm = H.helmGreat(M, 0.14, { crest: null });
    helm.traverse(o => { if (o.isMesh && o.material === M.steel) o.material = X.blueSteel; });
    const visor = mesh(H.box(0.16, 0.018, 0.03), M.rune(0xfff0b0, 3), false); visor.position.set(0, -0.015, 0.142); helm.add(visor);
    const vbar = mesh(H.box(0.02, 0.09, 0.03), M.rune(0xfff0b0, 2.4), false); vbar.position.set(0, -0.06, 0.142); helm.add(vbar);
    for (let i = 0; i < 5; i++) { const c = H.spike(0.012, 0.05 + (i === 2 ? 0.03 : 0), M.gold); c.position.set((i - 2) * 0.04, 0.15 - Math.abs(i - 2) * 0.01, 0.06); helm.add(c); }
    helm.scale.setScalar(K.kh); K.onHead(helm, 0, 0.01, -0.005);
    K.cape(X.sky, 0.54, 1.0, { trim: M.gold });
  },
  // ---------------- PRIEST (human)
  'priest:discipline'(K) { // Radiant battle-cleric: winged gilded pauldrons, white-gold plate, long vestments, a circlet and halo
    const { H, M, X, k } = K, { mesh, V } = H;
    K.shoulders({ r: 0.14, plates: 2, mat: M.silver, trim: M.gold, spikes: 0, wing: M.gold });
    K.breastplate(M.silver, M.gold, M.rune(0xffe08a, 1.8));
    skirt(K, M.ivory, { len: 0.84, flare: 0.32, trim: M.gold });
    K.tabard(M.ivory, 0.18, 0.62, M.gold);
    K.belt(M.leather, M.gold, 0.18);
    K.gauntlets(M.silver, M.gold, 1.15);
    const book = new THREE.Group(); book.add(mesh(H.box(0.1 * k, 0.13 * k, 0.04 * k), M.ivory)); book.add(mesh(H.box(0.012, 0.07 * k, 0.045 * k), M.gold)); const cr2 = mesh(H.box(0.045 * k, 0.012, 0.045 * k), M.gold); cr2.position.y = 0.012; book.add(cr2);
    K.hips(book, -0.2, -0.04, 0.02, { yaw: -Math.PI / 2 });
    K.cape(M.ivory, 0.44, 1.0, { trim: M.gold });
    const circ = new THREE.Group(); circ.add(mesh(H.tor(0.12, 0.01, 6, 32), M.gold).rotateX(Math.PI / 2 - 0.15)); const gem = mesh(H.sph(0.016, 8, 6), M.gem(0x6ab0ff)); gem.position.set(0, 0.02, 0.12); circ.add(gem);
    circ.scale.setScalar(K.kh); K.onHead(circ, 0, 0.02, 0);
  },
  'priest:shadow'(K) { // Void-touched: deep cowl with glowing eyes, tendril pauldrons, violet robes torn into tatters, a chained tome
    const { H, M, X, k } = K, { mesh, V } = H;
    K.pads(s => P.tendril(K, 0.13 * k), { up: 0.06 });
    hood(K, X.violet, { eyes: M.rune(0xc08aff, 3.5), peak: 0.08 });
    skirt(K, X.violet, { len: 0.86, flare: 0.36, trim: X.void });
    const sash = K.tabard(M.shadowcloth, 0.16, 0.66, X.void);
    strap(K, X.chain, { dir: 1, r: 0.01 });
    K.belt(M.darkleather, X.void, 0.18);
    K.gauntlets(M.shadowcloth, M.blacksteel, 1.2);
    const tome = new THREE.Group(); tome.add(mesh(H.box(0.11 * k, 0.14 * k, 0.05 * k), M.darkleather)); const eye = mesh(H.sph(0.02 * k, 8, 6), M.rune(0xc08aff, 3), false); eye.position.z = 0.026 * k; tome.add(eye);
    K.hips(tome, -0.2, -0.04, 0.02, { yaw: -Math.PI / 2 });
    K.cape(X.violet, 0.46, 1.08, { ragged: 0.05 });
  },
  // ---------------- SHAMAN (orc)
  'shaman:elemental'(K) { // Storm-caller: wolf-skull helm, grey fur mantle, a carved totem on the back with elemental orbs, bone fetishes
    const { H, M, X, k } = K, { mesh, V } = H;
    K.furMantle(M.greyfur, 1.0);
    K.pads(s => { const g = new THREE.Group(); const sk = H.skullMesh(M, 0.07 * K.k); sk.rotation.y = Math.PI / 2; g.add(sk); const t = H.horn(0.12 * K.k, 0.014 * K.k, 1.5, M.bone); t.position.set(0, -0.03 * K.k, 0.05 * K.k); t.rotation.z = -0.4; g.add(t); return g; }, { up: 0.09, out: 0.06, along: 0.8 });
    const helm = new THREE.Group();
    const top = mesh(H.sph(0.13, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), M.bone); top.scale.set(1.05, 0.9, 1.25); helm.add(top);
    const snout = mesh(H.box(0.11, 0.07, 0.16), M.bone); snout.position.set(0, 0.03, 0.17); helm.add(snout);
    const eyeM = M.rune(0x5ae0ff, 2.2);
    for (const s of [-1, 1]) { const e = mesh(H.sph(0.017, 6, 4), eyeM, false); e.position.set(s * 0.05, 0.07, 0.17); helm.add(e); const h = H.horn(0.24, 0.026, 2.0, M.bone); h.position.set(s * 0.1, 0.08, -0.02); h.rotation.set(-0.5, 0, -s * 1.1); helm.add(h); }
    for (let i = 0; i < 5; i++) { const tooth = mesh(H.cone(0.008, 0.03, 4), M.bone, false); tooth.position.set(-0.04 + i * 0.02, -0.005, 0.24); tooth.rotation.x = Math.PI; helm.add(tooth); }
    helm.scale.setScalar(K.kh); K.onHead(helm, 0, 0.03, 0);
    // totem pole on the back: carved segments with fire / water / earth / air orbs
    const totem = new THREE.Group();
    totem.add(mesh(H.cyl(0.035, 0.04, 0.9, 10), M.wood));
    const cols = [0xff6a2a, 0x4ad8ff, 0x8ad86a, 0xe8f4ff];
    for (let i = 0; i < 4; i++) { const seg = mesh(H.cyl(0.055, 0.05, 0.1, 8), M.darkwood); seg.position.y = 0.12 + i * 0.1 - 0.2; totem.add(seg); const o = mesh(H.sph(0.028, 10, 8), M.rune(cols[i], 2.4), false); o.position.set(0, seg.position.y, 0.055); totem.add(o); }
    for (const s of [-1, 1]) { const w = mesh(H.extrude([[0, 0], [0.12, 0.05], [0.14, 0.1], [0.02, 0.06]], 0.01, 0.002), M.wood); w.position.set(0, 0.38, 0); w.scale.x = s; totem.add(w); }
    const ft = mesh(H.cone(0.05, 0.1, 8), M.darkwood); ft.position.y = 0.5; totem.add(ft);
    totem.scale.setScalar(k); K.chest(totem, 0.05, -0.2, { roll: 0.25 });
    const neck = new THREE.Group();
    for (let i = 0; i < 7; i++) { const a = (i / 6 - 0.5) * 1.8; const bead = mesh(i % 2 ? H.sph(0.016 * k, 6, 4) : H.cone(0.012 * k, 0.05 * k, 5), i % 2 ? M.rune(0x5ae0ff, 1.2) : M.bone, false); bead.position.set(Math.sin(a) * 0.12 * k, -Math.cos(a) * 0.04 - 0.02, Math.cos(a) * 0.12 * k); if (!(i % 2)) bead.rotation.x = Math.PI; neck.add(bead); }
    K.put('spine_03', neck, K.L.neck.clone().add(V(0, -0.09 * k, 0.05 * k)));
    K.belt(M.leather, M.bone, 0.19);
    K.tassets(M.wood, M.bone, 3);
    K.gauntlets(M.leather, M.bone, 1.1);
    K.greaves(M.leather, M.bone);
  },
  'shaman:enhancement'(K) { // Storm warrior: wolf-pelt hood with the wolf's head, storm-orb pauldrons, lightning bracers, mail kilt
    const { H, M, X, k } = K, { mesh, V } = H;
    K.pads(s => P.storm(K, 0.15 * k), { up: 0.07 });
    const wolf = new THREE.Group();
    const pelt = mesh(H.sph(0.15, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), M.greyfur); pelt.scale.set(1.05, 0.95, 1.15); wolf.add(pelt);
    const snout = mesh(H.cone(0.06, 0.16, 8), M.greyfur); snout.rotation.x = Math.PI / 2; snout.position.set(0, 0.07, 0.17); wolf.add(snout);
    const nose = mesh(H.sph(0.018, 6, 5), M.blacksteel, false); nose.position.set(0, 0.07, 0.25); wolf.add(nose);
    for (const s of [-1, 1]) { const ear = mesh(H.cone(0.035, 0.09, 4), M.greyfur); ear.position.set(s * 0.08, 0.15, 0.0); ear.rotation.z = -s * 0.3; wolf.add(ear);
      const eye = mesh(H.sph(0.012, 6, 4), M.rune(0x7ae8ff, 2.5), false); eye.position.set(s * 0.04, 0.1, 0.16); wolf.add(eye);
      const fang = mesh(H.cone(0.008, 0.04, 4), M.bone, false); fang.position.set(s * 0.025, 0.03, 0.21); fang.rotation.x = Math.PI; wolf.add(fang); }
    const back = mesh(H.cyl(0.13, 0.18, 0.24, 14, true), M.greyfur); back.position.set(0, -0.12, -0.06); back.scale.z = 0.8; wolf.add(back);
    wolf.scale.setScalar(K.kh); K.onHead(wolf, 0, 0.02, -0.01);
    K.forearms(s => { const g = new THREE.Group(); g.add(mesh(H.cyl(0.055 * K.ka, 0.048 * K.ka, 0.14, 12), M.bronze)); for (let i = 0; i < 2; i++) { const r = mesh(H.tor(0.056 * K.ka, 0.006, 4, 16), M.rune(0x7ae8ff, 2.2), false); r.rotation.x = Math.PI / 2; r.position.y = -0.03 + i * 0.06; g.add(r); } return g; }, 0.18);
    strap(K, M.leather, { dir: 1, r: 0.014 });
    K.belt(M.leather, M.bronze, 0.2);
    skirt(K, X.chain, { len: 0.34, flare: 0.27, top: 0.19 });
    kilt(K, M.greyfur, M.leather, { n: 5, len: 0.3 });
    K.greaves(M.leather, M.bronze);
    topknot(K, hairMat([0.08, 0.06, 0.05], M), M.bronze);
  },
  // ---------------- HUNTER (jungle troll)
  'hunter:beastmaster'(K) { // Beast-tamer: a great beast skull on one shoulder, fur and feathers, tooth necklace, quiver
    const { H, M, X, k } = K, { mesh, V } = H;
    const bs = P.beast(K, 0.17 * k); K.put('clavicle_l', bs, K.L.lcl.clone().lerp(K.L.lsh, 0.8).add(V(0.03 * k, 0.07 * k, 0)));
    const rp = H.pauldron(M, { r: 0.12 * k, plates: 2, mat: M.leather, trim: M.bone }); K.put('clavicle_r', rp, K.L.rcl.clone().lerp(K.L.rsh, 0.78).add(V(-0.025 * k, 0.055 * k, 0)), { yaw: Math.PI });
    K.furMantle(M.fur, 0.75);
    const neck = new THREE.Group(); for (let i = 0; i < 9; i++) { const a = (i / 8 - 0.5) * 1.9; const t = mesh(H.cone(0.012 * k, 0.055 * k, 5), M.bone); t.position.set(Math.sin(a) * 0.12 * k, -Math.cos(a) * 0.03 - 0.02, Math.cos(a) * 0.12 * k); t.rotation.x = Math.PI; neck.add(t); }
    K.put('spine_03', neck, K.L.neck.clone().add(V(0, -0.1 * k, 0.05 * k)));
    const fb = new THREE.Group(); for (let i = 0; i < 3; i++) { const f = mesh(H.extrude([[0, 0], [0.02, 0.05], [0.012, 0.2], [-0.006, 0.18], [-0.012, 0.05]], 0.003, 0.001), i === 1 ? X.redFeather : X.feather); f.position.set((i - 1) * 0.03, 0.08, -0.12); f.rotation.set(-0.5, 0, (i - 1) * 0.35); fb.add(f); }
    fb.scale.setScalar(K.kh); K.onHead(fb, 0, 0, 0);
    const q = new THREE.Group(); q.add(mesh(H.cyl(0.05 * k, 0.045 * k, 0.42 * k, 10), M.darkleather));
    for (let i = 0; i < 5; i++) { const ar = mesh(H.cyl(0.004, 0.004, 0.2 * k, 4), M.wood, false); ar.position.set((i - 2) * 0.014, 0.28 * k, 0); q.add(ar); const fl = mesh(H.box(0.016, 0.05 * k, 0.004), X.redFeather, false); fl.position.set((i - 2) * 0.014, 0.36 * k, 0); q.add(fl); }
    K.chest(q, 0.02, -0.16, { roll: -0.35 }, 0.06);
    K.gauntlets(M.leather, M.bone, 1.0);
    K.belt(M.darkleather, M.bone, 0.18);
    kilt(K, M.fur, M.leather, { n: 5, len: 0.24, arc: 2.6 });
    K.greaves(M.leather, M.bone);
  },
  'hunter:sharpshooter'(K) { // Marksman: wide-brimmed feathered hat, long leather coat, bolt bandolier, spyglass, steel bracers
    const { H, M, X, k } = K, { mesh, V } = H;
    const hat = new THREE.Group();
    const brim = mesh(H.cyl(0.25, 0.25, 0.012, 28), M.darkleather); brim.scale.z = 0.9; hat.add(brim);
    const crown = mesh(H.cyl(0.1, 0.13, 0.13, 18), M.darkleather); crown.position.y = 0.07; hat.add(crown);
    const band = mesh(H.cyl(0.132, 0.132, 0.025, 18), M.crimson); band.position.y = 0.025; hat.add(band);
    const fe = mesh(H.extrude([[0, 0], [0.025, 0.06], [0.015, 0.26], [-0.008, 0.24], [-0.015, 0.06]], 0.003, 0.001), X.redFeather); fe.position.set(0.12, 0.04, -0.03); fe.rotation.set(-0.9, 0, -0.5); hat.add(fe);
    hat.rotation.x = -0.12; hat.scale.setScalar(K.kh); K.onHead(hat, 0, 0.08, -0.01);
    K.pads(s => H.pauldron(M, { r: 0.12 * K.k, plates: 3, mat: M.leather, trim: M.brass }), { up: 0.05 });
    skirt(K, M.leather, { len: 0.7, flare: 0.3, trim: M.brass, open: true });
    const band2 = new THREE.Group();
    for (let i = 0; i < 8; i++) { const u = i / 7, bl = mesh(H.cyl(0.006, 0.006, 0.09 * k, 4), M.darksteel, false); bl.position.set((u - 0.5) * 0.3 * k, (u - 0.5) * 0.34 * k, 0.15 * k); bl.rotation.z = 0.85; band2.add(bl); const tp = mesh(H.cone(0.008, 0.02, 4), M.brass, false); tp.position.set((u - 0.5) * 0.3 * k + 0.03, (u - 0.5) * 0.34 * k + 0.03, 0.15 * k); tp.rotation.z = 0.85 - Math.PI / 2; band2.add(tp); }
    K.chest(band2, 0, 0);
    strap(K, M.darkleather, { dir: -1, r: 0.012 });
    const glass = mesh(H.cyl(0.018 * k, 0.022 * k, 0.2 * k, 10), M.brass); K.hips(glass, 0.2, -0.02, 0.04, { roll: 0.3 });
    K.gauntlets(M.steel, M.brass, 1.05);
    K.belt(M.darkleather, M.brass, 0.18);
    K.greaves(M.leather, M.brass);
  },
  // ---------------- NECROMANCER (undead)
  'necromancer:summoner'(K) { // Bone-lord: skull pauldrons, bone crown, rib-cage harness, a spine down the back, rotting robes
    const { H, M, X, k } = K, { mesh, V } = H;
    K.pads(s => P.skull(K, 0.14 * k, M.bone, M.darksteel), { up: 0.07 });
    const crown = new THREE.Group(); crown.add(mesh(H.tor(0.12, 0.012, 6, 30), M.bone).rotateX(Math.PI / 2 - 0.1));
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; const sp = H.spike(0.012, 0.06 + (i % 2) * 0.04, M.bone); sp.position.set(Math.sin(a) * 0.12, 0.03, Math.cos(a) * 0.12); sp.rotation.set(Math.cos(a) * -0.2, 0, Math.sin(a) * 0.2); crown.add(sp); }
    const gem = mesh(H.sph(0.018, 8, 6), M.rune(0x7aff6a, 3), false); gem.position.set(0, 0.02, 0.125); crown.add(gem);
    crown.scale.setScalar(K.kh); K.onHead(crown, 0, 0.05, -0.01);
    const spine = new THREE.Group(); for (let i = 0; i < 8; i++) { const v = mesh(H.cyl(0.024, 0.024, 0.03, 8), M.bone); v.position.y = -i * 0.06; spine.add(v); const pr = mesh(H.box(0.08, 0.012, 0.012), M.bone, false); pr.position.y = -i * 0.06; spine.add(pr); }
    spine.scale.setScalar(k); K.chest(spine, 0.12, -0.17);
    skirt(K, M.darkleather, { len: 0.85, flare: 0.36, trim: M.bone });
    kilt(K, M.shadowcloth, M.darkleather, { n: 5, len: 0.5, arc: 2.4 });
    K.belt(M.darkleather, M.bone, 0.18);
    K.gauntlets(M.darkleather, M.bone, 1.0);
    K.cape(M.shadowcloth, 0.42, 1.0, { ragged: 0.05 });
  },
  'necromancer:curser'(K) { // Hex-weaver: deep violet cowl, chains, floating cursed sigils, a lantern of souls, tattered high collar
    const { H, M, X, k } = K, { mesh, V } = H;
    hood(K, X.violet, { eyes: null, peak: 0.1 });
    K.pads(s => { const g = H.pauldron(M, { r: 0.11 * K.k, plates: 3, mat: M.shadowcloth, trim: M.darksteel }); for (let i = 0; i < 3; i++) { const l = mesh(H.tor(0.016 * K.k, 0.005, 4, 8), M.darksteel, false); l.position.set(0.1 * K.k, -0.02 - i * 0.03 * K.k, 0); l.rotation.set(i % 2 ? Math.PI / 2 : 0, 0, 0); g.add(l); } return g; });
    const ch = new THREE.Group(); for (let i = 0; i < 12; i++) { const u = i / 11, l = mesh(H.tor(0.015 * k, 0.005, 4, 8), M.darksteel, false); l.position.set((u - 0.5) * 0.36 * k, -(u - 0.5) * 0.36 * k, 0.15 * k); l.rotation.set(i % 2 ? Math.PI / 2 : 0, 0, -0.8); ch.add(l); }
    K.chest(ch, 0, 0);
    const orbit = new THREE.Group(); for (let i = 0; i < 3; i++) { const s = mesh(new THREE.TorusGeometry(0.05, 0.006, 4, 6), M.rune(0xb070ff, 2.4), false); s.position.set(Math.sin(i * 2.1) * 0.42, 0.15 * i - 0.1, Math.cos(i * 2.1) * 0.42); orbit.add(s); }
    const op = new THREE.Group(); op.add(orbit); K.chest(op, 0, 0); K.animated.spinners.push(orbit);
    const lan = new THREE.Group(); lan.add(mesh(H.cyl(0.035, 0.04, 0.08, 6, true), M.darksteel)); const flame = mesh(H.sph(0.026, 8, 6), M.rune(0x9aff6a, 3.2), false); lan.add(flame); const cap = mesh(H.cone(0.045, 0.04, 6), M.darksteel); cap.position.y = 0.06; lan.add(cap);
    lan.scale.setScalar(k); K.hips(lan, 0.21, -0.1, 0.02);
    skirt(K, X.violet, { len: 0.86, flare: 0.36, trim: M.darksteel });
    K.belt(M.darkleather, M.darksteel, 0.18);
    K.gauntlets(M.shadowcloth, M.darksteel, 1.2);
    K.cape(X.violet, 0.44, 1.05, { ragged: 0.06 });
  },
  // ---------------- DRUID (bull-folk)
  'druid:feral'(K) { // Claw-warden: bare fur and leather harness, claw gauntlets, a great-cat pelt over the shoulders, fang belt
    const { H, M, X, k } = K, { mesh, V } = H;
    K.furMantle(M.fur, 1.1);
    strap(K, M.darkleather, { dir: 1, r: 0.016, dz: 0.21 }); strap(K, M.darkleather, { dir: -1, r: 0.016, dz: 0.21 });
    const disc = mesh(H.cyl(0.045 * k, 0.045 * k, 0.02, 10), M.bone); disc.rotation.x = Math.PI / 2; K.chest(disc, -0.02, 0.2);
    K.forearms(s => { const g = new THREE.Group(); g.add(mesh(H.cyl(0.06 * K.ka, 0.055 * K.ka, 0.15, 12), M.darkleather)); return g; }, 0.15);
    for (const [ha, bone, s] of [[K.L.lha, 'hand_l', 1], [K.L.rha, 'hand_r', -1]]) { const g = new THREE.Group(); for (let i = 0; i < 3; i++) { const c = H.horn(0.12, 0.012, 1.4, M.bone); c.position.set(0, 0, (i - 1) * 0.025); c.rotation.set(0, 0, 0); g.add(c); } K.put(bone, g, ha.clone().add(V(s * 0.0, 0, 0.06 * K.ka)), { pitch: Math.PI / 2 - 0.3 }); }
    K.belt(M.darkleather, M.bone, 0.21);
    const fangs = new THREE.Group(); for (let i = 0; i < 9; i++) { const a = (i / 8 - 0.5) * 2.2; const f = mesh(H.cone(0.012 * k, 0.06 * k, 5), M.bone); f.position.set(Math.sin(a) * 0.22 * k, -0.04 * k, Math.cos(a) * 0.19 * k); f.rotation.x = Math.PI; fangs.add(f); }
    K.hips(fangs, 0, 0.05, 0);
    kilt(K, M.fur, M.darkleather, { n: 7, len: 0.3 });
    const paint = new THREE.Group(); for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const p = mesh(H.box(0.04, 0.008, 0.01), M.rune(0x8ad86a, 1.0), false); p.position.set(s * 0.05, 0.02 - i * 0.018, 0.105); p.rotation.z = s * 0.2; paint.add(p); }
    paint.scale.setScalar(K.kh); K.onHead(paint, 0, 0, 0);
  },
  'druid:restoration'(K) { // Grove-mother: antler crown in bloom, bark-and-moss pauldrons, a robe of leaves, flowering staff
    const { H, M, X, k } = K, { mesh, V } = H;
    K.pads(s => P.bark(K, 0.15 * k), { up: 0.07 });
    const crown = new THREE.Group();
    for (const s of [-1, 1]) {
      crown.add(mesh(H.tube([V(s * 0.06, 0.12, -0.01), V(s * 0.1, 0.22, -0.02), V(s * 0.12, 0.33, -0.05)], 0.012, 10, 5), M.wood));
      for (const [y, l] of [[0.2, 0.08], [0.27, 0.07]]) crown.add(mesh(H.tube([V(s * 0.095, y, -0.02), V(s * 0.14, y + 0.04, 0.0), V(s * (0.12 + l), y + 0.07, 0.01)], 0.007, 6, 4), M.wood));
      for (let i = 0; i < 3; i++) { const lf = mesh(new THREE.CircleGeometry(0.022, 5), X.leaf, false); lf.scale.y = 1.7; lf.position.set(s * (0.1 + i * 0.02), 0.2 + i * 0.05, 0.0); lf.rotation.set(0, s * 0.6, s * 0.5); crown.add(lf); }
      const fl = mesh(H.sph(0.016, 8, 6), X.petal, false); fl.position.set(s * 0.12, 0.33, -0.05); crown.add(fl);
    }
    const band = mesh(H.tor(0.13, 0.012, 6, 30), M.wood); band.rotation.x = Math.PI / 2 - 0.1; band.position.y = 0.08; crown.add(band);
    crown.scale.setScalar(K.kh); K.onHead(crown, 0, -0.04, 0);
    const robe = skirt(K, X.moss, { len: 0.86, flare: 0.38, trim: M.wood });
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; const lf = mesh(new THREE.CircleGeometry(0.035 * k, 5), X.leaf, false); lf.scale.y = 1.8; lf.position.set(Math.sin(a) * 0.36 * k, -0.84 * k, Math.cos(a) * 0.33 * k); K.hips(lf, Math.sin(a) * 0.37, -0.8, Math.cos(a) * 0.34, { yaw: a, pitch: 0.35 }); }
    K.belt(M.darkleather, X.jade, 0.21);
    K.gauntlets(M.darkleather, M.wood, 1.1);
    const vine = new THREE.Group(); const pts = []; for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push(V(Math.sin(u * 9) * 0.05 * k + (u - 0.5) * 0.3 * k, (0.5 - u) * 0.4 * k, 0.17 * k)); } vine.add(mesh(H.tube(pts, 0.008 * k, 30, 4), X.leaf));
    K.chest(vine, 0, 0);
    K.cape(X.moss, 0.5, 0.95, { ragged: 0.03 });
  },
};
SETS['dreadknight:frost'] = (K) => { // frost-rimed dark plate, ice-crystal spiked pauldrons, horned helm with glowing eye slits
  const { H, M, X, k } = K, { mesh } = H;
  K.pads(s => P.spiked(K, 0.14 * k, M.blacksteel, X.ice, { n: 3 }), { up: 0.07 });
  K.breastplate(M.blacksteel, M.silver, M.rune(0x7ad0ff, 1.6));
  K.gauntlets(M.blacksteel, M.silver, 1.25);
  K.greaves(M.blacksteel, M.silver);
  K.belt(M.darkleather, M.silver, 0.2);
  K.tassets(M.blacksteel, M.silver, 4);
  skirt(K, X.chain, { len: 0.38, flare: 0.27, top: 0.19 });
  K.tabard(M.royal, 0.22, 0.58, M.silver);
  const helm = H.helmGreat(M, 0.14, { crest: null, horns: true });
  helm.traverse(o => { if (o.isMesh && o.material === M.steel) o.material = M.blacksteel; });
  const slit = mesh(H.box(0.15, 0.016, 0.03), M.rune(0x7ad0ff, 3), false); slit.position.set(0, -0.015, 0.142); helm.add(slit);
  for (let i = 0; i < 3; i++) { const c = H.spike(0.014, 0.06 + (i === 1 ? 0.03 : 0), X.ice); c.position.set((i - 1) * 0.05, 0.15, 0.04); helm.add(c); }
  helm.scale.setScalar(K.kh); K.onHead(helm, 0, 0.01, -0.005);
  K.cape(M.royal, 0.5, 0.9, { ragged: 0.03, trim: M.silver });
};
SETS['dreadknight:blood'] = (K) => { // black-and-crimson plate, skull pauldrons, spiked crown-helm, crimson cloak
  const { H, M, X, k } = K, { mesh } = H;
  K.pads(s => P.skull(K, 0.16 * k, M.blacksteel, M.bone), { up: 0.08, out: 0.03 });
  K.breastplate(M.blacksteel, M.darksteel, M.rune(0xff3a4a, 1.6));
  K.gauntlets(M.blacksteel, M.darksteel, 1.25);
  K.greaves(M.blacksteel, M.darksteel);
  K.belt(M.darkleather, M.bone, 0.2);
  K.tassets(M.blacksteel, M.darksteel, 5);
  skirt(K, X.chain, { len: 0.4, flare: 0.28, top: 0.19 });
  K.tabard(M.crimson, 0.24, 0.6, M.darksteel);
  const sk = H.skullMesh(M, 0.05 * k); K.hips(sk, 0, 0.05, 0.21);
  const helm = H.helmGreat(M, 0.14, { crest: null });
  helm.traverse(o => { if (o.isMesh && o.material === M.steel) o.material = M.blacksteel; });
  const slit = mesh(H.box(0.15, 0.016, 0.03), M.rune(0xff3a4a, 3), false); slit.position.set(0, -0.015, 0.142); helm.add(slit);
  for (let i = 0; i < 5; i++) { const c = H.spike(0.013, 0.06 + (i === 2 ? 0.04 : 0), M.darksteel); c.position.set((i - 2) * 0.04, 0.15 - Math.abs(i - 2) * 0.01, 0.05); helm.add(c); }
  helm.scale.setScalar(K.kh); K.onHead(helm, 0, 0.01, -0.005);
  K.cape(M.crimson, 0.5, 0.92, { ragged: 0.03, trim: M.darksteel });
};
// classes without a spec key fall back to their first spec's set
SETS.mage = SETS['mage:frost']; SETS.rogue = SETS['rogue:subtlety']; SETS.warrior = SETS['warrior:protection']; SETS.berserker = SETS['berserker:fury'];
SETS.paladin = SETS['paladin:crusader']; SETS.priest = SETS['priest:discipline']; SETS.shaman = SETS['shaman:elemental']; SETS.hunter = SETS['hunter:beastmaster'];
SETS.necromancer = SETS['necromancer:summoner']; SETS.druid = SETS['druid:restoration']; SETS.dreadknight = SETS['dreadknight:frost'];
