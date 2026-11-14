import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState } from '@asl/engine';
import { DEMO_JUNGLE_SCENARIO, newGame } from '../src';
import { turnBoundaryCheck } from './randomPlayChecks';

/**
 * Demo 5 sets every unit up in a fixed hex, so it has no setup decision and opens straight in the Rally Phase. SK4 8.3
 * still applies: a unit no enemy unit can see after setup starts concealed. Its Banzai group sees the Marines in oW8
 * across open ground and may charge them on the Japanese Turn 1 (8.1.8.6).
 */
const act = (engine: Engine, s: GameState, a: Omit<Action, 'side' | 'decisionId'> & Record<string, unknown>) => {
  const d = engine.currentDecision(s)!;
  return engine.submit(s, { ...a, side: d.owner, decisionId: d.id } as Action).state;
};
/** One step through the phases: pass any First Fire or other ask, otherwise end the phase. */
const onward = (engine: Engine, s: GameState): GameState => {
  const d = engine.currentDecision(s)!;
  const legal = engine.legalActions(s, d.owner).filter((a) => a.type !== 'concede' && !engine.validate(s, a));
  const pick = d.kind === 'phase' ? (legal.find((a) => a.type === 'endPhase') ?? legal[0]) : (legal.find((a) => /pass|arranged|keep|declared/i.test(a.type)) ?? legal[0]);
  if (!pick) throw new Error(`stuck in ${s.phase} ${d.kind}`);
  const { side: _s, decisionId: _d, ...rest } = pick;
  return act(engine, s, rest);
};
const concealed = (s: GameState, hex: string) =>
  Object.values(s.pieces)
    .filter((p) => p.loc.kind === 'hex' && p.loc.hex === hex)
    .map((p) => !!p.tags['concealed']);

describe('Demo 5 Jungle Village', () => {
  it('opens in the Marine RPh with every unit out of enemy LOS concealed (SK4 8.3), even with no setup decision', () => {
    const { state } = newGame(DEMO_JUNGLE_SCENARIO, 'jungle', { los: 'pixel' });
    expect([state.turn, state.attacker, state.phase]).toEqual([1, 'am', 'RPh']);
    for (const hex of ['oY5', 'oAA4', 'oAA5', 'oCC6', 'oDD5', 'oW4', 'oW5']) expect(concealed(state, hex), hex).not.toContain(false);
    // The Banzai group and the Marines in oW8 see each other: neither is concealed. A vehicle never is.
    for (const hex of ['oAA9', 'oW8', 'oZ7']) expect(concealed(state, hex), hex).not.toContain(true);
  });

  it('offers the Banzai Charge at oW8 on the Japanese Turn 1, charges home, and the next Player Turn starts clean', () => {
    const { engine, state: s0 } = newGame(DEMO_JUNGLE_SCENARIO, 'jungle', { los: 'pixel' });
    const check = turnBoundaryCheck('demo-jungle banzai');
    let s = s0;
    for (let i = 0; i < 300 && !(s.attacker === 'ja' && s.phase === 'MPh'); i++) s = onward(engine, s);
    const declare = engine.legalActions(s, 'ja').find((a) => a.type === 'banzai.declare' && a['target'] === 'oW8');
    expect(declare).toBeDefined();
    const { side: _s, decisionId: _d, ...decl } = declare!;
    s = act(engine, s, decl);
    const units = decl['units'] as string[];
    for (const id of units) expect(s.pieces[id]!.tags['banzai']).toBe('charging');
    for (let i = 0; i < 80 && s.ext['sk4.banzai']; i++) {
      const d = engine.currentDecision(s)!;
      if (d.kind !== 'phase') {
        s = onward(engine, s);
        continue;
      }
      const steps = engine.legalActions(s, 'ja').filter((a) => a.type === 'banzai.step' || a.type === 'banzai.end');
      expect(steps.length).toBeGreaterThan(0);
      const { side: _x, decisionId: _y, ...st } = steps.find((a) => a.type === 'banzai.step') ?? steps[0]!;
      s = act(engine, s, st);
    }
    expect(s.ext['sk4.banzai']).toBeUndefined();
    const alive = units.filter((id) => s.pieces[id]?.loc.kind === 'hex');
    expect(alive.length).toBeGreaterThan(0);
    for (const id of alive) expect(s.pieces[id]!.tags['banzai']).toBe('done');
    // On through the Japanese CCPh (Hand-to-Hand if they reached the Marines) into the Marines' Turn 2.
    for (let i = 0; i < 300 && !(s.turn === 2 && s.attacker === 'am' && s.phase === 'PFPh') && !s.result; i++) {
      s = onward(engine, s);
      check(s);
    }
    expect([s.turn, s.attacker, s.phase]).toEqual([2, 'am', 'PFPh']);
    for (const id of alive.filter((x) => s.pieces[x]?.loc.kind === 'hex')) expect(s.pieces[id]!.tags['banzai']).toBeUndefined();
    // The Marines who did not take part still fire and move normally.
    expect(engine.legalActions(s, 'am').some((a) => a.type !== 'endPhase' && a.type !== 'concede')).toBe(true);
  });
});
