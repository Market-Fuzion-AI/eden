import { describe, expect, it } from 'vitest';
import { PLAYER, WORLD } from './config';
import { courseSpan, courseStart, distToCourse, propTop, resetToCourseStart, standingHeight } from './course';
import { moveTelemetry, updatePlayer, type PlayerInput } from './player';
import { groundY, isWalkable, isWater, slopeAt } from './terrain';
import type { World } from './types';
import { createWorld } from './worldgen';

/**
 * Gate 1: does Kai move the way the player meant?
 *
 * These are the machine half of the answer — the half that can say "the jump
 * clears 1.05 m" and "walking into a boulder stops you rather than shoving you
 * through it". Whether any of it *feels* right is a question only a human
 * playing it can settle, and this file makes no claim about that.
 */

const DT = 1 / 60;

const NOTHING: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false, camYaw: 0 };

/**
 * Advance the player.
 *
 * `world.timeSec` moves too, because coyote time and the jump buffer are
 * absolute deadlines: a probe that leaves the clock frozen quietly grants
 * infinite coyote time and proves nothing.
 */
function step(world: World, seconds: number, input: Partial<PlayerInput> = {}): void {
  const ticks = Math.max(1, Math.round(seconds / DT));
  for (let i = 0; i < ticks; i++) {
    world.timeSec += DT;
    updatePlayer(world, DT, { ...NOTHING, ...input });
  }
}

/** Flat, dry, unobstructed ground to test plain walking on. */
function flatGround(world: World): { x: number; z: number } {
  for (let ring = 60; ring < 150; ring += 6) {
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const p = { x: Math.sin(a) * ring, z: Math.cos(a) * ring };
      if (Math.hypot(p.x, p.z) > WORLD.playRadius - 30) continue;
      if (isWater(p.x, p.z) || !isWalkable(p.x, p.z)) continue;
      if (slopeAt(p.x, p.z) > 0.06) continue;
      if (world.obstacles.some((o) => Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < o.radius + 8)) continue;
      if (world.settlers.some((s) => Math.hypot(s.pos.x - p.x, s.pos.z - p.z) < 8)) continue;
      return p;
    }
  }
  throw new Error('no flat ground found');
}

/** Drop the player onto a spot, at rest. */
function placeAt(world: World, x: number, z: number): void {
  const p = world.player;
  p.pos = { x, z };
  p.y = standingHeight(world, x, z, 999);
  p.vy = 0;
  p.onGround = true;
  p.speed = 0;
  p.moveSpeed = 0;
  p.stamina = 100;
  p.jumpHeld = false;
  p.jumpBufferedUntil = 0;
  p.coyoteUntil = 0;
  p.dodgeTimer = 0;
  p.dodgeCooldown = 0;
  p.strike = null;
}

