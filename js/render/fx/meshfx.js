// Mesh FX (docs/remodel/06 §2): instanced primitives — ring, shell (sphere), cylinder, cone, disc — drawn with ONE
// FX shader (a define picks the primitive's profile): fresnel rim, scrolling atlas mask, dissolve, colour per
// instance, scale / spin / fade animated on the GPU from the spawn time. One draw per primitive in use.
//
// Data block: d0 = (t0, dur, fadeIn, fadeOut)  d1 = (r, g, b, alpha) linear colour
//             d2 = (scale0, scale1, spin rad/s, flags)  d3 = (cell, scroll, repeat, param)
// flags: 1 scale only x/z (pillars keep their height) · 2 dissolve on fade-out · 4 linear scale (default ease-out)
// param: ring = band thickness (fraction of the radius, ≤ 0.5) · shell / cylinder / cone = fresnel power
import * as THREE from 'three';
import { InstancePool } from './instances.js';
import { ATLAS_GLSL, ATLAS_TILE_GLSL, COMMON_GLSL, FOG_GLSL, COLLAPSE } from './glsl.js';
import { CELL } from './atlas-layout.js';

export const FLAG = { xz: 1, dissolve: 2, linear: 4 };

const VERT = /* glsl */`
attribute vec4 d0, d1, d2, d3;
uniform float uTime, uKill;
varying vec2 vTex;
varying vec4 vCol, vD3;
varying vec3 vN, vV;
varying float vZ, vFade, vFlags;
void main() {
  float age = uTime - d0.x;
  if (age < 0.0 || age > d0.y || d0.x < uKill) { ${COLLAPSE} }
  float flags = d2.w;
  float u = clamp(age / max(d0.y, 1e-3), 0.0, 1.0);
  if (d0.y > 1e5) u = clamp(age / max(d0.z, 1e-3), 0.0, 1.0); // persistent: grows over its fade-in
  float e = mod(flags, 8.0) >= 4.0 ? u : 1.0 - pow(1.0 - u, 3.0);
  float s = mix(d2.x, d2.y, e);
  vec3 lp = position, ln = normal;
  float sp = d2.z * age, cs = cos(sp), sn = sin(sp);
  lp.xz = mat2(cs, -sn, sn, cs) * lp.xz; ln.xz = mat2(cs, -sn, sn, cs) * ln.xz;
  if (mod(flags, 2.0) >= 1.0) lp.xz *= s; else lp *= s;
  vec4 wp = modelMatrix * instanceMatrix * vec4(lp, 1.0);
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * ln);
  vV = normalize(cameraPosition - wp.xyz);
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  vZ = -mv.z;
  vTex = uv;
  vCol = d1; vD3 = d3; vFlags = flags;
  float fin = d0.z > 0.0 ? clamp(age / d0.z, 0.0, 1.0) : 1.0;
  float fout = d0.w > 0.0 ? clamp((d0.y - age) / d0.w, 0.0, 1.0) : 1.0;
  vFade = fin * fout;
}`;

