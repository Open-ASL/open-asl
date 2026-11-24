import { describe, expect, it } from 'vitest';
import { pillboxArtTurn } from '../src/board/BoardView';

const deg = (r: number) => (Math.round((r * 180) / Math.PI) + 360) % 360;

describe('Pillbox counter art', () => {
  it('turns so its printed arrow points at the hexspine that defines the CA (ASLRB B30.1)', () => {
    // The arrow is printed to the lower right: the south-east corner needs no turn, each corner after it 60° more.
    expect([0, 1, 2, 3, 4, 5].map((ca) => deg(pillboxArtTurn(ca)))).toEqual([300, 0, 60, 120, 180, 240]);
  });
});
