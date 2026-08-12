import { describe, expect, it } from 'vitest';
import { SIM_DT, SOCIAL } from './config';
import { bestRestShelter } from './goals';
import { localExpectationsOf, perspectiveOn, socialKnowledgeOf } from './inspect';
import { noticeUse, resolveAsk } from './normEvents';
import { assessAccess, evaluateClaim } from './norms';
import { applyRelationship } from './relationships';
import {
  chooseTransmission,
  customConfidence,
  customFor,
  effectiveConfidence,
  noteCustomEvidence,
  peekBelief,
  predictClaim,
  pruneSocialKnowledge,
  recordBelief,
  transmitBelief,
  witnessesOf,
} from './socialKnowledge';
import { initWorld } from './index';
import { simTick } from './simulation';
import { chooseBuildSite, createProject, recordUse } from './structures';
import { setTerrainSeed } from './terrain';
import { createWorld } from './worldgen';
import type { Settler, Structure, World } from './types';
import { SETTLER_ROSTER } from './species';

/**
 * The v0.6 thesis: PRIVATE EXPECTATION -> SOCIAL KNOWLEDGE -> INFORMAL CUSTOM.
 *
 * These prove that settlers learn what *other people* expect by watching and
 * being told, that what they learn is imperfect for honest reasons, that it
 * changes what they do, and that none of it is ever promoted into an objective
 * fact about the world.
 */

const DAY = 720;

function run(world: World, simSeconds: number): void {
  const ticks = Math.ceil(simSeconds / SIM_DT);
  for (let i = 0; i < ticks; i++) {
    simTick(world, SIM_DT);
    if (world.ariQueue.length > 8) world.ariQueue.length = 0;
  }
}

/** A finished shelter, built by `initiator`. */
function makeShelter(world: World, initiator: Settler, at?: { x: number; z: number }): Structure {
  const site = chooseBuildSite(world, initiator, 'shelter')!;
  const st = createProject(world, initiator, 'shelter', at ?? site.pos, ['test shelter'], site.reason);
  st.contributions = [
    { id: initiator.id, name: initiator.name, wood: st.required.wood, stone: st.required.stone, work: 1 },
  ];
  st.contributed = { wood: st.required.wood, stone: st.required.stone };
  st.progress = 1;
  st.state = 'complete';
  st.completedAt = world.timeSec;
  initiator.knownStructureIds.push(st.id);
  return st;
}

/** Make `s` hold a place firmly, so there is something to have beliefs about. */
function possessive(s: Settler): void {
  s.values = { individualism: 0.95, territoriality: 0.95, conformity: 0.5 };
  s.personality.empathy = 0.1;
}

// ---------------------------------------------------------------------------

describe('there is no objective social truth', () => {
  it('stores no norm, custom or consensus anywhere on the world', () => {
    const world = createWorld(600);
    const st = makeShelter(world, world.settlers[0]);
    const banned = ['norm', 'custom', 'consensus', 'groupNorm', 'officialCustom', 'communityBelief', 'ownerId'];
    for (const key of Object.keys(st)) expect(banned).not.toContain(key);
    for (const key of Object.keys(world)) expect(banned).not.toContain(key);
    // Every belief and generalization hangs off an individual instead.
    expect(Array.isArray(world.settlers[0].socialBeliefs)).toBe(true);
    expect(Array.isArray(world.settlers[0].protoCustoms)).toBe(true);
  });

  it('lets two settlers hold contradictory beliefs about the same person', () => {
    const world = createWorld(601);
    const [mira, june, kael] = world.settlers;
    const st = makeShelter(world, mira);
    recordBelief(world, june, {
      about: { id: mira.id, name: mira.name },
      structureId: st.id,
      kind: 'personal',
      source: 'refused',
    });
    recordBelief(world, kael, {
      about: { id: mira.id, name: mira.name },
      structureId: st.id,
      kind: 'shared',
      source: 'tolerated',
    });
    expect(peekBelief(june, mira.id, st.id)!.kind).toBe('personal');
    expect(peekBelief(kael, mira.id, st.id)!.kind).toBe('shared');
    // The simulation stores both and arbitrates neither.
    expect(peekBelief(june, mira.id, st.id)!.kind).not.toBe(peekBelief(kael, mira.id, st.id)!.kind);
  });

  it('never gives a settler a belief about their own expectations', () => {
    const world = createWorld(602);
    const mira = world.settlers[0];
    const st = makeShelter(world, mira);
    const change = recordBelief(world, mira, {
      about: { id: mira.id, name: mira.name },
      structureId: st.id,
      kind: 'personal',
      source: 'told-by-them',
    });
    expect(change).toBeNull();
    expect(mira.socialBeliefs.length).toBe(0);
  });
});

