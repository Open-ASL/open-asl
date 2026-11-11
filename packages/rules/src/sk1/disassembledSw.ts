import type { Action, Ctx, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, statics } from '../common/pieces';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import { phaseOwner, swUsedThisPhase } from './firePhases';
import { T, actionIllegal, isGoodOrder, isPinned, mmc, pieceOf, setTags } from './status';

/*
 * A Support Weapon that enters play disassembled (S66 SSR 2: "The American M2 60mm MTR enters play disassembled (on
 * its malfunctioned side) and cannot fire until assembled by an American MMC in the PFPh or DFPh as if using a SW by
 * flipping it over to its functioning side. While disassembled, the MTR weighs 3 PP instead of 5 PP (4.0)").
 *
 * The weapon starts on its malfunctioned side (`malf`) with the `disassembled` tag, so it cannot fire; it is not broken,
 * so no Repair attempt is allowed (only assembly turns it over). A Good Order, unpinned MMC of the side possessing it
 * assembles it in that side's PFPh or DFPh (`sw.assemble`): a use of a SW, counted as `sw.destroy` counts (a HS, or a
 * squad on its second SW use, forfeits its own FP; the unit has fired a SW this phase, so in the PFPh it is marked
 * Prep Fire when the phase ends), and the weapon itself may not fire in the phase it was assembled. Readings: "as if
 * using a SW" is that SW use; a leader may not assemble it (the card says MMC).
 */

export const DISASSEMBLED_SW_MODULE = 'disassembled-sw';
/** Tag: the weapon is disassembled (lasting; off once assembled). */
export const DISASSEMBLED = 'disassembled';
/** Tag: the fire phase ("turn:attacker:phase") the weapon was assembled in; it fires from the next one (Player Turn). */
export const ASSEMBLED_IN = 'assembledIn';

export interface DisassembledSwParams {
  side: SideId;
  /** Counter def of the weapon ('am.MTR'); every such weapon of the side enters disassembled. */
  def: string;
  /** Its PP while disassembled. */
  pp: number;
  /** The card's name for the rule, e.g. 'SSR 2'. */
  rule?: string;
}

const paramsOf = (env: QueryEnv): DisassembledSwParams[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === DISASSEMBLED_SW_MODULE && s.params)
    .map((s) => s.params as unknown as DisassembledSwParams);
const ruleOf = (env: QueryEnv, defId: string) => paramsOf(env).find((q) => q.def === defId);
const phaseKey = (env: QueryEnv) => `${env.state.turn}:${env.state.attacker}:${env.state.phase}`;

/** Whether a weapon is disassembled. */
export const isDisassembled = (env: QueryEnv, sw: PieceId): boolean => env.state.pieces[sw]?.tags[DISASSEMBLED] === true;

/** Why `sw` may not be assembled now (by its possessor), or null. */
export function assembleIllegal(env: QueryEnv, swId: PieceId, side: SideId): string | null {
  const s = env.state.pieces[swId];
  if (!s || !isDisassembled(env, swId)) return 'Not a disassembled weapon';
  const q = ruleOf(env, s.defId);
  const rule = q?.rule ?? 'SSR';
  if (env.state.phase !== 'PFPh' && env.state.phase !== 'DFPh') return `${rule}: assembled only in the PFPh or DFPh`;
  if (phaseOwner(env) !== side || s.side !== side) return `${rule}: assembled only in your own fire phase`;
  if (s.loc.kind !== 'held') return `${rule}: a unit must possess it to assemble it`;
  const holder = pieceOf(env, s.loc.by);
  if (!mmc(env, holder)) return `${rule}: only a MMC may assemble it`;
  if (!isGoodOrder(env, holder) || isPinned(holder)) return `${rule}: only a Good Order, unpinned MMC may assemble it`;
  const halted = actionIllegal(env, [holder.id]);
  if (halted) return halted;
  const used = swUsedThisPhase(env, holder);
  if (mmc(env, holder)?.kind === 'hs' && used >= 1) return 'A half-squad may use only one SW';
  if (used >= 2) return 'A squad may use at most two SW';
  return null;
}

type AssembleAction = Action & { type: 'sw.assemble'; sw: PieceId };

