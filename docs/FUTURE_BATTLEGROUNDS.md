# Battlegrounds

Status: the **5v5 flag battleground "Thornwater Gorge" is built** and playable (main menu → *5v5 Battleground*, or a
friends lobby set to *5 v 5*). **King of the Hill and the 10v10 frontline are still notes only** — not planned in
detail or scheduled. All maps and modes must be original designs — the references below describe the *kind* of
mode, not something to copy.

## Overview

| Mode | Size | Kind | Status |
| --- | --- | --- | --- |
| Flag battleground | 5v5 (small) | capture the flag, in the spirit of a classic two-base flag map but smaller | **built** |
| King of the Hill | 5v5 (small) | hold a central point | idea |
| Frontline battleground | 10v10 (big) | push the enemy back base by base, in the spirit of a large siege valley but smaller | idea |

## 5v5 — Flag battleground: "Thornwater Gorge"

Where it lives in the code:

| File | What |
| --- | --- |
| `js/sim/maps/thornwater.js` | the map as data: blocks, ramps, gates, water, flag stands, graveyards, buff spots, bot waypoints. Only the Gold half is written out, the Crimson half is the same turned 180°. |
| `js/sim/sim.js` | the map layer (`useMap`): floors, walls, ramps, gates, line of sight, camera collision, wading. `null` = the arena. |
| `js/sim/flag.js` | `FlagSim`: the rules — preparation, flags, captures, respawn waves, spawn protection, Exposed, power-ups, match points. |
| `js/sim/flagai.js` | `FlagAI`: bot roles, the waypoint graph (links found by walking), routes, carrier behaviour. |
| `js/render/thornwater.js` | the look, built from the same data, plus the gates, flags and power-up gems. |
| `js/main.js`, `js/ui/hud.js` | the mode, the 5v5 lobby, the network glue, the flag bar, carrier arrows, scoreboard, kill feed, end screen. |

Role model: the classic two-keep capture-the-flag battleground of the MMO genre — two fortified bases at the ends of
a valley, a flag room on each keep's upper floor, several ways in and out, a contested middle, power-ups to fight
over, and the rule that you can only score while your own flag is home. What we take is the *structure and the
rules*; the map, its look and its story are our own, and it is smaller (5 per team instead of 10).

### Setting

A river gorge in the northern marches. Two rival war-keeps face each other across the Thornwater: **Sunward Keep**
(Gold team, west, x < 0) and **Emberhold** (Crimson team, east, x > 0). Each keeps its war banner — the flag — in a
room at the top of the keep. Look: the arena's stone and timber, mossy cliffs and pines, the river under the arena's
stone bridge, a waterfall at the north end of the gorge, braziers and banners in team colors on the keeps.

### Size and layout

The map is **point-symmetric** (turned 180° around the centre it is identical), so neither side has an advantage.

| Measure | Value | Why |
| --- | --- | --- |
| Flag stand to flag stand | 172 yd (x −86 … +86) | a straight run takes ~24 s at running speed (7.2 yd/s): long enough to chase, short enough for 15 min / 3 captures |
| Whole map | 200 × 72 yd | three lanes with cover between them |
| Keep | 36 × 30 yd, two floors | flag room on the upper floor (4.5 yd up) |
| Graveyard to own flag | ~37 yd | defenders return fast; attackers can't camp the graveyard without leaving the flag |

```
   z+ (north)                                            waterfall
  ┌──────────┬────────────────────────────┬─────────────────────────────┬──────────┐
  │ side door│  NORTH LANE: ruins ◆        ≈≈        boulders ◆         │          │
  │ ▲        │   ▓▓ ridge ▓▓   ▓▓ ridge ▓▓ ≈≈                           │ ◆ yard   │
  │ SUNWARD  │                             ≈≈                    ✝ graveyard   ▼  │
  │ KEEP     │ gate                     ◆ ═╬═ bridge (tunnel under)     gate │EMBER-│
  │ [flag]◄ramp ▶  MID LANE          ═╬═ ◆                          ◀ ramp▶[flag]│
  │  ✝ graveyard                         ≈≈                             KEEP │HOLD  │
  │ ◆ yard   │   ▓▓ ridge ▓▓   ▓▓ ridge ▓▓ ≈≈                           │ ▼ side   │
  │ ▼ balcony│  SOUTH LANE: boulders ◆     ≈≈        ruins ◆            │   door   │
  └──────────┴────────────────────────────┴─────────────────────────────┴──────────┘
   x− (west) Gold                         the Thornwater (x = 0)                 Crimson (east) x+
  ◆ = buff spot (see "Power-ups"), ✝ = graveyard, ▓ = rock ridge (the gaps between ridges are cross paths)
```

