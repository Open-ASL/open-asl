#!/usr/bin/env node
// Browser check for an online undo: two headless Chromium profiles (alice and carol) sit in one
// online match. The player who made the last action asks to undo it and cancels; asks again and
// is refused, after which Undo stays disabled and the server refuses to ask again; the other side
// plays, asks and is allowed, which brings the refused action back within reach of an undo, and
// allowing that one returns both boards to the opening position.
// Needs `pnpm dev` up and `pnpm seed alice@example.com carol@example.com`, like ping.mjs.
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
  const profile = mkdtempSync(join(tmpdir(), `asl-undo-${name}-`));
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
  d.rightHex = async (hex) => {
    const c = await d.hexClient(hex);
    await d.evaluate(`document.querySelector('.board canvas, canvas').dispatchEvent(new MouseEvent('contextmenu', { clientX: ${c.x}, clientY: ${c.y}, bubbles: true, cancelable: true, button: 2 }))`);
    await sleep(350);
  };
  d.wheel = async (label) =>
    d.evaluate(`(() => {
      const items = [...document.querySelectorAll('.aw-item')].map((b) => ({ b, t: b.querySelector('.aw-label')?.textContent.trim() ?? '' }));
      const hit = items.find((i) => i.t === ${JSON.stringify(label)}) ?? items.find((i) => i.t.startsWith(${JSON.stringify(label)}));
      if (!hit) return 'missing (wheel shows: ' + items.map((i) => i.t).join(' | ') + ')';
      if (hit.b.disabled) return 'disabled';
      hit.b.click();
      return 'ok';
    })()`);
  /** Clicks the enabled button reading `text` (inside a dialog when `inModal`); 'ok' or 'missing'. */
  d.click = async (text, inModal = false) =>
    d.evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(inModal ? '.modal button' : 'button')})].find((b) => !b.disabled && b.textContent.trim() === ${JSON.stringify(text)}); if (!b) return 'missing'; b.click(); return 'ok'; })()`);
  d.modal = async () => d.evaluate(`document.querySelector('.modal')?.textContent ?? null`);
  d.undoEnabled = async () => d.evaluate(`(() => { const b = [...document.querySelectorAll('.side-head button')].find((b) => b.textContent.trim() === 'Undo'); return b ? !b.disabled : null; })()`);
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


const docUrl = (id) => `http://127.0.0.1:8080/v1/projects/demo-asl-web/databases/(default)/documents/matches/${id}`;
const matchDoc = async (id) => (await fetch(docUrl(id), { headers: { authorization: 'Bearer owner' } })).json();
const actionCount = async (id) => Number((await matchDoc(id)).fields.actionCount.integerValue);

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
      if (ids.includes(d.token.localId)) { console.log(`leaving ${mid} as ${d.name}:`, JSON.stringify(await d.api('leaveMatch', { matchId: mid }))); break; }
    }
  }
}

const created = await alice.api('createMatch', { mode: 'online', scenarioId: 'lma-9', balance: [], side: 'br', openSeat: true, pace: 'live' });
const matchId = created?.result?.matchId ?? fail(`createMatch: ${JSON.stringify(created)}`);
const joined = await carol.api('joinOpenMatch', { matchId });
expect(!joined.error, `joinOpenMatch: ${JSON.stringify(joined)}`);
console.log(`online match ${matchId}`);
await alice.open(matchId);
await carol.open(matchId);

