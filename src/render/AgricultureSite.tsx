import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { agricultureSitePos } from '../sim/mission';
import { groundY } from '../sim/terrain';
import { toonMat } from './toon';

/**
 * The Agriculture Program.
 *
 * The whole payoff of THE SIGNAL, and deliberately not a reward screen. Before
 * Maya is home this ground is empty. After she is home there is a marked-out
 * plot beside the water with frames going up on it, and the colony can do
 * something today it could not do yesterday.
 *
 * It is scenery, not a system: no crops, no growth simulation, no management
 * screen. What it has to communicate is one sentence — *she is working* — and
 * a construction site says that better than a finished greenhouse would. A
 * finished building says the problem is solved; a site says people are here.
 */
export function AgricultureSite() {
  const group = useMemo(() => new THREE.Group(), []);
  const built = useRef(false);
  const growth = useRef(0);
  const frames = useRef<THREE.Object3D[]>([]);

  useFrame((state, dt) => {
    const world = getWorld();
    const on = Boolean(world.mission?.agricultureUnlocked);
    group.visible = on;
    if (!on) return;

    if (!built.current) {
      built.current = true;
      const pos = agricultureSitePos(world);
      const base = groundY(pos.x, pos.z);
      group.position.set(pos.x, base, pos.z);

      const soil = toonMat('#4a3d2c');
      const post = toonMat('#8a7a5e');
      const panel = toonMat('#a9e6d8', { emissive: '#3f8f7f', emissiveIntensity: 0.35 });
      const crateMat = toonMat('#7c6a4e');
      const marker = toonMat('#59d6e6', { emissive: '#59d6e6', emissiveIntensity: 1.2 });

      // Turned ground: the plot itself, marked out and dug over.
      const bed = new THREE.Mesh(new THREE.BoxGeometry(9, 0.12, 6.4), soil);
      bed.position.y = 0.06;
      group.add(bed);
      for (let i = 0; i < 4; i++) {
        const row = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.16, 0.5), toonMat('#5c4c36'));
        row.position.set(0, 0.16, -2.2 + i * 1.5);
        group.add(row);
      }

      // The frame going up over it. Left unfinished on purpose — three bays
      // standing, the fourth still just posts.
      for (let i = 0; i < 4; i++) {
        const x = -3.6 + i * 2.4;
        for (const side of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.3, 6), post);
          leg.position.set(x, 1.15, side * 2.9);
          group.add(leg);
        }
        if (i < 3) {
          const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 6), post);
          beam.position.set(x, 2.3, 0);
          group.add(beam);
          // Glazing panels, which fade in as the site "comes up".
          const glass = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 5.6), panel);
          glass.position.set(x + 1.2, 2.34, 0);
          (glass.material as THREE.MeshToonMaterial).transparent = true;
          (glass.material as THREE.MeshToonMaterial).opacity = 0;
          group.add(glass);
          frames.current.push(glass);
        }
      }

      // Equipment: crates of expedition kit, and a survey marker with the
      // colony's own light on it, so the site reads as claimed rather than found.
      for (let i = 0; i < 3; i++) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), crateMat);
        box.position.set(4.9, 0.3, -1.6 + i * 1.4);
        box.rotation.y = i * 0.4;
        group.add(box);
      }
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.9, 6), post);
      stake.position.set(-5.1, 0.95, 2.3);
      group.add(stake);
      const light = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), marker);
      light.position.set(-5.1, 1.95, 2.3);
      group.add(light);

      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
    }

    // The glazing eases in over a few seconds the first time the player sees it,
    // so returning to camp reads as *arriving while work is underway* rather
    // than as a building that teleported in.
    growth.current = Math.min(1, growth.current + dt * 0.35);
    const eased = growth.current * growth.current;
    for (let i = 0; i < frames.current.length; i++) {
      const mat = (frames.current[i] as THREE.Mesh).material as THREE.MeshToonMaterial;
      mat.opacity = Math.max(0, Math.min(0.55, (eased - i * 0.18) * 0.7));
    }
    void state;
  });

  return <primitive object={group} />;
}
