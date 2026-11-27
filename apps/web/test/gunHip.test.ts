import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { sk2CoreModules } from '@asl/rules';
import { GE_VS_BR, makeEngine } from '../../../packages/rules/test/fixtures';
import { setupHip } from '../src/game/gunHip';

/** A British Gun and its crew, still to be set up; yM5 is open ground, yM6 has a paved road. */
function game() {
  return makeEngine({
    scenario: GE_VS_BR,
    extra: sk2CoreModules,
    startPhase: 'PFPh',
    terrain: { yM6: { terrain: 'open', features: ['road:paved'] } },
    pieces: [
      { id: 'c1', def: 'br.228c', side: 'br', hex: 'yM5' },
      { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'c1', tags: { ca: 0, emplaced: true } },
    ],
  }) as { engine: Engine; state: GameState };
}

describe('a Gun set up by hand hides by default (SK4 6.4)', () => {
  it('is hidden where HIP is allowed, unless the player sets it up in the open', () => {
    const { engine, state } = game();
    const env = engine.env(state);
    expect([...setupHip(env, ['g40'], { g40: 'yM5' }, new Set())]).toEqual(['g40']);
    expect([...setupHip(env, ['g40'], { g40: 'yM5' }, new Set(['g40']))]).toEqual([]);
  });

  it('is never hidden on a paved road, nor before it is placed', () => {
    const { engine, state } = game();
    const env = engine.env(state);
    expect([...setupHip(env, ['g40'], { g40: 'yM6' }, new Set())]).toEqual([]);
    expect([...setupHip(env, ['g40'], {}, new Set())]).toEqual([]);
  });
});
