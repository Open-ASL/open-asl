import { onCall } from 'firebase-functions/v2/https';
import { DEMO_SCENARIO, sk1Ruleset } from '@asl/content';
import './lib/app';

export { claimProfile } from './profile';
export { submitSignup } from './signups';
export { requestPasswordReset, requestEmailVerification } from './accountEmails';
export { createMatch, joinOpenMatch, leaveMatch, completeHotseatMatch } from './matches';
export { sendInvite, respondToInvite } from './invites';
export { submitAction, claimTimeout, requestUndo, cancelUndo, answerUndo } from './online';
export { ensurePublicProfile, updatePublicProfile, mirrorPublicProfileStats } from './lobbyProfiles';
export { createGameListing, scheduleGameListing, withdrawGameListing, startScheduledGame, recordScheduledNoShows, expireOpenListings } from './lobbyListings';
export { sendScheduledGameEmails } from './notifications';
export { sendChatMessage, reportChatMessage, expireChatMessages } from './chat';
export { closeDisconnectedQuickTables, sweepStalePresence } from './presence';
export { saveAnnouncement, publishScheduledAnnouncements } from './announcements';
export { profilePage } from './profileMeta';
export { aarPage, writeAarOnComplete } from './aar';

/** Health check: proves the bundled engine loads and reports the ruleset version hash that games pin. */
export const ping = onCall((req) => {
  const ruleset = sk1Ruleset(DEMO_SCENARIO);
  return { ok: true, uid: req.auth?.uid ?? null, ruleset: ruleset.id, versionHash: ruleset.versionHash };
});
