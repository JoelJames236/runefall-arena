// Pets & summons (sim.minions), built in code: quadrupeds (spectral wolf, jungle cat) with a walk
// cycle and a bite lunge, and the necromancer's undead (rigged champions with zombie animations,
// provided by heroes.js through `makeHumanoid`). Every model gets a small health bar.
import * as THREE from 'three';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...o });

function stripeTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#c88a3a'; g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#2a1a10';
  for (let i = 0; i < 9; i++) { const x = 6 + i * 14 + Math.random() * 4; g.beginPath(); g.moveTo(x, 0); g.quadraticCurveTo(x + 6, 32, x - 2, 64); g.lineTo(x + 4, 64); g.quadraticCurveTo(x + 10, 32, x + 5, 0); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// a four-legged beast: body, chest, neck, head with snout + ears, tail, 4 two-part legs
function quadruped({ body, belly, glow, size = 1, ears = 'pointed', maneColor, leg }) {
  leg = leg || body;
  const root = new THREE.Group(), rig = new THREE.Group(); root.add(rig); rig.scale.setScalar(size);
  const mesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m; };
  const torso = mesh(new THREE.CapsuleGeometry(0.22, 0.62, 6, 12), body); torso.rotation.x = Math.PI / 2; torso.position.set(0, 0.66, 0); rig.add(torso);
  const chest = mesh(new THREE.SphereGeometry(0.27, 14, 10), body); chest.scale.set(1, 1.1, 1.05); chest.position.set(0, 0.72, 0.32); rig.add(chest);
  const under = mesh(new THREE.CapsuleGeometry(0.16, 0.5, 4, 10), belly); under.rotation.x = Math.PI / 2; under.position.set(0, 0.56, 0.02); rig.add(under);
  const neck = new THREE.Group(); neck.position.set(0, 0.86, 0.5); rig.add(neck);
  const nk = mesh(new THREE.CapsuleGeometry(0.12, 0.18, 4, 10), body); nk.rotation.x = -0.6; nk.position.set(0, 0.06, 0.06); neck.add(nk);
  const head = new THREE.Group(); head.position.set(0, 0.16, 0.2); neck.add(head);
  const skull = mesh(new THREE.SphereGeometry(0.15, 14, 10), body); skull.scale.set(1, 0.9, 1.1); head.add(skull);
  const snout = mesh(new THREE.CapsuleGeometry(0.07, 0.16, 4, 10), body); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.04, 0.18); head.add(snout);
  const jaw = mesh(new THREE.BoxGeometry(0.1, 0.03, 0.18), belly); jaw.position.set(0, -0.1, 0.15); head.add(jaw);
  const nose = mesh(new THREE.SphereGeometry(0.03, 8, 6), std(0x141010)); nose.position.set(0, -0.02, 0.3); head.add(nose);
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(ears === 'round' ? 0.06 : 0.05, ears === 'round' ? 0.08 : 0.14, 6), body); ear.position.set(s * 0.08, 0.14, -0.02); ear.rotation.z = -s * 0.25; head.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshBasicMaterial({ color: glow })); eye.position.set(s * 0.065, 0.03, 0.12); head.add(eye);
  }
  if (maneColor) { const mane = mesh(new THREE.SphereGeometry(0.2, 12, 10), std(maneColor)); mane.scale.set(1.15, 1, 0.8); mane.position.set(0, 0.86, 0.42); rig.add(mane); }
  const tail = new THREE.Group(); tail.position.set(0, 0.74, -0.46); rig.add(tail);
  const tl = mesh(new THREE.CapsuleGeometry(0.05, 0.42, 4, 8), body); tl.rotation.x = -2.2; tl.position.set(0, 0.1, -0.16); tail.add(tl);
  const legs = [];
  for (const [x, z] of [[-0.14, 0.34], [0.14, 0.34], [-0.14, -0.32], [0.14, -0.32]]) {
    const hip = new THREE.Group(); hip.position.set(x, 0.62, z); rig.add(hip);
    const up = mesh(new THREE.CapsuleGeometry(0.06, 0.24, 4, 8), leg); up.position.y = -0.16; hip.add(up);
    const knee = new THREE.Group(); knee.position.y = -0.32; hip.add(knee);
    const lo = mesh(new THREE.CapsuleGeometry(0.045, 0.22, 4, 8), leg); lo.position.y = -0.13; knee.add(lo);
    const paw = mesh(new THREE.SphereGeometry(0.06, 8, 6), belly); paw.scale.set(1, 0.6, 1.3); paw.position.set(0, -0.28, 0.03); knee.add(paw);
    legs.push({ hip, knee, phase: (x > 0 ? 0 : Math.PI) + (z > 0 ? 0 : Math.PI / 2) });
  }
  let t = 0, lunge = 0;
  return {
    root, head, neck, tail, legs, rig,
    update(dt, moving, atk, speed = 1) {
      t += dt * (moving ? 9 * speed : 2);
      for (const L of legs) { const s = moving ? Math.sin(t + L.phase) : 0; L.hip.rotation.x = s * 0.6; L.knee.rotation.x = Math.max(0, -Math.sin(t + L.phase + 0.8)) * (moving ? 0.9 : 0); }
      rig.position.y = moving ? Math.abs(Math.sin(t * 2)) * 0.04 : Math.sin(t) * 0.01;
      tail.rotation.y = Math.sin(t * 0.8) * 0.4;
      lunge = atk ? Math.min(1, lunge + dt * 10) : Math.max(0, lunge - dt * 4);
      rig.position.z = lunge * 0.35; neck.rotation.x = lunge * 0.5; head.rotation.x = -lunge * 0.3;
    },
  };
}

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
  if (kind === 'wolf') {
    const body = std(0x9ae8ff, { emissive: 0x2a8acc, emissiveIntensity: 1.4, transparent: true, opacity: 0.72, roughness: 0.3 });
    beast = quadruped({ body, belly: body, glow: 0xeaffff, size: 1.15 });
    root.add(beast.root);
    const aura = new THREE.Mesh(new THREE.SphereGeometry(0.75, 14, 10), new THREE.MeshBasicMaterial({ color: 0x6ac8ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
    aura.scale.set(0.8, 0.7, 1.3); aura.position.y = 0.75; root.add(aura);
  } else if (kind === 'cat') {
    const body = std(0xffffff, { map: stripeTex(), roughness: 0.85 });
    beast = quadruped({ body, belly: std(0xe8d8b8), glow: 0xffe060, size: 1.25, ears: 'round', leg: std(0xc07a30, { roughness: 0.85 }) });
    root.add(beast.root);
  } else if (makeHumanoid) {
    humanoid = makeHumanoid(kind);
    if (humanoid) root.add(humanoid.root);
  }
  const bar = hpBar(); bar.g.position.y = kind === 'abomination' ? 3.4 : kind === 'ghoul' ? 2.3 : 1.6; root.add(bar.g);
  bar.fill.material.color.set(hostile ? 0xff3a2a : 0x5aff7a);
  return {
    root,
    update(dt, m, camera) {
      if (beast) beast.update(dt, m.moving, m.atk, 1);
      if (humanoid) humanoid.update(dt, m);
      const f = Math.max(0, Math.min(1, m.hp / m.maxHp));
      bar.fill.scale.x = Math.max(0.001, f); bar.fill.position.x = -0.43 * (1 - f);
      if (camera) bar.g.quaternion.copy(camera.quaternion).premultiply(root.quaternion.clone().invert());
    },
    dispose() { root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); },
  };
}
