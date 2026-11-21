import type { Action, Ctx, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { askPhaseOwner, PHASE_DECISION } from '../common/turn';
import { byId, defOf, isPersonnelDef, isVehicleDef, statics } from '../common/pieces';
import { sideToward } from '../common/hexCorners';
import { hexOfLoc, isGroundLoc, locOf, type LocId } from '../common/location';
import type { IftResult } from '../common/statics';
import { AP, type AdvanceAction, type AdvanceEnterFn } from '../sk1/advance';
import { FP, type ApplyResultFn, type FireAttackCtx } from '../sk1/fire';
import { fortifiedState, isFortified } from '../sk1/fortified';
import { P as MP, type FlushFn } from '../sk1/morale';
import { MOVE_ENTER, MOVE_ENTERED, MOVE_EXIT, inPlaceIllegal, moveInternals, type MoveExitFn, type MoveEnterFn, type MoveEnteredFn, type MoveState } from '../sk1/movement';
import { moveState } from '../sk1/moveState';
import { ROUT_END_HERE, ROUT_ENTER, ROUT_ENTERED, activeRout, dropRoutEscort, type RoutEndHereFn, type RoutEnterFn, type RoutEnteredFn } from '../sk1/rout';
import { isBroken, isPinned, pieceOf, setTags, T } from '../sk1/status';
import { connectedTrenches } from './entrenchments';
import { fortifiedEntryBarred } from './fortified';
import { minefieldAt, removeFortification, shownCounter, type FortRecord, type MineFactors } from './fortifications';
import { isRubbled, trailBreaksAt } from './rubble';
import { applyVehicleEffect, crewTakesResult } from '../sk3/vehicleStatus';
import { isCe, isWreck, vehicle } from '../sk3/status';
import { clearanceTasks, defaultTbHexsides, tbSidesIllegal, type ClearanceTask } from './clearance';
import { PARTIAL_EXT, mineClearable, minefieldKnownTo, mineTbThrough, onBoard, partialTbs, partialTbsAt, setPartialTbs, sideOf as sideOfHex, type PartialTb } from './mineTb';
import { mmc, smc, fireMarker } from '../sk1/status';
import type { MineEntry } from '../sk1/movement';

/*
 * Minefields in play (ASLRB B28; full ASL only: neither Starter Kit rulebook has minefields).
 *
 * - The attack (B28.41, B28.411, B28.412, B28.3): whenever a unit enters or leaves a minefield hex the owner's minefield
 *   attacks it on the IFT, one DR for the stack entering or leaving together (Q&A to B28.41), at the A-P strength (6, 8 or
 *   12), with no DRM at all (no TEM, FFMO, FFNAM, Hindrance or SMOKE, B28.3, A4.6, A24.2), never leaving Residual FP
 *   (A8.22); a concealed unit is attacked at full strength (B28.411). The strength is never reduced by its own attacks
 *   (B28.1). A-T mines never attack Infantry (B28.41, B28.5). Only moving, routing and advancing units are attacked, never
 *   the others in the Location (B28.411); changing Location within the hex is neither entry nor exit (Q&A to B28.41).
 * - Secrets (B28.1, B28.41, B28.48): the attack puts the minefield's presence on the board for everyone (a Known
 *   Minefield counter, strength down); its strength is shown only when the IFT result is not "no effect", to verify it.
 *   Legality never reads a minefield the mover's side cannot see: a step into a hidden minefield costs what the hex costs.
 * - Exit then entry (B28.412 EX): the exit attack is resolved in the hex left; a unit broken or pinned by it does not
 *   leave, its MF for the step being spent there (as A12.15 has for a unit returned), and the rest go on and take the entry
 *   attack in the hex entered. A refusal that stops the step outright (a Fortified Building Location, B23.922) comes before
 *   the exit attack: such a unit neither leaves nor enters (Q&A to B23.922 & B28.41). A stack turned back by hidden units
 *   re-enters the minefield Location it tried to leave and is attacked as it re-enters (A12.15).
 * - Exemptions (B28.44, A4.32): no attack through a building hexside (both hexes of the same building) unless the unit
 *   uses Bypass; none on Trench movement (B27.54).
 * - Rout (B28.413, A10.51): the exit attack before the step, the entry attack before Interdiction; a router need not
 *   move through a known minefield (`rout.avoid`); a broken squad Reduced to a HS by a minefield attack may end its rout
 *   there at its option (`rout.endHere`).
 * - A Dummy (B28.47) is found and removed when any ground unit enters its Location.
 *
 * The Trail Break, Clearance, vehicle and Booby Trap rules are in their own sections below.
 */

export const MINES_ROUT_EXT = 'asl.mines.routOption';
/** The minefield attacks of the moving stack's latest step, for the DEFENDER's First Fire question: gone with the MPh. */
export const MINES_LAST_EXT = 'asl.mines.last';
export interface MineLast {
  hex: HexId;
  way: MineWay;
  units: PieceId[];
  result: IftResult;
  /** The stack's `hexesEntered` the attacks belong to. */
  step: number;
}
const lastMines = (env: QueryEnv) => env.state.ext[MINES_LAST_EXT] as MineLast[] | undefined;
/** The minefield attacks the moving stack survived on its latest step (B28.41), while that step is its latest. */
export function lastMineAttacks(env: QueryEnv): MineLast[] {
  const ms = moveState(env);
  return ms ? (lastMines(env) ?? []).filter((x) => x.step === ms.hexesEntered) : [];
}

export type MineWay = 'enter' | 'exit';
export type MineBy = 'move' | 'advance' | 'rout';
export interface MineAttackEvent {
  counter: string;
  hex: HexId;
  way: MineWay;
  by: MineBy;
  units: PieceId[];
  dr: [number, number];
  result: IftResult;
  /** The A-P factors, when the result has to be verified (B28.41): not on a "no effect". */
  factors?: number;
}
export type RoutEndHereAction = Action & { type: 'rout.endHere'; unit: PieceId };

const isInfantry = (env: QueryEnv, p: Piece) => isPersonnelDef(defOf(env, p));
export { minefieldKnownTo, onBoard };

/** A minefield counter on the board that `side` must take for A-P mines: Known, or found (B28.413, A10.51). Its own Dummies and open A-T mines are harmless to it. */
export function knownMinefieldThreat(env: QueryEnv, hex: HexId, side: SideId): boolean {
  const c = minefieldAt(env, hex);
  if (!c || !onBoard(c)) return false;
  const shown = shownCounter(c, side)?.mines ?? {};
  if (shown.found) return false;
  if (c.side === side) return !!c.mines?.ap;
  return !(shown.strengthRevealed && !shown.ap);
}

/** Hexes of one building on both sides of the hexside crossed, neither rubbled: a building hexside (B28.44). */
export function buildingHexside(env: QueryEnv, a: HexId | null | undefined, b: HexId): boolean {
  if (!a) return false;
  const map = statics(env).map;
  const ba = map.hex(a)?.buildingId;
  return !!ba && ba === map.hex(b)?.buildingId && !isRubbled(env, a) && !isRubbled(env, b);
}

// ---------------------------------------------------------------- the attack

/** Whether `units` are susceptible to the minefield (B28.1): Infantry to A-P factors; vehicles to A-P or A-T factors. */
function apOf(c: FortRecord | null): number {
  return c && c.kind === 'mines' && !c.mines?.dummy ? (c.mines?.ap ?? 0) : 0;
}

/**
 * Put a minefield's presence (and, `strength`, its factors) on the board (B28.1, B28.41, B28.45, B28.48): a hidden one
 * becomes a Known Minefield counter strength down; a Known one is flipped when its strength is shown.
 */
export function revealMines(ctx: Ctx, c: FortRecord, strength: boolean) {
  const m = c.mines ?? {};
  const presence = c.hidden && !c.revealed;
  const flip = strength && !m.strengthRevealed;
  if (!presence && !flip) return;
  const counter: FortRecord = { ...c, ...(c.hidden ? { revealed: true as const } : {}), mines: { ...m, ...(flip ? { strengthRevealed: true as const } : {}) } };
  ctx.emit('asl.fort.revealed', { counter, reason: flip ? 'strength' : 'mineAttack' });
}

/**
 * One A-P minefield attack (B28.41): one DR against every unit of `units` (the stack entering or leaving together), no DRM
 * (B28.3), the result applied through the IFT. Returns the result, or null when no attack is made (no A-P factors, no
 * Infantry). Vehicles are attacked by `mineVehicle`.
 */
export function mineAttack(ctx: Ctx, opts: { hex: HexId; units: PieceId[]; way: MineWay; by: MineBy }): IftResult | null {
  const c = minefieldAt(ctx, opts.hex);
  const ap = apOf(c);
  const units = opts.units.filter((u) => ctx.state.pieces[u]?.loc.kind === 'hex' && isInfantry(ctx, ctx.state.pieces[u]!)).sort();
  if (!c || !ap || !units.length) return null;
  const roll = ctx.roll(`Minefield attack in ${opts.hex} (ASLRB B28.41)`);
  const dr = roll.dice as [number, number];
  const result = statics(ctx).tables.ift(ap, roll.total);
  const shown = result.kind !== 'none';
  revealMines(ctx, c, shown);
  ctx.emit('asl.mines.attack', { counter: c.id, hex: opts.hex, way: opts.way, by: opts.by, units, dr, result, ...(shown ? { factors: ap } : {}) } satisfies MineAttackEvent);
  // For the DEFENDER's First Fire question and the stack card (the moving stack survived it: B28.41 announced it).
  const ms = opts.by === 'move' ? moveState(ctx) : undefined;
  if (ms) ctx.emit('asl.mines.last', { last: [...(lastMines(ctx) ?? []).filter((x) => x.step === ms.hexesEntered + (opts.way === 'exit' ? 1 : 0)), { hex: opts.hex, way: opts.way, units, result, step: ms.hexesEntered + (opts.way === 'exit' ? 1 : 0) }] });
  const attack: FireAttackCtx = { mode: 'first', side: c.side, target: opts.hex, parts: [], targets: units, hindrance: 0, mine: true };
  ctx.proc<ApplyResultFn>(FP.applyResult)(ctx, attack, ap, roll.total, {});
  ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
  return result;
}

/** A Dummy in the Location entered is found by any ground unit and removed (B28.47). */
function findDummy(ctx: Ctx, hex: HexId) {
  const c = minefieldAt(ctx, hex);
  if (!c?.mines?.dummy || c.mines.found) return;
  if (c.belt) {
    // An unmined hex of a belt is marked with a Dummy counter once found (B28.47 EXC, B28.46).
    ctx.emit('asl.fort.revealed', { counter: { ...c, mines: { ...c.mines, found: true } }, reason: 'dummyFound' });
    return;
  }
  removeFortification(ctx, c.id, 'a Dummy minefield found (ASLRB B28.47)');
}

/** Units broken, pinned or gone: they do not leave the hex (B28.412 EX). */
const stuck = (ctx: Ctx, u: PieceId) => {
  const p = ctx.state.pieces[u];
  return !p || p.loc.kind !== 'hex' || isBroken(p) || isPinned(p);
};

/**
 * The exit attack on Infantry leaving the minefield of their hex for `to` (B28.41, B28.412 EX): returns the stack going on,
 * or null when every unit stays (the step's MF spent in the hex left, a First Fire expenditure there).
 */
function infantryExit(ctx: Ctx, ms: MoveState, to: LocId, cost: number, extra?: Partial<MoveState>): MoveState | null {
  const from = ms.hex!;
  const units = ms.units.filter((u) => !mineExitExempt(ctx, ms, to, u, extra));
  const res = units.length ? mineAttack(ctx, { hex: from, units, way: 'exit', by: 'move' }) : null;
  let now = moveState(ctx) ?? ms;
  if (!res) return now;
  const left = ms.units.filter((u) => stuck(ctx, u));
  if (left.length === ms.units.length) {
    moveInternals.spendInPlace(ctx, now, cost, { halted: true });
    moveInternals.afterMfExpenditure(ctx);
    const after = moveState(ctx);
    if (after && ctx.state.decisions[ctx.state.decisions.length - 1]?.kind !== 'firstFire') {
      moveInternals.finishStack(ctx);
      moveInternals.reAskMover(ctx);
    }
    return null;
  }
  if (left.length) {
    // Those that stay are finished there; the rest go on (a leader stopped takes his MF bonus with him). Once the rest have
    // moved on they are no longer targets of the DEFENDER's First Fire in that hex: the engine keeps broken or pinned movers
    // as targets only until another unit moves (SK1 3.3.1); keeping them so for the rest of the phase is the full A8.14
    // Follow-up, not yet built.
    moveInternals.pruneMovers(ctx);
    now = moveState(ctx) ?? now;
  }
  return now;
}

// ---------------------------------------------------------------- the module

export const aslMinesModule: RuleModule = {
  id: 'asl.mines',
  ref: 'ASLRB B28, B24.74, B13.421, A10.51, A12.15',
  summary: 'Minefields in play: A-P attacks on entry and exit in the MPh, APh and RtPh, the reveal, Dummies, rout round known minefields.',
  requires: ['asl.fortifications', 'asl.fortified', 'asl.entrenchments', 'asl.wire', 'asl.rubble', 'sk1.movement', 'sk1.rout', 'sk1.advance', 'sk1.fire'],
  install(r) {
    r.event<MineAttackEvent>({ type: 'asl.mines.attack', apply() {} });
    r.event<MineVehicleEvent>({ type: 'asl.mines.vehicle', apply() {} });
    r.event<{ last: MineLast[] | null }>({
      type: 'asl.mines.last',
      apply(d, p) {
        if (p.last?.length) d.ext[MINES_LAST_EXT] = p.last;
        else delete d.ext[MINES_LAST_EXT];
      },
    });
    r.on({
      id: 'asl.mines.lastGone',
      event: 'turn.phaseEnded',
      handler(ctx) {
        if (ctx.state.ext[MINES_LAST_EXT]) ctx.emit('asl.mines.last', { last: null });
      },
    });
    r.event<{ hex: HexId; tbs: PartialTb[] }>({
      type: 'asl.mines.partial',
      apply(d, p) {
        const all = { ...((d.ext[PARTIAL_EXT] as Record<HexId, PartialTb[]> | undefined) ?? {}) };
        if (p.tbs.length) all[p.hex] = p.tbs;
        else delete all[p.hex];
        if (Object.keys(all).length) d.ext[PARTIAL_EXT] = all;
        else delete d.ext[PARTIAL_EXT];
      },
    });
    r.event<{ hex: HexId; units: PieceId[]; side: number; hexsides: [number, number] }>({ type: 'asl.mines.clearEntry', apply() {} });
    installTrailBreaks(r);
    installAtRemoval(r);
    installTbDirections(r);
    r.event<{ unit: PieceId | null }>({
      type: 'asl.mines.routOption',
      apply(d, p) {
        if (p.unit) d.ext[MINES_ROUT_EXT] = p.unit;
        else delete d.ext[MINES_ROUT_EXT];
      },
    });

    // ---------------------------------------------------------------- MPh: the exit attack, then the step
    // The stack turned back by hidden units in the hex it tried to enter re-enters the minefield it left (A12.15).
    let reentry: { hex: HexId; exempt: boolean } | null = null;
    r.procedure<MoveEnterFn>(MOVE_ENTER, (next) => (ctx, ms, to, cost, woods, extra) => {
      const from = ms.hex;
      const toHex = hexOfLoc(to);
      if (!from || toHex === from || ms.level || ms.sub || !minefieldAt(ctx, from)) return next?.(ctx, ms, to, cost, woods, extra);
      if (ms.vehicle) return vehicleExit(ctx, ms, to, cost, () => next?.(ctx, moveState(ctx) ?? ms, to, cost, woods, extra));
      // A refusal that stops the step outright comes first: nothing is attacked (Q&A to B23.922 & B28.41).
      if (!extra?.bypass && fortifiedState(ctx) && isFortified(ctx, to) && fortifiedEntryBarred(ctx, to, ctx.state.attacker, [from], false) !== null) return next?.(ctx, ms, to, cost, woods, extra);
      const exempt = ms.units.every((u) => mineExitExempt(ctx, ms, to, u, extra));
      const now = infantryExit(ctx, ms, to, cost, extra);
      if (!now) return;
      reentry = { hex: from, exempt };
      try {
        next?.(ctx, now, to, cost, woods, extra);
      } finally {
        reentry = null;
      }
    });
    // Off the map from a minefield hex: the unit leaves the minefield hex (B28.41 "enters/leaves"), so the exit attack comes
    // first; units broken, pinned or (vehicles) immobilized by it stay on the map.
    r.procedure<MoveExitFn>(MOVE_EXIT, (next) => (ctx, ms, to, cost) => {
      const from = ms.hex;
      if (!from || !minefieldAt(ctx, from)) return next?.(ctx, ms, to, cost);
      if (ms.vehicle) return vehicleExit(ctx, ms, to, cost, () => next?.(ctx, moveState(ctx) ?? ms, to, cost));
      const now = infantryExit(ctx, ms, to, cost);
      if (now) next?.(ctx, now, to, cost);
    });
    r.on<{ units: PieceId[]; hex: HexId }>({
      id: 'asl.mines.hipBounce',
      event: 'sk2.hip.bounce',
      handler(ctx, ev) {
        const back = reentry;
        if (!back || back.exempt) return;
        reentry = null;
        mineAttack(ctx, { hex: back.hex, units: ev.payload.units, way: 'enter', by: 'move' });
      },
    });
    // ---------------------------------------------------------------- MPh: the entry attack, before Residual FP and First Fire (A8.22)
    r.procedure<MoveEnteredFn>(MOVE_ENTERED, (next) => (ctx, ms) => {
      const hex = ms.hex;
      if (hex && !ms.level && !ms.sub && !ms.vehicle) {
        findDummy(ctx, hex);
        if (ms.mineEntry === 'clear') clearingEntry(ctx, moveState(ctx) ?? ms);
        else if (minefieldAt(ctx, hex) && !mineEntryExempt(ctx, ms)) mineAttack(ctx, { hex, units: ms.units, way: 'enter', by: 'move' });
      }
      next?.(ctx, moveState(ctx) ?? ms);
      // A vehicle is attacked after the hex's own entry costs and checks (B28.42, B28.51), before any Defensive First Fire.
      if (hex && ms.vehicle && minefieldAt(ctx, hex)) vehicleEntry(ctx, moveState(ctx) ?? ms);
      else if (hex && ms.vehicle) findDummy(ctx, hex);
    });

    // ---------------------------------------------------------------- APh (B28.411): one Location, so exit then entry
    r.procedure<AdvanceEnterFn>(AP.enter, (next) => (ctx, a: AdvanceAction) => {
      const toHex = hexOfLoc(a.to);
      const map = statics(ctx).map;
      if (!map.hex(toHex) || !isGroundLoc(a.to)) return next?.(ctx, a);
      const fromOf = (u: PieceId) => {
        const p = ctx.state.pieces[u];
        return p?.loc.kind === 'hex' ? p.loc.hex : null;
      };
      const refused = fortifiedState(ctx) && isFortified(ctx, a.to) && fortifiedEntryBarred(ctx, a.to, a.side, [...new Set(a.units.map(fromOf).filter((h): h is HexId => !!h))], false) !== null;
      let units = [...a.units];
      const exempt = new Set(units.filter((u) => advanceExempt(ctx, u, fromOf(u), a)));
      if (!refused) {
        const byHex = new Map<HexId, PieceId[]>();
        for (const u of units) {
          const h = fromOf(u);
          if (h && h !== toHex && minefieldAt(ctx, h) && !exempt.has(u)) byHex.set(h, [...(byHex.get(h) ?? []), u]);
        }
        for (const [h, us] of [...byHex].sort()) {
          if (!mineAttack(ctx, { hex: h, units: us, way: 'exit', by: 'advance' })) continue;
          const left = us.filter((u) => stuck(ctx, u));
          // Broken or pinned by the exit attack: the advance is spent, but the unit stays (B28.412 EX).
          for (const u of left) if (ctx.state.pieces[u]?.loc.kind === 'hex') setTags(ctx, u, { advanced: true });
          units = units.filter((u) => !left.includes(u));
        }
      }
      if (!units.length) {
        ctx.popDecision();
        askPhaseOwner(ctx, ctx.state.attacker);
        return;
      }
      const was = new Map(units.map((u) => [u, fromOf(u)]));
      next?.(ctx, { ...a, units });
      const arrived = units.filter((u) => {
        const p = ctx.state.pieces[u];
        return p?.loc.kind === 'hex' && p.loc.hex === toHex && was.get(u) !== toHex && !exempt.has(u);
      });
      if (units.some((u) => was.get(u) !== toHex)) findDummy(ctx, toHex);
      if (arrived.length && minefieldAt(ctx, toHex)) mineAttack(ctx, { hex: toHex, units: arrived, way: 'enter', by: 'advance' });
    });

    // ---------------------------------------------------------------- RtPh (B28.413)
    const routReduced = (ctx: Ctx, unit: PieceId, before: string) => {
      const p = ctx.state.pieces[unit];
      if (p && p.loc.kind === 'hex' && p.defId !== before) ctx.emit('asl.mines.routOption', { unit });
    };
    r.procedure<RoutEnterFn>(ROUT_ENTER, (next) => (ctx, unit, hex) => {
      const p = pieceOf(ctx, unit);
      const from = p.loc.kind === 'hex' ? p.loc.hex : null;
      if (!from || from === hex || p.loc.kind !== 'hex' || p.loc.level || !minefieldAt(ctx, from) || buildingHexside(ctx, from, hex)) return next?.(ctx, unit, hex) ?? true;
      const act = activeRout(ctx);
      const escort = act?.unit === unit ? act.escort : [];
      const before = p.defId;
      if (mineAttack(ctx, { hex: from, units: [unit, ...escort], way: 'exit', by: 'rout' })) {
        if (ctx.state.pieces[unit]?.loc.kind !== 'hex') return false;
        routReduced(ctx, unit, before);
        // An escorting leader broken, pinned or killed stays (B28.412 EX).
        dropRoutEscort(ctx, escort.filter((l) => stuck(ctx, l)));
      }
      return next?.(ctx, unit, hex) ?? true;
    });
    r.procedure<RoutEnteredFn>(ROUT_ENTERED, (next) => (ctx, units, loc, beneath) => {
      const hex = hexOfLoc(loc);
      if (isGroundLoc(loc)) {
        findDummy(ctx, hex);
        const unit = units[0]!;
        const before = ctx.state.pieces[unit]?.defId ?? '';
        const act = activeRout(ctx);
        const from = act?.unit === unit ? (act.path.length ? hexOfLoc(act.path[act.path.length - 1]!) : act.start) : null;
        if (minefieldAt(ctx, hex) && !buildingHexside(ctx, from, hex)) {
          mineAttack(ctx, { hex, units, way: 'enter', by: 'rout' });
          routReduced(ctx, unit, before);
        }
      }
      if (units.some((u) => ctx.state.pieces[u]?.loc.kind === 'hex')) next?.(ctx, units.filter((u) => ctx.state.pieces[u]?.loc.kind === 'hex'), loc, beneath);
    });
    // The option is the router's for the rest of its rout; it goes with the rout.
    r.on({
      id: 'asl.mines.routOptionGone',
      event: 'sk1.rout.state',
      handler(ctx) {
        const unit = ctx.state.ext[MINES_ROUT_EXT] as PieceId | undefined;
        if (unit && activeRout(ctx)?.unit !== unit) ctx.emit('asl.mines.routOption', { unit: null });
      },
    });
    r.action<RoutEndHereAction>({
      type: 'rout.endHere',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const unit = env.state.ext[MINES_ROUT_EXT] as PieceId | undefined;
        return unit && activeRout(env)?.unit === unit && env.state.phase === 'RtPh' ? [{ type: 'rout.endHere', unit } as RoutEndHereAction] : [];
      },
      validate(env, a) {
        if (env.state.phase !== 'RtPh') return 'Not the Rout Phase';
        if (env.state.ext[MINES_ROUT_EXT] !== a.unit || activeRout(env)?.unit !== a.unit) return 'Only a broken squad Reduced to a HS by a minefield attack may end its rout there (ASLRB B28.413)';
        if (env.state.pieces[a.unit]?.side !== a.side) return 'Not your unit';
        return null;
      },
      resolve(ctx, a) {
        ctx.emit('asl.mines.routEnded', { unit: a.unit });
        ctx.proc<RoutEndHereFn>(ROUT_END_HERE)(ctx, a.unit);
      },
    });
    r.event<{ unit: PieceId }>({ type: 'asl.mines.routEnded', apply() {} });
    // A router need not move through a known A-P minefield (B28.413, A10.51): the shelters round it are legal too.
    r.contribute({
      id: 'asl.mines.routAvoid',
      query: 'rout.avoid',
      ref: 'ASLRB B28.413, A10.51',
      apply(v, { unit }, env) {
        const p = env.state.pieces[unit];
        if (!p) return v;
        const start = p.loc.kind === 'hex' ? p.loc.hex : null;
        const out = new Set(v);
        for (const c of minefieldsOnBoard(env)) if (c.hex !== start && knownMinefieldThreat(env, c.hex, p.side)) out.add(c.hex);
        return [...out].sort();
      },
    });

    void T;
    void byId;
    void isVehicleDef;
  },
};

