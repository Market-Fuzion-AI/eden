import { useEffect, useRef } from 'react';
import { getWorld } from '../sim';
import {
  advanceDialogue,
  awaitingChoice,
  chooseDialogueOption,
  endDialogue,
  type ScriptChoice,
  type ScriptLine,
} from '../sim/survivorDialogue';
import { useUI } from '../state/store';

/**
 * The authored conversation panel.
 *
 * Distinct from `DialoguePanel`, which shows a settler's derived small talk and
 * the affinity it moved. This one is for the handful of conversations that are
 * *written*: a named speaker, a portrait, lines that arrive one at a time, and
 * somewhere for the player to answer.
 *
 * The portrait is a slot. `portraitId` names who should be shown; today that
 * draws a framed placeholder with an initial in it, and when the character art
 * exists it becomes an `<img>` and nothing else here changes. Building the frame
 * now is what keeps the layout honest — a panel designed without space for a
 * portrait is a panel that has to be redesigned when one arrives.
 *
 * Reads `world.dialogueScript` and writes nothing. Every advance and every
 * choice goes through the simulation, which is why the whole conversation can be
 * played by the headless test suite with no browser involved.
 */

/** Portrait placeholder. Swap the inner content for artwork when it exists. */
function Portrait({ line }: { line: ScriptLine }) {
  const id = line.portraitId;
  // The player's own lines have no portrait — Kai is the camera, not a face on
  // the other side of the conversation.
  if (!id) return null;
  return (
    <div className={`portrait mood-${line.mood}`} data-portrait={id}>
      <div className="portrait-frame">
        <div className="portrait-initial">{line.speaker.replace(/^Dr\.\s*/, '').charAt(0)}</div>
      </div>
      <div className="portrait-mood">{line.mood}</div>
    </div>
  );
}

export function StoryDialogue() {
  useUI((s) => s.uiPulse);
  const bump = useUI((s) => s.bumpPulse);
  const world = getWorld();
  const d = world.dialogueScript;
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the newest line in view as the conversation grows.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  if (!d) return null;
  const waiting = awaitingChoice(world);
  const last = d.lines[d.lines.length - 1];

  const advance = () => {
    advanceDialogue(world);
    bump();
  };
  const choose = (id: ScriptChoice['id']) => {
    chooseDialogueOption(world, id);
    bump();
  };
  const leave = () => {
    endDialogue(world);
    bump();
  };

  return (
    <div className="story-overlay">
      <div className="story panel">
        <div className="story-body">
          {last && <Portrait line={last} />}
          <div className="story-text">
            <div className="story-speaker">{last?.speaker}</div>
            <div className="story-lines" ref={scroller}>
              {d.lines.map((l, i) => (
                <div
                  key={i}
                  className={`story-line ${l.portraitId === null ? 'player' : ''} ${
                    i === d.lines.length - 1 ? 'current' : 'past'
                  }`}
                >
                  {l.portraitId === null && <span className="story-line-who">Kai</span>}
                  {l.text}
                </div>
              ))}
            </div>
          </div>
        </div>

        {waiting && d.choice && (
          <div className="story-choices">
            <div className="story-choice-prompt">{d.choice.prompt}</div>
            {d.choice.options.map((o) => (
              <button key={o.id} className="story-choice" onClick={() => choose(o.id)}>
                {o.label}
              </button>
            ))}
          </div>
        )}

        {!waiting && (
          <div className="story-footer">
            <button className="btn story-next" onClick={advance}>
              {d.done ? 'Close' : 'Continue'}
            </button>
            <span className="story-hint">Space · E to continue · Esc to step away</span>
          </div>
        )}
        {waiting && <div className="story-footer"><span className="story-hint">Choose a reply</span></div>}
        <button className="btn close-btn story-close" onClick={leave}>
          ✕
        </button>
      </div>
    </div>
  );
}
