import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { SCANNER } from '../sim/config';
import { MATERIALS, materialForNodeType } from '../sim/fabrication';
import { heightAt } from '../sim/terrain';
import { useUI } from '../state/store';
import { registerScanMarkers } from '../game/debugBridge';

/**
 * Pathfinder Scanner Mk I, on screen: one expanding ground ring per sweep, and
 * a floating marker over each detected node until the highlight expires.
 *
 * Deliberately restrained. The scanner answers "is there anything useful near
 * me?" — permanent world-wide glow would answer a different question and end
 * exploration, so the ring fades, the markers expire, and nothing lights up
 * that has not been swept.
 */

const MAX_MARKERS = 24;

export function ScannerFX() {
  const mode = useUI((s) => s.mode);
  const ringRef = useRef<THREE.Mesh>(null);
  const markersRef = useRef<THREE.Group>(null);

  // A fixed pool of markers, re-pointed each frame — no allocation per sweep.
  const markers = useMemo(() => {
    const group = new THREE.Group();
    for (let i = 0; i < MAX_MARKERS; i++) {
      const m = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.62, 0.045, 4, 18),
        new THREE.MeshBasicMaterial({ color: '#7fe7ff', transparent: true, depthWrite: false }),
      );
      ring.rotation.x = Math.PI / 2;
      m.add(ring);
      const pip = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.2),
        new THREE.MeshBasicMaterial({ color: '#7fe7ff', transparent: true, depthWrite: false }),
      );
      pip.position.y = 1.5;
      m.add(pip);
      m.visible = false;
      group.add(m);
    }
    registerScanMarkers(group);
    return group;
  }, []);

  useFrame(({ clock }) => {
    const world = getWorld();
    const p = world.player;
    const t = world.timeSec;

    // --- pulse ring -------------------------------------------------------
    const ring = ringRef.current;
    if (ring) {
      const age = t - p.scan.pulseStartedAt;
      const active = age >= 0 && age < SCANNER.pulseDuration;
      ring.visible = active && mode === 'live';
      if (active) {
        const k = age / SCANNER.pulseDuration;
        const r = Math.max(0.4, k * p.scan.radius);
        ring.scale.set(r, r, r);
        ring.position.set(p.pos.x, heightAt(p.pos.x, p.pos.z) + 0.5, p.pos.z);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k) ** 1.4;
      }
    }

    // --- detected node markers -------------------------------------------
    const g = markersRef.current;
    if (!g) return;
    const lit = t < p.scan.activeUntil ? p.scan.nodeIds : [];
    // Fade the whole set out over the last couple of seconds, so the world
    // going quiet again reads as the scan expiring rather than a pop.
    const remaining = p.scan.activeUntil - t;
    const fade = Math.max(0, Math.min(1, remaining / 2));

    for (let i = 0; i < MAX_MARKERS; i++) {
      const marker = g.children[i] as THREE.Group;
      const id = lit[i];
      if (!id) {
        marker.visible = false;
        continue;
      }
      const node = world.resources.find((r) => r.id === id);
      // Never point at a seam that has since been worked out.
      if (!node || node.quantity < 1) {
        marker.visible = false;
        continue;
      }
      const def = materialForNodeType(node.type);
      if (!def) {
        marker.visible = false;
        continue;
      }
      marker.visible = true;
      marker.position.set(node.pos.x, heightAt(node.pos.x, node.pos.z) + 0.1, node.pos.z);
      const color = MATERIALS[def.id].color;
      const bob = Math.sin(clock.elapsedTime * 2 + i) * 0.12;
      const [ringMesh, pip] = marker.children as [THREE.Mesh, THREE.Mesh];
      const rm = ringMesh.material as THREE.MeshBasicMaterial;
      const pm = pip.material as THREE.MeshBasicMaterial;
      rm.color.set(color);
      pm.color.set(color);
      rm.opacity = 0.55 * fade;
      pm.opacity = 0.85 * fade;
      pip.position.y = 1.5 + bob;
      pip.rotation.y = clock.elapsedTime * 1.4;
    }
  });

  return (
    <>
      <mesh ref={ringRef} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.88, 1, 48]} />
        <meshBasicMaterial color="#7fe7ff" transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <primitive ref={markersRef} object={markers} />
    </>
  );
}
