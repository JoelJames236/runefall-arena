# Thornwater Gorge — visual redesign (Ember Warband vs Sunward Crown)

Status: **built** (2026-11-27). Hills, colliders, painted ground, keep architecture, middle cover, natural edges and
all 38 Tripo models are in the game. This file is the art bible, the asset list with the Tripo prompts, and the
record of how it was made (§7).

## 0. Ground rules

- **Original IP.** The look is the *genre* of a stylized fantasy MMO — chunky hand-painted shapes, saturated colour,
  readable silhouettes — but the factions, names, crests and buildings are our own. No names, emblems or buildings
  from any existing game, and no trademarked words in Tripo prompts.
  - Team 1 (east, x > 0): **the Ember Warband** of **Emberhold** — red & black, brutal, timber and dark stone.
  - Team 0 (west, x < 0): **the Sunward Crown** of **Sunward Keep** — royal blue & gold, noble, pale stone.
- **Fairness.** The map stays point-symmetric (x, z) → (−x, −z). Every collider exists in a mirrored pair with the
  same shape. The factions differ *only* in visuals; a visual element never sticks out past its collider far enough
  to hide a player or to block a shot that the collider wouldn't.
- **Gameplay unchanged** except for the layout changes the user approved (2026-11-27):
  1. The four 7 m rock ridges between the lanes become **walkable hills** (see §3).
  2. Buff spots get **open shelters** (roof on posts, thin post colliders only).
  3. Keep corner towers and gate turrets get box colliders that match their footprint.
  4. The middle gets cover to fight and kite around (user request): broken columns and a ruined wall on each river
     bank and big rocks standing in the shallows, so a bare middle doesn't favour melee.
  5. Big trees along the lane edges (user request), each with a trunk collider; their crowns are overhead.
  6. Free-standing props in the keeps (racks, armour stands, throne, drum/shrine, braziers), the graveyard shrine and
     the bridgehead lights have box colliders (mirrored).
  Rules, timers, buffs, speeds, spawns, flag rooms, gates, bounds, river and bridge collision are untouched.

## 1. Art direction

One world, two factions. A green-gold river valley at late afternoon. The light is warm and comes in low from the
west. The valley floor is soft and natural. The two ends feel completely different: the Sunward side is clean,
ordered and bright; the Ember side is jagged, smoky and dark. The river and the bridge in the middle are neutral.

| | Sunward Crown (west) | Ember Warband (east) |
| --- | --- | --- |
| Feeling | noble, majestic, organised, welcoming | brutal, intimidating, savage, battle-ready |
| Shapes | vertical, symmetric, round towers, cone roofs, arches | low and wide, leaning, spikes, tusks, jagged timber |
| Materials | light grey limestone, blue slate roofs, gold trim, white marble, silver steel | dark grey basalt, black iron, weathered brown timber, hide, bone |
| Colours | royal blue `#2a55b8`, gold `#e3b341`, stone `#c9c4b8`, white/silver | blood red `#9e1b1b`, black `#1b1716`, timber `#6b4a30`, basalt `#4a4644` |
| Light | lanterns and stone braziers, cool white-gold glow | bonfires and torches, orange firelight, ember sparks, smoke |
| Crest | a golden sun rising behind a white tower, on royal blue | a black horned skull wreathed in red flame, on black/red |

**Style string** (put in front of every Tripo prompt):

> stylized hand-painted fantasy MMO game asset, chunky exaggerated proportions, bold readable silhouette,
> painterly diffuse textures with soft baked shading, saturated colors, clean simple forms, game-ready,
> single object centered, plain background, no ground plane, no text

Team names and HUD colours stay **Gold** and **Crimson**: Gold is the Sunward Crown's gold, Crimson the Ember
Warband's red. Cloth, banners and roofs carry the faction palettes.

## 2. What we keep, what we change

