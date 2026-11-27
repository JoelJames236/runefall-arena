# 02 — Champion model sheets (20 specs)

One sheet per spec: race, size, silhouette, armour, colours, what glows, what the model must **not** contain, and
the generation prompt. Items are in `03-weapons-and-sockets.md`, motions in `05-animations.md`, effects in
`06-spells-and-vfx.md`.

---

## 1. Rules for every champion model

### 1.1 Generation pose (for a clean auto-rig and exact sockets)

- **T-pose**, arms straight out at shoulder height, **palms facing down**, fingers straight and slightly apart
  (≈ 8°), **thumbs pointing forward at 45°**, wrists straight. (Clean fingers = all 15 finger joints per hand; today
  8 of 21 rigs miss finger joints.)
- Feet flat, shoulder-width apart, toes forward; legs straight; head straight, looking forward, mouth closed.
- **Empty hands**: no weapon, shield, staff, book, orb, torch or floating object anywhere. Gauntlets are fine.
- Symmetric pose (asymmetric armour is fine).
- No cloth below the knee that joins the legs: robes are split front/back/sides into panels ending at the knee or
  shin; capes end at the waist or are short tabards. No loose hair below the shoulder blades; hair is a solid sculpted
  mass (no strands, no alpha cards).
- Things that belong to the body **are** modelled: quivers, satchels, lanterns, vials, back totems, belts, trophies,
  pauldrons, helmets, horns, tusks, tails.

### 1.2 Mesh and texture targets

| Item | Target |
|---|---|
| Triangles (body, LOD0) | **11,000** (retopology target; today ~9.2–10.2 k) |
| LOD1 / LOD2 | 5,500 / 2,200 (made locally, `07-performance.md`) |
| Materials | **1** (the whole champion, items included after assembly) |
| Texture | body in the **left 1024×1024** of a 2048×1024 atlas: base colour, packed ORM + emissive mask, normal |
| Style | hand-painted stylised look: lighting painted into the base colour (warm top light, cool shadow), strong edge highlights on metal, large readable shapes; low-frequency normal map only |
| Joints | UE5 Mannequin auto-rig (≈ 76–80) + sockets (`03` §3); **reject** a rig with a missing finger or a hand bone without a skinned `middle_01` |

### 1.3 Size (fit by the head, not the bounding box)

Today the fit uses the whole bounding box (helmet crests, horns and hats count), so heights drift. New rule: scale
so the **`head` joint** sits at the race's head-joint height:

| Race | Head joint (m) | Overall to the skull (m) | Posture (procedural) | Classes |
|---|---|---|---|---|
| Human | 1.72 | 1.92 | upright | Rogue, Paladin, Priest |
| Sun Elf | 1.78 | 1.98 | upright, slender | Mage |
| Orc | 1.80 | 2.02 | hunch 0.14 | Warrior, Shaman |
| Dwarf | 1.38 | 1.55 | upright, very wide | Berserker |
| Jungle Troll | 1.88 | 2.10 | hunch 0.24 ×1.7, knees −0.22 | Hunter |
| Undead | 1.68 | 1.88 | hunch 0.16 | Necromancer |
| Bull-folk | 1.98 | 2.20 | hunch 0.12 | Druid |

Hitboxes don't change (sim `HITBOX` r 0.55, h 1.95).

### 1.4 Heroic proportions (role model: WoW's chunky, readable silhouettes)

Hands and feet 1.2× real; shoulders and pauldrons 1.6–2× shoulder width on plate wearers; heads slightly large
(1/7 of the height for humans, 1/6 for dwarves); weapons 1.3–1.4× real. Every spec must be recognisable **from
above** at 25 m: the top-down silhouette (pauldrons, helm, hood, hat, antlers) carries the identity, and at least
**25 % of the visible top surface** is in the spec's main colour.

### 1.5 Emissive mask

A greyscale mask (alpha of the ORM texture) marks glowing parts; their glow takes the painted colour and pulses by
a shader uniform (`07-performance.md` §4). Keep glow to small accents (eyes, runes, crystals, gems): ≤ 3 % of the
texture area.

### 1.6 Prompt frame

```
Stylized hand-painted fantasy game character, heroic proportions, full body. [RACE]. [ARMOUR]. [COLOURS].
T-pose: arms straight out at shoulder height, palms down, fingers straight and slightly apart, thumbs forward,
empty hands holding nothing, feet shoulder-width apart, facing forward, mouth closed. Solid sculpted hair.
No weapon, no shield, no cape or robe below the knees, robe split into panels.
```