const minefieldsOnBoard = (env: QueryEnv): FortRecord[] => ((env.state.ext['asl.fortifications'] as { counters: FortRecord[] } | undefined)?.counters ?? []).filter((c) => c.kind === 'mines' && onBoard(c));

/**
 * Whether `unit` of the stack leaves the minefield of its hex into `to` without an attack: across a TB hexside (B28.61);
 * a unit that entered by a partial TB only back across it (B24.74), any other hexside attacked, a building hexside too
 * (Q&A to B24.74 & B28.44); otherwise through a building hexside not in Bypass, or by Trench movement (B28.44).
 */
export function mineExitExempt(env: QueryEnv, ms: Pick<MoveState, 'hex' | 'bypass' | 'ent' | 'mineTbIn'>, to: LocId, unit: PieceId, extra?: Partial<MoveState>): boolean {
  const from = ms.hex!;
  const toHex = hexOfLoc(to);
  const exitTb = mineTbThrough(env, from, toHex);
  // "Via a TB": a unit that came in along one TB leaves free only along that TB (Q&A to B28.41 & B28.61 (c), (d)).
  if (exitTb) return !ms.mineTbIn || (ms.mineTbIn[0] === exitTb[0] && ms.mineTbIn[1] === exitTb[1]);
  const partial = partialTbsAt(env, from).find((p) => p.units?.includes(unit) || p.vehicle === unit);
  if (partial) return sideOfHex(env, from, toHex) === partial.side;
  if (!ms.bypass && !extra?.bypass && buildingHexside(env, from, toHex)) return true;
  if (extra?.ent && ms.ent && connectedTrenches(env, from).includes(toHex)) return true;
  return false;
}

