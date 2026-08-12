import { useMemo } from 'react';
import * as THREE from 'three';
import { WORLD } from '../sim/config';
import { regionWeights } from '../sim/regions';
import { fbm, heightAt, riverX, slopeAt } from '../sim/terrain';
import { registerTerrainGeometry } from '../game/debugBridge';
import { getGradientMap } from './toon';

/**
 * Heightfield terrain mesh with hand-tinted vertex colors. Geometry derives
 * entirely from the sim's terrain functions — the sim never depends on it.
 *
 * Colour is the other half of biome readability: the same `regionWeights`
 * field that shapes the land also picks its palette, so the green of the
 * Riverlands, the rust of the Ashlands and the cold grey of the Skyreach blend
 * across exactly the same boundaries the player walks over.
 */
export function Terrain() {
  const geometry = useMemo(() => {
    const segments = 150;
    const size = WORLD.size;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const biome = new THREE.Color();

    const grassA = new THREE.Color('#4e8f5c');
    const grassB = new THREE.Color('#39786f');
    const grassC = new THREE.Color('#6aa050');
    // Riverlands: lush, well-watered green.
    const riverGreen = new THREE.Color('#5aa356');
    const riverGreenAlt = new THREE.Color('#3f8a63');
    // Ashlands: dry rust, ochre and baked earth.
    const ashA = new THREE.Color('#a2624a');
    const ashB = new THREE.Color('#c08a52');
    const ashRock = new THREE.Color('#7d4436');
    // Skyreach: cold grey stone and pale highland scrub.
    // Cool, slightly violet stone — pale enough to read as altitude, dark
    // enough not to wash out to white under the noon sun and distance fog.
    const skyA = new THREE.Color('#6c7488');
    const skyB = new THREE.Color('#89909f');
    const skyScrub = new THREE.Color('#5c7566');
    const skyCliff = new THREE.Color('#4d5163');

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
      const w = regionWeights(x, z);

      // Unclaimed valley floor keeps the original mixed grass.
      c.copy(grassA).lerp(grassB, n).lerp(grassC, Math.max(0, fbm(x * 0.02 - 9, z * 0.02 + 3, 2)) * 0.8);

      // Blend each region's palette in by its own weight, so transitions on
      // screen are exactly the transitions underfoot.
      if (w.riverlands > 0.001) {
        biome.copy(riverGreen).lerp(riverGreenAlt, n);
        c.lerp(biome, w.riverlands * 0.92);
      }
      if (w.ashlands > 0.001) {
        biome.copy(ashA).lerp(ashB, n);
        // Mesa faces read as bare stone rather than dust.
        if (slope > 0.35) biome.lerp(ashRock, Math.min(1, (slope - 0.35) * 2.2));
        c.lerp(biome, w.ashlands * 0.95);
      }
      if (w.skyreach > 0.001) {
        biome.copy(skyA).lerp(skyB, n);
        // Sheltered ledges keep a little hardy green; cliff faces go dark, so
        // the terracing is legible as shape rather than as flat grey.
        if (slope < 0.2) biome.lerp(skyScrub, 0.42);
        else if (slope > 0.4) biome.lerp(skyCliff, Math.min(1, (slope - 0.4) * 2));
        c.lerp(biome, w.skyreach * 0.92);
      }

      // River bed and banks.
      const dRiver = Math.abs(x - riverX(z));
      if (h < WORLD.waterLevel + 0.15) c.copy(bed);
      else if (h < WORLD.waterLevel + 1.4 && dRiver < 16) c.lerp(sand, 1 - (h - WORLD.waterLevel) / 1.6);
      // Steep terrain → rock.
      if (slope > 0.55) c.lerp(rock, Math.min(1, (slope - 0.55) * 1.8));
      // Mountain tint + snow caps.
      if (h > 30) c.lerp(rockHigh, Math.min(1, (h - 30) / 24));
      if (h > 48) c.lerp(snow, Math.min(1, (h - 48) / 16));
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
