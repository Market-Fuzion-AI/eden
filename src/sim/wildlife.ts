import { LUMI, WILDLIFE, WORLD } from './config';
import { chronicle, daylight01 } from './chronicle';
import { placeName } from './landmarks';
import { remember } from './memory';
import { stand, stepToward } from './movement';
import { CREATURE_SPECIES_BY_ID } from './species';
import { isWater, riverX } from './terrain';
import { makeCreature } from './worldgen';
import { dispositionOf, purposeLabel, threatExecute, threatThink } from './threats';
import type { Creature, Goal, GoalType, World } from './types';
import { angleTo, clamp100, dist, lerpAngle, v2, type V2 } from './vec';

/**
 * Native creature cognition. Simpler than settlers, but still autonomous:
 * graze, rest, wander, investigate, flee — plus bounded budding replication,
 * and Lumi's trust-driven relationship with Emerson.
 */

function mkGoal(type: GoalType, label: string, t: number, opts: Partial<Goal> = {}): Goal {
  return { type, label, phase: 'travel', timer: 0, startedAt: t, deadline: t + 45, ...opts };
}

function wanderTarget(world: World, c: Creature, radius: number): V2 {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  const rng = world.rng;
  if (def.aquatic) {
    const z = Math.max(-110, Math.min(110, c.pos.z + rng.range(-30, 30)));
    return v2(riverX(z) + rng.range(-3, 3), z);
  }
  for (let i = 0; i < 10; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = rng.range(radius * 0.3, radius);
    const p = v2(c.home.x + Math.sin(a) * d, c.home.z + Math.cos(a) * d);
    if (Math.hypot(p.x, p.z) > WORLD.playRadius - 8) continue;
    if (!def.aquatic && isWater(p.x, p.z)) continue;
    return p;
  }
  return { ...c.home };
}

function nearestGlowplant(world: World, p: V2, maxDist: number): V2 | null {
  let best: V2 | null = null;
  let bestD = maxDist;
  for (const f of world.flora) {
    if (f.type !== 'glowplant') continue;
    const d = dist(p, f.pos);
    if (d < bestD) {
      best = f.pos;
      bestD = d;
    }
  }
  return best;
}

/** Mark a creature as threatened from a position (player attack, startle). */
export function alarmCreature(world: World, c: Creature, from: V2): void {
  c.threatPos = { ...from };
  c.threatUntil = world.timeSec + WILDLIFE.fleeDuration;
  c.fear = 100;
  c.goal = mkGoal('flee', 'Flee!', world.timeSec, { deadline: world.timeSec + WILDLIFE.fleeDuration + 4 });
}

// ---------------------------------------------------------------------------
// Replication (budding) — deliberately bounded
// ---------------------------------------------------------------------------

function maybeReplicate(world: World, c: Creature): void {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  const t = world.timeSec;
  if (c.lumi) return; // Lumi is a persistent individual, not a population source
  if (c.ageStage !== 'adult') return;
  if (t < c.replicationCooldownUntil) return;
  if (c.energy < 80 || c.hunger > 40) return;
  if (world.creatures.length >= WILDLIFE.globalCreatureCap) return;
  const sameSpecies = world.creatures.filter((o) => o.speciesId === c.speciesId).length;
  if (sameSpecies >= def.replication.cap) return;
  if (!world.rng.chance(def.replication.chancePerThink)) return;

  // Budding: costly for the parent, bounded by caps and cooldowns above.
  c.energy -= WILDLIFE.replicationEnergyCost;
  c.replicationCooldownUntil = t + WILDLIFE.replicationCooldown;
  const child = makeCreature(world, world.rng, def, v2(c.pos.x + world.rng.range(-2, 2), c.pos.z + world.rng.range(-2, 2)), true);
  child.replicationCooldownUntil = t + WILDLIFE.replicationCooldown * 2;
  world.creatures.push(child);
  world.dirty.entities = true;
  const place = placeName(c.pos);
  chronicle(world, 'wildlife', `A ${def.name} budded — a juvenile emerges at ${place}.`, {
    actorIds: [c.id, child.id],
    actorNames: [def.name, `juvenile ${def.name}`],
    pos: { ...c.pos },
    place,
    cause: [
      `Parent energy surplus (${Math.round(c.energy + WILDLIFE.replicationEnergyCost)})`,
      `Hunger low (${Math.round(c.hunger)})`,
      `Species population ${sameSpecies} of ${def.replication.cap} permitted`,
    ],
    effects: [
      `Parent energy −${WILDLIFE.replicationEnergyCost}`,
      'A juvenile joins the ecosystem',
      `Parent cannot bud again for ${Math.round(WILDLIFE.replicationCooldown / 60)} minutes`,
    ],
  });
}

