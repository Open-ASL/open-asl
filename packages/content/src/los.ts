import { unzlibSync } from 'fflate';
import type { HexId } from '@asl/engine';
import type { HeightObstacle, HexGridMap, LosAtOptions, LosEnd, LosResult, MapHex } from '@asl/rules';
import { blindHexesBehind, GEO, hexPixel as pixelOf, losEndPoint, obstacleEffect, orchardHinders } from '@asl/rules';

/** VASL terrain codes that block LOS / hinder LOS at ground level (SK1 and SK2 terrain). */
const OBSTACLE = new Set([40, 41, 50, 51, 60, 61, 203, 206]);
/**
 * Hindrances that count where the thread crosses their depiction (SK1 1.1.1 grain, SK4 brush: "in
 * which the LOS crosses the ... depiction"). Orchard (63) is not among them: it is Inherent Terrain
 * (SK1 glossary), the whole hex and its hexsides are orchard whatever is drawn under the thread, so
 * it is judged by the hex the thread enters, below, and its tree art spilling into a neighbouring
 * open-ground hex (board y's O5 into N4 and O4) is no hindrance there.
 */
const HINDRANCE = new Set([24, 25]);
const HINDRANCE_ID: Record<number, string> = { 24: 'grain', 25: 'brush' };
/** The VASL codes a printed terrain is drawn with, for an SSR that turns its art into a hindrance. */
const ART_CODES: Record<string, number[]> = { woods: [60, 61], brush: [25], grain: [24], orchard: [63] };
const WOODS = new Set(ART_CODES['woods']);
/** Road art (dirt, paved): an Orchard-Road hex is a tree-lined road, and a thread on these pixels is on its road. */
const ROAD = new Set([65, 66]);
const isOrchardRoad = (h: MapHex) => h.features.includes('orchard-road');
/**
 * Half-pixel steps of other art an Orchard-Road hex must have under the thread before the thread has left its road
 * (SK4 1.1.1 Orchard-Road, ASLRB B14.6: "never leaves the confines of the road depiction"); one step is the road's edge.
 */
const OFF_ROAD_STEPS = 2;

/**
 * Counts, per Orchard-Road hex, the steps of the thread off its road art (SK4 1.1.1 Orchard-Road, ASLRB B14.6). `off(h,
 * code)` is true once the thread has left the road in `h`: a hex that is not an Orchard-Road hex is always "off".
 */
function orchardRoadTracker() {
  const steps = new Map<HexId, number>();
  return (h: MapHex, code: number): boolean => {
    if (!isOrchardRoad(h)) return true;
    if (ROAD.has(code)) return (steps.get(h.id) ?? 0) >= OFF_ROAD_STEPS;
    const n = (steps.get(h.id) ?? 0) + 1;
    steps.set(h.id, n);
    return n >= OFF_ROAD_STEPS;
  };
}
/** A hex feature: the hex's terrain is not Inherent Terrain (SSR "non-inherent Orchards"), only its art hinders. */
export const NON_INHERENT = 'non-inherent';

export interface RasterSource {
  w: number;
  h: number;
  /** base64 deflate of row-major terrain codes. */
  data: string;
  /** base64 deflate of row-major elevation (int8 + 128); only boards with hills carry one. */
  elev?: string;
}

export interface BoardRaster {
  board: string;
  w: number;
  h: number;
  terrain: Uint8Array;
  /** Full-level elevation per pixel; undefined on a flat board. */
  elevation?: Int8Array;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Portable base64 decoder (browser, worker and Node alike). */
function b64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buf = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | B64.indexOf(clean[i]!);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out;
}

export function decodeRaster(board: string, src: RasterSource): BoardRaster {
  const terrain = unzlibSync(b64(src.data));
  if (terrain.length !== src.w * src.h) throw new Error(`LOS raster for ${board} has the wrong size`);
  if (!src.elev) return { board, w: src.w, h: src.h, terrain };
  const raw = unzlibSync(b64(src.elev));
  if (raw.length !== src.w * src.h) throw new Error(`Elevation raster for ${board} has the wrong size`);
  const elevation = new Int8Array(raw.length);
  for (let i = 0; i < raw.length; i++) elevation[i] = raw[i]! - 128;
  return { board, w: src.w, h: src.h, terrain, elevation };
}

export interface PlacedBoard {
  raster: BoardRaster;
  /** Board position in board units and rotation (as in HexGridMap). */
  x: number;
  y: number;
  rotation?: 0 | 180;
}

