// Fit the item / effect sockets of a rigged champion from its mesh (docs/remodel/03-weapons-and-sockets.md §3).
// The auto-rig's bone rolls and finger lengths are random per model, so the grip is measured from the hand's skinned
// vertices: principal axes give the knuckle direction (L), the thumb side (W) and the palm normal (N).
//
//   node tools/fit-sockets.mjs <champion.glb> <key> [--scale 1.06] [--out assets/models/champions/sockets.json]
//
// Writes, per socket: the parent bone, the socket frame in the mesh's bind space (`mesh`, used by
// tools/assemble-champion.mjs) and relative to the bone's bind pose (`local`, used by the game), plus the hand sizes.
import fs from 'node:fs';
import { readGlb, readAccessor, worldMatrices, inv, mul, xform, xdir, sub, add, scl, dot, cross, norm, pca, basis, decompose } from './glb-lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [file, key] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!file || !key) { console.error('usage: node tools/fit-sockets.mjs <glb> <key> [--scale s] [--out file]'); process.exit(2); }
const LOOK_SCALE = Number(opt('--scale', 1)), OUT = opt('--out', 'assets/models/champions/sockets.json');
const REF_H = 1.865; // the game fits every champion to this height before the look's scale (heroes.js buildGenerated)

const G = readGlb(file), J = G.json;
const meshNode = J.nodes.findIndex(n => n.mesh !== undefined && n.skin !== undefined);
const prim = J.meshes[J.nodes[meshNode].mesh].primitives[0], skin = J.skins[J.nodes[meshNode].skin];
const P = readAccessor(G, prim.attributes.POSITION), JN = readAccessor(G, prim.attributes.JOINTS_0), WT = readAccessor(G, prim.attributes.WEIGHTS_0);
const IBM = readAccessor(G, skin.inverseBindMatrices);
const { W } = worldMatrices(J), Wm = W[meshNode], WmInv = inv(Wm);
const jn = skin.joints.map(i => J.nodes[i].name.toLowerCase());
const jIndex = name => jn.indexOf(name);
const bind = j => inv(Array.from(IBM.slice(j * 16, j * 16 + 16)));            // joint bind matrix in mesh space
const jpos = name => { const j = jIndex(name); return j < 0 ? null : xform(bind(j), [0, 0, 0]); };
const nv = P.length / 3, V = k => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]];
const weightOn = (k, set) => { let w = 0; for (let c = 0; c < 4; c++) if (set.has(JN[k * 4 + c])) w += WT[k * 4 + c]; return w; };
const cloud = re => { const set = new Set(jn.map((n, j) => re.test(n) ? j : -1).filter(j => j >= 0)), pts = []; for (let k = 0; k < nv; k++) if (weightOn(k, set) >= 0.5) pts.push(V(k)); return pts; };

