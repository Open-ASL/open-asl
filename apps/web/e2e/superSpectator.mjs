#!/usr/bin/env node
// Browser check for the commentators' room (super spectators): two players (alice and carol) sit in a live online
// match; two commentators (ss1 and ss2, seeded with `pnpm seed ss1@example.com ss2@example.com --super-spectator`)
// open its commentators' board. A commentator's ping and ink must reach the other commentator and never a player;
// a rewind is shared by the room and shows REWOUND while the players play on; "Back to live" follows the game again;
// "Erase all drawings" clears the ink for both; the controls pop out into their own window and still drive the board.
// Needs `pnpm dev` up and the four accounts seeded. Options: SHOTS=<dir> saves screenshots, WEB=<url> another dev server.
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
  const profile = mkdtempSync(join(tmpdir(), `asl-ss-${name}-`));
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


const alice = await launch('alice', 9341, 'alice@example.com');
const carol = await launch('carol', 9342, 'carol@example.com');
const ss1 = await launch('ss1', 9343, 'ss1@example.com');
const ss2 = await launch('ss2', 9344, 'ss2@example.com');

// Leftovers from an earlier run: concede any active online match alice or carol sits in.
{
  const r = await fetch('http://127.0.0.1:8080/v1/projects/demo-asl-web/databases/(default)/documents/matches?pageSize=300', { headers: { authorization: 'Bearer owner' } }).then((x) => x.json());
  for (const docu of r.documents ?? []) {
    const f = docu.fields ?? {};
    if (f.mode?.stringValue !== 'online' || !['active', 'open'].includes(f.status?.stringValue)) continue;
    const mid = docu.name.split('/').pop();
    const ids = (f.playerIds?.arrayValue?.values ?? []).map((v) => v.stringValue);
    for (const d of [alice, carol]) if (ids.includes(d.token.localId)) { await d.api('leaveMatch', { matchId: mid }); break; }
  }
}
const created = await alice.api('createMatch', { mode: 'online', scenarioId: 'lma-9', balance: [], side: 'br', openSeat: true, pace: 'live' });
const matchId = created?.result?.matchId ?? fail(`createMatch: ${JSON.stringify(created)}`);
const joined = await carol.api('joinOpenMatch', { matchId });
expect(!joined.error, `joinOpenMatch: ${JSON.stringify(joined)}`);
console.log(`online match ${matchId}`);
await alice.open(matchId);
await carol.open(matchId);

/** Whoever the game waits on plays its first legal action; returns false when neither player could. */
async function playOne() {
  for (const d of [alice, carol]) {
    await d.evaluate(`window.aslGame.skip?.()`);
    const r = await d.evaluate(`(() => { const g = window.aslGame; const a = g.legal?.[0]; if (!a || !g.owner) return null; const { side, decisionId, ...rest } = a; return g.act(rest) ?? 'ok'; })()`);
    if (r === 'ok') return true;
  }
  return false;
}
const count = async () => Number((await fetch(`http://127.0.0.1:8080/v1/projects/demo-asl-web/databases/(default)/documents/matches/${matchId}`, { headers: { authorization: 'Bearer owner' } }).then((x) => x.json())).fields?.actionCount?.integerValue ?? 0);
for (let i = 0; i < 4; i++) {
  const before = await count();
  if (!(await playOne())) break;
  for (let t = 0; t < 40 && (await count()) === before; t++) await sleep(150);
}
const played = await count();
console.log(`actions played: ${played}`);

