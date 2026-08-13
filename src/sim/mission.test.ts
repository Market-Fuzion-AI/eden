import { afterEach, describe, expect, it } from 'vitest';
import { MISSION, SIM_DT } from './config';
import { applyDevLoadout, setDevMode } from './dev';
import {
  agricultureSitePos,
  completeMission,
  missionObjective,
  missionTracking,
  rescueSurvivor,
  signalBearing,
  signalStrengthAt,
  survivorVisiblePos,
  walkableRoute,
} from './mission';
import {
  SURVIVOR_SCRIPT,
  advanceDialogue,
  awaitingChoice,
  beginSurvivorDialogue,
  chooseDialogueOption,
  endDialogue,
} from './survivorDialogue';
import { getInteractions, survivorAtHand, updatePlayer } from './player';
import { simTick } from './simulation';
import { isWalkable, isWater } from './terrain';
import type { World } from './types';
import { createWorld } from './worldgen';

/**
 * THE SIGNAL, played end to end with no browser.
 *
 * The mission lives in the simulation rather than in React precisely so this
 * file can exist: every beat below is driven by moving the player and pressing
 * the same functions the UI presses, so what is tested here is the mission
 * itself and not a reimplementation of it.
 *
 * The two tests that matter most are the ones that try to break it: that the
 * mission cannot complete without leaving home, and that it is completable
 * with Developer Mode off and nothing in Kai's hands.
 */

/** Run the simulation, standing still. */
function run(world: World, seconds: number): void {
  const ticks = Math.ceil(seconds / SIM_DT);
  for (let i = 0; i < ticks; i++) {
    simTick(world, SIM_DT);
    if (world.ariQueue.length > 8) world.ariQueue.length = 0;
  }
}

/** Put the player somewhere and let the mission see it. */
function standAt(world: World, x: number, z: number, seconds = 0.2): void {
  world.player.pos = { x, z };
  run(world, seconds);
}

/** Walk the mission from dormant to the survivor being found. */
function reachSurvivor(world: World): void {
  run(world, MISSION.openingGrace + 1);
  const m = world.mission!;
  standAt(world, m.podPos.x + 30, m.podPos.z + 30);
  standAt(world, m.podPos.x, m.podPos.z);
  standAt(world, m.survivorPos.x, m.survivorPos.z);
}

/** Play the whole authored conversation, choosing one option. */
function playConversation(world: World, choice: 'kind' | 'light' | 'practical' = 'kind'): void {
  beginSurvivorDialogue(world);
  // Opening lines, until the choice appears.
  for (let i = 0; i < 12 && !awaitingChoice(world); i++) advanceDialogue(world);
  chooseDialogueOption(world, choice);
  // Closing lines, until it ends.
  for (let i = 0; i < 12 && world.dialogueScript; i++) advanceDialogue(world);
}

afterEach(() => setDevMode(null));

describe('THE SIGNAL — setup', () => {
  it('starts dormant, with nothing on screen and nothing unlocked', () => {
    const world = createWorld(8101);
    const m = world.mission!;
    expect(m).toBeTruthy();
    expect(m.state).toBe('dormant');
    expect(m.agricultureUnlocked).toBe(false);
    expect(world.flags.agricultureProgram).toBeUndefined();
    expect(missionObjective(world)).toBeNull();
    expect(survivorVisiblePos(world)).toBeNull();
    expect(signalBearing(world)).toBeNull();
  });

  it('puts the pod on dry, walkable ground a real walk from home', () => {
    for (const seed of [8102, 3, 77, 31337, 555]) {
      const world = createWorld(seed);
      const m = world.mission!;
      expect(isWater(m.podPos.x, m.podPos.z), `seed ${seed}`).toBe(false);
      expect(isWalkable(m.podPos.x, m.podPos.z), `seed ${seed}`).toBe(true);
      expect(isWater(m.survivorPos.x, m.survivorPos.z), `seed ${seed}`).toBe(false);
      const d = Math.hypot(m.podPos.x - m.homePos.x, m.podPos.z - m.homePos.z);
      expect(d, `seed ${seed}`).toBeGreaterThanOrEqual(MISSION.minRange - 1);
      expect(d, `seed ${seed}`).toBeLessThanOrEqual(MISSION.maxRange + 1);
    }
  });

  it('is reachable on foot — no jetpack, no crossing water', () => {
    // The hard requirement: Player Mode, Gate 1 movement only.
    for (const seed of [8103, 11, 404, 31337]) {
      const world = createWorld(seed);
      const m = world.mission!;
      expect(walkableRoute(m.homePos, m.podPos), `seed ${seed} route`).toBe(true);
      expect(walkableRoute(m.podPos, m.survivorPos), `seed ${seed} last few metres`).toBe(true);
    }
  });

  it('is deterministic for a seed', () => {
    const a = createWorld(8104).mission!;
    const b = createWorld(8104).mission!;
    expect(a.podPos).toEqual(b.podPos);
    expect(a.survivorPos).toEqual(b.survivorPos);
  });
});

