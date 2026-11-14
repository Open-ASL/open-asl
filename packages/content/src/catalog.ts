import { scenarioRuleset, type ScenarioDef, type ScenarioRuleset } from '@asl/rules';
import { DEMO_SCENARIO } from './scenarios/demo';
import { DEMO_GUNS_SCENARIO } from './scenarios/demoGuns';
import { DEMO_VEHICLES_SCENARIO } from './scenarios/demoVehicles';
import { DEMO_PACIFIC_SCENARIO } from './scenarios/demoPacific';
import { DEMO_JUNGLE_SCENARIO } from './scenarios/demoJungle';
import { COMMERCIAL_SCENARIOS } from './scenarios/commercial';
import { SK_DOWNLOAD_SCENARIOS } from './scenarios/skFree';
import { LMA_SCENARIOS } from './scenarios/lma';
import { ASL_SCENARIOS } from './scenarios/aslTest';
import { PRODUCTS, productById, type ProductDef } from './products';
import { COUNTERS } from './counters';

/** Whether a scenario fields Infantry only: no Gun and no vehicle in any force (weapons carried included). */
export const infantryOnly = (s: ScenarioDef): boolean =>
  !s.forces.some((f) => f.units.some((u) => [u.def, ...(u.withSw ?? [])].some((d) => COUNTERS[d]?.kind === 'gun' || COUNTERS[d]?.kind === 'vehicle')));

/** Whether a scenario fields a vehicle in any force. The computer opponent crews Guns but does not drive vehicles yet. */
export const hasVehicles = (s: ScenarioDef): boolean => s.forces.some((f) => f.units.some((u) => COUNTERS[u.def]?.kind === 'vehicle'));

/** Whether the engine can play a scenario now (catalogued "coming soon" ones only show their card facts). */
export const isPlayable = (s: ScenarioDef): boolean => s.status !== 'coming-soon';

/** The card number as printed, falling back to the first word of the title. */
export function scenarioNumber(s: ScenarioDef): string {
  return s.number ?? s.title.split(' ')[0]!;
}

/** Game length as players say it: a half final turn makes "6½" of a chart whose last box is 7. */
export const turnsLabel = (s: Pick<ScenarioDef, 'turns' | 'halfFinalTurn'>): string => (s.halfFinalTurn ? `${s.turns - 1}½` : String(s.turns));

/** The title without its leading card number. */
export function scenarioName(s: ScenarioDef): string {
  const [first, ...rest] = s.title.split(' ');
  return s.number && first === s.number ? rest.join(' ') : s.number ? s.title : rest.join(' ');
}

/** Natural order for card numbers: letters, then the number ('S1' < 'S2' < 'S10'; 'A' < 'J'). */
export function compareNumbers(a: string, b: string): number {
  const pa = a.match(/^([^\d]*)(\d*)(.*)$/)!;
  const pb = b.match(/^([^\d]*)(\d*)(.*)$/)!;
  return pa[1]!.localeCompare(pb[1]!) || Number(pa[2] || 0) - Number(pb[2] || 0) || pa[3]!.localeCompare(pb[3]!);
}

function byCatalogue(a: ScenarioDef, b: ScenarioDef): number {
  const pa = PRODUCTS.findIndex((p) => p.id === a.product);
  const pb = PRODUCTS.findIndex((p) => p.id === b.product);
  return (pa === -1 ? 1e9 : pa) - (pb === -1 ? 1e9 : pb) || compareNumbers(scenarioNumber(a), scenarioNumber(b));
}

/** Every catalogued scenario, in catalogue order: by product (as listed in PRODUCTS), then by card number. */
export const ALL_SCENARIOS: ScenarioDef[] = [...COMMERCIAL_SCENARIOS, ...SK_DOWNLOAD_SCENARIOS, ...LMA_SCENARIOS, DEMO_SCENARIO, DEMO_GUNS_SCENARIO, DEMO_VEHICLES_SCENARIO, DEMO_PACIFIC_SCENARIO, DEMO_JUNGLE_SCENARIO, ...ASL_SCENARIOS].sort(byCatalogue);

export const PLAYABLE_SCENARIOS: ScenarioDef[] = ALL_SCENARIOS.filter(isPlayable);

/** The catalogued scenarios that play under a ruleset (each lobby lists only its own). */
export const scenariosOfRuleset = (ruleset: ScenarioRuleset, from: ScenarioDef[] = ALL_SCENARIOS): ScenarioDef[] => from.filter((s) => scenarioRuleset(s) === ruleset);

/** Products that have at least one encoded scenario, in PRODUCTS order. */
export const PRODUCTS_WITH_SCENARIOS: ProductDef[] = PRODUCTS.filter((p) => ALL_SCENARIOS.some((s) => s.product === p.id));

export const scenarioById = (id: string): ScenarioDef | undefined => ALL_SCENARIOS.find((s) => s.id === id);

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Everything a search can match on a scenario, folded to lowercase ASCII. */
export function scenarioHaystack(s: ScenarioDef): string {
  const product = productById(s.product);
  return fold(
    [
      scenarioNumber(s),
      s.title,
      s.place ?? '',
      s.date ?? '',
      s.designer ?? '',
      product?.name ?? '',
      product?.short ?? '',
      ...s.sides.map((x) => x.name),
      ...s.boards.map((b) => `board ${b.board}`),
    ].join(' '),
  );
}

export interface ScenarioQuery {
  /** Free text; every word must match somewhere in the haystack. */
  text?: string;
  /** Product id, or undefined for all. */
  product?: string;
  /** Only scenarios the engine can play now. */
  playableOnly?: boolean;
}

/** Scenarios matching the query, in catalogue order. */
export function searchScenarios(query: ScenarioQuery, from: ScenarioDef[] = ALL_SCENARIOS): ScenarioDef[] {
  const words = fold(query.text ?? '').split(/\s+/).filter(Boolean);
  return from.filter((s) => {
    if (query.product && s.product !== query.product) return false;
    if (query.playableOnly && !isPlayable(s)) return false;
    if (!words.length) return true;
    const hay = scenarioHaystack(s);
    return words.every((w) => hay.includes(w));
  });
}
