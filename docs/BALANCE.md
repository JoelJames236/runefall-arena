# Runefall Arena — Balance

How balance is measured, where every spec stands, and what changed (so it can be adjusted later).

## How it is measured

All numbers come from the balance lab ([`balance.html`](../balance.html)), which runs the real combat
simulation headless with the bots on **hard**. Bots use exactly the player rules (cooldowns, GCD, ranges, line of
sight, resources, swing timers, and — since this update — attacks only while "holding the attack button").

| Test | Conditions |
| --- | --- |
| **1v1 matrix** | every spec against every other spec, 20 rounds per pairing (sides alternate), 3,800 rounds |
| **2v2 sample** | 2,400 random team-ups of the 20 specs (≈ 480 games per spec) |
| **Spec benchmark** | identical conditions for every spec: **sustained DPS** over 60 s against a passive target dummy (no armor), **burst** = best 6-second window, **survival** = seconds lasted while a dummy deals a fixed 85 physical + 35 arcane damage per second (armor, defensives, self-heals and absorbs all count), **partner HPS** = healing done on a passive partner taking 75 damage per second |

The AI is not an expert human, so treat the win rates as a guide: a spec far outside **40–60 %** is a real
outlier; differences of a few points are noise (±3 % in 1v1, ±2.5 % in 2v2 at these sample sizes).
Rage users look weak against the passive dummy because nothing hits them back (rage comes from dealing and
taking damage) — the benchmark measures the kit, the matrix measures the fight.

## Players vs bots — ranged aim assist and more human bots (2026-11-27)

The lab only ever pits bots against bots, and bots aim the same for every spec — so it could not show what players
felt: as a caster or archer you lose to bots. The reason was the aim. A ranged basic attack flies straight and takes
0.5–0.6 s over 25 yd; a strafing enemy has moved 3.5–4 m by then, so a person had to aim that far ahead by hand,
while a Champion bot aims within ±0.2 m and leads perfectly (a Knight bot within ±0.45 m — the hitbox is 0.55 m wide).
Melee doesn't have this problem: a swing hits whatever is under the dot at once.

- **Aim assist for players' ranged basic attacks** (`assistPick` / `shootAuto` / `stepStraight` in `js/sim/sim.js`):
  an enemy within 0.45 m (+ 0.035 m per metre of distance) of the dot counts as aimed at; the shot then fires at
  where it will be when the bolt arrives and bends towards it in flight (2.2 rad/s). Walls still block, aiming clearly
  beside the target still misses. Bots don't get it (they aim themselves; the AI marks its champion as a bot), so the
  lab numbers and the tuning stay valid. The crosshair turns red when the assist will catch a target.
- **Squire and Knight bots aim like people**: aim error 0.9 → 1.3 m and 0.45 → 0.75 m, lead 0.3 → 0.15 and
  0.75 → 0.55; Knight also interrupts (0.55 → 0.45) and dodges (0.6 → 0.5) a little less and reacts a little slower.
  Champion bots are unchanged (the expert level; the lab measures with them).

Measured with a stand-in for a person — the dot on the enemy's chest with ±0.5 m jitter and no lead — against every
spec as Knight bots (114 rounds each): basic-attack hit rate without → with assist: Fire 65 → 80 %, Frost 71 → 88 %,
Sharpshooter 74 → 90 %, Elemental 65 → 84 %, Shadow 65 → 78 %, Curser 64 → 83 % — about the rate bots reach by
themselves.

## Latest measurement — all three modes (2026-11-27)

Measured with the code after the 5v5 battleground and the new main menu (nothing changed in the arena: an A/B run
against the simulation from before the battleground put Fire Mage at 51.3 % now vs 47.4 % before, 760 rounds each).

| Mode | Sample | Noise per spec |
| --- | --- | --- |
| 1v1 | two matrices, 20 rounds per pairing each → 760 rounds per spec | ±1.8 points |
| 2v2 | 2,400 random team-ups (≈ 480 per spec) | ±2.3 points |
| 5v5 battleground | 200 complete matches, random teams (no class twice per team), FlagAI on hard → ≈ 100 per spec | ±5 points |

