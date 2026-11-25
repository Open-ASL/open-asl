import { stackLimit } from './movement';
import type { Action, Ctx, Decision, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, hexOf, otherSide, personnelAt, statics, swHeldBy } from '../common/pieces';
import { LEVEL_CHANGE_MF, adjacentLocs, hexOfLoc, levelOfLoc, locId, locOf, locationAt, locationsOf, parseLoc, type LocId } from '../common/location';
import { PHASE_DECISION, PHASE_DONE, askPhaseOwner, type PhaseDoneFn } from '../common/turn';
import { hasLos, knownEnemyAt, knownEnemyUnits } from './known';
import { P as MP, eliminate, type CasualtyFn, type CheckOutcome, type FlushFn } from './morale';
import {
  T,
  hasDm,
  inMelee,
  isBroken,
  isCx,
  isGoodOrder,
  isPinned,
  mmc,
  pieceOf,
  setTags,
  smc,
  sw,
  wounds,
  gun,
  restack,
  squadEquivalents,
  ppOf,
} from './status';
import { isWoodsRoad, terrainOf } from './terrain';
import { hexLabel, pieceLabel } from '../labels';

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Rout MF for a broken unit. */
    'rout.mf': { ctx: { unit: PieceId }; value: number };
    /**
     * Full ASL: the MF a leader routing with a broken unit has (ASLRB A10.711 "must remain with the broken unit", with
     * A4.42's portage), which the rout of the two may not exceed; null for no limit of his own (the Starter Kit).
     */
    'rout.escortMf': { ctx: { leader: PieceId }; value: number | null };
    /** Full ASL: why this leader may not rout with a broken unit for a reason of his own (ASLRB A4.42 portage), or null. */
    'rout.escortIllegal': { ctx: { leader: PieceId }; value: string | null };
    /** Why a rout step from `from` into `to` is refused by another rule pack (S70's caves), or null. */
    'rout.stepIllegal': { ctx: { unit: PieceId; from: LocId; to: LocId }; value: string | null };
    /** Can this enemy unit interdict a router entering `hex` (from `from`, when known)? */
    'rout.canInterdict': { ctx: { interdictor: PieceId; hex: HexId; from?: HexId }; value: boolean };
    /** The unit need not rout for being in Open Ground (SK4 3.6 "unemplaced": an emplaced Gun's crew is exempt). */
    'rout.exemptOpenGround': { ctx: { unit: PieceId }; value: boolean };
    /** Full ASL: a rout step into `to` that goes straight beneath its entrenchment (ASLRB B27.41): the step's whole cost, a refusal, or null where there is none. */
    'rout.beneath': { ctx: { unit: PieceId; from: HexId; to: LocId }; value: { cost: number } | string | null };
    /**
     * Full ASL: MF counted, for finding the nearest shelter only, to leave `hex` on the way (`start`: the unit's own hex,
     * from where it stands): Wire's exit as one MF (ASLRB A10.531; Q&A to A10.51/B26). 0 in the Starter Kit.
     */
    'rout.planLeaveMf': { ctx: { unit: PieceId; hex: HexId; start: boolean }; value: number };
    /** Full ASL: MF a routing unit pays on top of a step's cost to leave the entrenchment it stands beneath (ASLRB B27.41); 0 in the Starter Kit. */
    'rout.exitCost': { ctx: { unit: PieceId; from: HexId; to: HexId; /** The Location entered (full ASL: a pillbox). */ toLoc?: LocId }; value: number };
    /**
     * Full ASL: why a routing unit may not yet step out of the Location it stands in (ASLRB B26.41: on top of Wire it must
     * first make its Wire Exit dr), or null. Null in the Starter Kit.
     */
    'rout.stepFirst': { ctx: { unit: PieceId }; value: string | null };
    /**
     * Full ASL: whether a routing unit still has a rout expenditure open within its Location (ASLRB B26.41: the Wire Exit
     * dr), so its rout is not over, nor impossible, for want of a step. False in the Starter Kit.
     */
    'rout.inPlace': { ctx: { unit: PieceId }; value: boolean };
    /** Full ASL: MF a routing unit pays to take the stairs to Location `to` of its hex (ASLRB B23.4: one; A24.7 one more into a SMOKE Location). */
    'rout.stairsMf': { ctx: { unit: PieceId; to: LocId }; value: number };
    /**
     * Full ASL: hexes a rout need not move through (ASLRB B28.413, A10.51: a known minefield), so that the nearest shelters
     * round them are legal destinations as well as those through them. None in the Starter Kit.
     */
    'rout.avoid': { ctx: { unit: PieceId }; value: HexId[] };
    /**
     * Whether rout node `a` is beside (the same as, or ADJACENT to) the Known enemy at node `b`, for the rout rules: the
     * same or a neighbouring hex by default; full ASL a pillbox only through its Covered Arc and to its own hex (B30.2).
     */
    'rout.enemyNear': { ctx: { a: LocId; b: LocId }; value: boolean };
    /** The rout node a Known enemy unit at Location `loc` stands at: its hex by default; full ASL a pillbox is its own (B30.2). */
    'rout.enemyNode': { ctx: { loc: LocId }; value: LocId };
    /** Full ASL: a broken unit here is never forced to rout (ASLRB B30.5: inside a pillbox); false in the Starter Kit. */
    'rout.notForced': { ctx: { unit: PieceId }; value: boolean };
    /**
     * Full ASL: a rout may end at node `node` beside a Known enemy (ASLRB B30.5 over A10.5: inside a pillbox, Q&A [K33-ML] to
     * A10.5 and B30.5); false in the Starter Kit.
     */
    'rout.mayEndBeside': { ctx: { node: LocId }; value: boolean };
    /** Full ASL: nodes a rout may step to from `node` besides its ADJACENT ones (B30.41: straight into a pillbox of the next hex, or out of one into the next hex); none in the Starter Kit. */
    'rout.extraNeighbours': { ctx: { node: LocId; unit?: PieceId }; value: LocId[] };
    /** The MF to a shelter node that counts for "nearest" (full ASL A10.531: not a Fortification's entry cost); the MF spent by default. */
    'rout.nearestCost': { ctx: { unit: PieceId; node: LocId; cost: number }; value: number };
  }
}

export type RoutAction =
  /**
   * One hex of a rout. The first step may bring Good Order leaders along and may be a Low Crawl (the whole rout).
   * `woods`: into a Woods-Road hex along the road, but into its woods (woods MF, not out on the road; SK1 1.1.1).
   * `to` is the Location entered: a hex id at ground level; in full ASL it may be the level above or below in the
   * unit's own hex (the stairs) or the same floor of an adjacent hex of its building (see `stairStepCheck`).
   */
  | (Action & { type: 'rout.step'; unit: PieceId; to: LocId; lowCrawl?: boolean; leaders?: PieceId[]; woods?: boolean; beneath?: true })
  /** End the rout in a hex it may end in (a legal shelter) rather than going on into another shelter hex. */
  | (Action & { type: 'rout.stop'; unit: PieceId })
  /** A whole rout at once, kept for recordings made before routs were stepped hex by hex. */
  | (Action & { type: 'rout'; unit: PieceId; path: HexId[]; lowCrawl?: boolean; leaders?: PieceId[] })
  | (Action & { type: 'rout.stay'; unit: PieceId });

const ROUT = 'sk1.rout';
interface RoutState {
  side: SideId;
  /** Units that must rout this RtPh (eliminated at the end of their side's step if they don't). */
  mustRout: PieceId[];
  done: PieceId[];
  /** Leaders who have routed along with a broken unit this RtPh: they stay with it (SK1 3.6). */
  escorted?: PieceId[];
  /** The rout under way, stepped hex by hex. */
  active?: ActiveRout;
}

/** A rout in progress: the unit walks one hex per `rout.step`, Interdiction falling as it goes. */
export interface ActiveRout {
  unit: PieceId;
  /** Leaders who chose to go along at the start (SK1 3.6). */
  leaders: PieceId[];
  /** Those of them still walking with the unit (a failed Interdiction MC kills them). */
  escort: PieceId[];
  start: HexId;
  /** Hexes entered so far. */
  path: HexId[];
  spent: number;
  /** Enemy hexes in the LOS of any hex the unit has stood in: it may not close on them (SK1 3.6). */
  seen: HexId[];
  /** The nearest legal building/woods hexes, fixed when the rout began; any hex when none is reachable. */
  destinations: HexId[];
  /** Whether a building or woods hex was reachable at all. */
  sheltered: boolean;
  /** The unit has reached shelter outside its starting building (`arrives`): it may only go on into further shelter hexes. */
  reached: boolean;
}
const routState = (env: QueryEnv) => env.state.ext[ROUT] as RoutState | undefined;

/** Unbroken, unpinned enemy units capable of interdicting (SK1 3.6). */
function interdictors(env: QueryEnv, side: SideId, hex: HexId, from?: HexId): Piece[] {
  return knownEnemyUnits(env, side).filter((e) => env.query('rout.canInterdict', { interdictor: e.id, hex, ...(from ? { from } : {}) }, false));
}

/**
 * Would a broken unit of `side` entering `hex` (from `from`) be subject to Interdiction? `onRoad`: it
 * enters a Woods-Road hex along the road, and is out in the open there (SK1 1.1.1 Woods-Road) to an
 * enemy whose LOS does not cross a green woods symbol in the hex.
 */
export function interdicted(env: QueryEnv, side: SideId, hex: HexId, from?: HexId, onRoad = false): Piece[] {
  const open = env.query('hex.openGround', { hex }, false);
  if (!open && !onRoad) return [];
  return interdictors(env, side, hex, from).filter((e) => {
    // From the interdictor's Location (its height in full ASL). FFMO must hypothetically apply: no Hindrance.
    const eh = locOf(env.state, e)!;
    const los = env.query('los.trace', { from: eh, to: hex }, { clear: true, hindrance: 0, parts: [] });
    return los.clear && los.hindrance === 0 && (open || !los.woods?.includes(hex));
  });
}

