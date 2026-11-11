import type { Ctx, HexId, PieceId, RuleModule } from '@asl/engine';
import { byId, defOf, hexOf, isMmcDef, isSmcDef, personnelAt, statics } from '../common/pieces';
import { locOf, type LocId } from '../common/location';
import type { MmcDef, SmcDef } from '../common/statics';
import {
  type DrmNote,
  T,
  drmNotes,
  hasDm,
  isBroken,
  isGoodOrder,
  isPinned,
  mmc,
  pieceOf,
  setTags,
  sideSetup,
  smc,
  wounds,
} from './status';
import { adjacentToKnownEnemy } from './known';

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Extra DRM for a unit's MC/PTC DR (beyond the attack's own modifier and leadership). */
    'mc.drm': { ctx: { unit: PieceId; kind: CheckKind; reason: string }; value: number };
    /** Whether a unit is not subject to ELR replacement (underlined morale; SSRs may grant it). */
    'unit.elrExempt': { ctx: { unit: PieceId }; value: boolean };
    /**
     * Whether the optional bookkeeping events are recorded: a leader lending his DRM to a check (`sk1.morale.lent`), a
     * Smoke grenade attempt (`sk1.move.smoke`), a DC placement attempt (`sk1.move.dcAttempt`). Off by default so the
     * event count, and with it the decision ids, of every SK1–SK3 recording stay what they were; a rule pack that
     * listens for them (SK4 Concealment) turns it on.
     */
    'events.optional': { ctx: Record<string, never>; value: boolean };
    /** The Leader Loss check a unit takes for a leader's loss: the queued kind, unless a rule turns a LLMC into a LLTC (SK4 8.1.8.3). */
    'leaderLoss.kind': { ctx: { unit: PieceId; kind: 'LLMC' | 'LLTC' }; value: 'LLMC' | 'LLTC' };
  }
}

export type CheckKind = 'MC' | 'PTC';

export type CheckOutcome = 'passed' | 'pinned' | 'broken' | 'reduced' | 'eliminated' | 'stepReduced';
/** Rally attempt outcomes (SK1 3.1): an original 12 Casualty Reduces the unit. */
export type RallyOutcome = 'rallied' | 'failed' | 'reduced';

export interface CheckOptions {
  kind: CheckKind;
  /** Positive DRM from the result (e.g. 2 for a 2MC, K/2's +2). */
  mod: number;
  /** Leadership DRM applied (negative helps). */
  leaderDrm?: number;
  reason: string;
}

/** Procedure ids — other rule packs may wrap or replace these. */
export const P = {
  /** (ctx, unitIds, opts) => Record<PieceId, CheckOutcome>; handles leader-first ordering. */
  checkGroup: 'sk1.morale.checkGroup',
  /** (ctx, unitId, opts) => CheckOutcome */
  checkUnit: 'sk1.morale.checkUnit',
  /** (ctx, unitId, reason) => 'reduced' | 'wounded' | 'eliminated' */
  casualtyReduce: 'sk1.morale.casualtyReduce',
  /** (ctx, unitId, reason) => void — break (flip, DM, drop Pin/CX). */
  breakUnit: 'sk1.morale.break',
  /** (ctx, unitId, failedBy, reason) => void — an unbroken unit fails a MC (not an original 12): break, then ELR (SK1 5.1). */
  failMc: 'sk1.morale.failMc',
  /** (ctx, unitId) => void */
  pin: 'sk1.morale.pin',
  /** (ctx) => void — resolve queued Leader Loss MC/TC after an attack. */
  flushLeaderLoss: 'sk1.morale.flushLeaderLoss',
  /** (ctx, candidates, count, label, opts?) => PieceId[] (see RandomSelectFn) */
  randomSelect: 'sk1.random.select',
} as const;

export type CheckGroupFn = (ctx: Ctx, units: PieceId[], opts: CheckOptions) => Record<PieceId, CheckOutcome>;
export type CheckUnitFn = (ctx: Ctx, unit: PieceId, opts: CheckOptions) => CheckOutcome;
export type CasualtyFn = (ctx: Ctx, unit: PieceId, reason: string) => 'reduced' | 'wounded' | 'eliminated';
export type UnitFn = (ctx: Ctx, unit: PieceId, reason?: string) => void;
export type FailMcFn = (ctx: Ctx, unit: PieceId, failedBy: number, reason: string) => void;
export type FlushFn = (ctx: Ctx) => void;
/**
 * Random Selection of `count` units among `candidates`. `opts.ties`: the full ASL rule lets every unit tied
 * for the last pick be affected here (ASLRB A.9, A7.301, A7.302, A9.71, A11.11); the SK procedure ignores it
 * and re-rolls ties, because the SK text picks exactly that many ("one unit", "as many targets as").
 */
