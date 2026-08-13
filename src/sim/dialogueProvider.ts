import { DIALOGUE } from './config';
import { sentenceCase, type DialogueContext } from './npcContext';

/**
 * The dialogue provider boundary.
 *
 * EDEN has to be playable with no internet, no API key and no money, so the
 * language model is an *enhancement layer* and never a dependency. This
 * interface is the seam: the game asks for a conversation turn, something
 * produces one, and the game does not care which.
 *
 * Two implementations exist. The deterministic one is the game's own voice —
 * always available, instant, free, and the fallback for every failure mode.
 * The OpenAI one runs behind a server route and returns the same shape.
 *
 * Nothing a provider returns is trusted as state. A turn is *words*: a line,
 * some replies, a mood. Any consequence is decided afterwards by game code
 * reading the validated reaction hints — see `applyDialogueOutcome`.
 */

export type DialogueMood = 'neutral' | 'happy' | 'concerned' | 'annoyed' | 'surprised' | 'focused';

export const MOODS: DialogueMood[] = ['neutral', 'happy', 'concerned', 'annoyed', 'surprised', 'focused'];

/** What the player may be trying to do with a reply. */
export type ReplyIntent = 'friendly' | 'curious' | 'direct' | 'playful' | 'concerned' | 'skeptical' | 'firm';

export const INTENTS: ReplyIntent[] = [
  'friendly',
  'curious',
  'direct',
  'playful',
  'concerned',
  'skeptical',
  'firm',
];

export interface DialogueReply {
  id: string;
  /** What Kai actually says — the player never sees the bare intent. */
  text: string;
  intent: ReplyIntent;
}

/**
 * How the NPC took it.
 *
 * Deliberately a *hint*, not a value. The model may say "that landed well";
 * only game code decides whether anything changes and by how much, which is
 * what keeps a text generator from writing to the simulation.
 */
export interface ReactionHints {
  npcReaction: 'positive' | 'neutral' | 'negative';
  relationshipSignal: 'trust' | 'affinity' | 'irritation' | 'concern' | 'none';
  intensity: 'small' | 'moderate';
}

export interface DialogueTurn {
  npcLine: string;
  npcMood: DialogueMood;
  replies: DialogueReply[];
  reactionHints: ReactionHints;
  /** Short label for what this turn was about, for the bounded memory. */
  topic: string;
  /** Which provider actually produced this. Shown only in developer tooling. */
  source: 'local' | 'openai';
}

export interface DialogueProvider {
  readonly id: 'local' | 'openai';
  /** Produce one turn. Must never throw; failures return null so a caller can fall back. */
  turn(context: DialogueContext, signal?: AbortSignal): Promise<DialogueTurn | null>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Accept a turn only if it is exactly the right shape.
 *
 * Applied to anything that came from outside this file, on both sides of the
 * network. A language model is a text generator: it may return prose, a code
 * fence, a field renamed, six replies instead of three, or a mood nobody
 * defined. None of that may reach the game, and a malformed response is not an
 * error to recover from cleverly — it is a reason to use the local provider.
 */
export function validateTurn(raw: unknown, source: 'local' | 'openai'): DialogueTurn | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const npcLine = typeof o.npcLine === 'string' ? o.npcLine.trim() : '';
  if (npcLine.length < 2 || npcLine.length > DIALOGUE.maxLineChars) return null;

  const npcMood = MOODS.includes(o.npcMood as DialogueMood) ? (o.npcMood as DialogueMood) : 'neutral';

  if (!Array.isArray(o.replies)) return null;
  const replies: DialogueReply[] = [];
  for (const r of o.replies) {
    if (!r || typeof r !== 'object') continue;
    const rr = r as Record<string, unknown>;
    const text = typeof rr.text === 'string' ? rr.text.trim() : '';
    if (text.length < 2 || text.length > DIALOGUE.maxLineChars) continue;
    const intent = INTENTS.includes(rr.intent as ReplyIntent) ? (rr.intent as ReplyIntent) : 'direct';
    replies.push({ id: `r${replies.length}`, text, intent });
    if (replies.length >= DIALOGUE.maxReplies) break;
  }
  if (replies.length < DIALOGUE.minReplies) return null;

