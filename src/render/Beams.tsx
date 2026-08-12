import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getWorld } from '../sim';

/**
 * Warden beams.
 *
 * A small fixed pool of cylinders reused across shots — beams are short-lived
 * and there are never more than a handful, so allocating geometry per shot
 * would be pure waste. Everything read here comes from `world.beams`, which the
 * simulation owns; this file decides only what a beam looks like.
 *
 * The visual deliberately makes the beam's *volume* obvious. It is a hitscan
 * line in the simulation, and the player has to be able to tell at a glance
 * exactly which strip of ground was dangerous.
 */
const POOL = 6;

export function Beams() {
  const meshes = useMemo(() => {
    const list: THREE.Mesh[] = [];
    for (let i = 0; i < POOL; i++) {
      const core = new THREE.Mesh(
        // Unit-length along +y; scaled and rotated into place each frame.
        new THREE.CylinderGeometry(0.16, 0.16, 1, 8, 1, true),
        // Tinted rather than white: against pale Ashlands ground a white bar
        // reads as a rendering artefact instead of as energy.
        new THREE.MeshBasicMaterial({ color: '#bfefff', transparent: true, opacity: 0, depthWrite: false }),
      );
      const halo = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: '#7fe7ff',
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      core.add(halo);
      core.visible = false;
      list.push(core);
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
    const world = getWorld();
    for (let i = 0; i < meshes.length; i++) {
      const beam = world.beams[i];
      const mesh = meshes[i];
      if (!beam) {
        mesh.visible = false;
        continue;
      }
      const life = (world.timeSec - beam.firedAt) / Math.max(0.001, beam.endsAt - beam.firedAt);
      // A short fade past the end so the beam does not vanish mid-frame.
      const fade = life <= 1 ? 1 : Math.max(0, 1 - (life - 1) * 4);
      if (fade <= 0) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      // Sit the cylinder along the beam: midpoint, aimed down the direction.
      mesh.position.set(
        beam.from.x + beam.dir.x * beam.length * 0.5,
        beam.y,
        beam.from.z + beam.dir.z * beam.length * 0.5,
      );
      dir.current.set(beam.dir.x, 0, beam.dir.z).normalize();
      mesh.quaternion.setFromUnitVectors(up.current, dir.current);
      // Snaps to full width instantly and thins as it dissipates — the danger
      // is at the start of the shot, and the visual should say so.
      const width = 0.6 + fade * 0.7;
      mesh.scale.set(width, beam.length, width);
      (mesh.material as THREE.MeshBasicMaterial).opacity = fade * 0.9;
      const halo = mesh.children[0] as THREE.Mesh;
      (halo.material as THREE.MeshBasicMaterial).opacity = fade * 0.28;
    }
  });

  return <primitive object={group} />;
}
