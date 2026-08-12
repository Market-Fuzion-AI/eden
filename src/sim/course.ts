import { PLAYER, WORLD } from './config';
import { groundY, isWalkable, isWater, slopeAt } from './terrain';
import type { CourseProp, World } from './types';
import { v2, type V2 } from './vec';

/**
 * The 3Cs test course.
 *
 * Gate 1 asks one question — does Emerson feel good to control — and answering
 * it needs ground that deliberately poses movement problems, one after another,
 * within a short walk. This is greyboxing inside the existing world: no new
 * map, no new art, no mission, no objective. Just a sequence of traversal
 * situations laid along a readable line, close enough to Human Landing to reach
 * on foot and far enough from it that settlers, the Fabricator and the colony's
 * conversations are not underfoot while movement is being tested.
 *
 * Every prop is built from the same procedural vocabulary the rest of the world
 * uses. Beacons mark the route because a player should be able to see where the
 * course goes without being told, and without a quest marker.
 */

/**
 * Where the course begins, relative to the human camp.
 *
 * Read as a bearing and a distance rather than a literal offset — see
 * `chooseAxis`, which keeps the intent (a short walk out of the colony, roughly
 * north-west) while moving off ground the terrain has put water on.
 */
const COURSE_OFFSET = v2(-34, 8);

/** Direction the course runs in from its start, and how long each bay is. */
const STRIDE = 11;

export interface CourseLayout {
  start: V2;
  /** Unit vector along the course. */
  dir: V2;
  props: CourseProp[];
}

let layout: CourseLayout | null = null;

/**
 * Choose where the run starts and which way it points.
 *
 * The terrain is generated from the world seed, so a fixed offset and bearing
 * is a bet that the same patch of ground is dry in every world — and it is not.
 * At the seeds checked, the fixed offset put the two start markers *in the
 * river*: Human Landing sits on the bank, and thirty-four metres west of it is
 * water at every seed tried.
 *
 * So both are chosen instead of assumed. Sweep bearings out from the camp, put
 * the start a short walk along each, and score the whole line for water,
 * unwalkable ground and the play boundary. Ties break toward the preferred
 * bearing, so the course keeps its intended orientation wherever the ground
 * allows it. Deterministic: same seed, same terrain, same answer, no RNG drawn.
 */
function chooseAxis(camp: V2): { origin: V2; heading: number } {
  // The bearing the course was designed along: out of the camp, north-west.
  const preferred = Math.atan2(COURSE_OFFSET.x, COURSE_OFFSET.z);
  const walkOut = Math.hypot(COURSE_OFFSET.x, COURSE_OFFSET.z);

  /**
   * Score a candidate by building it and looking at where its props actually
   * land. Sampling the centre line instead was close enough to look right and
   * still put a prop in the river at two seeds in a hundred and twenty: props
   * sit off the line, and the water was between the samples.
   */
  const score = (h: number): { origin: V2; bad: number } => {
    const dir = v2(Math.sin(h), Math.cos(h));
    const origin = v2(camp.x + dir.x * walkOut, camp.z + dir.z * walkOut);
    const candidate = layoutFor(origin, h);
    let bad = 0;
    const check = (p: V2) => {
      if (Math.hypot(p.x, p.z) > WORLD.playRadius - 12) bad += 3;
      if (isWater(p.x, p.z)) bad += 3;
      else if (!isWalkable(p.x, p.z)) bad += 1;
    };
    check(origin);
    check(candidate.start);
    for (const prop of candidate.props) check(prop.pos);
    return { origin, bad };
  };

  const first = score(preferred);
  let best = { origin: first.origin, heading: preferred };
  let bestBad = first.bad;
  if (bestBad === 0) return best;
  for (let i = 1; i <= 18 && bestBad > 0; i++) {
    for (const sign of [-1, 1]) {
      const h = preferred + sign * i * (Math.PI / 18);
      const s = score(h);
      if (s.bad < bestBad) {
        bestBad = s.bad;
        best = { origin: s.origin, heading: h };
      }
    }
  }
  return best;
}

/**
 * Build the course.
 *
 * Laid out along a straight axis in *course space* and then rotated into the
 * world, so the sequence of problems is easy to read in the source: each block
 * below is one bay of the run, in the order the player meets them.
 */
export function buildCourse(world: World): void {
  const camp = world.camps.find((c) => c.speciesId === 'human');
  const axis = chooseAxis(camp ? camp.pos : v2(0, 0));
  layout = layoutFor(axis.origin, axis.heading);
  world.course = layout.props;
}

