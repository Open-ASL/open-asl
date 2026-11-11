import { describe, expect, it } from 'vitest';
import type { Action } from '@asl/engine';
import { piecesToPlace, placementHexes } from '@asl/rules';
import { newSk1Game } from '../src';
import { SK_S19 } from '../src/scenarios/skFree';

// A German leader set up in flooded S8, and the American entry once
// drew no Defensive First Fire from the German half-squads holding the at-start LMG.
describe('S19 Purple Heart Lane', () => {
  /** The German set up as in the game that showed it: the half-squads in V6/W6, each holding the other's LMG. */
  const germanSetup = (leader70: string) => ({
    placements: { 'ge.0.0.ge.238h.1': 'yV6', 'ge.0.0.ge.238h.2': 'yW6', 'ge.0.1.ge.L80.1': 'yU6', 'ge.0.2.ge.L70.1': leader70 },
    sw: { 'ge.0.0.ge.238h.1.sw1': 'ge.0.0.ge.238h.2', 'ge.0.0.ge.238h.2.sw1': 'ge.0.0.ge.238h.1' },
  });

  it('offers no flooded (grain) hex for setup', () => {
    const { engine, state } = newSk1Game(SK_S19, 's19');
    const env = engine.env(state);
    const todo = piecesToPlace(env, engine.currentDecision(state)!);
    for (const p of todo) expect(placementHexes(env, p)).not.toContain('yS8');
    const a = engine.legalActions(state, 'ge').find((x) => x.type === 'setup.place')!;
    expect(engine.validate(state, { ...a, ...germanSetup('yS8') } as Action)).toBe('yS8 is not a setup hex for this unit');
  });

  it('offers the German Defensive First Fire, half-squads firing their LMG, as the Americans enter CC7', () => {
    const { engine, state: s0 } = newSk1Game(SK_S19, 's19');
    const place = engine.legalActions(s0, 'ge').find((x) => x.type === 'setup.place')!;
    let state = engine.submit(s0, { ...place, ...germanSetup('yS6') } as Action).state;
    for (let i = 0; i < 50 && state.phase !== 'MPh'; i++) {
      const d = engine.currentDecision(state)!;
      const l = engine.legalActions(state, d.owner);
      state = engine.submit(state, l.find((x) => x.type === 'endPhase') ?? l[0]!).state;
    }
    const start = engine.legalActions(state, 'am').find((x) => x.type === 'move.start' && (x['units'] as string[]).includes('am.4.0.am.747.1'))!;
    state = engine.submit(state, { ...start, units: ['am.4.0.am.747.1'] }).state;
    const step = engine.legalActions(state, 'am').find((x) => x.type === 'move.step' && x['to'] === 'yCC7')!;
    state = engine.submit(state, step).state;
    expect(engine.currentDecision(state)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    const shots = engine.legalActions(state, 'ge').filter((x) => x.type === 'fire' || x.type === 'defFire');
    expect(shots.length).toBeGreaterThan(0);
  });
});
