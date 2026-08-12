/**
 * Central simulation constants. All tuning lives here so behavior can be
 * balanced without hunting through systems.
 */

/** Fixed simulation timestep in sim-seconds. Sim correctness never depends on render FPS. */
export const SIM_DT = 1 / 30;

/**
 * Spiral-of-death guards for the fixed-timestep loop.
 *
 * A fixed tick *count* silently throttles the requested speed on slow
 * machines (a 20x request quietly becoming 3x), so the primary guard is a
 * wall-clock budget: keep stepping until the backlog is drained or we have
 * spent this long inside the tick loop. The count cap is only a backstop.
 */
export const TICK_BUDGET_MS = 12;
export const MAX_TICKS_PER_FRAME = 400;

/** One in-world day, expressed in sim-seconds (12 real minutes at 1x speed). */
export const DAY_SEC = 720;

/** World starts at 08:00 on Day 1 of Year 1. */
export const START_TIME = (8 / 24) * DAY_SEC;

export const WORLD = {
  /** Full terrain plane size (edge to edge). */
  size: 440,
  /** Radius agents & player are clamped inside. */
  playRadius: 172,
  /** Where the mountain rim starts and reaches full height. */
  rimStart: 150,
  rimEnd: 210,
  /** Global water plane height. */
  waterLevel: -1.8,
};

/** Need / biology integration rates (per sim-second unless noted). */
export const RATES = {
  hunger: 0.115, // roughly one full hunger cycle per in-world day
  energyIdle: 0.05,
  energyMoving: 0.13,
  restRecover: 2.4, // energy per second while resting
  socialNeed: 0.09,
  curiosityNeed: 0.11,
  healthRegen: 0.35, // when fed and rested
  eatReduces: 55,
  socialReduces: 45,
  exploreReducesCuriosity: 38,
};

export const SETTLER = {
  walkSpeed: 2.3,
  /** Physical presence radius used for character separation. */
  bodyRadius: 0.42,
  eatDuration: 6,
  /** Long enough that a player walking past can actually watch it happen. */
  socialDuration: 14,
  socialRange: 2.8,
  /** Conversational spacing held during the exchange. */
  socialHoldMin: 1.5,
  socialHoldMax: 2.6,
  socialSearchRadius: 48,
  socialPairCooldown: 90,
  perceptionRadius: 15,
  arriveDist: 1.4,
  thinkMin: 0.7,
  thinkMax: 1.6,
  maxMemories: 14,
};

export const PLAYER = {
  walkSpeed: 3.6,
  /**
   * Movement responsiveness. Acceleration is deliberately much faster than
   * deceleration: starting must feel instant, while a short coast on stopping
   * is what stops Emerson reading as a debug capsule that teleports to a halt.
   */
  accel: 14,
  decel: 9,
  /** Radians per second toward the travel direction, doubled on a reversal. */
  turnRate: 12,
  bodyRadius: 0.45,
  talkRange: 3.4,
  talkDuration: 9,
  sprintSpeed: 6.6,
  jumpVel: 5.6,
  gravity: 14,
  maxBerries: 6,
  maxMaterials: 10,
  attackRange: 2.4,
  attackArcCos: 0.2, // ~78 degrees each side
  attackDamage: 26,
  attackCooldown: 0.6,
  dodgeSpeed: 9.5,
  dodgeDuration: 0.28,
  dodgeCooldown: 1.1,
  interactRange: 2.8,
  offerRange: 10,
};

export const WILDLIFE = {
  grazeDuration: 8,
  grazeReduces: 42,
  restRecover: 2.0,
  fleeDuration: 7,
  fleeDistance: 26,
  /** Hard global cap on native creatures — replication can never exceed this. */
  globalCreatureCap: 26,
  replicationCooldown: 300,
  replicationEnergyCost: 45,
  offeredFoodTimeout: 120,
};

export const LUMI = {
  startTrust: 8,
  feedTrustGain: 9,
  firstFeedBonus: 4,
  calmProximityGainPerSec: 0.015,
  startleTrustLoss: 1.5,
  attackTrustLoss: 30,
  followTrustThreshold: 52,
  followChancePerThink: 0.22,
  followDurationMin: 55,
  followDurationMax: 150,
};

