import { isNight } from './chronicle';
import { landmarkAt } from './landmarks';
import { emersonBlocker } from './normEvents';
import { shelterAtHand } from './player';
import { dist } from './vec';
import type { World } from './types';

/**
 * ARI — Emerson's HUD AI. Deterministic contextual lines with once-flags and
 * cooldowns so she feels present without spamming. No external AI involved.
 */

const AMBIENT_LINES = [
  'Local flora exhibits coordinated bioluminescent signaling. Fascinating.',
  'I am cataloguing nine distinct native organism archetypes. So far.',
  'Translation matrices for Veyra and Caelari dialects are holding steady.',
  'This valley has remarkable acoustic properties. I can hear everything.',
  'Reminder: we are the aliens here, Emerson.',
];

export function ariTick(world: World): void {
  const t = world.timeSec;
  const f = world.flags;
  const say = (line: string) => {
    if (world.ariQueue.length < 4) world.ariQueue.push(line);
  };

  // Landmark arrival: ARI names each place the first time Emerson enters it,
  // giving the valley location identity rather than anonymous terrain.
  if (!world.player.dead) {
    const lm = landmarkAt(world.player.pos);
    if (lm && !f[`lm_${lm.id}`]) {
      f[`lm_${lm.id}`] = true;
      say(lm.ariLine);
    }
  }

  // Arrival greeting.
  if (!f.ariIntro && t > (f.startTime as number ?? 0) + 3) {
    f.ariIntro = true;
    say('Atmospheric conditions stable. Local biosphere activity is higher than expected.');
  }
  // First close look at a settler.
  if (!f.ariScan) {
    for (const s of world.settlers) {
      if (dist(s.pos, world.player.pos) < 9) {
        f.ariScan = true;
        say('Lifeform profiles available. I will annotate whoever you approach.');
        break;
      }
    }
  }
  // First nightfall.
  if (!f.ariNight && isNight(t)) {
    f.ariNight = true;
    say('First night on Eden. The bioluminescence is... considerable.');
  }
  // Lumi follow transitions (flags set by wildlife.ts).
  if (f.lumiFollowSignal && !f.ariFollow) {
    f.ariFollow = true;
    say('It appears to be following us.');
  }
  if (f.lumiStoppedFollowing && f.ariFollow && !f.ariFollowEnd) {
    f.ariFollowEnd = true;
    say('Correction. It was following us.');
  }
  // Re-arm follow lines occasionally so they can recur (but rarely).
  if (f.ariFollowEnd && typeof f.lumiStoppedFollowing === 'number' && t - (f.lumiStoppedFollowing as number) > 300) {
    f.ariFollow = false;
    f.ariFollowEnd = false;
    f.lumiFollowSignal = false;
    f.lumiStoppedFollowing = false;
  }
  // Social expectation warning: ARI reads the room so Emerson can too.
  if (!world.player.dead) {
    const shelter = shelterAtHand(world);
    if (shelter) {
      const blocker = emersonBlocker(world, shelter);
      const key = `ariClaim_${shelter.id}`;
      if (blocker && !f[key]) {
        f[key] = true;
        say(`${blocker.settler.name} appears to consider this shelter personally controlled.`);
      }
    }
  }

  // Health warning.
  if (world.player.health < 35 && !world.player.dead) {
    if (!f.ariHealthWarnAt || t - (f.ariHealthWarnAt as number) > 60) {
      f.ariHealthWarnAt = t;
      say('Your vitals are declining, Emerson. Consider not doing that again.');
    }
  }
  // Rare ambient observation.
  if (!f.ariAmbientAt) f.ariAmbientAt = t;
  if (t - (f.ariAmbientAt as number) > 170 && world.rng.chance(0.004)) {
    f.ariAmbientAt = t;
    const idx = (f.ariAmbientIdx as number ?? 0) % AMBIENT_LINES.length;
    f.ariAmbientIdx = idx + 1;
    say(AMBIENT_LINES[idx]);
  }
}

export function ariCreatorToggle(world: World): void {
  if (!world.flags.ariCreator) {
    world.flags.ariCreator = true;
    world.ariQueue.push('Administrator access confirmed. I will pretend this is normal.');
  }
}
