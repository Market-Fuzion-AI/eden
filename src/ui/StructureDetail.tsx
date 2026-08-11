import { inspectStructure } from '../sim/inspect';
import { useUI } from '../state/store';

/**
 * Structure provenance. Every line here is read from the structure's own
 * record — who staked it and why, who carried what, when it finished, and who
 * keeps coming back. Nothing is reconstructed after the fact.
 */
export function StructureDetail({ id }: { id: string }) {
  useUI((s) => s.uiPulse);
  const selectStructure = useUI((s) => s.selectStructure);
  const select = useUI((s) => s.select);
  const requestFocus = useUI((s) => s.requestFocus);
  const data = inspectStructure(id);

  if (!data) {
    return (
      <div className="creator-right panel">
        <div className="section-title">STRUCTURE</div>
        <div className="creator-note">This structure is no longer standing.</div>
      </div>
    );
  }

  const complete = data.progressPct >= 100;

  return (
    <div className="creator-right panel inspector">
      <div className="insp-header">
        <div>
          <div className="insp-kind">STRUCTURE</div>
          <div className="insp-name">{data.name}</div>
          <div className="insp-place">◎ {data.place}</div>
        </div>
        <button className="btn close-btn" onClick={() => selectStructure(null)}>
          ✕
        </button>
      </div>

      <div className="section-title">STATUS</div>
      <div className={`struct-status ${complete ? 'done' : ''}`}>{data.status}</div>
      {!complete && (
        <div className="bar struct-bar">
          <div className="bar-fill tone-accent" style={{ width: `${data.progressPct}%` }} />
        </div>
      )}

      <div className="section-title">INITIATED BY</div>
      <button className="btn actor-chip" onClick={() => select(data.initiatorId)}>
        {data.initiatorName}
      </button>

      <div className="section-title">REASON</div>
      <div className="goal-why">
        {data.reason.map((line, i) => (
          <div key={i} className="why-line">
            {line}
          </div>
        ))}
      </div>

      <div className="section-title">CONTRIBUTORS</div>
      {data.contributors.length === 0 && <div className="creator-note">Nobody has delivered anything yet.</div>}
      {data.contributors.map((c) => (
        <button key={c.id} className="rel-row clickable" onClick={() => select(c.id)}>
          <span className="rel-name">{c.name}</span>
          <span className="struct-contrib">{c.line}</span>
          <span className="rel-chevron">›</span>
        </button>
      ))}

      <div className="section-title">MATERIALS</div>
      {data.materials.map((m) => (
        <div key={m} className="known-row">
          {m}
        </div>
      ))}

      <div className="section-title">BUILT</div>
      <div className="known-row">Started {data.startedLabel}</div>
      <div className="known-row">{complete ? `Completed ${data.builtLabel}` : data.builtLabel}</div>

      <div className="section-title">WHY HERE</div>
      <div className="goal-why">
        {data.locationReason.map((line, i) => (
          <div key={i} className="why-line">
            {line}
          </div>
        ))}
      </div>

      {data.recentUsers.length > 0 && (
        <>
          <div className="section-title">RECENT USERS · {data.useCount} VISITS</div>
          {data.recentUsers.map((u) => (
            <button key={u.id} className="rel-row clickable" onClick={() => select(u.id)}>
              <span className="rel-name">{u.name}</span>
              <span className="struct-contrib">{u.line}</span>
              <span className="rel-chevron">›</span>
            </button>
          ))}
        </>
      )}

      <div className="rel-actions">
        <button className="btn" onClick={() => requestFocus(data.pos.x, data.pos.z)}>
          ◎ Focus on this place
        </button>
      </div>
    </div>
  );
}
