// Pets & summons (sim.minions): the spirit wolf and jungle cat are skinned creatures from beasts.js, the
// necromancer's undead are rigged champions with zombie animations (provided by heroes.js through
// `makeHumanoid`). Every pet gets a small health bar. (The Druid's forms and their state machine: forms.js.)
import * as THREE from 'three';
import { makeBeast } from './beasts.js';
import { championModel } from './champions.js';
export { makeFormModel } from './forms.js';

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
  // Beastmaster's silverback gorilla: a generated humanoid model with the UAL clips (see LOOKS.gorilla)
  if (kind === 'gorilla' && championModel('gorilla') && makeHumanoid) { humanoid = makeHumanoid('gorilla'); if (humanoid) root.add(humanoid.root); }
  if (!humanoid && (kind === 'wolf' || kind === 'cat' || kind === 'gorilla')) {
    // Shaman spirit wolf (spectral) / the jungle cat (stand-in while the gorilla model is missing): procedural creatures
    beast = makeBeast(kind === 'wolf' ? 'wolf' : 'junglecat');
    beast.root.scale.setScalar(kind === 'wolf' ? 0.95 : 0.8);
    root.add(beast.root);
    if (kind === 'wolf') { const aura = new THREE.Mesh(new THREE.SphereGeometry(0.75, 14, 10), new THREE.MeshBasicMaterial({ color: 0x6ac8ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false })); aura.scale.set(0.8, 0.75, 1.4); aura.position.y = 0.85; root.add(aura); }
  } else if (!humanoid && makeHumanoid) {
    humanoid = makeHumanoid(kind);
    if (humanoid) root.add(humanoid.root);
  }
  const bar = hpBar(); bar.g.position.y = kind === 'abomination' ? 3.4 : kind === 'ghoul' ? 2.3 : kind === 'gorilla' && humanoid ? 2.2 : 1.6; root.add(bar.g);
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

