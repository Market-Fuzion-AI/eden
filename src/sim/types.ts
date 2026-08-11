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
  | 'talk-emerson'
  | 'seek-friend'
  | 'confront'
  | 'avoid'
  | 'share-food'
  | 'gather-wood'
  | 'gather-stone'
  | 'build'
  | 'help-build'
  | 'gather-at-fire'
  | 'ask-to-use';

export type GoalPhase = 'travel' | 'act' | 'done';

export interface Goal {
  type: GoalType;
  label: string;
  targetId?: EntityId;
  /** Set when the target is a structure rather than an agent or resource. */
  structureId?: EntityId;
  targetPos?: V2;
  phase: GoalPhase;
  /** Seconds remaining in the current 'act' phase (when applicable). */
  timer: number;
  startedAt: number;
  /** Give-up deadline for travel, in sim time. */
  deadline: number;
  /** For two-party exchanges: true on the side that started it. */
  initiator?: boolean;
  /**
   * The scored intent this goal came from, when it differs from the goal
   * actually adopted — deciding to rest can produce an "ask to use" errand,
   * and wanting to eat with no known food produces a foraging trip. Re-planning
   * compares against this, so a substitute goal is not torn down and rebuilt
   * every think.
   */
  sourceType?: GoalType;
  /** Anti-stuck bookkeeping for the travel phase. */
  lastDist?: number;
  lastProgressAt?: number;
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
    | 'talked_to_emerson'
    | 'given_food'
    | 'shared_food'
    | 'yielded_food'
    | 'resented_food'
    | 'confronted'
    | 'reconciled'
    | 'sought_company'
    | 'built_structure'
    | 'helped_build'
    | 'rested_in_shelter'
    | 'used_structure'
    | 'resented_material'
    | 'granted_permission'
    | 'received_permission'
    | 'refused_permission'
    | 'was_refused'
    | 'expectation_violated'
    | 'used_claimed_structure';
  subjectId?: EntityId;
  subjectName?: string;
  place?: string;
  t: number;
  emotionalWeight: number; // -1..1
}

/** One recorded change to a relationship — the source of inspector history. */
export interface RelationshipEvent {
  t: number;
  kind:
    | 'meeting'
    | 'conversation'
    | 'conflict'
    | 'reconciliation'
    | 'gift'
    | 'sought'
    | 'resentment'
    | 'cooperation'
    | 'permission'
    | 'violation';
  text: string;
  withName: string;
  /** Values after the change, for a readable running record. */
  affinity: number;
  trust: number;
  delta: { affinity: number; trust: number; familiarity: number; fear: number };
}

export interface Relationship {
  affinity: number; // -100..100 liking
  trust: number; // 0..100 reliability
  familiarity: number; // 0..100 how well known
  fear: number; // 0..100 reluctance to be near
  interactions: number;
  lastInteractionAt: number;
  firstMetAt: number;
  lastConflictAt: number;
  history: RelationshipEvent[];
}

export interface Personality {
  curiosity: number;
  sociability: number;
  caution: number;
  aggression: number;
  empathy: number;
  initiative: number;
}

/**
 * Lightweight held values. These are not personality traits but beliefs about
 * how things *ought* to work, and they are what turn identical histories into
 * different expectations about the same shelter.
 */
export interface Values {
  /** Belief that what you make is yours rather than everyone's. 0..1 */
  individualism: number;
  /** Preference for exclusive personal space. 0..1 */
  territoriality: number;
}

export type ClaimKind = 'none' | 'public' | 'shared' | 'personal';

/**
 * One settler's evolving stance toward one structure.
 *
 * Deliberately stored on the *agent*, never on the structure: two people can
 * hold flatly contradictory views of the same shelter and neither is right.
 */
export interface StructureAttitude {
  structureId: EntityId;
  /** Drift toward accepting shared use, earned by peaceful shared history. */
  sharedDrift: number;
  /** Drift toward exclusivity, earned by use they considered inappropriate. */
  grudge: number;
  /** People this settler has allowed to use it. */
  allowed: EntityId[];
  /** People who have allowed this settler to use it. */
  allowedBy: EntityId[];
  /** People who have refused this settler. */
  refusedBy: EntityId[];
  lastViolationAt: number;
  lastAskedAt: number;
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
  /** True while the exchange is a confrontation — drives distinct visuals. */
  confronting?: boolean;
  resting: boolean;
  home: V2;
}

