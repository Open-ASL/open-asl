import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { attackFp, buildAttack, ordnanceOf } from '../src';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { RU_VS_GE, TABLES, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * Anti-Tank Rifles (SK4 4.4.4): a SW that attacks vehicles on the Vehicle Target Type of the To Hit
 * chart's ATR row and the AP To Kill Table, 12 hexes at most; vs Infantry a 1 FP SW on the IFT that
 * may join a Fire Group, with no long range and no Residual FP; normal breakdown on a 12.
 */

const extra = [...sk2CoreModules, ...sk3CoreModules];
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
/** The chart's "All ATR" row (VTT 10 at 1-6 hexes, 8 at 7-12) and the Russian ATR AP To Kill row (8 at 0-1 hexes, 7 at 2...). */
const tables = {
  toHit: ((def, tt, range) => (def.type === 'ATR' ? (tt === 'VTT' && range >= 1 && range <= 12 ? { black: range <= 6 ? 10 : 8, ch: 2, red: range <= 6 ? 10 : 8, chRed: 2 } : null) : TABLES.toHit(def, tt, range))) as typeof TABLES.toHit,
  toKill: ((def, ammo, range) => (def.type === 'ATR' ? (ammo === 'AP' ? (range <= 1 ? 8 : 7) : null) : TABLES.toKill(def, ammo, range))) as typeof TABLES.toKill,
};
function game(pieces: PieceSpec[], dice: number[] = [], startPhase = 'PFPh') {
  return makeEngine({ scenario: RU_VS_GE, extra, startPhase, dice, tables, pieces });
}
const atrGame = (target: string, dice: number[] = [], others: PieceSpec[] = []) =>
  game([{ id: 'q', def: 'ru.447', side: 'ru', hex: 'yK5' }, { id: 'a', def: 'ru.ATR', side: 'ru', heldBy: 'q' }, ...others, { id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: target, tags: { vca: 0, ca: 0 } }], dice);
const illegal = (engine: Engine, state: GameState, shot: Record<string, unknown>) => engine.env(state).query('ordnance.illegal', { shot: shot as never, mode: 'prep', side: 'ru' }, null);

describe('Anti-Tank Rifles (SK4 4.4.4)', () => {
  it('is SW ordnance on the Vehicle Target Type only, AP, 12 hexes at most', () => {
    const { engine, state } = atrGame('yK8');
    const env = engine.env(state);
    expect(ordnanceOf(env, state.pieces['a']!)).toMatchObject({ type: 'ATR', light: true, maxRange: 12, ammo: { he: false, ap: true }, b: 12 });
    expect(illegal(engine, state, { weapon: 'a', target: 'yK8', targetType: 'VTT' })).toBeNull();
    expect(illegal(engine, state, { weapon: 'a', target: 'yK8', targetType: 'ITT' })).not.toBeNull();
    const far = atrGame('yY5');
    expect(illegal(far.engine, far.state, { weapon: 'a', target: 'yY5', targetType: 'VTT' })).toMatch(/maximum range/);
  });

  it('a hit rolls on the AP To Kill Table less the Armor Factor; no ROF, no acquisition', () => {
    // TH DR 3 hits (TH 10, +1 BU); hull front (white ≥ colored), TK 7 - AF 6 = 1: DR 12 no effect.
    const { engine, state } = atrGame('yK8', [2, 1, 6, 6]);
    const r = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'a', target: 'yK8', targetType: 'VTT' } });
    expect(ev(r, 'sk2.ordnance.shot')[0]).toMatchObject({ outcome: 'hit', ammo: 'AP', range: 3 });
    expect(ev(r, 'sk3.toKill')[0]).toMatchObject({ tk: 7, af: 6 });
    expect(ev(r, 'sk2.ordnance.rof')).toHaveLength(0);
    expect(r.state.pieces['a']!.tags['acq']).toBeUndefined();
  });

  it('fires on the IFT with its unit as 1 FP, never beyond 12 hexes', () => {
    const { engine, state } = game([
      { id: 'q', def: 'ru.447', side: 'ru', hex: 'yK5' },
      { id: 'a', def: 'ru.ATR', side: 'ru', heldBy: 'q' },
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK8' },
      { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yY5' },
    ]);
    const env = engine.env(state);
    expect(env.query('fire.illegal', { decl: { units: ['q'], sw: ['a'], target: 'yK8' }, mode: 'prep', side: 'ru' }, null)).toBeNull();
    expect(attackFp(env, buildAttack(env, { units: ['q'], sw: ['a'], target: 'yK8' }, 'prep', 'ru'))).toBe(5);
    expect(env.query('fire.illegal', { decl: { units: [], sw: ['a'], target: 'yY5' }, mode: 'prep', side: 'ru' }, null)).toMatch(/out of range/);
  });
});
