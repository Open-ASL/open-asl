import type { MatchDoc } from '@asl/platform';

/**
 * Who plays each side, for the top bar: the seated players' names, the computer's seat by the name it is given. A seat
 * not yet filled shows none, and neither does a hotseat game, where one account plays both sides at one screen.
 */
export function seatNames(match: Pick<MatchDoc, 'mode' | 'seats'>): Record<string, string> | undefined {
  if (match.mode === 'hotseat') return undefined;
  const out: Record<string, string> = {};
  for (const [side, seat] of Object.entries(match.seats ?? {})) if (seat?.displayName) out[side] = seat.displayName;
  return out;
}
