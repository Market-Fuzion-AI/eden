import * as THREE from 'three';
import { INTELLIGENT_SPECIES, type CreatureSpeciesDef } from '../sim/species';
import type { IntelligentSpeciesId, Sex } from '../sim/types';
import { toonMat } from './toon';

/**
 * Procedural stylized character/creature factories. These are the visual
 * placeholders for a future GLTF pipeline: the simulation never depends on
 * this geometry, and each factory returns a Rig with a uniform animate() API.
 */

export interface AnimCtx {
  time: number;
  dt: number;
  speed: number; // m/s
  resting: boolean;
  social: boolean;
}

export interface Rig {
  group: THREE.Group;
  animate(ctx: AnimCtx): void;
  /** Approximate head height for status sprites / selection rings. */
  height: number;
}

const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 10);
const sphere = (r: number) => new THREE.SphereGeometry(r, 14, 12);
const cone = (r: number, h: number) => new THREE.ConeGeometry(r, h, 8);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function pick<T>(arr: T[], variant: number): T {
  return arr[Math.floor(variant * 997) % arr.length];
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
  const outfit = toonMat(emerson ? '#2e4f66' : pick(def.palette.outfit, variant + 0.31));
  const hairMat = toonMat(pick(def.palette.hair, variant + 0.57));
  const accent = toonMat(def.palette.accent, { emissive: def.palette.accent, emissiveIntensity: 0.35 });

  const group = new THREE.Group();
  const heightScale = (speciesId === 'veyra' ? 1.06 : speciesId === 'caelari' ? 0.97 : 1) * (sex === 'female' ? 0.96 : 1);
  const body = new THREE.Group();
  body.scale.setScalar(heightScale);
  group.add(body);

  // Legs (pivot at hip).
  const mkLeg = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.11 * side, 0.82, 0);
    pivot.add(mesh(capsule(0.07, 0.55), outfit, 0, -0.4, 0));
    body.add(pivot);
    return pivot;
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);

  // Torso.
  const torso = mesh(capsule(0.2, 0.42), outfit, 0, 1.12, 0);
  if (speciesId === 'veyra') torso.scale.set(1.15, 1, 1.1);
  if (speciesId === 'caelari' || sex === 'female') torso.scale.multiply(new THREE.Vector3(0.92, 1, 0.95));
  body.add(torso);
  // Belt accent.
  body.add(mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.05, 12), accent, 0, 0.93, 0));

  // Arms (pivot at shoulder).
  const mkArm = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.27 * side, 1.34, 0);
    pivot.add(mesh(capsule(0.055, 0.42), skin, 0, -0.26, 0));
    body.add(pivot);
    return pivot;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);

  // Head.
  const head = new THREE.Group();
  head.position.set(0, 1.6, 0);
  body.add(head);
  head.add(mesh(sphere(0.17), skin));
  // Eyes.
  const eyeMat = toonMat('#101418');
  head.add(mesh(sphere(0.024), eyeMat, -0.062, 0.02, 0.15));
  head.add(mesh(sphere(0.024), eyeMat, 0.062, 0.02, 0.15));

  let tail: THREE.Group | null = null;

  if (speciesId === 'human') {
    // Hair cap sits on top/back of the head, leaving the face visible.
    const hair = mesh(sphere(0.165), hairMat, 0, 0.085, -0.045);
    hair.scale.set(1.05, 0.62, 1.0);
    head.add(hair);
    if (sex === 'female') {
      const bun = mesh(sphere(0.085), hairMat, 0, 0.04, -0.18);
      head.add(bun);
    }
  } else if (speciesId === 'veyra') {
    // Snout, head ridge, tail.
    const snout = mesh(cone(0.085, 0.18), skin, 0, -0.02, 0.2);
    snout.rotation.x = Math.PI / 2;
    head.add(snout);
    for (let i = 0; i < 3; i++) {
      const fin = mesh(cone(0.05, 0.16 - i * 0.03), hairMat, 0, 0.14, -0.02 - i * 0.09);
      fin.scale.set(0.4, 1, 1);
      fin.rotation.x = -0.5 - i * 0.25;
      head.add(fin);
    }
    tail = new THREE.Group();
    tail.position.set(0, 0.95, -0.16);
    const tailMesh = mesh(cone(0.08, 0.7), skin, 0, 0, -0.3);
    tailMesh.rotation.x = Math.PI / 2 + 0.5;
    tail.add(tailMesh);
    body.add(tail);
  } else {
    // Caelari: crest feathers, beak, folded wing shapes.
    for (let i = 0; i < 3; i++) {
      const crest = mesh(cone(0.045, 0.24), hairMat, (i - 1) * 0.06, 0.16, -0.05);
      crest.rotation.x = -0.9;
      crest.scale.set(0.5, 1, 1);
      head.add(crest);
    }
    const beak = mesh(cone(0.05, 0.14), toonMat('#e8c26a'), 0, -0.02, 0.19);
    beak.rotation.x = Math.PI / 2;
    head.add(beak);
    const wingGeo = new THREE.BoxGeometry(0.05, 0.5, 0.16);
    const wingL = mesh(wingGeo, hairMat, -0.28, 1.15, -0.12);
    wingL.rotation.z = 0.15;
    const wingR = mesh(wingGeo, hairMat, 0.28, 1.15, -0.12);
    wingR.rotation.z = -0.15;
    body.add(wingL, wingR);
  }

  if (emerson) {
    // Visor + backpack mark the player.
    const visor = mesh(new THREE.BoxGeometry(0.3, 0.06, 0.08), toonMat('#59d6e6', { emissive: '#59d6e6', emissiveIntensity: 1.4 }), 0, 0.03, 0.14);
    head.add(visor);
    body.add(mesh(new THREE.BoxGeometry(0.3, 0.4, 0.16), toonMat('#3a4652'), 0, 1.15, -0.24));
  }

  group.traverse((o) => {
    o.castShadow = true;
  });

  let phase = 0;
  return {
    group,
    height: 1.85 * heightScale,
    animate(ctx) {
      const speedNorm = Math.min(1, ctx.speed / 4);
      phase += ctx.dt * (4 + ctx.speed * 2.4);
      const swing = Math.sin(phase) * 0.65 * speedNorm;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.8;
      armR.rotation.x = swing * 0.8;
      const idleBreath = Math.sin(ctx.time * 2 + variant * 9) * 0.012;
      body.position.y = Math.abs(Math.sin(phase)) * 0.05 * speedNorm + idleBreath;
      if (ctx.resting) {
        body.scale.setScalar(heightScale);
        body.position.y = -0.55;
        legL.rotation.x = -1.4;
        legR.rotation.x = -1.4;
      } else if (body.position.y < -0.2) {
        body.position.y = 0;
      }
      head.rotation.y = ctx.social ? Math.sin(ctx.time * 1.5) * 0.2 : Math.sin(ctx.time * 0.4 + variant * 7) * 0.25;
      if (tail) tail.rotation.y = Math.sin(ctx.time * 1.8 + variant * 5) * 0.25;
    },
  };
}

