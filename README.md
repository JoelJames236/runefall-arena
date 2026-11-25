# Runefall Arena

A browser-based 3D fantasy **arena PvP** game in the spirit of classic MMO arenas: five classes,
30 abilities plus a basic attack each, **1v1 duels and 2v2 team fights**, bots, parties, matchmaking and
peer-to-peer online play via a shareable link. No install, no build step.

**▶ Play now: https://joeljames236.github.io/runefall-arena/**

## Game modes

| Mode | How |
| --- | --- |
| **Duel vs. AI** | 1v1 against a bot (Squire / Knight / Champion difficulty). |
| **2v2 vs. Bots** | You + an AI ally (Aldor) against the bots **Zigi** and **Jöggu**. Pick every class or leave them random. |
| **Play with Friends** | Opens a party lobby (1v1 or 2v2). Share the invite link; friends join your team. Empty slots can be filled with bots, players can be moved between teams. |
| **Find Opponents** | In a 2v2 lobby, the party leader searches for another party that is also searching; when found, their party joins your arena as the Crimson team. |
| **Join Match** | Enter a 6-letter room code (or open an invite link). |

Every match is best of 7 (first to 4 round wins). A round ends when one team is wiped out.

## Play locally

The game uses ES modules, so it must be served over HTTP (opening `index.html` as a file won't work).

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open <http://localhost:8080>. Any static server works too.

## Online play

Online play is peer-to-peer over WebRTC. The free PeerJS cloud broker is only used to introduce browsers
(and to hold the matchmaking queue slots); game traffic then flows directly between players. The lobby
host runs the authoritative simulation — damage, cooldowns, crowd control and match results are decided
there; guests send inputs and receive state snapshots. If a guest disconnects mid-match, a bot takes over
their champion so the match can finish.

- Testing several players on one machine: use separate browser **windows**, not tabs — browsers throttle
  background tabs, which makes a host stutter.
- A few strict networks (symmetric NAT / corporate firewalls) block direct WebRTC connections; that would
  need a TURN relay server, which isn't included.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move / strafe |
| Mouse | Turn camera & champion (click to capture the mouse; if capture is blocked, hold the right button and drag) |
| **Left click** | Basic attack on the enemy under the crosshair (auto-repeats at your attack speed) |
| `1`–`6` | Abilities (`Q` / `E` also trigger 5 / 6) |
| `Tab` | Cycle enemy targets |
| `F1` / `F2` | Friendly target: yourself / your ally (heals and shields go to the friendly target) |
| `Space` / `Shift` | Jump / sprint (stamina) |
| Mouse wheel / `Esc` | Zoom / menu |

## Combat rules

- Every class has a basic attack: Warrior sword swings, Rogue twin slashes (melee); Mage arcane bolts,
  Priest holy sparks, Shaman static bolts (30-yard projectiles, usable while moving). The swing timer caps
  the rate — clicking faster doesn't attack faster.
- **Hits from behind deal 10% more damage.** Direct hits and heals can **crit** (8%, +50%).
- Cast-time spells require standing still; moving or jumping cancels them. The four rune pillars block
  line of sight.
- 1.0 s global cooldown with a short spell-queue window.
- Crowd control has diminishing returns (100% → 50% → 25% → immune, resets after 15 s).
- **Dampening** starts after 60 s and steadily reduces healing and shields, so every round ends.

## Classes

| Class | Resource | Identity | Signature |
| --- | --- | --- | --- |
| Mage | Mana | Ranged frost/fire/arcane burst, frost slows, root, blink | Arcane Comet (big hit + stun) |
| Rogue | Energy + combo points | Fast melee, stealth, teleport behind target, stun finisher | Death Mark (delayed detonation) |
| Warrior | Rage | Tanky melee, charge, slows, interrupt + silence, damage reduction; *Shieldwall* passive protects a nearby ally in 2v2 | Steel Tempest (CC-immune spin) |
| Priest | Mana | Sustain: heals and shields (self or ally), disorient, purge | Halo of Judgment (damage + group heal + purge) |
| Shaman | Mana | Lightning & magma, stun totem, team-protecting totem, wind dash | Fire Spirit (summoned elemental) |

Full numbers live in [`js/data/classes.js`](js/data/classes.js) and are shown in-game on the class screen.

## Balance lab

Open <http://localhost:8080/balance.html> to run headless AI-vs-AI simulations: a 1v1 win-rate matrix, or
every 2v2 team composition against every other. It measures the AI's play rather than expert human play,
so use it as a guide. Latest runs (hard AI): **1v1** — every class between 40% and 60% overall;
**2v2** — every class between 42% and 54%, strongest composition Rogue + Priest (~65%).

## Project layout

```
index.html               UI markup + import map (Three.js, PeerJS from CDN)
css/style.css            Menus, lobby & HUD styling (responsive)
js/main.js               App flow: screens, modes, rooms/parties, matchmaking hand-off, game loop, net glue
js/data/classes.js       Classes, stats, basic attacks and all 30 abilities (gameplay in each ability's exec)
js/sim/sim.js            Authoritative combat simulation for N fighters in two teams (no rendering)
js/sim/ai.js             Bots (same inputs and rules as players): focus targeting, kiting, interrupts, healing
js/net.js                PeerJS star network (host + up to 3 guests) and serverless 2v2 matchmaking
js/input.js              Keyboard + mouse, pointer lock with drag-to-look fallback
js/audio.js              Synthesized SFX + generative orchestral music (Web Audio)
js/render/world.js       Scene, lighting, post-processing, camera, team rings, selection circles
js/render/arena.js       Procedural arena, sky, terrain, crowd, banners, statues, backdrop
js/render/characters.js  Procedural champion models + procedural animation
js/render/vfx.js         Pooled particles (glow + smoke), projectiles, casting circles, spell effects
js/ui/hud.js             Unit/party/arena frames, action bar, cast bars, nameplates, combat text
balance.html             Balance lab
serve.ps1                Tiny local static server
```

All models, textures, music and sound effects are generated in code — there are no external art or
audio assets.
