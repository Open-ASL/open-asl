import type { Action, Ctx, Decision, HexId, Location, Piece, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { byId, defOf, hexOf, isFixedWeapon, otherSide, personnelAt, statics, swHeldBy, unpossessedSwAt } from '../common/pieces';
import { locOf } from '../common/location';
import { PHASE_DECISION, PHASE_DONE, askPhaseOwner, type PhaseDoneFn } from '../common/turn';
import { capturedUseExempt } from './forceRules';
import { adjacentToKnownEnemy } from './known';
import { P as MP, type CasualtyFn, type FlushFn, type RallyOutcome } from './morale';
import {
  T,
  drmNotes,
  hasDm,
  isBroken,
  isCaptured,
  isCx,
  isGoodOrder,
  isMalf,
  isPinned,
  mmc,
  pieceOf,
  setTags,
  sideSetup,
  smc,
  sw,
  gun,
  weapon,
  actionIllegal,
  ppOf,
} from './status';
import { terrainOf } from './terrain';

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Recovery drm (SK1 3.1, 4.0): +1 CX; PTO jungle, kunai and bamboo +2 (SK4 8.2). */
    'recover.drm': { ctx: { unit: PieceId; hex: HexId }; value: number };
    /** DRM for a rally attempt. */
    'rally.drm': { ctx: { unit: PieceId; leader: PieceId | null; self: boolean }; value: number };
    /**
     * Why a broken unit may not keep its DM: the base answer is the woods/building refusal (SK1 3.1 g) or null; full ASL
     * adds the pillbox and trench (ASLRB A10.62) and lifts the woods/building refusal for an overstacked unit (A10.62).
     */
    'rally.dmKeepIllegal': { ctx: { unit: PieceId }; value: string | null };
    /**
     * Where a leader created by `unit` (Leader Creation, SK1/SK4 5.3; ASLRB A18.1) is placed: its hex in the Starter Kit
     * (every hex one Location). Full ASL: its Location, or `why` it is not created there (A5.6, B30.111: a full pillbox).
     */
    'rally.createdLeaderAt': { ctx: { unit: PieceId }; value: { loc: Location } | { why: string } };
    /** Why a repair attempt on the SW is not allowed now (an SSR may forbid it), or null. */
    'sw.repairIllegal': { ctx: { unit: PieceId; sw: PieceId }; value: string | null };
    /** How many SW the unit may try to repair this RPh: one, its one RPh action (SK1/SK4 3.1); full ASL more (asl/swRepair.ts). */
    'rally.repairs': { ctx: { unit: PieceId }; value: number };
    /** Whether a unit may always self-rally (a box around its broken side morale; SSRs may grant it). */
    'unit.selfRally': { ctx: { unit: PieceId }; value: boolean };
    /** Whether this self-rally attempt of `unit` is the one an original 2 may promote on (SK1/SK4 5.3). */
    'rally.promotes': { ctx: { unit: PieceId }; value: boolean };
    /**
     * Why `leader` may not rally `unit` (an SSR may say a unit returns to Good Order only by self-rally), or null. A
     * leader who may not rally a unit does not stop its self-rally in his Location either.
     */
    'rally.byLeaderIllegal': { ctx: { leader: PieceId; unit: PieceId }; value: string | null };
    /** Why the ATTACKER's self-rally of a MMC without self-rally capability is not allowed now, or null. */
    'rally.mmcSelfRallyIllegal': { ctx: { unit: PieceId }; value: string | null };
    /**
     * Why `unit` may not undertake this RPh action after what it has done already this RPh, or null. The Starter Kit
     * answers null here (SK1 3.1 exempts leaders rallying; its own `rphAction` checks stay where they are); full ASL
     * holds a leader to one action (A10.7) and makes a Transfer an action (A4.431).
     */
    'rally.actionIllegal': { ctx: { unit: PieceId; action: RphActionKind }; value: string | null };
  }
}

/** The Recovery drm for a unit where it stands (`recover.drm`). */
export const recoverDrm = (env: QueryEnv, unit: PieceId) => env.query('recover.drm', { unit, hex: hexOf(env.state, pieceOf(env, unit)) ?? '' }, 0);

