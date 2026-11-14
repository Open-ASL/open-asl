import type { Ctx, Decision, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, isMmcDef, personnelAt, statics } from '../common/pieces';
import { locOf } from '../common/location';
import { PHASE_DONE, type PhaseDoneFn } from '../common/turn';
import type { MmcDef } from '../common/statics';
import { ccStateOf } from '../sk1/closeCombat';
import { P as MP, applyElr, eliminate, elrReplacement, type CasualtyFn, type CheckUnitFn, type FailMcFn, type FlushFn, type UnitFn } from '../sk1/morale';
import { RP, attemptRally, type RallyFailedFn } from '../sk1/rally';
import { T, isBroken, isGoodOrder, isPinned, mmc, pieceOf, setTags, sideSetup, smc, sw } from '../sk1/status';
import { drmNotes } from '../sk1/status';
import type { HiddenUnitsParams } from '../sk2/hiddenUnits';

/*
 * The Japanese (SK4 8.1). Squads and crews have no broken side: a failed MC Step Reduces them (Full → Reduced →
 * HS), after any ELR replacement (8.1.1–8.1.6). Leaders have no broken side either: a failed MC wounds them, an
 * original 12 kills them, they ignore PTCs and pin only in bamboo or under a collapsing hut, they add one to the
 * morale of the Japanese MMC with them, ignore DM when rallying Japanese units, must try to rally every broken
 * Japanese unit with them, and a Japanese MMC they fail to rally is Replaced or Casualty Reduced (8.1.7). Elite and
 * 1st Line Japanese ambush at −1 (8.1.8.1); a Japanese squad/HS firing a MMG/HMG/ATR lowers its B# and ROF by one
 * and loses it for good on an original DR ≥ the printed B# (8.1.8.2); the Japanese take no PAATC and turn a LLMC
 * into a LLTC while unbroken (8.1.8.3); a CC a Japanese Infantry unit attacks in, or ambushes in, is Hand-to-Hand
 * (8.1.8.4); up to 10% of the on-board OB may set up HIP (8.1.8.5). The Banzai Charge (8.1.8.6–8) is `banzai.ts`.
 * Readings: a Reduced-Strength squad's Full-Strength CCV applies in every CC (the sentence sits in the Hand-to-Hand
 * paragraph but names no condition; full ASL G1.42 is general); the +1 morale needs only a Japanese leader present
 * (the rule names no state; a wounded leader still counts).
 */

export const JAPANESE_MODULE = 'sk4.japanese';
const HTH = 'hth';
const MG_TYPES = new Set(['MMG', 'HMG', 'ATR']);

export const isJapanese = (env: QueryEnv, p: Piece) => defOf(env, p).nationality === 'ja';
const jaInfantry = (env: QueryEnv, p: Piece) => isJapanese(env, p) && !!(mmc(env, p) || smc(env, p));
/** A Japanese squad or crew: no broken side, Step Reduction instead (SK4 8.1.1, 8.1.6). */
const stepsDown = (env: QueryEnv, p: Piece): MmcDef | null => {
  const m = mmc(env, p);
  return m && m.nationality === 'ja' && m.kind !== 'hs' && (m.stepTo !== undefined || m.fullOf !== undefined) ? m : null;
};
/** Whether a MC failed by `failedBy` exceeds the unit's ELR (SK1 5.1), replacement or not. */
const exceedsElr = (env: QueryEnv, p: Piece, failedBy: number): boolean => {
  const setup = sideSetup(env, p.side);
  return failedBy > (setup.elrs?.[defOf(env, p).nationality] ?? setup.elr);
};
const jaLeader = (env: QueryEnv, p: Piece) => !!smc(env, p) && isJapanese(env, p);
/** Any side fielding Japanese units in this scenario. */
const jaSides = (env: QueryEnv): SideId[] => statics(env).scenario.sides.filter((s) => (s.nationalities ?? [s.nationality]).includes('ja')).map((s) => s.side);
/** Japanese leaders in a unit's Location (the unit itself excepted). */
const jaLeadersWith = (env: QueryEnv, p: Piece): Piece[] => {
  const loc = locOf(env.state, p);
  return loc ? personnelAt(env, loc, p.side).filter((l) => l.id !== p.id && jaLeader(env, l)) : [];
};

