import type { Action, Ctx, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, hexOf, otherSide, personnelAt, statics, swHeldBy, unitsAt } from '../common/pieces';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import { FP, type FireDeclaration, type ResolveFireFn } from '../sk1/fire';
import { P as MP, type UnitFn } from '../sk1/morale';
import { MOVE_ENTER, firstFireMode, moveInternals, movingInfo, ppCarried, stackLimit, type MoveEnterFn, type MoveState } from '../sk1/movement';
import { moveState } from '../sk1/moveState';
import { T, actionIllegal, isBroken, isGoodOrder, isPinned, mmc, pieceOf, setTags, smc, squadEquivalents, sw, wounds } from '../sk1/status';
import { isVisibleTo } from '../sk1/known';
import { T4 } from './status';
import { concealmentActive, dropConcealment } from './concealment';
import { isJapanese } from './japanese';
import { isWreck, vehicle as vehicleOf } from '../sk3/status';
import { resolveVsVehicle } from '../sk3/vehicleCc';

/*
 * The Banzai Charge (SK4 8.1.8.6–8.1.8.8). A Japanese leader declares it in the MPh with a chain of adjacent Good
 * Order, unmoved Infantry units and a target: an enemy unit within eight hexes of, and in the LOS of, one of them.
 * The charge moves by Impulses: every unit one hex (toward the target, into an enemy hex no farther from it, or
 * next to it; never back into a hex it left), then the DEFENDER may First Fire at any Banzai hex, each unit having
 * spent the most any one unit spent that Impulse; then the next Impulse, until no unit can go on. Banzai units
 * have 8 MF (a wounded leader 3), +1 morale for the Player Turn, no Concealment, no pins (bamboo and collapsing
 * huts excepted), may enter an enemy Location, may not Assault Move or carry more than their IPC. A MMC entering a
 * hex of Good Order enemy Infantry is fired on at once by all of them as one Triple Point Blank Fire group (FPF if
 * need be); Banzai units may fire into their own hex in the AFPh; a unit sharing its hex with an enemy fires only
 * at it. Others advancing into a hex with Banzai units ambush as if the Banzai units were Inexperienced.
 *
 * The charge rides the movement machinery: each step is a one-unit move (`MOVE_ENTER` with a one-unit MoveState,
 * so terrain costs, Bog, Residual FP, HIP and Concealment bounces all apply), with the step's Defensive First Fire
 * held back (`move.firstFireAvailable` false) until the Impulse ends, when each Banzai hex gets its First Fire
 * window as a halted stack. Readings: the target hex stays the target even if its unit leaves or dies; a unit
 * bounced by a concealed stack (8.3.2) has moved for that Impulse and is out of the charge; the +1 morale and the
 * `banzai` tag last the Player Turn.
 *
 * The DC charge (S71 SSR 2, the `dc-banzai` SSR): "Any Japanese Infantry unit possessing a DC may declare a lone Banzai
 * Charge vs an AFV as if it were a leader": the same declaration with `vehicle` set, the unit alone, its target the
 * AFV's hex. A lone unit's Impulses are its own steps ("no Impulse Movement"). Once it is in the AFV's hex after all
 * Defensive First Fire and still unbroken, it attacks the AFV in CC at once (CCV 5, -3 DRM added to the usual CC DRM),
 * the DC is used up, and the charge is over: the MPh goes on.
 */

/** The SSR that allows the DC charge (S71 SSR 2). */
export const DC_BANZAI_MODULE = 'dc-banzai';
export interface DcBanzaiParams {
  ccv: number;
  drm: number;
  rule?: string;
}
export const dcBanzaiParams = (env: QueryEnv): DcBanzaiParams | null => {
  const s = statics(env).scenario.ssr.find((x) => x.module === DC_BANZAI_MODULE);
  return s ? ({ ccv: 5, drm: -3, ...(s.params ?? {}) } as DcBanzaiParams) : null;
};
/** The working DC a unit possesses, if any. */
const dcOf = (env: QueryEnv, unit: PieceId): Piece | undefined => swHeldBy(env.state, unit).find((w) => sw(env, w)?.type === 'DC' && w.tags[T.malf] !== true);
/** Enemy AFV (unwrecked vehicles) of `side` can see in a hex. */
const enemyAfvAt = (env: QueryEnv, hex: HexId, side: SideId) => enemyAt(env, hex, side).filter((p) => !!vehicleOf(env, p) && !isWreck(p) && isVisibleTo(env, p, side));

