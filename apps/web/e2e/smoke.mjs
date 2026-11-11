#!/usr/bin/env node
// Browser smoke test: plays the opening of a real match in a headless Chromium against the dev
// stack and checks that what a player sees keeps working through setup, fire and movement:
//   - the board canvas is built once and never rebuilt (a rebuild blanks the screen and drops
//     every running animation),
//   - the attack preview and the tracer along the LOS play when fire is declared and resolves,
//   - a unit moves where it was sent,
//   - nothing throws or logs an error in the page.
// Needs `pnpm dev` up (web 5173, auth emulator 9099, functions 5001) and the seeded account
// (`pnpm seed alice@example.com`). Uses $CHROMIUM, else `chromium`, `chromium-browser` or
// `google-chrome`. Options: SCENARIO (default lma-9: both sides set up on board), SHOTS=<dir>
// to save screenshots, WEB=<url> for another dev server.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WEB = process.env.WEB ?? 'http://localhost:5173';
const SC = process.env.SCENARIO ?? 'lma-9';
const PORT = 9333;
const SHOTS = process.env.SHOTS ?? null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => {
  throw new Error(msg);
};

// ---------------------------------------------------------------- the browser
const candidates = [process.env.CHROMIUM, 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'].filter(Boolean);
const bin = candidates.find((c) => spawnSync('which', [c]).status === 0) ?? fail(`no Chromium found (tried ${candidates.join(', ')}); set CHROMIUM=<path>`);
const profile = mkdtempSync(join(tmpdir(), 'asl-smoke-'));
const browser = spawn(bin, [`--headless=new`, '--mute-audio', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1600,1000', '--no-first-run', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => {
  try { browser.kill(); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);

let targets = null;
for (let i = 0; i < 60 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { await sleep(250); }
}
if (!targets) fail('Chromium did not open its DevTools port');
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const pageErrors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
  if (d.method === 'Runtime.exceptionThrown') pageErrors.push(`exception: ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`);
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') pageErrors.push(`console.error: ${d.params.args.map((a) => a.description ?? a.value).join(' ')}`);
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (js) => {
  const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(`page eval failed: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}\n${js.slice(0, 200)}`);
  return r.result?.result?.value;
};
let shotN = 0;
const shot = async (name) => {
  if (!SHOTS) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, `${String(++shotN).padStart(2, '0')}-${name}.png`), Buffer.from(r.result.data, 'base64'));
};
const waitFor = async (js, what, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evaluate(`!!(${js})`)) return;
    await sleep(150);
  }
  await shot('timeout');
  fail(`timed out waiting for ${what}`);
};
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const hexClient = async (hex) => JSON.parse(await evaluate(`JSON.stringify(window.aslBoard.hexToClient(${JSON.stringify(hex)}))`)) ?? fail(`no hex ${hex}`);
const clickHex = async (hex) => { const c = await hexClient(hex); await click(c.x, c.y); await sleep(250); };
// The action wheel opens on the canvas's contextmenu event; dispatching it on the canvas itself
// works even when a readout or stack peek lies over that point.
const rightHex = async (hex) => {
  const c = await hexClient(hex);
  await evaluate(`document.querySelector('.board canvas, canvas').dispatchEvent(new MouseEvent('contextmenu', { clientX: ${c.x}, clientY: ${c.y}, bubbles: true, cancelable: true, button: 2 }))`);
  await sleep(350);
};
/** Clicks the wheel entry labelled `label` (exact, else by prefix); returns 'ok' or what was there instead. */
const wheel = async (label) =>
  evaluate(`(() => {
    const items = [...document.querySelectorAll('.aw-item')].map((b) => ({ b, t: b.querySelector('.aw-label')?.textContent.trim() ?? '' }));
    const hit = items.find((i) => i.t === ${JSON.stringify(label)}) ?? items.find((i) => i.t.startsWith(${JSON.stringify(label)}));
    if (!hit) return 'missing (wheel shows: ' + items.map((i) => i.t).join(' | ') + ')';
    if (hit.b.disabled) return 'disabled';
    hit.b.click();
    return 'ok';
  })()`);
