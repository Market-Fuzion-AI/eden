import { getWorld } from '../sim';
import { formatClock } from '../sim/chronicle';
import { identifyFocus } from '../sim/identify';
import { getInteractions } from '../sim/player';
import { useUI } from '../state/store';
import { inputState } from '../game/input';
import { DialoguePanel } from './DialoguePanel';
import { SummaryPanel } from './SummaryPanel';

/** Minimal in-world HUD. The 3D world dominates; panels stay out of the way. */
export function LiveHUD() {
  useUI((s) => s.uiPulse);
  const ariLine = useUI((s) => s.ariLine);
  const paused = useUI((s) => s.paused);
  const speed = useUI((s) => s.speed);
  const locked = useUI((s) => s.pointerLocked);
  const learnedLook = useUI((s) => s.learnedLook);
  const helpOpen = useUI((s) => s.helpOpen);
  const dialogue = useUI((s) => s.dialogue);
  const summary = useUI((s) => s.summary);

  const world = getWorld();
  const p = world.player;
  const prompts = getInteractions(world);

  // ARI identifies whatever Emerson is actually looking at.
  const ident = identifyFocus(world, Math.sin(inputState.camYaw), Math.cos(inputState.camYaw));

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
        <div className="hint-chip dim">ESC — Help</div>
      </div>

      {ident && (
        <div className={`ident-card ${ident.notable ? 'notable' : ''}`}>
          <div className="ident-name">{ident.name}</div>
          <div className="ident-line">{ident.line}</div>
          <div className="ident-disp">
            <span className="ident-disp-label">Disposition</span> {ident.disposition}
          </div>
        </div>
      )}

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
          {(p.wood > 0 || p.stone > 0) && (
            <div className="materials">
              {p.wood > 0 && <span>▣ Wood × {Math.round(p.wood)}</span>}
              {p.stone > 0 && <span>◆ Stone × {Math.round(p.stone)}</span>}
            </div>
          )}
        </div>
      </div>

      <div className="hud-bottomcenter">
        {prompts.map((pr) => (
          <div key={pr.key} className="prompt">
            <span className="prompt-key">{pr.key}</span> {pr.label}
          </div>
        ))}
        {/* Taught once, then retired for good. */}
        {!locked && !learnedLook && !helpOpen && !dialogue && !p.dead && (
          <div className="prompt look-hint">Click to look around · Esc releases the mouse</div>
        )}
      </div>

      {dialogue && <DialoguePanel exchange={dialogue} />}
      {summary && <SummaryPanel summary={summary} />}

      {p.dead && (
        <div className="death-overlay">
          <div className="death-text">SIGNAL LOST</div>
          <div className="death-sub">reviving field engaged…</div>
        </div>
      )}
    </div>
  );
}
