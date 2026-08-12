import { getWorld } from '../sim';
import { formatClock } from '../sim/chronicle';
import { inCombat, lockedTarget } from '../sim/combat';
import { placeName } from '../sim/landmarks';
import { CREATURE_SPECIES_BY_ID } from '../sim/species';
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

  // Combat state, read straight off the simulation. Nothing here is owned by
  // React — the HUD is a view of the fight, not a participant in it.
  const fighting = inCombat(world);
  const hurtFlash = Math.max(0, 1 - (world.timeSec - p.lastHurtAt) / 0.9);
  const lowHealth = p.health <= 30 && !p.dead;
  const locked = lockedTarget(world);
  const lockedDef = locked ? CREATURE_SPECIES_BY_ID[locked.speciesId] : null;
  const lockedMax = lockedDef?.dangerous?.health ?? 100;
  const recentSalvage = world.pickupsSalvage.filter((x) => world.timeSec - x.at < 5);

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
        <div className={`ident-card ${ident.notable ? 'notable' : ''} ${ident.dangerous ? 'danger' : ''}`}>
          <div className="ident-name">{ident.name}</div>
          <div className="ident-line">{ident.line}</div>
          {/* A creature that can actually fight shows its condition, so the
              player can tell "nearly down" from "barely scratched". */}
          {ident.healthFrac !== undefined && (
            <div className="ident-hp">
              <div className="ident-hp-fill" style={{ width: `${Math.round(ident.healthFrac * 100)}%` }} />
            </div>
          )}
          <div className="ident-disp">
            <span className="ident-disp-label">Disposition</span> {ident.disposition}
          </div>
          {/* The scanner read-out. Without the Pathfinder installed Emerson
              gets the shape and the posture and has to make his own call. */}
          {ident.scan && (
            <div className="ident-scan">
              <span className={`ident-cat ${ident.scan.category.toLowerCase()}`}>{ident.scan.category}</span>
              <span className={`ident-threat t-${ident.scan.threat.toLowerCase()}`}>{ident.scan.threat}</span>
            </div>
          )}
        </div>
      )}

      {/* Damage vignette — pure feedback, driven by the sim's last-hurt stamp. */}
      {hurtFlash > 0 && <div className="hurt-vignette" style={{ opacity: hurtFlash }} />}
      {lowHealth && !p.extraction && <div className="hurt-vignette critical" />}

      <div className="hud-bottomleft">
        {ariLine && (
          <div className="ari panel">
            <span className="ari-tag">ARI</span>
            <span className="ari-text">{ariLine}</span>
          </div>
        )}
        <div className={`vitals panel ${fighting ? 'engaged' : ''} ${lowHealth ? 'critical' : ''}`}>
          {/* Health gets bigger and louder the moment it matters. Out of a
              fight it stays a thin line; in one it is the loudest thing here. */}
          <div className={`vital-row vital-hp ${fighting || lowHealth ? 'prominent' : ''}`}>
            <span className="vital-label">VIT</span>
            <div className="bar">
              <div className="bar-fill hp" style={{ width: `${p.health}%` }} />
            </div>
            {(fighting || lowHealth) && <span className="vital-num">{Math.round(p.health)}</span>}
          </div>
          <div className="vital-row">
            <span className="vital-label">STA</span>
            <div className="bar">
              <div className="bar-fill sta" style={{ width: `${p.stamina}%` }} />
            </div>
          </div>
          {p.salvage.coreFragment > 0 && (
            <div className="mat-row">
              <span className="mat-chip synth">◈ Core Fragment × {p.salvage.coreFragment}</span>
            </div>
          )}
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
      {(recentPickups.length > 0 || recentSalvage.length > 0) && (
        <div className="pickup-feed">
          {recentPickups.map((x, i) => (
            <div key={`${x.at}-${i}`} className="pickup">
              <span className="fab-swatch" style={{ background: MATERIALS[x.materialId].color }} />
              +{x.amount} {MATERIALS[x.materialId].name}
            </div>
          ))}
          {recentSalvage.map((x, i) => (
            <div key={`salv-${x.at}-${i}`} className="pickup synth">
              <span className="fab-swatch" style={{ background: '#7fe7ff' }} />
              +{x.amount} Synthetic Core Fragment
            </div>
          ))}
        </div>
      )}

      {/* Locked target. Deliberately the only floating health bar in the game:
          it appears because the player asked for it and vanishes with the lock. */}
      {locked && lockedDef && (
        <div className="lock-card">
          <div className="lock-name">{lockedDef.name.toUpperCase()}</div>
          <div className="lock-bar">
            <div
              className="lock-fill"
              style={{ width: `${Math.max(0, Math.min(100, (locked.health / lockedMax) * 100))}%` }}
            />
          </div>
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

      {/* Going down is a setback, not a reset. The wording matters: the valley
          is explicitly still running while ARI pulls him out. */}
      {p.extraction && (
        <div className="death-overlay">
          <div className="death-text">EMERGENCY EXTRACTION</div>
          <div className="death-sub">ARI has the beacon — the valley carries on without you…</div>
        </div>
      )}
    </div>
  );
}
