import { describe, expect, it } from 'vitest';
import { FIRST_LIGHT, SIM_DT } from './config';
import {
  BEATS,
  KEY_SURVIVORS,
  STATIONS,
  firstLightActive,
  jumpToBeat,
  missionUnlocked,
  noteMet,
  restartFirstLight,
} from './firstLight';
import { SURVIVORS, MAYA } from './identities';
import { missionObjective } from './mission';
import { performScan } from './scanner';
import { simTick } from './simulation';
import type { FirstLightBeat, World } from './types';
import { createWorld } from './worldgen';

/**
 * FIRST LIGHT — the authored opening.
 *
 * Two things are under test. The story has to actually happen in order, and it
 * has to hand the twelve survivors back afterwards: a director that
 * permanently owns its cast has replaced the simulation rather than borrowed
 * from it, which is the one outcome this design must not have.
 */

function run(world: World, seconds: number): void {
  const ticks = Math.ceil(seconds / SIM_DT);
  for (let i = 0; i < ticks; i++) {
    simTick(world, SIM_DT);
    if (world.ariQueue.length > 8) world.ariQueue.length = 0;
  }
}

const humans = (w: World) => w.settlers.filter((s) => s.speciesId === 'human');
const byName = (w: World, n: string) => w.settlers.find((s) => s.name === n)!;
const tents = (w: World) => w.landmarksBuilt.filter((b) => b.kind === 'tent').length;
const stationed = (w: World) => w.settlers.filter((s) => s.roleAnchor?.role === 'station').length;

describe('a new game begins at the crash, not after it', () => {
  it('starts in the impact beat', () => {
    const world = createWorld(6101);
    expect(world.firstLight.beat).toBe('impact');
    expect(firstLightActive(world)).toBe(true);
    expect(world.firstLight.revealedAt).toBe(-1);
  });

  it('has no camp yet — no fire, no tents', () => {
    const world = createWorld(6102);
    expect(world.structures.filter((s) => s.type === 'campfire')).toHaveLength(0);
    expect(world.flags.hearthLit).toBeFalsy();
    expect(tents(world)).toBe(0);
  });

  it('has no operational Fabricator', () => {
    const world = createWorld(6103);
    expect(world.fabricatorPos).toBeNull();
    expect(world.landmarksBuilt.some((b) => b.kind === 'fabricator')).toBe(false);
    // And nobody is anchored to a machine that does not exist.
    expect(world.settlers.some((s) => s.roleAnchor?.role === 'fabricator')).toBe(false);
  });

  it('does leave wreckage to wake up beside', () => {
    const world = createWorld(6104);
    expect(world.landmarksBuilt.some((b) => b.kind === 'pod')).toBe(true);
    expect(world.landmarksBuilt.filter((b) => b.kind === 'debris').length).toBeGreaterThanOrEqual(3);
  });

  it('does not start the distress mission', () => {
    const world = createWorld(6105);
    expect(world.mission!.state).toBe('dormant');
    expect(missionUnlocked(world)).toBe(false);
    expect(missionObjective(world)).toBeNull();
    // And it stays dormant however long the player wanders.
    run(world, 400);
    expect(world.mission!.state).toBe('dormant');
  });

  it('has all twelve survivors, and not Maya', () => {
    const world = createWorld(6106);
    expect(humans(world)).toHaveLength(12);
    expect(SURVIVORS).toHaveLength(12);
    for (const s of SURVIVORS) expect(byName(world, s.name), s.name).toBeTruthy();
    expect(world.settlers.some((s) => s.name === MAYA.name)).toBe(false);
    expect(MAYA.name).toBe(FIRST_LIGHT.missingName);
  });

  it('scatters them across the site instead of stacking them on the camp', () => {
    const world = createWorld(6107);
    const camp = world.camps.find((c) => c.speciesId === 'human')!;
    const spread = humans(world).map((s) => Math.hypot(s.pos.x - camp.pos.x, s.pos.z - camp.pos.z));
    expect(Math.max(...spread)).toBeGreaterThan(9);
    // No two people standing in the same spot.
    for (const a of humans(world)) {
      for (const b of humans(world)) {
        if (a.id >= b.id) continue;
        expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z), `${a.name}/${b.name}`).toBeGreaterThan(1);
      }
    }
  });
});

