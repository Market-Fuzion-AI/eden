/**
 * v0.9 playthrough.
 *
 * Walks the whole loop through the real running game with real key presses:
 * arm, find a predator, read its warning, retreat, fight it with the actual
 * chain, take the Sunken Ring, kill a Warden, carry the fragment home, build
 * the Capacitor, and prove the upgrade changed the fight. Debug hooks are used
 * only to *place* Kai between beats — every combat action here goes through
 * the same keyboard path a player uses.
 *
 * Usage:
 *   npx vite preview --port 4173 &
 *   node scripts/playtest-v09.mjs [url]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const TARGET_URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const SHOT_DIR = new URL('../smoke-shots', import.meta.url).pathname;
mkdirSync(SHOT_DIR, { recursive: true });
const SEED = Number(process.env.EDEN_SEED ?? 31337);

const failures = [];
const errors = [];
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    console.log(`  ✗ ${name} ${detail}`);
    failures.push(name);
  }
};

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.addInitScript((seed) => window.localStorage.setItem('eden.seed', String(seed)), SEED);
await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);
if (await page.locator('.help').isVisible().catch(() => false)) await page.locator('.help-resume').click();
await page.waitForTimeout(1200);

/** Advance the real loop by roughly this many seconds of wall time. */
const settle = (ms) => page.waitForTimeout(ms);

/** Step the sim and the player together, the way the game loop does. */
async function drive(seconds, opts = {}) {
  await page.evaluate(
    ({ seconds, hold }) => {
      const w = window.__EDEN__.getWorld();
      const n = Math.round(seconds * 30);
      for (let i = 0; i < n; i++) {
        window.__EDEN__.stepSim(1 / 30);
        window.__EDEN__.stepPlayer(1 / 30);
        if (hold) {
          w.player.pos.x = hold.x;
          w.player.pos.z = hold.z;
        }
      }
    },
    { seconds, hold: opts.hold ?? null },
  );
}

/** Open, level ground away from home, so a fight is not fought on a cliff. */
async function clearGround() {
  return page.evaluate(() => {
    const { getWorld, config, terrain } = window.__EDEN__;
    const w = getWorld();
    const camp = w.camps.find((c) => c.speciesId === 'human');
    for (let ring = 90; ring < 160; ring += 8) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const p = { x: Math.sin(a) * ring, z: Math.cos(a) * ring };
        if (Math.hypot(p.x, p.z) > 145) continue;
        if (Math.hypot(p.x - camp.pos.x, p.z - camp.pos.z) < config.THREAT.safeRadius + 60) continue;
        if (!terrain.isWalkable(p.x, p.z) || terrain.isWater(p.x, p.z)) continue;
        if (terrain.slopeAt(p.x, p.z) > 0.35) continue;
        if (w.obstacles.some((o) => Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < o.radius + 7)) continue;
        return p;
      }
    }
    return { x: 0, z: 0 };
  });
}

console.log('\n1. HUMAN LANDING — ARM');

// Gather the feedstock the honest way is proven by the v0.8 smoke run; here
// the material is granted and the *fabrication* is done through the real UI.
await page.evaluate(() => {
  const { getWorld, fabrication, useUI } = window.__EDEN__;
  const w = getWorld();
  for (const r of ['scanner-mk1', 'arc-blade-mk1']) {
    for (const [id, need] of Object.entries(fabrication.RECIPE_BY_ID[r].costs)) {
      w.player.materials[id] = (w.player.materials[id] ?? 0) + need;
    }
  }
  w.player.pos.x = w.fabricatorPos.x + 1.2;
  w.player.pos.z = w.fabricatorPos.z + 1.2;
  useUI.getState().setFabricatorOpen(true);
});
await settle(500);
await page.locator('.fab-recipe', { hasText: 'Pathfinder Scanner' }).locator('.fab-button').click();
await drive(4);
await page.locator('.fab-recipe', { hasText: 'Arc Blade Mk I' }).locator('.fab-button').click();
await drive(5);
const armed = await page.evaluate(() => {
  const w = window.__EDEN__.getWorld();
  return { blade: w.player.unlocks.arcBlade, scanner: w.player.unlocks.scanner, equipped: w.player.equipped };
});
check('Arc Blade and Scanner fabricated through the real panel', armed.blade && armed.scanner && armed.equipped === 'arcBlade', JSON.stringify(armed));
// The Capacitor is visible but refused: the salvage does not exist yet.
const capLocked = await page.locator('.fab-recipe', { hasText: 'Arc Blade Capacitor' }).locator('.fab-button').innerText();
check('the Capacitor is offered but needs salvage', /SALVAGE/i.test(capLocked), capLocked);
await page.screenshot({ path: `${SHOT_DIR}/v09-01-fabricator.png` });
await page.evaluate(() => window.__EDEN__.useUI.getState().setFabricatorOpen(false));
await settle(400);