/** May a rout step from `from` into `to` choose between the road and the woods of a Woods-Road hex (SK1 1.1.1)? */
const woodsRoadStep = (env: QueryEnv, from: HexId, to: LocId) => !to.includes(':') && !from.includes(':') && !statics(env).map.isHidden?.(from) && !statics(env).map.isHidden?.(to) && isWoodsRoad(env, to) && (statics(env).map.roadHexside?.(from, to) ?? false);

/**
 * One hex of a rout, as the log tells it: whether it was a Low Crawl, and whether it was open to Interdiction
 * ('checked', by the enemy units listed), or not because it was a Low Crawl, not Open Ground (nor a road routed
 * along), or no enemy could interdict it ('none').
 */
export interface RoutStep {
  unit: PieceId;
  to: HexId;
  lowCrawl: boolean;
  interdiction: 'checked' | 'lowCrawl' | 'notOpen' | 'none' | 'entrenched';
  by?: PieceId[];
  /** Where each interdicting unit stood (its Location), in the order of `by`: the log draws the LOS it interdicted along. */
  byFrom?: LocId[];
}

/** Why a broken unit must rout. */
export type RoutReason = { kind: 'adjacent' | 'openGround'; enemy: PieceId; hex: HexId };

/**
 * Must this broken unit rout (SK1 3.6)? Yes when it is adjacent to an unbroken Known Enemy Unit,
 * or in Open Ground where "a hypothetical unit routing through that hex would be subject to
 * Interdiction" (SK1 3.6 and its summary): in the Normal Range and unhindered LOS of a Good Order,
 * unpinned enemy able to fire on it with at least 1 FP, not CX or otherwise halved. A hindered LOS,
 * or an enemy that could not interdict, does not force it out (full ASL A10.5 is broader).
 */
export function routRequirement(env: QueryEnv, unit: Piece): RoutReason | null {
  const hex = nodeOf(env, unit);
  if (!hex || !isBroken(unit) || inMelee(env, locOf(env.state, unit))) return null;
  if (env.query('rout.notForced', { unit: unit.id }, false)) return null;
  const enemies = knownEnemyUnits(env, unit.side)
    .filter((e) => !isBroken(e))
    .sort(byId);
  for (const e of enemies) {
    const eh = enemyNode(env, e);
    if (enemyNear(env, hex, eh, eh === hex || nodeDistance(env, eh, hex) === 1) && hasLos(env, hex, eh)) return { kind: 'adjacent', enemy: e.id, hex: hexOfLoc(eh) };
  }
  if (!env.query('hex.openGround', { hex }, false)) return null;
  if (env.query('rout.exemptOpenGround', { unit: unit.id }, false)) return null;
  const e = interdicted(env, unit.side, hex).sort(byId)[0];
  return e ? { kind: 'openGround', enemy: e.id, hex: hexOf(env.state, e)! } : null;
}

export const mustRout = (env: QueryEnv, unit: Piece): boolean => routRequirement(env, unit) !== null;

/** The broken units of the side now routing, with whether each must rout and whether it is dealt with. */
export function pendingRouts(env: QueryEnv): { unit: PieceId; must: boolean; reason: RoutReason | null; done: boolean; cannot: RoutBar | null }[] {
  const st = routState(env);
  if (!st || env.state.phase !== 'RtPh') return [];
  return Object.values(env.state.pieces)
    .filter((p) => p.side === st.side && p.loc.kind === 'hex' && isBroken(p))
    .sort(byId)
    .map((p) => ({ unit: p.id, must: st.mustRout.includes(p.id), reason: st.mustRout.includes(p.id) ? routRequirement(env, p) : null, done: st.done.includes(p.id), cannot: routBarred(env, p) }));
}

/** Why a broken unit may not rout at all this RtPh: not under DM, or in Melee. */
export type RoutBar = 'noDm' | 'melee';
export const ROUT_BAR_TEXT: Record<RoutBar, string> = { noDm: 'Only broken units under DM may rout', melee: 'A unit in Melee cannot rout' };

/**
 * Why a broken unit may not rout at all this RtPh, or null: only a unit under DM routs (SK1 3.6; every unit that must
 * rout is marked DM as the phase begins), and none in Melee.
 */
function routBarred(env: QueryEnv, u: Piece): RoutBar | null {
  if (!hasDm(u)) return 'noDm';
  const start = locOf(env.state, u);
  if (!start || inMelee(env, start)) return 'melee';
  return null;
}

/** Units that must rout and have not yet (and are still on the map). */
const mustRoutPending = (env: QueryEnv): PieceId[] => {
  const st = routState(env);
  if (!st) return [];
  return st.mustRout.filter((id) => !st.done.includes(id) && env.state.pieces[id]?.loc.kind === 'hex');
};

/**
 * Units that must rout and still can: one left with no legal rout (another router filled the only
 * shelter it could reach, SK1 3.6 stacking) does not hold up the phase; ending it eliminates the unit
 * for failure to rout.
 */
const blockingRouts = (env: QueryEnv): PieceId[] => {
  const st = routState(env);
  return st ? mustRoutPending(env).filter((id) => stepOptions(env, st, id).length > 0) : [];
};

/** A rout under way that can still go on or stop (one that can do neither ends in failure to rout). */
const activeRoutBlocks = (env: QueryEnv): boolean => {
  const st = routState(env);
  const act = st?.active;
  if (!st || !act) return false;
  return stepOptions(env, st, act.unit).length > 0 || canStop(env, activeView(env, act));
};

const isShelter = (env: QueryEnv, hex: HexId) => !!terrainOf(env, hex).routShelter;

/**
 * Where a rout stands, as a node of its path: the hex, or a ground-level sub-Location of its own (a cave, or the hidden
 * Connection Location; S70 SSR 2). An upper building level stays with its hex (`RoutView.level`, the interim rule
 * below). In the Starter Kit every node is a hex id.
 */
const routNode = (loc: LocId): LocId => (levelOfLoc(loc) ? hexOfLoc(loc) : loc);
const nodeOf = (env: QueryEnv, p: Piece): LocId | null => {
  const l = locOf(env.state, p);
  return l === null ? null : routNode(l);
};
/** A node that is not simply a map hex: a sub-Location or a hidden hex (they go by `'loc.adjacent'` alone). */
const special = (env: QueryEnv, node: LocId) => !!parseLoc(node).sub || !!statics(env).map.isHidden?.(hexOfLoc(node));
/**
 * Whether any hex of the map has a sub-Location (a cave), judged once per game (`statics`): a rout planner visits
 * hundreds of hexes, and a Starter Kit map never has one, so it need not ask each hex's adjacency. A sub-Location only
 * ever goes away (a cave eliminated), so "may have" stays true.
 */
const subLocMaps = new WeakMap<object, boolean>();
const mayHaveSubLocs = (env: QueryEnv): boolean => {
  const key = env.statics as object;
  let v = subLocMaps.get(key);
  if (v === undefined) {
    v = [...statics(env).map.hexes()].some((h) => locationsOf(env, h.id).some((l) => !!parseLoc(l).sub));
    subLocMaps.set(key, v);
  }
  return v;
};
/** The nodes a rout may step to next: the neighbouring hexes, plus any ground-level sub-Location ADJACENT (a cave). */
const routNeighbours = (env: QueryEnv, node: LocId): LocId[] =>
  special(env, node)
    ? [...adjacentLocs(env, node).filter((n) => !levelOfLoc(n)), ...env.query('rout.extraNeighbours', { node }, [])]
    : mayHaveSubLocs(env)
      ? [...statics(env).map.neighbors(node), ...adjacentLocs(env, node).filter((n) => parseLoc(n).sub && !levelOfLoc(n)), ...env.query('rout.extraNeighbours', { node }, [])]
      : statics(env).map.neighbors(node);
const nodeDistance = (env: QueryEnv, a: LocId, b: LocId) => statics(env).map.distance(hexOfLoc(a), hexOfLoc(b));
/** Whether node `a` is beside the Known enemy at node `b` by the rout rules: `dflt` (the hexes), unless a rule says otherwise (full ASL: a pillbox through its CA). */
const enemyNear = (env: QueryEnv, a: LocId, b: LocId, dflt: boolean) => env.query('rout.enemyNear', { a, b }, dflt);
/** The rout node of a Known enemy unit: its hex, unless a rule makes its Location one of its own (full ASL: a pillbox). */
const enemyNode = (env: QueryEnv, e: Piece): LocId => env.query('rout.enemyNode', { loc: locOf(env.state, e)! }, hexOf(env.state, e)!);

/** The rout nodes Known enemy units stand at (their hexes in the Starter Kit; full ASL a pillbox is its own node). */
const enemyHexes = (env: QueryEnv, side: SideId) =>
  [...new Set(knownEnemyUnits(env, side).map((e) => enemyNode(env, e)))].sort();

/** Enemy hexes in LOS of the given hex (known enemy locations). */
const knownEnemyHexes = (env: QueryEnv, side: SideId, hex: HexId) => enemyHexes(env, side).filter((eh) => hasLos(env, hex, eh));

/**
 * Is `hex` another hex of the building the rout started in? Such a hex is the nearest building hex and a
 * legal end to the rout, but the unit "may always rout out of a building in which it begins its RtPh"
 * (SK1 3.6; ASLRB A10.51 EXC: it "need not consider" that hex as its closest, "even if it must cross Open
 * Ground or another building hex of the same building"), so passing through one never pins the rout to shelter.
 */
