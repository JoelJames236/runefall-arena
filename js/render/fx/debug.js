// Console harness for the new effect system: window.__fx
//   __fx.demo([x, z])     fire every building block around a point (default: in front of the camera)
//   __fx.loop(on, every)  repeat demo() every `every` s from the FX update (budget / heap tests)
//   __fx.stats()          live particles, FX draw calls, CPU ms per update, pool sizes …
//   __fx.bench(n)         ms per FX update, timed over n updates (the page's timer is too coarse for one)
//   __fx.frameDraws()     renderer draw calls of one whole rendered frame (all passes)
//   __fx.showAtlas(on)    overlay the 2048² atlas with its cell ids
//   __fx.atlasPNG()       the atlas as a PNG data URL (for the KTX2 bake)
import * as THREE from 'three';
import { CELL, CELLS, cellRect } from './atlas-layout.js';
import { SCHOOLS } from './palette.js';

export function installFxDebug(fx, world) {
  const ground = () => Math.max(0, (world.camLook?.y ?? 1.9) - 1.9); // the followed champion's floor
  const point = () => {
    const c = world.camera, d = new THREE.Vector3(); c.getWorldDirection(d); d.y = 0; d.normalize();
    const L = world.camLook || new THREE.Vector3();
    return { x: L.x + d.x * 6, z: L.z + d.z * 6 };
  };
  const api = {
    fx,
    demo(px, pz) {
      if (px === undefined) ({ x: px, z: pz } = point());
      const y0 = ground(px, pz), T = fx.time;
      const schools = Object.keys(SCHOOLS);
      // a ring of school bursts
      schools.forEach((s, i) => { const a = i / schools.length * Math.PI * 2; fx.burst(px + Math.sin(a) * 5.5, y0 + 1.6, pz + Math.cos(a) * 5.5, { school: s, n: 26, speed: 3.5, size: 0.28, life: 0.7 }); });
      // flipbooks: fire + smoke, embers, stretched sparks, ground paw prints, frost crystals
      fx.fire(px, y0, pz, { n: 14, size: 0.9, spread: 0.7 });
      fx.smoke(px, y0 + 0.6, pz, { school: 'fire', n: 8, size: 1.1 });
      fx.burst(px, y0 + 0.4, pz, { school: 'fire', n: 30, speed: 2, up: 2.5, life: 1.2, size: 0.12, cell: 'ember', drag: 1 });
      fx.burst(px + 1.5, y0 + 1.2, pz - 1.5, { school: 'physical', n: 40, speed: 9, size: 0.06, cell: 'spark', mode: 1, stretch: 0.03, gravity: 9, life: 0.5, intensity: 1.8 });
      for (let k = 0; k < 6; k++) { const P = fx.spec(); fx.colors(P, 'beast'); P.x = px - 3 + k * 0.5; P.y = y0 + 0.05; P.z = pz + 2.4 + (k % 2) * 0.35; P.life = 2; P.size0 = P.size1 = 0.35; P.cell = CELL.paw; P.mode = 2; P.rot = Math.PI; P.a0 = P.a1 = 0.8; P.mid = 0.7; P.delay = k * 0.15; fx.add.emit(P); }
      fx.burst(px - 1.5, y0 + 1.4, pz - 1.5, { school: 'frost', n: 18, speed: 5, size: 0.3, cell: 'frost_crystal_1', gravity: 8, spin: 6, life: 0.9, alpha: false });
      fx.burst(px - 2.5, y0 + 2, pz + 1, { school: 'nature', n: 16, speed: 1.5, size: 0.3, cell: 'leaf_1', gravity: -0.3, spin: 4, life: 1.6, drag: 1 });
      fx.burst(px + 2.5, y0 + 1, pz + 1, { school: 'poison', n: 14, speed: 0.6, up: 1, size: 0.25, cell: 'poison_bubble', life: 1.4, drag: 0.5 });
      // mesh primitives
      fx.ring(px, y0 + 0.1, pz, { school: 'arcane', r0: 0.5, r1: 6, dur: 0.7, thickness: 0.08 });
      fx.ring(px, y0 + 0.12, pz, { school: 'holy', r0: 2.5, r1: 2.5, dur: 1.6, thickness: 0.35, cell: 'rune_ring_1', alpha: 0.8, spin: 0.6, fadeOut: 0.5 });
      const sh = fx.shell(px + 2.5, y0, pz - 1, { school: 'arcane', r: 1.0, cell: 'hex_pattern', opacity: 0.22 });
      fx.task(1.3, (t) => { if (t > T + 1.2) { sh.end(0.4); return false; } });
      fx.flashSphere(px - 2.5, y0 + 1.2, pz - 1, { school: 'holy', r0: 0.3, r1: 1.6, dur: 0.4, alpha: 0.6 });
      fx.pillar(px - 3.5, y0, pz - 2.5, { school: 'holy', r: 0.8, h: 8, dur: 1.0 });
      fx.cone(px + 3.5, y0 + 1.2, pz - 2.5, { school: 'storm', r: 1.0, h: 2.2, dx: 1, dy: 0.15, dz: 0, dur: 0.6 });
      fx.disc(px, y0 + 2.4, pz - 3, { cell: 'scales', school: 'holy', r: 0.6, dur: 1.4, faceCamera: true });
      fx.disc(px + 1.5, y0 + 2.4, pz - 3, { cell: 'sunburst', school: 'holy', r: 0.8, dur: 1.0, spin: 1.5, faceCamera: true });
      fx.crit(px, y0 + 1.3, pz + 1.5);
      fx.meleeHit(px - 1, y0 + 1.2, pz + 1.5, { school: 'physical' });
      fx.meleeHit(px + 1, y0 + 1.2, pz + 1.5, { school: 'blood', crit: true });
      fx.muzzle(px - 4, y0 + 1.4, pz, 'arcane', 1, 0, 0);
      fx.healLand(px + 4, y0, pz + 2, 'nature');
      // ribbons
      fx.beam(px - 3, y0 + 1.6, pz - 4, px + 3, y0 + 2.2, pz - 4, { school: 'storm', width: 0.35, dur: 0.7, jag: 0.35, cell: 'lightning_1', repeat: 3 });
      fx.beam(px - 3, y0 + 3, pz - 4, px + 3, y0 + 3, pz - 4, { school: 'holy', width: 0.25, dur: 1.2 });
      fx.chain(px - 3, y0 + 1, pz + 4, px + 3, y0 + 1.3, pz + 4, { school: 'curse', dur: 1.4 });
      // decals: cast circle (sweeps), hostile telegraph (fill grows), friendly consecration with turning runes
      const cc = fx.castCircle(px, y0, pz - 4.5, 'frost', 1.4);
      fx.task(1.5, (t) => { if (t > T + 1.4) { cc.end(0.2); return false; } });
      fx.telegraph(px + 5, y0, pz - 1, 2.6, 1.4, 'fire', true, { pulse: true });
      fx.decal(px - 5, y0, pz - 1, { r: 2.8, school: 'holy', cell: 'rune_ring_2', spin: 0.3, dur: 1.6, fillA: 0.12, flags: 8 });
      fx.decal(px, y0, pz + 5, { r: 1.2, school: 'frost', cell: 'ice_crack', dur: 1.5, edgeA: 0.3, fillA: 0.05, flags: 8 });
      // overhead icons + stun stars + a moving projectile glow + a light flash
      const icons = ['skull', 'flag', 'scales', 'sigil_hex', 'sigil_weak', 'sigil_doom', 'cracked_heart'].map((c, i) => fx.icon(c, { x: px - 2.1 + i * 0.7, y: y0, z: pz - 1.5 }, { school: i < 3 ? 'holy' : i < 6 ? 'curse' : 'blood', oy: 3.2 }));
      const st = fx.stun({ x: px, y: y0, z: pz - 1.5 }, { oy: 2.4 });
      const g1 = fx.glow('arcane', 0.22), g2 = fx.glow('fire', 0.3, { trail: 'embers' });
      fx.task(1.5, (t) => {
        const u = t - T, a = u * 4;
        g1.set(px + Math.sin(a) * 3, y0 + 1.8, pz + Math.cos(a) * 3); g2.set(px + Math.sin(-a + 1) * 2, y0 + 1.2, pz + Math.cos(-a + 1) * 2);
        if (u > 1.4) { g1.end(); g2.end(); for (const s of icons) s.end(); st.end(); return false; }
      });
      fx.flash(px, y0 + 2, pz, 0xffd27a, 30, 0.5);
      return { x: px, z: pz };
    },
    loop(on = true, every = 1.6, x, z) { fx.demoLoop = on ? { every, next: 0, fn: () => api.demo(x, z) } : null; return !!on; },
    stats() { return fx.stats(); },
    // performance.now() is coarse (~0.1 ms) outside cross-origin isolation: this times n updates of the current state
    bench(n = 2000) { const t0 = performance.now(); for (let i = 0; i < n; i++) fx.update(0); return +((performance.now() - t0) / n).toFixed(4); },
    frameDraws(dt = 1 / 60) {
      const R = world.renderer; R.info.autoReset = false; R.info.reset(); world.render(dt);
      const out = { calls: R.info.render.calls, triangles: R.info.render.triangles, fxCalls: fx.lastDraws };
      R.info.autoReset = true; return out;
    },
    showAtlas(on = true) {
      let el = document.getElementById('fxAtlasPreview');
      if (!on) { el && el.remove(); return; }
      if (!el) {
        el = document.createElement('div'); el.id = 'fxAtlasPreview';
        el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#151018;display:flex;align-items:center;justify-content:center;';
        const cv = document.createElement('canvas'), s = Math.min(innerWidth, innerHeight) - 20; cv.width = cv.height = 2048; cv.style.cssText = `width:${s}px;height:${s}px;image-rendering:auto;`;
        const g = cv.getContext('2d');
        g.fillStyle = '#2a2230'; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2) g.fillRect(x * 256, y * 256, 256, 256);
        g.drawImage(fx.atlas.canvas(), 0, 0);
        g.font = '22px sans-serif'; g.fillStyle = '#ffcc66';
        for (const c of CELLS) { const r = cellRect(c); g.fillText(c.id, r.x + 6, r.y + 22); g.strokeStyle = 'rgba(255,204,102,0.3)'; g.strokeRect(r.x, r.y, r.w, r.h); }
        el.appendChild(cv); document.body.appendChild(el);
      }
    },
    atlasPNG() { return fx.atlas.canvas().toDataURL('image/png'); },
  };
  window.__fx = api;
  return api;
}
