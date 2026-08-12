import { describe, expect, it } from 'vitest';
import { SIM_DT, WORLD } from './config';
import { LANDMARKS, landmarkAt, placeName } from './landmarks';
import { REGIONS, regionAt, regionShortName, regionWeights, SPECIES_REGION } from './regions';
import { simTick } from './simulation';
import { heightAt, isWalkable, isWater, riverX, setTerrainSeed, slopeAt, terrainSeed } from './terrain';
import { createWorld } from './worldgen';
import type { World } from './types';
import { SETTLER_ROSTER } from './species';

/**
 * The v0.7A thesis: LIVE INSIDE AN AUTONOMOUS WORLD.
 *
 * These pin the three-region geography, the home base, and the terrain
 * contract the whole game stands on — that the ground the simulation walks is
 * the same ground the renderer draws, and that it never moves.
 */

const DAY = 720;

function run(world: World, simSeconds: number): void {
  const ticks = Math.ceil(simSeconds / SIM_DT);
  for (let i = 0; i < ticks; i++) {
    simTick(world, SIM_DT);
    if (world.ariQueue.length > 8) world.ariQueue.length = 0;
  }
}

/** Sample the playable disc on a coarse grid. */
function sampleDisc(step = 6): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let x = -WORLD.playRadius; x <= WORLD.playRadius; x += step) {
    for (let z = -WORLD.playRadius; z <= WORLD.playRadius; z += step) {
      if (Math.hypot(x, z) > WORLD.playRadius - 4) continue;
      out.push({ x, z });
    }
  }
  return out;
}

