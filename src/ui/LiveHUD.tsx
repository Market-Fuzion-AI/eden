import { getWorld } from '../sim';
import { formatClock } from '../sim/chronicle';
import { getInteractions } from '../sim/player';
import { CREATURE_SPECIES_BY_ID, INTELLIGENT_SPECIES } from '../sim/species';
import type { IntelligentSpeciesId } from '../sim/types';
import { dist } from '../sim/vec';
import { useUI } from '../state/store';

/** Minimal in-world HUD. The 3D world dominates; panels stay out of the way. */
export function LiveHUD() {
  useUI((s) => s.uiPulse);
  const ariLine = useUI((s) => s.ariLine);
  const paused = useUI((s) => s.paused);
  const speed = useUI((s) => s.speed);
  const locked = useUI((s) => s.pointerLocked);
  const helpOpen = useUI((s) => s.helpOpen);

  const world = getWorld();
  const p = world.player;
  const prompts = getInteractions(world);

  // ARI proximity scan: nearest lifeform in front of Emerson.
  let scanLabel: string | null = null;
  let bestD = 9;
  for (const s of world.settlers) {
    const d = dist(s.pos, p.pos);
    if (d < bestD) {
      bestD = d;
      scanLabel = `${s.name} — ${INTELLIGENT_SPECIES[s.speciesId as IntelligentSpeciesId].name}`;
    }
  }
  for (const c of world.creatures) {
    const d = dist(c.pos, p.pos);
    if (d < bestD) {
      bestD = d;
      scanLabel = c.lumi
        ? `${c.name} — Unknown native lifeform`
        : `${CREATURE_SPECIES_BY_ID[c.speciesId].name} — Native lifeform`;
    }
  }

  return (
    <div className="hud">
      <div className="hud-topleft panel">
        <div className="wordmark">EDEN</div>
        <div className="clock">{formatClock(world.timeSec)}</div>
        <div className="env-status">
          {world.weather === 'mist' ? 'MIST' : 'CLEAR'} · {paused ? 'PAUSED' : `${speed}×`}
        </div>
      </div>

      <div className="hud-topright">
        <div className="hint-chip">TAB — Creator Mode</div>
        <div className="hint-chip dim">ESC — Help / Pause</div>
      </div>

      <div className="hud-bottomleft">
        {ariLine && (
          <div className="ari panel">
            <span className="ari-tag">ARI</span>
            <span className="ari-text">{ariLine}</span>
          </div>
        )}
        <div className="vitals panel">
          <div className="vital-row">
            <span className="vital-label">VIT</span>
            <div className="bar">
              <div className="bar-fill hp" style={{ width: `${p.health}%` }} />
            </div>
          </div>
          <div className="vital-row">
            <span className="vital-label">STA</span>
            <div className="bar">
              <div className="bar-fill sta" style={{ width: `${p.stamina}%` }} />
            </div>
          </div>
          {p.berries > 0 && <div className="berries">◉ Glowberries × {p.berries}</div>}
        </div>
      </div>

      <div className="hud-bottomcenter">
        {scanLabel && <div className="scan-label">{scanLabel}</div>}
        {prompts.map((pr) => (
          <div key={pr.key} className="prompt">
            <span className="prompt-key">{pr.key}</span> {pr.label}
          </div>
        ))}
        {!locked && !helpOpen && !p.dead && <div className="prompt dim">Click to take control</div>}
      </div>

      {p.dead && (
        <div className="death-overlay">
          <div className="death-text">SIGNAL LOST</div>
          <div className="death-sub">reviving field engaged…</div>
        </div>
      )}
    </div>
  );
}
