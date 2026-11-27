import { COUNTERS } from '@asl/content';
import { smokeDispenserLabel, type CounterDef, type SpecialAmmoDef, type VehicleDef } from '@asl/rules';
import { defLabel } from './describe';

const QUALITY: Record<string, string> = { E: 'Elite', '1': 'First Line', '2': 'Second Line', G: 'Green', C: 'Conscript' };

const AMMO_WORDS: Record<string, string> = { HE: 'limited HE', AP: 'limited AP', HEAT: 'HEAT', APCR: 'APCR', APDS: 'APDS', SMOKE: 'Smoke', WP: 'WP' };
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Smoke, depletion 7"; "APCR, depletion 5 from 1942, 4 from 1943, 3 from 1944" (SK4 6.2). */
function specialAmmoNote(s: SpecialAmmoDef): string {
  const steps = s.steps.map((t) => `${t.n}${t.from ? ` from ${t.from.month ? `${MONTHS[t.from.month]} ` : ''}${t.from.year}` : ''}`).join(', ');
  return `${AMMO_WORDS[s.kind] ?? s.kind}, depletion ${steps}${s.theater === 'PTO' ? ' (Pacific only)' : s.theater === 'ETO' ? ' (Europe)' : ''}`;
}

/** A LATW's To Hit Table, as printed on the back of its counter (SK4 4.4): "TH 11/9/8/7/4 at range 0–4". */
export function latwToHit(th: number[]): string {
  return `TH ${th.join('/')} at range 0–${th.length - 1}`;
}

/** What a counter's printed values and markings mean, in the words of the rules. */
export function counterNotes(d: CounterDef): string[] {
  const label = (id: string) => (COUNTERS[id] ? defLabel(COUNTERS[id]!) : id);
  if (d.kind === 'sw' && d.type === 'MTR' && d.ordnance) {
    // Light Mortar (SK4 4.5): fires on the To Hit Table, Area Target Type only.
    const o = d.ordnance;
    const n = [`${o.caliber}mm${o.barrel ? ` (${o.barrel})` : ''} Light Mortar`, `range ${o.minRange}–${o.maxRange}`, `${d.pp} PP`];
    if (d.rof) n.push(`ROF ${d.rof}`);
    for (const s of o.specialAmmo ?? []) n.push(specialAmmoNote(s));
    n.push(`breakdown B${d.b ?? 12}`);
    if (d.repair !== undefined) n.push(`repair on a dr of ${d.repair === 1 ? '1' : `≤ ${d.repair}`}`);
    if (d.removeOnRepair6) n.push('removed on a repair dr of 6');
    return n;
  }
  if (d.kind === 'sw' && d.latw) {
    // A LATW (SK4 4.4): HEAT on its own To Hit Table, only at Infantry in a building or a Gun.
    const n = [`${d.type} To Hit Table ${d.latw.th.map((th, r) => `${r}:${th}`).join(' ')}`, `a hit on Infantry in a building on the ${d.fp} FP column`, `range ${d.range}`, `${d.pp} PP`];
    if (d.x) n.push(`X${d.x}: removed on an original TH DR ≥ ${d.x}`);
    // A PIAT breaks down instead (B10 on the counter) and is repaired like any SW.
    if (d.b) n.push(`breakdown B${d.b}`);
    if (d.repair !== undefined) n.push(`repair on a dr of ${d.repair === 1 ? '1' : `≤ ${d.repair}`}`);
    if (d.removeOnRepair6) n.push('removed on a repair dr of 6');
    if (d.latw.tk) n.push(`HEAT To Kill ${d.latw.tk}`);
    // A BAZ, PSK or PF brings Backblast (SK4 4.4.3): a PIAT fires from inside a building with no penalty.
    n.push(d.type === 'PIAT' ? 'No Backblast: fires from inside a building with no penalty' : 'Backblast from inside a building: +2 To Hit or a 1 FP attack on the hex');
    return n;
  }
  if (d.kind === 'sw') {
    const n = [`${d.fp} FP`, `range ${d.range}`, `${d.pp} PP`];
    if (d.rof) n.push(`ROF ${d.rof}`);
    if (d.b) n.push(`breakdown B${d.b}`);
    else if (d.x) n.push(`X${d.x}: removed when it malfunctions`);
    else n.push('breakdown B12');
    if (d.repair !== undefined) n.push(`repair on a dr of ${d.repair === 1 ? '1' : `≤ ${d.repair}`}`);
    if (d.removeOnRepair6) n.push('removed on a repair dr of 6');
    return n;
  }
  if (d.kind === 'gun') {
    const n = [`${d.caliber}mm${d.barrel ? ` (${d.barrel})` : ''} ${d.type} Gun`];
    if (d.ife) n.push(`IFE ${d.ife} FP (fires on the IFT like a MG)`);
    if (d.rof) n.push(`ROF ${d.rof}`);
    // Ammunition (SK4 6.0, 6.2): scoring, then Special Ammo with its Depletion Number and dates.
    if (!d.ammo.he && !d.specialAmmo?.some((s) => s.kind === 'HE')) n.push('no HE (AP only)');
    if (!d.ammo.ap && d.type !== 'MTR' && !d.specialAmmo?.some((s) => s.kind === 'AP')) n.push('no AP');
    for (const s of d.specialAmmo ?? []) n.push(specialAmmoNote(s));
    if (d.noIntensive) n.push('no Intensive Fire');
    if (d.minRange !== undefined) n.push(`range ${d.minRange}–${d.maxRange}`);
    n.push(`M${d.m} manhandling`, d.mount === '360' ? '360° mount' : 'non-turreted', d.qsu ? 'Quick Set Up' : 'cannot move (limbered)');
    if (d.targetSize !== 'normal') n.push(`${d.targetSize} target`);
    if (d.gunshield) n.push('gunshield');
    n.push(`breakdown B${d.b ?? 12}`);
    if (d.repair !== undefined) n.push(`repair on a dr of ${d.repair === 1 ? '1' : `≤ ${d.repair}`}`);
    if (d.removeOnRepair6) n.push('removed on a repair dr of 6');
    return n;
  }
  if (d.kind === 'vehicle') return vehicleNotes(d);
  if (d.kind === 'unknown') return ['a concealed enemy stack: its counters cannot be inspected (SK4 8.3.2)'];
  if (d.kind === 'leader') {
    const n = [`morale ${d.morale}`, `${d.leadership > 0 ? '+' : ''}${d.leadership} leadership DRM`, 'self-rallies'];
    if (d.brokenMorale !== d.morale) n.push(`broken morale ${d.brokenMorale}`);
    if (d.elrReplacement) n.push(`ELR replacement ${label(d.elrReplacement)}`);
    return n;
  }
  const n = [QUALITY[d.quality] ?? d.quality, `${d.fp} FP`, `range ${d.range}`, `morale ${d.morale}${d.brokenMorale !== d.morale ? ` (${d.brokenMorale} broken)` : ''}`];
  if (d.assaultFire) n.push('Assault Fire (underlined FP)');
  if (d.smoke) n.push(`Smoke exponent ${d.smoke}`);
  if (d.selfRally) n.push('self-rallies (boxed morale)');
  if (d.elrExempt) n.push('not subject to ELR replacement (underlined morale)');
  else if (d.elrReplacement) n.push(`ELR replacement ${label(d.elrReplacement)}`);
  if (d.reducesTo) n.push(`reduces to ${label(d.reducesTo)}`);
  return n;
}