describe('the director borrows the survivors and gives them back', () => {
  it('posts everyone to a job during the emergency', () => {
    const world = createWorld(6201);
    expect(stationed(world)).toBe(STATIONS.length);
    for (const st of STATIONS) {
      const s = byName(world, st.name);
      expect(s.roleAnchor?.label, st.name).toBe(st.doing);
    }
  });

  it('keeps them posted through ordinary simulation ticks', () => {
    const world = createWorld(6202);
    const june = byName(world, 'June');
    const post = { ...june.roleAnchor!.pos };
    run(world, 200);
    // Still on the job, and still near it — the anchor survived the utility AI.
    expect(june.roleAnchor?.role).toBe('station');
    expect(Math.hypot(june.pos.x - post.x, june.pos.z - post.z)).toBeLessThan(FIRST_LIGHT.stationRadius * 3);
  });

  it('never overrides hunger or exhaustion', () => {
    // The whole point of using roleAnchor: a posted survivor is still a person.
    // `goals.ts` only applies an anchor when they are settled, so a starving
    // one deals with that first. Asserting on a goal *label* at one instant is
    // brittle — he may already have eaten — so this measures the outcome: the
    // need got dealt with, and the post did not stop him leaving to deal with it.
    const world = createWorld(6203);
    const s = byName(world, 'Kael');
    const post = { ...s.roleAnchor!.pos };
    s.hunger = 95;
    s.energy = 10;
    let wandered = 0;
    for (let i = 0; i < 300; i++) {
      run(world, 1);
      wandered = Math.max(wandered, Math.hypot(s.pos.x - post.x, s.pos.z - post.z));
    }
    // Still posted — the story did not lose him.
    expect(s.roleAnchor?.role).toBe('station');
    // But the need won: he either fed himself or went looking further than the
    // anchor would ever have let him drift on its own.
    expect(s.hunger < 95 || wandered > FIRST_LIGHT.stationRadius).toBe(true);
  });

  it('releases everyone once the opening is over', () => {
    const world = createWorld(6204);
    jumpToBeat(world, 'released');
    expect(stationed(world)).toBe(0);
    for (const s of humans(world)) expect(s.roleAnchor, s.name).toBeUndefined();
  });

  it('returns released survivors to autonomous behaviour', () => {
    const world = createWorld(6205);
    jumpToBeat(world, 'released');
    run(world, 600);
    // They are living their own lives again: real goals, and not all the same.
    const kinds = new Set(humans(world).map((s) => s.goal.type));
    expect(kinds.size).toBeGreaterThan(1);
    expect(stationed(world)).toBe(0);
  });
});

describe('the camp rises over the day', () => {
  it('lights the fire only when the camp starts going up', () => {
    const world = createWorld(6301);
    expect(world.flags.hearthLit).toBeFalsy();
    jumpToBeat(world, 'campRising');
    expect(world.flags.hearthLit).toBe(true);
    expect(world.structures.filter((s) => s.type === 'campfire')).toHaveLength(1);
  });

  it('ends the day with exactly six tents', () => {
    const world = createWorld(6302);
    jumpToBeat(world, 'evening');
    expect(tents(world)).toBe(FIRST_LIGHT.tents);
    expect(tents(world)).toBe(6);
  });

  it('never raises more than six, however long it runs', () => {
    const world = createWorld(6303);
    jumpToBeat(world, 'campRising');
    run(world, 900);
    expect(tents(world)).toBeLessThanOrEqual(FIRST_LIGHT.tents);
  });

  it('puts the tents somewhere a person could pitch one', () => {
    const world = createWorld(6304);
    jumpToBeat(world, 'evening');
    const camp = world.camps.find((c) => c.speciesId === 'human')!;
    for (const t of world.landmarksBuilt.filter((b) => b.kind === 'tent')) {
      const d = Math.hypot(t.pos.x - camp.pos.x, t.pos.z - camp.pos.z);
      expect(d).toBeGreaterThan(3);
      expect(d).toBeLessThan(FIRST_LIGHT.tentRing + 8);
    }
  });

  // Two tents in the same place, or a tent grown through the drop pod, is not
  // something a headcount assertion would ever notice — it is only visible by
  // looking, and looking is not something a test suite does.
  it('never pitches a tent through the wreck or through another tent', () => {
    for (const seed of [6305, 91, 4242, 777]) {
      const world = createWorld(seed);
      jumpToBeat(world, 'evening');
      const pitched = world.landmarksBuilt.filter((b) => b.kind === 'tent');
      expect(pitched).toHaveLength(6);
      for (let i = 0; i < pitched.length; i++) {
        for (let j = i + 1; j < pitched.length; j++) {
          const d = Math.hypot(
            pitched[i].pos.x - pitched[j].pos.x,
            pitched[i].pos.z - pitched[j].pos.z,
          );
          expect(d).toBeGreaterThan(3.6);
        }
        const pod = world.landmarksBuilt.find((b) => b.kind === 'pod')!;
        const toPod = Math.hypot(pitched[i].pos.x - pod.pos.x, pitched[i].pos.z - pod.pos.z);
        expect(toPod).toBeGreaterThan(5);
      }
    }
  });

  // The camp has a front. Walk in from the side away from the wreck and the
  // hearth should be the first thing you see, not the back of a shelter.
  it('leaves the way in opposite the wreck clear', () => {
    for (const seed of [6306, 12, 8080]) {
      const world = createWorld(seed);
      jumpToBeat(world, 'evening');
      const camp = world.camps.find((c) => c.speciesId === 'human')!;
      const pod = world.landmarksBuilt.find((b) => b.kind === 'pod')!;
      // The bearing a player approaching from the open side would arrive on.
      const inward = Math.atan2(camp.pos.x - pod.pos.x, camp.pos.z - pod.pos.z);
      for (const t of world.landmarksBuilt.filter((b) => b.kind === 'tent')) {
        const bearing = Math.atan2(t.pos.x - camp.pos.x, t.pos.z - camp.pos.z);
        let off = Math.abs(bearing - inward);
        while (off > Math.PI) off = Math.abs(off - Math.PI * 2);
        // Nothing standing within 15° of the sightline into the fire.
        expect(off).toBeGreaterThan(0.26);
      }
    }
  });
});

