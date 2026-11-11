import type { Action, Ctx, Decision, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, statics } from '../common/pieces';
import { locOf } from '../common/location';
import { isHidden } from '../sk2/status';
import { T, isBroken, isGoodOrder, mmc, setTags, smc } from '../sk1/status';
import { dropConcealment } from './concealment';
import { isConcealed } from './status';

/*
 * A card's once-per-game dr (S64 SSR 2 and 3). From Game Turn `fromTurn` ("after Game Turn 1" is
 * 2), at the start of `phase` in `phaseOf`'s Player Turn, `side` is asked whether to make the dr; declining keeps it for
 * a later turn, making it uses it whatever the result. A dr < the current Game Turn number brings the effect:
 *
 * - `nmcConcealment` (SSR 2): each non-HIP, Good Order MMC of `side` not stacked with a Good Order leader of that side
 *   takes a NMC, and "only failure of which results in concealment loss": a failed NMC (final DR > morale) takes off
 *   the unit's "?"; nothing else follows from the roll (no Pin on a DR equal to the morale, no Casualty Reduction on
 *   a 12). Readings: the NMC takes the usual MC DRM rules add (`mc.drm`); "stacked" is the same Location.
 * - `leaderHalt` (SSR 3): every unit of `side` stacked with the `leader` counter (the leader himself included: he is
 *   the one who stopped) "may take no action during that Game Turn except routing or attacking/defending in CC"
 *   (`unit.actionIllegal`, judged when it would act, so a unit that joins him is halted too), and in each RPh of that
 *   Game Turn its broken units stacked with him rally automatically: at once when the dr is made at the start of a
 *   RPh, and as the other RPh of the Game Turn starts. The question is put whether the leader lives or not (under a
 *   "?" he is unknown to the side asked, and asking only while he lives would tell): without him it does nothing.
 */

export const ONCE_DR_MODULE = 'once-dr';
/** The question put to the side that may make the dr. */
export const ONCE_DR_DECISION = 'onceDr';
const STATE = 'ssr.onceDr';

export type OnceDrEffect = { kind: 'nmcConcealment'; side: SideId } | { kind: 'leaderHalt'; side: SideId; leader: string };

export interface OnceDrParams {
  /** The side that may make the dr. */
  side: SideId;
  /** At the start of this phase of `phaseOf`'s Player Turn. */
  phase: string;
  phaseOf: SideId;
  /** The first Game Turn the dr may be made. */
  fromTurn: number;
  effect: OnceDrEffect;
  /** The card's name for the rule, e.g. 'SSR 2'. */
  rule?: string;
}

/** A dr made: the Game Turn, the roll, and whether it was < the turn number. */
export interface OnceDrRecord {
  turn: number;
  dr: number;
  success: boolean;
}

export interface OnceDrEvent extends OnceDrRecord {
  /** The rule's index in the scenario's SSR list (its key). */
  index: number;
  side: SideId;
  rule: string;
  effect: OnceDrEffect['kind'];
}

export interface OnceDrNmcEvent {
  unit: PieceId;
  dr: number;
  final: number;
  morale: number;
  failed: boolean;
  /** The failed NMC took off its "?". */
  concealmentLost: boolean;
  rule: string;
}

export interface OnceDrRallyEvent {
  units: PieceId[];
  leader: PieceId;
  rule: string;
}

type OnceDrAction = Action & { type: 'onceDr.roll' | 'onceDr.skip'; index: number };

/** Every once-per-game dr rule of the scenario, with its index in the SSR list. */
export const onceDrRules = (env: QueryEnv): { index: number; q: OnceDrParams }[] =>
  statics(env)
    .scenario.ssr.map((s, index) => ({ s, index }))
    .filter(({ s }) => s.module === ONCE_DR_MODULE && s.params)
    .map(({ s, index }) => ({ index, q: s.params as unknown as OnceDrParams }));

const records = (env: QueryEnv) => (env.state.ext[STATE] as Record<number, OnceDrRecord> | undefined) ?? {};
/** The dr made under the rule at `index`, if it has been. */
export const onceDrRecord = (env: QueryEnv, index: number): OnceDrRecord | undefined => records(env)[index];
const ruleName = (q: OnceDrParams) => q.rule ?? 'SSR';

