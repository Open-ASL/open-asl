import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from 'react';
import { createPortal } from 'react-dom';
import type { SideId } from '@asl/engine';
import { COUNTERS, boardHexes, productById, scenarioName, scenarioNumber, turnsLabel } from '@asl/content';
import { chartLabel, forceChartVp, type CounterDef, type ForceChartParams, type ScenarioDef, type ScenarioForce, type SpecialAmmoDef, type VariableReinforcementsParams, type VehicleDef } from '@asl/rules';
import { assetUrl, counterImage } from '../game/assets';
import { NATION, defLabel } from '../game/describe';
import { Emblem } from '../fx/TurnChit';
import { MapPreview } from './MapPreview';

export const MONTH = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const EDGE_NAME: Record<string, string> = { N: 'north', E: 'east', S: 'south', W: 'west' };
/** "north", "north or east", or "any" for a comma list of edges naming all four. */
export function edgeWords(edge: string): string {
  const edges = edge.split(',');
  if (edges.length >= 4) return 'any';
  // A staging edge inside the map is named by its direction and a tag (S36's 'S45': the south edge of a smaller area).
  return edges.map((e) => EDGE_NAME[e] ?? EDGE_NAME[e[0]!] ?? e).join(' or ');
}

const QUALITY: Record<string, string> = { E: 'Elite', '1': 'First Line', '2': 'Second Line', G: 'Green', C: 'Conscript' };

/** A hex id without its board letter, e.g. yN5 → N5. */
const hex = (h: string) => h.replace(/^[a-z]/, '');

/**
 * A building named the way the card names it: by one of its hexes, the one the card's victory
 * text mentions when it does, followed by every hex of the building when there are several.
 * (Building ids such as z-B10 are the engine's own and mean nothing to a player.)
 */
function buildingName(id: string, sc: ScenarioDef): string {
  // On a map of several boards a hex keeps its board letter, as the cards write it ("yFF5"): two boards may both have an FF6.
  const label = (k: string) => (sc.boards.length > 1 ? k : hex(k));
  const hexes = sc.boards.flatMap((b) =>
    Object.entries(boardHexes(b.board))
      .filter(([, h]) => h.buildingId === id)
      .map(([k]) => label(k)),
  );
  if (hexes.length === 0) return id;
  const named = hexes.find((h) => new RegExp(`\\b${h}\\b`).test(sc.victoryText ?? '')) ?? hexes[0]!;
  return hexes.length > 1 ? `${named} (${hexes.join('/')})` : named;
}

