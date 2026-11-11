import type { ScenarioDef } from '@asl/rules';

/**
 * Original demo scenario (not an MMP scenario) on board y for testing the client.
 * Americans must take the stone building cluster around yP5 from a German platoon.
 */
export const DEMO_SCENARIO: ScenarioDef = {
  id: 'demo-crossroads',
  product: 'demo',
  number: 'Demo 1',
  title: 'Demo Crossroads (test scenario)',
  boards: [{ board: 'y', position: '0,0' }],
  turns: 5,
  halfFinalTurn: true,
  place: 'Training ground, Normandy',
  month: 7,
  firstSide: 'am',
  sides: [
    { side: 'am', name: 'American', nationality: 'am', elr: 4 },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3, setupFirst: true },
  ],
  forces: [
    // Every SK1 SW type is on the map so MG breakdown/repair, FT and DC play can be tried out.
    { side: 'ge', units: [{ def: 'ge.467', count: 1, withSw: ['ge.LMG'] }], setup: { kind: 'hexes', hexes: ['yP5'] } },
    { side: 'ge', units: [{ def: 'ge.467', count: 1, withSw: ['ge.HMG'] }], setup: { kind: 'hexes', hexes: ['yP6'] } },
    { side: 'ge', units: [{ def: 'ge.447', count: 1, withSw: ['ge.MMG'] }], setup: { kind: 'hexes', hexes: ['yP1'] } },
    { side: 'ge', units: [{ def: 'ge.447', count: 1, withSw: ['ge.FT', 'ge.DC'] }], setup: { kind: 'hexes', hexes: ['yP6'] } },
    { side: 'ge', units: [{ def: 'ge.L81', count: 1 }], setup: { kind: 'hexes', hexes: ['yP5'] } },
    { side: 'am', units: [{ def: 'am.747', count: 1, withSw: ['am.FT', 'am.DC'] }, { def: 'am.L91', count: 1 }], setup: { kind: 'hexes', hexes: ['yJ8', 'yJ8'] } },
    { side: 'am', units: [{ def: 'am.666', count: 2, withSw: ['am.LMG'] }], setup: { kind: 'hexes', hexes: ['yK8', 'yL9'] } },
    { side: 'am', units: [{ def: 'am.666', count: 1, withSw: ['am.MMG'] }], setup: { kind: 'hexes', hexes: ['yM9'] } },
    { side: 'am', units: [{ def: 'am.667', count: 1, withSw: ['am.HMG'] }], setup: { kind: 'hexes', hexes: ['yM9'] } },
    // Green squad with a DC: Inexperienced penalties (3 MF, X# 12 → 9) unless a leader is along.
    { side: 'am', units: [{ def: 'am.546', count: 1 }, { def: 'am.536', count: 1, withSw: ['am.DC'] }], setup: { kind: 'enter', turn: 2, edge: 'S' } },
  ],
  victory: [{ kind: 'controlHexes', side: 'am', hexes: ['yP5', 'yP6'], atLeast: 2 }],
  ssr: [],
};
