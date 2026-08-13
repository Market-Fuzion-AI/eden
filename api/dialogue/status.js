import { dialogueConfig, statusBody } from '../../server/dialogueCore.mjs';

/**
 * GET /api/dialogue/status — is the model layer usable in this deployment?
 *
 * Answers whether a key is configured and which model would answer. It never
 * reveals the key itself, only its presence, which is what lets the game report
 * an accurate provider state without the browser ever holding a secret.
 *
 * This is how production detects availability: the client asks its own origin,
 * gets a truthful answer, and falls back to local dialogue if anything here is
 * missing or broken.
 */
export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  res.setHeader('cache-control', 'no-store');
  res.status(200).json(statusBody(dialogueConfig()));
}
