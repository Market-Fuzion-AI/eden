import { NORM, SOCIAL } from './config';
import { peekRelationship, relationshipState } from './relationships';
import {
  believedBlocker,
  customFor,
  customStatement,
  type BelievedBlocker,
} from './socialKnowledge';
import type {
  ClaimKind,
  EntityId,
  Settler,
  Structure,
  StructureAttitude,
  World,
} from './types';
import { clamp, clamp01 } from './vec';

/**
 * THE FIRST NORM — expectation before law.
 *
 * There is no ownerId anywhere in this file, and there never should be. A
 * claim is one settler's *interpretation* of a structure, computed from what
 * they actually did (staked it, hauled for it, slept in it), who else did,
 * how they feel about those people, and what they believe about property.
 *
 * Two settlers can therefore look at the same shelter and hold flatly
 * contradictory views, and the simulation stores both without deciding
 * between them. That disagreement is the point.
 */

export interface ClaimFactor {
  label: string;
  value: number;
}

export interface Claim {
  kind: ClaimKind;
  /** How strongly this settler feels tied to the place. 0..100 */
  attachment: number;
  /** How exclusively they read it as theirs rather than everyone's. 0..1 */
  exclusivity: number;
  factors: ClaimFactor[];
  label: string;
}

export const CLAIM_LABEL: Record<ClaimKind, string> = {
  none: 'No expectation',
  public: 'Public-use expectation',
  shared: 'Shared claim',
  personal: 'Strong personal claim',
};

// ---------------------------------------------------------------------------
// Attitudes (mutable, per agent, bounded)
// ---------------------------------------------------------------------------

export function emptyAttitude(structureId: EntityId): StructureAttitude {
  return {
    structureId,
    sharedDrift: 0,
    grudge: 0,
    allowed: [],
    allowedBy: [],
    refusedBy: [],
    lastViolationAt: -9999,
    lastAskedAt: -9999,
  };
}

export function peekAttitude(s: Settler, structureId: EntityId): StructureAttitude | undefined {
  return s.structureAttitudes[structureId];
}

/** Fetch or create, pruning the least-invested stance when over budget. */
export function attitudeFor(s: Settler, structureId: EntityId): StructureAttitude {
  let a = s.structureAttitudes[structureId];
  if (!a) {
    a = s.structureAttitudes[structureId] = emptyAttitude(structureId);
    const keys = Object.keys(s.structureAttitudes);
    if (keys.length > NORM.maxAttitudes) {
      // Drop whichever stance carries the least history.
      let weakest = keys[0];
      let weakestWeight = Infinity;
      for (const k of keys) {
        if (k === structureId) continue;
        const at = s.structureAttitudes[k];
        const weight =
          at.sharedDrift + at.grudge + at.allowed.length * 5 + at.allowedBy.length * 5 + at.refusedBy.length * 5;
        if (weight < weakestWeight) {
          weakestWeight = weight;
          weakest = k;
        }
      }
      if (weakest !== structureId) delete s.structureAttitudes[weakest];
    }
  }
  return a;
}

/** Forget stances toward structures that no longer exist. */
export function pruneAttitudes(world: World, s: Settler): void {
  for (const id of Object.keys(s.structureAttitudes)) {
    if (!world.structures.some((st) => st.id === id)) delete s.structureAttitudes[id];
  }
}

// ---------------------------------------------------------------------------
// Claim evaluation
// ---------------------------------------------------------------------------

function contributionShare(structure: Structure, id: EntityId): number {
  const total = structure.contributions.reduce((sum, c) => sum + c.wood + c.stone + c.work * 20, 0);
  if (total <= 0) return 0;
  const mine = structure.contributions
    .filter((c) => c.id === id)
    .reduce((sum, c) => sum + c.wood + c.stone + c.work * 20, 0);
  return mine / total;
}

function useShare(structure: Structure, id: EntityId): { share: number; count: number } {
  const total = structure.usage.reduce((sum, u) => sum + u.count, 0);
  const mine = structure.usage.find((u) => u.id === id)?.count ?? 0;
  return { share: total > 0 ? mine / total : 0, count: mine };
}

