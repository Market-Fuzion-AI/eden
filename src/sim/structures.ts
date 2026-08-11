import { STRUCT } from './config';
import { placeName } from './landmarks';
import { groundY, heightAt, isWater } from './terrain';
import type { EntityId, Settler, Structure, StructureType, World } from './types';
import { dist, type V2, v2 } from './vec';

/**
 * Structures: the first persistent shared places in Eden.
 *
 * Everything about a structure — who staked it, why, who helped, what it cost
 * and who has used it since — lives here in simulation state, so Creator Mode
 * can answer those questions from the record rather than inventing an
 * explanation after the fact.
 */

export interface StructureDef {
  type: StructureType;
  name: string;
  required: { wood: number; stone: number };
  /** Sim-seconds of applied labour to go from staked to complete. */
  work: number;
  /** Structures of the same type must be at least this far apart. */
  spacing: number;
  /** A known one within this range removes the reason to build another. */
  satisfyRadius: number;
}

export const STRUCTURE_DEFS: Record<StructureType, StructureDef> = {
  campfire: {
    type: 'campfire',
    name: 'Campfire',
    required: { wood: 8, stone: 5 },
    work: 70,
    // Fires serve a wide area. Tighter spacing produced a valley of campfires
    // and no shelters, because the cheap structure always won the utility race.
    spacing: 52,
    satisfyRadius: 78,
  },
  shelter: {
    type: 'shelter',
    name: 'Basic Shelter',
    required: { wood: 16, stone: 7 },
    work: 150,
    // Shelters hold several sleepers, so a handful serves the whole valley.
    // Tighter values produced nine of them — sprawl rather than settlement.
    spacing: 22,
    satisfyRadius: 62,
  },
};

let structureCounter = 0;

export function resetStructureCounter(): void {
  structureCounter = 0;
}

/** Fraction of the required materials delivered so far (0..1). */
export function deliveredFraction(s: Structure): number {
  const need = s.required.wood + s.required.stone;
  if (need <= 0) return 1;
  const got = Math.min(s.contributed.wood, s.required.wood) + Math.min(s.contributed.stone, s.required.stone);
  return got / need;
}

/** What this structure still needs, by resource. */
export function missingResources(s: Structure): { wood: number; stone: number } {
  return {
    wood: Math.max(0, s.required.wood - s.contributed.wood),
    stone: Math.max(0, s.required.stone - s.contributed.stone),
  };
}

export function structureNeedsMaterials(s: Structure): boolean {
  const m = missingResources(s);
  return m.wood > 0 || m.stone > 0;
}

/** Completed structures of a type that this settler knows about. */
export function knownCompleteStructures(world: World, s: Settler, type: StructureType): Structure[] {
  return world.structures.filter(
    (st) => st.type === type && st.state === 'complete' && s.knownStructureIds.includes(st.id),
  );
}

export function nearestKnownStructure(
  world: World,
  s: Settler,
  type: StructureType,
): { structure: Structure; d: number } | null {
  let best: Structure | null = null;
  let bestD = Infinity;
  for (const st of knownCompleteStructures(world, s, type)) {
    const d = dist(s.pos, st.pos);
    if (d < bestD) {
      best = st;
      bestD = d;
    }
  }
  return best ? { structure: best, d: bestD } : null;
}

/** Projects currently being built that this settler knows about. */
export function activeProjects(world: World): Structure[] {
  return world.structures.filter((st) => st.state !== 'complete');
}

/**
 * Pick a build site.
 *
 * Deliberately a small readable heuristic, not a settlement planner: flat, dry,
 * clear of obstacles and other structures, and biased toward the ground this
 * settler already lives and works on.
 */
