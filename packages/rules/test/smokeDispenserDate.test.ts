import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { smokeDispenser, smokeDispenserLabel, vehicle } from '../src/sk3/status';
import type { CounterDef, VehicleDef } from '../src/common/statics';
import { COUNTERS, RU_VS_GE, act, makeEngine } from './fixtures';

/*
 * A smoke dispenser with a superscripted date on the counter back is there only from that date, and its usage number
 * may change with the date, as a Depletion Number does (SK4 6.2, 7.5; SK4 Japanese Vehicle Notes: "sD becomes
 * available in 1944—as signified by the superscript '4+'"). The Panther G's back reads "sN7⁴/8⁵".
 */

const panther: CounterDef = {
  ...(COUNTERS['ge.pzivf2'] as VehicleDef),
  id: 'ge.pzvg',
  name: 'PzKw VG',
  smoke: [{ kind: 'sN', n: 7, steps: [{ n: 7, from: { year: 1944 } }, { n: 8, from: { year: 1945 } }] }],
};

/** The Germans move; a buttoned-up Panther G in yM8 (the sN needs a BU crew). */
function game(date: string, month: number) {
  return makeEngine({
    pieces: [{ id: 'pz', def: 'ge.pzvg', side: 'ge', hex: 'yM8', tags: { vca: 0, ca: 0 } }],
    counters: { 'ge.pzvg': panther },
    scenario: { ...RU_VS_GE, firstSide: 'ge', date, month },
    extra: [...sk2CoreModules, ...sk3CoreModules],
    startPhase: 'MPh',
    dice: [2, 2, 2, 2],
  }) as { engine: Engine; state: GameState };
}
const started = (date: string, month: number) => {
  const { engine, state } = game(date, month);
  return { engine, s: act(engine, state, { type: 'vmove.start', vehicle: 'pz' }).state };
};

describe('a dated smoke dispenser (SK4 7.5, 6.2)', () => {
  it('is not there before its date: no sN in 1943', () => {
    const { engine, s } = started('20 July 1943', 7);
    expect(smokeDispenser(engine.env(s), vehicle(engine.env(s), s.pieces['pz']!)!)).toBeUndefined();
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'vmove.smoke')).toBe(false);
    expect(engine.validate(s, { type: 'vmove.smoke', side: 'ge', decisionId: engine.currentDecision(s)!.id } as never)).toMatch(/no smoke dispenser/);
  });

  it('in 1944 it is sN7: offered, and used at 7', () => {
    const { engine, s } = started('24 June 1944', 6);
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'vmove.smoke')).toBe(true);
    const r = act(engine, s, { type: 'vmove.smoke' });
    expect(r.events.find((e) => e.type === 'sk3.vehicle.smoke')!.payload).toMatchObject({ kind: 'sN', n: 7, placed: true, hex: 'yM8' });
  });

  it('in 1945 it is sN8', () => {
    const { engine, s } = started('2 March 1945', 3);
    expect(smokeDispenser(engine.env(s), panther as VehicleDef)).toEqual({ kind: 'sN', n: 8 });
  });

  it('is shown with its dates', () => {
    expect(smokeDispenserLabel((panther as VehicleDef).smoke![0]!)).toBe('sN7 (1944+) / 8 (1945+)');
    expect(smokeDispenserLabel({ kind: 'sD', n: 6 })).toBe('sD6');
  });
});