/** Pixel position of a hex center in assembled-map coordinates (the grid already accounts for board rotation). */
export const hexPixel = (h: MapHex, _placements: PlacedBoard[]): { x: number; y: number } => pixelOf(h.cube);

/**
 * Pixel-accurate LOS in the style of VASL: trace the thread between hex center
 * dots and inspect the terrain under it. Obstacles (woods, buildings) outside the
 * firer's and target's hexes block; hindrance pixels (grain, brush) mark the
 * intervening hex as hindering. Inherent terrain (orchard) is reported for any hex
 * the thread enters, even only along its hexside, and only for such hexes.
 */
/** The Starter Kit's ground-level pixel LOS (see `pixelTracers`). */
export const pixelLos = (...args: Parameters<typeof pixelTracers>) => pixelTracers(...args).los;

/**
 * The pixel tracers of a set of placed boards: `los`, the ground-level LOS every ruleset uses (the Starter Kit's), and
 * `losAt`, the full ASL LOS between heights (ASLRB A6.2, A6.4, B10, B14.2), which `HexGridMap.losAt` calls with the
 * higher end first.
 */
export function pixelTracers(
  placements: PlacedBoard[],
  opts: {
    /**
     * Printed terrain whose depiction is a hindrance of another terrain where the thread crosses it (S17 SSR 1:
     * "Treat all Woods hexes as non-inherent Orchards (i.e., only the actual woods art acts as a +1 hindrance)").
     */
    hinderingArt?: Record<string, string>;
    /**
     * An Inherent obstacle: the whole hex blocks, its hexsides included, whatever is drawn (S18 SSR 1: stone rubble
     * "block[s] LOS as if an inherent building (including along hexsides)").
     */
    inherentObstacle?: (h: MapHex) => boolean;
    /**
     * Printed terrain whose depiction is a hill of that level instead (LMA7 SSR 1: "the fields are in fact hills"): its
     * pixels are ground of that elevation, and the art no longer hinders or blocks as the printed terrain.
     */
    raisedArt?: Record<string, number>;
    /** Printed hindrance art that is an obstacle instead (PTO: brush is bamboo). */
    obstacleArt?: string[];
    /** Printed hindrance art that hinders as another terrain (PTO: grain is kunai). */
    artAs?: Record<string, string>;
    /** Inherent Hindrance terrain: it hinders whenever the thread enters the hex (orchard by default; PTO palm trees). */
    inherentHindrance?: (h: MapHex) => boolean;
    /** Terrain whose building depiction hinders, once, instead of blocking (PTO huts, SK4 8.2.1). */
    artHindrance?: (h: MapHex) => boolean;
    /** Terrain that blocks a LOS between hexes at different levels (PTO palm trees), a Hindrance to one on a level. */
    obstacleBetweenLevels?: (h: MapHex) => boolean;
    /** A hex's obstacle height in levels (`MapHex.obstacleHeight`, else its terrain's), for `losAt`; one when absent. */
    heightOf?: (h: MapHex) => number;
  } = {},
) {
  const { width, height } = GEO.px;
  const obstacle = new Set(OBSTACLE);
  const hindrance = new Set(HINDRANCE);
  const hindranceId: Record<number, string> = { ...HINDRANCE_ID };
  for (const printed of opts.obstacleArt ?? []) {
    for (const code of ART_CODES[printed] ?? []) {
      hindrance.delete(code);
      obstacle.add(code);
    }
  }
  for (const [printed, as] of Object.entries(opts.artAs ?? {})) for (const code of ART_CODES[printed] ?? []) hindranceId[code] = as;
  for (const [printed, as] of Object.entries(opts.hinderingArt ?? {})) {
    for (const code of ART_CODES[printed] ?? []) {
      obstacle.delete(code);
      hindrance.add(code);
      hindranceId[code] = as;
    }
  }
  const raised = new Map<number, number>();
  for (const [printed, level] of Object.entries(opts.raisedArt ?? {})) {
    for (const code of ART_CODES[printed] ?? []) {
      obstacle.delete(code);
      hindrance.delete(code);
      raised.set(code, level);
    }
  }
  const isInherent = (h: MapHex) => (opts.inherentHindrance ? opts.inherentHindrance(h) : h.terrain === 'orchard' && !h.features.includes(NON_INHERENT));
  /** Wooden building art (the depictions a hut hex is judged by). */
  const WOOD_BUILDING = new Set([50, 51, 203]);
  const locate = (x: number, y: number): { pb: PlacedBoard; i: number } | null => {
    const bx = Math.min(Math.floor(x / width), Math.max(...placements.map((p) => p.x)));
    const by = Math.floor(y / height);
    const pb = placements.find((p) => p.x === bx && p.y === by) ?? placements.find((p) => p.x === bx - 1 && p.y === by);
    if (!pb) return null;
    let lx = Math.min(pb.raster.w - 1, Math.max(0, Math.round(x - pb.x * width)));
    let ly = Math.min(pb.raster.h - 1, Math.max(0, Math.round(y - pb.y * height)));
    if (pb.rotation === 180) {
      // The raster is the board as printed; a turned board shows it upside down.
      lx = pb.raster.w - 1 - lx;
      ly = pb.raster.h - 1 - ly;
    }
    return { pb, i: ly * pb.raster.w + lx };
  };
  const terrainAt = (x: number, y: number): number => {
    const at = locate(x, y);
    return at ? at.pb.raster.terrain[at.i]! : 0;
  };
  const hasElevation = raised.size > 0 || placements.some((p) => p.raster.elevation);
  const elevationAt = (x: number, y: number): number => {
    const at = locate(x, y);
    if (!at) return 0;
    const printed = at.pb.raster.elevation ? at.pb.raster.elevation[at.i]! : 0;
    const art = raised.get(at.pb.raster.terrain[at.i]!);
    return art !== undefined ? Math.max(printed, art) : printed;
  };
  /** Higher ground under the thread for this many steps (half pixels) is a hill in the way, not art noise. */
  const HILL_RUN_STEPS = 6;
  /** Slope pixels tolerated just past the higher hex's hexside: the Crest Line it leaves through (SK4 3.2.1). */
  const CREST_TOLERANCE_STEPS = 8;

  /** How far (px) a thread may be shifted sideways and still count as a "near" LOS. */
  const NEAR_PX = [3, 6];
  /**
   * A hindrance pixel whose distance to its hex centre is at least this fraction of its distance to
   * the next centre lies along the hexside: art spilling over from the neighbour (measured: the J4
   * orchard sliver in I4 is at 0.92–0.99, the M9 grain field inside N8 reaches down to 0.51).
   */
  const SPILL_RATIO = 0.9;

  const los = (from: MapHex, to: MapHex, map: HexGridMap): LosResult => {
    // Between elevations the thread is walked downhill from the higher hex (LOS is symmetric), so
    // the Crest Line it must leave its hex through can be told from a second one further on.
    if ((to.elevation ?? 0) > (from.elevation ?? 0)) return los(to, from, map);
    const fromLevel = from.elevation ?? 0;
    const lo = to.elevation ?? 0;
    const a = hexPixel(from, placements);
    const b = hexPixel(to, placements);
    // Candidate intervening hexes from the hex-level line; pixels are assigned to the nearest center.
    const candidates = hexesNearLine(map, from, to);
    const centers = candidates.map((h) => ({ h, p: hexPixel(h, placements) }));
    const trace = (ax: number, ay: number, bx: number, by: number): LosResult => {
    const dist = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(dist * 2));
    const crossed: LosResult['crossed'] = [];
    const seen = new Set<HexId>();
    const woods = new Set<HexId>();
    const orchardEnds = new Set<HexId>();
    const offRoad = orchardRoadTracker();
    let hillRun = 0;
    let sinceHigher = Infinity;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const owners = nearestHexes(centers, x, y);
      if (owners.some((o) => o.id === from.id || o.id === to.id)) {
        // Woods art under the thread inside the end hexes themselves (an SSR may make it a mere hindrance).
        if (obstacle.has(terrainAt(x, y)) && WOODS.has(terrainAt(x, y))) for (const o of owners) if (o.id === from.id || o.id === to.id) woods.add(o.id);
        // The thread leaving the road of an Orchard-Road end hex (SK4 1.1.1 Orchard-Road).
        for (const o of owners) if ((o.id === from.id || o.id === to.id) && isOrchardRoad(o) && offRoad(o, terrainAt(x, y))) orchardEnds.add(o.id);
        if (fromLevel > lo && owners.some((o) => o.id === from.id)) sinceHigher = 0;
        else sinceHigher++;
        continue;
      }
      sinceHigher++;
      if (hasElevation) {
        // SK4 1.1.1 / 3.2.1: hexes, units and terrain are at the level under them. Ground higher than
        // both hexes is a hill in the way; between levels, higher ground outside the higher hex is a
        // second Crest Line (the slope it leaves through may spill a few pixels past its hexside).
        // Ground below both is overlooked entirely: neither obstacle nor Hindrance.
        const e = elevationAt(x, y);
        if (e > lo) {
          const slope = fromLevel > lo && e <= fromLevel && sinceHigher <= CREST_TOLERANCE_STEPS;
          if (!slope && ++hillRun >= HILL_RUN_STEPS) return { clear: false, crossed, crest: true, blockedAt: { x, y } };
          continue;
        }
        hillRun = 0;
        if (e < lo) continue;
      }
      if (opts.inherentObstacle && owners.some(opts.inherentObstacle)) return { clear: false, crossed, blockedAt: { x, y } };
      // Palm trees (PTO): an obstacle to a LOS between two levels, a Hindrance like any orchard on one level.
      if (fromLevel !== lo && opts.obstacleBetweenLevels && owners.some(opts.obstacleBetweenLevels)) return { clear: false, crossed, blockedAt: { x, y } };
      const code = terrainAt(x, y);
      const add = (h: MapHex, inherentHexside: boolean, terrain = h.terrain) => {
        if (seen.has(h.id) || h.id === from.id || h.id === to.id) return;
        seen.add(h.id);
        crossed.push({ hex: h.id, terrain, ...(inherentHexside ? { inherentHexside: true } : {}) });
      };
      // A hut (PTO): its building depiction is a +1 Hindrance, never an obstacle; the rest of the hex is open.
      if (WOOD_BUILDING.has(code) && opts.artHindrance) {
        const hut = owners.find((o) => opts.artHindrance!(o));
        if (hut) {
          add(hut, false);
          continue;
        }
      }
      if (obstacle.has(code)) return { clear: false, crossed, blockedAt: { x, y } };
      // A hindrance depiction under the thread hinders in the hex it is drawn in (SK1 1.1.1: "every
      // grain hex ... in which the LOS crosses the grain depiction"), even when that hex's terrain,
      // taken at its centre, is something else: board y's grain field at M9 runs well into N8. A mere
      // sliver along a hexside, though, is the neighbouring hex's art spilling over and counts for that
      // neighbour, once. (Orchard is not judged this way at all: see HINDRANCE.)
      if (hindrance.has(code)) {
        const want = hindranceId[code]!;
        const [o1, o2] = nearestTwo(centers, x, y);
        if (o1) {
          const sliver = o2 && o1.d / o2.d >= SPILL_RATIO && (o2.h.terrain === want || (want === 'brush' && isInherent(o2.h)));
          // A hex an SSR makes orchard (S20: "hexes that depict only Brush") is orchard whatever is drawn.
          const h = sliver ? o2.h : o1.h;
          add(h, isInherent(h), isInherent(h) ? h.terrain : want);
        }
      }
      // Inherent terrain (orchard) hinders whenever the thread enters the hex, even along a hexside; an Orchard-Road hex
      // only once the thread leaves its road (SK4 1.1.1 Orchard-Road, ASLRB B14.6).
      for (const o of owners) if (isInherent(o) && offRoad(o, code)) add(o, true);
    }
    return { clear: true, crossed, ...(woods.size ? { woods: [...woods].sort() } : {}), ...(orchardEnds.size ? { orchard: [...orchardEnds].sort() } : {}) };
    };

    const res = trace(a.x, a.y, b.x, b.y);
    if (res.clear) return res;
    // Blocked: is it a near thing? Try the same thread nudged sideways by a few pixels.
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const near = NEAR_PX.some((d) => [d, -d].some((o) => trace(a.x + nx * o, a.y + ny * o, b.x + nx * o, b.y + ny * o).clear));
    return near ? { ...res, near: true } : res;
  };
  const losAt = losAtTracer({ placements, obstacle, hindrance, hindranceId, isInherent, terrainAt, elevationAt, hasElevation, inherentObstacle: opts.inherentObstacle, heightOf: opts.heightOf });
  const bypassSides = (h: MapHex): number => bypassMask(h, (x, y) => obstacle.has(terrainAt(x, y)));
  return { los, losAt, bypassSides };
}

