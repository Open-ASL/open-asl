/**
 * Where a reinforcement that appears on map hexes comes, for the Reinforcements panel: "appears on X0, Y1, Z1" (board
 * letters left off). Such a unit has no edge to enter by: it is set up on one of those hexes as its side's RPh begins
 * (ASLRB A2.51).
 */
export const appearWords = (hexes: string): string => `appears on ${hexes.split(',').filter(Boolean).map((h) => h.replace(/^[a-z]+(?=[A-Z])/, '')).join(', ')}`;

/** Whether the reinforcements being set up appear on map hexes (all of them, some, or none): the panel words its asks by it. */
export function appearMix(todo: readonly { tags: Record<string, unknown> }[]): 'all' | 'some' | 'none' {
  const n = todo.filter((p) => p.tags['appearHexes'] !== undefined).length;
  return n === 0 ? 'none' : n === todo.length ? 'all' : 'some';
}
