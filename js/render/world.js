// Scene, camera, lighting, post-processing and the bridge between game state
// (sim or network view) and the visual representation.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Arena } from './arena.js';
import { VFX } from './vfx.js';
import { Character } from './characters.js';
import { PILLARS, hasBuff, angleDiff } from '../sim/sim.js';
import { CLASSES } from '../data/classes.js';

const AB_ANIM = {
  frost_lance: 'release', flame_burst: 'release', glacial_nova: 'slam', mana_ward: 'raise', arcane_comet: 'release',
  viper_strike: 'stab', gutting_edge: 'finisher', skull_crack: 'finisher', shadow_leap: 'dash', death_mark: 'stab',
  rending_blow: 'slash', crippling_slash: 'slash', iron_bulwark: 'bash', shield_slam: 'bash',
  sacred_bolt: 'release', mend: 'raise', divine_aegis: 'raise', blinding_light: 'raise', halo_judgment: 'raise',
  lightning_lash: 'release', magma_burst: 'release', quake_totem: 'slam', gale_dash: 'dash', stoneskin_totem: 'slam', fire_spirit: 'raise',
};
export { AB_ANIM };

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x4a3040, 120, 1100);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    this.camera.position.set(0, 20, 50);

    // lighting: warm sunset key light, cool moon fill, sky/ground hemisphere
    this.hemi = new THREE.HemisphereLight(0x9a9ac8, 0x4a3a30, 1.6); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffc89a, 2.6);
    this.sun.position.set(-35, 45, 28);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    const moon = new THREE.DirectionalLight(0x8aa0ff, 0.7); moon.position.set(30, 30, -40); this.scene.add(moon);

    // image-based lighting so metals and armor have something to reflect
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.arena = new Arena(this.scene);
    this.vfx = new VFX(this.scene);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.chars = [null, null];
    this.charState = [{}, {}];
    this.mode = 'menu';
    this.time = 0;
    this.camPos = new THREE.Vector3(0, 6, -10);
    this.camLook = new THREE.Vector3();
    this.shake = 0;
    this.preview = { yaw: 0.4, dist: 5.4, dragging: false, char: null };
    this.setQuality('high');
    addEventListener('resize', () => this.resize());
    this.resize();
    this.setupPreviewControls();
  }

  setQuality(q) {
    this.quality = q;
    this.useBloom = q === 'high';
    this.renderer.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'low' ? 1 : q === 'medium' ? 1.25 : 1.75));
    this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w / 2, h / 2);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vfx.setScale(h * this.renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / 1.0);
  }

  // ------------------------------------------------------------------ characters
  clearChars() {
    for (const c of this.chars) if (c) this.scene.remove(c.root);
    this.chars = [null, null];
    if (this.preview.char) { this.scene.remove(this.preview.char.root); this.preview.char = null; }
    this.vfx.clearAll();
  }

  setFighters(clsA, clsB) {
    this.clearChars();
    this.chars = [new Character(clsA), new Character(clsB)];
    for (const c of this.chars) { c.root.traverse(o => { if (o.isMesh) o.castShadow = true; }); this.scene.add(c.root); }
    this.charState = [{ px: 0, pz: 0, speed: 0, faceYaw: 0, faceT: 0 }, { px: 0, pz: 0, speed: 0, faceYaw: 0, faceT: 0 }];
  }

  showMenuScene() {
    this.mode = 'menu';
    this.clearChars();
    const a = new Character('warrior'), b = new Character('mage');
    a.root.position.set(0, 0, -3.5); b.root.position.set(0, 0, 3.5); b.root.rotation.y = Math.PI;
    this.scene.add(a.root, b.root);
    this.chars = [a, b];
    this.menuT = 0;
  }

  showPreview(cls) {
    this.mode = 'preview';
    this.clearChars();
    const c = new Character(cls);
    c.root.position.set(0, 0, 0);
    this.scene.add(c.root);
    this.preview.char = c;
    this.preview.yaw = 0.5;
    c.play('raise', 0.9);
    this.vfx.burst(0, 1, 0, [CLASSES[cls].color === undefined ? 0xffffff : new THREE.Color(CLASSES[cls].color).getHex(), 0xffffff], 50, 4, 0.8, 0.5, { up: 1 });
    this.vfx.groundRing(0, 0, new THREE.Color(CLASSES[cls].color).getHex(), 0.5, 3, 0.8);
  }

  previewAbility(ab) {
    const c = this.preview.char; if (!c) return;
    c.play(AB_ANIM[ab.id] || 'release', 0.6);
    const col = new THREE.Color(ab.color).getHex();
    const p = c.focusWorld();
    this.vfx.burst(p.x, p.y, p.z, [col, 0xffffff], 40, 4, 0.7, 0.45);
    this.vfx.groundRing(0, 0, col, 0.4, 2.5, 0.6);
    this.vfx.flash(p.x, p.y, p.z, col, 30, 0.4);
  }

  setupPreviewControls() {
    let lx = 0;
    this.canvas.addEventListener('pointerdown', e => { if (this.mode === 'preview') { this.preview.dragging = true; lx = e.clientX; } });
    addEventListener('pointerup', () => { this.preview.dragging = false; });
    addEventListener('pointermove', e => { if (this.preview.dragging) { this.preview.yaw += (e.clientX - lx) * 0.01; lx = e.clientX; } });
    this.canvas.addEventListener('wheel', e => { if (this.mode === 'preview') this.preview.dist = Math.max(2.5, Math.min(8, this.preview.dist + Math.sign(e.deltaY) * 0.4)); }, { passive: true });
  }

  // ------------------------------------------------------------------ per-frame
  // view: { fighters, projectiles, zones, state, winner }
  updateGame(dt, view, myId, input) {
    this.mode = 'game';
    const F = view.fighters;
    for (let i = 0; i < 2; i++) {
      const f = F[i], ch = this.chars[i]; if (!f || !ch) continue;
      const cs = this.charState[i];
      // smooth remote positions slightly to hide network jitter
      const smooth = i === myId ? 1 : 1 - Math.exp(-dt * 20);
      const rp = ch.root.position;
      if (Math.hypot(f.x - rp.x, f.z - rp.z) > 6) { rp.set(f.x, f.y, f.z); }
      else { rp.x += (f.x - rp.x) * smooth; rp.y += (f.y - rp.y) * smooth; rp.z += (f.z - rp.z) * smooth; }
      // speed estimation
      const dx = rp.x - (cs.px ?? rp.x), dz = rp.z - (cs.pz ?? rp.z);
      const v = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
      cs.speed += (v - cs.speed) * (1 - Math.exp(-dt * 12));
      cs.px = rp.x; cs.pz = rp.z;
      const baseSpeed = CLASSES[f.cls].speed;
      // facing: face the target briefly when casting or after using an ability
      let yaw = f.yaw;
      const o = F[1 - i];
      if ((f.cast || cs.faceT > 0) && o && f.alive) yaw = Math.atan2(o.x - f.x, o.z - f.z);
      cs.faceT -= dt;
      if (cs.yaw === undefined) cs.yaw = yaw;
      cs.yaw += angleDiff(cs.yaw, yaw) * (1 - Math.exp(-dt * 16));
      ch.root.rotation.y = cs.yaw;
      // movement direction relative to facing (for backpedal/strafe animation)
      let back = false, strafe = 0;
      if (v > 0.5) {
        const mv = Math.atan2(dx, dz), d = angleDiff(cs.yaw, mv);
        back = Math.abs(d) > 2.0;
        strafe = Math.abs(d) > 0.6 && Math.abs(d) < 2.5 ? Math.sign(d) : 0;
      }
      const won = (view.state === 'roundEnd' || view.state === 'matchEnd') && f.alive && view.lastWinner === i;
      ch.update(dt, {
        speed: f.alive ? cs.speed / baseSpeed : 0, back, strafe, air: f.y > 0.1, casting: !!f.cast, castProgress: f.cast ? f.cast.t / f.cast.dur : 0,
        stunned: hasBuff(f, 'stun'), disoriented: hasBuff(f, 'disorient'), dead: !f.alive, victory: won, tempest: hasBuff(f, 'tempest'),
      });
      // stealth visibility
      let op = 1;
      if (hasBuff(f, 'stealth')) {
        if (i === myId) op = 0.3;
        else { const me = F[myId]; const d = me ? Math.hypot(me.x - f.x, me.z - f.z) : 99; op = d < 5 ? 0.12 : 0; }
      }
      ch.setOpacity(op);
    }
    this.vfx.syncProjectiles(view.projectiles, dt);
    this.vfx.syncZones(view.zones, dt);
    // stealth: never reveal an invisible enemy through their buff effects
    this.vfx.syncBuffs(F.map((f, i) => (i !== myId && hasBuff(f, 'stealth')) ? { ...f, buffs: [] } : f), this.chars, dt, this.time);
    this.updateGameCamera(dt, F[myId], input);
  }

  onAbilityAnim(id, ab) {
    const ch = this.chars[id]; if (!ch) return;
    const kind = AB_ANIM[ab];
    if (kind) ch.play(kind, kind === 'raise' ? 0.7 : kind === 'slam' ? 0.6 : 0.42);
    if (this.charState[id]) this.charState[id].faceT = 0.5;
  }
  onAuto(id) { const ch = this.chars[id]; if (!ch) return; ch.play(ch.cls === 'rogue' ? 'stab' : 'slash', ch.cls === 'rogue' ? 0.35 : 0.5); }
  onHitFlinch(id) { const ch = this.chars[id]; if (ch && !ch.act) ch.hit(); }
  onDash(id, fx) { const ch = this.chars[id]; if (ch) ch.play(fx === 'bull_rush' ? 'charge' : 'dash', fx === 'bull_rush' ? 0.6 : 0.35); }

  updateGameCamera(dt, me, input) {
    if (!me) return;
    const ch = this.chars[me.id ?? 0];
    const p = ch ? ch.root.position : new THREE.Vector3(me.x, me.y, me.z);
    const yaw = input.yaw, pitch = input.pitch;
    let dist = input.zoom;
    const target = new THREE.Vector3(p.x, p.y + 1.9, p.z);
    const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    // camera collision with pillars (2D ray vs circles)
    for (const pl of PILLARS) {
      const ox = target.x - pl.x, oz = target.z - pl.z, dx = dir.x, dz = dir.z;
      const a = dx * dx + dz * dz; if (a < 1e-6) continue;
      const b = 2 * (ox * dx + oz * dz), c = ox * ox + oz * oz - (pl.r + 0.35) ** 2;
      const disc = b * b - 4 * a * c;
      if (disc > 0) { const t = (-b - Math.sqrt(disc)) / (2 * a); if (t > 0 && t < dist && target.y + dir.y * t < 8.5) dist = Math.max(1.5, t - 0.2); }
    }
    const want = target.clone().addScaledVector(dir, dist);
    if (want.y < 0.4) want.y = 0.4;
    const k = 1 - Math.exp(-dt * 18);
    this.camPos.lerp(want, k);
    this.camLook.lerp(target, 1 - Math.exp(-dt * 25));
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 2.5); const s = this.shake * 0.25; this.camera.position.x += (Math.random() - 0.5) * s; this.camera.position.y += (Math.random() - 0.5) * s; }
    this.camera.lookAt(this.camLook);
  }

  addShake(a) { this.shake = Math.min(1.2, this.shake + a); }

  render(dt) {
    this.time += dt;
    this.arena.update(dt, this.vfx);
    if (this.mode === 'menu') {
      this.menuT = (this.menuT || 0) + dt;
      const t = this.menuT * 0.05;
      this.camera.position.set(Math.sin(t) * 26, 7 + Math.sin(t * 2) * 1.5, Math.cos(t) * 26);
      this.camera.lookAt(0, 3, 0);
      for (const c of this.chars) if (c) c.update(dt, { speed: 0 });
    } else if (this.mode === 'preview') {
      const c = this.preview.char;
      if (c) { c.root.rotation.y = this.preview.yaw; if (!this.preview.dragging) this.preview.yaw += dt * 0.15; c.update(dt, { speed: 0 }); }
      const d = this.preview.dist;
      // frame the champion slightly left of centre (details panel is on the right)
      const sx = 0.6 * d / 5 * Math.min(1.4, 1100 / innerWidth);
      this.camera.position.set(sx, 1.35 + d * 0.06, d);
      this.camera.lookAt(sx, 1.0, 0);
      if (Math.random() < dt * 6) { const a = Math.random() * 6.28; this.vfx.emit({ x: Math.sin(a) * 1.4, y: 0.05, z: Math.cos(a) * 1.4, vy: 0.8 + Math.random(), life: 1.5, size: 0.18, color: 0xffd8a0 }); }
    }
    this.vfx.update(dt);
    if (this.useBloom) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }
}
