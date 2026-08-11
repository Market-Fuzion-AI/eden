import { describe, expect, it } from 'vitest';
import { REL, SIM_DT } from './config';
import { creatorSetYield } from './creator';
import { rankSocialCandidates } from './goals';
import {
  applyRelationship,
  avoidanceOf,
  emptyRelationship,
  relationshipState,
  socialModifiers,
  sumModifiers,
} from './relationships';
import { simTick } from './simulation';
import { createWorld } from './worldgen';
import type { Settler, World } from './types';

/**
 * The v0.3 thesis: YESTERDAY MUST CHANGE TOMORROW.
 *
 * These tests exist to prove that recorded history actually redirects future
 * autonomous choices — not merely that relationship numbers move.
 */

function run(world: World, simSeconds: number): void {
  const ticks = Math.ceil(simSeconds / SIM_DT);
  for (let i = 0; i < ticks; i++) {
    simTick(world, SIM_DT);
    if (world.ariQueue.length > 8) world.ariQueue.length = 0;
  }
}

/**
 * Push a relationship's history into the past.
 *
 * The re-engagement cooldown deliberately stops settlers from immediately
 * re-approaching someone they just spoke to, so shared history has to be
 * *yesterday* for it to shape today's choices — which is the whole point.
 */
function backdate(s: Settler, otherId: string, seconds = 600): void {
  const rel = s.relationships[otherId];
  rel.lastInteractionAt -= seconds;
  for (const h of rel.history) h.t -= seconds;
}

/** Place two settlers side by side, isolated from everyone else. */
function isolatePair(world: World): [Settler, Settler] {
  const [a, b] = world.settlers;
  a.pos = { x: 0, z: 0 };
  b.pos = { x: 3, z: 0 };
  for (let i = 2; i < world.settlers.length; i++) {
    const s = world.settlers[i];
    s.pos = { x: -140 + i * 2, z: 140 };
  }
  return [a, b];
}

