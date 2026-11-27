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
 * Location by earlier Defensive First Fire (`stopped`; SK1 3.3.1), as long as they are still on the map. Full ASL: a
 * stack back in a hex where it left units in Bypass is attacked with them, still in the open part of that hex until the
 * end of their MPh (ASLRB A4.32, A4.33; the Starter Kit never sets `leftBypass`).
 */
export const firstFireTargets = (env: QueryEnv, ms: MoveState): PieceId[] => {
  const left = ms.hex && !ms.level && !ms.sub ? (ms.leftBypass ?? []).filter((r) => r.hex === ms.hex).flatMap((r) => Object.keys(r.units)) : [];
  const onMap = (u: PieceId) => {
    const l = env.state.pieces[u]?.loc;
    return l?.kind === 'hex' && (!left.includes(u) || (l.hex === ms.hex && !l.level && !l.sub));
  };
  if (left.length === 0) return [...ms.units, ...(ms.stopped ?? [])].filter((u) => env.state.pieces[u]?.loc.kind === 'hex');
  return [...new Set([...ms.units, ...(ms.stopped ?? []), ...left])].filter(onMap);
};

/**
 * Identity of the moving stack's current MF/MP expenditure, for the Mandatory Fire Group rule: same-hex
 * units must combine only against "the same target (i.e., at both the same Location and the same unit and
 * the same 'simultaneous' MF/MP expenditure)" (ASLRB A7.55; SK4 glossary "or moving stack on the same
 * expenditure"; SK1 1.2.4 "at both the same hex and at the same unit"). The stack is named by its move's number
 * (`MoveState.stack`: units it loses on the way do not make it a new target) and the expenditure by its count.
 * The key holds no piece id: the fire log and other records keyed by it go to both players, and a concealed or hidden
 * mover's id must not reach the enemy (SK4 8.3, ASLRB A12.1); a view without the movers must still find the same
 * key, so its own legality checks agree with the full state's.
 */
export function expenditureKey(env: QueryEnv): string | undefined {
  const ms = moveState(env);
  if (!ms) return undefined;
  // A state built without the event that numbers a move (a hand-made position) falls back to the movers' ids.
  const stack = ms.stack !== undefined ? `m${ms.stack}` : [...(ms.started ?? ms.units)].sort().join('+');
  return `${stack}#${ms.trail?.length ?? 0}`;
}
