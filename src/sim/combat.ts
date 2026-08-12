import { COMBAT, THREAT } from './config';
import { chronicle } from './chronicle';
import { CREATURE_SPECIES_BY_ID } from './species';
import type { Creature, EntityId, StrikeState, ThreatState, World } from './types';
import { dist, v2, type V2 } from './vec';

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
  /** True when the press was queued rather than performed. */
  buffered?: boolean;
}

/** The timing and reach of one swing. */
export interface StrikeSpec {
  windup: number;
  active: number;
  recover: number;
  damage: number;
  range: number;
  arcCos: number;
  stagger: number;
}

/** Which spec a given strike is running on. */
export function specFor(kind: 'light' | 'heavy', chain: number): StrikeSpec {
  if (kind === 'heavy') return COMBAT.heavy;
  return COMBAT.chain[Math.max(0, Math.min(COMBAT.chain.length - 1, chain - 1))];
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
 * Soft target assist.
 *
 * Steering with WASD while looking with a trackpad leaves a few degrees of
 * aiming error, and whiffing a strike you clearly aimed at something a metre
 * away is the least satisfying outcome in the game. This nudges Emerson's
 * facing toward a hostile *already inside his forward arc*, by a bounded
 * amount. It cannot acquire a target behind him and it cannot spin him around;
 * at `assistMaxTurn` the correction is under 25 degrees.
 */
function applyTargetAssist(world: World): void {
  const p = world.player;
  // Lock-on already owns facing. Two systems fighting over it reads as drift.
  if (p.lockedId) return;
  const fx = Math.sin(p.heading);
  const fz = Math.cos(p.heading);
  let best: Creature | null = null;
  let bestScore = -Infinity;
  for (const c of world.creatures) {
    if (!c.combat || c.lumi) continue;
    const dx = c.pos.x - p.pos.x;
    const dz = c.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > COMBAT.assistRange || d < 0.05) continue;
    const dot = (dx * fx + dz * fz) / d;
    if (dot < COMBAT.assistCos) continue;
    // Prefer whatever is most nearly in front, then whatever is closest.
    const score = dot * 4 - d * 0.2;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  if (!best) return;
  const desired = Math.atan2(best.pos.x - p.pos.x, best.pos.z - p.pos.z);
  let err = (desired - p.heading) % (Math.PI * 2);
  if (err > Math.PI) err -= Math.PI * 2;
  if (err < -Math.PI) err += Math.PI * 2;
  p.heading += Math.max(-COMBAT.assistMaxTurn, Math.min(COMBAT.assistMaxTurn, err));
}

/**
 * Begin a strike, or queue it.
 *
 * A press during the recovery of a light attack continues the chain. A press
 * during a committed swing is buffered — exactly one — and fires the instant
 * that swing is over. v0.8 dropped those presses on the floor, which meant
 * chaining required hitting a 0.26-second window on a keyboard.
 */
export function beginStrike(world: World, kind: 'light' | 'heavy'): StrikeAttempt {
  const p = world.player;
  const check = canStrike(world);
  if (!check.ok) {
    // Only a swing already in progress is worth remembering. Being unarmed or
    // mid-extraction is not a timing problem, and queueing it would fire an
    // attack seconds later for no reason the player could connect to a press.
    if (check.reason === 'busy' || check.reason === 'dodging') {
      p.buffered = { kind, age: 0, heading: p.heading };
      return { ok: false, reason: check.reason, buffered: true };
    }
    return check;
  }

  let chain = 1;
  if (
    kind === 'light' &&
    p.strike &&
    p.strike.kind === 'light' &&
    p.strike.phase === 'recover' &&
    world.timeSec - p.lastStrikeAt <= COMBAT.chainWindow
  ) {
    // Wrap rather than clamp. Clamping meant a player holding the attack key
    // got an unbroken stream of *finishers* — the slowest, hardest-hitting
    // swing, for free, forever. The sequence loops back to the opener instead.
    chain = (p.strike.chain % COMBAT.maxChain) + 1;
  }
  const spec = specFor(kind, chain);
  applyTargetAssist(world);
  p.strike = { kind, phase: 'windup', timer: spec.windup, chain, hitIds: [] };
  p.lastStrikeAt = world.timeSec;
  p.buffered = null;
  return { ok: true, chain };
}

export interface StrikeHit {
  creature: Creature;
  damage: number;
  killed: boolean;
  staggered: boolean;
}

/**
 * Advance the swing and resolve hits inside the active window.
 *
 * Real-time, alongside movement — a strike must not speed up when the world
 * does. Returns whatever it connected with this step so the renderer can react.
 */
export function strikeTick(world: World, dt: number): StrikeHit[] {
  const p = world.player;
  const hits: StrikeHit[] = [];

  // Age the queued press, and drop it once it is stale. Without the expiry a
  // press made two seconds ago would still fire, which reads as the game
  // acting on its own.
  if (p.buffered) {
    p.buffered.age += dt;
    if (p.buffered.age > COMBAT.bufferWindow) p.buffered = null;
  }

  const s = p.strike;
  if (!s) {
    releaseBuffer(world);
    return hits;
  }
  const spec = specFor(s.kind, s.chain);

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
      releaseBuffer(world);
      return hits;
    }
  }

  // A queued press comes out as soon as the swing is recoverable, which is
  // what makes the chain feel like it is following the player's hands.
  if (s.phase === 'recover') releaseBuffer(world);

  if (s.phase !== 'active') return hits;
  hits.push(...resolveActiveWindow(world, s, spec));
  return hits;
}