/** Why `unit` may not make a DC charge at `vehicle`, or null (S71 SSR 2). */
export function dcChargeIllegal(env: QueryEnv, side: SideId, unit: PieceId, vehicle: PieceId): string | null {
  const q = dcBanzaiParams(env);
  if (!q) return 'Only a leader declares a Banzai Charge';
  const p = env.state.pieces[unit];
  if (!p || p.side !== side || !jaInfantry(env, p)) return 'A Japanese Infantry unit makes the DC charge';
  if (!dcOf(env, unit)) return `Only a unit possessing a DC may make a DC charge (${q.rule ?? 'SSR'})`;
  const v = env.state.pieces[vehicle];
  const vh = v && hexOf(env.state, v);
  if (!v || !vh || !enemyAfvAt(env, vh, side).some((x) => x.id === vehicle)) return 'The target of a DC charge is an enemy AFV';
  return null;
}

/** The SSR's module: the DC charge itself lives in the Banzai module (`dcBanzaiParams` switches it on). */
export const dcBanzaiModule: RuleModule = {
  id: 'ssr.dc-banzai',
  ref: 'S71 SSR 2',
  summary: 'A Japanese Infantry unit with a DC may make a lone Banzai Charge at an AFV, then attack it in CC at once (CCV 5, -3 DRM).',
  requires: ['sk4.banzai', 'sk3.cc'],
  install() {},
};

export const BANZAI = 'sk4.banzai';
export const BANZAI_MF = 8;
export const BANZAI_MF_WOUNDED_LEADER = 3;
export const BANZAI_RANGE = 8;

export interface BanzaiState {
  side: SideId;
  leader: PieceId;
  target: HexId;
  /** Units still charging, in id order. */
  units: PieceId[];
  allowance: Record<PieceId, number>;
  spent: Record<PieceId, number>;
  /** Hexes each unit has left (it may not re-enter one). */
  left: Record<PieceId, HexId[]>;
  impulse: number;
  /** Units that have made their step this Impulse, and each unit's MF at the Impulse's start. */
  moved: PieceId[];
  startSpent: Record<PieceId, number>;
  /** Units that ended their charge next to the target, by choice. */
  ended: PieceId[];
  /** A step in progress: its Defensive First Fire waits for the Impulse's end. */
  stepping?: boolean;
  /** Impulse-end Defensive First Fire windows still to open, one per Banzai hex. */
  dff?: HexId[];
  /** A DC charge (S71 SSR 2): the AFV it is made at. */
  vehicle?: PieceId;
}

export type BanzaiAction =
  | (Action & { type: 'banzai.declare'; leader: PieceId; target: HexId; units: PieceId[]; vehicle?: PieceId })
  | (Action & { type: 'banzai.step'; unit: PieceId; to: HexId })
  | (Action & { type: 'banzai.end'; unit: PieceId });

export const banzaiState = (env: QueryEnv) => env.state.ext[BANZAI] as BanzaiState | undefined;
const map = (env: QueryEnv) => statics(env).map;
const jaInfantry = (env: QueryEnv, p: Piece) => isJapanese(env, p) && !!(mmc(env, p) || smc(env, p));
const charging = (p: Piece) => p.tags[T4.banzai] === 'charging';
const enemyAt = (env: QueryEnv, hex: HexId, side: SideId) => unitsAt(env, hex, otherSide(env.state, side));

/** Whether a set of units forms one chain of adjacent hexes (each adjacent to another of the set). */
function chained(env: QueryEnv, units: Piece[]): boolean {
  const hexes = [...new Set(units.map((p) => hexOf(env.state, p)).filter((h): h is HexId => !!h))];
  if (hexes.length <= 1) return true;
  const seen = new Set<HexId>([hexes[0]!]);
  const queue = [hexes[0]!];
  while (queue.length) {
    const h = queue.shift()!;
    for (const n of map(env).neighbors(h)) if (hexes.includes(n) && !seen.has(n)) (seen.add(n), queue.push(n));
  }
  return seen.size === hexes.length;
}

