/**
 * Every key EDEN reads, in one place.
 *
 * Before Gate 1 the bindings were scattered across `input.ts` in a long chain
 * of `if (e.code === ...)`, which is how Space ended up owning both jump and
 * dodge at different times and how the arrow keys quietly stayed aliased to
 * movement after they were supposed to become the camera. One table makes a
 * conflict a thing you can see rather than a thing you discover while playing.
 *
 * There is deliberately no remapping UI yet. This is the source of truth the
 * UI would read *from* when there is one.
 */

export type BindingId =
  // --- movement -------------------------------------------------------------
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'sprint'
  | 'jump'
  | 'quickStep'
  // --- camera ---------------------------------------------------------------
  | 'camLeft'
  | 'camRight'
  | 'camUp'
  | 'camDown'
  | 'camRecenter'
  | 'camZoomIn'
  | 'camZoomOut'
  // --- world interaction ----------------------------------------------------
  | 'interact'
  | 'scan'
  | 'medkit'
  | 'offer'
  | 'ask'
  // --- combat (frozen for Gate 1, still bound) ------------------------------
  | 'attackLight'
  | 'attackHeavy'
  | 'lockOn'
  // --- meta -----------------------------------------------------------------
  | 'creatorMode'
  | 'help'
  | 'qaOverlay'
  | 'qaReset'
  | 'pause'
  | 'speed1'
  | 'speed2'
  | 'speed3';

export interface Binding {
  id: BindingId;
  /** `KeyboardEvent.code` values. The first is the one shown in help. */
  codes: string[];
  label: string;
  /** Which help section this belongs to, or null to keep it out of the list. */
  group: 'move' | 'camera' | 'world' | 'combat' | 'meta' | null;
}

/**
 * Gate 1 layout.
 *
 * The shape of it: the left hand never leaves WASD, the right hand never has
 * to leave the arrow keys, and nothing essential requires a mouse. Arrow keys
 * are the camera and no longer duplicate movement — that duplication is what
 * made keyboard-only play impossible, because there was no way to turn.
 */
export const BINDINGS: Binding[] = [
  { id: 'moveForward', codes: ['KeyW'], label: 'Move forward', group: 'move' },
  { id: 'moveBack', codes: ['KeyS'], label: 'Move back', group: 'move' },
  { id: 'moveLeft', codes: ['KeyA'], label: 'Move left', group: 'move' },
  { id: 'moveRight', codes: ['KeyD'], label: 'Move right', group: 'move' },
  { id: 'sprint', codes: ['ShiftLeft', 'ShiftRight'], label: 'Sprint (hold)', group: 'move' },
  { id: 'jump', codes: ['Space'], label: 'Jump', group: 'move' },
  // Tap rather than hold — see `input.ts` for why sprint and quick-step can
  // share a key without fighting each other.
  { id: 'quickStep', codes: ['ShiftLeft', 'ShiftRight'], label: 'Quick-step (tap + direction)', group: 'move' },

  { id: 'camLeft', codes: ['ArrowLeft'], label: 'Turn camera left', group: 'camera' },
  { id: 'camRight', codes: ['ArrowRight'], label: 'Turn camera right', group: 'camera' },
  { id: 'camUp', codes: ['ArrowUp'], label: 'Look up', group: 'camera' },
  { id: 'camDown', codes: ['ArrowDown'], label: 'Look down', group: 'camera' },
  { id: 'camRecenter', codes: ['KeyC'], label: 'Recenter behind Emerson', group: 'camera' },
  { id: 'camZoomIn', codes: ['BracketLeft'], label: 'Zoom in', group: 'camera' },
  { id: 'camZoomOut', codes: ['BracketRight'], label: 'Zoom out', group: 'camera' },

  { id: 'interact', codes: ['KeyE'], label: 'Interact · gather · talk', group: 'world' },
  { id: 'scan', codes: ['KeyQ'], label: 'Scanner sweep', group: 'world' },
  { id: 'medkit', codes: ['KeyH'], label: 'Use a medkit', group: 'world' },
  { id: 'offer', codes: ['KeyF'], label: 'Offer a glowberry', group: 'world' },
  { id: 'ask', codes: ['KeyR'], label: 'Ask permission', group: 'world' },

  { id: 'attackLight', codes: ['KeyJ'], label: 'Light attack', group: 'combat' },
  { id: 'attackHeavy', codes: ['KeyK'], label: 'Heavy attack', group: 'combat' },
  { id: 'lockOn', codes: ['KeyL'], label: 'Lock on', group: 'combat' },

  { id: 'creatorMode', codes: ['Tab'], label: 'Creator Mode', group: 'meta' },
  { id: 'help', codes: ['Escape'], label: 'Help & settings', group: 'meta' },
  { id: 'qaOverlay', codes: ['F3'], label: 'QA overlay', group: 'meta' },
  { id: 'qaReset', codes: ['F4'], label: 'Reset to the 3Cs start', group: 'meta' },
  { id: 'pause', codes: ['KeyP'], label: 'Pause', group: null },
  { id: 'speed1', codes: ['Digit1'], label: 'Speed 1×', group: null },
  { id: 'speed2', codes: ['Digit2'], label: 'Speed 5×', group: null },
  { id: 'speed3', codes: ['Digit3'], label: 'Speed 20×', group: null },
];

const BY_ID = new Map<BindingId, Binding>(BINDINGS.map((b) => [b.id, b]));

export function binding(id: BindingId): Binding {
  const b = BY_ID.get(id);
  if (!b) throw new Error(`unknown binding ${id}`);
  return b;
}

/** Does this event code trigger the given binding? */
export function isBound(id: BindingId, code: string): boolean {
  return binding(id).codes.includes(code);
}

/** Is any key for this binding currently held? */
export function held(id: BindingId, keys: Set<string>): boolean {
  return binding(id).codes.some((c) => keys.has(c));
}

/** The display key for help text, prettified. */
export function keyLabel(id: BindingId): string {
  const code = binding(id).codes[0];
  const named: Record<string, string> = {
    Space: 'Space',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    BracketLeft: '[',
    BracketRight: ']',
    Escape: 'Esc',
    Tab: 'Tab',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

/**
 * Bindings that share a key with a *different* binding in a way that could
 * fire both at once.
 *
 * Sprint and quick-step deliberately share Shift and are separated by hold vs
 * tap, so they are exempt. Anything else sharing a code is a bug, and the test
 * suite asserts this list stays empty.
 */
// Keyed the way `bindingConflicts` builds the pair: both ids, sorted.
const INTENTIONAL_SHARES = new Set(['quickStep+sprint']);

export function bindingConflicts(): string[] {
  const seen = new Map<string, BindingId>();
  const out: string[] = [];
  for (const b of BINDINGS) {
    for (const code of b.codes) {
      const prev = seen.get(code);
      if (prev) {
        const pair = [prev, b.id].sort().join('+');
        if (!INTENTIONAL_SHARES.has(pair)) out.push(`${code}: ${prev} and ${b.id}`);
      } else {
        seen.set(code, b.id);
      }
    }
  }
  return out;
}
