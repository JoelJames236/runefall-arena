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
  // ---- ridges between the lanes (gaps at x −31…−27 are the cross paths)
  B(-42, -31, 9, 12, 0, 7, 'rock'), B(-27, -16, 9, 12, 0, 7, 'rock'), B(-42, -31, -12, -9, 0, 7, 'rock'), B(-27, -16, -12, -9, 0, 7, 'rock'),
  // ---- north lane (Gold half): ruins — columns and a broken arch wall
  B(-35, -33.6, 22, 23.4, 0, 4.5, 'ruin'), B(-25, -23.6, 29, 30.4, 0, 3.2, 'ruin'), B(-21, -17, 17.5, 18.5, 0, 3, 'ruin'), B(-38, -37, 30, 33, 0, 2.4, 'ruin'),
  // ---- south lane (Gold half): boulders
  B(-31, -28, -27, -24, 0, 2.6, 'boulder'), B(-23, -20.5, -21, -19, 0, 3, 'boulder'), B(-37, -33, -33, -31, 0, 2.2, 'boulder'),
];
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
export const THORNWATER = {
  id: 'thornwater', name: 'Thornwater Gorge',
  bounds: { x0: -100, x1: 100, z0: -36, z1: 36 },
  water: { x: 0, hw: 5 },                       // the river: shallow everywhere (wading is 15 % slower), the bridge spans it
  blocks: team(GOLD_BLOCKS, mirrorBox),
  ramps: team(GOLD_RAMPS, mirrorRamp),
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
