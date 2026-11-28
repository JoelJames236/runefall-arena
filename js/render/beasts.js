// Druid shapeshift creatures: a great cat (Cat Form) and a bear (Bear Form).
//
// Built procedurally as ONE smooth skinned mesh per creature: the body, neck and head are a single
// sweep along the spine with anatomical cross-sections (deep chest, tucked waist, shoulder hump,
// muzzle), each leg is a muscled sweep along its own joint chain, and everything is skinned to a real
// skeleton (spine, neck, head, jaw, tail, 4 × 3-bone legs). Fur comes from vertex colours (dark back,
// light belly and muzzle, panther stripes), a streaked fur texture used as colour + bump, and an
// alpha-tested fur shell that breaks up the silhouette. Animation is procedural: walk, trot / gallop
// with spine flex, idle breathing, tail and ear motion, a pounce (cat) or rear-up maul (bear), death.
// Two draw calls per creature (body + fur shell) plus a few small eye / claw meshes.
import * as THREE from 'three';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
// cheap deterministic value noise
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), xf), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), xf), yf); };

let FUR = null;
function furTextures() {
  if (FUR) return FUR;
  const mk = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 256; draw(c.getContext('2d'), 256); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
  // streaks along the hair direction (v): colour + bump
  const map = mk((g, S) => { g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) { const x = Math.random() * S, y = Math.random() * S, l = 6 + Math.random() * 16, v = 120 + Math.random() * 135 | 0; g.strokeStyle = `rgba(${v},${v},${v},0.5)`; g.lineWidth = 1 + Math.random(); g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y + l); g.stroke(); } });
  map.colorSpace = THREE.SRGBColorSpace;
  // fur shell: dense strands (white = hair, black = gap) for alpha testing
  const alpha = mk((g, S) => { g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 5200; i++) { const x = Math.random() * S, y = Math.random() * S, v = 150 + Math.random() * 105 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 1.6, 3 + Math.random() * 4); } });
  return (FUR = { map, alpha });
}

// ------------------------------------------------------------------ geometry builder
class Builder {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.si = []; this.sw = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  vert(p, u, v, c, bones) { // bones: [[index, weight], ...] up to 4
    this.pos.push(p.x, p.y, p.z); this.uv.push(u, v); this.col.push(c.r, c.g, c.b);
    const b = bones.slice(0, 4); while (b.length < 4) b.push([0, 0]);
    const sum = b.reduce((s, x) => s + x[1], 0) || 1;
    for (const [i, w] of b) { this.si.push(i); this.sw.push(w / sum); }
  }
  // Sweep a superelliptic cross-section along stations {p, w, top, bot, bones, tilt?}.
  // ref: the "up" reference for the cross-section frame; colour(p, ang, t) -> THREE.Color
  sweep(st, { n = 18, sub = 4, ref = V3(0, 1, 0), exp = 2.3, color, noise = 0, uvScale = 3, capStart = true, capEnd = true }) {
    const curve = new THREE.CatmullRomCurve3(st.map(s => s.p), false, 'centripetal');
    const M = (st.length - 1) * sub, start = this.n, rows = [];
    for (let j = 0; j <= M; j++) {
      const t = j / M, sf = t * (st.length - 1), a = Math.min(st.length - 2, Math.floor(sf)), f = smooth(sf - a), A = st[a], B = st[a + 1];
      const c = curve.getPointAt ? curve.getPoint(t) : curve.getPoint(t), T = curve.getTangent(t).normalize();
      const S = new THREE.Vector3().crossVectors(ref, T); if (S.lengthSq() < 1e-6) S.set(1, 0, 0); S.normalize();
      const U = new THREE.Vector3().crossVectors(T, S).normalize();
      const w = lerp(A.w, B.w, f), top = lerp(A.top, B.top, f), bot = lerp(A.bot, B.bot, f);
      // bone weights blend between the two stations
      const bw = new Map(); for (const [bi, ww] of A.bones) bw.set(bi, (bw.get(bi) || 0) + ww * (1 - f)); for (const [bi, ww] of B.bones) bw.set(bi, (bw.get(bi) || 0) + ww * f);
      const bones = [...bw].sort((x, y) => y[1] - x[1]);
      rows.push(this.n);
      for (let i = 0; i <= n; i++) {
        const ang = i / n * Math.PI * 2, sa = Math.sin(ang), ca = Math.cos(ang);
        const ex = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / exp), ey = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / exp);
        const rough = 1 + noise * (vnoise(i * 0.9 + 3, j * 0.45) - 0.5) * 2;
        const p = c.clone().addScaledVector(S, ex * w * rough).addScaledVector(U, ey * (ca > 0 ? top : bot) * rough);
        this.vert(p, i / n * 2, t * uvScale, color(p, ang, t), bones);
      }
    }
    for (let j = 0; j < M; j++) for (let i = 0; i < n; i++) { const a = rows[j] + i, b = rows[j + 1] + i; this.idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const cap = (row, p, bones, rev) => { const ci = this.n; this.vert(p, 0.5, 0.5, color(p, Math.PI, 0), bones); for (let i = 0; i < n; i++) rev ? this.idx.push(ci, row + i + 1, row + i) : this.idx.push(ci, row + i, row + i + 1); };
    if (capStart) cap(rows[0], st[0].p, st[0].bones, false);
    if (capEnd) cap(rows[M], st[st.length - 1].p, st[st.length - 1].bones, true);
    return start;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx); g.computeVertexNormals();
    return g;
  }
}

