import type { GameState, QueryEnv, SideId } from '@asl/engine';
import { isVisibleTo } from '@asl/rules';

export { visibleState } from '@asl/rules';

/** Whether `viewer` may see a piece right now. */
export const canSee = (env: QueryEnv, state: GameState, id: string, viewer: SideId | null): boolean => {
  const p = state.pieces[id];
  return !p || isVisibleTo(env, p, viewer);
};
