# 08 — Production pipeline, order, cost and QA

How the assets get made, in which order, what it costs in Tripo credits, and how each piece is accepted.

---

## 1. Files and folders

| Path | Content | In git |
|---|---|---|
| `assets/models/champions/<class>_<spec>.glb` | assembled champion (body + items + LODs, KTX2, meshopt) | yes |
| `assets/models/champions/src/` | raw Tripo exports (4K), rig exports | no (ignored today) |
| `assets/models/champions/sockets.json` | fitted sockets of every humanoid model + hand measurements | yes |
| `assets/models/items/<id>.glb` + `items/src/` | items in grip space (used by the assembler and as thrown projectiles) | yes / no |
| `assets/models/creatures/<id>.glb` + `src/` | gorilla, ghoul, abomination, wolf, cat, bear, tree | yes / no |
| `assets/models/props/` | totems, trap, projectile meshes (icicle, rock, bone spear, magma rock, vial, spirit skull, bone shard) | yes |
| `assets/models/anims/<set>.json`, `manifest.json`, `<set>.map.json`, `src/` | clip sets, the manifest (`05` §7), prompt→id maps, raw exports | yes / yes / yes / no |
| `assets/vfx/atlas.ktx2` | VFX atlas (`06` §2.1) | yes |
| previews `…/previews/<id>.jpg` | turntable shot of each asset (as the colosseum set) | yes |

Ids: lowercase, `_`-separated; champions `<class>_<spec>`; items as in `03` §7; clips as in `05` / `04`.

---

## 2. Tools (to write in the implementation phase)

| Tool | Does | Exists? |
|---|---|---|
| `tools/glb-info.mjs` | prints skins, joints, triangles, size; add: list **non-joint** bone nodes, finger completeness, hand→middle_01 lengths | yes, extend |
| `tools/anim-extract.mjs` | Tripo export → clip-set JSON; add: one file per set, marker pass-through | yes, extend |
| `tools/collect-export.ps1` | moves Tripo downloads into place; add sets `items`, `creatures`, `anims-<set>` | yes, extend |
| `tools/item-prep.mjs` | applies the grip-space transform (origin, axes, scale from a small JSON per item) and adds the named empties (`tip`, `trail_base`, `fx_core`, `grip2` …) | new |
| `tools/assemble-champion.mjs` | body + items + sockets → one skinned GLB, atlas, LODs, KTX2, meshopt (`07` §3) | new |
| `tools/quad-rig-normalize.mjs` | renames a Tripo four-legged rig to the standard names, rejects incomplete rigs (`04` §2.1) | new (logic exists in `creatures.js readRig`) |
| `viewer.html` | add: socket editor (tripods, test cylinders, sliders, copy JSON), item rack in grip space, motion strip renderer (8 frames, tip path), LOD toggle, per-model draw / triangle readout, old vs new side by side (exists) | extend |

---

## 3. Order of work (each phase has a gate)

| Phase | Work | Gate (must pass before the next phase) |
|---|---|---|
| **0 · Pilot** | **Paladin Protection** end to end (the hardest grip case: sword + shield + wrist lock): body, `holysword`, `towershield`, sockets, assembler, `sns_idle` + `sns_atk_1..3` + `cm_run` + `cm_hit_front` | 1 draw, ≤ 13.4 k tris, the sword sits in the fist in every frame of the strip, the shield's back clears the forearm, the attack strikes on `hitAt` |
| 1 · Systems | code: sockets, finger layer, IK, manifest-driven playback, form state machine, the effect system's pools and atlas renderer | the pilot runs through the new code path; the old path still works as a fallback |
| 2 · Items | the other 22 items + arrow; `item-prep` JSON per item | each item passes `03` §8 on a test body |
| 3 · Champions | 19 bodies in batches by stance set (`th`, `dw`, `dg`, `mc`, `wd`, `st`, `bw`, then the second `sns`) | per model `02` §4 |
| 4 · Animations | animation master, then sets in this order: `cm` → `sns` → `th` → `dw` → `dg` → `mc` → `wd` → `st` → `bw` | per clip `05` §9; per set a bot match |
| 5 · Creatures | gorilla, ghoul, abomination (humanoid rigs); quadruped pilot (2 cat clips) → wolf, cat, bear; tree; totems, trap, projectile meshes | `04` per creature |
| 6 · Effects | atlas, then per class in the order of `06` §5 | per class: every ability fired in the viewer harness, screenshots, budgets |
| 7 · Sim follow-ups | R1 (instant melee abilities land at `hitAt`), optionally R2–R4 | balance matrix + 2v2 auto-tune re-run, `docs/BALANCE.md` updated |
| 8 · Final | 5v5 check with LODs, perf acceptance (`07` §8), docs (`TRIPO_CHARACTERS.md`, `ATTACK_ANIMATIONS.md`) updated, old code paths removed | — |

