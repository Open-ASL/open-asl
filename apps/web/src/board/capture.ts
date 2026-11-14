import { Rectangle, type Application } from 'pixi.js';

/** The board on screen, if one is: the map as the viewer sees it now, without the panels drawn over it. */
let current: Application | null = null;

/** BoardView: this app is the board on screen. */
export function setCaptureSource(app: Application) {
  current = app;
}

/** BoardView: this app is going away. */
export function releaseCaptureSource(app: Application) {
  if (current === app) current = null;
}

/**
 * A JPEG of the board exactly as it is in view (pan, zoom, rotation, markers), scaled down to at most `maxWidth`
 * pixels wide; null when no board is showing. The canvas is redrawn off screen for it, since a WebGL canvas keeps
 * no picture between frames.
 */
export async function captureBoard({ maxWidth = 1600, quality = 0.85, background = '#20231f' } = {}): Promise<Blob | null> {
  const app = current;
  if (!app) return null;
  const { width, height } = app.screen;
  if (width < 1 || height < 1) return null;
  const shot = app.renderer.extract.canvas({ target: app.stage, frame: new Rectangle(0, 0, width, height), resolution: 1 }) as HTMLCanvasElement;
  const k = Math.min(1, maxWidth / width);
  const out = document.createElement('canvas');
  out.width = Math.round(width * k);
  out.height = Math.round(height * k);
  const g = out.getContext('2d');
  if (!g) return null;
  // The board's canvas is transparent where there is no map.
  g.fillStyle = background;
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(shot, 0, 0, out.width, out.height);
  return new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/jpeg', quality));
}