// scale: mesh units -> metres in the game
let ymin = Infinity, ymax = -Infinity; for (let k = 0; k < nv; k++) { const y = xform(Wm, V(k))[1]; ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
const heightScene = ymax - ymin, meshToScene = Math.hypot(Wm[0], Wm[1], Wm[2]);
const M = REF_H * LOOK_SCALE / heightScene * meshToScene;                    // metres per mesh unit
const up = norm(xdir(WmInv, [0, 1, 0])), fwd = norm(xdir(WmInv, [0, 0, 1]));  // world up / forward in mesh space

const sockets = {}, hands = {};
const put = (name, bone, frame) => {
  const j = jIndex(bone); if (j < 0) { console.warn('no bone', bone, 'for', name); return; }
  const local = mul(inv(bind(j)), frame), d = decompose(local), r = v => v.map(x => +x.toFixed(6));
  sockets[name] = { bone: J.nodes[skin.joints[j]].name, mesh: frame.map(x => +x.toFixed(6)), local: { p: r(d.t), q: r(d.q), s: r(d.s) } };
};

for (const s of ['r', 'l']) {
  const re = new RegExp(`^(hand|(thumb|index|middle|ring|pinky)_(0[1-3]|metacarpal))_${s}$`);
  const pts = cloud(re), wrist = jpos('hand_' + s);
  if (pts.length < 20 || !wrist) { console.warn('hand', s, 'not found'); continue; }
  const { centroid, axes } = pca(pts);
  let L = axes[0]; const tipRef = jpos('middle_03_' + s) || jpos('middle_01_' + s) || centroid; if (dot(L, sub(tipRef, wrist)) < 0) L = scl(L, -1);
  let Wd = norm(sub(axes[1], scl(L, dot(axes[1], L)))); const th = jpos('thumb_01_' + s) || jpos('thumb_02_' + s); if (th && dot(Wd, sub(th, wrist)) < 0) Wd = scl(Wd, -1);
  const N = scl(norm(cross(L, Wd)), s === 'r' ? -1 : 1);                       // palm normal (anatomy: chirality per side)
  // robust sizes: only the hand in front of the wrist (gauntlet cuffs and flares behind it are ignored), percentiles
  const noThumb = cloud(new RegExp(`^(hand|(index|middle|ring|pinky)_(0[1-3]|metacarpal))_${s}$`));
  const rel = (noThumb.length > 20 ? noThumb : pts).map(p => { const d = sub(p, wrist); return [dot(d, L), dot(d, Wd), dot(d, N)]; }).filter(v => v[0] > 0);
  const pct = (arr, q) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))]; };
  const hl = pct(rel.map(v => v[0]), 0.97);
  const palmRel = rel.filter(v => v[0] > 0.15 * hl && v[0] < 0.55 * hl);
  const wmin = pct(palmRel.map(v => v[1]), 0.05), wmax = pct(palmRel.map(v => v[1]), 0.95);
  const nmin = pct(palmRel.map(v => v[2]), 0.05), nmax = pct(palmRel.map(v => v[2]), 0.95);
  const ht = nmax - nmin, hw = wmax - wmin;
  const i1 = jpos('index_01_' + s), p1 = jpos('pinky_01_' + s) || jpos('ring_01_' + s);
  const lat = i1 && p1 ? (dot(sub(i1, wrist), Wd) + dot(sub(p1, wrist), Wd)) / 2 : (wmin + wmax) / 2;
  const nMid = (nmin + nmax) / 2, r = 0.017 / M;                              // 34 mm handle
  const origin = add(wrist, add(add(scl(L, 0.42 * hl), scl(Wd, lat)), scl(N, nMid + 0.5 * ht + r)));
  const X = L, Y = Wd, Z = norm(cross(X, Y));
  put('grip_' + s, 'hand_' + s, basis(X, Y, Z, origin));
  // spell hand: palm centre, 8 cm out of the palm; +Y = palm normal, +X = knuckles
  const palm = add(wrist, add(add(scl(L, 0.35 * hl), scl(Wd, lat)), scl(N, nMid + 0.5 * ht + 0.08 / M)));
  put('spell_' + s, 'hand_' + s, basis(X, N, norm(cross(X, N)), palm));
  hands[s] = { length: +(hl * M).toFixed(3), width: +(hw * M).toFixed(3), thickness: +(ht * M).toFixed(3), sane: hl * M > 0.15 && hl * M < 0.28 && hw * M > 0.07 && hw * M < 0.17 };
  if (s === 'l') {
    // shield: on the forearm at the left fist. The handle runs through the fist, so the shield's top (+Y) follows the
    // thumb side: with the forearm held level across the chest (the guard pose) the shield stands upright.
    // +Z = out of the back of the hand (the shield's face), +X = Y × Z (along the forearm). Its back plane
    // (z = +0.035 m in shield space) must clear the gauntlet by 10 mm: push the socket out if the surface reaches further.
    const Ys = Y, Zs = scl(Z, -1), Xs = norm(cross(Ys, Zs));
    // the surface under the shield: hand and forearm vertices within 0.3 m of the grip, 97th percentile
    const arm = cloud(/^(lowerarm(_twist_0[12])?|hand)_l$/).filter(p => Math.hypot(...sub(p, origin)) * M < 0.3);
    const t = pct(arm.map(p => dot(sub(p, origin), Zs)), 0.97);
    const push = Math.max(0, t + 0.01 / M - 0.035 / M);
    put('shield_l', 'lowerarm_l', basis(Xs, Ys, Zs, add(origin, scl(Zs, push))));
    hands.l.shieldPush = +(push * M).toFixed(3);
  }
}

// head top, chest, back (on the head and the upper spine)
const head = cloud(/^head$/), chestPts = cloud(/^spine_0[45]$/);
if (head.length) {
  let top = -Infinity, c = [0, 0, 0]; for (const p of head) { top = Math.max(top, dot(p, up)); c = add(c, p); } c = scl(c, 1 / head.length);
  const o = add(sub(c, scl(up, dot(c, up))), scl(up, top + 0.04 / M));
  put('head_top', 'head', basis(norm(cross(up, fwd)), up, fwd, o));
  const eyes = add(c, scl(fwd, 0)); let front = -Infinity; for (const p of head) front = Math.max(front, dot(p, fwd));
  put('eyes', 'head', basis(norm(cross(up, fwd)), up, fwd, add(sub(eyes, scl(fwd, dot(eyes, fwd))), scl(fwd, front))));
}
if (chestPts.length) {
  let f = -Infinity, b = Infinity, c = [0, 0, 0]; for (const p of chestPts) { f = Math.max(f, dot(p, fwd)); b = Math.min(b, dot(p, fwd)); c = add(c, p); } c = scl(c, 1 / chestPts.length);
  const flat = sub(c, scl(fwd, dot(c, fwd)));
  put('chest', 'spine_05', basis(norm(cross(up, fwd)), up, fwd, add(flat, scl(fwd, f))));
  put('back', 'spine_05', basis(norm(cross(up, scl(fwd, -1))), up, scl(fwd, -1), add(flat, scl(fwd, b))));
}

const all = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
all[key] = { file: file.split(/[\\/]/).pop(), metresPerUnit: +M.toFixed(6), lookScale: LOOK_SCALE, bodyHeightScene: +heightScene.toFixed(6), hands, sockets };
fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
console.log(key, 'sockets', Object.keys(sockets).join(','), '| hands', JSON.stringify(hands), '| m/unit', M.toFixed(4));
