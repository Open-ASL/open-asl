import { cubeEquals, type Action, type Ctx, type HexId, type Piece, type PieceId, type QueryEnv, type RuleModule, type SideId } from '@asl/engine';
import { byId, hexOf, statics, swHeldBy, vehiclesInHex } from '../common/pieces';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import {
  MOVE_ENTERED,
  MOVE_FINISH,
  moveInternals,
  moveState,
  type MoveEnteredFn,
  type MoveFinishFn,
  type MoveState,
  type VehicleMoveState,
} from '../sk1/movement';
import { T, fireMarker, isGoodOrder, pieceOf, setTags } from '../sk1/status';
import { SMOKE58, isRoadHex, isWoodsRoad, smokeIn, terrainOf } from '../sk1/terrain';
import { SPINES, arcNeighbours, inCoveredArc, spineChange } from '../sk2/arc';
import { levelOf } from '../sk2/elevation';
import { T2 } from '../sk2/status';
import { OP, simpleShots, type OrdnanceFireFn, type OrdnanceShot } from '../sk2/ordnance';
import { T3, crewCanAct, inMotion, isBogged, isCe, isImmobile, isMobile, isWreck, tcaOf, vcaOf, vehicle } from './status';
import { applyVehicleEffect } from './vehicleStatus';

/*
 * Vehicle movement (SK4 3.3.2, 7.6, 1.1.1 MP costs). A vehicle rides in the SK1 move state
 * (`MoveState.vehicle`), so Defensive First Fire, Residual FP, "no more shots than MP spent here"
 * and exiting work as for Infantry. What is the vehicle's own: the start and stop MP, Delay, the
 * Vehicle Covered Arc it must move within and turns at a cost, the free turret turn, MP costs by
 * terrain, Bog Checks in woods and buildings, Mechanical Reliability (and the Russian Note M stall),
 * Motion at the end of the move, CE/BU, and the one-vehicle-per-hex rule at the end of the MPh.
 */

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Why a vehicle may not start (or restart) moving now, or null. */
    'vehicle.cannotStart': { ctx: { vehicle: PieceId }; value: string | null };
    /** Bog Check DRM for a vehicle entering `hex` (SK4 7.6; `halfMp`: it spent half its MP to enter woods/a building). */
    'vehicle.bogDrm': { ctx: { vehicle: PieceId; hex: HexId; halfMp: boolean }; value: number };
    /** The dr a Motion Status attempt by `vehicle` must make now: MF/MP the mover has spent in its LOS this MPh (SK4 3.3.2.1). */
    'vehicle.motionMp': { ctx: { vehicle: PieceId }; value: number };
    /** MP for `vehicle` to enter `hex` by its terrain, off a road and outside a building (an SSR may change it, S28 wetland). */
    'vehicle.terrainMp': { ctx: { vehicle: PieceId; hex: HexId }; value: number };
  }
}

/** The decision a defending vehicle gets after a successful Motion Status attempt: change its VCA/TCA freely (SK4 3.3.2.1). */
export const MOTION_FACING = 'motionFacing';

export type VehicleMoveAction =
  | (Action & { type: 'vmove.start'; vehicle: PieceId })
  | (Action & { type: 'vmove.stop' })
  | (Action & { type: 'vmove.delay'; mp?: number })
  | (Action & { type: 'vmove.turn'; vca: number })
  | (Action & { type: 'vmove.turret'; tca: number })
  | (Action & { type: 'vmove.end' })
  | (Action & { type: 'vmove.ce'; vehicle: PieceId; ce: boolean })
  | (Action & { type: 'vmove.wreck'; vehicle: PieceId });

const MOVING_TARGET_EVENT = 'sk3.vehicle.move';

/** The moving vehicle, when a vehicle is what moves. */
export const movingVehicle = (env: QueryEnv): { ms: MoveState & { vehicle: VehicleMoveState }; p: Piece } | null => {
  const ms = moveState(env);
  if (!ms?.vehicle) return null;
  return { ms: ms as MoveState & { vehicle: VehicleMoveState }, p: pieceOf(env, ms.units[0]!) };
};
const remaining = (ms: MoveState) => moveInternals.remaining(ms, ms.units[0]!);
/** The hex the moving vehicle stands in (map or offboard), with its cube. */
const whereIs = (env: QueryEnv, ms: MoveState) => {
  const map = statics(env).map;
  const id = ms.hex ?? ms.off ?? null;
  if (!id) return null;
  const h = map.hex(id) ?? map.offboardHex(id);
  return h ? { id, cube: h.cube } : null;
};
const isBuildingHex = (env: QueryEnv, hex: HexId) => !!statics(env).map.hex(hex)?.buildingId;
/** Woods, and under PTO Terrain jungle and bamboo (SK4 8.2.1: entered like woods, with a Bog Check). */
const WOODS_LIKE = new Set(['woods', 'jungle', 'jungle-light', 'bamboo']);
const isWoodsHex = (env: QueryEnv, hex: HexId) => WOODS_LIKE.has(terrainOf(env, hex).id) && !isWoodsRoad(env, hex);
/** A PTO hut (SK4 8.2.1): a building hex vehicles enter at 2/4 MP without a Bog Check, collapsing it. */
const isHutHex = (env: QueryEnv, hex: HexId) => !!terrainOf(env, hex).building;
const isRubbleHex = (env: QueryEnv, hex: HexId) => terrainOf(env, hex).id === 'rubble-stone';
/** A Bog Check is taken entering woods or a building (SK4 7.6), or rubble (S35 SSR 1). */
const bogTerrain = (env: QueryEnv, hex: HexId) => isWoodsHex(env, hex) || (isBuildingHex(env, hex) && !isHutHex(env, hex)) || isRubbleHex(env, hex);
/** In woods or a building a VCA change costs double and risks Bog; a TCA change needs 2 MP (SK4 3.3.2). */
export const closeTerrain = (env: QueryEnv, hex: HexId | null) => !!hex && !!statics(env).map.hex(hex) && (WOODS_LIKE.has(terrainOf(env, hex).id) || (isBuildingHex(env, hex) && !isHutHex(env, hex)));

/**
 * MP to enter `to` (SK4 1.1.1, 3.3.2, 7.4): Open Ground, orchard and grain 1 (an Armored Car 3,
 * grain 4), brush 2 (AC 4), a road hexside at the road rate (½ CE, 1 BU), woods half the printed MP
 * (`all`: all the MP left; an AC always all), a building half (tracked, BU), +4 across a Crest Line
 * into higher terrain (+2 via road), +1 per vehicle or wreck already there (+2 via road, doubled in
 * woods), +1 into Smoke. `Infinity` where the vehicle cannot go.
 */
export function vehicleEntryCost(env: QueryEnv, p: Piece, from: HexId | null, to: HexId, opts: { viaRoad: boolean; all?: boolean; remaining?: number } = { viaRoad: false }): number {
  const d = vehicle(env, p)!;
  const map = statics(env).map;
  if (map.offboardHex(to) && !map.hex(to)) return d.tracked ? 1 : 3;
  const t = terrainOf(env, to).id;
  // A hut is a building the vehicle enters at its own rate (the PTO module's `vehicle.terrainMp`), not at half its MP.
  const building = isBuildingHex(env, to) && !isHutHex(env, to);
  const alongRoad = opts.viaRoad && (isRoadHex(env, to) || isWoodsRoad(env, to));
  // Roads a rule treats as Open Ground (SSR): along one, the vehicle pays the Open Ground rate, also through woods.
  const roadRate = env.query('move.roadRate', {}, true);
  const road = alongRoad && roadRate;
  let cost: number;
  if (road) cost = isCe(p) ? 0.5 : 1;
  else if (alongRoad) cost = d.tracked ? 1 : 3;
  else if (building) cost = d.tracked && !isCe(p) ? d.mp / 2 : Infinity;
  else if (WOODS_LIKE.has(t)) cost = !d.tracked || opts.all ? Math.max(1, opts.remaining ?? d.mp) : d.mp / 2;
  else if (t === 'brush' || t === 'kunai') cost = d.tracked ? 2 : 4;
  else if (t === 'grain') cost = d.tracked ? 1 : 4;
  else if (t === 'open' || t === 'orchard' || t === 'palm' || t === 'plowed' || t === 'shellholes') cost = d.tracked ? 1 : 3;
  // Stone rubble (S35 SSR 1: "vehicles pay ½ of their MP allotment and risk Bog with a +3 DRM").
  else if (t === 'rubble-stone') cost = d.mp / 2;
  else cost = Infinity;
  if (!alongRoad && !building) cost = env.query('vehicle.terrainMp', { vehicle: p.id, hex: to }, cost);
  if (!Number.isFinite(cost)) return cost;
  if (from && map.hex(from) && levelOf(env, to) > levelOf(env, from)) cost += opts.viaRoad && roadRate ? 2 : 4;
  const others = vehiclesInHex(env, to).filter((v) => v.id !== p.id).length;
  if (others) cost += others * (road ? 2 : 1) * (t === 'woods' ? 2 : 1);
  if (smokeIn(env, to)) cost += 1;
  return cost;
}

