import type { MatchResult, Timestamp } from './types';

/** The lobby's rooms. Mirrors `ScenarioRuleset` in @asl/rules (platform does not depend on the rules). */
export type RulesetId = 'starter-kit' | 'full-asl';
export type Competition = 'ranked' | 'friendly';
export type MatchVisibility = 'public' | 'private';

export interface RulesetInfo { id: RulesetId; name: string; enabled: boolean; description: string }

/** The rulesets as production players see them: Full ASL is still coming soon. */
export const RULESETS: ReadonlyArray<RulesetInfo> = [
  { id: 'starter-kit', name: 'Starter Kit', enabled: true, description: 'Fast, focused ASL Starter Kit play.' },
  { id: 'full-asl', name: 'Full ASL', enabled: false, description: 'The complete rulebook — coming soon.' },
];

/**
 * The rulesets a player may enter. Full ASL opens only behind the development gate (`fullAsl`): a
 * local build against the emulators, or an account with the `admin` custom claim. The server checks
 * the same gate before it creates a Full ASL match or post (functions/src/lib/scenarios.ts).
 */
export function rulesetsFor(fullAsl: boolean): ReadonlyArray<RulesetInfo> {
  return fullAsl ? RULESETS.map((r) => (r.id === 'full-asl' ? { ...r, enabled: true, description: 'The complete rulebook — in development. Chapter A arrives a step at a time.' } : r)) : RULESETS;
}

export const isRulesetId = (v: unknown): v is RulesetId => RULESETS.some((r) => r.id === v);

/** Each ruleset's lobby has its own chat channel: `lobby_starter-kit`, `lobby_full-asl`. */
export const lobbyChannelId = (ruleset: RulesetId): string => `lobby_${ruleset}`;
/** The ruleset whose lobby chat a channel id is, or null for any other channel (a match's chat). */
export function rulesetOfLobbyChannel(channelId: string): RulesetId | null {
  const id = channelId.startsWith('lobby_') ? channelId.slice('lobby_'.length) : null;
  return isRulesetId(id) ? id : null;
}

/** Public, unauthenticated profile data. Email and operational flags never belong here. */
export interface PublicProfileDoc {
  uid: string;
  nickname: string;
  nicknameNormalized: string;
  nicknameChangedAt?: Timestamp;
  photoURL: string | null;
  description: string;
  location: string;
  language: string;
  xp: number;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  medals: import('./types').AwardedMedal[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** nicknames/{normalized}: current owner or a permanent old-name redirect. */
export interface NicknameDoc {
  uid: string;
  current: string;
  alias: boolean;
  createdAt: Timestamp;
}

export interface ScenarioStatsDoc {
  rulesetId: RulesetId;
  scenarioId: string;
  publicPlays: number;
  rankedResults: number;
  draws: number;
  sideWins: Record<string, number>;
  updatedAt: Timestamp;
}

export interface AvailabilityBlock {
  start: Timestamp;
  end: Timestamp;
}

export type ListingStatus = 'open' | 'scheduled' | 'withdrawn' | 'expired';

const HALF_HOUR_MS = 30 * 60_000;
/** How far ahead a start must be for a player to book it from the board. */
export const BOOKING_LEAD_MS = 15 * 60_000;

/**
 * The starts (epoch ms) an opponent may still book in an availability window from `startMs` to `endMs`: every
 * half hour in it at least `BOOKING_LEAD_MS` from now. The board offers these; once a post has none in any
 * window it is over, and the server expires it.
 */
export function bookableStarts(startMs: number, endMs: number, now = Date.now()): number[] {
  const earliest = Math.max(Math.ceil(startMs / HALF_HOUR_MS) * HALF_HOUR_MS, Math.ceil((now + BOOKING_LEAD_MS) / HALF_HOUR_MS) * HALF_HOUR_MS);
  const starts: number[] = [];
  for (let at = earliest; at <= endMs; at += HALF_HOUR_MS) starts.push(at);
  return starts;
}

/** Whether any window of a post (as epoch ms) still has a start to book. */
export const hasBookableStart = (windows: Array<{ start: number; end: number }>, now = Date.now()): boolean =>
  windows.some((w) => bookableStarts(w.start, w.end, now).length > 0);

export interface GameListingDoc {
  rulesetId: RulesetId;
  scenarioId: string;
  scenarioTitle: string;
  hostUid: string;
  hostNickname: string;
  competition: Competition;
  visibility: MatchVisibility;
  durationMinutes: number;
  timezone: string;
  availability: AvailabilityBlock[];
  side: string;
  balance: string[];
  status: ListingStatus;
  opponentUid: string | null;
  opponentNickname: string | null;
  playerIds: string[];
  scheduledAt: Timestamp | null;
  matchId: string | null;
  bookingSlotIds: string[];
  presentUids: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** When the last offered window closes; open posts expire then. */
  expiresAt: Timestamp;
  /** When the first offered window opens: the board sorts and date-filters on it. Absent on posts from before 2026-11-02. */
  windowStart?: Timestamp;
}

export interface AttendanceDoc {
  matchId: string;
  scheduledAt: Timestamp;
  uid: string;
  state: 'present' | 'cancelled' | 'no-show';
  recordedAt: Timestamp;
}

export interface ChatMessageDoc {
  channelId: string;
  uid: string;
  nickname: string;
  text: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  hidden: boolean;
}

export interface AnnouncementDoc {
  title: string;
  slug: string;
  summary: string;
  body: string;
  imageURL: string | null;
  videoURL: string | null;
  status: 'draft' | 'scheduled' | 'published' | 'archived';
  pinned: boolean;
  publishAt: Timestamp;
  authorUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PublicMatchResultDoc {
  matchId: string;
  rulesetId: RulesetId;
  scenarioId: string;
  scenarioTitle: string;
  playerIds: string[];
  players: Record<string, { uid: string; nickname: string }>;
  competition: Competition;
  visibility: 'public';
  result: MatchResult;
  official: boolean;
  completedAt: Timestamp;
}

export function defaultScenarioDuration(turns: number, unitCount: number): number {
  const estimate = 30 + 30 * turns + 2 * unitCount;
  return Math.max(120, Math.min(480, Math.ceil(estimate / 30) * 30));
}

export function balanceLabel(stats: Pick<ScenarioStatsDoc, 'rankedResults' | 'draws' | 'sideWins'>): string | null {
  if (stats.rankedResults < 10) return null;
  const [leader, wins = 0] = Object.entries(stats.sideWins).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!leader) return 'Balanced';
  const share = (wins + stats.draws * 0.5) / stats.rankedResults;
  if (share <= 0.55) return 'Balanced';
  if (share <= 0.65) return `Leans ${leader}`;
  return `${leader} favored`;
}

export function reachedOfficialProgress(
  summary: { turn: number; attacker: string },
  scenario: { turns: number; halfFinalTurn: boolean; firstSide: string },
): boolean {
  const totalPlayerTurns = scenario.turns * 2 - (scenario.halfFinalTurn ? 1 : 0);
  const completed = Math.max(0, (summary.turn - 1) * 2 + (summary.attacker === scenario.firstSide ? 0 : 1));
  return completed >= Math.ceil(totalPlayerTurns / 2);
}