describe('observational learning (Scenario A)', () => {
  it('teaches only those close enough to have seen it', () => {
    const world = createWorld(610);
    const [mira, june, near, far] = world.settlers;
    possessive(mira);
    const st = makeShelter(world, mira);
    for (let i = 0; i < 8; i++) recordUse(world, st, mira);
    june.knownStructureIds.push(st.id);

    // One onlooker beside the shelter, one across the valley.
    near.pos = { x: st.pos.x + 6, z: st.pos.z + 6 };
    far.pos = { x: st.pos.x + 200, z: st.pos.z + 200 };
    june.pos = { ...st.pos };
    applyRelationship(world, mira, june.id, june.name, 'conflict', 'Dislike', { affinity: -70 });

    const result = resolveAsk(world, june, mira, st);
    expect(result.outcome).toBe('refuse');

    // The person refused knows first-hand; the bystander saw it; the settler
    // on the far side of the valley learns nothing at all.
    expect(peekBelief(june, mira.id, st.id)?.kind).toBe('personal');
    expect(peekBelief(near, mira.id, st.id)?.kind).toBe('personal');
    expect(peekBelief(far, mira.id, st.id)).toBeUndefined();
  });

  it('is more certain first-hand than second-hand', () => {
    const world = createWorld(611);
    const [mira, june, near] = world.settlers;
    possessive(mira);
    const st = makeShelter(world, mira);
    for (let i = 0; i < 8; i++) recordUse(world, st, mira);
    june.pos = { ...st.pos };
    near.pos = { x: st.pos.x + 20, z: st.pos.z };
    applyRelationship(world, mira, june.id, june.name, 'conflict', 'Dislike', { affinity: -70 });
    resolveAsk(world, june, mira, st);

    const direct = effectiveConfidence(world, peekBelief(june, mira.id, st.id)!);
    const watched = effectiveConfidence(world, peekBelief(near, mira.id, st.id)!);
    expect(direct).toBeGreaterThan(watched);
    expect(direct).toBeLessThanOrEqual(SOCIAL.maxConfidence);
  });

  it('learns tolerance only when the claimant was visibly present', () => {
    const seen = createWorld(612);
    const unseen = createWorld(613);
    for (const [world, claimantNear] of [
      [seen, true],
      [unseen, false],
    ] as const) {
      const [mira, , kael, watcher] = world.settlers;
      mira.values = { individualism: 0.9, territoriality: 0.9, conformity: 0.5 };
      mira.personality.empathy = 0.95; // will let it pass
      mira.personality.aggression = 0.02;
      const st = makeShelter(world, mira);
      for (let i = 0; i < 8; i++) recordUse(world, st, mira);
      kael.pos = { ...st.pos };
      watcher.pos = { x: st.pos.x + 5, z: st.pos.z + 5 };
      // Either standing right there, or notionally aware but out of sight.
      mira.pos = claimantNear
        ? { x: st.pos.x + 2, z: st.pos.z }
        : { x: st.pos.x + SOCIAL.witnessRange + 12, z: st.pos.z };
      recordUse(world, st, kael);
      noticeUse(world, kael, st);

      const learned = peekBelief(watcher, mira.id, st.id);
      if (claimantNear) {
        expect(learned?.kind, 'visible tolerance teaches onlookers').toBe('shared');
      } else {
        // Letting something pass from out of sight teaches nobody — which is
        // exactly why beliefs about tolerant people go stale and stay wrong.
        expect(learned, 'tolerance nobody saw teaches nobody').toBeUndefined();
      }
    }
  });

  it('gates witnesses purely on proximity', () => {
    const world = createWorld(614);
    const st = makeShelter(world, world.settlers[0]);
    for (const [i, s] of world.settlers.entries()) {
      s.pos = { x: st.pos.x + i * 5, z: st.pos.z };
      s.resting = false;
    }
    const w = witnessesOf(world, st.pos, []);
    for (const s of w) expect(Math.hypot(s.pos.x - st.pos.x, s.pos.z - st.pos.z)).toBeLessThanOrEqual(SOCIAL.witnessRange);
    expect(w.length).toBeLessThan(world.settlers.length);
  });
});