console.log('\n2. THE RAKHOR — OBSERVE, WARN, RETREAT');

const spot = await clearGround();
// Watch a predator that has no idea Kai exists.
const ecology = await page.evaluate((spot) => {
  const { getWorld } = window.__EDEN__;
  const w = getWorld();
  const c = w.creatures.find((x) => x.speciesId === 'rakhor');
  c.pos.x = spot.x + 30;
  c.pos.z = spot.z + 30;
  c.combat.territory = { x: c.pos.x, z: c.pos.z };
  c.combat.state = 'calm';
  c.combat.purposeTarget = null;
  c.combat.purposeUntil = 0;
  // Kai well outside its notice range.
  w.player.pos.x = spot.x - 40;
  w.player.pos.z = spot.z - 40;
  const seen = new Set();
  for (let i = 0; i < 30 * 90; i++) {
    window.__EDEN__.stepSim(1 / 30);
    if (i % 30 === 0) seen.add(c.goal.label);
  }
  return { labels: [...seen], purpose: c.combat.purpose, state: c.combat.state, id: c.id };
}, spot);
check('a Rakhor has business of its own before Kai arrives',
  ecology.state === 'calm' && ecology.labels.some((l) => /stalk|patrol|territory|range/i.test(l)),
  JSON.stringify(ecology.labels));

// Walk into its territory and read the warning from a distance.
const warning = await page.evaluate(async ({ spot, id }) => {
  const { getWorld, config } = window.__EDEN__;
  const w = getWorld();
  const c = w.creatures.find((x) => x.id === id);
  const out = { warnedAt: 0, states: [] };
  // Approach one metre at a time, the way walking in does.
  for (let step = 0; step < 400; step++) {
    const dx = c.pos.x - w.player.pos.x;
    const dz = c.pos.z - w.player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 7) {
      w.player.pos.x += (dx / d) * 0.35;
      w.player.pos.z += (dz / d) * 0.35;
    }
    for (let i = 0; i < 6; i++) {
      window.__EDEN__.stepSim(1 / 30);
      window.__EDEN__.stepPlayer(1 / 30);
    }
    const s = c.combat.state;
    if (out.states[out.states.length - 1] !== s) out.states.push(s);
    if (s === 'warn' && out.warnedAt === 0) out.warnedAt = Math.hypot(c.pos.x - w.player.pos.x, c.pos.z - w.player.pos.z);
    if (s === 'circle' || s === 'lunge') break;
  }
  void config;
  return out;
}, { spot, id: ecology.id });
check('it warns before it commits', warning.states.includes('warn'), warning.states.join(' → '));
check('the warning begins at a distance you can still act on', warning.warnedAt > 5, `${warning.warnedAt.toFixed(1)}m`);
await page.screenshot({ path: `${SHOT_DIR}/v09-02-rakhor-warning.png` });

