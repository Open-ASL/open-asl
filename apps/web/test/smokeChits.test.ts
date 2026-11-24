import { describe, expect, it } from 'vitest';
import { smoke58Chits } from '../src/game/smoke';

describe('⅝" Smoke counters on the board', () => {
  it('shows drifting Dispersed SMOKE on gray counters and original SMOKE on white ones (ASLRB A24.61)', () => {
    const chits = smoke58Chits({ smoke58: 'smoke@ge,smoke.d@ru,smoke.d@drift~T3~1' });
    expect(chits.map((c) => c.marker)).toEqual(['Smk3', 'Smk2', 'Smk2gr']);
    expect(chits[2]!.label).toBe('Drifting Smoke from a Blaze (+2)');
  });
});
