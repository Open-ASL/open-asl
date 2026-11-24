import { NineSliceSprite, Texture } from 'pixi.js';

/**
 * Measurements on the 180 px printed counter, turned so the vehicle points up.
 * Keep each model's roof and hatch detail; the pivot is the centre of the turret ring.
 */
type Profile = readonly [pivotX: number, pivotY: number, halfWidth: number, front: number, rear: number, muzzleX: number, muzzleY: number, tubeWidth: number, hullX: number, hullY: number, heading?: number];
const profiles: Record<string, Profile> = {
  T34M43: [92, 87, 17, 23, 28, 93, 29, 4, 91, 91],
  T34M41: [89, 84, 16, 21, 22, 90, 34, 4, 90, 92],
  T3485: [90, 82, 18, 23, 24, 92, 10, 5.5, 90, 92],
  KV1M41: [95, 83, 18, 24, 24, 95, 34, 4.5, 94, 92],
  IS2: [90, 92, 18, 25, 25, 90, 13, 5, 90, 100],
  BT7M37: [90, 81, 13, 16, 17, 89, 39, 3, 90, 90],
  M4A3: [91, 94, 20, 22, 24, 91, 37, 4.5, 90, 90],
  M4A3E2: [88, 91, 22, 22, 24, 89, 30, 4.5, 88, 92],
  M4A2L: [88, 92, 19, 23, 24, 90, 34, 5, 90, 89],
  ruShermanIII: [96, 96, 21, 22, 22, 93, 40, 4.4, 95, 95, 140],
  M5A1: [90, 91, 15, 17, 18, 90, 53, 3.4, 90, 92],
  M8AC: [90, 87, 14, 17, 17, 90, 56, 3.6, 90, 90],
  pz35t: [86, 87, 12, 16, 16, 89, 52, 3.2, 88, 90],
  pziia: [86, 86, 13, 18, 16, 89, 50, 3, 90, 90],
  pziif: [88, 84, 13, 17, 17, 90, 43, 3, 90, 87],
  pziiig: [88, 86, 18, 20, 20, 88, 43, 4, 90, 90],
  pziiin: [88, 87, 17, 18, 21, 89, 42, 5.4, 89, 90],
  pzivd: [88, 87, 19, 18, 23, 89, 42, 5.4, 90, 90],
  pzivf2: [89, 90, 17, 22, 24, 89, 13, 6, 90, 90],
  pzivh: [88, 92, 19, 20, 24, 89, 13, 6, 90, 90],
  pzivj: [89, 91, 19, 20, 24, 89, 13, 6, 90, 89],
  pzvg: [89, 87, 21, 26, 28, 90, 9, 6.4, 90, 91],
  pzvie: [90, 89, 25, 24, 32, 91, 3, 7, 90, 94],
  pzviel: [89, 91, 25, 24, 32, 89, 5, 6.8, 88, 92],
  pzvib: [90, 97, 20, 28, 38, 90, 7, 6.8, 89, 100],
  psw2341: [90, 80, 13, 15, 17, 89, 36, 3, 88, 92],
  psw2342: [87, 79, 15, 17, 18, 88, 16, 4, 88, 94],
  mkvib: [93, 94, 12, 15, 15, 94, 64, 2.8, 90, 91],
  cromiv: [88, 80, 16, 17, 20, 90, 28, 5, 89, 90],
  sheriiaa: [88, 89, 20, 23, 23, 90, 14, 6.2, 88, 91],
  daimac: [90, 91, 14, 16, 17, 90, 54, 3, 91, 90],
  ty97Bchiha: [90, 83, 15, 16, 18, 89, 43, 3.4, 90, 90],
  ty97Achiha: [89, 83, 15, 17, 17, 90, 39, 3.5, 90, 89],
  ty95hago: [89, 91, 13, 15, 15, 91, 51, 3, 91, 91],
};

