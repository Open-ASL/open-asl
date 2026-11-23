import { describe, expect, it } from 'vitest';
import type { GameState, Piece } from '@asl/engine';
import { DEMO_VEHICLES_SCENARIO, newGame } from '@asl/content';
import type { FireDeclaration } from '@asl/rules';
import { ftAfvTargets, isLoneFt } from '../src/game/ftTarget';

/*
 * A Flamethrower attacks an AFV only when it "must predesignate the AFV as the target before making the attack": then the
 * attack is made on the HE & Flame To Kill table (SK4 4.2). An attack on the IFT never harms a Buttoned Up AFV, so where
 * the firer sees only enemy AFVs a lone FT's attack is a predesignated one.
 */
const unit = (id: string, defId: string, hex: string, side: string, tags: Piece['tags'] = {}): Piece => ({ id, defId, side, loc: { kind: 'hex', hex }, tags });
const held = (id: string, defId: string, by: string, side: string): Piece => ({ id, defId, side, loc: { kind: 'held', by }, tags: {} });

function envWith(pieces: Piece[]) {
  const { engine, state } = newGame(DEMO_VEHICLES_SCENARIO, 'ft-target', { los: 'grid' });
  const s: GameState = { ...state, pieces: Object.fromEntries(pieces.map((p) => [p.id, p])) };
  return engine.env(s);
}
const firer = [unit('sq', 'ge.467', 'yR5', 'ge'), held('ft', 'ge.FT', 'sq', 'ge')];
const ftOnly: FireDeclaration = { units: [], sw: ['ft'], target: 'yR4' };

describe('a lone Flamethrower at a hex holding only enemy AFVs (SK4 4.2)', () => {
  it('predesignates the one AFV it sees there', () => {
    const env = envWith([...firer, unit('t34', 'ru.T34M41', 'yR4', 'ru')]);
    expect(isLoneFt(env, ftOnly)).toBe(true);
    expect(ftAfvTargets(env, ftOnly, 'yR4', 'ge')).toEqual(['t34']);
  });

  it('offers no predesignation where enemy personnel are seen too, nor for a wreck', () => {
    expect(ftAfvTargets(envWith([...firer, unit('t34', 'ru.T34M41', 'yR4', 'ru'), unit('ru1', 'ru.447', 'yR4', 'ru')]), ftOnly, 'yR4', 'ge')).toEqual([]);
    expect(ftAfvTargets(envWith([...firer, unit('t34', 'ru.T34M41', 'yR4', 'ru', { wreck: true })]), ftOnly, 'yR4', 'ge')).toEqual([]);
  });

  it('lists every AFV when there are several, so the player picks one', () => {
    const env = envWith([...firer, unit('t1', 'ru.T34M41', 'yR4', 'ru'), unit('t2', 'ru.T34M43', 'yR4', 'ru')]);
    expect(ftAfvTargets(env, ftOnly, 'yR4', 'ge').sort()).toEqual(['t1', 't2']);
  });

  it('only a lone FT predesignates: the squad firing its own FP, or another SW, does not', () => {
    const env = envWith([...firer, unit('t34', 'ru.T34M41', 'yR4', 'ru')]);
    expect(ftAfvTargets(env, { units: ['sq'], sw: [], target: 'yR4' }, 'yR4', 'ge')).toEqual([]);
    expect(isLoneFt(env, { units: ['sq'], sw: ['ft'], target: 'yR4' })).toBe(false);
  });
});
