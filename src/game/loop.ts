import { MAX_TICKS_PER_FRAME, SIM_DT, TICK_BUDGET_MS } from '../sim/config';
import { getWorld, rebuildIndex } from '../sim';
import { updatePlayer } from '../sim/player';
import { simTick } from '../sim/simulation';
import { buildSummary, snapshot, type WorldSnapshot } from '../sim/summary';
import { useUI, type SimSpeed } from '../state/store';
import { inputState, readMoveAxes } from './input';
import { soundTick } from './sound';

/**
 * The game loop. World simulation advances in fixed SIM_DT steps scaled by
 * the chosen sim speed; Kai integrates in real time so he stays
 * controllable while the world fast-forwards around him.
 */

let started = false;
let accumulator = 0;
let lastTime = 0;
let lastPulse = 0;
let ariShownAt = 0;

/** Snapshot captured when the world was last put into fast-forward. */
let fastForwardFrom: WorldSnapshot | null = null;
let lastSpeed: SimSpeed = 1;

/** tps = sim ticks/second; simRate = achieved sim-seconds per real second. */
export const perf = { tps: 0, fps: 0, simRate: 0 };
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

  // Track entry into and exit from accelerated time so the player gets a
  // truthful account of what changed while they were not watching closely.
  if (ui.speed !== lastSpeed || (ui.paused && fastForwardFrom && lastSpeed > 1)) {
    const wasFast = lastSpeed > 1;
    const isFast = ui.speed > 1 && !ui.paused;
    if (!wasFast && isFast) {
      fastForwardFrom = snapshot(world);
    } else if (wasFast && !isFast && fastForwardFrom) {
      const summary = buildSummary(world, fastForwardFrom);
      if (summary) {
        ui.setSummary(summary);
        world.ariQueue.push(
          `${summary.elapsedLabel.toLowerCase().replace(' elapsed', '')} passed. I kept notes while you were skipping ahead.`,
        );
      }
      fastForwardFrom = null;
    }
    lastSpeed = ui.paused ? 1 : ui.speed;
  }

  if (running) {
    accumulator += dt * ui.speed;
    let ticks = 0;
    const budgetEnd = now + TICK_BUDGET_MS;
    while (accumulator >= SIM_DT && ticks < MAX_TICKS_PER_FRAME) {
      simTick(world, SIM_DT);
      accumulator -= SIM_DT;
      ticks++;
      // Check the clock periodically rather than every tick.
      if ((ticks & 7) === 0 && performance.now() > budgetEnd) break;
    }
    // Whatever we could not afford this frame is dropped, not carried, so a
    // slow frame never snowballs into an unrecoverable backlog.
    if (accumulator > SIM_DT * 4) accumulator = 0;
    tickCount += ticks;

    // Player moves in real time, only in Live Mode.
    if (ui.mode === 'live') {
      const axes = readMoveAxes();
      updatePlayer(world, dt, { ...axes, camYaw: inputState.camYaw });
    } else {
      updatePlayer(world, dt, { moveX: 0, moveZ: 0, sprint: false, jump: false, camYaw: inputState.camYaw });
    }
  }

  // Combat audio observes the world it has just finished stepping. Presentation
  // only — nothing here writes back into the simulation.
  soundTick(world);

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
  if (world.dirty.structures) {
    world.dirty.structures = false;
    ui.bumpStructures();
  }

  // ARI line display: one at a time, ~6.5s each.
  if (world.ariQueue.length > 0 && now - ariShownAt > 6500) {
    ui.setAriLine(world.ariQueue.shift()!);
    ariShownAt = now;
  } else if (ui.ariLine && now - ariShownAt > 6500) {
    ui.setAriLine(null);
  }

  // Close a finished conversation panel once the settler resumes their life.
  const dialogue = ui.dialogue;
  if (dialogue) {
    const s = world.settlers.find((x) => x.id === dialogue.settlerId);
    if (!s || world.timeSec >= s.talkingUntil) ui.closeDialogue();
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
    perf.simRate = (tickCount * SIM_DT * 1000) / (now - perfWindowStart);
    tickCount = 0;
    frameCount = 0;
    perfWindowStart = now;
  }

  requestAnimationFrame(frame);
}
