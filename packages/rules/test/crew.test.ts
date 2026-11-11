import { describe, expect, it } from 'vitest';
import type { Action, Ctx, Engine, GameState, RuleModule } from '@asl/engine';
import { FP, isCaptured, squadEquivalents, type FireDeclaration, type FireMode, type ResolveFireFn } from '../src';
import { GE_VS_BR, act, makeEngine } from './fixtures';

const testFire: RuleModule = {
  id: 'test.fire',
  install(r) {
    r.action<Action & { decl: FireDeclaration; mode: FireMode }>({
      type: 'test.fire',
      decisionKinds: ['phase'],
      validate: (env, a) => env.query('fire.illegal', { decl: a.decl, mode: a.mode, side: a.side }, null),
      resolve(ctx: Ctx, a) {
        ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, a.mode);
      },
    });
  },
};

const settle = (engine: Engine, state: GameState) => {
  let s = state;
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
};

describe('Crews (SK4 1.2.2, 3.3.1, 5.1)', () => {
  it('a crew possessing a Gun counts as a full squad for stacking', () => {
    const { engine, state } = makeEngine({
      scenario: { ...GE_VS_BR, firstSide: 'br' },
      startPhase: 'MPh',
      pieces: [
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yN4' },
        { id: 'b2', def: 'br.457', side: 'br', hex: 'yN4' },
        { id: 'h1', def: 'br.247', side: 'br', hex: 'yN4' },
        { id: 'c1', def: 'br.228c', side: 'br', hex: 'yO4' },
        { id: 'gun', def: 'br.AA40L', side: 'br', heldBy: 'c1' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yA1' },
      ],
    });
    const env = engine.env(state);
    expect(squadEquivalents(env, [state.pieces['c1']!])).toBe(1);
    expect(squadEquivalents(env, [state.pieces['h1']!])).toBe(0.5);
    // Two squads and a half-squad leave room for a half-squad but not for a crew with its Gun.
    let s = act(engine, state, { type: 'move.start', units: ['c1'] }).state;
    expect(() => act(engine, s, { type: 'move.step', to: 'yN4' })).toThrow(/Stacking limit/);
    s = act(engine, s, { type: 'move.end' }).state;
    s = act(engine, s, { type: 'move.start', units: ['h1'] }).state;
    s = settle(engine, act(engine, s, { type: 'move.step', to: 'yO4' }).state);
    expect(s.pieces['h1']!.loc).toEqual({ kind: 'hex', hex: 'yO4' });
  });

  it('Casualty Reduction eliminates a crew, worth 1 CVP', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra: [testFire],
      dice: [2, 3],
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN5' },
        { id: 'c1', def: 'br.228c', side: 'br', hex: 'yO5' },
        { id: 'gun', def: 'br.AA40L', side: 'br', heldBy: 'c1' },
      ],
    });
    // 4 FP doubled for PBF: 8 column, DR 5 is a K/1 on the fixture IFT.
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['g1'], sw: [], target: 'yO5' } });
    expect(t.state.pieces['c1']!.loc).toEqual({ kind: 'eliminated' });
    expect(t.events.find((e) => e.type === 'sk1.casualty')!.payload).toMatchObject({ unit: 'c1', vp: 1 });
    // The Gun stays in the hex, unpossessed.
    expect(t.state.pieces['gun']!.loc).toEqual({ kind: 'hex', hex: 'yO5' });
  });

  it('a crew that fails a MC by more than the ELR breaks but is not replaced', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra: [testFire],
      // 8 column, DR 8 → NMC; the crew rolls 11 against morale 8 with ELR 1.
      dice: [3, 5, 6, 5],
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN5' },
        { id: 'c1', def: 'br.228c', side: 'br', hex: 'yO5' },
      ],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['g1'], sw: [], target: 'yO5' } });
    expect(t.state.pieces['c1']!.tags['broken']).toBe(true);
    expect(t.events.some((e) => e.type === 'piece.replaced')).toBe(false);
  });

  it('a crew firing a weapon forfeits its own FP, like a half-squad', () => {
    const { engine, state } = makeEngine({
      scenario: { ...GE_VS_BR, firstSide: 'br' },
      extra: [testFire],
      pieces: [
        { id: 'c1', def: 'br.228c', side: 'br', hex: 'yN5' },
        { id: 'lmg', def: 'br.LMG', side: 'br', heldBy: 'c1' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
    });
    expect(() => act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['c1'], sw: ['lmg'], target: 'yO5' } })).toThrow(/crew firing a weapon forfeits/);
  });

  it('a weapon of any nationality the side fields is not captured', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      pieces: [
        { id: 'c1', def: 'br.228c', side: 'br', hex: 'yN5' },
        { id: 'alLmg', def: 'al.LMG', side: 'br', heldBy: 'c1' },
        { id: 'geLmg', def: 'ge.LMG', side: 'br', heldBy: 'c1' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
    });
    const env = engine.env(state);
    expect(isCaptured(env, state.pieces['alLmg']!)).toBe(false);
    expect(isCaptured(env, state.pieces['geLmg']!)).toBe(true);
  });

  it('only a MMC may possess a Gun: a leader cannot recover one', () => {
    const { engine, state } = makeEngine({
      scenario: { ...GE_VS_BR, firstSide: 'br' },
      startPhase: 'MPh',
      dice: [1, 1],
      pieces: [
        { id: 'l1', def: 'br.L80', side: 'br', hex: 'yN5' },
        { id: 'c1', def: 'br.228c', side: 'br', hex: 'yN5' },
        { id: 'gun', def: 'br.AA40L', side: 'br', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yA1' },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['l1'] }).state;
    expect(() => act(engine, s, { type: 'move.recover', unit: 'l1', sw: 'gun' })).toThrow(/Only a MMC may possess a Gun/);
    s = act(engine, s, { type: 'move.end' }).state;
    s = act(engine, s, { type: 'move.start', units: ['c1'] }).state;
    s = settle(engine, act(engine, s, { type: 'move.recover', unit: 'c1', sw: 'gun' }).state);
    expect(s.pieces['gun']!.loc).toEqual({ kind: 'held', by: 'c1' });
  });

  it('no RPh Recovery in a hex with an enemy unit (ASLRB A4.44): the Gun waits until the Melee is over', () => {
    const { engine, state } = makeEngine({
      scenario: { ...GE_VS_BR, firstSide: 'br' },
      startPhase: 'RPh',
      dice: [1],
      pieces: [
        { id: 'c1', def: 'br.228c', side: 'br', hex: 'yN5' },
        { id: 'gun', def: 'ge.AT75L', side: 'ge', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN5' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yA1' },
      ],
    });
    expect(() => act(engine, state, { type: 'rally.recover', unit: 'c1', sw: 'gun' })).toThrow(/enemy unit/);
    // The enemy gone, the crew captures the Gun in the RPh: it changes side and is captured.
    const alone = { ...state, pieces: { ...state.pieces, g1: { ...state.pieces['g1']!, loc: { kind: 'eliminated' as const } } } };
    const s = settle(engine, act(engine, alone, { type: 'rally.recover', unit: 'c1', sw: 'gun' }).state);
    expect(s.pieces['gun']!.loc).toEqual({ kind: 'held', by: 'c1' });
    expect(s.pieces['gun']!.side).toBe('br');
    expect(isCaptured(engine.env(s), s.pieces['gun']!)).toBe(true);
  });
});