export type RandomSelectFn = (ctx: Ctx, candidates: PieceId[], count: number, label: string, opts?: { ties?: boolean }) => PieceId[];

interface LeaderLossEntry {
  kind: 'LLMC' | 'LLTC';
  /** The leader's Location: the units in it take the check (ASLRB A10.2). */
  hex: LocId;
  side: string;
  leaderMorale: number;
  leaderDrm: number;
}

const LL_KEY = 'sk1.leaderLoss';

export const moraleModule: RuleModule = {
  id: 'sk1.morale',
  ref: 'SK1 3.2.1, 5.1',
  summary: 'Morale Checks, Pin Task Checks, breaking, Casualty Reduction, wounds, ELR and Leader Loss checks.',
  requires: ['sk1.status'],
  install(r) {
    // SK1 3.2.1: "A broken unit not under DM that becomes adjacent to a Known Enemy Unit ... is placed
    // under DM." Adjacency can arise from either side moving (an enemy moving or advancing next to it,
    // a reinforcement entering beside it), so it is checked after every piece that appears or moves.
    // Fire that could inflict a NMC is the other way under DM (fire.ts); the RtPh start marks the
    // units that must rout (rout.ts).
    for (const event of ['piece.created', 'piece.moved']) {
      r.on({
        id: `sk1.morale.dm-adjacent.${event}`,
        event,
        handler(ctx) {
          for (const p of Object.values(ctx.state.pieces).filter((x) => x.loc.kind === 'hex' && isBroken(x) && !hasDm(x)).sort(byId)) {
            if (adjacentToKnownEnemy(ctx, p.side, locOf(ctx.state, p)!)) setTags(ctx, p.id, { [T.dm]: true });
          }
        },
      });
    }

    // A squad Casualty Reduced to a half-squad (distinct from an ELR replacement): the casualty ledger counts it.
    // ELR replacement (SK1 5.1): what the unit was, what it became, and by how much it failed.
    r.event<{ unit: PieceId; from: string; to: string; failedBy: number; elr: number }>({
      type: 'sk1.elr',
      apply() {},
    });
    r.event<{ unit: PieceId; from: string; to: string; reason: string }>({
      type: 'sk1.casualtyReduced',
      apply() {},
    });
    r.event<{ entry: LeaderLossEntry }>({
      type: 'sk1.leaderLoss.queued',
      apply(d, p) {
        const q = (d.ext[LL_KEY] as LeaderLossEntry[] | undefined) ?? [];
        q.push(p.entry);
        d.ext[LL_KEY] = q;
      },
    });
    r.event<Record<string, never>>({
      type: 'sk1.leaderLoss.cleared',
      apply(d) {
        delete d.ext[LL_KEY];
      },
    });
    // Informational record of every check for logs/replays.
    r.event<{
      unit: PieceId;
      kind: string;
      dr: number;
      final: number;
      target: number;
      outcome: CheckOutcome | RallyOutcome;
      reason: string;
      /** Total DRM applied to the DR (final − dr) and where it came from. */
      drm?: number;
      explain?: DrmNote[];
      /** Rally by a leader: who rolled for the unit. */
      leader?: PieceId | null;
    }>({
      type: 'sk1.check',
      apply() {},
    });

    /** A leader's modifier lent to another unit's MC (`checkGroup`). */
    r.event<{ leader: PieceId; to: PieceId; drm: number }>({ type: 'sk1.morale.lent', apply() {} });

    r.procedure<RandomSelectFn>(P.randomSelect, () => (ctx, candidates, count, label) => {
      // Each candidate rolls a dr; highest is selected; ties re-roll.
      let pool = [...candidates].sort();
      const picked: PieceId[] = [];
      while (picked.length < count && pool.length > 0) {
        if (pool.length === 1) {
          picked.push(pool[0]!);
          break;
        }
        let tied = pool;
        for (let guard = 0; guard < 100 && tied.length > 1; guard++) {
          const rolls = tied.map((id) => ({ id, v: ctx.roll(`${label}: random selection (${id})`, 1).total }));
          const max = Math.max(...rolls.map((x) => x.v));
          tied = rolls.filter((x) => x.v === max).map((x) => x.id);
        }
        picked.push(tied[0]!);
        pool = pool.filter((id) => id !== tied[0]);
      }
      return picked;
    });

    r.procedure<UnitFn>(P.pin, () => (ctx, unit) => {
      const p = pieceOf(ctx, unit);
      if (isBroken(p) || isPinned(p) || p.tags[T.pinnedThisTurn]) return;
      setTags(ctx, unit, { [T.pinned]: true, [T.pinnedThisTurn]: true });
    });

    r.procedure<UnitFn>(P.breakUnit, () => (ctx, unit) => {
      const p = pieceOf(ctx, unit);
      if (isBroken(p)) return;
      const wasGoodLeader = !!smc(ctx, p);
      const hex = locOf(ctx.state, p);
      setTags(ctx, unit, { [T.broken]: true, [T.dm]: true, [T.pinned]: null, [T.cx]: null });
      if (wasGoodLeader && hex && !inCloseCombat(ctx, unit)) {
        const l = smc(ctx, p)!;
        ctx.emit('sk1.leaderLoss.queued', {
          entry: {
            kind: 'LLTC',
            hex,
            side: p.side,
            leaderMorale: ctx.query('unit.morale', { unit }, l.morale),
            leaderDrm: ctx.query('unit.leadership', { unit }, l.leadership),
          },
        });
      }
    });

    r.procedure<FailMcFn>(P.failMc, () => (ctx, unit, failedBy) => {
      ctx.proc<UnitFn>(P.breakUnit)(ctx, unit);
      applyElr(ctx, unit, failedBy);
    });

    r.procedure<CasualtyFn>(P.casualtyReduce, () => (ctx, unit, reason) => {
      const p = pieceOf(ctx, unit);
      const d = defOf(ctx, p);
      if (isSmcDef(d)) {
        const dr = ctx.roll(`${reason}: wound severity`, 1).total + (wounds(p) > 0 ? 1 : 0);
        if (dr >= 5) {
          eliminate(ctx, unit, `${reason}: wound severity`);
          return 'eliminated';
        }
        setTags(ctx, unit, { [T.wounds]: wounds(p) + 1 });
        return 'wounded';
      }
      if (isMmcDef(d) && d.kind === 'squad' && d.reducesTo) {
        ctx.emit('piece.replaced', { id: unit, defId: d.reducesTo, from: p.defId, reason: 'cr' });
        ctx.emit('sk1.casualtyReduced', { unit, from: p.defId, to: d.reducesTo, reason });
        return 'reduced';
      }
      eliminate(ctx, unit, reason);
      return 'eliminated';
    });

    r.procedure<CheckUnitFn>(P.checkUnit, () => (ctx, unit, opts) => {
      const p = pieceOf(ctx, unit);
      const d = defOf(ctx, p) as MmcDef | SmcDef;
      const wasBroken = isBroken(p);
      // A PTC only affects unbroken, unpinned units.
      if (opts.kind === 'PTC' && (wasBroken || isPinned(p))) return 'passed';
      const morale = ctx.query('unit.morale', { unit }, wasBroken ? d.brokenMorale : d.morale);
      const extraRes = ctx.explain('mc.drm', { unit, kind: opts.kind, reason: opts.reason }, 0);
      const extra = extraRes.value;
      const roll = ctx.roll(`${opts.reason}: ${opts.kind} for ${unit}`);
      const final = roll.total + opts.mod + (opts.leaderDrm ?? 0) + extra;
      const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;
      const explain: DrmNote[] = [
        ...(opts.mod ? [{ id: 'mc.mod', label: `${signed(opts.mod)} ${opts.kind}` }] : []),
        ...(opts.leaderDrm ? [{ id: 'mc.leader', label: `${signed(opts.leaderDrm)} leader` }] : []),
        ...drmNotes(extraRes),
      ];
      const record = (outcome: CheckOutcome) => {
        ctx.emit('sk1.check', { unit, kind: opts.kind, dr: roll.total, final, target: morale, outcome, reason: opts.reason, drm: final - roll.total, explain });
        return outcome;
      };

      if (opts.kind === 'PTC') {
        if (final > morale) {
          ctx.proc<UnitFn>(P.pin)(ctx, unit);
          return record('pinned');
        }
        return record('passed');
      }

      if (roll.total === 12) {
        if (wasBroken) {
          eliminate(ctx, unit, `${opts.reason}: original 12 on MC while broken`);
          return record('eliminated');
        }
        return casualtyMc(ctx, unit, final - morale, opts.reason, record);
      }
      if (final > morale) {
        if (wasBroken) {
          const cr = ctx.proc<CasualtyFn>(P.casualtyReduce)(ctx, unit, `${opts.reason}: failed MC while broken`);
          return record(cr === 'eliminated' ? 'eliminated' : 'reduced');
        }
        // A unit with no broken side (a Japanese squad or crew, SK4 8.1.1) is Step Reduced instead of broken; the
        // failure itself is the `failMc` procedure, which a rule pack wraps (SK4 8.1.3's order: ELR, then the step).
        const outcome: CheckOutcome = isMmcDef(d) && d.kind !== 'hs' && (d.stepTo !== undefined || d.fullOf !== undefined) ? 'stepReduced' : 'broken';
        record(outcome);
        ctx.proc<FailMcFn>(P.failMc)(ctx, unit, final - morale, opts.reason);
        return outcome;
      }
      if (!wasBroken && final === morale) {
        ctx.proc<UnitFn>(P.pin)(ctx, unit);
        return record('pinned');
      }
      return record('passed');
    });

    r.procedure<CheckGroupFn>(P.checkGroup, () => (ctx, units, opts) => {
      const out: Record<PieceId, CheckOutcome> = {};
      const alive = units.filter((id) => ctx.state.pieces[id]?.loc.kind !== 'eliminated');
      // Best leader checks first; a leader who passes unharmed lends his DRM to the others.
      const leaders = alive
        .filter((id) => smc(ctx, pieceOf(ctx, id)))
        .sort((a, b) => {
          const la = smc(ctx, pieceOf(ctx, a))!;
          const lb = smc(ctx, pieceOf(ctx, b))!;
          return la.leadership - lb.leadership || lb.morale - la.morale || (a < b ? -1 : 1);
        });
      const others = alive.filter((id) => !leaders.includes(id)).sort();
      // Leaders who passed unharmed, each lending his DRM to the units after him (to those he may lead).
      const lenders: PieceId[] = [];
      const lend = (to: PieceId) => Math.min(0, ...lenders.map((l) => ctx.query('unit.leadership', { unit: l, for: to }, smc(ctx, pieceOf(ctx, l))!.leadership)));
      const usable = (id: PieceId) => {
        const p = pieceOf(ctx, id);
        return !isBroken(p) && !isPinned(p);
      };
      for (const l of leaders) {
        const before = pieceOf(ctx, l);
        const canLend = usable(l);
        out[l] = ctx.proc<CheckUnitFn>(P.checkUnit)(ctx, l, { ...opts, leaderDrm: lend(l) });
        const after = ctx.state.pieces[l];
        if (canLend && out[l] === 'passed' && after && wounds(after) === wounds(before)) lenders.push(l);
      }
      for (const id of others) {
        const drm = lend(id);
        // A leader lending his modifier to a MC uses it (Concealment loses its "?" for that, SK4 8.3).
        if (drm < 0 && ctx.query('events.optional', {}, false)) for (const l of lenders.filter((x) => ctx.query('unit.leadership', { unit: x, for: id }, smc(ctx, pieceOf(ctx, x))!.leadership) === drm)) ctx.emit('sk1.morale.lent', { leader: l, to: id, drm });
        out[id] = ctx.proc<CheckUnitFn>(P.checkUnit)(ctx, id, { ...opts, leaderDrm: drm });
      }
      return out;
    });

    r.procedure<FlushFn>(P.flushLeaderLoss, () => (ctx) => {
      for (let guard = 0; guard < 20; guard++) {
        const queue = (ctx.state.ext[LL_KEY] as LeaderLossEntry[] | undefined) ?? [];
        if (queue.length === 0) return;
        ctx.emit('sk1.leaderLoss.cleared', {});
        for (const e of queue) {
          const victims = personnelAt(ctx, e.hex, e.side)
            .filter((p) => {
              if (inCloseCombat(ctx, p.id)) return false;
              const m = ctx.query('unit.morale', { unit: p.id }, 0);
              if (m >= e.leaderMorale) return false;
              return e.kind === 'LLMC' || isGoodOrder(ctx, p);
            })
            .sort(byId);
          // Negative leadership DRM is added to the DR instead of subtracted.
          const mod = Math.max(0, -e.leaderDrm);
          for (const v of victims) {
            const kind = ctx.query('leaderLoss.kind', { unit: v.id, kind: e.kind }, e.kind);
            ctx.proc<CheckUnitFn>(P.checkUnit)(ctx, v.id, {
              kind: kind === 'LLMC' ? 'MC' : 'PTC',
              mod,
              reason: kind,
            });
          }
        }
      }
    });
  },
};

