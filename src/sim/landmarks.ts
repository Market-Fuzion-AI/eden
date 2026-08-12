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

/**
 * Landmark ids are stable across the v0.7A geography change. Several places
 * were renamed and moved to sit inside their new region, but agents store
 * landmark *ids* in `knownLandmarkIds`, so an existing settler who had visited
 * `landing` still remembers Human Landing rather than losing the memory.
 */
export const LANDMARKS: Landmark[] = [
  // --- Human Riverlands ---------------------------------------------------
  {
    id: 'landing',
    name: 'Human Landing',
    ariLine: 'Human Landing. Where we came down. Everything we have is within a short walk of here.',
    pos: { x: 95, z: 25 },
    radius: 38,
  },
  {
    id: 'riverbend',
    name: 'Riverbend',
    ariLine: 'Riverbend. Fresh water, and something moving beneath the surface.',
    pos: { x: 58, z: -30 },
    radius: 32,
  },
  {
    id: 'greenwater',
    name: 'Greenwater Shore',
    ariLine: 'Greenwater Shore. The lake is deeper than it looks. The colonists will want this ground.',
    pos: { x: 60, z: 70 },
    radius: 36,
  },
  {
    id: 'meadow',
    name: 'the Eastern Meadow',
    ariLine: 'The Eastern Meadow. Open grazing land — the larger native herbivores prefer it.',
    pos: { x: 112, z: 60 },
    radius: 36,
  },
  // --- between the regions ------------------------------------------------
  {
    id: 'glade',
    name: 'the Glowing Glade',
    ariLine: 'Bioluminescent density here is off my scale. Recording it as the Glowing Glade.',
    pos: { x: -6, z: -18 },
    radius: 34,
  },
  {
    id: 'wood',
    name: 'the Western Wood',
    ariLine: 'Western Wood. Visibility drops sharply past the treeline — watch your footing.',
    pos: { x: -40, z: 22 },
    radius: 44,
  },
  // --- Veyra Ashlands -----------------------------------------------------
  {
    id: 'ashpass',
    name: 'Ash Pass',
    ariLine: 'Ash Pass. The green stops here. Ground temperature is climbing.',
    pos: { x: -58, z: 44 },
    radius: 32,
  },
  {
    id: 'veyrahold',
    name: 'the Veyra Basin',
    ariLine: 'The Veyra Basin. They built around a shared hearth. Communal by instinct.',
    pos: { x: -88, z: 86 },
    radius: 30,
  },
  {
    id: 'rocks',
    name: 'the Redstone Shelf',
    ariLine: 'The Redstone Shelf. Exposed mineral seams — useful, eventually.',
    pos: { x: -118, z: 52 },
    radius: 34,
  },
  {
    id: 'crags',
    name: 'the Southern Crags',
    ariLine: 'The Southern Crags. Predator territory. I would not linger here, Emerson.',
    pos: { x: -46, z: 118 },
    radius: 36,
  },
  // --- between the Ashlands and the Skyreach -------------------------------
  {
    id: 'sunkenring',
    name: 'the Sunken Ring',
    ariLine:
      'Emerson, stop. These pylons are not ours. They are not Veyra or Caelari either, and the weathering says they have been here far longer than any of us.',
    pos: { x: -86, z: -14 },
    radius: 30,
  },
  // --- Caelari Skyreach ---------------------------------------------------
  {
    id: 'skyapproach',
    name: 'Skyreach Approach',
    ariLine: 'Skyreach Approach. The climb starts here. Mind your footing on the shelves.',
    pos: { x: -34, z: -58 },
    radius: 32,
  },
  {
    id: 'ridge',
    name: 'Highwind Ridge',
    ariLine: 'Highwind Ridge. The wind up here never stops. You can see most of the valley from it.',
    pos: { x: -96, z: -62 },
    radius: 36,
  },
  {
    id: 'heights',
    name: 'the Caelari Heights',
    ariLine: 'The Caelari Heights. High ground — they chose it deliberately, I suspect.',
    pos: { x: -60, z: -102 },
    radius: 38,
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
