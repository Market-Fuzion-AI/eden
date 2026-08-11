import { RATES, REL, SETTLER, STRUCT, WORLD } from './config';
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
import {
  activeProjects,
  applyWork,
  chooseBuildSite,
  createProject,
  deliverMaterials,
  knownCompleteStructures,
  missingResources,
  nearestKnownStructure,
  recordUse,
  STRUCTURE_DEFS,
  structureById,
} from './structures';
import { heightAt, isWater } from './terrain';
import type {
  Goal,
  GoalType,
  RelationshipEvent,
  ResourceNode,
  Settler,
  Structure,
  StructureType,
  World,
} from './types';
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

  // Structures are large and obvious — seen from much further off than a bush.
  for (const st of world.structures) {
    if (s.knownStructureIds.includes(st.id)) continue;
    if (dist(s.pos, st.pos) > STRUCT.visibleRange) continue;
    s.knownStructureIds.push(st.id);
  }

  // Landmark knowledge: standing inside a named place teaches it.
  const lm = landmarkAt(s.pos);
  if (lm && !s.knownLandmarkIds.includes(lm.id)) {
    s.knownLandmarkIds.push(lm.id);
    remember(s, { type: 'explored', place: lm.name, t: world.timeSec, emotionalWeight: 0.25 });
  }
}

// ---------------------------------------------------------------------------
// Construction: planning, gathering, building, helping
// ---------------------------------------------------------------------------

/** Nearest known node of a harvestable material with stock remaining. */
export function nearestKnownMaterial(
  world: World,
  s: Settler,
  type: 'wood' | 'stone',
): { node: ResourceNode; d: number } | null {
  let best: ResourceNode | null = null;
  let bestD = Infinity;
  for (const id of s.knownResourceIds) {
    const node = world.resources.find((r) => r.id === id);
    if (!node || node.type !== type || node.quantity < 1) continue;
    const d = dist(s.pos, node.pos);
    if (d < bestD) {
      best = node;
      bestD = d;
    }
  }
  return best ? { node: best, d: bestD } : null;
}

/** The project this settler is committed to, if it still exists. */
export function activePlanStructure(world: World, s: Settler): Structure | null {
  if (!s.buildPlan) return null;
  const st = structureById(world, s.buildPlan.structureId);
  if (!st || st.state === 'complete') {
    s.buildPlan = null;
    return null;
  }
  return st;
}

export interface ProjectIdea {
  type: StructureType;
  score: number;
  reason: string[];
}

/**
 * Should this settler start something? Considers their own unmet needs, what
 * already exists nearby, the time of day, their temperament, and the world's
 * capacity for more construction.
 */
