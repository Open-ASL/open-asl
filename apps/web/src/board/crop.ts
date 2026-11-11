import { GEO, columnIndex } from '@asl/rules';

/** A board as placed on the map, with the part of it the scenario plays on. */
export interface CropPlacement {
  board: string;
  x: number;
  y: number;
  /** Playable hexrows; the board art outside them is cropped. */
  columns?: [string, string];
  /** Playable hex numbers ("numbered ≤ 6"); the board art outside them is cropped. */
  rows?: [number, number];
  /** The board turned 180° in place (its art drawn upside down). */
  rotation?: 0 | 180;
}

/** A pixel rectangle in board coordinates. */
export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Pixel rectangle of a placement's playable hexes on the board art as printed: the cut hexrows' and
 * hex numbers' art is left out, a little of the neighbouring hexes kept so the edge hexes are whole.
 */
export function printedRect(p: CropPlacement): Rect {
  const { width: W, height: H, hexWidth, hexHeight } = GEO.px;
  let x0: number = 0;
  let x1: number = W;
  if (p.columns) {
    const rx = hexWidth * (2 / 3);
    const [a, b] = p.columns.map(columnIndex) as [number, number];
    x0 = Math.max(0, hexWidth * a - rx);
    x1 = Math.min(W, hexWidth * b + rx);
  }
  // Row n's centre is n hex heights down in an odd hexrow, half a hex higher in an even one.
  const y0 = p.rows ? Math.max(0, hexHeight * (p.rows[0] - 1)) : 0;
  const y1: number = p.rows ? Math.min(H, hexHeight * p.rows[1] + hexHeight / 2) : H;
  return { x0, x1, y0, y1 };
}

/** The same rectangle as placed on its board: a turned board's is mirrored both ways. */
export function playableRect(p: CropPlacement): Rect {
  const r = printedRect(p);
  if (p.rotation !== 180) return r;
  const { width: W, height: H } = GEO.px;
  return { x0: W - r.x1, x1: W - r.x0, y0: H - r.y1, y1: H - r.y0 };
}

/** Map pixel bounds of all placements' playable parts. */
export function playableBounds(placements: CropPlacement[]): Rect {
  const { width: W, height: H } = GEO.px;
  const rects = placements.map((p) => ({ p, r: playableRect(p) }));
  return {
    x0: Math.min(...rects.map(({ p, r }) => p.x * W + r.x0)),
    x1: Math.max(...rects.map(({ p, r }) => p.x * W + r.x1)),
    y0: Math.min(...rects.map(({ p, r }) => p.y * H + r.y0)),
    y1: Math.max(...rects.map(({ p, r }) => p.y * H + r.y1)),
  };
}

/**
 * Draw a placement's playable art onto a 2D canvas in map pixels (`img` at any multiple of the
 * VASL geometry). A turned board is drawn upside down with its crop's far corner pinned where
 * the turned board's near corner lands.
 */
export function drawPlacementArt(ctx: CanvasRenderingContext2D, img: HTMLImageElement, p: CropPlacement) {
  const { width: W, height: H } = GEO.px;
  const src = printedRect(p);
  const at = playableRect(p);
  const w = src.x1 - src.x0;
  const h = src.y1 - src.y0;
  const sx = img.naturalWidth / W;
  const sy = img.naturalHeight / H;
  ctx.save();
  if (p.rotation === 180) {
    ctx.translate(p.x * W + at.x0 + w, p.y * H + at.y0 + h);
    ctx.rotate(Math.PI);
    ctx.drawImage(img, src.x0 * sx, src.y0 * sy, w * sx, h * sy, 0, 0, w, h);
  } else {
    ctx.drawImage(img, src.x0 * sx, src.y0 * sy, w * sx, h * sy, p.x * W + src.x0, p.y * H + src.y0, w, h);
  }
  ctx.restore();
}
