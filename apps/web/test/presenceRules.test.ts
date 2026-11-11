import { describe, expect, it } from 'vitest';
import { HEARTBEAT_MS, STALE_MS, connectionPresent, presentUids } from '../src/lobby-v2/presenceRules';

describe('lobby presence', () => {
  const now = 1_800_000_000_000;

  it('counts an active lobby connection confirmed within the stale window', () => {
    expect(connectionPresent({ at: now - 1000, area: 'lobby', active: true }, now)).toBe(true);
    expect(connectionPresent({ at: now - HEARTBEAT_MS * 2, area: 'lobby', active: true }, now)).toBe(true);
  });

  it('drops a tab marked away, a tab in a match, and one whose heartbeat stopped', () => {
    expect(connectionPresent({ at: now - 1000, area: 'lobby', active: false }, now)).toBe(false);
    expect(connectionPresent({ at: now - 1000, area: 'match', active: true }, now)).toBe(false);
    expect(connectionPresent({ at: now - STALE_MS - 1, area: 'lobby', active: true }, now)).toBe(false);
    expect(connectionPresent(null, now)).toBe(false);
    expect(connectionPresent({ area: 'lobby', active: true }, now)).toBe(false);
  });

  it('keeps an older client that never writes active only while its node is fresh', () => {
    expect(connectionPresent({ at: now - 1000, area: 'lobby' }, now)).toBe(true);
    expect(connectionPresent({ at: now - STALE_MS - 1, area: 'lobby' }, now)).toBe(false);
  });

  it('lists a person once if any of their tabs is present, sorted by uid', () => {
    const tree = {
      zed: { a: { at: now - 500, area: 'lobby' as const, active: true }, b: { at: now - 500, area: 'match' as const, active: true } },
      amy: { a: { at: now - STALE_MS * 2, area: 'lobby' as const, active: true }, b: { at: now - 500, area: 'lobby' as const, active: false } },
      bob: { a: { at: now - 500, area: 'lobby' as const, active: true } },
      cat: null,
    };
    expect(presentUids(tree, now)).toEqual(['bob', 'zed']);
    expect(presentUids(null, now)).toEqual([]);
  });
});
