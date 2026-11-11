import type { HexId, Piece, PieceId, QueryEnv } from '@asl/engine';
import { defOf, hexOf, isVehicleDef, swHeldBy } from '../common/pieces';
import type { SwDef, VehicleDef } from '../common/statics';
import { pieceOf } from '../sk1/status';
import { T2 } from '../sk2/status';

/**
 * Tag keys of the SK3 vehicle rules (on vehicle pieces). The Main Armament's Covered Arc is SK2's
 * `ca` tag (the Turret Covered Arc of a turreted vehicle, the VCA of a non-turreted one), so the
 * ordnance code's arc handling applies to a vehicle unchanged; `vca` is the hull's arc.
 */
export const T3 = {
  /** Vehicle Covered Arc: the hexspine the front of the vehicle points at, 0–5 (SK4 3.2.4). */
  vca: 'vca',
  /** Crew Exposed (SK4 7.7); absent = Buttoned Up. */
  ce: 'ce',
  /** In Motion (SK4 3.3.2): ended its MPh moving, or made a Motion Status attempt. */
  motion: 'motion',
  /** Entered a new hex, or began or ended its MPh in Motion, this Player Turn: a moving target (3.3.2). */
  movingTarget: 'movingTarget',
  /** Bogged or Mired (SK4 7.6). */
  bog: 'bog',
  /** Immobilized (SK4 7.10): never moves again. */
  immob: 'immob',
  /** Dug in at setup by SSR (S28 SSR 3): never leaves its hex or changes its VCA. */
  dugIn: 'dugIn',
  /** Shocked, or under an Unconfirmed Kill counter (SK4 7.10). */
  shock: 'shock',
  /** Stunned this Player Turn ('fresh'), or carrying the +1 Stun counter for the rest of the game ('plus1'). */
  stun: 'stun',
  /** Recalled (SK4 7.10): must leave the map by the shortest route. */
  recall: 'recall',
  /** A wreck (SK4 7.4): the counter stays on the map flipped. */
  wreck: 'wreck',
  /** The phase in which the crew last went CE or BU voluntarily (once per phase, 7.7). */
  ceChanged: 'ceChanged',
  /** Used its smoke dispenser this Player Turn (7.5). */
  smokeUsed: 'smokeUsed',
  /** Main Armament permanently disabled (7.2). SK1's `malf` tag on the vehicle is a malfunctioned MA. */
  maDisabled: 'maDisabled',
  /** Low Ammo (7.2.1): the MA's B# is one less than the circled number and a further B# result disables it. */
  lowAmmo: 'lowAmmo',
  /** Fired Bounding First Fire this MPh (3.3.2.2): no Advancing Fire unless only the MA fired and kept ROF. */
  bff: 'bff',
  /** A vehicular MG piece: permanently disabled (7.8). */
  mgDisabled: 'mgDisabled',
  /** Stalled on a Mechanical Reliability DR of 11 (Russian Vehicle Note M) this MPh. */
  stalled: 'stalled',
  /** The MP trail of its last move this Player Turn (JSON), for "MP spent in the firer's LOS" after the move (case 24). */
  mpTrail: 'mpTrail',
  /** Fired Bounding First Fire with only the MA and kept ROF: one more shot in the AFPh (SK4 3.5). */
  bffRof: 'bffRof',
} as const;

export const vehicle = (env: QueryEnv, p: Piece): VehicleDef | null => {
  const d = defOf(env, p);
  return isVehicleDef(d) ? d : null;
};
export const vehicleById = (env: QueryEnv, id: PieceId): Piece => {
  const p = pieceOf(env, id);
  if (!vehicle(env, p)) throw new Error(`${id} is not a vehicle`);
  return p;
};

export const isWreck = (p: Piece) => p.tags[T3.wreck] === true;
export const isCe = (p: Piece) => p.tags[T3.ce] === true;
export const inMotion = (p: Piece) => p.tags[T3.motion] === true;
export const isMovingTarget = (p: Piece) => p.tags[T3.movingTarget] === true;
export const isImmobile = (p: Piece) => p.tags[T3.immob] === true || p.tags[T3.bog] !== undefined || isWreck(p);
export const isBogged = (p: Piece) => p.tags[T3.bog] !== undefined;
export const isShocked = (p: Piece) => p.tags[T3.shock] !== undefined;
export const isStunned = (p: Piece) => p.tags[T3.stun] === 'fresh';
export const hasStunPlus1 = (p: Piece) => p.tags[T3.stun] === 'plus1';
export const isRecalled = (p: Piece) => p.tags[T3.recall] === true;
/** The hull's Covered Arc (hexspine 0–5). */
export const vcaOf = (p: Piece): number => (p.tags[T3.vca] as number | undefined) ?? 0;
/** The turret's Covered Arc: SK2's `ca` tag for a turreted vehicle, the VCA otherwise. */
export const tcaOf = (env: QueryEnv, p: Piece): number => (vehicle(env, p)?.turret === 'NT' ? vcaOf(p) : ((p.tags[T2.ca] as number | undefined) ?? vcaOf(p)));
/** A vehicle whose crew can act: not a wreck, not Shocked, not Stunned this turn. */
export const crewCanAct = (p: Piece) => !isWreck(p) && !isShocked(p) && !isStunned(p);
/** Mobile (SK4 2.0): a Good Order vehicle neither Immobilized, Bogged, Shocked nor Stunned. */
export const isMobile = (p: Piece) => !isImmobile(p) && crewCanAct(p);

/** Every vehicle piece of a side on the map (wrecks included unless `mobileOnly`). */
export const vehiclesOf = (env: QueryEnv, side?: string, mobileOnly = false): Piece[] =>
  Object.values(env.state.pieces)
    .filter((p) => (side === undefined || p.side === side) && p.loc.kind !== 'eliminated' && vehicle(env, p) && (!mobileOnly || !isWreck(p)))
    .sort((a, b) => (a.id < b.id ? -1 : 1));

/** The vehicle a piece is part of (a vehicular MG's holder), or the piece itself. */
export const vehicleOfPart = (env: QueryEnv, p: Piece): Piece | null => {
  if (vehicle(env, p)) return p;
  if (p.loc.kind === 'held') {
    const h = env.state.pieces[p.loc.by];
    return h && vehicle(env, h) ? h : null;
  }
  return null;
};

export type VehicleMgKind = 'bmg' | 'cmg' | 'aamg' | 'rmg';
const MG_TYPE: Record<VehicleMgKind, SwDef['type']> = { bmg: 'BMG', cmg: 'CMG', aamg: 'AAMG', rmg: 'RMG' };

/** A vehicle's MG pieces by kind (SK4 7.8), those it still has. */
export function vehicleMgs(env: QueryEnv, v: PieceId): Partial<Record<VehicleMgKind, Piece>> {
  const out: Partial<Record<VehicleMgKind, Piece>> = {};
  for (const w of swHeldBy(env.state, v)) {
    const d = defOf(env, w);
    if (d.kind !== 'sw' || !d.fixed) continue;
    for (const k of Object.keys(MG_TYPE) as VehicleMgKind[]) if (MG_TYPE[k] === d.type) out[k] = w;
  }
  return out;
}

/** The def id of a vehicle's MG piece (generated by the content package from the vehicle's `mg`). */
export const vehicleMgDefId = (vehicleDefId: string, kind: VehicleMgKind) => `${vehicleDefId}.${kind}`;

/** The hex a vehicle (or a part of one) is in. */
export const vehicleHex = (env: QueryEnv, p: Piece): HexId | null => hexOf(env.state, p);
