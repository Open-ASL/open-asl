import {
  cubeToOffset,
  cubeDistance,
  cubeLine,
  cubeNeighbors,
  offsetToCube,
  type Cube,
  type HexId,
} from '@asl/engine';
import type { GameMap, HexsideCrossing, HexsideObstacle, LosAtOptions, LosEnd, LosResult, MapHex } from './statics';
import { blindHexesBehind, obstacleEffect, type HeightObstacle } from './losHeights';

/**
 * ASL geomorphic board geometry (VASL "GEO" boards): 33 columns (A–GG) of
 * flat-topped hexes. Even column indexes (A, C, …, GG) have hexes 1–10; odd
 * indexes (B, D, …) have 0–10 with half hexes at the top/bottom edges. Odd
 * columns sit half a hex lower than even columns.
 */
export const GEO = {
  columns: 33,
  rows: 10,
  /** VASL pixel geometry, used by the client renderer and LOS data. */
  px: { width: 1800, height: 645, hexWidth: 56.25, hexHeight: 64.5 },
} as const;

export const columnLabel = (col: number) => String.fromCharCode(65 + (col % 26)).repeat(Math.floor(col / 26) + 1);

export function columnIndex(label: string): number {
  const ch = label.charCodeAt(0) - 65;
  return ch + 26 * (label.length - 1);
}

export function parseHexName(name: string): { board: string; col: string; row: number } | null {
  // Board ids are lowercase (y, z) or digits (e.g. 24) followed by an uppercase column.
  const m = /^([a-z]+|\d+)([A-Z]+)(\d+)$/.exec(name);
  if (!m) return null;
  return { board: m[1]!, col: m[2]!, row: Number(m[3]) };
}

export interface BoardPlacement {
  board: string;
  /** Position in board units: x along the long axis (boards overlap by one column), y across. */
  x: number;
  y: number;
  /**
   * 180°: the board is turned in place (its hexes keep their printed names): column A sits where
   * GG would, row 1 where row 10 would. The same lattice results, so butted boards still share
   * their half hexes.
   */
  rotation?: 0 | 180;
  /** Playable hexrows (inclusive column labels), e.g. ['A', 'V']; the rest of the board is off-map. */
  columns?: [string, string];
  /** Playable hex numbers (inclusive), e.g. [0, 6] for "hexes numbered ≤ 6" (S30); the rest of the board is off-map. */
  rows?: [number, number];
}

export type Side = 'N' | 'E' | 'S' | 'W';

/**
 * Where a board's printed hex (column index, row number) lands on the assembled map's offset
 * grid, and back (`inverse`). A 180° turn mirrors the column (A ↔ GG, same parity) and the row
 * (even columns 1 ↔ 10, odd columns 0 ↔ 10).
 */
export function placedOffset(b: BoardPlacement, col: number, row: number, inverse = false): { col: number; row: number } {
  const col0 = b.x * (GEO.columns - 1);
  const row0 = b.y * GEO.rows;
  if (b.rotation !== 180) return inverse ? { col: col - col0, row: row - row0 } : { col: col0 + col, row: row0 + row };
  const flip = (c: number, r: number) => ({ col: GEO.columns - 1 - c, row: c % 2 === 0 ? GEO.rows + 1 - r : GEO.rows - r });
  if (inverse) return flip(col - col0, row - row0);
  const f = flip(col, row);
  return { col: col0 + f.col, row: row0 + f.row };
}

/** Pixel position of a hex centre in assembled-map coordinates (VASL board pixels), from its cube. */
export function hexPixel(cube: Cube): { x: number; y: number } {
  const o = cubeToOffset(cube, 'odd-q');
  const { hexWidth, hexHeight } = GEO.px;
  return { x: hexWidth * o.col, y: o.col % 2 === 0 ? hexHeight * o.row - hexHeight / 2 : hexHeight * o.row };
}

export interface HexTerrainSpec {
  terrain: string;
  features?: string[];
  buildingId?: string;
  /** Full-level elevation (hills); ground level when absent. */
  elevation?: number;
  /** A building's upper levels and stairwell (ASLRB B23.21–23; see `MapHex.building`). */
  building?: MapHex['building'];
  /** Obstacle height in levels where it differs from the terrain's (see `MapHex.obstacleHeight`). */
  obstacleHeight?: number;
  /** Wooden building hexes: separate building depictions, and whether one spans hexes (see `MapHex.buildings`). */
  buildings?: number;
  partialBuilding?: true;
  /** Hexsides (0–5) of an obstacle hex its depiction touches, so not open to Bypass (ASLRB A4.3); test maps only. */
  bypassBlocked?: number[];
}

export interface HexGridMapOptions {
  boards: BoardPlacement[];
  /** Terrain per hex name; unlisted hexes default to open ground. */
  terrain?: Record<HexId, HexTerrainSpec>;
  /** Which terrain ids block LOS / hinder LOS / are inherent. */
  losEffect: (terrain: string) => 'none' | 'hindrance' | 'obstacle';
  /** `hex` lets a scenario make one hex's terrain non-inherent (an SSR redraw). */
  inherent?: (terrain: string, hex?: MapHex) => boolean;
  /** Road hexsides as "a|b" pairs (order-insensitive). */
  roadHexsides?: [HexId, HexId][];
  /** Path hexsides (SK4 8.2: a PTO Terrain Woods-Road is a path; Infantry enter a jungle hex along one for 1 MF). */
  pathHexsides?: [HexId, HexId][];
  /**
   * Scenario compass: which side of the assembled map (board-relative, row 1 = 'N', column A = 'W')
   * each scenario direction refers to. Identity when omitted. A board turned 90° counterclockwise so
   * hexrow A faces south is { N: 'E', E: 'S', S: 'W', W: 'N' }.
   */
  compass?: Record<Side, Side>;
  /** Pixel-accurate LOS override (e.g. VASL LOS data). */
  los?: (from: MapHex, to: MapHex, map: HexGridMap) => LosResult;
  /** Pixel-accurate LOS between heights (full ASL), the twin of `los`; the hex-level tracer otherwise. Ends come higher first. */
  losAt?: (from: LosEnd, to: LosEnd, map: HexGridMap, opts: LosAtOptions) => LosResult;
  /**
   * A terrain's obstacle height in levels (`TerrainDef.height`), for LOS between heights; a hex's `obstacleHeight`
   * overrides it. An obstacle without one is one level.
   */
  height?: (terrain: string) => number | undefined;
  /**
   * The hexsides of an obstacle hex open to Bypass (ASLRB A4.3) as a 6-bit mask (bit k: hexside k, see `hexCorners.ts`),
   * measured on the board art (VASL LOS data). Without it every hexside of an obstacle hex is open, less the hex's
   * `bypassBlocked`.
   */
  bypassSides?: (h: MapHex, map: HexGridMap) => number;
  /**
   * SSR "Treat all off-board terrain as if it exists": an offboard hex that is a cut-away hex of a
   * placed board keeps its printed terrain, features and elevation. Otherwise every offboard hex is
   * Open Ground (SK4 3.x: units move offboard, and exit, as if the offboard hex were Open Ground).
   */
  offboardTerrain?: boolean;
  /**
   * Extra entry edges inside the map, for a playing area an SSR may shrink (S36: the Russians enter along the south edge of
   * whichever boards the secret game length puts in play). Each names its edge hexes and the side beyond them; the
   * hexes one step beyond become virtual offboard hexes `<hex>~` of that edge (over out-of-play map hexes), so
   * `edge(name)` and `offboard(name)` work as for a map edge.
   */
  stagingEdges?: { name: string; hexes: HexId[]; side: Side }[];
  /**
   * Hexes that exist off the board drawing (S70's Connection Location, ASLRB G11.2's Cave Complex: "a pseudo, off-map
   * hex"): `hex()` knows them, so units stand in them with a terrain, but they are in no `hexes()` listing, have no
   * neighbours (a rule module says what is adjacent), are at no distance from anything and have no LOS.
   */
  hiddenHexes?: { id: HexId; terrain: string }[];
}

