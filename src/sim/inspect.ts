import { SOCIAL, THREAT } from './config';
import { formatClock, formatClockShort } from './chronicle';
import { activeThreats, inCombat, insideSafeZone } from './combat';
import { purposeLabel } from './threats';
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
import {
  BELIEF_LABEL,
  customConfidence,
  customStatement,
  effectiveConfidence,
  peekBelief,
  provenanceOf,
} from './socialKnowledge';
import { CREATURE_SPECIES_BY_ID, INTELLIGENT_SPECIES } from './species';
import { constructionStage, frequentUsers, STAGE_LABEL, STRUCTURE_DEFS } from './structures';
import type { ClaimKind, IntelligentSpeciesId, Relationship, World } from './types';
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
  /**
   * Live combat state, for debugging a fight without guessing at it. Present
   * only on things that can actually be in one, so the panel does not grow a
   * permanently-empty section for every mossling in the valley.
   */
  combat?: CombatDebug;
}

export interface CombatDebug {
  state: string;
  /** How long it has been in that state. */
  forSeconds: number;
  /** Metres to Kai. */
  distance: number;
  lines: string[];
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

// ---------------------------------------------------------------------------
// Social knowledge (v0.6)
//
// Everything below describes the contents of ONE settler's head. The UI that
// renders it must say whose head, every time: none of it is a fact about the
// world, and some of it is wrong.
// ---------------------------------------------------------------------------

/** One belief a settler holds about what somebody else expects. */
export interface SocialKnowledgeRow {
  holderId: string;
  holderName: string;
  aboutId: string;
  aboutName: string;
  structureId: string;
  structureName: string;
  place: string;
  /** What the holder thinks that person expects. */
  belief: string;
  kind: ClaimKind;
  /** 0..100, already eroded by staleness. */
  confidence: number;
  provenance: string;
  secondHand: boolean;
  viaName: string | null;
  learnedAgo: string;
  confirmedAgo: string;
  confirmations: number;
  /** True once it has gone long enough unconfirmed to be doubtful. */
  stale: boolean;
}

export function socialKnowledgeOf(settlerId: string): SocialKnowledgeRow[] {
  const world = getWorld();
  const s = getEntity(settlerId);
  if (!s || s.kind !== 'settler') return [];
  const now = world.timeSec;
  return s.socialBeliefs
    .map((b) => {
      const st = world.structures.find((x) => x.id === b.structureId);
      const confidence = effectiveConfidence(world, b);
      return {
        holderId: s.id,
        holderName: s.name,
        aboutId: b.aboutId,
        aboutName: b.aboutName,
        structureId: b.structureId,
        structureName: st ? STRUCTURE_DEFS[st.type].name : 'somewhere gone',
        place: st?.place ?? 'unknown',
        belief: `${b.aboutName} ${BELIEF_LABEL[b.kind]}`,
        kind: b.kind,
        confidence: Math.round(confidence * 100),
        provenance: provenanceOf(b),
        secondHand: b.depth > 0,
        viaName: b.viaName ?? null,
        learnedAgo: agoText(now, b.learnedAt),
        confirmedAgo: agoText(now, b.lastConfirmedAt),
        confirmations: b.confirmations,
        stale: now - b.lastConfirmedAt > SOCIAL.staleHalfLife * 0.75,
      };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

/** One generalization a settler has drawn about a place. */
export interface LocalExpectationRow {
  holderId: string;
  holderName: string;
  place: string;
  statement: string;
  /** 0..100. Zero until enough has been seen to call it a pattern. */
  confidence: number;
  observations: number;
  supporting: number;
  contradicting: number;
  heldFor: string;
  /** How much this settler defers to local habit at all, 0..100. */
  conformity: number;
}

export function localExpectationsOf(settlerId: string): LocalExpectationRow[] {
  const world = getWorld();
  const s = getEntity(settlerId);
  if (!s || s.kind !== 'settler') return [];
  return s.protoCustoms
    .map((c) => ({
      holderId: s.id,
      holderName: s.name,
      place: c.place,
      statement: `${s.name} believes ${customStatement(c)}`,
      confidence: Math.round(customConfidence(world, c) * 100),
      observations: c.observations,
      supporting: Math.round(c.supporting * 10) / 10,
      contradicting: Math.round(c.contradicting * 10) / 10,
      heldFor: agoText(world.timeSec, c.firstAt),
      conformity: Math.round(s.values.conformity * 100),
    }))
    .filter((r) => r.observations > 1)
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Side-by-side comparison for one structure: what each involved settler
 * actually expects, against what the selected settler *thinks* they expect.
 *
 * The two columns are deliberately not reconciled. `mismatch` marks a
 * difference; it does not mark the viewer as wrong, because the panel showing
 * this is a god view and the settler living it has no such column.
 */
export interface PerspectiveRow {
  id: string;
  name: string;
  /** The claim this person genuinely holds, from the v0.5 model. */
  actualKind: ClaimKind;
  actualLabel: string;
  /** What the viewer believes they hold, if they have any view at all. */
  believedKind: ClaimKind | null;
  /** Full sentence, naming the believer — for anywhere without a column header. */
  believedLabel: string;
  /** Just the belief, for use under a column already headed "X believes". */
  believedShort: string;
  confidence: number;
  provenance: string | null;
  mismatch: boolean;
}

export function perspectiveOn(structureId: string, viewerId: string): PerspectiveRow[] {
  const world = getWorld();
  const st = world.structures.find((x) => x.id === structureId);
  const viewer = getEntity(viewerId);
  if (!st || !viewer || viewer.kind !== 'settler') return [];

  const out: PerspectiveRow[] = [];
  for (const c of claimantsOf(world, st)) {
    if (c.settler.id === viewer.id) continue;
    const belief = peekBelief(viewer, c.settler.id, st.id);
    const confidence = belief ? effectiveConfidence(world, belief) : 0;
    out.push({
      id: c.settler.id,
      name: c.settler.name,
      actualKind: c.claim.kind,
      actualLabel: c.claim.label,
      believedKind: belief?.kind ?? null,
      believedLabel: belief
        ? `${viewer.name} believes ${c.settler.name} ${BELIEF_LABEL[belief.kind]}`
        : `${viewer.name} does not know what ${c.settler.name} expects`,
      believedShort: belief
        ? `${c.settler.name} ${BELIEF_LABEL[belief.kind]}`
        : `Does not know what ${c.settler.name} expects`,
      confidence: Math.round(confidence * 100),
      provenance: belief ? provenanceOf(belief) : null,
      mismatch: Boolean(belief) && belief!.kind !== c.claim.kind,
    });
  }
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
  return id === 'emerson' ? 'Kai' : (getEntity(id)?.name ?? 'someone');
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
      name: 'Kai',
      subtitle: 'Human · Player · Male',
      kindLabel: 'PLAYER CHARACTER',
      place: placeName(p.pos),
      vitals: [
        { label: 'Health', value: p.health, tone: tone(p.health) },
        { label: 'Stamina', value: p.stamina, tone: tone(p.stamina) },
      ],
      goal: { label: 'Player-directed', reason: ['Kai acts under your control in Live Mode.'] },
      scores: [],
      personality: [],
      needs: [],
      relationships: [],
      memories: [],
      known: [
        `Carrying ${p.berries} glowberr${p.berries === 1 ? 'y' : 'ies'}`,
        ...(p.wood > 0 ? [`Carrying ${Math.round(p.wood)} wood`] : []),
        ...(p.stone > 0 ? [`Carrying ${Math.round(p.stone)} stone`] : []),
        ...(p.salvage.coreFragment > 0 ? [`Holding ${p.salvage.coreFragment} synthetic core fragment(s)`] : []),
        ...(p.extractions > 0 ? [`Emergency extractions: ${p.extractions}`] : []),
      ],
      combat: playerCombatDebug(world),
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
    data.trust = { label: 'Trust · Kai', value: e.lumi.trust };
    if (e.lumi.following) data.known.push('Currently following Kai');
    data.known.push(`Fed by Kai ${e.lumi.fedCount}×`);
    data.known.push(`${Math.round(dist(e.pos, world.player.pos))}m from Kai`);
  }
  if (e.combat && def.dangerous) {
    data.kindLabel = def.synthetic ? 'SYNTHETIC ORGANISM · ORIGIN UNKNOWN' : 'NATIVE LIFEFORM · DANGEROUS';
    // Health for a dangerous creature is measured against its own pool, not
    // the shared 0..100 the rest of the vitals use.
    data.vitals[0] = {
      label: 'Condition',
      value: Math.max(0, Math.min(100, (e.health / def.dangerous.health) * 100)),
      tone: tone((e.health / def.dangerous.health) * 100),
    };
    const d = dist(e.pos, world.player.pos);
    const resist = def.dangerous.staggerResist;
    const lines = [
      `Damage ${def.dangerous.damage} · reach ${def.dangerous.attackRange}m · cooldown ${def.dangerous.cooldown}s`,
      `Notices at ${THREAT.noticeRange}m · warns inside ${THREAT.provokeRange}m`,
      `Leash ${Math.round(dist(e.pos, e.combat.territory))}m / ${THREAT.leash}m from its ground`,
      // Stagger is invisible in Live Mode by design; Creator Mode is exactly
      // where it should be legible, because that is where a fight gets debugged.
      `Stagger ${Math.round(e.combat.staggerLoad)} / ${resist}` +
        (world.timeSec < e.combat.staggerImmuneUntil
          ? ` · immune for ${(e.combat.staggerImmuneUntil - world.timeSec).toFixed(1)}s`
          : ''),
      `Off duty it is: ${purposeLabel(e).toLowerCase()}`,
      e.combat.targetId ? `Engaged with ${e.combat.targetId}` : 'No target',
      world.timeSec < e.combat.nextAttackAt
        ? `Next attack available in ${(e.combat.nextAttackAt - world.timeSec).toFixed(1)}s`
        : 'Attack available now',
    ];
    data.combat = {
      state: e.combat.state,
      forSeconds: world.timeSec - e.combat.since,
      distance: d,
      lines,
    };
  }
  return data;
}

/** What Kai's own combat state looks like from Creator Mode. */
function playerCombatDebug(world: World): CombatDebug {
  const p = world.player;
  const threats = activeThreats(world);
  const lines: string[] = [
    p.equipped === 'arcBlade' ? 'Armed: Arc Blade Mk I' : 'Unarmed — no weapon fabricated',
    p.strike
      ? `Strike: ${p.strike.kind} · ${p.strike.phase} · chain ${p.strike.chain} · ${p.strike.timer.toFixed(2)}s left`
      : 'Not attacking',
    p.buffered ? `Buffered: ${p.buffered.kind} (${(p.buffered.age * 1000).toFixed(0)}ms old)` : 'No queued input',
    p.unlocks.capacitor ? 'Arc Blade Capacitor installed — stagger ×1.55' : 'No blade upgrade',
    world.timeSec < p.invulnUntil
      ? `Invulnerable for ${(p.invulnUntil - world.timeSec).toFixed(2)}s`
      : p.dodgeCooldown > 0
        ? `Dodge on cooldown ${p.dodgeCooldown.toFixed(2)}s`
        : 'Dodge ready',
    p.lockedId ? `Locked onto ${p.lockedId}` : 'No lock',
    insideSafeZone(world, p.pos.x, p.pos.z) ? 'Inside the Human Landing safe zone' : 'Outside the safe zone',
    `${threats.length} creature(s) currently hostile`,
  ];
  return {
    state: p.extraction ? 'extracting' : inCombat(world) ? 'in combat' : 'clear',
    forSeconds: world.timeSec - p.lastHurtAt,
    distance: 0,
    lines,
  };
}
