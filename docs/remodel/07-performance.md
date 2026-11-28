# 07 — Performance budgets

The remodel must look much better **and** cost less. The big win is draw calls: today a champion costs 8–31 draws
because its code-built weapons, glow spheres and grip-turning parts can't be merged. The target is **1 draw per
champion** (+1 shadow draw).

---

## 1. Measured today (2026-11-27, in the game page, Kingsreach, quality "high", bloom on)

| What | Value |
|---|---|
| 2v2 frame (Prot Paladin, Enh Shaman, Beastmaster, Summoner) | **273 draw calls, 932 k triangles**, 341 geometries, 192 textures, 125 shader programs |
| Champion draws (main pass) | 8–31 (Enh Shaman 31, Elemental 27, Fury 25, Mages 23) |
| Champion triangles | 10.6–19.0 k, of which weapons / static parts up to 9.1 k |
| Champion joints | 73–80 |
| Champion materials | 1 (Feral) – 21 (Elemental) |
| Champion GLB | 1.51–1.93 MiB, 3 × 1024² JPEG (base, metal-rough, normal); 9.2–10.2 k triangles |
| Creature GLBs | cat 1.42 MB / 9.4 k, bear 1.85 MB / 10.0 k, gorilla 1.81 MB / 10.1 k |
| Particles | GL points, pools 5,000 additive + 1,200 smoke |

Champions are ~70 of the 273 draws in the main pass and about as many again in the shadow pass.

Measuring snippet (game page, a match running):

```js
const w = __rf.world, R = w.renderer;
R.info.autoReset = false; R.info.reset(); w.render(1/30);
console.log(R.info.render.calls, R.info.render.triangles); R.info.autoReset = true;
```

---

## 2. Targets

| Item | Budget | Today |
|---|---|---|
| Champion, LOD0 | ≤ **13,400 tris** (body 11,000 + ≤ 2 items ≤ 2,400) | 10.6–19.0 k |
| Champion draws | **1** main + **1** shadow (LOD2 proxy) | 8–31 + same in shadow |
| Champion materials | 1 (one shader program shared by all champions) | 1–21 |
| Champion joints | ≤ 84 (rig ≈ 80 + `grip_r`, `grip_l`, `shield_l` + bow bones where used) | 73–80 |
| Champion textures | one 2048×1024 atlas × 3 maps (base, ORM+emissive, normal), **KTX2** | 3 × 1024² JPEG |
| Champion GPU memory | ≤ 8 MB with mips | ~12 MB (uncompressed RGBA) |
| Champion file | ≤ 2.5 MB (meshopt + KTX2, LOD0–2 included) | 1.5–1.9 MB (no LODs, no items) |
| Pet / form | ≤ 10,000 tris, 1 draw (+1 shadow) | 9.4–10.1 k, 1 draw |
| Summoned humanoids (ghoul, abomination) | as pets | code-built, ~10 draws |
| VFX | ≤ 14 draws, ≤ 8,000 particles, ≤ 0.6 ms CPU | ~5,000 + 1,200 points, many meshes made per effect |
| Animation CPU | ≤ 0.3 ms per champion (mixer + layers) | similar |
| **2v2 frame** | **≈ 150 draws** (from 273), ≈ 0.90 M triangles (the arena is ~0.87 M) | 273 / 0.93 M |

---

## 3. How: assemble each champion offline into one skinned mesh

`tools/assemble-champion.mjs` (to write) builds the shipped GLB from the parts — the runtime does no merging, no
grip solving, no weapon building:

1. **Inputs**: the rigged body GLB (Tripo export, `src/`), the item GLBs in grip space (`items/`), the socket entry
   from `sockets.json`, the champion's item list.
