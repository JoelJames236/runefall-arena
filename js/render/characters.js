// Procedurally-built fantasy champions with a lightweight skeletal rig and
// procedural animation (locomotion, casting, attacks, CC, death, victory).
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.7, metalness: o.m ?? 0.05, emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1, flatShading: !!o.flat, side: o.side ?? THREE.FrontSide, transparent: !!o.transparent, opacity: o.opacity ?? 1 });
}
function glow(color, opacity = 0.9) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
}
function mesh(geo, m, pos, rot, scale) {
  const o = new THREE.Mesh(geo, m);
  if (pos) o.position.copy(pos);
  if (rot) o.rotation.set(rot[0], rot[1], rot[2]);
  if (scale) o.scale.set(scale[0], scale[1], scale[2]);
  o.castShadow = true; o.receiveShadow = true;
  return o;
}
const grp = (parent, pos) => { const x = new THREE.Group(); if (pos) x.position.copy(pos); parent.add(x); return x; };
const cap = (r, l, s = 10) => new THREE.CapsuleGeometry(r, l, 4, s);
const sph = (r, w = 16, h = 12, ...rest) => new THREE.SphereGeometry(r, w, h, ...rest);
const cyl = (rt, rb, h, s = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const cone = (r, h, s = 12) => new THREE.ConeGeometry(r, h, s);

// ------------------------------------------------------------------ base rig
function buildRig(p) {
  const root = new THREE.Group();
  const body = grp(root, V(0, 0.98, 0));
  const hips = grp(body);
  const spine = grp(hips, V(0, 0.08, 0));
  const chest = grp(spine, V(0, 0.32, 0));
  const head = grp(chest, V(0, 0.42, 0));
  const shL = grp(chest, V(0.27, 0.27, 0)), shR = grp(chest, V(-0.27, 0.27, 0));
  const elL = grp(shL, V(0, -0.31, 0)), elR = grp(shR, V(0, -0.31, 0));
  const handL = grp(elL, V(0, -0.29, 0)), handR = grp(elR, V(0, -0.29, 0));
  const legL = grp(hips, V(0.12, -0.04, 0)), legR = grp(hips, V(-0.12, -0.04, 0));
  const knL = grp(legL, V(0, -0.45, 0)), knR = grp(legR, V(0, -0.45, 0));

  const skin = mat(p.skin, { r: 0.6 });
  // torso
  chest.add(mesh(cap(0.2, 0.28), p.torsoMat, V(0, 0.02, 0), null, [1.15, 1, 0.75]));
  hips.add(mesh(cap(0.17, 0.08), p.hipMat || p.torsoMat, V(0, 0.02, 0), null, [1.15, 1, 0.8]));
  spine.add(mesh(cap(0.16, 0.18), p.torsoMat, V(0, 0.12, 0), null, [1.05, 1, 0.72]));
  // head
  head.add(mesh(sph(0.15), skin, V(0, 0.08, 0.01), null, [0.95, 1.08, 1]));
  head.add(mesh(cyl(0.065, 0.075, 0.12, 10), skin, V(0, -0.07, 0)));
  const eyeM = new THREE.MeshBasicMaterial({ color: p.eyes || 0x111111 });
  head.add(mesh(sph(0.022, 8, 6), eyeM, V(0.055, 0.1, 0.13)));
  head.add(mesh(sph(0.022, 8, 6), eyeM, V(-0.055, 0.1, 0.13)));
  // arms
  for (const [sh, el, hand] of [[shL, elL, handL], [shR, elR, handR]]) {
    sh.add(mesh(cap(0.075, 0.2), p.armMat || p.torsoMat, V(0, -0.15, 0)));
    el.add(mesh(cap(0.065, 0.2), p.foreMat || p.armMat || p.torsoMat, V(0, -0.14, 0)));
    hand.add(mesh(sph(0.065, 10, 8), p.handMat || skin, V(0, -0.02, 0), null, [1, 1.1, 0.9]));
  }
  // legs
  for (const [lg, kn] of [[legL, knL], [legR, knR]]) {
    lg.add(mesh(cap(0.095, 0.27), p.legMat, V(0, -0.22, 0)));
    kn.add(mesh(cap(0.08, 0.28), p.bootMat || p.legMat, V(0, -0.22, 0)));
    kn.add(mesh(box(0.15, 0.09, 0.27), p.bootMat || p.legMat, V(0, -0.47, 0.05)));
  }
  return { root, body, hips, spine, chest, head, shL, shR, elL, elR, handL, handR, legL, legR, knL, knR };
}

// ------------------------------------------------------------------ class builders
function buildMage() {
  const robe = mat(0x23307a, { r: 0.85 }), trim = mat(0xd4a64a, { r: 0.35, m: 0.8 }), inner = mat(0x4a2378, { r: 0.8 });
  const R = buildRig({ skin: 0xe2b496, torsoMat: robe, legMat: inner, bootMat: mat(0x2a1a12), armMat: robe, foreMat: inner, eyes: 0x6fd0ff });
  // long robe skirt
  const skirt = mesh(cyl(0.2, 0.42, 0.95, 18, true), mat(0x23307a, { r: 0.85, side: THREE.DoubleSide }), V(0, -0.5, 0));
  R.hips.add(skirt);
  R.hips.add(mesh(new THREE.TorusGeometry(0.42, 0.025, 6, 24), trim, V(0, -0.97, 0), [Math.PI / 2, 0, 0]));
  R.hips.add(mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 20), trim, V(0, 0.02, 0), [Math.PI / 2, 0, 0], [1.1, 0.8, 1]));
  R.chest.add(mesh(box(0.1, 0.5, 0.05), trim, V(0, 0, 0.15)));
  // shoulder mantles
  for (const s of [1, -1]) {
    R.chest.add(mesh(sph(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), inner, V(0.25 * s, 0.25, 0), null, [1.2, 0.7, 1.1]));
    R.chest.add(mesh(new THREE.TorusGeometry(0.13, 0.018, 6, 16), trim, V(0.25 * s, 0.22, 0), [Math.PI / 2, 0, 0], [1.25, 1.1, 1]));
  }
  // wide sleeves
  for (const e of [R.elL, R.elR]) e.add(mesh(cyl(0.08, 0.15, 0.3, 12, true), mat(0x23307a, { r: 0.85, side: THREE.DoubleSide }), V(0, -0.16, 0)));
  // hood + pointed hat
  R.head.add(mesh(sph(0.19, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), robe, V(0, 0.1, -0.02), null, [1, 1.05, 1.08]));
  const hat = mesh(cone(0.2, 0.5, 16), robe, V(0, 0.42, -0.06), [-0.25, 0, 0]);
  R.head.add(hat);
  R.head.add(mesh(new THREE.TorusGeometry(0.19, 0.025, 6, 20), trim, V(0, 0.2, -0.02), [Math.PI / 2 - 0.1, 0, 0]));
  // beard
  R.head.add(mesh(cone(0.08, 0.22, 8), mat(0xcfcfd8, { r: 1 }), V(0, -0.06, 0.12), [Math.PI + 0.35, 0, 0]));
  // staff
  const staff = grp(R.handR, V(0, -0.02, 0.06));
  staff.add(mesh(cyl(0.025, 0.03, 1.9, 8), mat(0x3a2414, { r: 0.8 }), V(0, 0.15, 0)));
  staff.add(mesh(new THREE.TorusGeometry(0.1, 0.018, 6, 16), trim, V(0, 1.12, 0)));
  staff.add(mesh(new THREE.TorusGeometry(0.1, 0.018, 6, 16), trim, V(0, 1.12, 0), [0, Math.PI / 2, 0]));
  const crystal = mesh(new THREE.OctahedronGeometry(0.09), mat(0xb48aff, { e: 0x8a5aff, ei: 2.2, r: 0.2 }), V(0, 1.12, 0), null, [0.8, 1.5, 0.8]);
  staff.add(crystal);
  const orb = mesh(sph(0.2, 12, 10), glow(0x9a6aff, 0.25), V(0, 1.12, 0)); staff.add(orb);
  // floating arcane runes around off-hand
  const rune = mesh(new THREE.TorusGeometry(0.12, 0.008, 4, 24), glow(0x8fd8ff, 0.7), V(0, -0.08, 0), [Math.PI / 2, 0, 0]);
  R.handL.add(rune);
  return { R, scale: 1.0, focus: crystal, focusGlow: orb, spin: [rune], castColor: 0x9a6aff, weaponR: staff, uprightStaff: true };
}

