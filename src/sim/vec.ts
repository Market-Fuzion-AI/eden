/** Minimal 2D ground-plane math. The sim reasons in XZ; Y comes from the terrain. */
export interface V2 {
  x: number;
  z: number;
}

export const v2 = (x: number, z: number): V2 => ({ x, z });
export const dist = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.z - b.z);
export const dist2 = (a: V2, b: V2) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const len = (a: V2) => Math.hypot(a.x, a.z);

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export const clamp01 = (v: number) => clamp(v, 0, 1);
export const clamp100 = (v: number) => clamp(v, 0, 100);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Shortest-path angle interpolation. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp01(t);
}

export function angleTo(from: V2, to: V2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}