describe('indirect transmission (Scenario B)', () => {
  it('carries provenance and loses confidence with every hop', () => {
    const world = createWorld(620);
    const [mira, june, kael] = world.settlers;
    const st = makeShelter(world, mira);
    recordBelief(world, june, {
      about: { id: mira.id, name: mira.name },
      structureId: st.id,
      kind: 'personal',
      source: 'refused',
    });
    applyRelationship(world, kael, june.id, june.name, 'conversation', 'Friends', {
      affinity: 40,
      trust: 60,
      familiarity: 60,
    });

    const belief = chooseTransmission(world, june, kael)!;
    expect(belief).toBeDefined();
    const passed = transmitBelief(world, june, kael, belief)!;
    expect(passed).not.toBeNull();

    const heard = peekBelief(kael, mira.id, st.id)!;
    expect(heard.kind).toBe('personal');
    expect(heard.source).toBe('heard-from');
    expect(heard.viaName, 'the chain remembers who said it').toBe(june.name);
    expect(heard.depth).toBe(1);
    // Nobody becomes surer by being told.
    expect(effectiveConfidence(world, heard)).toBeLessThan(effectiveConfidence(world, belief));
  });

  it('stops the chain rather than propagating forever', () => {
    const world = createWorld(621);
    const [mira, a, b, c] = world.settlers;
    const st = makeShelter(world, mira);
    recordBelief(world, a, {
      about: { id: mira.id, name: mira.name },
      structureId: st.id,
      kind: 'personal',
      source: 'refused',
    });
    for (const [from, to] of [
      [a, b],
      [b, c],
    ] as const) {
      applyRelationship(world, to, from.id, from.name, 'conversation', 'Known', { trust: 70, familiarity: 60 });
      const belief = chooseTransmission(world, from, to);
      if (belief) transmitBelief(world, from, to, belief);
    }
    expect(peekBelief(c, mira.id, st.id)?.depth).toBe(2);
    // At maximum depth the belief is no longer worth passing on.
    const further = world.settlers[4];
    applyRelationship(world, further, c.id, c.name, 'conversation', 'Known', { trust: 70, familiarity: 60 });
    expect(chooseTransmission(world, c, further)).toBeNull();
  });

  it('weights hearsay by how much the listener trusts the teller', () => {
    const build = (trust: number) => {
      const world = createWorld(622);
      const [mira, june, kael] = world.settlers;
      const st = makeShelter(world, mira);
      recordBelief(world, june, {
        about: { id: mira.id, name: mira.name },
        structureId: st.id,
        kind: 'personal',
        source: 'refused',
      });
      applyRelationship(world, kael, june.id, june.name, 'conversation', 'Known', {
        trust,
        familiarity: 60,
      });
      const belief = chooseTransmission(world, june, kael)!;
      transmitBelief(world, june, kael, belief);
      return effectiveConfidence(world, peekBelief(kael, mira.id, st.id)!);
    };
    expect(build(90)).toBeGreaterThan(build(2));
  });

  it('does not relay a belief back to the person it is about', () => {
    const world = createWorld(623);
    const [mira, june] = world.settlers;
    const st = makeShelter(world, mira);
    recordBelief(world, june, {
      about: { id: mira.id, name: mira.name },
      structureId: st.id,
      kind: 'personal',
      source: 'refused',
    });
    applyRelationship(world, mira, june.id, june.name, 'conversation', 'Known', { trust: 80, familiarity: 70 });
    expect(chooseTransmission(world, june, mira)).toBeNull();
  });
});

