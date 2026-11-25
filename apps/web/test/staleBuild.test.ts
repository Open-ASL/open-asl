import { describe, expect, it } from 'vitest';
import { isStaleChunkError, reloadForStaleChunk, type StaleBuildEnv } from '../src/diagnostics/staleBuild';

function env(start = 1_000_000) {
  const store = new Map<string, string>();
  let t = start;
  const reloads: number[] = [];
  const e: StaleBuildEnv = {
    reload: () => reloads.push(t),
    now: () => t,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
  };
  return { e, reloads, advance: (ms: number) => (t += ms) };
}

const chrome = new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/browserAll-BGL205q-.js');

describe('stale build reload', () => {
  it('knows the stale-chunk errors of Chrome, Firefox, Safari and Vite', () => {
    expect(isStaleChunkError(chrome)).toBe(true);
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module: https://x/a.js'))).toBe(true);
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError(new Error('Unable to preload CSS for /assets/a.css'))).toBe(true);
    expect(isStaleChunkError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });

  it('reloads once for a missing chunk, and not again within the cooldown', () => {
    const { e, reloads, advance } = env();
    expect(reloadForStaleChunk(chrome, e)).toBe(true);
    // The board keeps asking for the chunk while the page reloads; one reload is enough.
    expect(reloadForStaleChunk(chrome, e)).toBe(false);
    advance(30_000);
    expect(reloadForStaleChunk(chrome, e)).toBe(false);
    expect(reloads).toHaveLength(1);
    // A later deploy in the same tab is a new stale build.
    advance(60_000);
    expect(reloadForStaleChunk(chrome, e)).toBe(true);
    expect(reloads).toHaveLength(2);
  });

  it('ignores other errors', () => {
    const { e, reloads } = env();
    expect(reloadForStaleChunk(new Error('Order refused'), e)).toBe(false);
    expect(reloads).toHaveLength(0);
  });

  it('does not reload when storage is blocked, so it can never loop', () => {
    const { e, reloads } = env();
    e.storage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
    };
    expect(reloadForStaleChunk(chrome, e)).toBe(false);
    expect(reloads).toHaveLength(0);
  });
});