| Part | Today | Redesign |
| --- | --- | --- |
| Keeps (collision) | procedural boxes, 9 m walls, flag room at 4.5 m | **same boxes**, built as architecture in `js/render/tw-keep.js`: hand-painted faction stone, plinth, buttresses, corbelled parapets (Sunward) / spiked timber hoardings (Ember), windows, crest over the gate, raised gatehouse, corner towers and gate turrets (round with slate cones / square with horned iron roofs), a roof over hall and flag room that fades out while the camera is inside, a great tower (Sunward spire / Ember watchtower), a donjon / war longhouse behind |
| Keep interiors | bare stone | carpets, banners, braziers, weapon racks, a throne/war table by the flag |
| Behind the keeps (outside bounds) | cliffs | a huge **citadel backdrop** per faction — the "wow" silhouette, no collision needed |
| Ridges between lanes | 4 boxes, 7 m tall | gentle grassy **hills** you can run over, rock outcrops on top |
| Lanes | ruins (north), boulders (south) | same colliders, dressed with Tripo ruins / boulders |
| Buff spots | floating gem | gem inside an **open shelter** themed by territory; hall buffs on a small **shrine** |
| Graveyards | 4 slabs + ring | faction spirit shrine + gravestones |
| Map edges | rocky boxes + cone pines | **cliffs, rock spires, dense forest** made of Tripo pieces, rising into mountains |
| River & bridge | water plane, shared arena bridge | same collision; lanterns, reeds, rocks, waterfall rocks |
| Ground | photoreal PBR tiles (read as water) | **done**: four hand-painted tiling textures (grass, dirt, cobble, rock) painted at load time (`js/render/tw-ground.js`), height-blended per vertex: cobbled streets and squares by the keeps and shelters, dirt lanes, rock on slopes; Sunward stone pale, Ember stone basalt, Ember grass scorched near its keep |

## 3. Hills (approved layout change)

The sim knows boxes and ramps. A hill made of ramps has hard side faces, so hills get a new primitive:
`hills: [{ x0, x1, z0, z1, r, h }]` (`hillH` in `js/sim/sim.js`) — a flat top over the rectangle falling away over r
with a cosine profile. `floorAt` takes the highest of the existing floor and the mound; line of sight and shots
sample the mound along the segment; the camera collides with it. Steepest slope 28.6°, so everyone runs up it at
full speed. The ridge hills are 2.2 yd high: at the crest you see over, at the foot you don't — like a real ridge.

Per half: two ridge hills on each side of the middle lane (where the 7 yd rock ridges were), the cross path at
x ≈ −29 stays a flat saddle, plus four 1 yd mounds by the lanes and the river. All mirrored.

## 4. Performance budget

| Item | Budget |
| --- | --- |
| Hero pieces (citadels, gatehouses) | ≤ 20 k tris, 2048 px texture |
| Buildings / towers / shelters | ≤ 8 k tris, 1024 px |
| Props | ≤ 3 k tris, 512–1024 px |
| Scatter (rocks, bushes, trees) | ≤ 1.5 k tris, 512 px, **instanced** |
| Whole map | ≤ 1.2 M tris loaded, ≤ 250 draw calls, ≤ 40 MB of GLBs |
| Lights | ≤ 8 point lights, none casting shadows; sun is the only shadow caster |

Every repeated asset is an `InstancedMesh` (one draw call per mesh, however many copies). Big pieces get a
decimated far LOD. The low quality setting drops scatter and decals. Textures: JPEG/WebP inside the GLB, 1K default.

## 5. Pipeline (Tripo Studio, Max)

1. **Concept** (hero and building assets): image generation in Studio, using the style string plus the asset prompt
   → pick the best of 4 → **image to 3D**. Simple props go straight **text to 3D**.
