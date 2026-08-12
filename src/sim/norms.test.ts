import { describe, expect, it } from 'vitest';
import { NORM, SIM_DT } from './config';
import { bestRestShelter } from './goals';
import { inspectStructure, normTendencies, structureExpectationsOf } from './inspect';
import { noticeUse, resolveAsk } from './normEvents';
import {
  assessAccess,
  attitudeFor,
  claimantsOf,
  decidePermission,
  evaluateClaim,
  hasPermission,
  isViolation,
  peekAttitude,
} from './norms';
import { applyRelationship } from './relationships';
import { recordBelief } from './socialKnowledge';
import { initWorld } from './index';
import { simTick } from './simulation';
import { chooseBuildSite, createProject, recordUse } from './structures';
import { setTerrainSeed } from './terrain';
import { createWorld } from './worldgen';
import type { Settler, Structure, World } from './types';

/**
 * The v0.5 thesis: EXPECTATION BEFORE LAW.
 *
 * These prove that expectations about shared structures are agent-relative,
 * derived from real history and values, capable of genuine disagreement, and
 * able to shift — with no ownerId anywhere in the model.
 */

function run(world: World, simSeconds: number): void {
  const ticks = Math.ceil(simSeconds / SIM_DT);
  for (let i = 0; i < ticks; i++) {
    simTick(world, SIM_DT);
    if (world.ariQueue.length > 8) world.ariQueue.length = 0;
  }
}

const DAY = 720;

/** A finished shelter with a chosen distribution of effort. */
function makeShelter(
  world: World,
  initiator: Settler,
  helpers: { settler: Settler; wood: number; stone: number; work: number }[] = [],
): Structure {
  const site = chooseBuildSite(world, initiator, 'shelter')!;
  const st = createProject(world, initiator, 'shelter', site.pos, ['test shelter'], site.reason);
  st.contributions = [
    { id: initiator.id, name: initiator.name, wood: st.required.wood, stone: st.required.stone, work: 0.7 },
    ...helpers.map((h) => ({ id: h.settler.id, name: h.settler.name, wood: h.wood, stone: h.stone, work: h.work })),
  ];
  st.contributed = { wood: st.required.wood, stone: st.required.stone };
  st.progress = 1;
  st.state = 'complete';
  st.completedAt = world.timeSec;
  for (const s of [initiator, ...helpers.map((h) => h.settler)]) {
    if (!s.knownStructureIds.includes(st.id)) s.knownStructureIds.push(st.id);
  }
  return st;
}

