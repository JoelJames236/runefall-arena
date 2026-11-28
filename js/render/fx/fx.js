// The new effect system (docs/remodel/06 §2): one atlas, two GPU particle pools, instanced mesh primitives, one
// ribbon pool, one decal pool, the shared flash lights — all made once at load, nothing created or disposed while a
// match runs, nothing allocated per frame. The old VFX (vfx.js) keeps drawing every existing effect until Phase 6
// moves the abilities over; today FX draws the weapon trails, and offers the shared building blocks of 06 §4.
//
// Drawing: FX owns its own scene, rendered by FxPass right after the main RenderPass into the same (MSAA) target,
// so particles can read the scene depth (soft particles) — and before bloom, so they bloom. Without the composer
// (quality 'low') World calls renderDirect() after the scene (soft particles off, as 06 §2 asks for low).
//
// Draw calls: ≤ 2 particles + ≤ 5 mesh primitives + 1 ribbons + 1 decals = ≤ 9, and only the parts in use draw.
import * as THREE from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { createAtlas } from './atlas.js';
import { CELL } from './atlas-layout.js';
import { ParticlePool, particleSpec, MODE } from './particles.js';
import { MeshFX, FLAG } from './meshfx.js';
import { Decals, DFLAG } from './decals.js';
import { Ribbons, RIB, PROFILE } from './ribbons.js';
import { WeaponTrails } from './trails.js';
import { FlashLights } from './lights.js';
import { SCHOOLS, HOSTILE, school as pal, schoolId } from './palette.js';

const TAU = Math.PI * 2, R = Math.random;
const QUALITY = { low: 0.45, medium: 0.75, high: 1 };
export const POOLS = { additive: 6000, additiveHeld: 160, alpha: 2000, alphaHeld: 32, decals: 48 };

class FxPass extends Pass {
  constructor(fx) { super(); this.fx = fx; this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) { this.fx.renderInto(renderer, readBuffer); }
}

// a persistent sprite in a pool's held block (projectile cores, overhead icons, orbiting stars)
class Sprite {
  constructor(fx, pool, slot) { this.fx = fx; this.pool = pool; this.slot = slot; this.live = slot >= 0; this.obj = null; this.ox = this.oy = this.oz = 0; }
  set(x, y, z) { if (this.live) this.pool.moveHeld(this.slot, x, y, z); return this; }
  follow(obj, ox = 0, oy = 0, oz = 0) { this.obj = obj; this.ox = ox; this.oy = oy; this.oz = oz; if (obj && this.live) this.fx.addFollower(this); return this; }
  end() { if (!this.live) return; this.live = false; this.pool.release(this.slot); this.fx.removeFollower(this); }
}
// a slot in a mesh / decal pool
class Slot {
  constructor(ref) { this.ref = ref; }
  end(fade) { const r = this.ref; if (r) { r.pool.end(r.i, r.gen, fade); this.ref = null; } }
  set(x, y, z) { const r = this.ref; if (r && r.pool.gen[r.i] === r.gen) { const m = r.pool.M, o = r.i * 16; m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; r.pool.markDirty(r.i); } return this; }
}
class Group { constructor(parts) { this.parts = parts; } end(fade) { for (const p of this.parts) p && p.end(fade); } }

export class FX {
  // opts: { scene (the world scene, for the lights), fog, lightPool (adopt VFX's pool), composer }
  constructor(renderer, camera, opts = {}) {
    this.renderer = renderer; this.camera = camera;
    this.scene = new THREE.Scene(); this.scene.fog = opts.fog || null; this.scene.name = 'fx';
    this.time = 0; this.q = 1; this.soft = true; this.softActive = false;
    this.atlas = createAtlas();
    const U = this.U = {
      uTime: { value: 0 }, uKill: { value: -1e9 }, uAtlas: { value: this.atlas.texture },
      uDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uSoft: { value: 0 }, uNear: { value: 0.1 }, uFar: { value: 1000 },
    };
    this.alphaPool = new ParticlePool({ capacity: POOLS.alpha, held: POOLS.alphaHeld, additive: false, uniforms: U, renderOrder: 5, name: 'fx_alpha' });
    this.add = new ParticlePool({ capacity: POOLS.additive, held: POOLS.additiveHeld, additive: true, uniforms: U, renderOrder: 6, name: 'fx_additive' });
    this.mesh = new MeshFX(U, 3);
    this.decals = new Decals(U, POOLS.decals, 1);
    this.ribbons = new Ribbons(U, 4);
    this.trails = new WeaponTrails(this.ribbons);
    this.parts = [this.decals.pool.mesh, ...this.mesh.list.map(p => p.mesh), this.ribbons.mesh, this.alphaPool.mesh, this.add.mesh];
    for (const m of this.parts) this.scene.add(m);
    this.lights = new FlashLights(opts.scene || this.scene, opts.lightPool || null);
    this.pass = new FxPass(this);
    if (opts.composer) this.attachComposer(opts.composer);
    // scratch (no allocation in the hot paths)
    this.P = particleSpec(); this.c1 = new THREE.Color(); this.c2 = new THREE.Color();
    this.followers = []; this.tasks = [];
    this.cpu = new Float32Array(120); this.cpuN = 0; this.spawnMs = 0; this.lastDraws = 0; this.lastRenderMs = 0;
    this.precompile();
    // time the building blocks (event-time CPU, reported with the per-frame update in stats())
    for (const k of ['burst', 'muzzle', 'meleeHit', 'crit', 'ring', 'shell', 'flashSphere', 'pillar', 'cone', 'disc', 'beam', 'chain', 'decal', 'castCircle', 'telegraph', 'glow', 'icon', 'stun', 'healLand', 'smoke', 'fire', 'swing']) {
      const f = this[k].bind(this);
      this[k] = (a, b, c, d, e, g, h, i) => { const t = performance.now(); const r = f(a, b, c, d, e, g, h, i); this.spawnMs += performance.now() - t; return r; };
    }
  }

