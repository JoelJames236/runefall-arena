// Thornwater Gorge — the keeps' architecture (look only; the collision is the map's boxes and fixtures).
//
// Sunward Keep (west, side 0): pale ashlar, buttresses, corbelled parapets, lancet windows, round towers with
// steep blue slate cones, a long gabled slate roof with dormers and a tall spire over the flag room, a donjon behind.
// Emberhold (east, side 1): dark basalt, timber hoardings bristling with spikes, slit windows glowing red, square
// war towers with horned iron roofs, a low shingled hip roof with bone spikes and tusks, a war longhouse behind.
//
// Everything is built for the Gold half in map coordinates and turned 180° for Emberhold, like the map itself.
// Rules that keep it fair: below 3.6 yd nothing sticks out more than 0.42 yd from a wall (a body never gets closer
// than 0.45) unless it matches a fixture's collider exactly; above that, anything goes. The roofs cover the hall
// and the flag room, so they fade out while the camera is inside a keep.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { archTextures, paintCrest } from './tw-ground.js';

const H = 9, FLOOR = 4.5;                     // wall height, flag-room floor (js/sim/maps/thornwater.js)
const X0 = -96, X1 = -60, Z = 15;             // the keep's outer faces (Gold half)
const IX0 = -94.5, IX1 = -61.5, IZ = 13.5;    // inner faces
function worldUV(g, size) {
  g = g.index ? g.toNonIndexed() : g;
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let u, v; if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u / size; uv[i * 2 + 1] = v / size;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  return g;
}
const boxAt = (x0, x1, y0, y1, z0, z1) => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
const cyl = (rt, rb, h, seg, x, y, z) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z);
const cone = (r, h, seg, x, y, z, rot = 0) => new THREE.ConeGeometry(r, h, seg).rotateY(rot).translate(x, y + h / 2, z);
// a gable roof: ridge along x from x0 to x1 at height y1 over the centre z, eaves at ±zw, height y0
function gableRoof(x0, x1, zc, zw, y0, y1, over = 0.6) {
  const g = new THREE.BufferGeometry(), a = x0 - over, b = x1 + over, e = zw + over, ye = y0 - over * (y1 - y0) / zw;
  const v = [a, ye, zc + e, b, ye, zc + e, b, y1, zc, a, ye, zc + e, b, y1, zc, a, y1, zc, // south slope (+z side)
    b, ye, zc - e, a, ye, zc - e, a, y1, zc, b, ye, zc - e, a, y1, zc, b, y1, zc];       // north slope
  // thickness: an underside a little lower, so the eaves have an edge
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
}
// a hip roof: rectangle base, ridge shortened by `inset` at both ends
function hipRoof(x0, x1, z0, z1, y0, y1, inset) {
  const zc = (z0 + z1) / 2, r0 = x0 + inset, r1 = x1 - inset;
  const v = [
    x0, y0, z1, x1, y0, z1, r1, y1, zc, x0, y0, z1, r1, y1, zc, r0, y1, zc,   // +z slope
    x1, y0, z0, x0, y0, z0, r0, y1, zc, x1, y0, z0, r0, y1, zc, r1, y1, zc,   // −z slope
    x0, y0, z0, x0, y0, z1, r0, y1, zc,                                       // west hip
    x1, y0, z1, x1, y0, z0, r1, y1, zc,                                       // east hip
  ];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); return g;
}
// a triangular gable wall in the plane x = const, from z −w..w, y0 up to y1, thickness t (towards −x)
function gableWall(x, w, y0, y1, t) {
  const s = new THREE.Shape([new THREE.Vector2(-w, y0), new THREE.Vector2(w, y0), new THREE.Vector2(0, y1)]);
  return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false }).rotateY(Math.PI / 2).translate(x - t, 0, 0);
}
// an arched window shape (rect with a round top), width w, total height h, in the XY plane facing +z
function archShape(w, h) {
  const s = new THREE.Shape(), r = w / 2;
  s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, h - r); s.absarc(0, h - r, r, 0, Math.PI, false); s.lineTo(-r, 0);
  return s;
}
// put a geometry made facing +z onto an outer face: face = 'n' (z = +Z), 's' (z = −Z), 'f' (x = X1), 'b' (x = X0)
function onFace(g, face, u, y, out = 0) {
  if (face === 'n') return g.translate(u, y, Z + out);
  if (face === 's') return g.rotateY(Math.PI).translate(u, y, -Z - out);
  if (face === 'f') return g.rotateY(Math.PI / 2).translate(X1 + out, y, u);
  return g.rotateY(-Math.PI / 2).translate(X0 - out, y, u);
}

