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
  | 'ask-to-use'
  /** A dangerous creature engaged with Emerson; driven by `threats.ts`. */
  | 'threat';

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
    | 'used_claimed_structure'
    | 'learned_expectation'
    | 'told_expectation'
    | 'heard_expectation'
    | 'surprised_by_reaction';
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
  /**
   * How much weight this settler gives to what people around here seem to
   * expect, as against their own reading of a situation. 0..1
   *
   * Low conformity is *not* rebelliousness and not antisociality: an
   * independent settler simply trusts their own judgement over local habit.
   * They can still be generous, sociable and well-liked.
   */
  conformity: number;
}

export type ClaimKind = 'none' | 'public' | 'shared' | 'personal';

// ---------------------------------------------------------------------------
// Second-order social knowledge
// ---------------------------------------------------------------------------

/**
 * How a settler came by a belief about someone else's expectation. Provenance
 * is never discarded — it is what makes a belief arguable rather than a fact.
 */
export type BeliefSource =
  | 'told-by-them' // the person said so, or answered your request themselves
  | 'granted' // watched them give someone leave
  | 'refused' // watched them turn someone away
  | 'objected' // watched them take exception to a use
  | 'tolerated' // watched someone use it in front of them and nothing happened
  | 'heard-from'; // a third party passed it on

/**
 * "I believe X expects Y about structure Z."
 *
 * Held on the believer. There is deliberately no path from here to the truth:
 * the belief can be stale, second-hand, or simply mistaken, and the simulation
 * never reconciles it against what X actually thinks.
 */
export interface SocialBelief {
  /** Whose expectation this is a belief *about*. */
  aboutId: EntityId;
  aboutName: string;
  structureId: EntityId;
  /** What they are believed to expect. */
  kind: ClaimKind;
  source: BeliefSource;
  /** Stored confidence, 0..1. Effective confidence also decays with staleness. */
  confidence: number;
  learnedAt: number;
  lastConfirmedAt: number;
  /** 0 = first-hand, 1 = told by a witness, 2 = told by someone who was told. */
  depth: number;
  /** Who passed it on, when depth > 0. */
  viaId?: EntityId;
  viaName?: string;
  /** How many times fresh evidence has agreed with it. */
  confirmations: number;
}

/** The generalizations a settler is capable of forming. Deliberately few. */
export type CustomTopic = 'ask-first' | 'shelters-shared';

/**
 * One settler's private generalization about a place: "people around Landing
 * Meadow usually ask before using someone's shelter."
 *
 * This is an *opinion about a pattern*, stored on the individual who formed it.
 * Two settlers standing in the same clearing may hold opposite generalizations
 * and the world does not arbitrate. There is no settlement-level equivalent of
 * this record and there must never be one.
 */
export interface ProtoCustom {
  topic: CustomTopic;
  /** The landmark this generalization is scoped to. */
  place: string;
  pos: V2;
  /** Time-decayed evidence for and against. */
  supporting: number;
  contradicting: number;
  /** Distinct observations behind it — a pattern needs more than one event. */
  observations: number;
  firstAt: number;
  lastAt: number;
}

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
  /** What this settler believes *other people* expect. Imperfect. Bounded. */
  socialBeliefs: SocialBelief[];
  /** Generalizations they have drawn about places. Bounded. */
  protoCustoms: ProtoCustom[];
  /** Last time they passed on something about someone else. */
  lastNormTalkAt: number;
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
  /**
   * Targets this settler walked at and could not reach, and the sim time until
   * which they will look elsewhere instead. Keyed by target id. Bounded.
   *
   * Without this a settler wedged against geometry re-selects the same
   * unreachable destination every think and can starve within sight of food.
   */
  unreachable: Record<EntityId, number>;
  /** Conceptual knowledge carried from the homeworld (future tech system). */
  knowledge: string[];
  socialCooldownUntil: number;
  /** Sim time until which Emerson's conversation holds this settler in place. */
  talkingUntil: number;
  /**
   * A post this settler keeps during working hours.
   *
   * The smallest possible job system, and deliberately so: it does not tell
   * them what to do, only where to drift back to when nothing more pressing is
   * happening. They still get hungry, tired and sociable on their own terms —
   * but the colony's fabrication technician does not wander off to the Skyreach
   * for three days and take a gameplay system with her.
   */
  roleAnchor?: RoleAnchor;
}