function inStartBuilding(env: QueryEnv, start: HexId, hex: HexId): boolean {
  const map = statics(env).map;
  if (special(env, start) || special(env, hex)) return false;
  const b = map.hex(start)?.buildingId;
  return !!b && map.hex(hex)?.buildingId === b;
}

/** A shelter hex a rout may not end in: beside an enemy unit (SK1 3.6 "not adjacent to an enemy unit"). */
const enemyAdjacent = (env: QueryEnv, side: SideId, hex: HexId) => !env.query('rout.mayEndBeside', { node: hex }, false) && enemyHexes(env, side).some((eh) => enemyNear(env, hex, eh, nodeDistance(env, eh, hex) <= 1));

const routStepCost = (env: QueryEnv, unit: PieceId, from: LocId, to: LocId, woods = false) =>
  special(env, from) || special(env, to)
    ? env.query('move.cost', { unit, from: hexOfLoc(from), to: hexOfLoc(to), viaRoad: false, ...(parseLoc(to).sub ? { loc: to } : {}) }, 1)
    : env.query('move.cost', { unit, from, to, viaRoad: !woods && (statics(env).map.roadHexside?.(from, to) ?? false) }, 1);

/**
 * A step's cost: beneath the entrenchment of the hex entered (full ASL, ASLRB B27.41: the module's whole cost, or its
 * refusal), else the terrain's, plus what leaving the entrenchment the unit stands beneath costs (B27.41: combined with
 * the next hex in the RtPh). Neither in-hex cost counts toward the nearest shelter (A10.5), so `planRout` never sees them.
 */
function beneathOrStepCost(env: QueryEnv, unit: PieceId, from: HexId, toLoc: LocId, woods: boolean, beneath: boolean): number | string {
  if (beneath) {
    const b = env.query('rout.beneath', { unit, from, to: toLoc }, null);
    if (b === null) return 'No entrenchment to rout beneath there';
    if (typeof b === 'string') return b;
    return b.cost;
  }
  return routStepCost(env, unit, from, routNode(toLoc), woods) + env.query('rout.exitCost', { unit, from, to: hexOfLoc(toLoc), toLoc }, 0);
}

/** Is a single rout step legal given enemies already seen during this rout? */
function stepIllegal(env: QueryEnv, side: SideId, from: HexId, toLoc: LocId, seen: Set<HexId>, unit: PieceId): string | null {
  const map = statics(env).map;
  const to = hexOfLoc(toLoc);
  if (special(env, from) || special(env, toLoc) ? !routNeighbours(env, from).includes(toLoc) : !map.neighbors(from).includes(to)) return 'Rout must move to adjacent hexes';
  const caves = env.query('rout.stepIllegal', { unit, from, to: toLoc }, null);
  if (caves) return caves;
  // A Location holding only a concealed enemy stack may be *attempted* (SK4 8.3.4: the "?" comes off and the rout ends there).
  if (knownEnemyAt(env, toLoc, side).length > 0) return 'Cannot rout into an enemy-occupied hex';
  // SK1 3.6: a routing unit ignores any building or woods hex "it cannot enter due to stacking limits"
  // (three squad-equivalents and four SMC per side, SK1 2.0; per Location, ASLRB A5.1).
  const here = personnelAt(env, toLoc, side).filter((p) => p.id !== unit);
  const all = [...here, pieceOf(env, unit)];
  const limit = stackLimit(env, special(env, toLoc) ? toLoc : to, side);
  if (squadEquivalents(env, all) > limit.se) return `Stacking limit: ${limit.se} squad-equivalents${limit.note ? ` (${limit.note})` : ''}`;
  if (all.filter((p) => smc(env, p)).length > 4) return 'Stacking limit: 4 SMC';
  for (const eh of enemyHexes(env, side)) {
    const watching = seen.has(eh) || hasLos(env, from, eh);
    if (watching && nodeDistance(env, to, eh) < nodeDistance(env, from, eh)) return `Cannot rout toward the enemy in ${hexLabel(hexOfLoc(eh))} (SK1 3.6: no step that shortens the range to a Known enemy unit in its LOS, even a broken one)`;
    if (enemyNear(env, from, eh, nodeDistance(env, from, eh) === 1) && enemyNear(env, routNode(toLoc), eh, nodeDistance(env, to, eh) === 1)) return `Cannot rout from one hex adjacent to ${hexLabel(hexOfLoc(eh))} to another`;
  }
  return null;
}

interface RoutPlan {
  cost: Map<HexId, number>;
  /** The hexes the rout must make for: the nearest legal shelters (or any reachable hex when none is). */
  destinations: Set<HexId>;
  /** Hexes on a shortest path toward a destination (for Low Crawl). */
  onTheWay: Set<HexId>;
  /** Whether any building or woods hex can be reached this RtPh. */
  sheltered: boolean;
  /** Full ASL: destinations reached only through a hex the rout need not move through (`rout.avoid`, a known minefield). */
  viaAvoided?: Set<HexId>;
}

/**
 * Plan where a rout must go (SK1 3.6): the nearest (in MF) building or woods hexes not beside an enemy.
 * A shelter no farther from a Known Enemy Unit than the start, or another hex of the building the unit
 * starts in, may be ignored in favour of the next nearest; any reachable hex when no shelter is within
 * 6 MF. Path-dependent LOS is approximated by the starting hex's view. Once there the unit may go on
 * into adjacent shelter hexes (see `canStop`).
 */
export function planRout(env: QueryEnv, unitId: PieceId): RoutPlan {
  // Full ASL: a router need not move through a known minefield and may take a longer route to a shelter instead (ASLRB
  // B28.413), but may rout into, out of or within one at its option (A10.51): the shelters nearest without those hexes
  // and the shelters nearest through them are both legal destinations. The Starter Kit avoids nothing.
  const avoid = env.query('rout.avoid', { unit: unitId }, []);
  const plan = planRoutAvoiding(env, unitId, new Set());
  if (!avoid.length) return plan;
  const round = planRoutAvoiding(env, unitId, new Set(avoid));
  const cost = new Map(plan.cost);
  for (const [h, c] of round.cost) if (!cost.has(h) || c < cost.get(h)!) cost.set(h, c);
  return {
    cost,
    destinations: new Set([...plan.destinations, ...round.destinations]),
    onTheWay: new Set([...plan.onTheWay, ...round.onTheWay]),
    sheltered: plan.sheltered || round.sheltered,
    viaAvoided: new Set([...plan.destinations].filter((h) => !round.destinations.has(h))),
  };
}

function planRoutAvoiding(env: QueryEnv, unitId: PieceId, avoid: Set<HexId>): RoutPlan {
  const unit = pieceOf(env, unitId);
  const start = nodeOf(env, unit)!;
  const side = unit.side;
  const mf = env.query('rout.mf', { unit: unitId }, 6);
  const seen = new Set(knownEnemyHexes(env, side, start));
  // A unit on an upper level comes down the stairs before it leaves the hex (full ASL; TODO(ASLRB A10.51): rout by Location).
  const cost = new Map<HexId, number>([[start, levelOfLoc(locOf(env.state, unit)!) ? LEVEL_CHANGE_MF : 0]]);
  const prev = new Map<HexId, HexId[]>();
  const queue: HexId[] = [start];
  while (queue.length) {
    queue.sort((a, b) => cost.get(a)! - cost.get(b)! || (a < b ? -1 : 1));
    const h = queue.shift()!;
    const c = cost.get(h)!;
    for (const n of routNeighbours(env, h).sort()) {
      if (avoid.has(hexOfLoc(n))) continue;
      if (stepIllegal(env, side, h, n, seen, unitId)) continue;
      const nc = c + routStepCost(env, unitId, h, n) + env.query('rout.planLeaveMf', { unit: unitId, hex: h, start: h === start }, 0);
      if (nc > mf) continue;
      const old = cost.get(n);
      if (old === undefined || nc < old) {
        cost.set(n, nc);
        prev.set(n, [h]);
        queue.push(n);
      } else if (nc === old) {
        prev.get(n)!.push(h);
      }
    }
  }
  const shelters = [...cost.keys()].filter((h) => h !== start && isShelter(env, h) && !enemyAdjacent(env, side, h));
  // "No further away from a Known Enemy Unit than its starting hex" (SK1 3.6): from any one of them. A shelter must be
  // made for only when it takes the unit farther from them all (ASLRB A10.51 examples: "no farther away from a Known
  // enemy unit than its present position"; "farther away from all KEUs").
  const ignorable = (h: HexId) => inStartBuilding(env, start, h) || seen.size === 0 || [...seen].some((e) => nodeDistance(env, h, e) <= nodeDistance(env, start, e));
  const destinations = new Set<HexId>();
  if (shelters.length === 0) {
    for (const h of cost.keys()) if (h !== start) destinations.add(h);
  } else {
    // "Nearest" by the MF that count for it (full ASL A10.531: not a Fortification's entry cost).
    const near = (h: HexId) => env.query('rout.nearestCost', { unit: unitId, node: h, cost: cost.get(h)! }, cost.get(h)!);
    const sorted = [...shelters].sort((a, b) => near(a) - near(b));
    for (const h of sorted) {
      // Legal if every strictly nearer shelter could be ignored.
      const nearer = sorted.filter((s) => near(s) < near(h));
      if (nearer.every(ignorable)) destinations.add(h);
    }
  }
  const onTheWay = new Set<HexId>();
  const walk = (h: HexId) => {
    if (onTheWay.has(h) || h === start) return;
    onTheWay.add(h);
    for (const p of prev.get(h) ?? []) walk(p);
  };
  for (const d of destinations) walk(d);
  return { cost, destinations, onTheWay, sheltered: shelters.length > 0 };
}