// Measurements in the upright view: front edge of the hull and clearance for fuzzy
// barrel ink. Below the hull the repair borrows deck texture. Ahead of it, the
// neighboring stock along the printed border supplies matching background ink.
const barrelRepairs: Record<string, { hullFront: number; radius: number; squareFrame?: boolean; textLeft?: number }> = {
  pzvie: { squareFrame: true, hullFront: 36, radius: 6, textLeft: 130 },
  pzviel: { squareFrame: true, hullFront: 36, radius: 6, textLeft: 106 },
  pzvg: { squareFrame: true, hullFront: 30, radius: 5, textLeft: 106 },
  pzvib: { squareFrame: true, hullFront: 27, radius: 6, textLeft: 106 },
  pzivf2: { hullFront: 39, radius: 5.5, textLeft: 130 },
  pzivh: { hullFront: 38, radius: 5.5, textLeft: 130 },
  cromiv: { hullFront: 30, radius: 7.5 },
  sheriiaa: { hullFront: 33, radius: 6 },
  T3485: { hullFront: 39, radius: 6 },
  IS2: { squareFrame: true, hullFront: 47, radius: 6 },
  psw2342: { squareFrame: true, hullFront: 33, radius: 5 },
};

interface Layers {
  hullCenter: { x: number; y: number };
  roofWidth: number;
  stock: number;
  hull: Texture;
  turret: Texture;
  x: number;
  y: number;
  size: number;
}
const cache = new WeakMap<Texture, Layers>();
const PX = 180;

function surface(size: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return canvas.getContext('2d')!;
}

