import { REL } from './config';
import type { EntityId, Relationship, RelationshipEvent, Settler, World } from './types';
import { clamp } from './vec';

/**
 * Structured pairwise relationships.
 *
 * Four dimensions, deliberately shallow — this is not a psychology engine:
 *   affinity     -100..100  liking, moved by the tone of interactions
 *   trust           0..100  reliability, earned by costly help, lost by harm
 *   familiarity     0..100  how well known, grows with any contact
 *   fear            0..100  reluctance to be near them at all
 *
 * Relationships are created only when a meaningful interaction occurs, and
 * every change appends a structured history entry so Creator Mode can show a
 * real record rather than a fabricated narrative.
 */

export type RelationshipState = 'Hostile' | 'Wary' | 'Neutral' | 'Familiar' | 'Friendly' | 'Bonded';

export const REL_STATE_ORDER: RelationshipState[] = [
  'Hostile',
  'Wary',
  'Neutral',
  'Familiar',
  'Friendly',
  'Bonded',
];

/** Derive the readable state from the four dimensions. */
export function relationshipState(rel: Relationship): RelationshipState {
  if (rel.fear > 55 || rel.affinity <= -45) return 'Hostile';
  if (rel.affinity <= -15 || rel.fear > 30) return 'Wary';
  if (rel.affinity >= 60 && rel.trust >= 55 && rel.familiarity >= 55) return 'Bonded';
  if (rel.affinity >= 30 && rel.trust >= 25) return 'Friendly';
  if (rel.familiarity >= 30) return 'Familiar';
  return 'Neutral';
}

export function emptyRelationship(t: number): Relationship {
  return {
    affinity: 0,
    trust: 0,
    familiarity: 0,
    fear: 0,
    interactions: 0,
    lastInteractionAt: -999,
    firstMetAt: t,
    lastConflictAt: -999,
    history: [],
  };
}

/** Fetch or create the relationship record from `s` toward `otherId`. */
export function relationshipWith(s: Settler, otherId: EntityId, t: number): Relationship {
  let rel = s.relationships[otherId];
  if (!rel) rel = s.relationships[otherId] = emptyRelationship(t);
  return rel;
}

/** Read-only lookup — does not create a record. */
export function peekRelationship(s: Settler, otherId: EntityId): Relationship | undefined {
  return s.relationships[otherId];
}

export interface RelationshipDelta {
  affinity?: number;
  trust?: number;
  familiarity?: number;
  fear?: number;
}

/**
 * Apply a change and record it in the pair's history.
 * `kind` and `text` describe what happened, in the world's own terms.
 */
export function applyRelationship(
  world: World,
  s: Settler,
  otherId: EntityId,
  otherName: string,
  kind: RelationshipEvent['kind'],
  text: string,
  delta: RelationshipDelta,
): Relationship {
  const t = world.timeSec;
  const rel = relationshipWith(s, otherId, t);
  if (delta.affinity) rel.affinity = clamp(rel.affinity + delta.affinity, -100, 100);
  if (delta.trust) rel.trust = clamp(rel.trust + delta.trust, 0, 100);
  if (delta.familiarity) rel.familiarity = clamp(rel.familiarity + delta.familiarity, 0, 100);
  if (delta.fear) rel.fear = clamp(rel.fear + delta.fear, 0, 100);
  rel.interactions++;
  rel.lastInteractionAt = t;
  if (kind === 'conflict') rel.lastConflictAt = t;

  rel.history.push({
    t,
    kind,
    text,
    withName: otherName,
    affinity: Math.round(rel.affinity),
    trust: Math.round(rel.trust),
    delta: {
      affinity: Math.round(delta.affinity ?? 0),
      trust: Math.round(delta.trust ?? 0),
      familiarity: Math.round(delta.familiarity ?? 0),
      fear: Math.round(delta.fear ?? 0),
    },
  });
  if (rel.history.length > REL.maxHistory) {
    rel.history.splice(0, rel.history.length - REL.maxHistory);
  }
  return rel;
}

// ---------------------------------------------------------------------------
// Utility modifiers — how a relationship changes future goal selection
// ---------------------------------------------------------------------------

export interface UtilityModifier {
  label: string;
  value: number;
}

/**
 * Social attraction between `s` and `other`, decomposed into named
 * contributions so the inspector can show exactly why a partner was chosen.
 * Positive pulls them together; negative pushes them apart.
 */