/** Where a rout stands, for judging its next step: fresh from the unit's hex, or as far as it has gone. */
interface RoutView {
  unit: PieceId;
  side: SideId;
  mf: number;
  start: HexId;
  at: HexId;
  /** The building level the unit is on in `at` (full ASL); 0 at ground level. */
  level: number;
  spent: number;
  seen: Set<HexId>;
  reached: boolean;
  /** The plan; `cost` (MF from the start) only before the first step. */
  plan: Pick<RoutPlan, 'destinations' | 'onTheWay' | 'sheltered'> & Partial<Pick<RoutPlan, 'cost'>>;
}

/** The MF of a rout: the unit's, or less when an escorting leader has fewer of his own (`rout.escortMf`). */
function stackMf(env: QueryEnv, unitId: PieceId, escort: PieceId[]): number {
  const own = env.query('rout.mf', { unit: unitId }, 6);
  return Math.min(own, ...escort.map((l) => env.query('rout.escortMf', { leader: l }, null) ?? own));
}

function freshView(env: QueryEnv, unitId: PieceId, leaders: PieceId[] = []): RoutView {
  const u = pieceOf(env, unitId);
  const start = nodeOf(env, u)!;
  return { unit: unitId, side: u.side, mf: stackMf(env, unitId, leaders), start, at: start, level: levelOfLoc(locOf(env.state, u)!), spent: 0, seen: new Set(), reached: false, plan: planRout(env, unitId) };
}

function activeView(env: QueryEnv, act: ActiveRout): RoutView {
  const u = pieceOf(env, act.unit);
  return {
    unit: act.unit,
    side: u.side,
    mf: stackMf(env, act.unit, act.escort),
    start: act.start,
    at: nodeOf(env, u)!,
    level: levelOfLoc(locOf(env.state, u)!),
    spent: act.spent,
    seen: new Set(act.seen),
    reached: act.reached,
    plan: { destinations: new Set(act.destinations), onTheWay: new Set(), sheltered: act.sheltered },
  };
}

/** The view after stepping into `to` (no legality check). */
function afterStep(env: QueryEnv, v: RoutView, toLoc: LocId, cost: number): RoutView {
  const to = routNode(toLoc);
  return {
    ...v,
    at: to,
    level: levelOfLoc(toLoc),
    spent: v.spent + cost,
    seen: new Set([...v.seen, ...knownEnemyHexes(env, v.side, v.at)]),
    reached: v.reached || arrives(env, v, v.at, to),
  };
}

/**
 * Does the step from `from` into `to` bring the rout to shelter, after which it may go on only into further building or
 * woods hexes (`canStop`)? Entering one of its destinations outside the starting building does. So does leaving another
 * hex of the starting building (not beside an enemy) for a building or woods hex of something else: that hex was a legal
 * end the unit was free not to ignore (SK1 3.6 "may ignore any building hex that is part of a building it is already
 * in"), and from it the unit "can immediately enter another building or woods hex". A step from the starting building
 * into Open Ground leaves the rout free to head for its destinations.
 */
function arrives(env: QueryEnv, v: RoutView, from: HexId, to: HexId): boolean {
  if (!v.plan.sheltered || inStartBuilding(env, v.start, to)) return false;
  if (v.plan.destinations.has(to)) return true;
  return from !== v.start && inStartBuilding(env, v.start, from) && !enemyAdjacent(env, v.side, from) && isShelter(env, to);
}

/**
 * May the rout end here? In one of its destinations, or (having reached one) in a further building or
 * woods hex not beside an enemy: "must stop ... unless the unit can immediately enter another building
 * or woods hex" (SK1 3.6).
 */
function canStop(env: QueryEnv, v: RoutView): boolean {
  if (v.at === v.start) return false;
  if (v.plan.destinations.has(v.at)) return true;
  return v.reached && isShelter(env, v.at) && !enemyAdjacent(env, v.side, v.at);
}

/** Could the rout still end legally somewhere from here with the MF left? */
const finishReachable = (env: QueryEnv, v: RoutView): boolean => reachableEnds(env, v, true).size > 0;

/**
 * The hexes the rout can still end in from where it stands, by legal steps with the MF left (`first`: stop at
 * the first found). The destinations fixed at the start may have closed: a step that brings a Known enemy unit
 * into view bars routing toward it, and ASLRB A10.51 then has the destination "re-figured from that point".
 */
function reachableEnds(env: QueryEnv, v: RoutView, first = false): Set<HexId> {
  const ends = new Set<HexId>();
  if (canStop(env, v)) {
    ends.add(v.at);
    if (first) return ends;
  }
  const seen = new Set([...v.seen, ...knownEnemyHexes(env, v.side, v.at)]);
  const key = (h: HexId, reached: boolean) => `${h}:${reached ? 1 : 0}`;
  // From an upper level the stairs come first (full ASL; TODO(ASLRB A10.51): paths along an upper floor).
  const c0 = v.spent + (v.level ? LEVEL_CHANGE_MF : 0);
  const best = new Map<string, number>([[key(v.at, v.reached), c0]]);
  const queue: { h: HexId; reached: boolean; c: number }[] = [{ h: v.at, reached: v.reached, c: c0 }];
  while (queue.length) {
    queue.sort((a, b) => a.c - b.c || (a.h < b.h ? -1 : 1));
    const { h, reached, c } = queue.shift()!;
    for (const n of routNeighbours(env, h).sort()) {
      if (reached && !isShelter(env, n)) continue;
      if (stepIllegal(env, v.side, h, n, seen, v.unit)) continue;
      const nc = c + routStepCost(env, v.unit, h, n);
      if (nc > v.mf) continue;
      const nr = reached || arrives(env, v, h, n);
      if (canStop(env, { ...v, at: n, reached: nr })) {
        ends.add(n);
        if (first) return ends;
      }
      const k = key(n, nr);
      if (best.has(k) && best.get(k)! <= nc) continue;
      best.set(k, nc);
      queue.push({ h: n, reached: nr, c: nc });
    }
  }
  return ends;
}

/**
 * Where the rout under way can still end (the board's ROUT END hexes), or null when none is under way or it
 * had no building or woods in reach (then it may end anywhere away from the enemy, SK1 3.6).
 */
export function activeRoutEnds(env: QueryEnv): Set<HexId> | null {
  const act = activeRout(env);
  if (!act?.sheltered || !env.state.pieces[act.unit]) return null;
  return reachableEnds(env, activeView(env, act));
}

/** Why the rout may not step into `to` next (null when it may). */
function stepCheck(env: QueryEnv, v: RoutView, toLoc: LocId, lowCrawl: boolean, woods = false, beneath = false): string | null {
  // A pinned broken unit cannot rout (SK4 8.2.1: a hut collapsing pins even a broken unit, "unable to rout").
  if (isPinned(pieceOf(env, v.unit))) return 'A pinned unit cannot rout';
  // Full ASL: from where it stands the unit may first have to get free (ASLRB B26.41: off the Wire).
  if (v.at === nodeOf(env, pieceOf(env, v.unit))) {
    const first = env.query('rout.stepFirst', { unit: v.unit }, null);
    if (first) return first;
  }
  const to = routNode(toLoc);
  if (to === v.at) return stairStepCheck(env, v, toLoc, lowCrawl, woods);
  // Full ASL: an upper level is left only by the stairs or along the same floor of the building (ASLRB B23.25), and
  // a rout never climbs into another hex (only by the stairs of the hex it stands in).
  if ((v.level || levelOfLoc(toLoc)) && !adjacentLocs(env, locId(v.at, v.level)).includes(toLoc)) {
    return 'From an upper level a rout takes the stairs or keeps to its floor of the building (ASLRB B23.25)';
  }
  const seen = new Set([...v.seen, ...knownEnemyHexes(env, v.side, v.at)]);
  const err = stepIllegal(env, v.side, v.at, toLoc, seen, v.unit);
  if (err) return err;
  if (woods && (lowCrawl || !woodsRoadStep(env, v.at, to))) return 'Only a Woods-Road hex entered along the road offers its woods';
  if (lowCrawl) {
    if (v.spent > 0) return 'Low Crawl is a rout of exactly one hex';
    if (!v.plan.onTheWay.has(to) && !v.plan.destinations.has(to)) return headingRefusal(env, v, to, 'Low Crawl must head toward the nearest building or woods');
    return null;
  }
  const cost = beneathOrStepCost(env, v.unit, v.at, toLoc, woods, beneath);
  if (typeof cost === 'string') return cost;
  if (v.spent + cost > v.mf) return `Not enough MF (${v.mf}) for that rout path`;
  if (v.reached && !isShelter(env, to)) return `Rout must stop in ${v.at}`;
  if (!finishReachable(env, afterStep(env, v, toLoc, cost))) return headingRefusal(env, v, to, 'Rout must head for the nearest legal building or woods hex');
  return null;
}

/**
 * A refusal for a step that does not lead to the rout's nearest building or woods, saying why when the cause is a Known
 * enemy unit the step would bring into view: from there, entering the shelter would shorten the range to it, which SK1
 * 3.6 forbids "even if it is broken" (without it a Low Crawl is refused with no reason given). Otherwise it
 * names the shelter and the first step that does lead there.
 */
