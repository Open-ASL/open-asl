import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState } from '@asl/engine';
import { moveState } from '../src/sk1/movement';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { friendlyEdges, recallDistances } from '../src/sk3/recall';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * Recall (SK4 7.10; ASLRB D5.341): a Recalled AFV must try to leave along a friendly board edge, by the shortest route in
 * MP, in Motion, as fast as possible. Board y: the S edge is hexrow 10; the Russians entered by it.
 */

const extra = [...sk2CoreModules, ...sk3CoreModules];
const t34 = (hex: string, tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id: 't34', def: 'ru.T34M43', side: 'ru', hex, tags: { vca: 0, ca: 0, recall: true, maDisabled: true, ...tags } });
const ENTERED_SOUTH = { ...RU_VS_GE, forces: [{ id: 'ru', group: 'Russians', side: 'ru', units: [], setup: { kind: 'enter', turn: 1, edge: 'S' } }] };

function game(pieces: PieceSpec[], opts: { dice?: number[]; terrain?: Record<string, { terrain: string }> } = {}) {
  return makeEngine({ pieces, scenario: ENTERED_SOUTH as never, extra, startPhase: 'MPh', ...(opts.dice ? { dice: opts.dice } : {}), ...(opts.terrain ? { terrain: opts.terrain as never } : {}) });
}
const play = (engine: Engine, state: GameState, ...actions: (Omit<Action, 'decisionId' | 'side'> & { side?: string })[]) => {
  let s = state;
  for (const a of actions) s = act(engine, s, a).state;
  return s;
};
const why = (engine: Engine, s: GameState, a: Omit<Action, 'decisionId' | 'side'>) => engine.validate(s, { ...a, side: s.attacker, decisionId: engine.currentDecision(s)!.id } as Action);
const steps = (engine: Engine, s: GameState) => engine.legalActions(s, s.attacker).filter((a) => a.type === 'move.step').map((a) => a['to'] as string);