/** The Rally Phase actions a unit (or a leader, for the units he rallies) may take. */
export type RphActionKind = 'rally' | 'recover' | 'repair' | 'transfer' | 'deploy' | 'recombine';
/** (ctx, unit, action) => void — after a unit acted in the RPh in a way the Starter Kit does not record (a leader rallying, a Transfer). */
export type RphActedFn = (ctx: Ctx, unit: PieceId, action: RphActionKind) => void;

export const RP = {
  /** RphActedFn: nothing in the Starter Kit (SK1 3.1); full ASL records it (asl/deploy.ts, A10.7, A4.431). */
  acted: 'sk1.rally.acted',
  /** (ctx, unit) => PieceId | null — Leader Creation (SK1 5.3). */
  fieldPromotion: 'sk1.fieldPromotion',
  /** (ctx, unit, leader) => void — after a failed rally attempt (not an original 12); nothing by default (a Commissar replaces the unit). */
  rallyFailed: 'sk1.rally.failed',
} as const;
/** `broken`: the unit's state when it rolled the original 2 (it defaults to its state now). */
export type FieldPromotionFn = (ctx: Ctx, unit: PieceId, morale: number, opts?: { ccColumnsBelowEven?: number; broken?: boolean }) => PieceId | null;
export type RallyFailedFn = (ctx: Ctx, unit: PieceId, leader: PieceId | null) => void;

type RallyAction =
  | (Action & { type: 'rally.selfRally'; unit: PieceId })
  | (Action & { type: 'rally.rally'; leader: PieceId; unit: PieceId })
  | (Action & { type: 'rally.rallyAll'; leader: PieceId })
  | (Action & { type: 'rally.recover'; unit: PieceId; sw: PieceId })
  | (Action & { type: 'rally.repair'; unit: PieceId; sw: PieceId })
  | (Action & { type: 'rally.transfer'; sw: PieceId; to: PieceId })
  | (Action & { type: 'rally.dmRemove'; unit: PieceId })
  | (Action & { type: 'rally.dmKeep'; unit: PieceId });

const rallySide = (env: QueryEnv) =>
  ((env.state.decisions[env.state.decisions.length - 1]?.data?.['side'] as string | undefined) ?? env.state.attacker);

const RPH = 'sk1.rph';
interface RphState {
  /** Attacker used his one non-self-rally-capable MMC self-rally this RPh. */
  attackerMmcSelfRally?: boolean;
  /** Units that made a self-rally attempt this RPh (Field Promotion: each side's first one). */
  selfRallied?: PieceId[];
}
const rph = (env: QueryEnv) => (env.state.ext[RPH] as RphState | undefined) ?? {};

/**
 * Field Promotion goes with "the first self-rally attempt of a RPh" (SK1/SK4 5.3). Read literally: either side's
 * first self-rally attempt of the RPh, by any of its units (a leader's own self-rally counts); a leader rallying
 * a unit is not a self-rally and does not count. Full ASL narrows it (asl/fieldPromotion.ts, A18.11). Read
 * before the attempt is recorded.
 */
const firstSelfRallyOfSide = (env: QueryEnv, side: string): boolean => !(rph(env).selfRallied ?? []).some((id) => env.state.pieces[id]?.side === side);

const selfRallyCapable = (env: QueryEnv, unit: PieceId): boolean => {
  const p = pieceOf(env, unit);
  return env.query('unit.selfRally', { unit }, smc(env, p) ? true : !!mmc(env, p)?.selfRally);
};

/**
 * Why `unit`'s owner has no choice about its DM counter at the end of this RPh, or null when he has. "All DM counters
 * are removed at the end of the RPh unless the DM unit is adjacent to a Known Enemy Unit. A broken unit may opt to keep
 * its DM status unless in woods or building" (SK1 3.1 g; ASLRB A10.62, "so as to guarantee its ability to rout again in
 * the next RtPh": only a broken unit under DM may rout, SK1 3.6). Jungle and huts count as woods and building (SK4 8.2).
 * Full ASL adds the pillbox and trench Locations and lifts the woods/building refusal for an overstacked unit (A10.62).
 */
/** The refusal of the DM choice to a unit in woods or a building (SK1 3.1 g; ASLRB A10.62). */
export const DM_IN_SHELTER = 'In woods or a building: its DM comes off at the end of the RPh (SK1 3.1 g)';

