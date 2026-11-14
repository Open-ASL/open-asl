import type { Ctx, Decision, HexId, Piece, PieceId, QueryEnv, RuleModule , SideId } from '@asl/engine';
import { byId, statics, swHeldBy } from '../common/pieces';
import type { SwDef } from '../common/statics';
import { SETUP_PLACED, setupGeography, type SetupAction, type SetupPlacedFn } from '../sk1/scenario';
import { pieceOf, setTags } from '../sk1/status';
import { SPINES, nearestSpine } from '../sk2/arc';
import { T2 } from '../sk2/status';
import { T3, vehicle, vehicleMgDefId, type VehicleMgKind } from './status';

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Why `vehicle` may not set up dug in at `hex`, or null when a special rule allows it (S28 SSR 3, `dig-in`). */
    'vehicle.digIn': { ctx: { vehicle: PieceId; hex: HexId }; value: string | null };
  }
}

/*
 * Vehicle pieces (SK4 1.2.7, 7.0). A vehicle's machine guns are pieces of their own held by the
 * vehicle (`fixed` SW), so the IFT fire machinery treats them like any MG; they are created with the
 * vehicle and never dropped, transferred or recovered. At setup a vehicle is given its Vehicle
 * Covered Arc (and a turret its own arc), may start Crew Exposed (7.7), and one that starts
 * offboard starts in Motion (3.3.2).
 */

const MG_RANGE: Record<VehicleMgKind, number> = { bmg: 8, cmg: 12, aamg: 8, rmg: 8 };

/** The vehicular MG defs of a vehicle def (the content package registers them as counters). */
export function vehicleMgDefs(d: { id: string; nationality: string; mg: { bmg?: number; bmgFixed?: boolean; cmg?: number; aamg?: number; rmg?: number }; maMg?: { mg: 'bmg' | 'cmg'; rof?: number } }): SwDef[] {
  const out: SwDef[] = [];
  const add = (kind: VehicleMgKind, type: SwDef['type'], fp: number | undefined, fixedMount = false) => {
    if (fp === undefined || fp <= 0) return;
    // A MG that is the vehicle's MA fires with the MA's printed ROF.
    const rof = d.maMg?.mg === kind ? d.maMg.rof : undefined;
    out.push({ id: vehicleMgDefId(d.id, kind), nationality: d.nationality, kind: 'sw', type, fp, range: MG_RANGE[kind], pp: 0, fixed: true, ...(fixedMount ? { fixedMount: true } : {}), ...(rof ? { rof } : {}), b: 12, repair: 1 });
  };
  add('bmg', 'BMG', d.mg.bmg, !!d.mg.bmgFixed);
  add('cmg', 'CMG', d.mg.cmg);
  add('aamg', 'AAMG', d.mg.aamg);
  add('rmg', 'RMG', d.mg.rmg);
  return out;
}

const isBuildingHex = (env: QueryEnv, hex: HexId) => !!statics(env).map.hex(hex)?.buildingId;

/** The hexspine a vehicle set up in `hex` faces by default: into the map from an offboard hex, otherwise spine 0. */
export function defaultVca(env: QueryEnv, hex: HexId, side?: SideId): number {
  const map = statics(env).map;
  const off = map.offboardHex(hex);
  if (!off) {
    // On the map: toward the enemy's nearest front hex, where the card gives one.
    const at = map.hex(hex);
    if (!at || !side) return 0;
    const front = setupGeography(env, side).front.map((f) => map.hex(f)).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => map.distance(hex, a.id) - map.distance(hex, b.id))[0];
    return front ? (nearestSpine(at.cube, 0, front.cube) ?? 0) : 0;
  }
  const onboard = map.offboardNeighbors(hex).onboard;
  const target = onboard.map((id) => map.hex(id)).find(Boolean);
  if (!target) return 0;
  return nearestSpine(off.cube, 0, target.cube) ?? 0;
}

/** Why the vehicles of a setup action are placed illegally, or null (SK4 1.1.1, 7.7); one vehicle per hex is a stacking rule (`placementIllegal`). */
export function vehicleSetupIllegal(env: QueryEnv, side: string, todo: PieceId[], a: SetupAction): string | null {
  for (const id of todo) {
    const hex = a.placements[id];
    const p = env.state.pieces[id];
    if (!hex || !p) continue;
    const d = vehicle(env, p);
    if (!d) continue;
    const spec = a.vehicles?.[id];
    if (!spec || !Number.isInteger(spec.vca) || spec.vca < 0 || spec.vca >= SPINES) return `${id} needs a Vehicle Covered Arc (hexspine 0-5)`;
    if (spec.tca !== undefined) {
      if (d.turret === 'NT') return `${id} has no turret to point`;
      if (!Number.isInteger(spec.tca) || spec.tca < 0 || spec.tca >= SPINES) return `${id}: a Turret Covered Arc is a hexspine 0-5`;
    }
    if (spec.dugIn) {
      const why = env.query('vehicle.digIn', { vehicle: id, hex }, 'No special rule lets this vehicle dig in');
      if (why) return `${id}: ${why}`;
    }
    if (isBuildingHex(env, hex)) {
      if (!d.tracked) return `${id}: an Armored Car may not set up in a building`;
      if (spec.ce) return `${id}: a Crew Exposed AFV may not be in a building`;
    }
  }
  return null;
}

