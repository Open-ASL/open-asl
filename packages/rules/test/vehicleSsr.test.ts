import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { moveState } from '../src/sk1/movement';
import { terrainCostModule } from '../src/sk1/terrainCost';
import { attackDrmModule } from '../src/sk2/attackDrm';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { digInModule } from '../src/sk3/digIn';
import { immobilizationDrModule } from '../src/sk3/immobilizationDr';
import { mpLimitModule } from '../src/sk3/mpLimit';
import { T3 } from '../src/sk3/status';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * S28's special rules as general modules: an immobilization DR entering wet ground (SSR 1), wetland costs (SSR 2),
 * dug-in AFV (SSR 3) and a +1 DRM to every IFT/TH attack (SSR 4).
 */

const extra = [...sk2CoreModules, ...sk3CoreModules, immobilizationDrModule, terrainCostModule, digInModule, attackDrmModule];
const ssr = {
  immob: { module: 'immobilization-dr', params: { terrains: ['open', 'brush', 'grain'], notHill: true, atLeast: 11, rule: 'SSR 1' }, text: '' },
  cost: { module: 'terrain-cost', params: { terrains: ['grain', 'brush'], mf: 1.5, vehicleMp: 2, rule: 'SSR 2' }, text: '' },
  digIn: { module: 'dig-in', params: { side: 'ru', thDrm: 1, rule: 'SSR 3' }, text: '' },
  dark: { module: 'attack-drm', params: { drm: 1, label: 'pre-dawn darkness', rule: 'SSR 4' }, text: '' },
};
const t34 = (hex: string, tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id: 't', def: 'ru.T34M43', side: 'ru', hex, tags: { vca: 0, ca: 0, ...tags } });
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const passDff = (engine: Engine, s: GameState) => {
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
};

describe('Immobilization DR entering wet ground (SSR)', () => {
  const game = (dice: number[], opts: { terrain?: Record<string, { terrain: string }>; roadHexsides?: [string, string][] } = {}) =>
    makeEngine({ pieces: [t34('yM9')], scenario: { ...RU_VS_GE, ssr: [ssr.immob] }, extra, startPhase: 'MPh', dice, ...opts });

  it('a DR ≥ 11 entering Open Ground immobilizes the AFV there and ends its move', () => {
    const { engine, state } = game([6, 5]);
    const s = act(engine, state, { type: 'vmove.start', vehicle: 't' }).state;
    const r = act(engine, s, { type: 'move.step', to: 'yM8' });
    expect(ev(r, 'ssr.immobilization.dr')[0]).toMatchObject({ vehicle: 't', hex: 'yM8', dr: [6, 5], immobilized: true, rule: 'SSR 1' });
    expect(r.state.pieces['t']!.tags[T3.immob]).toBe(true);
    expect(r.state.pieces['t']!.loc).toEqual({ kind: 'hex', hex: 'yM8' });
  });

  it('a lower DR lets it carry on; woods and a hex entered along a road take no DR', () => {
    const ok = game([5, 5]);
    const r = act(ok.engine, act(ok.engine, ok.state, { type: 'vmove.start', vehicle: 't' }).state, { type: 'move.step', to: 'yM8' });
    expect(ev(r, 'ssr.immobilization.dr')[0]).toMatchObject({ immobilized: false });
    expect(r.state.pieces['t']!.tags[T3.immob]).toBeUndefined();
    const road = game([6, 6], { roadHexsides: [['yM9', 'yM8']], terrain: { yM8: { terrain: 'open', features: ['road:dirt'] } as never, yM9: { terrain: 'open', features: ['road:dirt'] } as never } });
    const rr = act(road.engine, act(road.engine, road.state, { type: 'vmove.start', vehicle: 't' }).state, { type: 'move.step', to: 'yM8' });
    expect(ev(rr, 'ssr.immobilization.dr')).toHaveLength(0);
  });
});

describe('Terrain costs by SSR (wetland)', () => {
  it('Infantry pay 1.5 MF into brush and grain, vehicles 2 MP', () => {
    const { engine, state } = makeEngine({
      pieces: [t34('yM9'), { id: 'sq', def: 'ru.447', side: 'ru', hex: 'yM9' }],
      terrain: { yM8: { terrain: 'brush' }, yN8: { terrain: 'grain' } },
      scenario: { ...RU_VS_GE, month: 7, ssr: [ssr.cost] },
      extra,
      startPhase: 'MPh',
    });
    const env = engine.env(state);
    expect(env.query('move.cost', { unit: 'sq', from: 'yM9', to: 'yM8', viaRoad: false }, 1)).toBe(1.5);
    expect(env.query('move.cost', { unit: 'sq', from: 'yM9', to: 'yN8', viaRoad: false }, 1)).toBe(1.5);
    expect(env.query('move.cost', { unit: 'sq', from: 'yM9', to: 'yM10', viaRoad: false }, 1)).toBe(1);
    expect(env.query('move.cost', { unit: 't', from: 'yM9', to: 'yM8', viaRoad: false }, 1)).toBe(2);
    expect(env.query('move.cost', { unit: 't', from: 'yM9', to: 'yN8', viaRoad: false }, 1)).toBe(2);
    expect(env.query('move.cost', { unit: 't', from: 'yM9', to: 'yM10', viaRoad: false }, 1)).toBe(1);
  });
});

