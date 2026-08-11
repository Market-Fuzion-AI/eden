import { useMemo } from 'react';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { heightAt } from '../sim/terrain';
import type { FloraType } from '../sim/types';
import { getGradientMap } from './toon';

/**
 * All static flora rendered as instanced meshes (a handful of draw calls for
 * ~700 plants). Layout comes from sim worldgen, so agents and visuals agree.
 */

interface InstanceSpec {
  floraType: FloraType;
  parts: {
    geo: THREE.BufferGeometry;
    colors: string[];
    /** local offset applied before instance transform */
    offsetY: number;
    emissive?: string;
    emissiveIntensity?: number;
    scaleMul?: [number, number, number];
    castShadow?: boolean;
  }[];
}

function buildSpecs(): InstanceSpec[] {
  return [
    {
      floraType: 'tree',
      parts: [
        { geo: new THREE.CylinderGeometry(0.22, 0.34, 2.6, 7), colors: ['#5a4636', '#4e3d33'], offsetY: 1.3 },
        {
          geo: new THREE.IcosahedronGeometry(1.9, 0),
          colors: ['#3f8f6a', '#2f7f72', '#54a05f'],
          offsetY: 3.6,
          scaleMul: [1, 1.15, 1],
        },
      ],
    },
    {
      floraType: 'tree2',
      parts: [
        { geo: new THREE.CylinderGeometry(0.16, 0.26, 2.2, 7), colors: ['#6a5a7a', '#5a4c68'], offsetY: 1.1 },
        { geo: new THREE.ConeGeometry(1.5, 2.6, 8), colors: ['#7a5fa0', '#6a7fb0', '#5f8fa0'], offsetY: 3.2 },
        { geo: new THREE.ConeGeometry(1.0, 1.8, 8), colors: ['#8f6fb8', '#7a8fc0'], offsetY: 4.6 },
      ],
    },
    {
      floraType: 'glowplant',
      parts: [
        { geo: new THREE.ConeGeometry(0.14, 0.9, 6), colors: ['#3a6a55'], offsetY: 0.45, castShadow: false },
        {
          geo: new THREE.SphereGeometry(0.22, 10, 8),
          colors: ['#6ef0d8', '#8fdfff', '#c8a0ff'],
          offsetY: 1.0,
          emissive: '#6ef0d8',
          emissiveIntensity: 1.6,
          castShadow: false,
        },
      ],
    },
    {
      floraType: 'rock',
      parts: [{ geo: new THREE.DodecahedronGeometry(1.0, 0), colors: ['#6d6a7a', '#7a7688', '#5f5c6c'], offsetY: 0.35 }],
    },
    {
      floraType: 'crystal',
      parts: [
        {
          geo: new THREE.OctahedronGeometry(0.9, 0),
          colors: ['#7fe0ff', '#c8a0ff'],
          offsetY: 0.9,
          emissive: '#7fc8ff',
          emissiveIntensity: 0.7,
          scaleMul: [0.6, 1.6, 0.6],
        },
      ],
    },
    {
      floraType: 'grass',
      parts: [
        {
          geo: new THREE.ConeGeometry(0.16, 0.7, 5),
          colors: ['#5fa060', '#4f9a72', '#6fae58'],
          offsetY: 0.3,
          castShadow: false,
        },
      ],
    },
  ];
}

export function Vegetation() {
  const meshes = useMemo(() => {
    const world = getWorld();
    const specs = buildSpecs();
    const out: THREE.InstancedMesh[] = [];
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (const spec of specs) {
      const items = world.flora.filter((f) => f.type === spec.floraType);
      if (items.length === 0) continue;
      for (const part of spec.parts) {
        const mat = new THREE.MeshToonMaterial({
          color: '#ffffff',
          gradientMap: getGradientMap(),
          emissive: part.emissive ? new THREE.Color(part.emissive) : new THREE.Color(0x000000),
          emissiveIntensity: part.emissiveIntensity ?? 1,
        });
        const im = new THREE.InstancedMesh(part.geo, mat, items.length);
        im.castShadow = part.castShadow !== false;
        im.receiveShadow = false;
        items.forEach((f, idx) => {
          const y = heightAt(f.pos.x, f.pos.z);
          dummy.position.set(f.pos.x, y + part.offsetY * f.scale, f.pos.z);
          dummy.rotation.set(0, f.rot, 0);
          const m = part.scaleMul ?? [1, 1, 1];
          dummy.scale.set(f.scale * m[0], f.scale * m[1], f.scale * m[2]);
          dummy.updateMatrix();
          im.setMatrixAt(idx, dummy.matrix);
          color.set(part.colors[Math.floor(f.variant * 997) % part.colors.length]);
          im.setColorAt(idx, color);
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        out.push(im);
      }
    }
    return out;
  }, []);

  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}
