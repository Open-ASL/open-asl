import type { ScenarioDef } from '@asl/rules';

/**
 * Original demo scenario (not an MMP scenario) on board y for trying out vehicles from Turn 1: every
 * AFV starts on the map in a fixed hex facing the enemy (Americans east, Germans west), so the game
 * opens straight in the Rally Phase with no setup or entry to drive first. The Americans hold the
 * west with four Shermans and a Stuart (Crew Exposed) in the open around hexrows L-M, with a Bazooka
 * team in yL5; the Germans face them six to
 * eight hexes east with two PzKw IVH, a Panther, a StuG IIIG, a JgdPz 38(t) and a PSW 234/1 armored
 * car, and a Panzerschreck squad in the yR7 stone building. A mix of turreted, non-turreted and wheeled
 * AFV for fire, CE/BU, Motion, Bog and Close Combat tests.
 */
export const DEMO_VEHICLES_SCENARIO: ScenarioDef = {
  id: 'demo-armor',
  product: 'demo',
  number: 'Demo 3',
  title: 'Demo Armor Clash (test scenario)',
  boards: [{ board: 'y', position: '0,0' }],
  turns: 5,
  halfFinalTurn: true,
  place: 'Training ground, Normandy',
  month: 8,
  date: '10 August 1944',
  firstSide: 'am',
  sides: [
    { side: 'am', name: 'American', nationality: 'am', elr: 4 },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3, setupFirst: true },
  ],
  forces: [
    { side: 'ge', units: [{ def: 'ge.pzivh', count: 2 }], setup: { kind: 'hexes', hexes: ['yS4', 'yS6'], vca: 4 } },
    { side: 'ge', units: [{ def: 'ge.pzvg', count: 1 }], setup: { kind: 'hexes', hexes: ['yT6'], vca: 4 } },
    { side: 'ge', units: [{ def: 'ge.stgiiig', count: 1 }], setup: { kind: 'hexes', hexes: ['yR3'], vca: 4 } },
    { side: 'ge', units: [{ def: 'ge.jgpz38', count: 1 }], setup: { kind: 'hexes', hexes: ['yS5'], vca: 4 } },
    { side: 'ge', units: [{ def: 'ge.psw2341', count: 1 }], setup: { kind: 'hexes', hexes: ['yR8'], vca: 4 } },
    { side: 'ge', units: [{ def: 'ge.467', count: 1, withSw: ['ge.PSK'] }, { def: 'ge.L81', count: 1 }], setup: { kind: 'hexes', hexes: ['yR7', 'yR7'] } },
    { side: 'am', units: [{ def: 'am.M4A3', count: 2 }], setup: { kind: 'hexes', hexes: ['yL1', 'yM2'], vca: 1 } },
    { side: 'am', units: [{ def: 'am.M4A3E2', count: 1 }], setup: { kind: 'hexes', hexes: ['yM8'], vca: 1 } },
    { side: 'am', units: [{ def: 'am.M4A2L', count: 1 }], setup: { kind: 'hexes', hexes: ['yL6'], vca: 1 } },
    { side: 'am', units: [{ def: 'am.M5A1', count: 1 }], setup: { kind: 'hexes', hexes: ['yL4'], vca: 1, ce: true } },
    { side: 'am', units: [{ def: 'am.667', count: 1, withSw: ['am.BAZ44'] }, { def: 'am.L81', count: 1 }], setup: { kind: 'hexes', hexes: ['yL5', 'yL5'] } },
  ],
  victory: [{ kind: 'afvLead', side: 'am' }],
  ssr: [],
};