export function dmChoiceIllegal(env: QueryEnv, side: string, unit: PieceId): string | null {
  const p = env.state.pieces[unit];
  if (!p || p.side !== side) return 'Not your unit';
  if (!hasDm(p) || !isBroken(p)) return 'Only a broken unit under DM';
  const loc = p.loc.kind === 'hex' ? locOf(env.state, p) : undefined;
  if (!loc) return 'Not on the map';
  if (adjacentToKnownEnemy(env, side, loc)) return 'Adjacent to a Known enemy unit: it keeps its DM (SK1 3.1 g)';
  // In woods or a building the DM comes off: the base answer, which a rule may lift (full ASL A10.62: overstacked there).
  return env.query('rally.dmKeepIllegal', { unit }, terrainOf(env, hexOf(env.state, p)!).routShelter ? DM_IN_SHELTER : null);
}

/** Whether `unit`'s DM counter stays on at the end of this RPh: beside a Known enemy, or kept by its owner's choice (the default). */
export function dmStaysOn(env: QueryEnv, unit: PieceId): boolean {
  const p = env.state.pieces[unit];
  if (!p || !hasDm(p) || p.loc.kind !== 'hex') return false;
  if (adjacentToKnownEnemy(env, p.side, locOf(env.state, p)!)) return true;
  return !dmChoiceIllegal(env, p.side, unit) && p.tags[T.dmRemove] !== true;
}

function selfRallyIllegal(env: QueryEnv, side: string, unit: PieceId): string | null {
  const p = env.state.pieces[unit];
  if (!p || p.side !== side || p.loc.kind !== 'hex') return 'Not your unit on the map';
  if (!isBroken(p)) return 'Unit is not broken';
  if (p.tags[T.rallyTried]) return 'Unit already attempted to rally this Player Turn';
  // Full ASL A10.63 (SK1 3.1e is silent): no self-rally in a Location with a Good Order friendly leader;
  // he rallies the unit instead.
  const loc = locOf(env.state, p);
  if (
    loc &&
    personnelAt(env, loc, side).some((l) => l.id !== unit && smc(env, l) && !isBroken(l) && isGoodOrder(env, l) && !env.query('rally.byLeaderIllegal', { leader: l.id, unit }, null))
  ) {
    return 'A Good Order leader is in the Location: he rallies the unit instead';
  }
  const boxed = selfRallyCapable(env, unit);
  if (boxed) return null;
  if (side !== env.state.attacker) return 'Only the ATTACKER may self-rally a MMC without self-rally capability';
  if (rph(env).attackerMmcSelfRally) return 'The ATTACKER may self-rally only one such MMC per RPh';
  return env.query('rally.mmcSelfRallyIllegal', { unit }, null);
}

/** Why a SMC cannot rally other units at all now: SK1 3.1 f gives that to a Good Order leader. */
function leaderCannotRally(env: QueryEnv, l: Piece): string | null {
  if (!smc(env, l)) return 'Rally needs a Good Order leader';
  // SK1 3.1 f: "If the only leader present in a stack of broken units is himself broken, he may attempt to rally the
  // other units only if he self rallies first."
  if (isBroken(l)) return 'A broken leader must be rallied before he may rally others (SK1 3.1)';
  // SK1 glossary: "Good Order: An Infantry unit that is neither broken nor marked with a Melee counter."
  if (!isGoodOrder(env, l)) return 'A leader in Melee is not in Good Order, so he cannot rally others (SK1 3.1, glossary)';
  return null;
}

function rallyIllegal(env: QueryEnv, side: string, leader: PieceId, unit: PieceId): string | null {
  const l = env.state.pieces[leader];
  const u = env.state.pieces[unit];
  if (!l || !u || l.side !== side || u.side !== side) return 'Not your units';
  const cannot = leaderCannotRally(env, l);
  if (cannot) return cannot;
  if (locOf(env.state, l) !== locOf(env.state, u)) return 'Leader must be stacked with the unit';
  if (!isBroken(u)) return 'Unit is not broken';
  if (u.tags[T.rallyTried]) return 'Unit already attempted to rally this Player Turn';
  if (leader === unit) return 'Use self-rally';
  return env.query('rally.actionIllegal', { unit: leader, action: 'rally' }, null) ?? env.query('rally.byLeaderIllegal', { leader, unit }, null);
}

/** The broken units in the leader's Location he may still attempt to rally. */
const rallyableBy = (env: QueryEnv, side: string, leader: PieceId): PieceId[] => {
  const loc = locOf(env.state, pieceOf(env, leader));
  if (!loc) return [];
  return personnelAt(env, loc, side)
    .sort(byId)
    .filter((u) => !rallyIllegal(env, side, leader, u.id))
    .map((u) => u.id);
};

