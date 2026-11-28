// GLSL shared by every FX material: atlas addressing, sRGB decode, soft-particle depth, fog, cheap hash.
// Uniforms named here are shared objects owned by FX (one update per frame reaches every material).

export const ATLAS_GLSL = /* glsl */`
uniform sampler2D uAtlas;
// a single 256² cell (0–63, row-major from the image's top-left); uv 0..1 inside it, +v up
vec2 atlasCell(float cell, vec2 uv) {
  float c = mod(cell, 8.0), r = floor(cell / 8.0);
  uv = clamp(uv, 0.002, 0.998);
  return (vec2(c, r) + vec2(uv.x, 1.0 - uv.y)) * 0.125;
}
// a frame (0–15) of the flipbook whose 2 × 2-cell block starts at cell 'block'
vec2 atlasFrame(float block, float frame, vec2 uv) {
  float c = mod(block, 8.0), r = floor(block / 8.0);
  float fc = mod(frame, 4.0), fr = floor(frame / 4.0);
  uv = clamp(uv, 0.004, 0.996);
  return (vec2(c, r) + (vec2(fc, fr) + vec2(uv.x, 1.0 - uv.y)) * 0.5) * 0.125;
}
`;

// fragment shaders only (derivatives)
export const ATLAS_TILE_GLSL = /* glsl */`
// a tiling cell sampled with wrapped uv, with gradients of the unwrapped uv (no mip seam at the wrap)
vec4 atlasTile(float cell, vec2 uv) {
  vec2 g = fract(uv);
  float c = mod(cell, 8.0), r = floor(cell / 8.0);
  vec2 a = (vec2(c, r) + vec2(g.x, 1.0 - g.y) * 0.996 + 0.002) * 0.125;
  return textureGrad(uAtlas, a, dFdx(uv) * 0.125, dFdy(uv) * 0.125);
}
`;

export const COMMON_GLSL = /* glsl */`
vec3 srgbToLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
`;

// soft particles: fade where the particle meets opaque geometry (scene depth from the composer's render target)
export const SOFT_GLSL = /* glsl */`
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform float uSoft, uNear, uFar;
float sceneViewZ(vec2 fragXY) {
  float d = texture2D(uDepth, fragXY / uRes).x;
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
float softFade(float viewZ, float range) {
  if (uSoft < 0.5 || range <= 0.0) return 1.0;
  return clamp((sceneViewZ(gl_FragCoord.xy) - viewZ) / range, 0.0, 1.0);
}
`;

// fog: three fills fogColor / fogDensity / fogNear / fogFar when the material has fog: true
export const FOG_GLSL = /* glsl */`
#ifdef USE_FOG
uniform vec3 fogColor;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear, fogFar;
#endif
#endif
float fogAmount(float z) {
#ifdef USE_FOG
#ifdef FOG_EXP2
  return 1.0 - exp(-fogDensity * fogDensity * z * z);
#else
  return smoothstep(fogNear, fogFar, z);
#endif
#else
  return 0.0;
#endif
}
// additive light fades away in fog; alpha-blended matter turns fog-coloured
vec3 applyFog(vec3 c, float z, bool additive) {
#ifdef USE_FOG
  float f = fogAmount(z);
  return additive ? c * (1.0 - f) : mix(c, fogColor, f);
#else
  return c;
#endif
}
`;

export const COLLAPSE = 'gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return;';

// addUpdateRange without garbage: three's version pushes a new { start, count } every call; these objects are
// reused per buffer (the renderer clears the list after uploading, so the same objects come back next frame)
export function addRange(buf, start, count) {
  const pool = buf._fxRanges || (buf._fxRanges = []), k = buf.updateRanges.length;
  let r = pool[k]; if (!r) r = pool[k] = { start: 0, count: 0 };
  r.start = start; r.count = count; buf.updateRanges.push(r);
}
