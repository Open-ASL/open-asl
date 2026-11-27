import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '@asl/engine';
import { ASL_TESTBED_MOVEMENT_SCENARIO, fixtureActions, newGame } from '@asl/content';
import { moveState } from '@asl/rules';
import { describeEvents } from '../src/game/describe';
import { dashEntry, dashTargets, evadeEntries, lateDoubleTimeEntries, minimumMoveNote, ovrStep, tpbfPanel } from '../src/game/movementEntries';

/*
 * The full ASL movement options as the app offers them (ASLRB A4.134, A4.5, A4.63, A4.15, A4.151, A8.312), on the
 * movement test bed fixtures: the labels, the costs and the reasons a greyed entry shows.
 */
function load(id: string, seed = 'movement-entries') {
  const g = newGame(ASL_TESTBED_MOVEMENT_SCENARIO, seed);
  let state = g.state;
  for (const a of fixtureActions(g.engine, state, id)) state = g.engine.submit(state, a).state;
  const submit = (s: GameState, a: Record<string, unknown>) => {
    const d = g.engine.currentDecision(s)!;
    return g.engine.submit(s, { ...a, side: d.owner, decisionId: d.id } as Action).state;
  };
  const check = (s: GameState) => (a: Record<string, unknown>) => {
    const d = g.engine.currentDecision(s)!;
    return g.engine.validate(s, { ...a, side: d.owner, decisionId: d.id } as Action);
  };
  const unit = (s: GameState, side: string, def: string, n = 1) => Object.values(s.pieces).filter((p) => p.side === side && p.defId === def).sort((a, b) => (a.id < b.id ? -1 : 1))[n - 1]!.id;
  return { g, state, submit, check, unit };
}

