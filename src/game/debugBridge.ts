import * as THREE from 'three';
import { getWorld } from '../sim';
import * as creator from '../sim/creator';
import * as goals from '../sim/goals';
import * as rel from '../sim/relationships';
import * as norms from '../sim/norms';
import * as structures from '../sim/structures';
import { getInteractions, updatePlayer } from '../sim/player';
import { simTick } from '../sim/simulation';
import { buildSummary, snapshot } from '../sim/summary';
import { useUI } from '../state/store';
import * as input from './input';
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
    input,
    sim: { getInteractions },
    creator,
    goals,
    rel,
    structures,
    norms,
    perf,
    terrainHash,
    fogDensity: () => activeFog?.density ?? -1,
    socialLinksVisible: () =>
      Boolean(socialLinkMesh?.visible) && (socialLinkMesh?.geometry.drawRange.count ?? 0) > 0,
    /** Advance only Emerson, using current keyboard/camera state. */
    stepPlayer: (dt: number) =>
      updatePlayer(getWorld(), dt, { ...input.readMoveAxes(), camYaw: input.inputState.camYaw }),
    /** Advance only the world simulation by one fixed step. */
    stepSim: (dt: number) => simTick(getWorld(), dt),
    summary: { snapshot, buildSummary },
  };
}
