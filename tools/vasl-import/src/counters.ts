/**
 * Derives counter definitions from the VASL module:
 *  - printed values from each counter SVG's <text> elements (ids: Firepower, Range,
 *    Morale, SmokeExponent, AssaultFire/ELR underlines, "Self rally" box, leader Values),
 *  - quality, ELR replacement and Casualty Reduction from buildFile layer chains
 *    (squads, half-squads and broken sides are listed in parallel per family).
 */
import type { AmmoKind, CounterDef, GunDef, GunType, MmcDef, SmcDef, SpecialAmmoDef, SwDef, SwType, UnitQuality } from '@asl/rules';

export interface Chain {
  images: string[];
  names: string[];
}

const IMG_LIST = /((?:[a-z]{2}\\*\/[A-Za-z0-9]+\.svg)(?:,(?:[a-z]{2}\\*\/[A-Za-z0-9]+\.svg))*);([^;]*)/g;

/** Extract every image-list layer (emb2) from a piece slot's type string. */
export function chainsFromSlot(text: string): Chain[] {
  const out: Chain[] = [];
  for (const m of text.matchAll(IMG_LIST)) {
    // Image names without their extension: the Japanese leader layer mixes .svg and .gif art.
    const images = m[1]!.split(',').map((s) => s.replace(/\\/g, '').replace(/\.(svg|gif|png)$/, '').split('/').pop()!);
    const names = m[2]!.split(',').map((s) => s.replace(/\\/g, '').trim());
    out.push({ images, names });
  }
  return out;
}

