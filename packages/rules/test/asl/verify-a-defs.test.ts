import { describe, expect, it } from 'vitest';
import type { RuleModule } from '@asl/engine';
import { aslCoreModules, commissarModule } from '../../src';
import { RU_VS_GE, act, makeEngine } from '../fixtures';
import { testFire } from './helpers';

/*
 * Verification of the Chapter A definitions (A.x) and the Sequence of Play (A3) rows that the
 * coverage ledger (packages/rules/docs/asl-chapter-a.md) marks as implemented. Where the engine
 * differs from the eASLRB the test pins the current behaviour and says so; the ledger row is ◐.
 */

describe('A3 Sequence of Play, A.13 ATTACKER/DEFENDER', () => {
  it('runs RPh, PFPh, MPh, DFPh, AFPh, RtPh, APh, CCPh, then the other side becomes the ATTACKER', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RPh',
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    // Phases with nothing to do (no broken unit to rout, no CC) are started and ended at once.
    let s = state;
    const seen: string[] = [`${s.phase}/${s.attacker}`];
    for (let i = 0; i < 30 && seen.length < 9; i++) {
      const t = act(engine, s, { type: 'endPhase' });
      s = t.state;
      for (const e of t.events.filter((x) => x.type === 'turn.phaseStarted')) {
        const p = e.payload as { phase: string; attacker: string };
        if (seen.length < 9) seen.push(`${p.phase}/${p.attacker}`);
      }
    }
    expect(seen).toEqual(['RPh/am', 'PFPh/am', 'MPh/am', 'DFPh/am', 'AFPh/am', 'RtPh/am', 'APh/am', 'CCPh/am', 'RPh/ge']);
  });
});

describe('A.3 MOVE/ADVANCE', () => {
  it('a unit that Prep Fired may not move in the MPh but may still advance in the APh', () => {
    const { engine, state } = makeEngine({
      startPhase: 'PFPh',
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      dice: [6, 6],
    });
    let s = act(engine, state, { type: 'fire', decl: { units: ['a1'], sw: [], target: 'yP9' } }).state;
    expect(s.pieces['a1']!.tags['fire']).toBe('prep');
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('MPh');
    const d = engine.currentDecision(s)!;
    expect(engine.validate(s, { type: 'move.start', units: ['a1'], side: 'am', decisionId: d.id } as never)).not.toBeNull();
    for (let i = 0; i < 10 && s.phase !== 'APh'; i++) s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('APh');
    const t = act(engine, s, { type: 'advance', units: ['a1'], to: 'yN6' });
    expect(t.state.pieces['a1']!.loc).toEqual({ kind: 'hex', hex: 'yN6' });
  });
});

