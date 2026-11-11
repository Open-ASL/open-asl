import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { RuleError, type Action, type Engine, type GameState } from '@asl/engine';
import type { ScenarioDef } from '@asl/rules';
import { COL, actionDocId, type MatchActionDoc, type MatchDoc, type MatchResult } from '@asl/platform';
import { db, now } from './lib/app';
import { snapshotsOf, stepsOf, usesViews, viewersOf, type ViewStep } from './lib/views';
import { rewindViews, seedOf, writeSnapshots, writeSteps } from './lib/viewStore';
import { deadlineAfter, deadlinePassed } from './lib/clock';
import { requireMember, requireString } from './lib/auth';
import { otherSide, prepareScenario, replay, summaryOf } from './lib/scenarios';
import { readUser } from './lib/users';
import { applyMatchResult, hasReachedOfficialThreshold, matchRef } from './matches';

/**
 * Positions already replayed by this instance, keyed by match id. A position is only trusted
 * while the match document still reports the same action count, which the transaction checks.
 */
const positions = new Map<string, { count: number; seed: string; engine: Engine; state: GameState }>();
const POSITION_CACHE = 64;

function remember(matchId: string, pos: { count: number; seed: string; engine: Engine; state: GameState }) {
  positions.delete(matchId);
  positions.set(matchId, pos);
  if (positions.size > POSITION_CACHE) positions.delete(positions.keys().next().value!);
}

/** The current position of a match: from the cache when it is still current, else replayed from the recording. */
async function position(matchId: string, match: MatchDoc) {
  const cached = positions.get(matchId);
  if (cached && cached.count === match.actionCount) return cached;
  const { scenario, versionHash } = prepareScenario(match.scenarioId, match.balance);
  if (versionHash !== match.rulesetVersionHash) throw new HttpsError('failed-precondition', 'This match was started under an older ruleset.', { code: 'ruleset-mismatch' });
  const actions = await recording(matchId, match);
  const seed = await seedOf(matchRef(matchId), match);
  const pos = { count: actions.length, seed, ...replayed(scenario, seed, actions) };
  remember(matchId, pos);
  return pos;
}

/** The recorded actions of a match, checked against its action count. */
async function recording(matchId: string, match: MatchDoc): Promise<Action[]> {
  const recorded = await matchRef(matchId).collection(COL.actions).orderBy('seq').get();
  const actions = recorded.docs.map((d) => JSON.parse((d.data() as MatchActionDoc).json) as Action);
  if (actions.length !== match.actionCount) throw new HttpsError('aborted', 'The recording is being written; try again.', { code: 'stale' });
  return actions;
}

function replayed(scenario: ScenarioDef, seed: string, actions: Action[]) {
  try {
    return replay(scenario, seed, actions);
  } catch (e) {
    throw new HttpsError('failed-precondition', `The recorded game does not replay: ${(e as Error).message}`, { code: 'replay-failed' });
  }
}

async function activeMatch(matchId: string): Promise<MatchDoc> {
  const match = (await matchRef(matchId).get()).data();
  if (!match) throw new HttpsError('not-found', 'No such match.');
  if (match.mode !== 'online') throw new HttpsError('failed-precondition', 'Only online matches are played through the server.');
  if (match.status !== 'active') throw new HttpsError('failed-precondition', match.status === 'open' ? 'The other seat is still empty.' : 'That match is over.');
  return match;
}

/**
 * Play one action from the recorded position: the engine referees it, the recording grows by
 * one, the lobby summary and the clock are refreshed, and a finished game is scored in the same
 * transaction. `before` is the match as read just before; the commit requires it unchanged.
 */
