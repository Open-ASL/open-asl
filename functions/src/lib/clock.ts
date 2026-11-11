import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import type { Decision, Engine, GameState } from '@asl/engine';
import type { ScenarioDef } from '@asl/rules';
import { DEFAULT_PACE, PACES, allowanceMs, availablePace, type Deadline, type MatchDoc, type Pace } from '@asl/platform';
import { newSk1Game } from '@asl/content';

export function requirePace(pace: unknown): Pace {
  if (pace === undefined || pace === null) return DEFAULT_PACE;
  const p = PACES.find((x) => x.id === pace);
  if (!p) throw new HttpsError('invalid-argument', 'Unknown pace.');
  if (!availablePace(p.id)) throw new HttpsError('unimplemented', `${p.name} games are not available yet: ${p.soon}.`);
  return p.id;
}

/** The clock for a decision, counted from now. */
export function deadlineFor(match: Pick<MatchDoc, 'pace'>, decision: Decision, seq: number): Deadline {
  return { at: Timestamp.fromMillis(Date.now() + allowanceMs(match.pace, decision.deadlineClass)), class: decision.deadlineClass, side: decision.owner, seq };
}

/** The clock on a position: null once the game is over. */
export function deadlineAfter(match: Pick<MatchDoc, 'pace'>, engine: Engine, state: GameState, seq: number): Deadline | null {
  const d = state.result ? null : engine.currentDecision(state);
  return d ? deadlineFor(match, d, seq) : null;
}

/** The clock that starts when both seats are filled: the game's first decision, from the opening position. */
export function firstDeadline(match: Pick<MatchDoc, 'pace' | 'seed'>, scenario: ScenarioDef): Deadline | null {
  // The opening decision is the same whatever the dice: a views-model match (no seed on the document) needs none.
  const g = newSk1Game(scenario, match.seed ?? 'opening');
  return deadlineAfter(match, g.engine, g.state, 0);
}

export const deadlinePassed = (d: Deadline | null | undefined, at = Date.now()) => !!d && (d.at as Timestamp).toMillis() <= at;