describe('movement wheel entries', () => {
  it('min-move: the step into the S3 woods reads as a Minimum Move with its cost and who ends pinned and CX', () => {
    const { g, state, submit, unit } = load('min-move');
    const s = submit(state, { type: 'move.start', units: [unit(state, 'ge', 'ge.467', 4)] });
    const env = g.engine.env(s);
    expect(minimumMoveNote(env, moveState(env)!, 'uS3')).toBe('Minimum Move into S3 (2 MF): the 4-6-7 ends pinned and CX (A4.134)');
    expect(minimumMoveNote(env, moveState(env)!, 'uR4')).toBeNull();
  });

  it('the log names the Minimum Move and the Dash (A4.134, A4.63)', () => {
    const { g, state, submit, unit } = load('min-move');
    const s = submit(state, { type: 'move.start', units: [unit(state, 'ge', 'ge.467', 4)] });
    const d = g.engine.currentDecision(s)!;
    const t = g.engine.submit(s, { type: 'move.step', to: 'uS3', side: d.owner, decisionId: d.id } as Action);
    expect(describeEvents(g.engine.env(t.state), t.events).map((l) => l.text).join('\n')).toMatch(/makes a Minimum Move into S3 \(2 MF\): pinned and CX once the First Fire at it is over \(ASLRB A4\.134\)/);
    const dash = load('dash');
    const s2 = dash.submit(dash.state, { type: 'move.start', units: [dash.unit(dash.state, 'ge', 'ge.447', 1), dash.unit(dash.state, 'ge', 'ge.L80')].sort() });
    const d2 = dash.g.engine.currentDecision(s2)!;
    const t2 = dash.g.engine.submit(s2, { type: 'move.dash', road: 'uN8', to: 'uM9', side: d2.owner, decisionId: d2.id } as Action);
    expect(describeEvents(dash.g.engine.env(t2.state), t2.events).map((l) => l.text).join('\n')).toMatch(/Dash from O8 across N8 to M9 \(ASLRB A4\.63\)/);
  });

  it('double-time-late: one entry for the moving 4-4-7; an Assault Moving stack gets it greyed with A4.61', () => {
    const { g, state, submit, unit } = load('double-time-late');
    expect(lateDoubleTimeEntries(g.engine.env(state))).toEqual([{ units: [unit(state, 'ge', 'ge.447', 2)], label: 'Double Time now (+1 MF, CX)', disabled: null }]);
    let s = submit(state, { type: 'move.end' });
    for (let i = 0; i < 5 && g.engine.currentDecision(s)?.owner === 'ru'; i++) s = submit(s, { type: 'defPass' });
    s = submit(s, { type: 'move.start', units: [unit(s, 'ge', 'ge.447', 1)], assault: true });
    expect(lateDoubleTimeEntries(g.engine.env(s))[0]).toMatchObject({ disabled: 'Assault Movement cannot be voluntarily voided (ASLRB A4.61)' });
  });

  it('dash: "Dash…" on the stack beside N8, the end hexes with their two-hex cost and the Open Ground warning on N9', () => {
    const { g, state, submit, unit } = load('dash');
    const s = submit(state, { type: 'move.start', units: [unit(state, 'ge', 'ge.447', 1), unit(state, 'ge', 'ge.L80')].sort() });
    const env = g.engine.env(s);
    expect(dashEntry(env)).toMatchObject({ label: 'Dash…', disabled: null });
    expect(dashTargets(env).filter((t) => t.road === 'uN8')).toEqual([
      { road: 'uN8', to: 'uM9', badge: 'Dash 3 MF', warning: null },
      { road: 'uN8', to: 'uN9', badge: 'Dash 2 MF', warning: 'N9 is Open Ground: Dash benefits apply only against units that cannot see it (A4.63, A10.531)' },
    ]);
    const after = submit(s, { type: 'move.dash', road: 'uN8', to: 'uM9' });
    expect(dashEntry(g.engine.env(after))).toMatchObject({ label: 'Dashing to M9', disabled: 'Dashing to M9 (A4.63)' });
  });

  it('ovr-leader: the step into N10 offers the leader\'s NTC and each squad\'s, with the woods +1 and the doubled cost', () => {
    const { g, state, submit, check, unit } = load('ovr-leader');
    const s = submit(state, { type: 'move.start', units: [unit(state, 'ge', 'ge.L92'), unit(state, 'ge', 'ge.838'), unit(state, 'ge', 'ge.548')].sort() });
    const env = g.engine.env(s);
    const step = ovrStep(env, moveState(env)!, 'uN10', check(s))!;
    expect(step.refusal).toBeNull();
    expect(step.options.map((o) => o.label)).toEqual(['Overrun the 7-0 (NTC +1 TEM (Woods); 4 MF): leader takes the NTC (exempts all)', 'Overrun the 7-0 (NTC +1 TEM (Woods); 4 MF): each squad takes its own NTC']);
    expect(step.options.map((o) => o.action)).toEqual([{ type: 'move.step', to: 'uN10' }, { type: 'move.step', to: 'uN10', ovr: 'each' }]);
    expect(evadeEntries(env, unit(s, 'ru', 'ru.L70'))).toMatchObject({ slipDisabled: null });
  });

  it('ovr-armed: after the 9-1 stays, the mandatory TPBF panel names him with the LMG', () => {
    for (let i = 0; i < 40; i++) {
      const { g, state, submit, unit } = load('ovr-armed', `movement-entries-${i}`);
      let s = submit(state, { type: 'move.start', units: [unit(state, 'ge', 'ge.L80'), unit(state, 'ge', 'ge.467', 3), unit(state, 'ge', 'ge.447', 1)].sort() });
      s = submit(s, { type: 'move.step', to: 'uN10' });
      if (g.engine.currentDecision(s)?.kind !== 'ovrEvade') continue;
      s = submit(s, { type: 'ovr.stay' });
      expect(tpbfPanel(g.engine.env(s), 'uN10')).toMatchObject({ required: '9-1 with LMG', optional: [] });
      return;
    }
    throw new Error('no seed passed the OVR NTC');
  });
});