export const disassembledSwModule: RuleModule = {
  id: 'ssr.disassembled-sw',
  summary: 'A SW enters play disassembled (malfunctioned side, fewer PP) and is assembled by a MMC in the PFPh or DFPh as a SW use (SSR).',
  requires: ['sk1.scenario', 'sk1.firePhases', 'sk1.rally'],
  install(r) {
    // At creation (offboard reinforcements included): malfunctioned side up, disassembled.
    r.setup({
      id: 'ssr.disassembled-sw.flip',
      priority: 10,
      run(ctx) {
        for (const q of paramsOf(ctx)) {
          for (const p of Object.values(ctx.state.pieces).sort(byId)) if (p.side === q.side && p.defId === q.def) setTags(ctx, p.id, { [T.malf]: true, [DISASSEMBLED]: true });
        }
      },
    });
    r.contribute({
      id: 'ssr.disassembled-sw.pp',
      query: 'sw.pp',
      apply(v, { sw }, env) {
        const p = env.state.pieces[sw];
        const q = p && isDisassembled(env, sw) ? ruleOf(env, p.defId) : undefined;
        return q ? q.pp : v;
      },
    });
    r.contribute({
      id: 'ssr.disassembled-sw.no-repair',
      query: 'sw.repairIllegal',
      layer: 10,
      apply: (v, { sw }, env) => v ?? (isDisassembled(env, sw) ? `${ruleOf(env, env.state.pieces[sw]!.defId)?.rule ?? 'SSR'}: it is disassembled, not broken: a MMC assembles it in the PFPh or DFPh` : null),
    });
    // Not fired in the phase it was put together.
    r.contribute({
      id: 'ssr.disassembled-sw.assembled-now',
      query: 'ordnance.illegal',
      apply: (v, { shot }, env) => v ?? (env.state.pieces[shot.weapon]?.tags[ASSEMBLED_IN] === phaseKey(env) ? 'It was assembled this phase: it fires from the next fire phase' : null),
    });
    r.contribute({
      id: 'ssr.disassembled-sw.assembled-now-ift',
      query: 'fire.illegal',
      apply: (v, { decl }, env) => v ?? (decl.sw.some((w) => env.state.pieces[w]?.tags[ASSEMBLED_IN] === phaseKey(env)) ? 'It was assembled this phase: it fires from the next fire phase' : null),
    });
    r.on<{ phase: string }>({
      id: 'ssr.disassembled-sw.clear',
      event: 'turn.phaseEnded',
      handler(ctx) {
        for (const p of Object.values(ctx.state.pieces).sort(byId)) if (p.tags[ASSEMBLED_IN] !== undefined) setTags(ctx, p.id, { [ASSEMBLED_IN]: null });
      },
    });

    r.event<{ sw: PieceId; by: PieceId; rule: string }>({ type: 'ssr.sw.assembled', apply() {} });
    r.action<AssembleAction>({
      type: 'sw.assemble',
      decisionKinds: [PHASE_DECISION],
      legal(env, d) {
        if (env.state.phase !== 'PFPh' && env.state.phase !== 'DFPh') return [];
        return Object.values(env.state.pieces)
          .filter((p) => p.side === d.owner && isDisassembled(env, p.id) && !assembleIllegal(env, p.id, d.owner))
          .sort(byId)
          .map((p) => ({ type: 'sw.assemble' as const, sw: p.id }));
      },
      validate: (env, a) => assembleIllegal(env, a.sw, a.side),
      resolve(ctx: Ctx, a) {
        const s = pieceOf(ctx, a.sw);
        const holder = pieceOf(ctx, (s.loc as { by: PieceId }).by);
        const used = swUsedThisPhase(ctx, holder) + 1;
        const m = mmc(ctx, holder);
        setTags(ctx, a.sw, { [T.malf]: null, [DISASSEMBLED]: null, [ASSEMBLED_IN]: phaseKey(ctx) });
        // A use of a SW, as `sw.destroy` is (SK1 4.0): counted with the SW uses that are not fire.
        setTags(ctx, holder.id, {
          [T.firedSw]: true,
          [T.firedSwAs]: ctx.state.phase === 'PFPh' ? 'prep' : 'first',
          [T.swDestroyed]: ((holder.tags[T.swDestroyed] as number | undefined) ?? 0) + 1,
          ...((m?.kind === 'hs' && used >= 1) || (m?.kind === 'squad' && used >= 2) ? { [T.ownFpForfeit]: true } : {}),
        });
        ctx.emit('ssr.sw.assembled', { sw: a.sw, by: holder.id, rule: ruleOf(ctx, s.defId)?.rule ?? 'SSR' });
        ctx.popDecision();
        askPhaseOwner(ctx, phaseOwner(ctx));
      },
    });
  },
};
