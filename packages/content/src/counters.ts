import { UNKNOWN_DEF, UNKNOWN_DEF_ID, vehicleMgDefs, type CounterDef, type GunDef } from '@asl/rules';
import generated from './generated/counters.json';
import assets from './generated/assets.json';

/** Guns the ASLSK To Hit charts mark "AP only" ("British 40L is AP only"): no Area Target Type, no Residual FP (SK4 6.2). */
const AP_ONLY_GUNS = new Set(['br.AA40L', 'br.AT40L']);

/**
 * Starter Kit counters whose printed values differ from the full-ASL VASL piece: the SK value wins.
 * The SK3 PSW 234/1 (S22's card) has a front AF of 3 where VASL prints 4.
 */
const SK_PRINTED: Record<string, (d: CounterDef) => CounterDef> = {
  // The SK Sherman III(a) prints MG 2/4: no AAMG.
  'ru.ShermanIII': (d) => (d.kind === 'vehicle' && d.mg ? { ...d, mg: { bmg: d.mg.bmg, cmg: d.mg.cmg } } : d),
  // The 88L AA Gun's M# is printed in red: a large target (SK4 6.7); the VASL piece leaves it normal.
  'ge.AA88L': (d) => (d.kind === 'gun' ? { ...d, targetSize: 'large' } : d),
  'ge.psw2341': (d) =>
    d.kind === 'vehicle' ? { ...d, af: { hull: { ...d.af.hull, front: 3 }, turret: { ...d.af.turret, front: 3 } } } : d,
  // The Shinhoto CHI-HA prints no smoke dispenser: SK4's Japanese Vehicle Notes give sD to the Type 97A only.
  'ja.ty97Bchiha': (d) => (d.kind === 'vehicle' ? (({ smoke: _smoke, ...rest }) => rest)(d) : d),
  // The SK Type 97A CHI-HA (S71) prints 10 MP, AF 2 front and 1 side boxed (its turret side one more), and a 57* MA;
  // the VASL piece carries 14 MP, 3/2 (turret 4/3) and no "*" the import reads.
  'ja.ty97Achiha': (d) =>
    d.kind === 'vehicle' && d.ma
      ? { ...d, mp: 10, af: { hull: { front: 2, side: 1, rear: 1 }, turret: { front: 2, side: 2, rear: 2 } }, ma: { ...d.ma, barrel: '*' } }
      : d,
};

/**
 * Starter Kit #4 counters whose printed values or links the VASL layers do not carry:
 * - U.S.M.C. MMC are Elite (SK4 8.4; the VASL pieces carry no class letter) and Raiders take -1 on ambush (8.4.2);
 * - Japanese squads and crews flip between a Full-Strength and a Reduced-Strength side (SK4 8.1.1, 8.1.2, 8.1.6):
 *   `stepTo` / `fullOf` link the two defs; the Reduced-Strength 1-2-8 crew's next step is the broken 1-2-7 crew.
 */
const USMC_SQUADS = ['am.768', 'am.668', 'am.558', 'am.558r', 'am.558p', 'am.458'];
const USMC_HS = ['am.348h', 'am.238h', 'am.238rh', 'am.238ph', 'am.248h'];
const RAIDERS = new Set(['am.558r', 'am.238rh']);
const JA_STEPS: Record<string, string> = { 'ja.448': 'ja.348r', 'ja.447': 'ja.347r', 'ja.347': 'ja.237r', 'ja.336': 'ja.226r', 'ja.228c': 'ja.128cr', 'ja.128cr': 'ja.127c' };
const JA_FULL: Record<string, string> = Object.fromEntries(Object.entries(JA_STEPS).filter(([, r]) => r !== 'ja.127c').map(([f, r]) => [r, f]));
const SK4_PRINTED = (id: string, d: CounterDef): CounterDef => {
  if (d.kind !== 'squad' && d.kind !== 'hs' && d.kind !== 'crew') return d;
  let out = d;
  if (USMC_SQUADS.includes(id) || USMC_HS.includes(id)) out = { ...out, quality: 'E', ...(RAIDERS.has(id) ? { raider: true as const } : {}) };
  if (JA_STEPS[id]) out = { ...out, stepTo: JA_STEPS[id] };
  if (JA_FULL[id]) out = { ...out, fullOf: JA_FULL[id] };
  return out;
};

