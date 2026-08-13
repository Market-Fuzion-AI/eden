import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { BLASTER } from '../sim/config';

/**
 * Pulse Blaster bolts.
 *
 * A fixed pool of capsules reused across shots, like the Warden's beams — the
 * simulation caps how many can exist, so allocating per shot would be waste.
 * Everything drawn here is read from `world.shots`; nothing is decided here.
 *
 * The bolt is stretched along its direction of travel rather than drawn as a
 * ball. A sphere crossing thirty metres in half a second reads as a flicker; a
 * streak reads as a shot, and its length tells the player which way it went. On
 * impact the same mesh flares wide and short for a single frame, so the hit
 * lands where the eye is already looking instead of somewhere in the HUD.
 */
const POOL = BLASTER.maxShots;

export function PulseShots() {
  const meshes = useMemo(() => {
    const list: THREE.Mesh[] = [];
    for (let i = 0; i < POOL; i++) {
      const bolt = new THREE.Mesh(
        // Unit length along +y, rotated into the direction of travel.
        new THREE.CapsuleGeometry(0.11, 1, 3, 6),
        new THREE.MeshBasicMaterial({ color: '#9ff2ff', transparent: true, opacity: 0, depthWrite: false }),
      );
      const glow = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.26, 1, 3, 6),
        new THREE.MeshBasicMaterial({
          color: '#3fc9ff',
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      bolt.add(glow);
      bolt.visible = false;
      list.push(bolt);
    }
    return list;
  }, []);

  const group = useMemo(() => {
    const g = new THREE.Group();
    for (const m of meshes) g.add(m);
    return g;
  }, [meshes]);

  const up = useRef(new THREE.Vector3(0, 1, 0));
  const dir = useRef(new THREE.Vector3());

  useFrame(() => {
    const shots = getWorld().shots;
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      const shot = shots[i];
      if (!shot) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(shot.pos.x, shot.y, shot.pos.z);
      dir.current.set(shot.dir.x, 0, shot.dir.z).normalize();
      mesh.quaternion.setFromUnitVectors(up.current, dir.current);

      const core = mesh.material as THREE.MeshBasicMaterial;
      const glowMesh = mesh.children[0] as THREE.Mesh;
      const glow = glowMesh.material as THREE.MeshBasicMaterial;

      if (shot.spent) {
        // The impact: one frame of a short, wide, bright flare.
        mesh.scale.set(2.6, 0.5, 2.6);
        glowMesh.scale.set(1.6, 1, 1.6);
        core.opacity = 1;
        glow.opacity = 0.75;
      } else {
        mesh.scale.set(1, 2.1, 1);
        glowMesh.scale.set(1, 0.85, 1);
        core.opacity = 0.95;
        glow.opacity = 0.32;
      }
    }
  });

  return <primitive object={group} />;
}