/**
 * Step Reduction (SK4 8.1.2, 8.1.3, 8.1.6): a Full-Strength squad or crew flips to its Reduced side; a Reduced squad
 * becomes one of its unbroken HS; a Reduced crew becomes a broken reduced-quality crew. Pin, CX and acquisition
 * survive (`piece.replaced` keeps the tags). `broken` forces the result broken (a Conscript's ELR failure).
 */
export function stepReduce(ctx: Ctx, unit: PieceId, reason: string, broken = false) {
  const p = pieceOf(ctx, unit);
  const m = mmc(ctx, p);
  if (!m) return;
  const to = m.stepTo ?? m.reducesTo;
  if (!to) {
    eliminate(ctx, unit, `${reason}: no Reduced side left`);
    return;
  }
  const next = statics(ctx).counters[to];
  // The HS a Reduced squad steps to stays unbroken (8.1.3); a Reduced crew's step is to a broken crew (8.1.6); a
  // Conscript's ELR failure is a broken HS (8.1.3, `broken`).
  const breaks = broken || (m.kind === 'crew' && !!m.fullOf) || !next;
  ctx.emit('piece.replaced', { id: unit, defId: to, from: p.defId, reason: 'step' });
  ctx.emit('sk4.ja.stepReduced', { unit, from: p.defId, to, broken: breaks, reason });
  if (breaks) setTags(ctx, unit, { [T.broken]: true, [T.dm]: true, [T.pinned]: null, [T.cx]: null });
}

/** Whether a Hand-to-Hand CC is in force in a hex now (SK4 8.1.8.4): declared HtH, not reverted by ambush or pins. */
export function hthActive(env: QueryEnv, hex: HexId): boolean {
  if (env.state.hexMarkers[hex]?.[HTH] !== true) return false;
  const st = ccStateOf(env);
  const ja = personnelAt(env, hex).filter((p) => jaInfantry(env, p));
  if (ja.length === 0) return false;
  const jaSide = ja[0]!.side;
  // Reverts when every Japanese participant was ambushed and/or is pinned.
  if (st?.hex === hex && st.ambusher && st.ambusher !== jaSide) return false;
  return !ja.every(isPinned);
}

