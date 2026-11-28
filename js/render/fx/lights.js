// Pooled flash lights (docs/remodel/06 §2): 4 point lights for the whole game, nothing persistent per projectile.
// While the old VFX still runs, FX ADOPTS its pool (same { L, t, dur, peak } slots, which VFX keeps fading) instead of
// adding four more lights — every lit material in the scene pays per point light. When VFX is retired, FX owns them.
import * as THREE from 'three';

export class FlashLights {
  constructor(scene, adopt = null, n = 4) {
    this.own = !adopt;
    this.pool = adopt || [];
    if (this.own) for (let i = 0; i < n; i++) { const L = new THREE.PointLight(0xffffff, 0, 14, 2); scene.add(L); this.pool.push({ L, t: 1, dur: 1, peak: 0 }); }
  }
  // the slot closest to done is reused
  flash(x, y, z, color, peak = 40, dur = 0.35, range = 14) {
    let slot = this.pool[0];
    for (const s of this.pool) if (s.t / s.dur > slot.t / slot.dur) slot = s;
    slot.L.color.setHex(color); slot.L.position.set(x, y, z); slot.L.distance = range;
    slot.t = 0; slot.dur = dur; slot.peak = peak;
  }
  update(dt) {
    if (!this.own) return; // the adopted pool is faded by its owner
    for (const s of this.pool) { s.t += dt; const u = Math.min(1, s.t / s.dur); s.L.intensity = s.peak * (1 - u) * (1 - u); }
  }
  clear() { for (const s of this.pool) { s.t = s.dur; if (this.own) s.L.intensity = 0; } }
}
