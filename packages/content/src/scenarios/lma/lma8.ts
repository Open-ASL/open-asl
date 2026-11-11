import type { ScenarioDef } from '@asl/rules';
import { buildMap } from '../../maps';
import { buildingAt, edgeHexesWhere } from '../areas';

/**
 * LMA8's map: boards Z (north) and W (south), each drawn on the card with its letter at the right-hand end, so both
 * turned 180°: board W's hexes A1-GG1 lie on the card's south edge, where the French enter. In the boards' own frame
 * they stand upright, W above Z (row 10 of W on row 1 of Z), and the card's north is the boards' south. Z is listed
 * first, so the half hexes they share keep Z's names (the Victory Conditions count buildings on board Z).
 */
export const LMA8_BOARDS: ScenarioDef['boards'] = [
  { board: 'z', position: '0,1' },
  { board: 'w', position: '0,0' },
];
/** Both boards turned 180°: the card's north is the boards' south. */
const TURNED = { N: 'S', E: 'W', S: 'N', W: 'E' } as const;
const LMA8_MAP = buildMap(
  LMA8_BOARDS.map((b) => ({ board: b.board, x: Number(b.position.split(',')[0]), y: Number(b.position.split(',')[1]) })),
  { los: 'grid', compass: TURNED },
);
/** German setup: anywhere on boards W and Z. */
export const LMA8_GE_SETUP = [...LMA8_MAP.hexes()].map((h) => h.id);
/** The three buildings of the Victory Conditions: Z5 (zZ5-zZ6), R3 (zR1-zR3, zS3) and M8 (zM8-zM9) on board Z. */
export const LMA8_VC_HEXES = ['zZ5', 'zR3', 'zM8'];
export const LMA8_BUILDINGS = LMA8_VC_HEXES.map((h) => buildingAt('z', h));
/** Entry of the 4th Tirailleurs Sénégalais: the south edge between wA1 and wQ1 inclusive (board W's row 1 faces south). */
export const LMA8_ENTRY_4E = edgeHexesWhere('w', 'N', ['A', 'Q']);
/** Entry of the 13th Tirailleurs Sénégalais: the south edge between wQ1 and wGG1 inclusive. */
export const LMA8_ENTRY_13E = edgeHexesWhere('w', 'N', ['Q', 'GG']);

/** The American SW the Free French carry (SSR 3). */
const AM_SW = ['am.MMG', 'am.FT', 'am.DC', 'am.MTR'];

