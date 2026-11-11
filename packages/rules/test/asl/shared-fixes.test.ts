import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { aslCoreModules, moveState } from '../../src';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { attackCcv } from '../../src/sk3/vehicleCc';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from '../fixtures';
import { testFire } from './helpers';

/*
 * Fixes shared by both rulesets (the SK text agrees with the ASLRB or is silent), and the full ASL
 * Random Selection ties (asl/randomSelection.ts) where the SK text picks exactly one. The coverage ledger
 * (packages/rules/docs/asl-chapter-a.md) cites these tests.
 */

const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const makesLeaders = { leaderCreation: (nat: string, _m: number, dr: number) => (dr <= 3 ? `${nat}.L80` : null) };

describe('Field Promotion on a self-rally: SK1/SK4 5.3 literally, ASLRB A18.11 in full ASL', () => {
  const pieces = (leaderBroken: boolean): PieceSpec[] => [
    { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5', tags: leaderBroken ? { broken: true } : {} },
    { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true } },
    { id: 'a2', def: 'am.747', side: 'am', hex: 'yN7', tags: { broken: true } },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
  ];
  const promotions = (r: { events: { type: string; payload: unknown }[] }) => ev(r, 'sk1.leaderCreation').length;

  it('SK and ASL: a second self-rally of the RPh rolling an original 2 rallies the unit but makes no leader', () => {
    for (const extra of [[], aslCoreModules]) {
      const { engine, state } = makeEngine({
        startPhase: 'RPh',
        extra,
        pieces: [
          { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true } },
          { id: 'a2', def: 'am.747', side: 'am', hex: 'yN7', tags: { broken: true } },
          { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
        ],
        // a1: 4+4 (+1 self-rally) fails; a2: 1+1 rallies, a dr of 1 would make a leader.
        dice: [4, 4, 1, 1, 1],
        tables: makesLeaders,
      });
      const s = act(engine, state, { type: 'rally.selfRally', unit: 'a1' }).state;
      const r = act(engine, s, { type: 'rally.selfRally', unit: 'a2' });
      expect(r.state.pieces['a2']!.tags['broken']).toBeUndefined();
      expect(promotions(r)).toBe(0);
    }
  });

  it('SK: a leader rallying a MMC is no self-rally and leaves the first one to come; ASL: it is the first MMC Rally attempt', () => {
    // The leader rallies a1 (5+5 fails), then a2 self-rallies on an original 2.
    const run = (extra: typeof aslCoreModules) => {
      const { engine, state } = makeEngine({ startPhase: 'RPh', extra, pieces: pieces(false), dice: [5, 5, 1, 1, 1], tables: makesLeaders });
      const s = act(engine, state, { type: 'rally.rally', leader: 'aL', unit: 'a1' }).state;
      return act(engine, s, { type: 'rally.selfRally', unit: 'a2' });
    };
    expect(promotions(run([]))).toBe(1);
    expect(promotions(run(aslCoreModules))).toBe(0);
  });

  it('SK: a leader\'s own self-rally is the side\'s first self-rally attempt; ASL: it is no MMC Rally attempt', () => {
    // The broken leader self-rallies first (5+5 fails), then a2 self-rallies on an original 2.
    const run = (extra: typeof aslCoreModules) => {
      const { engine, state } = makeEngine({ startPhase: 'RPh', extra, pieces: pieces(true), dice: [5, 5, 1, 1, 1], tables: makesLeaders });
      const s = act(engine, state, { type: 'rally.selfRally', unit: 'aL' }).state;
      return act(engine, s, { type: 'rally.selfRally', unit: 'a2' });
    };
    expect(promotions(run([]))).toBe(0);
    expect(promotions(run(aslCoreModules))).toBe(1);
  });

  it('SK: the DEFENDER\'s first self-rally may promote too; ASL: only the ATTACKER\'s (A18.11)', () => {
    const run = (extra: typeof aslCoreModules) => {
      const { engine, state } = makeEngine({
        scenario: { ...RU_VS_GE, firstSide: 'ge' },
        startPhase: 'RPh',
        extra,
        pieces: [
          { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
          { id: 'r1', def: 'ru.527', side: 'ru', hex: 'yN5', tags: { broken: true } },
        ],
        // Rally 1+1; the Leader Creation dr (6) is rolled, and makes no leader.
        dice: [1, 1, 6],
        tables: makesLeaders,
      });
      const s = act(engine, state, { type: 'endPhase' }).state;
      expect(engine.currentDecision(s)!.owner).toBe('ru');
      const r = act(engine, s, { type: 'rally.selfRally', unit: 'r1' });
      expect(r.state.pieces['r1']!.tags['broken']).toBeUndefined();
      return r;
    };
    expect(promotions(run([]))).toBe(1);
    expect(promotions(run(aslCoreModules))).toBe(0);
  });

  it('ASL: a MMC without self-rally capability self-rallies only as the first MMC Rally attempt; SK sets no such order', () => {
    // a1 is rallied by the leader first (5+5 fails); a2 is a 6-6-6 (no self-rally box) alone in N7.
    const run = (extra: typeof aslCoreModules) => {
      const { engine, state } = makeEngine({
        startPhase: 'RPh',
        extra,
        pieces: [...pieces(false).filter((p) => p.id !== 'a2'), { id: 'a2', def: 'am.666', side: 'am', hex: 'yN7', tags: { broken: true } }],
        dice: [5, 5, 3, 3],
      });
      const s = act(engine, state, { type: 'rally.rally', leader: 'aL', unit: 'a1' }).state;
      return { engine, s };
    };
    const sk = run([]);
    expect(() => act(sk.engine, sk.s, { type: 'rally.selfRally', unit: 'a2' })).not.toThrow();
    const asl = run(aslCoreModules);
    expect(() => act(asl.engine, asl.s, { type: 'rally.selfRally', unit: 'a2' })).toThrow(/first MMC Rally attempt/);
  });
});

describe('A17.2 wounded SMC movement', () => {
  it('a wounded leader still gives MMC moving with him the 2 MF bonus', () => {
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5', tags: { wounds: 1 } },
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    const env = engine.env(state);
    expect(env.query('unit.mf', { unit: 'a1', stack: ['a1', 'aL'], doubleTime: false }, 0)).toBe(6);
    expect(env.query('unit.mf', { unit: 'aL', stack: ['a1', 'aL'], doubleTime: false }, 0)).toBe(3);
  });

  it('a SMC wounded after spending more than 3 MF is pinned; one wounded at exactly 3 is not', () => {
    const setup = () =>
      makeEngine({
        board: 'z',
        scenario: { ...RU_VS_GE, firstSide: 'ge' },
        startPhase: 'MPh',
        // As movement.test.ts "a SMC wounded on the way": DR 1+3 → K/1; wound severity 2 → wounded.
        dice: [1, 3, 2],
        pieces: [
          { id: 'gL', def: 'ge.L81', side: 'ge', hex: 'zQ1' },
          { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zQ8' },
        ],
      });
    const walk = (engine: Engine, st: GameState, hexes: string[]) => {
      for (const to of hexes) {
        st = act(engine, st, { type: 'move.step', to }).state;
        if (engine.currentDecision(st)?.kind === 'firstFire') st = act(engine, st, { type: 'defPass' }).state;
      }
      return st;
    };
    const woundAfter = (hexes: string[], last: string) => {
      const { engine, state } = setup();
      let s = act(engine, state, { type: 'move.start', units: ['gL'] }).state;
      s = walk(engine, s, hexes);
      s = act(engine, s, { type: 'move.step', to: last }).state;
      s = act(engine, s, { type: 'defFire', decl: { units: ['r1'], sw: [], target: last } }).state;
      expect(s.pieces['gL']!.tags['wounds']).toBe(1);
      expect(moveState({ state: s } as never)).toBeUndefined();
      return s.pieces['gL']!;
    };
    expect(woundAfter(['zQ2', 'zQ3', 'zQ4'], 'zQ5').tags['pinned']).toBe(true);
    expect(woundAfter(['zQ2', 'zQ3'], 'zQ4').tags['pinned']).toBeUndefined();
  });
});

describe('A18.2 Leader Creation in CC vs an AFV', () => {
  it('an original 2 in CC vs an AFV rolls Leader Creation with the -1 "CC vs AFV" drm', () => {
    let below: number | undefined;
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'a', def: 'ru.447', side: 'ru', hex: 'yM5', tags: { advancedInto: 'yM5' } },
        { id: 'pziv', def: 'ge.pzivf2', side: 'ge', hex: 'yM5', tags: { vca: 3, ca: 3 } },
      ],
      scenario: RU_VS_GE,
      extra: [...sk2CoreModules, ...sk3CoreModules],
      startPhase: 'CCPh',
      dice: [1, 1, 4, 6, 6, 6, 6],
      tables: {
        leaderCreation: (_n, _m, _dr, _b, cols) => {
          below = cols;
          return null;
        },
      },
    });
    let s = state;
    if (engine.currentDecision(s)?.kind === 'ccHex') s = act(engine, s, { type: 'cc.chooseHex', hex: 'yM5' }).state;
    const r = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['a'], targets: ['pziv'] }] });
    expect(ev(r, 'sk1.leaderCreation')).toHaveLength(1);
    expect(below).toBe(1);
  });
});

