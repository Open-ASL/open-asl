import { describe, expect, it } from 'vitest';
import { seatNames } from '../src/match/seatNames';

describe('seatNames', () => {
  it('names each seated player, the computer by its seat name, and leaves an open seat out', () => {
    expect(seatNames({ mode: 'computer', seats: { am: { uid: 'u1', displayName: 'Alice' }, ge: { uid: 'computer', displayName: 'Computer' } } })).toEqual({ am: 'Alice', ge: 'Computer' });
    expect(seatNames({ mode: 'online', seats: { am: { uid: 'u1', displayName: 'Alice' }, ge: null } })).toEqual({ am: 'Alice' });
  });

  it('names nobody in a hotseat game, where one account plays both sides', () => {
    expect(seatNames({ mode: 'hotseat', seats: { am: { uid: 'u1', displayName: 'Alice' }, ge: { uid: 'u1', displayName: 'Alice' } } })).toBeUndefined();
  });
});