function buildRogue() {
  const leather = mat(0x2b231f, { r: 0.75 }), cloth = mat(0x2a1d38, { r: 0.9 }), strap = mat(0x5a3a22, { r: 0.6 }), metal = mat(0x8a8f99, { r: 0.3, m: 0.9 });
  const R = buildRig({ skin: 0xd8a888, torsoMat: leather, legMat: cloth, bootMat: mat(0x1a1412), armMat: cloth, foreMat: leather, handMat: mat(0x1a1412), eyes: 0xb6ff6a });
  // crossing belts
  R.chest.add(mesh(box(0.06, 0.62, 0.04), strap, V(0, 0, 0.15), [0, 0, 0.6]));
  R.chest.add(mesh(box(0.06, 0.62, 0.04), strap, V(0, 0, 0.15), [0, 0, -0.6]));
  R.hips.add(mesh(new THREE.TorusGeometry(0.19, 0.03, 6, 20), strap, V(0, 0.05, 0), [Math.PI / 2, 0, 0], [1.1, 0.8, 1]));
  R.hips.add(mesh(box(0.14, 0.18, 0.05), strap, V(0.12, -0.08, 0.15), [0, 0, 0.1]));
  // short tattered cape
  const cape = mesh(new THREE.PlaneGeometry(0.5, 0.8, 4, 6), mat(0x231830, { r: 1, side: THREE.DoubleSide }), V(0, -0.15, -0.17), [0.12, 0, 0]);
  R.chest.add(cape);
  // pauldron (left) leather
  R.chest.add(mesh(sph(0.12, 10, 8), leather, V(0.27, 0.25, 0), null, [1.2, 0.8, 1.1]));
  // hood & mask
  R.head.add(mesh(sph(0.2, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.68), cloth, V(0, 0.1, -0.03), null, [1, 1.1, 1.12]));
  R.head.add(mesh(cone(0.12, 0.25, 10), cloth, V(0, 0.18, -0.17), [-1.9, 0, 0]));
  R.head.add(mesh(cyl(0.135, 0.15, 0.12, 14, true), mat(0x111111, { r: 0.9, side: THREE.DoubleSide }), V(0, 0.0, 0.03)));
  // daggers (reverse grip-ish, pointing forward)
  const mkDagger = hand => {
    const d = grp(hand, V(0, -0.05, 0.02)); d.rotation.x = Math.PI / 2 + 0.25;
    d.add(mesh(cyl(0.02, 0.02, 0.12, 6), strap, V(0, -0.02, 0)));
    d.add(mesh(box(0.14, 0.025, 0.04), metal, V(0, 0.05, 0)));
    const blade = mesh(cone(0.04, 0.42, 4), metal, V(0, 0.27, 0), null, [1, 1, 0.3]); d.add(blade);
    d.add(mesh(cone(0.045, 0.44, 4), glow(0x7aff5a, 0.35), V(0, 0.27, 0), null, [1, 1, 0.25]));
    return d;
  };
  const dL = mkDagger(R.handL), dR = mkDagger(R.handR);
  return { R, scale: 0.97, castColor: 0x9be36a, weaponR: dR, weaponL: dL, cape };
}