/** Give a vehicle its setup facing and CE/BU (SK4 3.3.2); one that starts offboard starts in Motion. */
function placeVehicle(ctx: Ctx, id: PieceId, spec: NonNullable<SetupAction['vehicles']>[PieceId]) {
  const p = ctx.state.pieces[id];
  const d = p && vehicle(ctx, p);
  if (!p || !d) return;
  const tags: Record<string, number | boolean> = { [T3.vca]: spec.vca, [T2.ca]: d.turret === 'NT' ? spec.vca : (spec.tca ?? spec.vca) };
  if (spec.ce ?? d.openTopped) tags[T3.ce] = true;
  if (spec.dugIn) tags[T3.dugIn] = true;
  // All vehicles that start offboard start in Motion (SK4 3.3.2).
  if (p.loc.kind === 'offboard') tags[T3.motion] = true;
  setTags(ctx, id, tags);
  ctx.emit('sk3.vehicle.setup', { vehicle: id, vca: spec.vca, tca: tags[T2.ca] as number, ce: !!spec.ce, motion: p.loc.kind === 'offboard' });
}

export const vehiclesModule: RuleModule = {
  id: 'sk3.vehicles',
  ref: 'SK4 1.2.7, 3.3.2, 7.0, 7.7, 7.8',
  summary: 'Vehicle pieces: their machine guns come with them; setup gives them a Vehicle Covered Arc, a turret arc and CE/BU; offboard vehicles start in Motion.',
  requires: ['common.pieces', 'sk1.status', 'sk1.scenario', 'sk2.guns'],
  install(r) {
    // A vehicle arrives with its MGs (SK4 7.8).
    r.on<{ piece: Piece }>({
      id: 'sk3.vehicles.mgs',
      event: 'piece.created',
      handler(ctx, ev) {
        const v = ev.payload.piece;
        const d = vehicle(ctx, v);
        if (!d) return;
        const have = new Set(swHeldBy(ctx.state, v.id).map((w) => w.defId));
        for (const mg of vehicleMgDefs(d)) {
          if (have.has(mg.id) || !statics(ctx).counters[mg.id]) continue;
          const id: PieceId = `${v.id}.${mg.id.split('.').pop()}`;
          ctx.emit('piece.created', { piece: { id, defId: mg.id, side: v.side, loc: { kind: 'held', by: v.id }, tags: {} } });
        }
      },
    });

    // ------------------------------------------------------------ setup
    r.contribute({
      id: 'sk3.setup.defaults.vehicles',
      query: 'setup.defaults',
      apply(v, { side, todo, placements }, env) {
        const vehicles: Record<PieceId, { vca: number }> = {};
        for (const id of todo) {
          const hex = placements[id];
          if (!hex || !vehicle(env, pieceOf(env, id))) continue;
          vehicles[id] = { vca: defaultVca(env, hex, side) };
        }
        return Object.keys(vehicles).length ? { ...v, vehicles } : v;
      },
    });
    r.contribute({
      id: 'sk3.setup.illegal.vehicles',
      query: 'setup.illegal',
      apply: (v, { side, todo, action }, env) => v ?? vehicleSetupIllegal(env, side, todo, action as SetupAction),
    });
    r.procedure<SetupPlacedFn>(SETUP_PLACED, (next) => (ctx, action, decision: Decision) => {
      next?.(ctx, action, decision);
      for (const [id, spec] of Object.entries(action.vehicles ?? {}).sort()) placeVehicle(ctx, id, spec);
    });
    // Vehicles the card puts in fixed hexes are on the map before any setup decision: they face the
    // card's hexspine (or spine 0), as if set up by hand.
    r.setup({
      id: 'sk3.vehicles.fixed',
      priority: 10,
      run(ctx) {
        const forces = statics(ctx).scenario.forces;
        for (const p of Object.values(ctx.state.pieces).sort(byId)) {
          const f = forces[p.tags['force'] as number];
          if (p.loc.kind !== 'hex' || p.tags[T3.vca] !== undefined || f?.setup.kind !== 'hexes' || !vehicle(ctx, p)) continue;
          placeVehicle(ctx, p.id, { vca: f.setup.vca ?? 0, ...(f.setup.ce ? { ce: true } : {}) });
        }
      },
    });
    r.event<{ vehicle: PieceId; vca: number; tca: number; ce: boolean; motion: boolean }>({ type: 'sk3.vehicle.setup', apply() {} });
  },
};

/** The vehicles of a side in id order (helper for tests and the random driver). */
export const vehiclePieces = (env: QueryEnv, side?: string): Piece[] =>
  Object.values(env.state.pieces)
    .filter((p) => (side === undefined || p.side === side) && p.loc.kind !== 'eliminated' && vehicle(env, p))
    .sort(byId);
