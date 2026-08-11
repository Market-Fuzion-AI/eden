import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { WORLD } from '../sim/config';

/** Simple stylized water plane with a slow luminous shimmer. */
export function Water() {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }) => {
    const m = matRef.current;
    if (!m) return;
    m.emissiveIntensity = 0.18 + Math.sin(clock.elapsedTime * 0.8) * 0.07;
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, WORLD.waterLevel, 0]}>
      <planeGeometry args={[WORLD.size, WORLD.size]} />
      <meshStandardMaterial
        ref={matRef}
        color="#2e7f8f"
        emissive="#3fd8d0"
        emissiveIntensity={0.2}
        transparent
        opacity={0.78}
        roughness={0.25}
        metalness={0.1}
      />
    </mesh>
  );
}
