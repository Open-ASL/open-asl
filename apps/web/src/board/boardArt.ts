/**
 * Board art loading that never holds the map hostage.
 *
 * A board image is several megabytes. A request that stalls (a dropped connection on a resumed tab, a proxy that
 * never answers) leaves its promise pending forever, and Pixi's loader keeps that pending promise in its cache under
 * the URL: every later `Assets.load` of the same URL, even from a fresh mount of the board, waits on it too. Only a
 * page reload cleared it. So each attempt here is given a time limit, a later attempt asks for the same file under a
 * fresh URL (a query the server ignores, which the cache has not seen), and an earlier attempt that lands late is
 * still taken.
 */

/** How long one attempt may take before the next one starts (the earlier one may still land). */
export const ART_ATTEMPT_MS = 8000;
/** Attempts per load before giving up (the first under the plain URL, the rest under fresh ones). */
export const ART_TRIES = 3;

/**
 * Per URL, how many attempts already stalled or failed in this page: a new load starts past them, so a remounted
 * board does not wait again on a request known to hang in the loader's cache.
 */
const spent = new Map<string, number>();
/** Per URL, the source an earlier load succeeded with (the loader has it cached under that source). */
const good = new Map<string, string>();

/** The same file under a URL no earlier attempt used. */
export function freshUrl(url: string, attempt: number): string {
  if (attempt === 0) return url;
  return `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`;
}

/**
 * The first of `pending` to succeed, or null once all have failed or `ms` has passed (whichever comes first). A
 * pending promise that loses the race is left running; it is raced again by the next call.
 */
function firstOf<T>(pending: Promise<T>[], ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let failures = 0;
    const timer = setTimeout(() => resolve(null), ms);
    for (const p of pending) {
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        () => {
          if (++failures === pending.length) {
            clearTimeout(timer);
            resolve(null);
          }
        },
      );
    }
  });
}

export interface ArtLoadOptions {
  /** Time limit of one attempt. */
  attemptMs?: number;
  tries?: number;
  /** Called when an attempt stalls or fails (for the log). */
  onMiss?: (src: string, attempt: number) => void;
}

/**
 * Loads `url` with `load`, retrying stalled or failed attempts under fresh URLs. Resolves with the result, or null
 * when every attempt failed or stalled; never rejects and never waits longer than `tries × attemptMs`.
 */
export async function loadArt<T>(url: string, load: (src: string) => Promise<T>, opts: ArtLoadOptions = {}): Promise<T | null> {
  const attemptMs = opts.attemptMs ?? ART_ATTEMPT_MS;
  const tries = opts.tries ?? ART_TRIES;
  const known = good.get(url);
  if (known) {
    try {
      return await load(known);
    } catch {
      good.delete(url);
    }
  }
  const pending: Promise<T>[] = [];
  const start = spent.get(url) ?? 0;
  for (let i = 0; i < tries; i++) {
    const attempt = start + i;
    const src = freshUrl(url, attempt);
    const p = load(src).then((v) => {
      good.set(url, src);
      return v;
    });
    p.catch(() => {});
    pending.push(p);
    const got = await firstOf(pending, attemptMs);
    if (got !== null) return got;
    spent.set(url, Math.max(spent.get(url) ?? 0, attempt + 1));
    opts.onMiss?.(src, attempt);
  }
  return null;
}

/** Forgets every stalled and successful load (tests). */
export function resetArtLoads() {
  spent.clear();
  good.clear();
}
