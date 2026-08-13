/**
 * Developer Controls, driven exactly the way Emerson will drive them.
 *
 * The bug this exists to prevent: QA on macOS could not switch dialogue
 * provider, because the only way to do it was F6 and the OS takes the bare
 * function keys before the page sees them. So this script uses **no keyboard at
 * all** for anything Developer Mode depends on — every step is a click, and the
 * run fails if a function key would have been required.
 *
 * It walks the whole QA path against a real dialogue server with a stubbed
 * upstream: open the panel, read the endpoint state, switch to OPENAI, talk to
 * a settler, and confirm the conversation panel says OPENAI and that replies
 * follow the conversation.
 *
 * Usage:
 *   npx vite preview --port 4173 &
 *   node scripts/devcontrols-check.mjs [url]
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const TARGET_URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const SHOT_DIR = new URL('../smoke-shots', import.meta.url).pathname;
mkdirSync(SHOT_DIR, { recursive: true });
const SEED = Number(process.env.EDEN_SEED ?? 31337);
const UPSTREAM_PORT = 8907;
const DIALOGUE_PORT = Number(process.env.EDEN_DIALOGUE_PORT ?? 8787);
const FAKE_KEY = 'sk-test-not-a-real-key-000000';

const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    console.log(`  ✗ ${name} ${detail}`);
    failures.push(name);
  }
};

/**
 * A stand-in upstream that answers differently each turn, so "the reply follows
 * the conversation" is something the test can actually observe rather than
 * assume.
 */
