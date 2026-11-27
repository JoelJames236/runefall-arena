# Basic-attack animations

Status: **built** (2026-11-27). Every champion's basic attack (left click) plays a real motion made with Tripo
Studio's AI animation, timed so the blow lands exactly when the sim deals the damage.

## Why

The old attacks used the few clips of the animation library: melee champions played only the short strike part of a
sword clip, sped up, so "the weapon just moves a bit"; the rogue punched, casters all played one generic spell shot
and the hunter fired a pistol. The user asked for every basic attack to move the weapon the way you would in real
life — a real swing for melee, a nice motion for the mage's wand.

## The motions

Made with **Tripo Studio → Animate → Eigene Animation (AI, text → motion)**, 20 credits each, on a rigged human
(the arena guard K12 from the colosseum crowd, Mixamo skeleton). Prompts: `assets/models/anims/attacks.map.json`
maps each generated clip (Tripo names it after its prompt, cut to 64 characters) to its id.

| Id | Motion | Used by | Grip | Strike (s into the clip) |
| --- | --- | --- | --- | --- |
| `sword_fore` | diagonal forehand cut | Protection Paladin | rev | 1.33 |
| `sword_back` | backhand cut, left → right | Protection Paladin, Protection Warrior | rev | 1.25 |
| `chop_r` | big one-handed axe chop over the right shoulder | Protection Warrior, Fury Berserker, Enhancement Shaman | fist | 1.52 |
| `chop_l` | the same with the left hand | Fury Berserker, Enhancement Shaman | fist | 1.20 |
| `axe2h` | two-handed diagonal chop over the right shoulder | Arms Warrior, Executioner, Crusader Paladin | fist | 0.93 |
| `sweep2h` | two-handed horizontal sweep | Arms Warrior, Executioner | rev | 0.45 |
| `smash2h` | warhammer raised overhead, slammed into the ground | Crusader Paladin | fist | 1.32 |
| `stab_r` | lunging dagger stab | Rogue | idle | 0.56 |
| `hook_l` | dagger hook slash, left hand | Rogue | idle | 0.57 |
| `wand` | wand cocked by the shoulder, flicked at the target | Mage | rev | 0.53 |
| `scepter` | scepter raised overhead, swung forward to point | Priest, Elemental Shaman | fist | 1.05 |
| `staff` | staff drawn back, thrust head-first at the target | Necromancer, Druid | fist | 0.55 |
| `bow` | loose at full draw, then nock and draw again | Hunter | palmRev | 1.20 |

Three generated motions were dropped after testing (a weak right-hand axe chop with the arm hanging low, a left-hand
chop with both arms flailing, a warhammer "smash" that only held the hammer out like a lance); they were made again
with more precise prompts (`chop_r`, `chop_l`, `smash2h`). Cost: 16 × 20 = 320 credits.

## How it works (`js/render/attack-anims.js`, `js/render/heroes.js`)

1. **Extract**: `node tools/anim-extract.mjs <export.glb> assets/models/anims/attacks.json --map attacks.map.json`
   keeps the skeleton's rest pose and the clips' rotations (+ hip translation), no mesh, no fingers — 667 kB.
2. **Load**: the skeleton is rebuilt with UAL bone names; the champion retargeting (`champions.js`, now with a
   second source skeleton) turns each clip onto every champion.
3. **Facing**: the generated motions turn the whole body (a backhand spins the hips ~120°); 75 % of the hips'
   heading is taken out so the champion keeps facing where its player aims (the spine's twist stays).
4. **Cut**: each clip is trimmed to wind-up + strike + follow-through + recovery around its strike.
5. **Strike times** were measured on the champions with their real weapons: the moment the **weapon tip** moves
   fastest with the blade in front of the body (a sword cut is mostly forearm and wrist: the hand moves ~20 cm,
   the tip over a metre), then checked frame by frame.
6. **Timing in play**: a melee blow lands `hitAt` after the click (0.13–0.24 s, from the sim). The whole wind-up is
   shown, sped up (≤ 2.2×) so the strike frame falls exactly on `hitAt`; strike, follow-through and recovery run at
   natural speed. A ranged shot leaves at the click, so its release is played 0.14 s later (the flick and the bolt
   read as one motion).
7. **Grip**: the weapons' idle grips were set by eye for the hanging idle hand; the motions hold weapons the real
   way. During a Tripo attack each weapon turns (and turns back as the attack fades) into the grip that points the
   blade at the enemy when the blow lands: `fist` (through the fist toward the thumb), `rev` (turned over), `palmRev`
   (along the palm's normal — the upright bow) or `idle`. Such weapons are kept out of the body-mesh merge
   (`noMerge`), about one extra draw call per champion.
8. **Off-hand**: a shield, tome or relic stays in guard — the clip's left arm is replaced by the idle pose
   (`<clip>|offL`).
9. **Fallback**: if `attacks.json` fails to load, the old library clips play.

## Checking a motion

In the game page: `CLIPS['raw:<id>']` holds each untrimmed motion, so it can be stepped frame by frame on any
champion; `handPath(id)` (attack-anims.js) prints the source hand's path. Test strips used for tuning: a side view of
six frames from the click through the strike to the recovery, for every class.

## Adding a motion

Generate it in Tripo (Animate → AI, on the K12 guard), click its card and wait a few seconds (only loaded motions
can be exported), export GLB with the skeleton and all motions, add a line to `attacks.map.json`, re-extract, add
an entry to `ATTACK_ANIMS` (hand, strike time, grip) and use the id in `ACTIONS.attack` (heroes.js).
