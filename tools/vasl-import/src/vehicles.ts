/**
 * Vehicle counters (SK4 1.2.7, 7.0) from the VASL module. A vehicle piece is a PieceSlot marked
 * `vehicleType` whose art is `images/<nat>/veh/<img>.svg`; VASL labels every block of the counter
 * SVG with a comment (`<!-- Front Armor -->`, `<!-- Movement -->`…), which is what is parsed here.
 * The piece's `info` trait carries the counter back: Crew Survival, smoke dispensers, Special Ammo.
 */
import type { GunType, SpecialAmmoDef, TurretType, VehicleDef } from '@asl/rules';
import { parseGunInfo } from './counters';

export interface VehicleSlot {
  /** VASL piece name ("T-34 M43"). */
  name: string;
  /** Nationality directory ("ru"). */
  nat: string;
  /** Front image name under images/<nat>/veh/ ("T34M43"). */
  image: string;
  /** The wreck piece's image name ("T34M43b", "pzivf2b"), if the piece has a Wreck replacement. */
  wreck?: string;
  /** The wreck art's nationality directory when it is not `nat` (the Russian Sherman III(a) wrecks to British art). */
  wreckNat?: string;
  /**
   * Open-Topped (SK4 7.13, ASLRB D1.4): VASL gives such a piece an OT prototype (`amOTtur`, `geOTnt`, `brOTntCAR`); the
   * counter art carries no mark of it.
   */
  openTopped?: boolean;
  info: string;
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/**
 * The vehicle pieces named in `names` (VASL palette names), with their art and notes. A name may end in
 * "@<nat>" to pick the piece whose art is under that nationality's directory, where one palette name is
 * used by several nationalities ("Sherman III(a)@ru": British and Russian Lend-Lease pieces share it).
 */
export function vehicleSlots(buildFile: string, names: string[]): VehicleSlot[] {
  const slots = new Map<string, string[]>();
  const re = /<VASSAL\.build\.widget\.PieceSlot\b[^>]*entryName="([^"]*)"[^>]*>([\s\S]*?)<\/VASSAL\.build\.widget\.PieceSlot>/g;
  for (const m of buildFile.matchAll(re)) {
    const name = decodeXml(m[1]!);
    slots.set(name, [...(slots.get(name) ?? []), decodeXml(m[2]!)]);
  }
  const imageOf = (body: string) => /piece;K;D;([a-z]{2})\\*\/veh\\*\/([A-Za-z0-9_]+)\.svg/.exec(body);
  const out: VehicleSlot[] = [];
  for (const spec of names) {
    const [name, wantNat] = spec.split('@') as [string, string | undefined];
    const body = slots.get(name)?.find((b) => !wantNat || imageOf(b)?.[1] === wantNat);
    if (!body) continue;
    const img = imageOf(body);
    if (!img || !/mark;vehicleType/.test(body)) continue;
    const info = (/info;([^\t]*)/.exec(body)?.[1] ?? '').replace(/\\+$/, '').replace(/\\\//g, '/');
    // The wreck is its own piece (`replace;Wreck;…PieceSlot:<name> Wreck`), usually `<img>b.gif`.
    const wreckName = /PieceSlot:((?:\\.|[^;\\])+? Wreck\d?);/.exec(body)?.[1]?.replace(/\\+\//g, '/');
    const wreckBody = wreckName ? slots.get(wreckName)?.[0] : undefined;
    const wreck = wreckBody ? /piece;K;D;([a-z]{2})\\*\/veh\\*\/([A-Za-z0-9_]+)(?:\.gif)?;/.exec(wreckBody) : undefined;
    out.push({
      name,
      nat: img[1]!,
      image: img[2]!,
      ...(wreck ? { wreck: wreck[2]! } : {}),
      ...(wreck && wreck[1] !== img[1] ? { wreckNat: wreck[1]! } : {}),
      ...(/prototype;[a-z]{2}OT(?:tur|nt)/.test(body) ? { openTopped: true } : {}),
      info,
    });
  }
  return out;
}

/** The inner SVG that follows a block comment (`<!-- Front Armor -->` up to its `</svg>`). */
const block = (svg: string, comment: string) => {
  const i = svg.indexOf(`<!-- ${comment}`);
  if (i < 0) return '';
  const j = svg.indexOf('</svg>', i);
  return j < 0 ? svg.slice(i) : svg.slice(i, j);
};
const visible = (tag: string) => !/display:\s*none/.test(tag) && !/stroke-opacity:\s*0[;"]/.test(tag);
const texts = (s: string) => [...s.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, '').replace(/&#x002A;|✽|&#x273D;/g, '*').trim()).filter(Boolean);
const isRed = (style: string) => /fill:\s*(#e10000|#ff0000|#f00|red)\b/i.test(style);

/** SK4 7.1: the Armor Factor ladder a circled (inferior) or squared (superior) turret value steps along. */
export const AF_LADDER = [0, 1, 2, 3, 4, 6, 8, 11, 14, 18, 26];
const stepAf = (af: number, by: number) => {
  const i = AF_LADDER.indexOf(af);
  if (i < 0) return af;
  return AF_LADDER[Math.max(0, Math.min(AF_LADDER.length - 1, i + by))]!;
};

/** One armor block: the printed number, its colour (red = large target), a white dot (small), and the turret mark. */
function armorBlock(svg: string, comment: string): { af: number; red: boolean; dot: boolean; turret: 'inferior' | 'superior' | null } | null {
  const b = block(svg, comment);
  const t = /<text\b[^>]*>(?:<tspan([^>]*)>)?\s*(\d+)\s*(?:<\/tspan>)?<\/text>/.exec(b);
  if (!t) return null;
  const style = (t[1] ?? '') + (/<text\b([^>]*)>/.exec(b)?.[1] ?? '');
  const dot = /<circle[^>]*style="[^"]*fill:\s*white/i.test(b);
  const inferior = /<circle([^>]*)>\s*(?:<\/circle>)?\s*<!-- Inferior Turret Armor/.exec(b);
  const superior = /<rect([^>]*)\/?>\s*(?:<\/rect>)?\s*<!-- Superior Turret Armor/.exec(b);
  return {
    af: Number(t[2]),
    red: isRed(style),
    dot,
    turret: inferior && visible(inferior[1]!) ? 'inferior' : superior && visible(superior[1]!) ? 'superior' : null,
  };
}

/** The counter back's notes: Crew Survival, smoke dispensers, Special Ammo, limited ammunition. */
export function parseVehicleInfo(info: string): { cs?: number; smoke: { kind: 'sD' | 'sM' | 'sP' | 'sN'; n: number }[]; specialAmmo: SpecialAmmoDef[] } {
  const smoke: { kind: 'sD' | 'sM' | 'sP' | 'sN'; n: number }[] = [];
  let cs: number | undefined;
  const rest: string[] = [];
  for (const raw of info.split(',')) {
    const tok = raw.trim();
    const c = /^r?CS\s*(\d+)$/.exec(tok);
    if (c) {
      cs = Number(c[1]);
      continue;
    }
    const d = /^s([DMPN])(\d+)\*?$/.exec(tok);
    if (d) {
      smoke.push({ kind: `s${d[1]}` as 'sD' | 'sM' | 'sP' | 'sN', n: Number(d[2]) });
      continue;
    }
    rest.push(tok);
  }
  return { ...(cs !== undefined ? { cs } : {}), smoke, specialAmmo: parseGunInfo(rest.join(',')).specialAmmo };
}

export type ParsedVehicle = Omit<VehicleDef, 'id' | 'nationality' | 'name' | 'crewMorale' | 'cvp' | 'ceDrm'>;

/**
 * A vehicle's printed values from its VASL counter SVG. The turret type is the frame around the
 * depiction (circle T, square ST, thick square RST, thick cornerless square 1MT, none NT); armor,
 * MP, MA, ROF, B# and MGs come from their labelled blocks.
 */
export function parseVehicleSvg(front: string, info: string): ParsedVehicle | null {
  const frontArmor = armorBlock(front, 'Front Armor');
  const sideArmor = armorBlock(front, 'Side/Rear Armor');
  const rearArmor = armorBlock(front, 'Rear Armor');
  // "15", or "*15" with the asterisk in a tspan of its own (the PzKpfw VG; VASL's note "12:Stall").
  const mv = /<text\b([^>]*)>\s*(?:<tspan[^>]*>\s*(?:&#x002A;|\*)\s*<\/tspan>)?\s*(\d+)\s*<\/text>/.exec(block(front, 'Movement'));
  if (!frontArmor || !sideArmor || !mv) return null;
  const movement = block(front, 'Movement');
  const tracked = !/<circle/.test(movement);
  const redMp = isRed(mv[1]!);
  const turret: TurretType = /One Man Turret/.test(front) ? '1MT' : block(front, 'Restricted Slow Turret') ? 'RST' : block(front, 'Slow Turret') ? 'ST' : block(front, 'Fast Turret') ? 'T' : 'NT';
  // MA: "76L", "88LL", "75*", "12.7" (a MG-only MA), with an IFE "(24)" in its own block or
  // printed after the MA in a smaller tspan ("20L(6)").
  const maBlock = block(front, 'MA');
  const maFull = texts(maBlock).join('');
  const maText = maFull.replace(/\(\d+\)$/, '');
  const ma = /^(\*?)(\d+(?:\.\d+)?)(L{1,2})?(\*?)$/.exec(maText);
  // "*CMG" (the Light Tank Mk VIB): the MA is the CMG itself.
  const maMg = /^\*?(BMG|CMG)$/.exec(maText)?.[1]?.toLowerCase() as 'bmg' | 'cmg' | undefined;
  const rof = /<tspan[^>]*>\s*(\d)\s*<\/tspan>/.exec(block(front, 'ROF'))?.[1];
  const bBlock = block(front, 'Malfunction B/X Number') || block(front, 'Malfunction B/X') || block(front, 'Malfunction');
  // "11", or "B11" printed in one tspan (PzKpfw IIF, BT-7 M37).
  const b = /<tspan[^>]*>\s*B?(\d+)\s*<\/tspan>/.exec(bBlock)?.[1];
  const bCircled = !!b && /<circle([^>]*)>/.test(bBlock) && visible(/<circle([^>]*)>/.exec(bBlock)![1]!);
  const ife = /\((\d+)\)/.exec(texts(block(front, 'IFE')).join('') || maFull)?.[1];
  // A white ⬤ drawn under the BMG factor (its own text) marks a fixed BMG (the IS-2's "1"); the factors are the other text.
  const mgText = texts(block(front, 'Machine guns'))
    .filter((t) => !/&#x2B24;|⬤/.test(t))
    .join('');
  const mgParts = mgText ? mgText.split('/') : [];
  const mgNum = (s: string | undefined) => {
    const m = /^(\d+)/.exec((s ?? '').trim());
    return m ? Number(m[1]) : undefined;
  };
  const rmg = /R(\d+)/.exec(mgText)?.[1];
  const bmgFixed = /<circle[^>]*fill:\s*white/i.test(block(front, 'Machine guns')) || /&#x2B24;|⬤/.test(block(front, 'Machine guns'));
  const gp = block(front, 'Ground Pressure');
  const groundPressure = /<circle/.test(gp) ? 'high' : /<rect/.test(gp) ? 'low' : 'normal';
  const notes = parseVehicleInfo(info);
  const note = /Note #:\s*(\d+)/.exec(front)?.[1];
  const openTopped = /<!-- Open[- ]Topped/i.test(front);

  const hull = { front: frontArmor.af, side: sideArmor.af, rear: rearArmor?.af ?? sideArmor.af };
  const turretAf = {
    front: stepAf(frontArmor.af, frontArmor.turret === 'inferior' ? -1 : frontArmor.turret === 'superior' ? 1 : 0),
    side: stepAf(sideArmor.af, sideArmor.turret === 'inferior' ? -1 : sideArmor.turret === 'superior' ? 1 : 0),
    rear: stepAf(rearArmor?.af ?? sideArmor.af, (rearArmor ?? sideArmor).turret === 'inferior' ? -1 : (rearArmor ?? sideArmor).turret === 'superior' ? 1 : 0),
  };
  const targetSize: VehicleDef['targetSize'] =
    frontArmor.red && sideArmor.red ? 'veryLarge' : frontArmor.red ? 'large' : frontArmor.dot && sideArmor.dot ? 'verySmall' : frontArmor.dot ? 'small' : 'normal';
  // The counter back's "MA:AA" names an Anti-Aircraft MA (the PSW 234/1's 20L).
  const maType: GunType | 'MG' | null = ma ? (ma[2]!.includes('.') || Number(ma[2]) <= 15 ? 'MG' : /\bMA:AA\b/.test(info) ? 'AA' : 'AT') : null;
  const bmg = mgNum(mgParts[0]);
  const cmg = mgNum(mgParts[1]);
  const aamg = mgNum(mgParts[2]);
  return {
    kind: 'vehicle',
    tracked,
    mp: Number(mv[2]),
    ...(redMp ? { redMp: true } : {}),
    groundPressure,
    // A NT AFV may still print turret armor marks (the KV-2's boxed front 8, its upper superstructure); with none, turretAf is hull.
    af: { hull, turret: turretAf },
    turret,
    targetSize,
    ...(ma && maType
      ? {
          ma: {
            type: maType,
            caliber: Number(ma[2]),
            ...(ma[4] ? { barrel: '*' as const } : ma[3] ? { barrel: ma[3] as 'L' | 'LL' } : {}),
            ...(rof ? { rof: Number(rof) } : {}),
            ...(b ? { b: Number(b) } : {}),
            ...(bCircled ? { lowAmmo: true } : {}),
            ...(ife ? { ife: Number(ife) } : {}),
            ammo: { he: !/<!-- underline -->/.test(maBlock), ap: !/<!-- overline -->/.test(maBlock) },
            ...(notes.specialAmmo.length ? { specialAmmo: notes.specialAmmo } : {}),
          },
        }
      : {}),
    mg: {
      ...(bmg !== undefined ? { bmg } : {}),
      ...(bmgFixed ? { bmgFixed: true } : {}),
      ...(cmg !== undefined ? { cmg } : {}),
      ...(aamg !== undefined ? { aamg } : {}),
      ...(rmg ? { rmg: Number(rmg) } : {}),
    },
    ...(maMg ? { maMg: { mg: maMg, ...(rof ? { rof: Number(rof) } : {}) } } : {}),
    ...(openTopped ? { openTopped: true } : {}),
    ...(notes.smoke.length ? { smoke: notes.smoke } : {}),
    ...(notes.cs !== undefined ? { cs: notes.cs } : {}),
    ...(note ? { note: Number(note) } : {}),
  };
}
