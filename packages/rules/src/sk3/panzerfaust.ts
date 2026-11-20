import type { Action, Ctx, HexId, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { defOf, hexOf, otherSide, personnelAt, statics } from '../common/pieces';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import { firedOwnFpThisPhase, type FireMode } from '../sk1/fire';
import { PHASE_FIRE_MODE, fireTargets, phaseOwner, swUsedThisPhase } from '../sk1/firePhases';
import { P, type CasualtyFn, type FlushFn, type UnitFn } from '../sk1/morale';
import { FIRST_FIRE, finishDefensiveFire, firstFireLocations, firstFireTargets, firstFireView, moveState, movingInfo } from '../sk1/movement';
import { T, gun, isCx, isGoodOrder, isPinned, mmc, pieceOf, setTags, smc } from '../sk1/status';
import { OP, enemyVehicleAt, swDirectorIllegal, type OrdnanceFireFn, type OrdnanceShot } from '../sk2/ordnance';
import { vehicle } from './status';

/*
 * Panzerfausts (SK4 4.4.2; ASLSK chart p.3). From October 1943, in a scenario with an enemy AFV (or by
 * SSR), every Good Order German Infantry unit that can still fire may try a PF in its fire phase (not
 * as Subsequent First Fire or FPF): a PF check dr, +1 vs other than an AFV, +1 CX, +1 HS/crew, +2 SMC,
 * -1 in 1945. ≤ 3 it has one and must fire it; ≥ 4 it has none; an original 6 also pins it (breaks it
 * if pinned already). The PF is then a LATW: its own To Hit Table (10/8/6/4 at 0-3 hexes, range 1
 * until 5/44, 2 to 12/44, 3 from 1945), HEAT To Kill 31, the 16 FP column vs Infantry in a building
 * (one unit only), Backblast, no Residual FP; an original TH DR 12 (≥ 11 Inexperienced) misses and
 * Casualty Reduces the firer. Shots per scenario: the German squads in the OB, x1.5 in 1944, x2 in 1945.
 * The PF counter exists only for its one shot.
 */

export const PF_DEF = 'ge.PF';
const EXT = 'sk3.pf';
const TRIED = 'pfTried';
/** An SSR that gives Panzerfausts where the card has no enemy AFV ("by SSR"). */
export const PANZERFAUST_MODULE = 'panzerfaust';
/** An SSR that takes Panzerfausts away from a side the date and OB would give them to (LMA8 SSR 1). */
export const NO_PANZERFAUST_MODULE = 'no-panzerfaust';

export interface NoPanzerfaustParams {
  /** The side without Panzerfausts; left out, every side. */
  side?: SideId;
  rule?: string;
}

/** Whether a scenario's special rules deny a side its Panzerfausts ("German units have no PF capability"). */
export function pfDeniedBySsr(ssr: { module: string; params?: Record<string, unknown> }[], side: SideId): boolean {
  return ssr.some((s) => s.module === NO_PANZERFAUST_MODULE && (!(s.params as NoPanzerfaustParams | undefined)?.side || (s.params as NoPanzerfaustParams).side === side));
}

/**
 * SSR "German units have no PF capability" (LMA8 SSR 1): the side gets no PF shots whatever the date and OB; the
 * scenario's ruleset leaves the Panzerfaust module out when no side has them (`needsPanzerfaust`). A marker module.
 */
export const noPanzerfaustModule: RuleModule = {
  id: 'ssr.no-panzerfaust',
  summary: 'A side has no Panzerfausts whatever the date and order of battle (SSR).',
  install() {},
};

/** Params of a `panzerfaust` SSR entry; none at all for plain "Panzerfausts by SSR". */
export interface PanzerfaustParams {
  /**
   * The side's PF shots for the scenario, replacing the count from the OB ("The initial number of German
   * Panzerfausts is 5", LMA10 SSR 4; "Total number of Panzerfaust shots taken may not exceed 5").
   */
  shots?: number;
  /** The side the shot count is for; every side when absent. */
  side?: SideId;
}

export interface PfShot {
  /** The German Infantry unit making the PF check. */
  unit: PieceId;
  target: HexId;
  /** VTT at a vehicle, ITT at Infantry in a building or a Gun. */
  targetType: 'VTT' | 'ITT';
  /** The vehicle aimed at, or the unit manning a Gun/SW the firer picks as the one affected. */
  targetUnit?: PieceId;
  /** Fired from inside a building: take the Backblast instead of the +2 To Hit DRM (SK4 4.4.3). */
  backblast?: boolean;
  /** A leader in the hex modifying the To Hit DR (an ordnance SW, ASL A7.531). */
  director?: PieceId;
}
export type PfAction = Action & { pf: PfShot };

const dateOf = (env: QueryEnv): { year: number; month: number } | null => {
  const sc = statics(env).scenario;
  const y = /\b(19\d\d)\b/.exec(sc.date ?? '');
  return y ? { year: Number(y[1]), month: sc.month } : null;
};

/** The German squads in a side's order of battle (SK4 4.4.2's count), reinforcements included. */
const germanSquads = (env: QueryEnv, side: SideId) =>
  statics(env)
    .scenario.forces.filter((f) => f.side === side)
    .flatMap((f) => f.units)
    .reduce((n, u) => {
      const d = statics(env).counters[u.def];
      return n + (d && d.kind === 'squad' && d.nationality === 'ge' ? u.count : 0);
    }, 0);

/** How many PF shots the side may take this scenario, or null when it has no Panzerfausts. */
export function pfCap(env: QueryEnv, side: SideId): number | null {
  const date = dateOf(env);
  if (!date || date.year < 1943 || (date.year === 1943 && date.month < 10)) return null;
  const sc = statics(env).scenario;
  if (pfDeniedBySsr(sc.ssr, side)) return null;
  const enemy = sc.forces.filter((f) => f.side !== side).flatMap((f) => f.units).some((u) => statics(env).counters[u.def]?.kind === 'vehicle');
  if (!enemy && !sc.ssr.some((s) => s.module === PANZERFAUST_MODULE)) return null;
  const squads = germanSquads(env, side);
  if (squads === 0) return null;
  const set = sc.ssr
    .filter((s) => s.module === PANZERFAUST_MODULE)
    .map((s) => s.params as PanzerfaustParams | undefined)
    .find((q) => q?.shots !== undefined && (!q.side || q.side === side));
  if (set) return set.shots!;
  return date.year < 1944 ? squads : date.year === 1944 ? Math.floor(squads * 1.5) : squads * 2;
}

/** PF shots a side has taken. */
export const pfUsed = (env: QueryEnv, side: SideId): number => ((env.state.ext[EXT] as Record<SideId, number> | undefined) ?? {})[side] ?? 0;

/** The PF's range by date (ASLSK chart p.3): 1 hex until 5/44, 2 from 6/44 to 12/44, 3 from 1/45. */
export function pfMaxRange(env: QueryEnv): number {
  const d = dateOf(env);
  if (!d || d.year < 1944 || (d.year === 1944 && d.month <= 5)) return 1;
  return d.year === 1944 ? 2 : 3;
}

/** The PF check drm a unit takes for a target type. */
export function pfCheckDrm(env: QueryEnv, unit: PieceId, vsAfv: boolean): { drm: number; notes: string[] } {
  const p = pieceOf(env, unit);
  const d = defOf(env, p);
  const notes: string[] = [];
  let drm = 0;
  if (!vsAfv) (drm += 1), notes.push('+1 target is not an AFV');
  if (isCx(p)) (drm += 1), notes.push('+1 CX');
  if (d.kind === 'hs' || d.kind === 'crew') (drm += 1), notes.push('+1 half-squad/crew');
  if (smc(env, p)) (drm += 2), notes.push('+2 SMC');
  if ((dateOf(env)?.year ?? 0) >= 1945) (drm -= 1), notes.push('-1 1945');
  return { drm, notes };
}

/**
 * The highest PF check dr that finds a PF with this drm (SK4 4.4.2: a final dr of 1-3), or 0 when none can; an
 * original 6 never does. A leader (+2) needs a 1, so the drm belongs in every place the check is shown.
 */
export const pfCheckNeed = (drm: number): number => Math.max(0, Math.min(5, 3 - drm));

/** The PF check's requirement in words: "dr ≤ 1 (+2 SMC)", or that no dr can succeed. */
export function pfCheckNeedText(drm: number, notes: string[]): string {
  const need = pfCheckNeed(drm);
  const why = drm ? ` (${notes.join(', ')})` : '';
  return need === 0 ? `no dr can succeed${why}` : `dr ≤ ${need}${why}`;
}

declare module '@asl/engine' {
  interface QueryCatalog {
    /**
     * Full ASL: whether `firer`'s Panzerfaust may aim at the Infantry `units` in `target` for a cover the Starter Kit has
     * no counter for: HEAT may fire at Infantry receiving a wall/building/rubble/pillbox TEM (ASLRB C8.31). False in the Starter Kit.
     */
    'pf.infantryCover': { ctx: { firer: PieceId; target: HexId; units: PieceId[] }; value: boolean };
  }
}

const tryKey = (env: QueryEnv) => `${env.state.turn}:${env.state.attacker}:${env.state.phase}`;

/** Why this unit may not try a Panzerfaust now at all, or null (target aside). */
export function pfUnitIllegal(env: QueryEnv, side: SideId, unit: PieceId, mode: FireMode): string | null {
  if (mode !== 'prep' && mode !== 'advancing' && mode !== 'first' && mode !== 'final') return 'A Panzerfaust is not fired as Subsequent First Fire or Final Protective Fire';
  const cap = pfCap(env, side);
  if (cap === null) return 'No Panzerfausts in this scenario';
  if (pfUsed(env, side) >= cap) return `All ${cap} Panzerfaust shots have been taken`;
  const p = env.state.pieces[unit];
  if (!p || p.side !== side || p.loc.kind !== 'hex') return 'No such unit';
  const d = defOf(env, p);
  if (d.nationality !== 'ge' || !(mmc(env, p) || smc(env, p))) return 'Only German Infantry may fire a Panzerfaust';
  if (!isGoodOrder(env, p)) return 'The unit is not in Good Order';
  // "Units which can still fire (e.g., a leader, crew, or half-squad that has not fired or a squad that can still fire
  // a SW at full strength)", and every PF check is a SW use whether or not it yields a shot (SK4 4.4.2, 4.0).
  const used = swUsedThisPhase(env, p);
  if (mmc(env, p)?.kind !== 'squad') {
    if (p.tags[T.fire] || used >= 1 || p.tags[T.firedSw] || firedOwnFpThisPhase(env, p.id)) return 'The unit has already fired';
    return null;
  }
  // A squad that fired its own FP in this phase still fires one SW at full strength (SK4 4.0): its marker from this
  // phase's fire does not bar the PF. Any other marker (Prep Fire in the DFPh's eyes, First Fire in the DFPh) does.
  const marker = p.tags[T.fire];
  const thisPhase = (mode === 'prep' && marker === 'prep') || (mode === 'advancing' && marker === 'adv') || (mode === 'first' && marker === 'first');
  if (marker && !thisPhase) return 'The unit has already fired';
  if (used >= 2) return 'A squad may use at most two SW per phase';
  // A second PF is the squad's second SW use, which costs its own FP: not once that FP has fired (SK4 4.4.2).
  if (used >= 1 && (firedOwnFpThisPhase(env, p.id) || p.tags[T.ownFpForfeit])) return 'A squad that fired its own FP may use only one SW';
  return null;
}

/** Why this unit may not try a Panzerfaust at the target now, or null. `mode` is the fire it would be. */
export function pfIllegal(env: QueryEnv, side: SideId, pf: PfShot, mode: FireMode, moving?: PieceId[]): string | null {
  const unitWhy = pfUnitIllegal(env, side, pf.unit, mode);
  if (unitWhy) return unitWhy;
  const p = pieceOf(env, pf.unit);
  const map = statics(env).map;
  const from = hexOf(env.state, p)!;
  if (!map.hex(pf.target)) return 'Unknown target hex';
  const range = map.distance(from, pf.target);
  const max = pfMaxRange(env);
  if (range > max) return `A Panzerfaust reaches ${max} hex${max > 1 ? 'es' : ''} at this date`;
  if (moving && mode === 'first' && !moving.some((u) => hexOf(env.state, pieceOf(env, u)) === pf.target)) return 'Defensive First Fire must target the moving stack';
  // A leader in the hex may modify the PF's To Hit DR like any ordnance SW's (ASL A7.531); never its PF check.
  if (pf.director !== undefined) {
    const why = swDirectorIllegal(env, pf.director, side, from, pf.unit);
    if (why) return why;
  }
  if (pf.targetType === 'VTT') {
    const v = pf.targetUnit ? env.state.pieces[pf.targetUnit] : enemyVehicleAt(env, pf.target, side);
    if (!v || v.side === side || !vehicle(env, v) || hexOf(env.state, v) !== pf.target || v.tags['wreck']) return 'No enemy vehicle there to aim at';
    if (!env.query('piece.visibleTo', { piece: v.id, viewer: side }, true)) return 'No target there';
    return null;
  }
  if (range === 0) return 'Cannot fire into own hex';
  // Infantry in a building must be Known (SK4 8.3: a concealed stack is no Infantry Target Type target).
  const enemy = personnelAt(env, pf.target, otherSide(env.state, side)).filter((u) => env.query('piece.knownTo', { piece: u.id, viewer: side }, true));
  const gunThere = Object.values(env.state.pieces).some((g) => g.side !== side && gun(env, g) && hexOf(env.state, g) === pf.target);
  if (!gunThere && !(enemy.length && (map.hex(pf.target)?.buildingId || env.query('pf.infantryCover', { firer: pf.unit, target: pf.target, units: enemy.map((u) => u.id) }, false)))) return 'A Panzerfaust fires only at a vehicle, a Gun, or Infantry in a building';
  return null;
}

/** PF tries the AI/tests can make: each German Infantry unit at each enemy vehicle in reach (and Infantry in buildings, Guns). */
export function simplePfShots(env: QueryEnv, side: SideId, mode: FireMode, targets: HexId[], moving?: PieceId[]): PfShot[] {
  if (pfCap(env, side) === null) return [];
  const out: PfShot[] = [];
  const units = Object.values(env.state.pieces)
    .filter((p) => p.side === side && p.loc.kind === 'hex' && defOf(env, p).nationality === 'ge' && (mmc(env, p) || smc(env, p)))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const u of units)
    for (const target of targets)
      for (const targetType of ['VTT', 'ITT'] as const) {
        const pf: PfShot = { unit: u.id, target, targetType };
        if (!pfIllegal(env, side, pf, mode, moving)) out.push(pf);
      }
  return out;
}

