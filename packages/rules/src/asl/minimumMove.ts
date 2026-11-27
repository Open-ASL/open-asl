import type { Ctx, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { hexOfLoc, isGroundLoc, type LocId } from '../common/location';
import { statics, swHeldBy } from '../common/pieces';
import { MOVE_ENTER, MOVE_ENTERED, MOVE_FINISH, moveInternals, moveState, type MoveEnterFn, type MoveEnteredFn, type MoveFinishFn, type MoveState } from '../sk1/movement';
import { T, isBroken, pieceOf, setTags } from '../sk1/status';
import { smokeIn } from '../sk1/terrain';

/*
 * Minimum Move (ASLRB A4.134). Full ASL only: the Starter Kit moves units "up to the limit of their Movement Factor (MF)
 * allotment" (SK1 3.3).
 * - "An Infantry unit retaining at least one MF after deducting for portage costs exceeding its IPC, may make a Minimum
 *   Move of one hex during its MPh, even if CX or lacking the MF to pay the full entry cost of the hex": the step is
 *   allowed to a unit whose MF left are fewer than the entry cost, provided its allowance is at least one MF.
 * - The one hex is the unit's whole MPh: no other MF before it (Q&A [K33] to A4.134: no Recovery, SMOKE or DC first), so it
 *   is offered only as the stack's first expenditure; the unit's move ends on entry. A unit that can pay enters normally.
 *   A stack's members are judged one by one (A4.2: units moving as a stack "need not spend MF for the same purpose"): those
 *   short of MF make the Minimum Move and stay, the rest may go on (without the leader's bonus if he stays, A4.12).
 * - "Infantry pushing a Gun or loading/unloading may never Minimum Move" (C10.3 too); "a Minimum Move cannot be made to
 *   enter terrain whose entrance cost is listed as NA"; never to get beneath Wire (B26.4: the unit stays on top).
 * - "After a unit has entered a hex by Minimum Move and undergone all First Fire, all unbroken survivors become both pinned
 *   and CX (even if CX previously)": when the stack's move is over (every First Fire at it has been made), set directly,
 *   not through the Pin procedure's once-per-Player-Turn guard. "In any case, the unit is considered to have spent the
 *   actual MF cost of entry" (A4.134 EX: "Consider it to have spent 4 MF"): its `spent` is the real cost.
 * - Defensive First Fire takes FFNAM (all MF used, so no Assault Movement) and FFMO as the terrain gives (A4.6).
 * Not here: Minimum Move into marsh, across a cactus hedge, by overstacking (B16.4, B9.7, A5.11), and the pinning of
 * berserk/heroic Infantry by it (A7.8, A15.21).
 */

/** Event: units of the moving stack made a Minimum Move into `to` at `cost` MF (A4.134). */
export const MINIMUM_EVENT = 'asl.move.minimum';

/** The MF `unit` of the moving stack has left for a step into `to` (the road bonus counted as the step allows it, SK1 3.3). */
function leftFor(env: QueryEnv, ms: MoveState, unit: PieceId, to: LocId, woods = false): number {
  const toHex = hexOfLoc(to);
  const bonusStep = !statics(env).map.offboardHex(toHex) && moveInternals.roadSideTo(env, ms, to) && !woods && !smokeIn(env, toHex);
  return (ms.allowance[unit] ?? 0) + (ms.roadOnly && bonusStep ? 1 : 0) - (ms.spent[unit] ?? 0);
}

/** The stack has spent no MF this MPh: a Minimum Move is the whole of a unit's MPh (A4.134; Q&A [K33]). */
export const noMfSpent = (ms: MoveState) => ms.hexesEntered === 0 && ms.mfHere === 0 && !(ms.trail?.length) && ms.units.every((u) => !(ms.spent[u] ?? 0));

/** Why `unit` may not enter `to` by Minimum Move at `cost` MF, or null (A4.134). */
export function minimumMoveIllegal(env: QueryEnv, ms: MoveState, to: LocId, unit: PieceId, cost: number): string | null {
  if (ms.vehicle) return 'Only Infantry make a Minimum Move (ASLRB A4.134)';
  if (env.state.phase !== 'MPh') return 'A Minimum Move is made in the MPh (ASLRB A4.134)';
  if (ms.manhandle) return 'Infantry pushing a Gun may never Minimum Move (ASLRB A4.134, C10.3)';
  if (!noMfSpent(ms)) return 'Already spent MF this MPh: a Minimum Move is the whole of the unit\'s MPh (ASLRB A4.134)';
  if (!Number.isFinite(cost)) return 'A Minimum Move cannot enter terrain whose entry cost is NA (ASLRB A4.134)';
  if (!isGroundLoc(to) && hexOfLoc(to) === ms.hex) return 'A Minimum Move is a move of one hex (ASLRB A4.134)';
  if (!statics(env).map.hex(hexOfLoc(to))) return 'A Minimum Move is a move of one hex on the map (ASLRB A4.134)';
  if ((ms.allowance[unit] ?? 0) < 1) return `${unit} has no MF left after portage costs (ASLRB A4.134)`;
  if (ms.dash) return 'Dashing: no other movement option (ASLRB A4.63)';
  return null;
}

/** The units of the moving stack that would enter `to` at `cost` only by Minimum Move. */
export function minimumMovers(env: QueryEnv, ms: MoveState, to: LocId, cost: number, woods = false): PieceId[] {
  return ms.units.filter((u) => cost > leftFor(env, ms, u, to, woods));
}

export const aslMinimumMoveModule: RuleModule = {
  id: 'asl.minimumMove',
  ref: 'ASLRB A4.134',
  summary: 'Minimum Move: one hex as the whole MPh at any cost, then pinned and CX after all First Fire.',
  requires: ['sk1.movement'],
  install(r) {
    r.event<{ units: PieceId[]; to: LocId; cost: number }>({ type: MINIMUM_EVENT, apply() {} });
    r.contribute({
      id: 'asl.minimumMove.allowed',
      query: 'move.minimumMoveAllowed',
      ref: 'ASLRB A4.134',
      apply: (v, { ms, to, unit, cost }, env) => v || !minimumMoveIllegal(env, ms, to, unit, cost),
    });
    // The step: the units short of MF are making a Minimum Move (recorded on the stack until its move is over).
    r.procedure<MoveEnterFn>(MOVE_ENTER, (next) => (ctx, ms, to, cost, woods, extra) => {
      const mins = ms.vehicle || ctx.state.phase !== 'MPh' ? [] : minimumMovers(ctx, ms, to, cost, woods);
      if (mins.length === 0) return next!(ctx, ms, to, cost, woods, extra);
      ctx.emit(MINIMUM_EVENT, { units: mins, to, cost });
      next!(ctx, ms, to, cost, woods, { ...extra, minimum: [...new Set([...(ms.minimum ?? []), ...mins])].sort() });
    });
    // On entry their move is over: they stay there, still targets of the First Fire at that expenditure (A4.134 "undergone
    // all First Fire"), while the rest of the stack may go on.
    r.procedure<MoveEnteredFn>(MOVE_ENTERED, (next) => (ctx, ms) => {
      next?.(ctx, ms);
      const cur = moveState(ctx);
      const mins = cur?.minimum?.filter((u) => cur.units.includes(u)) ?? [];
      if (!cur || mins.length === 0) return;
      for (const u of mins) {
        setTags(ctx, u, { [T.moved]: true });
        for (const s of swHeldBy(ctx.state, u)) setTags(ctx, s.id, { [T.moved]: true });
      }
      const units = cur.units.filter((u) => !mins.includes(u));
      ctx.emit('sk1.move.state', { state: { ...cur, units, stopped: [...new Set([...(cur.stopped ?? []), ...mins])], ...(units.length ? {} : { halted: true }) } });
    });
    // After all First Fire: pinned and CX (A4.134), whether or not CX before.
    r.procedure<MoveFinishFn>(MOVE_FINISH, (next) => (ctx) => {
      const mins = moveState(ctx)?.minimum ?? [];
      next?.(ctx);
      pinMinimumMovers(ctx, mins);
    });
  },
};

function pinMinimumMovers(ctx: Ctx, units: PieceId[]) {
  for (const u of [...units].sort()) {
    const p = ctx.state.pieces[u];
    if (!p || p.loc.kind !== 'hex' || isBroken(pieceOf(ctx, u))) continue;
    setTags(ctx, u, { [T.pinned]: true, [T.pinnedThisTurn]: true, [T.cx]: true });
  }
}
