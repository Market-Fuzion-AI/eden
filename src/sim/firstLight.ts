import { DAY_SEC, FIRST_LIGHT } from './config';
import { chronicle, clockOf } from './chronicle';
import { createProject } from './structures';
import { groundY, isWalkable, isWater } from './terrain';
import type { FirstLight, FirstLightBeat, Settler, World } from './types';
import { dist, v2, type V2 } from './vec';

/**
 * FIRST LIGHT — the authored opening.
 *
 * EDEN used to begin after its own first episode: a finished camp, a lit
 * hearth, a working Fabricator, and twelve people already getting on with the
 * day. The player arrived as a tourist to a colony that had clearly happened
 * without them. This is the hour before that.
 *
 * WHAT THIS IS NOT
 *
 * It is not a quest system. There is no objective graph, no reward table, no
 * generic "give the player a task" machinery. It is a small director with a
 * fixed list of beats, and its entire job is to constrain the simulation
 * briefly and then get out of the way.
 *
 * HOW IT CONSTRAINS WITHOUT REPLACING
 *
 * The one mechanism used is `roleAnchor`, which already existed to keep Petra
 * near the Fabricator during working hours. Read `goals.ts`: an anchor only
 * applies when the settler is *settled* — not hungry, not exhausted, not
 * mid-errand — and it only ever nudges them back toward a post. Hunger,
 * tiredness and their own plans all still outrank it. So a survivor posted to
 * triage does triage, and also eats when hungry and sleeps when shattered,
 * because the utility AI underneath is untouched.
 *
 * When a beat is done, the anchors are cleared and the twelve are ordinary
 * autonomous settlers again. Story borrows them; it does not own them.
 *
 * WHERE IT ENDS
 *
 * At the headcount, when Maya is found to be missing, this hands off to the
 * distress mission that already exists and has always worked. First Light does
 * not reimplement any of it — it only decides *when* `world.mission` is allowed
 * to stop being dormant.
 */

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

/**
 * Where each survivor is during the emergency, and what they are doing.
 *
 * Offsets are relative to the camp anchor, so the whole crash site moves with
 * the landing if it is ever repositioned. Everyone has a job that follows from
 * who they already are — the roster was authored first and this reads from it,
 * rather than inventing a second, contradictory idea of these people.
 */
interface Station {
  name: string;
  /** Offset from the camp anchor, in metres. */
  at: V2;
  /** What the goal line says while they are posted here. */
  doing: string;
  /** Beats during which they are held. */
  through: FirstLightBeat[];
}

const EARLY: FirstLightBeat[] = ['impact', 'gather', 'stabilize'];
const ALL_DAY: FirstLightBeat[] = ['impact', 'gather', 'stabilize', 'campRising'];

/**
 * Two rings, so nobody's name plate lands on anybody else's.
 *
 * The first layout put Petra and Asha three and a half metres apart and their
 * labels rendered as "PETRA ASHA" — unreadable, and the whole point of posting
 * people to visible jobs is that the player can see who is doing what. An inner
 * ring of five around where the fire will be, an outer ring of seven at the
 * wreck and the perimeter, both spaced far enough that the plates never touch.
 */