/** Fire the queued action, if there is one and it is now legal. */
function releaseBuffer(world: World): void {
  const p = world.player;
  const q = p.buffered;
  if (!q) return;
  if (q.kind === 'dodge') {
    if (!canDodge(world)) return;
    p.buffered = null;
    beginDodge(world);
    p.dodgeHeading = q.heading;
    if (!p.lockedId) p.heading = q.heading;
    return;
  }
  if (!canStrike(world).ok) return;
  // Clear before recursing so a refusal cannot re-queue the same press forever.
  p.buffered = null;
  beginStrike(world, q.kind);
}

/** Everything the current swing connects with this step. */
function resolveActiveWindow(world: World, s: StrikeState, spec: StrikeSpec): StrikeHit[] {
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
    const before = c.health;
    const wasStaggered = c.combat?.state === 'staggered';
    // The Capacitor is the one upgrade in the game, and it buys stagger rather
    // than damage: it changes which openings are available, not how fast the
    // healthbar empties.
    const stagger = spec.stagger * (p.unlocks.capacitor ? 1.55 : 1);
    damageCreatureByPlayer(world, c, spec.damage, stagger, { x: dx / d, z: dz / d });
    hits.push({
      creature: c,
      damage: spec.damage,
      killed: before > 0 && c.health <= 0,
      staggered: !wasStaggered && c.combat?.state === 'staggered',
    });
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
 *
 * The i-frames start immediately rather than after a startup, because the
 * whole contract of a telegraph is that pressing dodge *when you see the tell*
 * works. Any startup delay silently moves that goalpost.
 */
export function beginDodge(world: World): boolean {
  if (!canDodge(world)) return false;
  const p = world.player;
  p.dodgeTimer = COMBAT.dodgeDuration;
  p.dodgeCooldown = COMBAT.dodgeCooldown + COMBAT.dodgeDuration;
  p.invulnUntil = world.timeSec + COMBAT.dodgeIFrames;
  p.dodgeTrail = COMBAT.dodgeTrail;
  p.strike = null;
  return true;
}

/** Roll, or queue the roll if a swing is still committed. */
export function requestDodge(world: World, heading: number): boolean {
  const p = world.player;
  if (p.dead || p.extraction) return false;
  if (canDodge(world)) {
    beginDodge(world);
    p.dodgeHeading = heading;
    if (!p.lockedId) p.heading = heading;
    return true;
  }
  // Mid-swing, or still on cooldown by a hair. Remember it briefly rather than
  // dropping it — reacting to a telegraph one frame early should not be a
  // punishment for having attacked.
  p.buffered = { kind: 'dodge', age: 0, heading };
  return false;
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
export function damageCreatureByPlayer(
  world: World,
  c: Creature,
  amount: number,
  stagger = 0,
  from?: V2,
): void {
  const t = world.timeSec;
  c.health = Math.max(0, c.health - amount);
  c.hitAt = t;
  if (from) c.hitFrom = { ...from };
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  // How hard this landed relative to the creature — drives the recoil, so a
  // finisher visibly rocks a Rakhor and barely moves a Warden.
  c.hitForce = Math.max(0.25, Math.min(1, stagger / Math.max(1, def.dangerous?.staggerResist ?? 60)));

  if (c.combat) {
    c.combat.targetId = 'emerson';
    c.combat.lastSeenAt = t;
    // Re-think almost immediately. A creature's think is scheduled up to three
    // seconds out, and without this a staggered creature stayed rocked until
    // its next scheduled tick happened to come round — the reward for landing
    // a chain arrived late and at a random length.
    c.nextThinkAt = Math.min(c.nextThinkAt, t + 0.05);
    // Being attacked ends any ambiguity about whether this is a fight.
    if (c.combat.state === 'calm' || c.combat.state === 'alert' || c.combat.state === 'warn') {
      setThreatState(world, c, 'hostile');
    }
    applyStagger(world, c, stagger);
  }
  if (c.health <= 0) defeatCreature(world, c);
}

/**
 * Accumulate stagger and, past the creature's resistance, break it out of
 * whatever it was doing.
 *
 * The immunity window is what stops a stagger from becoming a stun-lock: a
 * creature that has just been rocked cannot be rocked again for a couple of
 * seconds, so the reward for landing a chain is one guaranteed opening, not
 * permanent control of the fight.
 */
export function applyStagger(world: World, c: Creature, amount: number): void {
  const m = c.combat;
  if (!m || amount <= 0) return;
  if (world.timeSec < c.combat!.staggerImmuneUntil) return;
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  const resist = def.dangerous?.staggerResist ?? 60;
  m.staggerLoad += amount;
  if (m.staggerLoad < resist) return;
  m.staggerLoad = 0;
  m.staggerImmuneUntil = world.timeSec + COMBAT.staggerDuration + COMBAT.staggerImmunity;
  setThreatState(world, c, 'staggered');
  // A staggered creature has lost its turn: push its next attack out so it
  // does not recover straight into a swing the player had no time to read.
  m.nextAttackAt = Math.max(m.nextAttackAt, world.timeSec + COMBAT.staggerDuration + 0.35);
}

/** Bleed stagger load off over time, so chip damage never accumulates forever. */
export function staggerDecayTick(world: World, c: Creature, dt: number): void {
  const m = c.combat;
  if (!m || m.staggerLoad <= 0) return;
  m.staggerLoad = Math.max(0, m.staggerLoad - COMBAT.staggerDecay * dt);
}

/** Remove a defeated creature and award whatever it leaves behind. */
export function defeatCreature(world: World, c: Creature): void {
  const def = CREATURE_SPECIES_BY_ID[c.speciesId];
  // Idempotent. Two hits resolving in the same step — a strike and a beam, or
  // a swing that catches a creature already at zero — must not pay out twice.
  if (!world.creatures.includes(c)) return;
  world.creatures = world.creatures.filter((o) => o !== c);
  world.dirty.entities = true;
  if (world.player.lockedId === c.id) world.player.lockedId = null;

  world.flags.lastKillAt = world.timeSec;
  world.flags.lastKillSynthetic = Boolean(def.synthetic);

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

/**
 * Apply damage to Emerson. Returns true when it actually landed.
 *
 * A hit briefly interrupts him — enough to be felt, never enough to chain.
 * `hitStunImmunity` guarantees that two enemies cannot alternate flinches into
 * permanent helplessness, which is the failure mode that makes a player feel
 * cheated rather than beaten.
 */
export function damagePlayer(world: World, amount: number, sourceName: string, from?: V2): boolean {
  const p = world.player;
  if (p.dead || p.extraction) return false;
  if (isInvulnerable(world)) return false;
  p.health = Math.max(0, p.health - amount);
  p.lastHurtAt = world.timeSec;
  p.lastHurtFrom = from ? { ...from } : null;
  world.flags.playerHitAt = world.timeSec;
  if (world.timeSec >= p.hitStunImmuneUntil) {
    p.hitStunUntil = world.timeSec + COMBAT.hitStun;
    p.hitStunImmuneUntil = world.timeSec + COMBAT.hitStunImmunity;
    // A hit spoils a swing but never a roll: the dodge stays the one thing
    // that always works.
    if (p.strike && p.strike.phase === 'windup') p.strike = null;
  }
  if (p.health <= 0) beginExtraction(world, sourceName);
  return true;
}

/** Is Emerson mid-flinch? Movement and attacks are suppressed, dodging is not. */
export function isHitStunned(world: World): boolean {
  return world.timeSec < world.player.hitStunUntil;
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
  p.buffered = null;
  p.lockedId = null;
  p.harvest = null;
  // Short on purpose. Being dead is not the interesting part of EDEN and the
  // player should be back on their feet before the setback stops stinging.
  p.extraction = { startedAt: world.timeSec, endsAt: world.timeSec + 3 };
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
  p.hitStunUntil = 0;
  p.buffered = null;
  p.invulnUntil = world.timeSec + 2;

  // A real but forgiving cost: part of the haul, never a capability. What it
  // actually cost is recorded rather than silently deducted — a penalty the
  // player cannot see is a penalty they cannot learn from.
  p.extractionLoss = [];
  for (const key of ['alloy', 'ore', 'crystal'] as const) {
    const lost = Math.floor(p.materials[key] * EXTRACTION_MATERIAL_LOSS);
    if (lost <= 0) continue;
    p.materials[key] = Math.max(0, p.materials[key] - lost);
    p.extractionLoss.push({ materialId: key, amount: lost });
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
  return (
    s === 'hostile' ||
    s === 'circle' ||
    s === 'windup' ||
    s === 'lunge' ||
    s === 'charge' ||
    s === 'beam' ||
    s === 'strike' ||
    s === 'recover' ||
    s === 'staggered'
  );
}

/** Is this creature currently unable to act because Emerson rocked it? */
export function isStaggered(world: World, c: Creature): boolean {
  return c.combat?.state === 'staggered' && world.timeSec - c.combat.since < COMBAT.staggerDuration;
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