/** The cost of the moving vehicle's step into `to` (`declared`: more MP than needed, SK4 3.3.2; the woods "all MP" choice is a declaration of all that is left). */
function vehicleStepCost(env: QueryEnv, ms: MoveState & { vehicle: VehicleMoveState }, to: HexId, declared?: number): number {
  const p = pieceOf(env, ms.units[0]!);
  const from = ms.hex ?? null;
  const left = remaining(ms);
  const viaRoad = !!(from ?? ms.off) && moveInternals.roadSideTo(env, ms, to);
  const all = declared !== undefined && declared >= left;
  let cost = vehicleEntryCost(env, p, from, to, { viaRoad, all, remaining: left });
  // The minimum move: one hex at all its MP, no VCA change made (SK4 3.3.2).
  if (Number.isFinite(cost) && cost > left && ms.hexesEntered === 0 && !ms.vehicle.turned && left > 0 && !bogTerrain(env, to)) cost = left;
  if (declared !== undefined && declared > cost) cost = declared;
  return cost;
}

/** Why the moving vehicle may not step into `to` (SK4 3.3.2, 1.1.1). */
function vehicleStepIllegal(env: QueryEnv, ms: MoveState & { vehicle: VehicleMoveState }, to: HexId, declared?: number): string | null {
  const p = pieceOf(env, ms.units[0]!);
  const d = vehicle(env, p)!;
  const v = ms.vehicle;
  if (!v.started) return v.stopped ? 'The vehicle is stopped: start it first (1 MP)' : 'The vehicle has not started';
  if (isBogged(p)) return 'A bogged vehicle may not leave its hex';
  const map = statics(env).map;
  const at = whereIs(env, ms);
  const toHex = map.hex(to);
  if (at && toHex) {
    // A vehicle moves within its VCA (SK4 3.3.2): into one of the two hexes its front points between.
    const front = arcNeighbours(at.cube, vcaOf(p));
    if (!front.some((c) => cubeEquals(c, toHex.cube))) return map.hex(at.id) ? 'A vehicle moves within its Vehicle Covered Arc: turn first' : 'A vehicle enters within its Vehicle Covered Arc: turn first';
  }
  if (map.hex(to)) {
    if (isBuildingHex(env, to) && !isHutHex(env, to)) {
      if (!d.tracked) return 'An Armored Car may not enter a building';
      if (isCe(p)) return 'A Crew Exposed AFV may not enter a building: Button Up first';
    }
  }
  const cost = vehicleStepCost(env, ms, to, declared);
  if (!Number.isFinite(cost)) return 'The vehicle cannot enter that terrain';
  const left = remaining(ms);
  if (cost > left) return `Entering costs ${cost} MP (${left} left)`;
  return null;
}

/** The cheapest legal step the moving vehicle could still take, or null when none (SK4 3.3.2: ending in Motion with MP left). */
function cheapestStep(env: QueryEnv, ms: MoveState & { vehicle: VehicleMoveState }): number | null {
  const map = statics(env).map;
  const cands = ms.hex ? map.neighbors(ms.hex) : moveInternals.offboardTargets(env, ms);
  let best: number | null = null;
  for (const to of cands) {
    if (vehicleStepIllegal(env, ms, to)) continue;
    const c = vehicleStepCost(env, ms, to);
    if (best === null || c < best) best = c;
  }
  return best;
}

/** Spend MP in place and update the vehicle's state in one event. */
function spendVehicle(ctx: Ctx, ms: MoveState & { vehicle: VehicleMoveState }, cost: number, patch: Partial<VehicleMoveState>, more: Partial<MoveState> = {}) {
  moveInternals.spendInPlace(ctx, ms, cost, { ...more, vehicle: { ...ms.vehicle, sinceTurret: ms.vehicle.sinceTurret + cost, turretTurned: false, sinceBff: (ms.vehicle.sinceBff ?? 0) + cost, ...patch } });
}

/**
 * Turn `p`'s hull toward `to` in woods or a building one hexspine at a time, a Bog Check before each ("one Bog DR
 * per hexspine", ASLRB D8.2; SK4 7.6: the change does not occur if it bogs; tester report 2026-11-06): the VCA it
 * reached, the hexspines it tried (the one it bogged on included) and whether it bogged.
 */
export function turnRiskingBog(ctx: Ctx, p: Piece, hex: HexId, to: number): { vca: number; tried: number; bogged: boolean } {
  let vca = vcaOf(p);
  const n = spineChange(vca, to);
  const step = (to - vca + SPINES) % SPINES <= 3 ? 1 : SPINES - 1;
  for (let i = 1; i <= n; i++) {
    if (bogCheck(ctx, p, hex, false, 'turn')) return { vca, tried: i, bogged: true };
    vca = (vca + step) % SPINES;
  }
  return { vca, tried: n, bogged: false };
}

/** Bog Check (SK4 7.6) for the moving vehicle entering or turning in `hex`: true when it bogs. */
function bogCheck(ctx: Ctx, p: Piece, hex: HexId, halfMp: boolean, why: 'enter' | 'turn'): boolean {
  const drmRes = ctx.explain('vehicle.bogDrm', { vehicle: p.id, hex, halfMp }, 0);
  const roll = ctx.roll(`Bog Check in ${hex}`);
  const bogged = roll.total + drmRes.value >= 12;
  ctx.emit('sk3.vehicle.bog', { vehicle: p.id, hex, dr: roll.dice as [number, number], drm: drmRes.value, explain: drmRes.trace.filter((t) => !t.suppressedBy && t.label).map((t) => ({ id: t.id, label: t.label! })), bogged, why });
  if (bogged) setTags(ctx, p.id, { [T3.bog]: 'bogged', [T3.motion]: null });
  return bogged;
}

/** MF/MP the moving enemy has spent this MPh in hexes `p` can see: what a Motion Status attempt's dr must not exceed (SK4 3.3.2.1). */
function motionMp(env: QueryEnv, p: Piece): number {
  const ms = moveState(env);
  const at = hexOf(env.state, p);
  if (!ms || !at) return 0;
  return (ms.trail ?? []).filter((t) => env.query('los.trace', { from: at, to: t.hex }, { clear: true, hindrance: 0, parts: [] }).clear).reduce((n, t) => n + t.mp, 0);
}

/** Map hexes holding two or more non-wrecked vehicles of `side` (SK4 3.3.2 forbids that at the end of the MPh). */
export function overstackedHexes(env: QueryEnv, side: SideId): HexId[] {
  const count = new Map<HexId, number>();
  for (const p of Object.values(env.state.pieces)) {
    if (p.side !== side || p.loc.kind !== 'hex' || !vehicle(env, p) || isWreck(p)) continue;
    count.set(p.loc.hex, (count.get(p.loc.hex) ?? 0) + 1);
  }
  return [...count].filter(([, n]) => n > 1).map(([h]) => h).sort();
}

/** Why `id` may not be flipped to its wreck side as the surplus vehicle of a shared hex (SK4 3.3.2). */
function wreckIllegal(env: QueryEnv, id: PieceId): string | null {
  const p = env.state.pieces[id];
  if (!p || !vehicle(env, p)) return 'Not a vehicle';
  if (p.side !== env.state.attacker) return 'Not your vehicle';
  if (env.state.phase !== 'MPh') return 'Only at the end of the Movement Phase';
  if (isWreck(p)) return 'Already a wreck';
  if (p.loc.kind !== 'hex') return 'The vehicle is not on the map';
  if (!overstackedHexes(env, p.side).includes(p.loc.hex)) return 'The vehicle does not share its hex with another friendly vehicle';
  return null;
}