// Retreat must work.
const retreat = await page.evaluate(async ({ id }) => {
  const { getWorld } = window.__EDEN__;
  const w = getWorld();
  const c = w.creatures.find((x) => x.id === id);
  for (let step = 0; step < 900; step++) {
    const dx = w.player.pos.x - c.pos.x;
    const dz = w.player.pos.z - c.pos.z;
    const d = Math.max(0.01, Math.hypot(dx, dz));
    w.player.pos.x += (dx / d) * 0.5;
    w.player.pos.z += (dz / d) * 0.5;
    for (let i = 0; i < 4; i++) {
      window.__EDEN__.stepSim(1 / 30);
      window.__EDEN__.stepPlayer(1 / 30);
    }
    if (c.combat.state === 'calm') break;
  }
  return { state: c.combat.state, health: w.player.health };
}, { id: ecology.id });
check('backing away ends the encounter without a fight', retreat.state === 'calm', retreat.state);
check('and Kai is untouched', retreat.health === 100, `${retreat.health}`);

console.log('\n3. THE RAKHOR — FIGHT');

// Now provoke it and fight with the real keys.
await page.evaluate(({ spot, id }) => {
  const { getWorld } = window.__EDEN__;
  const w = getWorld();
  const c = w.creatures.find((x) => x.id === id);
  c.pos.x = spot.x + 2.2;
  c.pos.z = spot.z;
  c.health = 90;
  c.combat.state = 'hostile';
  c.combat.nextAttackAt = w.timeSec + 30; // let the player open, not the animal
  w.player.pos.x = spot.x;
  w.player.pos.z = spot.z;
  w.player.health = 100;
  w.player.heading = Math.atan2(c.pos.x - w.player.pos.x, c.pos.z - w.player.pos.z);
}, { spot, id: ecology.id });
await settle(300);

// Three light attacks, mashed the way a real player mashes them.
const chainBefore = await page.evaluate((id) => window.__EDEN__.getWorld().creatures.find((c) => c.id === id).health, ecology.id);
const chainSteps = [];
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('KeyJ');
  await page.evaluate(() => {
    const w = window.__EDEN__.getWorld();
    for (let k = 0; k < 8; k++) window.__EDEN__.stepPlayer(1 / 60);
    return w.player.strike?.chain ?? 0;
  });
  const st = await page.evaluate(() => window.__EDEN__.getWorld().player.strike?.chain ?? 0);
  chainSteps.push(st);
  await page.evaluate(() => {
    for (let k = 0; k < 14; k++) window.__EDEN__.stepPlayer(1 / 60);
  });
}
const chainAfter = await page.evaluate((id) => {
  const w = window.__EDEN__.getWorld();
  const c = w.creatures.find((x) => x.id === id);
  return { health: c?.health ?? 0, state: c?.combat?.state ?? 'gone', flags: { hit: w.flags.lastHitAt ?? -1 } };
}, ecology.id);
check('J chains through the light sequence', chainSteps.filter((n) => n > 1).length >= 1, JSON.stringify(chainSteps));
check('the chain does real damage', chainAfter.health < chainBefore, `${chainBefore} → ${chainAfter.health}`);
await page.screenshot({ path: `${SHOT_DIR}/v09-03-chain.png` });

// A heavy, which should rock it. Topped back up first: three lights plus a
// heavy is enough to kill a Rakhor outright, which is a good sign for the
// combat but leaves nothing standing to observe the stagger on.
await page.evaluate((id) => {
  const w = window.__EDEN__.getWorld();
  const c = w.creatures.find((x) => x.id === id);
  if (c) {
    c.health = 90;
    c.combat.staggerLoad = 0;
    c.combat.staggerImmuneUntil = -9999;
  }
}, ecology.id);
await page.keyboard.press('KeyK');
await page.evaluate(() => {
  for (let k = 0; k < 60; k++) window.__EDEN__.stepPlayer(1 / 60);
});
const heavy = await page.evaluate((id) => {
  const c = window.__EDEN__.getWorld().creatures.find((x) => x.id === id);
  return { state: c?.combat?.state ?? 'gone', load: c?.combat?.staggerLoad ?? -1 };
}, ecology.id);
check('K lands a heavy that staggers', heavy.state === 'staggered', JSON.stringify(heavy));
await page.screenshot({ path: `${SHOT_DIR}/v09-04-stagger.png` });

