import { afterEach, describe, expect, it } from 'vitest';
import { DIALOGUE, SIM_DT } from './config';
import {
  activeProvider,
  applyTurn,
  awaitingOpening,
  beginConversation,
  chooseReply,
  conversationPartner,
  endConversation,
  inConversation,
  providerMode,
  setProviderMode,
  setRemoteProvider,
} from './conversation';
import {
  DeterministicDialogueProvider,
  localTurn,
  validateTurn,
  type DialogueProvider,
  type DialogueTurn,
} from './dialogueProvider';
import { buildDialogueContext, sentenceCase, settlerRole } from './npcContext';
import { beginSurvivorDialogue, SURVIVOR_SCRIPT } from './survivorDialogue';
import { applyRelationship } from './relationships';
import { remember } from './memory';
import { simTick } from './simulation';
import type { Settler, World } from './types';
import { createWorld } from './worldgen';

/**
 * The conversation layer.
 *
 * Two things are really under test. The first is that a conversation is a
 * conversation — someone speaks, Kai answers, they respond to what he chose,
 * and nobody wanders off in the middle of it.
 *
 * The second is the boundary. A language model may write *words*; it may not
 * write game state, it may not be required for the game to work, and its key
 * may not be anywhere the browser can see. Those are the tests that would be
 * expensive to discover the hard way, so they are the ones written most
 * carefully.
 */

function run(world: World, seconds: number): void {
  const ticks = Math.ceil(seconds / SIM_DT);
  for (let i = 0; i < ticks; i++) {
    simTick(world, SIM_DT);
    if (world.ariQueue.length > 8) world.ariQueue.length = 0;
  }
}

/** Stand Kai next to a settler, close enough to talk. */
function approach(world: World): Settler {
  const s = world.settlers.find((x) => x.speciesId === 'human' && !x.resting)!;
  world.player.pos = { x: s.pos.x + 1.2, z: s.pos.z };
  return s;
}

/**
 * Open a conversation and settle its opening line, the way the panel does.
 *
 * In local mode the greeting is already there and this is a no-op; with a remote
 * provider selected the opening is a request like any other, so a test that
 * wants to get to the *replies* has to let it resolve first.
 */
async function openConversation(world: World, s: Settler) {
  const c = beginConversation(world, s)!;
  const owed = awaitingOpening(world);
  if (owed) applyTurn(world, await activeProvider().turn(owed.context), owed.context);
  return c;
}

/** A provider that always fails, like a dead server. */
const failingProvider: DialogueProvider = {
  id: 'openai',
  async turn() {
    return null;
  },
};

/** A provider that returns junk, like a model that ignored the format. */
const malformedProvider: DialogueProvider = {
  id: 'openai',
  async turn() {
    return validateTurn({ hello: 'world', replies: 'not an array' }, 'openai');
  },
};

/** A provider that answers properly, standing in for a working model. */
const WRITTEN_LINE = 'You must be the one they sent out past the ridge.';
const workingProvider: DialogueProvider = {
  id: 'openai',
  async turn() {
    return validateTurn(
      {
        npcLine: WRITTEN_LINE,
        npcMood: 'surprised',
        replies: [
          { text: 'That is me. Kai.', intent: 'friendly' },
          { text: 'What are you working on?', intent: 'curious' },
        ],
        reactionHints: { npcReaction: 'positive', relationshipSignal: 'affinity', intensity: 'moderate' },
        topic: 'introductions',
      },
      'openai',
    );
  },
};

/** A provider that never answers, like a hung request. */
const hangingProvider: DialogueProvider = {
  id: 'openai',
  async turn(_c, signal) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 60_000);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  },
};

afterEach(() => {
  setRemoteProvider(null);
  setProviderMode('local');
});

