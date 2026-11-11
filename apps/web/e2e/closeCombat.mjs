#!/usr/bin/env node
// Browser check of the Close Combat overlay: plays a hotseat match (lma-9) until a German stack
// has walked into contact and advanced into the Canadian hex, then drives the overlay as a player
// would: a leader dragged onto a squad in the arrange step, units and targets dragged into attack
// groups (a second group made on the dashed card and merged back), the odds read off the card,
// both sides locking in, both results shown with their dice, the overlay fading out, and no page
// errors. Same plumbing and options as smoke.mjs: needs `pnpm dev` and the seeded account;
// SHOTS=<dir> saves screenshots; WEB=<url> for another dev server.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WEB = process.env.WEB ?? 'http://localhost:5173';
const SC = process.env.SCENARIO ?? 'lma-9';
const PORT = 9334;
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
  await evaluate(`document.querySelector('form button.primary').click()`);
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

// ---------------------------------------------------------------- walk a unit into contact, then advance into the enemy
const actJs = (a) => `aslGame.act(${JSON.stringify(a)})`;
const act = async (a) => { const r = await evaluate(actJs(a)); if (r) throw new Error(`act ${a.type} refused: ${r}`); await sleep(150); };
const kind = async () => evaluate(`aslGame.decision?.kind ?? null`);
/** Answer Defensive First Fire with a pass whenever the defender is asked. */
const passFire = async () => { for (let i = 0; i < 20; i++) { await settled(); if ((await kind()) !== 'firstFire') return; await act({ type: 'defPass' }); } };
const nearest = async () => JSON.parse(await evaluate(`(() => {
  const G = window.aslGame, S = G.state, own = G.owner, map = G.env.statics.map;
  const at = {};
  for (const p of Object.values(S.pieces)) if (p.loc.kind === 'hex' && ['squad','hs','leader'].includes(G.kindOf(p.id)) && !p.tags.broken) (at[p.loc.hex] ??= []).push(p);
  const cover = (h) => { const t = map.hex(h)?.terrain ?? ''; return /building|woods/i.test(t) ? 1 : 0; };
  let best = null;
  for (const [from, ps] of Object.entries(at)) {
    if (!ps.every((p) => p.side === own)) continue;
    for (const [to, ts] of Object.entries(at)) {
      if (!ts.some((p) => p.side !== own)) continue;
      const d = map.distance(from, to);
      const score = d * 100 - (d <= 2 ? ps.length * 10 + cover(to) * 5 : 0);
      if (!best || score < best.score) best = { units: ps.map((p) => p.id), unit: ps[0].id, from, enemy: to, d, score, cover: cover(to) };
    }
  }
  return JSON.stringify(best);
})()`));
let contact = null;
/** My nearest unmoved stack to `enemy` (or to any enemy), with the hex it is in. */
const nearestTo = async (enemy, moved) => JSON.parse(await evaluate(`(() => {
  const G = window.aslGame, S = G.state, own = G.owner, map = G.env.statics.map, moved = new Set(${JSON.stringify([...moved])});
  const at = {};
  for (const p of Object.values(S.pieces)) if (p.loc.kind === 'hex' && ['squad','hs','leader'].includes(G.kindOf(p.id)) && !p.tags.broken && !moved.has(p.id)) (at[p.loc.hex] ??= []).push(p);
  let best = null;
  for (const [from, ps] of Object.entries(at)) {
    if (!ps.every((p) => p.side === own)) continue;
    const d = map.distance(from, ${JSON.stringify(enemy)});
    if (!best || d < best.d || (d === best.d && ps.length > best.units.length)) best = { units: ps.map((p) => p.id), unit: ps[0].id, from, enemy: ${JSON.stringify(enemy)}, d };
  }
  return JSON.stringify(best);
})()`));
const moved = new Set();
for (let turn = 0; turn < 6 && !contact; turn++) {
  await endPhaseUntil('MPh');
  for (let moves = 0; moves < 6; moves++) {
    const n = contact ? await nearestTo(contact.enemy, moved) : await nearest();
    if (!n) break;
    if (!contact && n.d <= 1) { contact = n; continue; }
    if (contact && n.d > 4) break;
    if (n.d <= 1) { n.units.forEach((u) => moved.add(u)); continue; }
    // The whole stack moves together when the rules let it, else its first unit.
    let started = await evaluate(actJs({ type: 'move.start', units: n.units }));
    if (started) {
      const start = await evaluate(`JSON.stringify(aslGame.legal.find((a) => a.type === 'move.start' && a.units.includes(${JSON.stringify(n.unit)})) ?? null)`);
      if (start === 'null') { n.units.forEach((u) => moved.add(u)); continue; }
      n.units = JSON.parse(start).units;
      await act(JSON.parse(start));
    }
    n.units.forEach((u) => moved.add(u));
    await sleep(150);
    for (let step = 0; step < 12; step++) {
      await passFire();
      const next = JSON.parse(await evaluate(`(() => {
        const G = window.aslGame, map = G.env.statics.map, enemy = ${JSON.stringify(n.enemy)};
        const steps = G.legal.filter((a) => a.type === 'move.step' && !a.lowCrawl);
        let best = null;
        for (const s of steps) { const d = map.distance(s.to, enemy); if (!best || d < best.d) best = { a: s, d }; }
        return JSON.stringify(best);
      })()`));
      const here = await evaluate(`aslGame.state.pieces[${JSON.stringify(n.unit)}].loc.hex`);
      const dHere = await evaluate(`aslGame.env.statics.map.distance(${JSON.stringify(here)}, ${JSON.stringify(n.enemy)})`);
      if (!next || next.d >= dHere || dHere <= 1) break;
      await act(next.a);
      await passFire();
    }
    await passFire();
    const endMove = await evaluate(`JSON.stringify(aslGame.legal.find((a) => a.type === 'move.end') ?? null)`);
    if (endMove !== 'null') await act(JSON.parse(endMove));
    await passFire();
    const now = await evaluate(`aslGame.state.pieces[${JSON.stringify(n.unit)}].loc.hex`);
    const dNow = await evaluate(`aslGame.env.statics.map.distance(${JSON.stringify(now)}, ${JSON.stringify(n.enemy)})`);
    console.log(`move: ${n.units.join('+')} ${n.from} → ${now} (distance ${n.d} → ${dNow})`);
    if (!contact && dNow <= 1) contact = { ...n, from: now, d: dNow };
  }
  if (contact) {
    await endPhaseUntil('APh');
    // Everyone of mine next to the enemy hex advances in, stack by stack.
    const stacks = JSON.parse(await evaluate(`(() => {
      const G = window.aslGame, S = G.state, own = G.owner, map = G.env.statics.map, enemy = ${JSON.stringify(contact.enemy)};
      const at = {};
      for (const p of Object.values(S.pieces)) if (p.side === own && p.loc.kind === 'hex' && ['squad','hs','leader'].includes(G.kindOf(p.id)) && !p.tags.broken && map.distance(p.loc.hex, enemy) === 1) (at[p.loc.hex] ??= []).push(p.id);
      return JSON.stringify(Object.entries(at));
    })()`));
    const advanced = [];
    for (const [from, units] of stacks) {
      const err = await evaluate(actJs({ type: 'advance', units, to: contact.enemy }));
      if (err) { for (const u of units) if (!(await evaluate(actJs({ type: 'advance', units: [u], to: contact.enemy })))) advanced.push(u); }
      else advanced.push(...units);
      await sleep(150);
    }
    expect(advanced.length, `nobody could advance into ${contact.enemy}`);
    contact.units = advanced;
    console.log(`advance: ${advanced.join(', ')} → ${contact.enemy}${contact.cover ? ' (cover: ambush possible)' : ''} ✓`);
    await settled();
    await clickButton('End phase'); await sleep(300); await clickButton('anyway');
    await waitFor(`aslGame.phase === 'CCPh'`, 'the Close Combat Phase');
    break;
  }
  // Nobody got into contact this turn: play the other side's turn out and try again.
  await endPhaseUntil('MPh');
}
expect(contact, 'no unit reached an enemy hex in six turns');

