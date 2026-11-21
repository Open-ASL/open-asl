import type { Action, HexId } from '@asl/engine';

/** The part of the map the board needs to draw offboard hexes. */
interface OffboardMap<H extends { id: HexId } = { id: HexId }> {
  hex(id: HexId): unknown;
  offboardHex(id: HexId): H | undefined;
  offboard(edges: string): H[];
  offboardNeighbors(id: HexId): { onboard: HexId[] };
}

/** The offboard hexes a legal `move.step` enters now, sorted and joined (a stable memo key). */
export function offboardStepKey(legal: readonly Action[], map: OffboardMap): string {
  return legal
    .filter((a) => a.type === 'move.step' && typeof a['to'] === 'string' && !map.hex(a['to']) && !!map.offboardHex(a['to']))
    .map((a) => a['to'] as string)
    .sort()
    .join(',');
}

/**
 * The offboard hexes the board draws and lets a player click: along the edges units enter by, beyond the map's exit
 * hexes (a stack leaves the map with an ordinary step), and any other a step may enter now (a Recalled AFV leaves off
 * its friendly board edge whatever the scenario's exit rules, SK4 7.10). Each argument is a comma-joined list.
 */
export function offboardShown<H extends { id: HexId }>(map: OffboardMap<H>, entryEdges: string, exitAreas: string, steps: string): H[] {
  const seen = new Set<string>();
  const exits = new Set(exitAreas.split(',').filter(Boolean));
  const beyondExits = exits.size ? map.offboard('N,E,S,W').filter((o) => map.offboardNeighbors(o.id).onboard.some((h) => exits.has(h))) : [];
  const stepsOff = steps
    .split(',')
    .filter(Boolean)
    .map((id) => map.offboardHex(id))
    .filter((h): h is H => !!h);
  return [
    ...entryEdges
      .split(',')
      .filter(Boolean)
      .flatMap((e) => map.offboard(e)),
    ...beyondExits,
    ...stepsOff,
  ].filter((h) => !seen.has(h.id) && !!seen.add(h.id));
}
