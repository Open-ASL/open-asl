// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Engine, GameState, LoggedEvent } from '@asl/engine';
import { act, makeEngine } from '../../../packages/rules/test/fixtures';
import { usePresentation, type Presentation } from '../src/game/presentation';
import { useGameFx, type GameFx } from '../src/fx/useGameFx';
import { ccPlayOrder } from '../src/fx/ccOrder';

vi.mock('../src/audio/engine', () => ({ playSfx: () => {} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A simultaneous CC (SK1 3.8): an American 7-4-7 advances onto a German 4-6-7 and each rolls a 3, so each
 * eliminates the other. Returns the state before the CC is declared and the events of the declaration.
 */
function closeCombat() {
  const { engine, state } = makeEngine({
    startPhase: 'APh',
    dice: [1, 2, 2, 1, 6, 6, 6, 6],
    pieces: [
      { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
      { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
    ],
  });
  const created = engine.createGame({ scenarioId: 'test', sides: state.sides, attacker: state.attacker, seed: 'test' });
  let s: GameState = act(engine, state, { type: 'advance', units: ['a1'], to: 'yO5' }).state;
  s = act(engine, s, { type: 'endPhase' }).state;
  for (let guard = 0; guard < 10 && engine.currentDecision(s)?.kind !== 'ccDeclare'; guard++) s = engine.submit(s, engine.legalActions(s, engine.currentDecision(s)!.owner)[0]!).state;
  s = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['a1'], targets: ['g1'] }] }).state;
  const t = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['g1'], targets: ['a1'] }] });
  return { engine, before: s, created: created.events, t };
}

const told = (events: LoggedEvent[]) =>
  events.flatMap((e) => {
    const p = e.payload as { label?: string; side?: string; id?: string };
    if (e.type === 'dice.rolled') return [`roll ${p.label}`];
    if (e.type === 'sk1.cc.attack') return [`attack ${p.side}`];
    if (e.type === 'piece.eliminated') return [`eliminated ${p.id}`];
    return [];
  });

describe('the telling of a simultaneous Close Combat', () => {
  it('is logged with both rolls before any result (SK1 3.8), and played one side at a time: roll, then its outcome', () => {
    const { t } = closeCombat();
    expect(t.state.pieces['a1']!.loc.kind).toBe('eliminated');
    expect(t.state.pieces['g1']!.loc.kind).toBe('eliminated');
    expect(told(t.events)).toEqual(['roll CC am in yO5', 'roll CC ge in yO5', 'eliminated g1', 'attack am', 'eliminated a1', 'attack ge']);
    expect(told(ccPlayOrder(t.events))).toEqual(['roll CC am in yO5', 'eliminated g1', 'attack am', 'roll CC ge in yO5', 'eliminated a1', 'attack ge']);
    // Every event is still played, once.
    expect(ccPlayOrder(t.events).map((e) => e.seq).sort((a, b) => a - b)).toEqual(t.events.map((e) => e.seq));
  });

  it('plays a Field Promotion after the roll it was made for, though the engine logs it before the first result (SK1 5.3)', () => {
    const ev = (type: string, payload: object) => ({ type, payload });
    // The German rolled the original 2: its Leader Creation dr is logged among the rolls, before the American result.
    const logged = [
      ev('dice.rolled', { label: 'CC am in yO5' }),
      ev('dice.rolled', { label: 'CC ge in yO5' }),
      ev('dice.rolled', { label: 'Leader Creation for g1' }),
      ev('piece.created', { piece: { id: 'g1.L30' } }),
      ev('sk1.leaderCreation', { unit: 'g1', leader: 'g1.L30' }),
      ev('piece.eliminated', { id: 'g1' }),
      ev('sk1.cc.attack', { side: 'am', attack: { attackers: ['a1'], targets: ['g1', 'g1.L30'] } }),
      ev('piece.eliminated', { id: 'a1' }),
      ev('sk1.cc.attack', { side: 'ge', attack: { attackers: ['g1', 'g1.L30'], targets: ['a1'] } }),
    ];
    const label = (e: { type: string; payload: object }) => { const p = e.payload as { label?: string; side?: string; id?: string; unit?: string }; return `${e.type} ${p.label ?? p.side ?? p.id ?? p.unit ?? ''}`; };
    expect(ccPlayOrder(logged).map(label)).toEqual([
      'dice.rolled CC am in yO5',
      'piece.eliminated g1',
      'sk1.cc.attack am',
      'dice.rolled CC ge in yO5',
      'dice.rolled Leader Creation for g1',
      'piece.created ',
      'sk1.leaderCreation g1',
      'piece.eliminated a1',
      'sk1.cc.attack ge',
    ]);
    // The American's own original 2 stays with the American roll.
    const own = [logged[0]!, logged[1]!, ev('dice.rolled', { label: 'Leader Creation for a1' }), ev('sk1.leaderCreation', { unit: 'a1', leader: null }), ev('sk1.cc.attack', { side: 'am', attack: { attackers: ['a1'], targets: ['g1'] } }), ev('sk1.cc.attack', { side: 'ge', attack: { attackers: ['g1'], targets: ['a1'] } })];
    expect(ccPlayOrder(own).map(label)).toEqual(['dice.rolled CC am in yO5', 'dice.rolled Leader Creation for a1', 'sk1.leaderCreation a1', 'sk1.cc.attack am', 'dice.rolled CC ge in yO5', 'sk1.cc.attack ge']);
  });

  it('leaves a lone roll, and anything else, as logged', () => {
    const ev = (type: string, payload: object) => ({ type, payload });
    const lone = [ev('dice.rolled', { label: 'CC am in yO5' }), ev('sk1.cc.attack', { side: 'am' }), ev('dice.rolled', { label: 'MC g1' })];
    expect(ccPlayOrder(lone)).toEqual(lone);
    // Two rolls but only one attack applied: no reordering.
    const short = [ev('dice.rolled', { label: 'CC am in yO5' }), ev('dice.rolled', { label: 'CC ge in yO5' }), ev('sk1.cc.attack', { side: 'am' })];
    expect(ccPlayOrder(short)).toEqual(short);
  });
});

