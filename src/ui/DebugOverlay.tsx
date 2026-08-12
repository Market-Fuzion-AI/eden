import { useEffect, useRef } from 'react';
import { getWorld } from '../sim';
import { perf } from '../game/loop';
import { held } from '../game/bindings';
import { inputState, inputTelemetry } from '../game/input';
import { moveTelemetry } from '../sim/player';
import { standingSlope } from '../sim/course';
import { PLAYER } from '../sim/config';
import { useUI } from '../state/store';

/**
 * The QA overlay (F3).
 *
 * Gate 1 is judged by a human playing the game, and a human cannot see why a
 * step felt wrong — whether Emerson was actually airborne, whether a boulder
 * was eating the input, whether the camera had drifted. This shows the handful
 * of numbers that answer those questions and nothing else. It is off by default
 * and never appears during normal play.
 *
 * Movement numbers change every frame, so they are written straight into the
 * DOM from a rAF loop rather than through React state: a 60 Hz store update
 * would re-render every panel in the game to move one decimal place.
 */

/** One live readout: a label, and a function producing its current value. */
type Row = { label: string; read: () => string; warn?: () => boolean };

const deg = (rad: number): string => `${(rad * 180 / Math.PI).toFixed(0)}°`;

/** WASD / arrows / Shift / Space as a lit-key strip, so held input is visible. */
function inputStrip(): string {
  const k = inputState.keys;
  const lit = (on: boolean, ch: string) => (on ? ch : '·');
  const move =
    lit(held('moveForward', k), 'W') +
    lit(held('moveLeft', k), 'A') +
    lit(held('moveBack', k), 'S') +
    lit(held('moveRight', k), 'D');
  const look =
    lit(held('camLeft', k), '←') +
    lit(held('camDown', k), '↓') +
    lit(held('camUp', k), '↑') +
    lit(held('camRight', k), '→');
  const mods = `${held('sprint', k) ? 'SHIFT' : '·····'} ${held('jump', k) ? 'SPACE' : '·····'}`;
  return `${move} ${look} ${mods}`;
}

const ROWS: Row[] = [
  {
    label: 'speed',
    read: () => {
      const p = getWorld().player;
      const cap = p.stamina > 5 && held('sprint', inputState.keys) ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
      return `${p.speed.toFixed(2)} m/s  (want ${p.moveSpeed.toFixed(2)} · max ${cap.toFixed(1)})`;
    },
  },
  {
    label: 'ground',
    read: () => {
      const p = getWorld().player;
      if (p.onGround) return `grounded${moveTelemetry.onProp ? ' · on course prop' : ''}`;
      return `AIRBORNE  vy ${p.vy >= 0 ? '+' : ''}${p.vy.toFixed(1)}  y ${p.y.toFixed(2)}`;
    },
    warn: () => !getWorld().player.onGround,
  },
  {
    label: 'slope',
    read: () => {
      const p = getWorld().player;
      const grade = standingSlope(getWorld(), p.pos.x, p.pos.z, p.y);
      const angle = (Math.atan(grade) * 180) / Math.PI;
      return `${angle.toFixed(0)}°${moveTelemetry.slopeSlide ? '  TOO STEEP — sliding' : ''}`;
    },
    warn: () => moveTelemetry.slopeSlide,
  },
  {
    label: 'collision',
    read: () => {
      if (moveTelemetry.contacts === 0 && moveTelemetry.blocked < 0.05) return 'clear';
      const pct = Math.round(moveTelemetry.blocked * 100);
      return `${moveTelemetry.contacts} contact${moveTelemetry.contacts === 1 ? '' : 's'} · ${pct}% blocked`;
    },
    warn: () => moveTelemetry.blocked > 0.6,
  },
  {
    label: 'camera',
    read: () => `yaw ${deg(inputState.camYaw)}  pitch ${deg(inputState.camPitch)}  dist ${inputState.camDist.toFixed(1)}`,
  },
  { label: 'input', read: inputStrip },
  {
    label: 'facing',
    read: () => {
      const p = getWorld().player;
      // The difference between where the camera looks and where Emerson goes is
      // exactly where an A/D inversion would show up.
      let rel = (p.heading - inputState.camYaw) % (Math.PI * 2);
      if (rel > Math.PI) rel -= Math.PI * 2;
      if (rel < -Math.PI) rel += Math.PI * 2;
      return `heading ${deg(p.heading)}  (${deg(rel)} from camera)`;
    },
  },
  {
    label: 'actions',
    read: () => {
      const now = performance.now();
      const ago = (t: number) => (t > 0 ? `${((now - t) / 1000).toFixed(1)}s ago` : '—');
      return `jump ${ago(inputTelemetry.lastJumpAt)} · quick-step ${ago(inputTelemetry.lastQuickStepAt)} (${inputTelemetry.quickSteps})`;
    },
  },
  {
    label: 'position',
    read: () => {
      const p = getWorld().player;
      return `${p.pos.x.toFixed(1)}, ${p.pos.z.toFixed(1)}  stamina ${Math.round(p.stamina)}`;
    },
  },
];

export function DebugOverlay() {
  useUI((s) => s.uiPulse);
  const world = getWorld();
  const speed = useUI((s) => s.speed);
  const paused = useUI((s) => s.paused);
  const mode = useUI((s) => s.mode);
  // Achieved sim rate vs requested — makes any frame-rate throttling visible.
  const requested = paused ? 0 : speed;
  const lagging = !paused && perf.simRate > 0 && perf.simRate < requested * 0.8;

  const cells = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      for (let i = 0; i < ROWS.length; i++) {
        const el = cells.current[i];
        if (!el) continue;
        el.textContent = ROWS[i].read();
        const warn = ROWS[i].warn?.() ?? false;
        // Toggling only on change keeps this off the style recalc path.
        if (warn !== el.classList.contains('debug-warn')) el.classList.toggle('debug-warn', warn);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="debug panel">
      <div className="debug-title">QA · F3</div>
      {mode === 'live' ? (
        <div className="debug-rows">
          {ROWS.map((r, i) => (
            <div key={r.label} className="debug-row">
              <span className="debug-label">{r.label}</span>
              <span
                className="debug-value"
                ref={(el) => {
                  cells.current[i] = el;
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="debug-note">Creator Mode — movement readouts pause</div>
      )}
      <div className="debug-sep" />
      <div>fps {perf.fps} · ticks/s {perf.tps}</div>
      <div className={lagging ? 'debug-warn' : undefined}>
        sim {perf.simRate.toFixed(1)}× / {requested}× {lagging ? '(throttled)' : ''}
      </div>
      <div>seed {world.seed} · t {world.timeSec.toFixed(1)}s</div>
      <div>
        entities {world.settlers.length + world.creatures.length + 1} · chronicle {world.chronicle.length}
      </div>
      <div className="debug-note">F4 resets to the 3Cs start</div>
    </div>
  );
}
