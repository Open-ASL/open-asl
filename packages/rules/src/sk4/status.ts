import type { Piece, QueryEnv, SideId } from '@asl/engine';
import type { LocId } from '../common/location';
import { unitsAt } from '../common/pieces';

/** Piece tags of the SK4 chapter 8 rules. Each is listed in `TAG_LIFECYCLE`. */
export const T4 = {
  /** Under a concealment counter (SK4 8.3): on the Infantry unit, and on the Gun it mans. Lasting. */
  concealed: 'concealed',
  /** A placed DC's targets were concealed when it was placed: its attack is Area Fire (8.3.2). Player Turn. */
  dcVsConcealed: 'dcVsConcealed',
  /** A HIP Emplaced Gun that fired this Player Turn: its "?" goes only on a colored dr of 5–6 (8.3.3). Player Turn. */
  hipFired: 'hipFired',
  /** Part of a Banzai Charge this Player Turn (SK4 8.1.8.6): 'charging' while it still moves, 'done' after. Player Turn. */
  banzai: 'banzai',
} as const;

export const isConcealed = (p: Piece) => p.tags[T4.concealed] === true;

/** The concealed pieces of `side` in a Location (units and the Guns they man). */
export const concealedAt = (env: QueryEnv, loc: LocId, side: SideId): Piece[] => unitsAt(env, loc, side).filter(isConcealed);