function headingRefusal(env: QueryEnv, v: RoutView, to: LocId, base: string): string {
  const dests = [...v.plan.destinations].filter((d) => d !== v.at).sort();
  if (dests.length === 0) return base;
  const names = dests.map(hexLabel).join(' or ');
  const seen = new Set([...v.seen, ...knownEnemyHexes(env, v.side, v.at)]);
  const firstSteps = routNeighbours(env, v.at).filter((n) => v.plan.onTheWay.has(n) || v.plan.destinations.has(n)).sort();
  const via = firstSteps.length && !firstSteps.some((h) => dests.includes(h)) ? `; the way there is through ${firstSteps.map(hexLabel).join(' or ')}` : '';
  // A shelter next door can be farther in MF than one two hexes off (a building uphill: COT doubled, SK4 1.1.1), and
  // "nearest" is in MF (SK1 3.6): give both costs, or the refusal reads as wrong.
  const cost = v.plan.cost;
  const toMf = cost?.get(to);
  const destMf = Math.min(...dests.map((d) => cost?.get(d) ?? Infinity));
  if (toMf !== undefined && destMf < toMf && isShelter(env, to) && !enemyAdjacent(env, v.side, to)) {
    return `${base} (${names}): ${hexLabel(to)} is a building or woods hex too, but ${toMf} MF away against ${destMf} for ${names} (SK1 3.6: nearest in MF)${via}`;
  }
  for (const e of knownEnemyUnits(env, v.side).sort(byId)) {
    const eh = hexOf(env.state, e);
    if (!eh || seen.has(eh) || !hasLos(env, to, eh)) continue;
    if (!dests.some((d) => nodeDistance(env, d, eh) < nodeDistance(env, to, eh))) continue;
    return `${base}: from ${hexLabel(to)} the ${pieceLabel(env, e)} in ${hexLabel(eh)} would be in its LOS, and ${names} is closer to it (SK1 3.6: no rout toward a Known enemy unit in its LOS, even a broken one)${via}`;
  }
  return `${base} (${names})${via}`;
}

/**
 * A refusal to end the rout where it stands, naming where it may still end; in a building or woods hex, saying that
 * this one is not it: the rout ends in the nearest building or woods hex in MF not adjacent to an enemy unit, unless
 * that one is no farther from a Known enemy unit than the start (SK1 3.6).
 */
function stopRefusal(env: QueryEnv, v: RoutView, base: string): string {
  const reachable = [...reachableEnds(env, v)].filter((h) => h !== v.at).sort();
  if (reachable.length === 0) return base;
  // The shelters it set out for, while it can still reach them; past them it may go on into the next (see `canStop`).
  const planned = reachable.filter((h) => v.plan.destinations.has(h));
  const ends = planned.length ? planned : reachable;
  const here = isShelter(env, v.at)
    ? `; ${hexLabel(v.at)} is not it (SK1 3.6: the nearest in MF and not adjacent to an enemy unit, unless that one is no farther from a Known enemy unit than the start)`
    : '';
  return `${base} (${ends.map(hexLabel).join(' or ')})${here}`;
}

/**
 * INTERIM RULE (full ASL only; TODO(ASLRB A10.51): replace with rout by Location). A routing unit may use the
 * stairs of a building hex for one MF (ASLRB B23.4; A10.51 EX routs a unit upstairs), but where it must go is still
 * decided by hex per SK1 3.6: it comes down to leave its hex, and it may climb only in a hex it may end its rout in,
 * as its last step. Starter Kit hexes have one Location, so this never applies there.
 */
/** The MF of a rout up or down the stairs of its hex to `toLoc` (full ASL; the Starter Kit has no levels). */
const stairsMf = (env: QueryEnv, unit: PieceId, toLoc: LocId): number => env.query('rout.stairsMf', { unit, to: toLoc }, LEVEL_CHANGE_MF);

function stairStepCheck(env: QueryEnv, v: RoutView, toLoc: LocId, lowCrawl: boolean, woods: boolean): string | null {
  if (!adjacentLocs(env, locId(v.at, v.level)).includes(toLoc)) return 'There are no stairs to that level here';
  if (lowCrawl || woods) return 'Low Crawl and Woods-Road choices do not apply on the stairs';
  if (knownEnemyAt(env, toLoc, v.side).length > 0) return 'Cannot rout into an enemy-occupied Location';
  const here = personnelAt(env, toLoc, v.side).filter((p) => p.id !== v.unit);
  const all = [...here, pieceOf(env, v.unit)];
  if (squadEquivalents(env, all) > 3) return 'Stacking limit: 3 squad-equivalents';
  if (all.filter((p) => smc(env, p)).length > 4) return 'Stacking limit: 4 SMC';
  const mf = stairsMf(env, v.unit, toLoc);
  if (v.spent + mf > v.mf) return `Not enough MF (${v.mf}) for that rout path`;
  if (levelOfLoc(toLoc) > v.level) {
    if (!canStop(env, v)) return 'A routing unit may go upstairs only in a hex where its rout may end (SK1 3.6 destination; interim rule)';
    return null;
  }
  if (!finishReachable(env, afterStep(env, v, toLoc, mf))) return 'Rout must head for the nearest legal building or woods hex';
  return null;
}

/** Leaders stacked with a broken unit who may elect to rout along with it (SK1 3.6). */
export function routEscorts(env: QueryEnv, unit: PieceId): PieceId[] {
  const st = routState(env);
  const u = env.state.pieces[unit];
  // A leader stacked with it: in its Location (ASLRB A2.8).
  const loc = u && locOf(env.state, u);
  if (!st || !u || !loc) return [];
  return Object.values(env.state.pieces)
    .filter((p) => p.side === u.side && p.id !== unit && !!smc(env, p) && locOf(env.state, p) === loc && !isBroken(p) && !isPinned(p) && !st.escorted?.includes(p.id))
    .filter((p) => env.query('rout.escortIllegal', { leader: p.id }, null) === null)
    .sort(byId)
    .map((p) => p.id);
}

/** The rout under way, if any. */
export const activeRout = (env: QueryEnv): ActiveRout | undefined => routState(env)?.active;

/** MF a routing unit has left (its whole allotment before it starts, with these `leaders` routing along). */
export function routMfLeft(env: QueryEnv, unit: PieceId, leaders: PieceId[] = []): number {
  const act = activeRout(env);
  return act?.unit === unit ? stackMf(env, unit, act.escort) - act.spent : stackMf(env, unit, leaders);
}

/** Why `unit` may not begin a rout now (with these leaders), or null. */
function startIllegal(env: QueryEnv, st: RoutState, a: { unit: PieceId; side: SideId; leaders?: PieceId[] }): string | null {
  const u = env.state.pieces[a.unit];
  if (!u || u.side !== st.side || u.side !== a.side) return 'Not your unit to rout';
  if (st.active) return st.active.unit === a.unit ? 'The unit is already routing' : `${st.active.unit} has not finished routing`;
  if (st.done.includes(a.unit)) return 'Unit already routed';
  if (!isBroken(u)) return 'Only broken units under DM may rout';
  const barred = routBarred(env, u);
  if (barred) return ROUT_BAR_TEXT[barred];
  const start = locOf(env.state, u)!;
  // SK1 3.6: an unpinned, unbroken leader already stacked with the unit (in its Location) may rout with it, once.
  for (const l of a.leaders ?? []) {
    const lp = env.state.pieces[l];
    if (!lp || !smc(env, lp) || lp.side !== a.side || locOf(env.state, lp) !== start || isBroken(lp) || isPinned(lp)) {
      return `${l} cannot rout with the unit`;
    }
    if (st.escorted?.includes(l)) return `${l} has already routed with a unit this phase`;
    const own = env.query('rout.escortIllegal', { leader: l }, null);
    if (own) return own;
  }
  if (new Set(a.leaders ?? []).size !== (a.leaders ?? []).length) return 'A leader is listed twice';
  return null;
}

function stepActionIllegal(env: QueryEnv, a: RoutAction & { type: 'rout.step' }): string | null {
  if (env.state.phase !== 'RtPh') return 'Not the Rout Phase';
  const st = routState(env);
  if (!st) return 'Not the Rout Phase';
  const act = st.active;
  if (act?.unit === a.unit) {
    if (a.lowCrawl) return 'Low Crawl is a rout of exactly one hex';
    if (a.leaders?.length) return 'Leaders join a rout at its first hex';
    const u = env.state.pieces[a.unit];
    if (!u || u.side !== a.side) return 'Not your unit to rout';
    return stepCheck(env, activeView(env, act), a.to, false, !!a.woods, !!a.beneath);
  }
  const err = startIllegal(env, st, a);
  if (err) return err;
  return stepCheck(env, freshView(env, a.unit, a.leaders ?? []), a.to, !!a.lowCrawl, !!a.woods, !!a.beneath);
}

/** Legal next steps for a unit: fresh (normal and Low Crawl) or continuing its rout. */
function stepOptions(env: QueryEnv, st: RoutState, unitId: PieceId): Omit<RoutAction & { type: 'rout.step' }, 'side' | 'decisionId'>[] {
  const out: Omit<RoutAction & { type: 'rout.step' }, 'side' | 'decisionId'>[] = [];
  const act = st.active;
  if (act && act.unit !== unitId) return out;
  const v = act ? activeView(env, act) : freshView(env, unitId);
  // The neighbouring hexes, then (full ASL) the other levels of the unit's own hex (none in the Starter Kit) and, from
  // an upper level, the same floor of adjacent hexes of its building.
  const here = locId(v.at, v.level);
  const cands = v.level
    ? adjacentLocs(env, here).sort()
    : [...routNeighbours(env, v.at).sort(), ...(special(env, v.at) ? [] : locationsOf(env, v.at).filter((l) => l !== here && !parseLoc(l).sub))];
  for (const n of cands) {
    if (!stepCheck(env, v, n, false)) out.push({ type: 'rout.step', unit: unitId, to: n });
    if (woodsRoadStep(env, v.at, n) && !stepCheck(env, v, n, false, true)) out.push({ type: 'rout.step', unit: unitId, to: n, woods: true });
    if (!act && !stepCheck(env, v, n, true)) out.push({ type: 'rout.step', unit: unitId, to: n, lowCrawl: true });
    // Full ASL: straight beneath the entrenchment of the hex entered (ASLRB B27.41), where a module offers it.
    if (env.query('rout.beneath', { unit: unitId, from: v.at, to: n }, null) !== null && !stepCheck(env, v, n, false, false, true)) out.push({ type: 'rout.step', unit: unitId, to: n, beneath: true });
  }
  return out;
}

