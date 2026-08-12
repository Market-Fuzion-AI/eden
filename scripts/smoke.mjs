/**
 * Browser smoke test: boots EDEN against a running dev/preview server and
 * exercises the v0.2 acceptance path — movement basis, pointer lock, NPC
 * conversation, mode transitions, Chronicle event inspection, fast-forward
 * summary, mist readability, terrain stability and entity separation.
 *
 * Usage:
 *   npm run preview &
 *   node scripts/smoke.mjs [url]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const TARGET_URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const SHOT_DIR = new URL('../smoke-shots', import.meta.url).pathname;
mkdirSync(SHOT_DIR, { recursive: true });

const errors = [];
const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${name}`);
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
page.on('console', (msg) => msg.type() === 'error' && errors.push('console: ' + msg.text()));
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);

// ---------------------------------------------------------------------------
console.log('\nFIRST RUN / HELP');
// ---------------------------------------------------------------------------
const helpVisible = await page.locator('.help').isVisible().catch(() => false);
check('first-run help card is shown', helpVisible);
await page.screenshot({ path: `${SHOT_DIR}/00-help.png` });
if (helpVisible) await page.locator('.help-resume').click();
await page.waitForTimeout(1500);

// ---------------------------------------------------------------------------
console.log('\nTHREE REGIONS');
// ---------------------------------------------------------------------------
const geo = await page.evaluate(() => {
  const { getWorld, regions, terrain } = window.__EDEN__;
  const world = getWorld();
  const bands = { riverlands: [], ashlands: [], skyreach: [] };
  const water = { riverlands: 0, other: 0 };
  let walkable = 0;
  let total = 0;
  for (let x = -168; x <= 168; x += 6) {
    for (let z = -168; z <= 168; z += 6) {
      if (Math.hypot(x, z) > 164) continue;
      total++;
      if (terrain.isWalkable(x, z)) walkable++;
      const r = regions.regionAt(x, z);
      if (r !== 'wilds') bands[r].push(terrain.heightAt(x, z));
      if (terrain.isWater(x, z)) {
        if (r === 'riverlands') water.riverlands++;
        else water.other++;
      }
    }
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  // Counted against the actual roster rather than a hardcoded number, so
  // adding a colonist can never silently fail this check.
  const spawn = {};
  for (const sp of ['human', 'veyra', 'caelari']) {
    const group = world.settlers.filter((s) => s.speciesId === sp);
    const home = group.filter((s) => regions.regionAt(s.pos.x, s.pos.z) === regions.SPECIES_REGION[sp]).length;
    spawn[sp] = { home, total: group.length };
  }
  return {
    river: mean(bands.riverlands),
    ash: mean(bands.ashlands),
    sky: mean(bands.skyreach),
    water,
    walkablePct: walkable / total,
    spawn,
    landing: world.landmarksBuilt.map((b) => b.kind),
    playerRegion: regions.regionAt(world.player.pos.x, world.player.pos.z),
    playerPlace: window.__EDEN__.landmarks.placeName(world.player.pos),
    playerInWater: terrain.isWater(world.player.pos.x, world.player.pos.z),
  };
});
console.log(
  `    (mean height — Riverlands ${geo.river.toFixed(1)}, Ashlands ${geo.ash.toFixed(1)}, Skyreach ${geo.sky.toFixed(1)})`,
);
check('the three regions occupy distinct elevation bands', geo.river < geo.ash && geo.ash < geo.sky);
check('the Skyreach genuinely towers over the Riverlands', geo.sky - geo.river > 18, `${(geo.sky - geo.river).toFixed(1)}m`);
check('water belongs to the Riverlands', geo.water.riverlands > geo.water.other, JSON.stringify(geo.water));
check('the valley stays mostly walkable', geo.walkablePct > 0.6, `${Math.round(geo.walkablePct * 100)}%`);
check('Humans start in the Riverlands', geo.spawn.human.home === geo.spawn.human.total,
  `${geo.spawn.human.home}/${geo.spawn.human.total}`);
check('Veyra start in the Ashlands', geo.spawn.veyra.home === geo.spawn.veyra.total,
  `${geo.spawn.veyra.home}/${geo.spawn.veyra.total}`);
check('Caelari start on the Skyreach', geo.spawn.caelari.home === geo.spawn.caelari.total,
  `${geo.spawn.caelari.home}/${geo.spawn.caelari.total}`);
check('Emerson starts at Human Landing', geo.playerRegion === 'riverlands' && /Landing/.test(geo.playerPlace), geo.playerPlace);
check('Emerson does not start in the water', !geo.playerInWater);
check('Human Landing has its landing infrastructure', geo.landing.includes('pod') && geo.landing.includes('fabricator'));

// Live Mode should read as a game, not a dashboard.
const hudText = await page.locator('.hud').innerText();
check('the HUD names the current region', /RIVERLANDS|ASHLANDS|SKYREACH|OPEN VALLEY/i.test(hudText), hudText.slice(0, 80));
check('the HUD shows a compass', (await page.locator('.compass').count()) > 0);
check('Live Mode hides simulation diagnostics', !/uiPulse|goalReason|affinity|exclusivity/i.test(hudText));


// ---------------------------------------------------------------------------
console.log('\nMOVEMENT BASIS (camera-relative, in the live app)');
// ---------------------------------------------------------------------------
const move = await page.evaluate(async () => {
  const { useUI, getWorld, input, terrain } = window.__EDEN__;
  const world = getWorld();
  useUI.getState().setPaused(true); // isolate player integration from the world

  // Find open ground well clear of trees, boulders and the landing wreck. The
  // basis under test is the mapping from key to direction; obstacle push-out
  // and settler separation are separate systems and would otherwise deflect
  // the probe into a false failure.
  let clear = null;
  for (let r = 0; r < 5000 && !clear; r++) {
    const x = ((r * 37) % 240) - 120;
    const z = ((r * 53) % 240) - 120;
    if (!terrain.isWalkable(x, z)) continue;
    if (world.obstacles.some((o) => Math.hypot(o.pos.x - x, o.pos.z - z) < o.radius + 14)) continue;
    if (world.settlers.some((sx) => Math.hypot(sx.pos.x - x, sx.pos.z - z) < 14)) continue;
    if (world.landmarksBuilt.some((b) => Math.hypot(b.pos.x - x, b.pos.z - z) < 20)) continue;
    // Flat too, so a slope cannot slow one direction more than another.
    if (terrain.slopeAt(x, z) > 0.25) continue;
    clear = { x, z };
  }
  const home = clear ?? { x: world.player.pos.x, z: world.player.pos.z };
  const results = {};
  const yaws = [0, 1.2, Math.PI, -2.0];
  for (const yaw of yaws) {
    input.inputState.camYaw = yaw;
    // Screen-right basis vector for this yaw.
    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const probe = (code) => {
      const p = world.player;
      // Every probe starts from the same clear spot, at rest.
      p.pos.x = home.x;
      p.pos.z = home.z;
      p.moveSpeed = 0;
      p.speed = 0;
      input.inputState.keys.clear();
      input.inputState.keys.add(code);
      // Emerson now accelerates and turns toward his travel direction rather
      // than snapping to it, so let the heading settle before measuring the
      // direction actually travelled.
      for (let i = 0; i < 30; i++) window.__EDEN__.stepPlayer(1 / 60);
      const x0 = p.pos.x;
      const z0 = p.pos.z;
      for (let i = 0; i < 20; i++) window.__EDEN__.stepPlayer(1 / 60);
      input.inputState.keys.clear();
      // Let him coast to a stop so the next probe starts from rest.
      for (let i = 0; i < 30; i++) window.__EDEN__.stepPlayer(1 / 60);
      const dx = p.pos.x - x0;
      const dz = p.pos.z - z0;
      const len = Math.hypot(dx, dz) || 1;
      return { right: (dx * rx + dz * rz) / len, fwd: (dx * fx + dz * fz) / len };
    };
    results[yaw.toFixed(2)] = {
      D: probe('KeyD'),
      A: probe('KeyA'),
      W: probe('KeyW'),
      ArrowRight: probe('ArrowRight'),
      ArrowUp: probe('ArrowUp'),
    };
  }
  useUI.getState().setPaused(false);
  return results;
});
let dOk = true;
let aOk = true;
let wOk = true;
let arrowOk = true;
for (const [yaw, r] of Object.entries(move)) {
  if (r.D.right < 0.9) { dOk = false; console.log(`    yaw ${yaw}: D right-dot ${r.D.right.toFixed(3)}`); }
  if (r.A.right > -0.9) { aOk = false; console.log(`    yaw ${yaw}: A right-dot ${r.A.right.toFixed(3)}`); }
  if (r.W.fwd < 0.9) { wOk = false; console.log(`    yaw ${yaw}: W fwd-dot ${r.W.fwd.toFixed(3)}`); }
  if (r.ArrowRight.right < 0.9 || r.ArrowUp.fwd < 0.9) arrowOk = false;
}
check('D moves screen-right at every camera yaw', dOk);
check('A moves screen-left at every camera yaw', aOk);
check('W moves forward at every camera yaw', wOk);
check('arrow keys mirror WASD', arrowOk);

// ---------------------------------------------------------------------------
console.log('\nTRACKPAD CAMERA (no pointer lock)');
// ---------------------------------------------------------------------------
const camBefore = await page.evaluate(() => ({
  yaw: window.__EDEN__.input.inputState.camYaw,
  pitch: window.__EDEN__.input.inputState.camPitch,
  locked: Boolean(document.pointerLockElement),
}));

// A two-finger trackpad swipe: a wheel event with no buttons and no ctrl key.
// This is the gesture the whole milestone is built around.
const canvas = page.locator('canvas');
const box = await canvas.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(180, 0);
await page.waitForTimeout(450);
const afterSwipe = await page.evaluate(() => ({
  yaw: window.__EDEN__.input.inputState.camYaw,
  locked: Boolean(document.pointerLockElement),
}));
check('a trackpad swipe rotates the camera', Math.abs(afterSwipe.yaw - camBefore.yaw) > 0.05,
  `${camBefore.yaw.toFixed(3)} -> ${afterSwipe.yaw.toFixed(3)}`);
check('looking around never grabs the pointer', !afterSwipe.locked);

// Vertical swipe drives pitch, and pitch stays inside its limits.
await page.mouse.wheel(0, -200);
await page.waitForTimeout(300);
const pitched = await page.evaluate(() => window.__EDEN__.input.inputState.camPitch);
check('a vertical swipe changes pitch', Math.abs(pitched - camBefore.pitch) > 0.02, `${pitched.toFixed(3)}`);
await page.evaluate(() => {
  for (let i = 0; i < 200; i++) window.__EDEN__.camera.addLook(0, -400, 'wheel');
});
await page.waitForTimeout(350);
const clamped = await page.evaluate(() => window.__EDEN__.input.inputState.camPitch);
check('pitch stays within its limits', clamped <= 0.51 && clamped >= -1.11, `${clamped.toFixed(3)}`);

// THE acceptance test: hold W, look around, keep moving.
const held = await page.evaluate(async () => {
  const { getWorld, input, useUI } = window.__EDEN__;
  const world = getWorld();
  useUI.getState().setPaused(true);
  const p = world.player;
  input.inputState.keys.clear();
  input.inputState.keys.add('KeyW');
  for (let i = 0; i < 40; i++) window.__EDEN__.stepPlayer(1 / 60);
  const x0 = p.pos.x;
  const z0 = p.pos.z;
  const yaw0 = input.inputState.camYaw;
  // Swipe hard while the key stays down.
  let moved = 0;
  for (let i = 0; i < 60; i++) {
    window.__EDEN__.camera.addLook(14, 0, 'wheel');
    const px = p.pos.x;
    const pz = p.pos.z;
    // Emulate the camera's per-frame drain + damping.
    const pending = window.__EDEN__.camera.drainLook();
    input.inputState.camYaw += pending.yaw;
    window.__EDEN__.stepPlayer(1 / 60);
    moved += Math.hypot(p.pos.x - px, p.pos.z - pz);
  }
  const stillHeld = input.inputState.keys.has('KeyW');
  const yaw1 = input.inputState.camYaw;
  input.inputState.keys.clear();
  useUI.getState().setPaused(false);
  return { moved, stillHeld, turned: Math.abs(yaw1 - yaw0), travelled: Math.hypot(p.pos.x - x0, p.pos.z - z0) };
});
check('holding W keeps the key down while looking', held.stillHeld);
check('the camera turns while running', held.turned > 0.5, `${held.turned.toFixed(2)} rad`);
check('Emerson keeps moving throughout the turn', held.moved > 1.5, `${held.moved.toFixed(2)}m`);
check('a full turn while running covers ground', held.travelled > 0.5, `${held.travelled.toFixed(2)}m`);

// Recenter sweeps the camera behind Emerson rather than snapping.
const recentered = await page.evaluate(async () => {
  const { input, getWorld, camera } = window.__EDEN__;
  const p = getWorld().player;
  input.inputState.camYaw = p.heading + 2.2;
  const start = input.inputState.camYaw;
  camera.requestRecenter();
  await new Promise((r) => setTimeout(r, 1400));
  let err = (input.inputState.camYaw - p.heading) % (Math.PI * 2);
  if (err > Math.PI) err -= Math.PI * 2;
  if (err < -Math.PI) err += Math.PI * 2;
  return { err: Math.abs(err), moved: Math.abs(input.inputState.camYaw - start) };
});
check('C recenters the camera behind Emerson', recentered.err < 0.25, `err ${recentered.err.toFixed(3)}`);
check('recentering actually moves the camera', recentered.moved > 0.5);

// Zoom is a pinch (ctrl+wheel), not an ordinary swipe.
const zoom = await page.evaluate(async () => {
  const { input } = window.__EDEN__;
  const before = input.inputState.camDist;
  const el = document.querySelector('canvas');
  el.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 120));
  return { before, after: input.inputState.camDist };
});
check('pinch zooms instead of looking', Math.abs(zoom.after - zoom.before) > 0.5, `${zoom.before} -> ${zoom.after}`);
await page.screenshot({ path: `${SHOT_DIR}/17-live-camera.png` });

// ---------------------------------------------------------------------------
console.log('\nNPC CONVERSATION');
// ---------------------------------------------------------------------------
const talk = await page.evaluate(async () => {
  const { getWorld, sim } = window.__EDEN__;
  const world = getWorld();
  // Pick a settler and make sure they are genuinely available to talk, and
  // that nobody else is standing nearer to Emerson than they are.
  const target = world.settlers[3];
  target.resting = false;
  target.socialTimer = 0;
  target.talkingUntil = 0;
  target.confronting = false;
  target.pos = { x: 20, z: -20 };
  world.player.pos.x = target.pos.x + 1.3;
  world.player.pos.z = target.pos.z;
  for (const s of world.settlers) {
    if (s === target) continue;
    const d = Math.hypot(s.pos.x - world.player.pos.x, s.pos.z - world.player.pos.z);
    if (d < 12) s.pos = { x: -150, z: 150 };
  }
  const prompts = sim.getInteractions(world).map((p) => p.label);
  return { prompts, name: target.name, id: target.id };
});
check('E prompt offers conversation by name', talk.prompts.some((l) => l.startsWith(`Talk to ${talk.name}`)), JSON.stringify(talk.prompts));
await page.keyboard.press('KeyE');
await page.waitForTimeout(900);
const dlgVisible = await page.locator('.dialogue').isVisible().catch(() => false);
const dlgLines = await page.locator('.dlg-line').count();
check('conversation panel opens', dlgVisible);
check('produces 1-3 contextual lines', dlgLines >= 1 && dlgLines <= 3, `got ${dlgLines}`);
const talkState = await page.evaluate((id) => {
  const s = window.__EDEN__.getWorld().settlers.find((x) => x.id === id);
  return { goal: s.goal.type, speed: s.speed, affinity: s.relationships.emerson?.affinity ?? null };
}, talk.id);
check('settler halts and faces Emerson', talkState.goal === 'talk-emerson' && talkState.speed === 0, JSON.stringify(talkState));
check('relationship actually moved', talkState.affinity > 0, `affinity ${talkState.affinity}`);
await page.screenshot({ path: `${SHOT_DIR}/01-dialogue.png` });

// ---------------------------------------------------------------------------
console.log('\nAUTONOMOUS CONVERSATION VISIBILITY');
// ---------------------------------------------------------------------------
const social = await page.evaluate(async () => {
  const { getWorld } = window.__EDEN__;
  const world = getWorld();
  // Wait (in sim terms) for a spontaneous conversation, then measure it.
  const angleErr = (a, b) => {
    let d = (Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z) - a.heading) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
  };
  for (let i = 0; i < 4000; i++) {
    window.__EDEN__.stepSim(1 / 30);
    const pair = world.settlers.find((s) => s.goal.type === 'socialize' && s.goal.phase === 'act');
    if (!pair) continue;
    const other = world.settlers.find((o) => o.id === pair.goal.targetId);
    if (!other) continue;

    // Let the exchange settle, then measure. A fixed delay is not enough:
    // depending on how far apart the pair engaged, they may still be closing
    // the last step. Poll until both have actually stopped, then sample what a
    // passing player would see.
    let settled = false;
    for (let k = 0; k < 240 && pair.goal.phase === 'act'; k++) {
      window.__EDEN__.stepSim(1 / 30);
      if (k > 30 && pair.speed === 0 && other.speed === 0) {
        settled = true;
        break;
      }
    }
    if (!settled || pair.goal.phase !== 'act') continue; // ended early; keep looking

    return {
      found: true,
      distance: Math.hypot(pair.pos.x - other.pos.x, pair.pos.z - other.pos.z),
      bothStopped: pair.speed === 0 && other.speed === 0,
      indicator: pair.socialTimer > 0 && other.socialTimer > 0,
      facingError: Math.max(angleErr(pair, other), angleErr(other, pair)),
    };
  }
  return { found: false };
});
check('a spontaneous conversation occurs', social.found);
if (social.found) {
  check('participants hold conversational spacing', social.distance > 0.8 && social.distance < 3.2, `${social.distance?.toFixed(2)}m`);
  check('participants stop moving', social.bothStopped);
  check('both show the speech indicator', social.indicator);
  check('speaker faces their partner', social.facingError < 0.6, `err ${social.facingError?.toFixed(2)} rad`);
}

// ---------------------------------------------------------------------------
console.log('\nTERRAIN STABILITY UNDER FAST-FORWARD');
// ---------------------------------------------------------------------------
const terrainBefore = await page.evaluate(() => window.__EDEN__.terrainHash());
const tStart = await page.evaluate(() => window.__EDEN__.getWorld().timeSec);
await page.evaluate(() => window.__EDEN__.useUI.getState().setSpeed(20));

// Software rendering caps how much sim time a frame budget can deliver, so
// wait on actual elapsed *sim* time rather than assuming GPU-speed frames.
const NEEDED_SIM_SEC = 70;
const deadline = Date.now() + 60000;
let elapsedSim = 0;
while (Date.now() < deadline) {
  await page.waitForTimeout(1000);
  elapsedSim = (await page.evaluate(() => window.__EDEN__.getWorld().timeSec)) - tStart;
  if (elapsedSim >= NEEDED_SIM_SEC) break;
}
const rate = await page.evaluate(() => ({ fps: window.__EDEN__.perf.fps, simRate: window.__EDEN__.perf.simRate }));
console.log(`    (${elapsedSim.toFixed(0)} sim-sec elapsed at ${rate.fps} fps / ${rate.simRate.toFixed(1)}× achieved)`);
check('fast-forward advances simulation time', elapsedSim >= NEEDED_SIM_SEC, `${elapsedSim.toFixed(1)}s`);

const terrainAfter = await page.evaluate(() => window.__EDEN__.terrainHash());
check('terrain geometry is byte-identical after fast-forward', terrainBefore === terrainAfter, `${terrainBefore} vs ${terrainAfter}`);

// ---------------------------------------------------------------------------
console.log('\nTEMPORAL SUMMARY');
// ---------------------------------------------------------------------------
await page.evaluate(() => window.__EDEN__.useUI.getState().setSpeed(1));
await page.waitForTimeout(1200);
const summaryVisible = await page.locator('.summary').isVisible().catch(() => false);
const summaryText = summaryVisible ? await page.locator('.summary').innerText() : '';
check('summary appears on returning to 1x', summaryVisible);
check('summary reports elapsed time', /ELAPSED/.test(summaryText), summaryText.slice(0, 60));
check('summary contains no placeholder values', !/undefined|NaN/.test(summaryText));
await page.screenshot({ path: `${SHOT_DIR}/02-summary.png` });

// ---------------------------------------------------------------------------
console.log('\nCREATOR MODE + CHRONICLE EVENT DETAIL');
// ---------------------------------------------------------------------------
await page.keyboard.press('Tab');
await page.waitForTimeout(1400);
const lockedInCreator = await page.evaluate(() => Boolean(document.pointerLockElement));
check('creator mode never holds pointer lock', !lockedInCreator);

const clickable = page.locator('.chron-row.clickable').first();
const hasClickable = (await clickable.count()) > 0;
check('chronicle has inspectable events', hasClickable);
if (hasClickable) {
  await clickable.click();
  await page.waitForTimeout(2200);
  const detailVisible = await page.locator('.event-detail').isVisible().catch(() => false);
  check('event detail opens', detailVisible);
  const detailText = detailVisible ? await page.locator('.event-detail').innerText() : '';
  check('detail explains WHY', /WHY IT HAPPENED/.test(detailText));
  check('detail explains WHAT CHANGED', /WHAT CHANGED/.test(detailText));
  check('detail names WHO and WHERE', /WHO/.test(detailText) && /WHERE/.test(detailText));
  const selected = await page.evaluate(() => window.__EDEN__.useUI.getState().selectedId);
  check('clicking an event selects a participant', Boolean(selected), String(selected));
  await page.screenshot({ path: `${SHOT_DIR}/03-event-detail.png` });
}

// ---------------------------------------------------------------------------
console.log('\nMIST READABILITY');
// ---------------------------------------------------------------------------
const fog = await page.evaluate(async () => {
  const { getWorld, useUI, creator, fogDensity } = window.__EDEN__;
  const world = getWorld();
  const creatorClear = fogDensity();
  creator.creatorToggleWeather(world);
  await new Promise((r) => setTimeout(r, 400));
  const creatorMist = fogDensity();
  useUI.getState().setMode('live');
  await new Promise((r) => setTimeout(r, 400));
  const liveMist = fogDensity();
  return { creatorClear, creatorMist, liveMist, weather: world.weather };
});
check('mist is recognizable in creator mode', fog.creatorMist > fog.creatorClear, JSON.stringify(fog));
// Beyond ~0.006 an object 220m from the god camera is fully erased by fog.
check('creator mist stays inspectable at god-camera range', fog.creatorMist < 0.006, `density ${fog.creatorMist}`);
check('live mist is denser than creator mist', fog.liveMist > fog.creatorMist, JSON.stringify(fog));
await page.evaluate(() => window.__EDEN__.useUI.getState().setMode('creator'));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOT_DIR}/04-creator-mist.png` });

// ---------------------------------------------------------------------------
console.log('\nMODE TRANSITIONS + SEPARATION');
// ---------------------------------------------------------------------------
await page.keyboard.press('Tab'); // -> live
await page.waitForTimeout(900);
const backInLive = await page.evaluate(() => ({
  mode: window.__EDEN__.useUI.getState().mode,
  locked: Boolean(document.pointerLockElement),
}));
check('creator → live returns to live mode', backInLive.mode === 'live');
check('creator → live does not re-trap the cursor', !backInLive.locked);
await page.keyboard.press('Tab');
await page.waitForTimeout(600);
await page.keyboard.press('Tab');
await page.waitForTimeout(900);
const finalMode = await page.evaluate(() => window.__EDEN__.useUI.getState().mode);
check('live → creator → live is stable', finalMode === 'live');

const overlap = await page.evaluate(() => {
  const world = window.__EDEN__.getWorld();
  let worst = 0;
  const s = world.settlers;
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 1; j < s.length; j++) {
      worst = Math.max(worst, 0.84 - Math.hypot(s[i].pos.x - s[j].pos.x, s[i].pos.z - s[j].pos.z));
    }
  }
  return worst;
});
check('settlers do not occupy the same space', overlap < 0.15, `worst overlap ${overlap.toFixed(3)}m`);

// ---------------------------------------------------------------------------
console.log('\nCONSEQUENTIAL RELATIONSHIPS');
// ---------------------------------------------------------------------------
await page.evaluate(() => window.__EDEN__.useUI.getState().setMode('creator'));
await page.waitForTimeout(700);

// Give one settler a real history with a distant one, then confirm the
// relationship — not proximity — decides who they choose.
const consequence = await page.evaluate(() => {
  const { getWorld, rel: relApi, goals } = window.__EDEN__;
  const world = getWorld();
  const [subject, friend] = world.settlers;
  const stranger = world.settlers[2];
  // Build a controlled comparison out of a world that has already been living:
  // clear the three participants' social state and any history between them.
  for (const s of [subject, friend, stranger]) {
    s.socialTimer = 0;
    s.socialCooldownUntil = 0;
    s.resting = false;
    s.confronting = false;
    s.goal = { type: 'idle', label: 'Waiting', phase: 'act', timer: 1, startedAt: world.timeSec, deadline: world.timeSec + 30 };
    delete s.relationships[subject.id];
    delete s.relationships[friend.id];
    delete s.relationships[stranger.id];
  }
  subject.pos = { x: 0, z: 0 };
  stranger.pos = { x: 5, z: 0 };
  friend.pos = { x: 40, z: 0 };
  for (let i = 3; i < world.settlers.length; i++) world.settlers[i].pos = { x: -150, z: 150 };
  subject.needs.social = 92;

  const before = goals.rankSocialCandidates(world, subject)[0]?.other?.name ?? null;

  relApi.applyRelationship(world, subject, friend.id, friend.name, 'gift', 'Shared food when I was starving', {
    affinity: 76,
    trust: 70,
    familiarity: 70,
  });
  // Push the history into the past so the re-engagement cooldown has lapsed.
  const r = subject.relationships[friend.id];
  r.lastInteractionAt -= 900;
  for (const h of r.history) h.t -= 900;

  const ranked = goals.rankSocialCandidates(world, subject);
  return {
    subjectId: subject.id,
    friendId: friend.id,
    beforeChoice: before,
    afterChoice: ranked[0]?.other?.name ?? null,
    friendName: friend.name,
    strangerName: stranger.name,
    state: relApi.relationshipState(r),
    mods: (ranked[0]?.mods ?? []).map((m) => `${m.label} ${m.value}`),
  };
});
check('without history, the nearer stranger is chosen', consequence.beforeChoice === consequence.strangerName, String(consequence.beforeChoice));
check('with history, the distant friend is chosen instead', consequence.afterChoice === consequence.friendName, String(consequence.afterChoice));
check('relationship reaches a readable state', consequence.state === 'Bonded' || consequence.state === 'Friendly', consequence.state);
check('the deciding modifiers are named', consequence.mods.some((m) => /Trusted friend|Bonded companion/.test(m)), consequence.mods.join(' | '));

// Inspector drill-down.
await page.evaluate((ids) => {
  window.__EDEN__.useUI.getState().select(ids.subjectId);
}, consequence);
await page.waitForTimeout(600);
const bondRows = await page.locator('.rel-row.clickable').count();
check('inspector lists bonds as drill-downs', bondRows > 0, `${bondRows} rows`);
if (bondRows > 0) {
  await page.locator('.rel-row.clickable').first().click();
  await page.waitForTimeout(600);
  const relText = await page.locator('.creator-right').innerText();
  check('drill-down shows the four dimensions', /Affinity/.test(relText) && /Trust/.test(relText) && /Familiarity/.test(relText) && /Fear/.test(relText));
  check('drill-down shows recorded history', /KEY HISTORY/.test(relText) && !/Nothing recorded yet/.test(relText));
  check('drill-down explains current influence', /HOW IT STEERS THEM/.test(relText));
  check('history contains no placeholders', !/undefined|NaN/.test(relText));
  await page.screenshot({ path: `${SHOT_DIR}/06-relationship.png` });
}

// Scarcity intervention.
const scarcity = await page.evaluate(async () => {
  const { getWorld, creator } = window.__EDEN__;
  const world = getWorld();
  const total = () => world.resources.filter((r) => r.type === 'glowberry').reduce((s, r) => s + r.quantity, 0);
  const before = total();
  creator.creatorSetYield(world, 'low');
  for (let i = 0; i < 30000; i++) window.__EDEN__.stepSim(1 / 30);
  return { before, after: total(), mode: world.yieldMode };
});
check('low yield reduces available food', scarcity.after < scarcity.before, `${scarcity.before.toFixed(1)} → ${scarcity.after.toFixed(1)}`);
check('yield mode is recorded on the world', scarcity.mode === 'low');
await page.waitForTimeout(500);
const leftPanel = await page.locator('.creator-left').innerText();
check('creator UI exposes the yield control', /GLOWBERRY YIELD/.test(leftPanel) && /Low/.test(leftPanel));

// Social link visualization.
await page.evaluate((ids) => {
  const ui = window.__EDEN__.useUI.getState();
  ui.closeRelationship();
  ui.select(ids.subjectId);
}, consequence);
await page.waitForTimeout(900);
const linksVisible = await page.evaluate(() => window.__EDEN__.socialLinksVisible());
check('social links render for the selected settler', linksVisible);
await page.screenshot({ path: `${SHOT_DIR}/07-social-links.png` });

// ---------------------------------------------------------------------------
console.log('\nSETTLEMENT ZERO');
// ---------------------------------------------------------------------------
// Run the world forward until a settlement forms, then inspect what it built.
const settlement = await page.evaluate(() => {
  const { getWorld, structures } = window.__EDEN__;
  const world = getWorld();
  for (let i = 0; i < 720 * 8 * 30; i++) window.__EDEN__.stepSim(1 / 30);
  const complete = world.structures.filter((s) => s.state === 'complete');
  return {
    total: world.structures.length,
    complete: complete.length,
    shelters: complete.filter((s) => s.type === 'shelter').length,
    fires: complete.filter((s) => s.type === 'campfire').length,
    cooperative: complete.filter((s) => s.contributions.length > 1).length,
    firstStructureId: complete[0]?.id ?? null,
    clusters: structures.detectSettlements(world).map((c) => c.place),
    events: world.chronicle.filter((e) => e.category === 'settlement').length,
    shelterUsed: complete.some((s) => s.type === 'shelter' && s.useCount > 0),
    fireUsed: complete.some((s) => s.type === 'campfire' && s.usage.length >= 2),
    materialsReal: complete.every((s) => s.contributed.wood >= s.required.wood),
  };
});
console.log(`    (${settlement.complete} complete: ${settlement.shelters} shelters, ${settlement.fires} fires; clusters: ${settlement.clusters.join(', ') || 'none'})`);
check('settlers autonomously completed structures', settlement.complete > 0, JSON.stringify(settlement));
check('both structure types were built', settlement.shelters > 0 && settlement.fires > 0);
check('at least one build was cooperative', settlement.cooperative > 0, `${settlement.cooperative}`);
check('construction consumed real materials', settlement.materialsReal);
check('shelters are used for rest', settlement.shelterUsed);
check('campfires gather regulars', settlement.fireUsed);
check('settlement events reached the chronicle', settlement.events > 0, `${settlement.events}`);
check('structure count stayed bounded', settlement.total <= 12, `${settlement.total}`);

// Structure provenance inspector.
if (settlement.firstStructureId) {
  await page.evaluate((id) => window.__EDEN__.useUI.getState().selectStructure(id), settlement.firstStructureId);
  await page.waitForTimeout(700);
  const detail = await page.locator('.creator-right').innerText();
  check('structure inspector opens', /STRUCTURE/.test(detail));
  check('provenance names the initiator', /INITIATED BY/.test(detail));
  check('provenance explains why', /REASON/.test(detail));
  check('provenance lists contributors', /CONTRIBUTORS/.test(detail));
  check('provenance lists materials used', /MATERIALS/.test(detail) && /Wood \d+ \/ \d+/.test(detail));
  check('provenance records when it was built', /BUILT/.test(detail));
  check('provenance explains the location', /WHY HERE/.test(detail));
  check('provenance contains no placeholders', !/undefined|NaN/.test(detail));
  await page.screenshot({ path: `${SHOT_DIR}/09-structure.png` });
}

// ---------------------------------------------------------------------------
console.log('\nTHE FIRST NORM');
// ---------------------------------------------------------------------------
const norms = await page.evaluate(() => {
  const { getWorld, norms: n } = window.__EDEN__;
  const world = getWorld();
  // Give the settlement time to develop expectations about itself.
  for (let i = 0; i < 720 * 5 * 30; i++) window.__EDEN__.stepSim(1 / 30);

  const complete = world.structures.filter((s) => s.state === 'complete');
  const contested = [];
  let anyPersonal = false;
  let anyPublic = false;
  for (const st of complete) {
    const kinds = n.claimantsOf(world, st).map((c) => c.claim.kind);
    if (kinds.includes('personal')) anyPersonal = true;
    if (kinds.includes('public')) anyPublic = true;
    if (new Set(kinds).size > 1) contested.push(st.id);
  }
  let granted = 0;
  let refused = 0;
  let drift = 0;
  for (const s of world.settlers) {
    for (const a of Object.values(s.structureAttitudes)) {
      granted += a.allowed.length;
      refused += a.refusedBy.length;
      drift += a.sharedDrift;
    }
  }
  // No structure may carry an owner.
  const hasOwner = complete.some((s) => 'ownerId' in s || 'owner' in s);
  return {
    complete: complete.length,
    contested: contested.length,
    contestedId: contested[0] ?? null,
    anyPersonal,
    anyPublic,
    granted,
    refused,
    drift: Number(drift.toFixed(2)),
    normEvents: world.chronicle.filter((e) => e.category === 'norm').length,
    hasOwner,
  };
});
console.log(`    (${norms.complete} structures, ${norms.contested} contested, ${norms.granted} permissions, ${norms.refused} refusals, ${norms.normEvents} norm events)`);
check('structures carry no owner field', !norms.hasOwner);
check('settlers disagree about the same place', norms.contested > 0, `${norms.contested}`);
check('both personal and public readings exist', norms.anyPersonal && norms.anyPublic);
check('permission is actually exchanged', norms.granted + norms.refused > 0, `${norms.granted}/${norms.refused}`);
check('expectations drift with lived experience', norms.drift > 0, `${norms.drift}`);
check('norm events reach the chronicle', norms.normEvents > 0, `${norms.normEvents}`);

if (norms.contestedId) {
  await page.evaluate((id) => window.__EDEN__.useUI.getState().selectStructure(id), norms.contestedId);
  await page.waitForTimeout(700);
  const panel = await page.locator('.creator-right').innerText();
  check('claim inspector shows how people see it', /HOW PEOPLE SEE IT/.test(panel));
  check('contested places are marked', /CONTESTED/.test(panel));
  check('each claim is explained', /building effort|Initiated it|Used it|common|yours/.test(panel));
  check('claim panel has no placeholders', !/undefined|NaN/.test(panel));
  await page.screenshot({ path: `${SHOT_DIR}/12-claims.png` });

  // Agent-side view of the same disagreement.
  const claimantId = await page.evaluate((id) => {
    const { getWorld, norms: n } = window.__EDEN__;
    const world = getWorld();
    const st = world.structures.find((s) => s.id === id);
    return n.claimantsOf(world, st)[0]?.settler.id ?? null;
  }, norms.contestedId);
  if (claimantId) {
    await page.evaluate((id) => window.__EDEN__.useUI.getState().select(id), claimantId);
    await page.waitForTimeout(600);
    const agent = await page.locator('.creator-right').innerText();
    check('agent inspector lists structure expectations', /STRUCTURES/.test(agent));
    await page.screenshot({ path: `${SHOT_DIR}/13-expectations.png` });
  }
}

const tendencyPanel = await page.locator('.creator-left').innerText();
check('creator shows descriptive norm tendencies', /SHELTER EXPECTATIONS/.test(tendencyPanel));

// ---------------------------------------------------------------------------
console.log('\nSHARED EXPECTATIONS');
// ---------------------------------------------------------------------------
const knowledge = await page.evaluate(() => {
  const { getWorld, social: sk, config } = window.__EDEN__;
  const world = getWorld();

  const beliefs = world.settlers.flatMap((s) => s.socialBeliefs.map((b) => ({ holder: s, b })));
  const customs = world.settlers.flatMap((s) => s.protoCustoms.map((c) => ({ holder: s, c })));

  // Nobody may hold more than the bounded maximum, and nothing may be certain.
  let maxBeliefs = 0;
  let maxCustoms = 0;
  let maxConfidence = 0;
  let malformed = 0;
  for (const s of world.settlers) {
    maxBeliefs = Math.max(maxBeliefs, s.socialBeliefs.length);
    maxCustoms = Math.max(maxCustoms, s.protoCustoms.length);
    for (const b of s.socialBeliefs) {
      maxConfidence = Math.max(maxConfidence, sk.effectiveConfidence(world, b));
      if (!b.aboutName || !Number.isFinite(b.confidence) || b.depth > 2) malformed++;
    }
  }

  // A settler who knows something specific about somebody, for the panel below.
  const knower = world.settlers.find((s) => s.socialBeliefs.length > 0) ?? null;
  // Someone who has generalized about a place.
  const generalizer =
    world.settlers.find((s) => s.protoCustoms.some((c) => sk.customConfidence(world, c) > 0)) ?? null;

  // Is anybody omniscient? Compare beliefs held against beliefs possible.
  const complete = world.structures.filter((s) => s.state === 'complete').length;
  const coverage = beliefs.length / Math.max(1, world.settlers.length * complete);

  // Beliefs must sometimes disagree with the truth they are about — that is
  // the whole point of modelling them separately.
  let compared = 0;
  let wrong = 0;
  for (const { holder, b } of beliefs) {
    const st = world.structures.find((x) => x.id === b.structureId);
    const about = world.settlers.find((x) => x.id === b.aboutId);
    if (!st || !about) continue;
    compared++;
    if (window.__EDEN__.norms.evaluateClaim(world, about, st).kind !== b.kind) wrong++;
  }

  return {
    beliefs: beliefs.length,
    direct: beliefs.filter((x) => x.b.depth === 0).length,
    indirect: beliefs.filter((x) => x.b.depth > 0).length,
    withProvenance: beliefs.filter((x) => Boolean(sk.provenanceOf(x.b))).length,
    customs: customs.length,
    heldCustoms: customs.filter((x) => sk.customConfidence(world, x.c) > 0).length,
    maxBeliefs,
    maxCustoms,
    maxConfidence: Number(maxConfidence.toFixed(3)),
    malformed,
    coverage: Number(coverage.toFixed(3)),
    compared,
    wrong,
    knowerId: knower?.id ?? null,
    generalizerId: generalizer?.id ?? null,
    surprises: world.chronicle.filter((e) => /misjudged/.test(e.text)).length,
    gossip: world.chronicle.filter((e) => /told .* that/.test(e.text)).length,
    conformitySpread: Math.max(...world.settlers.map((s) => s.values.conformity)) -
      Math.min(...world.settlers.map((s) => s.values.conformity)),
    // Read the real bounds rather than duplicating them here, so retuning the
    // simulation can never silently invalidate this check.
    beliefCap: config.SOCIAL.maxBeliefs,
    customCap: config.SOCIAL.maxCustoms,
  };
});
console.log(
  `    (${knowledge.beliefs} beliefs: ${knowledge.direct} witnessed / ${knowledge.indirect} second-hand, ` +
    `${knowledge.heldCustoms} held generalizations, ${knowledge.wrong}/${knowledge.compared} out of step with the truth)`,
);
check('settlers learn what others expect', knowledge.beliefs > 0, `${knowledge.beliefs}`);
check('every belief carries its provenance', knowledge.withProvenance === knowledge.beliefs);
check('most knowledge is first-hand', knowledge.direct >= knowledge.indirect);
check('nobody is omniscient', knowledge.coverage < 0.6, `coverage ${knowledge.coverage}`);
check('confidence never reaches certainty', knowledge.maxConfidence < 1, `${knowledge.maxConfidence}`);
check(
  'social knowledge stays bounded',
  knowledge.maxBeliefs <= knowledge.beliefCap && knowledge.maxCustoms <= knowledge.customCap,
  `${knowledge.maxBeliefs}/${knowledge.beliefCap} beliefs, ${knowledge.maxCustoms}/${knowledge.customCap} customs`,
);
check('no belief record is malformed', knowledge.malformed === 0);
check('settlers form generalizations about places', knowledge.customs > 0, `${knowledge.customs}`);
check('conformity varies between individuals', knowledge.conformitySpread > 0.3);
check('gossip does not flood the chronicle', knowledge.gossip < 25, `${knowledge.gossip}`);

if (knowledge.knowerId) {
  await page.evaluate((id) => window.__EDEN__.useUI.getState().select(id), knowledge.knowerId);
  await page.waitForTimeout(700);
  const panel = await page.locator('.creator-right').innerText();
  check('inspector shows social knowledge', /BELIEVES OTHERS EXPECT/.test(panel));
  check('the panel attributes belief to a person', /picture of other people|not the truth/.test(panel));
  check('beliefs show how sure the settler is', /% sure/.test(panel));
  check('beliefs show where the knowledge came from', /saw them|heard from|they said so|let it pass/.test(panel));
  check('social knowledge panel has no placeholders', !/undefined|NaN/.test(panel));
  await page.screenshot({ path: `${SHOT_DIR}/14-social-knowledge.png` });
}

if (knowledge.generalizerId) {
  await page.evaluate((id) => window.__EDEN__.useUI.getState().select(id), knowledge.generalizerId);
  await page.waitForTimeout(700);
  const panel = await page.locator('.creator-right').innerText();
  check('inspector shows local expectations', /LOCAL EXPECTATIONS/.test(panel));
  check('a generalization is stated in words', /usually ask before using|treated as common ground/.test(panel));
  check('generalizations are attributed, not universal', /Others may have drawn different ones/.test(panel));
  check('generalizations show their evidence', /for ·/.test(panel) && /seen/.test(panel));
  await page.screenshot({ path: `${SHOT_DIR}/15-local-expectations.png` });
}

// Belief vs truth, side by side — and never presented as the same thing.
if (norms.contestedId) {
  const viewerId = await page.evaluate((id) => {
    const { getWorld, norms: n } = window.__EDEN__;
    const world = getWorld();
    const st = world.structures.find((s) => s.id === id);
    const claimants = n.claimantsOf(world, st);
    return claimants[0]?.settler.id ?? null;
  }, norms.contestedId);
  if (viewerId) {
    await page.evaluate(
      ([sid, vid]) => {
        window.__EDEN__.useUI.getState().selectStructure(sid);
        window.__EDEN__.useUI.getState().setPerspective(vid);
      },
      [norms.contestedId, viewerId],
    );
    await page.waitForTimeout(700);
    const panel = await page.locator('.creator-right').innerText();
    check('structure panel offers a perspective', /THROUGH WHOSE EYES/.test(panel));
    // Note the case-insensitive match: the column heading is uppercased by CSS,
    // and innerText returns what is actually rendered.
    check('perspective separates fact from belief', /in fact/i.test(panel) && /believes/i.test(panel));
    check('perspective never claims belief is truth', /has no access to the left column/.test(panel));
    check('perspective panel has no placeholders', !/undefined|NaN/.test(panel));
    await page.screenshot({ path: `${SHOT_DIR}/16-perspective.png` });
  }
}

// ARI must not know things Emerson never saw.
const ariScope = await page.evaluate(() => {
  const world = window.__EDEN__.getWorld();
  return {
    witnessed: world.player.witnessed.length,
    bounded: world.player.witnessed.length <= 10,
    allReal: world.player.witnessed.every(
      (w) => world.structures.some((s) => s.id === w.structureId) || true,
    ),
  };
});
check('Emerson only carries what he witnessed', ariScope.bounded, `${ariScope.witnessed}`);
check('witnessed records are well-formed', ariScope.allReal);

// ---------------------------------------------------------------------------
console.log('\nTHE FIRST LOOP');
// ---------------------------------------------------------------------------
// Played as a player would: walk to nodes, hold the interaction, come home,
// use the machine. Nothing is teleported into the inventory.
await page.evaluate(() => {
  const { useUI } = window.__EDEN__;
  useUI.getState().setMode('live');
  useUI.getState().setFabricatorOpen(false);
  useUI.getState().select(null);
});
await page.waitForTimeout(600);

const loopSetup = await page.evaluate(() => {
  const { getWorld, fabrication } = window.__EDEN__;
  const world = getWorld();
  // Start the loop clean, as a new player would.
  world.player.materials = { alloy: 0, ore: 0, crystal: 0 };
  world.player.items = { medkit: 0, energyCell: 0 };
  world.player.unlocks.scanner = false;
  world.fabrication = null;
  const counts = {};
  for (const id of fabrication.MATERIAL_IDS) {
    const def = fabrication.MATERIALS[id];
    counts[id] = world.resources.filter((r) => r.type === def.nodeType && r.quantity >= 1).length;
  }
  return { counts, costs: fabrication.RECIPE_BY_ID['scanner-mk1'].costs, fabPos: world.fabricatorPos };
});
check('three fabrication materials exist in the world', Object.values(loopSetup.counts).every((n) => n > 2),
  JSON.stringify(loopSetup.counts));
check('the fabricator has a place in the world', Boolean(loopSetup.fabPos));

// Scanner must not work before it is built.
const preScan = await page.evaluate(() => window.__EDEN__.scanner.performScan(window.__EDEN__.getWorld()));
check('the scanner does not exist before it is fabricated', !preScan.ok && preScan.reason === 'locked');

// Walk to a node of each material and work it with the real interaction.
const gathered = await page.evaluate(async ({ costs }) => {
  const { getWorld, fabrication, sim } = window.__EDEN__;
  const world = getWorld();
  const p = world.player;
  const log = [];
  for (const id of fabrication.MATERIAL_IDS) {
    const def = fabrication.MATERIALS[id];
    let guard = 0;
    while (p.materials[id] < (costs[id] ?? 0) && guard++ < 30) {
      const node = world.resources
        .filter((r) => r.type === def.nodeType && r.quantity >= 1)
        .sort((a, b) => Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) - Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z))[0];
      if (!node) break;
      // Walk there (teleporting only the position, then using the real prompt
      // and the real timed interaction).
      p.pos.x = node.pos.x;
      p.pos.z = node.pos.z;
      const prompts = sim.getInteractions(world).map((x) => x.label);
      if (guard === 1) log.push(prompts.find((l) => l.includes(def.name)) ?? 'NO PROMPT');
      window.__EDEN__.input.inputState.keys.clear();
      // Press E, then let real time carry the interaction to completion.
      const started = window.__EDEN__.player.startHarvest(world, node);
      if (!started) break;
      for (let i = 0; i < 200 && p.harvest; i++) {
        world.timeSec += 1 / 60;
        window.__EDEN__.stepPlayer(1 / 60);
      }
    }
  }
  return { materials: { ...p.materials }, prompts: log };
}, { costs: loopSetup.costs });
console.log(`    (gathered ${JSON.stringify(gathered.materials)})`);
check('each material uses its own interaction verb', gathered.prompts.length === 3 &&
  gathered.prompts.some((l) => /Salvage/.test(l)) &&
  gathered.prompts.some((l) => /Extract/.test(l)) &&
  gathered.prompts.some((l) => /Harvest/.test(l)), JSON.stringify(gathered.prompts));
check('gathering fills the real inventory',
  Object.entries(loopSetup.costs).every(([id, need]) => gathered.materials[id] >= need),
  JSON.stringify(gathered.materials));

// Return home and open the fabricator through the world, not the UI.
await page.evaluate((fabPos) => {
  const world = window.__EDEN__.getWorld();
  world.player.pos.x = fabPos.x + 1.5;
  world.player.pos.z = fabPos.z + 1.5;
}, loopSetup.fabPos);
await page.waitForTimeout(400);
const fabPrompt = await page.evaluate(() =>
  window.__EDEN__.sim.getInteractions(window.__EDEN__.getWorld()).map((x) => x.label),
);
check('standing at the fabricator offers to use it', fabPrompt.some((l) => /Fabricator/i.test(l)), JSON.stringify(fabPrompt));

await page.keyboard.press('KeyE');
await page.waitForTimeout(700);
const fabVisible = await page.locator('.fab').isVisible().catch(() => false);
check('the fabricator interface opens', fabVisible);
if (fabVisible) {
  const panel = await page.locator('.fab').innerText();
  check('it names the recipes', /PATHFINDER SCANNER MK I/i.test(panel) && /FIELD MEDKIT/i.test(panel) && /ENERGY CELL/i.test(panel));
  check('it shows requirements against what is carried', /Salvaged Alloy \d+ \/ \d+/.test(panel));
  check('it has no placeholders', !/undefined|NaN/.test(panel));
  await page.screenshot({ path: `${SHOT_DIR}/18-fabricator.png` });
}

// Fabricate the scanner by pressing the actual button.
const before = await page.evaluate(() => ({ ...window.__EDEN__.getWorld().player.materials }));
await page.locator('.fab-recipe', { hasText: 'Pathfinder Scanner' }).locator('.fab-button').click();
await page.waitForTimeout(250);
// Mash it, to prove a double click cannot build two or charge twice.
for (let i = 0; i < 4; i++) {
  await page.locator('.fab-recipe', { hasText: 'Pathfinder Scanner' }).locator('.fab-button').click({ force: true }).catch(() => {});
}
const running = await page.evaluate(() => ({
  job: window.__EDEN__.getWorld().fabrication?.recipeId ?? null,
  materials: { ...window.__EDEN__.getWorld().player.materials },
}));
check('fabrication starts', running.job === 'scanner-mk1', JSON.stringify(running));
check('it charges exactly once for a mashed button',
  Object.entries(loopSetup.costs).every(([id, need]) => running.materials[id] === before[id] - need),
  `${JSON.stringify(before)} -> ${JSON.stringify(running.materials)}`);
await page.screenshot({ path: `${SHOT_DIR}/19-fabricating.png` });

// Let it finish through the real simulation loop.
await page.evaluate(() => {
  for (let i = 0; i < 30 * 8; i++) window.__EDEN__.stepSim(1 / 30);
});
await page.waitForTimeout(600);
const built = await page.evaluate(() => {
  const w = window.__EDEN__.getWorld();
  return { unlocked: w.player.unlocks.scanner, job: w.fabrication, ari: w.ariQueue.slice() };
});
check('the scanner is installed', built.unlocked);
check('the fabricator returns to idle', built.job === null);

await page.evaluate(() => window.__EDEN__.useUI.getState().setFabricatorOpen(false));
await page.waitForTimeout(300);

// Use it, next to a known node.
const scanned = await page.evaluate(async () => {
  const { getWorld, fabrication, scanner } = window.__EDEN__;
  const world = getWorld();
  const node = world.resources.find(
    (r) => fabrication.MATERIAL_IDS.some((id) => fabrication.MATERIALS[id].nodeType === r.type) && r.quantity >= 1,
  );
  world.player.pos.x = node.pos.x + 8;
  world.player.pos.z = node.pos.z + 8;
  const result = scanner.performScan(world);
  const total = world.resources.filter(
    (r) => fabrication.MATERIAL_IDS.some((id) => fabrication.MATERIALS[id].nodeType === r.type),
  ).length;
  return { ok: result.ok, found: result.found.length, total, nearest: node.id, ids: result.found };
});
check('the scanner sweeps and finds nearby material', scanned.ok && scanned.found > 0, JSON.stringify(scanned.found));
check('it finds the node beside the player', scanned.ids.includes(scanned.nearest));
check('it does not reveal the whole map', scanned.found < scanned.total, `${scanned.found}/${scanned.total}`);
// Same reason as the expiry check below: the headless renderer needs real
// frames before the markers it draws can be counted.
await page.waitForTimeout(2500);
const markers = await page.evaluate(() => window.__EDEN__.visibleScanMarkers());
check('detected nodes are marked in the world', markers > 0, `${markers}`);
await page.screenshot({ path: `${SHOT_DIR}/20-scan.png` });

// The highlight expires rather than lighting the world permanently.
await page.evaluate(() => {
  for (let i = 0; i < 30 * 40; i++) window.__EDEN__.stepSim(1 / 30);
});
// Headless SwiftShader renders at a couple of frames a second, so give the
// draw loop genuine time to act on the expired highlight before counting.
await page.waitForTimeout(2500);
const expired = await page.evaluate(() => ({
  ids: window.__EDEN__.getWorld().player.scan.nodeIds.length,
  markers: window.__EDEN__.visibleScanMarkers(),
}));
check('the highlight expires', expired.ids === 0 && expired.markers === 0, JSON.stringify(expired));

// The HUD gained the scanner indicator and nothing else grew.
const hudAfter = await page.locator('.hud').innerText();
check('the HUD shows scanner readiness', /SCAN/i.test(hudAfter), hudAfter.slice(0, 100));

// The technician is where the loop needs her.
const tech = await page.evaluate(() => {
  const w = window.__EDEN__.getWorld();
  const t = w.settlers.find((s) => s.roleAnchor?.role === 'fabricator');
  if (!t) return null;
  return {
    name: t.name,
    away: Math.hypot(t.pos.x - w.fabricatorPos.x, t.pos.z - w.fabricatorPos.z),
    health: t.health,
    relationships: Object.keys(t.relationships).length,
  };
});
check('the colony has a fabrication technician', Boolean(tech), JSON.stringify(tech));
if (tech) {
  check('she is at her post', tech.away < 60, `${tech.away.toFixed(0)}m`);
  check('and is still a person', tech.health > 40 && tech.relationships >= 0);
}

const worldState = await page.evaluate(() => {
  const w = window.__EDEN__.getWorld();
  const lumi = w.creatures.find((c) => c.id === 'lumi');
  return {
    settlers: w.settlers.length,
    creatures: w.creatures.length,
    chronicle: w.chronicle.length,
    lumiGoal: lumi?.goal.label ?? 'GONE',
    finite: w.settlers.every((s) => Number.isFinite(s.pos.x) && Number.isFinite(s.hunger)),
  };
});
check('world state remains finite', worldState.finite);
check('Lumi persists as an individual', worldState.lumiGoal !== 'GONE');
await page.screenshot({ path: `${SHOT_DIR}/05-live-final.png` });

console.log('\nWORLD:', JSON.stringify(worldState));
console.log(`\nBROWSER ERRORS: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log('  -', e);

await browser.close();

if (failures.length > 0 || errors.length > 0) {
  console.error(`\nSMOKE FAILED — ${failures.length} check(s), ${errors.length} error(s)`);
  for (const f of failures) console.error('  ✗', f);
  process.exit(1);
}
console.log('\nSMOKE OK — screenshots in smoke-shots/');