Prompts never name a game, a faction or a character.

---

## 2. The 20 sheets

Colours are `main / second / accent / glow`. "Silhouette" = what must read from above.

### Mage — Frost (Sun Elf) · `mage_frost`

| | |
|---|---|
| Body | slender, tall sun elf, long swept-back ears, sharp features, long platinum hair in a high tail |
| Armour | sapphire robes split into 4 panels to the knee over silver leggings, high stiff collar, **ice-crystal shard pauldrons** (3 shards each), crown of ice spikes, silver bracers, a belt with a sapphire clasp |
| Colours | `#2a4fa8` / `#e8eef8` / `#c0c8d8` silver / glow `#8fd8ff` |
| Glows | crown crystals, pauldron shards, belt clasp, eyes faint blue |
| Silhouette | spiked crown + crystal pauldrons |
| Items | `frostwand` (`grip_r`), `tome_frost` (`grip_l`) · set `wd` |
| Prompt core | "tall slender elf mage with long pointed ears and long platinum hair in a high ponytail, sapphire-blue robe split into four panels to the knees over silver leggings, high collar, pauldrons made of jagged ice crystals, a crown of ice spikes, silver bracers, glowing pale-blue crystals" |

### Mage — Fire (Sun Elf) · `mage_fire`

| | |
|---|---|
| Body | as Frost, copper-red hair in a braided crest |
| Armour | crimson-and-gold robes split to the knee, **phoenix-feather pauldrons** sweeping up, flame-shaped gold circlet with a ruby, gold-trimmed sash, scorched hem |
| Colours | `#a8201a` / `#e8b040` gold / `#3a1a12` / glow `#ff7a2a` |
| Glows | circlet ruby, feather tips, sash runes |
| Silhouette | upswept feather pauldrons + flame circlet |
| Items | `firewand`, `tome_fire` · set `wd` |
| Prompt core | "tall slender elf mage with long pointed ears and copper-red braided hair, crimson and gold robe split into four panels to the knees, large pauldrons of upswept phoenix feathers, a flame-shaped gold circlet with a ruby, glowing orange ember runes on the sash" |

### Rogue — Subtlety (Human) · `rogue_subtlety`

| | |
|---|---|
| Body | lean, athletic human (female build, as today) |
| Armour | black layered leathers, **deep hood and a cloth face mask** (eyes only), knife bandolier across the chest, layered strap pads on one shoulder, a ragged short cloak to the waist, wrapped forearms, soft boots |
| Colours | `#16141c` / `#3a3448` / `#7a3aff` violet trim / glow `#9a6aff` |
| Glows | eyes faint violet, buckle runes |
| Silhouette | pointed hood, asymmetric shoulder |
| Items | `fang` + `fangL` · set `dg` |
| Prompt core | "lean athletic human rogue woman, black layered leather armor, deep pointed hood and a cloth mask covering the lower face, knife bandolier across the chest, layered leather strap pads on the left shoulder, ragged short cloak to the waist, wrapped forearms, soft boots, thin violet trim" |

### Rogue — Assassination (Human) · `rogue_assassination`

| | |
|---|---|
| Body | as Subtlety, red hair in buns |
| Armour | dark-green leathers, **goggled half-mask**, a single **spiked pauldron**, venom vials on the belt and a poison satchel on the hip, bracers with hidden-blade housings |
| Colours | `#1a2a14` / `#3a4a2a` / `#c0a060` brass / glow `#9be36a` |
| Glows | vials, goggle lenses |
| Silhouette | spiked single pauldron + hair buns |
| Items | `fang` + `fangL` (poison-channel variant via texture) · set `dg` |
| Prompt core | "lean human rogue woman with red hair in two buns, dark green leather armor, brass goggles and a leather half-mask, one spiked leather pauldron on the right shoulder, glowing green venom vials on the belt, a poison satchel on the left hip, bracers" |

### Warrior — Protection (Orc) · `warrior_protection`

| | |
|---|---|
| Body | huge green-skinned orc, tusks, topknot, scarred |
| Armour | black-iron plate, **massive spiked pauldrons**, fur trim, skull belt buckle, chainmail skirt to the knee, heavy gauntlets (left forearm plated flat for the shield), iron boots |
| Colours | `#2a2624` iron / `#6a4a2a` fur / `#b02a1a` red cloth / glow — |
| Glows | none (eyes faint red) |
| Silhouette | the widest pauldrons in the game |
| Items | `orcaxe` (`grip_r`), `orcshield` (`shield_l`) · set `sns` |
| Prompt core | "huge muscular green-skinned orc warrior with tusks and a black topknot, black iron plate armor with massive spiked pauldrons, fur trim, a skull belt buckle, chainmail skirt to the knees, heavy iron gauntlets, iron boots, red cloth strips" |

