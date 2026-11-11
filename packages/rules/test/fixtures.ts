import {
  Engine,
  buildRuleset,
  type Action,
  type GameState,
  type Piece,
  type RuleModule,
} from '@asl/engine';
import {
  HexGridMap,
  SK4_TERRAIN,
  piecesModule,
  turnModule,
  type CounterDef,
  type HexTerrainSpec,
  type IftResult,
  type ScenarioDef,
  type Statics,
  type Tables,
} from '../src';
import { sk1CoreModules } from '../src/sk1';

/**
 * TEST FIXTURE counters. Real counter values come from the content package
 * (VASL import + verified overlay); these exist only to exercise the rules.
 */
export const COUNTERS: Record<string, CounterDef> = {
  'ge.467': { id: 'ge.467', nationality: 'ge', kind: 'squad', quality: '1', fp: 4, range: 6, morale: 7, brokenMorale: 7, selfRally: false, assaultFire: false, smoke: 1, elrExempt: false, reducesTo: 'ge.247', elrReplacement: 'ge.447' },
  'ge.447': { id: 'ge.447', nationality: 'ge', kind: 'squad', quality: '2', fp: 4, range: 4, morale: 7, brokenMorale: 6, selfRally: false, assaultFire: false, elrExempt: false, reducesTo: 'ge.237', elrReplacement: 'ge.436' },
  'ge.436': { id: 'ge.436', nationality: 'ge', kind: 'squad', quality: 'G', fp: 4, range: 3, morale: 6, brokenMorale: 6, selfRally: false, assaultFire: false, elrExempt: false, reducesTo: 'ge.236' },
  'ge.247': { id: 'ge.247', nationality: 'ge', kind: 'hs', quality: '1', fp: 2, range: 4, morale: 7, brokenMorale: 7, selfRally: false, assaultFire: false, elrExempt: false, elrReplacement: 'ge.237' },
  'ge.237': { id: 'ge.237', nationality: 'ge', kind: 'hs', quality: '2', fp: 2, range: 3, morale: 7, brokenMorale: 6, selfRally: false, assaultFire: false, elrExempt: false, elrReplacement: 'ge.236' },
  'ge.236': { id: 'ge.236', nationality: 'ge', kind: 'hs', quality: 'G', fp: 2, range: 3, morale: 6, brokenMorale: 6, selfRally: false, assaultFire: false, elrExempt: false },
  'ge.L91': { id: 'ge.L91', nationality: 'ge', kind: 'leader', morale: 9, brokenMorale: 9, leadership: -1, selfRally: true, elrReplacement: 'ge.L81' },
  'ge.L81': { id: 'ge.L81', nationality: 'ge', kind: 'leader', morale: 8, brokenMorale: 8, leadership: -1, selfRally: true, elrReplacement: 'ge.L80' },
  'ge.L80': { id: 'ge.L80', nationality: 'ge', kind: 'leader', morale: 8, brokenMorale: 8, leadership: 0, selfRally: true },
  'ge.LMG': { id: 'ge.LMG', nationality: 'ge', kind: 'sw', type: 'LMG', fp: 3, range: 8, pp: 1, rof: 1, b: 11, repair: 1, removeOnRepair6: true },
  'ge.MMG': { id: 'ge.MMG', nationality: 'ge', kind: 'sw', type: 'MMG', fp: 5, range: 12, pp: 4, rof: 2, repair: 2, removeOnRepair6: true },
  'am.747': { id: 'am.747', nationality: 'am', kind: 'squad', quality: 'E', fp: 7, range: 4, morale: 7, brokenMorale: 7, selfRally: true, assaultFire: true, smoke: 2, elrExempt: false, reducesTo: 'am.347' },
  'am.666': { id: 'am.666', nationality: 'am', kind: 'squad', quality: '1', fp: 6, range: 6, morale: 6, brokenMorale: 6, selfRally: false, assaultFire: true, smoke: 1, elrExempt: false, reducesTo: 'am.336', bpv: 11 },
  // An early-war 4-4-7 (BPV 7): a better Morale than the 6-6-6 but a lower BPV (A18.2 vs SK1 5.3).
  'am.447': { id: 'am.447', nationality: 'am', kind: 'squad', quality: '2', fp: 4, range: 4, morale: 7, brokenMorale: 7, selfRally: false, assaultFire: false, elrExempt: false, bpv: 7 },
  'am.536': { id: 'am.536', nationality: 'am', kind: 'squad', quality: 'G', fp: 5, range: 3, morale: 6, brokenMorale: 6, selfRally: false, assaultFire: false, elrExempt: false, reducesTo: 'am.336' },
  'am.347': { id: 'am.347', nationality: 'am', kind: 'hs', quality: 'E', fp: 3, range: 4, morale: 7, brokenMorale: 7, selfRally: true, assaultFire: true, elrExempt: false },
  'am.336': { id: 'am.336', nationality: 'am', kind: 'hs', quality: '1', fp: 3, range: 3, morale: 6, brokenMorale: 6, selfRally: false, assaultFire: true, elrExempt: false },
  'am.MMG': { id: 'am.MMG', nationality: 'am', kind: 'sw', type: 'MMG', fp: 4, range: 10, pp: 3, rof: 2, repair: 2, removeOnRepair6: true },
  'am.L102': { id: 'am.L102', nationality: 'am', kind: 'leader', morale: 10, brokenMorale: 10, leadership: -2, selfRally: true, elrReplacement: 'am.L92' },
  'am.L91': { id: 'am.L91', nationality: 'am', kind: 'leader', morale: 9, brokenMorale: 9, leadership: -1, selfRally: true },
  'ru.447': { id: 'ru.447', nationality: 'ru', kind: 'squad', quality: '1', fp: 4, range: 4, morale: 7, brokenMorale: 7, selfRally: false, assaultFire: false, elrExempt: false, reducesTo: 'ru.247' },
  'ru.527': { id: 'ru.527', nationality: 'ru', kind: 'squad', quality: '1', fp: 5, range: 2, morale: 7, brokenMorale: 7, selfRally: true, assaultFire: false, elrExempt: false, reducesTo: 'ru.237' },
  'ru.426': { id: 'ru.426', nationality: 'ru', kind: 'squad', quality: 'C', fp: 4, range: 2, morale: 6, brokenMorale: 6, selfRally: false, assaultFire: false, elrExempt: false, reducesTo: 'ru.226' },
  'ru.247': { id: 'ru.247', nationality: 'ru', kind: 'hs', quality: '1', fp: 2, range: 4, morale: 7, brokenMorale: 7, selfRally: false, assaultFire: false, elrExempt: false },
  'ru.237': { id: 'ru.237', nationality: 'ru', kind: 'hs', quality: '1', fp: 2, range: 3, morale: 7, brokenMorale: 7, selfRally: false, assaultFire: false, elrExempt: false },
  'ru.226': { id: 'ru.226', nationality: 'ru', kind: 'hs', quality: 'C', fp: 2, range: 2, morale: 6, brokenMorale: 6, selfRally: false, assaultFire: false, elrExempt: false },
  'ru.458': { id: 'ru.458', nationality: 'ru', kind: 'squad', quality: 'E', fp: 4, range: 5, morale: 8, brokenMorale: 8, selfRally: false, assaultFire: false, elrExempt: false, reducesTo: 'ru.247', elrReplacement: 'ru.447' },
  'ru.L61': { id: 'ru.L61', nationality: 'ru', kind: 'leader', morale: 6, brokenMorale: 6, leadership: 1, selfRally: true },
  'ru.L92': { id: 'ru.L92', nationality: 'ru', kind: 'leader', morale: 9, brokenMorale: 9, leadership: -2, selfRally: true },
  'ru.L91': { id: 'ru.L91', nationality: 'ru', kind: 'leader', morale: 9, brokenMorale: 9, leadership: -1, selfRally: true },
  'ru.L81': { id: 'ru.L81', nationality: 'ru', kind: 'leader', morale: 8, brokenMorale: 8, leadership: -1, selfRally: true },
  'ru.MMG': { id: 'ru.MMG', nationality: 'ru', kind: 'sw', type: 'MMG', fp: 4, range: 10, pp: 5, rof: 2, b: 11, repair: 2, removeOnRepair6: true },
  // The Panzerfaust as imported (SK4 4.4.2): 16-3, TH 10/8/6/4 at 0-3 hexes, HEAT TK 31.
  'ge.PF': { id: 'ge.PF', nationality: 'ge', kind: 'sw', type: 'PF', fp: 16, range: 3, pp: 0, latw: { th: [10, 8, 6, 4], tk: 31 } },
  // The Russian Anti-Tank Rifle as imported (SK4 4.4.4): 1-12, no B# printed.
  'ru.ATR': { id: 'ru.ATR', nationality: 'ru', kind: 'sw', type: 'ATR', fp: 1, range: 12, pp: 1, repair: 1, removeOnRepair6: true },
  // The Japanese and the U.S. Marine Corps as imported (SK4 8.1, 8.4): no broken side on squads, crews and leaders;
  // Full-Strength squads step to their Reduced side (`stepTo`), Reduced ones to a HS (`reducesTo`).
  'ja.448': { id: 'ja.448', nationality: 'ja', kind: 'squad', quality: 'E', fp: 4, range: 4, morale: 8, brokenMorale: 8, selfRally: false, assaultFire: false, smoke: 2, elrExempt: false, reducesTo: 'ja.238h', elrReplacement: 'ja.447', noBrokenSide: true, stepTo: 'ja.348r' },
  'ja.348r': { id: 'ja.348r', nationality: 'ja', kind: 'squad', quality: 'E', fp: 3, range: 4, morale: 8, brokenMorale: 8, selfRally: false, assaultFire: false, smoke: 2, elrExempt: false, reducesTo: 'ja.238h', elrReplacement: 'ja.347r', noBrokenSide: true, fullOf: 'ja.448' },
  'ja.447': { id: 'ja.447', nationality: 'ja', kind: 'squad', quality: '1', fp: 4, range: 4, morale: 7, brokenMorale: 7, selfRally: false, assaultFire: false, smoke: 1, elrExempt: false, reducesTo: 'ja.237h', elrReplacement: 'ja.347', noBrokenSide: true, stepTo: 'ja.347r' },
  'ja.347r': { id: 'ja.347r', nationality: 'ja', kind: 'squad', quality: '1', fp: 3, range: 4, morale: 7, brokenMorale: 7, selfRally: false, assaultFire: false, smoke: 1, elrExempt: false, reducesTo: 'ja.237h', elrReplacement: 'ja.237r', noBrokenSide: true, fullOf: 'ja.447' },
  'ja.347': { id: 'ja.347', nationality: 'ja', kind: 'squad', quality: '2', fp: 3, range: 4, morale: 7, brokenMorale: 7, selfRally: false, assaultFire: false, elrExempt: false, reducesTo: 'ja.137h', elrReplacement: 'ja.336', noBrokenSide: true, stepTo: 'ja.237r' },
  'ja.237r': { id: 'ja.237r', nationality: 'ja', kind: 'squad', quality: '2', fp: 2, range: 3, morale: 7, brokenMorale: 7, selfRally: false, assaultFire: false, elrExempt: false, reducesTo: 'ja.137h', elrReplacement: 'ja.226r', noBrokenSide: true, fullOf: 'ja.347' },
  'ja.336': { id: 'ja.336', nationality: 'ja', kind: 'squad', quality: 'C', fp: 3, range: 3, morale: 6, brokenMorale: 6, selfRally: false, assaultFire: false, elrExempt: false, reducesTo: 'ja.126h', noBrokenSide: true, stepTo: 'ja.226r' },
  'ja.226r': { id: 'ja.226r', nationality: 'ja', kind: 'squad', quality: 'C', fp: 2, range: 2, morale: 6, brokenMorale: 6, selfRally: false, assaultFire: false, elrExempt: false, reducesTo: 'ja.126h', noBrokenSide: true, fullOf: 'ja.336' },
  'ja.238h': { id: 'ja.238h', nationality: 'ja', kind: 'hs', quality: 'E', fp: 2, range: 3, morale: 8, brokenMorale: 8, selfRally: false, assaultFire: false, elrExempt: false, elrReplacement: 'ja.237h' },
  'ja.237h': { id: 'ja.237h', nationality: 'ja', kind: 'hs', quality: '1', fp: 2, range: 3, morale: 7, brokenMorale: 7, selfRally: false, assaultFire: false, elrExempt: false, elrReplacement: 'ja.137h' },
  'ja.137h': { id: 'ja.137h', nationality: 'ja', kind: 'hs', quality: '2', fp: 1, range: 3, morale: 7, brokenMorale: 6, selfRally: false, assaultFire: false, elrExempt: false, elrReplacement: 'ja.126h' },
  'ja.126h': { id: 'ja.126h', nationality: 'ja', kind: 'hs', quality: 'C', fp: 1, range: 2, morale: 6, brokenMorale: 5, selfRally: false, assaultFire: false, elrExempt: false },
  'ja.228c': { id: 'ja.228c', nationality: 'ja', kind: 'crew', quality: 'E', fp: 2, range: 2, morale: 8, brokenMorale: 8, selfRally: true, assaultFire: false, elrExempt: true, stepTo: 'ja.128cr' },
  'ja.128cr': { id: 'ja.128cr', nationality: 'ja', kind: 'crew', quality: 'E', fp: 1, range: 2, morale: 8, brokenMorale: 8, selfRally: true, assaultFire: false, elrExempt: true, stepTo: 'ja.127c', fullOf: 'ja.228c' },
  'ja.127c': { id: 'ja.127c', nationality: 'ja', kind: 'crew', quality: 'E', fp: 1, range: 2, morale: 7, brokenMorale: 8, selfRally: true, assaultFire: false, elrExempt: true },
  'ja.L101': { id: 'ja.L101', nationality: 'ja', kind: 'leader', morale: 10, brokenMorale: 10, leadership: -1, selfRally: true, elrReplacement: 'ja.L100', noBrokenSide: true },
  'ja.L91': { id: 'ja.L91', nationality: 'ja', kind: 'leader', morale: 9, brokenMorale: 9, leadership: -1, selfRally: true, elrReplacement: 'ja.L90', noBrokenSide: true },
  'ja.L90': { id: 'ja.L90', nationality: 'ja', kind: 'leader', morale: 9, brokenMorale: 9, leadership: 0, selfRally: true, elrReplacement: 'ja.L80', noBrokenSide: true },
  'ja.L80': { id: 'ja.L80', nationality: 'ja', kind: 'leader', morale: 8, brokenMorale: 8, leadership: 0, selfRally: true, elrReplacement: 'ja.L8p1', noBrokenSide: true },
  'ja.L8p1': { id: 'ja.L8p1', nationality: 'ja', kind: 'leader', morale: 8, brokenMorale: 8, leadership: 1, selfRally: true, noBrokenSide: true },
  'ja.LMG': { id: 'ja.LMG', nationality: 'ja', kind: 'sw', type: 'LMG', fp: 2, range: 6, pp: 1, rof: 1, b: 11, repair: 1, removeOnRepair6: true },
  'ja.MMG': { id: 'ja.MMG', nationality: 'ja', kind: 'sw', type: 'MMG', fp: 4, range: 11, pp: 3, rof: 2, b: 11, repair: 2, removeOnRepair6: true },
  'ja.ATR': { id: 'ja.ATR', nationality: 'ja', kind: 'sw', type: 'ATR', fp: 1, range: 12, pp: 5, rof: 2, repair: 1, removeOnRepair6: true },
  'am.768': { id: 'am.768', nationality: 'am', kind: 'squad', quality: 'E', fp: 7, range: 6, morale: 8, brokenMorale: 8, selfRally: false, assaultFire: true, smoke: 3, elrExempt: true, reducesTo: 'am.348h' },
  'am.348h': { id: 'am.348h', nationality: 'am', kind: 'hs', quality: 'E', fp: 3, range: 4, morale: 8, brokenMorale: 7, selfRally: false, assaultFire: false, elrExempt: true },
  'am.558r': { id: 'am.558r', nationality: 'am', kind: 'squad', quality: 'E', fp: 5, range: 5, morale: 8, brokenMorale: 8, selfRally: false, assaultFire: true, smoke: 2, elrExempt: true, reducesTo: 'am.238rh', raider: true },
  'am.MTR': { id: 'am.MTR', nationality: 'am', kind: 'sw', type: 'MTR', ordnance: { caliber: 60, barrel: '*', minRange: 3, maxRange: 45 }, fp: 0, range: 45, pp: 5, rof: 3, repair: 1, removeOnRepair6: true },
  'am.558p': { id: 'am.558p', nationality: 'am', kind: 'squad', quality: 'E', fp: 5, range: 5, morale: 8, brokenMorale: 8, selfRally: false, assaultFire: false, smoke: 2, elrExempt: true, reducesTo: 'am.238ph' },
  'am.238rh': { id: 'am.238rh', nationality: 'am', kind: 'hs', quality: 'E', fp: 2, range: 3, morale: 8, brokenMorale: 7, selfRally: false, assaultFire: false, elrExempt: true, raider: true },
  'ru.LMG': { id: 'ru.LMG', nationality: 'ru', kind: 'sw', type: 'LMG', fp: 2, range: 6, pp: 1, rof: 1, b: 11, repair: 1, removeOnRepair6: true },
  'am.DC': { id: 'am.DC', nationality: 'am', kind: 'sw', type: 'DC', fp: 30, range: 1, pp: 1, x: 12 },
  'ge.DC': { id: 'ge.DC', nationality: 'ge', kind: 'sw', type: 'DC', fp: 30, range: 1, pp: 1, x: 12 },
  'ge.FT': { id: 'ge.FT', nationality: 'ge', kind: 'sw', type: 'FT', fp: 24, range: 1, pp: 1, x: 10 },
  'am.L80': { id: 'am.L80', nationality: 'am', kind: 'leader', morale: 8, brokenMorale: 8, leadership: 0, selfRally: true },
  // SK2: British and Allied Minor infantry, crews and Guns.
  'br.457': { id: 'br.457', nationality: 'br', kind: 'squad', quality: '1', fp: 4, range: 5, morale: 7, brokenMorale: 7, selfRally: false, assaultFire: false, smoke: 2, elrExempt: false, reducesTo: 'br.247' },
  'br.247': { id: 'br.247', nationality: 'br', kind: 'hs', quality: '1', fp: 2, range: 4, morale: 7, brokenMorale: 6, selfRally: false, assaultFire: false, elrExempt: false },
  'br.228c': { id: 'br.228c', nationality: 'br', kind: 'crew', quality: 'E', fp: 2, range: 2, morale: 8, brokenMorale: 8, selfRally: true, assaultFire: false, elrExempt: true },
  'ge.228c': { id: 'ge.228c', nationality: 'ge', kind: 'crew', quality: 'E', fp: 2, range: 2, morale: 8, brokenMorale: 8, selfRally: true, assaultFire: false, elrExempt: true },
  'am.228c': { id: 'am.228c', nationality: 'am', kind: 'crew', quality: 'E', fp: 2, range: 2, morale: 8, brokenMorale: 8, selfRally: true, assaultFire: false, elrExempt: true },
  'br.L91': { id: 'br.L91', nationality: 'br', kind: 'leader', morale: 9, brokenMorale: 9, leadership: -1, selfRally: true },
  'br.L81': { id: 'br.L81', nationality: 'br', kind: 'leader', morale: 8, brokenMorale: 8, leadership: -1, selfRally: true },
  'br.458': { id: 'br.458', nationality: 'br', kind: 'squad', quality: 'E', fp: 4, range: 5, morale: 8, brokenMorale: 8, selfRally: false, assaultFire: false, smoke: 2, elrExempt: false },
  'br.PIAT': { id: 'br.PIAT', nationality: 'br', kind: 'sw', type: 'PIAT', fp: 8, range: 3, pp: 1, b: 10, repair: 2, removeOnRepair6: true, latw: { th: [11, 9, 7, 5], tk: 15 } },
  'br.AT57L': { id: 'br.AT57L', nationality: 'br', kind: 'gun', type: 'AT', caliber: 57, barrel: 'L', rof: 3, m: 10, targetSize: 'small', mount: 'NT', qsu: true, gunshield: true, ammo: { he: false, ap: true }, repair: 1, removeOnRepair6: true },
  'br.L80': { id: 'br.L80', nationality: 'br', kind: 'leader', morale: 8, brokenMorale: 8, leadership: 0, selfRally: true },
  'br.LMG': { id: 'br.LMG', nationality: 'br', kind: 'sw', type: 'LMG', fp: 2, range: 7, pp: 1, rof: 1, repair: 1, removeOnRepair6: true },
  'al.LMG': { id: 'al.LMG', nationality: 'al', kind: 'sw', type: 'LMG', fp: 2, range: 7, pp: 1, rof: 1, repair: 1, removeOnRepair6: true },
  'br.AA40L': { id: 'br.AA40L', nationality: 'br', kind: 'gun', type: 'AA', caliber: 40, barrel: 'L', rof: 3, ife: 8, m: 8, targetSize: 'normal', mount: '360', qsu: false, gunshield: false, ammo: { he: false, ap: true }, repair: 1, removeOnRepair6: true },
  'ge.AT75L': { id: 'ge.AT75L', nationality: 'ge', kind: 'gun', type: 'AT', caliber: 75, barrel: 'L', rof: 2, m: 10, targetSize: 'normal', mount: 'NT', qsu: true, gunshield: true, ammo: { he: true, ap: true }, repair: 1, removeOnRepair6: true },
  // Special Ammo fixtures (SK4 6.2): a PaK 40 with Smoke s7 and APCR A5²/4³/3⁴, a sIG with s8 and HEAT H7 and
  // no ROF, an American 81mm Mortar with WP8, and a "No IF" Gun.
  'ge.AT75Lsa': { id: 'ge.AT75Lsa', nationality: 'ge', kind: 'gun', type: 'AT', caliber: 75, barrel: 'L', rof: 2, m: 10, targetSize: 'normal', mount: 'NT', qsu: true, gunshield: true, ammo: { he: true, ap: true }, specialAmmo: [{ kind: 'SMOKE', steps: [{ n: 7 }] }, { kind: 'APCR', steps: [{ n: 5, from: { year: 1942 } }, { n: 4, from: { year: 1943 } }, { n: 3, from: { year: 1944 } }] }], repair: 1, removeOnRepair6: true },
  'ge.INF150s': { id: 'ge.INF150s', nationality: 'ge', kind: 'gun', type: 'INF', caliber: 150, barrel: '*', m: 6, targetSize: 'normal', mount: 'NT', qsu: false, gunshield: true, ammo: { he: true, ap: false }, specialAmmo: [{ kind: 'SMOKE', steps: [{ n: 8 }] }, { kind: 'HEAT', steps: [{ n: 7 }] }], repair: 1, removeOnRepair6: true },
  'am.MTR81s': { id: 'am.MTR81s', nationality: 'am', kind: 'gun', type: 'MTR', caliber: 81, barrel: '*', rof: 3, m: 10, targetSize: 'small', mount: '360', qsu: true, gunshield: false, ammo: { he: true, ap: false }, specialAmmo: [{ kind: 'WP', steps: [{ n: 8 }] }], minRange: 3, maxRange: 24, repair: 1, removeOnRepair6: true },
  'ge.AR170L': { id: 'ge.AR170L', nationality: 'ge', kind: 'gun', type: 'ART', caliber: 170, barrel: 'L', rof: 1, m: 4, targetSize: 'large', mount: 'NT', qsu: false, gunshield: false, ammo: { he: true, ap: true }, noIntensive: true, repair: 1, removeOnRepair6: true },
  // A Bazooka-type LATW (SK4 4.4.1) on the German side so the tests need no captured-use penalties.
  'ge.BAZ43': { id: 'ge.BAZ43', nationality: 'ge', kind: 'sw', type: 'BAZ', fp: 8, range: 4, pp: 1, x: 10, latw: { th: [11, 9, 8, 7, 4], tk: 13 } },
  'ge.MTR': { id: 'ge.MTR', nationality: 'ge', kind: 'sw', type: 'MTR', ordnance: { caliber: 50, barrel: '*', minRange: 2, maxRange: 13 }, fp: 0, range: 13, pp: 5, rof: 3, repair: 1, removeOnRepair6: true },
  'ge.AA88L': { id: 'ge.AA88L', nationality: 'ge', kind: 'gun', type: 'AA', caliber: 88, barrel: 'L', rof: 2, m: 12, targetSize: 'large', mount: '360', qsu: false, gunshield: false, ammo: { he: true, ap: true }, repair: 1, removeOnRepair6: true },
  // SK3 vehicles (the S21 tanks, as imported): a T-34 M43 (16 MP, RST, 76L ROF 1, 2/4), a T-34 M41 (red 17 MP, stalls on 11), a PzKpfw IVF2 (14 MP, T).
  'ru.T34M43': { id: 'ru.T34M43', nationality: 'ru', name: 'T-34 M43', kind: 'vehicle', tracked: true, mp: 16, groundPressure: 'normal', af: { hull: { front: 11, side: 6, rear: 6 }, turret: { front: 11, side: 6, rear: 6 } }, turret: 'RST', targetSize: 'normal', ma: { type: 'AT', caliber: 76, barrel: 'L', rof: 1, ammo: { he: true, ap: true } }, mg: { bmg: 2, cmg: 4 }, ceDrm: 2, crewMorale: 8, cvp: 0 },
  'ru.T34M41': { id: 'ru.T34M41', nationality: 'ru', name: 'T-34 M41', kind: 'vehicle', tracked: true, mp: 17, redMp: true, stallOn11: true, groundPressure: 'low', af: { hull: { front: 11, side: 6, rear: 6 }, turret: { front: 8, side: 6, rear: 6 } }, turret: 'RST', targetSize: 'normal', ma: { type: 'AT', caliber: 76, barrel: 'L', ammo: { he: true, ap: true } }, mg: { bmg: 2, cmg: 4 }, ceDrm: 2, crewMorale: 8, cvp: 0 },
  'ge.pzivf2': { id: 'ge.pzivf2', nationality: 'ge', name: 'PzKw IVF2', kind: 'vehicle', tracked: true, mp: 14, groundPressure: 'normal', af: { hull: { front: 6, side: 3, rear: 3 }, turret: { front: 6, side: 4, rear: 4 } }, turret: 'T', targetSize: 'normal', ma: { type: 'AT', caliber: 75, barrel: 'L', rof: 1, ammo: { he: true, ap: true }, specialAmmo: [{ kind: 'SMOKE', steps: [{ n: 8 }] }, { kind: 'APCR', steps: [{ n: 5, from: { year: 1942 } }, { n: 4, from: { year: 1943 } }] }] }, mg: { bmg: 3, cmg: 5 }, smoke: [{ kind: 'sD', n: 6 }], ceDrm: 2, crewMorale: 8, cvp: 0 },
  'ge.stug3g': { id: 'ge.stug3g', nationality: 'ge', name: 'StuG IIIG', kind: 'vehicle', tracked: true, mp: 14, groundPressure: 'normal', af: { hull: { front: 6, side: 3, rear: 3 }, turret: { front: 6, side: 4, rear: 4 } }, turret: 'NT', targetSize: 'normal', ma: { type: 'AT', caliber: 75, barrel: 'L', rof: 1, ammo: { he: true, ap: true }, specialAmmo: [{ kind: 'SMOKE', steps: [{ n: 8 }] }, { kind: 'APCR', steps: [{ n: 5, from: { year: 1942 } }, { n: 4, from: { year: 1943 } }] }] }, mg: { bmg: 3 }, smoke: [{ kind: 'sD', n: 6 }], ceDrm: 2, crewMorale: 8, cvp: 0 },
  'ge.pzvie': { id: 'ge.pzvie', nationality: 'ge', name: 'PzKw VIE', kind: 'vehicle', tracked: true, mp: 12, redMp: true, groundPressure: 'normal', af: { hull: { front: 11, side: 8, rear: 8 }, turret: { front: 14, side: 8, rear: 8 } }, turret: 'ST', targetSize: 'large', ma: { type: 'AT', caliber: 88, barrel: 'L', rof: 1, ammo: { he: true, ap: true }, specialAmmo: [{ kind: 'APCR', steps: [{ n: 6, from: { year: 1942 } }, { n: 5, from: { year: 1943 } }, { n: 4, from: { year: 1944 } }] }] }, mg: { bmg: 3, cmg: 5 }, smoke: [{ kind: 'sD', n: 7 }], cs: 6, ceDrm: 2, crewMorale: 8, cvp: 0 },
  'ru.T34M43.bmg': { id: 'ru.T34M43.bmg', nationality: 'ru', kind: 'sw', type: 'BMG', fp: 2, range: 8, pp: 0, fixed: true, b: 12, repair: 1 },
  'ru.T34M43.cmg': { id: 'ru.T34M43.cmg', nationality: 'ru', kind: 'sw', type: 'CMG', fp: 4, range: 12, pp: 0, fixed: true, b: 12, repair: 1 },
  'ge.psw2341': { id: 'ge.psw2341', nationality: 'ge', name: 'PSW 234/1', kind: 'vehicle', tracked: false, mp: 33, groundPressure: 'normal', af: { hull: { front: 3, side: 1, rear: 1 }, turret: { front: 3, side: 1, rear: 1 } }, turret: 'ST', targetSize: 'small', ma: { type: 'AA', caliber: 20, barrel: 'L', rof: 2, ife: 6, ammo: { he: true, ap: true } }, mg: { cmg: 5 }, cs: 5, ceDrm: 2, crewMorale: 8, cvp: 0 },
  'ge.psw2341.cmg': { id: 'ge.psw2341.cmg', nationality: 'ge', kind: 'sw', type: 'CMG', fp: 5, range: 12, pp: 0, fixed: true, b: 12, repair: 1 },
  'ge.pzivf2.bmg': { id: 'ge.pzivf2.bmg', nationality: 'ge', kind: 'sw', type: 'BMG', fp: 3, range: 8, pp: 0, fixed: true, b: 12, repair: 1 },
  'ge.pzivf2.cmg': { id: 'ge.pzivf2.cmg', nationality: 'ge', kind: 'sw', type: 'CMG', fp: 5, range: 12, pp: 0, fixed: true, b: 12, repair: 1 },
  'ge.otv': { id: 'ge.otv', nationality: 'ge', name: 'OT test AFV', openTopped: true, kind: 'vehicle', tracked: true, mp: 14, groundPressure: 'normal', af: { hull: { front: 6, side: 3, rear: 3 }, turret: { front: 6, side: 4, rear: 4 } }, turret: 'T', targetSize: 'normal', ma: { type: 'AT', caliber: 75, barrel: 'L', rof: 1, ammo: { he: true, ap: true }, specialAmmo: [{ kind: 'SMOKE', steps: [{ n: 8 }] }] }, mg: { bmg: 3, cmg: 5 }, smoke: [{ kind: 'sD', n: 6 }], ceDrm: 2, crewMorale: 8, cvp: 0 },
  'ge.otv.bmg': { id: 'ge.otv.bmg', nationality: 'ge', kind: 'sw', type: 'BMG', fp: 3, range: 8, pp: 0, fixed: true, b: 12, repair: 1 },
  'ge.otv.cmg': { id: 'ge.otv.cmg', nationality: 'ge', kind: 'sw', type: 'CMG', fp: 5, range: 12, pp: 0, fixed: true, b: 12, repair: 1 },
};

