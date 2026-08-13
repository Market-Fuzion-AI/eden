import { DIALOGUE } from '../sim/config';
import { validateTurn, type DialogueProvider, type DialogueTurn } from '../sim/dialogueProvider';
import type { DialogueContext } from '../sim/npcContext';

/**
 * The OpenAI-backed provider, client side.
 *
 * Notice what is *not* here: no key, no model name, no OpenAI endpoint. This
 * talks to EDEN's own `/api/dialogue` and nothing else, because everything in
 * `src/` is compiled into a bundle any player can read. The secret lives in the
 * server process; see `server/dialogue.mjs`.
 *
 * Every failure path returns null rather than throwing. A missing key, a dead
 * server, an exhausted quota, a timeout, a malformed response — all of them
 * mean the same thing to the game, which is "speak in your own voice", and none
 * of them may interrupt a conversation the player is having.
 */
export class OpenAIDialogueProvider implements DialogueProvider {
  readonly id = 'openai' as const;

  async turn(context: DialogueContext, signal?: AbortSignal): Promise<DialogueTurn | null> {
    // If we already know there is no server or no key, do not ask. It saves a
    // round trip, makes the fallback instant instead of waiting out a timeout,
    // and — the visible part — stops the browser console filling with failed
    // requests for a feature the player is not using.
    if (statusCache && !statusCache.available) return null;

    // Own timeout, so a slow server cannot leave the player waiting on a line
    // that will never arrive. The caller's signal is honoured as well.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DIALOGUE.requestTimeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    try {
      const res = await fetch('/api/dialogue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(context),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { turn?: unknown };
      // Validated again on this side. The server checks too, but a client that
      // trusts whatever came back over the wire is a client with no boundary.
      return validateTurn(body.turn, 'openai');
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

/** Is the remote provider configured and reachable? Cached after the first ask. */
let statusCache: { available: boolean; model: string | null } | null = null;

export async function dialogueProviderStatus(force = false): Promise<{ available: boolean; model: string | null }> {
  // Probed lazily — on demand from developer tooling, or the first time the
  // remote provider is actually selected. Never at boot: a player who has no
  // dialogue server should not see a failed request for one.
  if (statusCache && !force) return statusCache;
  try {
    const res = await fetch('/api/dialogue/status', { method: 'GET' });
    if (!res.ok) throw new Error('status');
    const body = (await res.json()) as { available?: boolean; model?: string | null };
    statusCache = { available: Boolean(body.available), model: body.model ?? null };
  } catch {
    // No server running is the ordinary case during offline development, not an
    // error worth surfacing anywhere but the developer overlay.
    statusCache = { available: false, model: null };
  }
  return statusCache;
}