/** Whether the stack just arrived is exempt from the entry attack (B28.44; along a TB or clearing, B28.61, B24.74). */
function mineEntryExempt(env: QueryEnv, ms: MoveState): boolean {
  if (ms.trenchMove || ms.mineEntry) return true;
  if (!ms.bypass && buildingHexside(env, ms.from, ms.hex!)) return true;
  return false;
}

/** Whether one advancing unit leaves and enters without an attack: a building hexside, or between connecting trenches (B28.44, B27.54). */
function advanceExempt(env: QueryEnv, unit: PieceId, from: HexId | null, a: AdvanceAction): boolean {
  if (!from) return false;
  const to = hexOfLoc(a.to);
  if (buildingHexside(env, from, to)) return true;
  const p = env.state.pieces[unit];
  const entrenched = !!p && p.loc.kind === 'hex' && !!p.loc.pos?.ent;
  return !!a.beneath && entrenched && connectedTrenches(env, from).includes(to);
}

export type { MineFactors };
export const sideOf = (env: QueryEnv, hex: HexId, from: HexId) => sideToward(statics(env).map, hex, from);
void locOf;

// ---------------------------------------------------------------- Trail Breaks and the clearing entry (B28.61, B24.74, B13.4212)

/** Why the moving stack may not step into the minefield of `to` along its TB or to clear it, or null. */
export function mineStepIllegal(env: QueryEnv, ms: MoveState, to: LocId, mines: MineEntry | undefined, hexsides?: [number, number]): string | null {
  const toHex = hexOfLoc(to);
  const side = env.state.attacker;
  if (!mines) return hexsides ? 'Hexsides are named only to clear a minefield (ASLRB B24.74)' : null;
  if (!ms.hex || !isGroundLoc(to) || ms.level) return 'Only from an adjacent hex at ground level';
  if (!mineClearable(env, toHex, side)) return `No Known minefield in ${toHex} (ASLRB ${mines === 'tb' ? 'B28.61' : 'B24.74'})`;
  if (mines === 'tb') {
    if (hexsides) return 'A step along a TB names no hexsides';
    const tb = mineTbThrough(env, toHex, ms.hex);
    if (!tb) return `No Trail Break crosses the hexside into ${toHex} (ASLRB B28.61)`;
    return ms.vehicle ? tbVehicleIllegal(env, toHex, tb, ms.units[0]!) : null;
  }
  if (ms.vehicle) return 'Only Infantry clear a minefield (ASLRB B24.74)';
  if (ms.hexesEntered > 0 || ms.mfHere > 0 || ms.units.some((u) => (ms.spent[u] ?? 0) > 0)) return 'Units clearing a minefield spend their entire MF allotment entering it: the stack must not have moved (ASLRB B24.74)';
  for (const u of ms.units) {
    const p = pieceOf(env, u);
    if (!isInfantry(env, p) || isBroken(p) || isPinned(p)) return `${u} must be unpinned Good Order Infantry (ASLRB B24.74)`;
    if (fireMarker(p) || p.tags[T.firedSw]) return `${u} has fired this Player Turn (ASLRB B24.74)`;
    if (p.tags['ti']) return `${u} is already TI`;
  }
  if (!ms.units.some((u) => mmc(env, pieceOf(env, u)))) return 'At least one MMC must take part in a Clearance attempt (ASLRB B24.7)';
  const why = tbSidesIllegal(env, toHex, hexsides ?? defaultTbHexsides(env, toHex, sideOfHex(env, toHex, ms.hex) ?? 0), 'B24.74');
  if (why) return why;
  const entry = sideOfHex(env, toHex, ms.hex);
  if (hexsides && entry !== null && !hexsides.includes(entry)) return 'The TB must include the hexside the partial TB is placed across on entry (ASLRB B24.74)';
  return null;
}

