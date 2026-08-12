import { getWorld } from '../sim';
import { formatClock } from '../sim/chronicle';
import { placeName } from '../sim/landmarks';
import { regionAt, regionShortName } from '../sim/regions';
import { identifyFocus } from '../sim/identify';
import { getInteractions, harvestProgress } from '../sim/player';
import { MATERIALS } from '../sim/fabrication';
import { scanCooldownRemaining, scanWouldSpendCell } from '../sim/scanner';
import type { MaterialId } from '../sim/types';
import { useUI } from '../state/store';
import { inputState } from '../game/input';
import { DialoguePanel } from './DialoguePanel';
import { SummaryPanel } from './SummaryPanel';

/** Compass marks, laid out around the eight cardinal directions. */
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const COMPASS_TICKS = Array.from({ length: 24 }, (_, i) => {
  const deg = i * 15;
  return { deg, label: deg % 45 === 0 ? CARDINALS[(deg / 45) % 8] : null };
});

/**
 * Minimal in-world HUD.
 *
 * Six simulation-heavy milestones had quietly turned this into a readout. Live
 * Mode now shows only what a person exploring a world needs — where they are,
 * which way they are facing, what they can interact with, and what ARI has to
 * say. Everything diagnostic belongs to Creator Mode.
 */
export function LiveHUD() {
  useUI((s) => s.uiPulse);
  const ariLine = useUI((s) => s.ariLine);
  const paused = useUI((s) => s.paused);
  const speed = useUI((s) => s.speed);
  const learnedLook = useUI((s) => s.learnedLook);
  const helpOpen = useUI((s) => s.helpOpen);
  const dialogue = useUI((s) => s.dialogue);
  const summary = useUI((s) => s.summary);

  const world = getWorld();
  const p = world.player;
  const prompts = getInteractions(world);

  // ARI identifies whatever Emerson is actually looking at.
  const ident = identifyFocus(world, Math.sin(inputState.camYaw), Math.cos(inputState.camYaw));

  // Where Emerson is, and which way he is looking — the two things a
  // third-person explorer actually needs on screen at all times.
  // Recent pickups, shown briefly then dropped — no permanent inventory panel.
  const recentPickups = world.pickups.filter((x) => world.timeSec - x.at < 4);
  const carrying = (Object.keys(MATERIALS) as MaterialId[]).filter((id) => p.materials[id] > 0);
  const harvesting = harvestProgress(world);
  const scanCooldown = scanCooldownRemaining(world);
  const scanCell = scanWouldSpendCell(world);

  const region = regionShortName(regionAt(p.pos.x, p.pos.z));
  const place = placeName(p.pos);
  const heading = ((-inputState.camYaw * 180) / Math.PI + 360 * 4) % 360;
  const cardinal = CARDINALS[Math.round(heading / 45) % 8];

  return (
    <div className="hud">
      {/* Live Mode is a game, not a simulation dashboard: location, compass and
          time only. Sim speed, weather state and pause live in Creator Mode. */}
      <div className="hud-topleft">
        <div className="place-card">
          <div className="place-region">{region}</div>
          <div className="place-name">{place}</div>
        </div>
      </div>

      <div className="hud-topcenter">
        <div className="compass">
          <div className="compass-cardinal">{cardinal}</div>
          <div className="compass-strip">
            {COMPASS_TICKS.map((tick) => {
              // Position each mark relative to where the camera is facing.
              let delta = (tick.deg - heading + 540) % 360 - 180;
              if (Math.abs(delta) > 62) return null;
              return (
                <span
                  key={tick.deg}
                  className={`compass-tick ${tick.label ? 'major' : ''}`}
                  style={{ left: `${50 + (delta / 62) * 50}%` }}
                >
                  {tick.label ?? '·'}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <div className="hud-topright">
        <div className="clock-chip">{formatClock(world.timeSec)}</div>
        {p.unlocks.scanner && (
          <div className={`scan-chip ${scanCooldown <= 0 ? 'ready' : scanCell ? 'cell' : 'cooling'}`}>
            {scanCooldown <= 0
              ? 'Q · SCAN READY'
              : scanCell
                ? `Q · SPEND CELL (${Math.ceil(scanCooldown)}s)`
                : `SCAN ${Math.ceil(scanCooldown)}s`}
          </div>
        )}
        {paused && <div className="hint-chip warn">PAUSED</div>}
        {!paused && speed !== 1 && <div className="hint-chip">{speed}×</div>}
        <div className="hint-chip dim">TAB Creator · ESC Help</div>
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
          {carrying.length > 0 && (
            <div className="mat-row">
              {carrying.map((id) => (
                <span key={id} className="mat-chip">
                  <span className="fab-swatch" style={{ background: MATERIALS[id].color }} />
                  {p.materials[id]}
                </span>
              ))}
            </div>
          )}
          {(p.items.medkit > 0 || p.items.energyCell > 0) && (
            <div className="mat-row">
              {p.items.medkit > 0 && <span className="mat-chip item">✚ {p.items.medkit} · H</span>}
              {p.items.energyCell > 0 && <span className="mat-chip item">⬢ {p.items.energyCell}</span>}
            </div>
          )}
          {(p.wood > 0 || p.stone > 0) && (
            <div className="materials">
              {p.wood > 0 && <span>▣ Wood × {Math.round(p.wood)}</span>}
              {p.stone > 0 && <span>◆ Stone × {Math.round(p.stone)}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Material acquisition feedback — brief, then gone. */}
      {recentPickups.length > 0 && (
        <div className="pickup-feed">
          {recentPickups.map((x, i) => (
            <div key={`${x.at}-${i}`} className="pickup">
              <span className="fab-swatch" style={{ background: MATERIALS[x.materialId].color }} />
              +{x.amount} {MATERIALS[x.materialId].name}
            </div>
          ))}
        </div>
      )}

      <div className="hud-bottomcenter">
        {harvesting > 0 && (
          <div className="harvest-bar">
            <div className="harvest-fill" style={{ width: `${Math.round(harvesting * 100)}%` }} />
          </div>
        )}
        {prompts.map((pr) => (
          <div key={pr.key} className="prompt">
            <span className="prompt-key">{pr.key}</span> {pr.label}
          </div>
        ))}
        {/* Taught once, then retired for good. Looking around needs no click
            now, so this teaches the gesture rather than a mode. */}
        {!learnedLook && !helpOpen && !dialogue && !p.dead && (
          <div className="prompt look-hint">Swipe or drag to look · C recenters the camera</div>
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
