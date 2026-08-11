import type { V2 } from './vec';
import type { Rng } from './rng';

export type EntityId = string;
export type Sex = 'female' | 'male';
export type IntelligentSpeciesId = 'human' | 'veyra' | 'caelari';

export type GoalType =
  | 'idle'
  | 'eat'
  | 'rest'
  | 'explore'
  | 'socialize'
  | 'wander'
  | 'graze'
  | 'flee'
  | 'investigate'
  | 'watch-emerson'
  | 'approach-food'
  | 'follow-emerson'
  | 'attack-player'
  | 'talk-emerson';

export type GoalPhase = 'travel' | 'act' | 'done';

export interface Goal {
  type: GoalType;
  label: string;
  targetId?: EntityId;
  targetPos?: V2;
  phase: GoalPhase;
  /** Seconds remaining in the current 'act' phase (when applicable). */
  timer: number;
  startedAt: number;
  /** Give-up deadline for travel, in sim time. */
  deadline: number;
}

/** Why the current goal was selected — surfaced verbatim in Creator Mode. */
export interface GoalReason {
  summary: string[];
  scores: { goal: string; score: number }[];
}

export interface MemoryEntry {
  type:
    | 'resource_discovered'
    | 'ate'
    | 'rested'
    | 'social_positive'
    | 'social_negative'
    | 'fed_by_emerson'
    | 'threatened'
    | 'explored'
    | 'saw_emerson'
    | 'talked_to_emerson';
  subjectId?: EntityId;
  subjectName?: string;
  place?: string;
  t: number;
  emotionalWeight: number; // -1..1
}

export interface Relationship {
  affinity: number; // -100..100
  interactions: number;
  lastInteractionAt: number;
}

export interface Personality {
  curiosity: number;
  sociability: number;
  caution: number;
  aggression: number;
  empathy: number;
  initiative: number;
}

export interface AgentCommon {
  id: EntityId;
  name: string;
  kind: 'settler' | 'creature';
  speciesId: string;
  sex: Sex;
  ageStage: 'adult' | 'juvenile';
  pos: V2;
  heading: number;
  /** Current movement speed (m/s) — read by the renderer for animation. */
  speed: number;
  health: number;
  energy: number;
  hunger: number;
  goal: Goal;
  goalReason: GoalReason;
  memories: MemoryEntry[];
  nextThinkAt: number;
  /** >0 while in a social exchange (renderer shows an indicator). */
  socialTimer: number;
  resting: boolean;
  home: V2;
}

export interface Settler extends AgentCommon {
  kind: 'settler';
  speciesId: IntelligentSpeciesId;
  personality: Personality;
  needs: { social: number; curiosity: number; safety: number };
  relationships: Record<EntityId, Relationship>;
  knownResourceIds: EntityId[];
  /** Landmarks this settler has personally visited. */
  knownLandmarkIds: string[];
  /** Conceptual knowledge carried from the homeworld (future tech system). */
  knowledge: string[];
  socialCooldownUntil: number;
  /** Sim time until which Emerson's conversation holds this settler in place. */
  talkingUntil: number;
}

export interface LumiState {
  trust: number; // 0..100 toward Emerson
  following: boolean;
  followUntil: number;
  fedCount: number;
  lastTrustMilestone: number;
}

export interface Creature extends AgentCommon {
  kind: 'creature';
  fear: number; // 0..100 current alarm level
  curiosity: number; // 0..100 current drive
  threatPos: V2 | null;
  threatUntil: number;
  replicationCooldownUntil: number;
  aggroUntil: number;
  visualVariant: number;
  /** Present only on the individual named Lumi. */
  lumi?: LumiState;
}

export type Entity = Settler | Creature;

export type ResourceType = 'glowberry' | 'wood' | 'stone' | 'restspot';

export interface ResourceNode {
  id: EntityId;
  type: ResourceType;
  /** Human-readable label used in memories, reasons and the chronicle. */
  label: string;
  pos: V2;
  quantity: number;
  maxQuantity: number;
  regenPerSec: number;
  campOf?: IntelligentSpeciesId;
  /** First global discovery emits a chronicle event. */
  discovered: boolean;
  /** Provenance for anything not present at world creation: what caused this
   *  to exist, who did it, and when. Absent = original worldgen. */
  origin?: { cause: string; actorId: EntityId; t: number };
}

export interface OfferedFood {
  id: EntityId;
  pos: V2;
  placedAt: number;
}

export type FloraType = 'tree' | 'tree2' | 'glowplant' | 'rock' | 'crystal' | 'grass';

export interface FloraItem {
  type: FloraType;
  pos: V2;
  scale: number;
  rot: number;
  variant: number;
}

export interface Obstacle {
  pos: V2;
  radius: number;
}

export interface Camp {
  speciesId: IntelligentSpeciesId;
  label: string;
  pos: V2;
}

export type ChronicleCategory =
  | 'system'
  | 'discovery'
  | 'social'
  | 'lumi'
  | 'wildlife'
  | 'emerson'
  | 'creator';

export interface ChronicleEvent {
  id: number;
  t: number;
  category: ChronicleCategory;
  text: string;
  /** Structured payload so the UI can explain and locate an event without
   *  parsing its prose. All fields optional — simple world events carry none. */
  actorIds?: EntityId[];
  actorNames?: string[];
  pos?: V2;
  place?: string;
  /** Why it happened, as discrete readable facts captured at event time. */
  cause?: string[];
  /** What changed as a result. */
  effects?: string[];
}

/** Optional structured detail supplied when emitting a chronicle event. */
export interface ChronicleDetail {
  actorIds?: EntityId[];
  actorNames?: string[];
  pos?: V2;
  place?: string;
  cause?: string[];
  effects?: string[];
}

export interface PlayerState {
  id: 'emerson';
  name: 'Emerson';
  pos: V2;
  y: number;
  vy: number;
  heading: number;
  speed: number;
  onGround: boolean;
  health: number;
  stamina: number;
  berries: number;
  attackTimer: number;
  attackCooldown: number;
  dodgeTimer: number;
  dodgeCooldown: number;
  dead: boolean;
  respawnTimer: number;
  /** Sim time of the last fast approach — used by wildlife startle checks. */
  lastSprintAt: number;
}

export type Weather = 'clear' | 'mist';

export interface WorldFlags {
  [key: string]: number | boolean;
}

export interface World {
  seed: number;
  /** Deterministic PRNG — all sim randomness flows through this. */
  rng: Rng;
  /** Sim-seconds since world start. The single source of truth for time. */
  timeSec: number;
  settlers: Settler[];
  creatures: Creature[];
  player: PlayerState;
  resources: ResourceNode[];
  offeredFood: OfferedFood[];
  flora: FloraItem[];
  obstacles: Obstacle[];
  camps: Camp[];
  chronicle: ChronicleEvent[];
  chronicleCounter: number;
  weather: Weather;
  flags: WorldFlags;
  /** Pending ARI lines, drained by the game loop into the HUD. */
  ariQueue: string[];
  /** Set by sim when entities/resources are added or removed; loop bumps store versions. */
  dirty: { entities: boolean; resources: boolean };
}
