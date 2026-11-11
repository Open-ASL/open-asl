/**
 * Fill a player's service record with ranked results against the emulator, scored exactly as the
 * server scores a finished online match (Elo, record, experience, medals, scenario records):
 *   pnpm tsx scripts/seed-results.ts alice@example.com 48 carol@example.com probe7502@example.com
 * The first email is the player, the number how many results, the rest the opponents (seeded
 * accounts with public profiles). Results are spread over the last ~100 days and tagged
 * `seeded: true`. Run while `pnpm dev` is up. Emulator only: it writes stats directly.
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { COL, XP, countsForBeta, eloUpdate, evaluateMedals, type AwardedMedal, type MatchResult, type PublicProfileDoc, type UserDoc } from '../packages/platform/src/index.ts';
import { SCENARIO_CATALOG, scenarioById } from '../packages/content/src/index.ts';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.GCLOUD_PROJECT ??= 'demo-asl-web';

const [playerEmail = 'alice@example.com', countArg = '48', ...opponentEmails] = process.argv.slice(2);
const count = Number(countArg);
if (!opponentEmails.length) opponentEmails.push('carol@example.com', 'probe7502@example.com');

initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = getFirestore();
const auth = getAuth();

// Deterministic so a re-run after a reset gives the same record.
let seed = 20261102;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

interface Player { uid: string; user: UserDoc; profile: PublicProfileDoc; medals: AwardedMedal[] }
async function load(email: string): Promise<Player> {
  const { uid } = await auth.getUserByEmail(email);
  const user = (await db.collection(COL.users).doc(uid).get()).data() as UserDoc | undefined;
  const profile = (await db.collection(COL.publicProfiles).doc(uid).get()).data() as PublicProfileDoc | undefined;
  if (!user || !profile) throw new Error(`${email}: needs an account and a public profile (open the Lobby once as them)`);
  return { uid, user, profile, medals: [...user.medals] };
}
const me = await load(playerEmail);
const opponents = await Promise.all(opponentEmails.map(load));
// Mirrors functions/src/lib/scenarios.ts: the campaign ribbon counts the SK1 scenarios.
const CAMPAIGN_SCENARIO_IDS = SCENARIO_CATALOG.filter((s) => s.product === 'sk1').map((s) => s.id);
const playable = SCENARIO_CATALOG.filter((s) => s.playable && s.rulesetId === 'starter-kit').map((s) => scenarioById(s.id)!).filter(Boolean);
const REASONS: Array<[string, number]> = [['scenario end', 0.58], ['concession', 0.17], ['annihilation', 0.1], ['sudden death', 0.08], ['timeout', 0.07]];
const reasonFor = () => { let r = rand(); for (const [reason, p] of REASONS) { if ((r -= p) <= 0) return reason; } return 'scenario end'; };

const batch = db.batch();
const statsPatch = new Map<string, { plays: number; ranked: number; draws: number; sideWins: Record<string, number> }>();
const DAY = 86_400_000;
let when = Date.now() - 100 * DAY;
for (let i = 0; i < count; i++) {
  when += (100 * DAY) / count * (0.4 + 1.2 * rand());
  const at = Timestamp.fromMillis(Math.min(when, Date.now() - DAY));
  const opp = pick(opponents);
  const scenario = pick(playable);
  const [mySide, theirSide] = rand() < 0.5 ? [scenario.sides[0]!.side, scenario.sides[1]!.side] : [scenario.sides[1]!.side, scenario.sides[0]!.side];
  const roll = rand();
  const winner = roll < 0.58 ? mySide : roll < 0.65 ? null : theirSide;
  const reason = winner === null ? 'scenario end' : reasonFor();
  const scoreMe: 1 | 0.5 | 0 = winner === null ? 0.5 : winner === mySide ? 1 : 0;
  const rating = eloUpdate(me.user.elo, opp.user.elo, scoreMe);
  const winnerUid = winner === null ? null : winner === mySide ? me.uid : opp.uid;
  const loserUid = winnerUid === null ? null : winnerUid === me.uid ? opp.uid : me.uid;
  const result: MatchResult = { winner, reason, winnerUid, loserUid, eloDelta: rating.delta };
  const matchId = `seed-${me.uid.slice(0, 5)}-${String(i + 1).padStart(3, '0')}`;
  batch.set(db.collection(COL.publicResults).doc(matchId), {
    matchId, rulesetId: 'starter-kit', scenarioId: scenario.id, scenarioTitle: scenario.title, playerIds: [me.uid, opp.uid],
    players: { [mySide]: { uid: me.uid, nickname: me.profile.nickname }, [theirSide]: { uid: opp.uid, nickname: opp.profile.nickname } },
    competition: 'ranked', visibility: 'public', result, official: true, completedAt: at, seeded: true,
  });
  const st = statsPatch.get(scenario.id) ?? { plays: 0, ranked: 0, draws: 0, sideWins: {} };
  st.plays++; st.ranked++; if (winner === null) st.draws++; else st.sideWins[winner] = (st.sideWins[winner] ?? 0) + 1;
  statsPatch.set(scenario.id, st);
  const beta = countsForBeta({ mode: 'online', reason, turn: scenario.turns, attacker: scenario.firstSide, firstSide: scenario.firstSide, turns: scenario.turns, halfFinalTurn: scenario.halfFinalTurn }, at.toMillis());
  for (const [p, elo, other] of [[me, rating.a, opp], [opp, rating.b, me]] as const) {
    const won = winnerUid === p.uid; const lost = loserUid === p.uid;
    const before = p.user;
    const after: UserDoc = {
      ...before, elo, wins: before.wins + (won ? 1 : 0), losses: before.losses + (lost ? 1 : 0), draws: before.draws + (winnerUid === null ? 1 : 0),
      onlineGames: before.onlineGames + 1, streak: won ? before.streak + 1 : 0, xp: before.xp + (won ? XP.onlineWin : lost ? XP.onlineLoss : XP.onlineDraw),
      scenariosCompleted: reason === 'concession' || reason === 'timeout' ? before.scenariosCompleted : Array.from(new Set([...before.scenariosCompleted, scenario.id])),
      betaScenarios: beta ? Array.from(new Set([...(before.betaScenarios ?? []), scenario.id])) : (before.betaScenarios ?? []),
      medals: p.medals,
    };
    const earned = evaluateMedals(after, { mode: 'online', won, lost, opponentElo: other.user.elo, ownEloBefore: before.elo, allScenarioIds: CAMPAIGN_SCENARIO_IDS });
    p.medals.push(...earned.map((id) => ({ id, awardedAt: at })));
    p.user = { ...after, medals: p.medals };
  }
}
for (const [scenarioId, st] of statsPatch) {
  batch.set(db.collection(COL.scenarioStats).doc(`starter-kit_${scenarioId}`), {
    rulesetId: 'starter-kit', scenarioId, publicPlays: FieldValue.increment(st.plays), rankedResults: FieldValue.increment(st.ranked), draws: FieldValue.increment(st.draws),
    sideWins: Object.fromEntries(Object.entries(st.sideWins).map(([side, n]) => [side, FieldValue.increment(n)])), updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}
for (const p of [me, ...opponents]) {
  const { email: _e, gravatarHash: _g, displayName: _d, photoURL: _p, createdAt: _c, lastSeenAt: _l, ...stats } = p.user;
  batch.update(db.collection(COL.users).doc(p.uid), { ...stats, updatedAt: FieldValue.serverTimestamp() });
  batch.set(db.collection(COL.publicProfiles).doc(p.uid), { xp: p.user.xp, elo: p.user.elo, wins: p.user.wins, losses: p.user.losses, draws: p.user.draws, medals: p.user.medals, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}
await batch.commit();
for (const p of [me, ...opponents]) console.log(`${p.profile.nickname}: ${p.user.wins}–${p.user.losses}–${p.user.draws}, Elo ${p.user.elo}, XP ${p.user.xp}, medals ${p.user.medals.map((m) => m.id).join(', ') || 'none'}`);
console.log(`${count} ranked results written for ${me.profile.nickname}`);
