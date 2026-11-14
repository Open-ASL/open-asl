import { describe, expect, it } from 'vitest';
import { needsSk4, sk4Counters, ALL_SCENARIOS, COMMERCIAL_SCENARIOS, COUNTERS, S18_GE_SETUP, S18_RU_SETUP, applyBalance as applyBalanceS20, staticsFor as staticsForS20, SK1_NATIONALITY_CHART, SK2_NATIONALITY_CHART, SK3_COUNTER_IDS, availableBoards, buildMap, needsSk3, newGame, rulesetFor, sk1Counters, sk2Counters, sk3Counters } from '../src';
import { type CounterDef, shotContext, pfCap, pfMaxRange, afvLeadTally, buildAttack, defaultScatterPlan, entryGroupsState, isVisibleTo, losFirepower, areaVp, type AreaVpVc, scatterState, type LosFirepowerVc, type ScatterLanding, controlledHexes as controlledHexesS20, cvpGoal, evaluateVictory as evaluateVictoryS20, forceChartResult, type GunDef, type VehicleDef } from '@asl/rules';
import { DEMO_SCENARIO, newSk1Game } from '../src';
import { DEMO_VEHICLES_SCENARIO } from '../src';
import { SK1_TABLES } from '../src';
import type { Statics } from '@asl/rules';
import { defOf, entryHexesOf, piecesToPlace, placementIllegal, placementHexes, terrainOf } from '@asl/rules';
import { buildingAt, hexrowIndex } from '../src/scenarios/areas';
import { FORTIFIED_DRM, ammoStatus, controlledHexes, fortifiedKnownTo, fortifyIllegal, isCaptured, weatherOf } from '@asl/rules';
import type { GameState } from '@asl/engine';
import { evaluateVictory } from '@asl/rules';
import { boardHexes } from '../src/maps';
import { SK_S19 } from '../src';
import { turnsLabel } from '../src';
import { exitHexes, exitMf, moveState, type FireAttackCtx, type MoveState } from '@asl/rules';
import { FORTIFY_DECISION, fortifiableBuildings, fortifiedParams, fortifiedState } from '@asl/rules';
import { S28_EXITS, S28_INFANTRY_EXITS, S28_RU_SETUP } from '../src';
import { T3 as T3S28, isDugIn } from '@asl/rules';
import { S29_OTHER_BUILDINGS, S29_P1 } from '../src';
import { S30_AM_ENTRY, S30_EXIT, S30_GE_SETUP } from '../src';
import { exitVpMet, vehicleExitVp } from '@asl/rules';
import { S31_BUILDING_HEXES, S31_RAILROAD } from '../src';
import { swHeldBy as swHeldByS31 } from '@asl/rules';
import { S32_GE_SETUP, S32_ROAD, S32_RU_SETUP, S32_VP_BUILDINGS } from '../src';
import { vpTally } from '@asl/rules';
import { S33_BUILDINGS, S33_NL_SETUP } from '../src';
import { S34_AM_SETUP } from '../src';
import { exitVpCondition } from '@asl/rules';
import { S35_VC_HEXES } from '../src';
import { ssrHexAttacks } from '@asl/rules';
import { S36_AREA_45, S36_AREA_55, S36_EDGE_45, S36_GE_SETUP } from '../src';
import { gameTurns, inPlay } from '@asl/rules';
import { LMA10_BUILDINGS, LMA10_GE_SETUP, LMA_10 } from '../src/scenarios/lma/lma10';
import { LMA8_BUILDINGS, LMA8_ENTRY_13E, LMA8_ENTRY_4E, LMA8_GE_SETUP, LMA_8 } from '../src/scenarios/lma/lma8';
import { needsPanzerfaust } from '../src';
import { LMA_6, LMA6_VC_HEXES } from '../src/scenarios/lma/lma6';
import { entryLossesCount, entryOrderDrPending } from '@asl/rules';
import { LMA2_ENTRY_IQ, LMA2_ENTRY_QY, LMA2_SINGLE_HEX_BUILDINGS, LMA2_VC_HEXES } from '../src/scenarios/lma/lma2';
import { entryStretchState, isHidden as isHiddenLma2 } from '@asl/rules';
import { LMA_9, LMA9_CA_SETUP, LMA9_DEPLOYMENT, LMA9_GE_SETUP, LMA9_VC_BUILDINGS } from '../src/scenarios/lma/lma9';
import { artilleryMissions, setupAnchorProgress } from '@asl/rules';
import { LMA_5, LMA5_EASY_SETUP, LMA5_ITEM_ENTRY, LMA5_PANZER_SETUP, LMA5_SPEIRS_ENTRY, LMA5_UW_BUILDINGS, LMA5_VILLAGE } from '../src';
import { mmcLost, vehicleEntryCost } from '@asl/rules';
import { LMA_7, LMA7_HILLS_T, LMA7_HILLS_V, LMA7_HILL_HEXES } from '../src/scenarios/lma/lma7';
import { PREPARED, clearAreasTally, squadEquivalentsLost } from '@asl/rules';
import { FixtureBuilder } from '../src/fixtures';
import { LMA_4, LMA4_BUILDINGS, LMA4_PSW_HEXES, LMA4_TANK_HEXES } from '../src/scenarios/lma/lma4';
import { entryAfterFireState } from '@asl/rules';

describe('VASL counter import', () => {
  it('matches the SK1 Nationality Chart ELR chains', () => {
    const c = sk1Counters();
    for (const [nat, chains] of Object.entries(SK1_NATIONALITY_CHART)) {
      if (nat === 'leaders') continue;
      for (const chain of chains) {
        chain.forEach((id, i) => {
          const d = c[id]!;
          expect(d, id).toBeDefined();
          expect(d.kind === 'squad' || d.kind === 'hs' ? d.elrReplacement : undefined, id).toBe(chain[i + 1]);
        });
      }
    }
  });

  it('reads printed values from the counter art', () => {
    expect(COUNTERS['ge.467']).toMatchObject({ fp: 4, range: 6, morale: 7, smoke: 1, quality: '1', reducesTo: 'ge.247h' });
    expect(COUNTERS['am.747']).toMatchObject({ fp: 7, range: 4, morale: 7, assaultFire: true, elrExempt: true, reducesTo: 'am.337h' });
    expect(COUNTERS['ru.426']).toMatchObject({ quality: 'C', fp: 4, range: 2, morale: 6 });
    expect(COUNTERS['ru.MMG']).toMatchObject({ type: 'MMG', fp: 4, range: 10, pp: 5, rof: 2, b: 11 });
    expect(COUNTERS['ge.HMG']).toMatchObject({ pp: 4 });
    expect(COUNTERS['ge.L92']).toMatchObject({ morale: 9, leadership: -2, selfRally: true });
    expect(COUNTERS['ge.FT']).toMatchObject({ fp: 24, range: 1, x: 10 });
    expect(COUNTERS['ge.DC']).toMatchObject({ fp: 30, x: 12 });
  });
});

describe('SK3 vehicles (VASL import)', () => {
  const v = (id: string) => COUNTERS[id] as VehicleDef;
  it('reads the S21 Russian tanks from their counter art', () => {
    // T-34 M43: 16 MP, AF 11/6, Restricted Slow Turret, 76L with ROF 1, BMG 2 / CMG 4, APCR A4²/5³/6⁴/7⁵.
    expect(v('ru.T34M43')).toMatchObject({
      kind: 'vehicle', name: 'T-34 M43', tracked: true, mp: 16, groundPressure: 'normal', turret: 'RST', targetSize: 'normal',
      af: { hull: { front: 11, side: 6, rear: 6 }, turret: { front: 11, side: 6, rear: 6 } },
      ma: { type: 'AT', caliber: 76, barrel: 'L', rof: 1, ammo: { he: true, ap: true } },
      mg: { bmg: 2, cmg: 4 }, crewMorale: 8, ceDrm: 2,
    });
    expect(v('ru.T34M43').redMp).toBeUndefined();
    expect(v('ru.T34M43').ma!.specialAmmo).toEqual([{ kind: 'APCR', steps: [{ n: 4, from: { year: 1942 } }, { n: 5, from: { year: 1943 } }, { n: 6, from: { year: 1944 } }, { n: 7, from: { year: 1945 } }] }]);
    // T-34 M41: red 17 MP (stalls on 11 per Russian Vehicle Note M), low ground pressure, inferior turret front (11 → 8), no ROF.
    expect(v('ru.T34M41')).toMatchObject({ mp: 17, redMp: true, stallOn11: true, groundPressure: 'low', turret: 'RST', af: { hull: { front: 11, side: 6 }, turret: { front: 8, side: 6 } }, mg: { bmg: 2, cmg: 4 } });
    expect(v('ru.T34M41').ma!.rof).toBeUndefined();
  });
  it('reads the S21 German panzers from their counter art', () => {
    // PzKpfw VIE: 12 MP (red), AF 11/8 with a superior turret front (11 → 14), Slow Turret, 88L ROF 1, 3/5, sD7, large target.
    expect(v('ge.pzvie')).toMatchObject({ mp: 12, redMp: true, turret: 'ST', targetSize: 'large', af: { hull: { front: 11, side: 8, rear: 8 }, turret: { front: 14, side: 8, rear: 8 } }, ma: { caliber: 88, barrel: 'L', rof: 1 }, mg: { bmg: 3, cmg: 5 }, smoke: [{ kind: 'sD', n: 7 }] });
    expect(v('ge.pzvie').stallOn11).toBeUndefined();
    // PzKpfw IVF2: 14 MP, AF 6/3 with a superior turret side (3 → 4), Fast Turret, 75L, s8 and sD6.
    expect(v('ge.pzivf2')).toMatchObject({ mp: 14, turret: 'T', af: { hull: { front: 6, side: 3 }, turret: { front: 6, side: 4 } }, ma: { caliber: 75, barrel: 'L', rof: 1 }, smoke: [{ kind: 'sD', n: 6 }] });
    expect(v('ge.pzivf2').ma!.specialAmmo).toEqual([{ kind: 'SMOKE', steps: [{ n: 8 }] }, { kind: 'APCR', steps: [{ n: 5, from: { year: 1942 } }, { n: 4, from: { year: 1943 } }] }]);
    // PzKpfw IVH: 13 MP, AF 8/3, inferior turret front (8 → 6) and superior turret side (3 → 4).
    expect(v('ge.pzivh')).toMatchObject({ mp: 13, turret: 'T', af: { hull: { front: 8, side: 3 }, turret: { front: 6, side: 4 } } });
  });
  it('generates each vehicle\'s machine guns as fixed SW pieces', () => {
    const c = sk3Counters();
    expect(SK3_COUNTER_IDS).toEqual(expect.arrayContaining(['ru.T34M43', 'ru.T34M41', 'ge.pzvie', 'ge.pzivf2', 'ge.pzivh']));
    expect(c['ru.T34M43.bmg']).toMatchObject({ kind: 'sw', type: 'BMG', fp: 2, range: 8, pp: 0, fixed: true, b: 12, repair: 1, nationality: 'ru' });
    expect(c['ru.T34M43.cmg']).toMatchObject({ type: 'CMG', fp: 4, range: 12 });
    expect(c['ru.T34M43.aamg']).toBeUndefined();
    // SK1/SK2 games know nothing of them.
    expect(sk2Counters()['ru.T34M43']).toBeUndefined();
  });
  it('keeps every existing scenario on its SK1/SK2 ruleset', () => {
    // The free download cards with vehicles (S28) play under the SK3 rules too, as do the armor and jungle demos.
    const withVehicles = ['sk-s28', 'sk-s30', 'sk-s33', 'sk-s34', 'sk-s35', 'sk-s36', 'lma-10', 'lma-8', 'lma-5', 'lma-4', 'demo-armor', 'demo-jungle'];
    const commercial = new Set(COMMERCIAL_SCENARIOS.map((x) => x.id));
    for (const sc of ALL_SCENARIOS.filter((x) => !commercial.has(x.id) && !withVehicles.includes(x.id))) expect(needsSk3(sc), sc.id).toBe(false);
    for (const id of withVehicles) expect(needsSk3(ALL_SCENARIOS.find((x) => x.id === id)!), id).toBe(true);
  });
  it('knows board t', () => {
    expect(availableBoards()).toContain('t');
    const map = buildMap([{ board: 't', x: 0, y: 0 }]);
    expect([...map.hexes()].length).toBe(346);
  });
});

describe('SK4 counters (VASL import + Nationality Chart p.33)', () => {
  it('imports the Japanese with both squad sides, HS, crews and leaders, linked for Step Reduction and ELR', () => {
    const c = sk4Counters();
    for (const id of ['ja.448', 'ja.447', 'ja.347', 'ja.336', 'ja.348r', 'ja.347r', 'ja.237r', 'ja.226r', 'ja.238h', 'ja.237h', 'ja.137h', 'ja.126h', 'ja.228c', 'ja.128cr', 'ja.127c', 'ja.L102', 'ja.L101', 'ja.L100', 'ja.L91', 'ja.L90', 'ja.L80', 'ja.L8p1', 'ja.LMG', 'ja.MMG', 'ja.HMG', 'ja.ATR', 'ja.MTR', 'ja.DC', 'ja.FT']) expect(c[id], id).toBeDefined();
    const sq = (id: string) => c[id] as Extract<CounterDef, { kind: 'squad' | 'hs' | 'crew' }>;
    expect(sq('ja.447')).toMatchObject({ fp: 4, range: 4, morale: 7, quality: '1', smoke: 1, stepTo: 'ja.347r', reducesTo: 'ja.237h', elrReplacement: 'ja.347', noBrokenSide: true });
    expect(sq('ja.347r')).toMatchObject({ fp: 3, range: 4, morale: 7, fullOf: 'ja.447', reducesTo: 'ja.237h', elrReplacement: 'ja.237r', noBrokenSide: true });
    expect(sq('ja.448')).toMatchObject({ quality: 'E', smoke: 2, stepTo: 'ja.348r', elrReplacement: 'ja.447' });
    expect(sq('ja.336')).toMatchObject({ quality: 'C', stepTo: 'ja.226r' });
    expect(sq('ja.336').elrReplacement).toBeUndefined();
    expect(sq('ja.238h')).toMatchObject({ kind: 'hs', morale: 8, elrReplacement: 'ja.237h' });
    expect(sq('ja.238h').noBrokenSide).toBeUndefined();
    expect(sq('ja.228c')).toMatchObject({ kind: 'crew', stepTo: 'ja.128cr' });
    expect(sq('ja.128cr')).toMatchObject({ fp: 1, range: 2, morale: 8, fullOf: 'ja.228c', stepTo: 'ja.127c' });
    const leader = (id: string) => c[id] as Extract<CounterDef, { kind: 'leader' }>;
    expect(leader('ja.L8p1')).toMatchObject({ morale: 8, leadership: 1, noBrokenSide: true });
    expect(leader('ja.L102')).toMatchObject({ morale: 10, leadership: -2, elrReplacement: 'ja.L101' });
    expect(leader('ja.L8p1').elrReplacement).toBeUndefined();
    expect(sq('ja.448').bpv).toBe(16);
    expect(sq('ja.228c').bpv).toBe(10);
  });
  it('makes the U.S. Marine Corps Elite, marks the Raiders, and keeps the early U.S. Army chain', () => {
    const c = sk4Counters();
    const sq = (id: string) => c[id] as Extract<CounterDef, { kind: 'squad' | 'hs' | 'crew' }>;
    expect(sq('am.768')).toMatchObject({ fp: 7, range: 6, morale: 8, quality: 'E', reducesTo: 'am.348h', elrExempt: true, bpv: 17 });
    expect(sq('am.668')).toMatchObject({ quality: 'E', reducesTo: 'am.348h', bpv: 16 });
    expect(sq('am.558r')).toMatchObject({ quality: 'E', raider: true, reducesTo: 'am.238rh', bpv: 14 });
    expect(sq('am.238rh').raider).toBe(true);
    expect(sq('am.558p').raider).toBeUndefined();
    expect(sq('am.458')).toMatchObject({ quality: 'E', reducesTo: 'am.248h' });
    expect(sq('am.447')).toMatchObject({ elrReplacement: 'am.336', reducesTo: 'am.237h' });
    // Nothing of SK1-3 moved: a German 4-6-7 is what it was, and the SK1-3 rulesets keep their hashes.
    expect(sq('ge.467')).toMatchObject({ quality: '1', elrReplacement: 'ge.447' });
    const s7 = ALL_SCENARIOS.find((s) => s.id === 'sk-s7')!;
    expect(needsSk4(s7)).toBe(false);
    expect(rulesetFor(s7).id).toBe('asl-sk1');
    const pto = { ...s7, ssr: [...s7.ssr, { module: 'pto-terrain', params: {}, text: 'PTO Terrain is in effect' }] } as typeof s7;
    expect(needsSk4(pto)).toBe(true);
  });
});

describe('SK4 boards m, n, o (VASL import)', () => {
  it('reads the hexes the SK4 rulebook uses as its PTO examples (8.2.1, 8.1.8.5)', () => {
    for (const b of ['m', 'n', 'o']) {
      expect(availableBoards()).toContain(b);
      expect([...buildMap([{ board: b, x: 0, y: 0 }]).hexes()].length).toBe(346);
    }
    const m = boardHexes('m');
    const n = boardHexes('n');
    const o = boardHexes('o');
    expect(m['mAA2']!.terrain).toBe('woods'); // jungle
    expect(n['nT4']!.terrain).toBe('brush'); // bamboo
    expect(o['oX2']!.terrain).toBe('orchard'); // palm trees
    expect(o['oQ3']!.terrain).toBe('grain'); // kunai
    expect(o['oEE5']!.terrain).toBe('open');
    expect(o['oEE4']!.terrain).toBe('grain');
    expect(o['oDD2']!.terrain).toBe('woods');
    expect(o['oDD4']!.terrain).toBe('orchard');
    // m and o have Level 1 hills; n is flat.
    expect(Object.values(m).some((h) => h.elevation === 1)).toBe(true);
    expect(Object.values(o).some((h) => h.elevation === 1)).toBe(true);
    expect(Object.values(n).some((h) => h.elevation)).toBe(false);
  });
  it('counts separate wooden buildings per hex, for huts (SK4 8.2: ≥ 2 separate buildings, no partial depiction)', () => {
    const o = boardHexes('o');
    for (const h of ['oY5', 'oDD5']) {
      expect(o[h]!.terrain).toBe('building-wood');
      expect(o[h]!.buildings).toBeGreaterThanOrEqual(2);
      expect(o[h]!.partialBuilding).toBeUndefined();
    }
    // Only wooden building hexes carry the fields; a wooden building shared by two hexes is partial in both.
    const all = Object.values(boardHexes('y')).concat(Object.values(boardHexes('z')), Object.values(boardHexes('w')));
    for (const h of all) if (h.terrain !== 'building-wood') expect(h.buildings).toBeUndefined();
    const wood = Object.entries(boardHexes('m')).filter(([, h]) => h.terrain === 'building-wood');
    const shared = wood.filter(([, h]) => h.buildingId && wood.some(([, o2]) => o2 !== h && o2.buildingId === h.buildingId));
    expect(shared.map(([id]) => id)).toEqual(expect.arrayContaining(['mI5', 'mJ5', 'mCC3', 'mDD3'])); // VASL's own "Wooden Building, 1 Level" overrides
    for (const [, h] of shared) expect(h.partialBuilding).toBe(true);
    expect(o['oY8']!.partialBuilding).toBeUndefined();
  });
});

describe('SK2 counters (VASL import)', () => {
  it('reads the Italian & Axis/Allied Minors To Hit chart and imports the Italian Guns and Mortars it covers', () => {
    const t = SK1_TABLES;
    const at47 = COUNTERS['it.AT47'] as GunDef;
    expect(at47).toMatchObject({ kind: 'gun', type: 'AT', caliber: 47 });
    // Black-only cells up to range 6, red-only beyond (Italian Guns always use the red TH#).
    expect(t.toHit(at47, 'ITT', 2)).toMatchObject({ black: 9, ch: 4 });
    expect(t.toHit(at47, 'ITT', 10)).toMatchObject({ black: 6, ch: 2 });
    expect(t.gunColumn(at47, 'ITT')).toBe(4);
    expect(t.gunColumn(COUNTERS['it.AR105'] as GunDef, 'CH')).toBe(36);
    expect(COUNTERS['it.MTR']).toMatchObject({ type: 'MTR', ordnance: { caliber: 45, barrel: '*' } });
    expect(COUNTERS['al.MTR46']).toMatchObject({ type: 'MTR', ordnance: { caliber: 46, barrel: '*' } });
    // The Allied Minor 46*: "7(NA 1)" for 1-12 and NA for 13-24.
    const m46 = { id: 'x', nationality: 'al', kind: 'gun', type: 'MTR', caliber: 46, barrel: '*' } as unknown as GunDef;
    expect(t.toHit(m46, 'ATT', 1)).toBeNull();
    expect(t.toHit(m46, 'ATT', 5)).toMatchObject({ red: 7 });
    expect(t.toHit(m46, 'ATT', 13)).toBeNull();
  });

  it('reads the British 40L AA Gun from its counter art', () => {
    expect(COUNTERS['br.AA40L']).toMatchObject({
      kind: 'gun', type: 'AA', caliber: 40, barrel: 'L', rof: 3, ife: 8, m: 8, mount: '360', qsu: false, gunshield: false, targetSize: 'normal', repair: 1, removeOnRepair6: true,
      // The chart's "AP only" note: no Area Target Type, no Residual FP.
      ammo: { he: false, ap: true },
    });
  });
  it('reads crews as Elite MMC exempt from ELR', () => {
    expect(COUNTERS['br.228c']).toMatchObject({ kind: 'crew', quality: 'E', fp: 2, range: 2, morale: 8, brokenMorale: 8, selfRally: true, elrExempt: true });
    expect(COUNTERS['ge.228c']).toMatchObject({ kind: 'crew', elrExempt: true });
    expect(COUNTERS['al.228c']).toMatchObject({ kind: 'crew' });
  });
  it('reads the British and Allied Minor infantry', () => {
    expect(COUNTERS['br.457']).toMatchObject({ quality: '1', fp: 4, range: 5, morale: 7, reducesTo: 'br.247h' });
    expect(COUNTERS['al.437']).toMatchObject({ quality: 'G', fp: 4, range: 3, morale: 7, reducesTo: 'al.227h' });
    expect(COUNTERS['al.227h']).toMatchObject({ quality: 'G', kind: 'hs' });
    expect(COUNTERS['br.L80']).toMatchObject({ leadership: 0, morale: 8 });
  });
  it('applies the SK2 Nationality Chart on top of SK1', () => {
    const c = sk2Counters();
    for (const [nat, chains] of Object.entries(SK2_NATIONALITY_CHART)) {
      if (nat === 'leaders') continue;
      for (const chain of chains) {
        chain.forEach((id, i) => {
          const d = c[id]!;
          expect(d, id).toBeDefined();
          expect(d.kind === 'squad' || d.kind === 'hs' ? d.elrReplacement : undefined, id).toBe(chain[i + 1]);
        });
      }
    }
    expect(c['br.L102']).toMatchObject({ elrReplacement: 'br.L92' });
    expect(c['al.L61']!.kind === 'leader' && c['al.L61']!.elrReplacement).toBeFalsy();
    expect(c['br.228c']!.kind === 'crew' && 'elrReplacement' in c['br.228c']!).toBe(false);
    expect(c['ge.467']).toEqual(sk1Counters()['ge.467']);
  });
});

describe('board x', () => {
  const map = buildMap([{ board: 'x', x: 0, y: 0 }]);
  it('has the SK2 terrain the card needs: grain, orchards, dirt roads, wooden buildings, no hills', () => {
    const hexes = [...map.hexes()];
    const count = (t: string) => hexes.filter((h) => h.terrain === t).length;
    expect(count('grain')).toBeGreaterThan(50);
    expect(count('orchard')).toBeGreaterThan(0);
    expect(count('building-wood')).toBeGreaterThan(0);
    expect(count('building-stone')).toBeGreaterThan(0);
    expect(hexes.some((h) => h.features.includes('road:dirt'))).toBe(true);
    expect(hexes.every((h) => !h.elevation)).toBe(true);
    // Multi-hex wooden buildings (VASL code 203) are grouped under one building id.
    const wood = hexes.filter((h) => h.terrain === 'building-wood');
    expect(wood.every((h) => !!h.buildingId)).toBe(true);
  });
});

