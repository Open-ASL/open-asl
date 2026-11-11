import { describe, expect, it } from 'vitest';
import { XP } from '../src/xp';

describe('experience awards', () => {
  it('keeps hotseat XP far below every multiplayer result', () => {
    expect(XP.hotseatComplete).toBeLessThanOrEqual(XP.onlineLoss / 5);
    expect(XP.hotseatComplete).toBeLessThan(XP.onlineDraw);
    expect(XP.hotseatComplete).toBeLessThan(XP.onlineWin);
  });
});
