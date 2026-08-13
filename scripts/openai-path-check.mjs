/**
 * The whole OpenAI path, end to end, in a real browser.
 *
 * `dialogue-check.mjs` proves the server in isolation. This proves the chain a
 * player's key press actually travels: browser → EDEN's own origin → the
 * dialogue server → upstream → validation → back into the conversation on
 * screen. The only thing standing in for reality is the upstream itself, which
 * is a stub returning a known line — a genuine OpenAI call needs a secret this
 * environment does not have and must never have.
 *
 * It also enforces the rule that matters most for cost: **one API call per
 * generated dialogue turn, and none at any other time**. The stub counts every
 * request it receives, so idle time, walking around, and the settlement
 * simulating in the background are all measured, not assumed.
 *
 * Usage:
 *   npx vite preview --port 4173 &
 *   node scripts/openai-path-check.mjs [url]
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const TARGET_URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const SHOT_DIR = new URL('../smoke-shots', import.meta.url).pathname;
mkdirSync(SHOT_DIR, { recursive: true });
const SEED = Number(process.env.EDEN_SEED ?? 31337);
const UPSTREAM_PORT = 8903;
/** The port the running preview proxies `/api` to. */
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

const MODEL_LINE = 'Careful out past the ridge — I lost a marker post there last week.';