export function socialModifiers(world: World, s: Settler, other: Settler): UtilityModifier[] {
  const mods: UtilityModifier[] = [];
  const rel = peekRelationship(s, other.id);

  if (!rel) {
    // Strangers are interesting to the curious, and a mild risk to the cautious.
    const curiosityPull = Math.round(s.personality.curiosity * 10 - s.personality.caution * 8);
    if (curiosityPull !== 0) mods.push({ label: 'Stranger', value: curiosityPull });
    if (other.speciesId === s.speciesId) mods.push({ label: 'Same people', value: 6 });
    return mods;
  }

  const state = relationshipState(rel);
  mods.push({ label: `Affinity ${rel.affinity >= 0 ? '+' : ''}${Math.round(rel.affinity)}`, value: Math.round(rel.affinity * 0.35) });

  if (state === 'Bonded') mods.push({ label: 'Bonded companion', value: 30 });
  else if (state === 'Friendly') mods.push({ label: 'Trusted friend', value: 21 });
  else if (state === 'Hostile') mods.push({ label: 'Hostility', value: -45 });
  else if (state === 'Wary') mods.push({ label: 'Wariness', value: -18 });

  if (rel.familiarity > 20) {
    mods.push({ label: 'Familiar face', value: Math.round(rel.familiarity * 0.12) });
  }
  if (rel.trust > 30) {
    mods.push({ label: 'Trusts them', value: Math.round(rel.trust * 0.14) });
  }
  // Fear dominates: a frightened settler does not choose to be near someone.
  if (rel.fear > 10) {
    mods.push({ label: 'Fear', value: -Math.round(rel.fear * (0.5 + s.personality.caution * 0.7)) });
  }
  // A fresh conflict keeps people apart for a while regardless of affinity.
  if (world.timeSec - rel.lastConflictAt < REL.conflictChill) {
    mods.push({ label: 'Recent conflict', value: -24 });
  }
  // Warm memories add a little on top of the running average.
  const positive = s.memories.filter(
    (m) => m.subjectId === other.id && m.emotionalWeight > 0.3 && world.timeSec - m.t < REL.memoryWindow,
  ).length;
  if (positive > 0) mods.push({ label: 'Positive memories', value: Math.min(12, positive * 6) });

  if (other.speciesId === s.speciesId) mods.push({ label: 'Same people', value: 6 });
  return mods;
}

export function sumModifiers(mods: UtilityModifier[]): number {
  let total = 0;
  for (const m of mods) total += m.value;
  return total;
}

/** Render modifiers as inspector-ready lines. */
export function modifierLines(mods: UtilityModifier[]): string[] {
  return mods
    .filter((m) => m.value !== 0)
    .map((m) => `${m.label} ${m.value >= 0 ? '+' : ''}${m.value}`);
}

/**
 * Would `s` actively avoid `other` right now? Cautious personalities avoid
 * readily; aggressive ones rarely back away from anyone.
 */
export function avoidanceOf(world: World, s: Settler, other: Settler): number {
  const rel = peekRelationship(s, other.id);
  if (!rel) return 0;
  const state = relationshipState(rel);
  let pressure = 0;
  if (state === 'Hostile') pressure = 55;
  else if (state === 'Wary') pressure = 25;
  pressure += rel.fear * 0.6;
  if (world.timeSec - rel.lastConflictAt < REL.conflictChill) pressure += 20;
  if (pressure <= 0) return 0;
  // Caution amplifies, aggression suppresses.
  const temperament = 0.45 + s.personality.caution * 1.1 - s.personality.aggression * 0.6;
  return Math.max(0, pressure * Math.max(0, temperament));
}

/** Slow drift back toward neutral — time alone dulls both fondness and grudges. */
export function decayRelationships(world: World, s: Settler, dt: number): void {
  for (const rel of Object.values(s.relationships)) {
    const idle = world.timeSec - rel.lastInteractionAt;
    if (idle < REL.decayIdleDelay) continue;
    const rate = REL.decayPerSec * dt;
    // Empathetic settlers let go of grudges faster than they lose fondness.
    const forgiving = rel.affinity < 0 ? 1 + s.personality.empathy * 1.6 : 1;
    if (rel.affinity > 0) rel.affinity = Math.max(0, rel.affinity - rate);
    else if (rel.affinity < 0) rel.affinity = Math.min(0, rel.affinity + rate * forgiving);
    if (rel.fear > 0) rel.fear = Math.max(0, rel.fear - rate * 1.5 * forgiving);
    // Familiarity fades far more slowly: you do not forget someone quickly.
    if (rel.familiarity > 0) rel.familiarity = Math.max(0, rel.familiarity - rate * 0.15);
  }
}