/**
 * The PF check is the use of a SW whatever its result (SK4 4.4.2: "Even if a PF check fails to result in a shot, the
 * PF check constitutes the use of a SW"). The PF counter is gone after it, so the use is counted on the unit as a
 * destroyed SW's is: the unit has fired a SW, and a HS, crew or SMC has spent its one weapon use and its own FP; a
 * squad's second use forfeits its own FP (SK4 4.0; ASLRB A7.35, A7.351). A shot fired has already marked the unit
 * (`markFirers`), so then only the count is added.
 */
function recordPfUse(ctx: Ctx, unit: PieceId, mode: FireMode, fired: boolean) {
  const p = ctx.state.pieces[unit];
  if (!p || p.loc.kind !== 'hex') return;
  const count = ((p.tags[T.swDestroyed] as number | undefined) ?? 0) + 1;
  if (fired) {
    setTags(ctx, unit, { [T.swDestroyed]: count });
    return;
  }
  const used = swUsedThisPhase(ctx, p) + 1;
  const kind = mmc(ctx, p)?.kind;
  const marker = mode === 'prep' ? 'prep' : mode === 'advancing' ? 'adv' : mode === 'first' ? 'first' : 'final';
  setTags(ctx, unit, {
    [T.firedSw]: true,
    ...(p.tags[T.firedSwAs] === undefined ? { [T.firedSwAs]: marker } : {}),
    [T.swDestroyed]: count,
    ...(kind === 'hs' || kind === 'crew' || (kind === 'squad' && used >= 2) ? { [T.ownFpForfeit]: true } : {}),
  });
}

