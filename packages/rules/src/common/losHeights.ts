import type { HexId } from '@asl/engine';

/*
 * LOS between heights (full ASL; ASLRB A6.2, A6.4–A6.43, B10.2–B10.23). The map tracers (`HexGridMap.losAt`, the
 * pixel tracer in the content package) walk the thread from the higher end and hand every obstacle under it to
 * these functions. Heights are absolute levels: a hex's elevation plus a building level, an obstacle's top its
 * hex's level plus its own height (B10.1, B13.2, B23.2).
 *
 * One test for every obstacle (`obstacleEffect`), with `lo`/`hi` the lower/higher end's height and `top` the
 * obstacle's:
 * - lo ≥ top: no effect (both ends at or above it: B10.22, B23.2 "an intervening same-level obstacle never blocks
 *   the LOS of same-level units").
 * - hi ≤ top: blocked (B10.22: a unit needs "a height at least equal" to the obstacle to see past it to a same-level
 *   target, and an "elevation advantage" over it to a lower one; A6.2 EX, B14.2 EX).
 * - otherwise the LOS passes over it, unless the lower end is in one of its Blind Hexes (A6.4; B10.23 for hill ground).
 */

/** An obstacle the thread passes over or into, as the tracers report it. */
export interface HeightObstacle {
  hex: HexId;
  /** The terrain (or 'hill' for bare higher ground: a Crest Line). */
  terrain: string;
  /** Absolute top of the obstacle in levels (a Two Story House on ground level: 1.5). */
  top: number;
  /** Level of the hex the obstacle is in (ASLRB A6.43 compares it with the hex behind). */
  hexLevel: number;
  /** Hill ground rather than terrain on it: a Crest Line, whose Blind Hexes follow B10.23. */
  crest?: boolean;
  /** Range in hexes from the higher end's hex to the obstacle's hex (A6.41, B10.23). */
  range: number;
  /** Where the thread meets it, in map pixels (pixel LOS only). */
  at?: { x: number; y: number };
}

export type ObstacleEffect = 'none' | 'blocks' | 'over';

/** What an obstacle does to a LOS between ends at heights `lo` ≤ `hi` (see above). */
export function obstacleEffect(top: number, lo: number, hi: number): ObstacleEffect {
  if (lo >= top) return 'none';
  if (hi <= top) return 'blocks';
  return 'over';
}

/** Full levels of elevation advantage over an obstacle beyond the first (ASLRB A6.42: each takes one Blind Hex off). */
const advantageOver = (top: number, hi: number) => Math.max(0, Math.floor(hi) - Math.floor(top) - 1);

/**
 * How many hexes behind a terrain obstacle are Blind Hexes to a viewer at height `hi` (ASLRB A6.4, A6.41, A6.42),
 * before the A6.43 adjustment for the hex judged: one, plus one per full five hexes of range to it, less one per full
 * level of elevation advantage over its full-level height beyond the first, never below one. The A6.42 EX: a 1½-level
 * obstacle 12 hexes away makes three from level 2, two from level 3, one from level 4.
 */
export function blindHexCount(o: Pick<HeightObstacle, 'top' | 'range'>, hi: number): number {
  return Math.max(1, 1 + Math.floor(o.range / 5) - advantageOver(o.top, hi));
}

/**
 * How many hexes behind a Crest Line are Blind Hexes to a viewer at height `hi`, for a hex behind it at level
 * `lowHexLevel` (ASLRB B10.23): one per full five hexes of range (none within four), plus any drop beyond one level
 * between the Crest Line and that hex (A6.43 as B10.23 applies it); within five hexes only when the drop is two levels or
 * more and the Crest Line is not adjacent to the viewer, then at least one; then less one per full level of elevation advantage beyond the first, down to none.
 */
export function crestBlindHexCount(o: Pick<HeightObstacle, 'top' | 'range'>, hi: number, lowHexLevel: number): number {
  const drop = o.top - lowHexLevel;
  if (o.range < 5 && !(drop >= 2 && o.range > 1)) return 0;
  const n = Math.max(1, Math.floor(o.range / 5) + Math.max(0, drop - 1));
  return Math.max(0, n - advantageOver(o.top, hi));
}

/**
 * Whether the lower end of a LOS is in a Blind Hex of `o` (ASLRB A6.4–A6.43, B10.23). `lowHeight` is the lower end's
 * height (its Location: a unit on level 1 behind a ground-level obstacle is at the obstacle's full-level height and
 * not blind, A6.4, B10.22), `lowHexLevel` its hex's level, `behind` its range from the obstacle's hex ("directly
 * behind": the thread runs straight on from the obstacle to it). A6.43: the difference between the obstacle hex's
 * level and the hex behind is added when that hex is lower, taken off when it is higher.
 */
export function blindHexesBehind(o: HeightObstacle, hi: number, lowHeight: number, lowHexLevel: number, behind: number): boolean {
  if (lowHeight >= Math.floor(o.top)) return false;
  const n = o.crest ? crestBlindHexCount(o, hi, lowHexLevel) : blindHexCount(o, hi) + (o.hexLevel - lowHexLevel);
  return behind <= n;
}
