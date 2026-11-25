import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { attackFp, buildAttack, mgAsOrdnance, ordnanceOf, shotContext, toHitNumber } from '../src';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { RU_VS_GE, TABLES, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * Machine Guns vs AFV (SK4 4.1; ASLRB A9.61): a non-vehicular MG may attack an AFV as ordnance, on the Vehicle Target
 * Type of the To Hit chart's "All MG" row and then the AP To Kill Table, within its normal range and without any
 * halved FP penalty. It uses the black To Hit numbers whatever its nationality and has no Critical Hit; at anything
 * else it is an ordinary SW on the IFT.
 */

const extra = [...sk2CoreModules, ...sk3CoreModules];
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
/** The "All MG" row (VTT 10 at 1-6 hexes, 9 black / 8 red at 7-12) and the MG AP To Kill row (6). */
const tables = {
  toHit: ((def, tt, range) => (def.type === 'MG' ? (tt === 'VTT' && range >= 1 && range <= 12 ? { black: range <= 6 ? 10 : 9, ch: 0, red: range <= 6 ? 10 : 8, chRed: 0 } : null) : TABLES.toHit(def, tt, range))) as typeof TABLES.toHit,
  toKill: ((def, ammo, range) => (def.type === 'MG' ? (ammo === 'AP' ? 6 : null) : TABLES.toKill(def, ammo, range))) as typeof TABLES.toKill,
};
const game = (pieces: PieceSpec[], dice: number[] = [], startPhase = 'PFPh', firstSide = 'ru') => makeEngine({ scenario: { ...RU_VS_GE, firstSide }, extra, startPhase, dice, tables, pieces });
const pz = (hex: string): PieceSpec => ({ id: 'pz', def: 'ge.pzivf2', side: 'ge', hex, tags: { vca: 0, ca: 0 } });
/** A Russian squad with a LMG (range 6, ROF 1, B# 11) in yK5. */
const mgGame = (target: string, dice: number[] = [], others: PieceSpec[] = [], startPhase = 'PFPh') =>
  game([{ id: 'q', def: 'ru.447', side: 'ru', hex: 'yK5' }, { id: 'm', def: 'ru.LMG', side: 'ru', heldBy: 'q' }, ...others, pz(target)], dice, startPhase);
const illegal = (engine: Engine, state: GameState, shot: Record<string, unknown>, mode = 'prep') => engine.env(state).query('ordnance.illegal', { shot: shot as never, mode: mode as never, side: 'ru' }, null);
const toEnd = (engine: Engine, state: GameState, until: (s: GameState) => boolean) => {
  let s = state;
  for (let i = 0; i < 40 && !until(s); i++) {
    const d = engine.currentDecision(s)!;
    s = act(engine, s, { type: d.kind === 'firstFire' ? 'defPass' : 'endPhase', side: d.owner }).state;
  }
  return s;
};

describe('Machine Guns vs AFV (SK4 4.1)', () => {
  it('stays an IFT SW, and fires as ordnance on the Vehicle Target Type only, AP, within its normal range', () => {
    const { engine, state } = mgGame('yK8');
    const env = engine.env(state);
    expect(ordnanceOf(env, state.pieces['m']!)).toBeNull();
    expect(mgAsOrdnance(env, state.pieces['m']!)).toMatchObject({ type: 'MG', light: true, maxRange: 6, ammo: { he: false, ap: true }, b: 11, rof: 1 });
    expect(illegal(engine, state, { weapon: 'm', target: 'yK8', targetType: 'VTT' })).toBeNull();
    expect(illegal(engine, state, { weapon: 'm', target: 'yK8', targetType: 'ITT' })).toMatch(/only at an AFV/);
    expect(illegal(engine, state, { weapon: 'm', target: 'yK8', targetType: 'ATT' })).toMatch(/only at an AFV/);
    // yR5, 7 hexes, is long range for the LMG: never as ordnance (no halved FP).
    const far = mgGame('yR5');
    expect(illegal(far.engine, far.state, { weapon: 'm', target: 'yR5', targetType: 'VTT' })).toMatch(/normal range \(6 hexes/);
  });

  it('uses the black To Hit numbers whatever its nationality, with no Critical Hit', () => {
    const { engine, state } = game([{ id: 'q', def: 'ru.447', side: 'ru', hex: 'yK5' }, { id: 'm', def: 'ge.MMG', side: 'ru', heldBy: 'q' }, pz('yR5')]);
    const env = engine.env(state);
    // A Russian unit firing a German MMG is Captured Use: red then (SK4 3.2.4).
    expect(toHitNumber(env, shotContext(env, { weapon: 'm', target: 'yR5', targetType: 'VTT' }, 'prep', 'ru'))).toMatchObject({ th: 8, red: true, ch: 0 });
    const own = game([{ id: 'q', def: 'ru.447', side: 'ru', hex: 'yK5' }, { id: 'm', def: 'ge.MMG', side: 'ge', heldBy: 'q' }, pz('yR5')]);
    const env2 = own.engine.env(own.state);
    expect(env2.query('ordnance.redTh', shotContext(env2, { weapon: 'm', target: 'yR5', targetType: 'VTT' }, 'prep', 'ru'), false)).toBe(false);
    // The Russian LMG: nationality alone gives a MA or Gun the red numbers, never an Infantry MG.
    const ru = mgGame('yK8');
    const env3 = ru.engine.env(ru.state);
    expect(env3.query('ordnance.redTh', shotContext(env3, { weapon: 'm', target: 'yK8', targetType: 'VTT' }, 'prep', 'ru'), false)).toBe(false);
  });

  it('a hit rolls on the MG To Kill row less the Armor Factor; ROF as usual; no acquisition', () => {
    // TH DR 3 hits; TK 6 - AF 6 = 0, so the To Kill DR 7 does nothing.
    const { engine, state } = mgGame('yK8', [2, 1, 3, 4]);
    const r = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'm', target: 'yK8', targetType: 'VTT' } });
    expect(ev(r, 'sk2.ordnance.shot')[0]).toMatchObject({ weapon: 'm', firer: 'q', outcome: 'hit', ammo: 'AP', range: 3, ch: 0 });
    expect(ev(r, 'sk3.toKill')[0]).toMatchObject({ tk: 6, af: 6, result: 'none' });
    expect(ev(r, 'sk2.ordnance.rof')[0]).toMatchObject({ weapon: 'm', kept: true });
    expect(r.state.pieces['m']!.tags['acq']).toBeUndefined();
    // The squad still fires its own FP that phase: a squad fires one SW at no cost to its own FP (SK1 4.0).
    expect(r.state.pieces['q']!.tags['fire']).toBeUndefined();
  });

  it('a TK DR equal to the Final TK# stuns the AFV, and the To Kill record says STUN when the crew was already stunned (SK4 7.10)', () => {
    // From behind, a turret hit: TK 6 + 1 (rear) - AF 4 = Final TK 3. TH DR 3 hits; TK DR 3 equals it.
    const rear = (tags: Record<string, string | number | boolean>) =>
      game([{ id: 'q', def: 'ru.447', side: 'ru', hex: 'yK5' }, { id: 'm', def: 'ru.LMG', side: 'ru', heldBy: 'q' }, { id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: 'yK8', tags: { vca: 3, ca: 3, ...tags } }], [2, 1, 1, 2]);
    const shot = { type: 'fire.ordnance', shot: { weapon: 'm', target: 'yK8', targetType: 'VTT' } };
    const first = rear({});
    const r1 = act(first.engine, first.state, shot);
    expect(ev(r1, 'sk3.toKill')[0]).toMatchObject({ finalTk: 3, result: 'stun', stunned: 'stun' });
    expect(r1.state.pieces['pz']!.tags['stunRecall']).toBeUndefined();
    const second = rear({ stun: 'plus1' });
    const r2 = act(second.engine, second.state, shot);
    expect(ev(r2, 'sk3.toKill')[0]).toMatchObject({ result: 'stun', stunned: 'STUN' });
    expect(r2.state.pieces['pz']!.tags).toMatchObject({ stunRecall: true, recall: true });
  });

  it('a malfunction on an original TH DR at or above its B#', () => {
    const { engine, state } = mgGame('yK8', [6, 5]);
    const r = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'm', target: 'yK8', targetType: 'VTT' } });
    expect(r.state.pieces['m']!.tags['malf']).toBe(true);
  });

  it('never with halved FP: not in the AFPh, not pinned, not by a lone SMC', () => {
    const afph = mgGame('yK8', [], [], 'AFPh');
    expect(illegal(afph.engine, afph.state, { weapon: 'm', target: 'yK8', targetType: 'VTT' }, 'advancing')).toMatch(/halved in the AFPh/);
    const pinned = game([{ id: 'q', def: 'ru.447', side: 'ru', hex: 'yK5', tags: { pinned: true } }, { id: 'm', def: 'ru.LMG', side: 'ru', heldBy: 'q' }, pz('yK8')]);
    expect(illegal(pinned.engine, pinned.state, { weapon: 'm', target: 'yK8', targetType: 'VTT' })).toMatch(/pinned unit fires at half FP/);
    const lone = game([{ id: 'l', def: 'ru.L61', side: 'ru', hex: 'yK5' }, { id: 'm', def: 'ru.LMG', side: 'ru', heldBy: 'l' }, pz('yK8')]);
    expect(illegal(lone.engine, lone.state, { weapon: 'm', target: 'yK8', targetType: 'VTT' })).toMatch(/lone SMC/);
  });

  it('still fires on the IFT with its squad at Infantry', () => {
    const { engine, state } = game([{ id: 'q', def: 'ru.447', side: 'ru', hex: 'yK5' }, { id: 'm', def: 'ru.LMG', side: 'ru', heldBy: 'q' }, { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK8' }]);
    const env = engine.env(state);
    expect(env.query('fire.illegal', { decl: { units: ['q'], sw: ['m'], target: 'yK8' }, mode: 'prep', side: 'ru' }, null)).toBeNull();
    expect(attackFp(env, buildAttack(env, { units: ['q'], sw: ['m'], target: 'yK8' }, 'prep', 'ru'))).toBe(6);
  });

  it('after a shot that loses ROF the MG is done for the phase, and fires normally in the next Player Turn', () => {
    // TH DR 2+5 = 7 (colored 5 > ROF 1) misses.
    const { engine, state } = mgGame('yK8', [2, 5]);
    let s = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'm', target: 'yK8', targetType: 'VTT' } }).state;
    expect(s.pieces['m']!.tags['fire']).toBe('prep');
    expect(illegal(engine, s, { weapon: 'm', target: 'yK8', targetType: 'VTT' })).toMatch(/already fired/);
    // On into the German Player Turn: in the DFPh the marker is gone and the MG may fire at the AFV again.
    s = toEnd(engine, s, (x) => x.attacker === 'ge' && x.phase === 'DFPh');
    expect(s.phase).toBe('DFPh');
    expect(s.pieces['m']!.tags['fire']).toBeUndefined();
    expect(engine.env(s).query('ordnance.illegal', { shot: { weapon: 'm', target: 'yK8', targetType: 'VTT' }, mode: 'final', side: 'ru' }, null)).toBeNull();
  });

  it('as Defensive First Fire at an AFV moving in its LOS', () => {
    const { engine, state } = game([{ id: 'q', def: 'ru.447', side: 'ru', hex: 'yK5' }, { id: 'm', def: 'ru.LMG', side: 'ru', heldBy: 'q' }, pz('yK9')], [2, 1, 3, 4], 'MPh', 'ge');
    let s = act(engine, state, { type: 'vmove.start', vehicle: 'pz' }).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    s = act(engine, s, { type: 'move.step', to: 'yK8' }).state;
    expect(engine.currentDecision(s)!.kind).toBe('firstFire');
    const r = act(engine, s, { type: 'defFire.ordnance', side: 'ru', shot: { weapon: 'm', target: 'yK8', targetType: 'VTT' } });
    expect(ev(r, 'sk2.ordnance.shot')[0]).toMatchObject({ weapon: 'm', mode: 'first', outcome: 'hit' });
    expect(ev(r, 'sk3.toKill')).toHaveLength(1);
  });
});
