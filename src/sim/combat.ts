import { COMBAT, THREAT } from './config';
import { chronicle } from './chronicle';
import { CREATURE_SPECIES_BY_ID } from './species';
import type { Creature, EntityId, StrikeState, ThreatState, World } from './types';
import { dist, v2 } from './vec';

/**
 * Player combat.
 *
 * The v0.1 prototype applied a cone of damage the instant the key went down,
 * which meant damage arrived before anything moved and one press could strike
 * a whole crowd. This replaces it with a windowed strike: anticipation, an
 * active window during which damage may land, and a recovery. Hits register
 * only inside the window, and each swing carries the set of entities it has
 * already touched, so one swing can never hit the same target twice.
 *
 * All of it lives in simulation state. Nothing here is owned by React, and
 * every state transition is explicit enough to test.
 */

// ---------------------------------------------------------------------------
// Line of sight
// ---------------------------------------------------------------------------

/**
 * Is there a large obstacle squarely between these two points?
 *
 * Coarse on purpose: a handful of samples against the same obstacle list the
 * characters collide with. It exists to stop attacks landing through a boulder,
 * not to model occlusion.
 */
export function blocked(world: World, ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 0.001) return false;
  const steps = Math.min(8, Math.max(2, Math.ceil(len / 1.2)));
  for (const o of world.obstacles) {
    // Only genuinely large geometry can block a strike; grass tufts cannot.
    if (o.radius < 0.9) continue;
    for (let i = 1; i < steps; i++) {
      const k = i / steps;
      const px = ax + dx * k;
      const pz = az + dz * k;
      if (Math.hypot(px - o.pos.x, pz - o.pos.z) < o.radius * 0.85) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Player strikes
// ---------------------------------------------------------------------------

export type StrikeRefusal = 'unarmed' | 'busy' | 'dead' | 'dodging';

export interface StrikeAttempt {
  ok: boolean;
  reason?: StrikeRefusal;
  chain?: number;
}

/** Can Emerson swing right now? */
export function canStrike(world: World): StrikeAttempt {
  const p = world.player;
  if (p.dead || p.extraction) return { ok: false, reason: 'dead' };
  if (p.equipped !== 'arcBlade') return { ok: false, reason: 'unarmed' };
  if (p.dodgeTimer > 0) return { ok: false, reason: 'dodging' };
  // A swing may be followed up during its recovery — that is the chain — but
  // never interrupted during wind-up or the active window.
  if (p.strike && p.strike.phase !== 'recover') return { ok: false, reason: 'busy' };
  return { ok: true };
}

/**
 * Begin a strike. Light attacks chain up to `COMBAT.maxChain` when pressed
 * during the recovery of the previous swing; a heavy attack always starts fresh.
 */
export function beginStrike(world: World, kind: 'light' | 'heavy'): StrikeAttempt {
  const check = canStrike(world);
  if (!check.ok) return check;
  const p = world.player;
  const spec = kind === 'light' ? COMBAT.light : COMBAT.heavy;

  let chain = 1;
  if (kind === 'light' && p.strike && p.strike.kind === 'light' && p.strike.phase === 'recover') {
    chain = Math.min(COMBAT.maxChain, p.strike.chain + 1);
  }
  p.strike = { kind, phase: 'windup', timer: spec.windup, chain, hitIds: [] };
  return { ok: true, chain };
}

/** Damage numbers rise a little through a light chain, so a finisher lands. */
function strikeDamage(strike: StrikeState): number {
  const spec = strike.kind === 'light' ? COMBAT.light : COMBAT.heavy;
  if (strike.kind === 'heavy') return spec.damage;
  return Math.round(spec.damage * (1 + (strike.chain - 1) * 0.18));
}

export interface StrikeHit {
  creature: Creature;
  damage: number;
  killed: boolean;
}

/**
 * Advance the swing and resolve hits inside the active window.
 *
 * Real-time, alongside movement — a strike must not speed up when the world
 * does. Returns whatever it connected with this step so the renderer can react.
 */
export function strikeTick(world: World, dt: number): StrikeHit[] {
  const p = world.player;
  const s = p.strike;
  if (!s) return [];
  const spec = s.kind === 'light' ? COMBAT.light : COMBAT.heavy;
  const hits: StrikeHit[] = [];

  // Advance, carrying the overshoot into the next phase rather than discarding
  // it. A dropped frame must not silently lengthen a swing — and it must never
  // skip the active window entirely, which is what a single-transition step
  // does the moment dt exceeds a phase.
  s.timer -= dt;
  while (s.timer <= 0) {
    if (s.phase === 'windup') {
      s.phase = 'active';
      s.timer += spec.active;
    } else if (s.phase === 'active') {
      // Resolve the window before leaving it, however briefly it existed.
      hits.push(...resolveActiveWindow(world, s, spec));
      s.phase = 'recover';
      s.timer += spec.recover;
    } else {
      p.strike = null;
      return hits;
    }
  }

  if (s.phase !== 'active') return hits;
  hits.push(...resolveActiveWindow(world, s, spec));
  return hits;
}

/** Everything the current swing connects with this step. */
function resolveActiveWindow(
  world: World,
  s: StrikeState,
  spec: { range: number; arcCos: number },
): StrikeHit[] {
  const p = world.player;
  const hits: StrikeHit[] = [];

  const fx = Math.sin(p.heading);
  const fz = Math.cos(p.heading);
  for (const c of [...world.creatures]) {
    if (s.hitIds.includes(c.id)) continue; // one swing, one hit per target
    const dx = c.pos.x - p.pos.x;
    const dz = c.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > spec.range || d < 0.01) continue;
    // In front of Emerson, not behind him.
    if ((dx * fx + dz * fz) / d < spec.arcCos) continue;
    // And not through a boulder.
    if (blocked(world, p.pos.x, p.pos.z, c.pos.x, c.pos.z)) continue;

    s.hitIds.push(c.id);
    const damage = strikeDamage(s);
    const before = c.health;
    damageCreatureByPlayer(world, c, damage);
    hits.push({ creature: c, damage, killed: before > 0 && c.health <= 0 });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Dodge
// ---------------------------------------------------------------------------

export function canDodge(world: World): boolean {
  const p = world.player;
  if (p.dead || p.extraction) return false;
  if (p.dodgeCooldown > 0 || p.dodgeTimer > 0) return false;
  // A committed swing cannot be cancelled into a roll; a recovery can.
  return !p.strike || p.strike.phase === 'recover';
}

/**
 * Roll. Both a displacement *and* a short mercy window — the displacement is
 * what makes it read, the i-frames are what make imperfect timing survivable
 * while the player is still learning.
 */
export function beginDodge(world: World): boolean {
  if (!canDodge(world)) return false;
  const p = world.player;
  p.dodgeTimer = COMBAT.dodgeDuration;
  p.dodgeCooldown = COMBAT.dodgeCooldown + COMBAT.dodgeDuration;
  p.invulnUntil = world.timeSec + COMBAT.dodgeIFrames;
  p.strike = null;
  return true;
}

export function isInvulnerable(world: World): boolean {
  return world.timeSec < world.player.invulnUntil;
}

// ---------------------------------------------------------------------------
// Lock-on
// ---------------------------------------------------------------------------

/** Creatures worth locking onto: those that can actually threaten Emerson. */
export function lockCandidates(world: World): Creature[] {
  const p = world.player;
  return world.creatures
    .filter((c) => c.combat && !c.lumi && dist(c.pos, p.pos) <= COMBAT.lockRange)
    .sort((a, b) => dist(a.pos, p.pos) - dist(b.pos, p.pos));
}

/**
 * Toggle the lock. Never targets Lumi, ordinary fauna or settlers — locking
 * onto something harmless would be a lie about the danger of the situation.
 */
export function toggleLock(world: World): Creature | null {
  const p = world.player;
  if (p.lockedId) {
    p.lockedId = null;
    return null;
  }
  const target = lockCandidates(world)[0] ?? null;
  p.lockedId = target?.id ?? null;
  return target;
}

export function lockedTarget(world: World): Creature | null {
  const id = world.player.lockedId;
  if (!id) return null;
  return world.creatures.find((c) => c.id === id) ?? null;
}

/** Drop a lock that has become meaningless. */
export function lockTick(world: World): void {
  const p = world.player;
  if (!p.lockedId) return;
  const target = lockedTarget(world);
  if (!target || target.health <= 0 || dist(target.pos, p.pos) > COMBAT.lockBreakRange) {
    p.lockedId = null;
  }
}

// ---------------------------------------------------------------------------
// Damage to creatures
// ---------------------------------------------------------------------------

/**
 * Apply player damage. Kept here rather than in wildlife.ts so the combat
 * rules — stagger, provocation, salvage — live in one place.
 */
export function damageCreatureByPlayer(world: World, c: Creature, amount: number): void {
  const t = world.timeSec;
  c.health = Math.max(0, c.health - amount);
  c.hitAt = t;
  // A hit interrupts a wind-up: landing the first blow is worth something.
  if (c.combat) {
    if (c.combat.state === 'windup') setThreatState(world, c, 'recover');
    c.combat.targetId = 'emerson';
    c.combat.lastSeenAt = t;
    if (c.combat.state === 'calm' || c.combat.state === 'alert' || c.combat.state === 'warn') {
      setThreatState(world, c, 'hostile');
    }
  }
  if (c.health <= 0) defeatCreature(world, c);
}

/** Remove a defeated creature and award whatever it leaves behind. */
export function defeatCreature(world: World, c: Creature): void {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  world.creatures = world.creatures.filter((o) => o !== c);
  world.dirty.entities = true;
  if (world.player.lockedId === c.id) world.player.lockedId = null;

  if (def.synthetic) {
    // The only source of core fragments in the world: there is no node for
    // them anywhere, so holding one means having survived a Warden.
    world.player.salvage.coreFragment += 1;
    world.pickupsSalvage.push({ salvageId: 'coreFragment', amount: 1, at: world.timeSec });
    if (world.pickupsSalvage.length > 4) world.pickupsSalvage.shift();
    world.ariQueue.push(
      world.player.salvage.coreFragment === 1
        ? 'Core fragment recovered. This architecture matches nothing in the colony archive, Emerson. Nothing at all.'
        : 'Another core fragment. Petra will want to see this.',
    );
    chronicle(world, 'wildlife', `Emerson disabled a ${def.name} near ${placeOf(world, c)}.`, {
      actorIds: ['emerson'],
      actorNames: ['Emerson'],
      pos: { ...c.pos },
      cause: ['The sentinel treated him as an intruder'],
      effects: ['A synthetic core fragment was recovered', 'Its purpose remains unknown'],
    });
  } else {
    chronicle(world, 'wildlife', `Emerson brought down a ${def.name} near ${placeOf(world, c)}.`, {
      actorIds: ['emerson'],
      actorNames: ['Emerson'],
      pos: { ...c.pos },
      cause: ['The animal pressed its attack'],
      effects: ['The valley has one fewer predator'],
    });
  }
}

function placeOf(world: World, c: Creature): string {
  // Imported lazily to keep this module free of a landmark dependency cycle.
  return world.landmarkNameAt ? world.landmarkNameAt(c.pos) : 'the valley';
}

// ---------------------------------------------------------------------------
// Damage to Emerson
// ---------------------------------------------------------------------------

/** Apply damage to Emerson. Returns true when it actually landed. */
export function damagePlayer(world: World, amount: number, sourceName: string): boolean {
  const p = world.player;
  if (p.dead || p.extraction) return false;
  if (isInvulnerable(world)) return false;
  p.health = Math.max(0, p.health - amount);
  p.lastHurtAt = world.timeSec;
  world.flags.playerHitAt = world.timeSec;
  if (p.health <= 0) beginExtraction(world, sourceName);
  return true;
}

// ---------------------------------------------------------------------------
// Emergency extraction — the player-failure loop
// ---------------------------------------------------------------------------

/** How much of the unbanked material haul is lost on extraction. */
const EXTRACTION_MATERIAL_LOSS = 0.25;

/**
 * Emerson going down must never reset the world.
 *
 * ARI fires the beacon, he is recovered to Human Landing, and the valley keeps
 * running the whole time: settlers keep their relationships, structures stand,
 * time advances. Permanent capabilities — the Scanner, the Arc Blade — are
 * never taken away. Only a quarter of the materials he was carrying are lost.
 */
export function beginExtraction(world: World, cause: string): void {
  const p = world.player;
  if (p.extraction) return;
  p.dead = true;
  p.health = 0;
  p.strike = null;
  p.lockedId = null;
  p.harvest = null;
  p.extraction = { startedAt: world.timeSec, endsAt: world.timeSec + 4 };
  p.extractions += 1;
  chronicle(world, 'emerson', `Emerson went down near ${world.landmarkNameAt?.(p.pos) ?? 'the valley'}. ARI triggered an emergency extraction.`, {
    actorIds: ['emerson'],
    actorNames: ['Emerson'],
    pos: { ...p.pos },
    cause: [`Brought down by ${cause}`],
    effects: ['Recovered to Human Landing', 'The valley carried on without him'],
  });
}

/** Complete the extraction: relocate, restore, and say something about it. */
export function finishExtraction(world: World): void {
  const p = world.player;
  if (!p.extraction) return;
  const camp = world.camps.find((c) => c.speciesId === 'human');
  const pad = world.landmarksBuilt.find((b) => b.kind === 'pod') ?? null;
  const home = pad?.pos ?? camp?.pos ?? v2(0, 0);
  p.pos = v2(home.x + 3.2, home.z + 3.2);
  p.y = 0;
  p.vy = 0;
  p.speed = 0;
  p.moveSpeed = 0;
  p.health = 55;
  p.stamina = 70;
  p.dead = false;
  p.extraction = null;
  p.invulnUntil = world.timeSec + 2;

  // A real but forgiving cost: part of the haul, never a capability.
  for (const key of ['alloy', 'ore', 'crystal'] as const) {
    const lost = Math.floor(p.materials[key] * EXTRACTION_MATERIAL_LOSS);
    p.materials[key] = Math.max(0, p.materials[key] - lost);
  }

  world.ariQueue.push(
    p.extractions === 1
      ? 'Emergency retrieval complete. You lost some of the haul in the process. I strongly recommend not repeating that.'
      : `Retrieval number ${p.extractions}. I am beginning to think this is a strategy.`,
  );
}

// ---------------------------------------------------------------------------
// Threat state transitions
// ---------------------------------------------------------------------------

/** Move a creature into a new combat state, stamping when it began. */
export function setThreatState(world: World, c: Creature, state: ThreatState): void {
  if (!c.combat) return;
  if (c.combat.state === state) return;
  c.combat.state = state;
  c.combat.since = world.timeSec;
}

/** Is this creature currently a danger to Emerson? */
export function isHostile(c: Creature): boolean {
  const s = c.combat?.state;
  return s === 'hostile' || s === 'windup' || s === 'strike' || s === 'recover';
}

/** Nothing hunts inside Human Landing. */
export function insideSafeZone(world: World, x: number, z: number): boolean {
  const camp = world.camps.find((c) => c.speciesId === 'human');
  if (!camp) return false;
  return dist({ x, z }, camp.pos) < THREAT.safeRadius;
}

/** Every creature currently engaged with Emerson. */
export function activeThreats(world: World): Creature[] {
  return world.creatures.filter((c) => c.combat && isHostile(c));
}

/** True while Emerson is in a fight — used for HUD state and regen gating. */
export function inCombat(world: World): boolean {
  const p = world.player;
  if (world.timeSec - p.lastHurtAt < COMBAT.regenDelay) return true;
  return activeThreats(world).some((c) => dist(c.pos, p.pos) < 30);
}

export type { EntityId };
