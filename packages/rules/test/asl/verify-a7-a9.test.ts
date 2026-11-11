import { describe, expect, it } from 'vitest';
import { RU_VS_GE, act, makeEngine } from '../fixtures';
import { testFire } from './helpers';

/*
 * Verification of the Chapter A ledger rows in A7 (Fire Attacks), A8 (Defensive Fire) and A9 (MG) that no
 * earlier test exercised directly. The fixture IFT (test/fixtures.ts) gives a PTC on an effective DR
 * of 6 and nothing above.
 */

describe('A7.31, A7.32 attacks on one target', () => {
  it('a target may be attacked any number of times in a phase, each attack declared after the last is resolved', () => {
    const { engine, state } = makeEngine({
      extra: [testFire],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yO5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN8' },
      ],
      dice: [6, 5, 6, 5],
    });
    const t1 = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1'], sw: [], target: 'yN8' } });
    expect(t1.events.filter((e) => e.type === 'sk1.fire.attack')).toHaveLength(1);
    const t2 = act(engine, t1.state, { type: 'test.fire', mode: 'prep', decl: { units: ['a2'], sw: [], target: 'yN8' } });
    expect(t2.events.filter((e) => e.type === 'sk1.fire.attack')).toHaveLength(1);
    expect(t2.state.pieces['a1']!.tags['fire']).toBe('prep');
    expect(t2.state.pieces['a2']!.tags['fire']).toBe('prep');
  });
});

describe('A7.305 PTC, A7.8 PIN, A7.81 INFANTRY EFFECTS', () => {
  it('a PTC failed pins the target; a pinned unit fires at half FP and may not move', () => {
    // 6 FP at 3 hexes (6 column, shift 2): DR 5+3 is a PTC; the 4-6-7 rolls 5+4 = 9 > 7 and is pinned.
    const { engine, state } = makeEngine({
      extra: [testFire],
      pieces: [
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN8' },
      ],
      dice: [5, 3, 5, 4],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a2'], sw: [], target: 'yN8' } });
    expect(t.events.find((e) => e.type === 'sk1.fire.result')!.payload).toMatchObject({ unit: 'g1', result: { kind: 'PTC' } });
    expect(t.state.pieces['g1']!.tags['pinned']).toBe(true);

    const pinned = makeEngine({
      extra: [testFire],
      pieces: [
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yN5', tags: { pinned: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN8' },
      ],
      dice: [6, 5],
    });
    const fired = act(pinned.engine, pinned.state, { type: 'test.fire', mode: 'prep', decl: { units: ['a2'], sw: [], target: 'yN8' } });
    const attack = fired.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number; fpExplain: { label?: string }[] };
    expect(attack.fp).toBe(3);
    expect(attack.fpExplain.map((n) => n.label)).toContain('½ pinned');

    const mph = makeEngine({
      startPhase: 'MPh',
      pieces: [
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yN5', tags: { pinned: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN8' },
      ],
    });
    const d = mph.engine.currentDecision(mph.state)!;
    expect(mph.engine.validate(mph.state, { type: 'move.start', units: ['a2'], side: 'am', decisionId: d.id } as never)).not.toBeNull();
  });
});

