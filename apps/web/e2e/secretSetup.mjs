#!/usr/bin/env node
// Browser check that a seat's secret setup choices stay off the other board in online play (two headless Chromium
// profiles, alice and carol). Needs `pnpm dev` up and `pnpm seed alice@example.com carol@example.com`, like ping.mjs.
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
  const profile = mkdtempSync(join(tmpdir(), `asl-secret-${name}-`));
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


// Two seats in one online match of the full ASL test bed, whose Russians secretly fortify four Locations before they set
// up and may set up one squad hidden (HIP). Nothing secret may reach the German board while the Russian chooses:
//   - the fortify step: a Location clicked is never shared as the Russian's selected hex (ASLRB B23.911: "secretly
//     recorded"), and the German's panel says what is being chosen without showing it;
//   - the setup draft the German watches leaves out every squad that may set up hidden where it stands, whether or not
//     it has been hidden yet (A12.3; a unit shown and then hidden would already have been seen);
//   - a hex selected during setup is not shared when play begins.
const alice = await launch('alice', 9345, 'alice@example.com');
const carol = await launch('carol', 9346, 'carol@example.com');
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
const created = await alice.api('createMatch', { mode: 'online', scenarioId: 'asl-testbed', balance: [], side: 'ru', openSeat: true, pace: 'live' });
const matchId = created?.result?.matchId ?? fail(`createMatch: ${JSON.stringify(created)}`);
const joined = await carol.api('joinOpenMatch', { matchId });
expect(!joined.error, `joinOpenMatch: ${JSON.stringify(joined)}`);
console.log(`online match ${matchId}`);
await alice.open(matchId);
await carol.open(matchId);
const ru = alice;
const ge = carol;

const clickHex = async (d, hex) => {
  const c = await d.hexClient(hex);
  await d.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
  await d.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await d.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await sleep(300);
};

// --- the fortify step.
await ru.waitFor(`window.aslGame.owner === 'ru' && window.aslGame.decision?.kind === 'fortify'`, 'the Russian fortify step');
const designate = await ru.evaluate(`(() => { const a = window.aslGame.legal.find((a) => a.type === 'fortify.designate'); if (!a) return null; const { side, decisionId, ...rest } = a; return JSON.stringify(rest); })()`);
const picks = JSON.parse(designate ?? fail('no fortify.designate offered')).locations.map((l) => l.split(':')[0]);
for (const h of picks) await clickHex(ru, h);
await sleep(1500);
expect((await ge.evaluate('window.aslGame.theirFocus')) === null, `a Location clicked in the fortify step was shared: ${await ge.evaluate('window.aslGame.theirFocus')}`);
const waiting = await ge.evaluate(`document.querySelector('.panel.decision.waiting')?.textContent ?? ''`);
expect(/fortified/i.test(waiting) && /secret/i.test(waiting), `the German panel during the fortify step: ${waiting}`);
const button = await ru.evaluate(`[...document.querySelectorAll('button')].map((b) => b.textContent).find((t) => /then set up units/.test(t)) ?? null`);
expect(button, 'the fortify button names the setup that follows');
await ru.shot('fortify');
await ge.shot('fortify-waiting');
console.log(`fortify: clicked ${picks.join(' ')}; nothing shared; button "${button.trim()}"`);
const err = await ru.evaluate(`window.aslGame.act(${designate})`);
expect(!err, `fortify.designate: ${err}`);