describe('Recall (SK4 7.10)', () => {
  it('the friendly board edge is the one the side entered by; a side that set up on the map has the edges its setup area reaches', () => {
    const { engine, state } = game([t34('yM5')]);
    expect(friendlyEdges(engine.env(state), 'ru')).toEqual(['S']);
    const setUp = makeEngine({
      pieces: [],
      extra,
      scenario: {
        ...RU_VS_GE,
        forces: [
          { id: 'ru', group: 'Russians', side: 'ru', units: [], setup: { kind: 'area', description: 'rows 1-3', hexes: ['yA1', 'yM1', 'yGG2'] } },
          { id: 'ge', group: 'Germans', side: 'ge', units: [], setup: { kind: 'enter', turn: 1, edge: 'S' } },
        ],
      } as never,
    });
    const edges = friendlyEdges(setUp.engine.env(setUp.state), 'ru');
    expect(edges).toContain('N');
    expect(edges).not.toContain('S');
  });

  it('it only enters hexes on a shortest route to the edge, may not stop or end while it can go on, and leaves the map there with no exit rule', () => {
    const { engine, state } = game([t34('yM5'), { id: 'ru1', def: 'ru.447', side: 'ru', hex: 'yC2' }, { id: 'ge1', def: 'ge.467', side: 'ge', hex: 'yGG2' }]);
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' });
    const dist = recallDistances(engine.env(s), s.pieces['t34']!);
    // Facing north, both hexes in its arc lead away from the south edge.
    for (const to of ['yM4', 'yN4']) expect(why(engine, s, { type: 'move.step', to })).toMatch(/Recalled AFV/);
    expect(steps(engine, s)).toEqual([]);
    // It can turn and go on: no stopping, no ending.
    for (const a of [{ type: 'vmove.stop' }, { type: 'vmove.end' }, { type: 'move.end' }, { type: 'endPhase' }]) expect(why(engine, s, a)).toMatch(/Recalled AFV/);
    s = play(engine, s, { type: 'vmove.turn', vca: 3 });
    expect(steps(engine, s).length).toBeGreaterThan(0);
    for (const to of steps(engine, s)) expect(dist.get(to)!).toBeLessThan(dist.get('yM5')!);
    let hex = 'yM5';
    for (let i = 0; i < 10 && hex.slice(2) !== '10'; i++) {
      const next = steps(engine, s).filter((h) => h.startsWith('y')).sort((a, b) => dist.get(a)! - dist.get(b)!)[0];
      if (!next) {
        // At the edge of its arc: turn to keep the edge in front.
        s = play(engine, s, { type: 'vmove.turn', vca: 3 });
        continue;
      }
      s = play(engine, s, { type: 'move.step', to: next });
      hex = next;
    }
    expect(hex.slice(2)).toBe('10');
    expect(why(engine, s, { type: 'vmove.end' })).toMatch(/leaves the map now/);
    const off = engine.legalActions(s, 'ru').filter((a) => a.type === 'move.step').map((a) => a['to'] as string);
    expect(off.length).toBeGreaterThan(0);
    s = play(engine, s, { type: 'move.step', to: off[0]! });
    expect(s.pieces['t34']!.loc).toEqual({ kind: 'offboard', edge: 'exited' });
    expect(moveState(engine.env(s))).toBeFalsy();
    // Gone: the Movement Phase may end.
    expect(why(engine, s, { type: 'endPhase' })).toBeNull();
  });

  it('the Movement Phase does not end until the Recalled AFV has moved; next turn it must go on again', () => {
    // A Stunned (crew unable to act) AFV is not held to it: it cannot move this Player Turn.
    const stunned = game([t34('yM5', { stun: 'fresh' })]);
    expect(why(stunned.engine, stunned.state, { type: 'endPhase' })).toBeNull();
    const cols = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'AA', 'BB', 'CC', 'DD', 'EE', 'FF', 'GG'].map((c) => `y${c}`);
    const brush = Object.fromEntries(cols.flatMap((c) => [2, 3, 4, 5, 6, 7, 8, 9].map((r) => [`${c}${r}`, { terrain: 'brush' }])));
    const others: PieceSpec[] = [
      { id: 'ru1', def: 'ru.447', side: 'ru', hex: 'yC2' },
      { id: 'ge1', def: 'ge.467', side: 'ge', hex: 'yGG2' },
    ];
    const { engine, state } = game([t34('yM1', { vca: 3 }), ...others], { terrain: brush });
    expect(why(engine, state, { type: 'endPhase' })).toMatch(/Recalled/);
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' });
    // Brush at 2 MP a hex: out of MP short of the edge, it ends in Motion and the phase may end.
    for (let to = steps(engine, s)[0]; to; to = steps(engine, s)[0]) s = play(engine, s, { type: 'move.step', to });
    expect(s.pieces['t34']!.loc).toMatchObject({ kind: 'hex', hex: 'yM8' });
    s = play(engine, s, { type: 'vmove.end' });
    expect(s.pieces['t34']!.tags['motion']).toBe(true);
    expect(why(engine, s, { type: 'endPhase' })).toBeNull();
    // Through the enemy's Player Turn to its own next MPh: it must set off again.
    for (let i = 0; i < 40 && !(s.attacker === 'ru' && s.phase === 'MPh' && s.turn === 2); i++) {
      const d = engine.currentDecision(s)!;
      const a = engine.legalActions(s, d.owner).find((x) => x.type === 'endPhase' || x.type === 'pass' || x.type === 'defPass') ?? engine.legalActions(s, d.owner)[0]!;
      s = engine.submit(s, a).state;
    }
    expect([s.turn, s.attacker, s.phase]).toEqual([2, 'ru', 'MPh']);
    expect(why(engine, s, { type: 'endPhase' })).toMatch(/Recalled/);
    expect(why(engine, s, { type: 'vmove.start', vehicle: 't34' })).toBeNull();
  });
});