describe('relationship model', () => {
  it('derives readable states from the four dimensions', () => {
    const rel = emptyRelationship(0);
    expect(relationshipState(rel)).toBe('Neutral');

    rel.familiarity = 40;
    expect(relationshipState(rel)).toBe('Familiar');

    rel.affinity = 40;
    rel.trust = 30;
    expect(relationshipState(rel)).toBe('Friendly');

    rel.affinity = 70;
    rel.trust = 60;
    rel.familiarity = 60;
    expect(relationshipState(rel)).toBe('Bonded');

    rel.affinity = -20;
    expect(relationshipState(rel)).toBe('Wary');

    rel.affinity = -60;
    expect(relationshipState(rel)).toBe('Hostile');

    // Fear alone is enough to make someone hostile in the eyes of the afraid.
    const scared = emptyRelationship(0);
    scared.affinity = 40;
    scared.fear = 70;
    expect(relationshipState(scared)).toBe('Hostile');
  });

  it('records a history entry for every change', () => {
    const world = createWorld(1);
    const [a, b] = world.settlers;
    applyRelationship(world, a, b.id, b.name, 'meeting', 'First conversation', { affinity: 5, familiarity: 14 });
    applyRelationship(world, a, b.id, b.name, 'gift', 'Shared food', { affinity: 7, trust: 16 });

    const rel = a.relationships[b.id];
    expect(rel.history).toHaveLength(2);
    expect(rel.history[0].text).toBe('First conversation');
    expect(rel.history[1].delta.trust).toBe(16);
    expect(rel.trust).toBe(16);
    expect(rel.affinity).toBe(12);
  });

  it('bounds history length', () => {
    const world = createWorld(2);
    const [a, b] = world.settlers;
    for (let i = 0; i < REL.maxHistory + 20; i++) {
      applyRelationship(world, a, b.id, b.name, 'conversation', `Talk ${i}`, { affinity: 1 });
    }
    expect(a.relationships[b.id].history.length).toBe(REL.maxHistory);
    // The oldest entries are the ones dropped.
    expect(a.relationships[b.id].history[0].text).not.toBe('Talk 0');
  });

  it('only creates records when an interaction actually happens', () => {
    const world = createWorld(3);
    run(world, 30);
    for (const s of world.settlers) {
      for (const [otherId, rel] of Object.entries(s.relationships)) {
        expect(rel.interactions, `${s.name} → ${otherId}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('relationships steer future goal selection', () => {
  it('ranks a trusted friend above a nearer stranger', () => {
    const world = createWorld(11);
    const [subject, friend] = world.settlers;
    const stranger = world.settlers[2];

    // The friend is far; the stranger is right next to them.
    subject.pos = { x: 0, z: 0 };
    stranger.pos = { x: 4, z: 0 };
    friend.pos = { x: 34, z: 0 };
    for (let i = 3; i < world.settlers.length; i++) world.settlers[i].pos = { x: -150, z: 150 };
    subject.needs.social = 90;

    // Before any history, proximity wins.
    const before = rankSocialCandidates(world, subject);
    expect(before[0].other.id).toBe(stranger.id);

    // Give the distant one a real history of good interactions.
    applyRelationship(world, subject, friend.id, friend.name, 'meeting', 'First conversation', {
      affinity: 30,
      trust: 20,
      familiarity: 40,
    });
    applyRelationship(world, subject, friend.id, friend.name, 'gift', 'Shared food when scarce', {
      affinity: 35,
      trust: 40,
      familiarity: 20,
    });
    backdate(subject, friend.id);

    const after = rankSocialCandidates(world, subject);
    expect(after[0].other.id, 'the friend should now outrank the nearer stranger').toBe(friend.id);
    // And the reason must say why.
    const labels = after[0].mods.map((m) => m.label).join(' | ');
    expect(labels).toMatch(/Trusted friend|Bonded companion/);
  });

  it('excludes someone feared from voluntary company', () => {
    const world = createWorld(12);
    const [subject, feared] = world.settlers;
    subject.pos = { x: 0, z: 0 };
    feared.pos = { x: 3, z: 0 };
    for (let i = 2; i < world.settlers.length; i++) world.settlers[i].pos = { x: -150, z: 150 };
    subject.needs.social = 95;
    subject.personality.caution = 0.8;

    expect(rankSocialCandidates(world, subject).some((c) => c.other.id === feared.id)).toBe(true);

    applyRelationship(world, subject, feared.id, feared.name, 'conflict', 'They shouted me down', {
      affinity: -40,
      fear: 60,
    });

    const after = rankSocialCandidates(world, subject);
    expect(after.some((c) => c.other.id === feared.id), 'must not choose to approach someone feared').toBe(false);
    expect(avoidanceOf(world, subject, feared)).toBeGreaterThan(25);
  });

  it('makes cautious settlers avoid more readily than aggressive ones', () => {
    const world = createWorld(13);
    const [cautious, target] = world.settlers;
    const bold = world.settlers[2];
    cautious.personality.caution = 0.9;
    cautious.personality.aggression = 0.1;
    bold.personality.caution = 0.1;
    bold.personality.aggression = 0.9;

    for (const s of [cautious, bold]) {
      applyRelationship(world, s, target.id, target.name, 'conflict', 'Bad blood', { affinity: -50, fear: 30 });
    }
    expect(avoidanceOf(world, cautious, target)).toBeGreaterThan(avoidanceOf(world, bold, target));
  });

  it('surfaces the deciding modifiers in the goal reasoning', () => {
    const world = createWorld(14);
    const [subject, friend] = world.settlers;
    subject.pos = { x: 0, z: 0 };
    friend.pos = { x: 5, z: 0 };
    for (let i = 2; i < world.settlers.length; i++) world.settlers[i].pos = { x: -150, z: 150 };
    applyRelationship(world, subject, friend.id, friend.name, 'meeting', 'Good talks', {
      affinity: 62,
      trust: 45,
      familiarity: 50,
    });
    const mods = socialModifiers(world, subject, friend);
    expect(sumModifiers(mods)).toBeGreaterThan(0);
    const text = mods.map((m) => m.label).join(' | ');
    expect(text).toMatch(/Affinity/);
    expect(text).toMatch(/Trusts them|Trusted friend|Bonded companion/);
  });
});

describe('friend-seeking', () => {
  it('will cross the valley for a bonded companion, but not for a stranger', () => {
    const world = createWorld(21);
    const [subject, friend] = world.settlers;
    subject.pos = { x: 0, z: 0 };
    friend.pos = { x: 100, z: 0 }; // far beyond the casual social radius
    for (let i = 2; i < world.settlers.length; i++) world.settlers[i].pos = { x: -150, z: 150 };
    subject.needs.social = 95;

    // A stranger that far away is simply not worth the trip.
    expect(rankSocialCandidates(world, subject).some((c) => c.other.id === friend.id)).toBe(false);

    applyRelationship(world, subject, friend.id, friend.name, 'gift', 'Fed me when I was starving', {
      affinity: 75,
      trust: 70,
      familiarity: 70,
    });
    backdate(subject, friend.id);

    const after = rankSocialCandidates(world, subject);
    const entry = after.find((c) => c.other.id === friend.id);
    expect(entry, 'a bonded friend is worth the walk').toBeDefined();
    expect(entry!.isJourney).toBe(true);
  });

  it('does not travel when the social need is not there', () => {
    const world = createWorld(22);
    const [subject, friend] = world.settlers;
    subject.pos = { x: 0, z: 0 };
    friend.pos = { x: 100, z: 0 };
    for (let i = 2; i < world.settlers.length; i++) world.settlers[i].pos = { x: -150, z: 150 };
    applyRelationship(world, subject, friend.id, friend.name, 'gift', 'Bonded', {
      affinity: 80,
      trust: 75,
      familiarity: 75,
    });
    backdate(subject, friend.id);
    subject.needs.social = 10;
    expect(rankSocialCandidates(world, subject).some((c) => c.other.id === friend.id)).toBe(false);
  });
});

describe('confrontation and reconciliation', () => {
  it('produces a confrontation from a real grievance, and records both sides', () => {
    const world = createWorld(31);
    const [a, b] = isolatePair(world);
    a.personality.aggression = 0.95;
    a.personality.empathy = 0.1;
    a.confrontCooldownUntil = 0;
    applyRelationship(world, a, b.id, b.name, 'resentment', 'Took the last food', { affinity: -55 });
    a.memories.push({
      type: 'resented_food',
      subjectId: b.id,
      subjectName: b.name,
      t: world.timeSec,
      emotionalWeight: -0.8,
    });

    run(world, 200);

    const confrontEvents = world.chronicle.filter(
      (e) => e.text.includes('confronted') || e.text.includes('argued'),
    );
    expect(confrontEvents.length, 'a grievance should surface as a confrontation').toBeGreaterThan(0);
    const ev = confrontEvents[0];
    expect(ev.actorIds).toContain(a.id);
    expect(ev.cause?.length).toBeGreaterThan(1);
    expect(ev.effects?.length).toBeGreaterThan(1);
    // Both parties carry a record of it.
    expect(a.relationships[b.id].history.some((h) => h.kind === 'conflict' || h.kind === 'reconciliation')).toBe(true);
    expect(b.relationships[a.id]).toBeDefined();
  });

  it('lets empathetic settlers reconcile rather than spiral', () => {
    const world = createWorld(32);
    const [a, b] = isolatePair(world);
    for (const s of [a, b]) {
      s.personality.empathy = 0.9;
      s.personality.aggression = 0.35;
      s.personality.initiative = 0.5;
      s.needs.social = 100;
      s.hunger = 10;
      s.energy = 95;
    }
    applyRelationship(world, a, b.id, b.name, 'conflict', 'Argued', { affinity: -30 });
    applyRelationship(world, b, a.id, a.name, 'conflict', 'Argued', { affinity: -30 });
    const before = a.relationships[b.id].affinity;

    run(world, 1600);

    const after = a.relationships[b.id].affinity;
    expect(after, 'negative relationships must not only spiral downward').toBeGreaterThan(before);
  });

  it('never lets a confrontation damage health (it is not combat)', () => {
    const world = createWorld(33);
    const [a, b] = isolatePair(world);
    a.personality.aggression = 0.95;
    a.personality.empathy = 0.05;
    applyRelationship(world, a, b.id, b.name, 'resentment', 'Grievance', { affinity: -60 });
    run(world, 400);
    expect(a.health).toBeGreaterThan(90);
    expect(b.health).toBeGreaterThan(90);
  });
});

describe('scarcity, sharing and resentment', () => {
  it('low yield genuinely reduces available food', () => {
    const world = createWorld(41);
    run(world, 60);
    const before = world.resources
      .filter((r) => r.type === 'glowberry')
      .reduce((sum, r) => sum + r.quantity, 0);

    creatorSetYield(world, 'low');
    expect(world.yieldMode).toBe('low');
    run(world, 1200);

    const after = world.resources
      .filter((r) => r.type === 'glowberry')
      .reduce((sum, r) => sum + r.quantity, 0);
    expect(after).toBeLessThan(before);
    expect(world.chronicle.some((e) => e.category === 'creator' && e.text.includes('thinned'))).toBe(true);
  });

  it('sharing food transfers real resources and builds trust', () => {
    const world = createWorld(42);
    const [donor, receiver] = isolatePair(world);
    donor.carriedFood = 2;
    donor.hunger = 10;
    donor.personality.empathy = 0.95;
    receiver.hunger = 95;
    donor.shareCooldownUntil = 0;

    run(world, 120);

    expect(donor.carriedFood, 'the donor gives up real food').toBeLessThan(2);
    expect(receiver.hunger).toBeLessThan(95);
    const rel = receiver.relationships[donor.id];
    expect(rel, 'receiving food creates a relationship').toBeDefined();
    expect(rel.trust).toBeGreaterThan(0);
    expect(receiver.memories.some((m) => m.type === 'given_food')).toBe(true);
    expect(world.chronicle.some((e) => e.text.includes('shared'))).toBe(true);
  });

  it('a hostile settler will not give food away', () => {
    const world = createWorld(43);
    const [donor, receiver] = isolatePair(world);
    donor.carriedFood = 2;
    donor.hunger = 10;
    donor.personality.empathy = 0.5;
    receiver.hunger = 95;
    applyRelationship(world, donor, receiver.id, receiver.name, 'conflict', 'Bad blood', {
      affinity: -70,
      fear: 10,
    });

    run(world, 120);
    expect(donor.carriedFood).toBe(2);
  });

  it('resentment is possible but never guaranteed', () => {
    // Across many seeded worlds the same setup must produce a mix of outcomes.
    let resented = 0;
    let spared = 0;
    for (let seed = 0; seed < 24; seed++) {
      const world = createWorld(500 + seed);
      const [eater, witness] = isolatePair(world);
      creatorSetYield(world, 'low');
      const node = world.resources.find((r) => r.type === 'glowberry')!;
      node.pos = { x: 1.5, z: 0 };
      node.quantity = 1;
      eater.pos = { x: 1.5, z: 0 };
      witness.pos = { x: 4, z: 0 };
      witness.hunger = 92;
      witness.knownResourceIds.push(node.id);
      eater.knownResourceIds.push(node.id);
      eater.hunger = 90;

      run(world, 200);
      if (witness.memories.some((m) => m.type === 'resented_food')) resented++;
      else spared++;
    }
    expect(resented, 'resentment should sometimes occur').toBeGreaterThan(0);
    expect(spared, 'resentment must not be guaranteed').toBeGreaterThan(0);
  });
});

describe('yesterday changes tomorrow', () => {
  it('identical worlds diverge in behavior once history differs', () => {
    // Two worlds from the same seed. In one, a friendship is recorded.
    // Nothing else differs — so any behavioral divergence is caused by history.
    const plain = createWorld(9001);
    const withHistory = createWorld(9001);

    for (const world of [plain, withHistory]) {
      const [subject, friend] = world.settlers;
      subject.pos = { x: 0, z: 0 };
      friend.pos = { x: 60, z: 0 };
      for (let i = 2; i < world.settlers.length; i++) world.settlers[i].pos = { x: -150, z: 150 };
      subject.needs.social = 95;
      subject.hunger = 10;
      subject.energy = 95;
    }
    const [hSubject, hFriend] = withHistory.settlers;
    applyRelationship(withHistory, hSubject, hFriend.id, hFriend.name, 'gift', 'Shared food when I was starving', {
      affinity: 78,
      trust: 72,
      familiarity: 70,
    });
    backdate(hSubject, hFriend.id);

    const pOptions = rankSocialCandidates(plain, plain.settlers[0]);
    const hOptions = rankSocialCandidates(withHistory, hSubject);

    // With no history, the distant settler is not a candidate at all.
    expect(pOptions.some((c) => c.other.id === plain.settlers[1].id)).toBe(false);
    // With history, they are the chosen one.
    expect(hOptions[0]?.other.id).toBe(hFriend.id);
  });

  it('relationships drift toward neutral when left alone', () => {
    const world = createWorld(9002);
    const [a, b] = isolatePair(world);
    // Park them far apart so nothing new happens between them.
    b.pos = { x: -150, z: 150 };
    applyRelationship(world, a, b.id, b.name, 'conflict', 'Argued', { affinity: -60, fear: 40 });
    const rel = a.relationships[b.id];
    rel.lastInteractionAt = -REL.decayIdleDelay * 2;
    const beforeAffinity = rel.affinity;
    const beforeFear = rel.fear;

    run(world, 1200);

    expect(rel.affinity).toBeGreaterThan(beforeAffinity);
    expect(rel.fear).toBeLessThan(beforeFear);
    // Familiarity is far stickier than feeling.
    expect(rel.familiarity).toBeGreaterThanOrEqual(0);
  });
});
