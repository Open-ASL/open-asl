import { describe, expect, it } from 'vitest';
import { bffWheelKind } from '../src/game/bffWheel';

/** A T-34 moving in yM5 during its MPh; the right-click is on yM9 unless given. */
const at = (o: Partial<Parameters<typeof bffWheelKind>[0]> = {}) => bffWheelKind({ decisionKind: 'phase', phase: 'MPh', moverHex: 'yM5', vehicle: true, hex: 'yM9', gunLinedUp: false, mgMode: false, ...o });

describe('the right-click wheel during Bounding First Fire (SK4 3.3.2.2)', () => {
  it('offers the lined-up MA shot, or the picked MGs, at the target hex', () => {
    expect(at({ gunLinedUp: true })).toBe('gun');
    expect(at({ mgMode: true })).toBe('mg');
  });

  it('keeps the mover’s own orders on its own hex, and the usual wheel when nothing is lined up', () => {
    expect(at({ gunLinedUp: true, hex: 'yM5' })).toBeNull();
    expect(at()).toBeNull();
  });

  it('is only for a moving vehicle in its MPh', () => {
    expect(at({ gunLinedUp: true, vehicle: false })).toBeNull();
    expect(at({ gunLinedUp: true, phase: 'PFPh' })).toBeNull();
    expect(at({ gunLinedUp: true, decisionKind: 'firstFire' })).toBeNull();
  });
});
