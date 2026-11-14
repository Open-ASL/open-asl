import type { ScenarioDef } from '@asl/rules';
import { PTO_TERRAIN_MODULE } from '@asl/rules';

/**
 * Original demo scenario (not an MMP scenario) on board o for trying out the Pacific rules from Turn 1: every
 * unit starts on the map in a fixed hex, so the game opens straight in the Marine Rally Phase. PTO Terrain is in
 * effect (SK4 8.2: the woods are Dense Jungle, the grain kunai, the orchards palm trees, the hut clusters huts).
 * The Marines start in the jungle west of the hut village, out of its LOS; the Japanese hold the huts with a
 * Type 97 CHI-HA in the village and a Banzai group (a 9-1 and two 4-4-7) in the jungle at oAA9, four hexes from
 * the Marines in oW8 across open ground.
 *
 * What it puts in reach on the first two Player Turns:
 * - Concealment (8.3): a unit no enemy can see after setup starts concealed (8.3 setup), so every hut and the
 *   Marines in oW4/oW5 start under "?"; the Banzai group and the Marines in oW8 see each other and do not.
 * - Japanese Step Reduction (8.1.2), leaders (8.1.7), the Knee Mortar and their MGs (8.1.8.2).
 * - Marine deploy in the RPh by NTC (8.4) and recombine (8.4.1): two 3-4-8 start with the 8-1 in oW5.
 * - The Banzai Charge (8.1.8.6) on the Japanese Turn 1 MPh against the Marines in oW8, with TPBF (8.1.8.7), then
 *   Hand-to-Hand Close Combat (8.1.8.4) in the CCPh.
 * - A Bazooka against the CHI-HA, and huts collapsing under a moving AFV (8.2).
 * The stacks in Dense Jungle keep to its 2 squad-equivalent limit (8.2).
 */
export const DEMO_JUNGLE_SCENARIO: ScenarioDef = {
  id: 'demo-jungle',
  product: 'demo',
  number: 'Demo 5',
  title: 'Demo Jungle Village (test scenario)',
  boards: [{ board: 'o', position: '0,0' }],
  turns: 4,
  halfFinalTurn: true,
  place: 'Training ground, Mariana Islands',
  month: 6,
  date: '20 June 1944',
  firstSide: 'am',
  sides: [
    { side: 'am', name: 'U.S. Marine Corps', nationality: 'am', elr: 5 },
    { side: 'ja', name: 'Japanese', nationality: 'ja', elr: 4, setupFirst: true },
  ],
  forces: [
    { side: 'ja', group: 'Village garrison', units: [{ def: 'ja.237h', count: 1 }], setup: { kind: 'hexes', hexes: ['oY5'] } },
    { side: 'ja', group: 'Village garrison', units: [{ def: 'ja.447', count: 1, withSw: ['ja.LMG'] }, { def: 'ja.L80', count: 1 }], setup: { kind: 'hexes', hexes: ['oAA5', 'oAA5'] } },
    { side: 'ja', group: 'Village garrison', units: [{ def: 'ja.447', count: 1, withSw: ['ja.MMG'] }], setup: { kind: 'hexes', hexes: ['oAA4'] } },
    { side: 'ja', group: 'Village garrison', units: [{ def: 'ja.347', count: 1, withSw: ['ja.MTR'] }], setup: { kind: 'hexes', hexes: ['oCC6'] } },
    { side: 'ja', group: 'Village garrison', units: [{ def: 'ja.447', count: 1 }], setup: { kind: 'hexes', hexes: ['oDD5'] } },
    { side: 'ja', group: 'Tank', units: [{ def: 'ja.ty97Bchiha', count: 1 }], setup: { kind: 'hexes', hexes: ['oZ7'], vca: 4 } },
    { side: 'ja', group: 'Banzai group', units: [{ def: 'ja.L91', count: 1 }, { def: 'ja.447', count: 2 }], setup: { kind: 'hexes', hexes: ['oAA9', 'oAA9', 'oAA9'] } },
    { side: 'am', group: 'Assault platoon', units: [{ def: 'am.L92', count: 1 }, { def: 'am.768', count: 1, withSw: ['am.MMG'] }, { def: 'am.768', count: 1 }], setup: { kind: 'hexes', hexes: ['oW4', 'oW4', 'oW4'] } },
    { side: 'am', group: 'Assault platoon', units: [{ def: 'am.L81', count: 1 }, { def: 'am.768', count: 1, withSw: ['am.BAZ44'] }, { def: 'am.348h', count: 2 }], setup: { kind: 'hexes', hexes: ['oW5', 'oW5', 'oW5', 'oW5'] } },
    { side: 'am', group: 'Assault platoon', units: [{ def: 'am.768', count: 2, withSw: ['am.LMG'] }], setup: { kind: 'hexes', hexes: ['oW8', 'oW8'] } },
  ],
  victory: [{ kind: 'controlHexes', side: 'am', hexes: ['oY5', 'oAA4', 'oAA5', 'oCC6', 'oDD5'], atLeast: 3 }],
  ssr: [{ module: PTO_TERRAIN_MODULE }],
};
