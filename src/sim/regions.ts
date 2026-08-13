import { smoothstep, type V2 } from './vec';

/**
 * The three biome regions of Eden.
 *
 * One bounded valley, three readable environments. Regions are an analytic
 * field rather than a painted map: `regionWeights` is a cheap pure function of
 * position that both the simulation and the renderer read, so the shape of the
 * land, its colour, its vegetation and the names the player hears can never
 * drift out of agreement.
 *
 * Nothing here gates behaviour. Regions bias where each people *starts* and
 * what the ground looks like; settlers remain free to walk anywhere, and
 * routinely do.
 */

export type RegionId = 'riverlands' | 'ashlands' | 'skyreach' | 'wilds';

export interface Region {
  id: Exclude<RegionId, 'wilds'>;
  name: string;
  /** Short form used in the compass and HUD. */
  shortName: string;
  pos: V2;
  /** Distance at which this region's influence has faded to nothing. */
  radius: number;
  /** First-entry line, spoken by ARI once. */
  ariLine: string;
}

export const REGIONS: Region[] = [
  {
    id: 'riverlands',
    name: 'the Human Riverlands',
    shortName: 'Riverlands',
    pos: { x: 86, z: 30 },
    radius: 132,
    ariLine:
      'Human Riverlands. Fresh water, workable ground, and the landing wreck for a landmark. This is home, Kai.',
  },
  {
    id: 'ashlands',
    name: 'the Veyra Ashlands',
    shortName: 'Ashlands',
    pos: { x: -88, z: 86 },
    radius: 112,
    ariLine: 'Entering the Ashlands. Dry, mineral-rich, considerably warmer. Veyra activity ahead.',
  },
  {
    id: 'skyreach',
    name: 'the Caelari Skyreach',
    shortName: 'Skyreach',
    pos: { x: -60, z: -96 },
    radius: 118,
    ariLine: 'Elevation increasing. Caelari structures along the ridge. They chose the high ground deliberately.',
  },
];

export const REGION_BY_ID: Record<string, Region> = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

export interface RegionWeights {
  riverlands: number;
  ashlands: number;
  skyreach: number;
  /** Whatever is left over — unclaimed valley floor between the three. */
  wilds: number;
}

/**
 * How strongly each region claims this point. Weights sum to 1.
 *
 * Deliberately soft-edged: the transitions are wide enough to walk through and
 * notice, which is what makes the geography readable without labels.
 */
export function regionWeights(x: number, z: number): RegionWeights {
  let river = 0;
  let ash = 0;
  let sky = 0;
  for (const r of REGIONS) {
    const d = Math.hypot(x - r.pos.x, z - r.pos.z);
    // 1 at the heart of the region, easing to 0 at its radius.
    const w = 1 - smoothstep(r.radius * 0.28, r.radius, d);
    if (r.id === 'riverlands') river = w;
    else if (r.id === 'ashlands') ash = w;
    else sky = w;
  }
  const claimed = river + ash + sky;
  if (claimed <= 0) return { riverlands: 0, ashlands: 0, skyreach: 0, wilds: 1 };
  // Normalize where regions overlap; keep the remainder as open valley.
  const scale = claimed > 1 ? 1 / claimed : 1;
  const rw = river * scale;
  const aw = ash * scale;
  const sw = sky * scale;
  return { riverlands: rw, ashlands: aw, skyreach: sw, wilds: Math.max(0, 1 - rw - aw - sw) };
}

/** The region a point most belongs to — `wilds` when none dominates. */
export function regionAt(x: number, z: number): RegionId {
  const w = regionWeights(x, z);
  let best: RegionId = 'wilds';
  let bestW = 0.34; // must actually dominate to claim the ground
  if (w.riverlands > bestW) {
    best = 'riverlands';
    bestW = w.riverlands;
  }
  if (w.ashlands > bestW) {
    best = 'ashlands';
    bestW = w.ashlands;
  }
  if (w.skyreach > bestW) {
    best = 'skyreach';
    bestW = w.skyreach;
  }
  return best;
}

export function regionName(id: RegionId): string {
  return id === 'wilds' ? 'the open valley' : REGION_BY_ID[id].name;
}

export function regionShortName(id: RegionId): string {
  return id === 'wilds' ? 'Open Valley' : REGION_BY_ID[id].shortName;
}

/** Where each people first made camp. They are not confined to it. */
export const SPECIES_REGION: Record<string, Exclude<RegionId, 'wilds'>> = {
  human: 'riverlands',
  veyra: 'ashlands',
  caelari: 'skyreach',
};
