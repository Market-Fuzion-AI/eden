import { inspect, type InspectorBar } from '../sim/inspect';
import { useUI } from '../state/store';

function Bar({ bar }: { bar: InspectorBar }) {
  return (
    <div className="insp-bar-row">
      <span className="insp-bar-label">{bar.label}</span>
      <div className="bar">
        <div className={`bar-fill tone-${bar.tone ?? 'accent'}`} style={{ width: `${Math.round(bar.value)}%` }} />
      </div>
      <span className="insp-bar-value">{Math.round(bar.value)}</span>
    </div>
  );
}

/** Right-hand entity inspector: identity, vitals, goal + WHY, mind, memory, bonds. */
export function Inspector() {
  useUI((s) => s.uiPulse);
  const selectedId = useUI((s) => s.selectedId);
  const select = useUI((s) => s.select);

  if (!selectedId) {
    return (
      <div className="creator-right panel empty-inspector">
        <div className="section-title">INSPECTOR</div>
        <div className="creator-note">Select an inhabitant to see its needs, goal and reasoning.</div>
      </div>
    );
  }

  const data = inspect(selectedId);
  if (!data) {
    return (
      <div className="creator-right panel empty-inspector">
        <div className="section-title">INSPECTOR</div>
        <div className="creator-note">This being is gone from the world.</div>
      </div>
    );
  }

  return (
    <div className="creator-right panel inspector">
      <div className="insp-header">
        <div>
          <div className="insp-name">{data.name}</div>
          <div className="insp-subtitle">{data.subtitle}</div>
          <div className="insp-kind">{data.kindLabel}</div>
          <div className="insp-place">◎ {data.place}</div>
        </div>
        <button className="btn close-btn" onClick={() => select(null)}>✕</button>
      </div>

      {data.trust && (
        <div className="trust-block">
          <div className="section-title">{data.trust.label}</div>
          <div className="bar trust-bar">
            <div className="bar-fill tone-trust" style={{ width: `${Math.round(data.trust.value)}%` }} />
          </div>
          <div className="trust-value">{Math.round(data.trust.value)} / 100</div>
        </div>
      )}

      <div className="section-title">CURRENT GOAL</div>
      <div className="goal-label">{data.goal.label}</div>
      <div className="goal-why">
        <div className="why-tag">WHY</div>
        {data.goal.reason.map((line, i) => (
          <div key={i} className="why-line">{line}</div>
        ))}
      </div>

      {data.scores.length > 0 && (
        <div className="score-row">
          {data.scores.slice(0, 5).map((s) => (
            <span key={s.goal} className="score-chip">
              {s.goal} {s.score}
            </span>
          ))}
        </div>
      )}

      <div className="section-title">VITALS</div>
      {data.vitals.map((b) => (
        <Bar key={b.label} bar={b} />
      ))}

      {data.needs.length > 0 && (
        <>
          <div className="section-title">NEEDS</div>
          {data.needs.map((b) => (
            <Bar key={b.label} bar={b} />
          ))}
        </>
      )}

      {data.personality.length > 0 && (
        <>
          <div className="section-title">PERSONALITY</div>
          {data.personality.map((b) => (
            <Bar key={b.label} bar={b} />
          ))}
        </>
      )}

      {data.relationships.length > 0 && (
        <>
          <div className="section-title">BONDS</div>
          {data.relationships.map((r) => (
            <div key={r.name} className="rel-row">
              <span className="rel-name">{r.name}</span>
              <span className={`rel-affinity ${r.affinity >= 0 ? 'pos' : 'neg'}`}>
                {r.affinity >= 0 ? '+' : ''}
                {r.affinity}
              </span>
              <span className="rel-count">{r.interactions}×</span>
            </div>
          ))}
        </>
      )}

      {data.memories.length > 0 && (
        <>
          <div className="section-title">RECENT MEMORIES</div>
          {data.memories.map((m, i) => (
            <div key={i} className="mem-row">
              <span className="mem-text">{m.text}</span>
              <span className="mem-ago">{m.ago}</span>
            </div>
          ))}
        </>
      )}

      {data.known.length > 0 && (
        <>
          <div className="section-title">KNOWN</div>
          {data.known.map((k, i) => (
            <div key={i} className="known-row">{k}</div>
          ))}
        </>
      )}
    </div>
  );
}