describe('THE SIGNAL — the signal', () => {
  it('activates on its own after a moment, not instantly', () => {
    const world = createWorld(8201);
    run(world, MISSION.openingGrace * 0.4);
    expect(world.mission!.state).toBe('dormant');
    run(world, MISSION.openingGrace);
    expect(world.mission!.state).toBe('signalDetected');
    expect(world.ariQueue.join(' ')).toMatch(/distress carrier/i);
    expect(missionObjective(world)?.title).toBe('DISTRESS SIGNAL');
  });

  it('strengthens as Kai gets closer and reads zero far away', () => {
    const world = createWorld(8202);
    const m = world.mission!;
    expect(signalStrengthAt(world, m.podPos.x, m.podPos.z)).toBeCloseTo(1, 5);
    const near = signalStrengthAt(world, m.podPos.x + 40, m.podPos.z);
    const far = signalStrengthAt(world, m.podPos.x + 120, m.podPos.z);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(signalStrengthAt(world, m.podPos.x + MISSION.signalRange + 10, m.podPos.z)).toBe(0);
  });

  it('gives a bearing only while it is being tracked', () => {
    const world = createWorld(8203);
    expect(signalBearing(world)).toBeNull();
    run(world, MISSION.openingGrace + 1);
    expect(missionTracking(world)).toBe(true);
    const b = signalBearing(world);
    expect(b).not.toBeNull();
    const m = world.mission!;
    const expected = Math.atan2(m.podPos.x - world.player.pos.x, m.podPos.z - world.player.pos.z);
    expect(b!).toBeCloseTo(expected, 5);
  });

  it('cannot be completed from Human Landing', () => {
    // Standing at camp for a long time must advance nothing past the signal.
    const world = createWorld(8204);
    run(world, MISSION.openingGrace + 400);
    expect(['signalDetected', 'tracking']).toContain(world.mission!.state);
    expect(world.mission!.agricultureUnlocked).toBe(false);
    expect(survivorVisiblePos(world)).toBeNull();
    // And the completion calls refuse from the wrong state.
    expect(rescueSurvivor(world)).toBe(false);
    expect(completeMission(world)).toBe(false);
  });
});

describe('THE SIGNAL — discovery', () => {
  it('advances once when Kai reaches the crash site', () => {
    const world = createWorld(8301);
    run(world, MISSION.openingGrace + 1);
    const m = world.mission!;
    standAt(world, m.podPos.x + 40, m.podPos.z);
    expect(m.state).toBe('tracking');
    standAt(world, m.podPos.x, m.podPos.z);
    expect(m.state).toBe('crashSiteReached');
    const at = m.reachedAt;
    // Standing there longer does not advance it again.
    run(world, 5);
    expect(m.reachedAt).toBe(at);
    expect(world.ariQueue.join(' ')).toMatch(/Pod Seven/);
  });

  it('shows the survivor only once the site has been found', () => {
    const world = createWorld(8302);
    run(world, MISSION.openingGrace + 1);
    const m = world.mission!;
    expect(survivorVisiblePos(world)).toBeNull();
    standAt(world, m.podPos.x, m.podPos.z);
    expect(survivorVisiblePos(world)).not.toBeNull();
  });

  it('finds her as a separate beat from finding the wreck', () => {
    const world = createWorld(8303);
    reachSurvivor(world);
    expect(world.mission!.state).toBe('survivorFound');
    expect(missionObjective(world)?.title).toBe('SURVIVOR');
  });

  it('offers speaking with her, ahead of anything else nearby', () => {
    const world = createWorld(8304);
    reachSurvivor(world);
    expect(survivorAtHand(world)).toBe(true);
    const prompts = getInteractions(world);
    expect(prompts.length).toBe(1);
    expect(prompts[0].key).toBe('E');
    expect(prompts[0].label).toContain(MISSION.survivorName);
  });
});

