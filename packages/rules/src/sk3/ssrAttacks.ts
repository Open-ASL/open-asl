import type { Action, Ctx, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, otherSide, statics } from '../common/pieces';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import { FP, type ApplyResultFn, type FireAttackCtx } from '../sk1/fire';
import { phaseOwner } from '../sk1/firePhases';
import { P as MP, eliminate, type CasualtyFn, type FlushFn, type RandomSelectFn, type UnitFn } from '../sk1/morale';
import { isBroken, mmc, pieceOf, smc } from '../sk1/status';
import { digInParams, isDugIn } from './digIn';
import { hitLocation } from './facing';
import { isCe, isWreck, vehicle } from './status';
import { applyVehicleEffect } from './vehicleStatus';

/*
 * Attacks a card gives a side once per Defensive Fire Phase against a hex of its choosing (S35):
 *
 * SSR 5, a Sniper: "Once per Russian Defensive Fire Phase, the Russian player may make a Sniper attack by making a dr < 3.
 * The player selects one target hex; if there is > 1 unit (ignoring BU AFVs), randomly select the target. A dr 1
 * eliminates a leader, breaks a MMC, or STUNs a CE AFV crew; a dr 2 wounds a leader, pins a MMC, or Stuns a CE AFV crew;
 * a dr > 2 has no effect." A wound is a Casualty Reduction of the leader (its wound severity dr may eliminate him).
 *
 * SSR 6, a Stuka: "Once per German Defensive Fire Phase the German player may make a Stuka attack. The player selects the
 * target hex and makes a single To Hit DR (which may possibly affect both infantry and vehicular targets); a Final To Hit
 * DR ≤ 8 vs. Infantry is resolved on the 36 column of the IFT; a Final To Hit DR of 6-10 vs. AFV results in a Final To
 * Kill number of 7 for the T-34 and 6 for the KV-1; a Final To Hit DR ≤ 5 is a direct hit which automatically eliminates
 * the AFV." The DR against a dug-in AFV takes the dig-in To Hit DRM, and a hit on its hull is a miss (dig-in rule). A To
 * Kill DR below the number destroys the AFV; equal to it, a hull hit Immobilizes and a turret hit Shocks (SK4 7.10).
 */

export const SNIPER_ATTACK_MODULE = 'sniper-attack';
export interface SniperAttackParams {
  side: SideId;
  rule?: string;
}

export const STUKA_ATTACK_MODULE = 'stuka-attack';
export interface StukaAttackParams {
  side: SideId;
  /** Final To Hit DR at most this vs Infantry: an attack on this IFT column. */
  infantryTh: number;
  column: number;
  /** Final To Hit DR within [min, max] vs an AFV: a To Kill DR against the number for its counter. */
  afvTh: [number, number];
  /** Final To Hit DR at most this: a direct hit, the AFV is eliminated. */
  directHit: number;
  tk: Record<string, number>;
  rule?: string;
}

const paramsOf = <T>(env: QueryEnv, module: string): T[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === module && s.params)
    .map((s) => s.params as unknown as T);

/** Whether the side has made its once-per-phase attack in this Defensive Fire Phase. */
const usedKey = (kind: string) => `ssr.${kind}.used`;
const phaseStamp = (env: QueryEnv) => `${env.state.turn}:${env.state.attacker}`;
const used = (env: QueryEnv, kind: string) => env.state.ext[usedKey(kind)] === phaseStamp(env);

/** Why `side` may not make the attack on `hex` now, or null. */
function attackIllegal(env: QueryEnv, side: SideId, hex: HexId, rules: { side: SideId }[], kind: string): string | null {
  const rule = rules.find((r) => r.side === side);
  if (!rule) return 'No special rule gives this attack';
  if (env.state.phase !== 'DFPh' || phaseOwner(env) !== side) return 'Only in your Defensive Fire Phase';
  if (used(env, kind)) return 'Once per Defensive Fire Phase';
  if (!statics(env).map.hex(hex)) return 'Not a hex on the map';
  return null;
}

/** Enemy personnel and AFV in the hex. */
const enemyIn = (env: QueryEnv, side: SideId, hex: HexId): Piece[] =>
  Object.values(env.state.pieces)
    .filter((p) => p.side === otherSide(env.state, side) && p.loc.kind === 'hex' && p.loc.hex === hex && (mmc(env, p) || smc(env, p) || (vehicle(env, p) && !isWreck(p))))
    .sort(byId);

