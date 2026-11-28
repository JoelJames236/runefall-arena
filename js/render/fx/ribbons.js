// Ribbons (docs/remodel/06 §2, the 'ribbon' mesh-FX primitive): strips for weapon trails, beams and chains — no
// tubes. One geometry holds every ribbon slot (64 × 16 samples); one draw.
//
// Two kinds of strip share the slots and the shader:
//   edge  — the CPU gives both edges of every sample (weapon trails: trail_base → tip, swept over time)
//   face  — the CPU gives a centre line + tangent; the vertex shader turns it to face the camera (beams, chains)
//           and can jag it per frame (lightning) without any CPU write.
// Profile (aD.w 'cell'): ≥ 0 an atlas strip cell scrolled along u · -1 soft beam · -2 chain links · -3 trail
//
// Vertex (20 floats): aA = (x, y, z, u)  aB = (tangent xyz, half width | 0 for edge strips)
//                     aC = (r, g, b, a) linear  aD = (t0, dur, side -1 | +1, cell)  aE = (jag m, scroll, repeat, fadeOut s)
import * as THREE from 'three';
import { ATLAS_GLSL, ATLAS_TILE_GLSL, COMMON_GLSL, FOG_GLSL, COLLAPSE, addRange } from './glsl.js';

export const RIB = { slots: 64, samples: 16 };
const VS = 20;
export const PROFILE = { soft: -1, chain: -2, trail: -3 };

const VERT = /* glsl */`
${COMMON_GLSL}
attribute vec4 aA, aB, aC, aD, aE;
uniform float uTime, uKill;
varying vec4 vCol;
varying float vU, vSide, vCell, vZ, vFade, vRep, vScroll, vLen;
void main() {
  float age = uTime - aD.x;
  if (age < 0.0 || age > aD.y || aD.x < uKill) { ${COLLAPSE} }
  vec3 p = aA.xyz;
  if (aB.w > 0.0) {
    vec3 t = normalize(aB.xyz + 1e-6);
    vec3 toCam = normalize(cameraPosition - p);
    vec3 side = cross(t, toCam); float sl = length(side); side = sl > 1e-5 ? side / sl : vec3(0.0, 1.0, 0.0);
    if (aE.x > 0.0) {                                   // lightning: re-jag 24 times a second
      float seed = floor(uTime * 24.0) * 1.37 + aD.x * 3.1;
      float k = sin(aA.w * 3.14159);
      vec3 n2 = cross(t, side);
      p += (side * (hash11(aA.w * 91.7 + seed) * 2.0 - 1.0) + n2 * (hash11(aA.w * 53.3 + seed + 7.0) * 2.0 - 1.0) * 0.6) * aE.x * k;
    }
    p += side * aD.z * aB.w;
  }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vZ = -mv.z; vU = aA.w; vSide = aD.z; vCell = aD.w; vCol = aC;
  vRep = aE.z; vScroll = aE.y;
  vFade = aE.w > 0.0 ? clamp((aD.y - age) / aE.w, 0.0, 1.0) : 1.0;
}`;

