import { getWorld } from '../sim';
import { formatClock } from '../sim/chronicle';
import { lockedTarget } from '../sim/combat';
import { CREATURE_SPECIES_BY_ID } from '../sim/species';
import { getInteractions, harvestProgress } from '../sim/player';
import { MATERIALS } from '../sim/fabrication';
import { missionObjective, missionTracking, signalBearing, signalStrengthAt } from '../sim/mission';
import { scanCooldownRemaining, scanWouldSpendCell } from '../sim/scanner';
import { useUI } from '../state/store';
import { inputState } from '../game/input';
import { DialoguePanel } from './DialoguePanel';
import { SummaryPanel } from './SummaryPanel';
import { DevControls } from './DevControls';
import { PlayerStatus } from './PlayerStatus';
import { WeaponSlots } from './WeaponSlots';
import { Minimap } from './Minimap';

/**
 * How strong the distress carrier is, in words.
 *
 * The bar answers "is it changing"; this answers "am I anywhere near it yet",
 * which is the question a player actually has while walking.
 */
function signalWord(strength: number): string {
  if (strength >= 0.62) return 'Very close';
  if (strength >= 0.34) return 'Closing';
  if (strength >= 0.12) return 'Faint';
  return 'Barely audible';
}

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

  // A conversation takes the screen. The portraits sit where the ARI transcript
  // and the identification card live, and two panels of text overlapping each
  // other is the fastest way to make a scene unreadable — so while Kai is
  // talking to someone, the ambient readouts stand down. Nothing is disabled;
  // they come straight back when he steps away.
  const talking = Boolean(world.conversation);

  // Where Kai is, and which way he is looking — the two things a
  // third-person explorer actually needs on screen at all times.
  // Recent pickups, shown briefly then dropped — no permanent inventory panel.
  const recentPickups = world.pickups.filter((x) => world.timeSec - x.at < 4);
  const harvesting = harvestProgress(world);
  const scanCooldown = scanCooldownRemaining(world);
  const scanCell = scanWouldSpendCell(world);
  // THE SIGNAL. The objective line is a purpose, not an instruction, and the
  // carrier meter is the whole navigation system — no minimap, no waypoint
  // pinned through the terrain.
  const objective = missionObjective(world);
  const tracking = missionTracking(world);
  const signal = tracking ? signalStrengthAt(world, p.pos.x, p.pos.z) : 0;
  const bearing = signalBearing(world);

  // Combat state, read straight off the simulation. Nothing here is owned by
  // React — the HUD is a view of the fight, not a participant in it.
  const hurtFlash = Math.max(0, 1 - (world.timeSec - p.lastHurtAt) / 0.9);
  const lowHealth = p.health <= 30 && !p.dead;
  const locked = lockedTarget(world);
  const lockedDef = locked ? CREATURE_SPECIES_BY_ID[locked.speciesId] : null;
  const lockedMax = lockedDef?.dangerous?.health ?? 100;
  const recentSalvage = world.pickupsSalvage.filter((x) => world.timeSec - x.at < 5);
  // Shown for a few seconds after a retrieval, then gone.
  const recentLoss =
    !p.extraction && p.lastHurtAt > 0 && world.timeSec - p.lastHurtAt < 14 ? p.extractionLoss : [];

  const heading = ((-inputState.camYaw * 180) / Math.PI + 360 * 4) % 360;
  const cardinal = CARDINALS[Math.round(heading / 45) % 8];

  return (
    <div className="hud">
      {/* Live Mode is a game, not a simulation dashboard: location, compass and
          time only. Sim speed, weather state and pause live in Creator Mode. */}
      {/* Kai's condition. Where he *is* moved to the minimap, where a place
          name belongs beside a map of the place. */}
      <div className="hud-topleft">
        <PlayerStatus />
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
            {bearing !== null &&
              (() => {
                // The carrier's direction, drawn on the compass Kai already
                // has. It only appears while the signal is being tracked, and
                // it is a bearing rather than a distance — it says which way to
                // set off, not how far to walk or exactly where to stop.
                const deg = ((bearing * 180) / Math.PI + 360) % 360;
                let delta = ((deg - heading + 540) % 360) - 180;
                if (Math.abs(delta) > 62) return null;
                return (
                  <span className="compass-signal" style={{ left: `${50 + (delta / 62) * 50}%` }}>
                    ◈
                  </span>
                );
              })()}
          </div>
        </div>
        {objective && (
          <div className="objective">
            <div className="objective-title">{objective.title}</div>
            <div className="objective-detail">{objective.detail}</div>
            {/* This bar is proximity: it is (1 - distance/range) squared, so it
                rises fastest over the last stretch. "CARRIER" was the radio
                term for the transmission being tracked, which told the player
                nothing about whether they were getting anywhere. It now says
                what it measures, and puts the reading in words as well as in a
                bar — a bar alone cannot distinguish "faint" from "broken". */}
            {tracking && (
              <div className="objective-signal">
                <span className="objective-signal-label">Signal strength</span>
                <div className="signal-bar">
                  <div className="signal-fill" style={{ width: `${Math.round(signal * 100)}%` }} />
                </div>
                <span className="objective-signal-word">{signalWord(signal)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="hud-topright">
        <div className="clock-chip">{formatClock(world.timeSec)}</div>
        {/* The scanner. "SPEND CELL (18s)" told the player the implementation:
            a cooldown, and an item they could burn to skip it. It now says what
            pressing Q would actually do. */}
        {p.unlocks.scanner && (
          <div className={`scan-chip ${scanCooldown <= 0 ? 'ready' : scanCell ? 'cell' : 'cooling'}`}>
            {scanCooldown <= 0 ? (
              <>
                <span className="chip-key">Q</span> Scan surroundings
              </>
            ) : scanCell ? (
              <>
                <span className="chip-key">Q</span> Long-range scan · uses 1 Energy Cell
              </>
            ) : (
              <>Scanner recharging · {Math.ceil(scanCooldown)}s</>
            )}
          </div>
        )}
        {paused && <div className="hint-chip warn">PAUSED</div>}
        {!paused && speed !== 1 && <div className="hint-chip">{speed}×</div>}
        <div className="hint-chip dim">TAB Creator · ESC Help</div>
        {/* Developer Mode is marked, quietly and always. A build that hands the
            player a full inventory must never be mistakable for the real one.
            The badge is also the way in to Developer Controls, so nothing a
            tester needs is reachable only through a function key. */}
        <DevControls />
      </div>

      {/* The identification card used to live here: a name, a species line and
          a "Disposition" read-out. Two problems. With four settlers around Kai
          it never said *which* of them it meant, and "Disposition: placid" is
          simulation vocabulary — the player should read a mood from how someone
          behaves and speaks, not from a labelled enum. Names and roles now float
          over the people they belong to (see `Agents.tsx`), and disposition is
          Creator Mode's business. `identifyFocus` is untouched and still drives
          Creator inspection. */}

      {/* Damage vignette — pure feedback, driven by the sim's last-hurt stamp. */}
      {hurtFlash > 0 && <div className="hurt-vignette" style={{ opacity: hurtFlash }} />}
      {lowHealth && !p.extraction && <div className="hurt-vignette critical" />}

      <div className="hud-bottomleft">
        {ariLine && !talking && (
          <div className="ari panel">
            <span className="ari-tag">ARI</span>
            <span className="ari-text">{ariLine}</span>
          </div>
        )}
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
        <WeaponSlots />
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
        {/* Taught once, then retired for good — the first arrow-key turn or
            look-swipe retires it. It names the keyboard first because that is
            what the game is played with; the trackpad is the alternative, not
            the instruction. */}
        {!learnedLook && !helpOpen && !dialogue && !p.dead && (
          <div className="prompt look-hint">← → turn the camera · C recenters · trackpad swipe also looks</div>
        )}
      </div>

      {/* Bottom right. Hidden while a conversation owns the screen. */}
      {!talking && <Minimap />}

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

      {/* What going down actually cost. A penalty the player cannot see is a
          penalty they cannot learn from. */}
      {recentLoss.length > 0 && (
        <div className="loss-card">
          <div className="loss-title">Lost in extraction</div>
          {recentLoss.map((l) => (
            <div key={l.materialId} className="loss-row">
              <span className="fab-swatch" style={{ background: MATERIALS[l.materialId].color }} />
              −{l.amount} {MATERIALS[l.materialId].name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
