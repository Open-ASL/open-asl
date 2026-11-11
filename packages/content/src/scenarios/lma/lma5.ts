import type { ScenarioDef } from '@asl/rules';
import { buildingHexesWhere, edgeHexesWhere, hexesWhere, hexesWithin } from '../areas';

/*
 * LMA5 "Frères d'arme – 5" (Laurent Martin): Easy Company at Foy, 13 January 1945. Board y with its letter at the top
 * right of the card's diagram, so turned 180°, and the card's north arrow pointing right: the card's north is the board's
 * hexrow A side, its east the board's row 1 side (Item Company enters "from the east between A1 and E1").
 */

/** The card's north is the board's west (hexrow A), its east the board's north (row 1). */
const COMPASS = { N: 'W', E: 'N', S: 'E', W: 'S' } as const;

/** SSR 1: the buildings between hexrows U and W inclusive (U3, U6, V6, W6). */
export const LMA5_UW_BUILDINGS = buildingHexesWhere('y', { rows: ['U', 'W'] });
/** SSR 1: "the village between I and N inclusive": every hex of hexrows I-N (the Gun and its crew set up there too). */
export const LMA5_VILLAGE = hexesWhere('y', { rows: ['I', 'N'] });
/** The tanks: ≤ 2 hexes from L6. */
export const LMA5_PANZER_SETUP = hexesWithin('y', 'yL6', 2);
/** Easy Company: between X0 and CC3 (hexrows X-CC, hexes numbered 0-3). */
export const LMA5_EASY_SETUP = hexesWhere('y', { rows: ['X', 'CC'], numbered: [0, 3] });
/** Item Company: from the east edge between A1 and E1. */
export const LMA5_ITEM_ENTRY = edgeHexesWhere('y', 'N', ['A', 'E']);
/** Lt Speirs: "on the X0-CC3 row", entering from the east edge along hexrows X-CC. */
export const LMA5_SPEIRS_ENTRY = edgeHexesWhere('y', 'N', ['X', 'CC']);