/** Building codes VASL draws a building with an upper level ("1 Level"): a Two Story House when nothing better is known. */
const UPPER_LEVEL_CODES = new Set([41, 51]);

/**
 * The full ASL pixel LOS between heights (ASLRB A6.2, A6.4–A6.43, B10.1–B10.23, B14.2; `hiEnd` is the higher end). The
 * thread is walked from the higher end as the ground-level tracer walks it, and every pixel outside the end hexes is
 * judged by height (`obstacleEffect`):
 * - Hill ground is an obstacle of its level: at or above the higher end it blocks (after a run of pixels, as art noise
 *   is filtered at ground level, and except the slope the higher end leaves its own hill hex by: B10.2), between the
 *   ends it is a Crest Line passed over (B10.23 Blind Hexes), at or below the lower end it is overlooked.
 * - Woods and building art is an obstacle on the level of its hex's centre dot even where it spills over the lower
 *   part of a hill hex (B10.1); a building pixel takes the height of the building hex it belongs to (a Two Story
 *   House 1½, B23.22), woods one (B13.2).
 * - An orchard (Inherent, judged by the hex) rises from the hill depiction under the thread (B10.1): a +1 Hindrance to
 *   same-level LOS, an obstacle in season or +1 out of season to a LOS to/from a higher Location (B14.2).
 * - Grain and brush hinder only same-level LOS at their level (A6.7, B12.2, B15.2).
 * Obstacles passed over are then checked for Blind Hexes at the lower end (A6.4).
 */
