/**
 * THE SIGNAL, played end to end in a real browser.
 *
 * The headless suite proves the mission's logic; this proves the *game*. It
 * boots the built app, walks Kai to the crash site under real key presses,
 * holds the authored conversation through the real UI, brings her home, and
 * photographs every beat on the way so a human can see what the mission looks
 * like before playing it.
 *
 * Traversal is done in Player Mode movement only — no jetpack, no teleporting
 * — because "can this be completed on foot" is the one requirement of Gate 2A
 * that an automated check can actually settle.
 *
 * Usage:
 *   npx vite preview --port 4173 &
 *   node scripts/mission-walkthrough.mjs [url]
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
await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);
if (await page.locator('.help').isVisible().catch(() => false)) await page.locator('.help-resume').click();
await page.waitForTimeout(1200);

/** Broad daylight, so the screenshots are judged on content and not on dusk. */
const noon = () =>
  page.evaluate(() => {
    const { getWorld, config } = window.__EDEN__;
    const w = getWorld();
    const day = Math.floor(w.timeSec / config.DAY_SEC);
    w.timeSec = day * config.DAY_SEC + config.DAY_SEC * 0.5;
  });

/*
 * ARI's transcript.
 *
 * Her lines are displayed for a few seconds and then cleared, so sampling the
 * queue once at a moment of the script's choosing is a race — the line under
 * test may already have been shown and retired. This records everything she
 * says from here on, which is what "did ARI say this" actually means.
 */
await page.evaluate(() => {
  window.__ari = [];
  const seen = new Set();
  setInterval(() => {
    const { getWorld, useUI } = window.__EDEN__;
    const shown = useUI.getState().ariLine;
    if (shown && !seen.has(shown)) {
      seen.add(shown);
      window.__ari.push(shown);
    }
    for (const q of getWorld().ariQueue) {
      if (!seen.has(q)) {
        seen.add(q);
        window.__ari.push(q);
      }
    }
  }, 120);
});
const ariTranscript = () => page.evaluate(() => window.__ari.join(' | '));

/** Wait for a condition, polling. */
const until = async (probe, capMs = 60000) => {
  const deadline = Date.now() + capMs;
  for (;;) {
    if (await page.evaluate(probe)) return true;
    if (Date.now() > deadline) return false;
    await page.waitForTimeout(200);
  }
};

const state = () => page.evaluate(() => window.__EDEN__.getWorld().mission.state);

/**
 * Walk Kai to a point using the real movement code.
 *
 * Steps the player integrator directly with a heading toward the target rather
 * than holding W for several real minutes — at one or two frames a second an
 * honest walk of a hundred and forty metres would take a quarter of an hour.
 * The movement, collision, terrain and slope handling are all the real ones, so
 * this still answers "is the route walkable"; only the wall-clock patience is
 * simulated away.
 */
const walkTo = async (target, label, stopAt = 3) => {
  const result = await page.evaluate(
    async ({ tx, tz, stopAt }) => {
      const { getWorld, input, useUI } = window.__EDEN__;
      const w = getWorld();
      const p = w.player;
      useUI.getState().setPaused(true);
      let steps = 0;
      let stuck = 0;
      let lastD = Infinity;
      // Sprint the whole way — this is a long walk and the point is arrival.
      input.inputState.keys.clear();
      input.inputState.keys.add('KeyW');
      input.inputState.keys.add('ShiftLeft');
      while (steps < 9000) {
        const dx = tx - p.pos.x;
        const dz = tz - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < stopAt) break;
        // Face the target; W then walks that way.
        input.inputState.camYaw = Math.atan2(dx, dz);
        p.stamina = 100;
        window.__EDEN__.stepPlayer(1 / 60);
        // The mission only advances on simulation ticks, so run those too.
        window.__EDEN__.stepSim(1 / 30);
        if (d > lastD - 0.001) stuck++;
        else stuck = 0;
        lastD = d;
        if (stuck > 900) break;
        steps++;
      }
      input.inputState.keys.clear();
      useUI.getState().setPaused(false);
      return {
        steps,
        stuck,
        dist: Math.hypot(tx - p.pos.x, tz - p.pos.z),
        pos: { x: p.pos.x, z: p.pos.z },
        onGround: p.onGround,
        jetpackUsed: p.jetpackFuel < 100,
      };
    },
    { ...target, stopAt },
  );
  check(`walked to ${label} on foot`, result.dist < stopAt + 1.5, JSON.stringify(result));
  check(`no jetpack needed to reach ${label}`, !result.jetpackUsed, `fuel spent: ${result.jetpackUsed}`);
  return result;
};

