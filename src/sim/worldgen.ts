import { LUMI, START_TIME } from './config';
import { makeRng, type Rng } from './rng';
import {
  CREATURE_SPECIES,
  INTELLIGENT_SPECIES,
  KNOWLEDGE_POOL,
  SETTLER_ROSTER,
  type CreatureSpeciesDef,
} from './species';
import { landmarkAt, placeName } from './landmarks';
import { isWalkable, isWater, riverX, setTerrainSeed } from './terrain';
import { regionWeights } from './regions';
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
import { createProject } from './structures';
import { clamp01, v2, type V2 } from './vec';

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}_${(idCounter++).toString(36)}`;

/**
 * Named anchors used for spawning, wildlife home ranges and readable labels.
 * These mirror `LANDMARKS` so the geography the player sees and the names they
 * hear always agree.
 */
export const ANCHORS: Record<string, V2> = {
  // Human Riverlands
  humanCamp: v2(95, 25),
  riverbank: v2(58, -30),
  lake: v2(60, 70),
  meadow: v2(112, 60),
  // Between the regions
  glade: v2(-6, -18),
  forest: v2(-40, 22),
  // Veyra Ashlands
  veyraCamp: v2(-88, 86),
  ashpass: v2(-58, 44),
  rocks: v2(-118, 52),
  rocksSouth: v2(-46, 118),
  // Caelari Skyreach
  caelariCamp: v2(-60, -102),
  skyapproach: v2(-34, -58),
  hill: v2(-96, -62),
};

/** Resource labels read as places in the world, e.g. "the glowberries at River Bend". */
function resourceLabel(type: ResourceNode['type'], pos: V2): string {
  const place = placeName(pos);
  switch (type) {
    case 'glowberry':
      return `the glowberries at ${place}`;
    case 'wood':
      return `the timber stand at ${place}`;
    case 'stone':
      return `the stone seam at ${place}`;
    default:
      return `the shelter at ${place}`;
  }
}

export function idleGoal(t: number, label = 'Settling in'): Goal {
  return { type: 'idle', label, phase: 'act', timer: 2, startedAt: t, deadline: t + 30 };
}

/**
 * A standable spot near `center`.
 *
 * Traversability is a question of steepness, not altitude. The old height cap
 * would have declared the entire Caelari Skyreach uninhabitable the moment the
 * plateau went in, leaving that whole people with nowhere to spawn.
 */
function findLand(rng: Rng, center: V2, radius: number, tries = 28): V2 {
  for (let i = 0; i < tries; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = Math.sqrt(rng.next()) * radius;
    const p = v2(center.x + Math.sin(a) * d, center.z + Math.cos(a) * d);
    if (!isWalkable(p.x, p.z)) continue;
    return p;
  }
  // Fall back to the anchor itself, nudged off any cliff it happens to sit on.
  if (isWalkable(center.x, center.z)) return { ...center };
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    for (const d of [8, 16, 26]) {
      const p = v2(center.x + Math.sin(a) * d, center.z + Math.cos(a) * d);
      if (isWalkable(p.x, p.z)) return p;
    }
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
    // Values vary far more widely than the cultural bias, so a settler's
    // people never predicts what they believe about property.
    values: {
      individualism: clamp01(INTELLIGENT_SPECIES[speciesId].valueBias.individualism + (rng.next() - 0.5) * 0.8),
      territoriality: clamp01(INTELLIGENT_SPECIES[speciesId].valueBias.territoriality + (rng.next() - 0.5) * 0.8),
      // How readily they defer to local habit. Spread across the whole range
      // and independent of everything else: an independent-minded settler is
      // not thereby unfriendly, aggressive or contrarian.
      conformity: clamp01(0.5 + (rng.next() - 0.5) * 0.9),
    },
    structureAttitudes: {},
    socialBeliefs: [],
    protoCustoms: [],
    lastNormTalkAt: -9999,
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
    knownLandmarkIds: [],
    inventory: { glowberry: 0, wood: 0, stone: 0 },
    knownStructureIds: [],
    buildPlan: null,
    confrontCooldownUntil: 0,
    shareCooldownUntil: 0,
    projectCooldownUntil: 0,
    unreachable: {},
    knowledge,
    socialCooldownUntil: 0,
    talkingUntil: 0,
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

  // Vegetation is region-aware: what grows where is most of what makes the
  // three biomes readable on sight, before a single label is drawn.
  const put2 = (type: FloraType, p: V2, scale: number, obstacleRadius = 0) => {
    if (!clearOfCamps(p)) return;
    put(type, p, scale, obstacleRadius);
  };

  // Trees: dense in the Western Wood, common through the green Riverlands,
  // sparse and stunted in the Ashlands, wind-bent and rare up on the Skyreach.
  for (let i = 0; i < 210; i++) {
    let p: V2;
    if (i < 70) p = findLand(rng, ANCHORS.forest, 58);
    else if (i < 150) p = findLand(rng, ANCHORS.humanCamp, 110);
    else if (i < 180) p = findLand(rng, ANCHORS.glade, 70);
    else p = findLand(rng, v2(0, 0), 150);
    const w = regionWeights(p.x, p.z);
    // Thin them out sharply outside the green.
    const density = 1 - w.ashlands * 0.88 - w.skyreach * 0.72;
    if (!rng.chance(Math.max(0.05, density))) continue;
    if (Math.abs(p.x - riverX(p.z)) < 11) continue;
    const scale = rng.range(0.8, 1.6) * (1 - w.ashlands * 0.35 - w.skyreach * 0.28);
    put2(rng.chance(0.6) ? 'tree' : 'tree2', p, scale, 0.9);
  }

  // Rocks: the defining ground cover of the Ashlands and the Skyreach shelves.
  for (let i = 0; i < 210; i++) {
    let p: V2;
    if (i < 50) p = findLand(rng, ANCHORS.rocks, 62);
    else if (i < 85) p = findLand(rng, ANCHORS.veyraCamp, 78);
    else if (i < 130) p = findLand(rng, ANCHORS.caelariCamp, 76);
    else if (i < 165) p = findLand(rng, ANCHORS.hill, 62);
    else if (i < 190) p = findLand(rng, ANCHORS.skyapproach, 54);
    else p = findLand(rng, v2(0, 0), 150);
    const w = regionWeights(p.x, p.z);
    const density = 0.22 + w.ashlands * 0.75 + w.skyreach * 0.6;
    if (!rng.chance(Math.min(0.95, density))) continue;
    put2('rock', p, rng.range(0.6, 1.9), 1.0);
  }

  // Highland scrub: sparse, low and hardy. The plateau read as an empty grey
  // plain without it — nothing to walk between, nothing to judge scale by.
  for (let i = 0; i < 90; i++) {
    const anchor = i < 45 ? ANCHORS.caelariCamp : i < 70 ? ANCHORS.hill : ANCHORS.skyapproach;
    const p = findLand(rng, anchor, 66);
    const w = regionWeights(p.x, p.z);
    if (w.skyreach < 0.3) continue;
    put2(rng.chance(0.55) ? 'grass' : 'tree2', p, rng.range(0.4, 0.8), rng.chance(0.55) ? 0 : 0.6);
  }

  // Glowplants — concentrated in the glade and the wet Riverlands.
  for (let i = 0; i < 95; i++) {
    const p = i < 40 ? findLand(rng, ANCHORS.glade, 30) : findLand(rng, v2(0, 0), 150);
    const w = regionWeights(p.x, p.z);
    if (!rng.chance(Math.max(0.08, 1 - w.ashlands * 0.8 - w.skyreach * 0.55))) continue;
    put2('glowplant', p, rng.range(0.7, 1.4));
  }

  // Crystals: rim edges, and seeded through the mineral-rich Ashlands.
  for (let i = 0; i < 34; i++) {
    let p: V2;
    if (i < 22) {
      const a = rng.next() * Math.PI * 2;
      const d = rng.range(120, 155);
      p = v2(Math.sin(a) * d, Math.cos(a) * d);
    } else {
      p = findLand(rng, ANCHORS.rocks, 60);
    }
    if (isWater(p.x, p.z)) continue;
    put('crystal', p, rng.range(0.8, 2.0));
  }

  // Grass: thick in the Riverlands, all but gone in the Ashlands.
  for (let i = 0; i < 520; i++) {
    const p = i < 300 ? findLand(rng, ANCHORS.humanCamp, 120, 6) : findLand(rng, v2(0, 0), 160, 6);
    const w = regionWeights(p.x, p.z);
    if (!rng.chance(Math.max(0.04, 1 - w.ashlands * 0.94 - w.skyreach * 0.6))) continue;
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
    const node: ResourceNode = {
      id: nextId('res'),
      type,
      label: campOf
        ? `the ${INTELLIGENT_SPECIES[campOf].name} camp shelter`
        : resourceLabel(type, pos),
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
  // Wild berry patches to discover — spread so every region can feed itself.
  const wildSpots = [
    ANCHORS.meadow, ANCHORS.glade, ANCHORS.riverbank, ANCHORS.forest, ANCHORS.lake,
    ANCHORS.ashpass, ANCHORS.rocksSouth, ANCHORS.skyapproach, ANCHORS.hill, ANCHORS.veyraCamp,
    ANCHORS.caelariCamp,
  ];
  for (const spot of wildSpots) {
    const p = findLand(rng, spot, 26);
    addResource('glowberry', p, rng.int(5, 8), 1 / 55);
  }
  // Wild rest spots (sheltered hollows).
  addResource('restspot', findLand(rng, ANCHORS.glade, 16), 99, 0);
  addResource('restspot', findLand(rng, ANCHORS.meadow, 20), 99, 0);
  addResource('restspot', findLand(rng, ANCHORS.ashpass, 18), 99, 0);
  // Harvestable materials. Timber regrows slowly; stone seams do not, so the
  // valley has a finite supply of it and settlers must range further over time.
  // Timber follows the green; stone follows the rock. Each people therefore
  // has one material in abundance at home and must travel for the other.
  const woodSpots = [
    ANCHORS.forest, ANCHORS.forest, ANCHORS.forest, ANCHORS.glade,
    ANCHORS.riverbank, ANCHORS.humanCamp, ANCHORS.lake, ANCHORS.skyapproach,
  ];
  for (const spot of woodSpots) addResource('wood', findLand(rng, spot, 34), rng.int(26, 40), 1 / 110);
  const stoneSpots = [
    ANCHORS.rocks, ANCHORS.rocks, ANCHORS.veyraCamp, ANCHORS.rocksSouth,
    ANCHORS.hill, ANCHORS.caelariCamp, ANCHORS.meadow,
  ];
  for (const spot of stoneSpots) addResource('stone', findLand(rng, spot, 32), rng.int(24, 36), 1 / 300);
}

/**
 * Human Landing: the colony's first foothold, and the place the player should
 * recognise instantly on the way back.
 *
 * Built from systems that already exist — a completed campfire plus a landing
 * wreck and a fabrication platform as scenery — rather than a spawned town.
 * The settlers still do the rest of the building themselves.
 */
function buildHumanLanding(world: World, rng: Rng): void {
  const camp = world.camps.find((c) => c.speciesId === 'human')!;

  // The colony hearth: complete from the first minute, so Human Landing has a
  // gathering point before anyone has built anything.
  const humans = world.settlers.filter((s) => s.speciesId === 'human');
  const firePos = findLand(rng, camp.pos, 7);
  const hearth = createProject(
    world,
    humans[0],
    'campfire',
    firePos,
    ['The colony hearth, lit on the first night'],
    ['Beside the landing site, where everyone already was'],
  );
  // Credited to the colonists who actually landed, in equal share. Every
  // contributor id must resolve to a real settler — the provenance inspector
  // and the claim model both read these records back.
  const share = humans.length;
  hearth.contributions = humans.map((s) => ({
    id: s.id,
    name: s.name,
    wood: hearth.required.wood / share,
    stone: hearth.required.stone / share,
    work: 1 / share,
  }));
  hearth.contributed = { wood: hearth.required.wood, stone: hearth.required.stone };
  hearth.progress = 1;
  hearth.state = 'complete';
  hearth.completedAt = world.timeSec;
  for (const s of world.settlers) {
    if (!s.knownStructureIds.includes(hearth.id)) s.knownStructureIds.push(hearth.id);
  }

  // Landing infrastructure — scenery, not simulation. Nothing here is
  // interactive yet; the fabricator is a marked placeholder for a later
  // milestone.
  world.landmarksBuilt = [
    { kind: 'pod', pos: findLand(rng, camp.pos, 14), rot: rng.next() * Math.PI * 2 },
    { kind: 'debris', pos: findLand(rng, camp.pos, 20), rot: rng.next() * Math.PI * 2 },
    { kind: 'debris', pos: findLand(rng, camp.pos, 24), rot: rng.next() * Math.PI * 2 },
    { kind: 'fabricator', pos: findLand(rng, camp.pos, 11), rot: rng.next() * Math.PI * 2 },
    { kind: 'staging', pos: findLand(rng, camp.pos, 9), rot: rng.next() * Math.PI * 2 },
  ];
  // The pod and the fabricator are solid enough to walk around.
  for (const b of world.landmarksBuilt) {
    if (b.kind === 'pod') world.obstacles.push({ pos: b.pos, radius: 3.4 });
    if (b.kind === 'fabricator') world.obstacles.push({ pos: b.pos, radius: 1.6 });
  }
}

export function createWorld(seed: number): World {
  idCounter = 0;
  setTerrainSeed(seed);
  const rng = makeRng(seed);

  const player: PlayerState = {
    id: 'emerson',
    name: 'Emerson',
    // Placed properly once the terrain is known — see `createWorld`.
    pos: v2(0, 0),
    y: 0,
    vy: 0,
    heading: Math.PI,
    speed: 0,
    onGround: true,
    health: 100,
    stamina: 100,
    berries: 0,
    wood: 0,
    stone: 0,
    attackTimer: 0,
    attackCooldown: 0,
    dodgeTimer: 0,
    dodgeCooldown: 0,
    dead: false,
    respawnTimer: 0,
    moveSpeed: 0,
    lastSprintAt: -999,
    witnessed: [],
  };

  const world: World = {
    seed,
    rng,
    timeSec: START_TIME,
    settlers: [],
    creatures: [],
    player,
    resources: [],
    structures: [],
    offeredFood: [],
    flora: [],
    obstacles: [],
    landmarksBuilt: [],
    camps: [
      { speciesId: 'human', label: 'Human camp', pos: { ...ANCHORS.humanCamp } },
      { speciesId: 'veyra', label: 'Veyra camp', pos: { ...ANCHORS.veyraCamp } },
      { speciesId: 'caelari', label: 'Caelari camp', pos: { ...ANCHORS.caelariCamp } },
    ],
    chronicle: [],
    chronicleCounter: 0,
    weather: 'clear',
    yieldMode: 'normal',
    flags: {},
    ariQueue: [],
    dirty: { entities: false, resources: false, structures: false },
  };

  // Settlers. Each people begins in the region its camp sits in — initial
  // settlement geography, not a faction wall. They remain fully autonomous and
  // routinely travel, meet and socialize across the whole valley.
  for (const seedRow of SETTLER_ROSTER) {
    const camp = world.camps.find((c) => c.speciesId === seedRow.species)!;
    const settler = makeSettler(world, rng, seedRow.name, seedRow.sex, seedRow.species, camp);
    const home = landmarkAt(settler.pos);
    if (home) settler.knownLandmarkIds.push(home.id);
    world.settlers.push(settler);
  }

  scatterFlora(world, rng);
  placeResources(world, rng);
  buildHumanLanding(world, rng);

  // Emerson opens the game standing at Human Landing on dry, level ground.
  // Derived from the terrain rather than hard-coded: a literal spawn point
  // silently put him waist-deep in the river the moment the river moved.
  const humanCamp = world.camps.find((c) => c.speciesId === 'human')!;
  world.player.pos = findLand(rng, humanCamp.pos, 12);
  // Face the water, so the first thing on screen is what makes this place home.
  world.player.heading = Math.atan2(riverX(world.player.pos.z) - world.player.pos.x, 6);

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
  chronicle(
    world,
    'system',
    'The Humans made landfall in the Riverlands, the Veyra in the Ashlands, the Caelari on the Skyreach.',
  );
  chronicle(world, 'system', 'Twenty-one settlers begin their first day on a new world.');

  return world;
}
