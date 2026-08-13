import { afterEach, describe, expect, it } from 'vitest';
import { BLASTER, DEV, JETPACK, PLAYER, SIM_DT } from './config';
import { applyDevLoadout, devMode, qaReset, setDevMode } from './dev';
import { availableWeapons, blasterAim, canFire, firePulse, selectWeapon, shotsTick } from './blaster';
import { canEngageJetpack, jetpackCeilingEstimate, jumpApexEstimate } from './jetpack';
import { canStrike, beginStrike, strikeTick } from './combat';
import { courseStart } from './course';
import { MATERIAL_IDS, MATERIALS, RECIPES, SALVAGE_IDS, canFabricate, startFabrication } from './fabrication';
import { updatePlayer, type PlayerInput } from './player';
import { performScan } from './scanner';
import { simTick } from './simulation';
import { CREATURE_SPECIES, CREATURE_SPECIES_BY_ID } from './species';
import { armThreat } from './threats';
import { groundY, isWalkable, isWater, slopeAt } from './terrain';
import type { Creature, MaterialId, World } from './types';
import { createWorld, makeCreature } from './worldgen';

/**
 * Developer Mode, the jetpack and the Pulse Blaster.
 *
 * The load-bearing test in this file is the one that proves Developer Mode
 * cannot contaminate Player Mode. Everything else here is a mechanic behaving;
 * that one is a promise about what the build is allowed to lie about. Granting
 * equipment is fine. Granting *history* — a completed mission, a researched
 * recipe, a relationship that was never earned — would make every observation
 * about the simulation untrustworthy, which is the one thing EDEN cannot
 * afford.
 */

const DT = 1 / 60;
const NOTHING: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, jump: false, camYaw: 0 };

function step(world: World, seconds: number, input: Partial<PlayerInput> = {}): void {
  const ticks = Math.max(1, Math.round(seconds / DT));
  for (let i = 0; i < ticks; i++) {
    world.timeSec += DT;
    updatePlayer(world, DT, { ...NOTHING, ...input });
  }
}

/** Flat, dry, unobstructed ground. */
function flatGround(world: World): { x: number; z: number } {
  for (let ring = 60; ring < 150; ring += 6) {
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const p = { x: Math.sin(a) * ring, z: Math.cos(a) * ring };
      if (isWater(p.x, p.z) || !isWalkable(p.x, p.z)) continue;
      if (slopeAt(p.x, p.z) > 0.06) continue;
      if (world.obstacles.some((o) => Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < o.radius + 8)) continue;
      if (world.settlers.some((s) => Math.hypot(s.pos.x - p.x, s.pos.z - p.z) < 8)) continue;
      return p;
    }
  }
  throw new Error('no flat ground found');
}

function placeAt(world: World, x: number, z: number): void {
  const p = world.player;
  p.pos = { x, z };
  p.y = 0;
  p.y = Math.max(p.y, 0);
  p.vy = 0;
  p.onGround = true;
  p.speed = 0;
  p.moveSpeed = 0;
  p.jumpHeld = false;
  p.jumpBufferedUntil = 0;
  p.coyoteUntil = 0;
  p.jetpackOn = false;
  p.jetpackIdle = 99;
  // Settle him onto whatever the ground actually is here.
  step(world, DT * 3);
}

/** A dangerous creature, armed and standing where we put it. */
function spawnThreat(world: World, speciesId: string, x: number, z: number): Creature {
  const def = CREATURE_SPECIES.find((s) => s.id === speciesId)!;
  const c = makeCreature(world, world.rng, def, { x, z });
  armThreat(c);
  world.creatures.push(c);
  return c;
}

afterEach(() => setDevMode(null));

// ---------------------------------------------------------------------------
// Developer Mode
// ---------------------------------------------------------------------------

