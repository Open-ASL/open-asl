import type { PieceId, QueryEnv } from '@asl/engine';
import type { MoveState } from './movement';
import { locId, type LocId, type SubLoc } from '../common/location';

/** The `ext` key under which the movement module keeps the moving stack's state. */
export const MOVE = 'sk1.move';

/** The stack now moving (MPh), if any. */
export const moveState = (env: QueryEnv) => env.state.ext[MOVE] as MoveState | undefined;

/** The Location the moving stack is in (ASLRB A2.8: its hex and `level`, or its `sub`-Location), or null while offboard. */
export const moveLoc = (ms: Pick<MoveState, 'hex' | 'level'> & { sub?: SubLoc }): LocId | null => (ms.hex ? locId(ms.hex, ms.level, ms.sub) : null);

/**
 * What Defensive First Fire at the moving stack attacks: its moving units and those broken or pinned in this
 * Location by earlier Defensive First Fire (`stopped`; SK1 3.3.1), as long as they are still on the map.
 */
export const firstFireTargets = (env: QueryEnv, ms: MoveState): PieceId[] =>
  [...ms.units, ...(ms.stopped ?? [])].filter((u) => env.state.pieces[u]?.loc.kind === 'hex');

/**
 * Identity of the moving stack's current MF/MP expenditure, for the Mandatory Fire Group rule: same-hex
 * units must combine only against "the same target (i.e., at both the same Location and the same unit and
 * the same 'simultaneous' MF/MP expenditure)" (ASLRB A7.55; SK4 glossary "or moving stack on the same
 * expenditure"; SK1 1.2.4 "at both the same hex and at the same unit"). The stack is named by the units it
 * started with (units it loses on the way do not make it a new target) and the expenditure by its count.
 */
export function expenditureKey(env: QueryEnv): string | undefined {
  const ms = moveState(env);
  if (!ms) return undefined;
  return `${[...(ms.started ?? ms.units)].sort().join('+')}#${ms.trail?.length ?? 0}`;
}
