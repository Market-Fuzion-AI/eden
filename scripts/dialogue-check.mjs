/**
 * The dialogue server, exercised for real.
 *
 * Starts `server/dialogue.mjs` three ways and checks it behaves in each:
 * with no key configured, with a key and a stubbed upstream that answers
 * correctly, and with a key and an upstream that answers with rubbish.
 *
 * The upstream is stubbed rather than real because a genuine OpenAI call needs
 * a secret this environment does not have — and should not have. What is proved
 * here is everything up to that boundary: the route, the validation, the
 * failure handling, and that the key never leaves the process.
 *
 * Usage:  node scripts/dialogue-check.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    console.log(`  ✗ ${name} ${detail}`);
    failures.push(name);
  }
};

const CONTEXT = {
  npc: {
    id: 'set_1',
    name: 'Mira',
    species: 'Human',
    role: 'Field Medic',
    personality: ['warm', 'curious'],
    currentGoal: 'Looking for something to eat',
    needs: ['hungry'],
    location: 'Human Landing',
    region: 'Riverlands',
    mood: 'getting on with the day',
  },
  relationship: {
    firstMeeting: true,
    familiarity: 'barely knows Kai',
    trust: 'does not trust him yet',
    affinity: 'neutral toward Kai',
    wary: false,
    timesSpoken: 0,
  },
  memories: [],
  knows: ['Has been to landing.'],
  situation: { time: 'daytime', weather: 'clear', danger: null },
  playerIntent: null,
};

/** A stand-in for api.openai.com that returns whatever we tell it to. */
function startFakeUpstream(port, responder) {
  return new Promise((resolve) => {
    const seen = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ url: req.url, auth: req.headers.authorization, body });
        const { status, payload } = responder();
        const text = JSON.stringify(payload);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(text);
      });
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, seen }));
  });
}

/** Start the dialogue server with a given environment, wait for it to listen. */
function startDialogueServer(env, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server/dialogue.mjs'], {
      env: { ...process.env, ...env, EDEN_DIALOGUE_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (c) => {
      out += c.toString();
      if (out.includes('listening')) resolve({ child, banner: out });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    setTimeout(() => reject(new Error(`server did not start: ${out}`)), 8000);
  });
}

const post = async (port, body) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/dialogue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
};

const getStatus = async (port) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/dialogue/status`);
  return res.json();
};

console.log('\nDIALOGUE SERVER');

// --- 1. No key configured --------------------------------------------------
{
  const port = 8801;
  const { child, banner } = await startDialogueServer({ OPENAI_API_KEY: '' }, port);
  try {
    const status = await getStatus(port);
    check('reports unavailable when no key is configured', status.available === false, JSON.stringify(status));
    check('the status never contains a key', !JSON.stringify(status).includes('sk-'), JSON.stringify(status));
    check('the startup banner says so rather than failing', /NO API KEY/.test(banner), banner.trim().slice(0, 120));

    const r = await post(port, CONTEXT);
    check('a request without a key succeeds with no turn', r.status === 200 && r.json.turn === null,
      JSON.stringify(r.json));
    check('and says why, so the client can fall back', r.json.reason === 'no-api-key', String(r.json.reason));
  } finally {
    child.kill();
  }
}

// --- 2. A key, and an upstream that answers properly -----------------------
{
  const port = 8802;
  const upstreamPort = 8901;
  const { server, seen } = await startFakeUpstream(upstreamPort, () => ({
    status: 200,
    payload: {
      output_text: JSON.stringify({
        npcLine: 'You must be the pathfinder. Mira.',
        npcMood: 'surprised',
        replies: [
          { text: 'That is me. Kai.', intent: 'friendly' },
          { text: 'What do you do here?', intent: 'curious' },
        ],
        reactionHints: { npcReaction: 'positive', relationshipSignal: 'affinity', intensity: 'small' },
        topic: 'introductions',
      }),
    },
  }));
  // Point the server's upstream at the stub by overriding the host it resolves.
  // Simplest honest approach: the server reads the URL from its own source, so
  // instead we verify behaviour through a proxy env the server understands.
  const { child } = await startDialogueServer(
    { OPENAI_API_KEY: 'sk-test-not-a-real-key-000000', OPENAI_DIALOGUE_MODEL: 'test-model', EDEN_DIALOGUE_UPSTREAM: `http://127.0.0.1:${upstreamPort}/v1/responses` },
    port,
  );
  try {
    const status = await getStatus(port);
    check('reports available when a key is configured', status.available === true, JSON.stringify(status));
    check('exposes the model name but never the key', status.model === 'test-model' && !JSON.stringify(status).includes('sk-'),
      JSON.stringify(status));

    const r = await post(port, CONTEXT);
    check('a well-formed upstream answer becomes a validated turn', Boolean(r.json.turn), JSON.stringify(r.json).slice(0, 200));
    if (r.json.turn) {
      check('the turn carries the line', r.json.turn.npcLine.includes('Mira'), r.json.turn.npcLine);
      check('the turn carries replies', r.json.turn.replies.length === 2, String(r.json.turn.replies.length));
      check('replies are given stable ids', r.json.turn.replies[0].id === 'r0', JSON.stringify(r.json.turn.replies[0]));
      check('the turn is marked as coming from the model', r.json.turn.source === 'openai', r.json.turn.source);
    }
    check('the key was sent upstream, and only upstream',
      seen.length > 0 && seen[0].auth === 'Bearer sk-test-not-a-real-key-000000',
      String(seen[0]?.auth).slice(0, 20));
    check('the game context reached the model as data',
      seen.length > 0 && seen[0].body.includes('GAME CONTEXT'), (seen[0]?.body ?? '').slice(0, 80));
    check('the response sent to the client contains no key',
      !JSON.stringify(r.json).includes('sk-test'), 'clean');
  } finally {
    child.kill();
    server.close();
  }
}

// --- 3. A key, and an upstream that answers with rubbish -------------------
{
  const port = 8803;
  const upstreamPort = 8902;
  const { server } = await startFakeUpstream(upstreamPort, () => ({
    status: 200,
    payload: { output_text: 'Sure! Here is a nice chat:\n\nMira says hello.' },
  }));
  const { child } = await startDialogueServer(
    { OPENAI_API_KEY: 'sk-test-not-a-real-key-000000', EDEN_DIALOGUE_UPSTREAM: `http://127.0.0.1:${upstreamPort}/v1/responses` },
    port,
  );
  try {
    const r = await post(port, CONTEXT);
    check('prose instead of JSON is rejected rather than passed through',
      r.status === 200 && r.json.turn === null, JSON.stringify(r.json).slice(0, 160));
    check('and the client is told to fall back', r.json.reason === 'upstream-failed', String(r.json.reason));

    const bad = await fetch(`http://127.0.0.1:${port}/api/dialogue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json at all',
    });
    check('a malformed request is refused', bad.status === 400, String(bad.status));

    const wrongRoute = await fetch(`http://127.0.0.1:${port}/api/anything-else`);
    check('no other route is served', wrongRoute.status === 404, String(wrongRoute.status));
  } finally {
    child.kill();
    server.close();
  }
}

console.log(`\n${failures.length === 0 ? 'DIALOGUE SERVER CHECKS PASSED' : `FAILED — ${failures.length}`}`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
