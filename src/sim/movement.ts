import { WORLD } from './config';
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
