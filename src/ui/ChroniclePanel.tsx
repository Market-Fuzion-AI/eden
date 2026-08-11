import { getWorld } from '../sim';
import { formatClockShort } from '../sim/chronicle';
import type { ChronicleEvent } from '../sim/types';
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

/** True when an event carries enough structure to be worth opening. */
export function eventIsInspectable(e: ChronicleEvent): boolean {
  return Boolean(e.pos || (e.actorIds && e.actorIds.length > 0) || e.cause?.length);
}

/** The world's own history, newest first. Click an entry to investigate it. */
export function ChroniclePanel() {
  useUI((s) => s.uiPulse);
  const selectedEvent = useUI((s) => s.selectedEvent);
  const selectEvent = useUI((s) => s.selectEvent);
  const select = useUI((s) => s.select);
  const requestFocus = useUI((s) => s.requestFocus);

  const world = getWorld();
  const events = [...world.chronicle].reverse();

  const open = (e: ChronicleEvent) => {
    if (!eventIsInspectable(e)) return;
    selectEvent(e);
    // Select the first participant that still exists, and fly to the scene.
    const actor = e.actorIds?.find((id) => id === 'emerson' || world.settlers.some((s) => s.id === id) || world.creatures.some((c) => c.id === id));
    if (actor) select(actor);
    if (e.pos) requestFocus(e.pos.x, e.pos.z);
  };

  return (
    <div className="chronicle panel">
      {events.length === 0 && <div className="creator-note">History has not begun yet.</div>}
      {events.map((e) => {
        const inspectable = eventIsInspectable(e);
        return (
          <div
            key={e.id}
            className={`chron-row ${inspectable ? 'clickable' : ''} ${selectedEvent?.id === e.id ? 'active' : ''}`}
            onClick={() => open(e)}
            title={inspectable ? 'Investigate this event' : undefined}
          >
            <span className="chron-time">{formatClockShort(e.t)}</span>
            <span className={`chron-cat cat-${e.category}`}>{CATEGORY_LABEL[e.category] ?? e.category}</span>
            <span className="chron-text">{e.text}</span>
          </div>
        );
      })}
    </div>
  );
}
