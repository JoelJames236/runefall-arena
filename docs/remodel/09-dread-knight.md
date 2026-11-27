# 09 — New class: Dread Knight (Frost / Blood)

Status: **blueprint only** (2026-11-27). A new, 11th class, shaped after the role model's **death knight archetype**:
a fallen knight raised from death, bound to runes, fighting in heavy plate with a runeblade. Two specs, as asked:
**Frost = damage** (two runeblades), **Blood = tank** (a two-handed runeblade, self-healing). Working name
**Dread Knight** (`dreadknight`) — our own name, as with every other class and race; the display name can be
changed in one place (`classes.js`).

Everything here follows the other blueprint documents: models `02`, items `03`, animations `05`, effects `06`,
performance `07`, pipeline `08`. All numbers are starting points for the balance lab.

---

## 1. Identity

| | |
|---|---|
| Fantasy | a champion who died, was raised by rune magic and now fights for its own ends: cold, relentless, armoured; it drags enemies to it with spectral chains and turns death magic into frost (Frost) or into its own blood (Blood) |
| Race | **Risen** — a human knight raised from death: pale blue-grey skin, gaunt but strong (not rotting like the Necromancer's Undead), long white hair, dark lips, **glowing eyes** (ice-blue for Frost, crimson for Blood). Upright, imposing posture, no hunch. New entry in `races.js`. Head joint 1.75 m (`02` §1.3) |
| Role | melee; Frost: burst damage and control; Blood: tank who heals from what he deals and takes |
| Resource | **Runic Power** (RP), 0–100, starts at 10, +1 per second; filled by builders, basic attacks (Frost +8, Blood +6) and, for Blood, by damage taken (1 RP per 5 % of max health lost). Unlike rage, dealing damage gives **no** RP (tested: with rage rules the class won 87 % / 78 %) |
| Class colour | steel grey-blue `#a8b4c8` (no other class is grey); spec accents Frost `#7ad0ff`, Blood `#ff3a4a` |
| Emblem | ♞ |
| Shared abilities (both specs) | Grave Chains (pull), Rune Ward (spell shield) |

---

## 2. The specs

All numbers below are **balance-tested** (§8): a prototype of the kit ran in the balance lab against all 20 specs.

### 2.1 Frost (spec 0, default) — damage

| Stat | Value | Compare |
|---|---|---|
| HP / defense / speed | 1330 / 0.135 / 6.9 | Warrior Arms 1350, Fury 1180 |
| Basic attack | **Frostbound Strikes**: alternating runeblade hits, 34 damage every 1.6 s, melee 4.5, physical, +8 RP | Fury 34 / 1.6 s |
| Rating | health 4 · damage 5 · mobility 3 · defense 3 | |
| Passive | **Killing Cold**: every **5th** basic attack makes the next Glacier Cleave free and a certain critical hit | |
| Tuning factor | duel 1.00 · team **0.96** (`tuning.js`) | |

| Slot | Id | Name | Cost / cd / gcd / cast | Range | Effect |
|---|---|---|---|---|---|
| 0 | `rime_strike` | Rime Strike | 0 RP / 4.5 s / yes / instant | melee | 55 frost damage, applies **Chill** (20 % slow, 3 s), **+25 RP** |
| 1 | `glacier_cleave` | Glacier Cleave | 40 RP / 0 / yes / instant | melee | 100 frost damage, +25 % critical chance |
| 2 | `grave_chains` | **Grave Chains** (the pull) | 0 / 20 s / no / instant | 5–25 yd | pulls the enemy to the knight — exact rules in §2.4. Shared |
| 3 | `winters_howl` | Winter's Howl | 20 RP / 10 s / yes / instant | cone 10 yd, 90° | 40 frost damage and 40 % slow for 3 s to every enemy in the cone |
| 4 | `rune_ward` | Rune Ward | 0 / 40 s / no / instant, usable while stunned | self | absorbs up to 400 **non-physical** damage for 5 s; every 10 absorbed gives 1 RP. Shared |
| 5 | `heart_of_winter` | Heart of Winter (signature) | 0 / 50 s / no / instant | self | 10 s: +20 % damage, basic attacks 30 % faster, every hit applies Chill, immune to slows and roots (cleanses them) |

### 2.2 Blood (spec 1) — tank

| Stat | Value | Compare |
|---|---|---|
| HP / defense / speed | 1400 / 0.15 / 6.7 | Paladin Protection 1420, Warrior Protection 1380 / 0.15 |
| Basic attack | **Sanguine Cleave**: two-handed runeblade, 38 damage every 2.1 s, melee 4.5, physical, +6 RP | Arms 45 / 2.0 s |
| Rating | health 5 · damage 2 · mobility 2 · defense 5 | |
| Passive | **Blood Bond**: 4 % of all damage you deal heals you; taking damage generates RP (1 RP per 5 % of max health lost) | |
| Tuning factor | duel 1.00 · team **1.15** (`tuning.js`; the top of today's range, see §8) | |

| Slot | Id | Name | Cost / cd / gcd / cast | Range | Effect |
|---|---|---|---|---|---|
| 0 | `crimson_strike` | Crimson Strike | 0 RP / 4 s / yes / instant | melee | 42 damage and **Blood Plague** (36 shadow damage over 6 s), **+20 RP** |
| 1 | `reaping_strike` | Reaping Strike | 40 RP / 0 / yes / instant | melee | 55 damage; heals the knight for **8 % of the damage taken in the last 5 s** (at least 3 % of max health) |
| 2 | `grave_chains` | **Grave Chains** (the pull) | as Frost (§2.4; the chain is blood-red) | | Shared |
| 3 | `sanguine_pulse` | Sanguine Pulse | 15 RP / 8 s / yes / instant | 8 yd around self | 30 shadow damage, spreads Blood Plague, **taunts** every enemy hit for 3 s |
| 4 | `rune_ward` | Rune Ward | as Frost | | Shared |
| 5 | `sanguine_covenant` | Sanguine Covenant (signature) | 0 / 60 s / no / instant, usable while stunned | self | 8 s: +15 % max health (healed for the gained amount), +30 % healing received, Reaping Strike costs no RP |

**Counts**: 10 unique abilities (Frost 6, Blood 4 + 2 shared) and 2 basic attacks.

### 2.3 New sim mechanics needed (`js/sim/sim.js`)

| Mechanic | Used by | Notes |
|---|---|---|
| `runic` resource | both | regen +1/s; **no** gain from damage dealt; Blood gains from damage taken; HUD bar colour per spec (Frost `#7ad0ff`, Blood `#ff3a4a`) |
| **pull** | Grave Chains | §2.4; the prototype used the sim's existing `dashDir` on the **target** (it already moves a fighter with wall, pillar and floor collision and locks its input), so no new movement code is needed — only a `pull` / `pullEnd` event for the animation and the chain effect |
| absorb **filtered by school** (ignores `phys`) | Rune Ward | new option on the absorb buff |
| **damage taken in the last 5 s** per fighter | Reaping Strike | a small ring buffer |
| heals through `sim.heal` | Blood Bond, Reaping Strike | so tuning, crits and dampening apply like every other heal |
| Chill (a named slow), cone damage, taunt, DoTs | several | existing building blocks (slow, Ground Breaker's cone, Shield Slam's taunt, `addDot`) |
| bot logic | both | a kit script for `ai.js` (as prototyped, §8): Frost — pull anyone > 7 yd away or casting, Heart of Winter on a target under 60 %, Howl when the target isn't slowed or 2+ are in the cone, the free Cleave first; Blood — Covenant under 35 %, Rune Ward against casters under 60 %, **pull an enemy that is hitting the partner** (peel), Pulse to taunt, Reaping Strike under 70 % health |
| balance | both | add the specs and factors to `tuning.js`, re-run the 1v1 matrix and the 2v2 auto-tune with the real code (`docs/BALANCE.md`) |

### 2.4 Grave Chains — the pull, exactly

The class's signature tool, in **both specs** (the role model's "grip"-style pull, with our own name and look).

| Rule | Value |
|---|---|
| Use | instant, off the global cooldown, cooldown **20 s**, range **5–25 yd**, needs line of sight |
| Travel | a chain projectile at 50 m/s; **cover blocks it** (a target that breaks line of sight while it flies is not pulled — the same rule as Arcane Comet) |
| Effect | the target is **pulled to 2.5 m in front of the knight over 0.35 s** (it can't act during the pull), its **cast is interrupted**, then Chill (20 % slow, 2 s). No damage |
| Path | the target slides along the ground: walls, pillars and the bridge edge stop it where it hits them |
| Immune | Divine Shield, crowd-control immunity (Berserk Instinct …), Steel Tempest / Bladestorm, battleground spawn protection — the chain shatters ("Immune") |
| Value (tested) | without the pull Frost wins only **32 %** and Blood **43 %** of 1v1 duels; with it **50 % / 51 %** — almost all of the gain is against casters and ranged specs. The class is balanced *with* the pull: don't shorten its cooldown or add damage to it without a re-run |

---

## 3. Models (`02` format)

### Dread Knight — Frost (Risen) · `dreadknight_frost`

| | |
|---|---|
| Body | tall Risen human knight, pale blue-grey skin, gaunt strong face, long white hair falling from under the helm, glowing ice-blue eyes |
| Armour | dark steel plate **rimed with frost**, **spiked pauldrons with blue-white ice crystals growing out of them**, a horned helm with an open skull-shaped face guard, a ragged dark-blue tabard to the knee, chains across the waist, rune-etched breastplate and gauntlets |
| Colours | `#2a3240` dark steel / `#1e3a6a` navy cloth / `#c8e8ff` ice / glow `#7ad0ff` |
| Glows | eyes, breastplate runes, ice crystals (≤ 3 % of the texture) |
| Silhouette | ice-crystal pauldrons + horned helm |
| Items | `runeblade_frost` (`grip_r`) + its copy on `grip_l` · set `dw` |
| Prompt core | "tall undead knight with pale blue-grey skin, long white hair and glowing ice-blue eyes, dark steel plate armor rimed with frost, spiked pauldrons with blue-white ice crystals growing out of them, a horned helmet with an open skull-shaped face guard, ragged dark blue tabard to the knees, chains across the waist, glowing blue runes etched on the breastplate and gauntlets" |

### Dread Knight — Blood (Risen) · `dreadknight_blood`

| | |
|---|---|
| Body | as Frost, glowing crimson eyes |
| Armour | heavy **black-and-crimson plate**, **skull pauldrons** with rib-cage motifs and red gems, a spiked crown-helm over a dark hood, a tattered crimson cloak to the waist, bone ornaments on the belt, blood-red runes on the greaves and breastplate |
| Colours | `#1a1416` black steel / `#7a0a18` crimson / `#d8d0c0` bone / glow `#ff3a4a` |
| Glows | eyes, runes, pauldron gems |
| Silhouette | spiked crown-helm + skull pauldrons (wider than Frost's) |
| Items | `runeblade_blood` (`grip_r` + IK `grip2`) · set `th` |
| Prompt core | "tall undead knight with pale grey skin, long white hair and glowing crimson eyes, heavy black and crimson plate armor, large skull pauldrons with rib-cage shapes and red gems, a spiked crown helmet over a dark hood, tattered crimson cloak to the waist, bone ornaments on the belt, glowing blood-red runes on the breastplate and greaves" |

Both follow `02` §1 (T-pose, empty hands, 11,000 triangles, all finger joints, sockets, atlas).

---

## 4. Items (`03` format)

| Id | Used by | Hand / socket | Pose | Overall | Key dimensions | Origin | Named empties | Tris | Tile |
|---|---|---|---|---|---|---|---|---|---|
| `runeblade_frost` (one GLB, hung on both hands) | Dread Knight Frost | `grip_r` + `grip_l` | `fist_1h` | **1.10 m** | broad angular blade 0.82 × 0.085 with a jagged back edge on −X, glowing ice-blue runes along the fuller, guard of frozen ram horns 0.30 wide, skull pommel | 0.05 below the guard | `tip`, `trail_base` (guard), `fx_core` (rune line centre) | 900 | 512×1024 shared |
| `runeblade_blood` | Dread Knight Blood | `grip_r` + IK `grip2` | `fist_2h` | **1.85 m** | blade 1.30 × 0.14, serrated near the guard, blood-red runes, guard of bone wings around a skull, long grip 0.42 | 0.06 below the guard (right hand) | `tip`, `trail_base`, `fx_core`, `grip2` at y −0.30 | 1,500 | 1024² |

---

## 5. Animations (`05` format)

Frost uses the `dw` set (one-handed chops and swings — the motions are weapon-neutral) with its own idle and
victory; Blood uses the `th` set. New clips:

| Id | Layer | Len | Markers | Motion | Used by |
|---|---|---|---|---|---|
| `dkf_idle` | full | 2.40 loop | — | upright, menacing calm, both runeblades held low and angled outward, frost breath, slow breathing | Frost idle (replaces `dw_idle`'s eager hunch) |
| `dkf_rime` | upper | 0.80 | strike 0.26 | both blades slash down in a cross, then thrust | Rime Strike |
| `dkf_glacier` | full | 0.90 | strike 0.32 | half step forward, both blades raised overhead and cleaved straight down together | Glacier Cleave |
| `dkf_chains` | upper | 0.60 | release 0.12 | points the left blade at the enemy, then yanks the arm back hard (the pull) | Grave Chains (Frost) |
| `dkf_howl` | full | 0.90 | release 0.25 | throws the head back, then roars forward with the blades spread wide | Winter's Howl |
| `dkf_ward` | upper | 0.60 | release 0.18 | crosses both blades before the chest | Rune Ward (Frost) |
| `dkf_heart` | full | 1.00 | release 0.40 | raises both blades overhead, ice spreads over the armour, then lowers them into stance | Heart of Winter |
| `dkf_victory` | full | 3.00 | — | drives both blades point-down into the ground and rests the hands on the pommels | Frost victory |
| `dkb_crimson` | upper | 0.90 | strike 0.30 | rising two-handed diagonal slash from the low left | Crimson Strike |
| `dkb_reap` | full | 1.00 | strike 0.34 | wide reaping sweep, then draws the blade back toward the body (the heal) | Reaping Strike |
| `dkb_pulse` | full | 0.90 | strike 0.32 | plants the greatsword point into the ground, a blood nova bursts out | Sanguine Pulse |
| `dkb_covenant` | full | 1.10 | release 0.45 | draws the blade's edge across the left palm, raises the sword, blood aura ignites | Sanguine Covenant |

Reused: Blood's Grave Chains → `th_point_l` (left palm thrust, the chain springs from a sigil); Blood's Rune Ward →
`th_parry`; basic attacks → `dw_atk_*` / `th_atk_1..3`; locomotion, reactions, CC, deaths → `cm_*`; Blood victory
→ `th_victory`. Being pulled by Grave Chains plays `cm_hit_heavy` on the victim while it slides.

**12 new clips.**

---

## 6. Effects (`06` format)

New school colour for this class:

| School | Core | Glow | Dark | Shapes |
|---|---|---|---|---|
| Blood magic | `#ffd0d8` | `#ff3a4a` | `#3a0010` | crimson mist, blood droplets, swirling blood ribbons, vein-like runes (crimson-pink, kept apart from the Berserker's orange-red rage) |

Frost uses the existing **Frost** school (`06` §3).

| Ability | Clip | Hands / cast | Delivery | Impact | Persistent |
|---|---|---|---|---|---|
| **Frostbound Strikes** (auto) | `dw_atk_*` | frost-white blade trails | melee | `melee_hit` + frost sparks | — |
| **Rime Strike** | `dkf_rime` | blades frost over | melee | frost cross-slash streaks, shards | `slow_frost` (Chill) |
| **Glacier Cleave** | `dkf_glacier` | — | melee | ice shatter burst, frost crack decal 1.5 m; crit: big shockwave | — |
| **Killing Cold** (passive proc) | — | — | — | — | both blades glow brighter until the free Cleave is used |
| **Grave Chains** (Frost) | `dkf_chains` | rune sigil at the blade tip | an **icy chain** (ribbon of chain links from the atlas) shoots to the target, then reels in during the pull | frost burst on the target, chain shatters | `slow_frost` |
| **Winter's Howl** | `dkf_howl` | frost breath | a 90° cone of freezing wind and ice shards (particles + cone mesh, 10 m) | per enemy: frost puff | `slow_frost` |
| **Rune Ward** | `dkf_ward` / `th_parry` | runes flare | — | — | a **rune shell**: pale, see-through shell of rotating runes (spec colour), flashes where spells hit it, cracks at 30 % |
| **Heart of Winter** | `dkf_heart` | ice grows over the pauldrons | — | frost ring at the feet | ice crystals on the armour, frost breath, frost trails on every swing, ice-blue eyes blaze |
| **Sanguine Cleave** (auto) | `th_atk_1..3` | crimson trail | melee | `melee_hit`; thin blood ribbons stream back into the knight (Blood Bond heal) | — |
| **Crimson Strike** | `dkb_crimson` | — | melee | crimson slash | `dot_blood_plague`: dark-red mist and drips |
| **Reaping Strike** | `dkb_reap` | — | melee | blood burst; a ribbon of blood flows from the target into the knight's chest, `heal_land` (crimson) | — |
| **Grave Chains** (Blood) | `th_point_l` | sigil at the left palm | a **blood-red chain** | crimson burst | — |
| **Sanguine Pulse** | `dkb_pulse` | — | a blood nova ring r 8 from the planted blade | per enemy: crimson burst + ⚑ taunt icon | Blood Plague spreads |
| **Sanguine Covenant** | `dkb_covenant` | blood from the palm | — | crimson pillar | crimson aura + mist at the feet, runes blaze, the body's emissive pulses with a heartbeat |
| Being pulled | — | — | — | — | the victim slides with dust at the feet and the chain attached at `chest` |

---

## 7. Cost and place in the plan

| Batch | Count | Credits |
|---|---|---|
| Champions (model + retopo + rig) | 2 × 100 | 200 |
| Item GLBs (model + retopo) | 2 × 80 | 160 |
| Clips | 12 × 20 | 240 |
| Re-roll reserve (20 % of the clips) | | 48 |
| **Total** | | **≈ 650** |

Order: after phase 3 (champions) and phase 4 (`dw` and `th` sets) of `08` §3, because it reuses those sets.
Implementation (classes, sim mechanics, AI, HUD, balance) is its own step after the models.

---

## 8. Balance check (2026-11-27)

**Method**: the kit above was prototyped in the balance lab page (in memory only, nothing in the repo changed):
both specs as class data, the stand-ins for the new mechanics from §2.3, the bot logic from §2.3, hard bots, and the
game's own Sim and AI for everyone else. Same procedure as `docs/BALANCE.md`.

| Check | Frost | Blood | Today's band (20 specs) |
|---|---|---|---|
| 1v1 — every spec, 40 rounds per pairing (800 rounds per spec) | **50.5 %** | **51.4 %** | 46.4–53.0 % |
| 2v2 — random partner vs 2 random specs | **53.3 %** (800 games) | **50.9 %** (1,000 games) | 47.5–54.6 % |
| Damage per second on a dummy (40 s) | 73 | 50 | Crusader 63, Enhancement 63, Executioner 50, Prot Warrior 43 |
| Survival vs a fixed 85 phys + 35 arcane per second | 12.5 s | 28 s | Fury 11.8, Arms 14.8, Prot Paladin 23.5 |
| 1v1 round length (median) | 18.7 s | 33.1 s | — |
| Without Grave Chains (1v1) | 32.3 % | 42.7 % | — |

**Counters (1v1)** — as with every spec in this lab, single pairings end near 0 % or 100 % with hard bots:
- Frost beats casters and ranged specs it can drag in (Discipline, Shadow, Elemental, Summoner 100 %, Fire 90 %), and
  Arms 89 %, Protection Warrior 88 %, Beastmaster 80 %; it loses to melee that out-trades it (Crusader, Feral 0 %,
  Executioner 3 %, Restoration 3 %, Protection Paladin 5 %, Fury 8 %).
- Blood beats melee (Fury, Arms, Protection Warrior, Subtlety, Discipline 100 %, Assassination 95 %, Crusader 90 %)
  and loses to kiting damage-over-time casters and pets (Frost Mage, Shadow, Curser, Restoration, Enhancement,
  Beastmaster 0 %, Sharpshooter 3 %) — the same profile as Protection Paladin.

**How it got here** (first draft → tested):

| Change | Why |
|---|---|
| Runic Power no longer comes from damage dealt (rage rules) | first draft: **87 % / 78 %** in 1v1 — Glacier Cleave did most of Frost's damage, Reaping Strike was cast every 2.3 s and healed ~900 per fight |
| Frost: Cleave 115 → 100, Rime 60 → 55, Killing Cold every 4th → 5th hit, Heart +25 → +20 %, Howl 50 → 40, HP 1300 → 1330, defense 0.12 → 0.135 | damage per second 86 → 73 (peers 62–65); it then lost every melee duel, so it got back a little health and armour |
| Blood: Reaping heal 25 → 8 % of damage taken (min 6 → 3 %), Bond 12 → 4 %, RP per hit 10 → 6, Crimson RP 25 → 20, damage −15–30 %, Covenant +25 → +15 % health, HP 1450 → 1400, defense 0.18 → 0.15 | it won melee duels with 44–74 % health left and survived the bench twice as long as Protection Paladin |
| Team factors Frost 0.96, Blood 1.15 | 2v2 was 56–58 % / 39–40 % with the 1v1-balanced numbers (the pull and the cone are stronger in team fights; Blood has no partner protection). Blood's bot peels with the pull |

**Watch list**: Blood's team factor (1.15) is at the top of today's range — if it needs more, give Blood partner
utility (for example Rune Ward castable on the partner) instead of raising the factor. Re-run the whole lab once the
class is implemented for real: the prototype's stand-ins (pull, filtered absorb, damage window) are close to the
spec but not the final code.
