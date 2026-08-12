import { getWorld } from '../sim';
import { ariCreatorToggle } from '../sim/ari';
import {
  fabricatorAtHand,
  playerAskPermission,
  playerDodge,
  playerGather,
  playerOfferFood,
  playerStrike,
  playerTalk,
  playerToggleLock,
} from '../sim/player';
import { useMedkit } from '../sim/fabrication';
import { performScan } from '../sim/scanner';
import { useUI } from '../state/store';
import { addLook, requestRecenter } from './camera';
import { primeAudio } from './audio';

/**
 * Global input: keyboard state + one-shot actions. Camera yaw/pitch live here
 * so the sim-side player update can read movement direction without touching
 * the renderer.
 *
 * Looking around never requires pointer lock. See `camera.ts` for the input
 * model; this file only routes device events into it.
 */

export const inputState = {
  keys: new Set<string>(),
  camYaw: 0,
  camPitch: -0.24,
  camDist: 6.4,
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
  // V jumps. Space became the dodge in v0.8: it is the single most-pressed key
  // in a fight, and a trackpad player has no comfortable alternative for it.
  return { moveX, moveZ, sprint: k.has('ShiftLeft') || k.has('ShiftRight'), jump: k.has('KeyV') };
}

/** The movement input a dodge should travel along. */
function dodgeInput(): { moveX: number; moveZ: number; camYaw: number } {
  const axes = readMoveAxes();
  return { moveX: axes.moveX, moveZ: axes.moveZ, camYaw: inputState.camYaw };
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
    // Browsers refuse to start an AudioContext outside a user gesture. Every
    // key press is one, so this is where combat audio actually comes alive.
    primeAudio();

    if (e.code === 'Tab') {
      e.preventDefault();
      const next = ui.mode === 'live' ? 'creator' : 'live';
      ui.setMode(next);
      ui.setHelpOpen(false);
      ui.closeDialogue();
      ui.setFabricatorOpen(false);
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
      if (ui.fabricatorOpen) {
        ui.setFabricatorOpen(false);
        return;
      }
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
    // C is the Chronicle in Creator Mode and the camera recenter in Live Mode.
    if (e.code === 'KeyC') {
      if (ui.mode === 'creator') ui.toggleChronicle();
      else requestRecenter();
    }
    // Zoom without a trackpad pinch.
    if (e.code === 'BracketLeft') inputState.camDist = Math.max(3, inputState.camDist - 0.6);
    if (e.code === 'BracketRight') inputState.camDist = Math.min(11, inputState.camDist + 0.6);

    if (ui.mode === 'live' && !ui.helpOpen) {
      if (e.code === 'KeyE') {
        const world = getWorld();
        // Standing at the fabricator opens it; otherwise gather, otherwise talk.
        if (fabricatorAtHand(world) && !ui.fabricatorOpen) {
          ui.setFabricatorOpen(true);
        } else {
          const acted = playerGather(world);
          if (!acted) {
            const exchange = playerTalk(world);
            if (exchange) ui.openDialogue(exchange);
          }
        }
      }
      // Scanner sweep — the payoff of the first fabrication loop.
      if (e.code === 'KeyQ') {
        const world = getWorld();
        const result = performScan(world);
        if (!result.ok && result.reason === 'locked' && !world.flags.scannerHinted) {
          world.flags.scannerHinted = true;
          world.ariQueue.push(
            'No field analysis module installed. Petra could build one at the Fabricator, given the materials.',
          );
        }
      }
      if (e.code === 'KeyH') {
        const world = getWorld();
        const healed = useMedkit(world);
        if (healed > 0) world.ariQueue.push(`Medkit administered. ${Math.round(healed)} points recovered.`);
      }
      // Combat. Keyboard alternatives to the mouse buttons, because a trackpad
      // cannot hold a look-drag and click at the same time — every combat
      // action must be reachable from the left hand alone.
      if (e.code === 'KeyJ' && !inputState.keys.has('KeyJ')) playerStrike(getWorld(), 'light');
      if (e.code === 'KeyK' && !inputState.keys.has('KeyK')) playerStrike(getWorld(), 'heavy');
      if (e.code === 'KeyL' && !inputState.keys.has('KeyL')) playerToggleLock(getWorld());
      if (e.code === 'Space') {
        // Never let the dodge key scroll the page out from under the canvas.
        e.preventDefault();
        if (!inputState.keys.has('Space')) playerDodge(getWorld(), dodgeInput());
      }
      if (e.code === 'KeyF') playerOfferFood(getWorld());
      if (e.code === 'KeyR') {
        const reply = playerAskPermission(getWorld());
        if (reply) {
          ui.openDialogue({
            settlerId: 'permission',
            name: reply.name,
            speciesLabel: reply.outcome === 'refuse' ? 'refused' : 'gave permission',
            affinity: 0,
            firstMeeting: false,
            lines: [{ speaker: reply.name, text: reply.line }],
          });
        }
      }
    }
    inputState.keys.add(e.code);
  });

  window.addEventListener('keyup', (e) => inputState.keys.delete(e.code));
  // Only a genuine loss of focus clears held keys. Releasing the camera must
  // not, or looking around would keep stopping the player mid-stride.
  window.addEventListener('blur', () => inputState.keys.clear());

  window.addEventListener('mousemove', (e) => {
    // Pointer-lock look, for players who opted into it. Drag-look is handled
    // by the canvas pointer handlers below.
    if (!isPointerLocked()) return;
    addLook(e.movementX, e.movementY, 'lock');
  });

  document.addEventListener('pointerlockchange', () => {
    const locked = isPointerLocked();
    const ui = useUI.getState();
    ui.setPointerLocked(locked);
    if (locked && !ui.learnedLook) ui.setLearnedLook(true);
  });
}