const clickButton = async (text) =>
  evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((b) => !b.disabled && b.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return 'missing'; b.click(); return 'ok'; })()`);
const game = async () => JSON.parse(await evaluate(`JSON.stringify({ phase: aslGame.phase, owner: aslGame.owner, kind: aslGame.decision?.kind ?? null, title: document.querySelector('.panel.decision h2')?.textContent ?? '' })`));
const stats = async () => JSON.parse(await evaluate(`JSON.stringify(window.aslBoard.stats())`));
// React StrictMode mounts twice in dev, so the build count is taken as a baseline once the match
// is open; from then on it must not move and the tagged canvas element must stay in the page.
let builds0 = 0;
const canvasOk = async (when) => {
  const s = await stats();
  const tag = await evaluate(`document.querySelector('canvas')?.dataset.gen ?? 'none'`);
  if (s.builds !== builds0 || tag !== 'A') { await shot('canvas-rebuilt'); fail(`${when}: the board canvas was rebuilt (builds ${builds0} → ${s.builds}, canvas tag=${tag})`); }
};
const expect = (cond, msg) => { if (!cond) fail(msg); };

// ---------------------------------------------------------------- sign in, make a match
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
const token = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'alice@example.com', password: 'password', returnSecureToken: true }),
}).then((r) => r.json()).catch(() => null);
if (!token?.idToken) fail('cannot sign in to the auth emulator as alice@example.com: is `pnpm dev` up and `pnpm seed alice@example.com` done?');

await send('Page.navigate', { url: `${WEB}/login` });
await waitFor(`document.querySelector('input[type=email]') || location.pathname.startsWith('/app')`, 'the login page');
if (await evaluate(`!!document.querySelector('input[type=email]')`)) {
  await evaluate(`document.querySelector('input[type=email]').focus()`);
  await send('Input.insertText', { text: 'alice@example.com' });
  await evaluate(`document.querySelector('input[type=password]').focus()`);
  await send('Input.insertText', { text: 'password' });
  // The first click on the button sometimes does not take: click again until the lobby opens.
  for (let i = 0; i < 6 && !(await evaluate(`location.pathname.startsWith('/app')`)); i++) {
    await evaluate(`document.querySelector('form button.primary')?.click()`);
    await sleep(2500);
  }
  await waitFor(`location.pathname.startsWith('/app')`, 'the lobby after signing in');
}
const created = await fetch('http://127.0.0.1:5001/demo-asl-web/us-central1/createMatch', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token.idToken}` },
  body: JSON.stringify({ data: { mode: 'hotseat', scenarioId: SC, balance: [], side: 'am', pace: 'live' } }),
}).then((r) => r.json());
const matchId = created?.result?.matchId ?? fail(`createMatch failed: ${JSON.stringify(created)}`);
console.log(`match ${matchId} (${SC})`);
await send('Page.navigate', { url: `${WEB}/app/match/${matchId}` });
await waitFor(`window.aslGame && window.aslBoard && document.querySelector('canvas') && window.aslBoard.stats().builds >= 1`, 'the match to open');
await sleep(1500);
await evaluate(`document.querySelector('canvas').dataset.gen = 'A'`);
builds0 = (await stats()).builds;
expect(builds0 <= 2, `the board was built ${builds0} times while opening`);
await shot('opened');

// ---------------------------------------------------------------- setup
const emptyHex = async () =>
  evaluate(`(() => {
    const G = window.aslGame;
    const busy = new Set(Object.values(G.state.pieces).map((p) => p.loc.hex).filter(Boolean));
    for (const h of G.env.statics.map.hexes()) if (!busy.has(h.id)) return h.id;
    return null;
  })()`);
for (let round = 0; round < 8; round++) {
  const g = await game();
  if (!/set ?up|fortif/i.test(g.title)) break;
  const h = (await emptyHex()) ?? fail('no empty hex to open the wheel on');
  await rightHex(h);
  const auto = await wheel('Auto-place the rest');
  if (auto === 'ok') await sleep(600);
  else await evaluate(`document.querySelector('.aw-backdrop')?.click()`);
  await rightHex(h);
  const confirm = await wheel('Confirm');
  expect(confirm === 'ok', `setup round ${round + 1} (${g.title}): could not confirm: ${confirm}`);
  const before = JSON.stringify(g);
  await waitFor(`JSON.stringify({ phase: aslGame.phase, owner: aslGame.owner, kind: aslGame.decision?.kind ?? null, title: document.querySelector('.panel.decision h2')?.textContent ?? '' }) !== ${JSON.stringify(before)}`, `the setup step "${g.title}" to finish`);
  await sleep(400);
  await canvasOk(`after setup "${g.title}"`);
  console.log(`setup: ${g.title} ✓`);
}
await shot('setup-done');

