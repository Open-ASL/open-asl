import { describe, expect, it } from 'vitest';
import { HexGridMap, columnIndex, columnLabel } from '../src';
import { testMap } from './fixtures';

describe('geomorphic board geometry', () => {
  const map = testMap();

  it('names columns A..Z then AA..GG', () => {
    expect(columnLabel(0)).toBe('A');
    expect(columnLabel(25)).toBe('Z');
    expect(columnLabel(26)).toBe('AA');
    expect(columnLabel(32)).toBe('GG');
    expect(columnIndex('GG')).toBe(32);
  });

  it('has 10 hexes in even-index columns and 11 in odd ones', () => {
    expect(map.hex('yA1')).toBeDefined();
    expect(map.hex('yA0')).toBeUndefined();
    expect(map.hex('yB0')).toBeDefined();
    expect(map.hex('yB10')).toBeDefined();
    expect([...map.hexes()].length).toBe(17 * 10 + 16 * 11);
  });

  it('computes adjacency with odd columns offset downward', () => {
    // K (even column) sits half a hex higher than J/L, so K2 touches J1/J2 and L1/L2.
    expect(map.neighbors('yK2').sort()).toEqual(['yJ1', 'yJ2', 'yK1', 'yK3', 'yL1', 'yL2']);
    // N (odd column) sits lower, so N4 touches M4/M5 and O4/O5.
    expect(map.neighbors('yN4').sort()).toEqual(['yM4', 'yM5', 'yN3', 'yN5', 'yO4', 'yO5']);
  });

  it('measures range in hexes', () => {
    expect(map.distance('yN5', 'yP5')).toBe(2);
    expect(map.distance('yA1', 'yA10')).toBe(9);
    expect(map.distance('yA1', 'yGG1')).toBe(32);
  });

  it('merges overlapping half hexes of butted boards', () => {
    const two = new HexGridMap({
      boards: [
        { board: 'y', x: 0, y: 0 },
        { board: 'z', x: 1, y: 0 },
      ],
      losEffect: () => 'none',
    });
    expect(two.hex('zA1')?.id).toBe('yGG1');
    expect(two.distance('yFF1', 'zB1')).toBe(2);
    expect(two.hex('yGG1')?.halfHex).toBe(false);
  });

  it('continues a road offboard only through the hexside the road leaves by', () => {
    const road = { terrain: 'open', features: ['road:dirt'] };
    // Board y cut at hexrow V: the road U4-V4 goes on to W5 (not W4) in the full board.
    const cut = new HexGridMap({
      boards: [{ board: 'y', x: 0, y: 0, columns: ['A', 'V'] }],
      terrain: { yU4: road, yV4: road, yW5: road, yX5: road, yI10: road },
      roadHexsides: [['yU4', 'yV4'], ['yW5', 'yX5']],
      losEffect: () => 'none',
    });
    expect(cut.hex('yW5')).toBeUndefined();
    expect(cut.roadHexside('yV4', 'yW5')).toBe(true);
    expect(cut.roadHexside('yV4', 'yW4')).toBe(false);
    expect(cut.offboardHex('yW5')?.features).toContain('road:offboard');
    expect(cut.offboardHex('yW4')?.features).not.toContain('road:offboard');
    // A road hex on the bottom edge has a single offboard neighbour below it.
    expect(cut.roadHexside('yI10', 'yI11')).toBe(true);
    expect(cut.roadHexside('yH10', 'yH11')).toBe(false);
  });

  it('blocks LOS through obstacles but not along a hexside shared with open ground', () => {
    const m = testMap({ yO5: { terrain: 'woods' } });
    // N5 -> P5 runs exactly along the O5/O6 hexside.
    expect(m.los('yN5', 'yP5').clear).toBe(true);
    const m2 = testMap({ yO5: { terrain: 'woods' }, yO6: { terrain: 'woods' } });
    expect(m2.los('yN5', 'yP5').clear).toBe(false);
    const m3 = testMap({ yO5: { terrain: 'orchard' } });
    expect(m3.los('yN5', 'yP5').crossed.map((c) => c.hex)).toEqual(['yO5']);
  });
});

describe('a board turned 180°', () => {
  const stacked = new HexGridMap({
    boards: [
      { board: 'z', x: 0, y: 1, columns: ['R', 'GG'] },
      { board: 'y', x: 0, y: 0, rotation: 180, columns: ['A', 'P'] },
    ],
    losEffect: () => 'none',
  });

  it('keeps its printed hex names but lands them mirrored on the grid', () => {
    // Column A of the turned board sits where GG would, row 1 where row 10 would.
    expect(stacked.distance('yA1', 'zGG1')).toBe(1);
    // In odd columns the shared half hex sits between the two row-1 hexes.
    expect(stacked.hex('yP0')!.id).toBe('zR0');
    expect(stacked.distance('yP1', 'zR1')).toBe(2);
    expect(stacked.neighbors('zS1')).toContain('yO1');
    // The turned board's row 10 is the far edge, so A1 to A10 still spans 9 hexes.
    expect(stacked.distance('yA1', 'yA10')).toBe(9);
    expect(stacked.hex('yQ1')).toBeUndefined();
  });

  it('shares its half hexes with the board it is stacked on', () => {
    // y's B0 half hex lands on z's FF0 (column 1 ↔ 31), one hex with two names.
    expect(stacked.hex('yB0')!.id).toBe('zFF0');
    expect(stacked.hex('yN0')!.id).toBe('zT0');
    expect([...stacked.hexes()].length).toBe(168 + 160);
  });

  it('names its offboard hexes in the board’s own coordinates', () => {
    // Beyond the turned board's row 10 (now the north edge) lie its row-11 hexes.
    const north = stacked.offboard('N').map((h) => h.id);
    expect(north).toContain('yA11');
    expect(north.every((id) => id.startsWith('y'))).toBe(true);
  });
});
