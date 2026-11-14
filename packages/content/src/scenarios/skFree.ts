import type { ScenarioDef } from '@asl/rules';
import { boardHexes, buildMap } from '../maps';
import { buildingAt, buildingHexesWhere, buildingsWhere, edgeHexesWhere, hexesWhere, hexesWithin, multiHexBuildingsWhere } from './areas';

/*
 * The ASL Starter Kit scenario cards MMP publishes free at mmpgamers.com/aslsk-downloads-ezp-6,
 * encoded from the cards. Every piece of text here (history, aftermath, victory conditions,
 * special rules, balance, setup instructions, credits, notes) is the card's own, word for word,
 * and the photographs are the cards' photographs. Three scenarios are playable with Starter
 * Kit #1 content (infantry on boards y and z); the rest need counters, boards or rules from
 * later kits and are catalogued as coming soon with the card's text but no force data.
 */

/** Board y turned 90° counterclockwise: hexrow A faces south, row 1 faces west (as on the S1 card). */
const Y_PORTRAIT = { N: 'E', E: 'S', S: 'W', W: 'N' } as const;
/** A board turned 180° (its letter at the top right): the card's north is the board's south. */
const TURNED = { N: 'S', E: 'W', S: 'N', W: 'E' } as const;

const SK2 = 'ASL Starter Kit #2 (guns, British and Italian infantry, boards v–x)';
const SK3 = 'ASL Starter Kit #3 (tanks, boards t–u)';

// ------------------------------------------------------------------ S7

/**
 * S7 Prelude to Festung Brest (Plouzane, France, 26 August 1944). Board z turned 180°: the card's diagram puts the
 * unplayable hexrows A–G (and the board letter) at the east end, so "east of R" is H–R and "west of Z" is Z–GG
 * (read unturned, north is the wrong way round and the two setup areas overlap in R–Z).
 */
export const SK_S7: ScenarioDef = {
  id: 'sk-s7',
  product: 'sk-dl',
  number: 'S7',
  title: 'S7 Prelude to Festung Brest',
  designer: 'Laurent Closier',
  place: 'Plouzane, France',
  date: '26 August 1944',
  history:
    'The Operation “Chastity” offensive was planned to gain control of the large harbors of Brest and Lorient whose facilities were needed to provide the logistical support the Allies would need to drive across France. General Ramcke and the 2nd Fallschirmjäger Division were primarily responsible for the defense of Brest. Ramcke formed a defensive line five miles from the center of the city. Loyal to the Führer, he directed the fallschirmjägers to hold the line to the last man. It was not until August 23rd, when three Infantry Divisions from the VIII Corps arrived, that the Americans had enough strength to actually begin the offensive.',
  aftermath:
    'The small town of Plouzané was the first objective of the 175th Infantry Regiment of the 29th Infantry Division. They attacked Plouzané, held by fallschirmjägers and a marine unit from the Brest Naval Base. The German troops held the town in the morning before ignoring Ramcke’s orders and withdrawing to a nearby hill, Coz Castel, which dominated the entire area. The Germans would not be driven from Coz Castel until September 3rd, and Brest held until September 18th.',
  victoryText:
    'Provided the Germans do not amass ≥ 9 CVP, the Americans win at game end if they Control ≥ 15 stone building hexes in the German setup area and/or there are no unbroken German MMC in stone building hexes. Each squad is worth 2 casualty victory points (CVP) while each half-squad is worth 1. Leaders are worth 1 CVP each plus 1 CVP for a "-1" modifier.',
  photo: { src: 'scenarios/sk-s7.jpg' },
  notes: ['(Only hexrows H-GG are playable)'],
  boards: [{ board: 'z', position: '0,0', columns: ['H', 'GG'] }],
  compass: TURNED,
  turns: 6,
  halfFinalTurn: true,
  month: 8,
  firstSide: 'am',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3, setupFirst: true },
    { side: 'am', name: 'American', nationality: 'am', elr: 3 },
  ],
  forces: [
    {
      id: 'ge',
      group: 'Elements of 12th Company, 3rd Battalion, 2nd Fallschirmjäger Regiment, 2nd Fallschirmjäger Division',
      side: 'ge',
      units: [
        { def: 'ge.548', count: 2, withSw: ['ge.LMG'] },
        { def: 'ge.548', count: 1 },
        { def: 'ge.468', count: 3 },
        { def: 'ge.L91', count: 1 },
        { def: 'ge.L80', count: 1 },
      ],
      setup: { kind: 'area', description: 'set up on/east-of hexrow R', hexes: hexesWhere('z', { rows: ['H', 'R'] }) },
    },
    {
      id: 'am',
      group: 'Elements of 2nd Battalion, 175th Infantry Regiment, 29th Infantry Division',
      side: 'am',
      units: [
        { def: 'am.666', count: 2, withSw: ['am.MMG'] },
        { def: 'am.666', count: 7 },
        { def: 'am.L81', count: 1 },
        { def: 'am.L80', count: 1 },
      ],
      setup: { kind: 'area', description: 'set up on/west-of hexrow Z', hexes: hexesWhere('z', { rows: ['Z', 'GG'] }) },
    },
  ],
  victory: [
    {
      kind: 'all',
      side: 'am',
      of: [
        { kind: 'cvpBelow', side: 'am', cvp: 9 },
        {
          kind: 'any',
          side: 'am',
          of: [
            { kind: 'controlHexes', side: 'am', hexes: hexesWhere('z', { rows: ['H', 'R'], terrain: 'building-stone' }), atLeast: 15 },
            { kind: 'noGoodOrderEnemyIn', side: 'am', hexes: hexesWhere('z', { rows: ['H', 'GG'], terrain: 'building-stone' }), mmcOnly: true },
          ],
        },
      ],
    },
  ],
  ssr: [],
  balance: [
    { side: 'ge', text: 'Add one LMG to the German OB.', changes: [{ op: 'addSw', force: 'ge', sw: 'ge.LMG', to: 'ge.468', count: 1 }] },
    { side: 'am', text: 'Add one 6-6-6 to the U.S. OB.', changes: [{ op: 'addUnits', force: 'am', def: 'am.666', count: 1 }] },
  ],
};

// ------------------------------------------------------------------ S8

/** S8 Ad Hoc at Chef-du-Pont (Chef-du-Pont, France, 6 June 1944). */
export const SK_S8: ScenarioDef = {
  id: 'sk-s8',
  product: 'sk-dl',
  number: 'S8',
  title: 'S8 Ad Hoc at Chef-du-Pont',
  designer: 'Jon Mishcon and Joe Suchar',
  credit: 'Scenario Concept: Jon Mishcon and Joe Suchar',
  place: 'Chef-du-Pont, France',
  date: '6 June 1944',
  history:
    'One of the responsibilities of the airborne troops landing behind Utah Beach was the seizure of several key bridges following the D-Day drop. Brigadier General James Gavin, Assistant Divisional Commander of the 82nd Airborne, found himself as the senior officer near one of these bridges, the one at Chef-du-Pont that led to the causeway over the flooded Merderet marshes. Once Col. Maloney arrived with an extra 75 men, Gavin organized a pickup force to take care of this bridge himself. With elements of the 507th split into two groups under himself and the 507th C.O. Lt. Col. Ostberg, they marched on Chef-du-Pont by parallel routes.',
  aftermath:
    'After sizing up the situation Gavin and Ostberg attacked. Their combined forces flushed the Germans from the hamlet at the approaches to the bridge. Instead of giving up, however, the Germans fell back onto the causeway with their machine guns, and Col. Ostberg was wounded in the run up to the bridge. With the open ground covered by this heavy firepower, the paratroopers were denied the bridge for now.',
  victoryText:
    'The American player wins by exiting ≥ 1 squad (or 2 HS) and ≥ 1 SMC off Q10. For every German HS that exits off of Q10 the Americans must exit an additional HS (each squad counting as two HS).',
  photo: { src: 'scenarios/sk-s8.jpg' },
  boards: [{ board: 'y', position: '0,0' }],
  turns: 6,
  halfFinalTurn: false,
  month: 6,
  firstSide: 'am',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 4, setupFirst: true },
    { side: 'am', name: 'American', nationality: 'am', elr: 5 },
  ],
  forces: [
    {
      id: 'ge',
      group: 'Elements of Grenadier Regiment 1057, 91st Air Landing Division',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 1, withSw: ['ge.MMG'] },
        { def: 'ge.467', count: 2, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 1 },
        { def: 'ge.447', count: 3 },
        { def: 'ge.L91', count: 1 },
        { def: 'ge.L81', count: 1 },
        { def: 'ge.L80', count: 1 },
      ],
      setup: { kind: 'area', description: 'set up in hexes numbered ≥ 4', hexes: hexesWhere('y', { numbered: [4, 10] }) },
    },
    {
      id: 'am-gavin',
      group: 'Elements of 507th Parachute Infantry Regiment, 82nd Airborne Division — Gavin-Maloney Force',
      side: 'am',
      units: [
        { def: 'am.747', count: 6 },
        { def: 'am.L102', count: 1 },
        { def: 'am.L80', count: 1 },
      ],
      // "on/between Y1-GG4" turns the north-east corner: Y1-GG1 along the north edge, GG1-GG4 along the east.
      setup: { kind: 'enter', turn: 1, edge: 'N,E', hexes: [...edgeHexesWhere('y', 'N', ['Y', 'GG']), 'yGG2', 'yGG3', 'yGG4'], description: 'enters on Turn 1 along the north-east edge on/between Y1-GG4' },
    },
    {
      id: 'am-ostberg',
      group: 'Elements of 507th Parachute Infantry Regiment, 82nd Airborne Division — Ostberg Force',
      side: 'am',
      units: [
        { def: 'am.747', count: 4 },
        { def: 'am.L92', count: 1 },
      ],
      setup: { kind: 'enter', turn: 1, edge: 'N', hexes: edgeHexesWhere('y', 'N', ['A', 'I']), description: 'enters on Turn 1 along the north edge on/west-of I1' },
    },
  ],
  exits: [
    { side: 'am', hexes: ['yQ10'] },
    { side: 'ge', hexes: ['yQ10'] },
  ],
  victory: [{ kind: 'exitForce', side: 'am', hsEquivalents: 2, smc: 1, perEnemyHsExit: 1 }],
  ssr: [],
  balance: [
    { side: 'ge', text: 'Add one MMG to the German OB.', changes: [{ op: 'addSw', force: 'ge', sw: 'ge.MMG', to: 'ge.447', count: 1 }] },
    { side: 'am', text: 'Add a 7-0 to the Ostberg Force.', changes: [{ op: 'addUnits', force: 'am-ostberg', def: 'am.L70', count: 1 }] },
  ],
};

// ------------------------------------------------------------------ S19

/** Board y hexes of the woods mass around CC6, which the card plays as Open Ground. */
const CC6_WOODS = ['yCC6', 'yCC5', 'yDD6', 'yEE7', 'yFF7', 'yEE8', 'yFF8', 'yGG7', 'yCC4', 'yCC3', 'yCC2', 'yBB2', 'yBB1', 'yCC1'];

/** Hexrow L and the ends of hexrows M-Q: the south, east and west board edges from Q10 to Q1. */
const S19_SOUTH_EXITS = [...hexesWhere('y', { rows: ['L', 'L'] }), ...hexesWhere('y', { rows: ['M', 'Q'], numbered: [1, 1] }), ...hexesWhere('y', { rows: ['M', 'Q'], numbered: [10, 10] })];

