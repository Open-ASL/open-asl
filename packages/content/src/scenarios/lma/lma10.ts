import type { ScenarioDef } from '@asl/rules';
import { buildingAt, buildingHexesOf, hexesWhere, hexesWithin } from '../areas';

/** LMA10's playing area: board z hexrows I-GG. */
const LMA10_ROWS: [string, string] = ['I', 'GG'];
/** The three buildings of the Victory Conditions: K9 (zJ8, zK9, zL8), S5 and Z3. */
export const LMA10_VC_HEXES = ['zK9', 'zS5', 'zZ3'];
export const LMA10_BUILDINGS = LMA10_VC_HEXES.map((h) => buildingAt('z', h));
/** SSR 2: every playable hex ≤ 3 hexes from any hex of those three buildings. */
const inPlay = new Set(hexesWhere('z', { rows: LMA10_ROWS }));
export const LMA10_GE_SETUP = [
  ...new Set(LMA10_VC_HEXES.flatMap((h) => buildingHexesOf('z', h)).flatMap((b) => hexesWithin('z', b, 3).filter((x) => inPlay.has(x)))),
];
/** German Elite MMC (SSR 3): every German MMC of the OB. */
const LMA10_GE_ELITE = ['ge.548', 'ge.468', 'ge.238h', 'ge.248h'];

/** LMA10 Putot-en-Bessin 2 (Putot en Bessin, Normandy, 8 June 1944). Board z upright, hexrows I-GG. */
export const LMA_10: ScenarioDef = {
  id: 'lma-10',
  product: 'lma',
  number: 'LMA10',
  title: 'LMA10 Putot-en-Bessin 2',
  designer: 'Laurent Martin',
  credit: 'Design: Laurent Martin. English translation after Eddy Houghton, revised for Open ASL.',
  place: 'Putot en Bessin, Normandy',
  date: '8 June 1944',
  history:
    'After the furious attack of the “HitlerJürgend”, which forced the Canadians of the Royal Winnipeg Rifles to fall back and leave Putot en Bessin to the Germans, the staff of the 3rd Canadian Infantry Division prepared the counterattack.\n\nThat same day, late in the afternoon, the soldiers of the Canadian Scottish, supported by the First Hussar, set off once more to assault the village.',
  aftermath:
    'After violent fighting, the young Hitlerites of the 12th SS were forced to abandon the village of Putot-en-Bessin, which they had taken that very morning.',
  victoryText: 'The Canadians win if they succeed in taking Control of 2 of the 3 buildings K9, S5, Z3.',
  photo: { src: 'scenarios/lma-10.jpg' },
  notes: [
    'Card heading: “Section d’assaut” (Assault Section), Scénario SK. Hexrows I-GG inclusive only are in play.',
    'Engine note: the Victory Conditions are judged at game end (the card does not say “immediately”). SSR 1 changes the Smoke exponent of the Canadian units that have one (the 4-5-8s and 4-5-7s). SSR 4 sets the German Panzerfaust shots for the scenario to 5 (instead of 1.5 per German squad in the OB).',
  ],
  // Board z upright (the letter Z on the west side of the card's diagram), cut to hexrows I-GG.
  boards: [{ board: 'z', position: '0,0', columns: LMA10_ROWS }],
  turns: 6,
  halfFinalTurn: true,
  month: 6,
  firstSide: 'br',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 4, setupFirst: true },
    { side: 'br', name: 'Canadian', nationality: 'br', elr: 3 },
  ],
  nationalityNames: { br: 'Canadian' },
  forces: [
    {
      id: 'ge',
      group: 'Elements of the 7th company of Panzergrenadier-Rgt 26 of the 12th SS-Panzer-Division',
      side: 'ge',
      units: [
        { def: 'ge.548', count: 2, withSw: ['ge.MMG'] },
        { def: 'ge.548', count: 2 },
        { def: 'ge.468', count: 2, withSw: ['ge.LMG'] },
        { def: 'ge.468', count: 1 },
        { def: 'ge.238h', count: 2 },
        { def: 'ge.248h', count: 3 },
        { def: 'ge.L92', count: 1 },
        { def: 'ge.L91', count: 2 },
      ],
      setup: { kind: 'area', description: 'set up per SSR 2', hexes: LMA10_GE_SETUP },
    },
    {
      id: 'br',
      group: 'Elements of the First Canadian Scottish Regiment',
      side: 'br',
      units: [
        { def: 'br.458', count: 1, withSw: ['br.MMG'] },
        { def: 'br.458', count: 3, withSw: ['br.LMG'] },
        { def: 'br.458', count: 1 },
        { def: 'br.457', count: 1, withSw: ['br.LMG'] },
        { def: 'br.457', count: 2 },
        { def: 'br.447', count: 6 },
        { def: 'br.L81', count: 2 },
        { def: 'br.L80', count: 2 },
      ],
      setup: { kind: 'enter', turn: 1, edge: 'S', description: 'enter on the first turn along the South edge' },
    },
    {
      id: 'hussars',
      group: 'Armoured support from the First Hussars Regiment',
      side: 'br',
      units: [{ def: 'br.sheriiaa', count: 1 }],
      setup: { kind: 'enter', turn: 1, edge: 'S', description: 'enters on the first turn along the south edge' },
    },
  ],
  victory: [{ kind: 'controlBuildings', side: 'br', buildings: LMA10_BUILDINGS, atLeast: 2 }],
  ssr: [
    {
      module: 'smoke-exponent',
      params: { def: ['br.458', 'br.457'], add: 1 },
      text: 'Canadian units have their Smoke placement increased by +1.',
    },
    {
      module: 'setup-rule',
      text: 'The Germans set up anywhere ≤ 3 hexes from the buildings to be Controlled for victory.',
    },
    {
      module: 'broken-morale',
      params: { side: 'ge', add: 1, defs: LMA10_GE_ELITE },
      text: 'German Elite units have their morale increased by 1 on their broken side.',
    },
    {
      module: 'panzerfaust',
      params: { side: 'ge', shots: 5 },
      text: 'The initial number of German Panzerfausts is 5.',
    },
  ],
  balance: [
    { side: 'br', text: 'Replace the German 9-2 with an 8-1.', changes: [{ op: 'swapUnits', force: 'ge', from: 'ge.L92', to: 'ge.L81', count: 1 }] },
    { side: 'ge', text: 'Remove one Canadian LMG.', changes: [{ op: 'removeSw', force: 'br', sw: 'br.LMG', count: 1 }] },
  ],
};
