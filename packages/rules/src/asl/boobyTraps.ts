import type { Ctx, HexId, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { otherSide, personnelAt, statics } from '../common/pieces';
import { locOf, type LocId } from '../common/location';
import { P as MP, type CasualtyFn, type CheckUnitFn, type FlushFn, type RandomSelectFn } from '../sk1/morale';
import { isBroken, isPinned, pieceOf } from '../sk1/status';

/*
 * Booby Traps (ASLRB B28.9; full ASL only, by special rule: `booby-traps`, params `BoobyTrapParams`).
 *
 * A side's minefield factors bought Booby Trap capability on some boards (10, 20 or 30 factors: Level C, B, A). A Task Check
 * taken by a unit of the other side in a Location of such a board triggers a Booby Trap attack on an Original DR of 12
 * (Level C), of 11 (Level B), or of ≥ 11 (Level A), as the text gives them: Casualty Reduction to at least one Personnel
 * unit in that Location, chosen by Random Selection (every unit tied for the pick, A.9), not necessarily the unit that
 * took the TC, and of either side (the placing side's units only so). Infantry normally immune to a PTC (broken or pinned)
 * take it for the Booby Trap only. The Task Checks the engine rolls: the IFT PTC, the Leader Loss TC, the PAATC, a Kindling
 * NTC (B25.11), a vehicle crew's PTC and NTC (Q&A to B28.9: a CE crew's PTC triggers it, the crew itself is unaffected). A
 * MC, a Rally DR and a Clearance DR are no TC (Q&A to A10.1 & B28.9, to B24.7 & B28.9). Searching's Casualty dr (A12.154)
 * waits for Searching. The Starter Kit has no Booby Traps.
 */

export const BOOBY_TRAPS_MODULE = 'booby-traps';
export interface BoobyTrapParams {
  /** The side that placed them. */
  side: SideId;
  /** The boards (letters) bought for (B28.9: the cost is per board, its half-hexes included). */
  boards: string[];
  level: 'A' | 'B' | 'C';
  rule?: string;
}

export function boobyTrapParams(env: QueryEnv): BoobyTrapParams[] {
  return statics(env)
    .scenario.ssr.filter((s) => s.module === BOOBY_TRAPS_MODULE)
    .map((s) => s.params as unknown as BoobyTrapParams);
}

/** The Booby Traps a TC by a unit of `taker` in `hex` may trigger: the other side's, on that hex's board. */
export function boobyTrapsAt(env: QueryEnv, hex: HexId, taker: SideId): BoobyTrapParams | null {
  const board = statics(env).map.hex(hex)?.board;
  return boobyTrapParams(env).find((b) => b.side !== taker && !!board && b.boards.includes(board)) ?? null;
}

/** Whether an Original TC DR triggers Booby Traps of `level` (B28.9). */
export const boobyTrapTriggered = (level: BoobyTrapParams['level'], original: number) => (level === 'C' ? original === 12 : level === 'B' ? original === 11 : original >= 11);

/** A TC with Original DR `original` by a unit of `taker` in `loc`: the Booby Trap attack if it triggers. */
export function boobyTrapCheck(ctx: Ctx, loc: LocId, taker: SideId, unit: PieceId, original: number, tc: string) {
  const hex = loc.split(':')[0]!;
  const bt = boobyTrapsAt(ctx, hex, taker);
  if (!bt || !boobyTrapTriggered(bt.level, original)) return;
  const candidates = personnelAt(ctx, loc)
    .map((p) => p.id)
    .sort();
  const victims = candidates.length ? ctx.proc<RandomSelectFn>(MP.randomSelect)(ctx, candidates, 1, 'Booby Trap: Casualty Reduction', { ties: true }) : [];
  ctx.emit('asl.boobyTrap', { loc, level: bt.level, unit, tc, dr: original, victims });
  for (const v of [...victims].sort()) if (ctx.state.pieces[v]?.loc.kind === 'hex') ctx.proc<CasualtyFn>(MP.casualtyReduce)(ctx, v, `Booby Trap (Level ${bt.level}, ASLRB B28.9)`);
  ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
}

export const boobyTrapsModule: RuleModule = {
  id: 'ssr.boobyTraps',
  ref: 'ASLRB B28.9',
  summary: 'Booby Traps on given boards: an enemy Task Check of an Original 12 (C), 11 (B) or ≥ 11 (A) Casualty Reduces a unit of its Location.',
  requires: ['sk1.morale'],
  install(r) {
    r.event<{ loc: LocId; level: string; unit: PieceId; tc: string; dr: number; victims: PieceId[] }>({ type: 'asl.boobyTrap', apply() {} });
    const at = (ctx: Ctx, unit: PieceId) => {
      const p = ctx.state.pieces[unit];
      return p && p.loc.kind === 'hex' ? { loc: locOf(ctx.state, p)!, side: p.side } : null;
    };
    // The IFT PTC and the Leader Loss TC (and the PTC a broken or pinned unit takes for this alone, below).
    r.on<{ unit: PieceId; kind: string; dr: number }>({
      id: 'asl.boobyTrap.check',
      event: 'sk1.check',
      handler(ctx, ev) {
        if (ev.payload.kind !== 'PTC' && ev.payload.kind !== 'LLTC') return;
        const w = at(ctx, ev.payload.unit);
        if (w) boobyTrapCheck(ctx, w.loc, w.side, ev.payload.unit, ev.payload.dr, ev.payload.kind);
      },
    });
    r.on<{ unit: PieceId; dr: [number, number] }>({
      id: 'asl.boobyTrap.paatc',
      event: 'sk3.paatc',
      handler(ctx, ev) {
        const w = at(ctx, ev.payload.unit);
        if (w) boobyTrapCheck(ctx, w.loc, w.side, ev.payload.unit, ev.payload.dr[0] + ev.payload.dr[1], 'PAATC');
      },
    });
    r.on<{ unit: PieceId; dr: [number, number] }>({
      id: 'asl.boobyTrap.kindling',
      event: 'asl.fire.ntc',
      handler(ctx, ev) {
        const w = at(ctx, ev.payload.unit);
        if (w) boobyTrapCheck(ctx, w.loc, w.side, ev.payload.unit, ev.payload.dr[0] + ev.payload.dr[1], 'NTC');
      },
    });
    r.on<{ vehicle: PieceId; kind: string; dr: [number, number] }>({
      id: 'asl.boobyTrap.crew',
      event: 'sk3.vehicle.check',
      handler(ctx, ev) {
        if (ev.payload.kind !== 'PTC' && ev.payload.kind !== 'NTC') return;
        const w = at(ctx, ev.payload.vehicle);
        // The crew is not Personnel in the Location: it is never selected (Q&A to B28.9).
        if (w) boobyTrapCheck(ctx, w.loc, w.side, ev.payload.vehicle, ev.payload.dr[0] + ev.payload.dr[1], ev.payload.kind);
      },
    });
    // Infantry normally immune to a PTC (broken or pinned) take it for Booby Trap resolution only (B28.9): the DR is
    // rolled where a Booby Trap could trigger; it has no other effect.
    r.procedure<CheckUnitFn>(MP.checkUnit, (next) => (ctx, unit, opts) => {
      const p = pieceOf(ctx, unit);
      if (opts.kind !== 'PTC' || !(isBroken(p) || isPinned(p)) || p.loc.kind !== 'hex') return next!(ctx, unit, opts);
      const loc = locOf(ctx.state, p)!;
      if (!boobyTrapsAt(ctx, loc.split(':')[0]!, p.side)) return next!(ctx, unit, opts);
      const roll = ctx.roll(`${opts.reason}: PTC for ${unit} (Booby Trap only, ASLRB B28.9)`);
      ctx.emit('asl.boobyTrap.ptc', { unit, dr: roll.total });
      boobyTrapCheck(ctx, loc, p.side, unit, roll.total, 'PTC');
      return 'passed';
    });
    r.event<{ unit: PieceId; dr: number }>({ type: 'asl.boobyTrap.ptc', apply() {} });
    void otherSide;
  },
};
