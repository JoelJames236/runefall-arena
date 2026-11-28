// Weapon trails (docs/remodel/06 §2 / §4 trail_<school>): a ribbon from the weapon's trail_base to its tip,
// 10 samples spanning the last 0.12 s, drawn only while a basic attack or a melee ability is swinging.
//
// Markers: assembled champions (tools/assemble-champion.mjs) carry named empties on their items —
// c.weapons[w].userData.markers.trail_base / .tip, with c.tipR / c.tipL = the tips. Code-built weapons only have
// userData.tip; their trail base is placed part-way from the grip to the tip (blade vs. head weapons).
// Colour: the ability's school for assembled champions, a neutral silver-white for code-built weapons.
//
// The champion's world transform is read right before the frame is drawn (getWorldPosition walks the parent chain),
// the strip is interpolated through the recent frame samples (Catmull-Rom), so 30 fps still gives a smooth arc.
// Alpha follows the tip's speed: a slow wind-up leaves nothing, the cut itself leaves the streak.
import * as THREE from 'three';
import { SCHOOLS, NEUTRAL_TRAIL, TRAIL_SCHOOL } from './palette.js';
import { PROFILE } from './ribbons.js';

const SAMPLES = 10, LIFE = 0.12, HIST = 16, HS = 8; // history sample: base xyz, tip xyz, time, armed
const V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();
const TMP = new Float32Array(6);
const BLADE = /sword|fang|dagger|blade|cleaver|knife|katana/i, HEAD = /axe|hammer|mace|maul|club/i;

class Hand {
  constructor() { this.tip = null; this.base = null; this.grip = null; this.frac = 0.3; this.slot = -1; this.hist = new Float32Array(HIST * HS); this.n = 0; this.head = 0; this.lastT = -1; this.shown = false; }
}

export class WeaponTrails {
  constructor(ribbons) {
    this.R = ribbons;
    this.st = [];              // per fighter index
    this.codeBuilt = false;    // code-built weapons: off — their tip markers sit far from the blade on some kits (giant
                               // sheets on the axes); they get trails when they are assembled (Phase 2/3)
    this.peak = { assembled: 0.6, neutral: 0.4 };
    this.time = 0;
  }

  state(id) {
    let s = this.st[id];
    if (!s) s = this.st[id] = { ch: null, hands: [new Hand(), new Hand()], nh: 0, assembled: false, visible: false, armUntil: -1, armFrom: -1, core: new THREE.Color(), glow: new THREE.Color(), peak: 0.5 };
    return s;
  }

  // every frame from the world: which character fighter `id` is, whether it is drawn, whether a whirl holds the trail on
  track(id, ch, visible, hold) {
    const s = this.state(id);
    if (s.ch !== ch) this.bind(s, ch);
    s.visible = visible && !!ch && ch.body?.visible !== false;
    if (hold && s.nh) this.arm(id, 0.15); // keeps the current colour
  }

  bind(s, ch) {
    for (const h of s.hands) { if (h.slot >= 0) this.R.free(h.slot); h.slot = -1; h.tip = h.base = h.grip = null; h.n = 0; h.shown = false; }
    s.ch = ch; s.nh = 0; s.assembled = false; s.armUntil = -1;
    if (!ch) return;
    const W = ch.weapons || {};
    for (const tip of [ch.tipR, ch.tipL]) {
      if (!tip || s.nh >= 2) continue;
      let wp = null, key = '';
      for (const k in W) { const w = W[k]; if (w && w.userData && w.userData.tip === tip) { wp = w; key = k; break; } }
      if (!wp) continue;
      const U = wp.userData, h = s.hands[s.nh];
      h.tip = tip;
      if (U.assembled) { h.base = (U.markers && U.markers.trail_base) || null; h.grip = h.base ? null : wp; h.frac = 0.25; s.assembled = true; }
      else { if (!this.codeBuilt) continue; h.base = null; h.grip = wp; h.frac = BLADE.test(key) ? 0.18 : HEAD.test(key) ? 0.6 : 0.4; }
      s.nh++;
    }
    s.defSchool = TRAIL_SCHOOL[ch.lookKey] || TRAIL_SCHOOL[ch.cls] || 'physical';
    const P = s.assembled ? (SCHOOLS[s.defSchool] || SCHOOLS.physical) : NEUTRAL_TRAIL;
    s.core.setHex(P.core); s.glow.setHex(P.glow); s.peak = s.assembled ? this.peak.assembled : this.peak.neutral;
  }

