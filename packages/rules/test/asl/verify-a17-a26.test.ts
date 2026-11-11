import { describe, expect, it } from 'vitest';
import type { CounterDef } from '../../src';
import { sk2CoreModules } from '../../src/sk2';
import { paatcDrm } from '../../src/sk3/paatc';
import { COUNTERS, act, makeEngine, type PieceSpec } from '../fixtures';
import { testFire } from './helpers';

/*
 * Verification of the Chapter A ledger rows in A17 (Wounds), A19 (Unit Substitution), A21 (Captured
 * Equipment), A22 (FT), A24 (Smoke) and A25 (Nationalities) that no earlier test exercised directly.
 */

describe('A17.3 wound EFFECTS', () => {
  it('a wounded leader has his morale lowered by one and his leadership worsened by one', () => {
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'gL', def: 'ge.L91', side: 'ge', hex: 'yN5', tags: { wounds: 1 } },
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yP9' },
      ],
    });
    const env = engine.env(state);
    expect(env.query('unit.morale', { unit: 'gL' }, 0)).toBe(8);
    expect(env.query('unit.leadership', { unit: 'gL' }, -1)).toBe(0);
  });
});

describe('A19.2 GREEN & CONSCRIPT TROOPS, A19.3 INEXPERIENCED PERSONNEL RESTRICTIONS', () => {
  const inexperienced = (squad: string, leaderTags?: NonNullable<PieceSpec['tags']>) => {
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'u', def: squad, side: squad.slice(0, 2), hex: 'yN5' },
        ...(leaderTags ? [{ id: 'l', def: squad.startsWith('ru') ? 'ru.L81' : 'am.L80', side: squad.slice(0, 2), hex: 'yN5', tags: leaderTags }] : []),
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
      scenario: { sides: [{ side: 'am', name: 'American', nationality: 'am', elr: 3 }, { side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 }] },
    });
    return engine.env(state).query('unit.inexperienced', { unit: 'u' }, false);
  };
  it('a Green MMC is Inexperienced unless stacked with an unbroken leader (pinned will do); a Conscript always is', () => {
    expect(inexperienced('am.536')).toBe(true);
    expect(inexperienced('am.536', {})).toBe(false);
    expect(inexperienced('am.536', { pinned: true })).toBe(false);
    expect(inexperienced('am.536', { broken: true })).toBe(true);
    expect(inexperienced('ru.426', {})).toBe(true);
    expect(inexperienced('am.747')).toBe(false);
  });
});

describe('A21.11 MALFUNCTION, A21.12 PERFORMANCE (captured SW)', () => {
  it('a captured MG has its B# lowered by two and its multiple ROF by one', () => {
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'mg', def: 'ge.MMG', side: 'am', heldBy: 'a1' },
        { id: 'own', def: 'am.MMG', side: 'am', heldBy: 'a1' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    const env = engine.env(state);
    expect(env.query('sw.breakdown', { sw: 'mg', user: 'a1' }, null)).toBe(10);
    expect(env.query('sw.rof', { sw: 'mg' }, 0)).toBe(1);
    expect(env.query('sw.breakdown', { sw: 'own', user: 'a1' }, null)).toBe(12);
    expect(env.query('sw.rof', { sw: 'own' }, 0)).toBe(2);
  });
});

describe('A22 FLAMETHROWERS', () => {
  const ftGame = (holder: string, target: string, dice: number[], terrain: Record<string, { terrain: string }> = {}, holderTags: NonNullable<PieceSpec['tags']> = {}) =>
    makeEngine({
      extra: [testFire],
      scenario: { firstSide: 'ge' },
      terrain,
      dice,
      pieces: [
        { id: 'g1', def: holder, side: 'ge', hex: 'yN5', tags: holderTags },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yN5' },
        { id: 'ft', def: 'ge.FT', side: 'ge', heldBy: 'g1' },
        { id: 'aL', def: 'ge.L91', side: 'ge', hex: 'yN5' },
        { id: 'a1', def: 'am.747', side: 'am', hex: target },
      ],
    });
  const fire = (decl: Record<string, unknown>) => ({ type: 'test.fire', mode: 'prep', decl: { units: [], sw: ['ft'], target: 'yN6', ...decl } });

  it('A22.1, A22.2: 24 FP never doubled for PBF, halved at two hexes; no TEM and no leadership DRM', () => {
    const { engine, state } = ftGame('ge.228c', 'yN6', [5, 3], { yN6: { terrain: 'building-stone' } });
    expect(() => act(engine, state, fire({ directors: ['aL'] }))).toThrow(/Leadership never modifies FT/);
    const t = act(engine, state, fire({}));
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number; drm: number };
    expect(attack).toMatchObject({ fp: 24, drm: 0 });
    const far = ftGame('ge.228c', 'yN7', [5, 3]);
    const t2 = act(far.engine, far.state, fire({ target: 'yN7' }));
    expect((t2.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { fp: number }).fp).toBe(12);
  });

  it('A22.31, A22.33: a FT combines with nothing, not even its possessor; a pinned unit cannot use it', () => {
    const { engine, state } = ftGame('ge.467', 'yN6', []);
    expect(() => act(engine, state, fire({ units: ['g2'] }))).toThrow(/may not combine/);
    const pinned = ftGame('ge.467', 'yN6', [], {}, { pinned: true });
    expect(() => act(pinned.engine, pinned.state, fire({}))).toThrow(/pinned/);
  });

  it('A22.3, A22.5: removed on an original DR ≥ its X# 10, ≥ 8 for a non-elite user', () => {
    const elite = ftGame('ge.228c', 'yN6', [5, 3]);
    expect(act(elite.engine, elite.state, fire({})).state.pieces['ft']!.loc.kind).toBe('held');
    const eliteOut = ftGame('ge.228c', 'yN6', [6, 4]);
    expect(act(eliteOut.engine, eliteOut.state, fire({})).state.pieces['ft']!.loc.kind).toBe('eliminated');
    const line = ftGame('ge.467', 'yN6', [5, 3]);
    expect(act(line.engine, line.state, fire({})).state.pieces['ft']!.loc.kind).toBe('eliminated');
  });
});

