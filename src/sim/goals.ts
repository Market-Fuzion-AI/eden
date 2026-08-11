import { RATES, SETTLER, WORLD } from './config';
import { chronicle, daylight01, isNight } from './chronicle';
import { remember } from './memory';
import { stand, stepToward } from './movement';
import { heightAt, isWater } from './terrain';
import type { Goal, GoalType, Relationship, ResourceNode, Settler, World } from './types';
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

/** Discover unknown resources within perception range; emits chronicle on global firsts. */
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
      // Only food finds make the chronicle — material nodes share labels and
      // would read as duplicate history.
      if (node.type === 'glowberry') {
        chronicle(world, 'discovery', `${s.name} found ${node.label}.`);
      }
    }
  }
}

function findSocialPartner(world: World, s: Settler): Settler | null {
  let best: Settler | null = null;
  let bestScore = -Infinity;
  for (const other of world.settlers) {
    if (other === s || other.resting || other.socialTimer > 0) continue;
    if (other.goal.type === 'socialize' && other.goal.targetId !== s.id) continue;
    const d = dist(s.pos, other.pos);
    if (d > SETTLER.socialSearchRadius) continue;
    const rel = s.relationships[other.id];
    let score = 20 - d * 0.3 + (rel ? rel.affinity * 0.35 : 0);
    if (other.speciesId === s.speciesId) score += 6;
    score += world.rng.next() * 8;
    if (rel && world.timeSec - rel.lastInteractionAt < SETTLER.socialPairCooldown) continue;
    if (score > bestScore) {
      best = other;
      bestScore = score;
    }
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

  perceiveResources(world, s);

  const food = nearestKnownFood(world, s);
  const partner = s.socialCooldownUntil > t ? null : findSocialPartner(world, s);

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

  // SOCIALIZE — needs a willing nearby partner.
  const social = partner ? s.needs.social * (0.35 + 0.85 * s.personality.sociability) : 0;
  add('socialize', social);

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
  const top = scores[0].goal as GoalType | 'eat';

  if (top !== s.goal.type || s.goal.phase === 'done') {
    startGoal(world, s, top as GoalType, food, partner);
  }
  s.goalReason = buildReason(world, s, s.goal.type, scores, food, partner);
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
  partner: Settler | null,
): void {
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
  partner: Settler | null,
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
      lines.push(`Social need ${Math.round(s.needs.social)} / 100`);
      if (partner) {
        const rel = s.relationships[partner.id];
        lines.push(rel ? `${partner.name} is nearby (affinity ${rel.affinity >= 0 ? '+' : ''}${Math.round(rel.affinity)})` : `${partner.name} is nearby`);
      } else if (s.goal.targetId) {
        lines.push('Seeking out company');
      }
      lines.push(`Sociability ${Math.round(s.personality.sociability * 100)}`);
      break;
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

function relationshipWith(s: Settler, otherId: string): Relationship {
  let rel = s.relationships[otherId];
  if (!rel) rel = s.relationships[otherId] = { affinity: 0, interactions: 0, lastInteractionAt: -999 };
  return rel;
}

function completeSocial(world: World, a: Settler, b: Settler): void {
  const t = world.timeSec;
  const rng = world.rng;
  const negative = (a.personality.aggression > 0.7 || b.personality.aggression > 0.7) && rng.chance(0.18);
  const relA = relationshipWith(a, b.id);
  const relB = relationshipWith(b, a.id);
  const firstMeeting = relA.interactions === 0;
  const delta = negative ? -(4 + rng.range(0, 4)) : 4 + a.personality.empathy * 3 + b.personality.empathy * 3;
  relA.affinity = Math.max(-100, Math.min(100, relA.affinity + delta));
  relB.affinity = Math.max(-100, Math.min(100, relB.affinity + delta));
  relA.interactions++;
  relB.interactions++;
  relA.lastInteractionAt = t;
  relB.lastInteractionAt = t;
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    x.needs.social = Math.max(0, x.needs.social - RATES.socialReduces);
    x.socialCooldownUntil = t + SETTLER.socialPairCooldown * 0.6;
    remember(x, {
      type: negative ? 'social_negative' : 'social_positive',
      subjectId: y.id,
      subjectName: y.name,
      t,
      emotionalWeight: negative ? -0.5 : 0.5,
    });
  }
  if (negative) {
    chronicle(world, 'social', `${a.name} and ${b.name} had a tense exchange.`);
  } else if (firstMeeting) {
    const cross = a.speciesId !== b.speciesId ? ' across the species divide' : '';
    chronicle(world, 'social', `${a.name} and ${b.name} shared a friendly conversation${cross}.`);
  }
}

export function settlerExecute(world: World, s: Settler, dt: number): void {
  const t = world.timeSec;
  const g = s.goal;
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
          } else {
            other.goal.phase = 'act';
            other.goal.timer = SETTLER.socialDuration;
          }
        }
      } else {
        stand(s);
        const face = angleTo(s.pos, other.pos);
        s.heading = lerpAngle(s.heading, face, 1 - Math.exp(-6 * dt));
        g.timer -= dt;
        if (g.timer <= 0) {
          // Only the lexicographically smaller id applies effects, so the pair
          // is processed exactly once.
          if (s.id < other.id || other.goal.type !== 'socialize') {
            completeSocial(world, s, other);
          }
          g.phase = 'done';
          if (other.goal.type === 'socialize' && other.goal.targetId === s.id) other.goal.phase = 'done';
        }
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
  if (s.socialTimer > 0) s.socialTimer -= dt;
  // Gentle recovery when fed and rested; starvation slowly erodes health.
  if (s.hunger < 40 && s.energy > 40) s.health = clamp100(s.health + RATES.healthRegen * dt * 0.2);
  if (s.hunger >= 99) s.health = Math.max(5, s.health - 0.2 * dt);
}