/** Why a Banzai Charge may not be declared so, or null (SK4 8.1.8.6). */
export function declareIllegal(env: QueryEnv, side: SideId, leader: PieceId, target: HexId, units: PieceId[], vehicle?: PieceId): string | null {
  if (env.state.phase !== 'MPh') return 'A Banzai Charge is declared in the Movement Phase';
  if (env.state.attacker !== side) return 'Only the ATTACKER charges';
  if (banzaiState(env)) return 'A Banzai Charge is already under way';
  if (moveState(env)) return 'Finish moving the current stack first';
  const l = env.state.pieces[leader];
  if (vehicle !== undefined) {
    const why = dcChargeIllegal(env, side, leader, vehicle);
    if (why) return why;
    if (units.length !== 1 || units[0] !== leader) return 'A DC charge is made by the unit alone';
    if (hexOf(env.state, env.state.pieces[vehicle]!) !== target) return 'The target hex is the AFV’s';
  } else if (!l || l.side !== side || !smc(env, l) || !isJapanese(env, l)) return 'A Japanese leader declares the charge';
  if (!units.includes(leader)) return 'The leader is part of the charge';
  if (!map(env).hex(target)) return 'No such hex';
  const foe = enemyAt(env, target, side).filter((p) => isVisibleTo(env, p, side));
  if (foe.length === 0) return 'The target is an enemy unit';
  const ps = units.map((u) => env.state.pieces[u]).filter((p): p is Piece => !!p);
  if (ps.length !== units.length || ps.some((p) => p.side !== side)) return 'Only your own units charge';
  for (const p of ps) {
    if (!jaInfantry(env, p)) return `${p.id} is not Japanese Infantry`;
    if (p.loc.kind !== 'hex') return `${p.id} is not on the map`;
    if (!isGoodOrder(env, p) || isPinned(p)) return `${p.id} must be in Good Order and free to move`;
    if (p.tags[T.moved] !== undefined || p.tags[T4.banzai] !== undefined) return `${p.id} has already started its MPh`;
    const halted = actionIllegal(env, [p.id]);
    if (halted) return halted;
    if (enemyAt(env, hexOf(env.state, p)!, side).length) return `${p.id} shares its hex with an enemy unit`;
    if (ppCarried(env, p.id) > env.query('unit.ipc', { unit: p.id }, 0)) return `${p.id} carries more than its IPC`;
  }
  if (!chained(env, ps)) return 'Every charging unit must be adjacent to another unit of the charge';
  const inReach = ps.some((p) => {
    const h = hexOf(env.state, p)!;
    return map(env).distance(h, target) <= BANZAI_RANGE && env.query('los.trace', { from: h, to: target }, { clear: true, hindrance: 0, parts: [] }).clear;
  });
  if (!inReach) return `No charging unit is within ${BANZAI_RANGE} hexes of the target with a LOS to it`;
  return null;
}

/** A one-unit MoveState for a Banzai unit standing in `hex`: the movement machinery's view of its step. */
function unitMove(env: QueryEnv, st: BanzaiState, unit: PieceId, hex: HexId | null, patch: Partial<MoveState> = {}): MoveState {
  return {
    units: [unit],
    started: [unit],
    hex,
    off: null,
    allowance: { [unit]: st.allowance[unit] ?? 0 },
    spent: { [unit]: st.spent[unit] ?? 0 },
    doubleTime: false,
    assault: false,
    hexesEntered: hex ? st.left[unit]?.length ?? 0 : 0,
    roadOnly: false,
    viaRoad: false,
    mfHere: 0,
    firedHere: {},
    residualDrmHere: null,
    smokeTried: true,
    leaderBonus: [],
    from: null,
    ...patch,
  };
}

/** The hexes a charging unit may step into now (SK4 8.1.8.6), or none. */
export function banzaiSteps(env: QueryEnv, unit: PieceId): HexId[] {
  const st = banzaiState(env);
  const p = env.state.pieces[unit];
  if (!st || !p || !st.units.includes(unit) || st.moved.includes(unit) || p.loc.kind !== 'hex') return [];
  const here = p.loc.hex;
  const m = map(env);
  const d0 = m.distance(here, st.target);
  const ms = unitMove(env, st, unit, here);
  const left = (st.allowance[unit] ?? 0) - (st.spent[unit] ?? 0);
  if (left <= 0) return [];
  const own = (h: HexId) => personnelAt(env, h, st.side);
  const enterable = (to: HexId): boolean => {
    if (!m.hex(to) || (st.left[unit] ?? []).includes(to)) return false;
    if (env.query('move.stepIllegal', { ms, to }, null)) return false;
    const cost = moveInternals.stepCost(env, ms, to);
    if (cost > left) return false;
    // Stacking (own side only, SK4 2.0); an enemy Location may be entered.
    const all = [...own(to).filter((q) => q.id !== unit), p];
    const limit = stackLimit(env, to, st.side);
    if (squadEquivalents(env, all) > limit.se || all.filter((q) => smc(env, q)).length > limit.smc) return false;
    return true;
  };
  const neighbors = m.neighbors(here).filter(enterable);
  // Adjacent to the target: must enter it, unless a Banzai unit is already there.
  if (d0 === 1 && neighbors.includes(st.target) && !own(st.target).some(charging)) return [st.target];
  if (d0 === 1 && own(st.target).some(charging)) {
    // Next to the target already, with a Banzai unit in it: on toward an enemy hex no farther, or stay adjacent.
    return neighbors.filter((to) => (enemyAt(env, to, st.side).length > 0 && m.distance(to, st.target) <= d0) || m.distance(to, st.target) === 1);
  }
  return neighbors.filter((to) => m.distance(to, st.target) < d0 || (enemyAt(env, to, st.side).length > 0 && m.distance(to, st.target) <= d0) || m.distance(to, st.target) === 1);
}