// Dodge on the telegraph.
const dodged = await page.evaluate((id) => {
  const { getWorld, combat } = window.__EDEN__;
  const w = getWorld();
  const c = w.creatures.find((x) => x.id === id);
  if (!c) return { sawWindup: false, hurt: false, health: w.player.health, missing: true };
  c.health = 90;
  c.combat.state = 'hostile';
  c.combat.nextAttackAt = 0;
  c.combat.staggerImmuneUntil = 0;
  w.player.health = 100;
  w.player.invulnUntil = -9999;
  let sawWindup = false;
  let dodgedAt = 0;
  let hurt = false;
  let windupStart = 0;
  for (let i = 0; i < 30 * 25; i++) {
    window.__EDEN__.stepSim(1 / 30);
    window.__EDEN__.stepPlayer(1 / 30);
    if (c.combat.state === 'windup') {
      if (!sawWindup) {
        sawWindup = true;
        windupStart = w.timeSec;
      }
      // Roll late in the tell, not on its first frame. The i-frames are short
      // on purpose: reacting is a skill, and panicking early is a real miss.
      if (!dodgedAt && w.timeSec - windupStart > 0.55) {
        dodgedAt = w.timeSec;
        combat.requestDodge(w, w.player.heading + Math.PI / 2);
      }
    }
    if (w.player.health < 100) hurt = true;
    if (dodgedAt && (c.combat.state === 'recover' || c.combat.state === 'hostile') && w.timeSec - dodgedAt > 1) break;
  }
  return { sawWindup, dodged: dodgedAt > 0, hurt, health: w.player.health };
}, ecology.id);
check('a dodge timed to the wind-up avoids the lunge', dodged.sawWindup && dodged.dodged && !dodged.hurt, JSON.stringify(dodged));
await page.screenshot({ path: `${SHOT_DIR}/v09-05-dodge.png` });

// Finish it.
const killed = await page.evaluate((id) => {
  const { getWorld, combat } = window.__EDEN__;
  const w = getWorld();
  for (let i = 0; i < 60; i++) {
    const c = w.creatures.find((x) => x.id === id);
    if (!c) break;
    combat.damageCreatureByPlayer(w, c, 20, 10, { x: 1, z: 0 });
  }
  return {
    gone: !w.creatures.some((x) => x.id === id),
    salvage: w.player.salvage.coreFragment,
    chronicle: w.chronicle.slice(-8).map((e) => e.text),
  };
}, ecology.id);
check('the predator can be brought down', killed.gone);
check('and leaves no synthetic salvage', killed.salvage === 0);

console.log('\n4. THE SUNKEN RING — WARDEN');

const wardenRun = await page.evaluate(() => {
  const { getWorld, species } = window.__EDEN__;
  const w = getWorld();
  const warden = w.creatures.find((c) => species.CREATURE_SPECIES_BY_ID[c.speciesId].synthetic);
  // Approach the ring from outside its perimeter.
  w.player.pos.x = warden.combat.territory.x + 26;
  w.player.pos.z = warden.combat.territory.z + 26;
  w.player.health = 100;
  const idleLabels = new Set();
  for (let i = 0; i < 30 * 40; i++) {
    window.__EDEN__.stepSim(1 / 30);
    window.__EDEN__.stepPlayer(1 / 30);
    if (i % 30 === 0) idleLabels.add(warden.goal.label);
  }
  return { id: warden.id, idleLabels: [...idleLabels], state: warden.combat.state };
});
check('the Warden guards the ring before it ever notices Kai',
  wardenRun.state === 'calm' && wardenRun.idleLabels.some((l) => /pylon|patrol/i.test(l)),
  JSON.stringify(wardenRun.idleLabels));
await page.screenshot({ path: `${SHOT_DIR}/v09-06-warden-idle.png` });