// --- the Russian setup: auto-placed, nothing hidden yet.
await ru.waitFor(`window.aslGame.owner === 'ru' && window.aslGame.decision?.kind === 'setup'`, 'the Russian setup');
// The setup banner comes up a moment later and covers the board until clicked away.
for (let i = 0; i < 20; i++) { await sleep(250); if (await ru.evaluate(`(() => { const o = document.querySelector('.pw-overlay'); o?.click(); return !!o; })()`)) break; }
await sleep(600);
const rightHex = async (d, hex) => { const c = await d.hexClient(hex); await d.evaluate(`document.querySelector('.board canvas, canvas').dispatchEvent(new MouseEvent('contextmenu', { clientX: ${c.x}, clientY: ${c.y}, bubbles: true, cancelable: true, button: 2 }))`); await sleep(350); };
const wheel = (d, label) => d.evaluate(`(() => { const items = [...document.querySelectorAll('.aw-item')].map((b) => ({ b, t: b.querySelector('.aw-label')?.textContent.trim() ?? '' })); const hit = items.find((i) => i.t === ${JSON.stringify(label)}) ?? items.find((i) => i.t.startsWith(${JSON.stringify(label)})); if (!hit) return 'missing (' + items.map((i) => i.t).join(' | ') + ')'; if (hit.b.disabled) return 'disabled'; hit.b.click(); return 'ok'; })()`);
// One squad first, in Open Ground, where it may not hide: that one the German board should receive.
const openHex = await ru.evaluate(`window.aslGame.env.statics.scenario.forces.find((f) => f.side === 'ru').setup.hexes.find((h) => window.aslGame.env.query('hex.openGround', { hex: h }, false))`);
expect(openHex, 'an Open Ground hex in the Russian setup area');
// The tray starts with its first squad picked; a click on a picked counter would put it back.
const squadPicked = await ru.evaluate(`(() => { const picked = document.querySelector('.tray:not(.readonly) .tray-counter.picked'); if (picked && /\\d-\\d-\\d/.test(picked.title)) return picked.title; const b = [...document.querySelectorAll('.tray:not(.readonly) .tray-counter:not(.placed)')].find((b) => /\\d-\\d-\\d/.test(b.title)); if (!b) return null; b.click(); return b.title; })()`);
expect(squadPicked, 'a squad in the tray');
const placedAt = () => ru.evaluate(`Object.entries(window.aslGame.shown.pieces).find(([id, p]) => p.side === 'ru' && p.loc.kind === 'hex' && p.loc.hex === ${JSON.stringify(openHex)} && window.aslGame.kindOf(id) === 'squad')?.[0] ?? null`);
// The first click after the banner can be taken by the board regaining focus: click until the squad is down.
for (let i = 0; i < 4 && !(await placedAt()); i++) { await clickHex(ru, openHex); await sleep(500); }
await ru.shot('placed-open');
if (process.env.DEBUG) console.log('picked', squadPicked, '| error', await ru.evaluate(`document.querySelector('.error, .toast-error')?.textContent ?? null`), '| at hex', await ru.evaluate(`JSON.stringify(Object.entries(window.aslGame.shown.pieces).filter(([id, p]) => p.loc.hex === ${JSON.stringify(openHex)}).map(([id]) => id))`), '| ru placed', await ru.evaluate(`Object.values(window.aslGame.shown.pieces).filter((p) => p.side === 'ru' && p.loc.kind === 'hex').length`), '| selected', await ru.evaluate('window.aslGame.selectedHex'));
const inOpen = await placedAt();
expect(inOpen, `the squad placed in ${openHex}`);
const anyHex = await ru.evaluate(`[...window.aslGame.env.statics.map.hexes()][5].id`);
await rightHex(ru, anyHex);
expect((await wheel(ru, 'Auto-place the rest')) === 'ok', 'auto-place');
await sleep(2500);
const placed = JSON.parse(await ru.evaluate(`JSON.stringify(Object.fromEntries(Object.entries(window.aslGame.shown.pieces).filter(([id, p]) => p.side === 'ru' && p.loc.kind === 'hex' && window.aslGame.kindOf(id) === 'squad').map(([id, p]) => [id, p.loc.hex])))`));
const draft = JSON.parse(await ge.evaluate(`JSON.stringify(window.aslGame.theirDraft)`));
const leaked = JSON.parse(await ge.evaluate(`JSON.stringify(Object.entries(${JSON.stringify(draft)}).filter(([id, h]) => window.aslGame.kindOf(id) === 'squad' && !window.aslGame.env.query('hex.openGround', { hex: h }, false)))`));
await ge.shot('setup-draft');
console.log(`setup: ${Object.keys(placed).length} Russian squads placed; the German draft shows ${Object.keys(draft).length} counters`);
expect(draft[inOpen] === openHex, `the squad in Open Ground (${inOpen} in ${openHex}) did not reach the German board: ${JSON.stringify(draft)}`);
expect(leaked.length === 0, `squads that may still set up hidden were shown to the German: ${JSON.stringify(leaked)}`);


// --- into play: the last hex selected in setup (the Russian placing a squad selects its hex) is not shared once play
// begins; only a selection made since is.
const confirmSetup = async (d) => {
  const id = await d.evaluate('window.aslGame.decision.id');
  for (let i = 0; i < 20; i++) { await sleep(250); await d.evaluate(`document.querySelector('.pw-overlay')?.click()`); }
  const h = await d.evaluate(`window.aslGame.env.statics.scenario.forces.find((f) => f.side === window.aslGame.owner).setup.hexes[0]`);
  await rightHex(d, h);
  if ((await wheel(d, 'Auto-place the rest')) === 'ok') { await sleep(1500); await rightHex(d, h); }
  const ok = await wheel(d, 'Confirm');
  expect(ok === 'ok', `${d.name}: confirm setup: ${ok}`);
  await d.waitFor(`window.aslGame.decision?.id !== ${JSON.stringify(id)}`, `${d.name}: setup confirmed`);
};
await confirmSetup(ru);
await ge.waitFor(`window.aslGame.owner === 'ge' && window.aslGame.decision?.kind === 'setup'`, 'the German setup');
await confirmSetup(ge);
await ru.waitFor(`window.aslGame.phase !== 'setup'`, 'play to begin');
await sleep(2000);
const lastSetupHex = await ru.evaluate('window.aslGame.selectedHex');
expect(lastSetupHex, 'the Russian still has a hex selected in setup');
expect((await ge.evaluate('window.aslGame.theirFocus')) === null, `the Russian's last setup hex (${lastSetupHex}) was shared when play began`);
console.log(`play: ${await ru.evaluate('window.aslGame.phase')}; the Russian's setup selection ${lastSetupHex} not shared`);

console.log('leave:', JSON.stringify(await alice.api('leaveMatch', { matchId })));
for (const d of devices) if (d.errors.length) { console.log(`${d.name} page errors:`, d.errors.slice(0, 5)); process.exitCode = 1; }
console.log('done');
process.exit();
