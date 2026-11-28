# Runefall Arena — complete remodel blueprint

Status (2026-11-28): **Phase 0 (pilot), Phase 1 (systems) and Phase 2 (items) done** — see `08` §3 for the gates and
what shipped; Phase 3 (champions) is next. Written as a blueprint on 2026-11-27; it describes, precisely,
every model, item, animation and effect needed to remodel all champions, pets, forms, spells and attacks, with
World of Warcraft as the role model for look and structure (never its names, designs or content) and performance
as a hard requirement.

## The documents

| # | Document | What it pins down |
|---|---|---|
| 01 | [Art direction](01-art-direction.md) | what we take from the role model, style rules, races, colours |
| 02 | [Champions](02-champions.md) | 20 model sheets: race, size, armour, colours, glow, silhouette, generation prompt, acceptance |
| 03 | [Weapons and sockets](03-weapons-and-sockets.md) | **how every item sits in the hand**: sockets on the rig, item grip space, finger poses, two-hand IK, shields, the rigged bow, the blunderbuss, 24 items with exact sizes |
| 04 | [Pets, summons, forms](04-pets-summons-forms.md) | gorilla, ghoul, abomination, spirit wolf, cat / bear / tree forms, Fire Spirit, totems, trap — models, rigs, 89 clips |
| 05 | [Animations](05-animations.md) | 193 humanoid clips in 10 stance sets, markers, layers, timing contracts with the sim, manifest, prompts |
| 06 | [Spells and VFX](06-spells-and-vfx.md) | effect system and budget, school palette, an entry for each of 21 basic attacks and 106 abilities, buff states, 26 projectiles |
| 07 | [Performance](07-performance.md) | measurements today, budgets, offline assembly into one draw per champion, LODs, shadows, loading |
| 08 | [Pipeline and QA](08-pipeline-and-qa.md) | folders, tools, phase order with gates, Tripo credit estimate, checklists, risks |
| 09 | [New class: Dread Knight](09-dread-knight.md) | an 11th class after the death-knight archetype — Frost (damage) and Blood (tank): kit, stats, new sim mechanics, 2 models, 2 items, 12 clips, effects |

## The numbers

| | Count |
|---|---|
| Champion models | 20 (10 classes × 2 specs, 7 races) + 2 for the new Dread Knight (Risen race) |
| Items | 24 (weapons, staves, shields, off-hands, bow, blunderbuss, arrow) + 2 runeblades |
| Creatures | 7 (gorilla, ghoul, abomination, spirit wolf, cat, bear, tree) + Fire Spirit + 3 totems + trap |
| Humanoid clips | 193 (common 33, `sns` 20, `th` 26, `dw` 21, `dg` 18, `mc` 14, `wd` 17, `st` 24, `bw` 9, `rf` 11) + 12 Dread Knight |
| Creature clips | 89 |
| Abilities with their own motion and effect | 106 + 21 basic attacks (+ 10 + 2 for the Dread Knight) |
| Tripo credits (estimate) | ≈ 12,550 + ≈ 650 (Dread Knight) = ≈ 13,200 of ≈ 15,800 |
| Draw calls per champion | 8–31 today → **1** (+1 shadow) |
| 2v2 frame | 273 draws today → ≈ 150 |

## Key decisions

1. **Sockets, not grips by eye.** Every rig gets named sockets fitted from the hand's mesh (the auto-rig's bone
   rolls and finger lengths are random per model), stored in `sockets.json`. Every item is authored around its grip
   (origin = fist centre, +Y = to the tip, +X = leading edge) and hangs on its socket with no offset. Weapons never
   turn in the hand at runtime; a clip that needs that is re-made.
2. **Hands close on what they hold**: a finger-pose layer per item (fist, trigger, two-hand, wand pinch, bow grip /
   draw, book, orb cup, open spell hand, claw).
3. **Two-handed weapons** get left-hand IK onto the weapon's `grip2` (the priests now carry two-handed staves, the
   Sharpshooter a blunderbuss held at the fore-end); **shields** hang on the forearm with a wrist lock; the
   Beastmaster's **bow** is rigged so the string draws to the hand and an arrow is nocked.
4. **One draw per champion**: items are merged into the champion's skinned mesh offline (socket joints), one
   2048×1024 atlas, KTX2 + meshopt, LODs, a low-poly shadow proxy.
5. **Animations per stance** (10 sets) with several attack variants, directed and omni casts with build-up, real
   whirlwinds, charges and leaps with landings, directional hits, CC poses and deaths — 193 clips made with Tripo AI
   motion on one animation master, with timing markers in a manifest.
6. **Pets and forms animate on their own rigs** and have every state (spawn, death, hit, stun …); four-legged
   motion via Tripo AI after a 2-clip pilot, the procedural driver as plan B.
7. **Effects by school, not by class**, drawn by a pooled, atlas-based effect system (≤ 14 draws, ≤ 8,000
   particles, no allocation during a match). Crowd control is readable over the head; hostile ground effects have a
   red edge.
8. **Sim follow-ups** are separate and optional except R1 (instant melee abilities land at `hitAt`, so blows and
   numbers coincide); any of them requires a balance re-run.
9. **Pilot first**: Paladin Protection (sword + shield, the hardest grip case) end to end before anything is mass
   produced.

## Not in scope

Arenas, UI, sounds, gameplay or balance changes (except the listed sim follow-ups), emotes beyond victory /
defeat, mounts, cosmetics or skins.

## Sources

- Inventory of the current game (classes, abilities, effects, models, weapons, rigs, animations, pets, forms),
  read from the code on 2026-11-27 and cited by file and line in each document.
- Live measurements in the game page (draw calls, triangles, joints, hand-bone lengths, finger joints).
- WoW model and animation conventions as a technical reference: attachment points on the character (hand right /
  left, shield, spell hand directed / omni, hand arrow, sheath and hip points …) and its animation list (stance
  ready poses, attack variants, parry, directed / omni / area casts, channel, battle roar, whirlwind, stun,
  knockdown) with fallback animations, from the public wowdev wiki.
