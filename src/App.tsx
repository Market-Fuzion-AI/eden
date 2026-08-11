import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { Scene } from './render/Scene';
import { CreatorUI } from './ui/CreatorUI';
import { DebugOverlay } from './ui/DebugOverlay';
import { HelpOverlay } from './ui/HelpOverlay';
import { LiveHUD } from './ui/LiveHUD';
import { useUI } from './state/store';

export default function App() {
  const mode = useUI((s) => s.mode);
  const debugOpen = useUI((s) => s.debugOpen);
  const helpOpen = useUI((s) => s.helpOpen);

  return (
    <div className={`app mode-${mode}`}>
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ fov: 55, near: 0.1, far: 1200, position: [70, 20, 40] }}
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <Scene />
      </Canvas>
      <div className="mode-tint" />
      {mode === 'live' ? <LiveHUD /> : <CreatorUI />}
      {debugOpen && <DebugOverlay />}
      {helpOpen && <HelpOverlay />}
    </div>
  );
}