| Spec | 1v1 % | 2v2 % | 5v5 % | 5v5 damage / healing per match | 5v5 flag returns / picks per match |
| --- | --- | --- | --- | --- | --- |
| Warrior — Protection | 52.2 | 53.5 | **63.0** | 19,800 / 0 | 2.28 / 1.09 |
| Warrior — Arms | 49.7 | **56.1** | 57.4 | 25,800 / 0 | 2.56 / 1.12 |
| Berserker — Fury | 50.7 | 48.4 | **59.7** | 26,600 / 700 | 2.23 / 1.91 |
| Berserker — Executioner | 49.7 | **45.2** | 56.6 | 20,200 / 0 | 1.77 / 1.95 |
| Rogue — Assassination | 52.9 | 48.8 | **59.2** | 24,100 / 0 | 2.29 / 2.72 |
| Rogue — Subtlety | **45.6** | 51.8 | 53.6 | 23,500 / 0 | 2.79 / 2.66 |
| Necromancer — Summoner | 50.1 | 49.9 | 57.7 | 17,100 / 0 | 0.26 / 1.88 |
| Necromancer — Curser | 49.9 | 48.7 | **36.4** | 11,900 / 800 | 0.17 / 1.18 |
| Mage — Frost | 49.2 | 48.8 | 56.7 | 9,300 / 0 | 0.12 / 0.05 |
| Mage — Fire | 48.9 | 50.2 | **41.5** | 15,400 / 0 | 0.18 / 1.31 |
| Druid — Feral | 48.8 | 48.3 | 54.5 | 20,000 / 3,400 | 1.90 / 1.36 |
| Druid — Restoration | 49.2 | 53.8 | **28.3** | 6,300 / 13,600 | 0.17 / 0.13 |
| Paladin — Crusader | 51.8 | 52.0 | 53.4 | 22,200 / 1,000 | 1.76 / 2.54 |
| Paladin — Protection | **46.8** | 48.7 | **39.9** | 13,600 / 4,600 | 1.17 / 0.83 |
| Hunter — Sharpshooter | 53.1 | **45.9** | 51.6 | 14,300 / 0 | 0.24 / 2.25 |
| Hunter — Beastmaster | 50.0 | 51.7 | 45.1 | 16,100 / 1,100 | 0.11 / 3.21 |
| Priest — Shadow | 51.2 | 51.8 | 48.2 | 9,300 / 1,000 | 0.19 / 0.62 |
| Priest — Discipline | 48.7 | 46.7 | 44.0 | 10,000 / 8,800 | 0.20 / 0.11 |
| Shaman — Enhancement | 52.9 | 49.1 | 47.6 | 14,200 / 5,600 | 1.31 / 1.98 |
| Shaman — Elemental | 48.6 | 50.2 | **41.9** | 14,200 / 1,200 | 0.34 / 2.23 |

5v5 matches: median 11 min, scores mostly decided (3:0 32×, 3:1 28×, 0:3 25×, 1:3 24×, 3:2 19×, 2:3 17×), 24 draws.

### 1v1 — balanced on average, but every pairing is a hard counter

The averages sit between 45.6 and 53.1 %, yet nearly every single pairing ends 0 % or 100 %: both bots play the
same way every time and the simulation has little randomness (±6 % damage, 8 % crits), so the same matchup ends the
same way. With humans this is softer, but the counters are real:

- **Fire Mage** beats slow melee (Enhancement 100 %, Executioner 90 %, Protection Paladin 90 %: it casts on the
  move and the target keeps burning) and loses to fast melee (Feral 0 %, Fury 0 %, Subtlety 5 %: low health, little
  control, nothing to shake them off).
- **Frost Mage** beats melee that has to walk in (Subtlety, Assassination, Protection Warrior 100 %: Frost Nova,
  roots, two blinks, Shatter crits) and loses to Restoration, Enhancement and Elemental (0 %): targets it can't burst
  or that shrug off its slows.
- **Subtlety (lowest, 45.6 %)** beats casters without an escape (Fire 95 %, Shadow 90 %) and loses to Curser,
  Beastmaster and Frost (0 %): damage over time, a pet that chases it and roots take away its stealth openers.
- **Protection Paladin (46.8 %)** beats every melee spec (100 %) but can't kill a healer or a damage-over-time caster
  (Restoration, Curser, Summoner 0 %): a tank's damage is too low.

### 2v2 — a few specs at the edge

- **Arms 56.1 %** (the one clear outlier): Greatsword Cleave often hits both enemies, Rending Blow halves the
  target's healing for 8 s (bad news for a team with a healer), Battle Trance adds 35 % damage below 30 % health.
  The 2v2 factor (1.026) can come down a little.