/** A victory condition in words. */
export function describeVictory(v: ScenarioDef['victory'][number], sc: ScenarioDef): string {
  const name = (s: string) => sc.sides.find((x) => x.side === s)?.name ?? s;
  const hexes = (h: string[]) => (h.length > 12 ? `${h.length} hexes` : h.map(hex).join(', '));
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join(''));
  const clause = (c: ScenarioDef['victory'][number]): string => {
    switch (c.kind) {
      case 'noGoodOrderEnemyIn':
        // A hidden hex in the list (S70's Connection Location, not a board hex id) is named by the label, not counted.
        return `${c.atMost ? `no more than ${c.atMost}` : 'no'} ${c.allUnits ? '' : c.unbroken ? 'unbroken ' : 'Good Order '}enemy ${c.mmcOnly ? 'MMC' : 'units'} remain in ${c.buildings ? 'buildings ' : ''}${c.hexesLabel ? `the ${c.hexes.filter((h) => /^[a-z][A-Z]+\d+$/.test(h)).length} ${c.hexesLabel}` : hexes(c.hexes)}`;
      case 'controlHexes':
        return `they control ${c.atLeast >= c.hexes.length ? 'all of' : `at least ${c.atLeast} of`} ${c.hexesLabel ? `the ${c.hexes.length} ${c.hexesLabel}` : hexes(c.hexes)}`;
      case 'controlBuildings':
        if (c.moreThanEnemy) return `they control more of the ${c.buildings.length} ${c.buildingsLabel ?? 'buildings'} than ${name(sc.sides.find((x) => x.side !== c.side)?.side ?? '')} does`;
        return `they control ${c.atLeast >= c.buildings.length ? 'all of' : `at least ${c.atLeast} of`} ${c.buildings.length > 6 ? `${c.buildings.length} buildings` : `the buildings at ${list(c.buildings.map((b) => buildingName(b, sc)))}`}${
          c.perEnemyExit ? ` (${c.perEnemyExit} more for every enemy MMC that exits the map)` : ''
        }`;
      case 'exitVp':
        // A few named hexes (S28: "off hexes uI10 and/or uQ10") or a stretch of the edge.
        return `they exit ${c.vp} VP off the ${EDGE_NAME[c.edge] ?? c.edge} edge${
          c.hexes?.length ? (c.hexes.length <= 4 ? ` from ${c.hexes.map(hex).join(c.hexes.length === 2 ? ' and/or ' : ', ')}` : ` between ${hex(c.hexes[0]!)} and ${hex(c.hexes[c.hexes.length - 1]!)}`) : ''
        }${(sc.exits ?? [])
          .filter((e) => e.side === c.side && e.infantryOnly && e.hexes?.length)
          .map((e) => ` (Infantry also from ${e.hexes!.map(hex).join(', ')})`)
          .join('')}${c.afvVpAtLeast ? ` (at least ${c.afvVpAtLeast} VP from AFV)` : ''}${c.afvVp ? (c.afvVp.ma === c.afvVp.noMa ? ` (an AFV is worth ${c.afvVp.ma} VP)` : ` (an AFV is worth ${c.afvVp.ma} VP with a functioning MA, ${c.afvVp.noMa} without)`) : ''}${
          c.vehicleVp ? ` (${list(Object.entries(c.vehicleVp).map(([d, vp]) => `each ${COUNTERS[d] ? defLabel(COUNTERS[d]!) : d} is worth ${typeof vp === 'number' ? vp : `${vp.ma} (${vp.noMa} with its MA malfunctioned)`} VP`))})` : ''
        }`;
      case 'exitForce':
        return `they exit ${c.hsEquivalents / 2 >= 1 ? `${c.hsEquivalents / 2} squad${c.hsEquivalents > 2 ? 's' : ''} (or ${c.hsEquivalents} half-squads)` : `${c.hsEquivalents} half-squad`} and ${c.smc} leader${c.smc > 1 ? 's' : ''}${
          c.perEnemyHsExit ? ` (${c.perEnemyHsExit} more half-squad for every enemy half-squad that exits)` : ''
        }`;
      case 'eliminateCvp': {
        // A chart the side rolls on sets the number (S20 SSR 1).
        const chart = forceChartRules(sc).find((r) => r.side === c.side && r.rows.some((row) => row.vp !== undefined));
        if (chart) {
          const vps = chart.rows.map((row) => forceChartVp(chart, row)!);
          return `they amass the VP ${chart.chart ?? 'the chart'} gives (${Math.min(...vps)}–${Math.max(...vps)}, rolled after setup, ${chart.rule ?? 'SSR'})`;
        }
        return `they eliminate ${c.cvp} CVP`;
      }
      case 'cvpBelow':
        return `they have lost ≤ ${c.cvp - 1} CVP`;
      case 'forcesInBuilding':
        return `they have a unit of each of ${list(c.groups.map((g) => g.label))} in the same building`;
      case 'fewerMmcLost':
        return `they have lost fewer MMC than the ${people(name(sc.sides.find((x) => x.side !== c.side)?.side ?? c.side))}`;
      case 'all':
        return c.of.map(clause).join(', and ');
      case 'any':
        return c.of.map(clause).join(', or ');
      case 'gunsEliminatedOrCaptured':
        return `every ${name(c.of)} Gun${c.defs ? ` (${c.defs.map((d) => (COUNTERS[d] ? defLabel(COUNTERS[d]!) : d)).join(', ')})` : ''} is eliminated${c.eliminatedOnly ? '' : ' or captured'}`;
      case 'occupyGunHexes':
        return `they alone occupy every hex holding a non-captured ${name(c.of)} Gun`;
      case 'afvLead':
        return `they have eliminated more AFV than they have lost${c.exitedCountAsEliminated ? ` (each of their AFV exited off the ${EDGE_NAME[c.exitedCountAsEliminated.edge] ?? c.exitedCountAsEliminated.edge} edge counts as an eliminated enemy AFV)` : ''}`;
      case 'squadEquivalentsIn':
        return `they have at least ${c.atLeast} unbroken squad equivalents ${c.hexesLabel ?? `in ${hexes(c.hexes)}`}${c.afvSe ? ` (each mobile AFV with a functioning MA counts ${c.afvSe})` : ''}`;
      case 'mobileAfv':
        return `at least ${c.atLeast} of their AFV are still mobile (neither eliminated nor immobile)`;
      case 'losFirepower':
        return `their Good Order units with a LOS${c.noSmoke ? ' (disregarding Smoke)' : ''} to any of the ${c.hexes.length} ${c.hexesLabel ?? 'hexes'} can together apply at least ${c.fp} FP against them${
          c.mortarFp !== undefined || c.latw ? ` (${[c.mortarFp !== undefined ? `a mortar counts ${c.mortarFp} FP` : '', c.latw ? `a bazooka within ${c.latw.maxRange} hexes ${c.latw.fp} FP` : ''].filter(Boolean).join(', ')})` : ''
        }${
          c.noAreaFire || c.pbf || c.tpbf
            ? ` (${[c.noAreaFire ? 'no Area Fire or Long Range Fire' : '', c.pbf ? 'adjacent fire doubled' : '', c.tpbf ? 'same hex fire tripled' : ''].filter(Boolean).join(', ')})`
            : ''
        }`;
      case 'vpTally':
        return `they have at least ${c.vp} VP ${c.immediate ? 'at any time' : 'at game end'} (${c.sources.map((s) => (s.kind === 'casualtyVp' ? s.label : `${s.vp} VP for each ${s.label}${s.kind === 'controlledHexes' && s.atGameEnd ? ' at game end' : ''}`)).join(', ')})`;
      case 'goodOrderVp':
        return `they have at least ${c.vp} VP of Good Order infantry ${c.hexesLabel ?? `in ${hexes(c.hexes)}`}${c.leaders ? `, at least ${c.leaders} of them a leader` : ''} (a squad or crew 2 VP, a half-squad 1, a leader 1 plus 1 for each minus modifier)`;
      case 'clearAreas':
        return `no ${c.unbroken ? 'unbroken' : 'Good Order'} ${name(sc.sides.find((s) => s.side !== c.side)?.side ?? '')} ${c.mmcOnly ? 'MMC' : 'unit'} is on at least ${c.atLeast} of the ${c.areas.length} ${c.areasLabel ?? 'areas'} (${list(c.areas.map((a) => a.label))})`;
      case 'fewerLosses':
        return `they have lost fewer squads or squad equivalents than the ${name(sc.sides.find((s) => s.side !== c.side)?.side ?? '')} (a half-squad or crew counts as half a squad; a squad Casualty Reduced has lost half)`;
      default:
        return 'special victory conditions apply';
    }
  };
  const immediate = v.kind === 'exitVp' || v.kind === 'exitForce' || (v.kind === 'eliminateCvp' && !v.atGameEnd) || ('immediate' in v && !!v.immediate);
  const endOfTurn = v.kind === 'controlHexes' ? v.atEndOfTurn : undefined;
  // "The Germans", but "The Allies" and "The British".
  // "The Germans", "The Allies", but "The British", "The Free French", "The Japanese".
  const people = (n: string) => (n === 'Allied' ? 'Allies' : /(s|sh|ch|ese)$/.test(n) ? n : `${n}s`);
  const endOfPhase = v.kind === 'all' || v.kind === 'any' ? v.atEndOfPhase : undefined;
  return `The ${people(name(v.side))} win ${endOfPhase !== undefined ? `at the end of any of their ${endOfPhase}` : endOfTurn !== undefined ? `at the end of Game Turn ${endOfTurn}` : immediate ? 'immediately' : 'at game end'} if ${clause(v)}.`;
}

