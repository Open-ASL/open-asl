import type { GameState, HexId, Location, Piece, QueryEnv } from '@asl/engine';
import type { Statics } from './statics';

const mapOf = (env: QueryEnv) => (env.statics as Statics).map;

/**
 * Locations (ASLRB A2.8). A hex has one Location at ground level; only upper building levels,
 * pillboxes, rooftops, bridges, sewers, tunnels and caves add more. A Location is a string id: the
 * ground Location is the plain hex id, so the Starter Kit (which always plays at ground level) keeps
 * its data and recordings byte for byte. The others add a suffix: 'uK4:1' is level 1 of uK4, 'uK4:pb'
 * its pillbox, 'uK4:roof' its rooftop. ':' never occurs in a hex id.
 *
 * Foxholes, trenches and Bypass are positions within a Location (B27.13, A4.32), not Locations, so they
 * never appear in a LocId. Design: `packages/rules/docs/location-model.md`.
 */
export type LocId = string;
/** Locations that are not a building level (a cave: ASLRB G11, S70 SSR 2). */
export type SubLoc = 'pb' | 'roof' | 'bridge' | 'cave';

declare module '@asl/engine' {
  interface QueryCatalog {
    /**
     * The Locations of a hex, ground level first. The Starter Kit plays at ground level only: one Location
     * per hex, whatever the map data says. The full ASL module adds the upper levels (`asl/locations.ts`).
     */
    'hex.locations': { ctx: { hex: HexId }; value: LocId[] };
    /**
     * The Locations adjacent to a Location (ASLRB A.8, B23.25). The Starter Kit default is the ground
     * Location of every neighbouring hex, in the map's neighbour order.
     */
    'loc.adjacent': { ctx: { loc: LocId }; value: LocId[] };
    /**
     * A Location's height for LOS and Height Advantage, in levels: its hex's elevation plus its building level by default
     * (`heightOf`); a cave "treated as being at ground level for LOS purposes" (S70 SSR 2) answers 0.
     */
    'loc.height': { ctx: { loc: LocId }; value: number };
  }
}

/** The Location id of a hex's level (0: ground) or sub-Location. Ground level is the hex id itself. */
export const locId = (hex: HexId, level = 0, sub?: SubLoc): LocId => (sub ? `${hex}:${sub}` : level ? `${hex}:${level}` : hex);

/** The parts of a Location id. A sub-Location (pillbox, rooftop, bridge) counts as ground level here. */
export function parseLoc(id: LocId): { hex: HexId; level: number; sub?: SubLoc } {
  const i = id.indexOf(':');
  if (i < 0) return { hex: id, level: 0 };
  const hex = id.slice(0, i);
  const rest = id.slice(i + 1);
  const n = Number(rest);
  return Number.isInteger(n) ? { hex, level: n } : { hex, level: 0, sub: rest as SubLoc };
}

/** The hex a Location is in. */
export const hexOfLoc = (id: LocId): HexId => {
  const i = id.indexOf(':');
  return i < 0 ? id : id.slice(0, i);
};
export const levelOfLoc = (id: LocId) => parseLoc(id).level;
/** The ground Location of its hex (the only Location a Starter Kit hex has). */
export const isGroundLoc = (id: LocId) => !id.includes(':');

/** The Location id of an on-map `Location` (no allocation at ground level). */
export const locKey = (l: Location & { kind: 'hex' }): LocId => (l.sub ? `${l.hex}:${l.sub}` : l.level ? `${l.hex}:${l.level}` : l.hex);

/** Whether a piece stands directly in Location `loc` (not held; ground level when `loc` is a hex id). */
export const isAt = (p: Piece, loc: LocId): boolean =>
  p.loc.kind === 'hex' && (isGroundLoc(loc) ? p.loc.hex === loc && !p.loc.level && !p.loc.sub : locKey(p.loc) === loc);

/** The piece `Location` for a Location id: `{ kind: 'hex', hex }` at ground level, never `level: 0`. */
export function locationAt(id: LocId): Location & { kind: 'hex' } {
  if (isGroundLoc(id)) return { kind: 'hex', hex: id };
  const { hex, level, sub } = parseLoc(id);
  return sub ? { kind: 'hex', hex, sub } : { kind: 'hex', hex, level };
}

/** The Location a piece is in; like `hexOf`, a held SW is where its holder is. Null off the map. */
export const locOf = (state: GameState, p: Piece): LocId | null => {
  if (p.loc.kind === 'hex') return locKey(p.loc);
  if (p.loc.kind === 'held') {
    const holder = state.pieces[p.loc.by];
    return holder ? locOf(state, holder) : null;
  }
  return null;
};

/** The Locations of a hex (`'hex.locations'`): just the hex in the Starter Kit. */
export const locationsOf = (env: QueryEnv, hex: HexId): LocId[] => env.query('hex.locations', { hex }, [hex]);

/** Whether a Location exists on the map: an on-map hex, and one of its Locations. */
export const locExists = (env: QueryEnv, id: LocId): boolean => {
  const hex = hexOfLoc(id);
  if (!mapOf(env).hex(hex)) return false;
  return isGroundLoc(id) || locationsOf(env, hex).includes(id);
};

/** MF to go up or down one level in a stairwell hex, printed or inherent (ASLRB B23.4). Full ASL only. */
export const LEVEL_CHANGE_MF = 1;

/** The Locations adjacent to a Location (`'loc.adjacent'`): the neighbouring hexes in the Starter Kit. */
export const adjacentLocs = (env: QueryEnv, loc: LocId): LocId[] =>
  env.query('loc.adjacent', { loc }, mapOf(env).neighbors(hexOfLoc(loc)));