// ---------------------------------------------------------------- phases
// Some phases take a "Done" from each player in turn (the Rally Phase), so each press is waited
// on as a change of decision, not of phase.
const SNAP = `JSON.stringify([aslGame.phase, aslGame.owner, aslGame.decision?.id ?? null])`;
/** The board follows the dice as they are revealed; orders wait for the last roll to show. */
const settled = () => waitFor(`!aslGame.resolving`, 'the dice to be revealed', 30000);
const endPhaseUntil = async (phase) => {
  for (let i = 0; i < 12; i++) {
    await settled();
    const g = await game();
    if (g.phase === phase && g.kind === 'phase') return;
    expect(g.kind === 'phase', `expected a phase decision on the way to ${phase}, got ${JSON.stringify(g)}`);
    const before = await evaluate(SNAP);
    expect((await clickButton(g.phase === 'RPh' || g.phase === 'RtPh' ? 'Done' : 'End phase')) === 'ok', `no end-phase button in ${g.phase}`);
    await sleep(400);
    await clickButton('anyway');
    await waitFor(`${SNAP} !== ${JSON.stringify(before)}`, `${g.owner}'s ${g.phase} step to end`);
    await sleep(400);
    await canvasOk(`after ${g.owner} ended a ${g.phase} step`);
  }
  fail(`never reached ${phase}`);
};
await endPhaseUntil('PFPh');
console.log('phases: reached Prep Fire ✓');

// ---------------------------------------------------------------- fire
// A stack of plain units (no leader, no weapon, so the wheel's "Fire" is a single entry) with a
// legal shot at an enemy hex, judged as the UI would judge it; one in clear LOS when there is one
// (the shot then resolves with dice), else any (it fires for nothing, with the red tracer).
const pair = JSON.parse(
  await evaluate(`(() => {
    const G = window.aslGame, S = G.state, own = G.owner;
    const at = {};
    for (const p of Object.values(S.pieces)) if (p.loc.kind === 'hex') (at[p.loc.hex] ??= []).push(p);
    const carries = (u) => Object.values(S.pieces).some((p) => G.kindOf(p.id) === 'sw' && JSON.stringify(p.loc).includes('"' + u.id + '"'));
    const mine = Object.entries(at).filter(([, ps]) => ps.every((p) => p.side === own && !['leader', 'sw'].includes(G.kindOf(p.id)) && !carries(p)));
    const theirs = Object.entries(at).filter(([, ps]) => ps.some((p) => p.side !== own));
    const legal = [];
    for (const [from, ps] of mine) for (const [to] of theirs) if (!G.fireIllegal({ units: ps.map((p) => p.id), sw: [], target: to })) legal.push({ from, to });
    const clear = legal.find((x) => G.env.query('los.trace', { from: x.from, to: x.to }, { clear: false }).clear);
    const pick = clear ?? legal[0];
    return pick ? JSON.stringify({ ...pick, los: !!clear }) : 'null';
  })()`),
);
expect(pair, 'no legal shot between the placed stacks (nothing to fire with in Prep Fire)');
console.log(`fire: ${pair.from} → ${pair.to}${pair.los ? '' : ' (no LOS: fires for nothing)'}`);
await clickHex(pair.from);
await rightHex(pair.from);
expect((await wheel('Fire')) === 'ok', 'could not declare fire from the wheel');
await sleep(300);
const s0 = await stats();
const state0 = await evaluate(`JSON.stringify(aslGame.state)`);
await rightHex(pair.to);
expect((await wheel('Preview attack')) === 'ok', 'no "Preview attack" on the target hex');
await waitFor(`/\\bFP\\b/.test(document.querySelector('.panel.decision')?.textContent ?? '')`, 'the attack preview (FP, column, DRM) in the panel');
await shot('preview');
console.log('fire: attack previewed ✓');
// The dice log stays open while the shot is made: players keep it up to see every roll as it lands.
await evaluate(`document.querySelector('.log-btn')?.click()`);
await sleep(200);
const logged0 = await evaluate(`document.querySelectorAll('.dice-log .dice-toast').length`);
await rightHex(pair.to);
expect((await wheel('Fire at this hex')) === 'ok', 'no "Fire at this hex" on the target');
const t0 = Date.now();
await waitFor(`aslGame.resolving || JSON.stringify(aslGame.state) !== ${JSON.stringify(state0)}`, 'the fire to resolve');
// A shot with dice holds its outcome back until the roll is revealed; one without LOS has no dice.
const rolled = await evaluate(`aslGame.resolving`);
await settled();
if (rolled) console.log(`fire: outcome revealed with the dice, ${Date.now() - t0} ms after the shot ✓`);
if (rolled) {
  const logged = await evaluate(`document.querySelectorAll('.dice-log .dice-toast').length`);
  expect(logged > logged0, `the open dice log did not get the roll (${logged0} → ${logged})`);
  console.log('fire: the roll landed in the open dice log ✓');
}
await evaluate(`document.querySelector('.log-btn')?.click()`);
await sleep(800);
await shot('fired');
await canvasOk('after fire');
const s1 = await stats();
expect((s1.fx.tracer ?? 0) > (s0.fx.tracer ?? 0), 'no tracer ran along the LOS when the fire resolved');
expect(s1.fxPlayed > s0.fxPlayed + 1, 'only the tracer played: no burst, result or "NO LOS" text followed it');
console.log(`fire: resolved; tracer and ${s1.fxPlayed - s0.fxPlayed - 1} more effect(s) played ✓`);

