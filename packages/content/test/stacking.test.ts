import { describe, expect, it } from 'vitest';
import type { Action } from '@asl/engine';
import { dmChoiceIllegal, firerPenalty, hasLos, moveState, overstackBy, planRout, simpleShots, type ScenarioDef } from '@asl/rules';
import { ASL_TESTBED_SCENARIO, ASL_TESTBED_STACKING_SCENARIO, ASL_TESTBED_VEHICLES_SCENARIO, FixtureBuilder, fixtureActions, newGame } from '../src';

/*
 * Overstacking on the test beds (ASLRB A5.1, A5.5, A5.11, A5.12, A5.132, A4.72, A10.51, A10.62, A12.14): each dev fixture's
 * position offers what its description promises.
 */

function fixture(scenario: ScenarioDef, id: string, seed = 'stacking-test') {
  const g = newGame(scenario, seed);
  let s = g.state;
  for (const a of fixtureActions(g.engine, s, id)) s = g.engine.submit(s, a).state;
  return new FixtureBuilder(g.engine, s);
}
const offered = (f: FixtureBuilder, type: string) => f.engine.legalActions(f.state, f.decision.owner).filter((a) => a.type === type);
const check = (f: FixtureBuilder, a: Record<string, unknown>) => f.engine.validate(f.state, { ...a, side: f.decision.owner, decisionId: f.decision.id } as Action);

describe('T8 stacking fixtures', () => {
  it('overstack-move: the 4-4-7 enters V8 (three 4-6-7) at 3 MF; from there the Germans fire at +1 (A5.11, A5.12)', () => {
    const f = fixture(ASL_TESTBED_STACKING_SCENARIO, 'overstack-move');
    const sq = f.unit('ge', 'ge.447', 1);
    f.act({ type: 'move.start', units: [sq] });
    f.act({ type: 'move.step', to: 'uV8' });
    expect(moveState(f.engine.env(f.state))!.spent[sq]).toBe(3);
    expect(overstackBy(f.engine.env(f.state), 'uV8', 'ge').personnel).toBe(1);
    expect(firerPenalty(f.engine.env(f.state), 'uV8', 'ge')).toBe(1);
  });

  it('overstack-five-smc: four leaders count nothing; the 9-1 entering makes five, a HS: 3 MF (A5.5)', () => {
    const f = fixture(ASL_TESTBED_STACKING_SCENARIO, 'overstack-five-smc');
    expect(overstackBy(f.engine.env(f.state), 'uV8', 'ge').personnel).toBe(0);
    const l = f.unit('ge', 'ge.L91', 1);
    f.act({ type: 'move.start', units: [l] });
    f.act({ type: 'move.step', to: 'uV8' });
    expect(moveState(f.engine.env(f.state))!.spent[l]).toBe(3);
  });

  it('overstack-advance: the 4-4-7 advancing into V8 becomes CX at four MF (A5.11 EX, A4.72)', () => {
    const f = fixture(ASL_TESTBED_STACKING_SCENARIO, 'overstack-advance');
    expect(f.state.phase).toBe('APh');
    const sq = f.unit('ge', 'ge.447', 1);
    expect(f.state.pieces[f.unit('ge', 'ge.467', 3)]!.loc).toMatchObject({ hex: 'uV8' });
    f.act({ type: 'advance', units: [sq], to: 'uV8' });
    expect(f.state.pieces[sq]!.tags['cx']).toBe(true);
  });

  it('overstack-rout: the broken 4-4-7 in O6 must rout; the overstacked N6 building is a destination at 3 MF (A10.51, A5.11)', () => {
    const f = fixture(ASL_TESTBED_STACKING_SCENARIO, 'overstack-rout');
    const b = f.unit('ru', 'ru.447', 3);
    expect(f.state.pieces[b]!.tags['broken']).toBe(true);
    const plan = planRout(f.engine.env(f.state), b);
    expect(plan.cost.get('uN6')).toBe(3);
    expect(plan.destinations).toContain('uN6');
    f.settle('ru');
    expect(check(f, { type: 'rout.step', unit: b, to: 'uN6' })).toBeNull();
  });

  it('overstack-dm: the broken 4-4-7 routed into the overstacked N10 woods may keep its DM (A10.62, A10.51)', () => {
    const f = fixture(ASL_TESTBED_STACKING_SCENARIO, 'overstack-dm');
    const b = f.unit('ru', 'ru.447', 3);
    expect(f.state.phase).toBe('RPh');
    expect(f.state.pieces[b]!.loc).toMatchObject({ hex: 'uN10' });
    expect(f.state.pieces[b]!.tags).toMatchObject({ broken: true, dm: true });
    expect(overstackBy(f.engine.env(f.state), 'uN10', 'ru').personnel).toBe(1);
    expect(dmChoiceIllegal(f.engine.env(f.state), 'ru', b)).toBeNull();
  });
});

describe('T1 and T5 stacking fixtures', () => {
  it('overstack-hidden: the 4-4-7 moving into P5 (in German view) reveals the hidden squad there (A12.14)', () => {
    const f = fixture(ASL_TESTBED_SCENARIO, 'overstack-hidden');
    const hidden = f.unit('ru', 'ru.447', 1);
    expect(f.state.pieces[hidden]!.tags['hip']).toBe(true);
    expect(hasLos(f.engine.env(f.state), 'uS5', 'uP5')).toBe(true);
    f.act({ type: 'move.start', units: [f.unit('ru', 'ru.447', 3)] });
    f.act({ type: 'move.step', to: 'uP5' });
    expect(f.state.pieces[hidden]!.tags['hip']).toBeUndefined();
  });

  it('overstack-hidden-unseen: the same in K4, out of German view, leaves it hidden; the mover pays 3 MF (A12.14, A5.11)', () => {
    const f = fixture(ASL_TESTBED_SCENARIO, 'overstack-hidden-unseen');
    const hidden = f.unit('ru', 'ru.447', 1);
    const mover = f.unit('ru', 'ru.447', 3);
    f.act({ type: 'move.start', units: [mover] });
    f.act({ type: 'move.step', to: 'uK4' });
    expect(moveState(f.engine.env(f.state))!.spent[mover]).toBe(3);
    expect(f.state.pieces[hidden]!.tags['hip']).toBe(true);
  });

  it('overstack-vehicles: the PSW 234/1 and the PzKpfw IVF2 share U6 after the MPh; the Russian Gun names either (A5.2)', () => {
    const f = fixture(ASL_TESTBED_VEHICLES_SCENARIO, 'overstack-vehicles');
    expect(f.state.phase).toBe('DFPh');
    expect(f.state.pieces[f.unit('ge', 'ge.psw2341')]!.loc).toMatchObject({ hex: 'uU6' });
    expect(f.state.pieces[f.unit('ge', 'ge.pzivf2')]!.loc).toMatchObject({ hex: 'uU6' });
    const named = simpleShots(f.engine.env(f.state), 'ru', ['uU6'], 'final').filter((s) => s.targetType === 'VTT').map((s) => s.targetUnit);
    expect(new Set(named)).toEqual(new Set([f.unit('ge', 'ge.psw2341'), f.unit('ge', 'ge.pzivf2')]));
  });
});
