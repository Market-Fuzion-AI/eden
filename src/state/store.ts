import { create } from 'zustand';
import type { DialogueExchange } from '../sim/dialogue';
import type { TemporalSummary } from '../sim/summary';
import type { ChronicleEvent } from '../sim/types';

/**
 * UI-reactive state only. The simulation itself lives in src/sim (mutable,
 * outside React). Panels re-render off `uiPulse` (bumped ~5 Hz by the loop)
 * and structural versions — never per sim tick.
 */

export type Mode = 'live' | 'creator';
export type SimSpeed = 1 | 5 | 20;

/** A request for the Creator camera to fly to a world position. */
export interface FocusRequest {
  x: number;
  z: number;
  /** Incremented per request so repeat clicks on the same spot still fire. */
  nonce: number;
}

interface UIState {
  mode: Mode;
  paused: boolean;
  speed: SimSpeed;
  selectedId: string | null;
  selectedEvent: ChronicleEvent | null;
  /** Open relationship drill-down: [subject, other]. */
  relationshipPair: [string, string] | null;
  /** Draw relationship links from the selected settler in the 3D world. */
  showSocialLinks: boolean;
  focusRequest: FocusRequest | null;
  uiPulse: number;
  entitiesVersion: number;
  resourcesVersion: number;
  structuresVersion: number;
  /** Structure open in the Creator inspector. */
  selectedStructureId: string | null;
  ariLine: string | null;
  dialogue: DialogueExchange | null;
  summary: TemporalSummary | null;
  helpOpen: boolean;
  /** True once the player has used mouse-look — retires the teaching prompt. */
  learnedLook: boolean;
  debugOpen: boolean;
  chronicleOpen: boolean;
  spawnFoodArmed: boolean;
  pointerLocked: boolean;
  seed: number;

  setMode(mode: Mode): void;
  setPaused(paused: boolean): void;
  setSpeed(speed: SimSpeed): void;
  select(id: string | null): void;
  selectEvent(event: ChronicleEvent | null): void;
  openRelationship(subjectId: string, otherId: string): void;
  closeRelationship(): void;
  toggleSocialLinks(): void;
  requestFocus(x: number, z: number): void;
  bumpPulse(): void;
  bumpEntities(): void;
  bumpResources(): void;
  bumpStructures(): void;
  selectStructure(id: string | null): void;
  setAriLine(line: string | null): void;
  openDialogue(d: DialogueExchange): void;
  closeDialogue(): void;
  setSummary(s: TemporalSummary | null): void;
  setHelpOpen(open: boolean): void;
  setLearnedLook(v: boolean): void;
  toggleDebug(): void;
  toggleChronicle(): void;
  setSpawnFoodArmed(armed: boolean): void;
  setPointerLocked(locked: boolean): void;
  setSeed(seed: number): void;
}

let focusNonce = 0;

export const useUI = create<UIState>((set) => ({
  mode: 'live',
  paused: false,
  speed: 1,
  selectedId: null,
  selectedEvent: null,
  relationshipPair: null,
  showSocialLinks: true,
  focusRequest: null,
  uiPulse: 0,
  entitiesVersion: 0,
  resourcesVersion: 0,
  structuresVersion: 0,
  selectedStructureId: null,
  ariLine: null,
  dialogue: null,
  summary: null,
  helpOpen: false,
  learnedLook: localStorage.getItem('eden.learnedLook') === '1',
  debugOpen: false,
  chronicleOpen: true,
  spawnFoodArmed: false,
  pointerLocked: false,
  seed: 0,

  setMode: (mode) => set({ mode, spawnFoodArmed: false, summary: null }),
  setPaused: (paused) => set({ paused }),
  setSpeed: (speed) => set({ speed, paused: false }),
  // Choosing a new subject supersedes whatever was being read about the old
  // one — both the relationship drill-down and any open event.
  select: (selectedId) =>
    set({ selectedId, relationshipPair: null, selectedEvent: null, selectedStructureId: null }),
  selectEvent: (selectedEvent) => set({ selectedEvent }),
  openRelationship: (subjectId, otherId) => set({ relationshipPair: [subjectId, otherId], selectedEvent: null }),
  closeRelationship: () => set({ relationshipPair: null }),
  toggleSocialLinks: () => set((s) => ({ showSocialLinks: !s.showSocialLinks })),
  requestFocus: (x, z) => set({ focusRequest: { x, z, nonce: ++focusNonce } }),
  bumpPulse: () => set((s) => ({ uiPulse: s.uiPulse + 1 })),
  bumpEntities: () => set((s) => ({ entitiesVersion: s.entitiesVersion + 1 })),
  bumpResources: () => set((s) => ({ resourcesVersion: s.resourcesVersion + 1 })),
  bumpStructures: () => set((s) => ({ structuresVersion: s.structuresVersion + 1 })),
  selectStructure: (selectedStructureId) =>
    set({ selectedStructureId, selectedId: null, selectedEvent: null, relationshipPair: null }),
  setAriLine: (ariLine) => set({ ariLine }),
  openDialogue: (dialogue) => set({ dialogue }),
  closeDialogue: () => set({ dialogue: null }),
  setSummary: (summary) => set({ summary }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setLearnedLook: (learnedLook) => {
    localStorage.setItem('eden.learnedLook', learnedLook ? '1' : '0');
    set({ learnedLook });
  },
  toggleDebug: () => set((s) => ({ debugOpen: !s.debugOpen })),
  toggleChronicle: () => set((s) => ({ chronicleOpen: !s.chronicleOpen })),
  setSpawnFoodArmed: (spawnFoodArmed) => set({ spawnFoodArmed }),
  setPointerLocked: (pointerLocked) => set({ pointerLocked }),
  setSeed: (seed) => set({ seed }),
}));
