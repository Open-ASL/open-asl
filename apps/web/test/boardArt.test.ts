import { afterEach, describe, expect, it, vi } from 'vitest';
import { freshUrl, loadArt, resetArtLoads } from '../src/board/boardArt';

afterEach(() => {
  vi.useRealTimers();
  resetArtLoads();
});

describe('loadArt', () => {
  it('asks again under a fresh URL when an attempt stalls, and takes the stalled one if it lands first', async () => {
    vi.useFakeTimers();
    let land: (v: string) => void = () => {};
    const asked: string[] = [];
    const p = loadArt('/b.webp', (src) => {
      asked.push(src);
      return src === '/b.webp' ? new Promise<string>((r) => (land = r)) : new Promise<string>(() => {});
    });
    await vi.advanceTimersByTimeAsync(8000);
    expect(asked).toEqual(['/b.webp', '/b.webp?retry=1']);
    land('late');
    expect(await p).toBe('late');
  });

  it('moves on at once from a failed attempt and gives up with null, never rejecting', async () => {
    vi.useFakeTimers();
    const asked: string[] = [];
    const p = loadArt('/b.webp?v=2', (src) => {
      asked.push(src);
      return Promise.reject(new Error('404'));
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(await p).toBeNull();
    expect(asked).toEqual(['/b.webp?v=2', '/b.webp?v=2&retry=1', '/b.webp?v=2&retry=2']);
    // A later load starts past the URLs that failed.
    const next: string[] = [];
    await loadArt('/b.webp?v=2', async (src) => (next.push(src), 'ok'));
    expect(next).toEqual(['/b.webp?v=2&retry=3']);
  });

  it('reuses the source that worked', async () => {
    const asked: string[] = [];
    const ok = async (src: string) => (asked.push(src), src);
    await loadArt('/c.webp', ok);
    await loadArt('/c.webp', ok);
    expect(asked).toEqual(['/c.webp', '/c.webp']);
    expect(freshUrl('/c.webp', 0)).toBe('/c.webp');
  });
});