/** Open the commentators' board and wait for it to show the live game. */
async function openRoom(d) {
  await d.send('Page.navigate', { url: `${WEB}/app/match/${matchId}/ss` });
  await d.waitFor(`document.querySelector('.ss-banner') && window.aslBoard && window.aslBoard.stats().builds >= 1`, 'the commentators\' board', 30000);
  await sleep(800);
  await d.evaluate(`document.querySelector('.pw-overlay')?.click()`);
  await sleep(300);
}
const banner = (d) => d.evaluate(`document.querySelector('.ss-banner b')?.textContent ?? ''`);
const button = (d, text) => d.evaluate(`(() => { const b = [...document.querySelectorAll('.ss-controls button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)}) || x.getAttribute('aria-label') === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
// ss1 comes in the way a commentator does: watching the match, then Settings → Super spectator mode.
await ss1.open(matchId);
await ss1.evaluate(`document.querySelector('button[aria-label="Settings"]').click()`);
await ss1.waitFor(`[...document.querySelectorAll('.set-panel h3')].some((h) => h.textContent === 'Commentary')`, 'the commentator switch in Settings');
await ss1.shot('settings-switch');
await ss1.evaluate(`[...document.querySelectorAll('.set-panel section')].find((s) => s.querySelector('h3')?.textContent === 'Commentary').querySelector('input[type=checkbox]').click()`);
await ss1.waitFor(`location.pathname.endsWith('/ss') && document.querySelector('.ss-banner') && window.aslBoard?.stats().builds >= 1`, 'the board after the switch', 30000);
await sleep(800);
await ss1.evaluate(`document.querySelector('.pw-overlay')?.click()`);
// A player's Settings has no such switch.
await alice.evaluate(`document.querySelector('button[aria-label="Settings"]').click()`);
await sleep(400);
expect(!(await alice.evaluate(`[...document.querySelectorAll('.set-panel h3')].some((h) => h.textContent === 'Commentary')`)), "no commentator switch in a player's Settings");
await alice.evaluate(`document.querySelector('.set-backdrop')?.click()`);
await openRoom(ss2);
expect((await banner(ss1)).includes('LIVE'), `ss1 sees LIVE (got ${await banner(ss1)})`);
expect(await ss1.evaluate(`!!document.querySelector('.ss-controls.docked')`), 'docked controls');
await ss1.shot('room-live');

// A player is kept out of the room, claim or none.
{
  await alice.send('Page.navigate', { url: `${WEB}/app/match/${matchId}/ss` });
  await alice.waitFor(`document.querySelector('.gate-card h1')`, 'the gate');
  const gate = await alice.evaluate(`document.querySelector('.gate-card h1').textContent`);
  expect(gate === 'Commentators only' || gate === 'You play in this match', `alice is turned away (got ${gate})`);
  await alice.open(matchId);
}

// Ping: ss1's reaches ss2, never the players.
const hexes = JSON.parse(await ss1.evaluate(`JSON.stringify([...window.aslGame.env.statics.map.hexes()].map((h) => h.id))`));
const hex = hexes[Math.floor(hexes.length / 2)];
const pingsBefore = { alice: await alice.pings(), carol: await carol.pings() };
expect(await button(ss1, 'Ping'), 'Ping tool');
{
  const c = await ss1.hexClient(hex);
  await ss1.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await ss1.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
}
await sleep(250);
expect((await ss1.pings()) >= 1, 'ss1 draws its own ping');
await ss2.waitFor(`(window.aslBoard.stats().fx.ping ?? 0) >= 1`, "ss2 to receive ss1's ping", 8000);
await ss2.shot('ping-received');

// Ink: a stroke drawn by ss1 shows on ss2.
expect(await button(ss1, 'Draw'), 'Draw tool');
{
  const a = await ss1.hexClient(hexes[Math.floor(hexes.length / 2) - 20]);
  const b = await ss1.hexClient(hexes[Math.floor(hexes.length / 2) + 20]);
  await ss1.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 12; i++) await ss1.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + ((b.x - a.x) * i) / 12, y: a.y + ((b.y - a.y) * i) / 12 + 30 * Math.sin(i / 2), button: 'left', buttons: 1 });
  await ss1.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
}
await ss1.waitFor(`window.aslBoard.stats().ink >= 1`, 'ss1 ink', 8000);
await ss2.waitFor(`window.aslBoard.stats().ink >= 1`, 'ss2 to see the ink', 8000);
await ss2.shot('ink-received');
await sleep(300);
expect((await alice.pings()) === pingsBefore.alice && (await carol.pings()) === pingsBefore.carol, 'no player received a commentator ping');
expect((await alice.evaluate(`window.aslBoard.stats().ink ?? 0`)) === 0, 'no ink on a player board');

// Rewind: shared by the room, and REWOUND while the players play on.
if (played > 0) {
  expect(await button(ss1, 'Step back'), 'Step back');
  await ss2.waitFor(`document.querySelector('.ss-banner b')?.textContent.includes('REWOUND')`, 'ss2 to follow the rewind', 8000);
  await ss2.shot('rewound');
  const before = await count();
  if (await playOne()) for (let t = 0; t < 40 && (await count()) === before; t++) await sleep(150);
  await sleep(800);
  expect((await banner(ss1)).includes('REWOUND'), 'still rewound after the players played');
  expect(await button(ss1, '● Back to live'), 'Back to live');
  await ss2.waitFor(`document.querySelector('.ss-banner b')?.textContent.includes('LIVE') && !document.querySelector('.ss-banner b')?.textContent.includes('REWOUND')`, 'ss2 back to live', 8000);
  const step = await ss2.evaluate(`document.querySelector('.ss-where span')?.textContent`);
  console.log(`back to live at ${step} (recorded ${await count()})`);
}

// Autoplay: one commentator plays the room's boards on together; another can pause it.
if (played > 1) {
  expect(await button(ss1, '4×'), '4× speed');
  expect(await button(ss1, 'Start'), 'Start');
  await ss2.waitFor(`document.querySelector('.ss-where span')?.textContent.startsWith('Step 0 ')`, 'ss2 at the start', 8000);
  expect(await button(ss1, 'Play'), 'Play');
  await ss2.waitFor(`document.querySelector('.ss-hint')?.textContent && [...document.querySelectorAll('.ss-hint')].some((h) => h.textContent === 'Played by ss1')`, 'ss2 to see who plays', 8000);
  await ss2.waitFor(`Number(document.querySelector('.ss-where span')?.textContent.split(' ')[1]) >= 2`, 'ss2 to advance with the play', 30000);
  // ss2 pauses it for the room.
  expect(await button(ss2, 'Pause'), 'Pause');
  await ss1.waitFor(`[...document.querySelectorAll('.ss-controls button')].some((b) => b.getAttribute('aria-label') === 'Play')`, 'ss1 to see the pause', 8000);
  const paused = await ss1.evaluate(`document.querySelector('.ss-where span')?.textContent`);
  await sleep(1500);
  expect((await ss1.evaluate(`document.querySelector('.ss-where span')?.textContent`)) === paused, `paused stays put (${paused})`);
  // Played on to the end, a live game is followed again.
  expect(await button(ss2, 'Play'), 'Play by ss2');
  await ss1.waitFor(`document.querySelector('.ss-banner.live')`, 'the play to reach live', 40000);
  await ss1.shot('autoplay-live');
  console.log(`autoplay: paused at ${paused}, reached live`);
  // The last step played its phase wheel; it is cleared before the board is clicked again.
  for (const d of [ss1, ss2]) {
    await d.evaluate(`document.querySelector('.pw-overlay')?.click()`);
    await d.waitFor(`!document.querySelector('.pw-overlay')`, 'the phase wheel to clear', 10000);
  }
}

// Hidden information: a side's switch is shared.
await ss1.evaluate(`document.querySelector('.ss-toggle input')?.click()`);
await ss2.waitFor(`document.querySelector('.ss-toggle input')?.checked`, 'the shared hidden-info switch', 8000);

// Erase all: the ink is gone for both.
expect(await button(ss2, 'Erase all drawings'), 'Erase all');
await ss1.waitFor(`window.aslBoard.stats().ink === 0`, 'ss1 ink erased', 8000);
await ss2.waitFor(`window.aslBoard.stats().ink === 0`, 'ss2 ink erased', 8000);

// LOS and shot checks: the room sees the same card, in any phase.
const clickHex = async (d, hex, shift = false) => {
  const c = await d.hexClient(hex);
  const modifiers = shift ? 8 : 0;
  await d.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1, modifiers });
  await d.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1, modifiers });
  await sleep(150);
};
{
  // A firing hex and the nearest enemy-held hex to it, from the position on ss1's board.
  const pick = JSON.parse(await ss1.evaluate(`JSON.stringify((() => {
    const g = window.aslGame; const map = g.env.statics.map;
    const on = Object.values(g.state.pieces).filter((p) => p.loc.kind === 'hex' && g.env.statics.counters[p.defId]?.kind === 'squad');
    let best = null;
    for (const a of on) for (const b of on) {
      if (a.side === b.side) continue;
      const d = map.distance(a.loc.hex, b.loc.hex);
      if (d > 0 && (!best || d < best.d)) best = { from: a.loc.hex, to: b.loc.hex, d };
    }
    return best;
  })())`));
  expect(pick, 'two enemy squads on the map');
  console.log(`checks: ${pick.from} -> ${pick.to} (${pick.d} hexes)`);
  expect(await button(ss1, 'LOS'), 'LOS tool');
  await clickHex(ss1, pick.from);
  await clickHex(ss1, pick.to);
  await ss1.waitFor(`document.querySelector('.ss-card .ss-verdict')`, 'the LOS card', 8000);
  await ss2.waitFor(`document.querySelector('.ss-card .ss-card-kicker')?.textContent === 'Line of sight'`, 'ss2 to see the LOS card', 8000);
  await sleep(900);
  await ss2.shot('los-check');
  expect(await button(ss1, 'Shot'), 'Shot tool');
  await clickHex(ss1, pick.from);
  await clickHex(ss1, pick.to);
  await ss1.waitFor(`[...document.querySelectorAll('.ss-stats span')].some((s) => s.textContent === 'PTC or better')`, 'the shot card', 8000);
  await ss2.waitFor(`[...document.querySelectorAll('.ss-stats span')].some((s) => s.textContent === 'PTC or better')`, 'ss2 to see the shot card', 8000);
  const fp = () => ss2.evaluate(`document.querySelector('.ss-stats b')?.textContent`);
  const prepFp = await fp();
  const rows = await ss2.evaluate(`document.querySelectorAll('.ss-odds tbody tr').length`);
  expect(rows >= 1, `the target's odds listed (got ${rows} rows)`);
  await ss2.shot('shot-check');
  expect(await button(ss1, 'Advancing Fire'), 'Advancing Fire mode');
  await ss2.waitFor(`document.querySelector('.ss-stats b')?.textContent !== ${JSON.stringify(prepFp)}`, 'the FP to change with the mode', 8000);
  console.log(`shot FP: prep ${prepFp}, advancing ${await fp()}`);
  await ss1.shot('shot-advancing');
  // Esc clears the check for the room.
  await ss1.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await ss1.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await ss2.waitFor(`!document.querySelector('.ss-card')`, 'the card to clear', 8000);
  expect(!(await alice.evaluate(`!!document.querySelector('.ss-card')`)), 'no card on a player board');
}