describe('A19.34 Inexperienced CCV', () => {
  it('a Conscript squad attacks a vehicle with CCV 4, not 5 (SK4 5.4)', () => {
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'c', def: 'ru.426', side: 'ru', hex: 'yM5' },
        { id: 'a', def: 'ru.447', side: 'ru', hex: 'yM5' },
        { id: 'pziv', def: 'ge.pzivf2', side: 'ge', hex: 'yM5', tags: { vca: 3, ca: 3 } },
      ],
      scenario: RU_VS_GE,
      extra: [...sk2CoreModules, ...sk3CoreModules],
    });
    const env = engine.env(state);
    expect(attackCcv(env, ['c']).ccv).toBe(4);
    expect(attackCcv(env, ['a']).ccv).toBe(5);
  });
});

describe('A10.31 Casualty MC: ELR replacement before Casualty Reduction', () => {
  it('an 8-1 failing by more than the ELR on an original 12 is replaced by an 8-0 first, and it is the 8-0 a fatal wound kills', () => {
    // 8 FP point blank, DR 3+5 → NMC; the lone 8-1 rolls 6+6 (fails by 4 > ELR 3), wound severity 5.
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      extra: [testFire],
      pieces: [
        { id: 'r1', def: 'ru.458', side: 'ru', hex: 'yN5' },
        { id: 'gL', def: 'ge.L81', side: 'ge', hex: 'yN6' },
      ],
      dice: [3, 5, 6, 6, 5],
    });
    const r = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['r1'], sw: [], target: 'yN6' } });
    expect(ev(r, 'sk1.elr')[0]).toMatchObject({ unit: 'gL', from: 'ge.L81', to: 'ge.L80' });
    expect(r.state.pieces['gL']).toMatchObject({ defId: 'ge.L80', loc: { kind: 'eliminated' } });
  });

  it('a squad is replaced, then Reduced: the ELR event names the squad, not its HS', () => {
    // fire.test.ts "inexperienced cowering ... ELR-replaces" has the full event order; this is its essence.
    const { engine, state } = makeEngine({
      extra: [testFire],
      pieces: [
        { id: 'a4', def: 'am.536', side: 'am', hex: 'yN4' },
        { id: 'g4', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
      dice: [2, 2, 6, 6],
    });
    const r = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a4'], sw: [], target: 'yO5' } });
    expect(ev(r, 'sk1.elr')[0]).toMatchObject({ from: 'ge.467', to: 'ge.447' });
    expect(r.state.pieces['g4']!.defId).toBe('ge.237');
    expect(ev(r, 'sk1.check')[0]).toMatchObject({ unit: 'g4', outcome: 'reduced' });
  });
});

