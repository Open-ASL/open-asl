import type { DeadlineClass, Pace } from './clock';

/**
 * Firestore document shapes and callable contracts. Timestamps are typed loosely
 * (`unknown`) because the client and admin SDKs use different Timestamp classes.
 */
export type Timestamp = unknown;

export type MedalId =
  | 'cib'
  | 'purple-heart'
  | 'bronze-star'
  | 'silver-star'
  | 'dsc'
  | 'moh'
  | 'good-conduct'
  | 'american-campaign'
  | 'eame-campaign'
  | 'puc'
  | 'beta-service'
  | 'beta-campaign';

export interface AwardedMedal {
  id: MedalId;
  awardedAt: Timestamp;
}

/** users/{uid}: the public service record. Rank is derived from xp, never stored. */
export interface UserDoc {
  email: string;
  /** sha256 of the lowercased email: Gravatar lookups without exposing the address on the client. */
  gravatarHash: string;
  displayName: string;
  photoURL: string | null;
  xp: number;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  onlineGames: number;
  hotseatGames: number;
  abandoned: number;
  /** Current vs-human win streak. */
  streak: number;
  medals: AwardedMedal[];
  scenariosCompleted: string[];
  /**
   * Scenarios finished in online matches that count toward the beta ribbons (see countsForBeta);
   * one entry per scenario. Absent on records from before the ribbons existed.
   */
  betaScenarios?: string[];
  /** The vs-human match this player is in, or null. At most one at a time. */
  activeMatchId: string | null;
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
  updatedAt: Timestamp;
}

/** allowlist/{emailLower}: invited addresses. Not readable by clients. */
export interface AllowlistDoc {
  invitedBy: string;
  invitedAt: Timestamp;
  note?: string;
  claimedBy: string | null;
  claimedAt: Timestamp | null;
}

/** What a front-page signup asked for: news and updates, a beta seat, or both. */
export type SignupInterest = 'news' | 'beta';
export const SIGNUP_INTERESTS: readonly SignupInterest[] = ['news', 'beta'];

/** signups/{sha256(emailLower)}: landing-page interest. Not readable by clients. */
export interface SignupDoc {
  email: string;
  interests: SignupInterest[];
  count: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** The visitor's IP at the latest submit, for a mailing list's spam check. */
  ip?: string;
}

export type MatchMode = 'hotseat' | 'online' | 'computer';
export type MatchStatus = 'open' | 'active' | 'complete' | 'cancelled' | 'abandoned';

export interface Seat {
  uid: string;
  displayName: string;
}

export interface MatchSummary {
  turn: number;
  phase: string;
  attacker: string;
  seq: number;
  /** Side the engine is waiting on, or null when the game is over. Older records omit it. */
  toMove?: string | null;
}

/** A player action as the engine takes it; the shape is owned by @asl/engine, mirrored here so the platform package stays dependency-free. */
export interface PlayerAction {
  type: string;
  side: string;
  decisionId: string;
  [key: string]: unknown;
}

/** The clock on the pending decision of an online match. */
export interface Deadline {
  at: Timestamp;
  class: DeadlineClass;
  /** Side whose decision it is. */
  side: string;
  /** Action count the deadline was set at; a claim is only valid against the same position. */
  seq: number;
}

export interface MatchResult {
  winner: string | null;
  reason: string;
  winnerUid: string | null;
  loserUid: string | null;
  eloDelta?: number;
}

