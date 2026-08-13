import { useEffect, useState } from 'react';
import { getWorld } from '../sim';
import { providerMode, setProviderMode } from '../sim/conversation';
import { MATERIALS } from '../sim/fabrication';
import type { MaterialId } from '../sim/types';
import { devMode } from '../sim/dev';
import { dialogueProviderStatus } from '../game/openaiDialogue';
import { useUI } from '../state/store';

/**
 * Developer Controls.
 *
 * QA happens on the deployed build, on a Mac, where the OS takes the bare
 * function keys before the page ever sees them — so a tester pressing F6 to
 * switch dialogue provider was pressing nothing at all, and every conversation
 * stayed local. Anything QA *depends* on therefore has to be clickable. The
 * keyboard shortcuts still work where the OS allows them; they are now a
 * shortcut rather than the only way in.
 *
 * Visible only in Developer Mode, and it reads and writes the same state the
 * shortcuts do — there is no second source of truth here, just a second door.
 */
type Status = { available: boolean; model: string | null } | null;

export function DevControls() {
  useUI((s) => s.uiPulse);
  const bump = useUI((s) => s.bumpPulse);
  const open = useUI((s) => s.devPanelOpen);
  const toggle = useUI((s) => s.toggleDevPanel);
  const [status, setStatus] = useState<Status>(null);
  const [checking, setChecking] = useState(false);

  const probe = (force = false) => {
    setChecking(true);
    void dialogueProviderStatus(force)
      .then(setStatus)
      .finally(() => setChecking(false));
  };

  // Ask the deployed endpoint what it can do, the moment the panel is opened.
  useEffect(() => {
    if (open) probe(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!devMode()) return null;

  const mode = providerMode();
  const p = getWorld().player;
  const carrying = (Object.keys(MATERIALS) as MaterialId[]).filter((id) => p.materials[id] > 0);

  const switchProvider = (next: 'local' | 'openai') => {
    setProviderMode(next);
    // Re-check on the way in, so the panel can say whether the switch will
    // actually do anything before the tester walks over to a settler.
    if (next === 'openai') probe(true);
    bump();
  };

  if (!open) {
    return (
      <button className="hint-chip dev dev-badge" onClick={toggle} title="Developer Controls">
        DEV MODE
      </button>
    );
  }

  const endpoint = checking
    ? 'checking…'
    : status?.available
      ? `available · ${status.model ?? 'model set'}`
      : 'unavailable — conversations will use LOCAL';

  return (
    <div className="dev-panel panel">
      <div className="dev-panel-head">
        <span className="dev-panel-title">DEVELOPER CONTROLS</span>
        <button className="btn close-btn" onClick={toggle}>
          ✕
        </button>
      </div>

      <div className="dev-row">
        <span className="dev-label">Dialogue Provider</span>
        <span className={`dev-value ${mode === 'openai' ? 'on' : ''}`}>{mode.toUpperCase()}</span>
      </div>
      <div className="dev-seg">
        <button
          className={`dev-seg-btn ${mode === 'local' ? 'active' : ''}`}
          onClick={() => switchProvider('local')}
        >
          LOCAL
        </button>
        <button
          className={`dev-seg-btn ${mode === 'openai' ? 'active' : ''}`}
          onClick={() => switchProvider('openai')}
        >
          OPENAI
        </button>
      </div>

      <div className="dev-row">
        <span className="dev-label">OpenAI endpoint</span>
        <span className={`dev-value ${status?.available ? 'on' : 'off'}`}>{endpoint}</span>
      </div>
      <button className="dev-recheck" onClick={() => probe(true)}>
        Re-check endpoint
      </button>
      <div className="dev-note">
        Switching to OPENAI affects new conversations. The game always falls back to LOCAL if the
        endpoint cannot answer.
      </div>

      <div className="dev-sep" />

      {/* Everything the normal HUD stopped showing. It left the player's status
          card so exploration reads as a game rather than a stock take; a tester
          who needs the numbers is one click away from them. */}
      <div className="dev-label">Carried</div>
      <div className="status-dev">
        {carrying.length === 0 && <span className="dev-mat">nothing</span>}
        {carrying.map((id) => (
          <span key={id} className="dev-mat">
            <span className="dev-swatch" style={{ background: MATERIALS[id].color }} />
            {MATERIALS[id].name} {p.materials[id]}
          </span>
        ))}
        {p.berries > 0 && <span className="dev-mat">Berries {p.berries}</span>}
        {p.wood > 0 && <span className="dev-mat">Wood {Math.round(p.wood)}</span>}
        {p.stone > 0 && <span className="dev-mat">Stone {Math.round(p.stone)}</span>}
        {p.salvage.coreFragment > 0 && <span className="dev-mat">Core {p.salvage.coreFragment}</span>}
        {p.items.medkit > 0 && <span className="dev-mat">Medkit {p.items.medkit}</span>}
        {p.items.energyCell > 0 && <span className="dev-mat">Energy Cell {p.items.energyCell}</span>}
      </div>

      <div className="dev-sep" />

      <div className="dev-label">Controls</div>
      <table className="dev-keys">
        <tbody>
          {[
            ['1', 'Arc Blade'],
            ['2', 'Pulse Blaster'],
            ['J', 'Attack / fire'],
            ['K', 'Heavy melee attack'],
            ['L', 'Lock target'],
            ['Space → Space', 'Jump, then jetpack while airborne'],
            ['W A S D', 'Move'],
            ['Arrow keys', 'Camera'],
            ['E', 'Talk / interact'],
            ['Esc', 'Leave a conversation'],
          ].map(([key, what]) => (
            <tr key={key}>
              <td className="dev-key">{key}</td>
              <td className="dev-key-what">{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dev-note">
        F3 (overlay), F4 (reset loadout) and F6 (provider) still work, but macOS may take the bare
        function keys first — everything essential is on this panel.
      </div>
    </div>
  );
}