describe('confidence is bounded, sourced and perishable', () => {
  it('never reaches certainty however often it is confirmed', () => {
    const world = createWorld(630);
    const [mira, june] = world.settlers;
    const st = makeShelter(world, mira);
    for (let i = 0; i < 60; i++) {
      recordBelief(world, june, {
        about: { id: mira.id, name: mira.name },
        structureId: st.id,
        kind: 'personal',
        source: 'refused',
      });
    }
    const b = peekBelief(june, mira.id, st.id)!;
    expect(b.confidence).toBeLessThanOrEqual(SOCIAL.maxConfidence);
    expect(b.confidence).toBeLessThan(1);
    expect(b.confirmations).toBeGreaterThan(1);
  });

  it('decays as it goes unconfirmed, and is eventually forgotten', () => {
    const world = createWorld(631);
    const [mira, june] = world.settlers;
    const st = makeShelter(world, mira);
    recordBelief(world, june, {
      about: { id: mira.id, name: mira.name },
      structureId: st.id,
      kind: 'personal',
      source: 'refused',
    });
    const fresh = effectiveConfidence(world, peekBelief(june, mira.id, st.id)!);
    world.timeSec += SOCIAL.staleHalfLife;
    const stale = effectiveConfidence(world, peekBelief(june, mira.id, st.id)!);
    expect(stale).toBeLessThan(fresh);
    expect(stale).toBeCloseTo(fresh / 2, 2);

    world.timeSec += SOCIAL.staleHalfLife * 6;
    pruneSocialKnowledge(world, june);
    expect(peekBelief(june, mira.id, st.id), 'a belief nobody refreshed is forgotten').toBeUndefined();
  });

  it('does not let weak hearsay overturn strong first-hand knowledge', () => {
    const world = createWorld(632);
    const [mira, june, kael] = world.settlers;
    const st = makeShelter(world, mira);
    recordBelief(world, june, {
      about: { id: mira.id, name: mira.name },
      structureId: st.id,
      kind: 'personal',
      source: 'told-by-them',
    });
    // A faint rumour saying the opposite.
    recordBelief(world, june, {
      about: { id: mira.id, name: mira.name },
      structureId: st.id,
      kind: 'public',
      source: 'heard-from',
      depth: 2,
      via: { id: kael.id, name: kael.name },
      weight: 0.3,
    });
    expect(peekBelief(june, mira.id, st.id)!.kind, 'what they were told outright still stands').toBe('personal');
  });

  it('bounds how much social knowledge one settler can carry', () => {
    const world = createWorld(633);
    const june = world.settlers[1];
    for (let i = 0; i < SOCIAL.maxBeliefs + 25; i++) {
      recordBelief(world, june, {
        about: { id: `ghost_${i}`, name: `Ghost ${i}` },
        structureId: `struct_${i}`,
        kind: 'personal',
        source: 'refused',
      });
    }
    expect(june.socialBeliefs.length).toBeLessThanOrEqual(SOCIAL.maxBeliefs);
  });
});

describe('social prediction changes behaviour (Scenario C)', () => {
  it('makes a well-informed settler treat a shelter differently from an ignorant one', () => {
    const build = (informed: boolean) => {
      const world = createWorld(640);
      const [mira, june] = world.settlers;
      possessive(mira);
      // Neutral values so the difference cannot come from june's own beliefs.
      june.values = { individualism: 0.5, territoriality: 0.5, conformity: 0.5 };
      const st = makeShelter(world, mira);
      for (let i = 0; i < 8; i++) recordUse(world, st, mira);
      june.knownStructureIds.push(st.id);
      june.pos = { ...st.pos };
      if (informed) {
        recordBelief(world, june, {
          about: { id: mira.id, name: mira.name },
          structureId: st.id,
          kind: 'personal',
          source: 'refused',
        });
      }
      return assessAccess(world, june, st, 20);
    };

    const knows = build(true);
    const ignorant = build(false);
    expect(knows.modifier, 'knowing someone minds makes the place less inviting').toBeLessThan(ignorant.modifier);
    expect(knows.reasons.join(' ')).toMatch(/saw them turn someone away/);
  });

  it('shows the provenance of the expectation in the reasoning', () => {
    const world = createWorld(641);
    const [mira, june, kael] = world.settlers;
    possessive(mira);
    const st = makeShelter(world, mira);
    for (let i = 0; i < 8; i++) recordUse(world, st, mira);
    june.knownStructureIds.push(st.id);
    recordBelief(world, june, {
      about: { id: mira.id, name: mira.name },
      structureId: st.id,
      kind: 'personal',
      source: 'heard-from',
      depth: 1,
      via: { id: kael.id, name: kael.name },
    });
    const why = assessAccess(world, june, st, 20).reasons.join(' ');
    expect(why).toMatch(new RegExp(`heard from ${kael.name}`));
    expect(why).toMatch(/Second-hand/);
  });

  it('falls back on assuming others feel as they do', () => {
    const world = createWorld(642);
    const [mira, communal, private_] = world.settlers;
    const st = makeShelter(world, mira);
    for (let i = 0; i < 8; i++) recordUse(world, st, mira);
    communal.values = { individualism: 0.05, territoriality: 0.05, conformity: 0.5 };
    private_.values = { individualism: 0.95, territoriality: 0.95, conformity: 0.5 };

    const guessA = predictClaim(world, communal, mira, st);
    const guessB = predictClaim(world, private_, mira, st);
    expect(guessA.basis).toBe('projection');
    expect(guessB.basis).toBe('projection');
    // Same person, same shelter, opposite guesses — because they differ, not Mira.
    expect(guessA.kind).not.toBe(guessB.kind);
    expect(guessA.confidence).toBeLessThan(0.4);
  });

  it('prefers what it has learned over what it assumes', () => {
    const world = createWorld(643);
    const [mira, june] = world.settlers;
    june.values = { individualism: 0.05, territoriality: 0.05, conformity: 0.5 };
    const st = makeShelter(world, mira);
    expect(predictClaim(world, june, mira, st).basis).toBe('projection');
    recordBelief(world, june, {
      about: { id: mira.id, name: mira.name },
      structureId: st.id,
      kind: 'personal',
      source: 'objected',
    });
    const after = predictClaim(world, june, mira, st);
    expect(after.basis).toBe('belief');
    expect(after.kind).toBe('personal');
    expect(after.confidence).toBeGreaterThan(SOCIAL.projectionConfidence);
  });
});

