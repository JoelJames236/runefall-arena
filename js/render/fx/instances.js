// Fixed-capacity instanced effect slots (mesh FX primitives, ground decals). Each slot = an instance matrix + one
// 16-float data block the shader animates from; the CPU writes a slot when it spawns, again only if it follows a
// moving object or is ended early. Made once at load; never resized, created or disposed during a match.
//
// Data block layout shared by every instanced FX shader: d0 = (t0, dur, fadeIn, fadeOut) — the rest is per shader.
import * as THREE from 'three';
import { addRange } from './glsl.js';

export const DS = 16; // floats per data block
const V = new THREE.Vector3();

export class InstancePool {
  constructor({ geometry, material, cap, renderOrder, name }) {
    this.cap = cap; this.name = name;
    this.data = new Float32Array(cap * DS);
    for (let i = 0; i < cap; i++) { this.data[i * DS] = -1e9; this.data[i * DS + 1] = 0; }
    const buf = this.buf = new THREE.InstancedInterleavedBuffer(this.data, DS, 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('d0', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    geometry.setAttribute('d1', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    geometry.setAttribute('d2', new THREE.InterleavedBufferAttribute(buf, 4, 8));
    geometry.setAttribute('d3', new THREE.InterleavedBufferAttribute(buf, 4, 12));
    this.mesh = new THREE.InstancedMesh(geometry, material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = renderOrder; this.mesh.name = name;
    this.mesh.count = 0; this.mesh.visible = false;
    this.M = this.mesh.instanceMatrix.array;
    this.death = new Float32Array(cap).fill(-1e9);
    this.persist = new Uint8Array(cap);
    this.gen = new Uint32Array(cap);
    this.follow = new Array(cap).fill(null);
    this.off = new Float32Array(cap * 3);
    this.dirty = new Uint8Array(cap); this.anyDirty = false;
    this.nFollow = 0; this.cursor = 0; this.time = 0;
  }

  // a free slot (a dead one, else the oldest non-persistent one is recycled); -1 when every slot is persistent
  alloc(persistent = false) {
    const T = this.time;
    let pick = -1, oldest = Infinity;
    for (let k = 0; k < this.cap; k++) {
      const i = (this.cursor + k) % this.cap;
      if (this.persist[i]) continue;
      if (this.death[i] < T) { pick = i; break; }
      if (this.death[i] < oldest) { oldest = this.death[i]; pick = i; }
    }
    if (pick < 0) return -1;
    this.cursor = (pick + 1) % this.cap;
    if (this.follow[pick]) { this.follow[pick] = null; this.nFollow--; }
    this.persist[pick] = persistent ? 1 : 0; this.gen[pick]++;
    return pick;
  }

  // envelope: t0 = now, dur (s; Infinity / 0 → persistent until ended), fade in / out (s)
  begin(i, dur, fadeIn, fadeOut) {
    const d = this.data, o = i * DS, persistent = !(dur > 0 && dur < 1e5);
    d[o] = this.time; d[o + 1] = persistent ? 1e6 : dur; d[o + 2] = fadeIn; d[o + 3] = fadeOut;
    this.death[i] = this.time + d[o + 1];
    this.markDirty(i);
  }

  // instance transform: position, rotation about an axis given as a unit "up" (nx, ny, nz) plus a yaw about it, scale
  setTransform(i, x, y, z, sx, sy, sz, nx = 0, ny = 1, nz = 0, yaw = 0) {
    // basis: Y = n, X / Z perpendicular, then turned by yaw about Y
    let ax, ay, az; // a helper axis not parallel to n
    if (Math.abs(ny) < 0.99) { ax = 0; ay = 1; az = 0; } else { ax = 1; ay = 0; az = 0; }
    // X = normalize(a × n) … with a = up this keeps X horizontal for tilted rings
    let Xx = ay * nz - az * ny, Xy = az * nx - ax * nz, Xz = ax * ny - ay * nx;
    let l = Math.hypot(Xx, Xy, Xz) || 1; Xx /= l; Xy /= l; Xz /= l;
    let Zx = Xy * nz - Xz * ny, Zy = Xz * nx - Xx * nz, Zz = Xx * ny - Xy * nx;
    if (yaw) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const X2x = Xx * c - Zx * s, X2y = Xy * c - Zy * s, X2z = Xz * c - Zz * s;
      const Z2x = Xx * s + Zx * c, Z2y = Xy * s + Zy * c, Z2z = Xz * s + Zz * c;
      Xx = X2x; Xy = X2y; Xz = X2z; Zx = Z2x; Zy = Z2y; Zz = Z2z;
    }
    const m = this.M, o = i * 16;
    m[o] = Xx * sx; m[o + 1] = Xy * sx; m[o + 2] = Xz * sx; m[o + 3] = 0;
    m[o + 4] = nx * sy; m[o + 5] = ny * sy; m[o + 6] = nz * sy; m[o + 7] = 0;
    m[o + 8] = Zx * sz; m[o + 9] = Zy * sz; m[o + 10] = Zz * sz; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
    this.markDirty(i);
  }

  setFollow(i, obj, ox = 0, oy = 0, oz = 0) {
    if (!this.follow[i] && obj) this.nFollow++;
    if (this.follow[i] && !obj) this.nFollow--;
    this.follow[i] = obj || null; this.off[i * 3] = ox; this.off[i * 3 + 1] = oy; this.off[i * 3 + 2] = oz;
  }

  // end a (persistent) slot: it fades out over its fadeOut from now (gen guards against a recycled slot)
  end(i, gen, fadeOut) {
    if (i < 0 || this.gen[i] !== gen) return;
    const d = this.data, o = i * DS, age = this.time - d[o];
    if (fadeOut !== undefined) d[o + 3] = Math.max(0.001, fadeOut);
    d[o + 1] = Math.max(0, age) + d[o + 3];
    this.death[i] = d[o] + d[o + 1];
    this.persist[i] = 0;
    this.markDirty(i);
  }

  markDirty(i) { this.dirty[i] = 1; this.anyDirty = true; }

  commit(time) {
    this.time = time;
    let hi = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.death[i] > time || this.persist[i]) hi = i + 1;
      else if (this.follow[i]) { this.follow[i] = null; this.nFollow--; }
    }
    if (this.nFollow > 0) {
      for (let i = 0; i < hi; i++) {
        const obj = this.follow[i]; if (!obj) continue;
        obj.getWorldPosition(V);
        const m = this.M, o = i * 16;
        m[o + 12] = V.x + this.off[i * 3]; m[o + 13] = V.y + this.off[i * 3 + 1]; m[o + 14] = V.z + this.off[i * 3 + 2];
        this.dirty[i] = 1; this.anyDirty = true;
      }
    }
    if (this.anyDirty) {
      const im = this.mesh.instanceMatrix;
      let run = -1;
      for (let i = 0; i <= this.cap; i++) {
        const d = i < this.cap && this.dirty[i];
        if (d && run < 0) run = i;
        if (!d && run >= 0) { addRange(im, run * 16, (i - run) * 16); addRange(this.buf, run * DS, (i - run) * DS); run = -1; }
        if (i < this.cap) this.dirty[i] = 0;
      }
      im.needsUpdate = true; this.buf.needsUpdate = true; this.anyDirty = false;
    }
    this.mesh.count = hi;
    this.mesh.visible = hi > 0;
  }

  clear() {
    this.death.fill(-1e9); this.persist.fill(0); this.follow.fill(null); this.nFollow = 0;
    this.mesh.count = 0; this.mesh.visible = false;
  }

  live(time) { let n = 0; for (let i = 0; i < this.cap; i++) if (this.death[i] > time) n++; return n; }
}