/** The attack's targets offered in the client's hex menu, by action type. */
export function ssrHexAttacks(env: QueryEnv, side: SideId): { type: string; label: string; hint: string }[] {
  const out: { type: string; label: string; hint: string }[] = [];
  const sniper = paramsOf<SniperAttackParams>(env, SNIPER_ATTACK_MODULE).find((r) => r.side === side);
  if (sniper) out.push({ type: 'ssr.sniper', label: `Sniper attack${sniper.rule ? ` (${sniper.rule})` : ''}`, hint: 'Once per Defensive Fire Phase: a dr of 1 or 2 strikes one unit in the hex, chosen at random' });
  const stuka = paramsOf<StukaAttackParams>(env, STUKA_ATTACK_MODULE).find((r) => r.side === side);
  if (stuka) out.push({ type: 'ssr.stuka', label: `Stuka attack${stuka.rule ? ` (${stuka.rule})` : ''}`, hint: 'Once per Defensive Fire Phase: one To Hit DR against the Infantry and the AFV in the hex' });
  return out;
}

export const ssrAttacksModule: RuleModule = {
  id: 'ssr.attacks',
  summary: 'A Sniper or a Stuka attack, once per Defensive Fire Phase, against a hex (SSR).',
  requires: ['sk1.fire', 'sk1.morale', 'sk3.vehicleStatus'],
  install(r) {
    for (const kind of ['sniper', 'stuka'])
      r.event<{ side: SideId; hex: HexId; stamp: string }>({
        type: `ssr.${kind}.declared`,
        apply(d, p) {
          d.ext[usedKey(kind)] = p.stamp;
        },
      });
    r.event<{ side: SideId; hex: HexId; dr: number; target: PieceId | null; effect: string; rule?: string }>({ type: 'ssr.sniper.attack', apply() {} });
    r.event<{ side: SideId; hex: HexId; dr: [number, number]; infantry: boolean; afv: { vehicle: PieceId; final: number; result: string; tkDr?: [number, number]; tk?: number }[]; rule?: string }>({ type: 'ssr.stuka.attack', apply() {} });

    // ------------------------------------------------------------------ Sniper
    r.action<Action & { type: 'ssr.sniper'; hex: HexId }>({
      type: 'ssr.sniper',
      decisionKinds: [PHASE_DECISION],
      validate: (env, a) => attackIllegal(env, a.side, a.hex, paramsOf<SniperAttackParams>(env, SNIPER_ATTACK_MODULE), 'sniper') ?? (enemyIn(env, a.side, a.hex).length ? null : 'No enemy unit there'),
      resolve(ctx, a) {
        const rule = paramsOf<SniperAttackParams>(ctx, SNIPER_ATTACK_MODULE).find((p) => p.side === a.side)!;
        ctx.emit('ssr.sniper.declared', { side: a.side, hex: a.hex, stamp: phaseStamp(ctx) });
        const dr = ctx.roll(`Sniper attack on ${a.hex}`, 1).total;
        let target: PieceId | null = null;
        let effect = 'no effect';
        if (dr <= 2) {
          // Targets: everything there but a Buttoned Up AFV.
          const cands = enemyIn(ctx, a.side, a.hex).filter((p) => !vehicle(ctx, p) || isCe(p)).map((p) => p.id);
          target = cands.length > 1 ? ctx.proc<RandomSelectFn>(MP.randomSelect)(ctx, cands, 1, 'Sniper target')[0]! : (cands[0] ?? null);
          const p = target ? pieceOf(ctx, target) : null;
          if (p && vehicle(ctx, p)) {
            effect = dr === 1 ? 'STUN' : 'Stun';
          } else if (p && smc(ctx, p)) {
            effect = dr === 1 ? 'leader eliminated' : 'leader wounded';
          } else if (p) {
            effect = dr === 1 ? (isBroken(p) ? 'already broken' : 'broken') : 'pinned';
          }
        }
        ctx.emit('ssr.sniper.attack', { side: a.side, hex: a.hex, dr, target, effect, ...(rule.rule ? { rule: rule.rule } : {}) });
        if (target) {
          const p = pieceOf(ctx, target);
          if (vehicle(ctx, p)) applyVehicleEffect(ctx, target, dr === 1 ? 'STUN' : 'stun', `Sniper (${rule.rule ?? 'SSR'})`);
          else if (smc(ctx, p)) {
            if (dr === 1) eliminate(ctx, target, 'Sniper');
            else ctx.proc<CasualtyFn>(MP.casualtyReduce)(ctx, target, 'Sniper');
            ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
          } else if (dr === 1) ctx.proc<UnitFn>(MP.breakUnit)(ctx, target, 'Sniper');
          else ctx.proc<UnitFn>(MP.pin)(ctx, target);
        }
        ctx.popDecision();
        askPhaseOwner(ctx, phaseOwner(ctx));
      },
    });

    // ------------------------------------------------------------------ Stuka
    r.action<Action & { type: 'ssr.stuka'; hex: HexId }>({
      type: 'ssr.stuka',
      decisionKinds: [PHASE_DECISION],
      validate: (env, a) => attackIllegal(env, a.side, a.hex, paramsOf<StukaAttackParams>(env, STUKA_ATTACK_MODULE), 'stuka'),
      resolve(ctx, a) {
        const rule = paramsOf<StukaAttackParams>(ctx, STUKA_ATTACK_MODULE).find((p) => p.side === a.side)!;
        ctx.emit('ssr.stuka.declared', { side: a.side, hex: a.hex, stamp: phaseStamp(ctx) });
        const th = ctx.roll(`Stuka attack on ${a.hex}`);
        const dice = th.dice as [number, number];
        const targets = enemyIn(ctx, a.side, a.hex);
        const infantry = targets.filter((p) => mmc(ctx, p) || smc(ctx, p)).map((p) => p.id);
        const afvs = targets.filter((p) => vehicle(ctx, p));
        const afv: { vehicle: PieceId; final: number; result: string; tkDr?: [number, number]; tk?: number }[] = [];
        const effects: (() => void)[] = [];
        const by = `Stuka (${rule.rule ?? 'SSR'})`;
        for (const v of afvs) {
          const dug = isDugIn(ctx, v.id);
          const final = th.total + (dug ? (digInParams(ctx, v.side)?.thDrm ?? 0) : 0);
          const location = hitLocation(dice[0], dice[1]);
          if (final > rule.afvTh[1]) {
            afv.push({ vehicle: v.id, final, result: 'miss' });
            continue;
          }
          if (dug && location === 'hull') {
            afv.push({ vehicle: v.id, final, result: 'hull hit on a dug-in AFV: miss' });
            continue;
          }
          if (final <= rule.directHit) {
            afv.push({ vehicle: v.id, final, result: 'direct hit: eliminated' });
            effects.push(() => applyVehicleEffect(ctx, v.id, 'wreck', by));
            continue;
          }
          if (final < rule.afvTh[0]) {
            afv.push({ vehicle: v.id, final, result: 'miss' });
            continue;
          }
          const tk = rule.tk[v.defId];
          if (tk === undefined) {
            afv.push({ vehicle: v.id, final, result: 'no effect' });
            continue;
          }
          const roll = ctx.roll(`Stuka To Kill ${v.id} (TK ${tk})`);
          const res = roll.total < tk ? 'destroyed' : roll.total === tk ? (location === 'hull' ? 'Immobilized' : 'Shocked') : 'no effect';
          afv.push({ vehicle: v.id, final, result: res, tkDr: roll.dice as [number, number], tk });
          if (res === 'destroyed') effects.push(() => applyVehicleEffect(ctx, v.id, 'wreck', by));
          else if (res === 'Immobilized') effects.push(() => applyVehicleEffect(ctx, v.id, 'immobilized', by));
          else if (res === 'Shocked') effects.push(() => applyVehicleEffect(ctx, v.id, 'shock', by));
        }
        const hitsInfantry = infantry.length > 0 && th.total <= rule.infantryTh;
        ctx.emit('ssr.stuka.attack', { side: a.side, hex: a.hex, dr: dice, infantry: hitsInfantry, afv, ...(rule.rule ? { rule: rule.rule } : {}) });
        for (const e of effects) e();
        if (hitsInfantry) {
          const attack: FireAttackCtx = {
            mode: 'final',
            side: a.side,
            target: a.hex,
            parts: [],
            targets: infantry.filter((u) => ctx.state.pieces[u]?.loc.kind === 'hex'),
            hindrance: 0,
            ordnance: { targetType: 'ATT', ch: false, column: rule.column },
          };
          const drm = ctx.explain('fire.drm', { attack }, 0);
          const ift = ctx.roll(`Stuka hit on ${a.hex}: ${rule.column} column`);
          ctx.emit('sk1.fire.attack', {
            attack: { mode: 'final', target: a.hex, parts: [] },
            from: [],
            fp: rule.column,
            column: rule.column,
            dr: ift.dice as [number, number],
            drm: drm.value,
            cowered: false,
            explain: [{ id: 'ssr.stuka', label: `Stuka hit: ${rule.column} column` }, ...drm.trace.filter((t) => !t.suppressedBy && t.label && t.before !== t.after).map((t) => ({ id: t.id, label: t.label! }))],
          });
          ctx.proc<ApplyResultFn>(FP.applyResult)(ctx, attack, rule.column, ift.total + drm.value, {});
          ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
        }
        ctx.popDecision();
        askPhaseOwner(ctx, phaseOwner(ctx));
      },
    });
  },
};
