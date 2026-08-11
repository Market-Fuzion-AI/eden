import type { V2 } from './vec';
import { dist } from './vec';

/**
 * Named places inside the valley. Landmarks give the world location identity:
 * resources are labelled by the place they sit in, agents remember where they
 * have been, ARI announces arrivals, and the Chronicle references real names
 * instead of compass directions.
 *
 * Positions intentionally mirror the worldgen anchors so the geography the
 * player sees and the names they hear always agree.
 */

export interface Landmark {
  id: string;
  name: string;
  /** Short line ARI speaks the first time Emerson arrives. */
  ariLine: string;
  pos: V2;
  radius: number;
}

export const LANDMARKS: Landmark[] = [
  {
    id: 'landing',
    name: 'Landing Meadow',
    ariLine: 'Landing Meadow. Where we came down. It already feels smaller than it did this morning.',
    pos: { x: 70, z: 20 },
    radius: 40,
  },
  {
    id: 'glade',
    name: 'the Glowing Glade',
    ariLine: 'Bioluminescent density here is off my scale. Recording it as the Glowing Glade.',
    pos: { x: -34, z: -26 },
    radius: 34,
  },
  {
    id: 'meadow',
    name: 'the Eastern Meadow',
    ariLine: 'The Eastern Meadow. Open grazing land — the larger native herbivores prefer it.',
    pos: { x: 38, z: -42 },
    radius: 38,
  },
  {
    id: 'wood',
    name: 'the Western Wood',
    ariLine: 'Western Wood. Visibility drops sharply past the treeline — watch your footing.',
    pos: { x: -98, z: 8 },
    radius: 52,
  },
  {
    id: 'ridge',
    name: 'the Northern Ridge',
    ariLine: 'The Northern Ridge. High ground — the Caelari chose it deliberately, I suspect.',
    pos: { x: -48, z: -95 },
    radius: 40,
  },
  {
    id: 'riverbend',
    name: 'the River Bend',
    ariLine: 'River Bend. Fresh water, and something moving beneath the surface.',
    pos: { x: 14, z: 44 },
    radius: 32,
  },
  {
    id: 'rocks',
    name: 'the Stone Fields',
    ariLine: 'The Stone Fields. Exposed mineral seams — useful, eventually.',
    pos: { x: -88, z: 58 },
    radius: 36,
  },
  {
    id: 'crags',
    name: 'the Southern Crags',
    ariLine: 'The Southern Crags. Predator territory. I would not linger here, Emerson.',
    pos: { x: -52, z: 112 },
    radius: 38,
  },
  {
    id: 'veyrahold',
    name: 'the Veyra Hold',
    ariLine: 'The Veyra Hold. They built around a shared hearth. Communal by instinct.',
    pos: { x: -62, z: 78 },
    radius: 26,
  },
];

/** The landmark containing a point, or null if it sits in unnamed wilderness. */
export function landmarkAt(p: V2): Landmark | null {
  let best: Landmark | null = null;
  let bestScore = Infinity;
  for (const lm of LANDMARKS) {
    const d = dist(p, lm.pos);
    if (d > lm.radius) continue;
    // Prefer the landmark whose center is nearest relative to its size, so
    // overlapping regions resolve to the more specific place.
    const score = d / lm.radius;
    if (score < bestScore) {
      best = lm;
      bestScore = score;
    }
  }
  return best;
}

/** Readable place name for any point — falls back to a compass description. */
export function placeName(p: V2): string {
  const lm = landmarkAt(p);
  if (lm) return lm.name;
  const parts: string[] = [];
  if (p.z < -45) parts.push('northern');
  else if (p.z > 45) parts.push('southern');
  if (p.x < -45) parts.push('western');
  else if (p.x > 45) parts.push('eastern');
  if (parts.length === 0) return 'the valley floor';
  return `the ${parts.join('-')} reaches`;
}