- **Restoration 53.8 %, Protection Warrior 53.5 %**: their strength is protecting a partner, which only exists in
  team play; in 1v1 they are average.
- **Executioner 45.2 %**: slow 2.2 s swings and huge crits only pay off on a target that stays put; in 2v2 it gets
  healed, peeled or swapped, and Bloodrage (more damage at low health) often comes too late.
- **Sharpshooter 45.9 %** (53.1 % in 1v1): Steady Aim needs a second of standing still, and in 2v2 someone is always
  on it with no pet to peel; in a duel it simply keeps its one opponent at range.

### 5v5 — the battleground favours melee (the `bg5` factors are still the untuned 2v2 copy)

1. **Casts break far more often.** Battleground bots move between objectives, push through to the flag and jump when
   stuck, so many casts are lost to movement (cancelled share of cast starts, 5v5 vs 2v2): Sharpshooter 43 vs 13 %,
   Frost 39 vs 9 %, Shadow 39 vs 14 %, Elemental 24 vs 13 %, Restoration 22 vs 7 %. Casters deal 9,000–15,000
   damage per match, melee specs 20,000–27,000.
2. **Objectives are melee work.** A flag is returned or picked up by touching it, and carriers die in melee range:
   melee specs return 1.8–2.8 flags per match, ranged specs 0.1–0.3.
3. **Respawn waves devalue healing.** A death costs 10–20 s, not the round. Restoration heals the most of anyone
   (13,600 per match) and wins 28 %: its team effectively has four attackers against five. Discipline (44 %) and
   Protection Paladin (40 %, little damage) suffer from the same.
4. **Roles and kits.** Protection Warrior (63 %) is tanky and its Charge catches carriers; it returns the most flags.
   Summoner (58 %): the fast ghoul with its slow harasses carriers on its own. Frost (57 %) usually gets the defender
   role (the most controlling spec defends), which is why it never picks a flag — its roots shine in the flag room.
   Curser (36 %) stacks curses on one target, while battleground fights switch targets constantly, and it takes
   more damage itself for every curse it holds.

**Next steps (not done yet):** part of the 5v5 gap is bot logic, not the classes — battleground bots don't stop to
cast. Fix that first (casters stand to cast when not carrying or on an urgent errand), measure again, and only then
run a `bg5` auto-tune; tuning on top of the bot quirk would make casters too strong in human hands. Separately,
lower the 2v2 factor of Arms a little.

## Where every spec stands (benchmark from an earlier update; the latest win rates are in the section above)

| Spec | Role | 1v1 win % | 2v2 win % | Sustained DPS | Burst DPS (6 s) | Survival (s) | Partner HPS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Mage — Frost | ranged burst / control | 55 | 51 | 77 | 134 | 11.0 | – |
| Mage — Fire | ranged, casts on the move | 56 | 49 | 80 | 113 | 11.7 | – |
| Rogue — Subtlety | melee burst | 51 | 58 | 96 | 187 | 10.7 | – |
| Rogue — Assassination | melee poison | 54 | 51 | 103 | 147 | 10.4 | – |
| Warrior — Protection | melee, team defense | 49 | 62 | 62 | 98 | 15.4 | – |
| Warrior — Arms | melee execute | 57 | 51 | 60 | 101 | 14.4 | – |
| Berserker — Fury | melee, low-health damage | 49 | 45 | 55 | 86 | 12.0 | – |
| Berserker — Executioner | melee, slow big crits | 46 | 50 | 69 | 121 | 11.4 | – |
| **Paladin — Crusader** | melee holy damage | 57 | 55 | 73 | 117 | 15.0 | – |
| **Paladin — Protection** | tank | 52 | 49 | 50 | 76 | **23.0** | – |
| Priest — Discipline | healer | 52 | 59 | 80 | 103 | 17.0 | 27 |
| Priest — Shadow | ranged DoT | 41 | 59 | 47 | 73 | 13.7 | – |
| Shaman — Elemental | ranged burst | 52 | 41 | 74 | 141 | 15.4 | – |
| Shaman — Enhancement | melee hybrid | 53 | 42 | 80 | 138 | 15.0 | – |
| Hunter — Beastmaster | ranged + pet | 41 | 44 | 51 | 63 | 10.0 | – |
| Hunter — Sharpshooter | ranged burst | 46 | 43 | 76 | 151 | 10.0 | – |
| Necromancer — Summoner | ranged + minion | 55 | 45 | 103 | 144 | 11.7 | – |
| Necromancer — Curser | ranged curses | 58 | 45 | 72 | 138 | 10.0 | – |
| Druid — Feral | melee shapeshifter | 47 | 51 | 84 | 131 | 15.4 | – |
| Druid — Restoration | healer | 50 | 49 | 23 | 30 | **26.4** | **54** |