/** Why a vehicle cannot start moving now (SK4 3.3.2, 7.6, 7.10). */
export function vehicleCannotStart(env: QueryEnv, id: PieceId): string | null {
  const p = env.state.pieces[id];
  const d = p && vehicle(env, p);
  if (!p || !d) return 'Not a vehicle';
  if (p.side !== env.state.attacker) return 'Not your vehicle';
  if (env.state.phase !== 'MPh') return 'Not the Movement Phase';
  if (isWreck(p)) return 'A wreck does not move';
  if (p.tags[T3.immob]) return 'The vehicle is Immobilized';
  if (p.tags[T3.dugIn]) return 'A dug-in vehicle never moves';
  if (!crewCanAct(p)) return p.tags[T3.shock] ? 'A Shocked vehicle may not move' : 'A Stunned vehicle may not move this Player Turn';
  const ms = moveState(env);
  if (ms) {
    if (ms.units[0] !== id) return 'Finish moving the current stack first';
    if (!ms.vehicle!.stopped) return 'The vehicle is already moving';
    if (ms.vehicle!.ending) return 'The vehicle has ended its move';
    if (remaining(ms) < 1) return 'No MP left to start again';
    return null;
  }
  if (p.loc.kind !== 'hex' && p.loc.kind !== 'offboard') return 'The vehicle cannot move';
  if (p.tags[T.moved]) return 'The vehicle has already moved this phase';
  if (p.loc.kind === 'offboard' && ((p.tags['entryTurn'] as number | undefined) ?? 0) > env.state.turn) return `Enters on turn ${p.tags['entryTurn']}`;
  if (p.loc.kind === 'offboard' && (p.loc.edge === 'setup' || p.loc.edge === 'exited')) return 'The vehicle cannot move';
  if (p.loc.kind === 'offboard' && !p.loc.hex) return 'The vehicle has not been set up offboard';
  // A vehicle that Prep Fired (MA or MG) does not move (SK4 3.3); a Bogged one may try to free itself only if it did not fire.
  if (fireMarker(p) || swHeldBy(env.state, id).some((w) => fireMarker(w))) return 'The vehicle fired in the PFPh';
  return null;
}

/** A vehicle's MP allowance less what the card says it has already expended on entering. */
function entrySpent(env: QueryEnv, p: Piece, mp: number): number {
  if (p.loc.kind !== 'offboard') return 0;
  const spec = p.tags['entryMfSpent'];
  if (spec === 'half') return mp / 2;
  return typeof spec === 'number' ? spec : 0;
}

/** The expenditure a defender may fire at: Residual FP and Defensive First Fire follow it. */
const exposed = (ctx: Ctx) => moveInternals.afterMfExpenditure(ctx);