const key = (c: Cube) => `${c.q},${c.r}`;
const isRoad = (h: MapHex) => h.features.some((f) => f.startsWith('road:'));

/** A hex's terrain beyond its type and features: its building (id, levels, height, count) and blocked Bypass. */
function terrainFields(spec: HexTerrainSpec): Partial<MapHex> {
  return {
    ...(spec.buildingId ? { buildingId: spec.buildingId } : {}),
    ...(spec.building ? { building: spec.building } : {}),
    ...(spec.obstacleHeight !== undefined ? { obstacleHeight: spec.obstacleHeight } : {}),
    ...(spec.buildings !== undefined ? { buildings: spec.buildings } : {}),
    ...(spec.partialBuilding ? { partialBuilding: true } : {}),
    ...(spec.bypassBlocked?.length ? { bypassBlocked: spec.bypassBlocked } : {}),
  };
}

export class HexGridMap implements GameMap {
  private byId = new Map<HexId, MapHex>();
  private byCube = new Map<string, MapHex>();
  private alias = new Map<HexId, HexId>();
  private roads = new Set<string>();
  private paths = new Set<string>();
  /** Offboard virtual hexes by id, and their ids per board-relative side. */
  private off = new Map<HexId, MapHex & { sides: string[] }>();
  /** Staging edges' virtual offboard hexes by cube (they lie over map hexes). */
  private stagingByCube = new Map<string, HexId[]>();
  private offByCube = new Map<string, HexId>();

  constructor(private readonly opts: HexGridMapOptions) {
    for (const h of opts.hiddenHexes ?? []) this.hidden.set(h.id, { id: h.id, board: '', colLabel: '', row: 0, cube: { q: 1e6, r: 0, s: -1e6 }, terrain: h.terrain, features: [], halfHex: false });
    for (const b of opts.boards) {
      const [cFrom, cTo] = b.columns ? b.columns.map(columnIndex) as [number, number] : [0, GEO.columns - 1];
      for (let c = cFrom; c <= cTo; c++) {
        const even = c % 2 === 0;
        const first = even ? 1 : 0;
        for (let n = Math.max(first, b.rows?.[0] ?? 0); n <= Math.min(GEO.rows, b.rows?.[1] ?? GEO.rows); n++) {
          const label = columnLabel(c);
          const id = `${b.board}${label}${n}`;
          const cube = offsetToCube(placedOffset(b, c, n), 'odd-q');
          const existing = this.byCube.get(key(cube));
          if (existing) {
            // Overlapping half hexes of butted boards are one hex with two names.
            this.alias.set(id, existing.id);
            existing.halfHex = false;
            // ASLRB A2.3: "an Open Ground half-hex butted together with another terrain type half-hex" makes a hex of that
            // other terrain type (S25's boards, half a board apart, butt v's open D10 against u's woods T0).
            const other = opts.terrain?.[id];
            if (existing.terrain === 'open' && other && other.terrain !== 'open') Object.assign(existing, { terrain: other.terrain, features: [...existing.features, ...(other.features ?? [])], ...terrainFields(other) });
            continue;
          }
          const spec = opts.terrain?.[id];
          const hex: MapHex = {
            id,
            board: b.board,
            colLabel: label,
            row: n,
            cube,
            terrain: spec?.terrain ?? 'open',
            features: spec?.features ?? [],
            ...(spec?.elevation ? { elevation: spec.elevation } : {}),
            ...(spec ? terrainFields(spec) : {}),
            halfHex: c === 0 || c === GEO.columns - 1 || (!even && (n === 0 || n === GEO.rows)),
          };
          this.byId.set(id, hex);
          this.byCube.set(key(cube), hex);
        }
      }
    }
    for (const [a, b] of opts.roadHexsides ?? []) this.roads.add(this.pairKey(this.canon(a), this.canon(b)));
    for (const [a, b] of opts.pathHexsides ?? []) this.paths.add(this.pairKey(this.canon(a), this.canon(b)));
    this.buildOffboard();
    this.buildStaging();
  }

  /** Virtual offboard hexes beyond each staging edge (see `stagingEdges`). */
  private buildStaging() {
    for (const st of this.opts.stagingEdges ?? []) {
      for (const id of st.hexes) {
        const h = this.byId.get(this.canon(id));
        if (!h) continue;
        const outs =
          st.side === 'N'
            ? [{ q: h.cube.q, r: h.cube.r - 1, s: -h.cube.q - h.cube.r + 1 }]
            : st.side === 'S'
              ? [{ q: h.cube.q, r: h.cube.r + 1, s: -h.cube.q - h.cube.r - 1 }]
              : cubeNeighbors(h.cube).filter((c) => c.q === h.cube.q + (st.side === 'E' ? 1 : -1));
        for (const c of outs) {
          const under = this.byCube.get(key(c));
          if (!under) continue;
          const offId = `${under.id}~`;
          const known = this.off.get(offId);
          if (known) {
            if (!known.sides.includes(st.name)) known.sides.push(st.name);
            continue;
          }
          this.off.set(offId, { ...under, id: offId, features: [], terrain: 'open', offboard: true, sides: [st.name] });
          this.stagingByCube.set(key(c), [...(this.stagingByCube.get(key(c)) ?? []), offId]);
        }
      }
    }
  }

