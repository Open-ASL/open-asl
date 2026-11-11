import type { QueryEnv, RuleModule, SideId } from '@asl/engine';
import { statics } from '../common/pieces';
import { T, setTags } from './status';

/*
 * Support Weapons that begin the scenario malfunctioned (S10 SSR 1: "The Italian MMG begins the
 * scenario malfunctioned. No repair attempt may be made until the Italian Player Turn 2."). A
 * general rule: the parameters name the side, the counter, and the first of that side's Player
 * Turns in which a repair may be attempted.
 */

export const START_MALFUNCTIONED_MODULE = 'start-malfunctioned';

export interface StartMalfunctionedParams {
  side: SideId;
  /** Counter def of the weapon, e.g. 'it.MMG'. Every such weapon of the side starts malfunctioned. */
  def: string;
  /** No repair attempt before this Player Turn of `side` (omit: repair as usual). */
  repairFrom?: number;
  /** The card's name for the rule, for the refusal, e.g. 'SSR 1'. */
  rule?: string;
  /**
   * The weapon starts disabled for good rather than malfunctioned: a vehicle's MG "under a CMG Disabled
   * counter" (S23 SSR 4: `def: 'ge.stgiiigl.cmg'`), the SK3 `mgDisabled` tag.
   */
  disabled?: boolean;
}

const paramsOf = (env: QueryEnv) =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === START_MALFUNCTIONED_MODULE)
    .map((s) => s.params as unknown as StartMalfunctionedParams);

/** Player Turns in play order: 0 for the first side's Turn 1, 1 for the other side's Turn 1, ... */
const playerTurnIndex = (env: QueryEnv, turn: number, side: SideId) => (turn - 1) * 2 + (side === statics(env).scenario.firstSide ? 0 : 1);

export const startMalfunctionedModule: RuleModule = {
  id: 'ssr.start-malfunctioned',
  summary: 'Support Weapons that begin the scenario malfunctioned, perhaps with no repair before a given Player Turn (SSR).',
  requires: ['sk1.scenario', 'sk1.rally'],
  install(r) {
    // After the scenario's own setup hook has created the pieces.
    r.setup({
      id: 'ssr.start-malfunctioned.flip',
      priority: 10,
      run(ctx) {
        for (const q of paramsOf(ctx)) {
          for (const p of Object.values(ctx.state.pieces).sort((a, b) => (a.id < b.id ? -1 : 1))) {
            if (p.side === q.side && p.defId === q.def) setTags(ctx, p.id, q.disabled ? { mgDisabled: true } : { [T.malf]: true });
          }
        }
      },
    });
    r.contribute({
      id: 'ssr.start-malfunctioned.noRepair',
      query: 'sw.repairIllegal',
      layer: 10,
      label: 'SSR no repair yet',
      apply(v, { sw }, env) {
        if (v) return v;
        const p = env.state.pieces[sw];
        if (!p) return v;
        for (const q of paramsOf(env)) {
          if (q.repairFrom === undefined || p.side !== q.side || p.defId !== q.def) continue;
          if (playerTurnIndex(env, env.state.turn, env.state.attacker) < playerTurnIndex(env, q.repairFrom, q.side)) {
            return `${q.rule ? `${q.rule}: no` : 'No'} repair attempt until the ${statics(env).scenario.sides.find((s) => s.side === q.side)?.name ?? q.side} Player Turn ${q.repairFrom}`;
          }
        }
        return v;
      },
    });
  },
};
