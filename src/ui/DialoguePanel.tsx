import type { DialogueExchange } from '../sim/dialogue';
import { useUI } from '../state/store';

/**
 * Compact conversation panel. The lines are derived from the settler's live
 * simulation state; the footer shows the relationship this exchange actually
 * moved, so the player can see that talking changed something real.
 */
export function DialoguePanel({ exchange }: { exchange: DialogueExchange }) {
  const close = useUI((s) => s.closeDialogue);

  return (
    <div className="dialogue panel">
      <div className="dlg-header">
        <div>
          <div className="dlg-name">{exchange.name}</div>
          <div className="dlg-species">{exchange.speciesLabel}</div>
        </div>
        <button className="btn close-btn" onClick={close}>
          ✕
        </button>
      </div>
      <div className="dlg-lines">
        {exchange.lines.map((l, i) => (
          <div key={i} className="dlg-line" style={{ animationDelay: `${i * 0.28}s` }}>
            {l.text}
          </div>
        ))}
      </div>
      {/*
        No relationship telemetry.

        This panel used to end with "Affinity toward you +7", which taught the
        player to read a number instead of a person. How somebody feels about
        Kai is now something you infer from what they say and how they treat
        him. The values still exist and are still inspectable — in Creator Mode,
        where they are a developer's instrument rather than the player's
        feedback loop.
      */}
      {exchange.firstMeeting && (
        <div className="dlg-footer">
          <span className="dlg-tag">FIRST MEETING</span>
        </div>
      )}
    </div>
  );
}
