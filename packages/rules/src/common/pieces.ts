import type {
  GameState,
  HexId,
  Location,
  Piece,
  PieceId,
  QueryEnv,
  RuleModule,
  Scalar,
  SideId,
} from '@asl/engine';
import type { CounterDef, GunDef, MmcDef, SmcDef, Statics, SwDef, VehicleDef } from './statics';
import { isAt, locKey, locationAt, type LocId } from './location';

export const statics = (env: { statics: unknown }) => env.statics as Statics;

export function defOf(env: { statics: unknown }, piece: Piece): CounterDef {
  const d = statics(env).counters[piece.defId];
  if (!d) throw new Error(`Unknown counter def "${piece.defId}"`);
  return d;
}

/** Infantry (MMC and SMC); never a weapon or a vehicle. */
export const isPersonnelDef = (d: CounterDef): d is MmcDef | SmcDef => d.kind === 'squad' || d.kind === 'hs' || d.kind === 'crew' || d.kind === 'leader';
export const isVehicleDef = (d: CounterDef): d is VehicleDef => d.kind === 'vehicle';
export const isMmcDef = (d: CounterDef): d is MmcDef => d.kind === 'squad' || d.kind === 'hs' || d.kind === 'crew';
export const isSmcDef = (d: CounterDef): d is SmcDef => d.kind === 'leader';
export const isSwDef = (d: CounterDef): d is SwDef => d.kind === 'sw';
export const isGunDef = (d: CounterDef): d is GunDef => d.kind === 'gun';
/** Weapons (SK4 4.0): SW and Guns alike are possessed, transferred, recovered and destroyed the same way. */
export const isWeaponDef = (d: CounterDef): d is SwDef | GunDef => d.kind === 'sw' || d.kind === 'gun';
/** A vehicular MG (SK4 7.8): part of its vehicle, so never dropped, transferred or destroyed on its own. */
export const isFixedWeapon = (env: QueryEnv, p: Piece): boolean => {
  const d = defOf(env, p);
  return d.kind === 'sw' && !!d.fixed;
};

export const hexOf = (state: GameState, p: Piece): HexId | null => {
  if (p.loc.kind === 'hex') return p.loc.hex;
  if (p.loc.kind === 'held') {
    const holder = state.pieces[p.loc.by];
    return holder ? hexOf(state, holder) : null;
  }
  return null;
};

export const isOnMap = (p: Piece) => p.loc.kind === 'hex';
export const isAlive = (p: Piece) => p.loc.kind !== 'eliminated';

/*
 * Occupants of a Location (ASLRB A2.8). At ground level a Location id is the hex id, so in the Starter Kit
 * (always at ground level) these are the occupants of the hex. The `…InHex` variants take every Location
 * of a hex, for the rules that speak of the hex as a whole (one vehicle per hex, Hex Control).
 */
const inHex = (p: Piece, hex: HexId) => p.loc.kind === 'hex' && p.loc.hex === hex;

function personnelWhere(env: QueryEnv, where: (p: Piece) => boolean, side?: SideId): Piece[] {
  return Object.values(env.state.pieces).filter((p) => where(p) && (side === undefined || p.side === side) && isPersonnelDef(defOf(env, p)));
}
function vehiclesWhere(env: QueryEnv, where: (p: Piece) => boolean, side?: SideId, mobileOnly = false): Piece[] {
  return Object.values(env.state.pieces).filter(
    (p) => where(p) && (side === undefined || p.side === side) && isVehicleDef(defOf(env, p)) && (!mobileOnly || p.tags['wreck'] !== true),
  );
}

/** All personnel (MMC/SMC) directly in a Location. */
export const personnelAt = (env: QueryEnv, loc: LocId, side?: SideId): Piece[] => personnelWhere(env, (p) => isAt(p, loc), side);
/** All personnel in every Location of a hex. */
export const personnelInHex = (env: QueryEnv, hex: HexId, side?: SideId): Piece[] => personnelWhere(env, (p) => inHex(p, hex), side);

/** Vehicles directly in a Location (wrecks included unless `mobileOnly`). */
export const vehiclesAt = (env: QueryEnv, loc: LocId, side?: SideId, mobileOnly = false): Piece[] => vehiclesWhere(env, (p) => isAt(p, loc), side, mobileOnly);
/** Vehicles anywhere in a hex. */
export const vehiclesInHex = (env: QueryEnv, hex: HexId, side?: SideId, mobileOnly = false): Piece[] => vehiclesWhere(env, (p) => inHex(p, hex), side, mobileOnly);

/** Personnel and non-wreck vehicles in a Location: the units a side has there. */
export function unitsAt(env: QueryEnv, loc: LocId, side?: SideId): Piece[] {
  return [...personnelAt(env, loc, side), ...vehiclesAt(env, loc, side, true)];
}
/** Personnel and non-wreck vehicles in every Location of a hex. */
export function unitsInHex(env: QueryEnv, hex: HexId, side?: SideId): Piece[] {
  return [...personnelInHex(env, hex, side), ...vehiclesInHex(env, hex, side, true)];
}

