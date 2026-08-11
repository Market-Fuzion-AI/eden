import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { heightAt } from '../sim/terrain';
import type { ResourceNode } from '../sim/types';
import { useUI } from '../state/store';
import { toonMat } from './toon';

/** World resources: berry bushes (with live fullness), rest spots, wood & stone piles, offered berries. */

function BerryBush({ node }: { node: ResourceNode }) {
  const berriesRef = useRef<THREE.Group>(null);
  const y = useMemo(() => heightAt(node.pos.x, node.pos.z), [node]);
  const berryPositions = useMemo(() => {
    const arr: [number, number, number][] = [];
    for (let i = 0; i < node.maxQuantity; i++) {
      const a = (i / node.maxQuantity) * Math.PI * 2 + i;
      arr.push([Math.sin(a) * 0.5, 0.55 + ((i * 37) % 10) / 25, Math.cos(a) * 0.5]);
    }
    return arr;
  }, [node]);

  useFrame(() => {
    const g = berriesRef.current;
    if (!g) return;
    // Show as many berries as the node currently holds.
    const q = Math.floor(node.quantity);
    g.children.forEach((child, i) => {
      child.visible = i < q;
    });
  });

  return (
    <group position={[node.pos.x, y, node.pos.z]}>
      <mesh castShadow position={[0, 0.4, 0]} scale={[1, 0.75, 1]}>
        <sphereGeometry args={[0.7, 10, 8]} />
        <meshToonMaterial color="#4f8f68" />
      </mesh>
      <group ref={berriesRef}>
        {berryPositions.map((p, i) => (
          <mesh key={i} position={p}>
            <sphereGeometry args={[0.09, 8, 6]} />
            <meshToonMaterial color="#ffd76a" emissive="#ffb03f" emissiveIntensity={1.6} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

const restMat = toonMat('#7a6a8a');
const restPadMat = toonMat('#3d4c66', { emissive: '#59d6e6', emissiveIntensity: 0.12 });
const woodMat = toonMat('#6a4e36');
const stoneMat = toonMat('#7a7688');
const offerMat = toonMat('#ffd76a', { emissive: '#ffb03f', emissiveIntensity: 2.2 });

export function ResourceNodes() {
  const version = useUI((s) => s.resourcesVersion);
  const world = getWorld();

  const staticNodes = useMemo(() => {
    const groups: THREE.Group[] = [];
    for (const node of world.resources) {
      if (node.type === 'glowberry') continue;
      const g = new THREE.Group();
      const y = heightAt(node.pos.x, node.pos.z);
      g.position.set(node.pos.x, y, node.pos.z);
      if (node.type === 'restspot') {
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.14, 10), restPadMat);
        pad.position.y = 0.07;
        g.add(pad);
        const pillow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), restMat);
        pillow.scale.set(1, 0.45, 0.7);
        pillow.position.set(0, 0.2, -0.5);
        g.add(pillow);
      } else if (node.type === 'wood') {
        for (let i = 0; i < 3; i++) {
          const log = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.6, 7), woodMat);
          log.rotation.z = Math.PI / 2;
          log.position.set(0, 0.18 + (i === 2 ? 0.32 : 0), i === 0 ? -0.2 : i === 1 ? 0.2 : 0);
          log.castShadow = true;
          g.add(log);
        }
      } else {
        for (let i = 0; i < 2; i++) {
          const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 - i * 0.15, 0), stoneMat);
          s.position.set(i * 0.5 - 0.2, 0.3 + i * 0.3, 0);
          s.castShadow = true;
          g.add(s);
        }
      }
      groups.push(g);
    }
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const bushes = useMemo(
    () => world.resources.filter((r) => r.type === 'glowberry'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );

  const offered = useMemo(
    () => [...world.offeredFood],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );

  return (
    <group>
      {staticNodes.map((g, i) => (
        <primitive key={`s${i}`} object={g} />
      ))}
      {bushes.map((node) => (
        <BerryBush key={node.id} node={node} />
      ))}
      {offered.map((o) => (
        <mesh key={o.id} position={[o.pos.x, heightAt(o.pos.x, o.pos.z) + 0.15, o.pos.z]} material={offerMat}>
          <sphereGeometry args={[0.13, 8, 6]} />
        </mesh>
      ))}
    </group>
  );
}
