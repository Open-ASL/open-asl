import type { HexId, PieceId, QueryEnv } from '@asl/engine';

/**
 * The Guns being set up that set up hidden (SK4 6.4): each placed Gun that may use HIP where it stands, unless the
 * player chose to set it up in the open. Hidden is the default, as in the default placement: a Gun set up in the open
 * is seen by the enemy from the start of the game.
 */
export function setupHip(env: QueryEnv, guns: PieceId[], hexes: Record<PieceId, HexId>, open: ReadonlySet<PieceId>): Set<PieceId> {
  return new Set(guns.filter((g) => !open.has(g) && !!hexes[g] && env.query('hip.allowed', { gun: g, hex: hexes[g]! }, false)));
}
