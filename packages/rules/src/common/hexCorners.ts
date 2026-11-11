import type { Cube, HexId } from '@asl/engine';
import { GEO, hexPixel } from './map';
import type { GameMap } from './statics';

/**
 * Hex corners (vertices) and hexsides in map pixels, for Bypass (ASLRB A4.3, A4.34) and the A4.132 road point.
 *
 * Hexes are flat-topped. Corner `k` (0–5) runs clockwise on the map (y down) from the east corner: 0 east, 1
 * south-east, 2 south-west, 3 west, 4 north-west, 5 north-east. Hexside `k` runs from corner `k` to corner `k + 1`
 * (0 faces south-east, 1 south, 2 south-west, 3 north-west, 4 north, 5 north-east). A corner is named in actions and
 * logs by the two other hexes that meet at it (ASLRB A2.2 notation "D4-C4-D3": the hex itself first).
 */

const R = GEO.px.hexWidth * (2 / 3);
const HALF_H = GEO.px.hexHeight / 2;
const OFFSETS: readonly [number, number][] = [
  [R, 0],
  [R / 2, HALF_H],
  [-R / 2, HALF_H],
  [-R, 0],
  [-R / 2, -HALF_H],
  [R / 2, -HALF_H],
];

export const mod6 = (k: number) => ((k % 6) + 6) % 6;

/** A hex corner's offset from the hex centre, in map pixels. */
export const cornerOffset = (k: number): { x: number; y: number } => {
  const [x, y] = OFFSETS[mod6(k)]!;
  return { x, y };
};

/** A hex corner in map pixels. */
export function cornerPoint(cube: Cube, k: number): { x: number; y: number } {
  const c = hexPixel(cube);
  const o = cornerOffset(k);
  return { x: c.x + o.x, y: c.y + o.y };
}

/** The middle of a hexside in map pixels. */
export function sidePoint(cube: Cube, k: number): { x: number; y: number } {
  const a = cornerPoint(cube, k);
  const b = cornerPoint(cube, k + 1);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** The hexside of `hex` it shares with the adjacent hex `nb`, or null when they are not adjacent. */
export function sideToward(map: Pick<GameMap, 'hex' | 'offboardHex'>, hex: HexId, nb: HexId): number | null {
  const a = map.hex(hex) ?? map.offboardHex(hex);
  const b = map.hex(nb) ?? map.offboardHex(nb);
  if (!a || !b) return null;
  const pa = hexPixel(a.cube);
  const pb = hexPixel(b.cube);
  for (let k = 0; k < 6; k++) {
    const m = sidePoint(a.cube, k);
    if (Math.hypot(pa.x + 2 * (m.x - pa.x) - pb.x, pa.y + 2 * (m.y - pa.y) - pb.y) < 2) return k;
  }
  return null;
}

/** The hex across hexside `k` of `hex` (a map hex or an offboard one), if any. */
export function acrossSide(map: Pick<GameMap, 'hex' | 'neighbors' | 'offboardHex'>, hex: HexId, k: number): HexId | undefined {
  return map.neighbors(hex).find((nb) => sideToward(map, hex, nb) === mod6(k));
}

/** The other two hexes meeting at corner `k` of `hex`: those across hexsides k − 1 and k (on the map only). */
export function cornerHexes(map: Pick<GameMap, 'hex' | 'neighbors' | 'offboardHex'>, hex: HexId, k: number): HexId[] {
  return [acrossSide(map, hex, k - 1), acrossSide(map, hex, k)].filter((h): h is HexId => !!h && !!map.hex(h));
}

/** The corner of `hex` that lies at the same map point as corner `k` of `other` (a hex meeting it there), or null. */
export function sameCorner(map: Pick<GameMap, 'hex'>, other: HexId, k: number, hex: HexId): number | null {
  const a = map.hex(other);
  const b = map.hex(hex);
  if (!a || !b) return null;
  const p = cornerPoint(a.cube, k);
  for (let j = 0; j < 6; j++) {
    const q = cornerPoint(b.cube, j);
    if (Math.hypot(p.x - q.x, p.y - q.y) < 2) return j;
  }
  return null;
}

/** The corner of `hex` where the two given hexes meet it (both adjacent to it and to each other), or null. */
export function cornerBetween(map: Pick<GameMap, 'hex' | 'neighbors' | 'offboardHex'>, hex: HexId, a: HexId, b: HexId): number | null {
  for (let k = 0; k < 6; k++) {
    const hs = [acrossSide(map, hex, k - 1), acrossSide(map, hex, k)];
    if ((hs[0] === a && hs[1] === b) || (hs[0] === b && hs[1] === a)) return k;
  }
  return null;
}

/** A corner's name for actions and logs: the two other hexes meeting there, sorted (ASLRB A2.2). */
export function cornerName(map: Pick<GameMap, 'hex' | 'neighbors' | 'offboardHex'>, hex: HexId, k: number): [HexId, HexId] | null {
  const hs = [acrossSide(map, hex, k - 1), acrossSide(map, hex, k)];
  if (!hs[0] || !hs[1]) return null;
  return [hs[0], hs[1]].sort() as [HexId, HexId];
}

/** "R3-S4-R4": a corner of `hex` written as the rulebook does, the hex itself first, without board letters. */
export function cornerLabel(map: Pick<GameMap, 'hex' | 'neighbors' | 'offboardHex'>, hex: HexId, k: number): string {
  const short = (h: HexId) => map.hex(h)?.colLabel !== undefined ? `${map.hex(h)!.colLabel}${map.hex(h)!.row}` : h;
  const hs = [acrossSide(map, hex, k - 1), acrossSide(map, hex, k)];
  return [hex, ...hs].map((h) => (h ? short(h) : '?')).join('-');
}
