import type { IntelligentSpeciesId, Sex } from './types';

/**
 * Species definitions: identity, cultural starting tendencies (biases, never
 * determinism — individuals vary), and visual palettes consumed by the
 * render-side character factories.
 */

export interface IntelligentSpeciesDef {
  id: IntelligentSpeciesId;
  name: string;
  plural: string;
  /** Personality biases (0..1 centers); individuals get seeded variance on top. */
  bias: {
    curiosity: number;
    sociability: number;
    caution: number;
    aggression: number;
    empathy: number;
    initiative: number;
  };
  palette: {
    skin: string[];
    hair: string[];
    outfit: string[];
    /** Secondary garment colour: boots, shoulder yoke, trim. */
    outfitAlt: string[];
    /** Underside / muzzle / plumage highlight colour. */
    belly: string;
    accent: string;
  };
}

export const INTELLIGENT_SPECIES: Record<IntelligentSpeciesId, IntelligentSpeciesDef> = {
  human: {
    id: 'human',
    name: 'Human',
    plural: 'Humans',
    bias: { curiosity: 0.5, sociability: 0.5, caution: 0.5, aggression: 0.45, empathy: 0.55, initiative: 0.5 },
    palette: {
      skin: ['#e8b98d', '#c68a5e', '#8a5a3b', '#f0cba6', '#6e4529'],
      hair: ['#2b2118', '#5b3b22', '#111318', '#a56a35', '#8c8f96'],
      outfit: ['#3d6b70', '#5c5346', '#6b4a3d', '#46586b'],
      outfitAlt: ['#2a4a4e', '#3d3830', '#48312a', '#2f3c4a'],
      belly: '#e8cdb0',
      accent: '#59d6e6',
    },
  },
  veyra: {
    id: 'veyra',
    name: 'Veyra',
    plural: 'Veyra',
    bias: { curiosity: 0.45, sociability: 0.62, caution: 0.55, aggression: 0.45, empathy: 0.65, initiative: 0.5 },
    palette: {
      skin: ['#5d8a5f', '#4f7d70', '#6f9358', '#54806b', '#638a4e'],
      hair: ['#2e5540', '#1e4a45', '#3d5a28'],
      outfit: ['#7a5a36', '#6d6242', '#8a6a3e'],
      outfitAlt: ['#543d24', '#4a4230', '#5e472a'],
      belly: '#cfd9a8',
      accent: '#ffb547',
    },
  },
  caelari: {
    id: 'caelari',
    name: 'Caelari',
    plural: 'Caelari',
    bias: { curiosity: 0.68, sociability: 0.4, caution: 0.38, aggression: 0.5, empathy: 0.48, initiative: 0.62 },
    palette: {
      skin: ['#cfd7e8', '#b9c8de', '#dcd2e8', '#c2d8d4', '#e3d9c8'],
      hair: ['#7f5fd0', '#4f7fd0', '#d06fa0', '#50b5b0'],
      outfit: ['#4a4468', '#39586b', '#5c4462'],
      outfitAlt: ['#2f2c48', '#243b4a', '#3d2c44'],
      belly: '#f0eadf',
      accent: '#c08bff',
    },
  },
};

export interface SettlerSeed {
  name: string;
  sex: Sex;
  species: IntelligentSpeciesId;
}

/** 21 founding settlers. Humans 4F/3M, Veyra 3F/4M, Caelari 3F/4M. */
export const SETTLER_ROSTER: SettlerSeed[] = [
  { name: 'Asha', sex: 'female', species: 'human' },
  { name: 'Mira', sex: 'female', species: 'human' },
  { name: 'Selene', sex: 'female', species: 'human' },
  { name: 'June', sex: 'female', species: 'human' },
  { name: 'Kael', sex: 'male', species: 'human' },
  { name: 'Rowan', sex: 'male', species: 'human' },
  { name: 'Dmitri', sex: 'male', species: 'human' },
  { name: 'Thalyss', sex: 'female', species: 'veyra' },
  { name: 'Ithra', sex: 'female', species: 'veyra' },
  { name: 'Zsava', sex: 'female', species: 'veyra' },
  { name: 'Ssarik', sex: 'male', species: 'veyra' },
  { name: 'Korrash', sex: 'male', species: 'veyra' },
  { name: 'Vessk', sex: 'male', species: 'veyra' },
  { name: 'Naszir', sex: 'male', species: 'veyra' },
  { name: 'Aeliel', sex: 'female', species: 'caelari' },
  { name: 'Cirrha', sex: 'female', species: 'caelari' },
  { name: 'Lyrise', sex: 'female', species: 'caelari' },
  { name: 'Kirren', sex: 'male', species: 'caelari' },
  { name: 'Vantis', sex: 'male', species: 'caelari' },
  { name: 'Oriel', sex: 'male', species: 'caelari' },
  { name: 'Sareth', sex: 'male', species: 'caelari' },
];

/** Conceptual homeworld knowledge (future technology system hooks). */
export const KNOWLEDGE_POOL = [
  'agriculture',
  'medicine',
  'construction',
  'metallurgy',
  'engineering',
  'electricity',
];

// ---------------------------------------------------------------------------
// Native creatures
// ---------------------------------------------------------------------------

export type BodyPlan = 'lumi' | 'grazer' | 'strider' | 'blob' | 'floater' | 'fish' | 'bird' | 'moth' | 'raptor';

