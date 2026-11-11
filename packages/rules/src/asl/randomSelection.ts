import type { PieceId, RuleModule } from '@asl/engine';
import { P as MP, type RandomSelectFn } from '../sk1/morale';

/**
 * ASLRB A.9 Random Selection: each unit makes a dr and the highest is affected; on a tie for the highest,
 * every unit that rolled it is affected. A KIA (A7.301) takes at least as many units as its number, more on a
 * tie for the last one; a K (A7.302), a CC Partial Kill (A11.11) and a multiple MG breakdown (A9.71) at least one.
 *
 * The SK text picks exactly that many ("as many targets as the number", "one unit suffers Casualty Reduction",
 * "one MG is malfunctioned"; SK1 3.2.1, 3.8, 4.1), so the shared procedure re-rolls ties. The callers mark the
 * selections where A.9 ties apply (`ties: true`); the others (the MMC a created leader defends with, a sniper
 * target) still pick exactly one.
 */
export const aslRandomSelectionModule: RuleModule = {
  id: 'asl.randomSelection',
  ref: 'ASLRB A.9, A7.301, A7.302, A9.71, A11.11',
  summary: 'Random Selection: every unit tied for the last pick is affected.',
  requires: ['sk1.morale'],
  install(r) {
    r.procedure<RandomSelectFn>(MP.randomSelect, (next) => (ctx, candidates, count, label, opts) => {
      if (!opts?.ties) return next!(ctx, candidates, count, label, opts);
      const pool = [...candidates].sort();
      if (pool.length <= count) return pool;
      const rolls: { id: PieceId; v: number }[] = pool.map((id) => ({ id, v: ctx.roll(`${label}: random selection (${id})`, 1).total }));
      const cut = [...rolls].sort((a, b) => b.v - a.v)[count - 1]!.v;
      return rolls.filter((x) => x.v >= cut).map((x) => x.id);
    });
  },
};