/** TEST FIXTURE IFT matching every data point in the SK1 rulebook examples. Not the real chart. */
export const FIXTURE_IFT_COLUMNS = [1, 2, 4, 6, 8, 12, 16, 20, 24, 30, 36];
const FIXTURE_SHIFT: Record<number, number> = { 1: 0, 2: 0, 4: 0, 6: 2, 8: 3, 12: 4, 16: 5, 20: 6, 24: 7, 30: 8, 36: 9 };
export function fixtureIft(column: number, dr: number): IftResult {
  const eff = dr - (FIXTURE_SHIFT[column] ?? 0);
  if (eff <= -1) return { kind: 'KIA', n: 2 };
  if (eff <= 0) return { kind: 'KIA', n: 1 };
  if (eff <= 1) return { kind: 'K', n: 2 };
  if (eff <= 2) return { kind: 'K', n: 1 };
  if (eff <= 3) return { kind: 'MC', n: 2 };
  if (eff <= 4) return { kind: 'MC', n: 1 };
  if (eff <= 5) return { kind: 'NMC' };
  if (eff <= 6) return { kind: 'PTC' };
  return { kind: 'none' };
}

export const TABLES: Tables = {
  iftColumns: FIXTURE_IFT_COLUMNS,
  ift: fixtureIft,
  ccOddsColumns: ['1:6', '1:4', '1:3', '1:2', '1:1', '3:2', '2:1', '3:1', '4:1', '6:1', '8:1', '10:1'],
  ccKill: (odds) => ({ '1:6': 1, '1:4': 2, '1:3': 3, '1:2': 4, '1:1': 5, '3:2': 6, '2:1': 7, '3:1': 8, '4:1': 9, '6:1': 10, '8:1': 11, '10:1': 12 })[odds] ?? 0,
  ccKillHth: (odds) => ({ '1:6': 3, '1:4': 4, '1:3': 5, '1:2': 6, '1:1': 7, '3:2': 8, '2:1': 9, '3:1': 10, '4:1': 11, '6:1': 12, '8:1': 13, '10:1': 14 })[odds] ?? 0,
  leaderCreation: () => null,
  // Fixture To Hit Chart matching the SK4 To Hit Examples: ITT 10(5) 9(4) 8(3) 7(3) 7(3) 6(2) by range
  // band, red one lower; ATT red 7 to 12 hexes, 9 beyond. Columns by caliber (88 → 16, 75 → 12).
  toHit(_def, targetType, range) {
    if (range > 24 || range < 1) return null;
    if (targetType === 'VTT') return { black: range <= 6 ? 10 : range <= 12 ? 9 : range <= 18 ? 8 : 7, ch: 2, red: range <= 6 ? 10 : range <= 12 ? 8 : range <= 18 ? 7 : 6, chRed: 2 };
    if (targetType === 'ATT') return { black: range <= 12 ? 7 : 9, ch: 2, red: range <= 12 ? 7 : 9, chRed: 2 };
    const black = range <= 1 ? 10 : range <= 2 ? 9 : range <= 6 ? 8 : range <= 18 ? 7 : 6;
    const ch = range <= 1 ? 5 : range <= 2 ? 4 : range <= 6 ? 3 : range <= 18 ? 3 : 2;
    return { black, ch, red: black - 1, chRed: Math.max(1, ch - 1) };
  },
  gunColumn(def, targetType) {
    const itt = def.caliber >= 80 ? 16 : def.caliber >= 70 ? 12 : def.caliber >= 50 ? 6 : def.caliber >= 45 ? 4 : 2;
    return targetType === 'ITT' ? itt : targetType === 'ATT' ? itt / 2 : itt * 2;
  },
  // Fixture To Kill: the SK4 To Hit/To Kill example's numbers (76L AP 13 at range 3; HE 70+ = 7; HEAT 75/76 = 13; 88L AP 20).
  toKill(def, ammo, range) {
    if (ammo === 'HEAT') return def.latw?.tk ?? (def.caliber >= 75 ? 13 : 26);
    if (ammo === 'HE') return def.caliber >= 80 ? 8 : def.caliber >= 70 ? 7 : def.caliber >= 50 ? 6 : 4;
    const base = def.caliber >= 88 ? 20 : def.caliber >= 75 ? (def.nationality === 'ru' ? 13 : 17) : 10;
    return (range <= 1 ? base + 1 : base) + (ammo === 'APCR' || ammo === 'APDS' ? 3 : 0);
  },
};

