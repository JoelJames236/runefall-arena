# 03 — Weapons, shields, off-hands and sockets

The most important document of the remodel: **how every item sits in the hand**. It replaces today's
"grip set by eye + per-clip grip guess" with fixed, measured conventions on both sides — the item model and the
character rig — so a weapon is held the same way in every animation, by every champion.

Reference model: World of Warcraft's item attachment system (an item model is authored around its grip point and
hung on a named attachment of the character: HandRight, HandLeft, Shield, SpellHandDirected, HandArrow …). The
names, models and look here are our own; only the engineering idea is borrowed.

---

## 1. Why the grips are wrong today (measured 2026-11-27)

| # | Problem | Where | Effect on screen |
|---|---|---|---|
| 1 | Idle grips are **world directions** (`GRIP[w].dir/side`) solved against the idle clip's hand. They were set by eye for the hanging hand, not from how the hand closes. `GRIP_GEN` (per-model grips for generated rigs) is **empty**, so all 20 different sculpted hands share one table. | `heroes.js:312-336, 343`, `solveGrip` `:379` | A sword "points forward-up" out of a hand that isn't closed around it; in any clip whose wrist differs from the idle the weapon points somewhere unintended. |
| 2 | The grip position is the hand bone + a **fixed 0.075–0.085 m toward `middle_01`**. Tripo's auto-rig puts `middle_01` between **0.09 m and 0.19 m** from `hand_*` (warrior 0.091, paladin 0.135, rogue 0.138, druid 0.181); forearms are even asymmetric (Fury: right 0.109 m, left 0.175 m). | `solveGrip` `:388-390` | The handle sits in the knuckles on one champion, in the wrist on another. |
| 2b | The auto-rig's **bone roll is random**: in T-pose `hand_r`'s local +X points (−0.08, −0.01, −1.0) on the Discipline priest, (−0.36, −0.90, −0.26) on Fury, (−0.06, −0.90, 0.44) on Protection Paladin, (0, −0.02, 1.0) on Subtlety. | GLB rest poses | Anything authored in hand-local axes is wrong on every other model → sockets must be **fitted per model** (§3.2). |
| 2c | Several "finger bones" are **not skin joints** (three.js then doesn't make them Bones): Sharpshooter `middle_01_r`, `pinky_01..03_r`, `ring_03_l/r`; Beastmaster `pinky_01..03_l`, `ring_03_r`; Elemental `pinky_01_l/r`; Feral `ring_02/03_l`; Restoration `ring_metacarpal_l`; Executioner `pinky_03_l`, `pinky_02_r`; Crusader `pinky_03_l`; Enhancement `ring_metacarpal_r`. On the Sharpshooter the retarget also loses `hand_r`'s swing alignment. | `champions.js:69, 109-116` | Fingers that never curl, grips derived from the wrong finger, a stiff right hand on the Sharpshooter. |
| 3 | Attack motions hold weapons "the real way" (through the fist), so the weapon must **turn in the hand** at runtime from the idle grip to a "fist grip" computed from finger bones, chosen per clip (`fist` / `rev` / `palmRev` / `idle`) — and per clip, not per hand: `chop_l` also turns the right axe. Only the rotation changes, the grip point stays at the idle palm point. | `fistGrips` `:514`, `ATTACK_ANIMS.grip`, `update()` `:792` | Visible rotation of the weapon in the hand during every attack; ability clips (slash, finisher, bash, slam, cast) keep the idle hold. |
| 3b | Shields fitted by `fitShield` take +Y = elbow → wrist, so with the arm hanging the **tower shield hangs upside down** (its foot spike points to the elbow). | `heroes.js:369` | Wrong in the idle; right only with the forearm raised. |
| 4 | Turning weapons can't be merged into the body mesh (`noMerge`). | `consolidate.js` | **+1 … +17 draw calls per champion** (Enhancement Shaman: 31 draws, 17 materials). |
| 5 | **Two-handed weapons are held by the right hand only.** The left hand plays whatever the clip does. | great axe, sun hammer | Left hand floats next to the haft or crosses through it. |
| 6 | **Shields** are fitted to the forearm surface (good), but have **no handle**: nothing ties the fist to the shield. | `fitShield` `:347` | The fist hangs in front of / behind the shield's back. |
| 7 | **Bows** are rigid: the string never draws, no arrow is nocked, the right hand never touches the string. | `makeClassWeapon('bow')` | The hunter's attack reads as a gesture, not a shot. |
| 8 | Off-hand items (tome, relic, shield) are frozen in the idle pose during attacks (`<clip>\|offL`). | `heroes.js clip()` | The off-hand arm is dead during every attack. |
| 9 | Weapons are code-built from 6–60 primitives each (up to **9,128 triangles** for two axes), with separate glow spheres. | `armory.js`, `makeWeapon` | Weapons cost as much as the whole body (body ≈ 9.6–10 k triangles). |

Today's per-champion cost, measured in the game (`new Character()` + traversal, 2026-11-27):

| Champion | Draws | Triangles (of which weapons + static) | Bones | Materials |
|---|---|---|---|---|
| Warrior Protection | 18 | 16,635 (5,012) | 79 | 14 |
| Warrior Arms | 12 | 17,816 (8,032) | 80 | 10 |
| Berserker Fury | 25 | 18,951 (9,128) | 79 | 11 |
| Berserker Executioner | 14 | 18,423 (8,414) | 78 | 12 |
| Paladin Crusader | 9 | 12,870 (2,716) | 78 | 9 |
| Paladin Protection | 13 | 13,038 (1,604) | 80 | 9 |
| Mage Frost / Fire | 23 / 23 | 13,491 / 13,245 | 80 / 79 | 11 / 13 |
| Rogue Subtlety / Assassination | 11 / 11 | 10,981 / 10,638 | 80 | 6 |
| Priest Discipline / Shadow | 10 / 8 | 12,257 / 10,878 | 80 | 9 / 7 |
| Shaman Elemental / Enhancement | 27 / 31 | 14,787 / 18,828 | 77 / 79 | 21 / 17 |
| Hunter Beastmaster / Sharpshooter | 11 / 11 | 12,308 / 12,200 | 76 / 73 | 9 |
| Necromancer Summoner / Curser | 15 / 15 | 14,611 / 14,480 | 80 / 79 | 9 |
| Druid Feral / Restoration | 1 / 16 | 9,585 / 14,852 | 77 / 78 | 1 / 12 |
| Gorilla pet | 1 | 10,133 | 80 | 1 |

(Draws are per pass; every champion casts shadows, so the shadow pass adds about the same again.)

---

## 2. Conventions (units, axes)

- Units: **metres**. Y up. A champion at rest faces **+Z**; its **right is −X**, its left +X (three.js).
- Champion height (feet to top of head, without helm crests): **1.95 m** reference (human male); measured today
  1.83–2.09 m. Race factors: see `01-art-direction.md` §3. Item sizes below are for the reference 1.95 m and are
  **not** scaled per race (a heroic dwarf carries a full-size axe), except where a row says so.
- Every **frame** below is right-handed and orthonormal (`Z = X × Y`). Rotations only — never a mirrored frame
  (negative scale breaks normals, skinning and merging).

---

## 3. Sockets on the character rig

A **socket** is an empty node parented to a bone, with a fixed local transform. Items, VFX and UI hang on sockets,
never directly on bones with hand-made offsets. Every humanoid rig (champions, gorilla, ghoul, abomination) carries
the same socket set; creatures carry the subset in §3.3.

### 3.1 Humanoid socket list

| Socket | Parent bone | Origin | Axes at rest | Used for | WoW analogue |
|---|---|---|---|---|---|
| `grip_r` | `hand_r` | centre of the closed right fist's channel (see 3.2) | **+Y** out of the fist on the thumb/index side, **+X** the knuckle direction (wrist → knuckles), **+Z** = X × Y (back of the right hand) | main-hand weapon | HandRight |
| `grip_l` | `hand_l` | centre of the closed left fist's channel | +Y thumb side, +X knuckles, +Z = X × Y (**palm** side of the left hand) | off-hand weapon, bow, tome, relic | HandLeft |
| `shield_l` | `lowerarm_l` | same world point as `grip_l` at rest | shield frame: +Y = elbow → fist (the shield's top), +X = along the handle (= `grip_l` +Y), +Z = out of the back of the left hand (the shield's face) | shields | Shield |
| `spell_r` / `spell_l` | `hand_r` / `hand_l` | palm centre + 0.08 m along the palm normal (out of the palm) | +Y = palm normal, +X = knuckles | cast glow, "orb in the palm", heal / lightning origin when no item | SpellRightHand / SpellLeftHand |
| `spell_directed` | `spine_05` | 0.45 m in front of the chest at shoulder height | +Z forward | channel beams, "push" casts with both hands | SpellHandDirected |
| `spell_omni` | `spine_05` | 0.25 m above the head, centred | +Y up | omni casts (arms up), summons, self buffs | SpellHandOmni |
| `nock_r` | `hand_r` | between index and middle finger tips in the draw pose (`grip_r` + 0.07 m along +X, −0.02 m along +Y) | +Y along the arrow toward its head | arrow during the draw; the bow string's centre follows it | HandArrow |
| `head_top` | `head` | top of the helm / hair mesh + 0.04 m (measured from the head's skinned vertices) | +Y up | halo, crown VFX, stun circle, "?" disorient marks | Head / HeadTop |
| `eyes` | `head` | between the eyes on the face surface | +Z forward | glowing eyes (undead, shadow form), breath | Head |
| `chest` | `spine_05` | front surface of the chest (measured) | +Z out of the chest | impact sparks, shields-on-self bubble centre, buff sigils | Chest |
| `back` | `spine_05` | back surface between the shoulder blades (measured) | +Z out of the back | quiver arrow draw, totem on the back, back-mounted glow | Back |
| `hip_r` / `hip_l` | `pelvis` | outer surface of the hip, at the belt | +X outward | lantern, venom vials, belt glows | HipRight / HipLeft |
| `foot_r` / `foot_l` | `ball_r` / `ball_l` | under the ball of the foot | +Y up | footstep dust, frost/fire step trails | RightFoot / LeftFoot |
| `base` | root | ground under the pelvis | +Z forward | team ring, ground decals, shadow blob | Base |
| `overhead` | root | model height + 0.35 m | +Y up | name plate, HP bar, cast bar | PlayerName |

### 3.2 Fitting `grip_*` precisely (per model, once)

Tripo rigs place the finger bones inconsistently (problem 2), so the grip is fitted **from the mesh**, not from bone
lengths, then checked by eye in the viewer and stored.

1. Take the rest pose (T-pose). Collect every vertex whose skin weight on `hand_*`, `*_metacarpal_*` and the
   finger bones of that side sums to ≥ 0.5.
2. Principal axes of that point cloud (PCA): **L** = longest (wrist → fingertips), **W** = second (thumb side
   positive: sign chosen so `thumb_01` lies on +W), **N** = third (palm normal; sign chosen so it points away from
   the back-of-hand vertices, i.e. toward the palm). Hand length `hl` = extent along L, width `hw` = extent along W,
   thickness `ht` = extent along N.
3. Origin of `grip_*` = wrist point (`hand_*` bone) + **0.42·hl** along L + **(0.5·ht + 0.017)** along N
   (the channel lies just in front of the palm, 17 mm = radius of a 34 mm handle), lateral centre between the
   index and pinky knuckles along W.
4. Axes: +X = L (knuckles), +Y = W (thumb side), +Z = X × Y.
5. Sanity: `hl` must be 0.17–0.23 m and `hw` 0.08–0.11 m on a 1.95 m champion (heroic hands are ~15 % bigger than
   real). Outside that range the hand was mis-skinned → re-rig.
6. Store the result per model in **`assets/models/champions/sockets.json`** (one file, one fetch for all models):
   `{ "<model key>": { "grip_r": { "bone": "hand_r", "p": [x,y,z], "q": [x,y,z,w] }, … , "hand": { "hl":…, "hw":…, "ht":… } } }`
   — positions and rotations in the **parent bone's local space** of the bind pose, with the bone's world scale
   removed (Tripo/UE skeletons often carry 0.01 / 100 factors).
7. The viewer (`viewer.html`) gets a **socket editor**: show every socket as a small RGB axis tripod, a 34 mm test
   cylinder in each grip, drag/rotate with sliders, "copy JSON".

### 3.3 Creature sockets (quadrupeds, pets, forms)

| Socket | Parent | Use |
|---|---|---|
| `mouth` | jaw / head | bite impact, roar VFX, breath |
| `head_top`, `eyes` | head | stun, glowing eyes, buff icons |
| `chest`, `back` | front spine | impact, saddle-point for mounted VFX, wolf "spirit" glow core |
| `paw_fl`, `paw_fr`, `paw_bl`, `paw_br` | the four foot bones | claw swipes (trail origin), footstep dust, spirit-wolf pawprints |
| `tail_tip` | last tail bone | trail (spirit wolf, cat) |
| `base`, `overhead` | root | ring, name plate |

---

## 4. Item model conventions ("grip space")

Every held item is **one GLB**, authored so that its origin and axes **are** the grip — exactly like a WoW item
model hangs on its attachment with no further offset. Attaching is then `socket.add(item)` with an identity
transform. Nothing is solved at runtime.

### 4.1 One-handed and two-handed weapons

```
            +Y  (toward the tip / head)
             ^
             |      ___
             |     |   \   <- edge / bit / face on +X
             |     |    \
             |     |____/
             |       |
             |       |       haft / blade
     origin  O-------+------> +X  (leading edge: where the knuckles point)
  (grip centre)      |
             |       |  <- grip2 (2H only, left hand), on -Y
            /        |
          +Z (= X × Y; out of the back of the right hand)
```

| Rule | Value |
|---|---|
| Origin | centre of the main hand's grip on the handle: the middle of the 4 fingers' wrap (≈ 0.05 m from the guard for a sword, ≈ 0.10–0.12 m from the butt for an axe / mace / hammer) |
| +Y | along the handle toward the striking end (blade tip, axe head, mace head, staff top, wand tip) |
| +X | the **leading edge**: a sword's true edge, an axe's bit, a hammer's striking face, a mace's flanged face, a staff's crystal face. A cut or chop leads with +X. |
| +Z | X × Y — the "back of the hand" side; asymmetric decoration (spikes, hooks) goes on −X, not on ±Z |
| Handle | round or oval, **Ø 34 mm** one-handed, **Ø 38 mm** two-handed/staves (the finger pose is built for these) |
| Named empties (child nodes) | `tip` (weapon trail end, projectile origin for wands/staves), `trail_base` (trail start: guard / bottom of the head), `fx_core` (glowing gem / rune centre), `grip2` (2H only: centre of the left hand's grip, frame = the left hand's grip frame), `pommel` |
| Pivot for swing | the origin (the hand) — never offset the mesh |
| Left-hand copies | not needed: the same GLB hangs on `grip_l`. Make an `_L` model **only** if asymmetric decoration must stay outward. |

### 4.2 Shields

| Rule | Value |
|---|---|
| Origin | centre of the **handle** (where the fist closes) |
| +Y | toward the shield's top (= direction elbow → fist, the forearm's direction) |
| +X | along the handle |
| +Z | the shield's **face** (boss, emblem). The back plane is at **z = +0.035 m** (the fist's back touches it); the forearm strap (enarme) at y = −0.24 m, z = +0.035 m |
| Hang | on `shield_l` (forearm), **not** on the hand: the strap locks a real shield to the forearm. While a shield is equipped, `hand_l`'s local rotation is pulled 80 % toward its rest-fist rotation each frame ("wrist lock"), so the fist stays on the handle whatever the clip does. |
| Clearance | `shield_l` is fitted per model like `fitShield` today (measured gauntlet thickness) so the back plane clears the forearm mesh by 10 mm; result stored in sockets.json |
| Named empties | `fx_core` (emblem centre: block flash, holy glow), `rim_top` (shield-bash impact point) |

