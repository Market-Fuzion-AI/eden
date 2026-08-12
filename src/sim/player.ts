import { COMBAT, FABRICATOR, GATHER, NORM, PLAYER, RATES, SETTLER, WILDLIFE, WORLD } from './config';
import { chronicle } from './chronicle';
import {
  beginExtraction,
  beginStrike,
  finishExtraction,
  inCombat,
  isHitStunned,
  lockTick,
  lockedTarget,
  requestDodge,
  strikeTick,
  toggleLock,
  type StrikeAttempt,
} from './combat';
import { buildExchange, type DialogueExchange } from './dialogue';
import { placeName } from './landmarks';
import { remember } from './memory';
import { emersonBlocker, observePlayerAsk } from './normEvents';
import { attitudeFor, decidePermission, permissionLine } from './norms';
import { applyRelationship, peekRelationship, relationshipState } from './relationships';
import { collectMaterial, materialForNodeType } from './fabrication';
import { emersonKnows, witnessNorm } from './socialKnowledge';
import { missingResources } from './structures';
import { standingHeight } from './course';
import { groundY, isWater } from './terrain';
import type { Creature, ResourceNode, Settler, Structure, World } from './types';
import { clamp100, dist, v2 } from './vec';

/**
 * Emerson's simulation state and actions. Movement integrates in real time
 * (the player is not fast-forwarded at high sim speeds), but all world
 * interactions go through normal simulation rules.
 */

export interface PlayerInput {
  moveX: number; // -1..1 strafe: +1 = the player's right on screen
  moveZ: number; // -1..1 forward: +1 = away from the camera
  sprint: boolean;
  jump: boolean;
  camYaw: number;
}

/**
 * Camera-relative movement basis.
 *
 * The chase camera sits behind the player along -(sin yaw, cos yaw), so the
 * on-screen FORWARD direction is f = (sin yaw, cos yaw). In three.js' Y-up
 * right-handed space the on-screen RIGHT direction is r = f × up =
 * (-cos yaw, sin yaw).
 *
 * Desired motion is therefore moveZ·f + moveX·r, which is the heading
 * camYaw + atan2(-moveX, moveZ). The negation on moveX is what makes A/D
 * match the camera; omitting it silently mirrors strafing.
 */
export function headingFromInput(camYaw: number, moveX: number, moveZ: number): number {
  return camYaw + Math.atan2(-moveX, moveZ);
}