async function playAction(matchId: string, before: MatchDoc, pos: { seed: string; engine: Engine; state: GameState }, action: Record<string, unknown>) {
  const ref = matchRef(matchId);
  const decision = pos.engine.currentDecision(pos.state);
  if (!decision) throw new HttpsError('failed-precondition', 'The game is over.');
  const full: Action = { ...action, type: String(action['type']), side: decision.owner, decisionId: decision.id };
  let next;
  try {
    next = pos.engine.submit(pos.state, full);
  } catch (e) {
    if (e instanceof RuleError) throw new HttpsError('invalid-argument', e.message, { code: 'illegal' });
    throw e;
  }
  const seq = before.actionCount + 1;
  const summary = summaryOf(pos.engine, next.state);
  const deadline = deadlineAfter(before, pos.engine, next.state, seq);
  // The views model: what each viewer gets of this action, built outside the transaction like the position.
  const views = usesViews(before) ? stepsOf(pos.engine, pos.state, next, seq, decision.owner, viewersOf(before, next.state.sides)) : null;

  const scored = await db.runTransaction(async (tx) => {
    const match = (await tx.get(ref)).data();
    if (!match || match.status !== 'active') throw new HttpsError('failed-precondition', 'That match is over.');
    if (match.actionCount !== before.actionCount) throw new HttpsError('failed-precondition', 'The position has moved on; your board is being refreshed.', { code: 'stale' });
    const actionDoc: MatchActionDoc = { seq, json: JSON.stringify(full), at: now() };
    if (next.state.result) {
      const [p1, p2] = match.playerIds as [string, string];
      const players = { [p1]: await readUser(tx, p1), [p2]: await readUser(tx, p2) };
      tx.set(ref.collection(COL.actions).doc(actionDocId(seq)), actionDoc);
      if (views) {
        writeSnapshots(tx, ref, views.snapshots);
        writeSteps(tx, ref, views.steps);
      }
      // A finished match opens its recording: the seed comes back onto the document for replays and the report.
      return applyMatchResult(tx, ref, match, players, next.state.result, { summary, actionCount: seq, deadline: null, ...(views ? { seed: pos.seed } : {}) });
    }
    tx.set(ref.collection(COL.actions).doc(actionDocId(seq)), actionDoc);
    if (views) {
      writeSnapshots(tx, ref, views.snapshots);
      writeSteps(tx, ref, views.steps);
    }
    tx.update(ref, { summary, actionCount: seq, deadline, undo: null, updatedAt: now() });
    return null;
  });
  remember(matchId, { count: seq, seed: pos.seed, engine: pos.engine, state: next.state });
  // The report follows from the match document turning complete (`writeAarOnComplete`); the player already sees the result on their own board.
  return { seq, result: scored ? (scored.result satisfies MatchResult) : null, steps: views?.steps ?? null, snapshots: views?.snapshots ?? null };
}

/**
 * submitAction: the server plays the action for the seated player whose decision it is. The
 * action must answer the current decision and be legal from the recorded position.
 */
export const submitAction = onCall({ minInstances: 1 }, async (req) => {
  const { uid } = requireMember(req);
  const matchId = requireString(req.data?.matchId, 'matchId');
  const seq = req.data?.seq;
  const action = req.data?.action;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) throw new HttpsError('invalid-argument', 'seq must be a positive integer.');
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') throw new HttpsError('invalid-argument', 'action must be an object with a type.');

  // The position is built outside the transaction (it may mean a long replay); the transaction
  // then only commits if the match is still at that action count.
  const before = await activeMatch(matchId);
  if (!before.playerIds.includes(uid)) throw new HttpsError('permission-denied', 'You are not seated at this table.');
  if (seq !== before.actionCount + 1) throw new HttpsError('failed-precondition', 'The position has moved on; your board is being refreshed.', { code: 'stale' });
  const pos = await position(matchId, before);
  const decision = pos.engine.currentDecision(pos.state);
  if (!decision) throw new HttpsError('failed-precondition', 'The game is over.');
  if (before.seats[decision.owner]?.uid !== uid) throw new HttpsError('failed-precondition', 'It is not your decision.', { code: 'not-your-turn' });
  const played = await playAction(matchId, before, pos, action as Record<string, unknown>);
  // The caller's own view of the result, so their board moves on without waiting for the listener.
  const mine = (list: { viewer: string }[] | null) => list?.find((v) => v.viewer === decision.owner);
  const snapshot = mine(played.snapshots) as { state: GameState } | undefined;
  const step = mine(played.steps) as ViewStep | undefined;
  return { seq: played.seq, result: played.result, ...(snapshot && step ? { step: { seq: played.seq, stateJson: JSON.stringify(snapshot.state), eventsJson: JSON.stringify(step.events) } } : {}) };
});

