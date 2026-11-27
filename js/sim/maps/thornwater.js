// Thornwater Gorge — the 5v5 flag battleground (design: docs/FUTURE_BATTLEGROUNDS.md).
//
// Pure data: the sim (collision, line of sight, floors), the bots (waypoints) and the renderer all read it.
// The map lies along the x axis: Sunward Keep (Gold, team 0) in the west, Emberhold (Crimson, team 1) in the
// east, the Thornwater river across the middle (x = 0) under the arena's stone bridge. Only the Gold half is
// written out; the Crimson half is the same turned 180° around the centre (x, z) → (−x, −z), so neither side
// has an advantage.
//
// Units are the game's (yards ≈ metres). Blocks: { x0, x1, z0, z1, y0, y1 } solid boxes; `gate` = solid until
// the gates open; `kind` is for the renderer (wall, slab, rail, rock, ruin, gate, plinth, lowwall).
// Ramps: { x0, x1, z0, z1, axis, h0, h1 } — h0 at the low coordinate end, h1 at the high one.
// Hills: soft mounds of ground (sim.js hillH). Fixtures: the dressing in the playable area, each with its collider
// (see GOLD_FIXTURES). Look: docs/THORNWATER_REDESIGN.md.

const H = 9;          // keep wall height
const FLOOR = 4.5;    // flag-room floor
const mirrorBox = b => ({ ...b, x0: -b.x1, x1: -b.x0, z0: -b.z1, z1: -b.z0 });
const mirrorRamp = r => ({ ...r, x0: -r.x1, x1: -r.x0, z0: -r.z1, z1: -r.z0, h0: r.h1, h1: r.h0 });
const mirrorPt = p => ({ ...p, x: -p.x, z: -p.z, yaw: p.yaw !== undefined ? p.yaw + Math.PI : undefined });