describe('three readable regions', () => {
  it('gives every region a distinct elevation band', () => {
    const world = createWorld(700);
    setTerrainSeed(world.seed);
    const heights: Record<string, number[]> = { riverlands: [], ashlands: [], skyreach: [] };
    for (const p of sampleDisc()) {
      const r = regionAt(p.x, p.z);
      if (r !== 'wilds') heights[r].push(heightAt(p.x, p.z));
    }
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const river = mean(heights.riverlands);
    const ash = mean(heights.ashlands);
    const sky = mean(heights.skyreach);

    // Low, middling and high — identifiable from elevation alone.
    expect(river).toBeLessThan(ash);
    expect(ash).toBeLessThan(sky);
    expect(sky - river, 'the Skyreach should tower over the Riverlands').toBeGreaterThan(18);
  });

  it('puts the water in the Riverlands', () => {
    const world = createWorld(701);
    setTerrainSeed(world.seed);
    let riverWater = 0;
    let otherWater = 0;
    for (const p of sampleDisc(4)) {
      if (!isWater(p.x, p.z)) continue;
      if (regionAt(p.x, p.z) === 'riverlands') riverWater++;
      else otherWater++;
    }
    expect(riverWater, 'the Riverlands should actually contain water').toBeGreaterThan(0);
    expect(riverWater).toBeGreaterThan(otherWater);
  });

  it('keeps every region traversable on foot', () => {
    const world = createWorld(702);
    setTerrainSeed(world.seed);
    const walkable: Record<string, { ok: number; total: number }> = {
      riverlands: { ok: 0, total: 0 },
      ashlands: { ok: 0, total: 0 },
      skyreach: { ok: 0, total: 0 },
    };
    for (const p of sampleDisc(4)) {
      const r = regionAt(p.x, p.z);
      if (r === 'wilds') continue;
      walkable[r].total++;
      if (isWalkable(p.x, p.z)) walkable[r].ok++;
    }
    for (const [id, w] of Object.entries(walkable)) {
      // A region nobody can cross is a wall, not a biome.
      expect(w.ok / w.total, `${id} should be mostly walkable`).toBeGreaterThan(0.55);
    }
  });

  it('weights blend smoothly and always sum to one', () => {
    for (const p of sampleDisc(9)) {
      const w = regionWeights(p.x, p.z);
      const sum = w.riverlands + w.ashlands + w.skyreach + w.wilds;
      expect(sum).toBeCloseTo(1, 5);
      for (const v of [w.riverlands, w.ashlands, w.skyreach, w.wilds]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('names every region and its landmarks', () => {
    for (const r of REGIONS) {
      expect(regionAt(r.pos.x, r.pos.z), `${r.id} should own its own centre`).toBe(r.id);
      expect(regionShortName(r.id).length).toBeGreaterThan(0);
      expect(r.ariLine).not.toContain('undefined');
    }
    expect(regionShortName('wilds')).toBeTruthy();
    // Every landmark sits inside the playable area and names itself.
    for (const lm of LANDMARKS) {
      expect(Math.hypot(lm.pos.x, lm.pos.z)).toBeLessThan(WORLD.playRadius);
      expect(landmarkAt(lm.pos)?.id, `${lm.id} should resolve to itself`).toBe(lm.id);
      expect(placeName(lm.pos)).toBe(lm.name);
    }
  });

  it('spreads landmarks across all three regions', () => {
    const covered = new Set(LANDMARKS.map((lm) => regionAt(lm.pos.x, lm.pos.z)));
    for (const r of REGIONS) expect(covered.has(r.id), `${r.id} should have a named place`).toBe(true);
  });
});

describe('starting geography', () => {
  it('settles each people in its own region', () => {
    const world = createWorld(710);
    for (const [species, region] of Object.entries(SPECIES_REGION)) {
      const group = world.settlers.filter((s) => s.speciesId === species);
      expect(group.length).toBeGreaterThan(0);
      for (const s of group) {
        expect(regionAt(s.pos.x, s.pos.z), `${s.name} should start in ${region}`).toBe(region);
      }
    }
  });

  it('starts Emerson at Human Landing, on dry level ground', () => {
    for (const seed of [711, 712, 713]) {
      const world = createWorld(seed);
      setTerrainSeed(world.seed);
      const p = world.player.pos;
      expect(regionAt(p.x, p.z)).toBe('riverlands');
      expect(landmarkAt(p)?.id, 'he should open the game at Human Landing').toBe('landing');
      // He must not begin the game standing in the river.
      expect(isWater(p.x, p.z)).toBe(false);
      expect(heightAt(p.x, p.z)).toBeGreaterThan(WORLD.waterLevel);
      expect(slopeAt(p.x, p.z)).toBeLessThan(0.85);
    }
  });

  it('gives Human Landing a recognisable silhouette', () => {
    const world = createWorld(714);
    const kinds = world.landmarksBuilt.map((b) => b.kind);
    expect(kinds).toContain('pod');
    expect(kinds).toContain('fabricator');
    expect(kinds).toContain('staging');
    // Everything stands within a short walk of the camp.
    const camp = world.camps.find((c) => c.speciesId === 'human')!;
    for (const b of world.landmarksBuilt) {
      expect(Math.hypot(b.pos.x - camp.pos.x, b.pos.z - camp.pos.z)).toBeLessThan(30);
    }
    // The colony hearth is lit from the first minute, and every contributor to
    // it is a real settler — the provenance model reads these ids back.
    const hearth = world.structures.find((s) => s.type === 'campfire' && s.state === 'complete');
    expect(hearth, 'the colony should start with a hearth').toBeTruthy();
    for (const c of hearth!.contributions) {
      expect(world.settlers.some((s) => s.id === c.id), `${c.name} should exist`).toBe(true);
    }
  });

  it('does not confine anyone to their region', () => {
    // Regional spawning is initial geography, not a faction wall: over a week
    // of autonomous life, somebody should have crossed a boundary.
    const world = createWorld(715);
    run(world, DAY * 7);
    let travellers = 0;
    for (const s of world.settlers) {
      if (regionAt(s.pos.x, s.pos.z) !== SPECIES_REGION[s.speciesId]) travellers++;
    }
    expect(travellers, 'settlers should range beyond their home region').toBeGreaterThan(0);
    expect(world.settlers.length).toBe(SETTLER_ROSTER.length);
  });

  it('lets every region feed and house its people', () => {
    const world = createWorld(716);
    run(world, DAY * 6);
    for (const s of world.settlers) {
      expect(s.health, `${s.name} should not starve in their own region`).toBeGreaterThan(40);
    }
    // And the autonomous construction from v0.4 still runs on the new terrain.
    expect(world.structures.filter((st) => st.state === 'complete').length).toBeGreaterThan(1);
  });
});

describe('water geography', () => {
  it('keeps standing water in the Riverlands across many valleys', () => {
    // v0.8 shipped a terrain weakness this test now pins down: on roughly one
    // seed in ten the Ashlands canyon carve landed on an already-low mesa and
    // cut through the global water plane, pooling water in canyon floors on
    // the far side of the map. A regional floor lifts sub-waterline ground
    // outside the wet parts of the world; the river is exempted by proximity
    // rather than by region, because its northern end runs outside the
    // Riverlands circle and a region mask alone would have severed it.
    let offending = 0;
    for (let seed = 1; seed <= 120; seed++) {
      setTerrainSeed(seed);
      for (let x = -168; x <= 168; x += 6) {
        for (let z = -168; z <= 168; z += 6) {
          if (Math.hypot(x, z) > 164) continue;
          if (!isWater(x, z)) continue;
          if (regionAt(x, z) === 'riverlands') continue;
          // Water near the channel is the river, wherever the region boundary
          // happens to fall.
          if (Math.abs(x - riverX(z)) < 20) continue;
          offending++;
        }
      }
    }
    expect(offending, 'no standing water outside the Riverlands and the river').toBe(0);
  });

  it('still has a river that runs the length of the valley', () => {
    setTerrainSeed(31337);
    let wet = 0;
    let total = 0;
    for (let z = -100; z <= 100; z += 5) {
      total++;
      if (isWater(riverX(z), z)) wet++;
    }
    // The floor must never fill in the thing it is protecting.
    expect(wet / total).toBeGreaterThan(0.8);
  });
});

describe('terrain contract', () => {
  it('is a pure function of position and seed', () => {
    setTerrainSeed(4242);
    const before = sampleDisc(11).map((p) => heightAt(p.x, p.z));
    setTerrainSeed(99);
    setTerrainSeed(4242);
    const after = sampleDisc(11).map((p) => heightAt(p.x, p.z));
    expect(after).toEqual(before);
  });

  it('produces a different landscape for a different seed', () => {
    setTerrainSeed(1);
    const a = sampleDisc(11).map((p) => heightAt(p.x, p.z));
    setTerrainSeed(2);
    const b = sampleDisc(11).map((p) => heightAt(p.x, p.z));
    expect(a).not.toEqual(b);
  });

  it('re-asserts its seed from whichever world is being ticked', () => {
    // The v0.4 sharp edge: creating a second world silently re-seeded the
    // landscape under the first, and its agents began walking on the wrong
    // hills. Ticking a world must now restore that world's terrain.
    const a = createWorld(800);
    const sample = () => sampleDisc(15).map((p) => heightAt(p.x, p.z));
    const aHeights = sample();

    createWorld(801); // different seed — steals the module-level terrain
    expect(terrainSeed()).toBe(801);

    simTick(a, SIM_DT);
    expect(terrainSeed(), 'ticking world A should restore world A terrain').toBe(800);
    expect(sample()).toEqual(aHeights);
  });

  it('never moves while the world runs', () => {
    const world = createWorld(802);
    const hash = () =>
      sampleDisc(9)
        .map((p) => Math.round(heightAt(p.x, p.z) * 1000))
        .join(',');
    const before = hash();
    run(world, DAY * 2);
    expect(hash(), 'the valley must not reshape itself').toBe(before);
  });

  it('keeps the whole playable disc finite and mostly walkable', () => {
    const world = createWorld(803);
    setTerrainSeed(world.seed);
    let walkable = 0;
    const points = sampleDisc(5);
    for (const p of points) {
      const h = heightAt(p.x, p.z);
      expect(Number.isFinite(h)).toBe(true);
      if (isWalkable(p.x, p.z)) walkable++;
    }
    expect(walkable / points.length).toBeGreaterThan(0.6);
  });
});
