import { formatClock, formatClockShort } from './chronicle';
import { getEntity, getWorld } from './index';
import { LANDMARKS, placeName } from './landmarks';
import { memoryText } from './memory';
import {
  avoidanceOf,
  modifierLines,
  relationshipState,
  socialModifiers,
  type RelationshipState,
} from './relationships';
import { claimantsOf, evaluateClaim, peekAttitude } from './norms';
import { CREATURE_SPECIES_BY_ID, INTELLIGENT_SPECIES } from './species';
import { constructionStage, frequentUsers, STAGE_LABEL, STRUCTURE_DEFS } from './structures';
import type { ClaimKind, IntelligentSpeciesId, Relationship } from './types';
import { dist } from './vec';

/**
 * Builds the structured data shown by the Creator Mode inspector.
 * UI-facing formatting lives here so panels stay dumb.
 */

export interface InspectorBar {
  label: string;
  value: number; // 0..100
  tone?: 'good' | 'warn' | 'bad' | 'accent';
}

export interface RelationshipSummary {
  otherId: string;
  name: string;
  state: RelationshipState;
  affinity: number;
  trust: number;
  familiarity: number;
  fear: number;
  interactions: number;
}

/** Full drill-down for one pair, built entirely from recorded history. */
export interface RelationshipDetail extends RelationshipSummary {
  subjectId: string;
  subjectName: string;
  firstMetAt: number;
  history: { when: string; text: string; deltas: string[] }[];
  /** How this relationship is currently biasing goal selection. */
  influence: string[];
}

export interface InspectorData {
  id: string;
  name: string;
  subtitle: string;
  kindLabel: string;
  /** Where the entity currently is, by landmark name. */
  place: string;
  vitals: InspectorBar[];
  goal: { label: string; reason: string[] };
  scores: { goal: string; score: number }[];
  personality: InspectorBar[];
  needs: InspectorBar[];
  trust?: { label: string; value: number };
  relationships: RelationshipSummary[];
  memories: { text: string; ago: string }[];
  known: string[];
}

/** Everything Creator Mode shows about a structure — all of it recorded. */
export interface StructureDetail {
  id: string;
  name: string;
  place: string;
  pos: { x: number; z: number };
  status: string;
  progressPct: number;
  stageLabel: string;
  initiatorId: string;
  initiatorName: string;
  reason: string[];
  locationReason: string[];
  contributors: { id: string; name: string; line: string }[];
  materials: string[];
  builtLabel: string;
  startedLabel: string;
  recentUsers: { id: string; name: string; line: string }[];
  useCount: number;
  /** How each involved settler independently reads this place. */
  claimants: {
    id: string;
    name: string;
    kind: ClaimKind;
    label: string;
    attachment: number;
    why: string[];
  }[];
  /** True when at least two people read it differently. */
  contested: boolean;
}

/** One settler's stance toward one structure, for the agent inspector. */
export interface StructureExpectation {
  structureId: string;
  name: string;
  place: string;
  kind: ClaimKind;
  label: string;
  attachment: number;
  why: string[];
  permissionNote: string | null;
}

export function structureExpectationsOf(settlerId: string): StructureExpectation[] {
  const world = getWorld();
  const s = getEntity(settlerId);
  if (!s || s.kind !== 'settler') return [];
  const out: StructureExpectation[] = [];
  for (const st of world.structures) {
    if (st.state !== 'complete') continue;
    const involved =
      st.initiatorId === s.id ||
      st.contributions.some((c) => c.id === s.id) ||
      st.usage.some((u) => u.id === s.id) ||
      Boolean(peekAttitude(s, st.id));
    if (!involved) continue;
    const claim = evaluateClaim(world, s, st);
    if (claim.kind === 'none') continue;
    const att = peekAttitude(s, st.id);
    const notes: string[] = [];
    if (att?.allowed.length) notes.push(`has allowed ${att.allowed.length}`);
    if (att?.allowedBy.length) notes.push(`allowed by ${att.allowedBy.length}`);
    if (att?.refusedBy.length) notes.push(`refused by ${att.refusedBy.length}`);
    out.push({
      structureId: st.id,
      name: STRUCTURE_DEFS[st.type].name,
      place: st.place,
      kind: claim.kind,
      label: claim.label,
      attachment: Math.round(claim.attachment),
      why: claim.factors
        .filter((f) => f.value !== 0)
        .map((f) => `${f.label} ${f.value > 0 ? '+' : ''}${f.value}`),
      permissionNote: notes.length ? notes.join(' · ') : null,
    });
  }
  const rank: Record<ClaimKind, number> = { personal: 3, shared: 2, public: 1, none: 0 };
  out.sort((a, b) => rank[b.kind] - rank[a.kind] || b.attachment - a.attachment);
  return out;
}

