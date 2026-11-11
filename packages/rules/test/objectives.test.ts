import { describe, expect, it } from 'vitest';
import { objectiveAreas } from '../src';
import { scenario, testMap } from './fixtures';

describe('Scenario objectives on the map', () => {
  it('single hexes become star hexes, buildings whole regions, exit edges a region', () => {
    const map = testMap({
      yN5: { terrain: 'building', buildingId: 'N5' },
      yN6: { terrain: 'building', buildingId: 'N5' },
      yM4: { terrain: 'building', buildingId: 'M4' },
    });
    const sc = scenario({
      victory: [
        { kind: 'controlHexes', side: 'am', hexes: ['yP5', 'yP6'], atLeast: 2 },
        { kind: 'noGoodOrderEnemyIn', side: 'am', hexes: ['yN5', 'yM4', 'yK2'], buildings: true },
        { kind: 'exitVp', side: 'ge', edge: 'E', vp: 4 },
      ],
    });
    const areas = objectiveAreas(sc, map);
    expect(areas.map((a) => [a.kind, [...a.hexes].sort().join(','), a.label, a.group])).toEqual([
      ['hex', 'yP5', 'Control P5', 0],
      ['hex', 'yP6', 'Control P6', 0],
      ['region', 'yN5,yN6', 'Building N5', 1],
      ['hex', 'yM4', 'Building M4', 1],
      ['hex', 'yK2', 'Clear K2', 1],
      ['region', map.edge('E').sort().join(','), 'Exit E edge', 2],
    ]);
  });
});