**Ranges**: 1v1 41–58 % (before this update: 36–66 % with 18 specs); 2v2 41–62 % (before: 37–64 %).
Roles are distinct: the tank (Protection Paladin) survives about twice as long as damage dealers but deals the
least damage of the melee; the healers heal their partner (Restoration most, Discipline with shields and more
damage); burst specs (Subtlety, Sharpshooter, Elemental, Summoner) have the highest 6-second windows.

**Watch list for the next pass** (inside the band, but at its edges): Shadow Priest and Beastmaster in 1v1 (41 %),
Elemental and Enhancement in 2v2 (41–42 %), Protection Warrior in 2v2 (62 %, Shieldwall), the Priests in 2v2 (59 %).

## Current state — arena tuning (auto-tuned)

Ability numbers alone could not balance both formats: the kit that wins duels (self-healing, kiting, single-target
burst) is not the kit that wins team fights (team defense, cleave, peels). After six manual passes specs still sat at
61 % in one format and 37 % in the other (Elemental), or 44 % and 65 % (Feral).

So every spec now has **one power factor per format** on all damage and healing it deals (`js/data/tuning.js`;
`duel` in 1v1, `team` when both teams have two or more champions; shown on the champion screen). The 5v5
battleground has its own format, `bg5`, which starts as a copy of `team` until a 5v5 auto-tune is run. The factors were
found by the lab's **Auto-tune** mode: measure the format with hard bots, multiply each factor by
`1 − gain × (win % − 50)`, repeat with a shrinking gain (8 passes), then validate with a larger sample.

| | Before | After auto-tune (validation run) |
| --- | --- | --- |
| 1v1 | 40.5–59.6 % (spread 4.8) | **46.4–53.0 %** (spread 1.8) — 7,600 rounds, 40 per pairing |
| 2v2 | 37.3–62.5 % (spread 7.0) | **47.5–54.6 %** (spread 1.8) — 6,000 random team-ups |

"Spread" is the standard deviation of the 20 win rates around 50 %. The sampling noise of these runs is about ±1.8
points per spec, so what is left is mostly noise: the lab cannot tell these specs apart any more.

| Spec | 1v1 factor | 1v1 % | 2v2 factor | 2v2 % |
| --- | --- | --- | --- | --- |
| Mage — Frost | 0.959 | 47.8 | 1.145 | 47.5 |
| Mage — Fire | 0.986 | 52.2 | 1.125 | 51.8 |
| Rogue — Subtlety | 1.004 | 48.5 | 0.918 | 51.0 |
| Rogue — Assassination | 1.016 | 52.4 | 0.927 | 49.9 |
| Warrior — Protection | 1.000 | 48.1 | 0.894 | 51.1 |
| Warrior — Arms | 0.997 | 51.1 | 1.026 | 54.6 |
| Berserker — Fury | 0.999 | 53.0 | 0.989 | 48.8 |
| Berserker — Executioner | 1.006 | 51.4 | 0.946 | 49.6 |
| Paladin — Crusader | 1.029 | 49.9 | 0.971 | 50.3 |
| Paladin — Protection | 1.005 | 49.8 | 0.979 | 50.5 |
| Priest — Discipline | 1.021 | 50.1 | 1.017 | 53.0 |
| Priest — Shadow | 1.031 | 46.4 | 0.950 | 49.1 |
| Shaman — Elemental | 0.974 | 49.6 | 1.090 | 50.7 |
| Shaman — Enhancement | 0.987 | 51.8 | 0.937 | 47.6 |
| Hunter — Beastmaster | 0.990 | 50.8 | 1.076 | 49.4 |
| Hunter — Sharpshooter | 1.018 | 49.9 | 1.110 | 49.8 |
| Necromancer — Summoner | 0.977 | 51.0 | 1.018 | 50.3 |
| Necromancer — Curser | 0.954 | 48.5 | 0.997 | 47.8 |
| Druid — Feral | 1.023 | 50.4 | 0.903 | 49.4 |
| Druid — Restoration | 1.015 | 47.1 | 1.010 | 47.7 |

