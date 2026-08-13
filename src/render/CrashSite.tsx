import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { groundY } from '../sim/terrain';
import { survivorVisiblePos } from '../sim/mission';
import { buildSettlerRig } from './factories';
import { toonMat } from './toon';

/**
 * Pod Seven, and the woman who walked away from it.
 *
 * Greybox, deliberately — the ticket is proving that a mission reads, not that
 * a crash site is beautiful. Everything here is built from the same procedural
 * vocabulary as the rest of the world, and its whole job is to say three things
 * before anybody speaks:
 *
 *   this came from the expedition — the plating is the colony's colours, the
 *   same shapes as the landing wreck at home;
 *   the landing went badly — the hull is split, half-buried, and there is a
 *   furrow of scorched ground behind it;
 *   somebody survived — the hatch is open from the inside, and there is a
 *   trail of dropped kit leading away.
 *
 * The emergency beacon is the one lit thing: it is what Kai has been following,
 * and it should be visible before the wreck resolves out of the distance.
 */
export function CrashSite() {
  const beacon = useRef<THREE.Mesh | null>(null);
  const survivor = useMemo(() => buildSettlerRig('human', 'female', 0.4, false), []);

  const group = useMemo(() => {
    const world = getWorld();
    const m = world.mission;
    const g = new THREE.Group();
    if (!m) return g;

    const hull = toonMat('#8d97a6');
    const hullDark = toonMat('#5b6472');
    const scorch = toonMat('#3b3630');
    const glass = toonMat('#9fdcea', { emissive: '#3f7f95', emissiveIntensity: 0.5 });
    const crate = toonMat('#7c6a4e');
    const lit = toonMat('#ff6a4a', { emissive: '#ff6a4a', emissiveIntensity: 1.6 });

    const base = groundY(m.podPos.x, m.podPos.z);
    const node = new THREE.Group();
    node.position.set(m.podPos.x, base, m.podPos.z);
    node.rotation.y = m.podHeading;
    g.add(node);

    // The furrow: the ground it ploughed through on the way in, behind it.
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const gouge = new THREE.Mesh(new THREE.BoxGeometry(3.4 - t * 1.6, 0.12, 4), scorch);
      gouge.position.set(0, 0.06 - t * 0.02, -6 - i * 3.6);
      gouge.rotation.y = (i % 2 === 0 ? 1 : -1) * 0.06;
      node.add(gouge);
    }

    // The pod itself: a capsule tipped over and driven into the ground, with
    // the nose deeper than the tail.
    const shell = new THREE.Mesh(new THREE.CapsuleGeometry(1.9, 2.6, 4, 12), hull);
    shell.rotation.z = Math.PI / 2;
    shell.rotation.x = 0.18;
    shell.position.set(0, 1.35, 0);
    node.add(shell);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 0.5, 12), hullDark);
    collar.rotation.z = Math.PI / 2;
    collar.position.set(-0.6, 1.35, 0);
    node.add(collar);
    // Viewport, cracked but intact.
    const port = new THREE.Mesh(new THREE.CircleGeometry(0.75, 10), glass);
    port.position.set(2.55, 1.6, 0);
    port.rotation.y = Math.PI / 2;
    node.add(port);

    // The hatch, off its hinges and lying on the ground beside the opening —
    // the single clearest way to say that somebody got out on their own.
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.16, 10), hullDark);
    hatch.position.set(1.1, 0.12, 2.9);
    hatch.rotation.set(0.06, 0, 0.1);
    node.add(hatch);
    const opening = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.4, 10), scorch);
    opening.position.set(0.4, 1.5, 1.55);
    opening.rotation.x = Math.PI / 2;
    node.add(opening);

    // Torn plating thrown clear on impact.
    const shards: [number, number, number, number][] = [
      [4.2, 0.35, -2.1, 0.7],
      [-3.6, 0.3, 2.8, 1.1],
      [5.6, 0.25, 3.4, 2.2],
      [-5.2, 0.28, -3.9, 0.4],
      [2.1, 0.22, 5.9, 1.7],
    ];
    for (const [x, y, z, rot] of shards) {
      const shard = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.95), hull);
      shard.position.set(x, y, z);
      shard.rotation.set(0.2, rot, 0.35);
      node.add(shard);
    }

    // The emergency beacon: a mast beside the hatch with a red lamp on it. The
    // colour is chosen to be nothing else in the valley — the flora is blue and
    // violet, the synthetics are cyan. Red here means people.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.2, 6), hullDark);
    mast.position.set(2.4, 1.6, 2.4);
    node.add(mast);
    const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), lit);
    lamp.position.set(2.4, 3.3, 2.4);
    node.add(lamp);
    beacon.current = lamp;

    // Her kit, dropped in a line away from the hatch — the trail the player
    // follows the last few metres, from the wreck to the person.
    const away = { x: Math.sin(m.podHeading + 0.9), z: Math.cos(m.podHeading + 0.9) };
    for (let i = 0; i < 3; i++) {
      const d = 2.4 + i * 1.6;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.44, 0.5), crate);
      const wx = m.podPos.x + away.x * d;
      const wz = m.podPos.z + away.z * d;
      box.position.set(wx, groundY(wx, wz) + 0.22, wz);
      box.rotation.y = i * 1.3;
      g.add(box);
    }

    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return g;
  }, []);

  useFrame((state, dt) => {
    const world = getWorld();
    // The beacon pulses like a thing running out of battery: a slow double
    // blink rather than a steady glow, so it reads as a call for help.
    if (beacon.current) {
      const t = state.clock.elapsedTime;
      const pulse = Math.max(Math.sin(t * 2.4), Math.sin(t * 2.4 - 0.7)) ** 6;
      const mat = beacon.current.material as THREE.MeshToonMaterial;
      mat.emissiveIntensity = 0.5 + pulse * 2.4;
    }

    // Maya, standing where the mission says she is. She is only drawn once the
    // player has come close enough to discover the site — before that she is
    // not a figure visible from a hillside giving the answer away.
    const here = survivorVisiblePos(world);
    survivor.group.visible = here !== null;
    if (here) {
      survivor.group.position.set(here.x, groundY(here.x, here.z), here.z);
      // Where she is looking, and it changes when Kai arrives.
      //
      // Before he is close she is turned toward the wreck she climbed out of.
      // The moment the mission says she has been found she turns to face him —
      // one line of code, and it is the difference between a figure standing in
      // a field and a person who has noticed you.
      const m = world.mission!;
      const p = world.player;
      const noticed = m.state === 'survivorFound' || m.state === 'survivorRescued';
      const facing = noticed
        ? Math.atan2(p.pos.x - here.x, p.pos.z - here.z)
        : m.state === 'completed'
          ? Math.atan2(m.homePos.x - here.x, m.homePos.z - here.z) + Math.PI
          : Math.atan2(m.podPos.x - here.x, m.podPos.z - here.z);
      // Ease round rather than snapping, so the turn is something you can see
      // happen rather than a state change you catch after the fact.
      let err = (facing - survivor.group.rotation.y) % (Math.PI * 2);
      if (err > Math.PI) err -= Math.PI * 2;
      if (err < -Math.PI) err += Math.PI * 2;
      survivor.group.rotation.y += err * Math.min(1, 4 * dt);
      survivor.animate({ time: state.clock.elapsedTime, dt, speed: 0, resting: false, social: true, turnRate: 0 });
    }
  });

  return (
    <>
      <primitive object={group} />
      <primitive object={survivor.group} />
    </>
  );
}
