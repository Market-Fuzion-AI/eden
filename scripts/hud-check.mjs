/**
 * The player HUD, in a real browser.
 *
 * The complaint this pass answers was that normal exploration looked like a
 * debug read-out: eleven stacked abbreviations, unexplained numbers, and an
 * identification card that could not tell you which of four settlers it meant.
 * So the checks here are mostly about what the player can and cannot see.
 *
 * Usage:
 *   npx vite preview --port 4173 &
 *   node scripts/hud-check.mjs [url]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const TARGET_URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const SHOT_DIR = new URL('../smoke-shots', import.meta.url).pathname;
mkdirSync(SHOT_DIR, { recursive: true });
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
page.on('console', (msg) => msg.type() === 'error' && errors.push('console: ' + msg.text()));
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
await page.addInitScript((seed) => window.localStorage.setItem('eden.seed', String(seed)), SEED);

const noon = () =>
  page.evaluate(() => {
    const { getWorld, config } = window.__EDEN__;
    const w = getWorld();
    const day = Math.floor(w.timeSec / config.DAY_SEC);
    w.timeSec = day * config.DAY_SEC + config.DAY_SEC * 0.5;
  });

/** Put Kai in the open near Human Landing, looking at the settlers. */
const standAtCamp = (dist = 11) =>
  page.evaluate((d) => {
    const { getWorld, input, terrain } = window.__EDEN__;
    const w = getWorld();
    const camp = w.camps.find((c) => c.speciesId === 'human');
    const pl = w.player;
    pl.pos.x = camp.pos.x + d;
    pl.pos.z = camp.pos.z + d;
    pl.y = terrain.groundY(pl.pos.x, pl.pos.z);
    const yaw = Math.atan2(camp.pos.x - pl.pos.x, camp.pos.z - pl.pos.z);
    pl.heading = yaw;
    input.inputState.camYaw = yaw;
    input.inputState.camPitch = -0.05;
    input.inputState.camDist = 7;
  }, dist);

