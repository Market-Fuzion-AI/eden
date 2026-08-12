import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { COMBAT } from '../sim/config';
import { inCombat, lockedTarget, specFor } from '../sim/combat';
import { CREATURE_SPECIES_BY_ID } from '../sim/species';
import { heightAt } from '../sim/terrain';
import { useUI } from '../state/store';
import { inputState, installCanvasLook, isPointerLocked, releasePointerLock } from '../game/input';
import { cameraSettings, drainLook, recenter } from '../game/camera';
import { buildSettlerRig } from './factories';
import { toonMat } from './toon';

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
  const lockRef = useRef<THREE.Mesh>(null);
  const needsCamSnap = useRef(true);
  /** 0..1 — how far the Arc Blade has swung out of its stow. */
  const bladeDeploy = useRef(0);

  /**
   * The Arc Blade itself: a hilt, a hard-edged emitter and a lit blade. Built
   * once and parented to a pivot so a swing rotates the whole assembly rather
   * than animating geometry.
   */
  /**
   * Dodge afterimage.
   *
   * Three translucent copies of a simplified silhouette dropped along the path
   * of the roll and faded out. Emerson himself never disappears — the point is
   * to confirm "I dodged", not to make the character hard to follow.
   */
  const ghosts = useMemo(() => {
    const list: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.28, 0.85, 3, 8),
        new THREE.MeshBasicMaterial({ color: '#7fe7ff', transparent: true, opacity: 0, depthWrite: false }),
      );
      m.visible = false;
      list.push(m);
    }
    return list;
  }, []);
  const ghostGroup = useMemo(() => {
    const g = new THREE.Group();
    for (const m of ghosts) g.add(m);
    return g;
  }, [ghosts]);
  /** Where each ghost was dropped, and when. */
  const ghostTrail = useRef<{ x: number; y: number; z: number; at: number }[]>([]);
  const lastGhostAt = useRef(0);

  const { bladeGroup, bladePivot, capacitorGlow } = useMemo(() => {
    const root = new THREE.Group();
    // The pivot is the grip. Everything is built pointing along +y so the
    // blade reads as held rather than carried, and so a swing is a rotation
    // of the wrist rather than a translation of a bar.
    const pivot = new THREE.Group();
    root.add(pivot);
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.046, 0.24, 8), toonMat('#3f4654'));
    hilt.position.y = 0.02;
    pivot.add(hilt);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.07), toonMat('#8f96a8'));
    guard.position.y = 0.15;
    pivot.add(guard);
    // The cutting edge is emissive rather than lit, so it reads at night —
    // which is exactly when the player is most likely to be surprised.
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.78, 0.024),
      new THREE.MeshBasicMaterial({ color: '#7fe7ff', transparent: true, opacity: 0.9 }),
    );
    edge.position.y = 0.56;
    pivot.add(edge);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.74, 0.05), toonMat('#d8f4ff'));
    spine.position.y = 0.54;
    pivot.add(spine);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 4), toonMat('#eaf9ff'));
    tip.position.y = 1.0;
    pivot.add(tip);
    // The Capacitor accent: a second lit channel down the spine, hidden until
    // the upgrade exists.
    const accent = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.7, 0.062),
      new THREE.MeshBasicMaterial({ color: '#c9b6ff', transparent: true, opacity: 0, depthWrite: false }),
    );
    accent.position.y = 0.54;
    accent.visible = false;
    pivot.add(accent);
    return { bladeGroup: root, bladePivot: { current: pivot }, capacitorGlow: accent };
  }, []);
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
    // The extraction sinks him into the ground rather than deleting him: ARI
    // is recovering a body, and the valley watches it happen.
    if (p.extraction) {
      const span = Math.max(0.001, p.extraction.endsAt - p.extraction.startedAt);
      const k = Math.min(1, (world.timeSec - p.extraction.startedAt) / span);
      rig.group.position.y = p.y - k * 1.9;
      rig.group.rotation.z = k * 1.2;
    } else {
      rig.group.rotation.z = 0;
    }
    rig.group.visible = !p.dead || Boolean(p.extraction);
    // A roll tucks him forward — the clearest read that the i-frames are live.
    if (p.dodgeTimer > 0) {
      rig.group.rotation.x = -Math.sin((1 - p.dodgeTimer / COMBAT.dodgeDuration) * Math.PI) * 0.9;
    } else {
      rig.group.rotation.x = 0;
    }
    rig.animate({
      time: state.clock.elapsedTime,
      dt,
      speed: p.speed,
      resting: false,
      social: false,
      turnRate: dt > 0 ? turned / dt : 0,
    });

    // --- Arc Blade ---------------------------------------------------------
    // The blade is only in his hand once it has been built, and only when
    // there is a reason to hold it: it deploys in a fight and stows itself
    // afterwards, so ordinary walking around never looks like patrolling.
    const armed = p.equipped === 'arcBlade';
    const wantsBlade = armed && (inCombat(world) || p.strike !== null || p.lockedId !== null);
    bladeDeploy.current += ((wantsBlade ? 1 : 0) - bladeDeploy.current) * Math.min(1, dt * 7);
    const blade = bladeGroup;
    if (blade) {
      blade.visible = armed && bladeDeploy.current > 0.03;
      // Swing progression: 0 at rest, negative through the wind-up as the arm
      // is wound back, driven positive through the active window, trailing off
      // through the recovery.
      let swing = 0;
      let heavy = false;
      let step = 1;
      if (p.strike) {
        heavy = p.strike.kind === 'heavy';
        step = p.strike.chain;
        const spec = specFor(p.strike.kind, p.strike.chain);
        if (p.strike.phase === 'windup') swing = -1 * (1 - p.strike.timer / spec.windup);
        else if (p.strike.phase === 'active') swing = -1 + 2.4 * (1 - p.strike.timer / spec.active);
        else swing = 1.4 * Math.max(0, p.strike.timer / spec.recover);
      }
      const stow = 1 - bladeDeploy.current;
      const engage = Math.min(1, Math.abs(swing));
      // The whole assembly sits in Emerson's right hand and turns with him.
      // Tilting it away from the body (negative z) is what keeps a metre of
      // blade from passing through his own ribs at rest.
      blade.position.set(p.pos.x, p.y, p.pos.z);
      blade.rotation.set(0, p.heading, 0);
      bladePivot.current.position.set(0.3, 0.95 - stow * 0.16, 0.14 - stow * 0.42);

      // Each swing has its own motion. The chain is only a chain if the three
      // steps look different — otherwise it is a counter with a damage bonus,
      // which is exactly what v0.8 shipped.
      if (heavy) {
        // Overhead chop: raised high behind, driven down the centre line.
        bladePivot.current.rotation.set(-0.7 + swing * 1.7, 0.1, -0.15);
      } else if (step === 2) {
        // Reverse horizontal: comes back the other way, blade near flat.
        bladePivot.current.rotation.set(-0.35 - stow * 2.4, -swing * 1.55, -1.15 + engage * 0.35);
      } else if (step >= 3) {
        // Finisher: a big committed diagonal, from high right to low left.
        bladePivot.current.rotation.set(-0.9 + swing * 1.1 - stow * 2.4, swing * 1.2, -0.15 - engage * 1.3);
      } else {
        // Opener: quick diagonal cut across the body.
        bladePivot.current.rotation.set(-0.45 + swing * 0.15 - stow * 2.4, swing * 1.5, -0.35 - engage * 0.85);
      }

      // The Capacitor's tell. A second accent along the spine rather than a
      // recolour: the player should notice the blade changed, not think they
      // picked up a different weapon.
      capacitorGlow.visible = p.unlocks.capacitor;
      if (capacitorGlow.visible) {
        const pulse = 0.55 + Math.sin(state.clock.elapsedTime * 3.4) * 0.2 + engage * 0.5;
        (capacitorGlow.material as THREE.MeshBasicMaterial).opacity = Math.min(1, pulse);
      }
    }

    // Swing trail. Present only during the window that can actually damage
    // something, which is what makes the timing legible rather than decorative.
    const slash = slashRef.current;
    if (slash) {
      const s = p.strike;
      if (s && s.phase === 'active') {
        const spec = specFor(s.kind, s.chain);
        const t = 1 - s.timer / spec.active;
        const reach = spec.range * 0.42;
        // Each motion sweeps its own way, so the trail matches the arm.
        const heavySwing = s.kind === 'heavy';
        const reverse = !heavySwing && s.chain === 2;
        const from = heavySwing ? -1.2 : reverse ? -1.15 : 1.15;
        const to = heavySwing ? 1.3 : reverse ? 1.2 : -1.15;
        const height = heavySwing ? 0.85 : s.chain === 2 ? 1.05 : 1.2;
        slash.visible = true;
        slash.position.set(
          p.pos.x + Math.sin(p.heading) * reach,
          p.y + height,
          p.pos.z + Math.cos(p.heading) * reach,
        );
        slash.rotation.set(-Math.PI / 2, 0, -p.heading + from + (to - from) * t);
        slash.scale.setScalar(heavySwing ? 1.45 : s.chain >= 3 ? 1.25 : 1);
        const mat = slash.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.9 * (1 - t * 0.65);
        mat.color.set(p.unlocks.capacitor ? '#c9b6ff' : '#7fe7ff');
      } else {
        slash.visible = false;
      }
    }

    // Dodge afterimage. Ghosts are dropped along the roll and fade over
    // `dodgeTrail`, so the streak outlives the roll itself by a moment.
    if (p.dodgeTimer > 0 && state.clock.elapsedTime - lastGhostAt.current > 0.055) {
      lastGhostAt.current = state.clock.elapsedTime;
      ghostTrail.current.push({ x: p.pos.x, y: p.y, z: p.pos.z, at: state.clock.elapsedTime });
      if (ghostTrail.current.length > ghosts.length) ghostTrail.current.shift();
    }
    if (p.dodgeTrail <= 0 && ghostTrail.current.length > 0) ghostTrail.current.length = 0;
    for (let i = 0; i < ghosts.length; i++) {
      const entry = ghostTrail.current[i];
      const g = ghosts[i];
      if (!entry) {
        g.visible = false;
        continue;
      }
      const age = state.clock.elapsedTime - entry.at;
      const life = Math.max(0, 1 - age / COMBAT.dodgeTrail);
      g.visible = life > 0.02;
      g.position.set(entry.x, entry.y + 0.85, entry.z);
      g.rotation.y = p.heading;
      (g.material as THREE.MeshBasicMaterial).opacity = life * 0.3;
      g.scale.setScalar(0.85 + (1 - life) * 0.25);
    }

    // Lock-on marker, drawn in the world at the target's feet rather than as a
    // screen overlay, so it stays honest about where the thing actually is.
    const marker = lockRef.current;
    if (marker) {
      const target = lockedTarget(world);
      if (target) {
        // Sits under the target, at the height the target actually occupies —
        // a ground ring beneath something hovering three metres up points at
        // empty grass and reads as a bug.
        const def = CREATURE_SPECIES_BY_ID[target.speciesId];
        const base = heightAt(target.pos.x, target.pos.z) + (def.hover ? (def.hoverHeight ?? 0) : 0);
        marker.visible = true;
        marker.position.set(target.pos.x, base + 0.08, target.pos.z);
        marker.rotation.z = state.clock.elapsedTime * 1.1;
        const pulse = 1 + Math.sin(state.clock.elapsedTime * 4) * 0.06;
        marker.scale.setScalar(pulse);
      } else {
        marker.visible = false;
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
    //
    // Sample count is up from v0.7B: at six samples a boom that starts clear
    // and ends clear could pass straight through a tree trunk between two
    // samples, which is exactly the case that shows up when backing into
    // vegetation during a fight.
    //
    // Terrain and obstacles are answered differently, and conflating them is
    // what made fighting on a slope unplayable. Solid geometry — a trunk, a
    // boulder, the Fabricator — shortens the arm, because there is no way past
    // it. A rising bank behind the player does not: the boom climbs it and
    // looks down, which keeps the fight framed instead of shoving the camera
    // onto the back of Emerson's head every time the ground tilts.
    const desired = dist;
    const SAMPLES = 12;
    for (let i = 1; i <= SAMPLES; i++) {
      const test = desired * (i / SAMPLES);
      const hx = camTarget.x - Math.sin(yaw) * Math.cos(pitch) * test;
      const hz = camTarget.z - Math.cos(yaw) * Math.cos(pitch) * test;
      const hy = camTarget.y - Math.sin(pitch) * test;
      let obstructed = false;
      for (const o of world.obstacles) {
        // Trees and boulders are tall enough to matter; anything the camera
        // is already above is not in the way.
        const r = o.radius + 0.55;
        const dx = hx - o.pos.x;
        const dz = hz - o.pos.z;
        if (dx * dx + dz * dz < r * r && hy < heightAt(o.pos.x, o.pos.z) + 3.4) {
          obstructed = true;
          break;
        }
      }
      if (obstructed) {
        dist = Math.max(1.9, desired * ((i - 1) / SAMPLES));
        break;
      }
    }

    const horiz = Math.cos(pitch) * dist;
    camPos.set(
      camTarget.x - Math.sin(yaw) * horiz,
      camTarget.y - Math.sin(pitch) * dist,
      camTarget.z - Math.cos(yaw) * horiz,
    );

    // Lift the whole boom clear of every piece of ground it crosses, not just
    // the patch under the lens. Testing only the endpoint is what let the
    // camera sit happily above the ground on the far side of a mesa wall while
    // the wall itself filled the screen.
    let lift = 0;
    for (let i = 1; i <= SAMPLES; i++) {
      const k = i / SAMPLES;
      const hx = camTarget.x + (camPos.x - camTarget.x) * k;
      const hz = camTarget.z + (camPos.z - camTarget.z) * k;
      const hy = camTarget.y + (camPos.y - camTarget.y) * k;
      lift = Math.max(lift, heightAt(hx, hz) + 0.7 - hy);
    }
    if (lift > 0) {
      // The climb is bounded by how far the view may tip, not by a fixed
      // height. Left uncapped, a canyon wall lifts the camera until EDEN is
      // being played from directly overhead — which clears the geometry and
      // loses the game. Grazing a slope is the lesser failure.
      const horizDist = Math.hypot(camPos.x - camTarget.x, camPos.z - camTarget.z);
      const ceiling = horizDist * 1.3 - (camPos.y - camTarget.y);
      camPos.y += Math.max(0, Math.min(lift, ceiling));
    }

    // When the boom ends up jammed right against Emerson, drawing him fills the
    // screen with the inside of his own head. Fade him out instead — the camera
    // keeps working and the player keeps seeing what is in front of it.
    const effDist = camPos.distanceTo(camTarget);
    const rigVisible = rig.group.visible && effDist > 1.9;
    rig.group.visible = rigVisible;
    if (bladeGroup.visible) bladeGroup.visible = rigVisible;

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
      <primitive object={bladeGroup} visible={false} />
      <primitive object={ghostGroup} />
      <mesh ref={slashRef} visible={false}>
        <ringGeometry args={[0.7, 1.15, 18, 1, 0, Math.PI * 0.8]} />
        <meshBasicMaterial color="#7fe7ff" transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={lockRef} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.95, 1.15, 4, 1]} />
        <meshBasicMaterial color="#ff9a5f" transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} />
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
