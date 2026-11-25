/*
 * Each deploy replaces the hashed script chunks, so a page loaded before it still asks for the old names when it
 * first needs a lazily loaded one (the board renderer's chunk is fetched when a board first appears). That fetch
 * fails, the board never draws and the player sees an empty table. Loading the page again picks up the new build,
 * so the page reloads itself when it sees such a failure. A second failure soon after a reload is left alone (the
 * player may be offline, or the chunk truly missing), so the page never reloads in a loop.
 */
const KEY = 'openasl.staleBuildReload';
/** A reload this recent (ms) is not repeated. */
const COOLDOWN = 60_000;

/** The messages browsers give when a dynamic import's script cannot be fetched, and Vite's for a failed preload. */
const STALE_CHUNK = [
  /Failed to fetch dynamically imported module/i, // Chrome, Edge
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite's own preload helper
];

/** Whether `reason` is a failure to fetch a lazily loaded chunk of the app. */
export function isStaleChunkError(reason: unknown): boolean {
  const text = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  return STALE_CHUNK.some((re) => re.test(text));
}

export interface StaleBuildEnv {
  reload: () => void;
  now: () => number;
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined;
}

/** Reloads once for a stale chunk; returns whether it did. */
export function reloadForStaleChunk(reason: unknown, env: StaleBuildEnv): boolean {
  if (!isStaleChunkError(reason)) return false;
  try {
    const last = Number(env.storage?.getItem(KEY) ?? 0);
    if (env.now() - last < COOLDOWN) return false;
    env.storage?.setItem(KEY, String(env.now()));
  } catch {
    // Storage blocked: reloading without the guard could loop, so leave the page as it is.
    return false;
  }
  env.reload();
  return true;
}

let installed = false;

/** Starts watching for stale chunks; called once when the app starts. */
export function installStaleBuildReload() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  let storage: Storage | undefined;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = undefined;
  }
  const env: StaleBuildEnv = { reload: () => window.location.reload(), now: () => Date.now(), storage };
  window.addEventListener('vite:preloadError', (e) => {
    if (reloadForStaleChunk((e as Event & { payload?: unknown }).payload, env)) e.preventDefault();
  });
  window.addEventListener('unhandledrejection', (e) => {
    reloadForStaleChunk(e.reason, env);
  });
}
