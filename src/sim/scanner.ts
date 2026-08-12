import { SCANNER } from './config';
import { MATERIALS, materialForNodeType } from './fabrication';
import { placeName } from './landmarks';
import type { MaterialId, World } from './types';
import { dist } from './vec';

/**
 * Pathfinder Scanner Mk I — the payoff of the first loop.
 *
 * A deliberate, bounded pulse rather than permanent world highlighting. It
 * answers "is there anything useful near me?", which keeps exploration alive;
 * it does not answer "where is every crystal in the Skyreach", which would end
 * it. Range is local, the highlight expires, and there is a cooldown.
 */

export type ScanRefusal = 'locked' | 'cooling' | 'dead';

export interface ScanResult {
  ok: boolean;
  reason?: ScanRefusal;
  /** Node ids lit by this sweep. */
  found: string[];
  /** Per-material tallies, for ARI's report. */
  counts: Partial<Record<MaterialId, number>>;
  /** True when an energy cell was spent to force an early, longer sweep. */
  boosted: boolean;
  radius: number;
}

/** Seconds until the scanner can fire again, or 0 when it is ready. */
export function scanCooldownRemaining(world: World): number {
  const p = world.player;
  if (!p.unlocks.scanner) return 0;
  return Math.max(0, p.scan.lastAt + SCANNER.cooldown - world.timeSec);
}

export function scannerReady(world: World): boolean {
  return world.player.unlocks.scanner && scanCooldownRemaining(world) <= 0;
}

/** True when firing right now would spend an energy cell. */
export function scanWouldSpendCell(world: World): boolean {
  const p = world.player;
  return p.unlocks.scanner && scanCooldownRemaining(world) > 0 && p.items.energyCell > 0;
}

/**
 * Fire the scanner.
 *
 * While cooling, an energy cell may be discharged into it for an immediate
 * sweep at extended range — which is the Energy Cell's current use, and the
 * reason it is worth fabricating before any equipment exists to take one.
 */
export function performScan(world: World): ScanResult {
  const p = world.player;
  const empty: ScanResult = { ok: false, found: [], counts: {}, boosted: false, radius: 0 };
  if (p.dead) return { ...empty, reason: 'dead' };
  if (!p.unlocks.scanner) return { ...empty, reason: 'locked' };

  let boosted = false;
  if (scanCooldownRemaining(world) > 0) {
    if (p.items.energyCell < 1) return { ...empty, reason: 'cooling' };
    p.items.energyCell -= 1;
    boosted = true;
  }

  const radius = boosted ? SCANNER.boostedRadius : SCANNER.radius;
  const found: string[] = [];
  const counts: Partial<Record<MaterialId, number>> = {};
  for (const node of world.resources) {
    const def = materialForNodeType(node.type);
    // A worked-out seam has no signature left to detect.
    if (!def || node.quantity < 1) continue;
    if (dist(node.pos, p.pos) > radius) continue;
    found.push(node.id);
    counts[def.id] = (counts[def.id] ?? 0) + 1;
    node.discovered = true;
  }

  p.scan.lastAt = world.timeSec;
  p.scan.activeUntil = world.timeSec + (boosted ? SCANNER.boostedHighlight : SCANNER.highlight);
  p.scan.nodeIds = found;
  p.scan.radius = radius;
  p.scan.pulseStartedAt = world.timeSec;

  world.ariQueue.push(describeScan(world, counts, boosted, radius));
  return { ok: true, found, counts, boosted, radius };
}

/** ARI's read-out. Names what was found, or plainly says nothing was. */
function describeScan(
  world: World,
  counts: Partial<Record<MaterialId, number>>,
  boosted: boolean,
  radius: number,
): string {
  const parts: string[] = [];
  for (const id of Object.keys(counts) as MaterialId[]) {
    const n = counts[id]!;
    parts.push(`${n} ${MATERIALS[id].name}${n === 1 ? '' : ' signatures'}`);
  }
  const prefix = boosted ? 'Cell discharged — extended sweep. ' : '';
  if (parts.length === 0) {
    return `${prefix}No usable material signatures within ${Math.round(radius)} metres of ${placeName(world.player.pos)}.`;
  }
  return `${prefix}${parts.join(', ')} within range.`;
}

/** Node ids currently lit. Empty once the highlight has expired. */
export function activeScanIds(world: World): string[] {
  const p = world.player;
  if (world.timeSec >= p.scan.activeUntil) return [];
  return p.scan.nodeIds;
}

/**
 * Expire the highlight and drop nodes that have since been worked out, so the
 * scanner never keeps pointing at an empty seam.
 */
export function scanTick(world: World): void {
  const p = world.player;
  if (p.scan.nodeIds.length === 0) return;
  if (world.timeSec >= p.scan.activeUntil) {
    p.scan.nodeIds = [];
    return;
  }
  p.scan.nodeIds = p.scan.nodeIds.filter((id) => {
    const node = world.resources.find((r) => r.id === id);
    return Boolean(node) && node!.quantity >= 1;
  });
}