  // the composer's targets get a depth texture (soft particles read it), the FX pass goes right after RenderPass
  attachComposer(composer) {
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
      if (!rt.depthTexture) { rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height); rt.depthTexture.type = THREE.UnsignedIntType; }
    }
    const i = composer.passes.findIndex(p => p.isRenderPass || p.constructor?.name === 'RenderPass');
    composer.insertPass(this.pass, i >= 0 ? i + 1 : 1);
    this.composer = composer;
  }

  // compile every FX program now (into the composer's target: no tone mapping; to the canvas: tone mapped for
  // quality 'low'), so the first swing / spell of a match doesn't hitch on a shader compile
  precompile() {
    const R = this.renderer, vis = this.parts.map(m => m.visible), rt = R.getRenderTarget();
    for (const m of this.parts) m.visible = true;
    try {
      if (this.composer) { R.setRenderTarget(this.composer.renderTarget1); R.compile(this.scene, this.camera); }
      R.setRenderTarget(null); R.compile(this.scene, this.camera);
    } catch (e) { /* compiles lazily on first use */ }
    R.setRenderTarget(rt);
    this.parts.forEach((m, i) => { m.visible = vis[i]; });
  }

  setQuality(q) { this.q = QUALITY[q] ?? 1; this.soft = q !== 'low'; }
  n(k) { return Math.max(1, Math.round(k * this.q)); }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const t0 = performance.now();
    this.time += dt;
    const T = this.time;
    this.U.uTime.value = T;
    for (let i = this.tasks.length - 1; i >= 0; i--) { const k = this.tasks[i]; if (T > k.until || k.fn(T, dt) === false) { this.tasks[i] = this.tasks[this.tasks.length - 1]; this.tasks.pop(); } }
    if (this.demoLoop && T >= this.demoLoop.next) { this.demoLoop.next = T + this.demoLoop.every; this.demoLoop.fn(); }
    this.trails.update(T);
    const F = this.followers;
    for (let i = 0; i < F.length; i++) { const s = F[i]; if (s.obj) { s.obj.getWorldPosition(_v); s.set(_v.x + s.ox, _v.y + s.oy, _v.z + s.oz); } }
    this.add.commit(T); this.alphaPool.commit(T); this.mesh.commit(T); this.decals.commit(T); this.ribbons.commit(T);
    this.lights.update(dt);
    this.cpu[this.cpuN++ % this.cpu.length] = performance.now() - t0 + this.spawnMs;
    this.spawnMs = 0;
  }

  renderInto(renderer, target) {
    const t0 = performance.now(), U = this.U, cam = this.camera;
    const soft = this.soft && !!target && !!target.depthTexture && target.samples > 0;
    this.softActive = soft;
    U.uSoft.value = soft ? 1 : 0; U.uDepth.value = soft ? target.depthTexture : null;
    if (target) U.uRes.value.set(target.width, target.height);
    U.uNear.value = cam.near; U.uFar.value = cam.far;
    const ac = renderer.autoClear, before = renderer.info.render.calls;
    renderer.autoClear = false;
    renderer.setRenderTarget(target || null);
    renderer.render(this.scene, cam);
    renderer.autoClear = ac;
    this.lastDraws = renderer.info.autoReset ? renderer.info.render.calls : renderer.info.render.calls - before;
    this.lastRenderMs = performance.now() - t0;
  }
  // quality 'low' draws the scene straight to the canvas: FX follows it there
  renderDirect() { this.renderInto(this.renderer, null); }

  clearAll() {
    this.U.uKill.value = this.time;
    this.add.clear(this.time); this.alphaPool.clear(this.time);
    this.mesh.clear(); this.decals.clear(); this.ribbons.clear(); this.trails.clear(); this.lights.clear();
    for (const s of this.followers) s.obj = null;
    this.followers.length = 0; this.tasks.length = 0; this.demoLoop = null;
  }

  addFollower(s) { if (!this.followers.includes(s)) this.followers.push(s); }
  removeFollower(s) { const i = this.followers.indexOf(s); if (i >= 0) { this.followers[i] = this.followers[this.followers.length - 1]; this.followers.pop(); } }
  task(dur, fn) { this.tasks.push({ until: this.time + dur, fn }); }

  // ------------------------------------------------------------------ low level
  spec() { const P = this.P; P.vx = P.vy = P.vz = 0; P.gravity = P.drag = P.rot = P.spin = 0; P.fps = 0; P.mode = 0; P.stretch = 0; P.intensity = 1; P.delay = 0; P.mid = 0.4; P.a0 = 1; P.a1 = 0.8; P.a2 = 0; return P; }
  colors(P, school, o) { const S = pal(school); P.c0 = o?.core ?? S.core; P.c1 = o?.glow ?? S.glow; P.c2 = o?.dark ?? S.dark; return S; }
  lin(hex, c = this.c1) { return c.setHex(hex); } // sRGB hex → linear colour (THREE.ColorManagement)
  flash(x, y, z, color, peak = 30, dur = 0.3, range = 14) { this.lights.flash(x, y, z, color, peak, dur, range); }

  // ------------------------------------------------------------------ building blocks (06 §4)
  // particle burst. o: { school, n, speed, life, size, shrink, cell, mode, stretch, gravity, drag, up, flat, alpha (alpha
  //   pool), intensity, spin, core / glow / dark (hex overrides), spread (position jitter m) }
  burst(x, y, z, o = {}) {
    const n = this.n(o.n ?? 20), sp = o.speed ?? 4, life = o.life ?? 0.5, size = o.size ?? 0.3, pool = o.alpha ? this.alphaPool : this.add;
    const cell = o.cell !== undefined ? CELL[o.cell] ?? o.cell : CELL.soft_dot, j = o.spread || 0;
    for (let i = 0; i < n; i++) {
      const P = this.spec(); this.colors(P, o.school, o);
      const u = R() * 2 - 1, th = R() * TAU, s = Math.sqrt(1 - u * u), v = sp * (0.4 + 0.6 * R());
      P.x = x + (R() - 0.5) * j; P.y = y + (R() - 0.5) * j; P.z = z + (R() - 0.5) * j;
      P.vx = s * Math.cos(th) * v; P.vy = u * v; P.vz = s * Math.sin(th) * v;
      if (o.flat) P.vy = Math.abs(P.vy) * 0.2;
      if (o.up) P.vy = Math.abs(P.vy) + o.up;
      P.life = life * (0.6 + 0.6 * R()); P.size0 = size * (0.6 + 0.7 * R()); P.size1 = P.size0 * (o.shrink ?? 0.25);
      P.gravity = o.gravity || 0; P.drag = o.drag ?? 2.5; P.cell = cell; P.mode = o.mode || 0; P.stretch = o.stretch || 0;
      P.rot = R() * TAU; P.spin = (R() - 0.5) * (o.spin || 0); P.intensity = o.intensity ?? 1.3;
      if (o.alpha) { P.a0 = 0.9; P.a1 = 0.7; P.a2 = 0; P.mid = 0.3; }
      pool.emit(P);
    }
  }
  // flipbook smoke puffs (alpha pool)
  smoke(x, y, z, o = {}) {
    const n = this.n(o.n ?? 6), S = pal(o.school);
    for (let i = 0; i < n; i++) {
      const P = this.spec();
      P.x = x + (R() - 0.5) * (o.spread ?? 0.6); P.y = y + R() * 0.3; P.z = z + (R() - 0.5) * (o.spread ?? 0.6);
      P.vx = (R() - 0.5) * 0.8; P.vy = (o.rise ?? 0.9) * (0.6 + 0.6 * R()); P.vz = (R() - 0.5) * 0.8; P.drag = 0.8;
      P.life = (o.life ?? 1.6) * (0.75 + 0.5 * R()); P.size0 = (o.size ?? 0.9) * (0.7 + 0.5 * R()); P.size1 = P.size0 * 2.1;
      P.cell = CELL.smoke; P.fps = 0; P.rot = R() * TAU; P.spin = (R() - 0.5) * 0.6;
      P.c0 = o.color ?? S.dark; P.c1 = o.color ?? S.dark; P.c2 = o.color ?? S.dark; P.a0 = o.opacity ?? 0.6; P.a1 = (o.opacity ?? 0.6) * 0.8; P.a2 = 0; P.mid = 0.3;
      P.delay = i * 0.03;
      this.alphaPool.emit(P);
    }
  }
  // flipbook flames rising (additive, upright)
  fire(x, y, z, o = {}) {
    const n = this.n(o.n ?? 8), S = pal(o.school ?? 'fire');
    for (let i = 0; i < n; i++) {
      const P = this.spec();
      P.x = x + (R() - 0.5) * (o.spread ?? 0.5); P.y = y + R() * 0.15; P.z = z + (R() - 0.5) * (o.spread ?? 0.5);
      P.vy = (o.rise ?? 1.4) * (0.7 + 0.5 * R()); P.drag = 1.2;
      P.life = (o.life ?? 0.8) * (0.7 + 0.6 * R()); P.size0 = (o.size ?? 0.7) * (0.8 + 0.4 * R()); P.size1 = P.size0 * 0.55;
      P.cell = CELL.fire; P.fps = 18 + R() * 6; P.mode = MODE.upright;
      P.c0 = S.core; P.c1 = S.glow; P.c2 = S.dark; P.a0 = 1; P.a1 = 0.85; P.a2 = 0; P.mid = 0.35; P.intensity = 1.6;
      P.delay = R() * 0.1;
      this.add.emit(P);
    }
  }
  // muzzle: burst at the release point in the school colour — 14 particles + a 0.08 s flash (06 §4)
  muzzle(x, y, z, school, dx = 0, dy = 0, dz = 1) {
    const S = pal(school), l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const n = this.n(14);
    for (let i = 0; i < n; i++) {
      const P = this.spec(); this.colors(P, school);
      const spark = i % 2 === 0, v = spark ? 5 + R() * 4 : 1.5 + R() * 1.5;
      P.x = x; P.y = y; P.z = z;
      P.vx = dx * v + (R() - 0.5) * v * 0.9; P.vy = dy * v + (R() - 0.5) * v * 0.9; P.vz = dz * v + (R() - 0.5) * v * 0.9;
      P.life = spark ? 0.16 + R() * 0.1 : 0.22 + R() * 0.1; P.size0 = spark ? 0.06 : 0.22; P.size1 = P.size0 * 0.3;
      P.drag = 6; P.cell = spark ? CELL.spark : CELL.soft_dot; P.mode = spark ? MODE.stretch : 0; P.stretch = 0.035; P.intensity = 1.6;
      this.add.emit(P);
    }
    const P = this.spec(); P.x = x; P.y = y; P.z = z; P.life = 0.08; P.size0 = 0.55; P.size1 = 0.3; P.cell = CELL.hard_dot;
    P.c0 = S.core; P.c1 = S.glow; P.c2 = S.glow; P.a2 = 0.2; P.intensity = 1.8; this.add.emit(P);
    this.flash(x, y, z, S.glow, 10, 0.08, 8);
  }
  // melee contact: sparks + a weapon-coloured arc; blood on flesh, bone dust on undead, wisps on spirits (06 §4)
  meleeHit(x, y, z, o = {}) {
    const crit = !!o.crit, S = pal(o.school);
    this.burst(x, y, z, { school: 'physical', core: 0xffffff, glow: 0xffe0b0, dark: 0x806040, n: crit ? 26 : 10, speed: 7, life: 0.3, size: 0.07, cell: 'spark', mode: MODE.stretch, stretch: 0.03, gravity: 9, drag: 2, intensity: 1.8 });
    const body = o.body || 'flesh';
    if (body === 'flesh') this.burst(x, y, z, { alpha: true, core: 0xc81a10, glow: 0x8a0a08, dark: 0x3a0404, n: crit ? 12 : 5, speed: 3, up: 1, life: 0.6, size: 0.12, shrink: 0.6, cell: 'blood_drop', gravity: 12, drag: 0.6 });
    else if (body === 'undead') this.burst(x, y, z, { alpha: true, core: 0xe8e0c8, glow: 0xb8b098, dark: 0x6a6450, n: crit ? 12 : 6, speed: 3, life: 0.6, size: 0.16, shrink: 0.5, cell: 'bone_shard_2', gravity: 10, drag: 1, spin: 8 });
    else if (body === 'spirit') this.burst(x, y, z, { school: 'storm', n: crit ? 10 : 5, speed: 1.5, up: 1, life: 0.8, size: 0.25, cell: 'wisp', drag: 1.5 });
    // the arc: a short camera-facing ribbon, a third of a circle across the contact
    const yaw = o.yaw ?? R() * TAU, tilt = (R() - 0.5) * 1.2, rad = crit ? 0.75 : 0.6;
    const i = this.ribbons.alloc(false);
    if (i >= 0) {
      const N = 9, c = this.lin(S.glow), cx = Math.cos(yaw), sx = Math.sin(yaw);
      for (let k = 0; k < N; k++) {
        const a = (k / (N - 1) - 0.5) * 2.1, ca = Math.cos(a), sa = Math.sin(a);
        const lx = sa * rad, ly = Math.sin(a) * Math.sin(tilt) * rad * 0.5, lz = (ca - 0.6) * rad;
        const px = x + lx * cx + lz * sx, py = y + ly, pz = z - lx * sx + lz * cx;
        // d/da of the point above: the arc's tangent
        const tx = ca * cx - sa * sx, ty = ca * Math.sin(tilt) * 0.5, tz = -ca * sx - sa * cx;
        this.ribbons.face(i, k, px, py, pz, tx, ty, tz, (crit ? 0.1 : 0.07) * Math.sin((k / (N - 1)) * Math.PI), k / (N - 1), c.r, c.g, c.b, 0.9);
      }
      this.ribbons.pad(i, N);
      this.ribbons.header(i, this.time, crit ? 0.22 : 0.16, PROFILE.soft, 0, 0, 1, crit ? 0.18 : 0.13);
    }
    if (crit) this.crit(x, y, z);
  }
  // crit: white-gold shockwave ring + sphere flash + 1 light, 0.18 s (06 §4)
  crit(x, y, z) {
    this.ring(x, y, z, { core: 0xfff4d0, r0: 0.25, r1: 1.7, dur: 0.18, thickness: 0.18, alpha: 0.9, faceCamera: true });
    this.flashSphere(x, y, z, { color: 0xffe8a0, r0: 0.2, r1: 1.0, dur: 0.18, alpha: 0.5 });
    this.flash(x, y, z, 0xffe0a0, 25, 0.18);
  }
  // mesh ring (shockwave). o: { school / core (hex), r0, r1, dur, thickness, alpha, nx, ny, nz | faceCamera, cell, spin, repeat, scroll, dissolve }
  ring(x, y, z, o = {}) {
    let nx = o.nx ?? 0, ny = o.ny ?? 1, nz = o.nz ?? 0;
    if (o.faceCamera) { const c = this.camera.position; nx = c.x - x; ny = c.y - y; nz = c.z - z; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; }
    const r = this.mesh.spawn('ring', { x, y, z, nx, ny, nz, r0: o.r0 ?? 0.3, r1: o.r1 ?? 3, dur: o.dur ?? 0.5, fadeOut: o.fadeOut ?? (o.dur ?? 0.5) * 0.8,
      color: this.lin(o.core ?? pal(o.school).glow), alpha: o.alpha ?? 0.9, param: o.thickness ?? 0.12, cell: o.cell !== undefined ? CELL[o.cell] ?? o.cell : -1,
      spin: o.spin || 0, repeat: o.repeat || 1, scroll: o.scroll || 0, flags: o.dissolve ? FLAG.dissolve : 0, follow: o.follow, oy: o.oy }, this.time);
    return new Slot(r);
  }
  // fresnel shell around a body: self-buffs stay ≤ 0.25 opacity (06 §2). o: { school / color, r, dur (0 = until ended),
  //   opacity, fresnel, cell ('hex_pattern' …), repeat, scroll, spin, follow, oy, fadeIn, fadeOut, dissolve }
  shell(x, y, z, o = {}) {
    const S = pal(o.school);
    const r = this.mesh.spawn('shell', { x, y, z, r0: (o.r ?? 1) * (o.grow ? 0.6 : 1), r1: o.r ?? 1, dur: o.dur ?? 0, fadeIn: o.fadeIn ?? 0.2, fadeOut: o.fadeOut ?? 0.35,
      color: this.lin(o.color ?? S.glow), alpha: Math.min(o.opacity ?? 0.22, 0.25), param: o.fresnel ?? 2.2,
      cell: o.cell !== undefined ? CELL[o.cell] ?? o.cell : -1, repeat: o.repeat ?? 6, scroll: o.scroll ?? 0.05, spin: o.spin ?? 0.3,
      flags: (o.dissolve ?? true) ? FLAG.dissolve : 0, follow: o.follow, oy: o.oy ?? 1.0 }, this.time);
    return new Slot(r);
  }
  // quick sphere flash (impacts): not a buff, may be brighter than a shell
  flashSphere(x, y, z, o = {}) {
    const r = this.mesh.spawn('shell', { x, y, z, r0: o.r0 ?? 0.2, r1: Math.min(o.r1 ?? 1.2, 4), dur: o.dur ?? 0.22, fadeOut: o.dur ?? 0.22,
      color: this.lin(o.color ?? pal(o.school).glow), alpha: o.alpha ?? 0.5, param: 1.2, cell: -1 }, this.time);
    return new Slot(r);
  }
  // pillar of light (cylinder). o: { school / color, r, h, dur, alpha, cell, scroll, follow }
  pillar(x, y, z, o = {}) {
    const r = this.mesh.spawn('cylinder', { x, y, z, sy: o.h ?? 6, r0: o.r ?? 0.7, r1: (o.r ?? 0.7) * (o.shrink ?? 0.35), dur: o.dur ?? 0.6, fadeIn: 0.04, fadeOut: (o.dur ?? 0.6) * 0.8,
      color: this.lin(o.color ?? pal(o.school).glow), alpha: o.alpha ?? 0.8, param: 1.5, flags: FLAG.xz | FLAG.linear,
      cell: o.cell !== undefined ? CELL[o.cell] ?? o.cell : CELL.noise, repeat: 2, scroll: o.scroll ?? 1.2, follow: o.follow }, this.time);
    return new Slot(r);
  }
  // cone (shock cones, roar cones). o: { school / color, r, h, dx, dy, dz (axis, base → apex), dur, alpha }
  cone(x, y, z, o = {}) {
    let dx = o.dx ?? 0, dy = o.dy ?? 1, dz = o.dz ?? 0; const l = Math.hypot(dx, dy, dz) || 1;
    const r = this.mesh.spawn('cone', { x, y, z, nx: dx / l, ny: dy / l, nz: dz / l, sy: o.h ?? 2, r0: (o.r ?? 1) * 0.5, r1: o.r ?? 1, dur: o.dur ?? 0.4, fadeOut: (o.dur ?? 0.4) * 0.7,
      color: this.lin(o.color ?? pal(o.school).glow), alpha: o.alpha ?? 0.7, param: 1.6, flags: FLAG.xz, cell: CELL.noise, repeat: 3, scroll: 2 }, this.time);
    return new Slot(r);
  }
  // textured disc (rune discs, sunbursts, ground sigils). o: { cell, school / color, r, r1, dur, spin, nx, ny, nz | faceCamera, alpha, follow, oy }
  disc(x, y, z, o = {}) {
    let nx = o.nx ?? 0, ny = o.ny ?? 1, nz = o.nz ?? 0;
    if (o.faceCamera) { const c = this.camera.position; nx = c.x - x; ny = c.y - y; nz = c.z - z; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; }
    const r = this.mesh.spawn('disc', { x, y, z, nx, ny, nz, r0: o.r ?? 0.5, r1: o.r1 ?? o.r ?? 0.5, dur: o.dur ?? 0.8, fadeIn: o.fadeIn ?? 0.1, fadeOut: o.fadeOut ?? 0.3,
      color: this.lin(o.color ?? pal(o.school).glow), alpha: o.alpha ?? 1, cell: CELL[o.cell] ?? o.cell ?? CELL.rune_ring_1, spin: o.spin || 0,
      flags: o.dissolve ? FLAG.dissolve : 0, follow: o.follow, oy: o.oy }, this.time);
    return new Slot(r);
  }
  // camera-facing beam between two points (lightning, light ribbons). o: { school / color, width, dur, jag, cell
  //   ('lightning_1' …, default soft), repeat (atlas repeats along), scroll, samples, sag, profile }
  beam(ax, ay, az, bx, by, bz, o = {}) {
    const i = this.ribbons.alloc(!(o.dur > 0)); if (i < 0) return null;
    const h = { i, gen: this.ribbons.gen[i], o, end: fade => { if (this.ribbons.gen[i] === h.gen) { if (fade) { this.ribbons.persist[i] = 0; this.ribbons.header(i, this.time - 0.001, fade, h.cell, h.jag, h.scroll, h.repeat, fade); } else this.ribbons.free(i); } },
      set: (x0, y0, z0, x1, y1, z1) => { if (this.ribbons.gen[i] === h.gen) this.beamPoints(i, x0, y0, z0, x1, y1, z1, o); } };
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    h.cell = o.profile ?? (o.cell !== undefined ? CELL[o.cell] ?? o.cell : PROFILE.soft);
    h.jag = o.jag ?? 0; h.scroll = o.scroll ?? 0; h.repeat = o.repeat ?? Math.max(1, len / 2);
    this.beamPoints(i, ax, ay, az, bx, by, bz, o);
    this.ribbons.header(i, this.time, o.dur > 0 ? o.dur : 1e6, h.cell, h.jag, h.scroll, h.repeat, o.fadeOut ?? (o.dur > 0 ? o.dur * 0.6 : 0.2));
    return h;
  }
  beamPoints(i, ax, ay, az, bx, by, bz, o) {
    const N = Math.min(RIB.samples, o.samples ?? 12), S = pal(o.school), c = this.lin(o.color ?? S.glow), hw = (o.width ?? 0.12) / 2, sag = o.sag || 0;
    const tx = bx - ax, ty = by - ay, tz = bz - az;
    for (let k = 0; k < N; k++) {
      const u = k / (N - 1), s = sag * 4 * u * (1 - u);
      this.ribbons.face(i, k, ax + tx * u, ay + ty * u - s, az + tz * u, tx, ty - sag * 4 * (1 - 2 * u), tz, hw, u, c.r, c.g, c.b, o.alpha ?? 1);
    }
    this.ribbons.pad(i, N);
    this.ribbons.touch(i);
  }
  // chain links between two points (curses, grips). o: { school, width, dur, linkLen, sag }
  chain(ax, ay, az, bx, by, bz, o = {}) {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    return this.beam(ax, ay, az, bx, by, bz, { school: o.school ?? 'curse', width: o.width ?? 0.16, dur: o.dur, profile: PROFILE.chain, repeat: len / (o.linkLen ?? 0.22), sag: o.sag ?? 0.15, samples: 14, alpha: o.alpha ?? 1, fadeOut: o.fadeOut });
  }
  // ground decal. o: { r, school, hostile, dur (0 = until ended), timer, cell (runes), spin, flags, edgeA, fillA, yaw, follow, oy }
  decal(x, y, z, o = {}) {
    const S = pal(o.school);
    const edge = this.lin(o.hostile ? HOSTILE : (o.edge ?? S.glow), this.c1), fill = this.lin(o.fill ?? S.glow, this.c2);
    const r = this.decals.spawn({ x, y: y + 0.04, z, r: o.r ?? 2, yaw: o.yaw ?? 0, dur: o.dur ?? 0, fadeIn: o.fadeIn ?? 0.15, fadeOut: o.fadeOut ?? 0.3,
      edge, edgeA: o.edgeA ?? 1, fill, fillA: o.fillA ?? 0.16, cell: o.cell !== undefined ? CELL[o.cell] ?? o.cell : -1, spin: o.spin || 0,
      timer: o.timer || 0, flags: o.flags || 0, follow: o.follow, oy: o.oy }, this.time);
    return new Slot(r);
  }
  // cast_circle (06 §4): rune circle at the feet, runes turn 0.6 rad/s, fills clockwise with the cast; ends with the cast
  castCircle(x, y, z, school, castDur, o = {}) {
    return this.decal(x, y, z, { r: o.r ?? 1.1, school, cell: 'cast_circle', spin: 0.6, timer: castDur, flags: DFLAG.sweep, fillA: 0.22, fadeIn: 0.15, fadeOut: 0.25, dur: o.dur ?? 0, follow: o.follow, oy: o.oy, hostile: o.hostile });
  }
  // telegraph (06 §4): edge hostile red-orange / friendly school colour, fill grows with the timer
  telegraph(x, y, z, r, timer, school, hostile, o = {}) {
    return this.decal(x, y, z, { r, school, hostile, timer, flags: DFLAG.grow | (o.pulse ? DFLAG.pulse : 0), fillA: 0.22, dur: timer + (o.linger ?? 0.25), fadeOut: o.linger ?? 0.25, cell: o.cell, spin: o.spin });
  }
  // projectile glow: a held core + halo that the caller moves every frame; it leaves school motes behind it
  glow(school, size = 0.3, o = {}) {
    const S = pal(school), P = this.spec();
    P.x = P.y = P.z = 0; P.size0 = P.size1 = size * 0.55; P.cell = CELL.hard_dot; P.c0 = P.c1 = P.c2 = S.core; P.a0 = P.a1 = P.a2 = 1; P.intensity = 2;
    const core = new Sprite(this, this.add, this.add.hold(P));
    const P2 = this.spec(); P2.size0 = P2.size1 = size * 2.2; P2.cell = CELL.soft_dot; P2.c0 = P2.c1 = P2.c2 = S.glow; P2.a0 = P2.a1 = P2.a2 = 0.85; P2.intensity = 1.4; P2.spin = 2;
    const halo = new Sprite(this, this.add, this.add.hold(P2));
    let px = NaN, py = 0, pz = 0;
    const trail = o.trail ?? 'motes', cell = CELL[o.trailCell ?? (trail === 'embers' ? 'ember' : 'soft_dot')];
    return {
      core, halo,
      set: (x, y, z) => {
        core.set(x, y, z); halo.set(x, y, z);
        if (px === px && trail) {
          const d = Math.hypot(x - px, y - py, z - pz), n = Math.min(6, Math.ceil(d / (size * 0.9) * this.q));
          for (let k = 0; k < n; k++) {
            const u = k / n, Q = this.spec(); this.colors(Q, school);
            Q.x = px + (x - px) * u + (R() - 0.5) * size * 0.5; Q.y = py + (y - py) * u + (R() - 0.5) * size * 0.5; Q.z = pz + (z - pz) * u + (R() - 0.5) * size * 0.5;
            Q.vx = (R() - 0.5) * 0.8; Q.vy = (R() - 0.5) * 0.8 + (trail === 'embers' ? 0.6 : 0); Q.vz = (R() - 0.5) * 0.8; Q.drag = 2;
            Q.life = 0.3 + R() * 0.15; Q.size0 = size * (1.1 + R() * 0.4); Q.size1 = Q.size0 * 0.2; Q.cell = cell; Q.intensity = 1.2; Q.rot = R() * TAU;
            this.add.emit(Q);
          }
        }
        px = x; py = y; pz = z;
      },
      end: () => { core.end(); halo.end(); },
    };
  }
  // overhead icon (☠ ⚑ ⚖ sigils, 06 §6): a held sprite at head height, following a body. o: { school / color, size, oy }
  icon(cellId, follow, o = {}) {
    const S = pal(o.school ?? 'holy'), P = this.spec();
    P.size0 = P.size1 = o.size ?? 0.42; P.cell = CELL[cellId] ?? cellId; P.c0 = P.c1 = P.c2 = o.color ?? S.glow; P.a0 = P.a1 = P.a2 = o.alpha ?? 0.95; P.intensity = o.intensity ?? 1.5;
    const s = new Sprite(this, this.add, this.add.hold(P));
    if (follow && follow.isObject3D) s.follow(follow, 0, o.oy ?? 2.55, 0); else if (follow) s.set(follow.x, follow.y + (o.oy ?? 2.55), follow.z);
    return s;
  }
  // stun (06 §4): 3 small golden stars circling head_top, r 0.28, 2.5 rad/s — orbit mode, the GPU turns them
  stun(follow, o = {}) {
    const parts = [];
    for (let k = 0; k < 3; k++) {
      const P = this.spec(); P.mode = MODE.orbit; P.vx = o.r ?? 0.28; P.vy = o.speed ?? 2.5; P.vz = 0.03; P.rot = k / 3 * TAU;
      P.size0 = P.size1 = o.size ?? 0.16; P.cell = CELL.star; P.c0 = P.c1 = P.c2 = 0xffd84a; P.a0 = P.a1 = P.a2 = 1; P.intensity = 1.8;
      const s = new Sprite(this, this.add, this.add.hold(P));
      if (follow && follow.isObject3D) s.follow(follow, 0, o.oy ?? 2.15, 0); else if (follow) s.set(follow.x, follow.y + (o.oy ?? 2.15), follow.z);
      parts.push(s);
    }
    return new Group(parts);
  }
  // heal_land (06 §4): a spiral of school motes rising around the target + a soft flash
  healLand(x, y, z, school = 'nature', crit = false) {
    const S = pal(crit ? 'holy' : school), n = this.n(40);
    for (let i = 0; i < n; i++) {
      const P = this.spec(); this.colors(P, crit ? 'holy' : school);
      const a = i / n * TAU * 3, h = i / n * 2;
      P.x = x + Math.sin(a) * 0.75; P.y = y + 0.1 + h * 0.3; P.z = z + Math.cos(a) * 0.75;
      P.vx = Math.cos(a) * 0.7; P.vy = 1.4 + R() * 0.6; P.vz = -Math.sin(a) * 0.7; P.drag = 0.6;
      P.life = 0.9 + R() * 0.3; P.size0 = 0.16 + R() * 0.1; P.size1 = 0.04; P.cell = i % 3 ? CELL.soft_dot : CELL.hard_dot; P.intensity = 1.4; P.delay = i / n * 0.25;
      this.add.emit(P);
    }
    this.flashSphere(x, y + 1, z, { color: S.glow, r0: 0.4, r1: 1.4, dur: 0.35, alpha: 0.35 });
    this.flash(x, y + 1.5, z, S.glow, 18, 0.4);
  }
  // weapon trail on (basic attacks, melee abilities): fighter id, seconds, school id (06 §4 trail_<school>)
  swing(id, dur, school) { this.trails.arm(id, dur, school ? schoolId(school) : null); }

  // ------------------------------------------------------------------ stats (debug harness, 06 §2 budgets)
  stats() {
    const T = this.time, avg = a => { let s = 0, n = Math.min(this.cpuN, a.length); for (let i = 0; i < n; i++) s += a[i]; return n ? s / n : 0; };
    let mx = 0; for (let i = 0; i < Math.min(this.cpuN, this.cpu.length); i++) mx = Math.max(mx, this.cpu[i]);
    const add = this.add.live(T), alpha = this.alphaPool.live(T);
    const mesh = {}; for (const [k, P] of Object.entries(this.mesh.pools)) mesh[k] = P.live(T);
    return {
      liveParticles: add + alpha, additive: add, alpha, heldSprites: this.add.heldLive + this.alphaPool.heldLive,
      meshInstances: mesh, decals: this.decals.pool.live(T), ribbons: this.ribbons.live(T),
      fxDrawCalls: this.lastDraws, fxDrawParts: this.parts.filter(m => m.visible).map(m => m.name),
      cpuMsAvg: +avg(this.cpu).toFixed(4), cpuMsMax: +mx.toFixed(4), renderMs: +this.lastRenderMs.toFixed(4),
      pools: { additive: this.add.cap, alpha: this.alphaPool.cap, held: POOLS.additiveHeld + POOLS.alphaHeld, ...Object.fromEntries(Object.entries(this.mesh.pools).map(([k, P]) => [k, P.cap])), decals: this.decals.pool.cap, ribbons: `${RIB.slots}x${RIB.samples}` },
      quality: this.q, soft: this.softActive, atlasPaintMs: +this.atlas.paintMs.toFixed(1), time: +T.toFixed(2),
    };
  }
}

const _v = new THREE.Vector3();
export { SCHOOLS, HOSTILE, CELL, MODE, DFLAG, FLAG };