/**
 * Basic Point Values (ASLRB A1.4: "its Basic Point Value (BPV) for Battlefield Integrity and DYO uses") of the MMC
 * in the Starter Kit counter sets, from the BPV columns of the eASLRB's A./G. National Capabilities Chart (squad, HS,
 * and the crew's BPV in brackets under the nationality), matched by Class and strength factors; H1.26's examples agree
 * (German 8-3-8 16, 4-6-8 13, 4-3-6 5). A16 Battlefield Integrity tallies them and A18.2 Leader Creation compares them.
 * Leaders and SW have no BPV (they are allotted, not bought: ASLRB H1.2).
 * Where the eASLRB lacks a value, the source used is the asl-players.net National Capabilities Chart
 * (checked 2026-11-05; it agrees with every value below). Both list
 * the American 2-2-8 crew only under U.S.M.C., BPV 8 (`am.228c`), the only American 2-2-8 crew. Neither has a row for
 * the German 1-2-8 crew (`ge.128c`); it takes the German 2-2-8 crew's 8 for now.
 */
export const BPV: Record<string, number> = {
  // German: E 8-3-8 / 3-3-8, E 4-6-8 / 2-4-8, E 5-4-8 / 2-3-8, 1 4-6-7 / 2-4-7, 2 4-4-7 / 2-3-7, C 4-3-6 / 2-3-6; crews 2-2-8 (8), 1-2-7 (7).
  'ge.838': 16, 'ge.338h': 6, 'ge.468': 13, 'ge.248h': 5, 'ge.548': 13, 'ge.238h': 5, 'ge.467': 10, 'ge.247h': 4,
  'ge.447': 7, 'ge.237h': 3, 'ge.436': 5, 'ge.236h': 2, 'ge.228c': 8, 'ge.128c': 8, 'ge.127c': 7,
  // Russian: E 6-2-8 / 3-2-8, E 4-5-8 / 2-4-8, 1 4-4-7 / 2-3-7, 1 5-2-7 / 2-2-7, C 4-2-6 / 2-2-6; crews 2-2-8 (6), 1-2-7 (5).
  'ru.628': 12, 'ru.328h': 5, 'ru.458': 11, 'ru.248h': 5, 'ru.447': 7, 'ru.237h': 3, 'ru.527': 7, 'ru.227h': 3,
  'ru.426': 4, 'ru.226h': 1, 'ru.228c': 6, 'ru.127c': 5,
  // American (Army): E 7-4-7 / 3-3-7, E 6-6-7 / 3-4-7, 1 6-6-6 / 3-4-6, 2 5-4-6 / 2-3-6, G 5-3-6 / 2-2-6; crews 2-2-7 (7),
  // 1-2-6 (6).
  'am.747': 14, 'am.337h': 6, 'am.667': 14, 'am.347h': 6, 'am.666': 11, 'am.346h': 4, 'am.546': 7, 'am.236h': 3,
  'am.536': 6, 'am.226h': 2, 'am.227c': 7, 'am.126c': 6,
  // U.S.M.C. crew 2-2-8 (8): the American 2-2-8 crew counter.
  'am.228c': 8,
  // British: E 6-4-8 / 3-3-8, E 4-5-8 / 2-4-8, 1 4-5-7 / 2-4-7, 2 4-4-7 / 2-3-7, G 4-3-6 / 2-2-6; crews 2-2-8 (8), 1-2-7 (7).
  'br.648': 14, 'br.338h': 6, 'br.458': 13, 'br.248h': 5, 'br.457': 10, 'br.247h': 4, 'br.447': 7, 'br.237h': 3,
  'br.436': 5, 'br.226h': 2, 'br.228c': 8, 'br.127c': 7,
  // Italian: E 4-4-7 / 2-4-7, 1 3-4-7 / 1-3-7, 1 3-4-6 / 1-3-6, C 3-3-6 / 1-2-6; crews 2-2-7 (6), 1-2-6 (5).
  'it.447': 8, 'it.247h': 3, 'it.347': 6, 'it.137h': 2, 'it.346': 5, 'it.136h': 2, 'it.336': 3, 'it.126h': 1,
  'it.227c': 6, 'it.126c': 5,
  // Allied Minor: E 4-5-8 / 2-4-8, 1 4-5-7 / 2-3-7, G 4-3-7 / 2-2-7; crews 2-2-8 (7), 1-2-7 (5).
  'al.458': 12, 'al.248h': 5, 'al.457': 8, 'al.237h': 3, 'al.437': 6, 'al.227h': 2, 'al.228c': 7, 'al.127c': 5,
  // Japanese (G chart): E 4-4-8 / 2-3-8, 1 4-4-7 / 2-3-7, 2 3-4-7 / 1-3-7, C 3-3-6 / 1-2-6; crews 2-2-8 (10), 1-2-7 (8).
  // Reduced-Strength sides have no row of their own.
  'ja.448': 16, 'ja.238h': 7, 'ja.447': 13, 'ja.237h': 6, 'ja.347': 10, 'ja.137h': 4, 'ja.336': 6, 'ja.126h': 2,
  'ja.228c': 10, 'ja.127c': 8,
  // U.S.M.C.: 7-6-8 / 3-4-8 17/7, 6-6-8 / 3-4-8 16/7, 5-5-8 / 2-3-8 13/5 (the † row, 14/6, the Raiders), 4-5-8 / 2-4-8 12/6.
  'am.768': 17, 'am.668': 16, 'am.348h': 7, 'am.558': 13, 'am.238h': 5, 'am.558p': 13, 'am.238ph': 5, 'am.558r': 14, 'am.238rh': 6,
  'am.458': 12, 'am.248h': 6,
  // Early U.S. Army (P.A.): 2 4-4-7 / 2-3-7, G 3-3-6 / 1-2-6.
  'am.447': 7, 'am.237h': 3, 'am.336': 4, 'am.126h': 2,
};