/** The ways into a Known minefield the wheel offers, with each one's reason when it is refused (B28.41, B28.61, B24.74). */
export function mineStepChoices(env: QueryEnv, ms: MoveState, to: LocId): { mines: MineEntry | null; reason: string | null }[] {
  const toHex = hexOfLoc(to);
  if (!ms.hex || !isGroundLoc(to) || !mineClearable(env, toHex, env.state.attacker)) return [];
  return [
    { mines: null, reason: null },
    { mines: 'tb' as const, reason: mineStepIllegal(env, ms, to, 'tb') },
    ...(ms.vehicle ? [] : [{ mines: 'clear' as const, reason: mineStepIllegal(env, ms, to, 'clear') }]),
  ];
}

/** Infantry entering a Known minefield with all their MF to clear it (B24.74): the partial TB, TI and the Task. */
function clearingEntry(ctx: Ctx, ms: MoveState) {
  const hex = ms.hex!;
  const side = sideOfHex(ctx, hex, ms.from) ?? 0;
  const hexsides = ms.mineSides ?? defaultTbHexsides(ctx, hex, side);
  const units = [...ms.units].sort();
  const c = minefieldAt(ctx, hex);
  // A Dummy found on entry (B28.47): the units have spent all their MF and are TI; the Task has nothing to clear and makes no DR.
  if (c) setPartialTbs(ctx, hex, [...partialTbsAt(ctx, hex), { side, units }]);
  for (const u of units) setTags(ctx, u, { ti: true });
  const mmcs = units.filter((u) => mmc(ctx, pieceOf(ctx, u)));
  const director = units.find((u) => !!smc(ctx, pieceOf(ctx, u)) && !isBroken(pieceOf(ctx, u)) && !isPinned(pieceOf(ctx, u)));
  const counter = c?.id ?? `${hex}.dummy`;
  const key = `mines|${counter}|${hex}|${ctx.state.attacker}|${ctx.state.phase}`;
  const old = clearanceTasks(ctx).find((t) => t.key === key);
  const task: ClearanceTask = old
    ? { ...old, units: [...new Set([...old.units, ...mmcs])].sort(), ...((old.director ?? director) ? { director: old.director ?? director } : {}) }
    : { key, kind: 'mines', counter, loc: hex, side: ctx.state.attacker, units: mmcs, ...(director ? { director } : {}), phase: ctx.state.phase, hexsides };
  ctx.emit('asl.clearance.tasks', { tasks: [...clearanceTasks(ctx).filter((t) => t.key !== key), task] });
  ctx.emit('asl.clearance.declared', { task, ...(old ? { joined: true as const } : {}) });
  ctx.emit('asl.mines.clearEntry', { hex, units, side, hexsides });
  const now = moveState(ctx)!;
  ctx.emit('sk1.move.state', { state: { ...now, halted: true, spent: Object.fromEntries(now.units.map((u) => [u, Math.max(now.spent[u] ?? 0, now.allowance[u] ?? 0)])) } });
}

