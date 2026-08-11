import { formatClockShort } from '../sim/chronicle';
import { inspectRelationship } from '../sim/inspect';
import { useUI } from '../state/store';

function Dim({ label, value, max = 100, signed = false }: { label: string; value: number; max?: number; signed?: boolean }) {
  // Signed dimensions (affinity) render from a centre line; the rest fill from the left.
  const pct = signed ? (Math.abs(value) / max) * 50 : (value / max) * 100;
  return (
    <div className="reldim">
      <span className="reldim-label">{label}</span>
      <div className="reldim-bar">
        {signed && <div className="reldim-center" />}
        <div
          className={`reldim-fill ${signed ? (value >= 0 ? 'pos' : 'neg') : 'plain'}`}
          style={signed ? { width: `${pct}%`, left: value >= 0 ? '50%' : `${50 - pct}%` } : { width: `${pct}%`, left: 0 }}
        />
      </div>
      <span className="reldim-value">
        {signed && value > 0 ? '+' : ''}
        {value}
      </span>
    </div>
  );
}

/**
 * Relationship drill-down: the four dimensions, the derived state, how the
 * relationship is currently biasing goal selection, and the recorded history
 * of every change — all read from stored events, never fabricated.
 */
export function RelationshipDetail({ subjectId, otherId }: { subjectId: string; otherId: string }) {
  useUI((s) => s.uiPulse);
  const closeRelationship = useUI((s) => s.closeRelationship);
  const select = useUI((s) => s.select);
  const data = inspectRelationship(subjectId, otherId);

  if (!data) {
    return (
      <div className="creator-right panel">
        <div className="section-title">RELATIONSHIP</div>
        <div className="creator-note">No relationship on record.</div>
        <button className="btn" onClick={closeRelationship}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="creator-right panel inspector">
      <div className="insp-header">
        <div>
          <div className="insp-kind">RELATIONSHIP</div>
          <div className="rel-pair">
            {data.subjectName} <span className="rel-arrow">→</span> {data.name}
          </div>
          <div className={`rel-state-big state-${data.state.toLowerCase()}`}>{data.state}</div>
        </div>
        <button className="btn close-btn" onClick={closeRelationship}>
          ✕
        </button>
      </div>

      <div className="section-title">DIMENSIONS</div>
      <Dim label="Affinity" value={data.affinity} signed />
      <Dim label="Trust" value={data.trust} />
      <Dim label="Familiarity" value={data.familiarity} />
      <Dim label="Fear" value={data.fear} />
      <div className="rel-meta">
        {data.interactions} interaction{data.interactions === 1 ? '' : 's'} · first met{' '}
        {formatClockShort(data.firstMetAt)}
      </div>

      {data.influence.length > 0 && (
        <>
          <div className="section-title">HOW IT STEERS THEM</div>
          <div className="goal-why">
            {data.influence.map((line, i) => (
              <div key={i} className="why-line">
                {line}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title">KEY HISTORY</div>
      {data.history.length === 0 && <div className="creator-note">Nothing recorded yet.</div>}
      {data.history.map((h, i) => (
        <div key={i} className="relhist">
          <div className="relhist-when">{h.when}</div>
          <div className="relhist-text">{h.text}</div>
          {h.deltas.length > 0 && (
            <div className="relhist-deltas">
              {h.deltas.map((d) => (
                <span key={d} className={`relhist-delta ${d.includes('-') ? 'neg' : 'pos'}`}>
                  {d}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="rel-actions">
        <button className="btn" onClick={closeRelationship}>
          ‹ Back to {data.subjectName}
        </button>
        <button className="btn" onClick={() => select(otherId)}>
          Inspect {data.name} ›
        </button>
      </div>
    </div>
  );
}