/**
 * All counters imported from VASL for the supported nationalities. The counter art does not say
 * which ammunition a Gun has: the To Hit chart's notes do, and are applied here, as are the SK
 * counters' own printed values (`SK_PRINTED`) and the MMC's BPV (`BPV`).
 */
export const COUNTERS: Record<string, CounterDef> = Object.fromEntries(
  Object.entries(generated as unknown as Record<string, CounterDef>).map(([id, d]) => {
    const def =
      d.kind === 'gun' && AP_ONLY_GUNS.has(id)
        ? ({ ...d, ammo: { he: false, ap: true } } as GunDef)
        : BPV[id] !== undefined && (d.kind === 'squad' || d.kind === 'hs' || d.kind === 'crew')
          ? { ...d, bpv: BPV[id] }
          : d;
    return [id, SK4_PRINTED(id, SK_PRINTED[id]?.(def) ?? def)];
  }),
);

export interface AssetManifest {
  source: { vasl: string };
  counters: Record<string, { front: string; back?: string; limbered?: string }>;
  markers: Record<string, string>;
  boards: Record<string, { image: string; width: number; height: number; hasHills?: boolean }>;
}
export const ASSETS = assets as AssetManifest;

/** SK1 Nationality Chart (rules p.12): ELR replacement chains, best to worst. */
export const SK1_NATIONALITY_CHART: Record<string, string[][]> = {
  ge: [
    ['ge.468', 'ge.467', 'ge.447', 'ge.436'],
    ['ge.548', 'ge.447', 'ge.436'],
    ['ge.248h', 'ge.247h', 'ge.237h', 'ge.236h'],
    ['ge.238h', 'ge.237h', 'ge.236h'],
  ],
  ru: [
    ['ru.458', 'ru.447', 'ru.426'],
    ['ru.527', 'ru.426'],
    ['ru.248h', 'ru.237h', 'ru.226h'],
    ['ru.227h', 'ru.226h'],
  ],
  am: [
    ['am.667', 'am.666', 'am.546', 'am.536'],
    ['am.747'],
    ['am.347h', 'am.346h', 'am.236h', 'am.226h'],
    ['am.337h'],
  ],
  leaders: [['L102', 'L92', 'L91', 'L81', 'L80', 'L70', 'L61']],
};