describe('A8.21 one Residual FP counter per Location', () => {
  // The DEFENDER fires Defensive First Fire at the American stack in yN6: two squads point blank from
  // yN7 (a Fire Group, A7.55), one squad from yN8.
  const pieces = [
    { id: 'a1', def: 'am.747', side: 'am', hex: 'yN6' },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN7' },
    { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yN7' },
    { id: 'g3', def: 'ge.467', side: 'ge', hex: 'yN8' },
  ];
  const big = { type: 'test.fire', mode: 'first', decl: { units: ['g1', 'g2'], sw: [], target: 'yN6' } } as const;
  const small = { type: 'test.fire', mode: 'first', decl: { units: ['g3'], sw: [], target: 'yN6' } } as const;

  it('a smaller Residual FP leaves the larger counter in place; a larger one replaces a smaller', () => {
    const one = makeEngine({ extra: [testFire], startPhase: 'DFPh', pieces, dice: [6, 5, 6, 5, 6, 5, 6, 5] });
    // 16 FP leaves 8 (the 16 column halved), 4 FP leaves 2.
    let s = act(one.engine, one.state, big).state;
    expect(s.hexMarkers['yN6']).toMatchObject({ residualFp: 8 });
    s = act(one.engine, s, small).state;
    expect(s.hexMarkers['yN6']).toMatchObject({ residualFp: 8 });

    const two = makeEngine({ extra: [testFire], startPhase: 'DFPh', pieces, dice: [6, 5, 6, 5, 6, 5, 6, 5] });
    s = act(two.engine, two.state, small).state;
    expect(s.hexMarkers['yN6']).toMatchObject({ residualFp: 2 });
    s = act(two.engine, s, big).state;
    expect(s.hexMarkers['yN6']).toMatchObject({ residualFp: 8 });
  });
});

describe('A8.221 MALFUNCTION, A8.224 COWERING (Residual FP)', () => {
  it('a weapon that malfunctions on the attack leaves no Residual FP of its own', () => {
    // A 4-6-7 and its LMG fire Defensive First Fire point blank: (4 + 3) x2 = 14 FP on the 12 column.
    // DR 6+5 = 11 malfunctions the LMG (B11): the Residual FP comes from the squad's 8 FP alone (8 column → 4).
    const { engine, state } = makeEngine({
      extra: [testFire],
      startPhase: 'DFPh',
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN6' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN7' },
        { id: 'lmg', def: 'ge.LMG', side: 'ge', heldBy: 'g1' },
      ],
      dice: [6, 5],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'first', decl: { units: ['g1'], sw: ['lmg'], target: 'yN6' } });
    expect(t.events.find((e) => e.type === 'sk1.fire.attack')!.payload).toMatchObject({ column: 12 });
    expect(t.state.pieces['lmg']!.tags['malf']).toBe(true);
    expect(t.state.hexMarkers['yN6']).toMatchObject({ residualFp: 4 });
  });

  it('a Residual FP attack never cowers, even on doubles', () => {
    // As in movement.test.ts: the MMG leaves 2 Residual FP in zK3 and r2 walks into it; the residual DR is 6+6.
    const { engine, state } = makeEngine({
      board: 'z',
      terrain: { zJ3: { terrain: 'building-stone' }, zK5: { terrain: 'building-stone' } },
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice: [5, 4, 6, 6],
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5' },
        { id: 'gMMG', def: 'ge.MMG', side: 'ge', heldBy: 'g1' },
      ],
    });
    const pass = (st: typeof state) => (engine.currentDecision(st)?.kind === 'firstFire' ? act(engine, st, { type: 'defPass' }).state : st);
    let s = act(engine, state, { type: 'move.start', units: ['r1'] }).state;
    s = pass(act(engine, s, { type: 'move.step', to: 'zJ3' }).state);
    s = act(engine, s, { type: 'move.step', to: 'zK3' }).state;
    s = pass(act(engine, s, { type: 'defFire', decl: { units: [], sw: ['gMMG'], target: 'zK3' } }).state);
    s = act(engine, s, { type: 'move.end' }).state;
    s = act(engine, s, { type: 'move.start', units: ['r2'] }).state;
    s = pass(act(engine, s, { type: 'move.step', to: 'zJ3' }).state);
    const r = act(engine, s, { type: 'move.step', to: 'zK3' });
    const residual = r.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number; dr: number[]; cowered: boolean; column: number };
    expect(residual).toMatchObject({ fp: 2, dr: [6, 6], cowered: false, column: 2 });
  });
});

describe('A9.71 MULTIPLE SW MALFUNCTION', () => {
  it('when a FG of two MG rolls their B#, Random Selection picks the one that malfunctions', () => {
    // A squad fires two LMG (B11) and forfeits its own FP; DR 6+5 = 11; Random Selection 2 vs 5: the second LMG.
    const { engine, state } = makeEngine({
      extra: [testFire],
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN5' },
        { id: 'l1', def: 'ge.LMG', side: 'ge', heldBy: 'g1' },
        { id: 'l2', def: 'ge.LMG', side: 'ge', heldBy: 'g1' },
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN8' },
      ],
      scenario: { firstSide: 'ge' },
      dice: [6, 5, 2, 5],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: [], sw: ['l1', 'l2'], target: 'yN8' } });
    expect(t.state.pieces['l1']!.tags['malf']).toBeUndefined();
    expect(t.state.pieces['l2']!.tags['malf']).toBe(true);
  });
});
