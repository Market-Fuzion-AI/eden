import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { propTop } from '../sim/course';
import { groundY } from '../sim/terrain';
import { toonMat } from './toon';

/**
 * The 3Cs test course, drawn.
 *
 * Greybox on purpose. Gate 1 is a controller prototype living inside the real
 * world, and the geometry's only job is to be unambiguous: a surface you can
 * stand on should look like a surface you can stand on, and a thing you have to
 * go around should look solid. Colour does that work rather than modelling —
 * warm decking for standable tops, cold stone for obstacles, and lit beacons
 * marking the line of the run so a player can see where it goes without a quest
 * marker telling them.
 *
 * Built once from `world.course` and never animated except for the beacons.
 */
export function TestCourse() {
  const beacons = useRef<THREE.Mesh[]>([]);

  const group = useMemo(() => {
    const world = getWorld();
    const g = new THREE.Group();
    const deck = toonMat('#8e7a5c');
    const deckEdge = toonMat('#c9a86a');
    const stone = toonMat('#6b7280');
    const stoneTop = toonMat('#828b98');
    const post = toonMat('#3f4654');
    const lit = toonMat('#ffb03f', { emissive: '#ffb03f', emissiveIntensity: 1.4 });
    const marks: THREE.Mesh[] = [];

    for (const prop of world.course) {
      const base = groundY(prop.pos.x, prop.pos.z);
      const node = new THREE.Group();
      node.position.set(prop.pos.x, base, prop.pos.z);
      node.rotation.y = prop.rot;
      g.add(node);

      switch (prop.kind) {
        case 'pad': {
          // A low step. Deliberately a shallow disc rather than a block: it
          // should read as "walk on" and not as "climb".
          const body = new THREE.Mesh(new THREE.CylinderGeometry(prop.size.x, prop.size.x * 1.04, prop.height, 12), deck);
          body.position.y = prop.height / 2;
          node.add(body);
          const rim = new THREE.Mesh(new THREE.TorusGeometry(prop.size.x, 0.06, 5, 18), deckEdge);
          rim.rotation.x = Math.PI / 2;
          rim.position.y = prop.height;
          node.add(rim);
          break;
        }
        case 'block': {
          // Standable and solid. The lighter cap is the tell that the top is a
          // surface rather than more wall.
          const body = new THREE.Mesh(new THREE.BoxGeometry(prop.size.x * 2, prop.height, prop.size.z * 2), stone);
          body.position.y = prop.height / 2;
          node.add(body);
          const cap = new THREE.Mesh(new THREE.BoxGeometry(prop.size.x * 2.06, 0.1, prop.size.z * 2.06), deckEdge);
          cap.position.y = prop.height + 0.04;
          node.add(cap);
          break;
        }
        case 'plank': {
          // The narrow crossing, on two stubby legs so it reads as raised.
          const body = new THREE.Mesh(new THREE.BoxGeometry(prop.size.x * 2, 0.18, prop.size.z * 2), deck);
          body.position.y = prop.height;
          node.add(body);
          for (const end of [-1, 1]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(prop.size.x * 1.4, prop.height, 0.3), post);
            leg.position.set(0, prop.height / 2, end * (prop.size.z - 0.4));
            node.add(leg);
          }
          break;
        }
        case 'rock': {
          // Pure obstacle. Faceted and cold, so it never reads as climbable.
          const body = new THREE.Mesh(new THREE.DodecahedronGeometry(prop.size.x, 0), stone);
          body.position.y = prop.height * 0.42;
          body.scale.set(1, prop.height / (prop.size.x * 1.6), 1);
          body.rotation.set(0.2, prop.rot, 0.15);
          node.add(body);
          const shoulder = new THREE.Mesh(new THREE.DodecahedronGeometry(prop.size.x * 0.55, 0), stoneTop);
          shoulder.position.set(prop.size.x * 0.3, prop.height * 0.75, -prop.size.x * 0.2);
          node.add(shoulder);
          break;
        }
        case 'marker': {
          // Route beacon. The only thing here allowed to be eye-catching.
          const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, prop.height, 6), post);
          mast.position.y = prop.height / 2;
          node.add(mast);
          const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), lit);
          lamp.position.y = prop.height;
          node.add(lamp);
          marks.push(lamp);
          break;
        }
      }
    }

    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    beacons.current = marks;
    return g;
  }, []);

  useFrame((state) => {
    // A slow breath on the beacons, offset per lamp so the line of the course
    // reads as a sequence rather than a row of identical lights.
    for (let i = 0; i < beacons.current.length; i++) {
      const mat = beacons.current[i].material as THREE.MeshToonMaterial;
      mat.emissiveIntensity = 1 + Math.sin(state.clock.elapsedTime * 1.6 + i * 1.3) * 0.5;
    }
  });

  return <primitive object={group} />;
}

/** Exported for the smoke test: where the course's standable tops actually are. */
export function courseTopHeights(): number[] {
  return getWorld().course.filter((p) => p.kind !== 'marker' && p.kind !== 'rock').map(propTop);
}
