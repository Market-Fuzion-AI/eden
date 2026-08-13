import { isNight } from './chronicle';
import { landmarkAt } from './landmarks';
import { REGIONS, regionAt } from './regions';
import { dist } from './vec';
import type { World } from './types';

/**
 * ARI — Kai's HUD AI. Deterministic contextual lines with once-flags and
 * cooldowns so she feels present without spamming. No external AI involved.
 */

/**
 * One line per region telling the player what is worth gathering there.
 * Deliberately geological rather than a waypoint: it says "look around here",
 * not "the ore is at these coordinates".
 */
const REGION_MATERIAL_HINT: Record<string, string> = {
  riverlands:
    'Hull fragments are scattered across the whole approach path. Salvaged alloy will not be hard to find near home.',
  ashlands: 'Geological conductivity is elevated here. These seams should yield conductive ore.',
  skyreach: 'Crystalline energy signatures, concentrated at altitude. Aether crystal, if I read this correctly.',
};

const AMBIENT_LINES = [
  'Local flora exhibits coordinated bioluminescent signaling. Fascinating.',
  'I am cataloguing nine distinct native organism archetypes. So far.',
  'Translation matrices for Veyra and Caelari dialects are holding steady.',
  'This valley has remarkable acoustic properties. I can hear everything.',
  'Reminder: we are the aliens here, Kai.',
];

export function ariTick(world: World): void {
  const t = world.timeSec;
  const f = world.flags;
  const say = (line: string) => {
    if (world.ariQueue.length < 4) world.ariQueue.push(line);
  };

  // Region arrival: the coarse orientation cue. Named once, on first entry,
  // so the player learns the shape of the valley by walking it.
  if (!world.player.dead) {
    const region = regionAt(world.player.pos.x, world.player.pos.z);
    if (region !== 'wilds' && !f[`region_${region}`]) {
      f[`region_${region}`] = true;
      say(REGIONS.find((r) => r.id === region)!.ariLine);
      // What this region is good for. Broad geological hints, said once —
      // enough to point the player somewhere without marking every node.
      const hint = REGION_MATERIAL_HINT[region];
      if (hint) say(hint);
    }
  }

  // Landmark arrival: ARI names each place the first time Kai enters it,
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
    say('Pathfinder systems online. Take a look around, Kai — the colony is not going to survey itself.');
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
  // NOTE: ARI deliberately does *not* announce who claims a shelter. She can
  // only speak about norm events Kai was physically present for, which
  // `witnessNorm` queues at the moment he sees them. Reading a claimant out of
  // simulation state would make her omniscient and undo v0.6's whole point.

  // Health warning.
  if (world.player.health < 35 && !world.player.dead) {
    if (!f.ariHealthWarnAt || t - (f.ariHealthWarnAt as number) > 60) {
      f.ariHealthWarnAt = t;
      say('Your vitals are declining, Kai. Consider not doing that again.');
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
