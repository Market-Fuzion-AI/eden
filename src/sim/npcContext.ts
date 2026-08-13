import { DIALOGUE } from './config';
import { identityOf } from './identities';
import { isNight } from './chronicle';
import { placeName } from './landmarks';
import { regionAt, regionShortName } from './regions';
import { INTELLIGENT_SPECIES } from './species';
import type { IntelligentSpeciesId, MemoryEntry, Settler, World } from './types';
import { dist } from './vec';

/**
 * What a single NPC knows, packed small enough to send somewhere.
 *
 * The rule this file exists to enforce: **the simulation is authoritative and
 * the model only verbalises it.** Everything below is a fact the settler
 * actually holds — their own personality, their own current goal, the places
 * they have personally visited, the memories they personally formed. Nothing is
 * summarised from the world's point of view, because a character who knows
 * things they were never present for is a character who will confidently invent
 * more of them.
 *
 * It is also deliberately *small*. There are twenty-two settlers, a Chronicle
 * that runs to hundreds of entries, and a memory list per person; sending any
 * of that would be expensive, slow, and would drown the handful of facts that
 * actually matter in this conversation. The bounds here are hard caps, not
 * guidelines, and the tests assert them.
 */

/**
 * WHO THEY ARE — authored, permanent. Layer A.
 *
 * None of this changes because someone got hungry. A sleeping engineer is still
 * an engineer.
 */
export interface NpcFacts {
  id: string;
  name: string;
  species: string;
  role: string;
  /** Their standing duty to the colony. Empty for non-survivors. */
  responsibility: string;
  personality: string[];
  expertise: string[];
  values: string[];
  /** How they read the colony's situation. */
  outlook: string;
  location: string;
  region: string;
}

/**
 * WHAT THEY ARE DOING RIGHT NOW — simulation, moment to moment. Layer B.
 *
 * Decided by the utility AI, which remains completely free. This is a *report*
 * of the simulation, never an instruction to it.
 */
export interface ActivityFacts {
  /** The goal the simulation currently has them on. */
  activity: string;
  /**
   * Whether `activity` is a real task or a stand-in for "nothing much".
   * The local voice builds sentences around it ("… takes the day"), which only
   * works when there is an actual job to name.
   */
  busy: boolean;
  needs: string[];
  mood: string;
  resting: boolean;
}

/**
 * WHAT THEY CARE ABOUT — authored, persistent. Layer C.
 *
 * The larger thing on their mind, which outlives whatever they happen to be
 * doing this minute. Explicitly *not* a quest: nothing here creates an
 * objective, a marker or a reward, and the model is told so.
 */
export interface PriorityFacts {
  goal: string;
  problem: string;
  aspiration: string;
}

export interface RelationshipFacts {
  firstMeeting: boolean;
  familiarity: string;
  trust: string;
  affinity: string;
  wary: boolean;
  timesSpoken: number;
}

export interface DialogueContext {
  /** Layer A — who they are. */
  npc: NpcFacts;
  /** Layer B — what the simulation has them doing right now. */
  doing: ActivityFacts;
  /** Layer C — the larger thing they care about. Null for non-survivors. */
  priority: PriorityFacts | null;
  relationship: RelationshipFacts;
  /** Memories involving Kai or recently formed. Bounded, most relevant first. */
  memories: string[];
  /** Places and facts this settler has personally learned. Bounded. */
  knows: string[];
  situation: { time: string; weather: string; danger: string | null };
  /** What the player chose to say, if this is a follow-up turn. */
  playerIntent: { intent: string; text: string } | null;
}

// ---------------------------------------------------------------------------
// Descriptive banding
// ---------------------------------------------------------------------------

/**
 * Numbers become words on the way out.
 *
 * Two reasons. A model handed "affinity: 37" will happily reason about the
 * number and then say something about it, and the player must never hear their
 * relationship read out as telemetry. And a band is more robust: it stays true
 * if the underlying scale is ever retuned.
 */
