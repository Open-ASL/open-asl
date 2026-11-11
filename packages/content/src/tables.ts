import type { GunDef, IftResult, Tables, ToHitEntry } from '@asl/rules';

/*
 * SK1 chart values, read from the chart images shipped in the VASL 6.7.3 module
 * (images/tables/IFT_DR.gif, CCTable.gif, Leader.gif). The SK1 rulebook examples
 * are reproduced as tests in test/content.test.ts.
 */

/** Close Combat Table kill numbers, worst to best odds. */
const CC_KILL: [string, number][] = [
  ['<1:8', 0], ['1:8', 1], ['1:6', 2], ['1:4', 3], ['1:2', 4], ['1:1', 5], ['3:2', 6],
  ['2:1', 7], ['3:1', 8], ['4:1', 9], ['6:1', 10], ['8:1', 11], ['10:1', 12], ['>10:1', 13],
];

export const IFT_COLUMNS = [1, 2, 4, 6, 8, 12, 16, 20, 24, 30, 36];

/** Infantry Fire Table: per FP column, results for final DR ≤0, 1, 2, …; blank beyond the list. */
const IFT: Record<number, string[]> = {
  1: ['1KIA', 'K/1', '1MC', '1MC', 'NMC', 'PTC'],
  2: ['2KIA', '1KIA', 'K/1', '1MC', '1MC', 'NMC', 'PTC'],
  4: ['2KIA', '1KIA', 'K/2', '2MC', '1MC', '1MC', 'NMC', 'PTC'],
  6: ['3KIA', '2KIA', '1KIA', 'K/2', '2MC', '1MC', '1MC', 'NMC', 'PTC'],
  8: ['3KIA', '2KIA', '1KIA', 'K/2', '2MC', '2MC', '1MC', '1MC', 'NMC', 'PTC'],
  12: ['3KIA', '2KIA', '1KIA', 'K/3', '3MC', '2MC', '2MC', '1MC', '1MC', 'NMC', 'PTC'],
  16: ['4KIA', '3KIA', '2KIA', '1KIA', 'K/3', '3MC', '2MC', '2MC', '1MC', '1MC', 'NMC', 'PTC'],
  20: ['4KIA', '3KIA', '2KIA', '1KIA', 'K/4', '4MC', '3MC', '2MC', '2MC', '1MC', '1MC', 'NMC', 'PTC'],
  24: ['5KIA', '4KIA', '3KIA', '2KIA', '1KIA', 'K/4', '4MC', '3MC', '2MC', '2MC', '1MC', '1MC', 'NMC', 'PTC'],
  30: ['6KIA', '5KIA', '4KIA', '3KIA', '2KIA', '1KIA', 'K/4', '4MC', '3MC', '2MC', '2MC', '1MC', '1MC', 'NMC', 'PTC'],
  36: ['7KIA', '6KIA', '5KIA', '4KIA', '3KIA', '2KIA', '1KIA', 'K/4', '4MC', '3MC', '2MC', '2MC', '1MC', '1MC', 'NMC', 'PTC'],
};

function parseIft(cell: string | undefined): IftResult {
  if (!cell) return { kind: 'none' };
  let m = /^(\d+)KIA$/.exec(cell);
  if (m) return { kind: 'KIA', n: Number(m[1]) };
  m = /^K\/(\d+)$/.exec(cell);
  if (m) return { kind: 'K', n: Number(m[1]) };
  m = /^(\d+)MC$/.exec(cell);
  if (m) return { kind: 'MC', n: Number(m[1]) };
  return { kind: cell as 'NMC' | 'PTC' };
}

function ift(column: number, finalDr: number): IftResult {
  const row = IFT[column];
  if (!row) throw new Error(`no IFT column ${column}`);
  return parseIft(row[Math.max(0, finalDr)]);
}

/** Leader Creation drm by nationality (the chart lists U.S./British/German −1, Russian/Italian/GMD +1). */
const LC_NATIONALITY_DRM: Record<string, number> = { ge: -1, am: -1, br: -1, ru: 1, it: 1, al: 0 };

