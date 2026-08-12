import { THREAT } from './config';
import { chronicle } from './chronicle';
import { blocked, damagePlayer, insideSafeZone, setThreatState } from './combat';
import { stand, stepToward } from './movement';
import { CREATURE_SPECIES_BY_ID } from './species';
import type { Creature, ThreatState, World } from './types';
import { angleTo, dist, lerpAngle } from './vec';

/**
 * Dangerous creature behaviour.
 *
 * One state machine serves both encounter archetypes, because both must obey
 * the same three rules that make danger fair:
 *
 *   1. Nothing aggros from across the valley. `alert` requires proximity.
 *   2. Nothing attacks without a visible wind-up first. `warn` then `windup`
 *      both take real time, and both are readable from the creature's pose.
 *   3. Nothing chases forever. Distance, lost line of sight, and the leash on
 *      its own territory all end an engagement.
 *
 * Retreat is therefore always a real option, which is the point: EDEN is a
 * world with teeth, not a combat game.
 */

export interface ThreatPhase {
  /** 0..1 through the current timed state, for the renderer's telegraph. */
  progress: number;
  state: ThreatState;
}

/** Wind-up length: the synthetic charges longer, and hits harder. */
function windupDuration(c: Creature): number {
  return CREATURE_SPECIES_BY_ID[c.speciesId].synthetic ? 1.15 : 0.85;
}

function strikeDuration(c: Creature): number {
  return CREATURE_SPECIES_BY_ID[c.speciesId].synthetic ? 0.3 : 0.22;
}

function recoverDuration(c: Creature): number {
  return CREATURE_SPECIES_BY_ID[c.speciesId].synthetic ? 1.5 : 1.1;
}

/** How far through the current state, 0..1. */
export function threatPhase(world: World, c: Creature): ThreatPhase {
  const combat = c.combat;
  if (!combat) return { progress: 0, state: 'calm' };
  const elapsed = world.timeSec - combat.since;
  let span = 1;
  if (combat.state === 'warn') span = THREAT.warnDuration;
  else if (combat.state === 'windup') span = windupDuration(c);
  else if (combat.state === 'strike') span = strikeDuration(c);
  else if (combat.state === 'recover') span = recoverDuration(c);
  return { progress: Math.max(0, Math.min(1, elapsed / span)), state: combat.state };
}

/** Can this creature currently perceive Emerson? */
function perceives(world: World, c: Creature): boolean {
  const p = world.player;
  if (p.dead || p.extraction) return false;
  const d = dist(c.pos, p.pos);
  if (d > THREAT.noticeRange) return false;
  return !blocked(world, c.pos.x, c.pos.z, p.pos.x, p.pos.z);
}

/** Has this creature strayed too far from the ground it defends? */
function beyondLeash(c: Creature): boolean {
  if (!c.combat) return false;
  return dist(c.pos, c.combat.territory) > THREAT.leash;
}

/**
 * Decide what a dangerous creature does about Emerson.
 *
 * Runs before the ordinary creature think, and returns true when it has taken
 * control — so a Rakhor that is not currently interested in anybody falls
 * straight through to its normal foraging and roaming life.
 */
export function threatThink(world: World, c: Creature): boolean {
  const combat = c.combat;
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  if (!combat || !def.dangerous) return false;
  const t = world.timeSec;
  const p = world.player;
  const d = dist(c.pos, p.pos);
  const canSee = perceives(world, c);
  if (canSee) combat.lastSeenAt = t;

  // Human Landing is home. Nothing hunts Emerson inside it — enforced by
  // behaviour rather than an invisible wall, so a creature simply turns back.
  const playerAtHome = insideSafeZone(world, p.pos.x, p.pos.z);

  switch (combat.state) {
    case 'calm': {
      if (!canSee || playerAtHome) return false;
      // Synthetics rouse at their guarded perimeter; animals notice movement.
      const trigger = def.synthetic ? dist(c.pos, combat.territory) + 4 : THREAT.noticeRange;
      if (d > Math.min(THREAT.noticeRange, trigger)) return false;
      setThreatState(world, c, 'alert');
      combat.targetId = 'emerson';
      announceFirstContact(world, c);
      return true;
    }

    case 'alert': {
      // Watching. Closing to provoking range starts the warning; backing off
      // ends it without a fight.
      if (!canSee && t - combat.lastSeenAt > THREAT.loseTargetAfter) {
        setThreatState(world, c, 'disengage');
        return true;
      }
      if (playerAtHome || d > THREAT.noticeRange * 1.3) {
        setThreatState(world, c, 'disengage');
        return true;
      }
      if (d < THREAT.provokeRange) setThreatState(world, c, 'warn');
      return true;
    }

    case 'warn': {
      // Posturing. This is the window in which retreat works.
      if (d > THREAT.provokeRange * 1.6 || playerAtHome) {
        setThreatState(world, c, 'alert');
        return true;
      }
      if (t - combat.since >= THREAT.warnDuration) setThreatState(world, c, 'hostile');
      return true;
    }

    case 'hostile': {
      if (playerAtHome || beyondLeash(c) || (!canSee && t - combat.lastSeenAt > THREAT.loseTargetAfter)) {
        setThreatState(world, c, 'disengage');
        return true;
      }
      if (d <= def.dangerous.attackRange && t >= combat.nextAttackAt) {
        setThreatState(world, c, 'windup');
      }
      return true;
    }

    case 'windup': {
      if (t - combat.since >= windupDuration(c)) {
        setThreatState(world, c, 'strike');
        resolveEnemyStrike(world, c);
      }
      return true;
    }

    case 'strike': {
      if (t - combat.since >= strikeDuration(c)) setThreatState(world, c, 'recover');
      return true;
    }

    case 'recover': {
      if (t - combat.since >= recoverDuration(c)) {
        combat.nextAttackAt = t + def.dangerous.cooldown;
        setThreatState(world, c, 'hostile');
      }
      return true;
    }

    case 'disengage': {
      // Head home, and stop caring after a moment.
      if (t - combat.since > 4) {
        setThreatState(world, c, 'calm');
        combat.targetId = null;
        combat.hasStruck = false;
        c.aggroUntil = 0;
        return false;
      }
      return true;
    }
  }
  return false;
}

