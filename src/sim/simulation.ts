import { DAY_SEC } from './config';
import { ariTick } from './ari';
import { chronicle, clockOf } from './chronicle';
import { settlerExecute, settlerNeedsTick, settlerThink } from './goals';
import { tickOfferedFood } from './player';
import { creatureExecute, creatureNeedsTick, creatureThink } from './wildlife';
import type { World } from './types';

/**
 * One fixed simulation step. Called N times per rendered frame by the game
 * loop depending on sim speed — never tied to render FPS.
 */
export function simTick(world: World, dt: number): void {
  world.timeSec += dt;
  const t = world.timeSec;

  // Resource regeneration.
  for (const r of world.resources) {
    if (r.regenPerSec > 0 && r.quantity < r.maxQuantity) {
      r.quantity = Math.min(r.maxQuantity, r.quantity + r.regenPerSec * dt);
    }
  }
  tickOfferedFood(world);

  // Settlers.
  for (const s of world.settlers) {
    settlerNeedsTick(world, s, dt);
    if (t >= s.nextThinkAt) settlerThink(world, s);
    settlerExecute(world, s, dt);
  }

  // Creatures.
  for (const c of world.creatures) {
    creatureNeedsTick(world, c, dt);
    if (t >= c.nextThinkAt) {
      creatureThink(world, c);
      if (c.nextThinkAt <= t) c.nextThinkAt = t + 1; // safety: think fns set this, but never allow a hot loop
    }
    creatureExecute(world, c, dt);
  }

  // ARI runs at ~2 Hz of sim time.
  const lastAri = (world.flags.lastAriTick as number) ?? 0;
  if (t - lastAri > 0.5) {
    world.flags.lastAriTick = t;
    ariTick(world);
  }

  // Daybreak chronicle marker (one per day, low-noise).
  const day = Math.floor(t / DAY_SEC);
  const lastDay = (world.flags.lastDayMarked as number) ?? 0;
  if (day > lastDay && clockOf(t).hour >= 6) {
    world.flags.lastDayMarked = day;
    chronicle(world, 'system', `Day ${day + 1} begins over the Eden valley.`);
  }
}