export interface Settler extends AgentCommon {
  kind: 'settler';
  speciesId: IntelligentSpeciesId;
  personality: Personality;
  values: Values;
  /** Stances toward structures, keyed by structure id. Bounded. */
  structureAttitudes: Record<EntityId, StructureAttitude>;
  needs: { social: number; curiosity: number; safety: number };
  relationships: Record<EntityId, Relationship>;
  knownResourceIds: EntityId[];
  /** Landmarks this settler has personally visited. */
  knownLandmarkIds: string[];
  /** Everything this settler is physically carrying. */
  inventory: { glowberry: number; wood: number; stone: number };
  /** Structures this settler has seen. */
  knownStructureIds: EntityId[];
  /** The project they are currently pursuing, if any. */
  buildPlan: BuildPlan | null;
  confrontCooldownUntil: number;
  shareCooldownUntil: number;
  projectCooldownUntil: number;
  /** Conceptual knowledge carried from the homeworld (future tech system). */
  knowledge: string[];
  socialCooldownUntil: number;
  /** Sim time until which Emerson's conversation holds this settler in place. */
  talkingUntil: number;
}

/** A settler's intention to build or help build something. */
export interface BuildPlan {
  structureId: EntityId;
  type: StructureType;
  /** True when this settler staked the site rather than joining it. */
  owner: boolean;
  reason: string[];
  startedAt: number;
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
export type CarriedResource = 'glowberry' | 'wood' | 'stone';

export type StructureType = 'campfire' | 'shelter';
export type StructureState = 'under-construction' | 'complete';

/** One person's total contribution to one structure. */
export interface StructureContribution {
  id: EntityId;
  name: string;
  wood: number;
  stone: number;
  /** Fraction of total build progress they personally applied. */
  work: number;
}

export interface StructureUsage {
  id: EntityId;
  name: string;
  count: number;
  lastAt: number;
}

/**
 * A persistent shared place. Lives entirely in simulation state — the renderer
 * only reads it, so a structure exists whether or not anything is drawing it.
 */
export interface Structure {
  id: EntityId;
  type: StructureType;
  pos: V2;
  /** Cached ground height so the renderer never has to guess. */
  y: number;
  place: string;
  state: StructureState;
  /** 0..1, and never ahead of the materials actually delivered. */
  progress: number;
  required: { wood: number; stone: number };
  contributed: { wood: number; stone: number };
  initiatorId: EntityId;
  initiatorName: string;
  /** Why it was started, captured at the moment of the decision. */
  reason: string[];
  /** Why here. */
  locationReason: string[];
  contributions: StructureContribution[];
  startedAt: number;
  /** Last time anyone delivered materials or applied labour here. */
  lastWorkAt: number;
  completedAt: number | null;
  usage: StructureUsage[];
  useCount: number;
}

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
  | 'creator'
  | 'settlement'
  | 'norm';

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
  /** The structure this event concerns, if any. */
  structureId?: EntityId;
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
  structureId?: EntityId;
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
  /** Construction materials Emerson is carrying. */
  wood: number;
  stone: number;
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
export type YieldMode = 'normal' | 'low';

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
  structures: Structure[];
  offeredFood: OfferedFood[];
  flora: FloraItem[];
  obstacles: Obstacle[];
  camps: Camp[];
  chronicle: ChronicleEvent[];
  chronicleCounter: number;
  weather: Weather;
  /** Glowberry abundance — the single controlled scarcity lever. */
  yieldMode: YieldMode;
  flags: WorldFlags;
  /** Pending ARI lines, drained by the game loop into the HUD. */
  ariQueue: string[];
  /** Set by sim when entities/resources are added or removed; loop bumps store versions. */
  dirty: { entities: boolean; resources: boolean; structures: boolean };
}
