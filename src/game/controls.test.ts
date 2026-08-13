import { beforeEach, describe, expect, it } from 'vitest';
import {
  BINDINGS,
  binding,
  bindingConflicts,
  held,
  isBound,
  keyLabel,
  type BindingId,
} from './bindings';
import { KEY_LOOK, keyLookActive, keyLookTick, resetKeyLook, setInvertY, setSensitivity } from './camera';
import { inputState, readLookKeys, readMoveAxes } from './input';

/**
 * The Gate 1 control contract.
 *
 * Human QA on v0.9 found three specific faults: the arrow keys duplicated WASD
 * so a keyboard-only player could never turn, Space had been taken over by the
 * dodge, and jump had wandered onto V. Every one of those was a mapping that
 * looked fine in isolation and was wrong as a whole, which is why these tests
 * assert the *shape* of the scheme and not just that individual keys respond.
 */

const press = (...codes: string[]) => {
  inputState.keys.clear();
  for (const c of codes) inputState.keys.add(c);
};

beforeEach(() => {
  inputState.keys.clear();
  inputState.camYaw = 0;
  inputState.camPitch = -0.24;
  resetKeyLook();
  setSensitivity('normal');
  setInvertY(false);
});

describe('the bindings table', () => {
  it('has no two bindings fighting over the same key', () => {
    expect(bindingConflicts()).toEqual([]);
  });

  it('binds every declared action to at least one key', () => {
    for (const b of BINDINGS) {
      expect(b.codes.length, `${b.id} is unbound`).toBeGreaterThan(0);
      expect(keyLabel(b.id).length).toBeGreaterThan(0);
    }
  });

  it('puts jump on Space and nothing else', () => {
    expect(binding('jump').codes).toEqual(['Space']);
    // The v0.9 layout that QA rejected: Space was the dodge and V was the jump.
    for (const b of BINDINGS) {
      if (b.id !== 'jump') expect(b.codes, `${b.id} also answers Space`).not.toContain('Space');
      expect(b.codes, `${b.id} is still on V`).not.toContain('KeyV');
    }
  });

  it('gives the arrow keys to the camera and only the camera', () => {
    const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    const cameraIds: BindingId[] = ['camUp', 'camDown', 'camLeft', 'camRight'];
    for (const arrow of arrows) {
      const owners = BINDINGS.filter((b) => b.codes.includes(arrow)).map((b) => b.id);
      expect(owners.length, `${arrow} has ${owners.length} owners`).toBe(1);
      expect(cameraIds).toContain(owners[0]);
    }
    // The regression itself: arrows must never be movement again.
    for (const id of ['moveForward', 'moveBack', 'moveLeft', 'moveRight'] as BindingId[]) {
      for (const arrow of arrows) expect(isBound(id, arrow)).toBe(false);
    }
  });

  it('keeps movement on WASD', () => {
    expect(binding('moveForward').codes).toContain('KeyW');
    expect(binding('moveBack').codes).toContain('KeyS');
    expect(binding('moveLeft').codes).toContain('KeyA');
    expect(binding('moveRight').codes).toContain('KeyD');
  });

  it('reaches every essential action from the keyboard alone', () => {
    // The brief's hard requirement: EDEN must be fully playable with no mouse
    // and no trackpad. Every one of these is a key, not a button.
    const essential: BindingId[] = [
      'moveForward', 'moveBack', 'moveLeft', 'moveRight',
      'jump', 'sprint', 'quickStep',
      'camLeft', 'camRight', 'camUp', 'camDown', 'camRecenter', 'camZoomIn', 'camZoomOut',
      'interact', 'creatorMode', 'help',
    ];
    for (const id of essential) expect(binding(id).codes.length).toBeGreaterThan(0);
  });

  it('gives the number row to the weapon slots, not to sim speed', () => {
    // 1 and 2 mean "which weapon" in a third-person action game. Sim speed is
    // an observer control and moved off the digits when the blaster arrived;
    // the alternative was digits meaning different things in different modes,
    // which is the scattered binding this table exists to prevent.
    expect(binding('selectBlade').codes).toEqual(['Digit1']);
    expect(binding('selectBlaster').codes).toEqual(['Digit2']);
    for (const id of ['speed1', 'speed2', 'speed3'] as BindingId[]) {
      for (const code of binding(id).codes) expect(code.startsWith('Digit')).toBe(false);
    }
  });

  it('keeps every combat action reachable from the keyboard', () => {
    // Ranged combat has to be playable with no mouse: something to fire with,
    // something to aim with, and a way to change weapon.
    for (const id of ['attackLight', 'attackHeavy', 'lockOn', 'selectBlade', 'selectBlaster'] as BindingId[]) {
      expect(binding(id).codes.length, id).toBeGreaterThan(0);
    }
  });

  it('answers both shift keys, so neither hand is privileged', () => {
    expect(held('sprint', new Set(['ShiftLeft']))).toBe(true);
    expect(held('sprint', new Set(['ShiftRight']))).toBe(true);
  });
});