/** Structured relationships — yesterday changing tomorrow. */
export const REL = {
  maxHistory: 12,
  /** Seconds after a conflict during which the pair stays cold. */
  conflictChill: 420,
  /** Window in which a memory still colours social utility. */
  memoryWindow: 900,
  /** Idle time before a relationship starts drifting toward neutral. */
  decayIdleDelay: 900,
  decayPerSec: 0.0022,

  /** Friend-seeking: how far a settler will travel for good company. */
  seekRadius: 130,
  /** Minimum relationship score before travelling counts as worthwhile. */
  seekMinScore: 34,
  seekMinSocialNeed: 55,

  /** Confrontation. */
  confrontRange: 26,
  confrontDuration: 11,
  confrontMinScore: 30,
  confrontCooldown: 600,

  /** Food sharing. */
  shareRange: 9,
  shareDuration: 5,
  shareHungerGap: 28,
  shareCooldown: 300,
} as const;

/**
 * Construction. Caps here exist to keep settlement emergence *readable*:
 * without them every settler independently stakes their own shelter and the
 * valley fills with half-built boxes instead of forming a place.
 */
export const STRUCT = {
  /** Hard ceiling on structures in the world. */
  globalCap: 12,
  /** How many projects may be under construction at once. */
  maxActiveProjects: 4,
  /** A settler must wait this long before starting another project. */
  projectCooldown: 1400,
  /** Minimum initiative to be the sort of person who starts something. */
  minInitiative: 0.42,

  /** Harvest rate and trip capacity. */
  harvestPerSec: 1.1,
  carryCapacity: 12,
  /** Distance at which a settler can work on a site. */
  buildRange: 2.6,
  /**
   * How far away a structure is recognisable. Buildings are large, lit at
   * night, and stand in the open — using the ordinary perception radius meant
   * settlers a short walk away never learned a shelter existed and each built
   * their own, turning settlement into sprawl.
   */
  visibleRange: 78,
  /** Abandon a project after this long with no delivery or labour at all. */
  projectAbandonAfter: 2600,

  /** Helping. */
  helpRange: 95,
  helpMinScore: 26,

  /** Campfire social gravity. */
  fireGatherRadius: 4.2,
  fireAttractRange: 90,
  fireLingerMin: 25,
  fireLingerMax: 70,

  /** Shelter rest bonus multiplier. */
  shelterRestBonus: 1.7,
  /**
   * How many can comfortably sleep in one shelter. Beyond this the place is
   * strongly discouraged — without it the whole settlement converged on a
   * single shelter and latecomers were physically blocked out of it while
   * their rest goal kept them standing there, starving.
   */
  shelterCapacity: 4,
  /** Radius counted as "inside" a structure. */
  occupancyRadius: 4.5,

  /**
   * Travel is abandoned after this long without meaningful progress. A general
   * safety net: no goal may pin an agent in place indefinitely.
   */
  stuckTimeout: 22,
  stuckProgress: 0.4,

  /** Proto-settlement detection (observation only). */
  settlementRadius: 34,
  settlementMinStructures: 2,
  settlementMinRegulars: 3,
  settlementMinUses: 2,
} as const;

/**
 * Informal norms. These numbers decide how readily lived history hardens into
 * an expectation — and how readily an expectation softens again.
 */
export const NORM = {
  /** Stances tracked per settler before the least-invested is forgotten. */
  maxAttitudes: 10,

  /**
   * Where each structure type starts on the private↔communal axis.
   * Kept low: a high base swamped everything else and made anyone who touched
   * a shelter read it as exclusively theirs.
   */
  shelterExclusivityBase: 0.36,
  campfireExclusivityBase: 0.18,
  /**
   * How much held values pull exclusivity around. Large on purpose — what
   * someone believes about property must be able to outweigh the bare facts
   * of who did the work, or two people with identical histories could never
   * reach different conclusions.
   */
  valuesWeight: 0.75,

  /** Below this attachment a settler has no personal stake worth speaking of. */
  attachmentFloor: 18,
  personalThreshold: 0.6,
  sharedThreshold: 0.34,
  /** Distinct users after which a campfire reads as everyone's. */
  publicUserThreshold: 5,

  /** How heavily another's personal claim discourages use. */
  blockerWeight: 0.55,
  urgencyWeight: 0.45,
  /** Above this urgency a settler stops asking and simply goes in. */
  desperationUrgency: 72,

  /** Permission decision thresholds. */
  allowThreshold: 18,
  reluctantThreshold: -4,

  /** Share of the building effort that makes someone a genuine co-builder. */
  coBuilderShare: 0.15,

  /** Asking. */
  askRange: 58,
  askDuration: 7,
  askCooldown: 420,

  /** Norm drift per event. */
  sharedDriftPerPermission: 0.06,
  sharedDriftPerPeacefulUse: 0.015,
  grudgePerViolation: 0.09,
  /** Enough that sustained sharing can genuinely flip even a firm claim. */
  maxDrift: 0.55,

  /** A violation is only noticed if the claimant is within sight of it. */
  noticeRange: 62,
  violationCooldown: 240,
} as const;

