import { describe, expect, it } from 'vitest';
import { sk2CoreModules, sk3CoreModules } from '@asl/rules';
import { GE_VS_BR, RU_VS_GE, act, makeEngine, type PieceSpec } from '../../../packages/rules/test/fixtures';
import { directedShotOptions, shotOptions } from '../src/game/ordnance';

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

describe('Smoke options after other fire (SK4 6.2)', () => {
  it("once the vehicle's MGs fire, its MA's Smoke entry stays listed but disabled, saying why; HE stays available", () => {
    const { engine, state } = makeEngine({
      pieces: [{ id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: 'yM8', tags: { vca: 0, ca: 0 } }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'yM6' }],
      scenario: { ...RU_VS_GE, firstSide: 'ge' },
      extra,
      startPhase: 'PFPh',
      dice: [3, 4],
    });
    const smokeOf = (s: typeof state) => shotOptions(engine.env(s), 'pz', 'prep').find((o) => o.ammo === 'SMOKE')!;
    expect(smokeOf(state).available).toBe(true);
    const s = act(engine, state, { type: 'fire', decl: { units: [], sw: ['pz.bmg', 'pz.cmg'], target: 'yM6' } }).state;
    expect(smokeOf(s)).toMatchObject({ available: false, hint: expect.stringMatching(/Smoke must be fired before the firer fires anything else/) });
    expect(shotOptions(engine.env(s), 'pz', 'prep').find((o) => o.type === 'ITT' && o.ammo === undefined)?.available).toBe(true);
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

  it('from a building the shot at Infantry chooses +2 To Hit or the Backblast too; from a PTO hut there is no Backblast (SK4 8.2.1)', () => {
    expect(baz([], { yK5: { terrain: 'building-stone', buildingId: 'b1' } }).filter((o) => o.type === 'ITT').map((o) => o.backblast)).toEqual([false, true]);
    const hut = baz([t34()], { yK5: { terrain: 'hut', buildingId: 'h1' } });
    expect(hut.map((o) => [o.type, o.backblast])).toEqual([['ITT', undefined], ['VTT', undefined]]);
  });

  it('a PIAT has no Backblast: from a building it simply fires, at Infantry or at a vehicle (SK4 4.4.3)', () => {
    const { engine, state } = makeEngine({
      pieces: [{ id: 'u', def: 'br.L80', side: 'br', hex: 'yK5' }, { id: 'p', def: 'br.PIAT', side: 'br', heldBy: 'u' }, { ...t34(), side: 'ge', def: 'ge.pzivf2' }],
      scenario: { ...GE_VS_BR, firstSide: 'br' },
      extra,
      terrain: { yK5: { terrain: 'building-stone', buildingId: 'b1' } },
      startPhase: 'PFPh',
    });
    const opts = shotOptions(engine.env(state), 'p', 'prep');
    expect(opts.map((o) => [o.type, o.backblast])).toEqual([['ITT', undefined], ['VTT', undefined]]);
    expect(opts.every((o) => !/Backblast/.test(o.label))).toBe(true);
  });
});

describe('Machine Gun fire options vs AFV (SK4 4.1)', () => {
  const mg = (pieces: PieceSpec[]) => {
    const { engine, state } = makeEngine({
      pieces: [{ id: 'u', def: 'ge.467', side: 'ge', hex: 'yK5' }, { id: 'm', def: 'ge.LMG', side: 'ge', heldBy: 'u' }, ...pieces],
      scenario: { ...RU_VS_GE, firstSide: 'ge' },
      extra,
      startPhase: 'PFPh',
    });
    return shotOptions(engine.env(state), 'm', 'prep');
  };

  it('a MG is offered as ordnance only on the Vehicle Target Type, AP, saying its limits', () => {
    const opts = mg([t34()]);
    expect(opts.map((o) => [o.type, o.ammo])).toEqual([['VTT', undefined]]);
    expect(opts[0]).toMatchObject({ available: true, hint: expect.stringMatching(/normal range \(8 hexes\) and without halved FP .*no Critical Hit/) });
    expect(mg([{ id: 'sq', def: 'ru.458', side: 'ru', hex: 'yM5' }])[0]?.hint).toMatch(/No enemy vehicle/);
  });
});

describe('a leader directing ordnance SW from the wheel (SK4 4.5, 4.4; ASLRB A7.531)', () => {
  const AM_VS_GE = {
    firstSide: 'am',
    sides: [
      { side: 'am', name: 'American', nationality: 'am', elr: 5 },
      { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
    ],
  } as never;

  it('a Light Mortar lists each shot again directed by the leader in its hex', () => {
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'hs', def: 'am.336', side: 'am', hex: 'yK5' },
        { id: 'm', def: 'am.MTR', side: 'am', heldBy: 'hs' },
        { id: 'l', def: 'am.L91', side: 'am', hex: 'yK5' },
        { id: 'far', def: 'am.L80', side: 'am', hex: 'yK2' },
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK9' },
      ],
      scenario: AM_VS_GE,
      extra,
      startPhase: 'PFPh',
    });
    const env = engine.env(state);
    const opts = directedShotOptions(env, 'm', shotOptions(env, 'm', 'prep'));
    const he = opts.filter((o) => o.type === 'ATT' && o.ammo === undefined);
    expect(he.map((o) => o.director ?? null)).toEqual([null, 'l']);
    expect(he[1]).toMatchObject({ available: true, label: expect.stringMatching(/directed by 9-1/) });
    // A leader in another hex is never listed.
    expect(opts.some((o) => o.director === 'far')).toBe(false);
  });

  it('a PIAT does too; a broken leader is listed greyed, saying why', () => {
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'u', def: 'br.458', side: 'br', hex: 'yK5' },
        { id: 'p', def: 'br.PIAT', side: 'br', heldBy: 'u' },
        { id: 'l', def: 'br.L81', side: 'br', hex: 'yK5' },
        { id: 'b', def: 'br.L80', side: 'br', hex: 'yK5', tags: { broken: true } },
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'yM5' },
      ],
      scenario: { ...GE_VS_BR, firstSide: 'br' },
      extra,
      startPhase: 'PFPh',
    });
    const env = engine.env(state);
    const itt = directedShotOptions(env, 'p', shotOptions(env, 'p', 'prep')).filter((o) => o.type === 'ITT');
    expect(itt.find((o) => o.director === 'l')).toMatchObject({ available: true, label: expect.stringMatching(/directed by 8-1/) });
    expect(itt.find((o) => o.director === 'b')).toMatchObject({ available: false, hint: expect.stringMatching(/Good Order/) });
  });

  it("a Gun gets no directed entries (a leader never modifies a Gun's To Hit DR)", () => {
    const { engine, state } = makeEngine({
      pieces: [t34(), { id: 'l', def: 'ru.L81', side: 'ru', hex: 'yM8' }, { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM5' }],
      scenario: { ...RU_VS_GE, firstSide: 'ru' },
      extra,
      startPhase: 'PFPh',
    });
    const env = engine.env(state);
    const base = shotOptions(env, 't34', 'prep');
    expect(directedShotOptions(env, 't34', base)).toEqual(base);
  });
});