  /**
   * One ring of virtual hexes outside each map side. N/S: the hex beyond each column's end hex;
   * E/W: the hexes of the next column out. Roads crossing the edge continue offboard, through
   * the one hexside the road actually leaves by (see `roadContinues`).
   */
  private buildOffboard() {
    const all = [...this.byId.values()];
    const qs = all.map((h) => h.cube.q);
    const minQ = Math.min(...qs);
    const maxQ = Math.max(...qs);
    for (const side of ['N', 'E', 'S', 'W'] as Side[]) {
      for (const id of this.rawEdge(side)) {
        const h = this.byId.get(id)!;
        const outs =
          side === 'N'
            ? [{ q: h.cube.q, r: h.cube.r - 1, s: -h.cube.q - h.cube.r + 1 }]
            : side === 'S'
              ? [{ q: h.cube.q, r: h.cube.r + 1, s: -h.cube.q - h.cube.r - 1 }]
              : cubeNeighbors(h.cube).filter((c) => c.q === (side === 'E' ? maxQ + 1 : minQ - 1));
        for (const c of outs) {
          if (this.byCube.has(key(c))) continue;
          let offId = this.offByCube.get(key(c));
          if (!offId) {
            const b = this.opts.boards.find((p) => p.board === h.board)!;
            const o = cubeToOffset(c, 'odd-q');
            const { col, row } = placedOffset(b, o.col, o.row, true);
            const label = col >= 0 && col < GEO.columns ? columnLabel(col) : `#${col}`;
            offId = `${b.board}${label}${row}`;
            const printed = col >= 0 && col < GEO.columns && row <= GEO.rows && row >= (col % 2 === 0 ? 1 : 0);
            const spec = printed && this.opts.offboardTerrain ? this.opts.terrain?.[offId] : undefined;
            this.off.set(offId, {
              id: offId,
              board: b.board,
              colLabel: label,
              col,
              row,
              cube: c,
              terrain: spec?.terrain ?? 'open',
              features: [...(spec?.features ?? [])],
              ...(spec?.elevation ? { elevation: spec.elevation } : {}),
              offboard: true,
              sides: [],
            });
            this.offByCube.set(key(c), offId);
          }
          const oh = this.off.get(offId)!;
          if (!oh.sides.includes(side)) oh.sides.push(side);
          const oc = oh.col ?? -1;
          const cutAway = oc >= 0 && oc < GEO.columns && oh.row <= GEO.rows && oh.row >= (oc % 2 === 0 ? 1 : 0);
          if (this.roadContinues(h, offId, cutAway)) {
            if (!oh.features.includes('road:offboard')) oh.features.push('road:offboard');
            this.roads.add(this.pairKey(h.id, offId));
          }
          if (this.pathContinues(h, c, cutAway)) this.paths.add(this.pairKey(h.id, offId));
        }
      }
    }
  }

  /**
   * Whether a path that reaches edge hex `h` runs on into the offboard hex at cube `c`. Paths extend offboard as roads
   * do (SK1 3.3, SK4 8.2.1). A path through `h` (a hex with the `path` feature) that ends there runs on in its own line:
   * into the offboard hex straight on from the one path hexside by which it enters `h`. Beyond a cut hexrow the board
   * data already gives a Woods-Road path's hexside into the hex cut away (`cutAway`), so one that ends there ends; a path
   * an SSR draws along a hex grain (`path:ssr`) has no board data, and runs on.
   */
  private pathContinues(h: MapHex, c: Cube, cutAway: boolean): boolean {
    if (!h.features.some((f) => f === 'path' || f.startsWith('path:'))) return false;
    if (cutAway && !h.features.includes('path:ssr')) return false;
    const along = cubeNeighbors(h.cube).filter((n) => {
      const id = this.byCube.get(key(n))?.id ?? this.offByCube.get(key(n));
      return !!id && this.paths.has(this.pairKey(id, h.id));
    });
    if (along.length !== 1) return false;
    const n = along[0]!;
    return key({ q: 2 * h.cube.q - n.q, r: 2 * h.cube.r - n.r, s: 2 * h.cube.s - n.s }) === key(c);
  }

  /**
   * Whether the road in edge hex `h` leaves the map through the hexside shared with offboard hex
   * `offId`. Beyond a cut hexrow the off-map hex is still a hex of the board (`cutAway`), so the road
   * continues only if the board data puts the road there (or lists the hexside). At a true board edge
   * nothing beyond is known: a road hex is taken to exit through its single N/S neighbour; on an E/W
   * edge, where two offboard hexes touch it, through both.
   */
  private roadContinues(h: MapHex, offId: HexId, cutAway: boolean): boolean {
    if (!isRoad(h)) return false;
    if (this.roads.has(this.pairKey(h.id, offId))) return true;
    if (!cutAway) return true;
    return !!this.opts.terrain?.[offId]?.features?.some((f) => f.startsWith('road:'));
  }

  private side(edge: string): Side {
    if (this.opts.compass && edge in this.opts.compass) return this.opts.compass[edge as Side];
    return edge as Side;
  }

  offboard(edge: string): MapHex[] {
    // A staging edge is named as it is; a map edge goes through the compass.
    const sides: string[] = edge.split(',').map((e) => (this.opts.stagingEdges?.some((st) => st.name === e) ? e : this.side(e)));
    return [...this.off.values()].filter((h) => h.sides.some((s) => sides.includes(s)));
  }

  offboardHex(id: HexId): MapHex | undefined {
    return this.off.get(id);
  }

  offboardNeighbors(id: HexId): { onboard: HexId[]; offboard: HexId[] } {
    const h = this.off.get(id);
    if (!h) return { onboard: [], offboard: [] };
    const near = cubeNeighbors(h.cube);
    const onboard = near.map((c) => this.byCube.get(key(c))?.id).filter((x): x is HexId => !!x);
    // Along the same edge only (a corner hex belongs to both edges).
    const offboard = near
      .flatMap((c) => [this.offByCube.get(key(c)), ...(this.stagingByCube.get(key(c)) ?? [])])
      .filter((x): x is HexId => !!x && this.off.get(x)!.sides.some((s) => h.sides.includes(s)));
    return { onboard, offboard };
  }