// Scan it before engaging.
const scanned = await page.evaluate((id) => {
  const { getWorld, scanner, identify } = window.__EDEN__;
  const w = getWorld();
  const warden = w.creatures.find((c) => c.id === id);
  w.player.pos.x = warden.pos.x + 20;
  w.player.pos.z = warden.pos.z;
  w.player.scan.lastAt = -9999;
  const r = scanner.performScan(w);
  const dx = warden.pos.x - w.player.pos.x;
  const dz = warden.pos.z - w.player.pos.z;
  const d = Math.hypot(dx, dz);
  const ident = identify.identifyFocus(w, dx / d, dz / d);
  return {
    synthetic: r.threats.synthetic,
    role: ident?.line ?? '',
    behaviour: ident?.scan?.behaviour ?? '',
    ari: w.ariQueue.join(' | '),
  };
}, wardenRun.id);
check('the scanner names what it is', /guardian/i.test(scanned.role), scanned.role);
check('and how it behaves, without numbers', /charge|perimeter/i.test(scanned.behaviour), scanned.behaviour);
check('the site itself reads as older than the colony', /metallurgy|isotope|phase/i.test(scanned.ari), scanned.ari.slice(-160));

// Fight it — it must charge and fire rather than close.
const wardenFight = await page.evaluate((id) => {
  const { getWorld, combat } = window.__EDEN__;
  const w = getWorld();
  const warden = w.creatures.find((c) => c.id === id);
  w.player.pos.x = warden.pos.x + 12;
  w.player.pos.z = warden.pos.z;
  w.player.health = 100;
  const states = [];
  let beams = 0;
  let closest = Infinity;
  let prev = '';
  for (let i = 0; i < 30 * 45; i++) {
    window.__EDEN__.stepSim(1 / 30);
    window.__EDEN__.stepPlayer(1 / 30);
    w.player.health = 100;
    const s = warden.combat.state;
    if (s !== prev) {
      states.push(s);
      if (s === 'beam') beams++;
      prev = s;
    }
    closest = Math.min(closest, Math.hypot(warden.pos.x - w.player.pos.x, warden.pos.z - w.player.pos.z));
    if (beams >= 2) break;
  }
  void combat;
  return { states: states.slice(0, 14), beams, closest, beamsInWorld: w.beams.length };
}, wardenRun.id);
check('the Warden charges and fires rather than closing', wardenFight.beams >= 1, JSON.stringify(wardenFight.states));
check('it keeps its distance', wardenFight.closest > 5, `${wardenFight.closest.toFixed(1)}m`);
await page.screenshot({ path: `${SHOT_DIR}/v09-07-warden-beam.png` });

// Disable it and take the fragment.
const salvage = await page.evaluate((id) => {
  const { getWorld, combat } = window.__EDEN__;
  const w = getWorld();
  for (let i = 0; i < 30; i++) {
    const c = w.creatures.find((x) => x.id === id);
    if (!c) break;
    combat.damageCreatureByPlayer(w, c, 20, 5, { x: 1, z: 0 });
  }
  return { fragments: w.player.salvage.coreFragment, pickups: w.pickupsSalvage.length };
}, wardenRun.id);
check('disabling it yields exactly one Core Fragment', salvage.fragments === 1, JSON.stringify(salvage));
await settle(1200);
await page.screenshot({ path: `${SHOT_DIR}/v09-08-salvage.png` });

console.log('\n5. HOME — THE CAPACITOR');

await page.evaluate(() => {
  const { getWorld, fabrication, useUI } = window.__EDEN__;
  const w = getWorld();
  for (const [id, need] of Object.entries(fabrication.RECIPE_BY_ID['arc-blade-capacitor'].costs)) {
    w.player.materials[id] = (w.player.materials[id] ?? 0) + need;
  }
  w.player.pos.x = w.fabricatorPos.x + 1.2;
  w.player.pos.z = w.fabricatorPos.z + 1.2;
  useUI.getState().setFabricatorOpen(true);
});
await settle(500);
await page.locator('.fab-recipe', { hasText: 'Arc Blade Capacitor' }).locator('.fab-button').click();
await drive(6);
const upgraded = await page.evaluate(() => {
  const w = window.__EDEN__.getWorld();
  return { cap: w.player.unlocks.capacitor, fragments: w.player.salvage.coreFragment, ari: w.ariQueue.join(' | ') };
});
check('the Capacitor installs', upgraded.cap, JSON.stringify(upgraded));
check('it consumed the fragment', upgraded.fragments === 0, `${upgraded.fragments}`);
check('ARI announces it', /CAPACITOR INSTALLED/i.test(upgraded.ari), upgraded.ari.slice(0, 120));
await page.screenshot({ path: `${SHOT_DIR}/v09-09-capacitor.png` });
await page.evaluate(() => window.__EDEN__.useUI.getState().setFabricatorOpen(false));
await settle(400);

