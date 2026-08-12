import {
  inspect,
  localExpectationsOf,
  socialKnowledgeOf,
  structureExpectationsOf,
  type InspectorBar,
} from '../sim/inspect';
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
  const openRelationship = useUI((s) => s.openRelationship);
  const selectStructure = useUI((s) => s.selectStructure);

  if (!selectedId) {
    return (
      <div className="creator-right panel empty-inspector">
        <div className="section-title">INSPECTOR</div>
        <div className="creator-note">Select an inhabitant to see its needs, goal and reasoning.</div>
      </div>
    );
  }

  const data = inspect(selectedId);
  const expectations = structureExpectationsOf(selectedId);
  const knowledge = socialKnowledgeOf(selectedId);
  const local = localExpectationsOf(selectedId);
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

      {/* Live combat state. Only appears on things that can be in a fight, so
          the fight can be debugged while it is happening rather than after. */}
      {data.combat && (
        <>
          <div className="section-title">COMBAT STATE</div>
          <div className="combat-state">
            <span className={`combat-chip s-${data.combat.state.replace(/\s+/g, '-')}`}>
              {data.combat.state.toUpperCase()}
            </span>
            <span className="combat-timer">{data.combat.forSeconds.toFixed(1)}s</span>
            {data.combat.distance > 0 && (
              <span className="combat-timer">{Math.round(data.combat.distance)}m to Emerson</span>
            )}
          </div>
          {data.combat.lines.map((line, i) => (
            <div key={i} className="known-row">{line}</div>
          ))}
        </>
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
            <button
              key={r.otherId}
              className="rel-row clickable"
              onClick={() => openRelationship(selectedId, r.otherId)}
              title="Open relationship history"
            >
              <span className="rel-name">{r.name}</span>
              <span className={`rel-state state-${r.state.toLowerCase()}`}>{r.state}</span>
              <span className={`rel-affinity ${r.affinity >= 0 ? 'pos' : 'neg'}`}>
                {r.affinity >= 0 ? '+' : ''}
                {r.affinity}
              </span>
              <span className="rel-chevron">›</span>
            </button>
          ))}
        </>
      )}

      {expectations.length > 0 && (
        <>
          <div className="section-title">STRUCTURES</div>
          {expectations.map((e) => (
            <div key={e.structureId} className="claim-block">
              <button className="claim-head" onClick={() => selectStructure(e.structureId)}>
                <span className="rel-name">
                  {e.name} · {e.place}
                </span>
                <span className={`rel-state claim-${e.kind}`}>{e.label}</span>
                <span className="rel-chevron">›</span>
              </button>
              <div className="claim-why">
                {e.why.slice(0, 4).map((w, i) => (
                  <div key={i} className="why-line">
                    {w}
                  </div>
                ))}
                {e.permissionNote && <div className="why-line dim">{e.permissionNote}</div>}
              </div>
            </div>
          ))}
        </>
      )}

      {knowledge.length > 0 && (
        <>
          {/* Everything in this block is what one person *thinks*. The heading
              names them on purpose: none of it is a fact about the world, and
              some of it is out of date or was never right. */}
          <div className="section-title">WHAT {data.name.toUpperCase()} BELIEVES OTHERS EXPECT</div>
          <div className="belief-disclaimer">
            {data.name}&rsquo;s own picture of other people — not the truth of the matter.
          </div>
          {knowledge.map((k, i) => (
            <div key={i} className="belief-block">
              <button className="belief-head" onClick={() => selectStructure(k.structureId)}>
                <span className="rel-name">{k.belief}</span>
                <span className="rel-chevron">›</span>
              </button>
              <div className="belief-meta">
                <span className={`belief-kind claim-${k.kind}`}>{k.structureName} · {k.place}</span>
                <span className="belief-conf">
                  <span className="bar belief-bar">
                    <span className="bar-fill tone-trust" style={{ width: `${k.confidence}%` }} />
                  </span>
                  {k.confidence}% sure
                </span>
              </div>
              <div className="belief-source">
                {k.secondHand ? `↝ ${k.provenance}` : `👁 ${k.provenance}`}
                {k.confirmations > 0 && ` · confirmed ${k.confirmations}×`}
                {` · last seen ${k.confirmedAgo}`}
                {k.stale && <span className="belief-stale"> · may be out of date</span>}
              </div>
            </div>
          ))}
        </>
      )}

      {local.length > 0 && (
        <>
          <div className="section-title">LOCAL EXPECTATIONS</div>
          <div className="belief-disclaimer">
            Generalizations {data.name} has drawn personally. Others may have drawn different ones.
          </div>
          {local.map((c, i) => (
            <div key={i} className="custom-block">
              <div className="custom-statement">{c.statement}</div>
              <div className="belief-meta">
                <span className="belief-conf">
                  <span className="bar belief-bar">
                    <span className="bar-fill tone-accent" style={{ width: `${c.confidence}%` }} />
                  </span>
                  {c.confidence > 0 ? `${c.confidence}% sure` : 'not yet a pattern'}
                </span>
                <span className="custom-evidence">
                  {c.supporting} for · {c.contradicting} against · {c.observations} seen
                </span>
              </div>
              <div className="belief-source">
                Defers to local habit: {c.conformity}/100 · first noticed {c.heldFor}
              </div>
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
