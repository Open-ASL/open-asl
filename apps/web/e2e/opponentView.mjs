#!/usr/bin/env node
// Browser check for what the other seat sees (two headless Chromium profiles, alice and carol, in
// one online lma-9 match):
//   - setup: while one player lays out their counters, the other sees their tray fill (read-only,
//     grouped as the card groups it, each placed counter with its hex) before they confirm;
//   - movement: the moving stack's MF left is a badge on the map for both players;
//   - ending a move gives the defender a last Defensive First Fire chance there (SK1 3.3.1), with
//     the "Move over" wording.
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
  const profile = mkdtempSync(join(tmpdir(), `asl-opp-${name}-`));
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
// ---------------------------------------------------------------- the three features under test
const created = await alice.api('createMatch', { mode: 'online', scenarioId: 'lma-9', balance: [], side: 'br', openSeat: true, pace: 'live' });
const matchId = created?.result?.matchId ?? fail(`createMatch: ${JSON.stringify(created)}`);
const joined = await carol.api('joinOpenMatch', { matchId });
expect(!joined.error, `joinOpenMatch: ${JSON.stringify(joined)}`);
await alice.open(matchId);
await carol.open(matchId);
console.log('match', matchId);
const both = [alice, carol];
const G = (d) => d.evaluate(`JSON.stringify({ phase: aslGame.phase, owner: aslGame.owner, kind: aslGame.decision?.kind ?? null, decOwner: aslGame.decision?.owner ?? null, id: aslGame.decision?.id ?? null, ending: aslGame.decision?.data?.ending ?? null, title: document.querySelector('.panel.decision h2')?.textContent ?? '' })`).then(JSON.parse);
/** The device seated as the side whose decision it is (both screens agree on the decision). */
const actor = async () => { for (let i = 0; i < 60; i++) { for (const d of both) { const g = await G(d); if (g.owner && g.owner === g.decOwner) return d; } await sleep(300); } return null; };
const other = (d) => (d === alice ? carol : alice);
const settled = (d) => d.waitFor(`!aslGame.resolving`, 'dice revealed', 30000);
const act = async (d, a) => { await settled(d); const r = await d.evaluate(`aslGame.act(${JSON.stringify(a)})`); if (r) fail(`${d.name}: act ${a.type} refused: ${r}`); await sleep(300); };
for (const d of both) d.rightHex = async (hex) => { const c = await d.hexClient(hex); await d.evaluate(`document.querySelector('.board canvas, canvas').dispatchEvent(new MouseEvent('contextmenu', { clientX: ${c.x}, clientY: ${c.y}, bubbles: true, cancelable: true, button: 2 }))`); await sleep(350); };
const wheel = (d, label) => d.evaluate(`(() => { const items = [...document.querySelectorAll('.aw-item')].map((b) => ({ b, t: b.querySelector('.aw-label')?.textContent.trim() ?? '' })); const hit = items.find((i) => i.t === ${JSON.stringify(label)}) ?? items.find((i) => i.t.startsWith(${JSON.stringify(label)})); if (!hit) return 'missing (' + items.map((i) => i.t).join(' | ') + ')'; if (hit.b.disabled) return 'disabled'; hit.b.click(); return 'ok'; })()`);
const clickButton = (d, text) => d.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((b) => !b.disabled && b.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return 'missing'; b.click(); return 'ok'; })()`);
const emptyHex = (d) => d.evaluate(`(() => { const G = window.aslGame; const busy = new Set(Object.values(G.shown.pieces).map((p) => p.loc.hex).filter(Boolean)); for (const h of G.env.statics.map.hexes()) if (!busy.has(h.id)) return h.id; return null; })()`);

// --- #1 setup: the placing player auto-places, the other one sees their tray fill before they confirm.
for (let round = 0; round < 6; round++) {
  await sleep(1200);
  const d = await actor();
  if (!d) fail('nobody owns the decision');
  const g = await G(d);
  if (!/set ?up/i.test(g.title)) break;
  const w = other(d);
  await w.shot(`setup-${round}-their-tray-empty`);
  const trayBefore = await w.evaluate(`document.querySelectorAll('.tray.readonly .tray-counter').length`);
  const placedBefore = await w.evaluate(`document.querySelectorAll('.tray.readonly .tray-counter.placed').length`);
  const h = await emptyHex(d);
  await d.rightHex(h);
  const auto = await wheel(d, 'Auto-place the rest');
  console.log(`${d.name} auto-place: ${auto}`);
  await sleep(1500);
  await w.waitFor(`document.querySelectorAll('.tray.readonly .tray-counter.placed').length > ${placedBefore}`, "the opponent's placed counters to show in their tray", 15000);
  const placedAfter = await w.evaluate(`document.querySelectorAll('.tray.readonly .tray-counter.placed').length`);
  const hexes = await w.evaluate(`[...document.querySelectorAll('.tray.readonly .tray-hex')].slice(0, 5).map((e) => e.textContent).join(',')`);
  console.log(`setup ${round}: ${w.name} sees ${d.name}'s tray: ${trayBefore} counters, placed ${placedBefore} → ${placedAfter} (${hexes}…)`);
  await w.shot(`setup-${round}-their-tray-filled`);
  await d.rightHex(h);
  const confirm = await wheel(d, 'Confirm');
  expect(confirm === 'ok', `confirm: ${confirm}`);
  await d.waitFor(`(document.querySelector('.panel.decision h2')?.textContent ?? '') !== ${JSON.stringify(g.title)} || aslGame.decision?.id !== ${JSON.stringify(g.id)}`, 'setup confirmed');
}
console.log('setup done');