// The virtual board: a stack dragged elsewhere is seen by the room alone; the game goes on; one button snaps back.
{
  const plan = JSON.parse(await ss1.evaluate(`JSON.stringify((() => {
    const g = window.aslGame; const map = g.env.statics.map;
    const at = (h) => Object.values(g.state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === h);
    const from = Object.values(g.state.pieces).find((p) => p.loc.kind === 'hex' && g.env.statics.counters[p.defId]?.kind === 'squad').loc.hex;
    const to = [...map.hexes()].find((h) => map.distance(h.id, from) === 2 && at(h.id).length === 0).id;
    return { from, to, n: at(from).length };
  })())`));
  console.log(`virtual: ${plan.from} (${plan.n} pieces) -> ${plan.to}`);
  const aliceBefore = await alice.evaluate(`Object.values(window.aslGame.state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === ${JSON.stringify(plan.from)}).length`);
  expect(await button(ss1, 'Move'), 'Move tool');
  const a = await ss1.hexClient(plan.from);
  const b = await ss1.hexClient(plan.to);
  await ss1.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 10; i++) await ss1.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + ((b.x - a.x) * i) / 10, y: a.y + ((b.y - a.y) * i) / 10, button: 'left', buttons: 1 });
  await ss1.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
  await ss2.waitFor(`document.querySelector('.ss-banner.virtual')`, 'ss2 to see the virtual board', 8000);
  const moved = await ss2.evaluate(`Object.values(window.aslGame.state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === ${JSON.stringify(plan.to)}).length`);
  expect(moved === plan.n, `the stack is in ${plan.to} on ss2's board (got ${moved})`);
  await ss1.shot('virtual-board');
  // The players' boards never move.
  await sleep(500);
  const aliceAfter = await alice.evaluate(`Object.values(window.aslGame.state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === ${JSON.stringify(plan.from)}).length`);
  expect(aliceAfter === aliceBefore, `alice's board unchanged (${aliceBefore} → ${aliceAfter})`);
  // A shot check reads the virtual position: from the moved stack's new hex.
  // The game goes on; the virtual board stays where it was made and says how far behind it is.
  const before = await count();
  if (await playOne()) {
    for (let t = 0; t < 40 && (await count()) === before; t++) await sleep(150);
    await ss1.waitFor(`document.querySelector('.ss-banner.virtual span')?.textContent.includes('the game is 1 action on')`, 'the virtual banner to count the game going on', 8000);
    await ss1.shot('virtual-behind');
  }
  // The timeline waits while the board is virtual.
  expect(await ss1.evaluate(`[...document.querySelectorAll('.ss-controls button')].find((x) => x.getAttribute('aria-label') === 'Step back')?.disabled`), 'step back disabled while virtual');
  expect(await button(ss2, '⟲ Snap back to live'), 'Snap back');
  await ss1.waitFor(`document.querySelector('.ss-banner.live')`, 'ss1 back to live', 8000);
  await ss2.waitFor(`document.querySelector('.ss-banner.live')`, 'ss2 back to live', 8000);
  const back = await ss1.evaluate(`Object.values(window.aslGame.state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === ${JSON.stringify(plan.to)}).length`);
  expect(back === 0, `the stack is back where the game has it (${back} left in ${plan.to})`);
  await ss1.shot('snapped-back');
  expect(await button(ss1, 'Look'), 'Look tool');
}

