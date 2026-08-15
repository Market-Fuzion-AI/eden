import { DIALOGUE, PLAYER, SETTLER } from './config';
import { noteMet } from './firstLight';
import { buildDialogueContext, settlerRole } from './npcContext';
import {
  DeterministicDialogueProvider,
  localTurn,
  type DialogueProvider,
  type DialogueReply,
  type DialogueTurn,
} from './dialogueProvider';
import { applyRelationship } from './relationships';
import { remember } from './memory';
import type { Settler, World } from './types';
import { dist } from './vec';

/**
 * A conversation with an ordinary inhabitant of the valley.
 *
 * The old interaction was: press E, receive one derived line, read a number
 * telling you your affinity changed, watch them walk away. This is the same
 * simulation state expressed as a conversation — someone speaks, you answer,
 * they respond to what you chose, and the relationship moves because of what
 * was said rather than because a function was called.
 *
 * Lives on the world for the same reason the mission does: the whole flow can
 * then be exercised headlessly, with either provider, with no browser.
 *
 * Maya's mission conversation is deliberately not routed through here. Authored
 * story dialogue stays authored — see `survivorDialogue.ts`.
 */

export interface ConversationTurn {
  speaker: string;
  /** Portrait slot; null for Kai's own lines. */
  portraitId: string | null;
  mood: string;
  text: string;
  side: 'left' | 'right';
}

export interface Conversation {
  settlerId: string;
  name: string;
  role: string;
  portraitId: string;
  /** What they were doing when Kai interrupted them, before the hold. */
  npcGoal: string;
  /** Everything said so far, oldest first. */
  transcript: ConversationTurn[];
  /** What Kai can say next, or empty while waiting. */
  replies: DialogueReply[];
  /** True while a provider is being waited on. */
  pending: boolean;
  /** Which provider produced the most recent line. Developer tooling only. */
  source: 'local' | 'openai';
  turns: number;
  /** Set once the conversation has ended, so the UI can close cleanly. */
  done: boolean;
  /** Compact record built as the conversation goes, written to memory at the end. */
  outcome: { topic: string; intents: string[]; reaction: 'positive' | 'neutral' | 'negative' };
}

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

export type ProviderMode = 'local' | 'openai';

const localProvider = new DeterministicDialogueProvider();
let remoteProvider: DialogueProvider | null = null;
let mode: ProviderMode = 'local';

/**
 * Install the remote provider, if the build has one.
 *
 * Injected rather than imported so the simulation never depends on anything
 * that touches the network — which is what lets the headless suite run this
 * whole file with no fetch in sight.
 */
export function setRemoteProvider(p: DialogueProvider | null): void {
  remoteProvider = p;
}

export function setProviderMode(m: ProviderMode): void {
  mode = m;
}

export function providerMode(): ProviderMode {
  return mode;
}

/** What will actually answer, given the mode and what is installed. */
export function activeProvider(): DialogueProvider {
  if (mode === 'openai' && remoteProvider) return remoteProvider;
  return localProvider;
}

// ---------------------------------------------------------------------------
// Starting and holding a conversation
// ---------------------------------------------------------------------------