function buildWarrior() {
  const plate = mat(0x9aa2ae, { r: 0.32, m: 0.9 }), dark = mat(0x3a3e46, { r: 0.4, m: 0.85 }), gold = mat(0xd9a640, { r: 0.3, m: 0.9 }), red = mat(0x8a1a14, { r: 0.85 });
  const R = buildRig({ skin: 0xc89878, torsoMat: plate, legMat: dark, bootMat: plate, armMat: dark, foreMat: plate, handMat: dark, hipMat: dark, eyes: 0xff9a40 });
  // breastplate + tabard
  R.chest.add(mesh(sph(0.24, 16, 12), plate, V(0, 0.04, 0.03), null, [1.15, 1.05, 0.85]));
  R.chest.add(mesh(box(0.05, 0.3, 0.02), gold, V(0, 0.05, 0.24)));
  R.hips.add(mesh(box(0.28, 0.6, 0.03), red, V(0, -0.25, 0.17)));
  R.hips.add(mesh(box(0.28, 0.6, 0.03), red, V(0, -0.25, -0.17)));
  R.hips.add(mesh(cyl(0.22, 0.27, 0.22, 14), plate, V(0, -0.08, 0)));
  // massive pauldrons with spikes
  for (const s of [1, -1]) {
    const pd = grp(R.chest, V(0.3 * s, 0.28, 0));
    pd.add(mesh(sph(0.17, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.7), plate, V(0, 0, 0), [0, 0, -0.35 * s], [1.25, 1, 1.15]));
    pd.add(mesh(new THREE.TorusGeometry(0.17, 0.02, 6, 18), gold, V(0, -0.02, 0), [Math.PI / 2, 0, -0.35 * s], [1.25, 1.15, 1]));
    pd.add(mesh(cone(0.04, 0.2, 8), dark, V(0.05 * s, 0.14, 0), [0, 0, -0.5 * s]));
  }
  // horned great helm
  R.head.add(mesh(sph(0.19, 16, 12), plate, V(0, 0.1, 0), null, [1, 1.1, 1.05]));
  R.head.add(mesh(box(0.22, 0.03, 0.05), new THREE.MeshBasicMaterial({ color: 0x1a0f08 }), V(0, 0.1, 0.18)));
  R.head.add(mesh(box(0.03, 0.15, 0.04), gold, V(0, 0.18, 0.18)));
  for (const s of [1, -1]) {
    const horn = mesh(cone(0.05, 0.35, 10), mat(0xe8dcc0, { r: 0.5 }), V(0.2 * s, 0.25, 0), [0, 0, -1.0 * s]);
    R.head.add(horn);
  }
  R.head.add(mesh(cyl(0.01, 0.05, 0.24, 6), red, V(0, 0.33, -0.05), [-0.4, 0, 0]));
  // sword (right)
  const sword = grp(R.handR, V(0, -0.04, 0.02)); sword.rotation.x = Math.PI / 2;
  sword.add(mesh(cyl(0.025, 0.025, 0.24, 8), mat(0x3a2414), V(0, -0.05, 0)));
  sword.add(mesh(sph(0.04, 8, 6), gold, V(0, -0.18, 0)));
  sword.add(mesh(box(0.3, 0.05, 0.06), gold, V(0, 0.08, 0)));
  sword.add(mesh(box(0.09, 1.0, 0.02), mat(0xd0d6e0, { r: 0.2, m: 0.95 }), V(0, 0.6, 0)));
  sword.add(mesh(cone(0.045, 0.14, 4), mat(0xd0d6e0, { r: 0.2, m: 0.95 }), V(0, 1.17, 0), [0, Math.PI / 4, 0], [1, 1, 0.3]));
  const rune = mesh(box(0.02, 0.8, 0.025), glow(0xff8a2a, 0.9), V(0, 0.55, 0)); sword.add(rune);
  // tower shield (left)
  const shield = grp(R.elL, V(0.1, -0.18, 0.02)); shield.rotation.y = Math.PI / 2;
  const sh = mesh(box(0.55, 0.72, 0.06), red, V(0, 0, 0)); shield.add(sh);
  shield.add(mesh(box(0.6, 0.06, 0.08), gold, V(0, 0.36, 0)));
  shield.add(mesh(box(0.6, 0.06, 0.08), gold, V(0, -0.36, 0)));
  shield.add(mesh(box(0.06, 0.76, 0.08), gold, V(0.28, 0, 0)));
  shield.add(mesh(box(0.06, 0.76, 0.08), gold, V(-0.28, 0, 0)));
  shield.add(mesh(cyl(0.1, 0.12, 0.06, 16), gold, V(0, 0.05, 0.04), [Math.PI / 2, 0, 0]));
  shield.add(mesh(cone(0.06, 0.12, 8), plate, V(0, 0.05, 0.11), [Math.PI / 2, 0, 0]));
  shield.position.set(0.12, -0.12, 0); shield.rotation.set(0, Math.PI / 2, 0);
  return { R, scale: 1.12, castColor: 0xff8a2a, weaponR: sword, shield, focus: rune };
}

