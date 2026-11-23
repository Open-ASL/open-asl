import { describe, expect, it } from 'vitest';
import { abandonedText } from '../src/match/abandoned';

describe('abandonedText', () => {
  const seats = { am: { uid: 'u1', displayName: 'Able' }, ge: { uid: 'u2', displayName: 'Baker' } };

  it('tells the player who stayed that the opponent conceded before the halfway point, and what that means', () => {
    const text = abandonedText({ status: 'abandoned', seats, ended: { by: 'u2', reason: 'concession' } }, 'u1');
    expect(text).toMatch(/^Baker conceded before the match reached its halfway point/);
    expect(text).toMatch(/no battle record and no after action report/);
    expect(abandonedText({ status: 'abandoned', seats, ended: { by: 'u2', reason: 'concession' } }, 'u2')).toMatch(/^You conceded/);
  });

  it('names a win claimed early on a lapsed clock and a match closed for the rules', () => {
    expect(abandonedText({ status: 'abandoned', seats, ended: { by: 'u1', reason: 'timeout' } }, null)).toMatch(/^Able claimed the win on a lapsed clock before/);
    expect(abandonedText({ status: 'abandoned', seats, ended: { by: 'u1', reason: 'ruleset' } }, 'u2')).toMatch(/^Able closed the match/);
  });

  it('says only "Abandoned." for an older match that does not record how it ended', () => {
    expect(abandonedText({ status: 'abandoned', seats }, 'u1')).toBe('Abandoned.');
  });
});
