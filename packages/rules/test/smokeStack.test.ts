import { describe, expect, it } from 'vitest';
import { moveState, statics } from '../src';
import { GE_VS_BR, act, makeEngine } from './fixtures';

// ASLRB A4.2: units moving as a stack "expend MF simultaneously and need not spend MF for the same purpose, but must
// designate at the same time all actions for the same MF". SK1 3.3 is silent on stacks, so every Smoke grenade attempt
// declared at once is one expenditure of the stack (two MF if any goes into an adjacent hex), each unit throwing into
// its own target and rolling its own dr, and Defensive First Fire comes only after all of them (A8.1).
describe('Smoke grenades thrown together by a moving stack (ASLRB A4.2, A24.1)', () => {
  // Three German 4-6-7s (Smoke exponent 1) in yN5, Open Ground; a British 4-5-7 in yN8 sees them.
  const setup = (dice: number[]) =>
    makeEngine({
      scenario: GE_VS_BR,
      startPhase: 'MPh',
      dice,
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN5' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yN5' },
        { id: 'g3', def: 'ge.467', side: 'ge', hex: 'yN5' },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yN8' },
      ],
    });
  const check = (engine: ReturnType<typeof setup>['engine'], s: ReturnType<typeof setup>['state'], a: Record<string, unknown>) =>
    engine.validate(s, { ...a, side: 'ge', decisionId: engine.currentDecision(s)!.id } as never);
  const pass = (engine: ReturnType<typeof setup>['engine'], s: ReturnType<typeof setup>['state']) => {
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    return s;
  };
  const rolls = (t: { events: { type: string; payload: unknown }[] }) => t.events.filter((e) => e.type === 'dice.rolled').map((e) => (e.payload as { label: string }).label);

  it('each unit throws into its own hex, all for one two-MF expenditure, then the defender may fire once at the whole stack', () => {
    // dr 1 places (g1), dr 3 misses (g2), dr 1 places (g3).
    const { engine, state } = setup([1, 3, 1]);
    const adj = statics(engine.env(state)).map.neighbors('yN5')[0]!;
    let s = act(engine, state, { type: 'move.start', units: ['g1', 'g2', 'g3'] }).state;
    const t = act(engine, s, {
      type: 'move.smoke',
      throws: [
        { unit: 'g1', target: 'yN5' },
        { unit: 'g2', target: adj },
        { unit: 'g3', target: adj },
      ],
    });
    expect(rolls(t)).toEqual(['Smoke grenades by g1', 'Smoke grenades by g2', 'Smoke grenades by g3']);
    s = t.state;
    expect(s.hexMarkers['yN5']?.['smoke']).toBe(1);
    expect(s.hexMarkers[adj]?.['smoke']).toBe(1);
    const ms = moveState({ state: s } as never)!;
    expect(ms.spent).toEqual({ g1: 2, g2: 2, g3: 2 });
    expect(ms.mfHere).toBe(2);
    expect(ms.smokeTriedBy).toEqual(['g1', 'g2', 'g3']);
    // One First Fire opportunity, after every attempt, against the whole stack.
    const d = engine.currentDecision(s)!;
    expect(d.kind).toBe('firstFire');
    expect([...(d.data as { units: string[] }).units].sort()).toEqual(['g1', 'g2', 'g3']);
    s = pass(engine, s);
    // The stack may go on with its two MF left (into a hex without Smoke: one MF).
    const away = statics(engine.env(s)).map.neighbors('yN5').find((h) => h !== adj && h !== 'yN6')!;
    s = pass(engine, act(engine, s, { type: 'move.step', to: away }).state);
    expect(moveState({ state: s } as never)!.spent).toEqual({ g1: 3, g2: 3, g3: 3 });
  });

  it('every attempt into the stack’s own hex costs the stack one MF', () => {
    const { engine, state } = setup([1, 1]);
    let s = act(engine, state, { type: 'move.start', units: ['g1', 'g2'] }).state;
    s = act(engine, s, { type: 'move.smoke', throws: [{ unit: 'g1', target: 'yN5' }, { unit: 'g2', target: 'yN5' }] }).state;
    expect(moveState({ state: s } as never)!.spent).toEqual({ g1: 1, g2: 1 });
    expect(s.hexMarkers['yN5']?.['smoke']).toBe(2);
  });

  it('a unit throws once per MPh: not twice in one declaration, nor again after its stack threw', () => {
    const { engine, state } = setup([1, 1]);
    let s = act(engine, state, { type: 'move.start', units: ['g1', 'g2', 'g3'] }).state;
    expect(check(engine, s, { type: 'move.smoke', throws: [{ unit: 'g1', target: 'yN5' }, { unit: 'g1', target: 'yN5' }] })).toMatch(/once per MPh/);
    expect(check(engine, s, { type: 'move.smoke', throws: [] })).toMatch(/No Smoke/);
    expect(check(engine, s, { type: 'move.smoke', throws: [{ unit: 'b1', target: 'yN5' }] })).toMatch(/not moving/);
    s = pass(engine, act(engine, s, { type: 'move.smoke', throws: [{ unit: 'g1', target: 'yN5' }, { unit: 'g2', target: 'yN5' }] }).state);
    expect(check(engine, s, { type: 'move.smoke', throws: [{ unit: 'g2', target: 'yN5' }, { unit: 'g3', target: 'yN5' }] })).toMatch(/already attempted/);
    // A later attempt by a unit that has not thrown is a new expenditure.
    s = pass(engine, act(engine, s, { type: 'move.smoke', unit: 'g3', target: 'yN5' }).state);
    expect(moveState({ state: s } as never)!.spent).toEqual({ g1: 2, g2: 2, g3: 2 });
  });

  it('every thrower needs the MF of the whole declaration', () => {
    const { engine, state } = setup([]);
    let s = act(engine, state, { type: 'move.start', units: ['g1', 'g2'] }).state;
    s = pass(engine, act(engine, s, { type: 'move.step', to: 'yN4' }).state);
    s = pass(engine, act(engine, s, { type: 'move.step', to: 'yN3' }).state);
    s = pass(engine, act(engine, s, { type: 'move.step', to: 'yN2' }).state);
    const adj = statics(engine.env(s)).map.neighbors('yN2')[0]!;
    // One MF left: own hex only, for both.
    expect(check(engine, s, { type: 'move.smoke', throws: [{ unit: 'g1', target: 'yN2' }, { unit: 'g2', target: adj }] })).toMatch(/Not enough MF/);
    expect(check(engine, s, { type: 'move.smoke', throws: [{ unit: 'g1', target: 'yN2' }, { unit: 'g2', target: 'yN2' }] })).toBeNull();
  });

  it('a placement dr of 6 ends only that unit’s MPh; the rest of the stack moves on', () => {
    const { engine, state } = setup([6, 1]);
    let s = act(engine, state, { type: 'move.start', units: ['g1', 'g2'] }).state;
    s = act(engine, s, { type: 'move.smoke', throws: [{ unit: 'g1', target: 'yN5' }, { unit: 'g2', target: 'yN5' }] }).state;
    expect(moveState({ state: s } as never)!.units).toEqual(['g2']);
    expect(s.hexMarkers['yN5']?.['smoke']).toBe(1);
    s = pass(engine, s);
    s = pass(engine, act(engine, s, { type: 'move.step', to: 'yN4' }).state);
    expect(s.pieces['g2']!.loc).toMatchObject({ hex: 'yN4' });
    expect(s.pieces['g1']!.loc).toMatchObject({ hex: 'yN5' });
  });

  it('sixes for every thrower end the stack’s move', () => {
    const { engine, state } = setup([6, 6]);
    let s = act(engine, state, { type: 'move.start', units: ['g1', 'g2'] }).state;
    s = act(engine, s, { type: 'move.smoke', throws: [{ unit: 'g1', target: 'yN5' }, { unit: 'g2', target: 'yN5' }] }).state;
    expect(moveState({ state: s } as never)).toBeFalsy();
    expect(check(engine, s, { type: 'move.start', units: ['g1'] })).toBeTruthy();
    expect(check(engine, s, { type: 'move.start', units: ['g3'] })).toBeNull();
  });

  it('into the next Player Turn: the Smoke and the attempt records are gone, and the units move and throw again', () => {
    const { engine, state } = setup([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    let s = act(engine, state, { type: 'move.start', units: ['g1', 'g2'] }).state;
    s = pass(engine, act(engine, s, { type: 'move.smoke', throws: [{ unit: 'g1', target: 'yN5' }, { unit: 'g2', target: 'yN5' }] }).state);
    s = pass(engine, act(engine, s, { type: 'move.end' }).state);
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.hexMarkers['yN5']?.['smoke']).toBeUndefined();
    // Play on to the German's next Player Turn.
    const turn = s.turn;
    for (let i = 0; i < 40 && !(s.turn > turn && s.attacker === 'ge' && s.phase === 'MPh'); i++) {
      const d = engine.currentDecision(s)!;
      s = act(engine, s, { type: d.kind === 'firstFire' ? 'defPass' : 'endPhase', side: d.owner }).state;
    }
    expect(s.phase).toBe('MPh');
    expect(s.attacker).toBe('ge');
    expect(Object.values(s.pieces).every((p) => !Object.keys(p.tags).some((k) => /smoke/i.test(k)))).toBe(true);
    s = act(engine, s, { type: 'move.start', units: ['g1', 'g2'] }).state;
    expect(moveState({ state: s } as never)!.smokeTriedBy ?? []).toEqual([]);
    s = pass(engine, act(engine, s, { type: 'move.smoke', throws: [{ unit: 'g1', target: 'yN5' }, { unit: 'g2', target: 'yN5' }] }).state);
    s = pass(engine, act(engine, s, { type: 'move.step', to: 'yN4' }).state);
    expect(s.pieces['g1']!.loc).toMatchObject({ hex: 'yN4' });
  });
});