export function considerNewProject(world: World, s: Settler): ProjectIdea | null {
  const t = world.timeSec;
  if (s.buildPlan) return null;
  if (t < s.projectCooldownUntil) return null;
  if (s.personality.initiative < STRUCT.minInitiative) return null;
  if (world.structures.length >= STRUCT.globalCap) return null;
  if (activeProjects(world).length >= STRUCT.maxActiveProjects) return null;
  // Nobody starts a building project while starving or exhausted.
  if (s.hunger > 70 || s.energy < 28) return null;

  const ideas: ProjectIdea[] = [];
  // Somebody else is already building this nearby — join them instead of
  // staking a rival site next door.
  const alreadyUnderway = (type: StructureType) =>
    activeProjects(world).some(
      (p) => p.type === type && dist(p.pos, s.pos) < STRUCTURE_DEFS[type].satisfyRadius,
    );

  // --- shelter: somewhere reliable to rest -------------------------------
  {
    const reason: string[] = [];
    let score = 0;
    const known = nearestKnownStructure(world, s, 'shelter');
    if ((!known || known.d > STRUCTURE_DEFS.shelter.satisfyRadius) && !alreadyUnderway('shelter')) {
      const tiredness = 100 - s.energy;
      score += tiredness * 0.5;
      reason.push(`Energy ${Math.round(s.energy)} / 100`);
      if (!known) {
        score += 22;
        reason.push('Knows of no shelter anywhere');
      } else {
        reason.push(`Nearest shelter is ${Math.round(known.d)}m away`);
      }
      // Someone sleeping rough on bare ground feels it more than the numbers show.
      const sleptWell = s.memories.some((m) => m.type === 'rested_in_shelter' && t - m.t < 2200);
      if (!sleptWell) {
        score += 18;
        reason.push('Has not slept under cover since arriving');
      }
      if (isNight(t)) {
        score += 12;
        reason.push('It is night');
      }
      if (world.weather === 'mist') {
        score += 8;
        reason.push('Exposed to the weather');
      }
      score += s.personality.initiative * 26;
      reason.push(`Initiative ${Math.round(s.personality.initiative * 100)}`);
      ideas.push({ type: 'shelter', score, reason });
    }
  }

  // --- campfire: warmth, light and a place to gather ---------------------
  {
    const reason: string[] = [];
    let score = 0;
    const known = nearestKnownStructure(world, s, 'campfire');
    if ((!known || known.d > STRUCTURE_DEFS.campfire.satisfyRadius) && !alreadyUnderway('campfire')) {
      const night = isNight(t);
      const dusk = daylight01(t) < 0.42;
      if (dusk) {
        score += night ? 26 : 16;
        reason.push(night ? 'It is night' : 'The light is going');
      }
      score += s.needs.social * 0.26;
      reason.push(`Social need ${Math.round(s.needs.social)} / 100`);
      // Building a fire is worth more where there are people to share it.
      const nearby = world.settlers.filter((o) => o !== s && dist(o.pos, s.pos) < 34).length;
      if (nearby > 0) {
        score += nearby * 7;
        reason.push(`${nearby} settler${nearby === 1 ? '' : 's'} nearby to share it`);
      }
      reason.push(known ? `Nearest fire is ${Math.round(known.d)}m away` : 'No fire in the area');
      score += s.personality.initiative * 20;
      reason.push(`Initiative ${Math.round(s.personality.initiative * 100)}`);
      ideas.push({ type: 'campfire', score, reason });
    }
  }

  if (ideas.length === 0) return null;
  ideas.sort((a, b) => b.score - a.score);
  const top = ideas[0];
  return top.score >= 46 ? top : null;
}

export interface HelpCandidate {
  structure: Structure;
  d: number;
  score: number;
  mods: UtilityModifier[];
}

/**
 * Should this settler pitch in on someone else's project?
 *
 * Relationships make cooperation more likely but are never required — a
 * stranger's shelter is still a shelter, and empathy alone can carry it.
 */
export function findHelpCandidate(world: World, s: Settler): HelpCandidate | null {
  if (s.buildPlan) return null;
  if (s.hunger > 68 || s.energy < 26) return null;
  let best: HelpCandidate | null = null;

  for (const st of activeProjects(world)) {
    if (st.initiatorId === s.id) continue;
    if (!s.knownStructureIds.includes(st.id)) continue;
    const d = dist(s.pos, st.pos);
    if (d > STRUCT.helpRange) continue;

    const mods: UtilityModifier[] = [];
    const initiator = world.settlers.find((o) => o.id === st.initiatorId);
    const rel = initiator ? peekRelationship(s, initiator.id) : undefined;

    if (rel && initiator) {
      const state = relationshipState(rel);
      mods.push({ label: `Trust with ${initiator.name} ${Math.round(rel.trust)}`, value: Math.round(rel.trust * 0.36) });
      mods.push({ label: `Affinity ${rel.affinity >= 0 ? '+' : ''}${Math.round(rel.affinity)}`, value: Math.round(rel.affinity * 0.3) });
      if (state === 'Hostile') mods.push({ label: 'Will not help someone they resent', value: -70 });
      else if (state === 'Wary') mods.push({ label: 'Wary of them', value: -22 });
      if (world.timeSec - rel.lastConflictAt < REL.conflictChill) {
        mods.push({ label: 'Recent conflict', value: -25 });
      }
    }

    // Cooperation is a personality trait first.
    mods.push({ label: `Cooperation ${Math.round(s.personality.empathy * 100)}`, value: Math.round(s.personality.empathy * 40 - 6) });
    // The structure's own usefulness to the helper.
    const usefulness =
      st.type === 'shelter'
        ? Math.round((100 - s.energy) * 0.24)
        : Math.round(s.needs.social * 0.2 + (isNight(world.timeSec) ? 12 : 0));
    mods.push({ label: `${STRUCTURE_DEFS[st.type].name} would be useful`, value: usefulness });
    mods.push({ label: 'Distance', value: -Math.round(d * 0.32) });
    // Carrying the right materials already makes helping cheap.
    const missing = missingResources(st);
    if ((missing.wood > 0 && s.inventory.wood > 0) || (missing.stone > 0 && s.inventory.stone > 0)) {
      mods.push({ label: 'Already carrying what it needs', value: 16 });
    }

    const score = sumModifiers(mods);
    if (score < STRUCT.helpMinScore) continue;
    if (!best || score > best.score) best = { structure: st, d, score, mods };
  }
  return best;
}