/** Validate a whole-path rout (older recordings): the steps in turn, then a legal end. */
function routIllegal(env: QueryEnv, a: RoutAction & { type: 'rout' }): string | null {
  if (env.state.phase !== 'RtPh') return 'Not the Rout Phase';
  const st = routState(env);
  if (!st) return 'Not the Rout Phase';
  const err = startIllegal(env, st, a);
  if (err) return err;
  if (a.path.length === 0) return 'Empty rout path';
  if (a.lowCrawl && a.path.length !== 1) return 'Low Crawl is a rout of exactly one hex';
  let v = freshView(env, a.unit);
  for (const h of a.path) {
    const e = stepCheck(env, v, h, !!a.lowCrawl);
    if (e) return e;
    v = afterStep(env, v, h, a.lowCrawl ? v.mf : routStepCost(env, a.unit, v.at, h));
  }
  if (!a.lowCrawl && !canStop(env, v)) return stopRefusal(env, v, 'Rout must end in the nearest legal building or woods hex');
  return null;
}

export const routModule: RuleModule = {
  id: 'sk1.rout',
  ref: 'SK1 3.6',
  summary: 'Rout Phase: mandatory rout, nearest building/woods, Low Crawl, Interdiction, failure to rout.',
  requires: ['sk1.morale', 'sk1.terrain', 'common.turn'],
  install(r) {
    r.procedure<RoutStartSideFn>(ROUT_START_SIDE, () => (ctx, side) => startSide(ctx, side));
    r.procedure<RoutEnterFn>(ROUT_ENTER, () => () => true);
    r.procedure<RoutEnteredFn>(ROUT_ENTERED, () => () => {});
    r.procedure<RoutEndHereFn>(ROUT_END_HERE, () => (ctx, unit) => {
      const act = routState(ctx)?.active;
      if (act?.unit !== unit) return;
      finishRout(ctx, act, ctx.state.pieces[unit]?.loc.kind === 'hex');
      reAsk(ctx);
    });
    r.event<{ state: RoutState | null; step?: RoutStep }>({
      type: 'sk1.rout.state',
      apply(d, p) {
        if (p.state) d.ext[ROUT] = p.state;
        else delete d.ext[ROUT];
      },
    });

    r.contribute({
      id: 'sk1.rout.mf',
      query: 'rout.mf',
      layer: 0,
      apply: (_v, { unit }, env) => {
        const p = pieceOf(env, unit);
        return smc(env, p) && wounds(p) > 0 ? 3 : 6;
      },
    });
    r.contribute({
      id: 'sk1.rout.interdictor',
      query: 'rout.canInterdict',
      layer: 0,
      apply(_v, { interdictor, hex }, env) {
        const e = pieceOf(env, interdictor);
        const eh = hexOf(env.state, e);
        if (!eh || isBroken(e) || isPinned(e) || !isGoodOrder(env, e) || isCx(e)) return false;
        const dist = statics(env).map.distance(eh, hex);
        const m = mmc(env, e);
        // Any FP within normal range, with no halving or positive DRM, "even if they have exhausted all other fire
        // options for that Player Turn" (SK1 3.6): a crew or HS that fired a weapon still interdicts with its own FP.
        if (m && m.fp >= 1 && m.range >= dist) return true;
        // SW only: Guns interdict by their own rule (sk2.guns).
        const sws = swHeldBy(env.state, e.id).filter((s) => !s.tags[T.malf] && !!sw(env, s) && sw(env, s)?.type !== 'DC');
        if (!m) {
          // A lone SMC firing a MG is Area Fire → cannot interdict.
          return sws.some((s) => sw(env, s)!.type === 'FT' && sw(env, s)!.range >= dist);
        }
        return sws.some((s) => sw(env, s)!.range >= dist);
      },
    });

    // The phase cannot be ended while a unit that must rout has not been dealt with, or one is mid-rout.
    r.contribute({
      id: 'sk1.rout.end-blocked',
      query: 'phase.endBlocked',
      when: (_c, env) => env.state.phase === 'RtPh',
      apply: (value, _c, env) => {
        // Each legality search can traverse the rout graph. Compute it once and
        // preserve any earlier restriction when no rout blocks the phase.
        if (activeRoutBlocks(env)) return `${routState(env)!.active!.unit} has not finished routing`;
        // Named (the interface turns ids into "unit in hex"), so a player sees which units hold the phase up.
        const units = blockingRouts(env);
        return units.length ? `${units.length} unit${units.length === 1 ? '' : 's'} must rout first: ${units.join(', ')}` : value;
      },
    });

    r.on<{ phase: string }>({
      id: 'sk1.rout.start',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'RtPh') return;
        ctx.proc<RoutStartSideFn>(ROUT_START_SIDE)(ctx, ctx.state.attacker);
        if (ctx.state.decisions.length > 0) return;
        finishSide(ctx);
        ctx.proc<RoutStartSideFn>(ROUT_START_SIDE)(ctx, otherSide(ctx.state, ctx.state.attacker));
        if (ctx.state.decisions.length > 0) return;
        finishSide(ctx);
        ctx.emit('sk1.rout.state', { state: null });
      },
    });

    r.procedure<PhaseDoneFn>(PHASE_DONE, (next) => (ctx, decision: Decision) => {
      if (ctx.state.phase !== 'RtPh') return next!(ctx, decision);
      finishSide(ctx);
      if (decision.owner === ctx.state.attacker) {
        ctx.proc<RoutStartSideFn>(ROUT_START_SIDE)(ctx, otherSide(ctx.state, ctx.state.attacker));
        if (ctx.state.decisions.length > 0) return;
        finishSide(ctx);
      }
      ctx.emit('sk1.rout.state', { state: null });
      next!(ctx, decision);
    });

    r.action<RoutAction & { type: 'rout.step' }>({
      type: 'rout.step',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const st = routState(env);
        if (!st || env.state.phase !== 'RtPh') return [];
        return eligibleRouters(env, st).flatMap((u) => stepOptions(env, st, u.id));
      },
      validate: (env, a) => stepActionIllegal(env, a),
      resolve(ctx, a) {
        const st = routState(ctx)!;
        let act = st.active?.unit === a.unit ? st.active : beginRout(ctx, a.unit, a.leaders ?? []);
        const v = activeView(ctx, act);
        const stairs = routNode(a.to) === v.at;
        const costOrWhy = a.lowCrawl ? v.mf : stairs ? stairsMf(ctx, a.unit, a.to) : beneathOrStepCost(ctx, a.unit, v.at, a.to, !!a.woods, !!a.beneath);
        const cost = typeof costOrWhy === 'string' ? 0 : costOrWhy;
        const r = enterHex(ctx, act, a.to, cost, !!a.lowCrawl, true, !stairs && !a.woods && woodsRoadStep(ctx, v.at, hexOfLoc(a.to)), !!a.beneath);
        act = r.act;
        // Upstairs is the last step of an (interim) full ASL rout: it climbs only where the rout may end.
        let over = r.over || (stairs && levelOfLoc(a.to) > v.level);
        if (!over) {
          // Nowhere further to go: the rout ends here of its own accord.
          const after = activeView(ctx, act);
          const open = ctx.query('rout.inPlace', { unit: a.unit }, false);
          if (!open && (stepOptions(ctx, routState(ctx)!, a.unit).length === 0 || (!canStop(ctx, after) && !finishReachable(ctx, after)))) over = true;
        }
        if (over) finishRout(ctx, act, r.alive);
        reAsk(ctx);
      },
    });

    r.action<RoutAction & { type: 'rout.stop' }>({
      type: 'rout.stop',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const act = routState(env)?.active;
        return act && env.state.phase === 'RtPh' && canStop(env, activeView(env, act)) ? [{ type: 'rout.stop', unit: act.unit }] : [];
      },
      validate(env, a) {
        if (env.state.phase !== 'RtPh') return 'Not the Rout Phase';
        const act = routState(env)?.active;
        if (!act || act.unit !== a.unit) return 'The unit is not routing';
        if (env.state.pieces[a.unit]?.side !== a.side) return 'Not your unit to rout';
        const v = activeView(env, act);
        if (!canStop(env, v)) return stopRefusal(env, v, 'Rout must go on to the nearest legal building or woods hex');
        return null;
      },
      resolve(ctx, a) {
        finishRout(ctx, routState(ctx)!.active!, ctx.state.pieces[a.unit]?.loc.kind === 'hex');
        reAsk(ctx);
      },
    });

    // The whole-path form stays accepted so that games recorded before hex-by-hex routing replay.
    r.action<RoutAction & { type: 'rout' }>({
      type: 'rout',
      decisionKinds: [PHASE_DECISION],
      legal: () => [],
      validate: (env, a) => routIllegal(env, a),
      resolve(ctx, a) {
        executeRout(ctx, a);
        reAsk(ctx);
      },
    });

    r.action<RoutAction & { type: 'rout.stay' }>({
      type: 'rout.stay',
      decisionKinds: [PHASE_DECISION],
      validate(env, a) {
        const st = routState(env);
        if (!st || env.state.phase !== 'RtPh') return 'Not the Rout Phase';
        if (st.active) return `${st.active.unit} has not finished routing`;
        if (st.mustRout.includes(a.unit)) return 'This unit must rout (or be eliminated)';
        return null;
      },
      resolve(ctx, a) {
        const st = routState(ctx)!;
        ctx.emit('sk1.rout.state', { state: { ...st, done: [...st.done, a.unit] } });
        reAsk(ctx);
      },
    });
  },
};

/** The units of the side now routing that may still rout this RtPh (none outside it). */
export function routersNow(env: QueryEnv): Piece[] {
  const st = routState(env);
  return st && env.state.phase === 'RtPh' ? eligibleRouters(env, st).filter((p) => !st.active || st.active.unit === p.id) : [];
}

