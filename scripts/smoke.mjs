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
console.log('\nMOVEMENT BASIS (camera-relative, in the live app)');
// ---------------------------------------------------------------------------
const move = await page.evaluate(async () => {
  const { useUI, getWorld, input } = window.__EDEN__;
  const world = getWorld();
  useUI.getState().setPaused(true); // isolate player integration from the world
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
      const x0 = p.pos.x;
      const z0 = p.pos.z;
      input.inputState.keys.clear();
      input.inputState.keys.add(code);
      for (let i = 0; i < 12; i++) window.__EDEN__.stepPlayer(1 / 60);
      input.inputState.keys.clear();
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

    // Let the exchange settle for ~3 sim-seconds — the pair closes the last
    // step and turns to face. The conversation runs far longer than this, so
    // this is squarely what a passing player would actually see.
    for (let k = 0; k < 90; k++) window.__EDEN__.stepSim(1 / 30);
    if (pair.goal.phase !== 'act') continue; // ended early; keep looking

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
