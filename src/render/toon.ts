import * as THREE from 'three';

/** Shared stylized-material helpers: three-step toon shading + status sprites. */

let gradientMap: THREE.DataTexture | null = null;

export function getGradientMap(): THREE.DataTexture {
  if (!gradientMap) {
    const data = new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]);
    gradientMap = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.needsUpdate = true;
  }
  return gradientMap;
}

export function toonMat(color: string | number, opts: { emissive?: string | number; emissiveIntensity?: number } = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color: new THREE.Color(color),
    gradientMap: getGradientMap(),
    emissive: opts.emissive !== undefined ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
}

function makeCanvasTexture(draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const spriteCache = new Map<string, THREE.SpriteMaterial>();

export function statusSpriteMaterial(kind: 'social' | 'sleep' | 'alert'): THREE.SpriteMaterial {
  let mat = spriteCache.get(kind);
  if (mat) return mat;
  let tex: THREE.CanvasTexture;
  if (kind === 'social') {
    tex = makeCanvasTexture((ctx, s) => {
      ctx.fillStyle = 'rgba(10,20,28,0.85)';
      ctx.beginPath();
      ctx.roundRect(6, 10, s - 12, s - 28, 12);
      ctx.fill();
      ctx.moveTo(s / 2 - 6, s - 18);
      ctx.lineTo(s / 2 + 8, s - 18);
      ctx.lineTo(s / 2, s - 6);
      ctx.fill();
      ctx.fillStyle = '#7fe7ff';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(20 + i * 12, s / 2 - 4, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  } else if (kind === 'sleep') {
    tex = makeCanvasTexture((ctx, s) => {
      ctx.fillStyle = '#9fb8ff';
      ctx.font = 'bold 30px sans-serif';
      ctx.fillText('Z', 10, 34);
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText('z', 32, 44);
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText('z', 46, s - 12);
    });
  } else {
    tex = makeCanvasTexture((ctx, s) => {
      ctx.fillStyle = '#ffb03f';
      ctx.font = `bold ${s - 16}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('!', s / 2, s - 14);
    });
  }
  mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  spriteCache.set(kind, mat);
  return mat;
}
