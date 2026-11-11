/**
 * Stage a presentation-ready lobby in the local emulators.
 *
 *   pnpm demo:lobby          # seed, then keep Alice visibly online
 *   pnpm demo:lobby --once   # seed and exit (presence expires after three minutes)
 *
 * The document ids are stable, so rerunning this refreshes the dates instead of
 * duplicating results, posts, or chat messages.
 */
import { createHash } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { SCENARIO_CATALOG, scenarioById } from '../packages/content/src/index.ts';
import {
  COL,
  type AwardedMedal,
  type GameListingDoc,
  type MedalId,
  type PublicProfileDoc,
  type UserDoc,
} from '../packages/platform/src/index.ts';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.FIREBASE_DATABASE_EMULATOR_HOST ??= '127.0.0.1:9000';
process.env.GCLOUD_PROJECT ??= 'demo-asl-web';

const projectId = process.env.GCLOUD_PROJECT;
initializeApp({
  projectId,
  databaseURL: `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${projectId}-default-rtdb`,
});
const auth = getAuth();
const db = getFirestore();
const realtime = getDatabase();

const DAY = 24 * 60 * 60_000;
const now = Date.now();
const stamp = (millis: number) => Timestamp.fromMillis(millis);
const gravatar = (email: string) => createHash('sha256').update(email).digest('hex');

interface DemoPlayer {
  auth: UserRecord;
  nickname: string;
  normalized: string;
}

async function account(email: string, nickname: string): Promise<DemoPlayer> {
  let record: UserRecord;
  try {
    record = await auth.getUserByEmail(email);
    if (record.displayName !== nickname)
      record = await auth.updateUser(record.uid, { displayName: nickname });
  } catch {
    record = await auth.createUser({
      email,
      password: 'password',
      emailVerified: true,
      displayName: nickname,
    });
  }
  await auth.setCustomUserClaims(record.uid, { ...(record.customClaims ?? {}), member: true });
  return { auth: record, nickname, normalized: nickname.toLowerCase() };
}

function baseUser(player: DemoPlayer): UserDoc {
  const email = player.auth.email!;
  return {
    email,
    gravatarHash: gravatar(email),
    displayName: player.nickname,
    photoURL: player.auth.photoURL ?? null,
    xp: 0,
    elo: 1200,
    wins: 0,
    losses: 0,
    draws: 0,
    onlineGames: 0,
    hotseatGames: 0,
    abandoned: 0,
    streak: 0,
    medals: [],
    scenariosCompleted: [],
    betaScenarios: [],
    activeMatchId: null,
    createdAt: stamp(now - 420 * DAY),
    lastSeenAt: stamp(now),
    updatedAt: stamp(now),
  };
}

function publicProfile(
  player: DemoPlayer,
  stats: Pick<UserDoc, 'xp' | 'elo' | 'wins' | 'losses' | 'draws' | 'medals'>,
  description: string,
  location: string,
): PublicProfileDoc {
  return {
    uid: player.auth.uid,
    nickname: player.nickname,
    nicknameNormalized: player.normalized,
    photoURL: player.auth.photoURL ?? null,
    description,
    location,
    language: 'en',
    ...stats,
    createdAt: stamp(now - 420 * DAY),
    updatedAt: stamp(now),
  };
}