// ---------------------------------------------------------------- the overlay
await settled();
await waitFor(`document.querySelector('.cc-overlay')`, 'the Close Combat overlay');
await sleep(600);
await shot('cc-open');
const g0 = await game();
console.log(`cc: overlay open, decision ${g0.kind} for ${g0.owner}`);
const rect = async (sel) => JSON.parse(await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); })()`));
const drag = async (fromSel, toSel) => {
  const a = await rect(fromSel), b = await rect(toSel);
  expect(a && b, `drag: missing ${!a ? fromSel : toSel}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 8; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8, button: 'left' }); await sleep(30); }
  await shot('cc-dragging');
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
  await sleep(250);
};
const count = async (sel) => evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
await evaluate(`document.querySelector('.pw-overlay')?.click()`);
await waitFor(`!document.querySelector('.pw-overlay')`, 'the phase wheel to go');
if (g0.kind === 'ccArrange') {
  // A leader dragged onto another of his side's squads restacks him there.
  const leader = await evaluate(`document.querySelector('.cc-pool .cc-unit.grab')?.dataset.ccUnit ?? null`);
  const targets = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('.cc-stack.target')].map((s) => s.dataset.ccZone))`));
  console.log(`cc: arrange step, leader ${leader}, stacks ${targets.join(' ')}`);
  if (leader && targets.length >= 2) {
    const onBefore = await evaluate(`aslGame.state.pieces[${JSON.stringify(leader)}].tags.stackedOn ?? null`);
    const dest = targets.find((z) => z !== 'stack:' + onBefore);
    await drag(`[data-cc-unit="${leader}"]`, `[data-cc-zone="${dest}"]`);
    await sleep(300);
    const onAfter = await evaluate(`aslGame.state.pieces[${JSON.stringify(leader)}].tags.stackedOn ?? null`);
    expect('stack:' + onAfter === dest, `the leader was not restacked by the drag (${onBefore} → ${onAfter}, wanted ${dest})`);
    console.log(`cc: leader restacked ${onBefore} → ${onAfter} ✓`);
    await shot('cc-arranged');
  }
  expect((await clickButton('Leaders arranged')) === 'ok', 'no "Leaders arranged" button');
  await settled();
  const g1 = await game();
  if (g1.kind === 'ccArrange') { await clickButton('Leaders arranged'); await settled(); }
}
await waitFor(`aslGame.decision?.kind === 'ccDeclare' && !aslGame.resolving`, 'the declaration step');
await sleep(400);
await shot('cc-declare');
const ambush = await evaluate(`document.querySelector('.cc-ambush')?.textContent ?? ''`);
if (ambush) console.log(`cc: ambush strip "${ambush}"`);
const pools = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('.cc-pool')].map((p) => ({ zone: p.dataset.ccZone, units: [...p.querySelectorAll('.cc-unit')].map((u) => ({ id: u.dataset.ccUnit, grab: u.classList.contains('grab') })) })))`));
console.log('cc pools:', JSON.stringify(pools));
const owner0 = await evaluate(`aslGame.owner`);
const myPool = pools.find((p) => p.zone === `pool:${owner0}`), theirPool = pools.find((p) => p.zone !== `pool:${owner0}`);
const myUnit = myPool.units.find((u) => u.grab) ?? fail('no draggable unit of mine');
const theirUnit = theirPool.units.find((u) => u.grab) ?? fail('no draggable enemy unit');
await drag(`[data-cc-unit="${myUnit.id}"]`, `[data-cc-zone="g:0:a"]`);
expect((await count('.cc-group.mine .cc-zone.a .cc-unit')) >= 1, 'the dragged attacker did not land in the group');
await drag(`[data-cc-unit="${theirUnit.id}"]`, `[data-cc-zone="g:0:t"]`);
expect((await count('.cc-group.mine .cc-zone.t .cc-unit')) >= 1, 'the dragged target did not land in the group');
const second = myPool.units.filter((u) => u.grab)[1];
if (second) {
  await drag(`[data-cc-unit="${second.id}"]`, `[data-cc-zone="new"]`);
  expect((await count('.cc-group.mine')) === 2, 'dropping on the dashed card did not make a second attack group');
  await shot('cc-two-groups');
  await drag(`[data-cc-unit="${second.id}"]`, `[data-cc-zone="g:0:a"]`);
  expect((await count('.cc-group.mine')) === 1 && (await count('.cc-group.mine .cc-zone.a .cc-unit')) === 2, 'the second unit did not rejoin the first group');
  console.log('cc: second attack group made and merged back ✓');
}
const odds = await evaluate(`document.querySelector('.cc-group.mine .cc-odds')?.textContent ?? ''`);
console.log(`cc: group built, odds "${odds}" (${await evaluate(`document.querySelector('.cc-group.mine .cc-fp')?.textContent ?? ''`)})`);
expect(/^\d+-\d+$|^<|^>/.test(odds), `odds not shown QRDC-style: "${odds}"`);
await sleep(300);
await shot('cc-odds');
// Tap a unit back out and in again (click fallback).
expect((await clickButton('Lock in attacks')) === 'ok', 'no "Lock in attacks" button (or it is disabled)');
await settled();
await waitFor(`aslGame.decision?.kind === 'ccDeclare' && !aslGame.resolving`, 'the other side to declare');
await sleep(300);
await shot('cc-other-declares');
expect((await count('.cc-cards .cc-group')) >= 1, 'the locked-in attack is not shown to the other side');
expect((await clickButton('Everyone in')) === 'ok', 'no "Everyone in" button');
await sleep(200);
expect((await clickButton('Lock in attacks')) === 'ok', 'the second side could not lock in');
await sleep(1200);
await shot('cc-rolling');
await waitFor(`document.querySelectorAll('.cc-cards .cc-group.done').length >= 2`, 'both attacks to show their results', 12000);
await sleep(300);
await shot('cc-results');
const results = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('.cc-cards .cc-group')].map((g) => ({ cls: g.className, result: g.querySelector('.cc-result')?.textContent ?? null, math: g.querySelector('.cc-math')?.textContent ?? null })))`));
console.log('cc results:', JSON.stringify(results));
expect(results.length >= 2 && results.every((r) => r.result), 'not every attack shows a result');
await waitFor(`!document.querySelector('.cc-overlay')`, 'the overlay to fade out', 6000);
await shot('cc-closed');
console.log(`cc: overlay closed; phase ${await evaluate('aslGame.phase')}, decision ${await kind()}`);
await canvasOk('after close combat');
if (pageErrors.length) { console.error('page errors:\n  ' + pageErrors.join('\n  ')); fail(`${pageErrors.length} error(s) in the page`); }
console.log('CC DRIVE PASS');
ws.close();
process.exit(0);
