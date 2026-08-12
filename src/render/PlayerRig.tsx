import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { heightAt } from '../sim/terrain';
import { useUI } from '../state/store';
import { inputState, installCanvasLook, isPointerLocked, releasePointerLock } from '../game/input';
import { cameraSettings, drainLook, recenter } from '../game/camera';
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
  const needsCamSnap = useRef(true);
  const camTarget = useMemo(() => new THREE.Vector3(), []);
  const camPos = useMemo(() => new THREE.Vector3(), []);
  /** Damped look velocity, so trackpad bursts read as smooth camera motion. */
  const lookVel = useRef({ yaw: 0, pitch: 0 });
  const recentering = useRef(false);

  // Look input is bound to the canvas so UI clicks can never rotate the world.
  useEffect(() => {
    const canvas = gl.domElement;
    const detach = installCanvasLook(canvas);
    // Pointer lock is strictly opt-in now: only players who asked for it get
    // their cursor taken, and only by clicking the world.
    const onClick = () => {
      const ui = useUI.getState();
      if (
        cameraSettings.pointerLockPreferred &&
        ui.mode === 'live' &&
        !ui.helpOpen &&
        !ui.dialogue &&
        !isPointerLocked()
      ) {
        canvas.requestPointerLock();
      }
    };
    canvas.addEventListener('click', onClick);
    return () => {
      detach();
      canvas.removeEventListener('click', onClick);
    };
  }, [gl]);

  // Give the cursor back whenever the world stops being directly playable.
  useEffect(() => {
    if (mode !== 'live' || helpOpen) releasePointerLock();
  }, [mode, helpOpen]);

  useFrame((state, dt) => {
    const world = getWorld();
    const p = world.player;

    rig.group.position.set(p.pos.x, p.y, p.pos.z);
    const prevRot = rig.group.rotation.y;
    // The sim already eases the heading, so the visual can track it closely
    // without reintroducing the swimmy feel a second damping layer would add.
    rig.group.rotation.y = dampAngle(prevRot, p.heading, dt * 18);
    let turned = (rig.group.rotation.y - prevRot) % (Math.PI * 2);
    if (turned > Math.PI) turned -= Math.PI * 2;
    if (turned < -Math.PI) turned += Math.PI * 2;
    rig.group.visible = !p.dead;
    rig.animate({
      time: state.clock.elapsedTime,
      dt,
      speed: p.speed,
      resting: false,
      social: false,
      turnRate: dt > 0 ? turned / dt : 0,
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

    if (useUI.getState().mode !== 'live') {
      needsCamSnap.current = true;
      // Discard look input accumulated while the god camera had the screen.
      drainLook();
      return;
    }

    // --- look integration --------------------------------------------------
    // Raw device deltas are folded into a velocity and bled off exponentially.
    // A trackpad delivers look as a stream of small uneven bursts; applying
    // them directly is what made the old camera feel twitchy.
    const pending = drainLook();
    // The look hint retires the first time the player actually looks, by any
    // means — there is no mode to learn any more, only the gesture.
    if ((pending.yaw !== 0 || pending.pitch !== 0) && !useUI.getState().learnedLook) {
      useUI.getState().setLearnedLook(true);
    }
    const step = Math.max(dt, 1 / 240);
    lookVel.current.yaw += pending.yaw / step;
    lookVel.current.pitch += pending.pitch / step;
    const decay = Math.exp(-dt * 18);
    inputState.camYaw += lookVel.current.yaw * dt;
    inputState.camPitch += lookVel.current.pitch * dt;
    lookVel.current.yaw *= decay;
    lookVel.current.pitch *= decay;
    if (Math.abs(lookVel.current.yaw) < 1e-4) lookVel.current.yaw = 0;
    if (Math.abs(lookVel.current.pitch) < 1e-4) lookVel.current.pitch = 0;
    inputState.camPitch = Math.max(-1.1, Math.min(0.5, inputState.camPitch));

    // --- recenter ----------------------------------------------------------
    // Sweep smoothly behind Emerson rather than snapping. Any manual look
    // input cancels it, so the player is never fighting their own camera.
    if (recenter.requested) {
      recenter.requested = false;
      recentering.current = true;
    }
    if (recentering.current) {
      if (pending.yaw !== 0 || pending.pitch !== 0) {
        recentering.current = false;
      } else {
        const k = 1 - Math.exp(-dt * 6);
        inputState.camYaw = dampAngle(inputState.camYaw, p.heading, k);
        inputState.camPitch += (-0.24 - inputState.camPitch) * k;
        let err = (p.heading - inputState.camYaw) % (Math.PI * 2);
        if (err > Math.PI) err -= Math.PI * 2;
        if (err < -Math.PI) err += Math.PI * 2;
        if (Math.abs(err) < 0.02) recentering.current = false;
      }
    }

    // --- chase camera ------------------------------------------------------
    const yaw = inputState.camYaw;
    const pitch = inputState.camPitch;
    let dist = inputState.camDist;
    camTarget.set(p.pos.x, p.y + 1.6, p.pos.z);

    // Boom-arm collision: shorten the arm until it clears the world rather than
    // letting the camera sink through a hillside or sit inside a tree trunk.
    // Sampling along the boom against the terrain function and the same
    // obstacle list the characters collide with is enough — a real physics pass
    // is not warranted here.
    const desired = dist;
    const SAMPLES = 6;
    for (let i = 1; i <= SAMPLES; i++) {
      const test = desired * (i / SAMPLES);
      const hx = camTarget.x - Math.sin(yaw) * Math.cos(pitch) * test;
      const hz = camTarget.z - Math.cos(yaw) * Math.cos(pitch) * test;
      const hy = camTarget.y - Math.sin(pitch) * test;
      let blocked = hy < heightAt(hx, hz) + 0.6;
      if (!blocked) {
        for (const o of world.obstacles) {
          // Trees and boulders are tall enough to matter; anything the camera
          // is already above is not in the way.
          const r = o.radius + 0.55;
          const dx = hx - o.pos.x;
          const dz = hz - o.pos.z;
          if (dx * dx + dz * dz < r * r && hy < heightAt(o.pos.x, o.pos.z) + 3.4) {
            blocked = true;
            break;
          }
        }
      }
      if (blocked) {
        dist = Math.max(1.5, desired * ((i - 1) / SAMPLES));
        break;
      }
    }

    const horiz = Math.cos(pitch) * dist;
    camPos.set(
      camTarget.x - Math.sin(yaw) * horiz,
      camTarget.y - Math.sin(pitch) * dist,
      camTarget.z - Math.cos(yaw) * horiz,
    );
    // Final guard: never end up under the ground.
    const groundAtCam = heightAt(camPos.x, camPos.z) + 0.5;
    if (camPos.y < groundAtCam) camPos.y = groundAtCam;

    if (needsCamSnap.current) {
      // Coming back from the god camera: take the shot immediately rather than
      // sweeping the camera across the valley through the terrain.
      needsCamSnap.current = false;
      camera.position.copy(camPos);
    } else {
      // Pulling in past an obstacle should be instant; easing back out should
      // not, or the camera pops every time a tree passes behind the player.
      const closing = camPos.distanceTo(camera.position) > 0 && dist < desired - 0.01;
      camera.position.lerp(camPos, 1 - Math.exp(-dt * (closing ? 26 : 11)));
    }
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
