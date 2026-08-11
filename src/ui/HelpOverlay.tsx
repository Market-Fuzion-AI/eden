import { useUI } from '../state/store';

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Camera'],
  ['Shift', 'Sprint'],
  ['Space', 'Jump'],
  ['E', 'Interact / gather'],
  ['F', 'Offer a glowberry'],
  ['Left click', 'Attack'],
  ['Right click', 'Dodge'],
  ['Tab', 'Creator Mode'],
  ['1 / 2 / 3', 'Sim speed 1× / 5× / 20×'],
  ['P', 'Pause simulation'],
  ['Esc', 'This screen (pauses)'],
  ['F3', 'Debug overlay'],
];

/** Esc pauses the sim and shows help. */
export function HelpOverlay() {
  const setHelpOpen = useUI((s) => s.setHelpOpen);
  return (
    <div className="help-overlay" onClick={() => setHelpOpen(false)}>
      <div className="help panel" onClick={(e) => e.stopPropagation()}>
        <div className="wordmark">EDEN</div>
        <div className="help-sub">an artificial world · v0.1</div>
        <div className="help-grid">
          {CONTROLS.map(([k, v]) => (
            <div key={k} className="help-row">
              <span className="help-key">{k}</span>
              <span className="help-desc">{v}</span>
            </div>
          ))}
        </div>
        <div className="help-note">
          The world does not wait for you. Its inhabitants choose their own goals — watch them, walk among them, or
          enter Creator Mode to read their minds.
        </div>
        <button className="btn" onClick={() => setHelpOpen(false)}>
          Resume
        </button>
      </div>
    </div>
  );
}