function buildPriest() {
  const white = mat(0xeae4d6, { r: 0.8 }), gold = mat(0xe8c060, { r: 0.3, m: 0.85 }), blue = mat(0x2e4c94, { r: 0.8 });
  const R = buildRig({ skin: 0xf0c8a8, torsoMat: white, legMat: white, bootMat: gold, armMat: white, foreMat: white, eyes: 0x4a8aff });
  R.hips.add(mesh(cyl(0.2, 0.46, 0.98, 18, true), mat(0xeae4d6, { r: 0.8, side: THREE.DoubleSide }), V(0, -0.52, 0)));
  R.hips.add(mesh(box(0.16, 0.9, 0.02), blue, V(0, -0.45, 0.25), [0.2, 0, 0]));
  R.hips.add(mesh(new THREE.TorusGeometry(0.46, 0.025, 6, 24), gold, V(0, -1.0, 0), [Math.PI / 2, 0, 0]));
  R.hips.add(mesh(new THREE.TorusGeometry(0.2, 0.04, 6, 20), gold, V(0, 0.03, 0), [Math.PI / 2, 0, 0], [1.1, 0.8, 1]));
  R.chest.add(mesh(sph(0.21, 14, 10), gold, V(0, 0.08, 0.04), null, [1.1, 0.9, 0.7]));
  R.chest.add(mesh(box(0.06, 0.18, 0.02), blue, V(0, 0.12, 0.22)));
  R.chest.add(mesh(box(0.14, 0.05, 0.02), blue, V(0, 0.16, 0.225)));
  for (const s of [1, -1]) {
    R.chest.add(mesh(sph(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold, V(0.26 * s, 0.24, 0), null, [1.3, 0.8, 1.1]));
    const wing = mesh(cone(0.05, 0.32, 6), gold, V(0.32 * s, 0.38, -0.05), [0.2, 0, -0.7 * s]); R.chest.add(wing);
    R.elL.add(mesh(cyl(0.075, 0.14, 0.3, 12, true), mat(0xeae4d6, { r: 0.8, side: THREE.DoubleSide }), V(0, -0.16, 0)));
  }
  R.elR.add(mesh(cyl(0.075, 0.14, 0.3, 12, true), mat(0xeae4d6, { r: 0.8, side: THREE.DoubleSide }), V(0, -0.16, 0)));
  // hair + circlet + halo
  R.head.add(mesh(sph(0.165, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(0xe8d6a0, { r: 0.9 }), V(0, 0.11, -0.02), null, [1, 1, 1.05]));
  R.head.add(mesh(box(0.25, 0.3, 0.1), mat(0xe8d6a0, { r: 0.9 }), V(0, -0.02, -0.12)));
  R.head.add(mesh(new THREE.TorusGeometry(0.16, 0.014, 6, 20), gold, V(0, 0.14, 0), [Math.PI / 2 - 0.15, 0, 0]));
  const halo = mesh(new THREE.TorusGeometry(0.22, 0.02, 8, 32), mat(0xffe28a, { e: 0xffcf50, ei: 2.5 }), V(0, 0.42, -0.08), [Math.PI / 2 - 0.3, 0, 0]);
  R.head.add(halo);
  R.head.add(mesh(new THREE.TorusGeometry(0.22, 0.06, 8, 32), glow(0xffd870, 0.25), V(0, 0.42, -0.08), [Math.PI / 2 - 0.3, 0, 0]));
  // mace
  const mace = grp(R.handR, V(0, -0.03, 0.03)); mace.rotation.x = Math.PI / 2 - 0.2;
  mace.add(mesh(cyl(0.025, 0.03, 0.7, 8), mat(0xf0e0c0, { r: 0.4, m: 0.4 }), V(0, 0.15, 0)));
  mace.add(mesh(new THREE.TorusGeometry(0.035, 0.012, 6, 10), gold, V(0, -0.15, 0), [Math.PI / 2, 0, 0]));
  const head = mesh(new THREE.IcosahedronGeometry(0.11, 0), gold, V(0, 0.55, 0)); mace.add(head);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; mace.add(mesh(box(0.02, 0.16, 0.08), gold, V(Math.sin(a) * 0.1, 0.55, Math.cos(a) * 0.1), [0, a, 0])); }
  const core = mesh(sph(0.07, 12, 10), mat(0xfff2c0, { e: 0xffe080, ei: 3 }), V(0, 0.55, 0)); mace.add(core);
  const cg = mesh(sph(0.2, 12, 10), glow(0xffe08a, 0.25), V(0, 0.55, 0)); mace.add(cg);
  return { R, scale: 1.0, castColor: 0xffe08a, weaponR: mace, focus: core, focusGlow: cg, halo };
}

function buildShaman() {
  const fur = mat(0x8c7c68, { r: 1, flat: true }), leather = mat(0x4a2c16, { r: 0.8 }), bone = mat(0xe2d6ba, { r: 0.6 }), paint = mat(0x3ab8e0, { e: 0x1a6a90, ei: 0.6 });
  const R = buildRig({ skin: 0x9a6a4a, torsoMat: leather, legMat: leather, bootMat: fur, armMat: mat(0x9a6a4a, { r: 0.6 }), foreMat: mat(0x9a6a4a, { r: 0.6 }), eyes: 0x7ae0ff });
  // fur mantle
  R.chest.add(mesh(new THREE.TorusGeometry(0.24, 0.12, 8, 14), fur, V(0, 0.24, 0), [Math.PI / 2, 0, 0], [1.1, 1, 1]));
  for (let i = 0; i < 7; i++) { const a = (i / 6 - 0.5) * 2.2; R.chest.add(mesh(cone(0.022, 0.1, 6), bone, V(Math.sin(a) * 0.2, 0.06, Math.cos(a) * 0.2 + 0.02), [Math.PI, 0, 0])); }
  R.chest.add(mesh(box(0.3, 0.04, 0.02), paint, V(0, -0.05, 0.19)));
  R.chest.add(mesh(box(0.04, 0.2, 0.02), paint, V(0, -0.08, 0.195)));
  // kilt + belt
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; R.hips.add(mesh(box(0.13, 0.42, 0.03), i % 2 ? fur : leather, V(Math.sin(a) * 0.22, -0.2, Math.cos(a) * 0.2), [Math.cos(a) * 0.15, a, -Math.sin(a) * 0.15])); }
  R.hips.add(mesh(new THREE.TorusGeometry(0.21, 0.035, 6, 20), mat(0x3a2a18), V(0, 0.02, 0), [Math.PI / 2, 0, 0], [1.1, 0.8, 1]));
  R.hips.add(mesh(sph(0.06, 8, 6), bone, V(0, 0.0, 0.2)));
  // shoulder: stone pauldron with spike
  R.chest.add(mesh(new THREE.DodecahedronGeometry(0.15), mat(0x6a6a72, { r: 0.9, flat: true }), V(-0.3, 0.27, 0)));
  R.chest.add(mesh(cone(0.04, 0.2, 6), bone, V(-0.36, 0.4, 0), [0, 0, 0.5]));
  // beast skull helm
  R.head.add(mesh(sph(0.18, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), bone, V(0, 0.12, 0), null, [1, 1, 1.15]));
  R.head.add(mesh(box(0.18, 0.08, 0.14), bone, V(0, 0.2, 0.15)));
  for (const s of [1, -1]) {
    R.head.add(mesh(cone(0.045, 0.32, 8), bone, V(0.17 * s, 0.32, -0.02), [0.3, 0, -0.5 * s]));
    R.head.add(mesh(sph(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7ae0ff }), V(0.06 * s, 0.2, 0.22)));
  }
  R.head.add(mesh(box(0.2, 0.02, 0.02), paint, V(0, 0.06, 0.15)));
  // braided beard
  R.head.add(mesh(cyl(0.04, 0.02, 0.2, 6), mat(0x2a1a10), V(0, -0.12, 0.11), [0.3, 0, 0]));
  // totem staff
  const staff = grp(R.handR, V(0, -0.02, 0.06));
  const wood = mat(0x4a2e18, { r: 0.9 });
  staff.add(mesh(cyl(0.03, 0.035, 1.8, 8), wood, V(0, 0.1, 0)));
  staff.add(mesh(box(0.16, 0.22, 0.14), mat(0x6a4426, { r: 0.8, flat: true }), V(0, 1.02, 0)));
  staff.add(mesh(box(0.12, 0.03, 0.02), paint, V(0, 1.05, 0.075)));
  staff.add(mesh(cone(0.04, 0.16, 6), bone, V(0.1, 1.18, 0), [0, 0, -0.6]));
  staff.add(mesh(cone(0.04, 0.16, 6), bone, V(-0.1, 1.18, 0), [0, 0, 0.6]));
  const orb = mesh(sph(0.07, 12, 10), mat(0xc8f6ff, { e: 0x4ad8ff, ei: 3 }), V(0, 1.25, 0)); staff.add(orb);
  const og = mesh(sph(0.2, 12, 10), glow(0x4ad8ff, 0.3), V(0, 1.25, 0)); staff.add(og);
  for (const y of [0.85, 0.75]) staff.add(mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 10), mat(0xc87a2a, { m: 0.7, r: 0.4 }), V(0, y, 0), [Math.PI / 2, 0, 0]));
  // feather on staff
  staff.add(mesh(new THREE.PlaneGeometry(0.06, 0.25), mat(0xc0402a, { side: THREE.DoubleSide }), V(0.08, 0.8, 0), [0, 0, 0.3]));
  // offhand fire
  const fire = mesh(sph(0.08, 10, 8), glow(0xff8a2a, 0.8), V(0, -0.1, 0.04)); R.handL.add(fire);
  return { R, scale: 1.04, castColor: 0x4ad8ff, weaponR: staff, focus: orb, focusGlow: og, fireHand: fire, uprightStaff: true };
}