/** Lay the run out along one candidate axis. */
function layoutFor(origin: V2, heading: number): CourseLayout {
  const dir = v2(Math.sin(heading), Math.cos(heading));
  const side = v2(dir.z, -dir.x);
  const props: CourseProp[] = [];
  let n = 0;

  /** Place at (along, across) in course space. */
  const at = (along: number, across: number): V2 =>
    v2(origin.x + dir.x * along + side.x * across, origin.z + dir.z * along + side.z * across);

  const put = (p: Omit<CourseProp, 'id'>): CourseProp => {
    const prop = { ...p, id: `course_${n++}` };
    props.push(prop);
    return prop;
  };

  // --- 0. Start ------------------------------------------------------------
  // A marker to stand on and a pair of gateposts, so the run has an obvious
  // beginning to return to. Open flat ground for the first ten metres: the
  // player should be able to feel plain walking before anything is asked of it.
  put({ kind: 'marker', pos: at(0, 0), rot: 0, size: { x: 0.5, z: 0.5 }, height: 2.6, solid: false });
  put({ kind: 'marker', pos: at(0, 3.4), rot: 0, size: { x: 0.5, z: 0.5 }, height: 2.6, solid: false });

  // --- 1. Rock slalom ------------------------------------------------------
  // Alternating boulders at walking width: tests turning, near-geometry
  // collision, and whether the camera copes with things passing close by.
  for (let i = 0; i < 6; i++) {
    put({
      kind: 'rock',
      pos: at(STRIDE + i * 3.6, i % 2 === 0 ? 2.1 : -2.1),
      rot: i * 0.7,
      size: { x: 1.15, z: 1.15 },
      height: 1.8,
      solid: true,
    });
  }

  // --- 2. Low step and ledge ----------------------------------------------
  // A pad low enough to walk onto and a block that has to be jumped. The pair
  // is what makes the step-up tolerance legible: one you stroll over, one you
  // do not.
  put({ kind: 'pad', pos: at(STRIDE * 3.2, 0), rot: 0, size: { x: 2.6, z: 2.6 }, height: 0.38, solid: false });
  put({ kind: 'block', pos: at(STRIDE * 3.9, 0), rot: 0, size: { x: 2.2, z: 2.2 }, height: 1.05, solid: true });

  // --- 3. The gap ----------------------------------------------------------
  // Two platforms with air between them, sized so a running jump clears it and
  // a standing one does not. Low enough to be reached from the ground: they
  // were 1.35 m, which is above the jump, so the gap could never be attempted.
  put({ kind: 'block', pos: at(STRIDE * 4.9, 0), rot: 0, size: { x: 2.4, z: 3.2 }, height: 1.15, solid: true });
  put({ kind: 'block', pos: at(STRIDE * 5.6, 0), rot: 0, size: { x: 2.4, z: 3.2 }, height: 1.15, solid: true });

  // --- 4. The plank --------------------------------------------------------
  // A narrow crossing. Tests fine steering and whether the camera stays useful
  // when the player is thinking about their feet.
  put({ kind: 'plank', pos: at(STRIDE * 6.6, 0), rot: heading, size: { x: 0.85, z: 6.5 }, height: 0.9, solid: false });

  // --- 5. Narrow passage ---------------------------------------------------
  // Two blocks a body and a half apart. The classic place a third-person
  // camera fails.
  put({ kind: 'rock', pos: at(STRIDE * 7.6, 1.6), rot: 0.4, size: { x: 1.4, z: 1.4 }, height: 2.6, solid: true });
  put({ kind: 'rock', pos: at(STRIDE * 7.6, -1.6), rot: 1.1, size: { x: 1.4, z: 1.4 }, height: 2.6, solid: true });

  // --- 6. Elevated route ---------------------------------------------------
  // A short stair of pads climbing to a platform with a view back down the
  // course, then a drop-off. Tests jumping up, standing high, and falling.
  put({ kind: 'pad', pos: at(STRIDE * 8.4, 0), rot: 0, size: { x: 2.2, z: 2.2 }, height: 0.5, solid: false });
  put({ kind: 'block', pos: at(STRIDE * 8.9, 0.4), rot: 0, size: { x: 2.2, z: 2.2 }, height: 1.15, solid: true });
  put({ kind: 'block', pos: at(STRIDE * 9.4, -0.2), rot: 0, size: { x: 2.6, z: 2.6 }, height: 1.95, solid: true });
  put({ kind: 'marker', pos: at(STRIDE * 9.4, -0.2), rot: 0, size: { x: 0.4, z: 0.4 }, height: 4.4, solid: false });

  return { start: at(-3, 1.7), dir, props };
}

