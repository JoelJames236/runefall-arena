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

## Where every spec stands (benchmark from an earlier update; current win rates are in the first change log below)

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
| Hunter — Beastmaster | jungle cat damage 17 → 22 |
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
