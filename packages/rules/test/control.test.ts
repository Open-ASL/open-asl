import { describe, expect, it } from 'vitest';
import { achieved, controlChits, controlMatters, controlledHexes, statics, type VictoryCondition } from '../src';
import { RU_VS_GE, act as submit, makeEngine } from './fixtures';

describe('Control (SK1 2.0)', () => {
  it('is taken the moment a Good Order MMC is alone in a hex: at setup, and mid-MPh as it moves', () => {
    const { engine, state } = makeEngine({
      board: 'z',
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      terrain: { zK5: { terrain: 'building-stone', buildingId: 'K5' }, zK6: { terrain: 'building-stone', buildingId: 'K5' } },
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zI4' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'zH2', tags: { broken: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5' },
      ],
    });
    // Straight after setup, before any action.
    let ctl = controlledHexes(engine.env(state));
    expect(ctl['zI4']).toBe('ru');
    expect(ctl['zK5']).toBe('ge');
    expect(ctl['zK6']).toBe('ge'); // the rest of the building
    expect(ctl['zH2']).toBeUndefined(); // broken units take nothing

    // The squad steps into J4 during the MPh: J4 is Russian at once, and I4 stays Russian behind it.
    let s = submit(engine, state, { type: 'move.start', units: ['r1'] }).state;
    s = submit(engine, s, { type: 'move.step', to: 'zJ4' }).state;
    ctl = controlledHexes(engine.env(s));
    expect(s.phase).toBe('MPh');
    expect(ctl['zJ4']).toBe('ru');
    expect(ctl['zI4']).toBe('ru');
    expect(ctl['zK5']).toBe('ge');
  });
});

