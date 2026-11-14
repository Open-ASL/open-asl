/**
 * Decodes a VASL board's LOSData and derives:
 *  - per-hex terrain/features from the whole hex, not its center pixel (see `deriveBoard`),
 *  - road hexsides (a road crossing the hexside anywhere along it, or road at its midpoint),
 *  - building groupings (connected building pixels),
 *  - the per-pixel terrain raster used for pixel-accurate LOS.
 *
 * Format (VASL BoardArchive.writeLOSData): gzip → Java ObjectOutputStream block
 * data → big-endian: int32 widthHexes, heightHexes, gridW, gridH; then for x in
 * [0,gridW), y in [0,gridH) (column-major): int8 elevation, uint8 terrain code.
 */
import { gunzipSync } from 'node:zlib';
import { GEO, columnLabel } from '@asl/rules';

export interface LosGrid {
  widthHexes: number;
  heightHexes: number;
  w: number;
  h: number;
  /** Terrain code per pixel, row-major (y * w + x) for convenient sampling. */
  terrain: Uint8Array;
  /** Full-level elevation per pixel (same layout); all zero on a flat board. */
  elevation: Int8Array;
  hasHills: boolean;
}

export function decodeLosData(raw: Uint8Array): LosGrid {
  const d = gunzipSync(raw);
  if (d[0] !== 0xac || d[1] !== 0xed) throw new Error('LOSData: not a Java serialization stream');
  const chunks: Uint8Array[] = [];
  let i = 4;
  while (i < d.length) {
    const tag = d[i]!;
    if (tag === 0x7a) {
      const n = d.readInt32BE(i + 1);
      chunks.push(d.subarray(i + 5, i + 5 + n));
      i += 5 + n;
    } else if (tag === 0x77) {
      const n = d[i + 1]!;
      chunks.push(d.subarray(i + 2, i + 2 + n));
      i += 2 + n;
    } else {
      break;
    }
  }
  const payload = Buffer.concat(chunks);
  const widthHexes = payload.readInt32BE(0);
  const heightHexes = payload.readInt32BE(4);
  const w = payload.readInt32BE(8);
  const h = payload.readInt32BE(12);
  const terrain = new Uint8Array(w * h);
  const elevation = new Int8Array(w * h);
  let hasHills = false;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const e = payload.readInt8(16 + (x * h + y) * 2);
      elevation[y * w + x] = e;
      if (e !== 0) hasHills = true;
      terrain[y * w + x] = payload[16 + (x * h + y) * 2 + 1]!;
    }
  }
  return { widthHexes, heightHexes, w, h, terrain, elevation, hasHills };
}

/** VASL terrain codes (SharedBoardMetadata.xml) relevant to SK boards. */
export const CODES = {
  open: 0,
  grain: 24,
  brush: 25,
  stone: 40,
  stone1: 41,
  wood: 50,
  wood1: 51,
  woods: 60,
  forest: 61,
  orchard: 63,
  orchardOut: 64,
  dirtRoad: 65,
  pavedRoad: 66,
  multipleWood: 203,
  multipleStone: 206,
} as const;

const BUILDING = new Set<number>([CODES.stone, CODES.stone1, CODES.wood, CODES.wood1, CODES.multipleWood, CODES.multipleStone]);
const ROAD = new Set<number>([CODES.dirtRoad, CODES.pavedRoad]);

/** Map a VASL code to our terrain id (SK1). Unknown codes fall back to open ground with a warning. */
export function terrainIdFor(code: number): string | null {
  switch (code) {
    case CODES.open:
    case CODES.dirtRoad:
    case CODES.pavedRoad:
      return 'open';
    case CODES.grain:
      return 'grain';
    case CODES.stone:
    case CODES.stone1:
    case CODES.multipleStone:
      return 'building-stone';
    case CODES.wood:
    case CODES.wood1:
    case CODES.multipleWood:
      return 'building-wood';
    case CODES.woods:
    case CODES.forest:
      return 'woods';
    case CODES.brush:
      return 'brush';
    case CODES.orchard:
      return 'orchard';
    case CODES.orchardOut:
      return 'open';
    default:
      return null;
  }
}