/** Where a QA reset puts Emerson. */
export function courseStart(world: World): V2 {
  if (!layout) buildCourse(world);
  return { ...layout!.start };
}

/** Put Emerson back at the start of the run, without touching the world. */
export function resetToCourseStart(world: World): void {
  const p = world.player;
  const start = courseStart(world);
  p.pos = { ...start };
  p.y = groundY(start.x, start.z);
  p.vy = 0;
  p.speed = 0;
  p.moveSpeed = 0;
  p.onGround = true;
  // Clear the jump's pending state too, or a reset pressed with Space still
  // held launches him off the start marker the moment he arrives.
  p.coyoteUntil = 0;
  p.jumpBufferedUntil = 0;
  p.jumpHeld = false;
  p.dodgeTimer = 0;
  p.dodgeCooldown = 0;
  p.strike = null;
  p.buffered = null;
  p.harvest = null;
  // Face down the course, so a reset leaves the player looking at the run.
  if (layout) p.heading = Math.atan2(layout.dir.x, layout.dir.z);
}

/** The line the course runs along: its start marker and its final platform. */
export function courseSpan(world: World): { a: V2; b: V2 } {
  const props = world.course;
  if (!props || props.length === 0) return { a: v2(0, 0), b: v2(0, 0) };
  return { a: { ...props[0].pos }, b: { ...props[props.length - 1].pos } };
}

/**
 * Shortest distance from a point to the course.
 *
 * Used by worldgen to keep the run clear: nothing grows on it, nothing worth
 * gathering sits beside it, and nothing dangerous lives close enough to notice
 * a player who is only there to test whether walking feels right.
 */
export function distToCourse(world: World, p: V2): number {
  const { a, b } = courseSpan(world);
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  if (len2 < 0.001) return Math.hypot(p.x - a.x, p.z - a.z);
  let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}

// ---------------------------------------------------------------------------
// Support queries
// ---------------------------------------------------------------------------

/** Is this point inside a prop's footprint? */
function footprintContains(prop: CourseProp, x: number, z: number): boolean {
  const dx = x - prop.pos.x;
  const dz = z - prop.pos.z;
  if (prop.kind === 'pad' || prop.kind === 'rock' || prop.kind === 'marker') {
    return dx * dx + dz * dz <= prop.size.x * prop.size.x;
  }
  // Boxes and planks are rotated rectangles.
  const c = Math.cos(-prop.rot);
  const s = Math.sin(-prop.rot);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= prop.size.x && Math.abs(lz) <= prop.size.z;
}

/** The world-space height of a prop's top surface. */
export function propTop(prop: CourseProp): number {
  return groundY(prop.pos.x, prop.pos.z) + prop.height;
}

/**
 * The highest course surface Emerson can be standing on at this point.
 *
 * A surface only supports him if it is at or below his feet plus a tolerance —
 * otherwise it is a wall, and walking into it should not silently teleport him
 * on top. Returns null when nothing here holds him up.
 *
 * The tolerance differs by situation and that difference matters: on the ground
 * it is the step height, so low geometry can be strolled over; in the air it is
 * nearly nothing, so a jump that fell short actually fell short. Sharing one
 * generous value made every ledge in the course reachable from a standing start
 * and quietly deleted the whole point of having heights.
 */
export function courseSupportAt(
  world: World,
  x: number,
  z: number,
  feetY: number,
  tolerance: number = PLAYER.stepHeight,
): number | null {
  if (!world.course || world.course.length === 0) return null;
  let best: number | null = null;
  for (const prop of world.course) {
    if (prop.kind === 'marker' || prop.kind === 'rock') continue;
    if (!footprintContains(prop, x, z)) continue;
    const top = propTop(prop);
    if (top > feetY + tolerance) continue;
    if (best === null || top > best) best = top;
  }
  return best;
}

/** Ground height for the player, course props included. */
export function standingHeight(
  world: World,
  x: number,
  z: number,
  feetY: number,
  tolerance: number = PLAYER.stepHeight,
): number {
  const terrain = groundY(x, z);
  const support = courseSupportAt(world, x, z, feetY, tolerance);
  return support !== null && support > terrain ? support : terrain;
}

/** Slope under a point, or flat when standing on a course surface. */
export function standingSlope(world: World, x: number, z: number, feetY: number): number {
  const support = courseSupportAt(world, x, z, feetY);
  if (support !== null && support > groundY(x, z) + 0.05) return 0;
  return slopeAt(x, z);
}