  const hints = (o.reactionHints ?? {}) as Record<string, unknown>;
  const reactionHints: ReactionHints = {
    npcReaction: (['positive', 'neutral', 'negative'] as const).includes(hints.npcReaction as never)
      ? (hints.npcReaction as ReactionHints['npcReaction'])
      : 'neutral',
    relationshipSignal: (['trust', 'affinity', 'irritation', 'concern', 'none'] as const).includes(
      hints.relationshipSignal as never,
    )
      ? (hints.relationshipSignal as ReactionHints['relationshipSignal'])
      : 'none',
    intensity: hints.intensity === 'moderate' ? 'moderate' : 'small',
  };

  const topic =
    typeof o.topic === 'string' && o.topic.trim().length > 0 && o.topic.length <= 48
      ? o.topic.trim()
      : 'a conversation';

  return { npcLine, npcMood, replies, reactionHints, topic, source };
}

// ---------------------------------------------------------------------------
// The local provider
// ---------------------------------------------------------------------------

/**
 * EDEN's own voice.
 *
 * Composed from the same bounded context the model would receive, so the two
 * providers are answering the same question from the same facts. It is not a
 * placeholder to be replaced — it is the guaranteed floor the game stands on
 * when there is no key, no network, no quota, or no patience.
 */
export class DeterministicDialogueProvider implements DialogueProvider {
  readonly id = 'local' as const;

  async turn(context: DialogueContext): Promise<DialogueTurn> {
    return localTurn(context);
  }
}