/** Unit direction on the ground plane for a heading — the sim's movement convention. */
export function dirFromHeading(heading: number): { x: number; z: number } {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

/**
 * Movement diagnostics for the Gate 1 QA overlay.
 *
 * Written by `updatePlayer`, read only by the overlay. Nothing in the
 * simulation reads it back, so it cannot affect determinism — it exists so a
 * human tester can see *why* a step felt wrong instead of guessing at it.
 */
export const moveTelemetry = {
  /** Obstacles pushing on Emerson this frame. */
  contacts: 0,
  /** 0 = moved the full intended distance, 1 = went nowhere. */
  blocked: 0,
  /** True while a slope is too steep to walk straight up. */
  slopeSlide: false,
  /** True when the surface underfoot is a course prop rather than terrain. */
  onProp: false,
};

let nextOfferId = 0;

export function updatePlayer(world: World, dt: number, input: PlayerInput): void {
  const p = world.player;

  // Emergency extraction. Emerson is out of the fight and the valley is not:
  // the simulation keeps running underneath this the entire time.
  if (p.extraction) {
    p.speed = 0;
    p.moveSpeed = 0;
    if (world.timeSec >= p.extraction.endsAt) finishExtraction(world);
    return;
  }
  if (p.dead) {
    // Should be unreachable — every route to zero health goes through
    // `beginExtraction` — but a stranded `dead` flag would soft-lock the game,
    // so recover rather than freeze.
    beginExtraction(world, 'unknown causes');
    return;
  }

  // Timers. `clock` is Emerson's own, and advances in real seconds — see the
  // note on `PlayerState.clock`.
  p.clock += dt;
  p.dodgeCooldown = Math.max(0, p.dodgeCooldown - dt);
  p.dodgeTimer = Math.max(0, p.dodgeTimer - dt);
  p.dodgeTrail = Math.max(0, p.dodgeTrail - dt);

  // Combat advances in real time alongside movement, never at the simulation's
  // speed multiplier — a strike must not get faster because the world does.
  const hits = strikeTick(world, dt);
  for (const h of hits) {
    world.flags.lastHitAt = world.timeSec;
    if (h.staggered) world.flags.lastStaggerAt = world.timeSec;
    if (h.killed) world.flags.lastKillAt = world.timeSec;
  }
  lockTick(world);

  // --- movement relative to camera yaw ------------------------------------
  //
  // Emerson accelerates into a run and coasts to a stop rather than snapping
  // between full speed and zero, and turns toward his travel direction instead
  // of pivoting instantly. Both are deliberately quick: this is action-RPG
  // responsiveness, not momentum simulation. The heading is kept as its own
  // value so a future lock-on mode can decouple facing from travel without
  // touching any of this.
  const mag = Math.hypot(input.moveX, input.moveZ);
  const moving = mag > 0.05;
  const sprinting = moving && input.sprint && p.stamina > 5;
  // Committing to a swing plants Emerson: the wind-up and the active window
  // barely move him, and only the recovery lets him walk out of it. Without
  // this a light attack can be spammed while sprinting and nothing has weight.
  const committed = p.strike !== null && p.strike.phase !== 'recover';
  // A hit knocks Emerson off his stride for a fraction of a second. Short by
  // design, and `hitStunImmuneUntil` guarantees it can never chain.
  const flinching = isHitStunned(world);
  let targetSpeed = 0;
  if (p.dodgeTimer > 0) {
    targetSpeed = COMBAT.dodgeSpeed;
  } else if (committed || flinching) {
    targetSpeed = 0;
  } else if (moving) {
    targetSpeed = (sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed) * Math.min(1, mag);
    if (sprinting) {
      p.stamina = Math.max(0, p.stamina - 10 * dt);
      p.lastSprintAt = world.timeSec;
    }
  }
  // Getting going is snappier than stopping, which is what reads as "intent".
  // In the air the player keeps most of their momentum and only some of their
  // steering: a jump you can fully redirect mid-flight has no commitment, and
  // one you cannot steer at all reads as a bug.
  const airborne = !p.onGround;
  const accelRate = targetSpeed > p.moveSpeed ? PLAYER.accel : PLAYER.decel;
  const accel = airborne ? accelRate * PLAYER.airControl : accelRate;
  p.moveSpeed += (targetSpeed - p.moveSpeed) * Math.min(1, accel * dt);
  if (p.moveSpeed < 0.02) p.moveSpeed = 0;

  // Where a step actually travels. Normally the same as facing; while locked on
  // it is not, which is what lets Emerson circle something instead of only ever
  // walking at it.
  const target = lockedTarget(world);
  let travelHeading = p.heading;
  if (target) {
    // Face the threat, always. Strafing and backing off stay on the sticks.
    const desired = Math.atan2(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
    let err = (desired - p.heading) % (Math.PI * 2);
    if (err > Math.PI) err -= Math.PI * 2;
    if (err < -Math.PI) err += Math.PI * 2;
    p.heading += err * Math.min(1, PLAYER.turnRate * 0.8 * dt);
    travelHeading = moving ? headingFromInput(input.camYaw, input.moveX, input.moveZ) : p.heading;
  } else if (moving && !committed && !flinching) {
    // Turn toward the travel direction. Sharp reversals rotate faster, so a
    // 180 feels decisive instead of like a slow arc.
    const desired = headingFromInput(input.camYaw, input.moveX, input.moveZ);
    let err = (desired - p.heading) % (Math.PI * 2);
    if (err > Math.PI) err -= Math.PI * 2;
    if (err < -Math.PI) err += Math.PI * 2;
    const turnRate = PLAYER.turnRate * (1 + Math.abs(err) / Math.PI) * (airborne ? PLAYER.airControl : 1);
    p.heading += err * Math.min(1, turnRate * dt);
    travelHeading = p.heading;
  }

  if (p.moveSpeed > 0.02 || p.dodgeTimer > 0) {
    const inWater = isWater(p.pos.x, p.pos.z);
    const rolling = p.dodgeTimer > 0;
    const effSpeed = (rolling ? COMBAT.dodgeSpeed : p.moveSpeed) * (inWater ? 0.5 : 1);
    const stepHeading = rolling ? p.dodgeHeading : travelHeading;
    let nx = p.pos.x + Math.sin(stepHeading) * effSpeed * dt;
    let nz = p.pos.z + Math.cos(stepHeading) * effSpeed * dt;
    // Obstacle resolution.
    //
    // Radial push-out alone slides correctly along a single boulder but wedges
    // between two: escaping one pushes into the other, and a single pass leaves
    // Emerson inside the second. Relaxing a few times converges on the corner
    // instead — which matters far more now that fights happen next to rocks
    // rather than in open meadow.
    let contacts = 0;
    for (let pass = 0; pass < 4; pass++) {
      let corrected = false;
      for (const o of world.obstacles) {
        // Standing on top of it: it is a floor now, not a wall. The margin lets
        // him step off the edge without the circle grabbing him on the way down.
        if (o.top !== undefined && p.y >= o.top - 0.12) continue;
        const ox = nx - o.pos.x;
        const oz = nz - o.pos.z;
        const od = Math.hypot(ox, oz);
        const min = o.radius + PLAYER.bodyRadius;
        if (od >= min) continue;
        if (pass === 0) contacts++;
        if (od <= 0.001) {
          // Dead centre: no direction to push along. Use the travel heading.
          nx += Math.sin(stepHeading + Math.PI) * min;
          nz += Math.cos(stepHeading + Math.PI) * min;
          corrected = true;
          continue;
        }
        const push = (min - od) / od;
        nx += ox * push;
        nz += oz * push;
        corrected = true;
      }
      if (!corrected) break;
    }
    // Character presence: Emerson cannot walk through the inhabitants.
    // Settlers are solid; small creatures scatter rather than block.
    for (const s of world.settlers) {
      const ox = nx - s.pos.x;
      const oz = nz - s.pos.z;
      const od = Math.hypot(ox, oz);
      const min = PLAYER.bodyRadius + SETTLER.bodyRadius;
      if (od < min && od > 0.001) {
        const push = (min - od) / od;
        // Emerson takes most of the correction; the settler yields a little.
        nx += ox * push * 0.75;
        nz += oz * push * 0.75;
        s.pos.x -= ox * push * 0.25;
        s.pos.z -= oz * push * 0.25;
      }
    }

    const r = Math.hypot(nx, nz);
    if (r > WORLD.playRadius) {
      const s = WORLD.playRadius / r;
      nx *= s;
      nz *= s;
    }
    // Steep ground slows the climb rather than blocking it, so walking uphill
    // toward the Skyreach reads as effort instead of as an invisible wall.
    // Course surfaces are flat by construction, so a platform never reads as a
    // cliff the player is refused permission to walk onto.
    const climb = airborne
      ? 0
      : standingHeight(world, nx, nz, p.y) - standingHeight(world, p.pos.x, p.pos.z, p.y);
    moveTelemetry.slopeSlide = false;
    if (climb > 0.02) {
      const grade = climb / Math.max(0.001, effSpeed * dt);
      if (grade > 1.6) {
        moveTelemetry.slopeSlide = true;
        // Too steep to walk straight up. Rather than simply refusing the step —
        // which pins the player against a cliff face with no way out but a
        // full stop — strip the uphill component and keep whatever runs along
        // the slope, so a diagonal approach traverses instead of sticking.
        const dx = nx - p.pos.x;
        const dz = nz - p.pos.z;
        const e = 0.6;
        const gx = groundY(p.pos.x + e, p.pos.z) - groundY(p.pos.x - e, p.pos.z);
        const gz = groundY(p.pos.x, p.pos.z + e) - groundY(p.pos.x, p.pos.z - e);
        const gl = Math.hypot(gx, gz);
        if (gl > 0.0001) {
          const ux = gx / gl;
          const uz = gz / gl;
          const into = dx * ux + dz * uz;
          // Keep a sliver of the uphill push so a straight-on approach still
          // creeps upward rather than stopping dead at the foot of the slope.
          const keep = 0.15;
          nx = p.pos.x + dx - ux * into * (1 - keep);
          nz = p.pos.z + dz - uz * into * (1 - keep);
        } else {
          nx = p.pos.x + dx * 0.15;
          nz = p.pos.z + dz * 0.15;
        }
      }
    }
    // Report the distance actually covered, not the distance intended. Walking
    // into a boulder should look like walking into a boulder — the v0.6 wedge
    // bug hid itself for a whole milestone precisely because the agent kept
    // reporting full speed while standing still.
    const travelled = Math.hypot(nx - p.pos.x, nz - p.pos.z);
    p.pos.x = nx;
    p.pos.z = nz;
    p.speed = dt > 0 ? travelled / dt : 0;
    const intended = effSpeed * dt;
    moveTelemetry.contacts = contacts;
    moveTelemetry.blocked = intended > 0.0001 ? Math.max(0, 1 - travelled / intended) : 0;
  } else {
    p.speed = 0;
    moveTelemetry.contacts = 0;
    moveTelemetry.blocked = 0;
    moveTelemetry.slopeSlide = false;
  }
  if (!input.sprint) p.stamina = clamp100(p.stamina + 7 * dt);

  // --- vertical ------------------------------------------------------------
  //
  // An action-game jump rather than a physical one. Three forgiveness
  // mechanisms do most of the work of making it feel reliable: a coyote window
  // so stepping off a lip still jumps, an input buffer so a press just before
  // landing is not swallowed, and a short-hop cut so tapping and holding are
  // different heights. Falling is faster than rising, which is most of why a
  // low jump can still feel snappy rather than floaty.
  // Airborne, only a surface actually beneath his feet catches him; on the
  // ground, the full step-up tolerance applies. See `courseSupportAt`.
  const landTolerance = p.onGround ? PLAYER.stepHeight : PLAYER.airLandTolerance;
  const ground = standingHeight(world, p.pos.x, p.pos.z, p.y, landTolerance);
  moveTelemetry.onProp = ground > groundY(p.pos.x, p.pos.z) + 0.02;

  // Walking off an edge must drop him, not teleport him down. Before Gate 1
  // `onGround` pinned `y` to the ground every frame, so a ledge was a step.
  if (p.onGround && p.y > ground + 0.06) {
    p.onGround = false;
    p.vy = 0;
  }
  if (p.onGround) p.coyoteUntil = p.clock + PLAYER.coyoteTime;

  const pressedJump = input.jump && !p.jumpHeld;
  p.jumpHeld = input.jump;
  if (pressedJump) p.jumpBufferedUntil = p.clock + PLAYER.jumpBuffer;

  const mayJump = p.onGround || p.clock < p.coyoteUntil;
  if (p.clock < p.jumpBufferedUntil && mayJump && !p.dodgeTimer) {
    p.vy = PLAYER.jumpVel;
    p.onGround = false;
    p.coyoteUntil = 0;
    p.jumpBufferedUntil = 0;
    world.flags.lastJumpAt = p.clock;
  }

  if (!p.onGround) {
    // Releasing early clamps the climb. Held, the jump goes to full height.
    if (p.vy > PLAYER.jumpCutVel && !input.jump) p.vy = PLAYER.jumpCutVel;
    const g = PLAYER.gravity * (p.vy < 0 ? PLAYER.fallGravityScale : 1);
    p.vy -= g * dt;
    p.y += p.vy * dt;
    if (p.y <= ground) {
      p.y = ground;
      p.vy = 0;
      p.onGround = true;
      world.flags.lastLandAt = p.clock;
    }
  } else {
    // Grounded: follow the surface, including stepping up onto low geometry.
    p.y = ground;
  }

  // Gathering interaction, in real time alongside movement.
  harvestTick(world);

  // Passive recovery — but never mid-fight. Regenerating while something is
  // winding up to hit you is what turns a threat into an inconvenience.
  if (!inCombat(world)) p.health = clamp100(p.health + 0.6 * dt);
}

/**
 * Swing the Arc Blade. Light chains, heavy commits.
 *
 * Returns the refusal when nothing happened, so the caller can say something
 * useful about *why* rather than the input silently doing nothing.
 */
export function playerStrike(world: World, kind: 'light' | 'heavy'): StrikeAttempt {
  const result = beginStrike(world, kind);
  if (!result.ok && result.reason === 'unarmed' && !world.flags.unarmedHinted) {
    world.flags.unarmedHinted = true;
    world.ariQueue.push(
      'You have nothing to fight with, Emerson. Petra can cut you a blade at the Fabricator if you bring her the material.',
    );
  }
  return result;
}

/**
 * Roll.
 *
 * The direction is the movement input if there is any. Standing still, it goes
 * backwards — away from the locked target if there is one, and away from
 * whatever Emerson is facing otherwise — because a standing dodge whose whole
 * job is to answer an incoming attack should always open distance.
 */
export function playerDodge(world: World, input?: { moveX: number; moveZ: number; camYaw: number }): boolean {
  const p = world.player;
  let heading = p.heading + Math.PI;
  const target = lockedTarget(world);
  if (target) heading = Math.atan2(p.pos.x - target.pos.x, p.pos.z - target.pos.z);
  if (input && Math.hypot(input.moveX, input.moveZ) > 0.05) {
    heading = headingFromInput(input.camYaw, input.moveX, input.moveZ);
  }
  return requestDodge(world, heading);
}

/** Toggle lock-on, and tell the player when there is nothing worth locking. */
export function playerToggleLock(world: World): Creature | null {
  const had = world.player.lockedId;
  const target = toggleLock(world);
  if (!had && !target && !world.flags.lockHinted) {
    world.flags.lockHinted = true;
    world.ariQueue.push('Nothing hostile in range to track.');
  }
  return target;
}

export interface InteractionPrompt {
  key: string;
  label: string;
  action: 'gather' | 'offer' | 'talk' | 'harvest' | 'contribute' | 'ask' | 'salvage' | 'fabricate';
}

// ---------------------------------------------------------------------------
// Fabrication materials
// ---------------------------------------------------------------------------

/** A material node Emerson is standing at and which still holds something. */
export function materialNodeAtHand(world: World): ResourceNode | null {
  const p = world.player;
  if (p.dead) return null;
  let best: ResourceNode | null = null;
  let bestD: number = GATHER.range;
  for (const r of world.resources) {
    if (!materialForNodeType(r.type)) continue;
    if (r.quantity < 1) continue;
    const d = dist(r.pos, p.pos);
    if (d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best;
}

/** True when Emerson is close enough to operate the fabricator. */
export function fabricatorAtHand(world: World): boolean {
  const p = world.player;
  if (p.dead || !world.fabricatorPos) return false;
  return dist(world.fabricatorPos, p.pos) < FABRICATOR.range;
}

/**
 * Begin working a material node. The interaction takes real time and is
 * cancelled by walking away, so gathering reads as an act rather than a
 * number going up.
 */
export function startHarvest(world: World, node: ResourceNode): boolean {
  const p = world.player;
  if (p.harvest) return false;
  if (!materialForNodeType(node.type) || node.quantity < 1) return false;
  p.harvest = {
    nodeId: node.id,
    startedAt: world.timeSec,
    endsAt: world.timeSec + GATHER.duration,
    from: { x: p.pos.x, z: p.pos.z },
  };
  return true;
}

/** 0..1 progress of the current gathering interaction, or 0 when idle. */
export function harvestProgress(world: World): number {
  const h = world.player.harvest;
  if (!h) return 0;
  const span = Math.max(0.001, h.endsAt - h.startedAt);
  return Math.max(0, Math.min(1, (world.timeSec - h.startedAt) / span));
}

/**
 * Advance the gathering interaction. Driven from `updatePlayer`, so it runs in
 * real time alongside movement rather than at the simulation's speed multiplier.
 */
function harvestTick(world: World): void {
  const p = world.player;
  const h = p.harvest;
  if (!h) return;
  const node = world.resources.find((r) => r.id === h.nodeId);
  // Walked away, or the seam ran out under him.
  if (!node || node.quantity < 1 || dist(p.pos, h.from) > GATHER.cancelDistance) {
    p.harvest = null;
    return;
  }
  if (world.timeSec < h.endsAt) return;
  p.harvest = null;
  const got = collectMaterial(world, node.id);
  if (!got) return;
  world.pickups.push({ materialId: got.material.id, amount: got.amount, at: world.timeSec });
  if (world.pickups.length > 6) world.pickups.splice(0, world.pickups.length - 6);
  if (!world.flags[`firstMaterial_${got.material.id}`]) {
    world.flags[`firstMaterial_${got.material.id}`] = true;
    world.ariQueue.push(`${got.material.name}. ${got.material.description} Petra will want this.`);
  }
}

/** A material node Emerson is standing at. */
function materialAtHand(world: World): ResourceNode | null {
  const p = world.player;
  return (
    world.resources.find(
      (r) => (r.type === 'wood' || r.type === 'stone') && r.quantity >= 1 && dist(r.pos, p.pos) < PLAYER.interactRange + 1.2,
    ) ?? null
  );
}

/** An unfinished structure Emerson could contribute to. */
function siteAtHand(world: World): Structure | null {
  const p = world.player;
  return (
    world.structures.find((s) => s.state !== 'complete' && dist(s.pos, p.pos) < PLAYER.interactRange + 1.5) ?? null
  );
}

/** Nearest settler Emerson could speak with right now. */
export function nearestTalkable(world: World): Settler | null {
  const p = world.player;
  if (p.dead) return null;
  let best: Settler | null = null;
  let bestD = PLAYER.talkRange;
  for (const s of world.settlers) {
    if (s.resting) continue;
    const d = dist(s.pos, p.pos);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** Compute the contextual prompt(s) shown in the Live HUD. */
export function getInteractions(world: World): InteractionPrompt[] {
  const p = world.player;
  if (p.dead) return [];
  const out: InteractionPrompt[] = [];
  const bush = world.resources.find(
    (r) => r.type === 'glowberry' && r.quantity >= 1 && dist(r.pos, p.pos) < PLAYER.interactRange,
  );
  const site = siteAtHand(world);
  const material = materialAtHand(world);
  const fabMaterial = materialNodeAtHand(world);
  // Fabrication materials take precedence: they are the reason to be out here.
  if (fabMaterial) {
    const def = materialForNodeType(fabMaterial.type)!;
    out.push({ key: 'E', label: `${def.verb} ${def.name}`, action: 'salvage' });
  } else if (fabricatorAtHand(world)) {
    out.push({ key: 'E', label: 'Use the Fabricator', action: 'fabricate' });
  } else if (site && (p.wood > 0 || p.stone > 0)) {
    // Emerson can carry materials to a settler's project like anyone else.
    out.push({ key: 'E', label: `Contribute to the ${site.type}`, action: 'contribute' });
  } else if (material && p.wood + p.stone < PLAYER.maxMaterials) {
    out.push({ key: 'E', label: `Gather ${material.type}`, action: 'harvest' });
  } else if (bush && p.berries < PLAYER.maxBerries) {
    out.push({ key: 'E', label: 'Gather glowberries', action: 'gather' });
  } else {
    const talkable = nearestTalkable(world);
    // Only offer conversation when they are not already mid-exchange with us.
    if (talkable && world.timeSec >= talkable.talkingUntil) {
      out.push({ key: 'E', label: `Talk to ${talkable.name}`, action: 'talk' });
    }
  }
  if (p.berries > 0) {
    const lumi = world.creatures.find((c) => c.lumi && dist(c.pos, p.pos) < PLAYER.offerRange);
    if (lumi) out.push({ key: 'F', label: 'Offer a glowberry', action: 'offer' });
  }

  // Standing at a shelter somebody considers theirs. Emerson is *not* told who
  // that is unless he has seen something to tell him — the prompt names a
  // claimant only when he has personally witnessed them acting like one.
  const shelter = shelterAtHand(world);
  if (shelter) {
    const blocker = emersonBlocker(world, shelter);
    if (blocker && dist(blocker.settler.pos, p.pos) < NORM.askRange) {
      const known = emersonKnows(world, shelter.id, blocker.settler.id);
      out.push({
        key: 'R',
        label: known ? `Ask ${blocker.settler.name} to use the shelter` : 'Ask about using the shelter',
        action: 'ask',
      });
    }
  }
  return out;
}

/** A completed shelter Emerson is standing in. */
export function shelterAtHand(world: World): Structure | null {
  const p = world.player;
  if (p.dead) return null;
  return (
    world.structures.find(
      (s) => s.type === 'shelter' && s.state === 'complete' && dist(s.pos, p.pos) < PLAYER.interactRange + 1.5,
    ) ?? null
  );
}

/**
 * Emerson asks a claimant for leave to use their shelter. Resolved by exactly
 * the same machinery the settlers use on each other — and watched by whoever
 * happens to be standing nearby, who learn from it like any other onlooker.
 */
export function playerAskPermission(world: World): { name: string; line: string; outcome: string } | null {
  const p = world.player;
  const shelter = shelterAtHand(world);
  if (!shelter) return null;
  const blocker = emersonBlocker(world, shelter);
  if (!blocker) return null;
  const claimant = blocker.settler;
  if (dist(claimant.pos, p.pos) > NORM.askRange) return null;

  const emerson = { id: 'emerson', name: 'Emerson' };
  const urgency = 100 - p.stamina;
  const { outcome, reasons } = decidePermission(world, claimant, emerson, shelter, urgency);
  const att = attitudeFor(claimant, shelter.id);

  if (outcome === 'refuse') {
    // Remembered on the world so ignoring a refusal has consequences.
    world.flags[`refusedEmerson_${shelter.id}_${claimant.id}`] = true;
  } else {
    if (!att.allowed.includes('emerson')) att.allowed.push('emerson');
    att.sharedDrift = Math.min(NORM.maxDrift, att.sharedDrift + NORM.sharedDriftPerPermission);
  }

  // Emerson learns what he was just told, and so does anyone who saw it.
  witnessNorm(
    world,
    shelter,
    claimant,
    outcome === 'allow' ? 'shared' : 'personal',
    outcome === 'refuse' ? 'turned Emerson away from' : 'gave Emerson leave to use',
    // He was standing in it and asked the question — proximity is not in doubt.
    false,
  );
  const onlookers = observePlayerAsk(world, claimant, shelter, outcome);

  chronicle(
    world,
    'norm',
    outcome === 'refuse'
      ? `${claimant.name} refused Emerson the use of the shelter at ${shelter.place}.`
      : `${claimant.name} allowed Emerson to use the shelter at ${shelter.place}.`,
    {
      actorIds: ['emerson', claimant.id],
      actorNames: ['Emerson', claimant.name],
      pos: { ...shelter.pos },
      place: shelter.place,
      structureId: shelter.id,
      cause: ['Emerson asked rather than walking in', ...reasons],
      effects: [
        ...(outcome === 'refuse'
          ? ['Emerson was turned away', 'The refusal is remembered']
          : ['Emerson may use it freely', "The claimant's grip loosened slightly"]),
        ...(onlookers.length > 0
          ? [`${onlookers.length} settler${onlookers.length === 1 ? '' : 's'} nearby learned something from it`]
          : []),
      ],
    },
  );

  return { name: claimant.name, line: permissionLine(outcome, claimant, emerson), outcome };
}

/**
 * Speak with a nearby settler. Produces a real social interaction: the settler
 * stops and turns, relationship and social need move, a memory is formed, and
 * a first meeting is recorded in the Chronicle.
 */
export function playerTalk(world: World): DialogueExchange | null {
  const s = nearestTalkable(world);
  if (!s || world.timeSec < s.talkingUntil) return null;

  const exchange = buildExchange(world, s);

  // Hold them in conversation and face Emerson.
  s.talkingUntil = world.timeSec + PLAYER.talkDuration;
  s.goal = {
    type: 'talk-emerson',
    label: 'Speaking with Emerson',
    phase: 'act',
    timer: PLAYER.talkDuration,
    startedAt: world.timeSec,
    deadline: s.talkingUntil,
  };
  s.goalReason = {
    summary: ['Emerson approached and spoke', 'Social goals are paused while they talk'],
    scores: [],
  };
  s.socialTimer = PLAYER.talkDuration;

  // Real relationship effects, on the same structured model the settlers use.
  const before = peekRelationship(s, 'emerson')?.affinity ?? 0;
  const gain = 3 + s.personality.sociability * 4 + s.personality.empathy * 2;
  const rel = applyRelationship(
    world,
    s,
    'emerson',
    'Emerson',
    exchange.firstMeeting ? 'meeting' : 'conversation',
    exchange.firstMeeting ? 'First conversation with Emerson' : 'Spoke with Emerson',
    { affinity: gain, trust: 2, familiarity: exchange.firstMeeting ? 14 : 6 },
  );
  s.needs.social = Math.max(0, s.needs.social - RATES.socialReduces * 0.6);

  remember(s, {
    type: 'talked_to_emerson',
    subjectId: 'emerson',
    subjectName: 'Emerson',
    place: placeName(s.pos),
    t: world.timeSec,
    emotionalWeight: 0.45,
  });

  if (exchange.firstMeeting) {
    chronicle(world, 'emerson', `Emerson spoke with ${s.name} for the first time.`, {
      actorIds: [s.id, 'emerson'],
      actorNames: [s.name, 'Emerson'],
      pos: { ...s.pos },
      place: placeName(s.pos),
      cause: [
        'Emerson approached and initiated contact',
        `${s.name} sociability: ${Math.round(s.personality.sociability * 100)}`,
        `${s.name} was: ${s.goalReason.summary[0] ?? 'going about their day'}`,
      ],
      effects: [
        `Affinity toward Emerson ${before >= 0 ? '+' : ''}${Math.round(before)} → +${Math.round(rel.affinity)}`,
        `Now ${relationshipState(rel)}`,
        'Memory created',
      ],
    });
  }
  exchange.affinity = rel.affinity;
  return exchange;
}

/**
 * The E key, in priority order: contribute carried materials to a nearby
 * project, harvest a material seam, or pick glowberries. Returns true when
 * something happened, so E can fall through to Talk.
 */
export function playerGather(world: World): boolean {
  const p = world.player;
  if (p.dead) return false;
  if (p.harvest) return true; // already working a node

  // Fabrication materials first: they are why Emerson is out here.
  const fabNode = materialNodeAtHand(world);
  if (fabNode) return startHarvest(world, fabNode);

  // Contributing to someone's build records Emerson in its provenance exactly
  // like any settler — the player is part of the settlement, not above it.
  const site = siteAtHand(world);
  if (site && (p.wood > 0 || p.stone > 0)) {
    const missing = missingResources(site);
    const wood = Math.min(missing.wood, p.wood);
    const stone = Math.min(missing.stone, p.stone);
    if (wood > 0 || stone > 0) {
      p.wood -= wood;
      p.stone -= stone;
      site.contributed.wood += wood;
      site.contributed.stone += stone;
      let c = site.contributions.find((x) => x.id === 'emerson');
      if (!c) {
        c = { id: 'emerson', name: 'Emerson', wood: 0, stone: 0, work: 0 };
        site.contributions.push(c);
      }
      c.wood += wood;
      c.stone += stone;
      site.lastWorkAt = world.timeSec;
      world.dirty.structures = true;
      if (!world.flags.emersonContributed) {
        world.flags.emersonContributed = true;
        chronicle(world, 'settlement', `Emerson carried materials to ${site.initiatorName}'s ${site.type} at ${site.place}.`, {
          actorIds: ['emerson', site.initiatorId],
          actorNames: ['Emerson', site.initiatorName],
          pos: { ...site.pos },
          place: site.place,
          structureId: site.id,
          cause: ['Emerson chose to help'],
          effects: [`Delivered ${Math.round(wood)} wood and ${Math.round(stone)} stone`],
        });
      }
      return true;
    }
  }

  // Harvesting a seam.
  const material = materialAtHand(world);
  if (material && p.wood + p.stone < PLAYER.maxMaterials) {
    const take = Math.min(2, material.quantity);
    material.quantity -= take;
    if (material.type === 'wood') p.wood += take;
    else p.stone += take;
    if (!world.flags.firstMaterial) {
      world.flags.firstMaterial = true;
      world.ariQueue.push('Construction material. The settlers are already using it — you could help, if you wanted.');
    }
    return true;
  }

  if (p.berries >= PLAYER.maxBerries) return false;
  const bush = world.resources.find(
    (r) => r.type === 'glowberry' && r.quantity >= 1 && dist(r.pos, p.pos) < PLAYER.interactRange,
  );
  if (!bush) return false;
  bush.quantity -= 1;
  p.berries += 1;
  if (!world.flags.firstGather) {
    world.flags.firstGather = true;
    world.ariQueue.push('Glowberries. Edible for most native fauna. Potentially useful for making friends.');
  }
  return true;
}

export function playerOfferFood(world: World): void {
  const p = world.player;
  if (p.dead || p.berries < 1) return;
  if (world.offeredFood.length >= 3) return;
  p.berries -= 1;
  world.offeredFood.push({
    id: `offer_${nextOfferId++}`,
    pos: v2(p.pos.x + Math.sin(p.heading) * 1.6, p.pos.z + Math.cos(p.heading) * 1.6),
    placedAt: world.timeSec,
  });
  world.dirty.resources = true;
}

/** Expire uneaten offered food. */
export function tickOfferedFood(world: World): void {
  const before = world.offeredFood.length;
  world.offeredFood = world.offeredFood.filter((o) => world.timeSec - o.placedAt < WILDLIFE.offeredFoodTimeout);
  if (world.offeredFood.length !== before) world.dirty.resources = true;
}
