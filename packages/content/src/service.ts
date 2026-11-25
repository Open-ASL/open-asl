import type { Army, ScenarioDef } from '@asl/rules';
import { ALL_SCENARIOS, isPlayable, scenarioNumber } from './catalog';

/** The army a counter nationality fields when the scenario does not say otherwise. The minor Allies ('al') always say. */
const DEFAULT_ARMY: Record<string, Army> = { am: 'american', ge: 'german', ru: 'russian', br: 'british', it: 'italian', ja: 'japanese' };

/** The army a side fields: the scenario's own word for it, else its counters' nationality. */
export function armyOf(s: ScenarioDef, side: string): Army | undefined {
  const nationality = s.sides.find((sd) => sd.side === side)?.nationality;
  return s.service?.armies?.[side] ?? (nationality ? DEFAULT_ARMY[nationality] : undefined);
}

/** The year a scenario is set in, from its card's dateline. */
export function scenarioYear(s: ScenarioDef): number | undefined {
  const m = s.date?.match(/\b(19\d\d)\b/);
  return m ? Number(m[1]) : undefined;
}

/** The scenarios the service decorations count: every scenario players can play that has its place in the war set. */
export const serviceScenarios = (all: ScenarioDef[] = ALL_SCENARIOS): ScenarioDef[] =>
  all.filter((s) => s.service && isPlayable(s) && !s.devOnly && s.product !== 'demo');

/**
 * The decorations' catalogue (@asl/platform's ServiceScenario): theatre, campaign, battle, year and each side's army.
 * `botSides` names the sides the computer opponent plays, by scenario id.
 */
export function serviceCatalogue(botSides: Record<string, string[]> = {}, all: ScenarioDef[] = ALL_SCENARIOS) {
  return serviceScenarios(all).map((s) => ({
    id: s.id,
    number: scenarioNumber(s),
    title: s.title,
    theatre: s.service!.theatre,
    ...(s.service!.campaign ? { campaign: s.service!.campaign } : {}),
    ...(s.service!.battle ? { battle: s.service!.battle } : {}),
    year: scenarioYear(s) ?? 0,
    sides: s.sides.map((sd) => ({ side: sd.side, army: armyOf(s, sd.side) ?? sd.nationality, name: sd.name })),
    botSides: botSides[s.id] ?? [],
  }));
}