The Crimson half is the Gold half turned 180° around the centre, so each flank lane has ruins on one half and
boulders on the other, and each team's side door opens north (Gold) or south (Crimson).

**The keep (each side).**
- **Flag room** on the upper floor at the back. The flag stands on a stone plinth in the middle.
- **Three ways out of the flag room**, so a carrier always has a choice and defenders can't hold one door:
  1. **Main ramp** down into the great hall and out through the **main gate** — the fastest way to the middle lane.
  2. **Side passage** — a narrow stair down inside the wall to a **side door** that opens onto a flank lane (north
     for Sunward, south for Emberhold). Slower, but out of sight.
  3. **Balcony drop** — jump from a balcony over the yard (one way out only; it can't be climbed). The quickest
     escape, but it lands you in the open.
- **Great hall** on the ground floor: pillars for line-of-sight fights, a buff spot in one corner.

**The yard** in front of each keep: the team's **graveyard** stands to one side behind a low wall, so the dead come
back between the gate and the middle — ready to stop a carrier on the way out.

**The middle** — three lanes divided by rock ridges and the river:
- **Mid lane**: the shortest route, open ground, the arena's stone bridge over the river (fight on the deck or in
  the tunnel under the arch; the deck blocks line of sight).
- **Flank lanes** (north and south): crumbled ruins on one half, boulders on the other — cover for stealth and
  ambushes, and a longer way for a carrier who wants to avoid the fight.
- The river is shallow everywhere: wading through it is 15 % slower than the bridge.
- Cross paths between the ridges on both banks, so a chase can switch lanes.

### Flow of a match

1. **Preparation (20 s)** — both teams in their great hall behind the closed gates; walk around, buff each other,
   agree on roles. No fighting.
2. **Gates open** — typically 2–3 go on offense, 1–2 stay on defense, a healer floats.
3. **Pick-up** — an attacker reaches the enemy flag room and takes the flag.
4. **Escape and run home** — the carrier chooses a way out, the team escorts, the enemy chases.
5. **Capture** — the carrier reaches their own flag stand **while their own flag is at home**.
6. If both teams hold a flag at the same time, nobody can score: the team that **kills the enemy carrier** (to return
   its own flag) breaks the stand-off. The carrier debuff (below) makes sure this happens.
7. First to **3 captures** wins; otherwise the match ends after **15 minutes**.

### Flag rules

| Rule | Detail |
| --- | --- |
| **Pick-up** | Touch the enemy flag (no channel — speed is the point here; channels are for the banner taps of the other modes). |
| **Capture** | Touch your own flag stand with the enemy flag **while your own flag is on it**. |
| **Carrier** | The flag (with a light beam) shows on the carrier's back; everyone sees an arrow to each carrier — over their head on screen, at the screen edge otherwise — at any range, through walls. |
| **Dropping** | The flag drops where the carrier dies. It also drops when the carrier becomes **untouchable or hidden**: immunities (Divine Shield), stealth / Fade. A carrier can also drop it on purpose (key `G`) to hand it to a tankier teammate; the one who dropped it can't take it back for 2 s. |
| **Dropped flag** | The **owning team returns it instantly by touching it**; the attackers pick it up again by touching it. Untouched for **10 s**, it returns home by itself. |
| **What carriers can do** | Fight, heal, use movement abilities (charges, blinks, Disengage, shapeshifts) — mobility is the counterplay to a chase. Not allowed: stealth and immunities (they drop the flag, see above). |
| **Exposed (stand-off breaker)** | When **both flags have been carried at the same time for 60 s**, both carriers get *Exposed*: +10 % damage taken, one more stack every 30 s (up to 5 = +50 %). Cleared when a flag is captured or returned. |
| **One flag per carrier** | A carrier can't pick up a second flag (their own dropped flag must be returned by a teammate). |

