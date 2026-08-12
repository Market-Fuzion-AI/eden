import { DAY_SEC, STRUCT, YIELD } from './config';
import { ariTick } from './ari';
import { chronicle, clockOf } from './chronicle';
import { settlerExecute, settlerNeedsTick, settlerThink } from './goals';
import { fabricationTick } from './fabrication';
import { separateAgents } from './movement';
import { scanTick } from './scanner';
import { setTerrainSeed, terrainSeed } from './terrain';
import { tickOfferedFood } from './player';
import { creatureExecute, creatureNeedsTick, creatureThink } from './wildlife';
import type { World } from './types';

/**
 * One fixed simulation step. Called N times per rendered frame by the game
 * loop depending on sim speed — never tied to render FPS.
 */
export function simTick(world: World, dt: number): void {
  // Terrain answers for whichever world is currently being stepped. Without
  // this, creating a second world silently re-seeded the landscape under the
  // first and agents in world A began walking on world B's hills — the v0.4
  // sharp edge. Re-asserting it here costs one comparison per tick and closes
  // the hazard for anything that actually runs.
  if (terrainSeed() !== (world.seed >>> 0)) setTerrainSeed(world.seed);

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
  // The fabricator and the scanner run on simulation time, so accelerating
  // time shortens the wait without ever completing a job twice.
  fabricationTick(world);
  scanTick(world);

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

  // Abandon projects nobody has touched in a long while, so a stalled site
  // can never occupy a project slot forever.
  if (world.structures.length > 0 && Math.floor(t) % 30 === 0) {
    for (const st of world.structures) {
      if (st.state === 'complete') continue;
      // Real inactivity, not merely age: a site nobody has delivered to or
      // worked on is reclaimed even if someone still nominally intends to.
      const idle = t - st.lastWorkAt;
      if (idle <= STRUCT.projectAbandonAfter) continue;
      {
        for (const s of world.settlers) {
          if (s.buildPlan?.structureId === st.id) s.buildPlan = null;
        }
        world.structures = world.structures.filter((o) => o !== st);
        world.dirty.structures = true;
        chronicle(world, 'settlement', `The unfinished ${st.type} at ${st.place} was abandoned.`, {
          pos: { ...st.pos },
          place: st.place,
          cause: ['Nobody returned to finish it', `Stalled at ${Math.round(st.progress * 100)}%`],
          effects: ['The site was reclaimed by the valley'],
        });
        break;
      }
    }
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