2. **Sockets as joints**: add `grip_r`, `grip_l`, `shield_l` (and the bow's 4 bones) to the skeleton as real
   joints with the fitted local transforms.
3. **Merge items into the skin**: every item vertex gets weight 1.0 on its socket joint (bows: on their own
   bones). Items keep their own UVs, remapped into their atlas tile.
4. **Atlas**: body texture in the left 1024², items packed into the right 1024² (tiles from `03` §7). Base colour,
   ORM (+emissive mask in alpha) and normal maps all share the layout.
5. **LODs**: meshoptimizer simplification with locked UV seams and skin borders: LOD1 50 %, LOD2 20 %.
6. **Compression**: textures to KTX2 (base colour + ORM: ETC1S; normal: UASTC), geometry with
   `EXT_meshopt_compression`. Runtime: `KTX2Loader` + `MeshoptDecoder` from three r0.170.0 (exact version, the
   transcoder files from the same CDN path as three today).
7. **Output**: `assets/models/champions/<class>_<spec>.glb` + its line in `sockets.json` (the non-item sockets:
   `spell_*`, `head_top`, `chest` … stay empty nodes, no joints).

The weapon then **cannot** turn in the hand — that's the point (`03` §8). Thrown weapons (Hurled Axe, Sentinel's
Shield) hide their merged copy by scaling the socket joint to 0 between `item_hide_*` and `item_show_*`, and fly
as a separate item mesh from the projectile pool.

Fallback if the atlas step is late: items as a second mesh with their own material skinned to the same skeleton →
**2 draws** per champion (still far below today).

---

## 4. One material for everything (champions, pets, forms)

`MeshStandardMaterial` with a small shader patch (`onBeforeCompile`, one program for all champions):

| Input | Use |
|---|---|
| `map` | base colour (painted) |
| ORM texture | R = ambient occlusion, G = roughness, B = metalness (three's standard packing), **A = emissive mask** |
| `normalMap` | low-frequency normals |
| emissive | `baseColor × mask × uGlow` — glow takes the painted colour; `uGlow` pulses (casting swells it like today's weapon halos) |
| rim light | existing `addRim` |
| hit flash | `uFlash` uniform (today: material clone per champion to flash — keep the clone, it shares the program) |
| stealth | opacity + fresnel edge (`06` §6), same program with `transparent` toggled |
| dissolve | `uDissolve` + noise from the VFX atlas (pet deaths, form swaps, despawns) |

---

## 5. LOD and shadows

**Implemented (Phase 1)**: `assemble-champion --lods 0.5,0.17` + `glb-compress`; `champions.js` marks the LODs, the
proxy sits on `SHADOW_LAYER` (5, enabled on the sun's shadow camera), LOD0 no longer casts; `Character.setLodDistance`
switches in 5v5 only (more than 4 fighters). The Protection Paladin: 13,141 / 6,570 / 2,233 triangles, 2.14 MB compressed.

| Mode | LOD0 | LOD1 | LOD2 |
|---|---|---|---|
| 1v1 / 2v2 (camera ≤ 25 m) | always | — | shadow proxy only |
| 5v5 battleground | < 22 m | 22–45 m | > 45 m |

Hysteresis 10 %. **Shadow proxy**: the LOD2 mesh, bound to the same skeleton, on a layer only the sun's shadow
camera renders (`castShadow` on), while LOD0/1 have `castShadow` off — the shadow pass skins 2,200 triangles
instead of 13,400 per champion.

---

## 6. Loading

- Per match, load only what's in it: 2–4 champions (+ pets/forms), their animation sets (`cm` + ≤ 4 sets), the VFX
  atlas, the totems/trap if a shaman/hunter is in it. Your own champion first (as today).
- Expected download for a 2v2: 4 × 2.5 + 2 × 1.5 + 5 × 0.3 (compressed anim sets) + 1 (VFX atlas) ≈ **15.5 MB**
  (cached after the first match).
- Retarget each clip once per model and cache it (today per body in `champ.clips`).
- Pools (particles, mesh FX instances, projectile meshes, decals) are made once at load; nothing is created or
  disposed during a match — fixes today's zone and sprite-texture leaks.

---

## 7. Animation cost

- One `AnimationMixer` per champion (as today); ≤ 6 active actions (lower loco blend 2–3, upper stance, action,
  additive).
- Finger layer (30 bone rotations), two-bone IK (3 bones), look-at (3 bones), race posture: ≤ 0.05 ms per champion.
- Quadruped procedural fallback (if Plan B): as today.

---

## 8. Acceptance (performance)

| Check | Pass |
|---|---|
| `new Character()` for each of the 20 specs | 1 draw, ≤ 13,400 tris, 1 material |
| 2v2, Kingsreach, high, bloom | ≤ 160 draw calls, no frame > 20 ms on the reference laptop over a 3-minute bot match |
| 5v5 Thornwater | ≤ 260 draw calls, LODs switching without pops |
| Memory | no growth in `renderer.info.memory` over 10 rounds |
| Load | 2v2 assets ready ≤ 3 s after the menu on a 50 Mbit line |
