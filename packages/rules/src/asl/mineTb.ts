import type { Ctx, HexId, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { statics } from '../common/pieces';
import { sideToward } from '../common/hexCorners';
import { minefieldAt, shownCounter, type FortRecord } from './fortifications';
import { trailBreaksAt } from './rubble';

/*
 * Trail Breaks through minefields (ASLRB B28.61, B24.74, B13.421, B13.4211, B13.4212; full ASL only).
 *
 * A full TB crosses two hexsides of a minefield hex (the same `asl.tb` record as a rubble TB, B24.71): units entering
 * across one of its hexsides may do so at twice their normal MF/MP free of attack (Infantry then take the TB's -1
 * Defensive First Fire DRM), and a unit leaving across one is not attacked. A partial TB crosses one hexside: placed by
 * Infantry entering a Known minefield with all their MF to clear it (B24.74), it lets only those units out free of attack,
 * and only back across that hexside; it goes when they are gone from the hex, or becomes part of the TB they clear. A
 * fully-tracked AFV's partial TB (B28.61) is the vehicle rules'.
 */

export const PARTIAL_EXT = 'asl.mines.partial';
export interface PartialTb {
  /** The hexside crossed (`sideToward` numbering). */
  side: number;
  /** The Infantry that placed it (B24.74): only they use it. */
  units?: PieceId[];
  /** The fully-tracked AFV that made it (B28.61). */
  vehicle?: PieceId;
}

/** A counter on the board (B28.48: any minefield counter placed onboard marks Known mines). */
export const onBoard = (c: FortRecord) => !c.hidden || !!c.revealed;

/** The minefield of `hex` as `side` knows it: its own (hidden or not), or the other side's once on the board. */
export function minefieldKnownTo(env: QueryEnv, hex: HexId, side: SideId | null): FortRecord | null {
  const c = minefieldAt(env, hex);
  if (!c) return null;
  if (c.side === side) return c;
  return onBoard(c) && shownCounter(c, side) ? c : null;
}

/** A Known minefield `side` may clear or enter along a TB (B24.74, B28.61): a counter on the board, not a Dummy already found. */
export function mineClearable(env: QueryEnv, hex: HexId, side: SideId): boolean {
  const c = minefieldAt(env, hex);
  if (!c || !onBoard(c)) return false;
  const shown = shownCounter(c, side);
  return !!shown && !shown.mines?.found;
}

export const partialTbs = (env: QueryEnv): Record<HexId, PartialTb[]> => (env.state.ext[PARTIAL_EXT] as Record<HexId, PartialTb[]> | undefined) ?? {};
export const partialTbsAt = (env: QueryEnv, hex: HexId): PartialTb[] => partialTbs(env)[hex] ?? [];

export function setPartialTbs(ctx: Ctx, hex: HexId, tbs: PartialTb[]) {
  ctx.emit('asl.mines.partial', { hex, tbs });
}
/** Remove the partial TBs of `hex` that `drop` picks. */
export function clearPartialTbs(ctx: Ctx, hex: HexId, drop: (p: PartialTb) => boolean) {
  const now = partialTbsAt(ctx, hex);
  const keep = now.filter((p) => !drop(p));
  if (keep.length !== now.length) setPartialTbs(ctx, hex, keep);
}

/** The hexside of `hex` toward the adjacent hex `from`. */
export const sideOf = (env: QueryEnv, hex: HexId, from: HexId | null | undefined): number | null => (from ? sideToward(statics(env).map, hex, from) : null);

/** The full TB of the minefield in `hex` crossing the hexside toward `from`, if any (B28.61). */
export function mineTbThrough(env: QueryEnv, hex: HexId, from: HexId | null | undefined): [number, number] | null {
  if (!minefieldAt(env, hex)) return null;
  const k = sideOf(env, hex, from);
  return k === null ? null : (trailBreaksAt(env, hex).find((t) => t.includes(k)) ?? null);
}

/** A special rule giving Trail Breaks at the start (a test bed's minefield "as if cleared"): `{ tbs: { hex, sides }[] }`. */
export const TRAIL_BREAKS_MODULE = 'trail-breaks';
export interface TrailBreaksParams {
  tbs: { hex: HexId; sides: [number, number] }[];
}
export const trailBreaksSsrModule: RuleModule = {
  id: 'ssr.trailBreaks',
  ref: 'ASLRB B24.74, B28.61',
  summary: 'Trail Breaks across given hexsides at the start (special rule).',
  install(r) {
    r.setup({
      id: 'ssr.trailBreaks.place',
      run(ctx) {
        for (const s of statics(ctx).scenario.ssr) {
          if (s.module !== TRAIL_BREAKS_MODULE) continue;
          const by = new Map<HexId, [number, number][]>();
          for (const t of (s.params as unknown as TrailBreaksParams).tbs) by.set(t.hex, [...(by.get(t.hex) ?? []), t.sides]);
          for (const [hex, tbs] of [...by].sort()) ctx.emit('asl.tb', { hex, tbs: [...trailBreaksAt(ctx, hex), ...tbs] });
        }
      },
    });
  },
};