const BUILDERS = { mage: buildMage, rogue: buildRogue, warrior: buildWarrior, priest: buildPriest, shaman: buildShaman };

// ------------------------------------------------------------------ animated character
export class Character {
  constructor(cls) {
    this.cls = cls;
    const b = BUILDERS[cls]();
    Object.assign(this, b);
    this.root = b.R.root;
    this.root.scale.setScalar(b.scale);
    this.R.head.scale.setScalar(0.86);
    this.phase = 0; this.time = Math.random() * 10;
    this.act = null; // one-shot action { kind, t, dur }
    this.deadT = 0; this.victory = false; this.hitT = 0;
    this.pose = {};
    this.opacity = 1;
    // collect materials for stealth fading
    this.materials = [];
    this.root.traverse(o => { if (o.material && !this.materials.includes(o.material)) { this.materials.push(o.material); o.material.userData.baseOpacity = o.material.opacity; o.material.userData.baseTransparent = o.material.transparent; } });
  }

  play(kind, dur = 0.45) { this.act = { kind, t: 0, dur }; }
  hit() { this.hitT = 0.25; }

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

  // st: { speed (0..1+), back (bool), strafe (-1..1), air, casting, stunned, disoriented, dead, victory, tempest, castProgress }
  update(dt, st) {
    this.time += dt;
    const R = this.R, P = {};
    const T = this.time;
    const k = 1 - Math.exp(-dt * 14);
    const moveAmt = Math.min(1.3, st.speed || 0);
    this.phase += dt * (6 + moveAmt * 5) * (st.back ? -1 : 1) * (moveAmt > 0.05 ? 1 : 0);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);