describe('walking', () => {
  it('accelerates into a walk instead of snapping to full speed', () => {
    const world = createWorld(5101);
    const g = flatGround(world);
    placeAt(world, g.x, g.z);

    step(world, DT, { moveZ: 1 });
    const first = world.player.moveSpeed;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(PLAYER.walkSpeed * 0.5);

    step(world, 0.6, { moveZ: 1 });
    expect(world.player.moveSpeed).toBeGreaterThan(PLAYER.walkSpeed * 0.95);
    expect(world.player.moveSpeed).toBeLessThanOrEqual(PLAYER.walkSpeed + 0.01);
  });

  it('coasts to a stop rather than halting dead', () => {
    const world = createWorld(5102);
    const g = flatGround(world);
    placeAt(world, g.x, g.z);
    step(world, 1, { moveZ: 1 });
    const running = world.player.moveSpeed;

    step(world, DT * 2);
    expect(world.player.moveSpeed).toBeGreaterThan(0);
    expect(world.player.moveSpeed).toBeLessThan(running);
    step(world, 1);
    expect(world.player.moveSpeed).toBe(0);
    expect(world.player.speed).toBe(0);
  });

  it('gets going faster than it stops — that is what reads as intent', () => {
    expect(PLAYER.accel).toBeGreaterThan(PLAYER.decel);
  });

  it('sprints meaningfully faster than it walks', () => {
    const world = createWorld(5103);
    const g = flatGround(world);
    placeAt(world, g.x, g.z);
    step(world, 1.2, { moveZ: 1 });
    const walk = world.player.speed;
    step(world, 1.2, { moveZ: 1, sprint: true });
    const sprint = world.player.speed;
    expect(sprint).toBeGreaterThan(walk * 1.4);
    expect(sprint).toBeLessThanOrEqual(PLAYER.sprintSpeed + 0.05);
  });

  it('drains stamina while sprinting and recovers it after', () => {
    const world = createWorld(5104);
    const g = flatGround(world);
    placeAt(world, g.x, g.z);
    step(world, 3, { moveZ: 1, sprint: true });
    const spent = world.player.stamina;
    expect(spent).toBeLessThan(90);
    step(world, 3, { moveZ: 1 });
    expect(world.player.stamina).toBeGreaterThan(spent);
  });

  it('travels the direction the camera is facing, at every yaw', () => {
    const world = createWorld(5105);
    const g = flatGround(world);
    for (const yaw of [0, 1.1, Math.PI / 2, Math.PI, -2.2, 4.6]) {
      placeAt(world, g.x, g.z);
      // Face down-camera first so the turn does not eat the test's travel.
      world.player.heading = yaw;
      step(world, 1, { moveZ: 1, camYaw: yaw });
      const dx = world.player.pos.x - g.x;
      const dz = world.player.pos.z - g.z;
      const travelled = Math.hypot(dx, dz);
      expect(travelled).toBeGreaterThan(1);
      // Forward is (sin yaw, cos yaw): the dot product with travel must be ~1.
      const along = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / travelled;
      expect(along).toBeGreaterThan(0.97);
    }
  });

  it('strafes right for D and left for A, never mirrored', () => {
    // The v0.1 A/D inversion, pinned at the level of actual travel rather than
    // at the level of the heading maths alone.
    const world = createWorld(5106);
    const g = flatGround(world);
    for (const yaw of [0, 0.9, -1.7, 2.9]) {
      placeAt(world, g.x, g.z);
      world.player.heading = yaw - Math.PI / 2;
      step(world, 1, { moveX: 1, camYaw: yaw });
      const dx = world.player.pos.x - g.x;
      const dz = world.player.pos.z - g.z;
      const d = Math.hypot(dx, dz);
      // Screen right is f × up = (-cos yaw, sin yaw).
      const along = (dx * -Math.cos(yaw) + dz * Math.sin(yaw)) / d;
      expect(along, `D went the wrong way at yaw ${yaw}`).toBeGreaterThan(0.9);
    }
  });
});

