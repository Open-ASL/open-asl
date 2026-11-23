import type { GameState, PieceId } from '@asl/engine';
import { locationAt } from '@asl/rules';
import type { SsVirtual, SsVirtualLoc } from '@asl/platform';

/**
 * The commentators' virtual board: the position at a step with pieces moved or taken off by hand. It is only ever drawn
 * and queried (LOS, shots, the danger map); it never reaches the engine as a move, so nothing in the game changes.
 * A held weapon goes with whoever holds it, as it does on a real map.
 */
export function applyVirtual(state: GameState, virtual: SsVirtual | null): GameState {
  if (!virtual || Object.keys(virtual.moves).length === 0) return state;
  const pieces = { ...state.pieces };
  for (const [id, to] of Object.entries(virtual.moves)) {
    const p = pieces[id];
    if (!p) continue;
    if (to === null) delete pieces[id];
    else pieces[id] = { ...p, loc: locationAt(to.hex) };
  }
  // A weapon held by a unit taken off goes with it.
  for (const p of Object.values(pieces)) if (p.loc.kind === 'held' && !pieces[p.loc.by]) delete pieces[p.id];
  return { ...state, pieces };
}

/** The virtual board with `ids` moved to `to` (null: off the board), started at step `base` if it was not already. */
export function withMoves(virtual: SsVirtual | null, base: number, ids: readonly PieceId[], to: SsVirtualLoc): SsVirtual {
  const moves = { ...(virtual?.moves ?? {}) };
  for (const id of ids) moves[id] = to;
  return { base: virtual?.base ?? base, moves };
}
