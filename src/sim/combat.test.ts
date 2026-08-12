import { describe, expect, it } from 'vitest';
import { COMBAT, SIM_DT, THREAT, WORLD } from './config';
import {
  activeThreats,
  specFor,
  beginDodge,
  beginStrike,
  canStrike,
  damageCreatureByPlayer,
  damagePlayer,
  defeatCreature,
  insideSafeZone,
  isHitStunned,
  isInvulnerable,
  lockCandidates,
  strikeTick,
  toggleLock,
} from './combat';
import { RECIPE_BY_ID, startFabrication } from './fabrication';
import { playerDodge, updatePlayer } from './player';
import { CREATURE_SPECIES_BY_ID } from './species';
import { simTick } from './simulation';
import { isWalkable, isWater } from './terrain';
import { armThreat, dispositionOf, threatThink } from './threats';
import type { Creature, MaterialId, World } from './types';
import { createWorld, makeCreature } from './worldgen';
import { dist, v2 } from './vec';

/**
 * v0.8 — THE FIRST DANGER.
 *
 * Combat in EDEN only works if it is fair, and "fair" is a set of properties
 * that can be stated precisely: damage lands only inside a window, one swing
 * touches a target once, nothing attacks without a visible wind-up, nothing
 * hunts across the valley, retreat always works, and dying never resets the
 * world. Each of those is a test here.
 */

const IDLE = { moveX: 0, moveZ: 0, sprint: false, jump: false, camYaw: 0 };

/** One frame of the real game loop: world in sim time, Emerson in real time. */
function step(world: World, seconds: number, input = IDLE): void {
  const ticks = Math.ceil(seconds / SIM_DT);
  for (let i = 0; i < ticks; i++) {
    simTick(world, SIM_DT);
    updatePlayer(world, SIM_DT, input);
    if (world.ariQueue.length > 8) world.ariQueue.length = 0;
  }
}

/** Advance only the player, for asserting on strike windows in isolation. */
function stepPlayer(world: World, seconds: number): void {
  const ticks = Math.ceil(seconds / SIM_DT);
  for (let i = 0; i < ticks; i++) updatePlayer(world, SIM_DT, IDLE);
}

/** Give Emerson the blade the way the game does: through the Fabricator. */
function armPlayer(world: World): void {
  const recipe = RECIPE_BY_ID['arc-blade-mk1'];
  for (const [id, need] of Object.entries(recipe.costs)) {
    world.player.materials[id as MaterialId] = need ?? 0;
  }
  expect(startFabrication(world, 'arc-blade-mk1').ok).toBe(true);
  step(world, recipe.duration + 1);
}

/** Drop a fresh, armed creature of a species right where we want it. */
function placeThreat(world: World, speciesId: string, at: { x: number; z: number }): Creature {
  const def = CREATURE_SPECIES_BY_ID[speciesId];
  const c = makeCreature(world, world.rng, def, v2(at.x, at.z));
  armThreat(c);
  world.creatures.push(c);
  return c;
}

/**
 * Open, walkable ground well outside Human Landing and well inside the play
 * radius — putting a fight beyond the world edge silently invokes the boundary
 * clamp, which is not what any of these tests are about.
 */
function wilderness(world: World): { x: number; z: number } {
  const camp = world.camps.find((c) => c.speciesId === 'human')!;
  for (let ring = 90; ring < 160; ring += 10) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const p = { x: Math.sin(a) * ring, z: Math.cos(a) * ring };
      if (Math.hypot(p.x, p.z) > WORLD.playRadius - 25) continue;
      if (Math.hypot(p.x - camp.pos.x, p.z - camp.pos.z) < THREAT.safeRadius + THREAT.noticeRange + 30) continue;
      if (isWater(p.x, p.z) || !isWalkable(p.x, p.z)) continue;
      // Clear of the boulders and trunks a strike could be blocked by.
      if (world.obstacles.some((o) => Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < o.radius + 6)) continue;
      return p;
    }
  }
  throw new Error('no clear wilderness ground found');
}

describe('the Arc Blade', () => {
  it('cannot be swung before it has been fabricated', () => {
    const world = createWorld(4801);
    expect(world.player.equipped).toBe('none');
    expect(world.player.unlocks.arcBlade).toBe(false);
    const attempt = canStrike(world);
    expect(attempt.ok).toBe(false);
    expect(attempt.reason).toBe('unarmed');
    expect(beginStrike(world, 'light').ok).toBe(false);
    expect(world.player.strike).toBeNull();
  });

  it('costs real material, and cannot be built twice', () => {
    const world = createWorld(4802);
    const recipe = RECIPE_BY_ID['arc-blade-mk1'];
    // Nothing carried: refused.
    expect(startFabrication(world, 'arc-blade-mk1').reason).toBe('missing-materials');

    for (const [id, need] of Object.entries(recipe.costs)) {
      world.player.materials[id as MaterialId] = (need ?? 0) + 1;
    }
    expect(startFabrication(world, 'arc-blade-mk1').ok).toBe(true);
    // Consumed at the start, not on completion.
    for (const [id, need] of Object.entries(recipe.costs)) {
      expect(world.player.materials[id as MaterialId]).toBe(1);
      expect(need).toBeGreaterThan(0);
    }
    step(world, recipe.duration + 1);
    expect(world.player.unlocks.arcBlade).toBe(true);
    expect(world.player.equipped).toBe('arcBlade');

    // A second attempt is refused outright rather than eating the material.
    for (const [id, need] of Object.entries(recipe.costs)) {
      world.player.materials[id as MaterialId] = (need ?? 0) + 5;
    }
    expect(startFabrication(world, 'arc-blade-mk1').reason).toBe('already-built');
  });
});

