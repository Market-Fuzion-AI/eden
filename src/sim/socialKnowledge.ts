import { SOCIAL } from './config';
import { placeName } from './landmarks';
import { peekRelationship } from './relationships';
import { STRUCTURE_DEFS } from './structures';
import type {
  BeliefSource,
  ClaimKind,
  CustomTopic,
  EntityId,
  ProtoCustom,
  Settler,
  SocialBelief,
  Structure,
  WitnessedNorm,
  World,
} from './types';
import { clamp01, dist } from './vec';

/**
 * SHARED EXPECTATIONS — private expectation becoming social knowledge.
 *
 * v0.5 gave every settler their own reading of a place. This file gives them a
 * reading of *each other*: "I believe Sareth treats that shelter as hers."
 *
 * CRITICAL: there is no objective social truth anywhere in EDEN. Nothing in
 * this module writes to a structure, a settlement or the world. Every belief
 * and every generalization is stored on the individual who holds it, and the
 * simulation never reconciles one person's model of another against what that
 * person actually thinks. Being wrong is a first-class state.
 *
 * Inaccuracy is never injected as noise. It arises only from four honest
 * causes:
 *   - you did not see it (proximity gates every observation),
 *   - you heard it from someone who heard it (confidence decays per hop),
 *   - it was true when you learned it and has since drifted (staleness),
 *   - nobody announces a change of heart (quiet tolerance is invisible).
 */

// ---------------------------------------------------------------------------
// Provenance vocabulary
// ---------------------------------------------------------------------------

const SOURCE_LABEL: Record<BeliefSource, string> = {
  'told-by-them': 'they said so themselves',
  granted: 'saw them give someone leave',
  refused: 'saw them turn someone away',
  objected: 'saw them take exception',
  tolerated: 'saw them let it pass',
  'heard-from': 'heard it from someone',
};

/** Base confidence implied by how directly a belief was acquired. */
function sourceConfidence(source: BeliefSource): number {
  switch (source) {
    case 'told-by-them':
      return SOCIAL.confidenceDirect;
    case 'heard-from':
      return SOCIAL.confidenceHearsay;
    default:
      return SOCIAL.confidenceWitnessed;
  }
}

/** Human-readable provenance, including who passed it on. */
export function provenanceOf(b: SocialBelief): string {
  if (b.source === 'heard-from') {
    return b.viaName ? `heard from ${b.viaName}` : SOURCE_LABEL[b.source];
  }
  return SOURCE_LABEL[b.source];
}

export const BELIEF_LABEL: Record<ClaimKind, string> = {
  none: 'has no stake in it',
  public: 'treats it as everyone\'s',
  shared: 'treats it as shared',
  personal: 'treats it as their own',
};

// ---------------------------------------------------------------------------
// Belief store (bounded, per agent)
// ---------------------------------------------------------------------------

export function peekBelief(s: Settler, aboutId: EntityId, structureId: EntityId): SocialBelief | undefined {
  return s.socialBeliefs.find((b) => b.aboutId === aboutId && b.structureId === structureId);
}

/**
 * Effective confidence: what is stored, eroded by how long it has been since
 * anything confirmed it. A settler who learned something two days ago and has
 * not been back is not as sure as they were.
 */
export function effectiveConfidence(world: World, b: SocialBelief): number {
  const age = Math.max(0, world.timeSec - b.lastConfirmedAt);
  const staleness = Math.pow(0.5, age / SOCIAL.staleHalfLife);
  return clamp01(b.confidence * staleness);
}

/** Drop the least useful belief when over budget, and forget dead structures. */
function trimBeliefs(world: World, s: Settler): void {
  if (s.socialBeliefs.length <= SOCIAL.maxBeliefs) return;
  // Weakest-first: whatever the settler is least sure of goes.
  const scored = s.socialBeliefs.map((b) => ({ b, c: effectiveConfidence(world, b) }));
  scored.sort((x, y) => x.c - y.c);
  const drop = new Set(scored.slice(0, s.socialBeliefs.length - SOCIAL.maxBeliefs).map((x) => x.b));
  s.socialBeliefs = s.socialBeliefs.filter((b) => !drop.has(b));
}

export interface RecordBeliefInput {
  about: { id: EntityId; name: string };
  structureId: EntityId;
  kind: ClaimKind;
  source: BeliefSource;
  /** Hops from the original witness. 0 for anything seen or heard first-hand. */
  depth?: number;
  via?: { id: EntityId; name: string };
  /** Multiplier applied to the source's base confidence (trust, distance…). */
  weight?: number;
}

