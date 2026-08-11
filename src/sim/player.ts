import { PLAYER, RATES, SETTLER, WILDLIFE, WORLD } from './config';
import { chronicle } from './chronicle';
import { buildExchange, type DialogueExchange } from './dialogue';
import { placeName } from './landmarks';
import { remember } from './memory';
import { applyRelationship, peekRelationship, relationshipState } from './relationships';
import { missingResources } from './structures';
import { groundY, isWater } from './terrain';
import { damageCreature } from './wildlife';
import type { ResourceNode, Settler, Structure, World } from './types';
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
      p.heading = headingFromInput(input.camYaw, input.moveX, input.moveZ);
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
  action: 'gather' | 'offer' | 'talk' | 'harvest' | 'contribute';
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
  if (site && (p.wood > 0 || p.stone > 0)) {
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
  return out;
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
