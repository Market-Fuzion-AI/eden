import { useMemo } from 'react';
import * as THREE from 'three';
import { WORLD } from '../sim/config';
import { fbm, heightAt, riverX, slopeAt } from '../sim/terrain';
import { registerTerrainGeometry } from '../game/debugBridge';
import { getGradientMap } from './toon';

/** Heightfield terrain mesh with hand-tinted vertex colors. Geometry derives
 *  entirely from the sim's terrain functions — the sim never depends on it. */
export function Terrain() {
  const geometry = useMemo(() => {
    const segments = 150;
    const size = WORLD.size;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();

    const grassA = new THREE.Color('#4e8f5c');
    const grassB = new THREE.Color('#39786f');
    const grassC = new THREE.Color('#6aa050');
    const sand = new THREE.Color('#c9b98a');
    const rock = new THREE.Color('#6d6a7a');
    const rockHigh = new THREE.Color('#8d8a9d');
    const snow = new THREE.Color('#e8ecf5');
    const bed = new THREE.Color('#5a7a72');

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = heightAt(x, z);
      pos.setY(i, h);

      const slope = slopeAt(x, z);
      const n = fbm(x * 0.05 + 40, z * 0.05 - 17, 2) * 0.5 + 0.5;
      // Base grass mix.
      c.copy(grassA).lerp(grassB, n).lerp(grassC, Math.max(0, fbm(x * 0.02 - 9, z * 0.02 + 3, 2)) * 0.8);
      // River bed and banks.
      const dRiver = Math.abs(x - riverX(z));
      if (h < WORLD.waterLevel + 0.15) c.copy(bed);
      else if (h < WORLD.waterLevel + 1.4 && dRiver < 16) c.lerp(sand, 1 - (h - WORLD.waterLevel) / 1.6);
      // Steep terrain → rock.
      if (slope > 0.55) c.lerp(rock, Math.min(1, (slope - 0.55) * 1.8));
      // Mountain tint + snow caps.
      if (h > 18) c.lerp(rockHigh, Math.min(1, (h - 18) / 22));
      if (h > 42) c.lerp(snow, Math.min(1, (h - 42) / 16));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    // Built exactly once and never mutated afterwards: the valley's shape is
    // fixed unless an explicit world-changing system alters it.
    registerTerrainGeometry(geo);
    return geo;
  }, []);

  const material = useMemo(
    () =>
      new THREE.MeshToonMaterial({
        vertexColors: true,
        gradientMap: getGradientMap(),
      }),
    [],
  );

  return <mesh geometry={geometry} material={material} receiveShadow name="terrain" userData={{ terrain: true }} />;
}
