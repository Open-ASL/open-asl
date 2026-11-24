// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { Texture } from 'pixi.js';
import { ASSETS, COUNTERS } from '@asl/content';
import { printedProfile, printedTankLayers } from '../src/board/printedTankArt';

afterEach(() => vi.restoreAllMocks());

it('has measured artwork for every turreted vehicle with a front counter (SK4 3.2.4)', () => {
  for (const vehicle of Object.values(COUNTERS)) {
    const front = ASSETS.counters[vehicle.id]?.front;
    if (vehicle.kind === 'vehicle' && vehicle.turret !== 'NT' && front) {
      expect(printedProfile(front), vehicle.id).toBeDefined();
    }
  }
});

it('falls back when the browser forbids reading the printed counter', () => {
  const getImageData = vi.fn(() => { throw new DOMException('Canvas is tainted', 'SecurityError'); });
  const context = { translate() {}, rotate() {}, drawImage() {}, resetTransform() {}, getImageData };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as unknown as CanvasRenderingContext2D);
  const front = { source: { resource: new Image() } } as Texture;
  expect(printedTankLayers(front, '/counters/M4A3.webp')).toBeNull();
  expect(printedTankLayers(front, '/counters/M4A3.webp')).toBeNull();
  expect(getImageData).toHaveBeenCalledTimes(1);
});