export interface RoleAnchor {
  /** Identifies the role for inspection and dialogue. */
  role: 'fabricator';
  pos: V2;
  /** How far they may drift from the post before being drawn back. */
  radius: number;
  /** Hours of the in-world day the post is kept, inclusive start, exclusive end. */
  fromHour: number;
  toHour: number;
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
  /** Sim time of the last hit taken, for the flinch flash. */
  hitAt?: number;
  /** Direction the last hit came from, so the recoil shoves the right way. */
  hitFrom?: V2;
  /** How hard the last hit landed, 0..1 — scales the recoil. */
  hitForce?: number;
  /**
   * Combat state, present only on creatures capable of threatening anybody.
   * Its absence is what makes a mossling harmless.
   */
  combat?: CombatMemory;
  /** Present only on the individual named Lumi. */
  lumi?: LumiState;
}

export type Entity = Settler | Creature;

/**
 * Node types. `alloy`/`ore`/`crystal` are player fabrication materials; the
 * settlers' autonomous construction only ever asks for `wood` and `stone`, so
 * the two economies share one node model without competing for stock.
 */
export type ResourceType = 'glowberry' | 'wood' | 'stone' | 'restspot' | 'alloy' | 'ore' | 'crystal';

/** Player-facing fabrication materials. */
export type MaterialId = 'alloy' | 'ore' | 'crystal';

/**
 * Salvage recovered from disabled synthetic fauna. Not a gathering resource:
 * there is no node for it anywhere in the valley, and the only way to hold one
 * is to have survived a Warden.
 */
export type SalvageId = 'coreFragment';

export type EquippedWeapon = 'none' | 'arcBlade';

/** Player attack phases. Damage lands only during `active`. */
export type StrikePhase = 'windup' | 'active' | 'recover';

export interface StrikeState {
  kind: 'light' | 'heavy';
  phase: StrikePhase;
  /** Real seconds remaining in the current phase. */
  timer: number;
  /** Position in a light chain, 1-based. */
  chain: number;
  /**
   * Entities already hit by *this* swing. One strike may never damage the same
   * target twice, however long its active window is.
   */
  hitIds: EntityId[];
}

/**
 * A queued combat input.
 *
 * At most one is ever held. Pressing during a committed swing used to drop the
 * press entirely; it is now remembered just long enough to come out the moment
 * control returns, which is the whole difference between a chain that feels
 * responsive and one that feels ignored.
 */
export interface BufferedInput {
  kind: 'light' | 'heavy' | 'dodge';
  /** Real seconds since it was pressed. Expires, so it can never bank up. */
  age: number;
  /** Movement direction at the moment of the press, for a buffered dodge. */
  heading: number;
}

/**
 * How a dangerous creature currently regards Emerson.
 *
 * Every transition is explicit and every attack is preceded by a wind-up, so
 * damage is never a surprise. `warn` is the state that makes retreat a real
 * option: the creature is posturing, not yet committed. `circle` and `lunge`
 * are the Rakhor's; `charge` and `beam` are the Warden's.
 */
export type ThreatState =
  | 'calm'
  | 'alert'
  | 'warn'
  | 'hostile'
  | 'circle'
  | 'windup'
  | 'lunge'
  | 'charge'
  | 'beam'
  | 'strike'
  | 'recover'
  | 'staggered'
  | 'retreat'
  | 'disengage';

/** What a dangerous creature is doing when Emerson is nowhere near it. */
export type ThreatPurpose = 'patrol' | 'stalk' | 'drink' | 'survey';

export interface CombatMemory {
  state: ThreatState;
  /** Sim time the current state began. */
  since: number;
  /** Who it is engaged with. Only ever Emerson so far. */
  targetId: EntityId | null;
  /** Last moment the target was actually perceived. */
  lastSeenAt: number;
  /** Sim time this creature may next begin a wind-up. */
  nextAttackAt: number;
  /** Where it considers home — it will not chase beyond `THREAT.leash` of this. */
  territory: V2;
  /** True once it has landed a hit this engagement (used for chronicle once-flags). */
  hasStruck: boolean;
  /**
   * The direction a charged shot is committed to, fixed when the charge starts.
   * Null when nothing is charging. Locking it at the start is what makes the
   * charge a telegraph rather than an animation played before a guaranteed hit.
   */
  aim: V2 | null;
  /**
   * Accumulated stagger. Decays continuously; crossing the creature's
   * resistance drops it into `staggered`. Never shown as a meter in Live Mode.
   */
  staggerLoad: number;
  /** Sim time until which this creature cannot be staggered again. */
  staggerImmuneUntil: number;
  /** Which way it is circling, +1 or -1. Fixed per approach so it reads. */
  circleDir: number;
  /** Sim time the close-range burst is next available (Warden only). */
  nextBurstAt: number;
  /** What it does when left alone. */
  purpose: ThreatPurpose;
  /** Where its current non-combat errand is taking it. */
  purposeTarget: V2 | null;
  /** Sim time the current errand expires and a new one is chosen. */
  purposeUntil: number;
  /** The small animal a stalking predator is currently following, if any. */
  stalkingId: EntityId | null;
}