describe('movement axes', () => {
  it('reads WASD as the four directions', () => {
    press('KeyW');
    expect(readMoveAxes()).toMatchObject({ moveX: 0, moveZ: 1 });
    press('KeyS');
    expect(readMoveAxes()).toMatchObject({ moveX: 0, moveZ: -1 });
    press('KeyA');
    expect(readMoveAxes()).toMatchObject({ moveX: -1, moveZ: 0 });
    press('KeyD');
    expect(readMoveAxes()).toMatchObject({ moveX: 1, moveZ: 0 });
  });

  it('does not move for any arrow key', () => {
    press('ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight');
    const axes = readMoveAxes();
    expect(axes.moveX).toBe(0);
    expect(axes.moveZ).toBe(0);
  });

  it('normalises diagonals so W+D is not faster than W', () => {
    press('KeyW', 'KeyD');
    const axes = readMoveAxes();
    expect(Math.hypot(axes.moveX, axes.moveZ)).toBeCloseTo(1, 6);
  });

  it('cancels opposing keys instead of drifting', () => {
    press('KeyW', 'KeyS', 'KeyA', 'KeyD');
    expect(readMoveAxes()).toMatchObject({ moveX: 0, moveZ: 0 });
  });

  it('reports sprint and jump alongside direction', () => {
    press('KeyW', 'ShiftLeft', 'Space');
    const axes = readMoveAxes();
    expect(axes.sprint).toBe(true);
    expect(axes.jump).toBe(true);
    expect(axes.moveZ).toBe(1);
  });

  it('keeps moving while the camera keys are held', () => {
    // The single most important interaction in the scheme: turning the camera
    // must never interrupt a stride, because on a keyboard both hands are busy.
    press('KeyW', 'ArrowRight');
    expect(readMoveAxes().moveZ).toBe(1);
    expect(readLookKeys()).toMatchObject({ right: true, left: false });
  });
});

describe('the arrow-key camera', () => {
  it('turns left for the left arrow and right for the right', () => {
    press('ArrowLeft');
    let yaw = 0;
    for (let i = 0; i < 30; i++) yaw += keyLookTick(1 / 60, readLookKeys()).yaw;
    expect(yaw).toBeGreaterThan(0.1);

    resetKeyLook();
    press('ArrowRight');
    let back = 0;
    for (let i = 0; i < 30; i++) back += keyLookTick(1 / 60, readLookKeys()).yaw;
    expect(back).toBeLessThan(-0.1);
  });

  it('pitches up for the up arrow and down for the down arrow', () => {
    press('ArrowUp');
    let up = 0;
    for (let i = 0; i < 30; i++) up += keyLookTick(1 / 60, readLookKeys()).pitch;
    expect(up).toBeGreaterThan(0.05);

    resetKeyLook();
    press('ArrowDown');
    let down = 0;
    for (let i = 0; i < 30; i++) down += keyLookTick(1 / 60, readLookKeys()).pitch;
    expect(down).toBeLessThan(-0.05);
  });

  it('ramps up rather than snapping to full speed', () => {
    press('ArrowLeft');
    const first = keyLookTick(1 / 60, readLookKeys()).yaw;
    let last = first;
    for (let i = 0; i < 40; i++) last = keyLookTick(1 / 60, readLookKeys()).yaw;
    expect(first).toBeLessThan(last);
    // And settles at the configured rate rather than accelerating forever.
    expect(last * 60).toBeLessThanOrEqual(KEY_LOOK.maxYaw * 1.01);
  });

  it('stops promptly when the keys are released', () => {
    press('ArrowLeft');
    for (let i = 0; i < 60; i++) keyLookTick(1 / 60, readLookKeys());
    expect(keyLookActive()).toBe(true);
    press();
    let coast = 0;
    for (let i = 0; i < 20; i++) coast += Math.abs(keyLookTick(1 / 60, readLookKeys()).yaw);
    expect(keyLookActive()).toBe(false);
    // A third of a radian of coast would read as the camera sliding away.
    expect(coast).toBeLessThan(0.12);
  });

  it('cancels itself when both directions are held', () => {
    press('ArrowLeft', 'ArrowRight');
    for (let i = 0; i < 20; i++) keyLookTick(1 / 60, readLookKeys());
    expect(keyLookActive()).toBe(false);
  });

  it('obeys the sensitivity and invert settings like every other look source', () => {
    press('ArrowLeft');
    setSensitivity('low');
    const low = keyLookTick(1 / 60, readLookKeys()).yaw;
    resetKeyLook();
    setSensitivity('high');
    const high = keyLookTick(1 / 60, readLookKeys()).yaw;
    expect(Math.abs(high)).toBeGreaterThan(Math.abs(low));

    resetKeyLook();
    setSensitivity('normal');
    press('ArrowUp');
    const normal = keyLookTick(1 / 60, readLookKeys()).pitch;
    resetKeyLook();
    setInvertY(true);
    const inverted = keyLookTick(1 / 60, readLookKeys()).pitch;
    expect(Math.sign(inverted)).toBe(-Math.sign(normal));
    setInvertY(false);
  });

  it('is frame-rate independent over the same elapsed time', () => {
    press('ArrowLeft');
    let fine = 0;
    for (let i = 0; i < 120; i++) fine += keyLookTick(1 / 120, readLookKeys()).yaw;
    resetKeyLook();
    let coarse = 0;
    for (let i = 0; i < 30; i++) coarse += keyLookTick(1 / 30, readLookKeys()).yaw;
    // Not identical — the ramp is discrete — but the same turn, not double it.
    expect(coarse).toBeGreaterThan(fine * 0.75);
    expect(coarse).toBeLessThan(fine * 1.35);
  });
});
