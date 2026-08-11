import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { getWorld, initWorld } from './sim';
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
installInput();
startLoop();

// Debug hook for the console and automated smoke tests.
(window as unknown as Record<string, unknown>).__EDEN__ = { useUI, getWorld };

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
