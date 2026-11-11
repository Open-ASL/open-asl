import { randomUUID } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { Action } from '@asl/engine';
import type { ScenarioDef } from '@asl/rules';
import { infantryOnly } from '@asl/content';
import { COL, COMPUTER_NAME, COMPUTER_OPPONENTS, COMPUTER_UID, RANDOM_SIDE, XP, countsForBeta, eloUpdate, evaluateMedals, reachedOfficialProgress, type AarPlayer, type Competition, type MatchActionDoc, type MatchDoc, type MatchResult, type MatchVisibility, type PublicMatchResultDoc, type Seat, type UserDoc } from '@asl/platform';
import { firstDeadline, requirePace } from './lib/clock';
import { db, FieldValue, now, stamp } from './lib/app';
import { requireMember, requireString } from './lib/auth';
import { CAMPAIGN_SCENARIO_IDS, drawSide, otherSide, prepareScenario, replay, requireRuleset, requireSideChoice, rulesetOf, summaryOf } from './lib/scenarios';
import { readUser, requireFree } from './lib/users';
import { usesViews } from './lib/views';
import { seedNewOnlineMatch, seedOf } from './lib/viewStore';
import { aarPlayers } from './aar';

export const matchRef = (id: string) => db.collection(COL.matches).doc(id) as DocumentReference<MatchDoc>;

/** A fresh match document, before seats and status are decided by the caller. */
export function baseMatch(scenario: ScenarioDef, balance: string[], versionHash: string, uid: string, competition: Competition, visibility: MatchVisibility): Omit<MatchDoc, 'mode' | 'status' | 'playerIds' | 'seats'> {
  return {
    rulesetId: rulesetOf(scenario),
    competition,
    visibility,
    official: true,
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    balance,
    seed: randomUUID(),
    rulesetVersionHash: versionHash,
    createdBy: uid,
    summary: { turn: 1, phase: 'setup', attacker: scenario.firstSide, seq: 0, toMove: scenario.firstSide },
    actionCount: 0,
    result: null,
    createdAt: now(),
    updatedAt: now(),
    completedAt: null,
  };
}

const seat = (uid: string, u: UserDoc): Seat => ({ uid, displayName: u.displayName });

/**
 * An online match keeps its seed off the document while it is live (`private/game`, written by `seedNewOnlineMatch`)
 * and reads as `model: 'views'`: clients get per-viewer snapshots, never the recording.
 */
export function forViews<T extends { seed?: string }>(base: T): { doc: Omit<T, 'seed'> & { model: 'views' }; seed: string } {
  const { seed, ...rest } = base;
  return { doc: { ...rest, model: 'views' }, seed: seed! };
}

/**
 * Ranked games are public. A game against the computer is public unless asked otherwise: a
 * public one earns an after action report and a line on the service record. A hotseat game is
 * private while it is played; its recording opens when it completes, with its report.
 */
function matchVisibility(mode: 'hotseat' | 'online' | 'computer', competition: Competition, asked: unknown): MatchVisibility {
  if (competition === 'ranked') return 'public';
  if (mode === 'hotseat') return 'private';
  if (mode === 'computer') return asked === 'private' ? 'private' : 'public';
  return asked === 'public' ? 'public' : 'private';
}

/**
 * createMatch: hotseat games start at once and belong to their owner. An online game with an
 * open seat waits in the lobby; posting one occupies the poster's single vs-human slot.
 */