/** Make the PF check and, if the unit has one, fire it. Whether a PF was fired. */
function resolvePf(ctx: Ctx, pf: PfShot, mode: FireMode, opts: { moving?: PieceId[]; movingInfo?: ReturnType<typeof movingInfo> } = {}): boolean {
  const p = pieceOf(ctx, pf.unit);
  const vsAfv = pf.targetType === 'VTT';
  const { drm, notes } = pfCheckDrm(ctx, p.id, vsAfv);
  setTags(ctx, p.id, { [TRIED]: tryKey(ctx) });
  const dr = ctx.roll(`PF check by ${p.id}: needs ${pfCheckNeedText(drm, notes)}`, 1).total;
  const final = dr + drm;
  if (dr === 6) {
    const broken = isPinned(p);
    ctx.emit('sk3.pf.check', { unit: p.id, dr, drm, final, notes, result: broken ? 'broken' : 'pinned' });
    if (broken) ctx.proc<UnitFn>(P.breakUnit)(ctx, p.id, 'Panzerfaust check');
    else setTags(ctx, p.id, { [T.pinned]: true });
    recordPfUse(ctx, p.id, mode, false);
    return false;
  }
  if (final >= 4) {
    ctx.emit('sk3.pf.check', { unit: p.id, dr, drm, final, notes, result: 'none' });
    recordPfUse(ctx, p.id, mode, false);
    return false;
  }
  ctx.emit('sk3.pf.check', { unit: p.id, dr, drm, final, notes, result: 'pf' });
  ctx.emit('sk3.pf.used', { side: p.side, used: pfUsed(ctx, p.side) + 1 });
  const id = `${p.id}.pf${pfUsed(ctx, p.side)}`;
  ctx.emit('piece.created', { piece: { id, defId: PF_DEF, side: p.side, loc: { kind: 'held', by: p.id }, tags: {} } });
  const shot: OrdnanceShot = {
    weapon: id,
    target: pf.target,
    targetType: pf.targetType,
    ...(pf.targetUnit ? { targetUnit: pf.targetUnit } : {}),
    ...(pf.backblast !== undefined ? { backblast: pf.backblast } : {}),
    ...(pf.director !== undefined ? { director: pf.director } : {}),
  };
  const out = ctx.proc<OrdnanceFireFn>(OP.fire)(ctx, shot, mode, opts);
  // An original 12 (11 or 12 for Inexperienced Infantry) misses and Casualty Reduces the firer.
  const original = out.dr[0] + out.dr[1];
  const limit = ctx.query('unit.inexperienced', { unit: p.id }, false) ? 11 : 12;
  if (original >= limit && ctx.state.pieces[p.id]?.loc.kind === 'hex') {
    ctx.proc<CasualtyFn>(P.casualtyReduce)(ctx, p.id, `Panzerfaust TH DR ${original}`);
    ctx.proc<FlushFn>(P.flushLeaderLoss)(ctx);
  }
  if (ctx.state.pieces[id] && ctx.state.pieces[id].loc.kind !== 'eliminated') ctx.emit('piece.eliminated', { id, reason: 'Panzerfaust fired' });
  recordPfUse(ctx, p.id, mode, true);
  return true;
}

