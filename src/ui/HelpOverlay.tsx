import { useState } from 'react';
import {
  cameraSettings,
  setInvertY,
  setPointerLockPreferred,
  setSensitivity,
  type Sensitivity,
} from '../game/camera';
import { keyLabel } from '../game/bindings';
import { useUI } from '../state/store';

/**
 * The controls card.
 *
 * Read from the bindings table rather than typed out, so the help can never
 * drift from what the keys actually do — which is exactly how it came to
 * advertise Space as dodge and V as jump.
 *
 * Gate 1 is a movement test, so this leads with movement and the camera. The
 * rest of EDEN still works and is still bound; it is listed underneath, quietly,
 * where it cannot compete for attention with the thing being tested.
 */

const MOVE: [string, string][] = [
  ['W A S D', 'Move — relative to where the camera is looking'],
  [keyLabel('jump'), 'Jump'],
  ['Shift (hold)', 'Sprint'],
  ['Shift (tap) + direction', 'Quick-step'],
];

const CAMERA: [string, string][] = [
  ['← →', 'Turn the camera'],
  ['↑ ↓', 'Look up and down'],
  [keyLabel('camRecenter'), 'Recenter behind Emerson'],
  ['[  ]', 'Zoom out and in'],
  ['Trackpad swipe', 'Look around — optional, the keyboard does everything'],
];

const WORLD: [string, string][] = [
  [keyLabel('interact'), 'Interact · gather · talk'],
  [keyLabel('creatorMode'), 'Creator Mode'],
  [keyLabel('help'), 'This screen'],
];

const SENSITIVITIES: Sensitivity[] = ['low', 'normal', 'high'];

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <div className="help-grid">
      {rows.map(([k, v]) => (
        <div key={k} className="help-row">
          <span className="help-key">{k}</span>
          <span className="help-desc">{v}</span>
        </div>
      ))}
    </div>
  );
}

export function HelpOverlay() {
  const setHelpOpen = useUI((s) => s.setHelpOpen);
  // Settings live outside React (the camera reads them every frame), so keep a
  // local tick purely to re-render the buttons.
  const [, force] = useState(0);
  const bump = () => force((n) => n + 1);

  return (
    <div className="help-overlay" onClick={() => setHelpOpen(false)}>
      <div className="help panel" onClick={(e) => e.stopPropagation()}>
        <div className="wordmark">EDEN</div>
        <div className="help-sub">a living world · Gate 1 · the 3Cs</div>

        <div className="help-section-title">MOVE</div>
        <Rows rows={MOVE} />

        <div className="help-section-title">CAMERA</div>
        <Rows rows={CAMERA} />

        <div className="help-section-title">EVERYTHING ELSE</div>
        <Rows rows={WORLD} />

        <div className="help-note dim-note">
          EDEN plays entirely from the keyboard. A trackpad or mouse can look around if you prefer it, but nothing
          requires one.
        </div>

        <div className="setting-row">
          <span className="setting-label">Look speed</span>
          <span className="setting-options">
            {SENSITIVITIES.map((s) => (
              <button
                key={s}
                className={`setting-btn ${cameraSettings.sensitivity === s ? 'active' : ''}`}
                onClick={() => {
                  setSensitivity(s);
                  bump();
                }}
              >
                {s}
              </button>
            ))}
          </span>
        </div>
        <div className="setting-row">
          <span className="setting-label">Invert Y</span>
          <span className="setting-options">
            <button
              className={`setting-btn ${cameraSettings.invertY ? 'active' : ''}`}
              onClick={() => {
                setInvertY(!cameraSettings.invertY);
                bump();
              }}
            >
              {cameraSettings.invertY ? 'on' : 'off'}
            </button>
          </span>
        </div>
        <div className="setting-row">
          <span className="setting-label">Mouse capture</span>
          <span className="setting-options">
            <button
              className={`setting-btn ${cameraSettings.pointerLockPreferred ? 'active' : ''}`}
              onClick={() => {
                setPointerLockPreferred(!cameraSettings.pointerLockPreferred);
                bump();
              }}
            >
              {cameraSettings.pointerLockPreferred ? 'on' : 'off'}
            </button>
          </span>
        </div>
        <div className="help-note dim-note">
          Look speed applies to the arrow keys as well as the trackpad. Mouse capture is for players using a mouse:
          it hides the cursor and gives unlimited turning.
        </div>

        <div className="help-note">
          Beacons west of the landing mark a traversal run. Walk it, jump it, and see whether Emerson does what you
          meant.
        </div>
        <button className="btn help-resume" onClick={() => setHelpOpen(false)}>
          Enter Eden
        </button>
        <div className="help-more">
          F3 QA overlay · F4 reset to the run · Q scan · J K attack · L lock on · H medkit · 1/2/3 speed · P pause
        </div>
      </div>
    </div>
  );
}