export const createMatch = onCall(async (req) => {
  const auth = requireMember(req);
  const { uid } = auth;
  const mode = req.data?.mode;
  const { scenario, balance, versionHash } = prepareScenario(req.data?.scenarioId, req.data?.balance);
  const ruleset = requireRuleset(auth, scenario, req.data?.rulesetId);
  if (mode !== 'hotseat' && mode !== 'online' && mode !== 'computer') throw new HttpsError('invalid-argument', 'Unknown game mode.');
  const competition: Competition = req.data?.competition === 'friendly' || mode !== 'online' ? 'friendly' : 'ranked';
  const visibility = matchVisibility(mode, competition, req.data?.visibility);

  const ref = matchRef(db.collection(COL.matches).doc().id);
  await db.runTransaction(async (tx) => {
    const me = await readUser(tx, uid);
    const base = baseMatch(scenario, balance, versionHash, uid, competition, visibility);
    if (mode === 'hotseat') {
      const seats = Object.fromEntries(scenario.sides.map((s) => [s.side, seat(uid, me.data)]));
      tx.set(ref, { ...base, mode, status: 'active', playerIds: [uid], seats });
      return;
    }
    if (mode === 'computer') {
      // The player picks their side; the computer takes the other, where it can play it. Like a
      // hotseat game it is recorded by its owner's browser and never occupies the vs-human slot.
      const side = requireSideChoice(scenario, req.data?.side);
      // The computer plays only the Starter Kit until Chapter A is done.
      if (ruleset !== 'starter-kit') throw new HttpsError('failed-precondition', `${COMPUTER_NAME} cannot play Full ASL yet.`);
      const ai = side === RANDOM_SIDE ? undefined : otherSide(scenario, side);
      // The computer opponent plays Infantry-only scenarios: it neither crews Guns nor drives vehicles yet.
      if (!infantryOnly(scenario)) throw new HttpsError('failed-precondition', `${COMPUTER_NAME} plays only scenarios without Guns or vehicles for now.`);
      if (!ai || !(COMPUTER_OPPONENTS[scenario.id] ?? []).includes(ai)) throw new HttpsError('failed-precondition', `${COMPUTER_NAME} cannot play that side of this scenario yet.`);
      const seats = { [side]: seat(uid, me.data), [ai]: { uid: COMPUTER_UID, displayName: COMPUTER_NAME } };
      tx.set(ref, { ...base, mode, status: 'active', playerIds: [uid], seats, computer: { side: ai, bot: 'tactician' } });
      return;
    }
    if (!req.data?.openSeat) throw new HttpsError('invalid-argument', 'Online games are created with an open seat or through an invite.');
    // The Lobby only lists public tables, so a private open seat could never be joined.
    if (visibility === 'private') throw new HttpsError('invalid-argument', 'A private game cannot have an open seat; challenge a player or post times instead.');
    requireFree(me.data, 'you');
    const side = requireSideChoice(scenario, req.data?.side);
    const pace = requirePace(req.data?.pace);
    const { doc, seed } = forViews(base);
    if (side === RANDOM_SIDE) {
      // Both seats stay empty until an opponent arrives and the sides are drawn.
      const seats = Object.fromEntries(scenario.sides.map((s) => [s.side, null]));
      tx.set(ref, { ...doc, mode, status: 'open', quick: true, playerIds: [uid], seats, host: seat(uid, me.data), randomSides: true, pace, deadline: null });
    } else {
      const seats = { [side]: seat(uid, me.data), [otherSide(scenario, side)]: null };
      tx.set(ref, { ...doc, mode, status: 'open', quick: true, playerIds: [uid], seats, pace, deadline: null });
    }
    seedNewOnlineMatch(tx, ref, scenario, seed, doc);
    tx.update(me.ref, { activeMatchId: ref.id, updatedAt: now() });
  });
  return { matchId: ref.id };
});

/** Take the empty seat of an open online match. */
export const joinOpenMatch = onCall(async (req) => {
  const auth = requireMember(req);
  const { uid } = auth;
  const ref = matchRef(requireString(req.data?.matchId, 'matchId'));
  await db.runTransaction(async (tx) => {
    const match = (await tx.get(ref)).data();
    if (!match) throw new HttpsError('not-found', 'No such match.');
    if (match.status !== 'open' || match.mode !== 'online') throw new HttpsError('failed-precondition', 'That seat is no longer open.');
    if (match.createdBy === uid) throw new HttpsError('failed-precondition', 'You cannot join your own match.');
    const { scenario } = prepareScenario(match.scenarioId, match.balance);
    requireRuleset(auth, scenario);
    const me = await readUser(tx, uid);
    requireFree(me.data, 'you');
    const empty = Object.entries(match.seats).find(([, s]) => s === null)?.[0];
    if (!empty) throw new HttpsError('failed-precondition', 'That seat is no longer open.');
    const seats: Record<string, Seat | null> = { ...match.seats, [empty]: seat(uid, me.data) };
    if (match.randomSides && match.host) {
      // The draw: the joiner gets a random side, the poster the other.
      const mine = drawSide(scenario);
      seats[mine] = seat(uid, me.data);
      seats[otherSide(scenario, mine)] = match.host;
    }
    tx.update(ref, { seats, playerIds: [...match.playerIds, uid], status: 'active', deadline: firstDeadline(match, scenario), updatedAt: now() });
    tx.update(me.ref, { activeMatchId: ref.id, updatedAt: now() });
  });
  return { matchId: ref.id };
});