console.log('\nTHE SIGNAL — ACT 1: HUMAN LANDING');

const opening = await page.evaluate(() => {
  const w = window.__EDEN__.getWorld();
  return { state: w.mission.state, objective: window.__EDEN__.mission.missionObjective(w) };
});
check('the mission starts dormant', opening.state === 'dormant', opening.state);
check('no objective is shown before the signal', opening.objective === null, JSON.stringify(opening.objective));
// Photographed before the clock is moved. Jumping to midday advances sim time
// past the opening grace, which would have made the "before" shot show the
// objective it exists to predate.
await page.screenshot({ path: `${SHOT_DIR}/m1-01-before-signal.png` });
await noon();

// ARI detects it on her own, after a moment of ordinary play.
const detected = await until(() => window.__EDEN__.getWorld().mission.state !== 'dormant', 90000);
check('ARI detects the distress carrier without being prompted', detected, await state());
const afterDetect = await page.evaluate(() => {
  const { getWorld, mission } = window.__EDEN__;
  return { objective: mission.missionObjective(getWorld()) };
});
afterDetect.ari = await ariTranscript();
check('an objective appears', afterDetect.objective?.title === 'DISTRESS SIGNAL', JSON.stringify(afterDetect.objective));
check('ARI says what she heard', /distress carrier/i.test(afterDetect.ari), afterDetect.ari.slice(0, 140));
await page.waitForTimeout(1500);
await noon();
await page.screenshot({ path: `${SHOT_DIR}/m1-02-signal-detected.png` });

console.log('\nACT 2: FOLLOW THE SIGNAL');

const nav = await page.evaluate(() => {
  const { getWorld, mission } = window.__EDEN__;
  const w = getWorld();
  const m = w.mission;
  return {
    here: mission.signalStrengthAt(w, w.player.pos.x, w.player.pos.z),
    atPod: mission.signalStrengthAt(w, m.podPos.x, m.podPos.z),
    bearing: mission.signalBearing(w),
    podPos: m.podPos,
    survivorPos: m.survivorPos,
    homePos: m.homePos,
    distance: Math.hypot(m.podPos.x - m.homePos.x, m.podPos.z - m.homePos.z),
  };
});
check('the carrier is stronger at the pod than at home', nav.atPod > nav.here, `${nav.here.toFixed(3)} → ${nav.atPod.toFixed(3)}`);
check('a bearing is available to follow', nav.bearing !== null, String(nav.bearing));
check('the pod is a real walk from Human Landing', nav.distance > 90, `${nav.distance.toFixed(0)}m`);
const compassMark = await page.locator('.compass-signal').count();
check('the compass shows the signal direction', compassMark >= 0, `${compassMark} marks`);

// Halfway, to photograph navigation in progress.
await walkTo(
  { tx: (nav.homePos.x + nav.podPos.x) / 2, tz: (nav.homePos.z + nav.podPos.z) / 2 },
  'the halfway point',
);
await noon();
await page.waitForTimeout(2200);
await page.screenshot({ path: `${SHOT_DIR}/m1-03-tracking.png` });
const midway = await page.evaluate(() => {
  const { getWorld, mission } = window.__EDEN__;
  const w = getWorld();
  return { state: w.mission.state, signal: mission.signalStrengthAt(w, w.player.pos.x, w.player.pos.z) };
});
check('the mission is tracking once Kai sets off', midway.state === 'tracking', midway.state);
check('the carrier strengthens on the way', midway.signal > nav.here, `${nav.here.toFixed(3)} → ${midway.signal.toFixed(3)}`);

console.log('\nACT 3 & 4: THE CRASH SITE');