  private canon(id: HexId): HexId {
    return this.alias.get(id) ?? id;
  }

  private pairKey(a: HexId, b: HexId) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  hex(id: HexId): MapHex | undefined {
    // A Location id (ASLRB A2.8, 'uK4:1') where a hex id belongs would otherwise read as an unknown, open hex.
    if (id.includes(':')) throw new Error(`hex: "${id}" is a Location id, not a hex id (use hexOfLoc)`);
    return this.byId.get(this.canon(id)) ?? this.hidden.get(id);
  }

  /** Whether a hex is one of the map's hidden hexes (`HexGridMapOptions.hiddenHexes`). */
  isHidden(id: HexId): boolean {
    return this.hidden.has(id);
  }

  private hidden = new Map<HexId, MapHex>();

  hexes(): Iterable<MapHex> {
    return this.byId.values();
  }

  atCube(c: Cube): MapHex | undefined {
    return this.byCube.get(key(c));
  }

  neighbors(id: HexId): HexId[] {
    const h = this.hex(id);
    if (!h || this.hidden.has(id)) return [];
    return cubeNeighbors(h.cube)
      .map((c) => this.byCube.get(key(c))?.id)
      .filter((x): x is HexId => !!x);
  }

  distance(a: HexId, b: HexId): number {
    const ha = this.hex(a);
    const hb = this.hex(b);
    if (!ha || !hb) throw new Error(`distance: unknown hex ${!ha ? a : b}`);
    if (a !== b && (this.hidden.has(a) || this.hidden.has(b))) return Infinity;
    return cubeDistance(ha.cube, hb.cube);
  }

  edge(edge: string): HexId[] {
    // Scenario directions are translated to board-relative sides through the compass. A
    // comma-separated list ("N,E", "N,E,S,W") names several edges at once.
    if (edge.includes(',')) return [...new Set(edge.split(',').flatMap((e) => this.edge(e)))];
    const staging = this.opts.stagingEdges?.find((s) => s.name === edge);
    if (staging) return staging.hexes.map((h) => this.canon(h)).filter((h) => this.byId.has(h));
    return this.rawEdge(this.side(edge));
  }

  /** Edges of the assembled map: W/E are the outermost columns, N/S the end hex of every column. */
  private rawEdge(edge: Side): HexId[] {
    const all = [...this.byId.values()];
    const rowOf = (h: MapHex) => h.cube.r + (h.cube.q - (h.cube.q & 1)) / 2;
    const cols = new Map<number, MapHex[]>();
    for (const h of all) cols.set(h.cube.q, [...(cols.get(h.cube.q) ?? []), h]);
    const qs = [...cols.keys()];
    let picked: MapHex[];
    switch (edge) {
      case 'W':
        picked = cols.get(Math.min(...qs))!;
        break;
      case 'E':
        picked = cols.get(Math.max(...qs))!;
        break;
      case 'N':
      case 'S':
        picked = [...cols.values()].map((list) =>
          list.reduce((best, h) => ((edge === 'N' ? rowOf(h) < rowOf(best) : rowOf(h) > rowOf(best)) ? h : best)),
        );
        break;
      default:
        throw new Error(`Unknown edge ${edge}`);
    }
    return picked.map((h) => h.id).sort();
  }

  roadHexside(a: HexId, b: HexId): boolean {
    return this.roads.has(this.pairKey(this.canon(a), this.canon(b)));
  }

  pathHexside(a: HexId, b: HexId): boolean {
    return this.paths.has(this.pairKey(this.canon(a), this.canon(b)));
  }

  /** Permanent-terrain LOS never changes during a game, so results are memoized. */
  private losCache = new Map<string, LosResult>();

  get losMode(): 'pixel' | 'grid' {
    return this.opts.los ? 'pixel' : 'grid';
  }

  los(from: HexId, to: HexId): LosResult {
    const a = this.hex(from);
    const b = this.hex(to);
    if (!a || !b) throw new Error(`los: unknown hex ${!a ? from : to}`);
    if (this.hidden.has(a.id) || this.hidden.has(b.id)) return { clear: a.id === b.id, crossed: [] };
    const k = `${a.id}>${b.id}`;
    let res = this.losCache.get(k);
    if (!res) {
      res = this.opts.los ? this.opts.los(a, b, this) : this.gridLos(a, b);
      this.losCache.set(k, res);
    }
    return res;
  }

  /** No hexside terrain on any board yet (walls, hedges: none on boards t–z). */
  hexside(_a: HexId, _b: HexId): undefined {
    return undefined;
  }

  /** LOS between heights is memoized like `los()` (permanent terrain; the season is part of the key). */
  private losAtCache = new Map<string, LosResult>();

  /**
   * LOS between two ends at given heights (full ASL; ASLRB A6.2, A6.4–A6.43, B10.2–B10.23, B14.2). The ends are put in
   * one order, higher first (then by hex id), before tracing and caching, so the LOS is the same both ways (A6.5).
   */
  losAt(from: LosEnd, to: LosEnd, opts: LosAtOptions = {}): LosResult {
    const a = this.hex(from.hex);
    const b = this.hex(to.hex);
    if (!a || !b) throw new Error(`losAt: unknown hex ${!a ? from.hex : to.hex}`);
    if (this.hidden.has(a.id) || this.hidden.has(b.id)) return { clear: a.id === b.id, crossed: [] };
    const [hi, lo] = to.height > from.height || (to.height === from.height && b.id < a.id) ? [{ ...to, hex: b.id }, { ...from, hex: a.id }] : [{ ...from, hex: a.id }, { ...to, hex: b.id }];
    const pt = (e: LosEnd) => (e.vertex !== undefined ? `v${e.vertex}` : e.side !== undefined ? `s${e.side}` : '');
    const rub = opts.rubbled ? Object.entries(opts.rubbled).map(([h, r]) => `${h}:${r.hex}${r.art !== undefined ? `/${r.art}` : ''}`).sort().join(',') : '';
    const k = `${hi.hex}@${hi.height}${pt(hi)}>${lo.hex}@${lo.height}${pt(lo)}${opts.orchardInSeason ? '+o' : ''}${opts.noBlind ? '+nb' : ''}${rub ? `+r${rub}` : ''}`;
    let res = this.losAtCache.get(k);
    if (!res) {
      const atPoint = pt(hi) !== '' || pt(lo) !== '';
      const { hexsides: _h, ...terrainOpts } = opts;
      void _h;
      res = this.opts.losAt ? this.opts.losAt(hi, lo, this, terrainOpts) : atPoint ? this.gridLosAtPoints(hi, lo, terrainOpts) : this.gridLosAt(hi, lo, terrainOpts);
      this.losAtCache.set(k, res);
    }
    // Full ASL hexside obstacles (B9.2, B29.2): a segment test on top of the terrain trace, never cached with it.
    return opts.hexsides?.length ? withHexsides(this, hi, lo, res, opts.hexsides) : res;
  }

