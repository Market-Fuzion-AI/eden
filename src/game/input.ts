import { getWorld } from '../sim';
import { ariCreatorToggle } from '../sim/ari';
import { playerAttack, playerDodge, playerGather, playerOfferFood } from '../sim/player';
import { useUI } from '../state/store';

/**
 * Global input: keyboard state + one-shot actions. Camera yaw/pitch live here
 * so the sim-side player update can read movement direction without touching
 * the renderer.
 */

export const inputState = {
  keys: new Set<string>(),
  camYaw: Math.PI, // start looking back across the valley
  camPitch: -0.32,
  camDist: 5.2,
};

export function readMoveAxes(): { moveX: number; moveZ: number; sprint: boolean; jump: boolean } {
  const k = inputState.keys;
  let moveX = 0;
  let moveZ = 0;
  if (k.has('KeyW')) moveZ += 1;
  if (k.has('KeyS')) moveZ -= 1;
  if (k.has('KeyA')) moveX -= 1;
  if (k.has('KeyD')) moveX += 1;
  const mag = Math.hypot(moveX, moveZ);
  if (mag > 1) {
    moveX /= mag;
    moveZ /= mag;
  }
  return { moveX, moveZ, sprint: k.has('ShiftLeft') || k.has('ShiftRight'), jump: k.has('Space') };
}

let installed = false;

export function installInput(): void {
  if (installed) return;
  installed = true;

  window.addEventListener('keydown', (e) => {
    const ui = useUI.getState();
    if (e.code === 'Tab') {
      e.preventDefault();
      const next = ui.mode === 'live' ? 'creator' : 'live';
      ui.setMode(next);
      ui.setHelpOpen(false);
      if (next === 'creator') {
        ariCreatorToggle(getWorld());
        if (document.pointerLockElement) document.exitPointerLock();
      }
      return;
    }
    if (e.code === 'Escape') {
      // Browser also releases pointer lock on Esc; we mirror it as pause/help.
      if (ui.helpOpen) ui.setHelpOpen(false);
      else ui.setHelpOpen(true);
      return;
    }
    if (e.code === 'F3') {
      e.preventDefault();
      ui.toggleDebug();
      return;
    }
    if (e.code === 'Digit1') ui.setSpeed(1);
    if (e.code === 'Digit2') ui.setSpeed(5);
    if (e.code === 'Digit3') ui.setSpeed(20);
    if (e.code === 'KeyP') ui.setPaused(!ui.paused);
    if (e.code === 'KeyC' && ui.mode === 'creator') ui.toggleChronicle();

    if (ui.mode === 'live' && !ui.helpOpen) {
      if (e.code === 'KeyE') playerGather(getWorld());
      if (e.code === 'KeyF') playerOfferFood(getWorld());
    }
    inputState.keys.add(e.code);
  });

  window.addEventListener('keyup', (e) => inputState.keys.delete(e.code));
  window.addEventListener('blur', () => inputState.keys.clear());

  window.addEventListener('mousedown', (e) => {
    const ui = useUI.getState();
    if (ui.mode !== 'live' || ui.helpOpen || !ui.pointerLocked) return;
    if (e.button === 0) playerAttack(getWorld());
    if (e.button === 2) playerDodge(getWorld());
  });
  window.addEventListener('contextmenu', (e) => {
    if (useUI.getState().mode === 'live' && useUI.getState().pointerLocked) e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!useUI.getState().pointerLocked) return;
    inputState.camYaw -= e.movementX * 0.0026;
    inputState.camPitch -= e.movementY * 0.0022;
    inputState.camPitch = Math.max(-1.15, Math.min(0.5, inputState.camPitch));
  });

  window.addEventListener('wheel', (e) => {
    if (useUI.getState().mode !== 'live') return;
    inputState.camDist = Math.max(3, Math.min(9, inputState.camDist + e.deltaY * 0.004));
  });

  document.addEventListener('pointerlockchange', () => {
    useUI.getState().setPointerLocked(Boolean(document.pointerLockElement));
  });
}
