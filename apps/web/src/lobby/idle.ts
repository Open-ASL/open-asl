import type { MatchDoc } from '@asl/platform';
import { toDate } from '../ui/time';

/** How long an online match without a clock may sit untouched before the public lists drop it. */
const UNTIMED_IDLE_MS = 24 * 60 * 60 * 1000;

/**
 * An online match nobody is playing: the clock on its pending decision ran out and neither player
 * moved or claimed the time (a move starts a new clock). Older matches without a clock count as idle
 * once a day passes without an action. Idle matches stay open to their players; only the public lists
 * of live tables leave them out.
 */
export function matchIdle(match: MatchDoc, now = Date.now()): boolean {
  if (match.mode !== 'online' || match.status !== 'active') return false;
  const due = toDate(match.deadline?.at);
  if (due) return due.getTime() <= now;
  const touched = toDate(match.updatedAt);
  return !!touched && now - touched.getTime() > UNTIMED_IDLE_MS;
}