export const japaneseModule: RuleModule = {
  id: JAPANESE_MODULE,
  ref: 'SK4 8.1',
  summary: 'The Japanese: Step Reduction instead of breaking, leaders who are wounded rather than broken and ignore PTCs and DM, forced rallies with Replacement, Hand-to-Hand CC, −1 ambush, MG/ATR B# and ROF −1, no PAATC, LLMC as LLTC, 10% HIP.',
  requires: ['sk1.morale', 'sk1.rally', 'sk1.cc', 'sk1.fire', 'common.turn'],
  install(r) {
    r.event<{ unit: PieceId; from: string; to: string; broken: boolean; reason: string }>({ type: 'sk4.ja.stepReduced', apply() {} });
    r.event<{ unit: PieceId; reason: string }>({ type: 'sk4.ja.leaderPtc', apply() {} });
    r.event<{ unit: PieceId; outcome: 'wounded' | 'eliminated'; reason: string }>({ type: 'sk4.ja.leaderWounded', apply() {} });
    r.event<{ hex: HexId }>({ type: 'sk4.ja.handToHand', apply() {} });

    // ---------------------------------------------------------------- 8.1.2–8.1.6 Step Reduction
    // A plain MC failure: ELR first (a Conscript exceeding its ELR becomes a broken HS; others the next-lower Class,
    // then the step), else the step (8.1.3's bullets).
    r.procedure<FailMcFn>(MP.failMc, (next) => (ctx, unit, failedBy, reason) => {
      const p = pieceOf(ctx, unit);
      const m = stepsDown(ctx, p);
      if (!m) {
        next!(ctx, unit, failedBy, reason);
        return;
      }
      if (m.quality === 'C' && !m.elrExempt && exceedsElr(ctx, p, failedBy)) {
        // "replaced by one of its broken HS"
        const hs = m.reducesTo;
        if (hs) {
          const setup = sideSetup(ctx, p.side);
          ctx.emit('piece.replaced', { id: unit, defId: hs, from: p.defId, reason: 'elr' });
          ctx.emit('sk1.elr', { unit, from: p.defId, to: hs, failedBy, elr: setup.elrs?.[m.nationality] ?? setup.elr });
          setTags(ctx, unit, { [T.broken]: true, [T.dm]: true, [T.pinned]: null, [T.cx]: null });
          return;
        }
      }
      if (elrReplacement(ctx, unit, failedBy)) applyElr(ctx, unit, failedBy);
      stepReduce(ctx, unit, reason);
    });
    // "breaks because of a KIA result" (8.1.3) or any other plain break: a step instead; a leader is wounded instead
    // (8.1.7). A Casualty Reduction result applies in the normal manner (8.1.4): `casualtyMc` names its break.
    r.procedure<UnitFn>(MP.breakUnit, (next) => (ctx, unit, reason) => {
      const p = pieceOf(ctx, unit);
      if (reason !== 'casualtyMc') {
        if (stepsDown(ctx, p)) {
          stepReduce(ctx, unit, reason ?? 'break');
          return;
        }
        if (jaLeader(ctx, p) && !isBroken(p)) {
          woundLeader(ctx, unit, reason ?? 'break');
          return;
        }
      }
      next!(ctx, unit, reason);
    });
    // Leaders (8.1.7): a PTC is ignored (its result still costs Concealment/HIP, which hook the fire result); a failed
    // MC wounds (an original 12 kills); a final DR equal to the morale is no pin.
    r.procedure<CheckUnitFn>(MP.checkUnit, (next) => (ctx, unit, opts) => {
      const p = pieceOf(ctx, unit);
      if (!jaLeader(ctx, p)) return next!(ctx, unit, opts);
      if (opts.kind === 'PTC') {
        ctx.emit('sk4.ja.leaderPtc', { unit, reason: opts.reason });
        return 'passed';
      }
      const l = smc(ctx, p)!;
      const morale = ctx.query('unit.morale', { unit }, l.morale);
      const extraRes = ctx.explain('mc.drm', { unit, kind: opts.kind, reason: opts.reason }, 0);
      const roll = ctx.roll(`${opts.reason}: ${opts.kind} for ${unit}`);
      const final = roll.total + opts.mod + (opts.leaderDrm ?? 0) + extraRes.value;
      const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;
      const explain = [
        ...(opts.mod ? [{ id: 'mc.mod', label: `${signed(opts.mod)} ${opts.kind}` }] : []),
        ...(opts.leaderDrm ? [{ id: 'mc.leader', label: `${signed(opts.leaderDrm)} leader` }] : []),
        ...drmNotes(extraRes),
      ];
      const record = (outcome: 'passed' | 'reduced' | 'eliminated') => {
        ctx.emit('sk1.check', { unit, kind: opts.kind, dr: roll.total, final, target: morale, outcome, reason: opts.reason, drm: final - roll.total, explain });
        return outcome;
      };
      if (roll.total === 12) {
        eliminate(ctx, unit, `${opts.reason}: original 12 on MC (SK4 8.1.7)`);
        return record('eliminated');
      }
      if (final > morale) {
        const w = woundLeader(ctx, unit, opts.reason);
        return record(w === 'eliminated' ? 'eliminated' : 'reduced');
      }
      return record('passed');
    });
    // A Japanese leader pins only in bamboo or under a collapsing hut (those set the tag directly), never by a PTC or MC.
    r.procedure<UnitFn>(MP.pin, (next) => (ctx, unit, reason) => {
      if (jaLeader(ctx, pieceOf(ctx, unit))) return;
      next!(ctx, unit, reason);
    });
    r.contribute({
      id: 'sk4.ja.leader-no-elr',
      query: 'unit.elrExempt',
      ref: 'SK4 8.1.7',
      label: 'Japanese leader: no replacement',
      when: ({ unit }, env) => jaLeader(env, pieceOf(env, unit)),
      apply: () => true,
    });

    // ---------------------------------------------------------------- 8.1.7 leaders and morale
    r.contribute({
      id: 'sk4.ja.leader-morale',
      query: 'unit.morale',
      ref: 'SK4 8.1.7',
      label: '+1 Japanese leader present',
      when: ({ unit }, env) => {
        const p = pieceOf(env, unit);
        return !!mmc(env, p) && isJapanese(env, p) && jaLeadersWith(env, p).length > 0;
      },
      apply: (v) => v + 1,
    });
    r.suppress({
      id: 'sk4.ja.no-dm',
      query: 'rally.drm',
      target: 'sk1.rally.dm',
      ref: 'SK4 8.1.7',
      label: 'DM ignored: rallied by a Japanese leader',
      when: ({ unit, leader }, env) => !!leader && isJapanese(env, pieceOf(env, unit)) && jaLeader(env, pieceOf(env, leader)),
    });
    // A Japanese MMC a Japanese leader fails to rally is Replaced by the next lower-quality unit, else Casualty Reduced.
    r.procedure<RallyFailedFn>(RP.rallyFailed, (next) => (ctx, unit, leader) => {
      next?.(ctx, unit, leader);
      const p = ctx.state.pieces[unit];
      if (!p || p.loc.kind !== 'hex' || !leader || !mmc(ctx, p) || !isJapanese(ctx, p) || !jaLeader(ctx, pieceOf(ctx, leader))) return;
      const lower = mmc(ctx, p)!.elrReplacement;
      if (lower) {
        ctx.emit('piece.replaced', { id: unit, defId: lower, from: p.defId, reason: 'rally' });
        return;
      }
      ctx.proc<CasualtyFn>(MP.casualtyReduce)(ctx, unit, 'failed to rally under a Japanese leader (SK4 8.1.7)');
      ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
    });
    // "must attempt to rally all broken Japanese units in the same location": those not yet tried are rolled for as
    // the side ends its part of the Rally Phase.
    r.procedure<PhaseDoneFn>(PHASE_DONE, (next) => (ctx: Ctx, decision: Decision) => {
      if (ctx.state.phase === 'RPh') forcedRallies(ctx, decision.owner);
      next!(ctx, decision);
    });
    // Japanese MMC cannot create a leader (5.3).
    r.contribute({
      id: 'sk4.ja.no-field-promotion',
      query: 'rally.promotes',
      ref: 'SK4 8.1.7',
      when: ({ unit }, env) => isJapanese(env, pieceOf(env, unit)),
      apply: () => false,
    });
    r.contribute({
      id: 'sk4.ja.no-cc-promotion',
      query: 'cc.promotionBase',
      ref: 'SK4 8.1.7',
      when: ({ units }, env) => units.some((u) => isJapanese(env, pieceOf(env, u))),
      apply: (v, { units }, env) => (v && isJapanese(env, pieceOf(env, v)) ? (units.filter((u) => !isJapanese(env, pieceOf(env, u))).sort()[0] ?? null) : v),
    });

    // ---------------------------------------------------------------- 8.1.8.1 ambush
    r.contribute({
      id: 'sk4.ja.ambush',
      query: 'cc.ambushDrm',
      ref: 'SK4 8.1.8.1',
      label: '-1 Elite/1st Line Japanese',
      when: ({ units }, env) =>
        units.some((u) => {
          const p = pieceOf(env, u);
          const q = mmc(env, p)?.quality;
          return jaInfantry(env, p) && isGoodOrder(env, p) && p.tags['banzai'] === undefined && (smc(env, p) ? true : q === 'E' || q === '1');
        }),
      apply: (v) => v - 1,
    });

    // ---------------------------------------------------------------- 8.1.8.2 MMG/HMG/ATR by a squad/HS
    const jaSquadUser = (env: QueryEnv, id: PieceId, user?: PieceId) => {
      if (!user) return false;
      const w = sw(env, pieceOf(env, id));
      const u = mmc(env, pieceOf(env, user));
      return !!w && MG_TYPES.has(w.type) && !!u && u.nationality === 'ja' && u.kind !== 'crew';
    };
    r.contribute({
      id: 'sk4.ja.mg-breakdown',
      query: 'sw.breakdown',
      ref: 'SK4 8.1.8.2',
      label: '-1 Japanese squad/HS',
      when: ({ sw: id, user }, env) => jaSquadUser(env, id, user),
      apply: (v) => (v === null ? v : v - 1),
    });
    r.contribute({
      id: 'sk4.ja.mg-rof',
      query: 'sw.rof',
      ref: 'SK4 8.1.8.2',
      label: '-1 Japanese squad/HS',
      when: ({ sw: id, user }, env) => jaSquadUser(env, id, user),
      apply: (v) => Math.max(0, v - 1),
    });
    r.contribute({
      id: 'sk4.ja.atr-rof',
      query: 'ordnance.rof',
      ref: 'SK4 8.1.8.2',
      when: (sc, env) => sc.def.type === 'ATR' && jaSquadUser(env, sc.weapon, sc.firer),
      apply: (v) => Math.max(0, v - 1),
    });

    // ---------------------------------------------------------------- 8.1.8.3 morale
    r.contribute({
      id: 'sk4.ja.no-paatc',
      query: 'paatc.exempt',
      ref: 'SK4 8.1.8.3',
      when: ({ unit }, env) => isJapanese(env, pieceOf(env, unit)),
      apply: () => true,
    });
    r.contribute({
      id: 'sk4.ja.llmc-as-lltc',
      query: 'leaderLoss.kind',
      ref: 'SK4 8.1.8.3',
      when: ({ unit, kind }, env) => kind === 'LLMC' && isJapanese(env, pieceOf(env, unit)) && !isBroken(pieceOf(env, unit)),
      apply: () => 'LLTC' as const,
    });

    // ---------------------------------------------------------------- 8.1.8.4 Hand-to-Hand
    // The CC in a hex becomes Hand-to-Hand as its declarations start, if a Japanese Infantry unit is the ATTACKER
    // there or ambushed the enemy; the marker then stays with the Melee.
    r.on<{ state: { hex?: HexId; step?: string; ambusher?: SideId | null; declared?: Record<string, unknown[]> } | null }>({
      id: 'sk4.ja.hth-start',
      event: 'sk1.cc.state',
      handler(ctx, ev) {
        const st = ev.payload.state;
        if (!st?.hex || !st.step || st.step === 'arrange' || ctx.state.hexMarkers[st.hex]?.[HTH] === true) return;
        if (Object.values(st.declared ?? {}).some((d) => d.length > 0)) return;
        const hex = st.hex;
        const ja = personnelAt(ctx, hex).filter((p) => jaInfantry(ctx, p));
        if (ja.length === 0) return;
        const jaSide = ja[0]!.side;
        if (jaSide === ctx.state.attacker || st.ambusher === jaSide) {
          ctx.emit('hex.marker', { hex, key: HTH, value: true });
          ctx.emit('sk4.ja.handToHand', { hex });
        }
      },
    });
    r.on<{ hex: HexId; key: string; value: unknown }>({
      id: 'sk4.ja.hth-end',
      event: 'hex.marker',
      handler(ctx, ev) {
        if (ev.payload.key === 'melee' && ev.payload.value === null && ctx.state.hexMarkers[ev.payload.hex]?.[HTH] === true) ctx.emit('hex.marker', { hex: ev.payload.hex, key: HTH, value: null });
      },
    });
    r.contribute({
      id: 'sk4.ja.hth-kill',
      query: 'cc.kill',
      ref: 'SK4 8.1.8.4',
      label: 'Hand-to-Hand',
      when: ({ hex, attackers, targets }, env) => hthActive(env, hex) && ![...attackers, ...targets].some((id) => defOf(env, pieceOf(env, id)).kind === 'vehicle'),
      apply: (_v, { odds }, env) => statics(env).tables.ccKillHth(odds),
    });
    r.contribute({
      id: 'sk4.ja.hth-drm',
      query: 'cc.drm',
      ref: 'SK4 8.1.8.4',
      label: '-1 Japanese Hand-to-Hand',
      when: ({ hex, attackers, targets }, env) => {
        if (!hthActive(env, hex)) return false;
        const ja = attackers.map((a) => pieceOf(env, a)).filter((p) => jaInfantry(env, p));
        return ja.length > 0 && !ja.every(isPinned) && targets.some((t) => !!mmc(env, pieceOf(env, t)) || !!smc(env, pieceOf(env, t)));
      },
      apply: (v) => v - 1,
    });
    // A Reduced-Strength squad keeps its Full-Strength CCV.
    const fullCcv = (env: QueryEnv, unit: PieceId): number | null => {
      const m = mmc(env, pieceOf(env, unit));
      const full = m?.fullOf ? statics(env).counters[m.fullOf] : undefined;
      return m && m.nationality === 'ja' && full && isMmcDef(full) ? full.fp : null;
    };
    r.contribute({
      id: 'sk4.ja.reduced-ccv-attack',
      query: 'cc.attackFp',
      ref: 'SK4 8.1.8.4',
      layer: 1,
      when: ({ unit }, env) => fullCcv(env, unit) !== null,
      apply: (v, { unit }, env) => {
        const m = mmc(env, pieceOf(env, unit))!;
        return v - m.fp + fullCcv(env, unit)!;
      },
    });
    r.contribute({
      id: 'sk4.ja.reduced-ccv-defense',
      query: 'cc.defenseFp',
      ref: 'SK4 8.1.8.4',
      layer: 1,
      when: ({ unit }, env) => fullCcv(env, unit) !== null,
      apply: (v, { unit }, env) => {
        const m = mmc(env, pieceOf(env, unit))!;
        return v - m.fp + fullCcv(env, unit)!;
      },
    });

    // ---------------------------------------------------------------- 8.1.8.5 HIP for 10% of the on-board OB
    r.contribute({
      id: 'sk4.ja.hip',
      query: 'hiddenUnits.params',
      ref: 'SK4 8.1.8.5',
      when: (_c, env) => jaSides(env).length > 0,
      apply: (v, _c, env): HiddenUnitsParams | null => {
        if (v) return v;
        const side = jaSides(env)[0]!;
        const sc = statics(env).scenario;
        const counters = statics(env).counters;
        let se = 0;
        for (const f of sc.forces) {
          if (f.side !== side || (f.setup.kind !== 'area' && f.setup.kind !== 'hexes')) continue;
          for (const u of f.units) {
            const d = counters[u.def];
            if (d && isMmcDef(d)) se += (d.kind === 'squad' ? 1 : 0.5) * u.count;
          }
        }
        if (se === 0) return null;
        return { side, notOpenGround: true, quota: Math.ceil(se * 0.1 - 1e-9), rule: 'SK4 8.1.8.5' };
      },
    });
  },
};

