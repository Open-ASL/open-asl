/** Firestore collection names shared by the client and the Cloud Functions. */
export const COL = {
  users: 'users',
  allowlist: 'allowlist',
  signups: 'signups',
  matches: 'matches',
  /** Subcollection of a match: the recorded player actions, one doc per action. */
  actions: 'actions',
  /**
   * Subcollection of an online match, one doc per viewer (a side id, or 'public' for spectators): that viewer's
   * redacted snapshot of the position, rewritten by the server after every action. Each has a `steps`
   * subcollection, one doc per action, with the action's events as the viewer may see them.
   */
  views: 'views',
  steps: 'steps',
  /** Subcollection of an online match that no client can read: `game` holds the dice seed while the match is live. */
  private: 'private',
  /** Subcollection of a match, one doc per side: what that player is laying out before confirming (setup), so the opponent watches it happen. */
  drafts: 'drafts',
  /** Subcollection of a match, one doc per side: the hex that player last pinged, so the opponent's board pulses there. */
  pings: 'pings',
  invites: 'invites',
  publicProfiles: 'publicProfiles',
  nicknames: 'nicknames',
  scenarioStats: 'scenarioStats',
  listings: 'gameListings',
  attendance: 'attendance',
  chatChannels: 'chatChannels',
  messages: 'messages',
  announcements: 'announcements',
  publicResults: 'publicResults',
  /** After action reports of finished public, computer and hotseat matches, keyed by match id. */
  aars: 'aars',
  emailOutbox: 'emailOutbox',
  bookingSlots: 'bookingSlots',
  chatReports: 'chatReports',
  chatRateLimits: 'chatRateLimits',
} as const;

/** Action doc ids are zero-padded so a plain orderBy(documentId) replays in order. */
export const actionDocId = (seq: number) => String(seq).padStart(6, '0');

/** One pending invite per ordered pair, enforced by the doc id. */
export const inviteId = (fromUid: string, toUid: string) => `${fromUid}_${toUid}`;
