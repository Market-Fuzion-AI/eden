import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getEntity, getWorld } from '../sim';
import { CREATURE_SPECIES_BY_ID } from '../sim/species';
import { WORLD } from '../sim/config';
import { groundY } from '../sim/terrain';
import type { Entity, IntelligentSpeciesId } from '../sim/types';
import { useUI } from '../state/store';
import { ambientChatter } from '../sim/dialogue';
import { buildCreatureRig, buildLumiRig, buildSettlerRig, type Rig } from './factories';
import { speechBubbleMaterial, statusSpriteMaterial } from './toon';

/** Ambient conversation bubbles only appear within earshot of Emerson. */
const BUBBLE_RANGE = 26;

/**
 * Presentation adapter: each sim entity gets a rig whose transform is
 * smoothed toward sim state every frame. No simulation logic lives here —
 * entities keep existing (and acting) even when nothing renders them.
 */

/** Registry used by Creator Mode raycast selection. */
export const entityGroups = new Map<string, THREE.Group>();

function AgentView({ id }: { id: string }) {
  const rig = useMemo<Rig | null>(() => {
    const e = getEntity(id);
    if (!e) return null;
    let r: Rig;
    if (e.kind === 'settler') {
      const variant = Math.abs(hashStr(e.id)) % 1000 / 1000;
      r = buildSettlerRig(e.speciesId as IntelligentSpeciesId, e.sex, variant);
    } else if (e.lumi) {
      r = buildLumiRig(CREATURE_SPECIES_BY_ID[e.speciesId], true);
    } else {
      r = buildCreatureRig(CREATURE_SPECIES_BY_ID[e.speciesId], e.visualVariant, e.ageStage === 'juvenile');
    }
    r.group.userData.eid = id;
    r.group.traverse((o) => (o.userData.eid = id));
    return r;
  }, [id]);

  const spriteRef = useRef<THREE.Sprite>(null);
  const bubbleRef = useRef<THREE.Sprite>(null);
  const visualPos = useRef(new THREE.Vector3());
  const initialized = useRef(false);

  useEffect(() => {
    if (!rig) return;
    entityGroups.set(id, rig.group);
    return () => {
      entityGroups.delete(id);
    };
  }, [id, rig]);

  useFrame((state, dt) => {
    if (!rig) return;
    const e = getEntity(id) as Entity | undefined;
    if (!e) {
      rig.group.visible = false;
      return;
    }
    const world = getWorld();
    const def = e.kind === 'creature' ? CREATURE_SPECIES_BY_ID[e.speciesId] : null;

    let targetY: number;
    if (def?.aquatic) targetY = WORLD.waterLevel - 0.25;
    else if (def?.hover) targetY = groundY(e.pos.x, e.pos.z) + (def.hoverHeight ?? 1.5);
    else targetY = groundY(e.pos.x, e.pos.z);

    const target = visualPos.current;
    if (!initialized.current) {
      target.set(e.pos.x, targetY, e.pos.z);
      rig.group.position.copy(target);
      initialized.current = true;
    } else {
      // Exponential smoothing scaled by sim speed so fast-forward doesn't rubber-band.
      const speed = useUI.getState().speed;
      const k = 1 - Math.exp(-dt * 10 * Math.max(1, speed * 0.6));
      target.set(
        rig.group.position.x + (e.pos.x - rig.group.position.x) * k,
        rig.group.position.y + (targetY - rig.group.position.y) * k,
        rig.group.position.z + (e.pos.z - rig.group.position.z) * k,
      );
      // Snap on teleports (creator time jumps etc).
      if (Math.abs(e.pos.x - rig.group.position.x) + Math.abs(e.pos.z - rig.group.position.z) > 30) {
        target.set(e.pos.x, targetY, e.pos.z);
      }
      rig.group.position.copy(target);
    }
    rig.group.rotation.y = dampAngle(rig.group.rotation.y, e.heading, dt * 8);

    rig.animate({
      time: state.clock.elapsedTime,
      dt,
      speed: e.speed,
      resting: e.resting,
      social: e.socialTimer > 0,
      agitated: e.kind === 'settler' && Boolean(e.confronting),
    });

    // Status sprite: talking / sleeping / fleeing.
    const sprite = spriteRef.current;
    if (sprite) {
      let kind: 'social' | 'sleep' | 'alert' | 'argue' | 'gift' | null = null;
      if (e.socialTimer > 0) {
        // Arguments and gifts read differently from ordinary conversation.
        if (e.kind === 'settler' && e.confronting) kind = 'argue';
        else if (e.kind === 'settler' && e.goal.type === 'share-food') kind = 'gift';
        else kind = 'social';
      } else if (e.resting) kind = 'sleep';
      else if (e.kind === 'creature' && e.threatUntil > world.timeSec) kind = 'alert';
      if (kind) {
        sprite.visible = true;
        sprite.material = statusSpriteMaterial(kind);
        sprite.position.set(0, rig.height + 0.5, 0);
      } else {
        sprite.visible = false;
      }
    }

    // Ambient speech bubble for autonomous conversations happening near the
    // player, so a Chronicle line about a conversation has something visible
    // behind it. Only the alphabetically-first speaker shows it, and only
    // within earshot, so the world never fills with text.
    const bubble = bubbleRef.current;
    if (bubble) {
      let show = false;
      if (
        e.kind === 'settler' &&
        e.goal.type === 'socialize' &&
        e.goal.phase === 'act' &&
        e.goal.targetId &&
        e.id < e.goal.targetId
      ) {
        const dx = e.pos.x - world.player.pos.x;
        const dz = e.pos.z - world.player.pos.z;
        if (dx * dx + dz * dz < BUBBLE_RANGE * BUBBLE_RANGE) {
          const topic = ambientChatter(e.id, e.goal.targetId, e.goal.startedAt);
          const mat = speechBubbleMaterial(`…${topic}`);
          if (bubble.material !== mat) {
            bubble.material = mat;
            const aspect = (mat.userData.aspect as number) ?? 3;
            bubble.scale.set(0.62 * aspect, 0.62, 1);
          }
          bubble.position.set(0, rig.height + 1.05, 0);
          show = true;
        }
      }
      bubble.visible = show;
    }
  });

  if (!rig) return null;
  return (
    <primitive object={rig.group}>
      <sprite ref={spriteRef} scale={[0.55, 0.55, 1]} visible={false} />
      <sprite ref={bubbleRef} visible={false} renderOrder={10} />
    </primitive>
  );
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function dampAngle(current: number, target: number, lambda: number): number {
  let d = (target - current) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return current + d * Math.min(1, lambda);
}

export function Agents() {
  // Re-render only when entities are added/removed (replication, death).
  useUI((s) => s.entitiesVersion);
  const world = getWorld();
  return (
    <group>
      {world.settlers.map((s) => (
        <AgentView key={s.id} id={s.id} />
      ))}
      {world.creatures.map((c) => (
        <AgentView key={c.id} id={c.id} />
      ))}
    </group>
  );
}
