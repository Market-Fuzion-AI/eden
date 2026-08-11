import { getEntity, getWorld } from './index';
import { LANDMARKS, placeName } from './landmarks';
import { memoryText } from './memory';
import { CREATURE_SPECIES_BY_ID, INTELLIGENT_SPECIES } from './species';
import type { IntelligentSpeciesId } from './types';
import { dist } from './vec';

/**
 * Builds the structured data shown by the Creator Mode inspector.
 * UI-facing formatting lives here so panels stay dumb.
 */

export interface InspectorBar {
  label: string;
  value: number; // 0..100
  tone?: 'good' | 'warn' | 'bad' | 'accent';
}

export interface InspectorData {
  id: string;
  name: string;
  subtitle: string;
  kindLabel: string;
  /** Where the entity currently is, by landmark name. */
  place: string;
  vitals: InspectorBar[];
  goal: { label: string; reason: string[] };
  scores: { goal: string; score: number }[];
  personality: InspectorBar[];
  needs: InspectorBar[];
  trust?: { label: string; value: number };
  relationships: { name: string; affinity: number; interactions: number }[];
  memories: { text: string; ago: string }[];
  known: string[];
}

function agoText(now: number, t: number): string {
  const d = Math.max(0, now - t);
  if (d < 60) return `${Math.round(d)}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  return `${(d / 3600).toFixed(1)}h ago`;
}

function tone(v: number, invert = false): 'good' | 'warn' | 'bad' {
  const x = invert ? 100 - v : v;
  return x > 60 ? 'good' : x > 30 ? 'warn' : 'bad';
}

export function inspect(id: string): InspectorData | null {
  const world = getWorld();
  const now = world.timeSec;

  if (id === 'emerson') {
    const p = world.player;
    return {
      id,
      name: 'Emerson',
      subtitle: 'Human · Player · Male',
      kindLabel: 'PLAYER CHARACTER',
      place: placeName(p.pos),
      vitals: [
        { label: 'Health', value: p.health, tone: tone(p.health) },
        { label: 'Stamina', value: p.stamina, tone: tone(p.stamina) },
      ],
      goal: { label: 'Player-directed', reason: ['Emerson acts under your control in Live Mode.'] },
      scores: [],
      personality: [],
      needs: [],
      relationships: [],
      memories: [],
      known: [`Carrying ${p.berries} glowberr${p.berries === 1 ? 'y' : 'ies'}`],
    };
  }

  const e = getEntity(id);
  if (!e) return null;

  const memories = [...e.memories]
    .reverse()
    .slice(0, 6)
    .map((m) => ({ text: memoryText(m), ago: agoText(now, m.t) }));

  if (e.kind === 'settler') {
    const speciesDef = INTELLIGENT_SPECIES[e.speciesId as IntelligentSpeciesId];
    const rels = Object.entries(e.relationships)
      .map(([otherId, rel]) => {
        const name = otherId === 'emerson' ? 'Emerson' : (getEntity(otherId)?.name ?? 'someone');
        return { name, affinity: Math.round(rel.affinity), interactions: rel.interactions };
      })
      .sort((a, b) => Math.abs(b.affinity) - Math.abs(a.affinity))
      .slice(0, 5);
    const known = e.knownResourceIds
      .map((rid) => world.resources.find((r) => r.id === rid))
      .filter((r) => r && r.type !== 'restspot')
      .slice(0, 5)
      .map((r) => r!.label);
    if (e.knownLandmarkIds.length > 0) {
      const places = e.knownLandmarkIds
        .map((id) => LANDMARKS.find((l) => l.id === id)?.name)
        .filter(Boolean)
        .join(', ');
      known.unshift(`Has visited: ${places}`);
    }
    return {
      id,
      name: e.name,
      subtitle: `${speciesDef.name} · ${e.sex === 'female' ? 'Female' : 'Male'} · Adult`,
      kindLabel: 'INTELLIGENT SETTLER',
      place: placeName(e.pos),
      vitals: [
        { label: 'Health', value: e.health, tone: tone(e.health) },
        { label: 'Energy', value: e.energy, tone: tone(e.energy) },
        { label: 'Hunger', value: e.hunger, tone: tone(e.hunger, true) },
      ],
      goal: { label: e.goal.label, reason: e.goalReason.summary },
      scores: e.goalReason.scores,
      personality: [
        { label: 'Curiosity', value: e.personality.curiosity * 100, tone: 'accent' },
        { label: 'Sociability', value: e.personality.sociability * 100, tone: 'accent' },
        { label: 'Caution', value: e.personality.caution * 100, tone: 'accent' },
        { label: 'Aggression', value: e.personality.aggression * 100, tone: 'accent' },
        { label: 'Empathy', value: e.personality.empathy * 100, tone: 'accent' },
        { label: 'Initiative', value: e.personality.initiative * 100, tone: 'accent' },
      ],
      needs: [
        { label: 'Social', value: e.needs.social, tone: tone(e.needs.social, true) },
        { label: 'Curiosity', value: e.needs.curiosity, tone: tone(e.needs.curiosity, true) },
        { label: 'Safety', value: e.needs.safety, tone: tone(e.needs.safety, true) },
      ],
      relationships: rels,
      memories,
      known,
    };
  }

  // Creature.
  const def = CREATURE_SPECIES_BY_ID[e.speciesId];
  const data: InspectorData = {
    id,
    name: e.name,
    subtitle: `${def.name} · ${e.sex === 'female' ? 'Female' : 'Male'} · ${e.ageStage === 'juvenile' ? 'Juvenile' : 'Adult'}`,
    kindLabel: e.lumi ? 'NATIVE LIFEFORM · UNIQUE INDIVIDUAL' : 'NATIVE LIFEFORM',
    place: placeName(e.pos),
    vitals: [
      { label: 'Health', value: e.health, tone: tone(e.health) },
      { label: 'Energy', value: e.energy, tone: tone(e.energy) },
      { label: 'Hunger', value: e.hunger, tone: tone(e.hunger, true) },
      { label: 'Fear', value: e.fear, tone: tone(e.fear, true) },
    ],
    goal: { label: e.goal.label, reason: e.goalReason.summary },
    scores: [],
    personality: [
      { label: 'Curiosity', value: def.traits.curiosity * 100, tone: 'accent' },
      { label: 'Aggression', value: def.traits.aggression * 100, tone: 'accent' },
      { label: 'Sociability', value: def.traits.sociability * 100, tone: 'accent' },
      { label: 'Fearfulness', value: def.traits.fearfulness * 100, tone: 'accent' },
    ],
    needs: [],
    relationships: [],
    memories,
    known: [],
  };
  if (e.lumi) {
    data.trust = { label: 'Trust · Emerson', value: e.lumi.trust };
    if (e.lumi.following) data.known.push('Currently following Emerson');
    data.known.push(`Fed by Emerson ${e.lumi.fedCount}×`);
    data.known.push(`${Math.round(dist(e.pos, world.player.pos))}m from Emerson`);
  }
  return data;
}
