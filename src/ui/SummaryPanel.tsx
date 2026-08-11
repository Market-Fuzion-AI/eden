import type { TemporalSummary } from '../sim/summary';
import { useUI } from '../state/store';

/**
 * "What happened while time ran fast." Every figure comes from real
 * simulation state and real Chronicle events — the foundation of the future
 * century-scale projection report.
 */
export function SummaryPanel({ summary }: { summary: TemporalSummary }) {
  const setSummary = useUI((s) => s.setSummary);

  return (
    <div className="summary panel">
      <div className="summary-header">
        <div className="summary-elapsed">{summary.elapsedLabel}</div>
        <button className="btn close-btn" onClick={() => setSummary(null)}>
          ✕
        </button>
      </div>

      <div className="section-title">POPULATION</div>
      {summary.populationLines.map((l) => (
        <div key={l.label} className="summary-row">
          <span>{l.label}</span>
          <span className="summary-value">{l.value}</span>
        </div>
      ))}

      <div className="section-title">SETTLEMENT</div>
      {summary.settlementLines.map((l) => (
        <div key={l.label} className="summary-row">
          <span>{l.label}</span>
          <span className="summary-value">{l.value}</span>
        </div>
      ))}

      <div className="section-title">EVENTS</div>
      {summary.eventLines.map((l) => (
        <div key={l.label} className="summary-row">
          <span>{l.label}</span>
          <span className="summary-value">{l.value}</span>
        </div>
      ))}

      {summary.highlights.length > 0 && (
        <>
          <div className="section-title">NOTABLE</div>
          {summary.highlights.map((h) => (
            <div key={h.id} className="summary-highlight">
              {h.text}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
