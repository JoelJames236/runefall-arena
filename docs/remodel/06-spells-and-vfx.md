# 06 — Spells and visual effects

One entry for **every basic attack (21) and ability (106)**: the clip it plays, what the hands do, how it travels,
how it lands and what stays on the target. Plus the effect system that draws it all within a fixed budget.

Reference: WoW's spell language — each school has one unmistakable colour and shape (frost = pale blue crystals and
mist, fire = orange flame and smoke, holy = gold light and rays, shadow = violet-black smoke and tendrils, nature =
green leaves and motes …); casts build energy in the hands over a rune circle; every crowd-control state has its
own instantly readable icon-like effect over the victim; ground effects are flat decals with a clear edge. Our
shapes, runes and colours are our own.

---

## 1. Problems today (inventory 2026-11-27)

- **Wrong school colours**: every root is ice (also nature roots and physical roots), every non-holy DoT shows fire
  (poison, bleed, shadow, curses), every "shard" projectile (arrows, bone spears, bolts) has an icy-blue core,
  nature casts get a cyan circle, cast-start bursts are white except for 5 spells, muzzle bursts are coloured per
  class (Fire Mage purple, Shadow Priest gold, Curser green).
- **Shared looks**: one hex "damage reduction" cylinder for 5 different abilities; Fireball / Flame Burst / Magma
  Burst share an impact; Judgment / Hammer of Light / Sentinel's Shield share one; most projectiles use the default
  impact.
- **No visual at all**: Kill Command impact, Intimidation, Bestial Wrath, Berserk Instinct, Curse of Weakness and
  Doom while active, Hex, every heal-over-time tick under 30, Ambush, Shadowform, Steady Aim, Maelstrom, Fire
  Spirit's cast, Wild Pounce's landing, `shockwave`, `treeform`.
- **Promised but not drawn**: Seraph's Step wings, Bone Shield's orbiting bones, Shadow Priest's void orb.
- **Leaks / cost**: zone geometries and materials are never disposed (`vfx.js:411`); the ☠ / ⚑ / ⚖ canvas textures
  are made per buff and never disposed; Static Shock allocates beam tubes on ~30 % of frames; `shards()` makes a new
  material per call; projectiles dispose only materials. Particles are GL points (max 256 px, no rotation, no
  stretch).

---

## 2. Effect system (performance first)

