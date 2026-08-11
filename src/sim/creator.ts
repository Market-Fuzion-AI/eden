import { DAY_SEC, YIELD } from './config';
import { chronicle } from './chronicle';
import { placeName } from './landmarks';
import { isWater } from './terrain';
import type { World, YieldMode } from './types';
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

/**
 * The one controlled scarcity lever. Lowering the yield does not script
 * conflict — it lets the existing needs, utility and relationship systems
 * respond to genuine competition for food.
 */
export function creatorSetYield(world: World, mode: YieldMode): void {
  if (world.yieldMode === mode) return;
  world.yieldMode = mode;
  const cfg = YIELD[mode];
  chronicle(
    world,
    'creator',
    mode === 'low'
      ? 'The Creator thinned the glowberries across the valley.'
      : 'The Creator restored the glowberry harvest.',
    {
      cause: ['Direct Creator intervention'],
      effects: [
        `Glowberry yield set to ${cfg.label}`,
        `Patch capacity ×${cfg.capScale}, regrowth ×${cfg.regenScale}`,
        mode === 'low' ? 'Settlers will begin competing for food' : 'Food pressure eases',
      ],
    },
  );
}

export function creatorToggleWeather(world: World): void {
  world.weather = world.weather === 'clear' ? 'mist' : 'clear';
  chronicle(world, 'creator', world.weather === 'mist' ? 'The Creator drew a mist across the valley.' : 'The Creator cleared the skies.');
}

/**
 * Spawn a glowberry patch at a clicked world position.
 * The node records its provenance so a later inspection can always answer
 * "who put this here, and when" — no world change is anonymous.
 */
export function creatorSpawnFood(world: World, pos: V2): boolean {
  if (isWater(pos.x, pos.z)) return false;
  const place = placeName(pos);
  world.resources.push({
    id: `creator_food_${spawnCounter++}`,
    type: 'glowberry',
    label: `the glowberries at ${place}`,
    pos: { x: pos.x, z: pos.z },
    quantity: 8,
    maxQuantity: 8,
    regenPerSec: 1 / 45,
    discovered: false,
    origin: { cause: 'creator_spawn', actorId: 'creator', t: world.timeSec },
  });
  world.dirty.resources = true;
  chronicle(world, 'creator', `The Creator willed a glowberry patch into existence at ${place}.`, {
    pos: { x: pos.x, z: pos.z },
    place,
    cause: ['Direct Creator intervention'],
    effects: ['New food source added to the world', 'Settlers must still discover it themselves'],
  });
  return true;
}