/** S19 Purple Heart Lane (Carentan, France, 12 June 1944). */
export const SK_S19: ScenarioDef = {
  id: 'sk-s19',
  product: 'sk-dl',
  number: 'S19',
  title: 'S19 Purple Heart Lane',
  designer: 'Brian Youse',
  place: 'Carentan, France',
  date: '12 June 1944',
  history:
    'Having secured the area behind Utah Beach, and with the 29th Infantry having captured Isigny, it was now up to the 101st Airborne to take Carentan to allow the linkup of the two American beachheads. The 327th Glider Infantry Regiment would clear the area between Isigny and Carentan and attack the city from the east. The 502nd Parachute Infantry Regiment would have to attack over a causeway banked six to nine feet above the marshlands of the Douve that crossed four bridges over branches of the river and canals. Tough fighting got the 502nd over the fourth bridge outside of town, where they faced a series of determined German counterattacks until relieved by the 506th PIR. On the morning of June 12th, Colonel Robert Sink ordered the 506th’s 2nd Battalion to attack into Carentan.',
  aftermath:
    'A squad of men followed Lt. Harry Walsh into town, but, facing machinegun fire from the edge of town, the rest of his men froze in the ditches alongside the road. With Battalion HQ yelling encouragement from the rear, acting Company Commander Lt. Dick Winters jumped into the road and screamed for his men to follow. Having never heard Winters scream before, Easy Company quickly attacked down the road, distracting the enemy machinegun nest enough for Lt. Walsh and his men to neutralize it. As the 2nd Battalion entered town, the 327th also attacked from the east and met up with the paratroopers in the center of town. The trap was closed, and the objective secured, but few prisoners were captured. Oberst Friedrich von der Heydte commanding the 6th Parachute Regiment had pulled most of his men out of town the evening before, leaving behind one company to hold out while he prepared a counterattack from the west. The opposing paratroopers were not done with each other yet.',
  victoryText:
    'The Americans win at game end by Controlling ≥ 6 buildings south of hexrow Z. For each German MMC which exits the map increase the number of buildings needed by 1 (see SSR 3).',
  photo: { src: 'scenarios/sk-s19.jpg' },
  notes: [
    '(Only hexrows L-CC are playable)',
    'Engine note: German reinforcements enter along the south edge; the east and west board edges from Q10 to Q1 are not yet offered for entry.',
  ],
  boards: [{ board: 'y', position: '0,0', columns: ['L', 'CC'] }],
  compass: Y_PORTRAIT,
  turns: 6,
  halfFinalTurn: false,
  month: 6,
  firstSide: 'am',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 5, setupFirst: true },
    { side: 'am', name: 'American', nationality: 'am', elr: 5 },
  ],
  forces: [
    {
      id: 'ge-start',
      group: 'Elements of 6th Fallschirmjäger Regiment',
      side: 'ge',
      units: [
        { def: 'ge.238h', count: 2, withSw: ['ge.LMG'] },
        { def: 'ge.L80', count: 1 },
        { def: 'ge.L70', count: 1 },
      ],
      setup: {
        kind: 'area',
        description: 'set up on/between hexrows X-S in hexes numbered ≥ 2 and ≤ 8 (see SSR 2)',
        hexes: hexesWhere('y', { rows: ['S', 'X'], numbered: [2, 8] }),
        maxMmcPerHex: 1,
      },
    },
    {
      id: 'ge-t1',
      group: 'Elements of 6th Fallschirmjäger Regiment',
      side: 'ge',
      units: [
        { def: 'ge.548', count: 1, withSw: ['ge.LMG'] },
        { def: 'ge.548', count: 1, withSw: ['ge.DC'] },
        { def: 'ge.548', count: 2 },
        { def: 'ge.L91', count: 1 },
        { def: 'ge.L80', count: 1 },
      ],
      setup: { kind: 'enter', turn: 1, edge: 'S', hexes: S19_SOUTH_EXITS, description: 'Enter on/after Turn 1 along the south/east/west board edges from Q10-Q1' },
    },
    {
      id: 'am-z7',
      group: 'Elements of 2nd Battalion, 506th Parachute Infantry Regiment, 101st Airborne Division',
      side: 'am',
      units: [
        { def: 'am.747', count: 1 },
        { def: 'am.L80', count: 1 },
      ],
      setup: { kind: 'hexes', hexes: ['yZ7', 'yZ7'], description: 'Set up in hex Z7' },
    },
    {
      id: 'am-cc7',
      group: 'Elements of 2nd Battalion, 506th Parachute Infantry Regiment, 101st Airborne Division',
      side: 'am',
      units: [{ def: 'am.747', count: 1 }],
      setup: { kind: 'hexes', hexes: ['yCC7'], description: 'Set up in hex CC7' },
    },
    {
      id: 'am-t1',
      group: 'Elements of 2nd Battalion, 506th Parachute Infantry Regiment, 101st Airborne Division',
      side: 'am',
      units: [
        { def: 'am.747', count: 5 },
        { def: 'am.L92', count: 1 },
        { def: 'am.L91', count: 1 },
        { def: 'am.L81', count: 1 },
      ],
      setup: { kind: 'enter', turn: 1, edge: 'N', hexes: ['yCC7'], description: 'Enter on/after Turn 1 on hex CC7' },
    },
  ],
  exits: [{ side: 'ge', hexes: S19_SOUTH_EXITS, fromTurn: 4 }],
  victory: [{ kind: 'controlBuildings', side: 'am', buildings: buildingsWhere('y', { rows: ['L', 'Y'] }), atLeast: 6, perEnemyExit: 1 }],
  ssr: [
    {
      module: 'terrain-override',
      params: { terrain: { grain: 'flooded' }, hexes: Object.fromEntries(CC6_WOODS.map((h) => [h, 'open'])) },
      text: 'All grain hexes are flooded hexes and may not be entered by any unit nor do they act as an obstacle/hindrance. Smoke may not be placed in a flooded hex. The CC6 woods mass is considered Open Ground (ignore the woods illustrations).',
    },
    { module: 'text', text: 'The German at-start LMG must setup in separate hexes.' },
    { module: 'text', text: 'Beginning on Turn 4 German units may exit the map along the south/east/west board edges from Q10-Q1 during the MPh/APh.' },
  ],
  balance: [
    { side: 'ge', text: 'Replace one LMG with a MMG in the German OB.', changes: [{ op: 'swapUnits', force: 'ge-start', from: 'ge.LMG', to: 'ge.MMG', count: 1 }] },
    { side: 'am', text: 'Add one BAZ 44 to the U.S. reinforcements.', changes: [{ op: 'addSw', force: 'am-t1', sw: 'am.BAZ44', to: 'am.747', count: 1 }] },
  ],
};

// ------------------------------------------------------------------ S17

/** The British victory area: board x on/east-of hexrow K (the board is playable to P). */
const S17_EAST_OF_K = hexesWhere('x', { rows: ['K', 'P'] });

/** S17 A Ridge Too Far (Amfréville, France, 8 June 1944). */
export const SK_S17: ScenarioDef = {
  id: 'sk-s17',
  product: 'sk-dl',
  number: 'S17',
  title: 'S17 A Ridge Too Far',
  designer: 'NJ Hickman',
  credit: 'Scenario Designer: NJ Hickman',
  place: 'Amfréville, France',
  date: '8 June 1944',
  history:
    'On D-Day, the 1st Special Service Brigade landed under fire on Sword Beach at H+90 and made the long trek to cross the Orne River Bridge (Pegasus Bridge) at Benouville and establish a defensive perimeter against counterattack on the far eastern flank of the beachhead. Central to the defense of the area was the town of Amfréville, situated on a low ridge which afforded a dominating view up and down the flat coastline. On the morning of D+2, 6 Troop, defending the road junction leading north from Ranville to Sallenellas and west to Bas de Breville, sighted troops approaching up the latter road. 6 Troop had been hit hard during the landings and was grossly understrength, although they were bolstered by a detachment from the heavy weapons platoon. Lt. John Alderson decided not to wait and launched an attack of his own, intending to catch the approaching Germans on their flank and to drive into their rear.',
  aftermath:
    'In the early months of 1944, the Commandos had nearly doubled the number of Brens issued per Troop, giving them firepower similar to a regular Rifle Company which was twice the size of a Commando Troop. This extra firepower came into its own this day as the depleted Commando troop took on at least a full company. As Alderson had intended, their aggressiveness masked their small numbers. The Germans had not expected to be attacked and were soundly beaten. The Germans lost 60 men killed and wounded and a further 45 men were captured. In return the men of 6 Troop lost one man with seven others wounded.',
  victoryText:
    'The British win at game end if they have ≥ 9 VP of Good Order infantry on/east-of hexrow xK. Each squad and crew is worth 2 VP, each HS is worth 1 VP, and each leader is worth 1 VP plus 1 VP for each minus modifier (i.e., a 9-2 leader is worth 3 VP).',
  photo: { src: 'scenarios/sk-s17.jpg' },
  notes: ['(Only hexrows A-P on both boards are playable)'],
  // Board x upright on the east (letter bottom left), board w turned 180° on the west (letter top right): their
  // hexrow A edges meet and share the A half hexes (named on board x, listed first).
  boards: [
    { board: 'x', position: '1,0', columns: ['A', 'P'] },
    { board: 'w', position: '0,0', rotation: 180, columns: ['A', 'P'] },
  ],
  turns: 6,
  halfFinalTurn: false,
  month: 6,
  firstSide: 'br',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 2, setupFirst: true },
    { side: 'br', name: 'British', nationality: 'br', elr: 5 },
  ],
  forces: [
    {
      id: 'ge',
      group: 'Elements of 346th Infantry Division',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 1, withSw: ['ge.MMG'] },
        { def: 'ge.467', count: 3, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 2 },
        { def: 'ge.447', count: 6 },
        { def: 'ge.L81', count: 1 },
        { def: 'ge.L80', count: 1 },
        { def: 'ge.L70', count: 1 },
      ],
      setup: {
        kind: 'area',
        description: 'set up on board x on/east-of hexrow B with no more than one MMC per hex and not adjacent to any other MMC',
        hexes: hexesWhere('x', { rows: ['B', 'P'] }),
        maxMmcPerHex: 1,
        constraints: [{ kind: 'spacing', defs: ['ge.467', 'ge.447'], atLeast: 2 }],
      },
    },
    {
      id: 'br',
      group: 'Elements of 6 Troop, 3 Commando, 1st Special Service Brigade',
      side: 'br',
      units: [
        { def: 'br.648', count: 1, withSw: ['br.MMG'] },
        { def: 'br.648', count: 3, withSw: ['br.LMG'] },
        { def: 'br.458', count: 1, withSw: ['br.LMG'] },
        { def: 'br.458', count: 1, withSw: ['br.MTR'] },
        { def: 'br.458', count: 2 },
        // The 3-in. mortar's range is 3-63 from September 1942 ("[3-63]S2+" on the counter).
        { def: 'br.228c', count: 1, withSw: ['br.MTR76'] },
        { def: 'br.L92', count: 1 },
        { def: 'br.L91', count: 1 },
        { def: 'br.L81', count: 1 },
      ],
      // Board w is turned 180°: hexrow A is at its east edge, so "on/west-of hexrow B" is B-P of the playable area.
      setup: { kind: 'area', description: 'set up on board w on/west-of hexrow B', hexes: hexesWhere('w', { rows: ['B', 'P'] }) },
    },
  ],
  victory: [{ kind: 'goodOrderVp', side: 'br', hexes: S17_EAST_OF_K, vp: 9, hexesLabel: 'on/east-of hexrow xK' }],
  ssr: [
    {
      module: 'redraw-terrain',
      params: { terrain: { woods: 'orchard' }, nonInherent: true },
      text: 'Treat all Woods hexes as non-inherent Orchards (i.e., only the actual woods art acts as a +1 hindrance).',
    },
    {
      module: 'assault-fire',
      params: { side: 'br', defs: ['br.648', 'br.458'] },
      text: 'All British squads may use Assault Fire. British Elite and 1st Line MMC do not Cower (3.2.2).',
    },
    { module: 'no-cower', params: { side: 'br', qualities: ['E', '1'] }, part: true },
  ],
  balance: [
    { side: 'ge', text: 'Increase British VP requirements to 11.', changes: [{ op: 'setVictoryVp', index: 0, vp: 11 }] },
    { side: 'br', text: 'Add two 2-4-8 HS to the British OB.', changes: [{ op: 'addUnits', force: 'br', def: 'br.248h', count: 2 }] },
  ],
};

// ------------------------------------------------------------------ S18

const S18_RUBBLE = ['woods', 'orchard'];
const S18_WEST_OF_O = new Set(hexesWhere('z', { rows: ['L', 'O'] }));
/** The German setup area: building and rubble (woods/orchard, SSR 1) hexes within two hexes of N1 on/west-of hexrow O. */
export const S18_GE_SETUP = hexesWithin('z', 'zN1', 2).filter((h) => {
  const t = boardHexes('z')[h]?.terrain ?? '';
  return S18_WEST_OF_O.has(h) && (t.startsWith('building') || S18_RUBBLE.includes(t));
});
/** Within 4 hexes of S5 (all inside the playable hexrows L-X). */
export const S18_RU_SETUP = hexesWithin('z', 'zS5', 4);