/**
 * SHARED EXPECTATIONS — private expectation becoming social knowledge.
 *
 * Nothing here describes what a group believes. These numbers govern how one
 * individual comes to hold an *imperfect* model of what another individual
 * expects, how that model decays, and how far it can travel by word of mouth.
 */
export const SOCIAL = {
  /** Beliefs about other people's expectations, per settler. Bounded. */
  maxBeliefs: 16,
  /**
   * Generalizations about "people around here", per settler. Bounded.
   * Each place a settler frequents can produce evidence on two topics, so a
   * tighter budget evicted records before they ever gathered enough
   * observations to mean anything.
   */
  maxCustoms: 8,

  /** How close you must be to witness a social event and learn from it. */
  witnessRange: 34,

  /**
   * Certainty is never total. Nothing in this system may reach 1: you can be
   * confident about what someone expects, never certain.
   */
  maxConfidence: 0.92,
  /** Starting confidence by how directly the knowledge was acquired. */
  confidenceDirect: 0.78, // it happened to you, or they told you themselves
  confidenceWitnessed: 0.58, // you watched it happen to someone else
  confidenceHearsay: 0.4, // someone told you what they saw
  /** Extra confidence each time fresh evidence agrees with what you thought. */
  confirmBonus: 0.07,
  /**
   * Beliefs go stale. Confidence halves over this many sim-seconds since the
   * last confirmation (five in-world days), which is what allows a settler to
   * be confidently wrong after the other person has quietly changed their mind.
   *
   * Balanced against how often norm events actually happen: at a two-day
   * half-life almost every belief had decayed to noise before anything
   * confirmed it, and knowledge stopped mattering to behaviour at all.
   */
  staleHalfLife: 3600,
  /** Below this effective confidence a belief is not worth carrying. */
  minConfidence: 0.08,

  /** Word of mouth. */
  hearsayFactor: 0.72,
  /** Hops from the original witness before a claim stops being passed on. */
  maxDepth: 2,
  /** A settler shares what they know about others at most this often. */
  talkCooldown: 540,
  /** Chance an eligible conversation carries social information at all. */
  talkChance: 0.34,
  /** You do not discuss other people's business with a near-stranger. */
  talkMinFamiliarity: 25,

  /**
   * Absent any knowledge, a settler assumes others feel as they do. Weak on
   * purpose: naive projection must lose decisively to anything actually learned.
   */
  projectionConfidence: 0.28,

  /** Proto-custom: a generalization, never a world fact. */
  minCustomEvidence: 3,
  /** Evidence weight decays at this rate per sim-second (~half a day to halve). */
  customEvidenceDecayPerSec: 0.0000018,
  maxCustomConfidence: 0.85,
  /** How far a place-level generalization reaches. */
  customRadius: 70,

  /** How strongly a believed personal claim discourages use, per confidence. */
  beliefWeight: 62,
  /** A generalization is worth less than knowing the individual. */
  customSubstituteWeight: 0.7,
  /** Confidence a settler needs before politeness is worth the detour. */
  askConfidenceFloor: 0.22,
} as const;

/** Glowberry abundance, adjustable from Creator Mode. */
export const YIELD = {
  normal: { regenScale: 1, capScale: 1, label: 'Normal' },
  low: { regenScale: 0.22, capScale: 0.45, label: 'Low' },
} as const;

export const CHRONICLE_CAP = 250;
