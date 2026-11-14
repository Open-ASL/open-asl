import { describe, expect, it } from 'vitest';
import type { VictoryCondition } from '../src';
import { settledWithout } from '../src';

// A game ends early only when nothing the side still in play does can change the result.
describe('victory conditions settled once a side has nothing left in play', () => {
  it('tallies of units lost and exited are settled; so are the departed side’s own exits', () => {
    expect(settledWithout({ kind: 'afvLead', side: 'ru', exitedCountAsEliminated: { edge: 'S' } }, 'ru')).toBe(true);
    expect(settledWithout({ kind: 'eliminateCvp', side: 'ge', cvp: 10 }, 'ru')).toBe(true);
    expect(settledWithout({ kind: 'exitVp', side: 'ru', edge: 'S', vp: 10 }, 'ru')).toBe(true);
  });

  it('Control and the other side’s exits may still change: the game goes on', () => {
    expect(settledWithout({ kind: 'controlBuildings', side: 'ge', buildings: ['b1'], atLeast: 1 }, 'ru')).toBe(false);
    expect(settledWithout({ kind: 'controlHexes', side: 'ru', hexes: ['yK5'], atLeast: 1 }, 'ru')).toBe(false);
    expect(settledWithout({ kind: 'exitVp', side: 'ge', edge: 'S', vp: 10 }, 'ru')).toBe(false);
  });

  it('a "no enemy in" condition of the side still in play is true for good; the departed side’s is not settled', () => {
    expect(settledWithout({ kind: 'noGoodOrderEnemyIn', side: 'ge', hexes: ['yK5'] }, 'ru')).toBe(true);
    expect(settledWithout({ kind: 'noGoodOrderEnemyIn', side: 'ru', hexes: ['yK5'] }, 'ru')).toBe(false);
  });

  it('a combination is settled only when every part is', () => {
    const exit: VictoryCondition = { kind: 'exitVp', side: 'ru', edge: 'S', vp: 10 };
    expect(settledWithout({ kind: 'any', side: 'ru', of: [exit, { kind: 'afvLead', side: 'ru' }] }, 'ru')).toBe(true);
    expect(settledWithout({ kind: 'any', side: 'ru', of: [exit, { kind: 'controlHexes', side: 'ru', hexes: ['yK5'], atLeast: 1 }] }, 'ru')).toBe(false);
  });
});
