import { describe, expect, it } from 'vitest';
import { SIM_DT, WILDLIFE } from './config';
import { createWorld } from './worldgen';
import { simTick } from './simulation';
import type { World } from './types';

/**
 * Headless validation: the simulation must run for a long stretch of sim time
 * without NaNs, runaway populations, invalid goals or unbounded logs — and
 * autonomous behavior (eating, resting, socializing, discovery) must actually
 * happen without any player involvement.
 */

function run(world: World, simSeconds: number): void {
  const ticks = Math.ceil(simSeconds / SIM_DT);
  for (let i = 0; i < ticks; i++) {
    simTick(world, SIM_DT);
    // ARI queue is drained by the game loop in the app; emulate that here.
    if (world.ariQueue.length > 8) world.ariQueue.length = 0;
  }
}

const VALID_GOALS = new Set([
  'idle', 'eat', 'rest', 'explore', 'socialize', 'wander', 'graze', 'flee',
  'investigate', 'watch-emerson', 'approach-food', 'follow-emerson', 'attack-player',
]);

describe('EDEN simulation', () => {
  it('runs 40 sim-minutes without corrupting state', async () => {
    const world = createWorld(12345);
    run(world, 2400);

    for (const a of [...world.settlers, ...world.creatures]) {
      expect(Number.isFinite(a.pos.x), `${a.name} pos.x finite`).toBe(true);
      expect(Number.isFinite(a.pos.z), `${a.name} pos.z finite`).toBe(true);
      expect(Number.isFinite(a.hunger) && a.hunger >= 0 && a.hunger <= 100, `${a.name} hunger sane`).toBe(true);
      expect(Number.isFinite(a.energy) && a.energy >= 0 && a.energy <= 100, `${a.name} energy sane`).toBe(true);
      expect(Number.isFinite(a.health), `${a.name} health finite`).toBe(true);
      expect(Math.hypot(a.pos.x, a.pos.z)).toBeLessThanOrEqual(200);
      expect(VALID_GOALS.has(a.goal.type), `${a.name} valid goal ${a.goal.type}`).toBe(true);
    }
    expect(world.settlers.length).toBe(21);
    // Camps sit on dry land.
    const { isWater } = await import('./terrain');
    for (const camp of world.camps) {
      expect(isWater(camp.pos.x, camp.pos.z), `${camp.label} on land`).toBe(false);
    }
    // Replication is bounded.
    expect(world.creatures.length).toBeLessThanOrEqual(WILDLIFE.globalCreatureCap);
    // Chronicle bounded and populated.
    expect(world.chronicle.length).toBeGreaterThan(2);
    expect(world.chronicle.length).toBeLessThanOrEqual(250);
  });

  it('produces autonomous behavior: eating, resting, socializing, discovery', () => {
    const world = createWorld(777);
    run(world, 2400);

    const memories = world.settlers.flatMap((s) => s.memories.map((m) => m.type));
    expect(memories).toContain('ate');
    const rested = world.settlers.some((s) => s.memories.some((m) => m.type === 'rested') || s.resting);
    expect(rested).toBe(true);
    const socialized = world.settlers.some((s) => Object.keys(s.relationships).length > 0);
    expect(socialized).toBe(true);
    // Someone discovered something they didn't start with.
    const discoveries = world.chronicle.filter((e) => e.category === 'discovery');
    expect(discoveries.length).toBeGreaterThan(0);
    // Lumi still exists and remains a unique individual.
    const lumi = world.creatures.find((c) => c.id === 'lumi');
    expect(lumi).toBeDefined();
    expect(lumi!.lumi!.trust).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic for a given seed', () => {
    const a = createWorld(4242);
    const b = createWorld(4242);
    run(a, 600);
    run(b, 600);
    expect(a.chronicle.map((e) => e.text)).toEqual(b.chronicle.map((e) => e.text));
    for (let i = 0; i < a.settlers.length; i++) {
      expect(a.settlers[i].pos.x).toBeCloseTo(b.settlers[i].pos.x, 8);
      expect(a.settlers[i].goal.type).toBe(b.settlers[i].goal.type);
    }
  });

  it('keeps distinct personalities across individuals of a species', () => {
    const world = createWorld(999);
    const humans = world.settlers.filter((s) => s.speciesId === 'human');
    const curiosities = new Set(humans.map((h) => h.personality.curiosity.toFixed(3)));
    expect(curiosities.size).toBeGreaterThan(1);
  });
});