/**
 * Whether an active match's recording can no longer be continued under the current rules: its
 * ruleset hash is not the current one, or (the hash covers only which rule modules are installed,
 * not what they do) replaying the recording fails.
 */
async function recordingOutdated(ref: DocumentReference<MatchDoc>, match: MatchDoc): Promise<boolean> {
  if (match.status !== 'active') return false;
  const { scenario, versionHash } = prepareScenario(match.scenarioId, match.balance);
  if (versionHash !== match.rulesetVersionHash) return true;
  const recorded = await ref.collection(COL.actions).orderBy('seq').get();
  const actions = recorded.docs.map((d) => JSON.parse((d.data() as MatchActionDoc).json) as Action);
  if (actions.length !== match.actionCount) return false; // still being written: not a rules problem
  try {
    replay(scenario, await seedOf(ref, match), actions);
    return false;
  } catch {
    return true;
  }
}

/** Concessions/timeouts become official only after half the scenario's player-turns. */
export function hasReachedOfficialThreshold(match: MatchDoc, scenario: ScenarioDef): boolean {
  return reachedOfficialProgress(match.summary, scenario);
}

/**
 * Leave a match. Hotseat: the game is abandoned for good. Open seat: withdrawn. Active online
 * match: a concession, scored for the opponent. A match whose recording no longer replays under
 * the current rules cannot be continued by anyone, so leaving it with `reason: 'ruleset'` voids
 * it instead: no result, no rating change, no abandonment counted against anyone. The server
 * checks the recording itself, so the reason cannot be used to dodge a concession.
 */
