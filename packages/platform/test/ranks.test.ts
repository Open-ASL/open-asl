import { describe, expect, it } from 'vitest';
import { RANKS, nextRank, rankFor } from '../src/ranks';
import { XP } from '../src/xp';

describe('ranks', () => {
  it('promotion gaps keep growing from Private at 0', () => {
    expect(RANKS[0]!.minXp).toBe(0);
    let previousGap = 0;
    for (let i = 1; i < RANKS.length; i++) {
      const gap = RANKS[i]!.minXp - RANKS[i - 1]!.minXp;
      expect(gap).toBeGreaterThan(previousGap);
      previousGap = gap;
    }
  });
  it('picks the highest rank reached', () => {
    expect(rankFor(0).id).toBe('pvt');
    expect(rankFor(99).id).toBe('pvt');
    expect(rankFor(100).id).toBe('pfc');
    expect(rankFor(4400).id).toBe('2lt');
    expect(rankFor(1e6).id).toBe('ga');
  });
  it('reports the next rank and progress', () => {
    const n = nextRank(200)!;
    expect(n.rank.id).toBe('cpl');
    expect(n.remaining).toBe(100);
    expect(n.progress).toBeCloseTo(100 / 200);
    expect(nextRank(41100)).toBeNull();
  });
  it('starts quickly but takes about nine months of daily wins to reach the top rank', () => {
    expect(RANKS[1]!.minXp).toBeLessThanOrEqual(XP.onlineWin);
    expect(RANKS[2]!.minXp).toBeLessThanOrEqual(XP.onlineWin * 2);
    expect(RANKS[3]!.minXp).toBeLessThanOrEqual(XP.onlineWin * 5);
    expect(RANKS.at(-1)!.minXp).toBeGreaterThanOrEqual(XP.onlineWin * 270);
    expect(RANKS.at(-1)!.minXp).toBeLessThanOrEqual(XP.onlineWin * 280);
  });
});
