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

/** Recenter request, consumed by the camera to sweep smoothly behind Kai. */
export const recenter = { requested: false };

export function requestRecenter(): void {
  recenter.requested = true;
}

// ---------------------------------------------------------------------------
// Keyboard camera (Gate 1)
// ---------------------------------------------------------------------------

/**
 * Arrow-key camera.
 *
 * The arrow keys used to be movement aliases, which meant a keyboard-only
 * player had no way to turn at all — the whole reason trackpad look felt
 * mandatory. They are the camera now.
 *
 * Held keys drive an angular *velocity* that ramps up and eases down rather
 * than a fixed rate applied per frame. That is the difference between a camera
 * that feels like a robot arm and one that feels like a person turning their
 * head: a short tap gives a small, deliberate adjustment, and a long hold
 * settles into a comfortable constant sweep. Release decays faster than the
 * ramp, so letting go stops the camera promptly instead of drifting.
 */
export const KEY_LOOK = {
  /** Radians per second at full tilt. ~126°/s yaw, ~63°/s pitch. */
  maxYaw: 2.2,
  maxPitch: 1.1,
  /** How quickly the velocity approaches the target, and returns to rest. */
  accel: 11,
  decay: 18,
} as const;

const keyLookVel = { yaw: 0, pitch: 0 };

export interface KeyLookInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

/**
 * Advance the keyboard camera and return this frame's delta in radians.
 *
 * Sensitivity scales it like every other look source, so the setting means one
 * thing across the whole game. Invert-Y applies to pitch only, matching the
 * mouse path.
 */
export function keyLookTick(dt: number, input: KeyLookInput): { yaw: number; pitch: number } {
  const scale = SENS_SCALE[cameraSettings.sensitivity];
  const wantYaw = ((input.left ? 1 : 0) - (input.right ? 1 : 0)) * KEY_LOOK.maxYaw * scale;
  const rawPitch = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  const wantPitch = (cameraSettings.invertY ? -rawPitch : rawPitch) * KEY_LOOK.maxPitch * scale;

  const approach = (v: number, target: number): number => {
    // Easing off is deliberately quicker than easing on: a camera that keeps
    // coasting after the key is up reads as lag, not as smoothness.
    const rate = Math.abs(target) > Math.abs(v) ? KEY_LOOK.accel : KEY_LOOK.decay;
    return v + (target - v) * Math.min(1, rate * dt);
  };
  keyLookVel.yaw = approach(keyLookVel.yaw, wantYaw);
  keyLookVel.pitch = approach(keyLookVel.pitch, wantPitch);
  if (Math.abs(keyLookVel.yaw) < STILL) keyLookVel.yaw = 0;
  if (Math.abs(keyLookVel.pitch) < STILL) keyLookVel.pitch = 0;

  return { yaw: keyLookVel.yaw * dt, pitch: keyLookVel.pitch * dt };
}

/**
 * Below this the camera is standing still, in radians per second.
 *
 * A little over a degree per second: not a speed anyone can see. The threshold
 * used to be fifty times smaller, which meant the exponential tail of a release
 * counted as "still turning" for another half-second — long enough that pressing
 * C the instant you let go of an arrow key silently cancelled the recenter.
 */
const STILL = 0.02;

/** True while the arrow keys are actually turning the camera. */
export function keyLookActive(): boolean {
  return Math.abs(keyLookVel.yaw) > STILL || Math.abs(keyLookVel.pitch) > STILL;
}

/** Drop any residual camera velocity — used when leaving Live Mode. */
export function resetKeyLook(): void {
  keyLookVel.yaw = 0;
  keyLookVel.pitch = 0;
}

/** Vertical limits, shared by every look source so they cannot disagree. */
export const PITCH_LIMIT = { min: -1.05, max: 0.62 };
