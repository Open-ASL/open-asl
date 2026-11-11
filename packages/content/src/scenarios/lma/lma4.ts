import type { ScenarioDef } from '@asl/rules';
import { buildMap } from '../../maps';
import { buildingAt, hexesWhere } from '../areas';

/** The card's north arrow points left, to board u's hexrow A edge: the card's south is board u's east edge (GG). */
const NORTH_LEFT = { N: 'W', E: 'N', S: 'E', W: 'S' } as const;

/** Board u's hexes on the road and between hexrows F and P inclusive (the PSW 234/2's setup, SSR 2). */
const U_MAP = buildMap([{ board: 'u', x: 0, y: 0 }], { los: 'grid' });
const isRoad = (features: string[]) => features.some((f) => f.startsWith('road:') || f === 'woods-road' || f === 'orchard-road');
export const LMA4_PSW_HEXES = hexesWhere('u', { rows: ['F', 'P'] }).filter((h) => isRoad(U_MAP.hex(h)?.features ?? []));

/** SSR 3: the road between S8 and Y10, hex by hex as it runs (S8-T8-U8-V7-W8-X8-Y9-Y10). */
export const LMA4_TANK_HEXES = ['uS8', 'uT8', 'uU8', 'uV7', 'uW8', 'uX8', 'uY9', 'uY10'];

/** The two buildings of the VC: I3 (I3-I5) and H7. */
export const LMA4_BUILDINGS = [buildingAt('u', 'uI3'), buildingAt('u', 'uH7')];

