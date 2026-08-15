import { describe, expect, it } from 'vitest';
import { SIM_DT } from './config';
import { FOUNDING_SURVIVORS, identityOf, MAYA, SURVIVORS } from './identities';
import { buildDialogueContext, settlerRole } from './npcContext';
import { localTurn } from './dialogueProvider';
import { identifyFocus } from './identify';
import { remember } from './memory';
import { simTick } from './simulation';
import type { World } from './types';
import { jumpToBeat, restoreFabricator } from './firstLight';
import { createWorld } from './worldgen';

/**
 * The twelve survivors, as characters.
 *
 * What these protect is the separation the whole pass is built on: authored
 * identity, live simulation state, and current priority are three different
 * things, and none of them may overwrite another. A sleeping engineer is still
 * an engineer; a surveyor who has stopped to eat still wants the east mapped.
 *
 * The rest is the boundary that was already there and must stay there — a
 * settler may only speak from what they personally know, and nothing about the
 * world, other people's heads, or Kai's pockets leaks in through the identity.
 */

function run(world: World, seconds: number): void {
  const ticks = Math.ceil(seconds / SIM_DT);
  for (let i = 0; i < ticks; i++) {
    simTick(world, SIM_DT);
    if (world.ariQueue.length > 8) world.ariQueue.length = 0;
  }
}

const humans = (w: World) => w.settlers.filter((s) => s.speciesId === 'human');
const byName = (w: World, name: string) => w.settlers.find((s) => s.name === name)!;

