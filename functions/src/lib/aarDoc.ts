import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Action } from '@asl/engine';
import { buildAar, type AarMeta } from '@asl/aar';
import { COL, COMPUTER_UID, type AarDoc, type AarPlayer, type MatchActionDoc, type MatchDoc, type MatchResult, type Seat } from '@asl/platform';
import { prepareScenario } from './scenarios';

/*
 * The after action report of a completed match, built from its recording. Shared by the Cloud
 * Functions (`writeAar`) and an admin backfill, so it takes the Firestore handle and
 * never initialises the Functions app itself.
 */

const toMillis = (at: unknown): number | null => (typeof (at as { toMillis?: () => number })?.toMillis === 'function' ? (at as { toMillis: () => number }).toMillis() : null);

/** The players of a match by side, from its seats: the computer's seat is marked as such. */
export function aarPlayers(match: Pick<MatchDoc, 'seats'>, result: MatchResult | null, elo: Record<string, number> = {}): Record<string, AarPlayer> {
  const out: Record<string, AarPlayer> = {};
  for (const [side, seat] of Object.entries(match.seats) as [string, Seat | null][]) {
    if (!seat) continue;
    const player: AarPlayer = { uid: seat.uid, nickname: seat.displayName };
    if (seat.uid === COMPUTER_UID) player.computer = true;
    if (elo[seat.uid] !== undefined) player.elo = elo[seat.uid];
    if (result?.eloDelta) player.eloDelta = result.winner === null ? 0 : result.winner === side ? result.eloDelta : -result.eloDelta;
    out[side] = player;
  }
  return out;
}

/**
 * Whether a match document update is the moment its report becomes due: it has just turned complete with a result
 * and is public (hotseat games are made public as they complete; a private online or computer game gets none).
 */
export function aarDue(before: Pick<MatchDoc, 'status'> | undefined, after: Pick<MatchDoc, 'status' | 'result' | 'visibility'> | undefined): boolean {
  if (!after || after.status !== 'complete' || !after.result) return false;
  if (before?.status === 'complete') return false;
  return (after.visibility ?? 'public') === 'public';
}

/** The players' Elo after the game, for a ranked report (`AarPlayer.elo`); nothing for the computer's seat. */
export async function aarElo(db: Firestore, match: Pick<MatchDoc, 'playerIds' | 'competition'>): Promise<Record<string, number>> {
  if (match.competition !== 'ranked') return {};
  const out: Record<string, number> = {};
  for (const uid of match.playerIds) {
    if (uid === COMPUTER_UID) continue;
    const elo = ((await db.collection(COL.users).doc(uid).get()).data() as { elo?: number } | undefined)?.elo;
    if (typeof elo === 'number') out[uid] = elo;
  }
  return out;
}

/** The report of matches/{matchId}, or null when the match is not complete. */
export async function composeAar(db: Firestore, matchId: string, players: Record<string, AarPlayer>): Promise<AarDoc | null> {
  const ref = db.collection(COL.matches).doc(matchId);
  const match = (await ref.get()).data() as MatchDoc | undefined;
  if (!match || match.status !== 'complete' || !match.result) return null;
  const { scenario } = prepareScenario(match.scenarioId, match.balance);
  const recorded = await ref.collection(COL.actions).orderBy('seq').get();
  const docs = recorded.docs.map((d) => d.data() as MatchActionDoc);
  const actions = docs.map((d) => JSON.parse(d.json) as Action);
  const first = toMillis(docs[0]?.at);
  const last = toMillis(docs.at(-1)?.at);
  const durationMin = first !== null && last !== null && last > first ? Math.round((last - first) / 60_000) : null;
  const meta: AarMeta = {
    matchId,
    mode: match.mode,
    competition: match.competition ?? 'ranked',
    players,
    result: { winner: match.result.winner, reason: match.result.reason },
    playedAt: match.completedAt ?? Timestamp.now(),
    createdAt: Timestamp.now(),
    durationMin,
  };
  // A finished views-model match has its seed written back; if the report is composed before that, `private/game` has it.
  const seed = match.seed ?? ((await ref.collection(COL.private).doc('game').get()).data() as { seed?: string } | undefined)?.seed;
  if (!seed) return null;
  return buildAar(scenario, seed, actions, meta);
}
