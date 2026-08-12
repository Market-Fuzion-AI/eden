import { chronicle } from './chronicle';
import type { EntityId, MaterialId, RecipeId, ResourceType, SalvageId, World } from './types';

/**
 * EDEN's first player progression loop: gather → return → fabricate → become
 * more capable.
 *
 * Everything here is data. Materials and recipes are declarative tables, and
 * the fabricator is a small deterministic state machine driven by simulation
 * time — not by UI events. React reads this; it never owns it. Adding a fourth
 * recipe later should mean adding a row, not writing a handler.
 */

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export interface MaterialDef {
  id: MaterialId;
  /** The resource-node type that yields it. */
  nodeType: ResourceType;
  name: string;
  /** The interaction verb, so each material feels like a different act. */
  verb: string;
  description: string;
  /** Where it is abundant. Not exclusive — abundance, not a fence. */
  region: 'riverlands' | 'ashlands' | 'skyreach';
  /** Units granted per interaction. */
  yield: number;
  /** HUD tint. */
  color: string;
}

export const MATERIALS: Record<MaterialId, MaterialDef> = {
  alloy: {
    id: 'alloy',
    nodeType: 'alloy',
    name: 'Salvaged Alloy',
    verb: 'Salvage',
    description: 'Structural plating cut from colony wreckage. Still sound, once it is off the frame.',
    region: 'riverlands',
    yield: 2,
    color: '#b9c2d0',
  },
  ore: {
    id: 'ore',
    nodeType: 'ore',
    name: 'Conductive Ore',
    verb: 'Extract',
    description: 'Mineral seams threaded with something that carries current remarkably well.',
    region: 'ashlands',
    yield: 2,
    color: '#e0a24a',
  },
  crystal: {
    id: 'crystal',
    nodeType: 'crystal',
    name: 'Aether Crystal',
    verb: 'Harvest',
    description: 'High-altitude crystal that focuses energy along its growth axis. Nobody knows why it forms.',
    region: 'skyreach',
    yield: 1,
    color: '#c08bff',
  },
};

export const MATERIAL_IDS: MaterialId[] = ['alloy', 'ore', 'crystal'];

/** The node types that yield player fabrication materials. */
export const MATERIAL_NODE_TYPES: ResourceType[] = ['alloy', 'ore', 'crystal'];