/** S18 Baking Bread (Red Barricades, Stalingrad, 25 October 1942). */
export const SK_S18: ScenarioDef = {
  id: 'sk-s18',
  product: 'sk-dl',
  number: 'S18',
  title: 'S18 Baking Bread',
  designer: 'Ken Dunn and Brian Youse',
  credit: 'Scenario Adaptation: Ken Dunn and Brian Youse',
  place: 'Red Barricades, Stalingrad',
  date: '25 October 1942',
  history:
    'Throughout the grueling month of October, determined and costly German assaults had steadily shrunk the Soviet defensive perimeter. By October 24, Panzer Division 14 had reached “Bread Factory #2” just to the south of the Barikady and commenced its assault the next day, only to be rebuffed by the fierce defensive fire of the 138th Rifle Division. The remnants of Motorcycle Battalion 64 were crouched in the ruins opposite the Bread Factory, slain and wounded leaders scattered about them. There seemed to be no way across the deadly street, but Sgt. Esser could no longer stand the tension. Screaming “Forward!” he led his twelve men out into the road and into the adjacent building.',
  aftermath:
    'Just before Esser’s attack, Lt. Stempel led the grenadiers of the 103rd Panzergrenadier Regiment against the Bread Factory from a different direction. The Soviet defenders, distracted by this attack, didn’t see Esser’s cyclists until they were already in the cover of the Administrative Block. With Germans on both sides now, the Soviets were hard pressed. They were forced to fall back until reinforcements arrived in the form of rear echelon personnel pressed into service, including ferrymen from the nearby ferry landings. Thus bolstered, the Russians managed to stop the advance, but not before the Germans had captured an anti-tank gun, several machine guns, and an important toe-hold in the Bread Factory.',
  victoryText: 'The Germans win at game end if they control buildings P2 and P3.',
  photo: { src: 'scenarios/sk-s18.jpg' },
  notes: ['(Only hexrows L-X are playable)'],
  // Board z upright (its letter at the bottom left), cut to hexrows L-X.
  boards: [{ board: 'z', position: '0,0', columns: ['L', 'X'] }],
  turns: 6,
  halfFinalTurn: false,
  month: 10,
  firstSide: 'ge',
  sides: [
    { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3, setupFirst: true },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 4 },
  ],
  forces: [
    {
      id: 'ru',
      group: 'Remnants of 768th Rifle Regiment',
      side: 'ru',
      units: [
        { def: 'ru.458', count: 1, withSw: ['ru.MMG'] },
        { def: 'ru.458', count: 2, withSw: ['ru.LMG'] },
        { def: 'ru.447', count: 5 },
        { def: 'ru.L91', count: 1 },
        // The commissar (SSR 3).
        { def: 'ru.L61', count: 1 },
      ],
      setup: {
        kind: 'area',
        description: 'set up within 4 hexes of S5 with no more than one MMC (and any SW/SMC stacked with it) per location',
        hexes: S18_RU_SETUP,
        maxMmcPerHex: 1,
      },
    },
    {
      id: 'ru-at',
      group: 'Remnants of 768th Rifle Regiment',
      side: 'ru',
      units: [{ def: 'ru.228c', count: 1, withSw: ['ru.AT45L'] }],
      setup: { kind: 'area', description: 'Set up within 4 hexes of S5 (may stack with another MMC)', hexes: S18_RU_SETUP },
    },
    {
      id: 'ru-adhoc',
      group: 'Ad Hoc Reinforcements',
      side: 'ru',
      units: [
        { def: 'ru.527', count: 1, withSw: ['ru.LMG'] },
        { def: 'ru.426', count: 3 },
        { def: 'ru.L80', count: 1 },
      ],
      setup: { kind: 'enter', turn: 3, edge: 'E', description: 'enter on Turn 3 along east edge' },
    },
    {
      id: 'ge-krad',
      group: 'Elements of Kradschützenbataillon 64',
      side: 'ge',
      units: [
        { def: 'ge.548', count: 1, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 1, withSw: ['ge.DC'] },
        { def: 'ge.467', count: 1 },
        { def: 'ge.L91', count: 1 },
      ],
      setup: { kind: 'area', description: 'set up in building/rubble (see SSR 1) within two hexes of N1 and on/west-of hexrow O', hexes: S18_GE_SETUP },
    },
    {
      id: 'ge-103',
      group: 'Elements of Panzergrenadier Regiment 103',
      side: 'ge',
      units: [
        { def: 'ge.468', count: 1, withSw: ['ge.HMG'] },
        { def: 'ge.468', count: 1, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 1, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 4 },
        { def: 'ge.L92', count: 1 },
        { def: 'ge.L70', count: 1 },
      ],
      setup: { kind: 'enter', turn: 1, edge: 'W', description: 'enter on Turn 1 along west edge' },
    },
    {
      id: 'ge-pz14',
      group: 'Elements of Panzer Division 14',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 1, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 2 },
        { def: 'ge.L81', count: 1 },
      ],
      // The west edge of the playable area is hexrow L: its hexes within 2 hexes of L7.
      setup: { kind: 'enter', turn: 2, edge: 'W', hexes: ['zL5', 'zL6', 'zL7', 'zL8', 'zL9'], description: 'enter on Turn 2 within 2 hexes of L7' },
    },
  ],
  victory: [{ kind: 'controlBuildings', side: 'ge', buildings: [buildingAt('z', 'zP2'), buildingAt('z', 'zP3')], atLeast: 2 }],
  ssr: [
    {
      module: 'redraw-terrain',
      params: { terrain: { woods: 'rubble-stone', orchard: 'rubble-stone' } },
      text: 'All woods and orchards are stone rubble. These hexes cost 3 MF to enter, have a +3 TEM, block LOS as if an inherent building (including along hexsides), and are ambush terrain.',
    },
    { module: 'ambush-drm', params: { side: 'ru', qualities: ['E', '1'], drm: -1, rule: 'SSR 2' }, text: 'Russian elite and 1st-Line units receive a -1 drm to their Ambush dr.' },
    {
      module: 'commissar',
      params: { side: 'ru', leaders: { 'ru.L61': { morale: 10, leadership: 0 } }, rule: 'SSR 3' },
      text: 'The Russian 6+1 leader represents a commissar with a morale level of 10 and a leadership modifier of 0 to whom ELR can not apply. All Russian units stacked with this unpinned and unbroken commissar have their morale level raised by one and do not add the +4 DM DRM when rallying. The commissar must attempt to rally each broken Russian unit stacked with him; any unit that does not rally is replaced by the next lowest quality unit; if no lower quality unit exists, the unit suffers casualty reduction.',
    },
  ],
  balance: [
    { side: 'ru', text: 'The Russian reinforcements enter on Turn 2.', changes: [{ op: 'setEntryTurn', force: 'ru-adhoc', turn: 2 }] },
    {
      side: 'ge',
      text: 'Add one 5-4-8 and LMG to the German at-start force.',
      changes: [
        { op: 'addUnits', force: 'ge-krad', def: 'ge.548', count: 1 },
        { op: 'addSw', force: 'ge-krad', sw: 'ge.LMG', to: 'ge.548', count: 1 },
      ],
    },
  ],
};

// ------------------------------------------------------------------ S28

/** S28 Russian setup: board v in hexes numbered ≥ 6, and board u (its row 0 half hexes are v's row 10). */
export const S28_RU_SETUP = [...hexesWhere('v', { numbered: [6, 10] }), ...hexesWhere('u', { numbered: [1, 10] })];
/** S28 exit hexes: uI10 and uQ10, and for Infantry the south edge hexes adjacent to them. */
export const S28_EXITS = ['uI10', 'uQ10'];
export const S28_INFANTRY_EXITS = ['uH10', 'uJ10', 'uP10', 'uR10'];

/** S28 Out of Luck (Baruth, Germany, 26 April 1945). */
export const SK_S28: ScenarioDef = {
  id: 'sk-s28',
  product: 'sk-dl',
  number: 'S28',
  title: 'S28 Out of Luck',
  designer: 'Brian Youse',
  place: 'Baruth, Germany',
  date: '26 April 1945',
  history:
    'The Ninth Army was trapped and encircled between the two Soviet Fronts which were competing to take the ultimate prize—Berlin. Having convinced Hitler that he could link up with the Twelfth Army and drive to the defense of Berlin, the Ninth’s commander, General Theodor Busse ordered a break out to the west with the goal of reaching the Western Allies. He directed Kampfgruppe von Luck from the 21st Panzer Division and Kampfgruppe Pipkorn from the 35th SS Police Grenadier Division with armored support from the remains of the 10th SS Panzer Division “Frundsberg” to hold the town of Halbe for the exit point of the encirclement. To reach Halbe, the battlegroups had to take the valley town of Baruth and use its road, since the remainder of the valley was useless for tanks. Anticipating this move, the Russians had placed the 50th Guards Rifle Division and dug in Stalin tanks to hold this vital town.',
  aftermath:
    'Colonel Hans von Luck’s battlegroup met fierce resistance from the prepared Russians. He dispatched a column to attempt to bypass north of the town but was frustrated by the drainage ditches and marshy farmlands that hindered movement when vehicles strayed from the road. After many hours of fighting von Luck was forced to withdraw, but the way was blocked. Disobeying his orders, he told his men to disband and move towards the Elbe as best they could. He was captured by the Soviets the next day while attempting to get back to headquarters.',
  victoryText:
    'The Germans win immediately upon exiting ≥ 33 VP off hexes uI10 and/or uQ10. Infantry may also exit from hexes adjacent to uI10 and/or uQ10. Each squad is worth 2VP, each half-squad is worth 1VP, each “-2” SMC is worth 3VP, each “-1” SMC is worth 2VP, each “-0” and “+1” SMC is worth 1VP. Each PzVG is worth 8VP, and each JgPz 38(t) is worth 7VP.',
  photo: { src: 'scenarios/sk-s28.jpg' },
  notes: [
    'Engine note: SSR 1 is not rolled for a hex entered along a road (the road, not the wet ground beside it). SSR 3 applies to To Hit shots at the dug-in AFV itself (Vehicle Target Type).',
  ],
  // Two landscape boards stacked, both upright (each letter at its bottom left): v on top, u below.
  // v is listed first, so the half hexes they share keep v's names (vX10).
  boards: [
    { board: 'v', position: '0,0' },
    { board: 'u', position: '0,1' },
  ],
  turns: 7,
  halfFinalTurn: true,
  month: 4,
  firstSide: 'ge',
  sides: [
    { side: 'ru', name: 'Russian', nationality: 'ru', elr: 4, setupFirst: true },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 2 },
  ],
  forces: [
    {
      id: 'ru',
      group: 'Elements of 50th Guards Rifle Division',
      side: 'ru',
      units: [
        { def: 'ru.628', count: 2, withSw: ['ru.MMG'] },
        { def: 'ru.628', count: 2, withSw: ['ru.LMG'] },
        { def: 'ru.458', count: 2, withSw: ['ru.LMG'] },
        { def: 'ru.458', count: 1, withSw: ['ru.ATR'] },
        { def: 'ru.458', count: 4 },
        { def: 'ru.228c', count: 1, withSw: ['ru.AR122L'] },
        { def: 'ru.L91', count: 1 },
        { def: 'ru.L80', count: 1 },
        { def: 'ru.IS2', count: 3 },
      ],
      setup: { kind: 'area', description: 'set up on board v in hexes numbered ≥ 6 and on board u (see SSR 3)', hexes: S28_RU_SETUP },
    },
    {
      id: 'ge',
      group: 'Elements of 21st Panzer Division, 35th SS Police Grenadier Division, and 10th SS Panzer Division “Frundsberg”',
      side: 'ge',
      units: [
        { def: 'ge.468', count: 2, withSw: ['ge.MMG'] },
        { def: 'ge.467', count: 4, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 2, withSw: ['ge.PSK'] },
        { def: 'ge.467', count: 4 },
        { def: 'ge.447', count: 6 },
        { def: 'ge.L92', count: 1 },
        { def: 'ge.L91', count: 1 },
        { def: 'ge.L80', count: 2 },
        { def: 'ge.pzvg', count: 4 },
        { def: 'ge.jgpz38', count: 3 },
      ],
      setup: { kind: 'enter', turn: 1, edge: 'N', description: 'enter on Turn 1 along the north edge' },
    },
  ],
  exits: [{ side: 'ge', hexes: S28_INFANTRY_EXITS, infantryOnly: true }],
  victory: [{ kind: 'exitVp', side: 'ge', edge: 'S', hexes: S28_EXITS, vp: 33, immediate: true, vehicleVp: { 'ge.pzvg': 8, 'ge.jgpz38': 7 } }],
  ssr: [
    { module: 'immobilization-dr', params: { terrains: ['open', 'brush', 'grain'], notHill: true, atLeast: 11, rule: 'SSR 1' }, text: 'AFV must make a DR for each non-Hill Open Ground, Brush, or Grain hex entered. On a DR ≥ 11 that vehicle is immobilized in that hex.' },
    { module: 'terrain-cost', params: { terrains: ['grain', 'brush'], mf: 1.5, vehicleMp: 2, rule: 'SSR 2' }, text: 'All Grain/Brush represent wetland hexes and are treated as Grain hexes for Hindrance purposes and cost 1.5MF for infantry to enter and 2MP for vehicles to enter (in addition to SSR 1).' },
    // Grain plays as Grain (a Hindrance) in April.
    { module: 'season-override', params: { grain: true }, part: true },
    { module: 'dig-in', params: { side: 'ru', thDrm: 1, rule: 'SSR 3' }, text: 'The Russian player may elect to dig-in any of his AFV. Doing so means the vehicle may never move from the setup hex or change its VCA. There is a +1 TH DRM for all attacks against a dug-in AFV, and any hull hit is treated as a miss.' },
    { module: 'attack-drm', params: { drm: 1, label: 'pre-dawn darkness', rule: 'SSR 4' }, text: 'Due to the pre-dawn darkness, all IFT/TH shots receive a +1 DRM which does not cancel FFMO or Interdiction.' },
  ],
  balance: [
    {
      side: 'ru',
      text: 'Add one 2-2-8 and one P Obr. 31 to the Russian OB.',
      changes: [
        { op: 'addUnits', force: 'ru', def: 'ru.228c', count: 1 },
        { op: 'addSw', force: 'ru', sw: 'ru.AR122L', to: 'ru.228c', count: 1 },
      ],
    },
    { side: 'ge', text: 'Extend the game length to 7½ Turns.', changes: [{ op: 'setTurns', turns: 8, halfFinalTurn: true }] },
  ],
};

