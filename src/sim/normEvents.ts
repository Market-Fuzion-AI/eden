import { NORM } from './config';
import { chronicle } from './chronicle';
import { remember } from './memory';
import {
  attitudeFor,
  decidePermission,
  evaluateClaim,
  isViolation,
  peekAttitude,
  permissionLine,
  type PermissionOutcome,
} from './norms';
import { applyRelationship, peekRelationship, relationshipState } from './relationships';
import { STRUCTURE_DEFS } from './structures';
import type { Settler, Structure, World } from './types';
import { clamp, dist } from './vec';

/**
 * The social consequences of norms: asking, granting, refusing, and noticing
 * that someone walked into what you consider yours.
 *
 * Nothing here decides who is *right*. It only records what each party did and
 * lets their existing relationship systems respond.
 */

function structureName(st: Structure): string {
  return `the ${STRUCTURE_DEFS[st.type].name.toLowerCase()} at ${st.place}`;
}

/** How badly the asker needs it, 0..100. */
export function restUrgency(s: Settler): number {
  return clamp(100 - s.energy, 0, 100);
}

// ---------------------------------------------------------------------------
// Asking permission
// ---------------------------------------------------------------------------

export interface AskResult {
  outcome: PermissionOutcome;
  reasons: string[];
  line: string;
}

/**
 * Resolve an ask. Both parties come away with a memory, and repeated
 * permission is what eventually turns a personal claim into a shared one.
 */
export function resolveAsk(
  world: World,
  asker: Settler,
  claimant: Settler,
  structure: Structure,
): AskResult {
  const t = world.timeSec;
  const urgency = restUrgency(asker);
  const { outcome, reasons } = decidePermission(world, claimant, asker, structure, urgency);

  const askerAtt = attitudeFor(asker, structure.id);
  const claimantAtt = attitudeFor(claimant, structure.id);
  askerAtt.lastAskedAt = t;

  if (outcome === 'allow' || outcome === 'reluctant') {
    if (!askerAtt.allowedBy.includes(claimant.id)) askerAtt.allowedBy.push(claimant.id);
    if (!claimantAtt.allowed.includes(asker.id)) claimantAtt.allowed.push(asker.id);
    // Clear any standing refusal — a yes supersedes an older no.
    askerAtt.refusedBy = askerAtt.refusedBy.filter((id) => id !== claimant.id);
    // Granting access loosens the claimant's grip a little.
    claimantAtt.sharedDrift = Math.min(
      NORM.maxDrift,
      claimantAtt.sharedDrift + (outcome === 'allow' ? NORM.sharedDriftPerPermission : NORM.sharedDriftPerPermission * 0.4),
    );

    const warmth = outcome === 'allow' ? 6 : 2;
    applyRelationship(world, asker, claimant.id, claimant.name, 'permission', `Let me use ${structureName(structure)}`, {
      affinity: warmth,
      trust: outcome === 'allow' ? 8 : 3,
      familiarity: 4,
    });
    applyRelationship(world, claimant, asker.id, asker.name, 'permission', `Asked before using ${structureName(structure)}`, {
      affinity: 4,
      trust: 5,
      familiarity: 4,
    });
    remember(asker, {
      type: 'received_permission',
      subjectId: claimant.id,
      subjectName: claimant.name,
      place: structureName(structure),
      t,
      emotionalWeight: 0.55,
    });
    remember(claimant, {
      type: 'granted_permission',
      subjectId: asker.id,
      subjectName: asker.name,
      place: structureName(structure),
      t,
      emotionalWeight: 0.35,
    });
  } else {
    if (!askerAtt.refusedBy.includes(claimant.id)) askerAtt.refusedBy.push(claimant.id);
    applyRelationship(world, asker, claimant.id, claimant.name, 'permission', `Refused me ${structureName(structure)}`, {
      affinity: -7,
      trust: -4,
      familiarity: 3,
    });
    remember(asker, {
      type: 'was_refused',
      subjectId: claimant.id,
      subjectName: claimant.name,
      place: structureName(structure),
      t,
      emotionalWeight: -0.5,
    });
    remember(claimant, {
      type: 'refused_permission',
      subjectId: asker.id,
      subjectName: asker.name,
      place: structureName(structure),
      t,
      emotionalWeight: -0.15,
    });
  }

  const claim = evaluateClaim(world, claimant, structure);
  const rel = peekRelationship(claimant, asker.id);
  const headline =
    outcome === 'refuse'
      ? `${claimant.name} refused ${asker.name} the use of ${structureName(structure)}.`
      : outcome === 'reluctant'
        ? `${claimant.name} reluctantly let ${asker.name} use ${structureName(structure)}.`
        : `${claimant.name} allowed ${asker.name} to use ${structureName(structure)}.`;

  chronicle(world, 'norm', headline, {
    actorIds: [asker.id, claimant.id],
    actorNames: [asker.name, claimant.name],
    pos: { ...structure.pos },
    place: structure.place,
    structureId: structure.id,
    cause: [
      `${asker.name} recognised ${claimant.name}'s claim`,
      `${claimant.name} holds it: ${claim.label}`,
      ...(rel ? [`Relationship: ${relationshipState(rel)} (trust ${Math.round(rel.trust)})`] : []),
      ...reasons,
    ],
    effects:
      outcome === 'refuse'
        ? [`${asker.name} was turned away`, `Affinity toward ${claimant.name} fell`, 'The refusal is remembered']
        : [
            `${asker.name} may now use it without friction`,
            `Trust between them rose`,
            `${claimant.name}'s grip on the place loosened slightly`,
          ],
  });

  return { outcome, reasons, line: permissionLine(outcome, claimant, asker) };
}

