import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { DAY_SEC } from '../sim/config';

/**
 * Sky, sun, fog and ambient light driven directly by sim time each frame —
 * no React state involved. Includes an alien sister-planet on the horizon.
 */

interface SkyKey {
  sky: THREE.Color;
  fog: THREE.Color;
  sun: THREE.Color;
  sunIntensity: number;
  hemi: number;
  ambient: number;
}

const key = (sky: string, fog: string, sun: string, sunIntensity: number, hemi: number, ambient: number): SkyKey => ({
  sky: new THREE.Color(sky),
  fog: new THREE.Color(fog),
  sun: new THREE.Color(sun),
  sunIntensity,
  hemi,
  ambient,
});

// Keyframes at 0h, 6h, 12h, 18h, 24h.
const KEYS: SkyKey[] = [
  key('#070b1e', '#0a1226', '#5f7fbf', 0.12, 0.22, 0.1),
  key('#c97f5f', '#b8836f', '#ffb27f', 0.85, 0.45, 0.2),
  key('#6fbede', '#9fd4da', '#fff2dd', 1.55, 0.7, 0.3),
  key('#8f5a86', '#7f5570', '#ff9a6f', 0.7, 0.4, 0.18),
  key('#070b1e', '#0a1226', '#5f7fbf', 0.12, 0.22, 0.1),
];

export function EdenEnvironment() {
  const { scene } = useThree();
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const starsRef = useRef<THREE.Group>(null);

  const fog = useMemo(() => new THREE.FogExp2('#9fd4da', 0.004), []);
  const bg = useMemo(() => new THREE.Color('#6fbede'), []);
  const tmpA = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const world = getWorld();
    const dayFrac = (world.timeSec % DAY_SEC) / DAY_SEC;
    const seg = dayFrac * 4;
    const i = Math.floor(seg) % 4;
    const t = seg - Math.floor(seg);
    const a = KEYS[i];
    const b = KEYS[i + 1];

    bg.copy(a.sky).lerp(b.sky, t);
    scene.background = bg;
    fog.color.copy(tmpA.copy(a.fog).lerp(b.fog, t));
    fog.density = world.weather === 'mist' ? 0.016 : 0.0038;
    scene.fog = fog;

    const sun = sunRef.current;
    if (sun) {
      // Sun arcs across the sky; below horizon at night a dim moonlight remains.
      const angle = (dayFrac - 0.25) * Math.PI * 2;
      const elev = Math.sin(angle);
      sun.position.set(Math.cos(angle) * 180, Math.max(0.08, elev) * 160 + 12, 60);
      sun.intensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t;
      sun.color.copy(tmpA.copy(a.sun).lerp(b.sun, t));
    }
    if (hemiRef.current) hemiRef.current.intensity = a.hemi + (b.hemi - a.hemi) * t;
    if (ambientRef.current) ambientRef.current.intensity = a.ambient + (b.ambient - a.ambient) * t;

    // Stars only at night.
    const daylight = Math.max(0, Math.sin((dayFrac - 0.25) * Math.PI * 2));
    if (starsRef.current) starsRef.current.visible = daylight < 0.18;
  });

  return (
    <>
      <directionalLight
        ref={sunRef}
        castShadow
        position={[80, 120, 60]}
        intensity={1.5}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={10}
        shadow-camera-far={500}
        shadow-camera-left={-160}
        shadow-camera-right={160}
        shadow-camera-top={160}
        shadow-camera-bottom={-160}
        shadow-bias={-0.0004}
      />
      <hemisphereLight ref={hemiRef} args={['#bfe8ff', '#3d5a45', 0.6]} />
      <ambientLight ref={ambientRef} intensity={0.25} />
      <group ref={starsRef}>
        <Stars radius={380} depth={40} count={2600} factor={5} saturation={0.4} fade speed={0.4} />
      </group>
      {/* Sister planet on the horizon — a constant reminder this is not Earth. */}
      <group position={[-260, 95, -320]}>
        <mesh>
          <sphereGeometry args={[46, 24, 20]} />
          <meshBasicMaterial color="#b58ad0" fog={false} />
        </mesh>
        <mesh rotation={[1.2, 0.3, 0]}>
          <torusGeometry args={[72, 5, 2, 48]} />
          <meshBasicMaterial color="#8fa8d8" transparent opacity={0.5} fog={false} />
        </mesh>
        <mesh position={[14, 10, 30]}>
          <sphereGeometry args={[8, 14, 12]} />
          <meshBasicMaterial color="#d8c8a8" fog={false} />
        </mesh>
      </group>
    </>
  );
}
