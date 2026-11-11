/**
 * Per-viewer views of an online match (the `views` model).
 *
 * The full state and the recording stay on the server (with the seed in `private/game`). After every action the
 * server writes, for each viewer (each side, and `public` when the match is public), a redacted snapshot of the
 * position (`views/{viewer}`) and that action's events as the viewer may see them (`views/{viewer}/steps/{seq}`).
 * Clients fold nothing and roll nothing: they show the snapshot and use the steps for the log and the dice.
 * `redactState` decides what a viewer sees; `Engine.redactTransition` keeps the events one-to-one with the real
 * ones. Pure functions: no Firestore here, so they are testable without the emulator.
 */
import type { Engine, GameState, LoggedEvent, SideId, Transition } from '@asl/engine';
import { redactState } from '@asl/rules';
import { PUBLIC_VIEWER, type MatchDoc } from '@asl/platform';

export interface ViewSnapshot {
  viewer: string;
  side: SideId | null;
  seq: number;
  eventSeq: number;
  state: GameState;
}

export interface ViewStep {
  viewer: string;
  seq: number;
  side: SideId;
  events: LoggedEvent[];
}

/** Whether a match keeps per-viewer views (new online matches) rather than an open recording the clients replay. */
export const usesViews = (match: Pick<MatchDoc, 'mode' | 'model'>) => match.mode === 'online' && match.model === 'views';

/** The viewers of a match: each side, plus the public when anyone may watch. */
export function viewersOf(match: Pick<MatchDoc, 'visibility'>, sides: SideId[]): { viewer: string; side: SideId | null }[] {
  const out: { viewer: string; side: SideId | null }[] = sides.map((s) => ({ viewer: s, side: s }));
  if ((match.visibility ?? 'public') === 'public') out.push({ viewer: PUBLIC_VIEWER, side: null });
  return out;
}

/** Every viewer's snapshot of a position after action `seq`. */
export function snapshotsOf(engine: Engine, state: GameState, seq: number, viewers: { viewer: string; side: SideId | null }[]): ViewSnapshot[] {
  return viewers.map(({ viewer, side }) => {
    const redacted = redactState(engine, state, side);
    return { viewer, side, seq, eventSeq: redacted.seq, state: redacted };
  });
}

/**
 * What an action produces for each viewer: the snapshot after it and the action's events as that viewer may see
 * them (`Engine.redactTransition`: one event per real event, a `view.patch` where the real one would show too much).
 */
export function stepsOf(engine: Engine, before: GameState, t: Transition, seq: number, side: SideId, viewers: { viewer: string; side: SideId | null }[]): { snapshots: ViewSnapshot[]; steps: ViewStep[] } {
  const snapshots = snapshotsOf(engine, t.state, seq, viewers);
  const steps = viewers.map(({ viewer, side: v }) => ({ viewer, seq, side, events: engine.redactTransition(v, (s) => redactState(engine, s, v), before, t.events) }));
  return { snapshots, steps };
}