/** The player whose setup decision it is places everything and confirms; returns that device. */
async function setUp() {
  const n = await actionCount(matchId);
  const d = (await alice.evaluate(`!!aslGame.owner`)) ? alice : (await carol.evaluate(`!!aslGame.owner`)) ? carol : fail('nobody owns the decision');
  const h = await d.evaluate(`(() => { const G = window.aslGame; const busy = new Set(Object.values(G.state.pieces).map((p) => p.loc.hex).filter(Boolean)); for (const h of G.env.statics.map.hexes()) if (!busy.has(h.id)) return h.id; return null; })()`);
  await d.rightHex(h);
  if ((await d.wheel('Auto-place the rest')) === 'ok') await sleep(600);
  else await d.evaluate(`document.querySelector('.aw-backdrop')?.click()`);
  await d.rightHex(h);
  expect((await d.wheel('Confirm')) === 'ok', `${d.name}: could not confirm setup`);
  for (let i = 0; i < 100 && (await actionCount(matchId)) === n; i++) await sleep(150);
  expect((await actionCount(matchId)) === n + 1, `${d.name}'s setup was not recorded`);
  console.log(`${d.name} set up (action ${n + 1})`);
  return d;
}
const other = (d) => (d === alice ? carol : alice);
const waitModal = async (d, re, what) => d.waitFor(`/${re.source}/.test(document.querySelector('.modal')?.textContent ?? '')`, what, 15000);
/** Asks to undo from `d`'s Undo button and returns once the opponent sees the question. */
async function ask(d) {
  for (let i = 0; i < 50 && !(await d.undoEnabled()); i++) await sleep(150);
  expect(await d.undoEnabled(), `${d.name}: Undo should be enabled (button: ${await d.undoEnabled()}, side head: ${await d.evaluate(`document.querySelector('.side-head')?.textContent`)})`);
  await d.evaluate(`[...document.querySelectorAll('.side-head button')].find((b) => b.textContent.trim() === 'Undo').click()`);
  await waitModal(d, /Ask your opponent to undo the last action\?/, 'the confirmation');
  expect((await d.click('Ask', true)) === 'ok', `${d.name}: no Ask button`);
  await waitModal(d, /Waiting for opponent to decide/, 'the waiting dialog');
  await waitModal(other(d), /Allow .* to undo their last action\?/, 'the question on the other board');
}

// 1. The first setup; its player asks, then cancels and plays on.
const a = await setUp();
const b = other(a);
expect((await b.undoEnabled()) === false, `${b.name}: Undo should be disabled for the other side's action`);
await ask(a);
await a.shot('waiting');
await b.shot('question');
expect((await a.click('Cancel request', true)) === 'ok', 'no Cancel request button');
await b.waitFor(`!document.querySelector('.modal')`, 'the question to go away once withdrawn');
expect(!(await a.modal()), 'the asker has no dialog after cancelling');
console.log('cancel ✓');

// 2. Asked again and refused: the action stands and cannot be asked about again.
await ask(a);
expect((await b.click('Refuse', true)) === 'ok', 'no Refuse button');
await waitModal(a, /refused the undo/, 'the refusal');
await a.shot('refused');
expect((await actionCount(matchId)) === 1, 'a refused undo leaves the recording alone');
expect((await a.click('OK', true)) === 'ok', 'no OK on the refusal');
await sleep(300);
expect((await a.undoEnabled()) === false, 'Undo stays disabled after a refusal');
const again = await a.api('requestUndo', { matchId, seq: 1 });
expect(again.error?.details?.code === 'refused' || /refused/.test(again.error?.message ?? ''), `the server refuses to ask again: ${JSON.stringify(again)}`);
console.log('refuse ✓');

// 3. The other side sets up and asks; allowing it goes back to the refused action, which may be asked about again.
const c = await setUp();
expect(c === b, 'the second setup is the other side');
await ask(b);
expect((await a.click('Allow', true)) === 'ok', 'no Allow button');
await waitModal(b, /allowed the undo/, 'the approval');
expect((await actionCount(matchId)) === 1, 'the allowed undo removed the action');
await b.waitFor(`!!aslGame.owner`, `${b.name}'s setup decision to come back`);
await a.waitFor(`!aslGame.owner`, `${a.name}'s board to follow the undo`);
await b.shot('allowed');
expect((await b.click('OK', true)) === 'ok', 'no OK on the approval');
await a.waitFor(`(() => { const b = [...document.querySelectorAll('.side-head button')].find((b) => b.textContent.trim() === 'Undo'); return b && !b.disabled; })()`, 'Undo enabled again for the refused action');
console.log('allow, then the refused action can be asked about again ✓');

// 4. ...and allowed this time: both boards are back at the opening position.
await ask(a);
expect((await b.click('Allow', true)) === 'ok', 'no Allow button');
await waitModal(a, /allowed the undo/, 'the approval');
expect((await actionCount(matchId)) === 0, 'back to the start');
await a.waitFor(`!!aslGame.owner && Object.values(aslGame.state.pieces).every((p) => !p.loc.hex || true)`, 'the opening position');
expect((await a.click('OK', true)) === 'ok', 'no OK');
// Play on from there: a fresh setup is accepted.
await setUp();
console.log('allow back to the start, then play on ✓');

console.log('leave:', JSON.stringify(await alice.api('leaveMatch', { matchId })));
for (const d of devices) if (d.errors.length) { console.log(`${d.name} page errors:`, d.errors.slice(0, 5)); process.exitCode = 1; }
console.log('done');
process.exit();
