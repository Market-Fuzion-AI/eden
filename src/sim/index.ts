import { createWorld } from './worldgen';
import type { Entity, World } from './types';

/**
 * Simulation singleton. The world lives here — outside React, outside Three —
 * and rendering/UI read from it through accessors. Entities keep existing
 * whether or not anything renders them.
 */

let world: World | null = null;
let entityIndex: Map<string, Entity> = new Map();

export function initWorld(seed: number): World {
  world = createWorld(seed);
  world.flags.startTime = world.timeSec;
  rebuildIndex();
  return world;
}

export function getWorld(): World {
  if (!world) throw new Error('World not initialized');
  return world;
}

export function rebuildIndex(): void {
  if (!world) return;
  entityIndex = new Map();
  for (const s of world.settlers) entityIndex.set(s.id, s);
  for (const c of world.creatures) entityIndex.set(c.id, c);
}

export function getEntity(id: string): Entity | undefined {
  return entityIndex.get(id);
}