/**
 * The card's chart for reinforcements a dr counts out: one column per turn rolled for, one row
 * per dr range, as printed. The engine rolls it before the side's Rally Phase.
 */
function VariableChart({ params }: { params: VariableReinforcementsParams }) {
  const ranges = [...new Set(params.rolls.flatMap((r) => r.table.map((row) => `${row.dr[0]}-${row.dr[1]}`)))];
  const d = COUNTERS[params.def];
  return (
    <table className="brief-chart">
      <thead>
        <tr>
          <th>dr</th>
          {params.rolls.map((r) => (
            <th key={r.turn}>Turn {r.turn}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ranges.map((range) => (
          <tr key={range}>
            <td>{range.replace('-', ' to ')}</td>
            {params.rolls.map((r) => (
              <td key={r.turn}>{r.table.find((row) => `${row.dr[0]}-${row.dr[1]}` === range)?.count ?? '—'}</td>
            ))}
          </tr>
        ))}
      </tbody>
      <caption>
        {d ? defLabel(d) : params.def} received that turn; rolled by the engine before the {NATION[params.side] ?? params.side} Rally Phase and shown in the log.
      </caption>
    </table>
  );
}

/** The card's chart for an order of battle a die decides: one row per result, as printed (S20 Chart 1). */
function ForceChart({ params }: { params: ForceChartParams }) {
  const hasVp = params.rows.some((r) => r.vp !== undefined);
  return (
    <table className="brief-chart">
      <thead>
        <tr>
          <th>dr</th>
          {params.defs.map((d) => (
            <th key={d}>{COUNTERS[d] ? defLabel(COUNTERS[d]!) : d}</th>
          ))}
          {hasVp && <th>VP</th>}
        </tr>
      </thead>
      <tbody>
        {params.rows.map((r) => (
          <tr key={r.dr}>
            <td>{r.dr}</td>
            {params.defs.map((d, i) => (
              <td key={d}>{r.counts[i] ?? 0}</td>
            ))}
            {hasVp && <td>{forceChartVp(params, r)}</td>}
          </tr>
        ))}
      </tbody>
      <caption>
        {params.chart ?? 'Chart'}: rolled by the engine once the {NATION[params.afterSetupOf] ?? params.afterSetupOf} side has set up, and shown in the log.
        {params.vpAdd ? ` VP values ${params.vpAdd > 0 ? 'raised' : 'reduced'} by ${Math.abs(params.vpAdd)} (balance).` : ''}
      </caption>
    </table>
  );
}

/** The scenario's order-of-battle charts (SSR), if any. */
function forceChartRules(sc: ScenarioDef): ForceChartParams[] {
  return sc.ssr.filter((r) => r.module === 'force-chart').map((r) => r.params as unknown as ForceChartParams);
}

/** A force's setup instruction in words (from the scenario data). */
export function setupRule(f: ScenarioForce): string {
  const s = f.setup;
  if (s.description) return s.description;
  if (s.kind === 'area' || s.kind === 'scatter') return s.description;
  if (s.kind === 'hexes') return `Set up in ${s.hexes.map(hex).join(', ')}`;
  const where = s.hexes?.length ? (s.hexes.length === 1 ? `at ${hex(s.hexes[0]!)}` : s.hexes.length <= 4 ? `at ${s.hexes.map(hex).join(', ')}` : `between ${hex(s.hexes[0]!)} and ${hex(s.hexes[s.hexes.length - 1]!)}`) : '';
  const spent = s.mpSpent !== undefined ? ` having already expended ${s.mpSpent === 'half' ? 'half their MP' : `${s.mpSpent} MP`}` : s.mfSpent ? ` having already expended ${s.mfSpent} MF` : '';
  return `Enter on Turn ${s.turn} along ${edgeWords(s.edge) === 'any' ? 'any edge' : `the ${edgeWords(s.edge)} edge`}${where ? ` ${where}` : ''}${spent}`;
}

const AMMO_WORDS: Record<string, string> = { HE: 'limited HE', AP: 'limited AP', HEAT: 'HEAT', APCR: 'APCR', APDS: 'APDS', SMOKE: 'Smoke', WP: 'WP' };
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Smoke, depletion 7"; "APCR, depletion 5 from 1942, 4 from 1943, 3 from 1944" (SK4 6.2). */
function specialAmmoNote(s: SpecialAmmoDef): string {
  const steps = s.steps.map((t) => `${t.n}${t.from ? ` from ${t.from.month ? `${MONTHS[t.from.month]} ` : ''}${t.from.year}` : ''}`).join(', ');
  return `${AMMO_WORDS[s.kind] ?? s.kind}, depletion ${steps}${s.theater === 'PTO' ? ' (Pacific only)' : s.theater === 'ETO' ? ' (Europe)' : ''}`;
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
    if (d.latw.tk) n.push(`HEAT To Kill ${d.latw.tk}`);
    n.push('Backblast from inside a building: +2 To Hit or a 1 FP attack on the hex');
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

const KIND_ORDER: Record<CounterDef['kind'], number> = { vehicle: -1, squad: 0, hs: 1, crew: 2, leader: 3, sw: 4, gun: 5, unknown: 6 };

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
  const mgs = [d.mg.bmg !== undefined ? `BMG ${d.mg.bmg}${d.mg.bmgFixed ? ' (fixed mount)' : ''}` : null, d.mg.cmg !== undefined ? `CMG ${d.mg.cmg}` : null, d.mg.aamg !== undefined ? `AAMG ${d.mg.aamg}` : null, d.mg.rmg !== undefined ? `RMG ${d.mg.rmg}` : null].filter(Boolean);
  if (mgs.length) n.push(`machine guns ${mgs.join(', ')}`);
  for (const s of d.smoke ?? []) n.push(`${s.kind}${s.n} smoke dispenser`);
  if (d.targetSize !== 'normal') n.push(SIZE_NAME[d.targetSize]);
  if (d.openTopped) n.push('Open-Topped');
  n.push(`crew morale ${d.crewMorale}`, `CE +${d.ceDrm} DRM`);
  return n;
}

/** Every distinct counter a side fields, squads first, then half-squads, leaders and weapons. */
function sideCounters(sc: ScenarioDef, side: SideId): CounterDef[] {
  const ids = new Set<string>();
  for (const f of sc.forces) {
    if (f.side !== side) continue;
    for (const u of f.units) {
      ids.add(u.def);
      for (const sw of u.withSw ?? []) ids.add(sw);
    }
  }
  for (const v of variableReinforcementRules(sc)) if (v.side === side) ids.add(v.def);
  for (const c of forceChartRules(sc)) if (c.side === side) for (const d of c.defs) ids.add(d);
  return [...ids]
    .map((id) => COUNTERS[id])
    .filter((d): d is CounterDef => !!d)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || defLabel(b).localeCompare(defLabel(a)));
}

/** The scenario's reinforcements-by-dr rules (SSR), if any. */
function variableReinforcementRules(sc: ScenarioDef): VariableReinforcementsParams[] {
  return sc.ssr.filter((r) => r.module === 'variable-reinforcements').map((r) => r.params as unknown as VariableReinforcementsParams);
}

/** The dr-counted counters that enter with a force: def, rule name and chart. */
function variableFor(sc: ScenarioDef, f: ScenarioForce): { def: string; rule: string; turn: number; table: VariableReinforcementsParams['rolls'][number]['table'] }[] {
  const out: { def: string; rule: string; turn: number; table: VariableReinforcementsParams['rolls'][number]['table'] }[] = [];
  for (const v of variableReinforcementRules(sc)) for (const r of v.rolls) if (f.id && r.force === f.id) out.push({ def: v.def, rule: v.rule ?? 'SSR', turn: r.turn, table: r.table });
  return out;
}

/** A counter with how many of it, as the card prints them. */
function Chit({ def, count }: { def: string; count: number | string }) {
  const d = COUNTERS[def];
  const img = counterImage(def, false);
  const label = d ? defLabel(d) : def;
  return (
    <span className="brief-chit" title={label}>
      {img ? <img src={img} alt={label} /> : <i>{label}</i>}
      <b>×{count}</b>
    </span>
  );
}

/** Text with blank lines between paragraphs; the first paragraph may carry a dateline lead-in. */
function Paragraphs({ text, lead }: { text: string; lead?: string }) {
  const parts = text.split(/\n\s*\n/);
  return (
    <>
      {parts.map((p, i) => (
        <p key={i}>
          {i === 0 && lead && <b className="brief-lead">{lead}: </b>}
          {p}
        </p>
      ))}
    </>
  );
}

interface Props {
  scenario: ScenarioDef;
  /**
   * Balance options ticked for a match (lobby, waiting room). Without `onBalance` they are shown
   * read-only. Left out altogether (the scenario catalog, where no match exists yet), the card's
   * provisions are listed as the options they are, not judged in effect or not.
   */
  balance?: string[];
  onBalance?(sides: string[]): void;
  /** Rendered at the end (the lobby's Deploy row). */
  children?: ReactNode;
}

function MapLegend({ scenario: sc, className = '' }: { scenario: ScenarioDef; className?: string }) {
  return (
    <div className={`brief-map-legend ${className}`.trim()}>
      {sc.sides.map((s) => (
        <span key={s.side} className={`side-${s.side}`}>
          <i className="sw" /> {s.name} setup / entry edge
        </span>
      ))}
      <span className="objective">
        <i className="sw" /> objectives
      </span>
    </div>
  );
}

function ExpandedMap({ scenario: sc, boardNote, onClose }: { scenario: ScenarioDef; boardNote: string; onClose(): void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  /** Every pointer pressed on the stage (by id), in client pixels: two fingers make a pinch. */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  /** A two-finger pinch in progress: the fingers' last midpoint (client pixels) and separation. */
  const pinchRef = useRef<{ x: number; y: number; dist: number } | null>(null);
  const zoomRef = useRef(1);
  const [zoom, setZoom] = useState(1);
  /** The spot to hold still through the next zoom: a fraction of the surface, and the client point it sits under. */
  const anchorRef = useRef<{ fx: number; fy: number; x: number; y: number } | null>(null);
  const [nativeSize, setNativeSize] = useState({ width: 0, height: 0 });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape, true);
    return () => window.removeEventListener('keydown', closeOnEscape, true);
  }, [onClose]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const style = getComputedStyle(stage);
      setStageSize({
        width: Math.max(0, stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)),
        height: Math.max(0, stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const onMapSize = useCallback((width: number, height: number) => {
    setNativeSize((current) => current.width === width && current.height === height ? current : { width, height });
  }, []);

  const fitScale = nativeSize.width && nativeSize.height && stageSize.width && stageSize.height
    ? Math.min(1, stageSize.width / nativeSize.width, stageSize.height / nativeSize.height)
    : 1;
  const fittedWidth = nativeSize.width * fitScale;
  const fittedHeight = nativeSize.height * fitScale;
  const displayWidth = fittedWidth * zoom;
  const displayHeight = fittedHeight * zoom;

  const zoomAround = useCallback((requested: number, clientX?: number, clientY?: number) => {
    const stage = stageRef.current;
    const surface = surfaceRef.current;
    if (!stage || !surface) return;
    const old = zoomRef.current;
    const next = Math.min(4, Math.max(0.25, requested));
    if (Math.abs(next - old) < 0.001) return;
    const stageRect = stage.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    if (!surfaceRect.width || !surfaceRect.height) return;
    const x = clientX ?? stageRect.left + stageRect.width / 2;
    const y = clientY ?? stageRect.top + stageRect.height / 2;
    // The spot under (x, y) as a fraction of the surface as drawn now, so it is right even when an
    // earlier zoom has not been rendered yet (a pinch asks for several per frame); the scroll is
    // corrected once the new size is in the DOM.
    anchorRef.current = { fx: (x - surfaceRect.left) / surfaceRect.width, fy: (y - surfaceRect.top) / surfaceRect.height, x, y };
    zoomRef.current = next;
    setZoom(next);
  }, []);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const stage = stageRef.current;
    const resized = surfaceRef.current?.getBoundingClientRect();
    if (!anchor || !stage || !resized) return;
    anchorRef.current = null;
    stage.scrollLeft += resized.left + anchor.fx * resized.width - anchor.x;
    stage.scrollTop += resized.top + anchor.fy * resized.height - anchor.y;
  }, [zoom]);

  const fitView = () => {
    zoomRef.current = 1;
    setZoom(1);
    requestAnimationFrame(() => stageRef.current?.scrollTo({ left: 0, top: 0 }));
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    // A trackpad pinch arrives as a ctrl+wheel stream of small pixel deltas: zoom smoothly by them,
    // capped so a ctrl+wheel notch on a mouse (a 100px delta in Chrome) is only a modest step.
    const smooth = event.ctrlKey && event.deltaMode === 0;
    const factor = smooth ? Math.min(1.25, Math.max(0.8, Math.exp(-event.deltaY * 0.01))) : event.deltaY < 0 ? 1.08 : 1 / 1.08;
    zoomAround(zoomRef.current * factor, event.clientX, event.clientY);
  };

  const pinchGeometry = () => {
    const [a, b] = [...pointersRef.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    stage.focus({ preventScroll: true });
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('dragging');
    if (pointersRef.current.size === 2) {
      // A second finger turns the pan into a pinch.
      dragRef.current = null;
      pinchRef.current = pinchGeometry();
      return;
    }
    if (pinchRef.current) return;
    dragRef.current = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const p = pointersRef.current.get(event.pointerId);
    if (p) {
      p.x = event.clientX;
      p.y = event.clientY;
    }
    const pinch = pinchRef.current;
    if (pinch) {
      if (!p || pointersRef.current.size < 2) return;
      // Pan with the fingers' midpoint, and zoom about it by how far they spread.
      const g = pinchGeometry();
      stage.scrollLeft -= g.x - pinch.x;
      stage.scrollTop -= g.y - pinch.y;
      zoomAround(zoomRef.current * (g.dist / pinch.dist), g.x, g.y);
      pinchRef.current = g;
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    stage.scrollLeft = drag.left - (event.clientX - drag.x);
    stage.scrollTop = drag.top - (event.clientY - drag.y);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    pointersRef.current.delete(event.pointerId);
    if (stage?.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (pinchRef.current && stage) {
      if (pointersRef.current.size >= 2) {
        pinchRef.current = pinchGeometry();
        return;
      }
      // The finger still down pans from where it is.
      pinchRef.current = null;
      const rest = [...pointersRef.current.values()][0];
      dragRef.current = rest ? { x: rest.x, y: rest.y, left: stage.scrollLeft, top: stage.scrollTop } : null;
      if (rest) return;
    }
    dragRef.current = null;
    stage?.classList.remove('dragging');
  };

  return createPortal(
    <div className="brief-map-backdrop" onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
      <section className="brief-map-dialog" role="dialog" aria-modal="true" aria-labelledby="brief-map-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="brief-map-dialog-head">
          <div>
            <span>Scenario map</span>
            <h2 id="brief-map-title">{scenarioNumber(sc)} {scenarioName(sc)}</h2>
            <p>Board{sc.boards.length > 1 ? 's' : ''} {boardNote}</p>
          </div>
          <div className="brief-map-dialog-actions">
            <div className="brief-map-zoom-controls" role="group" aria-label="Map zoom controls">
              <button onClick={() => zoomAround(zoomRef.current / 1.25)} aria-label="Zoom out" title="Zoom out">−</button>
              <output aria-live="polite">{Math.round(zoom * 100)}%</output>
              <button onClick={() => zoomAround(zoomRef.current * 1.25)} aria-label="Zoom in" title="Zoom in">+</button>
              <button className="brief-map-fit" onClick={fitView}>Fit</button>
            </div>
            <button className="ghost brief-map-close" onClick={onClose} aria-label="Close map" title="Close (Esc)">×</button>
          </div>
        </header>
        <div ref={stageRef} className="brief-map-stage" tabIndex={0} aria-label="Scrollable scenario map" onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <div
            ref={surfaceRef}
            className="brief-map-surface"
            style={{
              width: displayWidth,
              height: displayHeight,
              marginLeft: Math.max(0, (stageSize.width - displayWidth) / 2),
              marginTop: Math.max(0, (stageSize.height - displayHeight) / 2),
            }}
          >
            <MapPreview scenario={sc} width={1400} height={900} onSize={onMapSize} />
          </div>
        </div>
        <footer className="brief-map-dialog-foot">
          <MapLegend scenario={sc} />
          <span>Wheel or pinch to zoom · drag to pan · scrollbars available when enlarged</span>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

/**
 * The mission briefing: everything the scenario card says, laid out in the game's own style.
 * Shown in the lobby before a game and from the top bar during one.
 */
export function Briefing({ scenario: sc, balance, onBalance, children }: Props) {
  const code = scenarioNumber(sc);
  const name = scenarioName(sc);
  const product = productById(sc.product);
  const [photoOk, setPhotoOk] = useState(true);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  useEffect(() => setPhotoOk(true), [sc.photo?.src]);
  const sideName = (s: string) => sc.sides.find((x) => x.side === s)?.name ?? s;
  const first = sc.sides.find((s) => s.side === sc.firstSide);
  const setsUpFirst = sc.sides.find((s) => s.setupFirst);
  const unitCount = (side: string) => sc.forces.filter((f) => f.side === side).reduce((n, f) => n + f.units.reduce((m, u) => m + u.count, 0), 0);
  const dateline = [sc.place, sc.date].filter(Boolean).join(', ');
  // Secretly picked entry groups (SSR) may come on either of the rule's turns, as the card's "+" marks show.
  const entryGroups = sc.ssr.find((r) => r.module === 'entry-groups')?.params as { side: string; turn: number; laterTurn: number } | undefined;
  // Groups given their turns secretly before setup (SSR) enter on any of the rule's turns.
  const entryTurns = sc.ssr.find((r) => r.module === 'secret-entry-turns')?.params as { side: string; turns: number[] } | undefined;
  const enteringOn = (turn: number) =>
    sc.sides
      .filter(
        (s) =>
          // A force only a special rule brings in (LMA5's replacement leader) has no turn of its own.
          sc.forces.some((f) => f.side === s.side && f.setup.kind === 'enter' && f.setup.provisional !== 'ssr' && f.setup.turn === turn) ||
          (entryGroups?.side === s.side && (entryGroups.turn === turn || entryGroups.laterTurn === turn)) ||
          (entryTurns?.side === s.side && entryTurns.turns.includes(turn)),
      )
      .map((s) => s.side);
  // The circled numbers on the card's Turn Record Chart: a provisional force's entry dr (≤) for that turn.
  const entryDrOn = (turn: number) =>
    sc.forces.flatMap((f) => (f.setup.kind === 'enter' && f.setup.provisional && typeof f.setup.provisional !== 'string' && 'drAtMost' in f.setup.provisional && f.setup.provisional.drAtMost[turn] !== undefined ? [{ f, dr: f.setup.provisional.drAtMost[turn]! }] : []));
  const boardNote = sc.boards
    .map((b) => `${b.board.toUpperCase()}${b.columns || b.rows ? ` (${[b.columns ? `hexrows ${b.columns[0]}–${b.columns[1]}` : '', b.rows ? `hexes numbered ${b.rows[0]}–${b.rows[1]}` : ''].filter(Boolean).join(', ')})` : ''}`)
    .join(', ');
  const balanceList = sc.balance?.length ? sc.balance : sc.appliedBalance?.length ? sc.appliedBalance : [];
  // The card's own provisions outside any match: optional, chosen when a game is set up.
  const catalog = balance === undefined && !!sc.balance?.length;
  const inEffect = (side: string) => (sc.balance?.length ? (balance ?? []).includes(side) : true);
  const chosen = balance ?? [];

  return (
    <div className="brief">
      <header className="brief-head">
        <div className="brief-kicker">
          <span>Scenario {code}</span>
          {product && <span className="muted">{product.name}</span>}
          {sc.credit ? <span className="muted">{sc.credit}</span> : sc.designer && <span className="muted">Scenario design: {sc.designer}</span>}
        </div>
        <h3 className="brief-title">{name}</h3>
        {dateline && <div className="brief-dateline">{dateline}</div>}
        {sc.status === 'coming-soon' && (
          <div className="brief-soon">
            <b>Coming soon</b> · needs {sc.needs?.join('; ')}
          </div>
        )}
      </header>

      <div className="brief-meta">
        <span>
          <b>{turnsLabel(sc)}</b> turns
        </span>
        {sc.status === 'coming-soon' ? <span>Board{sc.boards.length > 1 ? 's' : ''} <b>{boardNote}</b></span> : (
          <span className={`brief-board ${mapOpen ? 'open' : ''}`} onMouseEnter={() => setMapOpen(true)} onMouseLeave={() => setMapOpen(false)}>
            <span>Board{sc.boards.length > 1 ? 's' : ''} <b>{boardNote}</b></span>
            <button type="button" className="brief-map-button" onClick={() => { setMapOpen(false); setMapExpanded(true); }} onFocus={() => setMapOpen(true)} onBlur={() => setMapOpen(false)} aria-haspopup="dialog">
              <span aria-hidden="true">▧</span> View map
            </button>
            {mapOpen && (
              // The map as it will be played: setup areas, entry edges and objectives, card's north up.
              <div className="brief-map-pop" role="button" tabIndex={0} onClick={() => { setMapOpen(false); setMapExpanded(true); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setMapOpen(false); setMapExpanded(true); } }}>
                <MapPreview scenario={sc} />
                <MapLegend scenario={sc} className="small" />
                <span className="brief-map-expand-hint">Click to open the full map</span>
              </div>
            )}
          </span>
        )}
        <span>
          <b>{MONTH[sc.month] ?? ''}</b> conditions
        </span>
        {setsUpFirst && (
          <span>
            <b>{setsUpFirst.name}</b> sets up first
          </span>
        )}
        <span>
          <b>{first?.name}</b> moves first
        </span>
        {(sc.notes ?? []).map((n, i) => (
          <span key={i} className="brief-note">
            {n}
          </span>
        ))}
      </div>

      {mapExpanded && <ExpandedMap scenario={sc} boardNote={boardNote} onClose={() => setMapExpanded(false)} />}

      {(sc.history || (sc.photo && photoOk)) && (
        <section className={`brief-story ${sc.photo && photoOk ? 'with-photo' : ''}`}>
          {sc.photo && photoOk && (
            <figure className="brief-photo">
              <img src={assetUrl(sc.photo.src)} alt={sc.photo.caption ?? `${name}: period photograph`} onError={() => setPhotoOk(false)} />
              {(sc.photo.caption || sc.photo.credit) && (
                <figcaption>
                  {sc.photo.caption}
                  {sc.photo.credit && <span className="muted"> {sc.photo.credit}</span>}
                </figcaption>
              )}
            </figure>
          )}
          {sc.history && (
            <div className="brief-text">
              <Paragraphs text={sc.history} lead={dateline ? dateline.toUpperCase() : undefined} />
            </div>
          )}
        </section>
      )}

      {(sc.victoryText || sc.victory.length > 0) && (
        <section className="brief-section brief-victory">
          <h4>Victory conditions</h4>
          {sc.victoryText && (
            <div className="brief-text">
              <Paragraphs text={sc.victoryText} />
            </div>
          )}
          {sc.victory.length > 0 && (
            <ul className={sc.victoryText ? 'muted small brief-enforced' : ''}>
              {sc.victoryText && <li className="brief-enforced-head">As enforced by the engine:</li>}
              {sc.victory.map((v, i) => (
                <li key={i}>{describeVictory(v, sc)}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="brief-section">
        <h4>Turn record</h4>
        <div className="brief-turns">
          <div className="brief-turn-notes">
            {setsUpFirst && (
              <span className={`side-${setsUpFirst.side}`}>
                <i className="sw" /> {setsUpFirst.name} sets up first
              </span>
            )}
            {first && (
              <span className={`side-${first.side}`}>
                <i className="sw" /> {first.name} moves first
              </span>
            )}
          </div>
          <div className="brief-track">
            {Array.from({ length: sc.turns }, (_, i) => i + 1).map((t) => (
              <span key={t} className={`brief-turn ${sc.halfFinalTurn && t === sc.turns ? 'half' : ''}`} title={enteringOn(t).length ? `Reinforcements: ${enteringOn(t).map(sideName).join(', ')}` : undefined}>
                <span className="brief-turn-marks">
                  {enteringOn(t).map((s) => (
                    <i key={s} className={`sw side-${s}`} title={`${sideName(s)} reinforcements`} />
                  ))}
                </span>
                {entryDrOn(t).map(({ f, dr }) => (
                  <span key={f.id ?? f.group} className={`brief-turn-dr side-${f.side}`} title={`${f.group ?? sideName(f.side)}: enter on a dr ≤ ${dr}`}>
                    {dr}
                  </span>
                ))}
                {t}
              </span>
            ))}
            <span className="brief-turn end">END</span>
          </div>
        </div>
      </section>

      {sc.status !== 'coming-soon' && sc.sides.map((s) => {
        const forces = sc.forces.filter((f) => f.side === s.side);
        return (
          <section key={s.side} className={`brief-section brief-ob side-${s.side}`}>
            <h4>
              <span className="brief-ob-emblem" aria-hidden>
                <svg viewBox="-24 -24 48 48" width="26" height="26">
                  <Emblem side={s.side} />
                </svg>
              </span>
              {s.name} order of battle
              <span className="brief-ob-elr">
                ELR {s.elr}
                {Object.entries(s.elrs ?? {}).map(([n, e]) => ` (${sc.nationalityNames?.[n] ?? NATION[n] ?? n} ${e})`)}
                {s.san !== undefined && <span title="Sniper Activation Number (ASLRB A14.1)"> · SAN {s.san}</span>} · {unitCount(s.side)} counters
              </span>
            </h4>
            <div className="brief-forces">
              {forces.map((f, i) => (
                <div key={f.id ?? i} className="brief-force">
                  {f.group && <div className="brief-force-name">{f.group}</div>}
                  <div className="brief-force-rule">{setupRule(f)}:</div>
                  <div className="brief-chits">
                    {f.units.map((u, j) => (
                      <span key={j} className="brief-unit">
                        <Chit def={u.def} count={u.count} />
                        {(u.withSw ?? []).map((sw, k) => (
                          <Chit key={k} def={sw} count={u.count} />
                        ))}
                      </span>
                    ))}
                    {forceChartRules(sc)
                      .filter((c) => c.force === f.id)
                      .flatMap((c) =>
                        // Counters the chart counts out (SSR): the card prints "?" under them.
                        c.defs.map((d) => (
                          <span key={`c${d}`} className="brief-unit brief-unit-variable" title={`${c.rule ?? 'SSR'}: ${c.chart ?? 'chart'}`}>
                            <Chit def={d} count="?" />
                          </span>
                        )),
                      )}
                    {variableFor(sc, f).map((v) => (
                      // Counters a dr counts out (SSR): the card prints "?" under them.
                      <span key={`v${v.turn}`} className="brief-unit brief-unit-variable" title={`${v.rule}: ${chartLabel(v.table)}`}>
                        <Chit def={v.def} count="?" />
                        <span className="brief-variable-note small muted">
                          {v.rule}: {chartLabel(v.table)}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <details className="brief-notes">
              <summary>Counter notes</summary>
              <ul>
                {sideCounters(sc, s.side).map((d) => {
                  const img = counterImage(d.id, false);
                  return (
                    <li key={d.id}>
                      {img && <img src={img} alt="" />}
                      <span>
                        <b>{defLabel(d)}</b>
                        <span className="muted"> · {counterNotes(d).join(' · ')}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </details>
          </section>
        );
      })}

      <section className="brief-section">
        <h4>Special rules</h4>
        {sc.ssr.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <ol className="brief-ssr">
            {sc.ssr.filter((r) => !r.part).map((r, i) => (
              <li key={i}>
                {r.text ?? r.module}
                {r.module === 'text' && <span className="muted small"> (applied by the players; not enforced)</span>}
                {r.module === 'variable-reinforcements' && <VariableChart params={r.params as unknown as VariableReinforcementsParams} />}
                {r.module === 'force-chart' && <ForceChart params={r.params as unknown as ForceChartParams} />}
              </li>
            ))}
          </ol>
        )}
      </section>

      {balanceList.length > 0 && (
        <section className="brief-section">
          <h4>Balance</h4>
          {catalog && <p className="muted small">Either provision may be switched on when a game is set up; neither is on by default.</p>}
          <div className="balance">
            {balanceList.map((b) =>
              onBalance && sc.balance?.length ? (
                <label key={b.side} className={`switch ${b.unavailable ? 'off' : ''}`} title={b.unavailable}>
                  <input type="checkbox" disabled={!!b.unavailable} checked={!b.unavailable && chosen.includes(b.side)} onChange={(e) => onBalance(e.target.checked ? [...chosen, b.side] : chosen.filter((x) => x !== b.side))} />
                  <span className="knob" />
                  <span>
                    <b className={`nat nat-${b.side}`}>{sideName(b.side)}</b>: {b.text}
                    {b.unavailable && <span className="muted small"> (not available yet: {b.unavailable})</span>}
                  </span>
                </label>
              ) : (
                <div key={b.side} className={`brief-balance ${!catalog && inEffect(b.side) ? 'on' : ''}`}>
                  <span className="brief-balance-tag">{catalog ? 'Optional' : inEffect(b.side) ? 'In effect' : 'Not used'}</span>
                  <span>
                    <b className={`nat nat-${b.side}`}>{sideName(b.side)}</b>: {b.text}
                  </span>
                </div>
              ),
            )}
          </div>
        </section>
      )}

      {sc.aftermath && (
        <section className="brief-section brief-aftermath">
          <h4>Aftermath</h4>
          <div className="brief-text">
            <Paragraphs text={sc.aftermath} />
          </div>
        </section>
      )}

      {children}
    </div>
  );
}

/** The briefing over the board during a game. */
export function BriefingDialog({ scenario, onClose }: { scenario: ScenarioDef; onClose(): void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="set-backdrop" onClick={onClose}>
      <div className="set-panel brief-dialog" role="dialog" aria-label="Mission briefing" onClick={(e) => e.stopPropagation()}>
        <div className="set-head">
          <span className="kicker">Mission briefing</span>
          <button className="ghost" onClick={onClose} aria-label="Close briefing" title="Close (B or Esc)">
            ✕
          </button>
        </div>
        <div className="brief-scroll">
          <Briefing scenario={scenario} />
        </div>
      </div>
    </div>
  );
}

const VICTORY_KEY = 'asl.victoryOpen';

/** The victory conditions, always at hand in the side panel; folds to a single line. */
export function VictoryPanel({ scenario }: { scenario: ScenarioDef }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(VICTORY_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(VICTORY_KEY, o ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !o;
    });
  };
  const lines = scenario.victory.map((v) => describeVictory(v, scenario));
  return (
    <section className={`panel victory-panel ${open ? 'open' : ''}`}>
      <button className="victory-head" onClick={toggle} aria-expanded={open}>
        <h3>Victory</h3>
        {!open && <span className="victory-peek">{lines[0]}</span>}
        <span className="victory-chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <ul className="victory-list">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