### 4.3 Off-hand items

| Item | Socket | Origin | Axes |
|---|---|---|---|
| Tome (spellbook) | `grip_l` with the `tome` hand pose | centre of the spine, where the thumb presses | +Y along the spine toward the book's top, +Z = cover facing away from the palm; the book lies on the open palm (pages open upward in the "read" pose) |
| Relic (spirit mask / totem fetish) | `grip_l` with the `orb_cup` pose | bottom centre of the item | +Y up out of the palm, +Z = face toward the enemy |
| Fire orb / floating crystals | `spell_l` (no hand contact) | orb centre | free; the orb floats 0.08 m above the palm and bobs ±0.01 m |
| Arrow (during draw) | `nock_r` | the nock (arrow's rear end) | +Y toward the arrowhead; 0.80 m long |

### 4.4 Bows (rigged items)

The bow is the only **skinned** item: 4 bones, so the string draws and the limbs flex.

| Bone | Rest position (bow space) | Moves |
|---|---|---|
| `bow_root` | origin = centre of the riser grip (left fist) | — |
| `limb_top` | y = +0.10 (riser top) | rotates ≤ 14° toward −Z at full draw |
| `limb_bot` | y = −0.10 | rotates ≤ 14° toward −Z at full draw (mirror) |
| `string_mid` | y = 0, z = −0.18 (brace height) | follows `nock_r` while drawing (world target), springs back to rest on release (critically damped, 0.06 s) |

Bow space: origin = grip centre, **+Y = up** (top limb), **+Z = toward the archer** (string side), +X = the
arrow-shelf side (the arrow rests on the left of the riser for a right-handed archer). The bow hangs on `grip_l`
with the `bow_grip` pose. The string is 2 thin quads skinned to `limb_top`/`string_mid`/`limb_bot` (no lines).

---

## 5. Hand poses (finger curls)

Fingers are posed by a **finger layer** applied after the animation mixer each frame: per item a fixed pose, blended
in 0.08 s when the item or the action changes. The animation clips themselves keep their finger tracks **off**
(Tripo AI motions already drop them; UAL finger tracks are ignored while an item is held). Performance: 30 bone
rotations per champion per frame.

Angles in degrees of **flexion** (positive = toward the palm) about each joint's flex axis
(`normalize(boneDir × N)`, N = the hand's palm normal from §3.2); `spread` rotates the 01 joints about N
(positive = away from the middle finger); thumb `opp` = rotation of `thumb_01` toward the palm about L.

| Pose | Index 01/02/03 | Middle | Ring | Pinky | Spread | Thumb opp / 02 / 03 | Used by |
|---|---|---|---|---|---|---|---|
| `fist_1h` (Ø 34 mm) | 70 / 95 / 55 | 75 / 95 / 55 | 80 / 95 / 55 | 85 / 95 / 55 | −4 | 45 / 25 / 35 | swords, axes, maces, scepters, daggers, shield handle |
| `fist_2h` (Ø 38 mm) | 62 / 85 / 50 | 66 / 88 / 50 | 70 / 88 / 50 | 75 / 88 / 50 | −4 | 40 / 25 / 30 | two-handed weapons (both hands), staves |
| `wand_pinch` | 25 / 30 / 15 | 55 / 70 / 40 | 75 / 90 / 50 | 85 / 90 / 50 | 0 | 50 / 20 / 25 | wands (index lies along the wand) |
| `bow_grip` (Ø 45 mm riser) | 55 / 78 / 45 | 60 / 82 / 45 | 65 / 82 / 45 | 70 / 82 / 45 | −2 | 35 / 30 / 30 | bow hand |
| `bow_draw` | 20 / 80 / 40 | 20 / 80 / 40 | 20 / 80 / 40 | 80 / 90 / 60 | 0 | 30 / 40 / 40 | string hand while drawing (three-finger hook) |
| `tome` | 10 / 15 / 10 | 10 / 15 / 10 | 12 / 15 / 10 | 15 / 18 / 10 | +3 | 10 / 40 / 20 | book on the palm, thumb over the cover's edge |
| `orb_cup` | 30 / 35 / 25 | 30 / 35 / 25 | 32 / 35 / 25 | 35 / 38 / 25 | +8 | 20 / 15 / 15 | relic, fire orb, palm-up casts |
| `spell_open` | 8 / 10 / 5 | 8 / 10 / 5 | 10 / 10 / 5 | 12 / 12 / 5 | +15 | 0 / 5 / 5 (abducted 35°) | cast releases with an empty hand |
| `claw` | −10 / 60 / 70 | −10 / 60 / 70 | −10 / 60 / 70 | −10 / 60 / 70 | +15 | 10 / 40 / 50 | Feral druid (humanoid), ghoul |
| `fist_unarmed` | 90 / 100 / 70 | 90 / 100 / 70 | 92 / 100 / 70 | 95 / 100 / 70 | −4 | 60 / 40 / 40 | gorilla, abomination, punches |
| `relaxed` | 15 / 22 / 12 | 18 / 25 / 12 | 22 / 28 / 14 | 26 / 30 / 16 | +2 | 15 / 15 / 10 | empty hand at rest |

A pose is correct when a Ø 34 mm (or 38 / 45 mm) test cylinder placed on `grip_*` is touched by every finger's
middle phalanx without passing through it (viewer check, §8).

---

## 6. Two-handed weapons: left-hand IK

WoW authors every two-handed animation per body so both hands sit on the haft. Our clips are retargeted from one
source, so the left hand is **snapped by IK**:

- Target: the weapon's `grip2` empty (a frame equal to a left-hand grip frame on the haft, 0.30–0.45 m below the
  origin along −Y).
- Solver: analytic **two-bone IK** on `upperarm_l` → `lowerarm_l`, then `hand_l` rotated to the target frame. Pole
  (elbow direction) = the clip's own elbow position, so the arm keeps the motion's character.
- Weight per clip (animation manifest `ikL`): 1.0 in the 2H stance idle and every 2H swing; 0 when the clip frees
  the left hand (a two-handed champion's spell cast, death, victory). Blend 0.12 s.
- Hand poses: `fist_2h` on both hands.
- Limit: if the target is farther than the arm's reach × 0.98, the hand stops at the reach (no stretched arm); the
  validation strip (§8) shows these frames in red.

Also used for: the bow's string hand (target `string_mid` → reversed: the string follows `nock_r`, the hand is not
IK-driven), the staff in two-hand casts (optional `grip2` on staves; weight from the clip).

---

## 7. The item list (what to model)

Sizes for the 1.95 m reference champion, in the **heroic scale** of the role model: about 1.3–1.4× a real
weapon, so a weapon reads from the arena camera (10–14 m away, looking down). "Today" is the code-built weapon's
overall length (`armory.js`). "Tris" = LOD0 budget (LOD1 = 50 %, see `07-performance.md`). Every item's texture
is packed into **its champion's texture atlas** (the right half of the 2048×1024 champion atlas, see
`07-performance.md` §4); "Tile" = the item's share of that 1024×1024 half.

