import { useEffect, useRef } from 'react';
import { getWorld } from '../sim';
import { WORLD } from '../sim/config';
import { placeName } from '../sim/landmarks';
import { missionTracking } from '../sim/mission';
import { regionAt, regionShortName } from '../sim/regions';
import { heightAt, isWater } from '../sim/terrain';
import { inputState } from '../game/input';
import { useUI } from '../state/store';

/**
 * A small valley map, bottom right.
 *
 * Deliberately modest. It answers one question — "roughly where am I, and
 * which way is what I am looking for?" — and stops there. No fog of war, no
 * resource filters, no full-screen map, no waypoints.
 *
 * The whole valley fits, north up, because the valley is only about 340 metres
 * across and a scrolling window at that scale tells you less than the shape of
 * the place does. The terrain is an analytic heightfield with no seed input, so
 * the base image is identical in every world and is drawn exactly once; only
 * the markers move.
 */

/** Canvas resolution of the base image. Displayed larger; it is a map, not a photo. */
const TEX = 132;
const R = WORLD.playRadius;

let baseImage: HTMLCanvasElement | null = null;

/**
 * World metres to map pixels.
 *
 * Exported so the mapping can be tested without a canvas: a marker in the wrong
 * place is worse than no marker, and "the objective is drawn where the objective
 * is" is exactly the kind of thing that silently inverts on a sign error.
 */
export function toMapPixel(x: number, z: number, size: number): { px: number; py: number } {
  return { px: ((x + R) / (2 * R)) * size, py: ((z + R) / (2 * R)) * size };
}

/**
 * Canvas rotation for Kai's arrow, given his yaw.
 *
 * Exported so the sign can be tested: it was wrong, and a heading indicator
 * that points exactly backwards is worse than no heading indicator at all.
 */
export function arrowRotation(yaw: number): number {
  return Math.PI - yaw;
}

/**
 * Paint the valley once.
 *
 * Height drives the colour ramp, so the river reads as a river, the meadow as
 * open ground, and the mountain rim as the wall it is — which is exactly the
 * information a player needs to understand that some directions are not routes.
 */
function buildBase(): HTMLCanvasElement {
  if (baseImage) return baseImage;
  const canvas = document.createElement('canvas');
  canvas.width = TEX;
  canvas.height = TEX;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(TEX, TEX);

  for (let py = 0; py < TEX; py++) {
    for (let px = 0; px < TEX; px++) {
      const x = ((px + 0.5) / TEX) * 2 * R - R;
      const z = ((py + 0.5) / TEX) * 2 * R - R;
      const i = (py * TEX + px) * 4;
      const r = Math.hypot(x, z);

      let cr: number, cg: number, cb: number, ca = 255;
      if (r > R) {
        ca = 0;
        cr = cg = cb = 0;
      } else if (isWater(x, z)) {
        cr = 26;
        cg = 74;
        cb = 96;
      } else {
        const h = heightAt(x, z);
        if (h > 26) {
          // Rim. Pale and cold, so it reads as the edge of the world.
          const t = Math.min(1, (h - 26) / 40);
          cr = 118 + t * 90;
          cg = 132 + t * 88;
          cb = 148 + t * 80;
        } else if (h > 11) {
          const t = (h - 11) / 15;
          cr = 74 + t * 44;
          cg = 92 + t * 40;
          cb = 78 + t * 70;
        } else {
          const t = Math.max(0, h) / 11;
          cr = 42 + t * 32;
          cg = 88 + t * 20;
          cb = 54 + t * 24;
        }
      }
      img.data[i] = cr;
      img.data[i + 1] = cg;
      img.data[i + 2] = cb;
      img.data[i + 3] = ca;
    }
  }
  ctx.putImageData(img, 0, 0);
  baseImage = canvas;
  return canvas;
}

export function Minimap() {
  useUI((s) => s.uiPulse);
  const ref = useRef<HTMLCanvasElement>(null);
  const world = getWorld();
  const p = world.player;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    const ctx = canvas.getContext('2d')!;
    const base = buildBase();

    // Driven by rAF rather than React: the arrow turns with the camera, and a
    // store update per frame would re-render every panel in the game to rotate
    // one triangle.
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = canvas.width;
      const toPx = (x: number, z: number) => {
        const { px, py } = toMapPixel(x, z, w);
        return [px, py];
      };

      ctx.clearRect(0, 0, w, w);
      ctx.drawImage(base, 0, 0, w, w);

      const live = getWorld();
      const player = live.player;

      // Human Landing, so there is always a way home on the map.
      const camp = live.camps.find((c) => c.speciesId === 'human');
      if (camp) {
        const [cx, cy] = toPx(camp.pos.x, camp.pos.z);
        ctx.beginPath();
        ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(232, 244, 250, 0.9)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(10, 22, 30, 0.8)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // The objective, while it is something Kai is actually looking for.
      if (live.mission && missionTracking(live)) {
        const [ox, oy] = toPx(live.mission.podPos.x, live.mission.podPos.z);
        const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 380);
        ctx.beginPath();
        ctx.arc(ox, oy, 5.5, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 176, 63, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ox, oy, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffb03f';
        ctx.fill();
      }

      // Kai, pointing where the camera is pointing.
      const [kx, ky] = toPx(player.pos.x, player.pos.z);
      ctx.save();
      ctx.translate(kx, ky);
      // Kai's facing, converted from world yaw to canvas rotation.
      //
      // Forward at yaw θ moves toward (sin θ, cos θ) in world x/z, and this map
      // puts +x right and +z down — so the arrow must end up pointing at
      // (sin θ, cos θ) in canvas pixels. A triangle drawn pointing up is
      // (0, −1), and canvas `rotate(a)` sends it to (sin a, −cos a); solving
      // gives a = π − θ. The old `-θ` produced exactly (−sin θ, −cos θ), the
      // precise negation — which is why the arrow read as pointing backwards.
      ctx.rotate(arrowRotation(inputState.camYaw));
      ctx.beginPath();
      ctx.moveTo(0, -6.5);
      ctx.lineTo(4.4, 5);
      ctx.lineTo(0, 2.6);
      ctx.lineTo(-4.4, 5);
      ctx.closePath();
      ctx.fillStyle = '#7fe7ff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(6, 18, 26, 0.9)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="minimap">
      <canvas ref={ref} width={198} height={198} className="minimap-canvas" />
      <div className="minimap-rose">N</div>
      <div className="minimap-where">
        <span className="minimap-place">{placeName(p.pos)}</span>
        <span className="minimap-region">{regionShortName(regionAt(p.pos.x, p.pos.z))}</span>
      </div>
    </div>
  );
}
