import type { ScenarioDef } from '@asl/rules';
import { hexesWhere, hexMasses } from '../areas';

// ------------------------------------------------------------------ LMA7

/*
 * Boards v and t, both turned 180° (each letter at the top right of its box on the card's diagram), v west and t east,
 * the card's north up: v's hexrow A edge meets t's hexrow GG edge (their half hexes take v's names, v being listed
 * first). Only hexrows A-Q of v and Q-GG of t are in play. The south edge is the boards' printed row 1, the north edge
 * their row 10.
 */
const V_ROWS: [string, string] = ['A', 'Q'];
const T_ROWS: [string, string] = ['Q', 'GG'];

/**
 * The four hills of each board (VC), SSR 1 making the fields (grain) hills: on board v the three printed hills and the
 * O5 field, on board t the printed hill at R1-S2 and the three fields. Each is a mass of printed Level 1 hexes or of
 * grain hexes; the I4 hill and the O5 field touch at L4/M5 but are drawn as two hills.
 */
function hillsOf(board: 'v' | 't', rows: [string, string], names: string[]): { label: string; hexes: string[] }[] {
  const masses = [...hexMasses(board, hexesWhere(board, { rows, elevation: 1 })), ...hexMasses(board, hexesWhere(board, { rows, terrain: 'grain' }))];
  if (masses.length !== names.length) throw new Error(`LMA7: board ${board} has ${masses.length} hills, not ${names.length}`);
  return names.map((n) => {
    const hexes = masses.find((m) => m.includes(n));
    if (!hexes) throw new Error(`LMA7: ${n} is on no hill of board ${board}`);
    return { label: `hill ${n}`, hexes };
  });
}
export const LMA7_HILLS_V = hillsOf('v', V_ROWS, ['vC3', 'vI4', 'vH7', 'vO5']);
export const LMA7_HILLS_T = hillsOf('t', T_ROWS, ['tR2', 'tS6', 'tAA3', 'tCC8']);
/** "à placer sur les collines": every hex of the eight hills. */
export const LMA7_HILL_HEXES = [...LMA7_HILLS_V, ...LMA7_HILLS_T].flatMap((h) => h.hexes);

