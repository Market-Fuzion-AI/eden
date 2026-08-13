import { DEV, PLAYER } from './config';
import { MATERIAL_IDS, SALVAGE_IDS } from './fabrication';
import { resetToCourseStart } from './course';
import type { World } from './types';

/**
 * Developer Mode.
 *
 * EDEN 3000 is being hand-tested, and hand-testing a system you first have to
 * spend ten minutes earning is not testing, it is bookkeeping. Developer Mode
 * hands the tester the equipment and the materials directly.
 *
 * The rule it exists to serve: **build the real mechanic, cheat the
 * acquisition.** The jetpack here is the same jetpack a player will eventually
 * earn — same fuel, same thrust, same limits. Only the getting of it is
 * skipped.
 *
 * The line this must never cross is *history*. A capability flag says "Kai can
 * use this"; a progression flag says "Kai did this". Developer Mode writes the
 * first and never the second, so nothing here can make the world believe a
 * mission was completed, a survivor was rescued, a recipe was researched or a
 * relationship was earned. Everything granted below is equipment or inventory,
 * and the guardrail is enforced by test rather than by good intentions.
 *
 * None of this is canon. It does not describe Kai's eventual starting loadout.
 */

const STORAGE_KEY = 'eden.devMode';

/**
 * The one flag.
 *
 * Change this constant to turn Developer Mode off for everybody. It can also be
 * overridden per-browser without a rebuild — `localStorage['eden.devMode']` set
 * to `'1'` or `'0'` wins — so a tester can flip modes between runs and a test
 * can force either one.
 */
export const DEV_MODE_DEFAULT = true;

let override: boolean | null = null;

function storedPreference(): boolean | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    // No storage (tests, private browsing) — fall through to the constant.
  }
  return null;
}

/** Is Developer Mode active right now? */
export function devMode(): boolean {
  if (override !== null) return override;
  const stored = storedPreference();
  return stored !== null ? stored : DEV_MODE_DEFAULT;
}

/**
 * Force Developer Mode on or off for this session; `null` returns to the
 * configured default. Tests use this to prove both modes; the debug bridge
 * exposes it so a tester can switch without editing a file.
 */
export function setDevMode(on: boolean | null, persist = false): void {
  override = on;
  if (!persist) return;
  try {
    if (on === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // Not being able to remember the choice is not a reason to refuse it.
  }
}

/**
 * Hand the tester everything needed to exercise what is already built.
 *
 * Deliberately unconditional: the flag is checked by the caller, so a test can
 * prove the grants happen and — separately — that nothing calls this in Player
 * Mode. Idempotent, so an F4 reset can simply run it again.
 */
export function applyDevLoadout(world: World): void {
  const p = world.player;

  // Materials and salvage are walked from the data tables rather than listed
  // here. Add a fourth material to `MATERIALS` and the QA loadout picks it up
  // on its own — a hand-maintained list would silently stop being complete.
  for (const id of MATERIAL_IDS) p.materials[id] = Math.max(p.materials[id], DEV.stack);
  for (const id of SALVAGE_IDS) p.salvage[id] = Math.max(p.salvage[id], DEV.stack);
  p.berries = Math.max(p.berries, DEV.stack);
  p.wood = Math.max(p.wood, PLAYER.maxMaterials);
  p.stone = Math.max(p.stone, PLAYER.maxMaterials);
  p.items.medkit = Math.max(p.items.medkit, DEV.items);
  p.items.energyCell = Math.max(p.items.energyCell, DEV.items);

  // Capabilities — what Kai can *use*. Note what is absent: no
  // `world.flags.fabricated_*`, no `*BuiltAt`, no chronicle entry. The valley's
  // record of what happened stays honest; only the equipment is real.
  p.unlocks.scanner = true;
  p.unlocks.arcBlade = true;
  p.unlocks.capacitor = true;
  p.unlocks.jetpack = true;
  p.unlocks.pulseBlaster = true;
  if (p.equipped === 'none') p.equipped = 'arcBlade';

  // Fit to test with.
  p.health = 100;
  p.stamina = 100;
  p.jetpackFuel = DEV.jetpackFuelStart;
  p.blasterCharge = DEV.blasterChargeStart;
}

/**
 * The F4 QA reset.
 *
 * Puts Kai back at the start of the 3Cs run and, in Developer Mode, tops
 * the loadout back up — a reset that leaves the tester re-gathering materials
 * is a reset nobody presses twice. The valley itself is untouched either way:
 * this moves the player, not the world.
 */
export function qaReset(world: World): void {
  resetToCourseStart(world);
  if (devMode()) applyDevLoadout(world);
}