/** LMA4 Frères d’arme 4: Nuenen (the Netherlands, September 1944). */
export const LMA_4: ScenarioDef = {
  id: 'lma-4',
  product: 'lma',
  number: 'LMA4',
  title: 'LMA4 Frères d’arme 4: Nuenen',
  designer: 'Laurent Martin',
  credit: 'Design: Laurent Martin. English translation after Eddy Houghton, revised for Open ASL.',
  place: 'Nuenen, the Netherlands',
  date: 'September 1944',
  history:
    'The 101st Airborne was dropped over the Netherlands, where from 17 September 1944 it took part in Operation Market-Garden. A few days after fighting for the liberation of Eindhoven, elements of Easy Company were sent near the village of Nuenen to locate the German resistance to the north-east. They rode on British tanks. In the village the Allies ran into a detachment of a German Panzer brigade.',
  aftermath:
    'After violent fighting for control of Nuenen, the Allies were forced to fall back. The British General Staff, which commanded the 101st during Operation Market Garden, withdrew it from the front in October 1944.\n\nThe strategic plan of Market Garden was a failure, and it did not end the war by Christmas as Montgomery had planned.',
  victoryText: 'The Allies must Control buildings I3 and H7 at the end of the scenario.',
  photo: { src: 'scenarios/lma-4.jpg' },
  notes: [
    'Histoire de la Easy Compagny (The Story of Easy Company).',
    'Option: for purists of the series, the characteristics of the three British tanks may be changed to come closer to the Cromwells of the episode: MP = 18; Front Armor Factor = 6.',
    'Engine note: the card prints SK3 counters as stand-ins for the British tanks (3× 75, 2× *75 and 1× 76L Sherman-type counters); Open ASL uses the Cromwell IV counter for all of them (MP 18, front hull AF 6: the Option’s values).',
    'Engine note: brick buildings are stone buildings (SSR 1).',
    'Engine note: SSR 2’s hidden units are hidden by the screen only: the shared online recording carries their setup.',
  ],
  boards: [{ board: 'u', position: '0,0' }],
  compass: NORTH_LEFT,
  turns: 6,
  halfFinalTurn: true,
  month: 9,
  firstSide: 'am',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3, setupFirst: true },
    { side: 'am', name: 'American', nationality: 'am', nationalities: ['am', 'br'], elr: 5 },
  ],
  nationalityNames: { br: 'British' },
  forces: [
    {
      id: 'ge',
      group: 'Elements of Panzer Brigade 107',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 1, withSw: ['ge.MMG'] },
        { def: 'ge.467', count: 3 },
        { def: 'ge.L81', count: 1 },
        { def: 'ge.228c', count: 1, withSw: ['ge.AT50L'] },
        { def: 'ge.stgiiig', count: 1 },
        { def: 'ge.pzviel', count: 1 },
      ],
      setup: {
        kind: 'area',
        description: 'HIP on the map between hexrows F and P inclusive (set up per SSR 2)',
        hexes: hexesWhere('u', { rows: ['F', 'P'] }),
        // A Gun may not be hidden on a paved road (SK4 6.4), and these must be.
        constraints: [{ kind: 'notOnPavedRoad', defs: ['ge.AT50L'] }],
      },
    },
    {
      id: 'ge-psw',
      group: 'Elements of Panzer Brigade 107',
      side: 'ge',
      units: [{ def: 'ge.psw2342', count: 1 }],
      setup: { kind: 'area', description: 'the PSW 234/2 sets up on any road between hexrows F and P inclusive (SSR 2)', hexes: LMA4_PSW_HEXES },
    },
    {
      id: 'ge-reinf',
      group: 'Reinforcements',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 3 },
        { def: 'ge.L80', count: 1 },
      ],
      setup: { kind: 'enter', turn: 0, edge: 'S', description: 'Enter by the south edge on the turn following the first German fire (see SSR 4)' },
    },
    {
      id: 'am',
      group: 'Elements of Easy Company, 2nd Battalion, 506th Parachute Infantry Regiment, 101st US Airborne',
      side: 'am',
      units: [
        { def: 'am.747', count: 1, withSw: ['am.DC'] },
        { def: 'am.747', count: 1, withSw: ['am.BAZ44'] },
        { def: 'am.747', count: 1, withSw: ['am.MTR'] },
        { def: 'am.747', count: 6 },
        { def: 'am.L92', count: 1 },
        { def: 'am.L91', count: 1 },
        { def: 'am.L81', count: 1 },
      ],
      setup: {
        kind: 'area',
        description: 'anywhere, one hex from the tanks (set up per SSR 3)',
        hexes: hexesWhere('u', {}),
        constraints: [{ kind: 'nearVehicle', atMost: 1, atLeast: 1 }],
      },
    },
    {
      id: 'br',
      group: 'Armoured group of the Royal Armoured Corps (all British)',
      side: 'am',
      units: [{ def: 'br.cromiv', count: 6 }],
      setup: { kind: 'area', description: 'on the road between S8 and Y10 (set up per SSR 3)', hexes: LMA4_TANK_HEXES },
    },
  ],
  victory: [{ kind: 'controlBuildings', side: 'am', buildings: LMA4_BUILDINGS, atLeast: 2 }],
  ssr: [
    {
      module: 'redraw-terrain',
      params: { terrain: { 'building-wood': 'building-stone' }, noHills: true },
      text: 'Hills do not exist and the houses are all brick.',
    },
    {
      module: 'hidden-units',
      params: { side: 'ge', forces: ['ge'], rule: 'SSR 2' },
      text: 'Except for the PSW 234/2, ALL German units set up HIP between hexrows F and P inclusive; the PSW 234/2 sets up on any road in the same area.',
    },
    {
      module: 'setup-rule',
      text: 'The Allied tanks set up on the road between S8 and Y10; the infantry anywhere, one hex from the tanks.',
    },
    {
      module: 'entry-after-fire',
      params: { force: 'ge-reinf', firedBy: 'ge', rule: 'SSR 4' },
      text: 'The German reinforcement group enters by the south edge on the turn following the first German fire.',
    },
  ],
  balance: [
    { side: 'am', text: 'Add a BAZ44.', changes: [{ op: 'addSw', force: 'am', sw: 'am.BAZ44', to: 'am.747', count: 1 }] },
    { side: 'ge', text: 'Add a 4-6-7 to the reinforcements.', changes: [{ op: 'addUnits', force: 'ge-reinf', def: 'ge.467', count: 1 }] },
  ],
};