The 1v1 factors are small (−5 % … +3 %): the manual passes had the duel nearly right. The 2v2 factors are the real
correction (−11 % … +15 %): ranged burst specs gain (longer team fights blunt burst), team-defense and cleave specs
give some back (Protection Warrior, Feral, the Rogues).

**What this does and doesn't mean.** The win rates are bot against bot on the hardest difficulty. Bots aim and react
the same for every spec, so a spec that is hard for humans to play well (or easy) will sit elsewhere in real matches.
**After changing an ability or a rule, re-run Auto-tune** (it starts from the factors in the file) and paste the
printed table into `js/data/tuning.js` — an old table on a changed kit is no longer balanced.

## Change log — one attack rhythm, hittable summons

- **Swing timers 1.5–2.2 s for every basic attack** (were 1.2–3.0 s), damage per hit rescaled so damage per second
  is unchanged:

  | Basic attack | Before | After |
  | --- | --- | --- |
  | Claws (Feral cat) | 28 / 1.2 s | 35 / 1.5 s |
  | Twin Slashes (Subtlety) | 30 / 1.3 s | 35 / 1.5 s |
  | Envenomed Slashes (Assassination) | 26 / 1.3 s | 30 / 1.5 s |
  | Dawn Hammer (Crusader) | 48 / 2.5 s | 38 / 2.0 s |
  | Greatsword Cleave (Arms) | 59 / 2.6 s | 45 / 2.0 s |
  | Great Axe Cleave (Executioner) | 66 / 3.0 s | 48 / 2.2 s |
  | Quick Shot (Beastmaster) | 20 / 1.4 s | 23 / 1.6 s |
  | Heavy Arrow (Sharpshooter) | 40 / 2.2 s | 36 / 2.0 s |
  | Fire Bolt (Fire) | 22 / 1.6 s | 25 / 1.8 s |

- **Fire Mage**: Fireball impact 86 → 80 (and the Fire Bolt's slower rhythm means fewer Burning stacks per second).
- **Shaman — Enhancement**: Healing Surge 166 → 156 (64 % in 1v1 once enemy blows could hit its spirit wolf).
- **Pets and summons can be hit** by aimed basic attacks (one shared hitbox, radius 0.45, up to 1.5; with the full
  champion hitbox the spirit wolf shielded its shaman from enough blows to be worth +6 win-% points).

Result (hard AI): **1v1 42–61 %**, **2v2 37–65 %**, first kill after a median 17 s.

| Spec | 1v1 % | 2v2 % | | Spec | 1v1 % | 2v2 % |
| --- | --- | --- | --- | --- | --- | --- |
| Mage — Frost | 57 | 41 | | Priest — Discipline | 46 | 47 |
| Mage — Fire | 51 | 42 | | Priest — Shadow | 42 | 55 |
| Rogue — Subtlety | 48 | 58 | | Shaman — Elemental | 61 | 37 |
| Rogue — Assassination | 50 | 54 | | Shaman — Enhancement | 56 | 60 |
| Warrior — Protection | 48 | 63 | | Hunter — Beastmaster | 50 | 46 |
| Warrior — Arms | 52 | 45 | | Hunter — Sharpshooter | 46 | 41 |
| Berserker — Fury | 51 | 52 | | Necromancer — Summoner | 53 | 48 |
| Berserker — Executioner | 50 | 55 | | Necromancer — Curser | 58 | 45 |
| Paladin — Crusader | 43 | 52 | | Druid — Feral | 44 | 65 |
| Paladin — Protection | 51 | 51 | | Druid — Restoration | 44 | 45 |

Watch list: Feral and Protection Warrior in 2v2 (63–65 %), Elemental's format gap (61 % 1v1, 37 % 2v2 — a cut of
Lightning Lash to 73 dropped its 2v2 to 31 %, so it stayed at 76).

## Change log — aimed basic attacks

Basic attacks now hit what the crosshair dot is on (uniform hitbox for every champion, straight ranged bolts that
can miss and break on cover; see `docs/GAMEFEEL.md`, "Third pass"). Bots aim with a difficulty-based error and lead
ranged shots; on hard they land 70–100 % of their basic attacks. Lab result with no number changes: **1v1 40–59 %**
(3,800 rounds), **2v2 38–62 %** (2,400 team-ups), first kill after a median 17 s.

