/**
 * v0.8 visual tour.
 *
 * Drives the real game to the places this milestone added and takes a picture
 * of each one, in daylight, from a camera angle a player would actually be
 * looking from. Automated checks can tell you a wind-up happened; only a
 * screenshot tells you whether it reads.
 *
 * Usage:
 *   npx vite preview --port 4173 &
 *   node scripts/tour-v08.mjs [url]
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
await page.waitForTimeout(1000);

/** Put the world into broad daylight and arm Kai, once. */
await page.evaluate(() => {
  const { getWorld, config } = window.__EDEN__;
  const w = getWorld();
  // Midday of the current day, so every shot is lit.
  const day = Math.floor(w.timeSec / config.DAY_SEC);
  w.timeSec = day * config.DAY_SEC + config.DAY_SEC * 0.5;
  w.player.unlocks.arcBlade = true;
  w.player.equipped = 'arcBlade';
  w.player.unlocks.scanner = true;
});

/**
 * Stand Kai somewhere and point the camera at a subject.
 * Yaw follows the sim's convention: forward is (sin yaw, cos yaw).
 */
async function shot(name, setup, { settle = 2600, pitch = -0.22, dist = 7, yawOffset = 0 } = {}) {
  await page.evaluate(
    ({ setupSrc, pitch, dist, yawOffset }) => {
      const { getWorld, input } = window.__EDEN__;
      const w = getWorld();
      // eslint-disable-next-line no-new-func
      const fn = new Function('w', 'EDEN', setupSrc);
      const aim = fn(w, window.__EDEN__);
      w.player.pos.x = aim.from.x;
      w.player.pos.z = aim.from.z;
      w.player.y = window.__EDEN__.terrain.groundY(aim.from.x, aim.from.z);
      const yaw = Math.atan2(aim.at.x - aim.from.x, aim.at.z - aim.from.z);
      w.player.heading = yaw;
      // Offsetting the camera keeps Kai from standing squarely in front of
      // whatever the shot is meant to show.
      input.inputState.camYaw = yaw + yawOffset;
      input.inputState.camPitch = pitch;
      input.inputState.camDist = dist;
    },
    { setupSrc: setup, pitch, dist, yawOffset },
  );
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
  console.log('  ·', name);
}

console.log('\nv0.8 TOUR');

// 1. The Arc Blade, drawn, at Human Landing.
await shot(
  'v08-arc-blade',
  `
  const fab = w.fabricatorPos;
  // Force the blade out of its stow by faking a recent hit.
  w.player.lastHurtAt = w.timeSec;
  return { from: { x: fab.x + 4, z: fab.z + 5 }, at: fab };
  `,
  { dist: 5.2, pitch: -0.2 },
);

// 2. A Rakhor warning Kai off, from the distance the warning happens at.
await shot(
  'v08-rakhor-warning',
  `
  const c = w.creatures
    .filter((x) => x.speciesId === 'rakhor')
    // Open, gentle ground: a canyon-floor predator makes an unreadable
    // screenshot, which is the one thing this script is for.
    .sort((a, b) => EDEN.terrain.slopeAt(a.pos.x, a.pos.z) - EDEN.terrain.slopeAt(b.pos.x, b.pos.z))[0];
  const spot = { x: c.pos.x - 6, z: c.pos.z - 6 };
  c.combat.state = 'warn';
  c.combat.since = w.timeSec;
  w.player.lastHurtAt = w.timeSec;
  return { from: spot, at: c.pos };
  `,
  { dist: 6.4, pitch: -0.15, yawOffset: 0.45 },
);