export const STATIONS: Station[] = [
  // Inner ring — the people whose work is at the middle of the camp.
  { name: 'Hollis', at: v2(0, 7), doing: 'Counting heads and giving orders', through: ALL_DAY },
  { name: 'Mira', at: v2(6.7, 2.2), doing: 'Working through the injured', through: ALL_DAY },
  { name: 'Kael', at: v2(4.1, -5.7), doing: 'Inventorying what survived', through: ALL_DAY },
  { name: 'Nadia', at: v2(-4.1, -5.7), doing: 'Finding water worth drinking', through: ALL_DAY },
  { name: 'Dmitri', at: v2(-6.7, 2.2), doing: 'Checking whether anything here is safe to touch', through: EARLY },
  // Outer ring — the wreck, the perimeter, and the ground beyond it.
  { name: 'Rowan', at: v2(6.5, 13.5), doing: 'Reading what is left of the pod', through: ALL_DAY },
  { name: 'Asha', at: v2(14.6, 3.4), doing: 'Pulling power cells out of the wreck', through: ALL_DAY },
  { name: 'Petra', at: v2(11.7, -9.4), doing: 'Sorting the damaged fabrication gear', through: ALL_DAY },
  { name: 'Tomas', at: v2(0, -15), doing: 'Clearing rubble off the pod door', through: EARLY },
  { name: 'June', at: v2(-11.7, -9.4), doing: 'Watching the treeline', through: ALL_DAY },
  { name: 'Selene', at: v2(-14.6, 3.4), doing: 'Getting a first fix on the ground', through: EARLY },
  { name: 'Ines', at: v2(-6.5, 13.5), doing: 'Trying to raise anyone at all', through: ALL_DAY },
];

/** The three whose beats actually advance the opening. */
export const KEY_SURVIVORS = ['Hollis', 'Mira', 'Kael'];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function initFirstLight(world: World): FirstLight {
  return {
    beat: 'impact',
    beatStartedAt: world.timeSec,
    metSurvivors: [],
    tentsRaised: 0,
    scanned: false,
    revealedAt: -1,
    spoken: [],
  };
}

/** Is the authored opening still running? */
export function firstLightActive(world: World): boolean {
  return world.firstLight.beat !== 'released';
}

/**
 * May the distress mission wake up?
 *
 * The single gate between the opening and the existing mission. Before the
 * headcount, ARI has no reason to be talking about a pod — nobody has noticed
 * anyone is missing yet.
 */
export function missionUnlocked(world: World): boolean {
  return world.firstLight.revealedAt >= 0;
}

/** A camp-relative position, dropped onto walkable ground. */
function stationPos(world: World, at: V2): V2 {
  const camp = world.camps.find((c) => c.speciesId === 'human')!;
  let p = v2(camp.pos.x + at.x, camp.pos.z + at.z);
  // Nudge inward until it is somewhere a person could actually stand.
  for (let i = 0; i < 8 && (isWater(p.x, p.z) || !isWalkable(p.x, p.z)); i++) {
    p = v2(camp.pos.x + at.x * (1 - (i + 1) * 0.12), camp.pos.z + at.z * (1 - (i + 1) * 0.12));
  }
  return p;
}

/**
 * Scatter the survivors across the crash site and post them to their jobs.
 *
 * Called once at worldgen. Everyone starts where the story needs them rather
 * than clustered on the camp anchor, which is most of what makes the opening
 * read as an aftermath instead of a settlement.
 */
export function placeSurvivors(world: World): void {
  for (const st of STATIONS) {
    const s = world.settlers.find((x) => x.name === st.name);
    if (!s) continue;
    const p = stationPos(world, st.at);
    s.pos = { ...p };
    s.home = { ...p };
  }
  applyStations(world);
}

/**
 * Post everyone whose station covers the current beat; release the rest.
 *
 * Re-applied on every beat change, so a survivor whose job is finished stops
 * being held the moment it is.
 */
export function applyStations(world: World): void {
  const beat = world.firstLight.beat;
  for (const st of STATIONS) {
    const s = world.settlers.find((x) => x.name === st.name);
    if (!s) continue;
    if (st.through.includes(beat)) {
      s.roleAnchor = {
        role: 'station',
        label: st.doing,
        pos: stationPos(world, st.at),
        radius: FIRST_LIGHT.stationRadius,
        fromHour: 0,
        toHour: 24,
      };
    } else if (s.roleAnchor?.role === 'station') {
      // Their beat is over. Back to their own life.
      s.roleAnchor = undefined;
    }
  }
}

/** Hand every survivor back to the simulation. */
export function releaseStations(world: World): void {
  for (const s of world.settlers) {
    if (s.roleAnchor?.role === 'station') s.roleAnchor = undefined;
  }
}

// ---------------------------------------------------------------------------
// Camp construction
// ---------------------------------------------------------------------------

