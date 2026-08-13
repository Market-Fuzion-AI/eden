import { MISSION } from './config';
import { rescueSurvivor } from './mission';
import type { World } from './types';

/**
 * Maya's conversation — EDEN's first authored dialogue.
 *
 * Everything the settlers say is *derived*: a greeting picked by affinity, a
 * line about their current goal, a line about a memory. That is the right shape
 * for twenty-two people living their own lives, and the wrong shape for the one
 * conversation the whole mission exists to arrive at. This one is written.
 *
 * It is also the smallest possible step toward the dialogue presentation EDEN
 * eventually wants — a named speaker, a portrait, lines advanced one at a time,
 * and somewhere for the player to answer. No branching engine, no dialogue
 * trees, no model in the loop. A script with one fork in it.
 *
 * The portrait is a slot, not art. `portraitId` names who should be shown and
 * `mood` names how; the UI draws a framed placeholder today and can draw a
 * painting tomorrow without this file changing.
 */

export type { ScriptLine as StoryLine };

export type DialogueMood = 'neutral' | 'relieved' | 'weary' | 'warm' | 'wry' | 'resolute';

export interface ScriptLine {
  /** Display name of whoever is speaking. */
  speaker: string;
  /** Portrait slot id, or null for the player's own lines. */
  portraitId: string | null;
  mood: DialogueMood;
  text: string;
}

export interface ScriptChoice {
  id: 'kind' | 'light' | 'practical';
  /** What the player picks. */
  label: string;
  /** What Kai actually says, once chosen. */
  spoken: string;
  /** Her reply. */
  reply: ScriptLine[];
  /**
   * A small, honest consequence. Recorded on the relationship the settlers
   * already use, because the mission should not invent a second one — but
   * bounded, so nothing in Gate 2 couples to the norm simulation.
   */
  affinity: number;
}

export interface DialogueScript {
  id: string;
  /** Lines before the choice. */
  opening: ScriptLine[];
  /** The one fork. Null for scripts without a choice. */
  choice: { prompt: string; options: ScriptChoice[] } | null;
  /** Lines after the choice resolves. */
  closing: ScriptLine[];
}

const MAYA = MISSION.survivorName;

/**
 * THE SIGNAL — the conversation at the wreck.
 *
 * Written to do three jobs in about a dozen lines: tell the player somebody
 * survived and what it cost her, tell them who she is in a way that matters to
 * the colony rather than to a character sheet, and give them one moment where
 * Kai is a person answering rather than a cursor collecting.
 */
export const SURVIVOR_SCRIPT: DialogueScript = {
  id: 'the-signal',
  opening: [
    {
      speaker: MAYA,
      portraitId: 'maya',
      mood: 'weary',
      text: 'Don\'t— sorry. Sorry. I heard something moving and I assumed it was the big one that comes down to the water.',
    },
    {
      speaker: MAYA,
      portraitId: 'maya',
      mood: 'relieved',
      text: 'You\'re Initiative. You\'re actually Initiative. I got the beacon up on the third day and it has been three days since then.',
    },
    {
      speaker: MAYA,
      portraitId: 'maya',
      mood: 'weary',
      text: 'I thought nobody was coming.',
    },
  ],
  choice: {
    prompt: 'Kai',
    options: [
      {
        id: 'kind',
        label: 'Nobody was going to leave you out here.',
        spoken: 'Nobody was going to leave you out here. It took us a while to hear you, that\'s all.',
        affinity: 8,
        reply: [
          {
            speaker: MAYA,
            portraitId: 'maya',
            mood: 'warm',
            text: 'You say that like it was obvious. From this side of it, it really wasn\'t.',
          },
        ],
      },
      {
        id: 'light',
        label: 'You had me at the third day.',
        spoken: 'Three days on a hand-cranked beacon? I\'d have given up on day one and started a new civilisation.',
        affinity: 5,
        reply: [
          {
            speaker: MAYA,
            portraitId: 'maya',
            mood: 'wry',
            text: 'Ha. God. Okay. First laugh in a week and it\'s at my expense — I\'ll take it.',
          },
        ],
      },
      {
        id: 'practical',
        label: 'Can you walk?',
        spoken: 'Can you walk? Human Landing is about a twenty-minute hike east, and I would rather do it in daylight.',
        affinity: 3,
        reply: [
          {
            speaker: MAYA,
            portraitId: 'maya',
            mood: 'resolute',
            text: 'I can walk. Ribs are unhappy about it, but they have been outvoted.',
          },
        ],
      },
    ],
  },
  closing: [
    {
      speaker: MAYA,
      portraitId: 'maya',
      mood: 'resolute',
      text: 'Maya Reyes. Agricultural systems — soil chemistry, closed-cycle growing, that sort of thing.',
    },
    {
      speaker: MAYA,
      portraitId: 'maya',
      mood: 'warm',
      text: 'Which sounds useless when you are sitting in a crater. Less useless once you are somewhere people intend to stay.',
    },
    {
      speaker: MAYA,
      portraitId: 'maya',
      mood: 'resolute',
      text: 'Get me back to your landing site and I will find you something to eat that isn\'t ration paste. Lead on.',
    },
  ],
};

