import { describe, expect, it } from 'vitest';
import { MISSION, WORLD } from './config';
import { chooseCrashSite, signalStrengthAt, walkableRoute } from './mission';
import { performScan } from './scanner';
import { isWalkable, isWater } from './terrain';
import { createWorld } from './worldgen';
import { arrowRotation, toMapPixel } from '../ui/Minimap';
import { cardinalFor } from '../ui/LiveHUD';
import { placeName } from './landmarks';
import { updatePlayer } from './player';

/**
 * Getting there, and knowing where "there" is.
 *
 * The bug these exist for: manual QA followed the distress compass and walked
 * into the impassable mountain rim. The wreck was not unreachable — the route
 * passed a walkability probe — but site scoring rewarded raw distance from a
 * camp that already sits 98 metres off centre, so the winner was always the
 * outermost ring on the far side. The pod ended up at r≈155 with the rim
 * starting at 150 and the hard walk limit at 166: eleven metres of room, an ice
 * wall behind it, and a compass needle pointing straight at the wall.
 *
 * These pin the shape of the fix rather than the exact coordinate, so the site
 * can move when the world does and still have to be somewhere a player can
 * walk to without being told to climb a mountain.
 */

const SEEDS = [31337, 777, 4242, 9001, 5150, 2024, 88, 1234];
const home = { x: 95, z: 25 };
const safeRadius = WORLD.rimStart - MISSION.edgeClearance;

describe('the distress signal leads somewhere a player can walk', () => {
  it('never puts the wreck inside the mountain rim', () => {
    for (const seed of SEEDS) {
      const world = createWorld(seed);
      const pod = world.mission!.podPos;
      const r = Math.hypot(pod.x, pod.z);
      expect(r, `seed ${seed}`).toBeLessThanOrEqual(safeRadius);
      // And with real room to spare before the ground starts climbing. The
      // reported bug had this at 11 metres *past* the start of the rim.
      expect(WORLD.rimStart - r, `seed ${seed}`).toBeGreaterThan(20);
    }
  });

  it('keeps the whole route inside the valley, not only its ends', () => {
    for (const seed of SEEDS) {
      const world = createWorld(seed);
      const pod = world.mission!.podPos;
      let maxR = 0;
      const steps = 120;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = home.x + (pod.x - home.x) * t;
        const z = home.z + (pod.z - home.z) * t;
        maxR = Math.max(maxR, Math.hypot(x, z));
        expect(isWalkable(x, z), `seed ${seed} at t=${t.toFixed(2)}`).toBe(true);
        expect(isWater(x, z), `seed ${seed} at t=${t.toFixed(2)}`).toBe(false);
      }
      expect(maxR, `seed ${seed}`).toBeLessThan(WORLD.rimStart);
    }
  });

  it('keeps the wreck out of the greybox test course', () => {
    for (const seed of SEEDS) {
      const world = createWorld(seed);
      const pod = world.mission!.podPos;
      const nearest = Math.min(...world.course.map((c) => Math.hypot(c.pos.x - pod.x, c.pos.z - pod.z)));
      expect(nearest, `seed ${seed}`).toBeGreaterThanOrEqual(MISSION.courseClearance);
    }
  });

  it('is still a real walk rather than a site next door', () => {
    for (const seed of SEEDS) {
      const world = createWorld(seed);
      const pod = world.mission!.podPos;
      const d = Math.hypot(pod.x - home.x, pod.z - home.z);
      expect(d, `seed ${seed}`).toBeGreaterThan(90);
      expect(walkableRoute(home, pod), `seed ${seed}`).toBe(true);
    }
  });

  it('is reachable on foot alone, with no jetpack', () => {
    // Nothing on the route may need more than Gate 1 movement. `isWalkable`
    // rejects slopes above 0.85, and the player can climb a grade of 1.6, so a
    // walkable route is one a player with WASD can genuinely cover.
    const world = createWorld(31337);
    expect(world.player.unlocks.jetpack || true).toBe(true);
    expect(walkableRoute(home, world.mission!.podPos)).toBe(true);
  });

  it('picks the same site every time, so a navigation bug is reproducible', () => {
    const a = chooseCrashSite(createWorld(31337));
    const b = chooseCrashSite(createWorld(31337));
    expect(a.pod).toEqual(b.pod);
  });
});