// ------------------------------------------------------------------ S29

/** S29's playing area: board w hexrows G-X. */
const S29_ROWS: [string, string] = ['G', 'X'];
/** Building P1 (wO3, wP1, wP2), and the other multi-hex buildings wholly within the playing area. */
export const S29_P1 = buildingAt('w', 'wP1');
export const S29_OTHER_BUILDINGS = multiHexBuildingsWhere('w', { rows: S29_ROWS }).filter((b) => b !== S29_P1);

/** S29 No Monumental Acclaim (Le Muy, France, 16 August 1944). */
export const SK_S29: ScenarioDef = {
  id: 'sk-s29',
  product: 'sk-dl',
  number: 'S29',
  title: 'S29 No Monumental Acclaim',
  place: 'Le Muy, France',
  date: '16 August 1944',
  history:
    'The capture of the town of Le Muy was a D-Day objective for the units of the Allied 1st Airborne Task Force. However, navigational errors caused by thick fog caused most of the parachute drops to be widely scattered; some units were dropped as far as thirteen miles from their targets. The vital road junction of Le Muy would remain in German hands until the troops of the U.S. Glider Infantry attacked late in the afternoon of D+1.',
  aftermath:
    'Having recognized Le Muy as a vital road junction to an Allied drive into the French interior, General Wiese of the German 19th Army had Le Muy defended by units of the 242nd Infantry Division. These units had rebuffed attacks by the British 2nd Independent Parachute Brigade on the 15th. On the 16th (D+1), units from the American 550th Glider Infantry Regiment attacked Le Muy from the north. Their first attack was broken up by heavy German machinegun fire. The troops of the 550th pulled back and reorganized for a daylight attack. With reinforcements from other units, the men of the 550th stormed the town again. By late afternoon, Le Muy had been captured along with nearly 700 Germans.',
  victoryText: 'The Americans win at game end by Controlling building P1 and ≥ 5 other multi-hex buildings.',
  photo: { src: 'scenarios/sk-s29.jpg' },
  notes: ['(Only hexrows G-X are playable)'],
  // Board w turned 180° (its letter at the top right): the card's north edge is the board's row 10.
  boards: [{ board: 'w', position: '0,0', columns: S29_ROWS }],
  compass: TURNED,
  turns: 7,
  halfFinalTurn: true,
  month: 8,
  firstSide: 'am',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 2, setupFirst: true },
    { side: 'am', name: 'American', nationality: 'am', elr: 5 },
  ],
  forces: [
    {
      id: 'ge',
      group: 'Elements of 756th Regiment, 242nd Infantry Division',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 1, withSw: ['ge.HMG'] },
        { def: 'ge.467', count: 1, withSw: ['ge.MMG'] },
        { def: 'ge.467', count: 2 },
        { def: 'ge.447', count: 6 },
        { def: 'ge.L81', count: 1 },
        { def: 'ge.L80', count: 2 },
        { def: 'ge.L70', count: 1 },
      ],
      setup: { kind: 'area', description: 'set up in hexes numbered ≤ 8', hexes: hexesWhere('w', { rows: S29_ROWS, numbered: [0, 8] }) },
    },
    {
      id: 'am',
      group: 'Elements of 550th Glider Infantry Regiment',
      side: 'am',
      units: [
        { def: 'am.747', count: 2, withSw: ['am.MMG'] },
        { def: 'am.747', count: 2, withSw: ['am.BAZ44'] },
        { def: 'am.747', count: 1, withSw: ['am.DC'] },
        { def: 'am.747', count: 6 },
        { def: 'am.L92', count: 1 },
        { def: 'am.L81', count: 1 },
        { def: 'am.L80', count: 1 },
        { def: 'am.L70', count: 1 },
      ],
      setup: { kind: 'enter', turn: 1, edge: 'N', description: 'enter on Turn 1 along the north edge' },
    },
  ],
  victory: [
    {
      kind: 'all',
      side: 'am',
      of: [
        { kind: 'controlBuildings', side: 'am', buildings: [S29_P1], atLeast: 1 },
        { kind: 'controlBuildings', side: 'am', buildings: S29_OTHER_BUILDINGS, atLeast: 5 },
      ],
    },
  ],
  ssr: [{ module: 'text', text: 'None.' }],
  balance: [
    { side: 'ge', text: 'Add 2 LMG to the German OB.', changes: [{ op: 'addSw', force: 'ge', sw: 'ge.LMG', to: 'ge.467', count: 2 }] },
    { side: 'am', text: 'Extend the game length to 7½ Turns', changes: [{ op: 'setTurns', turns: 8, halfFinalTurn: true }] },
  ],
};

// ------------------------------------------------------------------ S30

/**
 * S30's map: board u turned 180° (its letter at the top right) cut to hexrows Q-GG, above board v upright cut to
 * hexrows A-Q numbered ≤ 6. u is listed first, so the half hexes they share keep u's names.
 */
const S30_BOARDS: ScenarioDef['boards'] = [
  { board: 'u', position: '0,0', rotation: 180, columns: ['Q', 'GG'] },
  { board: 'v', position: '0,1', columns: ['A', 'Q'], rows: [0, 6] },
];
const S30_MAP = buildMap(
  S30_BOARDS.map((b) => ({ board: b.board, x: Number(b.position.split(',')[0]), y: Number(b.position.split(',')[1]), ...(b.columns ? { columns: b.columns } : {}), ...(b.rows ? { rows: b.rows } : {}), ...(b.rotation ? { rotation: b.rotation } : {}) })),
  { los: 'grid' },
);
/** German setup: hexes at least 2 hexes from every hex on the playing area's south and west edges. */
const S30_EDGE = [...S30_MAP.edge('S'), ...S30_MAP.edge('W')];
export const S30_GE_SETUP = [...S30_MAP.hexes()].map((h) => h.id).filter((h) => S30_EDGE.every((e) => S30_MAP.distance(h, e) >= 2));
/** American entry: board v's west edge from A2 and its south edge to I6. */
export const S30_AM_ENTRY = [...['vA2', 'vA3', 'vA4', 'vA5'], ...S30_MAP.edge('S').filter((h) => h.startsWith('v') && 'ABCDEFGHI'.includes(h.slice(1, -1)))];
/** American exit: the east edge of board u on/between Q3 and Q9. */
export const S30_EXIT = ['uQ3', 'uQ4', 'uQ5', 'uQ6', 'uQ7', 'uQ8', 'uQ9'];

/** S30 Ripples on the Pond (Apweiler, Germany, 16 November 1944). */
export const SK_S30: ScenarioDef = {
  id: 'sk-s30',
  product: 'sk-dl',
  number: 'S30',
  title: 'S30 Ripples on the Pond',
  designer: 'Ken Dunn',
  place: 'Apweiler, Germany',
  date: 'November 16, 1944',
  history:
    'Operation Queen was the codename for the assault into the Roer River plain. The American XIX Corps was to cross the Roer River and drive towards the Rhine. Most of the terrain in the XIX Corps sector was flat and dotted with villages and cultivated fields. Seemingly fine terrain for armored mobility, the tankers of the 2nd Armored Division were concerned with the soggy soil conditions. Additionally, the entire Corps had a front of only ten miles thus compressing three divisions into a narrow area. For their part, the Germans had established a defensive pattern with the villages as integral parts of concentric arcs fanning outward from the major towns like ripples in a pond. The 2nd Armored Division had divided their attack into three Task Forces each with a different objective and avenue of approach.',
  aftermath:
    'Task Force 2 attacked in the center of the 2nd Armored Division’s zone. Moving slowly in second gear because of the soggy ground, the tanks were unopposed until they reached a point about 300 yards from Apweiler. Then, undetected Anti-Tank guns opened up having been hidden in the orchards and fringe woods around the village. In less than two minutes German gunners had knocked out multiple American vehicles. Task Force 2 tried to silence the German fire, but even concentrated rushes of infantry were stopped in the fact of fire from automatic weapons. In the end Task Force 2 was forced to withdraw. The Americans would have another crack at Apweiler the next day.',
  victoryText:
    'The Americans win immediately upon exiting 10 Victory Points, at least 6 VP of which must be from exited armor, off the east edge of board u on/between Q3 and Q9. Each American squad exited is worth 2 VPs, each half squad is worth 1 VP, each “-1” SMC is worth 2 VPs, each “-0” and “+1” leader is worth 1 VP, and each AFV is worth 3 VPs.',
  photo: { src: 'scenarios/sk-s30.jpg' },
  notes: ['(Only hexes Q-GG on board u and hexes A-Q numbered ≤ 6 on board v are playable)'],
  boards: S30_BOARDS,
  turns: 5,
  halfFinalTurn: true,
  month: 11,
  firstSide: 'am',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 2, setupFirst: true },
    { side: 'am', name: 'American', nationality: 'am', elr: 3 },
  ],
  forces: [
    {
      id: 'ge',
      group: 'Elements of 176th Infantry Division',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 1, withSw: ['ge.MMG'] },
        { def: 'ge.447', count: 1, withSw: ['ge.LMG'] },
        { def: 'ge.447', count: 2 },
        { def: 'ge.238h', count: 1 },
        { def: 'ge.228c', count: 2, withSw: ['ge.AT75L'] },
        { def: 'ge.L91', count: 1 },
        { def: 'ge.L80', count: 1 },
      ],
      setup: { kind: 'area', description: 'set up at least 2 hexes away from any south/west edge of the playing area', hexes: S30_GE_SETUP },
    },
    {
      id: 'am',
      group: 'Elements of CCB 2nd Armored Division',
      side: 'am',
      units: [
        { def: 'am.666', count: 1, withSw: ['am.BAZ44'] },
        { def: 'am.666', count: 5 },
        { def: 'am.L91', count: 1 },
        { def: 'am.L81', count: 1 },
        { def: 'am.M4A2L', count: 3 },
        { def: 'am.M4A3', count: 1 },
        { def: 'am.M4A3E2', count: 1 },
      ],
      setup: { kind: 'enter', turn: 1, edge: 'S,W', hexes: S30_AM_ENTRY, description: 'enter on Turn 1 along the south/west edges on/between hexes A2/I6 on board v' },
    },
  ],
  victory: [{ kind: 'exitVp', side: 'am', edge: 'E', hexes: S30_EXIT, vp: 10, immediate: true, afvVpAtLeast: 6, afvVp: { ma: 3, noMa: 3 } }],
  ssr: [{ module: 'mp-limit', params: { side: 'am', fraction: 0.5, woodsHalfIsAll: true, rule: 'SSR 1' }, text: 'Due to the soggy ground, the Americans tanks may only use a maximum of half of their printed MP per MPh. An AFV expending half of its printed MP when entering woods is considered to have expended “all” for Bog purposes.' }],
  balance: [
    { side: 'ge', text: 'In the Victory Conditions change “10” to “13”.', changes: [{ op: 'setExitVp', side: 'am', vp: 13 }] },
    { side: 'am', text: 'Remove the 2-3-8 from the German OB.', changes: [{ op: 'removeUnits', force: 'ge', def: 'ge.238h', count: 1 }] },
  ],
};

// ------------------------------------------------------------------ S31