// 3. The same animal committing — the wind-up the dodge answers.
await shot(
  'v08-rakhor-windup',
  `
  const c = w.creatures
    .filter((x) => x.speciesId === 'rakhor')
    // Open, gentle ground: a canyon-floor predator makes an unreadable
    // screenshot, which is the one thing this script is for.
    .sort((a, b) => EDEN.terrain.slopeAt(a.pos.x, a.pos.z) - EDEN.terrain.slopeAt(b.pos.x, b.pos.z))[0];
  const spot = { x: c.pos.x - 3.2, z: c.pos.z - 3.2 };
  c.combat.state = 'windup';
  c.combat.since = w.timeSec - 0.6;
  w.player.lastHurtAt = w.timeSec;
  return { from: spot, at: c.pos };
  `,
  { dist: 5.4, pitch: -0.12, yawOffset: -0.45 },
);

// 4. The Sunken Ring, from the rise a player would come over.
await shot(
  'v08-sunken-ring',
  `
  const ring = { x: -86, z: -14 };
  return { from: { x: ring.x + 30, z: ring.z + 32 }, at: ring };
  `,
  { dist: 10.5, pitch: -0.1, settle: 3200 },
);

// 5. A Warden Wisp, awake, on the ring it guards.
await shot(
  'v08-warden',
  `
  const warden = w.creatures.find((x) => EDEN.species.CREATURE_SPECIES_BY_ID[x.speciesId].synthetic);
  const spot = { x: warden.pos.x - 7, z: warden.pos.z - 7 };
  warden.combat.state = 'hostile';
  warden.combat.since = w.timeSec;
  w.player.lockedId = warden.id;
  w.player.lastHurtAt = w.timeSec;
  return { from: spot, at: warden.pos };
  `,
  { dist: 8.5, pitch: -0.18, yawOffset: 0.55 },
);

// 6. The Warden charging a shot — its tell, at its engagement range.
await shot(
  'v08-warden-windup',
  `
  const warden = w.creatures.find((x) => EDEN.species.CREATURE_SPECIES_BY_ID[x.speciesId].synthetic);
  const spot = { x: warden.pos.x - 6, z: warden.pos.z - 6 };
  warden.combat.state = 'windup';
  warden.combat.since = w.timeSec - 0.9;
  w.player.lockedId = warden.id;
  w.player.lastHurtAt = w.timeSec;
  return { from: spot, at: warden.pos };
  `,
  { dist: 7.5, pitch: -0.16, yawOffset: -0.5 },
);

// 7. Mid-swing, so the trail and the active window are visible together.
await page.evaluate(() => {
  const { getWorld, combat } = window.__EDEN__;
  const w = getWorld();
  const c = w.creatures
    .filter((x) => x.speciesId === 'rakhor')
    // Open, gentle ground: a canyon-floor predator makes an unreadable
    // screenshot, which is the one thing this script is for.
    .sort(
      (a, b) =>
        window.__EDEN__.terrain.slopeAt(a.pos.x, a.pos.z) - window.__EDEN__.terrain.slopeAt(b.pos.x, b.pos.z),
    )[0];
  w.player.pos.x = c.pos.x - 1.6;
  w.player.pos.z = c.pos.z - 1.6;
  w.player.heading = Math.atan2(c.pos.x - w.player.pos.x, c.pos.z - w.player.pos.z);
  window.__EDEN__.input.inputState.camYaw = w.player.heading - 0.7;
  window.__EDEN__.input.inputState.camDist = 5;
  w.player.lastHurtAt = w.timeSec;
  combat.beginStrike(w, 'heavy');
  // Park the swing inside its active window and hold it there.
  combat.strikeTick(w, window.__EDEN__.config.COMBAT.heavy.windup + 0.01);
});
await page.waitForTimeout(2600);
await page.screenshot({ path: `${SHOT_DIR}/v08-strike.png` });
console.log('  · v08-strike');

// 8. Low health, in combat — the HUD at its loudest.
await page.evaluate(() => {
  const w = window.__EDEN__.getWorld();
  w.player.health = 22;
  w.player.lastHurtAt = w.timeSec;
});
await page.waitForTimeout(2400);
await page.screenshot({ path: `${SHOT_DIR}/v08-critical.png` });
console.log('  · v08-critical');

