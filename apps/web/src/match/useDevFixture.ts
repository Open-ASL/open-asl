import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { fixtureActions } from '@asl/content';
import type { Session } from '../game/session';

/**
 * Development builds only: load the dev fixture named by `?fixture=<id>` (see `@asl/content` fixtures.ts) into a
 * hotseat game that has no action yet. The fixture's actions are submitted and recorded like a player's, so the
 * match is an ordinary recording afterwards. The parameter is dropped from the address once used. Returns the
 * error to show if the fixture could not be built.
 */
export function useDevFixture(session: Session): string | null {
  const [params, setParams] = useSearchParams();
  const id = import.meta.env.DEV ? params.get('fixture') : null;
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (!id || done.current || !session.applyActions) return;
    done.current = true;
    if (session.actionCount > 0) setError(`Dev fixture "${id}" not loaded: the game has already begun.`);
    else {
      try {
        setError(session.applyActions(fixtureActions(session.engine, session.state, id)));
      } catch (e) {
        setError((e as Error).message);
      }
    }
    const next = new URLSearchParams(params);
    next.delete('fixture');
    setParams(next, { replace: true });
  }, [id, session, params, setParams]);
  return error;
}