| Spec | 1v1 % | 2v2 % | | Spec | 1v1 % | 2v2 % |
| --- | --- | --- | --- | --- | --- | --- |
| Mage — Frost | 56 | 38 | | Priest — Discipline | 46 | 47 |
| Mage — Fire | 56 | 45 | | Priest — Shadow | 40 | 54 |
| Rogue — Subtlety | 44 | 58 | | Shaman — Elemental | 54 | 38 |
| Rogue — Assassination | 52 | 56 | | Shaman — Enhancement | 52 | 55 |
| Warrior — Protection | 49 | 62 | | Hunter — Beastmaster | 49 | 43 |
| Warrior — Arms | 50 | 47 | | Hunter — Sharpshooter | 48 | 43 |
| Berserker — Fury | 55 | 51 | | Necromancer — Summoner | 51 | 45 |
| Berserker — Executioner | 51 | 53 | | Necromancer — Curser | 59 | 50 |
| Paladin — Crusader | 48 | 51 | | Druid — Feral | 43 | 61 |
| Paladin — Protection | 51 | 48 | | Druid — Restoration | 44 | 54 |

Human players aim worse or better than the bots, so ranged specs that rely on basic attacks (hunters) now reward
good aim the most. Watch list unchanged: Protection Warrior and Feral in 2v2 (~61 %), Frost / Elemental in 2v2 (38 %).

## Change log — gameplay follow-ups (leeway, team vitality, bot filler)

Rule and bot changes in this update (details in `docs/GAMEFEEL.md`, "Second pass") that move balance:

| Change | Effect in the lab |
| --- | --- |
| **Melee leeway** (+0.8 yd while both fighters move) | helps every melee spec against kiters; 1.5 yd was tried first and cost Sharpshooter, Frost, Shadow and Elemental 10–17 points in 1v1 |
| **Team vitality** (2v2: ×1.5 health) | median time to the first kill 11 s → **16 s**, median 2v2 round 44 s; long fights favour sustain over burst |
| **Bot filler** (attack instead of idling) | the first version re-cast running damage-over-time spells and swung the 1v1 matrix to 26–74 %; it now skips a DoT / debuff of its own that still has more than 35 % to run |
| **Slow resistance** 35 % (Executioner, Enhancement) and **Assassination** energy 16 → 17 /s | less time out of range or energy-starved (20 /s pushed Assassination to 67–72 %) |
| **Pillar blocking** | Arcane Comet only; blocking Aimed Shot, the Sharpshooter's main filler, cost it ~10 points |

Numbers changed over six lab passes (1v1: 20 rounds per pairing, 3,800 rounds; 2v2: 2,400 random team-ups each):

| Spec | Change |
| --- | --- |
| Mage (both) | health 1000 → 1080 (1100 overshot Fire to 62 % in 1v1) |
| Mage — Frost | Frost Lance 88 → 94 |
| Mage — Fire | Fireball 85 → 86 |
| Rogue — Assassination | energy regeneration 17 /s (class: 16), Venom Mastery 3.5 → 3 % per stack |
| Warrior — Protection | Shieldwall (team play): self 15 → 8 %, allies 8 → 5 % |
| Warrior — Arms | auto 62 → 59 |
| Berserker — Executioner, Shaman — Enhancement | slows on you are 35 % weaker |
| Priest — Shadow | Mind Blast heals for 70 % of its damage (was 40 %) — it fell to 34 % in 1v1 once melee had leeway |
| Shaman — Elemental | Lightning Lash 68 → 76 |
| Hunter — Beastmaster | pet damage 17 → 22 (the jungle cat, now a silverback gorilla) |
| Hunter — Sharpshooter | Aimed Shot 160 → 168 |
| Necromancer — Curser | health 1150 → 1200 |

Result (hard AI, final pass): **1v1 43–58 %** (before: 41–58 %), **2v2 35–66 %** (before: 42–64 %).