const FRAG = prim => /* glsl */`
#define ${prim}
${ATLAS_GLSL}
${ATLAS_TILE_GLSL}
${COMMON_GLSL}
${FOG_GLSL}
uniform float uTime;
varying vec2 vTex;
varying vec4 vCol, vD3;
varying vec3 vN, vV;
varying float vZ, vFade, vFlags;
void main() {
  float cell = vD3.x, scroll = vD3.y, rep = max(vD3.z, 1.0), param = vD3.w;
  float a = vCol.a;
  // varyings are clamped: MSAA samples outside a triangle extrapolate them, and pow() of a negative is NaN (which
  // bloom would smear over the whole screen)
  float fres = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), max(param, 0.5));
  vec2 vUv = clamp(vTex, 0.0, 1.0);
#if defined(PRIM_RING)
  float th = clamp(param, 0.02, 0.5) * 2.0;           // band thickness in v (the ring geometry spans r 0.5 … 1)
  float v = vUv.y;
  float band = smoothstep(1.0 - th, 1.0 - th * 0.35, v) * (1.0 - smoothstep(0.9, 1.0, v));
  a *= band;
  if (cell >= 0.0) a *= atlasTile(cell, vec2(vUv.x * rep + uTime * scroll, (v - (1.0 - th)) / th)).a;
#elif defined(PRIM_SHELL)
  float m = cell >= 0.0 ? atlasTile(cell, vec2(vUv.x * rep, vUv.y * rep * 0.5 + uTime * scroll)).a : 0.0;
  a *= 0.3 + 0.7 * fres + m * 0.6 * (0.4 + fres);
#elif defined(PRIM_CYL)
  float v = vUv.y;
  float m = cell >= 0.0 ? atlasTile(cell, vec2(vUv.x * rep, v - uTime * scroll)).a : 1.0;
  a *= pow(1.0 - v, 1.3) * smoothstep(0.0, 0.06, v) * (0.35 + 0.65 * fres) * m;
#elif defined(PRIM_CONE)
  float v = vUv.y;                                     // 0 at the base rim … 1 at the apex
  float m = cell >= 0.0 ? atlasTile(cell, vec2(vUv.x * rep, v - uTime * scroll)).a : 1.0;
  a *= smoothstep(0.0, 0.15, v) * (1.0 - smoothstep(0.55, 1.0, v)) * (0.4 + 0.6 * fres) * m;
#else // PRIM_DISC
  if (cell >= 0.0) a *= texture2D(uAtlas, atlasCell(cell, vUv)).a;
  else { float r = length(vUv * 2.0 - 1.0); a *= 1.0 - smoothstep(0.2, 1.0, r); }
#endif
  float fade = vFade;
  if (mod(vFlags, 4.0) >= 2.0 && fade < 1.0) {        // dissolve: noise eats the effect as it fades
    float n = atlasTile(${CELL.noise.toFixed(1)}, vUv * vec2(rep, 1.0) * 2.0).a;
    float k = smoothstep(1.0 - fade, 1.0 - fade + 0.12, n);
    a *= k; fade = 1.0;
  }
  a *= fade;
  if (a < 0.002) discard;
  gl_FragColor = vec4(applyFog(vCol.rgb, vZ, true), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// geometries: unit size, uv laid out for the profiles above
function ringGeometry(seg = 64) {
  const pos = [], uv = [], nor = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = i / seg * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (const [r, v] of [[0.5, 0], [1, 1]]) { pos.push(c * r, 0, s * r); uv.push(i / seg, v); nor.push(0, 1, 0); }
  }
  for (let i = 0; i < seg; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
  return g;
}
function discGeometry() { const g = new THREE.PlaneGeometry(2, 2); g.rotateX(-Math.PI / 2); return g; } // lies in x/z, faces +y
function cylGeometry() { const g = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true); g.translate(0, 0.5, 0); return g; } // base at y 0
function coneGeometry() { const g = new THREE.ConeGeometry(1, 1, 40, 1, true); g.translate(0, 0.5, 0); return g; }       // apex at y 1

export const PRIMS = {
  ring: { geo: ringGeometry, cap: 48, side: THREE.DoubleSide, def: 'PRIM_RING' },
  shell: { geo: () => new THREE.SphereGeometry(1, 36, 22), cap: 24, side: THREE.FrontSide, def: 'PRIM_SHELL' },
  cylinder: { geo: cylGeometry, cap: 24, side: THREE.DoubleSide, def: 'PRIM_CYL' },
  cone: { geo: coneGeometry, cap: 16, side: THREE.DoubleSide, def: 'PRIM_CONE' },
  disc: { geo: discGeometry, cap: 48, side: THREE.DoubleSide, def: 'PRIM_DISC' },
};

export class MeshFX {
  constructor(uniforms, renderOrder = 3) {
    this.pools = {};
    for (const [k, P] of Object.entries(PRIMS)) {
      const material = new THREE.ShaderMaterial({
        uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
        vertexShader: VERT, fragmentShader: FRAG(P.def), fog: true,
        transparent: true, depthWrite: false, depthTest: true, side: P.side, blending: THREE.AdditiveBlending,
      });
      this.pools[k] = new InstancePool({ geometry: P.geo(), material, cap: P.cap, renderOrder, name: 'fx_' + k });
    }
    this.list = Object.values(this.pools);
  }

  // o: { x, y, z, r0, r1, dur, color (linear THREE.Color), alpha, nx, ny, nz, yaw, sy (height for cylinders / cones),
  //      spin, fadeIn, fadeOut, flags, cell, scroll, repeat, param, follow, persistent }
  spawn(prim, o, time) {
    const P = this.pools[prim]; P.time = time;
    const persistent = !(o.dur > 0 && o.dur < 1e5);
    const i = P.alloc(persistent); if (i < 0) return null;
    const sy = o.sy ?? 1;
    P.setTransform(i, o.x, o.y, o.z, 1, prim === 'cylinder' || prim === 'cone' ? sy : 1, 1, o.nx ?? 0, o.ny ?? 1, o.nz ?? 0, o.yaw || 0);
    P.begin(i, o.dur, o.fadeIn ?? 0, o.fadeOut ?? (persistent ? 0.25 : (o.dur || 0) * 0.6));
    const d = P.data, k = i * 16, c = o.color;
    d[k + 4] = c.r; d[k + 5] = c.g; d[k + 6] = c.b; d[k + 7] = o.alpha ?? 1;
    d[k + 8] = o.r0 ?? 1; d[k + 9] = o.r1 ?? o.r0 ?? 1; d[k + 10] = o.spin || 0; d[k + 11] = o.flags || 0;
    d[k + 12] = o.cell ?? -1; d[k + 13] = o.scroll || 0; d[k + 14] = o.repeat || 1; d[k + 15] = o.param ?? 2.5;
    if (o.follow) P.setFollow(i, o.follow, o.ox || 0, o.oy || 0, o.oz || 0);
    return { pool: P, i, gen: P.gen[i] };
  }

  commit(time) { for (const P of this.list) P.commit(time); }
  clear() { for (const P of this.list) P.clear(); }
  live(time) { let n = 0; for (const P of this.list) n += P.live(time); return n; }
  draws() { let n = 0; for (const P of this.list) if (P.mesh.visible) n++; return n; }
}
