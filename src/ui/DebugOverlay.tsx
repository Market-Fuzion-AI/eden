import { getWorld } from '../sim';
import { perf } from '../game/loop';
import { useUI } from '../state/store';

export function DebugOverlay() {
  useUI((s) => s.uiPulse);
  const world = getWorld();
  const selectedId = useUI((s) => s.selectedId);
  return (
    <div className="debug panel">
      <div>fps {perf.fps} · ticks/s {perf.tps}</div>
      <div>seed {world.seed}</div>
      <div>t {world.timeSec.toFixed(1)}s</div>
      <div>
        entities {world.settlers.length + world.creatures.length + 1} · chronicle {world.chronicle.length}
      </div>
      <div>selected {selectedId ?? '—'}</div>
    </div>
  );
}
