import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { GE_VS_BR, RU_VS_GE, act, makeEngine } from './fixtures';
import { moveState, sk2CoreModules } from '../src';

/** Let the defender pass any Defensive First Fire opportunity that interrupts the mover. */
function settle(engine: Engine, state: GameState): GameState {
  let s = state;
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
}

describe('Support weapons: recovery, portage and dropping (SK1 4.0)', () => {
  it('a failed MPh recovery blocks a retry this MPh only; the tag is cleared when the phase ends', () => {
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice: [6],
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yN4' },
        { id: 'rLMG', def: 'ru.LMG', side: 'ru', hex: 'yN4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yA1' },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['r1'] }).state;
    s = settle(engine, act(engine, s, { type: 'move.recover', unit: 'r1', sw: 'rLMG' }).state);
    expect(s.pieces['rLMG']!.loc).toEqual({ kind: 'hex', hex: 'yN4' });
    expect(() => act(engine, s, { type: 'move.recover', unit: 'r1', sw: 'rLMG' })).toThrow(/Already attempted/);
    s = act(engine, s, { type: 'move.end' }).state;
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('DFPh');
    expect(Object.keys(s.pieces['rLMG']!.tags).some((k) => k.startsWith('recoverTried_'))).toBe(false);
  });

  it('a SW carried into a hex and dropped there cannot be picked up again by another unit this MPh', () => {
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice: [1, 1],
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yN4' },
        { id: 'rLMG', def: 'ru.LMG', side: 'ru', heldBy: 'r1' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'yO4' },
        { id: 'rMMG', def: 'ru.MMG', side: 'ru', hex: 'yO4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yA1' },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['r1'] }).state;
    s = settle(engine, act(engine, s, { type: 'move.step', to: 'yO4' }).state);
    expect(s.pieces['rLMG']!.tags['portaged']).toBe(true);
    s = act(engine, s, { type: 'move.drop', sw: 'rLMG' }).state;
    expect(s.pieces['rLMG']!.loc).toEqual({ kind: 'hex', hex: 'yO4' });
    s = act(engine, s, { type: 'move.end' }).state;
    s = act(engine, s, { type: 'move.start', units: ['r2'] }).state;
    expect(() => act(engine, s, { type: 'move.recover', unit: 'r2', sw: 'rLMG' })).toThrow(/more than once per MPh/);
    // The MMG that lay there all along is fair game (dr 1).
    s = settle(engine, act(engine, s, { type: 'move.recover', unit: 'r2', sw: 'rMMG' }).state);
    expect(s.pieces['rMMG']!.loc).toEqual({ kind: 'held', by: 'r2' });
    s = act(engine, s, { type: 'move.end' }).state;
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.pieces['rLMG']!.tags['portaged']).toBeUndefined();
    expect(s.pieces['rMMG']!.tags['portaged']).toBeUndefined();
  });

  it('a SMC may not recover a SW that would take it over 2 PP', () => {
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      dice: [1],
      pieces: [
        { id: 'rL', def: 'ru.L91', side: 'ru', hex: 'yN4' },
        { id: 'rMMG', def: 'ru.MMG', side: 'ru', hex: 'yN4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yA1' },
      ],
    });
    const s = act(engine, state, { type: 'move.start', units: ['rL'] }).state;
    expect(() => act(engine, s, { type: 'move.recover', unit: 'rL', sw: 'rMMG' })).toThrow(/more than 2 PP/);
  });

  it('an unbroken unit may drop a SW in the APh; a broken one may not', () => {
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      startPhase: 'APh',
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yN4' },
        { id: 'rLMG', def: 'ru.LMG', side: 'ru', heldBy: 'r1' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'yN5', tags: { broken: true } },
        { id: 'rMMG', def: 'ru.MMG', side: 'ru', heldBy: 'r2' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yA1' },
      ],
    });
    const t = act(engine, state, { type: 'move.drop', sw: 'rLMG' });
    expect(t.state.pieces['rLMG']!.loc).toEqual({ kind: 'hex', hex: 'yN4' });
    expect(engine.currentDecision(t.state)).toMatchObject({ kind: 'phase', owner: 'ru' });
    expect(() => act(engine, t.state, { type: 'move.drop', sw: 'rMMG' })).toThrow(/broken/);
  });
});

