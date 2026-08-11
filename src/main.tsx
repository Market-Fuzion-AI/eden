import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initWorld } from './sim';
import { installDebugBridge } from './game/debugBridge';
import { installInput } from './game/input';
import { startLoop } from './game/loop';
import { useUI } from './state/store';
import './styles.css';

// World seed: persisted so a reload reproduces the same valley (§39).
const stored = localStorage.getItem('eden.seed');
const seed = stored ? Number(stored) : Math.floor(Math.random() * 1_000_000);
localStorage.setItem('eden.seed', String(seed));

initWorld(seed);
useUI.getState().setSeed(seed);

// First visit: show the compact control card once, then never again.
if (!localStorage.getItem('eden.seenHelp')) {
  localStorage.setItem('eden.seenHelp', '1');
  useUI.getState().setHelpOpen(true);
}

installInput();
installDebugBridge();
startLoop();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