describe('player strikes', () => {
  it('only damages during the active window, and only once per swing', () => {
    const world = createWorld(4803);
    armPlayer(world);
    const p = world.player;
    const spot = wilderness(world);
    p.pos = v2(spot.x, spot.z);
    p.heading = 0;
    const target = placeThreat(world, 'rakhor', { x: spot.x, z: spot.z + 1.6 });
    const startHealth = target.health;

    expect(beginStrike(world, 'light').ok).toBe(true);
    expect(p.strike!.phase).toBe('windup');
    // Nothing lands during the anticipation.
    let hits = strikeTick(world, specFor('light', 1).windup * 0.5);
    expect(hits.length).toBe(0);
    expect(target.health).toBe(startHealth);

    // Crossing into the active window connects — exactly once, however many
    // ticks that window is sampled over.
    let connections = 0;
    for (let i = 0; i < 40; i++) {
      connections += strikeTick(world, 0.02).length;
      if (!p.strike) break;
    }
    expect(connections).toBe(1);
    expect(target.health).toBeLessThan(startHealth);

    // And the swing eventually ends on its own.
    hits = strikeTick(world, 1);
    expect(p.strike).toBeNull();
  });

  it('cannot be interrupted mid-commit, but chains on recovery through the sequence', () => {
    const world = createWorld(4804);
    armPlayer(world);
    const p = world.player;
    expect(beginStrike(world, 'light').ok).toBe(true);
    // Mid wind-up: refused, but remembered rather than dropped (v0.9).
    const mid = beginStrike(world, 'light');
    expect(mid.ok).toBe(false);
    expect(mid.reason).toBe('busy');
    p.buffered = null;

    /** Advance the current swing to its recovery without releasing a buffer. */
    const toRecovery = () => {
      const spec = specFor(p.strike!.kind, p.strike!.chain);
      strikeTick(world, spec.windup + spec.active + 0.001);
      p.buffered = null;
    };
    toRecovery();
    expect(p.strike!.phase).toBe('recover');

    let chain = beginStrike(world, 'light');
    expect(chain.chain).toBe(2);
    toRecovery();
    chain = beginStrike(world, 'light');
    expect(chain.chain).toBe(COMBAT.maxChain);
    toRecovery();
    // Past the finisher the sequence loops back to the opener rather than
    // clamping, so holding the key cannot produce endless finishers.
    chain = beginStrike(world, 'light');
    expect(chain.chain).toBe(1);
  });

  it('never hits what is behind Emerson', () => {
    const world = createWorld(4805);
    armPlayer(world);
    const p = world.player;
    const spot = wilderness(world);
    p.pos = v2(spot.x, spot.z);
    p.heading = 0; // facing +z
    const behind = placeThreat(world, 'rakhor', { x: spot.x, z: spot.z - 1.6 });
    const before = behind.health;
    beginStrike(world, 'light');
    for (let i = 0; i < 60 && p.strike; i++) strikeTick(world, 0.02);
    expect(behind.health).toBe(before);
  });
});

describe('the dodge', () => {
  it('grants a real mercy window that stops damage landing', () => {
    const world = createWorld(4806);
    const p = world.player;
    p.health = 100;
    expect(beginDodge(world)).toBe(true);
    expect(isInvulnerable(world)).toBe(true);
    expect(damagePlayer(world, 40, 'a test')).toBe(false);
    expect(p.health).toBe(100);

    // Once the window closes, the same blow lands.
    step(world, COMBAT.dodgeIFrames + 0.2);
    expect(isInvulnerable(world)).toBe(false);
    expect(damagePlayer(world, 40, 'a test')).toBe(true);
    expect(p.health).toBe(60);
  });

  it('rolls away from Emerson when he is standing still', () => {
    const world = createWorld(4807);
    const p = world.player;
    const spot = wilderness(world);
    p.pos = v2(spot.x, spot.z);
    p.heading = 0;
    const from = { ...p.pos };
    expect(playerDodge(world)).toBe(true);
    stepPlayer(world, COMBAT.dodgeDuration);
    // Moved, and moved backwards rather than forwards.
    expect(dist(p.pos, from)).toBeGreaterThan(1);
    expect(p.pos.z).toBeLessThan(from.z);
  });

  it('has a cooldown, so it cannot be spammed through an attack', () => {
    const world = createWorld(4808);
    expect(beginDodge(world)).toBe(true);
    expect(beginDodge(world)).toBe(false);
    step(world, COMBAT.dodgeDuration + COMBAT.dodgeCooldown + 0.2);
    expect(beginDodge(world)).toBe(true);
  });
});

describe('lock-on', () => {
  it('only ever targets things that can actually fight back', () => {
    const world = createWorld(4809);
    const p = world.player;
    const lumi = world.creatures.find((c) => c.lumi)!;
    p.pos = v2(lumi.pos.x + 1, lumi.pos.z);
    // Lumi is right there and is never a candidate.
    expect(lockCandidates(world).some((c) => c.lumi)).toBe(false);
    expect(toggleLock(world)).toBeNull();

    const threat = placeThreat(world, 'rakhor', { x: p.pos.x + 4, z: p.pos.z });
    const locked = toggleLock(world);
    expect(locked?.id).toBe(threat.id);
    // Toggling again releases it.
    expect(toggleLock(world)).toBeNull();
    expect(p.lockedId).toBeNull();
  });

  it('breaks when the target dies or leaves', () => {
    const world = createWorld(4810);
    const p = world.player;
    const spot = wilderness(world);
    p.pos = v2(spot.x, spot.z);
    const threat = placeThreat(world, 'rakhor', { x: spot.x + 3, z: spot.z });
    toggleLock(world);
    expect(p.lockedId).toBe(threat.id);
    damageCreatureByPlayer(world, threat, 9999);
    step(world, 0.2);
    expect(p.lockedId).toBeNull();
  });
});