describe('the twelve who founded Human Landing', () => {
  it('is exactly twelve people', () => {
    expect(SURVIVORS.length).toBe(12);
    expect(FOUNDING_SURVIVORS).toBe(12);
    const world = createWorld(4101);
    expect(humans(world).length).toBe(12);
  });

  it('makes the mission\'s arithmetic true — twelve become thirteen', () => {
    // THE SIGNAL says "twelve people became thirteen". Maya is that thirteenth,
    // and she is deliberately not one of the founding twelve.
    expect(SURVIVORS.some((s) => s.name === MAYA.name)).toBe(false);
    expect(SURVIVORS.length + 1).toBe(13);
    const world = createWorld(4102);
    expect(world.settlers.some((s) => s.name === MAYA.name)).toBe(false);
  });

  it('gives every survivor a complete identity', () => {
    for (const s of [...SURVIVORS, MAYA]) {
      expect(s.name.length, s.name).toBeGreaterThan(1);
      expect(s.role.length, s.name).toBeGreaterThan(3);
      expect(s.responsibility.length, s.name).toBeGreaterThan(10);
      expect(s.goal.length, s.name).toBeGreaterThan(10);
      expect(s.problem.length, s.name).toBeGreaterThan(10);
      expect(s.aspiration.length, s.name).toBeGreaterThan(10);
      expect(s.outlook.length, s.name).toBeGreaterThan(10);
      expect(s.expertise.length, s.name).toBeGreaterThanOrEqual(2);
      expect(s.traits.length, s.name).toBeGreaterThanOrEqual(2);
      expect(s.values.length, s.name).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives everyone a distinct name and a distinct posting', () => {
    expect(new Set(SURVIVORS.map((s) => s.name)).size).toBe(SURVIVORS.length);
    expect(new Set(SURVIVORS.map((s) => s.role)).size).toBe(SURVIVORS.length);
  });

  it('covers what a crashed colony actually needs', () => {
    const roles = SURVIVORS.map((s) => s.role.toLowerCase()).join(' | ');
    for (const need of [
      'engineer',
      'medic',
      'survey',
      'security',
      'logistics',
      'fabrication',
      'biologist',
      'communications',
      'geologist',
      'life support',
    ]) {
      expect(roles, need).toContain(need);
    }
    // And no farmer. The colony cannot feed itself until Kai finds Maya, which
    // is the entire point of THE SIGNAL's payoff.
    expect(roles).not.toContain('agricultur');
    expect(MAYA.role.toLowerCase()).toContain('agricultur');
  });

  it('preserves the characters QA has already met', () => {
    const world = createWorld(4103);
    const established: [string, string][] = [
      ['Selene', 'Survey Researcher'],
      ['Kael', 'Logistics'],
      ['June', 'Security'],
      ['Petra', 'Fabrication Technician'],
      ['Asha', 'Systems Engineer'],
      ['Mira', 'Field Medic'],
      ['Rowan', 'Pilot'],
      ['Dmitri', 'Biologist'],
    ];
    for (const [name, role] of established) {
      const s = byName(world, name);
      expect(s, name).toBeTruthy();
      expect(settlerRole(s), name).toBe(role);
    }
  });

  it('keeps Petra the fabricator the simulation anchors to the machine', () => {
    const world = createWorld(4104);
    const petra = byName(world, 'Petra');
    // On Day 1 the Fabricator is wreckage, so there is no post to keep — she is
    // posted to sorting the damaged gear instead. Her identity is unchanged.
    expect(petra.roleAnchor?.role).toBe('station');
    jumpToBeat(world, 'released');
    restoreFabricator(world);
    expect(petra.roleAnchor?.role).toBe('fabricator');
    expect(settlerRole(petra)).toBe('Fabrication Technician');
    expect(petra.knowledge[0]).toBe('fabrication');
  });

  it('can actually feed twelve people', () => {
    // Growing Human Landing from eight founders to twelve is a simulation
    // change, not just a writing one: two berry patches fed eight and starved
    // twelve. Food near a camp scales with the people living at it.
    const world = createWorld(4106);
    for (const camp of world.camps) {
      const residents = world.settlers.filter((s) => s.speciesId === camp.speciesId).length;
      const patches = world.resources.filter(
        (r) => r.type === 'glowberry' && Math.hypot(r.pos.x - camp.pos.x, r.pos.z - camp.pos.z) <= 24,
      ).length;
      expect(patches, camp.label).toBeGreaterThanOrEqual(Math.ceil(residents / 4));
    }
  });

  it('nobody starves once the colony is twelve', () => {
    const world = createWorld(4107);
    run(world, 2400);
    for (const s of world.settlers) {
      expect(s.hunger, s.name).toBeLessThan(99);
      expect(s.health, s.name).toBeGreaterThan(20);
    }
  });

  it('leaves the Veyra and Caelari out of the Initiative entirely', () => {
    const world = createWorld(4105);
    for (const s of world.settlers.filter((x) => x.speciesId !== 'human')) {
      expect(identityOf(s.name)).toBeNull();
      // Their own people, not expedition postings.
      expect(['Veyra', 'Caelari']).toContain(settlerRole(s));
    }
  });
});

describe('authored identity survives the simulation', () => {
  it('does not change when the settler changes what they are doing', () => {
    const world = createWorld(4201);
    const selene = byName(world, 'Selene');
    const before = buildDialogueContext(world, selene);

    // Let her get on with her own life for a long stretch.
    run(world, 900);
    const after = buildDialogueContext(world, selene);

    expect(after.npc.role).toBe(before.npc.role);
    expect(after.npc.responsibility).toBe(before.npc.responsibility);
    expect(after.npc.expertise).toEqual(before.npc.expertise);
    expect(after.priority).toEqual(before.priority);
  });

  it('survives sleeping — a resting surveyor is still a surveyor', () => {
    const world = createWorld(4202);
    const selene = byName(world, 'Selene');
    selene.resting = true;
    selene.energy = 5;
    selene.goal = { ...selene.goal, type: 'rest', label: 'Rest at the shelter' };

    const c = buildDialogueContext(world, selene);
    // Layer A is untouched by any of that.
    expect(c.npc.role).toBe('Survey Researcher');
    expect(c.npc.responsibility).toMatch(/map/i);
    // Layer C persists too.
    expect(c.priority!.goal).toMatch(/eastern Riverlands/i);
    // Layer B is the only thing that reports the sleeping.
    expect(c.doing.resting).toBe(true);
    expect(c.doing.activity).toMatch(/rest/i);
  });

  it('keeps the three layers in separate places, so none can overwrite another', () => {
    const world = createWorld(4203);
    const kael = byName(world, 'Kael');
    kael.goal = { ...kael.goal, type: 'eat', label: 'Find something to eat' };
    kael.hunger = 90;

    const c = buildDialogueContext(world, kael);
    expect(c.npc.role).toBe('Logistics');             // A — who he is
    expect(c.doing.activity).toBe('Find something to eat'); // B — right now
    expect(c.priority!.goal).toMatch(/count/i);        // C — what he cares about
    // Eating is not his responsibility, and being hungry did not become one.
    expect(c.npc.responsibility).not.toMatch(/eat/i);
    expect(c.priority!.goal).not.toMatch(/eat/i);
  });

  it('gives different specialists genuinely different context', () => {
    const world = createWorld(4204);
    const seen = new Set<string>();
    for (const s of humans(world)) {
      const c = buildDialogueContext(world, s);
      seen.add(`${c.npc.role}|${c.priority!.goal}|${c.priority!.problem}`);
    }
    // Twelve people, twelve different points of view.
    expect(seen.size).toBe(12);
  });
});

describe('what the model is told', () => {
  it('includes who they are, what they are doing, and what they care about', () => {
    const world = createWorld(4301);
    const selene = byName(world, 'Selene');
    const c = buildDialogueContext(world, selene);

    expect(c.npc.name).toBe('Selene');
    expect(c.npc.role).toBe('Survey Researcher');
    expect(c.npc.responsibility.length).toBeGreaterThan(10);
    expect(c.npc.expertise).toContain('surveying');
    expect(c.npc.values.length).toBeGreaterThan(0);
    expect(c.npc.outlook.length).toBeGreaterThan(10);
    expect(c.npc.personality).toEqual(['curious', 'methodical', 'cautious']);
    expect(c.priority!.goal.length).toBeGreaterThan(10);
    expect(c.priority!.problem.length).toBeGreaterThan(10);
    expect(c.priority!.aspiration.length).toBeGreaterThan(10);
    expect(c.doing.activity.length).toBeGreaterThan(3);
    expect(c.npc.location.length).toBeGreaterThan(0);
    expect(typeof c.relationship.firstMeeting).toBe('boolean');
  });

  it('is still small enough to send', () => {
    const world = createWorld(4302);
    run(world, 600);
    for (const s of humans(world)) {
      const bytes = JSON.stringify(buildDialogueContext(world, s)).length;
      expect(bytes, s.name).toBeLessThan(4000);
    }
  });

  it('never becomes omniscient, however much has happened', () => {
    const world = createWorld(4303);
    run(world, 1200);
    const selene = byName(world, 'Selene');
    const c = buildDialogueContext(world, selene);
    const text = JSON.stringify(c);

    // Not the world.
    expect(text).not.toContain('chronicle');
    expect(text).not.toContain('structures');
    expect(text).not.toContain('creatures');
    // Not other people's heads. The only activity reported is her own — note
    // that goal labels are not unique, so a label she happens to share with
    // someone else is not a leak, and is skipped.
    expect(c.doing.activity).toBe(selene.goal.label);
    for (const other of world.settlers) {
      if (other.id === selene.id || other.goal.label === selene.goal.label) continue;
      expect(text, other.name).not.toContain(other.goal.label);
    }
    // Not Creator Mode internals.
    expect(text).not.toMatch(/goalReason|scores|utility|personality":\s*\{/);
    // Not the player's pockets.
    expect(text).not.toContain('materials');
    expect(text).not.toContain('unlocks');
    expect(text).not.toContain('salvage');
  });

  it('does not leak another settler\'s private memory', () => {
    const world = createWorld(4304);
    const selene = byName(world, 'Selene');
    const kael = byName(world, 'Kael');
    remember(kael, {
      type: 'saw_emerson',
      subjectId: 'emerson',
      subjectName: 'Kai',
      emotionalWeight: 0.9,
      place: 'the Sunken Ring',
      t: world.timeSec,
    });

    const c = buildDialogueContext(world, selene);
    expect(JSON.stringify(c)).not.toContain('Sunken Ring');
    // And Kael, who actually formed it, does have it.
    expect(JSON.stringify(buildDialogueContext(world, kael))).toContain('Sunken Ring');
  });

  it('only mentions places this person has personally been', () => {
    const world = createWorld(4305);
    const selene = byName(world, 'Selene');
    selene.knownLandmarkIds = [];
    selene.knownResourceIds = [];
    const c = buildDialogueContext(world, selene);
    // Her authored expertise says she surveys. It does not grant her the map.
    expect(c.npc.expertise).toContain('surveying');
    expect(c.knows.length).toBeLessThanOrEqual(6);
  });

  it('does not know what Kai is carrying', () => {
    const world = createWorld(4306);
    world.player.materials.alloy = 99;
    world.player.unlocks.jetpack = true;
    const c = buildDialogueContext(world, byName(world, 'Asha'));
    const text = JSON.stringify(c);
    expect(text).not.toContain('99');
    expect(text).not.toContain('jetpack');
  });
});

describe('the local voice still works with all of this', () => {
  it('produces a sane line for every survivor', () => {
    const world = createWorld(4401);
    run(world, 300);
    for (const s of humans(world)) {
      const turn = localTurn(buildDialogueContext(world, s));
      expect(turn.npcLine.length, s.name).toBeGreaterThan(8);
      expect(turn.replies.length, s.name).toBeGreaterThanOrEqual(2);
      // The local voice does not recite a personnel file either.
      expect(turn.npcLine, s.name).not.toContain('Responsibility');
    }
  });
});

describe('the player learns who people are', () => {
  it('shows the posting on the identification card, not "Human settler"', () => {
    const world = createWorld(4501);
    const selene = byName(world, 'Selene');
    // Stand Kai in front of her and look straight at her.
    world.player.pos = { x: selene.pos.x, z: selene.pos.z - 3 };
    world.player.y = 0;
    const ident = identifyFocus(world, 0, 1);
    expect(ident).toBeTruthy();
    expect(ident!.name).toBe('SELENE');
    expect(ident!.line).toContain('Survey Researcher');
    // Species is still there, just no longer the only thing said.
    expect(ident!.line).toContain('Human');
    expect(ident!.line).not.toBe('Human settler');
  });

  it('does not put biography on the HUD', () => {
    const world = createWorld(4502);
    const kael = byName(world, 'Kael');
    world.player.pos = { x: kael.pos.x, z: kael.pos.z - 3 };
    world.player.y = 0;
    const ident = identifyFocus(world, 0, 1);
    expect(ident!.line.length).toBeLessThan(48);
    const identity = identityOf('Kael')!;
    expect(ident!.line).not.toContain(identity.goal);
    expect(ident!.line).not.toContain(identity.problem);
    expect(ident!.line).not.toContain(identity.aspiration);
  });
});

describe('a settler who is not a survivor', () => {
  it('still gets a working context with no authored priority', () => {
    const world = createWorld(4601);
    const veyra = world.settlers.find((s) => s.speciesId === 'veyra')!;
    const c = buildDialogueContext(world, veyra);
    expect(c.priority).toBeNull();
    expect(c.npc.responsibility).toBe('');
    // Their character still comes through, from the procedural traits.
    expect(c.npc.personality.length).toBeGreaterThan(0);
    const turn = localTurn(c);
    expect(turn.npcLine.length).toBeGreaterThan(8);
  });
});
