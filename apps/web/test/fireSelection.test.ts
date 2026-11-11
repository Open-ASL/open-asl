import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, PieceId } from '@asl/engine';
import { ALL_SCENARIOS, newSk1Game } from '@asl/content';
import { defOf } from '@asl/rules';
import { act, makeEngine } from '../../../packages/rules/test/fixtures';
import { fireSelectable } from '../src/game/fireSelection';

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
});