/**
 * Leader Creation Table (SK1 5.3): final dr ≤1 → 8-1, 2–3 → 8-0, 4–5 → 7-0, 6 → 6+1, ≥7 none.
 *
 * The VASL (full ASL) chart also lists −1 for Morale ≥8 and −1 per CC odds column below 1:1.
 * The SK4 (2021) CC example applies the odds drm ("+1 drm/Russian, and -1 drm/odds < 1:1" for a
 * 4-4-7 attacking at 1:2), so it is included. An older SK1 example (a Russian 4-5-8 attacking at
 * 1:2, dr 1 → 8-0) fits neither drm; the Morale ≥8 drm stays omitted for want of a Starter Kit
 * source. Morale ≤6 and Broken (+1 each) are kept.
 */
function leaderCreation(nationality: string, unitMorale: number, dr: number, broken = false, ccColumnsBelowEven = 0): string | null {
  // TODO(ASLRB A18.2): the Leader Creation Table's "-1 Base unit has Morale Level ≥ 8" drm is not
  // applied (SK reading). Ledger row A18.2 tracks it.
  const final = dr + (LC_NATIONALITY_DRM[nationality] ?? 0) + (unitMorale <= 6 ? 1 : 0) + (broken ? 1 : 0) - ccColumnsBelowEven;
  if (final <= 1) return `${nationality}.L81`;
  if (final <= 3) return `${nationality}.L80`;
  if (final <= 5) return `${nationality}.L70`;
  if (final === 6) return `${nationality}.L61`;
  return null;
}

/*
 * To Hit Chart (SK4 3.2.4), transcribed from the ASLSK Combat Charts (German, American, Russian,
 * British, and the Italian & Axis/Allied Minors chart; the Japanese chart is still to do). A row is keyed "<nat>:<caliber><barrel>"
 * as the chart's Gun Type column prints it. `fp` is the chart's "FP Column (ITT/ATT/CH)"; `itt` has one
 * cell per range band 1 / 2 / 3-6 / 7-12 / 13-18 / 19-24 ("7|6(3|2)" = black 7 CH 3, red 6 CH 2);
 * `att` the red TH# for 1-12 and 13-24 (null where the chart prints NA), with the ranges a mortar
 * cannot fire at as `attNa`.
 */
interface ToHitRow {
  fp: { itt?: number; att?: number; ch?: number };
  itt?: (ToHitEntry | null)[];
  att?: [number, number | null];
  /** Vehicle Target Type TH# per range band 1-6 / 7-12 / 13-18 / 19-24 (SK4 3.2.4); a Critical Hit is an original 2. */
  vtt?: (ToHitEntry | null)[];
  /** Ranges the ATT entry does not cover (mortar minimum/maximum range), as [from, to] pairs. */
  attNa?: [number, number][];
}
/** The To Hit Chart range bands: Infantry Target Type, then Area Target Type. */
export const ITT_BANDS: [number, number][] = [[1, 1], [2, 2], [3, 6], [7, 12], [13, 18], [19, 24]];
export const ATT_BANDS: [number, number][] = [[1, 12], [13, 24]];
export const VTT_BANDS: [number, number][] = [[1, 6], [7, 12], [13, 18], [19, 24]];

/** "10 9|8 6|5 -" → VTT cells: black (and red) TH#, "-" none. */
const vtt = (s: string): (ToHitEntry | null)[] =>
  s.split(' ').map((c) => {
    if (c === '-') return null;
    const [b, r] = c.split('|').map(Number) as [number, number | undefined];
    return { black: b, ch: 2, ...(r !== undefined ? { red: r, chRed: 2 } : {}) };
  });