let seen: { present: Presentation; fx: GameFx } | null = null;
function Screen({ engine, state, log }: { engine: Engine; state: GameState; log: LoggedEvent[] }) {
  const present = usePresentation(engine, state, log, false, 0);
  const fx = useGameFx(engine.env(state), log, engine.currentDecision(present.state), 'full', null, present, 0);
  seen = { present, fx };
  return null;
}
let root: Root | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  reactAct(() => root?.unmount());
  root = null;
  seen = null;
  vi.useRealTimers();
});

describe('a simultaneous Close Combat on screen', () => {
  it('shows the first side’s outcome on the board before the other side’s dice land, and holds it', () => {
    const { engine, before, created, t } = closeCombat();
    const show = (state: GameState, log: LoggedEvent[]) => reactAct(() => root!.render(createElement(Screen, { engine, state, log })));
    const wait = (ms: number) => reactAct(() => vi.advanceTimersByTime(ms));
    show(before, created);
    show(t.state, [...created, ...t.events]);
    // The American roll lands and its result shows: the German squad is gone, the American still stands.
    wait(600);
    expect(seen!.fx.history.map((h) => h.label)).toEqual(['CC: American in O5']);
    expect(seen!.present.state.pieces['g1']!.loc.kind).toBe('eliminated');
    expect(seen!.present.state.pieces['a1']!.loc.kind).toBe('hex');
    // Still only the one roll a full ordinary beat later: a CC outcome is held longer.
    wait(1200);
    expect(seen!.fx.history).toHaveLength(1);
    // Then the German roll, and its outcome.
    wait(1500);
    expect(seen!.fx.history.map((h) => h.label)).toEqual(['CC: American in O5', 'CC: German in O5']);
    wait(3000);
    expect(seen!.present.state.pieces['a1']!.loc.kind).toBe('eliminated');
    expect(seen!.present.state).toBe(t.state);
  });
});

describe('a result word on the board', () => {
  it('floats once over a unit, though the outcome comes as a check and then the piece’s change', () => {
    const { engine, state } = makeEngine({ startPhase: 'PFPh', pieces: [{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5', tags: { broken: true } }] });
    const created = engine.createGame({ scenarioId: 'test', sides: state.sides, attacker: state.attacker, seed: 'test' }).events;
    const show = (log: LoggedEvent[]) => reactAct(() => root!.render(createElement(Screen, { engine, state, log })));
    show(created);
    const at = created.length ? created[created.length - 1]!.seq : 0;
    // A broken squad fails a MC: the check says REDUCED, and so does its replacement by the half-squad.
    const ev = (i: number, type: string, payload: object) => ({ seq: at + i, type, payload }) as LoggedEvent;
    show([
      ...created,
      ev(1, 'dice.rolled', { label: 'MC g1', dice: [5, 6] }),
      ev(2, 'sk1.check', { unit: 'g1', kind: 'MC', outcome: 'reduced', dr: 11, final: 11, target: 7 }),
      ev(3, 'piece.replaced', { id: 'g1', defId: 'ge.247', reason: 'casualty' }),
    ]);
    reactAct(() => vi.advanceTimersByTime(800));
    const words = seen!.fx.boardFx.filter((f) => f.kind === 'text' && f.piece === 'g1').map((f) => (f as { text: string }).text);
    expect(words).toEqual(['REDUCED']);
  });
});