/** Whether `unit` must rout this RtPh (it is eliminated if it does not). */
export const mustRoutNow = (env: QueryEnv, unit: PieceId): boolean => !!routState(env)?.mustRout.includes(unit);

/**
 * Full ASL: a rout expenditure within the unit's Location (ASLRB B26.41: the Wire Exit dr). It begins the rout when none is
 * under way (the excess SW dropped, `leaders` restacked with it), spends `cost` of its rout MF and drops `leave` from its
 * escort. The rout ends here when `end` (a Low Crawl, a unit hung up on the Wire) or when the unit has nowhere left to go;
 * a unit whose rout ends so while it must still rout for `failure`'s reason is eliminated for Failure to Rout.
 */
export function routInPlace(ctx: Ctx, unit: PieceId, opts: { cost: number; end: boolean; leaders?: PieceId[]; leave?: PieceId[]; failure?: (env: QueryEnv) => string | null }) {
  const st = routState(ctx)!;
  let act = st.active?.unit === unit ? st.active : beginRout(ctx, unit, opts.leaders ?? []);
  act = { ...act, spent: act.spent + opts.cost, escort: act.escort.filter((l) => !opts.leave?.includes(l)) };
  ctx.emit('sk1.rout.state', { state: { ...routState(ctx)!, active: act } });
  let over = opts.end;
  if (!over) {
    const after = activeView(ctx, act);
    if (stepOptions(ctx, routState(ctx)!, unit).length === 0 || (!canStop(ctx, after) && !finishReachable(ctx, after))) over = true;
  }
  if (over) {
    const why = opts.failure?.(ctx) ?? null;
    finishRout(ctx, act, true);
    if (why && ctx.state.pieces[unit]?.loc.kind === 'hex') {
      eliminate(ctx, unit, why);
      ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
    }
    enlistBroken(ctx);
  }
  reAsk(ctx);
}

function eligibleRouters(env: QueryEnv, st: RoutState): Piece[] {
  return Object.values(env.state.pieces)
    .filter((p) => p.side === st.side && p.loc.kind === 'hex' && isBroken(p) && hasDm(p) && !st.done.includes(p.id))
    .filter((p) => !inMelee(env, locOf(env.state, p)))
    .sort(byId);
}

function startSide(ctx: Ctx, side: SideId) {
  // Units that must rout are placed under DM.
  const must: PieceId[] = [];
  for (const p of Object.values(ctx.state.pieces).filter((x) => x.side === side && isBroken(x)).sort(byId)) {
    if (mustRout(ctx, p)) {
      must.push(p.id);
      if (!hasDm(p)) setTags(ctx, p.id, { [T.dm]: true });
    }
  }
  let st: RoutState = { side, mustRout: must, done: [] };
  ctx.emit('sk1.rout.state', { state: st });
  // A unit that must rout but has no legal rout at all is eliminated at once (failure to rout),
  // rather than leaving the player a step that cannot be completed.
  for (const id of must) {
    // An earlier failure to rout can take this unit with it (a Leader Loss check after the leader died).
    if (ctx.state.pieces[id]?.loc.kind !== 'hex') continue;
    if (stepOptions(ctx, st, id).length > 0 || ctx.query('rout.inPlace', { unit: id }, false)) continue;
    eliminate(ctx, id, 'failure to rout: no legal rout path');
    ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
    st = { ...routState(ctx)!, done: [...routState(ctx)!.done, id] };
    ctx.emit('sk1.rout.state', { state: st });
    enlistBroken(ctx);
    st = routState(ctx)!;
  }
  if (eligibleRouters(ctx, st).length > 0) askPhaseOwner(ctx, side);
}

/**
 * Units of the side routing that broke during its RtPh (a Leader Loss MC after a leader was eliminated) and now stand
 * where a broken unit may not stay. SK1 3.6: "During the RtPh a broken unit not in Melee may not end a RtPh adjacent to
 * ... a unbroken Known Enemy Unit and may not remain in the same Open Ground location ... Such a unit is placed under a
 * DM counter and ... must rout away ... during that RtPh or be eliminated for failure to rout" (ASLRB A10.5 the same).
 */
function newlyBroken(ctx: Ctx, st: RoutState): Piece[] {
  return Object.values(ctx.state.pieces)
    .filter((p) => p.side === st.side && p.loc.kind === 'hex' && isBroken(p) && !st.mustRout.includes(p.id) && !st.done.includes(p.id))
    .filter((p) => mustRout(ctx, p))
    .sort(byId);
}

/**
 * Add the units broken during the step that must rout (`newlyBroken`) to those that must, under DM; one with no legal
 * rout at all is eliminated at once, as at the start of the step, and its own Leader Loss checks may break more.
 * Nothing is emitted when no unit broke, so recordings without such a break keep their decision ids.
 */
function enlistBroken(ctx: Ctx) {
  for (let st = routState(ctx); st; st = routState(ctx)) {
    const fresh = newlyBroken(ctx, st);
    if (fresh.length === 0) return;
    for (const p of fresh) if (!hasDm(p)) setTags(ctx, p.id, { [T.dm]: true });
    ctx.emit('sk1.rout.state', { state: { ...st, mustRout: [...st.mustRout, ...fresh.map((p) => p.id)] } });
    for (const { id } of fresh) {
      const now = routState(ctx)!;
      if (ctx.state.pieces[id]?.loc.kind !== 'hex' || now.done.includes(id)) continue;
      if (stepOptions(ctx, now, id).length > 0 || ctx.query('rout.inPlace', { unit: id }, false)) continue;
      eliminate(ctx, id, 'failure to rout: no legal rout path');
      ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
      ctx.emit('sk1.rout.state', { state: { ...routState(ctx)!, done: [...routState(ctx)!.done, id] } });
    }
  }
}

/**
 * Units that had to rout but didn't are eliminated for failure to rout; a unit their Leader Loss checks break where it
 * may not stay can no longer rout "during that RtPh" (SK1 3.6) and goes the same way.
 */
function finishSide(ctx: Ctx) {
  for (let st = routState(ctx); st; st = routState(ctx)) {
    const pending = st.mustRout.filter((id) => !st!.done.includes(id) && ctx.state.pieces[id]?.loc.kind === 'hex');
    for (const id of pending) eliminate(ctx, id, 'failure to rout');
    ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
    const after = routState(ctx)!;
    const fresh = newlyBroken(ctx, after);
    ctx.emit('sk1.rout.state', { state: { ...after, mustRout: [...after.mustRout, ...fresh.map((p) => p.id)], done: [...new Set([...after.done, ...after.mustRout])] } });
    if (fresh.length === 0) return;
  }
}

function reAsk(ctx: Ctx) {
  ctx.popDecision();
  const st = routState(ctx)!;
  if (eligibleRouters(ctx, st).length > 0) askPhaseOwner(ctx, st.side);
  else {
    // Nothing left to rout for this side: behave as if they ended their step.
    const decision: Decision = { id: 'auto', kind: PHASE_DECISION, owner: st.side, deadlineClass: 'turn' };
    ctx.proc<PhaseDoneFn>(PHASE_DONE)(ctx, decision);
  }
}

/** Procedure asked before a routing unit enters a hex: (ctx, unit, hex) → whether it may. SK2's HIP wraps it. */
/**
 * Procedure that begins a side's rout step (DM on those who must rout, the eliminations for no legal path, the first
 * decision): (ctx, side). Concealment (SK4 8.3.4) wraps it to first offer the other side its "?" drop.
 */
export const ROUT_START_SIDE = 'sk1.rout.startSide';
export type RoutStartSideFn = (ctx: Ctx, side: SideId) => void;
/** Procedure that ends the rout under way of `unit` where it stands (full ASL, ASLRB B28.413); never called in the Starter Kit. */
export const ROUT_END_HERE = 'sk1.rout.endHere';
export type RoutEndHereFn = (ctx: Ctx, unit: PieceId) => void;
/** Full ASL: escorting leaders that stay behind before the next step (ASLRB B28.412: broken or pinned by a minefield's exit attack). */
export function dropRoutEscort(ctx: Ctx, leaders: PieceId[]) {
  const st = routState(ctx);
  if (!st?.active || !leaders.length) return;
  ctx.emit('sk1.rout.state', { state: { ...st, active: { ...st.active, escort: st.active.escort.filter((l) => !leaders.includes(l)) } } });
}
export const ROUT_ENTER = 'sk1.rout.enter';
export type RoutEnterFn = (ctx: Ctx, unit: PieceId, hex: HexId) => boolean;
/** Procedure run once a routing unit and its escort stand in the Location entered: (ctx, units, loc, beneath its entrenchment). A no-op in the Starter Kit. */
export const ROUT_ENTERED = 'sk1.rout.entered';
export type RoutEnteredFn = (ctx: Ctx, units: PieceId[], loc: LocId, beneath: boolean) => void;

/**
 * Start a unit's rout: excess SW dropped, the escorting leaders restacked with it, its destinations fixed.
 * `record` writes the rout in progress to the state; a whole-path rout keeps it to itself so that the
 * events (and so the decision ids) of older recordings come out as they did.
 */
function beginRout(ctx: Ctx, unit: PieceId, leaders: PieceId[], record = true): ActiveRout {
  const st = routState(ctx)!;
  dropExcessSw(ctx, unit);
  restack(ctx, [unit, ...leaders]);
  const plan = planRout(ctx, unit);
  const act: ActiveRout = {
    unit,
    leaders,
    escort: [...leaders],
    start: nodeOf(ctx, pieceOf(ctx, unit))!,
    path: [],
    spent: 0,
    seen: [],
    destinations: [...plan.destinations].sort(),
    sheltered: plan.sheltered,
    reached: false,
  };
  if (record) ctx.emit('sk1.rout.state', { state: { ...st, active: act } });
  return act;
}

