import { useUI } from '../state/store';

/** The short version — everything a first-time player needs and nothing else. */
const CONTROLS: [string, string][] = [
  ['W A S D / ↑ ↓ ← →', 'Move'],
  ['Mouse', 'Look around (click the world first)'],
  ['Shift', 'Sprint'],
  ['E', 'Interact · gather · talk'],
  ['F', 'Offer a glowberry'],
  ['Tab', 'Creator Mode'],
  ['Esc', 'Release the mouse · this screen'],
];

export function HelpOverlay() {
  const setHelpOpen = useUI((s) => s.setHelpOpen);
  return (
    <div className="help-overlay" onClick={() => setHelpOpen(false)}>
      <div className="help panel" onClick={(e) => e.stopPropagation()}>
        <div className="wordmark">EDEN</div>
        <div className="help-sub">an artificial world · v0.2</div>
        <div className="help-grid">
          {CONTROLS.map(([k, v]) => (
            <div key={k} className="help-row">
              <span className="help-key">{k}</span>
              <span className="help-desc">{v}</span>
            </div>
          ))}
        </div>
        <div className="help-note">
          The world does not wait for you. Its inhabitants choose their own goals — walk among them, talk to them, or
          enter Creator Mode to read their minds.
        </div>
        <button className="btn help-resume" onClick={() => setHelpOpen(false)}>
          Enter Eden
        </button>
        <div className="help-more">Space jump · Left click attack · Right click dodge · 1/2/3 speed · P pause · F3 debug</div>
      </div>
    </div>
  );
}