### Warrior — Arms (Orc) · `warrior_arms`

| | |
|---|---|
| Body | orc, bare muscular arms with red war paint, topknot |
| Armour | **one colossal spiked pauldron on chains** (left), bone-and-leather kilt, leather chest strap, bracers, fur boots |
| Colours | `#5a7a3a` skin / `#5a3a22` leather / `#b02a1a` war paint / glow — |
| Silhouette | asymmetric giant pauldron, bare arms |
| Items | `greataxe_orc` (`grip_r` + `grip2`) · set `th` |
| Prompt core | "muscular green-skinned orc berserker-warrior with tusks, black topknot and red war paint on bare arms, one colossal spiked iron pauldron on the left shoulder held by chains, leather chest strap, bone and leather kilt to the knees, bracers, fur boots" |

### Berserker — Fury (Dwarf) · `berserker_fury`

| | |
|---|---|
| Body | broad dwarf, bare chest with **blood-red rune tattoos**, blazing orange hair crest and huge braided beard |
| Armour | spiked iron bracers, chains across the chest, fur kilt, iron knee guards, heavy boots |
| Colours | `#c88a6a` skin / `#e85a18` hair / `#3a2a1a` fur / glow `#ff3a1a` |
| Glows | rune tattoos (pulse with Bloodrage) |
| Silhouette | flaming crest + wide shoulders, no pauldrons |
| Items | `warAxe` + `warAxeL` · set `dw` |
| Prompt core | "very broad stocky dwarf berserker with a bare muscular chest covered in glowing red rune tattoos, blazing orange mohawk crest and a huge braided orange beard, spiked iron bracers, chains across the chest, fur kilt, iron knee guards, heavy boots" |

### Berserker — Executioner (Dwarf) · `berserker_executioner`

| | |
|---|---|
| Body | broad dwarf, black braided beard |
| Armour | black-iron half plate, **horned masked helm**, chain baldric, heavy greaves, a red executioner's hood-cloth under the helm, skull trophies on the belt |
| Colours | `#1e1c1c` / `#5a1010` blood red / `#8a8a90` steel / glow `#ff2a1a` |
| Glows | helm eye-slits red |
| Silhouette | horned helm |
| Items | `headsman_axe` · set `th` |
| Prompt core | "very broad stocky dwarf executioner with a long black braided beard, black iron half plate armor, a horned iron helmet with a face mask and glowing red eye slits, a dark red hood cloth under the helmet, chain baldric, heavy greaves, skull trophies on the belt" |

### Paladin — Crusader (Human) · `paladin_crusader`

| | |
|---|---|
| Body | strong human, short beard |
| Armour | gilded white plate, **sunburst pauldrons**, winged helm (open face), white tabard with a gold sun to the knee, short white cape to the waist |
| Colours | `#f0ece0` white / `#e0b040` gold / `#8a2a1a` / glow `#ffd86a` |
| Glows | sun emblem, pauldron centres |
| Silhouette | winged helm + sunburst pauldrons |
| Items | `sunhammer` · set `th` |
| Prompt core | "strong human paladin with a short brown beard, gilded white plate armor, round sunburst-shaped gold pauldrons, an open-faced helmet with gold wings, white tabard with a gold sun emblem to the knees, short white cape to the waist, glowing gold sun emblem" |

### Paladin — Protection (Human) · `paladin_protection`

| | |
|---|---|
| Body | strong human |
| Armour | heavy **blue-steel plate**, layered square pauldrons, visored great helm with a gold crest, blue tabard to the knee, the left forearm plated flat (shield), gold trim |
| Colours | `#2a3a6a` blue steel / `#c0c8d8` / `#e0b040` gold / glow `#ffe8a0` |
| Glows | visor slit faint gold, tabard sigil |
| Silhouette | square layered pauldrons + crested great helm |
| Items | `holysword` (`grip_r`), `towershield` (`shield_l`) · set `sns` |
| Prompt core | "strong human knight in heavy blue steel plate armor, layered square pauldrons, a closed visored great helm with a gold crest, blue tabard to the knees with a gold sigil, gold trim, flat plated left forearm" |

### Priest — Discipline (Human) · `priest_discipline`