/** Pixel center of a hex on a single GEO board (VASL Map.java geometry). */
export function hexCenter(col: number, n: number): { x: number; y: number } {
  const { hexWidth, hexHeight, width } = GEO.px;
  const x = Math.min(hexWidth * col, width - 1);
  const y = col % 2 === 0 ? hexHeight * n - hexHeight / 2 : hexHeight * n;
  return { x, y };
}

export interface BoardHex {
  terrain: string;
  features?: string[];
  buildingId?: string;
  /** Full-level elevation at the hex centre (SK4 1.1.1: a hex is at the level of its center dot); absent at ground level. */
  elevation?: number;
  /**
   * Wooden building hexes only: how many separate building depictions (connected components of building art with
   * at least `HUT_MIN_PX` px in the hex) the hex holds, and whether any of them continues into another hex. SK4 8.2
   * makes "each wooden building whose hex contains at least two separate buildings, but no partial building
   * depiction" a hut under PTO Terrain (EX: oY5); the map transform reads these two fields.
   */
  buildings?: number;
  partialBuilding?: true;
}

export interface BoardData {
  board: string;
  hexes: Record<string, BoardHex>;
  roadHexsides: [string, string][];
  warnings: string[];
  /** Close calls to check against the board art: little building art, or no terrain clearly dominant. */
  review: string[];
}

const at = (g: LosGrid, x: number, y: number) => {
  const xi = Math.max(0, Math.min(g.w - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(g.h - 1, Math.round(y)));
  return g.terrain[yi * g.w + xi]!;
};

/**
 * Building art in a hex, in px, from which it is a building hex: "Any hex containing one or more ...
 * building depictions is a building hex—even if the hex center dot does not touch that building
 * depiction" (ASLRB B23.1). Art spilling over a hexside (B.1) is a few px on the SK boards; the
 * smallest building that misses the center dot is over 500 px of a hex's ~3600.
 */
const BUILDING_MIN_PX = 100;
/** A building depiction counts as one of a hex's separate buildings (huts, SK4 8.2) from this many px of its art in the hex. */
const HUT_MIN_PX = 60;
/** A depiction with more than this many px outside the hex is a partial (multi-hex) building there. */
const PARTIAL_PX = 10;
/** Share of the hex a woods/brush/orchard/grain depiction must cover to be its dominant terrain (ASLRB B.1). */
const DOMINANT_SHARE = 0.5;
/**
 * The raster dithers grain: its stalk lines are coded Open Ground, so a third of the pixels of a solid field
 * read open. A pixel is in the grain area when this share of the window (± `GRAIN_WINDOW` px) around it is grain.
 */
const GRAIN_AREA_SHARE = 0.35;
const GRAIN_WINDOW = 3;

type AreaKind = 'building' | 'woods' | 'brush' | 'orchard' | 'grain' | 'open';
const AREA_TERRAIN: Record<Exclude<AreaKind, 'building' | 'open'>, string> = { woods: 'woods', brush: 'brush', orchard: 'orchard', grain: 'grain' };

/** What a hex holds: px per kind of terrain, building px per material and per connected building. */
interface HexCover {
  px: number;
  kind: Record<AreaKind, number>;
  stone: number;
  wood: number;
  buildings: Map<number, number>;
}

/** Is each pixel in the grain area? Undoes the raster's dithering with a box filter. */
function grainArea(g: LosGrid): Uint8Array {
  const W = g.w + 1;
  const sum = new Int32Array(W * (g.h + 1));
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const v = g.terrain[y * g.w + x] === CODES.grain ? 1 : 0;
      sum[(y + 1) * W + x + 1] = v + sum[y * W + x + 1]! + sum[(y + 1) * W + x]! - sum[y * W + x]!;
    }
  }
  const out = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) {
    const y0 = Math.max(0, y - GRAIN_WINDOW);
    const y1 = Math.min(g.h, y + GRAIN_WINDOW + 1);
    for (let x = 0; x < g.w; x++) {
      const x0 = Math.max(0, x - GRAIN_WINDOW);
      const x1 = Math.min(g.w, x + GRAIN_WINDOW + 1);
      const n = sum[y1 * W + x1]! - sum[y0 * W + x1]! - sum[y1 * W + x0]! + sum[y0 * W + x0]!;
      out[y * g.w + x] = n / ((x1 - x0) * (y1 - y0)) >= GRAIN_AREA_SHARE ? 1 : 0;
    }
  }
  return out;
}