/** Why a unit may not end its charge where it stands, or null: next to the target, no adjacent enemy hex without Banzai units. */
export function endIllegal(env: QueryEnv, unit: PieceId): string | null {
  const st = banzaiState(env);
  const p = env.state.pieces[unit];
  if (!st || !p || !st.units.includes(unit)) return 'Not a charging unit';
  if (st.moved.includes(unit)) return 'That unit has moved this Impulse';
  const here = hexOf(env.state, p);
  if (!here || map(env).distance(here, st.target) !== 1) return 'Only a unit adjacent to the target may end its charge';
  const devoid = map(env).neighbors(here).find((h) => enemyAt(env, h, st.side).length > 0 && !personnelAt(env, h, st.side).some(charging));
  if (devoid) return `An adjacent enemy-occupied hex (${devoid}) has no Banzai unit in it: the charge goes on`;
  return null;
}

const setState = (ctx: Ctx, st: BanzaiState | null) => ctx.emit('sk4.banzai.state', { state: st });

export const banzaiModule: RuleModule = {
  id: BANZAI,
  ref: 'SK4 8.1.8.6–8.1.8.8',
  summary: 'The Banzai Charge: a Japanese leader leads a chain of units at an enemy by Impulses, each one hex, Defensive First Fire between Impulses; TPBF on entering a defended hex and in the AFPh; Banzai Ambush.',
  requires: ['sk1.movement', 'sk1.fire', 'sk4.japanese'],
  install(r) {
    r.event<{ state: BanzaiState | null }>({
      type: 'sk4.banzai.state',
      apply(d, p) {
        if (p.state) d.ext[BANZAI] = p.state;
        else delete d.ext[BANZAI];
      },
    });
    r.event<{ side: SideId; leader: PieceId; target: HexId; units: PieceId[]; vehicle?: PieceId }>({ type: 'sk4.banzai.declared', apply() {} });
    r.event<{ unit: PieceId; from: HexId; to: HexId; impulse: number; cost: number }>({ type: 'sk4.banzai.step', apply() {} });
    r.event<{ impulse: number; mf: number; units: PieceId[] }>({ type: 'sk4.banzai.impulse', apply() {} });
    r.event<{ unit: PieceId; why: string }>({ type: 'sk4.banzai.out', apply() {} });
    r.event<{ hex: HexId; unit: PieceId; firers: PieceId[] }>({ type: 'sk4.banzai.tpbf', apply() {} });
    r.event<{ side: SideId }>({ type: 'sk4.banzai.ended', apply() {} });
    r.redact({ id: 'sk4.banzai.redact', ext: BANZAI, redactExt: (v) => v });

    // ---------------------------------------------------------------- while a charge is under way
    r.contribute({ id: 'sk4.banzai.no-other-move', query: 'move.cannotStart', when: (_c, env) => !!banzaiState(env), apply: () => 'A Banzai Charge is under way: finish it first' });
    r.contribute({ id: 'sk4.banzai.no-end', query: 'phase.endBlocked', when: (_c, env) => !!banzaiState(env) && env.state.phase === 'MPh', apply: () => 'A Banzai Charge is under way' });
    // A step's own Defensive First Fire waits for the Impulse to end (8.1.8.6).
    r.contribute({ id: 'sk4.banzai.hold-dff', query: 'move.firstFireAvailable', layer: 200, when: (_c, env) => !!banzaiState(env)?.stepping, apply: () => false });
    // Banzai units: +1 morale for the Player Turn, no pin results (bamboo and collapsing huts set the tag directly).
    r.contribute({ id: 'sk4.banzai.morale', query: 'unit.morale', ref: 'SK4 8.1.8.6', label: '+1 Banzai', when: ({ unit }, env) => pieceOf(env, unit).tags[T4.banzai] !== undefined, apply: (v) => v + 1 });
    r.procedure<UnitFn>(MP.pin, (next) => (ctx, unit, reason) => {
      if (charging(pieceOf(ctx, unit))) return;
      next!(ctx, unit, reason);
    });
    // Having entered an enemy's hex, a Banzai unit may not advance out of it (8.1.8.6).
    r.contribute({
      id: 'sk4.banzai.no-advance',
      query: 'advance.illegal',
      ref: 'SK4 8.1.8.6',
      when: ({ units, side }, env) => units.some((u) => pieceOf(env, u).tags[T4.banzai] !== undefined && enemyAt(env, hexOf(env.state, pieceOf(env, u)) ?? '', side).length > 0),
      apply: () => 'A Banzai unit that entered an enemy hex may not advance this turn (SK4 8.1.8.6)',
    });
    // Banzai Ambush (8.1.8.8): other units advancing into a hex with Banzai units ambush as if the Banzai units were Inexperienced.
    r.contribute({
      id: 'sk4.banzai.ambush',
      query: 'cc.ambushDrm',
      ref: 'SK4 8.1.8.8',
      label: '+1 Banzai units Inexperienced',
      when: ({ units, hex }, env) => {
        const ps = units.map((u) => pieceOf(env, u));
        return ps.some((p) => p.tags[T4.banzai] !== undefined) && ps.some((p) => p.tags[T4.banzai] === undefined && p.tags[T.advancedInto] === hex);
      },
      apply: (v) => v + 1,
    });
    // AFPh: a Banzai unit may fire into its own hex at the enemy there (8.1.8.7).
    r.contribute({
      id: 'sk4.banzai.own-hex-fire',
      query: 'fire.ownHexAllowed',
      ref: 'SK4 8.1.8.7',
      when: ({ firer }, env) => env.state.phase === 'AFPh' && pieceOf(env, firer).tags[T4.banzai] !== undefined,
      apply: () => true,
    });
    // The tag and the +1 morale last the Player Turn.
    r.on<{ phase: string }>({
      id: 'sk4.banzai.cleanup',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'CCPh') return;
        for (const p of Object.values(ctx.state.pieces).sort(byId)) if (p.tags[T4.banzai] !== undefined) setTags(ctx, p.id, { [T4.banzai]: null });
        if (banzaiState(ctx)) setState(ctx, null);
      },
    });

    // ---------------------------------------------------------------- actions
    r.action<BanzaiAction & { type: 'banzai.declare' }>({
      type: 'banzai.declare',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        if (env.state.phase !== 'MPh' || banzaiState(env) || moveState(env)) return [];
        const side = env.state.attacker;
        const out: Omit<BanzaiAction & { type: 'banzai.declare' }, 'side' | 'decisionId'>[] = [];
        const leaders = Object.values(env.state.pieces).filter((p) => p.side === side && p.loc.kind === 'hex' && smc(env, p) && isJapanese(env, p) && isGoodOrder(env, p) && !isPinned(p) && p.tags[T.moved] === undefined).sort(byId);
        if (!leaders.length) return [];
        const targets = [...new Set(Object.values(env.state.pieces).filter((p) => p.side !== side && p.loc.kind === 'hex' && (mmc(env, p) || smc(env, p)) && isVisibleTo(env, p, side)).map((p) => hexOf(env.state, p)!))].sort();
        for (const l of leaders) {
          // The leader's whole stack, as the smallest sensible chain; the interface lets the player pick the units.
          const units = personnelAt(env, hexOf(env.state, l)!, side).filter((p) => jaInfantry(env, p) && isGoodOrder(env, p) && !isPinned(p) && p.tags[T.moved] === undefined).map((p) => p.id);
          for (const target of targets) if (!declareIllegal(env, side, l.id, target, units)) out.push({ type: 'banzai.declare', leader: l.id, target, units });
        }
        // S71 SSR 2: a lone DC charge at an AFV.
        if (dcBanzaiParams(env)) {
          const afvs = Object.values(env.state.pieces).filter((p) => p.side !== side && p.loc.kind === 'hex' && !!vehicleOf(env, p) && !isWreck(p) && isVisibleTo(env, p, side)).sort(byId);
          for (const u of Object.values(env.state.pieces).filter((p) => p.side === side && p.loc.kind === 'hex' && jaInfantry(env, p) && !!dcOf(env, p.id)).sort(byId))
            for (const v of afvs) {
              const target = hexOf(env.state, v)!;
              if (!declareIllegal(env, side, u.id, target, [u.id], v.id)) out.push({ type: 'banzai.declare', leader: u.id, target, units: [u.id], vehicle: v.id });
            }
        }
        return out;
      },
      validate: (env, a) => declareIllegal(env, a.side, a.leader, a.target, a.units, a.vehicle),
      resolve(ctx, a) {
        const units = [...a.units].sort();
        const allowance: Record<PieceId, number> = {};
        for (const u of units) {
          const p = pieceOf(ctx, u);
          allowance[u] = smc(ctx, p) && wounds(p) > 0 ? BANZAI_MF_WOUNDED_LEADER : BANZAI_MF;
          setTags(ctx, u, { [T4.banzai]: 'charging' });
        }
        if (concealmentActive(ctx)) dropConcealment(ctx, units, 'banzai');
        ctx.emit('sk4.banzai.declared', { side: a.side, leader: a.leader, target: a.target, units, ...(a.vehicle ? { vehicle: a.vehicle } : {}) });
        setState(ctx, { side: a.side, leader: a.leader, target: a.target, units, allowance, spent: Object.fromEntries(units.map((u) => [u, 0])), left: {}, impulse: 0, moved: [], startSpent: {}, ended: [], ...(a.vehicle ? { vehicle: a.vehicle } : {}) });
        startImpulse(ctx);
      },
    });

    r.action<BanzaiAction & { type: 'banzai.step' }>({
      type: 'banzai.step',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const st = banzaiState(env);
        if (!st || st.dff || st.stepping) return [];
        return st.units.flatMap((unit) => banzaiSteps(env, unit).map((to) => ({ type: 'banzai.step' as const, unit, to })));
      },
      validate(env, a) {
        const st = banzaiState(env);
        if (!st) return 'No Banzai Charge is under way';
        if (st.dff) return 'The DEFENDER is firing at the charge';
        if (!st.units.includes(a.unit)) return `${a.unit} is not charging`;
        if (st.moved.includes(a.unit)) return `${a.unit} has moved this Impulse`;
        if (!banzaiSteps(env, a.unit).includes(a.to)) return `${a.unit} may not enter ${a.to} in a Banzai Charge (toward the target, an enemy hex no farther from it, or next to it; never a hex it left)`;
        return null;
      },
      resolve(ctx, a) {
        stepUnit(ctx, a.unit, a.to);
      },
    });

    r.action<BanzaiAction & { type: 'banzai.end' }>({
      type: 'banzai.end',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const st = banzaiState(env);
        if (!st || st.dff || st.stepping) return [];
        return st.units.filter((u) => !endIllegal(env, u)).map((unit) => ({ type: 'banzai.end' as const, unit }));
      },
      validate: (env, a) => endIllegal(env, a.unit),
      resolve(ctx, a) {
        const st = banzaiState(ctx)!;
        ctx.emit('sk4.banzai.out', { unit: a.unit, why: 'ended its charge next to the target' });
        setTags(ctx, a.unit, { [T4.banzai]: 'done', [T.moved]: true });
        setState(ctx, { ...st, units: st.units.filter((u) => u !== a.unit), ended: [...st.ended, a.unit] });
        afterUnitAction(ctx);
      },
    });

    // The Impulse-end First Fire windows run one Banzai hex after another: each ends with the movement machinery
    // asking the mover again, which here means opening the next window instead.
    r.on<{ decision: { kind: string; id: string } }>({
      id: 'sk4.banzai.next-window',
      event: 'decision.pushed',
      handler(ctx, ev) {
        const st = banzaiState(ctx);
        if (!st?.dff || ev.payload.decision.kind !== PHASE_DECISION || ctx.state.phase !== 'MPh') return;
        ctx.popDecision(ev.payload.decision.id);
        nextWindow(ctx);
      },
    });
  },
};

