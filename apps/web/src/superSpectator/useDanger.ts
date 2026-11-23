import { useEffect, useState } from 'react';
import type { GameState, HexId, PieceId, QueryEnv } from '@asl/engine';
import type { SsHeat } from '@asl/platform';
import { dangerSteps, type DangerCell } from './danger';

/** Milliseconds of work per slice before the screen gets a frame back. */
const SLICE_MS = 12;

/**
 * The danger map for the room's settings (null: off), worked out in slices between frames so the board keeps moving.
 * The last map stays up while a new one is worked out (`progress` < 1), so the overlay never blinks off.
 */
export function useDanger(env: QueryEnv, engine: { env(s: GameState): QueryEnv }, heat: SsHeat | null, visible: Set<PieceId> | null, secrets: boolean) {
  const [result, setResult] = useState<{ cells: Map<HexId, DangerCell>; key: string } | null>(null);
  const [progress, setProgress] = useState(1);
  // The measure only changes the colouring: the same map serves both.
  const key = heat ? `${heat.side}|${heat.mode}|${heat.sw}|${secrets}` : '';
  useEffect(() => {
    if (!heat) {
      setResult(null);
      setProgress(1);
      return;
    }
    let stopped = false;
    let handle = 0;
    const gen = dangerSteps(env, engine, { side: heat.side, mode: heat.mode as 'prep' | 'first' | 'advancing', sw: heat.sw, visible, secrets });
    setProgress(0);
    const run = () => {
      if (stopped) return;
      const t0 = performance.now();
      try {
        for (;;) {
          const r = gen.next();
          if (r.done) {
            setResult({ cells: r.value, key });
            setProgress(1);
            return;
          }
          if (performance.now() - t0 > SLICE_MS) {
            setProgress(r.value);
            break;
          }
        }
      } catch (e) {
        console.warn('[danger] map dropped after error', e);
        setProgress(1);
        return;
      }
      handle = window.setTimeout(run, 0);
    };
    // A burst of changes (a counter dragged, a setting flicked) starts one map, not many.
    handle = window.setTimeout(run, 120);
    return () => {
      stopped = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, key, visible]);
  // A map for other settings (the other side's) is never shown while the new one is worked out.
  return { cells: result && result.key === key ? result.cells : null, progress };
}