describe('SW repair: one attempt per unit by SK1/SK4 3.1, as many SW as it could fire by ASLRB A9.72 in full ASL', () => {
  const setup = (holder: string, dice: number[], extra: typeof aslCoreModules = []) =>
    makeEngine({
      startPhase: 'RPh',
      extra,
      pieces: [
        { id: 'a1', def: holder, side: 'am', hex: 'yN5' },
        { id: 'mg1', def: 'am.MMG', side: 'am', heldBy: 'a1', tags: { malf: true } },
        { id: 'mg2', def: 'am.MMG', side: 'am', heldBy: 'a1', tags: { malf: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      dice,
    });

  it('SK: a squad tries to repair one SW, its one action of the RPh', () => {
    const { engine, state } = setup('am.747', [3]);
    const s = act(engine, state, { type: 'rally.repair', unit: 'a1', sw: 'mg1' }).state;
    expect(() => act(engine, s, { type: 'rally.repair', unit: 'a1', sw: 'mg2' })).toThrow(/already acted/);
  });

  it('ASL: a squad may try to repair two SW in one RPh', () => {
    const { engine, state } = setup('am.747', [1, 3], aslCoreModules);
    let s = act(engine, state, { type: 'rally.repair', unit: 'a1', sw: 'mg1' }).state;
    s = act(engine, s, { type: 'rally.repair', unit: 'a1', sw: 'mg2' }).state;
    expect(s.pieces['mg1']!.tags['malf']).toBeUndefined();
    expect(s.pieces['mg2']!.tags['malf']).toBe(true);
    expect(() => act(engine, s, { type: 'rally.repair', unit: 'a1', sw: 'mg2' })).toThrow(/already acted/);
  });

  it('ASL: a squad may not spend both attempts on one SW', () => {
    const { engine, state } = setup('am.747', [3], aslCoreModules);
    const s = act(engine, state, { type: 'rally.repair', unit: 'a1', sw: 'mg1' }).state;
    expect(() => act(engine, s, { type: 'rally.repair', unit: 'a1', sw: 'mg1' })).toThrow(/already attempted/);
  });

  it('ASL: a half-squad only one, and a unit that repaired may not also Recover a SW (A4.44: its sole action)', () => {
    const { engine, state } = setup('am.347', [3], aslCoreModules);
    const s = act(engine, state, { type: 'rally.repair', unit: 'a1', sw: 'mg1' }).state;
    expect(() => act(engine, s, { type: 'rally.repair', unit: 'a1', sw: 'mg2' })).toThrow(/already acted/);
  });
});

describe('A9.71 Multiple SW malfunction, full ASL: a tie affects every tied MG', () => {
  const setup = (modules: typeof aslCoreModules) =>
    makeEngine({
      extra: [testFire, ...modules],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'mg1', def: 'am.MMG', side: 'am', heldBy: 'a1' },
        { id: 'mg2', def: 'am.MMG', side: 'am', heldBy: 'a1' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      // Original 12 (both B12), Random Selection 4 and 4, then 2 and 5 for the SK re-roll.
      dice: [6, 6, 4, 4, 2, 5],
    });
  const fire = (modules: typeof aslCoreModules) => {
    const { engine, state } = setup(modules);
    return act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: [], sw: ['mg1', 'mg2'], target: 'yP9' } }).state;
  };

  it('SK: one MG malfunctions (SK1 4.1); full ASL: both tied MGs do', () => {
    const sk = fire([]);
    expect([sk.pieces['mg1']!.tags['malf'], sk.pieces['mg2']!.tags['malf']]).toEqual([undefined, true]);
    const asl = fire(aslCoreModules);
    expect([asl.pieces['mg1']!.tags['malf'], asl.pieces['mg2']!.tags['malf']]).toEqual([true, true]);
  });
});