/** Partial TBs whose units are gone from the hex (eliminated or left), or whose minefield is gone, go with them (B24.74). */
function prunePartials(ctx: Ctx) {
  for (const [hex, tbs] of Object.entries(partialTbs(ctx))) {
    if (!minefieldAt(ctx, hex)) {
      setPartialTbs(ctx, hex, []);
      continue;
    }
    const next = tbs
      .map((t) => (t.units ? { ...t, units: t.units.filter((u) => ctx.state.pieces[u]?.loc.kind === 'hex' && (ctx.state.pieces[u]!.loc as { hex: HexId }).hex === hex) } : t))
      .filter((t) => !t.units || t.units.length > 0)
      .filter((t) => !t.vehicle || (ctx.state.pieces[t.vehicle]?.loc.kind === 'hex' && (ctx.state.pieces[t.vehicle]!.loc as { hex: HexId }).hex === hex));
    if (JSON.stringify(next) !== JSON.stringify(tbs)) setPartialTbs(ctx, hex, next);
  }
}

type Builder = Parameters<RuleModule['install']>[0];
function installTrailBreaks(r: Builder) {
  // The wheel's step variants into a Known minefield (B28.61, B24.74): along its TB, and to clear it.
  r.contribute({
    id: 'asl.mines.stepVariants',
    query: 'move.stepVariants',
    ref: 'ASLRB B28.61, B24.74',
    apply(v, { ms, to }, env) {
      if (!ms.hex || !isGroundLoc(to) || !mineClearable(env, hexOfLoc(to), env.state.attacker)) return v;
      const out = [...v];
      if (mineTbThrough(env, hexOfLoc(to), ms.hex)) out.push({ type: 'move.step' as const, to, mines: 'tb' as const });
      if (!ms.vehicle) out.push({ type: 'move.step' as const, to, mines: 'clear' as const, hexsides: defaultTbHexsides(env, hexOfLoc(to), sideOfHex(env, hexOfLoc(to), ms.hex) ?? 0) });
      return out;
    },
  });
  r.contribute({
    id: 'asl.mines.stepIllegal',
    query: 'move.stepIllegal',
    ref: 'ASLRB B28.61, B24.74',
    layer: -10,
    apply: (v, { ms, to, mines, hexsides }, env) => (mines || hexsides ? mineStepIllegal(env, ms, to, mines, hexsides) : v),
  });
  // B28.61: "at twice their normal MF/MP cost"; B24.74: "their entire MF allotment".
  r.contribute({
    id: 'asl.mines.stepCost',
    query: 'move.stepCost',
    ref: 'ASLRB B28.61, B24.74',
    layer: 50,
    label: ({ mines }) => (mines === 'tb' ? 'along the minefield TB: twice the cost (B28.61)' : 'all MF to clear the minefield (B24.74)'),
    when: ({ mines }) => !!mines,
    apply: (v, { ms, mines }) => (mines === 'tb' ? v * 2 : Math.max(v, Math.min(...ms.units.map((u) => moveInternals.remaining(ms, u))))),
  });
  // B13.4212: Infantry enter woods via a TB at 1½ MF (twice that free of minefield attack, B28.61 EX), declinable.
  r.contribute({
    id: 'asl.mines.tbWoods',
    query: 'move.cost',
    ref: 'ASLRB B13.4212, B28.61',
    layer: 3,
    label: 'Trail Break into woods: 1½ MF (B13.4212)',
    when: ({ unit, from, to, loc, noTb }, env) => !noTb && !loc && !!from && isInfantry(env, pieceOf(env, unit)) && statics(env).map.hex(to)?.terrain === 'woods' && !!mineTbThrough(env, to, from),
    apply: (v) => Math.min(v, 1.5),
  });
  r.contribute({
    id: 'asl.mines.tbDecline',
    query: 'move.stepVariants',
    ref: 'ASLRB B13.4212',
    apply(v, { ms, to }, env) {
      if (ms.vehicle || !ms.hex || !isGroundLoc(to) || statics(env).map.hex(hexOfLoc(to))?.terrain !== 'woods' || !mineTbThrough(env, hexOfLoc(to), ms.hex)) return v;
      return [...v, { type: 'move.step' as const, to, noTb: true as const }];
    },
  });
  // The TB's -1 Defensive First Fire DRM (B13.4212, B28.61): Infantry using the TB to escape the attack or at its reduced
  // cost; the rubble module's `asl.tb.dff` reads the `tb` mark.
  r.procedure<MoveEnterFn>(MOVE_ENTER, (next) => (ctx, ms, to, cost, woods, extra) => {
    const toHex = hexOfLoc(to);
    const viaTb = !ms.vehicle && !!ms.hex && isGroundLoc(to) && !extra?.noTb && !!mineTbThrough(ctx, toHex, ms.hex);
    const reduced = viaTb && statics(ctx).map.hex(toHex)?.terrain === 'woods';
    const tb = !ms.vehicle && (extra?.mineEntry === 'tb' || reduced);
    const along = extra?.mineEntry === 'tb' ? mineTbThrough(ctx, toHex, ms.hex) : null;
    next?.(ctx, ms, to, cost, woods, tb || along ? { ...extra, ...(tb ? { tb: true as const } : {}), ...(along ? { mineTbIn: along } : {}) } : extra);
  });
  for (const event of ['piece.moved', 'piece.eliminated', 'asl.fort.removed'])
    r.on({ id: `asl.mines.partialPrune.${event}`, event, handler: (ctx) => (ctx.state.ext[PARTIAL_EXT] ? prunePartials(ctx) : undefined) });
}