| Spec | 1v1 % | 2v2 % | | Spec | 1v1 % | 2v2 % |
| --- | --- | --- | --- | --- | --- | --- |
| Mage — Frost | 54 | 42 | | Priest — Discipline | 43 | 49 |
| Mage — Fire | 50 | 39 | | Priest — Shadow | 43 | 61 |
| Rogue — Subtlety | 46 | 55 | | Shaman — Elemental | 56 | 41 |
| Rogue — Assassination | 52 | 55 | | Shaman — Enhancement | 58 | 54 |
| Warrior — Protection | 51 | 66 | | Hunter — Beastmaster | 44 | 44 |
| Warrior — Arms | 58 | 47 | | Hunter — Sharpshooter | 43 | 35 |
| Berserker — Fury | 48 | 48 | | Necromancer — Summoner | 46 | 44 |
| Berserker — Executioner | 52 | 59 | | Necromancer — Curser | 57 | 48 |
| Paladin — Crusader | 51 | 51 | | Druid — Feral | 46 | 61 |
| Paladin — Protection | 53 | 49 | | Druid — Restoration | 49 | 53 |

The 2v2 edges move ±3–5 points between passes of the same build (Sharpshooter 35–44 %, Protection Warrior 62–67 %,
Fire 38–46 % over the last four passes), so treat them as a trend.

Watch list: Protection Warrior in 2v2 (62–67 % in every pass, also before this update — the Shieldwall cut didn't
move it, so it is the warrior's kit in team fights, not the passive); the ranged burst specs in 2v2 (Fire, Frost,
Elemental, Sharpshooter around 40 %: longer team fights blunt burst); Shadow Priest and Feral in 2v2 (~60 %).

## Change log — gameplay-feel update (cast reliability)

The gameplay-feel update fixed how casts start (see `docs/GAMEFEEL.md`). That exposed a hidden handicap in every
earlier lab run: **about half of the bots' cast-time spells failed** — a cast that left the spell queue while the bot
was still running started and broke on the next tick, costing the global cooldown. (Players hit the same thing when
they pressed a cast a moment before they stopped.) All cast-time specs had been tuned around that handicap, so with
reliable casts they jumped far out of the band (same lab, 3,800 rounds): Elemental 50 → 77 %, Discipline 54 → 71 %,
Frost 53 → 66 %; melee fell accordingly (Arms 62 → 44 %, Feral 41 → 36 %).

Numbers changed to bring every spec back (four lab passes):

| Spec | Change |
| --- | --- |
| Mage — Frost | Frost Lance 104 → 88 |
| Priest — Discipline | Sacred Bolt 85 → 72, Mend 175 → 152 |
| Priest — Shadow | Mind Blast 122 → 114 (64 % in 2v2 once its cast was reliable) |
| Shaman — Elemental | Lightning Lash 85 → 68, Magma Burst 78 → 72 |
| Shaman — Enhancement | Healing Surge 180 → 166 |
| Necromancer — Summoner | Soul Rot 90 → 80 (its 70 damage over time is unchanged) |
| Necromancer — Curser | health 1060 → 1150 (34 % in 2v2: no cast-time spells, so it gained nothing from the fix) |
| Druid — Restoration | Regrowth 95 → 88 (its heal over time is unchanged) |

Result with the new rules (hard AI): **1v1 41–58 %** (3,800 rounds), **2v2 42–64 %** (2,400 random team-ups) — the same
band as before the update.

| Spec | 1v1 % | 2v2 % | | Spec | 1v1 % | 2v2 % |
| --- | --- | --- | --- | --- | --- | --- |
| Mage — Frost | 54 | 49 | | Priest — Discipline | 55 | 57 |
| Mage — Fire | 52 | 46 | | Priest — Shadow | 41 | 60 |
| Rogue — Subtlety | 49 | 58 | | Shaman — Elemental | 55 | 43 |
| Rogue — Assassination | 50 | 49 | | Shaman — Enhancement | 54 | 42 |
| Warrior — Protection | 49 | 64 | | Hunter — Beastmaster | 41 | 42 |
| Warrior — Arms | 46 | 47 | | Hunter — Sharpshooter | 46 | 48 |
| Berserker — Fury | 45 | 51 | | Necromancer — Summoner | 55 | 47 |
| Berserker — Executioner | 47 | 42 | | Necromancer — Curser | 56 | 45 |
| Paladin — Crusader | 51 | 58 | | Druid — Feral | 47 | 44 |
| Paladin — Protection | 49 | 53 | | Druid — Restoration | 58 | 54 |

