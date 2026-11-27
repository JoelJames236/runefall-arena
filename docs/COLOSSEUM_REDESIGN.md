# Kingsreach Colosseum — the new 1v1 / 2v2 arena

Status: **built** (2026-11-27). The Kingsreach Colosseum is the default 1v1/2v2 arena; the old one is in the menu as
"Classic Colosseum". This file holds the design, the research behind it, the model list
(`assets/models/colosseum/queue.json` holds the Tripo prompts and task ids) and how it was made (§7).
Screenshots: `docs/images/kingsreach-*.jpg`; a preview of every model: `assets/models/colosseum/previews/`.

## 0. Decisions

The user asked for a very detailed new arena for 1v1/2v2 with spectators. It should keep the colosseum /
medieval theme and the hand-painted model style of the Thornwater models, without the 5v5 colours. They were
asked four questions and left the choices to me ("just do it yourself"):

| Question | Decision | Why |
| --- | --- | --- |
| Fight layout | **Same as today**: ring r = 29, four pillars (r = 2.0 at 13 yd on the diagonals), the central bridge | Balance (`js/data/tuning.js`) and the bots are tuned to it; every arena shares the fight zone (`js/render/arenas.js`). Only the look changes. |
| Replace or add | **Added as the new default arena**; today's colosseum stays in the menu as "Classic Colosseum" | Nothing is lost; the arena picker already exists. |
| Mood | **Golden sunset** | Warm low sun, glowing awning sails, long pillar shadows; different from the dusky Classic look. |
| Crowd | **All the game's races** plus nobles and a king | Ties the stands to the world of the champions (human, elf, orc, dwarf, troll, undead, bull-folk). |

## 1. Research

