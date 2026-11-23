import type { GameState, QueryEnv, SideId } from '@asl/engine';
import { isVisibleTo } from '@asl/rules';

export { visibleState } from '@asl/rules';

/** Whether `viewer` may see a piece right now. */
export const canSee = (env: QueryEnv, state: GameState, id: string, viewer: SideId | null): boolean => {
  const p = state.pieces[id];
  return !p || isVisibleTo(env, p, viewer);
};

/**
 * Who a game screen shows the game to: a commentator's choice (`seeAs`), else the seat's side online or against the
 * computer, else (hotseat, both sides at one screen) whoever is deciding, so a player sees their own hidden units
 * while the other does not. 'all' is the whole game, hidden units included: a commentator's full view, and a hotseat
 * game once it is over: nothing is left to keep from either player, and the result was judged on what is really
 * there (a HIP Gun, SK4 6.4, may decide the victory conditions).
 */
export function screenViewer(session: { mySide?: SideId | null; seeAs?: SideId | null | 'all' }, owner: SideId | undefined, over: boolean): SideId | null | 'all' {
  if (session.seeAs !== undefined) return session.seeAs;
  if (session.mySide !== undefined) return session.mySide;
  if (over) return 'all';
  return owner ?? null;
}
