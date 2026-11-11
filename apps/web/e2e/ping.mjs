#!/usr/bin/env node
// Browser check for pings (Ctrl+click): two headless Chromium profiles (alice and carol, both
// seeded) sit in one online match. Alice Ctrl+clicks a hex: her own board must play a 'ping'
// effect at once and carol's must receive it through Firestore; a repeat ping of the same hex
// must still arrive; carol's ping back must reach alice. Then a hotseat match must ping locally.
// Any active online match the two sit in from an earlier run is conceded first.
// Needs `pnpm dev` up and `pnpm seed alice@example.com carol@example.com`, like smoke.mjs.
// Options: SHOTS=<dir> saves screenshots, WEB=<url> for another dev server.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const WEB = process.env.WEB ?? 'http://localhost:5173';
const SHOTS = process.env.SHOTS ?? null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { throw new Error(m); };
const expect = (c, m) => { if (!c) fail(m); };
const bin = ['chromium', 'chromium-browser', 'google-chrome'].find((c) => spawnSync('which', [c]).status === 0) ?? fail('no chromium');
const devices = [];
process.on('exit', () => { for (const d of devices) { try { d.proc.kill(); } catch {} try { rmSync(d.profile, { recursive: true, force: true }); } catch {} } });

async function launch(name, port, email) {
  const profile = mkdtempSync(join(tmpdir(), `asl-ping-${name}-`));
  const proc = spawn(bin, ['--headless=new', '--mute-audio', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1600,1000', '--no-first-run', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  const d = { name, proc, profile, errors: [], email };
  devices.push(d);
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(250); } }
  if (!targets) fail(`${name}: no devtools`);
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => {
    const x = JSON.parse(m.data);
    if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); return; }
    if (x.method === 'Runtime.exceptionThrown') d.errors.push(`exception: ${x.params.exceptionDetails.exception?.description ?? x.params.exceptionDetails.text}`);
    if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') d.errors.push(`console.error: ${x.params.args.map((a) => a.description ?? a.value).join(' ')}`);
  };
  d.send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  d.evaluate = async (js) => {
    const r = await d.send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`${name}: eval failed: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}\n${js.slice(0, 200)}`);
    return r.result?.result?.value;
  };
  let n = 0;
  d.shot = async (label) => { if (!SHOTS) return; const r = await d.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, `${name}-${String(++n).padStart(2, '0')}-${label}.png`), Buffer.from(r.result.data, 'base64')); };
  d.waitFor = async (js, what, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await d.evaluate(`!!(${js})`)) return; await sleep(120); }
    await d.shot('timeout');
    fail(`${name}: timed out waiting for ${what}`);
  };
  d.hexClient = async (hex) => JSON.parse(await d.evaluate(`JSON.stringify(window.aslBoard.hexToClient(${JSON.stringify(hex)}))`)) ?? fail(`no hex ${hex}`);
  d.ctrlClickHex = async (hex, dx = 0, dy = 0) => {
    const c = await d.hexClient(hex);
    c.x += dx; c.y += dy;
    await d.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, modifiers: 2 });
    await d.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1, modifiers: 2 });
    await d.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1, modifiers: 2 });
  };
  d.pings = async () => (await d.evaluate(`window.aslBoard.stats().fx.ping ?? 0`)) ?? 0;
  await d.send('Page.enable'); await d.send('Runtime.enable');
  await d.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  d.token = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password', returnSecureToken: true }) }).then((r) => r.json());
  if (!d.token?.idToken) fail(`${name}: cannot sign in as ${email}`);
  await d.send('Page.navigate', { url: `${WEB}/login` });
  await d.waitFor(`document.querySelector('input[type=email]') || location.pathname.startsWith('/app')`, 'login page');
  if (await d.evaluate(`!!document.querySelector('input[type=email]')`)) {
    await d.evaluate(`document.querySelector('input[type=email]').focus()`);
    await d.send('Input.insertText', { text: email });
    await d.evaluate(`document.querySelector('input[type=password]').focus()`);
    await d.send('Input.insertText', { text: 'password' });
    for (let i = 0; i < 4; i++) {
      await d.evaluate(`document.querySelector('form button.primary')?.click()`);
      await sleep(2500);
      if (await d.evaluate(`location.pathname.startsWith('/app')`)) break;
    }
    await d.waitFor(`location.pathname.startsWith('/app')`, 'lobby');
  }
  // The member claim is granted on first sign-in through the app: take a token minted after it.
  await sleep(500);
  d.token = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password', returnSecureToken: true }) }).then((r) => r.json());
  d.api = async (fn, data) => (await fetch(`http://127.0.0.1:5001/demo-asl-web/us-central1/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${d.token.idToken}` }, body: JSON.stringify({ data }) })).json();
  d.open = async (matchId) => {
    await d.send('Page.navigate', { url: `${WEB}/app/match/${matchId}` });
    await d.waitFor(`window.aslGame && window.aslBoard && document.querySelector('canvas') && window.aslBoard.stats().builds >= 1`, 'the match');
    await sleep(800);
    // Click the phase wheel away so it does not cover the hex.
    await d.evaluate(`document.querySelector('.pw-overlay')?.click()`);
    await sleep(400);
  };
  return d;
}