2. **Smart Low Poly** with the triangle budget from the table (or Retopology for parts that need clean edges).
3. **Texture**: standard quality (detailed for hero pieces). No 8K in the game; it's only a source.
4. **Export GLB** → raw into `assets/models/thornwater/src/` (git-ignored) → optimize (resize textures, strip, quantize)
   → `assets/models/thornwater/<id>.glb`.
5. Free retries until it reads well from the game camera.

## 6. Asset list and Tripo prompts

Sizes are in metres (W × D × H). "Var" = how many variants to generate. Every prompt below is used *after* the
style string.

> Built as architecture instead of Tripo models (they must match the colliders exactly and tile cleanly):
> S02/E02 wall segments, S03/E03 towers, S04/E04 gatehouses. Their prompts stay here as optional detail pieces.

### 6.1 Sunward Crown (blue & gold, west)

| ID | Asset | Use / placement | Size | Tris | Var |
| --- | --- | --- | --- | --- | --- |
| S01 | Sunward citadel | backdrop behind the keep, outside bounds | 60×40×45 | 20k | 1 |
| S02 | Castle wall segment | tiled along the keep walls | 6×1.5×9 | 3k | 2 |
| S03 | Round corner tower | 4 keep corners | 6×6×16 | 6k | 1 |
| S04 | Gatehouse front | over the main gate arch | 14×4×13 | 8k | 1 |
| S05 | Open stone pavilion (buff shelter) | buff spots on the west half | 5×5×5 | 6k | 2 |
| S06 | Sun shrine | great-hall buff spot | 2×2×2.5 | 2k | 1 |
| S07 | Banner pole with crossbar | walls, hall, yard | 1.5×0.3×6 | 800 | 1 |
| S08 | Armor display stand | hall, flag room | 1×0.8×2.2 | 2.5k | 2 |
| S09 | Sword & kite-shield rack | hall, yard | 2×0.8×2 | 2k | 1 |
| S10 | Iron lantern post | paths, bridgehead | 0.6×0.6×3.2 | 800 | 1 |
| S11 | Stone brazier on pedestal | gate, hall | 1.2×1.2×1.6 | 1.2k | 1 |
| S12 | Knight statue | yard centre (on the existing low wall area), backdrop | 2×2×5 | 6k | 1 |
| S13 | Throne and war table | flag room | 3×2×2.5 | 3k | 1 |
| S14 | Ornate stone pillar | hall columns (existing colliders) | 1.4×1.4×6.5 | 1.5k | 1 |
| S15 | Small stone cottage | scenery outside bounds, west slopes | 7×6×7 | 5k | 2 |

**S01 Sunward citadel** — A grand white limestone castle citadel on a rocky hill, tall round towers with steep royal
blue conical slate roofs and gold spire tips, a central keep with a large arched gate, curtain walls with crenellations,
long blue and gold banners hanging from the towers, gold sun ornaments on the roof peaks, warm stained glass windows.
Majestic, symmetrical, noble. Viewed from afar, strong silhouette, wide base.

**S02 Castle wall segment** — A straight modular castle wall section of light grey cut limestone blocks, crenellated
battlements on top, a slightly flared plinth at the base, a thin gold-trimmed stone band halfway up, two small arrow
slits. Flat on both ends so segments tile seamlessly side by side. Clean and noble. (Variant B: same with a buttress
in the middle and moss in the joints.)

**S03 Round corner tower** — A round medieval castle tower of light grey limestone, slightly wider at the base,
crenellated top with a steep royal blue conical slate roof and a gold finial, narrow arched windows with warm light,
a blue and gold banner hanging down one side. Noble and elegant.

**S04 Gatehouse front** — A castle gatehouse facade, light grey stone, a tall pointed archway in the middle with an
open portcullis above, two slender turrets with blue conical roofs on either side, a large gold sun emblem relief above
the arch, gold trim, blue banners hanging on both sides of the gate. The back is flat to sit against a wall.

