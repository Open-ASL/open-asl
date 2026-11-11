import { describe, expect, it } from 'vitest';
import { DEFAULT_PACE, allowanceMs, availablePace, formatLeft, paceDef } from '../src/clock';

describe('clock', () => {
  it('falls back to the default pace for unknown or missing paces', () => {
    expect(paceDef(undefined).id).toBe(DEFAULT_PACE);
    expect(paceDef('nope' as never).id).toBe(DEFAULT_PACE);
  });
  it('the default pace can actually be chosen', () => {
    expect(availablePace(DEFAULT_PACE)).toBe(true);
  });
  it('gives interrupts less time than turns at every pace', () => {
    for (const p of ['live', 'daily'] as const) expect(allowanceMs(p, 'interrupt')).toBeLessThan(allowanceMs(p, 'turn'));
  });
  it('formats what is left', () => {
    expect(formatLeft(9 * 60_000 + 41_000)).toBe('9:41');
    expect(formatLeft(5 * 3600_000)).toBe('5 h 0 min');
    expect(formatLeft(2 * 86400_000 + 3 * 3600_000)).toBe('2 d 3 h');
    expect(formatLeft(-5)).toBe('0:00');
  });
});