export const leaveMatch = onCall(async (req) => {
  const { uid } = requireMember(req);
  const ref = matchRef(requireString(req.data?.matchId, 'matchId'));
  const rulesetReason = req.data?.reason === 'ruleset';
  // Checked before the transaction (it reads the whole recording); the transaction re-reads the match.
  const before = (await ref.get()).data();
  if (!before) throw new HttpsError('not-found', 'No such match.');
  const outdated = rulesetReason || before.mode === 'hotseat' || before.mode === 'computer' ? await recordingOutdated(ref, before) : false;
  if (rulesetReason && !outdated) throw new HttpsError('failed-precondition', 'This match still plays under the current rules; concede it from the board instead.');
  // A live online match's seed comes back onto the document when it ends, whatever the ending.
  const seedBack = usesViews(before) && before.status === 'active' ? { seed: await seedOf(ref, before) } : {};
  // Set inside the transaction (a closure), so it is a holder rather than a narrowed `let`.
  const scored: { value: ReturnType<typeof applyMatchResult> | null } = { value: null };
  const status = await db.runTransaction(async (tx) => {
    const match = (await tx.get(ref)).data();
    if (!match) throw new HttpsError('not-found', 'No such match.');
    if (!match.playerIds.includes(uid)) throw new HttpsError('permission-denied', 'Not your match.');
    const me = await readUser(tx, uid);
    if (match.mode === 'hotseat' || match.mode === 'computer') {
      if (match.status !== 'active') throw new HttpsError('failed-precondition', 'That game is already over.');
      tx.update(ref, { status: 'abandoned', updatedAt: now(), completedAt: now() });
      // A computer game is for fun: walking away from one is nobody's business.
      if (!outdated && match.mode === 'hotseat') tx.update(me.ref, { abandoned: me.data.abandoned + 1, updatedAt: now() });
      return 'abandoned' as const;
    }
    if (match.status === 'open') {
      tx.update(ref, { status: 'cancelled', updatedAt: now(), completedAt: now() });
      tx.update(me.ref, { activeMatchId: null, updatedAt: now() });
      return 'cancelled' as const;
    }
    if (match.status !== 'active') throw new HttpsError('failed-precondition', 'That match is already over.');
    if (outdated) {
      // Void: the recording cannot be continued by anyone, so nobody wins, loses or is penalised.
      // Every player is read before the first write: a transaction may not read after writing.
      const players = await Promise.all(match.playerIds.map((pid) => (pid === uid ? me : readUser(tx, pid))));
      tx.update(ref, { status: 'abandoned', summary: { ...match.summary, toMove: null }, deadline: null, updatedAt: now(), completedAt: now(), ...seedBack });
      for (const player of players) {
        if (player.data.activeMatchId === ref.id) tx.update(player.ref, { activeMatchId: null, updatedAt: now() });
      }
      return 'abandoned' as const;
    }
    const mySide = Object.entries(match.seats).find(([, s]) => s?.uid === uid)![0];
    const opponentUid = match.playerIds.find((p) => p !== uid)!;
    const opponent = await readUser(tx, opponentUid);
    const { scenario } = prepareScenario(match.scenarioId, match.balance);
    if (!hasReachedOfficialThreshold(match, scenario)) {
      tx.update(ref, { status: 'abandoned', official: false, result: null, summary: { ...match.summary, toMove: null }, deadline: null, updatedAt: now(), completedAt: now(), ...seedBack });
      for (const player of [me, opponent]) if (player.data.activeMatchId === ref.id) tx.update(player.ref, { activeMatchId: null, updatedAt: now() });
      return 'abandoned' as const;
    }
    const winner = Object.keys(match.seats).find((s) => s !== mySide) ?? null;
    scored.value = applyMatchResult(tx, ref, match, { [uid]: me, [opponentUid]: opponent }, { winner, reason: 'concession' }, { summary: { ...match.summary, toMove: null }, deadline: null, ...seedBack });
    return 'complete' as const;
  });
  // The report follows from the match document turning complete (`writeAarOnComplete`).
  return { status };
});

/**
 * A finished hotseat (or computer) game is reported by replaying its recorded actions on the
 * server; the result the engine reaches is the one that counts. A computer game is only marked
 * finished: it awards no experience, rating, record or medals.
 */
