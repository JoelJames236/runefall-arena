// VFX atlas layout (docs/remodel/06 §2.1) — the ONE table both the runtime painter (atlas.js) and a later
// KTX2 baker read. Pure data, no three.js / DOM.
//
// 2048² texture, 8 × 8 cells of 256². Flipbooks take a 2 × 2-cell block = 4 × 4 frames of 128² (frame 0 top-left,
// row-major). Cell index = row * 8 + col (row 0 = top of the image). Shaders address a single cell by its index
// (0–63) and a flipbook by 64 + the index of its block's top-left cell.
//
// kind: 'mask'     white / greyscale shape, tinted at draw time (alpha = coverage, rgb = brightness detail)
//       'flipbook' 16 frames of a mask
//       'ramp'     colour gradient along +u (left -> right), full alpha — sampled as colour (sRGB)
//       'tile'     a mask that tiles in u and v (scrolling masks, dissolve noise, shell patterns)
//       'strip'    a mask that tiles in u only (ribbons: lightning, vines)
// Orientation: masks meant for velocity-stretched particles point "up" (+v = head); strips run along +u.

export const ATLAS = { size: 2048, grid: 8, cell: 256, frame: 128 };

export const CELLS = [
  // row 0–1: the two flipbooks, then point sprites
  { id: 'smoke', col: 0, row: 0, w: 2, h: 2, kind: 'flipbook', frames: 16, note: 'smoke puff: billows out and thins over 16 frames' },
  { id: 'fire', col: 2, row: 0, w: 2, h: 2, kind: 'flipbook', frames: 16, note: 'fire: rising licking flame, loops' },
  { id: 'soft_dot', col: 4, row: 0, kind: 'mask', note: 'soft radial glow' },
  { id: 'hard_dot', col: 5, row: 0, kind: 'mask', note: 'crisp disc with a thin glow' },
  { id: 'spark', col: 6, row: 0, kind: 'mask', note: 'spark streak, head up (velocity-stretched)' },
  { id: 'ember', col: 7, row: 0, kind: 'mask', note: 'ember: hot core + ragged glow' },
  { id: 'flame_tongue', col: 4, row: 1, kind: 'mask', note: 'single flame tongue, tip up' },
  { id: 'mist', col: 5, row: 1, kind: 'mask', note: 'wide low-contrast mist' },
  { id: 'dust', col: 6, row: 1, kind: 'mask', note: 'wispy dust puff' },
  { id: 'wisp', col: 7, row: 1, kind: 'mask', note: 'soul wisp: soft head, curling tail down' },
  // row 2: frost + storm
  { id: 'frost_crystal_1', col: 0, row: 2, kind: 'mask', note: 'long faceted ice shard' },
  { id: 'frost_crystal_2', col: 1, row: 2, kind: 'mask', note: 'cluster of three shards' },
  { id: 'frost_crystal_3', col: 2, row: 2, kind: 'mask', note: 'hexagonal ice plate' },
  { id: 'snowflake', col: 3, row: 2, kind: 'mask', note: 'six-armed snowflake' },
  { id: 'ice_crack', col: 4, row: 2, kind: 'mask', note: 'radial ice cracks (decal)' },
  { id: 'lightning_1', col: 5, row: 2, kind: 'strip', note: 'jagged bolt along u' },
  { id: 'lightning_2', col: 6, row: 2, kind: 'strip', note: 'forked bolt along u' },
  { id: 'shockwave_ring', col: 7, row: 2, kind: 'mask', note: 'thin ring, soft inner wake' },
  // row 3: runes + holy
  { id: 'rune_ring_1', col: 0, row: 3, kind: 'mask', note: 'circle of runes' },
  { id: 'rune_ring_2', col: 1, row: 3, kind: 'mask', note: 'geometric glyph ring: ticks and dots' },
  { id: 'cast_circle', col: 2, row: 3, kind: 'mask', note: 'cast circle: double ring, 12 runes, sigil' },
  { id: 'hexagram', col: 3, row: 3, kind: 'mask', note: 'six-pointed star in a circle' },
  { id: 'holy_ray', col: 4, row: 3, kind: 'mask', note: 'vertical ray of light' },
  { id: 'sunburst', col: 5, row: 3, kind: 'mask', note: 'glow + 12 tapered rays' },
  { id: 'feather', col: 6, row: 3, kind: 'mask', note: 'feather, quill down' },
  { id: 'star', col: 7, row: 3, kind: 'mask', note: 'five-point star (stun)' },
  // row 4: nature, poison, blood
  { id: 'leaf_1', col: 0, row: 4, kind: 'mask', note: 'pointed leaf with midrib' },
  { id: 'leaf_2', col: 1, row: 4, kind: 'mask', note: 'round lobed leaf' },
  { id: 'petal', col: 2, row: 4, kind: 'mask', note: 'petal' },
  { id: 'vine', col: 3, row: 4, kind: 'strip', note: 'curling vine along u' },
  { id: 'thorn', col: 4, row: 4, kind: 'mask', note: 'curved thorn, point up' },
  { id: 'poison_bubble', col: 5, row: 4, kind: 'mask', note: 'bubble: rim + highlight' },
  { id: 'drip', col: 6, row: 4, kind: 'mask', note: 'drip, round end down' },
  { id: 'blood_drop', col: 7, row: 4, kind: 'mask', note: 'blood splat drop' },
  // row 5: shadow + icons
  { id: 'tendril_1', col: 0, row: 5, kind: 'mask', note: 'shadow tendril, root down' },
  { id: 'tendril_2', col: 1, row: 5, kind: 'mask', note: 'twin curling tendrils' },
  { id: 'void_eye', col: 2, row: 5, kind: 'mask', note: 'void eye' },
  { id: 'skull', col: 3, row: 5, kind: 'mask', note: 'skull ☠ (Death Mark)' },
  { id: 'flag', col: 4, row: 5, kind: 'mask', note: 'flag ⚑ (taunt)' },
  { id: 'scales', col: 5, row: 5, kind: 'mask', note: 'scales ⚖ (Judgment)' },
  { id: 'sigil_hex', col: 6, row: 5, kind: 'mask', note: 'curse sigil: hex' },
  { id: 'sigil_weak', col: 7, row: 5, kind: 'mask', note: 'curse sigil: cracked sword (weakness)' },
  // row 6: curse, bone, stone, moon, beast
  { id: 'sigil_doom', col: 0, row: 6, kind: 'mask', note: 'curse sigil: doom countdown' },
  { id: 'bone_shard_1', col: 1, row: 6, kind: 'mask', note: 'bone splinter' },
  { id: 'bone_shard_2', col: 2, row: 6, kind: 'mask', note: 'bone fragment' },
  { id: 'stone_chip_1', col: 3, row: 6, kind: 'mask', note: 'faceted stone chip' },
  { id: 'stone_chip_2', col: 4, row: 6, kind: 'mask', note: 'flat stone flake' },
  { id: 'moon_disc', col: 5, row: 6, kind: 'mask', note: 'moon disc with crescent shading' },
  { id: 'arrow_streak', col: 6, row: 6, kind: 'mask', note: 'thin streak with a point, head up' },
  { id: 'paw', col: 7, row: 6, kind: 'mask', note: 'paw print (ground)' },
  // row 7: ramps + utility
  { id: 'ramp_fire', col: 0, row: 7, kind: 'ramp', note: 'white > yellow > orange > red > black' },
  { id: 'ramp_frost', col: 1, row: 7, kind: 'ramp', note: 'white > ice blue > deep blue' },
  { id: 'ramp_void', col: 2, row: 7, kind: 'ramp', note: 'lilac > violet > black' },
  { id: 'ramp_nature', col: 3, row: 7, kind: 'ramp', note: 'pale lime > green > forest' },
  { id: 'noise', col: 4, row: 7, kind: 'tile', note: 'tileable fbm noise (dissolve, scrolling masks)' },
  { id: 'hex_pattern', col: 5, row: 7, kind: 'tile', note: 'tileable hexagon lines (ward shells)' },
  { id: 'claw', col: 6, row: 7, kind: 'mask', note: 'three parallel claw streaks' },
  { id: 'cracked_heart', col: 7, row: 7, kind: 'mask', note: 'cracked heart (mortal wound)' },
];

// id -> shader cell code: 0–63 single cell, 64 + block index for a flipbook
export const CELL = {};
for (const c of CELLS) CELL[c.id] = c.row * ATLAS.grid + c.col + (c.kind === 'flipbook' ? 64 : 0);

// sanity: 64 distinct cells, flipbook blocks 2×2-aligned
(() => {
  const used = new Set();
  for (const c of CELLS) for (let y = 0; y < (c.h || 1); y++) for (let x = 0; x < (c.w || 1); x++) {
    const k = (c.row + y) * ATLAS.grid + c.col + x;
    if (used.has(k)) throw new Error('atlas cell used twice: ' + c.id);
    used.add(k);
  }
  if (used.size !== ATLAS.grid * ATLAS.grid) throw new Error('atlas: ' + used.size + ' of 64 cells laid out');
})();

// pixel rectangle of a cell (x, y from the image's top-left), for painters / bakers
export function cellRect(c) {
  const s = ATLAS.cell;
  return { x: c.col * s, y: c.row * s, w: (c.w || 1) * s, h: (c.h || 1) * s };
}