    // ---- base: idle / locomotion
    const breathe = Math.sin(T * 2) * 0.02;
    P.bodyY = 0.98 + breathe * 0.5 + (moveAmt > 0.05 ? Math.abs(c) * 0.07 * moveAmt : 0);
    P.spineX = moveAmt * 0.12; P.spineY = 0; P.chestX = 0; P.headX = -moveAmt * 0.08;
    P.legL = s * 0.75 * moveAmt; P.legR = -s * 0.75 * moveAmt;
    P.knL = Math.max(0, -c) * 1.1 * moveAmt + 0.05; P.knR = Math.max(0, c) * 1.1 * moveAmt + 0.05;
    P.shLx = -s * 0.55 * moveAmt; P.shRx = s * 0.55 * moveAmt; P.shLz = 0.12; P.shRz = -0.12;
    P.elL = -0.25 - moveAmt * 0.4; P.elR = -0.25 - moveAmt * 0.4;
    P.rootTilt = 0; P.bodyRotY = st.strafe ? st.strafe * -0.5 * Math.min(1, moveAmt) : 0;
    this.classIdle(P, moveAmt, T);

    if (st.air) { P.legL = -0.6; P.legR = 0.2; P.knL = 1.2; P.knR = 0.5; P.shLz = 0.5; P.shRz = -0.5; }

    if (st.casting) {
      const pr = st.castProgress || 0;
      P.shLx = -1.2 - Math.sin(T * 9) * 0.05; P.shRx = -1.4; P.elL = -0.5; P.elR = -0.3;
      P.shLz = 0.25; P.shRz = -0.2; P.spineX = -0.05 - pr * 0.1; P.headX = -0.1;
      if (this.cls === 'priest') { P.shLx = -1.6; P.shRx = -1.6; P.shLz = 0.4; P.shRz = -0.4; }
    }
    if (st.tempest) {
      P.shLz = 1.4; P.shRz = -1.4; P.shLx = -0.2; P.shRx = -0.2; P.elL = 0; P.elR = 0; P.spineX = 0.2;
    }