/**
 * Descriptive aggregation of how each people currently reads shelters.
 * Not culture, not law — just a tally of individual expectations.
 */
export interface NormTendency {
  group: string;
  personal: number;
  shared: number;
  public: number;
  sample: number;
}

export function normTendencies(): NormTendency[] {
  const world = getWorld();
  const out: NormTendency[] = [];
  for (const speciesId of ['human', 'veyra', 'caelari'] as IntelligentSpeciesId[]) {
    const counts = { personal: 0, shared: 0, public: 0 };
    let sample = 0;
    for (const s of world.settlers) {
      if (s.speciesId !== speciesId) continue;
      for (const st of world.structures) {
        if (st.type !== 'shelter' || st.state !== 'complete') continue;
        const claim = evaluateClaim(world, s, st);
        if (claim.kind === 'none') continue;
        counts[claim.kind]++;
        sample++;
      }
    }
    if (sample === 0) continue;
    out.push({
      group: INTELLIGENT_SPECIES[speciesId].plural,
      personal: Math.round((counts.personal / sample) * 100),
      shared: Math.round((counts.shared / sample) * 100),
      public: Math.round((counts.public / sample) * 100),
      sample,
    });
  }
  return out;
}

export function inspectStructure(id: string): StructureDetail | null {
  const world = getWorld();
  const st = world.structures.find((s) => s.id === id);
  if (!st) return null;
  const def = STRUCTURE_DEFS[st.type];
  const stage = constructionStage(st);

  const contributors = [...st.contributions]
    .sort((a, b) => b.work + b.wood + b.stone - (a.work + a.wood + a.stone))
    .map((c) => {
      const parts: string[] = [];
      if (c.wood >= 0.5) parts.push(`${Math.round(c.wood)} wood`);
      if (c.stone >= 0.5) parts.push(`${Math.round(c.stone)} stone`);
      if (c.work > 0.005) parts.push(`${Math.round(c.work * 100)}% of the labour`);
      return { id: c.id, name: c.name, line: parts.length ? parts.join(' · ') : 'present at the site' };
    });

  return {
    id: st.id,
    name: def.name,
    place: st.place,
    pos: { x: st.pos.x, z: st.pos.z },
    status: st.state === 'complete' ? 'Complete' : `Under construction — ${STAGE_LABEL[stage]}`,
    progressPct: Math.round(st.progress * 100),
    stageLabel: STAGE_LABEL[stage],
    initiatorId: st.initiatorId,
    initiatorName: st.initiatorName,
    reason: st.reason,
    locationReason: st.locationReason,
    contributors,
    materials: [
      `Wood ${Math.round(st.contributed.wood)} / ${st.required.wood}`,
      `Stone ${Math.round(st.contributed.stone)} / ${st.required.stone}`,
    ],
    builtLabel: st.completedAt !== null ? formatClock(st.completedAt) : 'Not yet complete',
    startedLabel: formatClock(st.startedAt),
    recentUsers: frequentUsers(st).map((u) => ({
      id: u.id,
      name: u.name,
      line: `${u.count} visit${u.count === 1 ? '' : 's'} · last ${formatClockShort(u.lastAt)}`,
    })),
    useCount: st.useCount,
    claimants: claimantsOf(world, st).map((c) => ({
      id: c.settler.id,
      name: c.settler.name,
      kind: c.claim.kind,
      label: c.claim.label,
      attachment: Math.round(c.claim.attachment),
      why: c.claim.factors
        .filter((f) => f.value !== 0)
        .slice(0, 5)
        .map((f) => `${f.label} ${f.value > 0 ? '+' : ''}${f.value}`),
    })),
    contested: new Set(claimantsOf(world, st).map((c) => c.claim.kind)).size > 1,
  };
}