/** A tent's own footprint, used both for placement and for collision. */
const TENT_RADIUS = 2.0;

/**
 * Somewhere clear near the camp for a tent, laid out around the fire.
 *
 * The ring is deliberately tight. Six shelters spread over a wide circle read
 * as scattered wreckage from any normal camera distance; huddled round the
 * hearth they read as a camp, which is the whole point of the evening beat.
 * Spots are nudged around the ring rather than pulled inward when they clash,
 * so a tent never grows through the pod or through another tent.
 */
function tentSpot(world: World, index: number): V2 {
  const camp = world.camps.find((c) => c.speciesId === 'human')!;
  // Anchor the ring to the wreck and offset it by half a step, so the pod sits
  // between two tents and the gap opposite it becomes the way into the camp.
  // With a tent on that axis instead, the hearth is hidden from the one
  // direction a player naturally walks in from.
  const pod = world.landmarksBuilt.find((b) => b.kind === 'pod');
  const podAngle = pod ? Math.atan2(pod.pos.x - camp.pos.x, pod.pos.z - camp.pos.z) : 0.6;
  const base = podAngle + ((index + 0.5) / FIRST_LIGHT.tents) * Math.PI * 2;
  const r = FIRST_LIGHT.tentRing;

  const blocked = (p: V2): boolean => {
    if (isWater(p.x, p.z) || !isWalkable(p.x, p.z)) return true;
    return world.obstacles.some((o) => dist(o.pos, p) < o.radius + TENT_RADIUS);
  };

  // Try the ideal spot, then swing either way around the ring, then step out.
  for (const out of [0, 2.5, 5]) {
    for (const swing of [0, 0.2, -0.2, 0.4, -0.4, 0.6, -0.6]) {
      const a = base + swing;
      const rr = r + out;
      const p = v2(camp.pos.x + Math.sin(a) * rr, camp.pos.z + Math.cos(a) * rr);
      if (!blocked(p)) return p;
    }
  }
  return v2(camp.pos.x + Math.sin(base) * r, camp.pos.z + Math.cos(base) * r);
}

/**
 * Light the hearth.
 *
 * The campfire used to exist at t=0, complete and credited to everyone. Now it
 * is built when the survivors actually get round to building it, which is the
 * single clearest signal that the place is becoming a camp.
 */
export function lightTheFire(world: World): void {
  if (world.flags.hearthLit) return;
  const camp = world.camps.find((c) => c.speciesId === 'human')!;
  const humans = world.settlers.filter((s) => s.speciesId === 'human');
  if (humans.length === 0) return;

  // If a hearth somehow already exists nearby, adopt it rather than adding a
  // second one inside its own spacing rule.
  const existing = world.structures.find(
    (st) => st.type === 'campfire' && dist(st.pos, camp.pos) < FIRST_LIGHT.tentRing * 4,
  );
  if (existing) {
    existing.progress = 1;
    existing.state = 'complete';
    existing.completedAt = world.timeSec;
    world.flags.hearthLit = true;
    world.dirty.structures = true;
    return;
  }

  const st = createProject(
    world,
    humans[0],
    'campfire',
    v2(camp.pos.x, camp.pos.z),
    ['Something to gather round, on the first night'],
    ['Beside the wreck, where everyone already was'],
  );
  const share = humans.length;
  st.contributions = humans.map((s) => ({
    id: s.id,
    name: s.name,
    wood: st.required.wood / share,
    stone: st.required.stone / share,
    work: 1 / share,
  }));
  st.contributed = { wood: st.required.wood, stone: st.required.stone };
  st.progress = 1;
  st.state = 'complete';
  st.completedAt = world.timeSec;
  for (const s of world.settlers) {
    if (!s.knownStructureIds.includes(st.id)) s.knownStructureIds.push(st.id);
  }
  world.flags.hearthLit = true;
  world.dirty.structures = true;
}