export function materialForNodeType(type: ResourceType): MaterialDef | null {
  for (const id of MATERIAL_IDS) {
    if (MATERIALS[id].nodeType === type) return MATERIALS[id];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export type RecipeOutput = 'scanner' | 'arc-blade' | 'capacitor' | 'medkit' | 'energy-cell';

export interface RecipeDef {
  id: RecipeId;
  name: string;
  description: string;
  costs: Partial<Record<MaterialId, number>>;
  /**
   * Salvage this recipe consumes. The only thing that costs salvage is the
   * Capacitor, and the only source of salvage is a disabled Warden — which is
   * what turns "survived a guardian" into "got better at surviving".
   */
  salvage?: Partial<Record<SalvageId, number>>;
  /** Sim-seconds the fabricator runs for. */
  duration: number;
  output: RecipeOutput;
  /** True for one-shot unlocks: cannot be built twice. */
  once: boolean;
  /** Shown under the requirements when the recipe has no use yet. */
  note?: string;
}

export const RECIPES: RecipeDef[] = [
  {
    id: 'scanner-mk1',
    name: 'Pathfinder Scanner Mk I',
    description:
      'Field analysis module. Extends ARI\'s sensing so she can isolate and classify usable material signatures at range.',
    costs: { alloy: 4, ore: 3, crystal: 2 },
    duration: 3,
    output: 'scanner',
    once: true,
  },
  {
    id: 'arc-blade-mk1',
    name: 'Arc Blade Mk I',
    description:
      'A cutting edge struck from salvaged plating and driven by a crystal discharge. Petra will not call it a weapon. It is a weapon.',
    costs: { alloy: 5, ore: 4, crystal: 3 },
    duration: 4,
    output: 'arc-blade',
    once: true,
  },
  {
    id: 'arc-blade-capacitor',
    name: 'Arc Blade Capacitor',
    description:
      'A recovered synthetic core, wired into the blade\'s discharge path. Petra cannot tell you what it is. She can tell you it holds a charge like nothing the colony can make.',
    costs: { alloy: 3, ore: 4, crystal: 2 },
    salvage: { coreFragment: 1 },
    duration: 5,
    output: 'capacitor',
    once: true,
    note: 'Requires a Synthetic Core Fragment.',
  },
  {
    id: 'medkit',
    name: 'Field Medkit',
    description:
      'Colony medical reserves packed into a salvaged casing with a charge cell. Restores a substantial amount of health in the field.',
    costs: { alloy: 1, ore: 1 },
    duration: 2,
    output: 'medkit',
    once: false,
  },
  {
    id: 'energy-cell',
    name: 'Energy Cell',
    description:
      'Advanced equipment power module. Discharges into the scanner for an immediate long-range sweep, and is compatible with equipment the colony cannot build yet.',
    costs: { alloy: 2, ore: 3, crystal: 1 },
    duration: 2,
    output: 'energy-cell',
    once: false,
    note: 'Future systems compatible.',
  },
];

export const RECIPE_BY_ID: Record<string, RecipeDef> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

// ---------------------------------------------------------------------------
// Fabricator state machine
// ---------------------------------------------------------------------------

export type FabricateRefusal =
  | 'busy'
  | 'already-built'
  | 'missing-materials'
  | 'missing-salvage'
  | 'unknown-recipe';

export interface FabricateResult {
  ok: boolean;
  reason?: FabricateRefusal;
}

/** Does the player already own the one-shot output of this recipe? */
export function alreadyBuilt(world: World, recipe: RecipeDef): boolean {
  if (!recipe.once) return false;
  switch (recipe.output) {
    case 'scanner':
      return world.player.unlocks.scanner;
    case 'arc-blade':
      return world.player.unlocks.arcBlade;
    case 'capacitor':
      return world.player.unlocks.capacitor;
    default:
      return false;
  }
}

export function canFabricate(world: World, recipeId: RecipeId): FabricateResult {
  const recipe = RECIPE_BY_ID[recipeId];
  if (!recipe) return { ok: false, reason: 'unknown-recipe' };
  if (world.fabrication) return { ok: false, reason: 'busy' };
  if (alreadyBuilt(world, recipe)) return { ok: false, reason: 'already-built' };
  for (const [id, need] of Object.entries(recipe.costs)) {
    if (world.player.materials[id as MaterialId] < (need ?? 0)) {
      return { ok: false, reason: 'missing-materials' };
    }
  }
  // Salvage is reported separately: "you need more ore" and "you need to go
  // survive a Warden" are very different pieces of advice.
  for (const [id, need] of Object.entries(recipe.salvage ?? {})) {
    if (world.player.salvage[id as SalvageId] < (need ?? 0)) {
      return { ok: false, reason: 'missing-salvage' };
    }
  }
  return { ok: true };
}

/**
 * Begin fabrication.
 *
 * Materials are consumed at the *start*, not on completion. That is what makes
 * a double-click or a mid-job speed change harmless: a second press finds the
 * fabricator busy and the resources already gone, so nothing can be built
 * twice or paid for once.
 */
export function startFabrication(world: World, recipeId: RecipeId): FabricateResult {
  const check = canFabricate(world, recipeId);
  if (!check.ok) return check;
  const recipe = RECIPE_BY_ID[recipeId];
  for (const [id, need] of Object.entries(recipe.costs)) {
    world.player.materials[id as MaterialId] -= need ?? 0;
  }
  for (const [id, need] of Object.entries(recipe.salvage ?? {})) {
    world.player.salvage[id as SalvageId] -= need ?? 0;
  }
  world.fabrication = {
    recipeId: recipe.id,
    startedAt: world.timeSec,
    endsAt: world.timeSec + recipe.duration,
  };
  return { ok: true };
}

/** 0..1 progress of the running job, or 0 when idle. */
export function fabricationProgress(world: World): number {
  const job = world.fabrication;
  if (!job) return 0;
  const span = Math.max(0.001, job.endsAt - job.startedAt);
  return Math.max(0, Math.min(1, (world.timeSec - job.startedAt) / span));
}

/**
 * Advance the fabricator. Called once per simulation tick, so time
 * acceleration shortens the wall-clock wait without ever producing two items:
 * the job is cleared before its output is granted.
 */
export function fabricationTick(world: World): void {
  const job = world.fabrication;
  if (!job) return;
  if (world.timeSec < job.endsAt) return;
  const recipe = RECIPE_BY_ID[job.recipeId];
  world.fabrication = null;
  if (!recipe) return;

  const p = world.player;
  switch (recipe.output) {
    case 'scanner':
      if (!p.unlocks.scanner) {
        p.unlocks.scanner = true;
        world.ariQueue.push(
          'Pathfinder Scanner Mk I online. Sensor resolution improved — I can isolate usable material signatures at range now. Press Q.',
        );
        world.flags.scannerBuiltAt = world.timeSec;
      }
      break;
    case 'arc-blade':
      if (!p.unlocks.arcBlade) {
        p.unlocks.arcBlade = true;
        p.equipped = 'arcBlade';
        world.ariQueue.push(
          'ARC BLADE MK I ONLINE. Discharge is stable. Emerson — this changes where you can go, not what the valley is. Most of what lives out there still wants nothing to do with you.',
        );
        world.flags.arcBladeBuiltAt = world.timeSec;
      }
      break;
    case 'capacitor':
      if (!p.unlocks.capacitor) {
        p.unlocks.capacitor = true;
        world.flags.capacitorBuiltAt = world.timeSec;
        world.ariQueue.push(
          'ARC BLADE CAPACITOR INSTALLED. Discharge is holding half again the charge it did. Heavy strikes will put things on the back foot now, Emerson — that fragment was worth what it cost you.',
        );
        chronicle(world, 'emerson', 'Petra wired a recovered synthetic core into the Arc Blade.', {
          actorIds: ['emerson'],
          actorNames: ['Emerson'],
          pos: { ...p.pos },
          cause: ['A Warden Wisp was disabled and its core recovered'],
          effects: ['The blade hits harder against a guarded stance', 'Nobody can explain the core'],
        });
      }
      break;
    case 'medkit':
      p.items.medkit += 1;
      world.ariQueue.push('Field medkit assembled. Press H when you need it, ideally before you need it badly.');
      break;
    case 'energy-cell':
      p.items.energyCell += 1;
      world.ariQueue.push('Energy cell charged. It will drive a long-range scanner sweep, among other things.');
      break;
  }
  world.flags[`fabricated_${recipe.id}`] = true;
}

// ---------------------------------------------------------------------------
// Harvesting player materials
// ---------------------------------------------------------------------------

/** Grant the yield of one interaction with a material node. */
export function collectMaterial(world: World, nodeId: EntityId): { material: MaterialDef; amount: number } | null {
  const node = world.resources.find((r) => r.id === nodeId);
  if (!node || node.quantity < 1) return null;
  const def = materialForNodeType(node.type);
  if (!def) return null;
  // Never hand out more than the node actually holds — this is what stops a
  // nearly-empty seam paying a full yield forever.
  const amount = Math.min(def.yield, Math.floor(node.quantity));
  if (amount < 1) return null;
  node.quantity -= amount;
  world.player.materials[def.id] += amount;
  world.dirty.resources = true;
  return { material: def, amount };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const MEDKIT_HEAL = 45;

/** Use a medkit. Returns how much health was actually restored. */
export function useMedkit(world: World): number {
  const p = world.player;
  if (p.dead || p.items.medkit < 1) return 0;
  if (p.health >= 99.5) return 0;
  const before = p.health;
  p.items.medkit -= 1;
  p.health = Math.min(100, p.health + MEDKIT_HEAL);
  return p.health - before;
}