function areaKind(code: number, inGrain: boolean): AreaKind {
  if (BUILDING.has(code)) return 'building';
  if (code === CODES.woods || code === CODES.forest) return 'woods';
  if (code === CODES.brush) return 'brush';
  if (code === CODES.orchard) return 'orchard';
  return inGrain ? 'grain' : 'open';
}

export function deriveBoard(board: string, g: LosGrid): BoardData {
  const warnings: string[] = [];
  const review: string[] = [];
  const hexes: Record<string, BoardHex> = {};
  const centers: { id: string; col: number; n: number; x: number; y: number }[] = [];
  const byPos = new Map<string, number>();
  for (let col = 0; col < GEO.columns; col++) {
    const first = col % 2 === 0 ? 1 : 0;
    for (let n = first; n <= GEO.rows; n++) {
      const { x, y } = hexCenter(col, n);
      byPos.set(`${col},${n}`, centers.length);
      centers.push({ id: `${board}${columnLabel(col)}${n}`, col, n, x, y });
    }
  }

  // Building components (4-connected flood fill over building pixels), with each component's size in px.
  const comp = new Int32Array(g.w * g.h).fill(-1);
  const compPx: number[] = [];
  let nComp = 0;
  for (let p = 0; p < g.terrain.length; p++) {
    if (comp[p] !== -1 || !BUILDING.has(g.terrain[p]!)) continue;
    const stack = [p];
    comp[p] = nComp;
    let size = 1;
    while (stack.length) {
      const q = stack.pop()!;
      const qx = q % g.w;
      const qy = (q / g.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = qx + dx;
        const ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        const r = ny * g.w + nx;
        if (comp[r] === -1 && BUILDING.has(g.terrain[r]!)) {
          comp[r] = nComp;
          size++;
          stack.push(r);
        }
      }
    }
    compPx.push(size);
    nComp++;
  }

  // Every pixel belongs to the hex with the nearest center: tally what each whole hex holds.
  const grain = grainArea(g);
  const cover: HexCover[] = centers.map(() => ({ px: 0, kind: { building: 0, woods: 0, brush: 0, orchard: 0, grain: 0, open: 0 }, stone: 0, wood: 0, buildings: new Map() }));
  const { hexWidth, hexHeight } = GEO.px;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      let best = -1;
      let bestD = Infinity;
      const col0 = Math.round(x / hexWidth);
      for (let col = col0 - 1; col <= col0 + 1; col++) {
        const n0 = Math.round(col % 2 === 0 ? (y + hexHeight / 2) / hexHeight : y / hexHeight);
        for (let n = n0 - 1; n <= n0 + 1; n++) {
          const i = byPos.get(`${col},${n}`);
          if (i === undefined) continue;
          const d = (centers[i]!.x - x) ** 2 + (centers[i]!.y - y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      if (best < 0) continue;
      const p = y * g.w + x;
      const code = g.terrain[p]!;
      const c = cover[best]!;
      c.px++;
      c.kind[areaKind(code, grain[p] === 1)]++;
      if (BUILDING.has(code)) {
        if (code === CODES.stone || code === CODES.stone1 || code === CODES.multipleStone) c.stone++;
        else c.wood++;
        c.buildings.set(comp[p]!, (c.buildings.get(comp[p]!) ?? 0) + 1);
      }
    }
  }

  // Building ids are kept in recordings (fortified buildings, Control), so they must not move when the
  // classification improves: number the buildings the old center-pixel probe found first, in the old
  // order, and only then any building found only by looking at the whole hex.
  const probed = centers.map((c) => {
    for (const [dx, dy] of [[1, -1], [5, 0], [-5, 0], [0, 5], [0, -5]] as const) {
      if (!BUILDING.has(at(g, c.x + dx, c.y + dy))) continue;
      return comp[Math.round(c.y + dy) * g.w + Math.round(c.x + dx)] ?? -1;
    }
    return -1;
  });

  const buildingOf: number[] = [];
  centers.forEach((c, i) => {
    const cov = cover[i]!;
    const code = at(g, c.x + 1, c.y - 1);
    const features: string[] = [];
    if (code === CODES.dirtRoad) features.push('road:dirt');
    if (code === CODES.pavedRoad) features.push('road:paved');
    let terrain: string;
    let building = -1;
    if (cov.kind.building >= BUILDING_MIN_PX) {
      // B23.1: any building in the hex makes it a building hex, of the material that has most of it.
      terrain = cov.stone >= cov.wood ? 'building-stone' : 'building-wood';
      building = probed[i]! >= 0 ? probed[i]! : [...cov.buildings].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
      if (cov.kind.building < 3 * BUILDING_MIN_PX) review.push(`${c.id}: ${terrain} from ${cov.kind.building} px of building art`);
    } else if (ROAD.has(code) && countInHex(g, c.x, c.y, CODES.woods) > 150) {
      // Woods-Road: road at the center with woods depicted within the hex.
      terrain = 'woods';
      features.push('woods-road');
    } else if (ROAD.has(code) && countInHex(g, c.x, c.y, CODES.orchard) > 150) {
      // Orchard-Road (SK4 1.1.1): a tree-lined road; the hex is an orchard entered at the road rate via a road hexside.
      terrain = 'orchard';
      features.push('orchard-road');
    } else {
      // B.1: the hex is governed by the terrain that dominates it; when none covers half of it, by the
      // terrain at the center dot ("usually, the dominant terrain type includes the hex center dot").
      const areas = (Object.keys(AREA_TERRAIN) as (keyof typeof AREA_TERRAIN)[]).sort((a, b) => cov.kind[b] - cov.kind[a]);
      const top = areas[0]!;
      const share = cov.px > 0 ? cov.kind[top] / cov.px : 0;
      if (share >= DOMINANT_SHARE) terrain = AREA_TERRAIN[top];
      else {
        const cx = Math.max(0, Math.min(g.w - 1, Math.round(c.x + 1)));
        const cy = Math.max(0, Math.min(g.h - 1, Math.round(c.y - 1)));
        const kind = areaKind(code, grain[cy * g.w + cx] === 1);
        if (terrainIdFor(code) === null) warnings.push(`${c.id}: unknown terrain code ${code}`);
        terrain = kind === 'open' || kind === 'building' ? 'open' : AREA_TERRAIN[kind];
        if (share >= 0.3 && terrain !== AREA_TERRAIN[top]) review.push(`${c.id}: ${terrain} from the center dot, though ${top} covers ${Math.round(share * 100)}%`);
      }
    }
    if (building < 0 && cov.kind.building > 10) review.push(`${c.id}: ${cov.kind.building} px of building art, below the ${BUILDING_MIN_PX} px of a building hex`);
    const hex: BoardHex = { terrain };
    if (features.length) hex.features = features;
    if (terrain === 'building-wood') {
      // Separate depictions in the hex, and whether one of them is part of a larger (multi-hex) building.
      const parts = [...cov.buildings].filter(([, px]) => px >= HUT_MIN_PX);
      hex.buildings = parts.length;
      if (parts.some(([k, px]) => compPx[k]! - px > PARTIAL_PX)) hex.partialBuilding = true;
    }
    const elevation = g.elevation[Math.round(c.y - 1) * g.w + Math.round(c.x + 1)] ?? 0;
    if (elevation !== 0) hex.elevation = elevation;
    buildingOf[i] = building;
    hexes[c.id] = hex;
  });

  const rename = new Map<number, string>();
  const number = (k: number) => {
    if (k >= 0 && !rename.has(k)) rename.set(k, `${board}-B${rename.size + 1}`);
  };
  centers.forEach((_, i) => number(probed[i]!));
  centers.forEach((_, i) => number(buildingOf[i]!));
  centers.forEach((c, i) => {
    if (buildingOf[i]! >= 0) hexes[c.id]!.buildingId = rename.get(buildingOf[i]!)!;
  });

  // Road hexsides: road pixels at the midpoint between adjacent hex centers, or a road crossing the hexside
  // elsewhere along it. A road that bends or meets a hexside off its middle is still a road across it (board v
  // FF5: its road runs off the hex center and crosses EE5|FF5 and FF5|GG5 away from their midpoints).
  const roadHexsides: [string, string][] = [];
  for (const c of centers) {
    const neigh = neighborsOf(c.col, c.n);
    for (const [nc, nn] of neigh) {
      const oi = byPos.get(`${nc},${nn}`);
      const o = oi === undefined ? undefined : centers[oi];
      if (!o || o.id < c.id) continue;
      const mx = (c.x + o.x) / 2;
      const my = (c.y + o.y) / 2;
      if (ROAD.has(at(g, mx, my)) || roadCrosses(g, c, o)) roadHexsides.push([c.id, o.id]);
    }
  }
  // A hex on a road hexside is made a road hex when the map is built (`fillRoadHexes` in @asl/content), whatever
  // its center pixel shows.
  return { board, hexes, roadHexsides, warnings, review };
}

/**
 * Whether a road crosses the hexside between hex centers `a` and `o`: road art on the hexside, and just inside
 * both hexes, at two or more points along its middle 80% (a road running beside the hexside, or touching it at a
 * vertex, does not cross it).
 */
function roadCrosses(g: LosGrid, a: { x: number; y: number }, o: { x: number; y: number }): boolean {
  const mx = (a.x + o.x) / 2;
  const my = (a.y + o.y) / 2;
  const len = Math.hypot(o.x - a.x, o.y - a.y);
  const ux = (o.x - a.x) / len;
  const uy = (o.y - a.y) / len;
  const side = GEO.px.hexHeight / Math.sqrt(3);
  let n = 0;
  for (let t = -0.4 * side; t <= 0.4 * side; t++) {
    const x = mx - uy * t;
    const y = my + ux * t;
    if (ROAD.has(at(g, x, y)) && ROAD.has(at(g, x - 4 * ux, y - 4 * uy)) && ROAD.has(at(g, x + 4 * ux, y + 4 * uy)) && ++n >= 2) return true;
  }
  return false;
}

/** Same-board neighbours in (col, n) coordinates; odd columns sit half a hex lower. */
function neighborsOf(col: number, n: number): [number, number][] {
  const odd = col % 2 === 1;
  return [
    [col, n - 1],
    [col, n + 1],
    [col - 1, odd ? n : n - 1],
    [col - 1, odd ? n + 1 : n],
    [col + 1, odd ? n : n - 1],
    [col + 1, odd ? n + 1 : n],
  ];
}

function countInHex(g: LosGrid, cx: number, cy: number, code: number): number {
  let n = 0;
  const r = 26;
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
      if (g.terrain[y * g.w + x] === code) n++;
    }
  }
  return n;
}
