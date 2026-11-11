export const ELO_DEFAULT = 1200;
export const ELO_FLOOR = 100;
export const ELO_K = 32;

/** Probability that a player rated `a` beats one rated `b`. */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/**
 * New ratings after a game. `scoreA` is 1 for a win by A, 0.5 for a draw, 0 for a loss.
 * Returns the updated ratings and the (positive) number of points that moved.
 */
export function eloUpdate(a: number, b: number, scoreA: 1 | 0.5 | 0, k = ELO_K): { a: number; b: number; delta: number } {
  const delta = Math.round(k * (scoreA - expectedScore(a, b)));
  return { a: Math.max(ELO_FLOOR, a + delta), b: Math.max(ELO_FLOOR, b - delta), delta: Math.abs(delta) };
}