// ---------------------------------------------------------------------------
// Lumi
// ---------------------------------------------------------------------------

function lumiTrustMilestones(world: World, c: Creature): void {
  const l = c.lumi!;
  const milestones: [number, string][] = [
    [25, 'Lumi is beginning to trust Emerson.'],
    [50, 'Lumi now trusts Emerson enough to stay close.'],
    [75, 'Lumi and Emerson have formed a real bond.'],
  ];
  for (const [threshold, text] of milestones) {
    if (l.trust >= threshold && l.lastTrustMilestone < threshold) {
      l.lastTrustMilestone = threshold;
      chronicle(world, 'lumi', text);
    }
  }
}

function lumiThink(world: World, c: Creature): void {
  const t = world.timeSec;
  const rng = world.rng;
  const l = c.lumi!;
  const p = world.player;
  const dp = dist(c.pos, p.pos);
  const reason: string[] = [];

  // First contact.
  if (dp < 14 && !world.flags.lumiMet) {
    world.flags.lumiMet = true;
    chronicle(world, 'lumi', 'Emerson discovered a small glowing creature watching him from the glade.', {
      actorIds: ['lumi', 'emerson'],
      actorNames: ['Lumi', 'Emerson'],
      pos: { ...c.pos },
      place: placeName(c.pos),
      cause: ['Emerson came within 14m', `Her curiosity ${Math.round(c.curiosity)} outweighed her caution`],
      effects: ['First contact recorded', `Trust begins at ${Math.round(l.trust)} / 100`],
    });
    world.ariQueue.push('Unknown native organism detected. It does not match any catalogued species.');
  }

  // Startle: fast approach at close range costs trust.
  if (!p.dead && dp < 6 && p.speed > 5 && t - c.threatUntil > 3) {
    l.trust = Math.max(0, l.trust - LUMI.startleTrustLoss);
    l.following = false;
    alarmCreature(world, c, p.pos);
    c.goalReason = { summary: ['Startled — Emerson moved too fast', `Trust ${Math.round(l.trust)}`], scores: [] };
    return;
  }

  // Offered food is the strongest lure — but she keeps her distance rules.
  const offer = world.offeredFood[0];
  if (offer && dist(c.pos, offer.pos) < 34) {
    const comfortDist = 6 - (l.trust / 100) * 5; // needs Emerson to back off unless trust is high
    const playerFarEnough = dist(p.pos, offer.pos) > comfortDist;
    if ((l.trust > 12 || c.hunger > 60) && playerFarEnough) {
      if (c.goal.type !== 'approach-food') {
        c.goal = mkGoal('approach-food', 'Investigate the offered food', t, {
          targetId: offer.id,
          targetPos: { ...offer.pos },
          deadline: t + 40,
        });
      }
      reason.push('Food offered nearby', `Hunger ${Math.round(c.hunger)}`, `Trust ${Math.round(l.trust)} — willing to approach`);
      c.goalReason = { summary: reason, scores: [] };
      return;
    } else if (!playerFarEnough) {
      // She wants it, but Emerson is standing too close.
      c.goal = mkGoal('watch-emerson', 'Watch Emerson warily', t, { deadline: t + 10 });
      c.goal.phase = 'act';
      c.goal.timer = 4;
      c.goalReason = {
        summary: ['Wants the offered food', `But Emerson is too close (needs ${comfortDist.toFixed(1)}m)`, `Trust ${Math.round(l.trust)}`],
        scores: [],
      };
      return;
    }
  }

  // Following: only at high trust, sometimes, and never permanently.
  if (l.following) {
    if (t > l.followUntil || dp > 34 || c.energy < 20 || rng.chance(0.04)) {
      l.following = false;
      world.flags.lumiStoppedFollowing = t;
      c.goal = mkGoal('investigate', 'Sniff at a glowplant', t, {
        targetPos: nearestGlowplant(world, c.pos, 50) ?? wanderTarget(world, c, 20),
      });
      c.goalReason = { summary: ['Lost interest in following', 'Something else caught her eye'], scores: [] };
    } else {
      c.goal = mkGoal('follow-emerson', 'Follow Emerson', t, { deadline: t + 10 });
      c.goalReason = {
        summary: [`Trust ${Math.round(l.trust)} — enjoys his company`, 'Curious where he is going'],
        scores: [],
      };
    }
    return;
  }
  if (!p.dead && l.trust >= LUMI.followTrustThreshold && dp < 12 && rng.chance(LUMI.followChancePerThink)) {
    l.following = true;
    l.followUntil = t + rng.range(LUMI.followDurationMin, LUMI.followDurationMax);
    if (!world.flags.lumiFollowedOnce) {
      world.flags.lumiFollowedOnce = true;
      chronicle(world, 'lumi', 'Lumi began following Emerson of her own accord.');
    }
    world.flags.lumiFollowSignal = t;
    return;
  }

  // Basic needs.
  if (c.hunger > 65) {
    const plant = nearestGlowplant(world, c.pos, 80);
    c.goal = mkGoal('graze', 'Nibble a glowplant', t, { targetPos: plant ?? wanderTarget(world, c, 25) });
    c.goalReason = { summary: [`Hunger ${Math.round(c.hunger)}`, 'Glowplants are her food'], scores: [] };
    return;
  }
  if (c.energy < 25) {
    c.goal = mkGoal('rest', 'Curl up and doze', t, { targetPos: wanderTarget(world, c, 8) });
    c.goalReason = { summary: [`Energy ${Math.round(c.energy)}`, 'Needs to doze'], scores: [] };
    return;
  }

  // Curious observation of Emerson — approach distance shrinks as trust grows.
  if (!p.dead && dp < 20 && p.speed < 4 && rng.chance(0.3 + l.trust / 250)) {
    c.goal = mkGoal('watch-emerson', 'Observe Emerson', t, { deadline: t + 25 });
    c.goalReason = {
      summary: ['Curiosity high', `Trust ${Math.round(l.trust)} — keeps ${(8 - (l.trust / 100) * 6).toFixed(0)}m distance`, 'No threats nearby'],
      scores: [],
    };
    return;
  }

  // Default: investigate interesting things in the glade.
  const glow = nearestGlowplant(world, wanderTarget(world, c, 30), 25);
  c.goal = mkGoal('investigate', 'Investigate a glowing plant', t, { targetPos: glow ?? wanderTarget(world, c, 22) });
  c.goalReason = { summary: ['Curiosity high', `Hunger low (${Math.round(c.hunger)})`, 'No nearby threat'], scores: [] };
}

