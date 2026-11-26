// Spell & combat visual effects.
// Two fixed-capacity GPU particle pools (additive "glow" + alpha-blended "smoke"),
// pooled shared geometries for mesh effects, projectile visuals, casting circles,
// telegraphs, auras and per-school impact effects.
import * as THREE from 'three';

const tmpC = new THREE.Color();
const V3 = new THREE.Vector3();

// projectile looks (spells and basic attacks)
const PROJ_STYLE = {
  frost_lance: { color: 0x8fd8ff, core: 0xeaffff, size: 0.38, trail: 0x6ac8ff, stretch: 3.2, shard: true },
  flame_burst: { color: 0xff7a1a, core: 0xfff0b0, size: 0.48, trail: 0xff5a10, smoke: true },
  arcane_comet: { color: 0xb46aff, core: 0xffe8ff, size: 1.05, trail: 0x9a5aff, big: true },
  sacred_bolt: { color: 0xffd860, core: 0xffffff, size: 0.42, trail: 0xffe890, rays: true },
  magma_burst: { color: 0xff5a1a, core: 0xffb050, size: 0.5, trail: 0xff3a0a, rock: true, smoke: true },
  spirit_bolt: { color: 0xff9a2a, core: 0xffe8b0, size: 0.3, trail: 0xff6a1a },
  arcane_bolt: { color: 0xb98cff, core: 0xf4e8ff, size: 0.36, trail: 0x8a5aff, caster: true, stretch: 1.8, orbit: 3 },
  holy_spark: { color: 0xffe680, core: 0xffffff, size: 0.34, trail: 0xfff0b0, caster: true, rays: true, halo: true },
  static_bolt: { color: 0x7ae0ff, core: 0xeaffff, size: 0.32, trail: 0x4ad8ff, caster: true, zap: true, arc: true },
  axe_throw: { color: 0x9a8a7a, core: 0xb8b0a8, size: 0.42, trail: 0x6a5a4a, axe: true, small: true },
  fire_bolt: { color: 0xff8a3a, core: 0xfff0b0, size: 0.32, trail: 0xff5a10, caster: true, smoke: true },
  fireball: { color: 0xff6a1a, core: 0xffe0a0, size: 0.62, trail: 0xff4a0a, smoke: true, rays: true },
  frostbite: { color: 0xa8e4ff, core: 0xeaffff, size: 0.3, trail: 0x7ac8ff, stretch: 2.2, shard: true },
  shadow_bolt: { color: 0xa060ff, core: 0xe8d0ff, size: 0.32, trail: 0x5a1aa0, caster: true, orbit: 2 },
  mind_blast: { color: 0x9a4aff, core: 0xf0e0ff, size: 0.52, trail: 0x4a0a8a, rays: true, halo: true },
};
const SCHOOL_COLOR = { frost: 0x8fd8ff, fire: 0xff7a2a, arcane: 0xc07aff, holy: 0xffe070, nature: 0x7ae0ff, shadow: 0xa060ff, phys: 0xffffff };
const CAST_SCHOOL_COLOR = { frost: 0x8fd8ff, fire: 0xff8a3a, arcane: 0xc07aff, holy: 0xffe070, nature: 0x7ae0ff, shadow: 0xa060ff };

function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  return new THREE.CanvasTexture(c);
}
const softTex = () => canvasTex(64, (g) => {
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.8)'); grd.addColorStop(0.6, 'rgba(255,255,255,0.2)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
});
const smokeTex = () => canvasTex(64, (g) => {
  for (let i = 0; i < 7; i++) {
    const x = 20 + Math.random() * 24, y = 20 + Math.random() * 24, r = 12 + Math.random() * 12;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  }
});
const ringTex = () => canvasTex(256, (g) => {
  const grd = g.createRadialGradient(128, 128, 60, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.75, 'rgba(255,255,255,0.15)'); grd.addColorStop(0.92, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
});
const teleTex = () => canvasTex(256, (g) => {
  g.strokeStyle = 'white'; g.lineWidth = 8; g.beginPath(); g.arc(128, 128, 120, 0, 7); g.stroke();
  g.setLineDash([10, 14]); g.lineWidth = 3; g.beginPath(); g.arc(128, 128, 100, 0, 7); g.stroke(); g.setLineDash([]);
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 124);
  grd.addColorStop(0, 'rgba(255,255,255,0.04)'); grd.addColorStop(1, 'rgba(255,255,255,0.35)');
  g.fillStyle = grd; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill();
});
const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
const castCircleTex = () => canvasTex(256, (g, S) => {
  const c = S / 2; g.strokeStyle = 'white'; g.fillStyle = 'white'; g.shadowColor = 'white'; g.shadowBlur = 8;
  g.lineWidth = 4; g.beginPath(); g.arc(c, c, c * 0.92, 0, 7); g.stroke();
  g.lineWidth = 2; g.beginPath(); g.arc(c, c, c * 0.72, 0, 7); g.stroke();
  g.font = `bold ${S * 0.1}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.save(); g.translate(c + Math.cos(a) * c * 0.82, c + Math.sin(a) * c * 0.82); g.rotate(a + Math.PI / 2); g.fillText(RUNES[i * 2 % RUNES.length], 0, 0); g.restore(); }
  g.lineWidth = 2; g.beginPath();
  for (let i = 0; i <= 6; i++) { const a = (i * 2 / 6) * Math.PI * 2; const x = c + Math.cos(a) * c * 0.68, y = c + Math.sin(a) * c * 0.68; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
});
const selectTex = () => canvasTex(256, (g, S) => {
  const c = S / 2; g.strokeStyle = 'white'; g.shadowColor = 'white'; g.shadowBlur = 10;
  g.lineWidth = 7;
  for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(c, c, c * 0.8, i * Math.PI / 2 + 0.18, (i + 1) * Math.PI / 2 - 0.18); g.stroke(); }
  g.lineWidth = 2; g.beginPath(); g.arc(c, c, c * 0.92, 0, 7); g.stroke();
});
const rayTex = () => canvasTex(128, (g, S) => {
  const grd = g.createLinearGradient(0, 0, 0, S); grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(S * 0.35, 0, S * 0.3, S);
});

// ------------------------------------------------------------------ particle pool
class Pool {
  constructor(scene, max, map, blending, renderOrder) {
    this.max = max; this.n = 0;
    const F = n => new Float32Array(n);
    this.px = F(max); this.py = F(max); this.pz = F(max); this.vx = F(max); this.vy = F(max); this.vz = F(max);
    this.life = F(max); this.t = F(max); this.size = F(max); this.grow = F(max); this.grav = F(max); this.drag = F(max); this.a = F(max);
    this.cr = F(max); this.cg = F(max); this.cb = F(max);
    const geo = new THREE.BufferGeometry();
    this.aPos = F(max * 3); this.aCol = F(max * 3); this.aSize = F(max); this.aAlpha = F(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.aPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.aCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, scale: { value: 600 }, uGain: { value: blending === THREE.AdditiveBlending ? 0.62 : 1.0 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(size * scale / -mv.z, 256.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform float uGain; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA * uGain); }`,
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = renderOrder;
    scene.add(this.points);
  }
  emit(o) {
    let i = this.n;
    if (i >= this.max) i = Math.floor(Math.random() * this.max); else this.n++;
    this.px[i] = o.x; this.py[i] = o.y; this.pz[i] = o.z;
    this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0; this.vz[i] = o.vz || 0;
    this.life[i] = o.life || 1; this.t[i] = 0; this.size[i] = o.size || 0.5; this.grow[i] = o.grow ?? 0;
    this.grav[i] = o.gravity || 0; this.drag[i] = o.drag || 0; this.a[i] = o.alpha ?? 1;
    tmpC.setHex(o.color ?? 0xffffff); this.cr[i] = tmpC.r; this.cg[i] = tmpC.g; this.cb[i] = tmpC.b;
  }
  kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 't', 'size', 'grow', 'grav', 'drag', 'a', 'cr', 'cg', 'cb']) this[k][i] = this[k][j];
  }
  update(dt) {
    for (let i = this.n - 1; i >= 0; i--) {
      this.t[i] += dt;
      if (this.t[i] >= this.life[i]) { this.kill(i); continue; }
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= dr; this.vy[i] = this.vy[i] * dr - this.grav[i] * dt; this.vz[i] *= dr;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
    }
    for (let i = 0; i < this.n; i++) {
      const u = this.t[i] / this.life[i];
      this.aPos[i * 3] = this.px[i]; this.aPos[i * 3 + 1] = this.py[i]; this.aPos[i * 3 + 2] = this.pz[i];
      this.aCol[i * 3] = this.cr[i]; this.aCol[i * 3 + 1] = this.cg[i]; this.aCol[i * 3 + 2] = this.cb[i];
      this.aSize[i] = Math.max(0.01, this.size[i] * (1 + this.grow[i] * u));
      this.aAlpha[i] = this.a[i] * (u < 0.1 ? u / 0.1 : 1 - (u - 0.1) / 0.9);
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.n);
    for (const k of ['position', 'color', 'size', 'alpha']) { const at = geo.attributes[k]; at.needsUpdate = true; at.clearUpdateRanges?.(); at.addUpdateRange?.(0, this.n * at.itemSize); }
  }
  clear() { this.n = 0; }
}

