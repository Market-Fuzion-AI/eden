import { LUMI, START_TIME, WORLD } from './config';
import { makeRng, type Rng } from './rng';
import {
  CREATURE_SPECIES,
  INTELLIGENT_SPECIES,
  KNOWLEDGE_POOL,
  SETTLER_ROSTER,
  type CreatureSpeciesDef,
} from './species';
import { heightAt, isWater, riverX, setTerrainSeed } from './terrain';
import type {
  Camp,
  Creature,
  FloraType,
  Goal,
  IntelligentSpeciesId,
  PlayerState,
  ResourceNode,
  Settler,
  World,
} from './types';
import { chronicle } from './chronicle';
import { clamp01, v2, type V2 } from './vec';

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}_${(idCounter++).toString(36)}`;

/** Named regions used for spawning, wildlife home ranges and readable labels. */
export const ANCHORS: Record<string, V2> = {
  meadow: v2(38, -42),
  forest: v2(-98, 8),
  rocks: v2(-88, 58),
  rocksSouth: v2(-52, 112),
  riverbank: v2(14, 44),
  glade: v2(-34, -26),
  hill: v2(-48, -95),
  humanCamp: v2(70, 20),
  veyraCamp: v2(-62, 78),
  caelariCamp: v2(-48, -95),
};

function directionLabel(p: V2): string {
  const parts: string[] = [];
  if (p.z < -35) parts.push('north');
  else if (p.z > 35) parts.push('south');
  if (p.x < -35) parts.push(p.z < -35 || p.z > 35 ? 'western' : 'western');
  else if (p.x > 35) parts.push('eastern');
  if (parts.length === 0) return 'central';
  return parts.join('-');
}

export function idleGoal(t: number, label = 'Settling in'): Goal {
  return { type: 'idle', label, phase: 'act', timer: 2, startedAt: t, deadline: t + 30 };
}

function findLand(rng: Rng, center: V2, radius: number, tries = 24): V2 {
  for (let i = 0; i < tries; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = Math.sqrt(rng.next()) * radius;
    const p = v2(center.x + Math.sin(a) * d, center.z + Math.cos(a) * d);
    const r = Math.hypot(p.x, p.z);
    if (r > WORLD.playRadius - 6) continue;
    if (isWater(p.x, p.z)) continue;
    if (heightAt(p.x, p.z) > 14) continue;
    return p;
  }
  return { ...center };
}

function makeSettler(
  world: World,
  rng: Rng,
  name: string,
  sex: 'female' | 'male',
  speciesId: IntelligentSpeciesId,
  camp: Camp,
): Settler {
  const bias = INTELLIGENT_SPECIES[speciesId].bias;
  const trait = (b: number) => clamp01(b + (rng.next() - 0.5) * 0.55);
  const pos = findLand(rng, camp.pos, 10);
  const knowledge = [...KNOWLEDGE_POOL].filter(() => rng.chance(0.65));
  if (knowledge.length < 2) knowledge.push('construction');
  return {
    id: nextId('set'),
    name,
    kind: 'settler',
    speciesId,
    sex,
    ageStage: 'adult',
    pos,
    heading: rng.next() * Math.PI * 2,
    speed: 0,
    health: 100,
    energy: rng.range(62, 92),
    hunger: rng.range(15, 45),
    goal: idleGoal(world.timeSec),
    goalReason: { summary: ['Just arrived on Eden'], scores: [] },
    memories: [],
    nextThinkAt: rng.range(0.5, 4),
    socialTimer: 0,
    resting: false,
    home: { ...camp.pos },
    personality: {
      curiosity: trait(bias.curiosity),
      sociability: trait(bias.sociability),
      caution: trait(bias.caution),
      aggression: trait(bias.aggression),
      empathy: trait(bias.empathy),
      initiative: trait(bias.initiative),
    },
    needs: { social: rng.range(10, 45), curiosity: rng.range(20, 60), safety: 0 },
    relationships: {},
    knownResourceIds: [],
    knowledge,
    socialCooldownUntil: 0,
  };
}

export function makeCreature(
  world: World,
  rng: Rng,
  def: CreatureSpeciesDef,
  pos: V2,
  juvenile = false,
): Creature {
  return {
    id: nextId('cre'),
    name: def.name,
    kind: 'creature',
    speciesId: def.id,
    sex: rng.chance(0.5) ? 'female' : 'male',
    ageStage: juvenile ? 'juvenile' : 'adult',
    pos: { ...pos },
    heading: rng.next() * Math.PI * 2,
    speed: 0,
    health: 100,
    energy: juvenile ? 45 : rng.range(50, 85),
    hunger: rng.range(20, 55),
    goal: idleGoal(world.timeSec, 'Acclimating'),
    goalReason: { summary: ['Instinct'], scores: [] },
    memories: [],
    nextThinkAt: world.timeSec + rng.range(0.5, 3),
    socialTimer: 0,
    resting: false,
    home: { ...pos },
    fear: 0,
    curiosity: def.traits.curiosity * 100 * rng.range(0.6, 1),
    threatPos: null,
    threatUntil: 0,
    replicationCooldownUntil: world.timeSec + rng.range(60, 240),
    aggroUntil: 0,
    visualVariant: rng.next(),
  };
}

function scatterFlora(world: World, rng: Rng): void {
  const put = (type: FloraType, pos: V2, scale: number, obstacleRadius = 0) => {
    world.flora.push({ type, pos, scale, rot: rng.next() * Math.PI * 2, variant: rng.next() });
    if (obstacleRadius > 0) world.obstacles.push({ pos, radius: obstacleRadius * scale });
  };
  const clearOfCamps = (p: V2) =>
    world.camps.every((c) => Math.hypot(p.x - c.pos.x, p.z - c.pos.z) > 14);

  // Forest band (west) + scattered trees everywhere.
  for (let i = 0; i < 150; i++) {
    const nearForest = i < 80;
    const center = nearForest ? ANCHORS.forest : v2(0, 0);
    const radius = nearForest ? 60 : 150;
    const p = findLand(rng, center, radius);
    if (!clearOfCamps(p)) continue;
    if (Math.abs(p.x - riverX(p.z)) < 12) continue;
    put(rng.chance(0.6) ? 'tree' : 'tree2', p, rng.range(0.8, 1.6), 0.9);
  }
  // Rocks.
  for (let i = 0; i < 55; i++) {
    const center = rng.chance(0.5) ? ANCHORS.rocks : v2(0, 0);
    const p = findLand(rng, center, i % 2 === 0 ? 45 : 150);
    if (!clearOfCamps(p)) continue;
    put('rock', p, rng.range(0.5, 2.2), 1.0);
  }
  // Glowplants — concentrated in the glade, sprinkled elsewhere.
  for (let i = 0; i < 85; i++) {
    const center = i < 40 ? ANCHORS.glade : v2(0, 0);
    const p = findLand(rng, center, i < 40 ? 30 : 150);
    if (!clearOfCamps(p)) continue;
    put('glowplant', p, rng.range(0.7, 1.4));
  }
  // Crystals near rim edges.
  for (let i = 0; i < 22; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = rng.range(120, 155);
    const p = v2(Math.sin(a) * d, Math.cos(a) * d);
    if (isWater(p.x, p.z)) continue;
    put('crystal', p, rng.range(0.8, 2.0));
  }
  // Grass tufts.
  for (let i = 0; i < 420; i++) {
    const p = findLand(rng, v2(0, 0), 160, 6);
    put('grass', p, rng.range(0.6, 1.5));
  }
}

function placeResources(world: World, rng: Rng): void {
  const addResource = (
    type: ResourceNode['type'],
    pos: V2,
    quantity: number,
    regen: number,
    campOf?: IntelligentSpeciesId,
  ): ResourceNode => {
    const typeName =
      type === 'glowberry' ? 'glowberry patch' : type === 'wood' ? 'timber grove' : type === 'stone' ? 'stone outcrop' : 'shelter';
    const node: ResourceNode = {
      id: nextId('res'),
      type,
      label: campOf
        ? `the ${INTELLIGENT_SPECIES[campOf].name} camp ${type === 'restspot' ? 'shelter' : typeName}`
        : `the ${directionLabel(pos)} ${typeName}`,
      pos,
      quantity,
      maxQuantity: quantity,
      regenPerSec: regen,
      campOf,
      discovered: Boolean(campOf),
    };
    world.resources.push(node);
    return node;
  };

  // Berry patches: a couple near each camp (pre-known), the rest wild.
  for (const camp of world.camps) {
    for (let i = 0; i < 2; i++) {
      const p = findLand(rng, camp.pos, 22);
      const node = addResource('glowberry', p, rng.int(5, 7), 1 / 55);
      node.label = `the ${directionLabel(p)} glowberry patch`;
      node.discovered = true;
      // Camp members start knowing their local patches.
      for (const s of world.settlers) {
        if (s.speciesId === camp.speciesId) s.knownResourceIds.push(node.id);
      }
    }
    // Rest shelters at each camp.
    for (let i = 0; i < 3; i++) {
      const p = findLand(rng, camp.pos, 9);
      const node = addResource('restspot', p, 99, 0, camp.speciesId);
      for (const s of world.settlers) {
        if (s.speciesId === camp.speciesId) s.knownResourceIds.push(node.id);
      }
    }
  }
  // Wild berry patches to discover.
  const wildSpots = [ANCHORS.meadow, ANCHORS.glade, ANCHORS.riverbank, ANCHORS.forest, v2(90, -70), v2(-10, 120), v2(110, 60), ANCHORS.hill];
  for (const spot of wildSpots) {
    const p = findLand(rng, spot, 24);
    addResource('glowberry', p, rng.int(5, 8), 1 / 55);
  }
  // Wild rest spots (sheltered hollows).
  addResource('restspot', findLand(rng, ANCHORS.glade, 16), 99, 0);
  addResource('restspot', findLand(rng, ANCHORS.meadow, 20), 99, 0);
  // Future-facing material nodes.
  for (let i = 0; i < 4; i++) addResource('wood', findLand(rng, ANCHORS.forest, 45), 20, 0);
  for (let i = 0; i < 4; i++) addResource('stone', findLand(rng, ANCHORS.rocks, 40), 20, 0);
}

export function createWorld(seed: number): World {
  idCounter = 0;
  setTerrainSeed(seed);
  const rng = makeRng(seed);

  const player: PlayerState = {
    id: 'emerson',
    name: 'Emerson',
    pos: v2(56, 12),
    y: 0,
    vy: 0,
    heading: Math.PI,
    speed: 0,
    onGround: true,
    health: 100,
    stamina: 100,
    berries: 0,
    attackTimer: 0,
    attackCooldown: 0,
    dodgeTimer: 0,
    dodgeCooldown: 0,
    dead: false,
    respawnTimer: 0,
    lastSprintAt: -999,
  };

  const world: World = {
    seed,
    rng,
    timeSec: START_TIME,
    settlers: [],
    creatures: [],
    player,
    resources: [],
    offeredFood: [],
    flora: [],
    obstacles: [],
    camps: [
      { speciesId: 'human', label: 'Human camp', pos: { ...ANCHORS.humanCamp } },
      { speciesId: 'veyra', label: 'Veyra camp', pos: { ...ANCHORS.veyraCamp } },
      { speciesId: 'caelari', label: 'Caelari camp', pos: { ...ANCHORS.caelariCamp } },
    ],
    chronicle: [],
    chronicleCounter: 0,
    weather: 'clear',
    flags: {},
    ariQueue: [],
    dirty: { entities: false, resources: false },
  };

  // Settlers.
  for (const seedRow of SETTLER_ROSTER) {
    const camp = world.camps.find((c) => c.speciesId === seedRow.species)!;
    world.settlers.push(makeSettler(world, rng, seedRow.name, seedRow.sex, seedRow.species, camp));
  }

  scatterFlora(world, rng);
  placeResources(world, rng);

  // Native creatures — every archetype represented at least once.
  const spawnCounts: Record<string, number> = {
    lumin: 1, // plus Lumi herself below
    thornback: 2,
    strider: 1,
    mossling: 2,
    puffbell: 1,
    glimmerfin: 2,
    skyren: 2,
    emberwing: 1,
    rakhor: 1,
  };
  for (const def of CREATURE_SPECIES) {
    const n = spawnCounts[def.id] ?? 1;
    for (let i = 0; i < n; i++) {
      let pos: V2;
      if (def.aquatic) {
        const z = rng.range(-100, 100);
        pos = v2(riverX(z), z);
      } else {
        pos = findLand(rng, ANCHORS[def.homeAnchor] ?? v2(0, 0), 26);
      }
      world.creatures.push(makeCreature(world, rng, def, pos));
    }
  }

  // Lumi — a persistent named individual, not a disposable animal.
  const lumiDef = CREATURE_SPECIES.find((s) => s.id === 'lumin')!;
  const lumi = makeCreature(world, rng, lumiDef, findLand(rng, ANCHORS.glade, 8));
  lumi.id = 'lumi';
  lumi.name = 'Lumi';
  lumi.sex = 'female';
  lumi.curiosity = 85;
  lumi.lumi = {
    trust: LUMI.startTrust,
    following: false,
    followUntil: 0,
    fedCount: 0,
    lastTrustMilestone: 0,
  };
  world.creatures.push(lumi);

  chronicle(world, 'system', 'Three peoples — Humans, Veyra and Caelari — have arrived in the Eden valley.');
  chronicle(world, 'system', 'Twenty-one settlers begin their first day on a new world.');

  return world;
}
