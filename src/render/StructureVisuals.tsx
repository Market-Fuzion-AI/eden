import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getWorld } from '../sim';
import { daylight01 } from '../sim/chronicle';
import { constructionStage } from '../sim/structures';
import type { Structure } from '../sim/types';
import { useUI } from '../state/store';
import { toonMat } from './toon';

/**
 * Procedural structures. Construction reads through four stages — footings,
 * frame, walls, finished — so a half-built shelter is legible at a glance and
 * a stalled project looks stalled.
 *
 * Registered into a shared map so Creator Mode can raycast-select them.
 */
export const structureGroups = new Map<string, THREE.Group>();

const WOOD = '#7a5636';
const WOOD_DARK = '#5c3f28';
const STONE = '#77737f';
const HIDE = '#9a8a6c';
const ACCENT = '#59d6e6';

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Campfire
// ---------------------------------------------------------------------------

interface CampfireRig {
  group: THREE.Group;
  flames: THREE.Mesh[];
  light: THREE.PointLight;
  embers: THREE.Points;
  setStage(stage: number): void;
}

function buildCampfire(): CampfireRig {
  const group = new THREE.Group();
  const stoneMat = toonMat(STONE);
  const woodMat = toonMat(WOOD_DARK);

  // Stone ring — the first thing laid down.
  const ring = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = 0.92;
    const s = mesh(new THREE.DodecahedronGeometry(0.2 + (i % 3) * 0.05, 0), stoneMat, Math.sin(a) * r, 0.11, Math.cos(a) * r);
    s.rotation.set(i, a, i * 0.7);
    ring.add(s);
  }
  group.add(ring);

  // Fuel: stacked logs.
  const fuel = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI;
    const log = mesh(new THREE.CylinderGeometry(0.075, 0.09, 1.05, 6), woodMat, 0, 0.16 + (i % 2) * 0.1, 0);
    log.rotation.set(Math.PI / 2, a, 0.25 + i * 0.12);
    fuel.add(log);
  }
  group.add(fuel);

  // Flames — layered cones, animated by scale and colour.
  const flames: THREE.Mesh[] = [];
  const flameColors = ['#ff8a2f', '#ffc24a', '#fff0b0'];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(flameColors[i]),
      transparent: true,
      opacity: 0.86 - i * 0.14,
      depthWrite: false,
      toneMapped: false,
    });
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.34 - i * 0.09, 0.95 - i * 0.24, 7), m);
    f.position.y = 0.52 - i * 0.08;
    f.castShadow = false;
    flames.push(f);
    group.add(f);
  }

  // Rising embers.
  const emberCount = 22;
  const emberGeo = new THREE.BufferGeometry();
  const emberPos = new Float32Array(emberCount * 3);
  for (let i = 0; i < emberCount; i++) {
    emberPos[i * 3] = (Math.sin(i * 12.9) * 0.5) * 0.7;
    emberPos[i * 3 + 1] = Math.random() * 2.2;
    emberPos[i * 3 + 2] = (Math.cos(i * 7.3) * 0.5) * 0.7;
  }
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
  const embers = new THREE.Points(
    emberGeo,
    new THREE.PointsMaterial({ color: '#ffb26a', size: 0.09, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }),
  );
  group.add(embers);

  const light = new THREE.PointLight(new THREE.Color('#ff9a44'), 0, 18, 2);
  light.position.y = 0.8;
  group.add(light);

  return {
    group,
    flames,
    light,
    embers,
    setStage(stage: number) {
      ring.visible = true;
      // Ring first, then fuel, then fire.
      ring.scale.setScalar(stage === 0 ? 0.85 : 1);
      fuel.visible = stage >= 1;
      const lit = stage >= 3;
      for (const f of flames) f.visible = lit;
      embers.visible = lit;
      light.visible = lit;
    },
  };
}

// ---------------------------------------------------------------------------
// Basic shelter
// ---------------------------------------------------------------------------

interface ShelterRig {
  group: THREE.Group;
  lamp: THREE.PointLight;
  setStage(stage: number): void;
}

