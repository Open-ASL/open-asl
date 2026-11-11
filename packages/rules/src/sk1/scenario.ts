import type { Action, Ctx, Decision, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, isMmcDef, isPersonnelDef, isVehicleDef, isWeaponDef, otherSide, personnelAt, statics, swHeldBy, unitsAt, unitsInHex } from '../common/pieces';
import { hexOfLoc, isGroundLoc, locExists, locKey, locationAt, type LocId } from '../common/location';
import { advancePhase } from '../common/turn';
import { losFirepower } from './losFirepower';
import { areaVp } from './areaVp';
import { vpTally } from './vpTally';
import { clearAreasTally, squadEquivalentsLost } from './clearAreas';
import { OPEN_STACK_LIMIT, stackLimit } from './movement';
import { MOVE_EXIT, exitMf, moveState, type MoveExitFn, type MoveState } from './movement';
import { AP, type AdvanceExitFn } from './advance';
import type { GameMap, ScenarioDef, ScenarioForce, VictoryCondition, SetupConstraint } from '../common/statics';
import { isBroken, isGoodOrder, mmc, pieceOf, setTags, smc, squadEquivalents } from './status';
import { isRoadHex, terrainOf } from './terrain';

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Casualty VP value of an eliminated unit. */
    'vp.casualty': { ctx: { unit: PieceId }; value: number };
    /** Extra fields a default (AI/test) setup action carries, e.g. Gun Covered Arcs. */
    'setup.defaults': { ctx: { side: SideId; todo: PieceId[]; placements: Record<PieceId, HexId> }; value: Record<string, unknown> };
    /** Why a setup action's extra fields are illegal (after placements and SW assignments passed), or null. */
    'setup.illegal': { ctx: { side: SideId; todo: PieceId[]; action: SetupAction }; value: string | null };
    /**
     * Why `unit` (with what it holds) may not set up in `hex` by a rule of another rule pack (a large Gun in a building),
     * or null. The default placement steers clear of such hexes; the setup action is still judged by 'setup.illegal'.
     */
    'setup.hexIllegal': { ctx: { side: SideId; unit: PieceId; hex: HexId }; value: string | null };
    /** Whether a victory condition another rule pack defines currently holds (null: nobody answers). */
    'vc.achieved': { ctx: { vc: VictoryCondition }; value: boolean | null };
    /** How many of a side's AFV in the hexes are mobile with a functioning MA (0 without the vehicle rules). */
    'area.armedMobileAfv': { ctx: { side: SideId; hexes: HexId[] }; value: number };
    /** The casualty VP an `eliminateCvp` condition asks for in play (a special rule may set it). */
    'vc.cvp': { ctx: { vc: VictoryCondition & { kind: 'eliminateCvp' } }; value: number };
    /** Exit VP value of a unit. */
    'vp.exit': { ctx: { unit: PieceId }; value: number };
    /**
     * Whether a force's entering units may be kept back at their offboard setup (SSR "tactical
     * reserve"): how many, and when and where those kept back enter instead. Null: all must set up.
     */
    'setup.reserve': { ctx: { side: SideId; force: number }; value: ReserveRule | null };
  }
}

export const SETUP_DECISION = 'setup';
/** RPh step (a): the ATTACKER sets up offboard all forces due to enter this Player Turn (SK1 3.1, 3.3). */
export const OFFBOARD_SETUP_DECISION = 'offboardSetup';

/** Units a player may hold back from an offboard setup, and when and where they enter instead. */
export interface ReserveRule {
  /** The Player Turn the units kept back enter on. */
  turn: number;
  /** Scenario edges they may enter from then. */
  edges: string[];
  /** The most that may be kept back. */
  mmc: number;
  smc: number;
  sw: number;
  /** The card's name for the rule, e.g. "SSR 2 (tactical reserve)". */
  label?: string;
}

/** The reserve rule for a piece's force, if the scenario has one. */
export const reserveRuleFor = (env: QueryEnv, p: Piece): ReserveRule | null => env.query('setup.reserve', { side: p.side, force: p.tags['force'] as number }, null);

/**
 * Why the units left unplaced at an offboard setup may not be kept back, or null: only a force
 * with a reserve rule may leave units behind, and no more MMC, SMC or SW (the weapons the
 * unplaced units will carry) than it allows.
 */
export function reserveIllegal(env: QueryEnv, side: SideId, todo: Piece[], placements: Record<PieceId, HexId>, sw: Record<PieceId, PieceId> = {}): string | null {
  const left = todo.filter((p) => !placements[p.id]);
  if (left.length === 0) return null;
  const byForce = new Map<number, Piece[]>();
  for (const p of left) byForce.set(p.tags['force'] as number, [...(byForce.get(p.tags['force'] as number) ?? []), p]);
  for (const [fi, pieces] of byForce) {
    const rule = env.query('setup.reserve', { side, force: fi }, null);
    if (!rule) return 'Place every unit before confirming';
    const leftIds = new Set(pieces.map((p) => p.id));
    const mmcN = pieces.filter((p) => mmc(env, p)).length;
    const smcN = pieces.filter((p) => smc(env, p)).length;
    // A weapon stays with the unit holding it unless the setup hands it to another.
    const swN = Object.values(env.state.pieces).filter((w) => w.loc.kind === 'held' && defOf(env, w).kind === 'sw' && leftIds.has(sw[w.id] ?? w.loc.by)).length;
    if (mmcN > rule.mmc || smcN > rule.smc || swN > rule.sw) {
      return `At most ${rule.mmc} MMC, ${rule.smc} SMC and ${rule.sw} SW may be kept back${rule.label ? ` (${rule.label})` : ''}: ${mmcN} MMC, ${smcN} SMC and ${swN} SW are unplaced`;
    }
  }
  return null;
}

const CONTROL = 'sk1.control';
/**
 * Control has three tiers (ASLRB A26.11–26.14): Locations, hexes and buildings. A hex is Controlled from its
 * ground level (A26.13), a building from any non-rooftop level (A26.14). A hex's ground Location is Controlled
 * with the hex; `locations` holds only the other Locations (upper levels), so it is never written in the Starter
 * Kit, which plays at ground level. Only hex and building Control are shown for now.
 */
interface ControlState {
  hexes: Record<HexId, SideId>;
  buildings: Record<string, SideId>;
  /** Hexes an AFV Controls only while it sits there (SK4 Definitions): the controller to revert to (null: nobody). */
  afv?: Record<HexId, SideId | null>;
  /** Control of the Locations above ground level (ASLRB A26.11); absent when there is none. */
  locations?: Record<LocId, SideId>;
}
export const controlState = (env: QueryEnv): ControlState =>
  (env.state.ext[CONTROL] as ControlState | undefined) ?? { hexes: {}, buildings: {} };

/**
 * Every hex a side Controls, for display: hex control plus every hex of a Controlled building
 * (SK1 2.0 "Control": a Good Order MMC gains the hex or building it occupies with no enemy
 * unit present; control persists until the enemy gains it).
 */
export function controlledHexes(env: QueryEnv): Record<HexId, SideId> {
  const ctl = controlState(env);
  const out: Record<HexId, SideId> = {};
  for (const h of statics(env).map.hexes()) {
    const b = h.buildingId ? ctl.buildings[h.buildingId] : undefined;
    const side = ctl.hexes[h.id] ?? b;
    if (side) out[h.id] = side;
  }
  return out;
}

/**
 * The control chits to draw: Control of the hexes the victory conditions turn on, read as they read it.
 * A `controlHexes` condition, and a `vpTally` source of Controlled hexes, count hex Control alone (ASLRB
 * A26.13: only an MMC in the hex gains it), so only those hexes get a chit, and only once entered. A
 * `controlBuildings` condition shows each of its buildings' hexes under the building's Control (A26.14).
 * A `custom` condition is opaque: every Controlled hex shows. Hexes no condition names show nothing,
 * however many a side walked through.
 */
export function controlChits(env: QueryEnv, scenario: ScenarioDef): Record<HexId, SideId> {
  const map = statics(env).map;
  const ctl = controlState(env);
  const hexes = new Set<HexId>();
  const buildings = new Set<string>();
  let everything = false;
  const walk = (vc: VictoryCondition): void => {
    switch (vc.kind) {
      case 'controlHexes':
        for (const h of vc.hexes) hexes.add(map.hex(h)?.id ?? h);
        break;
      case 'vpTally':
        for (const src of vc.sources) if (src.kind === 'controlledHexes') for (const h of src.hexes) hexes.add(map.hex(h)?.id ?? h);
        break;
      case 'controlBuildings':
        for (const b of vc.buildings) buildings.add(b);
        break;
      case 'custom':
        everything = true;
        break;
      case 'all':
      case 'any':
        vc.of.forEach(walk);
        break;
      default:
        break;
    }
  };
  scenario.victory.forEach(walk);
  if (everything) return controlledHexes(env);
  const out: Record<HexId, SideId> = {};
  for (const h of map.hexes()) {
    if (h.buildingId && buildings.has(h.buildingId) && ctl.buildings[h.buildingId]) out[h.id] = ctl.buildings[h.buildingId]!;
    if (hexes.has(h.id) && ctl.hexes[h.id]) out[h.id] = ctl.hexes[h.id]!;
  }
  return out;
}

/**
 * Whether Control matters to this scenario's victory conditions, so the client knows whether to
 * draw control chits at all. Control is still tracked either way (SK1 2.0); this only governs
 * display. `custom` conditions are opaque, so they count as caring about Control.
 */
export function controlMatters(scenario: ScenarioDef): boolean {
  const walk = (vc: VictoryCondition): boolean => {
    switch (vc.kind) {
      case 'controlHexes':
      case 'controlBuildings':
      case 'custom':
        return true;
      case 'all':
      case 'any':
        return vc.of.some(walk);
      default:
        return false;
    }
  };
  return scenario.victory.some(walk);
}

const EXITED = 'sk1.exited';
const CASUALTIES = 'sk1.casualties';

/**
 * One line of a side's casualty ledger: a unit eliminated, or a squad Casualty Reduced to a
 * half-squad (worth 1 CVP; the half-squad's own elimination is a second line). `defId` is the
 * counter the unit was when the loss was taken.
 */
export interface Casualty {
  unit: PieceId;
  side: SideId;
  kind: 'eliminated' | 'reduced';
  defId: string;
  vp: number;
  turn: number;
  phase: string;
  reason: string;
}

/** Casualties taken by `side` (every side when omitted), in the order they happened. */
export const casualties = (env: QueryEnv, side?: SideId): Casualty[] =>
  ((env.state.ext[CASUALTIES] as Casualty[] | undefined) ?? []).filter((c) => side === undefined || c.side === side);

/** MMC (squads, half-squads and crews) `side` has lost: eliminated, a Casualty Reduction to a half-squad not counting (LMA5's VC). */
export const mmcLost = (env: QueryEnv, side: SideId): Casualty[] =>
  casualties(env, side).filter((c) => {
    const d = statics(env).counters[c.defId];
    return c.kind === 'eliminated' && !!d && isMmcDef(d);
  });

/**
 * The building in which `side` has a unit of every group of a `forcesInBuilding` condition, if any: MMC or SMC on the
 * map, whatever their state, each counted for the scenario force it was created with.
 */
export function buildingWithForces(env: QueryEnv, vc: VictoryCondition & { kind: 'forcesInBuilding' }): string | null {
  const sc = statics(env).scenario;
  const map = statics(env).map;
  const found = new Map<string, Set<number>>();
  for (const p of Object.values(env.state.pieces).sort(byId)) {
    if (p.side !== vc.side || p.loc.kind !== 'hex' || !(mmc(env, p) || smc(env, p))) continue;
    const b = map.hex(p.loc.hex)?.buildingId;
    const force = sc.forces[p.tags['force'] as number]?.id;
    if (!b || !force) continue;
    vc.groups.forEach((g, gi) => {
      if (g.forces.includes(force)) found.set(b, (found.get(b) ?? new Set()).add(gi));
    });
  }
  for (const [b, groups] of [...found].sort(([x], [y]) => (x < y ? -1 : 1))) if (groups.size === vc.groups.length) return b;
  return null;
}

