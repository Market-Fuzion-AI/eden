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
  walkSpeed: 3.7,
  /**
   * Movement responsiveness. Acceleration is deliberately much faster than
   * deceleration: starting must feel instant, while a short coast on stopping
   * is what stops Emerson reading as a debug capsule that teleports to a halt.
   * The coast is short — long enough to have weight, not long enough to skate.
   */
  accel: 16,
  decel: 13,
  /** Radians per second toward the travel direction, doubled on a reversal. */
  turnRate: 13,
  bodyRadius: 0.45,
  talkRange: 3.4,
  talkDuration: 9,
  sprintSpeed: 6.8,

  /**
   * Jump.
   *
   * Tuned as an action-game jump rather than a physical one: it rises fast,
   * peaks at a little over a metre, and falls faster than it rose. Symmetric
   * gravity is what makes a jump feel floaty even when the apex is low.
   */
  jumpVel: 6.9,
  gravity: 19,
  /** Descent multiplier. The asymmetry is most of what makes a jump feel snappy. */
  fallGravityScale: 1.45,
  /**
   * Releasing the key early clamps the climb to this, giving a hop about
   * two-fifths the height of a full jump.
   *
   * It replaces a per-frame damping factor that cut the rise by 55% *every
   * frame*: a tap produced a 15 cm hop, which does not read as a short jump but
   * as a jump that failed. A single clamp is also frame-rate independent, which
   * the old form was not.
   */
  jumpCutVel: 4.4,
  /**
   * Grace after walking off an edge during which a jump still counts. Without
   * it, jumping from the lip of a ledge silently fails often enough that the
   * player blames the controller rather than their timing.
   */
  coyoteTime: 0.12,
  /** A jump pressed just before landing fires on touchdown instead of being lost. */
  jumpBuffer: 0.16,
  /** How much steering authority remains in the air, 0..1. */
  airControl: 0.55,
  /** Vertical tolerance for stepping up onto low geometry without jumping. */
  stepHeight: 0.42,
  /**
   * The same tolerance in the air — deliberately almost none.
   *
   * On the ground a generous step-up is what stops low geometry reading as a
   * wall. In the air it is the opposite: it silently lifts the player onto
   * ledges they did not clear, so a jump that fell short still succeeds and the
   * height of an obstacle stops meaning anything.
   */
  airLandTolerance: 0.06,
  maxBerries: 6,
  maxMaterials: 10,
  // Combat tuning lives in COMBAT, below. The v0.1 attack/dodge numbers that
  // used to sit here were superseded wholesale in v0.8 and are gone rather
  // than left behind — a second set of dials nobody reads is how you spend an
  // afternoon tuning a constant that no longer does anything.
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

/**
 * The first player progression loop.
 *
 * Tuned so one deliberate circuit — Riverlands, Ashlands, Skyreach and home —
 * completes the Scanner. The Scanner costs 4 alloy + 3 ore + 2 crystal, which
 * at these yields is two salvage stops, two extractions and two harvests.
 */
export const GATHER = {
  /** How close Emerson must be to work a node. */
  range: 3.2,
  /** Seconds of interaction per pull. Long enough to feel physical, short
   *  enough that six of them are not a chore. */
  duration: 1.3,
  /** Walking this far from where the interaction began cancels it. */
  cancelDistance: 2.2,
} as const;

export const SCANNER = {
  /** Local, not regional: enough to answer "is anything useful near me?". */
  radius: 58,
  /** An energy cell buys reach, not omniscience. */
  boostedRadius: 95,
  /** Seconds the highlight persists before the world goes quiet again. */
  highlight: 14,
  boostedHighlight: 22,
  cooldown: 22,
  /** Seconds the expanding pulse ring takes to reach full radius. */
  pulseDuration: 1.1,
} as const;

/** How close Emerson must stand to operate the fabricator. */
export const FABRICATOR = { range: 4.6 } as const;

/**
 * Combat. One blade, two threats, numbers small enough to read at a glance.
 *
 * Tuned in the browser: the biological encounter must be survivable while
 * learning the controls, the synthetic one must be noticeably harder without
 * being unfair. Every enemy attack is preceded by a visible wind-up long
 * enough to react to.
 */
/**
 * The three steps of the light chain.
 *
 * v0.8 made all three mechanically identical and scaled only the damage, which
 * meant the "chain" was a counter rather than a sequence — nothing about the
 * second swing looked or reached differently from the first. Each step now has
 * its own timing, reach, arc and stagger contribution, so the finisher is a
 * decision rather than a formality: it is slower to start, hits a wider arc,
 * and carries most of the chain's stagger.
 */
export const LIGHT_CHAIN = [
  // 1 — fast diagonal cut. Quick to start, narrow, cheap.
  { windup: 0.1, active: 0.14, recover: 0.2, damage: 24, range: 3.0, arcCos: 0.2, stagger: 12 },
  // 2 — reverse horizontal cut. Wider, so a second target can catch it.
  { windup: 0.11, active: 0.16, recover: 0.22, damage: 27, range: 3.1, arcCos: 0.0, stagger: 15 },
  // 3 — finisher. Slowest of the three and the one that actually staggers.
  { windup: 0.18, active: 0.2, recover: 0.4, damage: 38, range: 3.4, arcCos: 0.15, stagger: 34 },
] as const;