describe('the headcount', () => {
  it('cannot happen before the camp has stabilised', () => {
    const world = createWorld(6401);
    run(world, 120);
    expect(BEATS.indexOf(world.firstLight.beat)).toBeLessThan(BEATS.indexOf('headcount'));
    expect(missionUnlocked(world)).toBe(false);
  });

  it('reveals Maya once, and only once', () => {
    const world = createWorld(6402);
    jumpToBeat(world, 'headcount');
    const at = world.firstLight.revealedAt;
    expect(at).toBeGreaterThanOrEqual(0);
    run(world, 200);
    // Later beats must not re-fire the reveal and reset the clock.
    expect(world.firstLight.revealedAt).toBe(at);
    const mentions = world.chronicle.filter((e) => e.text.includes(MAYA.name)).length;
    expect(mentions).toBe(1);
  });

  it('says who is missing and why it matters', () => {
    const world = createWorld(6403);
    jumpToBeat(world, 'headcount');
    const said = world.ariQueue.join(' ');
    expect(said).toContain('Maya');
    expect(said).toMatch(/agricultur/i);
  });

  it('is internally consistent: twelve here, one missing', () => {
    const world = createWorld(6404);
    jumpToBeat(world, 'headcount');
    expect(humans(world)).toHaveLength(12);
    expect(world.settlers.some((s) => s.name === MAYA.name)).toBe(false);
  });
});

describe('handing off to the distress mission', () => {
  it('is never awake while nobody knows anyone is missing', () => {
    // The invariant, checked continuously rather than at one convenient moment:
    // across a whole day of play the mission may only leave `dormant` after the
    // reveal has happened. Sampling a single instant would pass by luck.
    const world = createWorld(6501);
    for (let i = 0; i < 1600; i++) {
      run(world, 1);
      if (world.firstLight.revealedAt < 0) {
        expect(world.mission!.state, `t=${world.timeSec.toFixed(0)}`).toBe('dormant');
        expect(missionObjective(world)).toBeNull();
      }
    }
    // And by the end it has been let through, so the invariant was not vacuous.
    expect(world.firstLight.revealedAt).toBeGreaterThanOrEqual(0);
    expect(world.mission!.state).not.toBe('dormant');
  });

  it('activates after the reveal', () => {
    const world = createWorld(6502);
    jumpToBeat(world, 'headcount');
    run(world, 120);
    expect(world.mission!.state).not.toBe('dormant');
    const objective = missionObjective(world);
    expect(objective).toBeTruthy();
    expect(objective!.title).toBe('DISTRESS SIGNAL');
  });

  it('still points somewhere Kai can walk', () => {
    const world = createWorld(6503);
    jumpToBeat(world, 'headcount');
    run(world, 120);
    const pod = world.mission!.podPos;
    const camp = world.camps.find((c) => c.speciesId === 'human')!;
    expect(Math.hypot(pod.x, pod.z)).toBeLessThan(140);
    expect(Math.hypot(pod.x - camp.pos.x, pod.z - camp.pos.z)).toBeGreaterThan(90);
  });

  it('does not rebuild the mission — it is the same one', () => {
    const fresh = createWorld(6504);
    const before = { ...fresh.mission!.podPos };
    jumpToBeat(fresh, 'headcount');
    run(fresh, 120);
    expect(fresh.mission!.podPos).toEqual(before);
  });
});

