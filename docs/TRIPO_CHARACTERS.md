# Tripo character models — plan and requirements

Goal: replace the code-assembled champions (CC0 base body + race bake + code armor) with one generated,
rigged model per spec, without losing anything the game already does and without losing performance.

## Pipeline per spec (Tripo Studio)

1. **Generate** from text, T-pose on, empty hands (no weapon, no shield). ~60 credits (Black Friday price; normally 130).
2. **Retopology**: triangles, Smart Mesh, **10,000 triangles**. ~35 credits. (Raw output is ~4.8 M triangles and
   cannot be rigged or rendered in the game.)
3. **Auto-Rig**: humanoid, skeleton preset **UE5 Mannequin**. ~20 credits.
   The game's animations (UAL1/UAL2) use the same bone names (`pelvis`, `spine_01..03`, `neck_01`, `Head`,
   `clavicle_*`, `upperarm_*`, `lowerarm_*`, `hand_*`, fingers, `thigh_*`, `calf_*`, `foot_*`, `ball_*`).
4. **Export GLB** (only 4K textures are offered) → keep the raw file in `assets/models/champions/src/` (git-ignored).
5. **Optimize**: textures to 1024 px JPEG (extract, resize, repack) → `assets/models/champions/<class>_<spec>.glb`
   (pilot: 10.8 MB → 1.9 MB).
6. Add the key to `CHAMPION_MODELS` in `js/render/champions.js` and check it in `viewer.html`
   (side-by-side with the old champion, every animation, triangle and mesh count).

**Pilot result (Warrior — Protection, orc):** 9,901 triangles; walk / run / shield idle / attacks / hits retarget
correctly; war axe + orcish shield sit in the hands. A 2v2 with two generated orcs renders with fewer draw calls
(258 vs 290) and fewer triangles (677 k vs 740 k) than with two code-built warriors, at the same frame time.

About **115 credits per spec**, about **2,300 credits** for all 20.

## What stays in code (not part of the generated model)

| System | Where | Why it stays |
| --- | --- | --- |
| Weapons and shields | `armory.js` / `makeWeapon`, attached to `hand_r` / `hand_l` / `lowerarm_l` via `GRIP` | glowing cores, pulsing halos, weapon trails (`tipR` / `tipL`), cast focus point (`focus`) |
| Animations | UAL clips in `heroes.js` (`CLIPS`, `ACTIONS`, upper/lower split) | same skeleton names; retargeted to the new rest pose |
| Spec effects | `halo` (Discipline), `voidOrb` (Shadow), floating frost shards / fire motes, glowing eyes | animated, emissive — cheap as separate small meshes |
| Druid Cat / Bear forms | `beasts.js` | separate creature models, unchanged |
| Stealth fade, hit flash, rim light | `setOpacity`, `addRim` | work on any material |
| Minions (ghoul, abomination) | `LOOKS.ghoul` / `LOOKS.abomination` | later, same pipeline |

## What moves into the generated model

Race (skin, ears, tusks, horns, beard, hooves), body proportions, and the full armor set per spec.
Long flowing capes and floor-length robes deform badly with running animations, so the prompts ask for
short capes / robes split for the legs.

## Performance budget

- ≤ 10,000 triangles and **one material** per champion (today: ~20 draw calls per champion; generated: ~1 + weapons).
- Textures resized to **1024 px** (JPEG/WebP inside the GLB), target **≤ 1.5 MB per GLB**.
- Load only the models of the champions in the current match (lazy), not all 20 at startup.
- Fallback: if a GLB is missing or fails to load, the old code-built champion is used.

## Specs, race, gear and weapons