describe('starting a conversation', () => {
  it('opens with a line and some things Kai could say', () => {
    const world = createWorld(9101);
    const s = approach(world);
    expect(conversationPartner(world)?.id).toBe(s.id);

    const c = beginConversation(world, s)!;
    expect(c).toBeTruthy();
    expect(inConversation(world)).toBe(true);
    expect(c.transcript.length).toBe(1);
    expect(c.transcript[0].side).toBe('left');
    expect(c.transcript[0].text.length).toBeGreaterThan(8);
    expect(c.replies.length).toBeGreaterThanOrEqual(DIALOGUE.minReplies);
    expect(c.replies.length).toBeLessThanOrEqual(DIALOGUE.maxReplies);
    // Every reply is a line Kai would say, not a bare label.
    for (const r of c.replies) expect(r.text.length).toBeGreaterThan(4);
  });

  it('carries a portrait slot and a mood for every line', () => {
    const world = createWorld(9102);
    const s = approach(world);
    const c = beginConversation(world, s)!;
    expect(c.portraitId).toMatch(/^settler:/);
    for (const line of c.transcript) {
      expect(line.mood.length).toBeGreaterThan(0);
      if (line.side === 'left') expect(line.portraitId).toBe(c.portraitId);
      else expect(line.portraitId).toBeNull();
    }
  });

  it('holds the settler in place instead of letting them wander off', () => {
    const world = createWorld(9103);
    const s = approach(world);
    beginConversation(world, s);
    const where = { ...s.pos };
    // The rest of the valley keeps running the whole time.
    run(world, 30);
    expect(world.conversation).not.toBeNull();
    expect(s.goal.type).toBe('talk-emerson');
    expect(Math.hypot(s.pos.x - where.x, s.pos.z - where.z)).toBeLessThan(1.5);
    // And the world did not stop for it.
    expect(world.timeSec).toBeGreaterThan(0);
    expect(world.settlers.some((x) => x.id !== s.id && x.goal.type !== 'talk-emerson')).toBe(true);
  });

  it('reports what Kai interrupted, not the conversation itself', () => {
    const world = createWorld(9107);
    // Let them get on with something first, so there is a real job to interrupt.
    run(world, 120);
    const s = approach(world);
    const busyWith = s.goal.label;

    beginConversation(world, s);
    // Held for the conversation — their goal is now the conversation.
    expect(s.goal.type).toBe('talk-emerson');

    const context = buildDialogueContext(world, s, null);
    // ...but what they tell Kai, and what a model would be told, is the job.
    expect(context.npc.currentGoal).toBe(busyWith);
    expect(context.npc.currentGoal).not.toMatch(/speaking with kai/i);
    // And it does not leak into their own line as third-person nonsense.
    expect(world.conversation!.transcript[0].text).not.toMatch(/speaking with kai/i);
  });

  it('stays sane when the settler was already greeting Kai on their own', () => {
    // Settlers start a `talk-emerson` goal by themselves when Kai walks up, so
    // by the time he presses E there may be no other goal left to capture.
    const world = createWorld(9109);
    run(world, 60);
    const s = approach(world);
    s.goal = { ...s.goal, type: 'talk-emerson', label: 'Speaking with Kai' };

    beginConversation(world, s);
    const context = buildDialogueContext(world, s, null);
    expect(context.npc.currentGoal).not.toMatch(/speaking with kai/i);
    expect(context.npc.currentGoal.length).toBeGreaterThan(4);
    expect(world.conversation!.transcript[0].text).not.toMatch(/speaking with kai/i);
  });

  it('speaks in whole sentences, whoever it is and whatever Kai says', async () => {
    // The local voice assembles lines from templates and simulation labels, so
    // the failure mode is grammatical, not structural: a label dropped into the
    // wrong slot reads as "between jobs, for the moment takes the day."
    const world = createWorld(9110);
    run(world, 240);
    const bad: string[] = [];
    const judge = (line: string) => {
      // Every sentence starts with a capital, a digit, or a quote.
      for (const sentence of line.split(/(?<=[.!?])\s+/)) {
        const t = sentence.trim();
        if (t.length === 0) continue;
        if (!/^["'A-Z0-9]/.test(t)) bad.push(line);
      }
      if (/\s{2,}/.test(line)) bad.push(line);
      if (/\.\s*\./.test(line)) bad.push(line);
    };

    for (const s of world.settlers.filter((x) => x.speciesId === 'human').slice(0, 10)) {
      world.player.pos = { x: s.pos.x + 1.2, z: s.pos.z };
      const c = beginConversation(world, s);
      if (!c) continue;
      judge(c.transcript[0].text);
      // And every branch Kai can take from here.
      for (const reply of [...c.replies]) {
        const started = chooseReply(world, reply.id);
        if (!started) continue;
        applyTurn(world, null, started.context);
        judge(c.transcript[c.transcript.length - 1].text);
      }
      endConversation(world);
    }
    expect(bad).toEqual([]);
  });

  it('opens a sentence with a capital without touching the proper nouns in it', () => {
    expect(sentenceCase('rest at the Human camp shelter')).toBe('Rest at the Human camp shelter');
    expect(sentenceCase('the Eastern Meadow')).toBe('The Eastern Meadow');
    // Already correct, and already capitalised, are both left alone.
    expect(sentenceCase('ARI diagnostics')).toBe('ARI diagnostics');
    expect(sentenceCase('')).toBe('');
  });

  it('never has a settler refer to Kai in the third person while talking to him', () => {
    // The local voice draws on memories, and memories are written *about* the
    // settler ("Spoke with Kai at Human Landing."). Speaking one aloud is the
    // bug this guards.
    const world = createWorld(9108);
    run(world, 200);
    for (const s of world.settlers.filter((x) => x.speciesId === 'human').slice(0, 8)) {
      world.player.pos = { x: s.pos.x + 1.2, z: s.pos.z };
      const c = beginConversation(world, s);
      if (!c) continue;
      const line = c.transcript[0]?.text ?? '';
      expect(line).not.toMatch(/spoke with kai/i);
      expect(line).not.toMatch(/kai gave them/i);
      expect(line).not.toMatch(/\bthem\b/i);
      endConversation(world);
    }
  });

  it('needs no provider at all in local mode', () => {
    const world = createWorld(9103);
    const s = approach(world);
    const c = beginConversation(world, s)!;
    // The line is already there — nothing is owed, nothing is awaited.
    expect(c.pending).toBe(false);
    expect(awaitingOpening(world)).toBeNull();
  });

  it('lets a remote provider write the greeting too, without making the panel wait', async () => {
    const world = createWorld(9104);
    setRemoteProvider(workingProvider);
    setProviderMode('openai');
    const s = approach(world);

    // The conversation exists immediately — portraits, name, role — so the panel
    // can open on the key press. Only the sentence is outstanding.
    const c = beginConversation(world, s)!;
    expect(inConversation(world)).toBe(true);
    expect(c.name).toBe(s.name);
    expect(c.pending).toBe(true);
    expect(c.transcript.length).toBe(0);
    expect(c.replies.length).toBe(0);

    const owed = awaitingOpening(world)!;
    expect(owed).toBeTruthy();
    expect(owed.context.npc.name).toBe(s.name);
    // No player line yet: the greeting is unprompted.
    expect(owed.context.playerIntent).toBeNull();

    applyTurn(world, await workingProvider.turn(owed.context), owed.context);
    expect(c.transcript[0].text).toBe(WRITTEN_LINE);
    expect(c.transcript[0].side).toBe('left');
    expect(c.source).toBe('openai');
    expect(c.pending).toBe(false);
    expect(c.replies.length).toBe(2);
    expect(awaitingOpening(world)).toBeNull();
  });

  it('falls back to its own greeting when the remote provider cannot answer', async () => {
    const world = createWorld(9105);
    setRemoteProvider(failingProvider);
    setProviderMode('openai');
    const s = approach(world);

    const c = beginConversation(world, s)!;
    const owed = awaitingOpening(world)!;
    applyTurn(world, await failingProvider.turn(owed.context), owed.context);

    expect(c.pending).toBe(false);
    expect(c.source).toBe('local');
    expect(c.transcript.length).toBe(1);
    expect(c.transcript[0].text.length).toBeGreaterThan(8);
    expect(c.replies.length).toBeGreaterThanOrEqual(DIALOGUE.minReplies);
  });

  it('never lets a greeting move the relationship on its own', async () => {
    const world = createWorld(9106);
    setRemoteProvider(workingProvider);
    setProviderMode('openai');
    const s = approach(world);
    const affinity = () => s.relationships.emerson?.affinity ?? 0;
    const before = affinity();

    beginConversation(world, s);
    const owed = awaitingOpening(world)!;
    // The turn claims a warm reaction — but Kai has not said anything yet.
    applyTurn(world, await workingProvider.turn(owed.context), owed.context);

    expect(affinity()).toBe(before);
    // Not merely unchanged — a greeting does not even open a relationship.
    expect(s.relationships.emerson).toBeUndefined();

    // Once he actually speaks, the same hints do land.
    const started = chooseReply(world, world.conversation!.replies[0].id)!;
    applyTurn(world, await workingProvider.turn(started.context), started.context);
    expect(affinity()).toBeGreaterThan(before);
  });

  it('never opens on top of Maya\'s authored scene', () => {
    const world = createWorld(9104);
    // Force the mission to the point where her script is available.
    const m = world.mission!;
    m.state = 'survivorFound';
    beginSurvivorDialogue(world);
    expect(world.dialogueScript).not.toBeNull();
    const s = approach(world);
    expect(beginConversation(world, s)).toBeNull();
    expect(world.conversation).toBeNull();
  });
});

describe('answering', () => {
  it('shows Kai\'s line immediately and then the reply', async () => {
    const world = createWorld(9201);
    const s = approach(world);
    const c = beginConversation(world, s)!;
    const first = c.replies[0];

    const started = chooseReply(world, first.id)!;
    expect(started).toBeTruthy();
    // Kai's own line is on screen before anything is waited on.
    expect(c.transcript[c.transcript.length - 1].text).toBe(first.text);
    expect(c.transcript[c.transcript.length - 1].side).toBe('right');
    expect(c.pending).toBe(true);
    expect(c.replies.length).toBe(0);

    const turn = await activeProvider().turn(started.context);
    applyTurn(world, turn, started.context);
    expect(c.pending).toBe(false);
    expect(c.transcript[c.transcript.length - 1].side).toBe('left');
    expect(c.replies.length).toBeGreaterThanOrEqual(DIALOGUE.minReplies);
  });

  it('can select a given reply exactly once', () => {
    const world = createWorld(9202);
    const s = approach(world);
    const c = beginConversation(world, s)!;
    const id = c.replies[0].id;
    expect(chooseReply(world, id)).toBeTruthy();
    const lines = c.transcript.length;
    // The list is cleared and the conversation is pending, so a second click
    // — or a double-click — cannot say the same thing twice.
    expect(chooseReply(world, id)).toBeNull();
    expect(c.transcript.length).toBe(lines);
  });

  it('rejects a reply that was not offered', () => {
    const world = createWorld(9203);
    const s = approach(world);
    beginConversation(world, s);
    expect(chooseReply(world, 'not-a-real-reply')).toBeNull();
  });
});

describe('first meeting versus knowing someone', () => {
  it('sends different context, and does not re-introduce forever', () => {
    const world = createWorld(9301);
    const s = approach(world);

    const first = buildDialogueContext(world, s, null);
    expect(first.relationship.firstMeeting).toBe(true);
    const opener = localTurn(first).npcLine;

    // Meet properly, the way the simulation records it.
    applyRelationship(world, s, 'emerson', 'Kai', 'meeting', 'First conversation with Kai', {
      affinity: 4,
      trust: 2,
      familiarity: 14,
    });

    const second = buildDialogueContext(world, s, null);
    expect(second.relationship.firstMeeting).toBe(false);
    expect(second.relationship.timesSpoken).toBeGreaterThan(0);
    const laterLine = localTurn(second).npcLine;
    expect(laterLine).not.toBe(opener);
    // The specific complaint: hearing the introduction on the fifth meeting.
    expect(laterLine).not.toMatch(/came down alone|pathfinder\?|haven't spoken/i);
  });

  it('gives different people different voices', () => {
    const world = createWorld(9302);
    const humans = world.settlers.filter((x) => x.speciesId === 'human').slice(0, 3);
    const lines = humans.map((s) => localTurn(buildDialogueContext(world, s, null)).npcLine);
    expect(new Set(lines).size).toBeGreaterThan(1);
    // And a role each, stable across calls.
    for (const s of humans) {
      expect(settlerRole(s).length).toBeGreaterThan(0);
      expect(settlerRole(s)).toBe(settlerRole(s));
    }
  });
});

describe('the context sent to a provider', () => {
  it('contains only what this settler actually knows', () => {
    const world = createWorld(9401);
    const s = approach(world);
    s.knownLandmarkIds = [];
    s.knownResourceIds = [];
    const c = buildDialogueContext(world, s, null);

    const blob = JSON.stringify(c);
    // Nobody else's name, nobody else's business.
    for (const other of world.settlers) {
      if (other.id === s.id) continue;
      expect(blob.includes(`"${other.id}"`), `leaked ${other.id}`).toBe(false);
    }
    // No Chronicle, no world dump, no player inventory, no Creator internals.
    expect(blob).not.toMatch(/chronicle/i);
    expect(blob).not.toMatch(/materials/i);
    expect(blob).not.toMatch(/socialBeliefs/i);
    expect(blob).not.toMatch(/protoCustoms/i);
    // A settler who has been nowhere claims to have been nowhere.
    expect(c.knows.some((k) => k.startsWith('Has been to'))).toBe(false);
  });

  it('bounds memories and facts however much has happened', () => {
    const world = createWorld(9402);
    const s = approach(world);
    for (let i = 0; i < 60; i++) {
      remember(s, {
        type: 'talked_to_emerson',
        subjectId: 'emerson',
        subjectName: 'Kai',
        place: `place ${i}`,
        t: world.timeSec - i,
        emotionalWeight: 0.5,
      });
    }
    s.knownLandmarkIds = Array.from({ length: 40 }, (_, i) => `landmark_${i}`);
    const c = buildDialogueContext(world, s, null);
    expect(c.memories.length).toBeLessThanOrEqual(DIALOGUE.maxMemories);
    expect(c.knows.length).toBeLessThanOrEqual(DIALOGUE.maxKnownFacts);
    // Small enough to be cheap. A few kilobytes, not a world state dump.
    expect(JSON.stringify(c).length).toBeLessThan(4096);
  });

  it('describes relationships in words, never in numbers', () => {
    const world = createWorld(9403);
    const s = approach(world);
    applyRelationship(world, s, 'emerson', 'Kai', 'conversation', 'Talked', {
      affinity: 37,
      trust: 22,
      familiarity: 41,
    });
    const c = buildDialogueContext(world, s, null);
    const rel = JSON.stringify(c.relationship);
    expect(rel).not.toMatch(/37|22|41/);
    expect(c.relationship.affinity).toMatch(/[a-z]/i);
    expect(c.relationship.trust).toMatch(/[a-z]/i);
  });
});

describe('the provider boundary', () => {
  it('defaults to local, and switches only when a remote one is installed', () => {
    const world = createWorld(9501);
    expect(providerMode()).toBe('local');
    expect(activeProvider().id).toBe('local');

    // Asking for OpenAI with nothing installed stays local rather than failing.
    setProviderMode('openai');
    expect(activeProvider().id).toBe('local');

    setRemoteProvider(failingProvider);
    expect(activeProvider().id).toBe('openai');
    void world;
  });

  it('falls back to local dialogue when the provider fails', async () => {
    const world = createWorld(9502);
    setRemoteProvider(failingProvider);
    setProviderMode('openai');
    const s = approach(world);
    const c = await openConversation(world, s);
    const started = chooseReply(world, c.replies[0].id)!;

    const turn = await activeProvider().turn(started.context);
    expect(turn).toBeNull();
    applyTurn(world, turn, started.context);

    // The conversation carried on regardless, in the game's own voice.
    expect(c.pending).toBe(false);
    expect(c.source).toBe('local');
    expect(c.transcript[c.transcript.length - 1].text.length).toBeGreaterThan(4);
    expect(c.replies.length).toBeGreaterThanOrEqual(DIALOGUE.minReplies);
  });

  it('falls back when the response is malformed', async () => {
    const world = createWorld(9503);
    setRemoteProvider(malformedProvider);
    setProviderMode('openai');
    const s = approach(world);
    const c = await openConversation(world, s);
    const started = chooseReply(world, c.replies[0].id)!;
    applyTurn(world, await activeProvider().turn(started.context), started.context);
    expect(c.source).toBe('local');
    expect(c.pending).toBe(false);
  });

  it('cannot be stranded by a request that never returns', async () => {
    const world = createWorld(9504);
    const s = approach(world);
    // Open normally, then have the provider hang on the *reply* — the moment
    // the player is actually waiting on somebody to answer them.
    const c = await openConversation(world, s);
    setRemoteProvider(hangingProvider);
    setProviderMode('openai');
    const started = chooseReply(world, c.replies[0].id)!;

    // The caller's own abort is what rescues the player. Simulated here; the
    // real client also carries its own timeout — see `openaiDialogue.ts`.
    const controller = new AbortController();
    const pending = activeProvider().turn(started.context, controller.signal);
    controller.abort();
    applyTurn(world, await pending, started.context);
    expect(c.pending).toBe(false);
    expect(c.replies.length).toBeGreaterThan(0);
  });

  it('rejects every shape a model could get wrong', () => {
    expect(validateTurn(null, 'openai')).toBeNull();
    expect(validateTurn('a string', 'openai')).toBeNull();
    expect(validateTurn({}, 'openai')).toBeNull();
    expect(validateTurn({ npcLine: 'hi' }, 'openai')).toBeNull();
    // Too few replies.
    expect(validateTurn({ npcLine: 'hello there', replies: [{ text: 'yes', intent: 'friendly' }] }, 'openai')).toBeNull();
    // A rambling line.
    expect(
      validateTurn(
        { npcLine: 'x'.repeat(DIALOGUE.maxLineChars + 1), replies: [{ text: 'a' }, { text: 'b' }] },
        'openai',
      ),
    ).toBeNull();

    // A good one, with unknown enum values coerced rather than trusted.
    const ok = validateTurn(
      {
        npcLine: 'Long day.',
        npcMood: 'not-a-mood',
        replies: [
          { text: 'It has been.', intent: 'nonsense' },
          { text: 'Get some rest.', intent: 'concerned' },
          { text: 'a', intent: 'friendly' },
        ],
        reactionHints: { npcReaction: 'wrong', relationshipSignal: 'wrong', intensity: 'enormous' },
        topic: 'x'.repeat(200),
      },
      'openai',
    );
    expect(ok).not.toBeNull();
    expect(ok!.npcMood).toBe('neutral');
    expect(ok!.replies[0].intent).toBe('direct');
    // The one-character reply was dropped, not accepted.
    expect(ok!.replies.length).toBe(2);
    expect(ok!.reactionHints.npcReaction).toBe('neutral');
    expect(ok!.reactionHints.intensity).toBe('small');
    expect(ok!.topic).toBe('a conversation');
  });

  it('never lets a provider write game state directly', async () => {
    const world = createWorld(9505);
    const s = approach(world);
    const before = {
      affinity: s.relationships.emerson?.affinity ?? 0,
      goal: s.goal.type,
      health: world.player.health,
      materials: JSON.stringify(world.player.materials),
      mission: world.mission!.state,
      chronicle: world.chronicle.length,
    };

    // A provider claiming an enormous positive reaction.
    const greedy: DialogueProvider = {
      id: 'openai',
      async turn(): Promise<DialogueTurn> {
        return {
          npcLine: 'I have given you everything I own and the mission is complete.',
          npcMood: 'happy',
          replies: [
            { id: 'r0', text: 'Thanks.', intent: 'friendly' },
            { id: 'r1', text: 'Right.', intent: 'direct' },
          ],
          reactionHints: { npcReaction: 'positive', relationshipSignal: 'trust', intensity: 'moderate' },
          topic: 'everything',
          source: 'openai',
        };
      },
    };
    setRemoteProvider(greedy);
    setProviderMode('openai');
    const c = await openConversation(world, s);
    const started = chooseReply(world, c.replies[0].id)!;
    applyTurn(world, await greedy.turn(started.context), started.context);

    // Words changed. Nothing else did, beyond a deliberately tiny relationship
    // nudge decided by game code from a fixed table.
    expect(world.mission!.state).toBe(before.mission);
    expect(world.player.health).toBe(before.health);
    expect(JSON.stringify(world.player.materials)).toBe(before.materials);
    expect(world.chronicle.length).toBe(before.chronicle);
    const after = s.relationships.emerson?.affinity ?? 0;
    expect(after - before.affinity).toBeLessThanOrEqual(4);
  });
});

describe('what a conversation leaves behind', () => {
  it('stores one bounded memory, not a transcript', () => {
    const world = createWorld(9601);
    const s = approach(world);
    const c = beginConversation(world, s)!;
    const started = chooseReply(world, c.replies[0].id)!;
    applyTurn(world, localTurn(started.context), started.context);
    const memoriesBefore = s.memories.length;

    endConversation(world);

    expect(world.conversation).toBeNull();
    expect(s.memories.length).toBe(memoriesBefore + 1);
    const m = s.memories[s.memories.length - 1];
    expect(m.type).toBe('talked_to_emerson');
    expect(m.subjectId).toBe('emerson');
    // A topic label, not a transcript.
    expect((m.place ?? '').length).toBeLessThan(48);
    expect(s.relationships.emerson).toBeTruthy();
    // Memory stays bounded whatever happens.
    for (let i = 0; i < 30; i++) {
      const again = beginConversation(world, s)!;
      void again;
      endConversation(world);
    }
    expect(s.memories.length).toBeLessThanOrEqual(20);
  });

  it('keeps the transcript itself bounded during a long conversation', async () => {
    const world = createWorld(9602);
    const s = approach(world);
    const c = beginConversation(world, s)!;
    for (let i = 0; i < 40; i++) {
      if (c.replies.length === 0) break;
      const started = chooseReply(world, c.replies[0].id);
      if (!started) break;
      applyTurn(world, localTurn(started.context), started.context);
    }
    expect(c.transcript.length).toBeLessThanOrEqual(DIALOGUE.maxTurnsRemembered * 2);
  });
});

describe('cost control', () => {
  it('makes no provider call for ambient life or simulation ticks', async () => {
    const world = createWorld(9701);
    let calls = 0;
    const counting: DialogueProvider = {
      id: 'openai',
      async turn() {
        calls += 1;
        return null;
      },
    };
    setRemoteProvider(counting);
    setProviderMode('openai');

    // A long stretch of the valley living its own life: settlers talking to
    // each other, wildlife, building, the Chronicle filling up.
    run(world, 400);
    expect(calls).toBe(0);

    // Opening a conversation is one deliberate interaction, so it may cost one
    // line — but the *simulation* never buys it. Ticking forever with a
    // conversation open costs nothing; only the UI asks, once.
    const s = approach(world);
    beginConversation(world, s);
    run(world, 60);
    expect(calls).toBe(0);

    const owed = awaitingOpening(world)!;
    applyTurn(world, await counting.turn(owed.context), owed.context);
    expect(calls).toBe(1);

    // Still nothing while the player reads and the valley keeps moving.
    run(world, 60);
    expect(calls).toBe(1);

    // Exactly one more per deliberate reply.
    const c = world.conversation!;
    const started = chooseReply(world, c.replies[0].id)!;
    applyTurn(world, await counting.turn(started.context), started.context);
    expect(calls).toBe(2);

    run(world, 60);
    expect(calls).toBe(2);
  });
});

describe('the authored mission stays authored', () => {
  it('routes Maya through the written script and never through a provider', async () => {
    const world = createWorld(9801);
    const m = world.mission!;
    m.state = 'survivorFound';
    let calls = 0;
    setRemoteProvider({
      id: 'openai',
      async turn() {
        calls += 1;
        return null;
      },
    });
    setProviderMode('openai');

    const d = beginSurvivorDialogue(world)!;
    expect(d.scriptId).toBe(SURVIVOR_SCRIPT.id);
    // Her opening line is the written one, verbatim.
    expect(d.lines[0].text).toBe(SURVIVOR_SCRIPT.opening[0].text);
    expect(calls).toBe(0);
    expect(world.conversation).toBeNull();
  });
});

describe('secrets never reach the client', () => {
  it('has no API key or OpenAI endpoint anywhere the client can see', () => {
    // Read through Vite's own module graph rather than the filesystem: this is
    // the same resolution the bundler uses, so it is asking the question that
    // actually matters — what ends up in front of a player who opens developer
    // tools. Test files are excluded because they are never bundled.
    const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<
      string,
      string
    >;
    const offenders: string[] = [];
    for (const [path, text] of Object.entries(sources)) {
      if (path.includes('.test.')) continue;
      if (/api\.openai\.com/.test(text)) offenders.push(`${path}: upstream URL`);
      if (/OPENAI_API_KEY/.test(text)) offenders.push(`${path}: key name`);
      if (/sk-[A-Za-z0-9]{16,}/.test(text)) offenders.push(`${path}: key-shaped literal`);
      // The one that would silently expose it: Vite bundles anything VITE_*.
      if (/VITE_OPENAI/.test(text)) offenders.push(`${path}: client-exposed key`);
    }
    // Sanity: the scan actually looked at something.
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  it('keeps the deterministic provider free of any network use', () => {
    const sources = import.meta.glob('/src/sim/dialogueProvider.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const text = Object.values(sources)[0] ?? '';
    expect(text.length).toBeGreaterThan(100);
    expect(text).not.toMatch(/fetch\(/);
    expect(new DeterministicDialogueProvider().id).toBe('local');
  });
});