export interface BeliefChange {
  belief: SocialBelief;
  /** True when this replaced a belief that said something different. */
  corrected: boolean;
  /** What the settler previously thought, when corrected. */
  previousKind: ClaimKind | null;
  /** Previous effective confidence — how wrong they were, not just that they were. */
  previousConfidence: number;
}

/**
 * Learn (or re-learn) what someone expects about a place.
 *
 * Agreement with an existing belief raises confidence and refreshes it;
 * disagreement replaces it, but only if the new evidence is at least as good as
 * the old — being told something second-hand does not overturn what you watched
 * happen yesterday.
 */
export function recordBelief(world: World, s: Settler, input: RecordBeliefInput): BeliefChange | null {
  if (s.id === input.about.id) return null; // you do not have beliefs about yourself
  const t = world.timeSec;
  const depth = input.depth ?? 0;
  if (depth > SOCIAL.maxDepth) return null;

  const incoming = clamp01(sourceConfidence(input.source) * (input.weight ?? 1));
  if (incoming < SOCIAL.minConfidence) return null;

  const existing = peekBelief(s, input.about.id, input.structureId);
  if (existing) {
    const held = effectiveConfidence(world, existing);
    if (existing.kind === input.kind) {
      // Confirmation: more sure, and freshly dated.
      existing.confidence = Math.min(
        SOCIAL.maxConfidence,
        Math.max(existing.confidence, incoming) + SOCIAL.confirmBonus,
      );
      existing.lastConfirmedAt = t;
      existing.confirmations++;
      // A first-hand sighting upgrades the provenance of something once heard.
      if (depth < existing.depth) {
        existing.depth = depth;
        existing.source = input.source;
        existing.viaId = undefined;
        existing.viaName = undefined;
      }
      return { belief: existing, corrected: false, previousKind: null, previousConfidence: held };
    }
    // Contradiction. Better or equal evidence wins; weaker evidence only dents
    // what is already held, which is how a settler stays wrong for a while.
    if (incoming < held * 0.85) {
      existing.confidence = Math.max(SOCIAL.minConfidence, existing.confidence * 0.86);
      return null;
    }
    const previousKind = existing.kind;
    existing.kind = input.kind;
    existing.source = input.source;
    existing.confidence = incoming;
    existing.learnedAt = t;
    existing.lastConfirmedAt = t;
    existing.depth = depth;
    existing.viaId = input.via?.id;
    existing.viaName = input.via?.name;
    existing.confirmations = 0;
    return { belief: existing, corrected: true, previousKind, previousConfidence: held };
  }

  const belief: SocialBelief = {
    aboutId: input.about.id,
    aboutName: input.about.name,
    structureId: input.structureId,
    kind: input.kind,
    source: input.source,
    confidence: incoming,
    learnedAt: t,
    lastConfirmedAt: t,
    depth,
    viaId: input.via?.id,
    viaName: input.via?.name,
    confirmations: 0,
  };
  s.socialBeliefs.push(belief);
  trimBeliefs(world, s);
  return { belief, corrected: false, previousKind: null, previousConfidence: 0 };
}