/** Put up one more tent, if any are still owed. */
export function raiseTent(world: World): boolean {
  const fl = world.firstLight;
  if (fl.tentsRaised >= FIRST_LIGHT.tents) return false;
  const pos = tentSpot(world, fl.tentsRaised);
  // Doorways face the hearth, not the world origin. Six mouths turned inward
  // is what makes a ring of shelters read as a camp.
  const camp = world.camps.find((c) => c.speciesId === 'human')!;
  const rot = Math.atan2(camp.pos.x - pos.x, camp.pos.z - pos.z);
  world.landmarksBuilt.push({ kind: 'tent', pos, rot });
  world.obstacles.push({ pos, radius: TENT_RADIUS });
  fl.tentsRaised += 1;
  world.dirty.structures = true;
  return true;
}

// ---------------------------------------------------------------------------
// The beats
// ---------------------------------------------------------------------------

const ORDER: FirstLightBeat[] = [
  'impact',
  'gather',
  'stabilize',
  'campRising',
  'evening',
  'headcount',
  'released',
];

function say(world: World, lines: string[]): void {
  world.ariQueue.splice(0, 0, ...lines);
  if (world.ariQueue.length > 8) world.ariQueue.length = 8;
}

export function enterBeat(world: World, beat: FirstLightBeat): void {
  const fl = world.firstLight;
  fl.beat = beat;
  fl.beatStartedAt = world.timeSec;

  switch (beat) {
    case 'impact':
      say(world, [
        'Kai. You are on your feet — good. Give me a moment, my sensors came down harder than you did.',
        'Eden Initiative pod, and it is ours. We are down, we are scattered, and I can hear people moving. Find them.',
      ]);
      break;

    case 'gather':
      say(world, [
        'That is three of them accounted for. Keep going — Hollis is trying to hold a headcount together.',
      ]);
      break;

    case 'stabilize':
      say(world, [
        'Nobody is bleeding out and the pod is not going to burn. That is the emergency over.',
        'Sweep the site while they work, Kai. I want to know what this ground is carrying and whether anything out there is watching us.',
      ]);
      break;

    case 'campRising':
      applyStations(world);
      lightTheFire(world);
      say(world, ['They are putting canvas up. It is not a settlement, but it is a place to sleep.']);
      chronicle(world, 'settlement', 'The survivors began raising an emergency camp at the landing site.', {
        actorIds: ['emerson'],
        actorNames: ['Kai'],
        pos: { ...world.player.pos },
        place: 'Human Landing',
        cause: ['Twelve people came down alive and needed somewhere to sleep'],
        effects: ['Human Landing exists, after a fashion'],
      });
      break;

    case 'evening':
      // Whatever is still owed goes up now, so nightfall always finds a
      // finished camp rather than a half-built one.
      while (raiseTent(world)) {
        /* keep going */
      }
      releaseStations(world);
      say(world, [
        'Six tents, one fire, twelve people. Sit down for a minute, Kai — you have earned the minute.',
      ]);
      break;

    case 'headcount': {
      const missing = FIRST_LIGHT.missingName;
      say(world, [
        `Hollis has counted twice. Twelve at the fire, and there should be thirteen.`,
        `${missing} is not here. Agricultural systems — she is the one who was going to make this valley feed us.`,
        'Her pod separated on the way down. If it held, it is still transmitting, and I can hear something on our frequency.',
      ]);
      world.firstLight.revealedAt = world.timeSec;
      chronicle(world, 'settlement', `The headcount at Human Landing came up one short: ${missing} is missing.`, {
        actorIds: ['emerson'],
        actorNames: ['Kai'],
        pos: { ...world.player.pos },
        place: 'Human Landing',
        cause: ['Twelve survivors reached the landing site; the expedition was thirteen'],
        effects: [
          `${missing} is unaccounted for`,
          'The colony has emergency rations and nobody who can grow more',
        ],
      });
      break;
    }

    case 'released':
      releaseStations(world);
      break;
  }
}