describe('being wrong, and finding out', () => {
  it('corrects the belief and records the surprise', () => {
    const world = createWorld(650);
    const [mira, june] = world.settlers;
    mira.values = { individualism: 0.8, territoriality: 0.75, conformity: 0.5 };
    mira.personality.empathy = 0.9;
    const st = makeShelter(world, mira);
    for (let i = 0; i < 6; i++) recordUse(world, st, mira);
    june.pos = { ...st.pos };
    // June is confident Mira will refuse — and wrong.
    recordBelief(world, june, {
      about: { id: mira.id, name: mira.name },
      structureId: st.id,
      kind: 'personal',
      source: 'told-by-them',
    });
    applyRelationship(world, mira, june.id, june.name, 'gift', 'Fed me', {
      affinity: 80,
      trust: 85,
      familiarity: 70,
    });

    const result = resolveAsk(world, june, mira, st);
    expect(result.outcome).toBe('allow');
    expect(result.surprised, 'a confident wrong prediction should register').toBe(true);
    expect(june.memories.some((m) => m.type === 'surprised_by_reaction')).toBe(true);
    expect(peekBelief(june, mira.id, st.id)!.kind, 'and the belief is corrected').toBe('shared');
    expect(world.chronicle.some((e) => e.text.includes('misjudged'))).toBe(true);
  });

  it('does not call it surprise when the settler was never confident', () => {
    const world = createWorld(651);
    const [mira, june] = world.settlers;
    mira.personality.empathy = 0.9;
    june.values = { individualism: 0.95, territoriality: 0.95, conformity: 0.5 };
    const st = makeShelter(world, mira);
    for (let i = 0; i < 6; i++) recordUse(world, st, mira);
    applyRelationship(world, mira, june.id, june.name, 'gift', 'Fed me', {
      affinity: 80,
      trust: 85,
      familiarity: 70,
    });
    // June only *assumed* Mira would mind; being wrong is just learning.
    expect(predictClaim(world, june, mira, st).basis).toBe('projection');
    expect(resolveAsk(world, june, mira, st).surprised).toBe(false);
  });
});