describe('A11.11 CC Partial Kill, full ASL: a tie Reduces every tied unit', () => {
  // The Germans attack at 2:1 and roll 6+6 (no effect); the Russian 4-2-6 attacks both 4-6-7s at 1:2 (kill 4) and
  // rolls 2+2: a Partial Kill. Random Selection 3 and 3: SK re-rolls (1, 5: g2), full ASL Reduces both.
  const cc = (modules: typeof aslCoreModules) => {
    const { engine, state } = makeEngine({
      scenario: { ...RU_VS_GE, firstSide: 'ge' },
      extra: modules,
      startPhase: 'APh',
      dice: [6, 6, 2, 2, 3, 3, 1, 5],
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yO5' },
        { id: 'r1', def: 'ru.426', side: 'ru', hex: 'yO5' },
      ],
    });
    let s = act(engine, state, { type: 'endPhase' }).state;
    s = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['g1', 'g2'], targets: ['r1'] }] }).state;
    return act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['r1'], targets: ['g1', 'g2'] }] }).state;
  };

  it('SK: one unit (SK1 3.8); full ASL: "one (or more)"', () => {
    const sk = cc([]);
    expect([sk.pieces['g1']!.defId, sk.pieces['g2']!.defId]).toEqual(['ge.467', 'ge.247']);
    const asl = cc(aslCoreModules);
    expect([asl.pieces['g1']!.defId, asl.pieces['g2']!.defId]).toEqual(['ge.247', 'ge.247']);
  });
});