// ---------------------------------------------------------------------------
// Violation
// ---------------------------------------------------------------------------

export type ViolationReaction = 'tolerate' | 'resent' | 'object' | 'confront';

/**
 * Someone used a place another settler considers theirs. Whether that lands as
 * an outrage, a quiet grievance or nothing at all depends entirely on who they
 * are to each other.
 */
export function noticeUse(world: World, user: Settler, structure: Structure): void {
  const t = world.timeSec;
  for (const claimant of world.settlers) {
    if (!isViolation(world, claimant, user, structure)) continue;
    // They have to be around to see it.
    if (dist(claimant.pos, structure.pos) > NORM.noticeRange) continue;
    const att = attitudeFor(claimant, structure.id);
    if (t - att.lastViolationAt < NORM.violationCooldown) continue;
    att.lastViolationAt = t;

    const claim = evaluateClaim(world, claimant, structure);
    const rel = peekRelationship(claimant, user.id);
    const trust = rel?.trust ?? 0;
    const affinity = rel?.affinity ?? 0;

    // How much this stings. Temperament is weighted heavily against the bare
    // strength of the claim: the same intrusion should barely register with a
    // generous person and enrage a possessive one.
    let offence = claim.exclusivity * 38 + claim.attachment * 0.18;
    offence -= trust * 0.35 + Math.max(0, affinity) * 0.2;
    offence -= claimant.personality.empathy * 55;
    offence += claimant.personality.aggression * 30;
    if (rel && rel.fear > 20) offence -= rel.fear * 0.6; // you do not object to someone you fear

    let reaction: ViolationReaction;
    if (offence < 12) reaction = 'tolerate';
    else if (offence < 26) reaction = 'resent';
    else if (offence < 42) reaction = 'object';
    else reaction = 'confront';

    if (reaction === 'tolerate') {
      // Quietly accepting it is itself how a norm loosens.
      att.sharedDrift = Math.min(NORM.maxDrift, att.sharedDrift + NORM.sharedDriftPerPeacefulUse);
      continue;
    }

    att.grudge = Math.min(NORM.maxDrift, att.grudge + NORM.grudgePerViolation);
    remember(claimant, {
      type: 'expectation_violated',
      subjectId: user.id,
      subjectName: user.name,
      place: structureName(structure),
      t,
      emotionalWeight: -0.6,
    });
    const newRel = applyRelationship(
      world,
      claimant,
      user.id,
      user.name,
      'violation',
      `Used ${structureName(structure)} without asking`,
      {
        affinity: -(4 + claimant.personality.aggression * 8),
        trust: -4,
        familiarity: 2,
      },
    );

    if (reaction === 'object' || reaction === 'confront') {
      // An objection is a short social action; a confrontation goes through
      // the v0.3 machinery and can escalate or clear the air on its own.
      if (reaction === 'confront' && t >= claimant.confrontCooldownUntil) {
        claimant.goal = {
          type: 'confront',
          label: `Confront ${user.name}`,
          phase: 'travel',
          timer: 0,
          startedAt: t,
          deadline: t + 60,
          targetId: user.id,
        };
        claimant.goalReason = {
          summary: [
            `${user.name} used ${structureName(structure)}`,
            `${claimant.name} holds it: ${claim.label}`,
            `Aggression ${Math.round(claimant.personality.aggression * 100)}`,
          ],
          scores: [],
        };
      }
      chronicle(
        world,
        'norm',
        reaction === 'confront'
          ? `${claimant.name} took exception to ${user.name} using ${structureName(structure)}.`
          : `${claimant.name} objected to ${user.name} using ${structureName(structure)}.`,
        {
          actorIds: [claimant.id, user.id],
          actorNames: [claimant.name, user.name],
          pos: { ...structure.pos },
          place: structure.place,
          structureId: structure.id,
          cause: [
            `${claimant.name} holds it: ${claim.label}`,
            `No permission had been given`,
            ...(rel ? [`Relationship: ${relationshipState(rel)}`] : ['They barely know each other']),
            `Cooperation ${Math.round(claimant.personality.empathy * 100)} · aggression ${Math.round(claimant.personality.aggression * 100)}`,
          ],
          effects: [
            `${claimant.name} → ${user.name}: affinity now ${Math.round(newRel.affinity)}`,
            `${claimant.name}'s sense of the place hardened`,
            reaction === 'confront' ? 'They went to have it out' : 'A grievance was voiced',
          ],
        },
      );
    }
  }
}