export function chooseBuildSite(
  world: World,
  s: Settler,
  type: StructureType,
): { pos: V2; reason: string[] } | null {
  const def = STRUCTURE_DEFS[type];
  const rng = world.rng;

  // Anchor near where this settler's life already happens.
  const anchors: { pos: V2; label: string }[] = [{ pos: s.pos, label: 'where they were standing' }];
  anchors.push({ pos: s.home, label: 'near their landing camp' });
  const food = world.resources.find((r) => r.type === 'glowberry' && s.knownResourceIds.includes(r.id));
  if (food) anchors.push({ pos: food.pos, label: 'near a food source they know' });
  // Trusted company is a reason to build where they are.
  let bestFriend: Settler | null = null;
  let bestAff = 25;
  for (const [id, rel] of Object.entries(s.relationships)) {
    if (rel.affinity <= bestAff) continue;
    const other = world.settlers.find((o) => o.id === id);
    if (!other) continue;
    bestFriend = other;
    bestAff = rel.affinity;
  }
  if (bestFriend) anchors.push({ pos: bestFriend.pos, label: `near ${bestFriend.name}, whom they trust` });

  let best: { pos: V2; score: number; anchor: string; flat: number } | null = null;

  for (let attempt = 0; attempt < 40; attempt++) {
    const anchor = anchors[attempt % anchors.length];
    const a = rng.next() * Math.PI * 2;
    const d = rng.range(3, 26);
    const p = v2(anchor.pos.x + Math.sin(a) * d, anchor.pos.z + Math.cos(a) * d);

    if (Math.hypot(p.x, p.z) > 165) continue;
    if (isWater(p.x, p.z)) continue;
    const h = heightAt(p.x, p.z);
    if (h > 15) continue;

    // Flat ground only — sample the corners of a small footprint.
    const e = 1.6;
    const hs = [
      heightAt(p.x + e, p.z),
      heightAt(p.x - e, p.z),
      heightAt(p.x, p.z + e),
      heightAt(p.x, p.z - e),
    ];
    const flat = Math.max(...hs) - Math.min(...hs);
    if (flat > 1.1) continue;

    // Clear of trees and boulders.
    let blocked = false;
    for (const o of world.obstacles) {
      if (dist(p, o.pos) < o.radius + 2.2) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    // Clear of other structures, with type spacing respected.
    let tooClose = false;
    for (const st of world.structures) {
      const min = st.type === type ? def.spacing : 7;
      if (dist(p, st.pos) < min) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    // Never on top of the landing camps.
    if (world.camps.some((c) => dist(p, c.pos) < 9)) continue;

    const score = 20 - flat * 8 - dist(p, s.pos) * 0.12;
    if (!best || score > best.score) best = { pos: p, score, anchor: anchor.label, flat };
  }

  if (!best) return null;
  return {
    pos: best.pos,
    reason: [
      `Level ground (${best.flat.toFixed(2)}m variation)`,
      `Clear of water, rock and other structures`,
      `Chosen ${best.anchor}`,
      `At ${placeName(best.pos)}`,
    ],
  };
}

/** Stake out a new project. The site exists immediately; the structure does not. */
export function createProject(
  world: World,
  initiator: Settler,
  type: StructureType,
  pos: V2,
  reason: string[],
  locationReason: string[],
): Structure {
  const def = STRUCTURE_DEFS[type];
  const structure: Structure = {
    id: `str_${(structureCounter++).toString(36)}`,
    type,
    pos: { ...pos },
    y: groundY(pos.x, pos.z),
    place: placeName(pos),
    state: 'under-construction',
    progress: 0,
    required: { ...def.required },
    contributed: { wood: 0, stone: 0 },
    initiatorId: initiator.id,
    initiatorName: initiator.name,
    reason,
    locationReason,
    contributions: [],
    startedAt: world.timeSec,
    lastWorkAt: world.timeSec,
    completedAt: null,
    usage: [],
    useCount: 0,
  };
  world.structures.push(structure);
  world.dirty.structures = true;
  // The person who staked it obviously knows where it is.
  if (!initiator.knownStructureIds.includes(structure.id)) initiator.knownStructureIds.push(structure.id);
  return structure;
}

function contributionFor(s: Structure, id: EntityId, name: string) {
  let c = s.contributions.find((x) => x.id === id);
  if (!c) {
    c = { id, name, wood: 0, stone: 0, work: 0 };
    s.contributions.push(c);
  }
  return c;
}

/** Hand over carried materials. Returns what was actually accepted. */
export function deliverMaterials(world: World, structure: Structure, s: Settler): { wood: number; stone: number } {
  const missing = missingResources(structure);
  const wood = Math.min(missing.wood, s.inventory.wood);
  const stone = Math.min(missing.stone, s.inventory.stone);
  if (wood <= 0 && stone <= 0) return { wood: 0, stone: 0 };
  structure.lastWorkAt = world.timeSec;
  s.inventory.wood -= wood;
  s.inventory.stone -= stone;
  structure.contributed.wood += wood;
  structure.contributed.stone += stone;
  const c = contributionFor(structure, s.id, s.name);
  c.wood += wood;
  c.stone += stone;
  return { wood, stone };
}

/**
 * Apply labour. Progress can never outrun the materials actually delivered,
 * so a half-supplied project visibly stalls half-built.
 */
export function applyWork(world: World, structure: Structure, s: Settler, dt: number): number {
  const def = STRUCTURE_DEFS[structure.type];
  const cap = deliveredFraction(structure);
  if (structure.progress >= cap) return 0;
  const gain = Math.min(dt / def.work, cap - structure.progress);
  structure.progress = Math.min(cap, structure.progress + gain);
  structure.lastWorkAt = world.timeSec;
  contributionFor(structure, s.id, s.name).work += gain;
  return gain;
}

/** Visual/readable construction stage. */
export function constructionStage(s: Structure): 0 | 1 | 2 | 3 {
  if (s.state === 'complete') return 3;
  if (s.progress >= 0.66) return 2;
  if (s.progress >= 0.3) return 1;
  return 0;
}

export const STAGE_LABEL = ['Foundation', 'Partial', 'Near complete', 'Complete'];

/** Record that someone used a structure (rest, warmth, company). */
export function recordUse(world: World, structure: Structure, s: Settler): void {
  let u = structure.usage.find((x) => x.id === s.id);
  if (!u) {
    u = { id: s.id, name: s.name, count: 0, lastAt: world.timeSec };
    structure.usage.push(u);
  }
  u.count++;
  u.lastAt = world.timeSec;
  structure.useCount++;
}

/** Everyone who has used this structure, most frequent first. */
export function frequentUsers(structure: Structure, limit = 5) {
  return [...structure.usage].sort((a, b) => b.count - a.count).slice(0, limit);
}

export function structureById(world: World, id: EntityId | undefined): Structure | undefined {
  if (!id) return undefined;
  return world.structures.find((s) => s.id === id);
}

/**
 * Proto-settlement detection: a place where several finished structures share
 * ground and several people keep coming back. Observation only — no
 * government, no founding ceremony, no forced behaviour.
 */
export interface SettlementCluster {
  pos: V2;
  place: string;
  structures: Structure[];
  regulars: string[];
  since: number;
}

export function detectSettlements(world: World): SettlementCluster[] {
  const complete = world.structures.filter((s) => s.state === 'complete');
  const clusters: SettlementCluster[] = [];
  const used = new Set<string>();

  for (const seed of complete) {
    if (used.has(seed.id)) continue;
    const group = complete.filter((s) => dist(s.pos, seed.pos) <= STRUCT.settlementRadius);
    if (group.length < STRUCT.settlementMinStructures) continue;

    const users = new Map<string, number>();
    for (const st of group) {
      for (const u of st.usage) users.set(u.name, (users.get(u.name) ?? 0) + u.count);
    }
    const regulars = [...users.entries()]
      .filter(([, count]) => count >= STRUCT.settlementMinUses)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
    if (regulars.length < STRUCT.settlementMinRegulars) continue;

    for (const st of group) used.add(st.id);
    const cx = group.reduce((sum, st) => sum + st.pos.x, 0) / group.length;
    const cz = group.reduce((sum, st) => sum + st.pos.z, 0) / group.length;
    clusters.push({
      pos: v2(cx, cz),
      place: placeName(v2(cx, cz)),
      structures: group,
      regulars,
      since: Math.min(...group.map((s) => s.completedAt ?? s.startedAt)),
    });
  }
  return clusters;
}
