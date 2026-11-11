#!/usr/bin/env node
// Browser check for a hotseat game opened on two devices at once: two headless Chromium profiles
// signed in as the same account open one match. A plays, B opens (replaying A's move) and plays
// on; A must lock with "Played elsewhere", refuse orders, and catch up with B on "Pick up the
// game"; then A plays on and B must lock in turn. Abandoning the match on the server must show
// "Ended elsewhere" on both with only the lobby on offer, and the recording must still replay.
// Needs `pnpm dev` up and the seeded account (`pnpm seed alice@example.com`), like smoke.mjs.
// Options: SHOTS=<dir> saves screenshots, WEB=<url> for another dev server.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WEB = process.env.WEB ?? 'http://localhost:5173';
const SC = 'lma-9';
const SHOTS = process.env.SHOTS ?? null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { throw new Error(msg); };
const expect = (cond, msg) => { if (!cond) fail(msg); };
const bin = ['chromium', 'chromium-browser', 'google-chrome'].find((c) => spawnSync('which', [c]).status === 0) ?? fail('no chromium');
const devices = [];
process.on('exit', () => { for (const d of devices) { try { d.proc.kill(); } catch {} try { rmSync(d.profile, { recursive: true, force: true }); } catch {} } });

async function launch(name, port) {
  const profile = mkdtempSync(join(tmpdir(), `asl-dev-${name}-`));
  const proc = spawn(bin, ['--headless=new', '--mute-audio', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1600,1000', '--no-first-run', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
  const d = { name, proc, profile, errors: [] };
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
  let shotN = 0;
  d.shot = async (label) => { if (!SHOTS) return; const r = await d.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, `${name}-${String(++shotN).padStart(2, '0')}-${label}.png`), Buffer.from(r.result.data, 'base64')); };
  d.waitFor = async (js, what, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await d.evaluate(`!!(${js})`)) return; await sleep(150); }
    await d.shot('timeout');
    fail(`${name}: timed out waiting for ${what}`);
  };
  d.hexClient = async (hex) => JSON.parse(await d.evaluate(`JSON.stringify(window.aslBoard.hexToClient(${JSON.stringify(hex)}))`)) ?? fail(`no hex ${hex}`);
  d.rightHex = async (hex) => {
    const c = await d.hexClient(hex);
    await d.evaluate(`document.querySelector('.board canvas, canvas').dispatchEvent(new MouseEvent('contextmenu', { clientX: ${c.x}, clientY: ${c.y}, bubbles: true, cancelable: true, button: 2 }))`);
    await sleep(350);
  };
  d.wheel = async (label) => d.evaluate(`(() => {
    const items = [...document.querySelectorAll('.aw-item')].map((b) => ({ b, t: b.querySelector('.aw-label')?.textContent.trim() ?? '' }));
    const hit = items.find((i) => i.t === ${JSON.stringify(label)}) ?? items.find((i) => i.t.startsWith(${JSON.stringify(label)}));
    if (!hit) return 'missing (wheel shows: ' + items.map((i) => i.t).join(' | ') + ')';
    if (hit.b.disabled) return 'disabled';
    hit.b.click(); return 'ok';
  })()`);
  d.game = async () => JSON.parse(await d.evaluate(`JSON.stringify({ seq: aslGame.state.seq, decision: aslGame.decision?.id ?? null, title: document.querySelector('.panel.decision h2')?.textContent ?? '' })`));
  d.emptyHex = async () => d.evaluate(`(() => {
    const G = window.aslGame; const busy = new Set(Object.values(G.state.pieces).map((p) => p.loc.hex).filter(Boolean));
    for (const h of G.env.statics.map.hexes()) if (!busy.has(h.id)) return h.id; return null; })()`);
  /** One setup round: auto-place and confirm. */
  d.setupRound = async () => {
    const g = await d.game();
    expect(/set ?up|fortif/i.test(g.title), `${name}: expected a setup step, got "${g.title}"`);
    const h = (await d.emptyHex()) ?? fail('no empty hex');
    await d.rightHex(h);
    if ((await d.wheel('Auto-place the rest')) === 'ok') await sleep(600); else await d.evaluate(`document.querySelector('.aw-backdrop')?.click()`);
    await d.rightHex(h);
    const c = await d.wheel('Confirm');
    expect(c === 'ok', `${name}: could not confirm setup: ${c}`);
    await d.waitFor(`(aslGame.decision?.id ?? null) !== ${JSON.stringify(g.decision)}`, `${name}: setup "${g.title}" to finish`);
    await sleep(600);
    console.log(`${name}: setup "${g.title}" ✓ → seq ${(await d.game()).seq}`);
  };
  /** Any one step: a setup round, or Done / End phase. */
  d.step = async () => {
    const g = await d.game();
    if (/set ?up|fortif/i.test(g.title)) return d.setupRound();
    await d.waitFor(`!aslGame.resolving`, 'dice', 30000);
    const ok = await d.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((b) => !b.disabled && /^(Done|End phase)/.test(b.textContent.trim())); if (!b) return 'missing'; b.click(); return 'ok'; })()`);
    expect(ok === 'ok', `${name}: no Done/End phase button`);
    await sleep(400);
    await d.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('anyway'))?.click()`);
    await d.waitFor(`(aslGame.decision?.id ?? null) !== ${JSON.stringify(g.decision)}`, `${name}: step "${g.title}" to end`);
    await sleep(600);
    console.log(`${name}: step "${g.title}" ✓ → seq ${(await d.game()).seq}`);
  };
  d.dialog = async () => d.evaluate(`document.querySelector('[role=dialog]')?.getAttribute('aria-label') ?? null`);
  d.open = async (matchId) => {
    await d.send('Page.navigate', { url: `${WEB}/app/match/${matchId}` });
    await d.waitFor(`window.aslGame && window.aslBoard && document.querySelector('canvas')`, 'the match to open');
    await sleep(1500);
  };
  await d.send('Page.enable'); await d.send('Runtime.enable');
  await d.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  // sign in
  await d.send('Page.navigate', { url: `${WEB}/login` });
  await d.waitFor(`document.querySelector('input[type=email]') || location.pathname.startsWith('/app')`, 'login page');
  if (await d.evaluate(`!!document.querySelector('input[type=email]')`)) {
    await d.evaluate(`document.querySelector('input[type=email]').focus()`);
    await d.send('Input.insertText', { text: 'alice@example.com' });
    await d.evaluate(`document.querySelector('input[type=password]').focus()`);
    await d.send('Input.insertText', { text: 'password' });
    await d.evaluate(`document.querySelector('form button.primary').click()`);
    await d.waitFor(`location.pathname.startsWith('/app')`, 'lobby');
  }
  return d;
}

