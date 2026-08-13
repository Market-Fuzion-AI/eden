import { describe, expect, it } from 'vitest';
import { GATHER, SCANNER, SIM_DT } from './config';
import {
  MATERIALS,
  MATERIAL_IDS,
  RECIPE_BY_ID,
  canFabricate,
  collectMaterial,
  fabricationProgress,
  startFabrication,
  useMedkit,
} from './fabrication';
import { regionAt } from './regions';
import { performScan, scanCooldownRemaining, scannerReady, scanTick } from './scanner';
import { simTick } from './simulation';
import { isWalkable, setTerrainSeed } from './terrain';
import { createWorld } from './worldgen';
import { materialNodeAtHand, startHarvest, updatePlayer } from './player';
import type { MaterialId, World } from './types';

/**
 * The v0.7B thesis: LEAVING HOME HAS A PURPOSE.
 *
 * These pin the economy — that materials come out of the ground exactly once,
 * that fabrication costs what it says, and that the Scanner is a real
 * capability gained at a real price rather than a flag someone can set.
 */

const DAY = 720;
const NO_INPUT = { moveX: 0, moveZ: 0, sprint: false, jump: false, camYaw: 0 };

function run(world: World, simSeconds: number): void {
  const ticks = Math.ceil(simSeconds / SIM_DT);
  for (let i = 0; i < ticks; i++) {
    simTick(world, SIM_DT);
    if (world.ariQueue.length > 8) world.ariQueue.length = 0;
  }
}

/** Advance only the player clock — gathering runs in real time. */
function runPlayer(world: World, seconds: number): void {
  const steps = Math.ceil(seconds / (1 / 60));
  for (let i = 0; i < steps; i++) {
    world.timeSec += 1 / 60;
    updatePlayer(world, 1 / 60, NO_INPUT);
  }
}

function give(world: World, alloy: number, ore: number, crystal: number): void {
  world.player.materials.alloy = alloy;
  world.player.materials.ore = ore;
  world.player.materials.crystal = crystal;
}

/** Stand Kai at a node of the given type and work it to completion. */
function harvestOnce(world: World, type: MaterialId): number {
  const node = world.resources.find((r) => r.type === MATERIALS[type].nodeType && r.quantity >= 1)!;
  world.player.pos = { ...node.pos };
  expect(materialNodeAtHand(world)?.id).toBe(node.id);
  expect(startHarvest(world, node)).toBe(true);
  const before = world.player.materials[type];
  runPlayer(world, GATHER.duration + 0.2);
  return world.player.materials[type] - before;
}

describe('regional material geography', () => {
  it('puts each material where its region is', () => {
    const world = createWorld(900);
    setTerrainSeed(world.seed);
    for (const id of MATERIAL_IDS) {
      const def = MATERIALS[id];
      const nodes = world.resources.filter((r) => r.type === def.nodeType);
      expect(nodes.length, `${def.name} should exist`).toBeGreaterThan(2);
      const home = nodes.filter((n) => regionAt(n.pos.x, n.pos.z) === def.region).length;
      // Abundance, not exclusivity: most of it is at home, some is not.
      expect(home / nodes.length, `${def.name} should be concentrated in ${def.region}`).toBeGreaterThan(0.5);
    }
  });

  it('never puts a material node underwater or on a cliff', () => {
    for (const seed of [901, 902, 903]) {
      const world = createWorld(seed);
      setTerrainSeed(world.seed);
      for (const r of world.resources) {
        if (!MATERIAL_IDS.some((id) => MATERIALS[id].nodeType === r.type)) continue;
        expect(isWalkable(r.pos.x, r.pos.z), `${r.label} should be reachable`).toBe(true);
      }
    }
  });

  it('leaves enough in the ground to finish the first loop several times over', () => {
    for (const seed of [904, 905, 906]) {
      const world = createWorld(seed);
      setTerrainSeed(world.seed);
      const scanner = RECIPE_BY_ID['scanner-mk1'];
      for (const id of MATERIAL_IDS) {
        const def = MATERIALS[id];
        const available = world.resources
          .filter((r) => r.type === def.nodeType)
          .reduce((sum, r) => sum + Math.floor(r.quantity), 0);
        const need = scanner.costs[id] ?? 0;
        // No first-loop soft lock, with a wide margin for a player who never
        // finds half the nodes.
        expect(available, `${def.name}: ${available} in the world, ${need} needed`).toBeGreaterThan(need * 3);
      }
    }
  });

  it('keeps player materials out of the settlers\' construction economy', () => {
    const world = createWorld(907);
    run(world, DAY * 3);
    // Settlers only ever ask for wood and stone; they must never draw down a
    // salvage node or carry a crystal home.
    for (const s of world.settlers) {
      expect(Object.keys(s.inventory).sort()).toEqual(['glowberry', 'stone', 'wood']);
      // No settler may ever be walking at a player material node.
      const target = world.resources.find((r) => r.id === s.goal.targetId);
      if (target) {
        expect(
          MATERIAL_IDS.some((id) => MATERIALS[id].nodeType === target.type),
          `${s.name} is targeting ${target.label}`,
        ).toBe(false);
      }
    }
    for (const r of world.resources) {
      if (!MATERIAL_IDS.some((id) => MATERIALS[id].nodeType === r.type)) continue;
      expect(r.quantity, `${r.label} should be untouched by settlers`).toBe(r.maxQuantity);
    }
  });
});

