import { ALL_SCENARIOS, applyBalance, scenarioById, sk1Ruleset } from '@asl/content';
import type { MatchDoc } from '@asl/platform';
import type { ScenarioDef } from '@asl/rules';

export const SCENARIOS: ScenarioDef[] = ALL_SCENARIOS;
export { scenarioById };

/** The scenario a match is played with: the base scenario with its balance options applied. */
export function matchScenario(scenarioId: string, balance: string[]): ScenarioDef | null {
  const base = scenarioById(scenarioId);
  return base ? applyBalance(base, balance) : null;
}

const hashCache = new Map<string, string>();
/** The current ruleset's version hash for a scenario and balance, as the server computes it. */
function currentVersionHash(scenarioId: string, balance: string[]): string | null {
  const key = `${scenarioId}|${[...balance].sort().join(',')}`;
  let h = hashCache.get(key);
  if (h === undefined) {
    const sc = matchScenario(scenarioId, balance);
    if (!sc) return null;
    h = sk1Ruleset(sc).versionHash;
    hashCache.set(key, h);
  }
  return h;
}

/**
 * Whether a match was recorded under rules that have since changed, so its recording can no
 * longer be replayed: it can only be ended (`leaveMatch` with `reason: 'ruleset'`), for nothing.
 */
export function matchOutdated(match: Pick<MatchDoc, 'scenarioId' | 'balance' | 'rulesetVersionHash' | 'status'>): boolean {
  if (match.status !== 'active') return false;
  const h = currentVersionHash(match.scenarioId, match.balance);
  return h !== null && h !== match.rulesetVersionHash;
}
