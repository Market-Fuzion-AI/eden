import { CREATURE_SPECIES_BY_ID } from '../sim/species';
import type { World } from '../sim/types';
import {
  sfxBladeDeploy,
  sfxDefeat,
  sfxDodge,
  sfxExtraction,
  sfxHit,
  sfxPlayerHurt,
  sfxRakhorLunge,
  sfxRakhorWarn,
  sfxSalvage,
  sfxStagger,
  sfxSwing,
  sfxWardenBeam,
  sfxWardenBurst,
  sfxWardenCharge,
} from './audio';

/**
 * Turns simulation state into sound.
 *
 * Strictly an observer: it watches for transitions in state the simulation
 * already keeps and plays a sound when one happens. Nothing here writes to the
 * world, and deleting this file would leave the game fully playable — which is
 * the test for whether presentation has stayed on its own side of the line.
 */

/** Only creatures close enough to matter make noise. */
const AUDIBLE_RANGE = 34;

const seen = {
  strikeId: '',
  hitAt: -1,
  staggerAt: -1,
  killAt: -1,
  hurtAt: -1,
  burstAt: -1,
  salvageAt: -1,
  extractionAt: -1,
  bladeReady: false,
  /** Per-creature last announced threat state, so a tell fires once. */
  states: new Map<string, string>(),
};

export function resetSoundState(): void {
  seen.states.clear();
  seen.strikeId = '';
  seen.hitAt = -1;
  seen.staggerAt = -1;
  seen.killAt = -1;
  seen.hurtAt = -1;
  seen.burstAt = -1;
  seen.salvageAt = -1;
  seen.extractionAt = -1;
  seen.bladeReady = false;
}

export function soundTick(world: World): void {
  const p = world.player;

  // --- the player ----------------------------------------------------------
  if (p.unlocks.arcBlade && !seen.bladeReady) {
    seen.bladeReady = true;
    sfxBladeDeploy();
  }

  // One sound per swing, at the moment it starts. Keyed on the strike's
  // identity rather than its existence, so a chain plays three swings.
  if (p.strike) {
    const id = `${p.lastStrikeAt}:${p.strike.kind}:${p.strike.chain}`;
    if (id !== seen.strikeId) {
      seen.strikeId = id;
      sfxSwing(p.strike.kind, p.strike.chain);
    }
  }

  const hitAt = (world.flags.lastHitAt as number) ?? -1;
  if (hitAt > seen.hitAt) {
    seen.hitAt = hitAt;
    // What was hit decides the timbre. Nearest engaged creature is a good
    // enough proxy and costs nothing.
    const target = nearestEngaged(world);
    sfxHit(Boolean(target && CREATURE_SPECIES_BY_ID[target].synthetic), p.strike?.kind === 'heavy');
  }

  const staggerAt = (world.flags.lastStaggerAt as number) ?? -1;
  if (staggerAt > seen.staggerAt) {
    seen.staggerAt = staggerAt;
    sfxStagger();
  }

  const killAt = (world.flags.lastKillAt as number) ?? -1;
  if (killAt > seen.killAt) {
    seen.killAt = killAt;
    sfxDefeat(Boolean(world.flags.lastKillSynthetic));
  }

  if (p.lastHurtAt > seen.hurtAt) {
    seen.hurtAt = p.lastHurtAt;
    sfxPlayerHurt();
  }

  if (p.dodgeTrail > 0 && p.dodgeTimer > 0 && p.dodgeTrail > p.dodgeTimer) {
    // Fires on the first frame of the roll only: the trail outlives the roll,
    // so this ordering is true exactly once per dodge.
    if (seen.strikeId !== `dodge:${p.invulnUntil}`) {
      seen.strikeId = `dodge:${p.invulnUntil}`;
      sfxDodge();
    }
  }

  const salvage = world.pickupsSalvage[world.pickupsSalvage.length - 1];
  if (salvage && salvage.at > seen.salvageAt) {
    seen.salvageAt = salvage.at;
    sfxSalvage();
  }

  if (p.extraction && p.extraction.startedAt > seen.extractionAt) {
    seen.extractionAt = p.extraction.startedAt;
    sfxExtraction();
  }

  const burstAt = (world.flags.wardenBurstAt as number) ?? -1;
  if (burstAt > seen.burstAt) {
    seen.burstAt = burstAt;
    sfxWardenBurst();
  }

  // --- the creatures -------------------------------------------------------
  for (const c of world.creatures) {
    if (!c.combat) continue;
    const prev = seen.states.get(c.id);
    const now = c.combat.state;
    if (prev === now) continue;
    seen.states.set(c.id, now);
    // Distant creatures still change state; they just do it silently.
    const d = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z);
    if (d > AUDIBLE_RANGE) continue;
    switch (now) {
      case 'warn':
        sfxRakhorWarn();
        break;
      case 'lunge':
        sfxRakhorLunge();
        break;
      case 'charge':
        sfxWardenCharge();
        break;
      case 'beam':
        sfxWardenBeam();
        break;
      default:
        break;
    }
  }
  // Creatures that no longer exist should not keep an entry forever.
  if (seen.states.size > world.creatures.length * 2 + 8) {
    const live = new Set(world.creatures.map((c) => c.id));
    for (const id of [...seen.states.keys()]) if (!live.has(id)) seen.states.delete(id);
  }
}

/** The species id of whatever Emerson is most likely to have just hit. */
function nearestEngaged(world: World): string | null {
  const p = world.player;
  let best: string | null = null;
  let bestD = 5;
  for (const c of world.creatures) {
    if (!c.combat) continue;
    const d = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z);
    if (d < bestD) {
      best = c.speciesId;
      bestD = d;
    }
  }
  return best;
}
