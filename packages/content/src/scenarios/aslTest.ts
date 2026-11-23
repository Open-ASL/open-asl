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
      params: { side: 'ru', count: 4, unit: 'location', exact: true, within: 'setup' },
      text: 'Before setting up, the Russian player secretly designates exactly four building Locations in hexes of the Russian setup area as Fortified Building Locations (B23.911); an upper level may be fortified only above a fortified ground level (B23.912).',
    },
    {
      module: 'hidden-units',
      params: { side: 'ru', quota: 1, notOpenGround: true, rule: 'SSR 2' },
      text: 'One Russian squad (or its equivalent) may set up using HIP (A12.3) in a hex that is not Open Ground.',
    },
    {
      module: 'fortifications',
      params: { side: 'ru', foxholes: 3, trenches: 2, wire: 2, roadblocks: 1, pillboxes: [{ capacity: 1, ca: 3, nca: 5 }], mines: { factors: 12, known: 6, dummies: 1, at: true }, within: 'setup', rule: 'SSR 3' },
      text: 'The Russians receive 3 squads of foxhole capacity, two trenches, two Wire counters, 12 A-P minefield factors (which may be exchanged for A-T mines, B28.5), 6 Known minefield factors with one Dummy Minefield counter, one roadblock and one 1+3+5 pillbox. They are set up in the Russian setup area with the Russian units, hidden or open per A12.33; minefields are recorded (B28.1).',
    },
  ],
};

/**
 * The test bed with fires already burning (full ASL B25) and the conditions a fire needs: EC Very Dry, a Mild Breeze
 * blowing north-east (hexside 5 of the hex grid), a Blaze in M3 (stone, ground), a Flame in L3 and burning woods at T2,
 * and K4 already stone rubble. Everything else is the test bed. Dev fixtures for spreading fire, collapse and Flame
 * clearance start here, where no die is needed to get a fire going.
 */
export const ASL_TESTBED_FIRE_SCENARIO: ScenarioDef = {
  ...ASL_TESTBED_SCENARIO,
  id: 'asl-testbed-fire',
  number: 'T2',
  title: 'T2 Full ASL Test Bed: Fire',
  ec: 'veryDry',
  weather: { wind: { from: 'SW', force: 'breeze', dir: 5 } },
  notes: [...ASL_TESTBED_SCENARIO.notes!, 'Fires burn at the start: a Blaze in M3 and the T2 woods, a Flame in L3, rubble in K4; the EC are Very Dry and a Mild Breeze blows north-east, so that Fire spreads fast.'],
  ssr: [
    ...ASL_TESTBED_SCENARIO.ssr,
    {
      module: 'fires',
      params: { blazes: ['uM3', 'uT2'], flames: ['uL3'], rubble: [{ hex: 'uK4', kind: 'stone' }] },
      text: 'M3 and the T2 woods are ablaze and L3 holds a Flame at the start; K4 is stone rubble. Environmental Conditions are Very Dry and a Mild Breeze blows toward the north-east.',
    },
  ],
};

/**
 * The test bed for minefields (full ASL B28): the Germans add a PzKpfw IVF2 and a PSW 234/1; the Russians have more
 * minefield factors (18 recorded, 24 Known: room for a Known belt, B28.46) and Booby Trap capability Level A on board u
 * (B28.9), Russians set up in P10 or O10 begin broken (for rout through and round minefields); the Known minefield the Russians put in N9 has a Trail Break from its O9 hexside to its M10 one, as if cleared.
 */
export const ASL_TESTBED_MINES_SCENARIO: ScenarioDef = {
  ...ASL_TESTBED_SCENARIO,
  id: 'asl-testbed-mines',
  number: 'T3',
  title: 'T3 Full ASL Test Bed: Minefields',
  forces: ASL_TESTBED_SCENARIO.forces.map((f) => (f.side === 'ge' ? { ...f, units: [...f.units, { def: 'ge.pzivf2', count: 1 }, { def: 'ge.psw2341', count: 1 }] } : f)),
  notes: [...ASL_TESTBED_SCENARIO.notes!, 'Minefields: the Germans add two AFV; the Russians have more mines, Booby Traps on board u and a Trail Break through N9.'],
  ssr: [
    ...ASL_TESTBED_SCENARIO.ssr.map((r) =>
      r.module === 'fortifications'
        ? {
            ...r,
            params: { ...r.params, mines: { factors: 18, known: 24, dummies: 1, at: true } },
            text: 'The Russians receive 3 squads of foxhole capacity, two trenches, two Wire counters, 18 A-P minefield factors (which may be exchanged for A-T mines, B28.5), 24 Known minefield factors with one Dummy Minefield counter, one roadblock and one 1+3+5 pillbox. They are set up in the Russian setup area with the Russian units, hidden or open per A12.33; minefields are recorded (B28.1).',
          }
        : r,
    ),
    {
      module: 'booby-traps',
      params: { side: 'ru', boards: ['u'], level: 'A', rule: 'SSR 4' },
      text: 'The Russians have Booby Trap capability Level A on board u (B28.9): a German Task Check of an Original 11 or 12 on board u causes Casualty Reduction to a unit of its Location.',
    },
    {
      module: 'trail-breaks',
      params: { tbs: [{ hex: 'uN9', sides: [2, 5] }] },
      text: 'N9 holds a Trail Break across its O9 and M10 hexsides (B24.74, B28.61).',
    },
    {
      module: 'set-up-broken',
      params: { side: 'ru', hexes: ['uP10', 'uO10'] },
      text: 'Russian units set up in P10 or O10 begin play broken, under DM.',
    },
  ],
};

/**
 * The test bed for pillboxes (full ASL B30): the Germans add a PzKpfw IVF2 and a PSW 234/1 (ordnance against a pillbox),
 * the Russians a 45L AT Gun with its crew (a Gun in a pillbox, B30.45); Russians set up in O6 begin broken (a broken unit
 * inside a pillbox, B30.5). The fortification counters are the test bed's.
 */
export const ASL_TESTBED_PILLBOX_SCENARIO: ScenarioDef = {
  ...ASL_TESTBED_SCENARIO,
  id: 'asl-testbed-pillbox',
  number: 'T4',
  title: 'T4 Full ASL Test Bed: Pillboxes',
  forces: ASL_TESTBED_SCENARIO.forces.map((f) =>
    f.side === 'ge'
      ? { ...f, units: [...f.units, { def: 'ge.pzivf2', count: 1 }, { def: 'ge.psw2341', count: 1 }] }
      : { ...f, units: [...f.units, { def: 'ru.228c', count: 1, withSw: ['ru.AT45L'] }] },
  ),
  notes: [...ASL_TESTBED_SCENARIO.notes!, 'Pillboxes: the Germans add two AFV and the Russians a 45L AT Gun with its crew; Russians set up in O6 begin broken.'],
  ssr: [
    ...ASL_TESTBED_SCENARIO.ssr,
    {
      module: 'set-up-broken',
      params: { side: 'ru', hexes: ['uO6'] },
      text: 'Russian units set up in O6 (inside a pillbox there too) begin play broken, under DM.',
    },
  ],
};

/** The scenarios that play under the Full ASL ruleset. */
export const ASL_SCENARIOS: ScenarioDef[] = [ASL_TESTBED_SCENARIO, ASL_TESTBED_FIRE_SCENARIO, ASL_TESTBED_MINES_SCENARIO, ASL_TESTBED_PILLBOX_SCENARIO];
