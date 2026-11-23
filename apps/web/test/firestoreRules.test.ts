import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * firestore.rules against the local Firestore emulator (`pnpm dev` or `pnpm emulators`), under a
 * project of its own so the dev data is untouched. Skipped when no emulator is listening.
 */
const HOST = 'http://127.0.0.1:8080';
const RULES = readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');

/** An unsigned ID token as the emulator accepts it, issued for `aud` with these claims. */
function token(aud: string, claims: Record<string, unknown>): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: `https://securetoken.google.com/${aud}`, aud, iat: now, exp: now + 3600, auth_time: now, sub: 'u1', user_id: 'u1', firebase: { sign_in_provider: 'password', identities: {} }, ...claims })}.`;
}

const up = await fetch(HOST).then(() => true, () => false);

describe.skipIf(!up)('firestore.rules', () => {
  /** Read a lobby chat's messages in `project` as a member with these claims; true when allowed. */
  async function canRead(project: string, channel: string, claims: Record<string, unknown> = {}): Promise<boolean> {
    await fetch(`${HOST}/emulator/v1/projects/${project}:securityRules`, { method: 'PUT', body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: RULES }] } }) });
    const res = await fetch(`${HOST}/v1/projects/${project}/databases/(default)/documents/chatChannels/${channel}/messages`, { headers: { authorization: `Bearer ${token(project, { member: true, ...claims })}` } });
    return res.status === 200;
  }

  beforeAll(async () => {
    // Not a demo- project, as production is not: there the Full ASL chat needs the admin claim.
    expect(await canRead('rules-test-prod', 'lobby_starter-kit')).toBe(true);
  });

  it('keeps the Full ASL lobby chat behind the development gate', async () => {
    expect(await canRead('rules-test-prod', 'lobby_full-asl')).toBe(false);
    expect(await canRead('rules-test-prod', 'lobby_full-asl', { admin: true })).toBe(true);
    expect(await canRead('demo-rules-test', 'lobby_full-asl')).toBe(true);
    expect(await canRead('rules-test-prod', 'lobby_other')).toBe(false);
  });

  it('lets the client re-send a hotseat action it already stored (a lost acknowledgement), but never change one', async () => {
    const project = 'demo-rules-resend';
    await fetch(`${HOST}/emulator/v1/projects/${project}:securityRules`, { method: 'PUT', body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: RULES }] } }) });
    const root = `projects/${project}/databases/(default)/documents`;
    const match = `${root}/matches/m1`;
    await fetch(`${HOST}/v1/${match}`, { method: 'PATCH', headers: { authorization: 'Bearer owner' }, body: JSON.stringify({ fields: { mode: { stringValue: 'hotseat' }, createdBy: { stringValue: 'u1' }, status: { stringValue: 'active' }, actionCount: { integerValue: '0' } } }) });
    // The batch the client writes for each action: the action and the match's count.
    const commit = async (json: string, uid = 'u1') => {
      const writes = [
        { update: { name: `${match}/actions/000001`, fields: { seq: { integerValue: '1' }, json: { stringValue: json } } }, updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }] },
        { update: { name: match, fields: { actionCount: { integerValue: '1' } } }, updateMask: { fieldPaths: ['actionCount'] }, currentDocument: { exists: true } },
      ];
      const auth = `Bearer ${token(project, { member: true, sub: uid, user_id: uid })}`;
      return (await fetch(`${HOST}/v1/${root}:commit`, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify({ writes }) })).status;
    };
    expect(await commit('{"type":"endPhase"}')).toBe(200);
    expect(await commit('{"type":"endPhase"}')).toBe(200);
    expect(await commit('{"type":"move.end"}')).toBe(403);
    expect(await commit('{"type":"endPhase"}', 'u2')).toBe(403);
  });

  it("lets only a computer game's recording carry the bot's version on a move", async () => {
    const project = 'rules-test-actions';
    await fetch(`${HOST}/emulator/v1/projects/${project}:securityRules`, { method: 'PUT', body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: RULES }] } }) });
    const docs = `${HOST}/v1/projects/${project}/databases/(default)/documents`;
    // Fresh matches each run: the emulator keeps the last run's actions, and an action is never rewritten.
    const run = Date.now().toString(36);
    for (const mode of ['computer', 'hotseat']) {
      const fields = { mode: { stringValue: mode }, createdBy: { stringValue: 'u1' }, status: { stringValue: 'active' }, playerIds: { arrayValue: { values: [{ stringValue: 'u1' }] } } };
      await fetch(`${docs}/matches/${mode}-${run}`, { method: 'PATCH', headers: { authorization: 'Bearer owner' }, body: JSON.stringify({ fields }) });
    }
    const append = async (mode: string, seq: number, bot: boolean) => {
      const fields = { seq: { integerValue: String(seq) }, json: { stringValue: '{}' }, ...(bot ? { bot: { mapValue: { fields: { version: { stringValue: 'abc1234' }, ms: { integerValue: '120' } } } } } : {}) };
      const res = await fetch(`${docs}/matches/${mode}-${run}/actions?documentId=${String(seq).padStart(6, '0')}`, { method: 'POST', headers: { authorization: `Bearer ${token(project, { member: true })}` }, body: JSON.stringify({ fields }) });
      return res.status === 200;
    };
    expect(await append('computer', 1, false)).toBe(true);
    expect(await append('computer', 2, true)).toBe(true);
    expect(await append('hotseat', 1, false)).toBe(true);
    expect(await append('hotseat', 2, true)).toBe(false);
  });

  it("opens a live match whole to a commentator, and keeps the commentators' room from the match's players", async () => {
    const project = 'rules-test-commentators';
    await fetch(`${HOST}/emulator/v1/projects/${project}:securityRules`, { method: 'PUT', body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: RULES }] } }) });
    const docs = `${HOST}/v1/projects/${project}/databases/(default)/documents`;
    const run = Date.now().toString(36);
    const match = `matches/live-${run}`;
    const owner = { authorization: 'Bearer owner' };
    // A private online match being played on the views model: its recording and seed are closed to everyone at the table.
    const fields = { mode: { stringValue: 'online' }, model: { stringValue: 'views' }, status: { stringValue: 'active' }, visibility: { stringValue: 'private' }, playerIds: { arrayValue: { values: [{ stringValue: 'p1' }, { stringValue: 'p2' }] } } };
    await fetch(`${docs}/${match}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields }) });
    await fetch(`${docs}/${match}/actions/000001`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: { seq: { integerValue: '1' }, json: { stringValue: '{}' } } }) });
    await fetch(`${docs}/${match}/private/game`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: { seed: { stringValue: 's' } } }) });
    const as = (uid: string, ss: boolean, member = true) => ({ authorization: `Bearer ${token(project, { member, sub: uid, user_id: uid, ...(ss ? { superSpectator: true } : {}) })}` });
    const read = async (path: string, uid: string, ss: boolean) => (await fetch(`${docs}/${path}`, { headers: as(uid, ss) })).status === 200;
    const write = async (path: string, uid: string, ss: boolean, f: Record<string, unknown>) =>
      (await fetch(`${docs}/${path}`, { method: 'PATCH', headers: { ...as(uid, ss), 'content-type': 'application/json' }, body: JSON.stringify({ fields: f }) })).status === 200;

    // The commentator reads the match, its recording and its seed; a player reads neither recording nor seed while it is live.
    expect(await read(match, 'c1', true)).toBe(true);
    expect(await read(`${match}/actions/000001`, 'c1', true)).toBe(true);
    expect(await read(`${match}/private/game`, 'c1', true)).toBe(true);
    expect(await read(`${match}/actions/000001`, 'p1', false)).toBe(false);
    expect(await read(`${match}/private/game`, 'p1', false)).toBe(false);
    expect(await read(`${match}/private/game`, 'x1', false)).toBe(false);
    // A player who also holds the claim reads neither: their opponent's hidden units and the dice to come stay closed.
    expect(await read(`${match}/actions/000001`, 'p1', true)).toBe(false);
    expect(await read(`${match}/private/game`, 'p1', true)).toBe(false);
    expect(await read(match, 'p1', true)).toBe(true);
    // The claim on an account that is not (or no longer) a member opens nothing.
    const outsider = async (path: string) => (await fetch(`${docs}/${path}`, { headers: as('c9', true, false) })).status === 200;
    expect(await outsider(match)).toBe(false);
    expect(await outsider(`${match}/actions/000001`)).toBe(false);
    expect(await outsider(`${match}/private/game`)).toBe(false);
    // Nobody writes the recording or the seed, commentator or not.
    expect(await write(`${match}/private/game`, 'c1', true, { seed: { stringValue: 'mine' } })).toBe(false);
    expect(await write(`${match}/actions/000002`, 'c1', true, { seq: { integerValue: '2' }, json: { stringValue: '{}' } })).toBe(false);

    // The room: commentators write and read it; a player cannot, even one holding the claim in their own match.
    const ping = { uid: { stringValue: 'c1' }, hex: { stringValue: 'tC4' }, n: { integerValue: '1' }, color: { integerValue: '0' } };
    expect(await write(`${match}/ssPings/c1`, 'c1', true, ping)).toBe(true);
    expect(await read(`${match}/ssPings/c1`, 'c2', true)).toBe(true);
    expect(await read(`${match}/ssPings/c1`, 'p1', false)).toBe(false);
    expect(await read(`${match}/ssPings/c1`, 'p1', true)).toBe(false);
    expect(await write(`${match}/ssPings/p1`, 'p1', true, { ...ping, uid: { stringValue: 'p1' } })).toBe(false);
    // A commentator writes only their own ping and member docs.
    expect(await write(`${match}/ssPings/c2`, 'c1', true, ping)).toBe(false);
    const stroke = { uid: { stringValue: 'c1' }, color: { integerValue: '0' }, width: { integerValue: '4' }, epoch: { integerValue: '0' }, points: { arrayValue: { values: [{ integerValue: '1' }, { integerValue: '2' }] } } };
    expect(await write(`${match}/ssStrokes/s1`, 'c1', true, stroke)).toBe(true);
    expect(await read(`${match}/ssStrokes/s1`, 'p2', false)).toBe(false);
    const room = { cursor: { stringValue: 'live' }, virtual: { nullValue: null }, show: { mapValue: { fields: {} } }, epoch: { integerValue: '1' }, check: { nullValue: null }, heat: { nullValue: null }, play: { stringValue: 'c1' }, speed: { integerValue: '2' }, by: { stringValue: 'c1' } };
    expect(await write(`${match}/ssRoom/state`, 'c1', true, room)).toBe(true);
    expect(await read(`${match}/ssRoom/state`, 'c2', true)).toBe(true);
    expect(await read(`${match}/ssRoom/state`, 'p1', false)).toBe(false);
    expect(await write(`${match}/ssRoom/state`, 'c1', true, { ...room, extra: { stringValue: 'x' } })).toBe(false);
    // Anyone without the claim is outside the room: no reads, no writes, in any of its collections.
    for (const path of ['ssRoom/state', 'ssMembers/c1', 'ssPings/c1', 'ssStrokes/s1']) {
      expect(await read(`${match}/${path}`, 'x1', false)).toBe(false);
      expect(await read(`${match}/${path}`, 'p2', true)).toBe(false);
    }
    expect(await write(`${match}/ssRoom/state`, 'x1', false, { ...room, by: { stringValue: 'x1' } })).toBe(false);
    expect(await write(`${match}/ssStrokes/s2`, 'x1', false, { ...stroke, uid: { stringValue: 'x1' } })).toBe(false);
    expect(await write(`${match}/ssMembers/x1`, 'x1', false, { uid: { stringValue: 'x1' }, name: { stringValue: 'x' }, color: { integerValue: '0' } })).toBe(false);
    // A commentator cannot write the room in another's name.
    expect(await write(`${match}/ssRoom/state`, 'c1', true, { ...room, by: { stringValue: 'c2' } })).toBe(false);
  });
});
