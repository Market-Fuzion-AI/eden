import { COMBAT, THREAT } from './config';
import { chronicle } from './chronicle';
import {
  blocked,
  damagePlayer,
  insideSafeZone,
  isStaggered,
  setThreatState,
  staggerDecayTick,
} from './combat';
import { stand, stepToward } from './movement';
import { CREATURE_SPECIES_BY_ID } from './species';
import { groundY } from './terrain';
import type { Creature, ThreatPurpose, ThreatState, World } from './types';
import { angleTo, dist, lerpAngle, v2, type V2 } from './vec';

/**
 * Dangerous creature behaviour.
 *
 * One state machine serves both encounter archetypes, because both must obey
 * the same three rules that make danger fair:
 *
 *   1. Nothing aggros from across the valley. `alert` requires proximity.
 *   2. Nothing attacks without a visible wind-up first. `warn` then a charge
 *      or a wind-up both take real time, and both are readable from the
 *      creature's pose.
 *   3. Nothing chases forever. Distance, lost line of sight, and the leash on
 *      its own territory all end an engagement.
 *
 * Retreat is therefore always a real option, which is the point: EDEN is a
 * world with teeth, not a combat game.
 *
 * What the two archetypes do *not* share is how they fight. The Rakhor circles
 * and lunges; the Warden holds its ground and shoots. In v0.8 they shared one
 * approach-and-hit routine, and the machine guardian ended up as a melee animal
 * with a longer arm.
 */

export interface ThreatPhase {
  /** 0..1 through the current timed state, for the renderer's telegraph. */
  progress: number;
  state: ThreatState;
}

let beamCounter = 0;

// ---------------------------------------------------------------------------
// Timings
// ---------------------------------------------------------------------------

/** Wind-up length for whatever attack this creature is currently committing to. */
function windupDuration(c: Creature): number {
  return CREATURE_SPECIES_BY_ID[c.speciesId].synthetic ? THREAT.warden.beamCharge : 0.85;
}

function strikeDuration(c: Creature): number {
  return CREATURE_SPECIES_BY_ID[c.speciesId].synthetic ? THREAT.warden.beamDuration : 0.22;
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
  switch (combat.state) {
    case 'warn':
      span = THREAT.warnDuration;
      break;
    case 'circle':
      span = THREAT.rakhor.circleDuration;
      break;
    case 'windup':
      span = windupDuration(c);
      break;
    case 'charge':
      span = THREAT.warden.beamCharge;
      break;
    case 'lunge':
      span = THREAT.rakhor.lungeDuration;
      break;
    case 'beam':
      span = THREAT.warden.beamDuration;
      break;
    case 'strike':
      span = strikeDuration(c);
      break;
    case 'recover':
      span = recoverDuration(c);
      break;
    case 'staggered':
      span = COMBAT.staggerDuration;
      break;
    default:
      span = 1;
  }
  return { progress: Math.max(0, Math.min(1, elapsed / span)), state: combat.state };
}

/** Can this creature currently perceive Kai? */
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

function healthFrac(c: Creature): number {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  return c.health / Math.max(1, def.dangerous?.health ?? 100);
}

// ---------------------------------------------------------------------------
// Think
// ---------------------------------------------------------------------------

