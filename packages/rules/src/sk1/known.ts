import { seedRng, type Engine, type GameState, type HexId, type Piece, type PieceId, type QueryEnv, type SideId } from '@asl/engine';
import { defOf, hexOf, isVehicleDef, otherSide, statics, unitsAt } from '../common/pieces';
import { isBroken, mmc, smc } from './status';
import { adjacentLocs, isGroundLoc, locOf, type LocId } from '../common/location';

declare module '@asl/engine' {
  interface QueryCatalog {
    /**
     * Whether a piece is known to `viewer` (a side, or null for a shared screen / spectator):
     * everything is, except what hides under Hidden Initial Placement (SK2) from the other side.
     */
    'piece.visibleTo': { ctx: { piece: PieceId; viewer: SideId | null }; value: boolean };
    /**
     * What `viewer` sees in place of a piece hidden from them, if anything: a redacted view (`redactState`) puts
     * the returned piece on the board instead (a "?" counter over a concealed stack, SK4 8.3). Stand-ins of one
     * stack share an id, so the stack collapses to one counter. Null (the default) leaves nothing behind (HIP).
     */
    'piece.standIn': { ctx: { piece: PieceId; viewer: SideId | null }; value: Piece | null };
    /**
     * Whether a piece is a *Known* unit to `viewer` (SK4 glossary KEU: "any unconcealed enemy unit to which the friendly
     * unit has LOS"): visible, and not under a "?" (SK4 8.3). Hidden pieces are neither visible nor known; a concealed
     * stack is visible (its "?" is on the board, it may be fired at) but not known (no DM, no Interdiction, no rout
     * direction, no Infantry Target Type). Default: visibility.
     */
    'piece.knownTo': { ctx: { piece: PieceId; viewer: SideId | null }; value: boolean };
  }
}

/** Whether `viewer` *knows* a piece: visible and unconcealed (`piece.knownTo`). */
export const isKnownTo = (env: QueryEnv, piece: Piece, viewer: SideId | null): boolean =>
  env.query('piece.knownTo', { piece: piece.id, viewer }, isVisibleTo(env, piece, viewer));

/** Known Enemy Units of `side` on the map: personnel and non-wreck vehicles it can see and that are not concealed. */
export function knownEnemyUnits(env: QueryEnv, side: SideId): Piece[] {
  return enemyUnits(env, side).filter((p) => isKnownTo(env, p, side));
}

/** Known enemy units of `side` in a Location. */
export const knownEnemyAt = (env: QueryEnv, hex: LocId, side: SideId): Piece[] => visibleEnemyAt(env, hex, side).filter((p) => isKnownTo(env, p, side));

/** Whether `viewer` knows of a piece (SK1 has no concealment: only SK2's HIP hides anything). */
export const isVisibleTo = (env: QueryEnv, piece: Piece, viewer: SideId | null): boolean =>
  env.query('piece.visibleTo', { piece: piece.id, viewer }, true);

/** Enemy personnel on the map that `side` knows of (hidden Guns and crews are not Known Enemy Units). */
/** Enemy units on the map the side can see: personnel and non-wreck vehicles (both are Known Enemy Units, SK4 glossary). */
export function enemyUnits(env: QueryEnv, side: SideId): Piece[] {
  const enemy = otherSide(env.state, side);
  return Object.values(env.state.pieces).filter(
    (p) => p.side === enemy && p.loc.kind === 'hex' && (mmc(env, p) || smc(env, p) || (isVehicleDef(defOf(env, p)) && p.tags['wreck'] !== true)) && isVisibleTo(env, p, side),
  );
}

export function enemyPersonnel(env: QueryEnv, side: SideId): Piece[] {
  const enemy = otherSide(env.state, side);
  return Object.values(env.state.pieces).filter(
    (p) => p.side === enemy && p.loc.kind === 'hex' && (mmc(env, p) || smc(env, p)) && isVisibleTo(env, p, side),
  );
}

/** Enemy units (personnel and vehicles that are not wrecks) in a Location (a hex id at ground level) that `side` knows of. */
export const visibleEnemyAt = (env: QueryEnv, hex: LocId, side: SideId): Piece[] =>
  unitsAt(env, hex, otherSide(env.state, side)).filter((p) => isVisibleTo(env, p, side));

/** LOS between two Locations (hex ids at ground level), Smoke and other counters included; a Location sees itself. */
export const hasLos = (env: QueryEnv, from: LocId, to: LocId) =>
  from === to || env.query('los.trace', { from, to }, { clear: true, hindrance: 0, parts: [] }).clear;

/**
 * Known Enemy Units for a friendly unit in Location `hex` (a hex id at ground level): enemy units to which it has LOS.
 * (SK1 has no concealment, so every enemy in LOS is known.)
 */
export function knownEnemiesFrom(env: QueryEnv, side: SideId, hex: LocId, opts: { unbrokenOnly?: boolean } = {}): Piece[] {
  return enemyPersonnel(env, side).filter((e) => {
    if (opts.unbrokenOnly && isBroken(e)) return false;
    if (!isKnownTo(env, e, side)) return false;
    return hasLos(env, hex, locOf(env.state, e)!);
  });
}

/** A Known enemy in the same or an ADJACENT Location (ASLRB A.8; in the Starter Kit, the same or a neighbouring hex). */
export function adjacentToKnownEnemy(env: QueryEnv, side: SideId, hex: LocId, opts: { unbrokenOnly?: boolean } = {}): boolean {
  const map = statics(env).map;
  let near: LocId[] | undefined;
  return knownEnemiesFrom(env, side, hex, opts).some((e) => {
    const eh = locOf(env.state, e)!;
    if (eh === hex) return true;
    // Between ground Locations, the neighbouring hexes; otherwise the 'loc.adjacent' answer.
    if (isGroundLoc(eh) && isGroundLoc(hex)) return map.distance(eh, hex) === 1;
    return (near ??= adjacentLocs(env, hex)).includes(eh);
  });
}