/**
 * How one settler reads one structure. Pure — reads history and values, never
 * mutates. The factor list is the WHY shown in Creator Mode.
 */
export function evaluateClaim(world: World, s: Settler, structure: Structure): Claim {
  const factors: ClaimFactor[] = [];
  const att = peekAttitude(s, structure.id);

  let attachment = 0;
  // Exclusivity starts from the structure's nature: a shelter is somewhere you
  // sleep, a fire is somewhere everyone stands.
  let exclusivity: number =
    structure.type === 'shelter' ? NORM.shelterExclusivityBase : NORM.campfireExclusivityBase;
  factors.push({
    label: structure.type === 'shelter' ? 'A place to sleep' : 'A fire is for standing around',
    value: Math.round((exclusivity - 0.5) * 100),
  });

  // --- what they actually did ------------------------------------------
  if (structure.initiatorId === s.id) {
    attachment += 30;
    exclusivity += 0.18;
    factors.push({ label: 'Initiated it', value: 30 });
  }
  const share = contributionShare(structure, s.id);
  if (share > 0.01) {
    const v = Math.round(share * 42);
    attachment += v;
    exclusivity += share * 0.22;
    factors.push({ label: `${Math.round(share * 100)}% of the building effort`, value: v });
  }
  const use = useShare(structure, s.id);
  if (use.count > 0) {
    const v = Math.round(Math.min(26, use.count * 3 + use.share * 18));
    attachment += v;
    exclusivity += Math.min(0.16, use.share * 0.2);
    factors.push({ label: `Used it ${use.count} time${use.count === 1 ? '' : 's'}`, value: v });
  }

  // --- what they believe ------------------------------------------------
  const ownership = (s.values.individualism + s.values.territoriality) / 2;
  exclusivity += (ownership - 0.5) * NORM.valuesWeight;
  factors.push({
    label:
      ownership > 0.62
        ? `Believes what you make is yours (${Math.round(ownership * 100)})`
        : ownership < 0.38
          ? `Believes such things are held in common (${Math.round(ownership * 100)})`
          : `Mixed feelings about ownership (${Math.round(ownership * 100)})`,
    value: Math.round((ownership - 0.5) * NORM.valuesWeight * 100),
  });
  // Cooperative people share more readily whatever else they believe.
  exclusivity -= (s.personality.empathy - 0.5) * 0.18;

  // --- who else is involved ---------------------------------------------
  const coContributors = structure.contributions.filter((c) => c.id !== s.id && c.id !== 'emerson');
  if (coContributors.length > 0) {
    let trustPull = 0;
    for (const c of coContributors) {
      const rel = peekRelationship(s, c.id);
      if (!rel) continue;
      // Building alongside someone you trust makes the place feel joint.
      if (rel.trust > 30 || rel.affinity > 25) trustPull += 0.06 + rel.trust / 900;
      else if (rel.affinity < -20) trustPull -= 0.05;
    }
    if (trustPull !== 0) {
      exclusivity -= trustPull;
      factors.push({
        label: `Built it with ${coContributors.length} other${coContributors.length === 1 ? '' : 's'}`,
        value: -Math.round(trustPull * 100),
      });
    }
  }

  // --- how the stance has drifted with lived experience ------------------
  if (att) {
    if (att.sharedDrift > 0.02) {
      exclusivity -= att.sharedDrift;
      factors.push({ label: 'Has shared it peacefully before', value: -Math.round(att.sharedDrift * 100) });
    }
    if (att.grudge > 0.02) {
      exclusivity += att.grudge;
      attachment += Math.min(12, att.grudge * 40);
      factors.push({ label: 'Others have used it without asking', value: Math.round(att.grudge * 100) });
    }
    if (att.allowed.length > 0) {
      factors.push({ label: `Has given ${att.allowed.length} permission`, value: 0 });
    }
  }

  // --- what they think is done around here -------------------------------
  // A generalization the settler formed themselves, weighted by how much they
  // defer to local habit at all. This is where convention and conviction can
  // pull in opposite directions on the same structure — both are recorded, and
  // neither is authoritative.
  const shared = customFor(world, s, 'shelters-shared', structure.pos);
  if (shared) {
    const pull = shared.confidence * 0.3 * s.values.conformity;
    if (pull > 0.01) {
      exclusivity -= pull;
      factors.push({
        label: `Around here, ${customStatement(shared.custom)}`,
        value: -Math.round(pull * 100),
      });
    }
  }
  const askHabit = customFor(world, s, 'ask-first', structure.pos);
  if (askHabit) {
    const pull = askHabit.confidence * 0.22 * s.values.conformity;
    if (pull > 0.01) {
      exclusivity += pull;
      factors.push({
        label: `Around here, ${customStatement(askHabit.custom)}`,
        value: Math.round(pull * 100),
      });
    }
  }

  // A fire everybody uses becomes everybody's.
  const distinctUsers = structure.usage.length;
  if (structure.type === 'campfire' && distinctUsers >= NORM.publicUserThreshold) {
    exclusivity -= 0.22;
    factors.push({ label: `${distinctUsers} different people use it`, value: -22 });
  }

  attachment = clamp(attachment, 0, 100);
  exclusivity = clamp01(exclusivity);

  let kind: ClaimKind;
  if (attachment < NORM.attachmentFloor) {
    // No personal history — but they may still hold a view about how it *should* work.
    kind = ownership < 0.45 || structure.type === 'campfire' ? 'public' : 'none';
  } else if (exclusivity >= NORM.personalThreshold) kind = 'personal';
  else if (exclusivity >= NORM.sharedThreshold) kind = 'shared';
  else kind = 'public';

  return { kind, attachment, exclusivity, factors, label: CLAIM_LABEL[kind] };
}

