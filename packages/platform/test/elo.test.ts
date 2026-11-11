import { describe, expect, it } from 'vitest';
import { ELO_FLOOR, eloUpdate, expectedScore } from '../src/elo';

describe('elo', () => {
  it('is zero-sum and symmetric at equal ratings', () => {
    const r = eloUpdate(1200, 1200, 1);
    expect(r.a).toBe(1216);
    expect(r.b).toBe(1184);
    expect(r.delta).toBe(16);
    expect(r.a + r.b).toBe(2400);
  });
  it('rewards upsets more than expected wins', () => {
    const upset = eloUpdate(1200, 1600, 1);
    const expected = eloUpdate(1600, 1200, 1);
    expect(upset.delta).toBeGreaterThan(expected.delta);
  });
  it('a draw moves points toward the lower-rated player', () => {
    const r = eloUpdate(1600, 1200, 0.5);
    expect(r.a).toBeLessThan(1600);
    expect(r.b).toBeGreaterThan(1200);
  });
  it('never drops below the floor', () => {
    expect(eloUpdate(ELO_FLOOR, 1200, 0).a).toBe(ELO_FLOOR);
  });
  it('expected score is a probability', () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5);
    expect(expectedScore(1600, 1200)).toBeGreaterThan(0.9);
  });
});
