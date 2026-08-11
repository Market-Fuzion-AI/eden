import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { WORLD } from '../sim/config';
import { daylight01 } from '../sim/chronicle';
import { useUI } from '../state/store';

/**
 * Drifting ground mist.
 *
 * Distance fog alone cannot carry the weather: at Live-Mode range it is too
 * weak to notice, and the density that *would* read from the god camera
 * erases the world Creator Mode exists to inspect. These soft drifting sheets
 * make mist recognizable at any camera distance while occluding nothing.
 */

function softSheetTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  // Blobby cloud field that tiles acceptably at this scale.
  for (let i = 0; i < 26; i++) {
    const x = (Math.sin(i * 12.9898) * 0.5 + 0.5) * size;
    const y = (Math.sin(i * 78.233) * 0.5 + 0.5) * size;
    const r = 26 + (Math.sin(i * 39.42) * 0.5 + 0.5) * 62;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.34)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

const LAYERS = [
  { y: 1.5, speed: 0.0055, opacity: 1.0 },
  { y: 5.0, speed: -0.0034, opacity: 0.72 },
  { y: 9.5, speed: 0.0021, opacity: 0.45 },
];

export function MistLayer() {
  const texture = useMemo(softSheetTexture, []);
  const groupRef = useRef<THREE.Group>(null);
  const matsRef = useRef<THREE.MeshBasicMaterial[]>([]);
  const strength = useRef(0);

  useFrame((_, dt) => {
    const group = groupRef.current;
    if (!group) return;
    const world = getWorld();
    const creator = useUI.getState().mode === 'creator';

    // Ease in/out so toggling weather is a transition, not a pop.
    const target = world.weather === 'mist' ? 1 : 0;
    strength.current += (target - strength.current) * Math.min(1, dt * 1.6);
    const s = strength.current;
    group.visible = s > 0.01;
    if (!group.visible) return;

    // Thinner from the god camera — recognizable, never occluding.
    const modeScale = creator ? 0.42 : 1;
    // Mist reads brighter by day, dimmer at night.
    const light = 0.45 + daylight01(world.timeSec) * 0.55;

    for (let i = 0; i < matsRef.current.length; i++) {
      const mat = matsRef.current[i];
      if (!mat) continue;
      mat.opacity = s * LAYERS[i].opacity * modeScale * 0.38 * light;
      const map = mat.map;
      if (map) {
        map.offset.x += LAYERS[i].speed * dt;
        map.offset.y += LAYERS[i].speed * 0.6 * dt;
      }
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      {LAYERS.map((layer, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, i * 0.7]} position={[0, layer.y, 0]} renderOrder={5}>
          <planeGeometry args={[WORLD.size * 1.1, WORLD.size * 1.1]} />
          <meshBasicMaterial
            ref={(m) => {
              if (m) matsRef.current[i] = m;
            }}
            map={texture.clone()}
            transparent
            opacity={0}
            depthWrite={false}
            side={THREE.DoubleSide}
            color="#dceaf2"
            fog={false}
          />
        </mesh>
      ))}
    </group>
  );
}
