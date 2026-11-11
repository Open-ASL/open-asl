/**
 * Firestore side of the per-viewer views (see `views.ts` for the pure part): where the seed lives while a match is
 * live, and how a transaction writes, rewinds and seeds the view documents.
 */
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { Engine, GameInit, GameState, LoggedEvent, SideId } from '@asl/engine';
import { redactState, type ScenarioDef } from '@asl/rules';
import { newSk1Game } from '@asl/content';
import { COL, actionDocId, type MatchDoc, type ViewDoc, type ViewStepDoc } from '@asl/platform';
import { now } from './app';
import { snapshotsOf, viewersOf, type ViewSnapshot, type ViewStep } from './views';

/** `private/game`: the seed of a live online match under the views model. */
interface PrivateGameDoc {
  seed: string;
}

const privateGame = (ref: DocumentReference<MatchDoc>) => ref.collection(COL.private).doc('game') as DocumentReference<PrivateGameDoc>;

/**
 * The seed of a match: on the document for hotseat/computer games, legacy online matches and finished ones;
 * in `private/game` while an online match under the views model is live.
 */
export async function seedOf(ref: DocumentReference<MatchDoc>, match: Pick<MatchDoc, 'seed'>): Promise<string> {
  if (match.seed) return match.seed;
  const priv = (await privateGame(ref).get()).data();
  if (!priv) throw new Error(`Match ${ref.id} has no seed`);
  return priv.seed;
}

/** Keep the seed where no client reads it (a new online match). */
export function writePrivateSeed(tx: Transaction, ref: DocumentReference<MatchDoc>, seed: string) {
  tx.set(privateGame(ref), { seed });
}

export function writeSnapshots(tx: Transaction, ref: DocumentReference<MatchDoc>, snapshots: ViewSnapshot[]) {
  for (const s of snapshots) {
    const doc: ViewDoc = { seq: s.seq, eventSeq: s.eventSeq, side: s.side, json: JSON.stringify(s.state), at: now() };
    tx.set(ref.collection(COL.views).doc(s.viewer), doc);
  }
}

export function writeSteps(tx: Transaction, ref: DocumentReference<MatchDoc>, steps: ViewStep[]) {
  for (const st of steps) {
    const doc: ViewStepDoc = { seq: st.seq, side: st.side, json: JSON.stringify(st.events), at: now() };
    tx.set(ref.collection(COL.views).doc(st.viewer).collection(COL.steps).doc(actionDocId(st.seq)), doc);
  }
}

/** The opening position for every viewer (seq 0), and the game's creation events as step 0 (the log's first lines). */
export function writeInitialViews(tx: Transaction, ref: DocumentReference<MatchDoc>, engine: Engine, game: { init: GameInit; state: GameState; events: LoggedEvent[] }, viewers: { viewer: string; side: SideId | null }[]) {
  writeSnapshots(tx, ref, snapshotsOf(engine, game.state, 0, viewers));
  const start = engine.initialState(game.init);
  writeSteps(tx, ref, viewers.map(({ viewer, side }) => ({ viewer, seq: 0, side: game.state.attacker, events: engine.redactTransition(side, (s) => redactState(engine, s, side), start, game.events) })));
}

/**
 * A new online match under the views model: the seed goes to `private/game` and every viewer gets the opening
 * position. The match document itself carries no seed (see `forViews`).
 */
export function seedNewOnlineMatch(tx: Transaction, ref: DocumentReference<MatchDoc>, scenario: ScenarioDef, seed: string, match: Pick<MatchDoc, 'visibility'>) {
  writePrivateSeed(tx, ref, seed);
  const g = newSk1Game(scenario, seed);
  writeInitialViews(tx, ref, g.engine, g, viewersOf(match, g.state.sides));
}

/** An allowed undo: the step of the action taken back goes, and every snapshot returns to the position before it. */
export function rewindViews(tx: Transaction, ref: DocumentReference<MatchDoc>, undoneSeq: number, snapshots: ViewSnapshot[]) {
  for (const s of snapshots) tx.delete(ref.collection(COL.views).doc(s.viewer).collection(COL.steps).doc(actionDocId(undoneSeq)));
  writeSnapshots(tx, ref, snapshots);
}
