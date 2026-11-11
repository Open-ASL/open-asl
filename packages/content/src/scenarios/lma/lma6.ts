import type { ScenarioDef } from '@asl/rules';
import { buildingHexesWhere, edgeHexesWhere, hexesWithin } from '../areas';

// ------------------------------------------------------------------ LMA6

/** Group A's entry: the south edge of board U, W10 to GG10 inclusive. */
const LMA6_A_ENTRY = edgeHexesWhere('u', 'S', ['W', 'GG']);
/**
 * Group B's entry: the south edge of board V (its hexrow 1, the board being turned), G1 to Q1 inclusive on the card;
 * hexrow Q is outside the playing area (only A-P of board V are in play), so G1 to P0.
 */
const LMA6_B_ENTRY = edgeHexesWhere('v', 'N', ['G', 'P']);
/** The VC's area: every building hex of board U's hexrows I to P. */
export const LMA6_VC_HEXES = buildingHexesWhere('u', { rows: ['I', 'P'] });

/** LMA6 Brassard 1: Marciana Marina (Opération Brassard, Ile d'Elbe, 17 June 1944). */
export const LMA_6: ScenarioDef = {
  id: 'lma-6',
  product: 'lma',
  number: 'LMA6',
  title: 'LMA6 Brassard 1: Marciana Marina',
  designer: 'Laurent Martin',
  credit: 'Design: Laurent Martin. English translation after Eddy Houghton, revised for Open ASL.',
  place: 'Marciana Marina, Ile d’Elbe',
  date: '17 June 1944',
  history:
    'Having destroyed several coastal batteries as it landed, Major Gamiez’s Bataillon de Choc pushes inland, towards the north-west of the island.\n\nA first combat group takes Monte Perone while another, from the west, takes the village of Marciana. Late in the afternoon they reach the outskirts of Marciana Marina, taking part of the German coastal defence from the rear.',
  aftermath:
    'After the capture of the town of Marciana Marina, the Ile d’Elbe was cut in two on the evening of 17 June; the French controlled its western part; they could prepare to attack the rest of it the next day.',
  victoryText: 'The French player wins if there are no Good Order German units left in the buildings of hexrows I to P of board U.',
  photo: { src: 'scenarios/lma-6.jpg', caption: 'Fernand Gambiez' },
  // Two landscape boards end to end, north up: V on the west turned 180° (its letter at the top right of its box),
  // U on the east upright (letter at the bottom left), their hexrows A meeting in the middle. Only hexrows A-P of
  // board V are in play. U is listed first so the shared half hexes keep U's names (the VC counts board U).
  boards: [
    { board: 'u', position: '1,0' },
    { board: 'v', position: '0,0', rotation: 180, columns: ['A', 'P'] },
  ],
  turns: 6,
  halfFinalTurn: true,
  month: 6,
  firstSide: 'br',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3, setupFirst: true },
    // British counters for the Free French; their MMG and DC are American counters (SSR 4: no Captured Use penalty).
    { side: 'br', name: 'Free French', nationality: 'br', nationalities: ['br', 'am'], elr: 5 },
  ],
  nationalityNames: { br: 'Free French' },
  notes: ['Only hexrows A-P of board V are playable.', '* see SSR 2', 'Engine note: hexrow Q of board V is out of play, so Group B enters between G1 and P0.'],
  forces: [
    {
      id: 'ge',
      group: 'Elements of the Festungs battalions of the Ile d’Elbe coastal defence',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 1, withSw: ['ge.MMG'] },
        { def: 'ge.467', count: 2, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 2 },
        { def: 'ge.L80', count: 1 },
      ],
      setup: { kind: 'area', description: 'At most one MMC per hex, ≤ 5 hexes from J5', hexes: hexesWithin('u', 'uJ5', 5), maxMmcPerHex: 1 },
    },
    {
      id: 'ge-t2',
      group: 'Turn 2 reinforcements',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 1, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 1 },
        { def: 'ge.L81', count: 1 },
      ],
      setup: { kind: 'enter', turn: 2, edge: 'N', hexes: edgeHexesWhere('u', 'N', ['I', 'K']), description: 'Turn 2 reinforcements, arriving from the north between I1 and K1 inclusive' },
    },
    {
      id: 'ge-t3',
      group: 'Turn 3 reinforcements',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 1, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 1, withSw: ['ge.MTR'] },
        { def: 'ge.467', count: 1 },
        { def: 'ge.L80', count: 1 },
      ],
      setup: { kind: 'enter', turn: 3, edge: 'N', hexes: edgeHexesWhere('u', 'N', ['I', 'O']), description: 'Turn 3 reinforcements, arriving from the north between I1 and O1 inclusive' },
    },
    {
      id: 'frA',
      group: 'Bataillon de Choc du Major Gambiez, Group A',
      side: 'br',
      units: [
        { def: 'br.458', count: 2, withSw: ['am.MMG'] },
        { def: 'br.458', count: 1, withSw: ['am.DC'] },
        { def: 'br.458', count: 6 },
        { def: 'br.L92', count: 1 },
        { def: 'br.L81', count: 1 },
      ],
      // Turn 1 is a placeholder: the SSR 1 dr gives the turn.
      setup: { kind: 'enter', turn: 1, edge: 'S', hexes: LMA6_A_ENTRY, description: 'Enters on Turn 1 or 2 (see SSR) along the south edge of board U, between W10 and GG10 inclusive' },
    },
    {
      id: 'frB',
      group: 'Bataillon de Choc du Major Gambiez, Group B',
      side: 'br',
      units: [
        { def: 'br.458', count: 1, withSw: ['am.MMG'] },
        { def: 'br.458', count: 1, withSw: ['am.DC'] },
        { def: 'br.458', count: 4 },
        { def: 'br.L91', count: 1 },
        { def: 'br.L80', count: 1 },
      ],
      // Turn 2 is a placeholder: the SSR 1 dr gives the turn.
      setup: { kind: 'enter', turn: 2, edge: 'S', hexes: LMA6_B_ENTRY, description: 'Enters on Turn 1 or 2 (see SSR) along the south edge of board V, between G1 and Q1 inclusive' },
    },
  ],
  victory: [{ kind: 'noGoodOrderEnemyIn', side: 'br', hexes: LMA6_VC_HEXES, hexesLabel: 'buildings of hexrows I to P of board U' }],
  ssr: [
    {
      module: 'entry-order-dr',
      params: {
        side: 'br',
        turn: 1,
        rule: 'SSR 1',
        outcomes: [
          { dr: [1, 4], turns: { frA: 1, frB: 2 } },
          { dr: [5, 6], turns: { frA: 2, frB: 1 } },
        ],
      },
      text: 'On the first turn, during his RPh, the French player rolls a dr; on a 1-4 Group A enters play on Turn 1 and Group B on Turn 2; on a 5-6 it is the reverse.',
    },
    {
      module: 'entry-losses',
      params: { side: 'br', forces: ['frA', 'frB'], from: 'br.458', to: 'br.457', divisor: 2, round: 'up', rule: 'SSR 2' },
      text: 'Following the day’s fighting, each group has suffered losses; as it arrives, a dr divided by 2 (FRU) is rolled for the group, which is the number of 4-5-8s that become 4-5-7s.',
    },
    {
      module: 'assault-fire',
      params: { side: 'br', defs: ['br.458', 'br.457'] },
      text: 'The French squads (4-5-8 and 4-5-7) all benefit from Assault Fire but are subject to Cowering, and the 4-5-8s have their Smoke exponent increased by 1.',
    },
    // They cower as every MMC does in the Starter Kit (the full-ASL British exemption, A25.45, is not applied).
    { module: 'smoke-exponent', params: { def: 'br.458', add: 1 }, part: true },
    {
      module: 'captured-use-exempt',
      params: { side: 'br', defs: ['am.MMG', 'am.DC'], rule: 'SSR 4' },
      text: 'There is no penalty for the French use of American SW.',
    },
  ],
  balance: [
    { side: 'br', text: 'Do not apply SSR 2 to Group B.', changes: [{ op: 'patchSsr', index: 1, params: { forces: ['frA'] } }] },
    { side: 'ge', text: 'Add a 4-6-7 to the Turn 2 reinforcements.', changes: [{ op: 'addUnits', force: 'ge-t2', def: 'ge.467', count: 1 }] },
  ],
};
