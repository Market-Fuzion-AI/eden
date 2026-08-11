import { MAX_TICKS_PER_FRAME, SIM_DT } from '../sim/config';
import { getWorld, rebuildIndex } from '../sim';
import { updatePlayer } from '../sim/player';
import { simTick } from '../sim/simulation';
import { useUI } from '../state/store';
import { inputState, readMoveAxes } from './input';

/**
 * The game loop. World simulation advances in fixed SIM_DT steps scaled by
 * the chosen sim speed; Emerson integrates in real time so he stays
 * controllable while the world fast-forwards around him.
 */

let started = false;
let accumulator = 0;
let lastTime = 0;
let lastPulse = 0;
let ariShownAt = 0;

export const perf = { tps: 0, fps: 0 };
let tickCount = 0;
let frameCount = 0;
let perfWindowStart = 0;

export function startLoop(): void {
  if (started) return;
  started = true;
  lastTime = performance.now();
  perfWindowStart = lastTime;
  requestAnimationFrame(frame);
}

function frame(now: number): void {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  const ui = useUI.getState();
  const world = getWorld();
  const running = !ui.paused && !ui.helpOpen;

  if (running) {
    accumulator += dt * ui.speed;
    let ticks = 0;
    while (accumulator >= SIM_DT && ticks < MAX_TICKS_PER_FRAME) {
      simTick(world, SIM_DT);
      accumulator -= SIM_DT;
      ticks++;
    }
    if (ticks >= MAX_TICKS_PER_FRAME) accumulator = 0; // drop backlog rather than spiral
    tickCount += ticks;

    // Player moves in real time, only in Live Mode.
    if (ui.mode === 'live') {
      const axes = readMoveAxes();
      updatePlayer(world, dt, { ...axes, camYaw: inputState.camYaw });
    } else {
      updatePlayer(world, dt, { moveX: 0, moveZ: 0, sprint: false, jump: false, camYaw: inputState.camYaw });
    }
  }

  // Structural changes → version bumps for React.
  if (world.dirty.entities) {
    world.dirty.entities = false;
    rebuildIndex();
    ui.bumpEntities();
  }
  if (world.dirty.resources) {
    world.dirty.resources = false;
    ui.bumpResources();
  }

  // ARI line display: one at a time, ~6.5s each.
  if (world.ariQueue.length > 0 && now - ariShownAt > 6500) {
    ui.setAriLine(world.ariQueue.shift()!);
    ariShownAt = now;
  } else if (ui.ariLine && now - ariShownAt > 6500) {
    ui.setAriLine(null);
  }

  // UI heartbeat ~5 Hz.
  if (now - lastPulse > 200) {
    lastPulse = now;
    ui.bumpPulse();
  }

  // Perf counters.
  frameCount++;
  if (now - perfWindowStart > 1000) {
    perf.tps = Math.round((tickCount * 1000) / (now - perfWindowStart));
    perf.fps = Math.round((frameCount * 1000) / (now - perfWindowStart));
    tickCount = 0;
    frameCount = 0;
    perfWindowStart = now;
  }

  requestAnimationFrame(frame);
}