/**
 * A Warden's beam while it is actually firing.
 *
 * Lives on the world rather than the creature so the renderer can draw it
 * without reaching into combat state, and so it survives the creature being
 * destroyed mid-shot.
 */
export interface BeamShot {
  id: string;
  sourceId: EntityId;
  from: V2;
  /** Unit direction, fixed at the moment of firing — the beam does not track. */
  dir: V2;
  length: number;
  firedAt: number;
  endsAt: number;
  /** Height above the ground the beam is drawn at. */
  y: number;
}

export type RecipeId = 'scanner-mk1' | 'arc-blade-mk1' | 'arc-blade-capacitor' | 'medkit' | 'energy-cell';

/** A fabrication job in flight. Driven by sim time, so speed changes are safe. */
export interface FabricationJob {
  recipeId: RecipeId;
  startedAt: number;
  endsAt: number;
}

/** An in-progress gathering interaction. Real-time, like the rest of the player. */
export interface HarvestAction {
  nodeId: EntityId;
  startedAt: number;
  endsAt: number;
  /** Where Emerson stood when he started — walking away cancels it. */
  from: V2;
}

/** Transient scanner state. */
export interface ScanState {
  lastAt: number;
  activeUntil: number;
  pulseStartedAt: number;
  radius: number;
  nodeIds: EntityId[];
}
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
  /**
   * World height of the top of this obstacle, when it has one.
   *
   * Only the player uses it, and only to stop pushing: once his feet are level
   * with the top he is standing on the thing, not walking into it. Without this
   * a solid course block could never be landed on — the same circle that keeps
   * him from walking through it also shoved him off the roof.
   *
   * Undefined means "blocks at any height", which is every tree and boulder in
   * the valley. Settlers and creatures ignore the field entirely: they walk
   * around these on the ground like anything else.
   */
  top?: number;
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

/**
 * A norm event Emerson personally saw happen. ARI may only speak about what is
 * in this list — he is a participant in the valley, not an observer of its
 * internals.
 */
export interface WitnessedNorm {
  structureId: EntityId;
  aboutId: EntityId;
  aboutName: string;
  kind: ClaimKind;
  text: string;
  t: number;
}

/**
 * Landing infrastructure at Human Landing. Pure scenery with a position — it
 * gives the home base a silhouette without pretending to be simulation. The
 * fabricator is a marked placeholder for a later crafting milestone.
 */
export interface BuiltLandmark {
  kind: 'pod' | 'debris' | 'fabricator' | 'staging';
  pos: V2;
  rot: number;
}

/**
 * One piece of the 3Cs test course.
 *
 * Greybox geometry, deliberately: Gate 1 is about how Emerson moves, and the
 * course exists to pose movement problems rather than to look like anything.
 * `solid` props are also registered as obstacles so they cannot be walked
 * through; everything standable is queried through `course.ts`.
 */
export interface CourseProp {
  id: string;
  kind: 'pad' | 'block' | 'plank' | 'rock' | 'marker';
  pos: V2;
  rot: number;
  /** Radius for round props; half-extents for rotated boxes. */
  size: { x: number; z: number };
  /** Height of the top surface above the terrain beneath it. */
  height: number;
  solid: boolean;
}

/** * The Sunken Ring: half-buried structures nobody in the valley built.
 *
 * Scenery with a position, exactly like the landing site — the site is a place
 * to arrive at and a reason to wonder, not a system. Nothing here explains
 * itself, and v0.8 deliberately never answers the question it raises.
 */
