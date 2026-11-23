import type { HexId, QueryEnv } from '@asl/engine';
import { caveLoc, caveStands } from '@asl/rules';

/**
 * The hex's Cave Location as a fire target of its own, while the cave stands and the wheel does not already offer it
 * (`already`: the Locations where enemy units are seen). A cave is a separate Location, and a DC or FT attack that does
 * not malfunction against one holding no unbroken defender eliminates it, so it must be targetable when nothing is seen
 * in it; aimed at the hex, the attack hits the hill instead.
 */
export function caveFireTarget(env: QueryEnv, hex: HexId, already: readonly string[]): string | null {
  if (!caveStands(env, hex)) return null;
  const cave = caveLoc(hex);
  return already.includes(cave) ? null : cave;
}