/** What this settler should fetch next for their project, if anything. */
export function nextMaterialNeed(
  world: World,
  s: Settler,
  st: Structure,
): { type: 'wood' | 'stone'; needed: number } | null {
  const missing = missingResources(st);
  // A settler can only carry so much per trip. Targeting the full remaining
  // requirement made anyone hauling for a structure larger than one load
  // gather forever and never deliver, starving the site at 0%.
  const woodTarget = Math.min(missing.wood, STRUCT.carryCapacity);
  const stoneTarget = Math.min(missing.stone, STRUCT.carryCapacity);
  const woodGap = woodTarget - s.inventory.wood;
  const stoneGap = stoneTarget - s.inventory.stone;
  if (woodGap <= 0.05 && stoneGap <= 0.05) return null;
  // Fetch whichever load is further from full, so neither ever blocks the site.
  if (woodGap >= stoneGap) return { type: 'wood', needed: missing.wood };
  return { type: 'stone', needed: missing.stone };
}

export interface FireCandidate {
  structure: Structure;
  d: number;
  score: number;
  reason: string[];
}

/**
 * Campfire social gravity.
 *
 * Fires pull people together after dark — but *which* fire depends on who is
 * already sitting at it, so friendships and grudges quietly sort the valley
 * into groups without any faction system existing.
 */
export function findFireToJoin(world: World, s: Settler): FireCandidate | null {
  const t = world.timeSec;
  if (s.buildPlan) return null;
  if (s.hunger > 72 || s.energy < 20) return null;
  const dark = 1 - daylight01(t);
  if (dark < 0.45) return null; // fires matter at dusk and after

  let best: FireCandidate | null = null;
  for (const st of knownCompleteStructures(world, s, 'campfire')) {
    const d = dist(s.pos, st.pos);
    if (d > STRUCT.fireAttractRange) continue;

    const reason: string[] = [];
    let score = 16 + dark * 26;
    reason.push(isNight(t) ? 'It is dark' : 'The light is going');
    score += s.needs.social * 0.34;
    reason.push(`Social need ${Math.round(s.needs.social)} / 100`);

    // Who is already there decides whether this is *their* fire.
    let socialPull = 0;
    const present: string[] = [];
    for (const other of world.settlers) {
      if (other === s) continue;
      if (dist(other.pos, st.pos) > STRUCT.fireGatherRadius * 2.2) continue;
      present.push(other.name);
      const rel = peekRelationship(s, other.id);
      if (!rel) {
        socialPull += 2;
        continue;
      }
      const state = relationshipState(rel);
      if (state === 'Bonded') socialPull += 20;
      else if (state === 'Friendly') socialPull += 13;
      else if (state === 'Familiar') socialPull += 5;
      else if (state === 'Wary') socialPull -= 16;
      else if (state === 'Hostile') socialPull -= 46;
      socialPull -= rel.fear * 0.4;
    }
    if (present.length > 0) {
      reason.push(`${present.slice(0, 3).join(', ')} already there`);
      reason.push(`Company ${socialPull >= 0 ? '+' : ''}${Math.round(socialPull)}`);
    }
    score += socialPull;
    score -= d * 0.28;
    reason.push(`${Math.round(d)}m away`);

    // Somewhere they already return to.
    const mine = st.usage.find((u) => u.id === s.id);
    if (mine && mine.count > 1) {
      score += 8;
      reason.push('A fire they keep coming back to');
    }
    if (score < 30) continue;
    if (!best || score > best.score) best = { structure: st, d, score, reason };
  }
  return best;
}