**S05 Open stone pavilion (buff shelter)** — A small open-sided gazebo shrine, four slender white marble columns on
a round three-step stone base, a royal blue slate dome roof with gold ribs and a gold sun finial, a hanging glowing
lantern under the dome. Completely open between the columns, nothing blocks the inside. (Variant B: square base, four
columns, pyramid blue roof.)

**S06 Sun shrine** — A small waist-high stone altar with a golden sun disc on top, blue cloth draped over it, two
candles, carved gold trim. Holy and elegant.

**S07 Banner pole** — A tall dark wooden banner pole with a gold crossbar and gold spear tip, no cloth (the cloth is
added separately), small gold rings on the crossbar.

**S08 Armor display stand** — A full suit of polished silver plate armor with gold trim and a royal blue tabard
showing a golden sun, on a wooden display stand, a great helm with a blue plume, a kite shield leaning against it.

**S09 Sword & shield rack** — A wooden weapon rack holding four longswords upright and two royal blue kite shields
with a gold sun emblem, iron fittings, polished.

**S10 Iron lantern post** — An ornate black iron lamp post with a gold-trimmed glass lantern on top, a curled
bracket, glowing warm light inside, square stone foot.

**S11 Stone brazier** — A carved light grey stone pedestal with a wide bronze fire bowl on top, gold rim, filled
with glowing coals (no flame), noble style.

**S12 Knight statue** — A heroic stone statue of a knight in plate armor holding a great sword point-down in front
of him, cloak flowing, on a square plinth with gold trim, weathered white marble, proud pose.

**S13 Throne and war table** — A high-backed royal throne of carved white stone with royal blue cushions and a gold
sun on the backrest, beside it a round wooden war table with a map, small figurines and a candle.

**S14 Ornate stone pillar** — A tall round stone pillar with a carved square base and an ornate capital, gold band
at the top, a small blue banner bracket. Clean limestone.

**S15 Small stone cottage** — A cozy medieval cottage of light stone with a blue slate roof, timber window frames,
a chimney, flower boxes, a small blue pennant. Peaceful village feel.

### 6.2 Ember Warband (red & black, east)

| ID | Asset | Use / placement | Size | Tris | Var |
| --- | --- | --- | --- | --- | --- |
| E01 | Emberhold war-fortress | backdrop behind the keep, outside bounds | 60×40×40 | 20k | 1 |
| E02 | Timber-and-stone wall segment | tiled along the keep walls | 6×1.5×9 | 3k | 2 |
| E03 | Spiked war tower | 4 keep corners | 6×6×15 | 6k | 1 |
| E04 | War gate front | over the main gate arch | 14×4×13 | 8k | 1 |
| E05 | Hide-and-timber hut (buff shelter) | buff spots on the east half | 5×5×5 | 6k | 2 |
| E06 | Skull totem shrine | great-hall buff spot | 2×2×2.5 | 2k | 1 |
| E07 | Spiked banner pole | walls, hall, yard | 1.5×0.3×6 | 800 | 1 |
| E08 | Skull trophy rack | walls, hall | 2×0.6×2.5 | 2k | 2 |
| E09 | Axe & round-shield rack | hall, yard | 2×0.8×2 | 2k | 1 |
| E10 | War drum | yard, flag room | 2×2×1.8 | 2k | 1 |
| E11 | Bonfire pit | yard, outside the gate | 2.5×2.5×1 | 1.5k | 1 |
| E12 | Torch pole | paths, bridgehead | 0.6×0.6×3 | 700 | 1 |
| E13 | Spike barricade | keep front, lane edges | 4×1.5×1.8 | 1.5k | 1 |
| E14 | Warlord throne | flag room | 3×2×3 | 3k | 1 |
| E15 | Hide war tent | scenery outside bounds, east slopes | 7×7×6 | 3k | 2 |
| E16 | Timber support pillar | hall columns (existing colliders) | 1.4×1.4×6.5 | 1.2k | 1 |