export function scenario(overrides: Partial<ScenarioDef> = {}): ScenarioDef {
  return {
    id: 'test',
    title: 'Test',
    boards: [{ board: 'y', position: '0,0' }],
    turns: 5,
    halfFinalTurn: false,
    month: 7,
    firstSide: 'am',
    sides: [
      { side: 'am', name: 'American', nationality: 'am', elr: 3 },
      { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
    ],
    forces: [],
    victory: [],
    ssr: [],
    ...overrides,
  };
}

export function testMap(terrain: Record<string, HexTerrainSpec> = {}, board = 'y', roadHexsides: [string, string][] = [], pathHexsides: [string, string][] = []) {
  return new HexGridMap({
    boards: [{ board, x: 0, y: 0 }],
    terrain,
    roadHexsides,
    losEffect: (t) => SK4_TERRAIN[t]?.los ?? 'none',
    inherent: (t) => !!SK4_TERRAIN[t]?.inherent,
    ...(pathHexsides.length ? { pathHexsides } : {}),
    height: (t) => SK4_TERRAIN[t]?.height,
  });
}

export interface PieceSpec {
  id: string;
  def: string;
  side: string;
  hex?: string;
  /** A level above ground in `hex` (full ASL Locations, ASLRB A2.8). */
  level?: number;
  heldBy?: string;
  tags?: Piece['tags'];
}

/** Test module: places pieces and answers every phase with a generic decision. */
export function harness(pieces: PieceSpec[], startPhase = 'PFPh', hexMarkers: Record<string, Record<string, unknown>> = {}): RuleModule {
  return {
    id: 'test.harness',
    install(r) {
      r.setup({
        id: 'test.place',
        run(ctx) {
          for (const p of pieces) {
            ctx.emit('piece.created', {
              piece: {
                id: p.id,
                defId: p.def,
                side: p.side,
                loc: p.heldBy ? { kind: 'held', by: p.heldBy } : p.hex ? { kind: 'hex', hex: p.hex, ...(p.level ? { level: p.level } : {}) } : { kind: 'offboard' },
                tags: p.tags ?? {},
              },
            });
          }
          for (const [hex, m] of Object.entries(hexMarkers)) for (const [key, value] of Object.entries(m)) ctx.emit('hex.marker', { hex, key, value });
          ctx.emit('turn.phaseStarted', { phase: startPhase, turn: 1, attacker: ctx.state.attacker });
          if (ctx.state.decisions.length === 0) {
            ctx.pushDecision({ kind: 'phase', owner: ctx.state.attacker, deadlineClass: 'turn', data: { phase: startPhase } });
          }
        },
      });
    },
  };
}

export function makeEngine(opts: {
  pieces: PieceSpec[];
  terrain?: Record<string, HexTerrainSpec>;
  scenario?: Partial<ScenarioDef>;
  dice?: number[];
  extra?: RuleModule[];
  modules?: RuleModule[];
  startPhase?: string;
  board?: string;
  roadHexsides?: [string, string][];
  pathHexsides?: [string, string][];
  /** Override parts of the stub tables (e.g. a Leader Creation table that makes leaders). */
  tables?: Partial<Tables>;
  /** Hex markers in place at the start (e.g. `{ zQ3: { smoke: true } }`). */
  hexMarkers?: Record<string, Record<string, unknown>>;
}) {
  const statics: Statics = {
    map: testMap(opts.terrain, opts.board, opts.roadHexsides, opts.pathHexsides),
    counters: COUNTERS,
    // Every Starter Kit terrain (the PTO's included), so a fixture may lay out jungle or huts.
    terrain: SK4_TERRAIN,
    tables: { ...TABLES, ...opts.tables },
    scenario: scenario(opts.scenario),
  };
  const mods = opts.modules ?? [piecesModule, turnModule, ...sk1CoreModules];
  const engine = new Engine(
    buildRuleset('test', [...mods, ...(opts.extra ?? []), harness(opts.pieces, opts.startPhase, opts.hexMarkers)]),
    statics,
    opts.dice ? { forcedDice: opts.dice } : {},
  );
  const sc = statics.scenario;
  const { state } = engine.createGame({ scenarioId: 'test', sides: sc.sides.map((x) => x.side), attacker: sc.firstSide, seed: 'test' });
  return { engine, state };
}

export function act(engine: Engine, state: GameState, action: Omit<Action, 'decisionId' | 'side'> & { side?: string }) {
  const d = engine.currentDecision(state);
  if (!d) throw new Error('no decision');
  return engine.submit(state, { side: d.owner, decisionId: d.id, ...action } as Action);
}

/** A British (plus Allied Minor) side against the Germans, Germans moving first. */
export const GE_VS_BR: Partial<ScenarioDef> = {
  firstSide: 'ge',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
    { side: 'br', name: 'Allied', nationality: 'br', nationalities: ['br', 'al'], elr: 1 },
  ],
};

export const RU_VS_GE: Partial<ScenarioDef> = {
  firstSide: 'ru',
  sides: [
    { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
  ],
};
