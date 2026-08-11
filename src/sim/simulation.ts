import { DAY_SEC, YIELD } from './config';
import { ariTick } from './ari';
import { chronicle, clockOf } from './chronicle';
import { settlerExecute, settlerNeedsTick, settlerThink } from './goals';
import { separateAgents } from './movement';
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

  // Resource regeneration, scaled by the world's glowberry yield. Under low
  // yield patches hold less and refill slowly, which is the only pressure the
  // simulation needs — competition emerges from the existing needs and
  // relationship systems rather than being scripted.
  const yieldCfg = YIELD[world.yieldMode];
  for (const r of world.resources) {
    const scarce = r.type === 'glowberry';
    const cap = scarce ? Math.max(1, r.maxQuantity * yieldCfg.capScale) : r.maxQuantity;
    const regen = scarce ? r.regenPerSec * yieldCfg.regenScale : r.regenPerSec;
    if (regen > 0 && r.quantity < cap) {
      r.quantity = Math.min(cap, r.quantity + regen * dt);
    } else if (r.quantity > cap) {
      // Yield was just lowered: existing berries dwindle rather than vanish.
      r.quantity = Math.max(cap, r.quantity - 0.05 * dt);
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

  // Resolve residual body overlap after everyone has moved.
  separateAgents(world, dt);

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
