// Pets & summons (sim.minions): the spirit wolf and jungle cat are skinned creatures from beasts.js, the
// necromancer's undead are rigged champions with zombie animations (provided by heroes.js through
// `makeHumanoid`). Also the Druid's treant form. Every pet gets a small health bar.
import * as THREE from 'three';
import { makeBeast } from './beasts.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...o });

function hpBar() {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.09), new THREE.MeshBasicMaterial({ color: 0x140808, transparent: true, opacity: 0.75, depthWrite: false }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.06), new THREE.MeshBasicMaterial({ color: 0xff3a2a, depthWrite: false }));
  fill.position.z = 0.001; g.add(bg, fill); g.renderOrder = 5;
  return { g, fill };
}

// kind -> model { root, update(dt, state), dispose() }
export function makeMinion(kind, hostile, makeHumanoid) {
  let beast = null, humanoid = null;
  const root = new THREE.Group();
  if (kind === 'wolf' || kind === 'cat') {
    // Shaman spirit wolf (spectral) / Hunter jungle cat: the same skinned creature system as the Druid forms
    beast = makeBeast(kind === 'wolf' ? 'wolf' : 'junglecat');
    beast.root.scale.setScalar(kind === 'wolf' ? 0.95 : 0.8);
    root.add(beast.root);
    if (kind === 'wolf') { const aura = new THREE.Mesh(new THREE.SphereGeometry(0.75, 14, 10), new THREE.MeshBasicMaterial({ color: 0x6ac8ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false })); aura.scale.set(0.8, 0.75, 1.4); aura.position.y = 0.85; root.add(aura); }
  } else if (makeHumanoid) {
    humanoid = makeHumanoid(kind);
    if (humanoid) root.add(humanoid.root);
  }
  const bar = hpBar(); bar.g.position.y = kind === 'abomination' ? 3.4 : kind === 'ghoul' ? 2.3 : 1.6; root.add(bar.g);
  bar.fill.material.color.set(hostile ? 0xff3a2a : 0x5aff7a);
  return {
    root,
    update(dt, m, camera) {
      if (beast) beast.update(dt, m.moving, m.atk, { speed: m.moving ? 1.25 : 0 });
      if (humanoid) humanoid.update(dt, m);
      const f = Math.max(0, Math.min(1, m.hp / m.maxHp));
      bar.fill.scale.x = Math.max(0.001, f); bar.fill.position.x = -0.43 * (1 - f);
      if (camera) bar.g.quaternion.copy(camera.quaternion).premultiply(root.quaternion.clone().invert());
    },
    dispose() { root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); },
  };
}

// Druid shapeshift models: 'cat' (black panther), 'bear' (armored brown bear), 'tree' (Tree of Life treant)
export function makeFormModel(form) {
  const root = new THREE.Group();
  if (form === 'tree') {
    const bark = std(0x5a3a22, { roughness: 1, flatShading: true }), leaf = std(0x3a8a2a, { roughness: 0.9, emissive: 0x1a5a10, emissiveIntensity: 0.4, flatShading: true });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 1.9, 9), bark); trunk.position.y = 0.95; trunk.castShadow = true; root.add(trunk);
    for (const s of [-1, 1]) { const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 1.0, 6), bark); arm.position.set(s * 0.45, 1.5, 0); arm.rotation.z = -s * 0.9; arm.castShadow = true; root.add(arm);
      const root2 = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.6, 5), bark); root2.position.set(s * 0.3, 0.12, 0.1); root2.rotation.z = s * 1.1; root.add(root2); }
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45 + (i % 3) * 0.08, 0), leaf); c.position.set(Math.sin(a) * 0.45, 2.2 + Math.cos(a * 2) * 0.15, Math.cos(a) * 0.45); c.castShadow = true; root.add(c); }
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), leaf); top.position.y = 2.6; root.add(top);
    const face = new THREE.Group(); face.position.set(0, 1.45, 0.28);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xbaff6a })); e.position.x = s * 0.1; face.add(e); }
    root.add(face);
    let t = 0;
    return { root, update(dt, moving) { t += dt * (moving ? 6 : 1.5); root.rotation.z = Math.sin(t) * (moving ? 0.05 : 0.015); } };
  }
  // Cat Form / Bear Form: skinned procedural creatures with real anatomy and gait (beasts.js)
  const beast = makeBeast(form === 'bear' ? 'bear' : 'cat');
  root.add(beast.root);
  return { root, update: (dt, moving, atk, st) => beast.update(dt, moving, atk, st), dispose: beast.dispose };
}
