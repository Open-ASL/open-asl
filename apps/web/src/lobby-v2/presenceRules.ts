/**
 * What "in the Lobby" means. A browser connection is one node under `presence/{uid}`; it carries
 * where the tab is (`area`), whether the person has used it lately (`active`) and when the tab last
 * reported in (`at`, a server timestamp refreshed every minute). The roster counts a person only
 * while some lobby tab of theirs is active and recently confirmed, so a tab left open for
 * weeks, or a laptop that went to sleep before its disconnect handler ran, drops off by itself.
 */

/** No pointer or key input for this long and the tab is marked away. */
export const IDLE_MS = 10 * 60_000;
/** `at` is refreshed this often for as long as the tab lives (hidden tabs run timers about once a minute). */
export const HEARTBEAT_MS = 60_000;
/** A connection whose `at` is older than this is ignored, whatever it claims (dead tab, sleeping laptop, old client). */
export const STALE_MS = 3 * 60_000;
/** A connection whose `at` is older than this is dead and may be removed; `sweepStalePresence` on the server uses the same window. */
export const PURGE_MS = 15 * 60_000;
/** How often the reader re-applies the staleness cut without a new snapshot. */
export const RECHECK_MS = 30_000;

export interface PresenceConnection {
  at?: number;
  area?: 'lobby' | 'match';
  active?: boolean;
}

export type PresenceTree = Record<string, Record<string, PresenceConnection | null> | null>;

/** Whether one connection puts its owner in the Lobby right now, by the server clock. */
export function connectionPresent(connection: PresenceConnection | null | undefined, serverNow: number): boolean {
  if (!connection || connection.area === 'match') return false;
  if (connection.active === false) return false;
  return typeof connection.at === 'number' && serverNow - connection.at <= STALE_MS;
}

/** The uids in the Lobby now, sorted. */
export function presentUids(tree: PresenceTree | null | undefined, serverNow: number): string[] {
  return Object.entries(tree ?? {})
    .filter(([, connections]) => Object.values(connections ?? {}).some((connection) => connectionPresent(connection, serverNow)))
    .map(([uid]) => uid)
    .sort();
}
