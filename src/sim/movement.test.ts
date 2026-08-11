import { describe, expect, it } from 'vitest';
import { dirFromHeading, headingFromInput } from './player';
import { heightAt, setTerrainSeed } from './terrain';
import { landmarkAt, placeName, LANDMARKS } from './landmarks';

/**
 * Deterministic validation of the camera-relative movement basis.
 *
 * The chase camera sits behind the player, so on-screen FORWARD is
 * f = (sin yaw, cos yaw) and on-screen RIGHT is r = f × up = (-cos yaw, sin yaw).
 * These tests pin that contract: a regression here is the A/D inversion that
 * shipped in v0.1.
 */

const forward = (yaw: number) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
const right = (yaw: number) => ({ x: -Math.cos(yaw), z: Math.sin(yaw) });

const dot = (a: { x: number; z: number }, b: { x: number; z: number }) => a.x * b.x + a.z * b.z;

const YAWS = [0, 0.7, Math.PI / 2, Math.PI, -Math.PI / 3, 2.4, 5.9];

describe('camera-relative movement basis', () => {
  it('W moves along the camera forward axis at every yaw', () => {
    for (const yaw of YAWS) {
      const d = dirFromHeading(headingFromInput(yaw, 0, 1));
      expect(dot(d, forward(yaw))).toBeCloseTo(1, 6);
    }
  });

  it('S moves opposite the camera forward axis', () => {
    for (const yaw of YAWS) {
      const d = dirFromHeading(headingFromInput(yaw, 0, -1));
      expect(dot(d, forward(yaw))).toBeCloseTo(-1, 6);
    }
  });

  it('D moves toward screen-right — not screen-left', () => {
    for (const yaw of YAWS) {
      const d = dirFromHeading(headingFromInput(yaw, 1, 0));
      expect(dot(d, right(yaw))).toBeCloseTo(1, 6);
      // Explicitly assert the v0.1 inversion cannot come back.
      expect(dot(d, right(yaw))).toBeGreaterThan(0);
    }
  });

  it('A moves toward screen-left', () => {
    for (const yaw of YAWS) {
      const d = dirFromHeading(headingFromInput(yaw, -1, 0));
      expect(dot(d, right(yaw))).toBeCloseTo(-1, 6);
    }
  });

  it('diagonals bisect their two axes', () => {
    for (const yaw of YAWS) {
      const d = dirFromHeading(headingFromInput(yaw, 1, 1));
      expect(dot(d, forward(yaw))).toBeCloseTo(Math.SQRT1_2, 6);
      expect(dot(d, right(yaw))).toBeCloseTo(Math.SQRT1_2, 6);
    }
  });

  it('produces unit-length directions', () => {
    for (const yaw of YAWS) {
      for (const [mx, mz] of [[1, 0], [0, 1], [-1, 0], [0, -1], [0.6, -0.8]]) {
        const d = dirFromHeading(headingFromInput(yaw, mx, mz));
        expect(Math.hypot(d.x, d.z)).toBeCloseTo(1, 9);
      }
    }
  });
});

describe('terrain stability', () => {
  it('is a pure function of position — identical results across repeated sampling', () => {
    setTerrainSeed(4242);
    const sample = () => {
      const out: number[] = [];
      for (let x = -160; x <= 160; x += 23) {
        for (let z = -160; z <= 160; z += 23) out.push(heightAt(x, z));
      }
      return out;
    };
    const first = sample();
    // Thousands of intervening evaluations must not perturb the field.
    for (let i = 0; i < 5000; i++) heightAt(Math.sin(i) * 90, Math.cos(i) * 90);
    expect(sample()).toEqual(first);
  });

  it('reproduces exactly for a given seed and differs across seeds', () => {
    setTerrainSeed(1);
    const a = heightAt(31, -47);
    setTerrainSeed(2);
    const b = heightAt(31, -47);
    setTerrainSeed(1);
    const aAgain = heightAt(31, -47);
    expect(aAgain).toBe(a);
    expect(b).not.toBe(a);
  });
});

describe('landmarks', () => {
  it('names every landmark centre as itself', () => {
    for (const lm of LANDMARKS) {
      expect(landmarkAt(lm.pos)?.id).toBe(lm.id);
      expect(placeName(lm.pos)).toBe(lm.name);
    }
  });

  it('falls back to a readable description outside named places', () => {
    const name = placeName({ x: 145, z: -150 });
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toContain('undefined');
  });
});
