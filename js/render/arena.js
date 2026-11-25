// The Runefall Arena: a sunken stone colosseum under a twilight sky, with glowing
// rune pillars (line-of-sight blockers), braziers, banners, statues, a cheering crowd,
// and mountains and a castle in the distance.
import * as THREE from 'three';
import { PILLARS, ARENA_R } from '../sim/sim.js';

function canvasTex(size, draw, repeat) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  return t;
}
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';

function floorTexture() {
  return canvasTex(2048, (g, S) => {
    const r = rng(7);
    g.fillStyle = '#4a4540'; g.fillRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2;
    // concentric rings of flagstones
    const rings = 15;
    for (let i = 0; i < rings; i++) {
      const r0 = (i / rings) * S / 2, r1 = ((i + 1) / rings) * S / 2;
      const n = Math.max(6, Math.floor(6 + i * 6.5));
      for (let j = 0; j < n; j++) {
        const a0 = (j / n) * Math.PI * 2 + i * 0.13, a1 = ((j + 1) / n) * Math.PI * 2 + i * 0.13;
        const v = 60 + r() * 30;
        g.fillStyle = `rgb(${v + 8},${v + 2},${v - 6})`;
        g.beginPath(); g.arc(cx, cy, r1 - 2, a0 + 0.004, a1 - 0.004); g.arc(cx, cy, r0 + 2, a1 - 0.004, a0 + 0.004, true); g.closePath(); g.fill();
        // grime/variation
        for (let k = 0; k < 4; k++) {
          const a = a0 + (a1 - a0) * r(), rr = r0 + (r1 - r0) * r();
          g.fillStyle = `rgba(${r() < 0.5 ? '30,26,22' : '120,110,95'},${0.08 + r() * 0.1})`;
          g.beginPath(); g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 4 + r() * 18, 0, 7); g.fill();
        }
        if (r() < 0.25) { // cracks
          g.strokeStyle = 'rgba(20,18,15,0.6)'; g.lineWidth = 1.5; g.beginPath();
          let a = a0 + (a1 - a0) * r(), rr = r0 + (r1 - r0) * r(); g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
          for (let q = 0; q < 4; q++) { a += (r() - 0.5) * 0.05; rr += (r() - 0.5) * 25; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
          g.stroke();
        }
      }
    }
    // inlaid decorative rings
    g.strokeStyle = 'rgba(180,150,90,0.55)'; g.lineWidth = 6;
    for (const rr of [0.33, 0.62, 0.97]) { g.beginPath(); g.arc(cx, cy, rr * S / 2, 0, 7); g.stroke(); }
  });
}

function runeCircleTexture(color = '#7fd0ff', count = 24, inner = 0.55) {
  return canvasTex(1024, (g, S) => {
    const c = S / 2;
    g.clearRect(0, 0, S, S);
    g.strokeStyle = color; g.fillStyle = color; g.shadowColor = color; g.shadowBlur = 18;
    g.lineWidth = 6; g.beginPath(); g.arc(c, c, c * 0.95, 0, 7); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.arc(c, c, c * 0.8, 0, 7); g.stroke();
    g.beginPath(); g.arc(c, c, c * inner, 0, 7); g.stroke();
    g.font = `bold ${Math.floor(S * 0.07)}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      g.save(); g.translate(c + Math.cos(a) * c * 0.875, c + Math.sin(a) * c * 0.875); g.rotate(a + Math.PI / 2);
      g.fillText(RUNES[i % RUNES.length], 0, 0); g.restore();
    }
    // inner star
    g.lineWidth = 3; g.beginPath();
    const pts = 8;
    for (let i = 0; i <= pts; i++) { const a = (i * 3 / pts) * Math.PI * 2; const x = c + Math.cos(a) * c * inner, y = c + Math.sin(a) * c * inner; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  });
}

function stoneTexture(base = 110, seed = 3) {
  return canvasTex(512, (g, S) => {
    const r = rng(seed);
    g.fillStyle = `rgb(${base},${base - 6},${base - 14})`; g.fillRect(0, 0, S, S);
    const rows = 8;
    for (let y = 0; y < rows; y++) {
      const h = S / rows, off = (y % 2) * 32;
      for (let x = -1; x < 5; x++) {
        const w = S / 4, v = base - 20 + r() * 40;
        g.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
        g.fillRect(x * w + off + 2, y * h + 2, w - 4, h - 4);
      }
    }
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.12})`; g.fillRect(r() * S, r() * S, 2 + r() * 6, 2 + r() * 6); }
  }, 1);
}

