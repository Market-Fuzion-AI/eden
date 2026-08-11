import { useMemo } from 'react';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { INTELLIGENT_SPECIES } from '../sim/species';
import { heightAt } from '../sim/terrain';
import { toonMat } from './toon';

/** Simple camp markers: shelter dome, banner and a lantern per settlement. */
export function CampVisuals() {
  const groups = useMemo(() => {
    const world = getWorld();
    return world.camps.map((camp) => {
      const accent = INTELLIGENT_SPECIES[camp.speciesId].palette.accent;
      const g = new THREE.Group();
      const y = heightAt(camp.pos.x, camp.pos.z);
      g.position.set(camp.pos.x, y, camp.pos.z);

      // Shelter dome.
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(2.4, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        toonMat('#4a4256'),
      );
      dome.castShadow = true;
      g.add(dome);
      const door = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.1, 10, 1, false, 0, Math.PI), toonMat('#20242e'));
      door.rotation.set(Math.PI / 2, 0, Math.PI / 2);
      door.position.set(0, 0.8, 2.35);
      g.add(door);

      // Banner pole.
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.4, 6), toonMat('#8a8070'));
      pole.position.set(3.2, 2.2, 0);
      pole.castShadow = true;
      g.add(pole);
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.9),
        new THREE.MeshToonMaterial({ color: new THREE.Color(accent), side: THREE.DoubleSide }),
      );
      banner.position.set(3.95, 3.9, 0);
      g.add(banner);

      // Lantern.
      const lantern = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 10, 8),
        toonMat(accent, { emissive: accent, emissiveIntensity: 2 }),
      );
      lantern.position.set(-2.6, 1.4, 1.6);
      g.add(lantern);
      const lanternPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), toonMat('#8a8070'));
      lanternPole.position.set(-2.6, 0.7, 1.6);
      g.add(lanternPole);
      const light = new THREE.PointLight(new THREE.Color(accent), 6, 22, 1.6);
      light.position.set(-2.6, 1.8, 1.6);
      g.add(light);

      return g;
    });
  }, []);

  return (
    <group>
      {groups.map((g, i) => (
        <primitive key={i} object={g} />
      ))}
    </group>
  );
}
