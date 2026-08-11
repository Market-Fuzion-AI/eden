import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { getEntity, getWorld } from '../sim';
import { creatorSpawnFood } from '../sim/creator';
import { groundY } from '../sim/terrain';
import { useUI } from '../state/store';

/**
 * Creator Mode: god camera (pan/orbit/zoom) + click selection of entities,
 * plus click-to-place for armed interventions (spawn food).
 */
export function CreatorRig() {
  const { camera, gl, scene } = useThree();
  const controlsRef = useRef<MapControlsImpl>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const flyTarget = useRef<{ x: number; y: number; z: number; t: number } | null>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);

  // On entering creator mode, lift the camera above Emerson.
  useEffect(() => {
    const world = getWorld();
    const p = world.player;
    camera.position.set(p.pos.x + 18, p.y + 30, p.pos.z + 24);
    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(p.pos.x, p.y, p.pos.z);
      controls.update();
    }
  }, [camera]);

  // Fly to a requested world position (Chronicle event click).
  const focus = useUI((s) => s.focusRequest);
  useEffect(() => {
    if (!focus) return;
    flyTarget.current = { x: focus.x, z: focus.z, y: groundY(focus.x, focus.z), t: 0 };
  }, [focus, flyTarget]);

  // Click-to-select with drag rejection.
  useEffect(() => {
    const canvas = gl.domElement;
    let downX = 0;
    let downY = 0;
    const onDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; // was a drag
      const ui = useUI.getState();
      const rect = canvas.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);

      // Walk the scene front-to-back: the first tagged entity wins; the first
      // terrain hit either places an armed intervention or clears selection.
      let pickedId: string | null = null;
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const h of hits) {
        let obj: THREE.Object3D | null = h.object;
        while (obj && !obj.userData.eid && !obj.userData.terrain) obj = obj.parent;
        if (obj?.userData.eid) {
          pickedId = obj.userData.eid as string;
          break;
        }
        if (obj?.userData.terrain) {
          if (ui.spawnFoodArmed) {
            const ok = creatorSpawnFood(getWorld(), { x: h.point.x, z: h.point.z });
            if (ok) ui.setSpawnFoodArmed(false);
            return;
          }
          break;
        }
      }
      ui.select(pickedId);
      // A direct click on the world supersedes whatever event was being read.
      ui.selectEvent(null);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
    };
  }, [camera, gl, pointer, raycaster, scene]);

  // Camera flight + selection ring.
  useFrame(({ clock }, dt) => {
    // Ease the god camera toward a requested event location, preserving the
    // player's current viewing angle and distance so the move never disorients.
    const fly = flyTarget.current;
    const controls = controlsRef.current;
    if (fly && controls) {
      fly.t += dt;
      const k = 1 - Math.exp(-dt * 3.2);
      const offX = camera.position.x - controls.target.x;
      const offY = camera.position.y - controls.target.y;
      const offZ = camera.position.z - controls.target.z;
      controls.target.x += (fly.x - controls.target.x) * k;
      controls.target.y += (fly.y - controls.target.y) * k;
      controls.target.z += (fly.z - controls.target.z) * k;
      camera.position.set(controls.target.x + offX, controls.target.y + offY, controls.target.z + offZ);
      controls.update();
      const remaining = Math.hypot(fly.x - controls.target.x, fly.z - controls.target.z);
      if (remaining < 0.6 || fly.t > 3) flyTarget.current = null;
    }

    const ring = ringRef.current;
    if (!ring) return;
    const id = useUI.getState().selectedId;
    if (!id) {
      ring.visible = false;
      return;
    }
    let x: number;
    let z: number;
    if (id === 'emerson') {
      const p = getWorld().player;
      x = p.pos.x;
      z = p.pos.z;
    } else {
      const e = getEntity(id);
      if (!e) {
        ring.visible = false;
        return;
      }
      x = e.pos.x;
      z = e.pos.z;
    }
    ring.visible = true;
    ring.position.set(x, groundY(x, z) + 0.12, z);
    const s = 1 + Math.sin(clock.elapsedTime * 3.5) * 0.08;
    ring.scale.set(s, s, s);
  });

  return (
    <>
      <MapControls
        ref={controlsRef}
        makeDefault={false}
        enableDamping
        dampingFactor={0.12}
        minDistance={6}
        maxDistance={220}
        maxPolarAngle={Math.PI / 2.15}
        panSpeed={1.1}
      />
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.9, 1.15, 32]} />
        <meshBasicMaterial color="#7fe7ff" transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </>
  );
}