  private bypassCache = new Map<HexId, number>();
  /**
   * The hexsides of a woods or building hex open to Bypass (ASLRB A4.3): bit k set when no obstacle depiction touches
   * hexside k. Zero for a hex that is no obstacle. Full ASL only (the Starter Kit has no Bypass).
   */
  bypassSides(id: HexId): number {
    let v = this.bypassCache.get(id);
    if (v === undefined) {
      const h = this.hex(id);
      v = !h || this.opts.losEffect(h.terrain) !== 'obstacle' ? 0 : this.opts.bypassSides ? this.opts.bypassSides(h, this) : (h.bypassBlocked ?? []).reduce((m, k) => m & ~(1 << k), 0b111111);
      this.bypassCache.set(id, v);
    }
    return v;
  }

  /** A hex's obstacle height in levels: its own (a Two Story House 1½), its terrain's, or one. */
  obstacleHeightOf(h: MapHex): number {
    return h.obstacleHeight ?? this.opts.height?.(h.terrain) ?? 1;
  }

  /**
   * The hex-level LOS between heights, `hi` the higher end. Each intervening hex is judged whole: hill ground of its
   * level (a Crest Line), its terrain obstacle on top of that, an orchard as a one-level obstacle in season to a LOS
   * to/from a higher elevation (B14.2), Hindrances only between same-level ends at their level (A6.7, B12.2, B14.21,
   * B15.2). Along a hexside the thread is blocked only where both hexes block, or one Inherent obstacle does, as in
   * `gridLos`; there the lower of the two obstacles is the one passed over.
   */
  gridLosAt(hi: LosEnd, lo: LosEnd, opts: LosAtOptions = {}): LosResult {
    const a = this.hex(hi.hex)!;
    const b = this.hex(lo.hex)!;
    const { hexes, alt } = cubeLine(a.cube, b.cube);
    const crossed: LosResult['crossed'] = [];
    const over: HeightObstacle[] = [];
    const rubbled = opts.rubbled ?? {};
    const inherent = (h: MapHex) => (rubbled[h.id] ? true : (this.opts.inherent?.(h.terrain, h) ?? false));
    /** The obstacles of one hex, lowest first, and its Hindrance (if any) for this LOS. */
    const judge = (h: MapHex, onRoad: boolean) => {
      const base = h.elevation ?? 0;
      const range = cubeDistance(a.cube, h.cube);
      const obs: HeightObstacle[] = [];
      let hindrance = false;
      if (base > lo.height) obs.push({ hex: h.id, terrain: 'hill', top: base, hexLevel: base, crest: true, range });
      const effect = this.opts.losEffect(h.terrain);
      // A hex rubbled in play: an Inherent obstacle of the rubble's height (and its standing building art's), B24.2.
      const rb = rubbled[h.id];
      if (rb) obs.push({ hex: h.id, terrain: 'rubble', top: base + Math.max(rb.hex, rb.art ?? 0), hexLevel: base, range });
      else if (effect === 'obstacle') obs.push({ hex: h.id, terrain: h.terrain, top: base + this.obstacleHeightOf(h), hexLevel: base, range });
      else if (h.terrain === 'orchard' && !onRoad) {
        const hindersHere = orchardHinders(base, lo.height, hi.height, opts.orchardInSeason ?? false, cubeDistance(h.cube, b.cube) === 1);
        if (hindersHere === 'obstacle') obs.push({ hex: h.id, terrain: h.terrain, top: base + 1, hexLevel: base, range });
        else hindrance = hindersHere;
      } else if (effect === 'hindrance') hindrance = hi.height === lo.height && lo.height === base;
      return { h, obs, hindrance };
    };
    let orchardsOver = 0;
    for (let i = 1; i < hexes.length - 1; i++) {
      const h1 = this.byCube.get(key(hexes[i]!));
      const altCube = alt[i];
      const h2 = altCube ? this.byCube.get(key(altCube)) : undefined;
      const cands = [h1, h2].filter((h): h is MapHex => !!h && h.id !== a.id && h.id !== b.id).map((h, _j, all) => judge(h, all.length === 1 && h === h1 && this.onOrchardRoad(hexes, i)));
      if (cands.length === 0) continue;
      // Along a hexside: an Inherent hex counts whole; otherwise the thread slips past the lesser of the two.
      const top = (c: (typeof cands)[number]) => Math.max(-Infinity, ...c.obs.map((o) => o.top));
      const counted = cands.length === 1 ? cands : cands.some((c) => inherent(c.h) && c.obs.length) ? cands.filter((c) => inherent(c.h)) : [cands.reduce((x, y) => (top(y) < top(x) ? y : x))];
      for (const c of counted) {
        for (const o of c.obs) {
          const e = obstacleEffect(o.top, lo.height, hi.height);
          if (e === 'blocks') return { clear: false, crossed, obstacle: { hex: o.hex, terrain: o.terrain }, ...(o.crest ? { crest: true } : {}) };
          if (e === 'over') over.push(o);
        }
      }
      for (const c of cands) {
        // Along a hexside only Inherent terrain (orchard) hinders, as in `gridLos`.
        if (!c.hindrance || (cands.length > 1 && !inherent(c.h))) continue;
        // Out of season, a LOS from more than one level above an orchard counts one +1 at most (B14.2).
        if (c.h.terrain === 'orchard' && hi.height > (c.h.elevation ?? 0) + 1 && hi.height !== lo.height && orchardsOver++ > 0) continue;
        crossed.push({ hex: c.h.id, terrain: c.h.terrain, ...(cands.length > 1 && inherent(c.h) ? { inherentHexside: true } : {}) });
      }
    }
    const blind = opts.noBlind ? undefined : over.find((o) => blindHexesBehind(o, hi.height, lo.height, b.elevation ?? 0, cubeDistance(this.hex(o.hex)!.cube, b.cube)));
    if (blind) return { clear: false, crossed, obstacle: { hex: blind.hex, terrain: blind.terrain, blind: true }, ...(blind.crest ? { crest: true } : {}) };
    return { clear: true, crossed, ...this.orchardEnds(hexes) };
  }

