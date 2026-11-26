# Runefall Arena — Classes & Specs (design draft)

Status: **draft for discussion**. Nothing here is implemented yet; numbers are starting points for the balance lab.
Source: Discord brainstorm (joel_141, icecooldd) plus the six existing classes.

---

## 1. How specs work

- Every class has **2 specs** (talent choices). You pick the spec on the class screen, before the match.
- A spec changes: **passive**, **basic attack**, **3–4 of the 6 abilities**, the **signature (slot 6)**, a few **stats**,
  and the **look** (weapon, armor colours, effects). Every spec has its own icon and colour.
- **2 abilities per class are shared** by both specs, so the class still feels like itself.
- **Decided:** the spec is **locked for the whole match** (picked before the match, no changes between rounds).
- **Decided:** bots have a spec too, **selectable in the lobby like the class** (or left on random).
- **Decided:** both specs of a class are balanced to the **same power** (~50% in the lab); you pick by playstyle.

### How it looks on the class screen

```
┌──────────────────────────── CHOOSE YOUR CHAMPION ────────────────────────────┐
│  [Mage] [Rogue] [Warrior] [Berserker] [Priest] [Shaman] [Necro] [Hunter] [Druid] │
│                                                                              │
│   ┌──────────── 3D model (turntable) ────────────┐   MAGE                     │
│   │  model swaps weapon/colours when you click   │   Ranged caster · Mana     │
│   │  a spec card on the right                    │                            │
│   └──────────────────────────────────────────────┘   CHOOSE A SPEC            │
│                                                      ┌─────────────────────┐  │
│                                                      │🔥 FIRE   (selected) │  │
│                                                      │ Mobile burst, DoTs  │  │
│                                                      │ ◆ Blazing Step      │  │
│                                                      │ ◆ Fireball ◆ Meteor │  │
│                                                      └─────────────────────┘  │
│                                                      ┌─────────────────────┐  │
│                                                      │❄ FROST              │  │
│                                                      │ Static, big crits   │  │
│                                                      │ ◆ Ice Lance ◆ ...   │  │
│                                                      └─────────────────────┘  │
│   Ability bar preview: [auto][1][2][3][4][5][6]  (hover = tooltip)            │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Spec cards**: icon, name, a one-line role tag ("Mobile burst" / "Turret, big crits"), and 3 headline abilities.
- **Rating bars** (health / damage / mobility / defense / healing) update per spec.
- **In the lobby and on nameplates**: the spec icon shows next to the class icon (e.g. `🔥 Mage`).
- **In game**: spec colour on the unit frame border and the cast bar.

---

## 2. Overview

| Class | Spec A | Spec B | Resource | Range |
|---|---|---|---|---|
| Mage | 🔥 **Fire**: mobile, burst + burning, less raw damage | ❄ **Frost**: turret caster, high damage + crits, 2 blink charges | Mana | Ranged |
| Rogue | 🐍 **Assassination**: poisons and stacking DoTs | 🗡 **Subtlety**: stealth, ambushes, big crits | Energy + combo points | Melee |
| Warrior | ⚔ **Arms**: two-handed sword, executes, bleeds | 🛡 **Protection**: sword and shield, peel, interrupts | Rage | Melee |
| Berserker | 🪓 **Fury**: two one-handed axes, fast attacks | 💀 **Executioner**: one two-handed axe, slow huge crits | Rage | Melee |
| Priest | ✦ **Discipline**: shields, heals, utility, a bit of damage | 🌑 **Shadow**: damage over time, fear, drain | Mana | Ranged |
| Shaman | ⚡ **Elemental**: ranged lightning caster + light heals | 🐺 **Enhancement**: two melee weapons, spirit wolf, light heals | Mana | Ranged / Melee |
| **Necromancer** (new) | 💀 **Summoner**: one undead minion fights for you | ☠ **Curser**: stacking curses, "martyr" scaling | Soul energy (mana-like) | Ranged |
| **Hunter** (new) | 🐾 **Beastmaster**: pet + bow, lower shot damage | 🎯 **Sharpshooter**: no pet, heavy crossbow, high shot damage | Focus | Ranged |
| **Druid** (new) | 🐾 **Feral**: switch Cat (rogue-like) / Bear (tank) | 🌳 **Restoration**: tree form healer, lots of mobility | Mana (+ energy/rage in forms) | Melee / Ranged |

Ideas 9 ("Demonology") and 10 ("one with crazy DoTs") are covered by the Necromancer's two specs
(Summoner = pet class, Curser = DoT class), so no separate Warlock class is needed for now.

Shaman note (idea 4, "melee and ranged / heal, both together"): both Shaman specs keep a light heal,
so the Shaman stays the hybrid. Elemental leans ranged, Enhancement leans melee.

---

## 3. Classes in detail

Ability slots: **Auto** = basic attack, **1–5** = abilities, **6** = signature (ultimate).
"Shared" = both specs have it.

### 🔮 Mage — ranged caster, mana, 1000 hp, cloth

| | 🔥 Fire | ❄ Frost |
|---|---|---|
| Identity | Never stands still: casts on the move, keeps the target burning | Turret: long casts, hard-hitting crits, controls the enemy |
| Look | Crimson/gold robes, flaming staff head, embers trail when moving | Ice-blue robes, crystal staff, frost mist at the feet, icy shoulder shards |
| Passive | **Kindling**: instant fire spells leave *Burning* (stacks 3x); Blazing Step cooldown −1 s per crit | **Shatter**: +50% crit chance against frozen/rooted targets; crits deal +75% instead of +50% |
| Auto | Fire Bolt (fast, 24 dmg, can be used while moving) | Frost Bolt (slow 2 s swing, 34 dmg, 15% slow) |
| 1 | **Fireball**: 1.5 s cast, 110 dmg + Burning | **Ice Lance**: 2 s cast, 170 dmg, guaranteed crit on frozen |
| 2 | **Flame Burst**: instant, 70 dmg (usable while moving) | **Glacial Nova** (shared): roots nearby enemies 3 s |
| 3 | **Glacial Nova** (shared) | **Frostbite**: instant, 60 dmg + slows 50% 4 s |
| 4 | **Blazing Step**: dash 10 yd leaving a fire trail; 2 charges | **Arcane Shift** (shared): blink; **2 charges** (idea 6) |
| 5 | **Mana Ward** (shared): absorb shield | **Mana Ward** (shared) |
| 6 | **Meteor**: 1 s cast, a meteor falls after 1.5 s, 220 dmg AoE + knockdown | **Arcane Comet**: 2.5 s cast, 300 dmg + stun (the current signature) |

Fire = less damage per cast, but it all works while moving. Frost = biggest single hits in the game, but you must stand still.

### 🗡 Rogue — melee, energy + combo points, 1050 hp, leather

| | 🐍 Assassination | 🗡 Subtlety |
|---|---|---|
| Identity | Poison everything, then keep running: damage keeps ticking | Hide, open from stealth, delete the target with crits |
| Look | Dark green leathers, green dripping fangs (current daggers), poison vial belt | Black/purple leathers, hood and mask, smoke wisps, curved shadow blades |
| Passive | **Venom Mastery**: autos apply *Deadly Poison* (DoT, stacks 5x); each poison on the target = +4% damage | **Shadow Dance**: leaving stealth gives +25% crit chance for 4 s; crits refund 10 energy |
| Auto | Twin slashes (apply poison) | Twin slashes |
| 1 | **Viper Strike** (shared): builder + poison | **Viper Strike** (shared) |
| 2 | **Envenom**: finisher, consumes poison stacks for burst | **Gutting Edge**: finisher, big crit damage (current) |
| 3 | **Crippling Poison**: next 3 hits slow 50% | **Ambush**: from stealth or Fade only, 180 dmg, always crits from behind |
| 4 | **Skull Crack** (shared): stun finisher | **Skull Crack** (shared) |
| 5 | **Shadow Leap**: 20 yd teleport (current) | **Fade**: vanish, re-enter stealth (current, shorter cd) |
| 6 | **Plague Cloud**: poison cloud at the target, all poisons tick 2x faster for 6 s | **Death Mark**: delayed detonation (current signature) |

### ⚔ Warrior — melee, rage, 1380 hp, plate (decided: Warrior gets Arms + Protection too)

| | ⚔ Arms | 🛡 Protection |
|---|---|---|
| Identity | Two-handed sword, bleeds, execute | Sword and shield, protect the partner, interrupts (current kit) |
| Look | Huge greatsword, red tabard, no shield | Current look: runesword + crested kite shield |
| Passive | **Executioner**: +40% damage to targets below 30% hp | **Shieldwall** (current team-play passive) |
| 6 | **Bladestorm Leap**: leap + spinning strike | **Steel Tempest** (current) |

Shared: Rending Blow, Bull Rush. Arms adds Mortal Cleave, Execute, Overpower; Protection keeps Shield Slam, Iron Bulwark and gains *Intervene* (dash to an ally, absorb the next hit).

### 🪓 Berserker — melee, rage, 1180 hp, fur/leather, Bloodrage passive in both specs (idea 1)

| | 🪓 Fury (two one-handed axes) | 💀 Executioner (one two-handed axe) |
|---|---|---|
| Identity | Fast flurries, many small hits, lifesteal | Slow, heavy swings, huge crits |
| Look | Current: two bearded axes | One massive two-handed axe with skull, bigger pauldron, slower swing animations |
| Passive | **Bloodrage** + **Frenzy**: each hit +3% attack speed (stacks 10x) | **Bloodrage** + **Heavy Hands**: autos 3.2 s, but 25% crit chance and crits +100% |
| Auto | Twin Axe Hacks, 1.6 s | Cleave, 3.2 s, 85 dmg |
| 1 | **Rending Axes** (shared): bleed | **Rending Axes** (shared) |
| 2 | **Whirling Hack**: 4 quick hits | **Skullsplitter**: 2 s wind-up, 260 dmg, cannot be dodged |
| 3 | **Hurled Axe**: root (current) | **Ground Breaker**: cone slam, knockdown 1 s |
| 4 | **Skull-Splitter Leap** (shared) | **Skull-Splitter Leap** (shared) |
| 5 | **Undying Rage** (current) | **Iron Hide**: 30% damage reduction, 6 s |
| 6 | **Berserk** (current) | **Headtaker**: execute, guaranteed crit below 35% hp |

### ✦ Priest — ranged, mana, 1050 hp, cloth (idea 7)

| | ✦ Discipline | 🌑 Shadow |
|---|---|---|
| Identity | Shields, strong heals, utility (purge, fear), a little damage | Damage dealer: DoTs, drain life, fear |
| Look | Current white/silver/gold, halo, sun mace | Dark purple robes, tentacle-like shadow wisps, cracked halo, void orb |
| Passive | **Atonement**: 40% of damage you deal heals your lowest-health ally | **Shadowform**: +15% shadow damage, −15% damage taken; cannot use holy heals |
| Auto | Holy Spark (current) | Mind Spike, 30 dmg, applies *Shadow Word* stack |
| 1 | **Mend** (heal) | **Shadow Word: Pain**: DoT 120 over 12 s |
| 2 | **Divine Aegis** (shared): shield | **Divine Aegis** (shared) |
| 3 | **Blinding Light** (shared): disorient | **Blinding Light** (shared), shadow-coloured |
| 4 | **Purify**: dispel / purge | **Vampiric Drain**: channel, deals damage and heals you |
| 5 | **Leap of Faith**: pull an ally to you | **Psychic Scream**: fear nearby enemies 3 s |
| 6 | **Halo of Judgment** (current) | **Void Eruption**: detonates all your DoTs at once |

### ⚡ Shaman — hybrid, mana, 1150 hp, mail (ideas 4 and 5)

| | ⚡ Elemental | 🐺 Enhancement |
|---|---|---|
| Identity | Ranged lightning caster with totems and a light heal | Two weapons in melee, summons a spectral wolf, light heal |
| Look | Current: storm axe + fire orb, wolf-skull helm, glowing runes | Two short storm axes, wolf-pelt cloak, lightning crackling on the weapons |
| Passive | **Static Charge**: every 4th cast arcs to a second enemy | **Maelstrom**: melee hits build charges; at 5, the next spell is instant |
| Auto | Static Shock (current ranged) | Stormstrike swings, 1.4 s, melee |
| 1 | **Lightning Lash** (current) | **Stormstrike**: 2 hits, lightning damage |
| 2 | **Magma Burst** (current) | **Lava Lash**: hit + fire DoT |
| 3 | **Healing Surge** (shared): light heal | **Healing Surge** (shared) |
| 4 | **Quake Totem** (current) | **Gale Dash** (current) |
| 5 | **Stoneskin Totem** (current) | **Earthbind Totem**: slow zone |
| 6 | **Fire Spirit** (current) | **Spirit Wolf**: summons a ghostly wolf for 12 s that bites the target and slows it |

### 💀 Necromancer — NEW, ranged only, soul energy, 1000 hp, cloth (ideas 8–11, 13, 16)

Class rules: **only ranged**, built to **kite**. Takes melee damage like every other caster (no armor bonus).
Damage comes **mostly from DoTs and minions**, almost no direct burst.

Look: an original undead sorcerer: grey-green skin, exposed jaw and bones, torn dark robes, glowing
green eyes, bone staff with a floating skull. (Inspired by classic fantasy undead; keep the design original,
not a copy of another game's race.)

| | 💀 Summoner | ☠ Curser |
|---|---|---|
| Identity | One undead minion fights for you; you reshape it during the fight. It dies fast in AoE | "Crazy DoTs": stack curses, enemies take more damage per curse, but you take more too (martyr) |
| Look | Bone armor, cage of ribs on the shoulders, skulls orbit the staff | Black/purple rags, chains, cursed sigils floating around the hands |
| Passive | **Bound Servant**: you always have **one** minion (max 1 pet rule). It re-rises 8 s after dying; it takes +50% AoE damage | **Martyr's Curse**: each of your curses on a target gives +6% damage taken for them, and +3% damage taken for you (max 5 curses) |
| Auto | Bone Bolt, ranged 26 dmg | Hex Bolt, ranged 20 dmg, applies a short curse |
| 1 | **Raise Ghoul**: your minion becomes a fast melee ghoul (bites, applies Disease DoT) | **Curse of Agony**: DoT that ramps up over time |
| 2 | **Corpse Explosion**: sacrifice the minion for AoE damage + DoT (it re-rises later) | **Curse of Weakness**: target deals 15% less damage |
| 3 | **Bone Spear** (shared): DoT + slow | **Bone Spear** (shared) |
| 4 | **Grave Step** (shared): short teleport backwards | **Grave Step** (shared) |
| 5 | **Bone Shield**: your minion absorbs 30% of the damage you take for 6 s | **Soul Siphon**: drain HP from every cursed enemy |
| 6 | **Abomination**: the minion mutates into a huge tanky abomination for 15 s (hook pull + cleave) | **Doom**: after 8 s deals damage based on the number of curses on the target |

### 🏹 Hunter — NEW, ranged, focus, 1100 hp, leather/mail (ideas 12 and 14)

Look: original tall, tusked jungle warrior: lean build, long ears, tusks, tribal paint, bone jewellery,
feathered mohawk. (Fantasy jungle troll; keep it original.)

| | 🐾 Beastmaster | 🎯 Sharpshooter |
|---|---|---|
| Identity | A pet does part of the damage; shots hit softer | No pet, but heavy crossbow shots hit much harder |
| Look | Short bow, fur cloak, pet: big striped jungle cat or raptor | Heavy crossbow, scope, leather coat with bolt bandolier |
| Passive | **Pack Leader**: pet has 50% of your hp, attacks your target; −20% shot damage | **Steady Aim**: standing still 1 s gives +30% damage and +15% crit |
| Auto | Quick Shot, 1.4 s, 22 dmg | Bolt, 2.2 s, 48 dmg |
| 1 | **Kill Command**: pet lunges, big bite | **Aimed Shot**: 2 s cast, 190 dmg |
| 2 | **Serpent Sting** (shared): poison DoT | **Serpent Sting** (shared) |
| 3 | **Disengage** (shared): jump backwards | **Disengage** (shared) |
| 4 | **Intimidation**: pet stuns 1.5 s | **Concussive Bolt**: slow 50% |
| 5 | **Mend Pet / Bestial Bond**: heal pet, share damage | **Freezing Trap**: trap that freezes the first enemy |
| 6 | **Stampede**: 3 spirit beasts charge the target | **Piercing Volley**: a line shot that hits everything in a line, ignores shields |

### 🌳 Druid — NEW, shapeshifter, 1200 hp, leather (idea 15)

Look: original large horned bull-folk: hooves, horns, braided mane, wooden totems and leaf charms.
(Inspired by minotaur-style fantasy races; keep it original.) Forms: **cat** (sleek panther), **bear**
(armored brown bear), **tree** (walking treant with leaf canopy).

| | 🐾 Feral | 🌳 Restoration |
|---|---|---|
| Identity | Melee shapeshifter: Cat = rogue-like damage, Bear = tank | Healer in tree form, still some damage, very mobile |
| Form switch | **1 = Cat Form, 2 = Bear Form**, instant, 1.5 s cooldown; the ability bar changes with the form | **Tree Form** toggle: +30% healing, slower movement; caster form for damage |
| Passive | **Primal Instinct**: switching forms removes roots and slows | **Wild Growth**: heals over time stack 3x; each heal tick gives 5% movement speed |
| Cat (energy) | Rake (bleed), Shred (big hit from behind), Pounce (stun from stealth), Prowl (stealth) | — |
| Bear (rage) | Maul, Thrash (AoE bleed), Frenzied Regen (self heal), Roar (fear) | — |
| Resto spells | — | Rejuvenation (HoT), Regrowth (heal + HoT), Moonfire (DoT), Entangling Roots, **Wild Charge** (dash / leap to an ally) |
| 6 | **Berserk Instinct**: 8 s, both forms get +30% damage and CC immunity | **Tranquility**: channel, big group heal |

---

## 4. Races (cosmetic first)

New races requested: undead (Necromancer), jungle troll (Hunter), bull-folk (Druid). Proposal:

- **Decided: fixed race per class.** Necromancer = undead, Hunter = jungle troll, Druid = bull-folk;
  the six existing classes stay human. Races carry no stat bonuses (balance stays per class and spec).
- Models: the current champions use the CC0 Quaternius base characters. Undead, troll and bull-folk need
  new or modified models (horns, tusks, hooves, skeletal parts), which means new assets. **Downloads need
  your approval** before I add any.
- Keep the designs original. They can feel like classic fantasy races, but must not copy a specific
  game's races, art or names.

---

## 5. Suggested build order

1. ✅ **Spec system** (data + class screen UI + lobby/nameplate icon) with the existing 6 classes:
   the current kits become one spec each, so only one new spec per class needs to be built.
2. Second spec for each existing class (Fire/Frost, Assassination/Subtlety, Arms/Protection,
   Fury/Executioner, Discipline/Shadow, Elemental/Enhancement).
3. **Pet/minion system** (shared by Necromancer Summoner, Hunter Beastmaster, Shaman Spirit Wolf).
4. **Hunter**, then **Necromancer**, then **Druid** (form switching is the biggest new system).
5. Balance lab pass after each step (1v1 + 2v2, every spec).

## 6. Decisions and open questions

Decided:
- Specs are locked per match.
- Warrior gets Arms + Protection.
- Fixed race per class (old classes human; Necromancer undead, Hunter troll, Druid bull-folk).
- Build order: spec system + second spec for the 6 existing classes first.
- ✅ **First spec built: Berserker Executioner** (slow two-handed axe, big crits). Final numbers in `js/data/classes.js` (balanced to Fury in the lab).
- Both specs of a class have equal power; you pick by playstyle.
- Bots: class and spec selectable in the lobby (or random).
- **Max 1 pet/minion per player** (Necromancer Summoner, Hunter Beastmaster, Shaman Spirit Wolf).
  The Summoner therefore has one minion that it reshapes (ghoul / explosion / abomination).
