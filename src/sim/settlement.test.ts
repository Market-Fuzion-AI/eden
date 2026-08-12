import { describe, expect, it } from 'vitest';
import { SIM_DT, STRUCT } from './config';
import { findHelpCandidate, nextMaterialNeed } from './goals';
import { applyRelationship } from './relationships';
import { simTick } from './simulation';
import {
  applyWork,
  chooseBuildSite,
  createProject,
  deliveredFraction,
  detectSettlements,
  STRUCTURE_DEFS,
} from './structures';
import { buildSummary, snapshot } from './summary';
import { heightAt, setTerrainSeed } from './terrain';
import { createWorld } from './worldgen';
import type { World } from './types';
import { dist } from './vec';
import { SETTLER_ROSTER } from './species';

/**
 * The v0.4 thesis: NEEDS + RELATIONSHIPS + RESOURCES SHOULD CREATE PLACE.
 *
 * These prove settlement emerges from the existing systems rather than being
 * scripted, and that it stays bounded and safe over long runs.
 */

function run(world: World, simSeconds: number): void {
  const ticks = Math.ceil(simSeconds / SIM_DT);
  for (let i = 0; i < ticks; i++) {
    simTick(world, SIM_DT);
    if (world.ariQueue.length > 8) world.ariQueue.length = 0;
  }
}

const DAY = 720;

/** A world run long enough for a settlement to form — shared by several tests. */
let settled: World | null = null;
function settledWorld(): World {
  if (!settled) {
    settled = createWorld(4242);
    run(settled, DAY * 8);
  }
  return settled;
}

describe('resource gathering has a reason', () => {
  it('settlers do not gather construction materials without a project', () => {
    const world = createWorld(70);
    run(world, 400);
    for (const s of world.settlers) {
      if (s.buildPlan) continue;
      const carrying = s.inventory.wood + s.inventory.stone;
      // Without a project there is nothing to gather *for*, so any wood or
      // stone in hand is left over from a finished one — never hoarded.
      expect(carrying, `${s.name} hoarding ${carrying}`).toBeLessThanOrEqual(STRUCT.carryCapacity);
      if (s.goal.type === 'gather-wood' || s.goal.type === 'gather-stone') {
        expect(s.buildPlan, `${s.name} gathering with no plan`).not.toBeNull();
      }
    }
  });

  it('never asks for more than one load at a time', () => {
    const world = createWorld(71);
    const s = world.settlers[0];
    const site = chooseBuildSite(world, s, 'shelter')!;
    const st = createProject(world, s, 'shelter', site.pos, ['test'], site.reason);
    // A shelter needs more wood than anyone can carry.
    expect(st.required.wood).toBeGreaterThan(STRUCT.carryCapacity);
    s.inventory.wood = STRUCT.carryCapacity;
    s.inventory.stone = st.required.stone;
    // With a full load they must go and deliver, not keep gathering forever.
    expect(nextMaterialNeed(world, s, st)).toBeNull();
  });

  it('caps carried materials at the trip capacity', () => {
    const world = settledWorld();
    for (const s of world.settlers) {
      expect(s.inventory.wood).toBeLessThanOrEqual(STRUCT.carryCapacity + 0.5);
      expect(s.inventory.stone).toBeLessThanOrEqual(STRUCT.carryCapacity + 0.5);
    }
  });
});