// ---------------------------------------------------------------- vehicles (B28.42, B28.43, B28.5–B28.52, B28.61)

/**
 * The Aerial AF of the C7.11 AF Table (C7.12), by AF: used as an IFT DRM "for KIA purposes only" against the lowest hull AF
 * of an AFV attacked by A-T mines (B28.52). An AF the table does not print takes the next lower printed one.
 */
export const AERIAL_AF: Record<number, number> = { 0: 0, 1: 0, 2: 1, 3: 2, 4: 3, 6: 3, 8: 4, 11: 4 };
export function aerialAf(af: number): number {
  const keys = Object.keys(AERIAL_AF).map(Number).sort((a, b) => a - b);
  const k = [...keys].reverse().find((x) => x <= af) ?? 0;
  return AERIAL_AF[k]!;
}

export interface MineVehicleEvent {
  counter: string;
  hex: HexId;
  way: MineWay;
  vehicle: PieceId;
  kind: 'ap' | 'atDr' | 'at';
  dr: number[];
  drm?: number;
  /** A-P: a KIA immobilizes (B28.42); A-T: the dr makes an attack or not; the attack wrecks or immobilizes (B28.52). */
  effect: 'none' | 'immobilized' | 'wreck' | 'burningWreck' | 'attack';
  /** The factors, when the result had to be verified (B28.41): a KIA, an A-T attack. */
  factors?: number;
}

/**
 * A vehicle entering or leaving a minefield hex (B28.42, B28.51, B28.52): the A-P attack first (an AFV is affected only by a
 * KIA, which immobilizes it; its CE crew is attacked Collaterally with the same DR, D.8, with the CE DRM), then, unless
 * immobilized, the A-T dr (≤ the A-T factors makes an attack on the 36+ column, +the Aerial AF of the lowest hull AF for
 * KIA purposes: a 4 KIA or better is a Burning Wreck, any KIA a wreck, any other result Immobilization). An unarmored
 * vehicle is eliminated by any A-T attack; its A-P attack on the IFT's Vehicle line waits for that line. Returns whether
 * the vehicle can still move.
 */
export function mineVehicle(ctx: Ctx, vid: PieceId, hex: HexId, way: MineWay): boolean {
  const c = minefieldAt(ctx, hex);
  if (!c || c.mines?.dummy) return true;
  const v = pieceOf(ctx, vid);
  const d = vehicle(ctx, v);
  if (!d || isWreck(v)) return true;
  const m = c.mines ?? {};
  let stopped = false;
  const ev = (e: Omit<MineVehicleEvent, 'counter' | 'hex' | 'way' | 'vehicle'>) => ctx.emit('asl.mines.vehicle', { counter: c.id, hex, way, vehicle: vid, ...e } satisfies MineVehicleEvent);
  if (m.ap && !d.unarmored) {
    const roll = ctx.roll(`Minefield attack on ${vid} in ${hex} (ASLRB B28.42)`);
    const res = statics(ctx).tables.ift(m.ap, roll.total);
    const kia = res.kind === 'KIA';
    revealMines(ctx, c, kia);
    ev({ kind: 'ap', dr: roll.dice, effect: kia ? 'immobilized' : 'none', ...(kia ? { factors: m.ap } : {}) });
    if (kia) {
      applyVehicleEffect(ctx, vid, 'immobilized', `a minefield KIA (ASLRB B28.42)`);
      stopped = true;
      // B28.43, D.8: the Vulnerable (CE) crew of the immobilized AFV, Collaterally with the same Original DR, the CE DRM added.
      if (isCe(pieceOf(ctx, vid))) {
        const crew = statics(ctx).tables.ift(m.ap, roll.total + d.ceDrm);
        ctx.emit('sk3.collateral', { weapon: c.id, target: vid, column: m.ap, dr: roll.dice as [number, number], drm: d.ceDrm, result: crew });
        crewTakesResult(ctx, vid, crew, 'Collateral Attack (minefield, ASLRB B28.43)');
      }
    }
  } else if (m.ap) revealMines(ctx, c, false);
  if (!stopped && m.at) {
    const dr = ctx.roll(`A-T mine dr for ${vid} in ${hex} (ASLRB B28.51)`, 1).total;
    const attack = dr <= m.at;
    revealMines(ctx, c, attack);
    ev({ kind: 'atDr', dr: [dr], effect: attack ? 'attack' : 'none', ...(attack ? { factors: m.at } : {}) });
    if (attack) {
      if (d.unarmored) {
        ev({ kind: 'at', dr: [], effect: 'wreck' });
        applyVehicleEffect(ctx, vid, 'wreck', 'A-T mines: an unarmored vehicle is eliminated (ASLRB B28.52)');
      } else {
        const roll = ctx.roll(`A-T mine attack on ${vid} (ASLRB B28.52)`);
        const drm = aerialAf(Math.min(d.af.hull.front, d.af.hull.side, d.af.hull.rear));
        const res = statics(ctx).tables.ift(36, roll.total + drm);
        const effect: MineVehicleEvent['effect'] = res.kind === 'KIA' ? ((res.n ?? 1) >= 4 ? 'burningWreck' : 'wreck') : 'immobilized';
        ev({ kind: 'at', dr: roll.dice, drm, effect });
        // A Burning Wreck's Blaze (B25.14) is not built: it is a wreck.
        applyVehicleEffect(ctx, vid, effect === 'immobilized' ? 'immobilized' : 'wreck', `A-T mines (ASLRB B28.52)`);
      }
      stopped = true;
    }
  } else if (m.at && !m.ap) revealMines(ctx, c, false);
  return !stopped;
}

