import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { heightAt } from '../sim/terrain';
import { toonMat } from './toon';

/**
 * The Sunken Ring.
 *
 * Pure scenery, built once from `world.siteProps`. Everything here is angular,
 * symmetrical and half-swallowed by the ground — the opposite of every other
 * silhouette in the valley, so a player who tops the rise above it knows
 * immediately that nobody they have met built this.
 *
 * There is no terminal to read and no door to open. v0.8 raises the question
 * and deliberately leaves it standing.
 */
export function SyntheticSite() {
  const glowRef = useRef<THREE.Object3D[]>([]);

  const group = useMemo(() => {
    const world = getWorld();
    const g = new THREE.Group();
    const stone = toonMat('#6d7382');
    const dark = toonMat('#39404e');
    const dead = toonMat('#4a5160');
    const live = toonMat('#7fe7ff', { emissive: '#7fe7ff', emissiveIntensity: 1.5 });
    const glows: THREE.Object3D[] = [];

    for (const prop of world.siteProps) {
      const y = heightAt(prop.pos.x, prop.pos.z);
      const node = new THREE.Group();
      node.position.set(prop.pos.x, y - prop.sink, prop.pos.z);
      node.rotation.y = prop.rot;
      node.scale.setScalar(prop.scale);
      g.add(node);

      switch (prop.kind) {
        case 'pylon': {
          // A tapering column, tall enough to be a landmark from the ridge
          // above. Settled at whatever angle the ground gave up at, never plumb.
          const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.78, 9.6, 6), stone);
          shaft.position.y = 4.8;
          node.rotation.z = (prop.scale - 1.15) * 0.42;
          node.add(shaft);
          const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.66, 0), dark);
          cap.position.y = 9.9;
          node.add(cap);
          // A collar of light rather than one seam on one face: whatever is
          // still running has to be visible from whichever side you approach.
          const lit = prop.scale > 1.05;
          const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.34, 6), lit ? live : dead);
          collar.position.y = 7.4;
          node.add(collar);
          if (lit) glows.push(collar);
          for (const side of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
            const seam = new THREE.Mesh(new THREE.BoxGeometry(0.07, 5.6, 0.07), lit ? live : dead);
            seam.position.set(Math.sin(side) * 0.5, 4.4, Math.cos(side) * 0.5);
            node.add(seam);
            if (lit) glows.push(seam);
          }
          break;
        }
        case 'arc': {
          // A collapsed span, standing on one leg with the other end buried —
          // a broken gateway, not a band lying across the ground.
          const arc = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.22, 5, 16, Math.PI * 0.85), stone);
          arc.rotation.set(0.34, 0, 0.55);
          arc.position.y = 1.1;
          node.add(arc);
          break;
        }
        case 'plate': {
          // A fallen pylon, lying where it went over.
          const fallen = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.6, 5.2, 6), stone);
          fallen.rotation.z = Math.PI / 2 - 0.12;
          fallen.position.set(0, 0.42, 0);
          node.add(fallen);
          break;
        }
        case 'shard': {
          const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.55, 0), dark);
          shard.position.y = 0.28;
          shard.rotation.set(0.4, prop.rot, 0.3);
          node.add(shard);
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
    glowRef.current = glows;
    return g;
  }, []);

  useFrame((state) => {
    // A slow, uneven pulse. Whatever is still running here is not running well.
    const t = state.clock.elapsedTime;
    for (let i = 0; i < glowRef.current.length; i++) {
      const mesh = glowRef.current[i] as THREE.Mesh;
      const mat = mesh.material as THREE.MeshToonMaterial;
      const beat = Math.sin(t * 0.7 + i * 2.1) * 0.5 + 0.5;
      mat.emissiveIntensity = 0.35 + beat * beat * 1.9;
    }
  });

  return <primitive object={group} />;
}
