import type { ScenarioDef } from '@asl/rules';
import { PTO_TERRAIN_MODULE } from '@asl/rules';
import { hexesWhere } from './areas';

/**
 * Original demo scenario (not an MMP scenario) on board o for the Pacific rules (SK4 8): PTO Terrain is in
 * effect (the woods are jungle, the grain kunai, the orchards palm trees, the wooden-building clusters huts,
 * there are no roads), the Japanese defend the hut village in hexrows Y–DD with four concealment counters
 * in their OB, and the Marines come out of the kunai in the west to take it. Every unit is Infantry, so the
 * game shows Concealment (8.3) and the terrain chart (8.2) without the Japanese special rules (8.1) and the
 * USMC deploy/recombine (8.4) getting in the way; those get their own demos once they exist.
 */
export const DEMO_PACIFIC_SCENARIO: ScenarioDef = {
  id: 'demo-pacific',
  product: 'demo',
  // Until the SK4 cards are in and the Pacific rules have been played: not offered to players.
  devOnly: true,
  number: 'Demo 4',
  title: 'Demo Hut Village (test scenario)',
  boards: [{ board: 'o', position: '0,0' }],
  turns: 6,
  halfFinalTurn: true,
  place: 'Training ground, Solomon Islands',
  month: 11,
  date: '10 November 1942',
  firstSide: 'am',
  sides: [
    { side: 'am', name: 'U.S. Marine Corps', nationality: 'am', elr: 4 },
    { side: 'ja', name: 'Japanese', nationality: 'ja', elr: 4, setupFirst: true },
  ],
  forces: [
    {
      id: 'ja-village',
      group: 'Village garrison',
      side: 'ja',
      units: [
        { def: 'ja.447', count: 2, withSw: ['ja.LMG'] },
        { def: 'ja.447', count: 1, withSw: ['ja.MMG'] },
        { def: 'ja.447', count: 1 },
        { def: 'ja.347', count: 2 },
        { def: 'ja.L91', count: 1 },
        { def: 'ja.L80', count: 1 },
      ],
      concealment: 4,
      setup: { kind: 'area', description: 'set up on/east of hexrow T', hexes: hexesWhere('o', { rows: ['T', 'GG'] }) },
    },
    {
      id: 'am-assault',
      group: 'Assault company',
      side: 'am',
      units: [
        { def: 'am.768', count: 2, withSw: ['am.LMG'] },
        { def: 'am.768', count: 1, withSw: ['am.MMG'] },
        { def: 'am.768', count: 3 },
        { def: 'am.L92', count: 1 },
        { def: 'am.L81', count: 1 },
      ],
      setup: { kind: 'area', description: 'set up on/west of hexrow N', hexes: hexesWhere('o', { rows: ['K', 'N'] }) },
    },
  ],
  victory: [{ kind: 'controlHexes', side: 'am', hexes: ['oY5', 'oAA4', 'oAA5', 'oCC6', 'oDD5'], atLeast: 3 }],
  ssr: [{ module: PTO_TERRAIN_MODULE }],
};