/** A vehicle leaving a minefield hex: the attacks in the hex it leaves; immobilized or wrecked, it stays (B28.412 EX, D8.1). */
function vehicleExit(ctx: Ctx, ms: MoveState, to: LocId, cost: number, go: () => void) {
  const vid = ms.units[0]!;
  const from = ms.hex!;
  const toHex = hexOfLoc(to);
  const own = partialTbsAt(ctx, from).find((p) => p.vehicle === vid);
  const exitSide = sideOfHex(ctx, from, toHex);
  if (mineExitExempt(ctx, ms, to, vid)) {
    // Back out along its own partial TB (Q&A to B28.41 & B28.61 (a), (b)): no attack, and no TB is left.
    if (own) setPartialTbs(ctx, from, partialTbsAt(ctx, from).filter((p) => p !== own));
    // Out along a TB: travel toward its exit hexside, for the One-Lane rule (B13.4212, B6.431).
    const tb = mineTbThrough(ctx, from, toHex);
    if (tb && exitSide !== null) useTb(ctx, from, tb, tb[0] === exitSide ? tb[1] : tb[0]);
    return go();
  }
  const fine = mineVehicle(ctx, vid, from, 'exit');
  if (own) {
    // Through and out (B28.61, B13.421): its partial TB becomes a TB from the hexside it came in by to the one it left by,
    // unless it was stopped there (B13.4211: an immobile vehicle makes no TB).
    setPartialTbs(ctx, from, partialTbsAt(ctx, from).filter((p) => p !== own));
    const pair: [number, number] = [Math.min(own.side, exitSide ?? 0), Math.max(own.side, exitSide ?? 0)];
    if (fine && exitSide !== null && !trailBreaksAt(ctx, from).some((t) => t[0] === pair[0] && t[1] === pair[1])) ctx.emit('asl.tb', { hex: from, tbs: [...trailBreaksAt(ctx, from), pair] });
  }
  if (fine) return go();
  if (ms.mineTbIn) dropTb(ctx, from, ms.mineTbIn);
  moveInternals.spendInPlace(ctx, moveState(ctx) ?? ms, cost, { halted: true });
  moveInternals.afterMfExpenditure(ctx);
  const after = moveState(ctx);
  if (after && ctx.state.decisions[ctx.state.decisions.length - 1]?.kind !== 'firstFire') {
    moveInternals.finishStack(ctx);
    moveInternals.reAskMover(ctx);
  }
}

/** A vehicle has entered a minefield hex: a Dummy is found, the attacks unless along a TB; a fully-tracked AFV that goes on makes a partial TB (B28.61). */
function vehicleEntry(ctx: Ctx, ms: MoveState) {
  const hex = ms.hex!;
  const vid = ms.units[0]!;
  findDummy(ctx, hex);
  if (!minefieldAt(ctx, hex)) return;
  if (ms.mineEntry === 'tb') {
    const tb = ms.mineTbIn ?? mineTbThrough(ctx, hex, ms.from);
    const side = sideOfHex(ctx, hex, ms.from);
    if (tb && side !== null) {
      useTb(ctx, hex, tb, side);
      ctx.emit('asl.tb.on', { vehicle: vid, on: { hex, tb } });
    }
    return;
  }
  const fine = mineVehicle(ctx, vid, hex, 'enter');
  const d = vehicle(ctx, pieceOf(ctx, vid));
  const side = sideOfHex(ctx, hex, ms.from);
  if (fine && d?.tracked && !d.unarmored && side !== null) setPartialTbs(ctx, hex, [...partialTbsAt(ctx, hex).filter((p) => p.vehicle !== vid), { side, vehicle: vid }]);
}

/** B13.4211: a wreck or Immobile vehicle on a TB removes it. */
function dropTb(ctx: Ctx, hex: HexId, pair: [number, number]) {
  const tbs = trailBreaksAt(ctx, hex);
  const keep = tbs.filter((t) => !(t[0] === pair[0] && t[1] === pair[1]) && !(t[0] === pair[1] && t[1] === pair[0]));
  if (keep.length !== tbs.length) ctx.emit('asl.tb', { hex, tbs: keep });
}

// ---------------------------------------------------------------- B28.53: open A-T mines removed by Infantry

export const REMOVAL_EXT = 'asl.mines.removal';
/** `units`: those of the moving stack spending the MF for it (all of them when absent). */
export type RemoveMinesAction = Action & { type: 'move.removeMines'; units?: PieceId[] };
interface Removal {
  hex: HexId;
  counter: string;
  units: PieceId[];
  /**
   * The MF is still being spent: the DEFENDER's First Fire at it may yet pin, break or eliminate a unit ("prior to or
   * during that MF expenditure", B28.53). Settled when the stack next spends MF or its move ends; what happens after that
   * no longer matters.
   */
  pending?: { trailAt: number };
}
const removals = (env: QueryEnv): Removal[] => (env.state.ext[REMOVAL_EXT] as Removal[] | undefined) ?? [];

/** A-T mines in full view (B28.53): an open A-T counter, no A-P factors, not a Known counter. */
export const openAtMines = (c: FortRecord | null): boolean => !!c && c.kind === 'mines' && !c.hidden && !!c.mines?.at && !c.mines.ap && !c.mines.known && !c.mines.dummy;

/** A unit that may spend the MF: alive, neither pinned nor broken (B28.53). */
const removerIllegal = (env: QueryEnv, u: PieceId): string | null => {
  const p = env.state.pieces[u];
  if (!p || p.loc.kind !== 'hex') return `${u} is not on the map`;
  if (isBroken(p)) return `${u} is broken: only Infantry neither pinned nor broken removes A-T mines (ASLRB B28.53)`;
  if (isPinned(p)) return `${u} is pinned: only Infantry neither pinned nor broken removes A-T mines (ASLRB B28.53)`;
  return null;
};

/** Why the moving stack (or `units` of it) may not spend a MF to remove the open A-T mines of its hex (B28.53), or null. */
export function removeMinesIllegal(env: QueryEnv, units?: PieceId[]): string | null {
  if (env.state.phase !== 'MPh') return 'Open A-T mines are removed in the MPh (ASLRB B28.53)';
  const ms = moveState(env);
  if (!ms || !ms.hex || ms.off || ms.level || ms.sub) return 'No stack is moving on the map';
  if (ms.vehicle) return 'Only Infantry remove A-T mines (ASLRB B28.53)';
  if (ms.halted) return 'The stack has ended its movement';
  if (!openAtMines(minefieldAt(env, ms.hex))) return `No A-T mines in full view in ${ms.hex} (ASLRB B28.53)`;
  const who = units ?? ms.units;
  if (!who.length) return 'Name the units spending the MF';
  for (const u of who) {
    const why = removerIllegal(env, u);
    if (why) return why;
    if (!ms.units.includes(u)) return `${u} is not moving`;
  }
  if (ms.units.some((u) => (ms.allowance[u] ?? 0) - (ms.spent[u] ?? 0) < 1)) return 'Each unit needs one MF more to remove the A-T mines (ASLRB B28.53)';
  if (removals(env).some((x) => x.hex === ms.hex && who.every((u) => x.units.includes(u)))) return 'These units have already spent the MF for it';
  return inPlaceIllegal(env, ms, 1);
}

/** Settle a pending removal: the units still neither pinned, broken nor eliminated once that MF's First Fire is over (B28.53). */
function settleRemovals(ctx: Ctx, force: boolean) {
  const ms = moveState(ctx);
  const list = removals(ctx);
  if (!list.some((x) => x.pending)) return;
  const next = list
    .map((x) => {
      if (!x.pending || (!force && ms && (ms.trail?.length ?? 0) <= x.pending.trailAt)) return x;
      const ok = x.units.filter((u) => !removerIllegal(ctx, u));
      return ok.length ? { hex: x.hex, counter: x.counter, units: ok } : null;
    })
    .filter((x): x is Removal => !!x);
  if (JSON.stringify(next) !== JSON.stringify(list)) ctx.emit('asl.mines.removal', { removals: next });
}