/** All PieceSlot type strings in a buildFile. */
export function pieceSlots(buildFile: string): string[] {
  const out: string[] = [];
  const re = /<VASSAL\.build\.widget\.PieceSlot\b[^>]*>([\s\S]*?)<\/VASSAL\.build\.widget\.PieceSlot>/g;
  for (const m of buildFile.matchAll(re)) out.push(decodeXml(m[1]!));
  return out;
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// ------------------------------------------------------------------ SVG parsing

const textById = (svg: string, id: string) => {
  const m = new RegExp(`<text[^>]*id="${id}"[^>]*>([^<]*)</text>`).exec(svg);
  return m ? m[1]!.trim() : undefined;
};
const hasVisible = (svg: string, id: string) => {
  const m = new RegExp(`<(?:line|rect)[^>]*id="${id}"[^>]*>`).exec(svg);
  return !!m && !/display:\s*none/.test(m[0]) && !/stroke-opacity:\s*0[;"]/.test(m[0]);
};
/** Text content of all <text> elements with <tspan>s flattened. */
const allTexts = (svg: string) =>
  [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
/** Class letter is drawn in a nested <svg> as a tspan. */
const classLetter = (svg: string) => {
  const m = /<tspan[^>]*>([E12GC])<\/tspan>/.exec(svg);
  return m?.[1] as UnitQuality | undefined;
};

export interface MmcValues {
  fp: number;
  range: number;
  morale: number;
  smoke?: number;
  assaultFire: boolean;
  elrExempt: boolean;
  quality?: UnitQuality;
}

export function parseMmcSvg(svg: string): MmcValues | null {
  const fp = textById(svg, 'Firepower');
  const range = textById(svg, 'Range');
  const morale = textById(svg, 'Morale');
  if (!fp || !range || !morale) return null;
  const smoke = textById(svg, 'SmokeExponent');
  return {
    fp: Number(fp),
    range: Number(range),
    morale: Number(morale),
    ...(smoke ? { smoke: Number(smoke) } : {}),
    assaultFire: hasVisible(svg, 'AssaultFire'),
    elrExempt: hasVisible(svg, 'ELR'),
    ...(classLetter(svg) ? { quality: classLetter(svg)! } : {}),
  };
}

export function parseBrokenSvg(svg: string): { morale: number; selfRally: boolean } | null {
  const morale = textById(svg, 'Morale');
  if (!morale) return null;
  return { morale: Number(morale), selfRally: /id="Self rally"/.test(svg) };
}

export function parseLeaderSvg(svg: string): { morale: number; leadership: number } | null {
  const v = textById(svg, 'Values');
  const m = v && /^(\d+)([-+]\d|-0|0)$/.exec(v.replace(/\s/g, ''));
  if (!m) {
    const parts = v?.split('-');
    if (parts?.length === 2) return { morale: Number(parts[0]), leadership: -Number(parts[1]) };
    return null;
  }
  // "9-2" → morale 9, leadership -2; "8+1" → +1; "8-0" → 0.
  const lead = m[2]!;
  return { morale: Number(m[1]), leadership: lead.startsWith('+') ? Number(lead.slice(1)) : -Number(lead.replace('-', '')) };
}

export function parseSwSvg(front: string, back: string | undefined): Omit<SwDef, 'id' | 'nationality'> | null {
  const texts = allTexts(front);
  const type = texts[0] as SwType;
  if (!['LMG', 'MMG', 'HMG', 'FT', 'DC', 'ATR'].includes(type)) return null;
  const fpr = texts.find((t) => /^\d+-\d+$/.test(t));
  const pp = texts.find((t) => /^\d+PP$/.test(t));
  const b = texts.find((t) => /^B\d+$/.test(t));
  const x = texts.find((t) => /^X\d+$/.test(t));
  // ROF is the boxed number (the nested svg with a rect).
  const rofM = /<svg[^>]*>\s*<rect[^>]*\/>\s*<text[^>]*>(\d)<\/text>/.exec(front);
  const backTexts = back ? allTexts(back) : [];
  const repair = backTexts.find((t) => /^R\d$/.test(t));
  const removal = backTexts.find((t) => /^X\d$/.test(t));
  if (!fpr || !pp) return null;
  const [fp, range] = fpr.split('-').map(Number) as [number, number];
  return {
    kind: 'sw',
    type,
    fp,
    range,
    pp: Number(pp.replace('PP', '')),
    ...(rofM ? { rof: Number(rofM[1]) } : {}),
    ...(b ? { b: Number(b.slice(1)) } : {}),
    ...(x ? { x: Number(x.slice(1)) } : {}),
    ...(repair ? { repair: Number(repair.slice(1)) } : {}),
    ...(removal === 'X6' ? { removeOnRepair6: true } : {}),
  };
}

/**
 * Light Mortar SW (SK4 4.5) from its 1/2" counter: "MTR", the caliber with a superscript ✽ for the
 * chart's "50*", the range in brackets ("[2-13]"), the PP and the boxed ROF; the back's repair and
 * removal numbers. A Mortar has no FP of its own: `fp` is 0 and `range` its maximum range.
 */
export function parseSwMortarSvg(front: string, back: string | undefined, info: string): Omit<SwDef, 'id' | 'nationality'> | null {
  const texts = allTexts(front);
  if (texts[0] !== 'MTR') return null;
  // "<tspan>50</tspan><tspan …super>✽</tspan>" (or a bare "51"), the first text after the "MTR" label.
  const cal = /<text[^>]*>(?:<tspan[^>]*>)?(\d+)(?:<\/tspan>)?(?:<tspan[^>]*>(&#x273D;|✽)<\/tspan>)?<\/text>/.exec(front.slice(front.indexOf('>MTR<')));
  // The Japanese 50mm MTR prints "[1-16]*" and "2*": the asterisks are the counter's own notes (SK4 Chapter H), not data.
  const star = (t: string) => t.replace(/&#x0*2[aA];/g, '*');
  const range = /^\[(\d+)-(\d+)\]\*?$/.exec(star(texts.find((t) => /^\[\d+-\d+\](?:\*|&#x0*2[aA];)?$/.test(t)) ?? ''));
  const pp = texts.find((t) => /^\d+PP$/.test(t));
  // The boxed ROF: the number drawn over the ROF block's square.
  const rof = /<rect[^>]*\/?>\s*(?:<\/rect>)?\s*<text[^>]*>(\d)(?:\*|&#x0*2[aA];)?<\/text>/.exec(block(front, 'ROF'))?.[1];
  if (!cal || !range || !pp) return null;
  const backTexts = back ? allTexts(back) : [];
  const repair = backTexts.find((t) => /^R\d$/.test(t));
  const removal = backTexts.find((t) => /^X\d$/.test(t));
  const { specialAmmo } = parseGunInfo(info);
  return {
    kind: 'sw',
    type: 'MTR',
    ordnance: {
      caliber: Number(cal[1]),
      ...(cal[2] ? { barrel: '*' as const } : {}),
      minRange: Number(range[1]),
      maxRange: Number(range[2]),
      ...(specialAmmo.length ? { specialAmmo } : {}),
    },
    fp: 0,
    range: Number(range[2]),
    pp: Number(pp.replace('PP', '')),
    ...(rof ? { rof: Number(rof) } : {}),
    ...(repair ? { repair: Number(repair.slice(1)) } : {}),
    ...(removal === 'X6' ? { removeOnRepair6: true } : {}),
  };
}

/**
 * Light Anti-Tank Weapon SW (SK4 4.4) from its 1/2" counter: the name ("BAZ43"), the FP and range
 * ("8-4"), the PP, the HEAT To Kill number ("13TK") and the removal number ("X10"); the back carries
 * the weapon's own To Hit Table, one TH# per range from 0.
 */
export function parseSwLatwSvg(front: string, back: string | undefined): Omit<SwDef, 'id' | 'nationality'> | null {
  const texts = allTexts(front);
  const type = /^(BAZ|PSK|PIAT|PF)/.exec(texts[0] ?? '')?.[1] as 'BAZ' | 'PSK' | 'PIAT' | 'PF' | undefined;
  const fpRange = /^(\d+)-(\d+)$/.exec(texts.find((t) => /^\d+-\d+$/.test(t)) ?? '');
  const pp = texts.find((t) => /^\d+PP$/.test(t));
  const tk = texts.find((t) => /^\d+TK$/.test(t));
  const x = texts.find((t) => /^X\d+$/.test(t));
  // A PIAT has a B# instead (SK4 4.4.5): it malfunctions, and its back gives the repair ("R2") and removal ("X6") numbers.
  const b = texts.find((t) => /^B\d+$/.test(t));
  // A Panzerfaust is no counter one carries (SK4 4.4.2): no PP printed.
  if (!type || !fpRange || (!pp && type !== 'PF') || !back) return null;
  const backTexts = allTexts(back);
  const repair = backTexts.find((t) => /^R\d$/.test(t));
  // Back: "Range", "TH#", the ranges 0..n, then a TH# per range.
  const bt = backTexts.filter((t) => /^\d+$/.test(t)).map(Number);
  const n = bt.length / 2;
  if (!Number.isInteger(n) || bt.slice(0, n).some((r, i) => r !== i)) return null;
  return {
    kind: 'sw',
    type,
    fp: Number(fpRange[1]),
    range: Number(fpRange[2]),
    pp: pp ? Number(pp.replace('PP', '')) : 0,
    ...(x ? { x: Number(x.slice(1)) } : {}),
    ...(b ? { b: Number(b.slice(1)) } : {}),
    ...(b && repair ? { repair: Number(repair.slice(1)) } : {}),
    ...(b && backTexts.includes('X6') ? { removeOnRepair6: true } : {}),
    latw: { th: bt.slice(n), ...(tk ? { tk: Number(tk.replace('TK', '')) } : {}) },
  };
}

/** The `info` trait of the first buildFile piece whose art includes `<image>.svg` (or its back), by image name. */
export function pieceInfos(buildFile: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<VASSAL\.build\.widget\.PieceSlot\b[^>]*>([\s\S]*?)<\/VASSAL\.build\.widget\.PieceSlot>/g;
  for (const m of buildFile.matchAll(re)) {
    const body = decodeXml(m[1]!);
    const info = (/info;([^\t]*)/.exec(body)?.[1] ?? '').replace(/\\+$/, '').replace(/\\\//g, '/');
    for (const img of body.matchAll(/[a-z]{2}\\*\/([A-Za-z0-9_]+)\.svg/g)) if (!out.has(img[1]!)) out.set(img[1]!, info);
  }
  return out;
}

/** Crew piece: the base image (`br228C`) and its broken-side layer (`brc8b`) from a PieceSlot. */
export function crewFromSlot(text: string): { front: string; back?: string } | null {
  const m = /piece;K;D;([a-z]{2})\\*\/(\1\d{3}C)\.svg/.exec(text);
  if (!m) return null;
  const b = /([a-z]{2})\\*\/(\1c\d+b)\.svg/.exec(text);
  return { front: m[2]!, ...(b ? { back: b[2]! } : {}) };
}

/** Text content of a commented block (`<!-- ROF -->` ... up to the next `</svg>`). */
const block = (svg: string, comment: string) => {
  const i = svg.indexOf(`<!-- ${comment}`);
  if (i < 0) return '';
  const j = svg.indexOf('</svg>', i);
  return j < 0 ? svg.slice(i) : svg.slice(i, j);
};

/**
 * Gun values from a VASL 5/8" ordnance counter: caliber and barrel length with the IFE in
 * parentheses ("40L(8)"), the boxed ROF, the type ("AA"), the manhandling number ("M8", red for a
 * large target, on a white circle for a small one), the white circle of a 360° mount; the back's
 * repair/removal numbers; the limbered side's existence (a QSU Gun has none).
 */
export function parseGunSvg(front: string, back: string | undefined, limbered: string | undefined): Omit<GunDef, 'id' | 'nationality'> | null {
  const maBlock = block(front, 'MA');
  // "75" + a superscript ✽ is the chart's "75*"; an overline means no AP, an underline no HE (SK4 6.0).
  const ma = /<text[^>]*>(\d+)(L{1,2})?(?:<tspan[^>]*>(&#x273D;|✽)<\/tspan>)?(?:<tspan[^>]*>\((\d+)\)<\/tspan>)?<\/text>/.exec(maBlock);
  const type = /<text[^>]*>(AA|AT|INF|ART|MTR)<\/text>/.exec(block(front, 'Gun Type'))?.[1] as GunType | undefined;
  // "M8" as two tspans, or (most counters) the number alone in the "Manhandling #" block beside an "M".
  const mm =
    /<tspan([^>]*)>M<\/tspan><tspan([^>]*)>(\d+)<\/tspan>/.exec(front) ??
    ((t) => (t ? ([t[0], '', t[1]!, t[2]!] as unknown as RegExpExecArray) : null))(/<text([^>]*)>(\d+)<\/text>/.exec(block(front, 'Manhandling #')));
  if (!ma || !type || !mm) return null;
  const rof = /<tspan[^>]*>(\d)<\/tspan><\/text>\s*<rect/.exec(block(front, 'ROF'))?.[1];
  const mount = /stroke:white/.test(block(front, 'Fast Turret')) ? '360' : 'NT';
  const large = /fill:\s*(red|#ff0000|#f00)/i.test(mm[2]!);
  const small = /<circle[^>]*r="(?:[0-7](?:\.\d+)?)"[^>]*style="(?![^"]*display:\s*none)[^"]*fill:\s*white/i.test(block(front, 'Manhandling'));
  const backTexts = back ? allTexts(back) : [];
  const repair = backTexts.find((t) => /^R\d$/.test(t));
  const removal = backTexts.find((t) => /^X\d$/.test(t));
  const b = allTexts(front).find((t) => /^B\d+$/.test(t));
  const caliber = Number(ma[1]);
  const type2: GunType = type;
  const barrel = ma[3] ? '*' : ma[2];
  const range = /\[(\d+)-(\d+)\]/.exec(allTexts(front).join(' '));
  return {
    kind: 'gun',
    type: type2,
    caliber,
    ...(barrel ? { barrel: barrel as GunDef['barrel'] } : {}),
    ...(rof ? { rof: Number(rof) } : {}),
    ...(ma[4] ? { ife: Number(ma[4]) } : {}),
    m: Number(mm[3]),
    targetSize: large ? 'large' : small ? 'small' : 'normal',
    mount,
    qsu: !limbered || /QSU/.test(limbered),
    gunshield: type2 === 'AT' || type2 === 'INF',
    ammo: { he: !/<!-- underline -->/.test(maBlock), ap: type2 !== 'MTR' && !/<!-- overline -->/.test(maBlock) },
    ...(range ? { minRange: Number(range[1]), maxRange: Number(range[2]) } : {}),
    ...(b ? { b: Number(b.slice(1)) } : {}),
    ...(repair ? { repair: Number(repair.slice(1)) } : {}),
    ...(removal === 'X6' ? { removeOnRepair6: true } : {}),
  };
}

const AMMO_CODE: Record<string, AmmoKind> = { s: 'SMOKE', WP: 'WP', H: 'HEAT', A: 'APCR', D: 'APDS', HE: 'HE', AP: 'AP' };
/** Month letters in counter dates ("J4+E" is June 1944 in Europe, SK4 6.2). */
const MONTH: Record<string, number> = { F: 2, M: 3, J: 6, S: 9, O: 10, N: 11, D: 12 };

/** A counter date superscript: "2" → 1942, "J4+E" → June 1944 in Europe, "4+P" → 1944 on, PTO only. */
function parseDate(t: string): { from?: { year: number; month?: number }; theater?: 'ETO' | 'PTO' } {
  const m = /^([A-Z])?(\d)?\+?([EP])?$/.exec(t.trim());
  if (!m) return {};
  return {
    ...(m[2] ? { from: { year: 1940 + Number(m[2]), ...(m[1] && MONTH[m[1]] ? { month: MONTH[m[1]] } : {}) } } : {}),
    ...(m[3] ? { theater: m[3] === 'P' ? 'PTO' : 'ETO' } : {}),
  };
}

/**
 * The ammunition notes of a VASL Gun piece (its `info` trait, the counter's back): Special Ammo and
 * limited HE/AP with their Depletion Numbers, e.g. "QSU,s7,A5^2^/4^3^/3^4^" → Smoke 7, APCR 5 from
 * 1942, 4 from 1943, 3 from 1944; "No IF" → no Intensive Fire. Other notes (IR, Canister, h-d…)
 * are full ASL matters the Starter Kits do not use.
 */
export function parseGunInfo(info: string): { specialAmmo: SpecialAmmoDef[]; noIntensive: boolean } {
  const specialAmmo: SpecialAmmoDef[] = [];
  let noIntensive = false;
  for (const raw of info.split(',')) {
    const tok = raw.trim();
    if (/^no IF$/i.test(tok)) noIntensive = true;
    const m = /^(WP|HE|AP|s|H|A|D)(\d+)(?:\[\d+\])?(.*)$/.exec(tok);
    if (!m) continue;
    const kind = AMMO_CODE[m[1]!]!;
    // "^2^/4^3^/3^4^": the first number's date, then further "/n^date^" steps.
    const rest = m[3]!;
    const first = /^\^([^/^]*)\^?/.exec(rest);
    const d0 = first ? parseDate(first[1]!) : {};
    const steps: SpecialAmmoDef['steps'] = [{ n: Number(m[2]), ...(d0.from ? { from: d0.from } : {}) }];
    for (const s of rest.matchAll(/\/(\d+)\^([^/^]*)\^?/g)) {
      const d = parseDate(s[2]!);
      steps.push({ n: Number(s[1]), ...(d.from ? { from: d.from } : {}) });
    }
    specialAmmo.push({ kind, steps, ...(d0.theater ? { theater: d0.theater } : {}) });
  }
  return { specialAmmo, noIntensive };
}

export interface GunSlot {
  /** VASL front image name, e.g. "geAT75L". */
  image: string;
  /** The piece's name in the VASL palette, e.g. "75L AT PaK 40". */
  name: string;
  info: string;
}

/** Gun pieces in the buildFile (those with art under images/<nat>/gun/), with their info notes. */
export function gunSlots(buildFile: string): GunSlot[] {
  const out: GunSlot[] = [];
  const re = /<VASSAL\.build\.widget\.PieceSlot\b[^>]*entryName="([^"]*)"[^>]*>([\s\S]*?)<\/VASSAL\.build\.widget\.PieceSlot>/g;
  for (const m of buildFile.matchAll(re)) {
    const body = decodeXml(m[2]!);
    // The front is named on the base piece, or (limbered Guns) first in the limber layer.
    const img = /piece;K;D;([a-z]{2})\\*\/gun\\*\/([A-Za-z0-9_]+)\.svg/.exec(body) ?? /;([a-z]{2})\\*\/gun\\*\/([A-Za-z0-9_]+)\.svg,\1\\*\/gun\\*\/\2-l\.svg/.exec(body);
    if (!img) continue;
    // The trait runs to the next tab; VASL escapes its slashes ("A5^2^\\/4^3^").
    const info = (/info;([^\t]*)/.exec(body)?.[1] ?? '').replace(/\\+$/, '').replace(/\\\//g, '/');
    out.push({ image: img[2]!, name: decodeXml(m[1]!), info });
  }
  return out;
}

// ------------------------------------------------------------------ assembling defs

/** Our def id for a VASL image name, e.g. ge467S → ge.467, ge247H → ge.247h, geL92 → ge.L92, geLMG → ge.LMG. */
export function defIdFor(image: string): string | null {
  // MMC: nationality, strength factors, an optional mark before the kind letter (USMC Raiders `am558rS`, Paramarines
  // `am558pS`) and an optional one after it (`ge468Sae` assault engineers; the Japanese Reduced-Strength side
  // `ja348Sr`, `ja128Cr`, which gets its own def `ja.348r` / `ja.128cr`).
  const m = /^([a-z]{2})(\d{3})([a-z]*)([SHC])([a-z]*)$/.exec(image);
  if (m) {
    const kind = m[4] === 'H' ? 'h' : m[4] === 'C' ? 'c' : '';
    const tail = m[5] ?? '';
    const reduced = tail.startsWith('r') ? 'r' : '';
    const rest = tail.slice(reduced.length);
    return `${m[1]}.${m[2]}${m[3]}${kind}${reduced}${rest ? `.${rest}` : ''}`;
  }
  const g = /^([a-z]{2})(AA|AT|INF|ART|MTR)(\d+L{0,2}\*?)$/.exec(image);
  if (g) return `${g[1]}.${g[2]}${g[3]}`;
  // Leaders: `geL91`; a positive modifier is `p` (the Japanese 8+1 is `jaL8p1`).
  const l = /^([a-z]{2})(L\d+(?:p\d)?)$/.exec(image);
  if (l) return `${l[1]}.${l[2]}`;
  const s = /^([a-z]{2})(LMG|MMG|HMG|FT|DC)$/.exec(image);
  if (s) return `${s[1]}.${s[2]}`;
  return null;
}

const qualityFromName = (name: string): UnitQuality | undefined => {
  const m = /\d-\d-\d\s*([E12GC])(?:sq|hs)/.exec(name);
  return m?.[1] as UnitQuality | undefined;
};

export interface BuildInput {
  nationalities: string[];
  slots: string[];
  readSvg(image: string): string | undefined;
  /** Gun pieces to consider (`gunSlots`); a piece listed twice keeps its first entry. */
  guns?: GunSlot[];
  /** Read a gun SVG by its image name (directory images/<nat>/gun/). */
  readGunSvg?(image: string): string | undefined;
  /** Which parsed Guns to keep (e.g. those with a To Hit Chart row); all by default. */
  keepGun?(def: GunDef): boolean;
  /** Light Mortar SW to import, by VASL image name (e.g. "geMTR" → ge.MTR), with each piece's info notes. */
  mortars?: string[];
  /** LATW SW to import, by VASL image name (e.g. "amBAZ43" → am.BAZ43). */
  latw?: string[];
  infos?: Map<string, string>;
}

export interface CounterImport {
  counters: Record<string, CounterDef>;
  /** def id → VASL image names (front, back, limbered side) and the images/ subdirectory they live in. */
  images: Record<string, { front: string; back?: string; limbered?: string; dir?: string; backDir?: string }>;
  warnings: string[];
}

export function buildCounters({ nationalities, slots, readSvg, guns, readGunSvg, keepGun, mortars, latw, infos }: BuildInput): CounterImport {
  const counters: Record<string, CounterDef> = {};
  const images: CounterImport['images'] = {};
  const warnings: string[] = [];
  const natOk = (img: string) => nationalities.includes(img.slice(0, 2));

  const isSq = (i: string) => /^[a-z]{2}\d{3}[a-z]*S[a-z]*$/.test(i);
  const isHs = (i: string) => /^[a-z]{2}\d{3}[a-z]*H[a-z]*$/.test(i);
  /** Japanese squads and leaders have no broken side (SK4 8.1.1, 8.1.7): a missing broken layer is not a warning. */
  const noBrokenSide = (img: string) => img.startsWith('ja') && !isHs(img);
  const isBrSq = (i: string) => /^[a-z]{2}s\d+b$/.test(i);
  const isBrHs = (i: string) => /^[a-z]{2}h\d+b$/.test(i);

  for (const slot of slots) {
    const chains = chainsFromSlot(slot).filter((c) => c.images.every(natOk));
    if (chains.length === 0) continue;
    const unitChains = chains.filter((c) => c.images.every((i) => isSq(i) || isHs(i)));
    const brokenChains = chains.filter((c) => c.images.every((i) => isBrSq(i) || isBrHs(i)));
    // Leaders: `geL91`, the Japanese `jaL8p1`; the Japanese layer also carries each leader's wounded side (`jaL91w`,
    // SK4 8.1.7: wounded instead of broken), which is art, not a def.
    const isLeader = (i: string) => /^[a-z]{2}L\d+(?:p\d)?$/.test(i);
    const leaderChain = chains
      .filter((c) => c.images.every((i) => isLeader(i) || /^[a-z]{2}L\d+(?:p\d)?w$/.test(i)))
      .sort((a, b) => b.images.filter(isLeader).length - a.images.filter(isLeader).length)[0];
    const leaders = leaderChain && leaderChain.images.some(isLeader) ? { images: leaderChain.images.filter(isLeader), names: leaderChain.names } : undefined;

    for (const chain of unitChains) {
      const homogeneous = chain.images.every(isSq) || chain.images.every(isHs);
      chain.images.forEach((img, i) => {
        const id = defIdFor(img);
        if (!id || counters[id]) return;
        const kind = isSq(img) ? 'squad' : 'hs';
        const svg = readSvg(img);
        const v = svg ? parseMmcSvg(svg) : null;
        if (!v) {
          warnings.push(`no values for ${img}`);
          return;
        }
        // Broken side: a broken-image layer of the same length, same position.
        const bImg = brokenChains
          .filter((bc) => bc.images.length === chain.images.length)
          .map((bc) => bc.images[i]!)
          .find((bi) => (kind === 'squad' ? isBrSq(bi) : isBrHs(bi)));
        const b = bImg ? parseBrokenSvg(readSvg(bImg) ?? '') : null;
        // ELR: next step down in a homogeneous chain.
        const next = homogeneous ? chain.images[i + 1] : undefined;
        // Casualty Reduction: parallel HS chain, or the HS in a mixed SQ/HS layer.
        let red: string | undefined;
        if (kind === 'squad') {
          red = homogeneous
            ? unitChains.find((c) => c !== chain && c.images.length === chain.images.length && c.images.every(isHs))?.images[i]
            : chain.images.find(isHs);
        }
        const quality = v.quality ?? qualityFromName(chain.names[i] ?? '') ?? '1';
        const def: MmcDef = {
          id,
          nationality: img.slice(0, 2),
          kind,
          quality,
          fp: v.fp,
          range: v.range,
          morale: v.morale,
          brokenMorale: b?.morale ?? v.morale,
          selfRally: b?.selfRally ?? false,
          assaultFire: v.assaultFire,
          ...(v.smoke !== undefined ? { smoke: v.smoke } : {}),
          elrExempt: v.elrExempt,
          ...(red && defIdFor(red) ? { reducesTo: defIdFor(red)! } : {}),
          ...(next && next !== img && defIdFor(next) ? { elrReplacement: defIdFor(next)! } : {}),
        };
        if (noBrokenSide(img)) def.noBrokenSide = true;
        counters[id] = def;
        images[id] = { front: img, ...(bImg ? { back: bImg } : {}) };
        if (!b && !noBrokenSide(img)) warnings.push(`no broken side for ${img}`);
      });
    }
    if (leaders) {
      leaders.images.forEach((img, i) => {
        const id = defIdFor(img);
        if (!id || counters[id]) return;
        const v = parseLeaderSvg(readSvg(img) ?? '');
        const backSvg = readSvg(`${img}b`);
        const b = backSvg ? parseBrokenSvg(backSvg) : null;
        if (!v) {
          warnings.push(`no leader values for ${img}`);
          return;
        }
        const next = leaders.images[i + 1];
        const def: SmcDef = {
          id,
          nationality: img.slice(0, 2),
          kind: 'leader',
          morale: v.morale,
          brokenMorale: b?.morale ?? v.morale,
          leadership: v.leadership,
          selfRally: true,
          ...(next && defIdFor(next) ? { elrReplacement: defIdFor(next)! } : {}),
          ...(backSvg ? {} : { noBrokenSide: true }),
        };
        counters[id] = def;
        images[id] = { front: img, ...(backSvg ? { back: `${img}b` } : {}) };
      });
    }
  }

  // Crews: a base image with a broken-side layer (SK4 1.2.2: always Elite, not subject to ELR). A slot may hold
  // several crew images (the Japanese 2-2-8, its Reduced-Strength 1-2-8 side and the 1-2-7, SK4 8.1.6): each is a def.
  for (const slot of slots) {
    const c = crewFromSlot(slot);
    if (!c || !natOk(c.front)) continue;
    const fronts = [...new Set([c.front, ...[...slot.matchAll(/([a-z]{2})\\*\/(\1\d{3}C[a-z]*)\.svg/g)].map((m) => m[2]!)])];
    for (const front of fronts) {
      const id = defIdFor(front);
      if (!id || counters[id]) continue;
      const v = parseMmcSvg(readSvg(front) ?? '');
      if (!v) {
        warnings.push(`no values for ${front}`);
        continue;
      }
      const b = c.back ? parseBrokenSvg(readSvg(c.back) ?? '') : null;
      const def: MmcDef = {
        id,
        nationality: front.slice(0, 2),
        kind: 'crew',
        quality: 'E',
        fp: v.fp,
        range: v.range,
        morale: v.morale,
        brokenMorale: b?.morale ?? v.morale,
        selfRally: b?.selfRally ?? false,
        assaultFire: false,
        elrExempt: true,
      };
      counters[id] = def;
      images[id] = { front, ...(c.back ? { back: c.back } : {}) };
      if (!b) warnings.push(`no broken side for ${front}`);
    }
  }

  // Guns: 5/8" ordnance counters with a malfunctioned back and (unless QSU) a limbered side.
  for (const { image: img, info } of guns ?? []) {
    if (!natOk(img) || /gen$|dm/.test(img)) continue;
    const id = `${img.slice(0, 2)}.${img.slice(2)}`;
    if (counters[id]) continue;
    const front = readGunSvg?.(img);
    if (!front) {
      warnings.push(`no gun art for ${img}`);
      continue;
    }
    const back = readGunSvg?.(`${img}b`);
    const limbered = readGunSvg?.(`${img}-l`);
    const v = parseGunSvg(front, back, limbered);
    if (!v) {
      warnings.push(`no gun values for ${img}`);
      continue;
    }
    const notes = parseGunInfo(info);
    const def: GunDef = {
      id,
      nationality: img.slice(0, 2),
      ...v,
      ...(notes.specialAmmo.length ? { specialAmmo: notes.specialAmmo } : {}),
      ...(notes.noIntensive ? { noIntensive: true } : {}),
    };
    if (keepGun && !keepGun(def)) continue;
    counters[id] = def;
    images[id] = { front: img, ...(back ? { back: `${img}b` } : {}), ...(limbered ? { limbered: `${img}-l` } : {}), dir: `${img.slice(0, 2)}/gun` };
  }

  // Support weapons are single-image pieces with a malfunction layer.
  for (const nat of nationalities) {
    // HMG50: the American .50 cal HMG (S34), a counter of its own beside the HMG.
    // ATR20: the Japanese 20mm ATR's image name (`jaATR20`), imported as `ja.ATR` like the others.
    for (const t of ['LMG', 'MMG', 'HMG', 'HMG50', 'FT', 'DC', 'ATR', 'ATR20']) {
      const img = `${nat}${t}`;
      const front = readSvg(img);
      if (!front) continue;
      const back = readSvg(`${img}b`);
      const v = parseSwSvg(front, back);
      if (!v) {
        warnings.push(`no SW values for ${img}`);
        continue;
      }
      const id = `${nat}.${t === 'ATR20' ? 'ATR' : t}`;
      if (counters[id]) continue;
      counters[id] = { id, nationality: nat, ...v };
      images[id] = { front: img, ...(back ? { back: `${img}b` } : {}) };
    }
  }
  // Light Mortars: 1/2" ordnance SW (SK4 4.5).
  for (const img of mortars ?? []) {
    if (!natOk(img)) continue;
    const front = readSvg(img);
    if (!front) {
      warnings.push(`no mortar art for ${img}`);
      continue;
    }
    const back = readSvg(`${img}b`);
    const v = parseSwMortarSvg(front, back, infos?.get(img) ?? infos?.get(`${img}b`) ?? '');
    if (!v) {
      warnings.push(`no mortar values for ${img}`);
      continue;
    }
    const id = `${img.slice(0, 2)}.${img.slice(2)}`;
    counters[id] = { id, nationality: img.slice(0, 2), ...v };
    images[id] = { front: img, ...(back ? { back: `${img}b` } : {}) };
  }
  for (const img of latw ?? []) {
    if (!natOk(img)) continue;
    const front = readSvg(img);
    const back = readSvg(`${img}b`);
    const v = front ? parseSwLatwSvg(front, back) : null;
    if (!v) {
      warnings.push(`no LATW values for ${img}`);
      continue;
    }
    const id = `${img.slice(0, 2)}.${img.slice(2)}`;
    counters[id] = { id, nationality: img.slice(0, 2), ...v };
    images[id] = { front: img, back: `${img}b` };
  }
  return { counters, images, warnings };
}