describe('Control through Close Combat', () => {
  const setup = (dice: number[]) =>
    makeEngine({
      startPhase: 'APh',
      dice,
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
    });
  const driveCc = (engine: ReturnType<typeof setup>['engine'], s0: ReturnType<typeof setup>['state']) => {
    let s = submit(engine, s0, { type: 'advance', units: ['a1'], to: 'yO5' }).state;
    s = submit(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('CCPh');
    // Both sides attack whenever they can (the first legal declaration is "no attack").
    for (let guard = 0; guard < 20 && s.phase === 'CCPh'; guard++) {
      const d = engine.currentDecision(s)!;
      const legal = engine.legalActions(s, d.owner);
      s = engine.submit(s, legal.find((a) => ((a as { attacks?: unknown[] }).attacks?.length ?? 0) > 0) ?? legal[0]!).state;
    }
    return s;
  };

  it('advancing into an enemy hex does not take it; a Melee that goes on leaves control where it was', () => {
    // Both CC DRs of 12 miss.
    const { engine, state } = setup([6, 6, 6, 6]);
    expect(controlledHexes(engine.env(state))['yO5']).toBe('ge');
    const s = driveCc(engine, state);
    expect(s.hexMarkers['yO5']?.['melee']).toBe(true);
    expect(controlledHexes(engine.env(s))['yO5']).toBe('ge');
  });

  it('a CC result that leaves one side alone and Good Order hands the hex over at once', () => {
    // No ambush here. The American CC DR of 2 kills (and its snake eyes roll a Leader Creation dr of 6);
    // the German DR of 12 misses.
    const { engine, state } = setup([1, 1, 6, 6, 6, 6]);
    const s = driveCc(engine, state);
    expect(s.pieces['g1']!.loc.kind).toBe('eliminated');
    expect(s.pieces['a1']!.loc).toEqual({ kind: 'hex', hex: 'yO5' });
    expect(s.hexMarkers['yO5']?.['melee']).toBeUndefined();
    expect(controlledHexes(engine.env(s))['yO5']).toBe('am');
  });
});

describe('Control through a continuing Melee', () => {
  it('a Melee kill in a later CCPh hands the hex over once the Melee counter comes off', () => {
    // Turn 1 American CCPh: both DRs of 12 miss, so the hex goes to Melee. German turn 1 CCPh:
    // the German (attacker, declaring first) DR of 12 misses, the American DR of 2 kills.
    const { engine, state } = makeEngine({
      startPhase: 'APh',
      dice: [6, 6, 6, 6, 6, 6, 1, 1, 6, 6],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
    });
    const attack = (s0: typeof state) => {
      let s = s0;
      for (let guard = 0; guard < 20 && s.phase === 'CCPh'; guard++) {
        const d = engine.currentDecision(s)!;
        const legal = engine.legalActions(s, d.owner);
        s = engine.submit(s, legal.find((a) => ((a as { attacks?: unknown[] }).attacks?.length ?? 0) > 0) ?? legal[0]!).state;
      }
      return s;
    };
    let s = submit(engine, state, { type: 'advance', units: ['a1'], to: 'yO5' }).state;
    s = submit(engine, s, { type: 'endPhase' }).state;
    s = attack(s);
    expect(s.hexMarkers['yO5']?.['melee']).toBe(true);
    expect(controlledHexes(engine.env(s))['yO5']).toBe('ge');
    // Through the German player turn to its CCPh.
    for (let guard = 0; guard < 12 && !(s.phase === 'CCPh' && s.attacker === 'ge'); guard++) {
      const d = engine.currentDecision(s)!;
      const legal = engine.legalActions(s, d.owner);
      s = engine.submit(s, legal.find((a) => a.type === 'endPhase') ?? legal[0]!).state;
    }
    expect(s.phase).toBe('CCPh');
    s = attack(s);
    expect(s.pieces['g1']!.loc.kind).toBe('eliminated');
    expect(s.hexMarkers['yO5']?.['melee']).toBeUndefined();
    expect(controlledHexes(engine.env(s))['yO5']).toBe('am');
  });
});

describe('controlMatters', () => {
  const base = { id: 't', name: 't', turns: 1, firstSide: 'am', sides: [], forces: [], boards: [] } as unknown as Parameters<typeof controlMatters>[0];
  it('is true only when a victory condition (at any depth) turns on Control', () => {
    expect(controlMatters({ ...base, victory: [{ kind: 'eliminateCvp', side: 'am', cvp: 9 }] })).toBe(false);
    expect(controlMatters({ ...base, victory: [{ kind: 'exitForce', side: 'am', hsEquivalents: 6, smc: 1 }] })).toBe(false);
    expect(controlMatters({ ...base, victory: [{ kind: 'controlHexes', side: 'am', hexes: ['yP5'], atLeast: 1 }] })).toBe(true);
    expect(
      controlMatters({
        ...base,
        victory: [{ kind: 'all', side: 'am', of: [{ kind: 'cvpBelow', side: 'ge', cvp: 9 }, { kind: 'controlBuildings', side: 'am', buildings: ['b1'], atLeast: 1 }] }],
      }),
    ).toBe(true);
  });
});

describe('Control victory counts hexes by hex Control (ASLRB A26.13; tester report 2026-11-03)', () => {
  // S3-like: "Control ≥ 2 building hexes", the two hexes being one stone building. Entering K5 takes the
  // building (SK1 2.0, A26.14) but not the hex K6, which only an MMC standing in it can gain (A26.13).
  const terrain = { zK5: { terrain: 'building-stone', buildingId: 'K5' }, zK6: { terrain: 'building-stone', buildingId: 'K5' }, zK7: { terrain: 'building-stone', buildingId: 'K7' } };
  const game = (victory: Parameters<typeof controlMatters>[0]['victory']) =>
    makeEngine({
      board: 'z',
      scenario: { ...RU_VS_GE, victory },
      startPhase: 'MPh',
      terrain,
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zJ4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK7' },
      ],
    });

  it('a hex of a Controlled building is not a Controlled hex until entered', () => {
    const vc: VictoryCondition = { kind: 'controlHexes', side: 'ru', hexes: ['zK5', 'zK6'], atLeast: 2 };
    const { engine, state } = game([vc]);
    let s = submit(engine, state, { type: 'move.start', units: ['r1'] }).state;
    s = submit(engine, s, { type: 'move.step', to: 'zK5' }).state;
    const env = engine.env(s);
    expect(controlledHexes(env)['zK6']).toBe('ru'); // the building as a whole
    expect(achieved(env, vc)).toBe(false); // but only one of the two hexes
    // Chits: K5 (entered) shows Russian; K6 shows nothing; K7, which no condition names, shows nothing though German-held.
    expect(controlChits(env, statics(env).scenario)).toEqual({ zK5: 'ru' });
    s = submit(engine, s, { type: 'move.step', to: 'zK6' }).state;
    expect(achieved(engine.env(s), vc)).toBe(true);
    expect(controlChits(engine.env(s), statics(engine.env(s)).scenario)).toEqual({ zK5: 'ru', zK6: 'ru' });
  });

  it('a controlBuildings condition shows and counts the whole building', () => {
    const vc: VictoryCondition = { kind: 'controlBuildings', side: 'ru', buildings: ['K5'], atLeast: 1 };
    const { engine, state } = game([vc]);
    let s = submit(engine, state, { type: 'move.start', units: ['r1'] }).state;
    s = submit(engine, s, { type: 'move.step', to: 'zK5' }).state;
    expect(achieved(engine.env(s), vc)).toBe(true);
    expect(controlChits(engine.env(s), statics(engine.env(s)).scenario)).toEqual({ zK5: 'ru', zK6: 'ru' });
  });
});
