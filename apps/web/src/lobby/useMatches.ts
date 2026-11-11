import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, getDocs, limit, onSnapshot, orderBy, query, startAfter, where, type DocumentData, type Query, type QueryDocumentSnapshot } from 'firebase/firestore';
import { COL, type MatchDoc, type RulesetId } from '@asl/platform';
import { db } from '../firebase';

export interface MatchRow {
  id: string;
  match: MatchDoc;
}

function useQuery(q: Query | null): { rows: MatchRow[]; error: string | null; ready: boolean } {
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!q) return;
    return onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, match: d.data() as MatchDoc })));
        setReady(true);
      },
      (e) => setError(e.message),
    );
    // Queries are rebuilt only when the uid or ruleset changes, by the hooks below.
  }, [q?.toString()]);
  return { rows, error, ready };
}

const matches = () => collection(db, COL.matches);
/**
 * Each lobby lists only its own ruleset's matches. Every match carries `rulesetId` (older beta
 * records were given 'starter-kit' by a backfill), so the filter runs on the server.
 */
const inRuleset = (ruleset: RulesetId) => where('rulesetId', '==', ruleset);

/** The signed-in player's unfinished games: hotseat games to resume and online matches. */
export function useMyMatches(uid: string, ruleset: RulesetId) {
  return useQuery(query(matches(), inRuleset(ruleset), where('playerIds', 'array-contains', uid), where('status', 'in', ['open', 'active']), orderBy('updatedAt', 'desc')));
}

/** Every vs-human match in progress, open seats first in the UI. */
export function useLiveMatches(ruleset: RulesetId) {
  return useQuery(query(matches(), inRuleset(ruleset), where('mode', '==', 'online'), where('visibility', '==', 'public'), where('status', 'in', ['open', 'active']), orderBy('updatedAt', 'desc'), limit(50)));
}

/** Bounded public-table browser: only one 25-row page is ever mounted, even with thousands live. */
export function useLiveMatchPages(ruleset: RulesetId) {
  const pageSize = 25;
  const starts = useRef<Array<QueryDocumentSnapshot<DocumentData> | null>>([null]);
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [page, setPage] = useState(0);
  const [canNext, setCanNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (index: number) => {
    const cursor = starts.current[index] ?? null;
    setLoading(true);
    setError(null);
    try {
      const constraints = [inRuleset(ruleset), where('mode', '==', 'online'), where('visibility', '==', 'public'), where('status', 'in', ['open', 'active']), orderBy('updatedAt', 'desc')] as const;
      const pageQuery = cursor
        ? query(matches(), ...constraints, startAfter(cursor), limit(pageSize + 1))
        : query(matches(), ...constraints, limit(pageSize + 1));
      const snapshot = await getDocs(pageQuery);
      const visible = snapshot.docs.slice(0, pageSize);
      const more = snapshot.docs.length > pageSize;
      if (more && visible.length) starts.current[index + 1] = visible.at(-1)!;
      setRows(visible.map((document) => ({ id: document.id, match: document.data() as MatchDoc })));
      setCanNext(more);
      setPage(index);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ruleset]);

  useEffect(() => { starts.current = [null]; void loadPage(0); }, [loadPage]);
  return {
    rows, page, loading, error, canPrevious: page > 0, canNext,
    previous: () => void loadPage(page - 1),
    next: () => void loadPage(page + 1),
  };
}

/** The latest scored vs-human matches. */
export function useRecentResults(ruleset: RulesetId) {
  return useQuery(query(matches(), inRuleset(ruleset), where('mode', '==', 'online'), where('visibility', '==', 'public'), where('status', '==', 'complete'), orderBy('completedAt', 'desc'), limit(20)));
}
