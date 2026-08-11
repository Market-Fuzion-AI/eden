import { getWorld } from '../sim';
import { formatClockShort } from '../sim/chronicle';
import { useUI } from '../state/store';

const CATEGORY_LABEL: Record<string, string> = {
  system: 'WORLD',
  discovery: 'DISCOVERY',
  social: 'SOCIAL',
  lumi: 'LUMI',
  wildlife: 'WILDLIFE',
  emerson: 'EMERSON',
  creator: 'CREATOR',
};

/** The Chronicle: the world's own history, newest first. */
export function ChroniclePanel() {
  useUI((s) => s.uiPulse);
  const world = getWorld();
  const events = [...world.chronicle].reverse();

  return (
    <div className="chronicle panel">
      {events.length === 0 && <div className="creator-note">History has not begun yet.</div>}
      {events.map((e) => (
        <div key={e.id} className="chron-row">
          <span className="chron-time">{formatClockShort(e.t)}</span>
          <span className={`chron-cat cat-${e.category}`}>{CATEGORY_LABEL[e.category] ?? e.category}</span>
          <span className="chron-text">{e.text}</span>
        </div>
      ))}
    </div>
  );
}