/**
 * Decide what a dangerous creature does about Kai.
 *
 * Runs before the ordinary creature think, and returns true when it has taken
 * control. A dangerous creature always keeps control now — even when nothing
 * is happening it is running its own errand rather than falling through to the
 * generic forage routine, which is how the ancient machine guardian ended up
 * grazing on glowplants for a living.
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

  // Human Landing is home. Nothing hunts Kai inside it — enforced by
  // behaviour rather than an invisible wall, so a creature simply turns back.
  const playerAtHome = insideSafeZone(world, p.pos.x, p.pos.z);

  switch (combat.state) {
    case 'calm': {
      // Living its own life. `chooseErrand` is what it is doing instead of
      // waiting for the player to show up.
      chooseErrand(world, c);
      if (!canSee || playerAtHome) return true;
      // Synthetics rouse at their guarded perimeter; animals notice movement.
      const trigger = def.synthetic ? THREAT.warden.patrolRadius + 8 : THREAT.noticeRange;
      if (d > Math.min(THREAT.noticeRange, trigger)) return true;
      setThreatState(world, c, 'alert');
      combat.targetId = 'emerson';
      combat.purposeTarget = null;
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
      const provoke = def.synthetic ? THREAT.warden.provokeRange : THREAT.provokeRange;
      if (d < provoke) {
        setThreatState(world, c, 'warn');
        // Pick a circling direction now, so the whole approach reads as one
        // decision rather than a creature changing its mind every second.
        combat.circleDir = world.rng.chance(0.5) ? 1 : -1;
      }
      return true;
    }

    case 'warn': {
      // Posturing. This is the window in which retreat works.
      const backedOff = (def.synthetic ? THREAT.warden.provokeRange : THREAT.provokeRange) * 1.6;
      if (d > backedOff || playerAtHome) {
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
      // Badly wounded animals do not fight to the death. A predator that has
      // clearly lost breaks off, which is what makes the valley an ecosystem
      // rather than an arena.
      if (!def.synthetic && healthFrac(c) < THREAT.rakhor.fleeHealthFrac) {
        setThreatState(world, c, 'retreat');
        announceRetreat(world, c);
        return true;
      }
      if (t < combat.nextAttackAt) return true;

      if (def.synthetic) {
        // The Warden's two attacks, and the rule that picks between them: the
        // burst exists solely to answer a player standing on top of it.
        if (d < THREAT.warden.burstRange && t >= combat.nextBurstAt) {
          setThreatState(world, c, 'windup');
        } else if (d <= THREAT.warden.beamRange && !blocked(world, c.pos.x, c.pos.z, p.pos.x, p.pos.z)) {
          setThreatState(world, c, 'charge');
          // The shot is aimed NOW, at the start of the charge — not when it
          // goes off. That is the entire reason the charge is a telegraph:
          // aiming at the end would make the beam unmissable and the tell a
          // decoration. Moving out of this line during the charge is the dodge.
          const a = angleTo(c.pos, p.pos);
          c.combat!.aim = { x: Math.sin(a), z: Math.cos(a) };
        }
        return true;
      }

      // The Rakhor sizes Kai up before it commits. Circling first is what
      // separates a predator from something that runs straight at you forever.
      if (d <= def.dangerous.attackRange * 2.6) {
        setThreatState(world, c, 'circle');
      }
      return true;
    }

    case 'circle': {
      if (playerAtHome || beyondLeash(c)) {
        setThreatState(world, c, 'disengage');
        return true;
      }
      if (d > THREAT.provokeRange * 1.8) {
        setThreatState(world, c, 'hostile');
        return true;
      }
      if (t - combat.since >= THREAT.rakhor.circleDuration) {
        setThreatState(world, c, 'windup');
      }
      return true;
    }

    case 'windup': {
      // The charge is committed to a direction the moment the wind-up starts.
      //
      // Without this the animal kept re-aiming right up to the instant it
      // sprang, so a perfectly-timed dodge simply moved the target: the tell
      // was an animation played before a hit that was going to land wherever
      // you went. Committing early is what turns the wind-up into information.
      if (!combat.aim) {
        const a0 = angleTo(c.pos, p.pos);
        combat.aim = { x: Math.sin(a0), z: Math.cos(a0) };
      }
      if (t - combat.since >= windupDuration(c)) {
        if (def.synthetic) {
          // Close-range burst: instantaneous, short, and it pushes Kai off.
          setThreatState(world, c, 'strike');
          resolvePulseBurst(world, c);
          combat.nextBurstAt = t + THREAT.warden.burstCooldown;
        } else {
          setThreatState(world, c, 'lunge');
        }
      }
      return true;
    }

    case 'lunge': {
      // The dash itself. Damage resolves in `threatExecute`, on contact, so
      // sidestepping the charge actually works.
      if (t - combat.since >= THREAT.rakhor.lungeDuration) {
        combat.aim = null;
        setThreatState(world, c, 'recover');
      }
      return true;
    }

    case 'charge': {
      // Belt and braces: whichever path put it into the charge, the shot is
      // committed on the first tick of it. A beam that aims when it fires is
      // not dodgeable, and the charge animation would be a lie.
      if (!combat.aim) {
        const a0 = angleTo(c.pos, p.pos);
        combat.aim = { x: Math.sin(a0), z: Math.cos(a0) };
      }
      if (t - combat.since >= THREAT.warden.beamCharge) {
        setThreatState(world, c, 'beam');
        fireBeam(world, c);
      }
      return true;
    }

    case 'beam': {
      if (t - combat.since >= THREAT.warden.beamDuration) {
        combat.aim = null;
        setThreatState(world, c, 'recover');
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

    case 'staggered': {
      if (t - combat.since >= COMBAT.staggerDuration) setThreatState(world, c, 'hostile');
      return true;
    }

    case 'retreat': {
      // Wounded and leaving. It goes home and stays out of the fight.
      if (t - combat.since > 9 || dist(c.pos, combat.territory) < 4) {
        setThreatState(world, c, 'calm');
        combat.targetId = null;
        combat.hasStruck = false;
        c.aggroUntil = 0;
        // It remembers being beaten: no re-engaging Kai for a while.
        combat.nextAttackAt = t + 60;
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
        return true;
      }
      return true;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Purpose — what a dangerous creature does when Kai is not around
// ---------------------------------------------------------------------------

/**
 * Give an idle predator or guardian something of its own to do.
 *
 * This is the smallest thing that makes a creature read as an inhabitant
 * rather than an encounter: before it ever notices Kai, he can watch it
 * doing something that has nothing to do with him. The Rakhor stalks whatever
 * small fauna is in its range; the Warden walks its own pylons.
 */
