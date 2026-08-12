import { describe, expect, it } from 'vitest';
import { COMBAT, SIM_DT, THREAT, WORLD } from './config';
import {
  activeThreats,
  beginDodge,
  beginStrike,
  canStrike,
  damageCreatureByPlayer,
  damagePlayer,
  insideSafeZone,
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
    let hits = strikeTick(world, COMBAT.light.windup * 0.5);
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

  it('cannot be interrupted mid-commit, but chains on recovery up to the cap', () => {
    const world = createWorld(4804);
    armPlayer(world);
    const p = world.player;
    expect(beginStrike(world, 'light').ok).toBe(true);
    // Mid wind-up: refused.
    expect(beginStrike(world, 'light').reason).toBe('busy');
    // Walk it into recovery.
    strikeTick(world, COMBAT.light.windup + COMBAT.light.active + 0.001);
    expect(p.strike!.phase).toBe('recover');

    let chain = beginStrike(world, 'light');
    expect(chain.chain).toBe(2);
    strikeTick(world, COMBAT.light.windup + COMBAT.light.active + 0.001);
    chain = beginStrike(world, 'light');
    expect(chain.chain).toBe(COMBAT.maxChain);
    strikeTick(world, COMBAT.light.windup + COMBAT.light.active + 0.001);
    // The cap holds however long the chain is continued.
    chain = beginStrike(world, 'light');
    expect(chain.chain).toBe(COMBAT.maxChain);
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
      if (state === 'strike') break;
      // Pin Emerson in place: this test is about the creature, not the chase.
      p.pos = v2(spot.x, spot.z);
      p.health = 100;
    }
    expect(seen).toContain('warn');
    const strikeAt = seen.indexOf('strike');
    expect(strikeAt).toBeGreaterThan(0);
    // Immediately before any strike there is always a wind-up, and before the
    // first hostility there is always a warning.
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
      if (c.combat!.state === 'strike' && last !== 'strike') strikes++;
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
