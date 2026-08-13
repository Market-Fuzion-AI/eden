import { dialogueConfig, dialogueResponse, MAX_BODY_BYTES } from '../../server/dialogueCore.mjs';

/**
 * POST /api/dialogue — the deployed game's dialogue endpoint.
 *
 * EDEN ships as a static bundle, so this is the only server-side code in the
 * product, and it exists for exactly one reason: **the browser must never hold
 * the API key.** Everything under `src/` is readable by any player. The key is
 * a Vercel environment variable, read here, and what crosses back is a
 * validated turn the client did not have to be trusted to fetch.
 *
 * All the logic lives in `server/dialogueCore.mjs`, shared with the local
 * development server. This file is a shape adapter and nothing more.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  // Vercel parses JSON bodies, but a client can send anything at all.
  let context = req.body;
  if (typeof context === 'string') {
    if (context.length > MAX_BODY_BYTES) {
      res.status(413).json({ error: 'body too large' });
      return;
    }
    try {
      context = JSON.parse(context);
    } catch {
      res.status(400).json({ error: 'bad request' });
      return;
    }
  }

  const { status, body } = await dialogueResponse(context, dialogueConfig());
  res.setHeader('cache-control', 'no-store');
  res.status(status).json(body);
}