### Win conditions

- **3 captures** win at once.
- **Time-out (15 min)**: more captures wins; on equal captures, the team that **captured last** wins; at 0 : 0 it is a
  **draw**.
- **Leavers**: a bot takes over (as in the arenas). (A forfeit for a team left without humans is not built.)

### Death and respawn

- Respawn in **waves every 20 s** at your team's graveyard, with full health and resources. Cooldowns keep running
  through death (no reset to full — that would reward dying).
- A death just before a wave waits for the next one (at least 4 s dead). The screen shows "Back at the graveyard
  in N s".
- **3 s of spawn protection** (*Sanctuary*: immune), broken the moment you attack or cast or move more than 7 yd from
  the graveyard — against spawn camping.
- Pets and summons respawn with their owner. No dampening in battlegrounds (that's an arena rule to end rounds; here
  the clock and Exposed do that job).

### Power-ups

Battlegrounds use the random pickups from "Map pickups" below, set up for this map:

- **Ten buff spots** (◆) in five mirrored pairs: each keep's great hall, each yard, each flank lane on each side of
  the river, and beside the bridge on each bank.
- **When the gates open and then every 60 s, three pairs light up** (only free ones). The spot and the buff are random, **but always mirrored**: when a spot on the
  Gold side spawns *Haste*, its mirror spot on the Crimson side spawns *Haste* too. Random every match, fair every time.
- A buff is taken by running into it; it is gone for everybody once taken.

| Buff | Effect | Duration |
| --- | --- | --- |
| Haste | +40 % movement speed | 10 s |
| Fury | +25 % damage dealt, +10 % damage taken | 20 s |
| Mending | heals 40 % of health and resources over 6 s; broken by damage | 6 s |
| Stoneskin | absorbs 20 % of max health | 15 s |
| Shockwave | a one-time charge: the next ability you use also stuns enemies within 6 yd for 1.5 s (normal diminishing returns) | 30 s to use |
| Clarity | −30 % cooldowns on your next three abilities | 20 s |

A flag carrier *can* take buffs — fighting over the mid buff while running the flag is part of the map.

### Roles (for players and bots)

| Role | Usually | Job |
| --- | --- | --- |
| **Flag carrier** | Protection Warrior / Paladin, Feral (bear), Enhancement | survive the run home, use mobility, call for heals |
| **Escort / peel** | healer + one control spec | keep the carrier alive, slow and stun the chasers |
| **Offense** | Subtlety / Assassination, Fire / Frost, Sharpshooter | reach the enemy flag room, kill defenders, grab the flag |
| **Defense** | one or two control specs (Frost, Shadow, Curser, Restoration) | guard the own flag room, chase and kill the enemy carrier, return the flag |

How the bots do it (`js/sim/flagai.js`): each team gets roles from its specs at the start — the healer escorts, the
most controlling spec defends, the toughest attacker holds the **middle** (fights everyone on its way to the enemy
flag), the rest are **offense** (they push through: they shoot and cast on the move and only stand to fight when an
enemy is right on them or they are hurt — without that, both teams stalled in one brawl in the middle and no flag was
ever reached). Events override roles: own flag taken → the defender and the nearest three hunt the carrier (it
becomes their focus target); own flag dropped → the nearest two return it; enemy flag dropped → the nearest picks it
up; a teammate carries → everyone but the defender escorts. Carriers sprint home on a route that avoids enemies and
wait in their flag room while their own flag is away. Routes come from a waypoint graph (the three lanes, the cross
paths, the three ways out of each flag room) whose links are found by walking them once. In headless all-bot
matches this gives scores like 3:1, 3:2, 1:0, 1:2 after 6–15 minutes, with stand-offs that Exposed breaks.

### Interface

- **Top bar**: the captures (3 pips per team), the clock (gates open in … / time left) and both flags with their
  state — *safe* / *carried by Zigi 64 % · Exposed +20 %* / *dropped (7)*.
- **Announcements and a kill feed**: "Jöggu has taken our flag!", "You have the enemy flag!", "Aldor captured the
  Crimson flag!" as banners; drops, returns, kills, power-ups taken by allies in a feed at the right. Enemy big
  cooldowns are only called out for enemies near you or your target.
