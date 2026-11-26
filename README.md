# Runefall Arena

A browser-based 3D fantasy **arena PvP** game in the spirit of classic MMO arenas: nine classes (three of them with their own race),
two specs per class (18 playable kits), pets and shapeshifting, **1v1 duels and 2v2 team fights**, bots, parties, matchmaking and
peer-to-peer online play via a shareable link. No install, no build step.

**▶ Play now: https://joeljames236.github.io/runefall-arena/**

## Game modes

| Mode | How |
| --- | --- |
| **Duel vs. AI** | 1v1 against a bot (Squire / Knight / Champion difficulty). Pick its class and spec, or leave it on 🎲 Random. |
| **2v2 vs. Bots** | You + an AI ally (Aldor) against the bots **Zigi** and **Jöggu**. Pick every class or leave them random. |
| **Play with Friends** | Opens a party lobby (1v1 or 2v2). Share the invite link; friends join your team. Empty slots can be filled with bots (new bots are 🎲 Random — class and spec are rolled at every match start — or pick one), players can be moved between teams. |
| **Find Opponents** | In a 2v2 lobby, the party leader searches for another party that is also searching; when found, their party joins your arena as the Crimson team. |
| **Join Match** | Enter a 6-letter room code (or open an invite link). |

Every match is best of 7 (first to 4 round wins). A round ends when one team is wiped out.

## Play locally