describe('SK2 To Hit Chart (from the ASLSK Combat Charts)', () => {
  const t = SK1_TABLES;
  const gun = COUNTERS['br.AA40L'] as GunDef;
  it('has the British 40L row: AP only, black and red TH#s with Critical Hit numbers', () => {
    expect(t.toHit(gun, 'ITT', 1)).toEqual({ black: 10, ch: 5 });
    expect(t.toHit(gun, 'ITT', 2)).toEqual({ black: 9, ch: 4 });
    expect(t.toHit(gun, 'ITT', 5)).toEqual({ black: 8, ch: 3 });
    expect(t.toHit(gun, 'ITT', 10)).toEqual({ black: 7, ch: 3, red: 6, chRed: 2 });
    expect(t.toHit(gun, 'ITT', 15)).toEqual({ black: 5, ch: 2, red: 4, chRed: 1 });
    expect(t.toHit(gun, 'ITT', 24)).toEqual({ black: 4, ch: 1, red: 3, chRed: 1 });
    expect(t.toHit(gun, 'ITT', 25)).toBeNull();
    expect(t.toHit(gun, 'ATT', 4)).toBeNull();
    expect(t.gunColumn(gun, 'ITT')).toBe(2);
    expect(t.gunColumn(gun, 'ATT')).toBeNull();
    expect(t.gunColumn(gun, 'CH')).toBe(4);
  });
  it('matches the SK4 To Hit Examples for the German 88L and 75L', () => {
    const g88 = { ...gun, id: 'ge.AA88L', nationality: 'ge', caliber: 88, barrel: 'L' } as GunDef;
    expect(t.toHit(g88, 'ITT', 4)).toEqual({ black: 8, ch: 3 });
    expect(t.toHit(g88, 'ITT', 2)).toEqual({ black: 9, ch: 4 });
    expect(t.gunColumn(g88, 'ITT')).toBe(16);
    const g75 = { ...gun, id: 'ge.AT75L', nationality: 'ge', caliber: 75, barrel: 'L' } as GunDef;
    expect(t.toHit(g75, 'ITT', 3)).toEqual({ black: 8, ch: 3 });
    expect(t.toHit(g75, 'ATT', 2)).toEqual({ black: 7, ch: 2, red: 7, chRed: 2 });
    expect(t.gunColumn(g75, 'ITT')).toBe(12);
    // A mortar has no Infantry Target Type and cannot fire inside its minimum range.
    const mtr = { ...gun, id: 'ge.MTR81', nationality: 'ge', caliber: 81, barrel: '*', type: 'MTR' } as GunDef;
    expect(t.toHit(mtr, 'ITT', 3)).toBeNull();
    expect(t.toHit(mtr, 'ATT', 2)).toBeNull();
    expect(t.toHit(mtr, 'ATT', 3)).toEqual({ black: 7, ch: 2, red: 7, chRed: 2 });
  });
});

describe('boards y and z', () => {
  const map = buildMap([{ board: 'y', x: 0, y: 0 }]);

  it('lists the hexes on both sides of a hexside the line runs along, for Smoke (ASLRB A24.2): y N6 to L6 along M6/M7', () => {
    // The pixel LOS lists only terrain hindrances; Smoke counters are found from the line itself.
    expect(map.los('yN6', 'yL6')).toEqual({ clear: true, crossed: [] });
    expect(map.lineSteps('yN6', 'yL6')).toEqual([['yM7', 'yM6']]);
  });

  it('a hex on a road hexside is a road hex even where the road winds off its center (y T7, U7, V7)', () => {
    for (const id of ['yT7', 'yU7', 'yV7', 'yK7']) expect(map.hex(id)!.features).toContain('road:dirt');
    expect(map.roadHexside('yT7', 'yU7')).toBe(true);
  });

  it('on every board, each road hexside joins two road hexes', () => {
    for (const board of availableBoards()) {
      const m = buildMap([{ board, x: 0, y: 0 }], { los: 'grid' });
      for (const h of m.hexes()) {
        for (const n of m.neighbors(h.id)) if (m.roadHexside(h.id, n)) expect(h.features.some((f) => f.startsWith('road:')), `${h.id}`).toBe(true);
      }
    }
  });

  it('derives the terrain named in the SK1 rules', () => {
    const t = (id: string) => map.hex(id)!.terrain;
    expect(t('yFF1')).toBe('open');
    expect(t('yP6')).toBe('building-stone');
    expect(t('yK5')).toBe('orchard');
    expect(t('yU9')).toBe('grain');
    expect(t('yG6')).toBe('woods');
    expect(map.hex('yL5')!.features).toContain('road:dirt');
    expect(map.hex('yE4')!.features).toContain('woods-road');
    const z = buildMap([{ board: 'z', x: 0, y: 0 }]);
    expect(z.hex('zQ4')!.features).toContain('road:paved');
  });

  it('reports a LOS that crosses the woods symbol inside a Woods-Road hex (SK1 1.1.1)', () => {
    // y E4: the road runs B5-D4-E4-F3-G3-H2 through the woods. Down the road the thread stays on it; from
    // the woods on either side it crosses the trees drawn inside E4.
    const woods = (from: string) => !!map.los(from, 'yE4').woods?.includes('yE4');
    for (const h of ['yB5', 'yD4', 'yH2']) expect(woods(h), h).toBe(false);
    for (const h of ['yD3', 'yE5', 'yF4']) expect(woods(h), h).toBe(true);
    // Symmetric: the end hex is named whichever way the thread is traced.
    expect(map.los('yE4', 'yF4').woods).toContain('yE4');
  });

  it('reproduces the SK1 Line of Sight example (pixel LOS)', () => {
    // From yI2: sees yF3 down the road; sees yJ5 with +1 orchard hindrance (J4); not yK4 (building J3).
    const f3 = map.los('yI2', 'yF3');
    expect(f3.clear).toBe(true);
    const j5 = map.los('yI2', 'yJ5');
    expect(j5.clear).toBe(true);
    expect(j5.crossed.map((c) => c.hex)).toEqual(['yJ4']);
    expect(map.los('yI2', 'yK4').clear).toBe(false);
  });

  it('blocks on the building depiction, not the whole building hex', () => {
    // yN4 -> yL2 crosses the NE corner of hex yM4 but skims past its (small) stone building by ~4 px.
    expect(map.hex('yM4')!.terrain).toBe('building-stone');
    expect(map.los('yN4', 'yL2')).toEqual({ clear: true, crossed: [] });
    // Through the building art itself it is blocked (yL3's building, and yM4's from the south).
    expect(map.los('yN4', 'yL3').clear).toBe(false);
    expect(map.los('yM5', 'yM3').clear).toBe(false);
  });

  it('matches the LOS/hindrance implied by the SK1 Prep Fire and Movement examples', () => {
    expect(map.los('yN5', 'yP5').crossed.map((c) => c.hex)).toEqual(['yO5']);
    expect(map.los('yN5', 'yP1')).toEqual({ clear: true, crossed: [] });
    const z = buildMap([{ board: 'z', x: 0, y: 0 }]);
    for (const to of ['zJ3', 'zK3', 'zI5', 'zJ5', 'zK6']) expect(z.los('zK5', to)).toEqual({ clear: true, crossed: [] });
    expect(z.hex('zK6')!.terrain).toBe('orchard'); // FFNAM only (not Open Ground)
    expect(z.hex('zK3')!.terrain).toBe('open'); // FFMO applies
  });
});

describe('demo scenario on real content', () => {
  it('plays random legal actions to the end on board y with pixel LOS', { timeout: 60_000 }, () => {
    let seedState = 12345;
    const rand = () => ((seedState = (seedState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let g = 0; g < 3; g++) {
      const { engine, state: s0 } = newSk1Game(DEMO_SCENARIO, `demo-${g}`);
      let state = s0;
      for (let i = 0; i < 3000 && !state.result; i++) {
        const d = engine.currentDecision(state)!;
        const legal = engine.legalActions(state, d.owner);
        expect(legal.length, `${d.kind} in ${state.phase}`).toBeGreaterThan(0);
        const doing = legal.filter((a) => a.type !== 'endPhase' && a.type !== 'defPass');
        const pool = doing.length && rand() < 0.7 ? doing : legal;
        state = engine.submit(state, pool[Math.floor(rand() * pool.length)]!).state;
      }
      expect(state.result).not.toBeNull();
    }
  });
});

describe('LOS Hindrance per range (ASLRB A6.7)', () => {
  it('a LOS along the shared hexside of two grain hexes at the same range counts one +1, not two (tester report, board y)', () => {
    const { engine, state } = newSk1Game({ ...DEMO_SCENARIO, month: 7 }, 'hindrance');
    const env = engine.env(state);
    const trace = (from: string, to: string) => env.query('los.trace', { from, to }, { clear: true, hindrance: 0, parts: [] });
    // Q6 → O9 runs along the P8/O8 hexside, both 3 hexes from Q6, with the grain field on both sides; O9's own grain never counts.
    for (const [a, b] of [['yQ6', 'yO9'], ['yO9', 'yQ6']] as const) {
      const r = trace(a, b);
      expect(r.clear).toBe(true);
      expect(r.hindrance, `${a}→${b}`).toBe(1);
      expect(r.parts).toHaveLength(1);
      expect(['yP8', 'yO8']).toContain(r.parts[0]!.hex);
    }
  });
});

describe('demo armor scenario', () => {
  it('opens in the Rally Phase with every AFV in its fixed hex, facing the enemy', () => {
    const { engine, state } = newSk1Game(DEMO_VEHICLES_SCENARIO, 'demo-armor');
    expect(state.phase).toBe('RPh');
    const afv = Object.values(state.pieces).filter((p) => COUNTERS[p.defId]?.kind === 'vehicle');
    expect(afv).toHaveLength(11);
    for (const p of afv) {
      expect(p.loc.kind).toBe('hex');
      expect(p.tags['vca'], p.id).toBe(p.side === 'am' ? 1 : 4);
      // The M5A1 by the scenario; the PSW 234/1 because it is Open-Topped (SK4 7.13: CE unless BU, Shocked or Stunned).
      expect(p.tags['ce'] === true, p.id).toBe(p.defId === 'am.M5A1' || p.defId === 'ge.psw2341');
    }
    // The NT StuG's gun points where its hull does.
    expect(afv.find((p) => p.defId === 'ge.stgiiig')!.tags['ca']).toBe(4);
    expect(engine.currentDecision(state)!.owner).toBe('am');
  });
});

describe('SK1 charts (from the VASL chart images)', () => {
  const t = SK1_TABLES;
  it('reproduces every IFT result quoted in the rulebook examples', () => {
    expect(t.ift(16, 10)).toEqual({ kind: 'NMC' }); // Prep Fire: 10 on the 16 column
    expect(t.ift(2, 4)).toEqual({ kind: 'MC', n: 1 }); // 4 on the 2 column → 1MC
    expect(t.ift(4, 4)).toEqual({ kind: 'MC', n: 1 }); // Inexperienced cower to the 4 column → 1MC
    expect(t.ift(8, 9)).toEqual({ kind: 'PTC' }); // FPF: 9 on the 8 column → PTC
  });
  it('has the IFT corners and blanks', () => {
    expect(t.ift(1, -3)).toEqual({ kind: 'KIA', n: 1 });
    expect(t.ift(1, 6)).toEqual({ kind: 'none' });
    expect(t.ift(36, 7)).toEqual({ kind: 'K', n: 4 });
    expect(t.ift(36, 15)).toEqual({ kind: 'PTC' });
    expect(t.ift(36, 16)).toEqual({ kind: 'none' });
    expect(t.ift(30, 0)).toEqual({ kind: 'KIA', n: 6 });
  });
  it('has the CCT kill numbers', () => {
    expect(['1:2', '1:1', '3:2', '2:1'].map(t.ccKill)).toEqual([4, 5, 6, 7]);
    expect(t.ccKill('<1:8')).toBe(0);
    expect(t.ccKill('1:8')).toBe(1);
    expect(t.ccKill('>10:1')).toBe(13);
  });
  it('reproduces the Field Promotion example (Russian 4-5-8, dr 1 → 8-0)', () => {
    expect(t.leaderCreation('ru', 8, 1)).toBe('ru.L80');
    expect(t.leaderCreation('ge', 7, 1)).toBe('ge.L81');
    expect(t.leaderCreation('ge', 7, 6)).toBe('ge.L70');
    expect(t.leaderCreation('am', 7, 6, true)).toBe('am.L61');
    expect(t.leaderCreation('ru', 7, 6)).toBeNull();
  });
  it('reproduces the SK4 CC example (Russian 4-4-7 at 1:2, dr 2 → net 0 drm → 8-0)', () => {
    expect(t.leaderCreation('ru', 7, 2, false, 1)).toBe('ru.L80');
    // Two columns below 1:1 (1:3) is one better.
    expect(t.leaderCreation('ru', 7, 2, false, 2)).toBe('ru.L81');
  });
});

describe('board terrain is read from the whole hex, not its centre pixel', () => {
  it('a building that misses the centre dot still makes a building hex (ASLRB B23.1)', () => {
    // y I6: three small buildings round an open centre (the tester's rout J3-I4-I5-I6 was cut short in I5).
    expect(boardHexes('y')['yI6']).toMatchObject({ terrain: 'building-stone', buildingId: 'y-B39' });
    for (const h of ['zV2', 'zX2', 'zX3', 'zZ1', 'zAA8', 'zAA9', 'zBB9', 'zCC2', 'zCC9', 'zFF3']) {
      expect(boardHexes('z')[h]?.buildingId, h).toBeTruthy();
    }
    // Crossing a hexside joins the next hex's building; AA9, BB9 and CC9 are one building of their own.
    expect(boardHexes('z')['zV2']!.buildingId).toBe(boardHexes('z')['zW3']!.buildingId);
    expect(new Set(['zAA9', 'zBB9', 'zCC9'].map((h) => boardHexes('z')[h]!.buildingId)).size).toBe(1);
    // Ids already in recordings (fortified buildings, Control) did not move.
    expect(buildingAt('w', 'wP9')).toBe('w-B25');
    expect(boardHexes('y')['yI5']!.buildingId).toBe('y-B7');
  });

  it('a hex mostly covered by a depiction is that terrain, dithered grain included (ASLRB B.1)', () => {
    // t G4 is solid grain whose centre pixel falls on a stalk line, coded open in the VASL raster.
    expect(boardHexes('t')['tG4']!.terrain).toBe('grain');
    expect(boardHexes('z')['zH1']!.terrain).toBe('woods');
    // Woods-Road still wins over the woods around it.
    expect(boardHexes('y')['yG3']).toEqual({ terrain: 'woods', features: ['road:dirt', 'woods-road'] });
  });
});

describe('grain depictions', () => {
  const trace = (sc: typeof DEMO_SCENARIO, from: string, to: string, los: 'pixel' | 'grid') => {
    const { engine, state } = newSk1Game(sc, 'x', { los });
    return engine.env(state).query('los.trace', { from, to }, { clear: true, hindrance: 0, parts: [] });
  };

  it('hinder LOS in the hex they are drawn in, read from the whole hex rather than its centre pixel', () => {
    // Board y: the grain field at M9 covers two thirds of N8, whose centre pixel reads open ground in the
    // dithered VASL raster; the import judges the whole hex (ASLRB B.1), so N8 is grain. A shot from M9
    // to the stone building in P6 crosses that grain (SK1 1.1.1: "in which the LOS crosses the grain depiction").
    expect(boardHexes('y')['yN8']!.terrain).toBe('grain');
    const tr = trace(DEMO_SCENARIO, 'yM9', 'yP6', 'pixel');
    expect(tr.clear).toBe(true);
    expect(tr.hindrance).toBe(1);
    expect(tr.parts).toEqual([{ label: '+1 Grain hindrance', hex: 'yN8', drm: 1, terrain: 'grain' }]);
    // The firer's own grain hex never counts.
    expect(tr.parts.some((x) => x.hex === 'yM9')).toBe(false);
  });

  it('do not apply to orchard, which is Inherent Terrain judged by the hex (N3 to P6)', () => {
    // Board y: the trees of the O5 orchard are drawn well into N4 and O4, whose centres are open
    // ground. An orchard hex "including hexsides" hinders as a whole (SK1 glossary, Inherent
    // Terrain), so only the hex the thread enters counts: +1 for O5, not +3 (tester report).
    const tr = trace(DEMO_SCENARIO, 'yN3', 'yP6', 'pixel');
    expect(tr.clear).toBe(true);
    expect(tr.parts).toEqual([{ label: '+1 Orchard hindrance', hex: 'yO5', drm: 1, terrain: 'orchard' }]);
    expect(trace(DEMO_SCENARIO, 'yP6', 'yN3', 'pixel').hindrance).toBe(1);
  });

  it('are no hindrance where an SSR plays grain as flooded (S19)', () => {
    expect(trace(SK_S19, 'yM9', 'yP6', 'pixel').hindrance).toBe(0);
    expect(trace(DEMO_SCENARIO, 'yM8', 'yM10', 'pixel').hindrance).toBe(1);
    expect(trace(SK_S19, 'yM8', 'yM10', 'pixel').hindrance).toBe(0);
  });
});

describe('S19 Purple Heart Lane balance', () => {
  it('gives the U.S. reinforcements a BAZ 44, and with it the SK2 rules', () => {
    expect(rulesetFor(SK_S19).id).toBe('asl-sk1');
    const sc = applyBalanceS20(SK_S19, ['am']);
    expect(sc.forces.find((f) => f.id === 'am-t1')!.units).toContainEqual({ def: 'am.747', count: 1, withSw: ['am.BAZ44'] });
    expect(rulesetFor(sc).id).toBe('asl-sk2');
    const { engine, state } = newGame(sc, 's19-baz');
    expect(engine).toBeTruthy();
    expect(state).toBeTruthy();
  });
});

describe('board w hills (SK4 Height Advantage and Hill LOS Example)', () => {
  it('imports the level-1 hexes of the example and judges the LOS across its Crest Lines by pixel elevation', () => {
    const w = buildMap([{ board: 'w', x: 0, y: 0 }]);
    expect(w.hex('wE9')!.elevation).toBeUndefined();
    expect(w.hex('wH7')!.elevation).toBeUndefined();
    expect(w.hex('wI7')!.elevation).toBe(1);
    expect(w.hex('wI6')!.elevation).toBe(1);
    expect(w.hex('wG7')).toMatchObject({ terrain: 'building-stone', elevation: 1 });
    // The 4-6-7 in E9 sees the 6-6-6 in I7: the grain by F8 lies below (the rules ignore it between levels).
    expect(w.los('wE9', 'wI7').clear).toBe(true);
    expect(w.los('wE9', 'wI7').crossed.some((c) => c.terrain === 'grain')).toBe(true);
    // It has no LOS to I6, whose LOS cannot leave through a Crest Line (I7's hill mass is in the way).
    expect(w.los('wE9', 'wI6')).toMatchObject({ clear: false, crest: true });
    expect(w.los('wI6', 'wE9').clear).toBe(false);
    // The orchard example: X3 is on the hill, W3 and V3 at ground level with the W3 orchard between.
    expect(w.hex('wX3')!.elevation).toBe(1);
    expect(w.hex('wW3')).toMatchObject({ terrain: 'orchard' });
    expect(w.los('wX3', 'wV3').crossed.map((c) => c.hex)).toContain('wW3');
  });
});

describe('S17 A Ridge Too Far', () => {
  const S17 = ALL_SCENARIOS.find((s) => s.id === 'sk-s17')!;
  const game = (sc = S17) => newGame(sc, 's17', { los: 'grid' });
  const force = (sc: typeof S17, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof S17, id: string) => force(sc, id).units.reduce((n, u) => n + u.count, 0);

  it('is playable on boards w (turned 180°) and x, hexrows A-P of each meeting at hexrow A; Germans set up first, British move first, 6 turns', () => {
    expect(S17).toMatchObject({ product: 'sk-dl', turns: 6, halfFinalTurn: false, firstSide: 'br', month: 6 });
    expect(S17.status).toBeUndefined();
    expect(rulesetFor(S17).id).toBe('asl-sk2');
    expect(S17.sides).toEqual([
      { side: 'ge', name: 'German', nationality: 'ge', elr: 2, setupFirst: true },
      { side: 'br', name: 'British', nationality: 'br', elr: 5 },
    ]);
    const map = staticsForS20(S17, { los: 'grid' }).map;
    // The A half hexes are shared: board w's A5 is board x's A6 (w is upside down).
    expect(map.hex('wA5')!.id).toBe('xA6');
    expect(map.neighbors('xA5')).toEqual(expect.arrayContaining(['wB5', 'wB6']));
    expect(map.hex('xQ5')).toBeUndefined();
    expect(map.hex('wQ5')).toBeUndefined();
    expect(map.edge('W')).toEqual(expect.arrayContaining(['wP1', 'wP10']));
    expect(map.edge('E')).toEqual(expect.arrayContaining(['xP1', 'xP10']));
  });

  it('fields the card’s order of battle, the 3-in. mortar with its 1944 range of 3-63', () => {
    expect(count(S17, 'ge')).toBe(15);
    const geSw = force(S17, 'ge').units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat());
    expect(geSw.sort()).toEqual(['ge.LMG', 'ge.LMG', 'ge.LMG', 'ge.MMG']);
    expect(count(S17, 'br')).toBe(12);
    const brSw = force(S17, 'br').units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat());
    expect(brSw.sort()).toEqual(['br.LMG', 'br.LMG', 'br.LMG', 'br.LMG', 'br.MMG', 'br.MTR', 'br.MTR76']);
    expect(sk2Counters()['br.MTR76']).toMatchObject({ kind: 'gun', caliber: 76, minRange: 3, maxRange: 63, m: 11 });
  });

  it('Germans set up on x B-P, one MMC per hex and none adjacent to another; British on w B-P', () => {
    const ge = force(S17, 'ge').setup as { hexes: string[] };
    expect(ge.hexes).toEqual(expect.arrayContaining(['xB1', 'xP10']));
    expect(ge.hexes.some((h) => h.startsWith('xA') || h.startsWith('w'))).toBe(false);
    const br = force(S17, 'br').setup as { hexes: string[] };
    expect(br.hexes).toEqual(expect.arrayContaining(['wB1', 'wP10']));
    expect(br.hexes.some((h) => h.startsWith('wA') || h.startsWith('x'))).toBe(false);
    const { engine, state } = game();
    const d = engine.currentDecision(state)!;
    expect(d).toMatchObject({ kind: 'setup', owner: 'ge' });
    const env = engine.env(state);
    const todo = piecesToPlace(env, d);
    const a = todo.find((p) => p.defId === 'ge.467')!.id;
    const b = todo.find((p) => p.defId === 'ge.447')!.id;
    const leader = todo.find((p) => p.defId === 'ge.L81')!.id;
    expect(placementIllegal(env, 'ge', todo, { [a]: 'xF5', [b]: 'xF6' }, true)).toMatch(/at least 2 hexes apart/);
    expect(placementIllegal(env, 'ge', todo, { [a]: 'xF5', [b]: 'xF5' }, true)).not.toBeNull();
    expect(placementIllegal(env, 'ge', todo, { [a]: 'xF5', [b]: 'xF7', [leader]: 'xF5' }, true)).toBeNull();
    const [auto] = engine.legalActions(state, 'ge') as unknown as [{ placements: Record<string, string> }];
    expect(placementIllegal(env, 'ge', todo, auto.placements)).toBeNull();
  });

  it('VC: ≥ 9 VP of Good Order British infantry on/east-of xK; squad and crew 2, HS 1, a 9-2 leader 3; balance raises it to 11', () => {
    const { engine, state } = game();
    const ids = (def: string) => Object.values(state.pieces).filter((p) => p.defId === def).map((p) => p.id);
    const place = (where: Record<string, string>, tags: Record<string, Record<string, boolean>> = {}) => ({
      ...state,
      pieces: Object.fromEntries(
        Object.entries(state.pieces).map(([id, p]) => [id, where[id] ? { ...p, loc: { kind: 'hex' as const, hex: where[id]! }, tags: { ...p.tags, ...tags[id] } } : p]),
      ),
    });
    const [s1, s2, s3] = ids('br.648');
    const [crew] = ids('br.228c');
    const [l92] = ids('br.L92');
    const vc = S17.victory[0]!;
    expect(vc).toMatchObject({ kind: 'goodOrderVp', side: 'br', vp: 9 });
    // 2 + 2 + 2 (crew) + 3 (9-2) = 9 on/east-of K.
    const win = place({ [s1!]: 'xK5', [s2!]: 'xP1', [crew!]: 'xM3', [l92!]: 'xL2', [s3!]: 'xJ5' });
    expect(areaVp(engine.env(win), vc as AreaVpVc).total).toBe(9);
    expect(evaluateVictoryS20(engine.env(win))).toBe('br');
    // A broken squad does not count; one west of K neither.
    const broken = place({ [s1!]: 'xK5', [s2!]: 'xP1', [crew!]: 'xM3', [l92!]: 'xL2' }, { [s1!]: { broken: true } });
    expect(areaVp(engine.env(broken), vc as AreaVpVc).total).toBe(7);
    expect(evaluateVictoryS20(engine.env(broken))).toBe('ge');
    const hard = applyBalanceS20(S17, ['ge']);
    expect(hard.victory[0]).toMatchObject({ vp: 11 });
    const more = applyBalanceS20(S17, ['br']);
    expect(force(more, 'br').units.find((u) => u.def === 'br.248h')).toMatchObject({ count: 2 });
  });

  it('SSR 1: woods are non-inherent orchards, only the woods art hinders; SSR 2: British squads Assault Fire, Elite MMC do not cower', () => {
    const map = staticsForS20(S17).map;
    expect(map.hex('xG4')).toMatchObject({ terrain: 'orchard' });
    expect(map.hex('xG4')!.features).toContain('non-inherent');
    // Through the old woods mass in hexrow G: no longer blocked, a hindrance per hex.
    const r = map.los('xG1', 'xG7');
    expect(r.clear).toBe(true);
    expect(r.crossed.map((c) => c.hex)).toEqual(['xG2', 'xG3', 'xG4', 'xG5', 'xG6']);
    // Along the hexside of B7 the thread misses its woods art: no hindrance there.
    expect(map.lineSteps!('xA8', 'xC8').flat()).toContain('xB7');
    expect(map.los('xA8', 'xC8').crossed.map((c) => c.hex)).not.toContain('xB7');
    const { engine, state } = game();
    const env = engine.env(state);
    const unit = (def: string) => Object.values(state.pieces).find((p) => p.defId === def)!;
    expect(env.query('unit.assaultFire', { unit: unit('br.648').id }, false)).toBe(true);
    expect(env.query('unit.assaultFire', { unit: unit('br.458').id }, false)).toBe(true);
    expect(env.query('unit.assaultFire', { unit: unit('ge.467').id }, false)).toBe(false);
    const attack = (firer: string) => ({ mode: 'prep' as const, side: 'br', target: 'xC5', parts: [{ piece: firer, firer, kind: 'inherent' as const, hex: 'xB5', range: 4, dist: 1 }], targets: [], hindrance: 0 });
    expect(env.query('fire.cowerShift', { attack: attack(unit('br.458').id) }, 1)).toBe(0);
    expect(env.query('fire.cowerShift', { attack: attack(unit('ge.447').id) }, 1)).toBeGreaterThan(0);
    // SSR 2 is one card rule: the briefing lists two.
    expect(S17.ssr.filter((r) => !r.part)).toHaveLength(2);
  });
});