/** Leader Loss checks never apply to units in CC (SK1 3.2.1); in SK1 only CC eliminates units in the CCPh. */
const inCloseCombat = (ctx: Ctx, _id: PieceId) => ctx.state.phase === 'CCPh';

export function eliminate(ctx: Ctx, unit: PieceId, reason: string) {
  const p = pieceOf(ctx, unit);
  const l = smc(ctx, p);
  const hex = locOf(ctx.state, p);
  // Units in CC neither take nor cause a LLMC (SK1 3.2.1, ASLRB A10.2), so a CC kill queues none.
  if (l && hex && !inCloseCombat(ctx, unit)) {
    // Leader loss: compare against the leader's good-order morale (wounds applied).
    ctx.emit('sk1.leaderLoss.queued', {
      entry: {
        kind: 'LLMC',
        hex,
        side: p.side,
        leaderMorale: ctx.query('unit.morale', { unit }, l.morale),
        leaderDrm: ctx.query('unit.leadership', { unit }, l.leadership),
      },
    });
  }
  ctx.emit('piece.eliminated', { id: unit, reason });
}

/**
 * An unbroken unit's original 12 on a MC (SK1 3.2.1; ASLRB A10.31): it breaks and suffers Casualty Reduction, which
 * comes "after any unit Replacement which may also be required by ELR Failure" (SK1 3.2.1 and 5.1 are silent on the
 * order): a 4-6-7 replaced by a 4-4-7 becomes a 2-4-7. `record` emits the check event: a MMC's result is known
 * beforehand, so its check is recorded first, as for any other check; a SMC's wound severity dr decides his, so his
 * check follows.
 */