const TURRET_NAME: Record<VehicleDef['turret'], string> = { T: 'Fast Turret', ST: 'Slow Turret', RST: 'Restricted Slow Turret', '1MT': 'One Man Turret', NT: 'non-turreted (bow-mounted MA)' };
const SIZE_NAME: Record<VehicleDef['targetSize'], string> = { veryLarge: 'very large target (-2 To Hit)', large: 'large target (-1 To Hit)', normal: '', small: 'small target (+1 To Hit)', verySmall: 'very small target (+2 To Hit)' };

/** A vehicle's printed values in the words of SK4 7.0–7.8. */
function vehicleNotes(d: VehicleDef): string[] {
  const n = [d.tracked ? 'Fully Tracked AFV' : 'Armored Car', `${d.mp} MP${d.redMp ? ' (red: Mechanical Reliability DR on each start' + (d.stallOn11 ? ', stalls on 11' : '') + ')' : ''}`];
  if (d.groundPressure !== 'normal') n.push(`${d.groundPressure} ground pressure`);
  const t = d.af.turret;
  const h = d.af.hull;
  n.push(`armor front ${h.front} / side ${h.side} / rear ${h.rear}${d.turret !== 'NT' && (t.front !== h.front || t.side !== h.side || t.rear !== h.rear) ? ` (turret ${t.front} / ${t.side} / ${t.rear})` : ''}`);
  if (d.ma) {
    n.push(`${d.ma.caliber}${d.ma.barrel ?? ''} Main Armament${d.ma.rof ? `, ROF ${d.ma.rof}` : ''}`, TURRET_NAME[d.turret]);
    if (d.ma.ife) n.push(`IFE ${d.ma.ife} FP`);
    if (!d.ma.ammo.he) n.push('no HE (AP only)');
    if (!d.ma.ammo.ap) n.push('no AP');
    for (const s of d.ma.specialAmmo ?? []) n.push(specialAmmoNote(s));
    n.push(`breakdown B${d.ma.b ?? 12}${d.ma.lowAmmo ? ' (circled: Low Ammo)' : ''}`);
    if (d.ma.noIntensive) n.push('no Intensive Fire');
  }
  const mgs = [d.mg.bmg !== undefined ? `BMG ${d.mg.bmg}${d.mg.bmgFixed ? ' (fixed mount)' : ''}` : null, d.mg.cmg !== undefined ? `CMG ${d.mg.cmg}` : null, d.mg.aamg !== undefined ? `AAMG ${d.mg.aamg}` : null, d.mg.rmg !== undefined ? `RMG ${d.mg.rmg}${d.mg.rmgClock !== undefined ? ` (${d.mg.rmgClock}:00 from MA)` : ''}` : null].filter(Boolean);
  if (mgs.length) n.push(`machine guns ${mgs.join(', ')}`);
  for (const s of d.smoke ?? []) n.push(`${smokeDispenserLabel(s)} smoke dispenser`);
  if (d.targetSize !== 'normal') n.push(SIZE_NAME[d.targetSize]);
  if (d.openTopped) n.push('Open-Topped');
  n.push(`crew morale ${d.crewMorale}`, `CE +${d.ceDrm} DRM`);
  return n;
}
