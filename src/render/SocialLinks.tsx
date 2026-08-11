import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { registerSocialLinks } from '../game/debugBridge';
import { getEntity, getWorld } from '../sim';
import { relationshipState, type RelationshipState } from '../sim/relationships';
import { groundY } from '../sim/terrain';
import { useUI } from '../state/store';

/**
 * Creator-only social graph: lines from the selected settler to everyone they
 * have a relationship with, coloured by state and thickened by strength.
 *
 * Rebuilt geometry each frame is fine at this scale (one settler's bonds,
 * ~20 segments max) and keeps the lines glued to moving agents.
 */

const STATE_COLOR: Record<RelationshipState, string> = {
  Hostile: '#ff5f6a',
  Wary: '#ff9a4a',
  Neutral: '#8fa3b0',
  Familiar: '#6fd0e8',
  Friendly: '#6fe89f',
  Bonded: '#c08bff',
};

const MAX_LINKS = 24;
/** Two triangles per link, laid out as a flat ribbon on the ground. */
const VERTS_PER_LINK = 6;

export function SocialLinks() {
  const meshRef = useRef<THREE.Mesh | null>(null);

  const { geometry, positions, colors } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_LINKS * VERTS_PER_LINK * 3);
    const col = new Float32Array(MAX_LINKS * VERTS_PER_LINK * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setDrawRange(0, 0);
    return { geometry: geo, positions: pos, colors: col };
  }, []);

  const tmpColor = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const ui = useUI.getState();
    const id = ui.selectedId;

    if (ui.mode !== 'creator' || !ui.showSocialLinks || !id) {
      mesh.visible = false;
      return;
    }
    const subject = getEntity(id);
    if (!subject || subject.kind !== 'settler') {
      mesh.visible = false;
      return;
    }

    const world = getWorld();
    const ax = subject.pos.x;
    const az = subject.pos.z;
    const ay = groundY(ax, az) + 0.16;

    let v = 0;
    let links = 0;
    for (const [otherId, rel] of Object.entries(subject.relationships)) {
      if (links >= MAX_LINKS) break;
      let bx: number;
      let bz: number;
      if (otherId === 'emerson') {
        bx = world.player.pos.x;
        bz = world.player.pos.z;
      } else {
        const other = getEntity(otherId);
        if (!other) continue;
        bx = other.pos.x;
        bz = other.pos.z;
      }
      const state = relationshipState(rel);
      tmpColor.set(STATE_COLOR[state]);

      // Ribbon width encodes how strongly they feel about each other.
      const strength = Math.max(Math.abs(rel.affinity), rel.fear, rel.trust * 0.6) / 100;
      const half = 0.12 + strength * 0.5;

      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      // Perpendicular in the ground plane.
      const px = (-dz / len) * half;
      const pz = (dx / len) * half;
      const by = groundY(bx, bz) + 0.16;

      const quad: [number, number, number][] = [
        [ax + px, ay, az + pz],
        [ax - px, ay, az - pz],
        [bx - px, by, bz - pz],
        [ax + px, ay, az + pz],
        [bx - px, by, bz - pz],
        [bx + px, by, bz + pz],
      ];
      for (const [x, y, z] of quad) {
        positions[v * 3] = x;
        positions[v * 3 + 1] = y;
        positions[v * 3 + 2] = z;
        colors[v * 3] = tmpColor.r;
        colors[v * 3 + 1] = tmpColor.g;
        colors[v * 3 + 2] = tmpColor.b;
        v++;
      }
      links++;
    }

    geometry.setDrawRange(0, v);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.computeBoundingSphere();
    mesh.visible = v > 0;
  });

  return (
    <mesh
      ref={(m) => {
        meshRef.current = m;
        registerSocialLinks(m);
      }}
      geometry={geometry}
      visible={false}
      renderOrder={6}
    >
      {/* toneMapped={false} keeps the state colours vivid — this is an
          information overlay, not part of the lit scene. */}
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={0.72}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
