// Scene, camera, lighting, post-processing and the bridge between game state
// (sim or network view) and the visual representation.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// Final colour grade: gentle S-curve contrast, slightly desaturated mids, cool shadows /
// warm highlights split-tone, and a soft vignette — the "dark fantasy" film look.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.55 }, uSat: { value: 0.88 }, uContrast: { value: 1.08 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVignette, uSat, uContrast; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c = (c - 0.5) * uContrast + 0.5;
      vec3 shadowTint = vec3(0.94, 0.98, 1.06), highTint = vec3(1.05, 1.0, 0.92);
      c *= mix(shadowTint, highTint, smoothstep(0.15, 0.75, l));
      vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.25, length(d * vec2(1.15, 1.0)));
      c *= mix(1.0 - uVignette, 1.0, v);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};
import { createArena } from './arenas.js';
import { VFX } from './vfx.js';
import { Character as ProcCharacter } from './characters.js';
import { Character as HeroCharacter, heroesReady } from './heroes.js';
// realistic rigged champions when their assets loaded, procedural fallback otherwise
const makeChar = (cls, spec) => heroesReady() ? new HeroCharacter(cls, spec) : new ProcCharacter(cls);
import { PILLARS, BRIDGE, archY, floorAt, hasBuff, angleDiff } from '../sim/sim.js';
// height for ground rings: on a sloped ramp lift them so the flat ring isn't half buried
const ringY = (x, z, y, off) => { const fl = floorAt(x, z, y); return fl + (fl > 0.01 && fl < BRIDGE.H - 0.01 ? 0.42 : off); };
import { CLASSES, kit, kitOf } from '../data/classes.js';

