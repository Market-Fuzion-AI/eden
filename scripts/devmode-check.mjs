/**
 * Developer Mode / jetpack / blaster checks, on their own.
 *
 * The same assertions the full smoke run makes about this ticket's systems,
 * extracted so they can be re-run in a couple of minutes instead of twenty-five.
 * The full script remains the authority.
 *
 * Usage:
 *   npx vite preview --port 4173 &
 *   node scripts/devmode-check.mjs [url]
 */
import { chromium } from 'playwright-core';

const TARGET_URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const SEED = Number(process.env.EDEN_SEED ?? 31337);
const SHOT_DIR = new URL('../smoke-shots', import.meta.url).pathname;

const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  \u2713 ${name}`);
  else {
    console.log(`  \u2717 ${name} ${detail}`);
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

const awaitPlayerSeconds = async (seconds, capMs = 45000) => {
  const start = await page.evaluate(() => window.__EDEN__.getWorld().player.clock);
  const deadline = Date.now() + capMs;
  for (;;) {
    await page.waitForTimeout(250);
    const now = await page.evaluate(() => window.__EDEN__.getWorld().player.clock);
    if (now - start >= seconds || Date.now() > deadline) return now - start;
  }
};

console.log('\nDEVELOPER MODE + QA LOADOUT');
// ---------------------------------------------------------------------------
/*
 * The browser boots with whatever `sim/dev.ts` says, so these check the mode
 * the tester will actually be in rather than forcing one. The Player Mode half
 * of the guarantee is proved in the headless suite, where a world can be built
 * without the grant at all.
 */
const loadout = await page.evaluate(() => {
  const { getWorld, dev, fabrication } = window.__EDEN__;
  const w = getWorld();
  const p = w.player;
  return {
    devMode: dev.devMode(),
    materials: fabrication.MATERIAL_IDS.map((id) => p.materials[id]),
    salvage: fabrication.SALVAGE_IDS.map((id) => p.salvage[id]),
    unlocks: { ...p.unlocks },
    equipped: p.equipped,
    health: p.health,
    // The guardrail: capabilities without history.
    fabricatedFlags: Object.keys(w.flags).filter((k) => k.startsWith('fabricated_')),
    builtFlags: Object.keys(w.flags).filter((k) => k.endsWith('BuiltAt')),
  };
});
check('Developer Mode is on for this build', loadout.devMode, String(loadout.devMode));
if (loadout.devMode) {
  check('every material is stocked', loadout.materials.every((n) => n >= 100), JSON.stringify(loadout.materials));
  check('salvage is stocked', loadout.salvage.every((n) => n >= 100), JSON.stringify(loadout.salvage));
  check('Arc Blade, Pulse Blaster, jetpack and scanner are all available',
    loadout.unlocks.arcBlade && loadout.unlocks.pulseBlaster && loadout.unlocks.jetpack && loadout.unlocks.scanner,
    JSON.stringify(loadout.unlocks));
  check('Kai starts armed and healthy', loadout.equipped !== 'none' && loadout.health >= 99,
    `${loadout.equipped} @ ${loadout.health}`);
  check('no fabrication history was invented',
    loadout.fabricatedFlags.length === 0 && loadout.builtFlags.length === 0,
    JSON.stringify([...loadout.fabricatedFlags, ...loadout.builtFlags]));
  const devChip = await page.locator('.hint-chip.dev').count();
  check('the HUD says DEV MODE', devChip === 1, `${devChip} chips`);
}

// Weapon switching, through real key presses.
await page.keyboard.press('Digit2');
await page.waitForTimeout(400);
const onBlaster = await page.evaluate(() => window.__EDEN__.getWorld().player.equipped);
await page.keyboard.press('Digit1');
await page.waitForTimeout(400);
const onBlade = await page.evaluate(() => window.__EDEN__.getWorld().player.equipped);
check('2 selects the Pulse Blaster', onBlaster === 'pulseBlaster', onBlaster);
check('1 selects the Arc Blade', onBlade === 'arcBlade', onBlade);

// Jetpack: jump, then a second press in the air.
await page.evaluate(() => {
  const { getWorld, dev } = window.__EDEN__;
  dev.qaReset(getWorld());
  window.__jet = { maxY: -999, thrusted: false, minFuel: 999, raf: 0 };
  const sample = () => {
    const p = getWorld().player;
    window.__jet.maxY = Math.max(window.__jet.maxY, p.y);
    window.__jet.minFuel = Math.min(window.__jet.minFuel, p.jetpackFuel);
    if (p.jetpackOn) window.__jet.thrusted = true;
    window.__jet.raf = requestAnimationFrame(sample);
  };
  sample();
});
/*
 * Driven by state, not by the clock.
 *
 * The jetpack needs a second press *while airborne*, and at one or two frames a
 * second there is no wall-clock delay that reliably lands inside a jump arc —
 * too short and he has not left the ground, too long and he is back on it. So
 * each step waits for the condition it actually depends on.
 */
const until = async (probe, capMs = 40000) => {
  const deadline = Date.now() + capMs;
  for (;;) {
    if (await page.evaluate(probe)) return true;
    if (Date.now() > deadline) return false;
    await page.waitForTimeout(150);
  }
};

const groundBefore = await page.evaluate(() => window.__EDEN__.getWorld().player.y);
await page.keyboard.down('Space');
const leftGround = await until(() => !window.__EDEN__.getWorld().player.onGround);
check('Space still lifts Kai off the ground', leftGround);
// Release and press again, in the air.
await page.keyboard.up('Space');
await page.waitForTimeout(120);
await page.keyboard.down('Space');
const lit = await until(() => window.__EDEN__.getWorld().player.jetpackOn);
// Hold the burn until the tank is nearly out.
await until(() => window.__EDEN__.getWorld().player.jetpackFuel < 25);
await page.keyboard.up('Space');
// And all the way back down.
await until(() => window.__EDEN__.getWorld().player.onGround);
void lit;
// Let the tank start refilling before reading the result.
await awaitPlayerSeconds(1.5);
const jet = await page.evaluate(() => {
  cancelAnimationFrame(window.__jet.raf);
  const p = window.__EDEN__.getWorld().player;
  return { ...window.__jet, onGround: p.onGround, fuel: p.jetpackFuel, y: p.y };
});
const jumpApex = await page.evaluate(() => window.__EDEN__.jetpack.jumpApexEstimate());
check('a second airborne Space lights the jetpack', jet.thrusted, JSON.stringify(jet));
check('thrusting spends most of the tank', jet.minFuel < 40, `min fuel ${jet.minFuel.toFixed(0)}`);
check('the jetpack lifts Kai well above a plain jump', jet.maxY - groundBefore > 4,
  `${(jet.maxY - groundBefore).toFixed(2)}m above a ${jumpApex.toFixed(2)}m jump`);
check('holding thrust does not become flight', jet.maxY - groundBefore < 40,
  `${(jet.maxY - groundBefore).toFixed(2)}m`);
check('and he comes back down and lands', jet.onGround, JSON.stringify({ onGround: jet.onGround, y: jet.y }));
check('fuel recovers on the ground', jet.fuel > jet.minFuel, `${jet.minFuel.toFixed(0)} -> ${jet.fuel.toFixed(0)}`);

// Ranged combat, keyboard only: lock on with L, fire with J.
const ranged = await page.evaluate(async () => {
  const { getWorld, blaster } = window.__EDEN__;
  const w = getWorld();
  const p = w.player;
  blaster.selectWeapon(w, 'pulseBlaster');
  // Borrow an armed creature and stand it in front of him, fifteen metres out —
  // a range only a ranged weapon reaches. It is put back afterwards: a hostile
  // left inside the colony breaks later checks in this script.
  const target = w.creatures.find((c) => c.combat);
  if (!target) return { skipped: true };
  const home = { ...target.pos, health: target.health };
  const forward = { x: Math.sin(p.heading), z: Math.cos(p.heading) };
  target.pos.x = p.pos.x + forward.x * 15;
  target.pos.z = p.pos.z + forward.z * 15;
  target.health = 100;
  return { skipped: false, id: target.id, before: target.health, home };
});
if (!ranged.skipped) {
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(400);
  const locked = await page.evaluate(() => window.__EDEN__.getWorld().player.lockedId);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1200);
  const result = await page.evaluate(
    ({ id, home }) => {
      const w = window.__EDEN__.getWorld();
      const c = w.creatures.find((x) => x.id === id);
      const health = c ? c.health : 0;
      // Put the borrowed creature back exactly as it was found.
      if (c) {
        c.pos.x = home.x;
        c.pos.z = home.z;
        c.health = home.health;
        if (c.combat) c.combat.state = 'calm';
      }
      w.player.lockedId = null;
      return { health, killed: !c, shots: w.shots.length };
    },
    { id: ranged.id, home: ranged.home },
  );
  check('L locks a hostile target', Boolean(locked), String(locked));
  check('J fires the blaster and it damages the target at range',
    result.killed || result.health < ranged.before, `${ranged.before} -> ${result.health}`);
  await page.screenshot({ path: `${SHOT_DIR}/19b-ranged.png` });
}

// F4 restores the QA loadout rather than leaving the tester to re-grind.
await page.evaluate(() => {
  const { getWorld, fabrication } = window.__EDEN__;
  const p = getWorld().player;
  for (const id of fabrication.MATERIAL_IDS) p.materials[id] = 0;
  p.health = 20;
  p.jetpackFuel = 0;
});
await page.keyboard.press('F4');
await page.waitForTimeout(700);
const afterQaReset = await page.evaluate(() => {
  const { getWorld, dev, fabrication } = window.__EDEN__;
  const w = getWorld();
  return {
    devMode: dev.devMode(),
    materials: fabrication.MATERIAL_IDS.map((id) => w.player.materials[id]),
    health: w.player.health,
    fuel: w.player.jetpackFuel,
    settlers: w.settlers.length,
    t: w.timeSec,
  };
});
if (afterQaReset.devMode) {
  check('F4 restores the QA loadout', afterQaReset.materials.every((n) => n >= 100) && afterQaReset.health >= 99,
    JSON.stringify(afterQaReset.materials) + ` hp ${afterQaReset.health}`);
  check('F4 refuels the jetpack', afterQaReset.fuel > 0, String(afterQaReset.fuel));
}
check('the QA reset still leaves the valley running', afterQaReset.settlers > 0 && afterQaReset.t > 0,
  `${afterQaReset.settlers} settlers at t=${afterQaReset.t.toFixed(0)}`);

// The F3 overlay grew a loadout block.
await page.keyboard.press('F3');
await page.waitForTimeout(500);
const devDebug = await page.locator('.debug').innerText().catch(() => '');
check('F3 reports mode, weapon, jetpack and inventory',
  /LOADOUT/.test(devDebug) && /weapon/.test(devDebug) && /jetpack/.test(devDebug) && /inventory/.test(devDebug),
  devDebug.replace(/\n/g, ' | ').slice(-200));
await page.screenshot({ path: `${SHOT_DIR}/19c-dev-overlay.png` });
await page.keyboard.press('F3');
await page.waitForTimeout(300);


console.log(`\n${failures.length === 0 ? 'DEV MODE CHECKS PASSED' : `FAILED \u2014 ${failures.length}`}`);
console.log(`browser errors: ${errors.length}`);
await browser.close();
process.exit(failures.length === 0 && errors.length === 0 ? 0 : 1);