describe('Inexperienced MMC (SK1 5.4)', () => {
  it('a Green squad keeps 4 MF beside a pinned leader (still Good Order), but not a broken one', () => {
    const run = (leaderTags: Record<string, boolean>) => {
      const { engine, state } = makeEngine({
        startPhase: 'MPh',
        pieces: [
          { id: 'a1', def: 'am.536', side: 'am', hex: 'yN4' },
          { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN4', tags: leaderTags },
          { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yA1' },
        ],
      });
      const s = act(engine, state, { type: 'move.start', units: ['a1'] }).state;
      return moveState({ state: s } as never)!.allowance['a1'];
    };
    expect(run({ pinned: true })).toBe(4);
    expect(run({ broken: true })).toBe(3);
  });
});

describe('Demolition Charges (SK1 4.3)', () => {
  const place = (dice: number[]) => {
    const { engine, state } = makeEngine({
      startPhase: 'MPh',
      dice,
      pieces: [
        { id: 'a1', def: 'am.536', side: 'am', hex: 'yN4' },
        { id: 'aDC', def: 'am.DC', side: 'am', heldBy: 'a1' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['a1'] }).state;
    s = settle(engine, act(engine, s, { type: 'move.placeDc', dc: 'aDC', target: 'yO5' }).state);
    return { engine, s };
  };

  it('a Green squad placing a DC fixes its X# at 9: non-elite -2 and Inexperienced -1', () => {
    const { s } = place([]);
    expect(s.pieces['aDC']!.loc).toEqual({ kind: 'hex', hex: 'yO5' });
    expect(s.pieces['aDC']!.tags).toMatchObject({ dcPlaced: true, dcPlacer: 'a1', dcX: 9 });
  });

  it('the AFPh attack is a dud on an original DR of 10 against X# 9, and goes off on 8', () => {
    const toAfph = (engine: Engine, s0: GameState) => {
      let s = act(engine, s0, { type: 'move.end' }).state;
      // Ending the move offers the defender a last shot where the squad stands (SK1 3.3.1).
      if (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
      s = act(engine, s, { type: 'endPhase' }).state;
      expect(s.phase).toBe('DFPh');
      return act(engine, s, { type: 'endPhase' });
    };
    const dud = place([5, 5]);
    let t = toAfph(dud.engine, dud.s);
    expect(t.state.phase).toBe('AFPh');
    expect(t.events.some((e) => e.type === 'sk1.fire.attack')).toBe(true);
    expect(t.state.pieces['aDC']!.loc).toEqual({ kind: 'eliminated' });
    expect(t.state.pieces['g1']!.loc).toEqual({ kind: 'hex', hex: 'yO5' });
    expect(t.state.pieces['g1']!.tags['broken']).toBeUndefined();

    const live = place([4, 4]);
    t = toAfph(live.engine, live.s);
    const g1 = t.state.pieces['g1']!;
    expect(g1.loc.kind === 'eliminated' || g1.tags['broken'] === true).toBe(true);
  });
});

describe('Voluntary SW destruction (SK1 4.0)', () => {
  it('a squad may wreck a SW in the PFPh: it is gone, the squad has used a SW and cannot move', () => {
    const { engine, state } = makeEngine({
      startPhase: 'PFPh',
      pieces: [
        { id: 'a1', def: 'am.666', side: 'am', hex: 'yN4' },
        { id: 'aMMG', def: 'ge.MMG', side: 'am', heldBy: 'a1' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
        { id: 'gLMG', def: 'ge.LMG', side: 'ge', heldBy: 'g1' },
      ],
    });
    // The defender's SW is not the attacker's to destroy in the PFPh.
    expect(() => act(engine, state, { type: 'sw.destroy', sw: 'gLMG' })).toThrow(/Not your unit/);
    let s = act(engine, state, { type: 'sw.destroy', sw: 'aMMG' }).state;
    expect(s.pieces['aMMG']!.loc).toEqual({ kind: 'eliminated' });
    expect(s.pieces['a1']!.tags).toMatchObject({ firedSw: true, swDestroyed: 1 });
    expect(s.pieces['a1']!.tags['ownFpForfeit']).toBeUndefined();
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('MPh');
    expect(() => act(engine, s, { type: 'move.start', units: ['a1'] })).toThrow(/fired in the PFPh/);
  });

  it('a half-squad forfeits its own FP by destroying a SW; the defender may destroy in the DFPh; broken units may not', () => {
    const { engine, state } = makeEngine({
      startPhase: 'DFPh',
      pieces: [
        { id: 'a1', def: 'am.666', side: 'am', hex: 'yN4' },
        { id: 'g1', def: 'ge.247', side: 'ge', hex: 'yP9' },
        { id: 'gLMG', def: 'ge.LMG', side: 'ge', heldBy: 'g1' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yP8', tags: { broken: true } },
        { id: 'gMMG', def: 'ge.MMG', side: 'ge', heldBy: 'g2' },
      ],
    });
    expect(engine.currentDecision(state)).toMatchObject({ owner: 'ge' });
    expect(() => act(engine, state, { type: 'sw.destroy', sw: 'gMMG' })).toThrow(/Good Order/);
    const t = act(engine, state, { type: 'sw.destroy', sw: 'gLMG' });
    expect(t.state.pieces['gLMG']!.loc).toEqual({ kind: 'eliminated' });
    expect(t.state.pieces['g1']!.tags).toMatchObject({ firedSw: true, ownFpForfeit: true });
    expect(() => act(engine, t.state, { type: 'fire', decl: { units: ['g1'], sw: [], target: 'yN4' } })).toThrow(/forfeited/);
    // Phase bookkeeping is cleared at the end of the DFPh.
    const s = act(engine, t.state, { type: 'endPhase' }).state;
    expect(s.pieces['g1']!.tags['swDestroyed']).toBeUndefined();
    expect(s.pieces['g1']!.tags['firedSw']).toBeUndefined();
  });

  it('a squad that destroyed one SW and fires another forfeits its own FP', () => {
    const { engine, state } = makeEngine({
      startPhase: 'PFPh',
      dice: [3, 2],
      pieces: [
        { id: 'a1', def: 'am.666', side: 'am', hex: 'yN4' },
        { id: 'aLMG', def: 'ru.LMG', side: 'am', heldBy: 'a1' },
        { id: 'aMMG', def: 'ru.MMG', side: 'am', heldBy: 'a1' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
    });
    const s = act(engine, state, { type: 'sw.destroy', sw: 'aLMG' }).state;
    expect(() => act(engine, s, { type: 'fire', decl: { units: ['a1'], sw: ['aMMG'], target: 'yO5' } })).toThrow(/forfeits its own FP/);
    const t = act(engine, s, { type: 'fire', decl: { units: [], sw: ['aMMG'], target: 'yO5' } });
    expect(t.state.pieces['a1']!.tags['ownFpForfeit']).toBe(true);
  });
});

describe('Voluntary Gun destruction (SK4 1.2.6: Guns are destroyed as if a SW)', () => {
  it('a squad holding a captured, malfunctioned Gun may wreck it in its PFPh, as a weapon use; an unpossessed Gun may not be', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra: sk2CoreModules,
      startPhase: 'PFPh',
      pieces: [
        { id: 'g1', def: 'ge.447', side: 'ge', hex: 'yN4' },
        { id: 'how', def: 'br.AT57L', side: 'ge', heldBy: 'g1', tags: { malf: true, emplaced: true, ca: 1 } },
        { id: 'g2', def: 'ge.447', side: 'ge', hex: 'yN6' },
        { id: 'loose', def: 'br.AT57L', side: 'br', hex: 'yN6', tags: { emplaced: true, ca: 1 } },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yP9' },
      ],
    });
    expect(() => act(engine, state, { type: 'sw.destroy', sw: 'loose' })).toThrow(/Not a possessed SW or Gun/);
    let s = act(engine, state, { type: 'sw.destroy', sw: 'how' }).state;
    expect(s.pieces['how']!.loc).toEqual({ kind: 'eliminated' });
    expect(s.pieces['g1']!.tags).toMatchObject({ firedSw: true, swDestroyed: 1 });
    // A use of a weapon in the PFPh: the squad is marked with it at the phase's end and does not move (SK1 3.2.2).
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('MPh');
    expect(() => act(engine, s, { type: 'move.start', units: ['g1'] })).toThrow(/fired in the PFPh/);
    // Into the next German Player Turn: every record of it is gone and the squad moves.
    for (let i = 0; i < 40 && !(s.turn === 2 && s.attacker === 'ge' && s.phase === 'MPh'); i++) s = act(engine, s, { type: 'endPhase' }).state;
    expect([s.turn, s.attacker, s.phase]).toEqual([2, 'ge', 'MPh']);
    for (const k of ['fire', 'firedSw', 'firedSwAs', 'swDestroyed']) expect(s.pieces['g1']!.tags[k]).toBeUndefined();
    expect(() => act(engine, s, { type: 'move.start', units: ['g1'] })).not.toThrow();
  });
});

describe('Dropping a Gun at the start of the MPh (SK4 4.0)', () => {
  it('a squad holding a captured Gun it cannot move drops it before moving, then moves and places its DC', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra: sk2CoreModules,
      startPhase: 'MPh',
      pieces: [
        { id: 'g1', def: 'ge.447', side: 'ge', hex: 'yN4' },
        { id: 'aa', def: 'br.AA40L', side: 'ge', heldBy: 'g1', tags: { emplaced: true, ca: 1 } },
        { id: 'dc', def: 'ge.DC', side: 'ge', heldBy: 'g1' },
        { id: 'lmg', def: 'ge.LMG', side: 'ge', heldBy: 'g1' },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yN6' },
      ],
    });
    // With the Gun it may not start ("drop it first"), and until now it could not drop it without starting.
    expect(() => act(engine, state, { type: 'move.start', units: ['g1'] })).toThrow(/drop it first/);
    let s = act(engine, state, { type: 'move.drop', sw: 'aa' }).state;
    expect(s.pieces['aa']!.loc).toEqual({ kind: 'hex', hex: 'yN4' });
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ge' });
    s = act(engine, s, { type: 'move.start', units: ['g1'] }).state;
    const pass = () => {
      while (engine.currentDecision(s)!.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    };
    s = act(engine, s, { type: 'move.step', to: 'yN5' }).state;
    pass();
    s = act(engine, s, { type: 'move.placeDc', dc: 'dc', target: 'yN6' }).state;
    pass();
    expect(s.pieces['dc']!.loc.kind).not.toBe('held');
    // Once it has moved, the start-of-phase drop is no longer open to it.
    if (moveState(engine.env(s))) s = act(engine, s, { type: 'move.end' }).state;
    pass();
    expect(engine.validate(s, { type: 'move.drop', sw: 'lmg', side: 'ge', decisionId: engine.currentDecision(s)!.id } as never)).toMatch(/already moved/);
    // The Gun stays in N4, unpossessed: a unit must recover it to hold it again (SK4 4.0).
    expect(s.pieces['aa']!.loc).toEqual({ kind: 'hex', hex: 'yN4' });
  });
});

describe('SW of a unit killed by a KIA (SK1 4.0)', () => {
  it('each possessed SW rolls a dr on the attack column: KIA destroys it, K malfunctions it, anything else spares it', () => {
    const { engine, state } = makeEngine({
      startPhase: 'PFPh',
      // 7 FP at range 2 is the 6 column; DR 1+1 directed by the 9-1 (no cowering) is a final 1: 2KIA.
      // Then one dr per SW (sorted by id) on the 6 column: 1 → KIA, 3 → K, 6 → nothing.
      dice: [1, 1, 1, 3, 6],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN4' },
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN6' },
        { id: 'gA', def: 'ge.LMG', side: 'ge', heldBy: 'g1' },
        { id: 'gB', def: 'ge.MMG', side: 'ge', heldBy: 'g1' },
        { id: 'gC', def: 'ge.LMG', side: 'ge', heldBy: 'g1' },
      ],
    });
    const t = act(engine, state, { type: 'fire', decl: { units: ['a1'], sw: [], target: 'yN6', directors: ['aL'] } });
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { column: number; cowered: boolean };
    expect(attack).toMatchObject({ column: 6, cowered: false });
    expect(t.state.pieces['g1']!.loc).toEqual({ kind: 'eliminated' });
    expect(t.state.pieces['gA']!.loc).toEqual({ kind: 'eliminated' });
    expect(t.state.pieces['gB']!.loc).toEqual({ kind: 'hex', hex: 'yN6' });
    expect(t.state.pieces['gB']!.tags['malf']).toBe(true);
    expect(t.state.pieces['gC']!.loc).toEqual({ kind: 'hex', hex: 'yN6' });
    expect(t.state.pieces['gC']!.tags['malf']).toBeUndefined();
  });
});

describe('SW uses per phase (SK1 4.0)', () => {
  // A HS must not fire its HMG and its LMG in separate attacks of one fire phase. A HS may fire
  // one SW and a squad two: the limit counts the SW it fired in earlier attacks of the phase, not only this attack.
  const game = (holder: string) =>
    makeEngine({
      scenario: RU_VS_GE,
      startPhase: 'PFPh',
      // DR 5+4: no effect, no ROF kept (colored 4 exceeds every ROF here) and below every B#.
      dice: [5, 4, 5, 4, 5, 4, 5, 4],
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yM6' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yN6' },
        { id: 'r', def: holder, side: 'ru', hex: 'yM8' },
        { id: 'lmg', def: 'ru.LMG', side: 'ru', heldBy: 'r' },
        { id: 'mmg', def: 'ru.MMG', side: 'ru', heldBy: 'r' },
      ],
    });
  const fire = (engine: Engine, s: GameState, sw: string[], target: string) =>
    engine.validate(s, { type: 'fire', decl: { units: [], sw, target }, side: 'ru', decisionId: engine.currentDecision(s)!.id } as never);

  it('a half-squad that fired one SW cannot fire its other SW in another attack that phase', () => {
    const { engine, state } = game('ru.237');
    expect(fire(engine, state, ['lmg'], 'yM6')).toBeNull();
    const s = act(engine, state, { type: 'fire', decl: { units: [], sw: ['lmg'], target: 'yM6' } }).state;
    expect(fire(engine, s, ['mmg'], 'yN6')).toMatch(/half-squad may fire only one weapon per phase/);
  });

  it('a squad may fire its second SW in another attack', () => {
    const { engine, state } = game('ru.447');
    const s = act(engine, state, { type: 'fire', decl: { units: [], sw: ['lmg'], target: 'yM6' } }).state;
    expect(fire(engine, s, ['mmg'], 'yN6')).toBeNull();
  });

  // A Para squad's FT after the squad fired. Its own FP and a SW may fire separately (SK1
  // 3.2), but a unit that used its own FP can no longer forfeit it to fire a SW it could only fire by forfeiting it.
  it('a squad that fired its own FP may fire one SW in another attack, not two', () => {
    const { engine, state } = game('ru.447');
    let s = act(engine, state, { type: 'fire', decl: { units: ['r'], sw: [], target: 'yM6' } }).state;
    expect(fire(engine, s, ['lmg', 'mmg'], 'yN6')).toMatch(/squad that fired its own FP may not then fire two SW/);
    expect(fire(engine, s, ['lmg'], 'yN6')).toBeNull();
    s = act(engine, s, { type: 'fire', decl: { units: [], sw: ['lmg'], target: 'yN6' } }).state;
    expect(fire(engine, s, ['mmg'], 'yN6')).toMatch(/squad that fired its own FP may not then fire two SW/);
  });

  it('a half-squad that fired its own FP may not then fire a SW', () => {
    const { engine, state } = game('ru.237');
    const s = act(engine, state, { type: 'fire', decl: { units: ['r'], sw: [], target: 'yM6' } }).state;
    expect(fire(engine, s, ['lmg'], 'yN6')).toMatch(/half-squad that fired its own FP may not then fire a weapon/);
  });
});
