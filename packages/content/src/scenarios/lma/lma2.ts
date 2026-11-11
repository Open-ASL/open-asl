import type { ScenarioDef } from '@asl/rules';
import { boardHexes } from '../../maps';
import { edgeHexesWhere, hexesWhere } from '../areas';

/*
 * LMA2 Frères d’arme 2 (Laurent Martin): board z upright (its letter at the bottom left, hexrows I-Y in play) with the
 * card's north arrow pointing right, so the card's north is the board's east (hexrow GG), its east edge the board's
 * row 10 and its west edge row 1. Text translated from the French original.
 */

/** The card's north arrow points right on an upright board: north is the board's east. */
const NORTH_RIGHT = { N: 'E', E: 'S', S: 'W', W: 'N' } as const;
const ROWS: [string, string] = ['I', 'Y'];

const Z = boardHexes('z');
const buildingSize = new Map<string, number>();
for (const spec of Object.values(Z)) if (spec.buildingId) buildingSize.set(spec.buildingId, (buildingSize.get(spec.buildingId) ?? 0) + 1);
/** SSR 1: the AT Gun sets up in a single-hex building hex (hexrows I-Y). */
export const LMA2_SINGLE_HEX_BUILDINGS = hexesWhere('z', { rows: ROWS }).filter((h) => !!Z[h]?.buildingId && buildingSize.get(Z[h]!.buildingId!) === 1);
/** The Victory Condition hexes. */
export const LMA2_VC_HEXES = ['zP5', 'zR5', 'zP3', 'zR3'];
/** The card's east edge (board row 10), "between I and Q (inclusive)" or "between Q and Y (inclusive)". */
export const LMA2_ENTRY_IQ = edgeHexesWhere('z', 'S', ['I', 'Q']);
export const LMA2_ENTRY_QY = edgeHexesWhere('z', 'S', ['Q', 'Y']);

const SSR1 =
  'The German player sets up his HS at least 3 hexes from one another; the German AT Gun is HIP in a single-hex building hex.';
const GE_GROUP = 'Elements of the 6th Fallschirmjäger Regiment';

/** LMA2 Frères d’arme 2: Carentan (Faubourg de Carentan, France, June 1944). */
export const LMA_2: ScenarioDef = {
  id: 'lma-2',
  product: 'lma',
  number: 'LMA2',
  title: 'LMA2 Frères d’arme 2: Carentan',
  designer: 'Laurent Martin',
  credit: 'Design: Laurent Martin. English translation after Eddy Houghton, revised for Open ASL.',
  place: 'Faubourg de Carentan, France',
  date: 'June 1944',
  history:
    'The 506th Parachute Infantry Regiment of the American 101st Airborne Division, of which Easy Company is part, carries out a series of manoeuvres around Carentan during the night of 11 to 12 June 1944, and on the morning of the 12th attacks the town from the east side, where the houses sheltered Germans. Carentan had to be taken at all costs, for it is the main crossroads linking the Cotentin to the Calvados, and the Allied tanks had to pass through the town before attacking Cherbourg, one of the great objectives of the Battle of Normandy because of its deep-water port, which can take ships of heavy tonnage and so allow equipment to be unloaded faster and in greater quantity.',
  aftermath:
    'When the Germans open fire on the American soldiers, a very violent street fight begins. Shortly after the start of Easy’s attack, as the Americans begin to take control of part of the sector, the German gunners shell the district. When a large part of the sector is under American control, Lieutenant Richard “Dick” Winters is hit in the ankle by an enemy bullet in a street of Carentan. Easy will finally succeed in putting the last German defenders to flight.',
  victoryText: 'The American player wins if he controls hexes P5, R5, P3 and R3 at the end of the game.',
  photo: { src: 'scenarios/lma-2.jpg' },
  notes: ['The Story of Easy Company', 'The scenario is played between hexrows I and Y inclusive.'],
  boards: [{ board: 'z', position: '0,0', columns: ROWS }],
  compass: NORTH_RIGHT,
  turns: 6,
  halfFinalTurn: true,
  month: 6,
  firstSide: 'am',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3, setupFirst: true },
    { side: 'am', name: 'American', nationality: 'am', elr: 5 },
  ],
  forces: [
    {
      id: 'ge',
      group: GE_GROUP,
      side: 'ge',
      units: [
        { def: 'ge.238h', count: 2, withSw: ['ge.MMG'] },
        { def: 'ge.238h', count: 4 },
        { def: 'ge.L80', count: 1 },
      ],
      setup: {
        kind: 'area',
        description: 'Set up on the board (see SSR)',
        hexes: hexesWhere('z', { rows: ROWS }),
        // SSR 1: "his HS at least 3 hexes from one another".
        constraints: [{ kind: 'spacing', defs: ['ge.238h'], atLeast: 3 }],
      },
    },
    {
      // SSR 1: the AT Gun (and the crew manning it) in a single-hex building hex, HIP (`hip-required`).
      id: 'ge-gun',
      group: GE_GROUP,
      side: 'ge',
      units: [{ def: 'ge.228c', count: 1, withSw: ['ge.AT50L'] }],
      setup: { kind: 'area', description: 'Set up on the board (see SSR): the AT Gun HIP in a single-hex building hex', hexes: LMA2_SINGLE_HEX_BUILDINGS },
    },
    {
      id: 'ge-t2',
      group: GE_GROUP,
      side: 'ge',
      units: [
        { def: 'ge.548', count: 2, withSw: ['ge.LMG'] },
        { def: 'ge.548', count: 2 },
        { def: 'ge.L81', count: 1 },
      ],
      setup: { kind: 'enter', turn: 2, edge: 'W', description: 'Reinforcements on the second turn from the west' },
    },
    {
      id: 'am',
      group: 'Elements of Easy Company',
      side: 'am',
      units: [
        { def: 'am.747', count: 1, withSw: ['am.BAZ44'] },
        { def: 'am.747', count: 2, withSw: ['am.DC'] },
        { def: 'am.747', count: 6 },
        { def: 'am.L91', count: 1 },
        { def: 'am.L81', count: 1 },
      ],
      setup: {
        kind: 'enter',
        turn: 1,
        edge: 'E',
        hexes: [...new Set([...LMA2_ENTRY_IQ, ...LMA2_ENTRY_QY])],
        description: 'Enter from the east, either between I and Q (inclusive) or between Q and Y (inclusive)',
      },
    },
  ],
  victory: [{ kind: 'controlHexes', side: 'am', hexes: LMA2_VC_HEXES, atLeast: LMA2_VC_HEXES.length, hexesLabel: 'P5, R5, P3, R3' }],
  ssr: [
    { module: 'hip-required', params: { side: 'ge', defs: ['ge.AT50L'], rule: 'SSR 1' }, text: SSR1 },
    // The setup line's choice of entry stretch (not an SSR on the card): picked once the Germans have set up.
    {
      module: 'entry-stretch',
      params: {
        side: 'am',
        forces: ['am'],
        options: [
          { label: 'between I and Q (inclusive)', hexes: LMA2_ENTRY_IQ },
          { label: 'between Q and Y (inclusive)', hexes: LMA2_ENTRY_QY },
        ],
        rule: 'Setup',
      },
      part: true,
    },
  ],
  balance: [
    { side: 'ge', text: 'Add a 5-4-8 to the reinforcements.', changes: [{ op: 'addUnits', force: 'ge-t2', def: 'ge.548', count: 1 }] },
    { side: 'am', text: 'Add one game turn.', changes: [{ op: 'setTurns', turns: 7, halfFinalTurn: true }] },
  ],
};