// ------------------------------------------------------------------ Gold half
const B = (x0, x1, z0, z1, y0, y1, kind, o = {}) => ({ x0, x1, z0, z1, y0, y1, kind, ...o });
const GOLD_BLOCKS = [
  // ---- Sunward Keep: outer walls (front wall faces the middle, at x = −60)
  B(-96, -94.5, -15, 15, 0, H, 'wall'),                                     // back wall
  B(-96, -66, 13.5, 15, 0, H, 'wall'), B(-66, -62.5, 13.5, 15, 3.4, H, 'wall'), B(-62.5, -60, 13.5, 15, 0, H, 'wall'), // north wall + side door
  B(-96, -90, -15, -13.5, 0, H, 'wall'), B(-90, -84, -15, -13.5, 0, FLOOR, 'wall'), B(-90, -84, -15, -13.5, 7.5, H, 'wall'), B(-84, -60, -15, -13.5, 0, H, 'wall'), // south wall + balcony opening
  B(-61.5, -60, -15, -4, 0, H, 'wall'), B(-61.5, -60, 4, 15, 0, H, 'wall'), B(-61.5, -60, -4, 4, 5.5, H, 'wall'), // front wall + gate arch
  B(-61.3, -60.2, -4, 4, 0, 5.5, 'gate', { gate: true }),                  // the main gate (closed during preparation)
  // ---- inside: the flag room floor over the back of the great hall, its railing, the side passage wall
  B(-94.5, -78, -13.5, 13.5, FLOOR - 0.4, FLOOR, 'slab'),
  B(-78.5, -78, -13.5, -3, FLOOR, FLOOR + 1.1, 'rail'), B(-78.5, -78, 3, 9.4, FLOOR, FLOOR + 1.1, 'rail'),
  B(-78, -61.5, 9.4, 10, 0, H, 'wall'),
  B(-86.6, -85.4, -0.6, 0.6, FLOOR, FLOOR + 0.35, 'plinth'),               // the flag stand
  B(-73, -71.6, 7, 8.4, 0, 6.5, 'column'), B(-73, -71.6, -8.4, -7, 0, 6.5, 'column'), // great-hall columns
  B(-91, -83, -19, -15, FLOOR - 0.4, FLOOR, 'slab'),                        // the balcony (drop down from it)
  // ---- the yard: low wall around the graveyard
  B(-56, -44, -16.5, -16, 0, 1.1, 'lowwall'), B(-56.5, -56, -16.5, -5, 0, 1.1, 'lowwall'),
  // (the ridges between the lanes are hills now: GOLD_HILLS)
  // ---- north lane (Gold half): ruins — columns and a broken arch wall
  B(-35, -33.6, 22, 23.4, 0, 4.5, 'ruin'), B(-25, -23.6, 29, 30.4, 0, 3.2, 'ruin'), B(-21, -17, 17.5, 18.5, 0, 3, 'ruin'), B(-38, -37, 30, 33, 0, 2.4, 'ruin'),
  // ---- the middle: ruins on the river bank and rocks standing in the shallows — cover to fight and kite around
  B(-9.7, -8.3, 11.3, 12.7, 0, 4, 'ruin'), B(-14.7, -13.3, 15.3, 16.7, 0, 3.2, 'ruin'), B(-8.7, -7.3, 18.8, 20.2, 0, 4.4, 'ruin'),
  B(-11, -10, -14.5, -11, 0, 3.4, 'ruin'), B(-16, -14.6, -13.7, -12.3, 0, 3.6, 'ruin'),
  B(-3.6, -1.6, 12, 14, 0, 2.6, 'boulder'), B(-3.2, -1.4, -18, -16.2, 0, 2.2, 'boulder'),
  // ---- south lane (Gold half): boulders
  B(-31, -28, -27, -24, 0, 2.6, 'boulder'), B(-23, -20.5, -21, -19, 0, 3, 'boulder'), B(-37, -33, -33, -31, 0, 2.2, 'boulder'),
];
// Hills (see hillH in sim.js): the two ridges between the lanes on each side of the middle lane (the cross path at
// x ≈ −29 stays flat) and four low mounds by the lanes. Steepest slope h·π / 2r ≈ 28°.
const GOLD_HILLS = [
  { x0: -39.5, x1: -34, z0: 9.5, z1: 11.5, r: 6.5, h: 2.2 }, { x0: -24, x1: -18.5, z0: 9.5, z1: 11.5, r: 6.5, h: 2.2 },
  { x0: -39.5, x1: -34, z0: -11.5, z1: -9.5, r: 6.5, h: 2.2 }, { x0: -24, x1: -18.5, z0: -11.5, z1: -9.5, r: 6.5, h: 2.2 },
  { x0: -46, x1: -43, z0: 28, z1: 31, r: 5, h: 1 }, { x0: -46, x1: -43, z0: -31, z1: -28, r: 5, h: 1 },
  { x0: -15, x1: -11, z0: 28, z1: 32, r: 4.5, h: 1 }, { x0: -15, x1: -11, z0: -32, z1: -28, r: 4.5, h: 1 },
];
const mirrorHill = h => ({ ...h, x0: -h.x1, x1: -h.x0, z0: -h.z1, z1: -h.z0 });
// Fixtures: the dressing that stands in the playable area. Each has a world-aligned footprint (w along x, d along
// z, h tall, from y). Solid ones become blocks — small ones don't block sight (`sight: true` = they do). The
// renderer fits its model into the footprint and picks the faction's look by the half it stands on (x < 0 Sunward,
// x > 0 Ember), so both teams always get the same collision. Rules: wall decorations ≤ 0.45 deep need no collider
// (a body never gets closer to a wall than that); ankle-high scatter (≤ 0.4) has none; everything else is solid.
const F = (kind, x, z, o = {}) => ({ kind, x, z, y: o.y ?? 0, yaw: o.yaw ?? 0, w: o.w ?? 1, d: o.d ?? 1, h: o.h ?? 1, solid: o.solid ?? true, sight: !!o.sight });
export const SHELTER_POST = 1.5; // posts at the corners of a 3 yd square round the buff spot (the shelter models are fitted to them)
const shelter = (x, z, yaw = 0) => [
  F('shelter', x, z, { yaw, w: 4.4, d: 4.4, h: 4.6, solid: false }),
  ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => F('post', x + a * SHELTER_POST, z + b * SHELTER_POST, { w: 0.5, d: 0.5, h: 3.3 })),
];
const GOLD_FIXTURES = [
  // the keep: corner towers on the wall corners, two turrets flanking the gate, braziers in front of them
  F('tower', -60.75, 14.25, { w: 2.6, d: 2.6, h: 15, sight: true }), F('tower', -60.75, -14.25, { w: 2.6, d: 2.6, h: 15, sight: true }),
  F('tower', -95.25, 14.25, { w: 2.6, d: 2.6, h: 15, sight: true }), F('tower', -95.25, -14.25, { w: 2.6, d: 2.6, h: 15, sight: true }),
  F('gatehouse', -60, 0, { yaw: Math.PI / 2, w: 1.2, d: 15, h: 13.5, solid: false }),
  F('turret', -59.2, 5.6, { w: 1.6, d: 2.6, h: 12, sight: true }), F('turret', -59.2, -5.6, { w: 1.6, d: 2.6, h: 12, sight: true }),
  F('brazier', -57.3, 8.2, { w: 0.9, d: 0.9, h: 1.7 }), F('brazier', -57.3, -8.2, { w: 0.9, d: 0.9, h: 1.7 }),
  // the great hall: weapon racks and armour stands against the side walls, the buff on a dais, a carpet to the stairs
  F('rack', -65.5, -12.95, { w: 2.2, d: 1.1, h: 2.1 }), F('armor', -74.5, -12.8, { w: 1.4, d: 1.4, h: 2.4 }),
  F('rack', -65.5, 8.85, { yaw: Math.PI, w: 2.2, d: 1.1, h: 2.1 }), F('armor', -74.5, 8.7, { yaw: Math.PI, w: 1.4, d: 1.4, h: 2.4 }),
  F('dais', -70, -10, { w: 2.6, d: 2.6, h: 0.05, solid: false }),
  F('carpet', -63.75, 0, { yaw: Math.PI / 2, w: 4.5, d: 3, h: 0.02, solid: false }),
  // the flag room: a throne behind the flag stand, a war drum and a rack in the back corners, a carpet to the stand
  F('throne', -93.7, 0, { y: FLOOR, yaw: Math.PI / 2, w: 1.6, d: 2.8, h: 2.8, sight: true }),
  F('drum', -92.6, 11.6, { y: FLOOR, w: 1.7, d: 1.7, h: 1.6 }), F('rack', -92.9, -12.95, { y: FLOOR, w: 2, d: 1.1, h: 2.1 }),
  F('carpet', -86, 0, { y: FLOOR, yaw: Math.PI / 2, w: 14, d: 2.8, h: 0.02, solid: false }),
  // the graveyard: the spirit shrine in the walled corner (out of the respawn ring's reach), stones along the walls
  F('spirit', -54.6, -14.6, { w: 1.6, d: 1.6, h: 3 }),
  F('grave', -52, -15.7, { w: 0.9, d: 0.3, h: 1.1, solid: false }), F('grave', -49, -15.7, { w: 0.9, d: 0.3, h: 1.1, solid: false }),
  F('grave', -46, -15.7, { w: 0.9, d: 0.3, h: 1.1, solid: false }), F('grave', -55.7, -11, { yaw: Math.PI / 2, w: 0.3, d: 0.9, h: 1.1, solid: false }),
  F('grave', -55.7, -8, { yaw: Math.PI / 2, w: 0.3, d: 0.9, h: 1.1, solid: false }),
  // open shelters over the four outdoor buff spots of this half
  ...shelter(-47, 10), ...shelter(-24, 24), ...shelter(-12, -6), ...shelter(-24, -24),
  // lights at the bridgehead, waymarkers at the ends of the cross path, two oaks by the lanes
  F('lantern', -16.3, 3.2, { w: 0.5, d: 0.5, h: 3.2 }), F('lantern', -16.3, -3.2, { w: 0.5, d: 0.5, h: 3.2 }),
  F('waymarker', -29, 16.5, { w: 0.4, d: 0.4, h: 2 }), F('waymarker', -29, -16.5, { yaw: Math.PI, w: 0.4, d: 0.4, h: 2 }),
  // big trees along the edges of the lanes: the trunk is the collider, the crown is high overhead
  F('oak', -40, 33.6, { w: 1.4, d: 1.4, h: 11, sight: true }), F('oak', -28, -33.6, { w: 1.4, d: 1.4, h: 11, sight: true }),
  F('bigtree', -62, 33, { w: 1.6, d: 1.6, h: 13, sight: true }), F('bigtree', -16, 33.4, { w: 1.4, d: 1.4, h: 12, sight: true }),
  F('bigtree', -70, -33.2, { w: 1.6, d: 1.6, h: 13, sight: true }), F('bigtree', -50, -33.5, { w: 1.4, d: 1.4, h: 12, sight: true }),
];
const mirrorFixture = f => ({ ...f, x: -f.x, z: -f.z, yaw: f.yaw + Math.PI });
const fixtureBlock = f => B(f.x - f.w / 2, f.x + f.w / 2, f.z - f.d / 2, f.z + f.d / 2, f.y, f.y + f.h, 'fixture', { fixture: f.kind, noSight: !f.sight });
const GOLD_RAMPS = [
  { x0: -78, x1: -66, z0: -3, z1: 3, axis: 'x', h0: FLOOR, h1: 0, kind: 'stairs' },       // main ramp: hall → flag room
  { x0: -78, x1: -67, z0: 10, z1: 13.5, axis: 'x', h0: FLOOR, h1: 0, kind: 'stairs' },    // the hidden side passage
];
// waypoints for the bots (y = floor height); names get the team prefix g_ / c_
const P = (id, x, y, z) => ({ id, x, y, z });
const GOLD_NODES = [
  P('flag', -86, FLOOR, 0), P('froom', -81, FLOOR, 0), P('rampBot', -64.5, 0, 0), P('gateOut', -56, 0, 0),
  P('corrTop', -80.5, FLOOR, 11.8), P('corrBot', -65, 0, 11.8), P('doorOut', -64.2, 0, 18),
  P('balcIn', -87, FLOOR, -11), P('balc', -87, FLOOR, -17), P('balcLand', -87, 0, -22.5), P('keepS', -70, 0, -24),
  P('hallN', -70, 0, 6), P('hallS', -70, 0, -6),
  P('yardM', -50, 0, 0), P('yardN', -50, 0, 22), P('yardS', -48, 0, -24), P('gy', -50, 0, -10.5),
  P('n1', -36, 0, 25), P('n2', -20, 0, 24), P('s1', -38, 0, -20), P('s2', -20, 0, -25),
  P('m1', -34, 0, 3), P('m2', -19, 0, 5), P('cgn', -29, 0, 10.5), P('cgs', -29, 0, -10.5),
  P('bw', -17.5, 0, 0), P('rv', -7, 0, 6),
];
const CENTER_NODES = [P('nc', 0, 0, 24), P('sc', 0, 0, -24), P('mcn', 0, 0, 7.5), P('mcs', 0, 0, -7.5), P('arch', 0, 0, 0), P('deck', 0, 4.4, 0)];