/** One unit's step: the move machinery enters the hex (costs, Bog, Residual FP, HIP and "?" bounces), then the TPBF. */
function stepUnit(ctx: Ctx, unit: PieceId, to: HexId) {
  const st = banzaiState(ctx)!;
  const p = pieceOf(ctx, unit);
  const from = hexOf(ctx.state, p)!;
  const ms = unitMove(ctx, st, unit, from);
  const cost = moveInternals.stepCost(ctx, ms, to);
  setState(ctx, { ...st, stepping: true, moved: [...st.moved, unit], left: { ...st.left, [unit]: [...(st.left[unit] ?? []), from] } });
  ctx.emit('sk1.move.state', { state: ms });
  ctx.emit('sk4.banzai.step', { unit, from, to, impulse: st.impulse, cost });
  ctx.proc<MoveEnterFn>(MOVE_ENTER)(ctx, ms, to, cost);
  // What the move machinery left: the unit's MF (a bounce spends them in place), then the stack is ours again.
  const after = moveState(ctx);
  const spent = after?.spent[unit] ?? (st.spent[unit] ?? 0) + cost;
  const cur = banzaiState(ctx)!;
  setState(ctx, { ...cur, stepping: false, spent: { ...cur.spent, [unit]: spent } });
  // A MMC entering a hex of Good Order enemy Infantry: they all fire at it at once, as one TPBF group (8.1.8.7).
  const now = ctx.state.pieces[unit];
  if (now && now.loc.kind === 'hex' && now.loc.hex === to && mmc(ctx, now)) mandatoryTpbf(ctx, unit, to);
  if (moveState(ctx)) ctx.emit('sk1.move.state', { state: null });
  afterUnitAction(ctx);
}