  /**
   * The hex-level LOS between heights when an end is a hex corner or a hexside point (Bypass, ASLRB A4.34; the A4.132
   * road point), `hi` the higher end. The straight thread between the two points is walked in small steps and each
   * step judged by the hex it is in, as `gridLosAt` judges a hex: whole-hex obstacles, Crest Lines, orchards and
   * same-level Hindrances. A centre-dot end's own hex never blocks (A6.2); a point end's hex does wherever the thread
   * crosses its interior, but not on the point itself. Along a hexside (a step equally near two hexes) the thread is
   * blocked only where both hexes block.
   */
  gridLosAtPoints(hi: LosEnd, lo: LosEnd, opts: LosAtOptions = {}): LosResult {
    const a = this.hex(hi.hex)!;
    const b = this.hex(lo.hex)!;
    const pa = losEndPoint(a, hi);
    const pb = losEndPoint(b, lo);
    const near = new Set<MapHex>();
    for (const h of this.gridLine(a, b)) {
      near.add(h);
      for (const nb of this.neighbors(h.id)) {
        const x = this.hex(nb);
        if (x) near.add(x);
      }
    }
    const centres = [...near].map((h) => ({ h, p: hexPixel(h.cube) }));
    const dist = (c: { p: { x: number; y: number } }, x: number, y: number) => Math.hypot(((x - c.p.x) / GEO.px.hexWidth) * 1.5, ((y - c.p.y) / GEO.px.hexHeight) * Math.sqrt(3));
    const exempt = new Set<HexId>();
    if (hi.vertex === undefined && hi.side === undefined) exempt.add(a.id);
    if (lo.vertex === undefined && lo.side === undefined) exempt.add(b.id);
    const rubbled = opts.rubbled ?? {};
    const inherent = (h: MapHex) => (rubbled[h.id] ? true : (this.opts.inherent?.(h.terrain, h) ?? false));
    const crossed: LosResult['crossed'] = [];
    const seen = new Set<HexId>();
    const over: HeightObstacle[] = [];
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const steps = Math.max(1, Math.ceil(len / 2));
    /** Whether hex `h` blocks this LOS, passes it over (recorded), or neither; and whether it hinders. */
    const judge = (h: MapHex): { blocks: HeightObstacle | null; over: HeightObstacle[]; hinders: boolean } => {
      const base = h.elevation ?? 0;
      const range = cubeDistance(a.cube, h.cube);
      const obs: HeightObstacle[] = [];
      let hinders = false;
      if (base > lo.height) obs.push({ hex: h.id, terrain: 'hill', top: base, hexLevel: base, crest: true, range });
      const effect = this.opts.losEffect(h.terrain);
      const rb = rubbled[h.id];
      if (rb) obs.push({ hex: h.id, terrain: 'rubble', top: base + Math.max(rb.hex, rb.art ?? 0), hexLevel: base, range });
      else if (effect === 'obstacle') obs.push({ hex: h.id, terrain: h.terrain, top: base + this.obstacleHeightOf(h), hexLevel: base, range });
      else if (h.terrain === 'orchard') {
        const o = orchardHinders(base, lo.height, hi.height, opts.orchardInSeason ?? false, cubeDistance(h.cube, b.cube) === 1);
        if (o === 'obstacle') obs.push({ hex: h.id, terrain: h.terrain, top: base + 1, hexLevel: base, range });
        else hinders = o;
      } else if (effect === 'hindrance') hinders = hi.height === lo.height && lo.height === base;
      let blocks: HeightObstacle | null = null;
      const passed: HeightObstacle[] = [];
      for (const o of obs) {
        const e = obstacleEffect(o.top, lo.height, hi.height);
        if (e === 'blocks' && !blocks) blocks = o;
        if (e === 'over') passed.push(o);
      }
      return { blocks, over: passed, hinders };
    };
    const judged = new Map<HexId, ReturnType<typeof judge>>();
    const verdict = (h: MapHex) => {
      let v = judged.get(h.id);
      if (!v) judged.set(h.id, (v = judge(h)));
      return v;
    };
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = pa.x + (pb.x - pa.x) * t;
      const y = pa.y + (pb.y - pa.y) * t;
      // The end points themselves (a corner, a hexside) are on the edge of their hexes, not inside them.
      if (Math.hypot(x - pa.x, y - pa.y) < 3 || Math.hypot(x - pb.x, y - pb.y) < 3) continue;
      const ranked = centres.map((c) => ({ h: c.h, d: dist(c, x, y) })).sort((p, q) => p.d - q.d);
      const owners = ranked.filter((r) => r.d - ranked[0]!.d < 0.02).map((r) => r.h);
      if (owners.some((h) => exempt.has(h.id))) continue;
      const vs = owners.map((h) => ({ h, v: verdict(h) }));
      const blockers = vs.filter((x) => x.v.blocks);
      // Along a hexside: blocked where both hexes block, or one Inherent obstacle does (as in `gridLos`).
      if (blockers.length && (blockers.length === vs.length || blockers.some((x) => inherent(x.h)))) {
        const o = blockers[0]!.v.blocks!;
        return { clear: false, crossed, obstacle: { hex: o.hex, terrain: o.terrain }, ...(o.crest ? { crest: true } : {}) };
      }
      for (const x of vs) {
        for (const o of x.v.over) if (!over.some((p) => p.hex === o.hex && p.terrain === o.terrain)) over.push(o);
        if (x.v.hinders && !seen.has(x.h.id) && x.h.id !== a.id && x.h.id !== b.id && (vs.length === 1 || inherent(x.h))) {
          seen.add(x.h.id);
          crossed.push({ hex: x.h.id, terrain: x.h.terrain, ...(vs.length > 1 ? { inherentHexside: true } : {}) });
        }
      }
    }
    const blind = opts.noBlind ? undefined : over.find((o) => o.hex !== b.id && blindHexesBehind(o, hi.height, lo.height, b.elevation ?? 0, cubeDistance(this.hex(o.hex)!.cube, b.cube)));
    if (blind) return { clear: false, crossed, obstacle: { hex: blind.hex, terrain: blind.terrain, blind: true }, ...(blind.crest ? { crest: true } : {}) };
    return { clear: true, crossed };
  }

  /**
   * Orchard-Road on the hex line (SK4 1.1.1 Orchard-Road, ASLRB B14.6), hex-level LOS: the line stays on the road in an
   * Orchard-Road hex when it enters and leaves the hex through road hexsides (an end hex: leaves it through one).
   */
  private onOrchardRoad(hexes: Cube[], i: number): boolean {
    const h = this.byCube.get(key(hexes[i]!));
    if (!h?.features.includes('orchard-road')) return false;
    const id = (j: number) => (j >= 0 && j < hexes.length ? this.byCube.get(key(hexes[j]!))?.id : undefined);
    const [prev, next] = [id(i - 1), id(i + 1)];
    return (prev === undefined || this.roadHexside(prev, h.id)) && (next === undefined || this.roadHexside(h.id, next));
  }

  /** The end hexes of a hex line that are Orchard-Road hexes the line leaves the road in (`LosResult.orchard`). */
  private orchardEnds(hexes: Cube[]): { orchard?: HexId[] } {
    if (hexes.length < 2) return {};
    const out = [0, hexes.length - 1]
      .map((i) => ({ i, h: this.byCube.get(key(hexes[i]!)) }))
      .filter(({ i, h }) => h?.features.includes('orchard-road') && !this.onOrchardRoad(hexes, i))
      .map(({ h }) => h!.id)
      .sort();
    return out.length ? { orchard: out } : {};
  }

  /** Hexes along the straight line between two hexes (both candidates where it runs along a hexside). */
  gridLine(a: MapHex, b: MapHex, _n?: number): MapHex[] {
    const { hexes, alt } = cubeLine(a.cube, b.cube);
    const out: MapHex[] = [];
    hexes.forEach((c, i) => {
      for (const cc of [c, alt[i]]) {
        const h = cc ? this.byCube.get(key(cc)) : undefined;
        if (h && !out.includes(h)) out.push(h);
      }
    });
    return out;
  }

  lineSteps(from: HexId, to: HexId): HexId[][] {
    const a = this.hex(from);
    const b = this.hex(to);
    if (!a || !b) throw new Error(`lineSteps: unknown hex ${!a ? from : to}`);
    const { hexes, alt } = cubeLine(a.cube, b.cube);
    const steps: HexId[][] = [];
    hexes.forEach((c, i) => {
      const ids = [c, alt[i]].map((cc) => (cc ? this.byCube.get(key(cc))?.id : undefined)).filter((id): id is HexId => !!id && id !== from && id !== to);
      if (ids.length) steps.push(ids);
    });
    return steps;
  }

  /**
   * Hex-level approximation: the thread blocks if it passes through an obstacle
   * hex's interior; along a hexside it blocks only if both hexes are obstacles.
   * Inherent terrain (orchard) hinders even along its hexsides.
   */
  gridLos(a: MapHex, b: MapHex): LosResult {
    const { hexes, alt } = cubeLine(a.cube, b.cube);
    const crossed: LosResult['crossed'] = [];
    for (let i = 1; i < hexes.length - 1; i++) {
      const h1 = this.byCube.get(key(hexes[i]!));
      const altCube = alt[i];
      const h2 = altCube ? this.byCube.get(key(altCube)) : undefined;
      const cands = [h1, h2].filter((h): h is MapHex => !!h && h.id !== a.id && h.id !== b.id);
      if (cands.length === 0) continue;
      if (cands.length === 1 || !h2) {
        const h = cands[0]!;
        if (this.opts.losEffect(h.terrain) === 'obstacle') return { clear: false, crossed };
        // Along the road through an Orchard-Road hex: no orchard Hindrance (SK4 1.1.1, ASLRB B14.6).
        if (h === h1 && this.onOrchardRoad(hexes, i)) continue;
        crossed.push({ hex: h.id, terrain: h.terrain });
        continue;
      }
      // Thread runs exactly along the hexside between two hexes: blocked by obstacles on both sides, or by
      // one Inherent obstacle (stone rubble by SSR "blocks LOS ... including along hexsides").
      const obstacle = (h: MapHex) => this.opts.losEffect(h.terrain) === 'obstacle';
      if (cands.every(obstacle) || cands.some((h) => obstacle(h) && (this.opts.inherent?.(h.terrain, h) ?? false))) return { clear: false, crossed };
      for (const h of cands) {
        const effect = this.opts.losEffect(h.terrain);
        if (effect === 'hindrance' && (this.opts.inherent?.(h.terrain, h) ?? false)) {
          crossed.push({ hex: h.id, terrain: h.terrain, inherentHexside: true });
        }
      }
    }
    return { clear: true, crossed, ...this.orchardEnds(hexes) };
  }
}