describe('THE SIGNAL — the conversation', () => {
  it('displays multiple lines, one at a time', () => {
    const world = createWorld(8401);
    reachSurvivor(world);
    const d = beginSurvivorDialogue(world)!;
    expect(d.lines.length).toBe(1);
    advanceDialogue(world);
    expect(world.dialogueScript!.lines.length).toBe(2);
    advanceDialogue(world);
    expect(world.dialogueScript!.lines.length).toBe(3);
    // Each line has a speaker and a portrait slot for the art that comes later.
    for (const line of world.dialogueScript!.lines) {
      expect(line.speaker.length).toBeGreaterThan(0);
      expect(line.text.length).toBeGreaterThan(0);
      expect(line.portraitId).toBe('maya');
      expect(line.mood.length).toBeGreaterThan(0);
    }
  });

  it('puts the choice to the player only after the opening', () => {
    const world = createWorld(8402);
    reachSurvivor(world);
    beginSurvivorDialogue(world);
    expect(awaitingChoice(world)).toBe(false);
    for (let i = 0; i < SURVIVOR_SCRIPT.opening.length; i++) advanceDialogue(world);
    expect(awaitingChoice(world)).toBe(true);
    expect(world.dialogueScript!.choice!.options.length).toBe(3);
  });

  it('will not advance past the choice until the player answers', () => {
    const world = createWorld(8403);
    reachSurvivor(world);
    beginSurvivorDialogue(world);
    for (let i = 0; i < 12 && !awaitingChoice(world); i++) advanceDialogue(world);
    const before = world.dialogueScript!.lines.length;
    advanceDialogue(world);
    advanceDialogue(world);
    expect(world.dialogueScript!.lines.length).toBe(before);
    expect(awaitingChoice(world)).toBe(true);
  });

  it('speaks the chosen reply, and each choice gets a different one', () => {
    const seen = new Set<string>();
    for (const id of ['kind', 'light', 'practical'] as const) {
      const world = createWorld(8404);
      reachSurvivor(world);
      beginSurvivorDialogue(world);
      for (let i = 0; i < 12 && !awaitingChoice(world); i++) advanceDialogue(world);
      expect(chooseDialogueOption(world, id)).toBe(true);
      const d = world.dialogueScript!;
      // Kai says something, then she answers.
      const kaiLine = d.lines.find((l) => l.portraitId === null);
      expect(kaiLine, id).toBeTruthy();
      const reply = d.lines[d.lines.length - 1];
      expect(reply.portraitId).toBe('maya');
      seen.add(reply.text);
      expect(world.mission!.choiceMade).toBe(id);
    }
    expect(seen.size).toBe(3);
  });

  it('cannot fire the choice twice', () => {
    const world = createWorld(8405);
    reachSurvivor(world);
    beginSurvivorDialogue(world);
    for (let i = 0; i < 12 && !awaitingChoice(world); i++) advanceDialogue(world);
    expect(chooseDialogueOption(world, 'kind')).toBe(true);
    const lines = world.dialogueScript!.lines.length;
    const affinity = world.flags.mayaAffinity;
    expect(chooseDialogueOption(world, 'kind')).toBe(false);
    expect(chooseDialogueOption(world, 'light')).toBe(false);
    expect(world.dialogueScript!.lines.length).toBe(lines);
    expect(world.flags.mayaAffinity).toBe(affinity);
  });

  it('records a small consequence without touching the norm simulation', () => {
    const world = createWorld(8406);
    reachSurvivor(world);
    playConversation(world, 'kind');
    expect(world.flags.mayaAffinity).toBe(8);
    // Nothing was written into the settlers' social model.
    for (const s of world.settlers) expect(s.socialBeliefs.length).toBe(0);
  });

  it('does not rescue her if the player walks away mid-conversation', () => {
    const world = createWorld(8407);
    reachSurvivor(world);
    beginSurvivorDialogue(world);
    advanceDialogue(world);
    endDialogue(world);
    expect(world.mission!.state).toBe('survivorFound');
    expect(world.dialogueScript).toBeNull();
  });

  it('rescues her exactly once when the conversation finishes', () => {
    const world = createWorld(8408);
    reachSurvivor(world);
    playConversation(world);
    const m = world.mission!;
    expect(m.state).toBe('survivorRescued');
    const at = m.rescuedAt;
    // Re-opening the conversation afterwards is a short exchange with no fork,
    // and cannot rescue her a second time.
    const again = beginSurvivorDialogue(world)!;
    expect(again.choice).toBeNull();
    advanceDialogue(world);
    expect(rescueSurvivor(world)).toBe(false);
    expect(m.rescuedAt).toBe(at);
  });
});

