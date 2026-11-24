import { describe, expect, it } from 'vitest';
import type { GameState } from '@asl/engine';
import { aslCoreModules, piecesModule, turnModule } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { sk4CoreModules } from '../../src/sk4';
import { act, makeEngine } from '../fixtures';

/*
 * The MMC a Field Promotion in CC is based on. SK1/SK4 5.3: "If more than one type of MMC made the CC
 * attack, use the best one to base the dr on" (the SK rules read "best" as the best Morale). ASLRB A18.2: "the MMC
 * with the highest BPV involved is used to determine any Leader Creation drm" (asl/leaderCreation.ts).
 */
describe('A18.2 Leader Creation: the base MMC of a CC attack', () => {
  // An American 6-6-6 (Morale 6, BPV 11) and 4-4-7 (Morale 7, BPV 7) attack a German 4-6-7 together and roll an
  // original 2; the German attack misses (6,6). The stub table names the leader after the Morale it was given.
  const run = (extra: typeof aslCoreModules) => {
    const { engine, state } = makeEngine({
      startPhase: 'APh',
      extra,
      dice: [1, 1, 6, 6, 6, 6, 6, 6],
      tables: { leaderCreation: (nat, morale) => `${nat}.L${morale >= 7 ? 91 : 80}` },
      pieces: [
        { id: 'a1', def: 'am.666', side: 'am', hex: 'yO5' },
        { id: 'a2', def: 'am.447', side: 'am', hex: 'yO5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
    });
    let s: GameState = act(engine, state, { type: 'endPhase' }).state;
    s = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['a1', 'a2'], targets: ['g1'] }] }).state;
    const t = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['g1'], targets: ['a1'] }] });
    return t.events.find((e) => e.type === 'sk1.leaderCreation')!.payload as { unit: string; defId: string | null };
  };

  it('SK: the best Morale (the 4-4-7)', () => {
    expect(run([])).toMatchObject({ unit: 'a2', defId: 'am.L91' });
  });

  it('full ASL: the highest BPV (the 6-6-6), with its own Morale for the drm', () => {
    expect(run(aslCoreModules)).toMatchObject({ unit: 'a1', defId: 'am.L80' });
  });
});

describe('A18.2: the Leader Creation Table is NA to Finns or Japanese', () => {
  const env = (asl: boolean) => {
    const { engine, state } = makeEngine({
      scenario: { firstSide: 'ja', sides: [{ side: 'ja', name: 'Japanese', nationality: 'ja', elr: 3 }, { side: 'am', name: 'American', nationality: 'am', elr: 3 }] },
      // No real ruleset mixes SK4 and full ASL: the U.S.M.C. and the full ASL Deployment (and its setup rule) are left to SK4 here.
      modules: [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules, ...sk4CoreModules, ...(asl ? aslCoreModules.filter((m) => !sk4CoreModules.includes(m) && m.id !== 'asl.deploy') : [])],
      startPhase: 'RPh',
      pieces: [
        { id: 'j1', def: 'ja.447', side: 'ja', hex: 'yO5', tags: { broken: true } },
        { id: 'j2', def: 'ja.448', side: 'ja', hex: 'yO5' },
        { id: 'a1', def: 'am.666', side: 'am', hex: 'yO7' },
      ],
    });
    return engine.env(state);
  };
  it('full ASL keeps the Starter Kit refusal: no Field Promotion of a Japanese MMC, by rally or in CC', () => {
    for (const asl of [false, true]) {
      const e = env(asl);
      expect(e.query('rally.promotes', { unit: 'j1' }, true)).toBe(false);
      expect(e.query('cc.promotionBase', { units: ['j1', 'j2'] }, 'j1')).toBeNull();
    }
  });
});

describe('A18.12: a created leader adds his leadership to the CC DR that created him, even a +1 (full ASL)', () => {
  // Two German 4-6-7s attack the Russian 4-2-6 (DR 3); the Russian attacks g1 at 1:1 and rolls 1,1. The stub table
  // makes a 6+1: in full ASL his +1 is added to that Original 2 (Final 3); the Starter Kit applies only a negative one.
  const run = (extra: typeof aslCoreModules) => {
    const { engine, state } = makeEngine({
      scenario: {
        firstSide: 'ge',
        sides: [
          { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
          { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
        ],
      },
      startPhase: 'APh',
      extra,
      dice: [1, 2, 1, 1, 3, 6, 6, 6, 6],
      tables: { leaderCreation: (nat, _morale, dr) => (dr <= 3 ? `${nat}.L61` : null) },
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yO5' },
        { id: 'r1', def: 'ru.426', side: 'ru', hex: 'yO5' },
      ],
    });
    let s: GameState = act(engine, state, { type: 'endPhase' }).state;
    s = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['g1', 'g2'], targets: ['r1'] }] }).state;
    const t = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['r1'], targets: ['g1'] }] });
    return t.events.filter((e) => e.type === 'sk1.cc.attack').map((e) => e.payload as { side: string; drm: number; dr: number });
  };
  it('full ASL: +1 on the Russian attack; the Starter Kit: 0', () => {
    expect(run(aslCoreModules).find((a) => a.side === 'ru')).toMatchObject({ dr: 2, drm: 1 });
    expect(run([]).find((a) => a.side === 'ru')).toMatchObject({ dr: 2, drm: 0 });
  });
});