describe('gathering', () => {
  it('moves units out of the node and into the player', () => {
    const world = createWorld(910);
    const node = world.resources.find((r) => r.type === 'ore')!;
    const before = node.quantity;
    const got = collectMaterial(world, node.id)!;
    expect(got.material.id).toBe('ore');
    expect(got.amount).toBe(MATERIALS.ore.yield);
    expect(node.quantity).toBe(before - got.amount);
    expect(world.player.materials.ore).toBe(got.amount);
  });

  it('cannot be milked forever from one node', () => {
    const world = createWorld(911);
    const node = world.resources.find((r) => r.type === 'alloy')!;
    const stock = Math.floor(node.quantity);
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const got = collectMaterial(world, node.id);
      if (!got) break;
      total += got.amount;
    }
    // Exactly what was in the ground, never more, and the node ends empty.
    expect(total).toBe(stock);
    expect(world.player.materials.alloy).toBe(stock);
    expect(node.quantity).toBeLessThan(1);
    expect(collectMaterial(world, node.id)).toBeNull();
  });

  it('never pays out more than the node holds', () => {
    const world = createWorld(912);
    const node = world.resources.find((r) => r.type === 'ore')!;
    node.quantity = 1; // less than a full yield
    const got = collectMaterial(world, node.id)!;
    expect(got.amount).toBe(1);
    expect(node.quantity).toBe(0);
  });

  it('takes real time and completes into the inventory', () => {
    const world = createWorld(913);
    setTerrainSeed(world.seed);
    const gained = harvestOnce(world, 'crystal');
    expect(gained).toBe(MATERIALS.crystal.yield);
    expect(world.player.harvest, 'the interaction should have finished').toBeNull();
    expect(world.pickups.length).toBeGreaterThan(0);
  });

  it('is cancelled by walking away, granting nothing', () => {
    const world = createWorld(914);
    setTerrainSeed(world.seed);
    const node = world.resources.find((r) => r.type === 'alloy' && r.quantity >= 1)!;
    world.player.pos = { ...node.pos };
    startHarvest(world, node);
    const stock = node.quantity;
    // Step away mid-interaction.
    world.player.pos = { x: node.pos.x + GATHER.cancelDistance + 2, z: node.pos.z };
    runPlayer(world, GATHER.duration + 0.2);
    expect(world.player.harvest).toBeNull();
    expect(world.player.materials.alloy).toBe(0);
    expect(node.quantity).toBe(stock);
  });

  it('refuses to start on an empty node', () => {
    const world = createWorld(915);
    const node = world.resources.find((r) => r.type === 'ore')!;
    node.quantity = 0;
    expect(startHarvest(world, node)).toBe(false);
  });
});