/**
 * An orchard hex's effect on a LOS between `lo` ≤ `hi` (ASLRB B14.2, B14.21): a +1 Hindrance between same-level ends at
 * its base level. In season, between a Location above its base and one at or below it, a one-level obstacle; two ends
 * above its base see over it (B10.22). Out of season, a +1 Hindrance "to any LOS drawn through it to/from a Location
 * higher than the base level", two ends above it included; but to/from a Location more than one level above, only an
 * orchard adjacent to the ground-level end counts (`nextToLow`: the orchard hex is adjacent to the lower end's hex).
 */
export function orchardHinders(base: number, lo: number, hi: number, inSeason: boolean, nextToLow: boolean): boolean | 'obstacle' {
  if (hi <= base) return hi === lo && lo === base;
  if (inSeason) return lo > base ? false : 'obstacle';
  return hi > base + 1 ? lo <= base && nextToLow : true;
}

/**
 * Where a LOS end is in map pixels: the hex centre dot, or a corner or the middle of a hexside of the hex (Bypass,
 * ASLRB A4.34; the A4.132 road point on a map with no road depiction to measure).
 */
export function losEndPoint(h: MapHex, e: LosEnd): { x: number; y: number } {
  const c = hexPixel(h.cube);
  const R = GEO.px.hexWidth * (2 / 3);
  const H = GEO.px.hexHeight / 2;
  const corner = (k: number) => {
    const m = ((k % 6) + 6) % 6;
    const off = [[R, 0], [R / 2, H], [-R / 2, H], [-R, 0], [-R / 2, -H], [R / 2, -H]][m]!;
    return { x: c.x + off[0]!, y: c.y + off[1]! };
  };
  if (e.vertex !== undefined) return corner(e.vertex);
  if (e.side !== undefined) {
    const p = corner(e.side);
    const q = corner(e.side + 1);
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  }
  return c;
}