    // ---- one-shot action overlay
    if (this.act) {
      const a = this.act; a.t += dt;
      const u = Math.min(1, a.t / a.dur);
      const wind = u < 0.3 ? u / 0.3 : 1, strike = u < 0.3 ? 0 : Math.min(1, (u - 0.3) / 0.25), rec = u > 0.6 ? (u - 0.6) / 0.4 : 0;
      const env = (1 - rec);
      switch (a.kind) {
        case 'slash': // big right-handed swing
          P.shRx = (-2.6 * wind + 3.4 * strike) * env + P.shRx * rec; P.shRz = -0.4 * env; P.elR = -0.4 * env;
          P.spineY = (0.5 * wind - 1.0 * strike) * env; P.spineX = 0.2 * strike * env; break;
        case 'stab': { // alternating dagger stabs
          const alt = (Math.floor(T * 1000) % 2);
          P.shRx = (-0.4 * wind - 1.3 * strike) * env; P.elR = (-1.6 * wind + 1.4 * strike) * env - 0.2;
          P.shLx = (-0.4 * wind - 1.1 * strike * 0.8) * env; P.elL = (-1.4 * wind + 1.2 * strike) * env - 0.2;
          P.spineY = (-0.3 * wind + 0.5 * strike) * env; P.spineX = 0.25 * env; break; }
        case 'finisher':
          P.shRx = (-2.8 * wind + 3.6 * strike) * env; P.shLx = (-2.8 * wind + 3.6 * strike) * env; P.elR = -0.3; P.elL = -0.3;
          P.shRz = -0.3; P.shLz = 0.3; P.spineX = 0.4 * strike * env; P.bodyY -= 0.15 * strike * env; break;
        case 'bash':
          P.shLx = (-0.4 - 1.2 * strike) * env; P.shLz = 0.3; P.elL = -1.0 * (1 - strike) * env; P.spineY = 0.6 * strike * env; break;
        case 'release': // spell release, both hands thrust
          P.shRx = -1.5 * env; P.shLx = -1.5 * env; P.elR = -0.1; P.elL = -0.1; P.spineX = -0.1 + 0.25 * strike * env; P.shLz = 0.2; P.shRz = -0.2; break;
        case 'raise': // arms skyward
          P.shRx = -2.9 * env; P.shLx = -2.9 * env; P.shLz = 0.3; P.shRz = -0.3; P.elR = 0; P.elL = 0; P.headX = -0.4 * env; P.spineX = -0.15 * env; break;
        case 'slam': // slam something into the ground
          P.shRx = (-2.8 * wind + 2.9 * strike) * env; P.shLx = (-2.6 * wind + 2.6 * strike) * env; P.spineX = 0.55 * strike * env; P.bodyY -= 0.25 * strike * env;
          P.knL = 0.9 * strike * env; P.knR = 0.9 * strike * env; P.legL = -0.6 * strike * env; P.legR = -0.6 * strike * env; break;
        case 'dash':
          P.spineX = 0.5 * env; P.shLx = 0.8 * env; P.shRx = 0.8 * env; P.legL = -0.8 * env; P.legR = 0.6 * env; P.knR = 1.0 * env; break;
        case 'charge':
          P.spineX = 0.4; P.shLx = -1.0; P.shLz = 0.2; P.shRx = 0.6; P.legL = Math.sin(T * 30) * 0.9; P.legR = -Math.sin(T * 30) * 0.9; break;
        case 'flinch':
          P.spineX = -0.25 * (1 - u); P.headX = -0.3 * (1 - u); break;
      }
      if (a.t >= a.dur) this.act = null;
    }
    if (this.hitT > 0) { this.hitT -= dt; P.spineX -= this.hitT * 0.8; P.headX -= this.hitT; }

    if (st.stunned) { P.headX = 0.5 + Math.sin(T * 3) * 0.1; P.spineX = 0.35; P.shLx = 0.1; P.shRx = 0.1; P.shLz = 0.05; P.shRz = -0.05; P.knL = 0.4; P.knR = 0.4; P.bodyY -= 0.1; P.bodyRotY = Math.sin(T * 2) * 0.2; }
    if (st.disoriented) { P.shLx = -2.6; P.shRx = -2.6; P.elL = -2.2; P.elR = -2.2; P.shLz = 0.6; P.shRz = -0.6; P.headX = 0.3; P.bodyRotY = Math.sin(T * 2.5) * 0.4; }

    if (st.victory) this.victoryPose(P, T);

    // ---- death
    if (st.dead) { this.deadT = Math.min(1, this.deadT + dt * 1.6); } else this.deadT = Math.max(0, this.deadT - dt * 4);
    const dd = this.deadT;
    if (dd > 0) {
      const e = 1 - Math.pow(1 - dd, 3);
      P.rootTilt = -Math.PI / 2 * e; P.bodyY = P.bodyY * (1 - e) + 0.25 * e;
      P.shLz = 1.2 * e; P.shRz = -1.2 * e; P.shLx = -0.3 * e; P.shRx = -0.3 * e; P.legL = -0.2 * e; P.legR = 0.15 * e; P.knL = 0.3 * e; P.knR = 0.1 * e; P.headX = -0.3 * e;
    }