- **Flag direction**: an arrow to each flag that is out (carrier or dropped), with name and distance.
- **Scoreboard** (hold `B`): kills, deaths, captures, returns, damage, healing and the respawn timer per player, and
  when the next power-ups come.
- **Nameplates** only for champions within 50 yd (allies 70 yd), enemies not through walls; carriers get a ⚑.
- **End screen**: captures, returns, carrier kills, kills, damage, healing and match points for all ten, the MVP
  (most points).

### Match points (rewards)

| Action | Points |
| --- | --- |
| Capture the flag | 50 |
| Return your flag | 15 |
| Kill the enemy carrier | 15 |
| Pick up the enemy flag | 5 |
| Kill | 4 (assists are not counted yet) |
| Healing, per 1,000 done | 3 |
| Win / draw / loss | +40 / +20 / +10 |

What points buy (cosmetics, a ranking, nothing but a score) is still open — see "Rewards" below.

### Team rules

- 5 champions per team, any mix. Random bots never make more than **2 of the same class** in a team (they avoid
  repeats altogether while they can); players pick freely.
- Everything else is the arena's: the same abilities, aimed basic attacks, hitboxes, crowd control and diminishing
  returns. No dampening (the clock and Exposed end stand-offs).
- Balance has its own format in `js/data/tuning.js`: `bg5`. It starts as a copy of the 2v2 (`team`) factors — a
  battleground is many small team fights — until a 5v5 auto-tune is run.

### How to play it

- **Offline**: main menu → *5v5 Battleground* → pick your champion and the bot difficulty → you + 4 bots against 5
  bots, classes rolled at random every match.