function buildShelter(variant: number): ShelterRig {
  const group = new THREE.Group();
  const stoneMat = toonMat(STONE);
  const woodMat = toonMat(WOOD);
  const woodDarkMat = toonMat(WOOD_DARK);
  const hideMat = toonMat(HIDE);
  const glowMat = toonMat(ACCENT, { emissive: ACCENT, emissiveIntensity: 1.8 });

  const W = 2.5;
  const D = 2.1;

  // Stage 0 — stone footings.
  const footings = new THREE.Group();
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    footings.add(mesh(new THREE.DodecahedronGeometry(0.28, 0), stoneMat, (W / 2) * sx, 0.12, (D / 2) * sz));
  }
  // Low stone course along the back.
  for (let i = -1; i <= 1; i++) {
    footings.add(mesh(new THREE.BoxGeometry(0.7, 0.24, 0.34), stoneMat, i * 0.82, 0.12, -D / 2));
  }
  group.add(footings);

  // Stage 1 — corner posts and a ridge beam.
  const frame = new THREE.Group();
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    frame.add(mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.7, 6), woodMat, (W / 2) * sx, 0.85, (D / 2) * sz));
  }
  const ridge = mesh(new THREE.CylinderGeometry(0.08, 0.08, W + 0.5, 6), woodDarkMat, 0, 2.05, 0);
  ridge.rotation.z = Math.PI / 2;
  frame.add(ridge);
  // Rafters.
  for (let i = -1; i <= 1; i++) {
    for (const sz of [-1, 1]) {
      const r = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 5), woodMat, i * 0.85, 1.6, (sz * D) / 4);
      r.rotation.x = sz * 0.72;
      frame.add(r);
    }
  }
  group.add(frame);

  // Stage 2 — walls.
  const walls = new THREE.Group();
  const backWall = mesh(new THREE.BoxGeometry(W, 1.5, 0.12), hideMat, 0, 0.9, -D / 2);
  walls.add(backWall);
  for (const sx of [-1, 1]) {
    const side = mesh(new THREE.BoxGeometry(0.12, 1.5, D), hideMat, (W / 2) * sx, 0.9, 0);
    walls.add(side);
  }
  // Front is left open apart from two short returns, leaving a doorway.
  for (const sx of [-1, 1]) {
    walls.add(mesh(new THREE.BoxGeometry(0.75, 1.5, 0.12), hideMat, sx * (W / 2 - 0.37), 0.9, D / 2));
  }
  group.add(walls);

  // Stage 3 — roof, door hanging, lamp.
  const roof = new THREE.Group();
  for (const sz of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(W + 0.55, 0.1, D * 0.78), toonMat(sz > 0 ? '#6d5a45' : '#5f4e3c'));
    panel.position.set(0, 1.82, (sz * D) / 4.4);
    panel.rotation.x = sz * 0.62;
    panel.castShadow = true;
    roof.add(panel);
  }
  // Door curtain.
  const curtain = mesh(new THREE.BoxGeometry(1.0, 1.25, 0.06), toonMat('#4e5a63'), 0, 0.78, D / 2 + 0.04);
  roof.add(curtain);
  // Salvaged lamp — a small piece of the technology they brought.
  roof.add(mesh(new THREE.SphereGeometry(0.11, 10, 8), glowMat, W / 2 - 0.1, 1.72, D / 2 + 0.1));
  group.add(roof);

  const lamp = new THREE.PointLight(new THREE.Color(ACCENT), 0, 10, 2);
  lamp.position.set(W / 2 - 0.1, 1.72, D / 2 + 0.3);
  group.add(lamp);

  group.rotation.y = variant * Math.PI * 2;

  return {
    group,
    lamp,
    setStage(stage: number) {
      footings.visible = true;
      frame.visible = stage >= 1;
      walls.visible = stage >= 2;
      roof.visible = stage >= 3;
      lamp.visible = stage >= 3;
    },
  };
}

// ---------------------------------------------------------------------------
// One structure
// ---------------------------------------------------------------------------

function StructureView({ id }: { id: string }) {
  const rigRef = useRef<{ group: THREE.Group; setStage(n: number): void } | null>(null);
  const campfireRef = useRef<CampfireRig | null>(null);
  const shelterRef = useRef<ShelterRig | null>(null);
  const lastStage = useRef(-1);

  const rig = useMemo(() => {
    const world = getWorld();
    const st = world.structures.find((s) => s.id === id);
    if (!st) return null;
    let built: { group: THREE.Group; setStage(n: number): void };
    if (st.type === 'campfire') {
      const c = buildCampfire();
      campfireRef.current = c;
      built = c;
    } else {
      // Deterministic per-structure rotation from the id.
      let h = 0;
      for (let i = 0; i < st.id.length; i++) h = (h * 31 + st.id.charCodeAt(i)) | 0;
      const s = buildShelter((Math.abs(h) % 1000) / 1000);
      shelterRef.current = s;
      built = s;
    }
    built.group.position.set(st.pos.x, st.y, st.pos.z);
    built.group.userData.structureId = st.id;
    built.group.traverse((o) => (o.userData.structureId = st.id));
    rigRef.current = built;
    return built;
  }, [id]);

  useEffect(() => {
    if (!rig) return;
    structureGroups.set(id, rig.group);
    return () => {
      structureGroups.delete(id);
    };
  }, [id, rig]);

  useFrame(({ clock }) => {
    if (!rig) return;
    const world = getWorld();
    const st = world.structures.find((s) => s.id === id) as Structure | undefined;
    if (!st) {
      rig.group.visible = false;
      return;
    }
    rig.group.visible = true;

    const stage = constructionStage(st);
    if (stage !== lastStage.current) {
      lastStage.current = stage;
      rig.setStage(stage);
    }

    const t = clock.elapsedTime;
    const night = 1 - daylight01(world.timeSec);

    const fire = campfireRef.current;
    if (fire && st.state === 'complete') {
      // Flicker: each flame layer breathes at its own rate.
      for (let i = 0; i < fire.flames.length; i++) {
        const f = fire.flames[i];
        const wobble = Math.sin(t * (7 + i * 2.6) + i) * 0.12 + Math.sin(t * (3.1 + i)) * 0.07;
        f.scale.set(1 + wobble * 0.5, 1 + wobble, 1 + wobble * 0.5);
        f.rotation.y = t * (0.7 + i * 0.3);
      }
      // Embers drift upward and recycle.
      const pos = fire.embers.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) + (0.6 + (i % 5) * 0.12) * 0.016;
        if (y > 2.4) y = 0.3;
        pos.setY(i, y);
        pos.setX(i, Math.sin(t * 1.4 + i) * 0.28);
        pos.setZ(i, Math.cos(t * 1.1 + i * 1.7) * 0.28);
      }
      pos.needsUpdate = true;
      fire.light.intensity = (3.2 + night * 7) * (0.86 + Math.sin(t * 9) * 0.14);
    }

    const shelter = shelterRef.current;
    if (shelter && st.state === 'complete') {
      shelter.lamp.intensity = night * 3.4;
    }
  });

  if (!rig) return null;
  return <primitive object={rig.group} />;
}

export function StructureVisuals() {
  // Re-render only when structures are added or removed.
  useUI((s) => s.structuresVersion);
  const world = getWorld();
  return (
    <group>
      {world.structures.map((s) => (
        <StructureView key={s.id} id={s.id} />
      ))}
    </group>
  );
}