/** The leader a `leaderHalt` rule names, if he is on the map. */
export function haltLeader(env: QueryEnv, q: OnceDrParams): Piece | undefined {
  if (q.effect.kind !== 'leaderHalt') return undefined;
  const { side, leader } = q.effect;
  return Object.values(env.state.pieces)
    .filter((p) => p.side === side && p.defId === leader && p.loc.kind === 'hex')
    .sort(byId)[0];
}

/** The units of the rule's side stacked with its leader (him included), for a halt in force this Game Turn. */
function halted(env: QueryEnv, q: OnceDrParams): Piece[] {
  const l = haltLeader(env, q);
  const loc = l && locOf(env.state, l);
  if (!l || !loc) return [];
  return Object.values(env.state.pieces).filter((p) => p.side === l.side && (mmc(env, p) || smc(env, p)) && locOf(env.state, p) === loc);
}

/** The `leaderHalt` rules whose dr succeeded this Game Turn. */
const haltsNow = (env: QueryEnv) => onceDrRules(env).filter(({ index, q }) => q.effect.kind === 'leaderHalt' && onceDrRecord(env, index)?.success && onceDrRecord(env, index)!.turn === env.state.turn);

/** Why the rule's dr may not be made now (null when it may). */
function rollIllegal(env: QueryEnv, index: number, q: OnceDrParams): string | null {
  if (onceDrRecord(env, index)) return `${ruleName(q)}: the dr is made once per game`;
  if (env.state.turn < q.fromTurn) return `${ruleName(q)}: not before Game Turn ${q.fromTurn}`;
  if (env.state.phase !== q.phase || env.state.attacker !== q.phaseOf) return `${ruleName(q)}: only at the start of the ${q.phase}`;
  return null;
}

/** 'nmcConcealment': each eligible MMC's NMC; a failure takes off its "?". */
function nmcConcealment(ctx: Ctx, q: OnceDrParams, side: SideId) {
  const goodLeaderAt = (loc: string) => Object.values(ctx.state.pieces).some((l) => l.side === side && smc(ctx, l) && isGoodOrder(ctx, l) && locOf(ctx.state, l) === loc);
  const units = Object.values(ctx.state.pieces)
    .filter((p) => p.side === side && p.loc.kind === 'hex' && mmc(ctx, p) && !isHidden(p) && isGoodOrder(ctx, p) && !goodLeaderAt(locOf(ctx.state, p)!))
    .sort(byId);
  for (const p of units) {
    const morale = ctx.query('unit.morale', { unit: p.id }, mmc(ctx, p)!.morale);
    const drm = ctx.query('mc.drm', { unit: p.id, kind: 'MC', reason: `${ruleName(q)} NMC` }, 0);
    const roll = ctx.roll(`${ruleName(q)}: NMC for ${p.id}`);
    const final = roll.total + drm;
    const failed = final > morale;
    const lost = failed && isConcealed(p);
    ctx.emit('ssr.onceDr.nmc', { unit: p.id, dr: roll.total, final, morale, failed, concealmentLost: lost, rule: ruleName(q) } satisfies OnceDrNmcEvent);
    if (lost) dropConcealment(ctx, [p.id], `${ruleName(q)}: failed NMC`);
  }
}

/** 'leaderHalt': the broken units stacked with the leader rally automatically. */
function haltRally(ctx: Ctx, q: OnceDrParams) {
  const l = haltLeader(ctx, q);
  if (!l) return;
  const units = halted(ctx, q).filter((p) => p.id !== l.id && isBroken(p)).sort(byId);
  if (units.length === 0) return;
  for (const p of units) setTags(ctx, p.id, { [T.broken]: null, [T.dm]: null });
  ctx.emit('ssr.onceDr.rallied', { units: units.map((p) => p.id), leader: l.id, rule: ruleName(q) } satisfies OnceDrRallyEvent);
}

