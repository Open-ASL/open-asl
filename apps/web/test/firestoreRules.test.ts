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
});