// ------------------------------------------------------------------ species
// Proportions in metres for a creature facing +Z, standing on y = 0.
const SPECIES = {
  cat: { // a lean great cat: deep chest, tucked waist, long tail, small head with a short muzzle
    stations: [ // z, y(centre), half-width, top, bottom, bone
      [-0.86, 0.79, 0.07, 0.06, 0.07, 'pelvis'], [-0.74, 0.8, 0.17, 0.12, 0.15, 'pelvis'], [-0.5, 0.79, 0.19, 0.12, 0.15, 'pelvis'], [-0.22, 0.81, 0.16, 0.12, 0.12, 'spine'],
      [0.08, 0.83, 0.2, 0.14, 0.23, 'chest'], [0.34, 0.89, 0.21, 0.15, 0.22, 'chest'], [0.54, 0.98, 0.15, 0.13, 0.14, 'neck'], [0.7, 1.06, 0.115, 0.11, 0.1, 'neck'],
      [0.8, 1.1, 0.13, 0.11, 0.1, 'head'], [0.91, 1.09, 0.15, 0.1, 0.095, 'head'], [0.99, 1.05, 0.09, 0.07, 0.07, 'head'], [1.045, 1.04, 0.05, 0.045, 0.045, 'head']],
    legs: { front: { z: 0.3, x: 0.13, top: 0.86, elbow: [0.0, 0.52, -0.06], wrist: [0, 0.14, 0.0], paw: [0, 0.03, 0.08], r: [0.145, 0.088, 0.056, 0.072] },
            back: { z: -0.62, x: 0.13, top: 0.84, elbow: [0, 0.55, 0.12], wrist: [0, 0.16, -0.09], paw: [0, 0.03, 0.02], r: [0.17, 0.095, 0.052, 0.066] } },
    tail: { len: 0.95, r: 0.05, droop: 0.35 }, tailCurl: true, ears: 'pointed', furLen: 0.008, noise: 0.03, exp: 2.2,
    colors: { back: 0x2c2620, side: 0x463a2e, belly: 0x7a6a56, muzzle: 0x8a7a64, stripe: 0x0e0a08 }, stripes: true, eyes: 0xa8ff5a, claws: false,
  },
  bear: { // a massive bear: shoulder hump, heavy forequarters, broad head, short tail, plantigrade feet
    stations: [
      [-0.98, 0.98, 0.14, 0.12, 0.14, 'pelvis'], [-0.82, 1.03, 0.32, 0.22, 0.3, 'pelvis'], [-0.5, 1.03, 0.37, 0.25, 0.36, 'pelvis'], [-0.15, 1.05, 0.38, 0.27, 0.38, 'spine'],
      [0.18, 1.1, 0.39, 0.33, 0.4, 'chest'], [0.42, 1.2, 0.36, 0.33, 0.38, 'chest'], [0.66, 1.14, 0.27, 0.23, 0.25, 'neck'], [0.82, 1.12, 0.22, 0.18, 0.18, 'neck'],
      [0.93, 1.13, 0.21, 0.17, 0.16, 'head'], [1.06, 1.09, 0.19, 0.15, 0.14, 'head'], [1.2, 1.02, 0.11, 0.09, 0.08, 'head'], [1.3, 1.0, 0.055, 0.05, 0.05, 'head']],
    legs: { front: { z: 0.38, x: 0.22, top: 1.08, elbow: [0, 0.62, -0.05], wrist: [0, 0.16, 0.02], paw: [0, 0.05, 0.12], r: [0.2, 0.14, 0.11, 0.12] },
            back: { z: -0.68, x: 0.21, top: 1.02, elbow: [0, 0.58, 0.1], wrist: [0, 0.15, -0.03], paw: [0, 0.05, 0.12], r: [0.24, 0.15, 0.11, 0.12] } },
    tail: { len: 0.14, r: 0.07, droop: 0.6 }, ears: 'round', furLen: 0.03, noise: 0.07, exp: 2.0,
    colors: { back: 0x3e2716, side: 0x4e321c, belly: 0x2e1d10, muzzle: 0x8a6a4c, stripe: 0x000000 }, stripes: false, eyes: 0xffc860, claws: true,
  },
};

