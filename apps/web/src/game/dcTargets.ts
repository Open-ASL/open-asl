import type { Action, HexId, PieceId, QueryEnv } from '@asl/engine';
import { adjacentLocs, defOf, hexOfLoc, moveLoc, moveState, pillboxKnownToSide, pillboxLoc, statics, swHeldBy, vehicle as vehicleDef } from '@asl/rules';

export type DcPlacement = Omit<Action, 'side' | 'decisionId'> & { vehicle?: PieceId };

/**
 * Placing the moving stack's DC into `target` (SK4 4.3, ASLRB A23.3): the action, or null when the moving stack carries
 * none. An enemy AFV there is the target (a PAATC first); right-click the hex to place it in the hex instead.
 */
export function dcPlacement(env: QueryEnv, side: string | null | undefined, target: string): DcPlacement | null {
  const ms = moveState(env);
  if (!ms) return null;
  const dc = ms.units.flatMap((u) => swHeldBy(env.state, u)).find((s) => (defOf(env, s) as { type?: string }).type === 'DC');
  if (!dc) return null;
  const hex = hexOfLoc(target);
  const afv = Object.values(env.state.pieces).find((p) => p.side !== side && p.loc.kind === 'hex' && p.loc.hex === hex && vehicleDef(env, p) && !p.tags['wreck']);
  return { type: 'move.placeDc', dc: dc.id, target, ...(afv ? { vehicle: afv.id } : {}) };
}

/**
 * The adjacent hexes the moving stack may place its DC in now (SK1 4.3, SK4 4.3), and when there is none, the engine's
 * reason (no MF left, say). Every Location of a hex the stack is ADJACENT to counts (a Cave as well as its hill, S70
 * SSR 2); in full ASL so does a pillbox it knows of in its own hex (ASLRB B30.2, B30.31), which is placeable but not a
 * hex to highlight.
 */
export function dcTargets(env: QueryEnv, side: string | null | undefined, check: (a: DcPlacement) => string | null | undefined, fullAsl: boolean): { hexes: HexId[]; why: string | null } {
  const ms = moveState(env);
  if (!ms?.hex) return { hexes: [], why: null };
  const near = adjacentLocs(env, moveLoc(ms)!);
  const hexes: HexId[] = [];
  let why: string | null = null;
  for (const h of statics(env).map.neighbors(ms.hex)) {
    const locs = near.filter((l) => hexOfLoc(l) === h);
    for (const l of locs.length ? locs : [h]) {
      const place = dcPlacement(env, side, l);
      const err = place ? check(place) : null;
      if (place && !err) {
        hexes.push(h);
        break;
      }
      why ??= err ?? null;
    }
  }
  if (!hexes.length && fullAsl && ms.sub !== 'pb' && pillboxKnownToSide(env, ms.hex, side ?? null)) {
    const place = dcPlacement(env, side, pillboxLoc(ms.hex));
    if (place && !check(place)) return { hexes, why: null };
  }
  return { hexes, why: hexes.length ? null : why };
}
