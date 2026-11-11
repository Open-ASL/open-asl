import { useEffect, useRef } from 'react';
import type { HexId, QueryEnv } from '@asl/engine';
import { GEO, hexPixel } from '@asl/rules';
import { drawPlacementArt, playableRect, type CropPlacement } from './crop';
import { boardImage } from '../game/assets';

export type ArtPlacement = CropPlacement;

const images = new Map<string, Promise<HTMLImageElement | null>>();
const load = (url: string) => {
  let p = images.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
};

interface Props {
  env: QueryEnv;
  hex: HexId;
  placements: ArtPlacement[];
  /** Clockwise view rotation in degrees, so the hex is shown the way it lies on screen. */
  rotation: number;
  /** Canvas size in CSS pixels. */
  size?: number;
}

/**
 * The hex as printed on the board: its artwork cut out along the hex outline and turned with
 * the view, so a player can see the terrain under a stack without lifting the counters.
 */
export function HexArt({ env, hex, placements, rotation, size = 76 }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const map = (env.statics as { map: { hex(id: HexId): { cube: Parameters<typeof hexPixel>[0] } | undefined } }).map;
    const h = map.hex(hex);
    const el = canvas.current;
    if (!h || !el) return;
    const { x: mx, y: my } = hexPixel(h.cube);
    const { width: W, height: H } = GEO.px;
    // The placement the hex lies on (a hex on the seam of two half-boards is drawn by both).
    const under = placements.filter((p) => {
      const r = playableRect(p);
      return mx >= p.x * W + r.x0 - 1 && mx <= p.x * W + r.x1 + 1 && my >= p.y * H + r.y0 - 1 && my <= p.y * H + r.y1 + 1;
    });
    let live = true;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(size * dpr);
    el.height = Math.round(size * dpr);
    const ctx = el.getContext('2d');
    if (!ctx) return;
    (async () => {
      const imgs = await Promise.all(under.map((p) => (boardImage(p.board) ? load(boardImage(p.board)!) : Promise.resolve(null))));
      if (!live) return;
      const rx = GEO.px.hexWidth * (2 / 3);
      const ry = GEO.px.hexHeight / 2;
      // Fill the canvas with the hex (its corner-to-corner width is the longer measure).
      const k = (size * dpr * 0.94) / (2 * rx);
      ctx.save();
      ctx.clearRect(0, 0, el.width, el.height);
      ctx.translate(el.width / 2, el.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(k, k);
      ctx.translate(-mx, -my);
      const pts = [mx - rx, my, mx - rx / 2, my - ry, mx + rx / 2, my - ry, mx + rx, my, mx + rx / 2, my + ry, mx - rx / 2, my + ry];
      ctx.beginPath();
      ctx.moveTo(pts[0]!, pts[1]!);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
      ctx.closePath();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#1a1f1a';
      ctx.fillRect(mx - 2 * rx, my - 2 * ry, 4 * rx, 4 * ry);
      under.forEach((p, i) => {
        const img = imgs[i];
        if (!img) return;
        drawPlacementArt(ctx, img, p);
      });
      ctx.restore();
      ctx.lineWidth = 1.5 / k;
      ctx.strokeStyle = 'rgba(201, 162, 74, 0.9)';
      ctx.stroke();
      ctx.restore();
    })();
    return () => {
      live = false;
    };
  }, [env, hex, placements, rotation, size]);
  return <canvas ref={canvas} className="hex-art" style={{ width: size, height: size }} aria-hidden="true" />;
}