export class KeepArchitecture {
  constructor(tw) {
    this.tw = tw;
    const T = archTextures();
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
    this.mats = {
      stone: [std({ map: T.ashlar }), std({ map: T.basalt })],
      trim: [std({ color: 0xe8e2d4 }), std({ color: 0x3a3330 })],
      roof: [std({ map: T.slate, roughness: 0.7 }), std({ map: T.shingle })],
      wood: std({ map: T.planks, color: 0x8a6a52 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xd9a93a, metalness: 0.7, roughness: 0.35 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x2c2a28, metalness: 0.6, roughness: 0.55 }),
      bone: std({ color: 0xe6ddc8, roughness: 0.75 }),
      glow: [new THREE.MeshBasicMaterial({ color: 0xffd890 }), new THREE.MeshBasicMaterial({ color: 0xff5a1e })],
      dark: std({ color: 0x15110e }),
    };
    this.crest = [paintCrest(0), paintCrest(1)];
    this.roofs = [];
    for (const side of [0, 1]) this.buildKeep(side);
  }
  buildKeep(side) {
    const bins = new Map(), roofBins = new Map();
    const put = (mat, g, roof = false) => { const B = roof ? roofBins : bins; if (!B.has(mat)) B.set(mat, []); B.get(mat).push(g); };
    const M = this.mats, stone = M.stone[side], trim = M.trim[side], S = side === 0;
    const uv = (g, s = 3) => worldUV(g, s);

    // ---- plinth: a 0.3 deep base course round the outside (gaps at the gate and the side door)
    const plinth = (x0, x1, z0, z1) => put(stone, uv(boxAt(x0, x1, 0, 0.8, z0, z1)));
    plinth(X0 - 0.3, -66, Z, Z + 0.3); plinth(-62.5, X1 + 0.3, Z, Z + 0.3);                // north
    plinth(X0 - 0.3, X1 + 0.3, -Z - 0.3, -Z);                                              // south
    plinth(X1, X1 + 0.3, 4.3, Z); plinth(X1, X1 + 0.3, -Z, -4.3);                         // front
    plinth(X0 - 0.3, X0, -Z, Z);                                                           // back
    // ---- buttresses (0.42 deep below, stepped back above)
    const butt = (face, u) => {
      const a = boxAt(-0.6, 0.6, 0, 4.2, 0, 0.42), b = boxAt(-0.5, 0.5, 4.2, 6.6, 0, 0.26);
      const cap = new THREE.CylinderGeometry(0.01, 0.6, 0.7, 4, 1).rotateY(Math.PI / 4).scale(1.4, 1, 0.5).translate(0, 6.95, 0.12);
      for (const g of [a, b, cap]) put(stone, uv(onFace(g, face, u, 0), 2.5));
    };
    for (const u of [-90, -84, -78, -72]) butt('n', u);
    for (const u of [-78, -72, -66]) butt('s', u);
    for (const u of [10, -10]) butt('f', u);
    for (const u of [-9, -3, 3, 9]) butt('b', u);
    // ---- the top: Sunward corbels + parapet band + gold trim; Ember timber hoardings with spikes
    const runs = [['n', X0 + 1.3, X1 - 1.3], ['s', X0 + 1.3, X1 - 1.3], ['f', -Z + 1.3, Z - 1.3], ['b', -Z + 1.3, Z - 1.3]];
    for (const [face, a, b] of runs) {
      const L = b - a, mid = (a + b) / 2;
      if (S) {
        for (let u = a + 0.45; u < b - 0.3; u += 0.9) put(trim, uv(onFace(boxAt(-0.15, 0.15, 7.75, 8.3, 0, 0.45), face, u, 0), 1));
        put(stone, uv(onFace(boxAt(-L / 2, L / 2, 8.3, 8.65, 0, 0.6), face, mid, 0), 3));
        put(M.gold, onFace(boxAt(-L / 2, L / 2, 8.65, 8.75, 0, 0.62), face, mid, 0));
      } else {
        put(M.wood, uv(onFace(boxAt(-L / 2, L / 2, 7.3, 9.4, 0, 1.1), face, mid, 0), 3));
        put(M.wood, uv(onFace(boxAt(-L / 2, L / 2, -0.1, 0.1, -0.8, 0.8).rotateX(0.3).translate(0, 9.65, 0.5), face, mid, 0), 3));
        for (let u = a + 0.6; u < b; u += 1.6) put(M.wood, uv(onFace(boxAt(-0.13, 0.13, -0.65, 0.65, -0.12, 0.12).rotateX(-0.7).translate(0, 6.75, 0.45), face, u, 0), 1));
        for (let u = a + 1.2; u < b; u += 1.6) put(M.iron, onFace(new THREE.ConeGeometry(0.09, 1.1, 5).rotateX(Math.PI / 2 + 0.5).translate(0, 7.25, 1.5), face, u, 0));
      }
    }
    // ---- windows on the outer faces (between the buttresses), the openings' frames
    const win = (face, u) => {
      if (S) {
        put(trim, onFace(new THREE.ExtrudeGeometry(archShape(1.3, 2.7), { depth: 0.12, bevelEnabled: false }), face, u, 4.55, 0));
        put(M.glow[0], onFace(new THREE.ShapeGeometry(archShape(0.85, 2.3)), face, u, 4.75, 0.13));
        put(M.iron, onFace(boxAt(-0.43, 0.43, 5.7, 5.78, 0, 0.02), face, u, 0, 0.14));
      } else {
        put(M.dark, onFace(boxAt(-0.25, 0.25, 4.9, 6.5, 0, 0.06), face, u, 0, 0));
        put(M.glow[1], onFace(new THREE.PlaneGeometry(0.3, 1.4).translate(0, 5.7, 0), face, u, 0, 0.07));
        for (const dx of [-0.08, 0.08]) put(M.iron, onFace(boxAt(dx - 0.02, dx + 0.02, 4.9, 6.5, 0, 0.04), face, u, 0, 0.08));
      }
    };
    for (const u of [-87, -81, -75, -69]) win('n', u);
    for (const u of [-75, -69, -63]) win('s', u);
    for (const u of [-6, 6]) win('b', u);
    // side door and balcony frames
    for (const [x0, x1] of [[-66.3, -66], [-62.5, -62.2]]) put(trim, uv(boxAt(x0, x1, 0, 3.4, Z, Z + 0.3), 1));
    put(trim, uv(boxAt(-66.3, -62.2, 3.4, 3.9, Z, Z + 0.3), 1));
    for (const [x0, x1] of [[-90.3, -90], [-84, -83.7]]) put(trim, uv(boxAt(x0, x1, 4.5, 7.5, -Z - 0.3, -Z), 1));
    put(trim, uv(boxAt(-90.3, -83.7, 7.5, 8.0, -Z - 0.3, -Z), 1));
    for (const x of [-90.5, -83.5]) put(S ? trim : M.wood, uv(boxAt(x - 0.25, x + 0.25, 3.2, 4.1, -Z - 2.6, -Z).rotateX(0), 1)); // balcony brackets (overhead)

    // ---- the gatehouse: the front wall rises over the gate, crest in the tympanum, frame round the opening
    put(stone, uv(boxAt(-61.5, -60, H, 13, -4.3, 4.3)));
    for (let z = -4.0; z < 4.2; z += 1.6) put(stone, uv(boxAt(-61.5, -60, 13, 13.9, z, z + 0.9), 2));
    put(trim, uv(boxAt(-60, -59.7, 5.5, 6.0, -4.3, 4.3), 1));
    for (const s of [-1, 1]) put(trim, uv(boxAt(-60, -59.7, 0, 5.5, s > 0 ? 4 : -4.3, s > 0 ? 4.3 : -4), 1));
    const crest = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 6.4).rotateY(Math.PI / 2).translate(-59.95, 9.6, 0), new THREE.MeshStandardMaterial({ map: this.crest[side], transparent: true, alphaTest: 0.5, roughness: 0.8 }));
    // ---- towers on the four corners (square plinth = the collider, the tower rises from it) and the gate turrets
    const tower = (x, z, w, d, h, turret = false) => {
      put(stone, uv(boxAt(x - w / 2, x + w / 2, 0, 3.6, z - d / 2, z + d / 2), 2.5));
      if (S) {
        const r = Math.min(w, d) / 2 + (turret ? 0.25 : 0.25), top = h - 3.5;
        put(stone, uv(cyl(r, r + 0.12, top - 3.6, 16, x, 3.6, z), 3));
        put(trim, uv(cyl(r + 0.45, r, 0.6, 16, x, top, z), 2));
        put(stone, uv(cyl(r + 0.45, r + 0.45, 0.9, 16, x, top + 0.6, z), 3));
        put(M.roof[0], uv(cone(r + 0.75, turret ? 4.6 : 6.2, 16, x, top + 1.5, z), 2), false);
        put(M.gold, cyl(0.06, 0.06, 1.4, 6, x, top + 1.5 + (turret ? 4.6 : 6.2) - 0.1, z));
        put(M.gold, new THREE.SphereGeometry(0.18, 8, 6).translate(x, top + 1.5 + (turret ? 4.6 : 6.2) + 1.2, z));
        for (let k = 0; k < 3; k++) put(M.glow[0], new THREE.PlaneGeometry(0.4, 1.0).translate(0, 0, r + 0.02).rotateY(k * 2.1 + (x > -80 ? 0.6 : 2.4)).translate(x, top - 2.2, z));
      } else {
        const ww = w + 0.4, dd = d + 0.4, top = h - 4;
        put(stone, uv(boxAt(x - ww / 2, x + ww / 2, 3.6, top, z - dd / 2, z + dd / 2), 3));
        put(M.wood, uv(boxAt(x - ww / 2 - 0.5, x + ww / 2 + 0.5, top, top + 1.8, z - dd / 2 - 0.5, z + dd / 2 + 0.5), 2));
        put(M.roof[1], uv(cone(Math.max(ww, dd) * 0.95, turret ? 3.2 : 4.4, 4, x, top + 1.8, z, Math.PI / 4), 2));
        put(M.iron, cone(0.12, 1.6, 5, x, top + 1.8 + (turret ? 3.2 : 4.4) - 0.2, z));
        for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const tusk = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.9, 0.3, 0), new THREE.Vector3(1.1, 1.6, 0)), 8, 0.13, 6);
          tusk.rotateY(Math.atan2(-b, a)).translate(x + a * (ww / 2 + 0.4), top + 1.9, z + b * (dd / 2 + 0.4));
          put(M.bone, tusk);
        }
        for (let k = 0; k < 2; k++) put(M.glow[1], new THREE.PlaneGeometry(0.3, 0.9).translate(0, 0, dd / 2 + 0.02).rotateY(k * Math.PI + (x > -80 ? 0 : Math.PI / 2)).translate(x, top - 2, z));
      }
    };
    tower(-60.75, 14.25, 2.6, 2.6, 18.5); tower(-60.75, -14.25, 2.6, 2.6, 18.5);
    tower(-95.25, 14.25, 2.6, 2.6, 18.5); tower(-95.25, -14.25, 2.6, 2.6, 18.5);
    tower(-59.2, 5.6, 1.6, 2.6, 16, true); tower(-59.2, -5.6, 1.6, 2.6, 16, true);

    // ---- the roof over hall and flag room (fades while the camera is inside), and the great tower over the flag
    if (S) {
      put(M.roof[0], uv(gableRoof(IX0, IX1, 0, IZ, H + 0.2, 18.5, 0.9), 2.5), true);
      put(stone, uv(gableWall(IX1 + 0.01, IZ, H, 18.4, 1.2)), true);
      put(stone, uv(gableWall(IX0 + 1.2, IZ, H, 18.4, 1.2)), true);
      put(M.glow[0], new THREE.CircleGeometry(1.4, 20).rotateY(Math.PI / 2).translate(IX1 + 0.03, 15.6, 0), true); // rose window
      put(trim, new THREE.TorusGeometry(1.45, 0.16, 6, 20).rotateY(Math.PI / 2).translate(IX1 + 0.05, 15.6, 0), true);
      for (const x of [-92, -79, -73, -67]) for (const s of [1, -1]) { // dormers
        const yb = H + 0.2 + (IZ - 7) / IZ * (18.5 - H - 0.2);
        put(stone, uv(boxAt(x - 1, x + 1, yb - 0.6, yb + 1.6, s > 0 ? 3.5 : -7.6, s > 0 ? 7.6 : -3.5), 2), true);
        put(M.roof[0], uv(gableRoof(-2.05, 2.05, 0, 1.1, 0, 1.0, 0.2).rotateY(Math.PI / 2).translate(x, yb + 1.6, s * 5.55), 1.5), true);
        put(M.glow[0], new THREE.ShapeGeometry(archShape(0.8, 1.3)).rotateY(s > 0 ? 0 : Math.PI).translate(x, yb - 0.2, s * 7.62), true);
      }
      // the great tower and its spire over the flag room
      put(stone, uv(boxAt(-88.6, -83.4, H, 27, -2.6, 2.6), 3), true);
      put(trim, uv(boxAt(-89, -83, 27, 27.6, -3, 3), 2), true);
      for (let i = 0; i < 4; i++) { const [a, b] = [[-1, -1], [1, -1], [-1, 1], [1, 1]][i]; put(M.roof[0], uv(cone(0.6, 3.2, 8, -86 + a * 2.6, 27.6, b * 2.6), 1.5), true); put(M.gold, new THREE.SphereGeometry(0.13, 6, 5).translate(-86 + a * 2.6, 30.9, b * 2.6), true); }
      put(M.roof[0], uv(cone(2.9, 11, 8, -86, 27.6, 0, Math.PI / 8), 2), true);
      put(M.gold, cyl(0.08, 0.08, 2.2, 6, -86, 38.4, 0), true);
      put(M.gold, new THREE.SphereGeometry(0.32, 10, 8).translate(-86, 40.8, 0), true);
      for (const [dx, dz, ry] of [[2.62, 0, Math.PI / 2], [-2.62, 0, -Math.PI / 2], [0, 2.62, 0], [0, -2.62, Math.PI]]) for (const y of [16, 22]) put(M.glow[0], new THREE.ShapeGeometry(archShape(0.9, 2.2)).rotateY(ry).translate(-86 + dx, y, dz), true);
    } else {
      put(M.roof[1], uv(hipRoof(IX0 - 0.9, IX1 + 0.9, -IZ - 0.9, IZ + 0.9, H + 0.1, 14.6, 4), 2.5), true);
      for (let x = -88; x <= -68; x += 2.2) put(M.bone, cone(0.16, 1.5, 6, x, 14.4, 0), true); // ridge spikes
      for (const [a, b] of [[IX0 - 0.9, IZ + 0.9], [IX0 - 0.9, -IZ - 0.9], [IX1 + 0.9, IZ + 0.9], [IX1 + 0.9, -IZ - 0.9]]) {
        const tusk = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.8, 0.6, 0), new THREE.Vector3(2.2, 3.2, 0)), 10, 0.26, 7);
        put(M.bone, tusk.rotateY(Math.atan2(-Math.sign(b), Math.sign(a + 78))).translate(a, H + 0.2, b), true);
      }
      // the war watchtower over the flag room: log posts, a platform, a spiked roof
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(M.wood, uv(cyl(0.28, 0.32, 9, 7, -86 + a * 2.2, 12.5, b * 2.2), 1.5), true);
      put(M.wood, uv(boxAt(-89, -83, 20.5, 21.2, -3, 3), 2), true);
      put(M.wood, uv(boxAt(-89, -83, 21.2, 22.4, -3, 3), 2), true);
      put(M.roof[1], uv(cone(4.6, 4, 4, -86, 22.4, 0, Math.PI / 4), 2), true);
      put(M.iron, cone(0.16, 2.6, 5, -86, 26.2, 0), true);
      put(M.glow[1], new THREE.PlaneGeometry(4.8, 0.7).rotateY(Math.PI / 2).translate(-82.98, 21.8, 0), true);
      // chimney with an ember glow
      put(stone, uv(boxAt(-71, -69, 12, 16.5, 4, 6), 2), true);
      put(M.glow[1], new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2).translate(-70, 16.45, 5), true);
    }
    // ---- behind the keep, outside the playable area: the donjon (Sunward) / the war longhouse (Ember)
    if (S) {
      put(stone, uv(boxAt(-113, -103, 0, 24, -6, 6), 3));
      put(trim, uv(boxAt(-113.5, -102.5, 24, 24.6, -6.5, 6.5), 2));
      put(M.roof[0], uv(cone(8.2, 9, 4, -108, 24.6, 0, Math.PI / 4), 2));
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { put(stone, uv(cyl(1.3, 1.3, 28, 12, -108 + a * 5, 0, b * 6), 3)); put(M.roof[0], uv(cone(1.8, 5, 12, -108 + a * 5, 28, b * 6), 2)); }
      for (const z of [-3, 0, 3]) for (const y of [10, 16, 21]) put(M.glow[0], new THREE.ShapeGeometry(archShape(0.9, 2)).rotateY(Math.PI / 2).translate(-102.98, y, z));
      put(stone, uv(boxAt(-103, -100.6, 0, 7, -3, 3), 2)); // the bridge wall to the keep
    } else {
      put(stone, uv(boxAt(-114, -102, 0, 8, -9, 9), 3));
      put(M.roof[1], uv(gableRoof(-114, -102, 0, 9, 8, 19, 1), 2.5));
      put(stone, uv(gableWall(-102, 9, 8, 18.8, 1)), false); put(stone, uv(gableWall(-113, 9, 8, 18.8, 1)), false);
      for (const s of [-1, 1]) {
        const tusk = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 2, 2.4), new THREE.Vector3(0, 5.5, 1.6)), 10, 0.4, 8);
        put(M.bone, tusk.rotateY(s > 0 ? 0 : Math.PI).translate(-102, 8, s * 6));
      }
      put(M.wood, uv(cyl(0.35, 0.4, 16, 7, -103, 0, 11.5), 1.5)); put(M.wood, uv(cyl(0.35, 0.4, 16, 7, -103, 0, -11.5), 1.5));
      put(M.glow[1], new THREE.PlaneGeometry(6, 3).rotateY(Math.PI / 2).translate(-101.98, 3, 0));
    }
    // ---- assemble: one mesh per material (the roof group separately, so it can fade)
    const group = new THREE.Group(); group.name = 'keep' + side;
    const addBins = (B, parent, fade) => {
      const mats = [];
      for (const [mat, list] of B) {
        const m = fade ? mat.clone() : mat;
        const geo = mergeGeometries(list.map(g => { g = g.index ? g.toNonIndexed() : g; if (!g.attributes.normal) g.computeVertexNormals(); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; }));
        const mesh = new THREE.Mesh(geo, m); mesh.castShadow = !m.isMeshBasicMaterial; mesh.receiveShadow = true; parent.add(mesh); mats.push(m);
      }
      return mats;
    };
    addBins(bins, group, false);
    group.add(crest);
    const roof = new THREE.Group(); group.add(roof);
    const roofMats = addBins(roofBins, roof, true);
    for (const m of roofMats) m.side = THREE.DoubleSide;
    if (side === 1) group.rotation.y = Math.PI; // Emberhold = the Gold half turned 180°
    this.tw.group.add(group);
    this.roofs.push({ side, group: roof, mats: roofMats, o: 1 });
  }
  // fade a keep's roof while the camera is inside that keep
  update(dt) {
    const c = this.tw.camera?.position; if (!c) return;
    for (const r of this.roofs) {
      const s = r.side ? -1 : 1, x = c.x * s, z = c.z * s;
      const inside = x > X0 - 1.5 && x < X1 + 1.5 && Math.abs(z) < Z + 1.5 && c.y < 19;
      const o = r.o + ((inside ? 0 : 1) - r.o) * Math.min(1, dt * 6);
      if (Math.abs(o - r.o) < 1e-4 && (o === 0 || o === 1)) continue;
      r.o = o < 0.01 ? 0 : o > 0.99 ? 1 : o;
      r.group.visible = r.o > 0;
      for (const m of r.mats) { m.transparent = r.o < 1; m.opacity = r.o; m.depthWrite = r.o > 0.6; }
    }
  }
}