function mandatoryTpbf(ctx: Ctx, unit: PieceId, hex: HexId) {
  const st = banzaiState(ctx)!;
  // Good Order enemy Infantry there, pinned or not (a pinned unit fires at half FP).
  const firers = personnelAt(ctx, hex, otherSide(ctx.state, st.side)).filter((p) => isGoodOrder(ctx, p));
  if (firers.length === 0) return;
  const weapons = firers.flatMap((f) => swHeldBy(ctx.state, f.id).filter((w) => ['LMG', 'MMG', 'HMG', 'ATR'].includes(sw(ctx, w)?.type ?? '') && w.tags[T.malf] !== true).map((w) => w.id));
  const decl: FireDeclaration = { units: firers.map((f) => f.id).sort(), sw: weapons.sort(), target: hex };
  const mode = firstFireMode(ctx, decl);
  const ms = moveState(ctx) ?? unitMove(ctx, st, unit, hex, { mfHere: 1 });
  ctx.emit('sk4.banzai.tpbf', { hex, unit, firers: decl.units });
  ctx.proc<ResolveFireFn>(FP.resolve)(ctx, decl, mode, { moving: [unit], movingInfo: movingInfo(ctx, ms) });
}

/** After a step or a voluntary end: the next unit's turn, or the Impulse is over. */
function afterUnitAction(ctx: Ctx) {
  const st = banzaiState(ctx);
  if (!st) return;
  const pending = st.units.filter((u) => !st.moved.includes(u) && banzaiSteps(ctx, u).length > 0);
  if (pending.length === 0) endImpulse(ctx);
  else reAsk(ctx);
}