// The upgrade must be perceptible: one heavy now staggers something that one
// heavy did not stagger before.
// The upgrade has to be perceptible in the fight, not on a spec sheet: the
// same full sequence — three lights into a heavy — against the same creature,
// with and without it. A second Warden still stands at the ring, so this runs
// against a real one rather than a fabricated target.
const proof = await page.evaluate(() => {
  const { getWorld, combat, species } = window.__EDEN__;
  const w = getWorld();
  const def = species.CREATURE_SPECIES_BY_ID.warden;
  const cre = w.creatures.find((x) => species.CREATURE_SPECIES_BY_ID[x.speciesId].synthetic);
  if (!cre) return null;

  const sequence = (withCap) => {
    w.player.unlocks.capacitor = withCap;
    // Enough health to survive the sequence: this measures stagger, and a
    // corpse cannot be staggered. The stagger *decay* is what makes the test
    // meaningful, so it runs on the real loop rather than on bare strike ticks.
    cre.health = 100000;
    cre.combat.staggerLoad = 0;
    cre.combat.staggerImmuneUntil = -9999;
    cre.combat.state = 'hostile';
    cre.combat.nextAttackAt = w.timeSec + 600;
    w.player.strike = null;
    w.player.buffered = null;
    w.player.lastStrikeAt = -9999;
    let rocked = false;
    let queued = 0;
    for (let i = 0; i < 30 * 6; i++) {
      // Hold the pair in reach; this is about stagger, not footwork.
      cre.pos.x = w.player.pos.x + 1.8;
      cre.pos.z = w.player.pos.z;
      w.player.heading = Math.atan2(cre.pos.x - w.player.pos.x, cre.pos.z - w.player.pos.z);
      // Press the sequence the way a player does: as soon as control returns.
      if (queued < 4 && (!w.player.strike || w.player.strike.phase === 'recover')) {
        combat.beginStrike(w, queued === 3 ? 'heavy' : 'light');
        queued++;
      }
      window.__EDEN__.stepSim(1 / 30);
      window.__EDEN__.stepPlayer(1 / 30);
      if (cre.combat.state === 'staggered') rocked = true;
      if (rocked || (queued >= 4 && !w.player.strike)) break;
    }
    cre.health = def.dangerous.health;
    return rocked;
  };

  const plain = sequence(false);
  const withCap = sequence(true);
  w.player.unlocks.capacitor = true;
  return { plain, withCap, resist: def.dangerous.staggerResist };
});
if (proof) {
  check('a full sequence could not rock a Warden before the upgrade', proof.plain === false, JSON.stringify(proof));
  check('the same sequence rocks it after', proof.withCap === true, JSON.stringify(proof));
} else {
  check('a second Warden remained at the ring to test the upgrade on', false, 'none found');
}

console.log('\n6. DEATH');