describe('construction consumes real resources', () => {
  it('progress can never outrun delivered materials', () => {
    const world = createWorld(72);
    // A Veyra builder: Human Landing now starts with a lit colony hearth, and
    // campfire spacing rightly refuses a second fire beside it.
    const s = world.settlers.find((x) => x.speciesId === 'veyra')!;
    const site = chooseBuildSite(world, s, 'campfire')!;
    const st = createProject(world, s, 'campfire', site.pos, ['test'], site.reason);
    expect(deliveredFraction(st)).toBe(0);

    // Wood delivered but no stone: at most a partial build, however long
    // anyone labours. Applied directly so the invariant is tested rather than
    // the surrounding world's willingness to leave the site alone.
    st.contributed.wood = st.required.wood;
    const cap = deliveredFraction(st);
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThan(1);

    for (let i = 0; i < 5000; i++) applyWork(world, st, s, SIM_DT);
    expect(st.progress).toBeLessThanOrEqual(cap + 1e-9);

    // Delivering the rest lifts the ceiling.
    st.contributed.stone = st.required.stone;
    expect(deliveredFraction(st)).toBe(1);
    for (let i = 0; i < 5000; i++) applyWork(world, st, s, SIM_DT);
    expect(st.progress).toBeCloseTo(1, 5);
  });

  it('draws material out of the world, not from nowhere', () => {
    const world = settledWorld();
    const built = world.structures.filter((s) => s.state === 'complete');
    expect(built.length).toBeGreaterThan(0);
    for (const st of built) {
      expect(st.contributed.wood).toBeGreaterThanOrEqual(st.required.wood);
      expect(st.contributed.stone).toBeGreaterThanOrEqual(st.required.stone);
      // Every unit is attributed to somebody.
      const wood = st.contributions.reduce((sum, c) => sum + c.wood, 0);
      expect(Math.round(wood)).toBe(Math.round(st.contributed.wood));
    }
  });

  it('unfinished structures persist rather than vanishing', () => {
    const world = createWorld(73);
    const s = world.settlers[0];
    const site = chooseBuildSite(world, s, 'shelter')!;
    const st = createProject(world, s, 'shelter', site.pos, ['test'], site.reason);
    st.lastWorkAt = world.timeSec;
    const id = st.id;
    // Make it far too large to finish inside the window, so this measures
    // persistence rather than how industrious the settlers happen to be.
    st.required = { wood: 5000, stone: 5000 };
    // Keep it "touched" so the abandonment sweep leaves it alone.
    for (let i = 0; i < 40; i++) {
      run(world, 60);
      st.lastWorkAt = world.timeSec;
      const live = world.structures.find((o) => o.id === id);
      expect(live, 'an in-progress site must never silently disappear').toBeDefined();
      expect(live!.state).toBe('under-construction');
      expect(live!.progress).toBeLessThan(1);
    }
  });
});

describe('cooperation', () => {
  it('weighs relationship with the initiator when deciding to help', () => {
    const world = createWorld(74);
    const [initiator, friend] = world.settlers;
    const stranger = world.settlers[2];
    for (const s of [initiator, friend, stranger]) {
      s.pos = { x: 0, z: 0 };
      s.hunger = 15;
      s.energy = 90;
      s.buildPlan = null;
    }
    initiator.pos = { x: 0, z: 0 };
    friend.pos = { x: 12, z: 0 };
    stranger.pos = { x: 12, z: 0 };
    // Same personality so only the relationship differs.
    friend.personality.empathy = 0.55;
    stranger.personality.empathy = 0.55;

    const site = chooseBuildSite(world, initiator, 'shelter')!;
    const st = createProject(world, initiator, 'shelter', site.pos, ['test'], site.reason);
    friend.knownStructureIds.push(st.id);
    stranger.knownStructureIds.push(st.id);
    friend.pos = { ...st.pos };
    stranger.pos = { ...st.pos };

    applyRelationship(world, friend, initiator.id, initiator.name, 'gift', 'Fed me once', {
      affinity: 70,
      trust: 65,
      familiarity: 60,
    });

    const friendHelp = findHelpCandidate(world, friend);
    const strangerHelp = findHelpCandidate(world, stranger);
    expect(friendHelp, 'a trusted friend should want to help').not.toBeNull();
    expect(friendHelp!.score).toBeGreaterThan(strangerHelp?.score ?? 0);
    // And the reason must name the relationship.
    expect(friendHelp!.mods.map((m) => m.label).join(' | ')).toMatch(/Trust with|Affinity/);
  });

  it('refuses to help someone it resents', () => {
    const world = createWorld(75);
    // Away from the pre-built colony hearth, which blocks campfire sites.
    const veyra = world.settlers.filter((x) => x.speciesId === 'veyra');
    const [initiator, hostile] = veyra;
    hostile.hunger = 15;
    hostile.energy = 90;
    const site = chooseBuildSite(world, initiator, 'campfire')!;
    const st = createProject(world, initiator, 'campfire', site.pos, ['test'], site.reason);
    hostile.knownStructureIds.push(st.id);
    hostile.pos = { ...st.pos };
    applyRelationship(world, hostile, initiator.id, initiator.name, 'conflict', 'Bad blood', {
      affinity: -70,
      fear: 30,
    });
    expect(findHelpCandidate(world, hostile)).toBeNull();
  });

  it('produces genuinely cooperative builds in an unguided world', () => {
    const world = settledWorld();
    const cooperative = world.structures.filter(
      (s) => s.state === 'complete' && s.contributions.length > 1,
    );
    expect(cooperative.length, 'someone should have helped someone').toBeGreaterThan(0);
    expect(
      world.chronicle.some((e) => e.category === 'settlement' && e.text.includes('with help from')),
    ).toBe(true);
  });
});