const FRAG = /* glsl */`
${ATLAS_GLSL}
${ATLAS_TILE_GLSL}
${COMMON_GLSL}
${FOG_GLSL}
uniform float uTime;
varying vec4 vCol;
varying float vU, vSide, vCell, vZ, vFade, vRep, vScroll, vLen;
void main() {
  float v = clamp(vSide, -1.0, 1.0);   // -1 … +1 across the strip (MSAA samples may extrapolate past it)
  float prof;
  if (vCell > -0.5) prof = atlasTile(vCell, vec2(vU * vRep - uTime * vScroll, v * 0.5 + 0.5)).a;
  else if (vCell > -1.5) { prof = 1.0 - v * v; prof *= prof; }
  else if (vCell > -2.5) {             // chain: alternating links, one seen flat (ring), the next edge-on (bar)
    float x = fract(vU * vRep), id = floor(vU * vRep);
    vec2 q = vec2((x - 0.5) * 2.0, v);
    float ring = abs(length(q * vec2(1.0, 1.25)) - 0.62);
    float link = mod(id, 2.0) < 1.0 ? 1.0 - smoothstep(0.1, 0.2, ring) : (1.0 - smoothstep(0.18, 0.3, abs(v))) * (1.0 - smoothstep(0.8, 0.95, abs(q.x)));
    prof = link;
  } else {                             // weapon trail: soft at the base, brightest just inside the tip edge
    float w = v * 0.5 + 0.5;
    prof = smoothstep(0.0, 0.55, w) * (1.0 - smoothstep(0.9, 1.0, w)) * (0.45 + 0.55 * w);
  }
  float a = vCol.a * prof * vFade;
  if (a < 0.002) discard;
  gl_FragColor = vec4(applyFog(vCol.rgb, vZ, true), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Ribbons {
  constructor(uniforms, renderOrder = 4) {
    const S = RIB.slots, N = RIB.samples;
    this.v = new Float32Array(S * N * 2 * VS);
    for (let i = 0; i < S * N * 2; i++) this.v[i * VS + 12] = -1e9; // aD.x = t0: dead
    const buf = this.buf = new THREE.InterleavedBuffer(this.v, VS).setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(buf, 3, 0)); // bounds only (frustum culling is off)
    geo.setAttribute('aA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    geo.setAttribute('aB', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    geo.setAttribute('aC', new THREE.InterleavedBufferAttribute(buf, 4, 8));
    geo.setAttribute('aD', new THREE.InterleavedBufferAttribute(buf, 4, 12));
    geo.setAttribute('aE', new THREE.InterleavedBufferAttribute(buf, 4, 16));
    const idx = [];
    for (let s = 0; s < S; s++) for (let k = 0; k < N - 1; k++) { const a = (s * N + k) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
      vertexShader: VERT, fragmentShader: FRAG, fog: true,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = renderOrder; this.mesh.name = 'fx_ribbons'; this.mesh.visible = false;
    this.death = new Float32Array(S).fill(-1e9);
    this.persist = new Uint8Array(S);
    this.gen = new Uint32Array(S);
    this.dirty = new Uint8Array(S); this.anyDirty = false;
    this.cursor = 0; this.time = 0;
  }

  alloc(persistent = false) {
    const S = RIB.slots, T = this.time;
    let pick = -1, oldest = Infinity;
    for (let k = 0; k < S; k++) {
      const i = (this.cursor + k) % S;
      if (this.persist[i]) continue;
      if (this.death[i] < T) { pick = i; break; }
      if (this.death[i] < oldest) { oldest = this.death[i]; pick = i; }
    }
    if (pick < 0) return -1;
    this.cursor = (pick + 1) % S; this.persist[pick] = persistent ? 1 : 0; this.gen[pick]++;
    return pick;
  }
  free(i) { if (i < 0) return; this.persist[i] = 0; this.death[i] = -1e9; this.kill(i); }

  // per-slot constants written into every vertex of the slot (from sample k on)
  header(i, t0, dur, cell, jag, scroll, repeat, fadeOut, from = 0) {
    const N = RIB.samples, v = this.v;
    for (let k = from * 2; k < N * 2; k++) {
      const o = ((i * N) * 2 + k) * VS;
      v[o + 12] = t0; v[o + 13] = dur; v[o + 14] = k & 1 ? 1 : -1; v[o + 15] = cell;
      v[o + 16] = jag; v[o + 17] = scroll; v[o + 18] = repeat; v[o + 19] = fadeOut;
    }
    this.death[i] = t0 + dur;
    this.dirty[i] = 1; this.anyDirty = true;
  }
  kill(i) { const N = RIB.samples, v = this.v; for (let k = 0; k < N * 2; k++) v[((i * N) * 2 + k) * VS + 12] = -1e9; this.dirty[i] = 1; this.anyDirty = true; }

  // edge strip sample k: base and tip edge points, u along, colour + alpha
  edge(i, k, bx, by, bz, tx, ty, tz, u, r, g, b, a) {
    const v = this.v, o = ((i * RIB.samples + k) * 2) * VS, o2 = o + VS;
    v[o] = bx; v[o + 1] = by; v[o + 2] = bz; v[o + 3] = u; v[o + 4] = v[o + 5] = v[o + 6] = v[o + 7] = 0;
    v[o + 8] = r; v[o + 9] = g; v[o + 10] = b; v[o + 11] = a;
    v[o2] = tx; v[o2 + 1] = ty; v[o2 + 2] = tz; v[o2 + 3] = u; v[o2 + 4] = v[o2 + 5] = v[o2 + 6] = v[o2 + 7] = 0;
    v[o2 + 8] = r; v[o2 + 9] = g; v[o2 + 10] = b; v[o2 + 11] = a;
  }
  // face strip sample k: centre, tangent, half width
  face(i, k, x, y, z, tx, ty, tz, hw, u, r, g, b, a) {
    const v = this.v, o = ((i * RIB.samples + k) * 2) * VS;
    for (let s = 0; s < 2; s++) {
      const q = o + s * VS;
      v[q] = x; v[q + 1] = y; v[q + 2] = z; v[q + 3] = u; v[q + 4] = tx; v[q + 5] = ty; v[q + 6] = tz; v[q + 7] = hw;
      v[q + 8] = r; v[q + 9] = g; v[q + 10] = b; v[q + 11] = a;
    }
  }
  // samples n … 15 repeat sample n-1 (degenerate triangles, nothing drawn)
  pad(i, n) {
    const N = RIB.samples, v = this.v, src = ((i * N + n - 1) * 2) * VS;
    for (let k = n; k < N; k++) { const o = ((i * N + k) * 2) * VS; for (let j = 0; j < VS * 2; j++) v[o + j] = v[src + j]; }
  }
  touch(i) { this.dirty[i] = 1; this.anyDirty = true; }

  commit(time) {
    this.time = time;
    const S = RIB.slots, N = RIB.samples;
    let hi = 0;
    for (let i = 0; i < S; i++) if (this.death[i] > time || this.persist[i]) hi = i + 1;
    if (this.anyDirty) {
      let run = -1;
      for (let i = 0; i <= S; i++) {
        const d = i < S && this.dirty[i];
        if (d && run < 0) run = i;
        if (!d && run >= 0) { addRange(this.buf, run * N * 2 * VS, (i - run) * N * 2 * VS); run = -1; }
        if (i < S) this.dirty[i] = 0;
      }
      this.buf.needsUpdate = true; this.anyDirty = false;
    }
    this.geo.setDrawRange(0, hi * (N - 1) * 6);
    this.mesh.visible = hi > 0;
  }
  clear() { this.death.fill(-1e9); this.persist.fill(0); this.geo.setDrawRange(0, 0); this.mesh.visible = false; }
  live(time) { let n = 0; for (let i = 0; i < RIB.slots; i++) if (this.death[i] > time) n++; return n; }
}
