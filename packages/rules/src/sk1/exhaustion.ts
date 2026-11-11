import type { Action, Ctx, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, statics } from '../common/pieces';
import { drmNotes, isCx, isGoodOrder, isPinned, pieceOf, smc, type DrmNote } from './status';
import { P as MP, type UnitFn } from './morale';

/*
 * Exhausted troops (S68 SSR 2 and 3), as three general rules:
 *
 * - `no-double-time` { side }: "American units may not use Double Time" (`move.cannotStart`).
 * - `considered-cx` { side, ccOnly }: "In CC, American units are automatically considered CX for all purposes, including
 *   ambush": the CX modifiers apply to the side's units as if each wore a CX counter (SK1 3.3 / 3.8: +1 to their CC
 *   attacks, -1 to attacks against them, +1 to their ambush dr), once per attack as for a real CX counter. Without
 *   `ccOnly` (the Japanese balance deletes "In CC,") also +1 to their fire attacks. No counter is placed.
 * - `leader-ptc` { side, leader, drm }: "As the first action in the RPh of each American Player Turn, the American 10-2
 *   leader (or its replacement) must, if in Good Order, take a 1PTC. The only possible result if failed is for the
 *   leader to be pinned that Player Turn." As that side's own RPh starts, while he is in Good Order on the map, the side
 *   is asked to take it (decision `leaderPtc`, its one action `leaderPtc.take`: the PTC is the player's first action
 *   of the phase, and the clock running out takes it): 2d6 + `drm` + any MC DRM rules add, against his current morale;
 *   failed above it: Pinned (pin rules apply: a pinned unit stays so to the end of the Player Turn). "Or its
 *   replacement": the leader counter created with his force, whatever ELR has made of it.
 */

export const NO_DOUBLE_TIME_MODULE = 'no-double-time';
export const CONSIDERED_CX_MODULE = 'considered-cx';
export const LEADER_PTC_MODULE = 'leader-ptc';

export interface NoDoubleTimeParams {
  side: SideId;
  rule?: string;
}
export interface ConsideredCxParams {
  side: SideId;
  /** Only in Close Combat (ambush included). */
  ccOnly?: boolean;
  rule?: string;
}
export interface LeaderPtcParams {
  side: SideId;
  /** The leader's counter as the OB lists it ('am.L102'). */
  leader: string;
  /** "1PTC": a PTC with +1. */
  drm: number;
  rule?: string;
}

const params = <T>(env: QueryEnv, module: string): T[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === module && s.params)
    .map((s) => s.params as unknown as T);

/** Whether a unit counts as CX in CC (or always) under a `considered-cx` rule. */
function consideredCx(env: QueryEnv, p: Piece, cc: boolean): boolean {
  return params<ConsideredCxParams>(env, CONSIDERED_CX_MODULE).some((q) => q.side === p.side && (cc || !q.ccOnly));
}
const anyCx = (env: QueryEnv, ids: PieceId[]) => ids.some((id) => isCx(pieceOf(env, id)));
const anyConsidered = (env: QueryEnv, ids: PieceId[], cc: boolean) => ids.some((id) => consideredCx(env, pieceOf(env, id), cc));

export const noDoubleTimeModule: RuleModule = {
  id: 'ssr.no-double-time',
  summary: 'A side’s units may not use Double Time (SSR).',
  requires: ['sk1.movement'],
  install(r) {
    r.contribute({
      id: 'ssr.no-double-time',
      query: 'move.cannotStart',
      apply(v, { units, doubleTime }, env) {
        if (v || !doubleTime) return v;
        const q = params<NoDoubleTimeParams>(env, NO_DOUBLE_TIME_MODULE).find((x) => units.some((u) => env.state.pieces[u]?.side === x.side));
        return q ? `${q.rule ?? 'SSR'}: these units may not use Double Time` : v;
      },
    });
  },
};

export const consideredCxModule: RuleModule = {
  id: 'ssr.considered-cx',
  summary: 'A side’s units are considered CX in Close Combat (or always), ambush included (SSR).',
  requires: ['sk1.cc', 'sk1.fire'],
  install(r) {
    // As the CX counter's own modifiers do (closeCombat.ts, fire.ts): once per attack, not again where one is CX already.
    r.contribute({
      id: 'ssr.considered-cx.cc-attacker',
      query: 'cc.drm',
      label: '+1 CX attacker (SSR)',
      when: ({ attackers }, env) => !anyCx(env, attackers) && anyConsidered(env, attackers, true),
      apply: (v) => v + 1,
    });
    r.contribute({
      id: 'ssr.considered-cx.cc-target',
      query: 'cc.drm',
      label: '-1 vs CX (SSR)',
      when: ({ targets }, env) => !anyCx(env, targets) && anyConsidered(env, targets, true),
      apply: (v) => v - 1,
    });
    r.contribute({
      id: 'ssr.considered-cx.ambush',
      query: 'cc.ambushDrm',
      label: '+1 CX (SSR)',
      when: ({ units }, env) => !anyCx(env, units) && anyConsidered(env, units, true),
      apply: (v) => v + 1,
    });
    r.contribute({
      id: 'ssr.considered-cx.fire',
      query: 'fire.drm',
      label: '+1 CX firer (SSR)',
      when: ({ attack }, env) => {
        const ids = [...attack.parts.map((p) => p.firer), ...(attack.directors ?? [])];
        return !anyCx(env, ids) && anyConsidered(env, ids, false);
      },
      apply: (v) => v + 1,
    });
  },
};

