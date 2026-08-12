/**
 * Gate 1 keyboard checks, on their own.
 *
 * The same assertions the full smoke run makes about the 3Cs control scheme,
 * extracted so they can be re-run in a minute instead of twenty-five. The full
 * script remains the authority; this exists so a control change can be checked
 * without waiting through every fast-forward in the suite.
 *
 * Usage:
 *   npx vite preview --port 4173 &
 *   node scripts/gate1-check.mjs [url]
 */
import { chromium } from 'playwright-core';

const TARGET_URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const SEED = Number(process.env.EDEN_SEED ?? 31337);

const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    console.log(`  ✗ ${name} ${detail}`);
    failures.push(name);
  }
};

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
await page.addInitScript((seed) => window.localStorage.setItem('eden.seed', String(seed)), SEED);
await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);
if (await page.locator('.help').isVisible().catch(() => false)) await page.locator('.help-resume').click();
await page.waitForTimeout(1200);

console.log('\nGATE 1 — KEYBOARD ONLY');

const toCourse = async () => {
  await page.evaluate(() => {
    const { getWorld, input, camera, course } = window.__EDEN__;
    const world = getWorld();
    course.resetToCourseStart(world);
    input.inputState.keys.clear();
    camera.resetKeyLook();
    camera.drainLook();
    input.inputState.camYaw = world.player.heading;
    input.inputState.camPitch = -0.2;
  });
};

// Walk and turn at once — the whole point of the scheme.
await toCourse();
await page.evaluate(() => {
  window.__gateWalk = { path: 0, topSpeed: 0, x: null, z: null };
  const { getWorld } = window.__EDEN__;
  const sample = () => {
    const p = getWorld().player;
    const s = window.__gateWalk;
    if (s.x !== null) s.path += Math.hypot(p.pos.x - s.x, p.pos.z - s.z);
    s.x = p.pos.x;
    s.z = p.pos.z;
    s.topSpeed = Math.max(s.topSpeed, p.speed);
    s.raf = requestAnimationFrame(sample);
  };
  sample();
});
const gateBefore = await page.evaluate(() => {
  const { getWorld, input } = window.__EDEN__;
  const p = getWorld().player;
  return { yaw: input.inputState.camYaw, clock: p.clock };
});
await page.keyboard.down('KeyW');
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(3000);
const during = await page.evaluate(() => {
  const { getWorld, input } = window.__EDEN__;
  const p = getWorld().player;
  return { yaw: input.inputState.camYaw, clock: p.clock, held: input.inputState.keys.has('KeyW') };
});
const walk = await page.evaluate(() => {
  cancelAnimationFrame(window.__gateWalk.raf);
  return { path: window.__gateWalk.path, topSpeed: window.__gateWalk.topSpeed };
});
await page.keyboard.up('ArrowRight');
await page.keyboard.up('KeyW');
await page.waitForTimeout(400);
const elapsed = Math.max(0.001, during.clock - gateBefore.clock);
check('the arrow keys turn the camera', Math.abs(during.yaw - gateBefore.yaw) > 0.3,
  `${Math.abs(during.yaw - gateBefore.yaw).toFixed(2)} rad`);
check('W is still held while the camera turns', during.held);
check('Emerson keeps walking while the camera turns',
  walk.path > 0.4 && walk.path / elapsed > 2 && walk.topSpeed > 2.5,
  `${walk.path.toFixed(2)}m in ${elapsed.toFixed(2)}s of player time, top ${walk.topSpeed.toFixed(2)} m/s`);

console.log(`\n${failures.length === 0 ? 'GATE 1 CHECKS PASSED' : `FAILED — ${failures.length}`}`);
console.log(`browser errors: ${errors.length}`);
await browser.close();
process.exit(failures.length === 0 && errors.length === 0 ? 0 : 1);