describe('S18 Baking Bread', () => {
  const S18 = ALL_SCENARIOS.find((s) => s.id === 'sk-s18')!;
  const game = (sc = S18) => newGame(sc, 's18', { los: 'grid' });
  const force = (sc: typeof S18, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof S18, id: string) => force(sc, id).units.reduce((n, u) => n + u.count, 0);
  const sws = (sc: typeof S18, id: string) => force(sc, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();

  it('is playable on board z cut to hexrows L-X; Russians set up first, Germans move first, 6 turns', () => {
    expect(S18).toMatchObject({ product: 'sk-dl', turns: 6, halfFinalTurn: false, firstSide: 'ge', month: 10 });
    expect(S18.status).toBeUndefined();
    expect(rulesetFor(S18).id).toBe('asl-sk2');
    expect(S18.sides).toEqual([
      { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3, setupFirst: true },
      { side: 'ge', name: 'German', nationality: 'ge', elr: 4 },
    ]);
    const map = staticsForS20(S18, { los: 'grid' }).map;
    expect(map.hex('zK5')).toBeUndefined();
    expect(map.hex('zY5')).toBeUndefined();
    expect(map.edge('W')).toEqual(expect.arrayContaining(['zL1', 'zL9']));
    expect(map.edge('E')).toEqual(expect.arrayContaining(['zX1', 'zX9']));
  });

  it('fields the card’s order of battle', () => {
    expect(count(S18, 'ru')).toBe(10);
    expect(sws(S18, 'ru')).toEqual(['ru.LMG', 'ru.LMG', 'ru.MMG']);
    expect(force(S18, 'ru-at').units).toEqual([{ def: 'ru.228c', count: 1, withSw: ['ru.AT45L'] }]);
    expect(count(S18, 'ru-adhoc')).toBe(5);
    expect(sws(S18, 'ru-adhoc')).toEqual(['ru.LMG']);
    expect(count(S18, 'ge-krad')).toBe(4);
    expect(sws(S18, 'ge-krad')).toEqual(['ge.DC', 'ge.LMG']);
    expect(count(S18, 'ge-103')).toBe(9);
    expect(sws(S18, 'ge-103')).toEqual(['ge.HMG', 'ge.LMG', 'ge.LMG']);
    expect(count(S18, 'ge-pz14')).toBe(4);
    expect(sws(S18, 'ge-pz14')).toEqual(['ge.LMG']);
  });

  it('setup: Russians within 4 of S5, one MMC per hex but the crew may stack; Germans in building/rubble within 2 of N1 on/west-of O', () => {
    expect(S18_RU_SETUP).toEqual(expect.arrayContaining(['zS5', 'zO5', 'zW5', 'zS1', 'zS9']));
    expect(S18_RU_SETUP).not.toContain('zN5');
    expect(S18_GE_SETUP.sort()).toEqual(['zL0', 'zL1', 'zL2', 'zM1', 'zM2', 'zN0', 'zN1', 'zN3']);
    expect(force(S18, 'ge-pz14').setup).toMatchObject({ kind: 'enter', turn: 2, edge: 'W', hexes: ['zL5', 'zL6', 'zL7', 'zL8', 'zL9'] });
    expect(force(S18, 'ru-adhoc').setup).toMatchObject({ kind: 'enter', turn: 3, edge: 'E' });
    const { engine, state } = game();
    const d = engine.currentDecision(state)!;
    expect(d).toMatchObject({ kind: 'setup', owner: 'ru' });
    const env = engine.env(state);
    const todo = piecesToPlace(env, d);
    const [a, b] = todo.filter((p) => p.defId === 'ru.447').map((p) => p.id);
    const crew = todo.find((p) => p.defId === 'ru.228c')!.id;
    expect(placementIllegal(env, 'ru', todo, { [a!]: 'zS5', [b!]: 'zS5' }, true)).toMatch(/No more than 1 MMC/);
    expect(placementIllegal(env, 'ru', todo, { [a!]: 'zS5', [crew]: 'zS5' }, true)).toBeNull();
    const [auto] = engine.legalActions(state, 'ru') as unknown as [{ placements: Record<string, string> }];
    expect(placementIllegal(env, 'ru', todo, auto.placements)).toBeNull();
  });

  it('VC: the Germans control buildings P2 and P3 at game end; balance', () => {
    expect(S18.victory).toEqual([{ kind: 'controlBuildings', side: 'ge', buildings: ['z-B39', 'z-B40'], atLeast: 2 }]);
    const ru = applyBalanceS20(S18, ['ru']);
    expect(force(ru, 'ru-adhoc').setup).toMatchObject({ turn: 2 });
    const ge = applyBalanceS20(S18, ['ge']);
    expect(count(ge, 'ge-krad')).toBe(5);
    expect(sws(ge, 'ge-krad')).toEqual(['ge.DC', 'ge.LMG', 'ge.LMG']);
  });

  it('SSR 1: woods and orchards are stone rubble: 3 MF, +3 TEM, an Inherent obstacle along its hexsides too, no road, Ambush terrain', () => {
    for (const los of ['grid', 'pixel'] as const) {
      const map = staticsForS20(S18, { los }).map;
      expect(map.hex('zL1')!.terrain).toBe('rubble-stone');
      expect(map.hex('zO10')!.terrain).toBe('rubble-stone');
      // The thread from O9 to P10 runs along the O10/P9 hexside: open ground on the card's board, blocked by the rubble.
      expect(map.los('zO9', 'zP10').clear).toBe(false);
      expect(staticsForS20({ ...S18, ssr: [] }, { los }).map.los('zO9', 'zP10').clear).toBe(true);
    }
    const map = staticsForS20(S18, { los: 'grid' }).map;
    // The paved road through the W9 woods is no road any more.
    expect(map.hex('zW9')!.features).toEqual([]);
    expect(map.roadHexside?.('zW9', 'zV9') || map.roadHexside?.('zW9', 'zX9') || map.roadHexside?.('zW9', 'zW8') || map.roadHexside?.('zW9', 'zW10')).toBeFalsy();
    const { engine, state } = game();
    const env = engine.env(state);
    expect(terrainOf(env, 'zL1')).toMatchObject({ name: 'Stone Rubble', mf: 3, tem: 3, ambush: true });
    expect(terrainOf(env, 'zL1').routShelter).toBeFalsy();
    expect(env.query('hex.tem', { hex: 'zL1' }, 0)).toBe(3);
  });

  it('SSR 2: Russian Elite and 1st Line MMC take -1 on their Ambush dr, Conscripts and the Germans not; SSR 3: the 6+1 is a Commissar', () => {
    const { engine, state } = game();
    const env = engine.env(state);
    const unit = (def: string) => Object.values(state.pieces).find((p) => p.defId === def)!.id;
    expect(env.query('cc.ambushDrm', { hex: 'zS5', side: 'ru', units: [unit('ru.447')] }, 0)).toBe(-1);
    expect(env.query('cc.ambushDrm', { hex: 'zS5', side: 'ru', units: [unit('ru.228c')] }, 0)).toBe(-1);
    // Conscripts keep their own +1 (SK4 3.8) and take no SSR drm; with an Elite squad beside them the side does.
    expect(env.query('cc.ambushDrm', { hex: 'zS5', side: 'ru', units: [unit('ru.426')] }, 0)).toBe(1);
    expect(env.query('cc.ambushDrm', { hex: 'zS5', side: 'ru', units: [unit('ru.426'), unit('ru.458')] }, 0)).toBe(0);
    expect(env.query('cc.ambushDrm', { hex: 'zS5', side: 'ge', units: [unit('ge.548')] }, 0)).toBe(0);
    expect(env.query('unit.morale', { unit: unit('ru.L61') }, 0)).toBe(10);
    expect(env.query('unit.leadership', { unit: unit('ru.L61') }, 1)).toBe(0);
  });
});

describe('S28 Out of Luck', () => {
  const S28 = ALL_SCENARIOS.find((s) => s.id === 'sk-s28')!;
  const game = (sc = S28) => newGame(sc, 's28', { los: 'grid' });
  const force = (sc: typeof S28, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof S28, id: string, def?: string) => force(sc, id).units.filter((u) => !def || u.def === def).reduce((n, u) => n + u.count, 0);
  const sws = (sc: typeof S28, id: string) => force(sc, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();
  const unit = (state: { pieces: Record<string, { id: string; defId: string }> }, def: string) => Object.values(state.pieces).find((p) => p.defId === def)!.id;

  it('is playable on board v above board u; Russians set up first, Germans move first, 6½ turns', () => {
    expect(S28).toMatchObject({ product: 'sk-dl', turns: 7, halfFinalTurn: true, firstSide: 'ge', month: 4 });
    expect(S28.status).toBeUndefined();
    expect(rulesetFor(S28).id).toBe('asl-sk3');
    expect(S28.sides).toEqual([
      { side: 'ru', name: 'Russian', nationality: 'ru', elr: 4, setupFirst: true },
      { side: 'ge', name: 'German', nationality: 'ge', elr: 2 },
    ]);
    const map = staticsForS20(S28, { los: 'grid' }).map;
    expect(map.hex('uX0')?.id).toBe('vX10');
    expect(map.edge('N')).toEqual(expect.arrayContaining(['vA1', 'vGG1']));
    expect(map.edge('S')).toEqual(expect.arrayContaining(S28_EXITS));
  });

  it('fields the card’s order of battle', () => {
    expect(count(S28, 'ru', 'ru.628')).toBe(4);
    expect(count(S28, 'ru', 'ru.458')).toBe(7);
    expect(count(S28, 'ru', 'ru.IS2')).toBe(3);
    expect(count(S28, 'ru')).toBe(4 + 7 + 1 + 2 + 3);
    expect(sws(S28, 'ru')).toEqual(['ru.AR122L', 'ru.ATR', 'ru.LMG', 'ru.LMG', 'ru.LMG', 'ru.LMG', 'ru.MMG', 'ru.MMG']);
    expect(count(S28, 'ge', 'ge.468')).toBe(2);
    expect(count(S28, 'ge', 'ge.467')).toBe(10);
    expect(count(S28, 'ge', 'ge.447')).toBe(6);
    expect(count(S28, 'ge', 'ge.pzvg')).toBe(4);
    expect(count(S28, 'ge', 'ge.jgpz38')).toBe(3);
    expect(count(S28, 'ge')).toBe(2 + 10 + 6 + 4 + 4 + 3);
    expect(sws(S28, 'ge')).toEqual(['ge.LMG', 'ge.LMG', 'ge.LMG', 'ge.LMG', 'ge.MMG', 'ge.MMG', 'ge.PSK', 'ge.PSK']);
    expect(COUNTERS['ge.jgpz38']).toMatchObject({ kind: 'vehicle', mp: 13, turret: 'NT', targetSize: 'small', af: { hull: { front: 14, side: 3 } }, mg: { aamg: 1 } });
  });

  it('setup: the Russians on board v in hexes numbered ≥ 6 and on board u; the Germans enter on Turn 1 from the north', () => {
    expect(S28_RU_SETUP).toEqual(expect.arrayContaining(['vA6', 'vGG10', 'uA1', 'uI10']));
    expect(S28_RU_SETUP).not.toContain('vM5');
    expect(force(S28, 'ge').setup).toMatchObject({ kind: 'enter', turn: 1, edge: 'N' });
    const { engine, state } = game();
    const d = engine.currentDecision(state)!;
    expect(d).toMatchObject({ kind: 'setup', owner: 'ru' });
    const env = engine.env(state);
    const todo = piecesToPlace(env, d);
    const [auto] = engine.legalActions(state, 'ru') as unknown as [{ placements: Record<string, string>; vehicles: Record<string, { vca: number; dugIn?: boolean }> }];
    expect(placementIllegal(env, 'ru', todo, auto.placements)).toBeNull();
    // SSR 3: an IS-2 may be dug in at setup.
    const is2 = todo.find((p) => p.defId === 'ru.IS2')!.id;
    const dug = { ...auto, vehicles: { ...auto.vehicles, [is2]: { ...auto.vehicles[is2]!, dugIn: true } } };
    const r = engine.submit(state, { ...dug, side: 'ru', decisionId: d.id } as never);
    expect(r.state.pieces[is2]!.tags[T3S28.dugIn]).toBe(true);
    expect(isDugIn(engine.env(r.state), is2)).toBe(true);
    // Without the SSR no vehicle digs in.
    const plain = game({ ...S28, ssr: S28.ssr.filter((s) => s.module !== 'dig-in') });
    const pd = plain.engine.currentDecision(plain.state)!;
    expect(plain.engine.validate(plain.state, { ...dug, side: 'ru', decisionId: pd.id } as never)).toMatch(/No special rule lets this vehicle dig in/);
  });

  it('VC: exit ≥ 33 VP off uI10/uQ10 (Infantry also off the hexes beside them); PzVG 8, JgPz 38(t) 7, leaders by leadership', () => {
    expect(S28.victory).toEqual([{ kind: 'exitVp', side: 'ge', edge: 'S', hexes: ['uI10', 'uQ10'], vp: 33, immediate: true, vehicleVp: { 'ge.pzvg': 8, 'ge.jgpz38': 7 } }]);
    expect(S28_INFANTRY_EXITS).toEqual(['uH10', 'uJ10', 'uP10', 'uR10']);
    const { engine, state } = game();
    const env = engine.env(state);
    const all = exitHexes(env, 'ge')!;
    expect([...all].sort()).toEqual(['uH10', 'uI10', 'uJ10', 'uP10', 'uQ10', 'uR10']);
    expect([...exitHexes(env, 'ge', unit(state, 'ge.pzvg'))!].sort()).toEqual(['uI10', 'uQ10']);
    const vp = (def: string) => env.query('vp.exit', { unit: unit(state, def) }, 0);
    expect([vp('ge.pzvg'), vp('ge.jgpz38'), vp('ge.467'), vp('ge.L92'), vp('ge.L91'), vp('ge.L80')]).toEqual([8, 7, 2, 3, 2, 1]);
  });

  it('SSR 2: grain and brush are wetland: a Hindrance in April, 1.5 MF and 2 MP; balance', () => {
    const { engine, state } = game();
    const env = engine.env(state);
    expect(terrainOf(env, 'vM6').id).toBe('grain');
    const bare = game({ ...S28, ssr: [] });
    expect(terrainOf(bare.engine.env(bare.state), 'vM6').id).toBe('open');
    expect(env.query('move.cost', { unit: unit(state, 'ge.467'), from: 'vM7', to: 'vM6', viaRoad: false }, 1)).toBe(1.5);
    expect(env.query('move.cost', { unit: unit(state, 'ge.467'), from: 'uD3', to: 'uD2', viaRoad: false }, 1)).toBe(1.5);
    expect(env.query('move.cost', { unit: unit(state, 'ge.pzvg'), from: 'vM7', to: 'vM6', viaRoad: false }, 1)).toBe(2);
    const ru = applyBalanceS20(S28, ['ru']);
    expect(count(ru, 'ru', 'ru.228c')).toBe(2);
    expect(sws(ru, 'ru').filter((w) => w === 'ru.AR122L')).toHaveLength(2);
    const ge = applyBalanceS20(S28, ['ge']);
    expect(ge).toMatchObject({ turns: 8, halfFinalTurn: true });
  });
});

describe('S29 No Monumental Acclaim', () => {
  const S29 = ALL_SCENARIOS.find((s) => s.id === 'sk-s29')!;
  const force = (sc: typeof S29, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof S29, id: string, def?: string) => force(sc, id).units.filter((u) => !def || u.def === def).reduce((n, u) => n + u.count, 0);
  const sws = (sc: typeof S29, id: string) => force(sc, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();

  it('is playable on board w turned 180°, hexrows G-X; Germans set up first, Americans move first, 6½ turns', () => {
    expect(S29).toMatchObject({ product: 'sk-dl', turns: 7, halfFinalTurn: true, firstSide: 'am', month: 8 });
    expect(S29.status).toBeUndefined();
    expect(rulesetFor(S29).id).toBe('asl-sk2');
    expect(S29.sides).toEqual([
      { side: 'ge', name: 'German', nationality: 'ge', elr: 2, setupFirst: true },
      { side: 'am', name: 'American', nationality: 'am', elr: 5 },
    ]);
    const map = staticsForS20(S29, { los: 'grid' }).map;
    expect(map.hex('wF5')).toBeUndefined();
    expect(map.hex('wY5')).toBeUndefined();
    // The card's north edge is the board's row 10.
    expect(map.edge('N')).toEqual(expect.arrayContaining(['wG10', 'wX10']));
    expect(map.edge('N')).not.toContain('wG1');
  });

  it('fields the card’s order of battle', () => {
    expect([count(S29, 'ge', 'ge.467'), count(S29, 'ge', 'ge.447'), count(S29, 'ge')]).toEqual([4, 6, 14]);
    expect(sws(S29, 'ge')).toEqual(['ge.HMG', 'ge.MMG']);
    expect([count(S29, 'am', 'am.747'), count(S29, 'am')]).toEqual([11, 15]);
    expect(sws(S29, 'am')).toEqual(['am.BAZ44', 'am.BAZ44', 'am.DC', 'am.MMG', 'am.MMG']);
    expect(force(S29, 'ge').setup).toMatchObject({ kind: 'area' });
    expect((force(S29, 'ge').setup as { hexes: string[] }).hexes).toEqual(expect.arrayContaining(['wG1', 'wX8', 'wP1']));
    expect((force(S29, 'ge').setup as { hexes: string[] }).hexes).not.toContain('wP9');
    expect(force(S29, 'am').setup).toMatchObject({ kind: 'enter', turn: 1, edge: 'N' });
    const { engine, state } = newGame(S29, 's29', { los: 'grid' });
    const d = engine.currentDecision(state)!;
    expect(d).toMatchObject({ kind: 'setup', owner: 'ge' });
    const [auto] = engine.legalActions(state, 'ge') as unknown as [{ placements: Record<string, string> }];
    expect(placementIllegal(engine.env(state), 'ge', piecesToPlace(engine.env(state), d), auto.placements)).toBeNull();
  });

  it('VC: building P1 and ≥ 5 of the other nine multi-hex buildings in G-X; balance', () => {
    expect(S29_P1).toBe('w-B23');
    expect(S29_OTHER_BUILDINGS).toHaveLength(9);
    expect(S29_OTHER_BUILDINGS).not.toContain(S29_P1);
    expect(S29.victory).toEqual([
      { kind: 'all', side: 'am', of: [
        { kind: 'controlBuildings', side: 'am', buildings: ['w-B23'], atLeast: 1 },
        { kind: 'controlBuildings', side: 'am', buildings: S29_OTHER_BUILDINGS, atLeast: 5 },
      ] },
    ]);
    expect(sws(applyBalanceS20(S29, ['ge']), 'ge')).toEqual(['ge.HMG', 'ge.LMG', 'ge.LMG', 'ge.MMG']);
    expect(applyBalanceS20(S29, ['am'])).toMatchObject({ turns: 8, halfFinalTurn: true });
  });
});

describe('S30 Ripples on the Pond', () => {
  const S30 = ALL_SCENARIOS.find((s) => s.id === 'sk-s30')!;
  const force = (sc: typeof S30, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof S30, id: string, def?: string) => force(sc, id).units.filter((u) => !def || u.def === def).reduce((n, u) => n + u.count, 0);
  const sws = (sc: typeof S30, id: string) => force(sc, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();

  it('is playable on board u (turned, Q-GG) above board v (A-Q numbered ≤ 6); Germans set up first, Americans move first, 4½ turns', () => {
    expect(S30).toMatchObject({ product: 'sk-dl', turns: 5, halfFinalTurn: true, firstSide: 'am', month: 11 });
    expect(S30.status).toBeUndefined();
    expect(rulesetFor(S30).id).toBe('asl-sk3');
    expect(S30.sides).toEqual([
      { side: 'ge', name: 'German', nationality: 'ge', elr: 2, setupFirst: true },
      { side: 'am', name: 'American', nationality: 'am', elr: 3 },
    ]);
    const map = staticsForS20(S30, { los: 'grid' }).map;
    expect(map.hex('uP5')).toBeUndefined();
    expect(map.hex('vR3')).toBeUndefined();
    expect(map.hex('vC7')).toBeUndefined();
    expect(map.hex('vC6')).toBeDefined();
    expect(map.edge('S')).toEqual(expect.arrayContaining(['vA6', 'vQ6']));
    expect(map.edge('W')).toEqual(expect.arrayContaining(['uGG5', 'vA3']));
    expect(map.edge('E')).toEqual(expect.arrayContaining(S30_EXIT));
  });

  it('fields the card’s order of battle', () => {
    expect([count(S30, 'ge', 'ge.467'), count(S30, 'ge', 'ge.447'), count(S30, 'ge', 'ge.238h'), count(S30, 'ge', 'ge.228c'), count(S30, 'ge')]).toEqual([1, 3, 1, 2, 9]);
    expect(sws(S30, 'ge')).toEqual(['ge.AT75L', 'ge.AT75L', 'ge.LMG', 'ge.MMG']);
    expect([count(S30, 'am', 'am.666'), count(S30, 'am', 'am.M4A2L'), count(S30, 'am', 'am.M4A3'), count(S30, 'am', 'am.M4A3E2'), count(S30, 'am')]).toEqual([6, 3, 1, 1, 13]);
    expect(sws(S30, 'am')).toEqual(['am.BAZ44']);
    expect(COUNTERS['am.M4A2L']).toMatchObject({ kind: 'vehicle', mp: 14, af: { hull: { front: 11, side: 4 } }, mg: { bmg: 2, cmg: 4, aamg: 4 } });
    expect(COUNTERS['am.M4A3']).toMatchObject({ mp: 15, af: { hull: { front: 8, side: 4 } } });
    expect(COUNTERS['am.M4A3E2']).toMatchObject({ mp: 12, af: { hull: { front: 18, side: 8 } } });
  });

  it('setup: the Germans ≥ 2 hexes from the south/west edges; the Americans enter on Turn 1 on v A2-A6 and A6-I6', () => {
    expect(S30_GE_SETUP).toEqual(expect.arrayContaining(['vC4', 'uEE5', 'uQ9']));
    for (const h of ['vC5', 'vC6', 'vB4', 'uFF5', 'uGG5', 'vA1']) expect(S30_GE_SETUP).not.toContain(h);
    expect(S30_AM_ENTRY).toEqual(['vA2', 'vA3', 'vA4', 'vA5', 'vA6', 'vB6', 'vC6', 'vD6', 'vE6', 'vF6', 'vG6', 'vH6', 'vI6']);
    expect(force(S30, 'am').setup).toMatchObject({ kind: 'enter', turn: 1, edge: 'S,W' });
    const { engine, state } = newGame(S30, 's30', { los: 'grid' });
    const d = engine.currentDecision(state)!;
    expect(d).toMatchObject({ kind: 'setup', owner: 'ge' });
    const [auto] = engine.legalActions(state, 'ge') as unknown as [{ placements: Record<string, string> }];
    expect(placementIllegal(engine.env(state), 'ge', piecesToPlace(engine.env(state), d), auto.placements)).toBeNull();
  });

  it('VC: 10 exit VP off u Q3-Q9, at least 6 of them by AFV (3 each); SSR 1: half MP; balance', () => {
    expect(S30.victory).toEqual([{ kind: 'exitVp', side: 'am', edge: 'E', hexes: S30_EXIT, vp: 10, immediate: true, afvVpAtLeast: 6, afvVp: { ma: 3, noMa: 3 } }]);
    const { engine, state } = newGame(S30, 's30', { los: 'grid' });
    const ids = (def: string) => Object.values(state.pieces).filter((p) => p.defId === def).map((p) => p.id);
    const env = engine.env(state);
    expect(env.query('vp.exit', { unit: ids('am.M4A3')[0]! }, 0)).toBe(3);
    expect(env.query('vp.exit', { unit: ids('am.666')[0]! }, 0)).toBe(2);
    expect(env.query('vp.exit', { unit: ids('am.L91')[0]! }, 0)).toBe(2);
    expect(env.query('unit.mf', { unit: ids('am.M4A3')[0]!, stack: [], doubleTime: false }, 0)).toBe(7.5);
    // Ten VP by five squads is not enough without the armor; two tanks and two squads is.
    const exited = (units: string[]) => ({ ...state, ext: { ...state.ext, 'sk1.exited': units.map((u) => ({ unit: u, side: 'am', vp: engine.env(state).query('vp.exit', { unit: u }, 0) })) } });
    const vc = S30.victory[0] as Extract<(typeof S30.victory)[number], { kind: 'exitVp' }>;
    expect(exitVpMet(engine.env(exited(ids('am.666').slice(0, 5))), vc)).toBe(false);
    const mixed = engine.env(exited([...ids('am.M4A2L').slice(0, 2), ...ids('am.666').slice(0, 2)]));
    expect(vehicleExitVp(mixed, 'am')).toBe(6);
    expect(exitVpMet(mixed, vc)).toBe(true);
    const ge = applyBalanceS20(S30, ['ge']);
    expect(ge.victory[0]).toMatchObject({ vp: 13 });
    expect(count(applyBalanceS20(S30, ['am']), 'ge', 'ge.238h')).toBe(0);
  });
});

describe('S31 Going to New York!', () => {
  const S31 = ALL_SCENARIOS.find((s) => s.id === 'sk-s31')!;
  const force = (sc: typeof S31, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof S31, id: string, def?: string) => force(sc, id).units.filter((u) => !def || u.def === def).reduce((n, u) => n + u.count, 0);
  const sws = (sc: typeof S31, id: string) => force(sc, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();
  const game = (sc = S31) => newGame(sc, 's31', { los: 'grid' });
  const los = (env: ReturnType<ReturnType<typeof game>['engine']['env']>, a: string, b: string) => env.query('los.trace', { from: a, to: b }, { clear: true, hindrance: 0, parts: [] });

  it('is playable on board x cut to T-GG; Americans set up first, Italians move first, 5½ turns', () => {
    expect(S31).toMatchObject({ product: 'sk-dl', turns: 6, halfFinalTurn: true, firstSide: 'it', month: 7 });
    expect(S31.status).toBeUndefined();
    // The Italian counters come with the SK2 set.
    expect(rulesetFor(S31).id).toBe('asl-sk2');
    expect(S31.sides).toEqual([
      { side: 'am', name: 'American', nationality: 'am', elr: 3, setupFirst: true },
      { side: 'it', name: 'Italian', nationality: 'it', elr: 1 },
    ]);
    const map = staticsForS20(S31, { los: 'grid' }).map;
    expect(map.hex('xS5')).toBeUndefined();
    expect(map.edge('W')).toEqual(expect.arrayContaining(['xT1', 'xT10']));
  });

  it('fields the card’s order of battle', () => {
    expect([count(S31, 'am', 'am.666'), count(S31, 'am')]).toEqual([6, 8]);
    expect(sws(S31, 'am')).toEqual(['am.MMG']);
    expect([count(S31, 'it', 'it.346'), count(S31, 'it', 'it.336'), count(S31, 'it', 'it.L70'), count(S31, 'it')]).toEqual([9, 4, 2, 16]);
    expect(sws(S31, 'it')).toEqual(['it.LMG', 'it.LMG', 'it.MMG']);
    expect(force(S31, 'it').setup).toMatchObject({ kind: 'enter', turn: 1, edge: 'N,W' });
  });

  it('American setup: V-Y, two MMC in any building hexes, one MMC per hex, leaders with an MMC', () => {
    const { engine, state } = game();
    const d = engine.currentDecision(state)!;
    expect(d).toMatchObject({ kind: 'setup', owner: 'am' });
    const env = engine.env(state);
    const todo = piecesToPlace(env, d);
    const [auto] = engine.legalActions(state, 'am') as unknown as [{ placements: Record<string, string> }];
    expect(placementIllegal(env, 'am', todo, auto.placements)).toBeNull();
    const squads = todo.filter((p) => p.defId === 'am.666').map((p) => p.id);
    const leaders = todo.filter((p) => p.defId.startsWith('am.L')).map((p) => p.id);
    const outside = S31_BUILDING_HEXES.filter((h) => !/^x[V-Y]\d/.test(h));
    expect(outside.length).toBeGreaterThan(2);
    const base = Object.fromEntries(squads.map((s, i) => [s, `xW${i + 1}`]));
    const ok = { ...base, [squads[0]!]: outside[0]!, [squads[1]!]: outside[1]!, [leaders[0]!]: 'xW3', [leaders[1]!]: 'xW4' };
    expect(placementIllegal(env, 'am', todo, ok)).toBeNull();
    expect(placementIllegal(env, 'am', todo, { ...ok, [squads[2]!]: outside[2]! })).toMatch(/No more than 2 MMC may set up in building hexes/);
    expect(placementIllegal(env, 'am', todo, { ...ok, [leaders[0]!]: 'xX8' })).toMatch(/must set up with a MMC/);
    expect(placementIllegal(env, 'am', todo, { ...ok, [squads[2]!]: 'xW4' })).toMatch(/No more than 1 MMC per hex/);
  });

  it('SSR 1: the Embankment Railroad blocks LOS beyond the hex behind it, costs 2 MF (1 along it), no TEM, no road', () => {
    const { engine, state } = game();
    const env = engine.env(state);
    const map = staticsForS20(S31, { los: 'grid' }).map;
    expect(map.hex('xAA8')!.features).toEqual([]);
    expect(map.hex('xDD6')!.features).toEqual(['road:dirt']);
    expect(map.roadHexside?.('xCC6', 'xDD6')).toBe(true);
    expect(map.roadHexside?.('xCC7', 'xDD6')).toBe(false);
    expect(los(env, 'xAA5', 'xAA10').clear).toBe(false);
    expect(los(env, 'xAA5', 'xAA10').blockedBy).toMatch(/Embankment Railroad in xAA8/);
    expect(los(env, 'xAA5', 'xAA9').clear).toBe(true); // the first hex beyond
    expect(los(env, 'xAA7', 'xAA10').clear).toBe(true); // the viewer is adjacent
    expect(los(env, 'xAA5', 'xAA8').clear).toBe(true); // onto the embankment
    expect(los(env, 'xAA8', 'xAA10').clear).toBe(true); // from on it
    const bare = game({ ...S31, ssr: [] });
    expect(los(bare.engine.env(bare.state), 'xAA5', 'xAA10').clear).toBe(true);
    const sq = Object.values(state.pieces).find((p) => p.defId === 'it.346')!.id;
    expect(env.query('move.cost', { unit: sq, from: 'xZ7', to: 'xZ8', viaRoad: false }, 1)).toBe(2);
    expect(env.query('move.cost', { unit: sq, from: 'xY9', to: 'xZ8', viaRoad: false }, 1)).toBe(1);
    for (const h of S31_RAILROAD) expect(env.query('hex.tem', { hex: h }, 9)).toBe(0);
  });

  it('SSR 2: Italian MMC are Inexperienced; VC; balance', () => {
    const { engine, state } = game();
    const env = engine.env(state);
    // A 3-4-6 carrying no weapon.
    const it346 = Object.values(state.pieces).filter((p) => p.defId === 'it.346' && !swHeldByS31(state, p.id).length).pop()!.id;
    expect(env.query('unit.inexperienced', { unit: it346 }, false)).toBe(true);
    expect(S31.victory).toEqual([
      { kind: 'controlBuildings', side: 'it', buildings: ['x-B9'], atLeast: 1, immediate: true },
      { kind: 'losFirepower', side: 'it', hexes: S31_RAILROAD, fp: 12, hexesLabel: 'railroad hexes', noAreaFire: true, pbf: true, tpbf: true },
    ]);
    // Point blank: a 3-4-6 adjacent to the railroad counts 6 FP, in a railroad hex 9; at long range nothing.
    const vc = S31.victory[1] as LosFirepowerVc;
    const at = (hex: string) => engine.env({ ...state, pieces: { ...state.pieces, [it346]: { ...state.pieces[it346]!, loc: { kind: 'hex', hex } } } });
    expect(losFirepower(at('xAA7'), vc).total).toBe(6);
    expect(losFirepower(at('xAA8'), vc).total).toBe(9);
    expect(losFirepower(at('xAA4'), vc).total).toBe(3);
    // Six hexes from the railroad is long range for a 3-4-6: Area Fire, which does not count.
    expect(losFirepower(at('xAA2'), vc).total).toBe(0);
    expect(losFirepower(at('xAA2'), { ...vc, noAreaFire: false }).total).toBe(1.5);
    const am = applyBalanceS20(S31, ['am']);
    expect(am.victory[1]).toMatchObject({ tpbf: false });
    // Without triple point blank, a squad on the railroad counts its point blank fire at the next railroad hex.
    expect(losFirepower(at('xAA8'), am.victory[1] as LosFirepowerVc).total).toBe(6);
    const it = applyBalanceS20(S31, ['it']);
    expect(it.ssr.map((s) => s.module)).toEqual(['embankment-railroad']);
  });
});

describe('S32 Göring’s Men', () => {
  const S32 = ALL_SCENARIOS.find((s) => s.id === 'sk-s32')!;
  const force = (sc: typeof S32, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof S32, id: string, def?: string) => force(sc, id).units.filter((u) => !def || u.def === def).reduce((n, u) => n + u.count, 0);
  const sws = (sc: typeof S32, id: string) => force(sc, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();
  const game = (sc = S32) => newGame(sc, 's32', { los: 'grid' });

  it('is playable on board x above board v (turned); the Russians set up and move first, 7 turns', () => {
    expect(S32).toMatchObject({ product: 'sk-dl', turns: 7, halfFinalTurn: false, firstSide: 'ru', month: 9 });
    expect(S32.status).toBeUndefined();
    expect(rulesetFor(S32).id).toBe('asl-sk2');
    expect(S32.sides).toEqual([
      { side: 'ru', name: 'Russian', nationality: 'ru', elr: 2, setupFirst: true },
      { side: 'ge', name: 'German', nationality: 'ge', elr: 4 },
    ]);
    const map = staticsForS20(S32, { los: 'grid' }).map;
    expect(map.edge('N')).toContain('xA1');
    expect(map.edge('S')).toContain('vA1');
    expect(map.edge('W')).toContain('vGG5');
  });

  it('fields the card’s order of battle', () => {
    expect([count(S32, 'ru', 'ru.447'), count(S32, 'ru', 'ru.228c'), count(S32, 'ru')]).toEqual([9, 3, 14]);
    expect(sws(S32, 'ru')).toEqual(['ru.AR76L', 'ru.AR76L', 'ru.INF76s', 'ru.LMG', 'ru.LMG', 'ru.LMG', 'ru.MMG']);
    expect([count(S32, 'ge-k1', 'ge.468'), count(S32, 'ge-k1')]).toEqual([9, 12]);
    expect(sws(S32, 'ge-k1')).toEqual(['ge.DC', 'ge.DC', 'ge.LMG', 'ge.LMG', 'ge.LMG']);
    expect([count(S32, 'ge-zug2', 'ge.468'), count(S32, 'ge-zug2')]).toEqual([4, 5]);
    expect(sws(S32, 'ge-zug2')).toEqual(['ge.LMG', 'ge.LMG']);
    expect(force(S32, 'ge-zug2').setup).toMatchObject({ kind: 'enter', turn: 3, edge: 'W,S' });
  });

  it('setup: Russians ≥ 3 hexes from the road section with the Guns ≥ 3 apart; Germans on/adjacent to it, one MMC per hex', () => {
    expect(S32_ROAD).toEqual(['vY1', 'vY2', 'vY3', 'vX3', 'vW4', 'vV4', 'vU5', 'vT5', 'vS6', 'vR6']);
    for (const h of ['vY4', 'vX5', 'vR8']) expect(S32_RU_SETUP).not.toContain(h);
    expect(S32_RU_SETUP).toEqual(expect.arrayContaining(['vR9', 'vN9', 'xA1']));
    expect(S32_GE_SETUP).toEqual(expect.arrayContaining(['vY1', 'vZ1', 'vR7', 'vQ6']));
    expect(S32_GE_SETUP).not.toContain('vR8');
    const { engine, state } = game();
    const d = engine.currentDecision(state)!;
    expect(d).toMatchObject({ kind: 'setup', owner: 'ru' });
    const env = engine.env(state);
    const todo = piecesToPlace(env, d);
    const [auto] = engine.legalActions(state, 'ru') as unknown as [{ placements: Record<string, string> }];
    expect(placementIllegal(env, 'ru', todo, auto.placements)).toBeNull();
  });

  it('VC: all Russian Guns eliminated at once, or ≥ 18 VP at game end (2 per building hex near vN9, 3 per ART Gun); balance', () => {
    expect(S32_VP_BUILDINGS).toHaveLength(9);
    expect(S32_VP_BUILDINGS).toEqual(expect.arrayContaining(['vN9', 'xP8']));
    const { engine, state } = game();
    const vc = S32.victory[1] as Extract<(typeof S32.victory)[number], { kind: 'vpTally' }>;
    const guns = Object.values(state.pieces).filter((p) => p.defId === 'ru.AR76L');
    const gone = { ...state, pieces: { ...state.pieces, ...Object.fromEntries(guns.map((g) => [g.id, { ...g, loc: { kind: 'eliminated' as const } }])) } };
    expect(vpTally(engine.env(state), vc).total).toBe(0);
    expect(vpTally(engine.env(gone), vc)).toMatchObject({ total: 6, items: [{ vp: 0 }, { vp: 6, each: 3 }] });
    expect(S32.victory[0]).toEqual({ kind: 'gunsEliminatedOrCaptured', side: 'ge', of: 'ru', immediate: true, eliminatedOnly: true });
    expect(force(applyBalanceS20(S32, ['ru']), 'ge-zug2').setup).toMatchObject({ turn: 4 });
    expect(applyBalanceS20(S32, ['ge']).victory[1]).toMatchObject({ vp: 15 });
  });
});

describe('S33 Few and Far Between', () => {
  const S33 = ALL_SCENARIOS.find((s) => s.id === 'sk-s33')!;
  const force = (sc: typeof S33, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof S33, id: string, def?: string) => force(sc, id).units.filter((u) => !def || u.def === def).reduce((n, u) => n + u.count, 0);
  const sws = (sc: typeof S33, id: string) => force(sc, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();
  const game = (sc = S33) => newGame(sc, 's33', { los: 'grid' });

  it('is playable on boards u and y (turned), Z-GG of each; the Dutch set up first, the Germans move first, 4½ turns', () => {
    expect(S33).toMatchObject({ product: 'sk-dl', turns: 5, halfFinalTurn: true, firstSide: 'ge', month: 5, nationalityNames: { al: 'Dutch' } });
    expect(S33.status).toBeUndefined();
    expect(rulesetFor(S33).id).toBe('asl-sk3');
    expect(S33.sides).toEqual([
      { side: 'al', name: 'Dutch', nationality: 'al', elr: 3, setupFirst: true },
      { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
    ]);
    const map = staticsForS20(S33, { los: 'grid' }).map;
    expect([...map.hexes()]).toHaveLength(158);
    expect(map.edge('W')).toContain('uZ5');
    expect(map.edge('E')).toContain('yZ5');
    // The GG hexrows meet; the turned board numbers them the other way.
    expect(map.hex('uGG5')?.id).toBe('yGG6');
  });

  it('fields the card’s order of battle', () => {
    expect([count(S33, 'nl', 'al.457'), count(S33, 'nl')]).toEqual([6, 8]);
    expect(sws(S33, 'nl')).toEqual(['al.LMG', 'al.LMG']);
    expect(force(S33, 'nl-t2').units).toEqual([{ def: 'al.457', count: 1 }, { def: 'al.237h', count: 1 }, { def: 'al.L81', count: 1 }]);
    expect(force(S33, 'nl-t2').setup).toMatchObject({ kind: 'enter', turn: 2, edge: 'W' });
    expect([count(S33, 'ge', 'ge.468'), count(S33, 'ge', 'ge.467'), count(S33, 'ge', 'ge.248h'), count(S33, 'ge', 'ge.pziia'), count(S33, 'ge')]).toEqual([2, 5, 1, 1, 12]);
    expect(sws(S33, 'ge')).toEqual(['ge.DC', 'ge.LMG', 'ge.LMG']);
    expect(COUNTERS['ge.pziia']).toMatchObject({ kind: 'vehicle', mp: 15, af: { hull: { front: 1, side: 1 } }, ma: { caliber: 20, ife: 4, rof: 2, b: 11 }, mg: { cmg: 5 } });
    expect(force(S33, 'ge').setup).toMatchObject({ kind: 'enter', turn: 1, edge: 'E' });
  });

  it('Dutch setup on/west-of yBB; VC: all five buildings within 2 hexes of yFF5', () => {
    expect(S33_NL_SETUP).toEqual(expect.arrayContaining(['yBB5', 'yGG5', 'uZ5']));
    expect(S33_NL_SETUP).not.toContain('yAA5');
    expect(S33_BUILDINGS).toEqual(['u-B34', 'y-B35', 'y-B36', 'y-B37', 'y-B38']);
    expect(S33.victory).toEqual([{ kind: 'controlBuildings', side: 'ge', buildings: S33_BUILDINGS, atLeast: 5 }]);
    const { engine, state } = game();
    const d = engine.currentDecision(state)!;
    expect(d).toMatchObject({ kind: 'setup', owner: 'al' });
    const [auto] = engine.legalActions(state, 'al') as unknown as [{ placements: Record<string, string> }];
    expect(placementIllegal(engine.env(state), 'al', piecesToPlace(engine.env(state), d), auto.placements)).toBeNull();
  });

  it('SSR 1: grain is Plowed Field, 1½ MF and Open Ground otherwise (no Hindrance, FFMO); balance', () => {
    const grain = [...staticsForS20(S33, { los: 'grid' }).map.hexes()].find((h) => h.terrain === 'grain')!;
    const { engine, state } = game();
    const env = engine.env(state);
    expect(terrainOf(env, grain.id)).toMatchObject({ id: 'plowed', mf: 1.5, openGround: true, los: 'none' });
    const sq = Object.values(state.pieces).find((p) => p.defId === 'ge.467')!.id;
    const from = staticsForS20(S33, { los: 'grid' }).map.neighbors(grain.id)[0]!;
    expect(env.query('move.cost', { unit: sq, from, to: grain.id, viaRoad: false }, 1)).toBe(1.5);
    expect(env.query('hex.openGround', { hex: grain.id }, false)).toBe(true);
    const nl = applyBalanceS20(S33, ['al']);
    expect(sws(nl, 'nl-t2')).toEqual(['al.LMG']);
    const ge = applyBalanceS20(S33, ['ge']);
    expect(count(ge, 'ge', 'ge.pziif')).toBe(1);
    expect(count(ge, 'ge', 'ge.pziia')).toBe(0);
  });
});

describe('S34 Twilight at Baerendorf', () => {
  const S34 = ALL_SCENARIOS.find((s) => s.id === 'sk-s34')!;
  const force = (sc: typeof S34, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof S34, id: string, def?: string) => force(sc, id).units.filter((u) => !def || u.def === def).reduce((n, u) => n + u.count, 0);
  const sws = (sc: typeof S34, id: string) => force(sc, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();
  const game = (sc = S34) => newGame(sc, 's34', { los: 'grid' });

  it('is playable on boards x and y on end (turned 90° clockwise); Americans set up first, Germans move first, 8 turns', () => {
    expect(S34).toMatchObject({ product: 'sk-dl', turns: 8, halfFinalTurn: false, firstSide: 'ge', month: 11, compass: { N: 'W', E: 'N', S: 'E', W: 'S' } });
    expect(S34.status).toBeUndefined();
    expect(rulesetFor(S34).id).toBe('asl-sk3');
    const map = staticsForS20(S34, { los: 'grid' }).map;
    // North is hexrow A, south hexrow GG; x is the west board, y the east one.
    expect(map.edge('N')).toEqual(expect.arrayContaining(['xA5', 'yA5']));
    expect(map.edge('S')).toEqual(expect.arrayContaining(['xGG5', 'yGG5']));
    expect(map.edge('E')).toContain('yM1');
    expect(map.edge('W')).toContain('xM10');
  });

  it('fields the card’s order of battle', () => {
    expect([count(S34, 'am', 'am.667'), count(S34, 'am', 'am.227c'), count(S34, 'am')]).toEqual([10, 2, 17]);
    expect(sws(S34, 'am')).toEqual(['am.AT57L', 'am.AT57L', 'am.BAZ44', 'am.BAZ44', 'am.BAZ44', 'am.BAZ44', 'am.HMG50', 'am.MMG', 'am.MMG']);
    expect(force(S34, 'am-t3')).toMatchObject({ units: [{ def: 'am.M5A1', count: 2 }], setup: { kind: 'enter', turn: 3, edge: 'S' } });
    expect([count(S34, 'ge', 'ge.468'), count(S34, 'ge', 'ge.pzivj'), count(S34, 'ge', 'ge.pzivh'), count(S34, 'ge', 'ge.stgiiigl'), count(S34, 'ge', 'ge.pziiig'), count(S34, 'ge')]).toEqual([13, 3, 2, 2, 1, 26]);
    expect(sws(S34, 'ge')).toEqual(['ge.LMG', 'ge.LMG', 'ge.LMG', 'ge.LMG', 'ge.MMG', 'ge.PSK']);
    expect(COUNTERS['am.HMG50']).toMatchObject({ kind: 'sw', type: 'HMG', fp: 8, range: 16, rof: 3 });
    expect(COUNTERS['am.M5A1']).toMatchObject({ mp: 17, af: { hull: { front: 6, side: 3 } }, ma: { caliber: 37, barrel: 'LL' }, mg: { bmg: 2, cmg: 4, aamg: 2 } });
    expect(COUNTERS['ge.pziiig']).toMatchObject({ mp: 13, af: { hull: { front: 3, side: 3 } }, ma: { caliber: 50, rof: 2 }, mg: { bmg: 3, cmg: 5 } });
  });

  it('setup on/south-of hexrow H; SSR 2 hides the Bazookas from the Germans', () => {
    expect(S34_AM_SETUP).toEqual(expect.arrayContaining(['xH5', 'yGG1', 'xGG10']));
    expect(S34_AM_SETUP).not.toContain('xG5');
    const { engine, state } = game();
    const d = engine.currentDecision(state)!;
    expect(d).toMatchObject({ kind: 'setup', owner: 'am' });
    const [auto] = engine.legalActions(state, 'am') as unknown as [Record<string, unknown>];
    const after = engine.submit(state, { ...auto, side: 'am', decisionId: d.id } as never).state;
    const env = engine.env(after);
    const baz = Object.values(after.pieces).filter((p) => p.defId === 'am.BAZ44');
    expect(baz).toHaveLength(4);
    for (const b of baz) {
      expect(env.query('piece.visibleTo', { piece: b.id, viewer: 'ge' }, true)).toBe(false);
      expect(env.query('piece.visibleTo', { piece: b.id, viewer: 'am' }, true)).toBe(true);
    }
    const mmg = Object.values(after.pieces).find((p) => p.defId === 'am.MMG')!;
    expect(env.query('piece.visibleTo', { piece: mmg.id, viewer: 'ge' }, true)).toBe(true);
  });

  it('VC: 40 exit VP off the south edge (AFV 6 or 5); SSR 1 +1 at ≥ 7 hexes; balance', () => {
    expect(S34.victory).toEqual([{ kind: 'exitVp', side: 'ge', edge: 'S', vp: 40, immediate: true, afvVp: { ma: 6, noMa: 5 } }]);
    const { engine, state } = game();
    const env = engine.env(state);
    const unit = (def: string) => Object.values(state.pieces).find((p) => p.defId === def)!.id;
    expect([env.query('vp.exit', { unit: unit('ge.pzivj') }, 0), env.query('vp.exit', { unit: unit('ge.468') }, 0), env.query('vp.exit', { unit: unit('ge.L102') }, 0)]).toEqual([6, 2, 3]);
    const sq = unit('ge.468');
    const part = (dist: number) => ({ piece: sq, firer: sq, kind: 'inherent', hex: 'xA1', range: 6, dist });
    const attack = (dist: number, residual = false) => ({ mode: 'prep', side: 'ge', target: 'xM5', parts: [part(dist)], targets: [], hindrance: 0, ...(residual ? { residual: true } : {}) }) as never;
    expect(env.query('fire.drm', { attack: attack(7) }, 0)).toBe(1);
    expect(env.query('fire.drm', { attack: attack(6) }, 0)).toBe(0);
    expect(env.query('fire.drm', { attack: attack(9, true) }, 0)).toBe(0);
    expect(exitVpCondition(applyBalanceS20(S34, ['am']), 'ge')).toMatchObject({ vp: 46 });
    expect(applyBalanceS20(S34, ['ge']).ssr.map((s) => s.module)).toEqual(['attack-drm']);
  });
});

describe('S35 The Volga Is Reached!', () => {
  const S35 = ALL_SCENARIOS.find((s) => s.id === 'sk-s35')!;
  const force = (sc: typeof S35, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof S35, id: string, def?: string) => force(sc, id).units.filter((u) => !def || u.def === def).reduce((n, u) => n + u.count, 0);
  const sws = (sc: typeof S35, id: string) => force(sc, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();
  const game = (sc = S35) => newGame(sc, 's35', { los: 'grid' });
  const unit = (state: { pieces: Record<string, { id: string; defId: string }> }, def: string) => Object.values(state.pieces).find((p) => p.defId === def)!.id;

  it('is playable on board z (A-P) turned; the Russians set up first, the Germans move first, 7 turns', () => {
    expect(S35).toMatchObject({ product: 'sk-dl', turns: 7, halfFinalTurn: false, firstSide: 'ge', month: 9 });
    expect(S35.status).toBeUndefined();
    expect(rulesetFor(S35).id).toBe('asl-sk3');
    const map = staticsForS20(S35, { los: 'grid' }).map;
    expect(map.hex('zQ5')).toBeUndefined();
    // Hexrow A faces south, row 1 west.
    expect(map.edge('S')).toContain('zA5');
    expect(map.edge('W')).toContain('zG1');
    expect(map.edge('E')).toContain('zG10');
  });

  it('fields the card’s order of battle', () => {
    expect([count(S35, 'ru', 'ru.628'), count(S35, 'ru', 'ru.426'), count(S35, 'ru', 'ru.L80'), count(S35, 'ru')]).toEqual([4, 7, 2, 16]);
    expect(sws(S35, 'ru')).toEqual(['ru.ATR', 'ru.ATR', 'ru.INF76s', 'ru.LMG', 'ru.LMG', 'ru.MMG']);
    expect([count(S35, 'ru-t4'), count(S35, 'ru-t4', 'ru.KV1M41')]).toEqual([7, 1]);
    expect(force(S35, 'ru-t4').setup).toMatchObject({ kind: 'enter', turn: 4, edge: 'S' });
    expect([count(S35, 'ru-t6', 'ru.458'), count(S35, 'ru-t6')]).toEqual([5, 6]);
    expect(sws(S35, 'ru-t6')).toEqual(['ru.DC', 'ru.LMG', 'ru.LMG']);
    expect(force(S35, 'ru-t6').setup).toMatchObject({ kind: 'enter', turn: 6, edge: 'E' });
    expect([count(S35, 'ge', 'ge.838'), count(S35, 'ge', 'ge.467'), count(S35, 'ge')]).toEqual([3, 9, 17]);
    expect(sws(S35, 'ge')).toEqual(['ge.DC', 'ge.FT', 'ge.HMG', 'ge.LMG', 'ge.LMG', 'ge.MMG']);
    expect([count(S35, 'ge-t3', 'ge.548'), count(S35, 'ge-t3')]).toEqual([5, 8]);
    expect(sws(S35, 'ge-t3')).toEqual(['ge.DC', 'ge.LMG', 'ge.LMG', 'ge.MMG']);
    expect(force(S35, 'ge').setup).toMatchObject({ kind: 'enter', turn: 1, edge: 'W', hexes: expect.arrayContaining(['zG1', 'zP0']) });
    expect(COUNTERS['ru.KV1M41']).toMatchObject({ mp: 11, af: { hull: { front: 11, side: 8 } }, ma: { caliber: 76, barrel: 'L' } });
    expect(COUNTERS['ge.stgiiig']).toMatchObject({ mp: 13, af: { hull: { front: 8, side: 3 } }, ma: { caliber: 75, barrel: 'L' }, mg: { aamg: 2 } });
  });

  it('setup: the T-34 is dug in, only on road, Open Ground or shellholes, its BMG disabled; VC buildings numbered ≥ 8', () => {
    expect(S35_VC_HEXES).toHaveLength(12);
    expect(S35.victory).toEqual([{ kind: 'controlHexes', side: 'ge', hexes: S35_VC_HEXES, atLeast: 12, hexesLabel: 'building hexes numbered ≥ 8' }]);
    const { engine, state } = game();
    const d = engine.currentDecision(state)!;
    const env = engine.env(state);
    const todo = piecesToPlace(env, d);
    const [auto] = engine.legalActions(state, 'ru') as unknown as [{ placements: Record<string, string> }];
    const t34 = unit(state, 'ru.T34M41');
    expect(placementIllegal(env, 'ru', todo, auto.placements)).toBeNull();
    const building = S35_VC_HEXES.find((h) => !Object.values(auto.placements).includes(h))!;
    expect(placementIllegal(env, 'ru', todo, { ...auto.placements, [t34]: building })).toMatch(/may set up only in road, Open Ground, Shellholes hexes/);
    const after = engine.submit(state, { ...auto, side: 'ru', decisionId: d.id } as never).state;
    expect(after.pieces[t34]!.tags['dugIn']).toBe(true);
    expect(after.pieces[`${t34}.bmg`]!.tags['mgDisabled']).toBe(true);
  });

  it('SSR 1-2, 4-6: rubble and shellholes; 2nd-Line 6-2-8s; Commissars; the Sniper and Stuka; balance', () => {
    const { engine, state } = game();
    const env = engine.env(state);
    const map = staticsForS20(S35, { los: 'grid' }).map;
    const shell = [...map.hexes()].find((h) => h.terrain === 'shellholes')!;
    expect(terrainOf(env, shell.id)).toMatchObject({ mf: 2, tem: 1, los: 'none' });
    expect([...map.hexes()].some((h) => h.terrain === 'rubble-stone')).toBe(true);
    const sq = unit(state, 'ru.628');
    expect(env.query('unit.elrExempt', { unit: sq }, false)).toBe(true);
    const broken = engine.env({ ...state, pieces: { ...state.pieces, [sq]: { ...state.pieces[sq]!, tags: { broken: true } } } });
    expect(broken.query('unit.morale', { unit: sq }, 0)).toBe(9);
    expect(env.query('cc.ambushDrm', { hex: 'zE5', side: 'ru', units: [sq] }, 0)).toBe(0);
    expect(env.query('cc.ambushDrm', { hex: 'zE5', side: 'ru', units: [unit(state, 'ru.458')] }, 0)).toBe(-1);
    expect(env.query('unit.smoke', { unit: unit(state, 'ge.838') }, 0)).toBe(5);
    expect(env.query('unit.morale', { unit: unit(state, 'ru.L80') }, 0)).toBe(10);
    expect(env.query('unit.morale', { unit: unit(state, 'ru.L61') }, 0)).toBe(8);
    // The 6+1 keeps its printed leadership (the card changes only its morale).
    expect(env.query('unit.leadership', { unit: unit(state, 'ru.L61') }, 1)).toBe(1);
    expect(ssrHexAttacks(env, 'ru').map((a) => a.type)).toEqual(['ssr.sniper']);
    expect(ssrHexAttacks(env, 'ge').map((a) => a.type)).toEqual(['ssr.stuka']);
    expect(count(applyBalanceS20(S35, ['ru']), 'ru-t4', 'ru.L92')).toBe(1);
    expect(sws(applyBalanceS20(S35, ['ge']), 'ge').filter((w) => w === 'ge.FT')).toHaveLength(2);
  });
});

describe('S36 Satisfaction and Confidence', () => {
  const S36 = ALL_SCENARIOS.find((s) => s.id === 'sk-s36')!;
  const force = (sc: typeof S36, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof S36, id: string, def?: string) => force(sc, id).units.filter((u) => !def || u.def === def).reduce((n, u) => n + u.count, 0);
  const sws = (sc: typeof S36, id: string) => force(sc, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();
  /** A game through the secret choice and the German setup, to the Russian offboard setup. */
  const revealed = (option: number) => {
    const { engine, state: s0 } = newGame(S36, `s36-${option}`, { los: 'grid' });
    let state = s0;
    const step = (a: Record<string, unknown>) => {
      const d = engine.currentDecision(state)!;
      state = engine.submit(state, { ...a, side: d.owner, decisionId: d.id } as never).state;
    };
    step({ type: 'length.choose', option });
    const [auto] = engine.legalActions(state, 'ge') as unknown as [Record<string, unknown>];
    step(auto);
    return { engine, state, step: (a: Record<string, unknown>) => (step(a), state), get: () => state };
  };

  it('is playable on boards x, v and t, each turned; the Germans set up first, the Russians move first, up to 6½ turns', () => {
    expect(S36).toMatchObject({ product: 'sk-dl', turns: 7, halfFinalTurn: true, firstSide: 'ru', month: 6 });
    expect(S36.status).toBeUndefined();
    expect(rulesetFor(S36).id).toBe('asl-sk3');
    const map = staticsForS20(S36, { los: 'grid' }).map;
    expect([...map.hexes()]).toHaveLength(1006);
    // North is board x's row 10, south board t's row 1.
    expect(map.edge('N')).toContain('xM10');
    expect(map.edge('S')).toContain('tM1');
    expect(S36_GE_SETUP).toEqual(expect.arrayContaining(['vM4', 'xM1', 'xM10']));
    expect(S36_GE_SETUP).not.toContain('vM3');
    expect(S36_AREA_45).toHaveLength(561);
    expect(S36_AREA_55).toHaveLength(676);
    expect(S36_EDGE_45).toHaveLength(33);
    expect(map.offboard('S45').map((h) => h.id)).toContain('vM3~');
  });

  it('fields the card’s order of battle; the German reinforcements come from the table', () => {
    expect([count(S36, 'ge', 'ge.467'), count(S36, 'ge', 'ge.447'), count(S36, 'ge', 'ge.L81'), count(S36, 'ge')]).toEqual([5, 3, 2, 12]);
    expect(sws(S36, 'ge')).toEqual(['ge.AT75L', 'ge.LMG', 'ge.LMG', 'ge.MMG', 'ge.PSK']);
    expect(force(S36, 'ge-t2')).toMatchObject({ units: [], setup: { kind: 'enter', turn: 2, edge: 'N' } });
    expect([count(S36, 'ru', 'ru.628'), count(S36, 'ru', 'ru.447'), count(S36, 'ru', 'ru.L81'), count(S36, 'ru', 'ru.T3485'), count(S36, 'ru', 'ru.IS2'), count(S36, 'ru')]).toEqual([4, 8, 2, 4, 1, 21]);
    expect(sws(S36, 'ru')).toEqual(['ru.DC', 'ru.LMG', 'ru.LMG', 'ru.LMG', 'ru.MMG']);
    expect(force(S36, 'ru').setup).toMatchObject({ kind: 'enter', turn: 1, edge: 'S', mpSpent: 'half' });
    const table = S36.ssr.find((r) => r.module === 'reinforcement-table')!.params as { rows: { dr: number[]; units: { def: string; count: number }[] }[] };
    expect(table.rows.map((r) => r.units.map((u) => `${u.count}×${u.def}`).join('+'))).toEqual(['2×ge.pzivh+1×ge.stgiiig', '2×ge.pzivf2+2×ge.pzivh', '2×ge.pzivj+1×ge.pzivf2']);
  });

  it('SSR 1: the Russian length is chosen before setup and revealed after the German setup', () => {
    const { engine, state } = newGame(S36, 's36', { los: 'grid' });
    expect(engine.currentDecision(state)).toMatchObject({ kind: 'secretLength', owner: 'ru' });
    const g = revealed(0);
    const env = engine.env(g.get());
    expect(gameTurns(env)).toEqual({ turns: 5, halfFinalTurn: true });
    const gone = Object.values(g.get().pieces).filter((p) => p.side === 'ru' && p.loc.kind === 'eliminated').map((p) => p.defId).sort();
    expect(gone.filter((d) => !d.includes('.', 3))).toEqual(['ru.628', 'ru.628', 'ru.DC', 'ru.IS2', 'ru.L81', 'ru.MMG', 'ru.T3485']);
    expect(inPlay(env, 'vM4')).toBe(true);
    expect(inPlay(env, 'vM3')).toBe(false);
    expect(inPlay(env, 'tM5')).toBe(false);
    expect(gameTurns(engine.env(revealed(1).get()))).toEqual({ turns: 6, halfFinalTurn: true });
    const six = engine.env(revealed(2).get());
    expect(gameTurns(six)).toEqual({ turns: 7, halfFinalTurn: true });
    expect(inPlay(six, 'tM5')).toBe(true);
  });

  it('4.5 turns: the Russians enter along the south edge of v hexes numbered ≥ 4, never into the hexes out of play', () => {
    const g = revealed(0);
    const engine = g.engine;
    let d = engine.currentDecision(g.get())!;
    expect(d).toMatchObject({ kind: 'offboardSetup', owner: 'ru' });
    const [off] = engine.legalActions(g.get(), 'ru') as unknown as [{ placements: Record<string, string> }];
    expect(Object.values(off.placements).every((h) => h.endsWith('~'))).toBe(true);
    let s = g.step(off as never);
    // To the Russian MPh, then a squad steps in from its staging hex.
    for (let i = 0; i < 6 && s.phase !== 'MPh'; i++) s = g.step({ type: 'endPhase' });
    const sq = Object.values(s.pieces).find((p) => p.side === 'ru' && p.defId === 'ru.447' && p.loc.kind === 'offboard')!;
    s = g.step({ type: 'move.start', units: [sq.id] });
    d = engine.currentDecision(s)!;
    const legal = engine.legalActions(s, 'ru').filter((a) => a.type === 'move.step').map((a) => (a as unknown as { to: string }).to);
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.every((h) => S36_EDGE_45.includes(h) || h.endsWith('~'))).toBe(true);
    const into = legal.find((h) => !h.endsWith('~'))!;
    s = g.step({ type: 'move.step', to: into });
    const above = staticsForS20(S36, { los: 'grid' }).map.neighbors(into).find((n) => !S36_AREA_45.includes(n))!;
    d = engine.currentDecision(s)!;
    expect(engine.validate(s, { type: 'move.step', to: above, side: 'ru', decisionId: d.id } as never)).toMatch(/not in play/);
  });

  it('SSR 3: T-34/85 APCR depletion 6; VC: 20 exit VP north (T-34/85 7, IS-2 8, one less without a working MA); balance', () => {
    const statics = staticsForS20(S36, { los: 'grid' });
    const t34 = statics.counters['ru.T3485'] as VehicleDef;
    expect(t34.ma!.specialAmmo).toEqual(expect.arrayContaining([{ kind: 'APCR', steps: [{ n: 6 }] }]));
    expect(COUNTERS['ru.T3485']!.kind === 'vehicle' && (COUNTERS['ru.T3485'] as VehicleDef).ma!.specialAmmo![0]!.steps[0]!.n).toBe(5);
    const { engine, state } = newGame(S36, 's36vp', { los: 'grid' });
    const env = engine.env(state);
    const id = (def: string) => Object.values(state.pieces).find((p) => p.defId === def)!.id;
    expect([env.query('vp.exit', { unit: id('ru.T3485') }, 0), env.query('vp.exit', { unit: id('ru.IS2') }, 0), env.query('vp.exit', { unit: id('ru.628') }, 0)]).toEqual([7, 8, 2]);
    const malf = engine.env({ ...state, pieces: { ...state.pieces, [id('ru.IS2')]: { ...state.pieces[id('ru.IS2')]!, tags: { malf: true } } } });
    expect(malf.query('vp.exit', { unit: id('ru.IS2') }, 0)).toBe(7);
    expect(sws(applyBalanceS20(S36, ['ge']), 'ge').filter((w) => w === 'ge.PSK')).toHaveLength(2);
    expect(count(applyBalanceS20(S36, ['ru']), 'ru', 'ru.L92')).toBe(1);
  });
});

describe('LMA10 Putot-en-Bessin 2', () => {
  const game = (sc = LMA_10) => newGame(sc, 'lma10', { los: 'grid' });
  const force = (sc: typeof LMA_10, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof LMA_10, id: string) => force(sc, id).units.reduce((n, u) => n + u.count, 0);
  const sws = (sc: typeof LMA_10, id: string) => force(sc, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();
  /** The Germans placed by the default placement. */
  const afterGermanSetup = (sc = LMA_10) => {
    const { engine, state: s0 } = game(sc);
    const d = engine.currentDecision(s0)!;
    expect(d).toMatchObject({ kind: 'setup', owner: 'ge' });
    return { engine, state: engine.submit(s0, engine.legalActions(s0, 'ge')[0]!).state };
  };

  it('reads the card: board z I-GG upright, Germans set up first, Canadians move first, 5½ turns, the OB', () => {
    expect(LMA_10).toMatchObject({ product: 'lma', number: 'LMA10', turns: 6, halfFinalTurn: true, firstSide: 'br', month: 6, nationalityNames: { br: 'Canadian' } });
    expect(LMA_10.boards).toEqual([{ board: 'z', position: '0,0', columns: ['I', 'GG'] }]);
    expect(LMA_10.compass).toBeUndefined();
    expect(LMA_10.sides.map((s) => [s.side, s.elr, !!s.setupFirst])).toEqual([['ge', 4, true], ['br', 3, false]]);
    expect([count(LMA_10, 'ge'), count(LMA_10, 'br'), count(LMA_10, 'hussars')]).toEqual([4 + 3 + 2 + 3 + 1 + 2, 5 + 3 + 6 + 2 + 2, 1]);
    expect(sws(LMA_10, 'ge')).toEqual(['ge.LMG', 'ge.LMG', 'ge.MMG', 'ge.MMG']);
    expect(sws(LMA_10, 'br')).toEqual(['br.LMG', 'br.LMG', 'br.LMG', 'br.LMG', 'br.MMG']);
    expect(force(LMA_10, 'br').setup).toMatchObject({ kind: 'enter', turn: 1, edge: 'S' });
    expect(force(LMA_10, 'hussars').setup).toMatchObject({ kind: 'enter', turn: 1, edge: 'S' });
    expect(rulesetFor(LMA_10).modules.map((m) => m.id)).toEqual(expect.arrayContaining(['sk3.panzerfaust', 'ssr.smoke-exponent', 'ssr.broken-morale', 'ssr.setup-rule']));
    const map = (game().engine.statics as Statics).map;
    expect(map.edge('S')).toEqual(expect.arrayContaining(['zI10', 'zGG10']));
    expect(map.hex('zH5')).toBeUndefined();
  });

  it('SSR 2: the Germans set up ≤ 3 hexes from buildings K9, S5 and Z3, within hexrows I-GG', () => {
    expect(LMA10_BUILDINGS).toEqual([buildingAt('z', 'zK9'), buildingAt('z', 'zS5'), buildingAt('z', 'zZ3')]);
    // K9 is the building zJ8-zK9-zL8: 3 hexes from J8 reaches hexrow I (G and H are out of play).
    expect(LMA10_GE_SETUP).toEqual(expect.arrayContaining(['zJ8', 'zK9', 'zL8', 'zI6', 'zI10', 'zO9', 'zS5', 'zS8', 'zP3', 'zV3', 'zZ3', 'zZ0', 'zCC2', 'zW2']));
    for (const h of ['zH8', 'zG9', 'zP9', 'zS9', 'zDD3', 'zZ7', 'zM3']) expect(LMA10_GE_SETUP, h).not.toContain(h);
    const { state } = afterGermanSetup();
    for (const p of Object.values(state.pieces)) if (p.side === 'ge' && p.loc.kind === 'hex') expect(LMA10_GE_SETUP).toContain(p.loc.hex);
  });

  it('VC: the Canadians Control 2 of the 3 buildings at game end', () => {
    expect(LMA_10.victory).toEqual([{ kind: 'controlBuildings', side: 'br', buildings: LMA10_BUILDINGS, atLeast: 2 }]);
  });

  it('SSR 1, 3 and 4: Canadian Smoke exponent +1, German Elite broken morale +1, 5 Panzerfaust shots', () => {
    const { engine, state } = afterGermanSetup();
    const env = engine.env(state);
    const piece = (def: string) => Object.values(state.pieces).find((p) => p.defId === def)!;
    expect(env.query('unit.smoke', { unit: piece('br.458').id }, 2)).toBe(3);
    expect(env.query('unit.smoke', { unit: piece('br.457').id }, 2)).toBe(3);
    expect(env.query('unit.smoke', { unit: piece('ge.548').id }, 2)).toBe(2);
    const broken = (id: string) => ({ ...state, pieces: { ...state.pieces, [id]: { ...state.pieces[id]!, tags: { ...state.pieces[id]!.tags, broken: true } } } });
    for (const def of ['ge.548', 'ge.468', 'ge.238h', 'ge.248h']) {
      const p = piece(def);
      const printed = (COUNTERS[def] as { brokenMorale: number }).brokenMorale;
      expect(engine.env(broken(p.id)).query('unit.morale', { unit: p.id }, 0), def).toBe(printed + 1);
    }
    const br = piece('br.458');
    expect(engine.env(broken(br.id)).query('unit.morale', { unit: br.id }, 0)).toBe(8);
    // 7 German squads would give 10 PF shots in 1944; the SSR makes it 5. Range 2 in June 1944.
    expect(pfCap(env, 'ge')).toBe(5);
    expect(pfCap(env, 'br')).toBeNull();
    expect(pfMaxRange(env)).toBe(2);
  });

  it('balance: the German 9-2 becomes an 8-1, or one Canadian LMG fewer', () => {
    const br = applyBalanceS20(LMA_10, ['br']);
    expect(force(br, 'ge').units.some((u) => u.def === 'ge.L92')).toBe(false);
    expect(force(br, 'ge').units.find((u) => u.def === 'ge.L81')?.count).toBe(1);
    const ge = applyBalanceS20(LMA_10, ['ge']);
    expect(sws(ge, 'br')).toEqual(['br.LMG', 'br.LMG', 'br.LMG', 'br.MMG']);
  });
});

describe('LMA8 Brassard 3: Porto Ferraio', () => {
  const L8 = LMA_8;
  const force = (sc: typeof L8, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof L8, id: string, def?: string) => force(sc, id).units.filter((u) => !def || u.def === def).reduce((n, u) => n + u.count, 0);
  const sws = (sc: typeof L8, id: string) => force(sc, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();
  const game = (sc = L8) => newGame(sc, 'lma8', { los: 'grid' });

  it('is playable on boards Z (north) and W (south), both turned; the Germans set up first, the Free French move first, 7½ turns', () => {
    expect(ALL_SCENARIOS.find((s) => s.id === 'lma-8')).toBe(L8);
    expect(L8).toMatchObject({ product: 'lma', number: 'LMA8', turns: 8, halfFinalTurn: true, firstSide: 'br', month: 6, nationalityNames: { br: 'Free French' } });
    expect(rulesetFor(L8).id).toBe('asl-sk3');
    expect(L8.sides).toEqual([
      { side: 'ge', name: 'German', nationality: 'ge', nationalities: ['ge', 'it'], elr: 3, elrs: { it: 2 }, setupFirst: true },
      { side: 'br', name: 'Free French', nationality: 'br', nationalities: ['br', 'am'], elr: 4 },
    ]);
    const map = staticsForS20(L8, { los: 'grid' }).map;
    // Board W's row 1 is the card's south edge; board Z's row 10 its north edge; they meet at W10 / Z1.
    expect(map.edge('S')).toEqual(expect.arrayContaining(['wA1', 'wQ1', 'wGG1']));
    expect(map.edge('N')).toEqual(expect.arrayContaining(['zA10', 'zGG10']));
    expect(map.hex('wB10')?.id).toBe('zB0');
    expect(LMA8_GE_SETUP).toEqual(expect.arrayContaining(['wA1', 'zZ5', 'zGG10']));
    expect(LMA8_GE_SETUP).toHaveLength([...map.hexes()].length);
  });

  it('fields the card’s order of battle', () => {
    expect([count(L8, 'br-4e', 'br.458'), count(L8, 'br-4e', 'br.457'), count(L8, 'br-4e', 'br.248h'), count(L8, 'br-4e', 'br.L92'), count(L8, 'br-4e', 'br.L80')]).toEqual([2, 5, 3, 1, 1]);
    expect(sws(L8, 'br-4e')).toEqual(['am.DC', 'am.DC', 'am.FT', 'am.MMG']);
    expect(force(L8, 'br-4e').setup).toEqual({ kind: 'enter', turn: 1, edge: 'S', hexes: LMA8_ENTRY_4E, description: expect.any(String) });
    expect(LMA8_ENTRY_4E).toEqual(expect.arrayContaining(['wA1', 'wB0', 'wQ1']));
    expect(LMA8_ENTRY_4E).not.toContain('wR0');
    expect([count(L8, 'br-13e', 'br.458'), count(L8, 'br-13e', 'br.457'), count(L8, 'br-13e', 'br.247h'), count(L8, 'br-13e', 'br.L91'), count(L8, 'br-13e', 'br.L81')]).toEqual([3, 4, 4, 1, 1]);
    expect(sws(L8, 'br-13e')).toEqual(['am.MMG', 'am.MTR']);
    expect(LMA8_ENTRY_13E).toEqual(expect.arrayContaining(['wQ1', 'wGG1']));
    expect(LMA8_ENTRY_13E).not.toContain('wP0');
    expect(force(L8, 'br-t2').units).toEqual([{ def: 'br.248h', count: 1, withSw: ['am.MMG'] }, { def: 'br.daimac', count: 1 }]);
    expect(force(L8, 'br-t2').setup).toMatchObject({ kind: 'enter', turn: 2, edge: 'S' });
    expect(COUNTERS['br.daimac']).toMatchObject({ kind: 'vehicle', mp: 33, ma: { caliber: 40, barrel: 'L' } });
    expect([count(L8, 'ge', 'ge.467'), count(L8, 'ge', 'ge.447'), count(L8, 'ge', 'ge.L91'), count(L8, 'ge', 'ge.L80')]).toEqual([5, 4, 1, 1]);
    expect(sws(L8, 'ge')).toEqual(['ge.LMG', 'ge.MMG', 'ge.MMG', 'ge.MTR']);
    expect([count(L8, 'ge-t3', 'ge.467'), count(L8, 'ge-t3', 'ge.447'), count(L8, 'ge-t3', 'ge.L81')]).toEqual([2, 2, 1]);
    expect(sws(L8, 'ge-t3')).toEqual(['ge.LMG', 'ge.LMG']);
    expect(force(L8, 'ge-t3').setup).toMatchObject({ kind: 'enter', turn: 3, edge: 'N' });
    expect(force(L8, 'it').units).toEqual([{ def: 'it.336', count: 1 }, { def: 'it.126h', count: 1 }]);
    expect(force(L8, 'it').setup).toMatchObject({ kind: 'enter', turn: 4, edge: 'N' });
  });

  it('German setup anywhere is legal; VC: control of buildings zZ5, zR3 and zM8', () => {
    expect(LMA8_BUILDINGS).toEqual(['zZ5', 'zR3', 'zM8'].map((h) => buildingAt('z', h)));
    expect(L8.victory).toEqual([{ kind: 'controlBuildings', side: 'br', buildings: LMA8_BUILDINGS, atLeast: 3 }]);
    const { engine, state } = game();
    const d = engine.currentDecision(state)!;
    expect(d).toMatchObject({ kind: 'setup', owner: 'ge' });
    const [auto] = engine.legalActions(state, 'ge') as unknown as [{ placements: Record<string, string> }];
    expect(placementIllegal(engine.env(state), 'ge', piecesToPlace(engine.env(state), d), auto.placements)).toBeNull();
  });

  it('SSR 1-3: no German PF despite the date and the Daimler; French 4-5-8/4-5-7 Assault Fire; American SW not captured', () => {
    expect(needsPanzerfaust(L8)).toBe(false);
    expect(needsPanzerfaust({ ...L8, ssr: L8.ssr.filter((s) => s.module !== 'no-panzerfaust') })).toBe(true);
    expect(rulesetFor(L8).modules.map((m) => m.id)).not.toContain('sk3.panzerfaust');
    const { engine, state } = game();
    const env = engine.env(state);
    expect(pfCap(env, 'ge')).toBeNull();
    const piece = (def: string) => Object.values(state.pieces).find((p) => p.defId === def)!;
    expect(env.query('unit.assaultFire', { unit: piece('br.458').id }, false)).toBe(true);
    expect(env.query('unit.assaultFire', { unit: piece('br.457').id }, false)).toBe(true);
    expect(env.query('unit.assaultFire', { unit: piece('br.247h').id }, false)).toBe(false);
    for (const w of ['am.MMG', 'am.FT', 'am.DC', 'am.MTR']) expect(isCaptured(env, piece(w)), w).toBe(false);
  });

  it('SSR 4: the Italian militia have ELR 2 and rally only by self-rally; balance', () => {
    const { engine, state } = game();
    const env = engine.env(state);
    const it336 = Object.values(state.pieces).find((p) => p.defId === 'it.336')!;
    const leader = Object.values(state.pieces).find((p) => p.defId === 'ge.L91')!;
    const ge467 = Object.values(state.pieces).find((p) => p.defId === 'ge.467')!;
    expect(env.query('rally.byLeaderIllegal', { leader: leader.id, unit: it336.id }, null)).toMatch(/self-rally \(SSR 4\)/);
    expect(env.query('rally.byLeaderIllegal', { leader: leader.id, unit: ge467.id }, null)).toBeNull();
    const br = applyBalanceS20(L8, ['br']);
    expect([br.turns, br.halfFinalTurn]).toEqual([9, true]);
    expect(count(applyBalanceS20(L8, ['ge']), 'ge-t3', 'ge.467')).toBe(3);
  });
});

describe('LMA6 Brassard 1: Marciana Marina', () => {
  const force = (sc: typeof LMA_6, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof LMA_6, id: string, def?: string) => force(sc, id).units.filter((u) => !def || u.def === def).reduce((n, u) => n + u.count, 0);
  const sws = (id: string) => force(LMA_6, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();
  const game = (sc = LMA_6) => newGame(sc, 'lma6', { los: 'grid' });
  /** Default placements and the end of every phase, until `pred` holds. */
  const stepUntil = (engine: ReturnType<typeof game>['engine'], s0: GameState, pred: (s: GameState) => boolean) => {
    let state = s0;
    for (let n = 0; n < 500 && !pred(state); n++) {
      const d = engine.currentDecision(state)!;
      const legal = engine.legalActions(state, d.owner);
      state = engine.submit(state, legal.find((a) => a.type === 'endPhase' || a.type === 'defPass') ?? legal[0]!).state;
    }
    expect(pred(state)).toBe(true);
    return state;
  };
  const frenchRph = (s: GameState) => s.turn === 1 && s.attacker === 'br' && s.phase === 'RPh';
  const forceIdx = (id: string) => LMA_6.forces.findIndex((f) => f.id === id);

  it('reads the card: V turned west of U upright, hexrows A of both boards meeting, the Germans set up first, the French move first, 5½ turns', () => {
    expect(LMA_6).toMatchObject({ turns: 6, halfFinalTurn: true, firstSide: 'br', month: 6, designer: 'Laurent Martin', product: 'lma', number: 'LMA6' });
    expect(LMA_6.sides.map((s) => [s.side, s.elr, !!s.setupFirst])).toEqual([['ge', 3, true], ['br', 5, false]]);
    expect([count(LMA_6, 'ge'), count(LMA_6, 'ge-t2'), count(LMA_6, 'ge-t3'), count(LMA_6, 'frA'), count(LMA_6, 'frB')]).toEqual([6, 3, 4, 11, 8]);
    expect(sws('ge')).toEqual(['ge.LMG', 'ge.LMG', 'ge.MMG']);
    expect(sws('ge-t2')).toEqual(['ge.LMG']);
    expect(sws('ge-t3')).toEqual(['ge.LMG', 'ge.MTR']);
    expect(sws('frA')).toEqual(['am.DC', 'am.MMG', 'am.MMG']);
    expect(sws('frB')).toEqual(['am.DC', 'am.MMG']);
    const map = staticsForS20(LMA_6, { los: 'grid' }).map;
    // Board V turned: its A6 is board U's A5, and its hexrow 1 lies on the south edge.
    expect(map.hex('vA6')!.id).toBe('uA5');
    expect(map.hex('vQ5')).toBeUndefined();
    expect(map.edge('S')).toEqual(expect.arrayContaining(['vG1', 'vP0', 'uW10', 'uGG10']));
    expect(map.edge('N')).toEqual(expect.arrayContaining(['uI1', 'uJ0', 'uK1', 'vG10']));
    const enter = (id: string) => force(LMA_6, id).setup as { hexes: string[]; edge: string };
    expect(enter('frA').hexes).toEqual(['uW10', 'uX10', 'uY10', 'uZ10', 'uAA10', 'uBB10', 'uCC10', 'uDD10', 'uEE10', 'uFF10', 'uGG10']);
    expect(enter('frB').hexes[0]).toBe('vG1');
    expect(enter('frB').hexes.at(-1)).toBe('vP0');
    expect(enter('ge-t2').hexes).toEqual(['uI1', 'uJ0', 'uK1']);
    expect(enter('ge-t3').hexes).toEqual(['uI1', 'uJ0', 'uK1', 'uL0', 'uM1', 'uN0', 'uO1']);
    expect(force(LMA_6, 'ge').setup).toMatchObject({ kind: 'area', maxMmcPerHex: 1 });
    expect((force(LMA_6, 'ge').setup as { hexes: string[] }).hexes).toHaveLength(91);
    expect(rulesetFor(LMA_6).modules.map((m) => m.id)).toEqual(expect.arrayContaining(['ssr.entry-order-dr', 'ssr.entry-losses', 'ssr.assault-fire', 'ssr.smoke-exponent']));
  });

  it('SSR 3 and 4: French squads have Assault Fire, the 4-5-8 Smoke exponent is 3, the American SW are their own', () => {
    const { engine, state } = game();
    const env = engine.env(state);
    const of = (def: string) => Object.values(state.pieces).find((p) => p.defId === def)!.id;
    expect(env.query('unit.assaultFire', { unit: of('br.458') }, false)).toBe(true);
    expect(env.query('unit.smoke', { unit: of('br.458') }, 0)).toBe(3);
    expect(env.query('unit.assaultFire', { unit: of('ge.467') }, false)).toBe(false);
    expect(isCaptured(env, state.pieces[of('am.MMG')]!)).toBe(false);
  });

  it('SSR 1 and 2: the French turn 1 RPh dr sets the order of entry, and each group rolls its losses as it arrives', () => {
    const { engine, state: s0 } = game();
    expect(entryOrderDrPending(engine.env(s0)).sort()).toEqual(['frA', 'frB']);
    // dr 5: Group B on Turn 1, Group A on Turn 2; Group B's losses dr 5 → 3 of its 4-5-8s become 4-5-7s.
    engine.forceDice(5, 5);
    const s = stepUntil(engine, s0, frenchRph);
    expect(entryOrderDrPending(engine.env(s))).toEqual([]);
    const of = (st: GameState, id: string) => Object.values(st.pieces).filter((p) => p.tags['force'] === forceIdx(id));
    expect(new Set(of(s, 'frA').map((p) => p.tags['entryTurn']))).toEqual(new Set([2]));
    expect(new Set(of(s, 'frB').map((p) => p.tags['entryTurn']))).toEqual(new Set([1]));
    expect(of(s, 'frB').filter((p) => p.defId === 'br.457')).toHaveLength(3);
    expect(of(s, 'frA').filter((p) => p.defId === 'br.457')).toHaveLength(0);
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'offboardSetup', owner: 'br' });
    // Group A rolls when it arrives on Turn 2: dr 1 → one 4-5-7.
    const s1 = stepUntil(engine, s, (x) => x.turn === 1 && x.attacker === 'ge' && x.phase === 'APh');
    engine.forceDice(1);
    const s2 = stepUntil(engine, s1, (x) => x.turn === 2 && x.attacker === 'br' && x.phase === 'RPh');
    expect(of(s2, 'frA').filter((p) => p.defId === 'br.457')).toHaveLength(1);
    expect(of(s2, 'frA').filter((p) => p.defId === 'br.458')).toHaveLength(8);
  });

  it('balance: the French spare Group B its losses; the Germans get a third 4-6-7 on Turn 2', () => {
    expect(entryLossesCount({ divisor: 2, round: 'up' }, 1)).toBe(1);
    expect(entryLossesCount({ divisor: 2, round: 'up' }, 6)).toBe(3);
    const fr = applyBalanceS20(LMA_6, ['br']);
    expect(fr.ssr[1]!.params).toMatchObject({ forces: ['frA'] });
    const { engine, state: s0 } = game(fr);
    // dr 6: Group B first, no losses roll for it.
    engine.forceDice(6);
    const s = stepUntil(engine, s0, frenchRph);
    expect(Object.values(s.pieces).filter((p) => p.tags['force'] === forceIdx('frB') && p.tags['entryTurn'] === 1)).toHaveLength(8);
    expect(Object.values(s.pieces).filter((p) => p.defId === 'br.457')).toHaveLength(0);
    expect(count(applyBalanceS20(LMA_6, ['ge']), 'ge-t2', 'ge.467')).toBe(3);
  });

  it('VC: no Good Order German unit in the building hexes of board U hexrows I-P', () => {
    expect(LMA6_VC_HEXES).toHaveLength(27);
    expect(LMA6_VC_HEXES.every((h) => /^u[I-P]\d+$/.test(h))).toBe(true);
    expect(LMA_6.victory).toEqual([{ kind: 'noGoodOrderEnemyIn', side: 'br', hexes: LMA6_VC_HEXES, hexesLabel: 'buildings of hexrows I to P of board U' }]);
    const { engine, state: s } = game();
    const ge = Object.values(s.pieces).find((p) => p.side === 'ge' && p.defId === 'ge.467')!;
    const out = Object.fromEntries(Object.entries(s.pieces).map(([id, p]) => [id, p.side === 'ge' && p.loc.kind !== 'held' ? { ...p, loc: { kind: 'eliminated' as const } } : p]));
    expect(evaluateVictoryS20(engine.env({ ...s, pieces: out }))).toBe('br');
    const held = { ...out, [ge.id]: { ...ge, loc: { kind: 'hex' as const, hex: LMA6_VC_HEXES[0]! } } };
    expect(evaluateVictoryS20(engine.env({ ...s, pieces: held }))).toBe('ge');
  });
});

describe('LMA2 Frères d’arme 2: Carentan', () => {
  const LMA2 = ALL_SCENARIOS.find((s) => s.id === 'lma-2')!;
  const force = (sc: typeof LMA2, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof LMA2, id: string, def?: string) => force(sc, id).units.filter((u) => !def || u.def === def).reduce((n, u) => n + u.count, 0);
  const sws = (sc: typeof LMA2, id: string) => force(sc, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();
  type Act = Record<string, unknown>;
  /** A game through the German setup (the engine's default placement). */
  const afterGermanSetup = (seed = 'lma2') => {
    const { engine, state: s0 } = newGame(LMA2, seed, { los: 'grid' });
    let state = s0;
    const step = (a: Act) => {
      const d = engine.currentDecision(state)!;
      state = engine.submit(state, { ...a, side: d.owner, decisionId: d.id } as never).state;
      return state;
    };
    const [auto] = engine.legalActions(state, 'ge') as unknown as [Act];
    step(auto);
    return { engine, step, get: () => state };
  };

  it('is playable on board z (I-Y) upright with north to the right; the Germans set up first, the Americans move first, 5½ turns', () => {
    expect(LMA2).toMatchObject({ product: 'lma', number: 'LMA2', turns: 6, halfFinalTurn: true, firstSide: 'am', month: 6 });
    expect(LMA2.status).toBeUndefined();
    expect(rulesetFor(LMA2).id).toBe('asl-sk2');
    const map = staticsForS20(LMA2, { los: 'grid' }).map;
    expect(map.hex('zH5')).toBeUndefined();
    expect(map.hex('zZ5')).toBeUndefined();
    // The card's east edge is the board's row 10, its west edge row 1.
    expect(map.edge('E')).toEqual(expect.arrayContaining(['zI10', 'zQ10', 'zY10']));
    expect(map.edge('W')).toEqual(expect.arrayContaining(['zI1', 'zY1']));
    expect(map.edge('N')).toContain('zY5');
  });

  it('fields the card’s order of battle', () => {
    expect([count(LMA2, 'ge', 'ge.238h'), count(LMA2, 'ge', 'ge.L80'), count(LMA2, 'ge-gun', 'ge.228c')]).toEqual([6, 1, 1]);
    expect([...sws(LMA2, 'ge'), ...sws(LMA2, 'ge-gun')]).toEqual(['ge.MMG', 'ge.MMG', 'ge.AT50L']);
    expect([count(LMA2, 'ge-t2', 'ge.548'), count(LMA2, 'ge-t2', 'ge.L81')]).toEqual([4, 1]);
    expect(sws(LMA2, 'ge-t2')).toEqual(['ge.LMG', 'ge.LMG']);
    expect(force(LMA2, 'ge-t2').setup).toMatchObject({ kind: 'enter', turn: 2, edge: 'W' });
    expect([count(LMA2, 'am', 'am.747'), count(LMA2, 'am', 'am.L91'), count(LMA2, 'am', 'am.L81')]).toEqual([9, 1, 1]);
    expect(sws(LMA2, 'am')).toEqual(['am.BAZ44', 'am.DC', 'am.DC']);
    expect(LMA2.sides.map((s) => [s.side, s.elr])).toEqual([['ge', 3], ['am', 5]]);
  });

  it('SSR 1: the HS at least 3 hexes apart; the AT Gun HIP in a single-hex building hex', () => {
    expect(LMA2_SINGLE_HEX_BUILDINGS).toEqual(expect.arrayContaining(['zP5', 'zR5', 'zP3', 'zI3', 'zX8']));
    // R3 is part of the R1-R3/S3 building; L6 of the L5-M7 building.
    expect(LMA2_SINGLE_HEX_BUILDINGS).not.toContain('zR3');
    expect(LMA2_SINGLE_HEX_BUILDINGS).not.toContain('zL6');
    expect(LMA2_SINGLE_HEX_BUILDINGS).not.toContain('zQ4');
    const { engine, state } = newGame(LMA2, 'lma2-ssr', { los: 'grid' });
    const d = engine.currentDecision(state)!;
    expect(d).toMatchObject({ kind: 'setup', owner: 'ge' });
    const [auto] = engine.legalActions(state, 'ge') as unknown as [{ placements: Record<string, string>; guns: Record<string, { ca: number; hip?: boolean }> }];
    const gun = Object.values(state.pieces).find((p) => p.defId === 'ge.AT50L')!.id;
    expect(auto.guns[gun]).toMatchObject({ hip: true });
    const submit = (a: object) => engine.validate(state, { ...a, side: 'ge', decisionId: d.id } as never);
    expect(submit(auto)).toBeNull();
    expect(submit({ ...auto, guns: { [gun]: { ca: 0 } } })).toMatch(/must set up hidden/);
    const hs = Object.values(state.pieces).filter((p) => p.defId === 'ge.238h').map((p) => p.id);
    const [a, b] = [auto.placements[hs[0]!]!, auto.placements[hs[1]!]!];
    expect(staticsForS20(LMA2, { los: 'grid' }).map.distance(a, b)).toBeGreaterThanOrEqual(3);
    expect(submit({ ...auto, placements: { ...auto.placements, [hs[1]!]: a } })).toMatch(/at least 3 hexes apart|may not share/);
    const crew = Object.values(state.pieces).find((p) => p.defId === 'ge.228c')!.id;
    expect(submit({ ...auto, placements: { ...auto.placements, [crew]: 'zR3' } })).not.toBeNull();
    const after = engine.submit(state, { ...auto, side: 'ge', decisionId: d.id } as never).state;
    expect(isHiddenLma2(after.pieces[gun]!)).toBe(true);
  });

  it('the Americans pick one entry stretch of the east edge after the German setup, and enter only through it', () => {
    const g = afterGermanSetup();
    expect(g.engine.currentDecision(g.get())).toMatchObject({ kind: 'entryStretch', owner: 'am' });
    expect(LMA2_ENTRY_IQ).toEqual(['zI10', 'zJ10', 'zK10', 'zL10', 'zM10', 'zN10', 'zO10', 'zP10', 'zQ10']);
    expect(LMA2_ENTRY_QY[0]).toBe('zQ10');
    let s = g.step({ type: 'entryStretch.choose', option: 1 });
    expect(entryStretchState(g.engine.env(s))).toEqual({ side: 'am', option: 1 });
    expect(s.turn).toBe(1);
    expect(g.engine.currentDecision(s)).toMatchObject({ kind: 'offboardSetup', owner: 'am' });
    const [off] = g.engine.legalActions(s, 'am') as unknown as [Act];
    s = g.step(off);
    for (let i = 0; i < 6 && s.phase !== 'MPh'; i++) s = g.step({ type: 'endPhase' });
    const sq = Object.values(s.pieces).find((p) => p.side === 'am' && p.defId === 'am.747' && p.loc.kind === 'offboard')!;
    s = g.step({ type: 'move.start', units: [sq.id] });
    const into = new Set<string>();
    const lmaMap = staticsForS20(LMA2, { los: 'grid' }).map;
    // Every hex of the edge the squad could come on by, from anywhere along the offboard edge.
    const walk = (st: typeof s, seen: Set<string>, depth: number) => {
      for (const a of g.engine.legalActions(st, 'am').filter((x) => x.type === 'move.step') as unknown as { to: string }[]) {
        if (lmaMap.hex(a.to)) into.add(a.to);
        else if (depth > 0 && !seen.has(a.to)) {
          seen.add(a.to);
          const d = g.engine.currentDecision(st)!;
          walk(g.engine.submit(st, { type: 'move.step', to: a.to, side: 'am', decisionId: d.id } as never).state, seen, depth - 1);
        }
      }
    };
    walk(s, new Set(), 3);
    expect(into.size).toBeGreaterThan(0);
    expect([...into].filter((h) => !LMA2_ENTRY_QY.includes(h))).toEqual([]);
    expect(into.size).toBeGreaterThan(1);
    // The other stretch's entry hexes are refused.
    const d = g.engine.currentDecision(s)!;
    expect(g.engine.validate(s, { type: 'move.step', to: 'zK10', side: 'am', decisionId: d.id } as never)).not.toBeNull();
    // Offboard setup only beside the chosen stretch.
    expect(Object.values((off as { placements: Record<string, string> }).placements).every((h) => staticsForS20(LMA2, { los: 'grid' }).map.offboardNeighbors(h).onboard.some((n) => LMA2_ENTRY_QY.includes(n)))).toBe(true);
  });

  it('VC: the Americans Control P5, R5, P3 and R3 at game end (the card’s French “contrôle”); balance', () => {
    expect(LMA2_VC_HEXES).toEqual(['zP5', 'zR5', 'zP3', 'zR3']);
    expect(LMA2.victory).toEqual([{ kind: 'controlHexes', side: 'am', hexes: LMA2_VC_HEXES, atLeast: 4, hexesLabel: 'P5, R5, P3, R3' }]);
    expect(count(applyBalanceS20(LMA2, ['ge']), 'ge-t2', 'ge.548')).toBe(5);
    expect(applyBalanceS20(LMA2, ['am'])).toMatchObject({ turns: 7, halfFinalTurn: true });
  });
});

describe('LMA9 Putot-en-Bessin 1', () => {
  const force = (sc: typeof LMA_9, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof LMA_9, id: string, def?: string) => force(sc, id).units.filter((u) => !def || u.def === def).reduce((n, u) => n + u.count, 0);
  const sws = (sc: typeof LMA_9, id: string) => force(sc, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();
  const game = (sc = LMA_9) => newGame(sc, 'lma9', { los: 'grid' });

  it('is playable on board z, hexrows I-GG, upright; the Canadian sets up first, the German moves first, 7 turns', () => {
    expect(ALL_SCENARIOS.find((s) => s.id === 'lma-9')).toBe(LMA_9);
    expect(LMA_9).toMatchObject({ product: 'lma', number: 'LMA9', turns: 7, halfFinalTurn: false, firstSide: 'ge', month: 6 });
    expect(LMA_9.compass).toBeUndefined();
    expect(rulesetFor(LMA_9).id).toBe('asl-sk2');
    const map = staticsForS20(LMA_9, { los: 'grid' }).map;
    expect(map.hex('zH5')).toBeUndefined();
    expect(map.hex('zI5')).toBeDefined();
    expect(map.edge('N')).toContain('zQ1');
  });

  it('fields the card’s order of battle', () => {
    expect([count(LMA_9, 'br', 'br.458'), count(LMA_9, 'br', 'br.457'), count(LMA_9, 'br', 'br.447'), count(LMA_9, 'br', 'br.L81'), count(LMA_9, 'br', 'br.L80'), count(LMA_9, 'br', 'br.L70')]).toEqual([6, 6, 4, 1, 2, 1]);
    expect(sws(LMA_9, 'br')).toEqual(['br.LMG', 'br.LMG', 'br.LMG', 'br.MMG', 'br.MMG', 'br.MTR', 'br.MTR']);
    expect([count(LMA_9, 'ge', 'ge.548'), count(LMA_9, 'ge', 'ge.468'), count(LMA_9, 'ge', 'ge.L92'), count(LMA_9, 'ge', 'ge.L91')]).toEqual([6, 6, 2, 1]);
    expect(sws(LMA_9, 'ge')).toEqual(['ge.LMG', 'ge.LMG', 'ge.LMG', 'ge.LMG', 'ge.MMG', 'ge.MMG']);
    expect(LMA_9.sides.map((s) => [s.side, s.elr])).toEqual([['br', 3], ['ge', 4]]);
  });

  it('setup: the German north of the road I5-Q1; the Canadian within 2 of K8, Q3 and W7, 4 MMC, 1 leader and 1 SW by each', () => {
    expect(LMA9_GE_SETUP).toEqual(expect.arrayContaining(['zI4', 'zJ3', 'zK3', 'zL2', 'zM2', 'zN1', 'zO1', 'zP0']));
    for (const h of ['zI5', 'zJ4', 'zK4', 'zL3', 'zM3', 'zN2', 'zO2', 'zP1', 'zQ1', 'zR1']) expect(LMA9_GE_SETUP).not.toContain(h);
    expect(LMA9_CA_SETUP).toEqual(expect.arrayContaining(['zK8', 'zI9', 'zQ1', 'zQ5', 'zW9', 'zY6']));
    expect(LMA9_CA_SETUP).not.toContain('zK5');
    expect(LMA_9.ssr[0]).toMatchObject({ module: 'setup-rule' });
    const { engine, state } = game();
    const d = engine.currentDecision(state)!;
    expect(d.owner).toBe('br');
    const env = engine.env(state);
    const todo = piecesToPlace(env, d);
    const [auto] = engine.legalActions(state, 'br') as unknown as [{ placements: Record<string, string> }];
    expect(placementIllegal(env, 'br', todo, auto.placements)).toBeNull();
    const progress = setupAnchorProgress(env, 'br', auto.placements);
    expect(progress.map((a) => a.anchor)).toEqual(LMA9_DEPLOYMENT);
    for (const a of progress) for (const c of a.counts) expect(c.have, `${a.anchor} ${c.label}`).toBeGreaterThanOrEqual(c.need);
    // Everything by K8 and Q3, nothing by W7: refused, naming the deployment hex short of units.
    const nearK8 = LMA9_CA_SETUP.filter((h) => /^z[I-M]\d/.test(h));
    const byW7 = Object.keys(auto.placements).filter((id) => /^z[U-Y]\d/.test(auto.placements[id]!));
    const packed = { ...auto.placements, ...Object.fromEntries(byW7.map((id, i) => [id, nearK8[nearK8.length - 1 - i]!])) };
    expect(placementIllegal(env, 'br', todo, packed)).toMatch(/within 2 hexes of W7/);
    // A partial setup is not judged on the minimums.
    expect(placementIllegal(env, 'br', todo, { [todo[0]!.id]: 'zK8' }, true)).toBeNull();
  });

  it('VC: the German Controls 2 of the buildings K9, S5, Z3 at game end', () => {
    expect(LMA9_VC_BUILDINGS).toEqual([buildingAt('z', 'zK9'), buildingAt('z', 'zS5'), buildingAt('z', 'zZ3')]);
    expect(LMA_9.victory).toEqual([{ kind: 'controlBuildings', side: 'ge', buildings: LMA9_VC_BUILDINGS, atLeast: 2 }]);
  });

  it('SSR 2: two 120mm mortar missions for the German; SSR 3: German Elite broken morale +1; balance', () => {
    const { engine, state } = game();
    const env = engine.env(state);
    expect(artilleryMissions(env, 'ge')).toMatchObject({ left: 2, total: 2, label: '120mm Mortar' });
    expect(artilleryMissions(env, 'br')).toBeNull();
    const id = (def: string) => Object.values(state.pieces).find((p) => p.defId === def)!.id;
    const broken = (u: string) => engine.env({ ...state, pieces: { ...state.pieces, [u]: { ...state.pieces[u]!, tags: { broken: true } } } }).query('unit.morale', { unit: u }, 0);
    expect(broken(id('ge.548'))).toBe(9);
    expect(broken(id('ge.468'))).toBe(9);
    expect(broken(id('br.457'))).toBe(7);
    expect(count(applyBalanceS20(LMA_9, ['br']), 'ge', 'ge.L92')).toBe(1);
    expect(count(applyBalanceS20(LMA_9, ['br']), 'ge', 'ge.L81')).toBe(1);
    expect(sws(applyBalanceS20(LMA_9, ['ge']), 'br').filter((w) => w === 'br.MMG')).toHaveLength(1);
  });
});

describe('LMA5 Frères d’arme 5: Foy', () => {
  const force = (sc: typeof LMA_5, id: string) => sc.forces.find((f) => f.id === id)!;
  const count = (sc: typeof LMA_5, id: string, def?: string) => force(sc, id).units.filter((u) => !def || u.def === def).reduce((n, u) => n + u.count, 0);
  const sws = (sc: typeof LMA_5, id: string) => force(sc, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();
  const game = (sc = LMA_5) => newGame(sc, 'lma5', { los: 'grid' });

  it('is playable on board y turned 180° with north to the right; the Germans set up first, the Americans move first, 6½ turns', () => {
    expect(LMA_5).toMatchObject({ product: 'lma', number: 'LMA5', turns: 6, halfFinalTurn: true, firstSide: 'am', month: 1, designer: 'Laurent Martin', weather: { sky: 'overcast', ground: 'snow' } });
    expect(LMA_5.sides.find((s) => s.side === 'ge')).toMatchObject({ elr: 3, setupFirst: true });
    expect(LMA_5.sides.find((s) => s.side === 'am')).toMatchObject({ elr: 5 });
    expect(ALL_SCENARIOS).toContain(LMA_5);
    expect(rulesetFor(LMA_5).id).toBe('asl-sk3');
    expect(rulesetFor(LMA_5).modules.map((m) => m.id)).toEqual(expect.arrayContaining(['ssr.setup-rule', 'ssr.entry-dr', 'ssr.roads-open-ground', 'ssr.range-hindrance', 'ssr.leader-relief']));
    const map = staticsForS20(LMA_5, { los: 'grid' }).map;
    // North is hexrow A, east the row 1 side (Item Company enters from the east between A1 and E1).
    expect(map.edge('N')).toContain('yA5');
    expect(map.edge('E')).toEqual(expect.arrayContaining(['yA1', 'yE1', 'yX0']));
    expect(map.edge('S')).toContain('yGG5');
  });

  it('fields the card’s order of battle', () => {
    expect([count(LMA_5, 'ge-uw', 'ge.467'), count(LMA_5, 'ge-village', 'ge.467'), count(LMA_5, 'ge-village')]).toEqual([3, 6, 9]);
    expect([...sws(LMA_5, 'ge-uw'), ...sws(LMA_5, 'ge-village')].sort()).toEqual(['ge.AA88L', 'ge.LMG', 'ge.LMG']);
    expect(sws(LMA_5, 'ge-uw')).toEqual(['ge.LMG']);
    expect(force(LMA_5, 'ge-village').units.filter((u) => u.def.startsWith('ge.L')).map((u) => u.def)).toEqual(['ge.L81', 'ge.L80']);
    expect(force(LMA_5, 'ge-pz').units).toEqual([{ def: 'ge.pzvie', count: 1 }, { def: 'ge.stgiiig', count: 1 }]);
    expect([count(LMA_5, 'am-easy', 'am.747'), count(LMA_5, 'am-easy')]).toEqual([9, 12]);
    expect(sws(LMA_5, 'am-easy')).toEqual(['am.BAZ45', 'am.MMG', 'am.MTR']);
    expect(force(LMA_5, 'am-easy').units.filter((u) => u.def.startsWith('am.L')).map((u) => u.def)).toEqual(['am.L91', 'am.L81', 'am.L61']);
    expect([count(LMA_5, 'am-item', 'am.747'), count(LMA_5, 'am-item')]).toEqual([6, 8]);
    expect(sws(LMA_5, 'am-item')).toEqual(['am.BAZ44', 'am.DC']);
    expect(force(LMA_5, 'am-speirs')).toMatchObject({ units: [{ def: 'am.L102', count: 1 }], setup: { kind: 'enter', edge: 'E', provisional: 'ssr' } });
    expect(force(LMA_5, 'am-item').setup).toMatchObject({ kind: 'enter', turn: 2, edge: 'E', provisional: { drAtMost: { 2: 3, 3: 6 } } });
    // The 88L's M# is red on the counter: a large target.
    expect(COUNTERS['ge.AA88L']).toMatchObject({ kind: 'gun', targetSize: 'large', m: 4, rof: 2, mount: '360' });
    expect(COUNTERS['ge.pzvie']).toMatchObject({ mp: 12, redMp: true, mg: { bmg: 3, cmg: 5 } });
  });

  it('SSR 1 and the setup areas; both sides’ default setup is legal', () => {
    expect(LMA5_UW_BUILDINGS).toEqual(['yU3', 'yU6', 'yV6', 'yW6']);
    expect(LMA5_VILLAGE).toHaveLength(63);
    expect(LMA5_VILLAGE).toEqual(expect.arrayContaining(['yI1', 'yN10', 'yL6']));
    expect(LMA5_PANZER_SETUP).toHaveLength(19);
    expect(LMA5_EASY_SETUP).toEqual(expect.arrayContaining(['yX0', 'yCC3', 'yAA1']));
    expect(LMA5_EASY_SETUP).not.toContain('yX4');
    expect(LMA5_ITEM_ENTRY).toEqual(['yA1', 'yB0', 'yC1', 'yD0', 'yE1']);
    expect(LMA5_SPEIRS_ENTRY).toEqual(['yX0', 'yY1', 'yZ0', 'yAA1', 'yBB0', 'yCC1']);
    let { engine, state } = game();
    for (const side of ['ge', 'am']) {
      const d = engine.currentDecision(state)!;
      expect(d).toMatchObject({ kind: 'setup', owner: side });
      const env = engine.env(state);
      const [auto] = engine.legalActions(state, side) as unknown as [{ placements: Record<string, string> }];
      expect(placementIllegal(env, side, piecesToPlace(env, d), auto.placements)).toBeNull();
      state = engine.submit(state, { ...auto, side, decisionId: d.id } as never).state;
    }
    for (const p of Object.values(state.pieces).filter((x) => x.side === 'ge' && x.tags['force'] === 0 && x.loc.kind === 'hex')) expect(LMA5_UW_BUILDINGS).toContain((p.loc as { hex: string }).hex);
    // Lt Speirs waits for SSR 4; he is not a unit the Americans have yet.
    const speirs = Object.values(state.pieces).find((p) => p.defId === 'am.L102')!;
    expect(speirs).toMatchObject({ loc: { kind: 'offboard', edge: 'E' }, tags: { entryRoll: 'ssr', entryTurn: 0 } });
  });

  it('VC: at the end of an American MPh, a unit of each company in one building having lost fewer MMC than the Germans', () => {
    expect(LMA_5.victory).toEqual([
      {
        kind: 'all',
        side: 'am',
        atEndOfPhase: 'MPh',
        of: [
          { kind: 'forcesInBuilding', side: 'am', groups: [{ forces: ['am-easy', 'am-speirs'], label: 'Easy Company' }, { forces: ['am-item'], label: 'Item Company' }] },
          { kind: 'fewerMmcLost', side: 'am' },
        ],
      },
    ]);
    const { engine, state } = game();
    const id = (def: string, fi: number) => Object.values(state.pieces).find((p) => p.defId === def && p.tags['force'] === fi)!.id;
    const easy = id('am.747', 3);
    const item = id('am.L80', 5);
    const speirs = id('am.L102', 4);
    const placed = (where: Record<string, string>, lost: { side: string; defId: string; kind?: string }[] = []) => ({
      ...state,
      turn: 3,
      pieces: Object.fromEntries(Object.entries(state.pieces).map(([k, p]) => [k, where[k] ? { ...p, loc: { kind: 'hex' as const, hex: where[k]! } } : p])),
      ext: { ...state.ext, 'sk1.casualties': lost.map((c, i) => ({ unit: `x${i}`, kind: 'eliminated', vp: 2, turn: 2, phase: 'PFPh', reason: 'test', ...c })) },
    });
    const at = (s: ReturnType<typeof placed>, attacker: string) => engine.env({ ...s, attacker });
    const won = (s: ReturnType<typeof placed>) => at(s, 'am').query('game.suddenDeath', { phase: 'MPh' }, null);
    const geLoss = [{ side: 'ge', defId: 'ge.467' }];
    const together = placed({ [easy]: 'yU3', [item]: 'yU3' }, geLoss);
    expect(won(together)).toBe('am');
    expect(at(together, 'am').query('game.suddenDeath', { phase: 'APh' }, null)).toBeNull();
    expect(at(together, 'ge').query('game.suddenDeath', { phase: 'MPh' }, null)).toBeNull();
    // Never judged at game end: the Germans win then.
    expect(evaluateVictory(at(together, 'ge'))).toBe('ge');
    // No MMC lost on either side is not "fewer"; a Casualty Reduction is no MMC lost.
    expect(won(placed({ [easy]: 'yU3', [item]: 'yU3' }))).toBeNull();
    const reduced = placed({ [easy]: 'yU3', [item]: 'yU3' }, [{ side: 'ge', defId: 'ge.467', kind: 'reduced' }]);
    expect(mmcLost(at(reduced, 'am'), 'ge')).toHaveLength(0);
    expect(won(placed({ [easy]: 'yU3', [item]: 'yU3' }, [...geLoss, { side: 'am', defId: 'am.747' }]))).toBeNull();
    // A leader lost is no MMC; units in different buildings do not count; Lt Speirs counts for Easy Company.
    expect(won(placed({ [easy]: 'yU3', [item]: 'yU3' }, [...geLoss, { side: 'am', defId: 'am.L81' }]))).toBe('am');
    expect(won(placed({ [easy]: 'yU3', [item]: 'yU6' }, geLoss))).toBeNull();
    expect(won(placed({ [speirs]: 'yW6', [item]: 'yW6' }, geLoss))).toBe('am');
    // Two Easy units are not a unit of each company; nor is a building hex shared with nobody.
    expect(won(placed({ [easy]: 'yV6', [speirs]: 'yV6' }, geLoss))).toBeNull();
    expect(won(placed({ [easy]: 'yU2', [item]: 'yU2' }, geLoss))).toBeNull();
  });

  it('SSR 3: no road movement rate; a +1/+2/+3 snow hindrance beyond 6/12/18 hexes that leaves FFMO and Residual FP alone', () => {
    const { engine, state } = game();
    const env = engine.env(state);
    expect(env.query('move.roadRate', {}, true)).toBe(false);
    const sq = Object.values(state.pieces).find((p) => p.defId === 'am.747')!.id;
    const part = (dist: number) => ({ piece: sq, firer: sq, kind: 'inherent', hex: 'yA1', range: 4, dist });
    const attack = (dists: number[], extra: Record<string, unknown> = {}) => ({ mode: 'prep', side: 'am', target: 'yM5', parts: dists.map(part), targets: [], hindrance: 0, ...extra }) as never;
    const drm = (dists: number[], extra?: Record<string, unknown>) => env.query('fire.drm', { attack: attack(dists, extra) }, 0);
    expect([drm([6]), drm([7]), drm([12]), drm([13]), drm([18]), drm([19]), drm([25])]).toEqual([0, 1, 1, 2, 2, 3, 3]);
    // A Fire Group: its farthest firer sets it.
    expect(drm([2, 14])).toBe(2);
    expect(drm([9], { residual: true })).toBe(0);
    // FFMO stands against a mover in the open (ASLRB E3.1: a LV Hindrance does not by itself negate it).
    const open = 'yM5';
    expect(staticsForS20(LMA_5, { los: 'grid' }).map.hex(open)?.terrain).toBe('open');
    // +1 snow, -1 FFNAM, -1 FFMO.
    expect(env.query('fire.drm', { attack: attack([9], { mode: 'defensiveFirst', moving: { assault: false, viaRoadIntoWoodsRoad: false } }) }, 0)).toBe(-1);
    // Vehicles pay the Open Ground rate along a road, also into a Woods-Road hex (a CE tank would pay ½ MP).
    const map = staticsForS20(LMA_5, { los: 'grid' }).map;
    const tiger = Object.values(state.pieces).find((p) => p.defId === 'ge.pzvie')!;
    const ce = { ...tiger, tags: { ...tiger.tags, ce: true } };
    const roadStep = (feature: string) => {
      for (const h of map.hexes()) for (const n of map.neighbors(h.id)) if (map.hex(n)?.features.includes(feature) && map.roadHexside?.(h.id, n)) return [h.id, n] as const;
      throw new Error(`no ${feature} step`);
    };
    const [a, b] = roadStep('road:dirt');
    expect(vehicleEntryCost(env, ce, a, b, { viaRoad: true })).toBe(1);
    const [c, w] = roadStep('woods-road');
    expect(vehicleEntryCost(env, ce, c, w, { viaRoad: true })).toBe(1);
  });

  it('balance: a 4-4-7 for the Germans; one more turn for the Americans', () => {
    expect(count(applyBalanceS20(LMA_5, ['ge']), 'ge-village', 'ge.447')).toBe(1);
    expect(applyBalanceS20(LMA_5, ['am'])).toMatchObject({ turns: 7, halfFinalTurn: true });
  });
});

// ------------------------------------------------------------------ LMA7

describe('LMA7 Brassard 2: Monte Costello', () => {
  const sc = LMA_7;
  const force = (s: typeof sc, id: string) => s.forces.find((f) => f.id === id)!;
  const count = (s: typeof sc, id: string, def?: string) => force(s, id).units.filter((u) => !def || u.def === def).reduce((n, u) => n + u.count, 0);
  const sws = (s: typeof sc, id: string) => force(s, id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();
  const WEAPONS = ['ge.LMG', 'ge.MMG', 'ge.MTR'];
  /** A game with a stepper that answers for whoever owns the decision. */
  const play = (seed: string, s: typeof sc = sc) => {
    const { engine, state: s0 } = newGame(s, seed, { los: 'grid' });
    let state = s0;
    const step = (a: Record<string, unknown>) => {
      const d = engine.currentDecision(state)!;
      state = engine.submit(state, { ...a, side: d.owner, decisionId: d.id } as never).state;
      return state;
    };
    const auto = (side: string, type: string) => engine.legalActions(state, side).find((a) => a.type === type)! as unknown as Record<string, unknown>;
    return { engine, step, auto, get: () => state };
  };

  it('is boards v (A-Q) and t (Q-GG), both turned, south their row 1; the Germans set up first, the French move first, 6½ turns', () => {
    expect(sc).toMatchObject({ product: 'lma', number: 'LMA7', turns: 7, halfFinalTurn: true, firstSide: 'br', month: 6 });
    expect(sc.sides.find((s) => s.side === 'ge')).toMatchObject({ elr: 3, setupFirst: true });
    expect(sc.sides.find((s) => s.side === 'br')).toMatchObject({ elr: 4, nationalities: ['br', 'am'] });
    expect(rulesetFor(sc).id).toBe('asl-sk2');
    const map = staticsForS20(sc, { los: 'grid' }).map;
    expect(map.edge('S')).toEqual(expect.arrayContaining(['vC1', 'tS1']));
    expect(map.edge('N')).toEqual(expect.arrayContaining(['vC10', 'tR10']));
    // v's hexrow A meets t's hexrow GG: the half hexes are v's.
    expect(map.hex('tGG5')?.id).toBe('vA5');
    expect(map.neighbors('vA5')).toEqual(expect.arrayContaining(['tFF5', 'vB5']));
  });

  it('VC: the four hills of each board (SSR 1 fields included), and the losses', () => {
    expect(LMA7_HILLS_V.map((h) => [h.label, h.hexes.length])).toEqual([['hill vC3', 12], ['hill vI4', 14], ['hill vH7', 11], ['hill vO5', 16]]);
    expect(LMA7_HILLS_T.map((h) => [h.label, h.hexes.length])).toEqual([['hill tR2', 4], ['hill tS6', 27], ['hill tAA3', 15], ['hill tCC8', 16]]);
    // The I4 hill and the O5 field touch (L4/M5) but are two hills.
    expect(LMA7_HILLS_V[1]!.hexes).toContain('vL4');
    expect(LMA7_HILLS_V[3]!.hexes).toContain('vM5');
    expect(LMA7_HILL_HEXES).toHaveLength(115);
    expect(sc.victory).toEqual([
      {
        kind: 'all',
        side: 'br',
        of: [
          { kind: 'clearAreas', side: 'br', areas: LMA7_HILLS_V, atLeast: 3, areasLabel: 'hills of board v' },
          { kind: 'clearAreas', side: 'br', areas: LMA7_HILLS_T, atLeast: 3, areasLabel: 'hills of board t' },
          { kind: 'fewerLosses', side: 'br', measure: 'squadEquivalents' },
        ],
      },
    ]);
  });

  it('fields the card’s order of battle', () => {
    expect([count(sc, 'br', 'br.458'), count(sc, 'br', 'br.457'), count(sc, 'br')]).toEqual([3, 9, 15]);
    expect(sws(sc, 'br')).toEqual(['am.DC', 'am.FT', 'am.FT', 'am.MMG', 'am.MMG']);
    expect(force(sc, 'br').setup).toMatchObject({ kind: 'enter', turn: 1, edge: 'S' });
    expect([count(sc, 'ge', 'ge.467'), count(sc, 'ge', 'ge.L81'), count(sc, 'ge', 'ge.L80'), count(sc, 'ge')]).toEqual([6, 1, 1, 8]);
    expect(sws(sc, 'ge')).toEqual(['ge.LMG', 'ge.LMG', 'ge.MMG', 'ge.MTR']);
    expect(force(sc, 'ge').setup).toMatchObject({ kind: 'area', hexes: LMA7_HILL_HEXES });
    expect([count(sc, 'ge-reinf', 'ge.467'), count(sc, 'ge-reinf', 'ge.L80'), count(sc, 'ge-reinf')]).toEqual([3, 1, 4]);
    expect(sws(sc, 'ge-reinf')).toEqual(['ge.LMG', 'ge.LMG']);
    expect(force(sc, 'ge-reinf').setup).toMatchObject({ kind: 'enter', turn: 1, edge: 'N', provisional: { drBelowTurnTimes: 2 } });
  });

  it('SSR 1: the fields are Level 1 Open Ground, and their art is a hill for LOS', () => {
    const map = staticsForS20(sc).map;
    expect(map.hex('vO5')).toMatchObject({ terrain: 'open', elevation: 1 });
    expect(map.hex('tS6')).toMatchObject({ terrain: 'open', elevation: 1 });
    expect(map.hex('vN7')?.elevation ?? 0).toBe(0);
    // Ground level across the O5 field: the hill blocks.
    expect(map.los('vN2', 'vN9')).toMatchObject({ clear: false, crest: true });
    // From one level-1 field hex to another, over the same hill: clear, no grain hindrance.
    const over = map.los('vM6', 'vQ4');
    expect(over.clear).toBe(true);
    expect((over.crossed ?? []).some((c) => c.terrain === 'grain')).toBe(false);
    // Without the SSR the same line is a grain hindrance at ground level.
    const plain = staticsForS20({ ...sc, ssr: [] }).map;
    expect(plain.los('vN2', 'vN9').clear).toBe(true);
  });

  it('SSR 3: the German may split up to 3 squads into half-squads at setup; SSR 2: set-up units are dug in (+1 TEM)', () => {
    const g = play('lma7-deploy');
    expect(g.engine.currentDecision(g.get())).toMatchObject({ kind: 'setup', owner: 'ge' });
    const all = () => Object.values(g.get().pieces);
    const squads = all().filter((p) => p.side === 'ge' && p.defId === 'ge.467' && p.loc.kind === 'offboard' && p.loc.edge === 'setup').map((p) => p.id).sort();
    const withMmg = squads.find((id) => all().some((w) => w.loc.kind === 'held' && w.loc.by === id && w.defId === 'ge.MMG'))!;
    g.step({ type: 'setup.deploy', unit: withMmg });
    expect(g.get().pieces[withMmg]!.defId).toBe('ge.247h');
    expect(g.get().pieces[`${withMmg}.d`]).toMatchObject({ defId: 'ge.247h', side: 'ge', loc: { kind: 'offboard', edge: 'setup' } });
    // The MMG stays with the first half.
    expect(all().find((w) => w.defId === 'ge.MMG')!.loc).toEqual({ kind: 'held', by: withMmg });
    const others = squads.filter((id) => id !== withMmg);
    g.step({ type: 'setup.deploy', unit: others[0]! });
    g.step({ type: 'setup.deploy', unit: others[1]! });
    expect(() => g.step({ type: 'setup.deploy', unit: others[2]! })).toThrow(/At most 3 squads/);
    // The setup places the six half-squads with the rest, all on the hills.
    g.step(g.auto('ge', 'setup.place'));
    const ge = all().filter((p) => p.side === 'ge' && p.loc.kind === 'hex');
    expect(ge.filter((p) => p.defId === 'ge.247h')).toHaveLength(6);
    expect(ge.every((p) => LMA7_HILL_HEXES.includes((p.loc as { hex: string }).hex))).toBe(true);
    // Every unit set up is dug in where it stands; the weapons are not units.
    for (const p of ge) expect(p.tags[PREPARED], p.id).toBe(WEAPONS.includes(p.defId) ? undefined : (p.loc as { hex: string }).hex);
    // +1 on the IFT against a dug-in unit.
    const target = ge.find((p) => p.defId === 'ge.467')!;
    const hex = (target.loc as { hex: string }).hex;
    const near = staticsForS20(sc, { los: 'grid' }).map.neighbors(hex).find((h) => !LMA7_HILL_HEXES.includes(h))!;
    const fr = all().find((p) => p.defId === 'br.457' && !all().some((w) => w.loc.kind === 'held' && w.loc.by === p.id))!;
    const placed = g.engine.env({ ...g.get(), pieces: { ...g.get().pieces, [fr.id]: { ...fr, loc: { kind: 'hex', hex: near } } } });
    const attack = buildAttack(placed, { units: [fr.id], sw: [], target: hex }, 'prep', 'br');
    expect(placed.explain('fire.unitDrm', { attack, unit: target.id }, 0).trace.some((t) => t.id === 'ssr.prepared-positions.tem' && t.after === (t.before as number) + 1)).toBe(true);
    // Cumulative with the Height Advantage of the hill against fire from below (+1 more).
    expect(placed.query('fire.unitDrm', { attack, unit: target.id }, 0)).toBe(2);
    // Out of its hex (here, swapped with the French squad) it has none.
    const moved = g.engine.env({ ...g.get(), pieces: { ...g.get().pieces, [fr.id]: { ...fr, loc: { kind: 'hex', hex } }, [target.id]: { ...target, loc: { kind: 'hex', hex: near } } } });
    expect(moved.query('fire.unitDrm', { attack: buildAttack(moved, { units: [fr.id], sw: [], target: near }, 'prep', 'br'), unit: target.id }, 0)).toBe(0);
  });

  it('SSR 4: the reinforcements roll in the German RPh from Turn 1; balance', () => {
    const g = play('lma7-reinf');
    const reinf = Object.values(g.get().pieces).filter((p) => p.side === 'ge' && (p.tags['force'] as number) === 2);
    expect(reinf.length).toBeGreaterThan(0);
    expect(reinf.every((p) => p.tags['entryRoll'] === 'drBelowTurnTimes' && p.tags['entryTurn'] === 0 && p.tags['entryFrom'] === 1)).toBe(true);
    const bal = applyBalanceS20(sc, ['ge']);
    expect(force(bal, 'ge-reinf').setup).toMatchObject({ kind: 'enter', turn: 1, edge: 'N' });
    expect((force(bal, 'ge-reinf').setup as { provisional?: unknown }).provisional).toBeUndefined();
    expect([count(applyBalanceS20(sc, ['br']), 'br', 'br.458'), count(applyBalanceS20(sc, ['br']), 'br', 'br.457')]).toEqual([4, 8]);
  });

  it('VC: hills cleared and squad equivalents lost decide the game', () => {
    const g = play('lma7-vc');
    g.step(g.auto('ge', 'setup.place'));
    const s = g.get();
    const env = g.engine.env(s);
    const [v, t] = (sc.victory[0] as { of: Parameters<typeof clearAreasTally>[1][] }).of;
    expect(clearAreasTally(env, v!).clear + clearAreasTally(env, t!).clear).toBeLessThan(8);
    expect(evaluateVictoryS20(env)).toBe('ge');
    // Every German off the map but one on hill vC3 and one on hill tR2: 3 of 4 clear on each board.
    const ge = Object.values(s.pieces).filter((p) => p.side === 'ge' && p.loc.kind === 'hex' && !WEAPONS.includes(p.defId));
    const keep: Record<string, string> = { [ge[0]!.id]: 'vC3', [ge[1]!.id]: 'tR2' };
    const pieces = { ...s.pieces };
    for (const p of ge) pieces[p.id] = { ...p, loc: keep[p.id] ? { kind: 'hex', hex: keep[p.id]! } : { kind: 'offboard', edge: 'exited' } };
    const cleared = g.engine.env({ ...s, pieces });
    expect(clearAreasTally(cleared, v!)).toMatchObject({ clear: 3 });
    expect(clearAreasTally(cleared, t!)).toMatchObject({ clear: 3 });
    // No losses on either side: not fewer, so the Germans still win.
    expect(evaluateVictoryS20(cleared)).toBe('ge');
    const ledger = (rows: { side: string; defId: string; kind: 'eliminated' | 'reduced' }[]) =>
      g.engine.env({ ...s, pieces, ext: { ...s.ext, 'sk1.casualties': rows.map((r, i) => ({ unit: `x${i}`, vp: 1, turn: 1, phase: 'PFPh', reason: 'test', ...r })) } });
    // The French lost a squad and a half-squad (1½), the Germans two squads Casualty Reduced and a half-squad (1½): not fewer.
    const even = ledger([
      { side: 'br', defId: 'br.457', kind: 'eliminated' },
      { side: 'br', defId: 'br.247h', kind: 'eliminated' },
      { side: 'br', defId: 'br.L81', kind: 'eliminated' },
      { side: 'ge', defId: 'ge.467', kind: 'reduced' },
      { side: 'ge', defId: 'ge.467', kind: 'reduced' },
      { side: 'ge', defId: 'ge.247h', kind: 'eliminated' },
    ]);
    expect([squadEquivalentsLost(even, 'br'), squadEquivalentsLost(even, 'ge')]).toEqual([1.5, 1.5]);
    expect(evaluateVictoryS20(even)).toBe('ge');
    const ahead = ledger([
      { side: 'br', defId: 'br.457', kind: 'eliminated' },
      { side: 'ge', defId: 'ge.467', kind: 'eliminated' },
      { side: 'ge', defId: 'ge.247h', kind: 'eliminated' },
    ]);
    expect(evaluateVictoryS20(ahead)).toBe('br');
  });
});

describe('LMA4 Frères d’arme 4: Nuenen (Laurent Martin)', () => {
  const force = (id: string) => LMA_4.forces.find((f) => f.id === id)!;
  const count = (id: string) => force(id).units.reduce((n, u) => n + u.count, 0);
  const sws = (id: string) => force(id).units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).sort();
  /** Both setups made (the engine's default, with the given German placements). */
  const setUp = (ge: Record<string, string> = {}) => {
    const { engine, state } = newGame(LMA_4, 'lma4', { los: 'grid' });
    const f = new FixtureBuilder(engine, state);
    f.setup('ge', ge);
    f.setup('am', {});
    return { engine, f };
  };
  const rowOf = (h: string) => hexrowIndex(h.slice(1).replace(/\d+$/, ''));

  it('reads the card: board u whole, north to the left; the Germans set up first, the Americans move first; 6½ turns', () => {
    expect(rulesetFor(LMA_4).id).toBe('asl-sk3');
    expect(rulesetFor(LMA_4).modules.map((m) => m.id)).toEqual(expect.arrayContaining(['ssr.redraw-terrain', 'ssr.hidden-units', 'ssr.setup-rule', 'ssr.entry-after-fire', 'sk3.panzerfaust']));
    expect(LMA_4).toMatchObject({ turns: 6, halfFinalTurn: true, firstSide: 'am', month: 9, product: 'lma', number: 'LMA4', designer: 'Laurent Martin' });
    expect(LMA_4.sides.map((s) => [s.side, s.elr, !!s.setupFirst])).toEqual([['ge', 3, true], ['am', 5, false]]);
    expect(['ge', 'ge-psw', 'ge-reinf', 'am', 'br'].map(count)).toEqual([8, 1, 4, 12, 6]);
    expect(sws('am')).toEqual(['am.BAZ44', 'am.DC', 'am.MTR']);
    expect(sws('ge')).toEqual(['ge.AT50L', 'ge.MMG']);
    expect(force('ge').units.map((u) => u.def)).toEqual(expect.arrayContaining(['ge.stgiiig', 'ge.pzviel']));
    expect(force('br').units).toEqual([{ def: 'br.cromiv', count: 6 }]);
    // The Tiger the card prints (88L, 12 MP, MGs 3/5/2) is the Tiger (L), with its AAMG.
    expect(COUNTERS['ge.pzviel']).toMatchObject({ mp: 12, ma: { caliber: 88, barrel: 'L' }, mg: { bmg: 3, cmg: 5, aamg: 2 } });
    expect(COUNTERS['ge.psw2342']).toMatchObject({ mp: 33, tracked: false, af: { hull: { front: 4, side: 1 } }, ma: { caliber: 50, barrel: 'L', rof: 2 }, mg: { cmg: 5 } });
    expect(COUNTERS['br.cromiv']).toMatchObject({ mp: 18, af: { hull: { front: 6 } } });
    const map = staticsForS20(LMA_4, { los: 'grid' }).map;
    // The card's south edge, where the reinforcements enter, is board u's hexrow GG.
    expect(map.edge('S')).toEqual(expect.arrayContaining(['uGG5']));
    expect(map.edge('N')).toEqual(expect.arrayContaining(['uA5']));
  });

  it('SSR 1: hills do not exist and every building is stone, LOS included', () => {
    const map = staticsForS20(LMA_4).map;
    expect([...map.hexes()].filter((h) => h.elevation)).toEqual([]);
    expect(map.hex('uH3')).toMatchObject({ terrain: 'building-stone' });
    expect([...map.hexes()].filter((h) => h.terrain === 'building-wood')).toEqual([]);
    // The hill between B8 and G8 blocks that LOS on board u as printed, not here.
    expect(buildMap([{ board: 'u', x: 0, y: 0 }]).los('uB8', 'uG8').clear).toBe(false);
    expect(map.los('uB8', 'uG8').clear).toBe(true);
  });

  it('SSR 2: every German unit but the PSW 234/2 sets up hidden between F and P, the PSW on a road there', () => {
    expect(LMA4_PSW_HEXES.length).toBeGreaterThan(10);
    expect(LMA4_PSW_HEXES).toEqual(expect.arrayContaining(['uF7', 'uJ6', 'uP4', 'uP8']));
    expect(LMA4_PSW_HEXES.every((h) => rowOf(h) >= hexrowIndex('F') && rowOf(h) <= hexrowIndex('P'))).toBe(true);
    const { engine, f } = setUp();
    const env = engine.env(f.state);
    const ge = Object.values(f.state.pieces).filter((p) => p.side === 'ge' && (p.loc.kind === 'hex' || p.loc.kind === 'held'));
    const psw = ge.filter((p) => p.defId.startsWith('ge.psw2342'));
    const hidden = ge.filter((p) => !psw.includes(p));
    // Squads, leader, crew, MMG, AT Gun, StuG and Tiger with their MGs.
    expect(hidden.map((p) => p.defId)).toEqual(expect.arrayContaining(['ge.467', 'ge.L81', 'ge.228c', 'ge.MMG', 'ge.AT50L', 'ge.stgiiig', 'ge.pzviel', 'ge.pzviel.cmg']));
    for (const p of hidden) expect([p.defId, p.tags['hip']]).toEqual([p.defId, true]);
    for (const p of hidden) expect(isVisibleTo(env, p, 'am')).toBe(false);
    for (const p of psw) expect(isVisibleTo(env, p, 'am')).toBe(true);
    expect(LMA4_PSW_HEXES).toContain((psw.find((p) => p.loc.kind === 'hex')!.loc as { hex: string }).hex);
  });

  it('SSR 2: the AT Gun may not set up on a paved road, where it could not be hidden', () => {
    const { engine, state } = newGame(LMA_4, 'lma4', { los: 'grid' });
    const d = engine.currentDecision(state)!;
    const a = engine.legalActions(state, 'ge')[0]! as unknown as { placements: Record<string, string> };
    const crew = Object.keys(a.placements).find((id) => state.pieces[id]!.defId === 'ge.228c')!;
    expect(staticsForS20(LMA_4, { los: 'grid' }).map.hex('uJ6')!.features).toContain('road:paved');
    expect(engine.validate(state, { ...a, placements: { ...a.placements, [crew]: 'uJ6' }, side: 'ge', decisionId: d.id } as never)).toMatch(/paved road/);
  });

  it('SSR 2: a hidden German in Open Ground in an American LOS is found; one that fires is revealed, with its weapons', () => {
    const { engine, f } = setUp({ 'ge.0.5.ge.pzviel.1': 'uP8', 'ge.0.4.ge.stgiiig.1': 'uP5' });
    f.until('DFPh', { turn: 1, attacker: 'am' });
    expect(f.state.pieces['ge.0.5.ge.pzviel.1']!.tags['hip']).toBeUndefined();
    expect(f.state.pieces['ge.0.5.ge.pzviel.1.cmg']!.tags['hip']).toBeUndefined();
    const stug = 'ge.0.4.ge.stgiiig.1';
    expect(f.state.pieces[stug]!.tags['hip']).toBe(true);
    const shot = engine.legalActions(f.state, 'ge').find((a) => a.type === 'fire.ordnance' && (a['shot'] as { weapon: string }).weapon === stug);
    expect(shot).toBeDefined();
    const { side: _s, decisionId: _d, ...rest } = shot!;
    f.act(rest as never);
    expect(f.state.pieces[stug]!.tags['hip']).toBeUndefined();
    expect(f.state.pieces[`${stug}.aamg`]!.tags['hip']).toBeUndefined();
    expect(isVisibleTo(engine.env(f.state), f.state.pieces[stug]!, 'am')).toBe(true);
  });

  it('SSR 3: the tanks on the road S8-Y10, the infantry adjacent to a tank', () => {
    expect(force('br').setup).toMatchObject({ hexes: LMA4_TANK_HEXES });
    const map = staticsForS20(LMA_4, { los: 'grid' }).map;
    for (const h of LMA4_TANK_HEXES) expect(map.hex(h)!.features.some((x) => x.startsWith('road')), h).toBe(true);
    const { engine, state } = newGame(LMA_4, 'lma4', { los: 'grid' });
    const f = new FixtureBuilder(engine, state);
    f.setup('ge', {});
    const d = f.decision;
    const a = engine.legalActions(f.state, 'am')[0]! as unknown as { placements: Record<string, string> };
    const tanks = Object.keys(a.placements).filter((id) => f.state.pieces[id]!.defId === 'br.cromiv');
    const squad = Object.keys(a.placements).find((id) => f.state.pieces[id]!.defId === 'am.747')!;
    for (const id of Object.keys(a.placements).filter((x) => !tanks.includes(x))) {
      expect(tanks.some((t) => map.distance(a.placements[t]!, a.placements[id]!) === 1), id).toBe(true);
    }
    const tried = (hex: string) => engine.validate(f.state, { ...a, placements: { ...a.placements, [squad]: hex }, side: 'am', decisionId: d.id } as never);
    expect(tried('uR5')).toMatch(/adjacent to a friendly vehicle/);
    expect(tried('uR8')).toBeNull();
  });

  it('SSR 4: the German reinforcements wait for the first German fire attack, then enter the next turn from the south', () => {
    expect(force('ge-reinf').setup).toMatchObject({ kind: 'enter', turn: 0, edge: 'S' });
    const { engine, f } = setUp({ 'ge.0.1.ge.467.1': 'uP7' });
    const reinf = () => Object.values(f.state.pieces).filter((p) => p.tags['force'] === 2);
    expect(reinf().map((p) => p.tags['entryTurn'])).toEqual([0, 0, 0, 0]);
    f.until('DFPh', { turn: 1, attacker: 'am' });
    expect(entryAfterFireState(engine.env(f.state))).toBeNull();
    const fire = engine.legalActions(f.state, 'ge').find((a) => a.type === 'fire')!;
    const { side: _s, decisionId: _d, ...rest } = fire;
    f.act(rest as never);
    expect(entryAfterFireState(engine.env(f.state))).toMatchObject({ turn: 2, firedOn: 1 });
    expect(reinf().map((p) => p.tags['entryTurn'])).toEqual([2, 2, 2, 2]);
    // They set up offboard to enter in the German Player Turn 2, along board u's GG edge.
    for (let i = 0; i < 2000 && !(f.state.turn === 2 && f.state.attacker === 'ge' && f.decision.kind !== 'phase'); i++) f.pass();
    expect([f.state.turn, f.state.attacker, f.decision.owner]).toEqual([2, 'ge', 'ge']);
    const offboard = engine.legalActions(f.state, 'ge')[0] as unknown as { type: string; placements: Record<string, string> };
    expect(offboard.type).toBe('setup.offboard');
    expect(Object.keys(offboard.placements).sort()).toEqual(reinf().map((p) => p.id).sort());
  });

  it('VC: the Americans must Control both buildings I3 (I3-I5) and H7 at game end', () => {
    expect(LMA4_BUILDINGS).toEqual([buildingAt('u', 'uI4'), buildingAt('u', 'uH7')]);
    expect(LMA_4.victory).toEqual([{ kind: 'controlBuildings', side: 'am', buildings: LMA4_BUILDINGS, atLeast: 2 }]);
  });

  it('balance: an American BAZ44, or a fourth 4-6-7 in the German reinforcements', () => {
    expect(applyBalanceS20(LMA_4, ['am']).forces.find((f) => f.id === 'am')!.units.flatMap((u) => Array(u.count).fill(u.withSw ?? []).flat()).filter((w) => w === 'am.BAZ44')).toHaveLength(2);
    expect(applyBalanceS20(LMA_4, ['ge']).forces.find((f) => f.id === 'ge-reinf')!.units.filter((u) => u.def === 'ge.467').reduce((n, u) => n + u.count, 0)).toBe(4);
  });
});

/** Every condition in a victory list, composites opened. */
const vcLeaves = (vcs: readonly Record<string, unknown>[]): Record<string, unknown>[] => vcs.flatMap((v) => [v, ...(Array.isArray(v['of']) ? vcLeaves(v['of']) : [])]);

describe('Victory Conditions are judged at game end unless the card says "immediately"', () => {
  it('a condition is `immediate` only where the card text says so, and some condition is where it does', () => {
    for (const sc of ALL_SCENARIOS.filter((s) => s.victoryText)) {
      const says = /\bimmediately\b/i.test(sc.victoryText!);
      const flagged = vcLeaves(sc.victory as unknown as Record<string, unknown>[]).some((v) => v['immediate'] === true);
      expect({ id: sc.id, flagged }).toEqual({ id: sc.id, flagged: says });
    }
  });

  // S8: "The American player wins by exiting ≥ 1 squad (or 2 HS) and ≥ 1 SMC off Q10": no "immediately", so the
  // Germans may still exit HS (each raising the count) until the game ends.
  it('S8: the American exit is judged at game end, not the moment it is made', () => {
    const S8 = ALL_SCENARIOS.find((s) => s.id === 'sk-s8')!;
    expect(S8.victory).toEqual([{ kind: 'exitForce', side: 'am', hsEquivalents: 2, smc: 1, perEnemyHsExit: 1 }]);
    const { engine, state } = newGame(S8, 's8', { los: 'grid' });
    const pick = (def: string) => Object.values(state.pieces).find((p) => p.defId === def)!.id;
    const exited = new Set([pick('am.747'), pick('am.L92')]);
    const s = { ...state, turn: 3, pieces: Object.fromEntries(Object.entries(state.pieces).map(([k, p]) => [k, exited.has(k) ? { ...p, loc: { kind: 'offboard' as const, edge: 'exited' } } : p])) } as GameState;
    expect(engine.env(s).query('game.suddenDeath', { phase: 'MPh' }, null)).toBeNull();
    expect(evaluateVictory(engine.env(s))).toBe('am');
  });

});

describe('To Hit Chart rows', () => {
  it('every Gun and vehicle Main Armament fires on a chart row (a counter with another nation\'s Gun, such as the British Sherman IIA(a) with the American 76L, uses the maker\'s row)', () => {
    const missing: string[] = [];
    for (const d of Object.values(COUNTERS) as CounterDef[]) {
      const g = d.kind === 'gun' ? (d as GunDef) : d.kind === 'vehicle' && (d as VehicleDef).ma ? ({ ...(d as VehicleDef).ma, id: d.id, nationality: d.nationality, kind: 'gun' } as unknown as GunDef) : null;
      if (!g || g.type === 'MG') continue;
      try {
        SK1_TABLES.gunColumn!(g, 'ITT');
      } catch (e) {
        missing.push(String(e));
      }
    }
    expect(missing).toEqual([]);
    const sherman = COUNTERS['br.sheriiaa'] as VehicleDef;
    expect(SK1_TABLES.toHit!({ ...sherman.ma!, id: sherman.id, nationality: 'br', kind: 'gun' } as unknown as GunDef, 'VTT', 3)).toEqual(SK1_TABLES.toHit!({ ...sherman.ma!, id: 'x', nationality: 'am', kind: 'gun' } as unknown as GunDef, 'VTT', 3));
  });
});