const seen = [];
const LINES = [
  'You picked a bad week to come asking. The pump housing cracked again.',
  'Third time this season. I keep patching what wants replacing.',
  'If you are heading out that way, mind the low ground. It floods without warning.',
  'Ask me again when I have both hands free.',
  'Go on then. I have work.',
];
const upstream = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ auth: req.headers.authorization, body });
    const payload = {
      output_text: JSON.stringify({
        npcLine: LINES[Math.min(seen.length - 1, LINES.length - 1)],
        npcMood: 'concerned',
        replies: [
          { text: `Can I help with it? (${seen.length})`, intent: 'friendly' },
          { text: `What broke exactly? (${seen.length})`, intent: 'curious' },
        ],
        reactionHints: { npcReaction: 'positive', relationshipSignal: 'trust', intensity: 'small' },
        topic: 'the pump',
      }),
    };
    const text = JSON.stringify(payload);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(text);
  });
});
await new Promise((r) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', r));

const server = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['server/dialogue.mjs'], {
    env: {
      ...process.env,
      OPENAI_API_KEY: FAKE_KEY,
      OPENAI_DIALOGUE_MODEL: 'test-model',
      EDEN_DIALOGUE_PORT: String(DIALOGUE_PORT),
      EDEN_DIALOGUE_UPSTREAM: `http://127.0.0.1:${UPSTREAM_PORT}/v1/responses`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const onData = (c) => {
    out += c.toString();
    if (out.includes('listening')) resolve(child);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', reject);
  setTimeout(() => reject(new Error(`dialogue server did not start: ${out}`)), 8000);
});

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

/**
 * Fail loudly if anything here reaches for a function key. On the machine that
 * matters, those presses go to the operating system.
 */
let functionKeyUsed = false;
const realPress = page.keyboard.press.bind(page.keyboard);
page.keyboard.press = async (key, ...rest) => {
  if (/^F\d+$/.test(key)) functionKeyUsed = true;
  return realPress(key, ...rest);
};

try {
  console.log('\nDEVELOPER CONTROLS — CLICK ONLY');

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);
  if (await page.locator('.help').isVisible().catch(() => false)) await page.locator('.help-resume').click();
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const { getWorld, config } = window.__EDEN__;
    const w = getWorld();
    const day = Math.floor(w.timeSec / config.DAY_SEC);
    w.timeSec = day * config.DAY_SEC + config.DAY_SEC * 0.5;
  });

  // --- 1. Open Developer Controls, by clicking ------------------------------
  const badge = page.locator('.dev-badge');
  check('the DEV MODE badge is on screen', await badge.isVisible().catch(() => false));
  check('and it is a real button, not a label', (await badge.evaluate((el) => el.tagName)) === 'BUTTON');
  await badge.click();
  await page.waitForTimeout(1500);
  check('clicking it opens Developer Controls', await page.locator('.dev-panel').isVisible().catch(() => false));

  const panelText = await page.locator('.dev-panel').innerText();
  check('the panel names the dialogue provider', /DIALOGUE PROVIDER/i.test(panelText), panelText.slice(0, 80));
  check('it starts on LOCAL', /\bLOCAL\b/.test(panelText));

  // --- 2. The endpoint reports itself ---------------------------------------
  const endpointRow = await page
    .locator('.dev-row', { hasText: 'OpenAI endpoint' })
    .innerText()
    .catch(() => '');
  check('the panel reports the endpoint as available', /available/i.test(endpointRow) && !/unavailable/i.test(endpointRow),
    endpointRow);
  check('and names the model it would use', /test-model/.test(endpointRow), endpointRow);
  check('checking the endpoint costs no model call', seen.length === 0, `${seen.length}`);

  // The panel has to be readable, not just present. The identification card
  // lives in the same corner and was printing straight through the key list.
  check('nothing is drawn over the panel', !(await page.locator('.ident-card').isVisible().catch(() => false)));
  const keyRows = await page.locator('.dev-keys tr').count();
  check('the controls reference is listed', keyRows >= 6, `${keyRows} rows`);
  for (const [key, what] of [
    ['1', 'Arc Blade'],
    ['2', 'Pulse Blaster'],
    ['J', 'Attack'],
    ['K', 'Heavy melee'],
    ['L', 'Lock'],
    ['Space → Space', 'jetpack'],
  ]) {
    check(`  ${key} is documented`, panelText.includes(key) && new RegExp(what, 'i').test(panelText));
  }
  await page.screenshot({ path: `${SHOT_DIR}/d1-01-dev-controls.png` });

  // --- 3. Switch to OPENAI, by clicking -------------------------------------
  await page.locator('.dev-seg-btn', { hasText: 'OPENAI' }).click();
  await page.waitForTimeout(900);
  const mode = await page.evaluate(() => window.__EDEN__.conversation.providerMode());
  check('clicking OPENAI switches the provider', mode === 'openai', mode);
  const afterSwitch = await page.locator('.dev-panel').innerText();
  check('and the panel shows it', /OPENAI/.test(afterSwitch));
  const activeBtn = await page.locator('.dev-seg-btn.active').innerText();
  check('the OPENAI button is the one marked active', activeBtn.trim() === 'OPENAI', activeBtn);

  // Close the panel so it is out of the way — also by clicking.
  await page.locator('.dev-panel .close-btn').click();
  await page.waitForTimeout(400);
  check('it closes again by clicking', !(await page.locator('.dev-panel').isVisible().catch(() => false)));
  check('and the badge comes back', await page.locator('.dev-badge').isVisible().catch(() => false));

  // --- 4. Talk to a normal settler ------------------------------------------
  const partner = await page.evaluate(() => {
    const { getWorld, input, terrain } = window.__EDEN__;
    const w = getWorld();
    const s = w.settlers.find((x) => x.speciesId === 'human' && !x.resting);
    if (!s) return null;
    const p = w.player;
    p.pos.x = s.pos.x + 1.6;
    p.pos.z = s.pos.z + 1.6;
    p.y = terrain.groundY(p.pos.x, p.pos.z);
    const yaw = Math.atan2(s.pos.x - p.pos.x, s.pos.z - p.pos.z);
    p.heading = yaw;
    input.inputState.camYaw = yaw - 0.45;
    input.inputState.camPitch = -0.1;
    input.inputState.camDist = 6;
    return { id: s.id, name: s.name };
  });
  check('a settler is within talking range', partner !== null);
  await page.waitForTimeout(1200);

  await page.keyboard.press('KeyE');
  await page.waitForTimeout(4000);
  check('the conversation opens', await page.locator('.convo').isVisible().catch(() => false));

  // --- 5. The panel says OPENAI ---------------------------------------------
  const source = await page.locator('.convo-source').innerText().catch(() => '');
  check('the dialogue panel says OPENAI', source === 'OPENAI', source);
  const firstLine = await page.locator('.convo-line').last().innerText().catch(() => '');
  check('the opening line came from the model', firstLine.includes('pump'), firstLine.slice(0, 80));
  check('opening cost exactly one call', seen.length === 1, `${seen.length}`);

  // --- 6. Three to five turns, and do the replies follow? -------------------
  const said = [];
  for (let turn = 0; turn < 4; turn++) {
    const replies = page.locator('.convo-reply');
    if ((await replies.count()) === 0) break;
    const chosen = (await replies.first().innerText()).trim();
    said.push(chosen);
    await replies.first().click();
    await page.waitForTimeout(2500);
  }
  check('four more turns were taken', said.length === 4, JSON.stringify(said));
  check('each turn cost exactly one call', seen.length === 1 + said.length, `${seen.length}`);

  // What Kai actually said has to reach the model, or the reply cannot follow.
  const carried = seen.slice(1).every((s, i) => s.body.includes(said[i].replace(/"/g, '\\"')));
  check('what Kai chose was sent as intent each time', carried, JSON.stringify(said));

  const transcript = await page.locator('.convo-line').allInnerTexts();
  check('the transcript alternates Kai and the settler', transcript.length >= 9, `${transcript.length} lines`);
  const distinct = new Set(transcript.filter((_, i) => i % 2 === 0)).size;
  check('the settler does not repeat the same line each turn', distinct >= 4, `${distinct} distinct`);
  await page.screenshot({ path: `${SHOT_DIR}/d1-02-openai-conversation.png` });

  // --- The point of the whole ticket ----------------------------------------
  check('no function key was needed for any of this', !functionKeyUsed, 'a function key was pressed');

  console.log(`\nUPSTREAM CALLS TOTAL: ${seen.length}`);
  console.log(`BROWSER ERRORS: ${errors.length}`);
  for (const e of errors.slice(0, 5)) console.log('  ' + e);
} finally {
  await browser.close();
  server.kill();
  upstream.close();
}

console.log(
  `\n${failures.length === 0 && errors.length === 0 ? 'DEVELOPER CONTROLS CHECKS PASSED' : `FAILED — ${failures.length} check(s), ${errors.length} error(s)`}`,
);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length === 0 && errors.length === 0 ? 0 : 1);
