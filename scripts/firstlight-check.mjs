/**
 * FIRST LIGHT, played in a real browser.
 *
 * Walks the authored opening from waking in the wreckage to the moment the
 * distress signal becomes Kai's problem, taking a screenshot at each beat so
 * the sequence can be judged by eye and not only by assertion.
 *
 * Usage:
 *   npx vite preview --port 4173 &
 *   node scripts/firstlight-check.mjs [url]
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

const state = () =>
  page.evaluate(() => {
    const w = window.__EDEN__.getWorld();
    return {
      beat: w.firstLight.beat,
      met: w.firstLight.metSurvivors.length,
      tents: w.landmarksBuilt.filter((b) => b.kind === 'tent').length,
      fire: w.structures.filter((s) => s.type === 'campfire').length,
      fabricator: w.fabricatorPos,
      mission: w.mission ? w.mission.state : null,
      revealed: w.firstLight.revealedAt >= 0,
      posted: w.settlers.filter((s) => s.roleAnchor && s.roleAnchor.role === 'station').length,
      // What is actually in the scene, not what the simulation believes. The
      // landing site used to be built once at mount, so tents raised during the
      // opening existed in `landmarksBuilt` and nowhere the player could see.
      landmarks: w.landmarksBuilt.length,
      drawn: window.__EDEN__.landingSiteNodes(),
      litFires: window.__EDEN__.litHearths(),
    };
  });

const jump = (beat) =>
  page.evaluate((b) => {
    window.__EDEN__.firstLight.jumpToBeat(window.__EDEN__.getWorld(), b);
  }, beat);

/**
 * Look at the camp from a little way off, so the whole site is in frame.
 *
 * `dist` is how far Kai stands from the hearth and `back` how far the camera
 * trails him, so the wide shots have to clear the tent ring with both — stand
 * inside it and the nearest tent fills the lens and hides the fire, which is
 * exactly what the camp shots are meant to show.
 *
 * The approach is always from the far side of the hearth from the pod. Stand
 * anywhere else and the wreck — six metres wide and eight tall — is directly
 * between the camera and the fire. From here the camp is in front and the
 * wreck behind it, which is also the shot that tells the story.
 */
const viewCamp = (dist = 26, pitch = -0.16, back = 8) =>
  page.evaluate(
    ({ d, pi, bk }) => {
      const { getWorld, input, terrain } = window.__EDEN__;
      const w = getWorld();
      const camp = w.camps.find((c) => c.speciesId === 'human');
      const pod = w.landmarksBuilt.find((b) => b.kind === 'pod');
      const p = w.player;
      const ax = camp.pos.x - pod.pos.x;
      const az = camp.pos.z - pod.pos.z;
      const len = Math.hypot(ax, az) || 1;
      p.pos.x = camp.pos.x + (ax / len) * d;
      p.pos.z = camp.pos.z + (az / len) * d;
      p.y = terrain.groundY(p.pos.x, p.pos.z);
      const yaw = Math.atan2(camp.pos.x - p.pos.x, camp.pos.z - p.pos.z);
      p.heading = yaw;
      input.inputState.camYaw = yaw;
      input.inputState.camPitch = pi;
      input.inputState.camDist = bk;
    },
    { d: dist, pi: pitch, bk: back },
  );