/**
 * A conversation in progress.
 *
 * Lives on the world rather than in React so the mission can be played by the
 * headless test suite with no UI at all — which is exactly how the choice logic
 * below got tested.
 */
export interface ActiveDialogue {
  scriptId: string;
  /** Index into the flattened line list. */
  index: number;
  /** Lines revealed so far, in order. */
  lines: ScriptLine[];
  /** The pending choice, if the script is waiting on one. */
  choice: DialogueScript['choice'];
  /** What the player picked, once they have. */
  chosen: ScriptChoice['id'] | null;
  done: boolean;
}

/** Begin the survivor conversation, if the mission is at that point. */
export function beginSurvivorDialogue(world: World): ActiveDialogue | null {
  const m = world.mission;
  if (!m) return null;
  if (m.state !== 'survivorFound' && m.state !== 'survivorRescued' && m.state !== 'completed') return null;
  if (world.dialogueScript) return world.dialogueScript;

  // After the rescue she has one short thing to say and no choice attached —
  // re-opening a finished conversation must not re-run the fork.
  if (m.state !== 'survivorFound') {
    world.dialogueScript = {
      scriptId: 'the-signal-after',
      index: 0,
      lines: [
        {
          speaker: MAYA,
          portraitId: 'maya',
          mood: 'warm',
          text:
            m.state === 'completed'
              ? 'This ground drains better than it looks. Give me a season and I will give you a harvest.'
              : 'Right behind you. Slowly, but behind you.',
        },
      ],
      choice: null,
      chosen: null,
      done: true,
    };
    return world.dialogueScript;
  }

  world.dialogueScript = {
    scriptId: SURVIVOR_SCRIPT.id,
    index: 0,
    lines: [SURVIVOR_SCRIPT.opening[0]],
    choice: null,
    chosen: null,
    done: false,
  };
  return world.dialogueScript;
}

/**
 * Advance one line.
 *
 * Returns the conversation, or null once it has ended. The sequence is
 * opening → choice → the chosen reply → closing → rescued, and the choice is
 * presented only when the opening runs out, so the player has heard why she is
 * asking before they answer.
 */
export function advanceDialogue(world: World): ActiveDialogue | null {
  const d = world.dialogueScript;
  if (!d) return null;
  if (d.scriptId !== SURVIVOR_SCRIPT.id) {
    endDialogue(world);
    return null;
  }
  // Waiting on the player: advancing does nothing until they answer.
  if (d.choice && !d.chosen) return d;

  const script = SURVIVOR_SCRIPT;
  if (!d.chosen) {
    // Still in the opening.
    const next = d.index + 1;
    if (next < script.opening.length) {
      d.index = next;
      d.lines.push(script.opening[next]);
      return d;
    }
    // Opening finished — put the question to the player.
    d.choice = script.choice;
    return d;
  }

  // Past the choice: walk the closing lines, then finish.
  const closingIndex = d.index;
  if (closingIndex < script.closing.length) {
    d.lines.push(script.closing[closingIndex]);
    d.index = closingIndex + 1;
    return d;
  }
  endDialogue(world);
  return null;
}

/**
 * The player answers.
 *
 * Guarded so it can fire exactly once: `chosen` is set before anything else
 * happens, and every later call returns false. A double-click on a dialogue
 * button must not be able to say two things or pay affinity twice.
 */
export function chooseDialogueOption(world: World, id: ScriptChoice['id']): boolean {
  const d = world.dialogueScript;
  if (!d || d.chosen || !d.choice) return false;
  const option = d.choice.options.find((o) => o.id === id);
  if (!option) return false;

  d.chosen = id;
  d.choice = null;
  d.index = 0;
  d.lines.push({ speaker: 'Kai', portraitId: null, mood: 'neutral', text: option.spoken });
  for (const line of option.reply) d.lines.push(line);

  const m = world.mission;
  if (m) m.choiceMade = id;
  // Recorded on the relationship the settlers already use — the same shape, so
  // Maya is a person in this world rather than a special case attached to a
  // mission. Nothing beyond affinity is touched.
  world.flags.mayaAffinity = ((world.flags.mayaAffinity as number) ?? 0) + option.affinity;
  return true;
}

/** Close the conversation, and rescue her if that is what it accomplished. */
export function endDialogue(world: World): void {
  const d = world.dialogueScript;
  world.dialogueScript = null;
  if (!d) return;
  if (d.scriptId !== SURVIVOR_SCRIPT.id) return;
  // Only a conversation that actually reached the end rescues her. Walking away
  // halfway through leaves her exactly where she was.
  if (d.chosen && d.index >= SURVIVOR_SCRIPT.closing.length) rescueSurvivor(world);
}

/** True while the script is waiting for the player to answer. */
export function awaitingChoice(world: World): boolean {
  const d = world.dialogueScript;
  return Boolean(d && d.choice && !d.chosen);
}
