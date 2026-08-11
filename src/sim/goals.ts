import { RATES, REL, SETTLER, WORLD } from './config';
import { chronicle, daylight01, isNight } from './chronicle';
import { landmarkAt, placeName } from './landmarks';
import { remember } from './memory';
import { stand, stepToward } from './movement';
import {
  applyRelationship,
  avoidanceOf,
  decayRelationships,
  modifierLines,
  peekRelationship,
  relationshipState,
  relationshipWith,
  socialModifiers,
  sumModifiers,
  type RelationshipDelta,
  type UtilityModifier,
} from './relationships';
import { heightAt, isWater } from './terrain';
import type { Goal, GoalType, RelationshipEvent, ResourceNode, Settler, World } from './types';
import { clamp100, dist, lerpAngle, angleTo, v2, type V2 } from './vec';

/**
 * Settler cognition: needs-based utility scoring with stored reasoning.
 * Deterministic (all randomness via world.rng), no LLM, and every decision
 * can explain itself to Creator Mode.
 */

// ---------------------------------------------------------------------------
// Perception & knowledge
// ---------------------------------------------------------------------------

function nearestKnownFood(world: World, s: Settler): { node: ResourceNode; d: number } | null {
  let best: ResourceNode | null = null;
  let bestD = Infinity;
  for (const id of s.knownResourceIds) {
    const node = world.resources.find((r) => r.id === id);
    if (!node || node.type !== 'glowberry' || node.quantity < 1) continue;
    const d = dist(s.pos, node.pos);
    if (d < bestD) {
      best = node;
      bestD = d;
    }
  }
  return best ? { node: best, d: bestD } : null;
}

function nearestKnownRest(world: World, s: Settler): { node: ResourceNode; d: number } | null {
  let best: ResourceNode | null = null;
  let bestD = Infinity;
  for (const id of s.knownResourceIds) {
    const node = world.resources.find((r) => r.id === id);
    if (!node || node.type !== 'restspot') continue;
    const d = dist(s.pos, node.pos);
    if (d < bestD) {
      best = node;
      bestD = d;
    }
  }
  return best ? { node: best, d: bestD } : null;
}

/** Discover unknown resources and landmarks within perception range. */
export function perceiveResources(world: World, s: Settler): void {
  for (const node of world.resources) {
    if (s.knownResourceIds.includes(node.id)) continue;
    if (dist(s.pos, node.pos) > SETTLER.perceptionRadius) continue;
    s.knownResourceIds.push(node.id);
    if (node.type === 'glowberry' || node.type === 'restspot') {
      remember(s, { type: 'resource_discovered', place: node.label, t: world.timeSec, emotionalWeight: 0.4 });
    }
    if (!node.discovered) {
      node.discovered = true;
      // Only food finds make the chronicle — material nodes would read as
      // duplicate history.
      if (node.type === 'glowberry') {
        chronicle(world, 'discovery', `${s.name} found ${node.label}.`, {
          actorIds: [s.id],
          actorNames: [s.name],
          pos: { ...node.pos },
          place: placeName(node.pos),
          cause: [
            `${s.name} was ${s.goal.type === 'explore' ? 'exploring' : 'passing through'} ${placeName(s.pos)}`,
            `Curiosity ${Math.round(s.personality.curiosity * 100)} · caution ${Math.round(s.personality.caution * 100)}`,
          ],
          effects: [`${s.name} now knows this food source`, 'Added to their personal knowledge'],
        });
      }
    }
  }

  // Landmark knowledge: standing inside a named place teaches it.
  const lm = landmarkAt(s.pos);
  if (lm && !s.knownLandmarkIds.includes(lm.id)) {
    s.knownLandmarkIds.push(lm.id);
    remember(s, { type: 'explored', place: lm.name, t: world.timeSec, emotionalWeight: 0.25 });
  }
}

export interface SocialCandidate {
  other: Settler;
  d: number;
  /** Total utility of socializing with this person. */
  score: number;
  /** Named contributions, surfaced verbatim in the goal's WHY. */
  mods: UtilityModifier[];
  /** True when they are far enough away that going to them is a deliberate trip. */
  isJourney: boolean;
}

/**
 * Rank everyone this settler could choose to spend time with.
 *
 * This is where relationships change behavior: proximity still matters, but a
 * trusted friend outranks a nearer stranger, and someone feared or resented is
 * pushed below the threshold entirely. Good company is worth walking for —
 * candidates beyond the casual radius stay eligible if the bond is strong.
 */