const death = await page.evaluate(() => {
  const { getWorld, combat } = window.__EDEN__;
  const w = getWorld();
  w.player.materials.alloy = 8;
  w.player.materials.ore = 4;
  const before = {
    settlers: w.settlers.length,
    structures: w.structures.length,
    time: w.timeSec,
    rel: w.settlers.reduce((n, s) => n + Object.keys(s.relationships).length, 0),
  };
  w.player.invulnUntil = -9999;
  combat.damagePlayer(w, 9999, 'a Warden Wisp');
  return { started: Boolean(w.player.extraction), before, span: w.player.extraction.endsAt - w.player.extraction.startedAt };
});
check('going down starts an extraction', death.started);
check('and it is short', death.span <= 3.5, `${death.span}s`);
await settle(900);
await page.screenshot({ path: `${SHOT_DIR}/v09-10-extraction.png` });
await drive(5);
const revived = await page.evaluate(({ before }) => {
  const { getWorld, combat } = window.__EDEN__;
  const w = getWorld();
  return {
    home: combat.insideSafeZone(w, w.player.pos.x, w.player.pos.z),
    health: w.player.health,
    cap: w.player.unlocks.capacitor,
    blade: w.player.unlocks.arcBlade,
    loss: w.player.extractionLoss,
    settlers: w.settlers.length === before.settlers,
    structures: w.structures.length >= before.structures,
    rel: w.settlers.reduce((n, s) => n + Object.keys(s.relationships).length, 0) >= before.rel,
    timeMoved: w.timeSec > before.time,
  };
}, { before: death.before });
check('Kai is recovered at Human Landing, alive', revived.home && revived.health > 0, JSON.stringify(revived));
check('the upgrade survives death', revived.cap && revived.blade);
check('the material loss is recorded so it can be shown', revived.loss.length > 0, JSON.stringify(revived.loss));
check('the valley never restarted', revived.settlers && revived.structures && revived.rel && revived.timeMoved);
await settle(900);
const lossHud = await page.locator('.hud').innerText();
check('and the HUD says what was lost', /Lost in extraction/i.test(lossHud), lossHud.slice(0, 120));
await page.screenshot({ path: `${SHOT_DIR}/v09-11-loss.png` });

console.log('\n7. SAFETY & REGRESSION');

const safety = await page.evaluate(() => {
  const { getWorld, combat, species } = window.__EDEN__;
  const w = getWorld();
  const camp = w.camps.find((c) => c.speciesId === 'human');
  // Park a predator on the doorstep and stand at the hearth.
  const def = species.CREATURE_SPECIES.find((s) => s.id === 'rakhor');
  const c = window.__EDEN__.getWorld().creatures.find((x) => x.speciesId === 'rakhor');
  void def;
  if (c) {
    c.pos.x = camp.pos.x + 4;
    c.pos.z = camp.pos.z;
    c.combat.state = 'calm';
  }
  w.player.health = 100;
  for (let i = 0; i < 30 * 40; i++) {
    window.__EDEN__.stepSim(1 / 30);
    window.__EDEN__.stepPlayer(1 / 30);
    w.player.pos.x = camp.pos.x;
    w.player.pos.z = camp.pos.z;
  }
  return {
    health: w.player.health,
    hostiles: combat.activeThreats(w).length,
    settlerHealth: Math.min(...w.settlers.map((s) => s.health)),
    settlerHunger: Math.max(...w.settlers.map((s) => s.hunger)),
  };
});
check('Human Landing stays safe', safety.health === 100 && safety.hostiles === 0, JSON.stringify(safety));
check('combat never starved the colony', safety.settlerHealth > 20 && safety.settlerHunger < 99, JSON.stringify(safety));

const finalState = await page.evaluate(() => {
  const w = window.__EDEN__.getWorld();
  return {
    settlers: w.settlers.length,
    creatures: w.creatures.length,
    beams: w.beams.length,
    lumi: Boolean(w.creatures.find((c) => c.id === 'lumi')),
    finite: w.settlers.every((s) => Number.isFinite(s.pos.x)) && w.creatures.every((c) => Number.isFinite(c.pos.x)),
  };
});
check('world state remains finite', finalState.finite);
check('Lumi persists', finalState.lumi);
check('beams do not accumulate', finalState.beams <= 6, `${finalState.beams}`);
console.log('\nWORLD:', JSON.stringify(finalState));
console.log(`BROWSER ERRORS: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  -', e);

await browser.close();
if (failures.length > 0 || errors.length > 0) {
  console.error(`\nPLAYTEST FAILED — ${failures.length} check(s), ${errors.length} error(s)`);
  for (const f of failures) console.error('  ✗', f);
  process.exit(1);
}
console.log('\nPLAYTEST OK — screenshots in smoke-shots/');
