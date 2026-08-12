import { useState } from 'react';
import {
  cameraSettings,
  setInvertY,
  setPointerLockPreferred,
  setSensitivity,
  type Sensitivity,
} from '../game/camera';
import { useUI } from '../state/store';

/** The short version — everything a first-time player needs and nothing else. */
const CONTROLS: [string, string][] = [
  ['W A S D / ↑ ↓ ← →', 'Move'],
  ['Trackpad swipe / drag', 'Look around — no clicking needed'],
  ['C', 'Recenter the camera behind you'],
  ['Shift', 'Sprint'],
  ['E', 'Interact · gather · talk · help build'],
  ['F', 'Offer a glowberry'],
  ['R', 'Ask permission to use a shelter'],
  ['Tab', 'Creator Mode'],
  ['Esc', 'This screen'],
];

const SENSITIVITIES: Sensitivity[] = ['low', 'normal', 'high'];

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
        <div className="help-sub">a living world · v0.7A</div>
        <div className="help-grid">
          {CONTROLS.map(([k, v]) => (
            <div key={k} className="help-row">
              <span className="help-key">{k}</span>
              <span className="help-desc">{v}</span>
            </div>
          ))}
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
          Mouse capture is for players using a mouse: it hides the cursor and gives unlimited turning.
          On a trackpad, leave it off and just swipe.
        </div>

        <div className="help-note">
          The world does not wait for you. Its inhabitants choose their own goals — walk among them, talk to them, or
          enter Creator Mode to read their minds.
        </div>
        <button className="btn help-resume" onClick={() => setHelpOpen(false)}>
          Enter Eden
        </button>
        <div className="help-more">
          Space jump · [ ] or pinch to zoom · Left click attack · Right click dodge · 1/2/3 speed · P pause · F3 debug
        </div>
      </div>
    </div>
  );
}