describe('the beats advance from play', () => {
  it('moves off impact on its own', () => {
    const world = createWorld(6601);
    expect(world.firstLight.beat).toBe('impact');
    run(world, FIRST_LIGHT.impactDwell + 20);
    expect(world.firstLight.beat).toBe('gather');
  });

  it('advances when Kai reaches the people who matter', () => {
    const world = createWorld(6602);
    run(world, FIRST_LIGHT.impactDwell + 20);
    expect(world.firstLight.beat).toBe('gather');
    for (const name of KEY_SURVIVORS) noteMet(world, byName(world, name));
    run(world, 10);
    expect(world.firstLight.beat).toBe('stabilize');
  });

  it('counts each person once', () => {
    const world = createWorld(6603);
    const s = byName(world, 'Mira');
    noteMet(world, s);
    noteMet(world, s);
    noteMet(world, s);
    expect(world.firstLight.metSurvivors).toHaveLength(1);
  });

  it('takes a scanner sweep as the way through the stabilize beat', () => {
    const world = createWorld(6604);
    jumpToBeat(world, 'stabilize');
    expect(world.firstLight.scanned).toBe(false);
    world.player.unlocks.scanner = true;
    performScan(world);
    expect(world.firstLight.scanned).toBe(true);
    run(world, 10);
    expect(world.firstLight.beat).toBe('campRising');
  });

  it('leaves the scanner mechanic alone', () => {
    const world = createWorld(6605);
    world.player.unlocks.scanner = true;
    const node = world.resources.find((r) => r.type === 'alloy' || r.type === 'ore' || r.type === 'crystal')!;
    world.player.pos = { x: node.pos.x, z: node.pos.z };
    node.discovered = false;
    const result = performScan(world);
    expect(result.ok).toBe(true);
    expect(result.found).toContain(node.id);
    expect(node.discovered).toBe(true);
  });

  it('cannot deadlock — a player who does nothing still reaches the end', () => {
    const world = createWorld(6606);
    run(world, 1800);
    expect(BEATS.indexOf(world.firstLight.beat)).toBeGreaterThanOrEqual(BEATS.indexOf('headcount'));
    expect(missionUnlocked(world)).toBe(true);
  });
});

describe('developer tooling', () => {
  it('every beat jump produces a coherent world', () => {
    for (const beat of BEATS) {
      const world = createWorld(6701);
      jumpToBeat(world, beat as FirstLightBeat);
      expect(world.firstLight.beat, beat).toBe(beat);
      const idx = BEATS.indexOf(beat as FirstLightBeat);
      // Anything a beat assumes must actually be there.
      if (idx >= BEATS.indexOf('campRising')) expect(world.flags.hearthLit, beat).toBe(true);
      if (idx >= BEATS.indexOf('evening')) expect(tents(world), beat).toBe(FIRST_LIGHT.tents);
      if (idx >= BEATS.indexOf('headcount')) expect(missionUnlocked(world), beat).toBe(true);
      if (beat === 'released') expect(stationed(world)).toBe(0);
      // And the world still simulates from there.
      run(world, 60);
      expect(world.settlers.every((s) => Number.isFinite(s.pos.x)), beat).toBe(true);
    }
  });

  it('restart puts the opening back to its first moment', () => {
    const world = createWorld(6702);
    jumpToBeat(world, 'headcount');
    run(world, 200);
    expect(tents(world)).toBe(6);
    expect(missionUnlocked(world)).toBe(true);

    restartFirstLight(world);

    expect(world.firstLight.beat).toBe('impact');
    expect(world.firstLight.revealedAt).toBe(-1);
    expect(world.firstLight.tentsRaised).toBe(0);
    expect(tents(world)).toBe(0);
    expect(world.flags.hearthLit).toBe(false);
    expect(world.structures.filter((s) => s.type === 'campfire')).toHaveLength(0);
    expect(world.mission!.state).toBe('dormant');
    expect(missionUnlocked(world)).toBe(false);
    expect(stationed(world)).toBe(STATIONS.length);
  });

  it('restart is repeatable and deterministic', () => {
    const world = createWorld(6703);
    const snapshot = () =>
      humans(world)
        .map((s) => `${s.name}:${s.pos.x.toFixed(2)},${s.pos.z.toFixed(2)}`)
        .join('|');
    restartFirstLight(world);
    const a = snapshot();
    jumpToBeat(world, 'evening');
    run(world, 100);
    restartFirstLight(world);
    expect(snapshot()).toBe(a);
  });
});

describe('the opening does not break the valley', () => {
  it('runs a full day without corrupting anything', () => {
    const world = createWorld(6801);
    run(world, 1500);
    for (const s of world.settlers) {
      expect(Number.isFinite(s.pos.x) && Number.isFinite(s.pos.z)).toBe(true);
      expect(s.health).toBeGreaterThan(0);
    }
    expect(world.creatures.length).toBeGreaterThan(0);
  });

  it('is deterministic for a seed', () => {
    const a = createWorld(6802);
    const b = createWorld(6802);
    run(a, 700);
    run(b, 700);
    expect(a.firstLight.beat).toBe(b.firstLight.beat);
    expect(a.chronicle.map((e) => e.text)).toEqual(b.chronicle.map((e) => e.text));
  });
});