/** "10(5)" → black 10 CH 5; "7|6(3|2)" → black 7 CH 3, red 6 CH 2. */
function cell(s: string): ToHitEntry {
  const m = /^(\d+)(?:\|(\d+))?\((\d+)(?:\|(\d+))?\)$/.exec(s);
  if (!m) throw new Error(`bad To Hit cell ${s}`);
  return { black: Number(m[1]), ch: Number(m[3]), ...(m[2] ? { red: Number(m[2]), chRed: Number(m[4]) } : {}) };
}
const itt = (s: string) => s.split(' ').map(cell);
const row = (fp: [number | null, number | null, number | null], ittCells?: string, att?: [number, number | null], attNa?: [number, number][], vttCells?: string): ToHitRow => ({
  fp: { ...(fp[0] !== null ? { itt: fp[0] } : {}), ...(fp[1] !== null ? { att: fp[1] } : {}), ...(fp[2] !== null ? { ch: fp[2] } : {}) },
  ...(ittCells ? { itt: itt(ittCells) } : {}),
  ...(att ? { att } : {}),
  ...(attNa ? { attNa } : {}),
  ...(vttCells ? { vtt: vtt(vttCells) } : {}),
});

export const TO_HIT: Record<string, ToHitRow> = {
  // "All MG" row: a MG firing at an AFV as ordnance (SK4 4.1), within normal range; no Critical Hit (Ω).
  'MG': row([null, null, null], undefined, undefined, undefined, '10 9|8 6|5 -'),
  // "All ATR" row (SK4 4.4.4): the Vehicle Target Type only (ITT "--", ATT "NA"); its 1/--/2 FP Column
  // is the ATR's IFT use, which goes through the IFT as a 1 FP SW, not this row. Range 12 at most.
  'ATR': row([null, null, null], undefined, undefined, undefined, '10 8 6 5'),
  // British chart
  'br:37LL': row([4, 2, 8], '10(5) 9(4) 8(3) 7(3) 5(2) 4(1)', [7, 7], undefined, '10 9 7 6'),
  // "British 40L is AP only use 2/--/4 FP Column": no Area Target Type.
  'br:40L': row([2, null, 4], '10(5) 9(4) 8(3) 7|6(3|2) 5|4(2|1) 4|3(1|1)', undefined, undefined, '10 9|8 7|6 6|5'),
  'br:51': row([null, 2, 12], undefined, [7, 6], [[1, 2], [21, 24]]),
  'br:57L': row([6, 2, 12], '10(5) 9(4) 8(3) 7|6(3|2) 6|5(2|2) 5|4(2|1)', [7, 8], undefined, '10 9|8 8|7 7|6'),
  'br:75': row([12, 6, 24], '10(5) 9(4) 8(3) 7(3) 6(2) 5(2)', [7, 8], undefined, '10 9 8 7'),
  'br:76*': row([null, 6, 24], undefined, [7, 7], [[1, 2]]),
  'br:76LL': row([12, 6, 24], '10(5) 9(4) 8(3) 7(3) 7(3) 6(2)', [7, 9], undefined, '10 9 9 8'),
  'br:77L': row([12, 6, 24], '10(5) 9(4) 8(3) 7(3) 7(3) 6(2)', [7, 9], undefined, '10 9 9 8'),
  'br:88': row([16, 8, 30], '10(5) 9(4) 8(3) 7|6(3|2) 6|5(2|2) 5|4(2|1)', [7, 8], undefined, '10 9|8 8|7 7|6'),
  'br:95*': row([16, 8, 30], '10(5) 9(4) 8(3) 7(3) 5(2) 4(2)', [7, 7], undefined, '10 9 7 6'),
  // German chart
  'ge:20L': row([1, null, 2], '10(5) 9(4) 8(3) 7(3) 5(2) 4(1)', [7, 7], undefined, '10 9 7 6'),
  'ge:37': row([4, 2, 8], '10(5) 9(4) 8(3) 7(3) 4(2) 3(1)', [7, 6], undefined, '10 9 6 5'),
  'ge:37L': row([4, 2, 8], '10(5) 9(4) 8(3) 7|6(3|2) 5|4(2|1) 4|3(1|1)', [7, 7], undefined, '10 9|8 7|6 6|5'),
  'ge:50*': row([null, 2, 12], undefined, [7, 6], [[1, 2], [21, 24]]),
  'ge:50': row([6, 2, 12], '10(5) 9(4) 8(3) 7(3) 5(2) 4(1)', [7, 7], undefined, '10 9 7 6'),
  'ge:50L': row([6, 2, 12], '10(5) 9(4) 8(3) 7|6(3|2) 6|5(2|2) 5|4(2|1)', [7, 8], undefined, '10 9|8 8|7 7|6'),
  'ge:75*': row([12, 6, 24], '10(5) 9(4) 8(3) 7(3) 5(2) 4(2)', [7, 7], undefined, '10 9 7 6'),
  'ge:75L': row([12, 6, 24], '10(5) 9(4) 8(3) 7|6(3|2) 7|6(3|2) 6|5(2|2)', [7, 9], undefined, '10 9|8 9|8 8|7'),
  'ge:75LL': row([12, 6, 24], '10(5) 9(4) 8(3) 7(3) 7(3) 6(2)', [7, 9], undefined, '10 9 9 8'),
  'ge:81*': row([null, 8, 30], undefined, [7, 7], [[1, 2]]),
  'ge:88L': row([16, 8, 30], '10(5) 9(4) 8(3) 7(3) 7(3) 6(2)', [7, 9], undefined, '10 9 9 8'),
  'ge:88LL': row([16, 8, 30], '10(5) 9(4) 8(3) 7|6(3|2) 7|6(3|2) 6|5(2|2)', [7, 9], undefined, '10 9|8 9|8 8|7'),
  'ge:105': row([20, 8, 36], '10(5) 9(4) 8(3) 7(3) 6(2) 5(2)', [7, 8], undefined, '10 9 8 7'),
  // American chart. The chart prints one "37LL/37L" row for both barrels.
  'am:37LL': row([4, 2, 8], '10(5) 9(4) 8(3) 7|6(3|2) 5|4(2|1) 4|3(1|1)', [7, 7], undefined, '10 9|8 7|6 6|5'),
  'am:37L': row([4, 2, 8], '10(5) 9(4) 8(3) 7|6(3|2) 5|4(2|1) 4|3(1|1)', [7, 7], undefined, '10 9|8 7|6 6|5'),
  // "American and British 57L has Limited HE; use values in [brackets] for AP ammunition":
  // FP Column 6[2]/2[--]/12[4]; the HE column is kept here, as for 'br:57L'.
  'am:57L': row([6, 2, 12], '10(5) 9(4) 8(3) 7|6(3|2) 6|5(2|2) 5|4(2|1)', [7, 8], undefined, '10 9|8 8|7 7|6'),
  'am:60*': row([null, 4, 16], undefined, [7, 7], [[1, 2]]),
  'am:75': row([12, 6, 24], '10(5) 9(4) 8(3) 7(3) 6(2) 5(2)', [7, 8], undefined, '10 9 8 7'),
  'am:76L': row([12, 6, 24], '10(5) 9(4) 8(3) 7(3) 7(3) 6(2)', [7, 9], undefined, '10 9 9 8'),
  'am:81*': row([null, 8, 30], undefined, [7, 7], [[1, 2]]),
  'am:105': row([20, 8, 36], '10(5) 9(4) 8(3) 7(3) 6(2) 5(2)', [7, 8], undefined, '10 9 8 7'),
  'am:155': row([30, 12, 36], '10(5) 9(4) 8(3) 7|6(3|2) 6|5(2|2) 5|4(2|1)', [7, 8], undefined, '10 9 8 7'),
  // Russian chart. Most Russian 7-24 ITT cells are printed in red only (Russian MA/Guns always use
  // the red TH#); they are encoded as a single number, which the red lookup falls back to.
  'ru:82*': row([null, 8, 30], undefined, [7, 7], [[1, 2]]),
  // Japanese chart (ASLSK Combat Charts p.10). The 50* (Type 89 grenade discharger) has no ITT and no Vehicle
  // Target Type; its Area Target Type is NA at 17–24.
  'ja:37': row([4, 2, 8], '10(5) 9(4) 8(3) 7(3) 4(1) 3(1)', [7, 6], undefined, '10 9 6 5'),
  'ja:47L': row([4, 2, 8], '10(5) 9(4) 8(3) 7(3) 6(2) 5(2)', [7, 8], undefined, '10 9 8 7'),
  'ja:50*': row([null, 2, 12], undefined, [7, 6], [[17, 24]]),
  'ja:57*': row([6, 2, 12], '10(5) 9(4) 8(3) 7(3) 4(1) 3(1)', [7, 6], undefined, '10 9 6 5'),
  'ja:70*': row([12, 6, 24], '10(5) 9(4) 8(3) 7|6(3|2) 5|4(2|1) 4|3(1|1)', [7, 7], undefined, '10 9|8 7|6 6|5'),
  'ru:45L': row([4, 2, 8], '10(5) 9(4) 8(3) 6(2) 5(2) 4(2)', [7, 8], undefined, '10 8 7 6'),
  'ru:50*': row([null, 2, 12], undefined, [7, 6], [[1, 2], [21, 24]]),
  'ru:57LL': row([6, 2, 12], '10(5) 9(4) 8(3) 6(2) 5(2) 4(2)', [7, 8], undefined, '10 8 7 6'),
  'ru:76*': row([12, 6, 24], '10(5) 9(4) 8(3) 6(2) 4(1) 3(1)', [7, 7], undefined, '10 8 6 5'),
  'ru:75': row([12, 6, 24], '10(5) 9(4) 8(3) 7|6(3|2) 6|5(2|2) 5|4(2|1)', [7, 8], undefined, '10 9|8 8|7 7|6'),
  'ru:76L': row([12, 6, 24], '10(5) 9(4) 8(3) 6(2) 6(2) 5(2)', [7, 9], undefined, '10 8 8 7'),
  'ru:85L': row([16, 8, 30], '10(5) 9(4) 8(3) 6(2) 6(2) 5(2)', [7, 9], undefined, '10 8 8 7'),
  'ru:122L': row([24, 12, 36], '10(5) 9(4) 8(3) 6(2) 5(2) 4(1)', [7, 8], undefined, '10 8 7 6'),
  'ru:152*': row([30, 12, 36], '10(5) 9(4) 8(3) 6(2) 4(2) 3(1)', [7, 7], undefined, '10 8 6 5'),
  // Italian & Axis/Allied Minors chart. Their MA/Guns always use the red TH# (the 7-24 ITT cells are
  // printed in red only); the Allied Minor 46* fires at 2-12 only ("7(NA 1)", "NA" for 13-24).
  'al:46*': row([null, 2, 8], undefined, [7, null], [[1, 1]]),
  'ax:81*': row([null, 8, 30], undefined, [7, 7], [[1, 2]]),
  'it:37*': row([4, 2, 8], '10(5) 9(4) 8(3) 6(2) 2(1) 1(1)', [7, 5], undefined, '10 8 4 3'),
  'it:45*': row([null, 2, 8], undefined, [7, 7], [[1, 1], [14, 24]]),
  'it:47': row([4, 2, 8], '10(5) 9(4) 8(3) 6(2) 4(1) 3(1)', [7, 7], undefined, '10 8 6 5'),
  'it:75*': row([12, 6, 24], '10(5) 9(4) 8(3) 6(2) 4(1) 3(1)', [7, 7], undefined, '10 8 6 5'),
  'it:105': row([20, 8, 36], '10(5) 9(4) 8(3) 6(2) 5(2) 4(1)', [7, 8], undefined, '10 8 7 6'),
};