/** matches/{matchId} */
export interface MatchDoc {
  /** Lobby classification. Older beta records without these fields are ranked/public Starter Kit. */
  rulesetId?: import('./lobby').RulesetId;
  competition?: import('./lobby').Competition;
  visibility?: import('./lobby').MatchVisibility;
  /** False for an early concession/abandonment that does not count as having happened. */
  official?: boolean;
  /** Unjoined Lobby table that closes automatically when its host leaves the Lobby. */
  quick?: boolean;
  mode: MatchMode;
  status: MatchStatus;
  scenarioId: string;
  scenarioTitle: string;
  /** Sides whose balance option is on (input to applyBalance). */
  balance: string[];
  /**
   * The dice seed. Hotseat and computer games keep it here (their owner's browser plays them). An online match
   * under the `views` model keeps it in `private/game` while it is live, so no client can foresee the dice, and
   * writes it back here when the match ends, for replays and the report.
   */
  seed?: string;
  /**
   * Online matches created since the per-viewer views: clients read their `views/{viewer}` snapshot instead of
   * replaying `actions`, which stay unreadable until the match ends. Older online matches (no `model`) are
   * replayed by the client from the open recording.
   */
  model?: 'views';
  rulesetVersionHash: string;
  createdBy: string;
  /** Every player with a seat, for array-contains queries. Hotseat: just the owner. */
  playerIds: string[];
  /** Side id -> who sits there. An open online match has one null seat, or two when the sides are drawn at random. */
  seats: Record<string, Seat | null>;
  /** Open online match with sides left to chance: the poster, seated once an opponent arrives and the draw is made. */
  host?: Seat;
  /** Sides were (or will be) drawn at random rather than picked by the creator. */
  randomSides?: boolean;
  summary: MatchSummary;
  actionCount: number;
  result: MatchResult | null;
  inviteId?: string;
  /** Online matches: the time control (older records omit it and count as correspondence). */
  pace?: Pace;
  /** Online matches: the clock on the pending decision; null when the match is over or no seat is filled. */
  deadline?: Deadline | null;
  /** Online matches: the last request to take back an action, while it is pending or once answered. Cleared by the next action. */
  undo?: UndoRequest | null;
  /** Computer matches: the side the computer plays and which bot. */
  computer?: { side: string; bot: string };
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;
}

/**
 * A seated player's request to take back their own last action in an online match; the
 * opponent allows or refuses it. A refusal stands while the match is still at that action: the
 * same action cannot be asked about again until another is played or an earlier undo goes back to it.
 */
export interface UndoRequest {
  /** Tells one request's answer from the next's. */
  id: string;
  side: string;
  /** The action to take back: the match's action count when it was asked. */
  seq: number;
  status: 'pending' | 'allowed' | 'refused';
  at: Timestamp;
}

/** matches/{matchId}/actions/{seq}: a recorded player action, JSON-encoded. */
export interface MatchActionDoc {
  seq: number;
  json: string;
  at: Timestamp;
  /** Computer matches, on the computer's moves: which bot build played it and how long it thought (ms). */
  bot?: { version: string; ms: number };
}

/**
 * matches/{matchId}/views/{viewer}: the position as that viewer may see it (`redactState`), JSON-encoded, after
 * action `seq` (0 = the opening position). `viewer` is a side id, or 'public' for anyone watching a public match.
 */
export interface ViewDoc {
  seq: number;
  /** The redacted state's event count (`state.seq`). */
  eventSeq: number;
  side: string | null;
  /** The redacted GameState. */
  json: string;
  at: Timestamp;
}

/** matches/{matchId}/views/{viewer}/steps/{seq}: the events of action `seq` as the viewer may see them, JSON-encoded. */
export interface ViewStepDoc {
  seq: number;
  /** The side that played the action. */
  side: string;
  /** The redacted LoggedEvent[]. */
  json: string;
  at: Timestamp;
}

/** Spectators' viewer key in `views`. */
export const PUBLIC_VIEWER = 'public';

/**
 * matches/{matchId}/drafts/{side}: the seated player's work in progress on a decision, written by
 * their browser as they go and shown to the opponent as it changes. Not part of the recording;
 * the decision's action is what counts. Setup: counters placed so far.
 */
export interface DraftDoc {
  side: string;
  /** The decision the draft belongs to; a draft for any other decision is stale and ignored. */
  decisionId: string;
  /** Piece id -> hex it is placed in. */
  placements: Record<string, string>;
  updatedAt: Timestamp;
}

/**
 * matches/{matchId}/pings/{side}: the hex a seated player last pinged (Ctrl+click), overwritten by
 * each ping. The opponent's board pulses there in that side's colour. Not part of the recording.
 */
export interface PingDoc {
  side: string;
  hex: string;
  /** Rises with every ping (the sender's clock), so a repeat of the same hex is still seen. */
  n: number;
  /** The exact point pinged, in map pixels (the same on every screen whatever its zoom or turn); absent means the hex centre. */
  x?: number;
  y?: number;
  at: Timestamp;
}

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

/** invites/{fromUid_toUid} */
export interface InviteDoc {
  fromUid: string;
  toUid: string;
  fromName: string;
  toName: string;
  scenarioId: string;
  scenarioTitle: string;
  balance: string[];
  /** Side the sender will play, or RANDOM_SIDE for a draw when the invite is accepted. */
  fromSide: string;
  pace?: Pace;
  /** Older invites without these fields are ranked/public. */
  competition?: import('./lobby').Competition;
  visibility?: import('./lobby').MatchVisibility;
  status: InviteStatus;
  matchId: string | null;
  createdAt: Timestamp;
  respondedAt: Timestamp | null;
}