/** S31's playing area: board x hexrows T-GG. */
const S31_ROWS: [string, string] = ['T', 'GG'];
/** The Embankment Railroad (SSR 1): the road Y10-DD6-GG6, hex by hex along the line. */
export const S31_RAILROAD = ['xY10', 'xY9', 'xZ8', 'xAA8', 'xBB7', 'xCC7', 'xDD6', 'xEE6', 'xFF5', 'xGG6'];
/** The road Y1-DD6 that stays a road (SSR 1). */
const S31_ROAD = ['xY1', 'xY2', 'xZ2', 'xAA2', 'xBB2', 'xCC3', 'xCC4', 'xCC5', 'xCC6', 'xDD6'];
/** Building hexes in the playing area: two American MMC may set up in any of them. */
export const S31_BUILDING_HEXES = buildingHexesWhere('x', { rows: S31_ROWS });

/** S31 Going to New York! (Station San Oliva, Sicily, 10 July 1943). */
export const SK_S31: ScenarioDef = {
  id: 'sk-s31',
  product: 'sk-dl',
  number: 'S31',
  title: 'S31 Going to New York!',
  place: 'Station San Oliva, Sicily',
  date: '10 July 1943',
  history:
    'The Americans on the left flank of the Sicily landings, codenamed Joss, were scheduled to land early in the morning near Licata. The landing zone was divided into several different beach designations of which Red Beach was probably the most heavily fortified and defended anywhere in Sicily. The Italian units manning the defenses, generally static Coastal Divisions, fully dominated the beach exits with machine guns and ample firepower. The 7th Infantry Regiment motored towards this maelstrom in their LCIs (Landing Craft, Infantry) with the 1st Battalion designated as the assault wave. Unfortunately, the 2nd Battalion, designated to immediately move inland, passed the assault wave and became the first unit to land at Red Beach. Of the 2nd Battalion’s 6 LCIs, only 5 were able to land on time and many of those soldiers became casualties before they hit the beach since the defenses had not been cleared.',
  aftermath:
    'Despite the mounting casualties and the fact that the beach was not cleared yet, the 2nd Battalion proceeded with their mission. One company veered off to the right and established a roadblock at Station San Oliva a few miles inland. At this point the Italian High Command began to piece together the nature of the landings if not how well they had progressed and ordered local units to counterattack. Coastal units were generally made up of older age groups and sub-par equipment. These units were neither well led nor well trained. Mussolini’s war was also becoming increasingly unpopular. Despite these obstacles, honor demanded that the Italian units keep faith. The 207th Coastal Division sent in a portion of the local battalion in what turned out to be a dispirited counterattack towards the roadblock that was driven off by the Americans. Having done their duty by engaging the enemy, the Italians soon surrendered often quipping to their captors “I’m going to New York, you have to stay here on Sicily!”',
  victoryText:
    'The Italians win immediately if they Control building EE7 or at game end if they are able to place 12 FP factors on the “railroad” running Y10-DD6-GG6. No form of Area Fire (including Long Range Fire) counts but adjacent fire counts double (point blank fire) and same hex fire counts triple (triple point blank fire).',
  photo: { src: 'scenarios/sk-s31.jpg' },
  notes: [
    '(Only hexrows T-GG are playable)',
    'Engine note: the Embankment Railroad depiction is taken as the line through its hexes’ centre dots; a LOS crossing it at a hex adjacent to neither end is blocked.',
  ],
  boards: [{ board: 'x', position: '0,0', columns: S31_ROWS }],
  turns: 6,
  halfFinalTurn: true,
  month: 7,
  firstSide: 'it',
  sides: [
    { side: 'am', name: 'American', nationality: 'am', elr: 3, setupFirst: true },
    { side: 'it', name: 'Italian', nationality: 'it', elr: 1 },
  ],
  forces: [
    {
      id: 'am',
      group: 'Elements of 2nd Battalion, 7th Infantry Regiment, 3rd Infantry Division',
      side: 'am',
      units: [
        { def: 'am.666', count: 1, withSw: ['am.MMG'] },
        { def: 'am.666', count: 5 },
        { def: 'am.L91', count: 1 },
        { def: 'am.L80', count: 1 },
      ],
      setup: {
        kind: 'area',
        description:
          'set up on/between hexrows V-Y. A total of 2 MMC may set up in any building hexes (including those outside of V-Y). Leaders and SW must set up with any MMC. No more than 1 MMC may be set up in any hex',
        hexes: [...new Set([...hexesWhere('x', { rows: ['V', 'Y'] }), ...S31_BUILDING_HEXES])],
        maxMmcPerHex: 1,
        constraints: [{ kind: 'maxMmcIn', hexes: S31_BUILDING_HEXES, atMost: 2, label: 'building hexes' }, { kind: 'withMmc' }],
      },
    },
    {
      id: 'it',
      group: 'Elements of 538th Battalion, 207th Coastal Defense Division',
      side: 'it',
      units: [
        { def: 'it.346', count: 1, withSw: ['it.MMG'] },
        { def: 'it.346', count: 2, withSw: ['it.LMG'] },
        { def: 'it.346', count: 6 },
        { def: 'it.336', count: 4 },
        { def: 'it.L80', count: 1 },
        { def: 'it.L70', count: 2 },
      ],
      setup: { kind: 'enter', turn: 1, edge: 'N,W', description: 'enter on Turn 1 along the north and/or west edges' },
    },
  ],
  victory: [
    { kind: 'controlBuildings', side: 'it', buildings: [buildingAt('x', 'xEE7')], atLeast: 1, immediate: true },
    { kind: 'losFirepower', side: 'it', hexes: S31_RAILROAD, fp: 12, hexesLabel: 'railroad hexes', noAreaFire: true, pbf: true, tpbf: true },
  ],
  ssr: [
    { module: 'embankment-railroad', params: { hexes: S31_RAILROAD, roads: S31_ROAD, mf: 2, alongMf: 1, rule: 'SSR 1' }, text: 'The road Y10-DD6-GG6 is instead an Embankment Railroad (EmRR), and is a “half level” obstacle. A unit not on an EmRR has its LOS blocked by the EmRR depiction in any non-adjacent hex to all non-EmRR hexes beyond the first hex after the EmRR hex of the depiction crossed. The road hexes Y1-DD6 remain road hexes. It costs 2MP to enter an EmRR hex unless entering from an adjacent EmRR hex in which case it costs 1MP. EmRR hexes provide no TEM benefits.' },
    { module: 'unit-traits', params: { sides: { it: { inexperienced: true } } }, text: 'All Italian MMC are subject to Inexperienced penalties (5.4).' },
  ],
  balance: [
    { side: 'am', text: 'Delete “and same hex fire counts triple (triple point blank fire)” in the VC.', changes: [{ op: 'patchVictory', index: 1, params: { tpbf: false } }] },
    { side: 'it', text: 'Delete SSR 2.', changes: [{ op: 'removeSsr', index: 1 }] },
  ],
};

// ------------------------------------------------------------------ S32

/**
 * S32's map: board x upright above board v turned 180° (its letter at the top right). v is listed first, so the half
 * hexes they share keep v's names (the VC counts from vN9).
 */
const S32_BOARDS: ScenarioDef['boards'] = [
  { board: 'v', position: '0,1', rotation: 180 },
  { board: 'x', position: '0,0' },
];
const S32_MAP = buildMap(
  S32_BOARDS.map((b) => ({ board: b.board, x: Number(b.position.split(',')[0]), y: Number(b.position.split(',')[1]), ...(b.rotation ? { rotation: b.rotation } : {}) })),
  { los: 'grid' },
);
/** The vY1-vX3-vR6 road section, hex by hex. */
export const S32_ROAD = ['vY1', 'vY2', 'vY3', 'vX3', 'vW4', 'vV4', 'vU5', 'vT5', 'vS6', 'vR6'];
/** Russian setup: ≥ 3 hexes from the road section. */
export const S32_RU_SETUP = [...S32_MAP.hexes()].map((h) => h.id).filter((h) => S32_ROAD.every((r) => S32_MAP.distance(h, r) >= 3));
/** German setup: on/adjacent-to the road section. */
export const S32_GE_SETUP = [...new Set(S32_ROAD.flatMap((r) => [r, ...S32_MAP.neighbors(r)]))].filter((h) => !!S32_MAP.hex(h));
/** Building hexes within 6 hexes of vN9, on either board. */
export const S32_VP_BUILDINGS = [...S32_MAP.hexes()].filter((h) => !!h.buildingId && S32_MAP.distance(h.id, 'vN9') <= 6).map((h) => h.id);
const S32_GUNS = ['ru.AR76L', 'ru.INF76s'];

/** S32 Göring’s Men (Vyazivok, Russia, 19 September 1941). */
export const SK_S32: ScenarioDef = {
  id: 'sk-s32',
  product: 'sk-dl',
  number: 'S32',
  title: 'S32 Göring’s Men',
  designer: 'Ken Dunn',
  place: 'Vyazivok, Russia',
  date: '19 September 1941',
  history:
    'The General Göring Regiment had alternated between being in action and at rest for the better part of September. Their march had taken them across the Dniepr River as part of Army Group Center. Most of the action they had seen in September though was on the receiving end of artillery fire. Organized mainly as a Flak unit, the General Göring Regiment did have a rifle battalion which was assigned to Panzer-Division 11. It was units from the rifle battalion that went on patrol while driving on Vyazivok, only to be ambushed by Soviet units, including direct artillery fire.',
  aftermath:
    'As the Germans advanced, they quickly came under fire from Soviet artillery. Pinned down by accurate shelling, the patrol was relieved by elements of the 2nd Platoon under the command of Leutnant Gerhardt which attacked the Soviet artillery positions from the flank. With the shelling stopped, the patrol under Leutnant Rennmayer was able to continue its advance and capture some outlying buildings. That advance would be significantly slowed, though, as in less than a month the first snow would fall on Göring’s men. Winter, mud, and snow would do what the Soviet Army had failed to do.',
  victoryText:
    'The Germans win immediately upon eliminating all Russian Guns or at game end by amassing ≥ 18 Victory Points. VP are earned as follows:\n\n• +2 VP per building hex Controlled within 6 hexes of vN9.\n\n• +3 VP for each Russian ART Gun eliminated.',
  photo: { src: 'scenarios/sk-s32.jpg' },
  boards: S32_BOARDS,
  turns: 7,
  halfFinalTurn: false,
  month: 9,
  firstSide: 'ru',
  sides: [
    { side: 'ru', name: 'Russian', nationality: 'ru', elr: 2, setupFirst: true },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 4 },
  ],
  forces: [
    {
      id: 'ru',
      group: 'Elements of Bryansk Front Army Group',
      side: 'ru',
      units: [
        { def: 'ru.447', count: 1, withSw: ['ru.MMG'] },
        { def: 'ru.447', count: 3, withSw: ['ru.LMG'] },
        { def: 'ru.447', count: 5 },
        { def: 'ru.228c', count: 2, withSw: ['ru.AR76L'] },
        { def: 'ru.228c', count: 1, withSw: ['ru.INF76s'] },
        { def: 'ru.L81', count: 1 },
        { def: 'ru.L80', count: 1 },
      ],
      setup: {
        kind: 'area',
        description: 'set up ≥ 3 hexes from the vY1-vX3-vR6 road section, with each Gun ≥ 3 hexes from all other Guns',
        hexes: S32_RU_SETUP,
        constraints: [{ kind: 'spacing', defs: S32_GUNS, atLeast: 3 }],
      },
    },
    {
      id: 'ge-k1',
      group: 'Elements of Kompanie 1, Schützen-Bataillon “General Göring”',
      side: 'ge',
      units: [
        { def: 'ge.468', count: 3, withSw: ['ge.LMG'] },
        { def: 'ge.468', count: 2, withSw: ['ge.DC'] },
        { def: 'ge.468', count: 4 },
        { def: 'ge.L91', count: 1 },
        { def: 'ge.L81', count: 1 },
        { def: 'ge.L80', count: 1 },
      ],
      setup: { kind: 'area', description: 'set up on/adjacent-to the vY1-vX3-vR6 road section with ≤ 1 MMC per hex', hexes: S32_GE_SETUP, maxMmcPerHex: 1 },
    },
    {
      id: 'ge-zug2',
      group: 'Elements of Zug 2, Kompanie 1',
      side: 'ge',
      units: [
        { def: 'ge.468', count: 2, withSw: ['ge.LMG'] },
        { def: 'ge.468', count: 2 },
        { def: 'ge.L92', count: 1 },
      ],
      setup: { kind: 'enter', turn: 3, edge: 'W,S', description: 'enter on/after Turn 3 along the west or south edge' },
    },
  ],
  victory: [
    { kind: 'gunsEliminatedOrCaptured', side: 'ge', of: 'ru', immediate: true, eliminatedOnly: true },
    {
      kind: 'vpTally',
      side: 'ge',
      vp: 18,
      sources: [
        { kind: 'controlledHexes', hexes: S32_VP_BUILDINGS, vp: 2, label: 'building hex Controlled within 6 hexes of vN9' },
        { kind: 'eliminated', defs: ['ru.AR76L'], vp: 3, label: 'Russian ART Gun eliminated' },
      ],
    },
  ],
  ssr: [{ module: 'text', text: 'None.' }],
  balance: [
    { side: 'ru', text: 'German reinforcements enter on Turn 4.', changes: [{ op: 'setEntryTurn', force: 'ge-zug2', turn: 4 }] },
    { side: 'ge', text: 'In the Victory Conditions, replace “≥ 18 VP” with “≥ 15 VP”.', changes: [{ op: 'setVictoryVp', index: 1, vp: 15 }] },
  ],
};