**E01 Emberhold war-fortress** — A massive brutal war-fortress of dark basalt and black iron on a rocky hill, heavy
leaning walls with huge wooden spikes and giant bone tusks jutting out, squat towers with jagged iron roofs, a huge
gate shaped like a fanged maw, enormous red and black war banners, smoke and glowing fire windows. Intimidating,
savage. Viewed from afar, strong silhouette, wide base.

**E02 Timber-and-stone wall segment** — A straight modular fortress wall section: rough dark grey stone base, upper
half of heavy dark timber logs bound with black iron bands, sharpened log points along the top, a red cloth strip
hanging over it. Flat on both ends so segments tile seamlessly side by side. (Variant B: same with a mounted horned
skull and iron spikes.)

**E03 Spiked war tower** — A squat square war tower, dark basalt base, rough timber upper floor, a jagged black iron
roof with curved horns at the corners, spikes along the parapet, a red and black banner hanging down one side,
fire glow in the windows. Brutal.

**E04 War gate front** — A brutal fortress gate facade: an archway framed by two huge curved bone tusks, heavy timber
and dark stone, iron spikes, a large black horned skull emblem over the arch with red paint, red and black banners
on both sides, torches. The back is flat to sit against a wall.

**E05 Hide-and-timber hut (buff shelter)** — A small open-sided war hut: four thick rough timber posts on a dark
stone base, a roof of stretched red-dyed hides and bones with a horned skull on top, hanging fang charms, a glowing
red lantern under the roof. Completely open between the posts, nothing blocks the inside. (Variant B: round base,
tent-like hide roof held by crossed spears.)

**E06 Skull totem shrine** — A waist-high dark stone altar with a large horned skull on top, red war paint, bone
candles, black iron spikes around the edge, ember glow.

**E07 Spiked banner pole** — A tall rough timber banner pole with a black iron crossbar, an iron spike tip and a
small skull below it, no cloth (the cloth is added separately).

**E08 Skull trophy rack** — A rough wooden frame with mounted horned beast skulls and smaller skulls, crossed bones,
red cloth strips, iron nails. Savage trophy wall.

**E09 Axe & shield rack** — A crude timber weapon rack with heavy two-handed battle axes and round wooden shields
painted red and black with a skull, iron rims, rough and battle-worn.

**E10 War drum** — A huge war drum made of a hollowed log with stretched hide, bound with rope and red cloth, two
bone drumsticks, decorated with skulls and fangs, on a low timber stand.

**E11 Bonfire pit** — A ring of dark stones with a stack of burning logs in the middle (logs only, no flame), scattered
bones, a spit with an iron cauldron hanging over it.

**E12 Torch pole** — A rough timber pole with an iron fire basket on top filled with glowing coals, a small skull
and red cloth tied below.

**E13 Spike barricade** — A defensive barricade of sharpened wooden stakes crossed in X shapes, bound with rope,
iron tips, a red rag tied on one stake.

**E14 Warlord throne** — A huge brutal throne made of dark stone and bones, horned skull on the backrest, black
fur cover, red banners on both sides, iron spikes.

**E15 Hide war tent** — A large war tent of stitched dark hides over timber poles, bone decorations, red painted
symbols, a tall pole with a red and black banner, smoke hole at the top.

**E16 Timber support pillar** — A thick rough timber pillar on a stone foot, iron bands, a mounted skull and red
cloth strip, spikes near the top.

### 6.3 Shared environment