| Id (code) | Used by | Hand / socket | Pose | Overall (today) | Key dimensions | Origin (from) | Named empties | Tris | Tile |
|---|---|---|---|---|---|---|---|---|---|
| `orcaxe` | Warrior Protection | `grip_r` | `fist_1h` | **0.98 m** (1.26) | haft Ø 34 mm; one bit on +X 0.36 tall × 0.27 deep with a hooked beard; back spike on −X 0.11; iron bands | 0.12 above the butt | `tip` = bit's top corner (x 0.27, y 0.80); `trail_base` = bit's bottom corner (x 0.25, y 0.50) | 900 | 512×1024 |
| `orcshield` | Warrior Protection | `shield_l` | `fist_1h` | **Ø 0.86 m** round (0.83) | 0.09 deep, iron rim, boss Ø 0.17, 8 rim spikes 0.07, two bands | handle | `fx_core` boss, `rim_top` | 1,000 | 512×1024 |
| `greataxe_orc` (was `greatAxe`, Arms) | Warrior Arms | `grip_r` + IK `grip2` | `fist_2h` | **1.75 m** (1.82) | haft Ø 38 mm; double bit span 0.80, each bit 0.48 tall; grip2 at y −0.45; top spike | right hand 0.55 above the butt | `tip` (right bit's top corner), `trail_base`, `grip2`, `pommel` | 1,600 | 1024² |
| `headsman_axe` (was `greatAxe`, Executioner) | Berserker Executioner | `grip_r` + IK `grip2` | `fist_2h` | **1.70 m** (1.82) | single crescent bit 0.62 tall × 0.40 deep on +X, black iron, blood-red rune line; grip2 at y −0.42 | 0.55 above the butt | as above | 1,500 | 1024² |
| `warAxe` + `warAxeL` | Berserker Fury | `grip_r` + `grip_l` | `fist_1h` | **0.92 m** (1.15) | bearded bit on +X 0.32 tall, rune on the cheek | 0.10 above the butt | `tip`, `trail_base`, `fx_core` (rune) | 800 each, one GLB | 512×1024 shared |
| `sunhammer` | Paladin Crusader | `grip_r` + IK `grip2` | `fist_2h` | **1.70 m** (1.91) | head 0.46 × 0.24 × 0.24, sunburst striking face on +X, back spike; grip2 at y −0.40 | 0.50 above the butt | `tip` = head's +X face centre, `trail_base` = head's bottom, `fx_core` (sun disc) | 1,400 | 1024² |
| `holysword` | Paladin Protection | `grip_r` | `fist_1h` | **1.15 m** (1.22) | blade 0.86 × 0.075, winged crossguard 0.32, grip 0.15, gem pommel | 0.05 below the guard | `tip`, `trail_base` (guard), `fx_core` (gem in the guard) | 900 | 512×1024 |
| `towershield` | Paladin Protection | `shield_l` | `fist_1h` | **1.20 × 0.66 m** (1.28 × 0.69) | tower/heater outline, 0.08 deep, gold rim, sun emblem, foot spike **at −Y** | handle | `fx_core` emblem, `rim_top` | 1,000 | 512×1024 |
| `fang` + `fangL` | Rogue (both) | `grip_r` + `grip_l` | `fist_1h` | **0.50 m** (0.48) | blade 0.34 × 0.05 curved toward +X, serrated back, guard 0.10; Assassination: green poison channel | 0.04 below the guard | `tip`, `trail_base`, `fx_core` (venom bead) | 400 each, one GLB | 512×512 |
| `frostwand` / `firewand` | Mage Frost / Fire | `grip_r` | `wand_pinch` | **0.50 m** (0.66) | shaft Ø 22 mm; 3-prong head cradling a crystal (frost) / an ember (fire) 0.10 | the pinch, 0.14 above the butt | `tip` (projectile origin), `fx_core` (crystal) | 450 each | 512×512 |
| `tome_frost` / `tome_fire` (was `tome`) | Mage Frost / Fire | `grip_l` | `tome` | **0.30 × 0.24 × 0.07 m** (0.26 × 0.20) | metal corners, clasp, glowing sigil on the cover | spine centre | `fx_core` (sigil) | 500 each | 512×512 |
| `sun_scepter` (Discipline) / `void_scepter` (Shadow) (was `sunmace`) | Priest | `grip_r` | `fist_1h` | **0.90 m** (1.05) | flanged sun head Ø 0.19 with wings / caged void crystal with tendril prongs | 0.11 above the butt | `tip` = head top, `fx_core` | 700 each | 512×1024 |
| `stormmace` | Shaman Elemental | `grip_r` | `fist_1h` | **0.88 m** (0.99) | carved stone head 0.20 with copper bands and a lightning rune | 0.11 above the butt | `tip`, `fx_core` | 700 | 512×1024 |
| `relic` | Shaman Elemental | `grip_l` | `orb_cup` | **0.36 m** (0.38) | spirit mask idol with horns and feathers on a short haft | bottom centre | `fx_core` (eyes) | 500 | 512×512 |
| `stormaxe` + `stormaxeL` | Shaman Enhancement | `grip_r` + `grip_l` | `fist_1h` | **0.92 m** (1.07) | crescent bit with storm rune, feathers tied below the head | 0.10 above the butt | `tip`, `trail_base`, `fx_core` | 800 each, one GLB | 512×1024 shared |
| `bow` | Hunter Beastmaster | `grip_l` (rigged) | `bow_grip` / right `bow_draw` | **1.40 m** (1.39) | recurve, riser 0.20, brace 0.18, bone-and-sinew limbs, tusks on the tips | riser grip | `nock_rest` (arrow shelf), `fx_core` | 900 + 4 bones | 1024² |
| `longbow` | Hunter Sharpshooter | `grip_l` (rigged) | same | **1.80 m** (1.83) | longbow with steel caps and a leather-wrapped riser, brace 0.17 | riser grip | same | 900 + 4 bones | 1024² |
| `arrow` | Hunter (both) | `nock_r` during the draw; projectile after | — | 0.85 m | fletching 0.10 (Beastmaster: feathers, Sharpshooter: steel vanes) | the nock | `tip` | 120 | 128² |
| `bonestaff_summoner` / `bonestaff_curser` (was `bonestaff`) | Necromancer | `grip_r` | `fist_2h` | **2.15 m** (2.2) | butt at y −0.95, head at y +1.20: rib crown + skull (Summoner) / caged soul lantern + chains (Curser) | 0.95 above the butt | `tip` (head), `fx_core`, optional `grip2` at y −0.35 | 1,000 each | 512×1024 |
| `druidstaff` | Druid Restoration | `grip_r` | `fist_2h` | **2.05 m** (1.87) | living heartwood, head = antler-branch cradle with a seed-light, leaves | 0.90 above the butt | `tip`, `fx_core`, optional `grip2` | 1,000 | 512×1024 |
| claws | Druid Feral (humanoid, only seen in the class screen) | part of the body mesh (gauntlets) | `claw` | — | 3 blades per hand, 0.16 | — | `tip_r`/`tip_l` sockets on `middle_03_*` | in body | body |

Ids keep today's code names where one model covers one spec; a new id gives each spec its own silhouette, as in
WoW where two specs of one class never share a weapon look. Total: **24 item models**, ≈ 19,000 triangles
for all of them; at most **2 items per champion** on screen. Dwarves (Berserker) carry the same sizes — a huge axe
on a short body is part of the look.

---

## 8. Validation (per item, per champion)

1. **Static check (viewer)**: every champion × its items in the stance idle: the handle passes through the fist
   (test cylinder), no finger penetrates the handle by > 5 mm, shield back ≥ 10 mm off the forearm, 2H left hand
   on `grip2` (IK error < 1 cm).
2. **Motion strip**: for every attack and cast clip, 8 frames from the click to the recovery, side view, with the
   weapon tip's path drawn: the tip leads with +X at the strike frame (cuts) or points at the target (thrusts,
   wand flicks, staff thrusts) within 20°.
3. **No turning**: an item's local transform on its socket never changes at runtime (except the bow's string and
   limbs). If a clip needs a different grip, it is the clip that is wrong (re-generate it), not the item.
4. **Performance**: the item adds 0 draw calls (it is merged into the champion's draw, see `07-performance.md`).