// ------------------------------------------------------------------ S33

/**
 * S33's map: board u upright (west) beside board y turned 180° (its letter at the top right), each cut to hexrows Z-GG,
 * so their GG hexrows meet. y is listed first, so the half hexes they share keep y's names (the VC counts from yFF5).
 */
const S33_BOARDS: ScenarioDef['boards'] = [
  { board: 'y', position: '1,0', rotation: 180, columns: ['Z', 'GG'] },
  { board: 'u', position: '0,0', columns: ['Z', 'GG'] },
];
const S33_MAP = buildMap(
  S33_BOARDS.map((b) => ({ board: b.board, x: Number(b.position.split(',')[0]), y: Number(b.position.split(',')[1]), ...(b.columns ? { columns: b.columns } : {}), ...(b.rotation ? { rotation: b.rotation } : {}) })),
  { los: 'grid' },
);
/** The buildings within 2 hexes of yFF5 (on either board). */
export const S33_BUILDINGS = [...new Set([...S33_MAP.hexes()].filter((h) => !!h.buildingId && S33_MAP.distance(h.id, 'yFF5') <= 2).map((h) => h.buildingId!))].sort();
/** Dutch setup: on/west-of hexrow yBB (board u is west of board y). */
export const S33_NL_SETUP = [...new Set([...hexesWhere('y', { rows: ['BB', 'GG'] }), ...hexesWhere('u', { rows: ['Z', 'GG'] })].map((h) => S33_MAP.hex(h)?.id).filter((h): h is string => !!h))];

/** S33 Few and Far Between (Scherpenzeel, The Netherlands, 13 May 1940). */
export const SK_S33: ScenarioDef = {
  id: 'sk-s33',
  product: 'sk-dl',
  number: 'S33',
  title: 'S33 Few and Far Between',
  designer: 'Chas Argent',
  place: 'Scherpenzeel, The Netherlands',
  date: '13 May 1940',
  history:
    'In an effort to break Dutch forces holding the so-called Grebbe Line, the Germans on 13 May committed Infanterie-Division 227 to an attack near the town of Scherpenzeel. The axis of this attack would allow the Germans to approach the line without having to cross the water barriers that protected it. The intent was for two regiments, the 366th and the 412th, to attack simultaneously; but the 412th found itself delayed by Dutch outposts it encountered while deploying for the attack.',
  aftermath:
    'Instead of participating in a major coordinated attack, the 412th found itself stymied by a series of small engagements with the Dutch. Eventually the release of the division’s reserve regiment was required to stabilize the situation. Infanterie-Regiment 366, meanwhile, was so pounded by Dutch artillery fire while it sat in place waiting to make the original attack that it was forced to withdraw. Though the fall of the Grebbe Line had been delayed by another day, these small victories were few and far between for the beleaguered Dutch.',
  victoryText: 'The Germans win at game end by Controlling all buildings within 2 hexes of yFF5.',
  photo: { src: 'scenarios/sk-s33.jpg' },
  notes: ['(Only hexrows Z-GG are playable on each board)', 'Engine note: the Dutch use the Allied Minor counters.'],
  boards: S33_BOARDS,
  turns: 5,
  halfFinalTurn: true,
  month: 5,
  firstSide: 'ge',
  sides: [
    { side: 'al', name: 'Dutch', nationality: 'al', elr: 3, setupFirst: true },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
  ],
  nationalityNames: { al: 'Dutch' },
  forces: [
    {
      id: 'nl',
      group: 'Elements of 2nd Infantry Division',
      side: 'al',
      units: [
        { def: 'al.457', count: 2, withSw: ['al.LMG'] },
        { def: 'al.457', count: 4 },
        { def: 'al.L80', count: 1 },
        { def: 'al.L70', count: 1 },
      ],
      setup: { kind: 'area', description: 'set up on/west-of hexrow yBB', hexes: S33_NL_SETUP },
    },
    {
      id: 'nl-t2',
      group: 'Elements of 2nd Infantry Division',
      side: 'al',
      units: [
        { def: 'al.457', count: 1 },
        { def: 'al.237h', count: 1 },
        { def: 'al.L81', count: 1 },
      ],
      setup: { kind: 'enter', turn: 2, edge: 'W', description: 'Enter on Turn 2 along the west edge' },
    },
    {
      id: 'ge',
      group: 'Elements of Infanterie-Regiment 412',
      side: 'ge',
      units: [
        { def: 'ge.468', count: 2, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 1, withSw: ['ge.DC'] },
        { def: 'ge.467', count: 4 },
        { def: 'ge.248h', count: 1 },
        { def: 'ge.L91', count: 1 },
        { def: 'ge.L81', count: 1 },
        { def: 'ge.L70', count: 1 },
        { def: 'ge.pziia', count: 1 },
      ],
      setup: { kind: 'enter', turn: 1, edge: 'E', description: 'enter on Turn 1 along the east edge' },
    },
  ],
  victory: [{ kind: 'controlBuildings', side: 'ge', buildings: S33_BUILDINGS, atLeast: S33_BUILDINGS.length }],
  ssr: [
    {
      module: 'terrain-override',
      params: { terrain: { grain: 'plowed' } },
      text: 'All Grain are Plowed Fields. Plowed Fields cost 1½ MF per hex entered and are treated as Open Ground for all other purposes.',
    },
  ],
  balance: [
    { side: 'al', text: 'Add one LMG to the Turn 2 reinforcements.', changes: [{ op: 'addSw', force: 'nl-t2', sw: 'al.LMG', to: 'al.457', count: 1 }] },
    { side: 'ge', text: 'Exchange the PzKpfw IIA with a PzKpfw IIF.', changes: [{ op: 'swapUnits', force: 'ge', from: 'ge.pziia', to: 'ge.pziif', count: 1 }] },
  ],
};

// ------------------------------------------------------------------ S34

/**
 * S34's map: boards x (west) and y (east) on end, each with its letter at the top left, so turned 90° clockwise: in the
 * boards' own frame they stand upright, y above x (row 10 of y on row 1 of x), and the card's north is the boards' west
 * (hexrow A). y is listed first, so the half hexes they share keep y's names.
 */
const S34_BOARDS: ScenarioDef['boards'] = [
  { board: 'y', position: '0,0' },
  { board: 'x', position: '0,1' },
];
const S34_COMPASS = { N: 'W', E: 'N', S: 'E', W: 'S' } as const;
const S34_MAP = buildMap(
  S34_BOARDS.map((b) => ({ board: b.board, x: Number(b.position.split(',')[0]), y: Number(b.position.split(',')[1]) })),
  { los: 'grid', compass: S34_COMPASS },
);
/** American setup: on/south-of hexrow H, on both boards (south is toward hexrow GG). */
export const S34_AM_SETUP = [...new Set(['y', 'x'].flatMap((b) => hexesWhere(b, { rows: ['H', 'GG'] })).map((h) => S34_MAP.hex(h)?.id).filter((h): h is string => !!h))];

/** S34 Twilight at Baerendorf (Baerendorf, France, 23 November 1944). */
export const SK_S34: ScenarioDef = {
  id: 'sk-s34',
  product: 'sk-dl',
  number: 'S34',
  title: 'S34 Twilight at Baerendorf',
  designer: 'Chris Olden',
  place: 'Baerendorf, France',
  date: '23 November 1944',
  history:
    'The thrust towards the Rhine River by the American XV Corps threatened to split the German First and Nineteenth Armies, which could lead to the outflanking of the Saar Basin and the destruction of German forces west of the Rhine. Generalfeldmarschall Gerd von Rundstedt needed armored reinforcements for a strong counterattack to prevent an Allied breakthrough. On 21 November, the Panzer-Lehr-Division was handed over to von Rundstedt and sent to Alsace for the counterattack against the advancing American forces.',
  aftermath:
    'Dismounted elements of the 106th Cavalry Group were deployed in Baerendorf and the woods to its west, with two Ml anti-tank guns in support. As the November dusk darkened, the panzergrenadiere of Panzer Lehr hit the American lines hard, probing for openings for the mixed force of panzers to exploit. The GIs had to shift more than once before the hidden anti-tank guns could engage the panzers, knocking several out. After fierce fighting the Germans were able to bypass Baerendorf, but their effectiveness had been greatly diminished.',
  victoryText:
    'The Germans win immediately upon exiting ≥ 40 VP off the south edge. Each AFV with a functioning MA exited is worth 6 VP (or 5 VP if exited without a functioning MA), each squad is worth 2 VP, each HS is worth 1 VP, and each SMC is worth 1 VP plus 1 VP per negative modifier.',
  photo: { src: 'scenarios/sk-s34.jpg' },
  notes: [
    'Engine note: SSR 1 applies when every firer of an attack is ≥ 7 hexes from the target. SSR 2 is applied to every Bazooka set up on the map; the opponent sees them when they are revealed.',
  ],
  boards: S34_BOARDS,
  compass: S34_COMPASS,
  turns: 8,
  halfFinalTurn: false,
  month: 11,
  firstSide: 'ge',
  sides: [
    { side: 'am', name: 'American', nationality: 'am', elr: 3, setupFirst: true },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 4 },
  ],
  forces: [
    {
      id: 'am',
      group: 'Elements of 106th Cavalry Group',
      side: 'am',
      units: [
        { def: 'am.667', count: 1, withSw: ['am.HMG50'] },
        { def: 'am.667', count: 2, withSw: ['am.MMG'] },
        { def: 'am.667', count: 4, withSw: ['am.BAZ44'] },
        { def: 'am.667', count: 3 },
        { def: 'am.227c', count: 2, withSw: ['am.AT57L'] },
        { def: 'am.L92', count: 1 },
        { def: 'am.L91', count: 1 },
        { def: 'am.L81', count: 2 },
        { def: 'am.L80', count: 1 },
      ],
      setup: { kind: 'area', description: 'set up on/south-of hexrow H', hexes: S34_AM_SETUP },
    },
    {
      id: 'am-t3',
      group: 'Elements of 106th Cavalry Group',
      side: 'am',
      units: [{ def: 'am.M5A1', count: 2 }],
      setup: { kind: 'enter', turn: 3, edge: 'S', description: 'Enter on Turn 3 along the south edge' },
    },
    {
      id: 'ge',
      group: 'Elements of Panzer-Lehr-Division',
      side: 'ge',
      units: [
        { def: 'ge.468', count: 1, withSw: ['ge.MMG'] },
        { def: 'ge.468', count: 4, withSw: ['ge.LMG'] },
        { def: 'ge.468', count: 1, withSw: ['ge.PSK'] },
        { def: 'ge.468', count: 7 },
        { def: 'ge.L102', count: 1 },
        { def: 'ge.L92', count: 1 },
        { def: 'ge.L91', count: 1 },
        { def: 'ge.L81', count: 1 },
        { def: 'ge.L80', count: 1 },
        { def: 'ge.pzivj', count: 3 },
        { def: 'ge.pzivh', count: 2 },
        { def: 'ge.stgiiigl', count: 2 },
        { def: 'ge.pziiig', count: 1 },
      ],
      setup: { kind: 'enter', turn: 1, edge: 'N', description: 'enter on/after Turn 1 along the north edge' },
    },
  ],
  victory: [{ kind: 'exitVp', side: 'ge', edge: 'S', vp: 40, immediate: true, afvVp: { ma: 6, noMa: 5 } }],
  ssr: [
    { module: 'attack-drm', params: { drm: 1, label: 'approaching night', minRange: 7, notResidual: true, rule: 'SSR 1' }, text: 'Due to the approaching night, there is a +1 DRM to all IFT/TH rolls at a range of ≥ 7 hexes. This penalty applies to the To Hit attempt and not on the IFT on an Infantry or Area Target Type attack. It does not affect Residual FP or Interdiction and does not negate FFMO.' },
    { module: 'secret-sw', params: { side: 'am', types: ['BAZ'], rule: 'SSR 2' }, text: 'The American player may secretly record which units possess Bazookas during setup. They are revealed if the possessing unit fires them, becomes broken, or an enemy unit enters its hex.' },
  ],
  balance: [
    { side: 'am', text: 'In the Victory Conditions, replace “≥ 40 VP” with “≥ 46 VP”.', changes: [{ op: 'setExitVp', side: 'ge', vp: 46 }] },
    { side: 'ge', text: 'Delete SSR 2.', changes: [{ op: 'removeSsr', index: 1 }] },
  ],
};

