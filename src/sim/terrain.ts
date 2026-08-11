import { WORLD } from './config';
import { smoothstep } from './vec';

/**
 * Analytic heightfield shared by simulation (movement, spawning) and rendering
 * (terrain mesh). Deterministic for a given seed so worlds are reproducible.
 */

let SEED = 1337;

export function setTerrainSeed(seed: number): void {
  SEED = seed >>> 0;
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

/** River centerline: x position as a function of z (river flows north→south). */
export function riverX(z: number): number {
  return 24 * Math.sin(z * 0.011) + 10 * Math.sin(z * 0.027 + 1.7);
}

const HILL = { x: -48, z: -95, radius: 44, height: 11 };

export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  // Rolling valley floor — kept mostly above the water line so only the river
  // and a few ponds are wet.
  let h = fbm(x * 0.013, z * 0.013, 3) * 5.5 + 1.7;
  h += fbm(x * 0.055, z * 0.055, 2) * 1.0;
  // Caelari hill (north).
  const hd = Math.hypot(x - HILL.x, z - HILL.z) / HILL.radius;
  if (hd < 1) h += HILL.height * (1 - smoothstep(0, 1, hd));
  // Mountain rim bounding the valley.
  const rim = smoothstep(WORLD.rimStart, WORLD.rimEnd, r);
  h += rim * rim * 62 + rim * (fbm(x * 0.02, z * 0.02, 3) * 0.5 + 0.5) * 26;
  // River carve (suppressed inside the rim).
  const d = Math.abs(x - riverX(z));
  h -= 6.5 * Math.exp(-(d * d) / (2 * 9 * 9)) * (1 - rim);
  return h;
}

export function isWater(x: number, z: number): boolean {
  return heightAt(x, z) < WORLD.waterLevel - 0.1;
}

/** Ground height for characters: wading depth is clamped so nobody sinks into the riverbed. */
export function groundY(x: number, z: number): number {
  return Math.max(heightAt(x, z), WORLD.waterLevel - 0.55);
}

/** Approximate slope magnitude (for terrain coloring). */
export function slopeAt(x: number, z: number): number {
  const e = 1.2;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}