/** Weapons (SW and Guns) lying unpossessed in a Location. */
export function unpossessedWeaponsAt(env: QueryEnv, loc: LocId): Piece[] {
  return Object.values(env.state.pieces).filter((p) => isAt(p, loc) && isWeaponDef(defOf(env, p)));
}
/** Weapons lying unpossessed in every Location of a hex. */
export function unpossessedWeaponsInHex(env: QueryEnv, hex: HexId): Piece[] {
  return Object.values(env.state.pieces).filter((p) => inHex(p, hex) && isWeaponDef(defOf(env, p)));
}
/** @deprecated Use `unpossessedWeaponsAt` (it has always meant every weapon lying in the hex). */
export const unpossessedSwAt = unpossessedWeaponsAt;

export function swHeldBy(state: GameState, holder: PieceId): Piece[] {
  return Object.values(state.pieces).filter((p) => p.loc.kind === 'held' && p.loc.by === holder);
}

export function personnelOf(env: QueryEnv, side: SideId): Piece[] {
  return Object.values(env.state.pieces).filter(
    (p) => p.side === side && isAlive(p) && isPersonnelDef(defOf(env, p)),
  );
}

export const otherSide = (state: GameState, side: SideId) => state.sides.find((s) => s !== side)!;

export const tag = <T extends Scalar>(p: Piece, key: string): T | undefined =>
  p.tags[key] as T | undefined;

/** Stable piece ordering for deterministic iteration. */
export const byId = (a: Piece, b: Piece) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export interface PieceEvents {
  'piece.created': { piece: Piece };
  'piece.moved': { id: PieceId; loc: Location };
  /** null removes a tag. */
  'piece.tagged': { id: PieceId; tags: Record<string, Scalar> };
  /** Swap the counter (Casualty Reduction, ELR replacement, flips that change stats). `from` is the counter it was. */
  /** `reason`: 'elr' for an ELR replacement (SK1 5.1), 'cr' for Casualty Reduction. */
  'piece.replaced': { id: PieceId; defId: string; from?: string; reason?: 'elr' | 'cr' | 'commissar' | 'ssr' | 'deploy' | 'step' | 'rally' | 'recombine' };
  'piece.eliminated': { id: PieceId; reason: string };
  /** null removes the marker. */
  'hex.marker': { hex: HexId; key: string; value: Scalar };
}

/** Generic piece/marker events shared by every ruleset. */
export const piecesModule: RuleModule = {
  id: 'common.pieces',
  install(r) {
    r.event<PieceEvents['piece.created']>({
      type: 'piece.created',
      apply(d, p) {
        d.pieces[p.piece.id] = p.piece;
      },
    });
    r.event<PieceEvents['piece.moved']>({
      type: 'piece.moved',
      apply(d, p) {
        d.pieces[p.id]!.loc = p.loc;
      },
    });
    r.event<PieceEvents['piece.tagged']>({
      type: 'piece.tagged',
      apply(d, p) {
        const piece = d.pieces[p.id]!;
        for (const [k, v] of Object.entries(p.tags)) {
          if (v === null) delete piece.tags[k];
          else piece.tags[k] = v;
        }
      },
    });
    r.event<PieceEvents['piece.replaced']>({
      type: 'piece.replaced',
      apply(d, p) {
        d.pieces[p.id]!.defId = p.defId;
      },
    });
    r.event<PieceEvents['piece.eliminated']>({
      type: 'piece.eliminated',
      apply(d, p) {
        const piece = d.pieces[p.id]!;
        // Keep where it died so possessed SW can be left in that Location (its LocId: the hex id at ground level).
        piece.tags = piece.loc.kind === 'hex' ? { lastHex: locKey(piece.loc) } : {};
        piece.loc = { kind: 'eliminated' };
      },
    });
    r.event<PieceEvents['hex.marker']>({
      type: 'hex.marker',
      apply(d, p) {
        const markers = (d.hexMarkers[p.hex] ??= {});
        if (p.value === null) delete markers[p.key];
        else markers[p.key] = p.value;
        if (Object.keys(markers).length === 0) delete d.hexMarkers[p.hex];
      },
    });
    // Dropped SW stay in the location of a unit that was eliminated (SK1 4.0).
    r.on<PieceEvents['piece.eliminated']>({
      id: 'common.pieces.drop-sw-on-elimination',
      event: 'piece.eliminated',
      handler(ctx, ev) {
        for (const sw of swHeldBy(ctx.state, ev.payload.id).sort(byId)) {
          const loc = lastLocOf(ctx.state, ev.payload.id);
          ctx.emit('piece.moved', {
            id: sw.id,
            loc: loc ? locationAt(loc) : { kind: 'eliminated' },
          });
        }
      },
    });
  },
};

/** The Location a unit was eliminated in (the `lastHex` tag holds its LocId). */
function lastLocOf(state: GameState, id: PieceId): LocId | null {
  const p = state.pieces[id];
  if (!p) return null;
  return (p.tags['lastHex'] as LocId | undefined) ?? null;
}
