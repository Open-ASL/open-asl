import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { activeRout } from '@asl/rules';
import { act, makeEngine } from '../../../packages/rules/test/fixtures';
import { routWaitHint } from '../src/game/routWait';

const stepTo = (engine: Engine, s: GameState, unit: string, to: string) =>
  engine.legalActions(s, 'am').find((a) => a.type === 'rout.step' && a['unit'] === unit && a['to'] === to && !a['lowCrawl']);

/*
 * Routs are walked one at a time. A router that stops short of its ROUT END (a building that is not the nearest shelter, or
 * Open Ground) is still routing, and the other broken units wait for it: their wheel says so, naming the router and the
 * hex it must still reach (SK1 3.6), rather than offering nothing.
 */
describe('a broken unit waiting for another rout to end', () => {
  // Board y. N5 is open, in the LOS of the German squad in P5; the Woods-Road hex M6 is the nearest shelter. The stone
  // building M5 costs 2 MF: the rout may pass through it on the way to M6, but not end there.
  const setup = () =>
    makeEngine({
      startPhase: 'RtPh',
      terrain: { yM6: { terrain: 'woods', features: ['road:dirt', 'woods-road'] }, yM5: { terrain: 'building-stone', buildingId: 'b-M5' }, yN5: { terrain: 'open', features: ['road:dirt'] } },
      roadHexsides: [['yN5', 'yM6']],
      pieces: [
        { id: 'r', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'b', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
    });

  it('names the router, where it stands and the ROUT END it must still reach', () => {
    const { engine, state } = setup();
    expect(routWaitHint(engine.env(state), 'b')).toBeNull();
    const inBuilding = act(engine, state, stepTo(engine, state, 'r', 'yM5')!).state;
    const env = engine.env(inBuilding);
    expect(activeRout(env)?.unit).toBe('r');
    // The engine refuses the other unit's rout until this one is over.
    expect(engine.legalActions(inBuilding, 'am').some((a) => a.type === 'rout.step' && a['unit'] === 'b')).toBe(false);
    expect(routWaitHint(env, 'b')).toMatch(/^The American 7.*-4-7 in M5 is still routing: it must go on into M6 \(ROUT END\) before another unit may rout$/);
    // Not for the router itself: its own panel says where to go.
    expect(routWaitHint(env, 'r')).toBeNull();
  });

  it('is gone once the router reaches its ROUT END, and the other unit may rout', () => {
    const { engine, state } = setup();
    const inBuilding = act(engine, state, stepTo(engine, state, 'r', 'yM5')!).state;
    let there = act(engine, inBuilding, stepTo(engine, inBuilding, 'r', 'yM6')!).state;
    const stop = engine.legalActions(there, 'am').find((a) => a.type === 'rout.stop');
    if (stop) there = act(engine, there, stop).state;
    expect(routWaitHint(engine.env(there), 'b')).toBeNull();
    expect(engine.legalActions(there, 'am').some((a) => a.type === 'rout.step' && a['unit'] === 'b')).toBe(true);
  });
});
