import { BLASTER } from './config';
import { damageCreatureByPlayer, defeatCreature, lockedTarget } from './combat';
import { CREATURE_SPECIES_BY_ID } from './species';
import { groundY } from './terrain';
import type { Creature, World } from './types';
import { dist } from './vec';

/**
 * The Pathfinder Pulse Blaster.
 *
 * EDEN's ranged foundation, kept to the smallest honest version of itself: one
 * weapon, one projectile, one target per bolt, a charge meter that refills on
 * its own. It answers a question the game could not previously ask — does
 * shooting something at range work and read as working — and it answers nothing
 * else. No rarity, no upgrades, no ammo types, no aiming modes.
 *
 * Two decisions carry most of the design:
 *
 * A travelling bolt rather than a hitscan line. The Warden already fires
 * hitscan and it is the right choice *for the Warden*, whose beam is a threat
 * you must already have moved out of. For the player the opposite is wanted:
 * you should see the shot leave, see it cross the gap, and see it land. It also
 * makes single-target fall out for free, because a bolt stops at the first body
 * it touches rather than sweeping a line through a crowd.
 *
 * Aim that a keyboard can use. EDEN must be playable with no mouse, which means
 * there is no free-aim cursor to point at anything. A locked target owns the
 * aim outright; failing that, a hostile already inside a narrow forward cone is
 * taken to be what the player meant. Outside that cone the bolt goes exactly
 * where Emerson is facing and misses, which is the correct outcome.
 */

export type FireRefusal = 'unarmed' | 'cooldown' | 'no-charge' | 'dead' | 'busy';

export interface FireAttempt {
  ok: boolean;
  reason?: FireRefusal;
}

let shotCounter = 0;

/** Where a bolt sits above the ground — Kai's chest, roughly. */
const MUZZLE_HEIGHT = 1.15;

export function canFire(world: World): FireAttempt {
  const p = world.player;
  if (p.dead || p.extraction) return { ok: false, reason: 'dead' };
  if (p.equipped !== 'pulseBlaster') return { ok: false, reason: 'unarmed' };
  if (p.dodgeTimer > 0) return { ok: false, reason: 'busy' };
  if (p.blasterCooldown > 0) return { ok: false, reason: 'cooldown' };
  if (p.blasterCharge < BLASTER.costPerShot) return { ok: false, reason: 'no-charge' };
  return { ok: true };
}

/**
 * What the shot is pointed at.
 *
 * Returns a unit direction. A lock beats assist, assist beats raw facing, and
 * raw facing is always the fallback — so the weapon can never refuse to fire
 * for want of a target.
 */
export function blasterAim(world: World): { x: number; z: number } {
  const p = world.player;
  const forward = { x: Math.sin(p.heading), z: Math.cos(p.heading) };

  const locked = lockedTarget(world);
  const aimAt = (c: Creature) => {
    const dx = c.pos.x - p.pos.x;
    const dz = c.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    return d > 0.001 ? { x: dx / d, z: dz / d } : forward;
  };
  if (locked) return aimAt(locked);

  // Nearest hostile inside the forward cone. Deliberately hostiles only: the
  // assist must never quietly point the weapon at Lumi or at a settler.
  let best: Creature | null = null;
  let bestD: number = BLASTER.assistRange;
  for (const c of world.creatures) {
    if (!c.combat || c.lumi) continue;
    const dx = c.pos.x - p.pos.x;
    const dz = c.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.001 || d > bestD) continue;
    if ((dx / d) * forward.x + (dz / d) * forward.z < BLASTER.assistCos) continue;
    best = c;
    bestD = d;
  }
  return best ? aimAt(best) : forward;
}

/** Pull the trigger. */
export function firePulse(world: World): FireAttempt {
  const check = canFire(world);
  if (!check.ok) return check;
  const p = world.player;
  const dir = blasterAim(world);

  p.blasterCharge -= BLASTER.costPerShot;
  p.blasterCooldown = BLASTER.cooldown;
  p.blasterIdle = 0;

  world.shots.push({
    id: `shot_${shotCounter++}`,
    // Leaves from about chest height, offset ahead so the bolt is never born
    // inside Emerson's own body.
    pos: { x: p.pos.x + dir.x * 0.6, z: p.pos.z + dir.z * 0.6 },
    y: p.y + MUZZLE_HEIGHT,
    dir,
    remaining: BLASTER.range,
    damage: BLASTER.damage,
    stagger: BLASTER.stagger,
    spent: false,
  });
  if (world.shots.length > BLASTER.maxShots) world.shots.shift();
  world.flags.lastShotAt = p.clock;
  return { ok: true };
}

/**
 * Advance every bolt.
 *
 * Stepped in real time alongside the player rather than on the world clock, for
 * the same reason strikes are: a shot must not travel faster because the valley
 * is being fast-forwarded.
 *
 * Movement is swept in short segments instead of teleporting the bolt a whole
 * frame's distance and testing where it landed. At 46 m/s a single 60 Hz step
 * is three quarters of a metre, which is comfortably enough to step straight
 * over a body and call it a miss.
 */