/** A spot around the fire that is not already occupied. */
function fireSeat(world: World, s: Settler, fire: Structure): V2 {
  const rng = world.rng;
  for (let i = 0; i < 10; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = STRUCT.fireGatherRadius * rng.range(0.65, 1.15);
    const p = v2(fire.pos.x + Math.sin(a) * r, fire.pos.z + Math.cos(a) * r);
    if (isWater(p.x, p.z)) continue;
    const clash = world.settlers.some((o) => o !== s && dist(o.pos, p) < 1.1);
    if (!clash) return p;
  }
  return v2(fire.pos.x + 2.2, fire.pos.z + 2.2);
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

  // --- construction ------------------------------------------------------
  // A settler already committed to a project keeps at it, at a strength that
  // still loses to genuine hunger or exhaustion — nobody builds while starving.
  const project = activePlanStructure(world, s);
  let projectIdea: ProjectIdea | null = null;
  let help: HelpCandidate | null = null;

  if (project) {
    const need = nextMaterialNeed(world, s, project);
    const commitment = 52 + s.personality.initiative * 12;
    if (need) add(need.type === 'wood' ? 'gather-wood' : 'gather-stone', commitment);
    else add(s.buildPlan?.owner ? 'build' : 'help-build', commitment + 6);
  } else {
    projectIdea = considerNewProject(world, s);
    help = findHelpCandidate(world, s);
    // Helping an existing project is preferred over starting a rival one.
    add('help-build', help ? help.score : 0);
    add('build', projectIdea ? projectIdea.score * 0.72 : 0);
  }

  // GATHER AT FIRE — warmth and company after dark.
  const fire = findFireToJoin(world, s);
  add('gather-at-fire', fire ? fire.score : 0);

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

  const ctx: ThinkContext = { food, best, confront, threatening, project, projectIdea, help, fire };
  if (top !== s.goal.type || s.goal.phase === 'done') {
    startGoal(world, s, top, ctx);
  }
  s.goalReason = buildReason(world, s, s.goal.type, scores, ctx);
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

/** Everything the current think pass worked out, passed to goal setup and reasoning. */
interface ThinkContext {
  food: { node: ResourceNode; d: number } | null;
  best: SocialCandidate | null;
  confront: ConfrontCandidate | null;
  threatening: { other: Settler; d: number; pressure: number } | null;
  project: Structure | null;
  projectIdea: ProjectIdea | null;
  help: HelpCandidate | null;
  fire: FireCandidate | null;
}

function startGoal(world: World, s: Settler, type: GoalType, ctx: ThinkContext): void {
  const { food, best, confront, threatening } = ctx;
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
      // A built shelter is better than a bare hollow, and worth walking past
      // a nearer one for — this is where construction changes daily behaviour.
      const shelter = nearestKnownStructure(world, s, 'shelter');
      const spot = nearestKnownRest(world, s);
      if (shelter && (!spot || shelter.d < spot.d + 45)) {
        s.goal = mkGoal('rest', `Rest in the shelter at ${shelter.structure.place}`, t, {
          structureId: shelter.structure.id,
          targetPos: { ...shelter.structure.pos },
          deadline: t + 200,
        });
      } else {
        const pos = spot ? { ...spot.node.pos } : { ...s.home };
        s.goal = mkGoal('rest', spot ? `Rest at ${spot.node.label}` : 'Rest at camp', t, {
          targetId: spot?.node.id,
          targetPos: pos,
          deadline: t + 120,
        });
      }
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
    case 'gather-wood':
    case 'gather-stone': {
      const mat = type === 'gather-wood' ? 'wood' : 'stone';
      const found = nearestKnownMaterial(world, s, mat);
      if (found) {
        s.goal = mkGoal(type, `Gather ${mat} at ${placeName(found.node.pos)}`, t, {
          targetId: found.node.id,
          targetPos: { ...found.node.pos },
          deadline: t + 260,
        });
      } else {
        // They need the material but know of no source: go and look.
        s.goal = mkGoal('explore', `Search for ${mat}`, t, {
          targetPos: pickExploreTarget(world, s),
          deadline: t + 120,
        });
      }
      break;
    }
    case 'build':
    case 'help-build': {
      let target = ctx.project;
      // Joining someone else's project.
      if (!target && ctx.help && type === 'help-build') {
        target = ctx.help.structure;
        s.buildPlan = {
          structureId: target.id,
          type: target.type,
          owner: false,
          reason: modifierLines(ctx.help.mods),
          startedAt: t,
        };
      }
      // Staking a new one.
      if (!target && ctx.projectIdea && type === 'build') {
        const site = chooseBuildSite(world, s, ctx.projectIdea.type);
        if (site) {
          target = createProject(world, s, ctx.projectIdea.type, site.pos, ctx.projectIdea.reason, site.reason);
          s.buildPlan = {
            structureId: target.id,
            type: target.type,
            owner: true,
            reason: ctx.projectIdea.reason,
            startedAt: t,
          };
          s.projectCooldownUntil = t + STRUCT.projectCooldown;
          chronicle(
            world,
            'settlement',
            `${s.name} began building a ${STRUCTURE_DEFS[target.type].name.toLowerCase()} at ${target.place}.`,
            {
              actorIds: [s.id],
              actorNames: [s.name],
              pos: { ...target.pos },
              place: target.place,
              cause: ctx.projectIdea.reason,
              effects: [
                `Needs ${target.required.wood} wood and ${target.required.stone} stone`,
                'Others may choose to help',
              ],
            },
          );
        }
      }
      if (target) {
        const owner = s.buildPlan?.owner ?? false;
        const label = owner
          ? `Build ${STRUCTURE_DEFS[target.type].name.toLowerCase()}`
          : `Help ${target.initiatorName} build ${STRUCTURE_DEFS[target.type].name.toLowerCase()}`;
        s.goal = mkGoal(owner ? 'build' : 'help-build', label, t, {
          structureId: target.id,
          targetPos: { ...target.pos },
          deadline: t + 300,
        });
      } else {
        s.goal = mkGoal('idle', 'Consider what is needed', t, { targetPos: nearHome(world, s), deadline: t + 20 });
      }
      break;
    }
    case 'gather-at-fire': {
      if (ctx.fire) {
        s.goal = mkGoal('gather-at-fire', `Sit by the fire at ${ctx.fire.structure.place}`, t, {
          structureId: ctx.fire.structure.id,
          targetPos: fireSeat(world, s, ctx.fire.structure),
          deadline: t + 200,
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
  ctx: ThinkContext,
): { summary: string[]; scores: { goal: string; score: number }[] } {
  const { food, best, confront, threatening } = ctx;
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
    case 'gather-wood':
    case 'gather-stone': {
      // The full chain: what it is for, how much is needed, how much is in
      // hand, and where they are going to get the rest.
      const mat = chosen === 'gather-wood' ? 'wood' : 'stone';
      const project = ctx.project;
      if (project) {
        const def = STRUCTURE_DEFS[project.type];
        const missing = missingResources(project);
        lines.push(
          `${s.buildPlan?.owner ? 'Planning' : `Helping ${project.initiatorName} with`} ${def.name}`,
        );
        lines.push(`${mat[0].toUpperCase()}${mat.slice(1)} still needed: ${Math.round(missing[mat])}`);
        lines.push(`${mat[0].toUpperCase()}${mat.slice(1)} carried: ${Math.round(s.inventory[mat])}`);
      } else {
        lines.push(`Collecting ${mat}`);
      }
      const src = nearestKnownMaterial(world, s, mat);
      lines.push(src ? `${placeName(src.node.pos)} known: ${Math.round(src.d)}m away` : `No ${mat} source known yet`);
      break;
    }
    case 'build': {
      const project = ctx.project;
      if (project) {
        const def = STRUCTURE_DEFS[project.type];
        const missing = missingResources(project);
        lines.push(`${def.name} · ${Math.round(project.progress * 100)}% built`);
        lines.push(
          missing.wood > 0 || missing.stone > 0
            ? `Still needs ${Math.round(missing.wood)} wood, ${Math.round(missing.stone)} stone`
            : 'All materials delivered',
        );
        lines.push(...(s.buildPlan?.reason ?? project.reason));
      } else if (ctx.projectIdea) {
        lines.push(`Decided to build a ${STRUCTURE_DEFS[ctx.projectIdea.type].name}`);
        lines.push(...ctx.projectIdea.reason);
      } else {
        lines.push('Working out what is needed');
      }
      break;
    }
    case 'help-build': {
      const project = ctx.project;
      const help = ctx.help;
      if (project) {
        lines.push(`${project.initiatorName}'s ${STRUCTURE_DEFS[project.type].name} · ${Math.round(project.progress * 100)}% built`);
      }
      // The relationship modifiers that made helping worthwhile.
      if (help) lines.push(...modifierLines(help.mods));
      else if (s.buildPlan && !s.buildPlan.owner) lines.push(...s.buildPlan.reason);
      if (s.hunger < 50 && s.energy > 40) lines.push('No urgent hunger or rest need');
      break;
    }
    case 'gather-at-fire': {
      if (ctx.fire) lines.push(...ctx.fire.reason);
      else lines.push('Drawn toward the firelight');
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
  const given = Math.min(donor.inventory.glowberry, 2);
  if (given < 1) return;
  donor.inventory.glowberry -= given;
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
        `${donor.name} was carrying ${given + donor.inventory.glowberry}`,
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

/** Finish a structure and record the moment in the world's history. */
function completeStructure(world: World, st: Structure): void {
  st.state = 'complete';
  st.progress = 1;
  st.completedAt = world.timeSec;
  world.dirty.structures = true;

  const def = STRUCTURE_DEFS[st.type];
  const helpers = st.contributions.filter((c) => c.id !== st.initiatorId);
  const contributorLines = st.contributions
    .sort((a, b) => b.work - a.work)
    .map((c) => `${c.name} — ${Math.round(c.wood)} wood, ${Math.round(c.stone)} stone, ${Math.round(c.work * 100)}% of the work`);

  // Everyone who worked on it obviously knows it exists.
  for (const c of st.contributions) {
    const worker = world.settlers.find((o) => o.id === c.id);
    if (worker) {
      if (!worker.knownStructureIds.includes(st.id)) worker.knownStructureIds.push(st.id);
      if (worker.buildPlan?.structureId === st.id) worker.buildPlan = null;
      remember(worker, {
        type: c.id === st.initiatorId ? 'built_structure' : 'helped_build',
        subjectId: st.id,
        subjectName: st.initiatorName,
        place: `the ${def.name.toLowerCase()} at ${st.place}`,
        t: world.timeSec,
        emotionalWeight: 0.7,
      });
    }
  }

  // Working side by side builds trust between everyone involved.
  for (const a of st.contributions) {
    const sa = world.settlers.find((o) => o.id === a.id);
    if (!sa) continue;
    for (const b of st.contributions) {
      if (a.id === b.id) continue;
      const sb = world.settlers.find((o) => o.id === b.id);
      if (!sb) continue;
      applyRelationship(world, sa, sb.id, sb.name, 'cooperation', `Built the ${def.name.toLowerCase()} at ${st.place} together`, {
        affinity: 7,
        trust: 10,
        familiarity: 9,
        fear: -4,
      });
    }
  }

  const isFirstOfType = world.structures.filter((o) => o.type === st.type && o.state === 'complete').length === 1;
  const headline = isFirstOfType
    ? `Eden's first ${def.name.toLowerCase()} was completed at ${st.place}.`
    : helpers.length > 0
      ? `${st.initiatorName}'s ${def.name.toLowerCase()} at ${st.place} was completed with help from ${helpers.map((h) => h.name).join(', ')}.`
      : `${st.initiatorName} completed a ${def.name.toLowerCase()} at ${st.place}.`;

  chronicle(world, 'settlement', headline, {
    actorIds: st.contributions.map((c) => c.id),
    actorNames: st.contributions.map((c) => c.name),
    pos: { ...st.pos },
    place: st.place,
    structureId: st.id,
    cause: [`Started by ${st.initiatorName}`, ...st.reason],
    effects: [
      ...contributorLines,
      `Consumed ${st.contributed.wood} wood and ${st.contributed.stone} stone`,
      st.type === 'shelter' ? 'Settlers may now rest here' : 'Settlers may now gather here after dark',
    ],
  });
}

/** Log the first time a fire draws a real crowd, and only rarely after that. */
function maybeFireGatheringEvent(world: World, fire: Structure): void {
  const present = world.settlers.filter((o) => dist(o.pos, fire.pos) < STRUCT.fireGatherRadius * 2.4);
  if (present.length < 4) return;
  const key = `fireGathering_${fire.id}`;
  const lastAt = (world.flags[key] as number) ?? -9999;
  if (world.timeSec - lastAt < 1200) return;
  world.flags[key] = world.timeSec;
  chronicle(
    world,
    'settlement',
    `${present.length} settlers gathered around the campfire at ${fire.place} after dark.`,
    {
      actorIds: present.map((p) => p.id),
      actorNames: present.map((p) => p.name),
      pos: { ...fire.pos },
      place: fire.place,
      structureId: fire.id,
      cause: ['Nightfall', 'The fire is warm and others were already there'],
      effects: ['Social need eased for everyone present', 'A gathering place is forming'],
    },
  );
}

/**
 * The bridge toward future property norms: someone stripping the last of a
 * material seam that another settler is actively gathering for a project may
 * earn a grievance. Never guaranteed — same personality logic as food.
 */
function considerMaterialResentment(world: World, taker: Settler, node: ResourceNode): void {
  const t = world.timeSec;
  for (const witness of world.settlers) {
    if (witness === taker) continue;
    if (!witness.buildPlan) continue; // only matters to someone with a project
    if (!witness.knownResourceIds.includes(node.id)) continue;
    if (dist(witness.pos, node.pos) > SETTLER.perceptionRadius * 1.6) continue;
    const project = activePlanStructure(world, witness);
    if (!project) continue;
    const missing = missingResources(project);
    const wanted = node.type === 'wood' ? missing.wood : node.type === 'stone' ? missing.stone : 0;
    if (wanted <= 0) continue;

    const rel = peekRelationship(witness, taker.id);
    let chance = 0.22;
    if (rel && rel.affinity < 0) chance += 0.2;
    if (rel && rel.affinity > 40) chance -= 0.25;
    chance -= witness.personality.empathy * 0.25;
    chance += witness.personality.aggression * 0.22;
    if (!world.rng.chance(Math.max(0, Math.min(0.8, chance)))) continue;

    const newRel = applyRelationship(
      world,
      witness,
      taker.id,
      taker.name,
      'resentment',
      `Stripped the ${node.type} I needed for my project`,
      { affinity: -(6 + witness.personality.aggression * 7), trust: -4, familiarity: 2 },
    );
    remember(witness, {
      type: 'resented_material',
      subjectId: taker.id,
      subjectName: taker.name,
      place: node.label,
      t,
      emotionalWeight: -0.65,
    });
    chronicle(world, 'social', `${witness.name} found ${node.label} stripped bare by ${taker.name}.`, {
      actorIds: [witness.id, taker.id],
      actorNames: [witness.name, taker.name],
      pos: { ...node.pos },
      place: placeName(node.pos),
      structureId: project.id,
      cause: [
        `${witness.name} still needs ${Math.round(wanted)} ${node.type} for their ${STRUCTURE_DEFS[project.type].name.toLowerCase()}`,
        `${taker.name} took the last of it`,
        `${witness.name} empathy ${Math.round(witness.personality.empathy * 100)}`,
      ],
      effects: [
        `${witness.name} → ${taker.name}: affinity now ${Math.round(newRel.affinity)}`,
        `Now ${relationshipState(newRel)}`,
        'A grievance that may surface later',
      ],
    });
  }
}

/** Should this settler give away food right now, and to whom? */
function findShareTarget(world: World, s: Settler): Settler | null {
  if (s.inventory.glowberry < 1 || world.timeSec < s.shareCooldownUntil) return null;
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
          if (node.quantity >= 2 && s.inventory.glowberry < 2 && world.yieldMode === 'normal') {
            node.quantity -= 1;
            s.inventory.glowberry += 1;
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
      const shelterUsed = structureById(world, g.structureId);
      if (g.phase === 'travel') {
        const d = stepToward(world, s, g.targetPos!, dt, { speed: SETTLER.walkSpeed });
        if (d < SETTLER.arriveDist + 0.6) {
          g.phase = 'act';
          s.resting = true;
          if (shelterUsed && shelterUsed.state === 'complete') recordUse(world, shelterUsed, s);
        }
      } else {
        stand(s);
        // Shelter makes rest genuinely better, not just thematically nicer.
        const quality = shelterUsed && shelterUsed.state === 'complete' ? STRUCT.shelterRestBonus : 1;
        s.energy = clamp100(s.energy + RATES.restRecover * quality * dt);
        if (s.energy >= 86) {
          s.resting = false;
          remember(s, {
            type: shelterUsed ? 'rested_in_shelter' : 'rested',
            place: shelterUsed ? `the shelter at ${shelterUsed.place}` : 'camp',
            t,
            emotionalWeight: shelterUsed ? 0.45 : 0.2,
          });
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
      if (!other || s.inventory.glowberry < 1) {
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
    case 'gather-wood':
    case 'gather-stone': {
      const node = world.resources.find((r) => r.id === g.targetId);
      const mat = g.type === 'gather-wood' ? 'wood' : 'stone';
      if (!node || node.quantity < 1) {
        g.phase = 'done';
        return;
      }
      if (g.phase === 'travel') {
        const d = stepToward(world, s, node.pos, dt, { speed: SETTLER.walkSpeed });
        if (d < SETTLER.arriveDist + 0.9) {
          g.phase = 'act';
          g.timer = 30;
        }
      } else {
        stand(s);
        // Harvest until they have what the project needs, or they are full.
        const project = activePlanStructure(world, s);
        const missing = project ? missingResources(project) : { wood: 0, stone: 0 };
        const want = Math.min(STRUCT.carryCapacity, Math.max(0, missing[mat]));
        const take = Math.min(STRUCT.harvestPerSec * dt, node.quantity, want - s.inventory[mat]);
        if (take > 0) {
          node.quantity -= take;
          s.inventory[mat] += take;
        }
        g.timer -= dt;
        if (s.inventory[mat] >= want || node.quantity < 0.01 || g.timer <= 0) {
          // Round off the fractional harvest so inventories stay tidy.
          s.inventory[mat] = Math.floor(s.inventory[mat] * 100) / 100;
          if (node.quantity < 0.5) considerMaterialResentment(world, s, node);
          g.phase = 'done';
        }
      }
      break;
    }
    case 'build':
    case 'help-build': {
      const st = structureById(world, g.structureId);
      if (!st || st.state === 'complete') {
        if (s.buildPlan?.structureId === g.structureId) s.buildPlan = null;
        g.phase = 'done';
        return;
      }
      if (g.phase === 'travel') {
        const d = stepToward(world, s, st.pos, dt, { speed: SETTLER.walkSpeed });
        if (d < STRUCT.buildRange) {
          g.phase = 'act';
          g.timer = 60;
          const delivered = deliverMaterials(world, st, s);
          if (delivered.wood > 0 || delivered.stone > 0) world.dirty.structures = true;
        }
      } else {
        stand(s);
        s.heading = lerpAngle(s.heading, angleTo(s.pos, st.pos), 1 - Math.exp(-5 * dt));
        deliverMaterials(world, st, s);
        const gained = applyWork(world, st, s, dt);
        g.timer -= dt;
        if (st.progress >= 1) {
          completeStructure(world, st);
          g.phase = 'done';
        } else if (gained <= 0) {
          // Stalled for want of materials — go and fetch some.
          g.phase = 'done';
        } else if (g.timer <= 0) {
          g.phase = 'done';
        }
      }
      break;
    }
    case 'gather-at-fire': {
      const fire = structureById(world, g.structureId);
      if (!fire || fire.state !== 'complete') {
        g.phase = 'done';
        return;
      }
      if (g.phase === 'travel') {
        const d = stepToward(world, s, g.targetPos ?? fire.pos, dt, { speed: SETTLER.walkSpeed });
        if (d < SETTLER.arriveDist) {
          g.phase = 'act';
          g.timer = world.rng.range(STRUCT.fireLingerMin, STRUCT.fireLingerMax);
          recordUse(world, fire, s);
          remember(s, {
            type: 'used_structure',
            place: `the campfire at ${fire.place}`,
            t,
            emotionalWeight: 0.3,
          });
          maybeFireGatheringEvent(world, fire);
        }
      } else {
        stand(s);
        // Face the fire and warm up: sitting together slowly meets social need.
        s.heading = lerpAngle(s.heading, angleTo(s.pos, fire.pos), 1 - Math.exp(-4 * dt));
        s.needs.social = Math.max(0, s.needs.social - 1.4 * dt);
        s.energy = clamp100(s.energy + 0.25 * dt);
        g.timer -= dt;
        if (g.timer <= 0) g.phase = 'done';
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