// ---------------------------------------------------------------- callables

/** The side choice that leaves the sides to a draw. */
export const RANDOM_SIDE = 'random';

export interface Callables {
  ping: { req: void; res: { ok: true; uid: string | null; ruleset: string; versionHash: string } };
  claimProfile: { req: void; res: { created: boolean } };
  submitSignup: { req: { email: string; interests: SignupInterest[] }; res: { ok: true } };
  requestPasswordReset: { req: { email: string }; res: { ok: true } };
  requestEmailVerification: { req: void; res: { ok: true } };
  createMatch: {
    /**
     * `side` is a side id, or RANDOM_SIDE to have the sides drawn when the opponent arrives. `rulesetId`, where sent, is the
     * lobby the request comes from; the server refuses a scenario of another ruleset.
     */
    req: { mode: MatchMode; scenarioId: string; balance: string[]; openSeat?: boolean; side?: string; pace?: Pace; competition?: import('./lobby').Competition; visibility?: import('./lobby').MatchVisibility; rulesetId?: import('./lobby').RulesetId };
    res: { matchId: string };
  };
  joinOpenMatch: { req: { matchId: string }; res: { matchId: string } };
  sendInvite: { req: { toUid: string; scenarioId: string; balance: string[]; side: string; pace?: Pace; competition?: import('./lobby').Competition; visibility?: import('./lobby').MatchVisibility; rulesetId?: import('./lobby').RulesetId }; res: { inviteId: string } };
  respondToInvite: { req: { inviteId: string; response: 'accept' | 'decline' | 'cancel' }; res: { matchId: string | null } };
  /** `reason: 'ruleset'` ends a match whose recording no longer replays under the current rules: void, no result, no penalty. The server refuses it for a match that still replays. */
  leaveMatch: { req: { matchId: string; reason?: 'ruleset' }; res: { status: MatchStatus } };
  completeHotseatMatch: { req: { matchId: string }; res: { result: MatchResult } };
  /** Play one action in an online match. `seq` is the number this action will have (actions seen + 1); a stale value is rejected with code 'stale'. */
  submitAction: {
    req: { matchId: string; seq: number; action: PlayerAction };
    /** `step` (views model): the caller's own view after the action, so their board updates without waiting for the listener. */
    res: { seq: number; result: MatchResult | null; step?: { seq: number; stateJson: string; eventsJson: string } };
  };
  /** The waiting opponent acts on a lapsed clock: claims the win, or passes a lapsed first-fire call for the other side. Lapsed clocks are never acted on otherwise. */
  claimTimeout: { req: { matchId: string; outcome?: 'pass' | 'forfeit' }; res: { outcome: 'passed' | 'forfeit' } };
  /** Ask the opponent to take back your last action, which must be the last one recorded (`seq`). */
  requestUndo: { req: { matchId: string; seq: number }; res: { id: string } };
  /** Withdraw your pending undo request and play on. */
  cancelUndo: { req: { matchId: string }; res: void };
  /** The opponent's answer to a pending undo request; allowing it removes the action from the recording. */
  answerUndo: { req: { matchId: string; id: string; allow: boolean }; res: { undone: boolean } };
  ensurePublicProfile: { req: void; res: { profile: import('./lobby').PublicProfileDoc } };
  updatePublicProfile: {
    req: { nickname: string; description?: string; location?: string; language?: string };
    res: { profile: import('./lobby').PublicProfileDoc };
  };
  createGameListing: {
    req: { scenarioId: string; competition: import('./lobby').Competition; visibility: import('./lobby').MatchVisibility; durationMinutes: number; timezone: string; availability: Array<{ start: string; end: string }>; side: string; balance: string[]; rulesetId?: import('./lobby').RulesetId };
    res: { listingId: string };
  };
  scheduleGameListing: { req: { listingId: string; start: string }; res: { listingId: string } };
  withdrawGameListing: { req: { listingId: string }; res: { status: import('./lobby').ListingStatus } };
  startScheduledGame: { req: { listingId: string }; res: { matchId: string } };
  sendChatMessage: { req: { channelId: string; text: string }; res: { messageId: string } };
  reportChatMessage: { req: { channelId: string; messageId: string; reason: string }; res: { reportId: string } };
  saveAnnouncement: {
    req: { id?: string; title: string; summary: string; body: string; imageURL?: string | null; videoURL?: string | null; status: import('./lobby').AnnouncementDoc['status']; pinned: boolean; publishAt: string };
    res: { id: string };
  };
}
export type CallableName = keyof Callables;