/**
 * Move and act on the current threat state.
 *
 * Called instead of the ordinary creature execute while engaged, so a hostile
 * animal is not simultaneously trying to graze.
 */
export function threatExecute(world: World, c: Creature, dt: number): boolean {
  const combat = c.combat;
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  if (!combat || !def.dangerous) return false;
  if (combat.state === 'calm') return false;

  const p = world.player;
  const opts = { speed: def.speed, aquatic: def.aquatic, avoidWater: !def.aquatic };

  switch (combat.state) {
    case 'alert':
      // Hold ground and watch. Turning to face is the first readable signal.
      stand(c);
      c.heading = lerpAngle(c.heading, angleTo(c.pos, p.pos), 1 - Math.exp(-5 * dt));
      break;

    case 'warn':
      // Posture: stand tall, face down, refuse to close. The renderer reads
      // this state to lower the head and pulse the markings.
      stand(c);
      c.heading = lerpAngle(c.heading, angleTo(c.pos, p.pos), 1 - Math.exp(-7 * dt));
      break;

    case 'hostile': {
      const d = dist(c.pos, p.pos);
      // Synthetics hold at range; animals close.
      const desired = def.synthetic ? def.dangerous.attackRange * 0.7 : def.dangerous.attackRange * 0.65;
      if (d > desired) stepToward(world, c, p.pos, dt, opts);
      else stand(c);
      c.heading = lerpAngle(c.heading, angleTo(c.pos, p.pos), 1 - Math.exp(-6 * dt));
      break;
    }

    case 'windup':
    case 'strike':
      // Committed. Standing still through the wind-up is what makes the tell
      // readable and what gives the dodge somewhere to go.
      stand(c);
      c.heading = lerpAngle(c.heading, angleTo(c.pos, p.pos), 1 - Math.exp(-4 * dt));
      break;

    case 'recover':
      stand(c);
      break;

    case 'disengage': {
      // Walk back to the ground it defends.
      const home = combat.territory;
      if (dist(c.pos, home) > 3) stepToward(world, c, home, dt, { ...opts, speed: def.speed * 0.8 });
      else stand(c);
      break;
    }
  }
  return true;
}

/**
 * Land the blow. Called once, at the transition into `strike` — never per
 * tick, so an enemy cannot chip the player down every frame.
 */
function resolveEnemyStrike(world: World, c: Creature): void {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  if (!def.dangerous || !c.combat) return;
  const p = world.player;
  const d = dist(c.pos, p.pos);
  // Missed: the player moved, dodged out, or put a rock between them.
  if (d > def.dangerous.attackRange * 1.25) return;
  if (blocked(world, c.pos.x, c.pos.z, p.pos.x, p.pos.z)) return;

  const landed = damagePlayer(world, def.dangerous.damage, def.name);
  if (landed && !c.combat.hasStruck) {
    c.combat.hasStruck = true;
    chronicle(world, 'wildlife', `A ${def.name} attacked Emerson near ${world.landmarkNameAt?.(c.pos) ?? 'the valley'}.`, {
      actorIds: ['emerson'],
      actorNames: ['Emerson'],
      pos: { ...c.pos },
      cause: [def.synthetic ? 'He entered its guarded perimeter' : 'He stayed inside its territory after the warning'],
      effects: ['Emerson took damage'],
    });
  }
}

/** ARI's one-time read on each kind of danger. */
function announceFirstContact(world: World, c: Creature): void {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  const key = `met_${def.id}`;
  if (world.flags[key]) return;
  world.flags[key] = true;
  if (def.synthetic) {
    world.ariQueue.push(
      'That mechanism predates every colony signal in the valley. It is powering up, Emerson, and I have no idea what it is for.',
    );
    chronicle(world, 'wildlife', 'Emerson encountered an unknown synthetic organism at the Sunken Ring.', {
      actorIds: ['emerson'],
      actorNames: ['Emerson'],
      pos: { ...c.pos },
      cause: ['He approached the ancient pylons'],
      effects: ['Something there is still running', 'Its purpose is unknown'],
    });
  } else {
    world.ariQueue.push(`Behavioral shift detected. The ${def.name} considers us a threat — give it room, or be ready.`);
  }
}

/** Give a creature the combat record its species entitles it to. */
export function armThreat(c: Creature): void {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  if (!def.dangerous || c.combat) return;
  c.health = def.dangerous.health;
  c.combat = {
    state: 'calm',
    since: 0,
    targetId: null,
    lastSeenAt: -9999,
    nextAttackAt: 0,
    territory: { x: c.pos.x, z: c.pos.z },
    hasStruck: false,
  };
}

/** Readable label for the HUD and the scanner. */
export function dispositionOf(c: Creature): 'Passive' | 'Defensive' | 'Hostile' | 'Dormant' {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  if (!c.combat) return 'Passive';
  switch (c.combat.state) {
    case 'hostile':
    case 'windup':
    case 'strike':
    case 'recover':
      return 'Hostile';
    case 'warn':
    case 'alert':
      return 'Defensive';
    default:
      return def.synthetic ? 'Dormant' : 'Defensive';
  }
}
