// Arena registry. To add an arena: write a class with the Arena contract
// (constructor(scene, quality), group, ready, update(dt, vfx), crowdHype, flames) and add one entry here.
// The fight zone is the same for every arena (ARENA_R and PILLARS in sim.js); an arena only changes the look.
import { Arena } from './arena.js';
import { GibbArena } from './gibb-arena.js';

export const ARENAS = [
  { id: 'runefall', name: 'Runefall Colosseum', create: (scene, quality) => new Arena(scene, quality) },
  { id: 'gibb', name: 'gibb Lorraine, Bern', create: scene => new GibbArena(scene) },
];

export function createArena(id, scene, quality) {
  return (ARENAS.find(a => a.id === id) || ARENAS[0]).create(scene, quality);
}