export const vehicleMoveModule: RuleModule = {
  id: 'sk3.vehicleMove',
  ref: 'SK4 1.1.1, 3.3.2, 7.6, 7.7, 7.10; SK3 Russian Vehicle Note M',
  summary: 'Vehicle movement: start/stop/Delay MP, VCA and TCA changes, MP costs, Bog, Mechanical Reliability, Motion, CE/BU.',
  requires: ['sk1.movement', 'sk3.vehicles', 'sk2.elevation'],
  install(r) {
    r.event<{ vehicle: PieceId; kind: 'start' | 'restart' | 'stop' | 'delay' | 'turn' | 'turret' | 'end' | 'motion'; mp: number; vca?: number; tca?: number; spines?: number; hex: HexId | null }>({ type: MOVING_TARGET_EVENT, apply() {} });
    r.event<{ vehicle: PieceId; dr: [number, number]; result: 'ok' | 'stall' | 'immobilized'; wasted?: number }>({ type: 'sk3.vehicle.reliability', apply() {} });
    r.event<{ vehicle: PieceId; hex: HexId; dr: [number, number]; drm: number; explain: { id: string; label: string }[]; bogged: boolean; why: 'enter' | 'turn' }>({ type: 'sk3.vehicle.bog', apply() {} });
    r.event<{ vehicle: PieceId; colored: number; white: number; result: 'freed' | 'mired' | 'immobilized'; mp: number }>({ type: 'sk3.vehicle.unbog', apply() {} });
    r.event<{ vehicle: PieceId; ce: boolean; phase: string }>({ type: 'sk3.vehicle.ce', apply() {} });

    r.contribute({ id: 'sk3.vehicle.cannotStart.base', query: 'vehicle.cannotStart', layer: 0, apply: (v, { vehicle: id }, env) => v ?? vehicleCannotStart(env, id) });

    // ---------------------------------------------------------------- one vehicle per hex at the end of the MPh
    // Vehicles may share a hex while moving (an extra MP per vehicle there), but "each side may have only
    // one non-wrecked vehicle in each hex at the end of the MPh; if two friendly AFV occupy the same hex
    // at the end of the MPh, the owner must flip one over to its wreck side" (SK4 3.3.2). The phase
    // cannot end while such a hex exists: move one on, or `vmove.wreck` one.
    r.contribute({
      id: 'sk3.vehicle.overstack.end-blocked',
      query: 'phase.endBlocked',
      when: (_c, env) => env.state.phase === 'MPh' && overstackedHexes(env, env.state.attacker).length > 0,
      apply: (v, _c, env) => v ?? `Two vehicles in ${overstackedHexes(env, env.state.attacker).join(', ')}: move one on or flip one to its wreck side (SK4 3.3.2)`,
    });
    r.action<VehicleMoveAction & { type: 'vmove.wreck' }>({
      type: 'vmove.wreck',
      decisionKinds: [PHASE_DECISION],
      legal: (env) =>
        env.state.phase === 'MPh'
          ? overstackedHexes(env, env.state.attacker).flatMap((h) => vehiclesInHex(env, h, env.state.attacker, true).sort(byId).map((v) => ({ type: 'vmove.wreck' as const, vehicle: v.id })))
          : [],
      validate: (env, a) => wreckIllegal(env, a.vehicle),
      resolve(ctx, a) {
        const hex = hexOf(ctx.state, pieceOf(ctx, a.vehicle))!;
        applyVehicleEffect(ctx, a.vehicle, 'wreck', `two friendly vehicles in ${hex} at the end of the MPh (SK4 3.3.2)`);
      },
    });

    // ---------------------------------------------------------------- MP allowance and costs
    r.contribute({
      id: 'sk3.mf.vehicle',
      query: 'unit.mf',
      layer: 5,
      when: ({ unit }, env) => !!vehicle(env, pieceOf(env, unit)),
      apply: (_v, { unit }, env) => vehicle(env, pieceOf(env, unit))!.mp,
    });
    // Generic costs (exiting, a DC's placer) for a vehicle: by its own table.
    r.contribute({
      id: 'sk3.move.cost.vehicle',
      query: 'move.cost',
      layer: 5,
      when: ({ unit }, env) => !!vehicle(env, pieceOf(env, unit)),
      apply: (_v, { unit, from, to, viaRoad }, env) => vehicleEntryCost(env, pieceOf(env, unit), from ?? null, to, { viaRoad }),
    });
    r.contribute({
      id: 'sk3.move.stepCost.vehicle',
      query: 'move.stepCost',
      layer: 5,
      when: ({ ms }) => !!ms.vehicle,
      apply: (_v, { ms, to, declared }, env) => vehicleStepCost(env, ms as MoveState & { vehicle: VehicleMoveState }, to, declared),
    });
    r.contribute({
      id: 'sk3.vehicle.stepIllegal.base',
      query: 'vehicle.stepIllegal',
      layer: 0,
      apply: (_v, { ms, to, declared }, env) => vehicleStepIllegal(env, ms as MoveState & { vehicle: VehicleMoveState }, to, declared),
    });
    // Bog Check DRM (ASLSK chart p.3): ground pressure, entering woods/a building at half MP, higher terrain.
    const bog = (id: string, label: string | ((c: { vehicle: PieceId; hex: HexId; halfMp: boolean }, env: QueryEnv) => string), when: (c: { vehicle: PieceId; hex: HexId; halfMp: boolean }, env: QueryEnv) => boolean, drm: (c: { vehicle: PieceId; hex: HexId; halfMp: boolean }, env: QueryEnv) => number) =>
      r.contribute({ id: `sk3.bog.${id}`, query: 'vehicle.bogDrm', ref: 'SK4 7.6', label, when, apply: (v, c, env) => v + drm(c, env) });
    bog('ground-pressure', (c, env) => (vehicle(env, pieceOf(env, c.vehicle))!.groundPressure === 'high' ? '+2 high ground pressure' : '+1 normal ground pressure'), (c, env) => vehicle(env, pieceOf(env, c.vehicle))!.groundPressure !== 'low', (c, env) => (vehicle(env, pieceOf(env, c.vehicle))!.groundPressure === 'high' ? 2 : 1));
    bog('tracked', '+1 not Fully Tracked', (c, env) => !vehicle(env, pieceOf(env, c.vehicle))!.tracked, () => 1);
    bog('half-mp', (c, env) => (isBuildingHex(env, c.hex) && terrainOf(env, c.hex).id === 'building-stone' ? '+4 entering a stone building at half MP' : `+3 entering ${isBuildingHex(env, c.hex) ? 'a wooden building' : 'woods'} at half MP`), (c, env) => c.halfMp && !isRubbleHex(env, c.hex), (c, env) => (isBuildingHex(env, c.hex) && terrainOf(env, c.hex).id === 'building-stone' ? 4 : 3));
    bog('rubble', '+3 entering rubble', (c, env) => isRubbleHex(env, c.hex) && !isBuildingHex(env, c.hex), () => 3);
    bog('elevation', '+1 gaining elevation into woods', (c, env) => {
      const ms = moveState(env);
      return isWoodsHex(env, c.hex) && !!ms?.from && levelOf(env, c.hex) > levelOf(env, ms.from);
    }, () => 1);

    // ---------------------------------------------------------------- entering a hex: Bog Check, moving target
    r.procedure<MoveEnteredFn>(MOVE_ENTERED, (next) => (ctx, ms) => {
      next?.(ctx, ms);
      if (!ms.vehicle || !ms.hex) return;
      const p = pieceOf(ctx, ms.units[0]!);
      // Once a vehicle has moved to a new hex it is a moving target for any Defensive Fire that turn (SK4 3.3.2).
      setTags(ctx, p.id, { [T3.movingTarget]: true });
      // Entering the hex is an MP expenditure like any other: it earns a turret change (SK4 3.3.2) and
      // another Bounding First Fire shot (SK4 3.3.2.2), which the in-place spends count the same way.
      const cost = ms.mfHere;
      ctx.emit('sk1.move.state', { state: { ...ms, vehicle: { ...ms.vehicle, sinceTurret: ms.vehicle.sinceTurret + cost, turretTurned: false, sinceBff: (ms.vehicle.sinceBff ?? 0) + cost } } });
      if (bogTerrain(ctx, ms.hex)) {
        const d = vehicle(ctx, p)!;
        const halfMp = ms.mfHere < d.mp && ms.mfHere <= d.mp / 2 + 0.01 && !ms.vehicle.freeStop;
        if (bogCheck(ctx, p, ms.hex, halfMp, 'enter')) {
          const after = moveState(ctx)!;
          ctx.emit('sk1.move.state', { state: { ...after, halted: true, vehicle: { ...after.vehicle!, stopped: true, started: false } } });
        }
      }
    });
    // Finishing the move: a vehicle that did not stop is in Motion (SK4 3.3.2).
    r.procedure<MoveFinishFn>(MOVE_FINISH, (next) => (ctx) => {
      const ms = moveState(ctx);
      if (ms?.vehicle) {
        const p = pieceOf(ctx, ms.units[0]!);
        const motion = !ms.vehicle.stopped && !isImmobile(p) && p.loc.kind !== 'eliminated';
        setTags(ctx, p.id, { [T3.motion]: motion ? true : null, ...(motion ? { [T3.movingTarget]: true } : {}) });
        ctx.emit(MOVING_TARGET_EVENT, { vehicle: p.id, kind: motion ? 'motion' : 'end', mp: remaining(ms), hex: ms.hex });
      }
      next?.(ctx);
    });

    // ---------------------------------------------------------------- start
    r.action<VehicleMoveAction & { type: 'vmove.start' }>({
      type: 'vmove.start',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        if (env.state.phase !== 'MPh') return [];
        const ms = moveState(env);
        if (ms) return ms.vehicle && !vehicleCannotStart(env, ms.units[0]!) ? [{ type: 'vmove.start', vehicle: ms.units[0]! }] : [];
        return Object.values(env.state.pieces)
          .filter((p) => p.side === env.state.attacker && vehicle(env, p) && !vehicleCannotStart(env, p.id))
          .sort(byId)
          .map((p) => ({ type: 'vmove.start', vehicle: p.id }));
      },
      validate: (env, a) => env.query('vehicle.cannotStart', { vehicle: a.vehicle }, null),
      resolve(ctx, a) {
        const p = pieceOf(ctx, a.vehicle);
        const d = vehicle(ctx, p)!;
        let ms = moveState(ctx) as (MoveState & { vehicle: VehicleMoveState }) | undefined;
        if (!ms) {
          const motion = inMotion(p);
          ms = {
            units: [p.id],
            started: [p.id],
            hex: p.loc.kind === 'hex' ? p.loc.hex : null,
            off: p.loc.kind === 'offboard' ? (p.loc.hex ?? null) : null,
            allowance: { [p.id]: ctx.query('unit.mf', { unit: p.id, stack: [p.id], doubleTime: false }, d.mp) },
            spent: { [p.id]: entrySpent(ctx, p, d.mp) },
            doubleTime: false,
            assault: false,
            hexesEntered: 0,
            roadOnly: false,
            viaRoad: false,
            mfHere: 0,
            firedHere: {},
            residualDrmHere: null,
            smokeTried: false,
            leaderBonus: [],
            from: null,
            trail: [],
            vehicle: { started: motion, stopped: !motion, sinceTurret: 0 },
          };
          ctx.emit('sk1.move.state', { state: ms });
          if (motion) {
            // Already in Motion: no start MP, it simply goes on (SK4 3.3.2).
            ctx.emit(MOVING_TARGET_EVENT, { vehicle: p.id, kind: 'start', mp: 0, hex: ms.hex });
            moveInternals.reAskMover(ctx);
            return;
          }
        }
        // A Bogged vehicle spends its start MP trying to free itself (SK4 7.6).
        if (isBogged(p)) {
          const roll = ctx.roll(`Bog removal for ${p.id}`);
          const [white, colored] = roll.dice as [number, number];
          const mired = p.tags[T3.bog] === 'mired';
          const c = colored + (mired ? 1 : 0);
          let mp = colored * white * (d.tracked ? 1 : 2);
          const left = remaining(ms);
          if (c <= 4) {
            setTags(ctx, p.id, { [T3.bog]: null });
            mp = Math.min(mp, left);
            ctx.emit('sk3.vehicle.unbog', { vehicle: p.id, colored: c, white, result: 'freed', mp });
            spendVehicle(ctx, ms, mp, { started: true, stopped: false });
          } else if (c === 5) {
            setTags(ctx, p.id, { [T3.bog]: 'mired' });
            ctx.emit('sk3.vehicle.unbog', { vehicle: p.id, colored: c, white, result: 'mired', mp: 0 });
            ctx.emit('sk1.move.state', { state: { ...ms, halted: true } });
          } else {
            setTags(ctx, p.id, { [T3.bog]: null, [T3.immob]: true });
            ctx.emit('sk3.vehicle.unbog', { vehicle: p.id, colored: c, white, result: 'immobilized', mp: 0 });
            ctx.emit('sk1.move.state', { state: { ...ms, halted: true } });
          }
          exposed(ctx);
          return;
        }
        // The start MP, in the hex it stands in (not yet a moving target), then Mechanical Reliability (SK4 3.3.2).
        const restart = ms.hexesEntered > 0 || ms.spent[p.id]! > entrySpent(ctx, p, d.mp);
        spendVehicle(ctx, ms, 1, { started: true, stopped: false, freeStop: false });
        ctx.emit(MOVING_TARGET_EVENT, { vehicle: p.id, kind: restart ? 'restart' : 'start', mp: 1, hex: ms.hex });
        if (d.redMp) {
          const roll = ctx.roll(`Mechanical Reliability for ${p.id}`);
          const cur = moveState(ctx) as MoveState & { vehicle: VehicleMoveState };
          if (roll.total === 12) {
            setTags(ctx, p.id, { [T3.immob]: true, [T3.motion]: null });
            ctx.emit('sk3.vehicle.reliability', { vehicle: p.id, dr: roll.dice as [number, number], result: 'immobilized' });
            ctx.emit('sk1.move.state', { state: { ...cur, halted: true, vehicle: { ...cur.vehicle, stopped: true, started: false } } });
          } else if (roll.total === 11 && d.stallOn11) {
            // Russian Vehicle Note M: a stall; a second DR is the Delay MP wasted (the stop MP among them).
            const wasted = ctx.roll(`Stall: MP wasted by ${p.id}`).total;
            const spend = Math.min(wasted, remaining(cur));
            setTags(ctx, p.id, { [T3.stalled]: true });
            ctx.emit('sk3.vehicle.reliability', { vehicle: p.id, dr: roll.dice as [number, number], result: 'stall', wasted });
            spendVehicle(ctx, cur, spend, { started: false, stopped: true }, remaining(cur) - spend <= 0 ? { halted: true } : {});
          } else ctx.emit('sk3.vehicle.reliability', { vehicle: p.id, dr: roll.dice as [number, number], result: 'ok' });
        }
        exposed(ctx);
      },
    });

    // ---------------------------------------------------------------- stop, Delay
    r.action<VehicleMoveAction & { type: 'vmove.stop' }>({
      type: 'vmove.stop',
      decisionKinds: [PHASE_DECISION],
      legal: (env) => {
        const m = movingVehicle(env);
        return m && m.ms.vehicle.started && !m.ms.vehicle.stopped && !m.ms.halted && (m.ms.vehicle.freeStop || remaining(m.ms) >= 1) ? [{ type: 'vmove.stop' }] : [];
      },
      validate(env) {
        const m = movingVehicle(env);
        if (!m) return 'No vehicle is moving';
        if (!m.ms.vehicle.started || m.ms.vehicle.stopped) return 'The vehicle is already stopped';
        if (m.ms.halted) return 'The vehicle has already come to a halt';
        if (!m.ms.vehicle.freeStop && remaining(m.ms) < 1) return 'Stopping costs 1 MP';
        return null;
      },
      resolve(ctx) {
        const m = movingVehicle(ctx)!;
        const cost = m.ms.vehicle.freeStop ? 0 : 1;
        spendVehicle(ctx, m.ms, cost, { stopped: true, started: false, freeStop: false });
        // Motion status ends with the stop (SK4 2.0: "started since the last time it stopped"); it stays a moving target this turn.
        if (inMotion(m.p)) setTags(ctx, m.p.id, { [T3.motion]: null, [T3.movingTarget]: true });
        ctx.emit(MOVING_TARGET_EVENT, { vehicle: m.p.id, kind: 'stop', mp: cost, hex: m.ms.hex });
        if (cost > 0) exposed(ctx);
        else moveInternals.reAskMover(ctx);
      },
    });
    r.action<VehicleMoveAction & { type: 'vmove.delay' }>({
      type: 'vmove.delay',
      decisionKinds: [PHASE_DECISION],
      legal: (env) => {
        const m = movingVehicle(env);
        return m && m.ms.vehicle.stopped && !m.ms.halted && remaining(m.ms) >= 1 ? [{ type: 'vmove.delay', mp: 1 }] : [];
      },
      validate(env, a) {
        const m = movingVehicle(env);
        if (!m) return 'No vehicle is moving';
        if (!m.ms.vehicle.stopped) return 'Only a stopped vehicle may Delay';
        if (m.ms.halted) return 'The vehicle has come to a halt';
        const mp = a.mp ?? 1;
        if (!(mp > 0) || mp > remaining(m.ms)) return `Delay 1 to ${remaining(m.ms)} MP`;
        return null;
      },
      resolve(ctx, a) {
        const m = movingVehicle(ctx)!;
        const mp = a.mp ?? 1;
        spendVehicle(ctx, m.ms, mp, {});
        ctx.emit(MOVING_TARGET_EVENT, { vehicle: m.p.id, kind: 'delay', mp, hex: m.ms.hex });
        exposed(ctx);
      },
    });

    // ---------------------------------------------------------------- turning the hull and the turret
    r.action<VehicleMoveAction & { type: 'vmove.turn' }>({
      type: 'vmove.turn',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const m = movingVehicle(env);
        if (!m || !m.ms.vehicle.started || m.ms.halted) return [];
        const out: { type: 'vmove.turn'; vca: number }[] = [];
        for (let vca = 0; vca < SPINES; vca++) if (!turnIllegal(env, m.ms, m.p, vca)) out.push({ type: 'vmove.turn', vca });
        return out;
      },
      validate(env, a) {
        const m = movingVehicle(env);
        if (!m) return 'No vehicle is moving';
        return turnIllegal(env, m.ms, m.p, a.vca);
      },
      resolve(ctx, a) {
        const m = movingVehicle(ctx)!;
        const from = vcaOf(m.p);
        const close = closeTerrain(ctx, m.ms.hex);
        // In woods or a building each hexspine risks Bog, and the turn stops where the vehicle bogs (SK4 7.6, D8.2).
        const turn = close && m.ms.hex ? turnRiskingBog(ctx, m.p, m.ms.hex, a.vca) : { vca: a.vca, tried: spineChange(from, a.vca), bogged: false };
        const cost = turn.tried * (close ? 2 : 1);
        const d = vehicle(ctx, m.p)!;
        const delta = ((turn.vca - from) % 6 + 6) % 6;
        const newTca = d.turret === 'NT' ? turn.vca : (tcaOf(ctx, m.p) + delta) % 6;
        if (turn.vca !== from) setTags(ctx, m.p.id, { [T3.vca]: turn.vca, [T2.ca]: newTca });
        if (turn.bogged) {
          spendVehicle(ctx, m.ms, cost, { stopped: true, started: false }, { halted: true });
          exposed(ctx);
          return;
        }
        spendVehicle(ctx, m.ms, cost, { turned: true });
        ctx.emit(MOVING_TARGET_EVENT, { vehicle: m.p.id, kind: 'turn', mp: cost, vca: turn.vca, tca: newTca, spines: turn.tried, hex: m.ms.hex });
        exposed(ctx);
      },
    });
    r.action<VehicleMoveAction & { type: 'vmove.turret' }>({
      type: 'vmove.turret',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const m = movingVehicle(env);
        if (!m || turretIllegal(env, m.ms, m.p, null)) return [];
        return [0, 1, 2, 3, 4, 5].filter((tca) => tca !== tcaOf(env, m.p)).map((tca) => ({ type: 'vmove.turret' as const, tca }));
      },
      validate(env, a) {
        const m = movingVehicle(env);
        if (!m) return 'No vehicle is moving';
        return turretIllegal(env, m.ms, m.p, a.tca);
      },
      resolve(ctx, a) {
        const m = movingVehicle(ctx)!;
        setTags(ctx, m.p.id, { [T2.ca]: a.tca });
        // The first turn after an expenditure uses it up; later ones before the next expenditure refine it.
        ctx.emit('sk1.move.state', { state: { ...m.ms, vehicle: { ...m.ms.vehicle, sinceTurret: m.ms.vehicle.turretTurned ? m.ms.vehicle.sinceTurret : 0, turretTurned: true } } });
        ctx.emit(MOVING_TARGET_EVENT, { vehicle: m.p.id, kind: 'turret', mp: 0, tca: a.tca, hex: m.ms.hex });
        moveInternals.reAskMover(ctx);
      },
    });

    // ---------------------------------------------------------------- ending the move
    r.action<VehicleMoveAction & { type: 'vmove.end' }>({
      type: 'vmove.end',
      decisionKinds: [PHASE_DECISION],
      legal: (env) => {
        const m = movingVehicle(env);
        return m && !endIllegal(env, m.ms, m.p) ? [{ type: 'vmove.end' }] : [];
      },
      validate(env) {
        const m = movingVehicle(env);
        if (!m) return 'No vehicle is moving';
        return endIllegal(env, m.ms, m.p);
      },
      resolve(ctx) {
        const m = movingVehicle(ctx)!;
        const left = remaining(m.ms);
        if (m.ms.vehicle.stopped && left > 0 && m.ms.hex) {
          // MP left when the move ends are spent in that hex as Delay (SK4 3.3.2): one more First Fire chance.
          spendVehicle(ctx, m.ms, left, { ending: true });
          ctx.emit(MOVING_TARGET_EVENT, { vehicle: m.p.id, kind: 'delay', mp: left, hex: m.ms.hex });
          exposed(ctx);
          return;
        }
        // No MP to Delay: the move is over where it stands, and the defender may still fire at it there (SK1 3.3.1).
        ctx.emit('sk1.move.state', { state: { ...m.ms, vehicle: { ...m.ms.vehicle, ending: true } } });
        moveInternals.endStack(ctx);
      },
    });

    // ---------------------------------------------------------------- Bounding First Fire (SK4 3.3.2.2)
    r.action<Action & { type: 'vmove.bff'; shot: OrdnanceShot }>({
      type: 'vmove.bff',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const m = movingVehicle(env);
        if (!m || !m.ms.hex) return [];
        // Enemy-held hexes the vehicle can see from where it stands (a blocked shot would still count as its fire).
        const from = m.ms.hex;
        const targets = [...new Set(Object.values(env.state.pieces).filter((p) => p.side !== m.p.side && p.loc.kind === 'hex').map((p) => (p.loc as { hex: HexId }).hex))].filter(
          (t) => t === from || env.query('los.trace', { from, to: t }, { clear: true, hindrance: 0, parts: [] }).clear,
        );
        // The Area Target Type is never Bounding First Fire (SK4 3.3.2.2).
        return simpleShots(env, m.p.side, targets, 'bounding').filter((s) => s.weapon === m.p.id && s.targetType !== 'ATT').map((shot) => ({ type: 'vmove.bff' as const, shot }));
      },
      validate(env, a) {
        const m = movingVehicle(env);
        if (!m) return 'No vehicle is moving';
        if (a.shot.weapon !== m.p.id) return 'Only the moving vehicle fires Bounding First Fire';
        if (!m.ms.hex) return 'Fire from the map';
        if (a.shot.targetType === 'ATT') return 'The Area Target Type cannot be used as Bounding First Fire';
        return env.query('ordnance.illegal', { shot: a.shot, mode: 'bounding', side: m.p.side }, null);
      },
      resolve(ctx, a) {
        ctx.proc<OrdnanceFireFn>(OP.fire)(ctx, a.shot, 'bounding');
        if (!ctx.state.result) moveInternals.reAskMover(ctx);
      },
    });

    // ---------------------------------------------------------------- vehicular smoke dispensers (SK4 7.5)
    r.event<{ vehicle: PieceId; kind: 'sD' | 'sM' | 'sP' | 'sN'; dr: [number, number]; drm: number; n: number; placed: boolean; hex: HexId }>({ type: 'sk3.vehicle.smoke', apply() {} });
    const smokeIllegal = (env: QueryEnv, id: PieceId, side: string, target: HexId | undefined, defending: boolean): string | null => {
      const p = env.state.pieces[id];
      const d = p && vehicle(env, p);
      if (!p || !d) return 'Not a vehicle';
      if (p.side !== side) return 'Not your vehicle';
      const disp = d.smoke?.[0];
      if (!disp) return 'The vehicle has no smoke dispenser';
      if (isWreck(p) || !crewCanAct(p)) return 'The crew cannot use the dispenser now';
      if (p.tags[T3.smokeUsed]) return 'The dispenser was used this Player Turn';
      if (fireMarker(p) || p.tags[T3.bff] || swHeldBy(env.state, id).some((w) => fireMarker(w))) return 'A vehicle that has fired a weapon this Player Turn may not dispense smoke';
      if (disp.kind === 'sP' && !isCe(p)) return 'Smoke Pots need a Crew Exposed crew';
      if (disp.kind === 'sN' && isCe(p)) return 'The Nahverteidigungswaffe needs a Buttoned Up crew';
      const at = hexOf(env.state, p);
      if (!at || !statics(env).map.hex(at)) return 'The vehicle is not on the map';
      if (!defending) {
        const ms = moveState(env);
        if (!ms?.vehicle || ms.units[0] !== id) return 'In your MPh the vehicle must be the one moving';
        if (!disp || remaining(ms) < 1) return 'Dispensing smoke costs 1 MP';
      }
      if (disp.kind === 'sM') {
        if (!target) return 'Choose a hex for the Smoke Mortar';
        const map = statics(env).map;
        const dist = map.distance(at, target);
        if (dist < 1 || dist > 3) return 'A Smoke Mortar reaches 1 to 3 hexes';
        if (!inCoveredArc(map.hex(at)!.cube, tcaOf(env, p), map.hex(target)!.cube)) return 'A Smoke Mortar fires within the TCA';
        if (isBuildingHex(env, at)) return 'A Smoke Mortar cannot fire from inside a building';
      } else if (target && target !== at) return 'This dispenser smokes its own hex';
      return null;
    };
    const dispense = (ctx: Ctx, id: PieceId, target: HexId | undefined, defending: boolean) => {
      const p = pieceOf(ctx, id);
      const d = vehicle(ctx, p)!;
      const disp = d.smoke![0]!;
      const at = hexOf(ctx.state, p)!;
      const hex = disp.kind === 'sM' ? target! : at;
      let drm = isCe(p) ? 0 : 1;
      const ms = moveState(ctx);
      if (disp.kind === 'sM' && (inMotion(p) || (ms?.vehicle && ms.units[0] === id && !ms.vehicle.stopped))) drm += 2;
      if (disp.kind === 'sM') drm += ctx.query('los.trace', { from: at, to: hex }, { clear: true, hindrance: 0, parts: [] }).hindrance;
      const roll = ctx.roll(`${disp.kind}${disp.n} smoke by ${id}`);
      const placed = roll.total + drm <= disp.n;
      setTags(ctx, id, { [T3.smokeUsed]: true });
      ctx.emit('sk3.vehicle.smoke', { vehicle: id, kind: disp.kind, dr: roll.dice as [number, number], drm, n: disp.n, placed, hex });
      if (placed) {
        // Dispersed Smoke, a +2 ⅝" counter (SK4 1.2.5, 7.5).
        ctx.emit('hex.marker', { hex, key: SMOKE58.kind, value: 'smoke' });
        ctx.emit('hex.marker', { hex, key: SMOKE58.dispersed, value: true });
        ctx.emit('hex.marker', { hex, key: SMOKE58.side, value: p.side });
        ctx.emit('sk2.smoke.placed', { hex, kind: 'smoke', dispersed: true, side: p.side });
      }
      // In its own MPh a successful attempt costs 1 MP (an opportunity for Defensive First Fire).
      if (!defending && placed && ms?.vehicle) {
        spendVehicle(ctx, ms as MoveState & { vehicle: VehicleMoveState }, 1, {});
        exposed(ctx);
        return;
      }
      if (!defending) moveInternals.reAskMover(ctx);
    };
    r.action<Action & { type: 'vmove.smoke'; target?: HexId }>({
      type: 'vmove.smoke',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const m = movingVehicle(env);
        if (!m || !m.ms.hex) return [];
        const d = vehicle(env, m.p)!;
        if (!d.smoke?.length) return [];
        if (d.smoke[0]!.kind !== 'sM') return smokeIllegal(env, m.p.id, m.p.side, undefined, false) ? [] : [{ type: 'vmove.smoke' as const }];
        return statics(env).map.neighbors(m.ms.hex).filter((h) => !smokeIllegal(env, m.p.id, m.p.side, h, false)).map((target) => ({ type: 'vmove.smoke' as const, target }));
      },
      validate(env, a) {
        const m = movingVehicle(env);
        if (!m) return 'No vehicle is moving';
        return smokeIllegal(env, m.p.id, m.p.side, a.target, false);
      },
      resolve: (ctx, a) => dispense(ctx, movingVehicle(ctx)!.p.id, a.target, false),
    });
    // During the enemy MPh a dispenser may be used like Defensive First Fire, after a MF/MP expenditure in the vehicle's LOS (7.5).
    r.action<Action & { type: 'defSmoke'; vehicle: PieceId; target?: HexId }>({
      type: 'defSmoke',
      decisionKinds: ['firstFire'],
      legal(env) {
        const ms = moveState(env);
        if (!ms?.hex) return [];
        const side = env.state.sides.find((s) => s !== env.state.attacker)!;
        return Object.values(env.state.pieces)
          .filter((p) => p.side === side && vehicle(env, p)?.smoke?.length && vehicle(env, p)!.smoke![0]!.kind !== 'sM' && !smokeIllegal(env, p.id, side, undefined, true))
          .filter((p) => {
            const at = hexOf(env.state, p);
            return !!at && env.query('los.trace', { from: at, to: ms.hex! }, { clear: true, hindrance: 0, parts: [] }).clear;
          })
          .sort(byId)
          .map((p) => ({ type: 'defSmoke' as const, vehicle: p.id }));
      },
      validate(env, a) {
        const ms = moveState(env);
        if (!ms?.hex) return 'Nothing is moving';
        const p = env.state.pieces[a.vehicle];
        const at = p && hexOf(env.state, p);
        if (!at || !env.query('los.trace', { from: at, to: ms.hex }, { clear: true, hindrance: 0, parts: [] }).clear) return 'The moving unit is not in the vehicle\'s LOS';
        return smokeIllegal(env, a.vehicle, a.side, a.target, true);
      },
      resolve(ctx, a) {
        dispense(ctx, a.vehicle, a.target, true);
        // The defender keeps the floor: the dispenser is no weapon, it may still fire.
        ctx.popDecision();
        moveInternals.offerFirstFire(ctx);
      },
    });

    // ---------------------------------------------------------------- Motion Status attempt (SK4 3.3.2.1)
    r.event<{ vehicle: PieceId; dr: number; mp: number; success: boolean }>({ type: 'sk3.vehicle.motionAttempt', apply() {} });
    const motionIllegal = (env: QueryEnv, id: PieceId, side: string): string | null => {
      const p = env.state.pieces[id];
      if (!p || !vehicle(env, p)) return 'Not a vehicle';
      if (p.side !== side) return 'Not your vehicle';
      if (!isMobile(p) || p.tags[T3.dugIn]) return 'Only a mobile vehicle may attempt Motion';
      if (fireMarker(p) || p.tags[T2.intensive] || swHeldBy(env.state, id).some((w) => fireMarker(w))) return 'A vehicle marked First/Final/Intensive Fire may not attempt Motion';
      if (p.tags[MOTION_TRIED]) return 'One Motion attempt per enemy MPh';
      const ms = moveState(env);
      if (!ms?.hex) return 'Nothing is moving';
      const at = hexOf(env.state, p);
      if (!at || !env.query('los.trace', { from: at, to: ms.hex }, { clear: true, hindrance: 0, parts: [] }).clear) return 'The moving unit is not in the vehicle\'s LOS';
      // The enemy unit must not have been in the AFV's LOS at the start of the Player Turn.
      const seen = (env.state.ext['sk3.losStart'] as Record<PieceId, PieceId[]> | undefined)?.[id] ?? [];
      if (ms.units.some((u) => seen.includes(u))) return 'That unit was already in the vehicle\'s LOS when the Player Turn began';
      return null;
    };
    r.action<Action & { type: 'defMotion'; vehicle: PieceId }>({
      type: 'defMotion',
      decisionKinds: ['firstFire'],
      legal(env) {
        const side = env.state.sides.find((s) => s !== env.state.attacker)!;
        return Object.values(env.state.pieces).filter((p) => p.side === side && vehicle(env, p) && !motionIllegal(env, p.id, side)).sort(byId).map((p) => ({ type: 'defMotion' as const, vehicle: p.id }));
      },
      validate: (env, a) => motionIllegal(env, a.vehicle, a.side),
      resolve(ctx, a) {
        const p = pieceOf(ctx, a.vehicle);
        const at = hexOf(ctx.state, p)!;
        const mp = motionMp(ctx, p);
        const dr = ctx.roll(`Motion attempt by ${a.vehicle} (needs ≤ ${mp})`, 1).dice[0]!;
        const success = dr <= mp;
        setTags(ctx, a.vehicle, { [MOTION_TRIED]: true });
        ctx.emit('sk3.vehicle.motionAttempt', { vehicle: a.vehicle, dr, mp, success });
        // A vehicle already in Motion is attempting to change its facing (3.3.2.1): it is running, so only
        // one that starts now takes the Mechanical Reliability DR, and a stall means the attempt has failed.
        let moving = inMotion(p);
        if (success && !moving) {
          const d = vehicle(ctx, p)!;
          if (d.redMp) {
            const roll = ctx.roll(`Mechanical Reliability for ${a.vehicle}`);
            if (roll.total === 12) {
              setTags(ctx, a.vehicle, { [T3.immob]: true });
              ctx.emit('sk3.vehicle.reliability', { vehicle: a.vehicle, dr: roll.dice as [number, number], result: 'immobilized' });
            } else {
              ctx.emit('sk3.vehicle.reliability', { vehicle: a.vehicle, dr: roll.dice as [number, number], result: 'ok' });
              setTags(ctx, a.vehicle, { [T3.motion]: true, [T3.movingTarget]: true });
              moving = true;
            }
          } else {
            setTags(ctx, a.vehicle, { [T3.motion]: true, [T3.movingTarget]: true });
            moving = true;
          }
        }
        ctx.popDecision();
        // Success: the AFV may now freely change its VCA/TCA, a decision of its own before the defender
        // gets back to the First Fire question.
        if (success && moving) {
          ctx.pushDecision({ kind: MOTION_FACING, owner: a.side, deadlineClass: 'interrupt', data: { vehicle: a.vehicle, hex: at } });
          return;
        }
        moveInternals.offerFirstFire(ctx);
      },
    });
    r.contribute({ id: 'sk3.vehicle.motionMp', query: 'vehicle.motionMp', layer: 0, apply: (_v, { vehicle: id }, env) => motionMp(env, pieceOf(env, id)) });

    // ---------------------------------------------------------------- facing after a Motion attempt (SK4 3.3.2.1)
    // The AFV "may freely change its VCA/TCA except that if required to by terrain restrictions, it must first
    // pass a Bog Check": any number of hexspines, no MP; in woods or a building a Bog Check (7.6) before each
    // hexspine the hull turns ("one Bog DR per hexspine", ASLRB D8.2), and bogging ends the change. The turret
    // alone needs no check.
    r.event<{ vehicle: PieceId; kind: 'hull' | 'turret'; vca: number; tca: number; spines: number; hex: HexId }>({ type: 'sk3.vehicle.motionTurn', apply() {} });
    const facingVehicle = (env: QueryEnv): Piece | null => {
      const top = env.state.decisions[env.state.decisions.length - 1];
      if (top?.kind !== MOTION_FACING) return null;
      const p = env.state.pieces[top.data?.['vehicle'] as PieceId];
      return p && isMobile(p) && hexOf(env.state, p) ? p : null;
    };
    const facingIllegal = (env: QueryEnv, a: { vehicle: PieceId; side: SideId }): string | null => {
      const p = facingVehicle(env);
      if (!p) return 'No vehicle is changing its facing';
      if (p.id !== a.vehicle) return 'Not the vehicle that went into Motion';
      if (p.side !== a.side) return 'Not your vehicle';
      return null;
    };
    const endFacing = (ctx: Ctx, id: PieceId) => {
      ctx.popDecision();
      moveInternals.offerFirstFire(ctx);
    };
    r.action<Action & { type: 'defMotion.turn'; vehicle: PieceId; vca: number }>({
      type: 'defMotion.turn',
      decisionKinds: [MOTION_FACING],
      legal(env) {
        const p = facingVehicle(env);
        return p ? [0, 1, 2, 3, 4, 5].filter((vca) => vca !== vcaOf(p)).map((vca) => ({ type: 'defMotion.turn' as const, vehicle: p.id, vca })) : [];
      },
      validate(env, a) {
        const err = facingIllegal(env, a);
        if (err) return err;
        if (!Number.isInteger(a.vca) || a.vca < 0 || a.vca >= SPINES) return 'A Vehicle Covered Arc is a hexspine 0-5';
        if (a.vca === vcaOf(env.state.pieces[a.vehicle]!)) return 'The vehicle already faces that way';
        return null;
      },
      resolve(ctx, a) {
        const p = pieceOf(ctx, a.vehicle);
        const hex = hexOf(ctx.state, p)!;
        const from = vcaOf(p);
        const turn = closeTerrain(ctx, hex) ? turnRiskingBog(ctx, p, hex, a.vca) : { vca: a.vca, tried: spineChange(from, a.vca), bogged: false };
        const d = vehicle(ctx, p)!;
        const delta = ((turn.vca - from) % 6 + 6) % 6;
        // The turret turns with the hull, as on a hull turn in the MPh.
        const tca = d.turret === 'NT' ? turn.vca : (tcaOf(ctx, p) + delta) % 6;
        if (turn.vca !== from) {
          setTags(ctx, p.id, { [T3.vca]: turn.vca, [T2.ca]: tca });
          ctx.emit('sk3.vehicle.motionTurn', { vehicle: p.id, kind: 'hull', vca: turn.vca, tca, spines: spineChange(from, turn.vca), hex });
        }
        if (turn.bogged) endFacing(ctx, a.vehicle);
      },
    });
    r.action<Action & { type: 'defMotion.turret'; vehicle: PieceId; tca: number }>({
      type: 'defMotion.turret',
      decisionKinds: [MOTION_FACING],
      legal(env) {
        const p = facingVehicle(env);
        if (!p || vehicle(env, p)!.turret === 'NT') return [];
        return [0, 1, 2, 3, 4, 5].filter((tca) => tca !== tcaOf(env, p)).map((tca) => ({ type: 'defMotion.turret' as const, vehicle: p.id, tca }));
      },
      validate(env, a) {
        const err = facingIllegal(env, a);
        if (err) return err;
        const p = env.state.pieces[a.vehicle]!;
        if (vehicle(env, p)!.turret === 'NT') return 'The vehicle has no turret';
        if (!Number.isInteger(a.tca) || a.tca < 0 || a.tca >= SPINES) return 'A Turret Covered Arc is a hexspine 0-5';
        if (a.tca === tcaOf(env, p)) return 'The turret already points that way';
        return null;
      },
      resolve(ctx, a) {
        const p = pieceOf(ctx, a.vehicle);
        const spines = spineChange(tcaOf(ctx, p), a.tca);
        setTags(ctx, p.id, { [T2.ca]: a.tca });
        ctx.emit('sk3.vehicle.motionTurn', { vehicle: p.id, kind: 'turret', vca: vcaOf(p), tca: a.tca, spines, hex: hexOf(ctx.state, p)! });
      },
    });
    r.action<Action & { type: 'defMotion.done'; vehicle: PieceId }>({
      type: 'defMotion.done',
      decisionKinds: [MOTION_FACING],
      legal(env) {
        const p = facingVehicle(env);
        return p ? [{ type: 'defMotion.done' as const, vehicle: p.id }] : [];
      },
      validate: (env, a) => facingIllegal(env, a),
      resolve(ctx, a) {
        endFacing(ctx, a.vehicle);
      },
    });
    const MOTION_TRIED = 'motionTried';
    /** Passed the one Bog Check its facing change after a Motion attempt needed; cleared when that change ends. */
    // What each vehicle could see when the Player Turn began (3.3.2.1), and the per-MPh attempt flag.
    r.on<{ phase: string; attacker: string }>({
      id: 'sk3.vehicleMove.los-start',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'RPh') return;
        const defender = ctx.state.sides.find((s) => s !== ev.payload.attacker)!;
        const seen: Record<PieceId, PieceId[]> = {};
        const enemies = Object.values(ctx.state.pieces).filter((p) => p.side === ev.payload.attacker && p.loc.kind === 'hex').sort(byId);
        for (const v of Object.values(ctx.state.pieces).filter((p) => p.side === defender && vehicle(ctx, p) && p.loc.kind === 'hex').sort(byId)) {
          const at = (v.loc as { hex: HexId }).hex;
          seen[v.id] = enemies.filter((e) => ctx.query('los.trace', { from: at, to: (e.loc as { hex: HexId }).hex }, { clear: true, hindrance: 0, parts: [] }).clear).map((e) => e.id);
        }
        ctx.emit('sk3.losStart', { seen });
      },
    });
    r.event<{ seen: Record<PieceId, PieceId[]> }>({
      type: 'sk3.losStart',
      apply(d, p) {
        d.ext['sk3.losStart'] = p.seen;
      },
    });

    // ---------------------------------------------------------------- Crew Exposed / Buttoned Up
    r.action<VehicleMoveAction & { type: 'vmove.ce' }>({
      type: 'vmove.ce',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        if (env.state.phase !== 'MPh' && env.state.phase !== 'APh') return [];
        return Object.values(env.state.pieces)
          .filter((p) => p.side === env.state.attacker && vehicle(env, p) && !ceIllegal(env, p.id, !isCe(p)))
          .sort(byId)
          .map((p) => ({ type: 'vmove.ce' as const, vehicle: p.id, ce: !isCe(p) }));
      },
      validate: (env, a) => ceIllegal(env, a.vehicle, a.ce),
      resolve(ctx, a) {
        setTags(ctx, a.vehicle, { [T3.ce]: a.ce ? true : null, [T3.ceChanged]: `${ctx.state.turn}:${ctx.state.attacker}:${ctx.state.phase}` });
        ctx.emit('sk3.vehicle.ce', { vehicle: a.vehicle, ce: a.ce, phase: ctx.state.phase });
        const ms = moveState(ctx);
        if (ms && ms.units[0] === a.vehicle) {
          moveInternals.reAskMover(ctx);
          return;
        }
        ctx.popDecision();
        askPhaseOwner(ctx, ctx.state.attacker);
      },
    });

    // ---------------------------------------------------------------- per-phase cleanup
    r.on<{ phase: string }>({
      id: 'sk3.vehicleMove.mph-end',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'MPh') return;
        for (const p of Object.values(ctx.state.pieces).sort(byId)) {
          const clear = [T3.stalled, MOTION_TRIED].filter((k) => p.tags[k] !== undefined);
          if (clear.length) setTags(ctx, p.id, Object.fromEntries(clear.map((k) => [k, null])));
        }
      },
    });
    r.on<{ phase: string }>({
      id: 'sk3.vehicleMove.turn-end',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'CCPh') return;
        // Moving-target status lasts the Player Turn (SK4 3.3.2); a vehicle in Motion stays one. Smoke dispensers reset.
        for (const p of Object.values(ctx.state.pieces).sort(byId)) {
          const tags: Record<string, null> = {};
          if (p.tags[T3.movingTarget] && !inMotion(p)) tags[T3.movingTarget] = null;
          if (p.tags[T3.smokeUsed]) tags[T3.smokeUsed] = null;
          if (Object.keys(tags).length) setTags(ctx, p.id, tags);
        }
      },
    });
  },
};