function losAtTracer(t: {
  placements: PlacedBoard[];
  obstacle: Set<number>;
  hindrance: Set<number>;
  hindranceId: Record<number, string>;
  isInherent: (h: MapHex) => boolean;
  terrainAt: (x: number, y: number) => number;
  elevationAt: (x: number, y: number) => number;
  hasElevation: boolean;
  inherentObstacle: ((h: MapHex) => boolean) | undefined;
  heightOf: ((h: MapHex) => number) | undefined;
}) {
  // The ground-level tracer's tolerances (see `pixelTracers`).
  const HILL_RUN_STEPS = 6;
  const CREST_TOLERANCE_STEPS = 8;
  const NEAR_PX = [3, 6];
  const SPILL_RATIO = 0.9;
  const heightOf = (h: MapHex) => t.heightOf?.(h) ?? h.obstacleHeight ?? 1;
  /**
   * A LOS end in map pixels: the centre dot, a corner, or (A4.132 b) the point where the road depiction meets the
   * hexside: the middle of the road pixels along it, else the middle of the hexside.
   */
  const endPoint = (h: MapHex, e: LosEnd): { x: number; y: number } => {
    const p = losEndPoint(h, e);
    if (e.side === undefined) return p;
    const c0 = losEndPoint(h, { ...e, side: undefined, vertex: e.side });
    const c1 = losEndPoint(h, { ...e, side: undefined, vertex: e.side + 1 });
    let n = 0, sx = 0, sy = 0;
    for (let i = 0; i <= 40; i++) {
      const x = c0.x + ((c1.x - c0.x) * i) / 40;
      const y = c0.y + ((c1.y - c0.y) * i) / 40;
      if (ROAD.has(t.terrainAt(x, y))) {
        n++;
        sx += x;
        sy += y;
      }
    }
    return n ? { x: sx / n, y: sy / n } : p;
  };
  const isBuilding = (h: MapHex | undefined): h is MapHex => !!h && h.terrain.startsWith('building');

  return (hiEnd: LosEnd, loEnd: LosEnd, map: HexGridMap, o: LosAtOptions): LosResult => {
    const from = map.hex(hiEnd.hex)!;
    const to = map.hex(loEnd.hex)!;
    const hi = hiEnd.height;
    const lo = loEnd.height;
    const fromLevel = from.elevation ?? 0;
    const inSeason = o.orchardInSeason ?? false;
    // A corner or hexside end (Bypass, ASLRB A4.34; the A4.132 road point) is traced to that point, and its hex is no
    // longer the end hex the thread may cross freely (A6.2: only a centre-dot end's own terrain never blocks).
    const a = endPoint(from, hiEnd);
    const b = endPoint(to, loEnd);
    const freeFrom = hiEnd.vertex === undefined && hiEnd.side === undefined;
    const freeTo = loEnd.vertex === undefined && loEnd.side === undefined;
    const atEndPoint = (x: number, y: number) => (!freeFrom && Math.hypot(x - a.x, y - a.y) < 2.5) || (!freeTo && Math.hypot(x - b.x, y - b.y) < 2.5);
    const candidates = hexesNearLine(map, from, to);
    const centers = candidates.map((h) => ({ h, p: hexPixel(h, t.placements) }));
    const ranges = new Map<HexId, number>();
    const range = (h: MapHex) => {
      let r = ranges.get(h.id);
      if (r === undefined) ranges.set(h.id, (r = map.distance(from.id, h.id)));
      return r;
    };

    const trace = (ax: number, ay: number, bx: number, by: number): LosResult => {
      const dist = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(dist * 2));
      const crossed: LosResult['crossed'] = [];
      const seen = new Set<HexId>();
      const woods = new Set<HexId>();
      const orchardEnds = new Set<HexId>();
      const offRoad = orchardRoadTracker();
      /** Obstacles passed over: the highest per hex and kind, with the last pixel seen (the far edge). */
      const over = new Map<string, HeightObstacle>();
      let hillRun = 0;
      let sinceHigher = Infinity;
      let orchardsOver = 0;
      const blocked = (x: number, y: number, hex: MapHex, terrain: string, crest = false): LosResult => ({
        clear: false,
        crossed,
        blockedAt: { x, y },
        obstacle: { hex: hex.id, terrain },
        ...(crest ? { crest: true } : {}),
      });
      const passOver = (x: number, y: number, hex: MapHex, terrain: string, top: number, crest: boolean) => {
        const k = `${hex.id}|${crest ? 'c' : 't'}`;
        const known = over.get(k);
        const higher = !known || top >= known.top;
        over.set(k, {
          hex: hex.id,
          terrain: higher ? terrain : known.terrain,
          top: higher ? top : known.top,
          hexLevel: hex.elevation ?? 0,
          range: range(hex),
          ...(crest ? { crest: true } : {}),
          at: { x, y },
        });
      };
      const add = (h: MapHex, inherentHexside: boolean, terrain = h.terrain) => {
        if (seen.has(h.id) || h.id === from.id || h.id === to.id) return;
        seen.add(h.id);
        crossed.push({ hex: h.id, terrain, ...(inherentHexside ? { inherentHexside: true } : {}) });
      };
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const x = ax + (bx - ax) * u;
        const y = ay + (by - ay) * u;
        const owners = nearestHexes(centers, x, y);
        if (atEndPoint(x, y)) continue;
        if (owners.some((w) => (w.id === from.id && freeFrom) || (w.id === to.id && freeTo))) {
          // The end hexes never block (A6.2); their woods art is noted for the Woods-Road rule.
          if (t.obstacle.has(t.terrainAt(x, y)) && WOODS.has(t.terrainAt(x, y))) for (const w of owners) if (w.id === from.id || w.id === to.id) woods.add(w.id);
          for (const w of owners) if ((w.id === from.id || w.id === to.id) && isOrchardRoad(w) && offRoad(w, t.terrainAt(x, y))) orchardEnds.add(w.id);
          if (owners.some((w) => w.id === from.id)) sinceHigher = 0;
          else sinceHigher++;
          continue;
        }
        sinceHigher++;
        const [o1, o2] = nearestTwo(centers, x, y);
        if (!o1) continue;
        const owner = o1.h;
        const e = t.hasElevation ? t.elevationAt(x, y) : 0;
        // Hill ground (B10.2, B10.21, B10.23).
        if (e > lo) {
          const slope = e <= fromLevel && sinceHigher <= CREST_TOLERANCE_STEPS;
          if (!slope && ++hillRun >= HILL_RUN_STEPS) {
            const effect = obstacleEffect(e, lo, hi);
            if (effect === 'blocks') return blocked(x, y, owner, 'hill', true);
            if (effect === 'over') passOver(x, y, owner, 'hill', e, true);
          }
        } else hillRun = 0;
        // Terrain obstacles: at the level of their hex's centre dot throughout the depiction (B10.1).
        const base = Math.max(e, owner.elevation ?? 0);
        const code = t.terrainAt(x, y);
        const inherentObs = t.inherentObstacle ? owners.find(t.inherentObstacle) : undefined;
        if (inherentObs || t.obstacle.has(code)) {
          const isWoods = !inherentObs && WOODS.has(code);
          const building = inherentObs || isWoods ? undefined : isBuilding(owner) ? owner : isBuilding(o2?.h) ? o2!.h : undefined;
          const hex = inherentObs ?? building ?? owner;
          const height = inherentObs ? heightOf(inherentObs) : isWoods ? 1 : building ? heightOf(building) : UPPER_LEVEL_CODES.has(code) ? 1.5 : 1;
          const top = (inherentObs ? Math.max(e, inherentObs.elevation ?? 0) : base) + height;
          const terrain = inherentObs ? inherentObs.terrain : isWoods ? 'woods' : (building?.terrain ?? 'building');
          const effect = obstacleEffect(top, lo, hi);
          if (effect === 'blocks') return blocked(x, y, hex, terrain);
          if (effect === 'over') passOver(x, y, hex, terrain, top, false);
          continue;
        }
        // Grain and brush depictions (and SSR hindering art): same-level LOS only, at their level (A6.7, B12.2, B15.2).
        if (t.hindrance.has(code) && hi === lo && lo === base) {
          const want = t.hindranceId[code]!;
          const sliver = o2 && o1.d / o2.d >= SPILL_RATIO && (o2.h.terrain === want || (want === 'brush' && o2.h.terrain === 'orchard'));
          const h = sliver ? o2.h : o1.h;
          add(h, t.isInherent(h), h.terrain === 'orchard' ? 'orchard' : want);
        }
        // Orchards: Inherent, judged by the hex, rising from the hill depiction under the thread (B10.1, B14.2).
        for (const w of owners) {
          // On the road through an Orchard-Road hex the orchard has no effect, at any height (B14.6).
          if (!t.isInherent(w) || !offRoad(w, code)) continue;
          const effect = orchardHinders(e, lo, hi, inSeason, map.distance(w.id, to.id) === 1);
          if (effect === 'obstacle') {
            const oe = obstacleEffect(e + 1, lo, hi);
            if (oe === 'blocks') return blocked(x, y, w, w.terrain);
            if (oe === 'over') passOver(x, y, w, w.terrain, e + 1, false);
          } else if (effect && !seen.has(w.id)) {
            // From more than one level above, only one out-of-season orchard counts (B14.2).
            if (hi !== lo && hi > e + 1 && orchardsOver++ > 0) continue;
            add(w, true);
          }
        }
      }
      for (const ob of over.values()) {
        if (blindHexesBehind(ob, hi, lo, to.elevation ?? 0, map.distance(ob.hex, to.id))) {
          return { clear: false, crossed, ...(ob.at ? { blockedAt: ob.at } : {}), obstacle: { hex: ob.hex, terrain: ob.terrain, blind: true }, ...(ob.crest ? { crest: true } : {}) };
        }
      }
      return { clear: true, crossed, ...(woods.size ? { woods: [...woods].sort() } : {}), ...(orchardEnds.size ? { orchard: [...orchardEnds].sort() } : {}) };
    };

    const res = trace(a.x, a.y, b.x, b.y);
    if (res.clear) return res;
    // Blocked: is it a near thing? Try the same thread nudged sideways by a few pixels.
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const near = NEAR_PX.some((d) => [d, -d].some((off) => trace(a.x + nx * off, a.y + ny * off, b.x + nx * off, b.y + ny * off).clear));
    return near ? { ...res, near: true } : res;
  };
}

