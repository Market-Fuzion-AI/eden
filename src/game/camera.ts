/**
 * Camera look input and its settings.
 *
 * v0.7A's headline problem was that looking around required pointer lock, and
 * pointer lock is hostile on a laptop: it demands a click, hides the cursor,
 * shows a browser overlay, and — because the old code cleared the key set on
 * every lock change — dropped whatever movement key was being held. Turning to
 * look somewhere therefore stopped you walking.
 *
 * The model here is trackpad-first and lock-free by default:
 *
 *   - A two-finger trackpad swipe arrives as a `wheel` event with no button
 *     held. That is the natural "look" gesture and costs zero clicks, so wheel
 *     drives the camera and zoom moves to pinch (ctrl+wheel) and the bracket
 *     keys.
 *   - Click-drag on the canvas also looks, via pointer capture rather than
 *     pointer lock, so the cursor stays where the player left it.
 *   - Pointer lock survives as an explicit opt-in for mouse users who want
 *     unlimited travel, and is never required for anything.
 *
 * All look input lands in a pending delta which the camera drains and damps,
 * so a trackpad's small bursty deltas read as smooth motion instead of jitter.
 */

export type Sensitivity = 'low' | 'normal' | 'high';

const SENS_SCALE: Record<Sensitivity, number> = { low: 0.6, normal: 1, high: 1.7 };

export interface CameraSettings {
  sensitivity: Sensitivity;
  invertY: boolean;
  /** Opt-in pointer lock for players using a mouse. */
  pointerLockPreferred: boolean;
}

const STORAGE_KEY = 'eden.camera';

const DEFAULTS: CameraSettings = {
  sensitivity: 'normal',
  invertY: false,
  pointerLockPreferred: false,
};

function load(): CameraSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<CameraSettings>;
    return {
      sensitivity:
        parsed.sensitivity === 'low' || parsed.sensitivity === 'high' ? parsed.sensitivity : 'normal',
      invertY: Boolean(parsed.invertY),
      pointerLockPreferred: Boolean(parsed.pointerLockPreferred),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export const cameraSettings: CameraSettings = load();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cameraSettings));
  } catch {
    // Settings are a convenience; a private-mode browser is not an error.
  }
}

export function setSensitivity(s: Sensitivity): void {
  cameraSettings.sensitivity = s;
  persist();
}

export function setInvertY(v: boolean): void {
  cameraSettings.invertY = v;
  persist();
}

export function setPointerLockPreferred(v: boolean): void {
  cameraSettings.pointerLockPreferred = v;
  persist();
}

/** Pending look delta in radians, drained by the camera each frame. */
export const lookInput = { yaw: 0, pitch: 0 };

/** Per-source base gains, tuned so a swipe and a drag feel like the same motion. */
const GAIN = {
  wheel: 0.0042,
  drag: 0.0052,
  lock: 0.0026,
};

export type LookSource = 'wheel' | 'drag' | 'lock';

/**
 * Queue a look delta in raw device units. Sensitivity and invert are applied
 * here so every input path shares one meaning of "how fast the camera turns".
 */
export function addLook(dx: number, dy: number, source: LookSource): void {
  const scale = GAIN[source] * SENS_SCALE[cameraSettings.sensitivity];
  lookInput.yaw -= dx * scale;
  lookInput.pitch += (cameraSettings.invertY ? dy : -dy) * scale;
}

export function drainLook(): { yaw: number; pitch: number } {
  const out = { yaw: lookInput.yaw, pitch: lookInput.pitch };
  lookInput.yaw = 0;
  lookInput.pitch = 0;
  return out;
}

/** Recenter request, consumed by the camera to sweep smoothly behind Emerson. */
export const recenter = { requested: false };

export function requestRecenter(): void {
  recenter.requested = true;
}