describe('claims are agent-relative', () => {
  it('never stores an owner on the structure', () => {
    const world = createWorld(200);
    const st = makeShelter(world, world.settlers[0]);
    // The structure model must carry no notion of who owns it.
    expect(Object.keys(st)).not.toContain('ownerId');
    expect(Object.keys(st)).not.toContain('owner');
  });

  it('produces different truths about the same shelter (Scenario A)', () => {
    const world = createWorld(201);
    const [mira, june, kael] = world.settlers;
    // Mira initiates and works hardest; June contributes heavily; Kael does
    // nothing but holds strongly communal values.
    mira.values = { individualism: 0.9, territoriality: 0.85, conformity: 0.5 };
    mira.personality.empathy = 0.25;
    june.values = { individualism: 0.5, territoriality: 0.5, conformity: 0.5 };
    june.personality.empathy = 0.55;
    kael.values = { individualism: 0.05, territoriality: 0.05, conformity: 0.5 };
    kael.personality.empathy = 0.9;

    const st = makeShelter(world, mira, [{ settler: june, wood: 14, stone: 6, work: 0.45 }]);
    for (let i = 0; i < 7; i++) recordUse(world, st, mira);
    for (let i = 0; i < 5; i++) recordUse(world, st, june);
    for (let i = 0; i < 2; i++) recordUse(world, st, kael);
    kael.knownStructureIds.push(st.id);

    const cMira = evaluateClaim(world, mira, st);
    const cJune = evaluateClaim(world, june, st);
    const cKael = evaluateClaim(world, kael, st);

    expect(cMira.kind, 'the possessive initiator reads it as hers').toBe('personal');
    expect(cJune.kind, 'the heavy contributor reads it as shared').toBe('shared');
    expect(cKael.kind, 'the communalist reads it as everyone\'s').toBe('public');
    // Three simultaneous, contradictory, equally-stored interpretations.
    expect(new Set([cMira.kind, cJune.kind, cKael.kind]).size).toBe(3);
  });

  it('explains every claim from real history', () => {
    const world = createWorld(202);
    const [a, b] = world.settlers;
    const st = makeShelter(world, a, [{ settler: b, wood: 10, stone: 4, work: 0.3 }]);
    recordUse(world, st, a);
    const claim = evaluateClaim(world, a, st);
    const text = claim.factors.map((f) => f.label).join(' | ');
    expect(text).toMatch(/Initiated it/);
    expect(text).toMatch(/building effort/);
    for (const f of claim.factors) {
      expect(f.label).not.toContain('undefined');
      expect(f.label).not.toContain('NaN');
    }
  });

  it('lets values, not species, decide — identical histories diverge', () => {
    const world = createWorld(203);
    const [a, b] = world.settlers;
    expect(a.speciesId).toBe(b.speciesId); // same people
    a.values = { individualism: 0.95, territoriality: 0.95, conformity: 0.5 };
    b.values = { individualism: 0.05, territoriality: 0.05, conformity: 0.5 };
    a.personality.empathy = 0.5;
    b.personality.empathy = 0.5;

    const stA = makeShelter(world, a);
    const stB = makeShelter(world, b);
    for (let i = 0; i < 4; i++) {
      recordUse(world, stA, a);
      recordUse(world, stB, b);
    }
    // Same role, same effort, same species — opposite conclusions.
    expect(evaluateClaim(world, a, stA).kind).toBe('personal');
    expect(evaluateClaim(world, b, stB).kind).not.toBe('personal');
  });

  it('spreads values within every species rather than by species', () => {
    const world = createWorld(204);
    for (const speciesId of ['human', 'veyra', 'caelari'] as const) {
      const group = world.settlers.filter((s) => s.speciesId === speciesId);
      const values = group.map((s) => (s.values.individualism + s.values.territoriality) / 2);
      const spread = Math.max(...values) - Math.min(...values);
      expect(spread, `${speciesId} should contain a range of views`).toBeGreaterThan(0.25);
    }
  });

  it('treats campfires as more communal than shelters, all else equal', () => {
    const world = createWorld(205);
    // Veyra, so the pre-built colony hearth at Human Landing does not occupy
    // the only nearby campfire site.
    const s = world.settlers.find((x) => x.speciesId === 'veyra')!;
    s.values = { individualism: 0.5, territoriality: 0.5, conformity: 0.5 };
    const shelterSite = chooseBuildSite(world, s, 'shelter')!;
    const shelter = createProject(world, s, 'shelter', shelterSite.pos, ['t'], shelterSite.reason);
    const fireSite = chooseBuildSite(world, s, 'campfire')!;
    const fire = createProject(world, s, 'campfire', fireSite.pos, ['t'], fireSite.reason);
    for (const st of [shelter, fire]) {
      st.state = 'complete';
      st.progress = 1;
      st.contributions = [{ id: s.id, name: s.name, wood: 10, stone: 5, work: 1 }];
    }
    expect(evaluateClaim(world, s, shelter).exclusivity).toBeGreaterThan(
      evaluateClaim(world, s, fire).exclusivity,
    );
  });
});