const goodOrderUnpinned = (env: QueryEnv, id: PieceId) => {
  const p = pieceOf(env, id);
  return isGoodOrder(env, p) && !isPinned(p);
};

export const rallyModule: RuleModule = {
  id: 'sk1.rally',
  ref: 'SK1 3.1, 5.3',
  summary: 'Rally Phase: SW recovery, repair and transfer, self-rally, leader rally, DM removal, field promotion.',
  requires: ['sk1.morale', 'common.turn'],
  install(r) {
    r.contribute({ id: 'sk1.recover.cx', query: 'recover.drm', ref: 'SK1 4.0', label: '+1 CX', when: ({ unit }, env) => isCx(pieceOf(env, unit)), apply: (v) => v + 1 });
    r.event<{ state: RphState | null }>({
      type: 'sk1.rph.state',
      apply(d, p) {
        if (p.state) d.ext[RPH] = p.state;
        else delete d.ext[RPH];
      },
    });

    r.contribute({
      id: 'sk1.rally.dm',
      query: 'rally.drm',
      ref: 'SK1 3.1',
      label: '+4 Desperation Morale',
      when: ({ unit }, env) => hasDm(pieceOf(env, unit)),
      apply: (v) => v + 4,
    });
    r.contribute({
      id: 'sk1.rally.cover',
      query: 'rally.drm',
      ref: 'SK1 3.1',
      label: '-1 woods/building',
      when: ({ unit }, env) => {
        const h = hexOf(env.state, pieceOf(env, unit));
        return !!h && !!terrainOf(env, h).rallyCover;
      },
      apply: (v) => v - 1,
    });
    r.contribute({
      id: 'sk1.rally.self',
      query: 'rally.drm',
      ref: 'SK1 3.1',
      label: '+1 self-rally',
      when: ({ self }) => self,
      apply: (v) => v + 1,
    });
    r.contribute({
      id: 'sk1.rally.leader',
      query: 'rally.drm',
      ref: 'SK1 3.1',
      label: 'leadership',
      when: ({ leader, self }) => !!leader && !self,
      apply: (v, { leader, unit }, env) => v + env.query('unit.leadership', { unit: leader!, for: unit }, smc(env, pieceOf(env, leader!))!.leadership),
    });

    r.event<{ unit: PieceId; dr: number; leader: PieceId | null; defId: string | null; why?: string }>({ type: 'sk1.leaderCreation', apply() {} });
    r.procedure<RallyFailedFn>(RP.rallyFailed, () => () => {});
    r.procedure<RphActedFn>(RP.acted, () => () => {});
    r.procedure<FieldPromotionFn>(RP.fieldPromotion, () => (ctx, unit, morale, opts) => {
      const p = pieceOf(ctx, unit);
      const hex = hexOf(ctx.state, p);
      if (!hex) return null;
      // A promoted leader is of the unit's own counter nationality (a Greek squad creates an Allied Minor leader).
      const nat = defOf(ctx, p).nationality;
      const dr = ctx.roll(`Leader Creation for ${unit}`, 1).total;
      const def = statics(ctx).tables.leaderCreation(nat, morale, dr, opts?.broken ?? p.tags[T.broken] === true, opts?.ccColumnsBelowEven ?? 0);
      const at = def ? ctx.query('rally.createdLeaderAt', { unit }, { loc: { kind: 'hex', hex } }) : null;
      const id = def && at && 'loc' in at ? `${unit}.L${ctx.state.seq}` : null;
      if (def && id && at && 'loc' in at) ctx.emit('piece.created', { piece: { id, defId: def, side: p.side, loc: at.loc, tags: {} } });
      // What the dr produced, for the log and the dice toast: the new leader, or none (and why not, where a rule bars him).
      ctx.emit('sk1.leaderCreation', { unit, dr, leader: id, defId: def, ...(at && 'why' in at ? { why: at.why } : {}) });
      return id;
    });

    r.on<{ phase: string }>({
      id: 'sk1.rally.start',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'RPh') return;
        ctx.emit('sk1.rph.state', { state: {} });
        askPhaseOwner(ctx, ctx.state.attacker, { side: ctx.state.attacker });
      },
    });

    // Attacker finishes → defender acts → phase ends.
    r.procedure<PhaseDoneFn>(PHASE_DONE, (next) => (ctx, decision: Decision) => {
      if (ctx.state.phase === 'RPh' && decision.owner === ctx.state.attacker) {
        const def = otherSide(ctx.state, ctx.state.attacker);
        askPhaseOwner(ctx, def, { side: def });
        return;
      }
      next!(ctx, decision);
    });

    r.on<{ phase: string }>({
      id: 'sk1.rally.end',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'RPh') return;
        // DM removed unless adjacent to a Known Enemy Unit, or kept by its owner where he may keep it (SK1 3.1 g).
        for (const p of Object.values(ctx.state.pieces).filter((x) => hasDm(x) && x.loc.kind === 'hex').sort(byId)) {
          if (!dmStaysOn(ctx, p.id)) setTags(ctx, p.id, { [T.dm]: null });
        }
        for (const p of Object.values(ctx.state.pieces).filter((x) => x.tags[T.dmRemove]).sort(byId)) setTags(ctx, p.id, { [T.dmRemove]: null });
        ctx.emit('sk1.rph.state', { state: null });
        for (const p of Object.values(ctx.state.pieces).filter((x) => x.tags[T.rphAction] || x.tags[T.recoveredPhase] || x.tags[T.repairTried]).sort(byId)) {
          setTags(ctx, p.id, { [T.rphAction]: null, [T.recoveredPhase]: null, [T.repairTried]: null });
        }
      },
    });

    const reAsk = (ctx: Ctx, side: string) => {
      ctx.popDecision();
      askPhaseOwner(ctx, side, { side });
    };

    // The DM choice (SK1 3.1 g): a unit that may keep its DM keeps it unless its owner has it removed. Only the removal
    // is listed among the legal actions (so a player and the computer opponent are offered it, but random play never
    // toggles it back and forth); the undo is validated alike. Neither is the unit's one RPh action.
    r.action<RallyAction & { type: 'rally.dmRemove' }>({
      type: 'rally.dmRemove',
      decisionKinds: [PHASE_DECISION],
      legal: (env) =>
        env.state.phase !== 'RPh'
          ? []
          : Object.values(env.state.pieces)
              .filter((p) => p.tags[T.dmRemove] !== true && !dmChoiceIllegal(env, rallySide(env), p.id))
              .sort(byId)
              .map((p) => ({ type: 'rally.dmRemove' as const, unit: p.id })),
      validate: (env, a) =>
        env.state.phase !== 'RPh' ? 'Not the Rally Phase' : (dmChoiceIllegal(env, rallySide(env), a.unit) ?? (env.state.pieces[a.unit]?.tags[T.dmRemove] ? 'Its DM already comes off' : null)),
      resolve(ctx, a) {
        setTags(ctx, a.unit, { [T.dmRemove]: true });
        reAsk(ctx, a.side);
      },
    });
    r.action<RallyAction & { type: 'rally.dmKeep' }>({
      type: 'rally.dmKeep',
      decisionKinds: [PHASE_DECISION],
      validate: (env, a) =>
        env.state.phase !== 'RPh' ? 'Not the Rally Phase' : (dmChoiceIllegal(env, rallySide(env), a.unit) ?? (env.state.pieces[a.unit]?.tags[T.dmRemove] ? null : 'It keeps its DM already')),
      resolve(ctx, a) {
        setTags(ctx, a.unit, { [T.dmRemove]: null });
        reAsk(ctx, a.side);
      },
    });

    r.action<RallyAction & { type: 'rally.selfRally' }>({
      type: 'rally.selfRally',
      decisionKinds: [PHASE_DECISION],
      legal: (env) =>
        env.state.phase !== 'RPh'
          ? []
          : Object.values(env.state.pieces)
              .filter((p) => !selfRallyIllegal(env, rallySide(env), p.id))
              .sort(byId)
              .map((p) => ({ type: 'rally.selfRally' as const, unit: p.id })),
      validate: (env, a) => (env.state.phase !== 'RPh' ? 'Not the Rally Phase' : selfRallyIllegal(env, rallySide(env), a.unit)),
      resolve(ctx, a) {
        const p = pieceOf(ctx, a.unit);
        const boxed = selfRallyCapable(ctx, a.unit);
        const st = rph(ctx);
        const firstSelfRally = !!mmc(ctx, p) && ctx.query('rally.promotes', { unit: a.unit }, firstSelfRallyOfSide(ctx, p.side));
        ctx.emit('sk1.rph.state', { state: { ...st, selfRallied: [...(st.selfRallied ?? []), a.unit], ...(!boxed ? { attackerMmcSelfRally: true } : {}) } });
        attemptRally(ctx, a.unit, null, true, firstSelfRally);
        reAsk(ctx, a.side);
      },
    });

    r.action<RallyAction & { type: 'rally.rally' }>({
      type: 'rally.rally',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        if (env.state.phase !== 'RPh') return [];
        const side = rallySide(env);
        const out: { type: 'rally.rally'; leader: PieceId; unit: PieceId }[] = [];
        for (const l of Object.values(env.state.pieces).filter((p) => p.side === side && smc(env, p)).sort(byId)) {
          const loc = locOf(env.state, l);
          if (!loc) continue;
          for (const u of personnelAt(env, loc, side).sort(byId)) {
            if (!rallyIllegal(env, side, l.id, u.id)) out.push({ type: 'rally.rally', leader: l.id, unit: u.id });
          }
        }
        return out;
      },
      validate: (env, a) => (env.state.phase !== 'RPh' ? 'Not the Rally Phase' : rallyIllegal(env, rallySide(env), a.leader, a.unit)),
      resolve(ctx, a) {
        attemptRally(ctx, a.unit, a.leader, false, false);
        reAsk(ctx, a.side);
      },
    });

    // A leader rallies every broken unit in his Location in one go, each with its own DR.
    r.action<RallyAction & { type: 'rally.rallyAll' }>({
      type: 'rally.rallyAll',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        if (env.state.phase !== 'RPh') return [];
        const side = rallySide(env);
        return Object.values(env.state.pieces)
          .filter((p) => p.side === side && smc(env, p) && rallyableBy(env, side, p.id).length > 1)
          .sort(byId)
          .map((p) => ({ type: 'rally.rallyAll' as const, leader: p.id }));
      },
      validate(env, a) {
        if (env.state.phase !== 'RPh') return 'Not the Rally Phase';
        const l = env.state.pieces[a.leader];
        if (!l || l.side !== rallySide(env)) return 'Not your leader';
        const cannot = leaderCannotRally(env, l);
        if (cannot) return cannot;
        return rallyableBy(env, rallySide(env), a.leader).length ? null : 'No broken unit here to rally';
      },
      resolve(ctx, a) {
        for (const unit of rallyableBy(ctx, a.side, a.leader)) attemptRally(ctx, unit, a.leader, false, false);
        reAsk(ctx, a.side);
      },
    });

    r.action<RallyAction & { type: 'rally.recover' }>({
      type: 'rally.recover',
      decisionKinds: [PHASE_DECISION],
      validate(env, a) {
        if (env.state.phase !== 'RPh') return 'Not the Rally Phase';
        const u = env.state.pieces[a.unit];
        if (!u || u.side !== rallySide(env) || !goodOrderUnpinned(env, a.unit)) return 'Recovery needs a Good Order unit';
        if (!mmc(env, u) && !smc(env, u)) return 'Only Infantry may recover a weapon';
        const acted = env.query('rally.actionIllegal', { unit: a.unit, action: 'recover' }, null);
        if (acted) return acted;
        if (u.tags[T.rphAction]) return 'Unit already acted this RPh';
        const halted = actionIllegal(env, [a.unit]);
        if (halted) return halted;
        const loc = locOf(env.state, u);
        if (!loc || !unpossessedSwAt(env, loc).some((s) => s.id === a.sw)) return 'No such unpossessed weapon in the hex';
        if (gun(env, pieceOf(env, a.sw)) && !mmc(env, u)) return 'Only a MMC may possess a Gun';
        // ASLRB A4.44 (SK4 4.0 is silent): no Recovery in the same Location as an enemy unit, i.e. in a Melee hex.
        if (personnelAt(env, loc, otherSide(env.state, u.side)).length) return 'No Recovery in a hex with an enemy unit';
        const across = env.query('recover.illegal', { unit: a.unit, sw: a.sw }, null);
        if (across) return across;
        return null;
      },
      resolve(ctx, a) {
        const dr = ctx.roll(`Recover ${a.sw}`, 1).total + recoverDrm(ctx, a.unit);
        setTags(ctx, a.unit, { [T.rphAction]: true });
        if (dr < 6) {
          ctx.emit('piece.moved', { id: a.sw, loc: { kind: 'held', by: a.unit } });
          setTags(ctx, a.sw, { [T.recoveredPhase]: true });
          if (pieceOf(ctx, a.sw).side !== a.side) ctx.emit('sk1.sw.owner', { id: a.sw, side: a.side });
        }
        reAsk(ctx, a.side);
      },
    });

    r.action<RallyAction & { type: 'rally.repair' }>({
      type: 'rally.repair',
      decisionKinds: [PHASE_DECISION],
      validate(env, a) {
        if (env.state.phase !== 'RPh') return 'Not the Rally Phase';
        const u = env.state.pieces[a.unit];
        const s = env.state.pieces[a.sw];
        if (!u || !s || u.side !== rallySide(env)) return 'Not your unit';
        if (!(mmc(env, u) || smc(env, u))) return 'SW/Gun repair requires Infantry';
        if (isFixedWeapon(env, s)) return 'A fixed vehicular weapon requires vehicle repair';
        if (!goodOrderUnpinned(env, a.unit)) return 'Repair needs a Good Order unit';
        // "Each unit may undertake only one action per RPh" (SK1/SK4 3.1), so one repair attempt; full ASL lets a squad
        // try two (asl/swRepair.ts, A9.72). `rphAction` counts its repairs; `true` is a Recovery or rally, its sole action.
        const acted = env.query('rally.actionIllegal', { unit: a.unit, action: 'repair' }, null);
        if (acted) return acted;
        const repairs = u.tags[T.rphAction];
        if (repairs === true || (typeof repairs === 'number' && repairs >= env.query('rally.repairs', { unit: a.unit }, 1))) return 'Unit already acted this RPh';
        const halted = actionIllegal(env, [a.unit]);
        if (halted) return halted;
        if (s.loc.kind !== 'held' || s.loc.by !== a.unit) return 'Unit must possess the SW';
        if (!isMalf(s)) return 'SW is not malfunctioned';
        // One Repair dr per SW: a failed dr leaves it unchanged for the Player Turn, whoever holds it (A9.72).
        if (s.tags[T.repairTried]) return 'A repair was already attempted on this SW this turn';
        // A captured weapon is never repaired (SK4 3.1c; ASLRB A9.72), unless an SSR lets this unit use it without Captured
        // Use penalties: the weapon is then treated as its own (Perry Sez A25.75: such a weapon may also be repaired).
        if (isCaptured(env, s) && !capturedUseExempt(env, s.id, u.id)) return 'Only weapons of the unit\'s own nationality can be repaired';
        if (weapon(env, s)?.repair === undefined) return 'Weapon cannot be repaired';
        return env.query('sw.repairIllegal', { unit: a.unit, sw: a.sw }, null);
      },
      resolve(ctx, a) {
        const d = weapon(ctx, pieceOf(ctx, a.sw))!;
        const dr = ctx.roll(`Repair ${a.sw}`, 1).total;
        const done = pieceOf(ctx, a.unit).tags[T.rphAction];
        setTags(ctx, a.unit, { [T.rphAction]: (typeof done === 'number' ? done : 0) + 1 });
        setTags(ctx, a.sw, { [T.repairTried]: true });
        if (dr === 6) ctx.emit('piece.eliminated', { id: a.sw, reason: 'repair dr of 6' });
        else if (dr <= d.repair!) setTags(ctx, a.sw, { [T.malf]: null });
        reAsk(ctx, a.side);
      },
    });

    r.action<RallyAction & { type: 'rally.transfer' }>({
      type: 'rally.transfer',
      decisionKinds: [PHASE_DECISION],
      validate(env, a) {
        if (env.state.phase !== 'RPh' && env.state.phase !== 'APh') return 'SW transfer is only possible in the RPh or APh';
        const s = env.state.pieces[a.sw];
        const to = env.state.pieces[a.to];
        if (!s || !to || s.loc.kind !== 'held') return 'Invalid transfer';
        if (isFixedWeapon(env, s)) return 'A vehicular MG is part of its vehicle';
        const from = pieceOf(env, s.loc.by);
        if (from.side !== a.side || to.side !== a.side) return 'Not your units';
        if (locOf(env.state, from) !== locOf(env.state, to)) return 'Units must be in the same location';
        const across = env.query('transfer.illegal', { sw: s.id, from: from.id, to: to.id }, null);
        if (across) return across;
        if (env.state.phase === 'RPh') {
          const acted = env.query('rally.actionIllegal', { unit: from.id, action: 'transfer' }, null) ?? env.query('rally.actionIllegal', { unit: to.id, action: 'transfer' }, null);
          if (acted) return acted;
        }
        const halted = actionIllegal(env, [from.id, to.id]);
        if (halted) return halted;
        if (!goodOrderUnpinned(env, from.id) || !goodOrderUnpinned(env, to.id)) return 'Both units must be Good Order (and unpinned)';
        if (s.tags[T.recoveredPhase]) return 'A SW cannot be transferred in the phase it was recovered';
        if (!mmc(env, to) && !smc(env, to)) return 'Must transfer to Infantry';
        if (gun(env, s) && !mmc(env, to)) return 'Only a MMC may possess a Gun';
        if (smc(env, to) && swHeldBy(env.state, to.id).reduce((x, y) => x + ppOf(env, y), 0) + ppOf(env, s) > 2) {
          return 'A SMC may never carry more than 2 PP';
        }
        return null;
      },
      resolve(ctx, a) {
        const from = pieceOf(ctx, a.sw).loc;
        ctx.emit('piece.moved', { id: a.sw, loc: { kind: 'held', by: a.to } });
        if (ctx.state.phase === 'RPh' && from.kind === 'held') {
          ctx.proc<RphActedFn>(RP.acted)(ctx, from.by, 'transfer');
          ctx.proc<RphActedFn>(RP.acted)(ctx, a.to, 'transfer');
        }
        ctx.popDecision();
        if (ctx.state.phase === 'RPh') askPhaseOwner(ctx, a.side, { side: a.side });
        else askPhaseOwner(ctx, ctx.state.attacker);
      },
    });
  },
};

