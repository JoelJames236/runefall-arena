// GIBB arena: the gibb Lorraine square in Bern as a fight arena.
// Buildings are simplified swissBUILDINGS3D roof prisms (© swisstopo), the ground is SWISSIMAGE (© swisstopo).
// Origin = E 2600470 / N 1200485 (LV95). x = east, z = south, 1 unit = 1 m.
// Same contract as Arena: group, ready, update(dt, vfx), crowdHype, flames.
import * as THREE from 'three';
import { PILLARS, ARENA_R } from '../sim/sim.js';

const DIR = 'assets/gibb/';
const WALL_R = ARENA_R + 2.5;
// These ids are gibb buildings: they get the glass-and-band facade.
const GIBB_IDS = new Set(['C8023B86', 'F6D8F845', '9D2F2078', '8A5F26D5', '583B5E0E', '0989AED7']);
const AULA = 'F6D8F845';
// The ortho image covers E 2600135..2600735, N 1200231..1200831.
const ORTHO = { x: -35, z: -46, size: 600 };

function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8;
  return t;
}

// The gibb lettering: lowercase, heavy, black on white.
function logoCanvas(w = 1024, h = 384, bg = '#ffffff', fg = '#111111') {
  const c = canvas(w, h), g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = fg; g.font = `800 ${h * 0.82}px Inter, "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('gibb', w / 2, h * 0.5);
  return c;
}

// Facade of the gibb glass buildings: white parapet bands, dark glass, thin mullions, a green parapet line.
function glassFacade() {
  const c = canvas(256), g = c.getContext('2d');
  g.fillStyle = '#e9ebe8'; g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 2; row++) {
    const y = row * 128;
    const glass = g.createLinearGradient(0, y + 30, 0, y + 118);
    glass.addColorStop(0, '#3b5466'); glass.addColorStop(1, '#1d2a33');
    g.fillStyle = glass; g.fillRect(0, y + 30, 256, 88);
    g.fillStyle = '#9aa7ad'; for (let x = 0; x < 256; x += 32) g.fillRect(x, y + 30, 3, 88);
    g.fillStyle = '#6f8f62'; g.fillRect(0, y + 24, 256, 6);
  }
  return tex(c);
}
// Facade of the neighbour houses: plaster with punched windows.
function plainFacade() {
  const c = canvas(256), g = c.getContext('2d');
  g.fillStyle = '#d8c8ac'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 128) for (let x = 0; x < 256; x += 128) {
    g.fillStyle = '#8b7a62'; g.fillRect(x + 36, y + 34, 56, 70);
    g.fillStyle = '#2c3238'; g.fillRect(x + 40, y + 38, 48, 62);
  }
  return tex(c);
}
// School yard asphalt with court markings and the gibb lettering in the centre circle.
function yardTexture(S = 2048) {
  const c = canvas(S), g = c.getContext('2d');
  g.fillStyle = '#4a4d50'; g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 26; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const m = S / (2 * (WALL_R + 1)), C = S / 2;            // pixels per metre, centre
  g.strokeStyle = 'rgba(240,240,235,0.85)'; g.lineWidth = 0.12 * m;
  g.beginPath(); g.arc(C, C, ARENA_R * m, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(C, C, 6 * m, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(C - ARENA_R * m, C); g.lineTo(C + ARENA_R * m, C); g.stroke();
  g.strokeStyle = 'rgba(230,200,60,0.8)';                 // two basketball keys at the ends
  for (const s of [-1, 1]) { g.strokeRect(C + s * (ARENA_R - 5.8) * m - 2.4 * m, C - 2.4 * m, 4.8 * m, 4.8 * m); }
  g.save(); g.translate(C, C); g.rotate(Math.PI);
  g.globalAlpha = 0.9; g.drawImage(logoCanvas(1024, 384, null, '#f2f2ee'), -5 * m, -1.9 * m, 10 * m, 3.75 * m);
  g.restore();
  return tex(c);
}

export class GibbArena {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); this.group.name = 'arena-gibb'; scene.add(this.group);
    this.flames = []; this.crowdHype = 0; this.time = 0;
    this.mats = {
      gibb: new THREE.MeshStandardMaterial({ map: glassFacade(), roughness: 0.35, metalness: 0.15 }),
      house: new THREE.MeshStandardMaterial({ map: plainFacade(), roughness: 0.9 }),
      roof: new THREE.MeshStandardMaterial({ color: 0x6b6f72, roughness: 0.95 }),
      concrete: new THREE.MeshStandardMaterial({ color: 0xb9b8b2, roughness: 0.9 }),
      fence: new THREE.MeshStandardMaterial({ color: 0x5c6b5a, roughness: 0.6, metalness: 0.5 }),
    };
    this.buildGround();
    this.buildYard();
    this.buildPillars();
    this.ready = this.buildBuildings();
  }

  buildGround() {
    const t = new THREE.TextureLoader().load(DIR + 'ortho.jpg');
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ORTHO.size, ORTHO.size), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
    m.rotation.x = -Math.PI / 2; m.position.set(ORTHO.x, -0.05, ORTHO.z); m.receiveShadow = true;
    this.group.add(m);
  }

  buildYard() {
    const floor = new THREE.Mesh(new THREE.CircleGeometry(WALL_R + 1, 96), new THREE.MeshStandardMaterial({ map: yardTexture(), roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.group.add(floor);
    // Low concrete wall with a fence on top: the edge of the fight zone.
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(WALL_R + 0.6, WALL_R + 0.6, 1.0, 96, 1, true), this.mats.concrete);
    wall.material.side = THREE.DoubleSide; wall.position.y = 0.5; wall.castShadow = wall.receiveShadow = true; this.group.add(wall);
    const cap = new THREE.Mesh(new THREE.RingGeometry(WALL_R, WALL_R + 1.2, 96), this.mats.concrete);
    cap.rotation.x = -Math.PI / 2; cap.position.y = 1.0; this.group.add(cap);
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), this.mats.fence, 80);
    const mt = new THREE.Matrix4();
    for (let i = 0; i < 80; i++) { const a = i / 80 * Math.PI * 2; mt.makeTranslation(Math.sin(a) * (WALL_R + 0.6), 2.1, Math.cos(a) * (WALL_R + 0.6)); posts.setMatrixAt(i, mt); }
    this.group.add(posts);
    const mesh = canvas(64), g = mesh.getContext('2d');
    g.strokeStyle = 'rgba(70,85,70,0.9)'; g.lineWidth = 3;
    for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke(); }
    const fenceTex = new THREE.CanvasTexture(mesh); fenceTex.wrapS = fenceTex.wrapT = THREE.RepeatWrapping; fenceTex.repeat.set(160, 2);
    const fence = new THREE.Mesh(new THREE.CylinderGeometry(WALL_R + 0.6, WALL_R + 0.6, 2.0, 96, 1, true),
      new THREE.MeshStandardMaterial({ map: fenceTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.6 }));
    fence.position.y = 2.1; this.group.add(fence);
  }

  // The four sim pillars become round concrete planters with a tree, as on the gibb square.
  buildPillars() {
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 1 });
    const leafM = new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 0.9, flatShading: true });
    for (const p of PILLARS) {
      const planter = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 1.05, 1.1, 32), this.mats.concrete);
      planter.position.set(p.x, 0.55, p.z); planter.castShadow = planter.receiveShadow = true; this.group.add(planter);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 5, 8), trunkM);
      trunk.position.set(p.x, 3.5, p.z); trunk.castShadow = true; this.group.add(trunk);
      for (let k = 0; k < 4; k++) {
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9 - k * 0.25, 1), leafM);
        leaf.position.set(p.x + Math.sin(k * 2.1) * 0.9, 6.2 + k * 0.7, p.z + Math.cos(k * 2.1) * 0.9);
        leaf.castShadow = true; this.group.add(leaf);
      }
    }
  }

  async buildBuildings() {
    const data = await (await fetch(DIR + 'buildings.json')).json();
    const gibbParts = [], houseParts = [], roofParts = [];
    for (const b of data) {
      const isGibb = GIBB_IDS.has(b.id);
      for (const [h, ring] of b.r) {
        if (h < 1.5) continue;
        if (ring.some(([x, z]) => Math.hypot(x, z) < WALL_R + 1.5)) continue;     // keep the fight zone free
        const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);                                                  // shape y (north) -> -z, depth -> +y
        // World-space UVs on the walls: 1 texture tile = 6 m wide, 7 m high (two floors).
        const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
          const along = Math.abs(nor.getX(i)) > Math.abs(nor.getZ(i)) ? pos.getZ(i) : pos.getX(i);
          uv.setXY(i, along / 6, pos.getY(i) / 7);
        }
        (isGibb ? gibbParts : houseParts).push(geo);
        const roof = new THREE.ShapeGeometry(shape); roof.rotateX(-Math.PI / 2); roof.translate(0, h + 0.02, 0);
        roofParts.push(roof);
      }
    }
    const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
    const add = (parts, mat) => {
      if (!parts.length) return;
      const m = new THREE.Mesh(mergeGeometries(parts.map(p => p.toNonIndexed ? (p.index ? p.toNonIndexed() : p) : p)), mat);
      m.castShadow = m.receiveShadow = true; this.group.add(m);
    };
    add(gibbParts, this.mats.gibb);
    add(houseParts, this.mats.house);
    add(roofParts, this.mats.roof);
    this.buildSigns(data);
  }

  // Big gibb lettering on the Aula roof and on the BMS slab, facing the arena.
  buildSigns(data) {
    const logo = new THREE.MeshStandardMaterial({ map: tex(logoCanvas()), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.15, emissiveMap: tex(logoCanvas()) });
    const aula = data.find(b => b.id === AULA);
    if (aula) {
      let sx = 0, sz = 0, n = 0, top = 0;
      for (const [h, ring] of aula.r) { top = Math.max(top, h); for (const [x, z] of ring) { sx += x; sz += z; n++; } }
      const cx = sx / n, cz = sz / n, a = Math.atan2(-cx, -cz);                     // face the arena centre
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.75), logo);
      sign.position.set(cx + Math.sin(a) * 9, top + 2.4, cz + Math.cos(a) * 9); sign.rotation.y = a;
      this.group.add(sign);
      const back = sign.clone(); back.rotation.y = a + Math.PI; back.position.add(new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(-0.05)); this.group.add(back);
    }
  }

  update(dt) { this.time += dt; this.crowdHype = Math.max(0, this.crowdHype - dt * 0.4); }
}