// ---------------------------------------------------------------------------
// Lumi — original companion creature
// ---------------------------------------------------------------------------

export function buildLumiRig(def: CreatureSpeciesDef, unique: boolean): Rig {
  const bodyMat = toonMat(def.palette.body);
  const bellyMat = toonMat(def.palette.belly);
  const accentMat = toonMat(def.palette.accent);
  const glowMat = toonMat(def.palette.glow, { emissive: def.palette.glow, emissiveIntensity: unique ? 2.2 : 1.4 });

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // Rounded body + big head — knee-height, soft silhouette.
  const torso = mesh(sphere(0.22), bodyMat, 0, 0.24, -0.04);
  torso.scale.set(1, 0.92, 1.15);
  body.add(torso);
  const belly = mesh(sphere(0.17), bellyMat, 0, 0.21, 0.08);
  belly.scale.set(0.85, 0.75, 0.7);
  body.add(belly);

  const head = new THREE.Group();
  head.position.set(0, 0.5, 0.1);
  body.add(head);
  head.add(mesh(sphere(0.19), bodyMat));

  // Large expressive eyes with glints.
  const eyeWhite = toonMat('#ffffff');
  const eyeDark = toonMat('#1a1230');
  for (const side of [-1, 1]) {
    const w = mesh(sphere(0.055), eyeWhite, 0.078 * side, 0.02, 0.15);
    const p = mesh(sphere(0.038), eyeDark, 0.082 * side, 0.02, 0.175);
    const glint = mesh(sphere(0.012), toonMat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 1.5 }), 0.095 * side, 0.045, 0.2);
    head.add(w, p, glint);
  }
  // Tiny nose.
  head.add(mesh(sphere(0.02), accentMat, 0, -0.04, 0.185));

  // Long expressive ears.
  const mkEar = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.1 * side, 0.15, -0.02);
    const ear = mesh(cone(0.055, 0.3), bodyMat, 0, 0.15, 0);
    ear.scale.set(0.6, 1, 1);
    const inner = mesh(cone(0.03, 0.18), glowMat, 0, 0.12, 0.015);
    inner.scale.set(0.5, 1, 0.6);
    pivot.add(ear, inner);
    pivot.rotation.z = -0.25 * side;
    head.add(pivot);
    return pivot;
  };
  const earL = mkEar(-1);
  const earR = mkEar(1);

  // Expressive tail with a glowing tip.
  const tail = new THREE.Group();
  tail.position.set(0, 0.28, -0.24);
  const tailSeg = mesh(cone(0.05, 0.34), bodyMat, 0, 0.05, -0.14);
  tailSeg.rotation.x = Math.PI / 2 + 0.7;
  tail.add(tailSeg);
  tail.add(mesh(sphere(0.05), glowMat, 0, 0.13, -0.3));
  body.add(tail);

  // Stubby legs.
  for (const [x, z] of [
    [-0.11, 0.08],
    [0.11, 0.08],
    [-0.11, -0.12],
    [0.11, -0.12],
  ]) {
    body.add(mesh(capsule(0.045, 0.08), bodyMat, x, 0.07, z));
  }

  // Bioluminescent markings along the back.
  for (let i = 0; i < 3; i++) {
    body.add(mesh(sphere(0.02 + (2 - i) * 0.006), glowMat, 0, 0.42 - i * 0.02, -0.05 - i * 0.09));
  }

  group.traverse((o) => {
    o.castShadow = true;
  });

  let phase = 0;
  return {
    group,
    height: 0.75,
    animate(ctx) {
      const speedNorm = Math.min(1, ctx.speed / 3);
      phase += ctx.dt * (5 + ctx.speed * 3);
      // Bouncy hop-walk.
      body.position.y = Math.abs(Math.sin(phase)) * 0.09 * speedNorm + Math.sin(ctx.time * 2.2) * 0.008;
      // Ear and tail expressiveness.
      const flick = Math.sin(ctx.time * 1.3) * 0.12 + Math.sin(ctx.time * 4.7) * 0.04;
      earL.rotation.z = -0.25 + flick;
      earR.rotation.z = 0.25 - flick;
      tail.rotation.y = Math.sin(ctx.time * 2.6) * 0.5;
      tail.rotation.x = Math.sin(ctx.time * 1.7) * 0.2;
      head.rotation.y = Math.sin(ctx.time * 0.9) * 0.35;
      head.rotation.x = ctx.resting ? 0.5 : Math.sin(ctx.time * 0.5) * 0.1;
      if (ctx.resting) {
        body.scale.set(1, 0.8, 1);
      } else {
        body.scale.set(1, 1, 1);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Other native creatures
// ---------------------------------------------------------------------------

export function buildCreatureRig(def: CreatureSpeciesDef, variant: number, juvenile: boolean): Rig {
  if (def.plan === 'lumi') {
    const rig = buildLumiRig(def, false);
    if (juvenile) rig.group.scale.setScalar(0.65);
    return rig;
  }
  const bodyMat = toonMat(def.palette.body);
  const bellyMat = toonMat(def.palette.belly);
  const accentMat = toonMat(def.palette.accent);
  const glowMat = toonMat(def.palette.glow, { emissive: def.palette.glow, emissiveIntensity: 1.5 });

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const legs: THREE.Group[] = [];
  const wings: THREE.Mesh[] = [];
  let tail: THREE.Object3D | null = null;
  let height = 1;

  const mkLegAt = (x: number, z: number, y: number, r: number, len: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.add(mesh(capsule(r, len), bodyMat, 0, -len / 2 - r, 0));
    body.add(pivot);
    legs.push(pivot);
    return pivot;
  };

  switch (def.plan) {
    case 'grazer': {
      const torso = mesh(capsule(0.3, 0.5), bodyMat, 0, 0.62, 0);
      torso.rotation.x = Math.PI / 2;
      body.add(torso);
      body.add(mesh(sphere(0.18), bodyMat, 0, 0.72, 0.48));
      body.add(mesh(sphere(0.03), toonMat('#101418'), -0.09, 0.76, 0.6));
      body.add(mesh(sphere(0.03), toonMat('#101418'), 0.09, 0.76, 0.6));
      for (let i = 0; i < 4; i++) {
        const thorn = mesh(cone(0.06, 0.2), accentMat, 0, 0.92, 0.25 - i * 0.18);
        thorn.scale.set(0.6, 1, 1);
        body.add(thorn);
      }
      mkLegAt(-0.18, 0.28, 0.5, 0.06, 0.3);
      mkLegAt(0.18, 0.28, 0.5, 0.06, 0.3);
      mkLegAt(-0.18, -0.28, 0.5, 0.06, 0.3);
      mkLegAt(0.18, -0.28, 0.5, 0.06, 0.3);
      height = 1.1;
      break;
    }
    case 'strider': {
      const torso = mesh(capsule(0.24, 0.45), bodyMat, 0, 1.35, 0);
      torso.rotation.x = Math.PI / 2;
      body.add(torso);
      const neck = mesh(capsule(0.08, 0.55), bodyMat, 0, 1.75, 0.3);
      neck.rotation.x = 0.5;
      body.add(neck);
      body.add(mesh(sphere(0.12), bodyMat, 0, 2.05, 0.52));
      body.add(mesh(sphere(0.025), toonMat('#101418'), -0.06, 2.08, 0.62));
      body.add(mesh(sphere(0.025), toonMat('#101418'), 0.06, 2.08, 0.62));
      body.add(mesh(sphere(0.05), glowMat, 0, 2.16, 0.5));
      mkLegAt(-0.15, 0.22, 1.2, 0.05, 0.95);
      mkLegAt(0.15, 0.22, 1.2, 0.05, 0.95);
      mkLegAt(-0.15, -0.22, 1.2, 0.05, 0.95);
      mkLegAt(0.15, -0.22, 1.2, 0.05, 0.95);
      height = 2.3;
      break;
    }
    case 'blob': {
      const blob = mesh(sphere(0.28), bodyMat, 0, 0.26, 0);
      blob.scale.set(1, 0.85, 1);
      body.add(blob);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const tuft = mesh(cone(0.07, 0.16), bellyMat, Math.sin(a) * 0.16, 0.46, Math.cos(a) * 0.16);
        tuft.rotation.set(Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5);
        body.add(tuft);
      }
      body.add(mesh(sphere(0.04), toonMat('#101418'), -0.09, 0.3, 0.24));
      body.add(mesh(sphere(0.04), toonMat('#101418'), 0.09, 0.3, 0.24));
      body.add(mesh(sphere(0.03), glowMat, 0, 0.5, 0));
      height = 0.6;
      break;
    }
    case 'floater': {
      const bell = mesh(sphere(0.3), toonMat(def.palette.body, { emissive: def.palette.glow, emissiveIntensity: 0.35 }), 0, 0.4, 0);
      bell.scale.set(1, 0.8, 1);
      body.add(bell);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const tent = mesh(cone(0.03, 0.5), bellyMat, Math.sin(a) * 0.16, 0.05, Math.cos(a) * 0.16);
        tent.rotation.x = Math.PI;
        body.add(tent);
        wings.push(tent);
      }
      body.add(mesh(sphere(0.06), glowMat, 0, 0.55, 0));
      height = 0.9;
      break;
    }
    case 'fish': {
      const torso = mesh(capsule(0.14, 0.4), bodyMat, 0, 0.15, 0);
      torso.rotation.x = Math.PI / 2;
      torso.scale.set(0.7, 1, 1);
      body.add(torso);
      const tailFin = mesh(cone(0.16, 0.25), glowMat, 0, 0.15, -0.42);
      tailFin.rotation.x = -Math.PI / 2;
      tailFin.scale.set(0.25, 1, 1.4);
      body.add(tailFin);
      tail = tailFin;
      const dorsal = mesh(cone(0.1, 0.18), accentMat, 0, 0.35, 0);
      dorsal.scale.set(0.25, 1, 1);
      body.add(dorsal);
      body.add(mesh(sphere(0.025), toonMat('#101418'), -0.07, 0.18, 0.22));
      body.add(mesh(sphere(0.025), toonMat('#101418'), 0.07, 0.18, 0.22));
      height = 0.5;
      break;
    }
    case 'bird': {
      const torso = mesh(sphere(0.16), bodyMat, 0, 0.3, 0);
      torso.scale.set(0.85, 1, 1.25);
      body.add(torso);
      body.add(mesh(sphere(0.11), bodyMat, 0, 0.48, 0.14));
      const beak = mesh(cone(0.035, 0.12), toonMat('#e8c26a'), 0, 0.46, 0.26);
      beak.rotation.x = Math.PI / 2;
      body.add(beak);
      body.add(mesh(sphere(0.02), toonMat('#101418'), -0.05, 0.51, 0.2));
      body.add(mesh(sphere(0.02), toonMat('#101418'), 0.05, 0.51, 0.2));
      const wingGeo = new THREE.BoxGeometry(0.28, 0.03, 0.18);
      const wl = mesh(wingGeo, bellyMat, -0.2, 0.34, 0);
      const wr = mesh(wingGeo, bellyMat, 0.2, 0.34, 0);
      body.add(wl, wr);
      wings.push(wl, wr);
      const tailF = mesh(cone(0.06, 0.2), accentMat, 0, 0.3, -0.22);
      tailF.rotation.x = -Math.PI / 2 - 0.4;
      tailF.scale.set(0.4, 1, 1);
      body.add(tailF);
      mkLegAt(-0.06, 0, 0.18, 0.02, 0.1);
      mkLegAt(0.06, 0, 0.18, 0.02, 0.1);
      height = 0.65;
      break;
    }
    case 'moth': {
      const torso = mesh(capsule(0.07, 0.2), bodyMat, 0, 0.25, 0);
      torso.rotation.x = Math.PI / 2;
      body.add(torso);
      const wingGeo = new THREE.PlaneGeometry(0.34, 0.24);
      const wingMat = new THREE.MeshToonMaterial({
        color: new THREE.Color(def.palette.belly),
        emissive: new THREE.Color(def.palette.glow),
        emissiveIntensity: 0.9,
        side: THREE.DoubleSide,
      });
      const wl = new THREE.Mesh(wingGeo, wingMat);
      wl.position.set(-0.18, 0.3, 0);
      wl.rotation.y = 0.2;
      const wr = new THREE.Mesh(wingGeo, wingMat);
      wr.position.set(0.18, 0.3, 0);
      wr.rotation.y = -0.2;
      body.add(wl, wr);
      wings.push(wl, wr);
      body.add(mesh(sphere(0.045), glowMat, 0, 0.27, 0.14));
      height = 0.5;
      break;
    }
    case 'raptor': {
      const torso = mesh(capsule(0.26, 0.55), bodyMat, 0, 0.78, 0);
      torso.rotation.x = Math.PI / 2 - 0.15;
      body.add(torso);
      const neck = mesh(capsule(0.1, 0.25), bodyMat, 0, 1.05, 0.4);
      neck.rotation.x = 0.6;
      body.add(neck);
      const headM = mesh(sphere(0.15), bodyMat, 0, 1.2, 0.55);
      headM.scale.set(0.8, 0.8, 1.3);
      body.add(headM);
      body.add(mesh(sphere(0.03), glowMat, -0.08, 1.26, 0.6));
      body.add(mesh(sphere(0.03), glowMat, 0.08, 1.26, 0.6));
      const jaw = mesh(cone(0.07, 0.2), bellyMat, 0, 1.12, 0.72);
      jaw.rotation.x = Math.PI / 2;
      body.add(jaw);
      for (let i = 0; i < 3; i++) {
        const spike = mesh(cone(0.07, 0.22), accentMat, 0, 1.05, 0.1 - i * 0.22);
        spike.scale.set(0.5, 1, 1);
        spike.rotation.x = -0.3;
        body.add(spike);
      }
      const tailM = mesh(cone(0.12, 0.8), bodyMat, 0, 0.72, -0.6);
      tailM.rotation.x = -Math.PI / 2 - 0.15;
      body.add(tailM);
      tail = tailM;
      mkLegAt(-0.18, -0.05, 0.62, 0.07, 0.4);
      mkLegAt(0.18, -0.05, 0.62, 0.07, 0.4);
      height = 1.5;
      break;
    }
  }

  group.traverse((o) => {
    o.castShadow = true;
  });
  const s = def.scale * (juvenile ? 0.6 : 1) * (0.9 + variant * 0.2);
  group.scale.setScalar(s);

  let phase = variant * 10;
  return {
    group,
    height: height * s + (def.hover ? def.hoverHeight ?? 0 : 0),
    animate(ctx) {
      const speedNorm = Math.min(1, ctx.speed / Math.max(1, def.speed));
      phase += ctx.dt * (4 + ctx.speed * 2.5);
      for (let i = 0; i < legs.length; i++) {
        legs[i].rotation.x = Math.sin(phase + (i % 2) * Math.PI) * 0.55 * speedNorm;
      }
      if (def.plan === 'bird' || def.plan === 'moth') {
        const flap = Math.sin(ctx.time * (def.plan === 'moth' ? 9 : 6)) * 0.6;
        if (wings[0]) wings[0].rotation.z = 0.2 + flap;
        if (wings[1]) wings[1].rotation.z = -0.2 - flap;
      } else if (def.plan === 'floater') {
        for (let i = 0; i < wings.length; i++) {
          wings[i].rotation.x = Math.PI + Math.sin(ctx.time * 2 + i) * 0.25;
        }
        body.position.y = Math.sin(ctx.time * 1.4 + variant * 8) * 0.15;
      }
      if (tail) {
        tail.rotation.y = Math.sin(phase * (def.plan === 'fish' ? 2 : 0.6)) * (def.plan === 'fish' ? 0.5 : 0.2);
      }
      if (def.plan === 'blob') {
        body.scale.y = 1 + Math.sin(ctx.time * 3 + variant * 6) * 0.06;
        body.position.y = Math.abs(Math.sin(phase * 0.8)) * 0.08 * speedNorm;
      }
      if (ctx.resting && def.plan !== 'floater' && def.plan !== 'moth') {
        body.scale.y = 0.82;
      } else if (def.plan !== 'blob') {
        body.scale.y = 1;
      }
    },
  };
}