export const panzerfaustModule: RuleModule = {
  id: 'sk3.panzerfaust',
  ref: 'SK4 4.4.2',
  summary: 'Panzerfausts: the PF check, a one-shot LATW (TK 31, 16 FP vs Infantry in a building), shots limited per scenario.',
  requires: ['sk2.ordnance', 'sk3.vehicles'],
  install(r) {
    r.event<{ side: SideId; used: number }>({
      type: 'sk3.pf.used',
      apply(d, p) {
        d.ext[EXT] = { ...((d.ext[EXT] as Record<SideId, number> | undefined) ?? {}), [p.side]: p.used };
      },
    });
    r.event<{ unit: PieceId; dr: number; drm: number; final: number; notes: string[]; result: 'pf' | 'none' | 'pinned' | 'broken' }>({ type: 'sk3.pf.check', apply() {} });
    // The PF counter is gone after its one shot: it never malfunctions.
    r.contribute({
      id: 'sk3.pf.breakdown',
      query: 'ordnance.breakdown',
      layer: 900,
      apply: (v, sc) => (sc.def.type === 'PF' ? 13 : v),
    });

    r.action<PfAction>({
      type: 'fire.pf',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const mode = PHASE_FIRE_MODE[env.state.phase];
        if (!mode) return [];
        const side = phaseOwner(env);
        return simplePfShots(env, side, mode, fireTargets(env, side)).map((pf) => ({ type: 'fire.pf', pf }));
      },
      validate(env, a) {
        const mode = PHASE_FIRE_MODE[env.state.phase];
        if (!mode) return 'No fire attacks in this phase';
        if (a.side !== phaseOwner(env)) return 'Not your fire phase';
        return pfIllegal(env, a.side, a.pf, mode);
      },
      resolve(ctx, a) {
        resolvePf(ctx, a.pf, PHASE_FIRE_MODE[ctx.state.phase]!);
        if (!ctx.state.result) {
          ctx.popDecision();
          askPhaseOwner(ctx, phaseOwner(ctx));
        }
      },
    });
    r.action<PfAction>({
      type: 'defFire.pf',
      decisionKinds: [FIRST_FIRE],
      legal(env) {
        const ms = moveState(env);
        if (!ms || !ms.hex) return [];
        const side = otherSide(env.state, env.state.attacker);
        // The moving stack, and (full ASL) units it left in Bypass of another hex (ASLRB A4.32, A4.33).
        return firstFireLocations(env, ms).flatMap((target) => {
          const view = firstFireView(env, ms, target)!;
          return simplePfShots(env, side, 'first', [target], firstFireTargets(env, view))
            .filter((pf) => (view.firedHere[pf.unit] ?? 0) < view.mfHere)
            .map((pf) => ({ type: 'defFire.pf' as const, pf }));
        });
      },
      validate(env, a) {
        const ms = moveState(env);
        if (!ms || !ms.hex) return 'Nothing is moving';
        const view = firstFireView(env, ms, a.pf.target);
        if (!view) return 'Defensive First Fire must target the moving stack';
        const why = pfIllegal(env, a.side, a.pf, 'first', firstFireTargets(env, view));
        if (why) return why;
        if ((view.firedHere[a.pf.unit] ?? 0) >= view.mfHere) return `${a.pf.unit} cannot fire again at this location`;
        return null;
      },
      resolve(ctx, a) {
        const ms = moveState(ctx)!;
        const view = firstFireView(ctx, ms, a.pf.target) ?? ms;
        const targets = firstFireTargets(ctx, view);
        const fired = resolvePf(ctx, a.pf, 'first', { moving: targets, movingInfo: movingInfo(ctx, view) });
        // The PF check is a SW use even when it yields no shot (SK4 4.4.2): the unit has fired at this location. A
        // leader directs only a shot.
        finishDefensiveFire(ctx, [a.pf.unit, ...(fired && a.pf.director !== undefined ? [a.pf.director] : [])], view === ms ? undefined : a.pf.target);
      },
    });
  },
};