/**
 * Act on a lapsed clock, at the waiting opponent's request. A lapsed clock does nothing by itself:
 * a friendly game may take months between moves. The opponent may claim the win, or, when the
 * lapsed decision is a first-fire call, pass it on the defender's behalf and play on.
 */
async function enforceTimeout(matchId: string, match: MatchDoc, uid: string, outcome: 'pass' | 'forfeit'): Promise<'passed' | 'forfeit'> {
  const deadline = match.deadline;
  if (!deadline || !deadlinePassed(deadline)) throw new HttpsError('failed-precondition', 'The clock has not run out.', { code: 'not-expired' });
  if (deadline.seq !== match.actionCount) throw new HttpsError('failed-precondition', 'The position has moved on.', { code: 'stale' });
  const claimant = Object.entries(match.seats).find(([, s]) => s?.uid === uid)?.[0];
  if (!claimant || claimant === deadline.side) throw new HttpsError('permission-denied', 'Only the waiting opponent can act on a lapsed clock.');
  const pos = await position(matchId, match);
  const decision = pos.engine.currentDecision(pos.state);
  if (!decision || decision.owner !== deadline.side) throw new HttpsError('failed-precondition', 'The position has moved on.', { code: 'stale' });

  if (outcome === 'pass') {
    // The only interrupt is the defender's first-fire call; the opponent may let it lapse as a pass.
    if (decision.deadlineClass !== 'interrupt') throw new HttpsError('failed-precondition', 'Only a first-fire call can be passed for the other side.');
    await playAction(matchId, match, pos, { type: 'defPass' });
    return 'passed';
  }
  const { scenario } = prepareScenario(match.scenarioId, match.balance);
  const ref = matchRef(matchId);
  const seedBack = usesViews(match) ? { seed: pos.seed } : {};
  const scored = await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data();
    if (!fresh || fresh.status !== 'active' || fresh.actionCount !== match.actionCount) throw new HttpsError('failed-precondition', 'The position has moved on.', { code: 'stale' });
    const [p1, p2] = fresh.playerIds as [string, string];
    const players = { [p1]: await readUser(tx, p1), [p2]: await readUser(tx, p2) };
    if (!hasReachedOfficialThreshold(fresh, scenario)) {
      tx.update(ref, { status: 'abandoned', official: false, result: null, summary: { ...fresh.summary, toMove: null }, deadline: null, updatedAt: now(), completedAt: now(), ...seedBack });
      for (const player of Object.values(players)) if (player.data.activeMatchId === ref.id) tx.update(player.ref, { activeMatchId: null, updatedAt: now() });
      return null;
    }
    return applyMatchResult(tx, ref, fresh, players, { winner: otherSide(scenario, deadline.side), reason: 'timeout' }, { summary: { ...fresh.summary, toMove: null }, deadline: null, ...seedBack });
  });
  return 'forfeit';
}

/**
 * claimTimeout: the seated opponent of a player whose clock has run out claims the win, or
 * (`outcome: 'pass'`) passes a lapsed first-fire call for them. Nothing else ever acts on a clock.
 */
export const claimTimeout = onCall(async (req) => {
  const { uid } = requireMember(req);
  const matchId = requireString(req.data?.matchId, 'matchId');
  const outcome = req.data?.outcome === 'pass' ? 'pass' : 'forfeit';
  const match = await activeMatch(matchId);
  return { outcome: await enforceTimeout(matchId, match, uid, outcome) };
});

/** The seat a member holds at this match, or a refusal. */
function seatOf(match: MatchDoc, uid: string): string {
  const side = Object.entries(match.seats).find(([, s]) => s?.uid === uid)?.[0];
  if (!side) throw new HttpsError('permission-denied', 'You are not seated at this table.');
  return side;
}

/**
 * requestUndo: a seated player asks the opponent to take back the last recorded action, which
 * must be their own. A refused request stands while the match is still at that action.
 */