  // a swing starts: show the trail for `dur` s, tinted by `schoolId` (assembled champions; code-built → neutral)
  arm(id, dur, schoolId) {
    const s = this.state(id); if (!s.nh) return;
    const T = this.time;
    if (T > s.armUntil + LIFE) { for (let k = 0; k < s.nh; k++) s.hands[k].n = 0; s.armFrom = T; } // was off: start clean
    s.armUntil = Math.max(s.armUntil, T + dur);
    if (schoolId !== undefined) { // null: the champion's own trail school
      const P = s.assembled ? (SCHOOLS[schoolId || s.defSchool] || SCHOOLS.physical) : NEUTRAL_TRAIL;
      s.core.setHex(P.core); s.glow.setHex(P.glow); s.peak = s.assembled ? this.peak.assembled : this.peak.neutral;
    }
    for (let k = 0; k < s.nh; k++) {
      const h = s.hands[k];
      if (h.slot < 0) h.slot = this.R.alloc(true);
      if (h.slot >= 0 && !h.shown) { this.R.header(h.slot, T, 1e6, PROFILE.trail, 0, 0, 1, 0); h.shown = true; }
    }
  }

  sample(h, T, armed) {
    h.tip.getWorldPosition(V2);
    if (h.base) h.base.getWorldPosition(V1);
    else { h.grip.getWorldPosition(V3); V1.copy(V3).lerp(V2, h.frac); }
    if (h.n > 0 && T - h.lastT < 0.006) h.head = (h.head - 1 + HIST) % HIST; // same instant: overwrite the newest
    else h.n = Math.min(HIST, h.n + 1);
    const o = h.head * HS, H = h.hist;
    H[o] = V1.x; H[o + 1] = V1.y; H[o + 2] = V1.z; H[o + 3] = V2.x; H[o + 4] = V2.y; H[o + 5] = V2.z; H[o + 6] = T; H[o + 7] = armed;
    h.head = (h.head + 1) % HIST; h.lastT = T;
  }

  // j-th newest history sample's offset
  at(h, j) { j = Math.max(0, Math.min(h.n - 1, j)); return ((h.head - 1 - j + HIST * 2) % HIST) * HS; }

  update(time) {
    this.time = time;
    const R = this.R;
    for (let id = 0; id < this.st.length; id++) {
      const s = this.st[id]; if (!s || !s.nh) continue;
      const live = s.visible && time <= s.armUntil + LIFE;
      for (let k = 0; k < s.nh; k++) {
        const h = s.hands[k];
        if (!live || h.slot < 0) { if (h.shown) { R.kill(h.slot); h.shown = false; } continue; }
        this.sample(h, time, time <= s.armUntil ? 1 : 0);
        const H = h.hist;
        for (let q = 0; q < SAMPLES; q++) {
          const age = q / (SAMPLES - 1) * LIFE, T = time - age;
          // bracket T between the j-th and (j+1)-th newest samples
          let j = 0; while (j < h.n - 1 && H[this.at(h, j + 1) + 6] > T) j++;
          const oa = this.at(h, j), ob = this.at(h, j + 1);
          const ta = H[oa + 6], tb = H[ob + 6];
          let f = ta > tb ? (ta - T) / (ta - tb) : 0;
          const beyond = T < tb - 1e-4 || h.n < 2;
          f = Math.max(0, Math.min(1, f));
          const o0 = this.at(h, j - 1), o3 = this.at(h, j + 2), f2 = f * f, f3 = f2 * f;
          for (let c = 0; c < 6; c++) {
            const p0 = H[o0 + c], p1 = H[oa + c], p2 = H[ob + c], p3 = H[o3 + c];
            TMP[c] = 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
          }
          const dt = Math.max(1e-3, ta - tb);
          const sp = Math.hypot(H[oa + 3] - H[ob + 3], H[oa + 4] - H[ob + 4], H[oa + 5] - H[ob + 5]) / dt;
          const on = H[oa + 7] + (H[ob + 7] - H[oa + 7]) * f;
          const spk = Math.min(1, Math.max(0, (sp - 1.5) / 4.5));
          const u = age / LIFE, fadeK = Math.pow(1 - u, 1.4);
          const a = beyond ? 0 : s.peak * fadeK * on * spk * spk * (3 - 2 * spk);
          const cr = s.core.r + (s.glow.r - s.core.r) * u, cg = s.core.g + (s.glow.g - s.core.g) * u, cb = s.core.b + (s.glow.b - s.core.b) * u;
          R.edge(h.slot, q, TMP[0], TMP[1], TMP[2], TMP[3], TMP[4], TMP[5], u, cr, cg, cb, a);
        }
        R.pad(h.slot, SAMPLES);
        R.touch(h.slot);
      }
    }
  }

  clear() {
    for (const s of this.st) if (s) { for (const h of s.hands) { if (h.slot >= 0) this.R.free(h.slot); h.slot = -1; h.n = 0; h.shown = false; } s.ch = null; s.nh = 0; s.armUntil = -1; }
  }
}
