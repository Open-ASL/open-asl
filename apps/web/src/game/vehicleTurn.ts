import type { HexId } from '@asl/engine';
import { nearestSpine } from '@asl/rules';

type Cube = { q: number; r: number; s: number };
interface TurnMap {
  hex(id: HexId): { cube: Cube } | undefined;
  offboardHex(id: HexId): { cube: Cube } | undefined;
  neighbors(id: HexId): HexId[];
  offboardNeighbors(id: HexId): { onboard: HexId[]; offboard: HexId[] };
}

/**
 * The hex a moving stack stands in: its map hex, or the offboard hex it waits in to enter. Units offboard move "per
 * normal Open Ground movement costs" (SK4 3.3; ASLRB A2.51), and a VCA change is movement (SK4 3.3.2, ASLRB D2.11).
 */
export function moverHex(ms: { hex?: HexId | null; off?: HexId | null } | null | undefined): HexId | null {
  return ms?.hex ?? ms?.off ?? null;
}

/** The hexspine a moving vehicle in `from` turns its hull to when a neighbouring hex `to` is clicked; null when `to` is no neighbour. */
export function turnSpineToward(map: TurnMap, from: HexId, to: HexId, vca: number): number | null {
  if (from === to) return null;
  const onMap = !!map.hex(from);
  const near = onMap ? map.neighbors(from) : [...map.offboardNeighbors(from).onboard, ...map.offboardNeighbors(from).offboard];
  if (!near.includes(to)) return null;
  const a = map.hex(from) ?? map.offboardHex(from);
  const b = map.hex(to) ?? map.offboardHex(to);
  return a && b ? nearestSpine(a.cube, vca, b.cube) : null;
}
