// Spell & combat visual effects: a GPU particle pool, projectile visuals, ground
// telegraphs, lightning beams, shields/auras and per-ability impact effects.
import * as THREE from 'three';

const tmpC = new THREE.Color();
const PROJ_STYLE = {
  frost_lance: { color: 0x8fd8ff, core: 0xeaffff, size: 0.35, trail: 0x6ac8ff, stretch: 2.6 },
  flame_burst: { color: 0xff7a1a, core: 0xffe0a0, size: 0.4, trail: 0xff5a10 },
  arcane_comet: { color: 0xb46aff, core: 0xffe8ff, size: 1.0, trail: 0x9a5aff, big: true },
  sacred_bolt: { color: 0xffd860, core: 0xffffff, size: 0.38, trail: 0xffe890 },
  magma_burst: { color: 0xff5a1a, core: 0xffb050, size: 0.45, trail: 0xff3a0a, rock: true },
  spirit_bolt: { color: 0xff9a2a, core: 0xffe8b0, size: 0.28, trail: 0xff6a1a },
};
const SCHOOL_COLOR = { frost: 0x8fd8ff, fire: 0xff7a2a, arcane: 0xc07aff, holy: 0xffe070, nature: 0x7ae0ff, shadow: 0xa060ff, phys: 0xffffff };

function softTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.8)'); grd.addColorStop(0.6, 'rgba(255,255,255,0.2)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}
function ringTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 60, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.75, 'rgba(255,255,255,0.15)'); grd.addColorStop(0.92, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
function telegraphTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = 'white'; g.lineWidth = 8; g.beginPath(); g.arc(128, 128, 120, 0, 7); g.stroke();
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 124);
  grd.addColorStop(0, 'rgba(255,255,255,0.05)'); grd.addColorStop(1, 'rgba(255,255,255,0.35)');
  g.fillStyle = grd; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill();
  return new THREE.CanvasTexture(c);
}

