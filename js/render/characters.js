// Procedurally-built stylized fantasy champions with a lightweight skeletal rig
// and procedural animation (locomotion, casting, attacks, hit reactions, CC,
// death, victory).
//
// Performance: every class is built ONCE into a template. While building, each
// mesh is tagged with a material "kind" (soft cloth/leather/skin, metal, emissive,
// additive glow) and a tint colour. All static meshes hanging off the same pivot
// bone that share a material are then baked into a single merged geometry (the
// tint becomes a vertex colour), so a champion is ~25-35 draw calls instead of
// ~100+. Instances clone the template (geometry shared, materials cloned per
// instance so stealth fading stays independent).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PI = Math.PI;
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ geometry helpers
const cap = (r, l, s = 10) => new THREE.CapsuleGeometry(r, l, 4, s);
const sph = (r, w = 14, h = 10, ...rest) => new THREE.SphereGeometry(r, w, h, ...rest);
const cyl = (rt, rb, h, s = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const cone = (r, h, s = 10) => new THREE.ConeGeometry(r, h, s);
const tor = (r, t, rs = 6, ts = 20, arc = PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc);
const oct = r => new THREE.OctahedronGeometry(r);
const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
const dod = r => new THREE.DodecahedronGeometry(r);
const lathe = (pts, seg = 20, phiStart = 0, phiLen = PI * 2) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLen);
const plane = (w, h, sx = 1, sy = 1) => new THREE.PlaneGeometry(w, h, sx, sy);