try {
  console.log('\nPLAYER HUD');

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);
  if (await page.locator('.help').isVisible().catch(() => false)) await page.locator('.help-resume').click();
  await page.waitForTimeout(1200);
  await noon();
  await standAtCamp();
  await page.waitForTimeout(2200);

  // --- C. Health and stamina, in words a player knows ----------------------
  const status = await page.locator('.status-card').innerText();
  check('the status card names Kai', /KAI/.test(status), status.slice(0, 40));
  check('it says Health, not VIT', /Health/i.test(status) && !/\bVIT\b/.test(status), status);
  check('it says Stamina, not STA', /Stamina/i.test(status) && !/\bSTA\b/.test(status), status);
  check('health and stamina are both real bars', (await page.locator('.status-card .gauge-fill').count()) >= 2);
  check('the status card sits top-left', await page.locator('.hud-topleft .status-card').isVisible());

  // --- 1. The telemetry is gone from normal play ---------------------------
  const hud = await page.locator('.hud').innerText();
  for (const gone of ['Glowberries', 'Core Fragment', 'Wood ×', 'Stone ×', 'Disposition']) {
    check(`"${gone}" is no longer on the HUD`, !hud.includes(gone), hud.slice(0, 120));
  }
  check('the identification card is gone from normal play', (await page.locator('.ident-card').count()) === 0);
  check('no raw material counters are shown', (await page.locator('.hud > * .mat-chip').count()) === 0);

  // --- D. Weapons ----------------------------------------------------------
  const slots = await page.locator('.slot').count();
  check('both weapon slots are shown', slots === 2, `${slots}`);
  const activeName = await page.locator('.slot.active').innerText();
  check('exactly one is active', (await page.locator('.slot.active').count()) === 1);
  check('the active slot names the weapon', /Arc Blade|Pulse Blaster/.test(activeName), activeName);
  check('each slot carries an icon', (await page.locator('.slot .slot-glyph').count()) === 2);
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(500);
  const afterSwitch = await page.locator('.slot.active').innerText();
  check('pressing 2 moves the highlight', afterSwitch !== activeName, `${activeName} → ${afterSwitch}`);
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(400);

  // --- A/B. World-space identification -------------------------------------
  const plates = await page.evaluate(() => {
    const { getWorld } = window.__EDEN__;
    const w = getWorld();
    const p = w.player;
    return w.settlers
      .filter((s) => s.speciesId === 'human')
      .map((s) => ({ name: s.name, d: Math.hypot(s.pos.x - p.pos.x, s.pos.z - p.pos.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 5);
  });
  check('several settlers are close enough to need telling apart', plates.filter((x) => x.d < 34).length >= 2,
    JSON.stringify(plates.map((x) => `${x.name}@${x.d.toFixed(0)}m`)));
  const roles = await page.evaluate(() => {
    const { getWorld, npcContext } = window.__EDEN__;
    return getWorld()
      .settlers.filter((s) => s.speciesId === 'human')
      .map((s) => npcContext.settlerRole(s));
  });
  check('every settler has a role to put on a label', roles.every((r) => r && r.length > 3), JSON.stringify(roles));
  check('roles are not all the same', new Set(roles).size === 12, `${new Set(roles).size}`);
  await page.screenshot({ path: `${SHOT_DIR}/f1-01-hud-day.png` });

  // --- E. Scan -------------------------------------------------------------
  const scanChip = await page.locator('.scan-chip').innerText().catch(() => '');
  check('the scanner prompt is in plain language', /Scan surroundings/i.test(scanChip), scanChip);
  check('it no longer says SPEND CELL', !/SPEND CELL/i.test(scanChip), scanChip);
  const beforeScan = await page.evaluate(() => window.__EDEN__.getWorld().player.scan.nodeIds.length);
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(1200);
  const scanned = await page.evaluate(() => {
    const w = window.__EDEN__.getWorld();
    // ARI's mission lines splice to the front of the queue, so the scan report
    // is somewhere in it rather than reliably first.
    return { lit: w.player.scan.nodeIds.length, ari: w.ariQueue.join(' ~ '), cd: w.player.scan.lastAt > 0 };
  });
  check('Q actually performs a scan', scanned.cd, JSON.stringify(scanned).slice(0, 100));
  check('and ARI reports what it found', /signature|metres|No usable/i.test(scanned.ari), scanned.ari.slice(0, 120));
  check('the scan lit something or honestly said it did not', scanned.lit >= beforeScan);

  // While cooling, a cell buys an immediate long-range sweep — so the chip
  // offers that. With no cells it has to say plainly that it is recharging.
  await page.waitForTimeout(600);
  const withCell = await page.locator('.scan-chip').innerText().catch(() => '');
  check('holding a cell, the chip offers the long-range option',
    /Energy Cell/i.test(withCell), withCell);
  await page.evaluate(() => {
    window.__EDEN__.getWorld().player.items.energyCell = 0;
  });
  await page.waitForTimeout(700);
  const cooling = await page.locator('.scan-chip').innerText().catch(() => '');
  check('with no cell, it says the scanner is recharging', /recharging/i.test(cooling), cooling);
  await page.evaluate(() => {
    window.__EDEN__.getWorld().player.items.energyCell = 10;
  });

  // --- F. Objective --------------------------------------------------------
  const objective = await page.locator('.objective').innerText().catch(() => '');
  check('the objective says what it is', /DISTRESS SIGNAL/i.test(objective), objective.slice(0, 60));
  check('CARRIER is gone', !/CARRIER/i.test(objective), objective);
  check('the meter says what it measures', /Signal strength/i.test(objective), objective);
  check('and puts the reading in words', /Barely audible|Faint|Closing|Very close/i.test(objective), objective);

  // --- G. Minimap ----------------------------------------------------------
  check('the minimap is on screen', await page.locator('.minimap').isVisible());
  check('it names where Kai is', (await page.locator('.minimap-place').innerText()).length > 2);
  const mmBox = await page.locator('.minimap').boundingBox();
  check('it sits bottom-right', mmBox.x > 1440 * 0.7 && mmBox.y > 810 * 0.6, JSON.stringify(mmBox));
  check('it is modest in size', mmBox.width < 220 && mmBox.height < 260, JSON.stringify(mmBox));

  // The map must actually follow Kai: move him and confirm the drawn arrow moves.
  const pixAt = () =>
    page.evaluate(() => {
      const c = document.querySelector('.minimap-canvas');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      // Find the brightest cyan pixel — Kai's arrow.
      let best = -1, bx = 0, by = 0;
      for (let i = 0; i < d.length; i += 4) {
        const score = d[i + 2] + d[i + 1] - d[i] * 2;
        if (score > best) { best = score; const px = (i / 4) % c.width; bx = px; by = Math.floor(i / 4 / c.width); }
      }
      return { bx, by };
    });
  const before = await pixAt();
  await page.evaluate(() => {
    const { getWorld, terrain } = window.__EDEN__;
    const p = getWorld().player;
    p.pos.x -= 55;
    p.pos.z -= 35;
    p.y = terrain.groundY(p.pos.x, p.pos.z);
  });
  await page.waitForTimeout(900);
  const after = await pixAt();
  check('Kai moves on the minimap when he moves in the world',
    Math.hypot(after.bx - before.bx, after.by - before.by) > 8, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

  // --- 6. The objective is reachable ---------------------------------------
  const nav = await page.evaluate(() => {
    const { getWorld, config, terrain } = window.__EDEN__;
    const w = getWorld();
    const camp = w.camps.find((c) => c.speciesId === 'human');
    const pod = w.mission.podPos;
    let walkable = true;
    let maxR = 0;
    const steps = 90;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = camp.pos.x + (pod.x - camp.pos.x) * t;
      const z = camp.pos.z + (pod.z - camp.pos.z) * t;
      maxR = Math.max(maxR, Math.hypot(x, z));
      if (!terrain.isWalkable(x, z)) walkable = false;
    }
    return {
      walkable,
      maxR,
      podR: Math.hypot(pod.x, pod.z),
      rimStart: config.WORLD.rimStart,
      limit: config.WORLD.playRadius - 6,
      walk: Math.hypot(pod.x - camp.pos.x, pod.z - camp.pos.z),
    };
  });
  check('the wreck sits clear of the mountain rim', nav.podR < nav.rimStart - 10,
    `pod r=${nav.podR.toFixed(0)}, rim starts ${nav.rimStart}`);
  check('the whole route stays inside the valley', nav.maxR < nav.rimStart, `max r=${nav.maxR.toFixed(0)}`);
  check('the route is walkable end to end', nav.walkable);
  check('and it is still a real walk', nav.walk > 90, `${nav.walk.toFixed(0)}m`);

  // --- H/I. Readability, bright and dark -----------------------------------
  await standAtCamp();
  await noon();
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${SHOT_DIR}/f1-02-hud-noon.png` });
  await page.evaluate(() => {
    const { getWorld, config } = window.__EDEN__;
    const w = getWorld();
    const day = Math.floor(w.timeSec / config.DAY_SEC);
    w.timeSec = day * config.DAY_SEC + config.DAY_SEC * 0.92;
  });
  await page.waitForTimeout(1600);
  check('the HUD survives nightfall', await page.locator('.status-card').isVisible());
  await page.screenshot({ path: `${SHOT_DIR}/f1-03-hud-night.png` });
  await noon();

  // --- J. Conversation still works with the new HUD ------------------------
  await page.evaluate(() => {
    const { getWorld, input, terrain } = window.__EDEN__;
    const w = getWorld();
    const s = w.settlers.find((x) => x.speciesId === 'human' && !x.resting);
    const p = w.player;
    p.pos.x = s.pos.x + 1.6;
    p.pos.z = s.pos.z + 1.6;
    p.y = terrain.groundY(p.pos.x, p.pos.z);
    const yaw = Math.atan2(s.pos.x - p.pos.x, s.pos.z - p.pos.z);
    p.heading = yaw;
    input.inputState.camYaw = yaw - 0.4;
    input.inputState.camDist = 6;
  });
  await page.waitForTimeout(1500);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(1400);
  check('a conversation still opens', await page.locator('.convo').isVisible().catch(() => false));
  check('the minimap gets out of the way for it', !(await page.locator('.minimap').isVisible().catch(() => false)));
  await page.screenshot({ path: `${SHOT_DIR}/f1-04-hud-conversation.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  check('and the minimap comes back', await page.locator('.minimap').isVisible().catch(() => false));

  // --- L/K. Developer and Creator Mode -------------------------------------
  await page.locator('.dev-badge').click();
  await page.waitForTimeout(900);
  const devPanel = await page.locator('.dev-panel').innerText();
  check('Developer Controls still opens', devPanel.length > 40);
  // innerText comes back CSS-uppercased, so match without case.
  check('and it is where the raw counts went now', /carried/i.test(devPanel), devPanel.slice(0, 80));
  check('the carried materials are actually listed',
    (await page.locator('.dev-panel .dev-mat').count()) > 0);
  await page.locator('.dev-panel .close-btn').click();
  await page.waitForTimeout(400);

  await page.keyboard.press('Tab');
  await page.waitForTimeout(1400);
  const creator = await page.evaluate(() => window.__EDEN__.useUI.getState().mode);
  check('Creator Mode still opens', creator === 'creator', creator);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1000);
  check('and Live Mode comes back', (await page.evaluate(() => window.__EDEN__.useUI.getState().mode)) === 'live');
  check('with the HUD intact', await page.locator('.status-card').isVisible());

  // --- 12. Landscape scaling ------------------------------------------------
  await page.setViewportSize({ width: 900, height: 506 });
  await page.waitForTimeout(1200);
  const small = await page.locator('.status-card').boundingBox();
  const mmSmall = await page.locator('.minimap').boundingBox();
  check('the HUD still fits a small landscape screen',
    small.x + small.width < 900 && mmSmall.x + mmSmall.width <= 900 && mmSmall.y + mmSmall.height <= 506,
    JSON.stringify({ small, mmSmall }));
  check('and the world is still most of the screen',
    (small.width * small.height + mmSmall.width * mmSmall.height) / (900 * 506) < 0.16);
  await page.screenshot({ path: `${SHOT_DIR}/f1-05-hud-small.png` });
  await page.setViewportSize({ width: 1440, height: 810 });

  console.log(`\nBROWSER ERRORS: ${errors.length}`);
  for (const e of errors.slice(0, 5)) console.log('  ' + e);
} finally {
  await browser.close();
}

console.log(
  `\n${failures.length === 0 && errors.length === 0 ? 'HUD CHECKS PASSED' : `FAILED — ${failures.length} check(s), ${errors.length} error(s)`}`,
);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length === 0 && errors.length === 0 ? 0 : 1);