describe('Dug-in AFV (SSR)', () => {
  const pziv: PieceSpec = { id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: 'yM4', tags: { vca: 3, ca: 3 } };
  const game = (dice: number[], tags: Record<string, boolean>, more: object[] = []) =>
    makeEngine({ pieces: [t34('yM9', tags), pziv], scenario: { ...RU_VS_GE, firstSide: 'ge', ssr: [ssr.digIn, ...more] as never }, extra, startPhase: 'PFPh', dice });
  const shoot = (engine: Engine, state: GameState) => {
    const r = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'pz', target: 'yM9', targetType: 'VTT' } });
    r.state = passDff(engine, r.state);
    return r;
  };

  it('+1 To Hit against it, and a hull hit is a miss: no To Kill', () => {
    const open = shoot(...(Object.values(game([2, 3, 6, 6], {})) as [Engine, GameState]));
    const dug = shoot(...(Object.values(game([2, 3, 6, 6], { [T3.dugIn]: true })) as [Engine, GameState]));
    expect((ev(dug, 'sk2.ordnance.shot')[0]!['drm'] as number) - (ev(open, 'sk2.ordnance.shot')[0]!['drm'] as number)).toBe(1);
    expect(ev(open, 'sk3.toKill')).toHaveLength(1);
    expect(ev(dug, 'sk3.toKill')).toHaveLength(0);
    expect(ev(dug, 'ssr.dig-in.hullHit')[0]).toMatchObject({ target: 't', rule: 'SSR 3' });
  });

  it('a turret hit is resolved as usual', () => {
    const r = shoot(...(Object.values(game([3, 2, 6, 6], { [T3.dugIn]: true })) as [Engine, GameState]));
    expect(ev(r, 'sk3.toKill')[0]).toMatchObject({ location: 'turret' });
  });

  it('never starts to move or attempts Motion', () => {
    const { engine, state } = makeEngine({ pieces: [t34('yM9', { [T3.dugIn]: true })], scenario: { ...RU_VS_GE, ssr: [ssr.digIn] }, extra, startPhase: 'MPh' });
    const d = engine.currentDecision(state)!;
    expect(engine.validate(state, { type: 'vmove.start', vehicle: 't', side: 'ru', decisionId: d.id } as never)).toMatch(/dug-in vehicle never moves/);
  });

  it('+1 to every IFT and To Hit attack in the darkness', () => {
    const plain = shoot(...(Object.values(game([2, 3, 6, 6], {})) as [Engine, GameState]));
    const dark = shoot(...(Object.values(game([2, 3, 6, 6], {}, [ssr.dark])) as [Engine, GameState]));
    expect((ev(dark, 'sk2.ordnance.shot')[0]!['drm'] as number) - (ev(plain, 'sk2.ordnance.shot')[0]!['drm'] as number)).toBe(1);
    const { engine, state } = makeEngine({ pieces: [{ id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM4' }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'yM6' }], scenario: { ...RU_VS_GE, firstSide: 'ge', ssr: [ssr.dark] }, extra, startPhase: 'PFPh' });
    const env = engine.env(state);
    const attack = { mode: 'prep', side: 'ge', target: 'yM6', parts: [], targets: ['r'], hindrance: 0 } as never;
    expect(env.query('fire.drm', { attack }, 0)).toBe(1);
    expect(env.query('fire.drm', { attack: { ...(attack as object), ordnance: { targetType: 'ITT', ch: false, column: 8 } } as never }, 0)).toBe(0);
  });
});

describe('MP limit by SSR (soggy ground)', () => {
  const limit = { module: 'mp-limit', params: { side: 'ru', fraction: 0.5, woodsHalfIsAll: true, rule: 'SSR 1' }, text: '' };
  const game = (ssrs: object[]) =>
    makeEngine({ pieces: [t34('yM9')], terrain: { yM8: { terrain: 'woods' } }, scenario: { ...RU_VS_GE, ssr: ssrs as never }, extra: [...extra, mpLimitModule], startPhase: 'MPh' });

  it('the side\'s vehicles have half their printed MP each MPh', () => {
    const { engine, state } = game([limit]);
    expect(engine.env(state).query('unit.mf', { unit: 't', stack: ['t'], doubleTime: false }, 0)).toBe(8);
    const s = act(engine, state, { type: 'vmove.start', vehicle: 't' }).state;
    const plain = game([]);
    expect(plain.engine.env(plain.state).query('unit.mf', { unit: 't', stack: ['t'], doubleTime: false }, 0)).toBe(16);
    expect(moveState(engine.env(s))!.allowance['t']).toBe(8);
  });

  it('entering woods at half MP takes no half-MP Bog DRM', () => {
    const on = game([limit]);
    const off = game([]);
    const drm = (g: ReturnType<typeof game>) => g.engine.env(g.state).query('vehicle.bogDrm', { vehicle: 't', hex: 'yM8', halfMp: true }, 0);
    expect(drm(off) - drm(on)).toBe(3);
  });
});