Watch list: Protection Warrior (64 %) and Shadow Priest (60 %) in 2v2; Beastmaster in both formats (41–42 %); Shadow
Priest in 1v1 (41 %). The sustained-DPS / burst columns of the table above predate this pass (Frost, Discipline,
Elemental and Summoner fillers are 10–20 % lower now). Other rule changes in the update are neutral for the lab: melee
blows land 0.13–0.24 s after the swing starts (same swing timer), the melee facing arc is 200° instead of 166°.

## Change log — this update

### New class: Paladin (tuned over four lab passes)

First version won 80–87 % of duels (too much health, armor, self-healing and damage reduction at once).
Final numbers:

| | Crusader | Protection |
| --- | --- | --- |
| Health / armor | 1250 / 12 % | 1420 / 15 %, takes 5 % less damage |
| Auto | 48 holy / 2.5 s | 36 / 1.9 s |
| Builders | Holy Strike 74, Judgment 68 (+15 % holy taken, 6 s) | Shield Slam 55 + Challenge, Judgment, Sentinel's Shield 60 + 2.5 s silence |
| Spender (3 Holy Power) | Radiant Storm 40 + 45/HP AoE, heals 15 % of damage | Holy Shield 5 % + 6 %/HP damage reduction (23 %), heals 25 + 30/HP |
| Control | Hammer of Light 1.5 s stun (26 s) | silence, Consecration (12/s, Challenges) |
| Defensive | Divine Shield 3 s immunity, deals 50 % less (90 s) | Guardian's Resolve 30 % (allies 10 %), Challenges all nearby (60 s) |
| Signature | Divine Wrath 128 + 55 splash, +15 % damage 8 s (50 s) | Guardian's Resolve |
| Taunt | – | Challenged enemies deal 15 % less to others (was 25 %); bots obey a challenge only while it is fresh (2.5 s) |

### Changes to existing specs

| Spec | Change | Why |
| --- | --- | --- |
| All rage users (Warrior, Berserker) | rage from dealing damage 7.5 % → 9 % of the damage | the melee group lagged (30–41 % in 1v1) and was rage-starved |
| Rogue (both) | 1050 → 1100 health, armor 8 → 10 % | lowest survival of all specs (benchmark), 33–34 % in 1v1 |
| Rogue — Subtlety | Viper Strike 96 → 102, Gutting Edge 60 + 65/pt → 64 + 68/pt | |
| Rogue — Assassination | Venom Mastery 3 → 3.5 % per stack, Envenom 45 + 55/pt → 50 + 60/pt | |
| Warrior — Protection | auto 47 → 50, Rending Blow 110 → 122, Bull Rush cooldown 12 → 10 s, Shieldwall ally reduction 10 → 8 % | 34 % in 1v1; the ally aura then pushed 2v2 to 66 % |
| Warrior — Arms | auto 60 → 62, Execute 80 / 220 → 85 / 228 | overshot to 63 % at +4 / +15, settled in the middle |
| Berserker — Fury | Rending Axes 58 → 62 | |
| Berserker — Executioner | armor 6 → 8 %, auto 60 → 66, crit chance +12 → +15 %, Skullsplitter 140 → 155 and 1.2 → 1.0 s wind-up, Ground Breaker stun 0.8 → 1.0 s, Iron Hide 20 → 25 %, Headtaker 90 / 130 → 100 / 140 | weakest spec for several updates (30–36 %) |
| Mage — Frost | Frost Lance 110 → 104, Arcane Comet 290 → 270 | 65 % in 1v1 |
| Mage — Fire | Fireball 92 → 85 | 61 % in 1v1 |
| Priest — Shadow | Shadow Word: Pain 155 → 166, Shadowform damage taken −15 % → −12 % | |
| Shaman — Elemental | Lightning Lash 88 → 85 (82 in between), Stoneskin Totem 20 → 25 % | 63 % in 1v1 but only 37–39 % in 2v2: less burst, more team protection |
| Shaman — Enhancement | auto 30 → 34, Stormstrike 2 × 50 → 2 × 60, Healing Surge 165 → 180 | 34–36 % in 1v1 |
| Necromancer — Summoner | 1100 → 1180 health | 34–40 % in 2v2 (focused first) |

### Systems that changed balance

- **Left-click basic attacks**: attacks only happen on input; bots hold the button, so bot-vs-bot balance is unchanged
  by this, but players who don't click deal less damage (by design).
- **Taunt / Challenge** (new): see Protection Paladin.
- Divine Shield immunity also blocks harmful effects; bots switch targets away from a shielded paladin.
