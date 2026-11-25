import { useMemo, useRef } from 'react';
import type { Action } from '@asl/engine';
import type { ScenarioDef } from '@asl/rules';
import { buildReplay, extendReplay, type Replay } from './replayTimeline';

/**
 * A recording replayed once, every step kept; actions recorded later (a match still being played) carry it on rather
 * than replaying it from the start.
 */
export function useReplay(scenario: ScenarioDef, seed: string, actions: Action[]): Replay {
  const built = useRef<{ actions: Action[]; replay: Replay } | null>(null);
  return useMemo(() => {
    const prev = built.current;
    const kept = prev ? prev.replay.frames.length - 1 : 0;
    const same = prev && actions.length >= kept && (kept === 0 || JSON.stringify(actions[kept - 1]) === JSON.stringify(prev.actions[kept - 1]));
    const next = prev && same ? extendReplay(prev.replay, actions) : buildReplay(scenario, seed, actions);
    built.current = { actions, replay: next };
    return next;
  }, [scenario, seed, actions]);
}
