import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getEntity, getWorld } from '../sim';
import { settlerRole } from '../sim/npcContext';
import { CREATURE_SPECIES_BY_ID } from '../sim/species';
import { PLAYER, WORLD } from '../sim/config';
import { groundY } from '../sim/terrain';
import type { Entity, IntelligentSpeciesId } from '../sim/types';
import { useUI } from '../state/store';
import { ambientChatter } from '../sim/dialogue';
import { threatPhase } from '../sim/threats';
import { buildCreatureRig, buildLumiRig, buildSettlerRig, type Rig } from './factories';
import { nameplateTexture, speechBubbleMaterial, statusSpriteMaterial } from './toon';

/** Ambient conversation bubbles only appear within earshot of Kai. */
const BUBBLE_RANGE = 26;
/**
 * How far a name is readable.
 *
 * Full strength close in, fading to nothing by `NAME_FAR`, so a crowd at Human
 * Landing is immediately legible and the far treeline does not become a wall of
 * floating text.
 */
const NAME_NEAR = 19;
const NAME_FAR = 36;
const WHITE = new THREE.Color('#ffffff');

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
  const nameRef = useRef<THREE.Sprite>(null);
  /** Ground telegraph ring — the tell that survives distance. */
  const ringRef = useRef<THREE.Mesh>(null);
  /** Impact flare, synthetics only. */
  const sparkRef = useRef<THREE.Mesh>(null);
  const visualPos = useRef(new THREE.Vector3());
  const initialized = useRef(false);
  /** True while a hit flash is being applied, so it gets cleared exactly once. */
  const flashing = useRef(false);

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

    // Combat telegraph. Every attack in EDEN is preceded by something visible
    // on the creature itself, and this is where the simulation's threat state
    // becomes that visible thing.
    let phaseState = 'calm';
    let phaseProgress = 0;
    if (e.kind === 'creature' && e.combat) {
      const phase = threatPhase(world, e);
      phaseState = phase.state;
      phaseProgress = phase.progress;
      rig.setCharge?.(phase.progress, phase.state);
    }

    // The ground tell.
    //
    // A ring painted on the earth under a creature that is warning or
    // committing. This is the channel that actually solves reading a Rakhor at
    // twenty metres: pose changes shrink with distance, but a two-metre ring on
    // the ground stays a two-metre ring, and it is visible over scrub and past
    // the animal's own silhouette.
    const ring = ringRef.current;
    if (ring) {
      const warning = phaseState === 'warn';
      const committing = phaseState === 'windup' || phaseState === 'charge';
      if (warning || committing) {
        ring.visible = true;
        ring.position.set(0, -rig.group.position.y + groundY(e.pos.x, e.pos.z) + 0.06, 0);
        const mat = ring.material as THREE.MeshBasicMaterial;
        if (committing) {
          // Closes inward as the attack lands: a countdown you can see.
          ring.scale.setScalar(2.6 - phaseProgress * 1.5);
          mat.color.set('#ff5f6a');
          mat.opacity = 0.45 + phaseProgress * 0.4;
        } else {
          // Warning: a slow pulse that says "not yet, but soon".
          const pulse = 0.5 + Math.sin(state.clock.elapsedTime * 4.5) * 0.5;
          ring.scale.setScalar(2.5 + pulse * 0.35);
          mat.color.set('#ffb03f');
          mat.opacity = 0.3 + pulse * 0.3;
        }
      } else {
        ring.visible = false;
      }
    }

    rig.animate({
      time: state.clock.elapsedTime,
      dt,
      speed: e.speed,
      resting: e.resting,
      social: e.socialTimer > 0,
      agitated: e.kind === 'settler' && Boolean(e.confronting),
    });

    // Hit reaction.
    //
    // A flash alone was not enough physical confirmation in v0.8: a hit read as
    // a lighting change rather than an impact. It now also shoves the whole rig
    // back along the direction the blow came from and snaps it upright again,
    // which is what makes a landed strike feel like it connected with a body.
    if (e.kind === 'creature' && e.hitAt !== undefined) {
      const since = world.timeSec - e.hitAt;
      const flash = since >= 0 && since < 0.18 ? 1 - since / 0.18 : 0;
      if (flash > 0 || flashing.current) {
        flashing.current = flash > 0;
        rig.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const mat = m.material as THREE.MeshToonMaterial;
          if (!mat.emissive) return;
          const base = (mat.userData.baseEmissive ??= mat.emissive.clone());
          // Bright enough to be unmissable, short of erasing the creature's own
          // colour — a target you cannot identify mid-fight is worse than a
          // subtle hit.
          mat.emissive.copy(base as THREE.Color).lerp(WHITE, flash * 0.6);
        });
      }
      // Recoil rides on top of the smoothed position rather than replacing it,
      // so a shove never desynchronises the rig from where the creature is.
      const recoilT = since >= 0 && since < 0.26 ? 1 - since / 0.26 : 0;
      if (recoilT > 0 && e.hitFrom) {
        const force = (e.hitForce ?? 0.5) * recoilT * recoilT;
        rig.group.position.x += e.hitFrom.x * force * 0.55;
        rig.group.position.z += e.hitFrom.z * force * 0.55;
        rig.group.rotation.x = -force * 0.4;
      } else if (phaseState !== 'staggered') {
        rig.group.rotation.x = 0;
      }
      // Synthetics throw sparks instead of flinching — a machine taking a hit
      // should sound and look like metal, not meat.
      const spark = sparkRef.current;
      if (spark) {
        const synthetic = e.kind === 'creature' && CREATURE_SPECIES_BY_ID[e.speciesId].synthetic;
        const life = since >= 0 && since < 0.3 ? 1 - since / 0.3 : 0;
        spark.visible = Boolean(synthetic) && life > 0.02;
        if (spark.visible) {
          spark.position.set(0, rig.height * 0.55, 0);
          spark.scale.setScalar(0.5 + (1 - life) * 2.4);
          (spark.material as THREE.MeshBasicMaterial).opacity = life * 0.8;
        }
      }
    }

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
      // A creature squaring up to Kai gets the same marker as a startled
      // one: the warning is the last moment walking away still works.
      else if (e.kind === 'creature' && e.combat && (e.combat.state === 'warn' || e.combat.state === 'alert')) {
        kind = 'alert';
      } else if (e.kind === 'creature' && e.threatUntil > world.timeSec) kind = 'alert';
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
          // Above the name plate, which sits directly over the head.
          bubble.position.set(0, rig.height + 1.62, 0);
          show = true;
        }
      }
      bubble.visible = show;
    }

    // Who this is. Only people get one — the valley's wildlife is identified by
    // looking at it, not by a label.
    const plate = nameRef.current;
    if (plate) {
      let show = false;
      if (e.kind === 'settler') {
        const dx = e.pos.x - world.player.pos.x;
        const dz = e.pos.z - world.player.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < NAME_FAR) {
          const entry = nameplateTexture(e.name, settlerRole(e));
          const mat = plate.material as THREE.SpriteMaterial;
          if (mat.map !== entry.tex) {
            mat.map = entry.tex;
            mat.needsUpdate = true;
            plate.scale.set(0.4 * entry.aspect, 0.4, 1);
          }
          // Fades out with distance, and the person Kai could actually talk to
          // right now reads brightest, so the crowd resolves into one answer.
          const fade = 1 - Math.max(0, (d - NAME_NEAR) / (NAME_FAR - NAME_NEAR));
          const focused = world.conversation?.settlerId === e.id || d < PLAYER.talkRange;
          mat.opacity = Math.min(1, fade * (focused ? 1 : 0.82));
          plate.position.set(0, rig.height + 0.72, 0);
          show = mat.opacity > 0.02;
        }
      }
      plate.visible = show;
    }
  });

  if (!rig) return null;
  return (
    <primitive object={rig.group}>
      <sprite ref={spriteRef} scale={[0.55, 0.55, 1]} visible={false} />
      <sprite ref={bubbleRef} visible={false} renderOrder={10} />
      <sprite ref={nameRef} visible={false} renderOrder={9}>
        <spriteMaterial transparent depthWrite={false} depthTest={false} />
      </sprite>
      <mesh ref={ringRef} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.82, 1, 32]} />
        <meshBasicMaterial color="#ffb03f" transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={sparkRef} visible={false}>
        <sphereGeometry args={[0.22, 8, 6]} />
        <meshBasicMaterial color="#d8f4ff" transparent opacity={0.8} depthWrite={false} />
      </mesh>
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
