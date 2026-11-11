import { useEffect, useState } from 'react';

/** The current time, re-read every `everyMs`; for countdowns. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** Firestore Timestamps from either SDK, or nothing yet (a pending server timestamp). */
export function toDate(t: unknown): Date | null {
  if (!t) return null;
  if (t instanceof Date) return t;
  const ts = t as { toDate?(): Date };
  return typeof ts.toDate === 'function' ? ts.toDate() : null;
}

/** "just now", "4 min ago", "2 h ago", "3 d ago". */
export function ago(t: unknown): string {
  const d = toDate(t);
  if (!d) return 'just now';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
