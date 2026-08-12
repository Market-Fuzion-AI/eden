import { WORLD } from './config';
import { regionWeights } from './regions';
import { smoothstep } from './vec';

/**
 * Analytic heightfield shared by simulation (movement, spawning) and rendering
 * (terrain mesh). Deterministic for a given seed so worlds are reproducible.
 *
 * The land is built from a common valley floor plus three region terms —
 * riverlands, ashlands and skyreach — blended by `regionWeights`. Because the
 * same function answers for both the sim and the mesh, what the player walks on
 * is always exactly what they see.
 */

/**
 * The terrain seed. Still module-level, because `heightAt` is called tens of
 * thousands of times per mesh build and per simulation second, and threading a
 * seed through every call site would cost more than it buys.
 *
 * The v0.4 hazard — creating a second world silently re-seeding the landscape
 * under the first — is now closed from the inside: `createWorld` sets it, and
 * `simTick` re-asserts it from the world being ticked on every step, so two
 * interleaved worlds can no longer read each other's terrain. Code that reads
 * heights for a specific world *without* ticking it (tooling, some tests) must
 * still call `setTerrainSeed(world.seed)` first.
 */
let SEED = 1337;

export function setTerrainSeed(seed: number): void {
  SEED = seed >>> 0;
}

/** Which seed the terrain functions are currently answering for. */
export function terrainSeed(): number {
  return SEED;
}

function hash2(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263 + SEED * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smootherstep01(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 2D value noise in [-1, 1]. */
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smootherstep01(x - ix);
  const fz = smootherstep01(z - iz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return (top + (bot - top) * fz) * 2 - 1;
}

export function fbm(x: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += vnoise(x * freq, z * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.13;
  }
  return sum / norm;
}

/**
 * River centerline: x position as a function of z. The river runs through the
 * Human Riverlands rather than down the middle of the map, so water is part of
 * what makes the human region recognisable from a distance.
 */
export function riverX(z: number): number {
  return 50 + 18 * Math.sin(z * 0.011) + 8 * Math.sin(z * 0.027 + 1.7);
}

/** The lake below Human Landing: the single biggest readable water feature. */
export const LAKE = { x: 60, z: 70, radius: 32 };

export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const w = regionWeights(x, z);

  // --- common valley floor ------------------------------------------------
  let h = fbm(x * 0.013, z * 0.013, 3) * 4.4 + 1.9;
  h += fbm(x * 0.055, z * 0.055, 2) * 0.9;

  // --- Caelari Skyreach: a high plateau with terraced cliff steps ---------
  if (w.skyreach > 0.001) {
    const lift = 34 * w.skyreach * w.skyreach;
    // Quantizing the noise turns smooth hills into stepped shelves, which is
    // what reads as cliffs rather than as a big lump. Two scales: broad
    // terraces you can see across the region, and smaller ledges at walking
    // scale — with only the coarse term the plateau top was a featureless grey
    // plain with nothing to climb, stand on or navigate by.
    const terrace = Math.round(fbm(x * 0.017 + 11, z * 0.017 - 4, 3) * 3) / 3;
    const ledge = Math.round(fbm(x * 0.048 - 23, z * 0.048 + 9, 2) * 4) / 4;
    h += lift + (terrace * 11 + ledge * 4.5) * w.skyreach;
  }

  // --- Veyra Ashlands: mesa tops and cut canyons --------------------------
  if (w.ashlands > 0.001) {
    const mesa = Math.round(fbm(x * 0.021 - 31, z * 0.021 + 17, 2) * 2.5) / 2.5;
    h += (5.5 + mesa * 7) * w.ashlands;
    // A canyon system cut into the mesas, deep enough to walk down into.
    const canyon = Math.abs(fbm(x * 0.012 + 60, z * 0.012 - 22, 2));
    h -= smoothstep(0.16, 0, canyon) * 9 * w.ashlands;
  }

  // --- Human Riverlands: kept low, open and walkable ----------------------
  if (w.riverlands > 0.001) {
    // A touch of lift keeps the green plain comfortably clear of the waterline,
    // so the Riverlands read as fertile ground rather than as marsh.
    h += 0.8 * w.riverlands;
    // The lake basin.
    const ld = Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.radius;
    if (ld < 1) h -= 7.5 * (1 - smoothstep(0, 1, ld));
  }

  // --- mountain rim bounding the valley -----------------------------------
  const rim = smoothstep(WORLD.rimStart, WORLD.rimEnd, r);
  h += rim * rim * 62 + rim * (fbm(x * 0.02, z * 0.02, 3) * 0.5 + 0.5) * 26;

  // --- river carve (suppressed inside the rim) ----------------------------
  const d = Math.abs(x - riverX(z));
  h -= 7 * Math.exp(-(d * d) / (2 * 9 * 9)) * (1 - rim);
  return h;
}

export function isWater(x: number, z: number): boolean {
  return heightAt(x, z) < WORLD.waterLevel - 0.1;
}

/** Ground height for characters: wading depth is clamped so nobody sinks into the riverbed. */
export function groundY(x: number, z: number): number {
  return Math.max(heightAt(x, z), WORLD.waterLevel - 0.55);
}

/** Approximate slope magnitude (for terrain coloring and traversability). */
export function slopeAt(x: number, z: number): number {
  const e = 1.2;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

/**
 * Can a walking agent stand here?
 *
 * Height alone is the wrong test now that a whole region sits thirty metres up:
 * it would have declared the entire Skyreach uninhabitable and left the Caelari
 * with nowhere to spawn. What actually stops an agent is steepness.
 */
export function isWalkable(x: number, z: number): boolean {
  if (isWater(x, z)) return false;
  if (Math.hypot(x, z) > WORLD.playRadius - 6) return false;
  return slopeAt(x, z) < 0.85;
}