function localFuture(days: number, hour: number, minute = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

const alice = await account('alice@example.com', 'AliceVanguard');
const carol = await account('carol@example.com', 'CarolSends');
const probe = await account('probe7502@example.com', 'HexAndCounter');

const playable = SCENARIO_CATALOG.filter((entry) => entry.playable && entry.rulesetId === 'starter-kit')
  .map((entry) => scenarioById(entry.id)!)
  .filter(Boolean);
if (playable.length < 10) throw new Error('The demo needs at least ten playable scenarios.');
const scenarios = Array.from({ length: 18 }, (_, index) => playable[index % playable.length]!);
const outcomes = [
  'win',
  'loss',
  'win',
  'win',
  'win',
  'draw',
  'loss',
  'win',
  'win',
  'loss',
  'win',
  'draw',
  'win',
  'loss',
  'win',
  'win',
  'loss',
  'win',
] as const;
const medalIds: MedalId[] = [
  'cib',
  'purple-heart',
  'bronze-star',
  'silver-star',
  'good-conduct',
  'eame-campaign',
  'beta-service',
  'beta-campaign',
];
const medals: AwardedMedal[] = medalIds.map((id, index) => ({
  id,
  awardedAt: stamp(now - (160 - index * 15) * DAY),
}));
const aliceUser: UserDoc = {
  ...baseUser(alice),
  xp: 2225,
  elo: 1368,
  wins: 11,
  losses: 5,
  draws: 2,
  onlineGames: 18,
  streak: 1,
  medals,
  scenariosCompleted: [...new Set(scenarios.map((scenario) => scenario.id))],
  betaScenarios: [...new Set(scenarios.slice(0, 10).map((scenario) => scenario.id))],
};

const batch = db.batch();
batch.set(db.collection(COL.users).doc(alice.auth.uid), aliceUser);
batch.set(
  db.collection(COL.publicProfiles).doc(alice.auth.uid),
  publicProfile(
    alice,
    aliceUser,
    'Scenario hunter, patient teacher, and enthusiastic defender of improbable positions. Usually available for an evening Starter Kit game.',
    'Richmond, Virginia',
  ),
);

for (const [player, description, location] of [
  [carol, 'Prefers infantry-heavy scenarios and a relaxed table.', 'Madison, Wisconsin'],
  [probe, 'Still believes every problem can be solved with smoke.', 'Portland, Oregon'],
] as const) {
  const user = baseUser(player);
  batch.set(db.collection(COL.users).doc(player.auth.uid), user, { merge: true });
  batch.set(
    db.collection(COL.publicProfiles).doc(player.auth.uid),
    publicProfile(player, user, description, location),
    { merge: true },
  );
}

for (const player of [alice, carol, probe]) {
  batch.set(db.collection(COL.nicknames).doc(player.normalized), {
    uid: player.auth.uid,
    current: player.normalized,
    alias: false,
    createdAt: stamp(now - 420 * DAY),
  });
}

// Keep Alice's former seeded name as a working redirect.
batch.set(db.collection(COL.nicknames).doc('alice-j58ok'), {
  uid: alice.auth.uid,
  current: alice.normalized,
  alias: true,
  createdAt: stamp(now),
});

for (let index = 0; index < scenarios.length; index++) {
  const scenario = scenarios[index]!;
  const opponent = index % 2 ? probe : carol;
  const [aliceSide, opponentSide] =
    index % 2
      ? [scenario.sides[1]!.side, scenario.sides[0]!.side]
      : [scenario.sides[0]!.side, scenario.sides[1]!.side];
  const outcome = outcomes[index]!;
  const winner = outcome === 'draw' ? null : outcome === 'win' ? aliceSide : opponentSide;
  const winnerUid =
    outcome === 'draw' ? null : outcome === 'win' ? alice.auth.uid : opponent.auth.uid;
  const loserUid =
    outcome === 'draw' ? null : outcome === 'win' ? opponent.auth.uid : alice.auth.uid;
  const matchId = `demo-alice-result-${String(index + 1).padStart(2, '0')}`;
  batch.set(db.collection(COL.publicResults).doc(matchId), {
    matchId,
    rulesetId: 'starter-kit',
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    playerIds: [alice.auth.uid, opponent.auth.uid],
    players: {
      [aliceSide]: { uid: alice.auth.uid, nickname: alice.nickname },
      [opponentSide]: { uid: opponent.auth.uid, nickname: opponent.nickname },
    },
    competition: index === 12 ? 'friendly' : 'ranked',
    visibility: 'public',
    result: {
      winner,
      winnerUid,
      loserUid,
      reason: index % 7 === 6 ? 'sudden death' : index % 5 === 4 ? 'concession' : 'scenario end',
      eloDelta: outcome === 'draw' ? 0 : 8 + (index % 5),
    },
    official: true,
    completedAt: stamp(now - (3 + index * 6) * DAY),
    seeded: true,
  });
}

const singleWindow = [{ start: localFuture(1, 18), end: localFuture(1, 21) }];
const multipleWindows = [
  { start: localFuture(2, 12), end: localFuture(2, 14, 30) },
  { start: localFuture(3, 19), end: localFuture(3, 22) },
  { start: localFuture(5, 10), end: localFuture(5, 13) },
];

function listing(
  id: string,
  scenarioId: string,
  durationMinutes: number,
  availability: Array<{ start: Date; end: Date }>,
  competition: 'ranked' | 'friendly',
): void {
  const scenario = scenarioById(scenarioId)!;
  const blocks = availability.map((block) => ({
    start: Timestamp.fromDate(block.start),
    end: Timestamp.fromDate(block.end),
  }));
  const data: GameListingDoc = {
    rulesetId: 'starter-kit',
    scenarioId,
    scenarioTitle: scenario.title,
    hostUid: alice.auth.uid,
    hostNickname: alice.nickname,
    competition,
    visibility: 'public',
    durationMinutes,
    timezone: 'America/New_York',
    availability: blocks,
    side: competition === 'friendly' ? scenario.sides[0]!.side : 'random',
    balance: [],
    status: 'open',
    opponentUid: null,
    opponentNickname: null,
    playerIds: [alice.auth.uid],
    scheduledAt: null,
    matchId: null,
    bookingSlotIds: [],
    presentUids: [],
    createdAt: stamp(now - (id.endsWith('multi') ? 30 : 12) * 60_000),
    updatedAt: stamp(now),
    expiresAt: Timestamp.fromMillis(Math.max(...blocks.map((block) => block.end.toMillis()))),
    windowStart: Timestamp.fromMillis(Math.min(...blocks.map((block) => block.start.toMillis()))),
  };
  batch.set(db.collection(COL.listings).doc(id), data);
}

listing('demo-lobby-single', 'sk-s7', 180, singleWindow, 'ranked');
listing('demo-lobby-multi', 'sk-s19', 240, multipleWindows, 'friendly');

const channel = db.collection(COL.chatChannels).doc('lobby_starter-kit');
batch.set(channel, { kind: 'lobby', participants: [], updatedAt: stamp(now) }, { merge: true });
batch.set(channel.collection(COL.messages).doc('demo-alice-hello'), {
  channelId: 'lobby_starter-kit',
  uid: alice.auth.uid,
  nickname: alice.nickname,
  text: 'Evening all — I posted a couple of games. Happy to help a newer player through Prelude to Festung Brest.',
  createdAt: stamp(now - 8 * 60_000),
  expiresAt: stamp(now + 30 * DAY),
  hidden: false,
});
batch.set(channel.collection(COL.messages).doc('demo-alice-followup'), {
  channelId: 'lobby_starter-kit',
  uid: alice.auth.uid,
  nickname: alice.nickname,
  text: 'The Purple Heart Lane post has a few different windows if weekends work better.',
  createdAt: stamp(now - 3 * 60_000),
  expiresAt: stamp(now + 30 * DAY),
  hidden: false,
});

await batch.commit();

const presence = realtime.ref(`presence/${alice.auth.uid}/demo-lobby-seed`);
const heartbeat = () => presence.set({ at: Date.now(), area: 'lobby', active: true });
await heartbeat();

console.log('Lobby demo staged:');
console.log(`  online player: ${alice.nickname} (${alice.auth.email})`);
console.log('  service record: 18 public results, 8 decorations, complete profile');
console.log('  game posts: 2 open posts (1 single-window, 1 three-window)');
console.log('  sign-in password for demo accounts: password');

if (process.argv.includes('--once')) {
  console.log('Presence was written once and will age out after three minutes.');
  process.exit(0);
}

console.log('Keeping Alice online; press Ctrl+C when recording is finished.');
const timer = setInterval(() => void heartbeat(), 45_000);
const stop = async () => {
  clearInterval(timer);
  await presence.remove().catch(() => {});
  process.exit(0);
};
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
