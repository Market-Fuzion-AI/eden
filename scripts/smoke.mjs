/**
 * Browser smoke test: boots EDEN against a running dev/preview server,
 * exercises Live Mode, Creator Mode, the inspector and fast-forward, captures
 * screenshots and fails on any console/page error.
 *
 * Usage:
 *   npm run preview &        (or npm run dev)
 *   node scripts/smoke.mjs [url]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const URL = process.argv[2] ?? 'http://localhost:4173/';
const SHOT_DIR = new URL('../smoke-shots', import.meta.url).pathname;
mkdirSync(SHOT_DIR, { recursive: true });

const errors = [];
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
page.on('console', (msg) => msg.type() === 'error' && errors.push('console: ' + msg.text()));
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(6000);
await page.screenshot({ path: `${SHOT_DIR}/live.png` });

await page.keyboard.press('Tab');
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const eden = window.__EDEN__;
  eden.useUI.getState().select('lumi');
  eden.useUI.getState().setSpeed(20);
});
await page.waitForTimeout(5000);
await page.screenshot({ path: `${SHOT_DIR}/creator-lumi.png` });

const facts = await page.evaluate(() => {
  const w = window.__EDEN__.getWorld();
  const lumi = w.creatures.find((c) => c.id === 'lumi');
  return {
    simTime: Number(w.timeSec.toFixed(0)),
    settlers: w.settlers.length,
    creatures: w.creatures.length,
    chronicleEvents: w.chronicle.length,
    lumiGoal: lumi?.goal.label ?? 'GONE',
    lumiTrust: lumi?.lumi.trust ?? -1,
    stateFinite: w.settlers.every((s) => Number.isFinite(s.pos.x) && Number.isFinite(s.hunger)),
  };
});
console.log('WORLD:', JSON.stringify(facts, null, 2));

await page.keyboard.press('Tab');
await page.waitForTimeout(1000);
await page.screenshot({ path: `${SHOT_DIR}/live-after.png` });
await browser.close();

if (!facts.stateFinite || facts.lumiGoal === 'GONE') {
  console.error('SMOKE FAILED: bad world state');
  process.exit(1);
}
if (errors.length > 0) {
  console.error(`SMOKE FAILED: ${errors.length} browser errors`);
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}
console.log('SMOKE OK — screenshots in smoke-shots/');
