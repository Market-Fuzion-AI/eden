import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { DAY_SEC } from '../sim/config';
import { useUI } from '../state/store';
import { registerFog } from '../game/debugBridge';

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

/** Fixed sun distance keeps the shadow frustum stable across the whole day. */
const SUN_DISTANCE = 240;

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

  const fog = useMemo(() => {
    const f = new THREE.FogExp2('#9fd4da', 0.004);
    registerFog(f);
    return f;
  }, []);
  const bg = useMemo(() => new THREE.Color('#6fbede'), []);
  const tmpA = useMemo(() => new THREE.Color(), []);
  const sunDir = useMemo(() => new THREE.Vector3(), []);

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

    // Creator Mode is an inspection tool: weather must stay *recognizable*
    // without ever making the world unreadable from the god camera, which
    // sits far enough back that Live-Mode fog density would erase everything.
    const creator = useUI.getState().mode === 'creator';
    const misty = world.weather === 'mist';
    if (creator) fog.density = misty ? 0.0042 : 0.0016;
    else fog.density = misty ? 0.0105 : 0.0038;
    scene.fog = fog;

    const sun = sunRef.current;
    if (sun) {
      // The sun arcs across the sky, but its distance from the valley is held
      // constant so the orthographic shadow frustum always frames the same
      // volume. A varying distance made shadows pop in and out at low sun
      // angles, which read as the landscape itself changing shape.
      const angle = (dayFrac - 0.25) * Math.PI * 2;
      const elev = Math.max(0.12, Math.sin(angle));
      const horiz = Math.cos(angle);
      sunDir.set(horiz, elev, 0.34).normalize().multiplyScalar(SUN_DISTANCE);
      sun.position.copy(sunDir);
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
        shadow-camera-near={1}
        shadow-camera-far={620}
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