/*
 * To Kill Tables (SK4 7.9; ASLSK Combat Charts p.12). AP by Gun Type and range band 0-1 / 2 / 3-6 /
 * 7-12 / 13-18 / 19-24, the APCR (or APDS) number in parentheses where the Gun has it; HEAT by
 * caliber; HE and Flame by caliber band (plus DC and FT). The Final TK# is the TK# less the Armor
 * Factor hit; rear facing +1, a Critical Hit doubles the TK#.
 */
const AP_TK_BANDS: [number, number][] = [[0, 1], [2, 2], [3, 6], [7, 12], [13, 18], [19, 24]];
const tk = (s: string): { ap: number | null; special: number | null }[] =>
  s.split(' ').map((c) => {
    if (c === '-') return { ap: null, special: null };
    const m = /^(\d+)(?:\((\d+)\))?$/.exec(c)!;
    return { ap: Number(m[1]), special: m[2] ? Number(m[2]) : null };
  });
/** Keyed by the chart's Gun Type ("75L"; "ru:76L" for the Russian 76L row; "MG"; "ATR:ge"). */
export const TO_KILL_AP: Record<string, { ap: number | null; special: number | null }[]> = {
  MG: tk('6 5 5 4 4 -'),
  '12.7': tk('7 6 6 5 5 -'),
  'ATR:ge': tk('7 6 6 5 - -'),
  'ATR:pl': tk('7 6 6 5 - -'),
  'ATR:ru': tk('8 7 7 6 - -'),
  '20L': tk('8 7 7 6 6 5'),
  '37': tk('9 9 8 8 8 7'),
  '57*': tk('9 9 8 8 8 7'),
  '70*': tk('9 8 8 8 8 7'),
  '37*': tk('8 8 7 7 7 6'),
  '37L': tk('10(13) 10(12) 9(11) 9(10) 9(8) 8(6)'),
  '37LL': tk('12 12 11 11 11 10'),
  '40L': tk('11 11 10 10 10 9'),
  '45L': tk('11(15) 11(14) 10(13) 10(12) 10(10) 9(8)'),
  '47': tk('11 11 10 10 10 9'),
  '50': tk('12(17) 12(16) 11(15) 11(14) 11(12) 10(8)'),
  '47L': tk('12(17) 12(16) 11(15) 11(14) 11(12) 10(8)'),
  '50L': tk('14(20) 14(19) 13(18) 13(17) 13(15) 12(13)'),
  '57L': tk('16(19) 16(18) 15(18) 15(18) 15(18) 14(18)'),
  '57LL': tk('16(21) 16(20) 15(19) 15(18) 15(16) 14(14)'),
  '75': tk('15 14 14 14 14 13'),
  '75*': tk('11 10 10 10 10 9'),
  '75L': tk('18(23) 17(22) 17(21) 17(20) 17(19) 16(17)'),
  '75LL': tk('24 23 23 23 23 22'),
  '76*': tk('10 9 9 9 9 8'),
  '76L': tk('18(25) 17(24) 17(23) 17(22) 17(21) 16(19)'),
  'ru:76L': tk('14(17) 13(16) 13(15) 13(14) 13(13) 12(11)'),
  '76LL': tk('24(26) 23(25) 23(25) 23(25) 23(25) 22(25)'),
  '77L': tk('20 19 19 19 19 18'),
  '85L': tk('18(22) 17(21) 17(20) 17(19) 17(18) 16(16)'),
  '88L': tk('21(26) 20(25) 20(24) 20(23) 20(22) 19(20)'),
  '88LL': tk('28 27 27 27 27 26'),
  '122L': tk('26 25 25 25 25 24'),
  '152*': tk('18 17 17 17 17 16'),
};
/** HE & Flame To Kill (no Mortars): the TK# of the first band the caliber reaches. */
export const TO_KILL_HE: [number, number][] = [[150, 16], [120, 12], [100, 10], [80, 8], [70, 7], [50, 6], [40, 5], [30, 4], [20, 3]];
export const TO_KILL_DC = 16;
export const TO_KILL_FT = 8;
/** HEAT To Kill by caliber (LATW carry theirs on the counter: BAZ43 13, BAZ44/45 16, PIAT 15, PSK 26, PF 31). */
export const TO_KILL_HEAT: Record<number, number> = { 37: 26, 75: 13, 76: 13, 95: 16, 105: 15, 122: 17 };