Long Tripo runs go end to end without stopping for confirmation (saved files land in `src/` automatically), as
agreed for asset runs.

---

## 4. Tripo cost estimate

Unit prices seen on 2026-11-27 (may change after the sale): HD model **45**, retopology **35**, auto-rig **20**,
AI animation **20** credits. Balance ≈ **15,800**.

| Batch | Count | Credits |
|---|---|---|
| Champions (model + retopo + rig) | 20 × 100 | 2,000 |
| Champion re-rigs (≈ 30 %) | 6 × 20 | 120 |
| Items (model + retopo; bows rigged locally) | 24 × 80 | 1,920 |
| Creatures (model + retopo + rig) + re-rigs | 7 × 100 + 3 × 20 | 760 |
| Props: 3 totems, trap, 7 projectile meshes | 11 × 80 | 880 |
| Animation master | 1 × 100 | 100 |
| Humanoid champion clips | 192 × 20 | 3,840 |
| Humanoid creature clips (gorilla 13, ghoul 9, abomination 8, tree 11) | 41 × 20 | 820 |
| Four-legged clips (wolf 9, cat 20, bear 18; Plan A) | 47 × 20 | 940 |
| Re-roll reserve for clips (20 %) | | 1,120 |
| **Total** | | **≈ 12,500** |

Leaves ≈ 3,300 credits of margin. If Plan B (procedural four-legged motion) is used: −940.

---

## 5. QA checklists

### 5.1 Champion model
- [ ] T-pose, empty hands, separate fingers; nothing below the knees joins the legs
- [ ] 11,000 ± 500 triangles; 1 material; texture ≤ 1024² body area
- [ ] all 15 finger joints per hand are skin joints; `hand → middle_01` in range; no non-joint bone nodes
- [ ] sockets fitted and saved; head-joint height matches the race
- [ ] every clip of its set: no hand through a pauldron / helm / hood, no shoulder collapse
- [ ] reads from above at 25 m (screenshot from the arena camera); colours per `02`
- [ ] lit check in Kingsreach (sun and shadow side), Thornwater and the class screen

### 5.2 Item
- [ ] grip space: origin, +Y, +X edge, named empties (`03` §4)
- [ ] size and triangle budget (`03` §7); handle Ø 34 / 38 / 45 mm
- [ ] test cylinder and finger pose fit; 2H `grip2` reachable; shield clearance 10 mm

### 5.3 Clip
- [ ] trimmed length and markers per the tables; in place; start/end pose = stance idle
- [ ] motion strip passes (`05` §9); edge leads / tip points at the target
- [ ] plays on the lightest and the heaviest body; plays over running legs (upper clips)
- [ ] timing: the strike lands on `hitAt` (melee) / the release on 0.14 s (ranged) with ≤ 2.0× wind-up compression

### 5.4 Creature
- [ ] rig meets the standard (`04` §2.1) or the humanoid check; legs ≥ 3 bones; tail weighted
- [ ] every state in its clip table; speed-matched locomotion (no foot sliding > 5 cm per step)
- [ ] spawn, death (+ dissolve), hit, stun visible; sockets saved

### 5.5 Effect
- [ ] school colours (`06` §3); hostile ground edge red-orange
- [ ] no allocation during a match (heap snapshot before / after 3 rounds)
- [ ] particle and draw budgets (`06` §2) in a 4-caster stress test

---

## 6. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Tripo auto-rig keeps losing finger joints | grips and finger poses break | T-pose prompt rules (`02` §1.1); re-rig (20); if a hand still fails, fit the grip socket from the mesh anyway (PCA, `03` §3.2) and skip the missing finger's curl |
| AI motions don't follow the weapon description | wrong swings | precise prompts with a start pose, a path and an end pose; 20 % re-roll budget; master body with medium pauldrons |
| Four-legged AI animation poor or unavailable | no creature clips | Plan B procedural driver (`04` §2.2) — already working today |
| Atlas assembly slips | more draws | fallback: 2 draws per champion (`07` §3) |
| KTX2 transcoder fails to load | no textures | fallback JPEG textures in the same GLB slot (larger download) |
| R1 shifts combat feel / balance | win rates move | re-run the balance matrix and auto-tune (`docs/BALANCE.md`) |
| Heroic sizes collide with the fixed hitboxes | weapons look like they miss | strike markers are measured on the real items; hit effects drawn at the contact point (tip) |
| Unit prices rise after the sale | budget | margin ≈ 3,300 credits; Plan B saves 940; split items share GLBs where possible |
