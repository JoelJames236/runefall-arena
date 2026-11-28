// Ground decals (docs/remodel/06 §2): instanced floor quads with a signed-distance shader — edge ring, fill, atlas
// runes, rotation, progress (timers). One draw for every decal on the field.
//
// Readability rule: an enemy's ground effect always shows its edge in hostile red-orange (#ff5a3a), a friendly one
// in its school colour — FX.decal() picks the edge colour, this module just draws it.
//
// Data block: d0 = (t0, dur, fadeIn, fadeOut)  d1 = edge (r, g, b, a)  d2 = fill (r, g, b, a)
//             d3 = (rune cell or -1, rune spin rad/s, timer s (0 = none), flags)
// flags: 1 fill grows outward with the timer (telegraph) · 2 fill sweeps clockwise with the timer (cast circle)
//        4 edge pulses, faster as the timer runs out · 8 runes tinted by the fill colour instead of the edge's
import * as THREE from 'three';
import { InstancePool } from './instances.js';
import { ATLAS_GLSL, COMMON_GLSL, FOG_GLSL, COLLAPSE } from './glsl.js';

export const DFLAG = { grow: 1, sweep: 2, pulse: 4, runeFill: 8 };

const VERT = /* glsl */`
attribute vec4 d0, d1, d2, d3;
uniform float uTime, uKill;
varying vec2 vP;
varying vec4 vEdge, vFill, vD3;
varying float vZ, vFade, vAge, vEw;
void main() {
  float age = uTime - d0.x;
  if (age < 0.0 || age > d0.y || d0.x < uKill) { ${COLLAPSE} }
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  vZ = -mv.z; vP = uv * 2.0 - 1.0; vAge = age;
  float r = length(instanceMatrix[0].xyz);           // the decal's radius (m)
  vEw = clamp(0.11 / max(r, 0.1), 0.02, 0.3);        // ~11 cm edge whatever the size
  vEdge = d1; vFill = d2; vD3 = d3;
  float fin = d0.z > 0.0 ? clamp(age / d0.z, 0.0, 1.0) : 1.0;
  float fout = d0.w > 0.0 ? clamp((d0.y - age) / d0.w, 0.0, 1.0) : 1.0;
  vFade = fin * fout;
}`;

const FRAG = /* glsl */`
${ATLAS_GLSL}
${COMMON_GLSL}
${FOG_GLSL}
varying vec2 vP;
varying vec4 vEdge, vFill, vD3;
varying float vZ, vFade, vAge, vEw;
void main() {
  float d = length(vP);
  float aa = max(fwidth(d) * 1.2, 0.004);
  if (d > 1.0 + aa) discard;
  float flags = vD3.w, timer = vD3.z;
  float prog = timer > 0.0 ? clamp(vAge / timer, 0.0, 1.0) : 1.0;
  // edge: a crisp ring just inside the radius, with a faint outer glow
  float ew = vEw;
  float edge = smoothstep(1.0 - ew - aa, 1.0 - ew + aa, d) * (1.0 - smoothstep(1.0 - aa, 1.0 + aa, d));
  edge += (1.0 - smoothstep(1.0 - ew * 3.0, 1.0 - ew, d)) * smoothstep(1.0 - ew * 4.0, 1.0 - ew, d) * 0.25;
  if (mod(flags, 8.0) >= 4.0) edge *= 0.55 + 0.45 * sin(vAge * (4.0 + 14.0 * prog));
  // fill: grows outward with the timer, or sweeps clockwise, or is just there; brighter toward the edge
  float fillR = mod(flags, 2.0) >= 1.0 ? prog : 1.0 - ew;
  float fill = (1.0 - smoothstep(fillR - aa * 2.0, fillR, d)) * mix(0.45, 1.0, d * d);
  if (mod(flags, 4.0) >= 2.0) {
    float ang = fract(atan(vP.x, vP.y) / 6.2831853 + 1.0);
    fill *= 0.25 + 0.75 * step(ang, prog);
  }
  if (mod(flags, 2.0) >= 1.0) fill += (1.0 - smoothstep(0.0, aa * 3.0, abs(d - prog))) * 0.8 * step(prog, 0.999); // the growing front
  // runes from the atlas, turning
  float rune = 0.0;
  if (vD3.x >= 0.0) {
    float s = vD3.y * vAge, cs = cos(s), sn = sin(s);
    vec2 q = mat2(cs, -sn, sn, cs) * vP;
    rune = texture2D(uAtlas, atlasCell(vD3.x, q * 0.5 + 0.5)).a * step(length(q), 1.0);
  }
  vec3 runeCol = flags >= 8.0 ? vFill.rgb : vEdge.rgb;
  vec3 rgb = vEdge.rgb * edge * vEdge.a + vFill.rgb * fill * vFill.a + runeCol * rune * 0.85;
  float a = clamp(edge * vEdge.a + fill * vFill.a + rune * 0.85, 0.0, 1.0) * vFade;
  if (a < 0.002) discard;
  gl_FragColor = vec4(applyFog(rgb * vFade, vZ, true), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Decals {
  constructor(uniforms, cap = 48, renderOrder = 1) {
    const geometry = new THREE.PlaneGeometry(2, 2); geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
      vertexShader: VERT, fragmentShader: FRAG, fog: true,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.pool = new InstancePool({ geometry, material, cap, renderOrder, name: 'fx_decals' });
  }

  // o: { x, y, z, r, yaw, dur, fadeIn, fadeOut, edge (THREE.Color linear), edgeA, fill, fillA, cell, spin, timer, flags, follow }
  spawn(o, time) {
    const P = this.pool; P.time = time;
    const persistent = !(o.dur > 0 && o.dur < 1e5);
    const i = P.alloc(persistent); if (i < 0) return null;
    P.setTransform(i, o.x, o.y, o.z, o.r, 1, o.r, 0, 1, 0, o.yaw || 0);
    P.begin(i, o.dur, o.fadeIn ?? 0.15, o.fadeOut ?? 0.3);
    const d = P.data, k = i * 16, e = o.edge, f = o.fill || o.edge;
    d[k + 4] = e.r; d[k + 5] = e.g; d[k + 6] = e.b; d[k + 7] = o.edgeA ?? 1;
    d[k + 8] = f.r; d[k + 9] = f.g; d[k + 10] = f.b; d[k + 11] = o.fillA ?? 0.18;
    d[k + 12] = o.cell ?? -1; d[k + 13] = o.spin || 0; d[k + 14] = o.timer || 0; d[k + 15] = o.flags || 0;
    if (o.follow) P.setFollow(i, o.follow, 0, o.oy ?? 0.05, 0);
    return { pool: P, i, gen: P.gen[i] };
  }

  commit(time) { this.pool.commit(time); }
  clear() { this.pool.clear(); }
}