// ------------------------------------------------------------------ assembled map
const team = (gold, mirror) => [...gold, ...gold.map(mirror)];
const FIXTURES = team(GOLD_FIXTURES, mirrorFixture).map(f => ({ ...f, side: f.x < 0 ? 0 : 1 }));
export const THORNWATER = {
  id: 'thornwater', name: 'Thornwater Gorge',
  bounds: { x0: -100, x1: 100, z0: -36, z1: 36 },
  water: { x: 0, hw: 5 },                       // the river: shallow everywhere (wading is 15 % slower), the bridge spans it
  blocks: [...team(GOLD_BLOCKS, mirrorBox), ...FIXTURES.filter(f => f.solid).map(fixtureBlock)],
  ramps: team(GOLD_RAMPS, mirrorRamp),
  hills: team(GOLD_HILLS, mirrorHill),
  fixtures: FIXTURES,                           // for the renderer (side 0 = Sunward look, 1 = Ember look)
  floor: FLOOR,
  flags: [{ team: 0, x: -86, y: FLOOR, z: 0 }, { team: 1, x: 86, y: FLOOR, z: 0 }],
  graveyards: [{ team: 0, x: -50, z: -10.5, yaw: Math.PI / 2 }, { team: 1, x: 50, z: 10.5, yaw: -Math.PI / 2 }],
  // where each team stands while the gates are shut (the great hall)
  prep: [{ team: 0, x: -68, z: 0, yaw: Math.PI / 2 }, { team: 1, x: 68, z: 0, yaw: -Math.PI / 2 }],
  // power-up spots: [Gold spot, its Crimson mirror] — a spawn always lights both of a pair with the same buff
  buffPairs: [
    [{ x: -70, z: -10 }, { x: 70, z: 10 }],      // great hall
    [{ x: -47, z: 10 }, { x: 47, z: -10 }],      // yard
    [{ x: -24, z: 24 }, { x: 24, z: -24 }],      // north lane (Gold half) / south lane (Crimson half)
    [{ x: -12, z: -6 }, { x: 12, z: 6 }],        // middle, beside the bridge
    [{ x: -24, z: -24 }, { x: 24, z: 24 }],      // south lane (Gold half) / north lane (Crimson half)
  ],
  nodes: [
    ...GOLD_NODES.map(n => ({ ...n, id: 'g_' + n.id, team: 0 })),
    ...GOLD_NODES.map(n => ({ ...mirrorPt(n), id: 'c_' + n.id, team: 1 })),
    ...CENTER_NODES.map(n => ({ ...n, team: -1 })),
  ],
  // the flag rooms' three ways out, by team: what a carrier picks from
  exits: { main: 'gateOut', side: 'doorOut', balcony: 'balcLand' },
};