| | |
|---|---|
| Body | human woman, hair in buns |
| Armour | white-gold plate bodice over vestments split to the shin, **winged pauldrons**, gold circlet, long sleeves with gold cuffs (halo is an effect, not modelled) |
| Colours | `#f4eedc` / `#e0b84a` / `#6a8ac8` soft blue / glow `#ffd98a` |
| Glows | circlet gem, cuff runes |
| Silhouette | winged pauldrons |
| Items | `sun_scepter` · set `mc` |
| Prompt core | "human priestess with hair in two buns, white and gold plate bodice over long white vestments split into panels to the shins, small gold wing-shaped pauldrons, a gold circlet with a gem, long sleeves with gold cuffs, soft blue trim" |

### Priest — Shadow (Human) · `priest_shadow`

| | |
|---|---|
| Body | gaunt human, pale |
| Armour | **deep cowl**, pauldrons of curling tendrils, tattered violet robes split to the shin, a chained book-shaped clasp on the chest (decoration), black gloves (void orb is an effect) |
| Colours | `#3a1e52` / `#14101c` / `#8a8aa0` pale / glow `#9a50ff` |
| Glows | eyes under the cowl, chest clasp |
| Silhouette | cowl + tendril pauldrons |
| Items | `void_scepter` · set `mc` |
| Prompt core | "gaunt pale human shadow priest, deep hood shading the face with glowing violet eyes, pauldrons of curling dark tendrils, tattered violet robes split into panels to the shins, a chained clasp on the chest, black gloves" |

### Shaman — Elemental (Orc) · `shaman_elemental`

| | |
|---|---|
| Body | orc, long black hair, beads |
| Armour | **wolf-skull helm**, grey fur mantle, a **carved totem on the back**, bone fetishes, leather and mail kilt, copper bracers, storm runes painted on the arms |
| Colours | `#5a6a3a` skin / `#7a7a7a` fur / `#b07a3a` copper / glow `#6ae0ff` |
| Glows | back-totem eyes, arm runes |
| Silhouette | wolf skull + back totem |
| Items | `stormmace` (`grip_r`), `relic` (`grip_l`) · set `mc` |
| Prompt core | "green-skinned orc shaman with long black hair and beads, a wolf skull worn as a helmet, grey fur mantle, a carved wooden totem strapped to the back, bone fetishes, leather and mail kilt, copper bracers, glowing cyan storm runes painted on the arms" |

### Shaman — Enhancement (Orc) · `shaman_enhancement`

| | |
|---|---|
| Body | orc, bald with war braids |
| Armour | **wolf-pelt hood with the wolf's head** on top, storm-cloud pauldrons (metal shaped like clouds), lightning-etched bracers, mail kilt, fur boots |
| Colours | `#5a6a3a` / `#5a6070` steel / `#d8d0c0` pelt / glow `#9ae8ff` |
| Glows | bracer etchings, wolf-head eyes |
| Silhouette | wolf head hood |
| Items | `stormaxe` + `stormaxeL` · set `dw` |
| Prompt core | "muscular green-skinned orc shaman warrior, a white wolf pelt worn as a hood with the wolf's head on top, steel pauldrons shaped like storm clouds, bracers etched with glowing lightning, mail kilt, fur boots" |

### Hunter — Beastmaster (Jungle Troll) · `hunter_beastmaster`

| | |
|---|---|
| Body | tall lanky jungle troll, blue skin, long tusks, red mohawk, long arms |
| Armour | **beast skull on the right shoulder**, fur and feathers, tooth necklace, leather wraps, **quiver on the back over the right shoulder** (arrows modelled), beast-hide kilt |
| Colours | `#4a8a9a` skin / `#7a5a3a` leather / `#c03a1a` mohawk / glow — |
| Silhouette | mohawk + shoulder skull |
| Items | `bow` (`grip_l`), arrows via `nock_r` · set `bw` |
| Prompt core | "tall lanky blue-skinned jungle troll hunter with long tusks and a red mohawk, a large beast skull worn on the right shoulder, fur and feathers, a tooth necklace, leather wraps, a quiver full of arrows on the back over the right shoulder, beast hide kilt" |

### Hunter — Sharpshooter (Jungle Troll) · `hunter_sharpshooter`