/** LMA5 Frères d’arme 5: Foy (Foy, Belgium, 13 January 1945). */
export const LMA_5: ScenarioDef = {
  id: 'lma-5',
  product: 'lma',
  number: 'LMA5',
  title: 'LMA5 Frères d’arme 5: Foy',
  designer: 'Laurent Martin',
  credit: 'Design: Laurent Martin. English translation after Eddy Houghton, revised for Open ASL.',
  place: 'Foy, Belgium',
  date: '13 January 1945',
  history:
    'On 13 January 1945, Easy Company (2nd Battalion, 506th Parachute Infantry Regiment, 101st US Airborne Division) launched the assault on the town of Foy. It had been snowing for a long time and the men sank deep into the snow. The watchword of this attack was speed: the attackers were not to stop, and the Germans would then be taken by surprise. Easy was to attack the town from the south and Item Company of the 3rd Battalion from the north.\n\nJust after the assault began, Lt Dike told his men to halt, right in the middle of an open field. They then became easy targets for the German defenders…',
  aftermath:
    'Captain Winters ordered Lieutenant Ronald Speirs to take over Dike’s command and lead the assault. He then made a legendary run, alone, from the forest to the centre of the town without being hit, which won him the admiration of his men. Speirs crossed the occupied town in order to make contact. Then Speirs turned back, crossed the German positions again, still under enemy fire, and rejoined Easy Company, which was starting to clear the first houses. Easy captured the town of Foy after a violent fight, but at what a price! Dike’s failings of command cost many lives. Easy Company was immediately taken from him, and he went to join the “Assistant Regimental S-3”.',
  victoryText:
    'The American player wins if, at the end of his MPh, he manages to bring together a unit of each company in the same building while having lost fewer MMC than the German player.',
  photo: { src: 'scenarios/lma-5.jpg' },
  notes: [
    'Card heading: “Frères d’arme – 5”, The story of Easy Company; Scénario SK.',
    'The American 6+1 leader is marked “ssr4” on the card: he is Lt Dike of SSR 4.',
    'Engine note: SSR 1 is applied as two German setup groups: three 4-6-7 squads and one LMG in the building hexes of hexrows U-W (U3, U6, V6, W6); everything else of the 76th Volksgrenadier (the balance 4-4-7 too) anywhere in hexrows I-N, read as the village (the AA Gun and its crew must set up there as well). The PzKpfw VIE and StuG IIIG set up ≤ 2 hexes from L6.',
    'Engine note: SSR 3’s hindrance is the snow of full ASL’s Falling Snow, a Low Visibility Hindrance (ASLRB E3.1, E3.711): it applies to every IFT attack (the farthest firer of a Fire Group sets it) and every To Hit DR, but not to Residual FP, and it does not by itself negate FFMO. The weather shows snow on the ground; Falling Snow is not set as well, as its own +1 would count the snow twice. Roads give no road movement rate and no road bonus.',
    'Engine note: SSR 4: Lt Dike’s Morale Check is taken as each American Rally Phase starts, from Turn 2. Failing it pins him for the rest of the game (he is pinned again whenever the Pin comes off) and Lt Speirs (10-2) enters the next Game Turn from the east edge along hexrows X-CC. Failing any other MC (fire, Leader Loss) does the same, the MC’s own result standing. It happens once.',
    'Engine note: the victory conditions are judged as each American MPh ends: one or more American MMC or SMC of Easy Company (Lt Speirs included) and of Item Company, in any state, in hexes of the same building, while fewer American MMC (squads, half-squads, crews) have been eliminated than German ones (a Casualty Reduction is not a lost MMC). Otherwise the Germans win.',
  ],
  boards: [{ board: 'y', position: '0,0' }],
  compass: COMPASS,
  turns: 6,
  halfFinalTurn: true,
  month: 1,
  // "The ground is covered with snow ... it is still snowing" (SSR 3): the snow's effects are SSR 3's own.
  weather: { sky: 'overcast', ground: 'snow' },
  firstSide: 'am',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3, setupFirst: true },
    { side: 'am', name: 'American', nationality: 'am', elr: 5 },
  ],
  forces: [
    {
      id: 'ge-uw',
      group: 'Elements of the 76th Volksgrenadier',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 1, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 2 },
      ],
      setup: {
        kind: 'area',
        description:
          'Set up on the map (see SSR 1): 3 squads and an LMG in the buildings between U and W inclusive',
        hexes: LMA5_UW_BUILDINGS,
      },
    },
    {
      id: 'ge-village',
      group: 'Elements of the 76th Volksgrenadier',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 1, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 5 },
        { def: 'ge.228c', count: 1, withSw: ['ge.AA88L'] },
        { def: 'ge.L81', count: 1 },
        { def: 'ge.L80', count: 1 },
      ],
      setup: {
        kind: 'area',
        description:
          'Set up on the map (see SSR 1): the rest of the units in the village between I and N inclusive',
        hexes: LMA5_VILLAGE,
      },
    },
    {
      id: 'ge-pz',
      group: 'Remnants of the 2nd Panzer Division',
      side: 'ge',
      units: [
        { def: 'ge.pzvie', count: 1 },
        { def: 'ge.stgiiig', count: 1 },
      ],
      setup: {
        kind: 'area',
        description:
          'Remnants of the 2nd Panzer Division (PzKpfw VIE and StuG IIIG), set up ≤ 2 hexes from L6',
        hexes: LMA5_PANZER_SETUP,
      },
    },
    {
      id: 'am-easy',
      group: 'Elements of Easy Company',
      side: 'am',
      units: [
        { def: 'am.747', count: 1, withSw: ['am.BAZ45'] },
        { def: 'am.747', count: 1, withSw: ['am.MTR'] },
        { def: 'am.747', count: 1, withSw: ['am.MMG'] },
        { def: 'am.747', count: 6 },
        { def: 'am.L91', count: 1 },
        { def: 'am.L81', count: 1 },
        { def: 'am.L61', count: 1 },
      ],
      setup: {
        kind: 'area',
        description: 'Elements of Easy Company, set up between X0 and CC3',
        hexes: LMA5_EASY_SETUP,
      },
    },
    {
      id: 'am-speirs',
      group: 'Easy Company: Lt Speirs (SSR 4)',
      side: 'am',
      units: [{ def: 'am.L102', count: 1 }],
      setup: {
        kind: 'enter',
        turn: 3,
        edge: 'E',
        hexes: LMA5_SPEIRS_ENTRY,
        provisional: 'ssr',
        description:
          'Lt Speirs (10-2) appears as a reinforcement the turn after Lt Dike fails a MC, on the X0-CC3 row (SSR 4)',
      },
    },
    {
      id: 'am-item',
      group: 'Elements of Item Company',
      side: 'am',
      units: [
        { def: 'am.747', count: 1, withSw: ['am.BAZ44'] },
        { def: 'am.747', count: 1, withSw: ['am.DC'] },
        { def: 'am.747', count: 4 },
        { def: 'am.L81', count: 1 },
        { def: 'am.L80', count: 1 },
      ],
      setup: {
        kind: 'enter',
        turn: 2,
        edge: 'E',
        hexes: LMA5_ITEM_ENTRY,
        provisional: { drAtMost: { 2: 3, 3: 6 } },
        description:
          'Elements of Item Company, arriving on turn 2 or 3 (see SSR 2) from the east between A1 and E1',
      },
    },
  ],
  victory: [
    {
      kind: 'all',
      side: 'am',
      atEndOfPhase: 'MPh',
      of: [
        {
          kind: 'forcesInBuilding',
          side: 'am',
          groups: [
            { forces: ['am-easy', 'am-speirs'], label: 'Easy Company' },
            { forces: ['am-item'], label: 'Item Company' },
          ],
        },
        { kind: 'fewerMmcLost', side: 'am' },
      ],
    },
  ],
  ssr: [
    {
      module: 'setup-rule',
      text: 'The German player sets up 3 squads and an LMG in the buildings between U and W inclusive; the rest of his units in the village between I and N inclusive.',
    },
    {
      module: 'entry-dr',
      text: 'On turn 2 the US player rolls a die; if dr = 1, 2 or 3 the Item Company reinforcements enter that turn; otherwise they enter on turn 3.',
    },
    {
      module: 'roads-open-ground',
      params: { rule: 'SSR 3' },
      text: 'The ground is covered with snow; roads are treated as Open Ground. As it is still snowing, fire at more than 6 hexes has a +1 hindrance; at more than 12 hexes, +2; at more than 18 hexes, +3.',
    },
    {
      module: 'range-hindrance',
      part: true,
      params: {
        bands: [
          { over: 6, drm: 1 },
          { over: 12, drm: 2 },
          { over: 18, drm: 3 },
        ],
        label: 'snow',
        rule: 'SSR 3',
      },
    },
    {
      module: 'leader-relief',
      params: {
        side: 'am',
        force: 'am-easy',
        leader: 'am.L61',
        name: 'Lt Dike',
        fromTurn: 2,
        replacement: { force: 'am-speirs', name: 'Lt Speirs' },
        rule: 'SSR 4',
      },
      text: 'At each American RPh, from the second turn on, the American 6+1 leader (Lt Dike) takes a MC; if he fails it he is Pinned for the rest of the game and a 10-2 leader (Lt Speirs) appears as a reinforcement the following turn on the X0-CC3 row; this event also takes place if the 6+1 leader fails a MC during combat.',
    },
  ],
  balance: [
    {
      side: 'ge',
      text: 'For the German, add a 4-4-7.',
      changes: [{ op: 'addUnits', force: 'ge-village', def: 'ge.447', count: 1 }],
    },
    {
      side: 'am',
      text: 'For the American, add one turn.',
      changes: [{ op: 'setTurns', turns: 7, halfFinalTurn: true }],
    },
  ],
};