describe('fabrication', () => {
  it('refuses without the materials, and takes nothing', () => {
    const world = createWorld(920);
    expect(canFabricate(world, 'scanner-mk1').reason).toBe('missing-materials');
    const result = startFabrication(world, 'scanner-mk1');
    expect(result.ok).toBe(false);
    expect(world.fabrication).toBeNull();
    for (const id of MATERIAL_IDS) expect(world.player.materials[id]).toBe(0);
  });

  it('consumes exactly the stated cost', () => {
    const world = createWorld(921);
    give(world, 10, 10, 10);
    const cost = RECIPE_BY_ID['scanner-mk1'].costs;
    expect(startFabrication(world, 'scanner-mk1').ok).toBe(true);
    expect(world.player.materials.alloy).toBe(10 - (cost.alloy ?? 0));
    expect(world.player.materials.ore).toBe(10 - (cost.ore ?? 0));
    expect(world.player.materials.crystal).toBe(10 - (cost.crystal ?? 0));
  });

  it('unlocks the scanner exactly once', () => {
    const world = createWorld(922);
    give(world, 20, 20, 20);
    expect(world.player.unlocks.scanner).toBe(false);
    startFabrication(world, 'scanner-mk1');
    run(world, RECIPE_BY_ID['scanner-mk1'].duration + 1);
    expect(world.player.unlocks.scanner).toBe(true);
    const spent = { ...world.player.materials };

    // A second attempt is refused outright and costs nothing.
    expect(canFabricate(world, 'scanner-mk1').reason).toBe('already-built');
    expect(startFabrication(world, 'scanner-mk1').ok).toBe(false);
    expect(world.player.materials).toEqual(spent);
  });

  it('cannot be double-started into two items or a double charge', () => {
    const world = createWorld(923);
    give(world, 10, 10, 10);
    expect(startFabrication(world, 'medkit').ok).toBe(true);
    const after = { ...world.player.materials };
    // Mashing the button while it runs must do nothing at all.
    for (let i = 0; i < 12; i++) {
      expect(startFabrication(world, 'medkit').reason).toBe('busy');
    }
    expect(world.player.materials).toEqual(after);
    run(world, RECIPE_BY_ID.medkit.duration + 1);
    expect(world.player.items.medkit).toBe(1);
    expect(world.fabrication).toBeNull();
  });

  it('completes exactly once however fast time runs', () => {
    const world = createWorld(924);
    give(world, 10, 10, 10);
    startFabrication(world, 'energy-cell');
    // A single enormous step, as a speed change can produce.
    simTick(world, 400);
    expect(world.player.items.energyCell).toBe(1);
    expect(world.fabrication).toBeNull();
    // And nothing further appears with more time.
    run(world, 200);
    expect(world.player.items.energyCell).toBe(1);
  });

  it('reports progress and clears it on completion', () => {
    const world = createWorld(925);
    give(world, 10, 10, 10);
    expect(fabricationProgress(world)).toBe(0);
    startFabrication(world, 'medkit');
    run(world, RECIPE_BY_ID.medkit.duration * 0.5);
    const mid = fabricationProgress(world);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.95);
    run(world, RECIPE_BY_ID.medkit.duration);
    expect(fabricationProgress(world)).toBe(0);
  });

  it('never lets any count go negative', () => {
    const world = createWorld(926);
    give(world, 3, 3, 3);
    for (let i = 0; i < 40; i++) {
      for (const id of ['scanner-mk1', 'medkit', 'energy-cell'] as const) {
        startFabrication(world, id);
        run(world, 4);
      }
    }
    for (const id of MATERIAL_IDS) expect(world.player.materials[id]).toBeGreaterThanOrEqual(0);
    expect(world.player.items.medkit).toBeGreaterThanOrEqual(0);
    expect(world.player.items.energyCell).toBeGreaterThanOrEqual(0);
  });

  it('builds a working medkit', () => {
    const world = createWorld(927);
    give(world, 10, 10, 10);
    startFabrication(world, 'medkit');
    run(world, RECIPE_BY_ID.medkit.duration + 1);
    expect(world.player.items.medkit).toBe(1);

    world.player.health = 40;
    const healed = useMedkit(world);
    expect(healed).toBeGreaterThan(0);
    expect(world.player.health).toBeGreaterThan(40);
    expect(world.player.items.medkit).toBe(0);
    // Nothing to spend, nothing spent.
    expect(useMedkit(world)).toBe(0);
    expect(world.player.items.medkit).toBe(0);
  });

  it('does not waste a medkit at full health', () => {
    const world = createWorld(928);
    world.player.items.medkit = 1;
    world.player.health = 100;
    expect(useMedkit(world)).toBe(0);
    expect(world.player.items.medkit).toBe(1);
  });
});