// A long recording (4000+ events) takes seconds to replay: a full CPU and room beyond the 60 s default.
export const completeHotseatMatch = onCall({ timeoutSeconds: 300, memory: '1GiB' }, async (req) => {
  const { uid } = requireMember(req);
  const ref = matchRef(requireString(req.data?.matchId, 'matchId'));
  const match = (await ref.get()).data();
  if (!match) throw new HttpsError('not-found', 'No such match.');
  if ((match.mode !== 'hotseat' && match.mode !== 'computer') || match.createdBy !== uid) throw new HttpsError('permission-denied', 'Not your game.');
  if (match.status !== 'active') throw new HttpsError('failed-precondition', 'That game is already over.');
  const { scenario, versionHash } = prepareScenario(match.scenarioId, match.balance);
  if (versionHash !== match.rulesetVersionHash) throw new HttpsError('failed-precondition', 'This game was recorded under an older ruleset.', { code: 'ruleset-mismatch' });
  const recorded = await ref.collection(COL.actions).orderBy('seq').get();
  const actions = recorded.docs.map((d) => JSON.parse((d.data() as MatchActionDoc).json) as Action);
  let engine, state;
  try {
    ({ engine, state } = replay(scenario, await seedOf(ref, match), actions));
  } catch (e) {
    throw new HttpsError('failed-precondition', `The recorded game does not replay: ${(e as Error).message}`, { code: 'replay-failed' });
  }
  if (!state.result) throw new HttpsError('failed-precondition', 'The game is not over yet.');
  const result: MatchResult = { winner: state.result.winner, reason: state.result.reason, winnerUid: null, loserUid: null };

  if (match.mode === 'computer') {
    // The record shows who won: the player's uid or the computer's.
    const winnerUid = result.winner ? (match.seats[result.winner]?.uid ?? null) : null;
    const loserUid = result.winner ? (Object.entries(match.seats).find(([side]) => side !== result.winner)?.[1]?.uid ?? null) : null;
    const scoredResult: MatchResult = { ...result, winnerUid, loserUid };
    const isPublic = (match.visibility ?? 'private') === 'public';
    await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(ref)).data();
      if (fresh?.status !== 'active') throw new HttpsError('failed-precondition', 'That game is already over.');
      tx.update(ref, { status: 'complete', result: scoredResult, summary: summaryOf(engine, state), updatedAt: now(), completedAt: now() });
      if (isPublic) {
        // A public game against the computer shows on the record like a friendly: no rating, no Elo.
        const publicResult: PublicMatchResultDoc = {
          matchId: ref.id,
          rulesetId: match.rulesetId ?? 'starter-kit',
          scenarioId: match.scenarioId,
          scenarioTitle: match.scenarioTitle,
          playerIds: match.playerIds,
          players: Object.fromEntries(Object.entries(match.seats).filter((x): x is [string, Seat] => x[1] !== null).map(([side, s]) => [side, { uid: s.uid, nickname: s.displayName }])),
          competition: 'friendly', visibility: 'public', result: scoredResult, official: true, completedAt: now(),
        };
        tx.set(db.collection(COL.publicResults).doc(ref.id), publicResult);
      }
    });
    return { result: scoredResult };
  }

  await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data();
    if (fresh?.status !== 'active') throw new HttpsError('failed-precondition', 'That game is already over.');
    const me = await readUser(tx, uid);
    const after = {
      ...me.data,
      hotseatGames: me.data.hotseatGames + 1,
      xp: me.data.xp + XP.hotseatComplete,
      scenariosCompleted: Array.from(new Set([...me.data.scenariosCompleted, match.scenarioId])),
    };
    const earned = evaluateMedals(after, { mode: 'hotseat', allScenarioIds: CAMPAIGN_SCENARIO_IDS });
    // The recording opens with the report: anyone may read the report, and a signed-in viewer may replay it.
    tx.update(ref, { status: 'complete', visibility: 'public', result, summary: summaryOf(engine, state), updatedAt: now(), completedAt: now() });
    tx.update(me.ref, {
      hotseatGames: after.hotseatGames,
      xp: after.xp,
      scenariosCompleted: after.scenariosCompleted,
      medals: [...me.data.medals, ...earned.map((id) => ({ id, awardedAt: stamp() }))],
      updatedAt: now(),
    });
  });
  return { result };
});

/**
 * Score a finished vs-human match: ratings, records, experience, medals, and both players'
 * busy flags cleared. Call inside a transaction with both players already read. `matchPatch`
 * carries any other fields the match document should take in the same write, including the
 * final summary (the match's own is used when it carries none).
 */