export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.max = 6000;
    this.count = 0;
    this.p = []; // particle data
    const geo = new THREE.BufferGeometry();
    this.aPos = new Float32Array(this.max * 3);
    this.aCol = new Float32Array(this.max * 3);
    this.aSize = new Float32Array(this.max);
    this.aAlpha = new Float32Array(this.max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.aPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.aCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.pmat = new THREE.ShaderMaterial({
      uniforms: { map: { value: softTex() }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA;
        uniform float scale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.pmat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.effects = []; // timed mesh effects { obj, t, dur, update }
    this.projMeshes = new Map();
    this.zoneMeshes = new Map();
    this.buffFx = [new Map(), new Map()];
    this.ringTexture = ringTex();
    this.teleTexture = telegraphTex();
    this.softTexture = this.pmat.uniforms.map.value;
    this.lightPool = [];
    for (let i = 0; i < 4; i++) { const L = new THREE.PointLight(0xffffff, 0, 14, 2); scene.add(L); this.lightPool.push({ L, t: 0, dur: 1, peak: 0 }); }
    this.spirits = [null, null];
  }

  setScale(h) { this.pmat.uniforms.scale.value = h * 0.9; }

  // ---------------------------------------------------------------- particles
  emit(o) {
    if (this.p.length >= this.max) this.p.shift();
    tmpC.setHex(o.color ?? 0xffffff);
    this.p.push({ x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: o.life || 1, t: 0, size: o.size || 0.5, grow: o.grow ?? 0, r: tmpC.r, g: tmpC.g, b: tmpC.b, gravity: o.gravity || 0, drag: o.drag || 0, a: o.alpha ?? 1 });
  }
  burst(x, y, z, color, n, speed, life, size, o = {}) {
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + Math.random() * 0.6);
      let vx = s * Math.cos(th) * sp, vy = u * sp, vz = s * Math.sin(th) * sp;
      if (o.flat) vy = Math.abs(vy) * 0.2;
      if (o.up) vy = Math.abs(vy) + o.up;
      this.emit({ x, y, z, vx, vy, vz, life: life * (0.6 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.7), color: Array.isArray(color) ? color[i % color.length] : color, grow: o.grow ?? -0.5, gravity: o.gravity || 0, drag: o.drag ?? 1.5 });
    }
  }
  ringBurst(x, y, z, color, n, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.emit({ x, y, z, vx: Math.sin(a) * speed, vy: 0.3, vz: Math.cos(a) * speed, life, size, color, grow: -0.3, drag: 1.2 });
    }
  }

  updateParticles(dt) {
    const P = this.p;
    let w = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      q.t += dt;
      if (q.t >= q.life) continue;
      const dr = Math.max(0, 1 - q.drag * dt);
      q.vx *= dr; q.vy = q.vy * dr - q.gravity * dt; q.vz *= dr;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      const u = q.t / q.life;
      this.aPos[w * 3] = q.x; this.aPos[w * 3 + 1] = q.y; this.aPos[w * 3 + 2] = q.z;
      this.aCol[w * 3] = q.r; this.aCol[w * 3 + 1] = q.g; this.aCol[w * 3 + 2] = q.b;
      this.aSize[w] = Math.max(0.01, q.size * (1 + q.grow * u));
      this.aAlpha[w] = q.a * (u < 0.1 ? u / 0.1 : 1 - (u - 0.1) / 0.9);
      P[w] = q; w++;
    }
    P.length = w;
    const geo = this.points.geometry;
    geo.setDrawRange(0, w);
    for (const k of ['position', 'color', 'size', 'alpha']) geo.attributes[k].needsUpdate = true;
  }

  // ---------------------------------------------------------------- mesh effects
  addEffect(obj, dur, update) { this.scene.add(obj); this.effects.push({ obj, t: 0, dur, update }); return obj; }

  groundRing(x, z, color, r0, r1, dur, y = 0.08, opacity = 1) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.ringTexture, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
    this.addEffect(m, dur, (u) => { const r = r0 + (r1 - r0) * (1 - Math.pow(1 - u, 2)); m.scale.set(r, r, r); m.material.opacity = opacity * (1 - u); });
  }
  sphereFlash(x, y, z, color, r0, r1, dur, opacity = 0.6) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity }));
    m.position.set(x, y, z);
    this.addEffect(m, dur, (u) => { const r = r0 + (r1 - r0) * u; m.scale.setScalar(r); m.material.opacity = opacity * (1 - u); });
  }
  pillar(x, z, color, h, r, dur) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7, side: THREE.DoubleSide }));
    m.position.set(x, h / 2, z);
    this.addEffect(m, dur, (u) => { m.scale.set(1 - u * 0.7, 1, 1 - u * 0.7); m.material.opacity = 0.7 * (1 - u); });
  }
  beam(a, b, color, dur = 0.25, width = 0.08, jag = 0.5) {
    // jagged lightning built from a tube along random midpoints
    const pts = [];
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const p = new THREE.Vector3().lerpVectors(a, b, u);
      if (i > 0 && i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * jag, (Math.random() - 0.5) * jag, (Math.random() - 0.5) * jag));
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const core = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, width, 5), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glowM = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, width * 4, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    const g = new THREE.Group(); g.add(core, glowM);
    this.addEffect(g, dur, (u) => { core.material.opacity = 1 - u; glowM.material.opacity = 0.45 * (1 - u); });
  }
  flash(x, y, z, color, peak = 40, dur = 0.35) {
    const slot = this.lightPool.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
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
        e.obj.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
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
        const core = new THREE.Mesh(st.rock ? new THREE.DodecahedronGeometry(st.size * 0.6) : new THREE.SphereGeometry(st.size * 0.5, 12, 10), st.rock ? new THREE.MeshStandardMaterial({ color: 0x3a2010, emissive: 0xff4a0a, emissiveIntensity: 1.5 }) : new THREE.MeshBasicMaterial({ color: st.core }));
        const halo = new THREE.Mesh(new THREE.SphereGeometry(st.size, 14, 10), new THREE.MeshBasicMaterial({ color: st.color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
        g.add(core, halo);
        if (st.stretch) { core.scale.set(0.6, 0.6, st.stretch); halo.scale.set(0.7, 0.7, st.stretch * 0.8); }
        if (st.big) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(st.size * 1.3, 0.06, 6, 24), new THREE.MeshBasicMaterial({ color: st.color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
          g.add(ring); g.userData.ring = ring;
        }
        g.position.set(p.x, p.y, p.z);
        g.userData.prev = new THREE.Vector3(p.x, p.y, p.z);
        this.scene.add(g); this.projMeshes.set(p.id, g); m = g;
      }
      const prev = m.userData.prev;
      m.position.set(p.x, p.y, p.z);
      const dx = p.x - prev.x, dy = p.y - prev.y, dz = p.z - prev.z;
      if (dx * dx + dy * dy + dz * dz > 1e-6) m.lookAt(p.x + dx, p.y + dy, p.z + dz);
      if (m.userData.ring) { m.userData.ring.rotation.x += dt * 6; m.userData.ring.rotation.y += dt * 4; }
      m.rotation.z += dt * 8;
      // trail
      const steps = st.big ? 6 : 3;
      for (let k = 0; k < steps; k++) {
        const u = k / steps;
        this.emit({ x: prev.x + dx * u + (Math.random() - 0.5) * st.size * 0.6, y: prev.y + dy * u + (Math.random() - 0.5) * st.size * 0.6, z: prev.z + dz * u + (Math.random() - 0.5) * st.size * 0.6, vx: (Math.random() - 0.5), vy: (Math.random() - 0.5), vz: (Math.random() - 0.5), life: st.big ? 0.8 : 0.4, size: st.size * (st.big ? 2.2 : 1.6), color: k % 2 ? st.trail : st.color, grow: -0.7, drag: 2 });
      }
      prev.set(p.x, p.y, p.z);
    }
    for (const [id, m] of this.projMeshes) if (!seen.has(id)) { this.scene.remove(m); m.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); this.projMeshes.delete(id); }
  }

  // ---------------------------------------------------------------- zones (totems & telegraphs)
  syncZones(list, dt) {
    const seen = new Set();
    for (const z of list) {
      seen.add(z.id);
      let m = this.zoneMeshes.get(z.id);
      if (!m) { m = this.makeZone(z); this.scene.add(m); this.zoneMeshes.set(z.id, m); }
      const u = Math.min(1, z.t / z.dur);
      if (z.type === 'quake') {
        m.userData.fill.scale.setScalar(z.r * u);
        m.userData.fill.material.opacity = 0.25 + u * 0.35;
        m.userData.totem.position.y = Math.min(0, -1.5 + z.t * 8);
        if (Math.random() < 0.3) this.emit({ x: z.x + (Math.random() - 0.5) * z.r * 1.6, y: 0.1, z: z.z + (Math.random() - 0.5) * z.r * 1.6, vy: 1 + Math.random() * 2, life: 0.5, size: 0.4, color: 0xc9a070, gravity: 4 });
      } else if (z.type === 'stoneskin') {
        m.userData.dome.material.opacity = 0.1 + Math.sin(z.t * 4) * 0.03;
        m.userData.ring.rotation.z += dt * 0.5;
        m.userData.totem.position.y = Math.min(0, -1.5 + z.t * 8);
        if (Math.random() < 0.4) { const a = Math.random() * 6.28, r = Math.random() * z.r; this.emit({ x: z.x + Math.sin(a) * r, y: 0.1, z: z.z + Math.cos(a) * r, vy: 1.2, life: 1.2, size: 0.3, color: 0xb0e080 }); }
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
    const gl = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: glyphColor, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false })); gl.position.y = 2.4; g.add(gl);
    return g;
  }

  makeZone(z) {
    const g = new THREE.Group(); g.position.set(z.x, 0, z.z);
    if (z.type === 'quake') {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(2 * z.r, 2 * z.r), new THREE.MeshBasicMaterial({ map: this.teleTexture, color: 0xff9a4a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      edge.rotation.x = -Math.PI / 2; edge.position.y = 0.06; g.add(edge);
      const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0xff6a2a, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
      fill.rotation.x = -Math.PI / 2; fill.position.y = 0.07; g.add(fill);
      const totem = this.makeTotem(0x8a6a4a, 0xffa040); g.add(totem);
      g.userData = { fill, totem };
    } else if (z.type === 'stoneskin') {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(z.r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9ad070, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      g.add(dome);
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(2 * z.r, 2 * z.r), new THREE.MeshBasicMaterial({ map: this.teleTexture, color: 0x9ad070, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring);
      const totem = this.makeTotem(0x6a7a5a, 0xb0ff80); g.add(totem);
      g.userData = { dome, ring, totem };
    }
    return g;
  }

  // ---------------------------------------------------------------- persistent buff visuals
  syncBuffs(fighters, chars, dt, time) {
    for (const f of fighters) {
      const ch = chars[f.id]; if (!ch) continue;
      const map = this.buffFx[f.id];
      const want = new Set();
      const pos = ch.root.position;
      for (const b of f.buffs) {
        let key = null;
        if (b.type === 'absorb') key = b.fx || 'absorb';
        else if (['stun', 'root', 'disorient', 'silence', 'dr', 'tempest', 'mark', 'spirit', 'speed', 'stoneskin', 'slow'].includes(b.type)) key = b.type === 'dr' ? 'dr' : b.type;
        else if (b.type === 'dot') key = 'dot';
        if (!key) continue;
        want.add(key);
        let fx = map.get(key);
        if (!fx) { fx = this.makeBuffFx(key, f); if (fx) { this.scene.add(fx); map.set(key, fx); } }
        if (fx) this.updateBuffFx(key, fx, pos, dt, time, f, ch);
      }
      for (const [k, fx] of map) if (!want.has(k)) { this.scene.remove(fx); map.delete(k); }
    }
  }

  makeBuffFx(key, f) {
    const add = (c, o = 0.3) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });
    const g = new THREE.Group();
    switch (key) {
      case 'mana_ward': case 'absorb': {
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 2), add(0x6aa8ff, 0.18)); s.position.y = 1.1; g.add(s);
        const w = new THREE.Mesh(new THREE.IcosahedronGeometry(1.32, 1), new THREE.MeshBasicMaterial({ color: 0x9ac8ff, wireframe: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); w.position.y = 1.1; g.add(w);
        g.userData.spin = w; return g; }
      case 'divine_aegis': {
        const s = new THREE.Mesh(new THREE.SphereGeometry(1.3, 24, 16), add(0xffe08a, 0.2)); s.position.y = 1.1; g.add(s);
        const r = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.03, 6, 40), add(0xfff0b0, 0.8)); r.position.y = 1.1; g.add(r);
        const r2 = r.clone(); r2.rotation.x = Math.PI / 2; g.add(r2);
        g.userData.spin = r; g.userData.spin2 = r2; return g; }
      case 'dr': {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.4, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xc8d8ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, wireframe: false })); s.position.y = 1.2; g.add(s);
        const w = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, 2.4, 6, 3, true), new THREE.MeshBasicMaterial({ color: 0xe8f0ff, wireframe: true, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })); w.position.y = 1.2; g.add(w);
        g.userData.spin = w; return g; }
      case 'stun': {
        for (let i = 0; i < 3; i++) { const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), add(0xffe060, 1)); g.add(st); }
        g.userData.stars = true; return g; }
      case 'disorient': {
        for (let i = 0; i < 4; i++) { const st = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), add(0xfff6c0, 1)); g.add(st); }
        g.userData.stars = true; return g; }
      case 'root': {
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const sh = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1 + Math.random() * 0.7, 5), new THREE.MeshStandardMaterial({ color: 0xbfefff, emissive: 0x3a8ac8, emissiveIntensity: 0.8, transparent: true, opacity: 0.85, roughness: 0.1 }));
          sh.position.set(Math.sin(a) * 0.45, 0.35, Math.cos(a) * 0.45); sh.rotation.set(Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4); g.add(sh);
        }
        return g; }
      case 'silence': {
        const r = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 6, 20), add(0x9ec0ff, 0.9)); r.position.y = 2.45; r.rotation.x = Math.PI / 2; g.add(r);
        g.userData.spin = r; return g; }
      case 'tempest': {
        const r = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.5, 4, 32), add(0xffe0a0, 0.25)); r.rotation.x = Math.PI / 2; r.position.y = 1.1; g.add(r);
        const r2 = new THREE.Mesh(new THREE.RingGeometry(1.0, 6, 40), add(0xffd080, 0.12)); r2.rotation.x = -Math.PI / 2; r2.position.y = 0.1; g.add(r2);
        g.userData.spin = r; return g; }
      case 'mark': {
        const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
        x.fillStyle = '#ff3a5a'; x.font = 'bold 100px serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.shadowColor = '#ff0040'; x.shadowBlur = 20; x.fillText('☠', 64, 70);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); sp.scale.set(0.7, 0.7, 0.7); sp.position.y = 2.9; g.add(sp);
        const r = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 32), add(0xff3a5a, 0.5)); r.rotation.x = -Math.PI / 2; r.position.y = 0.08; g.add(r);
        g.userData.pulse = r; return g; }
      case 'spirit': {
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffe8b0 })); g.add(core);
        const h = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10), add(0xff8a2a, 0.45)); g.add(h);
        const L = new THREE.PointLight(0xff8a3a, 12, 8, 2); g.add(L);
        g.userData.spirit = true; return g; }
      case 'speed': case 'slow': case 'dot': case 'stoneskin': return g; // particle-only
    }
    return null;
  }

  updateBuffFx(key, fx, pos, dt, t, f, ch) {
    fx.position.set(pos.x, pos.y, pos.z);
    const u = fx.userData;
    if (u.spin) { u.spin.rotation.y += dt * 1.5; u.spin.rotation.z += dt * 0.7; }
    if (u.spin2) u.spin2.rotation.y -= dt * 1.2;
    if (u.stars) fx.children.forEach((s, i) => { const a = t * 4 + i * (Math.PI * 2 / fx.children.length); s.position.set(Math.sin(a) * 0.4, 2.35 + Math.sin(t * 6 + i) * 0.05, Math.cos(a) * 0.4); s.rotation.y += dt * 4; });
    if (u.pulse) { const s = 1 + Math.sin(t * 6) * 0.15; u.pulse.scale.set(s, s, s); }
    if (u.spirit) {
      const a = t * 1.6;
      fx.position.set(pos.x + Math.sin(a) * 1.2, pos.y + 2.4 + Math.sin(t * 3) * 0.2, pos.z + Math.cos(a) * 1.2);
      if (Math.random() < dt * 40) this.emit({ x: fx.position.x + (Math.random() - 0.5) * 0.3, y: fx.position.y, z: fx.position.z + (Math.random() - 0.5) * 0.3, vy: 1.5, life: 0.5, size: 0.45, color: Math.random() < 0.5 ? 0xff6a1a : 0xffc04a, grow: -0.8 });
    }
    if (key === 'speed' && Math.random() < dt * 25) this.emit({ x: pos.x + (Math.random() - 0.5) * 0.6, y: pos.y + 0.2 + Math.random() * 1.6, z: pos.z + (Math.random() - 0.5) * 0.6, life: 0.4, size: 0.25, color: f.cls === 'rogue' ? 0xa36bff : f.cls === 'priest' ? 0xfff2c0 : 0xc8fff0, grow: -0.5 });
    if (key === 'slow' && Math.random() < dt * 8) this.emit({ x: pos.x + (Math.random() - 0.5) * 0.8, y: pos.y + Math.random() * 1.8, z: pos.z + (Math.random() - 0.5) * 0.8, vy: -0.3, life: 0.8, size: 0.18, color: 0xbfefff });
    if (key === 'dot' && Math.random() < dt * 10) this.emit({ x: pos.x + (Math.random() - 0.5) * 0.7, y: pos.y + 0.5 + Math.random() * 1.4, z: pos.z + (Math.random() - 0.5) * 0.7, vy: 1.2, life: 0.5, size: 0.3, color: 0xff7a2a, grow: -0.6 });
    if (key === 'stoneskin' && Math.random() < dt * 6) this.emit({ x: pos.x + (Math.random() - 0.5) * 0.8, y: pos.y + Math.random() * 1.8, z: pos.z + (Math.random() - 0.5) * 0.8, vy: 0.5, life: 0.7, size: 0.2, color: 0xb0e080 });
    if (key === 'tempest' && Math.random() < dt * 60) { const a = Math.random() * 6.28; this.emit({ x: pos.x + Math.sin(a) * 2.2, y: pos.y + 0.6 + Math.random() * 1.2, z: pos.z + Math.cos(a) * 2.2, vx: Math.cos(a) * 6, vz: -Math.sin(a) * 6, life: 0.25, size: 0.35, color: 0xfff0d0, grow: -0.5, drag: 3 }); }
  }

  clearAll() {
    for (const [, m] of this.projMeshes) this.scene.remove(m); this.projMeshes.clear();
    for (const [, m] of this.zoneMeshes) this.scene.remove(m); this.zoneMeshes.clear();
    for (const map of this.buffFx) { for (const [, m] of map) this.scene.remove(m); map.clear(); }
    for (const e of this.effects) this.scene.remove(e.obj); this.effects = [];
    this.p.length = 0;
  }

  // ---------------------------------------------------------------- event-driven impacts
  // ctx: { fighters (view), chars, focus(id) -> Vector3 }
  onEvent(ev, ctx) {
    const F = ctx.fighters, ch = ctx.chars;
    const at = id => F[id] ? new THREE.Vector3(F[id].x, F[id].y, F[id].z) : new THREE.Vector3();
    const handPos = id => ctx.focus(id);
    switch (ev.e) {
      case 'caststart': {
        const p = handPos(ev.id);
        const c = { frost_lance: 0x8fd8ff, arcane_comet: 0xc07aff, sacred_bolt: 0xffe070, mend: 0x8aff9a, lightning_lash: 0x7ae0ff }[ev.ab] || 0xffffff;
        this.burst(p.x, p.y, p.z, c, 14, 2, 0.5, 0.35);
        const P = at(ev.id);
        this.groundRing(P.x, P.z, c, 0.5, 1.6, ev.dur || 1, 0.06, 0.8);
        break; }
      case 'ab': this.abilityFx(ev, ctx, at, handPos); break;
      case 'hit': {
        const c = PROJ_STYLE[ev.kind]?.color ?? 0xffffff;
        if (ev.kind === 'arcane_comet') {
          this.burst(ev.x, ev.y, ev.z, [0xc07aff, 0xffffff, 0x7a5aff], 90, 14, 0.9, 0.9, { drag: 2.5 });
          this.groundRing(ev.x, ev.z, 0xb46aff, 0.5, 7, 0.7); this.sphereFlash(ev.x, ev.y, ev.z, 0xc07aff, 0.5, 3.5, 0.45); this.flash(ev.x, ev.y + 1, ev.z, 0xb46aff, 120, 0.6);
          this.pillar(ev.x, ev.z, 0xc07aff, 14, 1.2, 0.6);
        } else if (ev.kind === 'frost_lance') {
          this.burst(ev.x, ev.y, ev.z, [0x8fd8ff, 0xffffff], 28, 6, 0.5, 0.4, { gravity: 6 }); this.flash(ev.x, ev.y, ev.z, 0x8fd8ff, 25, 0.25);
        } else if (ev.kind === 'sacred_bolt') {
          this.burst(ev.x, ev.y, ev.z, [0xffe070, 0xffffff], 26, 5, 0.5, 0.45); this.sphereFlash(ev.x, ev.y, ev.z, 0xffe080, 0.2, 1.2, 0.3); this.flash(ev.x, ev.y, ev.z, 0xffe070, 25, 0.25);
        } else {
          this.burst(ev.x, ev.y, ev.z, [c, 0xffd080], 30, 6, 0.5, 0.5, { up: 1 }); this.flash(ev.x, ev.y, ev.z, c, 30, 0.3);
        }
        break; }
      case 'fizzle': this.burst(ev.x, ev.y, ev.z, 0x888888, 10, 2, 0.4, 0.3); break;
      case 'dmg': {
        const P = at(ev.id);
        if (ev.ab === 'auto' || ev.ab === 'viper_strike' || ev.ab === 'rending_blow' || ev.ab === 'crippling_slash' || ev.ab === 'gutting_edge' || ev.ab === 'steel_tempest') {
          this.burst(P.x, P.y + 1.2, P.z, [0xff3a2a, 0xffffff], ev.big ? 30 : 12, 5, 0.35, 0.3, { gravity: 8 });
          // slash arc
          this.slashArc(P, F[ev.src], ev.ab === 'gutting_edge' ? 0xffcf4a : ev.ab === 'viper_strike' ? 0x9be36a : 0xffffff);
        }
        if (ev.abs > 0 && !ev.amt) this.burst(P.x, P.y + 1.1, P.z, 0x9ac8ff, 8, 3, 0.4, 0.3);
        break; }
      case 'heal': { const P = at(ev.id); if (ev.amt > 30) { this.burst(P.x, P.y + 0.5, P.z, [0x8aff9a, 0xffffff], 26, 2, 1.0, 0.35, { up: 2.5, drag: 1 }); } break; }
      case 'blink': {
        const c = { arcane_shift: 0xc69bff, shadow_leap: 0x7a3aff }[ev.fx] || 0xffffff;
        this.burst(ev.x0, 1, ev.z0, [c, 0xffffff], 40, 5, 0.6, 0.5);
        this.burst(ev.x1, 1, ev.z1, [c, 0xffffff], 40, 5, 0.6, 0.5);
        this.groundRing(ev.x1, ev.z1, c, 0.3, 2.5, 0.4);
        // streak between
        for (let i = 0; i < 20; i++) { const u = i / 20; this.emit({ x: ev.x0 + (ev.x1 - ev.x0) * u, y: 1 + Math.random() * 0.6, z: ev.z0 + (ev.z1 - ev.z0) * u, life: 0.4, size: 0.4, color: c }); }
        break; }
      case 'dash': { const P = at(ev.id); this.groundRing(P.x, P.z, ev.fx === 'bull_rush' ? 0xffb04a : 0xc8fff0, 0.3, 2.2, 0.35); break; }
      case 'interrupted': { const P = at(ev.id); this.burst(P.x, P.y + 1.8, P.z, [0xff4a3a, 0xffffff], 22, 4, 0.5, 0.35); break; }
      case 'death': { const P = at(ev.id); this.burst(P.x, P.y + 1, P.z, [0xffffff, 0xffd080], 60, 6, 1.4, 0.5, { up: 1, drag: 1.2 }); this.groundRing(P.x, P.z, 0xffd080, 0.5, 6, 1.0); break; }
      case 'buff': {
        const P = at(ev.id);
        if (ev.type === 'stealth') { this.burst(P.x, P.y + 1, P.z, [0x3a1a5a, 0x7a5aaa], 50, 3, 0.9, 0.7, { drag: 2 }); }
        if (ev.type === 'stun') this.burst(P.x, P.y + 2.2, P.z, 0xffe060, 16, 3, 0.4, 0.3);
        if (ev.type === 'root') this.burst(P.x, P.y + 0.3, P.z, [0xbfefff, 0xffffff], 24, 3, 0.6, 0.35, { flat: true });
        if (ev.type === 'disorient') this.burst(P.x, P.y + 2, P.z, 0xffffff, 20, 2, 0.6, 0.3);
        break; }
      case 'immune': { const P = at(ev.id); this.sphereFlash(P.x, P.y + 1.1, P.z, 0xffffff, 1, 1.6, 0.3, 0.3); break; }
      case 'fx': this.namedFx(ev, ctx, at); break;
    }
  }

  slashArc(P, src, color) {
    if (!src) return;
    const a = Math.atan2(P.x - src.x, P.z - src.z);
    const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 24, 1, -1.1, 2.2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(P.x - Math.sin(a) * 0.4, P.y + 1.2, P.z - Math.cos(a) * 0.4);
    m.rotation.set(Math.random() * 0.8 - 0.4 + Math.PI / 2, 0, a + Math.PI / 2);
    m.rotation.order = 'YXZ'; m.rotation.y = a; m.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 1.2;
    this.addEffect(m, 0.18, (u) => { m.material.opacity = 0.9 * (1 - u); m.scale.setScalar(1 + u * 0.4); });
  }

  abilityFx(ev, ctx, at, handPos) {
    const P = at(ev.id), T = ev.tid >= 0 ? at(ev.tid) : null;
    const hp = handPos(ev.id);
    switch (ev.ab) {
      case 'flame_burst': this.burst(hp.x, hp.y, hp.z, [0xff7a1a, 0xffd080], 16, 4, 0.35, 0.4); break;
      case 'mana_ward': this.sphereFlash(P.x, P.y + 1.1, P.z, 0x6aa8ff, 0.5, 1.6, 0.4); this.ringBurst(P.x, P.y + 1, P.z, 0x9ac8ff, 24, 4, 0.5, 0.35); break;
      case 'arcane_comet': this.burst(hp.x, hp.y, hp.z, [0xc07aff, 0xffffff], 40, 6, 0.6, 0.6); this.flash(hp.x, hp.y, hp.z, 0xc07aff, 40, 0.4); break;
      case 'frost_lance': this.burst(hp.x, hp.y, hp.z, 0x8fd8ff, 14, 3, 0.35, 0.35); break;
      case 'skull_crack': if (T) { this.burst(T.x, T.y + 1.9, T.z, [0xffd27a, 0xffffff], 30, 5, 0.4, 0.4); this.sphereFlash(T.x, T.y + 1.9, T.z, 0xffd27a, 0.2, 1.0, 0.25); } break;
      case 'fade': break;
      case 'death_mark': if (T) { this.pillar(T.x, T.z, 0xff2a4a, 6, 0.9, 0.6); this.burst(T.x, T.y + 1.5, T.z, [0xff2a4a, 0x3a0010], 40, 4, 0.7, 0.5); } break;
      case 'iron_bulwark': this.ringBurst(P.x, P.y + 1, P.z, 0xe8f0ff, 30, 5, 0.5, 0.4); this.flash(P.x, P.y + 1.5, P.z, 0xc8d8ff, 30, 0.4); break;
      case 'shield_slam': if (T) { this.burst(T.x, T.y + 1.4, T.z, [0x9ec0ff, 0xffffff], 30, 6, 0.4, 0.4); this.sphereFlash(T.x, T.y + 1.4, T.z, 0x9ec0ff, 0.3, 1.4, 0.25); } break;
      case 'steel_tempest': this.groundRing(P.x, P.z, 0xffe0a0, 1, 7, 0.5); break;
      case 'sacred_bolt': this.burst(hp.x, hp.y, hp.z, 0xffe070, 16, 3, 0.4, 0.35); break;
      case 'mend': this.pillar(P.x, P.z, 0x8aff9a, 5, 1.0, 0.8); this.burst(P.x, P.y + 0.3, P.z, [0x8aff9a, 0xffffff], 40, 2, 1.2, 0.4, { up: 3, drag: 1 }); this.flash(P.x, P.y + 2, P.z, 0x8aff9a, 30, 0.6); break;
      case 'divine_aegis': this.sphereFlash(P.x, P.y + 1.1, P.z, 0xffe08a, 0.4, 1.6, 0.4); break;
      case 'seraph_step': this.burst(P.x, P.y + 1.5, P.z, [0xffffff, 0xd8f4ff], 50, 4, 0.8, 0.45, { up: 1 }); break;
      case 'magma_burst': this.burst(hp.x, hp.y, hp.z, [0xff5a1a, 0xffb050], 16, 4, 0.4, 0.4); break;
      case 'quake_totem': this.burst(P.x, 0.2, P.z, 0xc9a070, 30, 4, 0.6, 0.5, { flat: true, gravity: 5 }); break;
      case 'stoneskin_totem': this.burst(P.x, 0.2, P.z, [0xb0e080, 0x8a7a5a], 30, 3, 0.7, 0.45, { up: 2 }); break;
      case 'fire_spirit': this.pillar(P.x, P.z, 0xff8a2a, 6, 1, 0.7); this.burst(P.x, P.y + 2, P.z, [0xff8a2a, 0xffe0a0], 50, 5, 0.8, 0.6); this.flash(P.x, P.y + 2, P.z, 0xff8a2a, 50, 0.6); break;
      case 'gale_dash': this.burst(P.x, P.y + 0.6, P.z, [0xc8fff0, 0xffffff], 30, 4, 0.5, 0.45); break;
      case 'bull_rush': this.burst(P.x, 0.3, P.z, 0xc9a070, 20, 3, 0.5, 0.5, { flat: true }); break;
    }
  }

  namedFx(ev, ctx, at) {
    switch (ev.fx) {
      case 'glacial_nova':
        this.groundRing(ev.x, ev.z, 0xbfefff, 0.5, 9, 0.6);
        this.ringBurst(ev.x, 0.5, ev.z, 0xbfefff, 60, 16, 0.6, 0.6);
        this.burst(ev.x, 0.8, ev.z, [0xffffff, 0x8fd8ff], 40, 10, 0.6, 0.5, { flat: true });
        this.flash(ev.x, 1.5, ev.z, 0x8fd8ff, 60, 0.5);
        break;
      case 'blinding_light':
        this.sphereFlash(ev.x, 1.2, ev.z, 0xfff6c0, 0.5, 9, 0.5, 0.5);
        this.ringBurst(ev.x, 1, ev.z, 0xfff6c0, 60, 18, 0.5, 0.6);
        this.flash(ev.x, 2, ev.z, 0xfff6c0, 150, 0.6);
        break;
      case 'halo_judgment': {
        const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.15, 8, 64), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        m.rotation.x = Math.PI / 2; m.position.set(ev.x, 1.2, ev.z);
        this.addEffect(m, 0.8, (u) => { const r = 1 + u * 28; m.scale.set(r, r, 1 + u * 3); m.material.opacity = 1 - u; });
        this.flash(ev.x, 2, ev.z, 0xffd24a, 80, 0.7);
        const T = at(ev.tid); this.pillar(T.x, T.z, 0xffd24a, 12, 1.2, 0.7); this.burst(T.x, T.y + 1, T.z, [0xffd24a, 0xffffff], 50, 6, 0.7, 0.5);
        this.pillar(ev.x, ev.z, 0xfff6c0, 8, 1.0, 0.7);
        break; }
      case 'quake_erupt':
        this.groundRing(ev.x, ev.z, 0xff9a4a, 1, 9, 0.6);
        this.burst(ev.x, 0.3, ev.z, [0x8a6a4a, 0xc9a070, 0xff8a3a], 120, 12, 0.9, 0.7, { up: 4, gravity: 14, flat: false });
        this.flash(ev.x, 1, ev.z, 0xff9a4a, 70, 0.5);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + Math.random() * 0.4), new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: 1, flatShading: true }));
          const r = 2 + Math.random() * 5; rock.position.set(ev.x + Math.sin(a) * r, -0.5, ev.z + Math.cos(a) * r);
          this.addEffect(rock, 1.2, (u) => { rock.position.y = Math.sin(Math.min(1, u * 2) * Math.PI) * 1.2 - 0.3; rock.rotation.x += 0.1; });
        }
        break;
      case 'bull_rush_hit':
        this.burst(ev.x, 1, ev.z, [0xffb04a, 0xffffff], 40, 7, 0.5, 0.45); this.groundRing(ev.x, ev.z, 0xffb04a, 0.5, 4, 0.4); this.flash(ev.x, 1, ev.z, 0xffb04a, 40, 0.3);
        break;
      case 'death_mark_pop':
        this.burst(ev.x, 1.3, ev.z, [0xff2a4a, 0x2a0010, 0xffffff], 80, 9, 0.8, 0.6); this.sphereFlash(ev.x, 1.3, ev.z, 0xff2a4a, 0.3, 2.5, 0.4); this.flash(ev.x, 1.5, ev.z, 0xff2a4a, 60, 0.4);
        break;
      case 'spirit_cast': break;
      case 'lightning_lash': {
        const a = ctx.focus(ev.id).clone(), T = at(ev.tid), b = new THREE.Vector3(T.x, T.y + 1.2, T.z);
        this.beam(a, b, 0x4ad8ff, 0.3, 0.06, 1.2);
        this.beam(a, b, 0x9af0ff, 0.2, 0.03, 1.8);
        this.burst(b.x, b.y, b.z, [0x7ae0ff, 0xffffff], 30, 7, 0.4, 0.35);
        this.flash(b.x, b.y, b.z, 0x4ad8ff, 60, 0.3); this.flash(a.x, a.y, a.z, 0x4ad8ff, 30, 0.2);
        break; }
    }
  }

  update(dt) { this.updateParticles(dt); this.updateEffects(dt); }
}

export { SCHOOL_COLOR };