/** Where segment p→q meets segment r→s: the fractions along each, or null when parallel. */
function segmentHit(p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }, s: { x: number; y: number }): { t: number; u: number } | null {
  const dx = q.x - p.x, dy = q.y - p.y, ex = s.x - r.x, ey = s.y - r.y;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9 * (Math.hypot(dx, dy) * Math.hypot(ex, ey) || 1)) return null;
  const t = ((r.x - p.x) * ey - (r.y - p.y) * ex) / den;
  const u = ((r.x - p.x) * dy - (r.y - p.y) * dx) / den;
  return { t, u };
}
const sideOf = (p: { x: number; y: number }, q: { x: number; y: number }, z: { x: number; y: number }) => (q.x - p.x) * (z.y - p.y) - (q.y - p.y) * (z.x - p.x);
const near = (p: { x: number; y: number }, q: { x: number; y: number }, d = 1) => Math.hypot(p.x - q.x, p.y - q.y) < d;

/**
 * How the thread between two LOS ends meets one hexside obstacle (pure geometry, map pixels): crossed between its ends
 * (vertices included, B9.1), run along exactly, ended at one of its vertices, or across an extension segment.
 */
export function hexsideCrossing(map: Pick<GameMap, 'hex'>, from: LosEnd, to: LosEnd, o: HexsideObstacle): HexsideCrossing {
  const ha = map.hex(o.a)!;
  const A = losEndPoint(map.hex(from.hex)!, from);
  const B = losEndPoint(map.hex(to.hex)!, to);
  const P = losEndPoint(ha, { hex: o.a, height: 0, vertex: o.k });
  const Q = losEndPoint(ha, { hex: o.a, height: 0, vertex: o.k + 1 });
  const out: HexsideCrossing = { id: o.id, crossed: false, along: false };
  const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  const off = (z: { x: number; y: number }) => Math.abs(sideOf(A, B, z)) / len;
  if (off(P) < 0.75 && off(Q) < 0.75) {
    // Collinear: along the hexside where the thread overlaps it (more than at a single point).
    const proj = (z: { x: number; y: number }) => ((z.x - A.x) * (B.x - A.x) + (z.y - A.y) * (B.y - A.y)) / (len * len);
    const [lo, hi] = [proj(P), proj(Q)].sort((x, y) => x - y) as [number, number];
    if (Math.min(hi, 1) - Math.max(lo, 0) > 0.05) out.along = true;
  } else {
    const h = segmentHit(A, B, P, Q);
    if (h && h.u >= -0.02 && h.u <= 1.02 && h.t > 0.01 && h.t < 0.99) out.crossed = true;
  }
  // A thread ending at a vertex of the hexside (a Bypass corner, a Snap Shot's corner, B9.42): which side the other end is on.
  for (const [end, other] of [[A, B], [B, A]] as const) {
    if (!out.along && (near(end, P) || near(end, Q))) {
      const sb = sideOf(P, Q, other);
      const ca = sideOf(P, Q, losEndPoint(ha, { hex: o.a, height: 0 }));
      out.vertexFrom = Math.abs(sb) < 1 ? null : Math.sign(sb) === Math.sign(ca) ? o.a : o.b;
    }
  }
  const ext: HexId[] = [];
  for (const e of o.extension) {
    const V = losEndPoint(ha, { hex: o.a, height: 0, vertex: e.vertex });
    const C = losEndPoint(map.hex(e.hex)!, { hex: e.hex, height: 0 });
    const h = segmentHit(A, B, V, C);
    if (h && h.u >= 0 && h.u <= 1 && h.t > 0.01 && h.t < 0.99) ext.push(e.hex);
  }
  if (ext.length) out.extension = ext;
  return out;
}

/**
 * Whether a hexside obstacle blocks the thread (B9.2, A6.21, B29.2, B9.6): only a same-level LOS at its level, never through
 * a hexside of the viewing or target hex (nor an extension into the end's own hex, read as part of the same wall), and
 * along the hexside only when neither end hex touches it.
 */
export function hexsideBlocks(map: Pick<GameMap, 'hex'>, hi: LosEnd, lo: LosEnd, o: HexsideObstacle, c: HexsideCrossing): boolean {
  if (hi.height !== lo.height || hi.height > o.level) return false;
  const ends = [hi.hex, lo.hex];
  if (c.crossed && !ends.includes(o.a) && !ends.includes(o.b)) return true;
  if (c.along) {
    const ha = map.hex(o.a)!;
    const P = losEndPoint(ha, { hex: o.a, height: 0, vertex: o.k });
    const Q = losEndPoint(ha, { hex: o.a, height: 0, vertex: o.k + 1 });
    const touches = (id: HexId) => [0, 1, 2, 3, 4, 5].some((v) => {
      const z = losEndPoint(map.hex(id)!, { hex: id, height: 0, vertex: v });
      return near(z, P) || near(z, Q);
    });
    if (!ends.some(touches)) return true;
  }
  // The extension: never a LOS into or out of the centre dot of its own hex (B9.2 read for the extension).
  const centreEnd = (id: HexId) => (hi.hex === id && hi.vertex === undefined && hi.side === undefined) || (lo.hex === id && lo.vertex === undefined && lo.side === undefined);
  return (c.extension ?? []).some((x) => !centreEnd(x));
}

function withHexsides(map: Pick<GameMap, 'hex'>, hi: LosEnd, lo: LosEnd, res: LosResult, obstacles: HexsideObstacle[]): LosResult {
  const crossings: HexsideCrossing[] = [];
  let block: { o: HexsideObstacle } | null = null;
  for (const o of obstacles) {
    if (!map.hex(o.a) || !map.hex(o.b)) continue;
    const c = hexsideCrossing(map, hi, lo, o);
    if (!c.crossed && !c.along && c.vertexFrom === undefined && !c.extension) continue;
    crossings.push(c);
    if (!block && hexsideBlocks(map, hi, lo, o, c)) block = { o };
  }
  if (!crossings.length) return res;
  if (!res.clear || !block) return { ...res, hexsides: crossings };
  const ha = map.hex(block.o.a)!;
  const P = losEndPoint(ha, { hex: block.o.a, height: 0, vertex: block.o.k });
  const Q = losEndPoint(ha, { hex: block.o.a, height: 0, vertex: block.o.k + 1 });
  const A = losEndPoint(map.hex(hi.hex)!, hi);
  const B = losEndPoint(map.hex(lo.hex)!, lo);
  const h = segmentHit(A, B, P, Q);
  const at = h ? { x: A.x + (B.x - A.x) * h.t, y: A.y + (B.y - A.y) * h.t } : { x: (P.x + Q.x) / 2, y: (P.y + Q.y) / 2 };
  return { clear: false, crossed: res.crossed, blockedAt: at, obstacle: { hex: block.o.a, terrain: block.o.kind, hexside: [block.o.a, block.o.b] }, hexsides: crossings };
}
