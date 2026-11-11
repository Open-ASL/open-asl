import type { Ctx, Decision, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, isPersonnelDef, statics } from '../common/pieces';
import { SETUP_PLACED, type SetupAction, type SetupPlacedFn } from './scenario';
import { pieceOf, setTags, sw } from './status';

/*
 * Prepared positions by SSR (LMA7 SSR 2: "Les Allemands ayant préparé la position, chaque unité allemande bénéficie d'un
 * TEM +1 (cumulatif avec la position élevée) tant que l'unité ne quitte pas son hex. Ce TEM n'est pas regagné en
 * retournant dans l'hex."): every unit of the side set up on the map is dug in where it sets up. It adds the TEM to each
 * IFT attack against it, as its own DRM (the rest of the stack may not be dug in), wherever the hex's TEM applies (not a
 * Flame Thrower's), on top of the terrain's and Height Advantage. Leaving the hex, for any reason, ends it for good.
 */

export const PREPARED_POSITIONS_MODULE = 'prepared-positions';
export interface PreparedPositionsParams {
  side: SideId;
  /** Added to the TEM of each dug-in unit. */
  tem: number;
  /** The card's name for the rule, e.g. 'SSR 2'. */
  rule?: string;
}

/** The tag on a dug-in unit: the hex it is dug in. */
export const PREPARED = 'prepared';

const paramsOf = (env: QueryEnv): PreparedPositionsParams[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === PREPARED_POSITIONS_MODULE && s.params)
    .map((s) => s.params as unknown as PreparedPositionsParams);

export const preparedPositionsParams = (env: QueryEnv, side: SideId): PreparedPositionsParams | undefined => paramsOf(env).find((p) => p.side === side);

/** The TEM a unit's prepared position adds now (0 when it has none or has left it). */
export function preparedTem(env: QueryEnv, unit: PieceId): number {
  const p = env.state.pieces[unit];
  if (!p || p.loc.kind !== 'hex' || p.tags[PREPARED] !== p.loc.hex) return 0;
  return preparedPositionsParams(env, p.side)?.tem ?? 0;
}

const isFt = (env: QueryEnv, id: PieceId) => sw(env, pieceOf(env, id))?.type === 'FT';

export const preparedPositionsModule: RuleModule = {
  id: 'ssr.prepared-positions',
  ref: 'LMA7 SSR 2',
  summary: 'A side’s units set up on the map are dug in: +TEM until they leave their setup hex, never regained (SSR).',
  requires: ['sk1.scenario', 'sk1.fire'],
  install(r) {
    // At the side's setup: each unit placed on the map is dug in where it stands.
    r.procedure<SetupPlacedFn>(SETUP_PLACED, (next) => (ctx: Ctx, action: SetupAction, decision: Decision) => {
      next?.(ctx, action, decision);
      if (ctx.state.phase !== 'setup' || !preparedPositionsParams(ctx, decision.owner)) return;
      for (const p of Object.values(ctx.state.pieces).sort(byId)) {
        if (p.side !== decision.owner || p.loc.kind !== 'hex' || !action.placements[p.id] || !isPersonnelDef(defOf(ctx, p))) continue;
        setTags(ctx, p.id, { [PREPARED]: p.loc.hex });
      }
    });
    // A half-squad deployed or a unit replaced keeps its tag; one that leaves the hex loses it.
    r.on<{ id: PieceId }>({
      id: 'ssr.prepared-positions.left',
      event: 'piece.moved',
      handler(ctx, ev) {
        const p = ctx.state.pieces[ev.payload.id];
        if (!p || p.tags[PREPARED] === undefined) return;
        if (p.loc.kind !== 'hex' || p.loc.hex !== p.tags[PREPARED]) setTags(ctx, p.id, { [PREPARED]: null });
      },
    });
    r.contribute({
      id: 'ssr.prepared-positions.tem',
      query: 'fire.unitDrm',
      layer: 10,
      label: ({ unit }, env) => `+${preparedTem(env, unit)} TEM dug in (${preparedPositionsParams(env, pieceOf(env, unit).side)?.rule ?? 'SSR'})`,
      when: ({ attack, unit }, env) => preparedTem(env, unit) > 0 && !attack.parts.some((p) => p.kind === 'sw' && isFt(env, p.piece)),
      apply: (v, { unit }, env) => v + preparedTem(env, unit),
    });
  },
};