export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.budget = 1; // scaled down on low quality
    this.glow = new Pool(scene, 5000, softTex(), THREE.AdditiveBlending, 10);
    this.smoke = new Pool(scene, 1200, smokeTex(), THREE.NormalBlending, 9);
    this.effects = [];
    this.projMeshes = new Map();
    this.zoneMeshes = new Map();
    this.buffFx = new Map();   // fighter id -> Map(key -> object)
    this.castFx = new Map();   // fighter id -> casting circle group
    this.ringTexture = ringTex(); this.teleTexture = teleTex(); this.castTexture = castCircleTex(); this.rayTexture = rayTex();
    this.G = { // shared geometries (never disposed)
      plane: new THREE.PlaneGeometry(2, 2), sphere: new THREE.SphereGeometry(1, 20, 14), sphereLo: new THREE.SphereGeometry(1, 10, 8),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 18, 1, true), cone: new THREE.ConeGeometry(1, 1, 6), shard: new THREE.OctahedronGeometry(1),
      torus: new THREE.TorusGeometry(1, 0.08, 6, 48), rock: new THREE.DodecahedronGeometry(1), box: new THREE.BoxGeometry(1, 1, 1),
    };
    this.lightPool = [];
    for (let i = 0; i < 4; i++) { const L = new THREE.PointLight(0xffffff, 0, 14, 2); scene.add(L); this.lightPool.push({ L, t: 1, dur: 1, peak: 0 }); }
  }

  setScale(h) { this.glow.mat.uniforms.scale.value = h * 0.9; this.smoke.mat.uniforms.scale.value = h * 0.9; }
  setQuality(q) { this.budget = q === 'low' ? 0.45 : q === 'medium' ? 0.75 : 1; }
  selectionTexture() { return this._sel || (this._sel = selectTex()); }

  // ---------------------------------------------------------------- particles
  emit(o) { this.glow.emit(o); }
  puff(o) { this.smoke.emit(o); }
  n(k) { return Math.max(1, Math.round(k * this.budget)); }
  burst(x, y, z, color, n, speed, life, size, o = {}) {
    n = this.n(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + Math.random() * 0.6);
      let vx = s * Math.cos(th) * sp, vy = u * sp, vz = s * Math.sin(th) * sp;
      if (o.flat) vy = Math.abs(vy) * 0.2;
      if (o.up) vy = Math.abs(vy) + o.up;
      (o.smoke ? this.smoke : this.glow).emit({ x, y, z, vx, vy, vz, life: life * (0.6 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.7), color: Array.isArray(color) ? color[i % color.length] : color, grow: o.grow ?? -0.5, gravity: o.gravity || 0, drag: o.drag ?? 1.5, alpha: o.alpha ?? 1 });
    }
  }
  smokeBurst(x, y, z, color, n, speed, life, size, alpha = 0.6) { this.burst(x, y, z, color, n, speed, life, size, { smoke: true, grow: 1.4, up: 0.6, drag: 2, alpha }); }
  ringBurst(x, y, z, color, n, speed, life, size) {
    n = this.n(n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.glow.emit({ x, y, z, vx: Math.sin(a) * speed, vy: 0.3, vz: Math.cos(a) * speed, life, size, color, grow: -0.3, drag: 1.2 });
    }
  }
  spiral(x, y, z, color, n, radius, height, life, size) {
    n = this.n(n);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 6, h = i / n * height;
      this.glow.emit({ x: x + Math.sin(a) * radius, y: y + h, z: z + Math.cos(a) * radius, vx: Math.cos(a) * 0.6, vy: 1.4, vz: -Math.sin(a) * 0.6, life, size, color, grow: -0.6, drag: 0.5 });
    }
  }

  // ---------------------------------------------------------------- mesh effects (shared geometry)
  addEffect(obj, dur, update) { this.scene.add(obj); this.effects.push({ obj, t: 0, dur, update }); return obj; }
  addMat(c, o = 1, extra = {}) { return new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, ...extra }); }

  groundRing(x, z, color, r0, r1, dur, y = 0.08, opacity = 1) {
    const m = new THREE.Mesh(this.G.plane, this.addMat(color, opacity, { map: this.ringTexture }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
    this.addEffect(m, dur, (u) => { const r = (r0 + (r1 - r0) * (1 - Math.pow(1 - u, 2))) / 2; m.scale.set(r * 2, r * 2, r * 2); m.material.opacity = opacity * (1 - u); });
  }
  sphereFlash(x, y, z, color, r0, r1, dur, opacity = 0.6) {
    opacity *= 0.32; r1 = Math.min(r1, 4);
    const m = new THREE.Mesh(this.G.sphere, this.addMat(color, opacity));
    m.position.set(x, y, z);
    this.addEffect(m, dur, (u) => { m.scale.setScalar(r0 + (r1 - r0) * (1 - Math.pow(1 - u, 3))); m.material.opacity = opacity * (1 - u); });
  }
  pillar(x, z, color, h, r, dur) {
    const m = new THREE.Mesh(this.G.cyl, this.addMat(color, 0.7));
    m.position.set(x, h / 2, z); m.scale.set(r, h, r);
    this.addEffect(m, dur, (u) => { m.scale.set(r * (1 - u * 0.7), h, r * (1 - u * 0.7)); m.material.opacity = 0.7 * (1 - u); });
  }
  lightRays(x, y, z, color, n, h, dur) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.G.plane, this.addMat(color, 0.8, { map: this.rayTexture }));
      const a = i / n * Math.PI; m.position.set(x, y + h / 2, z); m.rotation.y = a; m.scale.set(0.35, h / 2, 1);
      this.addEffect(m, dur, (u) => { m.material.opacity = 0.8 * Math.sin(u * Math.PI); m.scale.x = 0.35 + u * 0.4; });
    }
  }
  shards(x, y, z, color, n, speed, dur, size = 0.25) {
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.15, metalness: 0.2, transparent: true });
    n = this.n(n);
    const g = new THREE.Group();
    const parts = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.G.shard, mat);
      m.scale.set(size * 0.5, size * 1.6, size * 0.5);
      const a = Math.random() * Math.PI * 2, up = 0.3 + Math.random();
      parts.push({ m, vx: Math.sin(a) * speed * (0.5 + Math.random()), vy: up * speed, vz: Math.cos(a) * speed * (0.5 + Math.random()), rx: Math.random() * 10, ry: Math.random() * 10 });
      m.position.set(x, y, z); g.add(m);
    }
    this.addEffect(g, dur, (u, dt) => {
      for (const p of parts) { p.vy -= 18 * dt; p.m.position.x += p.vx * dt; p.m.position.y = Math.max(0.05, p.m.position.y + p.vy * dt); p.m.position.z += p.vz * dt; p.m.rotation.x += p.rx * dt; p.m.rotation.y += p.ry * dt; }
      mat.opacity = u > 0.6 ? (1 - u) / 0.4 : 1;
    });
  }
  beam(a, b, color, dur = 0.25, width = 0.08, jag = 0.5, branches = 0) {
    const pts = [];
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const p = new THREE.Vector3().lerpVectors(a, b, i / n);
      if (i > 0 && i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * jag, (Math.random() - 0.5) * jag, (Math.random() - 0.5) * jag));
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const core = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, width, 4), this.addMat(0xffffff, 1));
    const glowM = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, width * 4, 5), this.addMat(color, 0.45));
    const g = new THREE.Group(); g.add(core, glowM);
    this.addEffect(g, dur, (u) => { const k = (1 - u) * (Math.random() < 0.3 ? 0.5 : 1); core.material.opacity = k; glowM.material.opacity = 0.45 * k; });
    // a few forked branches
    for (let k = 0; k < branches; k++) {
      const from = pts[2 + Math.floor(Math.random() * (n - 4))];
      const to = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3));
      this.beam(from, to, color, dur * 0.8, width * 0.6, jag * 0.6, 0);
    }
  }
  flash(x, y, z, color, peak = 40, dur = 0.35) {
    let slot = this.lightPool[0];
    for (const s of this.lightPool) if (s.t / s.dur > slot.t / slot.dur) slot = s;
    slot.L.color.setHex(color); slot.L.position.set(x, y, z); slot.t = 0; slot.dur = dur; slot.peak = peak;
  }

  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.t += dt;
      const u = Math.min(1, e.t / e.dur);
      e.update && e.update(u, dt);
      if (e.t >= e.dur) {
        this.scene.remove(e.obj);
        e.obj.traverse(o => { if (o.material && o.material.dispose) o.material.dispose(); if (o.geometry && !Object.values(this.G).includes(o.geometry)) o.geometry.dispose(); });
        this.effects.splice(i, 1);
      }
    }
    for (const s of this.lightPool) { s.t += dt; const u = Math.min(1, s.t / s.dur); s.L.intensity = s.peak * (1 - u) * (1 - u); }
  }

  // ---------------------------------------------------------------- projectiles (driven by view state)
  syncProjectiles(list, dt) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let m = this.projMeshes.get(p.id);
      const st = PROJ_STYLE[p.kind] || PROJ_STYLE.flame_burst;
      if (!m) {
        const g = new THREE.Group();
        const core = new THREE.Mesh(st.rock ? this.G.rock : (st.shard || st.axe) ? this.G.shard : this.G.sphereLo,
          st.axe ? new THREE.MeshStandardMaterial({ color: 0x8a8078, roughness: 0.35, metalness: 0.9 }) :
          st.rock ? new THREE.MeshStandardMaterial({ color: 0x3a2010, emissive: 0xff4a0a, emissiveIntensity: 1.5, flatShading: true }) : st.shard ? new THREE.MeshStandardMaterial({ color: 0xcff4ff, emissive: 0x6ac8ff, emissiveIntensity: 1.2, roughness: 0.1 }) : new THREE.MeshBasicMaterial({ color: st.core }));
        const halo = new THREE.Mesh(this.G.sphereLo, this.addMat(st.color, 0.5));
        core.scale.setScalar(st.size * (st.rock ? 0.6 : st.shard ? 0.35 : 0.5)); halo.scale.setScalar(st.size);
        if (st.stretch) { core.scale.z = st.size * st.stretch * 0.4; halo.scale.z = st.size * st.stretch * 0.6; }
        if (st.axe) { core.scale.set(st.size * 0.7, st.size * 0.25, st.size * 1.1); halo.scale.setScalar(st.size * 0.6); halo.material.opacity = 0.15; }
        g.add(core, halo);
        if (st.big) { const ring = new THREE.Mesh(this.G.torus, this.addMat(st.color, 0.8)); ring.scale.setScalar(st.size * 1.3); g.add(ring); g.userData.ring = ring; }
        if (st.orbit || st.halo) { // caster bolts: orbiting motes / a spinning ring of light around the flight axis
          const sp = new THREE.Group();
          for (let i = 0; i < (st.orbit || 0); i++) { const a = i / st.orbit * Math.PI * 2, m2 = new THREE.Mesh(this.G.sphereLo, this.addMat(st.core, 0.95)); m2.scale.setScalar(st.size * 0.2); m2.position.set(Math.cos(a) * st.size * 0.95, Math.sin(a) * st.size * 0.95, 0); sp.add(m2); }
          if (st.halo) { const ring = new THREE.Mesh(this.G.torus, this.addMat(st.color, 0.85)); ring.scale.setScalar(st.size * 1.05); sp.add(ring); }
          g.add(sp); g.userData.spin = sp;
        }
        g.position.set(p.x, p.y, p.z);
        g.userData.prev = new THREE.Vector3(p.x, p.y, p.z);
        g.userData.core = core;
        this.scene.add(g); this.projMeshes.set(p.id, g); m = g;
      }
      const prev = m.userData.prev;
      m.position.set(p.x, p.y, p.z);
      const dx = p.x - prev.x, dy = p.y - prev.y, dz = p.z - prev.z;
      if (dx * dx + dy * dy + dz * dz > 1e-6) m.lookAt(p.x + dx, p.y + dy, p.z + dz);
      if (m.userData.ring) { m.userData.ring.rotation.x += dt * 6; m.userData.ring.rotation.y += dt * 4; }
      if (st.rock) m.userData.core.rotation.x += dt * 10;
      if (st.axe) m.userData.core.rotation.x += dt * 28;
      if (m.userData.spin) { m.userData.spin.rotation.z += dt * 14; const pu = 1 + Math.sin(performance.now() * 0.025) * 0.15; m.userData.spin.scale.setScalar(pu); }
      if (st.arc && Math.random() < 0.3) { const a = new THREE.Vector3(p.x, p.y, p.z), b = new THREE.Vector3(p.x - dx * 3 + (Math.random() - 0.5) * 0.6, p.y - dy * 3 + (Math.random() - 0.5) * 0.6, p.z - dz * 3 + (Math.random() - 0.5) * 0.6); this.beam(a, b, st.color, 0.1, 0.02, 0.35); }
      // trail
      const steps = st.big ? 6 : st.caster ? 4 : st.small ? 2 : 3;
      for (let k = 0; k < steps; k++) {
        const u = k / steps, j = st.size * 0.5;
        this.glow.emit({ x: prev.x + dx * u + (Math.random() - 0.5) * j, y: prev.y + dy * u + (Math.random() - 0.5) * j, z: prev.z + dz * u + (Math.random() - 0.5) * j, vx: (Math.random() - 0.5), vy: (Math.random() - 0.5), vz: (Math.random() - 0.5), life: st.big ? 0.8 : st.caster ? 0.38 : st.small ? 0.25 : 0.4, size: st.size * (st.big ? 2.2 : st.caster ? 1.3 : 1.6), color: k % 2 ? st.trail : st.color, grow: -0.7, drag: 2 });
      }
      if (st.smoke && Math.random() < 0.6) this.smoke.emit({ x: prev.x, y: prev.y, z: prev.z, vy: 0.6, life: 0.7, size: st.size * 2, color: 0x2a1a14, grow: 1.2, drag: 1, alpha: 0.45 });
      if (st.zap && Math.random() < 0.5) this.glow.emit({ x: p.x + (Math.random() - 0.5) * 0.5, y: p.y + (Math.random() - 0.5) * 0.5, z: p.z + (Math.random() - 0.5) * 0.5, life: 0.08, size: 0.25, color: 0xffffff });
      if (st.rays && Math.random() < 0.4) this.glow.emit({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, vz: (Math.random() - 0.5) * 3, life: 0.3, size: 0.2, color: 0xffffff, drag: 3 });
      prev.set(p.x, p.y, p.z);
    }
    for (const [id, m] of this.projMeshes) if (!seen.has(id)) { this.scene.remove(m); m.traverse(o => { if (o.material) o.material.dispose(); }); this.projMeshes.delete(id); }
  }

  // ---------------------------------------------------------------- zones (totems & telegraphs)
  syncZones(list, dt, myTeam = 0, fighters = []) {
    const seen = new Set();
    for (const z of list) {
      seen.add(z.id);
      let m = this.zoneMeshes.get(z.id);
      const hostile = fighters[z.owner] ? fighters[z.owner].team !== myTeam : false;
      if (!m) { m = this.makeZone(z, hostile); this.scene.add(m); this.zoneMeshes.set(z.id, m); }
      const u = Math.min(1, z.t / z.dur);
      if (z.type === 'quake') {
        m.userData.fill.scale.setScalar(Math.max(0.01, z.r * u));
        m.userData.fill.material.opacity = 0.25 + u * 0.4;
        m.userData.edge.material.opacity = 0.6 + Math.sin(z.t * 20) * 0.3 * u;
        m.userData.totem.position.y = Math.min(0, -1.5 + z.t * 8);
        if (Math.random() < 0.35) this.smoke.emit({ x: z.x + (Math.random() - 0.5) * z.r * 1.6, y: 0.1, z: z.z + (Math.random() - 0.5) * z.r * 1.6, vy: 0.8 + Math.random(), life: 0.7, size: 0.8, color: 0x7a6a50, grow: 1, gravity: 1, alpha: 0.5 });
      } else if (z.type === 'plague') {
        m.userData.ring.rotation.z += dt * 0.6;
        const fade = Math.min(1, (z.dur - z.t) * 2);
        m.userData.fill.material.opacity = (0.16 + Math.sin(z.t * 5) * 0.04) * fade;
        for (let k = 0; k < 2; k++) { const a = Math.random() * 6.28, r = Math.random() * z.r; this.smoke.emit({ x: z.x + Math.sin(a) * r, y: (z.y || 0) + 0.3, z: z.z + Math.cos(a) * r, vy: 0.5 + Math.random() * 0.6, life: 1.6, size: 2.2, color: 0x4a8a2a, grow: 0.8, drag: 0.6, alpha: 0.4 * fade }); }
        if (Math.random() < 0.5) { const a = Math.random() * 6.28, r = Math.random() * z.r; this.glow.emit({ x: z.x + Math.sin(a) * r, y: (z.y || 0) + 0.5 + Math.random(), z: z.z + Math.cos(a) * r, vy: 0.6, life: 0.9, size: 0.25, color: 0x9bff5a }); }
      } else if (z.type === 'meteor') {
        // telegraph fills up while the meteor falls from the sky toward the circle
        const U = m.userData;
        U.fill.scale.setScalar(Math.max(0.01, z.r * u));
        U.fill.material.opacity = 0.2 + u * 0.4;
        U.edge.material.opacity = 0.6 + Math.sin(z.t * 24) * 0.3 * u;
        const h = 26 * (1 - u) * (1 - u) + 0.6;
        U.rock.position.set(-6 * (1 - u), h, -3 * (1 - u)); U.rock.rotation.x += dt * 6; U.rock.rotation.z += dt * 4;
        const wx = z.x + U.rock.position.x, wy = (z.y || 0) + h, wz = z.z + U.rock.position.z;
        for (let k = 0; k < 3; k++) this.glow.emit({ x: wx + (Math.random() - 0.5) * 0.8, y: wy + (Math.random() - 0.5) * 0.8, z: wz + (Math.random() - 0.5) * 0.8, vy: 1, life: 0.6, size: 1.4, color: k % 2 ? 0xff5a1a : 0xffc060, grow: -0.6, drag: 1 });
        if (Math.random() < 0.6) this.smoke.emit({ x: wx, y: wy, z: wz, vy: 0.5, life: 1.2, size: 1.6, color: 0x2a1a14, grow: 1.4, drag: 1, alpha: 0.5 });
      } else if (z.type === 'stoneskin') {
        m.userData.dome.material.opacity = 0.1 + Math.sin(z.t * 4) * 0.03;
        m.userData.ring.rotation.z += dt * 0.5;
        m.userData.totem.position.y = Math.min(0, -1.5 + z.t * 8);
        if (Math.random() < 0.4) { const a = Math.random() * 6.28, r = Math.random() * z.r; this.glow.emit({ x: z.x + Math.sin(a) * r, y: 0.1, z: z.z + Math.cos(a) * r, vy: 1.2, life: 1.2, size: 0.3, color: 0xb0e080 }); }
        if (z.dur - z.t < 1) m.userData.dome.material.opacity *= (z.dur - z.t);
      }
    }
    for (const [id, m] of this.zoneMeshes) if (!seen.has(id)) { this.scene.remove(m); this.zoneMeshes.delete(id); }
  }

  makeTotem(color, glyphColor) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 0.9, flatShading: true });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.2, 7), wood); pole.position.y = 1.1; pole.castShadow = true; g.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.55), new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true })); head.position.y = 2.4; head.castShadow = true; g.add(head);
    for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.1), wood); w.position.set(s * 0.5, 2.1, 0); w.rotation.z = s * 0.4; g.add(w); }
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.05), new THREE.MeshBasicMaterial({ color: glyphColor })); eye.position.set(0, 2.45, 0.29); g.add(eye);
    const eye2 = eye.clone(); eye2.position.z = -0.29; g.add(eye2);
    const gl = new THREE.Mesh(this.G.sphereLo, this.addMat(glyphColor, 0.25)); gl.scale.setScalar(0.5); gl.position.y = 2.4; g.add(gl);
    return g;
  }

  makeZone(z, hostile) {
    const g = new THREE.Group(); g.position.set(z.x, z.y || 0, z.z);
    if (z.type === 'quake') {
      const col = hostile ? 0xff3a2a : 0xffa040;
      const edge = new THREE.Mesh(this.G.plane, this.addMat(col, 0.9, { map: this.teleTexture }));
      edge.scale.setScalar(z.r); edge.rotation.x = -Math.PI / 2; edge.position.y = 0.06; g.add(edge);
      const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 40), this.addMat(col, 0.3));
      fill.rotation.x = -Math.PI / 2; fill.position.y = 0.07; g.add(fill);
      const totem = this.makeTotem(0x8a6a4a, 0xffa040); g.add(totem);
      g.userData = { fill, edge, totem };
    } else if (z.type === 'plague') {
      const ring = new THREE.Mesh(this.G.plane, this.addMat(hostile ? 0x7aff3a : 0x9be36a, 0.75, { map: this.teleTexture }));
      ring.scale.setScalar(z.r); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring);
      const fill = new THREE.Mesh(new THREE.CircleGeometry(z.r, 40), this.addMat(0x4a9a2a, 0.18)); fill.rotation.x = -Math.PI / 2; fill.position.y = 0.07; g.add(fill);
      g.userData = { ring, fill };
    } else if (z.type === 'meteor') {
      const col = hostile ? 0xff3a1a : 0xff9a3a;
      const edge = new THREE.Mesh(this.G.plane, this.addMat(col, 0.9, { map: this.teleTexture }));
      edge.scale.setScalar(z.r); edge.rotation.x = -Math.PI / 2; edge.position.y = 0.06; g.add(edge);
      const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 40), this.addMat(col, 0.3));
      fill.rotation.x = -Math.PI / 2; fill.position.y = 0.07; g.add(fill);
      const rock = new THREE.Mesh(this.G.rock, new THREE.MeshStandardMaterial({ color: 0x3a2010, emissive: 0xff4a0a, emissiveIntensity: 1.8, flatShading: true }));
      rock.scale.setScalar(0.9); const halo = new THREE.Mesh(this.G.sphereLo, this.addMat(0xff7a2a, 0.45)); halo.scale.setScalar(1.6); rock.add(halo);
      g.add(rock);
      g.userData = { fill, edge, rock };
    } else if (z.type === 'stoneskin') {
      const dome =new THREE.Mesh(new THREE.SphereGeometry(z.r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), this.addMat(hostile ? 0xd07050 : 0x9ad070, 0.1));
      g.add(dome);
      const ring = new THREE.Mesh(this.G.plane, this.addMat(hostile ? 0xd07050 : 0x9ad070, 0.7, { map: this.teleTexture }));
      ring.scale.setScalar(z.r); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring);
      const totem = this.makeTotem(0x6a7a5a, 0xb0ff80); g.add(totem);
      g.userData = { dome, ring, totem };
    }
    return g;
  }

  // ---------------------------------------------------------------- casting circles (WoW-style)
  syncCasts(fighters, chars, schoolOf, dt, time) {
    const seen = new Set();
    for (const f of fighters) {
      const ch = chars[f.id]; if (!ch || !f.cast || !f.alive) continue;
      seen.add(f.id);
      const school = schoolOf(f);
      const col = CAST_SCHOOL_COLOR[school] || 0xffffff;
      let g = this.castFx.get(f.id);
      if (!g) {
        g = new THREE.Group();
        const circle = new THREE.Mesh(this.G.plane, this.addMat(col, 0, { map: this.castTexture }));
        circle.rotation.x = -Math.PI / 2; circle.position.y = 0.06; circle.scale.setScalar(1.25);
        const orb = new THREE.Mesh(this.G.sphereLo, this.addMat(col, 0.5));
        g.add(circle, orb); g.userData = { circle, orb, col };
        this.scene.add(g); this.castFx.set(f.id, g);
      }
      const p = ch.root.position, pr = Math.min(1, f.cast.t / f.cast.dur);
      g.position.set(p.x, p.y, p.z);
      const { circle, orb } = g.userData;
      circle.rotation.z += dt * (1.5 + pr * 3);
      circle.material.opacity = Math.min(0.85, circle.material.opacity + dt * 4);
      const fp = ch.focusWorld(V3);
      orb.position.set(fp.x - p.x, fp.y - p.y, fp.z - p.z);
      orb.scale.setScalar(0.15 + pr * 0.35 + Math.sin(time * 18) * 0.03);
      // energy gathering toward the focus
      if (Math.random() < dt * 40 * this.budget) {
        const a = Math.random() * 6.28, r = 1.2 + Math.random() * 0.6;
        this.glow.emit({ x: fp.x + Math.sin(a) * r, y: fp.y + (Math.random() - 0.3) * r, z: fp.z + Math.cos(a) * r, vx: -Math.sin(a) * r * 2.2, vy: 0, vz: -Math.cos(a) * r * 2.2, life: 0.45, size: 0.22, color: col, grow: -0.4 });
      }
      if (Math.random() < dt * 10) this.glow.emit({ x: p.x + (Math.random() - 0.5) * 2, y: 0.1, z: p.z + (Math.random() - 0.5) * 2, vy: 1.5, life: 0.7, size: 0.18, color: col });
    }
    for (const [id, g] of this.castFx) if (!seen.has(id)) { this.scene.remove(g); g.traverse(o => o.material?.dispose?.()); this.castFx.delete(id); }
  }

  // ---------------------------------------------------------------- persistent buff visuals
  syncBuffs(fighters, chars, dt, time) {
    for (const f of fighters) {
      const ch = chars[f.id]; if (!ch) continue;
      let map = this.buffFx.get(f.id);
      if (!map) { map = new Map(); this.buffFx.set(f.id, map); }
      const want = new Set();
      const pos = ch.root.position;
      for (const b of (f.alive ? f.buffs : [])) {
        let key = null;
        if (b.type === 'absorb') key = b.fx || 'absorb';
        else if (['stun', 'root', 'disorient', 'silence', 'dr', 'tempest', 'mark', 'spirit', 'speed', 'stoneskin', 'slow', 'healred', 'stealth', 'berserk', 'lifesteal'].includes(b.type)) key = b.type === 'dr' && b.fx === 'undying' ? 'undying' : b.type;
        else if (b.type === 'dot') key = b.data?.school === 'holy' || b.name === 'Holy Burn' ? 'dot_holy' : 'dot';
        if (!key) continue;
        want.add(key);
        let fx = map.get(key);
        if (!fx) { fx = this.makeBuffFx(key, f); if (fx) { this.scene.add(fx); map.set(key, fx); } }
        if (fx) this.updateBuffFx(key, fx, pos, dt, time, f, ch);
      }
      for (const [k, fx] of map) if (!want.has(k)) { this.scene.remove(fx); this.disposeObj(fx); map.delete(k); }
      // Bloodrage made visible: a berserker steams red rage the lower his health
      if (f.cls === 'berserker' && f.alive) {
        const miss = 1 - Math.max(0, f.hp) / f.maxHp;
        if (miss > 0.25 && Math.random() < dt * 30 * miss * this.budget) { const a = Math.random() * 6.28; this.glow.emit({ x: pos.x + Math.sin(a) * 0.35, y: pos.y + 1.0 + Math.random() * 0.9, z: pos.z + Math.cos(a) * 0.35, vy: 1.4, life: 0.7, size: 0.18 + miss * 0.25, color: 0xd8201a, grow: -0.4 }); }
        if (miss > 0.5 && Math.random() < dt * 6 * this.budget) this.smoke.emit({ x: pos.x, y: pos.y + 1.6, z: pos.z, vy: 0.9, life: 1.0, size: 0.6, color: 0x5a1010, grow: 1.2, alpha: 0.35 });
      }
    }
  }

  makeBuffFx(key, f) {
    const add = (c, o = 0.3) => this.addMat(c, o);
    const g = new THREE.Group();
    switch (key) {
      case 'mana_ward': case 'absorb': {
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 2), add(0x6aa8ff, 0.14)); s.position.y = 1.1; g.add(s);
        const w = new THREE.Mesh(new THREE.IcosahedronGeometry(1.32, 1), new THREE.MeshBasicMaterial({ color: 0x9ac8ff, wireframe: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); w.position.y = 1.1; g.add(w);
        g.userData.spin = w; g.userData.pulse = s; return g; }
      case 'divine_aegis': {
        const s = new THREE.Mesh(this.G.sphere, add(0xffe08a, 0.16)); s.scale.setScalar(1.3); s.position.y = 1.1; g.add(s);
        const r = new THREE.Mesh(this.G.torus, add(0xfff0b0, 0.8)); r.scale.setScalar(1.35); r.position.y = 1.1; g.add(r);
        const r2 = r.clone(); r2.rotation.x = Math.PI / 2; g.add(r2);
        g.userData.spin = r; g.userData.spin2 = r2; return g; }
      case 'dr': {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, 2.4, 6, 3, true), new THREE.MeshBasicMaterial({ color: 0xe8f0ff, wireframe: true, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })); w.position.y = 1.2; g.add(w);
        const s = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.4, 6, 1, true), add(0xc8d8ff, 0.15)); s.position.y = 1.2; g.add(s);
        g.userData.spin = w; return g; }
      case 'stun': {
        for (let i = 0; i < 3; i++) { const st = new THREE.Mesh(this.G.shard, add(0xffe060, 1)); st.scale.setScalar(0.1); g.add(st); }
        g.userData.stars = true; return g; }
      case 'disorient': {
        for (let i = 0; i < 4; i++) { const st = new THREE.Mesh(this.G.sphereLo, add(0xfff6c0, 1)); st.scale.setScalar(0.08); g.add(st); }
        g.userData.stars = true; return g; }
      case 'root': {
        const ice = new THREE.MeshStandardMaterial({ color: 0xbfefff, emissive: 0x3a8ac8, emissiveIntensity: 0.8, transparent: true, opacity: 0.85, roughness: 0.1 });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const sh = new THREE.Mesh(this.G.cone, ice); const h = 0.9 + Math.random() * 0.7; sh.scale.set(0.2, h, 0.2);
          sh.position.set(Math.sin(a) * 0.45, h / 2 - 0.1, Math.cos(a) * 0.45); sh.rotation.set(Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4); g.add(sh);
        }
        const frost = new THREE.Mesh(this.G.plane, add(0xbfefff, 0.5)); frost.material.map = this.ringTexture; frost.rotation.x = -Math.PI / 2; frost.position.y = 0.06; frost.scale.setScalar(0.9); g.add(frost);
        return g; }
      case 'silence': {
        const r = new THREE.Mesh(this.G.torus, add(0x9ec0ff, 0.9)); r.scale.setScalar(0.3); r.position.y = 2.45; r.rotation.x = Math.PI / 2; g.add(r);
        g.userData.spin = r; return g; }
      case 'tempest': {
        const r = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.5, 4, 32), add(0xffe0a0, 0.22)); r.rotation.x = Math.PI / 2; r.position.y = 1.1; g.add(r);
        const r2 = new THREE.Mesh(new THREE.RingGeometry(1.0, 6, 40), add(0xffd080, 0.1)); r2.rotation.x = -Math.PI / 2; r2.position.y = 0.1; g.add(r2);
        g.userData.spin = r; return g; }
      case 'mark': {
        const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
        x.fillStyle = '#ff3a5a'; x.font = 'bold 100px serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.shadowColor = '#ff0040'; x.shadowBlur = 20; x.fillText('☠', 64, 70);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); sp.scale.set(0.7, 0.7, 0.7); sp.position.y = 2.9; g.add(sp);
        const r = new THREE.Mesh(this.G.plane, add(0xff3a5a, 0.5)); r.material.map = this.ringTexture; r.rotation.x = -Math.PI / 2; r.position.y = 0.08; g.add(r);
        g.userData.pulse2 = r; return g; }
      case 'spirit': {
        const core = new THREE.Mesh(this.G.sphereLo, new THREE.MeshBasicMaterial({ color: 0xffe8b0 })); core.scale.setScalar(0.28); g.add(core);
        const h = new THREE.Mesh(this.G.sphereLo, add(0xff8a2a, 0.45)); h.scale.setScalar(0.6); g.add(h);
        for (const s of [-1, 1]) { const horn = new THREE.Mesh(this.G.cone, add(0xffb03a, 0.7)); horn.scale.set(0.1, 0.4, 0.1); horn.position.set(s * 0.25, 0.35, 0); horn.rotation.z = -s * 0.5; g.add(horn); }
        const L = new THREE.PointLight(0xff8a3a, 10, 8, 2); g.add(L);
        g.userData.spirit = true; return g; }
      case 'berserk': {
        const r = new THREE.Mesh(this.G.plane, add(0xff2a1a, 0.55)); r.material.map = this.ringTexture; r.rotation.x = -Math.PI / 2; r.position.y = 0.07; r.scale.setScalar(1.3); g.add(r);
        const L = new THREE.PointLight(0xff3a1a, 8, 7, 2); L.position.y = 1.3; g.add(L);
        g.userData.pulse2 = r; return g; }
      case 'undying': {
        const s = new THREE.Mesh(this.G.sphere, add(0xa01020, 0.14)); s.scale.setScalar(1.35); s.position.y = 1.15; g.add(s);
        g.userData.pulse = s; return g; }
      case 'lifesteal': return g;
      case 'healred': case 'speed': case 'slow': case 'dot': case 'dot_holy': case 'stoneskin': case 'stealth': return g; // particle-only
    }
    return null;
  }

  updateBuffFx(key, fx, pos, dt, t, f, ch) {
    fx.position.set(pos.x, pos.y, pos.z);
    const u = fx.userData, b = this.budget;
    if (u.spin) { u.spin.rotation.y += dt * 1.5; u.spin.rotation.z += dt * 0.7; }
    if (u.spin2) u.spin2.rotation.y -= dt * 1.2;
    if (u.pulse) u.pulse.material.opacity = 0.12 + Math.sin(t * 3) * 0.04;
    if (u.stars) fx.children.forEach((s, i) => { const a = t * 4 + i * (Math.PI * 2 / fx.children.length); s.position.set(Math.sin(a) * 0.4, 2.35 + Math.sin(t * 6 + i) * 0.05, Math.cos(a) * 0.4); s.rotation.y += dt * 4; });
    if (u.pulse2) { const s = 1 + Math.sin(t * 6) * 0.15; u.pulse2.scale.set(s, s, s); }
    if (u.spirit) {
      const a = t * 1.6;
      fx.position.set(pos.x + Math.sin(a) * 1.2, pos.y + 2.4 + Math.sin(t * 3) * 0.2, pos.z + Math.cos(a) * 1.2);
      if (Math.random() < dt * 40 * b) this.glow.emit({ x: fx.position.x + (Math.random() - 0.5) * 0.3, y: fx.position.y, z: fx.position.z + (Math.random() - 0.5) * 0.3, vy: 1.5, life: 0.5, size: 0.45, color: Math.random() < 0.5 ? 0xff6a1a : 0xffc04a, grow: -0.8 });
    }
    const R = (s) => ({ x: pos.x + (Math.random() - 0.5) * s, z: pos.z + (Math.random() - 0.5) * s });
    if (key === 'speed' && Math.random() < dt * 25 * b) { const p = R(0.6); this.glow.emit({ x: p.x, y: pos.y + 0.2 + Math.random() * 1.6, z: p.z, life: 0.4, size: 0.25, color: f.cls === 'rogue' ? 0xa36bff : f.cls === 'priest' ? 0xfff2c0 : 0xc8fff0, grow: -0.5 }); }
    if (key === 'slow' && Math.random() < dt * 8 * b) { const p = R(0.8); this.glow.emit({ x: p.x, y: pos.y + Math.random() * 1.8, z: p.z, vy: -0.3, life: 0.8, size: 0.18, color: 0xbfefff }); }
    if (key === 'dot' && Math.random() < dt * 14 * b) { const p = R(0.7); this.glow.emit({ x: p.x, y: pos.y + 0.5 + Math.random() * 1.4, z: p.z, vy: 1.4, life: 0.5, size: 0.35, color: Math.random() < 0.5 ? 0xff7a2a : 0xffc04a, grow: -0.6 }); if (Math.random() < 0.3) this.smoke.emit({ x: p.x, y: pos.y + 1.6, z: p.z, vy: 0.8, life: 0.8, size: 0.5, color: 0x2a2020, grow: 1, alpha: 0.35 }); }
    if (key === 'dot_holy' && Math.random() < dt * 10 * b) { const p = R(0.7); this.glow.emit({ x: p.x, y: pos.y + 0.4 + Math.random() * 1.4, z: p.z, vy: 1.0, life: 0.6, size: 0.3, color: 0xffe680, grow: -0.6 }); }
    if (key === 'healred' && Math.random() < dt * 4 * b) { const p = R(0.6); this.glow.emit({ x: p.x, y: pos.y + 0.8 + Math.random(), z: p.z, vy: -0.6, life: 0.6, size: 0.25, color: 0xff2a2a }); }
    if (key === 'stoneskin' && Math.random() < dt * 6 * b) { const p = R(0.8); this.glow.emit({ x: p.x, y: pos.y + Math.random() * 1.8, z: p.z, vy: 0.5, life: 0.7, size: 0.2, color: 0xb0e080 }); }
    if (key === 'stealth' && Math.random() < dt * 6 * b && ch.opacity > 0.05) { const p = R(0.6); this.smoke.emit({ x: p.x, y: pos.y + Math.random() * 1.6, z: p.z, vy: 0.3, life: 0.9, size: 0.6, color: 0x1a1024, grow: 1, alpha: 0.3 }); }
    if (key === 'berserk' && Math.random() < dt * 45 * b) { const p = R(0.8); this.glow.emit({ x: p.x, y: pos.y + 0.3 + Math.random() * 1.8, z: p.z, vy: 2.2, life: 0.55, size: 0.4, color: Math.random() < 0.6 ? 0xff2a1a : 0xff8a3a, grow: -0.7 }); }
    if (key === 'lifesteal' && Math.random() < dt * 12 * b) { const p = R(1.6); this.glow.emit({ x: p.x, y: pos.y + 0.6 + Math.random(), z: p.z, vx: (pos.x - p.x) * 2, vy: 0.4, vz: (pos.z - p.z) * 2, life: 0.5, size: 0.22, color: 0xc0102a }); }
    if (key === 'tempest' && Math.random() < dt * 60 * b) { const a = Math.random() * 6.28; this.glow.emit({ x: pos.x + Math.sin(a) * 2.2, y: pos.y + 0.6 + Math.random() * 1.2, z: pos.z + Math.cos(a) * 2.2, vx: Math.cos(a) * 6, vz: -Math.sin(a) * 6, life: 0.25, size: 0.35, color: 0xfff0d0, grow: -0.5, drag: 3 }); }
  }

  disposeObj(o) {
    const shared = Object.values(this.G);
    o.traverse(c => { if (c.material && c.material.dispose) c.material.dispose(); if (c.geometry && !shared.includes(c.geometry)) c.geometry.dispose(); });
  }

  clearAll() {
    for (const [, m] of this.projMeshes) this.scene.remove(m); this.projMeshes.clear();
    for (const [, m] of this.zoneMeshes) this.scene.remove(m); this.zoneMeshes.clear();
    for (const [, map] of this.buffFx) { for (const [, m] of map) this.scene.remove(m); } this.buffFx.clear();
    for (const [, g] of this.castFx) this.scene.remove(g); this.castFx.clear();
    for (const e of this.effects) this.scene.remove(e.obj); this.effects = [];
    this.glow.clear(); this.smoke.clear();
  }

  // ---------------------------------------------------------------- event-driven impacts
  // ctx: { fighters (view), chars, focus(id) -> Vector3 }
  onEvent(ev, ctx) {
    const F = ctx.fighters;
    const at = id => F[id] ? new THREE.Vector3(F[id].x, F[id].y, F[id].z) : new THREE.Vector3();
    const handPos = id => ctx.focus(id);
    switch (ev.e) {
      case 'caststart': {
        const p = handPos(ev.id);
        const c = { frost_lance: 0x8fd8ff, arcane_comet: 0xc07aff, sacred_bolt: 0xffe070, mend: 0x8aff9a, lightning_lash: 0x7ae0ff }[ev.ab] || 0xffffff;
        this.burst(p.x, p.y, p.z, c, 14, 2, 0.5, 0.35);
        break; }
      case 'ab': this.abilityFx(ev, ctx, at, handPos); break;
      case 'auto': this.autoFx(ev, ctx, at, handPos); break;
      case 'hit': this.hitFx(ev); break;
      case 'fizzle': this.burst(ev.x, ev.y, ev.z, 0x888888, 10, 2, 0.4, 0.3); this.smokeBurst(ev.x, ev.y, ev.z, 0x444444, 4, 1, 0.6, 0.5, 0.3); break;
      case 'dmg': {
        const P = at(ev.id);
        const meleeAb = ev.ab === 'auto' ? !!(F[ev.src] && ['rogue', 'warrior', 'berserker'].includes(F[ev.src].cls)) : ['viper_strike', 'rending_blow', 'crippling_slash', 'gutting_edge', 'steel_tempest', 'skull_crack', 'shield_slam', 'rending_axes', 'headtaker', 'skullsplitter', 'ground_breaker', 'envenom', 'crippling_poison', 'execute', 'bladestorm'].includes(ev.ab);
        if (meleeAb) {
          this.burst(P.x, P.y + 1.2, P.z, [0xff3a2a, 0xffe0c0], ev.crit || ev.big ? 26 : 10, 5, 0.35, 0.28, { gravity: 9 });
          const src = F[ev.src];
          const col = src?.cls === 'rogue' ? (ev.ab === 'gutting_edge' ? 0xffcf4a : 0x9be36a) : ev.ab === 'shield_slam' ? 0x9ec0ff : 0xfff0d8;
          this.slashArc(P, src, col, ev.crit || ev.big);
        }
        if (ev.crit) { this.sphereFlash(P.x, P.y + 1.2, P.z, 0xfff0c0, 0.3, 1.5, 0.22, 0.55); this.ringBurst(P.x, P.y + 1.2, P.z, 0xffe0a0, 16, 6, 0.3, 0.3); this.flash(P.x, P.y + 1.4, P.z, 0xffe0a0, 25, 0.2); }
        if (ev.abs > 0 && !ev.amt) this.burst(P.x, P.y + 1.1, P.z, 0x9ac8ff, 8, 3, 0.4, 0.3);
        break; }
      case 'heal': { const P = at(ev.id); if (ev.amt > 30) { this.spiral(P.x, P.y + 0.1, P.z, ev.crit ? 0xfff0a0 : 0x8aff9a, 30, 0.8, 2.2, 0.9, 0.3); this.burst(P.x, P.y + 1, P.z, [0x8aff9a, 0xffffff], 14, 1.5, 1.0, 0.3, { up: 2, drag: 1 }); } break; }
      case 'blink': {
        const c = { arcane_shift: 0xc69bff, shadow_leap: 0x7a3aff }[ev.fx] || 0xffffff;
        this.burst(ev.x0, 1, ev.z0, [c, 0xffffff], 40, 5, 0.6, 0.5);
        this.burst(ev.x1, 1, ev.z1, [c, 0xffffff], 40, 5, 0.6, 0.5);
        this.groundRing(ev.x1, ev.z1, c, 0.3, 2.5, 0.4);
        if (ev.fx === 'shadow_leap') { this.smokeBurst(ev.x0, 1, ev.z0, 0x140a20, 14, 2, 0.9, 1.0, 0.7); this.smokeBurst(ev.x1, 1, ev.z1, 0x140a20, 14, 2, 0.9, 1.0, 0.7); }
        for (let i = 0; i < 20; i++) { const u = i / 20; this.glow.emit({ x: ev.x0 + (ev.x1 - ev.x0) * u, y: 1 + Math.random() * 0.6, z: ev.z0 + (ev.z1 - ev.z0) * u, life: 0.4, size: 0.4, color: c }); }
        break; }
      case 'dash': { const P = at(ev.id); if (ev.fx === 'blazing_step') { this.burst(P.x, P.y + 0.8, P.z, [0xff7a1a, 0xffd080], 26, 4, 0.5, 0.45, { up: 1 }); this.flash(P.x, P.y + 1, P.z, 0xff7a1a, 25, 0.3); this.groundRing(P.x, P.z, 0xff7a1a, 0.3, 2.4, 0.35, (P.y || 0) + 0.08); break; } this.groundRing(P.x, P.z, ev.fx === 'bull_rush' ? 0xffb04a : 0xc8fff0, 0.3, 2.2, 0.35); this.smokeBurst(P.x, 0.3, P.z, 0x8a7a60, 8, 2, 0.6, 0.8, 0.4); break; }
      case 'interrupted': { const P = at(ev.id); this.burst(P.x, P.y + 1.8, P.z, [0xff4a3a, 0xffffff], 22, 4, 0.5, 0.35); this.groundRing(P.x, P.z, 0xff4a3a, 0.5, 2, 0.3); break; }
      case 'castfail': { const P = at(ev.id); this.burst(P.x, P.y + 1.5, P.z, 0x888888, 8, 2, 0.4, 0.25); break; }
      case 'death': {
        const P = at(ev.id);
        this.burst(P.x, P.y + 1, P.z, [0xffffff, 0xffd080], 50, 6, 1.4, 0.5, { up: 1, drag: 1.2 });
        this.smokeBurst(P.x, 0.3, P.z, 0x6a5a48, 18, 3, 1.2, 1.4, 0.5);
        this.groundRing(P.x, P.z, 0xffd080, 0.5, 6, 1.0);
        // a soul wisp rising from the fallen
        const w = new THREE.Mesh(this.G.sphereLo, this.addMat(0xcfe8ff, 0.7)); w.scale.setScalar(0.25); w.position.set(P.x, 1.2, P.z);
        this.addEffect(w, 2.2, (u) => { w.position.y = 1.2 + u * 5; w.position.x = P.x + Math.sin(u * 9) * 0.4; w.material.opacity = 0.7 * (1 - u); if (Math.random() < 0.5) this.glow.emit({ x: w.position.x, y: w.position.y, z: w.position.z, life: 0.5, size: 0.25, color: 0xcfe8ff }); });
        break; }
      case 'buff': {
        const P = at(ev.id);
        if (ev.type === 'stealth') { this.smokeBurst(P.x, P.y + 1, P.z, 0x1a1024, 22, 3, 1.0, 1.1, 0.75); this.burst(P.x, P.y + 1, P.z, 0x7a5aaa, 20, 3, 0.7, 0.4); }
        if (ev.type === 'stun') { this.burst(P.x, P.y + 2.2, P.z, 0xffe060, 16, 3, 0.4, 0.3); }
        if (ev.type === 'root') { this.burst(P.x, P.y + 0.3, P.z, [0xbfefff, 0xffffff], 24, 3, 0.6, 0.35, { flat: true }); this.shards(P.x, 0.4, P.z, 0xbfefff, 6, 3, 0.8, 0.15); }
        if (ev.type === 'disorient') this.burst(P.x, P.y + 2, P.z, 0xffffff, 20, 2, 0.6, 0.3);
        if (ev.type === 'silence') this.groundRing(P.x, P.z, 0x9ec0ff, 0.4, 1.6, 0.4, 2.5);
        break; }
      case 'cleanse': { const P = at(ev.id); this.burst(P.x, P.y + 1, P.z, [0xffffff, 0xfff6c0], 20, 3, 0.6, 0.3, { up: 1 }); break; }
      case 'immune': { const P = at(ev.id); this.sphereFlash(P.x, P.y + 1.1, P.z, 0xffffff, 1, 1.6, 0.3, 0.3); break; }
      case 'fx': this.namedFx(ev, ctx, at); break;
    }
  }

  slashArc(P, src, color, big) {
    if (!src) return;
    const a = Math.atan2(P.x - src.x, P.z - src.z);
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, big ? 1.45 : 1.2, 24, 1, -1.2, 2.4), this.addMat(color, 0.7));
    m.position.set(P.x - Math.sin(a) * 0.4, P.y + 1.2, P.z - Math.cos(a) * 0.4);
    m.rotation.order = 'YXZ'; m.rotation.y = a; m.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 1.2;
    this.addEffect(m, big ? 0.26 : 0.18, (u) => { m.material.opacity = 0.95 * (1 - u); m.scale.setScalar(1 + u * 0.5); });
  }

  autoFx(ev, ctx, at, handPos) {
    const F = ctx.fighters, src = F[ev.id]; if (!src) return;
    if (ev.ranged) {
      const p = handPos(ev.id);
      const c = { mage: 0xb98cff, priest: 0xffe680, shaman: 0x7ae0ff }[src.cls] || 0xffffff;
      this.burst(p.x, p.y, p.z, [c, 0xffffff], 16, 3, 0.35, 0.3, { drag: 3 }); this.sphereFlash(p.x, p.y, p.z, c, 0.1, 0.55, 0.16, 0.45);
      if (src.cls === 'shaman') { const T = at(ev.tid); this.beam(p.clone(), new THREE.Vector3(p.x + (T.x - p.x) * 0.15, p.y, p.z + (T.z - p.z) * 0.15), 0x7ae0ff, 0.12, 0.03, 0.4); }
    } else {
      // weapon trail sparks for melee swings
      const ch = ctx.chars[ev.id];
      if (ch && ch.weaponTipWorld) { const tp = ch.weaponTipWorld(V3); this.burst(tp.x, tp.y, tp.z, src.cls === 'rogue' ? 0x9be36a : 0xffc88a, 6, 1.5, 0.25, 0.2); }
    }
  }

  hitFx(ev) {
    const c = PROJ_STYLE[ev.kind]?.color ?? 0xffffff;
    switch (ev.kind) {
      case 'arcane_comet':
        this.burst(ev.x, ev.y, ev.z, [0xc07aff, 0xffffff, 0x7a5aff], 60, 12, 0.8, 0.6, { drag: 2.5 });
        this.groundRing(ev.x, ev.z, 0xb46aff, 0.5, 8, 0.7); this.sphereFlash(ev.x, ev.y, ev.z, 0xc07aff, 0.5, 3.8, 0.45);
        this.flash(ev.x, ev.y + 1, ev.z, 0xb46aff, 70, 0.5); this.pillar(ev.x, ev.z, 0xc07aff, 9, 0.7, 0.45);
        this.smokeBurst(ev.x, 0.5, ev.z, 0x2a1a40, 16, 4, 1.1, 1.6, 0.5); this.shards(ev.x, 0.6, ev.z, 0x9a6aff, 10, 6, 1.2, 0.25);
        break;
      case 'frost_lance': case 'frostbite':
        this.burst(ev.x, ev.y, ev.z, [0x8fd8ff, 0xffffff], 28, 6, 0.5, 0.4, { gravity: 6 }); this.flash(ev.x, ev.y, ev.z, 0x8fd8ff, 25, 0.25);
        this.shards(ev.x, ev.y, ev.z, 0xbfefff, 7, 5, 0.9, 0.18); this.smokeBurst(ev.x, ev.y, ev.z, 0xcfe8ff, 6, 1.5, 0.9, 0.9, 0.3);
        break;
      case 'flame_burst': case 'magma_burst': case 'spirit_bolt': case 'fireball': case 'fire_bolt': {
        const big = ev.kind !== 'spirit_bolt' && ev.kind !== 'fire_bolt';
        this.burst(ev.x, ev.y, ev.z, [0xff7a1a, 0xffd080, 0xff3a0a], big ? 40 : 16, big ? 7 : 4, 0.55, big ? 0.6 : 0.4, { up: 1.5 });
        this.sphereFlash(ev.x, ev.y, ev.z, 0xff8a2a, 0.2, big ? 1.8 : 1, 0.3, 0.6);
        if (big) { this.smokeBurst(ev.x, ev.y, ev.z, 0x2a1a14, 10, 2, 1.2, 1.2, 0.55); this.burst(ev.x, ev.y, ev.z, 0xffb040, 12, 6, 0.9, 0.12, { gravity: 9, drag: 0.5, grow: 0 }); }
        if (ev.kind === 'magma_burst') this.shards(ev.x, ev.y, ev.z, 0x5a2a10, 6, 5, 1.0, 0.22);
        this.flash(ev.x, ev.y, ev.z, 0xff7a1a, big ? 40 : 18, 0.3);
        break; }
      case 'sacred_bolt':
        this.burst(ev.x, ev.y, ev.z, [0xffe070, 0xffffff], 26, 5, 0.5, 0.45); this.sphereFlash(ev.x, ev.y, ev.z, 0xffe080, 0.2, 1.4, 0.3);
        this.lightRays(ev.x, ev.y - 1.2, ev.z, 0xfff0a0, 3, 4, 0.5); this.flash(ev.x, ev.y, ev.z, 0xffe070, 25, 0.25);
        break;
      case 'shadow_bolt': case 'mind_blast': { const big = ev.kind === 'mind_blast'; this.burst(ev.x, ev.y, ev.z, [0xa060ff, 0x2a0a4a, 0xe8d0ff], big ? 36 : 20, big ? 6 : 5, 0.5, big ? 0.5 : 0.3, { drag: 3 }); this.smokeBurst(ev.x, ev.y, ev.z, 0x1a0a2a, big ? 8 : 3, 1.5, 0.8, 0.8, 0.5); this.flash(ev.x, ev.y, ev.z, 0xa060ff, big ? 30 : 14, 0.25); break; }
      case 'arcane_bolt': this.burst(ev.x, ev.y, ev.z, [0xb98cff, 0xffffff, 0x8a5aff], 22, 5, 0.4, 0.3, { drag: 3 }); this.sphereFlash(ev.x, ev.y, ev.z, 0xb98cff, 0.2, 1.1, 0.22, 0.5); this.flash(ev.x, ev.y, ev.z, 0xb98cff, 14, 0.2); break;
      case 'holy_spark': this.burst(ev.x, ev.y, ev.z, [0xffe680, 0xffffff], 22, 5, 0.4, 0.3, { drag: 3 }); this.sphereFlash(ev.x, ev.y, ev.z, 0xffe680, 0.2, 1.1, 0.22, 0.5); this.flash(ev.x, ev.y, ev.z, 0xffe680, 14, 0.2); break;
      case 'static_bolt': this.burst(ev.x, ev.y, ev.z, [0x7ae0ff, 0xffffff], 22, 6, 0.3, 0.26, { drag: 3 }); this.flash(ev.x, ev.y, ev.z, 0x7ae0ff, 14, 0.15); for (let i = 0; i < 3; i++) { const a = new THREE.Vector3(ev.x, ev.y, ev.z); this.beam(a, a.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6)), 0x7ae0ff, 0.1, 0.02, 0.3); } break;
      default: this.burst(ev.x, ev.y, ev.z, [c, 0xffd080], 24, 6, 0.5, 0.5, { up: 1 }); this.flash(ev.x, ev.y, ev.z, c, 30, 0.3);
    }
  }

  abilityFx(ev, ctx, at, handPos) {
    const P = at(ev.id), T = ev.tid >= 0 ? at(ev.tid) : null;
    const hp = handPos(ev.id);
    switch (ev.ab) {
      case 'flame_burst': case 'fireball': this.burst(hp.x, hp.y, hp.z, [0xff7a1a, 0xffd080], 16, 4, 0.35, 0.4); this.smokeBurst(hp.x, hp.y, hp.z, 0x2a1a14, 4, 1, 0.6, 0.5, 0.4); break;
      case 'meteor': this.burst(hp.x, hp.y, hp.z, [0xff5a1a, 0xffd080], 30, 5, 0.5, 0.5, { up: 2 }); this.flash(hp.x, hp.y, hp.z, 0xff5a1a, 35, 0.4); this.pillar(P.x, P.z, 0xff6a1a, 6, 0.6, 0.5); break;
      case 'frostbite': this.burst(hp.x, hp.y, hp.z, 0xa8e4ff, 12, 3, 0.3, 0.3); break;
      case 'mana_ward': this.sphereFlash(P.x, P.y + 1.1, P.z, 0x6aa8ff, 0.5, 1.6, 0.4); this.ringBurst(P.x, P.y + 1, P.z, 0x9ac8ff, 24, 4, 0.5, 0.35); break;
      case 'arcane_comet': this.burst(hp.x, hp.y, hp.z, [0xc07aff, 0xffffff], 40, 6, 0.6, 0.6); this.flash(hp.x, hp.y, hp.z, 0xc07aff, 40, 0.4); this.groundRing(P.x, P.z, 0xc07aff, 0.5, 4, 0.5); break;
      case 'frost_lance': this.burst(hp.x, hp.y, hp.z, 0x8fd8ff, 14, 3, 0.35, 0.35); break;
      case 'skull_crack': if (T) { this.burst(T.x, T.y + 1.9, T.z, [0xffd27a, 0xffffff], 30, 5, 0.4, 0.4); this.sphereFlash(T.x, T.y + 1.9, T.z, 0xffd27a, 0.2, 1.0, 0.25); } break;
      case 'death_mark': if (T) { this.pillar(T.x, T.z, 0xff2a4a, 6, 0.9, 0.6); this.burst(T.x, T.y + 1.5, T.z, [0xff2a4a, 0x3a0010], 40, 4, 0.7, 0.5); this.smokeBurst(T.x, T.y + 1, T.z, 0x2a0010, 12, 2, 1.0, 1.0, 0.6); } break;
      case 'iron_bulwark': this.ringBurst(P.x, P.y + 1, P.z, 0xe8f0ff, 30, 5, 0.5, 0.4); this.flash(P.x, P.y + 1.5, P.z, 0xc8d8ff, 30, 0.4); this.groundRing(P.x, P.z, 0xc8d8ff, 0.5, 3, 0.4); break;
      case 'shield_slam': if (T) { this.burst(T.x, T.y + 1.4, T.z, [0x9ec0ff, 0xffffff], 30, 6, 0.4, 0.4); this.sphereFlash(T.x, T.y + 1.4, T.z, 0x9ec0ff, 0.3, 1.4, 0.25); } break;
      case 'steel_tempest': this.groundRing(P.x, P.z, 0xffe0a0, 1, 7, 0.5); this.smokeBurst(P.x, 0.3, P.z, 0x8a7a60, 14, 4, 0.8, 1.2, 0.4); break;
      case 'sacred_bolt': this.burst(hp.x, hp.y, hp.z, 0xffe070, 16, 3, 0.4, 0.35); break;
      case 'mend': {
        const A = T || P;
        this.pillar(A.x, A.z, 0x8aff9a, 5, 1.0, 0.9); this.lightRays(A.x, 0, A.z, 0xc8ffb0, 4, 6, 0.9);
        this.spiral(A.x, 0.1, A.z, 0x8aff9a, 40, 1.0, 3, 1.1, 0.35); this.flash(A.x, A.y + 2, A.z, 0x8aff9a, 30, 0.6);
        this.groundRing(A.x, A.z, 0x8aff9a, 0.4, 2.5, 0.8);
        break; }
      case 'divine_aegis': { const A = T || P; this.sphereFlash(A.x, A.y + 1.1, A.z, 0xffe08a, 0.4, 1.6, 0.4); this.ringBurst(A.x, A.y + 1.1, A.z, 0xfff0b0, 20, 3, 0.5, 0.3); break; }
      case 'seraph_step': this.burst(P.x, P.y + 1.5, P.z, [0xffffff, 0xd8f4ff], 50, 4, 0.8, 0.45, { up: 1 }); this.lightRays(P.x, 0, P.z, 0xd8f4ff, 2, 3.5, 0.5); break;
      case 'magma_burst': this.burst(hp.x, hp.y, hp.z, [0xff5a1a, 0xffb050], 16, 4, 0.4, 0.4); break;
      case 'quake_totem': this.burst(P.x, 0.2, P.z, 0xc9a070, 20, 4, 0.6, 0.5, { flat: true, gravity: 5 }); this.smokeBurst(P.x, 0.2, P.z, 0x7a6a50, 10, 3, 0.8, 1.2, 0.5); break;
      case 'stoneskin_totem': this.burst(P.x, 0.2, P.z, [0xb0e080, 0x8a7a5a], 30, 3, 0.7, 0.45, { up: 2 }); this.smokeBurst(P.x, 0.2, P.z, 0x7a6a50, 8, 2, 0.8, 1.0, 0.4); break;
      case 'fire_spirit': this.pillar(P.x, P.z, 0xff8a2a, 6, 1, 0.7); this.burst(P.x, P.y + 2, P.z, [0xff8a2a, 0xffe0a0], 50, 5, 0.8, 0.6); this.smokeBurst(P.x, P.y + 1, P.z, 0x2a1a14, 10, 2, 1.0, 1.2, 0.5); this.flash(P.x, P.y + 2, P.z, 0xff8a2a, 50, 0.6); break;
      case 'gale_dash': this.burst(P.x, P.y + 0.6, P.z, [0xc8fff0, 0xffffff], 30, 4, 0.5, 0.45); this.groundRing(P.x, P.z, 0xc8fff0, 0.3, 3, 0.4); break;
      case 'bull_rush': this.burst(P.x, 0.3, P.z, 0xc9a070, 20, 3, 0.5, 0.5, { flat: true }); break;
      case 'fade': break;
    }
  }

  namedFx(ev, ctx, at) {
    switch (ev.fx) {
      case 'glacial_nova':
        this.groundRing(ev.x, ev.z, 0xbfefff, 0.5, 9, 0.6);
        this.ringBurst(ev.x, 0.5, ev.z, 0xbfefff, 60, 16, 0.6, 0.6);
        this.burst(ev.x, 0.8, ev.z, [0xffffff, 0x8fd8ff], 40, 10, 0.6, 0.5, { flat: true });
        this.shards(ev.x, 0.5, ev.z, 0xcff4ff, 14, 9, 1.0, 0.25);
        this.smokeBurst(ev.x, 0.4, ev.z, 0xdff4ff, 14, 6, 1.2, 1.4, 0.3);
        this.flash(ev.x, 1.5, ev.z, 0x8fd8ff, 60, 0.5);
        break;
      case 'blinding_light':
        this.sphereFlash(ev.x, 1.2, ev.z, 0xfff6c0, 0.5, 6, 0.4, 0.35);
        this.ringBurst(ev.x, 1, ev.z, 0xfff6c0, 60, 18, 0.5, 0.6);
        this.lightRays(ev.x, 0, ev.z, 0xfff6c0, 6, 9, 0.6);
        this.flash(ev.x, 2, ev.z, 0xfff6c0, 90, 0.5);
        break;
      case 'halo_judgment': {
        const m = new THREE.Mesh(this.G.torus, this.addMat(0xffd24a, 1));
        m.rotation.x = Math.PI / 2; m.position.set(ev.x, 1.2, ev.z);
        this.addEffect(m, 0.8, (u) => { const r = 1 + u * 26; m.scale.set(r, r, 1 + u * 3); m.material.opacity = 1 - u; });
        this.flash(ev.x, 2, ev.z, 0xffd24a, 80, 0.7);
        const T = at(ev.tid); this.pillar(T.x, T.z, 0xffd24a, 12, 1.2, 0.7); this.lightRays(T.x, 0, T.z, 0xffe680, 4, 10, 0.7); this.burst(T.x, T.y + 1, T.z, [0xffd24a, 0xffffff], 50, 6, 0.7, 0.5);
        this.pillar(ev.x, ev.z, 0xfff6c0, 8, 1.0, 0.7);
        break; }
      case 'quake_erupt':
        this.groundRing(ev.x, ev.z, 0xff9a4a, 1, 9, 0.6);
        this.burst(ev.x, 0.3, ev.z, [0x8a6a4a, 0xc9a070, 0xff8a3a], 80, 12, 0.9, 0.7, { up: 4, gravity: 14 });
        this.smokeBurst(ev.x, 0.3, ev.z, 0x6a5a48, 24, 7, 1.4, 2.0, 0.6);
        this.flash(ev.x, 1, ev.z, 0xff9a4a, 70, 0.5);
        this.shards(ev.x, 0.3, ev.z, 0x6a5a4a, 12, 8, 1.3, 0.45);
        break;
      case 'shadow_touch': { const T = ev.tid >= 0 ? at(ev.tid) : null; if (T) { this.smokeBurst(T.x, T.y + 1.2, T.z, 0x2a0a4a, 10, 1.5, 0.9, 1.0, 0.6); this.burst(T.x, T.y + 1.4, T.z, [0xa060ff, 0x3a0a6a], 18, 3, 0.6, 0.4); } break; }
      case 'psychic_scream': { const P = at(ev.id), y = P.y || 0;
        this.groundRing(ev.x, ev.z, 0xa060ff, 0.5, 8, 0.5, y + 0.08); this.ringBurst(P.x, y + 1.4, P.z, 0xb070ff, 30, 6, 0.6, 0.4);
        this.smokeBurst(P.x, y + 1, P.z, 0x1a0a2a, 16, 5, 1.0, 1.4, 0.5); this.flash(P.x, y + 1.5, P.z, 0x9a4aff, 40, 0.4); break; }
      case 'void_eruption': { const T = ev.tid >= 0 ? at(ev.tid) : null; if (T) {
        this.pillar(T.x, T.z, 0x7a3aff, 7, 0.9, 0.6); this.sphereFlash(T.x, T.y + 1.2, T.z, 0x9a4aff, 0.3, 2.8, 0.4, 0.6);
        this.burst(T.x, T.y + 1.2, T.z, [0x7a3aff, 0xe8d0ff, 0x1a0a2a], 60, 8, 0.8, 0.5, { up: 2 }); this.smokeBurst(T.x, T.y + 1, T.z, 0x1a0a2a, 18, 4, 1.2, 1.4, 0.6); this.flash(T.x, T.y + 1.5, T.z, 0x7a3aff, 60, 0.5); } break; }
      case 'flame_ring': {
        const P = at(ev.id), y = P.y || 0;
        this.groundRing(ev.x, ev.z, 0xff7a1a, 0.5, 8, 0.5, y + 0.08);
        for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; this.burst(ev.x + Math.sin(a) * 2.5, y + 0.4, ev.z + Math.cos(a) * 2.5, [0xff7a1a, 0xffd080], 3, 6, 0.5, 0.45, { up: 2 }); }
        this.flash(ev.x, y + 1, ev.z, 0xff7a1a, 45, 0.4);
        break; }
      case 'meteor_impact': {
        const y = ev.y || 0;
        this.groundRing(ev.x, ev.z, 0xff6a1a, 0.5, 6.5, 0.6, y + 0.08);
        this.burst(ev.x, y + 0.4, ev.z, [0xff5a1a, 0xffc060, 0x5a2a10], 90, 13, 0.9, 0.7, { up: 5, gravity: 14 });
        this.sphereFlash(ev.x, y + 0.8, ev.z, 0xff7a2a, 0.5, 4, 0.4, 0.6);
        this.smokeBurst(ev.x, y + 0.3, ev.z, 0x3a2418, 26, 7, 1.6, 2.2, 0.65);
        this.shards(ev.x, y + 0.3, ev.z, 0x3a2010, 14, 9, 1.3, 0.4);
        this.flash(ev.x, y + 1.5, ev.z, 0xff6a1a, 90, 0.6); this.pillar(ev.x, ev.z, 0xff8a3a, 7, 0.5, 0.5);
        break; }
      case 'ground_breaker': { // a fan of shattered ground in front of the executioner
        const fy = ev.yaw ?? 0;
        for (let i = 0; i < 7; i++) {
          const a = fy + (i / 6 - 0.5) * 2.0, r = 2 + Math.random() * 4.5, x = ev.x + Math.sin(a) * r, z = ev.z + Math.cos(a) * r;
          this.burst(x, 0.3, z, [0x8a6a4a, 0xd8b070], 10, 6, 0.6, 0.45, { up: 4, gravity: 14 });
          this.shards(x, 0.2, z, 0x5a4a3a, 2, 6, 1.0, 0.3);
        }
        const fx = ev.x + Math.sin(fy) * 3, fz = ev.z + Math.cos(fy) * 3;
        this.groundRing(fx, fz, 0xd8b070, 0.5, 4.5, 0.45);
        this.smokeBurst(fx, 0.3, fz, 0x6a5a48, 16, 5, 1.2, 1.8, 0.55);
        this.flash(fx, 1, fz, 0xffb070, 50, 0.4);
        break; }
      case 'skull_leap_land':
        this.groundRing(ev.x, ev.z, 0xff6a3a, 0.5, 6, 0.5);
        this.smokeBurst(ev.x, 0.3, ev.z, 0x5a4a3a, 18, 5, 1.1, 1.6, 0.55);
        this.burst(ev.x, 0.4, ev.z, [0x8a6a4a, 0xff8a3a], 40, 9, 0.7, 0.5, { up: 3, gravity: 14 });
        this.shards(ev.x, 0.3, ev.z, 0x5a4a3a, 9, 7, 1.1, 0.3);
        this.flash(ev.x, 1, ev.z, 0xff6a3a, 45, 0.4);
        break;
      case 'bull_rush_hit':
        this.burst(ev.x, 1, ev.z, [0xffb04a, 0xffffff], 40, 7, 0.5, 0.45); this.groundRing(ev.x, ev.z, 0xffb04a, 0.5, 4, 0.4); this.flash(ev.x, 1, ev.z, 0xffb04a, 40, 0.3);
        this.smokeBurst(ev.x, 0.3, ev.z, 0x8a7a60, 12, 4, 0.8, 1.2, 0.5);
        break;
      case 'death_mark_pop':
        this.burst(ev.x, 1.3, ev.z, [0xff2a4a, 0x2a0010, 0xffffff], 70, 9, 0.8, 0.6); this.sphereFlash(ev.x, 1.3, ev.z, 0xff2a4a, 0.3, 2.5, 0.4); this.flash(ev.x, 1.5, ev.z, 0xff2a4a, 60, 0.4);
        this.smokeBurst(ev.x, 1.2, ev.z, 0x200010, 18, 4, 1.2, 1.4, 0.7);
        break;
      case 'spirit_cast': break;
      case 'lightning_lash': {
        const a = ctx.focus(ev.id).clone(), T = at(ev.tid), b = new THREE.Vector3(T.x, T.y + 1.2, T.z);
        this.beam(a, b, 0x4ad8ff, 0.3, 0.06, 1.2, 2);
        this.beam(a, b, 0x9af0ff, 0.2, 0.03, 1.8);
        this.burst(b.x, b.y, b.z, [0x7ae0ff, 0xffffff], 30, 7, 0.4, 0.35);
        this.groundRing(T.x, T.z, 0x7ae0ff, 0.3, 2.5, 0.3);
        this.flash(b.x, b.y, b.z, 0x4ad8ff, 60, 0.3); this.flash(a.x, a.y, a.z, 0x4ad8ff, 30, 0.2);
        break; }
    }
  }

  update(dt) { this.glow.update(dt); this.smoke.update(dt); this.updateEffects(dt); }
}

export { SCHOOL_COLOR };
