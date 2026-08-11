import { create } from 'zustand';

/**
 * UI-reactive state only. The simulation itself lives in src/sim (mutable,
 * outside React). Panels re-render off `uiPulse` (bumped ~5 Hz by the loop)
 * and structural versions — never per sim tick.
 */

export type Mode = 'live' | 'creator';
export type SimSpeed = 1 | 5 | 20;

interface UIState {
  mode: Mode;
  paused: boolean;
  speed: SimSpeed;
  selectedId: string | null;
  uiPulse: number;
  entitiesVersion: number;
  resourcesVersion: number;
  ariLine: string | null;
  helpOpen: boolean;
  debugOpen: boolean;
  chronicleOpen: boolean;
  spawnFoodArmed: boolean;
  pointerLocked: boolean;
  seed: number;

  setMode(mode: Mode): void;
  setPaused(paused: boolean): void;
  setSpeed(speed: SimSpeed): void;
  select(id: string | null): void;
  bumpPulse(): void;
  bumpEntities(): void;
  bumpResources(): void;
  setAriLine(line: string | null): void;
  setHelpOpen(open: boolean): void;
  toggleDebug(): void;
  toggleChronicle(): void;
  setSpawnFoodArmed(armed: boolean): void;
  setPointerLocked(locked: boolean): void;
  setSeed(seed: number): void;
}

export const useUI = create<UIState>((set) => ({
  mode: 'live',
  paused: false,
  speed: 1,
  selectedId: null,
  uiPulse: 0,
  entitiesVersion: 0,
  resourcesVersion: 0,
  ariLine: null,
  helpOpen: false,
  debugOpen: false,
  chronicleOpen: true,
  spawnFoodArmed: false,
  pointerLocked: false,
  seed: 0,

  setMode: (mode) => set({ mode, spawnFoodArmed: false }),
  setPaused: (paused) => set({ paused }),
  setSpeed: (speed) => set({ speed, paused: false }),
  select: (selectedId) => set({ selectedId }),
  bumpPulse: () => set((s) => ({ uiPulse: s.uiPulse + 1 })),
  bumpEntities: () => set((s) => ({ entitiesVersion: s.entitiesVersion + 1 })),
  bumpResources: () => set((s) => ({ resourcesVersion: s.resourcesVersion + 1 })),
  setAriLine: (ariLine) => set({ ariLine }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  toggleDebug: () => set((s) => ({ debugOpen: !s.debugOpen })),
  toggleChronicle: () => set((s) => ({ chronicleOpen: !s.chronicleOpen })),
  setSpawnFoodArmed: (spawnFoodArmed) => set({ spawnFoodArmed }),
  setPointerLocked: (pointerLocked) => set({ pointerLocked }),
  setSeed: (seed) => set({ seed }),
}));
