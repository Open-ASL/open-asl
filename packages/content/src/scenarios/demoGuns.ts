import type { ScenarioDef } from '@asl/rules';
import { hexesWhere } from './areas';

/**
 * Original demo scenario (not an MMP scenario) on board y showing off ordnance: Guns, Light Mortars
 * and Bazookas. The German gun line is set up by hand (Covered Arc, Emplacement, HIP): a PaK 40
 * (Smoke s7, APCR), a 2cm FlaK 38 (IFE, ROF 3, B11) and an 81mm Mortar (Smoke s8), with the infantry
 * fixed in the stone buildings around yP5/yP6 and a 50mm Light Mortar half-squad in the orchard at
 * yQ5. The Americans place their Guns by hand too, to turn their Covered Arcs east: an 81mm Mortar
 * (WP8) for yL1 and a QSU 57mm AT Gun (HE7, APDS4) for yM2 to push along the yM3 road. The rest is
 * fixed: two Bazookas (one in the yN5 building for Backblast, one in the open at yM3), a 60mm Light
 * Mortar at yL9 and a leader-directed MG group to the south.
 */
export const DEMO_GUNS_SCENARIO: ScenarioDef = {
  id: 'demo-gun-line',
  product: 'demo',
  number: 'Demo 2',
  title: 'Demo Gun Line (test scenario)',
  boards: [{ board: 'y', position: '0,0' }],
  turns: 5,
  halfFinalTurn: true,
  place: 'Training ground, Normandy',
  month: 7,
  date: '10 July 1944',
  firstSide: 'am',
  sides: [
    { side: 'am', name: 'American', nationality: 'am', elr: 4 },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3, setupFirst: true },
  ],
  forces: [
    {
      id: 'ge-guns',
      group: 'Gun line',
      side: 'ge',
      units: [
        { def: 'ge.228c', count: 1, withSw: ['ge.AT75L'] },
        { def: 'ge.228c', count: 1, withSw: ['ge.AA20L4'] },
        { def: 'ge.228c', count: 1, withSw: ['ge.MTR81s'] },
      ],
      setup: { kind: 'area', description: 'set up on/east of hexrow O', hexes: hexesWhere('y', { rows: ['O', 'W'] }) },
    },
    { side: 'ge', units: [{ def: 'ge.467', count: 1, withSw: ['ge.LMG'] }], setup: { kind: 'hexes', hexes: ['yP5'] } },
    { side: 'ge', units: [{ def: 'ge.467', count: 1 }, { def: 'ge.L81', count: 1 }], setup: { kind: 'hexes', hexes: ['yP6', 'yP6'] } },
    { side: 'ge', units: [{ def: 'ge.247h', count: 1, withSw: ['ge.MTR'] }], setup: { kind: 'hexes', hexes: ['yQ5'] } },
    {
      id: 'am-guns',
      group: 'Gun section',
      side: 'am',
      units: [
        { def: 'am.228c', count: 1, withSw: ['am.MTR81s'] },
        { def: 'am.228c', count: 1, withSw: ['am.AT57L'] },
      ],
      // Placed by hand so their Covered Arcs can be turned toward the Germans.
      setup: { kind: 'area', description: 'set up in L1 and M2', hexes: ['yL1', 'yM2'], maxMmcPerHex: 1 },
    },
    { side: 'am', units: [{ def: 'am.666', count: 1, withSw: ['am.BAZ44'] }], setup: { kind: 'hexes', hexes: ['yN5'] } },
    { side: 'am', units: [{ def: 'am.666', count: 1, withSw: ['am.BAZ44'] }], setup: { kind: 'hexes', hexes: ['yM3'] } },
    { side: 'am', units: [{ def: 'am.666', count: 1, withSw: ['am.MTR'] }], setup: { kind: 'hexes', hexes: ['yL9'] } },
    { side: 'am', units: [{ def: 'am.666', count: 2, withSw: ['am.LMG'] }, { def: 'am.L91', count: 1 }], setup: { kind: 'hexes', hexes: ['yL8', 'yL8', 'yL8'] } },
    { side: 'am', units: [{ def: 'am.666', count: 1, withSw: ['am.MMG'] }], setup: { kind: 'hexes', hexes: ['yM9'] } },
  ],
  victory: [{ kind: 'controlHexes', side: 'am', hexes: ['yP5', 'yP6'], atLeast: 2 }],
  ssr: [],
};
