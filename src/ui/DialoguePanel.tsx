import type { DialogueExchange } from '../sim/dialogue';
import { useUI } from '../state/store';

/**
 * Compact conversation panel. The lines are derived from the settler's live
 * simulation state; the footer shows the relationship this exchange actually
 * moved, so the player can see that talking changed something real.
 */
export function DialoguePanel({ exchange }: { exchange: DialogueExchange }) {
  const close = useUI((s) => s.closeDialogue);
  const affinity = Math.round(exchange.affinity);

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
      <div className="dlg-footer">
        {exchange.firstMeeting && <span className="dlg-tag">FIRST MEETING</span>}
        <span className="dlg-affinity">
          Affinity toward you{' '}
          <strong className={affinity >= 0 ? 'pos' : 'neg'}>
            {affinity >= 0 ? '+' : ''}
            {affinity}
          </strong>
        </span>
      </div>
    </div>
  );
}