// ---------------------------------------------------------------- movement
await endPhaseUntil('MPh');
// Three squads are piled into one hex by engine orders first, so that the mover beside them has a
// step that the stacking limit refuses (SK4 2.0: three squad-equivalents); auto-place spreads them out.
const actJs = (a) => `aslGame.act(${JSON.stringify(a)})`;
const act = async (a) => { const r = await evaluate(actJs(a)); if (r) throw new Error(`act ${a.type} refused: ${r}`); await sleep(150); };
/** Answer Defensive First Fire with a pass whenever the defender is asked. */
const passFire = async () => { for (let i = 0; i < 20; i++) { await settled(); if ((await evaluate(`aslGame.decision?.kind ?? null`)) !== 'firstFire') return; await act({ type: 'defPass' }); } };
const pile = JSON.parse(
  await evaluate(`(() => {
    const G = window.aslGame, S = G.state, map = G.env.statics.map;
    const squads = G.legal.filter((a) => a.type === 'move.start' && a.units.length === 1 && G.kindOf(a.units[0]) === 'squad').map((a) => ({ unit: a.units[0], hex: S.pieces[a.units[0]].loc.hex }));
    for (const t of squads) {
      const near = squads.filter((q) => q !== t && map.distance(q.hex, t.hex) <= 2).sort((a, b) => map.distance(a.hex, t.hex) - map.distance(b.hex, t.hex));
      const mover = near.find((q) => map.distance(q.hex, t.hex) === 1);
      const fillers = near.filter((q) => q !== mover).slice(0, 2);
      if (mover && fillers.length === 2) return JSON.stringify({ to: t.hex, mover, fillers });
    }
    return 'null';
  })()`),
);
let mover;
if (pile) {
  for (const f of pile.fillers) {
    await act({ type: 'move.start', units: [f.unit] });
    await passFire();
    for (let i = 0; i < 4; i++) {
      const here = await evaluate(`aslGame.state.pieces[${JSON.stringify(f.unit)}].loc.hex`);
      if (here === pile.to) break;
      const next = await evaluate(`(() => { const G = window.aslGame, map = G.env.statics.map; let best = null; for (const a of G.legal) if (a.type === 'move.step') { const d = map.distance(a.to, ${JSON.stringify(pile.to)}); if (!best || d < best.d) best = { to: a.to, d }; } return best ? best.to : null; })()`);
      if (!next) break;
      await act({ type: 'move.step', to: next });
      await passFire();
    }
    // A unit that spent all its MF getting there has ended its move by itself.
    await sleep(600);
    if (await evaluate(`aslGame.legal.some((a) => a.type === 'move.end')`)) await act({ type: 'move.end' });
    await passFire();
  }
  const piled = await evaluate(`Object.values(aslGame.state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === ${JSON.stringify(pile.to)} && aslGame.kindOf(p.id) === 'squad').length`);
  expect(piled === 3, `piled ${piled} squads into ${pile.to}, not 3`);
  console.log(`move: ${pile.fillers.map((f) => f.unit).join(' and ')} piled into ${pile.to} (3 squads) by engine orders`);
  mover = pile.mover;
} else {
  mover = JSON.parse(await evaluate(`(() => { const a = aslGame.legal.find((a) => a.type === 'move.start'); if (!a) return 'null'; const u = a.units[0]; return JSON.stringify({ unit: u, hex: aslGame.state.pieces[u].loc.hex }); })()`));
  console.log('move: no three squads within reach of each other, the stacking refusal is not set up');
}
expect(mover, 'nothing may start moving in the Movement Phase');
await clickHex(mover.hex);
await rightHex(mover.hex);
expect((await wheel('Move')) === 'ok', 'could not start a move from the wheel');
await settled();
await waitFor(`aslGame.legal.some((a) => a.type === 'move.step')`, 'move steps to be offered');
// A neighbouring hex the stack may not step into (overstacked, enemy-held, out of MF) is refused
// with the reason on screen, like any other illegal order; the overstacked one when there is one.
const refused = JSON.parse(
  await evaluate(`(() => {
    const G = window.aslGame;
    const steps = new Set(G.legal.filter((a) => a.type === 'move.step').map((a) => a.to));
    const out = G.env.statics.map.neighbors(${JSON.stringify(mover.hex)}).filter((h) => !steps.has(h)).map((h) => ({ hex: h, why: G.check({ type: 'move.step', to: h }) })).filter((x) => x.why);
    return JSON.stringify(out.find((x) => /stacking/i.test(x.why)) ?? out[0] ?? null);
  })()`),
);
if (pile) expect(refused && /stacking/i.test(refused.why), `no stacking refusal offered for ${pile.to} beside ${mover.hex}: ${JSON.stringify(refused)}`);
if (refused) {
  await clickHex(refused.hex);
  await waitFor(`(document.querySelector('.panel .error')?.textContent ?? '') === ${JSON.stringify(refused.why)}`, `the refusal "${refused.why}" to show for a step into ${refused.hex}`);
  expect((await evaluate(`aslGame.state.pieces[${JSON.stringify(mover.unit)}].loc.hex`)) === mover.hex, `the unit left ${mover.hex} on a refused step`);
  await shot('refused-step');
  console.log(`move: step into ${refused.hex} refused on screen: "${refused.why}" ✓`);
} else console.log('move: every neighbour is enterable, refusal message not exercised');
const to = await evaluate(`aslGame.legal.find((a) => a.type === 'move.step').to`);
await clickHex(to);
await waitFor(`aslGame.state.pieces[${JSON.stringify(mover.unit)}].loc.hex === ${JSON.stringify(to)}`, `the unit to step into ${to}`);
await sleep(600);
await shot('moved');
await canvasOk('after a move step');
// A step in view of the enemy offers the defender Defensive First Fire first.
await passFire();
await rightHex(to);
expect((await wheel('End move')) === 'ok', 'could not end the move from the wheel');
await sleep(500);
await canvasOk('after ending the move');
console.log(`move: ${mover.unit} ${mover.hex} → ${to} ✓`);