export const onceDrModule: RuleModule = {
  id: 'ssr.once-dr',
  summary: 'Once per game, a side may make a dr at the start of a phase; a dr < the Game Turn brings the card’s effect (a NMC costing concealment, or a leader’s stack halted and rallied) (SSR).',
  requires: ['sk1.morale', 'sk1.rally', 'common.turn', 'sk4.concealment'],
  install(r) {
    r.event<OnceDrEvent>({
      type: 'ssr.onceDr',
      apply(d, p) {
        d.ext[STATE] = { ...((d.ext[STATE] as Record<number, OnceDrRecord> | undefined) ?? {}), [p.index]: { turn: p.turn, dr: p.dr, success: p.success } };
      },
    });
    r.event<OnceDrNmcEvent>({ type: 'ssr.onceDr.nmc', apply() {} });
    r.event<OnceDrRallyEvent>({ type: 'ssr.onceDr.rallied', apply() {} });

    // The question, at the start of the rule's phase, while the dr is unused (one decision per such rule).
    r.on<{ phase: string }>({
      id: 'ssr.once-dr.ask',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        if (ctx.state.result) return;
        for (const { index, q } of onceDrRules(ctx)) {
          if (q.phase !== ev.payload.phase || rollIllegal(ctx, index, q)) continue;
          ctx.pushDecision({ kind: ONCE_DR_DECISION, owner: q.side, deadlineClass: 'interrupt', data: { index } });
        }
        // The other RPh of a halted Game Turn: the leader's broken units rally automatically.
        if (ev.payload.phase === 'RPh') for (const { q } of haltsNow(ctx)) haltRally(ctx, q);
      },
    });

    const rule = (env: QueryEnv, a: OnceDrAction, d: Decision) => {
      const index = d.data?.['index'] as number;
      const found = onceDrRules(env).find((x) => x.index === index);
      return a.index === index ? found : undefined;
    };
    r.action<OnceDrAction>({
      type: 'onceDr.roll',
      decisionKinds: [ONCE_DR_DECISION],
      legal: (_env, d) => [{ type: 'onceDr.roll', index: d.data?.['index'] as number }],
      validate(env, a, d) {
        const x = rule(env, a, d);
        return x ? rollIllegal(env, x.index, x.q) : 'Not this rule';
      },
      resolve(ctx, a, d) {
        const { index, q } = rule(ctx, a, d)!;
        const turn = ctx.state.turn;
        const dr = ctx.roll(`${ruleName(q)}: dr (needs < ${turn})`, 1).dice[0]!;
        const success = dr < turn;
        ctx.emit('ssr.onceDr', { index, side: q.side, rule: ruleName(q), effect: q.effect.kind, turn, dr, success } satisfies OnceDrEvent);
        ctx.popDecision(d.id);
        if (!success) return;
        if (q.effect.kind === 'nmcConcealment') nmcConcealment(ctx, q, q.effect.side);
        else if (ctx.state.phase === 'RPh') haltRally(ctx, q);
      },
    });
    r.action<OnceDrAction>({
      type: 'onceDr.skip',
      decisionKinds: [ONCE_DR_DECISION],
      legal: (_env, d) => [{ type: 'onceDr.skip', index: d.data?.['index'] as number }],
      validate: (env, a, d) => (rule(env, a, d) ? null : 'Not this rule'),
      resolve(ctx, _a, d) {
        ctx.popDecision(d.id);
      },
    });
    // The clock running out keeps the dr for later; the computer opponent decides for itself.
    r.autoResolver({ id: 'ssr.once-dr.timeout', decisionKind: ONCE_DR_DECISION, resolve: (_env, d, reason) => (reason === 'timeout' ? { type: 'onceDr.skip', index: d.data?.['index'] as number } : null) });

    // The halted units take no action but rout and Close Combat this Game Turn.
    r.contribute({
      id: 'ssr.once-dr.halt',
      query: 'unit.actionIllegal',
      apply(v, { unit }, env) {
        if (v) return v;
        for (const { q } of haltsNow(env)) {
          if (halted(env, q).some((p) => p.id === unit)) {
            const l = haltLeader(env, q)!;
            return `${ruleName(q)}: units stacked with the ${leaderName(env, l)} leader may take no action this Game Turn except routing or Close Combat`;
          }
        }
        return null;
      },
    });
  },
};

/** A leader as the card names him: "10-1". */
function leaderName(env: QueryEnv, l: Piece): string {
  const d = smc(env, l);
  return d ? `${d.morale}-${Math.abs(d.leadership)}` : l.defId;
}