// The danger map: one side's at a time, over the board, for the room alone.
{
  const sides = JSON.parse(await ss1.evaluate(`JSON.stringify([...document.querySelectorAll('.ss-controls button')].map((b) => b.textContent.trim()).filter((t) => t.startsWith('Danger to ')))`));
  expect(sides.length === 2, `a danger map button per side (got ${sides})`);
  expect(await button(ss1, sides[0]), sides[0]);
  await ss2.waitFor(`document.querySelector('.ss-legend') && window.aslBoard.stats().heat > 0 && !document.querySelector('.ss-legend-sub')?.textContent.includes('working out')`, 'ss2 to draw the danger map', 30000);
  const first = await ss2.evaluate(`document.querySelector('.ss-legend b').textContent`);
  // Pointing at a hex reads out its FP and where it comes from.
  {
    const hot = await ss2.evaluate(`(() => { const g = window.aslGame; return [...g.env.statics.map.hexes()].map((h) => h.id).find((h) => Object.values(g.state.pieces).some((p) => p.loc.kind === 'hex' && p.loc.hex === h)); })()`);
    const c = await ss2.hexClient(hot);
    await ss2.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x + 3, y: c.y + 3 });
    await ss2.waitFor(`document.querySelector('.ss-legend-hover')`, 'the hover readout', 8000);
    console.log('danger readout:', await ss2.evaluate(`document.querySelector('.ss-legend-hover').textContent`));
  }
  await ss2.shot('danger-map');
  // The raw FP view, and back to the break chance.
  expect(await button(ss2, 'Raw FP'), 'Raw FP');
  await ss1.waitFor(`document.querySelector('.ss-legend-sub')?.textContent.includes('FP that can reach each hex')`, 'the raw FP legend', 8000);
  await ss1.shot('danger-map-fp');
  expect(await button(ss2, 'Break chance'), 'Break chance');
  await ss1.waitFor(`document.querySelector('.ss-legend-sub')?.textContent.includes('broken or worse')`, 'the break chance legend', 8000);
  // The other side's button replaces the map: never both.
  expect(await button(ss2, sides[1]), sides[1]);
  await ss1.waitFor(`document.querySelector('.ss-legend b')?.textContent !== ${JSON.stringify(first)} && window.aslBoard.stats().heat > 0`, 'the other side\'s map', 30000);
  expect((await ss1.evaluate(`document.querySelectorAll('.ss-legend').length`)) === 1, 'one danger map at a time');
  await ss1.evaluate(`[...document.querySelectorAll('.ss-toggle input')].find((i) => i.parentElement.textContent.includes('Hide units'))?.click()`);
  await sleep(400);
  await ss1.shot('danger-map-units-hidden');
  await ss1.evaluate(`[...document.querySelectorAll('.ss-toggle input')].find((i) => i.parentElement.textContent.includes('Hide units'))?.click()`);
  expect((await alice.evaluate(`window.aslBoard.stats().heat ?? 0`)) === 0 && !(await alice.evaluate(`!!document.querySelector('.ss-legend')`)), 'no danger map on a player board');
  // Its own button hides it.
  expect(await button(ss1, sides[1]), `${sides[1]} again`);
  await ss2.waitFor(`!document.querySelector('.ss-legend') && window.aslBoard.stats().heat === 0`, 'the map to go', 8000);
}