export function shotsTick(world: World, dt: number): void {
  if (world.shots.length === 0) return;
  const survivors: typeof world.shots = [];

  for (const shot of world.shots) {
    if (shot.spent) continue;
    let travel = Math.min(BLASTER.speed * dt, shot.remaining);
    let hit: Creature | null = null;

    while (travel > 0 && !hit) {
      const step = Math.min(0.5, travel);
      shot.pos.x += shot.dir.x * step;
      shot.pos.z += shot.dir.z * step;
      shot.remaining -= step;
      travel -= step;
      hit = creatureAt(world, shot.pos.x, shot.pos.z);
    }
    // The bolt rides the landscape at chest height rather than flying level.
    //
    // Flying level and culling it where the ground came up meant that on any
    // rising slope the shot died in mid-air a few metres out — a weapon that
    // silently stopped working uphill. The hit test has always been on the
    // ground plane, so height was never deciding hits; all it decides is where
    // the bolt is drawn, and it should be drawn somewhere the player can see it.
    shot.y = groundY(shot.pos.x, shot.pos.z) + MUZZLE_HEIGHT;

    if (hit) {
      // One bolt, one body. It stops here whatever else is behind it.
      const before = hit.health;
      damageCreatureByPlayer(world, hit, shot.damage, shot.stagger, { ...shot.dir });
      world.flags.lastHitAt = world.timeSec;
      if (hit.combat?.state === 'staggered') world.flags.lastStaggerAt = world.timeSec;
      if (before > 0 && hit.health <= 0) {
        world.flags.lastKillAt = world.timeSec;
        defeatCreature(world, hit);
      }
      shot.spent = true;
      // Kept for one more frame so the impact can be drawn where it happened.
      survivors.push(shot);
      continue;
    }

    // Ran out of range.
    if (shot.remaining <= 0) continue;
    survivors.push(shot);
  }

  world.shots = survivors.filter((s) => !(s.spent && s.remaining < 0));
  // Spent bolts live exactly one frame past their impact.
  for (const s of world.shots) if (s.spent) s.remaining = -1;
}

/** The first hostile a bolt at this point is inside. */
function creatureAt(world: World, x: number, z: number): Creature | null {
  for (const c of world.creatures) {
    // Only things that can fight back are shootable. The valley's harmless
    // fauna is not target practice, and Lumi least of all.
    if (!c.combat || c.lumi) continue;
    if (c.health <= 0) continue;
    const def = CREATURE_SPECIES_BY_ID[c.speciesId];
    const r = BLASTER.hitRadius + (def.dangerous ? 0.7 : 0.3);
    if (dist(c.pos, { x, z }) <= r) return c;
  }
  return null;
}

/**
 * Charge recovery and the fire-rate clock, both on the player's own time.
 * Driven from `updatePlayer` so they behave identically at every sim speed.
 */
export function blasterTick(world: World, dt: number): void {
  const p = world.player;
  p.blasterCooldown = Math.max(0, p.blasterCooldown - dt);
  p.blasterIdle += dt;
  if (p.blasterIdle >= BLASTER.rechargeDelay && p.blasterCharge < BLASTER.maxCharge) {
    p.blasterCharge = Math.min(BLASTER.maxCharge, p.blasterCharge + BLASTER.recharge * dt);
  }
}

/** 0..1, for the charge indicator. */
export function blasterChargeFrac(world: World): number {
  return Math.max(0, Math.min(1, world.player.blasterCharge / BLASTER.maxCharge));
}

// ---------------------------------------------------------------------------
// Weapon selection
// ---------------------------------------------------------------------------

/** Weapons Kai can currently hold, in slot order. */
export function availableWeapons(world: World): ('arcBlade' | 'pulseBlaster')[] {
  const p = world.player;
  const out: ('arcBlade' | 'pulseBlaster')[] = [];
  if (p.unlocks.arcBlade) out.push('arcBlade');
  if (p.unlocks.pulseBlaster) out.push('pulseBlaster');
  return out;
}

/**
 * Put a weapon in Kai's hand.
 *
 * Refuses anything not unlocked — this is the one place equipment availability
 * is decided, so Developer Mode grants a capability flag and never a special
 * case here. Switching mid-swing cancels the swing rather than queueing it.
 */
export function selectWeapon(world: World, weapon: 'arcBlade' | 'pulseBlaster'): boolean {
  const p = world.player;
  if (p.dead || p.extraction) return false;
  if (weapon === 'arcBlade' && !p.unlocks.arcBlade) return false;
  if (weapon === 'pulseBlaster' && !p.unlocks.pulseBlaster) return false;
  if (p.equipped === weapon) return false;
  p.equipped = weapon;
  p.strike = null;
  p.buffered = null;
  world.flags.lastWeaponSwapAt = p.clock;
  return true;
}
