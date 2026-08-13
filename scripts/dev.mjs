/**
 * One development command.
 *
 * Starts the Vite dev server and the dialogue server together, because a
 * two-terminal setup is a setup somebody eventually forgets half of — and the
 * half they forget is the one holding the API key, so the game silently falls
 * back to local dialogue and the day is spent wondering why.
 *
 * Neither process is required by the other. Vite alone plays the whole game;
 * the dialogue server only adds the OpenAI provider, and only if a key is set.
 *
 * Usage:  npm run dev
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const children = [];
const start = (name, command, args) => {
  const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => {
    // If either half dies, take the other with it rather than leaving a
    // half-running development environment behind.
    if (code !== 0 && code !== null) console.error(`[dev] ${name} exited with ${code}`);
    stop();
  });
  children.push(child);
};

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// `--env-file-if-exists` needs Node 20.12+. Fall back to running without it so
// an older Node still starts the game, just without reading .env.
const nodeMajor = Number(process.versions.node.split('.')[0]);
const envArgs = existsSync('.env') && nodeMajor >= 20 ? ['--env-file-if-exists=.env'] : [];
if (existsSync('.env') && nodeMajor < 20) {
  console.warn('[dev] Node 20.12+ is needed to read .env automatically; export OPENAI_API_KEY yourself.');
}

start('dialogue', process.execPath, [...envArgs, 'server/dialogue.mjs']);
start('vite', process.execPath, ['node_modules/vite/bin/vite.js']);
