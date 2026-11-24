import { describe, expect, it } from 'vitest';
import type { UserDoc } from '@asl/platform';
import { requireAvailable } from '../src/lib/users';

/** A player who has set themselves not available takes no challenge; everyone else does. */
describe('requireAvailable', () => {
  const user = (notAvailable?: boolean) => ({ activeMatchId: null, ...(notAvailable === undefined ? {} : { notAvailable }) }) as UserDoc;
  it('lets a challenge through to a player who has not set the flag, or has cleared it', () => {
    expect(() => requireAvailable(user())).not.toThrow();
    expect(() => requireAvailable(user(false))).not.toThrow();
  });
  it('refuses a challenge to a player who is not available, saying why', () => {
    expect(() => requireAvailable(user(true))).toThrow(/not available for challenges/);
  });
});