function turnIllegal(env: QueryEnv, ms: MoveState & { vehicle: VehicleMoveState }, p: Piece, vca: number): string | null {
  if (!Number.isInteger(vca) || vca < 0 || vca >= SPINES) return 'A Vehicle Covered Arc is a hexspine 0-5';
  if (!ms.vehicle.started) return 'Start the vehicle first (1 MP)';
  if (ms.halted) return 'The vehicle has come to a halt';
  if (isBogged(p)) return 'A bogged vehicle may not change its VCA';
  const spines = spineChange(vcaOf(p), vca);
  if (spines === 0) return 'The vehicle already faces that way';
  const cost = spines * (closeTerrain(env, ms.hex) ? 2 : 1);
  if (cost > remaining(ms)) return `Turning ${spines} hexspine${spines > 1 ? 's' : ''} costs ${cost} MP (${remaining(ms)} left)`;
  return null;
}

function turretIllegal(env: QueryEnv, ms: MoveState & { vehicle: VehicleMoveState }, p: Piece, tca: number | null): string | null {
  const d = vehicle(env, p)!;
  if (d.turret === 'NT') return 'The vehicle has no turret';
  if (!crewCanAct(p)) return 'The crew cannot act';
  if (tca !== null && (!Number.isInteger(tca) || tca < 0 || tca >= SPINES)) return 'A Turret Covered Arc is a hexspine 0-5';
  if (tca !== null && tca === tcaOf(env, p)) return 'The turret already points that way';
  // A change already announced on the last expenditure may be refined freely (any number of hexspines, 3.3.2).
  if (ms.vehicle.turretTurned) return null;
  const need = closeTerrain(env, ms.hex) ? 2 : 1;
  if (ms.vehicle.sinceTurret < need) return need === 2 ? 'In woods or a building the turret turns only after 2 MP are spent' : 'The turret turns as MP are spent: spend MP first';
  return null;
}