// ---------------------------------------------------------------------------
// Generic creature think
// ---------------------------------------------------------------------------

export function creatureThink(world: World, c: Creature): void {
  const t = world.timeSec;
  const rng = world.rng;
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];

  maybeReplicate(world, c);

  // Dangerous creatures are driven entirely by the threat machine, including
  // when nothing is happening: a predator on its own time is stalking or
  // patrolling, not foraging. v0.8 let them fall through to the generic
  // routine, and the ancient machine guardian spent its days eating glowplants.
  if (c.combat && threatThink(world, c)) {
    c.goal = mkGoal('threat', threatLabel(c), t, { deadline: t + 30 });
    c.goalReason = { summary: threatReason(world, c), scores: [] };
    c.nextThinkAt = t + 0.25;
    return;
  }

  // Small fauna give roused predators and firing guardians a wide berth. This
  // is the whole of EDEN's cross-creature reaction: not a food chain, just
  // enough for an encounter to look like it is happening inside an ecosystem
  // rather than on an empty stage.
  const danger = nearbyActiveDanger(world, c);
  if (danger) {
    alarmCreature(world, c, danger.pos);
    c.nextThinkAt = t + 1.2;
    return;
  }

  if (c.threatUntil > t && c.threatPos) {
    // Keep fleeing — handled in execute.
    c.goalReason = { summary: ['Threatened!', 'Putting distance between itself and danger'], scores: [] };
    c.nextThinkAt = t + 0.5;
    return;
  }
  c.fear = Math.max(0, c.fear - 8);

  if (c.lumi) {
    lumiThink(world, c);
    c.nextThinkAt = t + rng.range(0.8, 1.6);
    return;
  }

  const day = daylight01(t);
  const active = def.nocturnal ? 1 - day : 1;

  if (c.hunger > 55 * (2 - active)) {
    c.goal = mkGoal('graze', 'Graze', t, { targetPos: wanderTarget(world, c, 18) });
    c.goalReason = { summary: [`Hunger ${Math.round(c.hunger)}`, 'Forage within home range'], scores: [] };
  } else if (c.energy < 30 || (def.nocturnal && day > 0.6 && rng.chance(0.5))) {
    c.goal = mkGoal('rest', 'Rest', t, { targetPos: wanderTarget(world, c, 6) });
    c.goalReason = { summary: [`Energy ${Math.round(c.energy)}`, def.nocturnal ? 'Daylight — hiding' : 'Tired'], scores: [] };
  } else if (rng.chance(def.traits.curiosity * 0.35)) {
    // Investigate something interesting: a glowplant, another creature, or Emerson.
    const p = world.player;
    const dp = dist(c.pos, p.pos);
    let target: V2 | null = null;
    let label = 'Investigate a glowing plant';
    if (!p.dead && dp < 25 && dp > 6 && rng.chance(0.4)) {
      target = v2(p.pos.x + rng.range(-4, 4), p.pos.z + rng.range(-4, 4));
      label = 'Investigate the newcomer';
    } else {
      target = nearestGlowplant(world, c.pos, 40);
    }
    c.goal = mkGoal('investigate', label, t, { targetPos: target ?? wanderTarget(world, c, 20) });
    c.goalReason = { summary: [`Curiosity ${Math.round(def.traits.curiosity * 100)}`, 'Nothing threatening nearby'], scores: [] };
  } else {
    c.goal = mkGoal('wander', 'Roam the home range', t, { targetPos: wanderTarget(world, c, 24) });
    c.goalReason = { summary: ['Content', 'Roaming its territory'], scores: [] };
  }
  c.nextThinkAt = t + rng.range(1.2, 2.8);
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export function creatureExecute(world: World, c: Creature, dt: number): void {
  // Engaged creatures move under the threat machine instead of their goal, so
  // nothing tries to graze mid-lunge.
  if (c.combat && threatExecute(world, c, dt)) return;

  const t = world.timeSec;
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  const g = c.goal;
  const opts = { speed: def.speed, aquatic: def.aquatic, avoidWater: !def.aquatic && !def.hover };

  // Fleeing overrides everything while the threat timer runs.
  if (c.threatUntil > t && c.threatPos) {
    const away = angleTo(c.threatPos, c.pos);
    const target = v2(c.pos.x + Math.sin(away) * WILDLIFE.fleeDistance, c.pos.z + Math.cos(away) * WILDLIFE.fleeDistance);
    stepToward(world, c, target, dt, { ...opts, speed: def.speed * 1.8 });
    c.resting = false;
    return;
  }

  switch (g.type) {
    case 'flee': // threat expired — fall through to done
      g.phase = 'done';
      stand(c);
      break;
    case 'graze':
    case 'investigate':
    case 'wander':
    case 'rest': {
      if (g.phase === 'travel') {
        const d = stepToward(world, c, g.targetPos ?? c.home, dt, opts);
        if (d < 1.2 || t > g.deadline) {
          g.phase = 'act';
          g.timer = g.type === 'graze' ? WILDLIFE.grazeDuration : g.type === 'rest' ? 18 : 5;
          if (g.type === 'rest') c.resting = true;
        }
      } else if (g.phase === 'act') {
        stand(c);
        g.timer -= dt;
        if (g.type === 'rest') c.energy = clamp100(c.energy + WILDLIFE.restRecover * dt);
        if (g.timer <= 0) {
          if (g.type === 'graze') {
            c.hunger = Math.max(0, c.hunger - WILDLIFE.grazeReduces);
            c.energy = clamp100(c.energy + 10);
          }
          c.resting = false;
          g.phase = 'done';
        }
      } else {
        stand(c);
      }
      break;
    }
    case 'approach-food': {
      const offer = world.offeredFood.find((o) => o.id === g.targetId);
      if (!offer) {
        g.phase = 'done';
        return;
      }
      if (g.phase === 'travel') {
        const d = stepToward(world, c, offer.pos, dt, { ...opts, speed: def.speed * 0.7 });
        if (d < 0.9) {
          g.phase = 'act';
          g.timer = 3.5;
        }
      } else {
        stand(c);
        g.timer -= dt;
        if (g.timer <= 0) {
          world.offeredFood = world.offeredFood.filter((o) => o.id !== offer.id);
          world.dirty.resources = true;
          c.hunger = Math.max(0, c.hunger - 40);
          if (c.lumi) {
            const l = c.lumi;
            l.fedCount++;
            l.trust = Math.min(100, l.trust + LUMI.feedTrustGain + (l.fedCount === 1 ? LUMI.firstFeedBonus : 0));
            remember(c, { type: 'fed_by_emerson', t, emotionalWeight: 0.8 });
            const detail = {
              actorIds: ['lumi', 'emerson'],
              actorNames: ['Lumi', 'Emerson'],
              pos: { ...c.pos },
              place: placeName(c.pos),
              cause: [
                `Hunger ${Math.round(c.hunger + 40)} before eating`,
                'Emerson kept a respectful distance',
                `Trust was ${Math.round(l.trust - LUMI.feedTrustGain - (l.fedCount === 1 ? LUMI.firstFeedBonus : 0))}`,
              ],
              effects: [
                `Trust → ${Math.round(l.trust)} / 100`,
                'Hunger −40',
                'Memory created: Emerson gave me food',
              ],
            };
            if (l.fedCount === 1) {
              chronicle(world, 'lumi', 'Lumi accepted food from Emerson for the first time.', detail);
              world.ariQueue.push('Interesting. Trust behaviors forming. I suggest not ruining this.');
            } else {
              chronicle(world, 'lumi', 'Lumi accepted food from Emerson.', detail);
            }
            lumiTrustMilestones(world, c);
          }
          g.phase = 'done';
        }
      }
      break;
    }
    case 'watch-emerson': {
      const p = world.player;
      const l = c.lumi;
      const keepDist = l ? 8 - (l.trust / 100) * 6 : 8;
      const dp = dist(c.pos, p.pos);
      if (dp > keepDist + 1.5) {
        stepToward(world, c, p.pos, dt, { ...opts, speed: def.speed * 0.6 });
      } else if (dp < keepDist - 1.5) {
        const away = angleTo(p.pos, c.pos);
        stepToward(world, c, v2(c.pos.x + Math.sin(away) * 4, c.pos.z + Math.cos(away) * 4), dt, opts);
      } else {
        stand(c);
        c.heading = lerpAngle(c.heading, angleTo(c.pos, p.pos), 1 - Math.exp(-5 * dt));
        // Calm shared proximity slowly builds trust after the first feeding.
        if (l && l.fedCount > 0) {
          l.trust = Math.min(100, l.trust + LUMI.calmProximityGainPerSec * dt * 60);
          lumiTrustMilestones(world, c);
        }
        g.timer -= dt;
      }
      if (t > g.deadline) g.phase = 'done';
      break;
    }
    case 'follow-emerson': {
      const p = world.player;
      const behind = v2(p.pos.x - Math.sin(p.heading) * 2.6, p.pos.z - Math.cos(p.heading) * 2.6);
      const dp = dist(c.pos, p.pos);
      if (dp > 3.4) stepToward(world, c, behind, dt, { ...opts, speed: def.speed * 1.15 });
      else {
        stand(c);
        c.heading = lerpAngle(c.heading, p.heading, 1 - Math.exp(-4 * dt));
      }
      if (t > g.deadline) g.phase = 'done';
      break;
    }
    case 'attack-player': {
      const p = world.player;
      if (p.dead || dist(c.pos, p.pos) > 32) {
        c.aggroUntil = 0;
        g.phase = 'done';
        return;
      }
      const d = stepToward(world, c, p.pos, dt, { ...opts, speed: def.speed });
      const biteCooldown = (world.flags[`bite_${c.id}`] as number) ?? 0;
      if (d < 1.8 && t > biteCooldown) {
        world.flags[`bite_${c.id}`] = t + 1.6;
        p.health = Math.max(0, p.health - 12);
        world.flags.playerHitAt = t;
      }
      break;
    }
    default:
      stand(c);
      g.phase = 'done';
  }
}