// ------------------------------------------------------------------ S35

/** S35's playing area: board z hexrows A-P, turned so hexrow A faces south. */
const S35_ROWS: [string, string] = ['A', 'P'];
/** The building hexes numbered ≥ 8 the Germans must Control. */
export const S35_VC_HEXES = buildingHexesWhere('z', { rows: S35_ROWS, numbered: [8, 10] });
/** The German entry: on/between hexes G1 and P0 (the card's west edge). */
const S35_GE_ENTRY = edgeHexesWhere('z', 'N', ['G', 'P']);
const S35_RU_2ND_LINE = ['ru.628', 'ru.328h'];

/** S35 The Volga Is Reached! (Stalingrad, Russia, 14 September 1942). */
export const SK_S35: ScenarioDef = {
  id: 'sk-s35',
  product: 'sk-dl',
  number: 'S35',
  title: 'S35 The Volga Is Reached!',
  designer: 'Tom Morin',
  place: 'Stalingrad, Russia',
  date: '14 September 1942',
  history:
    'The 71st Infantry Division’s drive into central Stalingrad was spearheaded by Colonel Roske’s 194th Infantry Regiment. Roske’s regiment had made good progress since morning, and he intended to keep his forward momentum going by bypassing the Stalingrad-1 Rail Station to the north. Around noon his two battalions paused briefly to regroup, after which they renewed their efforts to reach the banks of the Volga River and seize the all-important ferry landings. Opposing Roske’s advance were battered elements of the 62nd Army, also lightly armed reserves and militia of the 10th NKVD Division, whose job it was to protect the ferry landings until relieved by the 13th Guards Division. The 10th NKVD Division consisted largely of conscripted local militia, with a cadre of actual NKVD troops.',
  aftermath:
    'In spite of mounting casualties, Roske’s regiment broke through the Russian defenses, and at 1515 hours both battalions radioed “the Volga is reached!” Germans armed with submachineguns managed to seize the Brewery, State Bank, and Specialists’ House, which all held a commanding view of the Volga’s ferry landings. They were stopped short of actually taking the ferry landings by the determined resistance of NKVD troops, and once the 13th Guards Division arrived all hopes of achieving this objective were dashed. Counterattacks managed to recapture the Brewery, but the State Bank and Specialists’ House would remain in German hands, allowing them to harass the ferry landings with machinegun fire.',
  victoryText: 'The Germans win at game end by Controlling all building locations in hexes numbered ≥ 8.',
  photo: { src: 'scenarios/sk-s35.jpg' },
  notes: [
    '(Only hexrows A-P are playable)',
    'Engine note: a shellhole hex is always entered at 2 MF (the 1 MF entry as Open Ground is not offered). The Russian balance option replaces the 9-1 of the Turn 4 reinforcements.',
  ],
  boards: [{ board: 'z', position: '0,0', columns: S35_ROWS }],
  compass: Y_PORTRAIT,
  turns: 7,
  halfFinalTurn: false,
  month: 9,
  firstSide: 'ge',
  sides: [
    { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3, setupFirst: true },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 4 },
  ],
  forces: [
    {
      id: 'ru',
      group: 'Elements of 10th NKVD Division and 62nd Army',
      side: 'ru',
      units: [
        { def: 'ru.628', count: 1, withSw: ['ru.MMG'] },
        { def: 'ru.628', count: 2, withSw: ['ru.LMG'] },
        { def: 'ru.628', count: 1 },
        { def: 'ru.426', count: 2, withSw: ['ru.ATR'] },
        { def: 'ru.426', count: 5 },
        { def: 'ru.228c', count: 1, withSw: ['ru.INF76s'] },
        { def: 'ru.L80', count: 2 },
        { def: 'ru.L61', count: 1 },
        { def: 'ru.T34M41', count: 1 },
      ],
      setup: {
        kind: 'area',
        description: 'set up in hexes numbered ≥ 2',
        hexes: hexesWhere('z', { rows: S35_ROWS, numbered: [2, 10] }),
        // SSR 3: the dug-in T-34 "may setup only in road, open ground or shellhole hexes".
        constraints: [{ kind: 'onTerrain', defs: ['ru.T34M41'], terrains: ['open', 'shellholes'], road: true }],
      },
    },
    {
      id: 'ru-t4',
      group: 'Elements of 62nd Army HQ and 133rd Heavy Tank Brigade',
      side: 'ru',
      units: [
        { def: 'ru.447', count: 1, withSw: ['ru.MMG'] },
        { def: 'ru.447', count: 3 },
        { def: 'ru.237h', count: 1 },
        { def: 'ru.L91', count: 1 },
        { def: 'ru.KV1M41', count: 1 },
      ],
      setup: { kind: 'enter', turn: 4, edge: 'S', description: 'enter on Turn 4 along the south edge' },
    },
    {
      id: 'ru-t6',
      group: 'Elements of 42nd Regiment, 13th Guards Division',
      side: 'ru',
      units: [
        { def: 'ru.458', count: 2, withSw: ['ru.LMG'] },
        { def: 'ru.458', count: 1, withSw: ['ru.DC'] },
        { def: 'ru.458', count: 2 },
        { def: 'ru.L91', count: 1 },
      ],
      setup: { kind: 'enter', turn: 6, edge: 'E', description: 'enter on Turn 6 along the east edge' },
    },
    {
      id: 'ge',
      group: 'Elements of Infanterie-Regiment 194, Pionier-Bataillon 171, Infanterie-Division 71, and Sturmgeschütz Abteilung 244',
      side: 'ge',
      units: [
        { def: 'ge.838', count: 1, withSw: ['ge.FT'] },
        { def: 'ge.838', count: 1, withSw: ['ge.DC'] },
        { def: 'ge.838', count: 1 },
        { def: 'ge.467', count: 1, withSw: ['ge.HMG'] },
        { def: 'ge.467', count: 1, withSw: ['ge.MMG'] },
        { def: 'ge.467', count: 2, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 5 },
        { def: 'ge.L102', count: 1 },
        { def: 'ge.L91', count: 1 },
        { def: 'ge.L81', count: 1 },
        { def: 'ge.L80', count: 1 },
        { def: 'ge.stgiiig', count: 1 },
      ],
      setup: { kind: 'enter', turn: 1, edge: 'W', hexes: S35_GE_ENTRY, description: 'enter on Turn 1 on/between hexes G1 and P0' },
    },
    {
      id: 'ge-t3',
      group: 'Elements of Infanterie-Regiment 194, Pionier-Bataillon 171, Infanterie-Division 71, and Sturmgeschütz Abteilung 244',
      side: 'ge',
      units: [
        { def: 'ge.548', count: 1, withSw: ['ge.MMG'] },
        { def: 'ge.548', count: 2, withSw: ['ge.LMG'] },
        { def: 'ge.548', count: 1, withSw: ['ge.DC'] },
        { def: 'ge.548', count: 1 },
        { def: 'ge.L91', count: 1 },
        { def: 'ge.L80', count: 1 },
        { def: 'ge.stgiiig', count: 1 },
      ],
      setup: { kind: 'enter', turn: 3, edge: 'W', hexes: S35_GE_ENTRY, description: 'Enter on Turn 3 on/between G1 and P0' },
    },
  ],
  victory: [{ kind: 'controlHexes', side: 'ge', hexes: S35_VC_HEXES, atLeast: S35_VC_HEXES.length, hexesLabel: 'building hexes numbered ≥ 8' }],
  ssr: [
    { module: 'redraw-terrain', params: { terrain: { woods: 'rubble-stone', orchard: 'shellholes' } }, text: 'Woods are stone rubble; entry costs infantry 3 MF, while vehicles pay ½ of their MP allotment and risk Bog with a +3 DRM. Rubble has a +3 TEM and block LOS throughout (including along hexsides); ambush is possible. Orchards are shellholes, which have no effect on LOS, provide a +1 TEM for infantry units, and cost 2 MF to enter. During movement, these hexes are treated as open ground with 0 TEM if entered at a cost of 1 MF.' },
    { module: 'unit-traits', params: { defs: { 'ru.628': { elrExempt: true }, 'ru.328h': { elrExempt: true } } }, text: 'Russian 6-2-8/3-2-8 MMC are 2nd-Line units, are considered to have underlined morale (and are not subject to ELR; 5.1), and have their broken side morale increased by one. Russian Elite and 1st-Line units receive a -1 drm to their Ambush dr. German 8-3-8 squads have a smoke exponent of 5.' },
    { module: 'broken-morale', params: { side: 'ru', add: 1, defs: S35_RU_2ND_LINE }, part: true },
    { module: 'ambush-drm', params: { side: 'ru', qualities: ['E', '1'], exceptDefs: S35_RU_2ND_LINE, drm: -1, rule: 'SSR 2' }, part: true },
    { module: 'smoke-exponent', params: { def: 'ge.838', add: 2 }, part: true },
    {
      module: 'dig-in',
      params: { side: 'ru', thDrm: 1, defs: ['ru.T34M41'], noWreck: true, notTerrain: true, bmgDisabled: true, rule: 'SSR 3' },
      text: 'The T-34 M41 is a dug-in AFV. It may never move from its setup hex or change its VCA. A +1 DRM applies to all TH DR made against it, and any hull hit is treated as a miss. It may setup only in road, open ground or shellhole hexes. It leaves no wreck if eliminated, provides no TEM, and does not affect LOS. Place a “BMG Disabled” marker on the dug-in AFV at start.',
    },
    { module: 'commissar', params: { side: 'ru', leaders: { 'ru.L80': { morale: 10 }, 'ru.L61': { morale: 8 } }, rule: 'SSR 4' }, text: 'The Russian 8-0 and 6+1 leaders represent Commissars with a morale level of 10 and 8 respectively, to whom ELR does not apply. Russian Infantry units stacked with an unpinned and unbroken Commissar have their morale level raised by one and do not apply the +4 DM DRM when rallying. A Commissar must attempt to rally each broken Russian unit stacked with it; any unit that does not rally is replaced by the next lowest quality unit; if no lower quality unit exists, the unit suffers Casualty Reduction.' },
    { module: 'sniper-attack', params: { side: 'ru', rule: 'SSR 5' }, text: 'Once per Russian Defensive Fire Phase, the Russian player may make a Sniper attack by making a dr < 3. The player selects one target hex; if there is > 1 unit (ignoring BU AFVs), randomly select the target. A dr 1 eliminates a leader, breaks a MMC, or STUNs a CE AFV crew; a dr 2 wounds a leader, pins a MMC, or Stuns a CE AFV crew; a dr > 2 has no effect.' },
    {
      module: 'stuka-attack',
      params: { side: 'ge', infantryTh: 8, column: 36, afvTh: [6, 10], directHit: 5, tk: { 'ru.T34M41': 7, 'ru.KV1M41': 6 }, rule: 'SSR 6' },
      text: 'Once per German Defensive Fire Phase the German player may make a Stuka attack. The player selects the target hex and makes a single To Hit DR (which may possibly affect both infantry and vehicular targets); a Final To Hit DR ≤ 8 vs. Infantry is resolved on the 36 column of the IFT; a Final To Hit DR of 6-10 vs. AFV results in a Final To Kill number of 7 for the T-34 and 6 for the KV-1; a Final To Hit DR ≤ 5 is a direct hit which automatically eliminates the AFV.',
    },
  ],
  balance: [
    { side: 'ru', text: 'Replace either 9-1 leader in the Russian OB with a 9-2 leader.', changes: [{ op: 'swapUnits', force: 'ru-t4', from: 'ru.L91', to: 'ru.L92', count: 1 }] },
    { side: 'ge', text: 'Add one FT to the at-start German OB.', changes: [{ op: 'addSw', force: 'ge', sw: 'ge.FT', to: 'ge.467', count: 1 }] },
  ],
};

// ------------------------------------------------------------------ S36

/**
 * S36's map: boards x, v and t stacked, each turned 180° (letters at the top right), x to the north. In the boards' own
 * frame they stand upright, t on top and x at the bottom, and the card's north is the boards' south. x is listed first,
 * then v, so the half hexes they share keep x's and v's names. All three are built: SSR 1's secret game length decides
 * which are in play once revealed.
 */