describe('permission', () => {
  it('grants to a trusted friend and refuses a resented stranger (Scenario B)', () => {
    const world = createWorld(210);
    const [mira, june, kael] = world.settlers;
    mira.values = { individualism: 0.8, territoriality: 0.75, conformity: 0.5 };
    mira.personality.empathy = 0.6;
    const st = makeShelter(world, mira);
    for (let i = 0; i < 6; i++) recordUse(world, st, mira);
    expect(evaluateClaim(world, mira, st).kind).toBe('personal');

    applyRelationship(world, mira, june.id, june.name, 'gift', 'Fed me when I was starving', {
      affinity: 75,
      trust: 80,
      familiarity: 70,
    });
    applyRelationship(world, mira, kael.id, kael.name, 'conflict', 'Bad blood', {
      affinity: -70,
      trust: 0,
      fear: 10,
    });

    expect(decidePermission(world, mira, june, st, 50).outcome).toBe('allow');
    expect(decidePermission(world, mira, kael, st, 50).outcome).toBe('refuse');
  });

  it('records permission for both sides and eases future use', () => {
    const world = createWorld(211);
    const [mira, june] = world.settlers;
    mira.values = { individualism: 0.8, territoriality: 0.8, conformity: 0.5 };
    const st = makeShelter(world, mira);
    for (let i = 0; i < 6; i++) recordUse(world, st, mira);
    applyRelationship(world, mira, june.id, june.name, 'gift', 'Trusted', {
      affinity: 70,
      trust: 75,
      familiarity: 60,
    });
    june.knownStructureIds.push(st.id);

    const before = assessAccess(world, june, st, 40).modifier;
    const result = resolveAsk(world, june, mira, st);
    expect(result.outcome).not.toBe('refuse');
    expect(result.line.length).toBeGreaterThan(0);

    expect(hasPermission(june, st, mira.id)).toBe(true);
    expect(peekAttitude(mira, st.id)!.allowed).toContain(june.id);
    expect(june.memories.some((m) => m.type === 'received_permission')).toBe(true);
    expect(mira.memories.some((m) => m.type === 'granted_permission')).toBe(true);

    // Friction genuinely drops afterwards.
    expect(assessAccess(world, june, st, 40).modifier).toBeGreaterThan(before);
    expect(world.chronicle.some((e) => e.category === 'norm')).toBe(true);
  });

  it('remembers refusal and makes the place less inviting', () => {
    const world = createWorld(212);
    const [mira, kael] = world.settlers;
    mira.values = { individualism: 0.9, territoriality: 0.9, conformity: 0.5 };
    mira.personality.empathy = 0.1;
    const st = makeShelter(world, mira);
    for (let i = 0; i < 6; i++) recordUse(world, st, mira);
    kael.knownStructureIds.push(st.id);
    applyRelationship(world, mira, kael.id, kael.name, 'conflict', 'Dislike', { affinity: -60 });

    const before = assessAccess(world, kael, st, 30).modifier;
    const result = resolveAsk(world, kael, mira, st);
    expect(result.outcome).toBe('refuse');
    expect(peekAttitude(kael, st.id)!.refusedBy).toContain(mira.id);
    expect(kael.memories.some((m) => m.type === 'was_refused')).toBe(true);
    expect(assessAccess(world, kael, st, 30).modifier).toBeLessThan(before);
  });
});