describe('structures change behaviour', () => {
  it('completed shelters are actually used for rest', () => {
    const world = settledWorld();
    const shelters = world.structures.filter((s) => s.type === 'shelter' && s.state === 'complete');
    expect(shelters.length, 'at least one shelter should exist').toBeGreaterThan(0);
    expect(shelters.some((s) => s.useCount > 0), 'a shelter should have been slept in').toBe(true);
    const sleptWell = world.settlers.some((s) => s.memories.some((m) => m.type === 'rested_in_shelter'));
    expect(sleptWell).toBe(true);
  });

  it('campfires draw people together after dark', () => {
    const world = settledWorld();
    const fires = world.structures.filter((s) => s.type === 'campfire' && s.state === 'complete');
    expect(fires.length).toBeGreaterThan(0);
    expect(fires.some((f) => f.usage.length >= 2), 'a fire should have several regulars').toBe(true);
  });

  it('does not force everyone onto a single campfire', () => {
    const world = settledWorld();
    const fires = world.structures.filter((s) => s.type === 'campfire' && s.state === 'complete');
    if (fires.length < 2) return; // only meaningful with a choice available
    const used = fires.filter((f) => f.useCount > 0);
    expect(used.length, 'more than one fire should see use').toBeGreaterThan(1);
  });
});

describe('structure provenance', () => {
  it('records who, why, what and when accurately', () => {
    const world = settledWorld();
    const st = world.structures.find((s) => s.state === 'complete')!;
    expect(st.initiatorId).toBeTruthy();
    expect(world.settlers.some((s) => s.id === st.initiatorId)).toBe(true);
    expect(st.reason.length).toBeGreaterThan(0);
    expect(st.locationReason.length).toBeGreaterThan(0);
    expect(st.completedAt).not.toBeNull();
    expect(st.completedAt!).toBeGreaterThanOrEqual(st.startedAt);
    expect(st.contributions.length).toBeGreaterThan(0);
    for (const c of st.contributions) {
      expect(world.settlers.some((s) => s.id === c.id), `${c.name} should exist`).toBe(true);
      expect(c.name).toBeTruthy();
    }
    for (const line of [...st.reason, ...st.locationReason]) {
      expect(line).not.toContain('undefined');
      expect(line).not.toContain('NaN');
    }
  });
});

