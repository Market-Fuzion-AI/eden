/**
 * Gate 1 visual review — the 3Cs.
 *
 * Takes a picture of every situation the gate asks a human to judge: plain
 * walking, a slope, the rock slalom, the ledge that has to be jumped, the
 * narrow crossing, the elevated route, and the camera pressed up against
 * geometry. Automated checks can prove the jump reaches 1.25 m; only a picture
 * shows whether the player can *see* where they are about to land.
 *
 * Usage:
 *   npx vite preview --port 4173 &
 *   node scripts/gate1-shots.mjs [url]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const TARGET_URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const SHOT_DIR = new URL('../smoke-shots', import.meta.url).pathname;
mkdirSync(SHOT_DIR, { recursive: true });
const SEED = Number(process.env.EDEN_SEED ?? 31337);

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
page.on('pageerror', (err) => console.log('pageerror:', err.message));
await page.addInitScript((seed) => window.localStorage.setItem('eden.seed', String(seed)), SEED);
await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);
if (await page.locator('.help').isVisible().catch(() => false)) await page.locator('.help-resume').click();
await page.waitForTimeout(1200);

// Broad daylight, so every shot is judged on its geometry and not its lighting.
await page.evaluate(() => {
  const { getWorld, config } = window.__EDEN__;
  const w = getWorld();
  const day = Math.floor(w.timeSec / config.DAY_SEC);
  w.timeSec = day * config.DAY_SEC + config.DAY_SEC * 0.5;
});

/**
 * Stand Kai at a point on the course and aim the camera down the run.
 *
 * `bay` is an index into the props; the shot is composed from the prop's own
 * position so it keeps working if the course is re-tuned or the terrain puts
 * the run on a different bearing.
 */
async function shot(name, setup, { settle = 2800, pitch = -0.2, dist = 7, yawOffset = 0, elevate = 0 } = {}) {
  await page.evaluate(
    ({ setupSrc, pitch, dist, yawOffset, elevate }) => {
      const { getWorld, input, terrain, course } = window.__EDEN__;
      const w = getWorld();
      // eslint-disable-next-line no-new-func
      const aim = new Function('w', 'EDEN', setupSrc)(w, window.__EDEN__);
      w.player.pos.x = aim.from.x;
      w.player.pos.z = aim.from.z;
      w.player.y = course.standingHeight(w, aim.from.x, aim.from.z, 999) + elevate;
      w.player.onGround = elevate === 0;
      w.player.vy = elevate > 0 ? 2.4 : 0;
      const yaw = Math.atan2(aim.at.x - aim.from.x, aim.at.z - aim.from.z);
      w.player.heading = yaw;
      input.inputState.camYaw = yaw + yawOffset;
      input.inputState.camPitch = pitch;
      input.inputState.camDist = dist;
      // Freeze so the pose survives the render latency of a software GL stack.
      window.__EDEN__.useUI.getState().setPaused(true);
      void terrain;
    },
    { setupSrc: setup, pitch, dist, yawOffset, elevate },
  );
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
  await page.evaluate(() => window.__EDEN__.useUI.getState().setPaused(false));
  console.log('  ·', name);
}

/** Look down the course from a little before a given prop. */
const atProp = (index, back = 6, side = 0) => `
  const props = w.course;
  const target = props[${index}];
  const first = props[0];
  const last = props[props.length - 1];
  const dx = last.pos.x - first.pos.x, dz = last.pos.z - first.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  const sx = uz, sz = -ux;
  return {
    from: { x: target.pos.x - ux * ${back} + sx * ${side}, z: target.pos.z - uz * ${back} + sz * ${side} },
    at: { x: target.pos.x, z: target.pos.z },
  };
`;

console.log('\nGATE 1 — THE 3Cs');

// 1. The start of the run, looking down it.
await shot('g1-01-start', `
  const start = EDEN.course.courseStart(w);
  const last = w.course[w.course.length - 1];
  return { from: { x: start.x, z: start.z }, at: { x: last.pos.x, z: last.pos.z } };
`, { dist: 8.5, pitch: -0.16 });

// 2. Plain walking on open ground — the first thing the gate asks about.
await shot('g1-02-open-ground', `
  const start = EDEN.course.courseStart(w);
  const props = w.course;
  const first = props[0], last = props[props.length - 1];
  const dx = last.pos.x - first.pos.x, dz = last.pos.z - first.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  return {
    from: { x: start.x + (dx / len) * 6, z: start.z + (dz / len) * 6 },
    at: { x: last.pos.x, z: last.pos.z },
  };
`, { dist: 7, pitch: -0.18 });

// 3. The rock slalom — turning, and the camera coping with near geometry.
await shot('g1-03-slalom', atProp(3, 7), { dist: 7, pitch: -0.2 });

