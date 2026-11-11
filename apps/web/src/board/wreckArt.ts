import { Texture } from 'pixi.js';

/** Texture key of a wreck as the board draws it: the counter's wreck side cut out of its chit (see `wreckTexture`). */
export const WRECK_PREFIX = 'wreck:';

/** Working size of the cut-out: the small VASL backs (60 px) are scaled up first so the outline stays smooth. */
const MIN_SIZE = 240;

/**
 * A wreck drawn as the vehicle alone: the wreck side of its counter with the chit around it taken away (a flood
 * fill from the counter's edge through the chit colour) and a white stroke round what is left, so a burnt-out hulk
 * reads as debris on the map rather than as a white counter. Works on the HD German wrecks (a photo on a grey chit)
 * and on the VASL line drawings (black lines on a white chit; the hull inside its outline stays white).
 */
export async function wreckTexture(url: string): Promise<Texture | null> {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const size = Math.max(MIN_SIZE, img.naturalWidth);
  const src = document.createElement('canvas');
  src.width = src.height = size;
  const sc = src.getContext('2d', { willReadFrequently: true })!;
  sc.imageSmoothingQuality = 'high';
  sc.drawImage(img, 0, 0, size, size);
  const data = sc.getImageData(0, 0, size, size);
  const px = data.data;

  // The chit colour: sampled just inside the edge (the corners are rounded and the edge may be bevelled).
  const inset = Math.round(size * 0.06);
  const samples = [
    [inset, size >> 1], [size - 1 - inset, size >> 1], [size >> 1, inset], [size >> 1, size - 1 - inset],
    [inset, inset], [size - 1 - inset, inset], [inset, size - 1 - inset], [size - 1 - inset, size - 1 - inset],
  ];
  const bg = [0, 1, 2].map((c) => samples.reduce((s, [x, y]) => s + px[(y! * size + x!) * 4 + c]!, 0) / samples.length);
  const near = (i: number) => {
    if (px[i + 3]! < 24) return true;
    const d = Math.abs(px[i]! - bg[0]!) + Math.abs(px[i + 1]! - bg[1]!) + Math.abs(px[i + 2]! - bg[2]!);
    return d < 90;
  };

  // Everything outside the inset frame is chit; flood inwards through chit-coloured pixels.
  const clear = new Uint8Array(size * size);
  const queue: number[] = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (x < inset || y < inset || x >= size - inset || y >= size - inset) {
        clear[y * size + x] = 1;
        queue.push(y * size + x);
      }
    }
  while (queue.length) {
    const k = queue.pop()!;
    const x = k % size;
    const y = (k - x) / size;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const n = ny * size + nx;
      if (clear[n] || !near(n * 4)) continue;
      clear[n] = 1;
      queue.push(n);
    }
  }
  for (let k = 0; k < clear.length; k++) if (clear[k]) px[k * 4 + 3] = 0;
  sc.putImageData(data, 0, 0);

  // A white rim: the cut-out stamped in white round a small circle, then the cut-out itself on top.
  const r = Math.max(3, Math.round(size * 0.022));
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const oc = out.getContext('2d')!;
  const rim = document.createElement('canvas');
  rim.width = rim.height = size;
  const rc = rim.getContext('2d')!;
  for (let a = 0; a < 24; a++) {
    const t = (a / 24) * Math.PI * 2;
    rc.drawImage(src, Math.cos(t) * r, Math.sin(t) * r);
  }
  rc.globalCompositeOperation = 'source-in';
  rc.fillStyle = '#ffffff';
  rc.fillRect(0, 0, size, size);
  oc.shadowColor = 'rgba(0, 0, 0, 0.55)';
  oc.shadowBlur = r * 1.5;
  oc.shadowOffsetX = r * 0.5;
  oc.shadowOffsetY = r * 0.8;
  oc.drawImage(rim, 0, 0);
  oc.shadowColor = 'transparent';
  oc.drawImage(src, 0, 0);
  const tex = Texture.from(out);
  tex.source.autoGenerateMipmaps = true;
  return tex;
}
