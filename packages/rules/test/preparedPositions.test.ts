import { describe, expect, it } from 'vitest';
import { PREPARED, PREPARED_POSITIONS_MODULE, buildAttack, clearAreasTally, preparedPositionsModule, preparedTem, squadEquivalentsLost, type VictoryCondition } from '../src';
import { act, makeEngine } from './fixtures';

const AM_VS_GE = {
  ssr: [{ module: PREPARED_POSITIONS_MODULE, params: { side: 'ge', tem: 1, rule: 'SSR 2' } }],
};

describe('prepared positions (SSR)', () => {
  const game = (startPhase = 'PFPh') =>
    makeEngine({
      scenario: { ...AM_VS_GE, firstSide: startPhase === 'MPh' ? 'ge' : 'am' },
      extra: [preparedPositionsModule],
      startPhase,
      pieces: [
        { id: 'a1', def: 'am.666', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yP6' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5', tags: { [PREPARED]: 'yO5' } },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yO5' },
        { id: 'g3', def: 'ge.467', side: 'ge', hex: 'yO6', tags: { [PREPARED]: 'yO6' } },
      ],
    });

  it('adds its TEM to the IFT DR against each dug-in unit only', () => {
    const { engine, state } = game();
    const env = engine.env(state);
    const attack = buildAttack(env, { units: ['a1'], sw: [], target: 'yO5' }, 'prep', 'am');
    expect(env.query('fire.unitDrm', { attack, unit: 'g1' }, 0)).toBe(1);
    expect(env.query('fire.unitDrm', { attack, unit: 'g2' }, 0)).toBe(0);
    expect(env.explain('fire.unitDrm', { attack, unit: 'g1' }, 0).trace.find((t) => t.id === 'ssr.prepared-positions.tem')?.label).toMatch(/\+1 TEM dug in \(SSR 2\)/);
    expect(preparedTem(env, 'g3')).toBe(1);
  });

  it('is lost for good once the unit leaves its hex', () => {
    const { engine, state } = game('MPh');
    let s = act(engine, state, { type: 'move.start', units: ['g3'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'yO7' }).state;
    expect(s.pieces['g3']!.tags[PREPARED]).toBeUndefined();
    expect(s.pieces['g1']!.tags[PREPARED]).toBe('yO5');
    expect(preparedTem(engine.env(s), 'g3')).toBe(0);
  });
});

// Squads deployed at setup (setup-deploy) are tested with the scenario that uses them (content: LMA7), whose setup decision
// the harness here does not make.

describe('clearAreas / fewerLosses victory conditions', () => {
  const vc: Extract<VictoryCondition, { kind: 'clearAreas' }> = {
    kind: 'clearAreas',
    side: 'am',
    areas: [
      { label: 'hill A', hexes: ['yO5', 'yO6'] },
      { label: 'hill B', hexes: ['yP1'] },
      { label: 'hill C', hexes: ['yK2'] },
    ],
    atLeast: 2,
  };
  it('counts the areas with no Good Order enemy unit', () => {
    const { engine, state } = makeEngine({
      scenario: { victory: [vc] },
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO6' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yP1', tags: { broken: true } },
        { id: 'a1', def: 'am.666', side: 'am', hex: 'yK2' },
      ],
    });
    const t = clearAreasTally(engine.env(state), vc);
    expect(t.areas.map((a) => [a.label, a.clear, a.holders])).toEqual([
      ['hill A', false, ['g1']],
      ['hill B', true, []],
      ['hill C', true, []],
    ]);
    expect(t.clear).toBe(2);
  });
  it('counts squad equivalents lost: squad 1, half-squad ½, a Casualty Reduction ½, leaders none', () => {
    const { engine, state } = makeEngine({ pieces: [] });
    const env = engine.env({
      ...state,
      ext: {
        ...state.ext,
        'sk1.casualties': [
          { unit: 'x1', side: 'ge', kind: 'eliminated', defId: 'ge.467', vp: 2, turn: 1, phase: 'PFPh', reason: 't' },
          { unit: 'x2', side: 'ge', kind: 'reduced', defId: 'ge.467', vp: 1, turn: 1, phase: 'PFPh', reason: 't' },
          { unit: 'x3', side: 'ge', kind: 'eliminated', defId: 'ge.247', vp: 1, turn: 1, phase: 'PFPh', reason: 't' },
          { unit: 'x4', side: 'ge', kind: 'eliminated', defId: 'ge.L81', vp: 2, turn: 1, phase: 'PFPh', reason: 't' },
        ],
      },
    });
    expect(squadEquivalentsLost(env, 'ge')).toBe(2);
    expect(squadEquivalentsLost(env, 'am')).toBe(0);
  });
});