/** True while a canvas drag is rotating the camera. */
let dragging = false;
/** Distance travelled during the current drag, to tell a look from a click. */
let dragTravel = 0;
let dragPointerId = -1;

export function isDraggingCamera(): boolean {
  return dragging;
}

/**
 * Attach look handlers to the WebGL canvas.
 *
 * Bound to the canvas rather than the window so that clicking a HUD button or
 * a Creator panel can never rotate the camera by accident.
 */
export function installCanvasLook(canvas: HTMLElement): () => void {
  const liveAndPlayable = () => {
    const ui = useUI.getState();
    return ui.mode === 'live' && !ui.helpOpen && !ui.dialogue;
  };

  const onWheel = (e: WheelEvent) => {
    if (!liveAndPlayable()) return;
    e.preventDefault();
    // A trackpad pinch arrives as ctrl+wheel; treat that (and a real ctrl-
    // scroll) as zoom, and everything else as a two-finger look swipe.
    if (e.ctrlKey || e.metaKey) {
      inputState.camDist = Math.max(3, Math.min(11, inputState.camDist + e.deltaY * 0.02));
      return;
    }
    addLook(e.deltaX, e.deltaY, 'wheel');
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!liveAndPlayable()) return;
    if (e.button !== 0 && e.button !== 2) return;
    primeAudio();
    dragging = true;
    dragTravel = 0;
    dragPointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragTravel += Math.abs(e.movementX) + Math.abs(e.movementY);
    addLook(e.movementX, e.movementY, 'drag');
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== dragPointerId) return;
    const travelled = dragTravel;
    dragging = false;
    dragPointerId = -1;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (!liveAndPlayable()) return;
    // A press that barely moved was a click, not a look. Only then does it
    // count as an action — so turning the camera never swings a fist.
    if (travelled < 6) {
      if (e.button === 0) playerStrike(getWorld(), 'light');
      if (e.button === 2) playerStrike(getWorld(), 'heavy');
    }
  };

  const onContextMenu = (e: Event) => {
    if (useUI.getState().mode === 'live') e.preventDefault();
  };

  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', onContextMenu);
  return () => {
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('contextmenu', onContextMenu);
  };
}