/** The creature's own words for what it is doing about Emerson. */
function threatLabel(c: Creature): string {
  switch (c.combat?.state) {
    case 'alert':
      return 'Watching the intruder';
    case 'warn':
      return 'Warning the intruder off';
    case 'hostile':
      return 'Driving off the intruder';
    case 'circle':
      return 'Circling for an opening';
    case 'windup':
      return 'Committing to a strike';
    case 'lunge':
      return 'Lunging';
    case 'charge':
      return 'Charging its emitter';
    case 'beam':
      return 'Firing';
    case 'strike':
      return 'Striking';
    case 'recover':
      return 'Recovering';
    case 'staggered':
      return 'Reeling';
    case 'retreat':
      return 'Breaking off, wounded';
    case 'disengage':
      return 'Returning to its ground';
    default:
      // Nothing to do with Emerson at all — which is rather the point.
      return purposeLabel(c);
  }
}

function threatReason(world: World, c: Creature): string[] {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  const d = Math.round(dist(c.pos, world.player.pos));
  if ((c.combat?.state ?? 'calm') === 'calm') {
    return [
      purposeLabel(c),
      def.synthetic ? 'It has been doing this a very long time' : 'Working its own range',
      `Emerson is ${d}m away and has not been noticed`,
    ];
  }
  return [
    def.synthetic ? 'Guarding the Sunken Ring' : 'Defending its territory',
    `Emerson is ${d}m away`,
    `Disposition: ${dispositionOf(c)}`,
  ];
}