/**
 * CVP totals the scenario's victory conditions turn on, keyed by the side amassing them: an
 * `eliminateCvp` goal wins for that side, a `cvpBelow` cap on the other side denies them the game.
 */
/** Every condition of the scenario, those inside `all`/`any` included (each keeps its own `side`). */
export function victoryLeaves(scenario: ScenarioDef): VictoryCondition[] {
  return scenario.victory.flatMap(function leaves(vc: VictoryCondition): VictoryCondition[] {
    return vc.kind === 'all' || vc.kind === 'any' ? vc.of.flatMap(leaves) : [vc];
  });
}

/** The exit VP condition of a side, also when it is one part of an `all` ("exit 9 VP provided ..."). */
export function exitVpCondition(scenario: ScenarioDef, side: SideId): (VictoryCondition & { kind: 'exitVp' }) | undefined {
  return victoryLeaves(scenario).find((v): v is VictoryCondition & { kind: 'exitVp' } => v.kind === 'exitVp' && v.side === side);
}

export function cvpThresholds(scenario: ScenarioDef, env?: QueryEnv): { side: SideId; cvp: number; effect: 'wins' | 'denies' }[] {
  const other = (side: SideId) => scenario.sides.find((s) => s.side !== side)?.side ?? side;
  const out: { side: SideId; cvp: number; effect: 'wins' | 'denies' }[] = [];
  const walk = (vc: VictoryCondition) => {
    if (vc.kind === 'all' || vc.kind === 'any') vc.of.forEach(walk);
    else if (vc.kind === 'eliminateCvp') out.push({ side: vc.side, cvp: env ? cvpGoal(env, vc) : vc.cvp, effect: 'wins' });
    else if (vc.kind === 'cvpBelow') out.push({ side: other(vc.side), cvp: vc.cvp, effect: 'denies' });
  };
  scenario.victory.forEach(walk);
  return out;
}

/**
 * The casualty VP an `eliminateCvp` condition asks for in this game: the card's number, unless a
 * special rule sets it in play (S20's Chart 1 roll; Infinity until it is made).
 */
export const cvpGoal = (env: QueryEnv, vc: VictoryCondition & { kind: 'eliminateCvp' }): number => env.query('vc.cvp', { vc }, vc.cvp);