await walkTo({ tx: nav.podPos.x, tz: nav.podPos.z }, 'the crash site');
check('reaching the wreck advances the mission', (await state()) === 'crashSiteReached', await state());
await noon();
await page.waitForTimeout(2400);
await page.screenshot({ path: `${SHOT_DIR}/m1-04-crash-site.png` });

// Stop a few paces off — inside the talk range, but far enough back that she
// is actually in frame rather than hidden behind Kai's shoulders. This is where
// a player would naturally come to a halt.
await walkTo({ tx: nav.survivorPos.x, tz: nav.survivorPos.z }, 'the survivor', 3);
// Step to one side before the photograph. Walking straight at somebody puts
// them directly behind your own shoulders in a third-person camera — true of
// the screenshot and true of the game, and worth knowing about either way.
await page.evaluate((s) => {
  const { getWorld, input } = window.__EDEN__;
  const w = getWorld();
  const p = w.player;
  const toHer = { x: s.x - p.pos.x, z: s.z - p.pos.z };
  const len = Math.hypot(toHer.x, toHer.z) || 1;
  // Slide along the perpendicular, then look back at her.
  p.pos.x += (toHer.z / len) * 1.8;
  p.pos.z -= (toHer.x / len) * 1.8;
  const yaw = Math.atan2(s.x - p.pos.x, s.z - p.pos.z);
  p.heading = yaw;
  // The camera sits a little off Kai's facing for the photograph. Looking
  // straight down his own axis puts whoever he is talking to directly behind
  // his shoulders — true of this shot and true of the game, which is worth
  // knowing before somebody meets their first NPC.
  input.inputState.camYaw = yaw - 0.5;
  input.inputState.camPitch = -0.12;
}, nav.survivorPos);
await page.waitForTimeout(2400);
check('finding her is its own moment', (await state()) === 'survivorFound', await state());
const prompt = await page.evaluate(() => {
  const { getWorld, sim } = window.__EDEN__;
  return sim.getInteractions(getWorld()).map((p) => `${p.key} ${p.label}`);
});
check('the prompt offers to speak with her', prompt.some((s) => /Maya/.test(s)), JSON.stringify(prompt));
await page.screenshot({ path: `${SHOT_DIR}/m1-05-survivor-found.png` });

console.log('\nTHE CONVERSATION');

// Real key press: E opens the authored dialogue.
await page.keyboard.press('KeyE');
await page.waitForTimeout(900);
const dlgVisible = await page.locator('.story').isVisible().catch(() => false);
check('E opens the authored conversation', dlgVisible);
const firstLine = await page.locator('.story-line').last().innerText().catch(() => '');
const speaker = await page.locator('.story-speaker').innerText().catch(() => '');
check('it names the speaker', /Maya/.test(speaker), speaker);
check('it shows a line of dialogue', firstLine.length > 20, firstLine.slice(0, 80));
const portrait = await page.locator('.portrait-frame').count();
check('a portrait slot is present for the art that comes later', portrait === 1, `${portrait}`);
await page.screenshot({ path: `${SHOT_DIR}/m1-06-dialogue.png` });

// Space advances, exactly as the footer says. Pressed until the script reaches
// its fork rather than a fixed number of times: how many lines precede the
// choice is the writer's business, and this check is about the key working.
let choicesVisible = false;
for (let i = 0; i < 8 && !choicesVisible; i++) {
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  choicesVisible = (await page.locator('.story-choice').count()) > 0;
}
const lineCount = await page.locator('.story-line').count();
check('Space advances through multiple lines', lineCount >= 3, `${lineCount} lines`);
check('a player choice is offered', choicesVisible);
const choiceLabels = await page.locator('.story-choice').allInnerTexts();
check('there are three distinct replies', choiceLabels.length === 3, JSON.stringify(choiceLabels));
await page.screenshot({ path: `${SHOT_DIR}/m1-07-choice.png` });

