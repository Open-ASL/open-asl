import type { QueryEnv } from './query';
import type { Decision, GameResult } from './types';

export interface DiceRoll {
  label: string;
  /** For a DR, dice[0] is the white die and dice[1] the colored die. */
  dice: number[];
  total: number;
}

/**
 * Mutable resolution context handed to action resolvers, triggers and setup hooks.
 * `state` always reflects every event emitted so far.
 */
export interface Ctx extends QueryEnv {
  emit<P>(type: string, payload: P, source?: string): void;
  /** Roll `count` d6 (1 = dr, 2 = DR). Recorded as a `dice.rolled` event. */
  roll(label: string, count?: number): DiceRoll;
  pushDecision(decision: Omit<Decision, 'id'>): Decision;
  /** Remove a decision (the top one if no id given). */
  popDecision(id?: string): void;
  endGame(result: GameResult): void;
  fail(message: string): never;
  /** Invoke a named rule procedure (see RuleBuilder.procedure). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proc<F extends (...args: any[]) => any>(id: string): F;
}