/** Deterministic piece ids for a scenario force entry. */
export function forcePieceIds(side: SideId, forceIdx: number, unitIdx: number, def: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${side}.${forceIdx}.${unitIdx}.${def}.${i + 1}`);
}

export type SetupAction = Action & {
  /** Personnel → Location (a hex id at ground level; ASLRB A2.8), or the offboard hex of entering units. */
  placements: Record<PieceId, LocId>;
  /** SW → possessing personnel. */
  sw?: Record<PieceId, PieceId>;
  /** Guns being set up: their Covered Arc (hexspine 0–5) and whether they use Hidden Initial Placement (SK2). */
  guns?: Record<PieceId, { ca: number; hip?: boolean }>;
  /** Vehicles being set up: the Vehicle Covered Arc, a turret's own arc when it differs, and whether the crew starts Crew Exposed (SK3). */
  vehicles?: Record<PieceId, { vca: number; tca?: number; ce?: boolean; dugIn?: boolean }>;
  /** Personnel set up hidden with their weapons, where a special rule allows it (S23 SSR 1, `hidden-units`). */
  hidden?: PieceId[];
  /** Personnel set up under an OB concealment counter (SK4 8.3): in Concealment Terrain, one counter per stack. */
  concealed?: PieceId[];
};

/** Procedure run after a setup's placements are applied: (ctx, action, decision). Other rule packs wrap it (Guns). */
export const SETUP_PLACED = 'sk1.scenario.placed';
export type SetupPlacedFn = (ctx: Ctx, action: SetupAction, decision: Decision) => void;

function setupHexes(force: ScenarioForce): HexId[] | null {
  return force.setup.kind === 'hexes' || force.setup.kind === 'area' ? force.setup.hexes : null;
}

/** Default stacking cap used by the quick-start placement (and any force-specific limit). */
/** A card's own MMC-per-hex limit for a force; without one only the stacking limits apply (SK1 3.3). */
const maxMmcPerHex = (force: ScenarioForce) => (force.setup.kind === 'area' ? (force.setup.maxMmcPerHex ?? Infinity) : Infinity);

const forceOf = (env: QueryEnv, p: Piece) => statics(env).scenario.forces[p.tags['force'] as number]!;

/** Entering units of `side` due this Player Turn that are not yet set up offboard. */
function dueOffboard(env: QueryEnv, side: SideId): Piece[] {
  return Object.values(env.state.pieces)
    .filter(
      (p) =>
        p.side === side &&
        p.loc.kind === 'offboard' &&
        !p.loc.hex &&
        p.tags['entryTurn'] === env.state.turn &&
        p.loc.edge !== 'setup' &&
        p.loc.edge !== 'exited',
    )
    .sort(byId);
}

/** The pieces a setup decision asks its owner to place (a side's "set up last" forces in their own, later decision). */
export function piecesToPlace(env: QueryEnv, d: Decision): Piece[] {
  if (d.kind === SETUP_DECISION) return unplaced(env, d.owner, (d.data?.['stage'] as 'first' | 'last' | undefined) ?? 'first');
  if (d.kind === OFFBOARD_SETUP_DECISION) return dueOffboard(env, d.owner);
  return [];
}

/**
 * Hexes a piece may be placed in: its force's setup hexes (any map hex if unrestricted), or for
 * entering units the offboard hexes along their entry edge (beside the allowed entry hexes, if any).
 */
export function placementHexes(env: QueryEnv, p: Piece): HexId[] {
  const map = statics(env).map;
  if (p.loc.kind === 'offboard' && p.loc.edge === 'setup') {
    // Not where no unit may enter (S19's flooded grain), whatever area the card names.
    return (setupHexes(forceOf(env, p)) ?? [...map.hexes()].map((h) => h.id)).filter((h) => terrainOf(env, h).mf !== Infinity);
  }
  const edge = p.tags['entryEdge'] as string | undefined;
  if (!edge) return [];
  const allowed = (p.tags['entryHexes'] as string | undefined)?.split(',');
  // Units kept in reserve may have a choice of edges ("north and/or east"): 'N,E'.
  const along = edge.split(',').flatMap((e) => map.offboard(e));
  const hexes = along.filter((h) => !allowed || map.offboardNeighbors(h.id).onboard.some((n) => allowed.includes(n))).map((h) => h.id);
  if (!allowed) return hexes;
  // Infantry keep the stacking limits offboard (ASLRB A5.1): a force told to enter through one hex or a few ("any one
  // west edge hex", S68) waits in as many offboard hexes along the edge as it needs, walking along it to the entry hex
  // (A2.51). The area grows one offboard hex at a time each way until it holds the units due to enter there.
  const waiting = Object.values(env.state.pieces).filter((q) => q.side === p.side && q.tags['force'] === p.tags['force'] && q.tags['entryHexes'] === p.tags['entryHexes'] && q.tags['entryTurn'] === p.tags['entryTurn'] && !!mmc(env, q));
  const need = squadEquivalents(env, waiting);
  const out = new Set(hexes);
  const onEdge = new Set(along.map((h) => h.id));
  while (out.size && out.size * OPEN_STACK_LIMIT.se < need) {
    const more = [...out].flatMap((h) => map.offboardNeighbors(h).offboard).filter((h) => onEdge.has(h) && !out.has(h));
    if (!more.length) break;
    for (const h of more) out.add(h);
  }
  return [...out];
}

/** Personnel and vehicles already in a (map Location or offboard) hex, other than the pieces being placed. */
function occupants(env: QueryEnv, hex: LocId, side: SideId, exclude: Set<PieceId>): Piece[] {
  if (!statics(env).map.offboardHex(hex)) return unitsAt(env, hex, side).filter((p) => !exclude.has(p.id));
  return Object.values(env.state.pieces).filter(
    (p) => p.side === side && p.loc.kind === 'offboard' && p.loc.hex === hex && !exclude.has(p.id) && !!(mmc(env, p) || smc(env, p) || isVehicleDef(defOf(env, p))),
  );
}

/**
 * Why a (possibly partial) set of placements is illegal, or null. With `partial`, unplaced pieces
 * are allowed (for live feedback while a player is still placing).
 */
export function placementIllegal(env: QueryEnv, side: SideId, todo: Piece[], placements: Record<PieceId, LocId>, partial = false, sw: Record<PieceId, PieceId> = {}): string | null {
  const ids = new Set(todo.map((p) => p.id));
  for (const p of todo) {
    const loc = placements[p.id];
    if (!loc) {
      // A force with a reserve rule may leave units behind (`reserveIllegal` counts them).
      if (partial || reserveRuleFor(env, p)) continue;
      return 'Place every unit before confirming';
    }
    const hex = hexOfLoc(loc);
    if (!placementHexes(env, p).includes(hex)) return `${hex} is not a setup hex for this unit`;
    // Above ground level only where the hex has that Location (full ASL upper building levels), and only Infantry.
    if (!isGroundLoc(loc) && (!locExists(env, loc) || !isPersonnelDef(defOf(env, p)))) return `${p.id} cannot set up at ${loc}`;
    // Not in a hex the enemy already holds, where overlapping setup areas meet (S7): play would open in Melee. A
    // hidden enemy (HIP, sk2/hip.ts) does not bar it, or the refusal would give its hex away.
    if (statics(env).map.hex(hex) && unitsInHex(env, hex, otherSide(env.state, side)).some((e) => e.tags['hip'] !== true)) return `${hex} is held by the enemy`;
  }
  for (const id of Object.keys(placements)) if (!ids.has(id)) return `${id} is not being set up`;
  // Per-force MMC-per-hex limits (e.g. "no more than one MMC per hex").
  const forceMmc = new Map<string, number>();
  for (const p of todo) {
    const hex = placements[p.id] && hexOfLoc(placements[p.id]!);
    if (!hex || !mmc(env, p)) continue;
    const k = `${p.tags['force']}|${hex}`;
    forceMmc.set(k, (forceMmc.get(k) ?? 0) + 1);
    const cap = maxMmcPerHex(forceOf(env, p));
    if (forceMmc.get(k)! > cap && forceOf(env, p).setup.kind === 'area') return `No more than ${cap} MMC per hex (${hex})`;
  }
  // Stacking per Location (ASLRB A5.1; the hex in the Starter Kit).
  const byLoc = new Map<LocId, Piece[]>();
  for (const p of todo) {
    const loc = placements[p.id];
    if (loc) byLoc.set(loc, [...(byLoc.get(loc) ?? []), p]);
  }
  for (const [hex, placed] of byLoc) {
    const offboard = !!statics(env).map.offboardHex(hex) && !statics(env).map.hex(hex);
    const all = [...occupants(env, hex, side, ids), ...placed];
    const se = squadEquivalents(env, all);
    // Infantry stacking binds offboard too: ASLRB A5.1, the limits are exceeded "never during initial or offboard
    // setup"; A2.51 places offboard units on real hexes. Offboard is Open Ground (SK4 3.3), so no terrain lowers it.
    const limit = offboard ? OPEN_STACK_LIMIT : stackLimit(env, hex, side);
    if (se > limit.se) return `Stacking limit exceeded in ${hex} (${limit.se} squad-equivalents)`;
    if (all.filter((p) => smc(env, p)).length > limit.smc) return `Too many leaders in ${hex} (${limit.smc} SMC)`;
    // Each side may have one vehicle in a hex (SK4 2.0 Stacking Limits, 3.3.2), but only "at the end of the MPh": a
    // vehicle never ends one offboard (it must enter or is eliminated), so offboard vehicles may share a hex (ASLRB A5.2 only penalises vehicle overstacking).
    if (!offboard && all.filter((p) => isVehicleDef(defOf(env, p)) && !p.tags['wreck']).length > 1) return `Only one vehicle per side may be in ${hex}`;
  }
  // The card's setup constraints bind the units setting up on the map, never reinforcements set up offboard later in
  // the game (LMA2: two German HS that have since moved adjacent do not bar the Turn 2 reinforcements).
  if (todo.length && todo.every((p) => p.loc.kind === 'offboard' && p.loc.edge !== 'setup')) return null;
  return constraintViolation(env, side, placements, partial, sw);
}

/**
 * Where a piece of the side stands for setup constraints: the hex of its placement, its hex, or its holder's.
 * The card constraints speak of hexes (distances, terrain, "share a hex"), whatever the level.
 */
function setupPosition(env: QueryEnv, p: Piece, placements: Record<PieceId, LocId>, sw: Record<PieceId, PieceId> = {}): HexId | null {
  // A weapon the setup hands to another unit stands where that unit does.
  const by = sw[p.id] ?? (p.loc.kind === 'held' ? p.loc.by : null);
  if (by) {
    const h = env.state.pieces[by];
    return h ? setupPosition(env, h, placements, sw) : null;
  }
  if (placements[p.id]) return hexOfLoc(placements[p.id]!);
  return p.loc.kind === 'hex' ? p.loc.hex : null;
}

const defName = (env: QueryEnv, def: string) => {
  const d = statics(env).counters[def];
  if (!d) return def;
  if (d.kind === 'gun') return `${d.caliber}${d.barrel ?? ''} ${d.type} Gun`;
  if (d.kind === 'leader') return `${d.morale}-${d.leadership} leader`;
  if (d.kind === 'sw') return d.type;
  if (d.kind === 'vehicle') return d.name;
  if (d.kind === 'unknown') return '?';
  return `${d.fp}-${d.range}-${d.morale}${d.kind === 'hs' ? ' HS' : d.kind === 'crew' ? ' crew' : ''}`;
};

/**
 * Why the side's setup breaks a force's card constraints (distance from buildings, Gun spacing,
 * nationalities not sharing a hex), or null. With `partial`, rules that need every piece placed
 * ("within 5 hexes of another Gun") wait until they all are.
 */
export function constraintViolation(env: QueryEnv, side: SideId, placements: Record<PieceId, LocId>, _partial = false, sw: Record<PieceId, PieceId> = {}): string | null {
  const sc = statics(env).scenario;
  const map = statics(env).map;
  const pieces = Object.values(env.state.pieces).filter((p) => p.side === side && p.loc.kind !== 'eliminated').sort(byId);
  const at = (p: Piece) => setupPosition(env, p, placements, sw);
  const buildingHexes = [...map.hexes()].filter((h) => !!h.buildingId);
  for (const [fi, force] of sc.forces.entries()) {
    if (force.side !== side || force.setup.kind === 'enter' || force.setup.kind === 'scatter' || !force.setup.constraints) continue;
    for (const c of force.setup.constraints) {
      switch (c.kind) {
        case 'awayFromBuildings': {
          for (const p of pieces.filter((x) => c.defs.includes(x.defId))) {
            const hex = at(p);
            if (!hex) continue;
            const near = buildingHexes.find((b) => map.distance(b.id, hex) < c.atLeast);
            if (near) return `${defName(env, p.defId)} in ${hex} must be at least ${c.atLeast} hexes from every building (${near.id})`;
          }
          break;
        }
        case 'spacing': {
          const placed = pieces.filter((x) => c.defs.includes(x.defId)).map((p) => ({ p, hex: at(p) }));
          const located = placed.filter((x): x is { p: Piece; hex: HexId } => !!x.hex);
          for (const a of located) {
            for (const b of located) {
              if (a.p.id >= b.p.id) continue;
              const d = map.distance(a.hex, b.hex);
              if (c.atLeast !== undefined && d < c.atLeast) {
                // "with no more than one MMC per hex and not adjacent to any other MMC" (S17) names several defs.
                if (a.p.defId !== b.p.defId) return `${defName(env, a.p.defId)} and ${defName(env, b.p.defId)} must be at least ${c.atLeast} hexes apart (${a.hex}, ${b.hex})`;
                if (d === 0) return `${defName(env, a.p.defId)}s may not share a hex (${a.hex})`;
                return c.atLeast === 2
                  ? `${defName(env, a.p.defId)}s may not be adjacent to each other (${a.hex}, ${b.hex})`
                  : `${defName(env, a.p.defId)}s must be at least ${c.atLeast} hexes apart (${a.hex}, ${b.hex})`;
              }
            }
          }
          if (c.withinOfAnother !== undefined && located.length === placed.length && located.length > 1) {
            for (const a of located) {
              const ok = located.some((b) => b.p.id !== a.p.id && map.distance(a.hex, b.hex) <= c.withinOfAnother!);
              if (!ok) return `${defName(env, a.p.defId)} in ${a.hex} must be within ${c.withinOfAnother} hexes of at least one other`;
            }
          }
          break;
        }
        case 'inFortifiedBuilding': {
          for (const p of pieces.filter((x) => x.tags['force'] === fi && isPersonnelDef(defOf(env, x)))) {
            const hex = at(p);
            if (!hex) continue;
            if (!env.query('hex.fortified', { hex }, false)) return `${defName(env, p.defId)} must set up in the fortified building (${hex})`;
          }
          break;
        }
        case 'notEnemyControlled': {
          const held = controlledHexes(env);
          for (const p of pieces.filter((x) => x.tags['force'] === fi && isPersonnelDef(defOf(env, x)))) {
            const hex = at(p);
            if (!hex) continue;
            if (held[hex] && held[hex] !== side) return `${defName(env, p.defId)} may not set up in a hex the enemy Controls (${hex})`;
          }
          break;
        }
        case 'maxMmcIn': {
          const inside = new Set(c.hexes.map((h) => map.hex(h)?.id ?? h));
          const there = pieces.filter((x) => x.tags['force'] === fi && mmc(env, x) && inside.has(map.hex(at(x) ?? '')?.id ?? ''));
          if (there.length > c.atMost) return `No more than ${c.atMost} MMC may set up in ${c.label} (${there.map((x) => at(x)).join(', ')})`;
          break;
        }
        case 'withMmc': {
          // Judged once the side's MMC are down, so a leader may be placed before them.
          const mmcs = pieces.filter((x) => mmc(env, x));
          if (_partial && mmcs.some((x) => !at(x))) break;
          for (const p of pieces.filter((x) => x.tags['force'] === fi && smc(env, x))) {
            const hex = at(p);
            if (!hex) continue;
            if (!mmcs.some((x) => at(x) === hex)) return `${defName(env, p.defId)} must set up with a MMC (${hex})`;
          }
          break;
        }
        case 'onTerrain': {
          for (const p of pieces.filter((x) => x.tags['force'] === fi && c.defs.includes(x.defId))) {
            const hex = at(p);
            if (!hex || !map.hex(hex)) continue;
            if (!c.terrains.includes(terrainOf(env, hex).id) && !(c.road && isRoadHex(env, hex))) {
              const names = [...(c.road ? ['road'] : []), ...c.terrains.map((t) => statics(env).terrain[t]?.name ?? t)];
              return `${defName(env, p.defId)} may set up only in ${names.join(', ')} hexes (${hex})`;
            }
          }
          break;
        }
        case 'minWithin': {
          // Minimums: judged only once every piece of the force is down.
          if (_partial) break;
          const short = setupAnchorProgress(env, side, placements, sw)
            .filter((a) => a.force === fi)
            .find((a) => a.counts.some((c) => c.have < c.need));
          if (short) {
            const missing = short.counts.filter((c) => c.have < c.need).map((c) => `${c.need} ${c.label} (${c.have} now)`);
            return `At least ${missing.join(', ')} must set up within ${c.range} hexes of ${short.anchor.replace(/^[a-z]+/, '')}`;
          }
          break;
        }
        case 'nearVehicle': {
          // Judged once the side's vehicles are down, so the infantry may be placed before them.
          const vehicles = pieces.filter((x) => isVehicleDef(defOf(env, x)) && x.tags['wreck'] !== true);
          if (_partial && vehicles.some((x) => !at(x))) break;
          const spots = vehicles.map(at).filter((h): h is HexId => !!h && !!map.hex(h));
          const lo = c.atLeast ?? 0;
          for (const p of pieces.filter((x) => x.tags['force'] === fi && isPersonnelDef(defOf(env, x)))) {
            const hex = at(p);
            if (!hex || !map.hex(hex)) continue;
            if (!spots.some((v) => map.distance(v, hex) <= c.atMost && map.distance(v, hex) >= lo)) {
              const where = c.atMost === 1 && lo === 1 ? 'adjacent to' : lo > 0 ? `${lo}-${c.atMost} hexes from` : `within ${c.atMost} hex${c.atMost === 1 ? '' : 'es'} of`;
              return `${defName(env, p.defId)} must set up ${where} a friendly vehicle (${hex})`;
            }
          }
          break;
        }
        case 'notOnPavedRoad': {
          for (const p of pieces.filter((x) => c.defs.includes(x.defId))) {
            const hex = at(p);
            if (!hex || !map.hex(hex)) continue;
            if (map.hex(hex)!.features.includes('road:paved')) return `${defName(env, p.defId)} may not set up on a paved road (${hex})`;
          }
          break;
        }
        case 'notWithNationalities': {
          for (const p of pieces.filter((x) => x.tags['force'] === fi && isPersonnelDef(defOf(env, x)))) {
            const hex = at(p);
            if (!hex) continue;
            const other = pieces.find(
              (x) => x.id !== p.id && isPersonnelDef(defOf(env, x)) && c.nationalities.includes(defOf(env, x).nationality) && at(x) === hex,
            );
            if (other) return `${defName(env, p.defId)} may not set up in a hex with ${defName(env, other.defId)} (${hex})`;
          }
          break;
        }
      }
    }
  }
  return null;
}

/** One anchor hex of a `minWithin` setup constraint and how many of each kind of piece stand within range of it. */
export interface SetupAnchorProgress {
  force: number;
  anchor: HexId;
  range: number;
  counts: { kind: 'mmc' | 'smc' | 'sw'; label: string; need: number; have: number }[];
}

/**
 * The `minWithin` setup constraints of the side's forces (LMA9 SSR 1: "at least 4 MMC, 1 leader and 1 SW within two
 * hexes of each deployment hex"), anchor by anchor, counted over the placements so far (and the SW handed out in
 * `sw`). Empty when no force of the side has one. A piece within range of two anchors counts for both.
 */
export function setupAnchorProgress(env: QueryEnv, side: SideId, placements: Record<PieceId, LocId>, sw: Record<PieceId, PieceId> = {}): SetupAnchorProgress[] {
  const sc = statics(env).scenario;
  const map = statics(env).map;
  const out: SetupAnchorProgress[] = [];
  const pieces = Object.values(env.state.pieces).filter((p) => p.side === side && p.loc.kind !== 'eliminated').sort(byId);
  for (const [fi, force] of sc.forces.entries()) {
    if (force.side !== side || (force.setup.kind !== 'area' && force.setup.kind !== 'hexes')) continue;
    for (const c of force.setup.constraints ?? []) {
      if (c.kind !== 'minWithin') continue;
      // A weapon belongs to the force of the unit holding it (it carries no force tag of its own).
      const forceTag = (p: Piece): unknown => p.tags['force'] ?? (p.loc.kind === 'held' && env.state.pieces[p.loc.by] ? forceTag(env.state.pieces[p.loc.by]!) : undefined);
      const mine = pieces.filter((p) => forceTag(p) === fi);
      for (const anchor of c.anchors) {
        const near = (p: Piece) => {
          const hex = setupPosition(env, p, placements, sw);
          return !!hex && !!map.hex(hex) && !!map.hex(anchor) && map.distance(hex, anchor) <= c.range;
        };
        const counts: SetupAnchorProgress['counts'] = [];
        if (c.mmc) counts.push({ kind: 'mmc', label: 'MMC', need: c.mmc, have: mine.filter((p) => !!mmc(env, p) && near(p)).length });
        if (c.smc) counts.push({ kind: 'smc', label: c.smc === 1 ? 'leader' : 'leaders', need: c.smc, have: mine.filter((p) => !!smc(env, p) && near(p)).length });
        if (c.sw) counts.push({ kind: 'sw', label: 'SW', need: c.sw, have: mine.filter((p) => isWeaponDef(defOf(env, p)) && !isVehicleDef(defOf(env, p)) && near(p)).length });
        out.push({ force: fi, anchor, range: c.range, counts });
      }
    }
  }
  return out;
}

/**
 * Why a setup's SW assignments (SW id → the unit to possess it) are illegal, or null. At setup a
 * SW may be given to any unit of its own group that is being set up, MMC or SMC alike, whatever
 * hex each is placed in; it just may not set up unpossessed (SK1 4.0).
 */
export function swAssignmentIllegal(env: QueryEnv, side: SideId, todo: Piece[], sw: Record<PieceId, PieceId>): string | null {
  const ids = new Set(todo.map((p) => p.id));
  for (const [swId, holder] of Object.entries(sw)) {
    const s = env.state.pieces[swId];
    const h = env.state.pieces[holder];
    if (!s || !h || s.side !== side || h.side !== side || !isWeaponDef(defOf(env, s))) return 'Invalid SW assignment';
    if (s.loc.kind !== 'held' || !ids.has(s.loc.by)) return `${swId} is not a SW being set up`;
    if (!ids.has(holder) || !(mmc(env, h) || smc(env, h))) return `${swId} can only be given to a unit being set up`;
    const owner = pieceOf(env, s.loc.by);
    if (owner.tags['force'] !== h.tags['force']) {
      const group = statics(env).scenario.forces[owner.tags['force'] as number]?.group;
      return `${swId} belongs to ${group ? `"${group}"` : 'another group'} and must set up with one of its units`;
    }
  }
  return null;
}

/** Hand each SW to the unit the setup gave it (the assignments having passed `swAssignmentIllegal`). */
function applySwAssignments(ctx: Ctx, sw: Record<PieceId, PieceId> | undefined) {
  for (const [swId, holder] of Object.entries(sw ?? {}).sort()) {
    const s = pieceOf(ctx, swId);
    if (s.loc.kind === 'held' && s.loc.by === holder) continue;
    ctx.emit('piece.moved', { id: swId, loc: { kind: 'held', by: holder } });
  }
}

/**
 * A legal default placement (round-robin over each piece's hexes within stacking limits, offboard
 * units near the middle of their edge), keeping any placements already made. Null if impossible.
 */
export function defaultPlacement(
  env: QueryEnv,
  side: SideId,
  todo: Piece[],
  existing: Record<PieceId, HexId> = {},
): Record<PieceId, HexId> | null {
  const placements: Record<PieceId, HexId> = { ...existing };
  const sc = statics(env).scenario;
  const map = statics(env).map;
  // The spacing constraints a piece is under (through the weapons it carries too), for ranking hexes.
  const spacingOf = (p: Piece) => {
    const defs = [p.defId, ...swHeldBy(env.state, p.id).map((w) => w.defId)];
    const f = sc.forces[p.tags['force'] as number];
    const cs = f && (f.setup.kind === 'hexes' || f.setup.kind === 'area') ? (f.setup.constraints ?? []) : [];
    return cs.filter((c): c is Extract<SetupConstraint, { kind: 'spacing' }> => c.kind === 'spacing' && c.defs.some((d) => defs.includes(d)));
  };
  // Constrained pieces first (so the rest fits around them), then MMC so SMC can join them within the per-hex limits.
  // Under anchor minimums (`minWithin`), units carrying SW go first so the weapons spread over the anchors.
  const anchored = (p: Piece) => {
    const f = sc.forces[p.tags['force'] as number];
    const cs = f && (f.setup.kind === 'hexes' || f.setup.kind === 'area') ? (f.setup.constraints ?? []) : [];
    return cs.some((c) => c.kind === 'minWithin') ? swHeldBy(env.state, p.id).length : 0;
  };
  // Units that must set up near a vehicle (LMA4 SSR 3) go after the vehicles.
  const nearVehicle = sc.forces.some((f) => f.side === side && (f.setup.kind === 'hexes' || f.setup.kind === 'area') && f.setup.constraints?.some((c) => c.kind === 'nearVehicle'));
  const vehicleFirst = (p: Piece) => (nearVehicle && !isVehicleDef(defOf(env, p)) ? 1 : 0);
  const order = [...todo].sort((a, b) => vehicleFirst(a) - vehicleFirst(b) || Number(spacingOf(a).length === 0) - Number(spacingOf(b).length === 0) || Number(!mmc(env, a)) - Number(!mmc(env, b)) || anchored(b) - anchored(a));
  for (const p of order) {
    if (placements[p.id]) continue;
    const options = placementHexes(env, p);
    // Offboard: prefer hexes near the middle of the edge.
    const mid = options[Math.floor(options.length / 2)];
    // Spacing: prefer a hex within reach of a piece already placed under the same rule.
    const anchors = spacingOf(p).flatMap((c) =>
      todo
        .filter((o) => o.id !== p.id && placements[o.id] && [o.defId, ...swHeldBy(env.state, o.id).map((w) => w.defId)].some((d) => c.defs.includes(d)))
        .map((o) => ({ hex: placements[o.id]!, near: c.withinOfAnother ?? Infinity, far: c.atLeast ?? 0 })),
    );
    const spacingRank = (h: HexId) =>
      anchors.length === 0 ? 0 : Math.min(...anchors.map((a) => {
        const d = map.distance(h, a.hex);
        return d >= a.far && d <= a.near ? 0 : d < a.far ? 100 : d - a.near;
      }));
    // Anchor minimums (`minWithin`): prefer the anchor where this piece (and the SW it carries) fills the most shortfalls.
    const fills = anchorFills(env, side, p, placements);
    const anchorRank = (h: HexId) => (fills.length === 0 ? 0 : 10 * (Math.max(...fills.map((f) => f.gain)) - Math.max(0, ...fills.filter((f) => map.distance(h, f.anchor) <= f.range).map((f) => f.gain))));
    const rank = (h: HexId) => (p.loc.kind === 'offboard' && p.loc.edge !== 'setup' && mid ? Math.abs(options.indexOf(h) - options.indexOf(mid)) : 0) + spacingRank(h) + anchorRank(h);
    const used = (h: HexId) => Object.values(placements).filter((x) => x === h).length;
    const sorted = [...options].sort((a, b) => rank(a) - rank(b) || used(a) - used(b) || (a < b ? -1 : 1));
    const hex = sorted.find((h) => !placementIllegal(env, side, todo, { ...placements, [p.id]: h }, true) && !env.query('setup.hexIllegal', { side, unit: p.id, hex: h }, null));
    if (!hex) return null;
    placements[p.id] = hex;
  }
  return placements;
}

/**
 * For a piece about to be placed by default: each `minWithin` anchor of its force and how many of that anchor's
 * shortfalls (MMC, leaders, SW it carries) placing it there would make up, given the placements so far.
 */
function anchorFills(env: QueryEnv, side: SideId, p: Piece, placements: Record<PieceId, LocId>): { anchor: HexId; range: number; gain: number }[] {
  const progress = setupAnchorProgress(env, side, placements).filter((a) => a.force === p.tags['force']);
  if (progress.length === 0) return [];
  const carried = swHeldBy(env.state, p.id).filter((w) => !isVehicleDef(defOf(env, w))).length;
  return progress.map((a) => {
    let gain = 0;
    for (const c of a.counts) {
      const adds = c.kind === 'mmc' ? (mmc(env, p) ? 1 : 0) : c.kind === 'smc' ? (smc(env, p) ? 1 : 0) : carried;
      gain += Math.min(adds, Math.max(0, c.need - c.have));
    }
    return { anchor: a.anchor, range: a.range, gain };
  });
}

export const scenarioModule: RuleModule = {
  id: 'sk1.scenario',
  ref: 'SK1 1.3, 3.3, 3.9',
  summary: 'Scenario setup, reinforcements, Control and victory conditions.',
  requires: ['common.pieces', 'common.turn', 'sk1.status'],
  install(r) {
    r.event<{ state: ControlState }>({
      type: 'sk1.control',
      apply(d, p) {
        d.ext[CONTROL] = p.state;
      },
    });
    /** Units held back at an offboard setup under a reserve rule, to enter on `turn` from `edges`. */
    r.event<{ side: SideId; pieces: PieceId[]; turn: number; edges: string[]; label: string | null }>({ type: 'sk1.reserve', apply() {} });
    r.event<{ unit: PieceId; side: SideId; vp: number }>({
      type: 'sk1.exited',
      apply(d, p) {
        const list = (d.ext[EXITED] as { unit: PieceId; side: SideId; vp: number }[] | undefined) ?? [];
        list.push(p);
        d.ext[EXITED] = list;
        d.pieces[p.unit]!.loc = { kind: 'offboard', edge: 'exited' };
      },
    });
    r.event<Casualty>({
      type: 'sk1.casualty',
      apply(d, p) {
        const list = (d.ext[CASUALTIES] as Casualty[] | undefined) ?? [];
        list.push(p);
        d.ext[CASUALTIES] = list;
      },
    });
    // The ledger: every eliminated personnel unit at its counter's CVP value...
    r.on<{ id: PieceId; reason: string }>({
      id: 'sk1.casualties.eliminated',
      event: 'piece.eliminated',
      handler(ctx, ev) {
        const p = ctx.state.pieces[ev.payload.id];
        if (!p) return;
        const vp = ctx.query('vp.casualty', { unit: p.id }, 0);
        if (vp <= 0) return;
        ctx.emit('sk1.casualty', { unit: p.id, side: p.side, kind: 'eliminated', defId: p.defId, vp, turn: ctx.state.turn, phase: ctx.state.phase, reason: ev.payload.reason });
      },
    });
    // ...and 1 CVP for a squad Casualty Reduced to a half-squad (the half-squad's loss adds the other 1).
    r.on<{ unit: PieceId; from: string; to: string; reason: string }>({
      id: 'sk1.casualties.reduced',
      event: 'sk1.casualtyReduced',
      handler(ctx, ev) {
        const p = ctx.state.pieces[ev.payload.unit];
        if (!p) return;
        ctx.emit('sk1.casualty', { unit: p.id, side: p.side, kind: 'reduced', defId: ev.payload.from, vp: 1, turn: ctx.state.turn, phase: ctx.state.phase, reason: ev.payload.reason });
      },
    });

    r.contribute({
      id: 'sk1.vp.casualty',
      query: 'vp.casualty',
      layer: 0,
      // Squad 2, half-squad 1, leader 1 (+1 per negative leadership step). Verify against scenario cards.
      apply(_v, { unit }, env) {
        const d = defOf(env, pieceOf(env, unit));
        if (isMmcDef(d)) return d.kind === 'squad' ? 2 : 1;
        if (d.kind === 'leader') return 1 + Math.max(0, -d.leadership);
        return 0;
      },
    });
    r.contribute({
      id: 'sk1.vp.exit',
      query: 'vp.exit',
      layer: 0,
      apply(_v, { unit }, env) {
        const p = pieceOf(env, unit);
        const vc = exitVpCondition(statics(env).scenario, p.side);
        if (vc?.leaderVp !== undefined && defOf(env, p).kind === 'leader') return vc.leaderVp;
        return env.query('vp.casualty', { unit }, 0);
      },
    });

    // Create every piece in the scenario OB. Fixed positions are placed directly;
    // areas are left for the owning player's setup decision.
    r.setup({
      id: 'sk1.scenario.create',
      priority: 0,
      run(ctx) {
        const sc = statics(ctx).scenario;
        sc.forces.forEach((force, fi) => {
          // Fixed setup: one hex per piece of the force, assigned in order.
          const total = force.units.reduce((a, u) => a + u.count, 0);
          const fixedHexes = force.setup.kind === 'hexes' && force.setup.hexes.length === total ? [...force.setup.hexes] : null;
          force.units.forEach((u, ui) => {
            const ids = forcePieceIds(force.side, fi, ui, u.def, u.count);
            ids.forEach((id) => {
              const fixed = fixedHexes?.shift();
              const loc =
                force.setup.kind === 'enter'
                  ? ({ kind: 'offboard', edge: force.setup.edge } as const)
                  : force.setup.kind === 'scatter'
                    ? ({ kind: 'offboard', edge: 'scatter' } as const)
                    : fixed
                    ? ({ kind: 'hex', hex: fixed } as const)
                    : ({ kind: 'offboard', edge: 'setup' } as const);
              const tags: Record<string, string | number> = { force: fi };
              if (force.setup.kind === 'enter') {
                tags['entryTurn'] = force.setup.turn;
                tags['entryEdge'] = force.setup.edge;
                if (force.setup.hexes) tags['entryHexes'] = force.setup.hexes.join(',');
                // Infantry enter with MF, vehicles with MP (or half their allowance), already expended per the card.
                const spent = force.setup.mfSpent ?? force.setup.mpSpent;
                if (spent) tags['entryMfSpent'] = spent;
                if (force.setup.provisional) {
                  // Provisional reinforcements are not due until the RPh dr releases them (below).
                  tags['entryRoll'] = typeof force.setup.provisional === 'string' ? force.setup.provisional : 'drAtMost' in force.setup.provisional ? 'drAtMost' : 'drBelowTurnTimes';
                  tags['entryFrom'] = force.setup.turn;
                  tags['entryTurn'] = 0;
                }
              }
              ctx.emit('piece.created', { piece: { id, defId: u.def, side: force.side, loc, tags } });
              (u.withSw ?? []).forEach((swDef, si) => {
                ctx.emit('piece.created', {
                  piece: { id: `${id}.sw${si + 1}`, defId: swDef, side: force.side, loc: { kind: 'held', by: id }, tags: {} },
                });
              });
            });
          });
        });
        // Control the card hands a side at the start, before anyone sets up.
        if (sc.initialControl?.length) {
          const map = statics(ctx).map;
          const prev = controlState(ctx);
          const hexes = { ...prev.hexes };
          for (const c of sc.initialControl) for (const h of c.hexes) hexes[map.hex(h)?.id ?? h] = c.side;
          ctx.emit('sk1.control', { state: { ...prev, hexes } });
        }
        // Players with units still to place get setup decisions (setupFirst side first); a side's
        // "set up last" forces wait in a decision of their own below every side's first.
        const order = [...sc.sides].sort((a, b) => Number(!!b.setupFirst) - Number(!!a.setupFirst)).map((s) => s.side);
        for (const side of [...order].reverse()) {
          if (unplaced(ctx, side, 'last').length > 0) {
            ctx.pushDecision({ kind: SETUP_DECISION, owner: side, deadlineClass: 'turn', data: { phase: 'setup', stage: 'last' } });
          }
        }
        for (const side of [...order].reverse()) {
          if (unplaced(ctx, side, 'first').length > 0) {
            ctx.pushDecision({ kind: SETUP_DECISION, owner: side, deadlineClass: 'turn', data: { phase: 'setup', stage: 'first' } });
          }
        }
      },
    });

    r.procedure<SetupPlacedFn>(SETUP_PLACED, () => () => {});
    r.action<SetupAction>({
      type: 'setup.place',
      decisionKinds: [SETUP_DECISION],
      // A default placement for AI and tests; players place units themselves.
      legal(env, d) {
        const todo = piecesToPlace(env, d);
        const placements = defaultPlacement(env, d.owner, todo);
        if (!placements) return [];
        return [{ type: 'setup.place', placements, ...env.query('setup.defaults', { side: d.owner, todo: todo.map((p) => p.id), placements }, {}) }];
      },
      validate(env, a, d) {
        const todo = piecesToPlace(env, d);
        return (
          placementIllegal(env, d.owner, todo, a.placements, false, a.sw ?? {}) ??
          swAssignmentIllegal(env, d.owner, todo, a.sw ?? {}) ??
          env.query('setup.illegal', { side: d.owner, todo: todo.map((p) => p.id), action: a }, null)
        );
      },
      resolve(ctx, a, d) {
        for (const [id, loc] of Object.entries(a.placements).sort()) ctx.emit('piece.moved', { id, loc: locationAt(loc) });
        applySwAssignments(ctx, a.sw);
        ctx.proc<SetupPlacedFn>(SETUP_PLACED)(ctx, a, d);
        ctx.popDecision();
        if (ctx.state.decisions.length === 0) {
          // All setup done: hand over to the turn sequence.
          ctx.proc<(c: Ctx) => void>('sk1.scenario.begin')(ctx);
        }
      },
    });
    // RPh step (a), first: the ATTACKER rolls for any provisional (SSR) reinforcements. A force
    // that enters "on a dr < the current Turn number" rolls once per Player Turn from its first
    // possible turn; a success makes it due this Player Turn like any other reinforcement.
    r.on<{ phase: string }>({
      id: 'sk1.scenario.provisional-roll',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'RPh') return;
        const turn = ctx.state.turn;
        const waiting = Object.values(ctx.state.pieces)
          .filter(
            (p) =>
              p.side === ctx.state.attacker &&
              p.loc.kind === 'offboard' &&
              !p.loc.hex &&
              (p.tags['entryRoll'] === 'drBelowTurn' || p.tags['entryRoll'] === 'drAtMost' || p.tags['entryRoll'] === 'drBelowTurnTimes') &&
              p.tags['entryTurn'] === 0 &&
              turn >= (p.tags['entryFrom'] as number),
          )
          .sort(byId);
        const byForce = new Map<number, Piece[]>();
        for (const p of waiting) byForce.set(p.tags['force'] as number, [...(byForce.get(p.tags['force'] as number) ?? []), p]);
        for (const [fi, pieces] of [...byForce].sort(([a], [b]) => a - b)) {
          const force = statics(ctx).scenario.forces[fi]!;
          const prov = force.setup.kind === 'enter' ? force.setup.provisional : undefined;
          // A chart of circled numbers: a dr ≤ the turn's number; no roll on a turn the chart leaves out.
          const chart = prov && typeof prov !== 'string' && 'drAtMost' in prov ? prov.drAtMost : undefined;
          const atMost = chart?.[turn];
          if (chart && atMost === undefined) continue;
          // "Less than twice the number of the current turn" (LMA7 SSR 4): a multiple of the turn.
          const below = prov && typeof prov !== 'string' && 'drBelowTurnTimes' in prov ? turn * prov.drBelowTurnTimes : turn;
          const need = atMost !== undefined ? `≤ ${atMost}` : `< ${below}`;
          const dr = ctx.roll(`${force.group ?? 'Reinforcements'}: entry dr (needs ${need})`, 1).dice[0]!;
          if (atMost !== undefined ? dr <= atMost : dr < below) for (const p of pieces) setTags(ctx, p.id, { entryTurn: turn });
        }
      },
    });
    // RPh step (a): the ATTACKER sets up offboard all forces due to enter this Player Turn.
    // Registered after the RPh's own start handler, so this decision sits on top of it.
    r.on<{ phase: string }>({
      id: 'sk1.scenario.offboard-setup',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'RPh') return;
        if (dueOffboard(ctx, ctx.state.attacker).length === 0) return;
        ctx.pushDecision({ kind: OFFBOARD_SETUP_DECISION, owner: ctx.state.attacker, deadlineClass: 'turn', data: {} });
      },
    });
    r.action<SetupAction>({
      type: 'setup.offboard',
      decisionKinds: [OFFBOARD_SETUP_DECISION],
      legal(env, d) {
        const todo = dueOffboard(env, d.owner);
        const placements = defaultPlacement(env, d.owner, todo);
        return placements ? [{ type: 'setup.offboard', placements, ...env.query('setup.defaults', { side: d.owner, todo: todo.map((p) => p.id), placements }, {}) }] : [];
      },
      validate(env, a, d) {
        const todo = dueOffboard(env, d.owner);
        return (
          placementIllegal(env, d.owner, todo, a.placements, false, a.sw ?? {}) ??
          swAssignmentIllegal(env, d.owner, todo, a.sw ?? {}) ??
          reserveIllegal(env, d.owner, todo, a.placements, a.sw ?? {}) ??
          env.query('setup.illegal', { side: d.owner, todo: todo.map((p) => p.id), action: a }, null)
        );
      },
      resolve(ctx, a) {
        const decision = ctx.state.decisions[ctx.state.decisions.length - 1]!;
        const todo = dueOffboard(ctx, decision.owner);
        for (const [id, hex] of Object.entries(a.placements).sort()) {
          const p = pieceOf(ctx, id);
          ctx.emit('piece.moved', { id, loc: { kind: 'offboard', edge: p.loc.kind === 'offboard' ? p.loc.edge : undefined, hex } });
        }
        applySwAssignments(ctx, a.sw);
        // Units kept back (a reserve rule allowed it) enter later, from the edges it names.
        const kept = todo.filter((p) => !a.placements[p.id]).sort(byId);
        const byForce = new Map<number, Piece[]>();
        for (const p of kept) byForce.set(p.tags['force'] as number, [...(byForce.get(p.tags['force'] as number) ?? []), p]);
        for (const [, pieces] of [...byForce].sort(([x], [y]) => x - y)) {
          const rule = reserveRuleFor(ctx, pieces[0]!)!;
          const map = statics(ctx).map;
          const hexes = [...new Set(rule.edges.flatMap((e) => map.edge(e)))].join(',');
          // Their offboard edge becomes the rule's too: movement reads it before the entry tag (S6: otherwise a reserve staged on
          // the east edge could only slide along it).
          for (const p of pieces) {
            ctx.emit('piece.moved', { id: p.id, loc: { kind: 'offboard', edge: rule.edges.join(',') } });
            setTags(ctx, p.id, { entryTurn: rule.turn, entryEdge: rule.edges.join(','), entryHexes: hexes, reserve: rule.label ?? 'tactical reserve' });
          }
          ctx.emit('sk1.reserve', { side: pieces[0]!.side, pieces: pieces.map((p) => p.id), turn: rule.turn, edges: rule.edges, label: rule.label ?? null });
        }
        // Other rule packs' setup extras (a vehicle's facing, SK3) apply to an offboard setup too.
        ctx.proc<SetupPlacedFn>(SETUP_PLACED)(ctx, a, decision);
        ctx.popDecision();
      },
    });

    r.procedure<(c: Ctx) => void>('sk1.scenario.begin', () => (ctx) => {
      ctx.emit('turn.playerTurn', { turn: 1, attacker: statics(ctx).scenario.firstSide });
      advancePhase(ctx);
    });

    r.action<Action & { unit: PieceId }>({
      type: 'move.exit',
      decisionKinds: ['phase'],
      // Each moving unit that may step off from where it stands now (the UI offers these; without them it
      // never shows the choice at all).
      legal(env, d) {
        const ms = env.state.phase === 'MPh' ? moveState(env) : null;
        if (!ms) return [];
        return ms.units.filter((unit) => exitRefusal(env, d.owner, unit) === null).map((unit) => ({ type: 'move.exit' as const, unit }));
      },
      validate: (env, a) => exitRefusal(env, a.side, a.unit),
      resolve(ctx, a) {
        ctx.emit('sk1.exited', { unit: a.unit, side: a.side, vp: ctx.query('vp.exit', { unit: a.unit }, 0) });
        // SW stay held by the exited unit and leave the map with it.
        const ms = moveState(ctx)!;
        const rest = ms.units.filter((u) => u !== a.unit);
        ctx.emit('sk1.move.state', { state: rest.length ? ({ ...ms, units: rest } satisfies MoveState) : null });
        ctx.popDecision();
        ctx.pushDecision({ kind: 'phase', owner: ctx.state.attacker, deadlineClass: 'turn', data: { phase: 'MPh' } });
      },
    });

    // Stepping off the map from an exit hex (the ordinary move step, into the offboard hex beyond the edge): the whole
    // stack exits, each unit as `move.exit` would (exiting one unit at a time from the wheel
    // is easily missed, leaving a stack sitting on the exit hexes at game end).
    r.contribute({
      id: 'sk1.exit.step',
      query: 'move.exitIllegal',
      apply(_v, { ms, to }, env) {
        if (env.state.phase !== 'MPh') return 'Units exit during the MPh';
        const side = env.state.attacker;
        for (const unit of ms.units) {
          const why = exitRefusal(env, side, unit);
          if (why) return why;
        }
        const cost = env.query('move.stepCost', { ms, to }, 1);
        const viaRoad = statics(env).map.roadHexside?.(ms.hex!, to) ?? false;
        for (const unit of ms.units) {
          const left = (ms.allowance[unit] ?? 0) - (ms.spent[unit] ?? 0) + (ms.roadOnly && viaRoad ? 1 : 0);
          if (cost > left) return `Exiting here costs ${cost} MF (${unit} has ${left})`;
        }
        return null;
      },
    });
    // Advancing off the map (ASLRB A2.6, "normal MPh/APh capabilities"; SK4 3.3: Good Order units exiting as part of the
    // VC, as if the offboard hex were Open Ground): from a hex the side may exit from now.
    r.contribute({
      id: 'sk1.scenario.advance-exit',
      query: 'advance.exitIllegal',
      ref: 'ASLRB A2.6; SK4 3.3',
      apply(_v, { units, side }, env) {
        for (const unit of units) {
          const p = env.state.pieces[unit];
          if (!p || p.loc.kind !== 'hex') return 'Not your unit on the map';
          if (!isGoodOrder(env, p)) return 'Only Good Order units may exit';
          const allowed = exitHexes(env, side, unit);
          if (allowed === null) return 'This scenario does not allow exiting';
          if (allowed.size === 0) return 'Exiting is not allowed yet this turn';
          if (!allowed.has(p.loc.hex)) return `Units exit from ${describeExits(env, side)}`;
        }
        return null;
      },
    });
    r.procedure<AdvanceExitFn>(AP.exit, (next) => (ctx, units, to) => {
      next?.(ctx, units, to);
      for (const unit of units) ctx.emit('sk1.exited', { unit, side: pieceOf(ctx, unit).side, vp: ctx.query('vp.exit', { unit }, 0) });
    });
    r.procedure<MoveExitFn>(MOVE_EXIT, () => (ctx, ms) => {
      const side = ctx.state.attacker;
      for (const unit of [...ms.units].sort()) ctx.emit('sk1.exited', { unit, side, vp: ctx.query('vp.exit', { unit }, 0) });
      ctx.emit('sk1.move.state', { state: null });
      const top = ctx.state.decisions[ctx.state.decisions.length - 1];
      if (top?.kind === 'phase') ctx.popDecision(top.id);
      if (!ctx.state.result) ctx.pushDecision({ kind: 'phase', owner: ctx.state.attacker, deadlineClass: 'turn', data: { phase: 'MPh' } });
    });

    // Control is gained the moment a Good Order MMC occupies a hex with no enemy present
    // (SK1 2.0), so it is re-evaluated after every event that can change who is where or
    // in what state, not at the end of the phase.
    // hex.marker: a Melee counter coming off restores Good Order (SK1 2.0 "Good Order").
    // Of the tags, only broken (Good Order) and wreck (AFV Control) count.
    for (const event of ['piece.created', 'piece.moved', 'piece.eliminated', 'piece.tagged', 'piece.replaced', 'hex.marker']) {
      r.on({
        id: `sk1.scenario.control.${event}`,
        event,
        handler: (ctx, e) => {
          if (event === 'piece.tagged' && !CONTROL_TAGS.some((t) => t in (e.payload as { tags: Record<string, unknown> }).tags)) return;
          updateControl(ctx);
        },
      });
    }

    // "Win immediately": a Control condition worded so ends the game the moment Control changes
    // to satisfy it, before the other side gets to shoot back in the same phase.
    r.on({
      id: 'sk1.vc.immediate-control',
      event: 'sk1.control',
      handler(ctx) {
        if (ctx.state.result) return;
        for (const vc of statics(ctx).scenario.victory) {
          if ((vc.kind === 'controlHexes' || vc.kind === 'controlBuildings') && vc.immediate && achieved(ctx, vc)) {
            ctx.endGame({ winner: vc.side, reason: 'sudden death' });
            return;
          }
        }
      },
    });
    // A side with no units left has lost, whatever the scenario's VC say: the game ends at once, as
    // nothing is left to play for (a blanket rule of this game, 2026-11-01). Checked when the next
    // decision is asked, so the attack that did it, and anything it brings (a crew surviving its
    // tank, Leader Loss), is over first.
    r.on({
      id: 'sk1.vc.annihilation',
      event: 'decision.pushed',
      handler(ctx) {
        if (ctx.state.result || ctx.state.phase === 'setup') return;
        const sc = statics(ctx).scenario;
        const sides = sc.sides.map((s) => s.side);
        // Only a side the card gives a force to can be wiped out.
        const gone = sides.filter((side) => sc.forces.some((f) => f.side === side) && !hasUnitsLeft(ctx, side));
        if (gone.length !== 1) return;
        ctx.endGame({ winner: sides.find((s) => s !== gone[0]) ?? null, reason: 'annihilation' });
      },
    });
    r.contribute({
      id: 'sk1.vc.winner',
      query: 'game.winner',
      layer: 0,
      apply: (_v, _c, env) => evaluateVictory(env),
    });
    r.contribute({
      id: 'sk1.vc.sudden-death',
      query: 'game.suddenDeath',
      layer: 0,
      apply(v, { phase }, env) {
        if (v) return v;
        // CVP and exit VP thresholds win immediately once reached, as do Control conditions the
        // card words "win immediately".
        for (const vc of statics(env).scenario.victory) {
          if (vc.kind === 'eliminateCvp' && !vc.atGameEnd && casualtyVp(env, otherSide(env.state, vc.side)) >= cvpGoal(env, vc)) return vc.side;
          if (vc.kind === 'exitVp' && exitVpMet(env, vc)) return vc.side;
          if (vc.kind === 'exitForce' && achieved(env, vc)) return vc.side;
          // An immediate VP tally counts its game-end sources (Control at game end) only when the game ends.
          if (vc.kind === 'vpTally') {
            if (vc.immediate && vpTally(env, vc, { midGame: true }).total >= vc.vp) return vc.side;
            continue;
          }
          if (isImmediate(vc) && achieved(env, vc)) return vc.side;
          // "At the end of any of his MPh": judged as that phase of the side's own Player Turn ends.
          if (atEndOfPhase(vc) === phase && env.state.attacker === vc.side && achieved(env, vc)) return vc.side;
          // "Win automatically at the end of Game Turn 4": judged as the second player's last phase of that turn ends.
          const t = atEndOfTurn(vc);
          if (t !== undefined && t === env.state.turn && env.state.attacker !== statics(env).scenario.firstSide) {
            const phases = env.query('turn.phases', {}, []);
            if (phase === phases[phases.length - 1] && achieved(env, vc)) return vc.side;
          }
        }
        return null;
      },
    });
  },
};

/** A side's units still to set up: all of them, or only those of its first-stage or "set up last" forces. */
function unplaced(env: QueryEnv, side: SideId, stage?: 'first' | 'last') {
  const forces = statics(env).scenario.forces;
  const last = (p: Piece) => forces[p.tags['force'] as number]?.setupStage === 'last';
  return Object.values(env.state.pieces)
    .filter((p) => p.side === side && p.loc.kind === 'offboard' && p.loc.edge === 'setup' && (stage === undefined || last(p) === (stage === 'last')))
    .sort(byId);
}

const CONTROL_TAGS = ['broken', 'wreck'];

/** Update hex/building Control: Good Order MMC in a location with no enemy units (SK1 2.0). */
export function updateControl(ctx: Ctx) {
  const prev = controlState(ctx);
  const next: ControlState = { hexes: prev.hexes, buildings: { ...prev.buildings } };
  // Hex Control is copied on the first change only: the map of hexes held grows all game.
  let hexesChanged = false;
  const setHex = (h: HexId, side: SideId | undefined) => {
    if (side === undefined ? !(h in next.hexes) : next.hexes[h] === side) return;
    if (!hexesChanged) {
      next.hexes = { ...next.hexes };
      hexesChanged = true;
    }
    if (side === undefined) delete next.hexes[h];
    else next.hexes[h] = side;
  };
  const map = statics(ctx).map;
  // Sides present anywhere in a hex; Good Order MMC at its ground level (Hex Control, A26.13), at any non-rooftop
  // level (Building Control, A26.14), and per upper-level Location (A26.11).
  const bySide = new Map<HexId, Set<SideId>>();
  const goodMmc = new Map<HexId, Set<SideId>>();
  const goodInBuilding = new Map<HexId, Set<SideId>>();
  const upperSides = new Map<LocId, Set<SideId>>();
  const upperGood = new Map<LocId, Set<SideId>>();
  const add = <K>(m: Map<K, Set<SideId>>, k: K, side: SideId) => m.set(k, (m.get(k) ?? new Set()).add(side));
  // Full ASL: "Control cannot be gained via Bypass" (ASLRB A26.11): units in Bypass (or broken or pinned there) gain it
  // only once the MPh is over and they are in the obstacle (A4.32, A4.33).
  const ms = moveState(ctx);
  const bypassing = ms?.bypass ? new Set([...ms.units, ...Object.keys(ms.stoppedBypass ?? {})]) : null;
  for (const p of Object.values(ctx.state.pieces)) {
    if (p.loc.kind !== 'hex' || !(mmc(ctx, p) || smc(ctx, p))) continue;
    const h = p.loc.hex;
    const ground = !p.loc.level && !p.loc.sub;
    const good = !!mmc(ctx, p) && isGoodOrder(ctx, p) && !isBroken(p) && !bypassing?.has(p.id);
    add(bySide, h, p.side);
    if (good && ground) add(goodMmc, h, p.side);
    if (good && p.loc.sub !== 'roof') add(goodInBuilding, h, p.side);
    if (!ground) {
      const loc = locKey(p.loc);
      add(upperSides, loc, p.side);
      if (good) add(upperGood, loc, p.side);
    }
  }
  for (const [h, sides] of goodMmc) {
    if (sides.size === 1 && (bySide.get(h)?.size ?? 0) === 1) setHex(h, [...sides][0]!);
  }
  // An AFV Controls the hex it presently occupies if no Good Order enemy unit is there; Control reverts
  // to its former condition when the AFV leaves (SK4 Definitions). Infantry Control above outranks it.
  const afv: Record<HexId, SideId | null> = {};
  const vehicleSides = new Map<HexId, Set<SideId>>();
  for (const p of Object.values(ctx.state.pieces)) {
    if (p.loc.kind !== 'hex' || !isVehicleDef(defOf(ctx, p)) || p.tags['wreck'] === true) continue;
    vehicleSides.set(p.loc.hex, (vehicleSides.get(p.loc.hex) ?? new Set()).add(p.side));
  }
  const infantryHeld = (h: HexId) => (goodMmc.get(h)?.size ?? 0) === 1 && (bySide.get(h)?.size ?? 0) === 1;
  for (const [h, sides] of vehicleSides) {
    if (sides.size !== 1) continue;
    const side = [...sides][0]!;
    const goodEnemy = [...(goodMmc.get(h) ?? [])].some((x) => x !== side) || personnelAt(ctx, h).some((p) => p.side !== side && smc(ctx, p) && isGoodOrder(ctx, p));
    if (goodEnemy || infantryHeld(h)) continue;
    afv[h] = prev.afv?.[h] !== undefined ? prev.afv[h]! : (next.hexes[h] ?? null);
    setHex(h, side);
  }
  for (const [h, former] of Object.entries(prev.afv ?? {})) {
    if (afv[h] !== undefined) continue;
    // The AFV has gone (or Infantry took over): back to what it was, unless Infantry hold it now.
    if (infantryHeld(h as HexId)) continue;
    setHex(h as HexId, former ?? undefined);
  }
  if (Object.keys(afv).length) next.afv = afv;
  // Buildings: controlled by a side with a Good Order MMC inside and no enemy units anywhere inside.
  for (const [b, hexes] of buildingHexes(map)) {
    const occupants = new Set(hexes.flatMap((h) => [...(bySide.get(h) ?? [])]));
    const good = new Set(hexes.flatMap((h) => [...(goodInBuilding.get(h) ?? [])]));
    if (good.size === 1 && occupants.size === 1) next.buildings[b] = [...good][0]!;
  }
  // Upper-level Locations: a Good Order MMC there with no enemy unit in the Location (A26.11).
  const locations = { ...(prev.locations ?? {}) };
  for (const [loc, sides] of upperGood) if (sides.size === 1 && (upperSides.get(loc)?.size ?? 0) === 1) locations[loc] = [...sides][0]!;
  if (Object.keys(locations).length) next.locations = locations;
  if (hexesChanged || !sameControl(next, prev)) ctx.emit('sk1.control', { state: next });
}

const buildingsOf = new WeakMap<GameMap, Map<string, HexId[]>>();
/** Each building's hexes (once per map: Control is re-evaluated after every piece event). */
function buildingHexes(map: GameMap): Map<string, HexId[]> {
  let buildings = buildingsOf.get(map);
  if (!buildings) {
    buildings = new Map();
    for (const h of map.hexes()) if (h.buildingId) buildings.set(h.buildingId, [...(buildings.get(h.buildingId) ?? []), h.id]);
    buildingsOf.set(map, buildings);
  }
  return buildings;
}

// Key order counts, as it did under the JSON comparison: an extra sk1.control event shifts decision ids.
const sameRecord = <T>(a: Record<string, T> | undefined, b: Record<string, T> | undefined): boolean => {
  const ka = a ? Object.keys(a) : [];
  const kb = b ? Object.keys(b) : [];
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a![k] === b![k]);
};
/** Whether Control other than the hexes' is unchanged, as `JSON.stringify` equality would say. */
const sameControl = (a: ControlState, b: ControlState): boolean =>
  sameRecord(a.buildings, b.buildings) && sameRecord(a.afv, b.afv) && sameRecord(a.locations, b.locations) && ('afv' in a) === ('afv' in b) && ('locations' in a) === ('locations' in b);

/** CVP `side` has lost: the sum of its casualty ledger. */
export function casualtyVp(env: QueryEnv, side: SideId): number {
  return casualties(env, side).reduce((a, c) => a + c.vp, 0);
}

export function exitVp(env: QueryEnv, side: SideId): number {
  const list = (env.state.ext[EXITED] as { side: SideId; vp: number }[] | undefined) ?? [];
  return list.filter((e) => e.side === side).reduce((a, e) => a + e.vp, 0);
}

/** Exit VP a side has scored with its vehicles. */
export function vehicleExitVp(env: QueryEnv, side: SideId): number {
  const list = (env.state.ext[EXITED] as { unit: PieceId; side: SideId; vp: number }[] | undefined) ?? [];
  return list.filter((e) => e.side === side && env.state.pieces[e.unit] && defOf(env, env.state.pieces[e.unit]!).kind === 'vehicle').reduce((a, e) => a + e.vp, 0);
}

/** Whether an exit VP condition is met: the VP, and the part of them the card wants from AFV. */
export function exitVpMet(env: QueryEnv, vc: VictoryCondition & { kind: 'exitVp' }): boolean {
  return exitVp(env, vc.side) >= vc.vp && (vc.afvVpAtLeast === undefined || vehicleExitVp(env, vc.side) >= vc.afvVpAtLeast);
}

/** Pieces of a side that have left the map. */
export function exitedPieces(env: QueryEnv, side: SideId): Piece[] {
  return Object.values(env.state.pieces).filter((p) => p.side === side && p.loc.kind === 'offboard' && p.loc.edge === 'exited');
}

/** Half-squad equivalents (squad 2, half-squad 1) and leaders among a set of pieces. */
export function infantryCount(env: QueryEnv, pieces: Piece[]): { hs: number; smc: number } {
  let hs = 0;
  let leaders = 0;
  for (const p of pieces) {
    const m = mmc(env, p);
    if (m) hs += m.kind === 'squad' ? 2 : 1;
    else if (smc(env, p)) leaders++;
  }
  return { hs, smc: leaders };
}

/** Every hex a side may ever exit from in a scenario, whatever the turn (for drawing the offboard hexes beyond them). */
export function exitHexesEver(sc: ScenarioDef, map: GameMap, side: SideId): Set<HexId> {
  const out = new Set<HexId>();
  const rules = [
    ...(sc.exits ?? []).filter((e) => e.side === side),
    ...victoryLeaves(sc).filter((v): v is VictoryCondition & { kind: 'exitVp' } => v.kind === 'exitVp' && v.side === side).map((v) => ({ side, edge: v.edge, hexes: v.hexes })),
  ];
  for (const r of rules) {
    if (r.edge && !r.hexes?.length) for (const h of map.edge(r.edge)) out.add(h);
    for (const h of r.hexes ?? []) out.add(h);
  }
  return out;
}

/**
 * Hexes a side may exit from this turn: null when the scenario never lets it exit, an empty set
 * when its exit rules have not come into effect yet. An exitVp condition allows its edge.
 */
export function exitHexes(env: QueryEnv, side: SideId, unit?: PieceId): Set<HexId> | null {
  const sc = statics(env).scenario;
  const map = statics(env).map;
  const rules = [
    ...(sc.exits ?? []).filter((e) => e.side === side),
    ...victoryLeaves(sc).filter((v): v is VictoryCondition & { kind: 'exitVp' } => v.kind === 'exitVp' && v.side === side).map((v) => ({ side, edge: v.edge, hexes: v.hexes })),
  ];
  if (!rules.length) return null;
  const out = new Set<HexId>();
  for (const r of rules) {
    if (('fromTurn' in r ? (r.fromTurn ?? 1) : 1) > env.state.turn) continue;
    // An Infantry-only stretch is closed to a vehicle.
    if ('infantryOnly' in r && r.infantryOnly && unit && defOf(env, pieceOf(env, unit)).kind === 'vehicle') continue;
    // An edge rule with hexes is limited to that stretch of the edge.
    if (r.edge && !r.hexes?.length) for (const h of map.edge(r.edge)) out.add(h);
    for (const h of r.hexes ?? []) out.add(h);
  }
  return out;
}

/** Why `unit` (of `side`) may not leave the map now: the MPh, a moving Good Order unit on an exit hex with the MF to step off. */
function exitRefusal(env: QueryEnv, side: SideId, unit: PieceId): string | null {
  if (env.state.phase !== 'MPh') return 'Units exit during the MPh';
  const ms = moveState(env);
  if (!ms || !ms.units.includes(unit)) return 'Only a moving unit can exit';
  const p = env.state.pieces[unit];
  if (!p || p.side !== side || p.loc.kind !== 'hex') return 'Not your unit on the map';
  if (!isGoodOrder(env, p)) return 'Only Good Order units may exit';
  const allowed = exitHexes(env, side, unit);
  if (allowed === null) return 'This scenario does not allow exiting';
  if (allowed.size === 0) return 'Exiting is not allowed yet this turn';
  if (!allowed.has(p.loc.hex)) return `Units exit from ${describeExits(env, side)}`;
  // Leaving the map costs the MF of entering the offboard hex (SK4 3.x).
  const { cost, left } = exitMf(env, ms, unit, p.loc.hex);
  if (cost > left) return `Exiting costs ${cost} MF (${left} left)`;
  return null;
}

function describeExits(env: QueryEnv, side: SideId): string {
  const sc = statics(env).scenario;
  const parts: string[] = [];
  for (const r of sc.exits ?? []) {
    if (r.side !== side) continue;
    if (r.edge) parts.push(`the ${r.edge} edge`);
    if (r.hexes?.length) parts.push(r.hexes.map((h) => h.replace(/^[a-z]/, '')).join(', '));
  }
  for (const v of sc.victory) {
    if (v.kind !== 'exitVp' || v.side !== side) continue;
    const stretch = v.hexes?.length ? ` between ${hexName(v.hexes[0]!)} and ${hexName(v.hexes[v.hexes.length - 1]!)}` : '';
    parts.push(`the ${v.edge} edge${stretch}`);
  }
  return parts.join(' or ') || 'the map edge';
}

/** Whether a condition currently holds. Composite conditions recurse; `custom` never holds here. */
export function achieved(env: QueryEnv, vc: VictoryCondition): boolean {
  const ctl = controlState(env);
  switch (vc.kind) {
    case 'controlBuildings': {
      if (vc.moreThanEnemy) {
        const mine = vc.buildings.filter((b) => ctl.buildings[b] === vc.side).length;
        const theirs = vc.buildings.filter((b) => ctl.buildings[b] === otherSide(env.state, vc.side)).length;
        return mine > theirs && mine >= vc.atLeast;
      }
      const needed = vc.atLeast + (vc.perEnemyExit ? exitedMmc(env, otherSide(env.state, vc.side)) * vc.perEnemyExit : 0);
      return vc.buildings.filter((b) => ctl.buildings[b] === vc.side).length >= needed;
    }
    case 'controlHexes': {
      // Hex Control only: "an armed Good Order Infantry MMC ... can gain Control of the hex it occupies"
      // (ASLRB A26.13). Control of a building (A26.14, SK1 2.0) does not hand over its other hexes: in S3
      // ("Control ≥ 25 building hexes") each hex must be entered. Hex ids are taken by their map name (a
      // half hex shared by two boards has two).
      const map = statics(env).map;
      return vc.hexes.filter((h) => ctl.hexes[map.hex(h)?.id ?? h] === vc.side).length >= vc.atLeast;
    }
    case 'eliminateCvp':
      return casualtyVp(env, otherSide(env.state, vc.side)) >= cvpGoal(env, vc);
    case 'cvpBelow':
      return casualtyVp(env, vc.side) < vc.cvp;
    case 'exitVp':
      return exitVpMet(env, vc);
    case 'vpTally':
      return vpTally(env, vc).total >= vc.vp;
    case 'exitForce': {
      const mine = infantryCount(env, exitedPieces(env, vc.side));
      const theirs = vc.perEnemyHsExit ? infantryCount(env, exitedPieces(env, otherSide(env.state, vc.side))).hs * vc.perEnemyHsExit : 0;
      return mine.hs >= vc.hsEquivalents + theirs && mine.smc >= vc.smc;
    }
    case 'noGoodOrderEnemyIn': {
      const map = statics(env).map;
      const ids = new Set(vc.buildings ? vc.hexes.map((h) => map.hex(h)?.buildingId).filter((b): b is string => !!b) : []);
      const area = new Set(vc.hexes.map((h) => map.hex(h)?.id ?? h));
      for (const h of map.hexes()) if (h.buildingId && ids.has(h.buildingId)) area.add(h.id);
      const holding = Object.values(env.state.pieces).filter(
        (p) =>
          p.side !== vc.side &&
          p.loc.kind === 'hex' &&
          area.has(p.loc.hex) &&
          !!(mmc(env, p) || (!vc.mmcOnly && smc(env, p))) &&
          (vc.allUnits || (vc.unbroken ? !isBroken(p) : isGoodOrder(env, p))),
      );
      return holding.length <= (vc.atMost ?? 0);
    }
    case 'clearAreas':
      return clearAreasTally(env, vc).clear >= vc.atLeast;
    case 'fewerLosses':
      return squadEquivalentsLost(env, vc.side) < squadEquivalentsLost(env, otherSide(env.state, vc.side));
    case 'losFirepower':
      return losFirepower(env, vc).total >= vc.fp;
    case 'goodOrderVp': {
      const t = areaVp(env, vc);
      return t.total >= vc.vp && t.units.filter((u) => !!smc(env, pieceOf(env, u.unit))).length >= (vc.leaders ?? 0);
    }
    case 'forcesInBuilding':
      return buildingWithForces(env, vc) !== null;
    case 'fewerMmcLost':
      return mmcLost(env, vc.side).length < mmcLost(env, otherSide(env.state, vc.side)).length;
    case 'all':
      return vc.of.every((c) => achieved(env, c));
    case 'any':
      return vc.of.some((c) => achieved(env, c));
    case 'squadEquivalentsIn':
      return squadEquivalentsInArea(env, vc).total >= vc.atLeast;
    case 'gunsEliminatedOrCaptured':
    case 'occupyGunHexes':
    case 'afvLead':
    case 'mobileAfv':
    case 'custom':
      // Decided by the rule pack that knows Guns (sk2.guns) or vehicles (sk3); never holds without it.
      return env.query('vc.achieved', { vc }, null) ?? false;
  }
}

/**
 * The tally of a `squadEquivalentsIn` condition: the side's unbroken MMC in the area as squad equivalents, plus `afvSe`
 * for each AFV there that is mobile with a functioning MA (the vehicle rules answer `area.armedMobileAfv`).
 */
export function squadEquivalentsInArea(env: QueryEnv, vc: Extract<VictoryCondition, { kind: 'squadEquivalentsIn' }>): { mmc: number; afv: number; total: number } {
  const map = statics(env).map;
  const area = new Set(vc.hexes.map((h) => map.hex(h)?.id ?? h));
  const units = Object.values(env.state.pieces).filter((p) => p.side === vc.side && p.loc.kind === 'hex' && area.has(p.loc.hex) && !!mmc(env, p) && !isBroken(p));
  const se = squadEquivalents(env, units);
  const afv = vc.afvSe ? env.query('area.armedMobileAfv', { side: vc.side, hexes: [...area] }, 0) : 0;
  return { mmc: se, afv, total: se + afv * (vc.afvSe ?? 0) };
}

/** The Game Turn at whose end a condition is judged ("win automatically at the end of Game Turn 4"), if the card sets one. */
export const atEndOfTurn = (vc: VictoryCondition): number | undefined => (vc.kind === 'controlHexes' ? vc.atEndOfTurn : undefined);

/** The phase of its own side's Player Turn at whose end a condition is judged ("at the end of any of his MPh"), if any. */
export const atEndOfPhase = (vc: VictoryCondition): string | undefined => (vc.kind === 'all' || vc.kind === 'any' ? vc.atEndOfPhase : undefined);

/** A condition the card words "win immediately". */
export const isImmediate = (vc: VictoryCondition): boolean => 'immediate' in vc && vc.immediate === true;

/** Enemy MMC (squads and half-squads, each counting one) that have exited. */
function exitedMmc(env: QueryEnv, side: SideId): number {
  return exitedPieces(env, side).filter((p) => !!mmc(env, p)).length;
}

/** A place on the map a victory condition is about, for drawing on the board. */
export interface ObjectiveArea {
  /** The side that wins by taking/holding/exiting here. */
  side: SideId;
  /** A single objective hex (marked with a star) or a multi-hex region (a building, an exit edge). */
  kind: 'hex' | 'region';
  hexes: HexId[];
  /** Short caption, e.g. "Building N5" or "Exit E edge". */
  label: string;
  /** Index of the victory condition this belongs to (areas of one condition share a colour). */
  group: number;
}

const hexName = (id: HexId) => id.replace(/^[a-z]+/, '');

/**
 * The map objectives of a scenario's victory conditions: each listed hex, expanded to
 * its whole building where the condition is about buildings; exit edges as a region.
 */
export function objectiveAreas(scenario: ScenarioDef, map: GameMap): ObjectiveArea[] {
  const out: ObjectiveArea[] = [];
  const byBuilding = new Map<string, HexId[]>();
  for (const h of map.hexes()) if (h.buildingId) byBuilding.set(h.buildingId, [...(byBuilding.get(h.buildingId) ?? []), h.id]);
  const seen = new Set<string>();
  const push = (a: ObjectiveArea) => {
    const key = [...a.hexes].sort().join(',');
    if (a.hexes.length === 0 || seen.has(key)) return;
    seen.add(key);
    out.push(a);
  };
  const building = (side: SideId, group: number, id: string, at?: HexId) => {
    const hexes = byBuilding.get(id) ?? [];
    push({ side, kind: hexes.length > 1 ? 'region' : 'hex', hexes, label: `Building ${at ? hexName(at) : id}`, group });
  };
  const exitsOf = (side: SideId): HexId[] => (scenario.exits ?? []).filter((e) => e.side === side).flatMap((e) => [...(e.edge ? map.edge(e.edge) : []), ...(e.hexes ?? [])]);
  const walk = (vc: VictoryCondition, group: number) => {
    switch (vc.kind) {
      case 'all':
      case 'any':
        for (const c of vc.of) walk({ ...c, side: vc.side } as VictoryCondition, group);
        break;
      case 'exitForce':
        push({ side: vc.side, kind: 'region', hexes: exitsOf(vc.side), label: 'Exit', group });
        break;
      case 'controlHexes':
        // A few named hexes get a star each; a whole area ("≥ 25 building hexes on board z") is one tinted region.
        if (vc.hexes.length > 6) push({ side: vc.side, kind: 'region', hexes: vc.hexes.map((h) => map.hex(h)?.id ?? h), label: `Control ${vc.atLeast} of ${vc.hexes.length} ${vc.hexesLabel ?? 'hexes'}`, group });
        else for (const h of vc.hexes) push({ side: vc.side, kind: 'hex', hexes: [h], label: `Control ${hexName(h)}`, group });
        break;
      case 'controlBuildings':
        for (const b of vc.buildings) building(vc.side, group, b);
        break;
      case 'noGoodOrderEnemyIn':
        // A whole area ("≤ 7 hexes from S6") is one tinted region, as for controlHexes.
        if (!vc.buildings && vc.hexes.length > 6) {
          push({ side: vc.side, kind: 'region', hexes: vc.hexes.map((h) => map.hex(h)?.id ?? h), label: `Clear ${vc.hexesLabel ?? `${vc.hexes.length} hexes`}`, group });
          break;
        }
        for (const h of vc.hexes) {
          const b = vc.buildings ? map.hex(h)?.buildingId : undefined;
          if (b) building(vc.side, group, b, h);
          else push({ side: vc.side, kind: 'hex', hexes: [h], label: `Clear ${hexName(h)}`, group });
        }
        break;
      case 'clearAreas':
        // Each area (a hill) is its own tinted region.
        for (const a of vc.areas) push({ side: vc.side, kind: 'region', hexes: a.hexes.map((h) => map.hex(h)?.id ?? h), label: `Clear ${a.label}`, group });
        break;
      case 'exitVp':
        push({ side: vc.side, kind: 'region', hexes: vc.hexes?.length ? vc.hexes : map.edge(vc.edge), label: `Exit ${vc.edge} edge`, group });
        break;
      case 'losFirepower':
        push({ side: vc.side, kind: 'region', hexes: vc.hexes.map((h) => map.hex(h)?.id ?? h), label: `LOS + ${vc.fp} FP: ${vc.hexesLabel ?? `${vc.hexes.length} hexes`}`, group });
        break;
      case 'vpTally':
        // Each hex that scores (S32: the building hexes within 6 of vN9) gets its own mark.
        for (const src of vc.sources) if (src.kind === 'controlledHexes') for (const h of src.hexes) push({ side: vc.side, kind: 'hex', hexes: [map.hex(h)?.id ?? h], label: `+${src.vp} VP: ${hexName(h)}`, group });
        break;
      case 'goodOrderVp':
        push({ side: vc.side, kind: 'region', hexes: vc.hexes.map((h) => map.hex(h)?.id ?? h), label: `${vc.vp} VP of Good Order units: ${vc.hexesLabel ?? `${vc.hexes.length} hexes`}`, group });
        break;
      case 'squadEquivalentsIn':
        push({ side: vc.side, kind: 'region', hexes: vc.hexes.map((h) => map.hex(h)?.id ?? h), label: `${vc.atLeast} squad equivalents: ${vc.hexesLabel ?? `${vc.hexes.length} hexes`}`, group });
        break;
      default:
        break;
    }
  };
  scenario.victory.forEach(walk);
  return out;
}

/**
 * End-of-game evaluation. Each VC names the side that wins by achieving it; if none
 * is achieved, the side whose VC is defensive (i.e. the other side) wins.
 */
export function evaluateVictory(env: QueryEnv): SideId | null {
  const sc = statics(env).scenario;
  // A condition judged at the end of an earlier Game Turn has had its moment (see the trigger in scenarioModule).
  // One judged at the end of a phase (LMA5: "at the end of any of his MPh") is never judged at game end.
  for (const vc of sc.victory) if (!(atEndOfTurn(vc) !== undefined && atEndOfTurn(vc) !== sc.turns) && atEndOfPhase(vc) === undefined && achieved(env, vc)) return vc.side;
  // Nobody achieved their VC: the side without an offensive VC wins.
  const offensive = new Set(sc.victory.map((v) => v.side));
  const defenders = sc.sides.map((s) => s.side).filter((s) => !offensive.has(s));
  return defenders.length === 1 ? defenders[0]! : null;
}

/**
 * Whether a side has a unit left: personnel or a vehicle that is not a wreck, on the map, waiting
 * offboard, aboard a vehicle or exited; or reinforcements still to be rolled for. Weapons do not count.
 */
export function hasUnitsLeft(env: QueryEnv, side: SideId): boolean {
  for (const p of Object.values(env.state.pieces)) {
    if (p.side !== side || p.loc.kind === 'eliminated' || p.tags['wreck'] === true) continue;
    // A unit only a special rule may still bring in (LMA5's replacement leader) is not one the side has.
    if (p.tags['entryRoll'] === 'ssr' && p.tags['entryTurn'] === 0) continue;
    const d = defOf(env, p);
    if (isPersonnelDef(d) || isVehicleDef(d)) return true;
  }
  return env.query('side.reinforcementsPending', { side }, false);
}