/**
 * Should the current beat end?
 *
 * Every beat has a condition the player can satisfy *and* a time fallback, so
 * the opening can be played attentively or wandered through and cannot deadlock
 * either way. The fallbacks are generous; they exist to stop the story getting
 * stuck, not to rush it.
 */
function beatComplete(world: World): boolean {
  const fl = world.firstLight;
  const elapsed = world.timeSec - fl.beatStartedAt;
  const met = fl.metSurvivors.length;

  switch (fl.beat) {
    case 'impact':
      // Long enough to look around and realise where he is.
      return elapsed > FIRST_LIGHT.impactDwell;
    case 'gather':
      return met >= FIRST_LIGHT.metToStabilize || elapsed > FIRST_LIGHT.gatherTimeout;
    case 'stabilize':
      // The scanner beat. Sweeping the site is the intended way through, and
      // waiting is the way through for a player who does not.
      return fl.scanned || elapsed > FIRST_LIGHT.stabilizeTimeout;
    case 'campRising':
      return fl.tentsRaised >= FIRST_LIGHT.tents && elapsed > FIRST_LIGHT.campMinimum;
    case 'evening':
      // Night, and a moment of quiet before the bad news.
      return elapsed > FIRST_LIGHT.eveningDwell;
    case 'headcount':
      return elapsed > FIRST_LIGHT.headcountDwell;
    default:
      return false;
  }
}

/**
 * One tick of the opening.
 *
 * Cheap: a beat check, and during `campRising` a tent every so often. The
 * simulation is doing the actual work — this only decides when the story is
 * allowed to move.
 */
export function firstLightTick(world: World): void {
  const fl = world.firstLight;
  if (fl.beat === 'released') return;

  if (fl.beat === 'campRising') {
    const due = Math.floor((world.timeSec - fl.beatStartedAt) / FIRST_LIGHT.tentInterval) + 1;
    while (fl.tentsRaised < Math.min(due, FIRST_LIGHT.tents)) {
      if (!raiseTent(world)) break;
    }
  }

  if (!beatComplete(world)) return;
  const next = ORDER[ORDER.indexOf(fl.beat) + 1];
  if (next) enterBeat(world, next);
}

/** Kai spoke to someone. Only the first conversation with each person counts. */
export function noteMet(world: World, s: Settler): void {
  const fl = world.firstLight;
  if (fl.beat === 'released') return;
  if (fl.metSurvivors.includes(s.id)) return;
  if (s.speciesId !== 'human') return;
  fl.metSurvivors.push(s.id);
}

/** Kai swept the site. Satisfies the scanner beat. */
export function noteScan(world: World): void {
  if (world.firstLight.beat !== 'released') world.firstLight.scanned = true;
}

// ---------------------------------------------------------------------------
// Developer tooling
// ---------------------------------------------------------------------------

/**
 * Jump to a beat, building whatever that beat assumes.
 *
 * A jump has to produce a *coherent* world, not a half one: skipping to the
 * evening without a fire and six tents would be testing a state the game can
 * never actually be in.
 */
export function jumpToBeat(world: World, beat: FirstLightBeat): void {
  const fl = world.firstLight;
  const idx = ORDER.indexOf(beat);

  // Everything the skipped beats would have established.
  if (idx >= ORDER.indexOf('gather')) {
    for (const name of KEY_SURVIVORS) {
      const s = world.settlers.find((x) => x.name === name);
      if (s && !fl.metSurvivors.includes(s.id)) fl.metSurvivors.push(s.id);
    }
  }
  if (idx >= ORDER.indexOf('campRising')) {
    fl.scanned = true;
    lightTheFire(world);
  }
  if (idx >= ORDER.indexOf('evening')) {
    while (raiseTent(world)) {
      /* fill the camp */
    }
    // Evening means evening.
    const day = Math.floor(world.timeSec / DAY_SEC);
    if (clockOf(world.timeSec).hour < 20) world.timeSec = day * DAY_SEC + DAY_SEC * (20.5 / 24);
  }
  if (idx >= ORDER.indexOf('headcount')) fl.revealedAt = Math.max(fl.revealedAt, world.timeSec);

  fl.beat = beat;
  fl.beatStartedAt = world.timeSec;
  enterBeat(world, beat);
}