const AB_ANIM = {
  frost_lance: 'release', flame_burst: 'release', glacial_nova: 'slam', mana_ward: 'raise', arcane_comet: 'release',
  viper_strike: 'stab', gutting_edge: 'finisher', skull_crack: 'finisher', shadow_leap: 'dash', death_mark: 'stab',
  rending_blow: 'slash', crippling_slash: 'slash', iron_bulwark: 'bash', shield_slam: 'bash',
  sacred_bolt: 'release', mend: 'raise', divine_aegis: 'raise', blinding_light: 'raise', halo_judgment: 'raise',
  lightning_lash: 'release', magma_burst: 'release', quake_totem: 'slam', gale_dash: 'dash', stoneskin_totem: 'slam', fire_spirit: 'raise',
  rending_axes: 'slash', headtaker: 'finisher', axe_throw: 'slam', undying_rage: 'raise', berserk: 'raise',
  skullsplitter: 'finisher', ground_breaker: 'slam', iron_hide: 'raise',
  fireball: 'release', frostbite: 'release', blazing_step: 'dash', meteor: 'raise', flame_ring: 'slam',
};
export { AB_ANIM };

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    // dusky atmospheric haze (dark-fantasy look); the HDRI sky is excluded from fog
    this.scene.fog = new THREE.FogExp2(0x2c2a32, 0.0052);
    this.scene.background = new THREE.Color(0x1a1418);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 2500);
    this.camera.position.set(0, 20, 50);

    // lighting: low warm sun (shadow caster), faint cool fill; the HDRI provides ambient/specular
    this.hemi = new THREE.HemisphereLight(0x8a90b0, 0x3a2a20, 0.45); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffb27a, 2.6);
    this.sun.position.set(-40, 32, 34);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.035; this.sun.shadow.radius = 3;
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    const moon = new THREE.DirectionalLight(0x7a90ff, 0.35); moon.position.set(30, 30, -40); this.scene.add(moon);

    // image-based lighting: neutral room env until the HDRI sky has loaded
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    this.loadSky();

    const st = JSON.parse(localStorage.getItem("runefall-settings") || "{}");
    this.arenaId = new URLSearchParams(location.search).get('arena') || st.arena || 'runefall';
    this.arena = createArena(this.arenaId, this.scene, st.quality || "high");
    this.vfx = new VFX(this.scene);

    // post: MSAA HDR target → bloom → tone map/sRGB → colour grade + vignette
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.3, 0.5, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

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

  // Swap the arena look. Disposes the old arena meshes.
  setArena(id) {
    if (id === this.arenaId) return this.arena.ready;
    const old = this.arena;
    this.scene.remove(old.group);
    old.group.traverse(o => { o.geometry?.dispose(); });
    this.arenaId = id;
    this.arena = createArena(id, this.scene, this.quality || 'high');
    return this.arena.ready;
  }

  // Dusk HDRI (Poly Haven, CC0): background sky + image-based lighting for every PBR material.
  loadSky() {
    new RGBELoader().load('assets/sky/qwantani_dusk_2_puresky_2k.hdr', tex => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const env = this.pmrem.fromEquirectangular(tex).texture;
      this.scene.environment = env;
      this.scene.environmentIntensity = 0.42;
      this.scene.background = tex;
      this.scene.backgroundIntensity = 0.55;
      this.scene.backgroundBlurriness = 0.02;
      this.scene.backgroundRotation = new THREE.Euler(0, 2.3, 0);
      this.scene.environmentRotation = new THREE.Euler(0, 2.3, 0);
    }, undefined, e => console.warn('HDRI sky failed to load', e));
  }

  setQuality(q) {
    this.quality = q;
    this.useBloom = q !== 'low';            // composer (grade) on high+medium
    if (this.bloom) this.bloom.enabled = q === 'high';
    this.vfx.setQuality(q);
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
    for (const r of this.rings || []) this.scene.remove(r);
    this.chars = []; this.rings = [];
    if (this.preview.char) { this.scene.remove(this.preview.char.root); this.preview.char = null; }
    this.vfx.clearAll();
  }

  // specs: [{ cls, team }] — one entry per fighter (index = fighter id)
  setFighters(specs, myId) {
    this.clearChars();
    const myTeam = specs[myId]?.team ?? 0;
    this.chars = specs.map(s => makeChar(s.cls, s.spec));
    for (const c of this.chars) this.scene.add(c.root);
    // team rings under each champion: gold = you, blue = ally, red = enemy
    this.rings = specs.map((s, i) => {
      const col = i === myId ? 0xffc04a : s.team === myTeam ? 0x4aa8ff : 0xff3a2a;
      const m = new THREE.Mesh(this.ringGeo || (this.ringGeo = new THREE.RingGeometry(0.62, 0.78, 40)), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.renderOrder = 2;
      this.scene.add(m); return m;
    });
    this.charState = specs.map(() => ({ speed: 0, faceT: 0 }));
    if (!this.selRing) {
      // WoW-style selection circles: rotating red (hostile target) and green (friendly target)
      const tex = this.vfx.selectionTexture();
      this.selRing = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: tex, color: 0xff3a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.selRing.rotation.x = -Math.PI / 2; this.selRing.renderOrder = 3;
      this.friendRing = new THREE.Mesh(this.selRing.geometry, new THREE.MeshBasicMaterial({ map: tex, color: 0x5aff7a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
      this.friendRing.rotation.x = -Math.PI / 2; this.friendRing.renderOrder = 3;
    }
    this.scene.add(this.selRing, this.friendRing);
    this.selRing.visible = this.friendRing.visible = false;
  }

  showMenuScene() {
    this.mode = 'menu';
    this.clearChars();
    if (this.selRing) { this.scene.remove(this.selRing, this.friendRing); }
    const line = [['warrior', -2.2, -3.5, 0], ['priest', 2.2, -4.5, 0], ['mage', 2.2, 3.5, Math.PI], ['rogue', -2.2, 4.2, Math.PI]];
    this.chars = line.map(([cls, x, z, yaw]) => { const c = makeChar(cls); c.root.position.set(x, 0, z); c.root.rotation.y = yaw; this.scene.add(c.root); return c; });
    this.menuT = 0;
  }

  showPreview(cls, spec) {
    this.mode = 'preview';
    this.clearChars();
    const c = makeChar(cls, spec);
    c.root.position.set(0, 0, 0);
    this.scene.add(c.root);
    this.preview.char = c;
    this.preview.yaw = 0.5;
    c.play('raise', 0.9);
    this.vfx.burst(0, 1, 0, [CLASSES[cls].color === undefined ? 0xffffff : new THREE.Color(CLASSES[cls].color).getHex(), 0xffffff], 18, 3, 0.7, 0.25, { up: 1 });
    this.vfx.groundRing(0, 0, new THREE.Color(CLASSES[cls].color).getHex(), 0.5, 2.4, 0.8, 0.08, 0.6);
  }

  previewAttack() {
    const c = this.preview.char; if (!c) return;
    c.play('attack', 0.5);
    const col = new THREE.Color(kit(c.cls, c.spec).auto.color).getHex();
    const p = c.focusWorld();
    this.vfx.burst(p.x, p.y, p.z, [col, 0xffffff], 24, 3, 0.5, 0.35);
  }

  // victory fireworks over the winners
  celebrate(winners) {
    let k = 0;
    const fire = () => {
      if (k++ > 7) return;
      for (const f of winners) {
        const x = f.x + (Math.random() - 0.5) * 6, z = f.z + (Math.random() - 0.5) * 6, y = 7 + Math.random() * 4;
        const cols = [[0xffd27a, 0xffffff], [0x8ad0ff, 0xffffff], [0xff8a5a, 0xffe0a0]][k % 3];
        this.vfx.burst(x, y, z, cols, 60, 9, 1.3, 0.35, { gravity: 4, drag: 1.2, grow: -0.4 });
        this.vfx.flash(x, y, z, cols[0], 40, 0.6);
      }
      setTimeout(fire, 260);
    };
    fire();
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
  updateGame(dt, view, myId, input, followId = myId) {
    this.mode = 'game';
    const F = view.fighters;
    const me = F[myId], myTeam = me ? me.team : 0;
    for (let i = 0; i < F.length; i++) {
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
      const baseSpeed = kitOf(f).speed;
      // facing: face the target briefly when casting or after using an ability
      let yaw = f.yaw;
      const o = F[f.cast && f.cast.tid >= 0 ? f.cast.tid : f.target];
      if ((f.cast || cs.faceT > 0) && o && o !== f && f.alive) yaw = Math.atan2(o.x - f.x, o.z - f.z);
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
      const won = (view.state === 'roundEnd' || view.state === 'matchEnd') && f.alive && view.lastWinner === f.team;
      ch.update(dt, {
        speed: f.alive ? cs.speed / baseSpeed : 0, back, strafe, air: f.y - floorAt(f.x, f.z, f.y) > 0.1, casting: !!f.cast, castProgress: f.cast ? f.cast.t / f.cast.dur : 0,
        stunned: hasBuff(f, 'stun'), disoriented: hasBuff(f, 'disorient'), dead: !f.alive, victory: won, tempest: hasBuff(f, 'tempest'),
      });
      // stealth visibility
      let op = 1;
      if (hasBuff(f, 'stealth')) {
        if (f.team === myTeam) op = 0.3;
        else { const d = me ? Math.hypot(me.x - f.x, me.z - f.z) : 99; op = d < 5 ? 0.12 : 0; }
      }
      ch.setOpacity(op);
      const ring = this.rings[i];
      if (ring) {
        ring.visible = f.alive && op > 0.05;
        ring.position.set(rp.x, ringY(rp.x, rp.z, rp.y, 0.05), rp.z);
        const s = 1 + (i === myId ? Math.sin(this.time * 3) * 0.04 : 0);
        ring.scale.set(s, s, s);
      }
    }
    // selection circles under the hostile target and the friendly target
    const t = me ? F[me.target] : null;
    const tv = t && t.alive && t.team !== myTeam && (!hasBuff(t, 'stealth')) && this.chars[t.id];
    this.selRing.visible = !!tv;
    if (tv) { const p = this.chars[t.id].root.position; this.selRing.position.set(p.x, ringY(p.x, p.z, p.y, 0.07), p.z); this.selRing.rotation.z += dt * 1.2; }
    const fr = me && me.friend >= 0 && me.friend !== me.id ? F[me.friend] : null;
    this.friendRing.visible = !!(fr && fr.alive && this.chars[fr.id]);
    if (this.friendRing.visible) { const p = this.chars[fr.id].root.position; this.friendRing.position.set(p.x, ringY(p.x, p.z, p.y, 0.07), p.z); this.friendRing.rotation.z -= dt * 1.0; }

    this.vfx.syncProjectiles(view.projectiles, dt);
    this.vfx.syncZones(view.zones, dt, myTeam, F);
    // stealth: never reveal an invisible enemy through their buff effects
    this.vfx.syncCasts(F, this.chars, f => kitOf(f).abilities[f.cast.idx]?.school, dt, this.time);
    this.vfx.syncBuffs(F.map(f => (f.team !== myTeam && hasBuff(f, 'stealth')) ? { ...f, buffs: [] } : f), this.chars, dt, this.time);
    this.updateGameCamera(dt, F[followId] || me, input);
  }

  // Screen-space pick: the visible enemy closest to the crosshair (for click-targeting).
  pickEnemy(view, myId, sx = 0.5, sy = 0.45) {
    const F = view.fighters, me = F[myId]; if (!me) return -1;
    let best = -1, bestD = 0.09;
    const v = new THREE.Vector3();
    for (const f of F) {
      if (f.team === me.team || !f.alive || hasBuff(f, 'stealth') || !this.chars[f.id]) continue;
      const p = this.chars[f.id].root.position;
      for (const h of [0.6, 1.2, 1.8]) {
        v.set(p.x, p.y + h, p.z).project(this.camera);
        if (v.z > 1) continue;
        const d = Math.hypot((v.x * 0.5 + 0.5) - sx, ((-v.y * 0.5 + 0.5) - sy) * (innerHeight / innerWidth));
        if (d < bestD) { bestD = d; best = f.id; }
      }
    }
    return best;
  }

  onAbilityAnim(id, ab) {
    const ch = this.chars[id]; if (!ch) return;
    const kind = AB_ANIM[ab];
    if (kind) ch.play(kind, kind === 'raise' ? 0.7 : kind === 'slam' ? 0.6 : 0.42);
    if (this.charState[id]) this.charState[id].faceT = 0.5;
  }
  onAuto(id) {
    const ch = this.chars[id]; if (!ch) return;
    ch.play('attack', ch.lookKey === 'berserker:executioner' ? 0.9 : { rogue: 0.36, warrior: 0.55, berserker: 0.5, mage: 0.42, priest: 0.42, shaman: 0.45 }[ch.cls] || 0.45);
    if (this.charState[id]) this.charState[id].faceT = 0.35;
  }
  onHitFlinch(id, crit) { const ch = this.chars[id]; if (ch && (!ch.act || crit)) ch.hit(crit ? 2 : 1); }
  onDash(id, fx) { const ch = this.chars[id]; if (ch) ch.play(fx === 'bull_rush' || fx === 'skull_leap' ? 'charge' : 'dash', fx === 'bull_rush' || fx === 'skull_leap' ? 0.7 : 0.35); }

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
    // camera collision with the bridge deck and ramps (marched along the ray)
    { const B = BRIDGE, end = B.hx + B.ramp;
      for (let t = 0.5; t < dist; t += 0.25) {
        const x = target.x + dir.x * t, y = target.y + dir.y * t, z = target.z + dir.z * t, ax = Math.abs(x);
        if (Math.abs(z) > B.hz + 0.55 || ax > end + 0.3) continue;
        const inDeck = ax <= B.hx + 0.3 && y > archY(Math.min(B.hx, ax)) - 0.25 && y < B.H + 0.15; // deck + vault masonry
        const inRamp = ax > B.hx && y < B.H * Math.max(0, Math.min(1, (end - ax) / B.ramp)) + 0.2;
        if (inDeck || inRamp) { dist = Math.max(1.2, t - 0.3); break; }
      } }
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