// 9. The extraction.
await page.evaluate(() => {
  const { getWorld, combat } = window.__EDEN__;
  const w = getWorld();
  w.player.invulnUntil = -9999;
  combat.damagePlayer(w, 9999, 'a Warden Wisp');
});
await page.waitForTimeout(2400);
await page.screenshot({ path: `${SHOT_DIR}/v08-extraction.png` });
console.log('  · v08-extraction');

// v0.9 additions --------------------------------------------------------
// Each of the three light steps at its active window, the heavy, the dodge
// trail, the Rakhor's multi-channel tell, and the Warden's beam.
await page.evaluate(() => {
  const { getWorld, combat } = window.__EDEN__;
  const w = getWorld();
  // The extraction shot above left Kai on the floor. Finish the retrieval
  // before staging anything else, or every frame below is a death screen.
  if (w.player.extraction) combat.finishExtraction(w);
  w.player.dead = false;
  w.player.health = 100;
  w.player.unlocks.capacitor = true;
});
// Let the retrieval settle on the live loop before freezing it.
await page.waitForTimeout(900);
await page.evaluate(() => {
  // Staged poses only: with the loop running, a 0.2s active window is long
  // gone by the time the headless renderer produces a frame.
  window.__EDEN__.useUI.getState().setPaused(true);
});
for (const [name, kind, chain] of [['v09-light1', 'light', 1], ['v09-light2', 'light', 2], ['v09-light3', 'light', 3], ['v09-heavy', 'heavy', 1]]) {
  await page.evaluate(
    ({ kind, chain }) => {
      const { getWorld, combat } = window.__EDEN__;
      const w = getWorld();
      const c = w.creatures
        .filter((x) => x.speciesId === 'rakhor')
        .sort(
          (a, b) =>
            window.__EDEN__.terrain.slopeAt(a.pos.x, a.pos.z) - window.__EDEN__.terrain.slopeAt(b.pos.x, b.pos.z),
        )[0];
      if (!c) return;
      c.health = 1e6;
      w.player.pos.x = c.pos.x - 1.7;
      w.player.pos.z = c.pos.z - 1.7;
      // With the loop paused, updatePlayer never snaps him to the ground, and
      // the camera target ends up inside the hill.
      w.player.y = window.__EDEN__.terrain.groundY(w.player.pos.x, w.player.pos.z);
      w.player.heading = Math.atan2(c.pos.x - w.player.pos.x, c.pos.z - w.player.pos.z);
      window.__EDEN__.input.inputState.camYaw = w.player.heading - 0.75;
      window.__EDEN__.input.inputState.camPitch = -0.2;
      window.__EDEN__.input.inputState.camDist = 5.2;
      w.player.lastHurtAt = w.timeSec;
      w.player.strike = null;
      w.player.buffered = null;
      // Park the requested swing inside its active window and hold it there.
      w.player.strike = { kind, phase: 'windup', timer: 0.001, chain, hitIds: [] };
      combat.strikeTick(w, 0.002);
    },
    { kind, chain },
  );
  await page.waitForTimeout(2400);
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
  console.log('  ·', name);
}

// The Rakhor's tell, from the distance it has to read at.
await shot(
  'v09-rakhor-tell',
  `
  const c = w.creatures
    .filter((x) => x.speciesId === 'rakhor')
    .sort((a, b) => EDEN.terrain.slopeAt(a.pos.x, a.pos.z) - EDEN.terrain.slopeAt(b.pos.x, b.pos.z))[0];
  c.health = 90;
  c.combat.state = 'warn';
  c.combat.since = w.timeSec;
  w.player.lastHurtAt = w.timeSec;
  return { from: { x: c.pos.x - 12, z: c.pos.z - 12 }, at: c.pos };
  `,
  { dist: 7, pitch: -0.14, yawOffset: 0.4 },
);

