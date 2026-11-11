import { describe, expect, it } from 'vitest';
import { MIRROR, rollDie, seedRng, type RngState } from '../src';

const dice = (rng: RngState, n: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const [v, next] = rollDie(rng);
    out.push(v);
    rng = next;
  }
  return out;
};

describe('antithetic dice', () => {
  it('turns every die of the seed over, roll for roll', () => {
    const plain = dice(seedRng('abc'), 200);
    const twin = dice(seedRng(`abc${MIRROR}`), 200);
    expect(twin).toEqual(plain.map((v) => 7 - v));
  });

  it('leaves other seeds as they were', () => {
    expect(seedRng('abc')).toEqual(seedRng('abc'));
    expect(seedRng('abc').mirror).toBeUndefined();
  });
});