describe('bounded and safe over long runs', () => {
  it('keeps structure count, spacing and welfare within bounds', () => {
    const world = settledWorld();
    expect(world.structures.length).toBeLessThanOrEqual(STRUCT.globalCap);
    expect(world.settlers.length).toBe(SETTLER_ROSTER.length);

    // No overlapping buildings.
    for (let i = 0; i < world.structures.length; i++) {
      for (let j = i + 1; j < world.structures.length; j++) {
        const a = world.structures[i];
        const b = world.structures[j];
        const min = a.type === b.type ? STRUCTURE_DEFS[a.type].spacing * 0.9 : 6;
        expect(dist(a.pos, b.pos), `${a.type} and ${b.type} too close`).toBeGreaterThan(min);
      }
    }

    // Nobody starved or froze while obsessing over construction.
    for (const s of world.settlers) {
      expect(s.health).toBeGreaterThan(40);
      expect(Number.isFinite(s.inventory.wood)).toBe(true);
      expect(Number.isFinite(s.energy)).toBe(true);
    }

    // No deadlock: never all projects stalled at zero with nobody assigned.
    const stalled = world.structures.filter((s) => s.state !== 'complete' && s.progress === 0);
    const claimed = stalled.filter((s) => world.settlers.some((x) => x.buildPlan?.structureId === s.id));
    expect(stalled.length === 0 || claimed.length > 0, 'stalled projects must be claimed or reclaimed').toBe(true);
  });

  it('does not exhaust the valley of materials', () => {
    const world = settledWorld();
    const wood = world.resources.filter((r) => r.type === 'wood').reduce((a, r) => a + r.quantity, 0);
    expect(wood, 'timber should regrow faster than it is cut').toBeGreaterThan(5);
  });

  it('builds structures on flat, dry, buildable ground', () => {
    const world = settledWorld();
    // Terrain height is seeded module-global state; other tests in this file
    // create their own worlds, so re-activate this world's landscape first.
    setTerrainSeed(world.seed);
    for (const st of world.structures) {
      const h = heightAt(st.pos.x, st.pos.z);
      expect(h).toBeGreaterThan(-2);
      expect(h).toBeLessThan(20);
      const e = 1.6;
      const spread =
        Math.max(heightAt(st.pos.x + e, st.pos.z), heightAt(st.pos.x - e, st.pos.z)) -
        Math.min(heightAt(st.pos.x, st.pos.z + e), heightAt(st.pos.x, st.pos.z - e));
      expect(Math.abs(spread), `${st.type} on a slope`).toBeLessThan(3);
    }
  });
});

describe('determinism and history', () => {
  it('the same seed produces the same construction history', () => {
    const a = createWorld(9100);
    const b = createWorld(9100);
    run(a, DAY * 3);
    run(b, DAY * 3);
    const describeWorld = (w: World) =>
      w.structures.map((s) => `${s.type}@${s.pos.x.toFixed(2)},${s.pos.z.toFixed(2)}:${s.initiatorName}:${s.state}`);
    expect(describeWorld(a)).toEqual(describeWorld(b));
    expect(a.chronicle.map((e) => e.text)).toEqual(b.chronicle.map((e) => e.text));
  });

  it('reports settlement change in the temporal summary', () => {
    const world = createWorld(9101);
    run(world, 120);
    const before = snapshot(world);
    run(world, DAY * 4);
    const summary = buildSummary(world, before)!;
    expect(summary).not.toBeNull();
    const labels = summary.settlementLines.map((l) => l.label);
    expect(labels).toContain('Structures completed');
    expect(labels).toContain('Wood harvested');
    for (const line of summary.settlementLines) {
      expect(line.value).not.toContain('undefined');
      expect(line.value).not.toContain('NaN');
    }
    // The summary reports change over the window, not a running total. Human
    // Landing now starts with a lit colony hearth, so counting every complete
    // structure would double-count something that predates the snapshot.
    const completed = Number(summary.settlementLines.find((l) => l.label === 'Structures completed')!.value);
    const since = world.structures.filter(
      (s) => s.state === 'complete' && s.completedAt !== null && s.completedAt > before.t,
    ).length;
    expect(completed).toBe(since);
  });

  it('detects a proto-settlement without forcing one', () => {
    const world = settledWorld();
    const clusters = detectSettlements(world);
    for (const c of clusters) {
      expect(c.structures.length).toBeGreaterThanOrEqual(STRUCT.settlementMinStructures);
      expect(c.regulars.length).toBeGreaterThanOrEqual(STRUCT.settlementMinRegulars);
      expect(c.place).toBeTruthy();
    }
    // A fresh world has no settlements — they have to be earned.
    expect(detectSettlements(createWorld(9102))).toHaveLength(0);
  });
});