/** The AP To Kill Table key of a Gun: the chart's Gun Type, the Russian 76L its own row, a MG MA "MG". */
export const toKillKey = (def: Pick<GunDef, 'nationality' | 'caliber' | 'barrel' | 'type'>): string => {
  if (def.type === 'MG') return def.caliber >= 12 ? '12.7' : 'MG';
  if (def.type === 'ATR') return `ATR:${def.nationality}`;
  const k = `${def.caliber}${def.barrel ?? ''}`;
  return def.nationality === 'ru' && k === '76L' ? 'ru:76L' : k;
};

function toKill(def: GunDef, ammo: 'AP' | 'APCR' | 'APDS' | 'HEAT' | 'HE', range: number): number | null {
  if (ammo === 'HEAT') {
    if (def.latw?.tk !== undefined) return def.latw.tk;
    return TO_KILL_HEAT[def.caliber] ?? null;
  }
  if (ammo === 'HE') {
    if (def.type === 'MTR') return null;
    return TO_KILL_HE.find(([cal]) => def.caliber >= cal)?.[1] ?? null;
  }
  const r = TO_KILL_AP[toKillKey(def)];
  if (!r) return null;
  const i = AP_TK_BANDS.findIndex(([a, b]) => range >= a && range <= b);
  if (i < 0) return null;
  const cell = r[i]!;
  return ammo === 'AP' ? cell.ap : cell.special;
}