// Pop out: the controls open in their own window, the board drops its docked copy, and a command from the window works.
{
  // A script's window.open needs a user gesture in headless Chromium; a new tab of the same browser is the same to the link.
  await ss1.send('Target.createTarget', { url: `${WEB}/app/match/${matchId}/ss/controls` });
  let win = null;
  for (let i = 0; i < 40 && !win; i++) {
    const targets = await (await fetch('http://127.0.0.1:9343/json')).json();
    win = targets.find((t) => t.type === 'page' && t.url.includes('/ss/controls'));
    if (!win) await sleep(250);
  }
  expect(win, 'the controls window opened');
  await ss1.waitFor(`!document.querySelector('.ss-controls.docked')`, 'the docked controls to go', 10000);
  const ws = new WebSocket(win.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0; const pend = new Map();
  ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); } };
  const ev = (js) => new Promise((res) => { const i = ++n; pend.set(i, (x) => res(x.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: js, returnByValue: true } })); });
  for (let i = 0; i < 40 && !(await ev(`!!document.querySelector('.ss-controls')`)); i++) await sleep(250);
  if (SHOTS) {
    const shot = await new Promise((res) => { const i = ++n; pend.set(i, (x) => res(x.result?.data)); ws.send(JSON.stringify({ id: i, method: 'Page.captureScreenshot', params: { format: 'png' } })); });
    if (shot) writeFileSync(join(SHOTS, 'ss1-controls-window.png'), Buffer.from(shot, 'base64'));
  }
  expect(await ev(`(() => { const b = [...document.querySelectorAll('.ss-controls button')].find((x) => x.textContent.trim() === 'Draw'); b?.click(); return !!b; })()`), 'Draw in the controls window');
  await ss1.waitFor(`document.querySelector('.board-host canvas') && true`, 'board');
  await ss1.shot('popped-out');
  ws.close();
}

for (const d of devices) if (d.errors.length) { console.log(`${d.name} page errors:`, d.errors.slice(0, 5)); process.exitCode = 1; }
console.log('leave:', JSON.stringify(await alice.api('leaveMatch', { matchId })));
console.log('done');
process.exit();
