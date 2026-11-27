// Arena registry. To add an arena: write a class with the Arena contract
// (constructor(scene, quality), group, ready, update(dt, vfx), crowdHype, flames) and add one entry here.
// The fight zone is the same for every arena (ARENA_R, PILLARS and BRIDGE in sim.js); an arena only changes the look.
import { Arena } from './arena.js';
import { GibbArena } from './gibb-arena.js';
import { buildBridge } from './bridge.js';
import { Thornwater } from './thornwater.js';
import { Kingsreach } from './kingsreach.js';

export const ARENAS = [
  { id: 'kingsreach', name: 'Kingsreach Colosseum', create: (scene, quality) => new Kingsreach(scene, quality) },
  { id: 'runefall', name: 'Classic Colosseum', create: (scene, quality) => new Arena(scene, quality) },
  { id: 'gibb', name: 'gibb Lorraine, Bern', create: scene => new GibbArena(scene) },
  // battleground maps: picked by the mode, not in the arena list of the menu
  { id: 'thornwater', name: 'Thornwater Gorge', battleground: true, create: (scene, quality) => new Thornwater(scene, quality) },
];

export function createArena(id, scene, quality) {
  const arena = (ARENAS.find(a => a.id === id) || ARENAS[0]).create(scene, quality);
  // the central bridge is part of the fight zone, so every arena gets it (an arena may skin it: arena.bridgeSkin)
  const bridge = buildBridge(arena.bridgeSkin); arena.group.add(bridge);
  const up = arena.update.bind(arena); let t = 0;
  arena.update = (dt, vfx) => { t += dt; bridge.userData.update(t); return up(dt, vfx); };
  return arena;
}
