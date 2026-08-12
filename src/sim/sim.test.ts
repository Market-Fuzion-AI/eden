import { describe, expect, it } from 'vitest';
import { DAY_SEC, PLAYER, SIM_DT, WILDLIFE } from './config';
import { buildExchange } from './dialogue';
import { playerTalk } from './player';
import { CREATURE_SPECIES_BY_ID, SETTLER_ROSTER } from './species';
import { buildSummary, snapshot } from './summary';
import { createWorld } from './worldgen';
import { simTick } from './simulation';
import type { GoalType, World } from './types';
import { dist } from './vec';

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

/**
 * Every goal an agent is allowed to be in.
 *
 * Kept as an exhaustive `Record<GoalType, true>` rather than a hand-written
 * list: a bare Set silently rotted behind the type as milestones added goals,
 * and only failed years later when a run happened to sample the new one at the
 * wrong moment. This form makes the compiler reject the omission instead.
 */
const VALID_GOAL_MAP: Record<GoalType, true> = {
  idle: true, eat: true, rest: true, explore: true, socialize: true, wander: true,
  graze: true, flee: true, investigate: true, 'watch-emerson': true, 'approach-food': true,
  'follow-emerson': true, 'attack-player': true, 'talk-emerson': true, 'seek-friend': true,
  confront: true, avoid: true, 'share-food': true, 'gather-wood': true, 'gather-stone': true,
  build: true, 'help-build': true, 'gather-at-fire': true, 'ask-to-use': true,
};
const VALID_GOALS = new Set(Object.keys(VALID_GOAL_MAP));

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
    expect(world.settlers.length).toBe(SETTLER_ROSTER.length);
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

  it('keeps agents from overlapping each other', () => {
    const world = createWorld(31337);
    run(world, 900);
    const walkers = [
      ...world.settlers,
      ...world.creatures.filter((c) => {
        const def = CREATURE_SPECIES_BY_ID[c.speciesId];
        return !def.aquatic && !def.hover;
      }),
    ];
    let worstOverlap = 0;
    for (let i = 0; i < walkers.length; i++) {
      for (let j = i + 1; j < walkers.length; j++) {
        const d = dist(walkers[i].pos, walkers[j].pos);
        worstOverlap = Math.max(worstOverlap, 0.5 - d);
      }
    }
    // No two bodies may share the same half-metre of ground.
    expect(worstOverlap).toBeLessThan(0.12);
  });
});

describe('social chronicle events', () => {
  it('carry structured who / where / why / what-changed payloads', () => {
    const world = createWorld(777);
    run(world, 2400);
    const social = world.chronicle.find((e) => e.category === 'social');
    expect(social, 'a conversation should have been recorded').toBeDefined();
    expect(social!.actorIds?.length).toBe(2);
    expect(social!.actorNames?.length).toBe(2);
    expect(social!.pos).toBeDefined();
    expect(social!.place).toBeTruthy();
    expect(social!.cause?.length).toBeGreaterThan(2);
    expect(social!.effects?.length).toBeGreaterThan(1);
    // Participants must still be resolvable entities.
    for (const id of social!.actorIds!) {
      expect(world.settlers.some((s) => s.id === id)).toBe(true);
    }
  });

  it('references real place names', () => {
    const world = createWorld(2024);
    run(world, 1800);
    const located = world.chronicle.filter((e) => e.place);
    expect(located.length).toBeGreaterThan(0);
    for (const e of located) expect(e.place).not.toContain('undefined');
  });
});

describe('talking to Emerson', () => {
  it('stops the settler, moves the relationship, and creates a memory', () => {
    const world = createWorld(5150);
    run(world, 120);
    const target = world.settlers[0];
    // Stand Emerson next to them.
    world.player.pos.x = target.pos.x + 1.2;
    world.player.pos.z = target.pos.z;

    const before = target.relationships.emerson?.affinity ?? 0;
    const exchange = playerTalk(world);

    expect(exchange, 'an exchange should be produced').not.toBeNull();
    expect(exchange!.lines.length).toBeGreaterThan(0);
    expect(exchange!.lines.length).toBeLessThanOrEqual(3);
    expect(exchange!.firstMeeting).toBe(true);
    expect(target.goal.type).toBe('talk-emerson');
    expect(target.relationships.emerson.affinity).toBeGreaterThan(before);
    expect(target.memories.some((m) => m.type === 'talked_to_emerson')).toBe(true);
    expect(world.chronicle.some((e) => e.text.includes(`Emerson spoke with ${target.name}`))).toBe(true);

    // They hold still for the conversation, then resume their own life.
    run(world, 2);
    expect(target.speed).toBe(0);
    run(world, PLAYER.talkDuration + 4);
    expect(target.goal.type).not.toBe('talk-emerson');
  });

  it('never produces empty or malformed lines for any settler', () => {
    const world = createWorld(4242);
    run(world, 600);
    for (const s of world.settlers) {
      const ex = buildExchange(world, s);
      expect(ex.lines.length).toBeGreaterThan(0);
      for (const line of ex.lines) {
        expect(line.text.trim().length).toBeGreaterThan(0);
        expect(line.text).not.toContain('undefined');
        expect(line.text).not.toContain('NaN');
      }
    }
  });
});

describe('temporal summary', () => {
  it('reports only real, non-negative change derived from simulation state', () => {
    const world = createWorld(8080);
    run(world, 60);
    const before = snapshot(world);
    run(world, DAY_SEC * 1.5);
    const summary = buildSummary(world, before);

    expect(summary).not.toBeNull();
    expect(summary!.elapsedLabel).toMatch(/DAY|HOUR/);
    for (const line of [...summary!.populationLines, ...summary!.eventLines]) {
      expect(line.value).not.toContain('undefined');
      expect(line.value).not.toContain('NaN');
    }
    const rel = summary!.eventLines.find((l) => l.label === 'New relationships')!;
    expect(Number(rel.value)).toBeGreaterThanOrEqual(0);
    // Settler count is stable in v0.2 (no births, no settler deaths).
    expect(summary!.populationLines[0].value).toBe(String(SETTLER_ROSTER.length));
  });

  it('declines to report a period too short to matter', () => {
    const world = createWorld(8081);
    const before = snapshot(world);
    run(world, 20);
    expect(buildSummary(world, before)).toBeNull();
  });
});