function chooseErrand(world: World, c: Creature): void {
  const m = c.combat!;
  const t = world.timeSec;
  if (m.purposeTarget && t < m.purposeUntil) return;

  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  if (def.synthetic) {
    // Walk the perimeter. Deterministic, and it visibly circles the ring.
    const a = (t / 40) * Math.PI * 2 + c.visualVariant * Math.PI * 2;
    m.purpose = 'patrol';
    m.purposeTarget = v2(
      m.territory.x + Math.sin(a) * THREAT.warden.patrolRadius,
      m.territory.z + Math.cos(a) * THREAT.warden.patrolRadius,
    );
    m.purposeUntil = t + 12;
    m.stalkingId = null;
    return;
  }

  // A predator follows the nearest small animal it can see, at a distance,
  // without ever catching it — EDEN is not modelling predation, only showing
  // that the Rakhor has interests of its own.
  const prey = nearestPrey(world, c);
  if (prey) {
    m.purpose = 'stalk';
    m.stalkingId = prey.id;
    m.purposeTarget = { ...prey.pos };
    m.purposeUntil = t + world.rng.range(6, 12);
    return;
  }
  m.purpose = 'patrol';
  m.stalkingId = null;
  const a = world.rng.next() * Math.PI * 2;
  const r = world.rng.range(6, 18);
  m.purposeTarget = v2(m.territory.x + Math.sin(a) * r, m.territory.z + Math.cos(a) * r);
  m.purposeUntil = t + world.rng.range(10, 20);
}