| | |
|---|---|
| Body | as Beastmaster, braided hair |
| Armour | **wide-brimmed feathered hat**, long leather coat split at the back to the knee, bolt bandolier, steel bracers, quiver on the back |
| Colours | `#4a8a9a` / `#4a3a2a` coat / `#a0a8b0` steel / glow — |
| Silhouette | wide hat |
| Items | `longbow` · set `bw` |
| Prompt core | "tall lanky blue-skinned jungle troll marksman with long tusks and braided hair, a wide-brimmed leather hat with feathers, a long leather coat split into panels to the knees, an arrow bandolier, steel bracers, a quiver on the back over the right shoulder" |

### Necromancer — Summoner (Undead) · `necromancer_summoner`

| | |
|---|---|
| Body | undead, exposed jaw and ribs in places, glowing green eyes |
| Armour | **skull pauldrons**, bone crown, rib-cage harness over rotting robes split to the shin, a spine relic on the back |
| Colours | `#2a3a24` robe / `#d8d0b0` bone / `#5a4a3a` / glow `#7aff6a` |
| Glows | eyes, skull-pauldron eye sockets |
| Silhouette | bone crown + skull pauldrons |
| Items | `bonestaff_summoner` · set `st` |
| Prompt core | "undead necromancer with grey-green rotting skin, partly exposed jaw and ribs, glowing green eyes, skull pauldrons, a crown of bones, a rib-cage harness over tattered dark green robes split into panels to the shins, a spine relic on the back" |

### Necromancer — Curser (Undead) · `necromancer_curser`

| | |
|---|---|
| Body | undead, glowing violet eyes |
| Armour | **violet cowl with a tattered high collar**, chains wrapped around the body, a **lantern of souls on the belt** (modelled, glow), long gloves |
| Colours | `#3a2050` / `#1a1420` / `#8a8a90` chains / glow `#b070ff` |
| Glows | eyes, lantern |
| Silhouette | high collar + cowl |
| Items | `bonestaff_curser` · set `st` |
| Prompt core | "undead warlock with grey rotting skin and glowing violet eyes, violet hood with a tall tattered collar, chains wrapped around the body, a glowing soul lantern hanging from the belt, tattered violet robes split into panels to the shins, long gloves" |

### Druid — Feral (Bull-folk) · `druid_feral`

| | |
|---|---|
| Body | massive bull-folk: bovine head with curved horns, nose ring, hooves, tail |
| Armour | fur and leather harness, **great-cat pelt over the shoulders**, claw gauntlets (3 blades each — the claws are part of the model), fang belt, leather kilt |
| Colours | `#6a4a2a` fur / `#2a2a2a` cat pelt / `#c08a3a` / glow `#8ad86a` |
| Glows | druidic tattoos on the arms |
| Silhouette | horns + cat pelt |
| Items | none (claws modelled) · set `dw` idle with `claw` hands; in play the Cat / Bear forms (`04`) |
| Prompt core | "massive bull-headed humanoid druid with curved horns, a nose ring and hooves, brown fur, a black great-cat pelt draped over the shoulders, leather harness, gauntlets with three claw blades each, a belt of fangs, leather kilt, glowing green tattoos on the arms" |

### Druid — Restoration (Bull-folk) · `druid_restoration`

| | |
|---|---|
| Body | bull-folk, as Feral |
| Armour | **antler crown in bloom** (flowers), bark-and-moss pauldrons, a robe of leaves split to the knee, vine bracers |
| Colours | `#6a4a2a` / `#4a6a2a` moss / `#e8c8d8` blossom / glow `#8ae86a` |
| Glows | blossoms, vine bracers |
| Silhouette | flowering antlers |
| Items | `druidstaff` · set `st` |
| Prompt core | "massive bull-headed humanoid druid with curved horns and hooves, a crown of antlers covered in blossoms, pauldrons of bark and moss, a robe of leaves split into panels to the knees, vine bracers, glowing green flowers" |

---

## 3. What stays out of the model (effects, not mesh)

Discipline halo · Shadow void orb · frost / fire motes · Bloodrage steam · stealth shimmer · every buff shell ·
Fire Spirit · cast circles. They are drawn by the effect system (`06`) on sockets, so they never cost a mesh draw.

## 4. Acceptance per model

1. Prompt result in T-pose with clean, separate fingers; no item in or near the hands.
2. Retopology to 11,000 ± 500 triangles; rig: all 15 finger joints per hand are **skin joints**, `hand_*` → `middle_01`
   0.08–0.14 m (×height/1.95).
3. In the viewer: every clip of its set plays without the hands passing through pauldrons; the sockets (`03` §3)
   fitted and saved; LODs made; atlas assembled; file ≤ 2.5 MB.
4. Side by side with the old model in `viewer.html`; triangle and draw counts printed.
