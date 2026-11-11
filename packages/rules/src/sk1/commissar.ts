import type { Ctx, Decision, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, personnelAt, statics } from '../common/pieces';
import { locOf } from '../common/location';
import { PHASE_DONE, type PhaseDoneFn } from '../common/turn';
import { P as MP, type CasualtyFn, type FlushFn } from './morale';
import { RP, attemptRally, type RallyFailedFn } from './rally';
import { T, isBroken, isPinned, mmc, pieceOf, smc } from './status';

/*
 * A Commissar by SSR (S18 SSR 3, after ASLRB A25.22): "The Russian 6+1 leader represents a commissar with a morale
 * level of 10 and a leadership modifier of 0 to whom ELR can not apply. All Russian units stacked with this unpinned
 * and unbroken commissar have their morale level raised by one and do not add the +4 DM DRM when rallying. The
 * commissar must attempt to rally each broken Russian unit stacked with him; any unit that does not rally is replaced
 * by the next lowest quality unit; if no lower quality unit exists, the unit suffers casualty reduction."
 * The card's own wording is enforced; full ASL's further Commissar rules (no other leader's DRM to morale activities,
 * first to take a MC, berserk) are not, the card leaving them out.
 */

export const COMMISSAR_MODULE = 'commissar';
export interface CommissarParams {
  side: SideId;
  /**
   * Leader counters that are Commissars, with the morale the card gives them, and `leadership` only where the card
   * changes it (S18's 6+1 has "a leadership modifier of 0"; S35 keeps the printed one).
   */
  leaders: Record<string, { morale: number; leadership?: number }>;
  /** The card's name for the rule, e.g. 'SSR 3'. */
  rule?: string;
}

const paramsOf = (env: QueryEnv): CommissarParams[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === COMMISSAR_MODULE && s.params)
    .map((s) => s.params as unknown as CommissarParams);

/** The card's Commissar values for a piece, if it is one. */
export const commissarOf = (env: QueryEnv, p: Piece) => (smc(env, p) ? paramsOf(env).find((q) => q.side === p.side)?.leaders[p.defId] : undefined);

/** The unpinned, unbroken Commissar stacked with a unit (never the unit itself), if any. */
export function overseeingCommissar(env: QueryEnv, p: Piece): Piece | undefined {
  if (!mmc(env, p) && !smc(env, p)) return undefined;
  if (!paramsOf(env).some((q) => q.side === p.side)) return undefined;
  const loc = locOf(env.state, p);
  if (!loc) return undefined;
  return personnelAt(env, loc, p.side)
    .sort(byId)
    .find((c) => c.id !== p.id && !!commissarOf(env, c) && !isBroken(c) && !isPinned(c));
}

export const commissarModule: RuleModule = {
  id: 'ssr.commissar',
  ref: 'ASLRB A25.22',
  summary: 'A leader is a Commissar by SSR: its own morale and leadership, no ELR, +1 morale and no DM rally DRM for units stacked with it, and forced rally with Replacement on failure.',
  requires: ['sk1.morale', 'sk1.rally', 'common.turn'],
  install(r) {
    r.contribute({
      id: 'ssr.commissar.morale',
      query: 'unit.morale',
      layer: 1,
      label: 'Commissar',
      when: ({ unit }, env) => !!commissarOf(env, pieceOf(env, unit)),
      apply: (_v, { unit }, env) => commissarOf(env, pieceOf(env, unit))!.morale,
    });
    r.contribute({
      id: 'ssr.commissar.stacked',
      query: 'unit.morale',
      label: '+1 stacked with a Commissar',
      when: ({ unit }, env) => !commissarOf(env, pieceOf(env, unit)) && !!overseeingCommissar(env, pieceOf(env, unit)),
      apply: (v) => v + 1,
    });
    r.contribute({
      id: 'ssr.commissar.leadership',
      query: 'unit.leadership',
      layer: 1,
      label: 'Commissar',
      when: ({ unit }, env) => commissarOf(env, pieceOf(env, unit))?.leadership !== undefined,
      apply: (_v, { unit }, env) => commissarOf(env, pieceOf(env, unit))!.leadership!,
    });
    r.contribute({
      id: 'ssr.commissar.elr',
      query: 'unit.elrExempt',
      label: 'Commissar: no ELR',
      when: ({ unit }, env) => !!commissarOf(env, pieceOf(env, unit)),
      apply: () => true,
    });
    r.suppress({
      id: 'ssr.commissar.no-dm',
      query: 'rally.drm',
      target: 'sk1.rally.dm',
      label: 'no +4 DM: stacked with a Commissar',
      when: ({ unit }, env) => !!overseeingCommissar(env, pieceOf(env, unit)),
    });

    // A unit failing to rally while stacked with the Commissar is Replaced by the next lower quality unit, or Casualty Reduced.
    r.procedure<RallyFailedFn>(RP.rallyFailed, (next) => (ctx, unit, leader) => {
      next?.(ctx, unit, leader);
      const p = ctx.state.pieces[unit];
      if (!p || p.loc.kind !== 'hex' || !overseeingCommissar(ctx, p)) return;
      const lower = mmc(ctx, p)?.elrReplacement ?? smc(ctx, p)?.elrReplacement;
      if (lower) {
        ctx.emit('piece.replaced', { id: unit, defId: lower, from: p.defId, reason: 'commissar' });
        return;
      }
      ctx.proc<CasualtyFn>(MP.casualtyReduce)(ctx, unit, 'failed to rally under a Commissar');
      ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
    });

    // The Commissar must attempt to rally every broken unit stacked with it: those not yet tried are rolled for as its
    // side ends its part of the Rally Phase.
    r.procedure<PhaseDoneFn>(PHASE_DONE, (next) => (ctx: Ctx, decision: Decision) => {
      if (ctx.state.phase === 'RPh') forcedRallies(ctx, decision.owner);
      next!(ctx, decision);
    });
  },
};

function forcedRallies(ctx: Ctx, side: SideId) {
  if (!paramsOf(ctx).some((q) => q.side === side)) return;
  for (let guard = 0; guard < 50; guard++) {
    const due = Object.values(ctx.state.pieces)
      .filter((p) => p.side === side && p.loc.kind === 'hex' && isBroken(p) && !p.tags[T.rallyTried] && (mmc(ctx, p) || smc(ctx, p)))
      .sort(byId)
      .map((p) => ({ unit: p.id as PieceId, commissar: overseeingCommissar(ctx, p) }))
      .find((d) => d.commissar);
    if (!due) return;
    attemptRally(ctx, due.unit, due.commissar!.id, false, false);
  }
}