/** Split once per counter texture. Pivot coordinates returned in the board's 60 px counter space. */
export function printedTankLayers(front: Texture, url: string): Layers | null {
  const cached = cache.get(front);
  if (cached) return cached;
  const model = url.split('/').pop()?.replace(/\.webp$/, '') ?? '';
  const profile = profiles[model];
  const image = front.source.resource;
  if (!profile || !(image instanceof HTMLImageElement || (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap))) return null;
  const [x, y, w, nose, tail, muzzleX, muzzleY, tubeWidth, hullX, hullY, heading = 150] = profile;
  const angle = heading * Math.PI / 180;
  const upright = surface(PX);
  upright.translate(90, 90);
  upright.rotate(-angle);
  upright.drawImage(image, -90, -90, PX, PX);
  upright.resetTransform();

  // A closed outline trims the adjacent tracks and deck off the rotating roof.
  const roof = new Path2D();
  roof.moveTo(x - w * 0.48, y - nose);
  roof.quadraticCurveTo(x - w, y - nose * 0.77, x - w, y);
  roof.quadraticCurveTo(x - w, y + tail * 0.76, x - w * 0.55, y + tail);
  roof.lineTo(x + w * 0.55, y + tail);
  roof.quadraticCurveTo(x + w, y + tail * 0.76, x + w, y);
  roof.quadraticCurveTo(x + w, y - nose * 0.77, x + w * 0.48, y - nose);
  roof.closePath();

  const turret = surface(PX * 2);
  turret.translate(PX - x, PX - y);
  // Pick the median of several stock-colour samples beside the hull so a
  // printed numeral or white border at one point does not colour the gun.
  const samples = [31, 37, 44, 135, 142].map(px => upright.getImageData(px, 91, 1, 1).data);
  samples.sort((a, b) => (a[0]! + a[1]! + a[2]!) - (b[0]! + b[1]! + b[2]!));
  const sample = samples[2]!;
  // Lift the printed tube along its own axis. The narrow rounded tip and the
  // broader breech preserve the silhouette when the turret turns off the hull.
  const tube = new Path2D();
  const r = tubeWidth / 2;
  const breechY = y - nose + 2;
  tube.moveTo(muzzleX - r, muzzleY + r);
  tube.quadraticCurveTo(muzzleX - r, muzzleY, muzzleX, muzzleY);
  tube.quadraticCurveTo(muzzleX + r, muzzleY, muzzleX + r, muzzleY + r);
  tube.lineTo(x + r * 1.18, breechY);
  tube.lineTo(x - r * 1.18, breechY);
  tube.closePath();
  // Widen the printed tube about its centreline at each height. Both ends
  // stay in place even on counters whose muzzle is offset from the pivot.
  const widthScale = 1.15;
  const slope = (x - muzzleX) / (breechY - muzzleY);
  turret.save();
  turret.transform(widthScale, 0, (1 - widthScale) * slope, 1,
    (1 - widthScale) * (muzzleX - slope * muzzleY), 0);
  turret.clip(tube);
  turret.drawImage(upright.canvas, 0, 0);
  turret.fillStyle = 'rgba(25, 23, 19, 0.20)';
  turret.fill(tube);
  turret.restore();
  // Match the soft ink edges of the raster counter at the roof/deck join.
  // Only the cut line is feathered; the hatch and other printed details stay sharp.
  const roofMask = surface(PX);
  roofMask.filter = 'blur(1px)';
  roofMask.fill(roof);
  const roofArt = surface(PX);
  roofArt.drawImage(upright.canvas, 0, 0);
  roofArt.globalCompositeOperation = 'destination-in';
  roofArt.drawImage(roofMask.canvas, 0, 0);
  turret.drawImage(roofArt.canvas, 0, 0);

  // Repair the stationary deck. Copy the neighbouring scanline across the narrow
  // gun tube so counter borders and terrain-independent stock colours continue through it.
  const repair = surface(PX);
  const detail = barrelRepairs[model];
  const radius = detail?.radius ?? r * 1.18 + 1;
  const startY = Math.max(0, muzzleY - 3);
  repair.save();
  repair.beginPath();
  repair.moveTo(muzzleX - radius, startY);
  repair.lineTo(muzzleX + radius, startY);
  repair.lineTo(x + radius, breechY);
  repair.lineTo(x - radius, breechY);
  repair.closePath();
  repair.clip();
  const deckStart = detail?.hullFront ?? startY;
  const left = Math.floor(Math.min(muzzleX, x) - radius);
  const right = Math.ceil(Math.max(muzzleX, x) + radius);
  repair.drawImage(upright.canvas, left - 3, deckStart, 3, breechY - deckStart,
    left, deckStart, right - left, breechY - deckStart);
  if (detail) {
    repair.beginPath();
    repair.rect(left, startY, right - left, deckStart - startY);
    repair.clip();
    repair.translate(90, 90);
    repair.rotate(-angle);
    if (detail.squareFrame) {
      // The square frame runs horizontally under the muzzle. Only sample its
      // center where it is clear of the armor values, deck and gun caliber.
      repair.fillStyle = `rgb(${sample[0]} ${sample[1]} ${sample[2]})`;
      repair.fillRect(-90, -90, PX, PX);
      repair.drawImage(image, image.width / 2, image.height * 0.86, 1, image.height * 0.14,
        -90, PX * 0.86 - 90, PX, PX * 0.14);
    } else {
      // The circular frame continues along the rim into clear stock.
      repair.rotate(-Math.PI / 15);
      repair.drawImage(image, -90, -90, PX, PX);
    }
  }
  repair.restore();
  // Continue the model's printed deck underneath the rotating roof. Reflect the
  // nearby fore and aft plating inward so each exposed edge meets matching ink.
  const deck = surface(PX);
  deck.drawImage(upright.canvas, 0, 0);
  deck.drawImage(repair.canvas, 0, 0);
  const plating = surface(PX);
  plating.scale(1, -1);
  const frontDepth = Math.ceil(nose * 0.4);
  const rearDepth = Math.ceil(tail * 0.4);
  plating.drawImage(deck.canvas, x - w, y - nose - frontDepth, 2 * w, frontDepth,
    x - w, -y, 2 * w, nose);
  plating.drawImage(deck.canvas, x - w, y + tail, 2 * w, rearDepth,
    x - w, -y - tail, 2 * w, tail);

  plating.resetTransform();
  plating.globalCompositeOperation = 'destination-in';
  plating.drawImage(roofMask.canvas, 0, 0);
  repair.drawImage(plating.canvas, 0, 0);

  // Stamp only the repaired region onto the untouched counter, preserving its text and edges.
  const hull = surface(PX);
  hull.drawImage(image, 0, 0, PX, PX);
  // These long guns reach the lower-right printed armor values. Preserve the
  // original pixels (including their antialiasing) in native counter coordinates.
  if (detail?.textLeft !== undefined) {
    hull.beginPath();
    hull.rect(0, 0, PX, PX);
    hull.rect(detail.textLeft, 149, PX - detail.textLeft, PX - 149);
    hull.clip('evenodd');
  }
  hull.translate(90, 90);
  hull.rotate(angle);
  hull.drawImage(repair.canvas, -90, -90);
  // Convert upright measurements into counter coordinates for placement on the board.
  const onCounter = (px: number, py: number) => ({
    x: (90 + (px - 90) * Math.cos(angle) - (py - 90) * Math.sin(angle)) / 3,
    y: (90 + (px - 90) * Math.sin(angle) + (py - 90) * Math.cos(angle)) / 3,
  });
  const layers = {
    hullCenter: onCounter(hullX, hullY),
    roofWidth: 2 * w / 3,
    stock: (sample[0]! << 16) | (sample[1]! << 8) | sample[2]!,
    hull: Texture.from(hull.canvas), turret: Texture.from(turret.canvas),
    ...onCounter(x, y),
    size: turret.canvas.width / 3,
  };
  cache.set(front, layers);
  return layers;
}