describe('A24.7 MOVEMENT, A24.8 OUTGOING LOS HINDRANCES', () => {
  it('entering a SMOKE hex costs one more MF; fire traced out of it is hindered one more than fire into it', () => {
    const { engine, state } = makeEngine({
      startPhase: 'MPh',
      hexMarkers: { yN6: { smoke: true } },
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    const env = engine.env(state);
    expect(env.query('move.cost', { unit: 'a1', from: 'yN5', to: 'yN6', viaRoad: false }, 0)).toBe(2);
    const into = env.query('los.trace', { from: 'yN4', to: 'yN6' }, null as never) as { hindrance: number };
    const out = env.query('los.trace', { from: 'yN6', to: 'yN4' }, null as never) as { hindrance: number };
    expect(into.hindrance).toBe(2);
    expect(out.hindrance).toBe(3);
  });
});

describe('A25.32 American ORDNANCE', () => {
  it('uses the red To Hit numbers before 1944 and the black from 1944', () => {
    const redTh = (date: string) => {
      const { engine, state } = makeEngine({ extra: sk2CoreModules, scenario: { date }, pieces: [] });
      const sc = { shot: { targetType: 'ITT' }, def: { nationality: 'am' }, captured: false, nonQualified: false };
      return engine.env(state).query('ordnance.redTh', sc as never, false);
    };
    expect(redTh('June 1943')).toBe(true);
    expect(redTh('June 1944')).toBe(false);
  });
});

describe('A25.6 ITALIAN ordnance', () => {
  it('uses the red To Hit numbers', () => {
    const { engine, state } = makeEngine({ extra: sk2CoreModules, scenario: { date: 'June 1944' }, pieces: [] });
    const sc = { shot: { targetType: 'ITT' }, def: { nationality: 'it' }, captured: false, nonQualified: false };
    expect(engine.env(state).query('ordnance.redTh', sc as never, false)).toBe(true);
  });
});

describe('A25.65, A25.91 PAATC of non-elite Italian and Allied Minor troops', () => {
  it('take +1 on the PAATC (a 1PAATC); elite and other nationalities do not', () => {
    // Test-only Italian and Allied Minor squads (the real ones come from the content package).
    const extra: Record<string, CounterDef> = {
      'it.346': { id: 'it.346', nationality: 'it', kind: 'squad', quality: '2', fp: 3, range: 4, morale: 6, brokenMorale: 6, selfRally: false, assaultFire: false, elrExempt: false },
      'it.447': { id: 'it.447', nationality: 'it', kind: 'squad', quality: 'E', fp: 4, range: 4, morale: 7, brokenMorale: 7, selfRally: false, assaultFire: false, elrExempt: false },
      'al.457': { id: 'al.457', nationality: 'al', kind: 'squad', quality: '1', fp: 4, range: 5, morale: 7, brokenMorale: 7, selfRally: false, assaultFire: false, elrExempt: false },
    };
    Object.assign(COUNTERS, extra);
    const { engine, state } = makeEngine({
      scenario: { sides: [{ side: 'am', name: 'Allies', nationality: 'am', nationalities: ['am', 'it', 'al'], elr: 3 }, { side: 'ge', name: 'German', nationality: 'ge', elr: 3 }] },
      pieces: [
        { id: 'i2', def: 'it.346', side: 'am', hex: 'yN5' },
        { id: 'iE', def: 'it.447', side: 'am', hex: 'yN6' },
        { id: 'al', def: 'al.457', side: 'am', hex: 'yN7' },
        { id: 'us', def: 'am.747', side: 'am', hex: 'yN8' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    const env = engine.env(state) as never;
    expect(paatcDrm(env, 'i2').drm).toBe(1);
    expect(paatcDrm(env, 'al').drm).toBe(1);
    expect(paatcDrm(env, 'iE').drm).toBe(0);
    expect(paatcDrm(env, 'us').drm).toBe(0);
  });
});