/**
 * SK2 Nationality Chart: the British (also the Australians of S13), the Allied Minor (the Greeks) and
 * the Italian ELR chains, as the VASL counter layers order them. Crews are not subject to ELR (SK4 5.1).
 */
export const SK2_NATIONALITY_CHART: Record<string, string[][]> = {
  br: [
    ['br.648', 'br.458', 'br.457', 'br.447', 'br.436'],
    ['br.338h', 'br.248h', 'br.247h', 'br.237h', 'br.226h'],
  ],
  al: [
    ['al.458', 'al.457', 'al.437'],
    ['al.248h', 'al.237h', 'al.227h'],
  ],
  // ASLRB 25.61-25.62: a 4-4-7 that fails ELR becomes a 3-4-6; a 3-4-7 (Bersaglieri, 1st Line) becomes a
  // Conscript, never a lower 1st Line squad. Their half-squads follow the same lines.
  it: [
    ['it.447', 'it.346', 'it.336'],
    ['it.347', 'it.336'],
    ['it.247h', 'it.136h', 'it.126h'],
    ['it.137h', 'it.126h'],
  ],
  leaders: [['L102', 'L92', 'L91', 'L81', 'L80', 'L70', 'L61']],
};

/**
 * SK4 Nationality Chart (rules p.33): the Japanese ELR chains (Full-Strength squads, Reduced-Strength squads and HS,
 * each class to the next: SK4 8.1.3), the early U.S. Army 4-4-7 / 3-3-6, and the Japanese leaders (8.1.7: 10-2, 10-1,
 * 10-0, 9-1, 9-0, 8-0, 8+1). U.S.M.C. MMC have underlined morale (no ELR replacement) and use American leaders.
 */
export const SK4_NATIONALITY_CHART: Record<string, string[][]> = {
  ja: [
    ['ja.448', 'ja.447', 'ja.347', 'ja.336'],
    ['ja.348r', 'ja.347r', 'ja.237r', 'ja.226r'],
    ['ja.238h', 'ja.237h', 'ja.137h', 'ja.126h'],
  ],
  am: [
    ['am.447', 'am.336'],
    ['am.237h', 'am.126h'],
  ],
  leaders: [['L102', 'L101', 'L100', 'L91', 'L90', 'L80', 'L8p1']],
};

const SW_TYPES = ['LMG', 'MMG', 'HMG', 'FT', 'DC'];

/** Counter ids of a kit: every chart unit, plus leaders and SW for each nationality, plus `extra`. */
function counterIds(chart: Record<string, string[][]>, nations: string[], extra: string[] = []): string[] {
  return [
    ...Object.entries(chart)
      .filter(([k]) => k !== 'leaders')
      .flatMap(([, chains]) => chains.flat()),
    ...nations.flatMap((n) => chart['leaders']![0]!.map((l) => `${n}.${l}`)),
    ...nations.flatMap((n) => SW_TYPES.map((t) => `${n}.${t}`)),
    ...extra,
  ].filter((id, i, a) => a.indexOf(id) === i);
}

/** Counters in the SK1 counter mix (nationality chart + leaders + SW). */
export const SK1_COUNTER_IDS: string[] = counterIds(SK1_NATIONALITY_CHART, ['ge', 'ru', 'am']);

/**
 * The SK2 additions: British, Allied Minor and Italian infantry, then every crew, Gun, Light Mortar and Bazooka imported
 * (those with a row on the ASLSK To Hit Chart; see tools/vasl-import).
 */
export const SK2_COUNTER_IDS: string[] = counterIds(
  SK2_NATIONALITY_CHART,
  ['br', 'al', 'it'],
  Object.values(COUNTERS)
    .filter((d) => d.kind === 'crew' || d.kind === 'gun' || (d.kind === 'sw' && (d.type === 'MTR' || !!d.latw)))
    .map((d) => d.id)
    .sort(),
);

/**
 * The listed counters with a nationality chart applied: leader ELR chains are capped at 10-2
 * and units the chart lists without a replacement have none.
 */
