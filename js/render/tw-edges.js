// Thornwater Gorge — the land round the playable area (look only: the sim's bounds stay the box x ±100, z ±36).
//
// At the edge a steep rocky bank rises about 3 yd within 5, strewn with boulders and bushes, so the boundary reads
// as ground you can't climb, not an invisible wall. Behind it: mountainsides with layered cliffs, rock spires and a
// dense pine forest (dead trees on the Ember side). The waterfall pours from a ledge at the north end, the river
// leaves through a gorge in the south, and behind each keep the land stays low for its back buildings.
// Repeated pieces are InstancedMeshes of a few templates; Tripo models (thornwater-props loadModel) replace the
// templates when their GLBs exist.
import * as THREE from 'three';
import { loadModel, instance } from './thornwater-props.js';

const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v; }
const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.15;

export const CITADEL_X = 146, CITADEL_Y = 30; // each faction's citadel sits on a ledge high on the mountain behind its keep
// height of the land outside the playable area (0 inside it)
export function outerGround(x, z) {
  const az = Math.abs(z), ax = Math.abs(x), n = fbm(x * 0.06, z * 0.06), n2 = fbm(x * 0.15 + 5, z * 0.15);
  const back = 1 - smooth(18, 27, az);                                    // behind a keep
  // the river's channel: out through a gorge in the south, up to the foot of the waterfall in the north
  const gorge = z < 0 ? smooth(5, 11, ax) : 1 - (1 - smooth(5, 11, ax)) * (1 - smooth(38.5, 41, z));
  const bank = 3.2 * smooth(36.2, 41 + (n - 0.5) * 3, az);
  const side = (bank + Math.pow(Math.max(0, az - 41), 1.25) * 1.05) * (1 + (n2 - 0.5) * 0.35) * gorge;
  const oxe = Math.max(0, ax - 100 - 20 * back);
  const end = 3 * smooth(100.2, 104 + (n - 0.5) * 3, ax) * (1 - back) + Math.pow(oxe, 1.3) * 0.9 + Math.max(0, ax - 100) * 0.04 * back;
  let y = Math.max(side, end);
  if (z > 38) y = Math.max(y, 13.5 * smooth(38.6, 41.6, z) * (1 - smooth(4.5, 9, ax)));   // the ledge the waterfall pours from
  const ledge = 1 - smooth(20, 34, Math.hypot(ax - CITADEL_X, z));                          // the citadels' ledge on the mountain
  return y * (1 - ledge) + CITADEL_Y * ledge;
}

// a rough rock: an icosahedron pushed in and out with noise, flat at the bottom
function rockTemplate(seed, stretchY = 1, detail = 2, rough = 0.32) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = fbm(x * 1.7 + seed * 3.1, z * 1.7 + y * 1.3 + seed) - 0.5, strata = Math.sin(y * 7 + seed) * 0.04;
    const k = 1 + n * rough * 2 + strata;
    x *= k; z *= k; y = Math.max(-0.25, y * (1 + n * rough)) * stretchY;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  // box-projected uv, ~1 texture tile per unit
  const n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)); let u, v; if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); } uv[i * 2] = u * 0.5; uv[i * 2 + 1] = v * 0.5; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
function pineTemplate(dead = false) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.22, dead ? 1 : 0.45, 6).translate(0, dead ? 0.5 : 0.225, 0);
  if (dead) {
    parts.push(trunk);
    for (let i = 0; i < 5; i++) parts.push(new THREE.CylinderGeometry(0.02, 0.06, 0.45, 4).translate(0, 0.22, 0).rotateZ(0.9 + i * 0.1).rotateY(i * 1.3).translate(0, 0.45 + i * 0.1, 0));
    return { trunk: mergeSimple(parts), crown: null };
  }
  const crown = [];
  for (let k = 0; k < 4; k++) crown.push(new THREE.ConeGeometry(0.42 - k * 0.085, 0.42, 8).translate(0, 0.3 + k * 0.17 + 0.21, 0));
  return { trunk, crown: mergeSimple(crown) };
}
function mergeSimple(list) {
  const geos = list.map(g => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k); return g; });
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