**WoW arenas** (the reference the user named):
- *Nagrand Arena* is the "fair" map tournaments start on: flat floor, four pillars, two starting tunnels. Our
  layout is the same idea, so it stays. ([Liquipedia](https://liquipedia.net/worldofwarcraft/Nagrand_Arena))
- *Ring of Valor* (Orgrimmar) is the true colosseum: a round pit surrounded by a packed crowd. Its moving pillars
  were disliked because line of sight was never reliable — another reason to keep fixed pillars.
  ([Warcraft Wiki](https://warcraft.wiki.gg/wiki/The_Ring_of_Valor), [Engadget](https://www.engadget.com/2010-03-23-blood-sport-ring-of-valor-problems-and-possible-solutions.html))
- *Tol'viron* and *Tiger's Peak* reuse the four-pillar idea and dress the pillars as giant statues — we do the same:
  each pillar becomes a plinth carrying a bronze champion. ([PC Gamer](https://www.pcgamer.com/prepare-for-pvp-in-wows-upcoming-battlegrounds))
- *Maldraxxus Coliseum* is a theatre with tiered stands and spectators watching from above.
  ([Warcraft Wiki](https://warcraft.wiki.gg/wiki/Maldraxxus_Coliseum))
- Arena design rules that keep coming up: simple, symmetric, a few solid line-of-sight blockers, open space, no
  clutter in the fighting area. ([SWTOR forum](https://forums.swtor.com/topic/696995-lets-talk-arena-maps),
  [New World dev blog](https://www.newworld.com/en-us/news/articles/behind-the-scenes-arenas))

**Real colosseums** (for believable detail):
- Rome: sand floor (*harena*) over the *hypogeum* with trapdoors and lifts; the *podium* terrace for dignitaries;
  the emperor's box on one long side and a box for the city prefect opposite; *vomitoria* tunnels that pour the
  crowd into the stands; a *velarium* awning on masts around the rim; three storeys of arcades outside.
  ([TheCollector](https://www.thecollector.com/engineering-marvels-of-the-colosseum/), [World History](https://www.worldhistory.org/Colosseum/))
- Arles: after Rome fell the amphitheatre became a fortress with **four watchtowers** on its rim and a town inside.
  That gives the medieval twist: an ancient colosseum reclaimed by a medieval kingdom.
  ([Wikipedia](https://en.wikipedia.org/wiki/Arles_Amphitheatre))

## 2. Concept

> **Kingsreach Colosseum** — the ancient amphitheatre of a vanished empire, reclaimed by the kingdom of Kingsreach.
> Its warm sandstone tiers are crowned with four medieval watchtowers, timber galleries and striped sails. At sunset
> the whole realm comes to watch: townsfolk, dwarves, orcs, elves, trolls, undead and bull-folk pack the stands, the
> nobles sit on the cushioned podium and the king watches from his purple box.

Ground rules:
- **Original IP**: our own kingdom, crests and names. Genre look only (stylized fantasy MMO), no names or emblems
  from any existing game, no trademarked words in prompts.
- **Fight zone unchanged**: nothing new inside r = 29 except flat floor markings. Pillar plinths are round with
  r = 2.0 (the collider) up to above head height; the bridge keeps its exact shape (`BRIDGE` in sim.js).
- **Both spawns equal**: Gold gate at −z, Crimson gate at +z, the same size and shape; only the dressing differs.
- **Readable floor**: light sand, the fight area stays in sunlight (only nearby structures cast shadows).

## 3. Layout (outside the fight zone)

| Ring | Radius (yd) | Height (yd) | What |
| --- | --- | --- | --- |
| Sand floor | 0 – 31.5 | 0 | painted sand, raked rings, a granite curb at r 28.6–29.2, the kingdom crest in the centre, spawn marks, hypogeum trapdoors (flush) |
| Podium wall | 31.5 | 0 – 4.6 | cream marble facing, a relief frieze, bronze shields of the noble houses, torches, a balustrade with net posts |
| Gates | ±z | 0 – 11 | Gold gatehouse (−z), Crimson gatehouse (+z), team banners, portcullis |
| Podium (nobles) | 33 – 35.7 | 5.0 – 6.6 | 3 cushioned rows, striped canopies, guards |
| Royal box | +x | 5 – 14 | the king and queen under a purple canopy, griffin statues |
| Herald box | −x | 5 – 12 | gong, war horns, judges |
| Walkway | 35.7 – 37.2 | 6.8 | balustrade, food stalls |
| Middle tiers | 37.2 – 45.3 | 7.2 – 12.2 | 9 stone rows with wooden benches, 8 vomitorium tunnels |
| Upper wall | 45.3 – 47 | 12.2 – 13.6 | arcade wall, walkway |
| Timber gallery | 47 – 51.5 | 13.6 – 19.5 | a medieval wooden gallery with a standing crowd and a shingle roof |
| Facade | 51.5 – 53 | 0 – 24 | three storeys of arcades, statues, mast sockets |
| Masts and sails | 52 → 38 | 24 – 31 | 40 masts, striped velarium sails over the stands (never over the sand) |
| Watchtowers | 4 × on the diagonals | 0 – 38 | medieval towers built into the rim, pennants |
| Outside | > 55 | — | town roofs, cathedral, castle on a hill, cypresses, hills |

## 4. Art direction

- **Light**: sun low in the west-south-west (~25°), warm gold `#ffc48a`; long pillar shadows; braziers and torches
  burning; warm haze. The royal box (east) faces the sun.
- **Palette**: honey sandstone `#d8b98a`, cream marble `#efe6d2`, terracotta `#b4583a`, royal purple `#5a2d82`,
  teal `#1f6f78`, gold `#e3b341`; team colours only on the gates (Gold `#e3b341` / Crimson `#9e1b1b`).
- **Heraldry**: eight noble houses with simple painted crests (sun, tower, stag, wolf, key, rose, anchor, lion head)
  on shields, banners and sails.
- **Models**: same Tripo style string as Thornwater (§1 of THORNWATER_REDESIGN.md) — chunky, hand-painted, saturated.

## 5. The crowd

About 2,000 spectators, cheap enough to draw in one call:
- 12 Tripo characters (K01–K12 in the queue), generated in a T-pose, retopologised and auto-rigged.
- At load the game poses each rig (seated idle, lean forward, both arms up, fist pump, clap, point) and renders the
  poses from three angles into one sprite atlas (impostors).
- Every seat is an instanced quad that turns to the camera and picks the atlas cell by pose and viewing angle. The
  pose changes with the crowd's excitement (`crowdHype`): big hits, kills and round starts make them jump up and
  cheer; a wave runs round the stands at the start of a match.
- The king, queen and guards near the camera can be real 3D meshes.

## 6. Performance budget

- Target the same as the Classic arena: **≤ 1.5 M triangles and ≤ 350 draw calls** on high.
- Stands and tiers: procedural, merged per material. Repeated models: InstancedMesh.
- Crowd: one instanced draw (≈ 4 k triangles), one 4096 × 2048 atlas.
- Only the podium wall, gates, pillars and bridge cast shadows into the shadow map.
- GLBs optimised with `tools/glb-optimize.mjs` (textures ≤ 1024 px).

## 7. As built

### Code

| File | What |
| --- | --- |
| `js/render/kingsreach.js` | the arena: sand floor (raked rings, crest mosaic, team rings, trapdoors), plinths + statues, podium wall with house shields and torches, gates in masonry blocks, podium rows with cushions and canopies, middle tiers, timber gallery, facade with arcades, masts and velarium, banners, sky dome, town and hills outside, fires, lights; places the Tripo models |
| `js/render/kr-crowd.js` | the crowd: rigs posed at load (8 poses), baked from 3 angles into an impostor atlas, one instanced draw for ~3,500 spectators; excitement, waves, clapping, cheering |
| `js/render/kr-textures.js` | hand-painted canvas textures: sand, sandstone, marble, terracotta, timber, sail stripes, the eight house crests (banners + shields), floor crest, trapdoor, spawn ring |
| `js/render/arenas.js` | Kingsreach first (default); the old arena renamed "Classic Colosseum"; an arena can skin the shared bridge (`bridgeSkin`) |
| `js/render/bridge.js` | `buildBridge(skin)`: same shape (the collider), materials from the arena |
| `js/render/world.js` | `arena.env` (sun, hemisphere, fog, exposure, sky, env-map intensity) applied per arena; `arena.renderer` for baking; `arena.dispose()` |
| `js/main.js` | default arena `kingsreach`; players on the old default move over once (`krSeen`) |
| `js/render/thornwater-props.js` | `loadModel(id, dir)` so other model sets reuse the loader and fitting |
| `tools/collect-export.ps1` | `-Set colosseum` files exports into any model set |
| `tools/glb-info.mjs` | prints skins, joints, triangles and size of GLBs (rig check) |

Sim, rules, balance and bots are untouched: the fight zone (ring, pillars, bridge) is the same shape, so the balance
numbers in docs/BALANCE.md still hold.

### Tripo

34 models, all in `assets/models/colosseum/` (raw exports in `src/`, git-ignored):
- 22 props and set pieces: HD model H3.5 (45) → retopology, triangles, target from the queue (35) → GLB 2K →
  `tools/collect-export.ps1 -Set colosseum` (textures 1024 px; landmarks 512 px).
- 12 crowd characters in a T-pose: the same, plus **Auto-Rig (Humanoid, Mixamo skeleton, 20)** before the export
  (skeleton on), textures 512 px. Five rigs needed a second click: the first click after a model loads often does
  nothing, so check the credits went down by 20 and the export has a skin (`node tools/glb-info.mjs`).
- Cost: 2,960 credits (1,530 + 1,190 + 240); 16,130 left.

### Performance (high quality, 1280×720 in the browser pane)

- About 280 draw calls and 0.8 M triangles per frame in the arena; the crowd is one draw.
- Crowd atlas 4096 × 2304 (high), 3072 × 1728 (medium), 2048 × 1152 (low); baked once at load (well under a second).
- Low quality: 45 % of the crowd, 4 lights, no town outside.
- Models: 26.5 MB of GLBs.

### Not done / ideas

- The crowd reacts to `crowdHype` (big hits, kills, round starts) and runs a wave at the start of a fight; no crowd
  sound changes were made.
- The outside (town, castle, cathedral) is only seen from high or outside cameras; from the sand the sails and the
  sky are the backdrop.