export const requestUndo = onCall(async (req) => {
  const { uid } = requireMember(req);
  const matchId = requireString(req.data?.matchId, 'matchId');
  const seq = req.data?.seq;
  const before = await activeMatch(matchId);
  const side = seatOf(before, uid);
  if (seq !== before.actionCount || seq < 1) throw new HttpsError('failed-precondition', 'The position has moved on.', { code: 'stale' });
  const actions = await recording(matchId, before);
  if (actions[actions.length - 1]?.side !== side) throw new HttpsError('failed-precondition', 'Only your own last action can be taken back, before the other side has answered it.');
  const id = `${seq}-${Date.now()}`;
  const ref = matchRef(matchId);
  await db.runTransaction(async (tx) => {
    const match = (await tx.get(ref)).data();
    if (!match || match.status !== 'active' || match.actionCount !== seq) throw new HttpsError('failed-precondition', 'The position has moved on.', { code: 'stale' });
    const undo = match.undo;
    if (undo?.status === 'pending') throw new HttpsError('failed-precondition', 'An undo is already waiting for an answer.');
    if (undo?.status === 'refused' && undo.side === side && undo.seq === seq) throw new HttpsError('failed-precondition', 'Your opponent refused to take this action back.', { code: 'refused' });
    tx.update(ref, { undo: { id, side, seq, status: 'pending', at: now() }, updatedAt: now() });
  });
  return { id };
});

/** cancelUndo: the asker withdraws a pending request and plays on. */
export const cancelUndo = onCall(async (req) => {
  const { uid } = requireMember(req);
  const matchId = requireString(req.data?.matchId, 'matchId');
  const ref = matchRef(matchId);
  await db.runTransaction(async (tx) => {
    const match = (await tx.get(ref)).data();
    if (!match) throw new HttpsError('not-found', 'No such match.');
    const side = seatOf(match, uid);
    if (match.undo?.status === 'pending' && match.undo.side === side) tx.update(ref, { undo: null, updatedAt: now() });
  });
});

/**
 * answerUndo: the opponent allows or refuses a pending request. Allowing it removes the action
 * from the recording; the clock restarts on the decision it goes back to.
 */
export const answerUndo = onCall(async (req) => {
  const { uid } = requireMember(req);
  const matchId = requireString(req.data?.matchId, 'matchId');
  const id = requireString(req.data?.id, 'id');
  const allow = req.data?.allow === true;
  const before = await activeMatch(matchId);
  const side = seatOf(before, uid);
  const undo = before.undo;
  if (!undo || undo.id !== id || undo.status !== 'pending') throw new HttpsError('failed-precondition', 'That request has been withdrawn.', { code: 'stale' });
  if (undo.side === side) throw new HttpsError('failed-precondition', 'Your opponent answers your request.');
  const ref = matchRef(matchId);

  // The position to go back to is built outside the transaction, like an action's.
  let back: { engine: Engine; state: GameState } | null = null;
  const seed = await seedOf(ref, before);
  if (allow) {
    const actions = await recording(matchId, before);
    const { scenario } = prepareScenario(before.scenarioId, before.balance);
    back = replayed(scenario, seed, actions.slice(0, -1));
  }
  await db.runTransaction(async (tx) => {
    const match = (await tx.get(ref)).data();
    if (!match || match.status !== 'active' || match.actionCount !== undo.seq || match.undo?.id !== id || match.undo.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'That request has been withdrawn.', { code: 'stale' });
    }
    if (!back) {
      tx.update(ref, { undo: { ...match.undo, status: 'refused' }, updatedAt: now() });
      return;
    }
    const seq = undo.seq - 1;
    tx.delete(ref.collection(COL.actions).doc(actionDocId(undo.seq)));
    if (usesViews(match)) rewindViews(tx, ref, undo.seq, snapshotsOf(back.engine, back.state, seq, viewersOf(match, back.state.sides)));
    tx.update(ref, { summary: summaryOf(back.engine, back.state), actionCount: seq, deadline: deadlineAfter(match, back.engine, back.state, seq), undo: { ...match.undo, status: 'allowed' }, updatedAt: now() });
  });
  positions.delete(matchId);
  if (back) remember(matchId, { count: undo.seq - 1, seed, ...back });
  return { undone: allow };
});
