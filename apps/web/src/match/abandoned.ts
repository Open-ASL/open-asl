import type { MatchDoc } from '@asl/platform';

/**
 * Why an online match ended without a result, for the players and spectators of its page. A concession or a win claimed
 * on a lapsed clock before half the scenario's player turns does not count (`reachedOfficialProgress`): no winner, no
 * rating change, nothing on the battle record and no after action report, which a player who stayed would otherwise take
 * for a lost game.
 */
export function abandonedText(match: Pick<MatchDoc, 'status' | 'ended' | 'seats'>, viewer: string | null): string {
  const ended = match.ended;
  if (match.status !== 'abandoned' || !ended) return 'Abandoned.';
  const name = Object.values(match.seats).find((s) => s?.uid === ended.by)?.displayName ?? 'A player';
  const who = ended.by === viewer ? 'You' : name;
  if (ended.reason === 'ruleset') return `${who} closed the match: its recording no longer plays under the current rules. It has no result.`;
  const what = ended.reason === 'concession' ? `${who} conceded` : `${who} claimed the win on a lapsed clock`;
  return `${what} before the match reached its halfway point, so it was abandoned: no winner, no rating change, no battle record and no after action report.`;
}
