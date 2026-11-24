import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '@asl/engine';
import { ASL_TESTBED_DEPLOY_SCENARIO, ASL_TESTBED_SCENARIO, fixtureActions, newGame } from '@asl/content';
import { deployEntries } from '../src/game/deployEntries';

/*
 * The RPh wheel's Deploy and Recombine entries (ASLRB A1.31, A1.32, A10.7, A25.2, A2.8), on the test bed fixtures: what a
 * player is offered in a stack, with the NTC number, and what is greyed with its reason.
 */
function load(scenario: typeof ASL_TESTBED_SCENARIO, id: string) {
  const g = newGame(scenario, 'deploy-entries');
  let state = g.state;
  for (const a of fixtureActions(g.engine, state, id)) state = g.engine.submit(state, a).state;
  const at = (s: GameState) => {
    const d = g.engine.currentDecision(s)!;
    const env = g.engine.env(s);
    const check = (a: Record<string, unknown>) => g.engine.validate(s, { ...a, side: d.owner, decisionId: d.id } as Action);
    const here = (hex: string) => Object.values(s.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === hex);
    return { d, entries: (hex: string) => deployEntries(env, s, g.engine.legalActions(s, d.owner), check, here(hex), d.owner) };
  };
  return { g, state, at };
}

describe('RPh wheel: Deploy and Recombine entries', () => {
  it('the 9-2 stack offers each squad a Deploy with the NTC number; the 8-3-8 asks how its FT and DC are shared; after it, the 5-4-8 is greyed with A10.7', () => {
    const { g, state, at } = load(ASL_TESTBED_SCENARIO, 'deploy-rph');
    const t3 = at(state).entries('uT3');
    expect(t3.map((e) => [e.label, e.disabled]).sort()).toEqual([
      ['Deploy 5-4-8 into two 2-3-8 (9-2 (-2): NTC ≤ 10)', false],
      ['Deploy 8-3-8 into two 3-3-8 (9-2 (-2): NTC ≤ 10)', false],
    ]);
    const ae = t3.find((e) => e.label.startsWith('Deploy 8-3-8'))!;
    expect(ae.options[0]!.askSplit).toBe(true);
    expect(t3.find((e) => e.label.startsWith('Deploy 5-4-8'))!.options[0]!.askSplit).toBe(false);
    const d = g.engine.currentDecision(state)!;
    const s = g.engine.submit(state, { ...ae.options[0]!.action, side: d.owner, decisionId: d.id } as Action).state;
    const after = at(s).entries('uT3');
    expect(after.find((e) => e.label.startsWith('Deploy 5-4-8'))).toMatchObject({ disabled: true, hint: expect.stringMatching(/directed a Deployment this RPh.*\(A1\.31, A10\.7\)/) });
    // The 8-0 stack in S5 still offers its own squads.
    expect(at(s).entries('uS5').filter((e) => !e.disabled).map((e) => e.label).sort()).toEqual(['Deploy 4-4-7 into two 2-3-7 (8-0 (+0): NTC ≤ 7)', 'Deploy 4-6-7 into two 2-4-7 (8-0 (+0): NTC ≤ 7)']);
  });

  it('a Russian squad is greyed with A25.2 in the Russian RPh', () => {
    const { state, at } = load(ASL_TESTBED_SCENARIO, 'deploy-ru');
    const k4 = at(state).entries('uK4');
    expect(k4).toEqual([expect.objectContaining({ kind: 'deploy', label: 'Deploy 4-5-8 into two 2-4-8', disabled: true, hint: 'Russian squads may not Deploy (A25.2)' })]);
  });

  it('the Russian HS in the German RPh: Recombine offered, no Deploy shown to the DEFENDER; across the foxhole rim greyed with A2.8', () => {
    const r = load(ASL_TESTBED_DEPLOY_SCENARIO, 'recombine-ru');
    const h5 = r.at(r.state).entries('uH5');
    expect(h5.map((e) => [e.kind, e.label, e.disabled])).toEqual([['recombine', 'Recombine 2-2-6 + 2-2-6 into a 4-2-6 (7-0 permits)', false]]);
    const f = load(ASL_TESTBED_DEPLOY_SCENARIO, 'recombine-foxhole');
    expect(f.at(f.state).entries('uO10')).toEqual([expect.objectContaining({ kind: 'recombine', disabled: true, hint: 'One is beneath the entrenchment, the other is not (A1.32, A2.8)' })]);
  });
});
