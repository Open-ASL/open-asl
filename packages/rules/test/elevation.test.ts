import { describe, expect, it } from 'vitest';
import type { PieceId } from '@asl/engine';
import { buildAttack, entryHexside, heightAdvantageHex, interdicted, shotContext, sk2CoreModules, type FireDeclaration } from '../src';
import { GE_VS_BR, makeEngine } from './fixtures';

const extra = [...sk2CoreModules];
/** A level-1 hill around yM5 on the fixture grid: M4, M5, M6, N5, N6 are up; everything else is at ground level. */
const HILL = { yM4: { terrain: 'open', elevation: 1 }, yM5: { terrain: 'open', elevation: 1 }, yM6: { terrain: 'open', elevation: 1 }, yN5: { terrain: 'open', elevation: 1 }, yN6: { terrain: 'open', elevation: 1 } };

describe('Hills (SK4 1.1.1, 3.2.1)', () => {
  it('doubles the cost of terrain entered across a Crest Line uphill, not downhill', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain: { ...HILL, yN5: { terrain: 'woods', elevation: 1 } },
      startPhase: 'MPh',
      pieces: [{ id: 'e1', def: 'ge.467', side: 'ge', hex: 'yL5' }],
    });
    const env = engine.env(state);
    const cost = (from: string, to: string) => env.query('move.cost', { unit: 'e1' as PieceId, from, to, viaRoad: false }, 1);
    expect(cost('yL5', 'yM5')).toBe(2);
    expect(cost('yM5', 'yN5')).toBe(2);
    expect(cost('yL5', 'yK5')).toBe(1);
    expect(cost('yM5', 'yL5')).toBe(1);
    expect(cost('yM4', 'yN5')).toBe(2);
    expect(env.explain('move.cost', { unit: 'e1' as PieceId, from: 'yL5', to: 'yM5', viaRoad: false }, 1).trace.some((t) => t.id === 'sk2.move.crest' && !t.suppressedBy)).toBe(true);
  });

  it('a hill between two ground-level units blocks their LOS; two hill units see across the valley over ground-level woods', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain: { ...HILL, yP5: { terrain: 'open', elevation: 1 }, yO5: { terrain: 'woods' } },
      pieces: [{ id: 'e1', def: 'ge.467', side: 'ge', hex: 'yK5' }],
    });
    const env = engine.env(state);
    const los = (from: string, to: string) => env.query('los.trace', { from, to }, { clear: true, hindrance: 0, parts: [] });
    expect(los('yL5', 'yO5').clear).toBe(false);
    expect(los('yL5', 'yO5').blockedBy).toMatch(/Crest Line/);
    // N5 and P5 are both at level 1 with the ground-level woods of O5 between them.
    expect(los('yN5', 'yP5')).toMatchObject({ clear: true, hindrance: 0 });
    // From the plateau's interior (N5, behind M5) down to K5 the LOS crosses a second Crest Line.
    expect(los('yN5', 'yK5').clear).toBe(false);
    // From its edge (M5, whose western neighbours are at ground level) the LOS leaves through the Crest Line.
    expect(los('yM5', 'yK5').clear).toBe(true);
  });

  it('between elevations the LOS sees over grain and brush but is blocked by orchards in season (+1 out of season)', () => {
    const mk = (month: number) =>
      makeEngine({
        scenario: { ...GE_VS_BR, month },
        extra,
        terrain: { ...HILL, yL5: { terrain: 'grain' }, yL4: { terrain: 'brush' }, yL6: { terrain: 'orchard' } },
        pieces: [{ id: 'e1', def: 'ge.467', side: 'ge', hex: 'yK5' }],
      });
    const summer = mk(7);
    const env = summer.engine.env(summer.state);
    const los = (from: string, to: string) => env.query('los.trace', { from, to }, { clear: true, hindrance: 0, parts: [] });
    expect(los('yM5', 'yK5')).toMatchObject({ clear: true, hindrance: 0 });
    expect(los('yM4', 'yK4')).toMatchObject({ clear: true, hindrance: 0 });
    expect(los('yM6', 'yK6').clear).toBe(false);
    expect(los('yM6', 'yK6').blockedBy).toMatch(/Orchard/);
    // The same grain hex still hinders two ground-level units.
    expect(los('yK5', 'yN5').hindrance).toBe(0);
    expect(los('yK5', 'yM5').hindrance).toBe(0);
    const winter = mk(1);
    const wenv = winter.engine.env(winter.state);
    expect(wenv.query('los.trace', { from: 'yM6', to: 'yK6' }, { clear: true, hindrance: 0, parts: [] })).toMatchObject({ clear: true, hindrance: 1 });
  });

  it('gives +1 Height Advantage TEM to units fired on from below, without FFMO, unless they crossed the Crest Line toward the firer', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain: { ...HILL, yM6: { terrain: 'woods', elevation: 1 } },
      startPhase: 'PFPh',
      pieces: [
        { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yK5' },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yM5' },
        { id: 'b2', def: 'br.457', side: 'br', hex: 'yM6' },
      ],
    });
    const env = engine.env(state);
    const decl = (target: string): FireDeclaration => ({ units: ['e1'], sw: [], target });
    const prep = buildAttack(env, decl('yM5'), 'prep', 'ge');
    expect(env.explain('fire.unitDrm', { attack: prep, unit: 'b1' }, 0).trace.filter((t) => !t.suppressedBy).map((t) => t.id)).toContain('sk2.drm.height-advantage');
    // Woods TEM is a positive TEM: no Height Advantage on top of it.
    const woods = buildAttack(env, decl('yM6'), 'prep', 'ge');
    expect(env.explain('fire.unitDrm', { attack: woods, unit: 'b2' }, 0).trace.filter((t) => !t.suppressedBy).map((t) => t.id)).not.toContain('sk2.drm.height-advantage');
    // The thread from K5 enters M5 through its L5 hexside.
    expect(entryHexside(env, 'yM5', 'yK5')).toBe('yL5');
    // Moving in from L5, across the Crest Line the firer's LOS crosses: no Height Advantage, FFMO applies.
    const silhouetted = buildAttack(env, decl('yM5'), 'first', 'ge', ['b1'], { assault: false, viaRoadIntoWoodsRoad: false, from: 'yL5' });
    expect(heightAdvantageHex(env, 'yM5', ['yK5'], { from: 'yL5' })).toBe(false);
    expect(env.explain('fire.drm', { attack: silhouetted }, 0).trace.filter((t) => !t.suppressedBy).map((t) => t.id)).toContain('sk1.drm.ffmo');
    // Moving in from M4 (already on the hill): Height Advantage, and no FFMO.
    const along = buildAttack(env, decl('yM5'), 'first', 'ge', ['b1'], { assault: false, viaRoadIntoWoodsRoad: false, from: 'yM4' });
    expect(env.explain('fire.unitDrm', { attack: along, unit: 'b1' }, 0).trace.filter((t) => !t.suppressedBy).map((t) => t.id)).toContain('sk2.drm.height-advantage');
    const drm = env.explain('fire.drm', { attack: along }, 0).trace;
    expect(drm.find((t) => t.id === 'sk1.drm.ffmo')?.suppressedBy).toBe('sk2.drm.ffmo.height-advantage');
    expect(drm.some((t) => t.id === 'sk1.drm.ffnam' && !t.suppressedBy)).toBe(true);
  });

  it('applies to the To Hit DR of ordnance fired from below (ITT), and spares a routing unit Interdiction', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain: HILL,
      startPhase: 'PFPh',
      pieces: [
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
        { id: 'g1', def: 'ge.AT75L', side: 'ge', heldBy: 'c1', tags: { ca: 1 } },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yM5', tags: { broken: true } },
      ],
    });
    const env = engine.env(state);
    const sc = shotContext(env, { weapon: 'g1', target: 'yM5', targetType: 'ITT' }, 'prep', 'ge');
    const th = env.explain('ordnance.thDrm', sc, 0).trace.filter((t) => !t.suppressedBy).map((t) => t.id);
    expect(th).toContain('sk2.th.heightAdvantage');
    // Routing uphill into M5 from M4 (along the hill): no Interdiction from the crew below.
    expect(interdicted(env, 'br', 'yM5', 'yM4')).toEqual([]);
    // Routing across the Crest Line through the hexside the crew's LOS crosses: interdicted as usual.
    expect(interdicted(env, 'br', 'yM5', 'yL5').map((p) => p.id)).toEqual(['c1']);
    // And at ground level, with no hill involved, a router is interdicted.
    expect(interdicted(env, 'br', 'yL5', 'yL4').map((p) => p.id)).toEqual(['c1']);
  });
});