/**
 * Record a peaceful, permitted use. Repeated often enough between people who
 * trust each other, this is what turns "mine" into "ours".
 */
export function noteSharedUse(world: World, user: Settler, structure: Structure): void {
  for (const claimant of world.settlers) {
    if (claimant.id === user.id) continue;
    const att = peekAttitude(claimant, structure.id);
    if (!att) continue;
    if (!att.allowed.includes(user.id)) continue;
    const before = evaluateClaim(world, claimant, structure).kind;
    att.sharedDrift = Math.min(NORM.maxDrift, att.sharedDrift + NORM.sharedDriftPerPeacefulUse);
    const after = evaluateClaim(world, claimant, structure).kind;
    // Only the moment the interpretation actually changes is worth recording.
    if (before === 'personal' && after !== 'personal') {
      chronicle(
        world,
        'norm',
        `${claimant.name} came to treat ${structureName(structure)} as shared rather than their own.`,
        {
          actorIds: [claimant.id, user.id],
          actorNames: [claimant.name, user.name],
          pos: { ...structure.pos },
          place: structure.place,
          structureId: structure.id,
          cause: [
            `Repeated peaceful use by ${user.name} and others`,
            `${claimant.name} has given permission before`,
            `Cooperation ${Math.round(claimant.personality.empathy * 100)}`,
          ],
          effects: [`Their expectation moved from personal to ${after}`, 'Future use will cause less friction'],
        },
      );
    }
  }
}

/**
 * Whoever would consider Emerson's use of this place an intrusion.
 * He has no building history, so any strong personal claimant qualifies.
 */
export function emersonBlocker(world: World, structure: Structure): { settler: Settler; attachment: number } | null {
  let best: { settler: Settler; attachment: number } | null = null;
  for (const s of world.settlers) {
    const claim = evaluateClaim(world, s, structure);
    if (claim.kind !== 'personal') continue;
    const att = peekAttitude(s, structure.id);
    if (att?.allowed.includes('emerson')) continue; // he already has leave to be here
    if (!best || claim.attachment > best.attachment) best = { settler: s, attachment: claim.attachment };
  }
  return best;
}
