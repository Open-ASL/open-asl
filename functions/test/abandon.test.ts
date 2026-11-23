import { describe, expect, it } from 'vitest';
import { abandonedPatch } from '../src/lib/abandon';

/** An online match under way that ends before its official threshold, or that no longer replays. */
describe('abandonedPatch', () => {
  const match = { summary: { turn: 4, phase: 'AFPh', attacker: 'ge', seq: 3383, toMove: 'ge' } };

  it('records who ended the match and how, with no result and the clock stopped', () => {
    expect(abandonedPatch(match, { by: 'u1', reason: 'concession' }, 7)).toEqual({
      status: 'abandoned',
      official: false,
      result: null,
      ended: { by: 'u1', reason: 'concession' },
      summary: { turn: 4, phase: 'AFPh', attacker: 'ge', seq: 3383, toMove: null },
      deadline: null,
      updatedAt: 7,
      completedAt: 7,
    });
  });
});
