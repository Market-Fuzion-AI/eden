import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { fabricationProgress } from '../sim/fabrication';
import { heightAt } from '../sim/terrain';
import { toonMat } from './toon';

/**
 * Human Landing: the colony's first foothold, and the silhouette the player
 * navigates home by.
 *
 * Pure scenery driven by `world.landmarksBuilt` — the drop pod they came down
 * in, its scattered debris, a materials staging area, and a fabrication
 * platform standing dark and unused. The fabricator is deliberately inert: it
 * marks where crafting will live without pretending to be a system yet.
 */
export function LandingSite() {
  const beaconRef = useRef<THREE.Mesh>(null);
  const fabRingRef = useRef<THREE.Mesh>(null);

  const coreRef = useRef<THREE.Mesh>(null);

  const { group, beacon, fabRing, fabCore } = useMemo(() => {
    const world = getWorld();
    const g = new THREE.Group();
    let beaconMesh: THREE.Mesh | null = null;
    let ringMesh: THREE.Mesh | null = null;
    let coreMesh: THREE.Mesh | null = null;

    const hull = toonMat('#8d93a0');
    const hullDark = toonMat('#4a5060');
    const scorch = toonMat('#33333c');
    const glass = toonMat('#7fe7ff', { emissive: '#7fe7ff', emissiveIntensity: 0.5 });
    const crate = toonMat('#5f6a52');
    const crateAlt = toonMat('#6f5a44');
    const platform = toonMat('#3f4654');
    const warn = toonMat('#ffb03f', { emissive: '#ffb03f', emissiveIntensity: 0.35 });

    for (const b of world.landmarksBuilt) {
      const y = heightAt(b.pos.x, b.pos.z);
      const node = new THREE.Group();
      node.position.set(b.pos.x, y, b.pos.z);
      node.rotation.y = b.rot;
      g.add(node);

      if (b.kind === 'pod') {
        // A blunt descent capsule, half-buried and tilted where it came down.
        const shell = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.1, 4.2, 12, 1), hull);
        shell.position.y = 1.7;
        shell.castShadow = true;
        node.add(shell);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hullDark);
        cap.position.y = 3.8;
        node.add(cap);
        // Scorched heat shield skirt.
        const skirt = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.5, 12), scorch);
        skirt.position.y = 0.25;
        node.add(skirt);
        // Open hatch and interior glow — it reads as inhabited, not as wreckage.
        const hatch = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.1, 0.16), hullDark);
        hatch.position.set(0, 1.7, 3.02);
        hatch.rotation.x = -0.4;
        node.add(hatch);
        const inner = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.9), glass);
        inner.position.set(0, 1.7, 2.96);
        node.add(inner);
        // Landing legs.
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 2.6, 6), hullDark);
          leg.position.set(Math.sin(a) * 2.9, 0.9, Math.cos(a) * 2.9);
          leg.rotation.set(Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3);
          node.add(leg);
        }
        // Beacon on the nose — visible across the Riverlands after dark, which
        // is what actually lets the player navigate home.
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.4, 6), hullDark);
        mast.position.y = 5.6;
        node.add(mast);
        beaconMesh = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), glass);
        beaconMesh.position.y = 7.4;
        node.add(beaconMesh);
        node.rotation.z = 0.08;
      } else if (b.kind === 'debris') {
        // Torn hull panels, half sunk into the grass.
        for (let i = 0; i < 3; i++) {
          const panel = new THREE.Mesh(new THREE.BoxGeometry(1.9 + i * 0.5, 0.16, 1.2), i === 1 ? hullDark : hull);
          panel.position.set((i - 1) * 1.7, 0.12 + i * 0.05, (i % 2) * 1.1);
          panel.rotation.set(0.1 * i, i * 1.3, 0.24 * (i - 1));
          panel.castShadow = true;
          node.add(panel);
        }
      } else if (b.kind === 'fabricator') {
        // A working machine rather than a marked slab: a deck, a forming
        // chamber between two emitter columns, a live energy core underneath,
        // and a pair of manipulator arms folded over the bed. Colony-scale —
        // advanced equipment running in a settlement that cannot yet replace it.
        const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.7, 0.42, 12), platform);
        deck.position.y = 0.21;
        deck.receiveShadow = true;
        node.add(deck);
        // Machined bed the object forms above.
        const bed = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.22, 12), hullDark);
        bed.position.y = 0.53;
        node.add(bed);
        coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), glass);
        coreMesh.position.y = 0.72;
        node.add(coreMesh);

        // Emitter columns with stacked coil bands.
        for (const side of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.36, 3.1, 0.42), hull);
          post.position.set(1.75 * side, 1.75, 0);
          post.castShadow = true;
          node.add(post);
          for (let i = 0; i < 3; i++) {
            const coil = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.52), hullDark);
            coil.position.set(1.75 * side, 1.0 + i * 0.72, 0);
            node.add(coil);
          }
          // Manipulator arm, folded in over the bed.
          const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.5, 6), hullDark);
          upper.position.set(1.5 * side, 2.6, 0.1);
          upper.rotation.z = side * 0.85;
          node.add(upper);
          const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 1.1, 6), hull);
          fore.position.set(0.85 * side, 2.05, 0.1);
          fore.rotation.z = side * 2.0;
          node.add(fore);
        }

        // Overhead gantry and the forming ring the object builds inside.
        const arch = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.36, 0.6), hull);
        arch.position.y = 3.45;
        arch.castShadow = true;
        node.add(arch);
        ringMesh = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.1, 6, 28), warn);
        ringMesh.position.y = 1.9;
        ringMesh.rotation.x = Math.PI / 2;
        node.add(ringMesh);
        // Second, smaller ring, so the chamber reads as a volume.
        const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.06, 5, 22), hullDark);
        ring2.position.y = 2.7;
        ring2.rotation.x = Math.PI / 2;
        node.add(ring2);
        // Hazard stripe on the deck edge, and a control lectern.
        const stripe = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.07, 4, 24), warn);
        stripe.position.y = 0.44;
        stripe.rotation.x = Math.PI / 2;
        node.add(stripe);
        const lectern = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.55), glass);
        lectern.position.set(0, 1.06, 2.1);
        lectern.rotation.x = -0.5;
        node.add(lectern);
        const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.0, 6), hullDark);
        stand.position.set(0, 0.62, 2.2);
        node.add(stand);
      } else {
        // Materials staging: stacked crates and a couple of open bins.
        for (let i = 0; i < 5; i++) {
          const s = 0.7 + (i % 3) * 0.16;
          const c = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.8, s), i % 2 ? crate : crateAlt);
          c.position.set(((i % 3) - 1) * 1.0, s * 0.4 + (i > 2 ? 0.62 : 0), Math.floor(i / 3) * 1.0);
          c.rotation.y = i * 0.5;
          c.castShadow = true;
          node.add(c);
        }
      }
    }
    return { group: g, beacon: beaconMesh, fabRing: ringMesh, fabCore: coreMesh };
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const b = beaconRef.current ?? beacon;
    if (b) {
      const m = b.material as THREE.MeshToonMaterial;
      // A slow pulse, so the beacon reads as a working signal rather than a lamp.
      m.emissiveIntensity = 0.35 + Math.abs(Math.sin(t * 0.9)) * 1.1;
    }
    // The fabricator answers to simulation state: idle standby, or a visibly
    // running job with the chamber spinning up. Nothing about a fabrication is
    // a number quietly changing.
    const world = getWorld();
    const progress = fabricationProgress(world);
    const running = world.fabrication !== null;
    const r = fabRingRef.current ?? fabRing;
    if (r) {
      const m = r.material as THREE.MeshToonMaterial;
      m.emissiveIntensity = running ? 1.4 + Math.sin(t * 14) * 0.5 : 0.18 + Math.sin(t * 0.5) * 0.08;
      r.rotation.z = running ? t * 3.4 : 0;
      const lift = running ? 1.9 + progress * 0.9 : 1.9;
      r.position.y = lift;
      const s = running ? 1 + (1 - progress) * 0.22 : 1;
      r.scale.setScalar(s);
    }
    const core = coreRef.current ?? fabCore;
    if (core) {
      const m = core.material as THREE.MeshToonMaterial;
      m.emissiveIntensity = running ? 1.8 + Math.sin(t * 20) * 0.7 : 0.35 + Math.sin(t * 1.1) * 0.12;
      core.rotation.y = t * (running ? 4 : 0.5);
      core.scale.setScalar(running ? 1 + progress * 0.5 : 1);
    }
  });

  return <primitive object={group} />;
}
