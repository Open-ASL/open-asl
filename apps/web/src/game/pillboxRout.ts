import type { HexId, PieceId, QueryEnv, SideId } from '@asl/engine';
import { fortificationView, hexOfLoc, pillboxKnownToSide, pillboxLoc, pillboxMf } from '@asl/rules';

/** How a pillbox reads to a broken unit about to rout (full ASL, ASLRB B30.5: a building for rout). */
export interface PillboxRoutMark {
  /** The short tag on the pillbox counter. */
  chip: string;
  /** The hex readout's line: its MF, or why the rout may not go in. */
  text: string;
  barred: boolean;
}

/**
 * The pillboxes a router may make for, each marked on its own counter: a ROUT END (its Location is one of the nearest
 * shelters) with the MF of going in, or barred with the rule that bars it. A pillbox next to the router (or in its hex)
 * is judged by the rout step itself; a farther one is marked only when it is a ROUT END. The pillbox the router is in
 * is not marked.
 */
export function pillboxRoutMarks(
  env: QueryEnv,
  side: SideId,
  unit: PieceId,
  ends: ReadonlySet<string> | null,
  neighbors: (hex: HexId) => readonly HexId[],
  check: (action: { type: 'rout.step'; unit: PieceId; to: string }) => string | null,
): Map<HexId, PillboxRoutMark> {
  const marks = new Map<HexId, PillboxRoutMark>();
  const loc = env.state.pieces[unit]?.loc;
  if (!loc || loc.kind !== 'hex') return marks;
  const at = loc.hex;
  const inside = loc.sub === 'pb';
  const endHexes = new Set([...(ends ?? [])].map((l) => hexOfLoc(l)));
  for (const c of fortificationView(env, side)) {
    if (c.kind !== 'pillbox') continue;
    const pb = pillboxKnownToSide(env, c.hex, side);
    if (!pb || (inside && c.hex === at)) continue;
    const mf = pillboxMf(env, pb, side);
    const end = !!ends && (ends.has(pillboxLoc(c.hex)) || endHexes.has(c.hex));
    const near = c.hex === at || neighbors(at).includes(c.hex);
    if (!near) {
      if (end) marks.set(c.hex, { chip: `ROUT END +${mf} MF`, text: `Pillbox: a ROUT END, +${mf} MF to go in (ASLRB B30.5, B30.41)`, barred: false });
      continue;
    }
    const why = check({ type: 'rout.step', unit, to: pillboxLoc(c.hex) });
    if (why) {
      marks.set(c.hex, { chip: 'ROUT BARRED', text: `Pillbox barred: ${why}`, barred: true });
      continue;
    }
    const oneExpenditure = c.hex !== at ? ', entered with the hex as one expenditure: no Interdiction here' : '';
    marks.set(c.hex, { chip: end ? `ROUT END +${mf} MF` : `+${mf} MF`, text: `Pillbox${end ? ': a ROUT END' : ''}: +${mf} MF${oneExpenditure} (ASLRB B30.5, B30.41)`, barred: false });
  }
  return marks;
}