/** The chart's Gun Type key for a counter: "br:40L"; an Anti-Tank Rifle's "All ATR" row. */
export const toHitKey = (def: GunDef) => (def.type === 'ATR' ? 'ATR' : `${def.nationality}:${def.caliber}${def.barrel ?? ''}`);

function toHit(def: GunDef, targetType: 'ITT' | 'ATT' | 'VTT', range: number): ToHitEntry | null {
  const r = TO_HIT[def.type === 'MG' ? 'MG' : toHitKey(def)];
  if (!r) throw new Error(`No To Hit Chart row for ${def.id} (${toHitKey(def)})`);
  if (targetType === 'VTT') {
    const i = VTT_BANDS.findIndex(([a, b]) => range >= a && range <= b);
    return i < 0 ? null : (r.vtt?.[i] ?? null);
  }
  if (targetType === 'ITT') {
    const i = ITT_BANDS.findIndex(([a, b]) => range >= a && range <= b);
    return i < 0 ? null : (r.itt?.[i] ?? null);
  }
  if (!r.att) return null;
  // A Mortar's range is printed on its counter (SK4 6.9) and governs where it does: the chart's "NA"
  // ranges apply only to a Mortar whose def carries none. (The chart marks the German 50* "NA 1-2",
  // but SK4 To Hit Example #2 fires it at range 2, as its [2-13] counter allows.)
  if (def.minRange === undefined && r.attNa?.some(([a, b]) => range >= a && range <= b)) return null;
  const i = ATT_BANDS.findIndex(([a, b]) => range >= a && range <= b);
  if (i < 0) return null;
  const th = r.att[i];
  if (th === null || th === undefined) return null;
  // Area Target Type: red TH#, Critical Hit on an original 2 (SK4 6.1).
  return { black: th, ch: 2, red: th, chRed: 2 };
}

function gunColumn(def: GunDef, targetType: 'ITT' | 'ATT' | 'CH'): number | null {
  const r = TO_HIT[toHitKey(def)];
  if (!r) throw new Error(`No To Hit Chart row for ${def.id} (${toHitKey(def)})`);
  const c = targetType === 'ITT' ? r.fp.itt : targetType === 'ATT' ? r.fp.att : r.fp.ch;
  return c ?? null;
}

export const SK1_TABLES: Tables = {
  iftColumns: IFT_COLUMNS,
  ift,
  ccOddsColumns: CC_KILL.map(([c]) => c),
  ccKill: (odds) => CC_KILL.find(([c]) => c === odds)?.[1] ?? 0,
  // The Hand-to-Hand chart (ASLSK Combat Charts p.14, "HTH KILL #": 2 … 15): each column's kill number two higher.
  ccKillHth: (odds) => (CC_KILL.find(([c]) => c === odds) ? CC_KILL.find(([c]) => c === odds)![1] + 2 : 0),
  leaderCreation,
  toHit,
  gunColumn,
  toKill,
};