export interface CreatureSpeciesDef {
  id: string;
  name: string;
  plan: BodyPlan;
  scale: number;
  speed: number;
  /** Baseline traits 0..1 — future offspring will inherit these with mutation. */
  traits: {
    aggression: number;
    curiosity: number;
    sociability: number;
    fearfulness: number;
    metabolism: number;
  };
  /** Where this species lives; keys into worldgen anchor points. */
  homeAnchor: string;
  aquatic?: boolean;
  hover?: boolean;
  hoverHeight?: number;
  nocturnal?: boolean;
  /** Budding replication parameters (bounded — see wildlife.ts). */
  replication: { cap: number; chancePerThink: number };
  palette: { body: string; belly: string; accent: string; glow: string };
}

export const CREATURE_SPECIES: CreatureSpeciesDef[] = [
  {
    id: 'lumin',
    name: 'Lumin',
    plan: 'lumi',
    scale: 1,
    speed: 3.2,
    traits: { aggression: 0.02, curiosity: 0.9, sociability: 0.6, fearfulness: 0.55, metabolism: 0.5 },
    homeAnchor: 'glade',
    replication: { cap: 3, chancePerThink: 0.004 },
    // Lilac body against a warm cream underside: gentle enough to read as
    // friendly, saturated enough to hold its shape against sunlit grass.
    palette: { body: '#a892d8', belly: '#ffeaca', accent: '#4e3480', glow: '#4fe0c4' },
  },
  {
    id: 'thornback',
    name: 'Thornback Grazer',
    plan: 'grazer',
    scale: 1.1,
    speed: 1.6,
    traits: { aggression: 0.1, curiosity: 0.2, sociability: 0.6, fearfulness: 0.5, metabolism: 0.4 },
    homeAnchor: 'meadow',
    replication: { cap: 4, chancePerThink: 0.012 },
    palette: { body: '#7c9a58', belly: '#c9c39a', accent: '#4c6236', glow: '#b7e26a' },
  },
  {
    id: 'strider',
    name: 'Verdant Strider',
    plan: 'strider',
    scale: 1.6,
    speed: 1.9,
    traits: { aggression: 0.05, curiosity: 0.3, sociability: 0.4, fearfulness: 0.4, metabolism: 0.3 },
    homeAnchor: 'meadow',
    replication: { cap: 3, chancePerThink: 0.008 },
    palette: { body: '#5f8f86', belly: '#d8d2ae', accent: '#39625c', glow: '#7be2c8' },
  },
  {
    id: 'mossling',
    name: 'Mossling',
    plan: 'blob',
    scale: 0.6,
    speed: 0.9,
    traits: { aggression: 0, curiosity: 0.7, sociability: 0.8, fearfulness: 0.6, metabolism: 0.6 },
    homeAnchor: 'rocks',
    replication: { cap: 4, chancePerThink: 0.016 },
    palette: { body: '#6e9a4f', belly: '#8fb56a', accent: '#3f5e2c', glow: '#a7ff8f' },
  },
  {
    id: 'puffbell',
    name: 'Puffbell',
    plan: 'floater',
    scale: 0.9,
    speed: 0.8,
    traits: { aggression: 0, curiosity: 0.4, sociability: 0.3, fearfulness: 0.3, metabolism: 0.2 },
    homeAnchor: 'riverbank',
    hover: true,
    hoverHeight: 2.4,
    replication: { cap: 3, chancePerThink: 0.01 },
    palette: { body: '#c9a8e8', belly: '#e8d8f8', accent: '#8a5fae', glow: '#e29aff' },
  },
  {
    id: 'glimmerfin',
    name: 'Glimmerfin',
    plan: 'fish',
    scale: 0.8,
    speed: 2.6,
    traits: { aggression: 0, curiosity: 0.3, sociability: 0.7, fearfulness: 0.7, metabolism: 0.5 },
    homeAnchor: 'river',
    aquatic: true,
    replication: { cap: 4, chancePerThink: 0.014 },
    palette: { body: '#5fa8c9', belly: '#bfe6f2', accent: '#2f6a88', glow: '#7fe0ff' },
  },
  {
    id: 'skyren',
    name: 'Skyren',
    plan: 'bird',
    scale: 0.7,
    speed: 3.4,
    traits: { aggression: 0.1, curiosity: 0.6, sociability: 0.5, fearfulness: 0.65, metabolism: 0.7 },
    homeAnchor: 'forest',
    replication: { cap: 4, chancePerThink: 0.012 },
    palette: { body: '#d98a5f', belly: '#f2d8b0', accent: '#8a4a2f', glow: '#ffb27f' },
  },
  {
    id: 'emberwing',
    name: 'Emberwing',
    plan: 'moth',
    scale: 0.55,
    speed: 1.6,
    traits: { aggression: 0, curiosity: 0.5, sociability: 0.2, fearfulness: 0.4, metabolism: 0.4 },
    homeAnchor: 'glade',
    hover: true,
    hoverHeight: 1.8,
    nocturnal: true,
    replication: { cap: 3, chancePerThink: 0.01 },
    palette: { body: '#4a3a5e', belly: '#6a4a7e', accent: '#2a1f38', glow: '#ff9a5f' },
  },
  {
    id: 'rakhor',
    name: 'Rakhor',
    plan: 'raptor',
    scale: 1.35,
    speed: 4.2,
    traits: { aggression: 0.75, curiosity: 0.3, sociability: 0.1, fearfulness: 0.15, metabolism: 0.6 },
    homeAnchor: 'rocksSouth',
    replication: { cap: 2, chancePerThink: 0.004 },
    palette: { body: '#8a5a4a', belly: '#c9a06a', accent: '#4e2f28', glow: '#ff6a4a' },
  },
];

export const CREATURE_SPECIES_BY_ID: Record<string, CreatureSpeciesDef> = Object.fromEntries(
  CREATURE_SPECIES.map((s) => [s.id, s]),
);