function band(v: number, labels: [number, string][]): string {
  for (const [threshold, label] of labels) if (v >= threshold) return label;
  return labels[labels.length - 1][1];
}

const affinityBand = (v: number) =>
  band(v, [
    [55, 'genuinely fond of Kai'],
    [25, 'warm toward Kai'],
    [8, 'friendly enough'],
    [-8, 'neutral toward Kai'],
    [-30, 'cool toward Kai'],
    [-101, 'actively dislikes Kai'],
  ]);

const trustBand = (v: number) =>
  band(v, [
    [60, 'trusts Kai'],
    [30, 'is starting to trust Kai'],
    [10, 'is still weighing him up'],
    [-101, 'does not trust him yet'],
  ]);

const familiarityBand = (v: number) =>
  band(v, [
    [60, 'knows Kai well'],
    [30, 'has spoken with Kai a few times'],
    [8, 'has met Kai briefly'],
    [-101, 'barely knows Kai'],
  ]);

/** Personality as adjectives rather than six decimals. */
function personalityWords(s: Settler): string[] {
  const out: string[] = [];
  const p = s.personality;
  if (p.sociability > 0.65) out.push('outgoing');
  else if (p.sociability < 0.35) out.push('reserved');
  if (p.curiosity > 0.65) out.push('curious');
  if (p.caution > 0.65) out.push('cautious');
  else if (p.caution < 0.3) out.push('bold');
  if (p.empathy > 0.65) out.push('warm');
  else if (p.empathy < 0.3) out.push('blunt');
  if (p.aggression > 0.6) out.push('short-tempered');
  if (p.initiative > 0.65) out.push('takes charge');
  return out.length > 0 ? out.slice(0, 4) : ['even-tempered'];
}

/** How they are *doing*, from the needs the simulation already tracks. */
function moodWords(s: Settler): string {
  if (s.resting) return 'resting, half asleep';
  if (s.hunger > 75) return 'hungry and distracted';
  if (s.energy < 25) return 'exhausted';
  if (s.needs.safety > 55) return 'unsettled, keeping an eye on the treeline';
  if (s.needs.social > 65) return 'starved of company';
  if (s.hunger > 50) return 'peckish';
  if (s.energy > 80 && s.hunger < 30) return 'in good spirits';
  return 'getting on with the day';
}

function needWords(s: Settler): string[] {
  const out: string[] = [];
  if (s.hunger > 60) out.push('hungry');
  if (s.energy < 35) out.push('tired');
  if (s.needs.social > 60) out.push('wants company');
  if (s.needs.curiosity > 65) out.push('restless, wants to see more of the valley');
  if (s.needs.safety > 50) out.push('feels unsafe');
  return out;
}

/**
 * What this settler is actually busy with.
 *
 * Holding someone for a conversation replaces their goal with "Speaking with
 * Kai", so asking them mid-conversation what they are doing answers with the
 * conversation. That is circular as context and absurd as speech — it produced
 * lines like "Kai, isn't it. Speaking with Kai. Same as most days." What the
 * listener wants is what Kai *interrupted*, which the conversation recorded
 * before the hold overwrote it.
 */
function describeGoal(world: World, s: Settler): { label: string; busy: boolean } {
  if (s.goal.type !== 'talk-emerson') return { label: s.goal.label, busy: true };
  const c = world.conversation;
  if (c && c.settlerId === s.id && c.npcGoal) return { label: c.npcGoal, busy: true };
  return { label: 'Nothing in particular right now', busy: false };
}

/**
 * A simulation label used to open a sentence.
 *
 * Goal labels ("Rest at the Human camp shelter") and place names ("the Eastern
 * Meadow") are written to sit inside prose, so dropping one straight after a
 * full stop produces "I'm running on very little. rest at the Human camp
 * shelter, then I'm done." Only the first letter changes — the rest is left
 * exactly as written, because these strings carry proper nouns.
 */
export function sentenceCase(label: string): string {
  if (label.length === 0) return label;
  return label[0].toUpperCase() + label.slice(1);
}

