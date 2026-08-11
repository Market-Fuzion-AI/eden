import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { heightAt } from '../sim/terrain';
import { useUI } from '../state/store';
import { inputState } from '../game/input';
import { buildSettlerRig } from './factories';

/**
 * Emerson's visual + the third-person chase camera. The visual persists in
 * Creator Mode (Emerson still exists in the world); only camera control and
 * pointer lock are Live-Mode concerns.
 */
export function PlayerRig() {
  const { camera, gl } = useThree();
  const mode = useUI((s) => s.mode);
  const helpOpen = useUI((s) => s.helpOpen);

  const rig = useMemo(() => {
    const r = buildSettlerRig('human', 'male', 0.42, true);
    r.group.userData.eid = 'emerson';
    r.group.traverse((o) => (o.userData.eid = 'emerson'));
    return r;
  }, []);

  const slashRef = useRef<THREE.Mesh>(null);
  const camTarget = useMemo(() => new THREE.Vector3(), []);
  const camPos = useMemo(() => new THREE.Vector3(), []);

  // Pointer lock on click while in live mode.
  useEffect(() => {
    const canvas = gl.domElement;
    const onClick = () => {
      const ui = useUI.getState();
      if (ui.mode === 'live' && !ui.helpOpen && !document.pointerLockElement) {
        canvas.requestPointerLock();
      }
    };
    canvas.addEventListener('click', onClick);
    return () => canvas.removeEventListener('click', onClick);
  }, [gl]);

  // Release pointer lock when leaving live mode or opening help.
  useEffect(() => {
    if ((mode !== 'live' || helpOpen) && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [mode, helpOpen]);

  useFrame((state, dt) => {
    const world = getWorld();
    const p = world.player;

    rig.group.position.set(p.pos.x, p.y, p.pos.z);
    rig.group.rotation.y = dampAngle(rig.group.rotation.y, p.heading, dt * 10);
    rig.group.visible = !p.dead;
    rig.animate({
      time: state.clock.elapsedTime,
      dt,
      speed: p.speed,
      resting: false,
      social: false,
    });

    // Attack slash arc.
    const slash = slashRef.current;
    if (slash) {
      if (p.attackTimer > 0) {
        slash.visible = true;
        const t = 1 - p.attackTimer / 0.3;
        slash.position.set(p.pos.x + Math.sin(p.heading) * 1.3, p.y + 1.1, p.pos.z + Math.cos(p.heading) * 1.3);
        slash.rotation.set(-Math.PI / 2, 0, -p.heading + t * 2.2);
        (slash.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - t);
      } else {
        slash.visible = false;
      }
    }

    if (useUI.getState().mode !== 'live') return;

    // Third-person chase camera.
    const yaw = inputState.camYaw;
    const pitch = inputState.camPitch;
    const dist = inputState.camDist;
    camTarget.set(p.pos.x, p.y + 1.55, p.pos.z);
    const horiz = Math.cos(pitch) * dist;
    camPos.set(
      camTarget.x - Math.sin(yaw) * horiz,
      camTarget.y - Math.sin(pitch) * dist,
      camTarget.z - Math.cos(yaw) * horiz,
    );
    // Keep the camera above the terrain.
    const groundAtCam = heightAt(camPos.x, camPos.z) + 0.4;
    if (camPos.y < groundAtCam) camPos.y = groundAtCam;

    const k = 1 - Math.exp(-dt * 14);
    camera.position.lerp(camPos, k);
    camera.lookAt(camTarget);
  });

  return (
    <>
      <primitive object={rig.group} />
      <mesh ref={slashRef} visible={false}>
        <ringGeometry args={[0.7, 1.15, 18, 1, 0, Math.PI * 0.8]} />
        <meshBasicMaterial color="#7fe7ff" transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </>
  );
}

function dampAngle(current: number, target: number, lambda: number): number {
  let d = (target - current) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return current + d * Math.min(1, lambda);
}