// rock textured in world space from three sides (triplanar), so scaled-up rocks keep the texture's real size
function triplanarRock(map) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.95 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp2;\nvarying vec3 vWn2;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        mat4 wm2 = modelMatrix;
        #ifdef USE_INSTANCING
          wm2 = modelMatrix * instanceMatrix;
        #endif
        vWp2 = (wm2 * vec4(transformed, 1.0)).xyz;
        vWn2 = normalize(mat3(wm2) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp2;\nvarying vec3 vWn2;')
      .replace('#include <map_fragment>', `
        vec3 bw = pow(abs(normalize(vWn2)), vec3(4.0)); bw /= dot(bw, vec3(1.0));
        vec3 rx = texture2D(map, vWp2.zy * 0.16).rgb, ry = texture2D(map, vWp2.xz * 0.16).rgb, rz = texture2D(map, vWp2.xy * 0.16).rgb;
        diffuseColor.rgb *= rx * bw.x + ry * bw.y + rz * bw.z;`);
  };
  m.customProgramCacheKey = () => 'tw-triplanar';
  return m;
}

export function buildEdges(tw) {
  const group = new THREE.Group(); group.name = 'tw-edges'; tw.group.add(group);
  const rockMat = triplanarRock(tw.mats.rock.map);
  const low = tw.quality === 'low';
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
  const place = (x, y, z, sx, sy, sz, ry, rx = 0, rz = 0) => { _e.set(rx, ry, rz); _q.setFromEuler(_e); return new THREE.Matrix4().compose(_p.set(x, y, z), _q.clone(), _s.set(sx, sy, sz)); };
  // both halves get the same scenery turned 180° (equal visual clarity for both teams)
  const both = list => list.flatMap(p => [p, { ...p, x: -p.x, z: -p.z, ry: (p.ry || 0) + Math.PI }]);
  const inPlay = (x, z, m) => Math.abs(x) < 100 + m && Math.abs(z) < 36 + m;

  // ---- boulders strewn along the bank (just outside the line), bigger rocks a little further up
  const bank = [];
  for (let x = -98; x < 98; x += 4.2) {
    const h = hash(x, 7), z = 37.4 + h * 2.2;
    if (Math.abs(x) < 7.5) continue; // the waterfall pool
    bank.push({ x: x + (hash(x, 3) - 0.5) * 2, z, s: 0.9 + h * 1.7, ry: hash(x, 9) * 6.3 });
  }
  for (let z = -34; z < 34; z += 3.4) { if (Math.abs(z) < 19) continue; const h = hash(z, 11); bank.push({ x: -100.9 - h * 2, z, s: 0.9 + h * 1.6, ry: hash(z, 5) * 6.3 }); }
  // ---- cliffs: layered tall rock masses further up the mountainside; spires at the corners
  const cliffs = [];
  for (let x = -128; x < 128; x += 8) for (let row = 0; row < 2; row++) {
    const h = hash(x, row + 20), z = 45 + row * 9 + h * 4;
    if (row === 0 && Math.abs(x) < 9) continue; // the waterfall ledge
    cliffs.push({ x: x + (hash(x, row) - 0.5) * 4, z, w: 6 + h * 4, hgt: 9 + h * 10 + row * 6, ry: hash(x, row + 4) * 6.3, row });
  }
  for (const [x, z, w, hgt] of [[-6.5, 42.5, 4.5, 16], [6.8, 43, 4.8, 17], [-104, 30, 6, 22], [-112, 8, 7, 16], [-120, -20, 6, 24], [-106, -34, 5, 18]]) cliffs.push({ x, z, w, hgt, ry: hash(x, z) * 6.3 });
  const spires = [{ x: -96, z: 44, s: 1.3 }, { x: -58, z: 50, s: 1.0 }, { x: -30, z: 47, s: 0.8 }, { x: -112, z: 26, s: 1.4 }];
  // ---- the forest: pines on the slopes (dead trees on the Ember half), thinning towards the cliffs
  const pines = [], dead = [];
  for (let i = 0; i < (low ? 220 : 520); i++) {
    const x = (hash(i, 1) - 0.5) * 250, z = 41 + Math.pow(hash(i, 2), 0.7) * 24;
    if (Math.abs(x) < 10 && z < 50) continue;
    const t = { x, z, s: 5 + hash(i, 3) * 7, ry: hash(i, 4) * 6.3, c: hash(i, 5) };
    (x > 30 && hash(i, 6) < 0.35 ? dead : pines).push(t);
  }
  for (let i = 0; i < (low ? 40 : 110); i++) { const z = (hash(i, 31) - 0.5) * 70; if (Math.abs(z) < 20) continue; const x = -(104 + hash(i, 32) * 24); pines.push({ x, z, s: 5 + hash(i, 33) * 6, ry: hash(i, 34) * 6.3, c: hash(i, 35) }); }

  // ---- giant old trees on the bank, towering over the edge of the battlefield
  const giants = [];
  for (let x = -92; x < 92; x += 13) { const h = hash(x, 41); if (Math.abs(x) < 12 || h < 0.25) continue; giants.push({ x: x + (h - 0.5) * 6, z: 40 + hash(x, 42) * 4, s: 13 + h * 6, ry: hash(x, 43) * 6.3 }); }
  const BANK = both(bank), GIANTS = both(giants), CLIFFS = both(cliffs), SPIRES = both(spires), PINES = both(pines), DEAD = both(dead);
  const yAt = (x, z) => outerGround(x, z);

  // procedural versions (templates, instanced); each one is replaced by its Tripo model when that loads
  const slots = [];
  const CHUNK = 64; // instanced copies in 40 yd cells, so what's off screen (or outside the shadow box) is culled
  const make = (geo, mat, list, matFn, color, cast = true) => {
    const cells = new Map();
    for (const p of list) { const k = Math.floor(p.x / CHUNK) + ',' + Math.floor(p.z / CHUNK); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(p); }
    const g = new THREE.Group();
    for (const cl of cells.values()) {
      const im = new THREE.InstancedMesh(geo, mat, cl.length);
      cl.forEach((p, i) => im.setMatrixAt(i, matFn(p)));
      if (color) cl.forEach((p, i) => im.setColorAt(i, color(p)));
      im.castShadow = cast; im.receiveShadow = true; im.computeBoundingSphere(); g.add(im);
    }
    group.add(g);
    return g;
  };
  const rocks = [rockTemplate(1), rockTemplate(2), rockTemplate(3, 1, 2, 0.4)];
  const tone = p => new THREE.Color().setHSL(0.07 + hash(p.x, p.z) * 0.04, 0.05 + hash(p.z, p.x) * 0.08, 0.55 + hash(p.x * 2, p.z) * 0.15);
  // boulders, sunk a little into the bank
  const bankM = p => place(p.x, yAt(p.x, p.z) - p.s * 0.25, p.z, p.s * 1.2, p.s * 0.8, p.s, p.ry);
  const bankParts = [0, 1, 2].map(k => BANK.filter((p, i) => i % 3 === k));
  bankParts.forEach((list, k) => slots.push({ ids: ['N03a', 'N03b', 'N03a'][k], list, mesh: make(rocks[k], rockMat, list, bankM, tone), fit: p => ({ x: p.x, y: yAt(p.x, p.z) - p.s * 0.2, z: p.z, yaw: p.ry, w: p.s * 2.4, d: p.s * 2, h: p.s * 1.6 }) }));
  // cliffs: tall, wide at the base, sunk into the slope
  const cliffTpl = [rockTemplate(7, 1, 3, 0.36), rockTemplate(8, 1, 3, 0.42)];
  const cliffM = p => place(p.x, yAt(p.x, p.z) - 2, p.z, p.w, p.hgt, p.w * 0.8, p.ry);
  // the back row stays a cheap rock mass (mostly in the haze); the front row gets the Tripo cliffs
  const farCliff = rockTemplate(9, 1, 2, 0.4);
  make(farCliff, rockMat, CLIFFS.filter(p => p.row === 1), cliffM, tone, false);
  [0, 1].forEach(k => { const list = CLIFFS.filter(p => p.row !== 1).filter((p, i) => i % 2 === k); slots.push({ ids: ['N01a', 'N01b'][k], cast: false, list, mesh: make(cliffTpl[k], rockMat, list, cliffM, tone, false), fit: p => ({ x: p.x, y: yAt(p.x, p.z) - 2, z: p.z, yaw: p.ry, w: p.w * 2, d: p.w * 1.6, h: p.hgt + 2, fit: 'stretch' }) }); });
  const spireM = p => place(p.x, yAt(p.x, p.z) - 1, p.z, 3.2 * p.s, 16 * p.s, 3 * p.s, hash(p.x, p.z) * 6.3);
  slots.push({ ids: 'N02a', cast: false, list: SPIRES, mesh: make(rockTemplate(11, 1, 2, 0.5), rockMat, SPIRES, spireM, tone, false), fit: p => ({ x: p.x, y: yAt(p.x, p.z) - 1, z: p.z, yaw: 0, w: 7 * p.s, d: 7 * p.s, h: 18 * p.s, fit: 'stretch' }) });
  // trees
  const pine = pineTemplate(false), deadT = pineTemplate(true);
  const treeM = p => place(p.x, yAt(p.x, p.z) - 0.3, p.z, p.s * 0.9, p.s, p.s * 0.9, p.ry);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 });
  const green = p => new THREE.Color().setHSL(0.29 + p.c * 0.07, 0.45 + p.c * 0.15, 0.075 + p.c * 0.06);
  const near = p => Math.abs(p.z) < 47 && Math.abs(p.x) < 104, PN = PINES.filter(near), PF = PINES.filter(p => !near(p));
  make(pine.trunk, barkMat, PF, treeM, null, false); make(pine.crown, leafMat, PF, treeM, green, false); // the far forest: cheap and shadowless
  const trunks = make(pine.trunk, barkMat, PN, treeM, null, false), crowns = make(pine.crown, leafMat, PN, treeM, green, false);
  slots.push({ ids: ['N05a', 'N05b'], cast: false, list: PN, mesh: [trunks, crowns], fit: p => ({ x: p.x, y: yAt(p.x, p.z) - 0.3, z: p.z, yaw: p.ry, w: p.s * 0.9, d: p.s * 0.9, h: p.s * 1.1, fit: 'stretch' }) });
  // giant trees: a trunk and a big clumped crown (until the oak model loads)
  const giantTpl = (() => { const t = new THREE.CylinderGeometry(0.05, 0.09, 0.55, 8).translate(0, 0.275, 0); const c = [0, 1, 2, 3].map(k => new THREE.IcosahedronGeometry(0.2 - k * 0.02, 1).translate(Math.cos(k * 2.1) * 0.12, 0.62 + (k % 2) * 0.12, Math.sin(k * 2.1) * 0.12)); return { trunk: mergeSimple([t]), crown: mergeSimple(c) }; })();
  const giantM = p => place(p.x, yAt(p.x, p.z) - 0.3, p.z, p.s, p.s, p.s, p.ry);
  const gTrunk = make(giantTpl.trunk, barkMat, GIANTS, giantM), gCrown = make(giantTpl.crown, leafMat, GIANTS, giantM, p => new THREE.Color().setHSL(0.27, 0.5, 0.12 + hash(p.x, p.z) * 0.05));
  slots.push({ ids: 'N06', list: GIANTS, mesh: [gTrunk, gCrown], fit: p => ({ x: p.x, y: yAt(p.x, p.z) - 0.3, z: p.z, yaw: p.ry, w: p.s, d: p.s, h: p.s, fit: 'height' }) });
  const deadMat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1 }), deadM = p => place(p.x, yAt(p.x, p.z) - 0.2, p.z, p.s * 0.7, p.s * 0.8, p.s * 0.7, p.ry);
  const DN = DEAD.filter(near); make(deadT.trunk, deadMat, DEAD.filter(p => !near(p)), deadM, null, false);
  const deadMesh = make(deadT.trunk, deadMat, DN, deadM, null, false);
  slots.push({ ids: 'N08', cast: false, list: DN, mesh: deadMesh, fit: p => ({ x: p.x, y: yAt(p.x, p.z) - 0.2, z: p.z, yaw: p.ry, w: p.s * 0.8, d: p.s * 0.8, h: p.s * 0.85, fit: 'stretch' }) });

  // ---- each faction's own scenery outside the playable area (world coordinates; Sunward x < 0, Ember x > 0)
  const decor = [
    // Sunward: cottages on the plateau behind the keep, knight statues at the donjon, the citadel on the mountain
    ['S15', -108, 16, 7, -Math.PI / 2], ['S15', -116, -15, 7.5, -Math.PI / 2 + 0.4], ['S15', -111, -25, 6.5, -0.3], ['S15', -119, 23, 7, -2],
    ['S12', -101.7, 4.6, 5, Math.PI / 2], ['S12', -101.7, -4.6, 5, Math.PI / 2],
    ['S01', -CITADEL_X, 0, 50, Math.PI / 2, 'w'],
    // Ember: war tents, skull totems at the longhouse, the war-fortress on the mountain
    ['E15', 108, -16, 7, Math.PI / 2], ['E15', 116, 15, 7.5, Math.PI / 2 + 0.4], ['E15', 111, 25, 6.5, 2.8], ['E15', 119, -23, 7, 1.2],
    ['E06', 101.7, 4.6, 5.5, -Math.PI / 2], ['E06', 101.7, -4.6, 5.5, -Math.PI / 2],
    ['E01', CITADEL_X, 0, 50, -Math.PI / 2, 'w'],
  ];
  // spike barricades along the Ember half's bank, bushes along the Sunward half's
  for (let x = 46; x < 98; x += 9) for (const zs of [1, -1]) decor.push(['E13', x + hash(x, zs) * 3, zs * (37.8 + hash(zs, x) * 0.8), 4, (zs > 0 ? 0 : Math.PI) + (hash(x, 3) - 0.5) * 0.4, 'w']);
  for (let x = -96; x < -8; x += 7) for (const zs of [1, -1]) decor.push(['N07', x + hash(x, zs + 5) * 3, zs * (37.6 + hash(zs + 5, x) * 1.2), 1.1 + hash(x, zs) * 0.7, hash(x, zs + 9) * 6.3]);
  for (let x = 8; x < 46; x += 7) for (const zs of [1, -1]) decor.push(['N07', x + hash(x, zs + 5) * 3, zs * (37.6 + hash(zs + 5, x) * 1.2), 1.1 + hash(x, zs) * 0.7, hash(x, zs + 9) * 6.3]);
  // fallen logs on the slopes; reeds along the river banks (ankle-to-knee high, no collider; never at the bridge or the fords)
  for (let i = 0; i < 14; i++) { const x = (hash(i, 61) - 0.5) * 190, zs = i % 2 ? 1 : -1; if (Math.abs(x) < 10) continue; decor.push(['N14', x, zs * (39.5 + hash(i, 62) * 3), 3.5 + hash(i, 63) * 1.5, hash(i, 64) * 6.3, 'w']); }
  for (const zs of [1, -1]) for (const xs of [1, -1]) for (const z0 of [8, 11.5, 15, 29, 32.5]) decor.push(['N13', xs * (5.6 + hash(z0, xs) * 0.9), zs * (z0 + hash(xs, z0) * 1.5), 1.0, hash(z0, zs) * 6.3]);
  const byId = new Map();
  for (const [id, x, z, size, yaw, mode] of decor) {
    const y = id === 'S01' || id === 'E01' ? CITADEL_Y - 2 : Math.max(0, yAt(x, z)) - 0.1;
    const p = mode === 'w' ? { x, y, z, yaw, w: size, d: size, h: size * 2, fit: 'contain' } : { x, y, z, yaw, w: size * 3, d: size * 3, h: size, fit: 'height' };
    if (!byId.has(id)) byId.set(id, []); byId.get(id).push(p);
  }
  for (const [id, list] of byId) loadModel(id).then(m => { if (m) group.add(instance(m, list, { chunk: CHUNK, cast: !['N13', 'N07', 'N14'].includes(id) })); });

  // swap in the Tripo models as they arrive (a list with two ids alternates between both models)
  for (const s of slots) {
    const ids = Array.isArray(s.ids) ? s.ids : [s.ids];
    if (low && /N05|N08|N01/.test(ids.join())) continue; // low quality: forest and cliffs stay the cheap shapes
    Promise.all(ids.map(loadModel)).then(models => {
      const ok = models.filter(Boolean); if (!ok.length) return;
      for (const m of [].concat(s.mesh)) { group.remove(m); m.dispose?.(); }
      ok.forEach((model, k) => { const list = s.list.filter((p, i) => i % ok.length === k).map(s.fit); group.add(instance(model, list, { chunk: CHUNK, cast: s.cast !== false })); });
    });
  }
  return group;
}