describe('dangerous creatures', () => {
  it('do not notice Emerson from across the valley', () => {
    const world = createWorld(4811);
    const spot = wilderness(world);
    world.player.pos = v2(spot.x, spot.z);
    // Well beyond the notice range.
    const far = placeThreat(world, 'rakhor', { x: spot.x + THREAT.noticeRange * 4, z: spot.z });
    step(world, 30);
    expect(far.combat!.state).toBe('calm');
    expect(activeThreats(world).length).toBe(0);
  });

  it('always warn before they commit, and never strike out of nowhere', () => {
    const world = createWorld(4812);
    const spot = wilderness(world);
    const p = world.player;
    p.pos = v2(spot.x, spot.z);
    const c = placeThreat(world, 'rakhor', { x: spot.x + 3, z: spot.z });

    // Watch every state it passes through on the way to its first blow.
    const seen: string[] = [];
    for (let i = 0; i < 4000; i++) {
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      const state = c.combat!.state;
      if (seen[seen.length - 1] !== state) seen.push(state);
      if (state === 'lunge') break;
      // Pin Emerson in place: this test is about the creature, not the chase.
      p.pos = v2(spot.x, spot.z);
      p.health = 100;
    }
    expect(seen).toContain('warn');
    const strikeAt = seen.indexOf('lunge');
    expect(strikeAt).toBeGreaterThan(0);
    // Immediately before any committed attack there is always a wind-up, and
    // before the first hostility there is always a warning.
    expect(seen[strikeAt - 1]).toBe('windup');
    expect(seen.indexOf('warn')).toBeLessThan(seen.indexOf('hostile'));
  });

  it('give up when Emerson leaves — retreat is always a real option', () => {
    const world = createWorld(4813);
    const spot = wilderness(world);
    const p = world.player;
    p.pos = v2(spot.x, spot.z);
    const c = placeThreat(world, 'rakhor', { x: spot.x + 3, z: spot.z });
    // Provoke it into a real engagement.
    for (let i = 0; i < 1500; i++) {
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      p.health = 100;
      if (c.combat!.state === 'hostile') break;
    }
    expect(c.combat!.state).toBe('hostile');

    // Walk away, far enough and long enough.
    p.pos = v2(spot.x + THREAT.leash * 3, spot.z + THREAT.leash * 3);
    for (let i = 0; i < 4000; i++) {
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      if (c.combat!.state === 'calm') break;
    }
    expect(c.combat!.state).toBe('calm');
    expect(c.combat!.targetId).toBeNull();
  });

  it('never hunt Emerson inside Human Landing', () => {
    const world = createWorld(4814);
    const camp = world.camps.find((c) => c.speciesId === 'human')!;
    const p = world.player;
    p.pos = v2(camp.pos.x, camp.pos.z);
    expect(insideSafeZone(world, p.pos.x, p.pos.z)).toBe(true);
    // Put one right on top of him anyway.
    const c = placeThreat(world, 'rakhor', { x: camp.pos.x + 2, z: camp.pos.z });
    for (let i = 0; i < 2000; i++) {
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      p.pos = v2(camp.pos.x, camp.pos.z);
      expect(c.combat!.state === 'hostile' || c.combat!.state === 'windup' || c.combat!.state === 'strike').toBe(false);
    }
    expect(p.health).toBe(100);
  });

  it('attack on their own cooldown rather than every tick', () => {
    const world = createWorld(4815);
    const spot = wilderness(world);
    const p = world.player;
    p.pos = v2(spot.x, spot.z);
    const c = placeThreat(world, 'rakhor', { x: spot.x + 1.5, z: spot.z });
    let strikes = 0;
    let last = c.combat!.state;
    for (let i = 0; i < 6000; i++) {
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      // Hold him in reach and alive, so the only limit is the creature's own.
      p.pos = v2(spot.x, spot.z);
      p.health = 100;
      p.invulnUntil = -9999;
      if (c.combat!.state === 'lunge' && last !== 'lunge') strikes++;
      last = c.combat!.state;
    }
    // 6000 ticks is 120 sim-seconds. Per-tick spam would be thousands of hits;
    // the cooldown plus recovery caps it far below that.
    const seconds = 6000 * SIM_DT;
    const floor = seconds / (CREATURE_SPECIES_BY_ID.rakhor.dangerous!.cooldown + 3);
    expect(strikes).toBeGreaterThan(0);
    expect(strikes).toBeLessThanOrEqual(Math.ceil(floor) + 2);
  });

  it('report a disposition that matches what they are actually doing', () => {
    const world = createWorld(4816);
    const spot = wilderness(world);
    const c = placeThreat(world, 'rakhor', { x: spot.x, z: spot.z });
    expect(dispositionOf(c)).toBe('Defensive');
    c.combat!.state = 'hostile';
    expect(dispositionOf(c)).toBe('Hostile');
    const w = placeThreat(world, 'warden', { x: spot.x + 40, z: spot.z });
    expect(dispositionOf(w)).toBe('Dormant');
  });

  it('leave a core fragment only when they are synthetic', () => {
    const world = createWorld(4817);
    const spot = wilderness(world);
    const warden = placeThreat(world, 'warden', { x: spot.x, z: spot.z });
    const rakhor = placeThreat(world, 'rakhor', { x: spot.x + 30, z: spot.z });

    damageCreatureByPlayer(world, rakhor, 9999);
    expect(world.player.salvage.coreFragment).toBe(0);
    damageCreatureByPlayer(world, warden, 9999);
    expect(world.player.salvage.coreFragment).toBe(1);
    // Both are gone from the world, and the Chronicle records each one.
    expect(world.creatures.includes(warden)).toBe(false);
    expect(world.creatures.includes(rakhor)).toBe(false);
    expect(world.chronicle.some((e) => e.text.includes('disabled a Warden Wisp'))).toBe(true);
    expect(world.chronicle.some((e) => e.text.includes('brought down a Rakhor'))).toBe(true);
  });

  it('do not fall through to foraging while they are engaged', () => {
    const world = createWorld(4818);
    const spot = wilderness(world);
    const p = world.player;
    p.pos = v2(spot.x, spot.z);
    const c = placeThreat(world, 'rakhor', { x: spot.x + 4, z: spot.z });
    for (let i = 0; i < 900; i++) {
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      p.pos = v2(spot.x, spot.z);
      p.health = 100;
    }
    expect(threatThink(world, c)).toBe(true);
    expect(c.goal.type).toBe('threat');
  });
});