describe('THE SIGNAL — coming home', () => {
  it('completes when Kai gets back to Human Landing, and not before', () => {
    const world = createWorld(8501);
    reachSurvivor(world);
    playConversation(world);
    const m = world.mission!;
    expect(m.state).toBe('survivorRescued');
    expect(missionObjective(world)?.title).toBe('BRING HER HOME');

    // Halfway home is not home.
    standAt(world, (m.podPos.x + m.homePos.x) / 2, (m.podPos.z + m.homePos.z) / 2, 1);
    expect(m.state).toBe('survivorRescued');
    expect(m.agricultureUnlocked).toBe(false);

    standAt(world, m.homePos.x, m.homePos.z, 1);
    expect(m.state).toBe('completed');
    expect(m.agricultureUnlocked).toBe(true);
  });

  it('unlocks the Agriculture Program, and it was unavailable before', () => {
    const world = createWorld(8502);
    expect(world.flags.agricultureProgram).toBeUndefined();
    expect(world.mission!.agricultureUnlocked).toBe(false);

    reachSurvivor(world);
    playConversation(world);
    expect(world.mission!.agricultureUnlocked).toBe(false);
    const m = world.mission!;
    standAt(world, m.homePos.x, m.homePos.z, 1);

    expect(world.flags.agricultureProgram).toBe(true);
    expect(world.mission!.agricultureUnlocked).toBe(true);
    expect(world.ariQueue.join(' ')).toMatch(/AGRICULTURE PROGRAM/);
  });

  it('puts the agriculture site on dry walkable ground beside the camp', () => {
    for (const seed of [8503, 12, 909]) {
      const world = createWorld(seed);
      const p = agricultureSitePos(world);
      expect(isWater(p.x, p.z), `seed ${seed}`).toBe(false);
      expect(isWalkable(p.x, p.z), `seed ${seed}`).toBe(true);
      const d = Math.hypot(p.x - world.mission!.homePos.x, p.z - world.mission!.homePos.z);
      expect(d).toBeLessThanOrEqual(24);
    }
  });

  it('brings her to Human Landing, and completing is idempotent', () => {
    const world = createWorld(8504);
    reachSurvivor(world);
    playConversation(world);
    const m = world.mission!;
    standAt(world, m.homePos.x, m.homePos.z, 1);
    const here = survivorVisiblePos(world)!;
    expect(Math.hypot(here.x - m.homePos.x, here.z - m.homePos.z)).toBeLessThan(1);
    const at = m.completedAt;
    // The Chronicle keeps growing — the valley is still living its own life —
    // so what must not happen is a *second* entry about her.
    const mentions = () => world.chronicle.filter((e) => e.text.includes('Maya')).length;
    const before = mentions();
    expect(completeMission(world)).toBe(false);
    run(world, 10);
    expect(m.completedAt).toBe(at);
    expect(mentions()).toBe(before);
    expect(missionObjective(world)).toBeNull();
  });
});

