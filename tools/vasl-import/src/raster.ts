import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

export interface SvgSource {
  /** Read a file from the module's images/ directory (relative path). */
  read(path: string): Uint8Array | undefined;
  fontFiles: string[];
}

export interface RasterOptions {
  /** Replacement art for an embedded image, by its href as written in the SVG (`svg/ge467S.png`). */
  imageOverride?(href: string): { data: Uint8Array; mime: string } | undefined;
  /** Rewrite the SVG before rendering (e.g. tools/counter-art's background polish). */
  transformSvg?(svg: string): string;
  /** Output encoding: lossless WebP (the default), lossy WebP at this quality, or PNG. */
  format?: { webp: 'lossless' } | { webp: number } | 'png';
}

/** Rasterize a VASL counter SVG (48×48) at `scale`, resolving embedded silhouette PNGs. */
export async function rasterizeCounter(svg: string, dir: string, src: SvgSource, scale = 3, opts: RasterOptions = {}): Promise<Buffer> {
  // Drop @font-face rules (fonts are supplied to resvg directly).
  let cleaned = svg.replace(/@font-face\s*\{[^}]*\}/g, '');
  if (opts.transformSvg) cleaned = opts.transformSvg(cleaned);
  // Inline the silhouettes. VASL counter SVGs reference them by relative path
  // (`<image href="svg/ge467S.png">`), which resvg cannot resolve from an in-memory
  // string and silently skips, leaving a counter with numbers but no artwork.
  cleaned = cleaned.replace(/(xlink:href|href)="([^"]+\.(png|gif|jpe?g))"/g, (m, attr: string, href: string, ext: string) => {
    const over = opts.imageOverride?.(href);
    if (over) return `${attr}="data:${over.mime};base64,${Buffer.from(over.data).toString('base64')}"`;
    const data = src.read(`${dir}/${href.replace(/^\.\//, "")}`) ?? src.read(href.replace(/^\.\//, ""));
    if (!data) {
      console.log(`  warn: missing embedded image ${dir}/${href}`);
      return m;
    }
    const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
    return `${attr}="data:${mime};base64,${Buffer.from(data).toString('base64')}"`;
  });
  const r = new Resvg(cleaned, {
    fitTo: { mode: 'zoom', value: scale },
    font: { fontFiles: src.fontFiles, loadSystemFonts: false, defaultFontFamily: 'Nimbus Sans L' },
  });
  for (const href of r.imagesToResolve()) {
    const data = src.read(`${dir}/${href.replace(/^\.\//, "")}`) ?? src.read(href.replace(/^\.\//, ""));
    if (data) r.resolveImage(href, Buffer.from(data));
  }
  const png = r.render().asPng();
  const format = opts.format ?? { webp: 'lossless' };
  if (format === 'png') return png;
  return sharp(png).webp(format.webp === 'lossless' ? { lossless: true } : { quality: format.webp, alphaQuality: 100, smartSubsample: true }).toBuffer();
}

export async function toWebp(data: Uint8Array, opts: { lossless?: boolean; quality?: number } = {}): Promise<Buffer> {
  return sharp(Buffer.from(data)).webp(opts.lossless ? { lossless: true } : { quality: opts.quality ?? 90 }).toBuffer();
}

/**
 * The Starter Kit Cave counter (S70 SSR 2: "CAVE", the cave drawing, "+2 TEM"; its back "Open Ground"), 144 px square.
 * VASL has only the full ASL Cave counters, which print G11's +4 TEM and a Covered Arc arrow, so the drawing is taken
 * from VASL's ML/Cave.gif (its top half) and the card's text set around it.
 */
export async function skCaveMarker(caveGif: Uint8Array, side: 'front' | 'back'): Promise<Buffer> {
  const S = 144;
  const text = (y: number, size: number, s: string) => `<text x="${S / 2}" y="${y}" font-family="Noto Sans, Liberation Sans, sans-serif" font-weight="bold" font-size="${size}" fill="#1a1a1a" text-anchor="middle">${s}</text>`;
  const face = side === 'front' ? text(28, 22, 'CAVE') + text(132, 24, '+2 TEM') : text(66, 24, 'Open') + text(98, 24, 'Ground');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect x="2" y="2" width="${S - 4}" height="${S - 4}" rx="10" fill="#d9c9a3" stroke="#2a2116" stroke-width="3"/>${face}</svg>`;
  const base = sharp(Buffer.from(svg));
  if (side === 'back') return base.webp({ lossless: true }).toBuffer();
  const pic = await sharp(Buffer.from(caveGif)).extract({ left: 0, top: 0, width: 60, height: 28 }).resize(102, 48, { kernel: 'nearest' }).png().toBuffer();
  return base.composite([{ input: pic, left: (S - 102) / 2, top: 48 }]).webp({ lossless: true }).toBuffer();
}
