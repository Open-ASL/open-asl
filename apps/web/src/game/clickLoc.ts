import type { Action, HexId, PieceId } from '@asl/engine';
import { hexOfLoc } from '@asl/rules';

/**
 * The Location a click on `hex` stands for among step targets `tos` (Location ids) of units standing in `from`: the
 * hex itself when it is one; in full ASL, for units upstairs, the same floor of that hex. A level of `from` itself
 * (the stairs) is never a click on the map but a wheel entry (ASLRB B23.4). In the Starter Kit this is `hex`.
 */
export function clickLoc(tos: string[], hex: HexId, from?: HexId | null): string {
  if (tos.includes(hex) || hex === from) return hex;
  return tos.find((t) => hexOfLoc(t) === hex) ?? hex;
}

/**
 * The Locations `units` may advance into, from the legal advances that move any of them (those of the same
 * Location as the selection). Another stack's targets never count: a stack on the ground may advance into the
 * ground level of a building hex while one upstairs beside it may only advance along its floor (ASLRB A4.7, B23.422).
 */
export function advanceTos(legal: Action[], units: PieceId[]): string[] {
  return legal.filter((a) => a.type === 'advance' && (a['units'] as PieceId[]).some((u) => units.includes(u))).map((a) => a['to'] as string);
}
