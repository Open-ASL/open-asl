import type { MatchDoc, MatchEnded } from '@asl/platform';

/**
 * The fields an online match under way takes when it ends without a result: no winner, no rating change, nothing on the
 * battle record and no report (`official: false`), the clock stopped, and who ended it and how (`ended`), so the other
 * player's screen can say why the match is over instead of only "Abandoned".
 */
export function abandonedPatch<T>(match: Pick<MatchDoc, 'summary'>, ended: MatchEnded, at: T) {
  return { status: 'abandoned' as const, official: false, result: null, ended, summary: { ...match.summary, toMove: null }, deadline: null, updatedAt: at, completedAt: at };
}
