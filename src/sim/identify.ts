import { settlerRole } from './npcContext';
import { CREATURE_SPECIES_BY_ID, INTELLIGENT_SPECIES } from './species';
import { dispositionOf as threatDisposition } from './threats';
import type { Entity, IntelligentSpeciesId, World } from './types';
import { dist } from './vec';

/**
 * ARI's unobtrusive identification of whatever Kai is looking at.
 * Live Mode only ever reveals what a participant could plausibly perceive:
 * name, species and an outward disposition — never internal needs or goals.
 */

export interface Identification {
  id: string;
  name: string;
  line: string;
  disposition: string;
  /** Lumi and other notable individuals get emphasis. */
  notable: boolean;
  /**
   * Scanner read-out. Present only with the Pathfinder Scanner installed —
   * without it Kai sees a shape and has to judge for himself, which is the
   * point of building the thing.
   */
  scan?: {
    category: 'Biological' | 'Synthetic';
    threat: 'Passive' | 'Defensive' | 'Hostile' | 'Dormant';
    /** What it does, in words. Never a stat: no health, no damage numbers. */
    behaviour: string;
  };
  /** 0..1 remaining condition of something that can actually be fought. */
  healthFrac?: number;
  dangerous: boolean;
}

const IDENT_RANGE = 22;
/** Cosine of the half-angle ARI considers "looking at". */
const GAZE_COS = 0.86;

function dispositionOf(world: World, e: Entity): string {
  if (e.kind === 'settler') {
    const rel = e.relationships.emerson;
    if (rel && rel.affinity >= 30) return 'warm';
    if (rel && rel.affinity <= -10) return 'guarded';
    if (rel && rel.interactions > 0) return 'familiar';
    if (e.personality.caution > 0.65) return 'wary';
    if (e.personality.sociability > 0.65) return 'open';
    return 'neutral';
  }
  // Dangerous fauna report the state machine that is actually driving them,
  // rather than a species stereotype: a Rakhor that has not noticed Kai
  // genuinely is placid, and saying otherwise would make every read-out a lie.
  if (e.combat) {
    switch (e.combat.state) {
      case 'hostile':
      case 'circle':
      case 'windup':
      case 'lunge':
      case 'charge':
      case 'beam':
      case 'strike':
      case 'recover':
        return 'hostile';
      case 'staggered':
        return 'reeling';
      case 'warn':
        return 'warning';
      case 'alert':
        return 'watching';
      case 'retreat':
        return 'wounded, withdrawing';
      case 'disengage':
        return 'withdrawing';
      default:
        return CREATURE_SPECIES_BY_ID[e.speciesId].synthetic ? 'dormant' : 'unbothered';
    }
  }
  if (e.threatUntil > world.timeSec) return 'alarmed';
  if (e.lumi) {
    const t = e.lumi.trust;
    if (t >= 75) return 'bonded';
    if (t >= 50) return 'trusting';
    if (t >= 25) return 'curious';
    return 'cautious';
  }
  const def = CREATURE_SPECIES_BY_ID[e.speciesId];
  if (def.traits.aggression > 0.6) return 'defensive';
  if (def.traits.fearfulness > 0.6) return 'skittish';
  return 'placid';
}

/**
 * Identify the entity Kai is looking at (or standing beside).
 * Gaze-weighted so labels do not follow him around the valley.
 */
export function identifyFocus(world: World, camForwardX: number, camForwardZ: number): Identification | null {
  const p = world.player;
  if (p.dead) return null;
  // Held in a single-slot array so the closure assignment below does not get
  // narrowed away to `never` by control-flow analysis.
  const bestSlot: Entity[] = [];
  let bestScore = -Infinity;

  const consider = (e: Entity) => {
    const dx = e.pos.x - p.pos.x;
    const dz = e.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > IDENT_RANGE || d < 0.01) return;
    const dot = (dx * camForwardX + dz * camForwardZ) / d;
    // Anything very close counts even if not centered in view.
    if (dot < GAZE_COS && d > 4.5) return;
    const score = dot * 10 - d * 0.25 + (e.kind === 'creature' && e.lumi ? 6 : 0);
    if (score > bestScore) {
      bestSlot[0] = e;
      bestScore = score;
    }
  };
  for (const s of world.settlers) consider(s);
  for (const c of world.creatures) consider(c);

  const e = bestSlot[0];
  if (!e) return null;
  const disposition = dispositionOf(world, e);

  if (e.kind === 'settler') {
    const def = INTELLIGENT_SPECIES[e.speciesId as IntelligentSpeciesId];
    // Their posting, not "Human settler". The player learns who these people
    // are by meeting them, and a name with a job attached is the smallest thing
    // that turns a crowd into individuals. Species stays visible beside it.
    const role = settlerRole(e);
    return {
      id: e.id,
      name: e.name.toUpperCase(),
      line: role === def.name ? `${def.name} settler` : `${role} · ${def.name}`,
      disposition,
      notable: false,
      dangerous: false,
    };
  }
  const def = CREATURE_SPECIES_BY_ID[e.speciesId];
  if (e.lumi) {
    return {
      id: e.id,
      name: 'LUMI',
      line: world.flags.lumiMet ? `${def.name} · unique individual` : `Unknown ${def.name}`,
      disposition,
      notable: true,
      dangerous: false,
    };
  }
  const role =
    def.dangerous?.scanRole ??
    (def.synthetic
      ? 'Unknown synthetic organism'
      : def.traits.aggression > 0.6
        ? 'Native predator'
        : def.aquatic
          ? 'Native river life'
          : 'Native lifeform');
  const maxHealth = def.dangerous?.health ?? 100;
  return {
    id: e.id,
    name: def.name.toUpperCase(),
    line: e.ageStage === 'juvenile' ? `${role} · juvenile` : role,
    disposition,
    notable: Boolean(def.synthetic),
    dangerous: Boolean(def.dangerous),
    healthFrac: def.dangerous ? Math.max(0, Math.min(1, e.health / maxHealth)) : undefined,
    // The scanner is what turns "something is moving over there" into a
    // classification. Without it Kai gets the name and the posture only.
    scan: world.player.unlocks.scanner
      ? {
          category: def.synthetic ? 'Synthetic' : 'Biological',
          threat: threatDisposition(e),
          // Behavioural, deliberately. Telling the player "warns before
          // attacking" teaches them how to survive it; telling them "90 HP"
          // teaches them to count.
          behaviour: def.dangerous?.scanBehaviour ?? 'No threat response recorded',
        }
      : undefined,
  };
}

/** Distance from Kai, for HUD affordances. */
export function distanceToPlayer(world: World, e: Entity): number {
  return dist(world.player.pos, e.pos);
}
