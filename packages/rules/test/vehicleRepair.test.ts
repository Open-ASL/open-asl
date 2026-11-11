import { describe, expect, it } from 'vitest';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { T3 } from '../src/sk3/status';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * Repair of a vehicle's Main Armament and MGs in the Rally Phase (SK4 3.1 c, 7.2): a dr of 1
 * repairs, a 6 disables it for good (a disabled MA Recalls the vehicle), anything else leaves it
 * malfunctioned; one attempt per weapon per RPh. Both players get their attempt: the DEFENDER's
 * vehicles repair in the ATTACKER's RPh once it passes to him.
 */

const extra = [...sk2CoreModules, ...sk3CoreModules];
const t34 = (tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yM9', tags: { vca: 0, ca: 0, ...tags } });
const tiger = (tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id: 'tiger', def: 'ge.pzvie', side: 'ge', hex: 'yM4', tags: { vca: 3, ca: 3, ...tags } });
const game = (pieces: PieceSpec[], dice: number[]) => makeEngine({ pieces, scenario: RU_VS_GE, extra, startPhase: 'RPh', dice });
const repairs = (legal: { type: string; [k: string]: unknown }[], vehicle: string) => legal.filter((a) => a.type === 'vehicle.repair' && a['vehicle'] === vehicle);

describe('Vehicle weapon repair (SK4 3.1 c)', () => {
  it('the ATTACKER may try to repair a malfunctioned MA: a dr of 1 repairs it', () => {
    const { engine, state } = game([t34({ malf: true }), tiger()], [1]);
    expect(repairs(engine.legalActions(state, 'ru'), 't34').map((a) => a['weapon'])).toEqual(['ma']);
    const r = act(engine, state, { type: 'vehicle.repair', vehicle: 't34', weapon: 'ma' });
    expect(r.state.pieces['t34']!.tags['malf']).toBeUndefined();
    expect(r.events.find((e) => e.type === 'sk3.vehicle.repair')?.payload).toMatchObject({ vehicle: 't34', weapon: 'ma', dr: 1, result: 'repaired' });
  });

  it('a dr of 2–5 leaves it malfunctioned and the attempt is spent for this RPh', () => {
    const { engine, state } = game([t34({ malf: true }), tiger()], [4]);
    const r = act(engine, state, { type: 'vehicle.repair', vehicle: 't34', weapon: 'ma' });
    expect(r.state.pieces['t34']!.tags['malf']).toBe(true);
    expect(repairs(engine.legalActions(r.state, 'ru'), 't34')).toHaveLength(0);
    const d = engine.currentDecision(r.state)!;
    expect(engine.validate(r.state, { type: 'vehicle.repair', vehicle: 't34', weapon: 'ma', side: 'ru', decisionId: d.id } as never)).toMatch(/Already attempted/);
  });

  it('a dr of 6 disables the MA for good and Recalls the vehicle', () => {
    const { engine, state } = game([t34({ malf: true }), tiger()], [6]);
    const r = act(engine, state, { type: 'vehicle.repair', vehicle: 't34', weapon: 'ma' });
    expect(r.state.pieces['t34']!.tags['malf']).toBeUndefined();
    expect(r.state.pieces['t34']!.tags[T3.maDisabled]).toBe(true);
    expect(r.state.pieces['t34']!.tags[T3.recall]).toBe(true);
  });

  it('the DEFENDER\'s Tiger with a malfunctioned 88L gets its attempt when the RPh passes to him', () => {
    const { engine, state } = game([t34(), tiger({ malf: true })], [1]);
    // Not in the ATTACKER's half of the phase.
    expect(repairs(engine.legalActions(state, 'ge'), 'tiger')).toHaveLength(0);
    const s = act(engine, state, { type: 'endPhase' }).state;
    expect(engine.currentDecision(s)?.owner).toBe('ge');
    expect(repairs(engine.legalActions(s, 'ge'), 'tiger').map((a) => a['weapon'])).toEqual(['ma']);
    const r = act(engine, s, { type: 'vehicle.repair', vehicle: 'tiger', weapon: 'ma' });
    expect(r.state.pieces['tiger']!.tags['malf']).toBeUndefined();
  });

  it('a Shocked crew cannot repair', () => {
    // The RPh opens with the recuperation dr (SK4 3.1 g): a 5 leaves the crew Shocked (Unconfirmed Kill), so no repair.
    const { engine, state } = game([t34({ malf: true, [T3.shock]: 'shock' }), tiger()], [5, 1]);
    expect(state.pieces['t34']!.tags[T3.shock]).toBe('uk');
    expect(repairs(engine.legalActions(state, 'ru'), 't34')).toHaveLength(0);
    const d = engine.currentDecision(state)!;
    expect(engine.validate(state, { type: 'vehicle.repair', vehicle: 't34', weapon: 'ma', side: 'ru', decisionId: d.id } as never)).toMatch(/Shocked/);
  });
});