export function casualtyMc(ctx: Ctx, unit: PieceId, failedBy: number, reason: string, record: (o: CheckOutcome) => CheckOutcome): CheckOutcome {
  const p = pieceOf(ctx, unit);
  // Named so a rule pack that turns a plain break into something else (SK4 8.1.3 Step Reduction) leaves this one alone:
  // a Casualty Reduction result applies in the normal manner (SK4 8.1.4).
  ctx.proc<UnitFn>(P.breakUnit)(ctx, unit, 'casualtyMc');
  if (isMmcDef(defOf(ctx, p))) {
    const survives = (defId: string) => {
      const c = statics(ctx).counters[defId];
      return !!c && isMmcDef(c) && c.kind === 'squad' && !!c.reducesTo;
    };
    const outcome = survives(elrReplacement(ctx, unit, failedBy)?.next ?? p.defId) ? 'reduced' : 'eliminated';
    record(outcome);
    // A HS or crew the reduction eliminates anyway is not replaced first: the same CVP, two events fewer.
    if (survives(p.defId)) applyElr(ctx, unit, failedBy);
    ctx.proc<CasualtyFn>(P.casualtyReduce)(ctx, unit, `${reason}: original 12 on MC`);
    return outcome;
  }
  applyElr(ctx, unit, failedBy);
  const cr = ctx.proc<CasualtyFn>(P.casualtyReduce)(ctx, unit, `${reason}: original 12 on MC`);
  return record(cr === 'eliminated' ? 'eliminated' : 'reduced');
}