function nameOf(id: string): string {
  return id === 'emerson' ? 'Emerson' : (getEntity(id)?.name ?? 'someone');
}

function summarizeRelationship(otherId: string, rel: Relationship): RelationshipSummary {
  return {
    otherId,
    name: nameOf(otherId),
    state: relationshipState(rel),
    affinity: Math.round(rel.affinity),
    trust: Math.round(rel.trust),
    familiarity: Math.round(rel.familiarity),
    fear: Math.round(rel.fear),
    interactions: rel.interactions,
  };
}

/**
 * Drill-down for a single pair. History comes straight from the recorded
 * relationship events — nothing here is invented or inferred after the fact.
 */
export function inspectRelationship(subjectId: string, otherId: string): RelationshipDetail | null {
  const world = getWorld();
  const subject = getEntity(subjectId);
  if (!subject || subject.kind !== 'settler') return null;
  const rel = subject.relationships[otherId];
  if (!rel) return null;

  const history = rel.history
    .slice()
    .reverse()
    .map((h) => {
      const deltas: string[] = [];
      const push = (label: string, v: number) => {
        if (v) deltas.push(`${label} ${v > 0 ? '+' : ''}${v}`);
      };
      push('Affinity', h.delta.affinity);
      push('Trust', h.delta.trust);
      push('Familiarity', h.delta.familiarity);
      push('Fear', h.delta.fear);
      return { when: formatClockShort(h.t), text: h.text, deltas };
    });

  // Show how the relationship is steering behaviour right now.
  const influence: string[] = [];
  const other = getEntity(otherId);
  if (other && other.kind === 'settler') {
    influence.push(...modifierLines(socialModifiers(world, subject, other)));
    const avoid = avoidanceOf(world, subject, other);
    if (avoid > 22) influence.push(`Actively avoiding (pressure ${Math.round(avoid)})`);
  }

  return {
    ...summarizeRelationship(otherId, rel),
    subjectId,
    subjectName: subject.name,
    firstMetAt: rel.firstMetAt,
    history,
    influence,
  };
}