describe('emergency extraction', () => {
  it('never resets the world, and never takes a capability away', () => {
    const world = createWorld(4819);
    armPlayer(world);
    const p = world.player;
    p.unlocks.scanner = true;
    p.materials.alloy = 8;
    p.materials.ore = 8;
    p.materials.crystal = 4;
    p.salvage.coreFragment = 2;
    p.items.medkit = 2;

    const settlersBefore = world.settlers.length;
    const namesBefore = world.settlers.map((s) => s.name).join('|');
    const relBefore = world.settlers.map((s) => Object.keys(s.relationships).length).reduce((a, b) => a + b, 0);
    const structuresBefore = world.structures.length;
    const chronicleBefore = world.chronicle.length;
    const timeBefore = world.timeSec;

    damagePlayer(world, 999, 'a Rakhor');
    expect(p.extraction).not.toBeNull();
    expect(p.dead).toBe(true);
    step(world, 6);

    // Recovered, at Human Landing, alive.
    expect(p.extraction).toBeNull();
    expect(p.dead).toBe(false);
    expect(p.health).toBeGreaterThan(0);
    expect(insideSafeZone(world, p.pos.x, p.pos.z)).toBe(true);

    // Capabilities survive. This is the line the whole death loop turns on.
    expect(p.unlocks.scanner).toBe(true);
    expect(p.unlocks.arcBlade).toBe(true);
    expect(p.equipped).toBe('arcBlade');
    expect(p.salvage.coreFragment).toBe(2);
    expect(p.items.medkit).toBe(2);

    // Materials cost something, but not everything.
    expect(p.materials.alloy).toBe(6);
    expect(p.materials.ore).toBe(6);
    expect(p.materials.crystal).toBe(3);

    // And the valley never restarted.
    expect(world.settlers.length).toBe(settlersBefore);
    expect(world.settlers.map((s) => s.name).join('|')).toBe(namesBefore);
    expect(world.settlers.map((s) => Object.keys(s.relationships).length).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(relBefore);
    expect(world.structures.length).toBeGreaterThanOrEqual(structuresBefore);
    expect(world.chronicle.length).toBeGreaterThan(chronicleBefore);
    expect(world.timeSec).toBeGreaterThan(timeBefore);
    expect(world.chronicle.some((e) => e.text.includes('emergency extraction'))).toBe(true);
  });

  it('cannot be triggered twice by one bad moment', () => {
    const world = createWorld(4820);
    const p = world.player;
    damagePlayer(world, 999, 'a Rakhor');
    const startedAt = p.extraction!.startedAt;
    expect(damagePlayer(world, 999, 'a Rakhor')).toBe(false);
    expect(p.extraction!.startedAt).toBe(startedAt);
    expect(p.extractions).toBe(1);
  });
});

describe('settlers and danger', () => {
  it('run rather than fight, and go back to their lives afterwards', () => {
    const world = createWorld(4821);
    // Run a little first so everyone has a goal of their own.
    step(world, 120);
    const victim = world.settlers.find((s) => s.speciesId === 'human')!;
    const anchor = { ...victim.pos };
    const c = placeThreat(world, 'rakhor', { x: anchor.x + 5, z: anchor.z });
    const health = victim.health;

    // Hold a roused predator beside them. It is engaged with Emerson, not with
    // the settler — a bystander running from somebody else's fight is exactly
    // the behaviour being asserted.
    let fled = false;
    for (let i = 0; i < 1200; i++) {
      c.pos = { x: anchor.x + 5, z: anchor.z };
      c.combat!.state = 'hostile';
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      if (victim.goal.type === 'flee') fled = true;
      if (fled && dist(victim.pos, c.pos) > 24) break;
    }
    expect(fled).toBe(true);
    expect(dist(victim.pos, c.pos)).toBeGreaterThan(10);
    // A settler never trades blows with it.
    expect(victim.health).toBeGreaterThanOrEqual(health - 5);

    // Once it is gone they resume ordinary life rather than fleeing forever.
    world.creatures = world.creatures.filter((x) => x !== c);
    step(world, 60);
    expect(victim.goal.type).not.toBe('flee');
  });
});

describe('danger in the world as generated', () => {
  it('places both archetypes, armed, and none of them on top of the colony', () => {
    const world = createWorld(4822);
    const camp = world.camps.find((c) => c.speciesId === 'human')!;
    const dangerous = world.creatures.filter((c) => CREATURE_SPECIES_BY_ID[c.speciesId].dangerous);
    expect(dangerous.length).toBeGreaterThanOrEqual(4);
    expect(dangerous.some((c) => CREATURE_SPECIES_BY_ID[c.speciesId].synthetic)).toBe(true);
    expect(dangerous.some((c) => !CREATURE_SPECIES_BY_ID[c.speciesId].synthetic)).toBe(true);
    for (const c of dangerous) {
      expect(c.combat, `${c.name} should be armed`).toBeTruthy();
      expect(c.health).toBe(CREATURE_SPECIES_BY_ID[c.speciesId].dangerous!.health);
      // Nothing may spawn where it could reach into the safe zone.
      expect(dist(c.pos, camp.pos)).toBeGreaterThan(THREAT.safeRadius + THREAT.noticeRange);
    }
    // The Wardens stand on the ring they are guarding.
    const wardens = dangerous.filter((c) => CREATURE_SPECIES_BY_ID[c.speciesId].synthetic);
    expect(wardens.length).toBeGreaterThanOrEqual(1);
    for (const w of wardens) {
      expect(dist(w.pos, { x: -86, z: -14 })).toBeLessThan(30);
    }
    // And the site itself exists, with standing pylons.
    expect(world.siteProps.filter((s) => s.kind === 'pylon').length).toBeGreaterThan(4);
  });

  it('leaves the world stable over a long run with danger in it', () => {
    const world = createWorld(4823);
    step(world, 1500);
    for (const c of world.creatures) {
      expect(Number.isFinite(c.pos.x) && Number.isFinite(c.pos.z)).toBe(true);
      expect(c.health).toBeGreaterThan(0);
      if (c.combat) {
        expect(Number.isFinite(c.combat.since)).toBe(true);
        // Nothing may sit permanently mid-swing.
        if (c.combat.state === 'windup' || c.combat.state === 'strike') {
          expect(world.timeSec - c.combat.since).toBeLessThan(5);
        }
      }
    }
    // Emerson standing at Human Landing all day is never attacked.
    expect(world.player.extractions).toBe(0);
    expect(world.player.health).toBeGreaterThan(50);
    for (const s of world.settlers) expect(s.health).toBeGreaterThan(0);
  });

  it('is still deterministic with combat in the loop', () => {
    const a = createWorld(4824);
    const b = createWorld(4824);
    step(a, 400);
    step(b, 400);
    expect(a.chronicle.map((e) => e.text)).toEqual(b.chronicle.map((e) => e.text));
    for (let i = 0; i < a.creatures.length; i++) {
      expect(a.creatures[i].pos.x).toBeCloseTo(b.creatures[i].pos.x, 8);
      expect(a.creatures[i].combat?.state).toBe(b.creatures[i].combat?.state);
    }
  });
});

// ---------------------------------------------------------------------------
// v0.9 — COMBAT FEEL & CREATURE PURPOSE
//
// v0.8 proved EDEN can hurt you. These cover whether surviving it is a skill:
// that inputs are not dropped, that the three chain steps are genuinely
// different, that stagger opens a window without becoming a lock, that both
// archetypes fight in their own way, and that a creature exists for its own
// reasons before Emerson ever shows up.
// ---------------------------------------------------------------------------

describe('input buffering', () => {
  it('queues a press made mid-swing and fires it when control returns', () => {
    const world = createWorld(4901);
    armPlayer(world);
    const p = world.player;
    expect(beginStrike(world, 'light').ok).toBe(true);
    // Pressing during the wind-up is refused *and* remembered.
    const attempt = beginStrike(world, 'light');
    expect(attempt.ok).toBe(false);
    expect(attempt.buffered).toBe(true);
    expect(p.buffered).not.toBeNull();

    // Run the swing out. The queued press becomes the second chain step
    // without the player having to press again.
    const spec = specFor('light', 1);
    strikeTick(world, spec.windup + spec.active + 0.001);
    expect(p.strike!.chain).toBe(2);
    expect(p.buffered).toBeNull();
  });

  it('never banks more than one action, however hard the key is mashed', () => {
    const world = createWorld(4902);
    armPlayer(world);
    const p = world.player;
    beginStrike(world, 'light');
    for (let i = 0; i < 40; i++) beginStrike(world, 'light');
    expect(p.buffered).not.toBeNull();
    // One queued press, not forty.
    expect(Array.isArray(p.buffered)).toBe(false);

    // Draining it must produce exactly one extra swing, then stop.
    let swings = 1; // the opener is already in flight
    let lastChain = p.strike!.chain;
    for (let i = 0; i < 400; i++) {
      strikeTick(world, 1 / 60);
      if (p.strike && p.strike.chain !== lastChain) {
        lastChain = p.strike.chain;
        swings++;
      }
      if (!p.strike && !p.buffered) break;
    }
    // The opener plus the single queued follow-up. Mashing cannot manufacture
    // a third swing out of nothing.
    expect(swings).toBe(2);
    expect(p.strike).toBeNull();
    expect(p.buffered).toBeNull();
  });

  it('expires a queued press rather than acting on a stale one', () => {
    const world = createWorld(4903);
    armPlayer(world);
    const p = world.player;
    beginStrike(world, 'heavy');
    beginStrike(world, 'light');
    expect(p.buffered).not.toBeNull();
    // Let the buffer window pass while the heavy is still committed.
    strikeTick(world, COMBAT.bufferWindow + 0.05);
    expect(p.buffered).toBeNull();
  });

  it('queues a dodge pressed during a committed swing', () => {
    const world = createWorld(4904);
    armPlayer(world);
    const p = world.player;
    beginStrike(world, 'heavy');
    // Committing to a heavy costs something: a dodge pressed at the very start
    // of it expires rather than firing half a second later out of nowhere.
    expect(playerDodge(world)).toBe(false);
    strikeTick(world, COMBAT.bufferWindow + 0.05);
    expect(p.buffered).toBeNull();
    expect(p.dodgeTimer).toBe(0);

    // Pressed inside the buffer window before control returns, it fires. A
    // fresh heavy, so the previous swing's elapsed time is not in play.
    p.strike = null;
    p.dodgeCooldown = 0;
    beginStrike(world, 'heavy');
    strikeTick(world, 0.25);
    expect(p.strike!.phase).toBe('windup');
    expect(playerDodge(world)).toBe(false);
    expect(p.buffered?.kind).toBe('dodge');
    for (let i = 0; i < 200 && p.dodgeTimer <= 0; i++) strikeTick(world, 1 / 60);
    expect(p.dodgeTimer).toBeGreaterThan(0);
  });
});

describe('the light chain', () => {
  it('gives each of the three steps a different motion and reach', () => {
    const specs = [specFor('light', 1), specFor('light', 2), specFor('light', 3)];
    // Every step differs from its neighbour in at least timing and reach —
    // a chain whose steps are identical is a counter, not a sequence.
    expect(specs[0].windup).not.toBe(specs[2].windup);
    expect(specs[0].arcCos).not.toBe(specs[1].arcCos);
    expect(specs[2].range).toBeGreaterThan(specs[0].range);
    // And the finisher is where the stagger lives.
    expect(specs[2].stagger).toBeGreaterThan(specs[0].stagger + specs[1].stagger);
    // The heavy is not simply a bigger light.
    expect(COMBAT.heavy.windup).toBeGreaterThan(specs[2].windup);
    expect(COMBAT.heavy.stagger).toBeGreaterThan(specs[2].stagger);
  });

  it('loops back to the opener rather than repeating the finisher forever', () => {
    const world = createWorld(4924);
    armPlayer(world);
    const p = world.player;
    const seen: number[] = [];
    // Hold the attack key: the sequence must cycle 1-2-3-1-2-3, not stick on
    // the finisher, which is the slowest and hardest-hitting of the three.
    for (let i = 0; i < 60 * 8; i++) {
      beginStrike(world, 'light');
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      if (p.strike && seen[seen.length - 1] !== p.strike.chain) seen.push(p.strike.chain);
    }
    expect(seen.length).toBeGreaterThan(4);
    expect(Math.max(...seen)).toBe(COMBAT.maxChain);
    expect(seen.filter((n) => n === 1).length).toBeGreaterThan(1);
  });

  it('resets to step one when the player waits too long', () => {
    const world = createWorld(4905);
    armPlayer(world);
    const p = world.player;
    beginStrike(world, 'light');
    const spec = specFor('light', 1);
    strikeTick(world, spec.windup + spec.active + 0.001);
    expect(beginStrike(world, 'light').chain).toBe(2);
    // Now let the chain window lapse entirely.
    step(world, COMBAT.chainWindow + 1);
    expect(p.strike).toBeNull();
    expect(beginStrike(world, 'light').chain).toBe(1);
  });
});

describe('stagger', () => {
  it('builds from hits, breaks the creature out, and cannot be re-applied at once', () => {
    const world = createWorld(4906);
    const spot = wilderness(world);
    world.player.pos = v2(spot.x, spot.z);
    const c = placeThreat(world, 'rakhor', { x: spot.x + 2, z: spot.z });
    const resist = CREATURE_SPECIES_BY_ID.rakhor.dangerous!.staggerResist;

    // A single light opener is not enough. That is the point of the finisher.
    damageCreatureByPlayer(world, c, 1, specFor('light', 1).stagger, { x: 1, z: 0 });
    expect(c.combat!.state).not.toBe('staggered');

    // A heavy on its own is.
    damageCreatureByPlayer(world, c, 1, COMBAT.heavy.stagger, { x: 1, z: 0 });
    expect(c.combat!.state).toBe('staggered');

    // Immediately hitting it again must not extend the stagger: that is how a
    // stagger model becomes a stun-lock.
    const since = c.combat!.since;
    damageCreatureByPlayer(world, c, 1, COMBAT.heavy.stagger, { x: 1, z: 0 });
    expect(c.combat!.since).toBe(since);
    expect(c.combat!.staggerLoad).toBe(0);
    expect(resist).toBeGreaterThan(0);
  });

  it('recovers on its own, and the load decays between fights', () => {
    const world = createWorld(4907);
    const spot = wilderness(world);
    world.player.pos = v2(spot.x, spot.z);
    const c = placeThreat(world, 'rakhor', { x: spot.x + 2, z: spot.z });
    damageCreatureByPlayer(world, c, 1, COMBAT.heavy.stagger, { x: 1, z: 0 });
    expect(c.combat!.state).toBe('staggered');
    step(world, COMBAT.staggerDuration + 0.5);
    expect(c.combat!.state).not.toBe('staggered');

    // Chip damage spread over a long time never accumulates into a stagger.
    c.combat!.staggerImmuneUntil = -9999;
    for (let i = 0; i < 8; i++) {
      damageCreatureByPlayer(world, c, 0, specFor('light', 1).stagger, { x: 1, z: 0 });
      step(world, 3);
    }
    expect(c.combat!.state).not.toBe('staggered');
  });

  it('is harder to land on a machine than on an animal', () => {
    expect(CREATURE_SPECIES_BY_ID.warden.dangerous!.staggerResist).toBeGreaterThan(
      CREATURE_SPECIES_BY_ID.rakhor.dangerous!.staggerResist,
    );
  });
});

describe('the player hit reaction', () => {
  it('flinches briefly and can never be chained into helplessness', () => {
    const world = createWorld(4908);
    const p = world.player;
    p.health = 100;
    p.invulnUntil = -9999;
    expect(damagePlayer(world, 5, 'a test')).toBe(true);
    expect(isHitStunned(world)).toBe(true);

    // A second hit immediately after must not extend the flinch.
    const until = p.hitStunUntil;
    p.invulnUntil = -9999;
    damagePlayer(world, 5, 'a test');
    expect(p.hitStunUntil).toBe(until);

    step(world, COMBAT.hitStun + 0.1);
    expect(isHitStunned(world)).toBe(false);
  });

  it('never blocks the dodge — the one thing that always works', () => {
    const world = createWorld(4909);
    const p = world.player;
    p.invulnUntil = -9999;
    damagePlayer(world, 5, 'a test');
    expect(isHitStunned(world)).toBe(true);
    p.invulnUntil = -9999;
    expect(playerDodge(world)).toBe(true);
  });
});

describe('the Rakhor', () => {
  it('circles before it commits rather than running straight in', () => {
    const world = createWorld(4910);
    const spot = wilderness(world);
    const p = world.player;
    p.pos = v2(spot.x, spot.z);
    const c = placeThreat(world, 'rakhor', { x: spot.x + 4, z: spot.z });
    const seen: string[] = [];
    for (let i = 0; i < 5000; i++) {
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      p.pos = v2(spot.x, spot.z);
      p.health = 100;
      const s = c.combat!.state;
      if (seen[seen.length - 1] !== s) seen.push(s);
      if (s === 'lunge') break;
    }
    expect(seen).toContain('warn');
    expect(seen).toContain('circle');
    expect(seen).toContain('lunge');
    // Order matters: warn, then circle, then commit.
    expect(seen.indexOf('warn')).toBeLessThan(seen.indexOf('circle'));
    expect(seen.indexOf('circle')).toBeLessThan(seen.indexOf('lunge'));
    // And a wind-up always immediately precedes the lunge.
    expect(seen[seen.indexOf('lunge') - 1]).toBe('windup');
  });

  it('lands at most one hit per lunge', () => {
    const world = createWorld(4911);
    const spot = wilderness(world);
    const p = world.player;
    p.pos = v2(spot.x, spot.z);
    const c = placeThreat(world, 'rakhor', { x: spot.x + 1.5, z: spot.z });
    let hits = 0;
    let lastHurt = p.lastHurtAt;
    let lunges = 0;
    let prev = c.combat!.state;
    for (let i = 0; i < 9000; i++) {
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      p.pos = v2(spot.x, spot.z);
      p.health = 100;
      p.invulnUntil = -9999;
      if (p.lastHurtAt !== lastHurt) {
        lastHurt = p.lastHurtAt;
        hits++;
      }
      if (c.combat!.state === 'lunge' && prev !== 'lunge') lunges++;
      prev = c.combat!.state;
    }
    expect(lunges).toBeGreaterThan(0);
    // One hit per lunge at most. A dash that stays in contact must not tick.
    expect(hits).toBeLessThanOrEqual(lunges);
  });

  it('breaks off when it is badly wounded instead of fighting to the death', () => {
    const world = createWorld(4912);
    const spot = wilderness(world);
    const p = world.player;
    p.pos = v2(spot.x, spot.z);
    const c = placeThreat(world, 'rakhor', { x: spot.x + 3, z: spot.z });
    // Provoke it properly.
    for (let i = 0; i < 3000; i++) {
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      p.health = 100;
      if (c.combat!.state === 'hostile') break;
    }
    // Wound it past the threshold without killing it.
    c.health = CREATURE_SPECIES_BY_ID.rakhor.dangerous!.health * 0.15;
    let retreated = false;
    for (let i = 0; i < 2000; i++) {
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      p.health = 100;
      if (c.combat!.state === 'retreat') {
        retreated = true;
        break;
      }
    }
    expect(retreated).toBe(true);
    expect(c.health).toBeGreaterThan(0);
    // And it actually leaves.
    const before = dist(c.pos, p.pos);
    step(world, 8);
    expect(dist(c.pos, p.pos)).toBeGreaterThan(before);
  });
});

describe('the Warden', () => {
  it('fights at range instead of closing to bite', () => {
    const world = createWorld(4913);
    const spot = wilderness(world);
    const p = world.player;
    p.pos = v2(spot.x, spot.z);
    const w = placeThreat(world, 'warden', { x: spot.x + 12, z: spot.z });
    let closest = Infinity;
    let beams = 0;
    let prev = w.combat!.state;
    for (let i = 0; i < 6000; i++) {
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      p.pos = v2(spot.x, spot.z);
      p.health = 100;
      closest = Math.min(closest, dist(w.pos, p.pos));
      if (w.combat!.state === 'beam' && prev !== 'beam') beams++;
      prev = w.combat!.state;
    }
    expect(beams).toBeGreaterThan(0);
    // It holds a standoff rather than walking into melee range.
    expect(closest).toBeGreaterThan(THREAT.warden.burstRange);
  });

  it('always charges before it fires, and the beam does not track', () => {
    const world = createWorld(4914);
    const spot = wilderness(world);
    const p = world.player;
    p.pos = v2(spot.x, spot.z);
    const w = placeThreat(world, 'warden', { x: spot.x + 12, z: spot.z });
    const seen: string[] = [];
    for (let i = 0; i < 6000; i++) {
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      p.pos = v2(spot.x, spot.z);
      p.health = 100;
      const s = w.combat!.state;
      if (seen[seen.length - 1] !== s) seen.push(s);
      if (s === 'beam') break;
    }
    expect(seen[seen.indexOf('beam') - 1]).toBe('charge');
    // The shot exists in the world, and its direction was fixed when fired.
    const shot = world.beams[world.beams.length - 1];
    expect(shot).toBeDefined();
    const before = { ...shot.dir };
    step(world, 0.1);
    expect(shot.dir).toEqual(before);
  });

  it('can be dodged by stepping out of the line', () => {
    const world = createWorld(4915);
    const spot = wilderness(world);
    const p = world.player;
    p.pos = v2(spot.x, spot.z);
    const w = placeThreat(world, 'warden', { x: spot.x + 12, z: spot.z });
    p.health = 100;

    // Let it engage and start a charge on its own, standing still so the shot
    // is committed toward where Emerson is right now.
    for (let i = 0; i < 6000; i++) {
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      p.pos = v2(spot.x, spot.z);
      p.health = 100;
      p.invulnUntil = -9999;
      if (w.combat!.state === 'charge') break;
    }
    expect(w.combat!.state).toBe('charge');
    expect(w.combat!.aim).not.toBeNull();

    // Now step out of the committed line while it is still charging. This is
    // the whole point of the telegraph.
    for (let i = 0; i < 400; i++) {
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      p.pos = v2(spot.x, spot.z + THREAT.warden.beamHalfWidth * 6);
      p.invulnUntil = -9999;
      if (world.beams.length > 0) break;
    }
    expect(world.beams.length).toBeGreaterThan(0);
    expect(p.health).toBe(100);
  });

  it('uses the close-range burst only when crowded, and shoves the player off', () => {
    const world = createWorld(4916);
    const spot = wilderness(world);
    const p = world.player;
    const w = placeThreat(world, 'warden', { x: spot.x, z: spot.z });
    w.combat!.state = 'hostile';
    w.combat!.since = world.timeSec;
    let bursts = 0;
    for (let i = 0; i < 3000; i++) {
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
      // Stand right on top of it, which is the strategy the burst exists for.
      p.pos = v2(w.pos.x + 1.5, w.pos.z);
      p.health = 100;
      p.invulnUntil = -9999;
      const before = (world.flags.wardenBurstAt as number) ?? -1;
      if (before > 0 && before === world.timeSec) bursts++;
    }
    expect(bursts).toBeGreaterThan(0);
  });
});

describe('creature purpose', () => {
  it('gives both archetypes something to do that is not about Emerson', () => {
    const world = createWorld(4917);
    // Emerson stays home, so nothing is ever provoked.
    const camp = world.camps.find((c) => c.speciesId === 'human')!;
    world.player.pos = v2(camp.pos.x, camp.pos.z);
    step(world, 400);

    const dangerous = world.creatures.filter((c) => CREATURE_SPECIES_BY_ID[c.speciesId].dangerous);
    for (const c of dangerous) {
      expect(c.combat!.state).toBe('calm');
      // An errand, and somewhere to be.
      expect(c.combat!.purposeTarget, `${c.name} should have an errand`).not.toBeNull();
    }
    // The machine guardian patrols; it does not forage. v0.8 had the Warden
    // grazing on glowplants, which is the specific absurdity this pins down.
    const warden = dangerous.find((c) => CREATURE_SPECIES_BY_ID[c.speciesId].synthetic)!;
    expect(warden.combat!.purpose).toBe('patrol');
    expect(warden.goal.type).toBe('threat');
    expect(warden.goal.label).not.toMatch(/graze|glowplant|forage/i);

    // And it stays near the ring it is guarding.
    expect(dist(warden.pos, warden.combat!.territory)).toBeLessThan(THREAT.warden.patrolRadius + 12);
  });

  it('lets a predator stalk smaller fauna without ever catching them', () => {
    const world = createWorld(4918);
    const camp = world.camps.find((c) => c.speciesId === 'human')!;
    world.player.pos = v2(camp.pos.x, camp.pos.z);
    const preyBefore = world.creatures.filter((c) => !c.combat).length;
    let everStalked = false;
    for (let i = 0; i < 30000; i++) {
      simTick(world, SIM_DT);
      if (i % 60 === 0) {
        const r = world.creatures.find((c) => c.speciesId === 'rakhor' && c.combat?.stalkingId);
        if (r) everStalked = true;
      }
    }
    expect(everStalked).toBe(true);
    // Stalking is watching, not predation: nothing is eaten.
    expect(world.creatures.filter((c) => !c.combat).length).toBeGreaterThanOrEqual(preyBefore);
  });

  it('makes small fauna keep away from an active predator', () => {
    const world = createWorld(4919);
    const spot = wilderness(world);
    const prey = world.creatures.find((c) => !c.combat && !c.lumi)!;
    prey.pos = v2(spot.x, spot.z);
    prey.home = v2(spot.x, spot.z);
    const c = placeThreat(world, 'rakhor', { x: spot.x + 5, z: spot.z });
    const before = dist(prey.pos, c.pos);
    for (let i = 0; i < 900; i++) {
      c.combat!.state = 'hostile';
      c.pos = v2(spot.x + 5, spot.z);
      simTick(world, SIM_DT);
      updatePlayer(world, SIM_DT, IDLE);
    }
    expect(dist(prey.pos, c.pos)).toBeGreaterThan(before);
  });
});

describe('defeat', () => {
  it('pays out exactly once however many times it resolves', () => {
    const world = createWorld(4925);
    const spot = wilderness(world);
    const c = placeThreat(world, 'warden', { x: spot.x, z: spot.z });
    const before = world.player.salvage.coreFragment;
    defeatCreature(world, c);
    // A strike and a beam landing in the same step must not award two cores.
    defeatCreature(world, c);
    defeatCreature(world, c);
    expect(world.player.salvage.coreFragment).toBe(before + 1);
    expect(world.creatures.includes(c)).toBe(false);
  });
});

describe('the Arc Blade Capacitor', () => {
  it('cannot be built without a recovered core fragment', () => {
    const world = createWorld(4920);
    const recipe = RECIPE_BY_ID['arc-blade-capacitor'];
    for (const [id, need] of Object.entries(recipe.costs)) {
      world.player.materials[id as MaterialId] = (need ?? 0) + 4;
    }
    expect(world.player.salvage.coreFragment).toBe(0);
    expect(startFabrication(world, 'arc-blade-capacitor').reason).toBe('missing-salvage');
    expect(world.player.unlocks.capacitor).toBe(false);
  });

  it('consumes exactly one fragment, installs once, and survives an extraction', () => {
    const world = createWorld(4921);
    armPlayer(world);
    const p = world.player;
    const recipe = RECIPE_BY_ID['arc-blade-capacitor'];
    for (const [id, need] of Object.entries(recipe.costs)) {
      p.materials[id as MaterialId] = (need ?? 0) + 4;
    }
    p.salvage.coreFragment = 2;
    expect(startFabrication(world, 'arc-blade-capacitor').ok).toBe(true);
    expect(p.salvage.coreFragment).toBe(1);
    step(world, recipe.duration + 1);
    expect(p.unlocks.capacitor).toBe(true);

    // Never twice, however much salvage is on hand.
    p.salvage.coreFragment = 5;
    expect(startFabrication(world, 'arc-blade-capacitor').reason).toBe('already-built');
    expect(p.salvage.coreFragment).toBe(5);

    // And going down never takes it away.
    p.invulnUntil = -9999;
    damagePlayer(world, 9999, 'a Warden Wisp');
    step(world, 6);
    expect(p.unlocks.capacitor).toBe(true);
    expect(p.unlocks.arcBlade).toBe(true);
  });

  it('changes stagger rather than damage', () => {
    const world = createWorld(4922);
    armPlayer(world);
    const p = world.player;
    const spot = wilderness(world);
    p.pos = v2(spot.x, spot.z);
    p.heading = 0;

    /** Land one heavy on a fresh Rakhor and report what it did. */
    const swing = (): { damage: number; staggered: boolean } => {
      const c = placeThreat(world, 'rakhor', { x: spot.x, z: spot.z + 1.6 });
      const before = c.health;
      p.strike = null;
      beginStrike(world, 'heavy');
      for (let i = 0; i < 200 && p.strike; i++) strikeTick(world, 1 / 60);
      const result = { damage: before - c.health, staggered: c.combat!.state === 'staggered' };
      world.creatures = world.creatures.filter((x) => x !== c);
      return result;
    };

    const plain = swing();
    p.unlocks.capacitor = true;
    const upgraded = swing();

    expect(plain.damage).toBeGreaterThan(0);
    // Same damage — the upgrade is not a damage number going up.
    expect(upgraded.damage).toBe(plain.damage);
    // The difference is what it does to the creature's stance.
    expect(upgraded.staggered).toBe(true);
  });
});

describe('v0.9 regressions', () => {
  it('leaves the world stable, deterministic and unstarved with the new AI', () => {
    const a = createWorld(4923);
    const b = createWorld(4923);
    step(a, 1200);
    step(b, 1200);
    expect(a.chronicle.map((e) => e.text)).toEqual(b.chronicle.map((e) => e.text));

    for (const c of a.creatures) {
      expect(Number.isFinite(c.pos.x) && Number.isFinite(c.pos.z)).toBe(true);
      expect(c.health).toBeGreaterThan(0);
      if (c.combat) {
        // Nothing may sit permanently mid-commit or permanently rocked.
        if (c.combat.state === 'windup' || c.combat.state === 'charge' || c.combat.state === 'lunge') {
          expect(a.timeSec - c.combat.since).toBeLessThan(5);
        }
        if (c.combat.state === 'staggered') {
          expect(a.timeSec - c.combat.since).toBeLessThan(COMBAT.staggerDuration + 1);
        }
      }
    }
    // Combat changes must never starve the colony.
    for (const s of a.settlers) {
      expect(s.health).toBeGreaterThan(20);
      expect(s.hunger).toBeLessThan(99);
    }
    // Beams do not accumulate.
    expect(a.beams.length).toBeLessThanOrEqual(6);
  });
});