// ------------------------------------------------------------------ shared canvas textures
let TEX = null;
function textures() {
  if (TEX) return TEX;
  const make = (size, draw) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); draw(g, size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  };
  const soft = make(128, (g, n) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, n, n);
    // woven cloth / leather grain
    for (let y = 0; y < n; y += 2) { g.fillStyle = `rgba(0,0,0,${y % 4 ? 0.035 : 0.07})`; g.fillRect(0, y, n, 1); }
    for (let x = 0; x < n; x += 2) { g.fillStyle = `rgba(0,0,0,${x % 4 ? 0.025 : 0.05})`; g.fillRect(x, 0, 1, n); }
    for (let i = 0; i < 900; i++) { const v = Math.random() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},${0.04 + Math.random() * 0.05})`; g.fillRect(Math.random() * n, Math.random() * n, 1 + Math.random() * 2, 1 + Math.random() * 2); }
    for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.03})`; g.beginPath(); g.arc(Math.random() * n, Math.random() * n, 4 + Math.random() * 12, 0, PI * 2); g.fill(); }
  });
  const metal = make(128, (g, n) => {
    g.fillStyle = '#dcdcdc'; g.fillRect(0, 0, n, n);
    // brushed streaks
    for (let i = 0; i < 260; i++) { const v = 150 + Math.random() * 105 | 0; g.fillStyle = `rgba(${v},${v},${v},${0.18 + Math.random() * 0.2})`; g.fillRect(Math.random() * n - 20, Math.random() * n, 10 + Math.random() * 60, 1); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(40,40,40,${0.05 + Math.random() * 0.08})`; g.fillRect(Math.random() * n, Math.random() * n, 1 + Math.random() * 3, 1); }
  });
  TEX = { soft, metal };
  return TEX;
}

// ------------------------------------------------------------------ material kit
// k.s = soft (cloth/leather/skin, vertex tinted), k.m = metal (vertex tinted),
// k.e = emissive solid, k.g = additive glow. Signature: (parent, geo, color, pos, rot, scale)
// (k.e / k.g take an extra intensity / opacity argument after color).
function kit() {
  const tex = textures();
  const soft = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.soft, roughness: 0.8, metalness: 0.03, side: THREE.DoubleSide });
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.metal, roughness: 0.3, metalness: 0.88 });
  const emits = new Map(), adds = new Map();
  const place = (parent, geo, m, tint, pos, rot, scl) => {
    const o = new THREE.Mesh(geo, m);
    if (pos) o.position.set(pos[0], pos[1], pos[2]);
    if (rot) o.rotation.set(rot[0], rot[1], rot[2]);
    if (scl !== undefined && scl !== null) { if (typeof scl === 'number') o.scale.setScalar(scl); else o.scale.set(scl[0], scl[1], scl[2]); }
    o.userData.tint = tint;
    o.castShadow = true; o.receiveShadow = true;
    parent.add(o);
    return o;
  };
  const emitMat = (color, ei) => {
    const key = color + ':' + ei;
    if (!emits.has(key)) emits.set(key, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: ei, roughness: 0.25, metalness: 0.1 }));
    return emits.get(key);
  };
  const addMat = (color, op) => {
    const key = color + ':' + op;
    if (!adds.has(key)) adds.set(key, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    return adds.get(key);
  };
  return {
    s: (p, geo, c, pos, rot, scl) => place(p, geo, soft, c, pos, rot, scl),
    m: (p, geo, c, pos, rot, scl) => place(p, geo, metal, c, pos, rot, scl),
    // part spec: {c: color, m: bool metal}
    x: (p, spec, geo, pos, rot, scl) => place(p, geo, spec.m ? metal : soft, spec.c, pos, rot, scl),
    e: (p, geo, c, ei, pos, rot, scl) => place(p, geo, emitMat(c, ei), c, pos, rot, scl),
    g: (p, geo, c, op, pos, rot, scl) => { const o = place(p, geo, addMat(c, op), c, pos, rot, scl); o.castShadow = false; o.receiveShadow = false; return o; },
  };
}
// mark a mesh as individually animated (excluded from merging)
const keep = (o, name) => { o.userData.keep = true; if (name) o.name = name; return o; };
const grp = (parent, name, pos, rot) => {
  const g = new THREE.Group(); if (name) g.name = name;
  if (pos) g.position.set(pos[0], pos[1], pos[2]);
  if (rot) g.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(g); return g;
};
const marker = (parent, name, pos) => { const o = new THREE.Object3D(); o.name = name; o.position.set(pos[0], pos[1], pos[2]); parent.add(o); return o; };

const BONES = ['body', 'hips', 'spine', 'chest', 'head', 'shL', 'shR', 'elL', 'elR', 'handL', 'handR', 'legL', 'legR', 'knL', 'knR'];
const PIVOTS = new Set([...BONES, 'weaponR', 'weaponL', 'shield', 'cape', 'capeLow', 'flapF', 'flapB', 'flapL', 'flapR', 'halo']);

// ------------------------------------------------------------------ base rig + anatomy
// p: { shW, bulk, skin, torso, arm, fore, hand, leg, boot (part specs), eye (glow colour or null), brow, hideFace }
function buildRig(k, p) {
  const root = new THREE.Group();
  const body = grp(root, 'body', [0, 0.98, 0]);
  const hips = grp(body, 'hips');
  const spine = grp(hips, 'spine', [0, 0.08, 0]);
  const chest = grp(spine, 'chest', [0, 0.32, 0]);
  const head = grp(chest, 'head', [0, 0.42, 0]);
  const shW = p.shW ?? 0.27, bulk = p.bulk ?? 1;
  const shL = grp(chest, 'shL', [shW, 0.27, 0]), shR = grp(chest, 'shR', [-shW, 0.27, 0]);
  const elL = grp(shL, 'elL', [0, -0.31, 0]), elR = grp(shR, 'elR', [0, -0.31, 0]);
  const handL = grp(elL, 'handL', [0, -0.29, 0]), handR = grp(elR, 'handR', [0, -0.29, 0]);
  const legL = grp(hips, 'legL', [0.12, -0.04, 0]), legR = grp(hips, 'legR', [-0.12, -0.04, 0]);
  const knL = grp(legL, 'knL', [0, -0.45, 0]), knR = grp(legR, 'knR', [0, -0.45, 0]);
  const skin = { c: p.skin };

  // torso: tapered V shape (wide chest, narrower waist)
  const cw = shW / 0.27;
  k.x(chest, p.torso, cap(0.2, 0.22, 12), [0, 0.04, 0], null, [1.12 * cw, 1, 0.74 * bulk]);
  k.x(chest, p.torso, sph(0.2, 12, 8), [0, 0.2, 0], null, [1.35 * cw, 0.55, 0.8 * bulk]); // upper chest / trapezius
  k.x(spine, p.waist || p.torso, cap(0.155, 0.16, 12), [0, 0.12, 0], null, [1.05, 1, 0.74 * bulk]);
  k.x(hips, p.hip || p.leg, cap(0.165, 0.08, 12), [0, 0.0, 0], null, [1.18, 1, 0.82]);
  // neck + head
  k.x(head, skin, cyl(0.06, 0.075, 0.14, 10), [0, -0.07, 0]);
  if (!p.hideFace) {
    k.x(head, skin, sph(0.145, 16, 12), [0, 0.08, 0.0], null, [0.94, 1.08, 1]);
    k.x(head, skin, sph(0.11, 12, 8), [0, 0.0, 0.04], null, [1.0, 0.8, 1.0]); // jaw
    k.x(head, skin, cone(0.026, 0.07, 6), [0, 0.065, 0.15], [PI / 2 - 0.25, 0, 0], [1, 1, 0.8]); // nose
    for (const s of [1, -1]) {
      k.x(head, skin, cone(0.03, 0.08, 6), [0.14 * s, 0.08, -0.01], [0, 0, -s * 1.3], [1, 1, 0.5]); // ears (slightly pointed)
      k.s(head, box(0.06, 0.016, 0.02), p.brow ?? 0x3a2a1a, [0.05 * s, 0.135, 0.135], [0.1, 0, s * 0.22]); // brows
      if (p.eye) k.e(head, sph(0.018, 8, 6), p.eye, 2.5, [0.05 * s, 0.105, 0.128], null, [1.3, 0.8, 0.6]);
      else k.s(head, sph(0.017, 8, 6), 0x161210, [0.05 * s, 0.105, 0.128]);
    }
  }
  // arms
  for (const [sh, el, hand, s] of [[shL, elL, handL, 1], [shR, elR, handR, -1]]) {
    k.x(sh, p.arm, cap(0.078 * bulk, 0.19, 10), [0, -0.15, 0]);
    k.x(el, p.arm, sph(0.07 * bulk, 10, 8), [0, 0, 0]);
    k.x(el, p.fore, cyl(0.072 * bulk, 0.058, 0.24, 10), [0, -0.13, 0]);
    // hand: palm, finger block, thumb
    k.x(hand, p.hand, box(0.075, 0.08, 0.095), [0, -0.035, 0.005]);
    k.x(hand, p.hand, box(0.07, 0.06, 0.09), [0, -0.09, 0.02], [0.35, 0, 0]);
    k.x(hand, p.hand, cap(0.018, 0.04, 6), [0.03 * s, -0.05, 0.05], [0.6, 0, -0.4 * s]);
  }
  // legs + boots
  for (const [lg, kn] of [[legL, knL], [legR, knR]]) {
    k.x(lg, p.leg, cap(0.1 * bulk, 0.26, 10), [0, -0.22, 0]);
    k.x(kn, p.leg, sph(0.085, 10, 8), [0, 0, 0.01]);
    k.x(kn, p.boot, cyl(0.09, 0.075, 0.34, 10), [0, -0.21, 0]);
    k.x(kn, p.boot, cyl(0.1, 0.1, 0.05, 10), [0, -0.04, 0]); // boot cuff
    k.x(kn, p.boot, box(0.13, 0.085, 0.22), [0, -0.44, 0.05]);
    k.x(kn, p.boot, sph(0.068, 10, 8), [0, -0.44, 0.15], null, [1, 0.65, 1]);
    k.s(kn, box(0.14, 0.025, 0.28), 0x1a1410, [0, -0.485, 0.06]); // sole
  }
  head.scale.setScalar(0.88);
  return { root, body, hips, spine, chest, head, shL, shR, elL, elR, handL, handR, legL, legR, knL, knR };
}

// ------------------------------------------------------------------ merging
const KEEP_ATTRS = ['position', 'normal', 'uv'];
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const pivots = [root];
  root.traverse(o => { if (o !== root && PIVOTS.has(o.name)) pivots.push(o); });
  const inv = new THREE.Matrix4(), rel = new THREE.Matrix4(), col = new THREE.Color();
  const removed = [];
  for (const pv of pivots) {
    const buckets = new Map();
    inv.copy(pv.matrixWorld).invert();
    const visit = o => {
      for (const ch of o.children) {
        if (PIVOTS.has(ch.name) || ch.userData.keep) continue;
        if (ch.isMesh) {
          rel.multiplyMatrices(inv, ch.matrixWorld);
          let g = ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry.clone();
          ch.geometry.dispose();
          for (const name of Object.keys(g.attributes)) if (!KEEP_ATTRS.includes(name)) g.deleteAttribute(name);
          const n = g.attributes.position.count;
          if (!g.attributes.normal) g.computeVertexNormals();
          if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
          g.applyMatrix4(rel);
          const mtl = ch.material;
          if (mtl.vertexColors) {
            col.setHex(ch.userData.tint ?? 0xffffff);
            const arr = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
            g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
          }
          g.morphAttributes = {}; g.groups = [];
          if (!buckets.has(mtl)) buckets.set(mtl, []);
          buckets.get(mtl).push(g);
          removed.push(ch);
        }
        visit(ch);
      }
    };
    visit(pv);
    for (const [mtl, geos] of buckets) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const m = new THREE.Mesh(merged, mtl);
      const additive = mtl.blending === THREE.AdditiveBlending;
      m.castShadow = !additive; m.receiveShadow = !additive;
      if (additive) m.renderOrder = 2;
      m.userData.merged = true;
      pv.add(m);
    }
  }
  for (const o of removed) o.parent && o.parent.remove(o);
  // prune now-empty helper groups
  for (;;) {
    const empty = [];
    root.traverse(o => { if (o.isGroup && o !== root && !PIVOTS.has(o.name) && o.children.length === 0) empty.push(o); });
    if (!empty.length) break;
    for (const o of empty) o.parent.remove(o);
  }
}

// robe skirt split into static sides + swinging front/back panels (flapF / flapB)
function robeSkirt(k, hips, color, pts, trimColor, trimY, trimR) {
  const gap = 0.55;
  k.s(hips, lathe(pts, 8, gap, PI - 2 * gap), color);
  k.s(hips, lathe(pts, 8, PI + gap, PI - 2 * gap), color);
  const fF = grp(hips, 'flapF'), fB = grp(hips, 'flapB');
  k.s(fF, lathe(pts, 5, -gap - 0.06, 2 * gap + 0.12), color);
  k.s(fB, lathe(pts, 5, PI - gap - 0.06, 2 * gap + 0.12), color);
  if (trimColor !== undefined) {
    // torus arc angle b maps to lathe phi = PI/2 - b  =>  start b = PI/2 - phiStart - phiLen
    k.m(hips, tor(trimR, 0.022, 5, 8, PI - 2 * gap), trimColor, [0, trimY, 0], [PI / 2, 0, -PI / 2 + gap], null);
    k.m(hips, tor(trimR, 0.022, 5, 8, PI - 2 * gap), trimColor, [0, trimY, 0], [PI / 2, 0, PI / 2 + gap], null);
    k.m(fF, tor(trimR, 0.022, 5, 6, 2 * gap + 0.12), trimColor, [0, trimY, 0], [PI / 2, 0, PI / 2 - gap - 0.06], null);
    k.m(fB, tor(trimR, 0.022, 5, 6, 2 * gap + 0.12), trimColor, [0, trimY, 0], [PI / 2, 0, -PI / 2 - gap - 0.06], null);
  }
  return { fF, fB };
}

// ------------------------------------------------------------------ class builders
// Each returns meta { R, scale, castColor, uprightStaff }. Animated parts are found
// by name on each instance: focus, tipR, tipL (markers), focusGlow, halo, fireHand,
// spin (keep meshes), weaponR, weaponL, shield, cape, capeLow, flap* (pivots).
function buildMage(k) {
  const robe = 0x24307e, inner = 0x4a2378, gold = 0xd8a84a, skin = 0xe6b898, beard = 0xdcdce4, wood = 0x3a2414, leather = 0x3a2416, arcane = 0xa07aff;
  const R = buildRig(k, { shW: 0.25, skin, torso: { c: robe }, waist: { c: inner }, hip: { c: inner }, arm: { c: robe }, fore: { c: inner }, hand: { c: skin }, leg: { c: inner }, boot: { c: leather }, eye: 0x7fd8ff, brow: 0xc8c8d0 });
  // layered robe skirt with gold hem
  robeSkirt(k, R.hips, robe, [[0.19, 0.06], [0.22, -0.18], [0.3, -0.55], [0.4, -0.88], [0.44, -0.96]], gold, -0.95, 0.435);
  // belt, buckle gem, hanging sash + spellbook
  k.s(R.hips, tor(0.2, 0.035, 6, 20), leather, [0, 0.05, 0], [PI / 2, 0, 0], [1.08, 0.84, 1]);
  k.m(R.hips, box(0.09, 0.08, 0.03), gold, [0, 0.05, 0.18]);
  k.e(R.hips, oct(0.03), arcane, 2.2, [0, 0.05, 0.2], null, [1, 1.3, 0.6]);
  k.s(R.hips, box(0.07, 0.45, 0.015), inner, [0.08, -0.2, 0.2], [0.12, 0, 0.05]);
  k.m(R.hips, box(0.075, 0.04, 0.02), gold, [0.08, -0.43, 0.23], [0.12, 0, 0.05]);
  k.s(R.hips, box(0.13, 0.16, 0.05), 0x5a2a1a, [0.22, -0.08, 0.05], [0, -0.6, 0.1]);
  k.m(R.hips, box(0.135, 0.02, 0.055), gold, [0.22, -0.02, 0.05], [0, -0.6, 0.1]);
  // chest: V trim, rune emblem, high collar
  for (const s of [1, -1]) k.m(R.chest, box(0.04, 0.34, 0.03), gold, [0.07 * s, 0.05, 0.15], [0.08, 0, -0.38 * s]);
  k.m(R.chest, box(0.05, 0.3, 0.03), gold, [0, -0.13, 0.15], [0.05, 0, 0]);
  k.e(R.chest, oct(0.035), arcane, 2.5, [0, 0.0, 0.175], null, [1, 1.4, 0.5]);
  k.s(R.chest, lathe([[0.13, 0.3], [0.16, 0.42], [0.21, 0.55]], 16, PI * 0.25, PI * 1.5), inner);
  k.m(R.chest, tor(0.21, 0.015, 5, 16, PI * 1.5), gold, [0, 0.55, 0], [PI / 2, 0, PI / 2 - PI * 0.25 - PI * 1.5]);
  // shoulder mantles (on shoulder bones so they follow the arms)
  for (const [sh, s] of [[R.shL, 1], [R.shR, -1]]) {
    k.s(sh, sph(0.13, 12, 8, 0, PI * 2, 0, PI / 2), inner, [0.02 * s, 0.02, 0], [0, 0, -0.3 * s], [1.15, 0.8, 1.1]);
    k.m(sh, tor(0.13, 0.016, 5, 16), gold, [0.02 * s, 0.01, 0], [PI / 2, -0.3 * s, 0], [1.15, 1.1, 1]);
    k.e(sh, oct(0.025), arcane, 2, [0.11 * s, 0.03, 0], null, [1, 1.3, 1]);
  }
  // flared sleeves
  for (const el of [R.elL, R.elR]) {
    k.s(el, lathe([[0.08, 0.06], [0.095, -0.1], [0.16, -0.3]], 14), robe);
    k.m(el, tor(0.16, 0.014, 5, 16), gold, [0, -0.3, 0], [PI / 2, 0, 0]);
  }
  // hair, beard, moustache
  k.s(R.head, box(0.22, 0.24, 0.08), beard, [0, 0.0, -0.11]);
  k.s(R.head, cone(0.085, 0.3, 8), beard, [0, -0.13, 0.11], [PI + 0.3, 0, 0], [1.1, 1, 0.8]);
  for (const s of [1, -1]) k.s(R.head, cap(0.018, 0.07, 6), beard, [0.035 * s, 0.03, 0.14], [0, 0, 1.2 * s]);
  // wide-brimmed wizard hat
  k.s(R.head, cyl(0.33, 0.34, 0.025, 20), robe, [0, 0.21, -0.01], [-0.12, 0, 0]);
  k.s(R.head, cyl(0.15, 0.19, 0.22, 16), robe, [0, 0.32, -0.03], [-0.12, 0, 0]);
  k.m(R.head, tor(0.185, 0.022, 5, 18), gold, [0, 0.235, -0.015], [PI / 2 - 0.12, 0, 0]);
  k.e(R.head, oct(0.035), arcane, 2.5, [0, 0.26, 0.175], null, [1, 1.3, 0.6]);
  k.s(R.head, cone(0.15, 0.32, 14), robe, [0, 0.55, -0.1], [-0.35, 0, 0]);
  k.s(R.head, cone(0.07, 0.2, 10), robe, [0, 0.72, -0.22], [-1.0, 0, 0]);
  // staff
  const staff = grp(R.handR, 'weaponR', [0, -0.05, 0.03]);
  k.s(staff, cyl(0.024, 0.032, 1.85, 8), wood, [0, 0.15, 0]);
  for (const y of [-0.6, -0.2, 0.3, 0.75]) k.m(staff, tor(0.032, 0.01, 5, 10), gold, [0, y, 0], [PI / 2, 0, 0]);
  k.m(staff, cone(0.035, 0.12, 6), gold, [0, -0.82, 0], [PI, 0, 0]);
  k.m(staff, cyl(0.04, 0.03, 0.12, 8), gold, [0, 1.06, 0]);
  // twin crescents cradling the crystal (open at the top)
  k.m(staff, tor(0.11, 0.016, 5, 14, PI * 1.3), gold, [0, 1.24, 0], [0, 0, PI * 0.85]);
  k.m(staff, tor(0.11, 0.016, 5, 14, PI * 1.3), gold, [0, 1.24, 0], [0, PI / 2, PI * 0.85]);
  k.e(staff, oct(0.08), 0xc8a8ff, 2.6, [0, 1.25, 0], null, [0.8, 1.5, 0.8]);
  keep(k.g(staff, sph(0.19, 12, 10), 0x9a6aff, 0.22, [0, 1.25, 0]), 'focusGlow');
  marker(staff, 'focus', [0, 1.25, 0]); marker(staff, 'tipR', [0, 1.32, 0]);
  // floating arcane rune around the off hand
  keep(k.g(R.handL, tor(0.12, 0.008, 4, 28), 0x8fd8ff, 0.75, [0, -0.08, 0], [PI / 2, 0, 0]), 'spin');
  return { R, scale: 1.0, castColor: 0x9a6aff, uprightStaff: true };
}

function buildRogue(k) {
  const leather = 0x2e2520, cloth = 0x2a1d3a, strap = 0x5a3a22, steel = 0x9aa2ae, skin = 0xd8a888, dark = 0x15121a, venom = 0x7aff5a, plate = 0x3a2e26;
  const R = buildRig(k, { shW: 0.24, skin, torso: { c: leather }, waist: { c: cloth }, hip: { c: leather }, arm: { c: cloth }, fore: { c: leather }, hand: { c: 0x1a1412 }, leg: { c: cloth }, boot: { c: 0x1e1814 }, eye: 0xb6ff6a, brow: 0x1a120c });
  // layered leather vest plates + crossing straps with throwing knives
  for (let i = 0; i < 3; i++) k.s(R.chest, box(0.34 - i * 0.03, 0.08, 0.04), plate, [0, -0.12 + i * 0.09, 0.14 - i * 0.005], [0.05, 0, 0]);
  for (const s of [1, -1]) k.s(R.chest, box(0.055, 0.62, 0.03), strap, [0, 0.02, 0.165], [0, 0, 0.6 * s]);
  for (let i = 0; i < 3; i++) k.m(R.chest, box(0.025, 0.11, 0.01), steel, [0.06 - i * 0.07, 0.09 - i * 0.05, 0.19], [0, 0, -0.6]);
  k.m(R.chest, cyl(0.035, 0.035, 0.02, 8), steel, [0, 0.02, 0.185], [PI / 2, 0, 0]);
  // belt, buckle, pouches, sheaths, short leather flaps
  k.s(R.hips, tor(0.19, 0.03, 6, 20), strap, [0, 0.05, 0], [PI / 2, 0, 0], [1.1, 0.82, 1]);
  k.m(R.hips, box(0.07, 0.06, 0.025), steel, [0, 0.05, 0.17]);
  k.s(R.hips, box(0.09, 0.1, 0.06), strap, [0.17, -0.03, 0.1], [0, -0.5, 0]);
  k.s(R.hips, box(0.08, 0.09, 0.06), strap, [-0.18, -0.03, 0.08], [0, 0.5, 0]);
  for (const s of [1, -1]) k.s(R.hips, cyl(0.025, 0.018, 0.26, 6), 0x1a1210, [0.2 * s, -0.12, -0.08], [0.3, 0, 0.2 * s]);
  for (const s of [1, -1]) k.s(R.hips, box(0.13, 0.22, 0.02), leather, [0.1 * s, -0.12, 0.16], [-0.1, 0, 0]);
  // cowl over shoulders, hood, mask, brim
  k.s(R.chest, lathe([[0.15, 0.48], [0.22, 0.36], [0.31, 0.22], [0.33, 0.16]], 16), cloth);
  k.s(R.head, sph(0.2, 16, 12, 0, PI * 2, 0, PI * 0.64), cloth, [0, 0.1, -0.03], null, [1, 1.12, 1.12]);
  k.s(R.head, cone(0.12, 0.26, 10), cloth, [0, 0.16, -0.19], [-1.9, 0, 0]);
  k.s(R.head, lathe([[0.165, -0.05], [0.175, 0.03], [0.17, 0.085]], 14, -PI * 0.6, PI * 1.2), dark);
  k.s(R.head, box(0.28, 0.04, 0.03), cloth, [0, 0.19, 0.15], [0.2, 0, 0]);
  // glowing eyes in the shadow of the hood
  for (const s of [1, -1]) k.e(R.head, box(0.05, 0.018, 0.01), venom, 3, [0.052 * s, 0.105, 0.182], [0, 0, -0.18 * s]);
  // left: layered leather pauldron with a spike
  for (let i = 0; i < 3; i++) k.s(R.shL, sph(0.12 - i * 0.012, 10, 8, 0, PI * 2, 0, PI / 2), i % 2 ? leather : plate, [0.02, 0.04 - i * 0.05, 0], [0, 0, -0.35 - i * 0.15], [1.2, 0.7, 1.1]);
  k.m(R.shL, cone(0.022, 0.08, 6), steel, [0.06, 0.1, 0], [0, 0, -0.5]);
  // bracers with studs
  for (const el of [R.elL, R.elR]) {
    k.s(el, cyl(0.075, 0.066, 0.16, 10), plate, [0, -0.17, 0]);
    for (let i = 0; i < 3; i++) k.m(el, sph(0.012, 6, 4), steel, [0, -0.11 - i * 0.05, 0.072]);
  }
  // tattered two-segment cape
  const cape = grp(R.chest, 'cape', [0, 0.3, -0.17]);
  k.s(cape, plane(0.46, 0.42), 0x231830, [0, -0.21, 0]);
  const capeLow = grp(cape, 'capeLow', [0, -0.42, 0]);
  k.s(capeLow, plane(0.46, 0.22), 0x231830, [0, -0.11, 0]);
  for (let i = 0; i < 4; i++) k.s(capeLow, cone(0.06, 0.18, 3), 0x231830, [-0.17 + i * 0.115, -0.3, 0], [PI, 0, 0], [1, 1, 0.08]);
  // venom daggers
  const mkDagger = (hand, name, tip) => {
    const d = grp(hand, name, [0, -0.06, 0.02], [PI / 2 + 0.25, 0, 0]);
    k.s(d, cyl(0.02, 0.02, 0.12, 6), strap, [0, -0.02, 0]);
    k.m(d, sph(0.028, 8, 6), steel, [0, -0.09, 0]);
    k.e(d, oct(0.02), venom, 2, [0, -0.11, 0]);
    k.m(d, tor(0.06, 0.013, 4, 10, PI), steel, [0, 0.05, 0]);
    k.m(d, cone(0.045, 0.42, 4), 0xc0c8d4, [0, 0.27, 0], null, [1, 1, 0.28]);
    k.g(d, cone(0.05, 0.44, 4), venom, 0.35, [0, 0.27, 0], null, [1, 1, 0.22]);
    marker(d, tip, [0, 0.47, 0]);
    return d;
  };
  mkDagger(R.handL, 'weaponL', 'tipL'); mkDagger(R.handR, 'weaponR', 'tipR');
  return { R, scale: 0.97, castColor: 0x9be36a };
}

function buildWarrior(k) {
  const plate = 0xa4acb8, dark = 0x3a3e46, gold = 0xd9a640, red = 0x8a1a14, leather = 0x3a2618, skin = 0xc89878, beard = 0x6a3a1c, horn = 0xe8dcc0, steel = 0xd0d6e0, ember = 0xff8a2a;
  const P = { c: plate, m: true }, D = { c: dark, m: true };
  const R = buildRig(k, { shW: 0.33, bulk: 1.15, skin, torso: P, waist: D, hip: D, arm: D, fore: P, hand: D, leg: D, boot: P, hideFace: true });
  // breastplate, center ridge, lion emblem, gorget, abdomen bands
  k.m(R.chest, sph(0.24, 16, 12), plate, [0, 0.05, 0.04], null, [1.35, 1.05, 0.85]);
  k.m(R.chest, box(0.04, 0.32, 0.03), gold, [0, 0.04, 0.24], [0.1, 0, 0]);
  k.m(R.chest, cyl(0.075, 0.075, 0.03, 14), gold, [0, 0.1, 0.235], [PI / 2 - 0.25, 0, 0]);
  k.e(R.chest, oct(0.035), 0xff4a2a, 1.6, [0, 0.1, 0.26], null, [1, 1.2, 0.6]);
  k.m(R.chest, lathe([[0.12, 0.34], [0.15, 0.43], [0.17, 0.5]], 16), plate);
  k.m(R.chest, tor(0.17, 0.015, 5, 16), gold, [0, 0.5, 0], [PI / 2, 0, 0]);
  for (let i = 0; i < 3; i++) k.m(R.spine, cyl(0.175 - i * 0.008, 0.185 - i * 0.008, 0.07, 14), i === 1 ? dark : plate, [0, 0.03 + i * 0.075, 0.0], null, [1.15, 1, 0.82]);
  // belt + buckle, plate faulds
  k.s(R.hips, tor(0.21, 0.04, 6, 20), leather, [0, 0.06, 0], [PI / 2, 0, 0], [1.12, 0.85, 1]);
  k.m(R.hips, box(0.12, 0.1, 0.04), gold, [0, 0.06, 0.19]);
  k.e(R.hips, sph(0.022, 8, 6), 0xff4a2a, 1.5, [0, 0.06, 0.215]);
  k.m(R.hips, lathe([[0.22, 0.02], [0.26, -0.14], [0.3, -0.26]], 8, 0.55, PI - 1.1), plate);
  k.m(R.hips, lathe([[0.22, 0.02], [0.26, -0.14], [0.3, -0.26]], 8, PI + 0.55, PI - 1.1), plate);
  // crimson tabard front/back panels (swing with the legs)
  for (const [name, z, ry] of [['flapF', 0.215, 0], ['flapB', -0.215, PI]]) {
    const f = grp(R.hips, name, [0, 0.02, 0]);
    k.s(f, box(0.27, 0.6, 0.02), red, [0, -0.32, z], [0, ry, 0]);
    k.m(f, box(0.02, 0.6, 0.025), gold, [0.135, -0.32, z], [0, ry, 0]);
    k.m(f, box(0.02, 0.6, 0.025), gold, [-0.135, -0.32, z], [0, ry, 0]);
    k.m(f, box(0.29, 0.025, 0.025), gold, [0, -0.62, z], [0, ry, 0]);
    if (z > 0) { k.m(f, box(0.04, 0.2, 0.025), gold, [0, -0.3, z + 0.006]); k.m(f, box(0.14, 0.035, 0.025), gold, [0, -0.25, z + 0.006]); }
  }
  // massive layered pauldrons with spikes (on the shoulder bones)
  for (const [sh, s] of [[R.shL, 1], [R.shR, -1]]) {
    k.m(sh, sph(0.17, 14, 10, 0, PI * 2, 0, PI / 1.7), plate, [0.03 * s, 0.05, 0], [0, 0, -0.35 * s], [1.3, 1, 1.2]);
    k.m(sh, sph(0.15, 12, 8, 0, PI * 2, 0, PI / 2), dark, [0.07 * s, -0.06, 0], [0, 0, -0.7 * s], [1.1, 0.8, 1.1]);
    k.m(sh, tor(0.17, 0.02, 6, 18), gold, [0.03 * s, 0.03, 0], [PI / 2, -0.35 * s, 0], [1.3, 1.2, 1]);
    k.m(sh, cone(0.045, 0.22, 8), dark, [0.07 * s, 0.22, 0.04], [0.2, 0, -0.45 * s]);
    k.m(sh, cone(0.035, 0.16, 8), dark, [0.1 * s, 0.18, -0.08], [-0.3, 0, -0.6 * s]);
    k.e(sh, sph(0.025, 8, 6), 0xff4a2a, 1.5, [0.2 * s, 0.03, 0]);
  }
  // knee cops
  for (const kn of [R.knL, R.knR]) {
    k.m(kn, sph(0.095, 10, 8, 0, PI * 2, 0, PI / 2), plate, [0, 0.01, 0.04], [PI / 2, 0, 0], [1, 1.2, 1]);
    k.m(kn, cone(0.025, 0.08, 6), gold, [0, 0.01, 0.13], [PI / 2, 0, 0]);
  }
  // gauntlet cuffs
  for (const el of [R.elL, R.elR]) k.m(el, cyl(0.09, 0.075, 0.08, 10), plate, [0, -0.24, 0]);
  // horned great helm with glowing visor, beard braid and plume
  k.m(R.head, sph(0.19, 16, 12), plate, [0, 0.1, 0], null, [1, 1.1, 1.05]);
  k.m(R.head, box(0.24, 0.2, 0.08), plate, [0, 0.04, 0.14]);
  for (const s of [1, -1]) k.m(R.head, box(0.06, 0.18, 0.14), plate, [0.13 * s, 0.03, 0.08], [0, 0.3 * s, 0]);
  k.s(R.head, box(0.2, 0.03, 0.02), 0x0c0806, [0, 0.11, 0.185]);
  for (const s of [1, -1]) k.e(R.head, box(0.035, 0.014, 0.01), ember, 3, [0.05 * s, 0.11, 0.196]);
  k.m(R.head, box(0.035, 0.17, 0.02), gold, [0, 0.07, 0.19]);
  k.m(R.head, box(0.03, 0.06, 0.34), gold, [0, 0.29, -0.01]);
  for (const s of [1, -1]) {
    k.s(R.head, cone(0.055, 0.22, 10), horn, [0.22 * s, 0.2, 0], [0, 0, -1.3 * s]);
    k.s(R.head, cone(0.036, 0.2, 10), horn, [0.33 * s, 0.31, -0.01], [-0.15, 0, -0.35 * s]);
    k.m(R.head, tor(0.05, 0.012, 5, 12), gold, [0.15 * s, 0.18, 0], [0, PI / 2, 0]);
  }
  k.s(R.head, cone(0.06, 0.22, 8), beard, [0, -0.12, 0.13], [PI + 0.3, 0, 0], [1.2, 1, 0.8]);
  k.m(R.head, tor(0.028, 0.01, 5, 10), gold, [0, -0.17, 0.145], [PI / 2 + 0.3, 0, 0]);
  k.s(R.head, cyl(0.01, 0.05, 0.28, 6), red, [0, 0.33, -0.12], [-0.6, 0, 0]);
  // crimson cape
  const cape = grp(R.chest, 'cape', [0, 0.34, -0.2]);
  k.s(cape, plane(0.62, 0.55), red, [0, -0.27, 0]);
  const capeLow = grp(cape, 'capeLow', [0, -0.55, 0]);
  k.s(capeLow, plane(0.62, 0.48), red, [0, -0.24, 0]);
  k.m(capeLow, box(0.62, 0.03, 0.02), gold, [0, -0.48, 0]);
  // runed greatsword
  const sword = grp(R.handR, 'weaponR', [0, -0.05, 0.02], [PI / 2, 0, 0]);
  k.s(sword, cyl(0.026, 0.026, 0.24, 8), leather, [0, -0.05, 0]);
  for (const y of [-0.12, -0.02]) k.m(sword, tor(0.028, 0.008, 4, 8), gold, [0, y, 0], [PI / 2, 0, 0]);
  k.m(sword, sph(0.045, 10, 8), gold, [0, -0.2, 0]);
  k.e(sword, oct(0.022), 0xff4a2a, 1.8, [0, -0.2, 0.035]);
  k.m(sword, box(0.34, 0.05, 0.06), gold, [0, 0.09, 0]);
  for (const s of [1, -1]) k.m(sword, cone(0.035, 0.09, 6), gold, [0.19 * s, 0.11, 0], [0, 0, -s * 0.9]);
  k.e(sword, oct(0.03), 0xff4a2a, 1.8, [0, 0.09, 0.035], null, [1, 1, 0.6]);
  k.m(sword, box(0.1, 1.0, 0.022), steel, [0, 0.62, 0]);
  k.m(sword, cone(0.05, 0.16, 4), steel, [0, 1.2, 0], null, [1, 1, 0.22]);
  k.g(sword, box(0.022, 0.82, 0.03), ember, 0.9, [0, 0.58, 0]);
  marker(sword, 'tipR', [0, 1.26, 0]); marker(sword, 'focus', [0, 0.8, 0]);
  // tower shield
  const shield = grp(R.elL, 'shield', [0.13, -0.12, 0], [0, PI / 2, 0]);
  k.s(shield, box(0.55, 0.72, 0.05), red, [0, 0.02, 0]);
  k.s(shield, box(0.39, 0.39, 0.05), red, [0, -0.34, 0], [0, 0, PI / 4], [1, 1, 0.98]);
  for (const s of [1, -1]) k.m(shield, box(0.05, 0.76, 0.075), gold, [0.28 * s, 0.02, 0]);
  k.m(shield, box(0.6, 0.05, 0.075), gold, [0, 0.39, 0]);
  for (const s of [1, -1]) k.m(shield, box(0.4, 0.045, 0.075), gold, [0.135 * s, -0.47, 0], [0, 0, s * PI / 4]);
  k.m(shield, box(0.05, 0.62, 0.02), gold, [0, -0.02, 0.035]);
  k.m(shield, box(0.36, 0.05, 0.02), gold, [0, 0.12, 0.035]);
  k.m(shield, cyl(0.11, 0.13, 0.06, 16), plate, [0, 0.12, 0.045], [PI / 2, 0, 0]);
  k.m(shield, cone(0.06, 0.14, 8), dark, [0, 0.12, 0.14], [PI / 2, 0, 0]);
  for (const [x, y] of [[0.2, 0.3], [-0.2, 0.3], [0.2, -0.25], [-0.2, -0.25]]) k.m(shield, sph(0.02, 6, 4), plate, [x, y, 0.03]);
  return { R, scale: 1.1, castColor: 0xff8a2a };
}

function buildPriest(k) {
  const white = 0xeee8da, gold = 0xe8c060, blue = 0x2e4c94, skin = 0xf0c8a8, hair = 0xead8a0, holy = 0xffe28a;
  const G = { c: gold, m: true };
  const R = buildRig(k, { shW: 0.26, skin, torso: { c: white }, waist: { c: white }, hip: { c: white }, arm: { c: white }, fore: { c: white }, hand: { c: skin }, leg: { c: white }, boot: G, eye: 0x8ac8ff, brow: 0xc8a860 });
  const { fF } = robeSkirt(k, R.hips, white, [[0.2, 0.06], [0.23, -0.18], [0.32, -0.56], [0.42, -0.9], [0.46, -0.98]], gold, -0.97, 0.455);
  // blue stole with golden crosses on the front panel
  k.s(fF, box(0.16, 0.78, 0.015), blue, [0, -0.52, 0.335], [0.27, 0, 0]);
  for (const y of [-0.35, -0.72]) {
    const z = 0.335 + (-0.52 - y) * 0.27;
    k.m(fF, box(0.03, 0.12, 0.01), gold, [0, y, z + 0.012], [0.27, 0, 0]);
    k.m(fF, box(0.09, 0.03, 0.01), gold, [0, y + 0.02, z + 0.012], [0.27, 0, 0]);
  }
  // belt with holy buckle
  k.m(R.hips, tor(0.205, 0.035, 6, 20), gold, [0, 0.05, 0], [PI / 2, 0, 0], [1.08, 0.84, 1]);
  k.e(R.hips, oct(0.035), holy, 2.2, [0, 0.05, 0.19], null, [1, 1.2, 0.6]);
  // golden breastplate, stole over the chest, radiant sigil
  k.m(R.chest, sph(0.21, 14, 10, 0, PI * 2, 0, PI * 0.6), gold, [0, -0.02, 0.05], null, [1.12, 1.05, 0.72]);
  for (const s of [1, -1]) k.s(R.chest, box(0.07, 0.5, 0.02), blue, [0.1 * s, 0.08, 0.18], [0.12, 0, 0.12 * s]);
  k.e(R.chest, oct(0.045), holy, 2.5, [0, 0.1, 0.2], null, [1, 1.5, 0.5]);
  k.m(R.chest, tor(0.06, 0.01, 5, 16), gold, [0, 0.1, 0.19]);
  k.s(R.chest, lathe([[0.12, 0.34], [0.15, 0.44], [0.17, 0.5]], 16, PI * 0.3, PI * 1.4), white);
  // gold mantles + feather wings on the shoulders
  for (const [sh, s] of [[R.shL, 1], [R.shR, -1]]) {
    k.m(sh, sph(0.13, 12, 8, 0, PI * 2, 0, PI / 2), gold, [0.02 * s, 0.03, 0], [0, 0, -0.3 * s], [1.3, 0.8, 1.15]);
    k.s(sh, tor(0.13, 0.02, 5, 16), blue, [0.02 * s, 0.02, 0], [PI / 2, -0.3 * s, 0], [1.3, 1.15, 1]);
    for (let i = 0; i < 3; i++) k.m(sh, cone(0.035, 0.26 - i * 0.05, 4), gold, [0.08 * s, 0.14 - i * 0.02, -0.05 - i * 0.03], [0.3 + i * 0.25, 0, -s * (0.5 + i * 0.25)], [1, 1, 0.3]);
  }
  for (const el of [R.elL, R.elR]) {
    k.s(el, lathe([[0.078, 0.06], [0.09, -0.1], [0.15, -0.3]], 14), white);
    k.m(el, tor(0.15, 0.014, 5, 16), gold, [0, -0.3, 0], [PI / 2, 0, 0]);
  }
  // hair, circlet, halo
  k.s(R.head, sph(0.16, 14, 10, 0, PI * 2, 0, PI * 0.55), hair, [0, 0.11, -0.015], null, [1.02, 1, 1.06]);
  k.s(R.head, box(0.26, 0.32, 0.09), hair, [0, -0.04, -0.11]);
  for (const s of [1, -1]) k.s(R.head, cap(0.035, 0.18, 6), hair, [0.13 * s, -0.04, 0.03]);
  k.m(R.head, tor(0.155, 0.013, 5, 20), gold, [0, 0.14, 0], [PI / 2 - 0.15, 0, 0]);
  k.e(R.head, oct(0.025), 0x6ab0ff, 2.5, [0, 0.15, 0.155], null, [1, 1.4, 0.6]);
  const halo = grp(R.head, 'halo', [0, 0.44, -0.1], [PI / 2 - 0.3, 0, 0]);
  k.e(halo, tor(0.22, 0.02, 8, 32), holy, 2.5);
  k.g(halo, tor(0.22, 0.06, 8, 32), 0xffd870, 0.25);
  for (let i = 0; i < 8; i++) { const a = i / 8 * PI * 2; k.e(halo, cone(0.018, 0.07, 4), holy, 2.5, [Math.cos(a) * 0.26, Math.sin(a) * 0.26, 0], [0, 0, a - PI / 2]); }
  // radiant mace
  const mace = grp(R.handR, 'weaponR', [0, -0.03, 0.03], [PI / 2 - 0.2, 0, 0]);
  k.s(mace, cyl(0.024, 0.03, 0.72, 8), 0xf0e0c0, [0, 0.14, 0]);
  for (const y of [-0.16, -0.06, 0.38]) k.m(mace, tor(0.032, 0.011, 5, 10), gold, [0, y, 0], [PI / 2, 0, 0]);
  k.m(mace, sph(0.04, 8, 6), gold, [0, -0.22, 0]);
  k.m(mace, cyl(0.045, 0.03, 0.08, 8), gold, [0, 0.48, 0]);
  for (let i = 0; i < 6; i++) { const a = i / 6 * PI * 2; k.m(mace, box(0.018, 0.17, 0.08), gold, [Math.sin(a) * 0.085, 0.6, Math.cos(a) * 0.085], [0, a, 0]); }
  k.m(mace, cone(0.03, 0.1, 6), gold, [0, 0.72, 0]);
  k.e(mace, sph(0.07, 12, 10), 0xfff2c0, 3, [0, 0.6, 0]);
  keep(k.g(mace, sph(0.2, 12, 10), 0xffe08a, 0.25, [0, 0.6, 0]), 'focusGlow');
  marker(mace, 'focus', [0, 0.6, 0]); marker(mace, 'tipR', [0, 0.68, 0]);
  return { R, scale: 1.0, castColor: 0xffe08a };
}

function buildShaman(k) {
  const fur = 0x8c7c68, furDark = 0x5e4c3a, leather = 0x4a2c16, bone = 0xe2d6ba, paint = 0x3ab8e0, skin = 0x8a5e40, stone = 0x6a6a72, wood = 0x4a2e18, copper = 0xc87a2a, storm = 0x4ad8ff;
  const R = buildRig(k, { shW: 0.29, bulk: 1.08, skin, torso: { c: skin }, waist: { c: leather }, hip: { c: leather }, arm: { c: skin }, fore: { c: leather }, hand: { c: skin }, leg: { c: leather }, boot: { c: fur }, eye: 0x7ae0ff, brow: 0x2a1a10 });
  // war paint + harness + fur mantle + bone necklace
  k.e(R.chest, box(0.3, 0.035, 0.02), paint, 0.7, [0, -0.06, 0.19]);
  k.e(R.chest, box(0.035, 0.2, 0.02), paint, 0.7, [0, -0.1, 0.195]);
  k.s(R.chest, box(0.06, 0.6, 0.03), leather, [0, 0.0, 0.17], [0, 0, 0.65]);
  k.s(R.chest, tor(0.25, 0.12, 8, 16), fur, [0, 0.25, 0], [PI / 2, 0, 0], [1.12, 1, 1]);
  for (let i = 0; i < 8; i++) { const a = i / 8 * PI * 2; k.s(R.chest, cone(0.07, 0.16, 5), i % 2 ? fur : furDark, [Math.sin(a) * 0.3, 0.27, Math.cos(a) * 0.27], [Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5]); }
  for (let i = 0; i < 7; i++) { const a = (i / 6 - 0.5) * 2.0; k.s(R.chest, cone(0.02, 0.09, 6), bone, [Math.sin(a) * 0.2, 0.1, Math.cos(a) * 0.19 + 0.02], [PI, 0, 0]); }
  // kilt: swinging hide panels front/back + static side strips
  for (const [name, z] of [['flapF', 0.2], ['flapB', -0.2]]) {
    const f = grp(R.hips, name, [0, 0.02, 0]);
    k.s(f, box(0.2, 0.44, 0.025), leather, [0, -0.24, z]);
    k.s(f, cone(0.1, 0.1, 3), leather, [0, -0.5, z], [PI, 0, 0], [1, 1, 0.2]);
    k.e(f, box(0.12, 0.025, 0.01), paint, 0.6, [0, -0.15, z + Math.sign(z) * 0.015]);
  }
  for (let i = 0; i < 6; i++) { const a = (i < 3 ? 0.9 + i * 0.5 : PI + 0.9 + (i - 3) * 0.5); k.s(R.hips, box(0.13, 0.4, 0.03), i % 2 ? fur : furDark, [Math.sin(a) * 0.22, -0.2, Math.cos(a) * 0.2], [Math.cos(a) * 0.12, a, -Math.sin(a) * 0.12]); }
  k.s(R.hips, tor(0.21, 0.035, 6, 20), 0x3a2a18, [0, 0.03, 0], [PI / 2, 0, 0], [1.1, 0.82, 1]);
  k.s(R.hips, sph(0.055, 8, 6), bone, [0, 0.02, 0.2], null, [1, 1, 0.8]);
  for (const s of [1, -1]) k.e(R.hips, sph(0.012, 6, 4), storm, 2, [0.02 * s, 0.03, 0.245]);
  k.s(R.hips, box(0.09, 0.1, 0.06), leather, [-0.19, -0.03, 0.08], [0, 0.5, 0]);
  // left stone pauldron with bone spikes; right fur shoulder
  k.s(R.shL, dod(0.15), stone, [0.04, 0.03, 0], null, [1.1, 0.9, 1.1]);
  k.s(R.shL, cone(0.04, 0.22, 6), bone, [0.06, 0.18, 0.03], [0.2, 0, -0.4]);
  k.s(R.shL, cone(0.03, 0.16, 6), bone, [0.12, 0.13, -0.07], [-0.3, 0, -0.8]);
  k.e(R.shL, box(0.1, 0.02, 0.02), paint, 0.8, [0.04, 0.04, 0.15]);
  k.s(R.shR, sph(0.14, 10, 8, 0, PI * 2, 0, PI / 2), fur, [-0.02, 0.02, 0], [0, 0, 0.3], [1.2, 0.8, 1.1]);
  for (const el of [R.elL, R.elR]) for (const y of [-0.12, -0.22]) k.m(el, tor(0.072, 0.012, 5, 12), copper, [0, y, 0], [PI / 2, 0, 0]);
  // beast-skull helm
  k.s(R.head, sph(0.18, 12, 10, 0, PI * 2, 0, PI * 0.55), bone, [0, 0.13, 0], null, [1.05, 1, 1.15]);
  k.s(R.head, box(0.18, 0.09, 0.18), bone, [0, 0.21, 0.17]);
  k.s(R.head, box(0.14, 0.05, 0.08), bone, [0, 0.2, 0.28]);
  for (let i = 0; i < 4; i++) k.s(R.head, cone(0.014, 0.05, 4), bone, [-0.06 + i * 0.04, 0.155, 0.27], [PI, 0, 0]);
  for (const s of [1, -1]) {
    k.s(R.head, sph(0.03, 8, 6), 0x140e0a, [0.06 * s, 0.23, 0.25]);
    k.e(R.head, sph(0.016, 6, 4), storm, 3, [0.06 * s, 0.23, 0.27]);
    k.s(R.head, cone(0.05, 0.24, 8), bone, [0.2 * s, 0.24, -0.02], [0.2, 0, -1.1 * s]);
    k.s(R.head, cone(0.035, 0.2, 8), bone, [0.3 * s, 0.37, -0.06], [-0.3, 0, -0.2 * s]);
    k.s(R.head, cone(0.018, 0.08, 6), bone, [0.055 * s, -0.01, 0.14], [-0.2, 0, -0.15 * s]); // tusks
  }
  k.e(R.head, box(0.2, 0.018, 0.02), paint, 0.8, [0, 0.07, 0.15]);
  k.s(R.head, cyl(0.04, 0.02, 0.22, 6), 0x2a1a10, [0, -0.13, 0.11], [0.3, 0, 0]);
  k.m(R.head, tor(0.035, 0.01, 5, 10), copper, [0, -0.15, 0.115], [PI / 2 + 0.3, 0, 0]);
  for (const s of [1, -1]) k.s(R.head, cyl(0.025, 0.015, 0.3, 6), 0x2a1a10, [0.08 * s, -0.08, -0.12], [-0.25, 0, 0]);
  // totem staff with storm orb
  const staff = grp(R.handR, 'weaponR', [0, -0.02, 0.06]);
  k.s(staff, cyl(0.03, 0.036, 1.8, 8), wood, [0, 0.1, 0]);
  k.s(staff, box(0.16, 0.24, 0.14), 0x6a4426, [0, 1.02, 0]);
  k.s(staff, box(0.18, 0.05, 0.16), 0x5a3a20, [0, 1.15, 0]);
  k.e(staff, box(0.12, 0.025, 0.01), paint, 1, [0, 1.06, 0.075]);
  for (const s of [1, -1]) k.e(staff, box(0.025, 0.025, 0.01), paint, 1.4, [0.035 * s, 1.0, 0.075]);
  for (const s of [1, -1]) {
    k.s(staff, plane(0.24, 0.1), 0xd8d0c0, [0.17 * s, 1.08, 0], [0, 0, s * 0.35]);
    k.s(staff, cone(0.04, 0.18, 6), bone, [0.1 * s, 1.22, 0], [0, 0, -0.6 * s]);
  }
  k.e(staff, sph(0.075, 12, 10), 0xc8f6ff, 3, [0, 1.3, 0]);
  keep(k.g(staff, sph(0.2, 12, 10), storm, 0.3, [0, 1.3, 0]), 'focusGlow');
  keep(k.g(staff, tor(0.13, 0.006, 4, 24), 0xbff4ff, 0.8, [0, 1.3, 0], [PI / 2, 0, 0]), 'spin');
  for (const y of [0.85, 0.75]) k.m(staff, tor(0.045, 0.012, 6, 10), copper, [0, y, 0], [PI / 2, 0, 0]);
  k.s(staff, plane(0.06, 0.25), 0xc0402a, [0.08, 0.68, 0], [0, 0, 0.3]);
  k.s(staff, plane(0.05, 0.2), 0x2a6ac0, [-0.07, 0.7, 0], [0, 0, -0.25]);
  marker(staff, 'focus', [0, 1.3, 0]); marker(staff, 'tipR', [0, 1.36, 0]);
  // off-hand fire
  const fire = keep(k.g(R.handL, sph(0.085, 10, 8), 0xff8a2a, 0.8, [0, -0.11, 0.04]), 'fireHand');
  k.g(fire, sph(0.045, 8, 6), 0xffe07a, 0.9, [0, 0.01, 0]);
  return { R, scale: 1.04, castColor: 0x4ad8ff, uprightStaff: true };
}

const BUILDERS = { mage: buildMage, rogue: buildRogue, warrior: buildWarrior, priest: buildPriest, shaman: buildShaman };
const TEMPLATES = {};
function template(cls) {
  if (TEMPLATES[cls]) return TEMPLATES[cls];
  const meta = (BUILDERS[cls] || buildWarrior)(kit());
  const root = meta.R.root;
  root.scale.setScalar(meta.scale);
  mergeStatic(root);
  delete meta.R;
  return (TEMPLATES[cls] = { root, meta });
}

// ------------------------------------------------------------------ animated character
const EMPTY_STATE = {};
const POSE_KEYS = ['bodyY', 'bodyZ', 'bodyRotY', 'bodyRoll', 'rootTilt', 'hipsY', 'hipsZ', 'spineX', 'spineY', 'spineZ', 'chestY', 'headX', 'headY',
  'shLx', 'shLy', 'shLz', 'shRx', 'shRy', 'shRz', 'elL', 'elR', 'hdL', 'hdR', 'legLx', 'legLz', 'legRx', 'legRz', 'knL', 'knR', 'aim', 'glow'];

export class Character {
  constructor(cls) {
    this.cls = cls;
    const tpl = template(cls);
    this.root = tpl.root.clone(true);
    this.scale = tpl.meta.scale; this.castColor = tpl.meta.castColor; this.uprightStaff = !!tpl.meta.uprightStaff;
    // per-instance materials (geometry stays shared with the template)
    const remap = new Map();
    this.materials = []; this.emitMats = [];
    this.root.traverse(o => {
      if (!o.isMesh) return;
      let m = remap.get(o.material);
      if (!m) {
        m = o.material.clone();
        m.userData.baseOpacity = m.opacity; m.userData.baseTransparent = m.transparent; m.userData.baseDepthWrite = m.depthWrite;
        if (m.isMeshStandardMaterial && !m.vertexColors && m.emissive && m.emissive.getHex() !== 0) { m.userData.baseEI = m.emissiveIntensity; this.emitMats.push(m); }
        remap.set(o.material, m); this.materials.push(m);
      }
      o.material = m;
    });
    const R = {};
    for (const n of BONES) R[n] = this.root.getObjectByName(n);
    this.R = R;
    const get = n => this.root.getObjectByName(n) || null;
    this.weaponR = get('weaponR'); this.weaponL = get('weaponL'); this.shield = get('shield');
    this.cape = get('cape'); this.capeLow = get('capeLow'); this.flapF = get('flapF'); this.flapB = get('flapB');
    this.focus = get('focus'); this.focusGlow = get('focusGlow'); this.halo = get('halo'); this.fireHand = get('fireHand');
    this.tipR = get('tipR'); this.tipL = get('tipL');
    const sp = get('spin'); this.spin = sp ? [sp] : null;
    this.phase = 0; this.time = Math.random() * 10;
    this.act = null; // one-shot action { kind, t, dur, side }
    this.atkSide = 1; this.lastSide = 0;
    this.deadT = 0; this.hitT = 0; this.hitDur = 0.3; this.hitAmp = 1; this.hitSide = 1;
    this.aimS = 0; this.glowS = 0;
    this.opacity = 1;
    this.P = {}; for (const key of POSE_KEYS) this.P[key] = 0;
  }

  play(kind, dur = 0.45) {
    if (kind === 'flinch') { this.hit(1.3); return; }
    if (kind === 'attack') { this.atkSide = 1 - this.atkSide; this.lastSide = this.atkSide; }
    else if (kind === 'stab') this.lastSide = 0;
    this.act = { kind, t: 0, dur: Math.max(0.05, dur || 0.45), side: this.atkSide };
  }

  hit(strength = 1) {
    const amp = Math.max(0.3, Math.min(2.5, +strength || 1));
    this.hitAmp = this.hitT > 0 ? Math.max(amp, this.hitAmp) : amp;
    this.hitDur = 0.24 + 0.16 * Math.max(0, this.hitAmp - 1);
    this.hitT = this.hitDur;
    this.hitSide = Math.random() < 0.5 ? -1 : 1;
  }

  setOpacity(a) {
    if (Math.abs(a - this.opacity) < 0.01) return;
    this.opacity = a;
    for (const m of this.materials) {
      const ud = m.userData;
      const wasT = m.transparent;
      m.transparent = a < 0.999 || ud.baseTransparent;
      m.opacity = ud.baseOpacity * a;
      m.depthWrite = a > 0.99 ? ud.baseDepthWrite : false;
      if (wasT !== m.transparent) m.needsUpdate = true;
    }
    this.root.visible = a > 0.02;
  }

  // st: { speed (0..1+), back, strafe (-1..1), air, casting, castProgress, stunned, disoriented, dead, victory, tempest }
  update(dt, st) {
    st = st || EMPTY_STATE;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const R = this.R, P = this.P, T = this.time;
    const m = Math.min(1.3, st.speed || 0), moving = m > 0.05, mm = Math.min(1, m);
    this.phase += dt * (5.5 + m * 5) * (st.back ? -1 : 1) * (moving ? 1 : 0);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const breathe = Math.sin(T * 2);

    // ---- base: idle / locomotion
    P.bodyY = 0.98 + breathe * 0.006 + (moving ? (Math.abs(c) * 0.075 - 0.03) * mm : 0);
    P.bodyZ = 0; P.rootTilt = 0;
    P.bodyRotY = st.strafe ? st.strafe * -0.5 * mm : 0;
    P.bodyRoll = st.strafe ? -st.strafe * 0.1 * mm : 0;
    P.hipsY = s * 0.14 * mm; P.hipsZ = c * 0.05 * mm;
    P.spineX = (st.back ? -0.04 : 0.14) * mm + breathe * 0.012; P.spineY = 0; P.spineZ = -P.hipsZ * 0.6;
    P.chestY = -s * 0.24 * mm;
    P.headX = -P.spineX * 0.6; P.headY = -(P.hipsY + P.chestY) * 0.8;
    P.legLx = s * 0.8 * mm; P.legRx = -s * 0.8 * mm; P.legLz = 0.03; P.legRz = -0.03;
    P.knL = Math.max(0, -c) * 1.15 * mm + 0.06 + 0.1 * mm; P.knR = Math.max(0, c) * 1.15 * mm + 0.06 + 0.1 * mm;
    P.shLx = -s * 0.6 * mm; P.shRx = s * 0.6 * mm; P.shLy = 0; P.shRy = 0;
    P.shLz = 0.1 + 0.05 * mm - breathe * 0.01; P.shRz = -0.1 - 0.05 * mm + breathe * 0.01;
    P.elL = -0.2 - 0.6 * mm; P.elR = -0.2 - 0.6 * mm; P.hdL = 0; P.hdR = 0;
    P.aim = 0; P.glow = 0;
    this.classIdle(P, m, T);

    if (st.air) { P.legLx = -0.7; P.legRx = 0.25; P.knL = 1.3; P.knR = 0.6; P.shLz = 0.45; P.shRz = -0.45; P.shLx -= 0.3; P.shRx -= 0.3; P.spineX = 0.05; }

    if (st.casting) {
      const pr = clamp01(st.castProgress || 0), build = smooth(0, 0.25, pr), tr = Math.sin(T * 31) * 0.03 * pr;
      P.shRx = -0.9 - 0.5 * build + tr; P.elR = -0.6 + 0.3 * build; P.shLx = -0.8 - 0.6 * build - tr; P.elL = -0.7 + 0.2 * build;
      P.shLz = 0.3; P.shRz = -0.25; P.spineX = 0.05 - 0.12 * pr; P.headX = -0.08; P.aim = 0.15 * build; P.glow = 0.3 + pr;
      P.bodyY -= 0.03 * build; P.knL += 0.12 * build; P.knR += 0.12 * build;
      switch (this.cls) {
        case 'priest': P.shLx = P.shRx = -1.4 - 0.6 * build + tr; P.shLz = 0.45; P.shRz = -0.45; P.elL = P.elR = -0.2; P.headX = -0.25 * build; break;
        case 'mage': P.shLx = -1.3 + Math.sin(T * 6) * 0.12; P.shLz = 0.35 + Math.cos(T * 6) * 0.12; P.elL = -0.4; P.shRx = -1.0 + tr; P.aim = 0.25 * build; break;
        case 'shaman': P.shRx = -1.2 - 1.0 * build + tr; P.elR = -0.3; P.shLx = -1.2; P.elL = -0.5; P.headX = -0.2 * build; break;
      }
    }
    if (st.tempest) { P.shLz = 1.4; P.shRz = -1.4; P.shLx = -0.2; P.shRx = -0.2; P.elL = 0; P.elR = 0; P.spineX = 0.2; P.knL = P.knR = 0.35; P.bodyY -= 0.08; }

    // ---- one-shot action overlay
    const a = this.act;
    if (a) {
      a.t += dt;
      const u = clamp01(a.t / a.dur);
      const wind = smooth(0, 0.3, u), sx = clamp01((u - 0.3) / 0.22), strike = 1 - (1 - sx) * (1 - sx) * (1 - sx);
      const env = 1 - smooth(0.6, 1, u);
      const mix = (base, v) => base + (v - base) * env;
      // W: base -> windup pose A -> strike pose B, then recover to base
      const W = (base, A, B) => { const p = base + (A - base) * wind; return base + (p + (B - p) * strike - base) * env; };
      switch (a.kind) {
        case 'attack': this.attackPose(P, a.side, W, strike, env); break;
        case 'slash':
          P.shRx = W(P.shRx, -2.6, -0.6); P.shRz = mix(P.shRz, -0.4); P.elR = W(P.elR, -0.6, -0.15); P.hdR = W(0, 0.4, -0.3);
          P.spineY = W(0, 0.5, -0.55); P.chestY = W(P.chestY, 0.2, -0.3); P.spineX = W(P.spineX, -0.05, 0.25);
          P.legLx = mix(P.legLx, -0.35 * strike); P.knL = mix(P.knL, 0.35); P.bodyY -= 0.05 * strike * env; break;
        case 'stab':
          P.shRx = W(P.shRx, -0.5, -1.6); P.elR = W(P.elR, -1.7, -0.15); P.shLx = W(P.shLx, -0.5, -1.35); P.elL = W(P.elL, -1.5, -0.3);
          P.spineY = W(0, -0.3, 0.25); P.spineX = mix(P.spineX, 0.3); P.legLx = mix(P.legLx, -0.4 * strike); P.knL = mix(P.knL, 0.4); P.bodyY -= 0.05 * env; break;
        case 'finisher':
          P.shRx = W(P.shRx, -2.8, -0.7); P.shLx = W(P.shLx, -2.8, -0.7); P.elR = P.elL = mix(-0.3, -0.3);
          P.shRz = mix(P.shRz, -0.3); P.shLz = mix(P.shLz, 0.3); P.spineX = W(P.spineX, -0.2, 0.45); P.bodyY -= 0.15 * strike * env;
          P.knL = mix(P.knL, 0.6 * strike); P.knR = mix(P.knR, 0.6 * strike); break;
        case 'bash':
          P.shLx = W(P.shLx, -0.4, -1.6); P.shLz = mix(P.shLz, 0.3); P.elL = W(P.elL, -1.2, -0.1); P.spineY = W(0, -0.4, 0.6);
          P.legLx = mix(P.legLx, -0.45 * strike); P.knL = mix(P.knL, 0.3); P.bodyZ = mix(0, 0.12 * strike); break;
        case 'release':
          P.shRx = W(P.shRx, -0.9, -1.5); P.shLx = W(P.shLx, -0.9, -1.5); P.elR = W(P.elR, -1.2, -0.1); P.elL = W(P.elL, -1.2, -0.1);
          P.spineX = W(P.spineX, -0.15, 0.2); P.shLz = mix(P.shLz, 0.2); P.shRz = mix(P.shRz, -0.2); P.aim = mix(P.aim, 0.6 * strike); P.glow = mix(P.glow, 1.5 * strike); break;
        case 'raise':
          P.shRx = mix(P.shRx, -2.9); P.shLx = mix(P.shLx, -2.9); P.shLz = mix(P.shLz, 0.3); P.shRz = mix(P.shRz, -0.3); P.elR = mix(P.elR, 0); P.elL = mix(P.elL, 0);
          P.headX = mix(P.headX, -0.4); P.spineX = mix(P.spineX, -0.15); P.glow = mix(P.glow, 1.2); P.bodyY += 0.04 * env; break;
        case 'slam':
          P.shRx = W(P.shRx, -2.8, 0.1); P.shLx = W(P.shLx, -2.6, 0.0); P.spineX = W(P.spineX, -0.2, 0.6); P.bodyY -= 0.25 * strike * env;
          P.knL = mix(P.knL, 0.9 * strike); P.knR = mix(P.knR, 0.9 * strike); P.legLx = mix(P.legLx, -0.6 * strike); P.legRx = mix(P.legRx, -0.6 * strike); P.glow = mix(P.glow, strike); break;
        case 'dash':
          P.spineX = mix(P.spineX, 0.5); P.shLx = mix(P.shLx, 0.8); P.shRx = mix(P.shRx, 0.8); P.elL = mix(P.elL, -0.3); P.elR = mix(P.elR, -0.3);
          P.legLx = mix(P.legLx, -0.8); P.legRx = mix(P.legRx, 0.6); P.knR = mix(P.knR, 1.0); P.knL = mix(P.knL, 0.3); break;
        case 'charge':
          P.spineX = 0.45; P.shLx = -1.0; P.shLz = 0.25; P.elL = -0.9; P.shRx = 0.6; P.elR = -0.4; P.bodyY -= 0.05;
          P.legLx = Math.sin(T * 30) * 0.9; P.legRx = -Math.sin(T * 30) * 0.9; P.knL = Math.max(0, Math.cos(T * 30)) * 1.2; P.knR = Math.max(0, -Math.cos(T * 30)) * 1.2; break;
      }
      if (a.t >= a.dur) this.act = null;
    }

    // ---- hit reaction (scaled by strength; 2 = critical stagger)
    if (this.hitT > 0) {
      this.hitT = Math.max(0, this.hitT - dt);
      const x = 1 - this.hitT / this.hitDur, f = x < 0.15 ? x / 0.15 : 1 - smooth(0.15, 1, x), A = this.hitAmp * f;
      P.spineX -= 0.3 * A; P.headX -= 0.35 * A; P.chestY += this.hitSide * 0.22 * A; P.spineZ += this.hitSide * 0.08 * A;
      P.shLz += 0.3 * A; P.shRz -= 0.3 * A; P.shLx -= 0.25 * A; P.shRx -= 0.25 * A; P.elL -= 0.3 * A; P.elR -= 0.3 * A;
      P.bodyZ -= 0.07 * A;
      if (this.hitAmp > 1.4) { const C = (this.hitAmp - 1) * f; P.knL += 0.5 * C; P.knR += 0.35 * C; P.bodyY -= 0.09 * C; P.bodyZ -= 0.08 * C; P.legRx += 0.3 * C; P.rootTilt -= 0.08 * C; }
    }

    if (st.stunned) {
      P.headX = 0.5 + Math.sin(T * 3) * 0.1; P.headY = Math.sin(T * 2.2) * 0.2; P.spineX = 0.35; P.shLx = 0.1; P.shRx = 0.1; P.shLz = 0.05; P.shRz = -0.05;
      P.elL = P.elR = -0.15; P.knL = 0.4; P.knR = 0.4; P.bodyY -= 0.1; P.bodyRotY = Math.sin(T * 2) * 0.2; P.bodyRoll = Math.sin(T * 1.7) * 0.06; P.aim = 0;
    }
    if (st.disoriented) {
      P.shLx = -2.6; P.shRx = -2.6; P.elL = -2.2; P.elR = -2.2; P.shLz = 0.6; P.shRz = -0.6; P.headX = 0.3; P.spineX = 0.2;
      P.bodyRotY = Math.sin(T * 2.5) * 0.4; P.knL = P.knR = 0.25; P.aim = 0;
    }

    if (st.victory) this.victoryPose(P, T);

    // ---- death: knees buckle, then topple backwards
    if (st.dead) this.deadT = Math.min(1, this.deadT + dt * 0.85); else this.deadT = Math.max(0, this.deadT - dt * 3);
    const dd = this.deadT;
    if (dd > 0) {
      const buckle = smooth(0, 0.35, dd), fall = smooth(0.3, 0.88, dd), w = smooth(0, 0.12, dd), hold = buckle * (1 - fall);
      const bounce = dd > 0.86 ? Math.sin((dd - 0.86) / 0.14 * PI) * 0.035 : 0;
      const D = (key, v) => { P[key] += (v - P[key]) * w; };
      D('knL', 1.5 * hold + 0.3 * fall); D('knR', 1.3 * hold + 0.15 * fall);
      D('legLx', -1.0 * hold - 0.15 * fall); D('legRx', -0.8 * hold + 0.1 * fall); D('legLz', 0.1); D('legRz', -0.1);
      D('bodyY', 0.98 + (0.6 - 0.98) * buckle + (0.24 + bounce - 0.6) * fall);
      D('spineX', 0.45 * hold - 0.1 * fall); D('headX', 0.45 * hold - 0.3 * fall); D('headY', 0.3 * fall);
      D('rootTilt', -PI / 2 * 0.97 * fall);
      D('shLz', 0.2 * buckle + 1.0 * fall); D('shRz', -0.2 * buckle - 1.0 * fall); D('shLx', 0.2 * hold - 0.4 * fall); D('shRx', 0.2 * hold - 0.4 * fall);
      D('elL', -0.3); D('elR', -0.3); D('spineY', 0); D('chestY', 0); D('bodyZ', 0); D('aim', 0); D('glow', 0); D('hipsY', 0); D('hipsZ', 0);
    }

    // ---- apply with smoothing
    const k = 1 - Math.exp(-dt * 12);
    const fast = (this.act || st.tempest || this.hitT > 0 || dd > 0) ? 1 - Math.exp(-dt * 30) : k;
    const L = (obj, prop, v, kk) => { obj[prop] += (v - obj[prop]) * kk; };
    L(R.body.position, 'y', P.bodyY, dd > 0 ? fast : k); L(R.body.position, 'z', P.bodyZ, fast);
    L(R.body.rotation, 'x', P.rootTilt, dd > 0 ? fast : 1 - Math.exp(-dt * 8));
    L(R.body.rotation, 'z', P.bodyRoll, k);
    if (st.tempest) R.body.rotation.y += dt * 18; else L(R.body.rotation, 'y', P.bodyRotY, k);
    L(R.hips.rotation, 'y', P.hipsY, fast); L(R.hips.rotation, 'z', P.hipsZ, fast);
    L(R.spine.rotation, 'x', P.spineX, fast); L(R.spine.rotation, 'y', P.spineY, fast); L(R.spine.rotation, 'z', P.spineZ, fast);
    L(R.chest.rotation, 'y', P.chestY, fast);
    L(R.head.rotation, 'x', P.headX, k); L(R.head.rotation, 'y', P.headY, k);
    L(R.legL.rotation, 'x', P.legLx, fast); L(R.legR.rotation, 'x', P.legRx, fast);
    L(R.legL.rotation, 'z', P.legLz, fast); L(R.legR.rotation, 'z', P.legRz, fast);
    L(R.knL.rotation, 'x', P.knL, fast); L(R.knR.rotation, 'x', P.knR, fast);
    L(R.shL.rotation, 'x', P.shLx, fast); L(R.shR.rotation, 'x', P.shRx, fast);
    L(R.shL.rotation, 'y', P.shLy, fast); L(R.shR.rotation, 'y', P.shRy, fast);
    L(R.shL.rotation, 'z', P.shLz, fast); L(R.shR.rotation, 'z', P.shRz, fast);
    L(R.elL.rotation, 'x', P.elL, fast); L(R.elR.rotation, 'x', P.elR, fast);
    L(R.handL.rotation, 'x', P.hdL, fast); L(R.handR.rotation, 'x', P.hdR, fast);
    this.aimS += (P.aim - this.aimS) * fast;
    this.glowS += (P.glow - this.glowS) * k;

    // ---- secondary motion: cape, robe/tabard panels, props
    if (this.cape) {
      const capeX = 0.1 + mm * 0.75 + (st.air ? 0.5 : 0) + Math.sin(T * 2.7) * 0.04 + R.spine.rotation.x * 0.8 + Math.max(0, -R.body.position.z) * 2;
      L(this.cape.rotation, 'x', capeX, k);
      L(this.cape.rotation, 'z', -R.chest.rotation.y * 0.3 - R.hips.rotation.y * 0.3, k);
      if (this.capeLow) L(this.capeLow.rotation, 'x', 0.05 + mm * 0.25 + Math.sin(T * 3.3 + 1) * 0.06 + Math.sin(this.phase * 2) * 0.12 * mm, k);
    }
    const lL = R.legL.rotation.x, lR = R.legR.rotation.x;
    if (this.flapF) this.flapF.rotation.x = Math.min(0, Math.min(lL, lR)) * 0.75;
    if (this.flapB) this.flapB.rotation.x = Math.max(0, Math.max(lL, lR)) * 0.6 + mm * 0.12;
    if (this.uprightStaff && this.weaponR) {
      const wr = this.weaponR, aim = this.aimS;
      wr.rotation.x = -(R.shR.rotation.x + R.elR.rotation.x + R.handR.rotation.x) * 0.95 + aim * PI / 2;
      wr.rotation.z = -R.shR.rotation.z * (1 - aim);
    }
    const g = this.glowS;
    if (this.focusGlow) this.focusGlow.scale.setScalar(1 + Math.sin(T * 4) * 0.12 + g * 0.8);
    if (this.spin) for (const r of this.spin) { r.rotation.z += dt * (2 + g * 4); r.rotation.x = PI / 2 + Math.sin(T) * 0.3; }
    if (this.halo) this.halo.rotation.z += dt * (0.8 + g * 2);
    if (this.fireHand) this.fireHand.scale.setScalar(0.8 + Math.sin(T * 13) * 0.15 + Math.sin(T * 7) * 0.1 + g * 0.3);
    for (const em of this.emitMats) em.emissiveIntensity = em.userData.baseEI * (1 + g * 0.6 + Math.sin(T * 3) * 0.08);
  }

  // class basic attack (play('attack')): alternates side each call
  attackPose(P, side, W, strike, env) {
    const lunge = strike * env;
    P.legLx += (-0.35 * lunge); P.legRx += 0.2 * lunge; P.knL += 0.25 * lunge; P.knR += 0.15 * lunge; P.bodyY -= 0.04 * lunge;
    switch (this.cls) {
      case 'warrior':
        if (side === 0) { // heavy forehand: high right -> low left
          P.shRx = W(P.shRx, -2.3, -0.8); P.shRz = W(P.shRz, -0.9, 0.5); P.elR = W(P.elR, -0.9, -0.15); P.hdR = W(P.hdR, 0.3, -0.3);
          P.spineY = W(P.spineY, -0.55, 0.6); P.chestY = W(P.chestY, -0.2, 0.3);
        } else { // backhand: across the body -> out to the right
          P.shRx = W(P.shRx, -1.5, -1.0); P.shRz = W(P.shRz, 0.8, -1.1); P.elR = W(P.elR, -1.4, -0.1); P.hdR = W(P.hdR, -0.2, 0.2);
          P.spineY = W(P.spineY, 0.5, -0.7); P.chestY = W(P.chestY, 0.25, -0.3);
        }
        P.shLx = W(P.shLx, -0.6, -0.9); P.elL = W(P.elL, -1.1, -1.0); P.spineX = W(P.spineX, -0.05, 0.25); P.bodyY -= 0.04 * lunge; break;
      case 'rogue':
        if (side === 0) {
          P.shRx = W(P.shRx, -1.2, -1.35); P.shRz = W(P.shRz, -0.9, 0.5); P.elR = W(P.elR, -1.2, -0.2); P.spineY = W(P.spineY, -0.4, 0.5);
          P.shLx = W(P.shLx, -0.8, -0.6); P.elL = W(P.elL, -1.2, -1.2);
        } else {
          P.shLx = W(P.shLx, -1.2, -1.35); P.shLz = W(P.shLz, 0.9, -0.5); P.elL = W(P.elL, -1.2, -0.2); P.spineY = W(P.spineY, 0.4, -0.5);
          P.shRx = W(P.shRx, -0.8, -0.6); P.elR = W(P.elR, -1.2, -1.2);
        }
        P.spineX = W(P.spineX, 0.25, 0.35); P.bodyY += 0.03 * Math.sin(strike * PI) * env; break;
      case 'mage':
        P.shRx = W(P.shRx, -0.5, -1.45); P.shRz = W(P.shRz, -0.25, 0.05); P.elR = W(P.elR, -1.5, -0.05); P.hdR = W(P.hdR, 0.3, -0.25);
        P.spineX = W(P.spineX, -0.08, 0.18); P.spineY = W(P.spineY, -0.3, 0.15); P.aim = W(P.aim, 0.25, 1.0); P.glow = W(P.glow, 0.4, 1.4);
        P.shLx = W(P.shLx, -0.6, -0.3); P.shLz = W(P.shLz, 0.5, 0.6); break;
      case 'priest':
        P.shRx = W(P.shRx, -2.5, -1.1); P.elR = W(P.elR, -1.2, -0.05); P.hdR = W(P.hdR, 0.6, -0.5); P.shRz = W(P.shRz, -0.2, 0.1);
        P.spineX = W(P.spineX, -0.15, 0.25); P.spineY = W(P.spineY, -0.3, 0.25); P.glow = W(P.glow, 0.5, 1.4);
        P.shLx = W(P.shLx, -0.4, -0.9); P.elL = W(P.elL, -0.8, -0.3); break;
      case 'shaman':
        P.shRx = W(P.shRx, -0.7, -1.5); P.elR = W(P.elR, -1.4, -0.1); P.aim = W(P.aim, 0.2, 0.85); P.glow = W(P.glow, 0.4, 1.4);
        P.spineY = W(P.spineY, -0.4, 0.3); P.spineX = W(P.spineX, -0.05, 0.2);
        P.shLx = W(P.shLx, -0.9, 0.2); P.elL = W(P.elL, -1.3, -0.6); break;
      default:
        P.shRx = W(P.shRx, -2.4, -0.7); P.elR = W(P.elR, -0.6, -0.1); P.spineY = W(P.spineY, 0.5, -0.5);
    }
  }

  classIdle(P, m, T) {
    const i = 1 - Math.min(1, m * 2);
    if (i <= 0) return;
    switch (this.cls) {
      case 'mage':
        P.shRx += -0.3 * i; P.elR += -0.5 * i; P.shLx += -0.35 * i; P.elL += -0.7 * i; P.shLz += 0.1 * i;
        P.hipsZ += Math.sin(T * 0.8) * 0.03 * i; P.spineZ -= Math.sin(T * 0.8) * 0.02 * i; break;
      case 'rogue':
        P.knL += 0.4 * i; P.knR += 0.4 * i; P.legLx += -0.25 * i; P.legRx += -0.25 * i; P.legLz += 0.08 * i; P.legRz -= 0.08 * i;
        P.bodyY += (-0.08 + Math.sin(T * 4) * 0.01) * i; P.spineX += 0.25 * i; P.headX -= 0.2 * i;
        P.shRx += -0.5 * i; P.elR += -1.1 * i; P.shLx += -0.5 * i; P.elL += -1.1 * i; P.chestY += Math.sin(T * 1.3) * 0.08 * i; break;
      case 'warrior':
        P.shLx += -0.7 * i; P.elL += -1.1 * i; P.shLz += 0.1; P.shRx += -0.25 * i; P.elR += -0.7 * i;
        P.legLx += -0.18 * i; P.legRx += 0.15 * i; P.legLz += 0.08 * i; P.legRz -= 0.08 * i; P.knL += 0.15 * i; P.knR += 0.15 * i;
        P.bodyY -= 0.03 * i; P.chestY -= 0.15 * i; P.spineX += Math.sin(T * 1.6) * 0.015 * i; break;
      case 'priest':
        P.shLx += -0.4 * i; P.elL += -0.9 * i; P.shRx += -0.2 * i; P.elR += -0.6 * i; P.bodyY += Math.sin(T * 1.5) * 0.015 * i; P.headX -= 0.05 * i; break;
      case 'shaman':
        P.shRx += -0.35 * i; P.elR += -0.4 * i; P.shLx += -0.25 * i; P.elL += -0.9 * i; P.spineX += 0.1 * i;
        P.knL += 0.12 * i; P.knR += 0.12 * i; P.legLz += 0.06 * i; P.legRz -= 0.06 * i; P.headY += Math.sin(T * 0.7) * 0.15 * i; break;
    }
  }

  victoryPose(P, T) {
    switch (this.cls) {
      case 'warrior': P.shRx = -3.0; P.shRz = -0.2; P.elR = 0; P.shLx = -0.5; P.elL = -1.0; P.bodyY += Math.abs(Math.sin(T * 3)) * 0.1; P.headX = -0.3; P.spineX = -0.1; break;
      case 'mage': P.shRx = -3.1; P.elR = 0; P.shLz = 1.2; P.shLx = -0.4; P.headX = -0.3; P.glow = 1; break;
      case 'rogue': P.shRx = -2.6 + Math.sin(T * 6) * 0.3; P.shLx = -2.6 - Math.sin(T * 6) * 0.3; P.elR = -0.2; P.elL = -0.2; P.shLz = 0.5; P.shRz = -0.5; P.bodyY += Math.abs(Math.sin(T * 6)) * 0.08; break;
      case 'priest': P.shLz = 1.6; P.shRz = -1.6; P.shLx = -0.5; P.shRx = -0.5; P.elL = 0; P.elR = 0; P.headX = -0.5; P.bodyY += 0.15 + Math.sin(T * 2) * 0.05; P.glow = 1; break;
      case 'shaman': P.shRx = -2.9 + Math.abs(Math.sin(T * 4)) * 0.6; P.elR = -0.2; P.shLx = -2.0; P.shLz = 0.6; P.headX = -0.4; P.knL = 0.2 + Math.abs(Math.sin(T * 4)) * 0.3; P.knR = P.knL; P.glow = 1; break;
    }
  }

  // world position of the spell focus (staff crystal / mace head / totem orb / sword), used as projectile origin
  focusWorld(out = new THREE.Vector3()) {
    return (this.focus || this.R.handR).getWorldPosition(out);
  }

  // world position of the active weapon tip (for melee trails); rogue alternates hands with 'attack'
  weaponTipWorld(out = new THREE.Vector3()) {
    const o = (this.lastSide === 1 && this.tipL) ? this.tipL : (this.tipR || this.R.handR);
    return o.getWorldPosition(out);
  }
}