// pets: the Hunter's jungle cat (a tawny striped cat) and the Shaman's spirit wolf (a spectral canine)
SPECIES.junglecat = { ...SPECIES.cat, colors: { back: 0x7a4a1e, side: 0xb07434, belly: 0xeadcc0, muzzle: 0xf2e6d0, stripe: 0x24140a }, eyes: 0xffd040 };
SPECIES.wolf = { ...SPECIES.cat, tailCurl: false, stripes: false, ears: 'tall', spectral: true, eyes: 0xeaffff,
  stations: [...SPECIES.cat.stations.slice(0, 8), [0.8, 1.1, 0.12, 0.1, 0.09, 'head'], [0.9, 1.08, 0.12, 0.09, 0.08, 'head'], [1.03, 1.035, 0.068, 0.055, 0.055, 'head'], [1.14, 1.025, 0.038, 0.034, 0.034, 'head']],
  tail: { len: 0.72, r: 0.075, droop: 0.65 }, noise: 0.06, colors: { back: 0x6a8aa8, side: 0x8ab0d0, belly: 0xc8e4ff, muzzle: 0xd8f0ff, stripe: 0x000000 } };
export function makeBeast(kind) {
  const S = SPECIES[kind] || SPECIES.cat, C = Object.fromEntries(Object.entries(S.colors).map(([k, v]) => [k, new THREE.Color(v)]));
  // ---- skeleton (all bones axis-aligned at rest; animation only rotates them)
  const bones = [], B = {};
  const bone = (name, abs, parent) => { const b = new THREE.Bone(); b.name = name; b.userData.abs = abs.clone(); b.position.copy(parent ? abs.clone().sub(parent.userData.abs) : abs); if (parent) parent.add(b); B[name] = b; bones.push(b); return b; };
  const st = S.stations, at = z => { for (let i = 0; i < st.length - 1; i++) if (z >= st[i][0] && z <= st[i + 1][0]) { const f = (z - st[i][0]) / (st[i + 1][0] - st[i][0]); return lerp(st[i][1], st[i + 1][1], f); } return st[0][1]; };
  const root = bone('root', V3(0, 0, 0));
  const pelvis = bone('pelvis', V3(0, at(-0.55), S.legs.back.z + 0.05), root);
  const spine = bone('spine', V3(0, at(-0.15), -0.15), pelvis);
  const chest = bone('chest', V3(0, at(S.legs.front.z), S.legs.front.z), spine);
  const neckZ = st[6][0], headZ = st[8][0];
  const neck = bone('neck', V3(0, st[6][1], neckZ), chest);
  const head = bone('head', V3(0, st[8][1], headZ), neck);
  const jaw = bone('jaw', V3(0, st[9][1] - st[9][4] * 0.6, st[9][0] - 0.04), head);
  const tailBones = []; { let p = pelvis; const n = 5, T = S.tail; for (let i = 0; i < n; i++) { const u = (i + 1) / n; const abs = V3(0, st[0][1] - Math.sin(u * 1.3) * T.len * T.droop * 0.7 + (S.tailCurl ? Math.max(0, u - 0.7) * 0.25 : 0), st[0][0] - u * T.len * 0.85); p = bone('tail' + i, i === 0 ? V3(0, st[0][1], st[0][0]) : abs, p); tailBones.push(p); } }
  const legs = {};
  for (const [key, L, parent] of [['FL', S.legs.front, chest], ['FR', S.legs.front, chest], ['BL', S.legs.back, pelvis], ['BR', S.legs.back, pelvis]]) {
    const sx = key[1] === 'L' ? 1 : -1;
    const top = V3(sx * L.x, L.top, L.z), elbow = V3(sx * L.x, L.elbow[1], L.z + L.elbow[2]), wrist = V3(sx * L.x * 0.95, L.wrist[1], L.z + L.wrist[2]), paw = V3(sx * L.x * 0.95, L.paw[1], L.z + L.paw[2]);
    const up = bone(key + '_up', top, parent), lo = bone(key + '_lo', elbow, up), pw = bone(key + '_paw', wrist, lo);
    legs[key] = { up, lo, pw, pts: [top, elbow, wrist, paw], r: L.r, sx };
  }
  const bi = b => bones.indexOf(b);

  // ---- colours
  const col = (p, ang, t, part) => {
    const ca = Math.cos(ang);                                     // +1 = back, -1 = belly
    let c = C.side.clone().lerp(C.back, smooth(Math.max(0, ca))).lerp(C.belly, smooth(Math.max(0, -ca - 0.15) / 0.85));
    if (part === 'body' && p.z > st[9][0] - 0.02) c.lerp(C.muzzle, smooth(Math.min(1, (p.z - st[9][0] + 0.02) / 0.12)) * (ca < 0.6 ? 1 : 0.4));
    if (S.stripes && part !== 'paw') { const s = Math.sin(p.z * 26 + vnoise(p.y * 8, p.x * 8) * 3 + Math.abs(p.x) * 6); if (s > 0.55 && ca > -0.35) c.lerp(C.stripe, 0.75 * smooth((s - 0.55) / 0.45)); }
    if (part === 'leg' || part === 'paw') c.multiplyScalar(kind === 'bear' ? 0.75 : 0.9);
    return c.multiplyScalar(0.9 + vnoise(p.x * 30, p.z * 30 + p.y * 20) * 0.2);
  };

  // ---- body sweep (pelvis → spine → chest → neck → head)
  const G = new Builder();
  G.sweep(st.map(([z, y, w, top, bot, b]) => ({ p: V3(0, y, z), w, top, bot, bones: [[bi(B[b]), 1]] })), { n: 22, sub: 5, exp: S.exp, noise: S.noise, color: (p, a, t) => col(p, a, t, 'body') });
  // legs: shoulder / thigh muscle merges into the body, then upper leg, forearm / shin, paw
  for (const L of Object.values(legs)) {
    const [top, elbow, wrist, paw] = L.pts, r = L.r;
    const inBody = top.clone().add(V3(-L.sx * 0.04, 0.08, 0));
    const mid = top.clone().lerp(elbow, 0.45).add(V3(0, 0, 0.0));
    G.sweep([
      { p: inBody, w: r[0] * 0.8, top: r[0] * 1.1, bot: r[0] * 1.1, bones: [[bi(L.up), 0.6], [bi(L.up.parent), 0.4]] },
      { p: top, w: r[0], top: r[0] * 1.25, bot: r[0] * 1.25, bones: [[bi(L.up), 1]] },
      { p: mid, w: r[0] * 0.78, top: r[0] * 1.0, bot: r[0] * 1.0, bones: [[bi(L.up), 1]] },
      { p: elbow, w: r[1], top: r[1] * 1.15, bot: r[1] * 1.15, bones: [[bi(L.lo), 0.5], [bi(L.up), 0.5]] },
      { p: elbow.clone().lerp(wrist, 0.5), w: r[1] * 0.82, top: r[1] * 0.95, bot: r[1] * 0.95, bones: [[bi(L.lo), 1]] },
      { p: wrist, w: r[2], top: r[2] * 1.05, bot: r[2] * 1.05, bones: [[bi(L.pw), 0.5], [bi(L.lo), 0.5]] },
      { p: paw.clone().add(V3(0, 0.0, -0.02)), w: r[3] * 1.1, top: r[3] * 0.75, bot: r[3] * 0.6, bones: [[bi(L.pw), 1]] },
      { p: paw.clone().add(V3(0, -0.005, r[3] * 1.2)), w: r[3] * 0.8, top: r[3] * 0.45, bot: r[3] * 0.35, bones: [[bi(L.pw), 1]] },
    ], { n: 14, sub: 4, ref: V3(0, 0, 1), exp: 2.2, noise: S.noise * 0.6, color: (p, a, t) => col(p, a + Math.PI / 2, t, t > 0.8 ? 'paw' : 'leg'), uvScale: 2 });
  }
  // tail
  { const T = S.tail, tb = [pelvis, ...tailBones];
    G.sweep(tb.map((b, i) => { const u = i / (tb.length - 1), r = T.r * (1 - u * 0.55) * (i === 0 ? 1.5 : 1); return { p: b.userData.abs.clone(), w: r, top: r, bot: r, bones: [[bi(b), 1]] }; }), { n: 10, sub: 3, exp: 2, noise: S.noise, color: (p, a, t) => { const c = col(p, a, t, 'body'); if (S.stripes && t > 0.86) c.lerp(C.stripe, 0.8); return c; } }); }
  const geo = G.geometry();

  // ---- materials, skinned meshes, fur shell
  const F = furTextures();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: F.map, bumpMap: F.map, bumpScale: kind === 'bear' ? 2.2 : 1.0, roughness: kind === 'bear' ? 0.95 : 0.62, metalness: 0, envMapIntensity: 0.8 });
  const body = new THREE.SkinnedMesh(geo, mat); body.castShadow = true; body.receiveShadow = true; body.frustumCulled = false;
  const partMat = new THREE.MeshStandardMaterial({ color: C.side.clone().lerp(C.back, 0.4), map: F.map, bumpMap: F.map, bumpScale: 1, roughness: 0.9 }); // rigid parts (ears, jaw)
  const grp = new THREE.Group(); grp.add(root); grp.updateMatrixWorld(true);
  const skel = new THREE.Skeleton(bones); // inverses from the rest pose (model space)
  grp.add(body); body.bind(skel);
  // shell: the same skin pushed out along the normals, alpha-tested strands
  const sg = geo.clone(), sp = sg.attributes.position, sn = sg.attributes.normal;
  for (let i = 0; i < sp.count; i++) sp.setXYZ(i, sp.getX(i) + sn.getX(i) * S.furLen, sp.getY(i) + sn.getY(i) * S.furLen, sp.getZ(i) + sn.getZ(i) * S.furLen);
  const smat = new THREE.MeshStandardMaterial({ vertexColors: true, map: F.map, alphaMap: F.alpha, alphaTest: 0.5, roughness: 1, metalness: 0 });
  for (const m of [mat, smat, partMat]) m.defines = { USE_RIM: '', RIM_COLOR: 'vec3(0.3, 0.3, 0.32)' }; // silhouette rim (see heroes.js)
  if (S.spectral) { for (const m of [mat, partMat]) { m.emissive = new THREE.Color(0x2a8acc); m.emissiveIntensity = 1.1; m.transparent = true; m.opacity = 0.78; m.depthWrite = false; } smat.visible = false; } // spirit wolf: translucent and glowing
  const shell = new THREE.SkinnedMesh(sg, smat); shell.frustumCulled = false; shell.castShadow = false; grp.add(shell); shell.bind(skel);

  // ---- small rigid parts on bones: eyes, nose, ears, teeth, claws
  const H = head.userData.abs, put = (b, m, abs) => { m.position.copy(abs).sub(b.userData.abs); b.add(m); return m; };
  const eyeM = new THREE.MeshStandardMaterial({ color: S.eyes, emissive: S.eyes, emissiveIntensity: 2.4, roughness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0a0a, roughness: 0.4 });
  const ivory = new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.4 });
  const hz = st[9][0], hy = st[9][1], hw = st[9][2];
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(kind === 'bear' ? 0.022 : 0.024, 10, 8), eyeM); e.scale.set(1.25, 0.7, 0.6); e.rotation.y = s * 0.5; put(head, e, V3(s * hw * 0.62, hy + st[9][3] * 0.45, hz - 0.01));
    const ear = new THREE.Mesh(S.ears === 'round' ? new THREE.SphereGeometry(0.06, 10, 8) : S.ears === 'tall' ? new THREE.ConeGeometry(0.05, 0.13, 7) : new THREE.ConeGeometry(0.045, 0.085, 7), partMat); ear.castShadow = true;
    if (kind === 'bear') ear.scale.set(1, 0.85, 0.45); else { ear.scale.set(1, 1, 0.45); ear.rotation.z = -s * 0.25; }
    put(head, ear, V3(s * st[8][2] * 0.62, st[8][1] + st[8][3] * (kind === 'bear' ? 0.85 : 0.95), st[8][0] - 0.02));
    for (let i = 0; i < 2; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(kind === 'bear' ? 0.014 : 0.01, kind === 'bear' ? 0.05 : 0.055, 5), ivory); f.rotation.x = Math.PI; put(head, f, V3(s * (0.025 + i * 0.012), st[10][1] - st[10][4] * 0.7, st[10][0] + 0.02 - i * 0.02)); }
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(st[11][2] * 0.85, 10, 8), dark); nose.scale.set(1.2, 0.8, 0.8); put(head, nose, V3(0, st[11][1] + st[11][3] * 0.4, st[11][0] + 0.01));
  // lower jaw (rigid, opens on attacks) with teeth
  const jawM = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), partMat); jawM.scale.set(hw * 0.55, st[10][4] * 0.9, 0.14 * (kind === 'bear' ? 1.4 : 1)); jawM.castShadow = true;
  put(jaw, jawM, V3(0, jaw.userData.abs.y + 0.01, st[10][0] - 0.04));
  for (const s of [-1, 1]) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.04, 5), ivory); put(jaw, t, V3(s * 0.022, jaw.userData.abs.y + 0.03, st[10][0] + 0.03)); }
  if (S.claws) for (const L of Object.values(legs)) for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.07, 5), ivory); c.rotation.x = Math.PI / 2 + 0.6; put(L.pw, c, L.pts[3].clone().add(V3((i - 1.5) * 0.035, -0.02, L.r[3] * 1.5))); }

  // ---- animation
  const rest = new Map(bones.map(b => [b, b.position.clone()]));
  const state = { phase: 0, speed: 0, atk: 0, atkWas: false, swipeSide: 1, dead: 0, t: Math.random() * 10, rear: 0 };
  const cat = kind !== 'bear'; // cats and wolves share the lithe gait and the pounce
  // the same pose-layer interface as a generated creature (creatures.js): forms.js adds the druid forms' motions here
  // when the generated model is missing. Bones are axis-aligned at rest, so model-space rotations add up directly.
  const rig = { kind, legs, pelvis, mid: spine, chest, neck, head, jaw, tail: tailBones,
    rot(b, x = 0, y = 0, z = 0) { if (b) { b.rotation.x += x; b.rotation.y += y; b.rotation.z += z; } },
    lift(y) { root.position.y += y; }, push(z) { root.position.z += z; } };
  // st0.dir: -1 runs the gait backwards; st0.layer(rig): extra motion on top of gait, idle and air
  function update(dt, moving, attacking, st0 = {}) {
    const s = state; s.t += dt;
    const targetSpeed = st0.dead ? 0 : (st0.speed !== undefined ? Math.min(1.4, st0.speed) : (moving ? 1 : 0));
    s.speed += (targetSpeed - s.speed) * Math.min(1, dt * 6);
    const gallop = s.speed > 1.05;
    const freq = cat ? (gallop ? 2.7 : 1.9) : (gallop ? 1.9 : 1.35);
    s.phase += dt * Math.PI * 2 * freq * Math.max(0.25, s.speed) * (s.speed > 0.05 ? 1 : 0) * (st0.dir < 0 ? -1 : 1);
    if (attacking && !s.atkWas) { s.atk = 1; s.swipeSide = -s.swipeSide; } s.atkWas = attacking;
    s.atk = Math.max(0, s.atk - dt / (cat ? 0.42 : 0.6));
    s.dead = st0.dead ? Math.min(1, s.dead + dt * 2.2) : Math.max(0, s.dead - dt * 3);
    for (const b of bones) { b.rotation.set(0, 0, 0); b.position.copy(rest.get(b)); }
    const m = Math.min(1, s.speed), P = s.phase;
    // legs: walk = lateral sequence; gallop = front pair / back pair with a small lead
    const off = gallop ? { FL: 0, FR: 0.35, BL: Math.PI, BR: Math.PI + 0.35 } : { FL: 0, FR: Math.PI, BL: Math.PI * 1.5, BR: Math.PI * 0.5 };
    const amp = (cat ? 0.55 : 0.42) * (gallop ? 1.35 : 1) * m;
    for (const [key, L] of Object.entries(legs)) {
      const ph = P + off[key], sw = Math.sin(ph), lift = Math.max(0, Math.cos(ph)) * m, front = key[0] === 'F';
      L.up.rotation.x = -sw * amp;
      if (front) { L.lo.rotation.x = lift * (cat ? 1.1 : 0.8); L.pw.rotation.x = -lift * 0.9; }
      else { L.up.rotation.x += -lift * 0.25; L.lo.rotation.x = -lift * 0.9 + lift * 0.0; L.pw.rotation.x = lift * 1.1; }
    }
    // body: bob, spine flex while galloping, head steadied
    const bob = Math.abs(Math.sin(P)) * (gallop ? 0.06 : 0.025) * m;
    root.position.y = bob - (cat ? 0 : 0.0);
    spine.rotation.x = (gallop ? Math.sin(P) * 0.18 : 0) * m;
    chest.rotation.x = (gallop ? -Math.sin(P) * 0.1 : 0) * m;
    pelvis.rotation.y = Math.sin(P) * 0.05 * m; chest.rotation.y = -Math.sin(P) * 0.06 * m;
    // idle: breathing, looking around; tail sway; ear twitch
    const idle = 1 - m, T = s.t;
    chest.scale.setScalar(1 + Math.sin(T * 2.2) * 0.012 * idle);
    neck.rotation.y = Math.sin(T * 0.37) * 0.35 * idle; neck.rotation.x = -Math.sin(P * 2) * 0.05 * m + (cat ? 0.05 : -0.05) * idle;
    head.rotation.x = -neck.rotation.x * 0.6 + Math.sin(T * 0.9) * 0.04 * idle;
    tailBones.forEach((b, i) => { b.rotation.y = Math.sin(T * (cat ? 1.6 : 2.2) - i * 0.7) * (cat ? 0.22 : 0.1) * (1 + i * 0.25) * (0.5 + idle * 0.5); b.rotation.x = (cat ? (i < 2 ? 0.12 : -0.18) * (1 - m * 0.6) : 0.1) + (gallop ? -0.15 : 0); });
    // attack: cat pounces and rakes with a front paw, bear rears up and mauls with both
    const a = s.atk;
    if (a > 0) {
      const k = Math.sin((1 - a) * Math.PI);
      if (cat) {
        root.position.z += k * 0.35; pelvis.rotation.x = -k * 0.25; chest.rotation.x += -k * 0.15;
        const L = s.swipeSide > 0 ? legs.FL : legs.FR; L.up.rotation.x = -k * 1.6; L.lo.rotation.x = k * 0.6; L.pw.rotation.x = -k * 0.8;
        neck.rotation.x += k * 0.25; jaw.rotation.x = k * 0.55;
      } else {
        const r = Math.sin(Math.min(1, (1 - a) * 1.4) * Math.PI);
        pelvis.rotation.x = -r * 0.75; root.position.y += r * 0.12;
        for (const L of [legs.FL, legs.FR]) { L.up.rotation.x = -r * 1.2 - (1 - a > 0.55 ? k * 0.6 : 0); L.lo.rotation.x = r * 0.5; }
        for (const L of [legs.BL, legs.BR]) L.up.rotation.x = r * 0.75;
        neck.rotation.x = -r * 0.1; head.rotation.x = r * 0.3; jaw.rotation.x = k * 0.7;
      }
    }
    // air: tuck legs
    if (st0.air) for (const L of Object.values(legs)) { L.up.rotation.x += L.up === legs.FL.up || L.up === legs.FR.up ? -0.5 : 0.5; L.lo.rotation.x += 0.4; }
    if (st0.layer) st0.layer(rig);
    // death: roll onto the side, legs limp
    if (s.dead > 0) { const d = smooth(s.dead); root.rotation.z = d * Math.PI / 2 * 0.96; root.position.y = -d * 0.04 + bob * (1 - d); for (const L of Object.values(legs)) { L.up.rotation.x *= 1 - d; L.lo.rotation.x = L.lo.rotation.x * (1 - d) + d * 0.3; } neck.rotation.x += d * 0.3; }
    else root.rotation.z = 0;
  }
  const scale = cat ? 1.0 : 1.0;
  grp.scale.setScalar(scale);
  return { root: grp, update, rig, dispose() { geo.dispose(); sg.dispose(); } };
}