export const COMBAT = {
  /** Light chain steps, 1-based via `LIGHT_CHAIN[chain - 1]`. */
  chain: LIGHT_CHAIN,
  maxChain: 3,
  /**
   * Heavy attack. Deliberately not "light with a bigger number": it starts far
   * slower, roots Emerson for longer, and carries enough stagger on its own to
   * break a creature out of a wind-up. Its job is punishing a recovery window.
   */
  heavy: { windup: 0.32, active: 0.2, recover: 0.46, damage: 54, range: 3.6, arcCos: 0.32, stagger: 62 },

  /**
   * Input buffer.
   *
   * A press during a committed swing used to be dropped on the floor, so
   * chaining required catching a 0.26s window — on a keyboard, at 60fps, that
   * is a coin flip. One press may now be queued and it fires the instant the
   * current strike is over. Exactly one: a mashed key must not bank a queue of
   * attacks that keep coming out after the player has stopped pressing.
   */
  bufferWindow: 0.32,
  /** A chain continues only if the next strike starts within this of the last. */
  chainWindow: 0.62,

  /**
   * Soft target assist. Unlocked melee snaps Emerson's facing toward a hostile
   * already inside this cone, by at most `assistMaxTurn` radians. It exists to
   * cancel the small aiming error of steering with WASD while looking with a
   * trackpad — never to aim for the player.
   */
  assistRange: 4.2,
  assistCos: 0.35,
  assistMaxTurn: 0.42,

  /** Dodge: a displacement model, plus a short mercy window. */
  dodgeSpeed: 12,
  dodgeDuration: 0.3,
  dodgeCooldown: 0.42,
  /** Invulnerable for most of the roll — conservative, but forgiving to learn. */
  dodgeIFrames: 0.26,
  /** How long the afterimage trail lingers behind a roll. */
  dodgeTrail: 0.34,

  /** Lock-on. */
  lockRange: 26,
  lockBreakRange: 34,

  /**
   * Stagger. One number per creature, no poise stats and nothing on screen.
   * Load decays continuously, so chipping away with light attacks over a long
   * fight never accumulates into a permanent lock — you have to actually land
   * a sequence.
   */
  /*
   * Decay was originally fast enough that a full light chain into a heavy had
   * bled off most of its own build-up before the finisher landed — the chain
   * could never actually pay off, which defeated the point of having one.
   * Slow enough now that a clean sequence rocks a Rakhor, still fast enough
   * that one hit every few seconds accumulates to nothing.
   */
  staggerDecay: 10,
  staggerDuration: 0.9,
  /** Nothing may be staggered again until this long after recovering. */
  staggerImmunity: 2.2,

  /** Emerson's own reaction to being hit: brief, and never a stun chain. */
  hitStun: 0.22,
  hitStunImmunity: 1.4,

  /** Emerson recovers slowly out of combat, and not at all during it. */
  regenDelay: 6,
} as const;

/** Threat behaviour shared by both encounter archetypes. */
export const THREAT = {
  /** Nothing notices Emerson from across the valley. */
  noticeRange: 22,
  /** Inside this, a warning becomes a real threat. */
  provokeRange: 9,
  /** How long the creature postures before it will commit. */
  warnDuration: 2.6,
  /** Lost sight of the target for this long → disengage. */
  loseTargetAfter: 6,
  /** Never chase further than this from home territory. */
  leash: 46,
  /** Human Landing is home: nothing hunts inside this radius of the hearth. */
  safeRadius: 42,

  /**
   * Rakhor. A territorial predator circles before it commits, which is what
   * separates it from a melee drone that runs at you and bites forever.
   */
  rakhor: {
    circleDuration: 1.9,
    circleSpeed: 0.85,
    /** Distance it prefers to hold while sizing Emerson up. */
    circleRadius: 5.2,
    lungeSpeed: 13,
    lungeDuration: 0.34,
    /** Wounded below this fraction of health, it may break off for good. */
    fleeHealthFrac: 0.22,
  },

  /**
   * Warden. A guardian, not a brawler: it holds the ring at range, charges a
   * beam you have to move out of, and only uses the close-range burst to push
   * Emerson back out when he crowds it.
   */
  warden: {
    /** Where it wants to be: far enough that closing is the player's problem. */
    standoff: 11.5,
    /**
     * A guardian's provocation is entering the ground it guards, not walking
     * into arm's reach. Sharing the melee provoke range made the Warden refuse
     * to escalate until the player was closer than it ever wanted to be —
     * which is to say, it could not start the fight it exists to have.
     */
    provokeRange: 16,
    beamCharge: 1.35,
    beamDuration: 0.32,
    beamRange: 20,
    /** Half-width of the beam. Sidestepping it is the intended answer. */
    beamHalfWidth: 1.15,
    beamDamage: 22,
    /** Close-range shove. Solves the "hug the turret" degenerate strategy. */
    burstRange: 5.2,
    burstCharge: 0.7,
    burstDamage: 14,
    burstCooldown: 5,
    /** Patrol: it walks its own pylons when nothing is intruding. */
    patrolRadius: 15,
  },
} as const;

/** Glowberry abundance, adjustable from Creator Mode. */
export const YIELD = {
  normal: { regenScale: 1, capScale: 1, label: 'Normal' },
  low: { regenScale: 0.22, capScale: 0.45, label: 'Low' },
} as const;

export const CHRONICLE_CAP = 250;