The game uses ES modules, so it must be served over HTTP (opening `index.html` as a file won't work).

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open <http://localhost:8080>. Any static server works too.

## Host it from your PC (private, password-protected)

`host-arena.ps1` serves the game from your PC behind a password. The game only exists while the script
runs: close it or turn the PC off and nobody can get in.

```powershell
winget install --id Cloudflare.cloudflared      # once: gives you a public HTTPS link, no router setup
powershell -ExecutionPolicy Bypass -File host-arena.ps1
```

- The first run asks for a password and keeps it in `.arena-password` (git-ignored). `-ResetPassword` picks a new one,
  which also logs everyone out.
- The script prints a `https://….trycloudflare.com` link and copies it to the clipboard. Send it to friends with the
  password. The link is new every time you start the script.
- Every login and failed attempt shows in the window. 5 wrong passwords lock that IP out for 5 minutes.
- `-NoTunnel` serves only on this PC (<http://localhost:8090>). `-Port 8091` if 8090 is busy.

The script only serves the game files (`index.html`, `balance.html`, `css/`, `js/`, `assets/`), never the scripts,
the password file or `.git`. As long as GitHub Pages is on and this repository is public, anyone can still play the
copy there or download the code, so turn Pages off and make the repository private if the game should only exist on your PC.

## Online play

Online play is peer-to-peer over WebRTC. The free PeerJS cloud broker is only used to introduce browsers
(and to hold the matchmaking queue slots); game traffic then flows directly between players. The lobby
host runs the authoritative simulation — damage, cooldowns, crowd control and match results are decided
there; guests send inputs and receive state snapshots. If a guest disconnects mid-match, a bot takes over
their champion so the match can finish. A guest's own ability presses show at once (global cooldown, cooldown,
cast bar, casting pose, animation and sound of instants); the host's snapshots then confirm them, and a press the
host refused or queued disappears again within half a second.

- Testing several players on one machine: use separate browser **windows**, not tabs — browsers throttle
  background tabs, which makes a host stutter.
- A few strict networks (symmetric NAT / corporate firewalls) block direct WebRTC connections; that would
  need a TURN relay server, which isn't included.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move / strafe |
| Mouse | Turn camera & champion (click the arena to capture the mouse; if the browser refuses once — e.g. right after Esc — the next click captures it again. Where capture is impossible, such as an embedded view, the cursor itself aims and the right button held turns the camera) |
| **Left click** | Basic attack where the dot in the middle of the screen points (aimed — it hits the enemy hitbox under the dot, or nothing). One swing per click, hold to keep swinging at your attack speed. The enemy you click on also becomes your target |
| `1`–`6` | Abilities (`Q` / `E` also trigger 5 / 6). **Rebind them in Settings** → Ability Keys: two keys per slot, any key or the middle / back / forward mouse button |
| `Tab` | Cycle enemy targets |
| `F1` / `F2` | Friendly target: yourself / your ally (heals and shields go to the friendly target) |
| Crosshair on an ally | **Mouseover healing**: heals and shields go to the ally under the crosshair (or under the cursor without mouse capture) without changing your friendly target; the ally's frame and nameplate light up green. Can be turned off in Settings |
| `Space` / `Shift` | Jump / sprint (stamina) |
| Mouse wheel / `Esc` | Zoom / menu |

## Combat rules

- Every class has a basic attack: Warrior cleaver swings, Rogue twin slashes, Paladin hammer blows (melee); Mage arcane
  bolts, Priest holy sparks, Shaman static bolts (30-yard projectiles, usable while moving).
- **Basic attacks are aimed.** One left click = one swing or shot (a click shortly before the swing timer is ready is
  buffered); holding the button keeps swinging. The swing timer caps the rate. Every swing goes off, and it hits
  whatever is under the **dot in the middle of the screen** — the selected target doesn't matter. The dot turns
  red while an enemy your basic attack can reach is under it; the enemy you click on also becomes your target (for
  abilities), and so does the first enemy you hit when you have none.
- **Hitboxes are the same for everyone**: a capsule of 0.55 yd radius from the ankles to just above head height
  (0.1–1.95 yd), whatever the size of the champion's model — a dwarf is as easy to hit as a bull-folk druid.
  Pets and summons (the necromancer's ghoul and abomination, the hunter's gorilla, the spirit wolf) share one smaller
  hitbox (0.45 yd radius, up to 1.5 yd) and can be hit on their own; one standing in front of its master takes the hit.
- **Melee swings land on the blow**: a swing starts on your click and its damage lands 0.13–0.24 s later (heavier
  weapons take longer), exactly when the animation connects. At that moment the aim counts: the blow hits the first
  enemy hitbox under the dot that is within 4.5 yd and inside your frontal 200° arc (the swing sweeps a little, so
  the dot counts 0.25 yd wider). Otherwise it is a **Miss** and the swing is spent.
- **Ranged basic attacks fly straight** from your weapon to the point under the dot (no homing): a moving target
  has to be led, and a pillar, the bridge or the ground in the way stops the shot. Abilities still go to your target.
- Bots aim too: they only swing when a hit is possible, ranged bots lead their shots, and their aim error depends
  on the difficulty (Squire ±0.9 yd, Knight ±0.45 yd, Champion ±0.2 yd).
- **Melee leeway**: while you *and* your target are both moving, melee swings and strikes reach 0.8 yd further, so
  chasing a running enemy doesn't drop every other swing. When your target is outside your frontal arc, melee slots
  show a turn arrow (↻) and the crosshair turns orange.
- **Team fights last longer**: in 2v2 every champion has 50% more health (the same damage would otherwise end a
  focused fight in ~11 s; now the first kill comes after ~16 s).
- **Arcane Comet** (Frost Mage signature) shatters on a pillar if the target gets behind cover while it flies.
- **Callouts**: when an enemy uses a big cooldown (30 s or more, or its signature ability) a line names it at the
  top of the screen.
- **Hits from behind deal 10% more damage.** Direct hits and heals can **crit** (8%, +50%).
- Cast-time spells require standing still; moving (on your own input — being shoved doesn't count) or jumping
  cancels them. A cast pressed while still running waits up to 0.45 s for you to stop instead of failing.
  The four rune pillars block line of sight.
- **The bridge** spans the middle of the arena: run up a ramp and fight on the deck (4.4 m up), or run through the
  wide vaulted arch underneath. Deck, ramps and arch block line of sight; melee can't reach between deck and floor, and charges
  stop short of a target on the other level. Drop off the side to escape.
- 1.0 s global cooldown. **Spell queue**: an ability pressed in the last 0.5 s of the global cooldown *or of your
  current cast* is buffered and fires the moment it can.
- Crowd control has diminishing returns (100% → 50% → 25% → immune, resets after 15 s).
- **Dampening** starts after 60 s and steadily reduces healing and shields, so every round ends.
- **Taunt (Challenge)**: a Protection Paladin's Shield Slam, Sentinel's Shield, Consecration and Guardian's Resolve
  *Challenge* enemies — a Challenged enemy deals 15% less damage to anyone but that paladin, and bots turn on him.

## Classes

Every class has a fixed race; both specs share it, but each spec has its own equipment set.

| Class | Race | Resource | Identity | Signature |
| --- | --- | --- | --- | --- |
| Mage | Sun Elf | Mana | Ranged frost/fire/arcane burst, frost slows, root, blink | Arcane Comet (big hit + stun) / Meteor |
| Rogue | Human | Energy + combo points | Fast melee, stealth, teleport behind target, stun finisher | Death Mark / Plague Cloud |
| Warrior | Orc | Rage | Tanky melee, charge, slows, interrupt + silence, damage reduction; *Shieldwall* passive in 2v2 | Steel Tempest / Bladestorm |
| Berserker | Dwarf | Rage | Bare-chested slayer: bleeds, execute, axe throw (root), leap slam, lifesteal; *Bloodrage* — up to +50% damage as his health drops | Berserk / Headtaker |
| **Paladin** | Human | Mana + Holy Power (3) | Plate-clad holy warrior: builds Holy Power, spends it on a healing Radiant Storm (Crusader) or on Holy Shield (Protection tank with taunts) | Divine Wrath / Guardian's Resolve |
| Priest | Human | Mana | Sustain: heals and shields (self or ally), disorient, purge | Halo of Judgment / Void Eruption |
| Shaman | Orc | Mana | Lightning & magma, stun totem, team-protecting totem, wind dash | Fire Spirit / Spirit Wolf |
| Hunter | Jungle Troll | Focus | Ranged bow / crossbow, stings, traps, disengage; Beastmaster fights with a silverback gorilla | Bestial Wrath / Piercing Volley |
| Necromancer | Undead | Mana | Ranged only: rot, bone spears, a ghoul servant or stacking curses; fragile in melee | Abomination / Doom |
| Druid | Bull-folk | Mana / Energy | Feral shapeshifts between panther (damage) and bear (tank); Restoration heals over time and roots | Berserk Instinct / Tree of Life |

Full numbers live in [`js/data/classes.js`](js/data/classes.js) and are shown in-game on the class screen.

### Specs

Every class has **two specs**, picked on the class screen (spec cards under the class name) and locked for the
match. Bots get a spec too: pick it next to the bot's class (2v2 vs bots and party lobby) or leave it on random.
The spec shows on unit frames, nameplates and in the lobby.

| Class | Spec 1 (original kit) | Spec 2 |
| --- | --- | --- |
| Mage | ❄ **Frost**: turret caster, *Shatter* (+20% crit vs rooted, crits +60%), Frostbite, Arcane Shift with 2 charges | 🔥 **Fire**: Fireball and Meteor cast on the move (at 65% speed), *Kindling* Burning stacks, Flame Ring, Blazing Step, Meteor (delayed AoE knockdown) |
| Rogue | 🗡 Subtlety | 🐍 **Assassination**: *Venom Mastery* (slashes stack Deadly Poison, +3.5% damage per stack), Envenom, Crippling Poison, Plague Cloud |
| Warrior | 🛡 Protection | ⚔ **Arms**: two-handed greatsword, *Battle Trance* (+35% vs targets below 30%), Execute, Die by the Sword, Bladestorm leap |
| Berserker | 🪓 Fury: two axes, fast flurries | 💀 **Executioner**: one great axe, slow swings, big crits (*Heavy Hands*: +15% crit chance, crits +80%); Skullsplitter, Ground Breaker, Iron Hide, Headtaker |
| Paladin | ☀ **Crusader**: two-handed sun hammer with holy autos, Holy Strike, Judgment (+15% holy damage taken, speed burst), Radiant Storm (Holy Power spender, AoE + self-heal), Hammer of Light (stun), Divine Shield (immunity), Divine Wrath | 🛡 **Protection**: sword & tower shield tank, *Righteous Vow* (5% less damage taken, Challenge/taunt), Shield Slam, Sentinel's Shield (bouncing silence), Consecration, Holy Shield (Holy Power → damage reduction + heal), Guardian's Resolve |
| Priest | ✦ Discipline | 🌑 **Shadow**: *Shadowform* (+15% shadow damage, 15% less taken), Shadow Word: Pain, Mind Blast (self-heal), Psychic Scream, Void Eruption |
| Shaman | ⚡ Elemental | 🐺 **Enhancement**: melee with two storm axes, *Maelstrom* (lightning procs), Stormstrike, Lava Lash, Healing Surge, Earthbind Totem, Spirit Wolf pet |
| Hunter | 🐾 **Beastmaster**: silverback gorilla pet, Kill Command, Serpent Sting, Intimidation, Bestial Wrath | 🎯 **Sharpshooter**: no pet, crossbow, *Steady Aim*, Aimed Shot, Freezing Trap, Piercing Volley |
| Necromancer | 💀 **Summoner**: ghoul servant that keeps rising, Soul Rot, Corpse Explosion, Abomination | ☠ **Curser**: *Martyr's Curse* (more curses = more damage taken, both ways), Curse of Agony / Weakness, Soul Siphon, Doom |
| Druid | 🐾 **Feral**: cat form (Rake, Shred, Ferocious Bite) ⇄ bear form (Maul, Thrash, Frenzied Regeneration), Wild Pounce, Berserk Instinct | 🌳 **Restoration**: stacking Rejuvenation, Regrowth, Moonfire, Entangling Roots, Wild Charge, Tree of Life |

Design of all specs: [`docs/CLASSES_AND_SPECS.md`](docs/CLASSES_AND_SPECS.md).

## Graphics

- **Races with real proportions.** One CC0 humanoid rig serves every race; [`races.js`](js/render/races.js) bakes
  each race's limb lengths, thickness, chest width, neck, head size and face shape (jaw, brow, nose, muzzle, chin)
  into the bind pose, so animations never shear. Dwarves are short and stocky, orcs massive and hunched, sun elves
  tall and slender, trolls long-limbed, the undead gaunt, the bull-folk huge with a muzzle and hooves.
- **A gear set per spec.** [`outfits.js`](js/render/outfits.js) builds a complete equipment set for each of the
  20 specs — different pauldrons, helms, chest pieces, bracers, belts, skirts and back items (crystal-shard
  pauldrons and an ice crown for Frost, phoenix plumes for Fire, spiked tusked iron for orc Protection, a single
  colossal pauldron for Arms, winged helm and sunburst plate for Crusader, a visored bastion helm and tower shield
  for Protection Paladin, cowls, wolf pelts, beast skulls, a feathered hat, antler crowns …).
- **Druid forms** ([`beasts.js`](js/render/beasts.js)): a skinned great cat and bear with real anatomy (one swept
  mesh over a full skeleton), fur colouring and an alpha-tested fur shell, and procedural walk, gallop, pounce /
  rear-up maul, idle and death animation.
- **Look**: brighter, more saturated grade, warm key light with a cool back light, and a fresnel rim light on all
  champions so silhouettes read at any distance.
- **Performance**: every champion is folded into one skinned mesh per material ([`consolidate.js`](js/render/consolidate.js)):
  body, outfit, head, hair, rigid armor and static weapon parts — roughly 55 draw calls per champion became about 20.
  Glow / rune materials are shared, effects never add lights at runtime (no shader recompiles mid-fight), and the
  Low / Medium / High quality setting still controls shadows, bloom and resolution.

## Balance lab

Open <http://localhost:8080/balance.html> to run headless AI-vs-AI simulations: a 1v1 win-rate matrix, every 2v2
team composition against every other, or the **spec benchmark** (every spec under identical conditions: sustained
and burst DPS against a target dummy, survival time under a fixed damage stream, healing on a partner). It measures
the AI's play rather than expert human play, so use it as a guide. Every playable spec is its own entry
(e.g. `paladin:crusader`). Latest numbers and the full change log: [`docs/BALANCE.md`](docs/BALANCE.md).

**Arena tuning.** Every spec has a power factor for 1v1 and one for 2v2 (`js/data/tuning.js`, shown on the champion
screen as e.g. "1v1 −4 % · 2v2 +6 % damage and healing"). A kit that wins duels is not the kit that wins team
fights, so ability numbers alone left specs at 61 % in one format and 37 % in the other. The lab's **Auto-tune** mode
finds the factors: it measures a format with hard bots, moves each factor against its distance from 50 %, and repeats.
Re-run it after changing abilities and paste the printed table into the file.

## Project layout

```
index.html               UI markup + import map (Three.js, PeerJS from CDN)
css/style.css            Menus, lobby & HUD styling (responsive)
js/main.js               App flow: screens, modes, rooms/parties, matchmaking hand-off, game loop, net glue
js/data/classes.js       Classes, specs, forms, stats and all abilities (gameplay in each ability's exec)
js/data/tuning.js        Arena tuning: power factor per spec for 1v1 and 2v2 (found by the lab's auto-tune)
js/sim/sim.js            Authoritative combat simulation for N fighters in two teams (no rendering)
js/sim/ai.js             Bots (same inputs and rules as players): focus targeting, kiting, interrupts, healing
js/net.js                PeerJS star network (host + up to 3 guests) and serverless 2v2 matchmaking
js/input.js              Keyboard + mouse, pointer lock with drag-to-look fallback
js/audio.js              Synthesized SFX + generative orchestral music (Web Audio)
js/render/world.js       Scene, lighting, post-processing, camera, team rings, selection circles
js/render/arena.js       Procedural arena, sky, terrain, crowd, banners, statues, backdrop
js/render/bridge.js      The central arch bridge (same dimensions as BRIDGE in sim.js)
js/render/heroes.js      Rigged champions (looks per class + spec, animation mixer, weapon grips, rim light)
js/render/races.js       Race proportions + face shapes baked into the bind pose
js/render/outfits.js     Race anatomy (ears, tusks, beards, horns, hooves) and one gear set per spec
js/render/consolidate.js Folds a champion into one skinned mesh per material (draw calls)
js/render/beasts.js      Druid Cat Form / Bear Form: skinned procedural creatures with gait animation
js/render/armory.js      Materials, armor building blocks and all weapons (built in code)
js/render/minions.js     Pets & summons (wolf, gorilla, ghoul hookup) and the treant form
js/render/creatures.js   Generated Cat / Bear form models (Tripo, four-legged rig) with a procedural gait; beasts.js is the fallback
js/render/characters.js  Procedural fallback champion models
js/render/vfx.js         Pooled particles (glow + smoke), projectiles, casting circles, spell effects
js/ui/hud.js             Unit/party/arena frames, action bar, cast bars, nameplates, combat text
balance.html             Balance lab
serve.ps1                Tiny local static server
```

The champions are built from CC0 assets (see [`assets/CREDITS.md`](assets/CREDITS.md)); every armor set, weapon,
race feature, creature, spell effect, the music and the sound effects are generated in code.