/**
 * Put the opening back to its first moment.
 *
 * Deliberately not a page reload: the point is to replay First Light without
 * clearing browser state, so a tester can go round again in seconds.
 */
export function restartFirstLight(world: World): void {
  // Undo the camp.
  world.landmarksBuilt = world.landmarksBuilt.filter((b) => b.kind !== 'tent');
  world.obstacles = world.obstacles.filter(
    (o) => !world.landmarksBuilt.some((b) => b.kind === 'tent' && dist(b.pos, o.pos) < 0.01),
  );
  world.structures = world.structures.filter((s) => s.type !== 'campfire');
  world.flags.hearthLit = false;

  // Undo the mission.
  if (world.mission) {
    world.mission.state = 'dormant';
    world.mission.startedAt = -1;
    world.mission.detectedAt = -1;
    world.mission.choiceMade = null;
    world.mission.agricultureUnlocked = false;
  }
  world.flags.agricultureProgram = false;
  world.dialogueScript = null;

  // Morning again.
  const day = Math.floor(world.timeSec / DAY_SEC);
  world.timeSec = day * DAY_SEC + DAY_SEC * (8 / 24);

  world.firstLight = initFirstLight(world);
  placeSurvivors(world);
  world.player.pos = { ...wakePos(world) };
  world.player.y = groundY(world.player.pos.x, world.player.pos.z);
  world.dirty.structures = true;
  world.dirty.entities = true;
  enterBeat(world, 'impact');
}

/** Where Kai comes round — beside the wreck, not in the middle of camp. */
export function wakePos(world: World): V2 {
  const camp = world.camps.find((c) => c.speciesId === 'human')!;
  const pod = world.landmarksBuilt.find((b) => b.kind === 'pod');
  const from = pod ? pod.pos : camp.pos;
  let p = v2(from.x + 5.5, from.z + 4.5);
  for (let i = 0; i < 8 && (isWater(p.x, p.z) || !isWalkable(p.x, p.z)); i++) {
    p = v2(from.x + 5.5 - i, from.z + 4.5 - i);
  }
  return p;
}

/** The beats, in order, for developer tooling. */
export const BEATS = ORDER;

/**
 * Bring the Fabricator online.
 *
 * The expedition brought fabrication capability and the crash broke it, so
 * Day 1 has no Fabricator at all — see `buildHumanLanding`. This is the seam
 * that puts it back: the repair mission in a later phase calls this, and the
 * fabrication tests call it to set up a world in which the machine exists.
 *
 * Deliberately here rather than in `fabrication.ts`: what it does is undo a
 * *story* decision, and keeping it beside the decision is how the two stay in
 * step. It builds nothing new — this is the same landmark, obstacle and
 * technician anchor the world used to be created with.
 */
export function restoreFabricator(world: World): void {
  if (world.fabricatorPos) return;
  const camp = world.camps.find((c) => c.speciesId === 'human')!;
  let pos = v2(camp.pos.x + 9, camp.pos.z + 6);
  for (let i = 0; i < 10 && (isWater(pos.x, pos.z) || !isWalkable(pos.x, pos.z)); i++) {
    pos = v2(camp.pos.x + 9 - i * 1.5, camp.pos.z + 6 - i);
  }

  world.landmarksBuilt.push({ kind: 'fabricator', pos, rot: 0 });
  // Sized to the machine's deck, not its core: a smaller radius let the camera
  // boom pull inside the hazard ring and fill the screen with it.
  world.obstacles.push({ pos, radius: 2.9 });
  world.fabricatorPos = { ...pos };

  const tech = world.settlers.find((s) => s.name === 'Petra');
  if (tech) {
    tech.roleAnchor = { role: 'fabricator', pos: { ...pos }, radius: 16, fromHour: 6, toHour: 21 };
    tech.home = { ...pos };
  }
  world.dirty.structures = true;
}