/** One rally attempt (SK1 3.1): the unit rallies on a final DR ≤ its broken side morale; an original 12 Casualty Reduces it. */
export function attemptRally(ctx: Ctx, unit: PieceId, leader: PieceId | null, self: boolean, firstSelfRally: boolean) {
  const p = pieceOf(ctx, unit);
  const d = mmc(ctx, p) ?? smc(ctx, p)!;
  const morale = ctx.query('unit.morale', { unit }, d.brokenMorale);
  const drmRes = ctx.explain('rally.drm', { unit, leader, self }, 0);
  const drm = drmRes.value;
  const roll = ctx.roll(`Rally ${unit}`);
  const final = roll.total + drm;
  setTags(ctx, unit, { [T.rallyTried]: true, [T.rphAction]: true });
  if (leader && !self) ctx.proc<RphActedFn>(RP.acted)(ctx, leader, 'rally');
  const outcome: RallyOutcome = roll.total === 12 ? 'reduced' : final <= morale ? 'rallied' : 'failed';
  ctx.emit('sk1.check', {
    unit,
    kind: 'rally',
    dr: roll.total,
    final,
    target: morale,
    outcome,
    reason: self ? 'self-rally' : `rally by ${leader}`,
    drm,
    explain: drmNotes(drmRes),
    leader: self ? null : leader,
  });
  if (roll.total === 12) {
    ctx.proc<CasualtyFn>(MP.casualtyReduce)(ctx, unit, 'original 12 on rally');
    // A leader killed this way causes a LLMC at once (ASLRB A10.2: eliminated "by ... any other cause").
    ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
    return;
  }
  // The rally takes effect first, so the unit is shown rallied (its DM gone) before the leader it creates appears.
  if (final <= morale) setTags(ctx, unit, { [T.broken]: null, [T.dm]: null });
  else ctx.proc<RallyFailedFn>(RP.rallyFailed)(ctx, unit, leader);
  // Field promotion: an MMC rolling an original 2 on the first self-rally attempt of the RPh (see firstSelfRallyOfSide).
  // The new leader stands on the unit that created him (SK1 3.8 stacking), not on whichever MMC sorts first.
  if (roll.total === 2 && self && firstSelfRally && mmc(ctx, p) && ctx.state.pieces[unit]?.loc.kind === 'hex') {
    const created = ctx.proc<FieldPromotionFn>(RP.fieldPromotion)(ctx, unit, mmc(ctx, p)!.morale, { broken: true });
    if (created) setTags(ctx, created, { [T.stackedOn]: unit });
  }
}
