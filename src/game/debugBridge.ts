import * as THREE from 'three';
import { getWorld } from '../sim';
import * as config from '../sim/config';
import * as creator from '../sim/creator';
import * as goals from '../sim/goals';
import * as rel from '../sim/relationships';
import * as norms from '../sim/norms';
import * as social from '../sim/socialKnowledge';
import * as fabrication from '../sim/fabrication';
import * as scanner from '../sim/scanner';
import * as regions from '../sim/regions';
import * as terrain from '../sim/terrain';
import * as landmarks from '../sim/landmarks';
import * as inspect from '../sim/inspect';
import * as structures from '../sim/structures';
import * as combat from '../sim/combat';
import * as threats from '../sim/threats';
import * as identify from '../sim/identify';
import * as species from '../sim/species';
import * as player from '../sim/player';
import * as course from '../sim/course';
import * as dev from '../sim/dev';
import * as jetpack from '../sim/jetpack';
import * as blaster from '../sim/blaster';
import * as mission from '../sim/mission';
import * as story from '../sim/survivorDialogue';
import * as conversation from '../sim/conversation';
import * as npcContext from '../sim/npcContext';
import * as bindings from './bindings';
import { getInteractions, updatePlayer } from '../sim/player';
import { simTick } from '../sim/simulation';
import { buildSummary, snapshot } from '../sim/summary';
import { useUI } from '../state/store';
import * as input from './input';
import * as camera from './camera';
import { perf } from './loop';

/**
 * Debug bridge exposed on `window.__EDEN__`.
 *
 * This exists so the automated browser smoke test can drive and assert against
 * the real running game — movement basis, terrain stability, fog density —
 * rather than a reimplementation of it. It only reads and steps existing
 * systems; no gameplay logic lives here.
 */

/** Set by Terrain.tsx once its geometry is built. */
let terrainGeometry: THREE.BufferGeometry | null = null;
export function registerTerrainGeometry(geo: THREE.BufferGeometry): void {
  terrainGeometry = geo;
}

/** Set by Environment.tsx each frame so tests can read effective fog. */
let activeFog: THREE.FogExp2 | null = null;
export function registerFog(fog: THREE.FogExp2): void {
  activeFog = fog;
}

/** Set by ScannerFX.tsx so tests can count what the scan actually lit up. */
let scanMarkers: THREE.Group | null = null;
export function registerScanMarkers(group: THREE.Group | null): void {
  scanMarkers = group;
}

/** Set by SocialLinks.tsx so tests can confirm the graph actually draws. */
let socialLinkMesh: THREE.Mesh | null = null;
export function registerSocialLinks(mesh: THREE.Mesh | null): void {
  socialLinkMesh = mesh;
}

/** Stable hash of the terrain's vertex positions — detects any geometry drift. */
function terrainHash(): string {
  if (!terrainGeometry) return 'no-terrain';
  const pos = terrainGeometry.attributes.position as THREE.BufferAttribute;
  let h = 0x811c9dc5;
  for (let i = 0; i < pos.count; i += 7) {
    const y = Math.round(pos.getY(i) * 1000);
    h ^= y;
    h = Math.imul(h, 0x01000193);
  }
  return `${pos.count}:${(h >>> 0).toString(16)}`;
}

export function installDebugBridge(): void {
  (window as unknown as Record<string, unknown>).__EDEN__ = {
    useUI,
    getWorld,
    config,
    input,
    camera,
    sim: { getInteractions },
    player,
    course,
    bindings,
    dev,
    jetpack,
    blaster,
    mission,
    story,
    conversation,
    npcContext,
    creator,
    goals,
    rel,
    structures,
    norms,
    social,
    fabrication,
    scanner,
    combat,
    threats,
    identify,
    species,
    inspect,
    regions,
    terrain,
    landmarks,
    perf,
    terrainHash,
    fogDensity: () => activeFog?.density ?? -1,
    /** How many scan markers are actually being drawn right now. */
    visibleScanMarkers: () => (scanMarkers?.children ?? []).filter((c) => c.visible).length,
    socialLinksVisible: () =>
      Boolean(socialLinkMesh?.visible) && (socialLinkMesh?.geometry.drawRange.count ?? 0) > 0,
    /** Advance only Kai, using current keyboard/camera state. */
    stepPlayer: (dt: number) =>
      updatePlayer(getWorld(), dt, { ...input.readMoveAxes(), camYaw: input.inputState.camYaw }),
    /** Advance only the world simulation by one fixed step. */
    stepSim: (dt: number) => simTick(getWorld(), dt),
    summary: { snapshot, buildSummary },
  };
}