/** The rule's leader: the first counter of his def created with his side (whatever ELR has made of it since). */
function ruleLeader(env: QueryEnv, q: LeaderPtcParams): Piece | undefined {
  return Object.values(env.state.pieces)
    .filter((p) => p.side === q.side && (p.id.includes(`.${q.leader}.`) || p.defId === q.leader))
    .sort(byId)[0];
}

export interface LeaderPtcEvent {
  unit: PieceId;
  dr: [number, number];
  drm: number;
  final: number;
  morale: number;
  pinned: boolean;
  rule: string;
  explain: DrmNote[];
}

/** The question put to the side whose leader must take the PTC. */
export const LEADER_PTC_DECISION = 'leaderPtc';

/** The leader-ptc rule at `index` of the scenario's SSR list, if any. */
export const leaderPtcRule = (env: QueryEnv, index: number): LeaderPtcParams | undefined => {
  const s = statics(env).scenario.ssr[index];
  return s?.module === LEADER_PTC_MODULE ? (s.params as unknown as LeaderPtcParams) : undefined;
};

function takePtc(ctx: Ctx, q: LeaderPtcParams) {
  const p = ruleLeader(ctx, q);
  const d = p && smc(ctx, p);
  if (!p || !d || p.loc.kind !== 'hex' || !isGoodOrder(ctx, p)) return;
  const rule = q.rule ?? 'SSR';
  const morale = ctx.query('unit.morale', { unit: p.id }, d.morale);
  const extra = ctx.explain('mc.drm', { unit: p.id, kind: 'PTC', reason: rule }, 0);
  const roll = ctx.roll(`${rule}: 1PTC for ${p.id}`);
  const drm = q.drm + extra.value;
  const final = roll.total + drm;
  const pinned = final > morale;
  ctx.emit('ssr.leaderPtc', { unit: p.id, dr: roll.dice as [number, number], drm, final, morale, pinned, rule, explain: drmNotes(extra) } satisfies LeaderPtcEvent);
  if (pinned && !isPinned(p)) ctx.proc<UnitFn>(MP.pin)(ctx, p.id);
}

export const leaderPtcModule: RuleModule = {
  id: 'ssr.leader-ptc',
  summary: 'A named leader takes a PTC as his side’s first action in its RPh; failing it he is pinned for the Player Turn (SSR).',
  requires: ['sk1.morale', 'common.turn'],
  install(r) {
    r.event<LeaderPtcEvent>({ type: 'ssr.leaderPtc', apply() {} });
    r.on<{ phase: string }>({
      id: 'ssr.leader-ptc.ask',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'RPh' || ctx.state.result) return;
        statics(ctx).scenario.ssr.forEach((s, index) => {
          if (s.module !== LEADER_PTC_MODULE || !s.params) return;
          const q = s.params as unknown as LeaderPtcParams;
          const p = ruleLeader(ctx, q);
          if (ctx.state.attacker !== q.side || !p || p.loc.kind !== 'hex' || !isGoodOrder(ctx, p)) return;
          ctx.pushDecision({ kind: LEADER_PTC_DECISION, owner: q.side, deadlineClass: 'turn', data: { index, unit: p.id } });
        });
      },
    });
    r.action<Action & { type: 'leaderPtc.take' }>({
      type: 'leaderPtc.take',
      decisionKinds: [LEADER_PTC_DECISION],
      legal: () => [{ type: 'leaderPtc.take' }],
      resolve(ctx, _a, d) {
        const q = leaderPtcRule(ctx, d.data?.['index'] as number);
        ctx.popDecision(d.id);
        if (q) takePtc(ctx, q);
      },
    });
    r.autoResolver({ id: 'ssr.leader-ptc.timeout', decisionKind: LEADER_PTC_DECISION, resolve: (_env, _d, reason) => (reason === 'timeout' ? { type: 'leaderPtc.take' } : null) });
  },
};