    // ---- apply with smoothing
    const L = (obj, prop, v, kk = k) => { obj[prop] += (v - obj[prop]) * kk; };
    const fast = this.act || st.tempest ? 1 - Math.exp(-dt * 30) : k;
    L(R.body.position, 'y', P.bodyY);
    L(R.spine.rotation, 'x', P.spineX, fast); L(R.spine.rotation, 'y', P.spineY, fast);
    L(R.head.rotation, 'x', P.headX);
    L(R.legL.rotation, 'x', P.legL, fast); L(R.legR.rotation, 'x', P.legR, fast);
    L(R.knL.rotation, 'x', P.knL, fast); L(R.knR.rotation, 'x', P.knR, fast);
    L(R.shL.rotation, 'x', P.shLx, fast); L(R.shR.rotation, 'x', P.shRx, fast);
    L(R.shL.rotation, 'z', P.shLz, fast); L(R.shR.rotation, 'z', P.shRz, fast);
    L(R.elL.rotation, 'x', P.elL, fast); L(R.elR.rotation, 'x', P.elR, fast);
    L(R.body.rotation, 'x', P.rootTilt, 1 - Math.exp(-dt * 8));
    if (st.tempest) R.body.rotation.y += dt * 18; else L(R.body.rotation, 'y', P.bodyRotY);

    // ---- ambient animation of class props
    if (this.focusGlow) this.focusGlow.scale.setScalar(1 + Math.sin(T * 4) * 0.12 + (st.casting ? 0.8 : 0));
    if (this.spin) for (const r of this.spin) { r.rotation.z += dt * 2; r.rotation.x = Math.PI / 2 + Math.sin(T) * 0.3; }
    if (this.halo) { this.halo.rotation.z += dt * 0.8; }
    if (this.fireHand) this.fireHand.scale.setScalar(0.8 + Math.sin(T * 13) * 0.15 + Math.sin(T * 7) * 0.1);
    if (this.cape) this.cape.rotation.x = 0.12 + moveAmt * 0.6 + Math.sin(T * 3) * 0.04;
    // staves stay roughly upright in the hand regardless of arm pose
    if (this.uprightStaff && this.weaponR) { this.weaponR.rotation.x = -(R.shR.rotation.x + R.elR.rotation.x) * 0.9; this.weaponR.rotation.z = -R.shR.rotation.z; }
  }

  classIdle(P, moveAmt, T) {
    const idle = 1 - Math.min(1, moveAmt * 2);
    switch (this.cls) {
      case 'mage': P.shRx += -0.3 * idle; P.elR += -0.5 * idle; P.shLx += -0.3 * idle; P.elL += -0.6 * idle; break;
      case 'rogue': P.knL += 0.35 * idle; P.knR += 0.35 * idle; P.legL += -0.2 * idle; P.legR += -0.2 * idle; P.bodyY -= 0.08 * idle; P.spineX += 0.25 * idle;
        P.shRx += -0.5 * idle; P.elR += -1.0 * idle; P.shLx += -0.5 * idle; P.elL += -1.0 * idle; break;
      case 'warrior': P.shLx += -0.6 * idle; P.elL += -1.1 * idle; P.shLz += 0.1; P.shRx += -0.2 * idle; P.elR += -0.6 * idle; P.legL += -0.15 * idle; P.legR += 0.15 * idle; break;
      case 'priest': P.shLx += -0.4 * idle; P.elL += -0.9 * idle; P.shRx += -0.2 * idle; P.elR += -0.6 * idle; P.bodyY += Math.sin(T * 1.5) * 0.015; break;
      case 'shaman': P.shRx += -0.35 * idle; P.elR += -0.4 * idle; P.shLx += -0.2 * idle; P.elL += -0.8 * idle; P.spineX += 0.08; break;
    }
  }

  victoryPose(P, T) {
    switch (this.cls) {
      case 'warrior': P.shRx = -3.0; P.shRz = -0.2; P.elR = 0; P.shLx = -0.5; P.elL = -1.0; P.bodyY += Math.abs(Math.sin(T * 3)) * 0.1; P.headX = -0.3; break;
      case 'mage': P.shRx = -3.1; P.elR = 0; P.shLz = 1.2; P.shLx = -0.4; P.headX = -0.3; this.R.handR.rotation.y += 0.15; break;
      case 'rogue': P.shRx = -2.6 + Math.sin(T * 6) * 0.3; P.shLx = -2.6 - Math.sin(T * 6) * 0.3; P.elR = -0.2; P.elL = -0.2; P.shLz = 0.5; P.shRz = -0.5; P.bodyY += Math.abs(Math.sin(T * 6)) * 0.08; break;
      case 'priest': P.shLz = 1.6; P.shRz = -1.6; P.shLx = -0.5; P.shRx = -0.5; P.elL = 0; P.elR = 0; P.headX = -0.5; P.bodyY += 0.15 + Math.sin(T * 2) * 0.05; break;
      case 'shaman': P.shRx = -2.9 + Math.abs(Math.sin(T * 4)) * 0.6; P.elR = -0.2; P.shLx = -2.0; P.shLz = 0.6; P.headX = -0.4; P.knL = 0.2 + Math.abs(Math.sin(T * 4)) * 0.3; P.knR = P.knL; break;
    }
  }

  // world position of the weapon / focus (for spell origins)
  focusWorld(out = new THREE.Vector3()) {
    const o = this.focus || this.R.handR;
    return o.getWorldPosition(out);
  }
}