/** LMA8 Brassard 3: Porto Ferraio (Porto Ferraio, Elba, 18 June 1944). Boards Z over W, both turned. */
export const LMA_8: ScenarioDef = {
  id: 'lma-8',
  product: 'lma',
  number: 'LMA8',
  title: 'LMA8 Brassard 3: Porto Ferraio',
  designer: 'Laurent Martin',
  credit: 'Design: Laurent Martin. English translation after Eddy Houghton, revised for Open ASL.',
  place: 'Porto Ferraio, Elba',
  date: '18 June 1944',
  history:
    'At dawn on 18 June 44, the French units moved off again. The 1st battalion of the 4th Tirailleurs Sénégalais seized the Villa Napoléon, followed by the 1st battalion of the 13th Tirailleurs Sénégalais, before descending on Porto Ferraio, the capital of the island.',
  aftermath:
    'With the capture of Porto Ferraio by the tirailleurs sénégalais, the conquest of Elba was well under way. The expeditionary corps now headed for the east of the island to reduce the last pockets of German resistance.',
  victoryText: 'The French player wins if he controls buildings zZ5, zR3 and zM8.',
  photo: { src: 'scenarios/lma-8.jpg', caption: 'French troops entering Porto Ferraio' },
  notes: [
    'Card heading: “Opération Brassard-3”, Porto Ferraio, Scénario SK.',
    'Engine note: the Victory Conditions are judged at game end (the card does not say “immediately”). SSR 2: every MMC cowers under the Starter Kit rules, so the French squads’ Cowering is the rule as usual; the engine adds their Assault Fire (a 4-5-8 replaced by a 4-5-7 through ELR keeps it). The German balance names “the Turn 2 reinforcements”, but the German reinforcements enter on Turn 3: the engine adds the 4-6-7 to those.',
  ],
  boards: LMA8_BOARDS,
  compass: TURNED,
  turns: 8,
  halfFinalTurn: true,
  month: 6,
  firstSide: 'br',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', nationalities: ['ge', 'it'], elr: 3, elrs: { it: 2 }, setupFirst: true },
    { side: 'br', name: 'Free French', nationality: 'br', nationalities: ['br', 'am'], elr: 4 },
  ],
  nationalityNames: { br: 'Free French', it: 'Italian' },
  forces: [
    {
      id: 'ge',
      group: 'Elements of the Festungs battalions of the Elba coastal defence',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 2, withSw: ['ge.MMG'] },
        { def: 'ge.467', count: 1, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 2 },
        { def: 'ge.447', count: 1, withSw: ['ge.MTR'] },
        { def: 'ge.447', count: 3 },
        { def: 'ge.L91', count: 1 },
        { def: 'ge.L80', count: 1 },
      ],
      setup: { kind: 'area', description: 'set up on boards W and Z', hexes: LMA8_GE_SETUP },
    },
    {
      id: 'ge-t3',
      group: 'Turn 3 reinforcements',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 2, withSw: ['ge.LMG'] },
        { def: 'ge.447', count: 2 },
        { def: 'ge.L81', count: 1 },
      ],
      setup: { kind: 'enter', turn: 3, edge: 'N', description: 'enter on Turn 3 from the north' },
    },
    {
      id: 'it',
      group: 'Italian militia',
      side: 'ge',
      units: [
        { def: 'it.336', count: 1 },
        { def: 'it.126h', count: 1 },
      ],
      setup: { kind: 'enter', turn: 4, edge: 'N', description: 'enter on Turn 4 from the north' },
    },
    {
      id: 'br-4e',
      group: 'Element of the 4th Tirailleurs Sénégalais',
      side: 'br',
      units: [
        { def: 'br.458', count: 1, withSw: ['am.FT'] },
        { def: 'br.458', count: 1, withSw: ['am.DC'] },
        { def: 'br.457', count: 1, withSw: ['am.MMG'] },
        { def: 'br.457', count: 1, withSw: ['am.DC'] },
        { def: 'br.457', count: 3 },
        { def: 'br.248h', count: 3 },
        { def: 'br.L92', count: 1 },
        { def: 'br.L80', count: 1 },
      ],
      setup: { kind: 'enter', turn: 1, edge: 'S', hexes: LMA8_ENTRY_4E, description: 'enter on the first turn from the south between A1 and Q1 inclusive' },
    },
    {
      id: 'br-13e',
      group: 'Element of the 13th Tirailleurs Sénégalais',
      side: 'br',
      units: [
        { def: 'br.458', count: 3 },
        { def: 'br.457', count: 1, withSw: ['am.MMG'] },
        { def: 'br.457', count: 3 },
        { def: 'br.247h', count: 1, withSw: ['am.MTR'] },
        { def: 'br.247h', count: 3 },
        { def: 'br.L91', count: 1 },
        { def: 'br.L81', count: 1 },
      ],
      setup: { kind: 'enter', turn: 1, edge: 'S', hexes: LMA8_ENTRY_13E, description: 'enter on the first turn from the south between Q1 and GG1 inclusive' },
    },
    {
      id: 'br-t2',
      group: 'Support',
      side: 'br',
      units: [
        { def: 'br.248h', count: 1, withSw: ['am.MMG'] },
        { def: 'br.daimac', count: 1 },
      ],
      setup: { kind: 'enter', turn: 2, edge: 'S', description: 'enter on the 2nd turn along the south edge' },
    },
  ],
  victory: [{ kind: 'controlBuildings', side: 'br', buildings: LMA8_BUILDINGS, atLeast: 3 }],
  ssr: [
    { module: 'no-panzerfaust', params: { side: 'ge', rule: 'SSR 1' }, text: 'German units are not equipped with Panzerfausts.' },
    {
      module: 'assault-fire',
      params: { side: 'br', defs: ['br.458', 'br.457'] },
      text: 'The French squads (458 and 457) all benefit from Assault Fire but suffer Cowering.',
    },
    { module: 'captured-use-exempt', params: { side: 'br', defs: AM_SW, rule: 'SSR 3' }, text: 'There is no penalty for the French using American SW.' },
    {
      module: 'self-rally-only',
      params: { side: 'ge', nationalities: ['it'], rule: 'SSR 4' },
      text: 'The Italian militia have an ELR of 2 and, if broken, may return to Good Order only on a successful self-rally.',
    },
  ],
  balance: [
    { side: 'br', text: 'Add one turn.', changes: [{ op: 'setTurns', turns: 9, halfFinalTurn: true }] },
    { side: 'ge', text: 'Add a 4-6-7 to the Turn 2 reinforcements.', changes: [{ op: 'addUnits', force: 'ge-t3', def: 'ge.467', count: 1 }] },
  ],
};
