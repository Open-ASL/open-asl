import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, Piece, PieceId } from '@asl/engine';
import { ALL_SCENARIOS, DEMO_VEHICLES_SCENARIO, newGame, newSk1Game } from '@asl/content';
import { defOf } from '@asl/rules';
import { act, makeEngine } from '../../../packages/rules/test/fixtures';
import { aimsAt, beyondRange, fireLeaders, fireSelectable, swCarriers, withinRange } from '../src/game/fireSelection';

/** The click selection the game screen makes on `side`'s stack in `hex` (GameScreen selectableAt, fire phases). */
const selection = (engine: Engine, state: GameState, side: string, hex: string): PieceId[] => {
  const env = engine.env(state);
  const here = Object.values(state.pieces).filter(
    (p) => p.side === side && (p.loc.kind === 'hex' || p.loc.kind === 'offboard') && p.loc.hex === hex && !['sw', 'gun'].includes(defOf(env, p).kind),
  );
  return fireSelectable(env, here, { firstFire: engine.currentDecision(state)?.kind === 'firstFire', phase: state.phase });
};

describe('fire selection (what a click on an own stack picks up)', () => {
  // An American squad with a captured MMG (ROF 2, 1 when captured) in the PFPh, a German squad two hexes away.
  const pieces = [
    { id: 'a1', def: 'am.666', side: 'am', hex: 'yP5' },
    { id: 'aMMG', def: 'ge.MMG', side: 'am', heldBy: 'a1' },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN5' },
  ];
  const opts = { pieces, terrain: { yN5: { terrain: 'building-stone' } } };
  const shoot = { type: 'fire', decl: { units: ['a1'], sw: ['aMMG'], target: 'yN5' } };

  it('a MG that kept Rate of Fire is still offered once its squad has fired, and fires alone', () => {
    // DR 2+1: colored 1 ≤ ROF 1, no doubles (the target's MC 6+6). Then 3+4 for the second shot (a captured MMG's 12 would remove it, A.11).
    const { engine, state } = makeEngine({ ...opts, dice: [2, 1, 6, 6, 3, 4, 6, 6], startPhase: 'PFPh' }) as { engine: Engine; state: GameState };
    expect(engine.currentDecision(state)!.owner).toBe('am');
    expect(selection(engine, state, 'am', 'yP5')).toEqual(['a1', 'aMMG']);
    const t = act(engine, state, shoot);
    expect(t.state.pieces['aMMG']!.tags['fire']).toBeUndefined();
    const again = selection(engine, t.state, 'am', 'yP5');
    expect(again).toEqual(['aMMG']);
    const t2 = act(engine, t.state, { type: 'fire', decl: { units: [], sw: again, target: 'yN5' } });
    expect(t2.state.pieces['aMMG']!.tags['fire']).toBe('prep');
    expect(selection(engine, t2.state, 'am', 'yP5')).toEqual([]);
  });

  it('the leader who directed the squad and its MG is offered to direct the MG again on the ROF it kept (ASLRB A7.53)', () => {
    const { engine, state } = makeEngine({
      pieces: [...pieces, { id: 'aL', def: 'am.L91', side: 'am', hex: 'yP5' }],
      terrain: opts.terrain,
      dice: [2, 1, 6, 6, 3, 4, 6, 6],
      startPhase: 'PFPh',
    }) as { engine: Engine; state: GameState };
    const t = act(engine, state, { ...shoot, decl: { ...shoot.decl, directors: ['aL'] } });
    expect(t.state.pieces['aL']!.tags['fire']).toBe('prep');
    const env = engine.env(t.state);
    const own = selection(engine, t.state, 'am', 'yP5');
    expect(own).toEqual(['aMMG']);
    // Marked Prep Fire, he is no longer selectable, yet the Fire entry still offers him.
    expect(fireLeaders(env, [t.state.pieces['aL']!], own, own).map((l) => l.id)).toEqual(['aL']);
    const t2 = act(engine, t.state, { type: 'fire', decl: { units: [], sw: own, target: 'yN5', directors: ['aL'] } });
    expect(t2.state.pieces['aMMG']!.tags['fire']).toBe('prep');
  });

  it('the leader is offered again for the ROF shot of a MG whose half-squad fired only the MG (SK1 4.0, ASLRB A7.53)', () => {
    // A HS fires its MMG directed: the MG keeps ROF; the HS, its own FP forfeit, is still ticked with the MG it carries.
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'h1', def: 'am.348h', side: 'am', hex: 'yP5' },
        { id: 'hMMG', def: 'am.MMG', side: 'am', heldBy: 'h1' },
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yP5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN5' },
      ],
      terrain: opts.terrain,
      dice: [2, 1, 6, 6, 3, 4, 6, 6],
      startPhase: 'PFPh',
    }) as { engine: Engine; state: GameState };
    const t = act(engine, state, { type: 'fire', decl: { units: [], sw: ['hMMG'], target: 'yN5', directors: ['aL'] } });
    expect(t.state.pieces['hMMG']!.tags['fire']).toBeUndefined();
    expect(t.state.pieces['h1']!.tags['ownFpForfeit']).toBe(true);
    const own = selection(engine, t.state, 'am', 'yP5');
    expect(own).toEqual(['h1', 'hMMG']);
    expect(swCarriers(engine.env(t.state), own)).toEqual(['h1']);
    expect(fireLeaders(engine.env(t.state), [t.state.pieces['aL']!], own, own).map((l) => l.id)).toEqual(['aL']);
    const t2 = act(engine, t.state, { type: 'fire', decl: { units: [], sw: ['hMMG'], target: 'yN5', directors: ['aL'] } });
    expect(t2.state.pieces['hMMG']!.tags['fire']).toBe('prep');
  });

  it('a marked leader is not offered for a shot that is not a kept-ROF weapon firing alone', () => {
    const { engine, state } = makeEngine({
      pieces: [...pieces, { id: 'aL', def: 'am.L91', side: 'am', hex: 'yP5' }],
      terrain: opts.terrain,
      dice: [1, 2, 6, 6, 6, 6],
      startPhase: 'PFPh',
    }) as { engine: Engine; state: GameState };
    // The squad fires alone, directed: its MMG has not fired and has no ROF to use.
    const t = act(engine, state, { type: 'fire', decl: { units: ['a1'], sw: [], target: 'yN5', directors: ['aL'] } });
    const own = selection(engine, t.state, 'am', 'yP5');
    expect(own).toEqual(['aMMG']);
    expect(fireLeaders(engine.env(t.state), [t.state.pieces['aL']!], own, own)).toEqual([]);
  });

  it('a MG that lost Rate of Fire is not offered again', () => {
    const { engine, state } = makeEngine({ ...opts, dice: [1, 5, 6, 6, 6, 6], startPhase: 'PFPh' }) as { engine: Engine; state: GameState };
    const t = act(engine, state, shoot);
    expect(t.state.pieces['aMMG']!.tags['fire']).toBe('prep');
    expect(selection(engine, t.state, 'am', 'yP5')).toEqual([]);
  });

  it('a squad that fired without its MG still offers the MG, for a separate attack (SK1 3.2)', () => {
    const { engine, state } = makeEngine({ ...opts, dice: [1, 2, 6, 6, 6, 6], startPhase: 'PFPh' }) as { engine: Engine; state: GameState };
    const t = act(engine, state, { type: 'fire', decl: { units: ['a1'], sw: [], target: 'yN5' } });
    expect(selection(engine, t.state, 'am', 'yP5')).toEqual(['aMMG']);
  });

  it('a squad beyond its range of the target is left out, and the MG it holds fires alone (SK1 3.2, 4.0)', () => {
    // A 4-4-7 (range 4, Long Range 8) with a MMG (range 10) 10 hexes from the target.
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'a1', def: 'am.447', side: 'am', hex: 'yF5' },
        { id: 'aMMG', def: 'am.MMG', side: 'am', heldBy: 'a1' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
      dice: [3, 4, 6, 6],
      startPhase: 'PFPh',
    }) as { engine: Engine; state: GameState };
    const env = engine.env(state);
    expect(selection(engine, state, 'am', 'yF5')).toEqual(['a1', 'aMMG']);
    const whole = { units: ['a1'], sw: ['aMMG'], target: 'yP5' };
    expect(beyondRange(env, whole)).toEqual(['a1']);
    expect(env.query('fire.illegal', { decl: whole, mode: 'prep', side: 'am' }, null)).toMatch(/out of range/);
    const alone = { units: [], sw: ['aMMG'], target: 'yP5' };
    expect(env.query('fire.illegal', { decl: alone, mode: 'prep', side: 'am' }, null)).toBeNull();
    const t = act(engine, state, { type: 'fire', decl: alone });
    expect(t.state.pieces['aMMG']!.tags['fire']).toBe('prep');
    // Within its Long Range the squad stays in the group.
    expect(beyondRange(env, { units: ['a1'], target: 'yN5' })).toEqual([]);
  });

  it('in the AFPh, squads beyond range that carried a MMG leave their LMG to fire alone (SK1 3.2, 3.5, 4.0)', () => {
    // Two 4-4-7 (Long Range 8) that moved, 9 hexes from the target: one with a MMG, which may not fire in the AFPh
    // after moving, the other with a captured LMG (range 8, Long Range 16).
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'a1', def: 'am.447', side: 'am', hex: 'yF5', tags: { moved: true } },
        { id: 'aMMG', def: 'am.MMG', side: 'am', heldBy: 'a1', tags: { moved: true } },
        { id: 'a2', def: 'am.447', side: 'am', hex: 'yF5', tags: { moved: true } },
        { id: 'aLMG', def: 'ge.LMG', side: 'am', heldBy: 'a2' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
      dice: [3, 4, 6, 6],
      startPhase: 'AFPh',
    }) as { engine: Engine; state: GameState };
    const env = engine.env(state);
    const illegal = (decl: { units: string[]; sw: string[]; target: string }) => env.query('fire.illegal', { decl, mode: 'advancing', side: 'am' }, null);
    expect(selection(engine, state, 'am', 'yF5')).toEqual(['a1', 'aMMG', 'a2', 'aLMG']);
    // Neither the MMG nor the squads leave alone a group that may fire; both together do.
    expect(illegal({ units: ['a1', 'a2'], sw: ['aMMG', 'aLMG'], target: 'yO5' })).toMatch(/moved cannot fire in the AFPh/);
    const noMmg = { units: ['a1', 'a2'], sw: ['aLMG'], target: 'yO5' };
    expect(illegal(noMmg)).toMatch(/out of range/);
    expect(illegal({ units: [], sw: ['aMMG', 'aLMG'], target: 'yO5' })).toMatch(/moved cannot fire in the AFPh/);
    const lmg = withinRange(env, noMmg);
    expect(lmg).toEqual({ units: [], sw: ['aLMG'], target: 'yO5' });
    expect(illegal(lmg)).toBeNull();
    const t = act(engine, state, { type: 'fire', decl: lmg });
    expect(t.state.pieces['aLMG']!.tags['fire']).toBeTruthy();
  });

  it('a Para squad that fired its own FP still offers its FT', () => {
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN4' },
        { id: 'aFT', def: 'ge.FT', side: 'am', heldBy: 'a1' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN5' },
      ],
      dice: [6, 5, 6, 6, 6, 6],
      startPhase: 'PFPh',
    }) as { engine: Engine; state: GameState };
    const t = act(engine, state, { type: 'fire', decl: { units: ['a1'], sw: [], target: 'yN5' } });
    expect(selection(engine, t.state, 'am', 'yN4')).toEqual(['aFT']);
    expect(engine.env(t.state).query('fire.illegal', { decl: { units: [], sw: ['aFT'], target: 'yN5' }, mode: 'prep', side: 'am' }, null)).toBeNull();
  });

  // Every infantry shot the rules allow must be one a click on the stack can declare: a selection
  // filter that drops a firer the engine would accept hides a legal shot (a kept-ROF MG went missing so).
  it.each(['sk-s7', 'sk-s8', 'sk-s18', 'sk-s19'])('%s: random games never offer a legal shot the stack selection cannot make', { timeout: 120_000 }, (id) => {
    const scenario = ALL_SCENARIOS.find((s) => s.id === id)!;
    let seed = 4242;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let checked = 0;
    for (let g = 0; g < 2; g++) {
      const { engine, state: s0 } = newSk1Game(scenario, `${id}-sel-${g}`);
      let state = s0;
      for (let i = 0; i < 4000 && !state.result; i++) {
        const d = engine.currentDecision(state)!;
        const legal = engine.legalActions(state, d.owner);
        for (const a of legal as (Action & { decl?: { units: PieceId[]; sw: PieceId[] } })[]) {
          if ((a.type !== 'fire' && a.type !== 'defFire') || !a.decl) continue;
          const env = engine.env(state);
          for (const id of [...a.decl.units, ...a.decl.sw]) {
            const p = state.pieces[id]!;
            const holder = p.loc.kind === 'held' ? state.pieces[p.loc.by]! : p;
            if (holder.loc.kind !== 'hex' || defOf(env, holder).kind === 'vehicle') continue;
            expect(selection(engine, state, d.owner, holder.loc.hex), `${a.type} ${JSON.stringify(a.decl)} in ${state.phase} T${state.turn}`).toContain(id);
            checked++;
          }
        }
        // Fire-heavy random play, so MG get to fire repeatedly in a phase.
        const fires = legal.filter((a) => a.type === 'fire' || a.type === 'defFire');
        const doing = legal.filter((a) => a.type !== 'endPhase' && a.type !== 'defPass');
        const pool = fires.length && rand() < 0.6 ? fires : doing.length && rand() < 0.7 ? doing : legal;
        state = engine.submit(state, pool[Math.floor(rand() * pool.length)]!).state;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
  it("leaves a tank and its MGs out of the stack's Fire: a vehicle's MG/IFE form Fire Groups only with each other (SK4 3.2)", () => {
    // A crew with a MMG and a 9-1 stacked with a Sherman in the PFPh: the stack's Fire is the Infantry and its MMG; the
    // tank fires from its own entries (MA, MGs, IFE + MGs).
    const { engine, state: s0 } = newGame(DEMO_VEHICLES_SCENARIO, 'fs', { los: 'grid' });
    const P = (id: string, defId: string, side: string, loc: Piece['loc'], tags: Piece['tags'] = {}): [string, Piece] => [id, { id, defId, side, loc, tags }];
    const state: GameState = {
      ...s0,
      turn: 2,
      phase: 'PFPh',
      attacker: 'am',
      pieces: Object.fromEntries([
        P('crew', 'am.228c', 'am', { kind: 'hex', hex: 'yP5' }),
        P('mmg', 'am.MMG', 'am', { kind: 'held', by: 'crew' }),
        P('ldr', 'am.L91', 'am', { kind: 'hex', hex: 'yP5' }),
        P('tank', 'am.M4A3', 'am', { kind: 'hex', hex: 'yP5' }, { vca: 0, ca: 0 }),
        P('tank.bmg', 'am.M4A3.bmg', 'am', { kind: 'held', by: 'tank' }),
        P('tank.cmg', 'am.M4A3.cmg', 'am', { kind: 'held', by: 'tank' }),
        P('g1', 'ge.467', 'ge', { kind: 'hex', hex: 'yN5' }),
      ]),
      decisions: [{ id: 'd1', kind: 'phase', owner: 'am', deadlineClass: 'turn' }],
    };
    expect(selection(engine, state, 'am', 'yP5').sort()).toEqual(['crew', 'ldr', 'mmg']);
    // Alone in its hex, the tank is picked up with its MGs (its MA's IFE and MGs fire together, SK4 7.8).
    const alone = { ...state, pieces: Object.fromEntries(Object.entries(state.pieces).filter(([id]) => !['crew', 'mmg', 'ldr'].includes(id))) };
    expect(selection(engine, alone, 'am', 'yP5').sort()).toEqual(['tank', 'tank.bmg', 'tank.cmg']);
  });
});

describe('what a click aims the declared fire at (aimsAt)', () => {
  // An American squad in yP5; a lone German AFV in yN5 (Crew Exposed or not), a wreck in yM5, an empty hex yO5.
  const game = (ce: boolean) =>
    makeEngine({
      pieces: [
        { id: 'a1', def: 'am.666', side: 'am', hex: 'yP5' },
        { id: 'v', def: 'ge.pzivf2', side: 'ge', hex: 'yN5', tags: { vca: 0, ca: 0, ...(ce ? { ce: true } : {}) } },
        { id: 'w', def: 'ge.pzivf2', side: 'ge', hex: 'yM5', tags: { wreck: true } },
      ],
    });

  it('Infantry fire aims at a lone enemy AFV: a CE crew is attacked on the IFT (SK4 7.7), a BU one is not harmed but may be shot at', () => {
    for (const ce of [true, false]) {
      const { engine, state } = game(ce);
      expect(aimsAt(engine.env(state), 'yN5', 'am', null)).toBe(true);
    }
  });

  it('a Gun or PF aims at a lone AFV only on the Vehicle Target Type, never at a wreck or an empty hex', () => {
    const { engine, state } = game(true);
    const env = engine.env(state);
    expect(aimsAt(env, 'yN5', 'am', { targetType: 'VTT' })).toBe(true);
    expect(aimsAt(env, 'yN5', 'am', { targetType: 'ITT' })).toBe(false);
    expect(aimsAt(env, 'yM5', 'am', null)).toBe(false);
    expect(aimsAt(env, 'yO5', 'am', null)).toBe(false);
  });
});