/** Pick deterministically from a list, seeded by the NPC so people differ. */
function pick<T>(list: T[], seed: string, salt: number): T {
  let h = salt >>> 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

export function localTurn(c: DialogueContext): DialogueTurn {
  const { npc, doing, relationship: rel } = c;
  const seed = npc.id + (c.playerIntent?.intent ?? '');

  // What they open with depends on whether they know him — the single most
  // common complaint about the old one-liner was hearing "you're the one from
  // the drop pod" for the fifth time.
  let line: string;
  let mood: DialogueMood = 'neutral';
  if (c.playerIntent) {
    line = replyToIntent(c, seed);
    mood = c.playerIntent.intent === 'playful' ? 'happy' : c.playerIntent.intent === 'firm' ? 'focused' : 'neutral';
  } else if (rel.firstMeeting) {
    line = pick(
      [
        `You must be the pathfinder. ${npc.name}. I was wondering when you'd come over.`,
        `We haven't spoken. ${npc.name} — ${npc.role.toLowerCase()}, for whatever that's worth down here.`,
        `So you're the one who came down alone. ${npc.name}.`,
      ],
      seed,
      1,
    );
    mood = 'surprised';
  } else {
    // Something true about right now: what they are doing, or how they are.
    // The greeting itself carries the history — someone Kai has spoken to twice
    // should not greet him like someone he has worked beside for weeks.
    const openers =
      rel.timesSpoken >= 4
        ? [`Kai.`, `Back again.`, `Good — someone who isn't busy.`]
        : [`Kai, isn't it.`, `You again. Good.`, `Twice in a week. People will talk.`];
    const opener = pick(openers, seed, 2);
    line = `${opener} ${situationLine(c)}`;
    mood = doing.mood.includes('good spirits') ? 'happy' : doing.mood.includes('exhausted') ? 'concerned' : 'neutral';
  }

  return {
    npcLine: line,
    npcMood: mood,
    replies: localReplies(c, seed),
    reactionHints: { npcReaction: 'neutral', relationshipSignal: 'none', intensity: 'small' },
    topic: c.playerIntent ? c.playerIntent.intent : rel.firstMeeting ? 'introductions' : 'catching up',
    source: 'local',
  };
}

/**
 * One sentence about what is actually true for this settler right now.
 *
 * Note what is *not* used here: `c.memories`. Those sentences are written in the
 * third person because they are facts *about* this person for a model to read —
 * "Spoke with Kai at Human Landing." Splicing one into their own mouth produced
 * lines like "Kai. Spoke with Kai at Human Landing — I keep thinking about
 * that.", which is a character referring to the person in front of them in the
 * third person. The local voice speaks only from things it can phrase as first
 * person itself; remembering is expressed through *how* they greet him instead.
 */
function situationLine(c: DialogueContext): string {
  const { doing, situation } = c;
  if (situation.danger) return `I'd not wander far right now. ${situation.danger}`;
  if (doing.needs.includes('hungry')) return `I was about to go and find something to eat, if I'm honest.`;
  if (doing.needs.includes('tired')) {
    return doing.busy
      ? `I'm running on very little. ${sentenceCase(doing.activity)}, then I'm done.`
      : `I'm running on very little. One more hour and I'm done.`;
  }
  if (doing.needs.includes('wants company')) return `I've been on my own most of the morning. It's good to see anyone.`;
  return doing.busy ? `${doing.activity}. Same as most days.` : `Nothing pressing this minute. It makes a change.`;
}

/** How they answer what Kai chose to say. */
function replyToIntent(c: DialogueContext, seed: string): string {
  const intent = c.playerIntent!.intent;
  const { npc, doing } = c;
  switch (intent) {
    case 'friendly':
      return pick(
        [`That's kind of you. It helps, more than you'd think.`, `Thank you. Genuinely.`],
        seed,
        3,
      );
    case 'curious':
      return pick(
        [
          `${sentenceCase(npc.location)}, mostly. I don't get much further than that.`,
          doing.busy
            ? `Not as much as I'd like. ${sentenceCase(doing.activity)} takes the day.`
            : `Not as much as I'd like. There's always something that needs doing.`,
        ],
        seed,
        4,
      );
    case 'playful':
      return pick([`Ha. You're in a good mood.`, `Careful. I might start enjoying this.`], seed, 5);
    case 'concerned':
      return pick([`I'm managing. Others have it worse.`, `I'll be all right. Ask me again tomorrow.`], seed, 6);
    case 'skeptical':
      return pick([`You can think what you like.`, `I'm not asking you to take my word for it.`], seed, 7);
    case 'firm':
      return pick([`Fair enough. Straight answer, then.`, `All right. No sense dressing it up.`], seed, 8);
    default:
      return pick([`Understood.`, `Right.`], seed, 9);
  }
}

/**
 * Two to four things Kai might say.
 *
 * Written as lines rather than labels: the player picks something Kai would
 * actually say, and the intent underneath is the game's business. The options
 * are drawn from what is true in the context, so they change with the person
 * and the moment rather than being the same three buttons every time.
 */
function localReplies(c: DialogueContext, seed: string): DialogueReply[] {
  const out: DialogueReply[] = [];
  const add = (text: string, intent: ReplyIntent) => {
    if (out.length < DIALOGUE.maxReplies) out.push({ id: `r${out.length}`, text, intent });
  };

  if (c.relationship.firstMeeting) {
    add(`Kai. Independent Pathfinder — I do the walking so the rest of you don't have to.`, 'friendly');
    add(`What is it you do here?`, 'curious');
    add(`How are people holding up?`, 'concerned');
    return out;
  }

  if (c.situation.danger) {
    add(`Stay near camp. I'll go and look.`, 'firm');
    add(`Have you actually seen it, or just felt it?`, 'skeptical');
  }
  if (c.doing.needs.includes('hungry')) add(`Go and eat. Whatever it is will keep.`, 'concerned');
  if (c.doing.needs.includes('tired')) add(`You look wrecked. Sit down for an hour.`, 'concerned');
  if (c.memories.length > 0) add(`Tell me about ${lastPlace(c)}.`, 'curious');

  add(pick([`How's the work going?`, `What are you on with?`], seed, 10), 'curious');
  add(pick([`Good to see you.`, `Glad you're still standing.`], seed, 11), 'friendly');
  if (out.length < DIALOGUE.minReplies) add(`I'll leave you to it.`, 'direct');
  return out.slice(0, DIALOGUE.maxReplies);
}

function lastPlace(c: DialogueContext): string {
  const known = c.knows.find((k) => k.startsWith('Has been to'));
  if (known) return known.replace('Has been to ', '').replace(/\.$/, '');
  return c.npc.location;
}
