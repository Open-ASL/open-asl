import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { DocumentReference } from 'firebase-admin/firestore';
import { COL, RANDOM_SIDE, inviteId, type Competition, type InviteDoc, type MatchDoc, type MatchVisibility } from '@asl/platform';
import { db, now } from './lib/app';
import { requireMember, requireString } from './lib/auth';
import { drawSide, otherSide, prepareScenario, requireRuleset, requireSideChoice } from './lib/scenarios';
import { readUser, requireFree } from './lib/users';
import { baseMatch, forViews, matchRef } from './matches';
import { seedNewOnlineMatch } from './lib/viewStore';
import { firstDeadline, requirePace } from './lib/clock';

const inviteRef = (id: string) => db.collection(COL.invites).doc(id) as DocumentReference<InviteDoc>;

/** Challenge another player directly. Both must be free; one pending invite per pair. */
export const sendInvite = onCall(async (req) => {
  const auth = requireMember(req);
  const { uid } = auth;
  const toUid = requireString(req.data?.toUid, 'toUid');
  if (toUid === uid) throw new HttpsError('invalid-argument', 'You cannot invite yourself.');
  const { scenario, balance } = prepareScenario(req.data?.scenarioId, req.data?.balance);
  requireRuleset(auth, scenario, req.data?.rulesetId);
  const fromSide = requireSideChoice(scenario, req.data?.side);
  const pace = requirePace(req.data?.pace);
  const competition: Competition = req.data?.competition === 'friendly' ? 'friendly' : 'ranked';
  const visibility: MatchVisibility = competition === 'ranked' ? 'public' : req.data?.visibility === 'private' ? 'private' : 'public';
  const id = inviteId(uid, toUid);
  await db.runTransaction(async (tx) => {
    const me = await readUser(tx, uid);
    const them = await readUser(tx, toUid);
    const existing = (await tx.get(inviteRef(id))).data();
    requireFree(me.data, 'you');
    requireFree(them.data, 'they');
    if (existing?.status === 'pending') throw new HttpsError('already-exists', 'You already have an invite out to that player.');
    const doc: InviteDoc = {
      fromUid: uid,
      toUid,
      fromName: me.data.displayName,
      toName: them.data.displayName,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      balance,
      fromSide,
      pace,
      competition,
      visibility,
      status: 'pending',
      matchId: null,
      createdAt: now(),
      respondedAt: null,
    };
    tx.set(inviteRef(id), doc);
  });
  return { inviteId: id };
});

/** Accept (recipient), decline (recipient) or cancel (sender) a pending invite. Accepting creates the match. */
export const respondToInvite = onCall(async (req) => {
  const auth = requireMember(req);
  const { uid } = auth;
  const ref = inviteRef(requireString(req.data?.inviteId, 'inviteId'));
  const response = req.data?.response;
  if (response !== 'accept' && response !== 'decline' && response !== 'cancel') throw new HttpsError('invalid-argument', 'Unknown response.');

  const matchId = await db.runTransaction(async (tx) => {
    const invite = (await tx.get(ref)).data();
    if (!invite) throw new HttpsError('not-found', 'No such invite.');
    if (invite.status !== 'pending') throw new HttpsError('failed-precondition', 'That invite has already been answered.');
    if (response === 'cancel') {
      if (invite.fromUid !== uid) throw new HttpsError('permission-denied', 'Only the sender can cancel.');
      tx.update(ref, { status: 'cancelled', respondedAt: now() });
      return null;
    }
    if (invite.toUid !== uid) throw new HttpsError('permission-denied', 'That invite is not for you.');
    if (response === 'decline') {
      tx.update(ref, { status: 'declined', respondedAt: now() });
      return null;
    }
    const from = await readUser(tx, invite.fromUid);
    const to = await readUser(tx, invite.toUid);
    // Things may have changed since the invite went out.
    requireFree(to.data, 'you');
    requireFree(from.data, 'they');
    const { scenario, balance, versionHash } = prepareScenario(invite.scenarioId, invite.balance);
    requireRuleset(auth, scenario);
    const mref = matchRef(db.collection(COL.matches).doc().id);
    const random = invite.fromSide === RANDOM_SIDE;
    const fromSide = random ? drawSide(scenario) : invite.fromSide;
    const seats = {
      [fromSide]: { uid: from.ref.id, displayName: from.data.displayName },
      [otherSide(scenario, fromSide)]: { uid: to.ref.id, displayName: to.data.displayName },
    };
    const pace = requirePace(invite.pace);
    const competition = invite.competition ?? 'ranked';
    const visibility = competition === 'ranked' ? 'public' : (invite.visibility ?? 'public');
    const { doc, seed } = forViews(baseMatch(scenario, balance, versionHash, invite.fromUid, competition, visibility));
    const match: MatchDoc = { ...doc, mode: 'online', status: 'active', playerIds: [invite.fromUid, invite.toUid], seats, inviteId: ref.id, pace, deadline: null, ...(random ? { randomSides: true } : {}) };
    tx.set(mref, { ...match, deadline: firstDeadline(match, scenario) });
    seedNewOnlineMatch(tx, mref, scenario, seed, match);
    tx.update(from.ref, { activeMatchId: mref.id, updatedAt: now() });
    tx.update(to.ref, { activeMatchId: mref.id, updatedAt: now() });
    tx.update(ref, { status: 'accepted', matchId: mref.id, respondedAt: now() });
    return mref.id;
  });
  return { matchId };
});