describe('Developer Mode', () => {
  it('grants the QA loadout', () => {
    const world = createWorld(7101);
    applyDevLoadout(world);
    const p = world.player;
    for (const id of MATERIAL_IDS) expect(p.materials[id], id).toBeGreaterThanOrEqual(DEV.stack);
    for (const id of SALVAGE_IDS) expect(p.salvage[id], id).toBeGreaterThanOrEqual(DEV.stack);
    expect(p.unlocks.arcBlade).toBe(true);
    expect(p.unlocks.pulseBlaster).toBe(true);
    expect(p.unlocks.jetpack).toBe(true);
    expect(p.unlocks.scanner).toBe(true);
    expect(p.health).toBeGreaterThanOrEqual(99);
    expect(p.items.medkit).toBeGreaterThan(0);
    expect(p.equipped).not.toBe('none');
  });

  it('enumerates the inventory from the data tables rather than a hand-kept list', () => {
    // The guard against silent rot: if a fourth material is added to MATERIALS
    // and not to MATERIAL_IDS, the QA loadout would quietly stop being complete.
    expect(new Set(MATERIAL_IDS)).toEqual(new Set(Object.keys(MATERIALS) as MaterialId[]));
    const world = createWorld(7102);
    expect(new Set(MATERIAL_IDS)).toEqual(new Set(Object.keys(world.player.materials)));
    expect(new Set(SALVAGE_IDS)).toEqual(new Set(Object.keys(world.player.salvage)));
    applyDevLoadout(world);
    for (const id of Object.keys(world.player.materials) as MaterialId[]) {
      expect(world.player.materials[id], `${id} was missed by the loadout`).toBeGreaterThanOrEqual(DEV.stack);
    }
  });

  it('is idempotent, and never takes anything away', () => {
    const world = createWorld(7103);
    applyDevLoadout(world);
    world.player.materials.alloy = 250;
    applyDevLoadout(world);
    expect(world.player.materials.alloy).toBe(250);
  });

  it('does not grant anything in Player Mode', () => {
    // A fresh world is Player Mode by definition: nothing calls the loadout.
    const world = createWorld(7104);
    const p = world.player;
    for (const id of MATERIAL_IDS) expect(p.materials[id]).toBe(0);
    for (const id of SALVAGE_IDS) expect(p.salvage[id]).toBe(0);
    expect(p.unlocks.arcBlade).toBe(false);
    expect(p.unlocks.pulseBlaster).toBe(false);
    expect(p.unlocks.jetpack).toBe(false);
    expect(p.unlocks.scanner).toBe(false);
    expect(p.equipped).toBe('none');
    expect(p.items.medkit).toBe(0);
  });

  it('leaves equipment acquisition governed by the normal game state in Player Mode', () => {
    const world = createWorld(7105);
    // Unarmed: no strike, no shot, no jetpack, regardless of which keys exist.
    expect(canStrike(world).ok).toBe(false);
    expect(canFire(world).ok).toBe(false);
    expect(selectWeapon(world, 'arcBlade')).toBe(false);
    expect(selectWeapon(world, 'pulseBlaster')).toBe(false);
    world.player.onGround = false;
    world.player.jetpackFuel = JETPACK.maxFuel;
    expect(canEngageJetpack(world)).toBe(false);
    // And the Fabricator still wants materials it has not got.
    expect(canFabricate(world, 'arc-blade-mk1')).toMatchObject({ ok: false, reason: 'missing-materials' });
  });

  it('never writes progression history', () => {
    // The guardrail. Developer Mode may say "Kai can use this". It may never
    // say "Kai did this" — no fabricated flags, no chronicle, no relationships,
    // no settlement or research state moved.
    const world = createWorld(7106);
    const before = {
      flags: JSON.stringify(world.flags),
      chronicle: world.chronicle.length,
      structures: world.structures.map((s) => `${s.id}:${s.state}`).join(','),
      relationships: world.settlers.map((s) => Object.keys(s.relationships).length).join(','),
      witnessed: world.player.witnessed.length,
      extractions: world.player.extractions,
      fabrication: world.fabrication,
      timeSec: world.timeSec,
    };

    applyDevLoadout(world);

    expect(JSON.stringify(world.flags)).toBe(before.flags);
    expect(world.chronicle.length).toBe(before.chronicle);
    expect(world.structures.map((s) => `${s.id}:${s.state}`).join(',')).toBe(before.structures);
    expect(world.settlers.map((s) => Object.keys(s.relationships).length).join(',')).toBe(before.relationships);
    expect(world.player.witnessed.length).toBe(before.witnessed);
    expect(world.player.extractions).toBe(before.extractions);
    expect(world.fabrication).toBe(before.fabrication);
    expect(world.timeSec).toBe(before.timeSec);
    // Specifically: no recipe is marked as ever having been fabricated.
    for (const r of RECIPES) expect(world.flags[`fabricated_${r.id}`]).toBeUndefined();
    expect(world.flags.arcBladeBuiltAt).toBeUndefined();
    expect(world.flags.scannerBuiltAt).toBeUndefined();
    expect(world.flags.capacitorBuiltAt).toBeUndefined();
  });

  it('does not change how the valley runs', () => {
    // Same seed, same simulation, whether or not the tester has a full pack.
    const plain = createWorld(7107);
    const dev = createWorld(7107);
    applyDevLoadout(dev);
    for (let i = 0; i < 400; i++) {
      simTick(plain, SIM_DT);
      simTick(dev, SIM_DT);
    }
    const shape = (w: World) =>
      w.settlers.map((s) => `${s.id}:${s.goal.type}:${s.pos.x.toFixed(2)}:${s.pos.z.toFixed(2)}`).join('|');
    expect(shape(dev)).toBe(shape(plain));
    expect(dev.chronicle.length).toBe(plain.chronicle.length);
  });

  it('can be forced on and off by the one flag', () => {
    setDevMode(true);
    expect(devMode()).toBe(true);
    setDevMode(false);
    expect(devMode()).toBe(false);
    setDevMode(null);
  });
});

