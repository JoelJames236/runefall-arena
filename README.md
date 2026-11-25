# Runefall Arena

A browser-based 3D fantasy **1v1 arena duel** game: five classes, 30 abilities, best-of-7 matches,
an AI opponent, and peer-to-peer online play via a shareable link. No install, no build step.

**▶ Play now: https://joeljames236.github.io/runefall-arena/**

## Play locally

The game uses ES modules, so it must be served over HTTP (opening `index.html` as a file won't work).

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open <http://localhost:8080>. Any static server works too (`npx serve`, `python -m http.server`, …).

## Play online with a friend

1. Host the folder on any static web host — e.g. push it to GitHub and enable **GitHub Pages**
   (Settings → Pages → deploy from branch). Netlify / Vercel / Cloudflare Pages also work.
2. Open the site, choose **Create Private Match**, and send your friend the link (or the 6-letter room code).
3. Your friend opens the link, both of you pick a class and press **Ready**.

Online play is peer-to-peer over WebRTC. The free PeerJS cloud broker is used only to introduce the two
browsers; game traffic then flows directly between them. The host runs the authoritative simulation.
Notes:
- Testing two players on one machine: use **two separate browser windows** side by side, not two tabs —
  browsers pause background tabs, which makes the host stutter.
- A few strict networks (symmetric NAT / corporate firewalls) block direct WebRTC connections; that would
  need a TURN relay server, which isn't included.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move / strafe |
| Mouse | Turn camera & champion (click the arena to capture the mouse; if capture is blocked, hold a mouse button and drag) |
| `1`–`6` | Abilities (`Q` / `E` also trigger 5 / 6) |
| `Space` | Jump |
| `Shift` | Sprint (uses stamina) |
| `Tab` / left click | Target opponent |
| Mouse wheel | Zoom |
| `Esc` | Menu |

## Rules & mechanics

- Best of 7: first to 4 round wins. Health, resources and cooldowns reset every round.
- Cast-time spells require standing still; moving or jumping cancels them.
- The four rune pillars block line of sight — use them to stop enemy casts.
- 1.0 s global cooldown with a short spell-queue window, so pressing slightly early still fires.
- Crowd control has diminishing returns (100% → 50% → 25% → immune, resets after 15 s).
- **Dampening** starts after 60 s and steadily reduces healing and shields, so every round ends.

## Classes

| Class | Resource | Identity | Signature |
| --- | --- | --- | --- |
| Mage | Mana | Ranged frost/fire/arcane burst, frost slows, root, blink | Arcane Comet (big hit + stun) |
| Rogue | Energy + combo points | Fast melee, stealth, teleport behind target, stun finisher | Death Mark (delayed detonation) |
| Warrior | Rage | Tanky melee, charge, slows, interrupt + silence, damage reduction | Steel Tempest (CC-immune spin) |
| Priest | Mana | Sustain: heals, shields, disorient, purge | Halo of Judgment (damage + heal + purge) |
| Shaman | Mana | Lightning & magma, stun totem, protective totem, wind dash | Fire Spirit (summoned elemental) |

Full numbers live in [`js/data/classes.js`](js/data/classes.js) and are shown in-game on the class screen.

## Balance lab

Open <http://localhost:8080/balance.html> to run headless AI-vs-AI round simulations for every matchup and
print a win-rate matrix. It measures the AI's play rather than expert human play, so use it as a guide
when tuning. Last run (hard AI, 24 rounds per pairing): every class landed between 41% and 54% overall,
but individual matchups still range from about 13% to 88% (Priest vs. Rogue and Priest vs. Shaman are the
most lopsided). Results have roughly ±10% noise at that sample size.

## Project layout

```
index.html            UI markup + import map (Three.js, PeerJS from CDN)
css/style.css         Menus & HUD styling
js/main.js            App flow: screens, match lifecycle, game loop, network glue
js/data/classes.js    Classes, stats and all 30 abilities (gameplay in each ability's exec)
js/sim/sim.js         Authoritative combat simulation (no rendering; serializable snapshots)
js/sim/ai.js          AI opponent (uses the same inputs and rules as a player)
js/net.js             PeerJS wrapper (host / join, room codes)
js/input.js           Keyboard + mouse, pointer lock with drag-to-look fallback
js/audio.js           Synthesized SFX + generative orchestral music (Web Audio)
js/render/world.js    Scene, lighting, post-processing, camera, state → visuals
js/render/arena.js    Procedural arena, sky, crowd, banners, statues, backdrop
js/render/characters.js  Procedural champion models + procedural animation
js/render/vfx.js      Particles, projectiles, telegraphs, spell effects
js/ui/hud.js          Unit frames, action bar, cast bars, floating combat text
balance.html          Balance lab
serve.ps1             Tiny local static server
```

All models, textures, music and sound effects are generated in code — there are no external art or
audio assets. To swap in real 3D models later, replace `Character` in `characters.js` (e.g. with a
GLTF loader); the rest of the game only talks to its `update`/`play` API.