describe('violation', () => {
  it('is not triggered by substantial co-builders', () => {
    const world = createWorld(220);
    const [mira, june] = world.settlers;
    mira.values = { individualism: 0.9, territoriality: 0.9, conformity: 0.5 };
    const st = makeShelter(world, mira, [{ settler: june, wood: 12, stone: 5, work: 0.4 }]);
    for (let i = 0; i < 6; i++) recordUse(world, st, mira);
    expect(isViolation(world, mira, june, st)).toBe(false);
  });

  it('is triggered by an uninvolved user of a personally-held shelter', () => {
    const world = createWorld(221);
    const [mira, , kael] = world.settlers;
    mira.values = { individualism: 0.95, territoriality: 0.95, conformity: 0.5 };
    mira.personality.empathy = 0.1;
    const st = makeShelter(world, mira);
    for (let i = 0; i < 8; i++) recordUse(world, st, mira);
    expect(evaluateClaim(world, mira, st).kind).toBe('personal');
    expect(isViolation(world, mira, kael, st)).toBe(true);
  });

  it('is cancelled by permission', () => {
    const world = createWorld(222);
    const [mira, , kael] = world.settlers;
    mira.values = { individualism: 0.95, territoriality: 0.95, conformity: 0.5 };
    const st = makeShelter(world, mira);
    for (let i = 0; i < 8; i++) recordUse(world, st, mira);
    attitudeFor(mira, st.id).allowed.push(kael.id);
    expect(isViolation(world, mira, kael, st)).toBe(false);
  });

  it('reacts differently to the same act depending on who did it (Scenario C)', () => {
    // Same intruder, same shelter, two claimants of opposite temperament.
    const build = (seed: number, empathy: number, aggression: number) => {
      const world = createWorld(seed);
      const [claimant, , intruder] = world.settlers;
      claimant.values = { individualism: 0.95, territoriality: 0.95, conformity: 0.5 };
      claimant.personality.empathy = empathy;
      claimant.personality.aggression = aggression;
      const st = makeShelter(world, claimant);
      for (let i = 0; i < 8; i++) recordUse(world, st, claimant);
      claimant.pos = { ...st.pos };
      intruder.pos = { ...st.pos };
      recordUse(world, st, intruder);
      noticeUse(world, intruder, st);
      return { world, claimant, intruder };
    };

    const harsh = build(223, 0.05, 0.95);
    const gentle = build(224, 0.95, 0.05);

    const harshRel = harsh.claimant.relationships[harsh.intruder.id];
    const gentleRel = gentle.claimant.relationships[gentle.intruder.id];
    // The harsh one takes offence; the gentle one lets it go entirely.
    expect(harshRel, 'an aggressive claimant should react').toBeDefined();
    expect(harshRel.affinity).toBeLessThan(0);
    expect(gentleRel, 'a forgiving claimant should not hold it against them').toBeUndefined();
    // Tolerating it is itself how the norm loosens.
    expect(peekAttitude(gentle.claimant, Object.keys(gentle.claimant.structureAttitudes)[0])!.sharedDrift)
      .toBeGreaterThan(0);
  });
});

describe('norms shift with history (Scenario D)', () => {
  it('softens a personal claim through repeated permitted use', () => {
    const world = createWorld(230);
    const [mira, june] = world.settlers;
    mira.values = { individualism: 0.78, territoriality: 0.72, conformity: 0.5 };
    mira.personality.empathy = 0.5;
    const st = makeShelter(world, mira);
    for (let i = 0; i < 6; i++) recordUse(world, st, mira);
    expect(evaluateClaim(world, mira, st).kind).toBe('personal');

    const att = attitudeFor(mira, st.id);
    att.allowed.push(june.id);
    // Peaceful shared use, over and over.
    for (let i = 0; i < 40; i++) {
      att.sharedDrift = Math.min(NORM.maxDrift, att.sharedDrift + NORM.sharedDriftPerPeacefulUse);
    }
    const after = evaluateClaim(world, mira, st);
    expect(after.kind, 'mine should become ours').not.toBe('personal');
    expect(after.factors.map((f) => f.label).join(' ')).toMatch(/shared it peacefully/);
  });

  it('hardens a claim when use is treated as intrusion', () => {
    const world = createWorld(231);
    const mira = world.settlers[0];
    mira.values = { individualism: 0.55, territoriality: 0.55, conformity: 0.5 };
    const st = makeShelter(world, mira);
    for (let i = 0; i < 5; i++) recordUse(world, st, mira);
    const before = evaluateClaim(world, mira, st).exclusivity;
    const att = attitudeFor(mira, st.id);
    for (let i = 0; i < 5; i++) att.grudge = Math.min(NORM.maxDrift, att.grudge + NORM.grudgePerViolation);
    expect(evaluateClaim(world, mira, st).exclusivity).toBeGreaterThan(before);
  });

  it('bounds how many stances a settler carries', () => {
    const world = createWorld(232);
    const s = world.settlers[0];
    for (let i = 0; i < NORM.maxAttitudes + 12; i++) attitudeFor(s, `fake_${i}`);
    expect(Object.keys(s.structureAttitudes).length).toBeLessThanOrEqual(NORM.maxAttitudes + 1);
  });
});

