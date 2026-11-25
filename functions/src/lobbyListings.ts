import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { BOOKING_LEAD_MS, COL, RANDOM_SIDE, hasBookableStart, type Competition, type GameListingDoc, type MatchDoc, type MatchVisibility, type PublicProfileDoc, type UserDoc } from '@asl/platform';
import { db, now } from './lib/app';
import { requireMember, requireString } from './lib/auth';
import { firstDeadline } from './lib/clock';
import { drawSide, otherSide, prepareScenario, requireRuleset, requireSideChoice } from './lib/scenarios';
import { baseMatch, forViews, matchRef } from './matches';
import { seedNewOnlineMatch } from './lib/viewStore';
import { readUser } from './lib/users';
import { closedSession } from './lib/sessions';

const listingRef = (id: string) => db.collection(COL.listings).doc(id);

function requireDate(value: unknown, name: string): Date {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${name} is required.`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new HttpsError('invalid-argument', `${name} is not a date.`);
  return date;
}

function slotIds(uid: string, start: Date, durationMinutes: number): string[] {
  const slots: string[] = [];
  for (let at = start.getTime(); at < start.getTime() + durationMinutes * 60_000; at += 30 * 60_000) {
    slots.push(`${uid}_${new Date(at).toISOString().replace(/[-:.TZ]/g, '').slice(0, 12)}`);
  }
  return slots;
}

function emailDoc(id: string, to: string, nickname: string, kind: string, listing: GameListingDoc, sendAt: Timestamp) {
  return {
    to, nickname, kind, listingId: id, rulesetId: listing.rulesetId, scenarioTitle: listing.scenarioTitle,
    scheduledAt: listing.scheduledAt, sendAt, status: 'pending', attempts: 0, createdAt: now(), updatedAt: now(),
  };
}

export const createGameListing = onCall(async (req) => {
  const auth = requireMember(req);
  const { uid } = auth;
  const { scenario, balance } = prepareScenario(req.data?.scenarioId, req.data?.balance);
  const rulesetId = requireRuleset(auth, scenario, req.data?.rulesetId);
  const competition: Competition = req.data?.competition === 'friendly' ? 'friendly' : 'ranked';
  const visibility: MatchVisibility = competition === 'ranked' ? 'public' : req.data?.visibility === 'private' ? 'private' : 'public';
  const durationMinutes = Number(req.data?.durationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 60 || durationMinutes > 720 || durationMinutes % 30) throw new HttpsError('invalid-argument', 'Duration must be 1–12 hours in 30-minute steps.');
  const timezone = requireString(req.data?.timezone, 'timezone', 80);
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new HttpsError('invalid-argument', 'Unknown timezone.'); }
  if (!Array.isArray(req.data?.availability) || !req.data.availability.length || req.data.availability.length > 8) throw new HttpsError('invalid-argument', 'Add 1–8 availability blocks.');
  const availability: Array<{ start: Timestamp; end: Timestamp }> = req.data.availability.map((block: { start?: unknown; end?: unknown }) => {
    const start = requireDate(block.start, 'start');
    const end = requireDate(block.end, 'end');
    // A block is the range of starts the host accepts; the session itself may run past its end.
    if (start.getTime() < Date.now() + 15 * 60_000 || end <= start) throw new HttpsError('invalid-argument', 'Each block must be in the future and end after it starts.');
    return { start: Timestamp.fromDate(start), end: Timestamp.fromDate(end) };
  });
  const side = requireSideChoice(scenario, req.data?.side);
  const ref = listingRef(db.collection(COL.listings).doc().id);
  await db.runTransaction(async (tx) => {
    const profile = (await tx.get(db.collection(COL.publicProfiles).doc(uid))).data() as PublicProfileDoc | undefined;
    if (!profile) throw new HttpsError('failed-precondition', 'Finish setting up your public profile first.');
    const listing: GameListingDoc = {
      rulesetId, scenarioId: scenario.id, scenarioTitle: scenario.title, hostUid: uid, hostNickname: profile.nickname,
      competition, visibility, durationMinutes, timezone, availability, side, balance, status: 'open', opponentUid: null, opponentNickname: null,
      playerIds: [uid], scheduledAt: null, matchId: null, bookingSlotIds: [], presentUids: [], createdAt: now(), updatedAt: now(),
      expiresAt: Timestamp.fromMillis(Math.max(...availability.map((b) => b.end.toMillis()))),
      windowStart: Timestamp.fromMillis(Math.min(...availability.map((b) => b.start.toMillis()))),
    };
    tx.create(ref, listing);
  });
  return { listingId: ref.id };
});

export const scheduleGameListing = onCall(async (req) => {
  const auth = requireMember(req);
  const { uid } = auth;
  const id = requireString(req.data?.listingId, 'listingId');
  const start = requireDate(req.data?.start, 'start');
  if (start.getUTCMinutes() % 30 !== 0 || start.getUTCSeconds() !== 0) throw new HttpsError('invalid-argument', 'Choose a half-hour start time.');
  const ref = listingRef(id);
  await db.runTransaction(async (tx) => {
    const listing = (await tx.get(ref)).data() as GameListingDoc | undefined;
    if (!listing || listing.status !== 'open') throw new HttpsError('failed-precondition', 'That listing is no longer open.');
    if (listing.hostUid === uid) throw new HttpsError('failed-precondition', 'You cannot schedule your own listing.');
    requireRuleset(auth, prepareScenario(listing.scenarioId, listing.balance).scenario);
    // The expected end, for the players' booked time; the window only has to contain the start.
    const endMs = start.getTime() + listing.durationMinutes * 60_000;
    const fits = listing.availability.some((b) => (b.start as Timestamp).toMillis() <= start.getTime() && (b.end as Timestamp).toMillis() >= start.getTime());
    if (!fits) throw new HttpsError('failed-precondition', 'That time no longer fits the offered availability.');
    const [host, opponent, opponentProfile] = await Promise.all([
      readUser(tx, listing.hostUid), readUser(tx, uid), tx.get(db.collection(COL.publicProfiles).doc(uid)),
    ]);
    const slots = [...slotIds(listing.hostUid, start, listing.durationMinutes), ...slotIds(uid, start, listing.durationMinutes)];
    const slotRefs = slots.map((slot) => db.collection(COL.bookingSlots).doc(slot));
    const occupied = await Promise.all(slotRefs.map((slot) => tx.get(slot)));
    // The first half of the slots are the host's, the rest the caller's: say whose time is taken.
    const hostBusy = occupied.slice(0, slots.length / 2).some((snap) => snap.exists);
    const callerBusy = occupied.slice(slots.length / 2).some((snap) => snap.exists);
    if (callerBusy) throw new HttpsError('failed-precondition', 'You already have a game during that time.', { code: 'booking-conflict' });
    if (hostBusy) throw new HttpsError('failed-precondition', `${listing.hostNickname} already has a game during that time.`, { code: 'booking-conflict' });
    const profile = opponentProfile.data() as PublicProfileDoc | undefined;
    if (!profile) throw new HttpsError('failed-precondition', 'Finish setting up your public profile first.');
    const scheduledAt = Timestamp.fromDate(start);
    const scheduled: GameListingDoc = { ...listing, status: 'scheduled', opponentUid: uid, opponentNickname: profile.nickname, playerIds: [listing.hostUid, uid], scheduledAt, bookingSlotIds: slots, updatedAt: now() };
    tx.update(ref, { status: 'scheduled', opponentUid: uid, opponentNickname: profile.nickname, playerIds: scheduled.playerIds, scheduledAt, bookingSlotIds: slots, updatedAt: now() });
    slotRefs.forEach((slot, index) => tx.create(slot, { listingId: id, uid: index < slots.length / 2 ? listing.hostUid : uid, start: scheduledAt, expiresAt: Timestamp.fromMillis(endMs) }));
    const sends: Array<[string, Timestamp]> = [['confirmation', Timestamp.now()], ['reminder-30m', Timestamp.fromMillis(start.getTime() - 30 * 60_000)]];
    if (start.getTime() - Date.now() > 24 * 60 * 60_000) sends.push(['reminder-24h', Timestamp.fromMillis(start.getTime() - 24 * 60 * 60_000)]);
    for (const [kind, sendAt] of sends) {
      tx.set(db.collection(COL.emailOutbox).doc(`${id}_${listing.hostUid}_${kind}`), emailDoc(id, host.data.email, listing.hostNickname, kind, scheduled, sendAt));
      tx.set(db.collection(COL.emailOutbox).doc(`${id}_${uid}_${kind}`), emailDoc(id, opponent.data.email, profile.nickname, kind, scheduled, sendAt));
    }
  });
  return { listingId: id };
});

export const withdrawGameListing = onCall(async (req) => {
  const { uid } = requireMember(req);
  const id = requireString(req.data?.listingId, 'listingId');
  const ref = listingRef(id);
  const status = await db.runTransaction(async (tx) => {
    const listing = (await tx.get(ref)).data() as GameListingDoc | undefined;
    if (!listing) throw new HttpsError('not-found', 'No such listing.');
    if (!listing.playerIds.includes(uid)) throw new HttpsError('permission-denied', 'That is not your game listing.');
    if (listing.status !== 'open' && listing.status !== 'scheduled') return listing.status;
    const match = listing.matchId ? ((await tx.get(matchRef(listing.matchId))).data() as MatchDoc | undefined) : undefined;
    if (listing.status === 'scheduled' && match && closedSession(listing, match) === 'played') {
      // A session already played is only taken off the schedules: the host's post must not go back on the board.
      tx.update(ref, { status: 'played', updatedAt: now() });
      return 'played' as const;
    }
    const slots = listing.bookingSlotIds.map((slot) => db.collection(COL.bookingSlots).doc(slot));
    await Promise.all(slots.map((slot) => tx.get(slot)));
    // A scheduled game: the player left behind is told by email (read before the first write of the transaction).
    const scheduled = listing.status === 'scheduled' && listing.opponentUid && listing.scheduledAt ? { opponentUid: listing.opponentUid } : null;
    const remainingUid = scheduled ? (uid === listing.hostUid ? scheduled.opponentUid : listing.hostUid) : null;
    // A deleted account gets no email, and never blocks the withdrawal.
    const remaining = remainingUid ? ((await tx.get(db.collection(COL.users).doc(remainingUid))).data() as UserDoc | undefined) ?? null : null;
    slots.forEach((slot) => tx.delete(slot));
    if (scheduled) {
      // The session reminders are dropped for both players, whoever withdraws.
      for (const who of [listing.hostUid, scheduled.opponentUid]) for (const kind of ['reminder-30m', 'reminder-24h']) tx.delete(db.collection(COL.emailOutbox).doc(`${id}_${who}_${kind}`));
      const reopened = uid !== listing.hostUid;
      const withdrawnBy = (reopened ? listing.opponentNickname : listing.hostNickname) ?? undefined;
      const remainingNickname = (reopened ? listing.hostNickname : listing.opponentNickname) ?? remaining?.displayName ?? '';
      // One notice per scheduled session: the same post can be booked and given up again later.
      const notice = `${id}_${remainingUid}_withdrawn_${(listing.scheduledAt as Timestamp).toMillis()}`;
      if (remaining?.email) tx.set(db.collection(COL.emailOutbox).doc(notice), { ...emailDoc(id, remaining.email, remainingNickname, 'withdrawn', listing, Timestamp.now()), ...(withdrawnBy ? { withdrawnBy } : {}), reopened });
    }
    if (scheduled && uid !== listing.hostUid) {
      // The opponent backs out: the host's post goes back on the board as they wrote it.
      tx.update(ref, { status: 'open', opponentUid: null, opponentNickname: null, playerIds: [listing.hostUid], scheduledAt: null, bookingSlotIds: [], presentUids: [], updatedAt: now() });
      return 'open' as const;
    }
    tx.update(ref, { status: 'withdrawn', updatedAt: now() });
    return 'withdrawn' as const;
  });
  return { status };
});

export const startScheduledGame = onCall(async (req) => {
  const { uid } = requireMember(req);
  const id = requireString(req.data?.listingId, 'listingId');
  const listingDocument = listingRef(id);
  const matchDocument = matchRef(db.collection(COL.matches).doc().id);
  const matchId = await db.runTransaction(async (tx) => {
    const listing = (await tx.get(listingDocument)).data() as GameListingDoc | undefined;
    if (!listing || listing.status !== 'scheduled' || !listing.scheduledAt || !listing.opponentUid) throw new HttpsError('failed-precondition', 'That game is not scheduled.');
    if (!listing.playerIds.includes(uid)) throw new HttpsError('permission-denied', 'You are not scheduled for that game.');
    if (listing.matchId) {
      tx.update(listingDocument, { presentUids: Array.from(new Set([...(listing.presentUids ?? []), uid])), updatedAt: now() });
      return listing.matchId;
    }
    const startMs = (listing.scheduledAt as Timestamp).toMillis();
    if (Date.now() < startMs - 15 * 60_000 || Date.now() > startMs + 30 * 60_000) throw new HttpsError('failed-precondition', 'The table opens 15 minutes before the scheduled start.');
    const [host, opponent] = await Promise.all([readUser(tx, listing.hostUid), readUser(tx, listing.opponentUid)]);
    if (host.data.activeMatchId || opponent.data.activeMatchId) throw new HttpsError('failed-precondition', 'One player is already in another live match.');
    const { scenario, balance, versionHash } = prepareScenario(listing.scenarioId, listing.balance);
    const hostSide = listing.side === RANDOM_SIDE ? drawSide(scenario) : listing.side;
    const seats = { [hostSide]: { uid: listing.hostUid, displayName: listing.hostNickname }, [otherSide(scenario, hostSide)]: { uid: listing.opponentUid, displayName: listing.opponentNickname ?? opponent.data.displayName } };
    const { doc, seed } = forViews(baseMatch(scenario, balance, versionHash, listing.hostUid, listing.competition, listing.visibility));
    // The table opens early, but the clock waits for the scheduled start.
    const match: MatchDoc = { ...doc, mode: 'online', status: 'active', playerIds: listing.playerIds, seats, pace: 'live', deadline: null, clockFrom: listing.scheduledAt };
    match.deadline = firstDeadline(match, scenario);
    tx.create(matchDocument, match);
    seedNewOnlineMatch(tx, matchDocument, scenario, seed, match);
    tx.update(listingDocument, { matchId: matchDocument.id, presentUids: [uid], updatedAt: now() });
    tx.update(host.ref, { activeMatchId: matchDocument.id, updatedAt: now() });
    tx.update(opponent.ref, { activeMatchId: matchDocument.id, updatedAt: now() });
    return matchDocument.id;
  });
  return { matchId };
});

/**
 * Open posts nobody can book any more leave the board: every window's last start is past or too close to book
 * (`hasBookableStart`, as the board shows it). The host is told by email to post again (user request 2026-11-06).
 */
export const expireOpenListings = onSchedule('every 5 minutes', async () => {
  // A window ending more than the booking lead plus a half hour away still has a start to book.
  const horizon = Timestamp.fromMillis(Date.now() + BOOKING_LEAD_MS + 30 * 60_000);
  const candidates = await db.collection(COL.listings).where('status', '==', 'open').where('expiresAt', '<=', horizon).limit(200).get();
  await Promise.all(candidates.docs.map((snap) => db.runTransaction(async (tx) => {
    const listing = (await tx.get(snap.ref)).data() as GameListingDoc | undefined;
    if (!listing || listing.status !== 'open') return;
    const windows = listing.availability.map((b) => ({ start: (b.start as Timestamp).toMillis(), end: (b.end as Timestamp).toMillis() }));
    if (hasBookableStart(windows)) return;
    // Read directly: a host whose account is gone still has their post taken down, just without the email.
    const host = (await tx.get(db.collection(COL.users).doc(listing.hostUid))).data() as UserDoc | undefined;
    tx.update(snap.ref, { status: 'expired', updatedAt: now() });
    if (host?.email) {
      tx.set(db.collection(COL.emailOutbox).doc(`${snap.id}_${listing.hostUid}_expired`), {
        ...emailDoc(snap.id, host.email, listing.hostNickname, 'expired', listing, Timestamp.now()),
        scenarioId: listing.scenarioId,
      });
    }
  })));
});

/**
 * Once a scheduled session's table has closed: a played session leaves the schedules; one that did not get both
 * players to the table expires, with attendance recorded.
 */
export const recordScheduledNoShows = onSchedule('every 5 minutes', async () => {
  const cutoff = Timestamp.fromMillis(Date.now() - 30 * 60_000);
  const overdue = await db.collection(COL.listings).where('status', '==', 'scheduled').where('scheduledAt', '<=', cutoff).limit(100).get();
  await Promise.all(overdue.docs.map((snap) => db.runTransaction(async (tx) => {
    const listing = (await tx.get(snap.ref)).data() as GameListingDoc | undefined;
    if (!listing || listing.status !== 'scheduled' || !listing.scheduledAt) return;
    const matchDocument = listing.matchId ? matchRef(listing.matchId) : null;
    const players = await Promise.all(listing.playerIds.map((uid) => readUser(tx, uid)));
    const match = matchDocument ? ((await tx.get(matchDocument)).data() as MatchDoc | undefined) : undefined;
    // Opening a table records the first visitor, but either player may make the first
    // move. Once the recording has actions, both players demonstrably attended and the
    // lobby must not later clear their active match or issue a false no-show. A played
    // session comes off both schedules; left 'scheduled', it stayed there for good and
    // filled this query's limit.
    if (closedSession(listing, match) === 'played') {
      tx.update(snap.ref, { status: 'played', presentUids: listing.playerIds, updatedAt: now() });
      return;
    }
    tx.update(snap.ref, { status: 'expired', updatedAt: now() });
    listing.bookingSlotIds.forEach((slot) => tx.delete(db.collection(COL.bookingSlots).doc(slot)));
    for (const player of players) {
      const present = (listing.presentUids ?? []).includes(player.ref.id);
      tx.set(db.collection(COL.attendance).doc(`${snap.id}_${player.ref.id}`), { matchId: listing.matchId ?? '', listingId: snap.id, scheduledAt: listing.scheduledAt, uid: player.ref.id, state: present ? 'present' : 'no-show', recordedAt: now() });
      if (listing.matchId && player.data.activeMatchId === listing.matchId) tx.update(player.ref, { activeMatchId: null, updatedAt: now() });
    }
    if (matchDocument && match?.status === 'active' && match.actionCount === 0) tx.update(matchDocument, { status: 'abandoned', official: false, result: null, deadline: null, completedAt: now(), updatedAt: now() });
  })));
});
