import { DAY_SEC } from './config';
import { chronicle } from './chronicle';
import { isWater } from './terrain';
import type { World } from './types';
import type { V2 } from './vec';

/**
 * Creator Mode interventions — sovereign manipulation of simulation state.
 * v0.1 keeps these deliberately small: time of day, weather, spawned food.
 */

let spawnCounter = 0;

/** Jump sim time FORWARD to the next occurrence of the given hour (time stays monotonic). */
export function creatorSetHour(world: World, hour: number, label: string): void {
  const currentDayFrac = (world.timeSec % DAY_SEC) / DAY_SEC;
  const targetFrac = hour / 24;
  let delta = (targetFrac - currentDayFrac) * DAY_SEC;
  if (delta <= 1) delta += DAY_SEC;
  world.timeSec += delta;
  // Push per-agent schedules forward so nobody "thinks" thousands of times at once.
  for (const s of world.settlers) {
    s.nextThinkAt = world.timeSec + world.rng.range(0.2, 1.5);
    s.socialCooldownUntil = Math.min(s.socialCooldownUntil, world.timeSec);
  }
  for (const c of world.creatures) {
    c.nextThinkAt = world.timeSec + world.rng.range(0.2, 2);
  }
  chronicle(world, 'creator', `The Creator turned the sky to ${label}.`);
}

export function creatorToggleWeather(world: World): void {
  world.weather = world.weather === 'clear' ? 'mist' : 'clear';
  chronicle(world, 'creator', world.weather === 'mist' ? 'The Creator drew a mist across the valley.' : 'The Creator cleared the skies.');
}

/** Spawn a glowberry patch at a clicked world position. */
export function creatorSpawnFood(world: World, pos: V2): boolean {
  if (isWater(pos.x, pos.z)) return false;
  world.resources.push({
    id: `creator_food_${spawnCounter++}`,
    type: 'glowberry',
    label: 'a patch that appeared from nowhere',
    pos: { x: pos.x, z: pos.z },
    quantity: 8,
    maxQuantity: 8,
    regenPerSec: 1 / 45,
    discovered: false,
  });
  world.dirty.resources = true;
  chronicle(world, 'creator', 'The Creator willed a glowberry patch into existence.');
  return true;
}
