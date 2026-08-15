import { MISSION, WORLD } from './config';
import { missionUnlocked } from './firstLight';
import { chronicle } from './chronicle';
import { isWalkable, isWater, groundY, slopeAt } from './terrain';
import type { MissionState, World } from './types';
import { dist, v2, type V2 } from './vec';

/**
 * THE SIGNAL — EDEN 3000's first authored mission.
 *
 * Everything before this was a simulation you could walk around in. This is the
 * first thing in the game that was *written*: a beginning, a reason to leave, a
 * journey with an obstacle in it, someone at the end of it, and a colony that is
 * measurably better for having found her.
 *
 * Three rules shaped how it is built.
 *
 * It is a state machine, not a quest framework. One mission does not justify a
 * generic objective system, and building one now would mean inventing an
 * abstraction from a single example — the reliable way to get the abstraction
 * wrong. Seven states, one forward transition each, no branching.
 *
 * It lives in the simulation. `world.mission` is the truth; React reads it and
 * never writes it, exactly like every other system here. That is what lets the
 * headless suite play the entire mission with no browser in sight.
 *
 * And it never marks its own progress from the outside. Every transition is
 * caused by something the player did somewhere the player was — walked into
 * range, spoke to her, came home. There is no "complete quest" call.
 */

/** Where the crash site is, once chosen. Derived from terrain, not hardcoded. */
export interface MissionSite {
  pod: V2;
  /** The direction the pod ploughed in from, for scattering debris. */
  heading: number;
}

/**
 * Choose where the pod came down.
 *
 * Scored rather than placed, for the same reason the 3Cs course is: the terrain
 * is generated from the seed, and a fixed coordinate is a bet that one patch of
 * ground is dry and walkable in every world. The site wants to be far enough
 * from Human Landing that reaching it is a journey, close enough that it is not
 * an expedition, in the Riverlands, on dry walkable ground, and — this is the
 * part that matters — reachable on foot without the jetpack.
 */
export function chooseCrashSite(world: World): MissionSite {
  const camp = world.camps.find((c) => c.speciesId === 'human');
  const home = camp ? camp.pos : v2(95, 25);

  let best: MissionSite | null = null;
  let bestScore = -Infinity;
  // Everything must sit this far inside the mountain rim. Without it the
  // scoring below — which used to reward raw distance from a camp that is
  // already well off-centre — reliably chose the outermost ring on the far
  // side of the valley, putting the wreck against the impassable ice wall.
  const safeRadius = WORLD.rimStart - MISSION.edgeClearance;
  // A deterministic sweep of bearings and distances. No RNG is drawn, so the
  // mission is in the same place every time a given seed is played — which is
  // what makes a bug in it reproducible.
  for (let ring = MISSION.minRange; ring <= MISSION.maxRange; ring += 6) {
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const p = v2(home.x + Math.sin(a) * ring, home.z + Math.cos(a) * ring);
      if (isWater(p.x, p.z) || !isWalkable(p.x, p.z)) continue;
      if (slopeAt(p.x, p.z) > 0.3) continue;
      // Open valley behind the site, not a mountain.
      if (Math.hypot(p.x, p.z) > safeRadius) continue;
      // Clear ground around it, so the site reads as a site rather than as
      // wreckage jammed into a hillside.
      let clear = true;
      for (let j = 0; j < 8 && clear; j++) {
        const b = (j / 8) * Math.PI * 2;
        const q = v2(p.x + Math.sin(b) * 7, p.z + Math.cos(b) * 7);
        if (isWater(q.x, q.z) || !isWalkable(q.x, q.z)) clear = false;
      }
      if (!clear) continue;
      // Walkable the whole way from home: this mission must be completable in
      // Player Mode with nothing but Gate 1 movement.
      if (!walkableRoute(home, p)) continue;

      // The walk must also stay inside the valley the whole way, or the compass
      // points along a line that clips the rim even when both ends are fine.
      let routeInside = true;
      const legs = Math.ceil(dist(home, p) / 6);
      for (let k = 1; k < legs && routeInside; k++) {
        const t = k / legs;
        const rx = home.x + (p.x - home.x) * t;
        const rz = home.z + (p.z - home.z) * t;
        if (Math.hypot(rx, rz) > safeRadius) routeInside = false;
      }
      if (!routeInside) continue;

      // The greybox test course is not part of the first authored experience.
      const courseDist = world.course.length
        ? Math.min(...world.course.map((c) => dist(c.pos, p)))
        : 999;
      if (courseDist < MISSION.courseClearance) continue;

      // Prefer sites that are a real walk with room to spare behind them.
      // Distance is capped rather than maximised: past a good walk, further away
      // buys nothing and costs clearance.
      const d = dist(home, p);
      const edgeRoom = safeRadius - Math.hypot(p.x, p.z);
      const score =
        Math.min(d, MISSION.preferredRange) * 0.5 +
        Math.min(courseDist, 70) * 0.25 +
        Math.min(edgeRoom, 45) * 0.7;
      if (score > bestScore) {
        bestScore = score;
        best = { pod: p, heading: a + Math.PI };
      }
    }
  }

  // Nothing scored: take the least-bad dry spot rather than refusing to have a
  // mission. A first mission that sometimes does not exist is worse than one
  // that is sometimes awkwardly placed.
  if (!best) {
    const fallback = v2(home.x - MISSION.minRange, home.z);
    return { pod: fallback, heading: Math.PI };
  }
  return best;
}

