/**
 * Why no unit here may take a SW now, for a greyed "Pass" entry; null when the entry is best left out. A SW changes hands
 * only between Good Order units in the RPh (SK1 3.1d) or at the start of the APh (ASLRB A4.431), so the entry is kept,
 * with the engine's reasons, only in those phases and on the player's own phase decision, and only when another unit of
 * his is in the Location to refuse it (a broken holder keeps its SW).
 */
export function passRefusal(phase: string, decisionKind: string | undefined, ownDecision: boolean, refusals: (string | null)[]): string | null {
  if ((phase !== 'RPh' && phase !== 'APh') || decisionKind !== 'phase' || !ownDecision) return null;
  if (refusals.length === 0 || refusals.some((r) => r === null)) return null;
  return [...new Set(refusals)].join('; ');
}
