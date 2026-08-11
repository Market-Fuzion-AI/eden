import { getWorld } from '../sim';
import { formatClock } from '../sim/chronicle';
import { creatorSetHour, creatorToggleWeather } from '../sim/creator';
import { useUI, type SimSpeed } from '../state/store';
import { ChroniclePanel } from './ChroniclePanel';
import { EventDetail } from './EventDetail';
import { Inspector } from './Inspector';
import { SummaryPanel } from './SummaryPanel';

/** Creator Mode: sovereign view. Inspection first, interventions second. */
export function CreatorUI() {
  useUI((s) => s.uiPulse);
  const paused = useUI((s) => s.paused);
  const speed = useUI((s) => s.speed);
  const seed = useUI((s) => s.seed);
  const spawnArmed = useUI((s) => s.spawnFoodArmed);
  const chronicleOpen = useUI((s) => s.chronicleOpen);
  const selectedEvent = useUI((s) => s.selectedEvent);
  const summary = useUI((s) => s.summary);
  const setPaused = useUI((s) => s.setPaused);
  const setSpeed = useUI((s) => s.setSpeed);
  const setSpawnFoodArmed = useUI((s) => s.setSpawnFoodArmed);
  const toggleChronicle = useUI((s) => s.toggleChronicle);
  const setMode = useUI((s) => s.setMode);

  const world = getWorld();

  const speedBtn = (s: SimSpeed, label: string) => (
    <button className={`btn ${!paused && speed === s ? 'active' : ''}`} onClick={() => setSpeed(s)}>
      {label}
    </button>
  );

  return (
    <div className="hud creator">
      <div className="hud-topleft panel creator-banner">
        <div className="wordmark creator-mark">EDEN · CREATOR</div>
        <div className="clock">{formatClock(world.timeSec)}</div>
        <div className="env-status">SEED {seed}</div>
      </div>

      <div className="hud-topright">
        <button className="btn return-btn" onClick={() => setMode('live')}>
          ⏎ Return to Live (Tab)
        </button>
      </div>

      <div className="creator-left panel">
        <div className="section-title">TIME</div>
        <div className="btn-row">
          <button className={`btn ${paused ? 'active' : ''}`} onClick={() => setPaused(!paused)}>
            ⏸
          </button>
          {speedBtn(1, '1×')}
          {speedBtn(5, '5×')}
          {speedBtn(20, '20×')}
        </div>

        <div className="section-title">SKY</div>
        <div className="btn-row">
          <button className="btn" onClick={() => creatorSetHour(world, 6, 'dawn')}>Dawn</button>
          <button className="btn" onClick={() => creatorSetHour(world, 12, 'noon')}>Noon</button>
          <button className="btn" onClick={() => creatorSetHour(world, 19, 'dusk')}>Dusk</button>
          <button className="btn" onClick={() => creatorSetHour(world, 0, 'midnight')}>Night</button>
        </div>

        <div className="section-title">WORLD</div>
        <div className="btn-col">
          <button className="btn" onClick={() => creatorToggleWeather(world)}>
            {world.weather === 'mist' ? 'Clear the mist' : 'Summon mist'}
          </button>
          <button className={`btn ${spawnArmed ? 'armed' : ''}`} onClick={() => setSpawnFoodArmed(!spawnArmed)}>
            {spawnArmed ? '◉ Click ground to place…' : 'Spawn glowberry patch'}
          </button>
        </div>

        <div className="creator-note">
          Click any inhabitant to inspect its mind.
          <br />
          Drag to pan · right-drag to orbit · wheel to zoom.
        </div>

        <div className="section-title">POPULATION</div>
        <div className="pop-row">
          <span>{world.settlers.length} settlers</span>
          <span>{world.creatures.length} native lifeforms</span>
        </div>
      </div>

      {summary && <SummaryPanel summary={summary} />}

      {selectedEvent ? <EventDetail event={selectedEvent} /> : <Inspector />}

      <div className={`chronicle-dock ${chronicleOpen ? 'open' : ''}`}>
        <button className="btn chronicle-toggle" onClick={toggleChronicle}>
          {chronicleOpen ? '▾ CHRONICLE' : '▴ CHRONICLE'}
        </button>
        {chronicleOpen && <ChroniclePanel />}
      </div>
    </div>
  );
}
