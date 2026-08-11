/**
 * Central simulation constants. All tuning lives here so behavior can be
 * balanced without hunting through systems.
 */

/** Fixed simulation timestep in sim-seconds. Sim correctness never depends on render FPS. */
export const SIM_DT = 1 / 30;

/** Max sim ticks processed per rendered frame (spiral-of-death guard at 20x). */
export const MAX_TICKS_PER_FRAME = 48;

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
  eatDuration: 6,
  socialDuration: 10,
  socialRange: 2.8,
  socialSearchRadius: 48,
  socialPairCooldown: 90,
  perceptionRadius: 15,
  arriveDist: 1.4,
  thinkMin: 0.7,
  thinkMax: 1.6,
  maxMemories: 14,
};

export const PLAYER = {
  walkSpeed: 3.4,
  sprintSpeed: 6.2,
  jumpVel: 5.6,
  gravity: 14,
  maxBerries: 6,
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

export const CHRONICLE_CAP = 250;
