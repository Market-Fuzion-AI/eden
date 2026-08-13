/**
 * The conversation UI, in a real browser.
 *
 * Walks Kai up to a settler, opens a conversation with a real key press, checks
 * the portraits and the replies are actually on screen, answers, and confirms
 * that no relationship telemetry appears anywhere in Live Mode — which was the
 * complaint this ticket set out to fix.
 *
 * Usage:
 *   npx vite preview --port 4173 &
 *   node scripts/conversation-check.mjs [url]
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

// Broad daylight so the screenshots are judged on layout, not on dusk.
await page.evaluate(() => {
  const { getWorld, config } = window.__EDEN__;
  const w = getWorld();
  const day = Math.floor(w.timeSec / config.DAY_SEC);
  w.timeSec = day * config.DAY_SEC + config.DAY_SEC * 0.5;
});

console.log('\nCONVERSATION');

/** Stand Kai in front of a settler and look at them. */
const approach = async () =>
  page.evaluate(() => {
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

const partner = await approach();
check('a settler is within talking range', partner !== null, JSON.stringify(partner));
await page.waitForTimeout(1400);

const prompt = await page.evaluate(() =>
  window.__EDEN__.sim.getInteractions(window.__EDEN__.getWorld()).map((p) => `${p.key} ${p.label}`),
);
check('the E prompt offers to talk', prompt.some((s) => /Talk to/.test(s)), JSON.stringify(prompt));

// Real key press.
await page.keyboard.press('KeyE');
await page.waitForTimeout(900);
check('E opens a conversation', await page.locator('.convo').isVisible().catch(() => false));

const portraits = await page.locator('.portrait-card').count();
check('two portraits are on screen — the NPC and Kai', portraits === 2, `${portraits}`);
const speakerName = await page.locator('.convo-name').innerText().catch(() => '');
check('the speaker is named', speakerName.length > 1 && speakerName === partner.name, `${speakerName}`);
const role = await page.locator('.convo-role').innerText().catch(() => '');
check('the speaker has a role', role.length > 2, role);
const moods = await page.locator('.portrait-mood').allInnerTexts();
check('each portrait carries a mood', moods.length === 2 && moods.every((m) => m.length > 0), JSON.stringify(moods));
const speaking = await page.locator('.portrait-card.speaking').count();
check('the one speaking is highlighted', speaking === 1, `${speaking}`);

const replies = await page.locator('.convo-reply').allInnerTexts();
check('two to four replies are offered', replies.length >= 2 && replies.length <= 4, JSON.stringify(replies));
check('replies are lines Kai would say, not labels',
  replies.every((r) => r.length > 6 && !/^\[/.test(r)), JSON.stringify(replies));
await page.screenshot({ path: `${SHOT_DIR}/c1-01-conversation.png` });

// The complaint this ticket exists to fix.
const hudText = await page.locator('.hud').innerText().catch(() => '');
const convoText = await page.locator('.convo').innerText().catch(() => '');
const screen = `${hudText}\n${convoText}`;
check('no affinity telemetry anywhere in Live Mode', !/affinity/i.test(screen), screen.slice(0, 160));
check('no trust or fear numbers either', !/trust\s*[+\-0-9]|fear\s*[+\-0-9]/i.test(screen));

// Answer, and watch the NPC respond to what was chosen.
const before = await page.locator('.convo-line').count();
await page.locator('.convo-reply').first().click();
await page.waitForTimeout(2200);
const after = await page.locator('.convo-line').count();
check("Kai's line and a reply are both added", after >= before + 2, `${before} → ${after}`);
const playerLines = await page.locator('.convo-line.player').count();
check("Kai's own line is marked as his", playerLines >= 1, `${playerLines}`);
const newReplies = await page.locator('.convo-reply').count();
check('the conversation continues with fresh replies', newReplies >= 2, `${newReplies}`);
await page.screenshot({ path: `${SHOT_DIR}/c1-02-after-reply.png` });

// The settler is still there.
const held = await page.evaluate((id) => {
  const w = window.__EDEN__.getWorld();
  const s = w.settlers.find((x) => x.id === id);
  return { goal: s?.goal.type, speed: s?.speed, present: Boolean(s) };
}, partner.id);
check('the settler stays for the conversation', held.present && held.goal === 'talk-emerson', JSON.stringify(held));

// Developer tooling: which provider answered, and the switch.
const source = await page.locator('.convo-source').innerText().catch(() => '');
check('developer tooling shows which provider spoke', source === 'LOCAL', source);
await page.keyboard.press('F6');
await page.waitForTimeout(400);
const mode = await page.evaluate(() => window.__EDEN__.conversation.providerMode());
check('F6 switches the provider in Developer Mode', mode === 'openai', mode);
await page.keyboard.press('F6');
await page.waitForTimeout(300);
check('and switches back', (await page.evaluate(() => window.__EDEN__.conversation.providerMode())) === 'local');

// With no dialogue server running, the remote provider must degrade silently.
await page.evaluate(() => window.__EDEN__.conversation.setProviderMode('openai'));
const replyCount = await page.locator('.convo-reply').count();
if (replyCount > 0) {
  await page.locator('.convo-reply').first().click();
  // Long enough for the client timeout to fire and the local voice to answer.
  await page.waitForTimeout(9000);
  const stillOpen = await page.locator('.convo').isVisible().catch(() => false);
  const pending = await page.evaluate(() => window.__EDEN__.getWorld().conversation?.pending ?? false);
  const nowSource = await page.locator('.convo-source').innerText().catch(() => '');
  check('an unreachable provider does not strand the conversation', stillOpen && !pending,
    JSON.stringify({ stillOpen, pending }));
  check('it falls back to local dialogue', nowSource === 'LOCAL', nowSource);
  check('and there are replies to carry on with', (await page.locator('.convo-reply').count()) >= 2);
}
await page.evaluate(() => window.__EDEN__.conversation.setProviderMode('local'));

// Escape leaves, and the world carries on.
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
check('Escape leaves the conversation', !(await page.locator('.convo').isVisible().catch(() => false)));
const afterClose = await page.evaluate((id) => {
  const w = window.__EDEN__.getWorld();
  const s = w.settlers.find((x) => x.id === id);
  return {
    conversation: w.conversation,
    memories: s?.memories.length ?? 0,
    lastMemory: s?.memories[s.memories.length - 1] ?? null,
    settlers: w.settlers.length,
  };
}, partner.id);
check('the conversation is cleared', afterClose.conversation === null);
check('it left a bounded memory behind', afterClose.memories > 0 && (afterClose.lastMemory?.place ?? '').length < 48,
  JSON.stringify(afterClose.lastMemory));
check('the valley is unharmed', afterClose.settlers > 0, `${afterClose.settlers} settlers`);

// The key must not be anywhere the client can see it.
const clientScan = await page.evaluate(async () => {
  const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.src);
  let combined = '';
  for (const src of scripts) {
    try {
      combined += await (await fetch(src)).text();
    } catch {
      /* ignore */
    }
  }
  return {
    scripts: scripts.length,
    hasKey: /sk-[A-Za-z0-9]{16,}/.test(combined),
    hasKeyName: /OPENAI_API_KEY/.test(combined),
    hasUpstream: /api\.openai\.com/.test(combined),
    // Anything Vite exposed to the client would be inlined into the bundle, so
    // scanning the served scripts already covers it — `import.meta.env` cannot
    // be read from inside an injected function.
  };
});
check('at least one script was actually scanned', clientScan.scripts > 0, JSON.stringify(clientScan));
check('the served bundle contains no API key', !clientScan.hasKey && !clientScan.hasKeyName, JSON.stringify(clientScan));
check('the served bundle does not even know the OpenAI endpoint', !clientScan.hasUpstream, JSON.stringify(clientScan));

console.log(`\nBROWSER ERRORS: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log('  ' + e);
console.log(
  `\n${failures.length === 0 && errors.length === 0 ? 'CONVERSATION CHECKS PASSED' : `FAILED — ${failures.length} check(s), ${errors.length} error(s)`}`,
);
for (const f of failures) console.log(`  ✗ ${f}`);
await browser.close();
process.exit(failures.length === 0 && errors.length === 0 ? 0 : 1);