- **Online**: *Play with Friends* → lobby format *5 v 5 ⚑* → up to 10 players (the host plus 9 guests), empty slots
  can be bots. The host runs the simulation and sends 15 snapshots a second (statistics only in every 8th, to keep
  the host's upload down with nine guests). Matchmaking ("Find Opponents") is 2v2 only.
- Keys on top of the arena's: `G` drops the flag, hold `B` for the scoreboard.

### Still open

- A `bg5` auto-tune in the balance lab (5v5 bot matches are ~10× the work of a 2v2).
- Assists, a forfeit for teams without humans, matchmaking for 5v5.
- Bots don't use the balcony drop on purpose (the waypoint exists; routes rarely pick it).

## 5v5 — King of the Hill

- One central point; a team scores while it holds it uncontested.
- Open questions: score target or timer, whether the hill moves, respawn waves, what counts as contested.

## 10v10 — Frontline battleground (separate mode)

- Each team has **3 bases** in a row. The teams push each other back **one base at a time**.
- **Several routes, one path**: there are separate ways through the map, but they all lead into the same line of bases,
  so the fight always has a front.
- **Back and forth**: a team that loses a base can hold the next one, strike back and **retake** the lost position —
  and the other way round. Progress is never locked in.
- **Lose condition**: the team whose **last base** is conquered loses.
- Open questions: respawn location relative to the front, a time limit / tiebreaker, how the side routes rejoin the
  main path.

### How a base is conquered (decided): tap the banner

Every base has one banner. Conquering is a **tap in two stages** — it fits this game because it reuses what combat
already has (cast bars, interrupts, crowd control) instead of adding a new system:

1. **Tap** — a champion channels on the banner for **6 s** (a normal cast bar, standing still, within 4 yd).
   **Any damage or crowd control on the tapper breaks the tap**; so does moving. Only one champion per team can tap
   a banner at a time. Stealth breaks when the tap starts.
2. **Contested** — a finished tap does not take the base yet. The banner turns grey and a **30 s** timer runs. The
   defenders can **tap it back** during that time (same 6 s channel), which restores it at once. If the timer runs
   out, the base belongs to the attackers.

Rules around it:
- **Only the front base can be tapped**: a team's bases fall in order (outer, middle, last), and you can only tap
  the enemy base that borders the ones you hold. No sneaking to the last base.
- **Retaking is the same tap** on the base you lost — and it is only possible while the enemy has not also taken
  your next base (the front moves, it never splits).
- **Owning a base** moves your team's respawn point up to it and gives the defenders nothing else — no guards, no
  turrets: the fight is between players.
- **Why not "stand in the circle"**: with 10v10 it rewards the bigger blob and nothing else. A tap makes one
  champion the target, so peeling for the tapper, interrupting the tap and area damage on the banner all matter —
  the same skills the arenas teach. **Why not a guardian to kill**: it would need a new bot enemy and its own balance.
- Numbers (6 s, 30 s) are starting points for testing.

The same banner tap would be the capture rule for **King of the Hill** (tap the hill's banner; your team scores
while it is yours) so both modes share one mechanic.

## Shared battleground rules (decided): the conventions of classic MMO battlegrounds

The modes follow the rules players know from classic MMO battlegrounds. Rules and mechanics are taken as a genre
convention; maps, names, art and lore stay our own.

| Rule | How it works here |
| --- | --- |
| **Preparation** | 20 s behind closed gates at the start (the flag map; bigger maps may want 30 s): buff up, pick routes. Gates open for both teams at once. |
| **Graveyards and respawn waves** | The dead respawn together every 20 s at their team's nearest graveyard (in the 10v10: at the foremost base the team holds). Waves make deaths matter and bring teams back as a group. |
| **Banner tap** | As above: channel on the banner, broken by damage / control, then a contested timer before it flips. Used for bases (10v10) and the hill (5v5). |
| **Resource score (King of the Hill)** | The team holding the hill gains points every second; first to the target (e.g. 1,000) wins. A scoreboard at the top shows both totals. |
| **Flag rules (5v5 flag map)** | Pick up the enemy flag by running into it, carry it to your own flag stand. **You can only capture while your own flag is at home.** A dropped flag lies for a few seconds; your team returns its own flag by touching it. First to **3 captures** wins. |
| **Flag-carrier pressure** | Stealth and immunities drop the flag; movement abilities are allowed. When both flags are carried at once, both carriers start taking more damage (stacking every 30 s), so stand-offs end. Details in the flag map's design. |
| **Time limit** | Flag map 15 min, hill 10 min, frontline 20 min. On time-out: more captures / points / bases wins; on a tie, the team that scored last. |
| **Match rewards** | Points per match for objectives, not only kills: taps, defends, flag captures and returns, healing done, kills. A results table at the end like the arena's. Winning gives a bonus. What the points buy is still open. |
| **Deserters / leavers** | A bot takes over a player who leaves (as the arenas already do). |

The tap timings above (6 s tap, 30 s contested) are shorter than the genre's usual ones because these maps are smaller.

## Map pickups (all battlegrounds, mainly the 10v10)

- Buffs and effects scattered over the whole map to keep it interesting: **speed, damage, healing, area stun** and more.
- **Spawn points and types are completely random** — mirrored between the two halves of a map so both teams get the
  same luck (the flag map's design lists the buffs and spots).
- Open questions: duration and strength, respawn interval, whether the enemy sees them, whether carriers of a
  flag / defenders of a base can use them.

## Rewards (maybe)

- Some kind of reward for playing — points or similar. Undecided: what they are for (ranking, cosmetics, nothing but
  a score).

## Technical state (what the 5v5 built, what the others would still need)

- **Map layer** (built): `useMap(map)` in `js/sim/sim.js` — box walls and floors, ramps, gates, water, rectangular
  bounds — read by movement, collision, line of sight, the camera and the renderer. A new map is a data file like
  `js/sim/maps/thornwater.js` plus its look.
- **Objectives and respawns** (built for flags): `FlagSim` extends `Sim` (one long match, respawn waves, no rounds).
  King of the Hill / the frontline would be further subclasses with the banner tap.
- **Bots** (built for flags): `FlagAI` extends `AI` with roles and waypoint routes; the arena AI still does the
  fighting.
- **Networking**: host-authoritative peer-to-peer, a star of WebRTC connections (`js/net.js`); the host now takes up to
  9 guests. 10 players work on a normal home connection (15 snapshots/s, statistics rarely); **20 players would need
  a relay / server** or much smaller snapshots.
- **Rendering**: 10 champions plus pets on a 200 × 72 yd map run fine (the sun's shadow box follows the player);
  20 would need a look at shadows and effects.
- **Balance**: `bg5` is a copy of the 2v2 factors so far; each new format needs its own auto-tune run.