const alice = await launch('alice', 9333, 'alice@example.com');
const carol = await launch('carol', 9334, 'carol@example.com');

// Leftovers from an earlier run: concede any active online match alice or carol sits in.
{
  const r = await fetch('http://127.0.0.1:8080/v1/projects/demo-asl-web/databases/(default)/documents/matches?pageSize=300', { headers: { authorization: 'Bearer owner' } }).then((x) => x.json());
  for (const docu of r.documents ?? []) {
    const f = docu.fields ?? {};
    if (f.mode?.stringValue !== 'online' || !['active', 'open'].includes(f.status?.stringValue)) continue;
    const mid = docu.name.split('/').pop();
    const ids = (f.playerIds?.arrayValue?.values ?? []).map((v) => v.stringValue);
    for (const d of [alice, carol]) {
      const uid = d.token.localId;
      if (ids.includes(uid)) { console.log(`leaving ${mid} as ${d.name}:`, JSON.stringify(await d.api('leaveMatch', { matchId: mid }))); break; }
    }
  }
}
// --- online: alice opens a seat, carol takes it.
const created = await alice.api('createMatch', { mode: 'online', scenarioId: 'lma-9', balance: [], side: 'br', openSeat: true, pace: 'live' });
const matchId = created?.result?.matchId ?? fail(`createMatch: ${JSON.stringify(created)}`);
const joined = await carol.api('joinOpenMatch', { matchId });
expect(!joined.error, `joinOpenMatch: ${JSON.stringify(joined)}`);
console.log(`online match ${matchId}`);
await alice.open(matchId);
await carol.open(matchId);
expect((await alice.pings()) === 0 && (await carol.pings()) === 0, 'no ping before the click');
const hexes = JSON.parse(await alice.evaluate(`JSON.stringify([...window.aslGame.env.statics.map.hexes()].map((h) => h.id))`));
const mid = hexes[Math.floor(hexes.length / 2)];
const hex = mid; console.log('hexes', hexes.length, 'ping at', hex);
await alice.ctrlClickHex(hex);
await sleep(250);
expect((await alice.pings()) === 1, `alice's own ping drawn (got ${await alice.pings()})`);
await alice.shot('own-ping');
await carol.waitFor(`(window.aslBoard.stats().fx.ping ?? 0) >= 1`, "carol to receive alice's ping", 8000);
await sleep(200);
await carol.shot('received-ping');
console.log(`carol received the ping; selection on alice untouched: ${await alice.evaluate(`document.querySelectorAll('.stack .sel').length`)}`);
// A second ping on the same hex still arrives (n rises).
await sleep(600);
await alice.ctrlClickHex(hex);
await carol.waitFor(`(window.aslBoard.stats().fx.ping ?? 0) >= 2`, 'the second ping', 8000);
// Carol pings back; her colour is the other side's.
await carol.ctrlClickHex(hexes[Math.floor(hexes.length / 2) + 7], -16, 10); // off-centre: the exact point must travel
await sleep(250);
await carol.shot('carol-own');
await alice.waitFor(`(window.aslBoard.stats().fx.ping ?? 0) >= 3`, "carol's ping on alice", 8000);
await sleep(150);
await alice.shot('carol-ping-received');
console.log('online pings OK: alice', await alice.pings(), 'carol', await carol.pings());
// Free both players for the next run.
console.log('leave:', JSON.stringify(await alice.api('leaveMatch', { matchId })));

// --- hotseat: the ping is drawn locally.
const hs = await alice.api('createMatch', { mode: 'hotseat', scenarioId: 'lma-9', balance: [], side: 'am', pace: 'live' });
const hsId = hs?.result?.matchId ?? fail(`hotseat createMatch: ${JSON.stringify(hs)}`);
await alice.open(hsId);
await alice.ctrlClickHex(hexes[Math.floor(hexes.length / 2) + 3], 14, -9); // off the hex centre: a point, not a hex
await sleep(300);
expect((await alice.pings()) === 1, `hotseat ping drawn (got ${await alice.pings()})`);
await alice.shot('hotseat-ping');
console.log('hotseat ping OK');
for (const d of devices) if (d.errors.length) { console.log(`${d.name} page errors:`, d.errors.slice(0, 5)); process.exitCode = 1; }
console.log('done');

process.exit();