/** The settler Kai could speak with right now, if any. */
export function conversationPartner(world: World): Settler | null {
  const p = world.player;
  if (p.dead || p.extraction) return null;
  let best: Settler | null = null;
  let bestD = PLAYER.talkRange;
  for (const s of world.settlers) {
    if (s.resting) continue;
    const d = dist(s.pos, p.pos);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/**
 * Begin a conversation.
 *
 * Holds the settler in place and turns them to face Kai for as long as it
 * lasts — the previous behaviour let them wander off mid-sentence, which is the
 * single clearest way to communicate that nobody is really there. The rest of
 * the valley keeps running; only the two people talking are pinned.
 */
export function beginConversation(world: World, s: Settler): Conversation | null {
  if (world.conversation) return world.conversation;
  if (world.dialogueScript) return null; // an authored scene owns the screen

  // What Kai interrupted. Read before the hold replaces their goal with the
  // conversation itself — see `describeGoal` in npcContext. Settlers often
  // start greeting Kai on their own the moment he walks up, so the goal may
  // *already* be the conversation; an empty string means "nothing to report"
  // rather than passing that circularity straight through.
  const npcGoal = s.goal.type === 'talk-emerson' ? '' : s.goal.label;
  // Reaching someone is how the opening measures progress.
  noteMet(world, s);
  holdForConversation(world, s);

  const portraitId = `settler:${s.speciesId}:${s.sex}`;
  // With a remote provider selected, the greeting is theirs to write too —
  // otherwise every conversation in the valley still opens with the same canned
  // line and the layer is only half switched on. The panel opens *immediately*
  // either way, with the portraits up and a thinking indicator where the line
  // will go; what waits is the sentence, never the interface. If the request
  // fails or times out, `applyTurn` falls back to this same local voice.
  const convo: Conversation = {
    settlerId: s.id,
    name: s.name,
    role: settlerRole(s),
    portraitId,
    npcGoal,
    transcript: [],
    replies: [],
    pending: true,
    source: 'local',
    turns: 1,
    done: false,
    outcome: { topic: 'a conversation', intents: [], reaction: 'neutral' },
  };
  // Assigned before the context is built so the context can see `npcGoal`.
  world.conversation = convo;

  if (activeProvider().id === 'local') {
    const opening = localTurn(buildDialogueContext(world, s, null));
    convo.transcript.push({ speaker: s.name, portraitId, mood: opening.npcMood, text: opening.npcLine, side: 'left' });
    convo.replies = opening.replies;
    convo.outcome.topic = opening.topic;
    convo.pending = false;
  }
  return convo;
}

/**
 * Is a conversation still waiting for its opening line?
 *
 * Lets the UI drive the first request through exactly the same path as every
 * later one, rather than the simulation reaching for a provider itself.
 */
export function awaitingOpening(world: World): { context: ReturnType<typeof buildDialogueContext> } | null {
  const c = world.conversation;
  if (!c || !c.pending || c.done || c.transcript.length > 0) return null;
  const s = world.settlers.find((x) => x.id === c.settlerId);
  if (!s) return null;
  return { context: buildDialogueContext(world, s, null) };
}

/**
 * Keep the settler present.
 *
 * Reuses the existing `talk-emerson` goal, which the goal system already
 * understands as "stand still and face Kai" — a conversation should not need a
 * second mechanism for holding someone's attention.
 */
export function holdForConversation(world: World, s: Settler): void {
  const hold = world.timeSec + PLAYER.talkDuration;
  s.talkingUntil = Math.max(s.talkingUntil, hold);
  s.goal = {
    type: 'talk-emerson',
    label: 'Speaking with Kai',
    phase: 'act',
    timer: PLAYER.talkDuration,
    startedAt: world.timeSec,
    deadline: hold,
  };
  s.goalReason = { summary: ['Kai is talking to them'], scores: [] };
  s.socialTimer = PLAYER.talkDuration;
  // Suppress ambient chatter for the moment — being interrupted by small talk
  // with a third party during a conversation reads as the world ignoring you.
  s.socialCooldownUntil = Math.max(s.socialCooldownUntil, hold + SETTLER.socialPairCooldown * 0.25);
}

/** Renew the hold each tick, so a long conversation never ends by timeout. */
export function conversationTick(world: World): void {
  const c = world.conversation;
  if (!c) return;
  const s = world.settlers.find((x) => x.id === c.settlerId);
  if (!s) {
    endConversation(world);
    return;
  }
  holdForConversation(world, s);
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

/**
 * Kai says one of the offered lines.
 *
 * Returns the context the caller should send to a provider, or null when the
 * reply is not valid. Deliberately split from the provider call: choosing is
 * synchronous and instant, and the waiting happens afterwards behind a pending
 * flag, so the player's own line appears the moment they click it.
 */
export function chooseReply(world: World, replyId: string): { context: ReturnType<typeof buildDialogueContext> } | null {
  const c = world.conversation;
  if (!c || c.pending || c.done) return null;
  const reply = c.replies.find((r) => r.id === replyId);
  if (!reply) return null;
  const s = world.settlers.find((x) => x.id === c.settlerId);
  if (!s) return null;

  // The player's line lands immediately, on the right-hand side.
  c.transcript.push({ speaker: 'Kai', portraitId: null, mood: 'neutral', text: reply.text, side: 'right' });
  c.outcome.intents.push(reply.intent);
  c.replies = [];
  c.pending = true;
  c.turns += 1;
  trimTranscript(c);

  return { context: buildDialogueContext(world, s, { intent: reply.intent, text: reply.text }) };
}

/**
 * A provider answered. Apply the turn, or fall back to the local voice.
 *
 * `turn` being null is not an error path to apologise for — it is a missing key,
 * an offline server or a timeout, and the game simply speaks for itself.
 */
export function applyTurn(world: World, turn: DialogueTurn | null, fallbackContext: ReturnType<typeof buildDialogueContext>): void {
  const c = world.conversation;
  if (!c) return;
  const resolved = turn ?? localTurn(fallbackContext);
  c.transcript.push({
    speaker: c.name,
    portraitId: c.portraitId,
    mood: resolved.npcMood,
    text: resolved.npcLine,
    side: 'left',
  });
  c.replies = resolved.replies;
  c.pending = false;
  c.source = resolved.source;
  c.outcome.topic = resolved.topic;
  c.outcome.reaction = resolved.reactionHints.npcReaction;
  applyDialogueOutcome(world, resolved);
  trimTranscript(c);
}

function trimTranscript(c: Conversation): void {
  const max = DIALOGUE.maxTurnsRemembered * 2;
  if (c.transcript.length > max) c.transcript.splice(0, c.transcript.length - max);
}

/**
 * Turn a reaction *hint* into an actual relationship change.
 *
 * This is the line the model never crosses. It may observe that something
 * landed well; the size and shape of any consequence is decided here, in game
 * code, from a fixed table. Deliberately tiny — a prototype conversation layer
 * should not be able to move a relationship faster than living alongside
 * someone does.
 */
export function applyDialogueOutcome(world: World, turn: DialogueTurn): void {
  const c = world.conversation;
  if (!c) return;
  const s = world.settlers.find((x) => x.id === c.settlerId);
  if (!s) return;
  // A greeting is not an achievement. Until Kai has actually said something,
  // there is nothing for the other person to have reacted *to*, so the opening
  // line never moves a relationship however warmly it is phrased.
  if (c.outcome.intents.length === 0) return;
  const { npcReaction, relationshipSignal, intensity } = turn.reactionHints;
  if (npcReaction === 'neutral' && relationshipSignal === 'none') return;

  const scale = intensity === 'moderate' ? 2 : 1;
  const delta = { affinity: 0, trust: 0, familiarity: 0 };
  if (npcReaction === 'positive') delta.affinity += 1 * scale;
  if (npcReaction === 'negative') delta.affinity -= 1 * scale;
  if (relationshipSignal === 'trust') delta.trust += 1 * scale;
  if (relationshipSignal === 'affinity') delta.affinity += 1 * scale;
  if (relationshipSignal === 'irritation') delta.affinity -= 1 * scale;

  if (delta.affinity === 0 && delta.trust === 0) return;
  applyRelationship(world, s, 'emerson', 'Kai', 'conversation', 'Talked with Kai', delta);
}

// ---------------------------------------------------------------------------
// Ending
// ---------------------------------------------------------------------------

/**
 * End the conversation and write what gameplay actually needs.
 *
 * Bounded on purpose: one memory, a topic, the intents Kai used, and how it
 * went. No transcript, no prompt, no model output stored anywhere. The
 * simulation's memory model is a small ring of structured entries and it stays
 * that way — filling it with generated prose would make every downstream system
 * that reads memories worse.
 */
export function endConversation(world: World): void {
  const c = world.conversation;
  world.conversation = null;
  if (!c) return;
  const s = world.settlers.find((x) => x.id === c.settlerId);
  if (!s) return;

  const rel = s.relationships.emerson;
  const firstMeeting = !rel || rel.interactions === 0;

  // The relationship moves once for the conversation as a whole, on the same
  // model the settlers use with each other.
  applyRelationship(
    world,
    s,
    'emerson',
    'Kai',
    firstMeeting ? 'meeting' : 'conversation',
    firstMeeting ? 'First conversation with Kai' : `Talked with Kai about ${c.outcome.topic}`,
    {
      affinity: 2 + s.personality.sociability * 2,
      trust: 1,
      familiarity: firstMeeting ? 12 : 5,
    },
  );

  remember(s, {
    type: 'talked_to_emerson',
    subjectId: 'emerson',
    subjectName: 'Kai',
    place: c.outcome.topic,
    t: world.timeSec,
    emotionalWeight: c.outcome.reaction === 'positive' ? 0.5 : c.outcome.reaction === 'negative' ? -0.35 : 0.3,
  });
}

/** True when a conversation is on screen. */
export function inConversation(world: World): boolean {
  return world.conversation !== null;
}