| Spec | Race | Armor in the model | Weapons (code) | Idle |
| --- | --- | --- | --- | --- |
| Mage — Frost | Sun Elf | sapphire robes, ice-crystal shard pauldrons, ice crown, long platinum hair | frost wand + spellbook | Idle_Loop |
| Mage — Fire | Sun Elf | crimson-gold robes, phoenix-feather pauldrons, flame crest, copper hair | fire wand + spellbook | Idle_Loop |
| Rogue — Subtlety | Human | black leathers, hood and face mask, knife bandolier, layered strap pads, ragged short cloak | twin fangs | Crouch_Idle_Loop |
| Rogue — Assassination | Human | dark-green leathers, venom vials, goggled half-mask, one spiked pauldron, poison satchel | twin fangs | Crouch_Idle_Loop |
| Warrior — Protection | Orc | black-iron plate, spiked pauldrons, fur trim, skull belt, chain skirt (**pilot model**) | orc war axe + orc shield (strapped to the forearm) | Idle_Shield_Loop |
| Warrior — Arms | Orc | bare arms, one colossal spiked pauldron on chains, war paint, topknot, bone-and-leather kilt | double-bit great axe | Sword_Idle |
| Berserker — Fury | Dwarf | bare chest with blood runes, blazing hair crest and beard, spiked bracers, chains, fur kilt | twin war axes | Sword_Idle |
| Berserker — Executioner | Dwarf | black-iron half plate, masked horned helm, chain baldric, heavy greaves, black beard | double-bit great axe | Sword_Idle |
| Paladin — Crusader | Human | gilded white plate, sunburst pauldrons, winged helm, white tabard, short cape | sun hammer | Sword_Idle |
| Paladin — Protection | Human | heavy blue-steel plate, layered square pauldrons, visored great helm, blue tabard | holy sword + tower shield | Idle_Shield_Loop |
| Priest — Discipline | Human | white-gold plate over long vestments, winged pauldrons, circlet (halo in code) | sun mace | Idle_Loop |
| Priest — Shadow | Human | deep cowl, tendril pauldrons, violet tattered robes, chained tome (void orb in code) | sun mace | Idle_Loop |
| Shaman — Elemental | Orc | wolf-skull helm, grey fur mantle, carved totem on the back, bone fetishes | one-hand storm mace + spirit-mask relic | Idle_Loop |
| Shaman — Enhancement | Orc | wolf-pelt hood with wolf head, storm pauldrons, lightning bracers, mail kilt | twin storm axes | Sword_Idle |
| Hunter — Beastmaster | Jungle Troll | beast skull on one shoulder, fur and feathers, tooth necklace, quiver, red mohawk | bow | Idle_Loop |
| Hunter — Sharpshooter | Jungle Troll | wide feathered hat, long leather coat, bolt bandolier, steel bracers | war longbow | Idle_Loop |
| Necromancer — Summoner | Undead | skull pauldrons, bone crown, rib-cage harness, spine on the back, rotting robes | bone staff | Idle_Loop |
| Necromancer — Curser | Undead | violet cowl, chains, tattered high collar, lantern of souls on the belt | bone staff | Idle_Loop |
| Druid — Feral | Bull-folk | fur and leather harness, claw gauntlets, great-cat pelt on the shoulders, fang belt, horns, hooves | – (claws) | Idle_Loop |
| Druid — Restoration | Bull-folk | antler crown in bloom, bark-and-moss pauldrons, robe of leaves, horns, hooves | druid staff | Idle_Loop |

## Creatures (second batch)

These are not humanoids, so the UAL clips do not apply. Each is rigged in Studio with its own body type and
animated with Tripo's animation presets (walk / run / idle / attack / death where available); the clips ship
inside the GLB and replace the procedural gait of `beasts.js` / `minions.js` for that creature.

| Creature | Used by | Rig type | Needs |
| --- | --- | --- | --- |
| Cat form (great cat) | Druid — Feral (and Cat form for all druids) | quadruped | idle, walk/run (gallop), pounce/claw attack, death |
| Bear form (cave bear) | Druid — Bear form | quadruped | idle, walk/run, maul or rear-up attack, death |
| Ghoul | Necromancer — summon | humanoid (UE5) | uses the UAL zombie clips (`Zombie_Idle_Loop`, `Zombie_Walk_Fwd_Loop`, `Zombie_Scratch`) |
| Abomination | Necromancer — Summoner big summon | humanoid (UE5) | same zombie clips |
| **Silverback gorilla** (new hunter pet, replaces the jungle cat) | Hunter — Beastmaster | humanoid or quadruped (rig check decides) | idle, knuckle-walk/run, chest-beat or slam attack, death |

All designs are original fantasy archetypes — prompts never name another game, its races or characters.
