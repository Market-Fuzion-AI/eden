import * as THREE from 'three';
import { INTELLIGENT_SPECIES, type CreatureSpeciesDef } from '../sim/species';
import type { IntelligentSpeciesId, Sex } from '../sim/types';
import { toonMat } from './toon';

/**
 * Procedural stylized character/creature factories. These are the visual
 * placeholders for a future GLTF pipeline: the simulation never depends on
 * this geometry, and each factory returns a Rig with a uniform animate() API.
 *
 * Readability is the priority — a player should identify species by
 * silhouette alone, at distance, without labels.
 */

export interface AnimCtx {
  time: number;
  dt: number;
  speed: number; // m/s
  resting: boolean;
  social: boolean;
  /** Mid-confrontation: sharper, larger gestures. */
  agitated?: boolean;
  /** Radians per second of turning, for body banking. */
  turnRate?: number;
  /**
   * Airborne state, for the jump pose. `air` is vertical velocity in m/s, so
   * the rise and the fall read differently: legs tuck going up, reach going
   * down. `landedAgo` is seconds since touchdown, driving the crouch.
   */
  airborne?: boolean;
  air?: number;
  landedAgo?: number;
}

export interface Rig {
  group: THREE.Group;
  animate(ctx: AnimCtx): void;
  /** Approximate head height for status sprites / selection rings. */
  height: number;
  /**
   * Combat telegraph, 0..1. Present only on rigs that can threaten Emerson:
   * the renderer feeds it the wind-up progress so the tell is part of the
   * creature itself — a lowered head, a brightening core — rather than an
   * icon floating above it.
   */
  setCharge?(amount: number, state: string): void;
}

const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 10);
const sphere = (r: number, seg = 14) => new THREE.SphereGeometry(r, seg, Math.max(8, seg - 2));
const cone = (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function pick<T>(arr: T[], variant: number): T {
  return arr[Math.floor(variant * 997) % arr.length];
}

const EYE_DARK = '#12161f';

/** Eyes with a highlight — the single cheapest readability win on any face. */
function addEyes(parent: THREE.Object3D, spread: number, y: number, z: number, radius: number): void {
  const white = toonMat('#f6f8fb');
  const iris = toonMat(EYE_DARK);
  const glint = toonMat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 1.2 });
  for (const side of [-1, 1]) {
    parent.add(mesh(sphere(radius, 10), white, spread * side, y, z));
    parent.add(mesh(sphere(radius * 0.62, 10), iris, spread * side, y, z + radius * 0.55));
    parent.add(mesh(sphere(radius * 0.22, 8), glint, spread * side + radius * 0.28, y + radius * 0.34, z + radius * 0.7));
  }
}

// ---------------------------------------------------------------------------
// Bipedal settlers (Humans, Veyra, Caelari) + Emerson
// ---------------------------------------------------------------------------