/** Forget beliefs about structures that no longer exist, and faded ones. */
export function pruneSocialKnowledge(world: World, s: Settler): void {
  s.socialBeliefs = s.socialBeliefs.filter(
    (b) =>
      world.structures.some((st) => st.id === b.structureId) &&
      effectiveConfidence(world, b) >= SOCIAL.minConfidence,
  );
  s.protoCustoms = s.protoCustoms.filter((c) => customWeight(world, c) > 0.35);
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

/** Everyone close enough to have seen something happen at `pos`. */
export function witnessesOf(world: World, pos: { x: number; z: number }, exclude: EntityId[]): Settler[] {
  return world.settlers.filter(
    (w) => !exclude.includes(w.id) && !w.resting && dist(w.pos, pos) <= SOCIAL.witnessRange,
  );
}

/** Confidence weight for a witness: what you see up close, you see better. */
function witnessWeight(world: World, w: Settler, pos: { x: number; z: number }): number {
  const d = dist(w.pos, pos);
  return clamp01(1 - (d / SOCIAL.witnessRange) * 0.45);
}

export interface ObservationInput {
  /** Whose expectation was on display. */
  about: { id: EntityId; name: string };
  structure: Structure;
  kind: ClaimKind;
  source: BeliefSource;
  /** Parties to the event — they learn first-hand, not as bystanders. */
  participants: { id: EntityId; name: string }[];
  /**
   * How the parties themselves read it. Defaults to being told outright, but
   * silent tolerance is a much weaker signal than a spoken refusal.
   */
  participantSource?: BeliefSource;
  /** Overall clarity of the signal, 0..1. */
  weight?: number;
  /** Which proto-custom topics this event is evidence for or against. */
  custom?: { topic: CustomTopic; supports: boolean }[];
}

/**
 * Publish a social event to whoever could actually perceive it.
 *
 * This is the only route by which knowledge of someone's expectations spreads
 * by sight, and it is gated purely on proximity: a settler across the valley
 * learns nothing, however dramatic the scene.
 */
export function observeEvent(world: World, ev: ObservationInput): Settler[] {
  const learned: Settler[] = [];
  const participantIds = ev.participants.map((p) => p.id);
  const weight = ev.weight ?? 1;
  const noteCustoms = (s: Settler) => {
    for (const c of ev.custom ?? []) noteCustomEvidence(world, s, c.topic, ev.structure.pos, c.supports);
  };

  // The other party to the event learns it first-hand — it happened to them.
  for (const p of ev.participants) {
    if (p.id === ev.about.id) continue;
    const s = world.settlers.find((x) => x.id === p.id);
    if (!s) continue;
    const change = recordBelief(world, s, {
      about: ev.about,
      structureId: ev.structure.id,
      kind: ev.kind,
      source: ev.participantSource ?? 'told-by-them',
      weight,
    });
    if (change) learned.push(s);
    noteCustoms(s);
  }

  // Bystanders learn by watching, less certainly.
  for (const w of witnessesOf(world, ev.structure.pos, [...participantIds, ev.about.id])) {
    const change = recordBelief(world, w, {
      about: ev.about,
      structureId: ev.structure.id,
      kind: ev.kind,
      source: ev.source,
      weight: witnessWeight(world, w, ev.structure.pos) * weight,
    });
    if (change) learned.push(w);
    noteCustoms(w);
  }
  return learned;
}

// ---------------------------------------------------------------------------
// Proto-custom: an individual's generalization about a place
// ---------------------------------------------------------------------------

export const CUSTOM_STATEMENT: Record<CustomTopic, string> = {
  'ask-first': 'people around %s usually ask before using someone else\'s shelter',
  'shelters-shared': 'shelters around %s are treated as common ground',
};

export function customStatement(c: ProtoCustom): string {
  return CUSTOM_STATEMENT[c.topic].replace('%s', c.place);
}

/** Time-decayed total evidence behind a generalization. */
function customWeight(world: World, c: ProtoCustom): number {
  const decay = Math.exp(-SOCIAL.customEvidenceDecayPerSec * Math.max(0, world.timeSec - c.lastAt));
  return (c.supporting + c.contradicting) * decay;
}

/**
 * How sure a settler is of a generalization.
 *
 * Zero until they have seen the pattern several times — one event is an
 * anecdote, not a custom — then the balance of evidence, capped well short of
 * certainty and eroded by anything that contradicts it.
 */
export function customConfidence(world: World, c: ProtoCustom): number {
  if (c.observations < SOCIAL.minCustomEvidence) return 0;
  const decay = Math.exp(-SOCIAL.customEvidenceDecayPerSec * Math.max(0, world.timeSec - c.lastAt));
  const support = c.supporting * decay;
  const against = c.contradicting * decay;
  const total = support + against;
  if (total <= 0) return 0;
  const balance = support / total;
  if (balance <= 0.5) return 0; // the evidence does not support the generalization
  // Volume matters as well as balance: a rule seen ten times beats one seen three.
  const volume = clamp01((total - SOCIAL.minCustomEvidence + 1) / 6);
  return clamp01((balance - 0.5) * 2 * (0.45 + 0.55 * volume)) * SOCIAL.maxCustomConfidence;
}

function trimCustoms(world: World, s: Settler): void {
  if (s.protoCustoms.length <= SOCIAL.maxCustoms) return;
  const scored = s.protoCustoms.map((c) => ({ c, w: customWeight(world, c) }));
  scored.sort((a, b) => a.w - b.w);
  const drop = new Set(scored.slice(0, s.protoCustoms.length - SOCIAL.maxCustoms).map((x) => x.c));
  s.protoCustoms = s.protoCustoms.filter((c) => !drop.has(c));
}

/**
 * Add one observation to a settler's sense of how things are done around here.
 *
 * Evidence already banked decays before the new observation is added, so a
 * generalization that stops being reinforced quietly loses its grip instead of
 * standing forever.
 */
export function noteCustomEvidence(
  world: World,
  s: Settler,
  topic: CustomTopic,
  pos: { x: number; z: number },
  supports: boolean,
): ProtoCustom {
  const t = world.timeSec;
  const place = placeName(pos);
  let c = s.protoCustoms.find((x) => x.topic === topic && x.place === place);
  if (!c) {
    c = {
      topic,
      place,
      pos: { x: pos.x, z: pos.z },
      supporting: 0,
      contradicting: 0,
      observations: 0,
      firstAt: t,
      lastAt: t,
    };
    s.protoCustoms.push(c);
  }
  const decay = Math.exp(-SOCIAL.customEvidenceDecayPerSec * Math.max(0, t - c.lastAt));
  c.supporting *= decay;
  c.contradicting *= decay;
  if (supports) c.supporting += 1;
  else c.contradicting += 1;
  c.observations++;
  c.lastAt = t;
  trimCustoms(world, s);
  return c;
}

/** The generalization this settler holds about a place, if it has any force. */
export function customFor(
  world: World,
  s: Settler,
  topic: CustomTopic,
  pos: { x: number; z: number },
): { custom: ProtoCustom; confidence: number } | null {
  let best: { custom: ProtoCustom; confidence: number } | null = null;
  for (const c of s.protoCustoms) {
    if (c.topic !== topic) continue;
    // A generalization about the meadow says nothing about the far ridge.
    if (dist(c.pos, pos) > SOCIAL.customRadius) continue;
    const confidence = customConfidence(world, c);
    if (confidence <= 0) continue;
    if (!best || confidence > best.confidence) best = { custom: c, confidence };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Social prediction
// ---------------------------------------------------------------------------

export type PredictionBasis = 'belief' | 'custom' | 'projection';

export interface Prediction {
  /** What `s` expects `other` to think about this place. */
  kind: ClaimKind;
  /** 0..1 — how sure they are. Never 1. */
  confidence: number;
  basis: PredictionBasis;
  /** Readable justification, surfaced verbatim in the goal WHY. */
  why: string[];
  belief?: SocialBelief;
}

/**
 * What does `s` think `other` expects about this structure?
 *
 * Three fallbacks, in descending order of quality:
 *   1. A belief they actually hold about this person and this place.
 *   2. A generalization about how places like this are treated around here.
 *   3. Naive projection — assuming others feel as they do.
 *
 * Note what is *not* here: any read of `other`'s real attitude. A settler can
 * only act on what they have learned, and step 3 is how a newcomer with no
 * social knowledge at all still manages to have an opinion — usually a wrong one.
 */
export function predictClaim(world: World, s: Settler, other: Settler, structure: Structure): Prediction {
  const belief = peekBelief(s, other.id, structure.id);
  if (belief) {
    const confidence = effectiveConfidence(world, belief);
    if (confidence >= SOCIAL.minConfidence) {
      const why = [
        `Believes ${other.name} ${BELIEF_LABEL[belief.kind]} (${Math.round(confidence * 100)}% sure — ${provenanceOf(belief)})`,
      ];
      const age = world.timeSec - belief.lastConfirmedAt;
      if (age > SOCIAL.staleHalfLife * 0.75) why.push('Though it has been a while since they last saw it');
      if (belief.depth > 0) why.push(`Second-hand (${belief.depth} step${belief.depth === 1 ? '' : 's'} removed)`);
      return { kind: belief.kind, confidence, basis: 'belief', why, belief };
    }
  }

  // No knowledge of this individual — fall back on how things are usually done.
  const askCustom = customFor(world, s, 'ask-first', structure.pos);
  const sharedCustom = customFor(world, s, 'shelters-shared', structure.pos);
  const custom =
    askCustom && (!sharedCustom || askCustom.confidence >= sharedCustom.confidence) ? askCustom : sharedCustom;
  if (custom) {
    // How much a local habit sways them is a matter of temperament.
    const weight = custom.confidence * SOCIAL.customSubstituteWeight * (0.35 + 0.65 * s.values.conformity);
    if (weight >= SOCIAL.minConfidence) {
      const kind: ClaimKind = custom.custom.topic === 'ask-first' ? 'personal' : 'shared';
      return {
        kind,
        confidence: weight,
        basis: 'custom',
        why: [
          `Does not know what ${other.name} thinks of it`,
          `But ${customStatement(custom.custom)} (${Math.round(custom.confidence * 100)}% sure)`,
          s.values.conformity < 0.4
            ? `Independent-minded — local habit counts for less (conformity ${Math.round(s.values.conformity * 100)})`
            : `Inclined to go along with local habit (conformity ${Math.round(s.values.conformity * 100)})`,
        ],
      };
    }
  }

  // Nothing learned at all: assume they feel about it the way you would.
  const ownership = (s.values.individualism + s.values.territoriality) / 2;
  const kind: ClaimKind = ownership > 0.58 ? 'personal' : ownership > 0.42 ? 'shared' : 'public';
  return {
    kind,
    confidence: SOCIAL.projectionConfidence,
    basis: 'projection',
    why: [
      `Knows nothing of what ${other.name} expects here`,
      ownership > 0.58
        ? 'Assumes they would mind, because they would'
        : ownership > 0.42
          ? 'Assumes it is probably shared, as they would treat it'
          : 'Assumes nobody minds, because they would not',
    ],
  };
}

// ---------------------------------------------------------------------------
// Who does this settler think would object?
// ---------------------------------------------------------------------------

export interface BelievedBlocker {
  settler: Settler;
  prediction: Prediction;
  /** Visible reason to think this person has any stake here at all. */
  visibleTie: string;
}

/**
 * Whoever `s` *believes* would treat their use of this place as an intrusion.
 *
 * Candidates come from publicly observable facts — who staked the site, who
 * hauled for it — because construction happens in the open over hours and
 * anyone can see it. What those people privately *expect* is not observable,
 * so that part comes entirely from `predictClaim`.
 */
export function believedBlocker(world: World, s: Settler, structure: Structure): BelievedBlocker | null {
  let best: BelievedBlocker | null = null;
  const totalEffort = structure.contributions.reduce((sum, c) => sum + c.wood + c.stone + c.work * 20, 0);

  for (const other of world.settlers) {
    if (other.id === s.id) continue;
    const contribution = structure.contributions.find((c) => c.id === other.id);
    const isInitiator = structure.initiatorId === other.id;
    const hasBelief = Boolean(peekBelief(s, other.id, structure.id));
    if (!contribution && !isInitiator && !hasBelief) continue;

    const prediction = predictClaim(world, s, other, structure);
    if (prediction.kind !== 'personal' && prediction.kind !== 'shared') continue;

    const effort = contribution ? (contribution.wood + contribution.stone + contribution.work * 20) : 0;
    const share = totalEffort > 0 ? effort / totalEffort : 0;
    const visibleTie = isInitiator
      ? `${other.name} put it up`
      : share > 0.01
        ? `${other.name} did ${Math.round(share * 100)}% of the work on it`
        : `${other.name} has a history with the place`;

    // Rank by how much of a problem this person is expected to be.
    const strength = (prediction.kind === 'personal' ? 1 : 0.4) * prediction.confidence + share * 0.2;
    const bestStrength = best
      ? (best.prediction.kind === 'personal' ? 1 : 0.4) * best.prediction.confidence
      : -1;
    if (!best || strength > bestStrength) best = { settler: other, prediction, visibleTie };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Word of mouth
// ---------------------------------------------------------------------------

export interface TransmissionResult {
  belief: SocialBelief;
  aboutName: string;
  structureId: EntityId;
  /** Deterministic line describing what was said. */
  line: string;
}

/**
 * Pick the one thing `speaker` would most plausibly mention to `listener`.
 *
 * Deliberately narrow: a settler passes on at most one expectation per
 * conversation, only about someone the listener could care about, and never
 * something already known better than they could tell it. Most conversations
 * are still about the water and the ridge.
 */
export function chooseTransmission(world: World, speaker: Settler, listener: Settler): SocialBelief | null {
  let best: SocialBelief | null = null;
  let bestScore = 0;
  for (const b of speaker.socialBeliefs) {
    // Nobody relays your own opinion of a place back to you, or gossips to
    // someone about themselves.
    if (b.aboutId === listener.id) continue;
    if (b.depth >= SOCIAL.maxDepth) continue; // the chain stops here
    const confidence = effectiveConfidence(world, b);
    if (confidence < SOCIAL.minConfidence * 2) continue;

    const known = peekBelief(listener, b.aboutId, b.structureId);
    if (known) {
      // Only worth saying if you are meaningfully surer than they are.
      const theirs = effectiveConfidence(world, known);
      if (known.kind === b.kind && theirs >= confidence * 0.8) continue;
      if (known.kind !== b.kind && theirs > confidence) continue;
    }
    // People talk about what they are sure of and what is recent.
    const recency = Math.pow(0.5, Math.max(0, world.timeSec - b.lastConfirmedAt) / SOCIAL.staleHalfLife);
    const score = confidence * (0.5 + 0.5 * recency) + (known ? 0.15 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return best;
}

/**
 * Pass one belief along. Provenance survives the hop: the listener records that
 * they heard it from the speaker, at a lower confidence scaled by how much they
 * trust them. Nobody ever becomes more certain by being told something.
 */
export function transmitBelief(
  world: World,
  speaker: Settler,
  listener: Settler,
  belief: SocialBelief,
): TransmissionResult | null {
  const rel = peekRelationship(listener, speaker.id);
  // Trust in the teller decides how much of it sticks.
  const trustFactor = 0.45 + clamp01((rel?.trust ?? 0) / 100) * 0.55;
  const speakerConfidence = effectiveConfidence(world, belief);
  const weight =
    (speakerConfidence / SOCIAL.confidenceHearsay) * SOCIAL.hearsayFactor * trustFactor;

  const change = recordBelief(world, listener, {
    about: { id: belief.aboutId, name: belief.aboutName },
    structureId: belief.structureId,
    kind: belief.kind,
    source: 'heard-from',
    depth: belief.depth + 1,
    via: { id: speaker.id, name: speaker.name },
    weight,
  });
  if (!change) return null;

  speaker.lastNormTalkAt = world.timeSec;
  const structure = world.structures.find((st) => st.id === belief.structureId);
  const where = structure
    ? `the ${STRUCTURE_DEFS[structure.type].name.toLowerCase()} at ${structure.place}`
    : 'that place';
  return {
    belief: change.belief,
    aboutName: belief.aboutName,
    structureId: belief.structureId,
    line: `${belief.aboutName} ${BELIEF_LABEL[belief.kind]} — ${where}`,
  };
}

// ---------------------------------------------------------------------------
// Readable summaries (Creator Mode)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// What Emerson has seen
//
// ARI is a companion standing in the valley, not a readout of simulation
// state. She may only ever speak about events Emerson was physically present
// for, which is what this bounded list records.
// ---------------------------------------------------------------------------

const MAX_WITNESSED = 10;

/** Has Emerson personally seen this person act on a claim to this place? */
export function emersonKnows(world: World, structureId: EntityId, aboutId: EntityId): WitnessedNorm | null {
  return world.player.witnessed.find((w) => w.structureId === structureId && w.aboutId === aboutId) ?? null;
}

/** Everything Emerson has seen about a given place, most recent first. */
export function emersonKnowledgeOf(world: World, structureId: EntityId): WitnessedNorm[] {
  return world.player.witnessed.filter((w) => w.structureId === structureId).slice().reverse();
}

/**
 * Record something Emerson saw with his own eyes, and have ARI remark on it.
 * Silently does nothing when he was not close enough to see it.
 */
export function witnessNorm(
  world: World,
  structure: Structure,
  about: Settler,
  kind: ClaimKind,
  text: string,
  requireProximity = true,
): boolean {
  const p = world.player;
  if (p.dead) return false;
  if (requireProximity && dist(p.pos, structure.pos) > SOCIAL.witnessRange) return false;

  const existing = p.witnessed.find((w) => w.structureId === structure.id && w.aboutId === about.id);
  if (existing) {
    const changed = existing.kind !== kind;
    existing.kind = kind;
    existing.text = text;
    existing.t = world.timeSec;
    if (!changed) return false;
  } else {
    p.witnessed.push({
      structureId: structure.id,
      aboutId: about.id,
      aboutName: about.name,
      kind,
      text,
      t: world.timeSec,
    });
    if (p.witnessed.length > MAX_WITNESSED) p.witnessed.splice(0, p.witnessed.length - MAX_WITNESSED);
  }
  world.ariQueue.push(
    `${about.name} ${text} — the ${STRUCTURE_DEFS[structure.type].name.toLowerCase()} at ${structure.place}.`,
  );
  return true;
}

/** One line describing a belief and how sure its holder is. */
export function beliefLine(world: World, b: SocialBelief, structure: Structure | undefined): string {
  const where = structure
    ? `the ${STRUCTURE_DEFS[structure.type].name.toLowerCase()} at ${structure.place}`
    : 'a place that is gone';
  return `${b.aboutName} ${BELIEF_LABEL[b.kind]} — ${where} (${Math.round(effectiveConfidence(world, b) * 100)}%)`;
}
