import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '@asl/engine';
import { ASL_TESTBED_SCENARIO, ASL_TESTBED_STACKING_SCENARIO, ASL_TESTBED_VEHICLES_SCENARIO, fixtureActions, newGame } from '@asl/content';
import { moveState, type ScenarioDef } from '@asl/rules';
import { dmChoices } from '../src/game/dmChoice';
import { advanceNote, overstackBadges, overstackStepNote, strayHitText, vehicleTargets } from '../src/game/overstacking';

/*
 * Full ASL overstacking as the app shows it (ASLRB A5.1, A5.5, A5.11, A5.12, A5.131, A5.2, A5.132, A4.72, A10.62, A12.14):
 * no confirmation, the step and advance notes with their MF, the board badge per overstacked Location as each side knows
 * it, the DM choice and the vehicle a shot names. On the test bed fixtures.
 */
function load(scenario: ScenarioDef, id: string, seed = 'overstacking-view') {
  const g = newGame(scenario, seed);
  let state = g.state;
  for (const a of fixtureActions(g.engine, state, id)) state = g.engine.submit(state, a).state;
  const submit = (s: GameState, a: Record<string, unknown>) => {
    const d = g.engine.currentDecision(s)!;
    return g.engine.submit(s, { ...a, side: d.owner, decisionId: d.id } as Action).state;
  };
  const unit = (s: GameState, side: string, def: string, n = 1) => Object.values(s.pieces).filter((p) => p.side === side && p.defId === def).sort((a, b) => (a.id < b.id ? -1 : 1))[n - 1]!.id;
  return { g, state, submit, unit };
}
const badgesAt = (b: { hex: string; text: string }[], hex: string) => b.filter((x) => x.hex === hex).map((x) => x.text);