describe('pathfinder scanner', () => {
  const armed = (seed: number) => {
    const world = createWorld(seed);
    setTerrainSeed(world.seed);
    give(world, 20, 20, 20);
    startFabrication(world, 'scanner-mk1');
    run(world, RECIPE_BY_ID['scanner-mk1'].duration + 1);
    return world;
  };

  it('does not exist before it is built', () => {
    const world = createWorld(930);
    expect(world.player.unlocks.scanner).toBe(false);
    const result = performScan(world);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('locked');
    expect(result.found).toEqual([]);
  });

  it('detects nearby material nodes once built', () => {
    const world = armed(931);
    const node = world.resources.find((r) => r.type === 'ore' && r.quantity >= 1)!;
    world.player.pos = { x: node.pos.x + 6, z: node.pos.z };
    const result = performScan(world);
    expect(result.ok).toBe(true);
    expect(result.found).toContain(node.id);
    expect(result.counts.ore).toBeGreaterThan(0);
  });

  it('ignores worked-out nodes', () => {
    const world = armed(932);
    const node = world.resources.find((r) => r.type === 'alloy')!;
    node.quantity = 0;
    world.player.pos = { ...node.pos };
    expect(performScan(world).found).not.toContain(node.id);
  });

  it('does not reveal the whole map', () => {
    const world = armed(933);
    const total = world.resources.filter((r) =>
      MATERIAL_IDS.some((id) => MATERIALS[id].nodeType === r.type),
    ).length;
    const result = performScan(world);
    expect(result.found.length).toBeLessThan(total);
    // Everything it found is genuinely within range.
    for (const id of result.found) {
      const n = world.resources.find((r) => r.id === id)!;
      expect(Math.hypot(n.pos.x - world.player.pos.x, n.pos.z - world.player.pos.z)).toBeLessThanOrEqual(
        SCANNER.radius + 0.001,
      );
    }
  });

  it('expires its highlight', () => {
    const world = armed(934);
    const node = world.resources.find((r) => r.type === 'crystal' && r.quantity >= 1)!;
    world.player.pos = { ...node.pos };
    performScan(world);
    expect(world.player.scan.nodeIds.length).toBeGreaterThan(0);
    run(world, SCANNER.highlight + 2);
    scanTick(world);
    expect(world.player.scan.nodeIds).toEqual([]);
  });

  it('drops a node from the highlight once it is worked out', () => {
    const world = armed(935);
    const node = world.resources.find((r) => r.type === 'ore' && r.quantity >= 1)!;
    world.player.pos = { ...node.pos };
    performScan(world);
    expect(world.player.scan.nodeIds).toContain(node.id);
    node.quantity = 0;
    scanTick(world);
    expect(world.player.scan.nodeIds).not.toContain(node.id);
  });

  it('cannot be spammed past its cooldown', () => {
    const world = armed(936);
    expect(scannerReady(world)).toBe(true);
    performScan(world);
    expect(scannerReady(world)).toBe(false);
    for (let i = 0; i < 20; i++) {
      expect(performScan(world).reason).toBe('cooling');
    }
    expect(scanCooldownRemaining(world)).toBeGreaterThan(0);
    run(world, SCANNER.cooldown + 1);
    expect(scannerReady(world)).toBe(true);
    expect(performScan(world).ok).toBe(true);
  });

  it('spends an energy cell for an extended sweep while cooling', () => {
    const world = armed(937);
    performScan(world);
    world.player.items.energyCell = 1;
    const boosted = performScan(world);
    expect(boosted.ok).toBe(true);
    expect(boosted.boosted).toBe(true);
    expect(boosted.radius).toBe(SCANNER.boostedRadius);
    expect(world.player.items.energyCell).toBe(0);
    // With no cell left it is simply on cooldown again.
    expect(performScan(world).reason).toBe('cooling');
  });
});