/**
 * Is there a walkable line from a to b?
 *
 * A straight-line probe, not a pathfinder. It is checking that the destination
 * is not across the river or up a cliff — that a player with WASD and a jump
 * can get there. Sampling the direct line is a conservative test: if the direct
 * line is clear then some route certainly is, and if it is not, the site is
 * rejected rather than risking a mission the player cannot reach.
 */
export function walkableRoute(a: V2, b: V2): boolean {
  const steps = Math.max(8, Math.ceil(dist(a, b) / 4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (isWater(x, z)) return false;
    // A single steep sample is a step, not a wall; several in a row is a cliff.
    if (!isWalkable(x, z)) return false;
  }
  return true;
}

/**
 * Say something as ARI, ahead of the queue.
 *
 * Mission lines are not ambient chatter. The ordinary `say` in `ari.ts` drops
 * anything that arrives while the queue is busy, which is correct for "the
 * flora is bioluminescent" and catastrophic for "that is one of ours" — the
 * most important line in the game would be silently discarded because the
 * valley happened to be talking about moss. These jump the queue instead, in
 * the order they were written.
 */
function ariSays(world: World, lines: string[]): void {
  world.ariQueue.splice(0, 0, ...lines);
  if (world.ariQueue.length > 8) world.ariQueue.length = 8;
}

/** Set the mission up at worldgen. Dormant: nothing has happened yet. */
export function initMission(world: World): void {
  const site = chooseCrashSite(world);
  const camp = world.camps.find((c) => c.speciesId === 'human');
  world.mission = {
    state: 'dormant',
    podPos: { ...site.pod },
    podHeading: site.heading,
    // Maya waits a few metres from the pod, at the end of the scuffed trail
    // leading away from it — she got out, and then she stopped.
    // Far enough from the pod that finding the wreck and finding *her* are two
    // separate moments. At six metres the second beat fired on the same tick as
    // the first and the discovery collapsed into one event.
    survivorPos: v2(
      site.pod.x + Math.sin(site.heading + 0.9) * 12,
      site.pod.z + Math.cos(site.heading + 0.9) * 12,
    ),
    homePos: camp ? { ...camp.pos } : v2(95, 25),
    startedAt: -1,
    detectedAt: -1,
    reachedAt: -1,
    rescuedAt: -1,
    completedAt: -1,
    signalStrength: 0,
    detectDist: -1,
    talkedTo: false,
    choiceMade: null,
    agricultureUnlocked: false,
  };
}

// ---------------------------------------------------------------------------
// Signal
// ---------------------------------------------------------------------------

/**
 * 0..1 — how strong the distress carrier is where Kai is standing.
 *
 * This is the whole navigation system. There is no minimap and no waypoint
 * pinned through the terrain; there is a number that goes up as you get warmer,
 * shown as a bar and described in words. Finding somewhere by watching a signal
 * strengthen is navigation. Following an arrow is not.
 */
export function signalStrengthAt(world: World, x: number, z: number): number {
  const m = world.mission;
  if (!m) return 0;
  const d = dist(m.podPos, { x, z });
  if (d >= MISSION.signalRange) return 0;
  // Squared falloff, so the last stretch changes fastest — the player gets the
  // clearest feedback exactly when they are close enough for it to be useful.
  const t = 1 - d / MISSION.signalRange;
  return t * t;
}

/** Bearing from Kai to the signal, for the compass mark. */
export function signalBearing(world: World): number | null {
  const m = world.mission;
  if (!m || !missionTracking(world)) return null;
  const p = world.player;
  return Math.atan2(m.podPos.x - p.pos.x, m.podPos.z - p.pos.z);
}

/** Is the mission in a state where the player is actively looking for the pod? */
export function missionTracking(world: World): boolean {
  const s = world.mission?.state;
  return s === 'signalDetected' || s === 'tracking';
}

/** Is the mission over? */
export function missionComplete(world: World): boolean {
  return world.mission?.state === 'completed';
}

/**
 * The one-line objective, or null when there is nothing to say.
 *
 * Deliberately a purpose rather than an instruction: it tells the player what
 * they are doing, not where to walk. "Trace the transmission" is a reason to
 * explore; "go to 62, -40" is a chore with coordinates.
 */
export function missionObjective(world: World): { title: string; detail: string } | null {
  const m = world.mission;
  if (!m) return null;
  switch (m.state) {
    case 'dormant':
      return null;
    case 'signalDetected':
    case 'tracking':
      return { title: 'DISTRESS SIGNAL', detail: 'Trace the Eden Initiative transmission.' };
    case 'crashSiteReached':
      return { title: 'CRASH SITE', detail: 'Search the wreck. Somebody walked away from it.' };
    case 'survivorFound':
      return { title: 'SURVIVOR', detail: 'Speak with her.' };
    case 'survivorRescued':
      return { title: 'BRING HER HOME', detail: 'Return to Human Landing.' };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

/**
 * Advance the mission.
 *
 * Called once per simulation tick. Every transition below is caused by where
 * the player is or what they have done — nothing here can be triggered from
 * outside, and each one fires exactly once because the state it leaves is the
 * state it required.
 */
export function missionTick(world: World): void {
  const m = world.mission;
  if (!m) return;
  const p = world.player;
  const t = world.timeSec;
  const pending: string[] = [];
  const say = (line: string) => pending.push(line);

  switch (m.state) {
    case 'dormant': {
      // FIRST LIGHT holds this shut. Before the headcount nobody has noticed
      // anyone is missing, so ARI has no reason to be talking about a pod —
      // and the opening would be talking over itself if she did.
      if (!missionUnlocked(world)) return;
      // A moment to breathe first. The player has just arrived in a world; the
      // very first thing that happens to them should not be a task.
      if (m.startedAt < 0) m.startedAt = t;
      if (t - m.startedAt < MISSION.openingGrace) return;
      m.state = 'signalDetected';
      m.detectedAt = t;
      m.detectDist = dist(p.pos, m.podPos);
      say('Kai — I have something. An Eden Initiative distress carrier, still transmitting.');
      say('It is weak, and it is somewhere out in the Riverlands. That frequency is ours. It could be one of the pods.');
      chronicle(world, 'emerson', 'ARI detected an Eden Initiative distress carrier in the Riverlands.', {
        actorIds: ['emerson'],
        actorNames: ['Kai'],
        pos: { ...p.pos },
        cause: ['A weak transmission on an expedition frequency'],
        effects: ['Somebody from the landing may still be alive'],
      });
      break;
    }

    case 'signalDetected': {
      // Waits for the player to actually set off.
      //
      // Not for the signal to be audible — Human Landing is already inside its
      // range, so a non-zero reading says nothing. What this waits for is Kai
      // being meaningfully *closer* than he was when ARI first heard it, so the
      // warmer/colder commentary begins as a response to the player's own
      // choice rather than as an instruction issued at the camp gate.
      m.signalStrength = signalStrengthAt(world, p.pos.x, p.pos.z);
      if (dist(p.pos, m.podPos) < m.detectDist - MISSION.setOffDistance) {
        m.state = 'tracking';
        say('That is the right way. Keep going — I will tell you as it strengthens.');
      }
      break;
    }

    case 'tracking': {
      const s = signalStrengthAt(world, p.pos.x, p.pos.z);
      const before = m.signalStrength;
      m.signalStrength = s;
      // Commentary at thresholds, not continuously. ARI should sound like
      // someone watching a needle, not like a proximity alarm.
      for (const step of MISSION.signalMilestones) {
        if (before < step.at && s >= step.at && !world.flags[`signal_${step.at}`]) {
          world.flags[`signal_${step.at}`] = true;
          say(step.line);
        }
      }
      if (dist(p.pos, m.podPos) <= MISSION.arriveRange) {
        m.state = 'crashSiteReached';
        m.reachedAt = t;
        say('That is one of ours. Pod Seven — it went down hard.');
        say('The hatch is open from the inside, Kai. Somebody got out.');
        chronicle(world, 'emerson', 'Kai found the wreck of Pod Seven in the Riverlands.', {
          actorIds: ['emerson'],
          actorNames: ['Kai'],
          pos: { ...m.podPos },
          cause: ['He followed the distress carrier to its source'],
          effects: ['The hatch had been opened from the inside', 'Somebody survived the landing'],
        });
      }
      break;
    }

    case 'crashSiteReached': {
      // Seeing her is a separate beat from reaching the pod: the wreck raises
      // the question, and finding her a few metres away answers it.
      if (dist(p.pos, m.survivorPos) <= MISSION.findRange) {
        m.state = 'survivorFound';
        say('Kai — movement. She is alive.');
      }
      break;
    }

    case 'survivorFound':
      // Waits for the conversation. See `beginSurvivorDialogue`.
      break;

    case 'survivorRescued': {
      if (dist(p.pos, m.homePos) <= MISSION.homeRange) {
        completeMission(world);
      }
      break;
    }

    default:
      break;
  }

  if (pending.length > 0) ariSays(world, pending);
}

/**
 * Maya is rescued — called when her conversation ends.
 *
 * Idempotent: the state it moves out of is the state it requires, so a second
 * call from a re-opened dialogue does nothing.
 */
export function rescueSurvivor(world: World): boolean {
  const m = world.mission;
  if (!m || m.state !== 'survivorFound') return false;
  m.state = 'survivorRescued';
  m.rescuedAt = world.timeSec;
  ariSays(world, [
    'She can walk. Take her home, Kai — Human Landing is going to want to see her more than they know.',
  ]);
  chronicle(world, 'emerson', `Kai found ${MISSION.survivorName} alive at the wreck of Pod Seven.`, {
    actorIds: ['emerson'],
    actorNames: ['Kai'],
    pos: { ...m.survivorPos },
    cause: ['He traced a distress carrier into the Riverlands'],
    effects: [`${MISSION.survivorName} survived the landing`, 'She is an agricultural systems specialist'],
  });
  return true;
}

/**
 * Home again.
 *
 * This is where the mission pays off, and the payoff is deliberately not a
 * reward: it is a capability the colony did not have this morning. Twelve
 * people became thirteen, and the thirteenth knows how to grow food.
 */
export function completeMission(world: World): boolean {
  const m = world.mission;
  if (!m || m.state !== 'survivorRescued') return false;
  m.state = 'completed';
  m.completedAt = world.timeSec;
  m.agricultureUnlocked = true;
  world.flags.agricultureProgram = true;
  world.dirty.structures = true;
  world.dirty.entities = true;
  ariSays(world, [
    `${MISSION.survivorName} is home. Thirteen of us now — and the first one who knows how to make this place feed itself.`,
    'AGRICULTURE PROGRAM AVAILABLE. She has already started marking out ground by the water.',
  ]);
  chronicle(world, 'settlement', `${MISSION.survivorName} reached Human Landing alive.`, {
    actorIds: ['emerson'],
    actorNames: ['Kai'],
    pos: { ...m.homePos },
    place: 'Human Landing',
    cause: ['Kai brought her back from the wreck of Pod Seven'],
    effects: [
      'Human Landing has thirteen confirmed survivors',
      'The colony can begin an agriculture program',
    ],
  });
  return true;
}

/** Where the agriculture site stands, once there is one. */
export function agricultureSitePos(world: World): V2 {
  const m = world.mission;
  const home = m ? m.homePos : v2(95, 25);
  // A short walk from the hearth, on the flattest dry ground nearby — she would
  // have picked somewhere level, and the player should be able to see it from
  // the middle of camp.
  let best = v2(home.x - 16, home.z + 10);
  let bestSlope = Infinity;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    for (const r of [14, 18, 22]) {
      const p = v2(home.x + Math.sin(a) * r, home.z + Math.cos(a) * r);
      if (isWater(p.x, p.z) || !isWalkable(p.x, p.z)) continue;
      const s = slopeAt(p.x, p.z);
      if (s < bestSlope) {
        bestSlope = s;
        best = p;
      }
    }
  }
  return best;
}

/** Height of the ground at the agriculture site, for the renderer. */
export function agricultureSiteY(world: World): number {
  const p = agricultureSitePos(world);
  return groundY(p.x, p.z);
}

/** Is the survivor standing in the world right now, and where? */
export function survivorVisiblePos(world: World): V2 | null {
  const m = world.mission;
  if (!m) return null;
  if (m.state === 'completed') return { ...m.homePos };
  // She is only drawn once the player is close enough to have discovered the
  // site. Before that she is not a distant figure on a hillside giving the
  // answer away.
  if (m.state === 'crashSiteReached' || m.state === 'survivorFound' || m.state === 'survivorRescued') {
    return { ...m.survivorPos };
  }
  return null;
}

export type { MissionState };