// --- to the MPh
for (let i = 0; i < 12; i++) {
  await sleep(600);
  const d = await actor();
  if (!d) fail('nobody owns the decision');
  await settled(d);
  const g = await G(d);
  if (g.phase === 'MPh' && g.kind === 'phase') break;
  const r = await clickButton(d, g.phase === 'RPh' || g.phase === 'RtPh' ? 'Done' : 'End phase');
  expect(r === 'ok', `${d.name}: no end button in ${g.phase}`);
  await sleep(400);
  await clickButton(d, 'anyway');
  await d.waitFor(`aslGame.decision?.id !== ${JSON.stringify(g.id)}`, 'phase step to end');
}
const mover = await actor();
const watcher = other(mover);
console.log(`MPh: ${mover.name} moves`);

// --- #2/#3: move a squad towards the enemy until the defender is asked; the watcher sees the MF badge.
const pick = JSON.parse(await mover.evaluate(`(() => { const G = window.aslGame, S = G.state, map = G.env.statics.map; const enemy = Object.values(S.pieces).filter((p) => p.side !== G.owner && p.loc.kind === 'hex').map((p) => p.loc.hex); let best = null; for (const a of G.legal) { if (a.type !== 'move.start' || a.units.length !== 1 || G.kindOf(a.units[0]) !== 'squad') continue; const h = S.pieces[a.units[0]].loc.hex; if (!h || !map.hex(h)) continue; const d = Math.min(...enemy.map((e) => map.distance(h, e))); if (!best || d < best.d) best = { unit: a.units[0], hex: h, d }; } return JSON.stringify(best); })()`));
console.log('mover picks', pick);
await act(mover, { type: 'move.start', units: [pick.unit], doubleTime: true });
let asked = false;
for (let step = 0; step < 8; step++) {
  await sleep(500);
  const next = await mover.evaluate(`(() => { const G = window.aslGame, S = G.state, map = G.env.statics.map; const enemy = Object.values(S.pieces).filter((p) => p.side !== G.owner && p.loc.kind === 'hex').map((p) => p.loc.hex); let best = null; for (const a of G.legal) if (a.type === 'move.step') { const d = Math.min(...enemy.map((e) => map.distance(a.to, e))); if (!best || d < best.d) best = { to: a.to, d }; } return best ? best.to : null; })()`);
  if (!next) break;
  await act(mover, { type: 'move.step', to: next });
  await sleep(900);
  if (step === 0) { await mover.shot('badge-mover'); await watcher.shot('badge-watcher'); }
  const g = await G(watcher);
  if (g.kind === 'firstFire') {
    asked = true;
    console.log(`step ${step + 1}: ${watcher.name} asked for First Fire (${g.title})`);
    await watcher.shot('first-fire-moving');
    await act(watcher, { type: 'defPass' });
    await mover.waitFor(`aslGame.decision?.kind === 'phase'`, 'the pass to arrive');
    break;
  }
}
expect(asked, 'the defender was never asked during the move');
await act(mover, { type: 'move.end' });
await watcher.waitFor(`aslGame.decision?.kind === 'firstFire' && aslGame.decision?.data?.ending === true`, 'the end-of-move First Fire chance', 10000);
await sleep(500);
const g2 = await G(watcher);
console.log(`move.end: ${watcher.name} sees "${g2.title}" (ending=${g2.ending})`);
await watcher.shot('first-fire-ending');
await mover.shot('mover-waiting-ending');
await act(watcher, { type: 'defPass' });
await mover.waitFor(`aslGame.decision?.kind === 'phase' && aslGame.owner === aslGame.decision?.owner`, 'the move to be over');
console.log('stack finished:', await mover.evaluate(`JSON.stringify(aslGame.state.pieces[${JSON.stringify(pick.unit)}].tags)`));
for (const d of both) if (d.errors.length) console.log(`${d.name} page errors:`, d.errors.slice(0, 5));
console.log('leave:', JSON.stringify(await alice.api('leaveMatch', { matchId })));
console.log('FEEDBACK CHECK PASS');
process.exit(0);