describe('jumping', () => {
  it('leaves the ground on a press and comes back down', () => {
    const world = createWorld(5201);
    const g = flatGround(world);
    placeAt(world, g.x, g.z);
    const start = world.player.y;

    step(world, DT, { jump: true });
    expect(world.player.onGround).toBe(false);
    expect(world.player.vy).toBeGreaterThan(0);

    let peak = start;
    for (let i = 0; i < 120 && !world.player.onGround; i++) {
      step(world, DT, { jump: true });
      peak = Math.max(peak, world.player.y);
    }
    expect(peak - start).toBeGreaterThan(0.9);
    expect(world.player.onGround).toBe(true);
    expect(world.player.y).toBeCloseTo(start, 2);
  });

  it('gives a lower hop when the key is released early', () => {
    const world = createWorld(5202);
    const g = flatGround(world);

    const apex = (hold: boolean): number => {
      placeAt(world, g.x, g.z);
      const start = world.player.y;
      let peak = start;
      step(world, DT, { jump: true });
      for (let i = 0; i < 120 && !world.player.onGround; i++) {
        step(world, DT, { jump: hold });
        peak = Math.max(peak, world.player.y);
      }
      return peak - start;
    };

    const tapped = apex(false);
    const held = apex(true);
    expect(tapped).toBeGreaterThan(0.2);
    expect(held).toBeGreaterThan(tapped * 1.3);
  });

  it('does not double-jump while the key stays down', () => {
    const world = createWorld(5203);
    const g = flatGround(world);
    placeAt(world, g.x, g.z);
    step(world, DT, { jump: true });
    const rising = world.player.vy;
    step(world, DT * 4, { jump: true });
    // Still the same jump: gravity has only ever reduced the climb.
    expect(world.player.vy).toBeLessThan(rising);
    expect(world.player.vy).toBeGreaterThan(0);
  });

  it('honours a press made just before landing', () => {
    const world = createWorld(5204);
    const g = flatGround(world);
    placeAt(world, g.x, g.z);
    // In the air and falling.
    world.player.onGround = false;
    world.player.vy = -1.2;
    world.player.y += 0.12;
    // Press while still airborne, then release, then land.
    step(world, DT, { jump: true });
    expect(world.player.onGround).toBe(false);
    step(world, DT * 8);
    // The buffered press should have fired on touchdown.
    expect(world.player.onGround).toBe(false);
    expect(world.player.vy).toBeGreaterThan(0);
  });

  it('still jumps just after stepping off a ledge', () => {
    const world = createWorld(5205);
    const g = flatGround(world);
    placeAt(world, g.x, g.z);
    // Walked off something: airborne, but only barely.
    world.player.onGround = false;
    world.player.vy = 0;
    world.player.coyoteUntil = world.timeSec + PLAYER.coyoteTime;
    step(world, DT, { jump: true });
    expect(world.player.vy).toBeGreaterThan(PLAYER.jumpVel * 0.9);
  });

  it('refuses a jump once the coyote window has passed', () => {
    const world = createWorld(5206);
    const g = flatGround(world);
    placeAt(world, g.x, g.z);
    world.player.onGround = false;
    world.player.y += 3;
    world.player.vy = -2;
    world.player.coyoteUntil = 0;
    step(world, DT * 3, { jump: true });
    expect(world.player.vy).toBeLessThan(0);
  });

  it('falls faster than it rises, so the arc is not floaty', () => {
    expect(PLAYER.fallGravityScale).toBeGreaterThan(1);
  });

  it('keeps some steering in the air but not all of it', () => {
    expect(PLAYER.airControl).toBeGreaterThan(0.2);
    expect(PLAYER.airControl).toBeLessThan(1);
  });
});

