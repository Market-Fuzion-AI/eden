import { getWorld } from '../sim';
import { ariCreatorToggle } from '../sim/ari';
import { playerAttack, playerDodge, playerGather, playerOfferFood, playerTalk } from '../sim/player';
import { useUI } from '../state/store';

/**
 * Global input: keyboard state + one-shot actions. Camera yaw/pitch live here
 * so the sim-side player update can read movement direction without touching
 * the renderer.
 *
 * Pointer lock is *camera look*, nothing more. It is only ever requested by an
 * explicit click on the viewport in Live Mode, and Escape always releases it
 * without any other side effect.
 */

export const inputState = {
  keys: new Set<string>(),
  camYaw: Math.PI, // start looking back across the valley
  camPitch: -0.28,
  camDist: 5.6,
};

/** Movement axes. moveX: +1 = screen right. moveZ: +1 = away from camera. */
export function readMoveAxes(): { moveX: number; moveZ: number; sprint: boolean; jump: boolean } {
  const k = inputState.keys;
  let moveX = 0;
  let moveZ = 0;
  if (k.has('KeyW') || k.has('ArrowUp')) moveZ += 1;
  if (k.has('KeyS') || k.has('ArrowDown')) moveZ -= 1;
  if (k.has('KeyA') || k.has('ArrowLeft')) moveX -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) moveX += 1;
  const mag = Math.hypot(moveX, moveZ);
  if (mag > 1) {
    moveX /= mag;
    moveZ /= mag;
  }
  return { moveX, moveZ, sprint: k.has('ShiftLeft') || k.has('ShiftRight'), jump: k.has('Space') };
}

export function isPointerLocked(): boolean {
  return Boolean(document.pointerLockElement);
}

export function releasePointerLock(): void {
  if (document.pointerLockElement) document.exitPointerLock();
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
      ui.closeDialogue();
      // Creator Mode is a cursor mode: never hold pointer lock there.
      releasePointerLock();
      if (next === 'creator') ariCreatorToggle(getWorld());
      return;
    }

    if (e.code === 'Escape') {
      // Escape's first job is always to give the cursor back. The browser
      // releases the lock itself; we simply do not also open a menu, so the
      // key never feels like it did two things at once.
      if (isPointerLocked()) return;
      if (ui.dialogue) {
        ui.closeDialogue();
        return;
      }
      ui.setHelpOpen(!ui.helpOpen);
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
      if (e.code === 'KeyE') {
        const world = getWorld();
        // Gathering takes precedence when standing at a bush; otherwise talk.
        const acted = playerGather(world);
        if (!acted) {
          const exchange = playerTalk(world);
          if (exchange) ui.openDialogue(exchange);
        }
      }
      if (e.code === 'KeyF') playerOfferFood(getWorld());
    }
    inputState.keys.add(e.code);
  });

  window.addEventListener('keyup', (e) => inputState.keys.delete(e.code));
  window.addEventListener('blur', () => inputState.keys.clear());

  window.addEventListener('mousedown', (e) => {
    const ui = useUI.getState();
    if (ui.mode !== 'live' || ui.helpOpen || !isPointerLocked()) return;
    if (e.button === 0) playerAttack(getWorld());
    if (e.button === 2) playerDodge(getWorld());
  });
  window.addEventListener('contextmenu', (e) => {
    if (useUI.getState().mode === 'live' && isPointerLocked()) e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPointerLocked()) return;
    inputState.camYaw -= e.movementX * 0.0026;
    inputState.camPitch -= e.movementY * 0.0022;
    inputState.camPitch = Math.max(-1.05, Math.min(0.45, inputState.camPitch));
  });

  window.addEventListener('wheel', (e) => {
    if (useUI.getState().mode !== 'live') return;
    inputState.camDist = Math.max(3, Math.min(9, inputState.camDist + e.deltaY * 0.004));
  });

  document.addEventListener('pointerlockchange', () => {
    const locked = isPointerLocked();
    const ui = useUI.getState();
    ui.setPointerLocked(locked);
    // Once the player has locked once, they have learned the interaction and
    // the teaching prompt retires for good.
    if (locked && !ui.learnedLook) ui.setLearnedLook(true);
    // Never leave a movement key stuck down when control changes hands.
    if (!locked) inputState.keys.clear();
  });
}