/**
 * One hex of a rout: the unit (and its escort) enters it and suffers Interdiction there if it is Open
 * Ground in the view of an enemy able to fire, unless Low Crawling. `over` when the rout ends here:
 * Low Crawl, a pin, the unit's loss, or a hex it turns out it cannot enter (SK2 HIP).
 */
function enterHex(ctx: Ctx, act: ActiveRout, toLoc: LocId, cost: number, lowCrawl: boolean, record = true, onRoad = false, beneath = false): { act: ActiveRout; over: boolean; alive: boolean } {
  const side = pieceOf(ctx, act.unit).side;
  const from = nodeOf(ctx, pieceOf(ctx, act.unit))!;
  const to = routNode(toLoc);
  // A hex that turns out to hold a hidden enemy (SK2 HIP) ends the rout there.
  if (!ctx.proc<RoutEnterFn>(ROUT_ENTER)(ctx, act.unit, to)) return { act, over: true, alive: ctx.state.pieces[act.unit]?.loc.kind === 'hex' };
  // Full ASL: an escort a rule stopped before the step (ASLRB B28.412: broken or pinned by a minefield's exit attack) stays.
  const now = record ? routState(ctx)?.active : undefined;
  if (now?.unit === act.unit && now.escort.length !== act.escort.length) act = { ...act, escort: now.escort };
  for (const id of [act.unit, ...act.escort]) ctx.emit('piece.moved', { id, loc: locationAt(toLoc) });
  ctx.proc<RoutEnteredFn>(ROUT_ENTERED)(ctx, [act.unit, ...act.escort], toLoc, beneath);
  // Full ASL: a unit lost on entering (ASLRB B28.413: a minefield attack comes before Interdiction) routs no further.
  if (ctx.state.pieces[act.unit]?.loc.kind !== 'hex') {
    const gone: ActiveRout = { ...act, path: [...act.path, toLoc], spent: act.spent + cost, escort: act.escort.filter((l) => ctx.state.pieces[l]?.loc.kind === 'hex') };
    if (record) ctx.emit('sk1.rout.state', { state: { ...routState(ctx)!, active: gone } });
    return { act: gone, over: true, alive: false };
  }
  if (act.escort.some((l) => ctx.state.pieces[l]?.loc.kind !== 'hex')) act = { ...act, escort: act.escort.filter((l) => ctx.state.pieces[l]?.loc.kind === 'hex') };
  let next: ActiveRout = {
    ...act,
    path: [...act.path, toLoc],
    spent: act.spent + cost,
    seen: [...new Set([...act.seen, ...knownEnemyHexes(ctx, side, from)])].sort(),
    reached: act.reached || arrives(ctx, activeView(ctx, act), from, to),
  };
  let over = lowCrawl;
  let alive = true;
  // Why this step was, or was not, open to Interdiction, for the log (SK1 3.6: a Low Crawl is never interdicted;
  // Interdiction needs Open Ground, or a road the unit routs along, in a Good Order enemy's Normal Range and clear LOS).
  let step: RoutStep = { unit: act.unit, to: hexOfLoc(toLoc), lowCrawl, interdiction: 'lowCrawl' };
  // Beneath the entrenchment of the hex entered (full ASL, ASLRB B27.41) the foxhole "nullifies any Interdiction in that hex".
  if (beneath) step = { ...step, interdiction: 'entrenched' };
  else if (!lowCrawl) {
    const by = interdicted(ctx, side, to, from, onRoad);
    const byIds = by.map((e) => e.id).sort();
    step = {
      ...step,
      interdiction: by.length ? 'checked' : ctx.query('hex.openGround', { hex: to }, false) || onRoad ? 'none' : 'notOpen',
      ...(by.length ? { by: byIds, byFrom: byIds.map((id) => locOf(ctx.state, pieceOf(ctx, id))!) } : {}),
    };
    if (by.length > 0) {
      const lead = next.escort.length
        ? Math.min(...next.escort.map((l) => ctx.query('unit.leadership', { unit: l, for: act.unit }, smc(ctx, pieceOf(ctx, l))!.leadership)))
        : 0;
      const outcome = interdictionCheck(ctx, act.unit, lead);
      if (outcome === 'reduced' || outcome === 'eliminated' || outcome === 'broken') {
        // Leaders still walking with the unit: a failed Interdiction MC kills them (SK1 3.6) and the unit goes on alone.
        for (const l of next.escort) if (ctx.state.pieces[l]?.loc.kind === 'hex') eliminate(ctx, l, 'routing leader: interdiction MC failed');
        next = { ...next, escort: [] };
        if (outcome === 'eliminated') {
          alive = false;
          over = true;
        }
      }
      if (outcome === 'pinned') over = true;
    }
  }
  // The step rides on the state event: a new event would shift the decision ids of recorded games.
  if (record) ctx.emit('sk1.rout.state', { state: { ...routState(ctx)!, active: next }, step });
  return { act: next, over, alive };
}

/** The rout is over: the unit is done, its leaders are spent as escorts, and ending beside the enemy is fatal. */
function finishRout(ctx: Ctx, act: ActiveRout, alive: boolean) {
  ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
  const st = routState(ctx)!;
  const { active: _active, ...rest } = st;
  void _active;
  ctx.emit('sk1.rout.state', { state: { ...rest, done: [...st.done, act.unit], escorted: [...(st.escorted ?? []), ...act.leaders] } });
  // A leader killed with the router (a failed Interdiction MC) can break others in his Location: they must rout too.
  enlistBroken(ctx);
  // Ending adjacent to an unbroken Known Enemy Unit = eliminated for failure to rout.
  const p = ctx.state.pieces[act.unit];
  if (alive && p && p.loc.kind === 'hex') {
    const hex = nodeOf(ctx, p)!;
    const adjacent = !ctx.query('rout.mayEndBeside', { node: hex }, false) && knownEnemyUnits(ctx, p.side).some((e) => {
      const eh = enemyNode(ctx, e);
      return !isBroken(e) && enemyNear(ctx, hex, eh, eh === hex || nodeDistance(ctx, eh, hex) === 1) && hasLos(ctx, hex, eh);
    });
    if (adjacent) {
      eliminate(ctx, act.unit, 'failure to rout (ended adjacent to enemy)');
      ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
      enlistBroken(ctx);
    }
  }
}

/** A whole rout in one action (older recordings): the steps one after another, then the end. */
function executeRout(ctx: Ctx, a: RoutAction & { type: 'rout' }) {
  let act = beginRout(ctx, a.unit, a.leaders ?? [], false);
  let alive = true;
  for (const h of a.path) {
    const at = nodeOf(ctx, pieceOf(ctx, a.unit))!;
    const cost = a.lowCrawl ? ctx.query('rout.mf', { unit: a.unit }, 6) : routStepCost(ctx, a.unit, at, h);
    const r = enterHex(ctx, act, h, cost, !!a.lowCrawl, false);
    act = r.act;
    alive = r.alive;
    if (r.over) break;
  }
  finishRout(ctx, act, alive);
}

/** Interdiction NMC: failure means Casualty Reduction (not breaking again); pin stops the rout. */
/**
 * The Interdiction NMC. `unbroken`: a unit leaving a Blaze as if Withdrawing (full ASL B25.4), for which an Original 12 is
 * simply a failure (Casualty Reduction, A10.53), not the broken unit's elimination.
 */
export function interdictionCheck(ctx: Ctx, unit: PieceId, leaderDrm: number, unbroken = false): CheckOutcome {
  const morale = ctx.query('unit.morale', { unit }, 0);
  const roll = ctx.roll(`Interdiction NMC for ${unit}`);
  const final = roll.total + leaderDrm;
  if (roll.total === 12 && !unbroken) {
    ctx.emit('piece.eliminated', { id: unit, reason: 'Interdiction: original 12 while broken' });
    return 'eliminated';
  }
  if (final > morale) {
    const r = ctx.proc<CasualtyFn>(MP.casualtyReduce)(ctx, unit, 'Interdiction');
    return r === 'eliminated' ? 'eliminated' : 'reduced';
  }
  // Passing by exactly the unit's morale is a Pin result: the unit is pinned and "may not rout further that RtPh"
  // (SK4 3.6; the hut rule speaks of "a pinned broken unit"). The Pin counter shows the player why it stopped.
  if (final === morale) {
    setTags(ctx, unit, { [T.pinned]: true, [T.pinnedThisTurn]: true });
    return 'pinned';
  }
  return 'passed';
}

/** A routing unit must drop SW in excess of its IPC (keeping as much PP as fits). */
function dropExcessSw(ctx: Ctx, unit: PieceId) {
  const p = pieceOf(ctx, unit);
  // Dropped where the unit is: in its Location (ASLRB A2.8), in its position there (full ASL: on or beneath Wire, B26.4).
  const here = { ...locationAt(locOf(ctx.state, p)!), ...(p.loc.kind === 'hex' && p.loc.pos ? { pos: p.loc.pos } : {}) };
  const ipc = ctx.query('unit.ipc', { unit }, 0);
  const sws = swHeldBy(ctx.state, unit).sort((a, b) => ppOf(ctx, b) - ppOf(ctx, a) || (a.id < b.id ? -1 : 1));
  let carried = 0;
  for (const s of sws) {
    // A Gun is always dropped before routing (SK4 3.6, 4.0).
    if (gun(ctx, s)) {
      ctx.emit('piece.moved', { id: s.id, loc: here });
      continue;
    }
    const pp = ppOf(ctx, s);
    if (carried + pp <= ipc) carried += pp;
    else ctx.emit('piece.moved', { id: s.id, loc: here });
  }
}
