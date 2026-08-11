import { formatClock } from '../sim/chronicle';
import type { ChronicleEvent } from '../sim/types';
import { useUI } from '../state/store';

/**
 * Event Detail: what happened, who was involved, where, why, and what
 * changed — read straight from the event's structured payload rather than
 * parsed back out of its prose.
 */
export function EventDetail({ event }: { event: ChronicleEvent }) {
  const selectEvent = useUI((s) => s.selectEvent);
  const select = useUI((s) => s.select);
  const selectStructure = useUI((s) => s.selectStructure);
  const requestFocus = useUI((s) => s.requestFocus);

  return (
    <div className="event-detail panel">
      <div className="insp-header">
        <div>
          <div className="insp-kind">EVENT · {formatClock(event.t)}</div>
          <div className="evt-text">{event.text}</div>
        </div>
        <button className="btn close-btn" onClick={() => selectEvent(null)}>
          ✕
        </button>
      </div>

      {event.actorNames && event.actorNames.length > 0 && (
        <>
          <div className="section-title">WHO</div>
          <div className="evt-actors">
            {event.actorNames.map((name, i) => {
              const id = event.actorIds?.[i];
              return (
                <button
                  key={`${name}-${i}`}
                  className="btn actor-chip"
                  onClick={() => id && select(id)}
                  disabled={!id}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </>
      )}

      {event.place && (
        <>
          <div className="section-title">WHERE</div>
          <button
            className="btn place-chip"
            onClick={() => event.pos && requestFocus(event.pos.x, event.pos.z)}
            disabled={!event.pos}
          >
            ◎ {event.place}
          </button>
        </>
      )}

      {event.structureId && (
        <>
          <div className="section-title">STRUCTURE</div>
          <button className="btn place-chip" onClick={() => selectStructure(event.structureId!)}>
            ⌂ Open its full history
          </button>
        </>
      )}

      {event.cause && event.cause.length > 0 && (
        <>
          <div className="section-title">WHY IT HAPPENED</div>
          <div className="goal-why">
            {event.cause.map((line, i) => (
              <div key={i} className="why-line">
                {line}
              </div>
            ))}
          </div>
        </>
      )}

      {event.effects && event.effects.length > 0 && (
        <>
          <div className="section-title">WHAT CHANGED</div>
          {event.effects.map((line, i) => (
            <div key={i} className="evt-effect">
              {line}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