export function buildSettlerRig(
  speciesId: IntelligentSpeciesId,
  sex: Sex,
  variant: number,
  emerson = false,
): Rig {
  const def = INTELLIGENT_SPECIES[speciesId];
  const skin = toonMat(emerson ? '#e2b088' : pick(def.palette.skin, variant));
  const outfit = toonMat(emerson ? '#26506b' : pick(def.palette.outfit, variant + 0.31));
  const outfitAlt = toonMat(emerson ? '#1b3a4d' : pick(def.palette.outfitAlt, variant + 0.73));
  const hairMat = toonMat(pick(def.palette.hair, variant + 0.57));
  const accent = toonMat(def.palette.accent, { emissive: def.palette.accent, emissiveIntensity: 0.45 });

  const group = new THREE.Group();
  const heightScale = (speciesId === 'veyra' ? 1.08 : speciesId === 'caelari' ? 0.95 : 1) * (sex === 'female' ? 0.95 : 1);
  const body = new THREE.Group();
  body.scale.setScalar(heightScale);
  group.add(body);

  // --- legs: hip pivot, thigh + boot so the limb reads as jointed ---------
  const mkLeg = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.115 * side, 0.86, 0);
    pivot.add(mesh(capsule(0.075, 0.42), outfit, 0, -0.28, 0));
    pivot.add(mesh(box(0.17, 0.11, 0.26), outfitAlt, 0, -0.57, 0.03));
    body.add(pivot);
    return pivot;
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);

  // --- torso: tapered chest, shoulder yoke, belt --------------------------
  const chest = mesh(capsule(0.21, 0.34), outfit, 0, 1.16, 0);
  if (speciesId === 'veyra') chest.scale.set(1.2, 1.02, 1.14);
  else if (speciesId === 'caelari') chest.scale.set(0.9, 1.02, 0.94);
  else if (sex === 'female') chest.scale.set(0.94, 1, 0.96);
  body.add(chest);
  const yoke = mesh(capsule(0.13, 0.34), outfitAlt, 0, 1.38, 0);
  yoke.rotation.z = Math.PI / 2;
  body.add(yoke);
  body.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.055, 14), accent, 0, 0.96, 0));

  // --- arms: shoulder pivot, sleeve + bare forearm + hand -----------------
  const mkArm = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.265 * side, 1.36, 0);
    pivot.add(mesh(capsule(0.062, 0.22), outfit, 0, -0.14, 0));
    pivot.add(mesh(capsule(0.05, 0.2), skin, 0, -0.36, 0));
    pivot.add(mesh(sphere(0.055, 8), skin, 0, -0.5, 0));
    body.add(pivot);
    return pivot;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);

  // --- head: neck, skull, face ------------------------------------------
  body.add(mesh(capsule(0.055, 0.08), skin, 0, 1.5, 0));
  const head = new THREE.Group();
  head.position.set(0, 1.63, 0);
  body.add(head);
  const skull = mesh(sphere(0.165, 16), skin);
  skull.scale.set(1, 1.06, 1);
  head.add(skull);
  // Brow ridge reads as a face direction even in silhouette.
  head.add(mesh(box(0.19, 0.032, 0.05), skin, 0, 0.07, 0.135));

  let tail: THREE.Group | null = null;
  const wings: THREE.Object3D[] = [];

  if (speciesId === 'human') {
    addEyes(head, 0.062, 0.012, 0.135, 0.032);
    // Hair: cap plus a silhouette-defining shape per sex.
    const cap = mesh(sphere(0.168, 14), hairMat, 0, 0.048, -0.012);
    cap.scale.set(1.04, 0.86, 1.04);
    head.add(cap);
    // Fringe.
    const fringe = mesh(box(0.24, 0.07, 0.06), hairMat, 0, 0.115, 0.115);
    head.add(fringe);
    if (sex === 'female') {
      const tailHair = mesh(capsule(0.062, 0.2), hairMat, 0, -0.02, -0.2);
      tailHair.rotation.x = 0.4;
      head.add(tailHair);
    } else {
      head.add(mesh(box(0.2, 0.05, 0.08), hairMat, 0, 0.02, -0.16));
    }
  } else if (speciesId === 'veyra') {
    // Unmistakably reptilian: long snout, jaw, brow horns, dorsal crest, tail.
    const snoutGroup = new THREE.Group();
    snoutGroup.position.set(0, -0.025, 0.115);
    const upper = mesh(box(0.115, 0.085, 0.24), skin, 0, 0.02, 0.1);
    const lower = mesh(box(0.1, 0.055, 0.2), toonMat(def.palette.belly), 0, -0.045, 0.09);
    const nose = mesh(sphere(0.045, 10), skin, 0, 0.03, 0.21);
    snoutGroup.add(upper, lower, nose);
    head.add(snoutGroup);
    // Reptile eyes sit high and wide on the skull.
    addEyes(head, 0.098, 0.055, 0.09, 0.03);
    // Brow horns.
    for (const side of [-1, 1]) {
      const horn = mesh(cone(0.028, 0.13, 6), toonMat(def.palette.belly), 0.095 * side, 0.12, 0.02);
      horn.rotation.set(-0.5, 0, -0.4 * side);
      head.add(horn);
    }
    // Dorsal crest running skull → spine.
    for (let i = 0; i < 5; i++) {
      const fin = mesh(cone(0.038, 0.16 - i * 0.022, 5), hairMat, 0, 0.15 - i * 0.012, -0.05 - i * 0.055);
      fin.scale.set(0.35, 1, 1);
      fin.rotation.x = -0.55 - i * 0.12;
      head.add(fin);
    }
    for (let i = 0; i < 3; i++) {
      const spine = mesh(cone(0.045, 0.15, 5), hairMat, 0, 1.36 - i * 0.11, -0.17);
      spine.scale.set(0.3, 1, 1);
      spine.rotation.x = -0.4;
      body.add(spine);
    }
    // Heavy counterbalancing tail — the strongest silhouette cue.
    tail = new THREE.Group();
    tail.position.set(0, 0.92, -0.17);
    const seg1 = mesh(capsule(0.085, 0.3), skin, 0, -0.05, -0.22);
    seg1.rotation.x = Math.PI / 2 - 0.25;
    const seg2 = mesh(cone(0.062, 0.5, 7), skin, 0, -0.16, -0.6);
    seg2.rotation.x = Math.PI / 2 + 0.25;
    tail.add(seg1, seg2);
    body.add(tail);
  } else {
    // Unmistakably avian: beak, crest plume, folded wings, light frame.
    const beakUpper = mesh(cone(0.058, 0.19, 7), toonMat('#f0c765'), 0, 0.0, 0.16);
    beakUpper.rotation.x = Math.PI / 2;
    head.add(beakUpper);
    head.add(mesh(box(0.07, 0.028, 0.11), toonMat('#d8ab4f'), 0, -0.042, 0.19));
    addEyes(head, 0.085, 0.04, 0.105, 0.034);
    // Swept crest.
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const plume = mesh(cone(0.036, 0.3 - Math.abs(t - 0.5) * 0.18, 5), hairMat, (t - 0.5) * 0.14, 0.15, -0.03);
      plume.scale.set(0.42, 1, 1);
      plume.rotation.set(-1.0, 0, (t - 0.5) * 0.7);
      head.add(plume);
    }
    // Cheek feathers.
    for (const side of [-1, 1]) {
      const cheek = mesh(cone(0.045, 0.14, 5), hairMat, 0.13 * side, -0.02, -0.02);
      cheek.scale.set(0.5, 1, 1);
      cheek.rotation.set(0, 0, 1.5 * side);
      head.add(cheek);
    }
    // Folded wings hanging from the shoulders.
    for (const side of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(0.24 * side, 1.4, -0.07);
      const primary = mesh(box(0.05, 0.62, 0.2), hairMat, 0, -0.3, 0);
      primary.rotation.x = 0.12;
      const covert = mesh(box(0.06, 0.28, 0.16), toonMat(def.palette.belly), 0, -0.1, 0.02);
      wing.add(primary, covert);
      wing.rotation.z = 0.12 * side;
      body.add(wing);
      wings.push(wing);
    }
    // Tail feathers.
    const tf = new THREE.Group();
    tf.position.set(0, 0.95, -0.16);
    for (let i = -1; i <= 1; i++) {
      const f = mesh(box(0.07, 0.34, 0.03), hairMat, i * 0.06, -0.12, -0.06);
      f.rotation.set(0.55, 0, i * 0.22);
      tf.add(f);
    }
    body.add(tf);
    tail = tf;
  }

  if (emerson) {
    // Visor, chest light and pack read instantly as "the one with technology".
    const visor = mesh(box(0.31, 0.062, 0.075), toonMat('#59d6e6', { emissive: '#59d6e6', emissiveIntensity: 1.8 }), 0, 0.022, 0.132);
    head.add(visor);
    const pack = mesh(box(0.26, 0.3, 0.13), toonMat('#5a6673'), 0, 1.16, -0.2);
    body.add(pack);
    body.add(mesh(box(0.2, 0.05, 0.04), toonMat('#59d6e6', { emissive: '#59d6e6', emissiveIntensity: 1.2 }), 0, 1.26, -0.27));
    body.add(mesh(sphere(0.045, 10), toonMat('#59d6e6', { emissive: '#59d6e6', emissiveIntensity: 2.2 }), 0, 1.26, 0.19));
  }

  group.traverse((o) => {
    o.castShadow = true;
  });

  let phase = 0;
  let gesture = 0;
  let lean = 0;
  return {
    group,
    height: 1.9 * heightScale,
    animate(ctx) {
      const speedNorm = Math.min(1, ctx.speed / 4);
      // Stride cadence is tied to ground speed rather than to a fixed rate, so
      // the feet keep pace with the distance actually covered. The constant is
      // the stride length in metres: the leg completes one cycle per stride,
      // which is what removes the obvious skating at walking speed.
      const STRIDE = 1.55;
      phase += ctx.dt * (ctx.speed > 0.05 ? (ctx.speed / STRIDE) * Math.PI * 2 : 2.2);
      // Longer strides at speed, so a sprint does not read as fast tiptoeing.
      const swing = Math.sin(phase) * (0.42 + 0.4 * speedNorm) * Math.min(1, speedNorm * 3);
      legL.rotation.x = swing;
      legR.rotation.x = -swing;

      if (ctx.social) {
        // Conversational gesturing: hands rise and move while speaking, so a
        // conversation is legible from across the valley. An argument uses the
        // same rig, faster and wider — visibly not a friendly chat.
        const rate = ctx.agitated ? 5.4 : 2.6;
        const reach = ctx.agitated ? 1.9 : 1;
        gesture += ctx.dt * rate;
        const g1 = Math.sin(gesture * 1.7);
        const g2 = Math.sin(gesture * 1.1 + 1.3);
        armL.rotation.x = (-0.55 - g1 * 0.3) * reach;
        armR.rotation.x = (-0.45 - g2 * 0.35) * reach;
        armL.rotation.z = 0.35 + g2 * 0.12 * reach;
        armR.rotation.z = -0.3 - g1 * 0.12 * reach;
      } else {
        armL.rotation.x = -swing * 0.8;
        armR.rotation.x = swing * 0.8;
        // Arms tuck in as the pace picks up.
        armL.rotation.z = 0.06 + speedNorm * 0.1;
        armR.rotation.z = -0.06 - speedNorm * 0.1;
      }

      // --- jump, fall and landing ------------------------------------------
      // Three readable poses rather than an animation system: tuck on the way
      // up, reach on the way down, absorb on touchdown. Overriding the stride
      // outright is deliberate — a character running in mid-air is the single
      // most obvious tell that a jump is not really implemented.
      if (ctx.airborne) {
        const rising = (ctx.air ?? 0) > 0;
        const t = Math.min(1, Math.abs(ctx.air ?? 0) / 6);
        legL.rotation.x = rising ? -0.85 * t - 0.15 : 0.35 * t + 0.1;
        legR.rotation.x = rising ? -0.5 * t - 0.1 : -0.45 * t - 0.05;
        armL.rotation.x = rising ? -1.5 * t - 0.2 : -0.8 * t;
        armR.rotation.x = rising ? -1.3 * t - 0.2 : -0.7 * t;
        armL.rotation.z = 0.3 + t * 0.25;
        armR.rotation.z = -0.3 - t * 0.25;
      }

      const idleBreath = Math.sin(ctx.time * 2 + variant * 9) * 0.012;
      if (ctx.resting) {
        body.position.y = -0.52;
        legL.rotation.x = -1.45;
        legR.rotation.x = -1.45;
        armL.rotation.x = -0.2;
        armR.rotation.x = -0.2;
        body.rotation.x = 0;
        body.rotation.z = 0;
      } else {
        // Two bounces per stride cycle — one per footfall.
        body.position.y = Math.abs(Math.sin(phase)) * 0.055 * speedNorm + idleBreath;
        // Landing absorbs: a short dip that decays over a quarter second. The
        // difference between arriving on the ground and teleporting onto it.
        const since = ctx.landedAgo ?? 99;
        if (since < 0.25) body.position.y -= (1 - since / 0.25) * 0.16;
        if (ctx.airborne) body.position.y = idleBreath;
        // Lean into the run, and bank into a turn. Cheap, and it is most of
        // what stops a character reading as a sliding statue.
        body.rotation.x = ctx.airborne ? ((ctx.air ?? 0) > 0 ? -0.18 : 0.22) : speedNorm * 0.13;
        const turn = ctx.turnRate ?? 0;
        lean += (Math.max(-1, Math.min(1, turn * 0.28)) - lean) * Math.min(1, ctx.dt * 6);
        body.rotation.z = -lean * 0.22 * speedNorm;
      }

      // Head: nods while talking, jabs forward while arguing.
      head.rotation.y = ctx.social
        ? Math.sin(ctx.time * (ctx.agitated ? 3.2 : 1.6)) * (ctx.agitated ? 0.22 : 0.14)
        : Math.sin(ctx.time * 0.4 + variant * 7) * 0.28;
      head.rotation.x = ctx.social
        ? Math.sin(ctx.time * (ctx.agitated ? 5.5 : 3.1)) * (ctx.agitated ? 0.16 : 0.09) - (ctx.agitated ? 0.12 : 0)
        : 0;

      if (tail) {
        tail.rotation.y = Math.sin(ctx.time * 1.8 + variant * 5) * 0.22;
        tail.rotation.x = Math.sin(phase * 0.5) * 0.08 * speedNorm;
      }
      for (let i = 0; i < wings.length; i++) {
        const s = i === 0 ? -1 : 1;
        wings[i].rotation.z = 0.12 * s + Math.sin(ctx.time * 1.4 + i) * 0.05 + speedNorm * 0.14 * s;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Lumi — original companion creature (priority character)
// ---------------------------------------------------------------------------

export function buildLumiRig(def: CreatureSpeciesDef, unique: boolean): Rig {
  const bodyMat = toonMat(def.palette.body);
  const bellyMat = toonMat(def.palette.belly);
  const accentMat = toonMat(def.palette.accent);
  const glowMat = toonMat(def.palette.glow, { emissive: def.palette.glow, emissiveIntensity: unique ? 2.4 : 1.5 });

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // Rounded, bottom-heavy body — soft and huggable rather than animalistic.
  const torso = mesh(sphere(0.23, 18), bodyMat, 0, 0.25, -0.03);
  torso.scale.set(1.02, 0.94, 1.12);
  body.add(torso);
  const belly = mesh(sphere(0.175, 14), bellyMat, 0, 0.22, 0.085);
  belly.scale.set(0.88, 0.8, 0.7);
  body.add(belly);
  // Soft ruff where head meets body.
  const ruff = mesh(sphere(0.2, 14), bellyMat, 0, 0.38, 0.02);
  ruff.scale.set(1.05, 0.42, 1.0);
  body.add(ruff);

  // Oversized head — the core of the "cute" read.
  const head = new THREE.Group();
  head.position.set(0, 0.53, 0.08);
  body.add(head);
  const skull = mesh(sphere(0.21, 18), bodyMat);
  skull.scale.set(1.06, 1, 1.02);
  head.add(skull);
  // Lighter muzzle patch.
  const muzzle = mesh(sphere(0.13, 14), bellyMat, 0, -0.045, 0.13);
  muzzle.scale.set(1, 0.72, 0.7);
  head.add(muzzle);

  // Very large eyes, set forward and low — the single strongest cue.
  const eyeWhite = toonMat('#ffffff');
  const eyeDark = toonMat('#241a3d');
  for (const side of [-1, 1]) {
    const w = mesh(sphere(0.072, 16), eyeWhite, 0.086 * side, 0.012, 0.152);
    w.scale.set(0.95, 1.08, 0.8);
    const iris = mesh(sphere(0.05, 14), toonMat(def.palette.accent), 0.09 * side, 0.012, 0.19);
    const pupil = mesh(sphere(0.032, 12), eyeDark, 0.092 * side, 0.008, 0.212);
    const glint = mesh(sphere(0.017, 10), toonMat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 1.6 }), 0.108 * side, 0.048, 0.222);
    const glint2 = mesh(sphere(0.009, 8), toonMat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 1.4 }), 0.07 * side, -0.022, 0.222);
    head.add(w, iris, pupil, glint, glint2);
  }
  // Tiny nose and cheek blush.
  head.add(mesh(sphere(0.022, 10), accentMat, 0, -0.042, 0.222));
  for (const side of [-1, 1]) {
    const blush = mesh(sphere(0.038, 10), toonMat('#f2a3c0'), 0.15 * side, -0.045, 0.12);
    blush.scale.set(1, 0.55, 0.35);
    head.add(blush);
  }

  // Long, tapered, highly expressive ears.
  const mkEar = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.115 * side, 0.16, -0.015);
    const ear = mesh(cone(0.062, 0.4, 8), bodyMat, 0, 0.19, 0);
    ear.scale.set(0.55, 1, 0.85);
    const inner = mesh(cone(0.036, 0.27, 7), toonMat('#f7c9dd'), 0, 0.16, 0.022);
    inner.scale.set(0.5, 1, 0.55);
    const tip = mesh(sphere(0.035, 10), glowMat, 0, 0.37, 0);
    pivot.add(ear, inner, tip);
    pivot.rotation.z = -0.3 * side;
    head.add(pivot);
    return pivot;
  };
  const earL = mkEar(-1);
  const earR = mkEar(1);

  // Expressive plumed tail with a lantern tip.
  const tail = new THREE.Group();
  tail.position.set(0, 0.27, -0.22);
  const tailBase = mesh(capsule(0.045, 0.16), bodyMat, 0, 0.02, -0.11);
  tailBase.rotation.x = Math.PI / 2 - 0.5;
  const tailMid = mesh(cone(0.05, 0.28, 7), bodyMat, 0, 0.13, -0.24);
  tailMid.rotation.x = Math.PI / 2 + 1.0;
  const tailTip = mesh(sphere(0.062, 12), glowMat, 0, 0.26, -0.3);
  tail.add(tailBase, tailMid, tailTip);
  body.add(tail);

  // Stubby paws.
  for (const [x, z, fore] of [
    [-0.115, 0.1, 1],
    [0.115, 0.1, 1],
    [-0.115, -0.11, 0],
    [0.115, -0.11, 0],
  ] as const) {
    const paw = mesh(capsule(0.05, 0.06), bodyMat, x, 0.07, z);
    body.add(paw);
    if (fore) body.add(mesh(sphere(0.05, 10), bellyMat, x, 0.05, z + 0.03));
  }

  // Bioluminescent markings tracing the spine.
  for (let i = 0; i < 4; i++) {
    body.add(mesh(sphere(0.024 - i * 0.004, 8), glowMat, 0, 0.44 - i * 0.03, -0.08 - i * 0.075));
  }
  // Darker extremities give the silhouette internal contrast at distance.
  const tipMat = toonMat(def.palette.accent);
  for (const [x, z] of [
    [-0.115, 0.1],
    [0.115, 0.1],
    [-0.115, -0.11],
    [0.115, -0.11],
  ] as const) {
    body.add(mesh(sphere(0.048, 8), tipMat, x, 0.028, z));
  }

  // Soft glow halo so she is findable at night — dim enough not to blow out
  // her own colours in daylight.
  const halo = new THREE.PointLight(new THREE.Color(def.palette.glow), unique ? 0.5 : 0.28, 5.5, 2);
  halo.position.set(0, 0.4, 0);
  group.add(halo);

  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });

  let phase = 0;
  let blinkTimer = 2;
  return {
    group,
    height: 0.85,
    animate(ctx) {
      const speedNorm = Math.min(1, ctx.speed / 3);
      phase += ctx.dt * (5 + ctx.speed * 3);
      // Bouncing hop-walk with a little squash.
      const hop = Math.abs(Math.sin(phase));
      body.position.y = hop * 0.1 * speedNorm + Math.sin(ctx.time * 2.2) * 0.009;
      body.scale.set(1 + hop * 0.03 * speedNorm, 1 - hop * 0.04 * speedNorm, 1 + hop * 0.03 * speedNorm);

      // Ears: idle flick, pinned back while resting, perked while moving.
      const flick = Math.sin(ctx.time * 1.3) * 0.14 + Math.sin(ctx.time * 5.1) * 0.05;
      const perk = ctx.resting ? 0.75 : -speedNorm * 0.18;
      earL.rotation.z = -0.3 + flick;
      earR.rotation.z = 0.3 - flick;
      earL.rotation.x = perk;
      earR.rotation.x = perk;

      // Tail: wags faster when active.
      tail.rotation.y = Math.sin(ctx.time * (2.4 + speedNorm * 3)) * 0.55;
      tail.rotation.x = Math.sin(ctx.time * 1.7) * 0.22;

      head.rotation.y = Math.sin(ctx.time * 0.85) * 0.33;
      head.rotation.x = ctx.resting ? 0.42 : Math.sin(ctx.time * 0.5) * 0.1;

      // Occasional blink — deterministic, driven by the render clock only.
      blinkTimer -= ctx.dt;
      if (blinkTimer < 0) blinkTimer = 3.1 + (Math.sin(ctx.time * 0.37) * 0.5 + 0.5) * 2.4;
      head.scale.y = blinkTimer < 0.12 ? 0.9 : 1;

      if (ctx.resting) body.scale.y = 0.8;
    },
  };
}

