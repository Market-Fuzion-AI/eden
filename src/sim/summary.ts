import { DAY_SEC } from './config';
import { detectSettlements } from './structures';
import type { World } from './types';

/**
 * Temporal summary: what actually changed while the world ran fast.
 *
 * Every figure is derived from real simulation state and real Chronicle
 * events — nothing is invented. This is the seed of the future macro
 * simulation's "what happened during the jump" report.
 */

export interface WorldSnapshot {
  t: number;
  settlers: number;
  creatures: number;
  chronicleId: number;
  relationships: number;
  knownResources: number;
  structuresComplete: number;
  structuresTotal: number;
  woodRemaining: number;
  stoneRemaining: number;
}

export interface SummaryLine {
  label: string;
  value: string;
}

export interface TemporalSummary {
  elapsedLabel: string;
  populationLines: SummaryLine[];
  eventLines: SummaryLine[];
  /** Construction and place-making during the period. */
  settlementLines: SummaryLine[];
  /** Notable chronicle entries from the period, newest first. */
  highlights: { id: number; text: string }[];
}

export function snapshot(world: World): WorldSnapshot {
  let relationships = 0;
  let knownResources = 0;
  for (const s of world.settlers) {
    relationships += Object.keys(s.relationships).length;
    knownResources += s.knownResourceIds.length;
  }
  const stock = (type: 'wood' | 'stone') =>
    world.resources.filter((r) => r.type === type).reduce((sum, r) => sum + r.quantity, 0);
  return {
    t: world.timeSec,
    settlers: world.settlers.length,
    creatures: world.creatures.length,
    chronicleId: world.chronicleCounter,
    relationships,
    knownResources,
    structuresComplete: world.structures.filter((s) => s.state === 'complete').length,
    structuresTotal: world.structures.length,
    woodRemaining: stock('wood'),
    stoneRemaining: stock('stone'),
  };
}

function elapsedLabel(seconds: number): string {
  const days = seconds / DAY_SEC;
  if (days >= 1) {
    const d = Math.floor(days);
    return `${d} ${d === 1 ? 'DAY' : 'DAYS'} ELAPSED`;
  }
  const hours = (seconds / DAY_SEC) * 24;
  if (hours >= 1) {
    const h = Math.floor(hours);
    return `${h} ${h === 1 ? 'HOUR' : 'HOURS'} ELAPSED`;
  }
  return `${Math.round((seconds / DAY_SEC) * 24 * 60)} MINUTES ELAPSED`;
}

const arrow = (from: number, to: number) => (from === to ? `${from}` : `${from} → ${to}`);

/**
 * Build the summary between a snapshot and the world's current state.
 * Returns null when too little sim time passed to be worth reporting.
 */
export function buildSummary(
  world: World,
  before: WorldSnapshot,
  /** ~2 in-world hours — short enough to catch a brief skip, long enough that
   *  nudging the speed keys never spams a report. */
  minSeconds = DAY_SEC * 0.08,
): TemporalSummary | null {
  const elapsed = world.timeSec - before.t;
  if (elapsed < minSeconds) return null;
  const now = snapshot(world);

  // Only events emitted during the period, counted by category.
  const fresh = world.chronicle.filter((e) => e.id >= before.chronicleId);
  const count = (pred: (text: string, category: string) => boolean) =>
    fresh.filter((e) => pred(e.text, e.category)).length;

  const socialEvents = count((_t, c) => c === 'social');
  const discoveries = count((_t, c) => c === 'discovery');
  const budding = count((t, c) => c === 'wildlife' && t.includes('budded'));
  const deaths = count((t, c) => c === 'wildlife' && t.includes('killed'));
  const conflicts = count((t, c) => (c === 'social' && t.includes('tense')) || (c === 'wildlife' && t.includes('turned on')));

  const highlights = [...fresh]
    .reverse()
    .filter((e) => e.category !== 'system')
    .slice(0, 5)
    .map((e) => ({ id: e.id, text: e.text }));

  // Settlement activity, counted from real events and real stock changes.
  const started = fresh.filter((e) => e.category === 'settlement' && e.text.includes('began building')).length;
  const completed = Math.max(0, now.structuresComplete - before.structuresComplete);
  const cooperative = fresh.filter(
    (e) => e.category === 'settlement' && e.text.includes('with help from'),
  ).length;
  const gatherings = fresh.filter((e) => e.category === 'settlement' && e.text.includes('gathered around')).length;
  const woodUsed = Math.max(0, before.woodRemaining - now.woodRemaining);
  const stoneUsed = Math.max(0, before.stoneRemaining - now.stoneRemaining);

  const settlementLines: SummaryLine[] = [
    { label: 'Structures completed', value: String(completed) },
    { label: 'Structures started', value: String(started) },
    { label: 'Cooperative builds', value: String(cooperative) },
    { label: 'Wood harvested', value: String(Math.round(woodUsed)) },
    { label: 'Stone harvested', value: String(Math.round(stoneUsed)) },
    { label: 'Fireside gatherings', value: String(gatherings) },
  ];
  const clusters = detectSettlements(world);
  if (clusters.length > 0) {
    // Two clusters can sit inside one landmark; name each place once.
    const places = [...new Set(clusters.map((c) => c.place))];
    settlementLines.push({ label: 'Gathering places', value: places.join(', ') });
  }

  return {
    elapsedLabel: elapsedLabel(elapsed),
    settlementLines,
    populationLines: [
      { label: 'Settlers', value: arrow(before.settlers, now.settlers) },
      { label: 'Native life', value: arrow(before.creatures, now.creatures) },
    ],
    eventLines: [
      { label: 'New relationships', value: String(Math.max(0, now.relationships - before.relationships)) },
      { label: 'Conversations', value: String(socialEvents) },
      { label: 'Resource discoveries', value: String(discoveries) },
      { label: 'Budding events', value: String(budding) },
      { label: 'Deaths', value: String(deaths) },
      { label: 'Conflicts', value: String(conflicts) },
    ],
    highlights,
  };
}
