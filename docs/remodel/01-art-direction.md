# 01 — Art direction

## 1. Role model: what we take from WoW, and what we don't

| We take | We don't take |
|---|---|
| **Stylised, hand-painted look**: lighting and wear painted into the colour texture, big readable shapes, little reliance on fine normal detail | any name, race, faction, character, item, spell or logo |
| **Heroic proportions**: big hands, feet, heads and shoulders; oversized pauldrons and weapons (≈1.3–1.4× real) | exact race designs (our races: Sun Elf, Orc, Dwarf, Jungle Troll, Undead, Bull-folk keep their own features) |
| **One silhouette per spec**, readable from above | its armour sets, weapon models or textures |
| **School colours**: every magic school has one colour and shape language | its spell effects one to one |
| **Weapon attachment** on named sockets with the item authored around its grip; per-stance animation sets (ready, attack variants, parry, directed / omni casts, roar) with fallbacks | its animations or animation data |
| **Arena readability**: crowd-control icons over heads, hostile ground effects with a red edge, buffs that don't hide the body | |

## 2. Style rules

1. **Shapes before detail**: a champion reads by 3–4 big shapes (helm/hood/hat, pauldrons, torso, weapon). Small
   details are painted, not modelled.
2. **Colour**: each spec has a main colour covering ≥ 25 % of what the camera sees (shoulders, head, upper back),
   a second colour, a metal or trim accent and at most one glow colour. Values are pushed: dark darks, bright
   highlights on edges, warm top light, cool bounce in the shadows.
3. **Materials**: painted. Metal = strong painted highlights + moderate metalness; cloth and leather = matte
   (roughness 0.8–0.95); skin = soft. No mirror-like surfaces (the colosseum's golden sunset light would blow out).
4. **Glow**: small accents only (eyes, runes, gems, crystals), pulsing; never large glowing areas on bodies.
5. **Thin things**: nothing thinner than 2 cm (aliasing at arena distance) — straps, chains, strings are painted or
   thickened. Bow strings are the exception (2 quads, `03` §4.4).
6. **No physics cloth, no alpha-card hair**: capes to the waist, robes in knee-length panels, hair as a solid mass.

## 3. Races (look keys)

| Race | Key features | Skin | Posture |
|---|---|---|---|
| Sun Elf | tall, slender, long swept ears, sharp face | fair warm | upright, elegant |
| Human | balanced heroic build | varied | upright |
| Orc | huge, green, tusks, small eyes, heavy brow | green `#5a7a3a` | slight hunch |
| Dwarf | short, as wide as tall, huge beard, big hands | ruddy | upright, planted |
| Jungle Troll | very tall, lanky, long arms, long tusks, mohawk / braids | blue-teal `#4a8a9a` | strong hunch, bent knees |
| Undead | gaunt, rotting skin, exposed bone in places, glowing eyes | grey-green | slight hunch |
| Bull-folk | massive bovine head, horns, hooves, tail | brown fur | slight hunch |

## 4. Colour by class (unchanged game colours) and by spec

| Class | Game colour | Spec A main | Spec B main |
|---|---|---|---|
| Mage | `#7fb8ff` | Frost sapphire `#2a4fa8` | Fire crimson `#a8201a` |
| Rogue | `#9be36a` | Subtlety black `#16141c` | Assassination green `#1a2a14` |
| Warrior | `#e0604a` | Protection black iron `#2a2624` | Arms skin + red paint |
| Berserker | `#d83a2a` | Fury skin + orange hair | Executioner black iron `#1e1c1c` |
| Paladin | `#f5d76e` | Crusader white-gold `#f0ece0` | Protection blue steel `#2a3a6a` |
| Priest | `#ffe9a8` | Discipline white-gold `#f4eedc` | Shadow violet `#3a1e52` |
| Shaman | `#4ad8ff` | Elemental fur grey + copper | Enhancement steel + white pelt |
| Hunter | `#a8d84a` | Beastmaster leather + red mohawk | Sharpshooter coat brown |
| Necromancer | `#7aff6a` | Summoner rot green `#2a3a24` | Curser violet `#3a2050` |
| Druid | `#e8a05a` | Feral fur + black pelt | Restoration moss + blossom |

## 5. Fit with the arenas

The Kingsreach Colosseum (golden sunset, sun intensity 3.6, exposure 0.86) and Thornwater Gorge are the test
lights. Every model is checked in both, plus the class-screen light: no spec may turn into a dark blob in the
colosseum's shadowed half or blow out to white in the sun.
