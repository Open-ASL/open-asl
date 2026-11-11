import { describe, expect, it } from 'vitest';
import type { Engine, GameState, RuleModule } from '@asl/engine';
import { statics } from '@asl/rules';
import { act, makeEngine } from '../../../packages/rules/test/fixtures';
import { endPhaseWarning } from '../src/game/endPhaseGuard';

const warn = (engine: Engine, state: GameState) => {
  const d = engine.currentDecision(state)!;
  return endPhaseWarning(engine.env(state), engine.legalActions(state, d.owner));
};

/** Puts `id` offboard along edge `edge`, due to enter on `turn`, the way the scenario setup does. */
const reinforcement = (id: string, edge: string, turn: number): RuleModule => ({
  id: `test.reinforce.${id}`,
  install(r) {
    r.setup({
      id: `test.reinforce.${id}`,
      priority: 500,
      run(ctx) {
        const off = statics(ctx).map.offboard(edge)[0]!.id;
        ctx.emit('piece.moved', { id, loc: { kind: 'offboard', edge, hex: off } });
        ctx.emit('piece.tagged', { id, tags: { entryTurn: turn, entryEdge: edge } });
      },
    });
  },
});

describe('end-of-phase confirmation', () => {
  it('Rally Phase: warns while a broken unit could still attempt to rally, then not', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RPh',
      pieces: [
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5', tags: { broken: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      dice: [6, 5],
    });
    const w = warn(engine, state);
    expect(w?.title).toMatch(/rally/i);
    expect(w?.units).toEqual(['aL']);
    const t = act(engine, state, { type: 'rally.selfRally', unit: 'aL' });
    expect(warn(engine, t.state)).toBeNull();
  });

  it('Rally Phase: a Good Order force raises no warning', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RPh',
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    expect(warn(engine, state)).toBeNull();
  });

  it('Movement Phase: unmoved units are listed; reinforcements still offboard are called out', () => {
    const { engine, state } = makeEngine({
      startPhase: 'MPh',
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.747', side: 'am' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      extra: [reinforcement('a2', 'N', 1)],
    });
    const w = warn(engine, state)!;
    expect(w.title).toMatch(/reinforcements/i);
    expect(w.lines[0]).toMatch(/1 reinforcement is still off board/);
    expect(w.lines[1]).toMatch(/1 unit on the map has not moved/);
    expect(w.units).toEqual(['a2', 'a1']);
  });

  it('Movement Phase: no warning once every unit has moved or declined to move', () => {
    const { engine, state } = makeEngine({
      startPhase: 'MPh',
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    let t = act(engine, state, { type: 'move.start', units: ['a1'] });
    t = act(engine, t.state, { type: 'move.end' });
    expect(warn(engine, t.state)).toBeNull();
  });

  it('Movement Phase: units not yet moved are still counted while another stack is mid-move', () => {
    const { engine, state } = makeEngine({
      startPhase: 'MPh',
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.747', side: 'am', hex: 'yM4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    const t = act(engine, state, { type: 'move.start', units: ['a1'] });
    expect(engine.legalActions(t.state, 'am').some((a) => a.type === 'move.start')).toBe(false);
    expect(warn(engine, t.state)?.units).toEqual(['a2']);
  });

  it('Movement Phase: a reinforcement due next turn is not counted', () => {
    const { engine, state } = makeEngine({
      startPhase: 'MPh',
      pieces: [
        { id: 'a2', def: 'am.747', side: 'am' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      extra: [reinforcement('a2', 'N', 2)],
    });
    expect(warn(engine, state)).toBeNull();
  });

  it('Advance Phase: reinforcements still offboard are about to be eliminated', () => {
    const { engine, state } = makeEngine({
      startPhase: 'APh',
      pieces: [
        { id: 'a2', def: 'am.747', side: 'am' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      extra: [reinforcement('a2', 'N', 1)],
    });
    const w = warn(engine, state)!;
    expect(w.severe).toBe(true);
    expect(w.units).toEqual(['a2']);
    const t = act(engine, state, { type: 'endPhase' });
    expect(t.state.pieces['a2']!.loc.kind).toBe('eliminated');
  });

  it('Advance Phase: asks while units could advance and none has, then not once one has', () => {
    const { engine, state } = makeEngine({
      startPhase: 'APh',
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.747', side: 'am', hex: 'yK5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    const w = warn(engine, state)!;
    expect(w.title).toMatch(/advanced/i);
    expect(w.severe).toBeFalsy();
    expect(w.units).toEqual(['a1', 'a2']);
    const to = engine.legalActions(state, 'am').find((a) => a.type === 'advance' && (a['units'] as string[]).join() === 'a1')!['to'];
    const t = act(engine, state, { type: 'advance', units: ['a1'], to });
    expect(warn(engine, t.state)).toBeNull();
  });

  it('Advance Phase: nothing to ask when no unit can advance', () => {
    const { engine, state } = makeEngine({
      startPhase: 'APh',
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    expect(warn(engine, state)).toBeNull();
  });
});