function reAsk(ctx: Ctx) {
  const top = ctx.state.decisions[ctx.state.decisions.length - 1];
  if (top?.kind === PHASE_DECISION) ctx.popDecision(top.id);
  if (!ctx.state.result) askPhaseOwner(ctx, ctx.state.attacker);
}

/** Prune the charge, then open the next Impulse (or end the charge). */
function startImpulse(ctx: Ctx) {
  const st = banzaiState(ctx);
  if (!st) return;
  // The DC charge (S71 SSR 2): in the AFV's hex after all Defensive First Fire, unbroken: the CC attack, and the end.
  if (st.vehicle && dcAttack(ctx, st)) return;
  const keep: PieceId[] = [];
  for (const u of st.units) {
    const p = ctx.state.pieces[u];
    const why = !p || p.loc.kind !== 'hex' ? 'eliminated' : isBroken(p) ? 'broken' : (st.spent[u] ?? 0) >= (st.allowance[u] ?? 0) ? 'out of MF' : enemyAt(ctx, p.loc.hex, st.side).length ? 'in a hex with an enemy unit' : null;
    if (why) {
      ctx.emit('sk4.banzai.out', { unit: u, why });
      if (p && p.loc.kind === 'hex') setTags(ctx, u, { [T4.banzai]: 'done', [T.moved]: true });
      continue;
    }
    keep.push(u);
  }
  const next: BanzaiState = { ...st, units: keep, impulse: st.impulse + 1, moved: [], startSpent: Object.fromEntries(keep.map((u) => [u, st.spent[u] ?? 0])), dff: undefined, stepping: false };
  setState(ctx, next);
  // Units with no legal step are out as well ("can no longer move in a Banzai Charge").
  const stuck = keep.filter((u) => banzaiSteps(ctx, u).length === 0 && endIllegal(ctx, u));
  for (const u of stuck) {
    ctx.emit('sk4.banzai.out', { unit: u, why: 'can no longer move in the charge' });
    setTags(ctx, u, { [T4.banzai]: 'done', [T.moved]: true });
  }
  const units = keep.filter((u) => !stuck.includes(u));
  setState(ctx, { ...next, units });
  if (units.length === 0) {
    endCharge(ctx);
    return;
  }
  ctx.emit('sk4.banzai.impulse', { impulse: next.impulse, mf: 0, units });
  reAsk(ctx);
}