export const STOCK_COLOR: Record<string, number> = { ge: 0x9ac8e8, ru: 0xc8a050, am: 0x9fbf5f, br: 0xe5cea0, al: 0xbfe3c4, it: 0xd2d6d8 };

export function turretMarkerSprite(texture: Texture, size: number, openTopped: boolean, nationality: string, layers: Pick<Layers, 'roofWidth' | 'stock'> | null, frontUrl: string | null) {
  const printedWidth = layers?.roofWidth ?? size * 0.22;
  const width = openTopped ? Math.max(printedWidth, size * 0.19) : printedWidth;
  const unit = width / 60; // Board pixels per unit of the 144-unit marker drawing.
  const profile = profiles[frontUrl?.split('/').pop()?.replace(/\.webp$/, '') ?? ''];
  // Both SVGs have their muzzle at y=0, mantlet at 46 and rotation pivot at 94.
  // The counter measurements use a 180 px face with the gun pointing straight up.
  let barrel = 46 * unit;
  if (profile) {
    const [pivotX, pivotY, , nose, , muzzleX, muzzleY] = profile;
    barrel = Math.hypot(muzzleX - pivotX, pivotY - nose - muzzleY) * size / PX;
  }
  // Keep short guns readable at board scale; the facing-specific edge cap still applies.
  barrel = Math.max(barrel, size * 0.1875);
  const imageScale = texture.height / 144;
  const height = barrel / unit + 98;
  const art = new NineSliceSprite({
    texture, width: texture.width, height: height * imageScale,
    leftWidth: 0, rightWidth: 0, topHeight: 4 * imageScale, bottomHeight: 98 * imageScale,
  });
  art.anchor.set(70 / 144, 1 - 50 / height);
  art.scale.set(unit / imageScale);
  if (!openTopped) art.tint = layers?.stock ?? STOCK_COLOR[nationality] ?? 0xd9cfb9;
  // Work in the counter's unrotated coordinates so the margin follows its edges.
  function fitBarrel(angle: number, x: number, y: number) {
    const dx = Math.sin(angle);
    const dy = -Math.cos(angle);
    const margin = size * 0.05;
    // Include both sides of the tube when finding the first edge the muzzle reaches.
    const halfWidth = 12 * unit; // Includes the wider tube and its outline.
    const roomX = (dx >= 0 ? size - x : x) - margin - halfWidth * Math.abs(dy);
    const roomY = (dy >= 0 ? size - y : y) - margin - halfWidth * Math.abs(dx);
    const reach = Math.min(
      Math.abs(dx) > 1e-8 ? roomX / Math.abs(dx) : Infinity,
      Math.abs(dy) > 1e-8 ? roomY / Math.abs(dy) : Infinity,
    );
    const fitted = Math.min(barrel, Math.max(4 * unit, reach - 48 * unit));
    const fittedHeight = 98 + fitted / unit;
    art.height = fittedHeight * imageScale;
    art.anchor.y = 1 - 50 / fittedHeight;
  }
  return { art, fitBarrel };
}