/** LMA7 Opération Brassard-2: Monte Costello (Ile d’Elbe, 17 June 1944). */
export const LMA_7: ScenarioDef = {
  id: 'lma-7',
  product: 'lma',
  number: 'LMA7',
  title: 'LMA7 Brassard 2: Monte Costello',
  designer: 'Laurent Martin',
  credit: 'Design: Laurent Martin. English translation after Eddy Houghton, revised for Open ASL.',
  place: 'Ile d’Elbe',
  date: '17 June 1944',
  history:
    'Having landed on the beach of Campo di Marina and secured it, the 13e Régiment de tirailleurs sénégalais is sent to the centre of the Ile d’Elbe to take the crests held by the Germans. The first battalion will attack Monte Bacille, while the second will try to take Monte Costello, which the Germans have prepared themselves to defend.',
  aftermath: 'The joint capture of Monte Bacille and Monte Costello by the tirailleurs opened the road to Portoferrajo, the capital of the island.',
  victoryText:
    'The French player wins if there is no longer any Good Order German unit on 3 of the 4 hills of each board, while losing fewer squads (or equivalent) than the German.',
  photo: { src: 'scenarios/lma-7.jpg' },
  notes: ['Only hexrows A-Q of board V and Q to GG of board T are usable.'],
  boards: [
    { board: 'v', position: '0,0', rotation: 180, columns: V_ROWS },
    { board: 't', position: '1,0', rotation: 180, columns: T_ROWS },
  ],
  turns: 7,
  halfFinalTurn: true,
  month: 6,
  firstSide: 'br',
  sides: [
    // The Free French use British counters; their American SW are American counters, so not captured (SSR 6).
    { side: 'br', name: 'Free French', nationality: 'br', nationalities: ['br', 'am'], elr: 4 },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3, setupFirst: true },
  ],
  nationalityNames: { br: 'Free French' },
  forces: [
    {
      id: 'br',
      group: 'Elements of the 2nd Battalion of the 13e régiment de tirailleurs sénégalais',
      side: 'br',
      units: [
        { def: 'br.458', count: 2, withSw: ['am.FT'] },
        { def: 'br.458', count: 1, withSw: ['am.DC'] },
        { def: 'br.457', count: 2, withSw: ['am.MMG'] },
        { def: 'br.457', count: 7 },
        { def: 'br.L91', count: 1 },
        { def: 'br.L81', count: 1 },
        { def: 'br.L80', count: 1 },
      ],
      setup: { kind: 'enter', turn: 1, edge: 'S', description: 'enter by the south edge' },
    },
    {
      id: 'ge',
      group: 'Elements of Festungs battalions of the coastal defence of the Ile d’Elbe',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 1, withSw: ['ge.MMG'] },
        { def: 'ge.467', count: 2, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 1, withSw: ['ge.MTR'] },
        { def: 'ge.467', count: 2 },
        { def: 'ge.L81', count: 1 },
        { def: 'ge.L80', count: 1 },
      ],
      setup: { kind: 'area', description: 'to be set up on the hills', hexes: LMA7_HILL_HEXES },
    },
    {
      id: 'ge-reinf',
      group: 'Reinforcements',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 2, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 1 },
        { def: 'ge.L80', count: 1 },
      ],
      // SSR 4: from Turn 1, in each German RPh, on a dr < twice the turn number.
      setup: { kind: 'enter', turn: 1, edge: 'N', description: 'arriving by the north edge (see SSR)', provisional: { drBelowTurnTimes: 2 } },
    },
  ],
  victory: [
    {
      kind: 'all',
      side: 'br',
      of: [
        { kind: 'clearAreas', side: 'br', areas: LMA7_HILLS_V, atLeast: 3, areasLabel: 'hills of board v' },
        { kind: 'clearAreas', side: 'br', areas: LMA7_HILLS_T, atLeast: 3, areasLabel: 'hills of board t' },
        { kind: 'fewerLosses', side: 'br', measure: 'squadEquivalents' },
      ],
    },
  ],
  ssr: [
    // Read here as: the grain hexes are hills, Level 1 Open Ground, for LOS, movement and Height Advantage.
    { module: 'redraw-terrain', params: { terrain: { grain: 'open' }, elevation: 1 }, text: 'The fields are in fact hills.' },
    {
      module: 'prepared-positions',
      params: { side: 'ge', tem: 1, rule: 'SSR 2' },
      text: 'The Germans having prepared the position, each German unit benefits from a +1 TEM (cumulative with the elevated position) as long as the unit does not leave its hex. This TEM is not regained by returning to the hex.',
    },
    { module: 'setup-deploy', params: { side: 'ge', squads: 3, rule: 'SSR 3' }, text: 'During his setup, the German player may split up to 3 squads into 6 half-squads.' },
    {
      module: 'entry-dr',
      text: 'During his RPh, the German player makes a dr; if it is less than twice the number of the current turn, the reinforcements arrive.',
    },
    {
      module: 'assault-fire',
      params: { side: 'br', defs: ['br.458', 'br.457'] },
      text: 'The French squads (458 and 457) all have Assault Fire, but are subject to Cowering.',
    },
    {
      module: 'captured-use-exempt',
      params: { side: 'br', defs: ['am.FT', 'am.MMG', 'am.DC'], rule: 'SSR 6' },
      text: 'There is no penalty for the use of American SW by the French.',
    },
  ],
  balance: [
    { side: 'br', text: 'Replace a 457 with a 458.', changes: [{ op: 'swapUnits', force: 'br', from: 'br.457', to: 'br.458', count: 1 }] },
    { side: 'ge', text: 'The reinforcements arrive from the first turn.', changes: [{ op: 'setEntryTurn', force: 'ge-reinf', turn: 1, noRoll: true }] },
  ],
};
