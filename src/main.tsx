import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initWorld } from './sim';
import { applyDevLoadout, devMode } from './sim/dev';
import { setProviderMode, setRemoteProvider } from './sim/conversation';
import { OpenAIDialogueProvider } from './game/openaiDialogue';
import { installDebugBridge } from './game/debugBridge';
import { installInput } from './game/input';
import { startLoop } from './game/loop';
import { useUI } from './state/store';
import './styles.css';

// World seed: persisted so a reload reproduces the same valley (§39).
const stored = localStorage.getItem('eden.seed');
const seed = stored ? Number(stored) : Math.floor(Math.random() * 1_000_000);
localStorage.setItem('eden.seed', String(seed));

const world = initWorld(seed);
useUI.getState().setSeed(seed);

// Developer Mode, if it is on. The check lives here rather than inside the
// grant so Player Mode is the absence of a call, not a branch buried in the
// simulation — see `sim/dev.ts`.
if (devMode()) applyDevLoadout(world);

// First visit: show the compact control card once, then never again.
if (!localStorage.getItem('eden.seenHelp')) {
  localStorage.setItem('eden.seenHelp', '1');
  useUI.getState().setHelpOpen(true);
}

// The remote dialogue provider is installed, not imported by the simulation —
// nothing in src/sim may depend on the network. Which one is actually used is
// decided by the Developer Mode switch; the default is always local, so a build
// with no server behind it behaves exactly as it did before.
setRemoteProvider(new OpenAIDialogueProvider());
setProviderMode('local');

installInput();
installDebugBridge();
startLoop();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