/** Hexes within one hex of the straight hex line between two hexes. */
function hexesNearLine(map: HexGridMap, from: MapHex, to: MapHex): MapHex[] {
  const ids = new Set<HexId>();
  const n = map.distance(from.id, to.id);
  const res = map.gridLine(from, to, n);
  for (const h of res) {
    ids.add(h.id);
    for (const nb of map.neighbors(h.id)) ids.add(nb);
  }
  return [...ids].map((id) => map.hex(id)!).filter(Boolean);
}


/** The hex(es) whose center is nearest the point (two if on a hexside within 0.75 px). */
/** Normalised distance from a point to a hex centre: hexes are wider than tall in VASL pixels. */
const hexDist = (c: { p: { x: number; y: number } }, x: number, y: number) =>
  Math.hypot(((x - c.p.x) / GEO.px.hexWidth) * 1.5, ((y - c.p.y) / GEO.px.hexHeight) * Math.sqrt(3));

/** The nearest and second-nearest hex centres to a point, with their normalised distances. */
function nearestTwo(centers: { h: MapHex; p: { x: number; y: number } }[], x: number, y: number): { h: MapHex; d: number }[] {
  let a: { h: MapHex; d: number } | null = null;
  let b: { h: MapHex; d: number } | null = null;
  for (const c of centers) {
    const d = hexDist(c, x, y);
    if (!a || d < a.d) {
      b = a;
      a = { h: c.h, d };
    } else if (!b || d < b.d) b = { h: c.h, d };
  }
  return [a, b].filter((e): e is { h: MapHex; d: number } => !!e);
}