/** A failed MC or a KIA's break wounds a Japanese leader (SK4 8.1.7): the wound severity dr, +1 if already wounded. */
function woundLeader(ctx: Ctx, unit: PieceId, reason: string): 'wounded' | 'eliminated' {
  const out = ctx.proc<CasualtyFn>(MP.casualtyReduce)(ctx, unit, `${reason}: wounded instead of broken (SK4 8.1.7)`);
  const outcome = out === 'eliminated' ? 'eliminated' : 'wounded';
  ctx.emit('sk4.ja.leaderWounded', { unit, outcome, reason });
  return outcome;
}

/** Every broken Japanese unit stacked with a Good Order Japanese leader is rolled for before the side's RPh ends. */
function forcedRallies(ctx: Ctx, side: SideId) {
  if (!jaSides(ctx).includes(side)) return;
  for (let guard = 0; guard < 50; guard++) {
    const due = Object.values(ctx.state.pieces)
      .filter((p) => p.side === side && p.loc.kind === 'hex' && isBroken(p) && !p.tags[T.rallyTried] && mmc(ctx, p) && isJapanese(ctx, p))
      .sort(byId)
      .map((p) => ({ unit: p.id as PieceId, leader: jaLeadersWith(ctx, p).filter((l) => isGoodOrder(ctx, l) && !isPinned(l)).sort(byId)[0] }))
      .find((d) => d.leader);
    if (!due) return;
    attemptRally(ctx, due.unit, due.leader!.id, false, false);
  }
}

