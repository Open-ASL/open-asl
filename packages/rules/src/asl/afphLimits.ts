import type { PieceId, RuleModule } from '@asl/engine';
import { byId, swHeldBy } from '../common/pieces';
import { MOVE_SPENT, type MoveSpentFn } from '../sk1/movement';
import { setTags } from '../sk1/status';

/*
 * The AFPh SW limits in full ASL (ASLRB A4.41; C5.2).
 * - "No MMG, HMG, mortar, INF/RCL SW, or 5/8" non-vehicular ordnance counter which moved [other than being Recovered
 *   (4.44)] during the MPh may fire during the ensuing AFPh"; "However, if such weapons remained stationary while their new
 *   owners moved into their Location, they can be fired during the ensuing AFPh with the normal penalties for fire in the
 *   AFPh—assuming they were Recovered during that MPh (4.44)." A weapon moved only if it was possessed while its holder
 *   expended MF (Q&A [K33] to A4.41: a unit may fire it "only if not having expended any MF while possessing this SW"; a
 *   SMOKE attempt while holding it counts: "the MMG 'moved'"). The MF of the Recovery itself is spent before the weapon is
 *   possessed. The Starter Kit refuses any such weapon whose holder moved (SK1 3.5, SK4 3.5), and keeps doing so.
 * - Each weapon possessed while MF are spent is tagged `mfHeld` for the rest of the Player Turn (cleared with `moved` at
 *   the end of the CCPh).
 * The one-shot and no-Intensive-Fire limits and Case B are the shared rules (SK1 3.5, C5.2). Not here: a German dm
 * MMG/HMG firing as a LMG (A4.41 EXC, A9.8), and Opportunity Fire (A7.25).
 */

/** Tag on a weapon possessed while its holder spent MF in this Player Turn's MPh (A4.41). */
export const MF_HELD = 'mfHeld';

export const aslAfphLimitsModule: RuleModule = {
  id: 'asl.afphLimits',
  ref: 'ASLRB A4.41, A4.44',
  summary: 'AFPh SW limits: a weapon moved only if possessed while MF were spent, so one Recovered where it lay may fire.',
  requires: ['sk1.movement', 'sk1.fire'],
  install(r) {
    r.procedure<MoveSpentFn>(MOVE_SPENT, (next) => (ctx, units, exempt) => {
      next?.(ctx, units, exempt);
      for (const u of [...units].sort()) {
        for (const s of swHeldBy(ctx.state, u).sort(byId)) if (!exempt.includes(s.id) && s.tags[MF_HELD] === undefined) setTags(ctx, s.id, { [MF_HELD]: true });
      }
    });
    r.contribute({
      id: 'asl.afph.moved',
      query: 'fire.weaponMovedForAfph',
      ref: 'ASLRB A4.41',
      apply: (_v, { sw }, env) => env.state.pieces[sw]?.tags[MF_HELD] === true,
    });
    r.on<{ phase: string }>({
      id: 'asl.afph.clear',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'CCPh') return;
        const held: PieceId[] = Object.values(ctx.state.pieces).filter((p) => p.tags[MF_HELD] !== undefined).sort(byId).map((p) => p.id);
        for (const id of held) setTags(ctx, id, { [MF_HELD]: null });
      },
    });
  },
};