describe('use decisions weigh other people', () => {
  it('avoids a shelter a feared claimant holds, and says why', () => {
    const world = createWorld(240);
    const [mira, june] = world.settlers;
    mira.values = { individualism: 0.95, territoriality: 0.95, conformity: 0.5 };
    const st = makeShelter(world, mira);
    for (let i = 0; i < 8; i++) recordUse(world, st, mira);
    june.knownStructureIds.push(st.id);
    june.pos = { ...st.pos };
    // Since v0.6 a settler acts on what they have *learned*, not on the truth:
    // June has to have seen Mira behave like a claimant to weigh her claim.
    recordBelief(world, june, {
      about: { id: mira.id, name: mira.name },
      structureId: st.id,
      kind: 'personal',
      source: 'refused',
    });

    const neutral = assessAccess(world, june, st, 20);
    expect(neutral.blocker?.settler.id).toBe(mira.id);
    expect(neutral.reasons.join(' ')).toMatch(/Expects Mira to mind|Expects .* to mind/);

    applyRelationship(world, june, mira.id, mira.name, 'conflict', 'Terrifying', {
      affinity: -50,
      fear: 70,
    });
    const afraid = assessAccess(world, june, st, 20);
    expect(afraid.modifier).toBeLessThan(neutral.modifier);
    expect(afraid.reasons.join(' ')).toMatch(/Afraid/);
  });

  it('lets desperation outweigh someone else\'s expectation', () => {
    const world = createWorld(241);
    const [mira, june] = world.settlers;
    mira.values = { individualism: 0.9, territoriality: 0.9, conformity: 0.5 };
    const st = makeShelter(world, mira);
    for (let i = 0; i < 8; i++) recordUse(world, st, mira);
    june.knownStructureIds.push(st.id);
    const calm = assessAccess(world, june, st, 5).modifier;
    const desperate = assessAccess(world, june, st, 95).modifier;
    expect(desperate).toBeGreaterThan(calm);
    // And when desperate they stop bothering to ask.
    expect(assessAccess(world, june, st, 95).shouldAsk).toBe(false);
  });

  it('surfaces the social calculation in the rest decision', () => {
    const world = createWorld(242);
    const [mira, june] = world.settlers;
    mira.values = { individualism: 0.9, territoriality: 0.9, conformity: 0.5 };
    const st = makeShelter(world, mira);
    for (let i = 0; i < 8; i++) recordUse(world, st, mira);
    june.knownStructureIds.push(st.id);
    june.pos = { ...st.pos };
    june.energy = 20;
    const choice = bestRestShelter(world, june);
    expect(choice).not.toBeNull();
    expect(choice!.access.reasons.length).toBeGreaterThan(0);
  });
});