const token = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'alice@example.com', password: 'password', returnSecureToken: true }),
}).then((r) => r.json());
expect(token?.idToken, 'auth emulator sign-in failed');
const call = (fn, data) => fetch(`http://127.0.0.1:5001/demo-asl-web/us-central1/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token.idToken}` }, body: JSON.stringify({ data }) }).then((r) => r.json());

const [A, B] = await Promise.all([launch('A', 9341), launch('B', 9342)]);
const created = await call('createMatch', { mode: 'hotseat', scenarioId: SC, balance: [], side: 'am', pace: 'live' });
const matchId = created?.result?.matchId ?? fail(`createMatch: ${JSON.stringify(created)}`);
console.log(`match ${matchId}`);

// A opens and plays the first setup step.
await A.open(matchId);
await A.setupRound();
const a1 = await A.game();
expect((await A.dialog()) === null, `A should not be locked after its own move (dialog: ${await A.dialog()})`);

// B opens: must replay A's action, then plays the next step.
await B.open(matchId);
const b1 = await B.game();
expect(b1.seq === a1.seq && b1.decision === a1.decision, `B did not replay A's move: A=${JSON.stringify(a1)} B=${JSON.stringify(b1)}`);
console.log('B: replayed A\'s move ✓');
await B.setupRound();
const b2 = await B.game();

// A must now be locked.
await A.waitFor(`document.querySelector('[role=dialog]')?.getAttribute('aria-label') === 'Played elsewhere'`, 'A to lock with "Played elsewhere"');
await A.shot('locked');
const aStale = await A.game();
expect(aStale.seq === a1.seq, 'A\'s board should still show its stale position behind the lock');
// The session refuses orders behind the lock (the wheel would show the same message).
const refused = await A.evaluate(`(() => { try { const r = window.aslGame.act({ type: 'nothing' }); return String(r); } catch (e) { return 'threw ' + e.message; } })()`);
console.log(`A: act behind the lock → ${refused}`);
console.log('A: locked ✓');

// Pick up the game: A re-reads the recording and lands on B's position.
await A.evaluate(`[...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.includes('Pick up the game')).click()`);
await A.waitFor(`window.aslGame && aslGame.state.seq === ${b2.seq} && (aslGame.decision?.id ?? null) === ${JSON.stringify(b2.decision)}`, 'A to catch up with B after picking up the game');
await sleep(800);
expect((await A.dialog()) === null, `A still shows a dialog after picking up: ${await A.dialog()}`);
await A.shot('picked-up');
console.log('A: picked up the game, level with B ✓');

// A plays on from the fresh position; B is now the stale one and must lock.
await A.step();
await B.waitFor(`document.querySelector('[role=dialog]')?.getAttribute('aria-label') === 'Played elsewhere'`, 'B to lock after A played on');
await B.shot('locked');
console.log('B: locked once A played on ✓');

// Ended elsewhere: abandon on the server; both boards must say so, and since an abandoned game
// has no result there is nothing to read again, only the lobby.
const left = await call('leaveMatch', { matchId });
expect(left?.result, `leaveMatch: ${JSON.stringify(left)}`);
for (const d of [A, B]) {
  await d.waitFor(`document.querySelector('[role=dialog]')?.getAttribute('aria-label') === 'Ended elsewhere'`, `${d.name} to show "Ended elsewhere"`);
  const buttons = await d.evaluate(`[...document.querySelectorAll('[role=dialog] button, [role=dialog] a')].map((b) => b.textContent.trim()).join('|')`);
  expect(buttons === 'Back to the lobby', `${d.name}: an abandoned game offers only the lobby, got "${buttons}"`);
  await d.shot('ended');
  console.log(`${d.name}: ended elsewhere ✓`);
}

// The recording must be intact: opening it afresh replays cleanly (no "older rules" gate).
await B.send('Page.navigate', { url: `${WEB}/app/match/${matchId}` });
await B.waitFor(`document.querySelector('[role=dialog]') || document.querySelector('.gate-card')`, 'B to open the abandoned game afresh', 20000);
const gate = await B.evaluate(`document.querySelector('.gate-card h1')?.textContent ?? null`);
expect(gate === null, `B hit a gate after re-reading: ${gate}`);
expect((await B.dialog()) === 'Ended elsewhere', `B afresh shows ${await B.dialog()}`);
console.log('B: the recording replays intact ✓');

for (const d of [A, B]) {
  const errs = d.errors.filter((e) => !/permission|insufficient/i.test(e));
  if (errs.length) { console.log(`${d.name} page errors:\n  ${errs.join('\n  ')}`); }
}
console.log('ALL OK');
process.exit(0);
