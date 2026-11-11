import type { ScenarioDef } from '@asl/rules';
import { buildingAt, hexesWithin, hexgrainSplit } from '../areas';

// ------------------------------------------------------------------ LMA9

/** LMA9's playing area: board z, hexrows I-GG, upright (north up). */
const LMA9_ROWS: [string, string] = ['I', 'GG'];
/** SSR 1: the Canadian deployment hexes. */
export const LMA9_DEPLOYMENT = ['zK8', 'zQ3', 'zW7'];
/** The Canadian setup: every hex within 2 hexes of a deployment hex. */
export const LMA9_CA_SETUP = [...new Set(LMA9_DEPLOYMENT.flatMap((h) => hexesWithin('z', h, 2)))].sort();
/** The road I5-Q1 (I5 J4 K4 L3 M3 N2 O2 P1 Q1): the German sets up north of it. */
export const LMA9_GE_SETUP = hexgrainSplit('z', ['I5', 'J4', 'K4', 'L3', 'M3', 'N2', 'O2', 'P1', 'Q1'], ['I', 'Q']).north;
/** The three buildings of the victory conditions. */
export const LMA9_VC_BUILDINGS = [buildingAt('z', 'zK9'), buildingAt('z', 'zS5'), buildingAt('z', 'zZ3')];
/** German Elite MMC (SSR 3), squads and the half-squads they reduce to. */
const LMA9_GE_ELITE = ['ge.548', 'ge.468', 'ge.238h', 'ge.248h'];

/** LMA9 Putot-en-Bessin 1 (Putot-en-Bessin, Normandie, 8 June 1944). */
export const LMA_9: ScenarioDef = {
  id: 'lma-9',
  product: 'lma',
  number: 'LMA9',
  title: 'LMA9 Putot-en-Bessin 1',
  designer: 'Laurent Martin',
  credit: 'Design: Laurent Martin. English translation after Eddy Houghton, revised for Open ASL.',
  place: 'Putot-en-Bessin, Normandie',
  date: '8 June 1944',
  history:
    'Having landed on 6 June in the Courcelles sector, where it suffered heavy losses, the Royal Winnipeg Rifles, of the 7th Brigade of the 3rd Canadian Infantry Division, was sent the next day to occupy Putot-en-Bessin, brushing aside elements of the Panzer-Lehr Division as it advanced.\n\nBut a quite different danger threatened them…\n\nDetermined to throw the Allies back into the sea, the redoubtable 12.SS-Panzer Division “Hitlerjugend” had just taken up position facing the Canadian troops.\n\nEarly on the morning of the 8th, the German grenadiers launched their assault on the village.',
  aftermath:
    'In furious fighting the Germans broke through the Canadian front lines, irresistibly tightening the vice around the Royal Winnipeg, now threatened with encirclement.\n\nThe Canadian riflemen held out at all costs, waiting for reinforcements that were slow to come.',
  victoryText: 'The German wins if he manages to take Control of 2 of the 3 buildings K9, S5, Z3.',
  photo: { src: 'scenarios/lma-9.jpg', caption: 'A wounded man of the 3rd Canadian Infantry Division receives first aid' },
  notes: ['Section d’assaut (a tribute to Vae Victis). SK scenario.', 'Hexrows I-GG inclusive only.'],
  boards: [{ board: 'z', position: '0,0', columns: LMA9_ROWS }],
  turns: 7,
  halfFinalTurn: false,
  month: 6,
  firstSide: 'ge',
  sides: [
    { side: 'br', name: 'Canadian', nationality: 'br', elr: 3, setupFirst: true },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 4 },
  ],
  nationalityNames: { br: 'Canadian' },
  forces: [
    {
      id: 'br',
      group: 'Elements of C Company, Royal Winnipeg Rifles',
      side: 'br',
      units: [
        { def: 'br.458', count: 2, withSw: ['br.MMG'] },
        { def: 'br.458', count: 3, withSw: ['br.LMG'] },
        { def: 'br.458', count: 1 },
        { def: 'br.457', count: 2, withSw: ['br.MTR'] },
        { def: 'br.457', count: 4 },
        { def: 'br.447', count: 4 },
        { def: 'br.L81', count: 1 },
        { def: 'br.L80', count: 2 },
        { def: 'br.L70', count: 1 },
      ],
      setup: {
        kind: 'area',
        description: 'Setup: see SSR 1 (within 2 hexes of K8, Q3 and W7, with at least 4 MMC, 1 leader and 1 SW by each)',
        hexes: LMA9_CA_SETUP,
        constraints: [{ kind: 'minWithin', anchors: LMA9_DEPLOYMENT, range: 2, mmc: 4, smc: 1, sw: 1 }],
      },
    },
    {
      id: 'ge',
      group: 'Elements of the 7th Company of Panzergrenadier-Rgt 26, 12th SS-Panzer-Division',
      side: 'ge',
      units: [
        { def: 'ge.548', count: 4, withSw: ['ge.LMG'] },
        { def: 'ge.548', count: 2 },
        { def: 'ge.468', count: 2, withSw: ['ge.MMG'] },
        { def: 'ge.468', count: 4 },
        { def: 'ge.L92', count: 2 },
        { def: 'ge.L91', count: 1 },
      ],
      setup: { kind: 'area', description: 'Set up north of the road I5-Q1', hexes: LMA9_GE_SETUP },
    },
  ],
  victory: [{ kind: 'controlBuildings', side: 'ge', buildings: LMA9_VC_BUILDINGS, atLeast: 2 }],
  ssr: [
    {
      module: 'setup-rule',
      text: 'The Canadian has 3 deployment hexes (K8, Q3, W7). During his setup he must place his units 2 hexes or less from each of the deployment hexes, with a minimum of 4 MMC, 1 leader and 1 SW for each of them.',
    },
    {
      module: 'offboard-artillery',
      params: { side: 'ge', label: '120mm Mortar', missions: 2, fp: 12, contact: 4, driftDrm: -2, rule: 'SSR 2' },
      text: 'The German player has 2 off-board mortar fire missions (1 mission at most per Game Turn). At the start of one of his Prep Fire Phases he may choose a target hex in the LOS of one of his leaders. He makes a dr; on 1-4 contact is made and the mission is fired. At the start of the Advancing Fire Phase of the same turn the fire arrives on the target: he makes a dr with a -2 drm; the result (from 0 to 4) is the distance in hexes from the target hex. If this distance is not 0, he makes a last dr to determine the direction from the target hex (1 = North, 2 = North-East, 3 = South-East, 4 = South, 5 = South-West, 6 = North-West) and so, with the distance, the hex finally hit. All units in the hex hit AND in the 6 hexes around it receive a 120mm mortar attack (one area DR per hex, with TEM). If contact is not made during the Prep Fire Phase, he may try again in his next Prep Fire Phase, until he has fired his 2 mortar missions. The leader acting as observer is marked with a Prep Fire counter.',
    },
    { module: 'broken-morale', params: { side: 'ge', add: 1, defs: LMA9_GE_ELITE }, text: 'German Elite units have their morale increased by 1 on their broken side.' },
  ],
  balance: [
    { side: 'br', text: 'Canadian: Replace a German 9-2 with an 8-1.', changes: [{ op: 'swapUnits', force: 'ge', from: 'ge.L92', to: 'ge.L81', count: 1 }] },
    { side: 'ge', text: 'German: Remove one Canadian MMG.', changes: [{ op: 'removeSw', force: 'br', sw: 'br.MMG', count: 1 }] },
  ],
};