describe('ground and geometry', () => {
  it('walks off a ledge instead of teleporting down it', () => {
    const world = createWorld(5301);
    const block = world.course.find((p) => p.kind === 'block' && p.height > 1.2)!;
    const top = propTop(block);
    // Standing on top, then step off the edge.
    placeAt(world, block.pos.x, block.pos.z);
    world.player.y = top;
    world.player.onGround = true;
    const heading = Math.atan2(block.pos.x, block.pos.z);
    world.player.heading = heading;
    step(world, 0.5, { moveZ: 1, camYaw: heading });
    // Either still up there or genuinely falling — never instantly at ground level.
    if (!world.player.onGround) expect(world.player.vy).toBeLessThanOrEqual(0);
    expect(world.player.y).toBeGreaterThan(groundY(world.player.pos.x, world.player.pos.z) - 0.01);
  });

  it('stands on a course platform rather than inside it', () => {
    const world = createWorld(5302);
    const pad = world.course.find((p) => p.kind === 'pad')!;
    const top = propTop(pad);
    placeAt(world, pad.pos.x, pad.pos.z);
    expect(world.player.y).toBeCloseTo(top, 2);
    step(world, 0.3);
    expect(world.player.y).toBeCloseTo(top, 2);
    expect(world.player.onGround).toBe(true);
  });

  it('treats a low pad as a step and a tall block as a wall', () => {
    const world = createWorld(5303);
    const pad = world.course.find((p) => p.kind === 'pad' && p.height < 0.42)!;
    const wall = world.course.find((p) => p.kind === 'block' && p.height > 0.42)!;
    const feet = groundY(pad.pos.x, pad.pos.z);
    // The pad supports him from the ground; the block does not.
    expect(standingHeight(world, pad.pos.x, pad.pos.z, feet)).toBeCloseTo(propTop(pad), 2);
    expect(standingHeight(world, wall.pos.x, wall.pos.z, groundY(wall.pos.x, wall.pos.z))).toBeCloseTo(
      groundY(wall.pos.x, wall.pos.z),
      2,
    );
  });

  it('lets a jump reach the top of the block that has to be jumped', () => {
    const world = createWorld(5304);
    const block = world.course.find((p) => p.kind === 'block' && p.height > 1 && p.height < 1.2)!;
    const rise = (PLAYER.jumpVel * PLAYER.jumpVel) / (2 * PLAYER.gravity);
    expect(rise).toBeGreaterThan(block.height + PLAYER.stepHeight * 0.2);
  });

  it('is stopped by a boulder, not pushed through it', () => {
    const world = createWorld(5305);
    const rock = world.obstacles.find((o) => o.radius > 1 && !isWater(o.pos.x, o.pos.z))!;
    // Approach from due south of it.
    const startZ = rock.pos.z - (rock.radius + 4);
    placeAt(world, rock.pos.x, startZ);
    world.player.heading = 0;
    step(world, 2.5, { moveZ: 1, camYaw: 0 });
    const d = Math.hypot(world.player.pos.x - rock.pos.x, world.player.pos.z - rock.pos.z);
    expect(d).toBeGreaterThan(rock.radius + PLAYER.bodyRadius - 0.15);
  });

  it('slides along a steep face rather than sticking to it', () => {
    const world = createWorld(5306);
    // Find genuinely steep walkable-adjacent ground.
    let steep: { x: number; z: number } | null = null;
    for (let r = 40; r < 170 && !steep; r += 5) {
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const p = { x: Math.sin(a) * r, z: Math.cos(a) * r };
        if (isWater(p.x, p.z)) continue;
        if (slopeAt(p.x, p.z) > 0.9) {
          steep = p;
          break;
        }
      }
    }
    if (!steep) return; // no cliff in this world; nothing to assert
    placeAt(world, steep.x, steep.z);
    // Walk uphill, diagonally.
    const e = 0.6;
    const gx = groundY(steep.x + e, steep.z) - groundY(steep.x - e, steep.z);
    const gz = groundY(steep.x, steep.z + e) - groundY(steep.x, steep.z - e);
    const uphill = Math.atan2(gx, gz);
    world.player.heading = uphill + 0.7;
    step(world, 2, { moveZ: 1, camYaw: uphill + 0.7 });
    const moved = Math.hypot(world.player.pos.x - steep.x, world.player.pos.z - steep.z);
    // Not pinned in place: some travel happened, along the slope if not up it.
    expect(moved).toBeGreaterThan(0.4);
  });

  it('never produces a NaN position, height or velocity', () => {
    const world = createWorld(5307);
    const g = flatGround(world);
    placeAt(world, g.x, g.z);
    for (let i = 0; i < 600; i++) {
      const a = (i / 37) * Math.PI * 2;
      step(world, DT, {
        moveX: Math.sin(a),
        moveZ: Math.cos(a),
        sprint: i % 3 === 0,
        jump: i % 17 === 0,
        camYaw: a,
      });
    }
    const p = world.player;
    for (const v of [p.pos.x, p.pos.z, p.y, p.vy, p.speed, p.moveSpeed, p.heading]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('the 3Cs course', () => {
  it('is laid out in front of Human Landing, on land, inside the play area', () => {
    const world = createWorld(5401);
    expect(world.course.length).toBeGreaterThan(10);
    for (const prop of world.course) {
      expect(Math.hypot(prop.pos.x, prop.pos.z)).toBeLessThan(WORLD.playRadius - 10);
      expect(isWater(prop.pos.x, prop.pos.z)).toBe(false);
    }
    const camp = world.camps.find((c) => c.speciesId === 'human')!;
    const start = courseStart(world);
    const walk = Math.hypot(start.x - camp.pos.x, start.z - camp.pos.z);
    expect(walk).toBeGreaterThan(15);
    expect(walk).toBeLessThan(60);
  });

  it('offers every traversal situation the gate needs', () => {
    const world = createWorld(5402);
    const kinds = new Set(world.course.map((p) => p.kind));
    for (const k of ['marker', 'rock', 'pad', 'block', 'plank']) expect(kinds.has(k as never)).toBe(true);
    // Something to walk onto, something that must be jumped.
    expect(world.course.some((p) => p.height <= PLAYER.stepHeight && p.kind !== 'marker')).toBe(true);
    expect(world.course.some((p) => p.height > PLAYER.stepHeight && p.kind === 'block')).toBe(true);
  });

  it('resets to the start without restarting the world', () => {
    const world = createWorld(5403);
    const before = {
      t: world.timeSec,
      settlers: world.settlers.length,
      creatures: world.creatures.length,
      chronicle: world.chronicle.length,
    };
    world.player.pos = { x: 0, z: 0 };
    world.player.y = 40;
    world.player.vy = -9;
    world.player.moveSpeed = 5;

    resetToCourseStart(world);
    const start = courseStart(world);
    expect(world.player.pos.x).toBeCloseTo(start.x, 4);
    expect(world.player.pos.z).toBeCloseTo(start.z, 4);
    expect(world.player.vy).toBe(0);
    expect(world.player.onGround).toBe(true);
    expect(world.player.y).toBeCloseTo(groundY(start.x, start.z), 4);
    // The valley is untouched — a QA reset is not a new game.
    expect(world.timeSec).toBe(before.t);
    expect(world.settlers.length).toBe(before.settlers);
    expect(world.creatures.length).toBe(before.creatures);
    expect(world.chronicle.length).toBe(before.chronicle);
  });

  it('faces down the run after a reset', () => {
    const world = createWorld(5404);
    resetToCourseStart(world);
    const { a, b } = courseSpan(world);
    const toEnd = Math.atan2(b.x - a.x, b.z - a.z);
    let err = (world.player.heading - toEnd) % (Math.PI * 2);
    if (err > Math.PI) err -= Math.PI * 2;
    if (err < -Math.PI) err += Math.PI * 2;
    expect(Math.abs(err)).toBeLessThan
      (0.4);
  });

  it('keeps the run clear of scenery, prompts and danger', () => {
    for (const seed of [5405, 11, 777, 31337]) {
      const world = createWorld(seed);
      // Nothing growing on it, and no collision without something to see.
      for (const f of world.flora) expect(distToCourse(world, f.pos)).toBeGreaterThan(7);
      for (const o of world.obstacles) {
        const isProp = world.course.some((c) => Math.hypot(c.pos.x - o.pos.x, c.pos.z - o.pos.z) < 0.01);
        if (isProp) continue;
        const visible = world.flora.some((f) => Math.hypot(f.pos.x - o.pos.x, f.pos.z - o.pos.z) < 0.01);
        if (!visible) expect(distToCourse(world, o.pos)).toBeGreaterThan(7);
      }
      // No gather prompts firing mid-stride.
      for (const r of world.resources) expect(distToCourse(world, r.pos)).toBeGreaterThan(5);
      // And nothing hostile close enough to ever notice a player testing movement.
      for (const c of world.creatures) {
        if (!c.combat) continue;
        expect(distToCourse(world, c.combat.territory)).toBeGreaterThan(30);
      }
    }
  });
});

describe('movement telemetry', () => {
  it('reports contact when Kai is pressed against a boulder', () => {
    const world = createWorld(5501);
    const rock = world.obstacles.find((o) => o.radius > 1 && !isWater(o.pos.x, o.pos.z))!;
    placeAt(world, rock.pos.x, rock.pos.z - (rock.radius + 1));
    world.player.heading = 0;
    step(world, 1.5, { moveZ: 1, camYaw: 0 });
    expect(moveTelemetry.contacts).toBeGreaterThan(0);
    expect(moveTelemetry.blocked).toBeGreaterThan(0.2);
  });

  it('reports a clear run on open ground', () => {
    const world = createWorld(5502);
    const g = flatGround(world);
    placeAt(world, g.x, g.z);
    step(world, 1, { moveZ: 1 });
    expect(moveTelemetry.contacts).toBe(0);
    expect(moveTelemetry.blocked).toBeLessThan(0.05);
  });
});