type Builder2 = Parameters<RuleModule['install']>[0];
function installAtRemoval(r: Builder2) {
  r.event<{ removals: Removal[] }>({
    type: 'asl.mines.removal',
    apply(d, p) {
      if (p.removals.length) d.ext[REMOVAL_EXT] = p.removals;
      else delete d.ext[REMOVAL_EXT];
    },
  });
  r.action<RemoveMinesAction>({
    type: 'move.removeMines',
    decisionKinds: [PHASE_DECISION],
    legal: (env) => (moveState(env) && !removeMinesIllegal(env) ? [{ type: 'move.removeMines' } as RemoveMinesAction] : []),
    validate: (env, a) => removeMinesIllegal(env, a.units),
    resolve(ctx, a) {
      const ms = moveState(ctx)!;
      const c = minefieldAt(ctx, ms.hex!)!;
      // One MF in the hex: a First Fire expenditure like any other (A8.12).
      moveInternals.spendInPlace(ctx, ms, 1, {});
      const trailAt = moveState(ctx)?.trail?.length ?? 0;
      const rec: Removal = { hex: ms.hex!, counter: c.id, units: [...(a.units ?? ms.units)].sort(), pending: { trailAt } };
      ctx.emit('asl.mines.removal', { removals: [...removals(ctx), rec] });
      moveInternals.afterMfExpenditure(ctx);
    },
  });
  r.on({ id: 'asl.mines.removalSettle', event: 'sk1.move.state', handler: (ctx) => settleRemovals(ctx, false) });
  // "eliminated at the end of the MPh by any Infantry expending an additional MF in that hex for that purpose which is not
  // pinned, broken, or eliminated in that hex prior to or during that MF expenditure" (B28.53): judged as the MF's First
  // Fire ends (above); what befalls the unit later does not undo it.
  r.on<{ phase: string }>({
    id: 'asl.mines.removalEnd',
    event: 'turn.phaseEnded',
    handler(ctx, ev) {
      if (ev.payload.phase !== 'MPh' || !removals(ctx).length) return;
      settleRemovals(ctx, true);
      for (const x of removals(ctx)) {
        const c = minefieldAt(ctx, x.hex);
        if (c && c.id === x.counter) removeFortification(ctx, c.id, 'A-T mines removed by Infantry (ASLRB B28.53)');
      }
      ctx.emit('asl.mines.removal', { removals: [] });
    },
  });
}

// ---------------------------------------------------------------- B13.4212: one way along a TB, as a One-Lane bridge (B6.431)

/** The direction of vehicular traffic along each TB this Player Turn (`from`: the hexside it came in by), and whether closed. */
export const TB_DIR_EXT = 'asl.tb.dir';
/** Vehicles standing on a TB, which block it to other vehicular traffic (B6.431, by B13.4212). Gone when the vehicle leaves. */
export const TB_ON_EXT = 'asl.tb.on';
const tbKey = (hex: HexId, tb: [number, number]) => `${hex}|${Math.min(...tb)}-${Math.max(...tb)}`;
const tbDirs = (env: QueryEnv) => (env.state.ext[TB_DIR_EXT] as Record<string, { from: number; closed?: true }> | undefined) ?? {};
const tbOn = (env: QueryEnv) => (env.state.ext[TB_ON_EXT] as Record<PieceId, { hex: HexId; tb: [number, number] }> | undefined) ?? {};

/**
 * Why a vehicle may not move onto the TB `tb` of `hex` now (B13.4212: "Usage of a TB is limited by one-way direction rules
 * as if the TB were a One-Lane bridge (6.43)"; B6.431): once a vehicle has gone along it in the direction opposite to one
 * used by a vehicle this Player Turn, no further vehicle moves onto it in either direction this Player Turn; a wreck or
 * another vehicle on it blocks it, except to a vehicle with a +2 size modifier. Infantry are never blocked.
 */
export function tbVehicleIllegal(env: QueryEnv, hex: HexId, tb: [number, number], vid: PieceId): string | null {
  const key = tbKey(hex, tb);
  if (tbDirs(env)[key]?.closed) return `Vehicles have used the Trail Break in ${hex} both ways this Player Turn: no more vehicular movement onto it (ASLRB B13.4212, B6.431)`;
  const small = vehicle(env, pieceOf(env, vid))?.targetSize === 'verySmall';
  if (small) return null;
  const on = Object.entries(tbOn(env)).find(([v, x]) => v !== vid && tbKey(x.hex, x.tb) === key && env.state.pieces[v]?.loc.kind === 'hex');
  if (on) return `${on[0]} is on the Trail Break in ${hex}: it blocks other vehicles (ASLRB B13.4212, B6.431)`;
  return null;
}

/** A vehicle moves along the TB coming from hexside `from`: the first sets the direction, one against it closes the TB. */
function useTb(ctx: Ctx, hex: HexId, tb: [number, number], from: number) {
  const key = tbKey(hex, tb);
  const now = tbDirs(ctx)[key];
  if (!now) ctx.emit('asl.tb.dir', { key, dir: { from } });
  else if (now.from !== from && !now.closed) ctx.emit('asl.tb.dir', { key, dir: { ...now, closed: true } });
}

export function installTbDirections(r: Parameters<RuleModule['install']>[0]) {
  r.event<{ key: string | null; dir?: { from: number; closed?: true } }>({
    type: 'asl.tb.dir',
    apply(d, p) {
      if (!p.key) {
        delete d.ext[TB_DIR_EXT];
        return;
      }
      d.ext[TB_DIR_EXT] = { ...((d.ext[TB_DIR_EXT] as object | undefined) ?? {}), [p.key]: p.dir! };
    },
  });
  r.event<{ vehicle: PieceId; on: { hex: HexId; tb: [number, number] } | null }>({
    type: 'asl.tb.on',
    apply(d, p) {
      const all = { ...((d.ext[TB_ON_EXT] as Record<PieceId, unknown> | undefined) ?? {}) };
      if (p.on) all[p.vehicle] = p.on;
      else delete all[p.vehicle];
      if (Object.keys(all).length) d.ext[TB_ON_EXT] = all;
      else delete d.ext[TB_ON_EXT];
    },
  });
  // "during that Player Turn": the direction and the closing last the Player Turn.
  r.on({ id: 'asl.tb.dirGone', event: 'turn.playerTurn', handler: (ctx) => (ctx.state.ext[TB_DIR_EXT] ? ctx.emit('asl.tb.dir', { key: null }) : undefined) });
  // A vehicle no longer on the TB (left its hex, eliminated) no longer blocks it; a TB that is gone holds nobody.
  for (const event of ['piece.moved', 'piece.eliminated', 'asl.tb'])
    r.on({
      id: `asl.tb.onGone.${event}`,
      event,
      handler(ctx) {
        for (const [v, x] of Object.entries(tbOn(ctx))) {
          const p = ctx.state.pieces[v];
          const there = !!p && p.loc.kind === 'hex' && p.loc.hex === x.hex && trailBreaksAt(ctx, x.hex).some((t) => tbKey(x.hex, t) === tbKey(x.hex, x.tb));
          if (!there) ctx.emit('asl.tb.on', { vehicle: v, on: null });
        }
      },
    });
}