/**
 * Memories, most worth mentioning first.
 *
 * Ranked by emotional weight and recency, and filtered to things this settler
 * would actually bring up: what happened with Kai, and anything that landed
 * hard enough to still be on their mind. Everything else is noise.
 */
function relevantMemories(world: World, s: Settler): string[] {
  const t = world.timeSec;
  const scored = s.memories
    .map((m) => ({ m, score: scoreMemory(m, t) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, DIALOGUE.maxMemories);
  return scored.map((x) => memorySentence(x.m));
}

function scoreMemory(m: MemoryEntry, now: number): number {
  const aboutKai = m.subjectId === 'emerson';
  const weight = Math.abs(m.emotionalWeight);
  // Recency in in-world days, gently discounted rather than cut off.
  const age = Math.max(0, now - m.t) / 720;
  const recency = 1 / (1 + age * 0.6);
  if (aboutKai) return (0.6 + weight) * recency * 2;
  if (weight < 0.35) return 0;
  return weight * recency;
}

/** One memory, as a sentence the model can read without decoding an enum. */
function memorySentence(m: MemoryEntry): string {
  const who = m.subjectName ?? 'someone';
  const place = m.place ? ` at ${m.place}` : '';
  switch (m.type) {
    case 'talked_to_emerson':
      return `Spoke with Kai${place}.`;
    case 'fed_by_emerson':
      return `Kai gave them food${place}.`;
    case 'saw_emerson':
      return `Saw Kai passing${place}.`;
    case 'threatened':
      return `Was frightened by something${place}.`;
    case 'social_positive':
      return `Had a good conversation with ${who}${place}.`;
    case 'social_negative':
      return `Fell out with ${who}${place}.`;
    case 'confronted':
      return `Confronted ${who}${place}.`;
    case 'reconciled':
      return `Made peace with ${who}${place}.`;
    case 'shared_food':
      return `Shared food with ${who}${place}.`;
    case 'given_food':
      return `Was given food by ${who}${place}.`;
    case 'built_structure':
      return `Built something${place}.`;
    case 'helped_build':
      return `Helped ${who} build${place}.`;
    case 'refused_permission':
      return `Refused ${who} the use of a shelter${place}.`;
    case 'was_refused':
      return `Was turned away by ${who}${place}.`;
    case 'granted_permission':
      return `Let ${who} use a shelter${place}.`;
    case 'received_permission':
      return `Was given leave to use a shelter by ${who}${place}.`;
    case 'resource_discovered':
      return `Found something worth eating${place}.`;
    case 'explored':
      return `Went out as far as ${m.place ?? 'the edge of the valley'}.`;
    default:
      return `Remembers something${place}.`;
  }
}

/**
 * What this settler knows about the world — and only what *they* know.
 *
 * Reads their own `knownLandmarkIds` and `knownResourceIds`, which the
 * simulation fills in as they walk. A settler who has never left camp cannot
 * tell Kai about the Sunken Ring, and that constraint is the whole point: it is
 * what stops a conversational layer from quietly becoming an oracle.
 */
function knownFacts(world: World, s: Settler): string[] {
  const out: string[] = [];
  for (const id of s.knownLandmarkIds.slice(-DIALOGUE.maxKnownPlaces)) {
    out.push(`Has been to ${id.replace(/_/g, ' ')}.`);
  }
  const knownResources = s.knownResourceIds.length;
  if (knownResources > 0) out.push(`Knows where ${knownResources} food or material sites are.`);
  if (s.knowledge.length > 0) {
    out.push(`Trained in: ${s.knowledge.slice(0, 3).join(', ')}.`);
  }
  // Mission knowledge, but only what the colony would actually have been told.
  const m = world.mission;
  if (m && m.state === 'completed') {
    out.push('Knows Kai brought Dr. Maya Reyes back alive, and that an agriculture program has started.');
  } else if (m && (m.state === 'signalDetected' || m.state === 'tracking')) {
    out.push('Knows ARI picked up a distress signal somewhere out in the Riverlands.');
  }
  return out.slice(0, DIALOGUE.maxKnownFacts);
}

/** Anything dangerous close enough for this settler to be aware of. */
function nearbyDanger(world: World, s: Settler): string | null {
  for (const c of world.creatures) {
    if (!c.combat) continue;
    if (dist(c.pos, s.pos) < 40) return 'Something dangerous is not far off.';
  }
  if (s.needs.safety > 60) return 'Feels watched, though nothing is in sight.';
  return null;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Build the bounded context for one conversation turn.
 *
 * Everything here comes off the settler or the world's public state. Nothing
 * reads Creator Mode internals, the Chronicle, other settlers' minds, or the
 * player's inventory.
 */
export function buildDialogueContext(
  world: World,
  s: Settler,
  playerIntent: { intent: string; text: string } | null = null,
): DialogueContext {
  const rel = s.relationships.emerson;
  const speciesDef = INTELLIGENT_SPECIES[s.speciesId as IntelligentSpeciesId];
  const goal = describeGoal(world, s);
  const identity = identityOf(s.name);
  return {
    // Layer A. Read from the authored roster, never from simulation state, so
    // it says the same thing whether they are working or asleep.
    npc: {
      id: s.id,
      name: s.name,
      species: speciesDef.name,
      role: settlerRole(s),
      responsibility: identity?.responsibility ?? '',
      // Authored character where there is one; otherwise derived from the
      // procedural traits, so the Veyra and Caelari still read as themselves.
      personality: identity?.traits ?? personalityWords(s),
      expertise: identity?.expertise ?? [],
      values: identity?.values ?? [],
      outlook: identity?.outlook ?? '',
      location: placeName(s.pos),
      region: regionShortName(regionAt(s.pos.x, s.pos.z)),
    },
    // Layer B. Entirely the simulation's business.
    doing: {
      activity: goal.label,
      busy: goal.busy,
      needs: needWords(s),
      mood: moodWords(s),
      resting: s.resting,
    },
    // Layer C. Persists through whatever Layer B happens to be doing.
    priority: identity
      ? { goal: identity.goal, problem: identity.problem, aspiration: identity.aspiration }
      : null,
    relationship: {
      firstMeeting: !rel || rel.interactions === 0,
      familiarity: familiarityBand(rel?.familiarity ?? 0),
      trust: trustBand(rel?.trust ?? 0),
      affinity: affinityBand(rel?.affinity ?? 0),
      wary: (rel?.fear ?? 0) > 30,
      timesSpoken: rel?.interactions ?? 0,
    },
    memories: relevantMemories(world, s),
    knows: knownFacts(world, s),
    situation: {
      time: isNight(world.timeSec) ? 'night' : 'daytime',
      weather: world.weather === 'mist' ? 'misty' : 'clear',
      danger: nearbyDanger(world, s),
    },
    playerIntent,
  };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * What this person does.
 *
 * EDEN's NPCs are meant to become semi-autonomous and *purposeful*, and a role
 * is the smallest first step: something a character can be about, that dialogue
 * can draw on, before there is a profession system to hang it off.
 *
 * Assigned deterministically from the roster order and the settler's own
 * knowledge, never randomly — a colonist whose job changes between runs is a
 * colonist nobody can write for. Petra keeps the role the simulation already
 * gave her.
 */
/**
 * What this person's posting is.
 *
 * This used to be a hash of the entity id into a list of seven titles — stable,
 * but arbitrary: nobody had decided Selene was a surveyor, the arithmetic had.
 * Now it comes from the authored roster, which is why the settlers can hold a
 * conversation that sounds like it belongs to someone.
 */
export function settlerRole(s: Settler): string {
  const identity = identityOf(s.name);
  if (identity) return identity.role;
  if (s.speciesId !== 'human') {
    // The other two peoples are not part of the Eden Initiative and do not have
    // expedition postings. What they do is their own business.
    return `${INTELLIGENT_SPECIES[s.speciesId as IntelligentSpeciesId].name}`;
  }
  return 'Survivor';
}