// ---------------------------------------------------------------------------
// Other native creatures — each with a distinct silhouette
// ---------------------------------------------------------------------------

export function buildCreatureRig(def: CreatureSpeciesDef, variant: number, juvenile: boolean): Rig {
  if (def.plan === 'lumi') {
    const rig = buildLumiRig(def, false);
    rig.group.scale.setScalar(juvenile ? 0.62 : 0.9);
    return rig;
  }
  const bodyMat = toonMat(def.palette.body);
  const bellyMat = toonMat(def.palette.belly);
  const accentMat = toonMat(def.palette.accent);
  const glowMat = toonMat(def.palette.glow, { emissive: def.palette.glow, emissiveIntensity: 1.6 });
  const darkMat = toonMat(EYE_DARK);

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const legs: THREE.Group[] = [];
  const wings: THREE.Object3D[] = [];
  let tail: THREE.Object3D | null = null;
  let height = 1;
  /** Parts that brighten during a wind-up, so the tell is on the creature. */
  const chargeParts: THREE.Mesh[] = [];
  /** Counter-rotating rings, for the synthetic plan. */
  const rings: THREE.Object3D[] = [];
  let head: THREE.Object3D | null = null;

  const mkLegAt = (x: number, z: number, y: number, r: number, len: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.add(mesh(capsule(r, len), bodyMat, 0, -len / 2 - r, 0));
    pivot.add(mesh(sphere(r * 1.25, 8), accentMat, 0, -len - r * 1.2, 0.02));
    body.add(pivot);
    legs.push(pivot);
    return pivot;
  };

  switch (def.plan) {
    case 'grazer': {
      // Low, broad, armored back — a herd herbivore read.
      const torso = mesh(capsule(0.32, 0.52), bodyMat, 0, 0.64, 0);
      torso.rotation.x = Math.PI / 2;
      torso.scale.set(1.15, 1, 1);
      body.add(torso);
      body.add(mesh(sphere(0.19, 12), bodyMat, 0, 0.66, 0.5));
      const snout = mesh(box(0.16, 0.12, 0.2), bellyMat, 0, 0.6, 0.62);
      body.add(snout);
      body.add(mesh(sphere(0.035, 8), darkMat, -0.11, 0.74, 0.56));
      body.add(mesh(sphere(0.035, 8), darkMat, 0.11, 0.74, 0.56));
      // The thorn ridge that names the species.
      for (let i = 0; i < 5; i++) {
        const thorn = mesh(cone(0.075 - i * 0.008, 0.26 - i * 0.03, 5), accentMat, 0, 0.94, 0.3 - i * 0.17);
        thorn.scale.set(0.55, 1, 1);
        thorn.rotation.x = -0.25;
        body.add(thorn);
      }
      mkLegAt(-0.2, 0.3, 0.5, 0.07, 0.28);
      mkLegAt(0.2, 0.3, 0.5, 0.07, 0.28);
      mkLegAt(-0.2, -0.3, 0.5, 0.07, 0.28);
      mkLegAt(0.2, -0.3, 0.5, 0.07, 0.28);
      const t = mesh(cone(0.08, 0.4, 6), bodyMat, 0, 0.66, -0.6);
      t.rotation.x = -Math.PI / 2;
      body.add(t);
      tail = t;
      height = 1.15;
      break;
    }
    case 'strider': {
      // Extremely tall and thin — unmistakable at any distance.
      const torso = mesh(capsule(0.22, 0.4), bodyMat, 0, 1.5, 0);
      torso.rotation.x = Math.PI / 2;
      body.add(torso);
      const neck = mesh(capsule(0.07, 0.7), bodyMat, 0, 1.92, 0.24);
      neck.rotation.x = 0.42;
      body.add(neck);
      const headM = mesh(sphere(0.13, 12), bodyMat, 0, 2.32, 0.44);
      headM.scale.set(0.85, 0.85, 1.25);
      body.add(headM);
      body.add(mesh(sphere(0.03, 8), darkMat, -0.07, 2.36, 0.55));
      body.add(mesh(sphere(0.03, 8), darkMat, 0.07, 2.36, 0.55));
      body.add(mesh(sphere(0.055, 10), glowMat, 0, 2.45, 0.4));
      // Delicate stilt legs with visible knees.
      mkLegAt(-0.16, 0.2, 1.34, 0.045, 1.05);
      mkLegAt(0.16, 0.2, 1.34, 0.045, 1.05);
      mkLegAt(-0.16, -0.2, 1.34, 0.045, 1.05);
      mkLegAt(0.16, -0.2, 1.34, 0.045, 1.05);
      height = 2.6;
      break;
    }
    case 'blob': {
      // Squat mound with a moss crown.
      const blobM = mesh(sphere(0.3, 14), bodyMat, 0, 0.25, 0);
      blobM.scale.set(1.1, 0.82, 1.05);
      body.add(blobM);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const tuft = mesh(cone(0.075, 0.2, 5), bellyMat, Math.sin(a) * 0.17, 0.44, Math.cos(a) * 0.17);
        tuft.rotation.set(Math.cos(a) * 0.55, 0, -Math.sin(a) * 0.55);
        body.add(tuft);
      }
      body.add(mesh(sphere(0.05, 10), darkMat, -0.1, 0.29, 0.26));
      body.add(mesh(sphere(0.05, 10), darkMat, 0.1, 0.29, 0.26));
      body.add(mesh(sphere(0.016, 8), toonMat('#ffffff'), -0.085, 0.315, 0.3));
      body.add(mesh(sphere(0.016, 8), toonMat('#ffffff'), 0.115, 0.315, 0.3));
      body.add(mesh(sphere(0.035, 10), glowMat, 0, 0.5, 0));
      height = 0.62;
      break;
    }
    case 'floater': {
      // Jellyfish bell + trailing tendrils, always airborne.
      const bell = mesh(sphere(0.33, 16), toonMat(def.palette.body, { emissive: def.palette.glow, emissiveIntensity: 0.45 }), 0, 0.42, 0);
      bell.scale.set(1, 0.78, 1);
      body.add(bell);
      const skirt = mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.1, 14, 1, true), bellyMat, 0, 0.28, 0);
      (skirt.material as THREE.MeshToonMaterial).side = THREE.DoubleSide;
      body.add(skirt);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const tent = mesh(cone(0.028, 0.58, 5), bellyMat, Math.sin(a) * 0.18, 0.0, Math.cos(a) * 0.18);
        tent.rotation.x = Math.PI;
        body.add(tent);
        wings.push(tent);
      }
      body.add(mesh(sphere(0.07, 12), glowMat, 0, 0.58, 0));
      height = 0.95;
      break;
    }
    case 'fish': {
      const torso = mesh(capsule(0.15, 0.38), bodyMat, 0, 0.15, 0);
      torso.rotation.x = Math.PI / 2;
      torso.scale.set(0.62, 1, 1);
      body.add(torso);
      const tailFin = mesh(cone(0.18, 0.26, 5), glowMat, 0, 0.15, -0.42);
      tailFin.rotation.x = -Math.PI / 2;
      tailFin.scale.set(0.2, 1, 1.5);
      body.add(tailFin);
      tail = tailFin;
      const dorsal = mesh(cone(0.12, 0.22, 5), accentMat, 0, 0.34, -0.02);
      dorsal.scale.set(0.18, 1, 1);
      body.add(dorsal);
      for (const side of [-1, 1]) {
        const pec = mesh(cone(0.07, 0.16, 5), bellyMat, 0.11 * side, 0.13, 0.06);
        pec.scale.set(0.25, 1, 1);
        pec.rotation.z = 1.3 * side;
        body.add(pec);
        wings.push(pec);
      }
      body.add(mesh(sphere(0.032, 8), darkMat, -0.075, 0.19, 0.23));
      body.add(mesh(sphere(0.032, 8), darkMat, 0.075, 0.19, 0.23));
      height = 0.5;
      break;
    }
    case 'bird': {
      const torso = mesh(sphere(0.17, 14), bodyMat, 0, 0.32, 0);
      torso.scale.set(0.82, 1, 1.3);
      body.add(torso);
      const headM = mesh(sphere(0.115, 12), bodyMat, 0, 0.51, 0.14);
      body.add(headM);
      const beak = mesh(cone(0.04, 0.14, 6), toonMat('#f0c765'), 0, 0.49, 0.27);
      beak.rotation.x = Math.PI / 2;
      body.add(beak);
      body.add(mesh(sphere(0.028, 8), darkMat, -0.055, 0.545, 0.21));
      body.add(mesh(sphere(0.028, 8), darkMat, 0.055, 0.545, 0.21));
      body.add(mesh(sphere(0.01, 6), toonMat('#ffffff'), -0.045, 0.56, 0.235));
      body.add(mesh(sphere(0.01, 6), toonMat('#ffffff'), 0.065, 0.56, 0.235));
      // Crest tuft.
      for (let i = 0; i < 3; i++) {
        const c = mesh(cone(0.025, 0.11, 5), accentMat, (i - 1) * 0.03, 0.6, 0.09);
        c.rotation.x = -0.7;
        body.add(c);
      }
      for (const side of [-1, 1]) {
        const wing = mesh(box(0.3, 0.035, 0.2), bellyMat, 0.2 * side, 0.35, -0.01);
        body.add(wing);
        wings.push(wing);
      }
      const tf = mesh(cone(0.07, 0.24, 5), accentMat, 0, 0.31, -0.24);
      tf.rotation.x = -Math.PI / 2 - 0.4;
      tf.scale.set(0.38, 1, 1);
      body.add(tf);
      tail = tf;
      mkLegAt(-0.065, 0.02, 0.19, 0.022, 0.1);
      mkLegAt(0.065, 0.02, 0.19, 0.022, 0.1);
      height = 0.7;
      break;
    }
    case 'moth': {
      const torso = mesh(capsule(0.075, 0.2), bodyMat, 0, 0.25, 0);
      torso.rotation.x = Math.PI / 2;
      body.add(torso);
      // Fuzzy thorax + antennae.
      body.add(mesh(sphere(0.085, 10), accentMat, 0, 0.26, 0.1));
      for (const side of [-1, 1]) {
        const ant = mesh(capsule(0.008, 0.12), accentMat, 0.04 * side, 0.34, 0.13);
        ant.rotation.set(0.6, 0, 0.5 * side);
        body.add(ant);
      }
      const wingMat = new THREE.MeshToonMaterial({
        color: new THREE.Color(def.palette.belly),
        emissive: new THREE.Color(def.palette.glow),
        emissiveIntensity: 1.0,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92,
      });
      for (const side of [-1, 1]) {
        const wing = new THREE.Group();
        wing.position.set(0.05 * side, 0.3, 0);
        const fore = new THREE.Mesh(new THREE.CircleGeometry(0.21, 10, 0, Math.PI), wingMat);
        fore.position.set(0.17 * side, 0, 0.02);
        fore.rotation.set(-Math.PI / 2, 0, side > 0 ? 0 : Math.PI);
        const hind = new THREE.Mesh(new THREE.CircleGeometry(0.15, 9, 0, Math.PI), wingMat);
        hind.position.set(0.14 * side, -0.02, -0.14);
        hind.rotation.set(-Math.PI / 2, 0, side > 0 ? Math.PI : 0);
        wing.add(fore, hind);
        body.add(wing);
        wings.push(wing);
      }
      body.add(mesh(sphere(0.05, 10), glowMat, 0, 0.27, 0.16));
      height = 0.55;
      break;
    }
    case 'raptor': {
      // Forward-leaning, jaws first, counterbalanced by a heavy tail.
      const torso = mesh(capsule(0.27, 0.5), bodyMat, 0, 0.82, 0);
      torso.rotation.x = Math.PI / 2 - 0.2;
      body.add(torso);
      const neck = mesh(capsule(0.11, 0.26), bodyMat, 0, 1.1, 0.38);
      neck.rotation.x = 0.7;
      body.add(neck);
      const headM = mesh(sphere(0.15, 12), bodyMat, 0, 1.24, 0.56);
      headM.scale.set(0.82, 0.8, 1.35);
      body.add(headM);
      // Predator eyes: forward-facing and luminous.
      body.add(mesh(sphere(0.038, 10), glowMat, -0.085, 1.3, 0.62));
      body.add(mesh(sphere(0.038, 10), glowMat, 0.085, 1.3, 0.62));
      // Brow plates.
      for (const side of [-1, 1]) {
        const brow = mesh(box(0.07, 0.03, 0.11), accentMat, 0.085 * side, 1.35, 0.62);
        brow.rotation.z = -0.25 * side;
        body.add(brow);
      }
      const jaw = mesh(box(0.14, 0.08, 0.26), bellyMat, 0, 1.16, 0.74);
      body.add(jaw);
      // Teeth.
      for (let i = 0; i < 4; i++) {
        const tooth = mesh(cone(0.018, 0.06, 4), toonMat('#e8e0d0'), -0.05 + i * 0.033, 1.19, 0.84);
        tooth.rotation.x = Math.PI;
        body.add(tooth);
      }
      // The dorsal ridge. Deliberately oversized and lit rather than plain
      // plating: this is the telegraph channel that has to carry at twenty
      // metres, where a change in head pitch is a couple of pixels.
      const ridgeMat = toonMat(def.palette.accent, { emissive: def.palette.glow, emissiveIntensity: 0.12 });
      for (let i = 0; i < 5; i++) {
        const spike = mesh(cone(0.13 - i * 0.012, 0.46 - i * 0.03, 5), ridgeMat, 0, 1.16, 0.2 - i * 0.21);
        spike.scale.set(0.5, 1, 1);
        spike.rotation.x = -0.35;
        body.add(spike);
        chargeParts.push(spike);
      }
      const tailM = mesh(cone(0.13, 0.9, 6), bodyMat, 0, 0.76, -0.66);
      tailM.rotation.x = -Math.PI / 2 - 0.12;
      body.add(tailM);
      tail = tailM;
      mkLegAt(-0.19, -0.04, 0.66, 0.075, 0.38);
      mkLegAt(0.19, -0.04, 0.66, 0.075, 0.38);
      head = neck;
      // The eyes light too — a second channel, in case the ridge is hidden by
      // the angle the player happens to be looking from.
      for (const o of body.children) {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.material === glowMat) chargeParts.push(m);
      }
      height = 1.55;
      break;
    }
    case 'warden': {
      // Nothing on this world grew this. Hard flat planes, perfect symmetry,
      // no face — a machine silhouette that could never be mistaken for fauna
      // even as a distant shape against the sky.
      // Hard, angular geometry does the "manufactured" work here — the toon
      // ramp is already only three steps, so faceted forms read as machined.
      const shell = toonMat(def.palette.body);
      const core = mesh(new THREE.OctahedronGeometry(0.34, 0), shell, 0, 0, 0);
      core.scale.set(1, 1.35, 1);
      body.add(core);

      // The lens. It is the only part that ever looks at anything, and it is
      // what brightens through a wind-up — so it is sized to be legible from
      // the far side of the ring, not just up close.
      const lens = mesh(sphere(0.2, 12), glowMat, 0, 0, 0.31);
      lens.scale.set(1.5, 0.7, 0.7);
      body.add(lens);
      chargeParts.push(lens);
      const housing = mesh(new THREE.TorusGeometry(0.26, 0.06, 6, 14), accentMat, 0, 0, 0.3);
      body.add(housing);

      // Two counter-rotating rings on different axes: the read that says
      // "still powered" from a hundred metres away.
      const ringA = mesh(new THREE.TorusGeometry(0.62, 0.045, 6, 22), bellyMat, 0, 0, 0);
      ringA.rotation.x = Math.PI / 2;
      body.add(ringA);
      rings.push(ringA);
      const ringB = mesh(new THREE.TorusGeometry(0.5, 0.035, 6, 20), accentMat, 0, 0, 0);
      ringB.rotation.y = Math.PI / 2.6;
      body.add(ringB);
      rings.push(ringB);

      // Free-floating plates held at a distance by nothing visible at all.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const plate = mesh(box(0.14, 0.42, 0.06), shell, Math.sin(a) * 0.72, 0, Math.cos(a) * 0.72);
        plate.rotation.y = a;
        body.add(plate);
        wings.push(plate);
        const spark = mesh(sphere(0.05, 8), glowMat, Math.sin(a) * 0.72, -0.24, Math.cos(a) * 0.72);
        body.add(spark);
        chargeParts.push(spark);
      }
      height = 0.9;
      break;
    }
  }

  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  const s = def.scale * (juvenile ? 0.58 : 1) * (0.92 + variant * 0.16);
  group.scale.setScalar(s);

  // Baseline emissive levels, so a telegraph can return exactly to rest.
  const baseEmissive = chargeParts.map((m) => (m.material as THREE.MeshToonMaterial).emissiveIntensity ?? 1);
  let charge = 0;
  let chargeState = 'calm';

  let phase = variant * 10;
  return {
    group,
    height: height * s + (def.hover ? def.hoverHeight ?? 0 : 0),
    /**
     * The visible tell.
     *
     * v0.8 leaned almost entirely on head pitch, which is a handful of pixels
     * at fifteen metres — the exact distance at which a player most needs to
     * know a predator is about to commit. The tell now runs on several
     * channels at once: the dorsal ridge and eyes brighten hard, the whole
     * body drops and coils, and `Agents.tsx` paints a ring on the ground.
     * Any one of them is readable alone.
     */
    setCharge(amount: number, state: string) {
      charge = Math.max(0, Math.min(1, amount));
      chargeState = state;
      let strength = 0;
      if (state === 'windup') strength = 1.4 + charge * 5.5;
      else if (state === 'charge') strength = 1.2 + charge * 5;
      else if (state === 'warn') {
        // A slow, unmistakable pulse rather than a steady lift: something
        // rhythmic catches the eye at distance where brightness alone does not.
        strength = 1.8 + Math.sin(charge * Math.PI * 6) * 1.1;
      } else if (state === 'circle') strength = 0.9;
      else if (state === 'lunge' || state === 'beam') strength = 6;
      for (let i = 0; i < chargeParts.length; i++) {
        const mat = chargeParts[i].material as THREE.MeshToonMaterial;
        mat.emissiveIntensity = baseEmissive[i] * (1 + strength);
      }
    },
    animate(ctx) {
      const speedNorm = Math.min(1, ctx.speed / Math.max(1, def.speed));
      phase += ctx.dt * (4 + ctx.speed * 2.5);
      const staggering = chargeState === 'staggered';
      if (def.plan === 'warden') {
        // Rings accelerate as it spins up to fire. Nothing else about the
        // machine moves, which is exactly why the spin reads as intent — and
        // when it is rocked, the spin stalls and the whole frame tumbles.
        const charging = chargeState === 'charge' || chargeState === 'windup';
        const spin = staggering ? 0.1 : 0.6 + (charging ? charge * 9 : chargeState === 'hostile' ? 1.4 : 0);
        rings[0].rotation.z += ctx.dt * spin * 1.6;
        rings[1].rotation.z -= ctx.dt * spin * 2.3;
        body.position.y = staggering
          ? -0.5 + Math.sin(ctx.time * 22) * 0.14
          : Math.sin(ctx.time * 1.2 + variant * 7) * 0.12;
        body.rotation.z = staggering ? Math.sin(ctx.time * 17) * 0.3 : 0;
        for (let i = 0; i < wings.length; i++) {
          const a = (i / wings.length) * Math.PI * 2 + ctx.time * 0.35;
          // The plates pull inward as it charges and fly apart when rocked:
          // the silhouette itself says which of the two is happening.
          const spread = staggering ? 1.05 : 0.72 - (charging ? charge * 0.22 : 0);
          wings[i].position.set(Math.sin(a) * spread, Math.sin(ctx.time * 2 + i) * 0.1, Math.cos(a) * spread);
          wings[i].rotation.y = a;
        }
        return;
      }
      // The biological tell. The head drops, and — far more visible at range —
      // the whole animal coils: body lowered, pitched forward, tail up.
      const crouch =
        chargeState === 'warn' ? 0.55 : chargeState === 'windup' ? 0.35 + charge * 0.5 : chargeState === 'circle' ? 0.25 : 0;
      if (head) head.rotation.x = 0.7 - crouch * 0.8 + (chargeState === 'windup' ? charge * 0.5 : 0);
      if (staggering) {
        // Rocked: knocked off its feet, reeling, unmistakably interruptible.
        body.position.y = -0.24 + Math.sin(ctx.time * 26) * 0.05;
        body.rotation.z = Math.sin(ctx.time * 19) * 0.34;
        body.rotation.x = 0.3;
      } else {
        body.position.y = -crouch * 0.3;
        body.rotation.x = crouch * 0.34;
        body.rotation.z = 0;
      }
      for (let i = 0; i < legs.length; i++) {
        // Diagonal gait for quadrupeds.
        const offset = legs.length === 4 ? ((i === 0 || i === 3) ? 0 : Math.PI) : (i % 2) * Math.PI;
        legs[i].rotation.x = Math.sin(phase + offset) * 0.55 * speedNorm;
      }
      if (def.plan === 'bird') {
        const flap = Math.sin(ctx.time * 6) * 0.5 * (0.25 + speedNorm);
        if (wings[0]) wings[0].rotation.z = 0.18 + flap;
        if (wings[1]) wings[1].rotation.z = -0.18 - flap;
        body.position.y = Math.sin(phase) * 0.03 * speedNorm;
      } else if (def.plan === 'moth') {
        const flap = Math.sin(ctx.time * 11) * 0.75;
        if (wings[0]) wings[0].rotation.y = 0.35 + flap;
        if (wings[1]) wings[1].rotation.y = -0.35 - flap;
        body.position.y = Math.sin(ctx.time * 2.6 + variant * 5) * 0.07;
      } else if (def.plan === 'floater') {
        for (let i = 0; i < wings.length; i++) {
          wings[i].rotation.x = Math.PI + Math.sin(ctx.time * 2 + i) * 0.28;
        }
        body.position.y = Math.sin(ctx.time * 1.4 + variant * 8) * 0.16;
        body.scale.y = 1 + Math.sin(ctx.time * 2) * 0.06;
      } else if (def.plan === 'fish') {
        for (let i = 0; i < wings.length; i++) {
          wings[i].rotation.x = Math.sin(ctx.time * 6 + i * 2) * 0.35;
        }
        body.rotation.z = Math.sin(phase * 0.9) * 0.12;
      }
      if (tail) {
        tail.rotation.y = Math.sin(phase * (def.plan === 'fish' ? 2 : 0.6)) * (def.plan === 'fish' ? 0.55 : 0.22);
      }
      if (def.plan === 'blob') {
        const squash = Math.sin(ctx.time * 3 + variant * 6) * 0.07;
        body.scale.set(1 - squash * 0.5, 1 + squash, 1 - squash * 0.5);
        body.position.y = Math.abs(Math.sin(phase * 0.8)) * 0.09 * speedNorm;
      }
      if (ctx.resting && def.plan !== 'floater' && def.plan !== 'moth' && def.plan !== 'blob') {
        body.scale.y = 0.8;
        body.position.y = -0.06;
      } else if (def.plan !== 'blob' && def.plan !== 'floater') {
        body.scale.y = 1;
      }
    },
  };
}