try {
  console.log('\nFIRST LIGHT');

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);
  if (await page.locator('.help').isVisible().catch(() => false)) await page.locator('.help-resume').click();
  await page.waitForTimeout(1500);

  // --- 1. IMPACT ------------------------------------------------------------
  const impact = await state();
  check('a new game begins at impact', impact.beat === 'impact', impact.beat);
  check('there is no camp yet', impact.fire === 0 && impact.tents === 0, JSON.stringify(impact));
  check('the Fabricator is not operational', impact.fabricator === null, String(impact.fabricator));
  check('the distress mission is dormant', impact.mission === 'dormant', String(impact.mission));
  check('the survivors are posted to emergency jobs', impact.posted === 12, `${impact.posted}`);

  const wreck = await page.evaluate(() => {
    const w = window.__EDEN__.getWorld();
    const pod = w.landmarksBuilt.find((b) => b.kind === 'pod');
    return {
      debris: w.landmarksBuilt.filter((b) => b.kind === 'debris').length,
      toPod: pod ? Math.hypot(pod.pos.x - w.player.pos.x, pod.pos.z - w.player.pos.z) : -1,
    };
  });
  check('Kai wakes beside the wreck', wreck.toPod > 0 && wreck.toPod < 22, `${wreck.toPod.toFixed(1)}m`);
  check('there is scattered debris', wreck.debris >= 3, `${wreck.debris}`);
  const ari = await page.evaluate(() => window.__EDEN__.getWorld().ariQueue.join(' ~ '));
  check('ARI does not mention Maya yet', !/Maya/i.test(ari), ari.slice(0, 90));
  await viewCamp(17, -0.1, 9);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${SHOT_DIR}/g1-01-impact.png` });

  // --- 2. SURVIVORS AT WORK -------------------------------------------------
  const jobs = await page.evaluate(() => {
    const w = window.__EDEN__.getWorld();
    return w.settlers
      .filter((s) => s.speciesId === 'human')
      .map((s) => ({ name: s.name, doing: s.roleAnchor?.label ?? null }));
  });
  check('every survivor has an emergency job', jobs.every((j) => j.doing), JSON.stringify(jobs.slice(0, 3)));
  check('the jobs are different from one another', new Set(jobs.map((j) => j.doing)).size === 12);
  const named = Object.fromEntries(jobs.map((j) => [j.name, j.doing]));
  check('Mira is doing triage', /injured/i.test(named.Mira ?? ''), named.Mira);
  check('Kael is counting supplies', /inventor/i.test(named.Kael ?? ''), named.Kael);
  check('Petra is on the broken fabrication gear', /fabrication/i.test(named.Petra ?? ''), named.Petra);
  await viewCamp(14, -0.04, 8);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOT_DIR}/g1-02-survivors.png` });

  // --- 3. CAMP RISING -------------------------------------------------------
  await jump('campRising');
  await page.waitForTimeout(2500);
  const rising = await state();
  check('the hearth is lit when the camp starts going up', rising.fire === 1, JSON.stringify(rising));
  check('and it is actually burning on screen', rising.litFires === 1, `${rising.litFires} lit`);
  check('tents have started going up', rising.tents >= 1, `${rising.tents}`);
  check('but the camp is not finished yet', rising.tents < 6, `${rising.tents}`);
  check('the Fabricator is still offline', rising.fabricator === null);
  check('and the new tents are actually in the scene', rising.drawn === rising.landmarks,
    `${rising.drawn} drawn / ${rising.landmarks} landmarks`);
  // Let the camp get genuinely half-way up before photographing it — one tent
  // behind the pod does not show a camp forming. Run the valley faster and
  // poll, rather than winding the clock forward: a time jump also satisfies
  // campRising's own timeout, which finishes the camp and advances the beat,
  // and the shot would then be the evening camp under a campRising caption.
  await page.evaluate(() => window.__EDEN__.useUI.getState().setSpeed(20));
  let half = rising;
  for (let i = 0; i < 60 && half.tents < 3 && half.beat === 'campRising'; i++) {
    await page.waitForTimeout(1000);
    half = await state();
  }
  await page.evaluate(() => window.__EDEN__.useUI.getState().setSpeed(1));
  check('the camp goes up tent by tent', half.tents >= 3 && half.tents < 6,
    `${half.tents} tents at beat ${half.beat}`);
  check('and it is still the camp going up, not a finished one', half.beat === 'campRising', half.beat);
  await viewCamp(16, -0.5, 15);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${SHOT_DIR}/g1-03-camp-rising.png` });

  // --- 4. EVENING -----------------------------------------------------------
  await jump('evening');
  await page.waitForTimeout(2500);
  const evening = await state();
  check('the camp is finished by evening', evening.tents === 6, `${evening.tents} tents`);
  check('and all six of them are on screen', evening.drawn === evening.landmarks,
    `${evening.drawn} drawn / ${evening.landmarks} landmarks`);
  check('with a fire at the middle of it', evening.fire === 1);
  check('still burning', evening.litFires === 1, `${evening.litFires} lit`);
  check('and the survivors are handed back to the simulation', evening.posted === 0, `${evening.posted} still posted`);
  check('the distress mission is still dormant', evening.mission === 'dormant', String(evening.mission));
  await viewCamp(17, -0.55, 17);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOT_DIR}/g1-04-evening-camp.png` });

  // --- 5. HEADCOUNT ---------------------------------------------------------
  await jump('headcount');
  await page.waitForTimeout(2500);
  const head = await state();
  check('the headcount reveals someone is missing', head.revealed, JSON.stringify(head));
  const reveal = await page.evaluate(() => window.__EDEN__.getWorld().ariQueue.join(' ~ '));
  check('ARI names Maya', /Maya/.test(reveal), reveal.slice(0, 120));
  check('and says why it matters', /agricultur/i.test(reveal), reveal.slice(0, 200));
  const roster = await page.evaluate(() => {
    const w = window.__EDEN__.getWorld();
    return {
      humans: w.settlers.filter((s) => s.speciesId === 'human').length,
      maya: w.settlers.some((s) => s.name.includes('Maya')),
    };
  });
  check('twelve are at the camp', roster.humans === 12, `${roster.humans}`);
  check('and Maya is not one of them', !roster.maya);
  await viewCamp(15, -0.45, 14);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${SHOT_DIR}/g1-05-headcount.png` });

  // --- 6. THE SIGNAL BECOMES KAI'S PROBLEM ----------------------------------
  // The mission keeps its own opening grace after being unlocked — ARI does not
  // announce a carrier in the same breath as the headcount. Run the valley
  // faster and poll rather than guessing a wall-clock wait, since headless
  // software rendering only manages a frame or two a second.
  // Headless software rendering drains roughly half a sim-second per real
  // second whatever the speed multiplier says — the per-frame tick budget is
  // the binding constraint — so the mission's 25-second grace takes the better
  // part of a minute here. Poll for it rather than guessing.
  await page.evaluate(() => window.__EDEN__.useUI.getState().setSpeed(20));
  let active = await state();
  for (let i = 0; i < 90 && active.mission === 'dormant'; i++) {
    await page.waitForTimeout(1000);
    active = await state();
  }
  await page.evaluate(() => window.__EDEN__.useUI.getState().setSpeed(1));
  await page.waitForTimeout(800);
  check('the distress mission activates', active.mission !== 'dormant', String(active.mission));
  const objective = await page.locator('.objective').innerText().catch(() => '');
  check('an objective appears', /DISTRESS SIGNAL/i.test(objective), objective.slice(0, 70));
  check('with a signal strength read-out', /Signal strength/i.test(objective), objective);
  const nav = await page.evaluate(() => {
    const { getWorld, config, terrain } = window.__EDEN__;
    const w = getWorld();
    const camp = w.camps.find((c) => c.speciesId === 'human');
    const pod = w.mission.podPos;
    let walkable = true;
    for (let i = 0; i <= 90; i++) {
      const t = i / 90;
      const x = camp.pos.x + (pod.x - camp.pos.x) * t;
      const z = camp.pos.z + (pod.z - camp.pos.z) * t;
      if (!terrain.isWalkable(x, z)) walkable = false;
    }
    return {
      walkable,
      podR: Math.hypot(pod.x, pod.z),
      rim: config.WORLD.rimStart,
      walk: Math.hypot(pod.x - camp.pos.x, pod.z - camp.pos.z),
    };
  });
  check('the wreck is still somewhere Kai can walk', nav.walkable && nav.podR < nav.rim - 10,
    JSON.stringify(nav));
  check('and still a real walk away', nav.walk > 90, `${nav.walk.toFixed(0)}m`);
  await viewCamp(20, -0.08, 10);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${SHOT_DIR}/g1-06-objective.png` });

  // --- Developer controls ---------------------------------------------------
  await page.locator('.dev-badge').click();
  await page.waitForTimeout(900);
  const panel = await page.locator('.dev-panel').innerText();
  check('Developer Controls shows the beat', /first light/i.test(panel), panel.slice(0, 80));
  check('and offers beat jumps', (await page.locator('.dev-beat').count()) >= 5,
    `${await page.locator('.dev-beat').count()}`);
  await page.locator('.dev-beat', { hasText: 'Restart' }).click();
  await page.waitForTimeout(2500);
  const restarted = await state();
  check('Restart puts the opening back to the beginning', restarted.beat === 'impact', restarted.beat);
  check('and takes the camp back down', restarted.tents === 0 && restarted.fire === 0, JSON.stringify(restarted));
  check('and the tents leave the scene with it', restarted.drawn === restarted.landmarks,
    `${restarted.drawn} drawn / ${restarted.landmarks} landmarks`);
  check('and the mission with it', restarted.mission === 'dormant' && !restarted.revealed, JSON.stringify(restarted));
  check('and posts everyone again', restarted.posted === 12, `${restarted.posted}`);

  console.log(`\nBROWSER ERRORS: ${errors.length}`);
  for (const e of errors.slice(0, 5)) console.log('  ' + e);
} finally {
  await browser.close();
}

console.log(
  `\n${failures.length === 0 && errors.length === 0 ? 'FIRST LIGHT CHECKS PASSED' : `FAILED — ${failures.length} check(s), ${errors.length} error(s)`}`,
);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length === 0 && errors.length === 0 ? 0 : 1);