/** Everyone who holds a meaningful view of this structure, strongest first. */
export interface Claimant {
  settler: Settler;
  claim: Claim;
}

export function claimantsOf(world: World, structure: Structure, includeWeak = false): Claimant[] {
  const out: Claimant[] = [];
  for (const s of world.settlers) {
    // Only people with some connection to the place have an opinion worth showing.
    const involved =
      structure.initiatorId === s.id ||
      structure.contributions.some((c) => c.id === s.id) ||
      structure.usage.some((u) => u.id === s.id) ||
      Boolean(peekAttitude(s, structure.id));
    if (!involved && !includeWeak) continue;
    const claim = evaluateClaim(world, s, structure);
    if (claim.kind === 'none' && !includeWeak) continue;
    out.push({ settler: s, claim });
  }
  const rank: Record<ClaimKind, number> = { personal: 3, shared: 2, public: 1, none: 0 };
  out.sort((a, b) => rank[b.claim.kind] - rank[a.claim.kind] || b.claim.attachment - a.claim.attachment);
  return out;
}

/** The strongest personal claimant other than `s`, if anyone. */
export function strongestOtherClaimant(
  world: World,
  s: Settler,
  structure: Structure,
): Claimant | null {
  let best: Claimant | null = null;
  for (const c of claimantsOf(world, structure)) {
    if (c.settler.id === s.id) continue;
    if (c.claim.kind !== 'personal') continue;
    if (!best || c.claim.attachment > best.claim.attachment) best = c;
  }
  return best;
}

export function hasPermission(s: Settler, structure: Structure, fromId: EntityId): boolean {
  const att = peekAttitude(s, structure.id);
  return Boolean(att?.allowedBy.includes(fromId));
}

export function wasRefused(s: Settler, structure: Structure, byId: EntityId): boolean {
  const att = peekAttitude(s, structure.id);
  return Boolean(att?.refusedBy.includes(byId));
}

// ---------------------------------------------------------------------------
// Using a structure someone else claims
// ---------------------------------------------------------------------------