const S36_BOARDS: ScenarioDef['boards'] = [
  { board: 'x', position: '0,2' },
  { board: 'v', position: '0,1' },
  { board: 't', position: '0,0' },
];
const S36_MAP = buildMap(
  S36_BOARDS.map((b) => ({ board: b.board, x: Number(b.position.split(',')[0]), y: Number(b.position.split(',')[1]) })),
  { los: 'grid', compass: TURNED },
);
const s36Canon = (hexes: string[]) => [...new Set(hexes.map((h) => S36_MAP.hex(h)?.id).filter((h): h is string => !!h))];
/** The playing area for 4.5 turns (board x and the hexes numbered ≥ 4 of board v), and for 5.5 (boards x and v). */
export const S36_AREA_45 = s36Canon([...hexesWhere('x', {}), ...hexesWhere('v', { numbered: [4, 10] })]);
export const S36_AREA_55 = s36Canon([...hexesWhere('x', {}), ...hexesWhere('v', {})]);
/** An area's south edge (the boards' north, toward t): its hexes whose neighbour above is out of it. */
const s36SouthEdge = (area: string[]) => {
  const inArea = new Set(area);
  return area.filter((h) => {
    const me = S36_MAP.hex(h)!;
    return S36_MAP.neighbors(h).some((n) => !inArea.has(n) && S36_MAP.hex(n)!.cube.q === me.cube.q && S36_MAP.hex(n)!.cube.r < me.cube.r);
  });
};
export const S36_EDGE_45 = s36SouthEdge(S36_AREA_45);
export const S36_EDGE_55 = s36SouthEdge(S36_AREA_55);
/** German setup: board v in hexes numbered ≥ 4 and/or board x. */
export const S36_GE_SETUP = S36_AREA_45;

/** S36 Satisfaction and Confidence (Slobodka, Russia, 25 June 1944). */
export const SK_S36: ScenarioDef = {
  id: 'sk-s36',
  product: 'sk-dl',
  number: 'S36',
  title: 'S36 Satisfaction and Confidence',
  designer: 'Ken Dunn',
  place: 'Slobodka, Russia',
  date: '25 June 1944',
  history:
    'On June 24, the 3rd Army of the 1st Byelorussian Front made a 10 kilometer penetration towards Minsk against the German 134th Infantry Division as part of Operation BAGRATION. General Jordan, commander of the German 9th Army, received permission from Field Marshal Busch to commit his major reserve, the 20th Panzer Division. The 20th was only at partial strength as one of its tank regiments was being refitted with Panthers but moved out as ordered nonetheless. The Soviet 65th Army, however, had made another breakthrough on the southern approaches to Bobruisk, and, as this penetration deepened, Marshal Rokossovskiy committed the 1st Guards Tank Army to exploit the breach.',
  aftermath:
    'This new exploitation deeply alarmed General Jordan, who then changed his orders to 20th Panzer and turned them around to move southwards towards this new threat. The 20th now had its infantry in the lead, followed by the Mk. IVs of remaining tank regiment. They met the Russians at Slobodka and engaged in a series of disjointed infantry and tank skirmishes. The Germans destroyed 60 tanks but lost nearly half of their own vehicles in the process without slowing the Russian advance. As the relentless assault by 1st Guards Tank Army moved forward, it threatened to cut off several German infantry divisions. On June 26, both Jordan and Busch flew to see Hitler who relieved them both, ordering Field Marshal Model to take command of Army Group Center. The staff of 9th Army (Model’s early-war command), fed up with Busch and the beating the 9th had been taking the past week, noted in their official diary that the news of Model’s arrival was welcomed with satisfaction and confidence.',
  victoryText:
    'The Russians win immediately by Exiting at least 20 VP off the north edge. Each squad is worth 2 VP, each half-squad is worth 1 VP, each “-1” SMC is worth 2 VP, each “0” and “+1” SMC is worth 1 VP. Each T-34/85 is worth 7 VP, and the IS-2 is worth 8 VP; each is worth 1 VP less if its MA is malfunctioned.',
  photo: { src: 'scenarios/sk-s36.jpg' },
  notes: [
    'Engine note: all three boards are on the map until the Russian game length is revealed after the German setup; the hexes it leaves out are then out of play (greyed), and the Russians enter along the south edge of what remains.',
  ],
  boards: S36_BOARDS,
  compass: TURNED,
  turns: 7,
  halfFinalTurn: true,
  month: 6,
  firstSide: 'ru',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3, setupFirst: true },
    { side: 'ru', name: 'Russian', nationality: 'ru', elr: 4 },
  ],
  forces: [
    {
      id: 'ge',
      group: 'Elements of Panzer-Division 20',
      side: 'ge',
      units: [
        { def: 'ge.467', count: 1, withSw: ['ge.MMG'] },
        { def: 'ge.467', count: 2, withSw: ['ge.LMG'] },
        { def: 'ge.467', count: 1, withSw: ['ge.PSK'] },
        { def: 'ge.467', count: 1 },
        { def: 'ge.447', count: 3 },
        { def: 'ge.228c', count: 1, withSw: ['ge.AT75L'] },
        { def: 'ge.L92', count: 1 },
        { def: 'ge.L81', count: 2 },
      ],
      setup: { kind: 'area', description: 'set up on board v in hexes numbered ≥ 4 and/or on board x', hexes: S36_GE_SETUP },
    },
    {
      id: 'ge-t2',
      group: 'Elements of Panzer-Division 20',
      side: 'ge',
      units: [],
      setup: { kind: 'enter', turn: 2, edge: 'N', description: 'Enter on/after Turn 2 along north the edge (see SSR 2)' },
    },
    {
      id: 'ru',
      group: 'Elements of 1st Guards Tank Army',
      side: 'ru',
      units: [
        { def: 'ru.628', count: 1, withSw: ['ru.MMG'] },
        { def: 'ru.628', count: 3 },
        { def: 'ru.447', count: 3, withSw: ['ru.LMG'] },
        { def: 'ru.447', count: 1, withSw: ['ru.DC'] },
        { def: 'ru.447', count: 4 },
        { def: 'ru.L91', count: 1 },
        { def: 'ru.L81', count: 2 },
        { def: 'ru.L70', count: 1 },
        { def: 'ru.T3485', count: 4 },
        { def: 'ru.IS2', count: 1 },
      ],
      setup: { kind: 'enter', turn: 1, edge: 'S', mpSpent: 'half', description: 'enter on Turn 1 along the south edge with AFV having expended half of their MP (see SSR 1)' },
    },
  ],
  victory: [{ kind: 'exitVp', side: 'ru', edge: 'N', vp: 20, immediate: true, vehicleVp: { 'ru.T3485': { ma: 7, noMa: 6 }, 'ru.IS2': { ma: 8, noMa: 7 } } }],
  ssr: [
    {
      module: 'secret-length',
      params: {
        side: 'ru',
        revealAfterSetupOf: 'ge',
        rule: 'SSR 1',
        options: [
          {
            label: '4.5',
            turns: 5,
            halfFinalTurn: true,
            boards: 'x and all hexes ≥ 4 on board v',
            area: S36_AREA_45,
            remove: [
              { force: 'ru', def: 'ru.628', count: 2 },
              { force: 'ru', def: 'ru.L81', count: 1 },
              { force: 'ru', def: 'ru.MMG', count: 1 },
              { force: 'ru', def: 'ru.DC', count: 1 },
              { force: 'ru', def: 'ru.T3485', count: 1 },
              { force: 'ru', def: 'ru.IS2', count: 1 },
            ],
            entry: { forces: ['ru'], edge: 'S45', hexes: S36_EDGE_45, beyond: 'N' },
          },
          {
            label: '5.5',
            turns: 6,
            halfFinalTurn: true,
            boards: 'x and v',
            area: S36_AREA_55,
            remove: [
              { force: 'ru', def: 'ru.447', count: 2 },
              { force: 'ru', def: 'ru.L70', count: 1 },
              { force: 'ru', def: 'ru.LMG', count: 1 },
              { force: 'ru', def: 'ru.IS2', count: 1 },
            ],
            entry: { forces: ['ru'], edge: 'S55', hexes: S36_EDGE_55, beyond: 'N' },
          },
          { label: '6.5', turns: 7, halfFinalTurn: true, boards: 'all 3 boards are in play' },
        ],
      },
      text: 'Prior to setup, the Russian player secretly records if the game will be 4.5, 5.5, or 6.5 turns long and reveals this after the German player has set up. The following table displays which boards are in play and which forces are removed from the Russian OB based on the selected game length.\n\nTurns: 4.5 — Boards: x and all hexes ≥ 4 on board v — Remove from Russian OB: 2 × 6-2-8, 8-1, MMG, DC, T-34/85, IS-2\n\nTurns: 5.5 — Boards: x and v — Remove from Russian OB: 2 × 4-4-7, 7-0, LMG, IS-2\n\nTurns: 6.5 — Boards: all 3 boards are in play — Remove from Russian OB: nothing',
    },
    {
      module: 'reinforcement-table',
      params: {
        side: 'ge',
        turn: 2,
        force: 'ge-t2',
        rule: 'SSR 2',
        table: 'Reinforcement Table',
        rows: [
          { dr: [1, 2], units: [{ def: 'ge.pzivh', count: 2 }, { def: 'ge.stgiiig', count: 1 }] },
          { dr: [3, 4], units: [{ def: 'ge.pzivf2', count: 2 }, { def: 'ge.pzivh', count: 2 }] },
          { dr: [5, 6], units: [{ def: 'ge.pzivj', count: 2 }, { def: 'ge.pzivf2', count: 1 }] },
        ],
      },
      text: 'At the start of the German Turn 2 Rally Phase, the German player makes a dr on his Reinforcement Table to determine the composition of his reinforcements.\n\nReinforcement Table — dr 1,2: 2 × PzIVH, StuG IIIG; dr 3,4: 2 × PzIVF2, 2 × PzIVH; dr 5,6: 2 × PxIVJ, PzIVF2',
    },
    { module: 'special-ammo', params: { defs: { 'ru.T3485': [{ kind: 'APCR', steps: [{ n: 6 }] }] } }, text: 'The Russian T-34/85s have an APCR Depletion Number (6.2) of 6.' },
  ],
  balance: [
    { side: 'ge', text: 'Add one PSK to the German OB.', changes: [{ op: 'addSw', force: 'ge', sw: 'ge.PSK', to: 'ge.447', count: 1 }] },
    { side: 'ru', text: 'Exchange the 9-1 leader with a 9-2 leader.', changes: [{ op: 'swapUnits', force: 'ru', from: 'ru.L91', to: 'ru.L92', count: 1 }] },
  ],
};

// ------------------------------------------------------------------ coming soon

interface CardFacts {
  number: string;
  title: string;
  /** Names credited; `credit` is the card's full credit line when it is not "Scenario Design". */
  designer?: string;
  credit?: string;
  place: string;
  date: string;
  month: number;
  history: string;
  aftermath: string;
  victoryText: string;
  ssr: string[];
  balance: { side: string; text: string }[];
  notes?: string[];
  boards: string[];
  turns: number;
  halfFinalTurn: boolean;
  sides: ScenarioDef['sides'];
  firstSide: string;
  needs: string[];
}

/** A card the engine cannot play yet: the card's text for the catalogue and briefing, no force or victory data. */
function comingSoon(f: CardFacts): ScenarioDef {
  const number = f.number.toLowerCase();
  return {
    id: `sk-${number}`,
    product: 'sk-dl',
    number: f.number,
    title: `${f.number} ${f.title}`,
    status: 'coming-soon',
    needs: f.needs,
    ...(f.designer ? { designer: f.designer } : {}),
    ...(f.credit ? { credit: f.credit } : {}),
    place: f.place,
    date: f.date,
    history: f.history,
    aftermath: f.aftermath,
    victoryText: f.victoryText,
    photo: { src: `scenarios/sk-${number}.jpg` },
    ...(f.notes ? { notes: f.notes } : {}),
    boards: f.boards.map((board) => ({ board, position: '0,0' })),
    turns: f.turns,
    halfFinalTurn: f.halfFinalTurn,
    month: f.month,
    firstSide: f.firstSide,
    sides: f.sides,
    forces: [],
    victory: [],
    ssr: f.ssr.map((text) => ({ module: 'text', text })),
    balance: f.balance.map((b) => ({ side: b.side, text: b.text, unavailable: 'this scenario is not playable yet', changes: [] })),
  };
}

const COMING_SOON: ScenarioDef[] = [
];

export const SK_DOWNLOAD_SCENARIOS: ScenarioDef[] = [SK_S7, SK_S8, SK_S17, SK_S18, SK_S19, SK_S28, SK_S29, SK_S30, SK_S31, SK_S32, SK_S33, SK_S34, SK_S35, SK_S36, ...COMING_SOON];