describe('the F4 QA reset', () => {
  it('restores the loadout in Developer Mode without restarting the valley', () => {
    setDevMode(true);
    const world = createWorld(7201);
    applyDevLoadout(world);
    const before = { settlers: world.settlers.length, t: world.timeSec, chronicle: world.chronicle.length };

    // Spend everything, wander off, get hurt.
    for (const id of MATERIAL_IDS) world.player.materials[id] = 0;
    world.player.items.medkit = 0;
    world.player.health = 12;
    world.player.jetpackFuel = 0;
    world.player.blasterCharge = 0;
    world.player.pos = { x: 0, z: 0 };

    qaReset(world);

    const start = courseStart(world);
    expect(Math.hypot(world.player.pos.x - start.x, world.player.pos.z - start.z)).toBeLessThan(0.001);
    for (const id of MATERIAL_IDS) expect(world.player.materials[id]).toBeGreaterThanOrEqual(DEV.stack);
    expect(world.player.health).toBeGreaterThanOrEqual(99);
    expect(world.player.jetpackFuel).toBe(JETPACK.maxFuel);
    expect(world.player.blasterCharge).toBe(BLASTER.maxCharge);
    // The world is untouched. A QA reset is not a new game.
    expect(world.settlers.length).toBe(before.settlers);
    expect(world.timeSec).toBe(before.t);
    expect(world.chronicle.length).toBe(before.chronicle);
  });

  it('restores nothing in Player Mode', () => {
    setDevMode(false);
    const world = createWorld(7202);
    world.player.health = 12;
    world.player.pos = { x: 0, z: 0 };
    qaReset(world);
    // Still moved to the start — that is Gate 1 behaviour, not a dev grant.
    const start = courseStart(world);
    expect(Math.hypot(world.player.pos.x - start.x, world.player.pos.z - start.z)).toBeLessThan(0.001);
    // But nothing was handed out.
    expect(world.player.health).toBe(12);
    for (const id of MATERIAL_IDS) expect(world.player.materials[id]).toBe(0);
    expect(world.player.unlocks.jetpack).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Jetpack
// ---------------------------------------------------------------------------

describe('the Pathfinder Jetpack', () => {
  const armed = (seed: number): World => {
    const world = createWorld(seed);
    applyDevLoadout(world);
    const g = flatGround(world);
    placeAt(world, g.x, g.z);
    return world;
  };

  it('leaves Space as an ordinary jump from the ground', () => {
    const world = armed(7301);
    const start = world.player.y;
    step(world, DT, { jump: true });
    expect(world.player.onGround).toBe(false);
    // Launched at full strength, less the one frame of gravity already applied.
    expect(world.player.vy).toBeCloseTo(PLAYER.jumpVel - PLAYER.gravity * DT, 3);
    // The press that jumped must not also have lit the pack.
    expect(world.player.jetpackOn).toBe(false);
    expect(world.player.jetpackFuel).toBe(JETPACK.maxFuel);

    for (let i = 0; i < 200 && !world.player.onGround; i++) step(world, DT, { jump: true });
    expect(world.player.onGround).toBe(true);
    expect(world.player.y).toBeCloseTo(start, 2);
  });

  it('engages on a second press while airborne', () => {
    const world = armed(7302);
    step(world, DT, { jump: true });
    expect(world.player.jetpackOn).toBe(false);
    // Release, then press again in the air.
    step(world, DT * 4, { jump: false });
    step(world, DT, { jump: true });
    expect(world.player.jetpackOn).toBe(true);
  });

  it('drains fuel while thrusting and holds Kai up', () => {
    const world = armed(7303);
    step(world, DT, { jump: true });
    step(world, DT * 4, { jump: false });
    const fallingVy = world.player.vy;
    step(world, DT, { jump: true });
    const startFuel = world.player.jetpackFuel;
    step(world, 0.5, { jump: true });
    expect(world.player.jetpackFuel).toBeLessThan(startFuel);
    // Thrust beats gravity: he is going up faster than he was.
    expect(world.player.vy).toBeGreaterThan(fallingVy);
    expect(world.player.vy).toBeGreaterThan(0);
  });

  it('never lets fuel go negative', () => {
    const world = armed(7304);
    step(world, DT, { jump: true });
    step(world, DT * 4, { jump: false });
    step(world, 12, { jump: true });
    expect(world.player.jetpackFuel).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(world.player.jetpackFuel)).toBe(true);
  });

  it('recharges on the ground, and not in the air', () => {
    const world = armed(7305);
    world.player.jetpackFuel = 10;
    step(world, 2.5);
    expect(world.player.jetpackFuel).toBeGreaterThan(60);

    // Airborne with the pack off: no recovery at all.
    world.player.jetpackFuel = 20;
    world.player.onGround = false;
    world.player.y += 30;
    world.player.vy = 0;
    step(world, 1, { jump: false });
    expect(world.player.jetpackFuel).toBeLessThanOrEqual(20);
  });

  it('cannot hover indefinitely', () => {
    const world = armed(7306);
    const groundY = world.player.y;
    step(world, DT, { jump: true });
    step(world, DT * 4, { jump: false });
    // Hold it down for far longer than a tank lasts.
    let maxY = world.player.y;
    let landed = false;
    for (let i = 0; i < 60 * 30; i++) {
      step(world, DT, { jump: true });
      maxY = Math.max(maxY, world.player.y);
      if (world.player.y <= groundY + 0.01 && world.player.vy <= 0 && i > 120) {
        landed = true;
        break;
      }
    }
    expect(landed, 'holding thrust forever should still come down').toBe(true);
    expect(world.player.jetpackFuel).toBeLessThanOrEqual(JETPACK.maxFuel);
    // And the climb it bought is traversal-sized, not flight-sized.
    expect(maxY - groundY).toBeLessThan(40);
  });

  it('buys a useful amount of height — more than a jump, less than flight', () => {
    const ceiling = jetpackCeilingEstimate();
    expect(ceiling).toBeGreaterThan(jumpApexEstimate() * 3);
    expect(ceiling).toBeLessThan(40);
  });

  it('does not break landing or ground detection', () => {
    const world = armed(7307);
    step(world, DT, { jump: true });
    step(world, DT * 4, { jump: false });
    step(world, 1.5, { jump: true });
    // Let go and fall all the way back.
    for (let i = 0; i < 60 * 20 && !world.player.onGround; i++) step(world, DT, { jump: false });
    const p = world.player;
    expect(p.onGround).toBe(true);
    expect(p.jetpackOn).toBe(false);
    expect(p.vy).toBe(0);
    expect(Number.isFinite(p.y)).toBe(true);
    // And it refills once he is standing again.
    step(world, 3);
    expect(p.jetpackFuel).toBe(JETPACK.maxFuel);
  });

  it('stays unavailable without the unlock', () => {
    const world = createWorld(7308);
    const g = flatGround(world);
    placeAt(world, g.x, g.z);
    step(world, DT, { jump: true });
    step(world, DT * 4, { jump: false });
    step(world, DT, { jump: true });
    expect(world.player.jetpackOn).toBe(false);
    expect(world.player.jetpackFuel).toBe(JETPACK.maxFuel);
  });
});

// ---------------------------------------------------------------------------
// Pulse Blaster
// ---------------------------------------------------------------------------

describe('the Pathfinder Pulse Blaster', () => {
  const armed = (seed: number): World => {
    const world = createWorld(seed);
    applyDevLoadout(world);
    const g = flatGround(world);
    placeAt(world, g.x, g.z);
    selectWeapon(world, 'pulseBlaster');
    return world;
  };

  it('damages a hostile creature at range', () => {
    const world = armed(7401);
    const p = world.player;
    p.heading = 0;
    const target = spawnThreat(world, 'rakhor', p.pos.x, p.pos.z + 14);
    const before = target.health;

    expect(firePulse(world).ok).toBe(true);
    expect(world.shots.length).toBe(1);
    // Give the bolt time to cross fourteen metres.
    for (let i = 0; i < 60 && target.health === before; i++) shotsTick(world, DT);
    expect(target.health).toBeLessThan(before);
    expect(target.health).toBe(before - BLASTER.damage);
  });

  it('stops at the first body — one bolt cannot rake a crowd', () => {
    const world = armed(7402);
    const p = world.player;
    p.heading = 0;
    const near = spawnThreat(world, 'rakhor', p.pos.x, p.pos.z + 8);
    const far = spawnThreat(world, 'rakhor', p.pos.x, p.pos.z + 12);
    const behind = spawnThreat(world, 'rakhor', p.pos.x, p.pos.z + 16);
    const health = [near.health, far.health, behind.health];

    firePulse(world);
    for (let i = 0; i < 90; i++) shotsTick(world, DT);

    const hurt = [near, far, behind].filter((c, i) => c.health < health[i]);
    expect(hurt.length).toBe(1);
    expect(hurt[0]).toBe(near);
  });

  it('spends charge, rate-limits, and recovers on its own', () => {
    const world = armed(7403);
    const p = world.player;
    const full = p.blasterCharge;
    expect(firePulse(world).ok).toBe(true);
    expect(p.blasterCharge).toBe(full - BLASTER.costPerShot);
    // The very next frame is too soon.
    expect(firePulse(world)).toMatchObject({ ok: false, reason: 'cooldown' });

    // Empty it.
    for (let i = 0; i < 40; i++) {
      step(world, BLASTER.cooldown + DT);
      firePulse(world);
    }
    expect(p.blasterCharge).toBeGreaterThanOrEqual(0);
    expect(p.blasterCharge).toBeLessThan(BLASTER.costPerShot);
    expect(firePulse(world)).toMatchObject({ ok: false, reason: 'no-charge' });

    // And it comes back without the player doing anything.
    step(world, 8);
    expect(p.blasterCharge).toBeGreaterThan(BLASTER.costPerShot);
    expect(p.blasterCharge).toBeLessThanOrEqual(BLASTER.maxCharge);
  });

  it('aims at a locked target, so a keyboard player can fight at range', () => {
    const world = armed(7404);
    const p = world.player;
    p.heading = 0;
    // Off to one side, well outside the assist cone.
    const target = spawnThreat(world, 'rakhor', p.pos.x + 12, p.pos.z + 2);
    p.lockedId = target.id;

    const aim = blasterAim(world);
    expect(aim.x).toBeGreaterThan(0.9);

    const before = target.health;
    firePulse(world);
    for (let i = 0; i < 90 && target.health === before; i++) shotsTick(world, DT);
    expect(target.health).toBeLessThan(before);
  });

  it('assists onto a hostile in front without acquiring one behind', () => {
    const world = armed(7405);
    const p = world.player;
    p.heading = 0;
    const behind = spawnThreat(world, 'rakhor', p.pos.x, p.pos.z - 10);
    const aimAlone = blasterAim(world);
    // Nothing in front: the shot goes where he is facing, and misses.
    expect(aimAlone.z).toBeCloseTo(1, 2);
    const health = behind.health;
    firePulse(world);
    for (let i = 0; i < 90; i++) shotsTick(world, DT);
    expect(behind.health).toBe(health);

    // Something slightly off-centre in front is taken as the intent.
    const front = spawnThreat(world, 'rakhor', p.pos.x + 2.5, p.pos.z + 12);
    const aim = blasterAim(world);
    expect(aim.x).toBeGreaterThan(0.1);
    expect(aim.z).toBeGreaterThan(0.9);
    void front;
  });

  it('never points itself at Lumi or at harmless fauna', () => {
    const world = armed(7406);
    const p = world.player;
    p.heading = 0;
    const harmless = CREATURE_SPECIES.find((s) => !s.dangerous && !s.aquatic)!;
    const bystander = makeCreature(world, world.rng, harmless, { x: p.pos.x, z: p.pos.z + 6 });
    world.creatures.push(bystander);
    const aim = blasterAim(world);
    expect(aim.z).toBeCloseTo(1, 3);
    const before = bystander.health;
    firePulse(world);
    for (let i = 0; i < 90; i++) shotsTick(world, DT);
    expect(bystander.health).toBe(before);
  });

  it('still hits when the target is uphill', () => {
    // The bolt used to fly level and be culled where the ground came up, so on
    // any rising slope it died in mid-air and the weapon silently stopped
    // working. Found in the browser, not here — hence this.
    const world = createWorld(7409);
    applyDevLoadout(world);
    // Ground that climbs away from the player.
    let spot: { x: number; z: number } | null = null;
    for (let r = 40; r < 160 && !spot; r += 5) {
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const p = { x: Math.sin(a) * r, z: Math.cos(a) * r };
        if (isWater(p.x, p.z) || !isWalkable(p.x, p.z)) continue;
        if (slopeAt(p.x, p.z) > 0.22) {
          spot = p;
          break;
        }
      }
    }
    if (!spot) return;
    placeAt(world, spot.x, spot.z);
    selectWeapon(world, 'pulseBlaster');
    const p = world.player;
    // Face uphill.
    const e = 1.2;
    const gx = groundY(spot.x + e, spot.z) - groundY(spot.x - e, spot.z);
    const gz = groundY(spot.x, spot.z + e) - groundY(spot.x, spot.z - e);
    const gl = Math.hypot(gx, gz) || 1;
    p.heading = Math.atan2(gx / gl, gz / gl);
    const target = spawnThreat(world, 'rakhor', p.pos.x + (gx / gl) * 14, p.pos.z + (gz / gl) * 14);
    const before = target.health;

    expect(firePulse(world).ok).toBe(true);
    for (let i = 0; i < 90 && target.health === before; i++) shotsTick(world, DT);
    expect(target.health).toBeLessThan(before);
  });

  it('cannot be fired without the unlock', () => {
    const world = createWorld(7407);
    expect(selectWeapon(world, 'pulseBlaster')).toBe(false);
    expect(world.player.equipped).toBe('none');
    expect(firePulse(world)).toMatchObject({ ok: false, reason: 'unarmed' });
    expect(world.shots.length).toBe(0);
  });

  it('bolts expire rather than accumulating forever', () => {
    const world = armed(7408);
    world.player.heading = 0;
    firePulse(world);
    expect(world.shots.length).toBe(1);
    for (let i = 0; i < 60 * 4; i++) shotsTick(world, DT);
    expect(world.shots.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Weapons together
// ---------------------------------------------------------------------------

describe('weapon selection', () => {
  it('switches between the two through one shared entry point', () => {
    const world = createWorld(7501);
    applyDevLoadout(world);
    expect(availableWeapons(world)).toEqual(['arcBlade', 'pulseBlaster']);

    expect(selectWeapon(world, 'pulseBlaster')).toBe(true);
    expect(world.player.equipped).toBe('pulseBlaster');
    expect(canFire(world).ok).toBe(true);
    expect(canStrike(world)).toMatchObject({ ok: false, reason: 'unarmed' });

    expect(selectWeapon(world, 'arcBlade')).toBe(true);
    expect(world.player.equipped).toBe('arcBlade');
    expect(canStrike(world).ok).toBe(true);
    expect(canFire(world)).toMatchObject({ ok: false, reason: 'unarmed' });
  });

  it('cancels a swing in progress rather than carrying it into the other weapon', () => {
    const world = createWorld(7502);
    applyDevLoadout(world);
    selectWeapon(world, 'arcBlade');
    beginStrike(world, 'light');
    expect(world.player.strike).not.toBeNull();
    selectWeapon(world, 'pulseBlaster');
    expect(world.player.strike).toBeNull();
    expect(world.player.buffered).toBeNull();
  });

  it('leaves the Arc Blade working exactly as it did', () => {
    const world = createWorld(7503);
    applyDevLoadout(world);
    const g = flatGround(world);
    placeAt(world, g.x, g.z);
    selectWeapon(world, 'arcBlade');
    const p = world.player;
    p.heading = 0;
    const target = spawnThreat(world, 'rakhor', p.pos.x, p.pos.z + 2.2);
    const before = target.health;

    expect(beginStrike(world, 'light').ok).toBe(true);
    let hits = 0;
    for (let i = 0; i < 60; i++) hits += strikeTick(world, DT).length;
    expect(hits).toBeGreaterThan(0);
    expect(target.health).toBeLessThan(before);
  });
});

// ---------------------------------------------------------------------------
// Nothing else moved
// ---------------------------------------------------------------------------

describe('existing systems still work with the loadout granted', () => {
  it('scanner still scans', () => {
    const world = createWorld(7601);
    applyDevLoadout(world);
    const result = performScan(world);
    expect(result.ok).toBe(true);
    expect(world.player.scan.activeUntil).toBeGreaterThan(world.timeSec);
  });

  it('fabricator still fabricates, and still charges for it', () => {
    const world = createWorld(7602);
    applyDevLoadout(world);
    const before = world.player.materials.alloy;
    expect(canFabricate(world, 'medkit').ok).toBe(true);
    expect(startFabrication(world, 'medkit').ok).toBe(true);
    expect(world.player.materials.alloy).toBeLessThan(before);
    expect(world.fabrication).not.toBeNull();
    for (let i = 0; i < 400 && world.fabrication; i++) simTick(world, SIM_DT);
    expect(world.fabrication).toBeNull();
    expect(world.player.items.medkit).toBeGreaterThan(DEV.items);
    // *Now* the history exists — because something actually happened.
    expect(world.flags.fabricated_medkit).toBe(true);
  });

  it('runs a long way with the loadout, a jetpack and bolts in the air', () => {
    const world = createWorld(7603);
    applyDevLoadout(world);
    const g = flatGround(world);
    placeAt(world, g.x, g.z);
    selectWeapon(world, 'pulseBlaster');
    spawnThreat(world, 'rakhor', g.x + 20, g.z + 20);

    for (let i = 0; i < 1800; i++) {
      simTick(world, SIM_DT);
      world.timeSec += 0;
      updatePlayer(world, DT, {
        moveX: Math.sin(i / 31),
        moveZ: Math.cos(i / 17),
        sprint: i % 5 === 0,
        jump: i % 23 < 6,
        camYaw: i / 50,
      });
      if (i % 19 === 0) firePulse(world);
    }
    const p = world.player;
    for (const v of [p.pos.x, p.pos.z, p.y, p.vy, p.jetpackFuel, p.blasterCharge]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(p.jetpackFuel).toBeGreaterThanOrEqual(0);
    expect(p.blasterCharge).toBeGreaterThanOrEqual(0);
    expect(world.shots.length).toBeLessThanOrEqual(BLASTER.maxShots);
    expect(world.settlers.length).toBeGreaterThan(0);
    for (const c of world.creatures) expect(CREATURE_SPECIES_BY_ID[c.speciesId]).toBeTruthy();
  });
});