describe('the fabrication technician', () => {
  it('exists, and keeps her post through a working week', () => {
    const world = createWorld(940);
    const tech = world.settlers.find((s) => s.roleAnchor?.role === 'fabricator');
    expect(tech, 'the colony needs a fabrication technician').toBeTruthy();
    expect(world.fabricatorPos).toBeTruthy();

    let atPostSamples = 0;
    let workingSamples = 0;
    let maxAway = 0;
    const ticks = Math.ceil((DAY * 6) / SIM_DT);
    for (let i = 0; i < ticks; i++) {
      simTick(world, SIM_DT);
      if (world.ariQueue.length > 8) world.ariQueue.length = 0;
      if (i % 300 !== 0) continue;
      const hour = ((world.timeSec % DAY) / DAY) * 24;
      const away = Math.hypot(tech!.pos.x - world.fabricatorPos!.x, tech!.pos.z - world.fabricatorPos!.z);
      maxAway = Math.max(maxAway, away);
      if (hour >= 8 && hour < 19) {
        workingSamples++;
        if (away < 40) atPostSamples++;
      }
    }
    // Reliably available during the working day, without being a statue.
    expect(atPostSamples / workingSamples, 'she should usually be at the Fabricator').toBeGreaterThan(0.8);
    expect(maxAway, 'she should still move around the world').toBeGreaterThan(3);
  });

  it('is still a person: she eats, rests and forms relationships', () => {
    const world = createWorld(941);
    run(world, DAY * 6);
    const tech = world.settlers.find((s) => s.roleAnchor?.role === 'fabricator')!;
    expect(tech.health, 'the role must not starve her').toBeGreaterThan(40);
    expect(Object.keys(tech.relationships).length, 'she should know people').toBeGreaterThan(0);
    expect(tech.memories.length).toBeGreaterThan(0);
  });
});

describe('the first loop end to end', () => {
  it('cannot be completed without leaving Human Landing', () => {
    const world = createWorld(950);
    setTerrainSeed(world.seed);
    // Everything within a short walk of the fabricator, taken to exhaustion.
    const home = world.fabricatorPos!;
    for (const r of world.resources) {
      if (!MATERIAL_IDS.some((id) => MATERIALS[id].nodeType === r.type)) continue;
      if (Math.hypot(r.pos.x - home.x, r.pos.z - home.z) > 60) continue;
      for (let i = 0; i < 50; i++) if (!collectMaterial(world, r.id)) break;
    }
    // Home alone is not enough: the Scanner needs the other two regions.
    expect(canFabricate(world, 'scanner-mk1').ok, 'the loop must require travel').toBe(false);
    expect(world.player.materials.crystal).toBe(0);
  });

  it('runs: gather in three regions, fabricate, and gain a capability', () => {
    const world = createWorld(951);
    setTerrainSeed(world.seed);

    // Gather each material where it lives, through the real interaction.
    for (const id of MATERIAL_IDS) {
      const need = RECIPE_BY_ID['scanner-mk1'].costs[id] ?? 0;
      let guard = 0;
      while (world.player.materials[id] < need && guard++ < 40) {
        const gained = harvestOnce(world, id);
        expect(gained).toBeGreaterThan(0);
      }
    }
    for (const id of MATERIAL_IDS) {
      expect(world.player.materials[id]).toBeGreaterThanOrEqual(RECIPE_BY_ID['scanner-mk1'].costs[id] ?? 0);
    }

    // Return home and build it.
    expect(canFabricate(world, 'scanner-mk1').ok).toBe(true);
    expect(startFabrication(world, 'scanner-mk1').ok).toBe(true);
    run(world, RECIPE_BY_ID['scanner-mk1'].duration + 1);
    expect(world.player.unlocks.scanner).toBe(true);

    // The capability is real: it now finds things it could not find before.
    const node = world.resources.find((r) => r.type === 'ore' && r.quantity >= 1)!;
    world.player.pos = { x: node.pos.x + 4, z: node.pos.z };
    const scan = performScan(world);
    expect(scan.ok).toBe(true);
    expect(scan.found.length).toBeGreaterThan(0);
  });

  it('leaves the world running underneath it', () => {
    const world = createWorld(952);
    give(world, 20, 20, 20);
    startFabrication(world, 'scanner-mk1');
    run(world, DAY * 3);
    expect(world.player.unlocks.scanner).toBe(true);
    // The simulation did not pause for the player's errand.
    for (const s of world.settlers) expect(s.health).toBeGreaterThan(40);
    expect(world.chronicle.length).toBeGreaterThan(3);
    expect(world.creatures.length).toBeGreaterThan(0);
  });
});

describe('the Skyreach cannot be skipped', () => {
  it('puts every crystal cluster on high ground', () => {
    // The Scanner needs crystal, and crystal only grows in the Skyreach — so
    // the first loop cannot be completed without making the climb.
    for (const seed of [960, 961, 962]) {
      const world = createWorld(seed);
      setTerrainSeed(world.seed);
      const clusters = world.resources.filter((r) => r.type === 'crystal');
      expect(clusters.length).toBeGreaterThan(3);
      for (const c of clusters) {
        expect(regionAt(c.pos.x, c.pos.z), `${c.label} should be in the Skyreach`).toBe('skyreach');
      }
    }
  });
});
