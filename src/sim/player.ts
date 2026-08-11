import { PLAYER, WILDLIFE, WORLD } from './config';
import { chronicle } from './chronicle';
import { groundY, isWater } from './terrain';
import { damageCreature } from './wildlife';
import type { World } from './types';
import { clamp100, dist, v2 } from './vec';

/**
 * Emerson's simulation state and actions. Movement integrates in real time
 * (the player is not fast-forwarded at high sim speeds), but all world
 * interactions go through normal simulation rules.
 */

export interface PlayerInput {
  moveX: number; // -1..1 strafe
  moveZ: number; // -1..1 forward
  sprint: boolean;
  jump: boolean;
  camYaw: number;
}

let nextOfferId = 0;

export function updatePlayer(world: World, dt: number, input: PlayerInput): void {
  const p = world.player;

  if (p.dead) {
    p.respawnTimer -= dt;
    p.speed = 0;
    if (p.respawnTimer <= 0) {
      const camp = world.camps.find((c) => c.speciesId === 'human')!;
      p.pos = v2(camp.pos.x + 2, camp.pos.z + 2);
      p.health = 60;
      p.stamina = 60;
      p.dead = false;
      p.vy = 0;
      world.ariQueue.push('Reviving field engaged. Please avoid dying, Emerson — it is expensive.');
    }
    return;
  }

  // Timers.
  p.attackCooldown = Math.max(0, p.attackCooldown - dt);
  p.attackTimer = Math.max(0, p.attackTimer - dt);
  p.dodgeCooldown = Math.max(0, p.dodgeCooldown - dt);
  p.dodgeTimer = Math.max(0, p.dodgeTimer - dt);

  // Movement relative to camera yaw.
  const mag = Math.hypot(input.moveX, input.moveZ);
  let speed = 0;
  if (p.dodgeTimer > 0) {
    speed = PLAYER.dodgeSpeed;
  } else if (mag > 0.05) {
    const sprinting = input.sprint && p.stamina > 5;
    speed = sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    if (sprinting) {
      p.stamina = Math.max(0, p.stamina - 10 * dt);
      p.lastSprintAt = world.timeSec;
    }
  }
  if (mag > 0.05 || p.dodgeTimer > 0) {
    if (mag > 0.05) {
      const inputAngle = Math.atan2(input.moveX, input.moveZ);
      p.heading = input.camYaw + inputAngle;
    }
    const inWater = isWater(p.pos.x, p.pos.z);
    const effSpeed = speed * (inWater ? 0.5 : 1);
    let nx = p.pos.x + Math.sin(p.heading) * effSpeed * dt;
    let nz = p.pos.z + Math.cos(p.heading) * effSpeed * dt;
    // Obstacle push-out against registered obstacles.
    for (const o of world.obstacles) {
      const ox = nx - o.pos.x;
      const oz = nz - o.pos.z;
      const od = Math.hypot(ox, oz);
      const min = o.radius + 0.45;
      if (od < min && od > 0.001) {
        const push = (min - od) / od;
        nx += ox * push;
        nz += oz * push;
      }
    }
    const r = Math.hypot(nx, nz);
    if (r > WORLD.playRadius) {
      const s = WORLD.playRadius / r;
      nx *= s;
      nz *= s;
    }
    p.pos.x = nx;
    p.pos.z = nz;
    p.speed = effSpeed;
  } else {
    p.speed = 0;
  }
  if (!input.sprint) p.stamina = clamp100(p.stamina + 7 * dt);

  // Vertical: simple jump + terrain snap.
  const ground = groundY(p.pos.x, p.pos.z);
  if (input.jump && p.onGround) {
    p.vy = PLAYER.jumpVel;
    p.onGround = false;
  }
  if (!p.onGround) {
    p.vy -= PLAYER.gravity * dt;
    p.y += p.vy * dt;
    if (p.y <= ground) {
      p.y = ground;
      p.vy = 0;
      p.onGround = true;
    }
  } else {
    p.y = ground;
  }

  // Passive recovery.
  p.health = clamp100(p.health + 0.6 * dt);

  if (p.health <= 0 && !p.dead) {
    p.dead = true;
    p.respawnTimer = 4;
    chronicle(world, 'emerson', 'Emerson collapsed. The reviving field carried him back to camp.');
  }
}

export function playerAttack(world: World): void {
  const p = world.player;
  if (p.dead || p.attackCooldown > 0) return;
  p.attackCooldown = PLAYER.attackCooldown;
  p.attackTimer = 0.3;
  const fx = Math.sin(p.heading);
  const fz = Math.cos(p.heading);
  for (const c of [...world.creatures]) {
    const dx = c.pos.x - p.pos.x;
    const dz = c.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > PLAYER.attackRange) continue;
    const dot = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
    if (dot < PLAYER.attackArcCos) continue;
    damageCreature(world, c, PLAYER.attackDamage);
  }
}

export function playerDodge(world: World): void {
  const p = world.player;
  if (p.dead || p.dodgeCooldown > 0) return;
  p.dodgeCooldown = PLAYER.dodgeCooldown;
  p.dodgeTimer = PLAYER.dodgeDuration;
}

export interface InteractionPrompt {
  key: string;
  label: string;
  action: 'gather' | 'offer';
}

/** Compute the contextual prompt(s) shown in the Live HUD. */
export function getInteractions(world: World): InteractionPrompt[] {
  const p = world.player;
  if (p.dead) return [];
  const out: InteractionPrompt[] = [];
  const bush = world.resources.find(
    (r) => r.type === 'glowberry' && r.quantity >= 1 && dist(r.pos, p.pos) < PLAYER.interactRange,
  );
  if (bush && p.berries < PLAYER.maxBerries) {
    out.push({ key: 'E', label: 'Gather glowberries', action: 'gather' });
  }
  if (p.berries > 0) {
    const lumi = world.creatures.find((c) => c.lumi && dist(c.pos, p.pos) < PLAYER.offerRange);
    if (lumi) out.push({ key: 'F', label: 'Offer a glowberry', action: 'offer' });
  }
  return out;
}

export function playerGather(world: World): void {
  const p = world.player;
  if (p.dead || p.berries >= PLAYER.maxBerries) return;
  const bush = world.resources.find(
    (r) => r.type === 'glowberry' && r.quantity >= 1 && dist(r.pos, p.pos) < PLAYER.interactRange,
  );
  if (!bush) return;
  bush.quantity -= 1;
  p.berries += 1;
  if (!world.flags.firstGather) {
    world.flags.firstGather = true;
    world.ariQueue.push('Glowberries. Edible for most native fauna. Potentially useful for making friends.');
  }
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