export function applyMatchResult(
  tx: Transaction,
  ref: DocumentReference<MatchDoc>,
  match: MatchDoc,
  players: Record<string, { ref: DocumentReference<UserDoc>; data: UserDoc }>,
  outcome: { winner: string | null; reason: string },
  matchPatch: Partial<MatchDoc> = {},
): { result: MatchResult; players: Record<string, AarPlayer> } {
  const winnerUid = outcome.winner ? (match.seats[outcome.winner]?.uid ?? null) : null;
  const loserUid = winnerUid ? (match.playerIds.find((p) => p !== winnerUid) ?? null) : null;
  const [p1, p2] = match.playerIds as [string, string];
  const a = players[p1]!.data;
  const b = players[p2]!.data;
  const ranked = (match.competition ?? 'ranked') === 'ranked';
  const isPublic = (match.visibility ?? 'public') === 'public';
  const scoreA: 1 | 0.5 | 0 = winnerUid === null ? 0.5 : winnerUid === p1 ? 1 : 0;
  const rating = eloUpdate(a.elo, b.elo, scoreA);
  const result: MatchResult = { winner: outcome.winner, reason: outcome.reason, winnerUid, loserUid, ...(ranked ? { eloDelta: rating.delta } : {}) };
  tx.update(ref, { ...matchPatch, status: 'complete', official: true, result, updatedAt: now(), completedAt: now() });
  // The beta ribbons: the scenario as played, since a balance option can change the game length.
  const { scenario } = prepareScenario(match.scenarioId, match.balance);
  const summary = matchPatch.summary ?? match.summary;
  const beta = ranked && countsForBeta({ mode: match.mode, reason: outcome.reason, turn: summary.turn, attacker: summary.attacker, firstSide: scenario.firstSide, turns: scenario.turns, halfFinalTurn: scenario.halfFinalTurn });

  if (isPublic) {
    const statsRef = db.collection(COL.scenarioStats).doc(`${rulesetOf(scenario)}_${match.scenarioId}`);
    const stats: Record<string, unknown> = {
      rulesetId: rulesetOf(scenario), scenarioId: match.scenarioId, publicPlays: FieldValue.increment(1),
      rankedResults: FieldValue.increment(ranked ? 1 : 0),
      draws: FieldValue.increment(ranked && !outcome.winner ? 1 : 0),
      sideWins: outcome.winner && ranked ? { [outcome.winner]: FieldValue.increment(1) } : {},
      updatedAt: now(),
    };
    tx.set(statsRef, stats, { merge: true });
  }

  if (ranked && isPublic) {
    const publicResult: PublicMatchResultDoc = {
      matchId: ref.id,
      rulesetId: rulesetOf(scenario),
      scenarioId: match.scenarioId,
      scenarioTitle: match.scenarioTitle,
      playerIds: match.playerIds,
      players: Object.fromEntries(Object.entries(match.seats).filter((x): x is [string, Seat] => x[1] !== null).map(([side, s]) => [side, { uid: s.uid, nickname: s.displayName }])),
      competition: 'ranked', visibility: 'public', result, official: true, completedAt: now(),
    };
    tx.set(db.collection(COL.publicResults).doc(ref.id), publicResult);
  }

  for (const [uid, before, elo, opp] of [
    [p1, a, rating.a, b],
    [p2, b, rating.b, a],
  ] as const) {
    const won = winnerUid === uid;
    const lost = loserUid === uid;
    const after: UserDoc = {
      ...before,
      elo: ranked ? elo : before.elo,
      wins: before.wins + (ranked && won ? 1 : 0),
      losses: before.losses + (ranked && lost ? 1 : 0),
      draws: before.draws + (ranked && winnerUid === null ? 1 : 0),
      onlineGames: before.onlineGames + 1,
      streak: ranked ? (won ? before.streak + 1 : 0) : before.streak,
      xp: before.xp + (won ? XP.onlineWin : lost ? XP.onlineLoss : XP.onlineDraw),
      // A game that ended by concession or on the clock was not played to its finish.
      scenariosCompleted: outcome.reason === 'concession' || outcome.reason === 'timeout' ? before.scenariosCompleted : Array.from(new Set([...before.scenariosCompleted, match.scenarioId])),
      betaScenarios: beta ? Array.from(new Set([...(before.betaScenarios ?? []), match.scenarioId])) : (before.betaScenarios ?? []),
      activeMatchId: null,
    };
    const earned = ranked ? evaluateMedals(after, { mode: 'online', won, lost, opponentElo: opp.elo, ownEloBefore: before.elo, allScenarioIds: CAMPAIGN_SCENARIO_IDS }) : [];
    const { email: _e, gravatarHash: _g, displayName: _d, photoURL: _p, createdAt: _c, lastSeenAt: _l, medals, ...stats } = after;
    tx.update(players[uid]!.ref, { ...stats, medals: [...medals, ...earned.map((id) => ({ id, awardedAt: stamp() }))], updatedAt: now() });
    tx.set(db.collection(COL.publicProfiles).doc(uid), {
      xp: after.xp,
      elo: after.elo,
      wins: after.wins,
      losses: after.losses,
      draws: after.draws,
      medals: [...medals, ...earned.map((id) => ({ id, awardedAt: stamp() }))],
      updatedAt: now(),
    }, { merge: true });
  }
  return { result, players: aarPlayers(match, result, { [p1]: a.elo, [p2]: b.elo }) };
}
