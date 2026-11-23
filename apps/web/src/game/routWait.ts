import type { PieceId, QueryEnv } from '@asl/engine';
import { activeRout, activeRoutEnds, hexLabel, hexOfLoc, pieceLabel } from '@asl/rules';

/**
 * Why a broken unit may not start its rout yet: another unit's rout is under way, and routs are walked one at a time, each
 * to its end. Names the router, where it stands and the ROUT END hexes it must still reach (SK1 3.6: the nearest building or
 * woods hex), so a router left short of its shelter is not taken for one whose rout is over. Null when no other rout is under
 * way.
 */
export function routWaitHint(env: QueryEnv, unit: PieceId): string | null {
  const act = activeRout(env);
  const router = env.state.pieces[act?.unit ?? ''];
  if (!act || act.unit === unit || !router) return null;
  const who = [act.unit, ...act.escort].map((id) => pieceLabel(env, env.state.pieces[id])).join(' and ');
  const at = router.loc.kind === 'hex' ? router.loc.hex : null;
  const ends = activeRoutEnds(env);
  // Its own hex is not one to go on into (when it may end there, its wheel offers Stop here).
  const names = ends ? [...new Set([...ends].map((l) => hexOfLoc(l)).filter((h) => h !== at))].sort().map(hexLabel) : [];
  const where = names.length ? `it must go on into ${names.join(' or ')} (ROUT END)` : ends ? 'its rout must end first' : 'it must go on away from the enemy';
  return `The ${who}${at ? ` in ${hexLabel(at)}` : ''} is still routing: ${where} before another unit may rout`;
}