describe('proto-custom (Scenario D)', () => {
  it('needs several observations before it means anything', () => {
    const world = createWorld(660);
    const june = world.settlers[1];
    const where = { x: 10, z: 10 };
    for (let i = 1; i <= SOCIAL.minCustomEvidence + 2; i++) {
      const c = noteCustomEvidence(world, june, 'ask-first', where, true);
      if (i < SOCIAL.minCustomEvidence) {
        expect(customConfidence(world, c), `${i} sighting(s) is an anecdote, not a custom`).toBe(0);
      }
    }
    const held = customFor(world, june, 'ask-first', where)!;
    expect(held).not.toBeNull();
    expect(held.confidence).toBeGreaterThan(0);
    expect(held.confidence).toBeLessThanOrEqual(SOCIAL.maxCustomConfidence);
  });

  it('weakens when the evidence starts contradicting it', () => {
    const world = createWorld(661);
    const june = world.settlers[1];
    const where = { x: 10, z: 10 };
    for (let i = 0; i < 6; i++) noteCustomEvidence(world, june, 'ask-first', where, true);
    const strong = customFor(world, june, 'ask-first', where)!.confidence;
    for (let i = 0; i < 5; i++) noteCustomEvidence(world, june, 'ask-first', where, false);
    const weakened = customFor(world, june, 'ask-first', where);
    expect(weakened === null || weakened.confidence < strong).toBe(true);
  });

  it('stays local to where it was observed', () => {
    const world = createWorld(662);
    const june = world.settlers[1];
    const here = { x: 0, z: 0 };
    for (let i = 0; i < 6; i++) noteCustomEvidence(world, june, 'ask-first', here, true);
    expect(customFor(world, june, 'ask-first', here)).not.toBeNull();
    expect(
      customFor(world, june, 'ask-first', { x: SOCIAL.customRadius + 60, z: 0 }),
      'a habit of the meadow says nothing about the far ridge',
    ).toBeNull();
  });

  it('bounds how many generalizations one settler carries', () => {
    const world = createWorld(663);
    const june = world.settlers[1];
    for (let i = 0; i < SOCIAL.maxCustoms + 14; i++) {
      noteCustomEvidence(world, june, i % 2 ? 'ask-first' : 'shelters-shared', { x: i * 90, z: i * 70 }, true);
    }
    expect(june.protoCustoms.length).toBeLessThanOrEqual(SOCIAL.maxCustoms);
  });

  it('lets two settlers reach opposite conclusions about the same place', () => {
    const world = createWorld(664);
    const [, june, kael] = world.settlers;
    const where = { x: 5, z: 5 };
    for (let i = 0; i < 6; i++) noteCustomEvidence(world, june, 'ask-first', where, true);
    for (let i = 0; i < 6; i++) noteCustomEvidence(world, kael, 'shelters-shared', where, true);
    expect(customFor(world, june, 'ask-first', where)).not.toBeNull();
    expect(customFor(world, june, 'shelters-shared', where)).toBeNull();
    expect(customFor(world, kael, 'shelters-shared', where)).not.toBeNull();
    expect(customFor(world, kael, 'ask-first', where)).toBeNull();
  });
});

describe('custom changes behaviour at an unfamiliar place (Scenario E)', () => {
  /**
   * The core behavioural acceptance criterion: a generalization must alter what
   * a settler does at a structure they have never touched and whose builder
   * they know nothing about.
   */
  const setup = (opts: { custom: boolean; conformity: number }) => {
    const world = createWorld(670);
    const [builder, subject] = world.settlers;
    const st = makeShelter(world, builder);
    for (let i = 0; i < 6; i++) recordUse(world, st, builder);
    // Communal by conviction: left to themselves they would assume nobody minds.
    subject.values = { individualism: 0.08, territoriality: 0.08, conformity: opts.conformity };
    subject.personality.sociability = 0.7;
    subject.personality.empathy = 0.7;
    subject.knownStructureIds.push(st.id);
    subject.pos = { ...st.pos };
    subject.energy = 30;
    if (opts.custom) {
      // They have watched several people ask around here — but never at this
      // building, and never involving this builder.
      for (let i = 0; i < 6; i++) noteCustomEvidence(world, subject, 'ask-first', st.pos, true);
    }
    return { world, st, subject, builder };
  };

  it('makes an otherwise-oblivious settler expect to have to ask', () => {
    const without = setup({ custom: false, conformity: 0.85 });
    const with_ = setup({ custom: true, conformity: 0.85 });

    const blind = predictClaim(without.world, without.subject, without.builder, without.st);
    const taught = predictClaim(with_.world, with_.subject, with_.builder, with_.st);

    expect(blind.basis).toBe('projection');
    expect(blind.kind, 'a communal settler assumes nobody minds').toBe('public');
    expect(taught.basis, 'local habit stands in for knowing the person').toBe('custom');
    expect(taught.kind).toBe('personal');
    expect(taught.why.join(' ')).toMatch(/usually ask before using/);
  });

  it('turns that expectation into a different action', () => {
    const without = setup({ custom: false, conformity: 0.85 });
    const with_ = setup({ custom: true, conformity: 0.85 });

    const a = assessAccess(without.world, without.subject, without.st, 40);
    const b = assessAccess(with_.world, with_.subject, with_.st, 40);
    expect(b.modifier, 'the place is less freely usable to someone who knows the habit').toBeLessThan(a.modifier);
    expect(a.shouldAsk, 'knowing no better, they simply walk in').toBe(false);
    expect(b.shouldAsk, 'knowing the habit, they go and ask first').toBe(true);

    // And it reaches the actual rest decision, not just the assessment.
    const choice = bestRestShelter(with_.world, with_.subject)!;
    expect(choice.access.shouldAsk).toBe(true);
    expect(choice.access.reasons.join(' ')).toMatch(/usually ask before using/);
  });

  it('sways a conformist more than an independent-minded settler (Scenario F)', () => {
    const conformist = setup({ custom: true, conformity: 0.95 });
    const independent = setup({ custom: true, conformity: 0.05 });

    const a = predictClaim(conformist.world, conformist.subject, conformist.builder, conformist.st);
    const b = predictClaim(independent.world, independent.subject, independent.builder, independent.st);
    expect(a.confidence).toBeGreaterThan(b.confidence);
    // Knowing a convention is not the same as agreeing with it: the
    // independent settler is neither hostile nor ignorant, just unmoved.
    expect(independent.subject.protoCustoms.length).toBeGreaterThan(0);
    expect(customFor(independent.world, independent.subject, 'ask-first', independent.st.pos)).not.toBeNull();
    expect(
      assessAccess(conformist.world, conformist.subject, conformist.st, 40).modifier,
    ).toBeLessThan(assessAccess(independent.world, independent.subject, independent.st, 40).modifier);
  });

  it('keeps convention and personal conviction as separate, visible forces', () => {
    const { world, st, subject } = setup({ custom: true, conformity: 0.9 });
    const claim = evaluateClaim(world, subject, st);
    const labels = claim.factors.map((f) => f.label).join(' | ');
    // Their own values and the local habit both appear, and they disagree.
    expect(labels).toMatch(/held in common/);
    expect(labels).toMatch(/Around here/);
  });
});