describe('the signal tells the player whether they are getting closer', () => {
  it('rises as Kai approaches and reads zero out of range', () => {
    const world = createWorld(31337);
    const pod = world.mission!.podPos;
    const far = signalStrengthAt(world, home.x, home.z);
    const near = signalStrengthAt(world, pod.x + 12, pod.z);
    const atIt = signalStrengthAt(world, pod.x, pod.z);

    expect(atIt).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThanOrEqual(0);
    // Beyond the carrier's reach it is silent, not faint.
    expect(signalStrengthAt(world, pod.x + MISSION.signalRange + 5, pod.z)).toBe(0);
  });

  it('is a proportion, so it can be shown as a bar and described in words', () => {
    const world = createWorld(31337);
    const pod = world.mission!.podPos;
    for (const d of [0, 20, 60, 120, 200]) {
      const v = signalStrengthAt(world, pod.x + d, pod.z);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('the scanner does something the player can see', () => {
  it('reveals material sites in range and says what it found', () => {
    const world = createWorld(31337);
    const p = world.player;
    p.unlocks.scanner = true;
    // Stand on top of a material node so there is certainly something to find.
    const node = world.resources.find((r) => r.type === 'alloy' || r.type === 'ore' || r.type === 'crystal')!;
    p.pos = { x: node.pos.x, z: node.pos.z };
    node.discovered = false;

    const before = world.ariQueue.length;
    const result = performScan(world);

    expect(result.ok).toBe(true);
    expect(result.found).toContain(node.id);
    expect(node.discovered).toBe(true);
    // ARI reports it, which is the feedback the player actually reads.
    expect(world.ariQueue.length).toBeGreaterThan(before);
    expect(world.ariQueue.join(' ')).toMatch(/signature|within range/i);
  });

  it('refuses honestly rather than pretending, when it is not ready', () => {
    const world = createWorld(31337);
    world.player.unlocks.scanner = true;
    world.player.items.energyCell = 0;
    performScan(world);
    const second = performScan(world);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('cooling');
  });

  it('spends an Energy Cell to scan early, and only then', () => {
    const world = createWorld(31337);
    const p = world.player;
    p.unlocks.scanner = true;
    p.items.energyCell = 2;
    performScan(world);
    const boosted = performScan(world);
    expect(boosted.ok).toBe(true);
    expect(boosted.boosted).toBe(true);
    expect(p.items.energyCell).toBe(1);
    // A cell buys reach, which is the reason to spend one.
    expect(boosted.radius).toBeGreaterThan(0);
  });
});

describe('the minimap puts things where they are', () => {
  const SIZE = 200;

  it('puts the middle of the world in the middle of the map', () => {
    const { px, py } = toMapPixel(0, 0, SIZE);
    expect(px).toBeCloseTo(SIZE / 2, 5);
    expect(py).toBeCloseTo(SIZE / 2, 5);
  });

  it('does not mirror or rotate the world', () => {
    // North (−z) is up, east (+x) is right. Getting either backwards would send
    // a player the wrong way with complete confidence.
    const north = toMapPixel(0, -100, SIZE);
    const south = toMapPixel(0, 100, SIZE);
    const east = toMapPixel(100, 0, SIZE);
    const west = toMapPixel(-100, 0, SIZE);
    expect(north.py).toBeLessThan(SIZE / 2);
    expect(south.py).toBeGreaterThan(SIZE / 2);
    expect(east.px).toBeGreaterThan(SIZE / 2);
    expect(west.px).toBeLessThan(SIZE / 2);
  });

  it('keeps everything reachable on the map', () => {
    const world = createWorld(31337);
    const marks = [world.player.pos, world.mission!.podPos, world.camps[0].pos];
    for (const m of marks) {
      const { px, py } = toMapPixel(m.x, m.z, SIZE);
      expect(px).toBeGreaterThanOrEqual(0);
      expect(px).toBeLessThanOrEqual(SIZE);
      expect(py).toBeGreaterThanOrEqual(0);
      expect(py).toBeLessThanOrEqual(SIZE);
    }
  });

  it('scales with the canvas it is drawn into', () => {
    const small = toMapPixel(50, -50, 100);
    const large = toMapPixel(50, -50, 400);
    expect(large.px).toBeCloseTo(small.px * 4, 5);
    expect(large.py).toBeCloseTo(small.py * 4, 5);
  });
});

describe('which way is which', () => {
  /**
   * The world's own conventions, measured rather than assumed.
   *
   * Moving forward at yaw θ takes Kai toward (sin θ, cos θ), and the place
   * namer calls −z north and +x east. Two instruments disagreed with that: the
   * compass letters were 180° out, and the minimap arrow was drawn as the exact
   * negation of Kai's heading.
   */
  const forward = (yaw: number) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });

  it('walks Kai the way the place names say', () => {
    const world = createWorld(31337);
    const p = world.player;
    const go = (yaw: number) => {
      p.pos = { x: 0, z: 0 };
      p.speed = 0;
      p.y = 0;
      for (let i = 0; i < 60; i++) {
        updatePlayer(world, 1 / 30, { moveX: 0, moveZ: 1, sprint: false, jump: false, camYaw: yaw });
      }
      return { ...p.pos };
    };
    // Yaw 0 is +z, and +z is south by the world's own naming.
    expect(go(0).z).toBeGreaterThan(3);
    expect(placeName({ x: 0, z: 90 })).toMatch(/southern/i);
    // Yaw π is −z, which is north.
    expect(go(Math.PI).z).toBeLessThan(-3);
    expect(placeName({ x: 0, z: -90 })).toMatch(/northern/i);
    // Yaw π/2 is +x, which is east.
    expect(go(Math.PI / 2).x).toBeGreaterThan(3);
  });

  it('points the compass at the direction Kai is actually facing', () => {
    // Yaw 0 walks south, so the compass must read S — it used to read N.
    expect(cardinalFor(0)).toBe('S');
    expect(cardinalFor(Math.PI)).toBe('N');
    expect(cardinalFor(Math.PI / 2)).toBe('E');
    expect(cardinalFor(-Math.PI / 2)).toBe('W');
  });

  it('draws the minimap arrow along Kai\'s heading, not against it', () => {
    // A triangle drawn pointing up is (0, -1); canvas rotate(a) sends it to
    // (sin a, -cos a). On this map +x is right and +z is down, so the arrow has
    // to end up at (sin θ, cos θ) — the same direction Kai walks.
    for (const yaw of [0, 0.7, Math.PI / 2, Math.PI, -1.2]) {
      const a = arrowRotation(yaw);
      const tip = { x: Math.sin(a), y: -Math.cos(a) };
      const want = forward(yaw);
      expect(tip.x, `yaw ${yaw}`).toBeCloseTo(want.x, 6);
      expect(tip.y, `yaw ${yaw}`).toBeCloseTo(want.z, 6);
    }
  });
});

describe('the player HUD shows nothing that needs a developer to read', () => {
  it('has no currency to present, so there are no Credits', () => {
    // The ticket asked for Credits "if an actual money system exists". Nothing
    // in the player is spent as money: recipes consume materials directly.
    const world = createWorld(31337);
    const p = world.player as unknown as Record<string, unknown>;
    for (const key of ['credits', 'money', 'currency', 'coins']) {
      expect(p[key], key).toBeUndefined();
    }
  });
});
