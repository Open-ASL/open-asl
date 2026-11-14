import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Engine, GameState, LoggedEvent } from '@asl/engine';

/**
 * What the screen shows of the game: the state as far as the dice have been revealed.
 *
 * The engine resolves an action at once (every roll, result, phase change), but the players learn
 * the outcome roll by roll as the dice toasts and board effects play. The board, the panels, the
 * log, the phase wheel and the decision all follow `state` here, which is the real state folded
 * only up to the last revealed event, so a unit breaks when its Morale Check is shown and the next
 * phase begins when the last Close Combat roll has been seen.
 */
export interface Presentation {
  /** The game as revealed so far (the real state object once everything is revealed). */
  state: GameState;
  /** The logged events revealed so far. */
  log: LoggedEvent[];
  /** Whether some of the game is still to be revealed (the player's orders wait for it). */
  resolving: boolean;
  /** Reveal every event up to and including `seq` (never goes back). */
  reveal(seq: number): void;
  /** Reveal everything now. */
  flush(): void;
}

/**
 * `instant`: show everything at once (effects off). Otherwise the effects reveal the game as they
 * play (`reveal`); the events before the first roll of an action show at once when nothing else is
 * still playing, so a move or a phase ended without dice never waits.
 */
export function usePresentation(engine: Engine, real: GameState, log: LoggedEvent[], instant = false, seek = 0): Presentation {
  const [target, setTarget] = useState(real.seq);
  // An undo goes back in time: nothing beyond the real state can still be waiting.
  useEffect(() => {
    if (target > real.seq) setTarget(real.seq);
  }, [target, real.seq]);
  /** How far the game has been revealed without waiting for any effect, and the real state it was judged against. */
  const auto = useRef({ seq: real.seq, against: real.seq });
  // A replay jump (see Session.seek) shows where it lands at once: nothing is left to reveal.
  const lastSeek = useRef(seek);
  if (seek !== lastSeek.current) {
    lastSeek.current = seek;
    auto.current = { seq: real.seq, against: real.seq };
  } else if (real.seq < auto.current.against) auto.current = { seq: real.seq, against: real.seq };
  else if (real.seq > auto.current.against) {
    const caughtUp = Math.max(target, auto.current.seq) >= auto.current.against;
    if (caughtUp) {
      const firstRoll = log.find((e) => e.seq > auto.current.against && e.type === 'dice.rolled');
      auto.current = { seq: firstRoll ? firstRoll.seq - 1 : real.seq, against: real.seq };
    } else auto.current = { ...auto.current, against: real.seq };
  }
  const shownSeq = instant ? real.seq : Math.min(Math.max(target, auto.current.seq), real.seq);
  /** The last state built, kept so each reveal folds only the new events. */
  const cache = useRef<GameState>(real);
  const state = useMemo(() => {
    if (shownSeq >= real.seq) return (cache.current = real);
    const base = cache.current;
    // Fold forward from the last state shown. It is always behind the target on this game's line
    // (an undo resets it to the real state first); if not, there is nothing safe to fold from.
    if (base.seq > shownSeq) return (cache.current = real);
    if (base.seq === shownSeq) return base;
    const events = log.filter((e) => e.seq > base.seq && e.seq <= shownSeq);
    if (events.length !== shownSeq - base.seq) return (cache.current = real);
    return (cache.current = engine.applyEvents(base, events));
  }, [engine, real, log, shownSeq]);
  const shownLog = useMemo(() => (shownSeq >= real.seq ? log : log.filter((e) => e.seq <= shownSeq)), [log, shownSeq, real.seq]);
  const reveal = useCallback((seq: number) => setTarget((t) => Math.max(t, seq)), []);
  const realSeq = useRef(real.seq);
  realSeq.current = real.seq;
  const flush = useCallback(() => setTarget((t) => Math.max(t, realSeq.current)), []);
  return { state, log: shownLog, resolving: shownSeq < real.seq, reveal, flush };
}