function nearestHexes(centers: { h: MapHex; p: { x: number; y: number } }[], x: number, y: number): MapHex[] {
  let best = Infinity;
  let second = Infinity;
  let bh: MapHex | null = null;
  let sh: MapHex | null = null;
  for (const c of centers) {
    // Hexes are slightly wider than tall in VASL pixels; normalise so boundaries are equidistant.
    const dx = (x - c.p.x) / GEO.px.hexWidth;
    const dy = (y - c.p.y) / GEO.px.hexHeight;
    const d = Math.hypot(dx * 1.5, dy * Math.sqrt(3));
    if (d < best) {
      second = best;
      sh = bh;
      best = d;
      bh = c.h;
    } else if (d < second) {
      second = d;
      sh = c.h;
    }
  }
  if (!bh) return [];
  return sh && second - best < 0.75 / GEO.px.hexHeight ? [bh, sh] : [bh];
}

/** Raster pixels within this distance of a hexside count as on it: the line itself and its anti-aliased neighbours. */
export const BYPASS_TOLERANCE_PX = 1;

/**
 * The hexsides of an obstacle hex open to Bypass (ASLRB A4.3, A4.31), as a 6-bit mask (bit k: hexside k of
 * `hexCorners.ts`), measured on the LOS raster. A hexside is closed when the hex's obstacle depiction reaches it: the
 * obstacle pixels of the hex itself, and every obstacle pixel joined to them with no open ground between (8-connected,
 * so a neighbour's woods grown into this hex's building closes the hexside, a neighbour's woods with a strip of open
 * ground between them does not. Read here as: "as long as there is even the tiniest piece of open
 * ground depicted between a building and an obstacle it can be bypassed"). A pixel within `BYPASS_TOLERANCE_PX` of
 * the hexside segment, corners included, is on it.
 */