// 4. Camera pressed up against an obstacle: the classic third-person failure.
await shot('g1-04-camera-at-rock', atProp(4, 1.6, 1.2), { dist: 7, pitch: -0.1 });

// 5. The step-and-ledge pair: one you stroll onto, one you must jump.
await shot('g1-05-step-and-ledge', atProp(9, 8), { dist: 8, pitch: -0.14 });

// 6. Mid-jump at the ledge, so the pose and the arc can both be judged.
await shot('g1-06-jump', atProp(9, 2.2), { dist: 6.5, pitch: -0.05, elevate: 0.85 });

// 7. The gap between the two platforms.
await shot('g1-07-the-gap', atProp(11, 7), { dist: 8, pitch: -0.18 });

// 8. The narrow crossing. Shot from further back and higher, because the whole
// question about a plank is whether you can see both it and your feet.
await shot('g1-08-plank', atProp(12, 11), { dist: 8.5, pitch: -0.3 });

// 9. The narrow passage — approached down the middle, which is the only place
// the gap between the two rocks is actually a question.
await shot('g1-09-narrow-passage', `
  const props = w.course;
  const a = props[13], b = props[14];
  const mid = { x: (a.pos.x + b.pos.x) / 2, z: (a.pos.z + b.pos.z) / 2 };
  const first = props[0], last = props[props.length - 1];
  const dx = last.pos.x - first.pos.x, dz = last.pos.z - first.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  return { from: { x: mid.x - (dx / len) * 6, z: mid.z - (dz / len) * 6 }, at: mid };
`, { dist: 6.5, pitch: -0.14 });

// 10. The elevated route, from below and then from the top looking back.
await shot('g1-10-elevated', atProp(17, 9), { dist: 8.5, pitch: -0.1 });
await shot('g1-11-summit', `
  const props = w.course;
  const top = props[props.length - 2];
  const first = props[0];
  return { from: { x: top.pos.x, z: top.pos.z }, at: { x: first.pos.x, z: first.pos.z } };
`, { dist: 9, pitch: -0.3 });

// 11. A real slope, off the course, where the ground does the work.
await shot('g1-12-slope', `
  const t = EDEN.terrain;
  let best = null, bestSlope = 0;
  const start = EDEN.course.courseStart(w);
  for (let r = 12; r < 90; r += 4) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const x = start.x + Math.sin(a) * r, z = start.z + Math.cos(a) * r;
      if (t.isWater(x, z)) continue;
      const s = t.slopeAt(x, z);
      if (s > bestSlope && s < 0.85) { bestSlope = s; best = { x, z }; }
    }
  }
  const p = best ?? { x: start.x, z: start.z };
  const e = 1.2;
  const gx = t.groundY(p.x + e, p.z) - t.groundY(p.x - e, p.z);
  const gz = t.groundY(p.x, p.z + e) - t.groundY(p.x, p.z - e);
  const gl = Math.hypot(gx, gz) || 1;
  // Aim across the slope rather than into it. Looking straight uphill buries
  // the camera in the hillside and shows nothing about how the ground reads.
  return { from: p, at: { x: p.x + (gz / gl) * 12, z: p.z - (gx / gl) * 12 } };
`, { dist: 8.5, pitch: -0.24 });

// 12. The QA overlay, on, during movement.
await page.evaluate(() => {
  const { useUI, input } = window.__EDEN__;
  if (!useUI.getState().debugOpen) useUI.getState().toggleDebug();
  input.inputState.keys.add('KeyW');
});
await page.waitForTimeout(2600);
await page.screenshot({ path: `${SHOT_DIR}/g1-13-qa-overlay.png` });
console.log('  · g1-13-qa-overlay');
await page.evaluate(() => {
  const { useUI, input } = window.__EDEN__;
  input.inputState.keys.clear();
  useUI.getState().toggleDebug();
});

// 13. Creator Mode looking down on the whole test area.
await page.evaluate(() => {
  const { useUI, getWorld } = window.__EDEN__;
  const w = getWorld();
  const first = w.course[0];
  const last = w.course[w.course.length - 1];
  useUI.getState().setMode('creator');
  useUI.getState().requestFocus((first.pos.x + last.pos.x) / 2, (first.pos.z + last.pos.z) / 2);
});
await page.waitForTimeout(4000);
await page.screenshot({ path: `${SHOT_DIR}/g1-14-creator-overview.png` });
console.log('  · g1-14-creator-overview');

// 14. The controls card itself.
await page.evaluate(() => {
  const ui = window.__EDEN__.useUI.getState();
  ui.setMode('live');
  ui.setHelpOpen(true);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOT_DIR}/g1-15-controls.png` });
console.log('  · g1-15-controls');

await browser.close();
console.log('\nshots written to smoke-shots/');
