/**
 * EDEN's dialogue server, for local development.
 *
 * The deployed game serves `/api/dialogue` from a Vercel function; this is the
 * same thing for a machine with no platform under it, so `npm run dev` behaves
 * like production. Node's own `http` module and nothing else — no new runtime
 * dependencies, no build step.
 *
 * It shares every rule with the deployed endpoint by importing
 * `dialogueCore.mjs`. Nothing about what is sent, accepted or refused is
 * decided here; this file only speaks HTTP.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node server/dialogue.mjs
 *   npm run dev    (starts this alongside Vite, which proxies /api to it)
 */
import { createServer } from 'node:http';
import { dialogueConfig, dialogueResponse, MAX_BODY_BYTES, statusBody } from './dialogueCore.mjs';

const PORT = Number(process.env.EDEN_DIALOGUE_PORT ?? 8787);

const json = (res, code, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
};

/** Read a bounded request body. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  // Local development only. The dev server and preview both proxy to this, so
  // it never needs to be reachable from anywhere else.
  res.setHeader('access-control-allow-origin', 'http://127.0.0.1:5173');
  res.setHeader('vary', 'origin');
  if (req.method === 'OPTIONS') {
    res.setHeader('access-control-allow-headers', 'content-type');
    res.writeHead(204);
    res.end();
    return;
  }

  const cfg = dialogueConfig();

  if (req.url === '/api/dialogue/status') {
    json(res, 200, statusBody(cfg));
    return;
  }

  if (req.url !== '/api/dialogue' || req.method !== 'POST') {
    json(res, 404, { error: 'not found' });
    return;
  }

  let context;
  try {
    context = JSON.parse(await readBody(req));
  } catch {
    json(res, 400, { error: 'bad request' });
    return;
  }

  const { status, body } = await dialogueResponse(context, cfg);
  json(res, status, body);
});

server.listen(PORT, '127.0.0.1', () => {
  const cfg = dialogueConfig();
  const state = cfg.apiKey ? `model ${cfg.model}` : 'NO API KEY — clients will use local dialogue';
  console.log(`[eden-dialogue] listening on http://127.0.0.1:${PORT} (${state})`);
});