export interface AccessAssessment {
  /** Utility adjustment applied to the decision to use this structure. */
  modifier: number;
  /** Named reasons, surfaced in the goal WHY. */
  reasons: string[];
  /** Whoever they *believe* would consider this an intrusion, if anyone. */
  blocker: BelievedBlocker | null;
  /** True when asking first is the sensible move. */
  shouldAsk: boolean;
}

/**
 * How comfortable is `s` about using this structure right now?
 *
 * v0.6 rewires this to run on *belief*. It no longer reads what other settlers
 * actually expect — that would be telepathy, and it made every settler equally
 * well-informed. The discouragement now scales with how sure `s` is, so a
 * settler who watched Sareth turn someone away last night treats the place very
 * differently from one who has heard a vague rumour, who in turn behaves
 * differently from a newcomer who knows nothing at all.
 *
 * Never a hard prohibition: urgency, trust and permission all trade against a
 * believed expectation, and a desperate settler may simply walk in.
 */
export function assessAccess(world: World, s: Settler, structure: Structure, urgency: number): AccessAssessment {
  const reasons: string[] = [];
  let modifier = 0;

  const own = evaluateClaim(world, s, structure);
  if (own.kind === 'personal') {
    modifier += 26;
    reasons.push('Considers this place theirs +26');
  } else if (own.kind === 'shared') {
    modifier += 14;
    reasons.push('Has a share in this place +14');
  } else if (own.attachment < NORM.attachmentFloor) {
    reasons.push('No personal claim');
  }

  const blocker = believedBlocker(world, s, structure);
  let shouldAsk = false;
  if (blocker) {
    const { prediction } = blocker;
    const rel = peekRelationship(s, blocker.settler.id);
    const permitted = hasPermission(s, structure, blocker.settler.id);
    const refused = wasRefused(s, structure, blocker.settler.id);

    if (permitted) {
      modifier += 16;
      reasons.push(`${blocker.settler.name} has already allowed this +16`);
    } else {
      // The expected cost of intruding, discounted by how sure they are.
      const severity = prediction.kind === 'personal' ? 1 : 0.35;
      const weight = Math.round(SOCIAL.beliefWeight * severity * prediction.confidence);
      if (weight > 0) {
        modifier -= weight;
        reasons.push(
          prediction.kind === 'personal'
            ? `Expects ${blocker.settler.name} to mind −${weight}`
            : `${blocker.settler.name} may have a stake in it −${weight}`,
        );
      }
      // The provenance of that expectation, verbatim.
      reasons.push(...prediction.why);
      reasons.push(blocker.visibleTie);

      if (refused) {
        modifier -= 22;
        reasons.push(`${blocker.settler.name} has refused before −22`);
      }
      if (rel) {
        // Trust makes intrusion feel less like intrusion.
        const trustEase = Math.round(rel.trust * 0.24 + Math.max(0, rel.affinity) * 0.14);
        if (trustEase > 0) {
          modifier += trustEase;
          reasons.push(`Trust with ${blocker.settler.name} ${Math.round(rel.trust)} +${trustEase}`);
        }
        if (rel.fear > 15) {
          const f = Math.round(rel.fear * 0.7);
          modifier -= f;
          reasons.push(`Afraid of ${blocker.settler.name} −${f}`);
        }
        if (relationshipState(rel) === 'Hostile') {
          modifier -= 30;
          reasons.push('Would not set foot in it −30');
        }
      }

      // Asking is the hedge for someone who suspects they might be intruding.
      // Note it does *not* require certainty: an uncertain settler who holds a
      // local "people ask first" habit is exactly the one who asks.
      shouldAsk =
        !refused &&
        prediction.kind === 'personal' &&
        prediction.confidence >= SOCIAL.askConfidenceFloor &&
        s.personality.sociability + s.personality.empathy > 0.7 &&
        urgency < NORM.desperationUrgency;
    }
  } else {
    reasons.push('No reason to think anyone would mind');
  }

  // A held generalization colours the decision even when a specific belief
  // decided it — this is where local habit and private conviction can pull in
  // opposite directions, and both are shown.
  const habit = customFor(world, s, 'ask-first', structure.pos);
  if (habit && blocker) {
    const pull = Math.round(habit.confidence * 16 * s.values.conformity);
    if (pull > 0) {
      modifier -= pull;
      reasons.push(`Locally, ${customStatement(habit.custom)} −${pull}`);
    }
  }

  if (urgency > 0) {
    const u = Math.round(urgency * NORM.urgencyWeight);
    modifier += u;
    reasons.push(`Needs rest badly +${u}`);
  }

  return { modifier, reasons, blocker, shouldAsk };
}