export const unitHex = (env: QueryEnv, id: PieceId) => hexOf(env.state, env.state.pieces[id]!);

/**
 * The state as `viewer` may see it: pieces hidden from them (SK2 Hidden Initial Placement) are
 * left out, so the board, stack cards and log built from it cannot show them. A null viewer
 * (a spectator) sees only what has been revealed. The hotseat screen filters with this; the full
 * view (stand-ins, secret `ext` slices, decisions) is `redactState`, which the online server and
 * the computer opponent use. Online, a seat only ever receives its own redacted view.
 */
export function visibleState(env: QueryEnv, state: GameState, viewer: SideId | null): GameState {
  const hidden = hiddenFrom(env, state, viewer);
  if (hidden.size === 0) return state;
  const pieces: Record<string, Piece> = { ...state.pieces };
  for (const id of hidden) delete pieces[id];
  return { ...state, pieces };
}

/**
 * The pieces `viewer` may not see: those `piece.visibleTo` denies, and whatever they hold (a hidden crew's Gun, a
 * waiting reinforcement's LMG, a hidden vehicle's MGs), since a weapon's `loc.by` would name its hidden holder.
 */
export function hiddenFrom(env: QueryEnv, state: GameState, viewer: SideId | null): Set<PieceId> {
  const hidden = new Set<PieceId>();
  for (const p of Object.values(state.pieces)) if (!isVisibleTo(env, p, viewer)) hidden.add(p.id);
  if (hidden.size === 0) return hidden;
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of Object.values(state.pieces)) {
      if (!hidden.has(p.id) && p.loc.kind === 'held' && hidden.has(p.loc.by)) {
        hidden.add(p.id);
        grew = true;
      }
    }
  }
  return hidden;
}

/** The generator state every redacted view carries: a viewer never rolls, and must not learn the real one. */
export const VIEW_RNG = seedRng('view');

/**
 * The state as `viewer` (a side, or null for a spectator) may see it, in full: `visibleState` plus
 * - a stand-in where a hidden piece offers one (`piece.standIn`: the "?" over a concealed stack);
 * - each module's secret `ext` slice as its redactor shows it (`RuleBuilder.redact`);
 * - pending decisions with hidden pieces taken out of their `data` (`redactDecision`);
 * - a fixed dice generator state.
 * The online server builds each viewer's snapshot with it (`Engine.redactTransition` pairs the events with it),
 * the computer opponent plays from it, and a hotseat screen may show it. It is a pure
 * function of the state, so a redacted snapshot never depends on how the position was reached.
 */
export function redactState(engine: Engine, state: GameState, viewer: SideId | null): GameState {
  const env = engine.env(state);
  const hidden = hiddenFrom(env, state, viewer);
  const pieces: Record<string, Piece> = {};
  for (const p of Object.values(state.pieces)) {
    if (!hidden.has(p.id)) pieces[p.id] = p;
    else {
      const standIn = env.query('piece.standIn', { piece: p.id, viewer }, null);
      if (standIn) pieces[standIn.id] = standIn;
    }
  }
  let ext: Record<string, unknown> = { ...state.ext };
  let decisions = state.decisions;
  for (const r of engine.ruleset.redactors) {
    if (r.ext && r.redactExt && ext[r.ext] !== undefined) ext[r.ext] = r.redactExt(ext[r.ext], viewer, env);
    if (r.redactDecision) decisions = decisions.map((d) => r.redactDecision!(d, viewer, env));
  }
  if (hidden.size > 0) {
    // Last line of defence: a piece id names its counter (`ge.3.0.ge.467.1`), so no hidden id may survive anywhere
    // the viewer can read, whatever slice a module keeps it in (a vehicle's LOS-at-start record, a moving stack's
    // unit list, a leader's `stackedOn`). Modules that want the viewer to see *something* instead (a stand-in id)
    // register a redactor, which runs first.
    ext = scrubIds(ext, hidden) as Record<string, unknown>;
    decisions = decisions.map((d) => (d.data ? { ...d, data: scrubIds(d.data, hidden) as Record<string, unknown> } : d));
    for (const [id, p] of Object.entries(pieces)) {
      if (Object.values(p.tags).some((v) => typeof v === 'string' && hidden.has(v))) pieces[id] = { ...p, tags: scrubIds(p.tags, hidden) as Piece['tags'] };
    }
  }
  return { ...state, pieces, ext, decisions, rng: VIEW_RNG, hexMarkers: hidden.size > 0 ? (scrubIds(state.hexMarkers, hidden) as GameState['hexMarkers']) : state.hexMarkers };
}

/** `value` without any mention of the ids: keys and string values equal to one are dropped, array elements too. */
function scrubIds(value: unknown, ids: Set<string>): unknown {
  if (typeof value === 'string') return ids.has(value) ? undefined : value;
  if (Array.isArray(value)) {
    let changed = false;
    const out: unknown[] = [];
    for (const v of value) {
      const r = scrubIds(v, ids);
      if (r !== v) changed = true;
      if (r !== undefined || (v === undefined)) out.push(r);
    }
    return changed ? out : value;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (ids.has(k)) {
        changed = true;
        continue;
      }
      const r = scrubIds(v, ids);
      if (r !== v) changed = true;
      if (r !== undefined) out[k] = r;
    }
    return changed ? out : value;
  }
  return value;
}
