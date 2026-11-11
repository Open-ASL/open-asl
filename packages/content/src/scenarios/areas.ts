import { boardHexes, buildMap } from '../maps';

/*
 * Helpers for writing scenario cards as data: the card says "on/east-of hexrow R" or "hexes
 * numbered ≥ 4"; these turn such phrases into hex lists from the board data.
 */

/** Hexrow letters to a column index: A=1 … Z=26, AA=27 … GG=33. */
export const hexrowIndex = (row: string): number => (row.length === 1 ? row.charCodeAt(0) - 64 : 26 + row.charCodeAt(1) - 64);

export interface HexParts {
  id: string;
  board: string;
  row: string;
  col: number;
  n: number;
}

export function parseHex(id: string): HexParts | null {
  const m = id.match(/^([a-z])([A-Z]+)(\d+)$/);
  return m ? { id, board: m[1]!, row: m[2]!, col: hexrowIndex(m[2]!), n: Number(m[3]) } : null;
}

/** Every printed hex of a board (no offboard or half-hex ids). */
export function hexesOf(board: string): HexParts[] {
  return Object.keys(boardHexes(board))
    .map(parseHex)
    .filter((h): h is HexParts => !!h);
}

export interface HexFilter {
  /** Inclusive hexrow range, e.g. ['R', 'GG']. */
  rows?: [string, string];
  /** Inclusive hex number range, e.g. [4, 10]. */
  numbered?: [number, number];
  /** Terrain id the printed hex must have. */
  terrain?: string;
  /** Elevation the printed hex must have ("on Level 1 terrain"); 0 is ground level. */
  elevation?: number;
}

/** Hex ids of a board matching the filter, in board order. */
export function hexesWhere(board: string, f: HexFilter): string[] {
  const hexes = boardHexes(board);
  return hexesOf(board)
    .filter((h) => {
      if (f.rows && (h.col < hexrowIndex(f.rows[0]) || h.col > hexrowIndex(f.rows[1]))) return false;
      if (f.numbered && (h.n < f.numbered[0] || h.n > f.numbered[1])) return false;
      if (f.terrain && hexes[h.id]?.terrain !== f.terrain) return false;
      if (f.elevation !== undefined && (hexes[h.id]?.elevation ?? 0) !== f.elevation) return false;
      return true;
    })
    .map((h) => h.id);
}

/**
 * The hexes on each side of a hexgrain the card draws as a setup boundary ("set up north of
 * hexgrain A9-K4-P4"). `grain` lists the line's hexes column by column, as hexrow + number
 * without the board letter; within each of those hexrows (limited to `rows`) a hex with a lower
 * number is north of the line, a higher one south, and the line's own hexes are in neither.
 */
export function hexgrainSplit(board: string, grain: string[], rows: [string, string]): { grain: string[]; north: string[]; south: string[] } {
  const line = new Map<string, number>();
  for (const g of grain) {
    const m = g.match(/^([A-Z]+)(\d+)$/);
    if (!m) throw new Error(`Bad hexgrain hex ${g}`);
    line.set(m[1]!, Number(m[2]));
  }
  const out = { grain: [] as string[], north: [] as string[], south: [] as string[] };
  for (const h of hexesOf(board)) {
    if (h.col < hexrowIndex(rows[0]) || h.col > hexrowIndex(rows[1])) continue;
    const n = line.get(h.row);
    if (n === undefined) throw new Error(`Hexgrain does not cross hexrow ${h.row}`);
    (h.n < n ? out.north : h.n > n ? out.south : out.grain).push(h.id);
  }
  return out;
}

/** The building id of a building hex (throws for any other hex, so a card's hex is checked against the board). */
export function buildingAt(board: string, hex: string): string {
  const b = boardHexes(board)[hex]?.buildingId;
  if (!b) throw new Error(`${hex} is not a building hex on board ${board}`);
  return b;
}

/** Building hexes (hexes with a building id) matching the filter, in board order. */
export function buildingHexesWhere(board: string, f: HexFilter): string[] {
  const hexes = boardHexes(board);
  return hexesWhere(board, f).filter((h) => !!hexes[h]?.buildingId);
}

/** Every hex of the building a hex belongs to ("building P9"). */
export function buildingHexesOf(board: string, hex: string): string[] {
  const b = buildingAt(board, hex);
  return Object.entries(boardHexes(board))
    .filter(([, spec]) => spec.buildingId === b)
    .map(([id]) => id);
}

