import type { ScenarioDef } from '@asl/rules';
import { hexesWhere, multiHexBuildingsWhere } from './areas';

/** The multi-hex stone buildings of board u's village (hexrows I-P): I3-I5, K4-K5, L3-M3, L5-M5, L8-M9, M7-N7, P2-P3. */
export const TESTBED_VC_BUILDINGS = multiHexBuildingsWhere('u', { rows: ['I', 'P'], terrain: 'building-stone' });
/** Board u's Level 1 hill hexes (hexrows C-H). */
export const TESTBED_HILL_HEXES = hexesWhere('u', { elevation: 1 });

/**
 * Open ASL's own development scenario for the Full ASL ruleset (not an MMP scenario and no real
 * battle): it is only offered in the Full ASL lobby, which is itself behind the development gate.
 * Board u has every terrain the Chapter A work starts with (stone and wooden buildings with upper
 * levels, a level-1 hill, woods, brush, orchards, roads).
 *
 * The Russians hold the hill and the stone village west of hexrow Q; the Germans set up in the woods
 * and brush east of hexrow R and attack across the open ground, so the fighting reaches the
 * multi-level buildings, the orchards and the hill that the later Chapter A steps (levels, Bypass,
 * LOS heights, fortified buildings) are tested on. Every force and rule here is test-bed data, written
 * for the purpose; nothing is taken from a scenario card. Dev fixtures that jump to set positions in
 * this scenario are in `packages/content/src/fixtures.ts`. Both sides have ELR 1 and SAN 7 so that ELR failures
 * and sniper activations come up often in play tests.
 */
export const ASL_TESTBED_SCENARIO: ScenarioDef = {
  id: 'asl-testbed',
  ruleset: 'full-asl',
  product: 'demo',
  number: 'T1',
  title: 'T1 Full ASL Test Bed',
  place: 'Training ground, Eastern Front',
  boards: [{ board: 'u', position: '0,0' }],
  turns: 5,
  halfFinalTurn: false,
  month: 8,
  firstSide: 'ge',
  sides: [
    { side: 'ru', name: 'Russian', nationality: 'ru', elr: 1, san: 7, setupFirst: true },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 1, san: 7 },
  ],
  notes: [
    'Development test bed for the Full ASL rules: not a historical scenario, and not balanced. Its forces and rules change as the Chapter A work lands.',
    'Each side has a SAN for the full ASL sniper rules (A14), which are not in play yet.',
  ],
  forces: [
    {
      id: 'ru',
      side: 'ru',
      units: [
        { def: 'ru.L91', count: 1 },
        { def: 'ru.L70', count: 1 },
        { def: 'ru.458', count: 1, withSw: ['ru.MMG'] },
        { def: 'ru.458', count: 1 },
        { def: 'ru.447', count: 1, withSw: ['ru.HMG'] },
        { def: 'ru.447', count: 1, withSw: ['ru.LMG'] },
        { def: 'ru.447', count: 1 },
        { def: 'ru.527', count: 1 },
        { def: 'ru.426', count: 2 },
      ],
      setup: { kind: 'area', description: 'set up on/between hexrows C and P', hexes: hexesWhere('u', { rows: ['C', 'P'] }) },
    },
    {
      id: 'ge',
      side: 'ge',
      units: [
        { def: 'ge.L92', count: 1 },
        { def: 'ge.L80', count: 1 },
        { def: 'ge.838', count: 1, withSw: ['ge.FT', 'ge.DC'] },
        { def: 'ge.548', count: 1 },
        { def: 'ge.467', count: 1, withSw: ['ge.HMG'] },
        { def: 'ge.467', count: 1, withSw: ['ge.MMG'] },
        { def: 'ge.467', count: 1, withSw: ['ge.LMG'] },
        { def: 'ge.447', count: 2 },
      ],
      setup: { kind: 'area', description: 'set up on/between hexrows S and GG', hexes: hexesWhere('u', { rows: ['S', 'GG'] }) },
    },
  ],
  victoryText:
    'Test bed victory: the Germans win at game end if they Control at least four of the seven multi-hex stone buildings on/between hexrows I and P, and at least two Level 1 hill hexes.',
  victory: [
    {
      kind: 'all',
      side: 'ge',
      of: [
        { kind: 'controlBuildings', side: 'ge', buildings: TESTBED_VC_BUILDINGS, atLeast: 4 },
        { kind: 'controlHexes', side: 'ge', hexes: TESTBED_HILL_HEXES, atLeast: 2, hexesLabel: 'Level 1 hill hexes' },
      ],
    },
  ],
  ssr: [
    {
      module: 'fortified-buildings',
      params: { side: 'ru', count: 1, within: 'setup' },
      text: 'Before setting up, the Russian player secretly designates one building with a hex in the Russian setup area as Fortified (B23.9).',
    },
  ],
};

/** The scenarios that play under the Full ASL ruleset. */
export const ASL_SCENARIOS: ScenarioDef[] = [ASL_TESTBED_SCENARIO];