export function bypassMask(h: MapHex, isObstacle: (x: number, y: number) => boolean): number {
  const c = pixelOf(h.cube);
  const R = GEO.px.hexWidth * (2 / 3);
  const H = GEO.px.hexHeight / 2;
  const corner = (k: number) => {
    const off = [[R, 0], [R / 2, H], [-R / 2, H], [-R, 0], [-R / 2, -H], [R / 2, -H]][((k % 6) + 6) % 6]!;
    return { x: c.x + off[0]!, y: c.y + off[1]! };
  };
  // A window round the hex, a little beyond its corners.
  const pad = R * 0.5;
  const x0 = Math.floor(c.x - R - pad);
  const y0 = Math.floor(c.y - H - pad);
  const w = Math.ceil(2 * (R + pad)) + 1;
  const hh = Math.ceil(2 * (H + pad)) + 1;
  const obs = new Uint8Array(w * hh);
  for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) obs[j * w + i] = isObstacle(x0 + i, y0 + j) ? 1 : 0;
  // Inside the hex: nearer its own centre than to any neighbour's (the hex is convex: inside all six hexsides).
  const inside = (x: number, y: number) => {
    for (let k = 0; k < 6; k++) {
      const a = corner(k);
      const b = corner(k + 1);
      if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false;
    }
    return true;
  };
  const reached = new Uint8Array(w * hh);
  const queue: number[] = [];
  for (let j = 0; j < hh; j++)
    for (let i = 0; i < w; i++) {
      const idx = j * w + i;
      if (obs[idx] && inside(x0 + i, y0 + j)) {
        reached[idx] = 1;
        queue.push(idx);
      }
    }
  while (queue.length) {
    const idx = queue.pop()!;
    const i = idx % w;
    const j = (idx - i) / w;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= hh) continue;
        const n = nj * w + ni;
        if (obs[n] && !reached[n]) {
          reached[n] = 1;
          queue.push(n);
        }
      }
  }
  const segDist = (x: number, y: number, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
  };
  let mask = 0;
  for (let k = 0; k < 6; k++) {
    const a = corner(k);
    const b = corner(k + 1);
    let touched = false;
    for (let j = 0; j < hh && !touched; j++)
      for (let i = 0; i < w; i++) {
        if (!reached[j * w + i]) continue;
        if (segDist(x0 + i, y0 + j, a, b) <= BYPASS_TOLERANCE_PX) {
          touched = true;
          break;
        }
      }
    if (!touched) mask |= 1 << k;
  }
  return mask;
}