| ID | Asset | Use / placement | Size | Tris | Var |
| --- | --- | --- | --- | --- | --- |
| N01 | Cliff wall piece | map edges, layered | 14×6×14 | 4k | 3 |
| N02 | Rock spire / formation | corners, edges, backdrops | 8×8×18 | 3k | 2 |
| N03 | Large boulder | south-lane boulder colliders, hills | 3×3×2.5 | 1.2k | 3 |
| N04 | Small rocks cluster | scatter | 1.5×1.5×0.6 | 400 | 3 |
| N05 | Pine tree | edges, slopes (instanced) | 4×4×12 | 1.5k | 3 |
| N06 | Broad oak tree | valley, near hills | 7×7×9 | 2.5k | 2 |
| N07 | Bush / shrub | scatter | 1.5×1.5×1 | 500 | 2 |
| N08 | Dead tree | Ember side, edges | 3×3×7 | 1k | 1 |
| N09 | Ancient ruined column | north-lane column colliders | 1.4×1.4×4.5 | 1.2k | 2 |
| N10 | Ruined arch wall | north-lane wall collider | 4×1×3 | 2.5k | 1 |
| N11 | Gravestone set | graveyards | 1×0.3×1.2 | 400 | 3 |
| N12 | Spirit healer shrine | graveyards | 2×2×3 | 2k | 1 |
| N13 | Reeds and river plants | river banks | 2×2×1.2 | 400 | 1 |
| N14 | Fallen log | valley scatter | 4×1×0.8 | 800 | 1 |
| N15 | Wooden waymarker | cross paths | 0.8×0.3×2 | 500 | 1 |
| N16 | Mossy waterfall rocks | waterfall at the north end | 12×6×14 | 4k | 1 |

**N01 Cliff wall piece** — A tall steep rocky cliff face made of layered stratified stone, warm grey with brown
tones, moss and grass on the ledges, a few hanging roots, flat back, wider at the base. Modular piece for a canyon wall.

**N02 Rock spire** — A tall jagged rock spire formation, several stacked leaning stone pillars, warm grey stone, moss
on top, dramatic silhouette.

**N03 Large boulder** — A large rounded granite boulder with cracks and moss on top, warm grey, sits flat on the ground.

**N04 Small rocks cluster** — A small cluster of three or four flat stones of different sizes, warm grey, a little
moss, sits flat on the ground.

**N05 Pine tree** — A tall stylized pine tree with chunky layered tiers of dark green needles, a straight brown trunk,
simple shapes, readable from far away.

**N06 Broad oak tree** — A broad stylized oak tree with a thick twisted trunk, a big round canopy of clumped bright
green leaves, a few exposed roots.

**N07 Bush** — A round stylized leafy bush, clumped green leaves, a few small yellow flowers.

**N08 Dead tree** — A gnarled dead tree with twisted bare branches, dark grey wood, a red cloth strip tied on one
branch, ominous.

**N09 Ancient ruined column** — A broken ancient stone column, fluted, cracked top, moss and ivy climbing up,
fallen chunk at its base, warm weathered stone.

**N10 Ruined arch wall** — A fragment of an ancient ruined stone wall with half of a broken arch, moss and ivy,
fallen stones at its base, warm weathered stone.

**N11 Gravestone** — A weathered old gravestone, rounded top, slightly tilted, moss, simple carved circle. (Variants:
Celtic-style cross, small flat slab.)

**N12 Spirit healer shrine** — A neutral ancient stone shrine: a ring of short standing stones around a pale crystal
on a pedestal, soft blue glow, carved runes, moss.

**N13 Reeds** — A clump of tall river reeds and cattails with a few broad leaves, green and yellow.

**N14 Fallen log** — A fallen mossy tree log with a broken end, mushrooms growing on it.

**N15 Waymarker** — A wooden signpost with two arrow-shaped boards (blank, no text) and a small lantern hanging
from it, on a stone foot.

**N16 Waterfall rocks** — A tall rocky cliff with a notch in the middle where a waterfall would pour down, mossy
stone steps on both sides of the notch, ferns, wet dark stone in the notch.

### 6.4 Not from Tripo

- **Banner cloth, carpets, crests**: animated planes with textures from Tripo image generation (crest artwork,
  carpet patterns), so they wave and stay cheap.
- **Ground textures**: hand-painted tileable grass, dirt path, cobblestone and cliff rock, made with Tripo image
  generation and made seamless with a script.