/**
 * Would this settler treat someone else's use of the structure as a breach?
 * Requires a strong personal claim, no permission given, and no shared history
 * with that person here.
 */
export function isViolation(world: World, claimant: Settler, user: Settler, structure: Structure): boolean {
  if (claimant.id === user.id) return false;
  const claim = evaluateClaim(world, claimant, structure);
  if (claim.kind !== 'personal') return false;
  const att = peekAttitude(claimant, structure.id);
  if (att?.allowed.includes(user.id)) return false;
  // A substantial co-builder is never an intruder — but someone who dropped
  // off two logs has not thereby bought a share of the place.
  if (contributionShare(structure, user.id) >= NORM.coBuilderShare) return false;
  return true;
}

/**
 * Decide whether a claimant grants permission. Deterministic given state:
 * relationship, their own grip on the place, their temperament, and how badly
 * the asker needs it.
 */
export type PermissionOutcome = 'allow' | 'reluctant' | 'refuse';

export function decidePermission(
  world: World,
  claimant: Settler,
  /** Identified by id and name so Kai can be asked about too. */
  asker: { id: EntityId; name: string },
  structure: Structure,
  askerUrgency: number,
): { outcome: PermissionOutcome; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const rel = peekRelationship(claimant, asker.id);
  if (rel) {
    const v = Math.round(rel.trust * 0.4 + rel.affinity * 0.3);
    score += v;
    reasons.push(`Trust ${Math.round(rel.trust)}, affinity ${Math.round(rel.affinity)} → ${v >= 0 ? '+' : ''}${v}`);
    if (relationshipState(rel) === 'Hostile') {
      score -= 45;
      reasons.push('Hostile toward them −45');
    }
    if (rel.fear > 20) {
      // Fear cuts the other way: you do not refuse someone you are afraid of.
      score += Math.round(rel.fear * 0.4);
      reasons.push(`Afraid to refuse them +${Math.round(rel.fear * 0.4)}`);
    }
  } else {
    score -= 8;
    reasons.push('Barely knows them −8');
  }

  const empathy = Math.round(claimant.personality.empathy * 46 - 12);
  score += empathy;
  reasons.push(`Cooperation ${Math.round(claimant.personality.empathy * 100)} → ${empathy >= 0 ? '+' : ''}${empathy}`);

  const claim = evaluateClaim(world, claimant, structure);
  const grip = Math.round(claim.exclusivity * 48);
  score -= grip;
  reasons.push(`Holds it ${claim.label.toLowerCase()} −${grip}`);

  if (askerUrgency > 40) {
    const u = Math.round(askerUrgency * 0.3);
    score += u;
    reasons.push(`They clearly need it +${u}`);
  }

  const outcome: PermissionOutcome = score >= NORM.allowThreshold ? 'allow' : score >= NORM.reluctantThreshold ? 'reluctant' : 'refuse';
  return { outcome, reasons };
}

/** Short deterministic lines for the permission exchange. */
export function permissionLine(
  outcome: PermissionOutcome,
  claimant: Settler,
  asker: { name: string },
): string {
  switch (outcome) {
    case 'allow':
      return claimant.personality.empathy > 0.65
        ? `Of course. Take the dry side, ${asker.name}.`
        : `Go ahead. It is not as if I am using it tonight.`;
    case 'reluctant':
      return `…Tonight, then. Not every night.`;
    default:
      return claimant.personality.aggression > 0.6
        ? `No. Build your own.`
        : `I would rather you did not.`;
  }
}