/** The nearest harmless animal worth following. */
function nearestPrey(world: World, c: Creature): Creature | null {
  let best: Creature | null = null;
  let bestD = 34;
  for (const o of world.creatures) {
    if (o === c || o.combat) continue;
    const def = CREATURE_SPECIES_BY_ID[o.speciesId];
    // Nothing aquatic, and never Lumi: watching a predator stalk the one
    // creature the player has befriended would be a different game.
    if (def.aquatic || o.lumi) continue;
    const d = dist(o.pos, c.pos);
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

/** Human-readable label for the Creator panel and the goal line. */
export function purposeLabel(c: Creature): string {
  const m = c.combat;
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  if (!m) return 'Idle';
  switch (m.purpose) {
    case 'stalk':
      return m.stalkingId ? 'Stalking something smaller' : 'Working its territory';
    case 'patrol':
      return def.synthetic ? 'Walking the pylons' : 'Patrolling its range';
    case 'drink':
      return 'Drinking';
    default:
      return 'Surveying';
  }
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/**
 * Move and act on the current threat state.
 *
 * Called instead of the ordinary creature execute while a dangerous creature
 * is under threat control — which is always, now that idle behaviour is its
 * own errand rather than generic foraging.
 */
export function threatExecute(world: World, c: Creature, dt: number): boolean {
  const combat = c.combat;
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  if (!combat || !def.dangerous) return false;

  staggerDecayTick(world, c, dt);

  const p = world.player;
  const opts = { speed: def.speed, aquatic: def.aquatic, avoidWater: !def.aquatic };
  const face = (rate: number) => {
    c.heading = lerpAngle(c.heading, angleTo(c.pos, p.pos), 1 - Math.exp(-rate * dt));
  };

  switch (combat.state) {
    case 'calm': {
      // Its own errand. Slower than a chase — this is a creature going about
      // its day, not travelling with purpose.
      const to = combat.purposeTarget;
      if (!to) {
        stand(c);
        break;
      }
      if (combat.purpose === 'stalk' && combat.stalkingId) {
        const prey = world.creatures.find((o) => o.id === combat.stalkingId);
        if (prey) {
          combat.purposeTarget = { ...prey.pos };
          // Hold a stalking distance rather than closing: the point is the
          // watching, and an actual kill would need a whole hunting system.
          const d = dist(c.pos, prey.pos);
          if (d > 7) stepToward(world, c, prey.pos, dt, { ...opts, speed: def.speed * 0.45 });
          else stand(c);
          c.heading = lerpAngle(c.heading, angleTo(c.pos, prey.pos), 1 - Math.exp(-3 * dt));
          break;
        }
        combat.stalkingId = null;
      }
      if (dist(c.pos, to) > 2) stepToward(world, c, to, dt, { ...opts, speed: def.speed * 0.4 });
      else stand(c);
      break;
    }

    case 'alert':
      // Hold ground and watch. Turning to face is the first readable signal.
      stand(c);
      face(5);
      break;

    case 'warn':
      // Posture: stand tall, face down, refuse to close. The renderer reads
      // this state to lower the head, brighten the markings and paint a ring
      // on the ground under it.
      stand(c);
      face(7);
      break;

    case 'hostile': {
      const d = dist(c.pos, p.pos);
      if (def.synthetic) {
        // Hold the standoff. Too close and it backs away rather than brawling.
        const want = THREAT.warden.standoff;
        if (d > want + 2) stepToward(world, c, p.pos, dt, opts);
        else if (d < want - 2.5) backAwayFrom(world, c, p.pos, dt, opts);
        else stand(c);
      } else if (d > def.dangerous.attackRange * 2.2) {
        stepToward(world, c, p.pos, dt, opts);
      } else {
        stand(c);
      }
      face(6);
      break;
    }

    case 'circle': {
      // Strafe around Kai at a readable distance. This is the state that
      // makes a Rakhor fight look like an animal deciding rather than a script.
      const want = THREAT.rakhor.circleRadius;
      const toPlayer = angleTo(c.pos, p.pos);
      const d = dist(c.pos, p.pos);
      // Tangent, biased inward or outward to hold the ring.
      const bias = (d - want) * 0.12;
      const a = toPlayer + combat.circleDir * (Math.PI / 2 - Math.max(-0.7, Math.min(0.7, bias)));
      const step = v2(c.pos.x + Math.sin(a) * 4, c.pos.z + Math.cos(a) * 4);
      stepToward(world, c, step, dt, { ...opts, speed: def.speed * THREAT.rakhor.circleSpeed });
      face(7);
      break;
    }

    case 'windup':
    case 'charge': {
      // Committed. Standing still through the charge is what makes the tell
      // readable — and facing the *committed* direction rather than the live
      // player is what gives the dodge somewhere to go.
      stand(c);
      const aim = combat.aim;
      if (aim) {
        c.heading = lerpAngle(c.heading, Math.atan2(aim.x, aim.z), 1 - Math.exp(-6 * dt));
      } else {
        face(def.synthetic ? 3 : 4);
      }
      break;
    }

    case 'lunge': {
      // A real dash along the direction it committed to at the start of the
      // wind-up, not a homing missile. Damage resolves on contact, so stepping
      // out of the line is what makes a well-timed dodge work.
      const before = dist(c.pos, p.pos);
      const aim = combat.aim ?? { x: Math.sin(c.heading), z: Math.cos(c.heading) };
      const ahead = v2(c.pos.x + aim.x * 6, c.pos.z + aim.z * 6);
      stepToward(world, c, ahead, dt, { ...opts, speed: THREAT.rakhor.lungeSpeed });
      const after = dist(c.pos, p.pos);
      if (!combat.hasStruck || after < before) resolveLungeContact(world, c);
      break;
    }

    case 'beam':
    case 'strike':
      stand(c);
      break;

    case 'recover':
      stand(c);
      break;

    case 'staggered':
      // Rocked. It cannot act, and the renderer wobbles it.
      stand(c);
      break;

    case 'retreat': {
      // Wounded: get away from Kai, then go home.
      const away = v2(
        c.pos.x + (c.pos.x - p.pos.x) * 0.4,
        c.pos.z + (c.pos.z - p.pos.z) * 0.4,
      );
      const to = dist(c.pos, p.pos) < 22 ? away : combat.territory;
      stepToward(world, c, to, dt, { ...opts, speed: def.speed * 1.05 });
      break;
    }

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

// ---------------------------------------------------------------------------
// Attacks
// ---------------------------------------------------------------------------

/** Step directly away from a point, respecting terrain and obstacles. */
function backAwayFrom(
  world: World,
  c: Creature,
  from: V2,
  dt: number,
  opts: { speed: number; aquatic?: boolean; avoidWater?: boolean },
): void {
  const a = angleTo(from, c.pos);
  const to = v2(c.pos.x + Math.sin(a) * 5, c.pos.z + Math.cos(a) * 5);
  stepToward(world, c, to, dt, { ...opts, speed: opts.speed * 0.7 });
}

/**
 * The Rakhor's lunge connects on contact rather than on a timer.
 *
 * v0.8 resolved the hit at the transition into the strike, which meant the
 * damage was decided before the animal had moved — dodging *through* a charge
 * was impossible to read because the outcome was already fixed.
 */
function resolveLungeContact(world: World, c: Creature): void {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  const m = c.combat;
  if (!def.dangerous || !m || m.hasStruck) return;
  const p = world.player;
  const d = dist(c.pos, p.pos);
  if (d > def.dangerous.attackRange) return;
  if (blocked(world, c.pos.x, c.pos.z, p.pos.x, p.pos.z)) return;

  const dir = { x: (p.pos.x - c.pos.x) / Math.max(0.01, d), z: (p.pos.z - c.pos.z) / Math.max(0.01, d) };
  const landed = damagePlayer(world, def.dangerous.damage, def.name, dir);
  // `hasStruck` doubles as the one-hit-per-lunge guard: a dash that grazes the
  // player must not tick damage every frame it stays in contact.
  m.hasStruck = true;
  if (landed) recordFirstAttack(world, c);
}

/** The Warden's close-range shove. Instant, short-ranged, and it pushes back. */
function resolvePulseBurst(world: World, c: Creature): void {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  if (!def.dangerous || !c.combat) return;
  const p = world.player;
  const d = dist(c.pos, p.pos);
  if (d > THREAT.warden.burstRange * 1.15) return;
  if (blocked(world, c.pos.x, c.pos.z, p.pos.x, p.pos.z)) return;
  const dir = { x: (p.pos.x - c.pos.x) / Math.max(0.01, d), z: (p.pos.z - c.pos.z) / Math.max(0.01, d) };
  if (damagePlayer(world, THREAT.warden.burstDamage, def.name, dir)) {
    // Actually displaces him: the burst's job is to make crowding the Warden
    // a losing strategy, and damage alone would not do that.
    p.pos.x += dir.x * 2.6;
    p.pos.z += dir.z * 2.6;
    recordFirstAttack(world, c);
  }
  world.flags.wardenBurstAt = world.timeSec;
}

/**
 * Fire the beam.
 *
 * The direction is fixed at the moment of firing and the beam does not track,
 * which is the entire reason it can be dodged: the charge tells you where it
 * is going to be, and moving out of that line is the answer.
 */
function fireBeam(world: World, c: Creature): void {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  if (!def.dangerous) return;
  const p = world.player;
  // Fixed when the charge began. See the comment where `aim` is set.
  const aim = c.combat?.aim;
  const dir = aim ?? { x: Math.sin(angleTo(c.pos, p.pos)), z: Math.cos(angleTo(c.pos, p.pos)) };
  const cfg = THREAT.warden;

  world.beams.push({
    id: `beam_${beamCounter++}`,
    sourceId: c.id,
    from: { ...c.pos },
    dir,
    length: cfg.beamRange,
    firedAt: world.timeSec,
    endsAt: world.timeSec + cfg.beamDuration,
    y: groundY(c.pos.x, c.pos.z) + (def.hoverHeight ?? 2),
  });
  if (world.beams.length > 6) world.beams.shift();

  // Hit test against the line, once. Standing anywhere but in it is a miss.
  const rel = { x: p.pos.x - c.pos.x, z: p.pos.z - c.pos.z };
  const along = rel.x * dir.x + rel.z * dir.z;
  if (along < 0 || along > cfg.beamRange) return;
  const perp = Math.abs(rel.x * dir.z - rel.z * dir.x);
  if (perp > cfg.beamHalfWidth) return;
  if (blocked(world, c.pos.x, c.pos.z, p.pos.x, p.pos.z)) return;
  if (damagePlayer(world, cfg.beamDamage, def.name, dir)) recordFirstAttack(world, c);
}

/** Expire beams that have finished firing. */
export function beamTick(world: World): void {
  if (world.beams.length === 0) return;
  world.beams = world.beams.filter((b) => world.timeSec < b.endsAt + 0.25);
}

/** One Chronicle line the first time a given creature draws blood. */
function recordFirstAttack(world: World, c: Creature): void {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  const m = c.combat;
  if (!m || world.flags[`attacked_${def.id}`]) return;
  world.flags[`attacked_${def.id}`] = true;
  chronicle(world, 'wildlife', `A ${def.name} attacked Kai near ${world.landmarkNameAt?.(c.pos) ?? 'the valley'}.`, {
    actorIds: ['emerson'],
    actorNames: ['Kai'],
    pos: { ...c.pos },
    cause: [def.synthetic ? 'He entered its guarded perimeter' : 'He stayed inside its territory after the warning'],
    effects: ['Kai took damage'],
  });
}

/** ARI's one-time read on each kind of danger. */
function announceFirstContact(world: World, c: Creature): void {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  const key = `met_${def.id}`;
  if (world.flags[key]) return;
  world.flags[key] = true;
  if (def.synthetic) {
    world.ariQueue.push(
      'That mechanism predates every colony signal in the valley. It is powering up, Kai, and I have no idea what it is for.',
    );
    chronicle(world, 'wildlife', 'Kai encountered an unknown synthetic organism at the Sunken Ring.', {
      actorIds: ['emerson'],
      actorNames: ['Kai'],
      pos: { ...c.pos },
      cause: ['He approached the ancient pylons'],
      effects: ['Something there is still running', 'Its purpose is unknown'],
    });
  } else {
    world.ariQueue.push(`Behavioral shift detected. The ${def.name} considers us a threat — give it room, or be ready.`);
  }
}

/** ARI notes a predator breaking off, once. */
function announceRetreat(world: World, c: Creature): void {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  if (world.flags.sawRetreat) return;
  world.flags.sawRetreat = true;
  world.ariQueue.push(
    `The ${def.name} is disengaging. It has decided you are not worth the injury — you do not have to finish this.`,
  );
  chronicle(world, 'wildlife', `A wounded ${def.name} broke off its attack near ${world.landmarkNameAt?.(c.pos) ?? 'the valley'}.`, {
    actorIds: ['emerson'],
    actorNames: ['Kai'],
    pos: { ...c.pos },
    cause: ['It was losing'],
    effects: ['It withdrew to its own ground', 'Not every encounter ends in a death'],
  });
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
    aim: null,
    staggerLoad: 0,
    staggerImmuneUntil: -9999,
    circleDir: 1,
    nextBurstAt: 0,
    purpose: def.dangerous.purpose,
    purposeTarget: null,
    purposeUntil: 0,
    stalkingId: null,
  };
}

/** Readable label for the HUD and the scanner. */
export function dispositionOf(c: Creature): 'Passive' | 'Defensive' | 'Hostile' | 'Dormant' {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  if (!c.combat) return 'Passive';
  switch (c.combat.state) {
    case 'hostile':
    case 'circle':
    case 'windup':
    case 'lunge':
    case 'charge':
    case 'beam':
    case 'strike':
    case 'recover':
    case 'staggered':
      return 'Hostile';
    case 'warn':
    case 'alert':
      return 'Defensive';
    case 'retreat':
      return 'Passive';
    default:
      return def.synthetic ? 'Dormant' : 'Defensive';
  }
}

export { isStaggered };
export type { ThreatPurpose };
