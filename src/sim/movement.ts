import { SETTLER, WORLD } from './config';
import { CREATURE_SPECIES_BY_ID } from './species';
import { isWater } from './terrain';
import type { AgentCommon, World } from './types';
import { angleTo, dist, lerpAngle, type V2 } from './vec';

/**
 * Lightweight steering: seek target with obstacle push-out and neighbor
 * separation. No navmesh — the valley is designed to be traversable.
 */

const CELL = 10;
let obstacleGrid: Map<string, { pos: V2; radius: number }[]> | null = null;
let gridWorldSeed = -1;

function buildGrid(world: World): void {
  obstacleGrid = new Map();
  for (const o of world.obstacles) {
    const cx = Math.floor(o.pos.x / CELL);
    const cz = Math.floor(o.pos.z / CELL);
    const key = `${cx},${cz}`;
    let arr = obstacleGrid.get(key);
    if (!arr) obstacleGrid.set(key, (arr = []));
    arr.push(o);
  }
  gridWorldSeed = world.seed;
}

function nearbyObstacles(world: World, p: V2): { pos: V2; radius: number }[] {
  if (!obstacleGrid || gridWorldSeed !== world.seed) buildGrid(world);
  const cx = Math.floor(p.x / CELL);
  const cz = Math.floor(p.z / CELL);
  const out: { pos: V2; radius: number }[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const arr = obstacleGrid!.get(`${cx + dx},${cz + dz}`);
      if (arr) out.push(...arr);
    }
  }
  return out;
}

export interface MoveOptions {
  speed: number;
  /** Water slows non-aquatic walkers. */
  aquatic?: boolean;
  avoidWater?: boolean;
  separationRadius?: number;
}

/**
 * Step an agent toward a target. Returns remaining distance to the target.
 * Mutates pos/heading/speed.
 */
export function stepToward(world: World, agent: AgentCommon, target: V2, dt: number, opts: MoveOptions): number {
  const d = dist(agent.pos, target);
  if (d < 0.05) {
    agent.speed = 0;
    return d;
  }
  const desired = angleTo(agent.pos, target);
  agent.heading = lerpAngle(agent.heading, desired, 1 - Math.exp(-8 * dt));

  let speed = opts.speed;
  const inWater = isWater(agent.pos.x, agent.pos.z);
  if (inWater && !opts.aquatic) speed *= 0.45;
  if (d < 2.5) speed *= Math.max(0.35, d / 2.5); // arrival slowdown

  let nx = agent.pos.x + Math.sin(agent.heading) * speed * dt;
  let nz = agent.pos.z + Math.cos(agent.heading) * speed * dt;

  // Obstacle push-out (trees, boulders).
  for (const o of nearbyObstacles(world, agent.pos)) {
    const ox = nx - o.pos.x;
    const oz = nz - o.pos.z;
    const od = Math.hypot(ox, oz);
    const min = o.radius + 0.5;
    if (od < min && od > 0.001) {
      const push = (min - od) / od;
      nx += ox * push;
      nz += oz * push;
    }
  }

  // Neighbor separation — prevents stacking/vibration between agents.
  const sep = opts.separationRadius ?? 0.9;
  for (const other of world.settlers) {
    if (other === agent) continue;
    separate(other.pos);
  }
  for (const other of world.creatures) {
    if (other === agent) continue;
    separate(other.pos);
  }
  function separate(op: V2) {
    const sx = nx - op.x;
    const sz = nz - op.z;
    const sd = sx * sx + sz * sz;
    if (sd < sep * sep && sd > 0.0001) {
      const l = Math.sqrt(sd);
      const push = ((sep - l) / l) * 0.35;
      nx += sx * push;
      nz += sz * push;
    }
  }

  // Aquatic creatures stay in the water; walkers optionally refuse to enter it.
  if (opts.aquatic && !isWater(nx, nz)) {
    agent.speed = 0;
    return d;
  }
  if (opts.avoidWater && isWater(nx, nz) && !inWater) {
    // Slide along the bank instead of entering.
    const side = agent.heading + Math.PI / 2;
    nx = agent.pos.x + Math.sin(side) * speed * dt * 0.6;
    nz = agent.pos.z + Math.cos(side) * speed * dt * 0.6;
    if (isWater(nx, nz)) {
      agent.speed = 0;
      return d;
    }
  }

  // Keep everyone inside the valley.
  const r = Math.hypot(nx, nz);
  if (r > WORLD.playRadius) {
    const s = WORLD.playRadius / r;
    nx *= s;
    nz *= s;
  }

  agent.pos.x = nx;
  agent.pos.z = nz;
  agent.speed = speed;
  return dist(agent.pos, target);
}

export function stand(agent: AgentCommon): void {
  agent.speed = 0;
}

/**
 * Global presence pass: resolve residual overlap between every pair of
 * agents, including stationary ones. `stepToward` only separates the agent
 * that is moving, so without this two idle or conversing settlers can end up
 * occupying the same spot and read as a single glitching body.
 */
export function separateAgents(world: World, dt: number): void {
  const all: AgentCommon[] = [];
  for (const s of world.settlers) all.push(s);
  for (const c of world.creatures) {
    // Aquatic and hovering creatures share no ground space with walkers.
    const def = CREATURE_SPECIES_BY_ID[c.speciesId];
    if (def.aquatic || def.hover) continue;
    all.push(c);
  }

  const strength = Math.min(1, dt * 12);
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    const ra = radiusOf(a);
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j];
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz;
      const min = ra + radiusOf(b);
      if (d2 >= min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = ((min - d) / d) * 0.5 * strength;
      a.pos.x -= dx * push;
      a.pos.z -= dz * push;
      b.pos.x += dx * push;
      b.pos.z += dz * push;
    }
  }
}

function radiusOf(a: AgentCommon): number {
  if (a.kind === 'settler') return SETTLER.bodyRadius;
  const def = CREATURE_SPECIES_BY_ID[a.speciesId];
  return Math.max(0.25, def.scale * 0.35);
}