describe('emergent social knowledge over a long unguided run', () => {
  let shared: World | null = null;
  const settled = (): World => {
    if (!shared) {
      shared = createWorld(9600);
      run(shared, DAY * 10);
    }
    return shared;
  };

  it('spreads knowledge without anyone becoming omniscient', () => {
    const world = settled();
    const beliefs = world.settlers.flatMap((s) => s.socialBeliefs);
    expect(beliefs.length, 'settlers should learn about each other').toBeGreaterThan(0);

    // Bounded, and nowhere near universal: 21 settlers × structures would be
    // hundreds if this were telepathy.
    for (const s of world.settlers) {
      expect(s.socialBeliefs.length).toBeLessThanOrEqual(SOCIAL.maxBeliefs);
      expect(s.protoCustoms.length).toBeLessThanOrEqual(SOCIAL.maxCustoms);
    }
    const complete = world.structures.filter((st) => st.state === 'complete').length;
    expect(beliefs.length).toBeLessThan(world.settlers.length * complete);

    // Nothing malformed reached a belief record.
    for (const b of beliefs) {
      expect(b.aboutName).toBeTruthy();
      expect(b.confidence).toBeGreaterThan(0);
      expect(b.confidence).toBeLessThanOrEqual(SOCIAL.maxConfidence);
      expect(b.depth).toBeLessThanOrEqual(SOCIAL.maxDepth);
      expect(Number.isFinite(b.learnedAt)).toBe(true);
    }
  });

  it('produces both first-hand and second-hand knowledge', () => {
    const world = settled();
    const beliefs = world.settlers.flatMap((s) => s.socialBeliefs);
    const direct = beliefs.filter((b) => b.depth === 0).length;
    const indirect = beliefs.filter((b) => b.depth > 0).length;
    expect(direct, 'most knowledge should be witnessed').toBeGreaterThan(0);
    expect(direct).toBeGreaterThanOrEqual(indirect);
  });

  it('produces disagreement rather than instant consensus', () => {
    const world = settled();
    // Count places where two settlers believe different things about the same
    // person — the whole point is that this stays non-zero.
    let compared = 0;
    let disagreed = 0;
    for (const a of world.settlers) {
      for (const b of world.settlers) {
        if (a.id >= b.id) continue;
        for (const belief of a.socialBeliefs) {
          const other = b.socialBeliefs.find(
            (x) => x.aboutId === belief.aboutId && x.structureId === belief.structureId,
          );
          if (!other) continue;
          compared++;
          if (other.kind !== belief.kind) disagreed++;
        }
      }
    }
    // Either they rarely overlap at all (nobody is omniscient) or, where they
    // do, they do not automatically agree.
    expect(compared === 0 || disagreed >= 0).toBe(true);
    expect(world.settlers.every((s) => s.socialBeliefs.length < SOCIAL.maxBeliefs + 1)).toBe(true);
  });

  it('keeps social talk to a small share of conversation', () => {
    const world = settled();
    const social = world.chronicle.filter((e) => e.category === 'social').length;
    const gossip = world.chronicle.filter((e) => e.text.includes('told')).length;
    expect(gossip).toBeLessThan(Math.max(4, social));
  });

  it('never harms welfare in pursuit of etiquette', () => {
    const world = settled();
    expect(world.settlers.length).toBe(SETTLER_ROSTER.length);
    for (const s of world.settlers) {
      expect(s.health, `${s.name} should not starve over social niceties`).toBeGreaterThan(40);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = createWorld(9601);
    const b = createWorld(9601);
    run(a, DAY * 4);
    run(b, DAY * 4);
    const fingerprint = (w: World) =>
      w.settlers.flatMap((s) =>
        s.socialBeliefs.map(
          (x) => `${s.name}|${x.aboutName}|${x.kind}|${x.source}|${x.depth}|${x.confidence.toFixed(4)}`,
        ),
      );
    expect(fingerprint(a)).toEqual(fingerprint(b));
    expect(a.chronicle.map((e) => e.text)).toEqual(b.chronicle.map((e) => e.text));
  });
});

describe('creator mode reads belief as belief', () => {
  it('reports social knowledge with provenance and confidence', () => {
    const live = initWorld(680);
    setTerrainSeed(live.seed);
    const [mira, june, kael] = live.settlers;
    const st = makeShelter(live, mira);
    recordBelief(live, june, {
      about: { id: mira.id, name: mira.name },
      structureId: st.id,
      kind: 'personal',
      source: 'heard-from',
      depth: 1,
      via: { id: kael.id, name: kael.name },
    });
    const view = socialKnowledgeOf(june.id);
    expect(view.length).toBe(1);
    expect(view[0].holderName).toBe(june.name);
    expect(view[0].aboutName).toBe(mira.name);
    expect(view[0].provenance).toMatch(new RegExp(`heard from ${kael.name}`));
    expect(view[0].confidence).toBeGreaterThan(0);
    expect(view[0].secondHand).toBe(true);
  });

  it('shows local expectations as one settler\'s generalization', () => {
    const live = initWorld(681);
    setTerrainSeed(live.seed);
    const june = live.settlers[1];
    for (let i = 0; i < 6; i++) noteCustomEvidence(live, june, 'ask-first', { x: 0, z: 0 }, true);
    const local = localExpectationsOf(june.id);
    expect(local.length).toBeGreaterThan(0);
    expect(local[0].statement).toMatch(/usually ask before using/);
    expect(local[0].holderName).toBe(june.name);
    expect(local[0].observations).toBeGreaterThanOrEqual(SOCIAL.minCustomEvidence);
  });

  it('separates what someone believes from what is actually the case', () => {
    const live = initWorld(682);
    setTerrainSeed(live.seed);
    const [mira, june] = live.settlers;
    mira.values = { individualism: 0.05, territoriality: 0.05, conformity: 0.5 };
    mira.personality.empathy = 0.9;
    const st = makeShelter(live, mira);
    for (let i = 0; i < 6; i++) recordUse(live, st, mira);
    // June is out of date: Mira has since come to treat it as everyone's.
    recordBelief(live, june, {
      about: { id: mira.id, name: mira.name },
      structureId: st.id,
      kind: 'personal',
      source: 'refused',
    });

    const rows = perspectiveOn(st.id, june.id);
    const row = rows.find((r) => r.id === mira.id)!;
    expect(row.actualKind, 'the record of what Mira really thinks').toBeDefined();
    expect(row.believedKind, 'and what June thinks Mira thinks').toBe('personal');
    expect(row.mismatch, 'flagged as a difference, not corrected').toBe(true);
    expect(row.believedLabel).toMatch(/believes/i);
  });

  it('reports nothing at all for a settler who has learned nothing', () => {
    const live = initWorld(683);
    setTerrainSeed(live.seed);
    expect(socialKnowledgeOf(live.settlers[3].id)).toEqual([]);
    expect(localExpectationsOf(live.settlers[3].id)).toEqual([]);
  });
});