describe('A10.31 in the FPF self-check: an original 12 is a Casualty MC (SK1 3.2.1, 3.3.1)', () => {
  it('a 4-6-7 using FPF on an original 12 is replaced by a 4-4-7 (fails by 5, ELR 3), then Reduced to a 2-3-7', () => {
    const { engine, state } = makeEngine({
      board: 'z',
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice: [6, 6],
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zK3' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zK5', tags: { fire: 'final' } },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['r1'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'zK4' }).state;
    const t = act(engine, s, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'zK4' } });
    expect(ev(t, 'sk1.check').filter((c) => c['reason'] === 'FPF')[0]).toMatchObject({ unit: 'g1', outcome: 'reduced' });
    expect(ev(t, 'sk1.elr')[0]).toMatchObject({ unit: 'g1', from: 'ge.467', to: 'ge.447' });
    expect(t.state.pieces['g1']).toMatchObject({ defId: 'ge.237', tags: expect.objectContaining({ broken: true }) });
  });
});

describe('SK4 4.4.4 ATR on the IFT: normal breakdown', () => {
  const fire = (dice: number[], holder = 'ru.447', side = 'ru', atrSide = 'ru') => {
    const { engine, state } = makeEngine({
      scenario: { ...RU_VS_GE, firstSide: side },
      extra: [testFire, ...sk2CoreModules, ...sk3CoreModules],
      startPhase: 'PFPh',
      dice,
      pieces: [
        { id: 'q', def: holder, side, hex: 'yK5' },
        { id: 'a', def: 'ru.ATR', side: atrSide, heldBy: 'q' },
        { id: 'g', def: 'ge.467', side: side === 'ru' ? 'ge' : 'ru', hex: 'yK8' },
      ],
    });
    return act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: [], sw: ['a'], target: 'yK8' } }).state;
  };

  it('an original 12 malfunctions the ATR (its inherent B12), it is not removed', () => {
    const s = fire([6, 6]);
    expect(s.pieces['a']!.tags['malf']).toBe(true);
    expect(s.pieces['a']!.loc.kind).toBe('held');
  });

  it('a captured ATR (B10) malfunctions on a 10 and is removed on a 12, its printed B# made an X# (A.11)', () => {
    expect(fire([5, 5, 6, 6], 'ge.467', 'ge', 'ge').pieces['a']!.tags['malf']).toBe(true);
    expect(fire([6, 6, 6, 6], 'ge.467', 'ge', 'ge').pieces['a']!.loc.kind).toBe('eliminated');
  });
});
