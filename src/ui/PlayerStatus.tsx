import { getWorld } from '../sim';
import { blasterChargeFrac } from '../sim/blaster';
import { jetpackFuelFrac } from '../sim/jetpack';
import { inCombat } from '../sim/combat';
import { useUI } from '../state/store';

/**
 * Kai's condition, top left.
 *
 * What this replaces was a stack of eleven rows in the bottom-left corner —
 * VIT, STA, CEL, a core-fragment count, glowberries, three unlabelled coloured
 * numbers, a medkit count written "✚ 10 · H", wood and stone. A player could
 * not tell which of those mattered, and most of them never mattered: carrying
 * ore is a crafting concern, not something to watch while walking.
 *
 * So this shows the two things that can kill you or stop you moving, plus the
 * two that only appear when you actually have them. Everything else moved to
 * the inventory the fabricator already opens, and the raw counts moved into
 * Developer Controls — behind a click, where a tester who wants them can find
 * them and a player reading their own health is not asked to skip past them.
 *
 * There is no currency in EDEN, so there is no Credits readout. Nothing in the
 * simulation is spent as money — materials are consumed directly by recipes.
 */
export function PlayerStatus() {
  useUI((s) => s.uiPulse);
  const world = getWorld();
  const p = world.player;
  const fighting = inCombat(world);
  const low = p.health <= 30 && !p.dead;
  const jet = jetpackFuelFrac(world);

  return (
    <div className={`status-card ${fighting ? 'engaged' : ''} ${low ? 'critical' : ''}`}>
      <div className="status-head">
        <span className="status-crest">K</span>
        <div className="status-id">
          <span className="status-name">KAI</span>
          <span className="status-role">Pathfinder</span>
        </div>
      </div>

      <div className="gauge gauge-health">
        <div className="gauge-track">
          <div className="gauge-fill" style={{ width: `${Math.max(0, p.health)}%` }} />
        </div>
        <span className="gauge-label">Health</span>
        {/* The number appears only when it is worth reading. Out of a fight the
            bar alone says everything, and a permanent "100" is noise. */}
        {(fighting || low) && <span className="gauge-num">{Math.round(p.health)}</span>}
      </div>

      <div className="gauge gauge-stamina">
        <div className="gauge-track">
          <div className="gauge-fill" style={{ width: `${Math.max(0, p.stamina)}%` }} />
        </div>
        <span className="gauge-label">Stamina</span>
      </div>

      {/* Equipment meters appear only once the equipment exists, and the pack
          goes quiet again when it is full and unused. */}
      {p.unlocks.jetpack && (jet < 0.999 || p.jetpackOn) && (
        <div className={`gauge gauge-jet ${p.jetpackOn ? 'burning' : ''}`}>
          <div className="gauge-track">
            <div className="gauge-fill" style={{ width: `${jet * 100}%` }} />
          </div>
          <span className="gauge-label">Jetpack</span>
        </div>
      )}
      {p.equipped === 'pulseBlaster' && (
        <div className="gauge gauge-charge">
          <div className="gauge-track">
            <div className="gauge-fill" style={{ width: `${blasterChargeFrac(world) * 100}%` }} />
          </div>
          <span className="gauge-label">Charge</span>
        </div>
      )}

    </div>
  );
}