function agoText(now: number, t: number): string {
  const d = Math.max(0, now - t);
  if (d < 60) return `${Math.round(d)}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  return `${(d / 3600).toFixed(1)}h ago`;
}

function tone(v: number, invert = false): 'good' | 'warn' | 'bad' {
  const x = invert ? 100 - v : v;
  return x > 60 ? 'good' : x > 30 ? 'warn' : 'bad';
}

export function inspect(id: string): InspectorData | null {
  const world = getWorld();
  const now = world.timeSec;

  if (id === 'emerson') {
    const p = world.player;
    return {
      id,
      name: 'Emerson',
      subtitle: 'Human · Player · Male',
      kindLabel: 'PLAYER CHARACTER',
      place: placeName(p.pos),
      vitals: [
        { label: 'Health', value: p.health, tone: tone(p.health) },
        { label: 'Stamina', value: p.stamina, tone: tone(p.stamina) },
      ],
      goal: { label: 'Player-directed', reason: ['Emerson acts under your control in Live Mode.'] },
      scores: [],
      personality: [],
      needs: [],
      relationships: [],
      memories: [],
      known: [
        `Carrying ${p.berries} glowberr${p.berries === 1 ? 'y' : 'ies'}`,
        ...(p.wood > 0 ? [`Carrying ${Math.round(p.wood)} wood`] : []),
        ...(p.stone > 0 ? [`Carrying ${Math.round(p.stone)} stone`] : []),
      ],
    };
  }

  const e = getEntity(id);
  if (!e) return null;

  const memories = [...e.memories]
    .reverse()
    .slice(0, 6)
    .map((m) => ({ text: memoryText(m), ago: agoText(now, m.t) }));

  if (e.kind === 'settler') {
    const speciesDef = INTELLIGENT_SPECIES[e.speciesId as IntelligentSpeciesId];
    const rels = Object.entries(e.relationships)
      .map(([otherId, rel]) => summarizeRelationship(otherId, rel))
      // Strongest feelings first, in either direction.
      .sort((a, b) => Math.abs(b.affinity) + b.fear - (Math.abs(a.affinity) + a.fear))
      .slice(0, 6);
    const known = e.knownResourceIds
      .map((rid) => world.resources.find((r) => r.id === rid))
      .filter((r) => r && r.type !== 'restspot')
      .slice(0, 5)
      .map((r) => r!.label);
    if (e.inventory.glowberry > 0) {
      known.unshift(`Carrying ${e.inventory.glowberry} glowberr${e.inventory.glowberry === 1 ? 'y' : 'ies'}`);
    }
    if (e.knownLandmarkIds.length > 0) {
      const places = e.knownLandmarkIds
        .map((id) => LANDMARKS.find((l) => l.id === id)?.name)
        .filter(Boolean)
        .join(', ');
      known.unshift(`Has visited: ${places}`);
    }
    return {
      id,
      name: e.name,
      subtitle: `${speciesDef.name} · ${e.sex === 'female' ? 'Female' : 'Male'} · Adult`,
      kindLabel: 'INTELLIGENT SETTLER',
      place: placeName(e.pos),
      vitals: [
        { label: 'Health', value: e.health, tone: tone(e.health) },
        { label: 'Energy', value: e.energy, tone: tone(e.energy) },
        { label: 'Hunger', value: e.hunger, tone: tone(e.hunger, true) },
      ],
      goal: { label: e.goal.label, reason: e.goalReason.summary },
      scores: e.goalReason.scores,
      personality: [
        { label: 'Curiosity', value: e.personality.curiosity * 100, tone: 'accent' },
        { label: 'Sociability', value: e.personality.sociability * 100, tone: 'accent' },
        { label: 'Caution', value: e.personality.caution * 100, tone: 'accent' },
        { label: 'Aggression', value: e.personality.aggression * 100, tone: 'accent' },
        { label: 'Empathy', value: e.personality.empathy * 100, tone: 'accent' },
        { label: 'Initiative', value: e.personality.initiative * 100, tone: 'accent' },
      ],
      needs: [
        { label: 'Social', value: e.needs.social, tone: tone(e.needs.social, true) },
        { label: 'Curiosity', value: e.needs.curiosity, tone: tone(e.needs.curiosity, true) },
        { label: 'Safety', value: e.needs.safety, tone: tone(e.needs.safety, true) },
      ],
      relationships: rels,
      memories,
      known,
    };
  }

  // Creature.
  const def = CREATURE_SPECIES_BY_ID[e.speciesId];
  const data: InspectorData = {
    id,
    name: e.name,
    subtitle: `${def.name} · ${e.sex === 'female' ? 'Female' : 'Male'} · ${e.ageStage === 'juvenile' ? 'Juvenile' : 'Adult'}`,
    kindLabel: e.lumi ? 'NATIVE LIFEFORM · UNIQUE INDIVIDUAL' : 'NATIVE LIFEFORM',
    place: placeName(e.pos),
    vitals: [
      { label: 'Health', value: e.health, tone: tone(e.health) },
      { label: 'Energy', value: e.energy, tone: tone(e.energy) },
      { label: 'Hunger', value: e.hunger, tone: tone(e.hunger, true) },
      { label: 'Fear', value: e.fear, tone: tone(e.fear, true) },
    ],
    goal: { label: e.goal.label, reason: e.goalReason.summary },
    scores: [],
    personality: [
      { label: 'Curiosity', value: def.traits.curiosity * 100, tone: 'accent' },
      { label: 'Aggression', value: def.traits.aggression * 100, tone: 'accent' },
      { label: 'Sociability', value: def.traits.sociability * 100, tone: 'accent' },
      { label: 'Fearfulness', value: def.traits.fearfulness * 100, tone: 'accent' },
    ],
    needs: [],
    relationships: [],
    memories,
    known: [],
  };
  if (e.lumi) {
    data.trust = { label: 'Trust · Emerson', value: e.lumi.trust };
    if (e.lumi.following) data.known.push('Currently following Emerson');
    data.known.push(`Fed by Emerson ${e.lumi.fedCount}×`);
    data.known.push(`${Math.round(dist(e.pos, world.player.pos))}m from Emerson`);
  }
  return data;
}
