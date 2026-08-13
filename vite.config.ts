/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Just enough of Node's `ServerResponse` to answer with. Written out rather
 * than imported because this repository has no Node type definitions — the game
 * is a browser bundle, and one config file is not a reason to add them.
 */
interface ProxyResponse {
  writeHead?: (status: number, headers: Record<string, string>) => unknown;
  end?: (body: string) => unknown;
  headersSent?: boolean;
}

/**
 * The dialogue server runs as its own process and is the only thing that holds
 * the OpenAI key. The browser talks to this origin and nothing else, so the
 * secret never reaches anything a player can read.
 *
 * `loadEnv` is what reads the port out of `.env` here — and note that it only
 * ever exposes variables prefixed with `VITE_` to the client bundle.
 * `OPENAI_API_KEY` has no such prefix and therefore cannot be bundled even by
 * accident, which is precisely why the name is what it is.
 *
 * Not running the dialogue server is the ordinary case, not a fault — the game
 * is complete without it. So when there is nothing on the other end, the proxy
 * answers the question honestly ("no provider available") instead of failing
 * with a gateway error the developer then has to interpret.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const dialogueTarget = `http://127.0.0.1:${env.EDEN_DIALOGUE_PORT || 8787}`;
  const proxy: Record<string, ProxyOptions> = {
    '/api': {
      target: dialogueTarget,
      changeOrigin: true,
      configure: (p) => {
        p.on('error', (_err, _req, res) => {
          // `res` is a raw socket for upgrade requests; only answer real ones.
          const out = res as ProxyResponse;
          if (!out.writeHead || !out.end || out.headersSent) return;
          out.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          out.end(JSON.stringify({ available: false, model: null, turn: null, reason: 'no-dialogue-server' }));
        });
      },
    },
  };

  return {
    plugins: [react()],
    base: './',
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
