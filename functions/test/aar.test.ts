import { describe, expect, it } from 'vitest';
import { aarDue } from '../src/lib/aarDoc';

/** When a match document update is the moment its after action report is written (`writeAarOnComplete`). */
describe('aarDue', () => {
  const result = { winner: 'am', reason: 'victory conditions', winnerUid: 'u1', loserUid: 'computer' };
  it('is the transition to complete of a public match', () => {
    expect(aarDue({ status: 'active' }, { status: 'complete', result, visibility: 'public' })).toBe(true);
    expect(aarDue({ status: 'active' }, { status: 'complete', result })).toBe(true);
  });
  it('is not a private game, an unfinished one, a repeat update of a complete one, or an abandoned one', () => {
    expect(aarDue({ status: 'active' }, { status: 'complete', result, visibility: 'private' })).toBe(false);
    expect(aarDue({ status: 'active' }, { status: 'active', result: null, visibility: 'public' })).toBe(false);
    expect(aarDue({ status: 'complete' }, { status: 'complete', result, visibility: 'public' })).toBe(false);
    expect(aarDue({ status: 'active' }, { status: 'abandoned', result: null, visibility: 'public' })).toBe(false);
    expect(aarDue(undefined, undefined)).toBe(false);
  });
});