describe('A.9 RANDOM SELECTION', () => {
  // A 7-4-7 fires point blank at a 4-6-7 and an 8-1 in the open: 14 FP, DR 2+4 is a K/1 (fire.test.ts).
  const pieces = [
    { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN6' },
    { id: 'gL', def: 'ge.L81', side: 'ge', hex: 'yN6' },
  ];

  it('SK: a tie for the highest dr is re-rolled until one unit is picked (SK1 3.2.1 "one unit suffers Casualty Reduction")', () => {
    // Random Selection: squad 3, leader 3 (tie), then squad 1, leader 6: only the leader is hit.
    const { engine, state } = makeEngine({ extra: [testFire], pieces, dice: [2, 4, 3, 3, 1, 6, 2, 1, 1] });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1'], sw: [], target: 'yN6' } });
    expect(t.state.pieces['gL']!.tags['wounds']).toBe(1);
    expect(t.state.pieces['g1']!.defId).toBe('ge.467');
  });

  it('full ASL: every unit tied for the highest dr suffers the K (A.9, A7.302 "at least one")', () => {
    // Random Selection: squad 3, leader 3 (tie): the squad is Reduced and the leader wounded (severity dr 1);
    // the new HS takes the 1MC (2+2+1 passes), the wounded leader none.
    const { engine, state } = makeEngine({ extra: [testFire, ...aslCoreModules], pieces, dice: [2, 4, 3, 3, 1, 2, 2] });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1'], sw: [], target: 'yN6' } });
    expect(t.state.pieces['gL']!.tags['wounds']).toBe(1);
    expect(t.state.pieces['g1']!.defId).toBe('ge.247');
    const checks = t.events.filter((e) => e.type === 'sk1.check').map((e) => e.payload as { unit: string; outcome: string });
    expect(checks).toEqual([expect.objectContaining({ unit: 'g1', outcome: 'passed' })]);
  });

  it('full ASL: a KIA takes more units than its number when the last pick is tied (A7.301)', () => {
    // 1KIA at DR 3+1 (fixture IFT, 12 column); squad 5, leader 5: both are eliminated.
    const { engine, state } = makeEngine({ extra: [testFire, ...aslCoreModules], pieces, dice: [3, 1, 5, 5] });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1'], sw: [], target: 'yN6' } });
    expect(t.events.find((e) => e.type === 'sk1.fire.result')!.payload).toMatchObject({ result: { kind: 'KIA', n: 1 } });
    expect(t.state.pieces['g1']!.loc.kind).toBe('eliminated');
    expect(t.state.pieces['gL']!.loc.kind).toBe('eliminated');
  });
});

describe('A.11 PERMANENT BREAKDOWN', () => {
  const captured = (dice: number[]) =>
    makeEngine({
      extra: [testFire],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'lmg', def: 'ge.LMG', side: 'am', heldBy: 'a1' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      dice,
    });

  it('a captured LMG (B11 -2 = B9) is removed on an original 11, its printed B# made an X# (A.11; SK1 5.5)', () => {
    const { engine, state } = captured([5, 6]);
    expect(engine.env(state).query('sw.breakdown', { sw: 'lmg', user: 'a1' }, null)).toBe(9);
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: [], sw: ['lmg'], target: 'yP9' } });
    expect(t.state.pieces['lmg']!.loc.kind).toBe('eliminated');
  });

  it('the same captured LMG only malfunctions on an original 9 or 10', () => {
    const { engine, state } = captured([4, 5]);
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: [], sw: ['lmg'], target: 'yP9' } });
    expect(t.state.pieces['lmg']!.tags['malf']).toBe(true);
    expect(t.state.pieces['lmg']!.loc.kind).toBe('held');
  });

  it('an Inexperienced (Green, no leader) user makes a B12 MMG B11/X12: 11 malfunctions, 12 removes (A.11; SK1 5.4)', () => {
    const green = (dice: number[]) =>
      makeEngine({
        extra: [testFire],
        pieces: [
          { id: 'a1', def: 'am.536', side: 'am', hex: 'yN5' },
          { id: 'mg', def: 'am.MMG', side: 'am', heldBy: 'a1' },
          { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
        ],
        dice,
      });
    const a = green([5, 6]);
    const t1 = act(a.engine, a.state, { type: 'test.fire', mode: 'prep', decl: { units: [], sw: ['mg'], target: 'yP9' } });
    expect(t1.state.pieces['mg']!.tags['malf']).toBe(true);
    const b = green([6, 6]);
    const t2 = act(b.engine, b.state, { type: 'test.fire', mode: 'prep', decl: { units: [], sw: ['mg'], target: 'yP9' } });
    expect(t2.state.pieces['mg']!.loc.kind).toBe('eliminated');
  });

  it('Sustained Fire (a MG firing again after First Fire) does turn the printed B# into an X# (A9.3)', () => {
    const { engine, state } = makeEngine({
      extra: [testFire],
      startPhase: 'DFPh',
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN6', tags: { fire: 'first' } },
        { id: 'mg', def: 'ge.MMG', side: 'ge', heldBy: 'g1', tags: { fire: 'first' } },
      ],
      dice: [6, 6],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'final', decl: { units: [], sw: ['mg'], target: 'yN5' } });
    expect(t.state.pieces['mg']!.loc.kind).toBe('eliminated');
  });
});

describe('A.15 FIRST/FINAL FIRE, A8.4 FINAL FIRE', () => {
  it('a unit that used Defensive First Fire may fire again in the DFPh, at an adjacent hex only, as Area Fire', () => {
    const { engine, state } = makeEngine({
      extra: [testFire],
      startPhase: 'DFPh',
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.747', side: 'am', hex: 'yN8' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN6', tags: { fire: 'first' } },
      ],
      dice: [6, 6],
    });
    expect(() => act(engine, state, { type: 'test.fire', mode: 'final', decl: { units: ['g1'], sw: [], target: 'yN8' } })).toThrow(/adjacent/);
    const t = act(engine, state, { type: 'test.fire', mode: 'final', decl: { units: ['g1'], sw: [], target: 'yN5' } });
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number };
    // 4 FP x2 PBF, halved for firing again.
    expect(attack.fp).toBe(4);
    expect(t.state.pieces['g1']!.tags['fire']).toBe('final');
  });
});

describe('A.18 MORALE LEVEL CEILING', () => {
  it('a 9-2 stacked with a Commissar reaches 10, and a morale-10 leader stays at 10 (A.18)', () => {
    // Test-only stand-in for a 10-morale leader: "l10" (a 9-2) is given a printed morale of 10.
    const tenMorale: RuleModule = {
      id: 'test.tenMorale',
      install(r) {
        r.contribute({ id: 'test.tenMorale', query: 'unit.morale', layer: 1, when: ({ unit }) => unit === 'l10', apply: () => 10 });
      },
    };
    const { engine, state } = makeEngine({
      scenario: { ...RU_VS_GE, ssr: [{ module: 'commissar', params: { side: 'ru', leaders: { 'ru.L61': { morale: 10, leadership: 0 } }, rule: 'SSR' }, text: 'SSR' }] },
      extra: [commissarModule, tenMorale],
      startPhase: 'RPh',
      pieces: [
        { id: 'c', def: 'ru.L61', side: 'ru', hex: 'yN5' },
        { id: 'l', def: 'ru.L92', side: 'ru', hex: 'yN5' },
        { id: 'l10', def: 'ru.L92', side: 'ru', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    const env = engine.env(state);
    expect(env.query('unit.morale', { unit: 'l' }, 0)).toBe(10);
    expect(env.query('unit.morale', { unit: 'l10' }, 0)).toBe(10);
  });
});