// A unit walked until its MF are spent ends its move by itself: nobody orders the end.
const walker = await evaluate(`(() => { const a = aslGame.legal.find((a) => a.type === 'move.start' && a.units.length === 1 && aslGame.kindOf(a.units[0]) === 'squad'); return a ? a.units[0] : null; })()`);
if (walker) {
  await act({ type: 'move.start', units: [walker] });
  await passFire();
  const path = [await evaluate(`aslGame.state.pieces[${JSON.stringify(walker)}].loc.hex`)];
  for (let i = 0; i < 12; i++) {
    await settled();
    const next = await evaluate(`(() => { const seen = new Set(${JSON.stringify(path)}); const a = aslGame.legal.find((a) => a.type === 'move.step' && !seen.has(a.to)); return a ? a.to : null; })()`);
    if (!next) break;
    await act({ type: 'move.step', to: next });
    path.push(next);
    await passFire();
  }
  await waitFor(`!aslGame.legal.some((a) => a.type === 'move.end') && aslGame.state.pieces[${JSON.stringify(walker)}].tags.moved === true`, `${walker} to end its move by itself once out of MF`, 5000);
  await canvasOk('after a move ended by itself');
  console.log(`move: ${walker} ${path.join(' → ')}, out of MF, move ended by itself ✓`);
}

// ---------------------------------------------------------------- verdict
const final = await stats();
console.log(`board: built ${final.builds}× (${builds0} while opening), ${final.fxPlayed} effects played`);
if (pageErrors.length) {
  console.error('page errors:\n  ' + pageErrors.join('\n  '));
  fail(`${pageErrors.length} error(s) in the page`);
}
console.log('SMOKE PASS');
ws.close();
process.exit(0);