export function rankSocialCandidates(world: World, s: Settler): SocialCandidate[] {
  const t = world.timeSec;
  const out: SocialCandidate[] = [];
  for (const other of world.settlers) {
    if (other === s || other.resting || other.socialTimer > 0) continue;
    if (other.goal.type === 'talk-emerson') continue;
    if (other.goal.type === 'socialize' && other.goal.targetId !== s.id) continue;
    const d = dist(s.pos, other.pos);
    if (d > REL.seekRadius) continue;

    const rel = peekRelationship(s, other.id);
    if (rel && t - rel.lastInteractionAt < SETTLER.socialPairCooldown) continue;

    const mods = socialModifiers(world, s, other);
    const relScore = sumModifiers(mods);
    const isJourney = d > SETTLER.socialSearchRadius;
    // Distance costs more on a long trip than a few steps across camp.
    const distancePenalty = isJourney ? 18 + (d - SETTLER.socialSearchRadius) * 0.16 : d * 0.3;
    const score = 20 - distancePenalty + relScore;

    // Only a genuinely valued companion justifies crossing the valley.
    if (isJourney && (relScore < REL.seekMinScore || s.needs.social < REL.seekMinSocialNeed)) continue;
    // Never voluntarily approach someone you are actively avoiding.
    if (avoidanceOf(world, s, other) > 25) continue;

    out.push({ other, d, score, mods, isJourney });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Someone this settler has reason to confront: a standing grievance, close
 * enough to act on, and a temperament willing to do it.
 */
export interface ConfrontCandidate {
  other: Settler;
  d: number;
  score: number;
  mods: UtilityModifier[];
}

export function findConfrontTarget(world: World, s: Settler): ConfrontCandidate | null {
  const t = world.timeSec;
  if (t < s.confrontCooldownUntil) return null;
  let best: ConfrontCandidate | null = null;
  for (const other of world.settlers) {
    if (other === s || other.resting || other.socialTimer > 0) continue;
    if (other.goal.type === 'talk-emerson' || other.goal.type === 'confront') continue;
    const rel = peekRelationship(s, other.id);
    if (!rel) continue;
    const d = dist(s.pos, other.pos);
    if (d > REL.confrontRange) continue;

    const mods: UtilityModifier[] = [];
    if (rel.affinity >= -12) continue; // no grievance worth raising
    mods.push({ label: `Resents them (affinity ${Math.round(rel.affinity)})`, value: Math.round(-rel.affinity * 0.55) });

    // A grievance you can point at makes confrontation far more likely.
    const grievances = s.memories.filter(
      (m) => m.subjectId === other.id && m.emotionalWeight < -0.3 && t - m.t < REL.memoryWindow,
    ).length;
    if (grievances > 0) mods.push({ label: 'Recent grievance', value: Math.min(26, grievances * 13) });

    mods.push({ label: `Aggression ${Math.round(s.personality.aggression * 100)}`, value: Math.round(s.personality.aggression * 34 - 14) });
    // Fear makes you swallow it instead.
    if (rel.fear > 15) mods.push({ label: 'Afraid of them', value: -Math.round(rel.fear * 0.8) });
    // Empathy makes you let it go.
    mods.push({ label: `Empathy ${Math.round(s.personality.empathy * 100)}`, value: -Math.round(s.personality.empathy * 20) });
    if (world.yieldMode === 'low' && s.hunger > 55) {
      mods.push({ label: 'Hungry under scarcity', value: 14 });
    }
    mods.push({ label: 'Proximity', value: Math.round(-d * 0.5) });

    const score = sumModifiers(mods);
    if (score < REL.confrontMinScore) continue;
    if (!best || score > best.score) best = { other, d, score, mods };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Goal selection (utility AI)
// ---------------------------------------------------------------------------

function mkGoal(type: GoalType, label: string, t: number, opts: Partial<Goal> = {}): Goal {
  return { type, label, phase: 'travel', timer: 0, startedAt: t, deadline: t + 60, ...opts };
}

export function settlerThink(world: World, s: Settler): void {
  const t = world.timeSec;
  const rng = world.rng;
  const day = daylight01(t);

  // A settler mid-conversation does not re-plan. Without this, one party can
  // wander off mid-exchange while the other keeps talking to empty air — and
  // the Chronicle would still report a conversation the player never saw.
  if (s.goal.type === 'talk-emerson' && t < s.talkingUntil) {
    s.nextThinkAt = t + 0.5;
    return;
  }
  if (
    (s.goal.type === 'socialize' || s.goal.type === 'seek-friend' || s.goal.type === 'confront' || s.goal.type === 'share-food') &&
    s.goal.phase === 'act' &&
    s.goal.timer > 0
  ) {
    s.nextThinkAt = t + 0.5;
    return;
  }

  // Generosity is opportunistic, not planned: if someone right here is much
  // hungrier and this settler is willing, that outranks whatever they had in
  // mind. Relationship and empathy decide willingness inside findShareTarget.
  const shareTarget = findShareTarget(world, s);
  if (shareTarget) {
    s.goal = mkGoal('share-food', `Share food with ${shareTarget.name}`, t, {
      targetId: shareTarget.id,
      deadline: t + 40,
    });
    const rel = peekRelationship(s, shareTarget.id);
    s.goalReason = {
      summary: [
        `${shareTarget.name} hunger ${Math.round(shareTarget.hunger)} vs own ${Math.round(s.hunger)}`,
        `Empathy ${Math.round(s.personality.empathy * 100)}`,
        rel ? `Relationship: ${relationshipState(rel)}` : 'Barely knows them',
        ...(world.yieldMode === 'low' ? ['Food is scarce — giving costs more'] : []),
      ],
      scores: [],
    };
    s.nextThinkAt = t + 1;
    return;
  }

  // Someone frightening or resented standing too close. This competes on
  // utility rather than overriding — facing the same person, a cautious
  // settler withdraws while an aggressive one has it out with them.
  const threatening = nearestAvoided(world, s);

  perceiveResources(world, s);

  const food = nearestKnownFood(world, s);
  const candidates = s.socialCooldownUntil > t ? [] : rankSocialCandidates(world, s);
  const best = candidates[0] ?? null;
  const confront = findConfrontTarget(world, s);

  const scores: { goal: string; score: number }[] = [];
  const add = (goal: string, score: number) => scores.push({ goal, score: Math.max(0, Math.round(score)) });

  // EAT — hunger drives it; knowing a food source makes it actionable.
  let eat = 0;
  if (s.hunger > 25) {
    eat = s.hunger * (food ? 1.0 : 0.55);
    if (food && food.d < 40) eat += 8;
    if (s.hunger > 80) eat += 15;
  }
  add('eat', eat);

  // REST — tiredness, amplified at night.
  const tired = 100 - s.energy;
  let rest = 0;
  if (s.energy < 75) {
    rest = tired * 0.9;
    if (isNight(t)) rest += tired > 30 ? 26 : 8;
    if (s.energy < 15) rest += 30;
  }
  add('rest', rest);

  // SOCIALIZE — needs a willing partner, and *who* they are now matters as
  // much as whether anyone is there at all.
  let social = 0;
  if (best) {
    social = s.needs.social * (0.35 + 0.85 * s.personality.sociability);
    // The relationship's own pull is added on top of raw need.
    social += sumModifiers(best.mods) * 0.55;
    if (best.isJourney) social += 6; // deliberately going to find a friend
  }
  add(best?.isJourney ? 'seek-friend' : 'socialize', social);

  // CONFRONT — a standing grievance acted on.
  add('confront', confront ? confront.score * 1.15 : 0);

  // AVOID — withdraw from someone unwelcome.
  add('avoid', threatening ? threatening.pressure : 0);

  // EXPLORE — curiosity, tempered by caution and darkness.
  let explore = s.needs.curiosity * (0.25 + 1.0 * s.personality.curiosity) * (0.35 + 0.65 * day);
  explore *= 1 - 0.45 * s.personality.caution;
  add('explore', explore);

  add('idle', 12);

  // Hysteresis: favor continuing the current goal — strongly while mid-act
  // (nobody abandons a meal or a nap over a mild competing urge).
  for (const o of scores) {
    if (o.goal === s.goal.type && s.goal.phase !== 'done') {
      o.score += s.goal.phase === 'act' ? 24 : 8;
    }
  }

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0].goal as GoalType;

  if (top !== s.goal.type || s.goal.phase === 'done') {
    startGoal(world, s, top, food, best, confront, threatening);
  }
  s.goalReason = buildReason(world, s, s.goal.type, scores, food, best, confront, threatening);
  s.nextThinkAt = t + rng.range(SETTLER.thinkMin, SETTLER.thinkMax);
}

function pickExploreTarget(world: World, s: Settler): V2 {
  const rng = world.rng;
  const bold = s.personality.curiosity * (1 - s.personality.caution * 0.7);
  const range = 25 + bold * 110;
  for (let i = 0; i < 14; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = rng.range(range * 0.4, range);
    const p = v2(s.pos.x + Math.sin(a) * d, s.pos.z + Math.cos(a) * d);
    if (Math.hypot(p.x, p.z) > WORLD.playRadius - 10) continue;
    if (isWater(p.x, p.z)) continue;
    if (heightAt(p.x, p.z) > 16) continue;
    return p;
  }
  return v2(s.home.x + rng.range(-15, 15), s.home.z + rng.range(-15, 15));
}

function startGoal(
  world: World,
  s: Settler,
  type: GoalType,
  food: { node: ResourceNode; d: number } | null,
  best: SocialCandidate | null,
  confront: ConfrontCandidate | null,
  threatening: { other: Settler; d: number; pressure: number } | null,
): void {
  const partner = best?.other ?? null;
  const t = world.timeSec;
  s.resting = false;
  switch (type) {
    case 'eat': {
      if (food) {
        s.goal = mkGoal('eat', `Eat at ${food.node.label}`, t, {
          targetId: food.node.id,
          targetPos: { ...food.node.pos },
          deadline: t + 90,
        });
      } else {
        // No food known — forage: exploration explicitly aimed at finding food.
        s.goal = mkGoal('explore', 'Forage for food', t, { targetPos: pickExploreTarget(world, s), deadline: t + 80 });
      }
      break;
    }
    case 'rest': {
      const spot = nearestKnownRest(world, s);
      const pos = spot ? { ...spot.node.pos } : { ...s.home };
      s.goal = mkGoal('rest', spot ? `Rest at ${spot.node.label}` : 'Rest at camp', t, {
        targetId: spot?.node.id,
        targetPos: pos,
        deadline: t + 120,
      });
      break;
    }
    case 'socialize': {
      if (partner) {
        s.goal = mkGoal('socialize', `Talk with ${partner.name}`, t, { targetId: partner.id, deadline: t + 45 });
      } else {
        s.goal = mkGoal('idle', 'Linger near camp', t, { targetPos: nearHome(world, s), deadline: t + 30 });
      }
      break;
    }
    case 'seek-friend': {
      if (partner) {
        // A deliberate journey across the valley for someone's company.
        s.goal = mkGoal('seek-friend', `Seek out ${partner.name}`, t, {
          targetId: partner.id,
          deadline: t + 240,
        });
      } else {
        s.goal = mkGoal('idle', 'Linger near camp', t, { targetPos: nearHome(world, s), deadline: t + 30 });
      }
      break;
    }
    case 'confront': {
      if (confront) {
        s.goal = mkGoal('confront', `Confront ${confront.other.name}`, t, {
          targetId: confront.other.id,
          deadline: t + 60,
        });
      } else {
        s.goal = mkGoal('idle', 'Brood on it', t, { targetPos: nearHome(world, s), deadline: t + 25 });
      }
      break;
    }
    case 'avoid': {
      if (threatening) {
        s.goal = mkGoal('avoid', `Keep away from ${threatening.other.name}`, t, {
          targetId: threatening.other.id,
          targetPos: awayFrom(world, s, threatening.other.pos),
          deadline: t + 30,
        });
      } else {
        s.goal = mkGoal('idle', 'Pass the time', t, { targetPos: nearHome(world, s), deadline: t + 25 });
      }
      break;
    }
    case 'explore': {
      s.goal = mkGoal('explore', 'Explore the valley', t, { targetPos: pickExploreTarget(world, s), deadline: t + 90 });
      break;
    }
    default: {
      s.goal = mkGoal('idle', 'Pass the time', t, { targetPos: nearHome(world, s), deadline: t + 40 });
    }
  }
}

function nearHome(world: World, s: Settler): V2 {
  return v2(s.pos.x + world.rng.range(-9, 9), s.pos.z + world.rng.range(-9, 9));
}

function buildReason(
  world: World,
  s: Settler,
  chosen: GoalType,
  scores: { goal: string; score: number }[],
  food: { node: ResourceNode; d: number } | null,
  best: SocialCandidate | null,
  confront: ConfrontCandidate | null,
  threatening: { other: Settler; d: number; pressure: number } | null,
): { summary: string[]; scores: { goal: string; score: number }[] } {
  const lines: string[] = [];
  const t = world.timeSec;
  switch (chosen) {
    case 'eat':
      lines.push(`Hunger ${Math.round(s.hunger)} / 100`);
      lines.push(food ? `Knows ${food.node.label}, ${Math.round(food.d)}m away` : 'No food source known — foraging');
      lines.push(`Energy sufficient (${Math.round(s.energy)})`);
      break;
    case 'rest':
      lines.push(`Energy low (${Math.round(s.energy)} / 100)`);
      if (isNight(t)) lines.push('It is night');
      lines.push('Knows a safe place to rest');
      break;
    case 'socialize':
    case 'seek-friend': {
      const partner = best?.other ?? null;
      lines.push(`Social need ${Math.round(s.needs.social)} / 100`);
      if (partner && best) {
        lines.push(
          best.isJourney
            ? `${partner.name} is ${Math.round(best.d)}m away — worth the walk`
            : `${partner.name} nearby (${Math.round(best.d)}m)`,
        );
        const rel = peekRelationship(s, partner.id);
        if (rel) lines.push(`Relationship: ${relationshipState(rel)}`);
        // The actual modifiers that decided it.
        lines.push(...modifierLines(best.mods));
      } else {
        lines.push('Seeking out company');
      }
      lines.push(`Sociability ${Math.round(s.personality.sociability * 100)}`);
      break;
    }
    case 'confront': {
      if (confront) {
        const rel = peekRelationship(s, confront.other.id);
        lines.push(`Grievance with ${confront.other.name}`);
        if (rel) lines.push(`Relationship: ${relationshipState(rel)}`);
        lines.push(...modifierLines(confront.mods));
      } else {
        lines.push('Something needs saying');
      }
      break;
    }
    case 'share-food': {
      lines.push('Someone nearby is hungrier than they are');
      lines.push(`Empathy ${Math.round(s.personality.empathy * 100)}`);
      if (world.yieldMode === 'low') lines.push('Food is scarce — this costs them');
      break;
    }
    case 'avoid': {
      if (threatening) {
        const rel = peekRelationship(s, threatening.other.id);
        lines.push(`${threatening.other.name} is ${Math.round(threatening.d)}m away`);
        if (rel) lines.push(`Relationship: ${relationshipState(rel)}`);
        if (rel && rel.fear > 10) lines.push(`Fear ${Math.round(rel.fear)}`);
        else if (rel) lines.push(`Affinity ${Math.round(rel.affinity)}`);
        lines.push(`Caution ${Math.round(s.personality.caution * 100)} outweighs aggression ${Math.round(s.personality.aggression * 100)}`);
      } else {
        lines.push('Keeping away from someone');
      }
      break;
    }
    case 'explore':
      lines.push(`Curiosity ${Math.round(s.needs.curiosity)} / 100`);
      lines.push(
        s.personality.caution > 0.6
          ? 'Staying close to familiar ground'
          : s.personality.curiosity > 0.6
            ? 'Bold temperament — ranging far'
            : 'Scouting at a comfortable distance',
      );
      if (s.goal.label === 'Forage for food') lines.push(`Hunger ${Math.round(s.hunger)} and no food known`);
      break;
    default:
      lines.push('No pressing needs');
      lines.push('Content to linger');
  }
  return { summary: lines, scores };
}

// ---------------------------------------------------------------------------
// Goal execution (every tick)
// ---------------------------------------------------------------------------

function completeSocial(world: World, a: Settler, b: Settler, sought: boolean): void {
  const t = world.timeSec;
  const rng = world.rng;
  const relABefore = peekRelationship(a, b.id);
  const firstMeeting = !relABefore || relABefore.interactions === 0;
  const beforeAffinity = Math.round(relABefore?.affinity ?? 0);
  const beforeSocialA = Math.round(a.needs.social);
  const beforeSocialB = Math.round(b.needs.social);
  const priorConflict = relABefore ? t - relABefore.lastConflictAt < REL.conflictChill : false;

  const negative = (a.personality.aggression > 0.7 || b.personality.aggression > 0.7) && rng.chance(0.18);
  // Talking after a falling-out is how people mend things.
  const mending = !negative && priorConflict && (a.personality.empathy + b.personality.empathy) / 2 > 0.45;

  const affinityDelta = negative
    ? -(4 + rng.range(0, 4))
    : 4 + a.personality.empathy * 3 + b.personality.empathy * 3 + (mending ? 6 : 0) + (sought ? 3 : 0);
  const trustDelta = negative ? -3 : 2 + (sought ? 3 : 0) + (mending ? 4 : 0);
  const familiarityDelta = firstMeeting ? 14 : 6;
  const fearDelta = mending ? -10 : 0;

  const kind: RelationshipEvent['kind'] = negative
    ? 'conflict'
    : mending
      ? 'reconciliation'
      : firstMeeting
        ? 'meeting'
        : sought
          ? 'sought'
          : 'conversation';
  const text = negative
    ? 'A tense exchange'
    : mending
      ? 'Talked things through after the falling-out'
      : firstMeeting
        ? 'First conversation'
        : sought
          ? 'Sought out for company'
          : 'A friendly conversation';

  const relA = applyRelationship(world, a, b.id, b.name, kind, text, {
    affinity: affinityDelta,
    trust: trustDelta,
    familiarity: familiarityDelta,
    fear: fearDelta,
  });
  applyRelationship(world, b, a.id, a.name, kind, text, {
    affinity: affinityDelta,
    trust: trustDelta,
    familiarity: familiarityDelta,
    fear: fearDelta,
  });

  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    x.needs.social = Math.max(0, x.needs.social - RATES.socialReduces);
    x.socialCooldownUntil = t + SETTLER.socialPairCooldown * 0.6;
    remember(x, {
      type: negative ? 'social_negative' : mending ? 'reconciled' : 'social_positive',
      subjectId: y.id,
      subjectName: y.name,
      t,
      emotionalWeight: negative ? -0.5 : mending ? 0.7 : 0.5,
    });
  }

  const detail = {
    actorIds: [a.id, b.id],
    actorNames: [a.name, b.name],
    pos: { x: (a.pos.x + b.pos.x) / 2, z: (a.pos.z + b.pos.z) / 2 },
    place: placeName(a.pos),
    cause: [
      `${a.name} social need: ${beforeSocialA}`,
      `${b.name} social need: ${beforeSocialB}`,
      `${a.name} sociability: ${Math.round(a.personality.sociability * 100)}`,
      `Relationship before: ${beforeAffinity >= 0 ? '+' : ''}${beforeAffinity}`,
      ...(sought ? [`${a.name} crossed the valley to find them`] : []),
      ...(mending ? ['They had argued recently', `Empathy ${Math.round(((a.personality.empathy + b.personality.empathy) / 2) * 100)}`] : []),
    ],
    effects: [
      `Social need −${RATES.socialReduces} for both`,
      `Affinity ${affinityDelta >= 0 ? '+' : ''}${Math.round(affinityDelta)} (now ${Math.round(relA.affinity)})`,
      `Trust ${trustDelta >= 0 ? '+' : ''}${Math.round(trustDelta)} · familiarity +${familiarityDelta}`,
      `Now ${relationshipState(relA)}`,
    ],
  };

  if (mending) {
    chronicle(world, 'social', `${a.name} and ${b.name} made peace after their falling-out.`, detail);
  } else if (negative) {
    chronicle(world, 'social', `${a.name} and ${b.name} had a tense exchange.`, detail);
  } else if (sought) {
    chronicle(world, 'social', `${a.name} sought out ${b.name} for company.`, detail);
  } else if (firstMeeting) {
    const cross = a.speciesId !== b.speciesId ? ' across the species divide' : '';
    chronicle(world, 'social', `${a.name} and ${b.name} shared a friendly conversation${cross}.`, detail);
  }
}

/**
 * A confrontation: two settlers stop and have it out. Not combat — the
 * outcome is decided by their temperaments and the standing of the
 * relationship, and it can end in anything from a hardened grudge to an
 * unexpected clearing of the air.
 */
type ConfrontOutcome = 'escalated' | 'backed-down' | 'reconciled' | 'sullen';

function resolveConfrontation(world: World, a: Settler, b: Settler): void {
  const t = world.timeSec;
  const relA = relationshipWith(a, b.id, t);
  const relB = relationshipWith(b, a.id, t);

  // Who holds their ground is a matter of temperament, not dice.
  const standA = a.personality.aggression * 1.2 + a.personality.initiative * 0.5 - relA.fear / 120;
  const standB = b.personality.aggression * 1.2 + b.personality.initiative * 0.5 - relB.fear / 120;
  const bothCalm = (a.personality.empathy + b.personality.empathy) / 2 > 0.62;
  const gap = standA - standB;

  let outcome: ConfrontOutcome;
  if (bothCalm && Math.abs(gap) < 0.45) outcome = 'reconciled';
  else if (gap > 0.32) outcome = 'backed-down';
  else if (Math.abs(gap) <= 0.32) outcome = 'escalated';
  else outcome = 'sullen';

  let aDelta: RelationshipDelta;
  let bDelta: RelationshipDelta;
  let text: string;
  let kind: RelationshipEvent['kind'] = 'conflict';

  switch (outcome) {
    case 'reconciled':
      aDelta = { affinity: 12, trust: 6, familiarity: 5, fear: -12 };
      bDelta = { ...aDelta };
      text = 'Aired the grievance and settled it';
      kind = 'reconciliation';
      break;
    case 'backed-down':
      // b yields: a's regard barely improves, b becomes afraid.
      aDelta = { affinity: 3, trust: -2, familiarity: 4 };
      bDelta = { affinity: -6, trust: -6, familiarity: 4, fear: 22 };
      text = `${b.name} backed down`;
      break;
    case 'escalated':
      aDelta = { affinity: -14, trust: -8, familiarity: 4, fear: 6 };
      bDelta = { ...aDelta };
      text = 'The argument escalated';
      break;
    default:
      aDelta = { affinity: -6, trust: -3, familiarity: 3 };
      bDelta = { ...aDelta };
      text = 'Neither would let it go';
  }

  const newA = applyRelationship(world, a, b.id, b.name, kind, text, aDelta);
  const newB = applyRelationship(world, b, a.id, a.name, kind, text, bDelta);

  a.confrontCooldownUntil = t + REL.confrontCooldown;
  b.confrontCooldownUntil = t + REL.confrontCooldown;
  a.socialCooldownUntil = t + SETTLER.socialPairCooldown;
  b.socialCooldownUntil = t + SETTLER.socialPairCooldown;
  a.needs.social = Math.max(0, a.needs.social - RATES.socialReduces * 0.4);
  b.needs.social = Math.max(0, b.needs.social - RATES.socialReduces * 0.4);

  remember(a, {
    type: outcome === 'reconciled' ? 'reconciled' : 'confronted',
    subjectId: b.id,
    subjectName: b.name,
    t,
    emotionalWeight: outcome === 'reconciled' ? 0.6 : -0.7,
  });
  remember(b, {
    type: outcome === 'reconciled' ? 'reconciled' : 'confronted',
    subjectId: a.id,
    subjectName: a.name,
    t,
    emotionalWeight: outcome === 'reconciled' ? 0.6 : outcome === 'backed-down' ? -0.85 : -0.7,
  });

  const headline: Record<ConfrontOutcome, string> = {
    reconciled: `${a.name} confronted ${b.name} — and they cleared the air.`,
    'backed-down': `${a.name} confronted ${b.name}. ${b.name} backed down.`,
    escalated: `${a.name} and ${b.name} argued bitterly.`,
    sullen: `${a.name} confronted ${b.name}. Neither gave ground.`,
  };

  chronicle(world, 'social', headline[outcome], {
    actorIds: [a.id, b.id],
    actorNames: [a.name, b.name],
    pos: { x: (a.pos.x + b.pos.x) / 2, z: (a.pos.z + b.pos.z) / 2 },
    place: placeName(a.pos),
    cause: [
      `${a.name} resented ${b.name} (affinity was ${Math.round(newA.affinity - (aDelta.affinity ?? 0))})`,
      `${a.name} aggression ${Math.round(a.personality.aggression * 100)} vs ${b.name} ${Math.round(b.personality.aggression * 100)}`,
      `Empathy ${Math.round(a.personality.empathy * 100)} / ${Math.round(b.personality.empathy * 100)}`,
      ...(world.yieldMode === 'low' ? ['Food was scarce'] : []),
    ],
    effects: [
      `${a.name} → ${b.name}: ${relationshipState(newA)} (affinity ${Math.round(newA.affinity)})`,
      `${b.name} → ${a.name}: ${relationshipState(newB)} (affinity ${Math.round(newB.affinity)})`,
      ...(outcome === 'backed-down' ? [`${b.name} is now afraid of ${a.name}`] : []),
      'Memories created for both',
    ],
  });
}

/**
 * Hold a believable conversational distance and face one another, so a
 * Chronicle entry about an exchange matches something the player could
 * actually have watched happen. Shared by conversation, confrontation and
 * food sharing.
 */
function holdConversation(world: World, s: Settler, other: Settler, dt: number): void {
  const d = dist(s.pos, other.pos);
  if (d > SETTLER.socialHoldMax) {
    stepToward(world, s, other.pos, dt, { speed: SETTLER.walkSpeed * 0.5 });
  } else if (d < SETTLER.socialHoldMin && d > 0.01) {
    const away = angleTo(other.pos, s.pos);
    s.pos.x += Math.sin(away) * 0.6 * dt;
    s.pos.z += Math.cos(away) * 0.6 * dt;
    s.speed = 0;
  } else {
    stand(s);
  }
  s.heading = lerpAngle(s.heading, angleTo(s.pos, other.pos), 1 - Math.exp(-6 * dt));
}

/** A settler hands over part of what they are carrying. */
function completeSharing(world: World, donor: Settler, receiver: Settler): void {
  const t = world.timeSec;
  const given = Math.min(donor.carriedFood, 2);
  if (given < 1) return;
  donor.carriedFood -= given;
  const beforeHunger = Math.round(receiver.hunger);
  receiver.hunger = Math.max(0, receiver.hunger - RATES.eatReduces * given * 0.8);
  donor.shareCooldownUntil = t + REL.shareCooldown;

  const scarce = world.yieldMode === 'low';
  const text = scarce ? 'Shared food when it was scarce' : 'Shared food';
  // Giving away food you might need yourself is the strongest trust signal
  // in the simulation, and scarcity makes it cost more.
  const trustGain = scarce ? 16 : 9;
  const relR = applyRelationship(world, receiver, donor.id, donor.name, 'gift', text, {
    affinity: scarce ? 12 : 7,
    trust: trustGain,
    familiarity: 8,
    fear: -8,
  });
  applyRelationship(world, donor, receiver.id, receiver.name, 'gift', text, {
    affinity: 5,
    trust: 4,
    familiarity: 8,
  });

  remember(receiver, {
    type: 'given_food',
    subjectId: donor.id,
    subjectName: donor.name,
    place: placeName(receiver.pos),
    t,
    emotionalWeight: 0.85,
  });
  remember(donor, {
    type: 'shared_food',
    subjectId: receiver.id,
    subjectName: receiver.name,
    t,
    emotionalWeight: 0.5,
  });

  chronicle(
    world,
    'social',
    scarce
      ? `${donor.name} shared scarce glowberries with ${receiver.name}.`
      : `${donor.name} shared glowberries with ${receiver.name}.`,
    {
      actorIds: [donor.id, receiver.id],
      actorNames: [donor.name, receiver.name],
      pos: { ...receiver.pos },
      place: placeName(receiver.pos),
      cause: [
        `${receiver.name} hunger was ${beforeHunger}`,
        `${donor.name} was carrying ${given + donor.carriedFood}`,
        `${donor.name} empathy ${Math.round(donor.personality.empathy * 100)}`,
        ...(scarce ? ['Glowberry yield is LOW — this was a real cost'] : []),
      ],
      effects: [
        `${receiver.name} hunger ${beforeHunger} → ${Math.round(receiver.hunger)}`,
        `${donor.name} gave up ${given} glowberr${given === 1 ? 'y' : 'ies'}`,
        `Trust toward ${donor.name} +${trustGain} (now ${Math.round(relR.trust)})`,
        `Now ${relationshipState(relR)}`,
      ],
    },
  );
}

/**
 * Someone hungry watched another settler take the last of a food source.
 * Not guaranteed — it depends on how hungry they are, how scarce food is,
 * how they already feel about the person, and their temperament.
 */
function considerResentment(world: World, eater: Settler, node: ResourceNode): void {
  if (node.quantity >= 1) return; // took the last of it only
  const t = world.timeSec;
  for (const witness of world.settlers) {
    if (witness === eater) continue;
    if (witness.hunger < 55) continue;
    const d = dist(witness.pos, node.pos);
    if (d > SETTLER.perceptionRadius) continue;
    if (!witness.knownResourceIds.includes(node.id)) continue;

    const rel = peekRelationship(witness, eater.id);
    let chance = 0.16 + (witness.hunger - 55) / 160;
    if (world.yieldMode === 'low') chance += 0.3;
    if (rel && rel.affinity < 0) chance += 0.2;
    if (rel && rel.affinity > 40) chance -= 0.25; // you forgive a friend
    chance -= witness.personality.empathy * 0.25;
    chance += witness.personality.aggression * 0.2;
    if (!world.rng.chance(Math.max(0, Math.min(0.85, chance)))) continue;

    const newRel = applyRelationship(world, witness, eater.id, eater.name, 'resentment', 'Took the last food while I was hungry', {
      affinity: -(7 + witness.personality.aggression * 8),
      trust: -5,
      familiarity: 3,
    });
    remember(witness, {
      type: 'resented_food',
      subjectId: eater.id,
      subjectName: eater.name,
      place: node.label,
      t,
      emotionalWeight: -0.7,
    });
    chronicle(world, 'social', `${witness.name} watched ${eater.name} take the last of ${node.label}.`, {
      actorIds: [witness.id, eater.id],
      actorNames: [witness.name, eater.name],
      pos: { ...node.pos },
      place: placeName(node.pos),
      cause: [
        `${witness.name} hunger ${Math.round(witness.hunger)}`,
        `The patch is now empty`,
        ...(world.yieldMode === 'low' ? ['Glowberry yield is LOW'] : []),
        `${witness.name} empathy ${Math.round(witness.personality.empathy * 100)}`,
      ],
      effects: [
        `${witness.name} → ${eater.name}: affinity now ${Math.round(newRel.affinity)}`,
        `Now ${relationshipState(newRel)}`,
        'A grievance that may surface later',
      ],
    });
  }
}

/**
 * The nearest person this settler actively wants distance from. Only fires
 * when they are close enough for it to matter — avoidance is a reaction, not
 * a permanent state.
 */
function nearestAvoided(world: World, s: Settler): { other: Settler; d: number; pressure: number } | null {
  let best: { other: Settler; d: number; pressure: number } | null = null;
  for (const other of world.settlers) {
    if (other === s) continue;
    const d = dist(s.pos, other.pos);
    if (d > 14) continue;
    // Closer proximity makes the same relationship more pressing.
    const pressure = avoidanceOf(world, s, other) * (1 - d / 18);
    if (pressure < 22) continue;
    if (!best || pressure > best.pressure) best = { other, d, pressure };
  }
  return best;
}

/** A reachable spot putting real distance between them. */
function awayFrom(world: World, s: Settler, from: V2): V2 {
  const angle = angleTo(from, s.pos);
  for (const spread of [0, 0.6, -0.6, 1.2, -1.2]) {
    const a = angle + spread;
    const p = v2(s.pos.x + Math.sin(a) * 22, s.pos.z + Math.cos(a) * 22);
    if (Math.hypot(p.x, p.z) > WORLD.playRadius - 10) continue;
    if (isWater(p.x, p.z)) continue;
    if (heightAt(p.x, p.z) > 16) continue;
    return p;
  }
  return { ...s.home };
}

/** Should this settler give away food right now, and to whom? */
function findShareTarget(world: World, s: Settler): Settler | null {
  if (s.carriedFood < 1 || world.timeSec < s.shareCooldownUntil) return null;
  if (s.hunger > 62) return null; // charity has limits
  let best: Settler | null = null;
  let bestNeed = 0;
  for (const other of world.settlers) {
    if (other === s || other.resting) continue;
    if (other.hunger - s.hunger < REL.shareHungerGap) continue;
    const d = dist(s.pos, other.pos);
    if (d > REL.shareRange) continue;
    const rel = peekRelationship(s, other.id);
    // Willingness is empathy first, relationship second.
    let willingness = s.personality.empathy * 0.75 + (rel ? rel.affinity / 260 : 0) + (rel ? rel.trust / 400 : 0);
    if (rel && relationshipState(rel) === 'Hostile') willingness -= 0.6;
    if (world.yieldMode === 'low') willingness -= 0.18; // harder to give when scarce
    if (willingness < 0.45) continue;
    const need = other.hunger - s.hunger;
    if (need > bestNeed) {
      best = other;
      bestNeed = need;
    }
  }
  return best;
}

export function settlerExecute(world: World, s: Settler, dt: number): void {
  const t = world.timeSec;
  const g = s.goal;

  // Talking to Emerson supersedes locomotion: the settler stops and turns to
  // face him for the duration of the exchange, then resumes its own life.
  if (g.type === 'talk-emerson') {
    stand(s);
    s.heading = lerpAngle(s.heading, angleTo(s.pos, world.player.pos), 1 - Math.exp(-7 * dt));
    if (t >= s.talkingUntil) {
      g.phase = 'done';
      s.nextThinkAt = Math.min(s.nextThinkAt, t + 0.1);
    }
    return;
  }

  if (g.phase === 'done') {
    stand(s);
    return;
  }
  if (t > g.deadline && g.phase === 'travel') {
    g.phase = 'done';
    return;
  }

  switch (g.type) {
    case 'eat': {
      const node = world.resources.find((r) => r.id === g.targetId);
      if (!node) {
        g.phase = 'done';
        return;
      }
      if (g.phase === 'travel') {
        const d = stepToward(world, s, node.pos, dt, { speed: SETTLER.walkSpeed });
        if (d < SETTLER.arriveDist + 0.8) {
          if (node.quantity < 1) {
            // Patch was empty — remember the disappointment, rethink.
            s.knownResourceIds = s.knownResourceIds.filter((id) => id !== node.id || node.regenPerSec > 0);
            g.phase = 'done';
            return;
          }
          g.phase = 'act';
          g.timer = SETTLER.eatDuration;
        }
      } else {
        stand(s);
        g.timer -= dt;
        if (g.timer <= 0) {
          node.quantity = Math.max(0, node.quantity - 1);
          s.hunger = Math.max(0, s.hunger - RATES.eatReduces);
          remember(s, { type: 'ate', place: node.label, t, emotionalWeight: 0.3 });
          // Take a little extra when there is plenty, so there is something to
          // share later. Under scarcity nobody hoards.
          if (node.quantity >= 2 && s.carriedFood < 2 && world.yieldMode === 'normal') {
            node.quantity -= 1;
            s.carriedFood += 1;
          }
          // Taking the last of a patch in front of a hungry neighbour is how
          // grievances start.
          considerResentment(world, s, node);
          g.phase = 'done';
        }
      }
      break;
    }
    case 'rest': {
      if (g.phase === 'travel') {
        const d = stepToward(world, s, g.targetPos!, dt, { speed: SETTLER.walkSpeed });
        if (d < SETTLER.arriveDist + 0.6) {
          g.phase = 'act';
          s.resting = true;
        }
      } else {
        stand(s);
        s.energy = clamp100(s.energy + RATES.restRecover * dt);
        if (s.energy >= 86) {
          s.resting = false;
          remember(s, { type: 'rested', place: 'camp', t, emotionalWeight: 0.2 });
          g.phase = 'done';
        }
      }
      break;
    }
    case 'confront': {
      const other = world.settlers.find((o) => o.id === g.targetId);
      if (!other || other.resting) {
        g.phase = 'done';
        return;
      }
      if (g.phase === 'travel') {
        // Approach purposefully.
        const d = stepToward(world, s, other.pos, dt, { speed: SETTLER.walkSpeed * 1.15 });
        if (d < SETTLER.socialRange) {
          // Both parties can independently decide to have it out with each
          // other. If they are already arguing with me, join their exchange
          // rather than restarting it — re-arming their timer would leave the
          // two sides expiring at different moments and never resolving.
          const alreadyEngaged =
            other.goal.type === 'confront' && other.goal.targetId === s.id && other.goal.phase === 'act';
          g.phase = 'act';
          g.timer = alreadyEngaged ? other.goal.timer : REL.confrontDuration;
          g.initiator = !alreadyEngaged;
          s.socialTimer = g.timer;
          s.confronting = true;
          if (!alreadyEngaged) {
            // The other party is pulled in whether they wanted it or not —
            // being confronted is not voluntary.
            other.socialTimer = REL.confrontDuration;
            other.confronting = true;
            other.goal = mkGoal('confront', `Confronted by ${s.name}`, t, { targetId: s.id, deadline: t + 40 });
            other.goal.phase = 'act';
            other.goal.timer = REL.confrontDuration;
            other.goal.initiator = false;
            other.goalReason = {
              summary: [`${s.name} approached with a grievance`, 'Cannot walk away from this'],
              scores: [],
            };
          }
        }
      } else {
        holdConversation(world, s, other, dt);
        g.timer -= dt;
        if (g.timer <= 0) {
          const engaged = other.goal.type === 'confront' && other.goal.targetId === s.id;
          // Exactly one resolution per bout. resolveConfrontation stamps a
          // cooldown on both parties, so whichever side reaches this first
          // settles it and the other simply ends — no ordering assumptions.
          if (t >= s.confrontCooldownUntil) {
            // Keep the aggrieved party as the subject of the record.
            if (g.initiator === false && engaged) resolveConfrontation(world, other, s);
            else resolveConfrontation(world, s, other);
          }
          s.confronting = false;
          other.confronting = false;
          g.phase = 'done';
          if (engaged) other.goal.phase = 'done';
        }
      }
      break;
    }
    case 'share-food': {
      const other = world.settlers.find((o) => o.id === g.targetId);
      if (!other || s.carriedFood < 1) {
        g.phase = 'done';
        return;
      }
      if (g.phase === 'travel') {
        const d = stepToward(world, s, other.pos, dt, { speed: SETTLER.walkSpeed });
        if (d < SETTLER.socialRange) {
          g.phase = 'act';
          g.timer = REL.shareDuration;
          s.socialTimer = REL.shareDuration;
          other.socialTimer = REL.shareDuration;
        }
      } else {
        holdConversation(world, s, other, dt);
        g.timer -= dt;
        if (g.timer <= 0) {
          completeSharing(world, s, other);
          g.phase = 'done';
        }
      }
      break;
    }
    case 'seek-friend':
    case 'socialize': {
      const other = world.settlers.find((o) => o.id === g.targetId);
      if (!other || other.resting) {
        g.phase = 'done';
        return;
      }
      if (g.phase === 'travel') {
        const d = stepToward(world, s, other.pos, dt, { speed: SETTLER.walkSpeed });
        if (d < SETTLER.socialRange) {
          // Partner joins the exchange (unless mid-flee or resting).
          g.phase = 'act';
          g.timer = SETTLER.socialDuration;
          s.socialTimer = SETTLER.socialDuration;
          other.socialTimer = SETTLER.socialDuration;
          if (other.goal.type !== 'socialize') {
            other.goal = mkGoal('socialize', `Talk with ${s.name}`, t, { targetId: s.id, deadline: t + 30 });
            other.goal.phase = 'act';
            other.goal.timer = SETTLER.socialDuration;
            // Explain the goal they did not choose: without this the inspector
            // shows "Talk with X" alongside whatever they were thinking before.
            const relOther = peekRelationship(other, s.id);
            other.goalReason = {
              summary: [
                `${s.name} approached them`,
                relOther ? `Relationship: ${relationshipState(relOther)}` : `They have not met before`,
                `Social need ${Math.round(other.needs.social)} / 100`,
              ],
              scores: [],
            };
          } else {
            other.goal.phase = 'act';
            other.goal.timer = SETTLER.socialDuration;
          }
        }
      } else {
        holdConversation(world, s, other, dt);
        g.timer -= dt;
        if (g.timer <= 0) {
          // Only one side applies the effects, so the pair resolves exactly once.
          if (s.id < other.id || other.goal.type !== 'socialize') {
            completeSocial(world, s, other, g.type === 'seek-friend');
          }
          g.phase = 'done';
          if (other.goal.type === 'socialize' && other.goal.targetId === s.id) other.goal.phase = 'done';
        }
      }
      break;
    }
    case 'avoid': {
      if (g.phase === 'travel') {
        const d = stepToward(world, s, g.targetPos!, dt, { speed: SETTLER.walkSpeed * 1.1 });
        // Far enough is far enough — no need to reach the exact spot.
        const other = world.settlers.find((o) => o.id === g.targetId);
        if (d < SETTLER.arriveDist || (other && dist(s.pos, other.pos) > 20)) {
          g.phase = 'done';
        }
      } else {
        g.phase = 'done';
      }
      break;
    }
    case 'explore':
    case 'idle': {
      if (g.phase === 'travel') {
        const d = stepToward(world, s, g.targetPos!, dt, { speed: g.type === 'idle' ? SETTLER.walkSpeed * 0.6 : SETTLER.walkSpeed });
        // Perceive while traveling (throttled).
        if (((t * 10) | 0) % 7 === 0) perceiveResources(world, s);
        if (d < SETTLER.arriveDist) {
          g.phase = 'act';
          g.timer = g.type === 'explore' ? 4 : world.rng.range(3, 7);
        }
      } else {
        stand(s);
        g.timer -= dt;
        if (g.timer <= 0) {
          if (g.type === 'explore') {
            s.needs.curiosity = Math.max(0, s.needs.curiosity - RATES.exploreReducesCuriosity);
            perceiveResources(world, s);
            if (world.rng.chance(0.25)) {
              remember(s, { type: 'explored', place: 'the valley', t, emotionalWeight: 0.2 });
            }
          }
          g.phase = 'done';
        }
      }
      break;
    }
    default:
      g.phase = 'done';
  }
}

/** Per-tick biology for settlers. */
export function settlerNeedsTick(world: World, s: Settler, dt: number): void {
  const moving = s.speed > 0.2;
  s.hunger = clamp100(s.hunger + RATES.hunger * dt);
  if (!s.resting) {
    s.energy = clamp100(s.energy - (moving ? RATES.energyMoving : RATES.energyIdle) * dt);
  }
  s.needs.social = clamp100(s.needs.social + RATES.socialNeed * (0.5 + s.personality.sociability) * dt);
  s.needs.curiosity = clamp100(s.needs.curiosity + RATES.curiosityNeed * (0.4 + s.personality.curiosity) * dt);
  s.needs.safety = Math.max(0, s.needs.safety - 0.5 * dt);
  if (s.socialTimer > 0) {
    s.socialTimer -= dt;
    if (s.socialTimer <= 0) s.confronting = false;
  }
  // Time alone dulls both fondness and grudges.
  decayRelationships(world, s, dt);
  // Gentle recovery when fed and rested; starvation slowly erodes health.
  if (s.hunger < 40 && s.energy > 40) s.health = clamp100(s.health + RATES.healthRegen * dt * 0.2);
  if (s.hunger >= 99) s.health = Math.max(5, s.health - 0.2 * dt);
}