// The same tell mid-commit, ring closing.
await shot(
  'v09-rakhor-windup',
  `
  const c = w.creatures
    .filter((x) => x.speciesId === 'rakhor')
    .sort((a, b) => EDEN.terrain.slopeAt(a.pos.x, a.pos.z) - EDEN.terrain.slopeAt(b.pos.x, b.pos.z))[0];
  c.combat.state = 'windup';
  c.combat.since = w.timeSec - 0.5;
  c.combat.aim = { x: 0, z: 1 };
  w.player.lastHurtAt = w.timeSec;
  return { from: { x: c.pos.x - 9, z: c.pos.z - 9 }, at: c.pos };
  `,
  { dist: 6.5, pitch: -0.12, yawOffset: -0.4 },
);

// A staggered creature — the reward for landing a sequence.
await shot(
  'v09-stagger',
  `
  const c = w.creatures
    .filter((x) => x.speciesId === 'rakhor')
    .sort((a, b) => EDEN.terrain.slopeAt(a.pos.x, a.pos.z) - EDEN.terrain.slopeAt(b.pos.x, b.pos.z))[0];
  c.combat.state = 'staggered';
  c.combat.since = w.timeSec;
  c.hitAt = w.timeSec;
  c.hitFrom = { x: 0, z: 1 };
  c.hitForce = 1;
  w.player.lastHurtAt = w.timeSec;
  return { from: { x: c.pos.x - 4, z: c.pos.z - 4 }, at: c.pos };
  `,
  { dist: 5.5, pitch: -0.16, yawOffset: -0.5 },
);

// The Warden's beam in flight.
await page.evaluate(() => {
  const { getWorld, species } = window.__EDEN__;
  const w = getWorld();
  const warden = w.creatures.find((c) => species.CREATURE_SPECIES_BY_ID[c.speciesId].synthetic);
  if (!warden) return;
  const spot = { x: warden.pos.x - 14, z: warden.pos.z - 4 };
  w.player.pos.x = spot.x;
  w.player.pos.z = spot.z;
  w.player.y = window.__EDEN__.terrain.groundY(spot.x, spot.z);
  const yaw = Math.atan2(warden.pos.x - spot.x, warden.pos.z - spot.z);
  w.player.heading = yaw;
  window.__EDEN__.input.inputState.camYaw = yaw - 0.55;
  window.__EDEN__.input.inputState.camPitch = -0.12;
  window.__EDEN__.input.inputState.camDist = 8;
  w.player.lastHurtAt = w.timeSec;
  w.player.y = window.__EDEN__.terrain.groundY(spot.x, spot.z);
  warden.combat.state = 'beam';
  warden.combat.since = w.timeSec;
  const a = Math.atan2(spot.x - warden.pos.x, spot.z - warden.pos.z);
  w.beams.push({
    id: 'tour', sourceId: warden.id, from: { ...warden.pos },
    dir: { x: Math.sin(a), z: Math.cos(a) },
    length: 20, firedAt: w.timeSec, endsAt: w.timeSec + 60,
    y: window.__EDEN__.terrain.groundY(warden.pos.x, warden.pos.z) + 2.7,
  });
});
await page.waitForTimeout(2800);
await page.screenshot({ path: `${SHOT_DIR}/v09-warden-beam.png` });
console.log('  · v09-warden-beam');

await page.evaluate(() => window.__EDEN__.useUI.getState().setPaused(false));

// 10. Creator Mode reading the fight.
await page.keyboard.press('Tab');
await page.waitForTimeout(900);
await page.evaluate(() => {
  const { getWorld, useUI, species } = window.__EDEN__;
  const w = getWorld();
  const c = w.creatures.find((x) => species.CREATURE_SPECIES_BY_ID[x.speciesId].dangerous);
  if (c) useUI.getState().select(c.id);
});
await page.waitForTimeout(2400);
await page.screenshot({ path: `${SHOT_DIR}/v08-creator-combat.png` });
console.log('  · v08-creator-combat');

await browser.close();
console.log('\nTOUR OK — screenshots in smoke-shots/');
