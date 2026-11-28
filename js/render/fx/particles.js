// GPU particle pool (docs/remodel/06 §2): instanced camera quads, simulated in the vertex shader from the spawn
// time and per-particle constants — the CPU writes a particle once, when it is born, and never again.
//
// Each pool is a ring buffer of `ring` slots (spawns overwrite the oldest) plus `held` slots at the end for
// persistent sprites the caller moves (projectile cores, overhead icons, orbiting stars). One draw per pool.
//
// Per particle (64 bytes float + 16 bytes uint8):
//   aP  x, y, z, t0           aV  vx, vy, vz, life        aS  size0, size1, gravity, drag
//   aR  rot0, spin, cell, fps (cell: 0–63 single, 64+ flipbook block; fps 0 = play the 16 frames over the life)
//   aC0/aC1/aC2  colour keys (sRGB rgb + alpha) at u = 0, mid, 1
//   aM  mode, stretch (s, ×64), mid (×255), intensity (×32)
// Modes: 0 billboard, 1 velocity-stretched, 2 flat on the ground, 3 upright (turns about Y only),
//        4 orbit (aV = radius, angular speed, bob height; aR.x = start angle) around aP.
import * as THREE from 'three';
import { ATLAS_GLSL, COMMON_GLSL, SOFT_GLSL, FOG_GLSL, COLLAPSE, addRange } from './glsl.js';

export const MODE = { billboard: 0, stretch: 1, ground: 2, upright: 3, orbit: 4 };
const FS = 16, BS = 16; // float / byte stride

const VERT = /* glsl */`
${ATLAS_GLSL}
${COMMON_GLSL}
attribute vec4 aP, aV, aS, aR, aC0, aC1, aC2, aM;
uniform float uTime, uKill;
varying vec2 vUv;
varying vec4 vCol;
varying float vZ, vSoft;
void main() {
  float age = uTime - aP.w, life = aV.w;
  if (age < 0.0 || age >= life || aP.w < uKill) { ${COLLAPSE} }
  float u = age / life;
  float mode = floor(aM.x * 255.0 + 0.5);
  vec3 p = aP.xyz, v = aV.xyz;
  float g = aS.z, k = aS.w;
  if (mode > 3.5) {                       // orbit around aP
    float an = aR.x + aV.y * age;
    p += vec3(cos(an) * aV.x, sin(age * 3.1) * aV.z, sin(an) * aV.x);
    v = vec3(-sin(an), 0.0, cos(an)) * aV.x * aV.y;
  } else if (k > 0.001) {                 // linear drag + gravity, closed form
    float e = exp(-k * age), f = (1.0 - e) / k;
    p += v * f; p.y -= g / k * (age - f);
    v = v * e; v.y -= g / k * (1.0 - e);
  } else {
    p += v * age; p.y -= 0.5 * g * age * age; v.y -= g * age;
  }
  float size = mix(aS.x, aS.y, u);
  float rot = aR.x + aR.y * age;
  vec2 c = position.xy;                   // quad corner, -0.5 … 0.5
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp;
  float cs = cos(rot), sn = sin(rot);
  if (mode > 0.5 && mode < 1.5) {         // stretched along the velocity, facing the camera
    float sp = length(v);
    vec3 dir = sp > 1e-4 ? v / sp : up;
    vec3 side = cross(dir, normalize(cameraPosition - p));
    float sl = length(side); side = sl > 1e-4 ? side / sl : right;
    float len = size + sp * aM.y * 255.0 / 64.0;
    wp = p + dir * (c.y * len) + side * (c.x * size);
  } else if (mode > 1.5 && mode < 2.5) {  // flat on the ground
    wp = p + vec3(c.x * cs - c.y * sn, 0.0, -(c.x * sn + c.y * cs)) * size;
  } else if (mode > 2.5 && mode < 3.5) {  // upright, turns about Y only
    vec3 r2 = normalize(vec3(right.x, 0.0, right.z) + 1e-5);
    wp = p + r2 * (c.x * size) + vec3(0.0, c.y * size, 0.0);
  } else {                                // billboard
    vec2 rc = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
    wp = p + right * rc.x + up * rc.y;
  }
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vZ = -mv.z;
  vSoft = mode > 1.5 && mode < 2.5 ? 0.0 : size * 0.45;
  vec2 luv = c + 0.5;
  float cell = aR.z;
  if (cell > 63.5) { float fr = aR.w > 0.0 ? mod(floor(age * aR.w), 16.0) : min(15.0, floor(u * 16.0)); vUv = atlasFrame(cell - 64.0, fr, luv); }
  else vUv = atlasCell(cell, luv);
  float mid = clamp(aM.z, 0.02, 0.98);
  vec4 c0 = vec4(srgbToLinear(aC0.rgb), aC0.a), c1 = vec4(srgbToLinear(aC1.rgb), aC1.a), c2 = vec4(srgbToLinear(aC2.rgb), aC2.a);
  vec4 col = u < mid ? mix(c0, c1, u / mid) : mix(c1, c2, (u - mid) / (1.0 - mid));
  col.a *= min(1.0, age * 30.0);
  col.rgb *= aM.w * 255.0 / 32.0;
  vCol = col;
}`;