function endIllegal(env: QueryEnv, ms: MoveState & { vehicle: VehicleMoveState }, p: Piece): string | null {
  if (ms.vehicle.ending) return 'The move is ending';
  if (ms.halted) return null;
  const left = remaining(ms);
  if (!ms.vehicle.stopped && left > 0 && !ms.vehicle.freeStop) {
    const cheapest = cheapestStep(env, ms);
    if (cheapest !== null && cheapest <= left) return `A moving vehicle spends all its MP, stops (1 MP) or ends in Motion only when it cannot enter another hex (${left} MP left)`;
  }
  // One vehicle per side per hex at the end of the MPh (SK4 3.3.2).
  if (ms.hex && vehiclesInHex(env, ms.hex, p.side, true).some((v) => v.id !== p.id)) return 'Only one vehicle per side may end the MPh in a hex: move on';
  return null;
}

function ceIllegal(env: QueryEnv, id: PieceId, ce: boolean): string | null {
  const p = env.state.pieces[id];
  const d = p && vehicle(env, p);
  if (!p || !d) return 'Not a vehicle';
  if (p.side !== env.state.attacker) return 'Not your vehicle';
  if (env.state.phase !== 'MPh' && env.state.phase !== 'APh') return 'CE/BU changes in your Movement or Advance Phase';
  if (isWreck(p)) return 'A wreck has no crew';
  if (!crewCanAct(p)) return 'A Shocked or Stunned crew stays Buttoned Up';
  if (isCe(p) === ce) return ce ? 'Already Crew Exposed' : 'Already Buttoned Up';
  if (p.tags[T3.ceChanged] === `${env.state.turn}:${env.state.attacker}:${env.state.phase}`) return 'CE/BU may change once per phase';
  if (env.state.phase === 'MPh' && (fireMarker(p) === 'prep' || swHeldBy(env.state, id).some((w) => fireMarker(w) === 'prep'))) return 'No CE/BU change in the MPh after Prep Fire';
  // ASLRB D5.33: no change "in a MPh following Prep or Bounding First Fire"; the APh is free.
  if (env.state.phase === 'MPh' && p.tags[T3.bff]) return 'No CE/BU change after Bounding First Fire';
  const ms = moveState(env);
  if (ms && ms.units[0] !== id) return 'Finish moving the current stack first';
  const hex = hexOf(env.state, p);
  if (ce && hex && isBuildingHex(env, hex) && p.loc.kind === 'hex' && !isMobile(p)) return null;
  return null;
}