**Implemented (Phase 1, js/render/fx/)**: atlas (painted at load from `atlas-layout.js`, 64 cells — the 60 of §2.1 +
noise, hex pattern, claw, cracked heart; KTX2 bake pending), particle pools (additive 6,000 / alpha 2,000, GPU-simulated,
soft particles through the composer's depth), mesh FX, ribbons (trails, beams, chains), decals (hostile edge rule),
pooled lights (shared with the old VFX), the §4 building blocks as an API, `window.__fx` (`demo`, `stats`, `bench`,
`showAtlas`). Today it draws only the weapon trails of **assembled** champions (code-built weapons: off — their tip
markers made giant sheets); every ability still uses the old VFX until Phase 6. Measured: 1 draw in a match, ≤ 9 with
every part, 0.006–0.011 ms per update, nothing allocated during a match.

| Part | Design | Draws |
|---|---|---|
| **Atlas** | one **2048² KTX2** texture, 8 × 8 cells of 256²; flipbooks in 2 × 2-cell blocks (4 × 4 frames of 128²). Contents in §2.1 | — |
| **Particles** | GPU-instanced quads (not GL points): per particle position, velocity, size curve, rotation, 3-key colour gradient, flipbook cell, mode (billboard / velocity-stretched / flat on the ground), soft-particle depth fade. Ring buffers, written in place — **no allocation per frame** | 2 (additive pool **6,000**, alpha pool **2,000**) |
| **Mesh FX** | instanced primitives with one FX shader (fresnel, scrolling atlas mask, dissolve, colour per instance): `ring`, `shell` (sphere), `cylinder`, `cone`, `disc`, `ribbon` (trails, beams, chains — camera-facing strips, no tubes) | ≤ 8 (one per primitive × blend mode in use) |
| **Ground decals** | instanced quads on the floor with a signed-distance shader: edge ring, fill, runes from the atlas, rotation, progress sweep (for timers) | 1 |
| **Projectile meshes** | a few small meshes (icicle, rock, bone spear, rune disc, spirit skull) as `InstancedMesh` per kind; thrown weapons reuse the item's own mesh | ≤ 3 |
| **Weapon trails** | ribbon from `trail_base` to `tip`, 10 samples, 0.12 s, on attacks and melee abilities only | in `ribbon` |
| **Lights** | 4 pooled point lights for flashes (as today); nothing persistent per projectile (emissive + bloom) | — |
| **Overhead icons** | ☠ / ⚑ / ⚖ / curse sigils as **atlas cells** on the decal/particle path (no canvas textures) | in particles |

**Budgets**: ≤ 8,000 live particles; ≤ 14 VFX draw calls in a 2v2; ≤ 0.6 ms CPU per frame for VFX; nothing
created or disposed during a match (pools made at load). Quality levels keep today's factors: low 0.45 /
medium 0.75 / high 1 for particle counts; low turns soft particles and the distortion off.

**Readability** (arena rule): an enemy's ground effect always shows its edge in **hostile red-orange** (`#ff5a3a`)
whatever the school; a friendly one in its school colour. Self-buff shells stay ≤ 0.25 opacity with a fresnel edge
so the body is still read. Crowd control is drawn **above the head** (`head_top`) and at the feet, never covering
the face.

### 2.1 Atlas contents (64 cells)

soft dot · hard dot · spark streak · ember · smoke puff (flipbook 16) · fire (flipbook 16) · flame tongue · frost
crystal ×3 · snowflake · mist · ice crack · lightning strip ×2 · rune ring ×2 · cast circle (12 runes + sigil) ·
hexagram · holy ray · sunburst · feather · leaf ×2 · petal · vine · thorn · poison bubble · drip · blood drop ·
shadow tendril ×2 · void eye · skull (☠) · flag (⚑) · scales (⚖) · curse sigil ×3 · bone shard ×2 · stone chip ×2 ·
dust · shockwave ring · star (stun) · wisp · moon disc · arrow streak · footprint (paw) · gradient ramps ×4.

---

## 3. School palette

Every effect uses its **school**, not its class. Colours as `core / glow / dark`:

| School | Core | Glow | Dark | Shapes | Used by |
|---|---|---|---|---|---|
| Frost | `#eafaff` | `#8fd8ff` | `#2a6aa8` | crystals, shards, mist, snowflakes, cracks | Frost Mage |
| Fire | `#fff2c0` | `#ff7a2a` | `#8a1a08` | flame flipbook, embers, smoke | Fire Mage, Lava Lash, Magma Burst, Fire Spirit |
| Arcane | `#f4e8ff` | `#b98cff` | `#4a2a8a` | rune rings, star motes, spinning glyphs | Mage shared (bolt, shift, ward, comet) |
| Holy | `#fffbe8` | `#ffd86a` | `#a87a1a` | rays, sunbursts, feathers, gold motes | Paladin, Discipline Priest |
| Shadow / void | `#e8d0ff` | `#9a50ff` | `#1a0830` | tendrils, black smoke, void eye | Shadow Priest |
| Necrotic | `#eaffd8` | `#7aff6a` | `#1a3a12` | bone shards, green smoke, skulls | Necromancer Summoner |
| Curse | `#f0d8ff` | `#b070ff` | `#2a1040` | chains, sigils, violet smoke | Necromancer Curser |
| Storm | `#ffffff` | `#6ae0ff` | `#1a4a8a` | lightning strips, sparks, wind streaks | Shaman (lightning, gale; the spirit wolf has its own pale spirit-blue, `04` §3.4) |
| Earth | `#ffe2b0` | `#d09040` | `#4a3018` | stone chips, dust, cracks | Shaman totems, Ground Breaker, leaps |
| Nature (life) | `#f4ffd8` | `#8ae86a` | `#2a5a18` | leaves, petals, vines, fireflies | Restoration Druid, heals |
| Moon | `#f0f0ff` | `#c8b0ff` | `#3a3070` | moon disc, silver motes | Moonfire |
| Poison | `#e8ffb0` | `#9be36a` | `#2a4a10` | bubbles, drips, green mist | Assassination Rogue |
| Shadowstep | `#d8c8ff` | `#7a3aff` | `#0a0418` | black smoke, afterimage | Subtlety Rogue |
| Blood / rage | `#ffd0b0` | `#ff3a1a` | `#5a0808` | blood drops, steam, red embers | Berserker, Warrior bleeds |
| Physical | `#ffffff` | `#fff0d8` | `#6a6a70` | sparks, dust, weapon trail, gun smoke | all melee hits, Sharpshooter shots |
| Beast | `#fff0c0` | `#e8a040` | `#5a3a10` | claw streaks, paw prints, roar ring | Hunter pet, Feral |

**Rule for the cast-start burst, muzzle flash, cast circle, projectile, impact and DoT**: always the school of
*that* ability (fixes the per-class colours).

---

## 4. Shared building blocks

| Id | What it looks like | Size / count / time |
|---|---|---|
| `cast_circle` | rune circle decal at the feet, school colour, runes rotate 0.6 rad/s, fills clockwise with cast progress | r 1.1 m; fades in 0.15 s |
| `hand_gather` | particles drawn from 0.6 m into `fx_core` / `spell_*`, orb grows 0.15 → 0.5 m with progress | 30/s at 0 % → 90/s at 100 % |
| `muzzle` | burst at the release point (weapon `tip` or `spell_*`), school colour | 14 particles + 1 flash 0.08 s |
| `melee_hit` | sparks + weapon-trail-coloured arc at the contact point, blood only on flesh targets (not on undead → bone dust, not on spirits → wisps) | 10 particles (26 on crit) |
| `crit` | white-gold shockwave ring + sphere flash + 1 light | 0.18 s |
| `trail_<school>` | weapon trail tinted by the ability's school (physical = white-warm) | 0.12 s |
| `telegraph` | ground decal: edge (hostile red-orange / friendly school colour), fill grows with the timer | per zone |
| `shell` | fresnel sphere/cylinder around the body | opacity ≤ 0.25 |
| `stun` | 3 small golden stars circling `head_top` | r 0.28, 2.5 rad/s |
| `disorient` | 4 white wisps spiralling around the head + a faint white veil over the eyes | — |
| `root_<school>` | frost: 8 ice spikes + frost ring; nature: vines rising and wrapping to the knees; earth/physical: stone shackles clamping the feet | 0.25 s grow, hold, 0.3 s break |
| `frozen` | full ice block shell (faceted, refractive-looking via fresnel + crack texture), pose frozen | breaks into 12 ice chunks |
| `silence` | violet-white rune ring over the mouth/neck, slowly turning | r 0.18 |
| `slow_<school>` | heavy motes sinking at the feet in the school colour (frost blue, poison green, earth amber, storm cyan) | 6/s |
| `dot_<school>` | fire: small flames on the body; bleed: blood drips; poison: green bubbles rising; shadow: violet tendrils; curse: violet chains flicker; holy: gold embers; moon: lilac sparks | 6–10/s |
| `hot` | small green leaves / gold motes rising (heals over time — today invisible) | 4/s |
| `heal_land` | spiral of school motes rising around the target + a soft flash | 40 particles (gold on crit) |
| `speed` | streaks at the feet in the ability's school | 8/s |
| `death` | soul wisp rising from the chest + burst (as today, coloured by the victim's class) | 1.2 s |

---

## 5. Per class, per ability

Column **Clip** refers to `05-animations.md`. "→" = travels to the target. Sizes in metres, speeds from the sim.

### 5.1 Mage — Frost (Sun Elf) · Arcane bolts + Frost spells

| Ability | Clip | Hands / cast | Delivery | Impact | Persistent |
|---|---|---|---|---|---|
| **Arcane Bolt** (auto, 42 m/s) | `wd_atk_1..3` | arcane `muzzle` at the wand `tip` | **arcane bolt**: lilac core 0.18 with 3 orbiting star motes, short star trail | arcane pop: 18 sparks + rune flash | — |
| **Frost Lance** (cast 1.3 s) | `wd_pre_*` → `wd_rel_dir` | frost `cast_circle`, frost `hand_gather` at the wand crystal, snowflakes drift | **icicle** mesh 0.9 long, frost glow, mist trail | 28 crystal shards, frost flash, mist, ice crack decal 1.2 m (fades 1 s) | slow → `slow_frost` |
| **Frostbite** (instant, 52 m/s) | `wd_rel_quick` | small frost `muzzle` | short icicle 0.5 | frost pop + `root_frost` when it roots | — |
| **Glacial Nova** (8 m, root 3 s) | `wd_area` | — | ring of ice spikes erupting outward r 0 → 9 in 0.25 s, frost mist sweep, 60 crystals | per enemy: `frozen` legs → `root_frost` | ice spikes melt 1 s |
| **Arcane Shift** (blink 13 m) | `cm_blink_in` | — | lilac afterimage at the start (a fading arcane silhouette of the body, 0.3 s), 20-particle line between | arcane burst + rune ring at the end | — |
| **Mana Ward** (absorb 380) | `wd_buff` | the tome's sigil flares | — | — | arcane `shell` r 1.0: hexagonal rune pattern, 0.2 opacity, ripples where hits land, cracks at 30 % left, shatters into lilac glass |
| **Arcane Comet** (cast 2.0 s, stun) | `wd_pre_omni_*` → `wd_rel_heavy` | arcane `cast_circle` r 1.5, orb grows above the head, 2 rune rings orbit it | **comet** 1.05 with a spinning rune ring and long star trail; shatters on cover ("Blocked") | star burst 60, rune shockwave r 8, pillar 9 high, 70-intensity flash, then `stun` | — |

### 5.2 Mage — Fire (Sun Elf)

| Ability | Clip | Hands / cast | Delivery | Impact | Persistent |
|---|---|---|---|---|---|
| **Fire Bolt** (auto, 46 m/s) | `wd_atk_1..3` | **fire** `muzzle` (today purple) | small fireball 0.28, ember trail | small fire burst | Burning → `dot_fire` |
| **Fireball** (cast 1.5 s, while moving) | `wd_pre_*` (upper over running legs) → `wd_rel_dir` | fire `cast_circle` follows the feet, flames gather at the wand | fireball 0.62, flame flipbook core, smoke + ember trail | 40-particle fire burst, smoke, scorch decal 1.4 m | — |
| **Flame Burst** (Ignite) | `wd_rel_quick` | fire muzzle | fast flame bolt 0.45 | fire pop | Ignite → `dot_fire` |
| **Flame Ring** (8 m, slow) | `wd_area` | — | ring of fire racing outward to r 8, leaving a burning circle 1.5 s | — | `slow_fire` (ember motes) |
| **Blazing Step** (dash 11 m) | `cm_dash_fwd` | — | burning footprints along the path (decals, 2 s), flame burst at start | fire ring at the end | — |
| **Mana Ward** | `wd_buff` | as Frost but the shell's runes are fire-orange | | | |
| **Meteor** (cast 1.0, zone r 5, lands at 1.4 s) | `wd_pre_omni_*` → `wd_rel_calldown` | fire pillar of light at the caster | telegraph decal (hostile edge), a burning rock (mesh 0.9) falls from 25 m with a fire + smoke tail, its shadow grows on the decal | 90 debris, crater decal 3 m (3 s), 14 rocks, flash 90, pillar; `cm_knockdown` | burning ground 1.5 s |

### 5.3 Rogue — Subtlety / Assassination (Human)

| Ability | Clip | Hands / cast | Delivery | Impact | Persistent |
|---|---|---|---|---|---|
| **Twin Slashes** (auto) | `dg_atk_1..3` | physical trail (Assassination: poison-green trail) | melee | `melee_hit`, green arc | Assassination: Deadly Poison stack → `dot_poison` (today fire) |
| **Viper Strike** | `dg_stab` | — | melee | thrust spark + small combo-point pip that flies to the rogue's chest | — |
| **Gutting Edge** (finisher) | `dg_gut` | — | melee | blood spray scaled by combo points, gold arc at 4+ | bleed → `dot_bleed` |
| **Skull Crack** (stun, interrupt) | `dg_pommel` | — | melee | gold impact star at the jaw + a white ring at `head_top` | `stun` |
| **Shadow Leap** (behind target) | `dg_ambush_in` | — | black smoke puff at the start, **shadowstep afterimage** (dark silhouette 0.3 s), violet smoke at the end | — | `speed_shadowstep` 2 s |
| **Fade** (stealth 4 s) | `dg_stealth_enter` → `dg_stealth_idle/walk` | smoke wrap | — | — | allies: body at 0.3 opacity with a violet fresnel edge; enemies: invisible, a faint heat-shimmer silhouette within 5 m (today 0.12 flat) |
| **Ambush** (buff after Fade) | — | — | — | — | the daggers' edges glow violet (`trail_shadowstep`) while ready (today nothing) |
| **Death Mark** (6 s, 8 m) | `dg_mark` | — | violet streak from the dagger tip to the target | ☠ **atlas icon** above the head + red ground ring pulsing faster as it nears 6 s | pop: red pillar + burst (`death_mark_pop`) |
| **Envenom** | `dg_envenom` | — | melee | green splash + poison drips | — |
| **Crippling Poison** | `dg_hamstring` | — | melee | green slash | `slow_poison`, `dot_poison` |
| **Plague Cloud** (zone r 6, 6 s) | `dg_toss` | — | a glass vial (mesh) arcs to the target and shatters | — | green fog decal + rising poison bubbles; hostile edge for enemies |

### 5.4 Warrior — Protection (Orc) / Arms (Orc)

| Ability | Clip | Hands / cast | Delivery | Impact | Persistent |
|---|---|---|---|---|---|
| **Sword Swing** (auto, Prot) → rename "Axe Swing" | `sns_atk_1..3` | physical trail | melee | `melee_hit` | — |
| **Greatsword Cleave** (auto, Arms) → rename "Great Axe Cleave" | `th_atk_1..3` | heavy trail (wider) | melee | `melee_hit` + dust | — |
| **Rending Blow** (−50 % healing) | `sns_rend` / `th_rend` | blood trail | melee | blood spray | **mortal wound**: red cracked-heart atlas icon over the head + red drips (today generic red motes) |
| **Crippling Slash** (slow 40 %) | `sns_low` / `th_low` | — | melee low | sparks at the knees | `slow_physical`: grey dust at the feet |
| **Bull Rush** (charge, root 1.2 s) | `*_charge_start/loop/hit` | — | dust trail + shoulder shock cone ahead of the shield | shockwave ring + dust, camera shake 0.3 | `root_earth` (stone shackles, not ice) |
| **Iron Bulwark** (−40 % dmg 6 s) | `sns_brace` | stomp ring | — | — | iron-grey **shield wall** `shell`: a curved translucent steel plate in front of the body following its facing, rivets glint (own look, not the shared hex cylinder) |
| **Shield Slam** (interrupt, silence 2.5 s) | `sns_bash` | — | melee | blue-white shield flash, ring | `silence` |
| **Steel Tempest** (whirlwind 4 s) | `sns_whirl` | — | — | each tick: sparks + arc at each enemy hit | a horizontal **blade ring** ribbon r 2.4 following the weapon tip + dust ring on the ground (replaces torus + mesh spin) |
| **Die by the Sword** (−35 % 5 s) | `th_parry` | — | — | — | the weapon glows white-steel, **parry sparks** spray when hit (own look) |
| **Execute** | `th_execute` | — | melee | big blood + crit-style shockwave, screen shake 0.2 | — |
| **Bladestorm** (leap + whirl 3 s) | `th_leap_*` → `th_whirl` | — | leap: dust trail; landing: earth shockwave r 6 | per tick: sparks | blade ring r 2.6, red-steel |

### 5.5 Berserker — Fury / Executioner (Dwarf)

| Ability | Clip | Hands / cast | Delivery | Impact | Persistent |
|---|---|---|---|---|---|
| **Twin Axe Hacks** (auto, Fury) | `dw_atk_*` alternating | red-steel trails | melee | `melee_hit` | — |
| **Great Axe Cleave** (auto, Exec) | `th_atk_1..3` | heavy trail | melee | `melee_hit` + dust | — |
| **Bloodrage** (passive) | — | — | — | — | red steam rising from the shoulders < 75 % HP, eyes glow red < 50 % (keep, re-skin with the blood palette) |
| **Rending Axes** (bleed) | `dw_cross` / `th_rend` | — | melee X | blood spray in an X | `dot_bleed` (today fire) |
| **Headtaker** (Fury) | `dw_double` | — | two hits | blood + red flash on each marker | — |
| **Hurled Axe** (root 2 s) | `dw_throw` | — | the **real axe mesh** spins end over end (18 rad/s); a new axe materializes in the hand with a red flash at `item_show_r` | metal clang sparks | `root_earth` |
| **Skull-Splitter Leap** | `*_leap_*` | — | red-dust trail | landing: earth shockwave r 6, stone chips, cracks decal | — |
| **Undying Rage** (lifesteal 6 s) | `dw_roar` | roar ring | — | — | dark-red pulse in the veins (emissive mask pulse on the body) + red motes flowing from enemies hit into the berserker (lifesteal) |
| **Berserk** (8 s) | `dw_clash` | sparks at the clash | — | — | red ground ring + flames rising off the axes and shoulders |
| **Skullsplitter** (cast 1.0 s) | `th_windup_*` → `th_execute` | **no rune circle** (physical): the axe edge glows hotter red with progress, dust swirls at the feet | melee | massive red shockwave + blood | — |
| **Ground Breaker** (cone 7 m, stun) | `th_ground` | — | a fan of ground cracks and stone spikes racing out in a 120° cone | dust + chips per target | `stun` |
| **Iron Hide** (−25 % 6 s) | `th_brace` | — | — | — | skin turns iron-grey (body tint 30 % + metallic rim), dark-steel flakes orbit |
| **Headtaker** (Exec, signature) | `th_execute` | — | melee | huge blood burst + crit ring when it crits | — |

### 5.6 Paladin — Crusader / Protection (Human) · Holy

| Ability | Clip | Hands / cast | Delivery | Impact | Persistent |
|---|---|---|---|---|---|
| **Dawn Hammer** (auto, Crusader) | `th_atk_1..3` | gold trail | melee | gold burst + sphere flash (as today) | — |
| **Blessed Blade** (auto, Prot) | `sns_atk_1..3` | white-gold trail | melee | `melee_hit` | — |
| **Holy Strike** | `th_execute` | hammer head flares | melee | gold burst, 2 rays, flash | — |
| **Judgment** (20 m, 46 m/s) | `th_point_l` / `sns_point` | gold muzzle at the left palm / sword tip | a **spinning gold rune-disc** (⚖ scales inside) | gold ring + rays | ⚖ atlas icon over the target |
| **Radiant Storm** (8 m) | `th_spin_once` | — | a ring of holy light sweeping 360° with the hammer, gold motes | per target: small sunburst | — |
| **Hammer of Light** (stun, 40 m/s) | `th_throw_l` | — | a **spectral hammer** (the sun-hammer mesh with the holy shader, 0.8 scale) spinning | big gold burst, 5 rays | `stun` |
| **Divine Shield** (immune 3 s) | `th_buff` | light pours down | — | — | gold `shell` r 1.1 with a sun-sigil pattern and rising motes |
| **Divine Wrath** (pillar, 25 m) | `th_buff` (pointing down) | — | 2 pillars of light 16 high on the target, 7 rays | 70-particle burst | **wings of light** on the paladin: 7 feather particles per side in a fan from `back` (as today, re-skinned with atlas feathers) |
| **Shield Slam** (Prot, taunt) | `sns_bash` | — | melee | pale-gold shield flash | ⚑ atlas icon over the target |
| **Sentinel's Shield** (bounces) | `sns_throw_shield` | — | the **real shield mesh** spinning flat, gold trail; bounces to a second enemy as a second flight (not a beam) | gold ring + clang; the shield returns to the hand at `item_show_l` | — |
| **Consecration** (zone r 8, 8 s) | `sns_plant` | — | gold ring + radiant fill spreading from the planted sword | — | consecrated ground decal: gold runes slowly rotating, motes rising (hostile edge for enemies) |
| **Holy Shield** (DR + heal) | `sns_buff` | — | — | — | 3 gold rune-discs orbit the paladin at chest height |
| **Guardian's Resolve** (allies DR, taunt) | `sns_shout` | ring r 15, pillar, rays | — | — | gold cylinder `shell` + ground ring on the paladin; allies get a thin gold `shell` (not the shared hex cylinder) |

### 5.7 Priest — Discipline / Shadow (Human)

| Ability | Clip | Hands / cast | Delivery | Impact | Persistent |
|---|---|---|---|---|---|
| **Holy Spark** (auto, Disc) | `st_atk_1..3` | holy muzzle at the staff's sun disc (`tip`) | gold spark with 4 short rays | gold pop | — |
| **Mind Spike** (auto, Shadow) | `st_atk_1..3` | **void** muzzle (today gold) at the staff's void crystal (`tip`) | violet spike with 2 orbiting black motes | violet crack | — |
| **Sacred Bolt** (cast 1.3) | `st_pre_*` → `st_rel_dir` | holy circle, light gathers at the left palm | gold bolt with a halo ring | burst, 3 rays, flash | Holy Burn → `dot_holy` |
| **Mend** (cast 1.6, heal) | `st_pre_heal_*` → `st_rel_ally` | **holy** circle (today cyan), **gold** cast-start (today green) | a ribbon of gold light arcs from the palm to the ally | `heal_land` (gold) + pillar | — |
| **Divine Aegis** (absorb, ally) | `st_rel_ally` | — | gold motes stream to the ally | — | gold `shell` with 2 crossed rune rings turning (as today, cleaner) |
| **Seraph's Step** (speed + cleanse) | `st_wings` | — | — | cleanse burst | **wings of light** for 2 s (promised, today missing) + gold `speed` streaks |
| **Blinding Light** (9 m, disorient) | `st_omni` | — | white-gold flash sphere r 6, 6 rays | per enemy `disorient` | — |
| **Halo of Judgment** (28 m) | `st_omni` | — | a gold halo ring expanding to r 27 at chest height | enemies: holy burst; allies: `heal_land` | — |
| **Halo** (Disc look) | — | — | — | — | gold halo over the head: `head_top` socket, 2 ribbons (no separate meshes) |
| **Shadow Word: Pain** (DoT) | `st_rel_quick` | void muzzle at the left hand | instant: violet tendril snaps onto the target | — | `dot_shadow` (today fire) |
| **Mind Blast** (cast 1.4, self-heal) | `st_pre_*` → `st_rel_dir` | **void** circle, cast-start violet (today white), black smoke gathers at the temple | violet orb with a void-eye core | violet crack burst; violet motes flow back to the priest (heal) | — |
| **Psychic Scream** (8 m) | `st_scream` | — | violet shockwave ring + screaming void-face particle | per enemy `disorient` (violet wisps instead of white) | — |
| **Void Eruption** | `st_clench` | — | void tendrils burst out of the target's DoTs | violet pillar, 60 burst | — |
| **Shadowform** (passive) | — | — | — | — | **void orb** (promised, `voidOrb` flag unused) floating at `spell_l`, and faint violet smoke at the feet; body slightly darkened (tint 15 %) |

### 5.8 Shaman — Elemental / Enhancement (Orc)

| Ability | Clip | Hands / cast | Delivery | Impact | Persistent |
|---|---|---|---|---|---|
| **Static Shock** (auto, Ele) | `mc_atk_1..3` | storm muzzle + 1 crackle strip | cyan ball with 2 lightning strips flickering (atlas strips, **no tube allocation**) | cyan spark burst | — |
| **Storm Strikes** (auto, Enh) | `dw_atk_*` | cyan-steel trails | melee | sparks | **Maelstrom proc**: a small lightning strip jumps from the axe to the target (today nothing) |
| **Lightning Lash** (cast 1.3, instant hit) | `mc_pre_*` → `mc_rel_dir` | **storm** circle (cyan is right here), relic eyes glow | 2 jagged lightning ribbons with branches from the mace tip to the target, 0.15 s | spark burst + ring + flash | — |
| **Magma Burst** (DoT) | `mc_rel_quick` | fire muzzle | glowing magma rock (mesh) with smoke | **own impact**: molten splash + rock chips (today = Fireball's) | `dot_fire` |
| **Quake Totem** (r 8, erupts 1.2 s) | `mc_area` | — | Quake totem rises; telegraph decal fills with the timer | quake: ground ruptures in a ring, stone spikes, dust, shake 0.6; `cm_knockdown` | totem sinks |
| **Gale Dash** (12 m) | `cm_dash_fwd` | — | wind streaks + swirling air ribbon around the body | — | — |
| **Stoneskin Totem** (r 10, 8 s) | `mc_plant` | — | Stoneskin totem rises | — | green-earth dome `shell` r 10 (0.12 opacity), allies inside: green motes; enemies: `slow_earth` |
| **Fire Spirit** (10 s) | `mc_summon` | fire pillar from the relic | Fire Spirit (04 §3.8) | each bolt: from the spirit; fireball 0.35, ember trail | — |
| **Stormstrike** (2 hits) | `dw_double` | — | melee | lightning strip on each hit (marker `strike` and `hit2`) | — |
| **Lava Lash** | `dw_lash` | the left axe flares orange | melee | molten splash | `dot_fire` |
| **Healing Surge** (cast 1.2) | `dw_pre_*` → `dw_rel_self` | **water/storm** circle, cyan droplets rise | — | `heal_land` with cyan-green water motes | — |
| **Earthbind Totem** (r 9, 8 s) | `dw_plant` | — | Earthbind totem rises | — | tan rotating ring decal + slow-moving dust; enemies `slow_earth` |
| **Spirit Wolf** (12 s) | `dw_roar` | a swirl of pale blue spirit mist at the spawn point | Spirit wolf (04 §3.4): translucent ghost-wolf, mist from paws and tail, glowing pawprints | — | — |

### 5.9 Hunter — Beastmaster / Sharpshooter (Jungle Troll)

| Ability | Clip | Hands / cast | Delivery | Impact | Persistent |
|---|---|---|---|---|---|
| **Quick Shot** (auto, BM, 62 m/s) | `bw_shot` / `bw_shot_2` | string snap, small dust | the **arrow mesh** with a thin white streak (today an ice shard) | wood splinters + `melee_hit` | — |
| **Blunderbuss Shot** (auto, SS, 70 m/s; `classes.js`: "Heavy Arrow" → rename) | `rf_shot` / `rf_shot_2` | muzzle flash + thick white smoke puff at `muzzle` (smoke flipbook, drifts and fades 1.5 s) | **`shot`**: a short spread of 5–7 glowing pellet streaks around the sim path (no mesh) | spark + splinter burst | — |
| **Kill Command** | `bw_command` | — | — | the gorilla's slam (`go_command`) lands with a beast shockwave; **today nothing** | — |
| **Serpent Sting** (DoT, BM) | `bw_shot` | — | arrow with a green streak | green splash | `dot_poison` (today fire) |
| **Serpent Shot** (the same ability for the SS; `classes.js` has one shared "Serpent Sting" → per-spec name) | `rf_shot` | poison-green muzzle flash, green-tinged smoke | **`slug`**: a poisoned slug trailing green smoke | green splash + poison bubbles | `dot_poison` |
| **Disengage** (back 12 m) | `cm_dash_back` | — | dust at the take-off, leaf/feather trail | dust at landing | — |
| **Intimidation** (stun) | `bw_command` | — | the gorilla's `go_leap` (or roar ring if it can't reach) | beast roar ring at the target | `stun` (today no effect at all) |
| **Bestial Bond** (heal self + pet) | `bw_bond` | — | a beast-amber ribbon links hunter and pet | `heal_land` on both | — |
| **Bestial Wrath** (frenzy) | `bw_roar` + `go_beat` | roar ring | — | — | hunter and pet: amber-red eyes glow, red steam from the shoulders, the pet grows 10 % (today invisible) |
| **Aimed Shot** (cast 2.0) | `rf_aim_*` | **no rune circle** (physical): a slow-match glow at the pan (`fx_core`), sparks spitting faster with progress, a thin smoke wisp | release: huge muzzle blast + a smoke ring at `muzzle`; a heavy `slug` with a bright tracer streak | big spark burst + splinters | — |
| **Concussive Shot** (slow) | `rf_shot` | — | a heavy `slug` with a blue-white shock ring around it | concussion ring at the head | `slow_physical` |
| **Freezing Trap** (r 2.5, 20 s) | `rf_toss` | — | the trap (mesh) arcs to the spot and opens | spring: jaws snap, frost burst | victim: `frozen` (today white disorient motes) |
| **Piercing Blast** (instant line; `classes.js`: "Piercing Volley" → rename) | `rf_power` | huge muzzle blast + smoke at `muzzle` | a cone of pellet streaks racing along the line to the target with a shockwave ring travelling with them (not a beam; drawn on the existing `volley` fx event) | spark burst per target | smoke lingering along the line 2 s |

### 5.10 Necromancer — Summoner / Curser (Undead)

| Ability | Clip | Hands / cast | Delivery | Impact | Persistent |
|---|---|---|---|---|---|
| **Bone Bolt** (auto, Summoner) | `st_atk_1..3` | necrotic muzzle at the staff skull | spinning **bone shard** mesh with green smoke (today ice core) | bone splinters + green puff | — |
| **Hex Bolt** (auto, Curser) | `st_atk_1..3` | curse muzzle (today green) | violet sigil bolt | violet crack | **Hex**: small violet sigil icon over the head (today nothing) |
| **Soul Rot** (cast 1.3, DoT) | `st_pre_*` → `st_rel_dir` | necrotic circle, green souls spiral into the skull | green skull-faced orb with a smoke trail | green burst | `dot_necrotic` (green smoke + bone flecks) |
| **Corpse Explosion** (6 m) | `st_clench` | — | the ghoul plays `gh_swell` | green-bone blast r 6, shards, ring, flash; the ghoul's corpse is gone | — |
| **Bone Spear** (slow, DoT) | `st_rel_quick` | — | **bone spear** mesh 1.2 long, spinning slowly | bone splinters | `slow_necrotic`, `dot_necrotic` |
| **Grave Step** (blink back 10 m) | `cm_blink_in` | — | sinks into green-black smoke at the start (decal: grave crack) | rises out of a grave crack decal | — |
| **Bone Shield** (−30 % 6 s) | `st_buff` | — | — | — | **6 bone shards orbiting** the body at chest height (promised, today the hex cylinder); one cracks off per big hit |
| **Abomination** (summon) | `st_summon` | green ground runes | the ghoul's corpse pile → `ab_spawn` | — | — |
| **Curse of Agony** (DoT) | `st_rel_quick` | curse muzzle | violet sigil snaps onto the target | — | `dot_curse`: violet chains flickering around the body |
| **Curse of Weakness** | `st_rel_quick` | curse muzzle | sigil | — | a cracked-sword sigil icon over the head + drooping grey motes (today nothing) |
| **Soul Siphon** (all cursed in 30 m) | `st_siphon` | — | violet soul ribbons drawn from each target into the necromancer's chest | — | `heal_land` (violet) on the caster |
| **Doom** (8 s) | `st_rel_quick` (heavy: `st_curse`) | — | a large violet sigil descends onto the target | — | a **countdown sigil** over the head (decal progress sweep, 8 s) — today nothing; at 8 s: `doom_pop` (violet pillar) |

### 5.11 Druid — Restoration / Feral (Bull-folk) · Nature + Moon

| Ability | Clip | Hands / cast | Delivery | Impact | Persistent |
|---|---|---|---|---|---|
| **Wrath** (auto, Resto) | `st_atk_1..3` (tree: `tr_rel_dir`) | nature muzzle at the seed-light | green-gold seed of light with petals trailing | leaf burst | — |
| **Rejuvenation** (HoT) | `st_rel_ally` | — | petals stream to the ally | soft green flash | `hot`: green leaves rising, 4/s (today nothing under 30 healing) |
| **Regrowth** (cast 1.4) | `st_pre_heal_*` → `st_rel_ally` | **nature** circle (today cyan), leaves gather at the staff | a ribbon of vines and light to the ally | `heal_land` (green) | short `hot` |
| **Moonfire** (DoT) | `st_calldown` | — | a beam of moonlight from above onto the target | lilac pillar + burst | `dot_moon` (lilac sparks; today fire) |
| **Wild Charge** (13 m) | `cm_dash_fwd` | — | leaf trail + hoof dust | — | — |
| **Entangling Roots** (root 3 s) | `st_ground` (tree: `tr_root_grasp`) | — | roots burst from the ground at the target | — | `root_nature`: vines wrap to the knees (today ice) |
| **Tree of Life** (10 s) | `st_summon` → `tr_shift_in` → `tr_bless` | leaves spiral up the druid | light and petals pour from the tree's raised open hands over the group | form swap in a burst of leaves (the model unfolds) | fireflies around the tree, palm sap lines glow, the group HoT shows `hot` on every ally; every tree heal leaves from `spell_r/l` (the palms) |
| **Claws** (auto, cat) | `ca_atk_1..3` | claw trails: 3 thin ribbons from `claw_fl/fr` | melee | 3 parallel **claw streaks** (atlas) + `melee_hit` | — |
| **Rake** | `ca_rake` | — | melee | claw streaks + blood | `dot_bleed` (today fire) |
| **Shred** | `ca_shred` | — | 2 hits | 2 claw-streak sets | — |
| **Ferocious Bite** | `ca_rend` | claw trails | melee (a claw finisher) | two crossing sets of deep claw streaks in an X + blood burst, bigger with combo points | — |
| **Wild Pounce** (leap, stun) | `ca_pounce_*` / `be_pounce_*` | — | leaf + dust trail, claw trails in the air | **landing** dust ring + beast shockwave + claw streaks on the target (today nothing) | `stun` |
| **Bear Form / Cat Form** | form swap | — | — | shapeshift burst: fur/leaf particles + green flash 0.25 s, covers the swap | — |
| **Berserk Instinct** (CC immune) | `ca_roar` / `be_roar` | roar ring | — | — | eyes blaze amber, red-amber steam off the back (today nothing) |
| **Swipe** (auto, bear) | `be_atk_1/2` | — | melee | wide claw streaks | — |
| **Maul** | `be_maul` | — | melee | heavy claw streaks + dust | — |
| **Thrash** (6 m) | `be_thrash` | — | a ring of claw streaks around the bear | dust ring, per target bleed | `dot_bleed` |
| **Frenzied Regeneration** | `be_roar` | — | — | green pulse per tick | `hot` (green) for its duration |

**Coverage**: 21 basic attacks + 106 abilities = every row above (shared abilities listed once per class where
both specs use them the same way).

---

## 6. Persistent states (buffs and debuffs on a champion)

| State | New look | Replaces |
|---|---|---|
| `absorb` (Mana Ward) | arcane hex-rune shell, ripples on hit, cracks at 30 %, shatters | icosphere + wireframe |
| `divine_aegis` | gold shell + 2 crossed rune rings | same idea, cleaner |
| `dr` — per source | Iron Bulwark: steel shield wall · Die by the Sword: glowing steel + parry sparks · Iron Hide: iron skin + flakes · Bone Shield: orbiting bones · Guardian's aura (allies): thin gold shell | one hex cylinder for all 5 |
| `undying` / `lifesteal` | red vein pulse + red motes flowing in | dark-red sphere |
| `divine` | gold sun-sigil shell + motes | gold bubble |
| `holy_shield` | 3 orbiting gold rune-discs | same |
| `guardians_resolve` | gold cylinder + ground ring | same |
| `crusader_power` | wings of light | same (atlas feathers) |
| `taunt` / `judged` / `mark` / `hex` / `weaken` / `doom` | atlas icons over the head (⚑, ⚖, ☠, violet sigil, cracked sword, countdown sigil) | canvas textures (leaking) / nothing |
| `stun` | 3 gold stars at `head_top` + `cm_stun_loop` | shards + head wobble |
| `knockdown` | dust at the fall + stars | — |
| `disorient` | wisps + veil + `cm_disorient_loop` (Shadow: violet wisps) | white motes |
| `frozen` (trap) | ice block shell, pose frozen | white motes |
| `root` | by school: ice / vines / stone shackles | always ice |
| `silence` | rune ring over the mouth + `cm_silence_add` | torus above the head |
| `slow` | by school | pale-blue motes for all |
| `dot` | by school (fire / bleed / poison / shadow / curse / necrotic / moon / holy) | fire for all |
| `hot` | rising leaves / gold motes | nothing |
| `speed` | streaks by school | mint motes |
| `stealth` | ally: 0.3 opacity + violet fresnel edge; enemy: shimmer silhouette ≤ 5 m | flat opacity |
| `spirit` | Fire Spirit creature | sphere + cones |
| `berserk` / `wrath` | red ground ring + flames / amber eyes + steam | ring + flames / nothing |
| `treeform` | the tree model + fireflies | treant primitive, no VFX |
| `ccimmune` | thin white-gold ring at the feet | nothing |
| `ambush` | violet glowing dagger edges | nothing |
| battleground buffs (`flagcarrier`, `sanctuary`, `exposed`, …) | stay as they are in `thornwater.js` | — |

---

## 7. Projectile catalogue (26 kinds)

| Kind | Look | Size | Trail | Impact id |
|---|---|---|---|---|
| `arcane_bolt` | lilac core + 3 orbiting star motes | 0.18 | stars, 4 steps | arcane pop |
| `fire_bolt` | small flame flipbook | 0.28 | embers | fire pop |
| `frost_lance` | icicle mesh | 0.9 long | mist | frost shatter |
| `frostbite` | short icicle | 0.5 | mist | frost pop |
| `arcane_comet` | rune-ringed comet | 1.05 | long stars | comet blast |
| `fireball` | flame flipbook + smoke | 0.62 | smoke + embers | fire blast + scorch |
| `flame_burst` | flame bolt | 0.45 | embers | fire pop |
| `holy_spark` | gold spark + 4 rays | 0.22 | gold motes | holy pop |
| `shadow_bolt` (Mind Spike) | violet spike + 2 black motes | 0.24 | black smoke | void crack |
| `mind_blast` | violet orb, void-eye core | 0.5 | smoke | void blast |
| `sacred_bolt` | gold bolt + halo ring | 0.4 | gold motes | holy burst + rays |
| `static_bolt` | cyan ball + 2 lightning strips | 0.26 | sparks | storm sparks |
| `magma_burst` | magma rock mesh | 0.4 | smoke | molten splash |
| `spirit_bolt` | small fireball from the spirit | 0.35 | embers | fire pop |
| `axe_throw` | the war axe mesh, spinning | item | red streak | metal clang |
| `arrow` | arrow mesh (Beastmaster only) | 0.85 | white streak | splinters |
| `shot` (Blunderbuss Shot) | 5–7 glowing pellet streaks in a spread ±0.25 m around the sim path, velocity-stretched particles, no mesh | 0.04 each | short spark streaks | sparks + splinters |
| `slug` (Aimed Shot, Concussive Shot, Serpent Shot) | one glowing lead slug, velocity-stretched particle, no mesh; tinted per ability (Serpent: green smoke, Concussive: blue-white ring, Aimed: bright tracer) | 0.08 | tracer streak | spark burst |
| `bone_bolt` | bone shard mesh | 0.35 | green smoke | bone splinters |
| `hex_bolt` | violet sigil disc | 0.3 | violet smoke | violet crack |
| `soul_rot` | green skull-faced orb | 0.45 | green smoke | necrotic burst |
| `bone_spear` | bone spear mesh | 1.2 long | bone flecks | bone splinters |
| `wrath` | seed of light + petals | 0.3 | petals | leaf burst |
| `judgment` | spinning gold rune disc | 0.5 | gold motes | holy ring |
| `hammer_of_light` | spectral hammer (item mesh, holy shader) | 0.8× item | gold streak | big holy burst |
| `sentinels_shield` | the tower shield, spinning flat | item | gold streak | clang + gold ring |

Projectile visuals start at the release point (`tip` / `muzzle` / `spell_*` / Fire Spirit) and blend into the sim
path over 0.18 s (as today).

Code rename needed for the Sharpshooter: the projectile kind `crossbow_bolt` (`classes.js` auto, Aimed Shot,
Concussive Shot; `vfx.js` style, `audio.js` `HIT_SOUND`) splits into `shot` (the auto) and `slug` (the two
abilities); Serpent Sting spawns `arrow` for both specs today and needs `slug` when cast by the Sharpshooter.

---

## 8. Budget check (2v2 worst case)

4 champions casting at once, 2 zones, 2 pets, 1 summon, 6 projectiles in flight, 6 persistent states:
≈ 4,500 additive + 900 alpha particles, 14 VFX draws, 4 lights — within §2. Measured today for comparison: a 2v2
frame is **273 draw calls, 0.93 M triangles** (Kingsreach arena, 4 champions, bloom on).
