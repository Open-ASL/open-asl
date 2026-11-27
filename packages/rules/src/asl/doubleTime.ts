import type { Action, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { PHASE_DECISION } from '../common/turn';
import { moveInternals, moveState } from '../sk1/movement';
import { T, isCx, pieceOf, setTags, wounds } from '../sk1/status';
import { triedWireExit } from './wire';

/*
 * Double Time declared during the MPh (ASLRB A4.5 EXC). Full ASL only: the Starter Kit allows Double Time "if the player
 * announces the option at the beginning of that unit's MPh" (SK1 3.3; SK4 3.3.1).
 * - "Double Time can be announced after a unit has expended MF, but doing so increases the unit's MF by only one while
 *   incurring the same penalties": a CX counter at once, and the CX IPC one lower (A4.52) for the rest of the move, so
 *   portage it carries beyond the new IPC costs MF again. The MF already spent stay spent.
 * - Not by a unit that is broken, wounded or CX (A4.5), nor one whose CX counter came off at the start of this MPh (A4.51;
 *   Q&A [K33] to A4.5, A4.51 & A13.36: the +1 included). Broken and pinned units are no longer moving.
 * - Not by an Assault Moving unit: "once declared, Assault Movement cannot be voluntarily voided" (A4.61), and Double Time
 *   would void it (A4.61: an expenditure that "requires CX status").
 * - Not in a turn in which the unit attempts to move beneath Wire (B26.46): refused after its Wire Exit dr, and the dr is
 *   refused after the declaration (`asl/wire.ts`).
 * - "A Double Timing leader (and any units accompanying him) have eight MF—the highest possible allotment for Infantry":
 *   the allowance never goes past eight.
 * - A Dashing unit may declare it to go on into the Location it Dashes to (A4.63 EX 2).
 * Not here: a unit that will mount, ride or dismount a conveyance that Player Turn (no Infantry passengers in full ASL yet),
 * and the hero created from a Double Timing unit (A15.21).
 */

export type LateDoubleTimeAction = Action & { type: 'move.doubleTime'; units: PieceId[] };

/** The highest MF allotment for Infantry (A4.5). */
const MAX_MF = 8;

/** Why `unit` of the moving stack may not declare Double Time now, or null (A4.5, A4.51, A4.61, B26.46). */
export function lateDoubleTimeIllegal(env: QueryEnv, unit: PieceId): string | null {
  const ms = moveState(env);
  if (env.state.phase !== 'MPh' || !ms) return 'No stack is moving';
  if (ms.vehicle) return 'Only Infantry Double Time (ASLRB A4.5)';
  if (!ms.units.includes(unit)) return `${unit} is not moving`;
  const p = pieceOf(env, unit);
  if (ms.assault) return 'Assault Movement cannot be voluntarily voided (ASLRB A4.61)';
  if (ms.doubleTime || ms.lateDt?.includes(unit)) return `${unit} is already Double Timing (ASLRB A4.5)`;
  if (wounds(p) > 0) return `${unit} is wounded: no Double Time (ASLRB A4.5)`;
  if (isCx(p)) return `${unit} is already CX (ASLRB A4.5)`;
  if (p.tags['cxPrev'] !== undefined) return `${unit} was CX when this MPh began, which bars Double Time this MPh (ASLRB A4.51)`;
  if (triedWireExit(env, unit)) return `${unit} has moved beneath Wire this turn: no Double Time (ASLRB B26.46)`;
  return null;
}

export const aslDoubleTimeModule: RuleModule = {
  id: 'asl.doubleTime',
  ref: 'ASLRB A4.5, A4.51, A4.52',
  summary: 'Double Time declared after MF were spent: one MF more, CX at once.',
  requires: ['sk1.movement', 'asl.wire'],
  install(r) {
    r.event<{ units: PieceId[]; mf: Record<PieceId, number> }>({ type: 'asl.move.doubleTime', apply() {} });
    // +1 MF for a unit that declared Double Time during its move; CX's IPC penalty comes with its CX counter (A4.52).
    r.contribute({
      id: 'asl.mf.late-double-time',
      query: 'unit.mf',
      layer: 161,
      ref: 'ASLRB A4.5',
      label: '+1 MF Double Time declared during the move',
      when: ({ unit, doubleTime }, env) => !doubleTime && !!moveState(env)?.lateDt?.includes(unit),
      apply: (v) => v + 1,
    });
    // Every start option is offered: with Double Time and with Assault Movement too (A4.5, A4.61).
    r.contribute({ id: 'asl.move.start-options', query: 'move.startOptionsListed', ref: 'ASLRB A4.5, A4.61', apply: () => true });
    r.action<LateDoubleTimeAction>({
      type: 'move.doubleTime',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const ms = moveState(env);
        if (!ms || env.state.phase !== 'MPh' || ms.vehicle || !ms.hex) return [];
        const ok = ms.units.filter((u) => !lateDoubleTimeIllegal(env, u));
        return [...ok.map((u) => ({ type: 'move.doubleTime' as const, units: [u] })), ...(ok.length > 1 ? [{ type: 'move.doubleTime' as const, units: ok }] : [])];
      },
      validate(env, a) {
        if (!a.units?.length) return 'Choose the units that Double Time';
        for (const u of a.units) {
          const why = lateDoubleTimeIllegal(env, u);
          if (why) return why;
        }
        return null;
      },
      resolve(ctx, a) {
        const ms = moveState(ctx)!;
        const units = [...new Set(a.units)].sort();
        const mfOf = () => Object.fromEntries(ms.units.map((u) => [u, ctx.query('unit.mf', { unit: u, stack: ms.units, doubleTime: ms.doubleTime }, 0)]));
        const before = mfOf();
        for (const u of units) setTags(ctx, u, { [T.cx]: true });
        ctx.emit('sk1.move.state', { state: { ...ms, lateDt: [...(ms.lateDt ?? []), ...units].sort() } });
        const after = mfOf();
        const allowance = { ...ms.allowance };
        // The change in each unit's allotment: +1 for the declaring units, less any portage the lower CX IPC now costs
        // (a CX leader lends no IPC either, so a MMC he carried for may lose a MF too).
        for (const u of ms.units) {
          const delta = (after[u] ?? 0) - (before[u] ?? 0);
          if (delta === 0) continue;
          allowance[u] = Math.min(Math.max(MAX_MF, ms.allowance[u] ?? 0), (ms.allowance[u] ?? 0) + delta);
        }
        const cur = moveState(ctx)!;
        ctx.emit('sk1.move.state', { state: { ...cur, allowance } });
        ctx.emit('asl.move.doubleTime', { units, mf: Object.fromEntries(units.map((u) => [u, allowance[u] ?? 0])) });
        moveInternals.reAskMover(ctx);
      },
    });
  },
};