function bannerTexture(c1, c2, emblem) {
  return canvasTex(256, (g, S) => {
    const grd = g.createLinearGradient(0, 0, 0, S); grd.addColorStop(0, c1); grd.addColorStop(1, c2);
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    g.strokeStyle = '#e8c37a'; g.lineWidth = 10; g.strokeRect(12, 12, S - 24, S - 24);
    g.fillStyle = '#e8c37a'; g.font = `${S * 0.45}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 8; g.fillText(emblem, S / 2, S * 0.45);
  });
}

export class Arena {
  constructor(scene, quality) {
    this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.animated = []; this.flames = []; this.lights = [];
    this.time = 0;
    this.buildSky();
    this.buildFloor();
    this.buildPillars();
    this.buildWalls();
    this.buildCrowd();
    this.buildBackdrop();
    this.buildAmbient();
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { t: { value: 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vP; uniform float t;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
        void main(){
          float y = vP.y;
          vec3 top = vec3(0.04,0.04,0.12), mid = vec3(0.20,0.12,0.30), hor = vec3(0.85,0.42,0.25);
          vec3 col = mix(hor, mid, smoothstep(-0.02, 0.18, y));
          col = mix(col, top, smoothstep(0.15, 0.6, y));
          // sun glow on the horizon
          vec3 sd = normalize(vec3(-0.6, 0.08, -0.8));
          float sg = max(dot(vP, sd), 0.0);
          col += vec3(1.0,0.55,0.25) * pow(sg, 12.0) * 0.8 + vec3(1.0,0.8,0.5) * pow(sg, 300.0) * 2.0;
          // stars
          vec3 sp = floor(vP * 300.0);
          float st = step(0.9975, h(sp)) * smoothstep(0.15, 0.5, y);
          col += st * (0.6 + 0.4 * sin(t * 2.0 + h(sp) * 50.0));
          // moon
          vec3 md = normalize(vec3(0.5, 0.45, 0.7));
          float mm = smoothstep(0.9993, 0.9996, dot(vP, md));
          col = mix(col, vec3(0.95,0.93,0.85), mm);
          col += vec3(0.4,0.45,0.6) * pow(max(dot(vP, md),0.0), 80.0) * 0.4;
          if (y < 0.0) col = mix(hor * 0.4, vec3(0.05,0.04,0.06), smoothstep(0.0, -0.2, y));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, m); this.scene.add(this.sky);
  }

  buildFloor() {
    const tex = floorTexture();
    const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R + 3, 96), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.05 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.group.add(floor);
    // central rune circle
    const rt = runeCircleTexture('#8fd0ff', 24, 0.5);
    this.centerRune = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({ map: rt, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85, color: 0x9fdcff }));
    this.centerRune.rotation.x = -Math.PI / 2; this.centerRune.position.y = 0.02;
    this.group.add(this.centerRune);
    // outer ring of runes
    const ot = runeCircleTexture('#ffb86a', 48, 0.9);
    this.outerRune = new THREE.Mesh(new THREE.RingGeometry(ARENA_R - 2.2, ARENA_R + 0.6, 96), new THREE.MeshBasicMaterial({ map: ot, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }));
    // remap ring uvs to texture as planar
    const pos = this.outerRune.geometry.attributes.position, uv = this.outerRune.geometry.attributes.uv;
    const R = ARENA_R + 0.6;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (2 * R) + 0.5, pos.getY(i) / (2 * R) + 0.5);
    this.outerRune.rotation.x = -Math.PI / 2; this.outerRune.position.y = 0.025;
    this.group.add(this.outerRune);
    // spawn platforms
    for (const z of [-20, 20]) {
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4.5), new THREE.MeshBasicMaterial({ map: runeCircleTexture(z < 0 ? '#ffd27a' : '#ff7a6a', 12, 0.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
      pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.03, z); this.group.add(pad);
      this.animated.push(t => { pad.rotation.z = t * 0.2; });
    }
  }

  buildPillars() {
    const stone = new THREE.MeshStandardMaterial({ map: stoneTexture(120, 11), roughness: 0.85, color: 0xb8b0a4 });
    const darkStone = new THREE.MeshStandardMaterial({ color: 0x5a544e, roughness: 0.9 });
    const runeMat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff });
    for (const p of PILLARS) {
      const g = new THREE.Group(); g.position.set(p.x, 0, p.z); this.group.add(g);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(p.r + 0.5, p.r + 0.8, 0.6, 8), darkStone); base.position.y = 0.3; base.castShadow = base.receiveShadow = true; g.add(base);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.85, p.r, 7, 8), stone); shaft.position.y = 4.1; shaft.castShadow = shaft.receiveShadow = true; g.add(shaft);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(p.r + 0.4, p.r * 0.85, 0.8, 8), darkStone); cap.position.y = 8; cap.castShadow = true; g.add(cap);
      // glowing rune strips
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.5, 0.05), runeMat);
        strip.position.set(Math.sin(a) * p.r * 0.93, 4, Math.cos(a) * p.r * 0.93); strip.rotation.y = a;
        if (i % 2 === 0) g.add(strip);
      }
      // floating crystal
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x3ab8ff, emissiveIntensity: 2.2, roughness: 0.1 }));
      crystal.scale.set(0.7, 1.4, 0.7); crystal.position.y = 9.8; g.add(crystal);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), new THREE.MeshBasicMaterial({ color: 0x5ac8ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.position.y = 9.8; g.add(halo);
      const ph = Math.random() * 6;
      this.animated.push(t => { crystal.position.y = 9.8 + Math.sin(t * 1.3 + ph) * 0.3; crystal.rotation.y = t * 0.8 + ph; halo.position.y = crystal.position.y; halo.scale.setScalar(1 + Math.sin(t * 2 + ph) * 0.1); });
      // base rune circle
      const pr = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({ map: runeCircleTexture('#7fd8ff', 16, 0.75), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      pr.rotation.x = -Math.PI / 2; pr.position.set(p.x, 0.03, p.z); this.group.add(pr);
      this.animated.push(t => { pr.rotation.z = -t * 0.15; });
    }
  }

  buildWalls() {
    const wallMat = new THREE.MeshStandardMaterial({ map: stoneTexture(105, 5), roughness: 0.9, color: 0xa89e90 });
    wallMat.map.repeat.set(24, 1);
    const R = ARENA_R + 2.5;
    // main ring wall
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 3.2, 96, 1, true), new THREE.MeshStandardMaterial({ map: wallMat.map, roughness: 0.9, color: 0x9a9084, side: THREE.DoubleSide }));
    wall.position.y = 1.6; wall.receiveShadow = true; this.group.add(wall);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(R, 0.35, 6, 96), new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 0.8 }));
    lip.rotation.x = Math.PI / 2; lip.position.y = 3.2; this.group.add(lip);
    // tiered stands (where the crowd sits)
    for (let i = 0; i < 6; i++) {
      const r0 = R + 0.5 + i * 1.6;
      const tier = new THREE.Mesh(new THREE.CylinderGeometry(r0 + 1.6, r0 + 1.6, 0.8, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x5e564c, roughness: 0.95, side: THREE.DoubleSide }));
      tier.position.y = 3.2 + i * 0.9; this.group.add(tier);
      const top = new THREE.Mesh(new THREE.RingGeometry(r0, r0 + 1.6, 96), new THREE.MeshStandardMaterial({ color: 0x766c60, roughness: 0.95 }));
      top.rotation.x = -Math.PI / 2; top.position.y = 3.6 + i * 0.9; this.group.add(top);
    }
    // outer colonnade with arches
    const outerR = R + 11;
    const colMat = new THREE.MeshStandardMaterial({ color: 0x8a8174, roughness: 0.9 });
    const n = 40;
    const colGeo = new THREE.CylinderGeometry(0.5, 0.6, 7, 10);
    const cols = new THREE.InstancedMesh(colGeo, colMat, n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; m4.makeTranslation(Math.sin(a) * outerR, 12, Math.cos(a) * outerR); cols.setMatrixAt(i, m4); }
    cols.castShadow = true; this.group.add(cols);
    const ringTop = new THREE.Mesh(new THREE.CylinderGeometry(outerR + 0.8, outerR + 0.8, 1.4, 64, 1, true), new THREE.MeshStandardMaterial({ color: 0x7a7266, roughness: 0.9, side: THREE.DoubleSide }));
    ringTop.position.y = 16.2; this.group.add(ringTop);
    const backWall = new THREE.Mesh(new THREE.CylinderGeometry(outerR + 1.5, outerR + 1.5, 18, 64, 1, true), new THREE.MeshStandardMaterial({ map: wallMat.map.clone(), color: 0x6a6258, roughness: 0.95, side: THREE.BackSide }));
    backWall.material.map.repeat.set(30, 3); backWall.material.map.needsUpdate = true;
    backWall.position.y = 8; this.group.add(backWall);

    // gates at spawn ends
    for (const z of [-1, 1]) {
      const gate = new THREE.Group(); gate.position.set(0, 0, z * (R + 0.2)); gate.rotation.y = z > 0 ? Math.PI : 0;
      const pil = new THREE.MeshStandardMaterial({ color: 0x7a7266, roughness: 0.85 });
      for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 7, 1.6), pil); p.position.set(s * 2.6, 3.5, 0); p.castShadow = true; gate.add(p); }
      const arch = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.55, 8, 16, Math.PI), pil); arch.position.y = 7; gate.add(arch);
      const portal = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 7), new THREE.MeshBasicMaterial({ color: z < 0 ? 0xffb050 : 0xff5a4a, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      portal.position.set(0, 3.5, 0.3); gate.add(portal);
      this.group.add(gate);
    }

    // braziers with fire around the ring
    const brazierMat = new THREE.MeshStandardMaterial({ color: 0x3a3430, metalness: 0.6, roughness: 0.5 });
    const NB = 8;
    for (let i = 0; i < NB; i++) {
      const a = (i / NB) * Math.PI * 2 + Math.PI / NB;
      const x = Math.sin(a) * (ARENA_R + 0.8), z = Math.cos(a) * (ARENA_R + 0.8);
      const b = new THREE.Group(); b.position.set(x, 0, z); this.group.add(b);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.35, 2.2, 8), brazierMat); leg.position.y = 1.1; leg.castShadow = true; b.add(leg);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.4, 0.5, 12), brazierMat); bowl.position.y = 2.4; b.add(bowl);
      const coal = new THREE.Mesh(new THREE.CircleGeometry(0.7, 12), new THREE.MeshBasicMaterial({ color: 0xff6a1a })); coal.rotation.x = -Math.PI / 2; coal.position.y = 2.62; b.add(coal);
      this.flames.push({ x, y: 2.7, z });
      if (i % 2 === 0) {
        const L = new THREE.PointLight(0xff8a3a, 30, 18, 1.8); L.position.set(x * 0.97, 3.4, z * 0.97); this.group.add(L);
        this.lights.push(L);
      }
    }

    // banners hanging from the stands
    const banners = [['#7a1414', '#3a0808', '⚔'], ['#14306a', '#081438', '✦'], ['#2a5a1a', '#0e2a08', '⚡'], ['#5a2a7a', '#22103a', '☾'], ['#8a6a14', '#3a2a06', '✚']];
    this.bannerMeshes = [];
    const NBan = 10;
    for (let i = 0; i < NBan; i++) {
      const a = (i / NBan) * Math.PI * 2;
      const [c1, c2, em] = banners[i % banners.length];
      const geo = new THREE.PlaneGeometry(2.2, 5, 6, 12);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: bannerTexture(c1, c2, em), side: THREE.DoubleSide, roughness: 0.9 }));
      const r = R + 10.5;
      m.position.set(Math.sin(a) * r, 11.5, Math.cos(a) * r); m.lookAt(0, 11.5, 0);
      m.castShadow = true;
      geo.userData.base = geo.attributes.position.array.slice();
      this.group.add(m); this.bannerMeshes.push(m);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.8, 6), new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 0.8, roughness: 0.3 }));
      pole.rotation.z = Math.PI / 2; pole.position.set(0, 2.55, 0); m.add(pole);
    }

    // statues of past champions on plinths at the diagonals
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const s = this.makeStatue(i);
      const r = R + 7;
      s.position.set(Math.sin(a) * r, 3.2 + 4.5, Math.cos(a) * r); s.lookAt(0, s.position.y, 0);
      this.group.add(s);
    }
  }

  makeStatue(i) {
    const m = new THREE.MeshStandardMaterial({ color: 0xbab2a6, roughness: 0.75 });
    const g = new THREE.Group();
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 0.9 })); plinth.position.y = -1.5; g.add(plinth);
    const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 4, 10), m); robe.position.y = 2; g.add(robe);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.6, 1.8, 10), m); torso.position.y = 4.8; g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), m); head.position.y = 6.1; g.add(head);
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.1, 10), m); hood.position.y = 6.5; g.add(hood);
    // a sword held point-down before the body
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4.5, 0.1), m); blade.position.set(0, 2.6, 1.1); g.add(blade);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.2, 0.25), m); guard.position.set(0, 4.9, 1.1); g.add(guard);
    for (const s of [-1, 1]) { const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.22, 1.7, 8), m); arm.position.set(s * 0.6, 4.9, 0.6); arm.rotation.x = -0.9; arm.rotation.z = s * 0.3; g.add(arm); }
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.05), new THREE.MeshBasicMaterial({ color: [0x8fd8ff, 0xffb050, 0xff6a5a, 0x9be36a][i] })); eyes.position.set(0, 6.15, 0.47); g.add(eyes);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  buildCrowd() {
    const R = ARENA_R + 3;
    const N = 900;
    const geo = new THREE.CapsuleGeometry(0.28, 0.6, 2, 6);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    this.crowd = new THREE.InstancedMesh(geo, mat, N);
    this.crowdData = [];
    const r = rng(42);
    const palette = [0x6a2a2a, 0x2a3a6a, 0x4a5a2a, 0x5a4a6a, 0x7a6a3a, 0x3a3a3a, 0x6a4a2a, 0x2a5a5a];
    const col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const tier = Math.floor(r() * 6);
      let a = r() * Math.PI * 2;
      // keep the gates clear
      if (Math.abs(Math.sin(a)) < 0.12) a += 0.3;
      const rr = R + 0.5 + tier * 1.6 + 0.6 + r() * 0.6;
      this.crowdData.push({ x: Math.sin(a) * rr, y: 4.15 + tier * 0.9, z: Math.cos(a) * rr, ph: r() * 10, amp: 0.05 + r() * 0.15, sp: 2 + r() * 4 });
      col.setHex(palette[Math.floor(r() * palette.length)]).multiplyScalar(0.7 + r() * 0.5);
      this.crowd.setColorAt(i, col);
    }
    this.crowdHype = 0;
    this.updateCrowd(0);
    this.group.add(this.crowd);
  }

  updateCrowd(t) {
    const m4 = new THREE.Matrix4();
    const hype = this.crowdHype;
    for (let i = 0; i < this.crowdData.length; i++) {
      const d = this.crowdData[i];
      const jump = Math.max(0, Math.sin(t * d.sp * (1 + hype) + d.ph)) * (d.amp + hype * 0.35);
      m4.makeTranslation(d.x, d.y + jump, d.z);
      this.crowd.setMatrixAt(i, m4);
    }
    this.crowd.instanceMatrix.needsUpdate = true;
  }

  buildBackdrop() {
    // mountains
    const r = rng(99);
    const mtnMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    for (let ring = 0; ring < 2; ring++) {
      const count = ring ? 16 : 22;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + r() * 0.2 + ring * 0.13;
        const dist = (ring ? 620 : 420) + r() * 80;
        const h = (ring ? 170 : 80) + r() * (ring ? 130 : 80);
        const w = (ring ? 160 : 110) + r() * 80;
        const geo = new THREE.ConeGeometry(w, h, 9, 6);
        const pos = geo.attributes.position, colors = [];
        const cc = new THREE.Color();
        for (let k = 0; k < pos.count; k++) {
          const y = pos.getY(k);
          if (y < h / 2 - 1) { pos.setX(k, pos.getX(k) * (0.85 + r() * 0.3)); pos.setZ(k, pos.getZ(k) * (0.85 + r() * 0.3)); pos.setY(k, y + (r() - 0.5) * h * 0.08); }
          const hn = (pos.getY(k) + h / 2) / h;
          if (hn > 0.72) cc.setRGB(0.85, 0.85, 0.92); else cc.setRGB(0.16 + hn * 0.1, 0.14 + hn * 0.08, 0.18 + hn * 0.1);
          if (ring) cc.multiplyScalar(0.75);
          colors.push(cc.r, cc.g, cc.b);
        }
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, mtnMat);
        m.position.set(Math.sin(a) * dist, h / 2 - 20, Math.cos(a) * dist);
        m.rotation.y = r() * 6;
        this.scene.add(m);
      }
    }
    // distant castle on a cliff
    const castle = new THREE.Group();
    const cm = new THREE.MeshStandardMaterial({ color: 0x3a3440, roughness: 0.95 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x2a1a3a, roughness: 0.8 });
    const win = new THREE.MeshBasicMaterial({ color: 0xffb860 });
    const cliff = new THREE.Mesh(new THREE.CylinderGeometry(40, 70, 90, 9), new THREE.MeshStandardMaterial({ color: 0x2a2630, roughness: 1, flatShading: true })); cliff.position.y = 20; castle.add(cliff);
    const towers = [[0, 0, 14, 70], [-24, 10, 8, 50], [22, 8, 8, 55], [-12, -16, 7, 45], [14, -18, 7, 48], [0, 18, 6, 40]];
    for (const [x, z, rr, h] of towers) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.6, rr * 0.7, h, 10), cm); t.position.set(x, 65 + h / 2, z); castle.add(t);
      const rf = new THREE.Mesh(new THREE.ConeGeometry(rr * 0.8, h * 0.45, 10), roof); rf.position.set(x, 65 + h + h * 0.22, z); castle.add(rf);
      for (let k = 0; k < 4; k++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3), win); const a = k * Math.PI / 2 + 0.3; w.position.set(x + Math.sin(a) * rr * 0.62, 65 + h * (0.4 + k * 0.12), z + Math.cos(a) * rr * 0.62); w.lookAt(x + Math.sin(a) * 100, w.position.y, z + Math.cos(a) * 100); castle.add(w); }
    }
    const curtain = new THREE.Mesh(new THREE.BoxGeometry(60, 22, 40), cm); curtain.position.set(0, 76, 0); castle.add(curtain);
    castle.position.set(-260, -10, -330); castle.rotation.y = 0.6;
    this.scene.add(castle);
    // floating sky islands with crystals
    for (let i = 0; i < 5; i++) {
      const isl = new THREE.Group();
      const rock = new THREE.Mesh(new THREE.ConeGeometry(10 + r() * 8, 22, 7), new THREE.MeshStandardMaterial({ color: 0x3a3238, roughness: 1, flatShading: true }));
      rock.rotation.x = Math.PI; isl.add(rock);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(11, 10, 2, 7), new THREE.MeshStandardMaterial({ color: 0x2f4a2a, roughness: 1, flatShading: true })); top.position.y = 11; isl.add(top);
      const cr = new THREE.Mesh(new THREE.OctahedronGeometry(3), new THREE.MeshStandardMaterial({ color: 0xb49aff, emissive: 0x7a5aff, emissiveIntensity: 1.5 })); cr.scale.set(1, 2.2, 1); cr.position.y = 18; isl.add(cr);
      const a = r() * Math.PI * 2, d = 200 + r() * 120;
      isl.position.set(Math.sin(a) * d, 90 + r() * 70, Math.cos(a) * d);
      const ph = r() * 6;
      this.animated.push(t => { isl.position.y += Math.sin(t * 0.3 + ph) * 0.02; cr.rotation.y = t * 0.3; });
      this.scene.add(isl);
    }
    // ground plane beyond the arena
    const ground = new THREE.Mesh(new THREE.CircleGeometry(800, 32), new THREE.MeshStandardMaterial({ color: 0x1e1c22, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.5; this.scene.add(ground);
  }

  buildAmbient() {
    // drifting magical motes
    const N = 400;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    this.moteData = [];
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 45;
      pos[i * 3] = Math.sin(a) * r; pos[i * 3 + 1] = Math.random() * 18; pos[i * 3 + 2] = Math.cos(a) * r;
      this.moteData.push({ sp: 0.2 + Math.random() * 0.6, ph: Math.random() * 6 });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const tex = canvasTex(64, (g, S) => { const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,220,160,0.6)'); grd.addColorStop(1, 'rgba(255,200,120,0)'); g.fillStyle = grd; g.fillRect(0, 0, S, S); });
    this.motes = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.35, map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd8a0 }));
    this.scene.add(this.motes);
  }

  update(dt, vfx) {
    this.time += dt;
    const t = this.time;
    this.sky.material.uniforms.t.value = t;
    this.centerRune.rotation.z = t * 0.08;
    this.centerRune.material.opacity = 0.7 + Math.sin(t * 1.5) * 0.15;
    this.outerRune.rotation.z = -t * 0.03;
    for (const f of this.animated) f(t);
    for (let i = 0; i < this.lights.length; i++) this.lights[i].intensity = 26 + Math.sin(t * 13 + i) * 4 + Math.sin(t * 7.3 + i * 2) * 3;
    // banners ripple
    for (const m of this.bannerMeshes) {
      const p = m.geometry.attributes.position, base = m.geometry.userData.base;
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        const w = (2.5 - y) / 5;
        p.setZ(i, Math.sin(t * 2.2 + y * 1.3 + x * 0.8 + m.position.x) * 0.25 * w);
      }
      p.needsUpdate = true;
    }
    // motes
    const mp = this.motes.geometry.attributes.position;
    for (let i = 0; i < mp.count; i++) {
      const d = this.moteData[i];
      let y = mp.getY(i) + d.sp * dt;
      if (y > 20) y = 0;
      mp.setY(i, y);
      mp.setX(i, mp.getX(i) + Math.sin(t * 0.5 + d.ph) * dt * 0.3);
    }
    mp.needsUpdate = true;
    this.crowdHype = Math.max(0, this.crowdHype - dt * 0.4);
    this.updateCrowd(t);
    // brazier fire
    if (vfx) for (const f of this.flames) if (Math.random() < dt * 30) vfx.emit({ x: f.x + (Math.random() - 0.5) * 0.8, y: f.y, z: f.z + (Math.random() - 0.5) * 0.8, vx: (Math.random() - 0.5) * 0.3, vy: 1.5 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 0.3, life: 0.6 + Math.random() * 0.4, size: 0.9 + Math.random() * 0.6, color: Math.random() < 0.5 ? 0xff7a1a : 0xffb84a, grow: -0.8, drag: 0.5 });
  }
}
