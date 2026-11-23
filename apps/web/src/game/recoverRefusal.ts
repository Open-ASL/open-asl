/**
 * Why none of the units here may recover a loose weapon, for a greyed "Recover" entry: each distinct refusal once (a SMC
 * may never carry more than 2 PP, SK4 4.0; a Gun needs a MMC; ...). Null when one of them may: the entry is offered.
 */
export function recoverRefusal(refusals: (string | null)[]): string | null {
  if (refusals.length === 0 || refusals.some((r) => r === null)) return null;
  return [...new Set(refusals)].join('; ');
}
