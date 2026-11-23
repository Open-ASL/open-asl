import type { Graphics } from 'pixi.js';

/** A stroke of ink drawn on the map, in map pixels (the board's own coordinates: it stays put through pan, zoom and turn). */
export interface InkStroke {
  id: string;
  color: number;
  /** Line width in map pixels. */
  width: number;
  /** x0, y0, x1, y1, … */
  points: number[];
}

type ToView = (x: number, y: number) => { x: number; y: number };

/** Draw strokes into `g` (cleared first), each a round-capped polyline; a single point is a dot. */
export function drawInk(g: Graphics, strokes: readonly InkStroke[], toView: ToView) {
  g.clear();
  for (const s of strokes) drawStroke(g, s, toView);
}

export function drawStroke(g: Graphics, s: Pick<InkStroke, 'color' | 'width' | 'points'>, toView: ToView) {
  if (s.points.length < 2) return;
  const first = toView(s.points[0]!, s.points[1]!);
  if (s.points.length < 4) {
    g.circle(first.x, first.y, s.width / 2).fill({ color: s.color });
    return;
  }
  // A dark halo under the colour, so the line reads on light and dark terrain alike.
  for (const [color, width, alpha] of [[0x000000, s.width + 3, 0.35], [s.color, s.width, 1]] as const) {
    g.moveTo(first.x, first.y);
    for (let i = 2; i + 1 < s.points.length; i += 2) {
      const p = toView(s.points[i]!, s.points[i + 1]!);
      g.lineTo(p.x, p.y);
    }
    g.stroke({ color, width, alpha, cap: 'round', join: 'round' });
  }
}
