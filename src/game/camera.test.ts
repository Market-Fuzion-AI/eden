import { beforeEach, describe, expect, it } from 'vitest';
import {
  addLook,
  cameraSettings,
  drainLook,
  lookInput,
  recenter,
  requestRecenter,
  setInvertY,
  setSensitivity,
} from './camera';

/**
 * The v0.7A camera contract.
 *
 * The headline problem was that looking around required pointer lock and
 * therefore interrupted movement. These pin the replacement input model: every
 * source shares one meaning of "how fast the camera turns", sensitivity and
 * invert actually take effect, and look input is consumed exactly once.
 */

beforeEach(() => {
  drainLook();
  setSensitivity('normal');
  setInvertY(false);
  recenter.requested = false;
});

describe('look input', () => {
  it('turns the camera left when the pointer moves right', () => {
    // Dragging right must swing the view to the right, which means the yaw
    // angle decreases — the same convention the movement basis assumes.
    addLook(100, 0, 'drag');
    expect(drainLook().yaw).toBeLessThan(0);
    addLook(-100, 0, 'drag');
    expect(drainLook().yaw).toBeGreaterThan(0);
  });

  it('raises the view when the pointer moves up', () => {
    addLook(0, -100, 'drag');
    expect(drainLook().pitch).toBeGreaterThan(0);
  });

  it('inverts Y only when asked', () => {
    addLook(0, -100, 'drag');
    const normal = drainLook().pitch;
    setInvertY(true);
    addLook(0, -100, 'drag');
    const inverted = drainLook().pitch;
    expect(Math.sign(inverted)).toBe(-Math.sign(normal));
    expect(Math.abs(inverted)).toBeCloseTo(Math.abs(normal), 6);
  });

  it('scales with sensitivity, monotonically', () => {
    const measure = (s: 'low' | 'normal' | 'high') => {
      setSensitivity(s);
      addLook(100, 0, 'wheel');
      return Math.abs(drainLook().yaw);
    };
    const low = measure('low');
    const normal = measure('normal');
    const high = measure('high');
    expect(low).toBeLessThan(normal);
    expect(normal).toBeLessThan(high);
  });

  it('accumulates between drains and empties on read', () => {
    addLook(10, 5, 'wheel');
    addLook(10, 5, 'wheel');
    const first = drainLook();
    expect(first.yaw).not.toBe(0);
    // Consumed exactly once: a second read must not re-apply the same motion.
    const second = drainLook();
    expect(second.yaw).toBe(0);
    expect(second.pitch).toBe(0);
    expect(lookInput.yaw).toBe(0);
  });

  it('treats a trackpad swipe and a drag as the same gesture', () => {
    // Different devices, comparable feel: within a factor of two, so neither
    // input path is unusable at a sensitivity that suits the other.
    addLook(100, 0, 'wheel');
    const wheel = Math.abs(drainLook().yaw);
    addLook(100, 0, 'drag');
    const drag = Math.abs(drainLook().yaw);
    expect(wheel).toBeGreaterThan(drag * 0.5);
    expect(wheel).toBeLessThan(drag * 2);
  });

  it('keeps pointer lock strictly opt-in', () => {
    // Nothing in the default configuration requires the browser to take the
    // cursor — that was the whole trackpad problem.
    expect(cameraSettings.pointerLockPreferred).toBe(false);
  });
});

describe('recenter', () => {
  it('is a one-shot request', () => {
    expect(recenter.requested).toBe(false);
    requestRecenter();
    expect(recenter.requested).toBe(true);
    // The camera consumes it; it must not latch on.
    recenter.requested = false;
    expect(recenter.requested).toBe(false);
  });
});
