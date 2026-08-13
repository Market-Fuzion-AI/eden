import { JETPACK, PLAYER } from './config';
import type { World } from './types';

/**
 * The Pathfinder Jetpack.
 *
 * Real mechanic, cheated acquisition: Developer Mode hands it over immediately,
 * but what it hands over is the finished thing. Nothing here knows or cares how
 * it was obtained.
 *
 * The control model deliberately sits *on top of* the Gate 1 jump rather than
 * beside it. Space from the ground is the jump it has always been — the same
 * coyote window, the same buffer, the same short-hop clamp. It is the *second*
 * press, in the air, that lights the pack. That ordering matters: Gate 1 passed
 * human QA on the strength of Space being jump, and a jetpack that stole the
 * key or added a modifier would be relitigating a decision that has already
 * been made.
 *
 * What stops it becoming flight:
 *   - thrust accelerates but is capped, so holding it settles into a climb
 *     rather than an escape;
 *   - fuel does not recover in the air at all, so the tank is a budget for one
 *     traversal rather than a duty cycle to hover on;
 *   - a grounded delay means bouncing does not refill it either.
 */

/** Can the pack be lit at all right now? */
export function canEngageJetpack(world: World): boolean {
  const p = world.player;
  if (!p.unlocks.jetpack) return false;
  if (p.dead || p.extraction) return false;
  if (p.onGround) return false;
  return p.jetpackFuel >= JETPACK.minToEngage;
}

/**
 * Advance the jetpack for one real-time step.
 *
 * Called from the player's vertical integration, before gravity, and returns
 * the gravity scale the caller should use — thrust does not merely add lift, it
 * makes the fall itself lighter, which is most of what separates "boosting"
 * from "falling with a party popper".
 *
 * `pressedJump` is the *edge*, not the hold: the pack lights on a fresh press
 * and sustains on the hold.
 */
export function jetpackTick(
  world: World,
  dt: number,
  input: { jump: boolean; pressedJump: boolean },
): { gravityScale: number; thrusting: boolean } {
  const p = world.player;

  if (p.onGround) {
    // Landing always cuts the burn — otherwise a pack left on would fight the
    // ground check and read as the player sticking to the floor.
    p.jetpackOn = false;
    p.jetpackIdle += dt;
    if (p.jetpackIdle >= JETPACK.rechargeDelay) {
      p.jetpackFuel = Math.min(JETPACK.maxFuel, p.jetpackFuel + JETPACK.rechargeGround * dt);
    }
    return { gravityScale: 1, thrusting: false };
  }

  // Airborne. A fresh press lights the pack; releasing puts it out.
  if (input.pressedJump && canEngageJetpack(world)) p.jetpackOn = true;
  if (!input.jump) p.jetpackOn = false;

  if (!p.jetpackOn) {
    p.jetpackIdle += dt;
    // Air recharge is zero by design; the expression is kept so the tuning
    // stays in one place rather than being implied by its own absence.
    if (JETPACK.rechargeAir > 0 && p.jetpackIdle >= JETPACK.rechargeDelay) {
      p.jetpackFuel = Math.min(JETPACK.maxFuel, p.jetpackFuel + JETPACK.rechargeAir * dt);
    }
    return { gravityScale: 1, thrusting: false };
  }

  // Burning.
  p.jetpackIdle = 0;
  p.jetpackFuel -= JETPACK.drain * dt;
  if (p.jetpackFuel <= 0) {
    // Dry. Clamp rather than allowing a negative tank to bank future thrust.
    p.jetpackFuel = 0;
    p.jetpackOn = false;
    return { gravityScale: 1, thrusting: false };
  }

  // Thrust accelerates toward the climb cap and never past it. Applied as an
  // acceleration rather than a set velocity so entering the burn from a fall
  // takes a moment to turn around — the pack catches you, it does not teleport
  // your momentum.
  if (p.vy < JETPACK.riseCap) {
    p.vy = Math.min(JETPACK.riseCap, p.vy + JETPACK.thrust * dt);
  }
  return { gravityScale: JETPACK.thrustGravityScale, thrusting: true };
}

/** 0..1, for the fuel indicator. */
export function jetpackFuelFrac(world: World): number {
  return Math.max(0, Math.min(1, world.player.jetpackFuel / JETPACK.maxFuel));
}

/**
 * Roughly how high a full tank lifts you above the apex of an ordinary jump.
 *
 * Only used by tests and tuning notes — it is the number that answers "is this
 * traversal or is this flight", and having it computed from the constants means
 * the answer cannot drift away from them.
 */
export function jetpackCeilingEstimate(): number {
  const burnSeconds = JETPACK.maxFuel / JETPACK.drain;
  // Time spent accelerating up to the cap, then the rest of the burn at it.
  const spinUp = Math.min(burnSeconds, JETPACK.riseCap / JETPACK.thrust);
  const cruise = Math.max(0, burnSeconds - spinUp);
  return (JETPACK.riseCap / 2) * spinUp + JETPACK.riseCap * cruise;
}

/** The height an ordinary jump reaches, for comparison. */
export function jumpApexEstimate(): number {
  return (PLAYER.jumpVel * PLAYER.jumpVel) / (2 * PLAYER.gravity);
}