/** Building ids of more than one hex whose every hex matches the filter ("multi-hex buildings between hexrows I and Q"). */
export function multiHexBuildingsWhere(board: string, f: HexFilter): string[] {
  const hexes = boardHexes(board);
  return buildingsWhere(board, f).filter((b) => Object.values(hexes).filter((spec) => spec.buildingId === b).length > 1);
}

/** Building ids whose every hex matches the filter. */
export function buildingsWhere(board: string, f: HexFilter): string[] {
  const hexes = boardHexes(board);
  const inside = new Set(hexesWhere(board, f));
  const byBuilding = new Map<string, string[]>();
  for (const [id, spec] of Object.entries(hexes)) if (spec.buildingId) byBuilding.set(spec.buildingId, [...(byBuilding.get(spec.buildingId) ?? []), id]);
  return [...byBuilding].filter(([, ids]) => ids.every((h) => inside.has(h))).map(([b]) => b);
}

/**
 * The hexes of a board's row-1 ('N') or row-10 ('S') edge within a hexrow range: the half hex
 * (row 0 or 10) of a hexrow that has one, else its row 1 or 9 hex. A card's "off the west edge
 * on/between I1-Y1" on a board turned so row 1 faces west.
 */
export function edgeHexesWhere(board: string, side: 'N' | 'S', rows: [string, string]): string[] {
  const byCol = new Map<number, HexParts[]>();
  for (const h of hexesOf(board)) {
    if (h.col < hexrowIndex(rows[0]) || h.col > hexrowIndex(rows[1])) continue;
    byCol.set(h.col, [...(byCol.get(h.col) ?? []), h]);
  }
  return [...byCol.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, hs]) => hs.sort((a, b) => a.n - b.n)[side === 'N' ? 0 : hs.length - 1]!.id);
}

/** The building hexes of a board within `range` hexes of `center` ("building hexes ≤ 2 hexes from S6"). */
export function buildingHexesWithin(board: string, center: string, range: number): string[] {
  const hexes = boardHexes(board);
  return hexesWithin(board, center, range).filter((h) => !!hexes[h]?.buildingId);
}

/** Hex ids of a board within `range` hexes of `center` (the centre included), in board order. */
export function hexesWithin(board: string, center: string, range: number): string[] {
  const map = buildMap([{ board, x: 0, y: 0 }], { los: 'grid' });
  if (!map.hex(center)) throw new Error(`${center} is not a hex of board ${board}`);
  return hexesOf(board)
    .filter((h) => map.hex(h.id) && map.distance(center, h.id) <= range)
    .map((h) => h.id);
}

/**
 * The connected masses of a set of hexes of one board, each in board order, ordered by their first hex: the separate
 * hills of "the 4 hills of each board" (LMA7), from the board's hill hexes. A mass is the hexes joined hex to hex.
 */
export function hexMasses(board: string, hexes: string[]): string[][] {
  const map = buildMap([{ board, x: 0, y: 0 }], { los: 'grid' });
  const order = new Map(hexesOf(board).map((h, i) => [h.id, i]));
  const left = new Set(hexes);
  const out: string[][] = [];
  for (const start of [...hexes].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))) {
    if (!left.has(start)) continue;
    left.delete(start);
    const mass = [start];
    for (let i = 0; i < mass.length; i++)
      for (const n of map.neighbors(mass[i]!))
        if (left.has(n)) {
          left.delete(n);
          mass.push(n);
        }
    out.push(mass.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)));
  }
  return out;
}

/**
 * The two sides of a line of hexes across a map of several boards (S70: "the mA6-mG5-mJ7-nV6-nA6 road", listed hex by
 * hex): `north` is every hex reached from `from` without crossing the line, `south` the rest; the line's own hexes are
 * in neither. A flood fill, not a hexrow comparison, so a road that loops back (mH5-mI6-mJ6-mJ7-mJ8-mI9) leaves the
 * hexes inside its bend on the side they open onto.
 */
export function lineSplit(boards: Parameters<typeof buildMap>[0], line: string[], from: string): { north: string[]; south: string[] } {
  const map = buildMap(boards, { los: 'grid' });
  for (const h of line) if (!map.hex(h)) throw new Error(`${h} is not a hex of the map`);
  if (line.includes(from)) throw new Error(`${from} is on the line`);
  const onLine = new Set(line);
  const north = new Set([from]);
  const queue = [from];
  while (queue.length) for (const n of map.neighbors(queue.shift()!)) if (!onLine.has(n) && !north.has(n)) north.add(n), queue.push(n);
  const all = [...map.hexes()].map((h) => h.id).filter((h) => !onLine.has(h));
  return { north: all.filter((h) => north.has(h)), south: all.filter((h) => !north.has(h)) };
}
