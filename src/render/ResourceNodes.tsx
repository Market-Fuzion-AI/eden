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

// --- player fabrication materials -----------------------------------------
// Each reads at gameplay distance by silhouette and palette rather than by a
// marker: metal panels, veined rock, angular crystal.
const alloyMat = toonMat('#9aa3b2');
const alloyDarkMat = toonMat('#5c6473');
const alloyLampMat = toonMat('#7fe7ff', { emissive: '#7fe7ff', emissiveIntensity: 1.4 });
const oreRockMat = toonMat('#6b5a52');
const oreVeinMat = toonMat('#e0a24a', { emissive: '#e0a24a', emissiveIntensity: 1.1 });
const crystalBaseMat = toonMat('#5a5470');
const crystalMat = toonMat('#c08bff', { emissive: '#9a6fe0', emissiveIntensity: 0.75 });

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
        // A stand of cut timber: readable as "wood you can take from here".
        for (let i = 0; i < 3; i++) {
          const log = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.7, 7), woodMat);
          log.rotation.z = Math.PI / 2;
          log.position.set(0, 0.2 + (i === 2 ? 0.36 : 0), i === 0 ? -0.24 : i === 1 ? 0.24 : 0);
          log.castShadow = true;
          g.add(log);
        }
        // Cut ends catch the light so the pile reads as worked, not fallen.
        for (const sx of [-1, 1]) {
          const face = new THREE.Mesh(new THREE.CircleGeometry(0.2, 8), toonMat('#c9a878'));
          face.position.set(sx * 0.86, 0.2, 0);
          face.rotation.y = (sx * Math.PI) / 2;
          g.add(face);
        }
        const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.5, 8), toonMat('#5c3f28'));
        stump.position.set(1.5, 0.25, 0.6);
        stump.castShadow = true;
        g.add(stump);
      } else if (node.type === 'alloy') {
        // Hull plating torn off in the descent: flat panels, a bent strut and a
        // scorched edge, half-sunk where it hit. Reads as salvage, not scenery.
        for (let i = 0; i < 3; i++) {
          const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5 - i * 0.28, 0.12, 0.95 - i * 0.16), alloyMat);
          panel.position.set((i - 1) * 0.55, 0.16 + i * 0.13, (i % 2) * 0.42 - 0.2);
          panel.rotation.set(0.16 * i, 0.7 * i + 0.4, 0.3 * (i - 1));
          panel.castShadow = true;
          g.add(panel);
        }
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.7, 6), alloyDarkMat);
        strut.position.set(0.45, 0.5, 0.35);
        strut.rotation.set(0.2, 0, 1.05);
        strut.castShadow = true;
        g.add(strut);
        // A live indicator still blinking on a dead panel.
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), alloyLampMat);
        lamp.position.set(-0.5, 0.38, 0.1);
        g.add(lamp);
      } else if (node.type === 'ore') {
        // A mineral seam with conductive veins running through the rock face.
        for (let i = 0; i < 4; i++) {
          const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62 - i * 0.11, 0), oreRockMat);
          chunk.position.set(Math.sin(i * 1.9) * 0.5, 0.34 + i * 0.17, Math.cos(i * 1.9) * 0.42);
          chunk.rotation.set(i * 1.1, i * 0.8, i * 1.6);
          chunk.castShadow = true;
          g.add(chunk);
        }
        // The veins: thin bright bands, restrained rather than glowing cubes.
        for (let i = 0; i < 5; i++) {
          const vein = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.055, 0.055), oreVeinMat);
          vein.position.set(Math.sin(i * 2.4) * 0.42, 0.3 + i * 0.16, Math.cos(i * 2.4) * 0.36);
          vein.rotation.set(i * 0.6, i * 1.4, 0.5 + i * 0.3);
          g.add(vein);
        }
      } else if (node.type === 'crystal') {
        // An angular cluster growing out of the rock — a clear silhouette from
        // a distance, which is what makes the Skyreach worth climbing.
        const base = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), crystalBaseMat);
        base.position.y = 0.2;
        base.scale.y = 0.55;
        base.castShadow = true;
        g.add(base);
        for (let i = 0; i < 5; i++) {
          const h = 1.5 - i * 0.2;
          const shard = new THREE.Mesh(new THREE.ConeGeometry(0.17 - i * 0.02, h, 5), crystalMat);
          const a = (i / 5) * Math.PI * 2 + 0.7;
          shard.position.set(Math.sin(a) * 0.3, 0.28 + h / 2, Math.cos(a) * 0.3);
          shard.rotation.set(Math.cos(a) * 0.26, a, -Math.sin(a) * 0.26);
          shard.castShadow = true;
          g.add(shard);
        }
      } else {
        // A worked seam rather than scenery boulders.
        for (let i = 0; i < 3; i++) {
          const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55 - i * 0.13, 0), stoneMat);
          s.position.set(i * 0.52 - 0.35, 0.32 + i * 0.22, i * 0.14);
          s.rotation.set(i, i * 1.7, i * 0.6);
          s.castShadow = true;
          g.add(s);
        }
        for (let i = 0; i < 4; i++) {
          const chip = new THREE.Mesh(new THREE.TetrahedronGeometry(0.16), toonMat('#8f8b98'));
          chip.position.set(Math.sin(i * 2.1) * 0.9, 0.1, Math.cos(i * 2.1) * 0.9);
          chip.rotation.set(i, i * 2, i);
          g.add(chip);
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