describe('overstacking on the board and in the step notes', () => {
  it('overstack-move: the step into V8 reads its cost and what it brings; then V8 wears OVERSTACKED +1 for both sides (A5.11, A5.12, A5.131)', () => {
    const { g, state, submit, unit } = load(ASL_TESTBED_STACKING_SCENARIO, 'overstack-move');
    expect(badgesAt(overstackBadges(g.engine.env(state), 'ge'), 'uV8')).toEqual([]);
    const s = submit(state, { type: 'move.start', units: [unit(state, 'ge', 'ge.447', 1)] });
    const env = g.engine.env(s);
    expect(overstackStepNote(env, moveState(env)!, 'uV8')).toEqual({ badge: '3 MF (+1 overstacked, A5.11)', warning: 'Overstacks V8 by 1: +1 to its attacks, -1 to attacks on it (A5.12, A5.131)' });
    // A hex the stack would not overstack has no note.
    expect(overstackStepNote(env, moveState(env)!, 'uU9')).toBeNull();
    const after = submit(s, { type: 'move.step', to: 'uV8' });
    for (const viewer of ['ge', 'ru', null] as const) expect(badgesAt(overstackBadges(g.engine.env(after), viewer), 'uV8'), `${viewer}`).toEqual(['OVERSTACKED +1']);
    expect(overstackBadges(g.engine.env(after), 'ru').find((b) => b.hex === 'uV8')!.hint).toMatch(/\+1 to every attack from it \(A5\.12\), -1 to attacks on its Personnel \(A5\.131/);
  });

  it('overstack-five-smc: four leaders count nothing, the fifth makes a HS: 3 MF into V8 (A5.5)', () => {
    const { g, state, submit, unit } = load(ASL_TESTBED_STACKING_SCENARIO, 'overstack-five-smc');
    expect(badgesAt(overstackBadges(g.engine.env(state), 'ge'), 'uV8')).toEqual([]);
    const s = submit(state, { type: 'move.start', units: [unit(state, 'ge', 'ge.L91', 1)] });
    const env = g.engine.env(s);
    expect(overstackStepNote(env, moveState(env)!, 'uV8')!.badge).toBe('3 MF (+1 overstacked, A5.11)');
  });

  it('overstack-advance: the advance into V8 reads four MF and the CX it brings; a CX unit has none to read (A5.11 EX, A4.72)', () => {
    const { g, state, unit } = load(ASL_TESTBED_STACKING_SCENARIO, 'overstack-advance');
    const env = g.engine.env(state);
    expect(advanceNote(env, [unit(state, 'ge', 'ge.447', 1)], 'uV8')).toBe('4 MF (+2 overstacked, A5.11): the 4-4-7 becomes CX (A4.72)');
    // An advance into the open costs one MF and brings nothing to say.
    expect(advanceNote(env, [unit(state, 'ge', 'ge.447', 1)], 'uT8')).toBeNull();
  });

  it('overstack-hidden-unseen: the Germans see no overstacking in K4, the Russians do (A12.14: the hidden squad counts for its own side only)', () => {
    const { g, state, submit, unit } = load(ASL_TESTBED_SCENARIO, 'overstack-hidden-unseen');
    const s0 = submit(state, { type: 'move.start', units: [unit(state, 'ru', 'ru.447', 3)] });
    const s = submit(s0, { type: 'move.step', to: 'uK4' });
    expect(badgesAt(overstackBadges(g.engine.env(s), 'ru'), 'uK4')).toEqual(['OVERSTACKED +1']);
    expect(badgesAt(overstackBadges(g.engine.env(s), 'ge'), 'uK4')).toEqual([]);
  });
});

describe('the DM choice of an overstacked unit (A10.62)', () => {
  it('overstack-dm: in the overstacked N10 woods the broken 4-4-7 may remove or keep its DM, and the entry says why', () => {
    const { g, state, submit, unit } = load(ASL_TESTBED_STACKING_SCENARIO, 'overstack-dm');
    const b = unit(state, 'ru', 'ru.447', 3);
    const c = dmChoices(g.engine.env(state), 'ru', [state.pieces[b]!])[0]!;
    expect([c.kind, c.why, c.label]).toEqual(['remove', null, 'Remove DM (overstacked: it may keep it, A10.62)']);
    expect(c.hint).toMatch(/ASLRB A10\.62/);
    const s = submit(state, { type: 'rally.dmRemove', unit: b });
    expect(dmChoices(g.engine.env(s), 'ru', [s.pieces[b]!])[0]!.label).toBe('Keep DM (overstacked, A10.62)');
  });
});

describe('vehicles sharing a hex (A5.2, A5.132)', () => {
  it('overstack-vehicles: the Russian Gun names either German vehicle in U6; U6 wears OVERSTACKED +1', () => {
    const { g, state } = load(ASL_TESTBED_VEHICLES_SCENARIO, 'overstack-vehicles');
    const env = g.engine.env(state);
    expect(vehicleTargets(env, 'uU6', 'ru').map((v) => v.label).sort()).toEqual(['PSW 234/1', 'PzKw IVF2']);
    expect(badgesAt(overstackBadges(env, 'ru'), 'uU6')).toEqual(['OVERSTACKED +1']);
    expect(overstackBadges(env, 'ru').find((b) => b.hex === 'uU6')!.hint).toMatch(/1 vehicle: \+1 to every attack from it \(A5\.12\); a Vehicle Target Type shot that just misses may hit another vehicle there \(A5\.132\)/);
  });

  it('the A5.132 log line names the missed vehicle, the dr and the one it hits', () => {
    const name = (id: string) => ({ a: 'German PzKpfw IVF2', b: 'German PSW 234/1' })[id] ?? id;
    expect(strayHitText({ target: 'a', by: 1, vehicles: 2, dr: 1, hit: 'b' }, name)).toBe('  ↯ Missed the PzKpfw IVF2 by 1 (< 2 vehicles in the hex): overstack dr 1 < 2 hits the PSW 234/1 (A5.132)');
    expect(strayHitText({ target: 'a', by: 1, vehicles: 2, dr: 4, hit: null }, name)).toBe('  ↯ Missed the PzKpfw IVF2 by 1 (< 2 vehicles in the hex): overstack dr 4, no other vehicle hit (A5.132)');
  });
});
