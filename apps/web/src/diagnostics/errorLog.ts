/**
 * The page's recent errors, for bug reports: uncaught exceptions, unhandled promise rejections, `console.error` and
 * what an error boundary catches. Only the last few are kept, each cut short, and nothing leaves the page unless the
 * player files a report.
 */
const MAX_ENTRIES = 30;
const MAX_LENGTH = 500;

export interface ErrorEntry {
  /** Seconds since the page loaded. */
  t: number;
  kind: 'exception' | 'rejection' | 'console' | 'boundary';
  text: string;
}

const entries: ErrorEntry[] = [];
let installed = false;

const describe = (v: unknown): string => {
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? `\n${v.stack.split('\n').slice(1, 4).join('\n')}` : ''}`;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

/** Records one error (most recent last); the oldest goes once there are more than `MAX_ENTRIES`. */
export function recordError(kind: ErrorEntry['kind'], ...parts: unknown[]) {
  const text = parts.map(describe).join(' ').slice(0, MAX_LENGTH);
  entries.push({ t: Math.round(performance.now() / 100) / 10, kind, text });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

/** The errors recorded so far, oldest first. */
export const recentErrors = (): ErrorEntry[] => entries.slice();

/** Starts recording; called once when the app starts. */
export function installErrorLog() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => recordError('exception', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => recordError('rejection', e.reason));
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    recordError('console', ...args);
    original(...args);
  };
}