/** SK1 5.1: what an unbroken unit failing an MC by `failedBy` is replaced by (and its ELR), or null. */
export function elrReplacement(ctx: Ctx, unit: PieceId, failedBy: number): { next: string; elr: number } | null {
  const p = ctx.state.pieces[unit];
  if (!p || p.loc.kind === 'eliminated') return null;
  const setup = sideSetup(ctx, p.side);
  const elr = setup.elrs?.[defOf(ctx, p).nationality] ?? setup.elr;
  if (failedBy <= elr) return null;
  const m = mmc(ctx, p);
  const l = smc(ctx, p);
  if (m && (ctx.query('unit.elrExempt', { unit }, m.elrExempt) || !m.elrReplacement)) return null;
  // A leader is subject to ELR unless an SSR says otherwise (S18's Commissar).
  if (l && ctx.query('unit.elrExempt', { unit }, false)) return null;
  const next = m?.elrReplacement ?? l?.elrReplacement;
  return next ? { next, elr } : null;
}

/** SK1 5.1: an unbroken unit failing an MC by more than its ELR is replaced (broken). */
export function applyElr(ctx: Ctx, unit: PieceId, failedBy: number) {
  const r = elrReplacement(ctx, unit, failedBy);
  if (!r) return;
  const from = ctx.state.pieces[unit]!.defId;
  ctx.emit('piece.replaced', { id: unit, defId: r.next, from, reason: 'elr' });
  ctx.emit('sk1.elr', { unit, from, to: r.next, failedBy, elr: r.elr });
}