- **Fire, smoke, embers, lantern glow, waterfall, river**: shaders and sprites in code.
- **Grass tufts**: instanced cards in code.
- **The bridge**: shared by every arena and part of the collision; restyled in place (lanterns, banners, moss), not
  replaced.

Total: **47 assets, ≈ 64 generations with variants.** At roughly 100 credits each (model + low poly + texture)
that is ≈ 6,500 credits of the 25,000 a month, with room for rerolls.

## 7. As built (2026-11-27)

### Code

| File | What |
| --- | --- |
| `js/sim/maps/thornwater.js` | the map: hills, fixtures (every new solid object, with its collider; mirrored by construction), middle cover |
| `js/sim/sim.js` | `hillH` / `mapGround`: hills in floors, line of sight, shots and camera collision |
| `js/render/thornwater.js` | terrain (hills + painted ground + edge land), river, waterfall, blocks, flags, gates |
| `js/render/tw-ground.js` | the painted textures (grass, dirt, cobble, rock, ashlar, basalt, slate, shingle, planks, crests) and the blended ground material |
| `js/render/tw-keep.js` | the keeps' architecture; roofs fade while the camera is inside |
| `js/render/thornwater-props.js` | fixtures: Tripo GLBs fitted into the colliders (placeholders until they load), lane ruins and boulders, carpets, daises, fires |
| `js/render/tw-edges.js` | the land round the playable area: bank, cliffs, spires, forest, giant trees, citadels, faction scenery |
| `tools/glb-optimize.mjs`, `tools/collect-export.ps1` | Tripo export → `assets/models/thornwater/<id>.glb` (textures 512–2048 px) |
| `assets/models/thornwater/queue.json` | every asset's prompt, Tripo task id and status; `previews/` has a picture of each |

### Tripo workflow that worked

Text prompt (style string + asset prompt) → **HD model H3.5**, 2K texture, PBR off (45 credits) → **Retopology**
(triangles, Smart Mesh, target from the table; 35 credits) → **Export GLB 2K** → `tools/collect-export.ps1 -Id <id>`.
38 assets ≈ 3,100 credits. Shelters are fitted by their posts (`POSTS` in thornwater-props.js: measured post
positions), sunk so their stone base is level with the ground.

### Performance (measured in the browser pane, 1024 × 768, high quality, shadows on)

About 1.2–1.9 M triangles and 320–520 draw calls per frame including the shadow pass; 23 MB of GLBs for 38 models.
Scenery instances are chunked in 64 yd cells so off-screen parts are culled; only the front row of the forest and the
cliffs uses the Tripo models (the rest are cheap shapes in the haze); the forest and cliffs cast no shadows. Low
quality keeps the cheap forest and cliffs everywhere.

### Balance check (headless bot matches, hard bots, mirrored compositions: both teams the same five classes)

| Map | Matches | Gold wins | Crimson wins | Draws | Gold share | Captures / match | Flag pickups / match | Avg length |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before the redesign | 40 | 21 | 15 | 4 | 58 % ± 16 | 2.92 | 18.9 | 804 s |
| after | 80 | 42 | 30 | 8 | 58 % ± 12 | 2.52 | 21.1 | 821 s |

Same lean before and after, inside the noise (95 % intervals), so the redesign changes nothing between the teams.
Slightly fewer captures and more pickups: carriers get caught more often around the new cover and hills. The sim
costs ~2.5× more CPU per step than before (156 collision blocks instead of 66, plus hills) — ~4 % of one core for
a live match; a spatial grid for the blocks would remove it if it ever matters.

### Not done / ideas

- S02/E02, S03/E03, S04/E04, S07/E07, E08 trophy rack, S14/E16 pillars were not generated (architecture covers them).
- Further savings if needed: re-retopologise the cliffs (N01a/b) to ~2.5 k triangles; merge the props' chunks.