function countersFor(ids: string[], charts: Record<string, string[][]>[], nations: string[]): Record<string, CounterDef> {
  const out: Record<string, CounterDef> = {};
  for (const id of ids) {
    const d = COUNTERS[id];
    if (!d) throw new Error(`Counter ${id} missing from the VASL import`);
    out[id] = { ...d };
  }
  // The "?" stand-in a redacted view puts where an enemy's concealed stack is (`redactState`).
  out[UNKNOWN_DEF_ID] = { ...UNKNOWN_DEF };
  for (const chart of charts) {
    for (const chains of Object.values(chart)) {
      for (const chain of chains) {
        if (chain[0]!.startsWith('L')) {
          for (const n of nations) {
            chain.forEach((l, i) => {
              const d = out[`${n}.${l}`];
              if (!d || d.kind !== 'leader') return;
              const next = chain[i + 1];
              if (next) d.elrReplacement = `${n}.${next}`;
              else delete d.elrReplacement;
            });
          }
          continue;
        }
        chain.forEach((id, i) => {
          const d = out[id];
          if (!d || (d.kind !== 'squad' && d.kind !== 'hs' && d.kind !== 'crew')) return;
          const next = chain[i + 1];
          if (next) d.elrReplacement = next;
          else delete d.elrReplacement;
        });
      }
    }
  }
  return out;
}

/** SK1 counters with the SK1 chart applied. */
export const sk1Counters = (): Record<string, CounterDef> => countersFor(SK1_COUNTER_IDS, [SK1_NATIONALITY_CHART], ['ge', 'ru', 'am']);

/** SK1 + SK2 counters with both charts applied. */
export const sk2Counters = (): Record<string, CounterDef> =>
  countersFor([...SK1_COUNTER_IDS, ...SK2_COUNTER_IDS], [SK1_NATIONALITY_CHART, SK2_NATIONALITY_CHART], ['ge', 'ru', 'am', 'br', 'al', 'it']);

/**
 * The SK3 additions: the German 8-3-8 assault engineers and their 3-3-8 half-squads (underlined
 * morale: no ELR replacement, S22), the Russian 6-2-8 Guards and their 3-2-8 half-squads (S24; VASL's
 * ELR replacements 5-2-7 and 2-2-7), and every vehicle imported (tools/vasl-import `VEHICLES`).
 */
export const SK3_COUNTER_IDS: string[] = [
  'ge.838',
  'ge.338h',
  'ru.628',
  'ru.328h',
  // Anti-Tank Rifles (SK4 4.4.4): Russian (S25), German (S27).
  'ru.ATR',
  'ge.ATR',
  // The American .50 cal HMG (S34).
  'am.HMG50',
  ...Object.values(COUNTERS)
    .filter((d) => d.kind === 'vehicle')
    .map((d) => d.id)
    .sort(),
];

/**
 * SK1 + SK2 + SK3 counters: the vehicles, and for each its vehicular MG pieces (`<vehicle>.bmg`, `.cmg`,
 * `.aamg`, `.rmg`), generated from the vehicle's printed MG factors (SK4 7.8).
 */
export const sk3Counters = (): Record<string, CounterDef> => {
  const out = sk2Counters();
  for (const id of SK3_COUNTER_IDS) {
    const d = COUNTERS[id]!;
    out[id] = { ...d };
    if (d.kind === 'vehicle') for (const mg of vehicleMgDefs(d)) out[mg.id] = mg;
  }
  return out;
};

/**
 * The SK4 additions: the Japanese (squads with both sides, HS, crews, leaders, SW incl. the 20mm ATR and the 50mm
 * mortar) and the U.S. Marine Corps / early U.S. Army infantry.
 */
export const SK4_COUNTER_IDS: string[] = counterIds(SK4_NATIONALITY_CHART, ['ja'], [...USMC_SQUADS, ...USMC_HS, 'ja.228c', 'ja.128cr', 'ja.127c', 'ja.ATR', 'ja.MTR']);

/** SK1 + SK2 + SK3 + SK4 counters, with the SK4 chart applied to the Japanese and early U.S. Army chains. */
export const sk4Counters = (): Record<string, CounterDef> => ({ ...sk3Counters(), ...countersFor(SK4_COUNTER_IDS, [SK4_NATIONALITY_CHART], ['ja']) });
