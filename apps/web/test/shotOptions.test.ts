import { describe, expect, it } from 'vitest';
import { sk2CoreModules, sk3CoreModules } from '@asl/rules';
import { RU_VS_GE, makeEngine, type PieceSpec } from '../../../packages/rules/test/fixtures';
import { shotOptions } from '../src/game/ordnance';

const extra = [...sk2CoreModules, ...sk3CoreModules];
const t34 = (tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yM8', tags: { vca: 0, ca: 0, ...tags } });
const options = (pieces: PieceSpec[]) => {
  const { engine, state } = makeEngine({ pieces, scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'DFPh' });
  return shotOptions(engine.env(state), 't34', 'final');
};

describe('vehicle Main Armament fire options', () => {
  it('a CE crew in a Restricted Slow Traverse turret has every option disabled, saying why (SK4 7.2)', () => {
    const opts = options([t34({ ce: true }), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM5' }]);
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) {
      expect(o.available).toBe(false);
      expect(o.hint).toMatch(/Restricted Slow Traverse/);
    }
  });

  it('Buttoned Up it may fire; the Vehicle Target Type waits for an enemy vehicle in sight', () => {
    const noTank = options([t34(), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM5' }]);
    expect(noTank.find((o) => o.type === 'ITT')?.available).toBe(true);
    for (const o of noTank.filter((o) => o.type === 'VTT')) expect(o.hint).toMatch(/No enemy vehicle/);
    const tank = options([t34(), { id: 'pziv', def: 'ge.pzivf2', side: 'ge', hex: 'yM5', tags: { vca: 3, ca: 3 } }]);
    expect(tank.find((o) => o.type === 'VTT')?.available).toBe(true);
  });
});

describe('LATW fire options', () => {
  const baz = (pieces: PieceSpec[], terrain: Record<string, { terrain: string; buildingId?: string }> = {}) => {
    const { engine, state } = makeEngine({
      pieces: [{ id: 'u', def: 'ge.467', side: 'ge', hex: 'yK5' }, { id: 'z', def: 'ge.BAZ43', side: 'ge', heldBy: 'u' }, ...pieces],
      scenario: { ...RU_VS_GE, firstSide: 'ge' },
      extra,
      terrain,
      startPhase: 'PFPh',
    });
    return shotOptions(engine.env(state), 'z', 'prep');
  };

  it('a Bazooka may aim at an enemy vehicle in sight (SK4 4.4)', () => {
    expect(baz([{ id: 'sq', def: 'ru.458', side: 'ru', hex: 'yM5' }]).find((o) => o.type === 'VTT')?.hint).toMatch(/No enemy vehicle/);
    const opts = baz([t34()]);
    expect(opts.find((o) => o.type === 'VTT')).toMatchObject({ available: true, hint: expect.stringMatching(/HEAT TK 13/) });
  });

  it('from a building the vehicle shot also chooses +2 To Hit or the Backblast (SK4 4.4.3)', () => {
    const opts = baz([t34()], { yK5: { terrain: 'building-stone', buildingId: 'b1' } }).filter((o) => o.type === 'VTT');
    expect(opts.map((o) => o.backblast)).toEqual([false, true]);
  });
});
