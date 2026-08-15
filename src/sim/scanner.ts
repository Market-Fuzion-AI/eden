import { SCANNER } from './config';
import { noteScan } from './firstLight';
import { MATERIALS, materialForNodeType } from './fabrication';
import { placeName } from './landmarks';
import { CREATURE_SPECIES_BY_ID } from './species';
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
  /** Dangerous life in range, split by what it is made of. */
  threats: { biological: number; synthetic: number };
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
  const empty: ScanResult = {
    ok: false,
    found: [],
    counts: {},
    boosted: false,
    radius: 0,
    threats: { biological: 0, synthetic: 0 },
  };
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

  // The sweep also reads life, which is the difference between knowing there
  // is ore over the ridge and knowing what is standing on top of it.
  const threats = { biological: 0, synthetic: 0 };
  for (const c of world.creatures) {
    const def = CREATURE_SPECIES_BY_ID[c.speciesId];
    if (!def.dangerous) continue;
    if (dist(c.pos, p.pos) > radius) continue;
    if (def.synthetic) threats.synthetic += 1;
    else threats.biological += 1;
  }

  p.scan.lastAt = world.timeSec;
  p.scan.activeUntil = world.timeSec + (boosted ? SCANNER.boostedHighlight : SCANNER.highlight);
  p.scan.nodeIds = found;
  p.scan.radius = radius;
  p.scan.pulseStartedAt = world.timeSec;

  world.ariQueue.push(describeScan(world, counts, boosted, radius, threats));
  // The opening asks Kai to sweep the crash site once. This is that sweep —
  // the mechanic is untouched, First Light just notices it happened.
  noteScan(world);
  // Scanning at the ring itself gets one extra observation, once. It deepens
  // the implication without answering anything: EDEN still never says what the
  // site is, who built it, or what the Wardens are guarding.
  if (threats.synthetic > 0 && !world.flags.scannedRing) {
    const nearRing = Math.hypot(p.pos.x + 86, p.pos.z + 14) < 45;
    if (nearRing) {
      world.flags.scannedRing = true;
      world.ariQueue.push(
        'Deeper read on the site: the metallurgy is not colony work and it is not Veyra or Caelari either. Age estimate failed — the isotope spread is wider than my model has a bracket for. There are inactive systems under the soil, and the machine above them is running in phase with something down there.',
      );
    }
  }
  return { ok: true, found, counts, boosted, radius, threats };
}

/** ARI's read-out. Names what was found, or plainly says nothing was. */
function describeScan(
  world: World,
  counts: Partial<Record<MaterialId, number>>,
  boosted: boolean,
  radius: number,
  threats: { biological: number; synthetic: number },
): string {
  const parts: string[] = [];
  for (const id of Object.keys(counts) as MaterialId[]) {
    const n = counts[id]!;
    parts.push(`${n} ${MATERIALS[id].name}${n === 1 ? '' : ' signatures'}`);
  }
  const prefix = boosted ? 'Cell discharged — extended sweep. ' : '';
  // The warning goes last, so it is the sentence the player is left holding.
  const warn: string[] = [];
  if (threats.biological > 0) {
    warn.push(`${threats.biological} large biological signature${threats.biological === 1 ? '' : 's'}`);
  }
  if (threats.synthetic > 0) {
    warn.push(`${threats.synthetic} synthetic power source${threats.synthetic === 1 ? '' : 's'}`);
  }
  const tail = warn.length > 0 ? ` Also reading ${warn.join(' and ')} — be careful.` : '';
  if (parts.length === 0) {
    return `${prefix}No usable material signatures within ${Math.round(radius)} metres of ${placeName(world.player.pos)}.${tail}`;
  }
  return `${prefix}${parts.join(', ')} within range.${tail}`;
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
