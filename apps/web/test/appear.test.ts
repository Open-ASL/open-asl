import { describe, expect, it } from 'vitest';
import type { ScenarioForce } from '@asl/rules';
import { appearMix, appearWords } from '../src/game/appear';
import { setupRule } from '../src/panels/Briefing';

/*
 * A reinforcement that appears on map hexes rather than entering by an edge (set up on them as its side's RPh begins,
 * ASLRB A2.51): the Reinforcements panel and the briefing say where it appears, never an edge.
 */
describe('a reinforcement that appears on map hexes', () => {
  it('the Reinforcements panel names its hexes without board letters', () => {
    expect(appearWords('yX0,yY1,yZ1,yAA2,yBB2,yCC3')).toBe('appears on X0, Y1, Z1, AA2, BB2, CC3');
  });

  it('the setup panel asks for the map when every unit placed appears there, for both when some do', () => {
    const appears = { tags: { appearHexes: 'yX0,yY1' } };
    const enters = { tags: { entryEdge: 'E' } };
    expect(appearMix([appears])).toBe('all');
    expect(appearMix([appears, enters])).toBe('some');
    expect(appearMix([enters])).toBe('none');
  });

  it('the briefing says it appears on its hexes, not "enter along the ... edge"', () => {
    const force = { id: 'r', side: 'am', units: [], setup: { kind: 'enter', turn: 3, edge: 'E', hexes: ['yX0', 'yY1'], appear: true } } as unknown as ScenarioForce;
    expect(setupRule(force, { boards: [{ board: 'y', position: '' }] })).toMatch(/^Appears on Turn 3 in X0, Y1$/);
    expect(setupRule(force, { boards: [{ board: 'y', position: '' }] })).not.toMatch(/edge/);
  });
});
