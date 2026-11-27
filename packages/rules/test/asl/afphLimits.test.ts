import { describe, expect, it } from 'vitest';
import type { Engine, GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, piecesModule, turnModule } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * The AFPh SW limits in full ASL (ASLRB A4.41): a MMG moved only if it was possessed while its holder spent MF, so one
 * Recovered where it lay may fire in the AFPh; one carried a hex, or held during a SMOKE attempt, may not. Board u, Open
 * Ground; the Germans move first; the Russian target stands three hexes away.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GE_RU = { firstSide: 'ge', sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 }] };

function game(pieces: PieceSpec[], opts: { asl?: boolean; dice?: number[] } = {}) {
  return makeEngine({ board: 'u', scenario: GE_RU, modules: opts.asl === false ? SK : ASL, startPhase: 'MPh', pieces: [...pieces, { id: 'r', def: 'ru.447', side: 'ru', hex: 'uQ9' }], dice: opts.dice ?? [] });
}
const passAll = (engine: Engine, s0: GameState) => {
  let s = s0;
  for (let i = 0; i < 20 && engine.currentDecision(s)?.owner === 'ru'; i++) s = act(engine, s, { type: 'defPass' }).state;
  return s;
};
/** Ends phases until the AFPh. */
const toAfph = (engine: Engine, s0: GameState) => {
  let s = s0;
  for (let i = 0; i < 40 && s.phase !== 'AFPh'; i++) {
    const d = engine.currentDecision(s)!;
    const legal = engine.legalActions(s, d.owner);
    s = act(engine, s, legal.find((x) => x.type === 'defPass') ?? legal.find((x) => x.type === 'move.end') ?? legal.find((x) => x.type === 'endPhase') ?? legal[0]!).state;
  }
  return s;
};
const check = (engine: Engine, s: GameState, a: Record<string, unknown>) => {
  const d = engine.currentDecision(s)!;
  return engine.validate(s, { side: d.owner, decisionId: d.id, ...a } as never);
};
const fireMmg = { type: 'fire', decl: { units: [], sw: ['mmg'], target: 'uQ9' } };

describe('A4.41 AFPh limits: a weapon Recovered where it lay', () => {
  // Recovery dr 1 (< 6) succeeds.
  const recoverInPlace = (asl: boolean) => {
    const { engine, state } = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uQ5' }, { id: 'mmg', def: 'ge.MMG', side: 'ge', hex: 'uQ6' }], { asl, dice: [1] });
    let s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    s = passAll(engine, act(engine, s, { type: 'move.step', to: 'uQ6' }).state);
    s = passAll(engine, act(engine, s, { type: 'move.recover', unit: 'g', sw: 'mmg' }).state);
    expect(s.pieces['mmg']!.loc).toEqual({ kind: 'held', by: 'g' });
    s = passAll(engine, act(engine, s, { type: 'move.end' }).state);
    return { engine, s: toAfph(engine, s) };
  };

  it('a 4-6-7 enters, Recovers the stationary MMG and fires it in the AFPh (A4.41 "remained stationary ... Recovered")', () => {
    const { engine, s } = recoverInPlace(true);
    expect(s.pieces['mmg']!.tags['mfHeld']).toBeUndefined();
    expect(check(engine, s, fireMmg)).toBeNull();
  });

  it('the Starter Kit refuses it: its holder moved (SK1 3.5)', () => {
    const { engine, s } = recoverInPlace(false);
    expect(check(engine, s, fireMmg)).toMatch(/moved cannot fire in the AFPh/);
  });

  it('one carried a hex may not fire, and the mark is gone by the next Player Turn', () => {
    const { engine, state } = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uQ5' }, { id: 'mmg', def: 'ge.MMG', side: 'ge', heldBy: 'g' }]);
    let s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    s = passAll(engine, act(engine, s, { type: 'move.step', to: 'uQ6' }).state);
    s = passAll(engine, act(engine, s, { type: 'move.end' }).state);
    expect(s.pieces['mmg']!.tags['mfHeld']).toBe(true);
    s = toAfph(engine, s);
    expect(check(engine, s, fireMmg)).toMatch(/moved cannot fire in the AFPh/);
    for (let i = 0; i < 40 && s.attacker === 'ge'; i++) {
      const d = engine.currentDecision(s)!;
      const legal = engine.legalActions(s, d.owner);
      s = act(engine, s, legal.find((x) => x.type === 'endPhase') ?? legal.find((x) => x.type === 'defPass') ?? legal[0]!).state;
    }
    expect(s.pieces['mmg']!.tags['mfHeld']).toBeUndefined();
  });

  it('a SMOKE attempt while holding it counts as moving it (Q&A to A4.41: "the MMG \'moved\'")', () => {
    // Smoke dr 6: no SMOKE, and the unit's MPh ends where it stands.
    const { engine, state } = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uQ5' }, { id: 'mmg', def: 'ge.MMG', side: 'ge', heldBy: 'g' }], { dice: [6] });
    let s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    s = passAll(engine, act(engine, s, { type: 'move.smoke', unit: 'g', target: 'uQ5' }).state);
    s = toAfph(engine, s);
    expect(check(engine, s, fireMmg)).toMatch(/moved cannot fire in the AFPh/);
  });

  it('a unit that began its move holding it but spent no MF did not move it', () => {
    const { engine, state } = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uQ5' }, { id: 'mmg', def: 'ge.MMG', side: 'ge', heldBy: 'g' }]);
    let s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    s = passAll(engine, act(engine, s, { type: 'move.end' }).state);
    s = toAfph(engine, s);
    expect(check(engine, s, fireMmg)).toBeNull();
  });
});