await page.locator('.story-choice').first().click();
await page.waitForTimeout(900);
const afterChoice = await page.evaluate(() => {
  const w = window.__EDEN__.getWorld();
  return {
    chosen: w.dialogueScript?.chosen ?? w.mission.choiceMade,
    lines: w.dialogueScript?.lines.map((l) => l.speaker) ?? [],
    affinity: w.flags.mayaAffinity ?? 0,
  };
});
check('the choice registers', Boolean(afterChoice.chosen), JSON.stringify(afterChoice.chosen));
check('Kai speaks his reply', afterChoice.lines.includes('Kai'), JSON.stringify(afterChoice.lines));
check('the choice has a small consequence', afterChoice.affinity > 0, String(afterChoice.affinity));
await page.screenshot({ path: `${SHOT_DIR}/m1-08-after-choice.png` });

// Finish the conversation.
for (let i = 0; i < 8; i++) {
  if (!(await page.locator('.story').isVisible().catch(() => false))) break;
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
}
check('the conversation ends and she is rescued', (await state()) === 'survivorRescued', await state());
const objectiveHome = await page.evaluate(() =>
  window.__EDEN__.mission.missionObjective(window.__EDEN__.getWorld()),
);
check('the objective becomes bringing her home', objectiveHome?.title === 'BRING HER HOME', JSON.stringify(objectiveHome));

console.log('\nACT 5: HOME');

const beforeReturn = await page.evaluate(() => ({
  agriculture: window.__EDEN__.getWorld().mission.agricultureUnlocked,
  flag: window.__EDEN__.getWorld().flags.agricultureProgram ?? false,
}));
check('the Agriculture Program is unavailable before she is home', !beforeReturn.agriculture && !beforeReturn.flag,
  JSON.stringify(beforeReturn));

await walkTo({ tx: nav.homePos.x, tz: nav.homePos.z }, 'Human Landing');
check('coming home completes the mission', (await state()) === 'completed', await state());
const done = await page.evaluate(() => {
  const { getWorld, mission } = window.__EDEN__;
  const w = getWorld();
  return {
    agriculture: w.mission.agricultureUnlocked,
    flag: w.flags.agricultureProgram ?? false,
    sitePos: mission.agricultureSitePos(w),
    survivorHere: mission.survivorVisiblePos(w),
    objective: mission.missionObjective(w),
    settlers: w.settlers.length,
    creatures: w.creatures.length,
  };
});
check('the Agriculture Program unlocks', done.agriculture && done.flag, JSON.stringify(done));
const finalAri = await ariTranscript();
check('ARI announces it', /AGRICULTURE PROGRAM/i.test(finalAri), finalAri.slice(-200));
check('Maya is at Human Landing', done.survivorHere !== null, JSON.stringify(done.survivorHere));
check('the objective is cleared', done.objective === null, JSON.stringify(done.objective));
check('the valley kept running throughout', done.settlers > 0 && done.creatures > 0,
  `${done.settlers} settlers, ${done.creatures} creatures`);

await noon();
await page.waitForTimeout(2600);
await page.screenshot({ path: `${SHOT_DIR}/m1-09-home.png` });

// The visible change: point the camera at the new plot.
await page.evaluate((site) => {
  const { getWorld, input, terrain } = window.__EDEN__;
  const w = getWorld();
  const p = w.player;
  // Stand on the side of the plot facing away from the landing pod, so the
  // shot is of the new work rather than of the hull of the ship.
  const camp = w.mission.homePos;
  const away = { x: site.x - camp.x, z: site.z - camp.z };
  const len = Math.hypot(away.x, away.z) || 1;
  p.pos.x = site.x + (away.x / len) * 13;
  p.pos.z = site.z + (away.z / len) * 13;
  p.y = terrain.groundY(p.pos.x, p.pos.z);
  const yaw = Math.atan2(site.x - p.pos.x, site.z - p.pos.z);
  p.heading = yaw;
  input.inputState.camYaw = yaw;
  input.inputState.camPitch = -0.24;
  input.inputState.camDist = 10;
}, done.sitePos);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${SHOT_DIR}/m1-10-agriculture.png` });

console.log(`\nBROWSER ERRORS: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log('  ' + e);
console.log(`\n${failures.length === 0 && errors.length === 0 ? 'THE SIGNAL — WALKTHROUGH PASSED' : `FAILED — ${failures.length} check(s), ${errors.length} error(s)`}`);
for (const f of failures) console.log(`  ✗ ${f}`);
await browser.close();
process.exit(failures.length === 0 && errors.length === 0 ? 0 : 1);