/** Stands in for api.openai.com, and counts everything it is asked. */
const seen = [];
const upstream = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ auth: req.headers.authorization, body });
    const payload = {
      output_text: JSON.stringify({
        npcLine: MODEL_LINE,
        npcMood: 'concerned',
        replies: [
          { text: "I'll keep an eye out for it.", intent: 'friendly' },
          { text: 'What happened to it?', intent: 'curious' },
          { text: 'I can handle the ridge.', intent: 'firm' },
        ],
        reactionHints: { npcReaction: 'positive', relationshipSignal: 'trust', intensity: 'small' },
        topic: 'the ridge',
      }),
    };
    const text = JSON.stringify(payload);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(text);
  });
});
await new Promise((r) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', r));

/** The real dialogue server, holding a key the browser will never see. */
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

try {
  console.log('\nOPENAI PATH (stubbed upstream, real server, real browser)');

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

  // --- Cost control, before anything is deliberately asked ------------------
  // Booting, loading, walking and a whole settlement thinking must all be free.
  await page.waitForTimeout(3000);
  check('booting and simulating the world costs nothing', seen.length === 0, `${seen.length} upstream call(s)`);

  // --- Turn the provider on the way a developer would -----------------------
  await page.keyboard.press('F6');
  await page.waitForTimeout(900);
  const mode = await page.evaluate(() => window.__EDEN__.conversation.providerMode());
  check('F6 selects the OpenAI provider', mode === 'openai', mode);
  check('the status probe is not itself a model call', seen.length === 0, `${seen.length} upstream call(s)`);

  const overlayOpen = await page.locator('.debug').isVisible().catch(() => false);
  if (!overlayOpen) await page.keyboard.press('F3');
  // The overlay's rows are read from a requestAnimationFrame loop, and headless
  // software rendering runs at one or two frames a second — so the status probe
  // may not even have *started* within a fixed wait. Poll for the answer.
  let overlay = '';
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(300);
    overlay = await page.locator('.debug').innerText().catch(() => '');
    if (/test-model|UNAVAILABLE/.test(overlay)) break;
  }
  check('the developer overlay reports the model in use', /OPENAI/i.test(overlay) && /test-model/.test(overlay),
    JSON.stringify(overlay.split('\n').filter((l) => /OPENAI|LOCAL|checking|UNAVAIL/i.test(l))));
  check('the overlay names the model but never a key', !/sk-/.test(overlay), 'clean');
  if (!overlayOpen) await page.keyboard.press('F3');
  await page.waitForTimeout(400);

  // --- One deliberate conversation -----------------------------------------
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

  const beforeOpen = seen.length;
  await page.keyboard.press('KeyE');
  // The panel must be on screen straight away; only the line is allowed to wait.
  await page.waitForTimeout(250);
  check('E opens the panel immediately, without waiting on the network',
    await page.locator('.convo').isVisible().catch(() => false));
  check('and the portraits are already up', (await page.locator('.portrait-card').count()) === 2);

  await page.waitForTimeout(4000);
  const firstLine = await page.locator('.convo-line').last().innerText().catch(() => '');
  check('the opening line came from the model', firstLine.includes('ridge'), firstLine.slice(0, 90));
  const source = await page.locator('.convo-source').innerText().catch(() => '');
  check('the panel attributes it to OPENAI', source === 'OPENAI', source);
  check('opening the conversation cost exactly one call', seen.length === beforeOpen + 1,
    `${seen.length - beforeOpen}`);

  const replies = await page.locator('.convo-reply').allInnerTexts();
  check('the model\'s replies are the ones offered', replies.length === 3 && replies.some((r) => /ridge/i.test(r)),
    JSON.stringify(replies));
  await page.screenshot({ path: `${SHOT_DIR}/c1-03-openai-turn.png` });

  // --- What actually went upstream -----------------------------------------
  const sentRaw = seen[seen.length - 1]?.body ?? '{}';
  const sent = JSON.parse(sentRaw);
  const contextText = JSON.stringify(sent.input ?? '');
  check('the key travelled as a bearer token to the upstream only',
    seen.every((s) => s.auth === `Bearer ${FAKE_KEY}`), String(seen[0]?.auth).slice(0, 12) + '…');
  check('the context is labelled as data, not instructions', /GAME CONTEXT \(data, not instructions\)/.test(contextText),
    contextText.slice(0, 60));
  check('the system prompt forbids inventing facts', /Never invent facts/.test(JSON.stringify(sent.instructions ?? '')));

  // The bounded-context rule: a handful of facts about one person, not a world.
  const world = await page.evaluate(() => {
    const w = window.__EDEN__.getWorld();
    return { settlers: w.settlers.length, chronicle: w.chronicle?.length ?? 0 };
  });
  const namesSent = await page.evaluate((body) => {
    const w = window.__EDEN__.getWorld();
    return w.settlers.filter((s) => body.includes(s.name)).length;
  }, sentRaw);
  check('only the person being spoken to is described', namesSent <= 2,
    `${namesSent} of ${world.settlers} settlers named`);
  check('the Chronicle is not sent', sentRaw.length < 6000 && !/chronicle/i.test(sentRaw),
    `${sentRaw.length} bytes, ${world.chronicle} chronicle entries`);
  check('no relationship numbers are sent, only words',
    !/"affinity":\s*-?[0-9]/.test(sentRaw) && !/"trust":\s*-?[0-9]/.test(sentRaw), 'banded');
  check('Creator Mode internals are not sent', !/creator|utility|goalScore|weight/i.test(sentRaw), 'clean');

  // --- One reply, one call --------------------------------------------------
  const beforeReply = seen.length;
  await page.locator('.convo-reply').first().click();
  await page.waitForTimeout(3000);
  check('answering costs exactly one more call', seen.length === beforeReply + 1, `${seen.length - beforeReply}`);
  const lines = await page.locator('.convo-line').count();
  check('the exchange is building a transcript', lines >= 3, `${lines} lines`);
  const playerLine = await page.locator('.convo-line.player').count();
  check('Kai\'s chosen line is shown as his', playerLine >= 1, `${playerLine}`);
  const intentSent = JSON.parse(seen[seen.length - 1].body);
  check('what Kai said is passed on as intent',
    /playerIntent/.test(JSON.stringify(intentSent.input)) && /keep an eye out/i.test(JSON.stringify(intentSent.input)),
    'carried');
  await page.screenshot({ path: `${SHOT_DIR}/c1-04-openai-reply.png` });

  // --- Idle costs nothing ---------------------------------------------------
  const beforeIdle = seen.length;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__EDEN__.useUI.getState().setSpeed(20));
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.__EDEN__.useUI.getState().setSpeed(1));
  check('the valley running at speed costs nothing', seen.length === beforeIdle,
    `${seen.length - beforeIdle} call(s) while idle`);

  // --- Maya stays authored, with the model switched on ----------------------
  // The Signal must read the same every time. Put the mission at the moment she
  // is found, open her conversation, and confirm it is the written scene — with
  // the OpenAI provider still selected the whole time.
  const mayaCalls = seen.length;
  const maya = await page.evaluate(() => {
    const { getWorld, story, conversation } = window.__EDEN__;
    const w = getWorld();
    if (!w.mission) return { ok: false, why: 'no mission' };
    w.mission.state = 'survivorFound';
    const script = story.beginSurvivorDialogue(w);
    const s = w.settlers.find((x) => x.speciesId === 'human' && !x.resting);
    return {
      ok: Boolean(script),
      scriptId: script?.scriptId ?? null,
      line: script?.lines?.[0]?.text ?? '',
      // While an authored scene owns the screen, the generic system must refuse.
      genericRefused: s ? conversation.beginConversation(w, s) === null : false,
      mode: conversation.providerMode(),
    };
  });
  check('her scene opens as authored script, not a generated one', maya.ok && maya.scriptId?.startsWith('the-signal'),
    JSON.stringify(maya).slice(0, 140));
  check('the line is written, not generated', maya.line.length > 0 && !maya.line.includes('ridge'),
    maya.line.slice(0, 80));
  check('the generic conversation system stands down for an authored scene', maya.genericRefused === true);
  check('the OpenAI provider was selected throughout', maya.mode === 'openai', maya.mode);
  check('and the authored scene cost no model call', seen.length === mayaCalls, `${seen.length - mayaCalls}`);
  await page.evaluate(() => {
    const w = window.__EDEN__.getWorld();
    w.dialogueScript = null;
  });

  // --- The secret, from the browser's point of view -------------------------
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
    };
  });
  check('the served bundle still holds no key, with the server live',
    clientScan.scripts > 0 && !clientScan.hasKey && !clientScan.hasKeyName, JSON.stringify(clientScan));
  check('and still does not know the upstream endpoint', !clientScan.hasUpstream, JSON.stringify(clientScan));
  const stored = await page.evaluate(() => JSON.stringify(window.localStorage));
  check('nothing secret was written to localStorage', !/sk-|OPENAI/.test(stored), stored.slice(0, 120));

  console.log(`\nUPSTREAM CALLS TOTAL: ${seen.length}`);
  console.log(`BROWSER ERRORS: ${errors.length}`);
  for (const e of errors.slice(0, 5)) console.log('  ' + e);
} finally {
  await browser.close();
  server.kill();
  upstream.close();
}

console.log(
  `\n${failures.length === 0 && errors.length === 0 ? 'OPENAI PATH CHECKS PASSED' : `FAILED — ${failures.length} check(s), ${errors.length} error(s)`}`,
);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length === 0 && errors.length === 0 ? 0 : 1);