describe('inspection', () => {
  it('reports every claimant and marks genuine disagreement', () => {
    const world = createWorld(250);
    initWorld(world.seed); // register entity index for inspect()
    const w = createWorld(250);
    setTerrainSeed(w.seed);
    const [mira, june, kael] = w.settlers;
    mira.values = { individualism: 0.92, territoriality: 0.9, conformity: 0.5 };
    mira.personality.empathy = 0.2;
    kael.values = { individualism: 0.05, territoriality: 0.05, conformity: 0.5 };
    const st = makeShelter(w, mira, [{ settler: june, wood: 13, stone: 5, work: 0.4 }]);
    for (let i = 0; i < 7; i++) recordUse(w, st, mira);
    for (let i = 0; i < 4; i++) recordUse(w, st, june);
    recordUse(w, st, kael);

    const claimants = claimantsOf(w, st);
    expect(claimants.length).toBeGreaterThanOrEqual(3);
    expect(new Set(claimants.map((c) => c.claim.kind)).size).toBeGreaterThan(1);
    for (const c of claimants) {
      expect(c.claim.factors.length).toBeGreaterThan(0);
    }
  });

  it('lists a settler\'s structure expectations with reasons', () => {
    initWorld(260);
    const world = createWorld(260);
    setTerrainSeed(world.seed);
    const mira = world.settlers[0];
    const st = makeShelter(world, mira);
    recordUse(world, st, mira);
    // Uses the live singleton world, so drive that one instead.
    const live = initWorld(260);
    const liveMira = live.settlers[0];
    const liveSt = makeShelter(live, liveMira);
    for (let i = 0; i < 5; i++) recordUse(live, liveSt, liveMira);
    const list = structureExpectationsOf(liveMira.id);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].why.length).toBeGreaterThan(0);
    const detail = inspectStructure(liveSt.id)!;
    expect(detail.claimants.length).toBeGreaterThan(0);
    expect(typeof detail.contested).toBe('boolean');
  });

  it('aggregates tendencies descriptively without inventing culture', () => {
    const live = initWorld(261);
    run(live, DAY * 6);
    const tend = normTendencies();
    for (const t of tend) {
      expect(t.personal + t.shared + t.public).toBeGreaterThan(90);
      expect(t.personal + t.shared + t.public).toBeLessThan(110);
      expect(t.sample).toBeGreaterThan(0);
    }
  });
});

describe('the world produces norms on its own', () => {
  it('generates disagreement, permission and violation unguided', () => {
    const world = createWorld(9500);
    run(world, DAY * 11);

    const complete = world.structures.filter((s) => s.state === 'complete');
    expect(complete.length).toBeGreaterThan(0);

    // Contradictory readings of the same place.
    const contested = complete.filter((st) => new Set(claimantsOf(world, st).map((c) => c.claim.kind)).size > 1);
    expect(contested.length, 'settlers should disagree about some places').toBeGreaterThan(0);

    // Real negotiation happened.
    const norm = world.chronicle.filter((e) => e.category === 'norm');
    expect(norm.length, 'norm events should occur').toBeGreaterThan(0);
    for (const e of norm) {
      expect(e.text).not.toContain('undefined');
      expect(e.cause?.length ?? 0).toBeGreaterThan(0);
      expect(e.effects?.length ?? 0).toBeGreaterThan(0);
    }

    // Permission is actually exchanged and stored.
    let granted = 0;
    let refused = 0;
    for (const s of world.settlers) {
      for (const a of Object.values(s.structureAttitudes)) {
        granted += a.allowed.length;
        refused += a.refusedBy.length;
      }
    }
    expect(granted + refused, 'someone should have asked someone').toBeGreaterThan(0);

    // And nobody was harmed by the norm system.
    expect(world.settlers.length).toBe(21);
    for (const s of world.settlers) expect(s.health).toBeGreaterThan(40);
  });

  it('is deterministic for a given seed', () => {
    const a = createWorld(9501);
    const b = createWorld(9501);
    run(a, DAY * 4);
    run(b, DAY * 4);
    expect(a.chronicle.map((e) => e.text)).toEqual(b.chronicle.map((e) => e.text));
    const claims = (w: World) =>
      w.structures.flatMap((st) => claimantsOf(w, st).map((c) => `${c.settler.name}:${c.claim.kind}`));
    expect(claims(a)).toEqual(claims(b));
  });
});