describe('THE SIGNAL — both modes', () => {
  it('plays end to end with Developer Mode OFF and nothing equipped', () => {
    setDevMode(false);
    const world = createWorld(8601);
    // Player Mode: no weapons, no jetpack, no scanner, no materials.
    expect(world.player.unlocks.jetpack).toBe(false);
    expect(world.player.equipped).toBe('none');

    reachSurvivor(world);
    playConversation(world, 'practical');
    const m = world.mission!;
    standAt(world, m.homePos.x, m.homePos.z, 1);

    expect(m.state).toBe('completed');
    expect(m.agricultureUnlocked).toBe(true);
    // Still nothing granted: finishing the mission is not a loadout.
    expect(world.player.unlocks.jetpack).toBe(false);
  });

  it('plays end to end with Developer Mode ON', () => {
    setDevMode(true);
    const world = createWorld(8602);
    applyDevLoadout(world);
    reachSurvivor(world);
    playConversation(world, 'light');
    const m = world.mission!;
    standAt(world, m.homePos.x, m.homePos.z, 1);
    expect(m.state).toBe('completed');
    expect(m.agricultureUnlocked).toBe(true);
  });
});

describe('THE SIGNAL — the rest of the world is unharmed', () => {
  it('leaves settlers, wildlife and the chronicle running through the mission', () => {
    const world = createWorld(8701);
    const settlers = world.settlers.length;
    const creatures = world.creatures.length;

    reachSurvivor(world);
    playConversation(world);
    const m = world.mission!;
    standAt(world, m.homePos.x, m.homePos.z, 1);
    run(world, 200);

    expect(world.settlers.length).toBe(settlers);
    expect(world.creatures.length).toBeLessThanOrEqual(creatures + 4);
    expect(world.creatures.length).toBeGreaterThan(0);
    expect(world.chronicle.length).toBeGreaterThan(0);
    // Everyone is still doing something, and nothing has gone non-finite.
    for (const s of world.settlers) {
      expect(Number.isFinite(s.pos.x) && Number.isFinite(s.pos.z)).toBe(true);
      expect(s.goal.type.length).toBeGreaterThan(0);
    }
    for (const c of world.creatures) {
      expect(Number.isFinite(c.pos.x) && Number.isFinite(c.pos.z)).toBe(true);
    }
  });

  it('makes the wreck and the survivor solid', () => {
    // Both were walk-through-able when the mission first ran end to end: the
    // pod read as a painting and Kai stood inside the person he came to find.
    const world = createWorld(8704);
    const m = world.mission!;
    const podObstacle = world.obstacles.find(
      (o) => Math.hypot(o.pos.x - m.podPos.x, o.pos.z - m.podPos.z) < 0.01,
    );
    expect(podObstacle, 'the pod should be solid').toBeTruthy();
    expect(podObstacle!.radius).toBeGreaterThan(2);

    // Walk straight at her and stop short.
    reachSurvivor(world);
    const p = world.player;
    p.pos = { x: m.survivorPos.x - 4, z: m.survivorPos.z };
    p.heading = Math.PI / 2;
    for (let i = 0; i < 240; i++) {
      updatePlayer(world, 1 / 60, { moveX: 0, moveZ: 1, sprint: false, jump: false, camYaw: Math.PI / 2 });
    }
    const gap = Math.hypot(p.pos.x - m.survivorPos.x, p.pos.z - m.survivorPos.z);
    expect(gap, 'Kai should not end up standing inside her').toBeGreaterThan(0.7);
  });

  it('does not disturb the 3Cs course', () => {
    const world = createWorld(8702);
    expect(world.course.length).toBeGreaterThan(10);
    const m = world.mission!;
    // The crash site is scored away from the greybox test geometry, so the
    // first authored experience is not a walk through the movement lab.
    const nearest = Math.min(...world.course.map((c) => Math.hypot(c.pos.x - m.podPos.x, c.pos.z - m.podPos.z)));
    expect(nearest).toBeGreaterThan(25);
  });

  it('stays deterministic with the mission in the loop', () => {
    const a = createWorld(8703);
    const b = createWorld(8703);
    run(a, 300);
    run(b, 300);
    const shape = (w: World) =>
      w.settlers.map((s) => `${s.id}:${s.goal.type}:${s.pos.x.toFixed(3)}`).join('|');
    expect(shape(a)).toBe(shape(b));
    expect(a.mission!.state).toBe(b.mission!.state);
  });
});
