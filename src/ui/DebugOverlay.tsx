import { getWorld } from '../sim';
import { perf } from '../game/loop';
import { useUI } from '../state/store';

export function DebugOverlay() {
  useUI((s) => s.uiPulse);
  const world = getWorld();
  const selectedId = useUI((s) => s.selectedId);
  const speed = useUI((s) => s.speed);
  const paused = useUI((s) => s.paused);
  // Achieved sim rate vs requested — makes any frame-rate throttling visible.
  const requested = paused ? 0 : speed;
  const lagging = !paused && perf.simRate > 0 && perf.simRate < requested * 0.8;
  return (
    <div className="debug panel">
      <div>fps {perf.fps} · ticks/s {perf.tps}</div>
      <div className={lagging ? 'debug-warn' : undefined}>
        sim {perf.simRate.toFixed(1)}× / {requested}× {lagging ? '(throttled)' : ''}
      </div>
      <div>seed {world.seed}</div>
      <div>t {world.timeSec.toFixed(1)}s</div>
      <div>
        entities {world.settlers.length + world.creatures.length + 1} · chronicle {world.chronicle.length}
      </div>
      <div>selected {selectedId ?? '—'}</div>
    </div>
  );
}
