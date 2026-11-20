import type { PieceId } from '@asl/engine';

/**
 * Whether a plain click on an own stack keeps the selection as it is: the stack is the one already shown and some of
 * its units are still ticked in its Stack card. Only a click on another stack (or "Select stack" on the wheel) picks
 * up a whole stack again, so a second click never undoes the units the player unticked before giving an order.
 */
export function keepsTicks(current: ReadonlySet<PieceId>, mine: readonly PieceId[], click: { shift: boolean; sameHex: boolean }): boolean {
  return !click.shift && click.sameHex && mine.some((id) => current.has(id));
}