const FRAG = additive => /* glsl */`
${ATLAS_GLSL}
${SOFT_GLSL}
${FOG_GLSL}
varying vec2 vUv;
varying vec4 vCol;
varying float vZ, vSoft;
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  float a = vCol.a * t.a * softFade(vZ, vSoft);
  if (a < 0.002) discard;
  vec3 rgb = applyFog(vCol.rgb * t.rgb, vZ, ${additive ? 'true' : 'false'});
  gl_FragColor = vec4(rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// the spawn description: one reusable object, filled by the building blocks (no allocation per particle)
export function particleSpec() {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size0: 0.3, size1: 0.3, gravity: 0, drag: 0, rot: 0, spin: 0,
    cell: 0, fps: 0, c0: 0xffffff, a0: 1, c1: 0xffffff, a1: 1, c2: 0xffffff, a2: 0, mid: 0.5, mode: 0, stretch: 0, intensity: 1, delay: 0 };
}

export class ParticlePool {
  // uniforms: the shared FX uniform objects { uTime, uKill, uAtlas, uDepth, uRes, uSoft, uNear, uFar }
  constructor({ capacity, held, additive, uniforms, renderOrder, name }) {
    this.cap = capacity; this.ring = capacity - held; this.name = name; this.additive = additive;
    this.f = new Float32Array(capacity * FS); this.b = new Uint8Array(capacity * BS);
    this.death = new Float32Array(capacity); // time each slot dies, for stats and the draw / skip decision
    this.head = 0; this.spawned = 0; this.lastDeath = -1;
    this.dirtyLo = 0; this.dirtyN = 0; this.heldDirty = false; this.heldLive = 0;
    this.freeHeld = new Int32Array(held); this.nFree = held;
    for (let i = 0; i < held; i++) this.freeHeld[i] = capacity - 1 - i;
    this.time = 0; this.kill = -1e9;
    for (let i = 0; i < capacity; i++) { this.f[i * FS + 3] = -1e9; this.f[i * FS + 7] = 0; this.death[i] = -1e9; }

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const fb = this.fbuf = new THREE.InstancedInterleavedBuffer(this.f, FS, 1).setUsage(THREE.DynamicDrawUsage);
    const bb = this.bbuf = new THREE.InstancedInterleavedBuffer(this.b, BS, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aP', new THREE.InterleavedBufferAttribute(fb, 4, 0));
    geo.setAttribute('aV', new THREE.InterleavedBufferAttribute(fb, 4, 4));
    geo.setAttribute('aS', new THREE.InterleavedBufferAttribute(fb, 4, 8));
    geo.setAttribute('aR', new THREE.InterleavedBufferAttribute(fb, 4, 12));
    geo.setAttribute('aC0', new THREE.InterleavedBufferAttribute(bb, 4, 0, true));
    geo.setAttribute('aC1', new THREE.InterleavedBufferAttribute(bb, 4, 4, true));
    geo.setAttribute('aC2', new THREE.InterleavedBufferAttribute(bb, 4, 8, true));
    geo.setAttribute('aM', new THREE.InterleavedBufferAttribute(bb, 4, 12, true));
    geo.instanceCount = 0;
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
      vertexShader: VERT, fragmentShader: FRAG(additive), fog: true,
      transparent: true, depthWrite: false, depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = renderOrder; this.mesh.name = name;
    this.mesh.visible = false;
  }

  // write slot i from spec P (born at time t0)
  write(i, P, t0) {
    const f = this.f, b = this.b, o = i * FS, q = i * BS;
    f[o] = P.x; f[o + 1] = P.y; f[o + 2] = P.z; f[o + 3] = t0;
    f[o + 4] = P.vx; f[o + 5] = P.vy; f[o + 6] = P.vz; f[o + 7] = P.life;
    f[o + 8] = P.size0; f[o + 9] = P.size1; f[o + 10] = P.gravity; f[o + 11] = P.drag;
    f[o + 12] = P.rot; f[o + 13] = P.spin; f[o + 14] = P.cell; f[o + 15] = P.fps;
    b[q] = (P.c0 >> 16) & 255; b[q + 1] = (P.c0 >> 8) & 255; b[q + 2] = P.c0 & 255; b[q + 3] = P.a0 * 255;
    b[q + 4] = (P.c1 >> 16) & 255; b[q + 5] = (P.c1 >> 8) & 255; b[q + 6] = P.c1 & 255; b[q + 7] = P.a1 * 255;
    b[q + 8] = (P.c2 >> 16) & 255; b[q + 9] = (P.c2 >> 8) & 255; b[q + 10] = P.c2 & 255; b[q + 11] = P.a2 * 255;
    b[q + 12] = P.mode; b[q + 13] = Math.min(255, P.stretch * 64); b[q + 14] = P.mid * 255; b[q + 15] = Math.min(255, P.intensity * 32);
    this.death[i] = t0 + P.life;
  }

  // a new particle in the ring (overwrites the oldest when full)
  emit(P) {
    const i = this.head;
    this.head = (i + 1) % this.ring;
    const t0 = this.time + (P.delay || 0);
    this.write(i, P, t0);
    if (this.dirtyN === 0) this.dirtyLo = i;
    this.dirtyN = Math.min(this.ring, this.dirtyN + 1);
    this.spawned++;
    if (t0 + P.life > this.lastDeath) this.lastDeath = t0 + P.life;
  }

  // persistent sprite: returns a slot (or -1 when all held slots are taken); move it with moveHeld, free it with release
  hold(P) {
    if (this.nFree === 0) return -1;
    const i = this.freeHeld[--this.nFree];
    P.life = 1e6; this.write(i, P, this.time);
    this.heldDirty = true; this.heldLive++;
    return i;
  }
  moveHeld(i, x, y, z) { const o = i * FS; this.f[o] = x; this.f[o + 1] = y; this.f[o + 2] = z; this.heldDirty = true; }
  release(i) {
    if (i < this.ring || i >= this.cap) return;
    this.f[i * FS + 7] = 0; this.death[i] = -1e9; this.heldDirty = true;
    this.freeHeld[this.nFree++] = i; this.heldLive--;
  }

  // upload what was written this frame, decide whether the pool draws at all
  commit(time) {
    this.time = time;
    const fb = this.fbuf, bb = this.bbuf;
    if (this.dirtyN > 0) {
      const lo = this.dirtyLo, n = this.dirtyN, end = lo + n;
      if (end <= this.ring) { addRange(fb, lo * FS, n * FS); addRange(bb, lo * BS, n * BS); }
      else { addRange(fb, lo * FS, (this.ring - lo) * FS); addRange(bb, lo * BS, (this.ring - lo) * BS); addRange(fb, 0, (end - this.ring) * FS); addRange(bb, 0, (end - this.ring) * BS); }
      fb.needsUpdate = bb.needsUpdate = true;
      this.dirtyN = 0;
    }
    if (this.heldDirty) {
      addRange(fb, this.ring * FS, (this.cap - this.ring) * FS); addRange(bb, this.ring * BS, (this.cap - this.ring) * BS);
      fb.needsUpdate = bb.needsUpdate = true; this.heldDirty = false;
    }
    const anyRing = time < this.lastDeath;
    this.mesh.visible = anyRing || this.heldLive > 0;
    // draw the ring part that was ever written (+ the held block when in use)
    this.geo.instanceCount = this.heldLive > 0 ? this.cap : Math.min(this.ring, this.spawned);
  }

  clear(time) {
    this.kill = time; this.lastDeath = -1; this.spawned = 0; this.head = 0; this.dirtyN = 0;
    for (let i = 0; i < this.cap; i++) this.death[i] = -1e9;
    this.nFree = 0; for (let i = this.cap - 1; i >= this.ring; i--) this.freeHeld[this.nFree++] = i;
    this.heldLive = 0;
  }

  live(time) { let n = 0; const d = this.death; for (let i = 0; i < this.cap; i++) if (d[i] > time) n++; return n; }
}