export interface SitePropItem {
  kind: 'pylon' | 'arc' | 'shard' | 'plate';
  pos: V2;
  rot: number;
  scale: number;
  /** Sunk into the ground by this much, in metres. */
  sink: number;
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
  /**
   * Emerson's own clock, in real seconds.
   *
   * Separate from `world.timeSec` on purpose: the world advances at the sim
   * speed multiplier and he does not. His jump timings were measured against
   * the world clock, which meant that at 20× the coyote window and the input
   * buffer both expired in a twentieth of the time they were supposed to — a
   * correct jump silently failed, and only when the player had sped the world
   * up, which is the hardest kind of bug to attribute.
   */
  clock: number;
  /**
   * Jump forgiveness, as deadlines on `clock`. `coyoteUntil` keeps a jump legal
   * for a moment after walking off an edge; `jumpBufferedUntil` remembers a
   * press made just before landing. Both exist because without them a correct
   * input fails often enough that the player blames the controller.
   */
  coyoteUntil: number;
  jumpBufferedUntil: number;
  /** Last frame's jump key state, so a press is distinguishable from a hold. */
  jumpHeld: boolean;
  health: number;
  stamina: number;
  berries: number;
  /** Construction materials Emerson is carrying. */
  wood: number;
  stone: number;
  dodgeTimer: number;
  dodgeCooldown: number;
  /**
   * The direction a roll travels in, fixed when it starts. Separate from
   * `heading` so a locked-on player can roll sideways while still facing what
   * is trying to kill them.
   */
  dodgeHeading: number;
  /** True only for the length of an emergency extraction. */
  dead: boolean;
  /**
   * Current ground speed the movement integrator is easing toward the input.
   * Separate from `speed` (the distance actually covered, after water drag and
   * collision) so animation cadence can read intent rather than obstruction.
   */
  moveSpeed: number;
  /** Sim time of the last fast approach — used by wildlife startle checks. */
  lastSprintAt: number;
  /** Norm events Emerson was actually present for. Bounded. */
  witnessed: WitnessedNorm[];
  /** Player fabrication materials. Distinct from the settlers' wood/stone. */
  materials: Record<MaterialId, number>;
  /** Fabricated consumables and components. */
  items: { medkit: number; energyCell: number };
  /**
   * Permanent capabilities earned through fabrication. Never revoked — an
   * emergency extraction costs materials, never a capability.
   */
  unlocks: { scanner: boolean; arcBlade: boolean; capacitor: boolean };
  /** The gathering interaction in progress, if any. */
  harvest: HarvestAction | null;
  scan: ScanState;
  /** What Emerson is holding. One slot, deliberately. */
  equipped: EquippedWeapon;
  /** The swing in progress, if any. */
  strike: StrikeState | null;
  /** At most one queued combat action. See `BufferedInput`. */
  buffered: BufferedInput | null;
  /** Sim time the last strike in the current chain began, for the chain window. */
  lastStrikeAt: number;
  /** Sim time until which a dodge roll makes Emerson untouchable. */
  invulnUntil: number;
  /** Real seconds left of the roll's visual trail. Presentation only. */
  dodgeTrail: number;
  /** Currently locked target, or null. */
  lockedId: EntityId | null;
  /** Sim time of the last damage taken — gates out-of-combat regeneration. */
  lastHurtAt: number;
  /** Brief flinch on taking a hit. Never long enough to chain into helplessness. */
  hitStunUntil: number;
  /** Sim time until which Emerson cannot be flinched again. */
  hitStunImmuneUntil: number;
  /** Direction the last hit came from, for the flinch and the damage indicator. */
  lastHurtFrom: V2 | null;
  /** Salvage recovered from synthetics. */
  salvage: Record<SalvageId, number>;
  /** Emergency extraction in progress: fade out, relocate, fade in. */
  extraction: { startedAt: number; endsAt: number } | null;
  /** What the last extraction actually cost, so the HUD can say so plainly. */
  extractionLoss: { materialId: MaterialId; amount: number }[];
  /** How many times ARI has had to pull Emerson out. */
  extractions: number;
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
  /** Landing infrastructure at Human Landing. Scenery, placed once at worldgen. */
  landmarksBuilt: BuiltLandmark[];
  /** The ancient synthetic site at the Sunken Ring. Scenery, placed once. */
  siteProps: SitePropItem[];
  /** The 3Cs traversal course near Human Landing. Gate 1 test geometry. */
  course: CourseProp[];
  /** Where the fabricator stands, for interaction and the technician's post. */
  fabricatorPos: V2 | null;
  camps: Camp[];
  chronicle: ChronicleEvent[];
  chronicleCounter: number;
  weather: Weather;
  /** Glowberry abundance — the single controlled scarcity lever. */
  yieldMode: YieldMode;
  flags: WorldFlags;
  /** The fabricator's current job, or null when idle. */
  fabrication: FabricationJob | null;
  /** Recent material pickups, for brief HUD feedback. Bounded. */
  pickups: { materialId: MaterialId; amount: number; at: number }[];
  /** Recent synthetic salvage, likewise. */
  pickupsSalvage: { salvageId: SalvageId; amount: number; at: number }[];
  /** Warden beams currently in flight. Bounded and short-lived. */
  beams: BeamShot[];
  /**
   * Injected by `index.ts` so combat can name a place without importing the
   * landmark table (which would close an import cycle through worldgen).
   */
  landmarkNameAt?: (p: V2) => string;
  /** Pending ARI lines, drained by the game loop into the HUD. */
  ariQueue: string[];
  /** Set by sim when entities/resources are added or removed; loop bumps store versions. */
  dirty: { entities: boolean; resources: boolean; structures: boolean };
}