/** Every unit has stepped: all have spent the Impulse's maximum; the DEFENDER may fire at each Banzai hex. */
function endImpulse(ctx: Ctx) {
  const st = banzaiState(ctx)!;
  const max = Math.max(0, ...st.units.map((u) => (st.spent[u] ?? 0) - (st.startSpent[u] ?? 0)));
  const spent = { ...st.spent };
  for (const u of st.units) spent[u] = (st.startSpent[u] ?? spent[u] ?? 0) + max;
  const hexes = [...new Set(st.units.map((u) => hexOf(ctx.state, pieceOf(ctx, u))).filter((h): h is HexId => !!h))].sort();
  ctx.emit('sk4.banzai.impulse', { impulse: st.impulse, mf: max, units: st.units });
  setState(ctx, { ...st, spent, dff: hexes });
  nextWindow(ctx);
}

/** Open the First Fire window for the next Banzai hex, or start the next Impulse. */
function nextWindow(ctx: Ctx) {
  const st = banzaiState(ctx);
  if (!st?.dff) return;
  const [hex, ...rest] = st.dff;
  if (!hex) {
    setState(ctx, { ...st, dff: undefined });
    startImpulse(ctx);
    return;
  }
  setState(ctx, { ...st, dff: rest });
  const units = st.units.filter((u) => hexOf(ctx.state, pieceOf(ctx, u)) === hex && pieceOf(ctx, u).loc.kind === 'hex');
  if (units.length === 0) {
    nextWindow(ctx);
    return;
  }
  const max = Math.max(1, ...units.map((u) => (st.spent[u] ?? 0) - (st.startSpent[u] ?? 0)));
  const ms: MoveState = {
    ...unitMove(ctx, st, units[0]!, hex),
    units,
    started: units,
    allowance: Object.fromEntries(units.map((u) => [u, st.allowance[u] ?? 0])),
    spent: Object.fromEntries(units.map((u) => [u, st.spent[u] ?? 0])),
    mfHere: max,
    hexesEntered: 1,
    halted: true,
    ending: true,
  };
  ctx.emit('sk1.move.state', { state: ms });
  moveInternals.offerFirstFire(ctx);
}

/** The DC charge's CC attack when its unit stands unbroken in the AFV's hex; true when the charge is over. */
function dcAttack(ctx: Ctx, st: BanzaiState): boolean {
  const unit = st.units[0];
  const p = unit ? ctx.state.pieces[unit] : undefined;
  const v = st.vehicle ? ctx.state.pieces[st.vehicle] : undefined;
  if (!p || p.loc.kind !== 'hex' || isBroken(p) || !v || isWreck(v) || hexOf(ctx.state, v) !== p.loc.hex) return false;
  const q = dcBanzaiParams(ctx)!;
  const dc = dcOf(ctx, p.id);
  if (!dc) return false;
  const rule = q.rule ?? 'SSR';
  resolveVsVehicle(ctx, st.side, [p.id], v.id, { ccv: { value: q.ccv, label: `CCV ${q.ccv} (DC charge, ${rule})` }, extraDrm: { value: q.drm, label: `${q.drm} DC charge (${rule})` } });
  if (ctx.state.pieces[dc.id]?.loc.kind !== 'eliminated') ctx.emit('piece.eliminated', { id: dc.id, reason: `DC used in the charge (${rule})` });
  endCharge(ctx);
  return true;
}

function endCharge(ctx: Ctx) {
  const st = banzaiState(ctx);
  if (!st) return;
  for (const u of st.units) {
    const p = ctx.state.pieces[u];
    if (p && p.loc.kind === 'hex') setTags(ctx, u, { [T4.banzai]: 'done', [T.moved]: true });
  }
  ctx.emit('sk4.banzai.ended', { side: st.side });
  setState(ctx, null);
  if (moveState(ctx)) ctx.emit('sk1.move.state', { state: null });
  reAsk(ctx);
}