/**
 * A roused predator or a firing guardian that this animal should be avoiding.
 *
 * Deliberately narrow: only genuinely active danger counts, and only within a
 * short radius, so ordinary wildlife is not permanently fleeing something it
 * cannot see on the far side of a hill. This is the whole of EDEN's
 * cross-creature reaction — not a food chain, just enough that an encounter
 * looks like it is happening inside an ecosystem rather than on a bare stage.
 */
function nearbyActiveDanger(world: World, c: Creature): Creature | null {
  if (c.combat) return null; // predators are not frightened of themselves
  for (const o of world.creatures) {
    if (!o.combat || o === c) continue;
    const s = o.combat.state;
    const roused =
      s === 'hostile' || s === 'circle' || s === 'windup' ||
      s === 'lunge' || s === 'charge' || s === 'beam' || s === 'strike';
    if (!roused) continue;
    // A machine firing a beam clears a wider area than an animal squaring up.
    const radius = CREATURE_SPECIES_BY_ID[o.speciesId].synthetic ? 16 : 12;
    if (dist(o.pos, c.pos) < radius) return o;
  }
  return null;
}

/** Per-tick biology for creatures. */
export function creatureNeedsTick(world: World, c: Creature, dt: number): void {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  const moving = c.speed > 0.2;
  c.hunger = clamp100(c.hunger + 0.1 * (0.5 + def.traits.metabolism) * dt);
  if (!c.resting) c.energy = clamp100(c.energy - (moving ? 0.11 : 0.04) * dt);
  else c.energy = clamp100(c.energy + WILDLIFE.restRecover * dt * 0.4);
  if (c.socialTimer > 0) c.socialTimer -= dt;
  // Juveniles mature after a while.
  if (c.ageStage === 'juvenile' && world.timeSec - c.goal.startedAt > 600 && c.energy > 60) {
    c.ageStage = 'adult';
  }
  // Grazing passively while idle keeps herbivores from starving loops.
  if (c.hunger > 90 && !moving) c.hunger -= 0.3 * dt;
}

/** Damage from the player's attack. */
export function damageCreature(world: World, c: Creature, amount: number): void {
  c.health = Math.max(0, c.health - amount);
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  remember(c, { type: 'threatened', subjectName: 'Emerson', t: world.timeSec, emotionalWeight: -0.8 });
  if (c.lumi) {
    c.lumi.trust = Math.max(0, c.lumi.trust - LUMI.attackTrustLoss);
    c.lumi.following = false;
    chronicle(world, 'lumi', 'Emerson struck Lumi. She fled — her trust is badly damaged.');
  }
  if (c.health <= 0) {
    world.creatures = world.creatures.filter((o) => o !== c);
    world.dirty.entities = true;
    chronicle(world, 'wildlife', `A ${def.name} was killed by Emerson.`);
    return;
  }
  if (def.traits.aggression > 0.6) {
    c.aggroUntil = world.timeSec + 12;
    chronicle(world, 'wildlife', `Emerson provoked a ${def.name}. It turned on him.`);
  } else {
    alarmCreature(world, c, world.player.pos);
  }
}
