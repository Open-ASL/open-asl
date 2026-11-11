import { describe, expect, it } from 'vitest';
import type { Action, Ctx, RuleModule } from '@asl/engine';
import { VARIABLE_REINFORCEMENTS_MODULE, chartLabel, pendingVariableReinforcements, variableReinforcementsModule } from '../src';
import { act, makeEngine } from './fixtures';

/** Test-only action: start a Player Turn, as the turn module does. */
const testTurn: RuleModule = {
  id: 'test.turn',
  install(r) {
    r.action<Action & { turn: number; attacker: string }>({
      type: 'test.turn',
      decisionKinds: ['phase'],
      resolve(ctx: Ctx, a) {
        ctx.emit('turn.playerTurn', { turn: a.turn, attacker: a.attacker });
      },
    });
  },
};

const scenario = {
  firstSide: 'am',
  forces: [
    { id: 'am-t1', side: 'am', units: [{ def: 'am.666', count: 1 }], setup: { kind: 'enter' as const, turn: 1, edge: 'N', hexes: ['yN10', 'yO10'] } },
    { id: 'am-t2', side: 'am', units: [], setup: { kind: 'enter' as const, turn: 2, edge: 'N' } },
  ],
  ssr: [
    {
      module: VARIABLE_REINFORCEMENTS_MODULE,
      params: {
        side: 'am',
        def: 'am.346h',
        rule: 'SSR 1',
        rolls: [
          { turn: 1, force: 'am-t1', table: [{ dr: [1, 3], count: 4 }, { dr: [4, 6], count: 3 }] },
          { turn: 2, force: 'am-t2', table: [{ dr: [1, 3], count: 5 }, { dr: [4, 6], count: 4 }] },
        ],
      },
    },
  ],
};

const hs = (state: { pieces: Record<string, { defId: string; side: string; loc: unknown; tags: Record<string, unknown> }> }) =>
  Object.values(state.pieces).filter((p) => p.defId === 'am.346h');

describe('variable reinforcements (SSR)', () => {
  it('creates the counters the dr brings, offboard with the force they enter with', () => {
    const { engine, state } = makeEngine({ pieces: [{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'yH5' }], extra: [variableReinforcementsModule, testTurn], scenario, dice: [2, 5] });
    expect(hs(state)).toHaveLength(0);
    expect(pendingVariableReinforcements(engine.env(state)).map((v) => [v.turn, v.min, v.max, v.edge])).toEqual([
      [1, 3, 4, 'N'],
      [2, 4, 5, 'N'],
    ]);
    const t1 = act(engine, state, { type: 'test.turn', turn: 1, attacker: 'am' });
    const ev = t1.events.find((e) => e.type === 'ssr.variableReinforcements')!.payload as { dr: number; count: number; rule: string; pieces: string[] };
    expect(ev).toMatchObject({ dr: 2, count: 4, rule: 'SSR 1', turn: 1, force: 'am-t1' });
    expect(ev.pieces).toHaveLength(4);
    const roll = t1.events.find((e) => e.type === 'dice.rolled')!.payload as { label: string };
    expect(roll.label).toBe('SSR 1: reinforcements received this turn (dr 1–3: 4 · dr 4–6: 3)');
    const made = hs(t1.state);
    expect(made).toHaveLength(4);
    expect(made[0]).toMatchObject({ side: 'am', loc: { kind: 'offboard', edge: 'N' }, tags: { force: 0, entryTurn: 1, entryEdge: 'N', entryHexes: 'yN10,yO10' } });
    expect(pendingVariableReinforcements(engine.env(t1.state)).map((v) => v.turn)).toEqual([2]);
    // The German turn rolls nothing; the American turn 2 rolls its own chart.
    const g = act(engine, t1.state, { type: 'test.turn', turn: 1, attacker: 'ge' });
    expect(g.events.some((e) => e.type === 'ssr.variableReinforcements')).toBe(false);
    const t2 = act(engine, g.state, { type: 'test.turn', turn: 2, attacker: 'am' });
    expect(t2.events.find((e) => e.type === 'ssr.variableReinforcements')!.payload).toMatchObject({ dr: 5, count: 4, turn: 2 });
    expect(hs(t2.state)).toHaveLength(8);
    expect(pendingVariableReinforcements(engine.env(t2.state))).toEqual([]);
    // Rolling again for a turn already rolled does nothing.
    const again = act(engine, t2.state, { type: 'test.turn', turn: 2, attacker: 'am' });
    expect(hs(again.state)).toHaveLength(8);
  });

  it('words the chart as the card prints it', () => {
    expect(chartLabel([{ dr: [1, 3], count: 4 }, { dr: [4, 6], count: 3 }])).toBe('dr 1–3: 4 · dr 4–6: 3');
    expect(chartLabel([{ dr: [6, 6], count: 1 }])).toBe('dr 6: 1');
  });
});
