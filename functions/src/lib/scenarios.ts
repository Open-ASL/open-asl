import { randomInt } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { ALL_SCENARIOS, applyBalance, isPlayable, newSk1Game, sk1Ruleset } from '@asl/content';
import type { Action, Engine, GameState } from '@asl/engine';
import { scenarioRuleset, type ScenarioDef, type ScenarioRuleset } from '@asl/rules';
import { RANDOM_SIDE, type MatchSummary, type RulesetId } from '@asl/platform';
import type { Auth } from './auth';

// The platform's lobby rulesets and the rules package's scenario rulesets are the same two names.
const sameRulesets: [RulesetId, ScenarioRuleset] extends [ScenarioRuleset, RulesetId] ? true : never = true;
void sameRulesets;

export { ALL_SCENARIOS };
/** Scenario ids that count toward the campaign medal. */
export const CAMPAIGN_SCENARIO_IDS = ALL_SCENARIOS.filter((s) => s.product === 'sk1').map((s) => s.id);

/** Validate a scenario choice and apply its balance options; returns the playable scenario and the ruleset hash it pins. */
export function prepareScenario(scenarioId: unknown, balance: unknown): { scenario: ScenarioDef; balance: string[]; versionHash: string } {
  const base = ALL_SCENARIOS.find((s) => s.id === scenarioId);
  if (!base) throw new HttpsError('invalid-argument', 'Unknown scenario.');
  if (!isPlayable(base)) throw new HttpsError('failed-precondition', 'That scenario is not playable yet.', { code: 'coming-soon' });
  // A scenario kept from players is played in the emulator only.
  if (base.devOnly && process.env['FUNCTIONS_EMULATOR'] !== 'true') throw new HttpsError('failed-precondition', 'That scenario is not playable yet.', { code: 'coming-soon' });
  const allowed = new Set((base.balance ?? []).map((b) => b.side));
  const sides = Array.isArray(balance) ? balance.filter((b): b is string => typeof b === 'string') : [];
  for (const s of sides) if (!allowed.has(s)) throw new HttpsError('invalid-argument', `No balance option for ${s}.`);
  const scenario = applyBalance(base, sides);
  return { scenario, balance: sides, versionHash: sk1Ruleset(scenario).versionHash };
}

/** The lobby ruleset a scenario belongs to, which a match or post on it carries. */
export const rulesetOf = (scenario: ScenarioDef): RulesetId => scenarioRuleset(scenario);

/**
 * Full ASL is behind the development gate: open on the emulators and to accounts with the `admin`
 * claim, closed to everyone else (the web lobby shows it as coming soon; see `rulesetsFor`).
 */
export const fullAslOpen = (auth: Auth): boolean => process.env.FUNCTIONS_EMULATOR === 'true' || auth.token.admin === true;

/**
 * The caller may play this scenario's ruleset, and the lobby they asked from (`asked`, when sent)
 * is that ruleset: a Full ASL scenario is never started from the Starter Kit lobby, nor the reverse.
 */
export function requireRuleset(auth: Auth, scenario: ScenarioDef, asked?: unknown): RulesetId {
  const ruleset = rulesetOf(scenario);
  if (asked !== undefined && asked !== ruleset) throw new HttpsError('invalid-argument', 'That scenario belongs to another ruleset.');
  if (ruleset === 'full-asl' && !fullAslOpen(auth)) throw new HttpsError('failed-precondition', 'Full ASL is not open yet.', { code: 'coming-soon' });
  return ruleset;
}

export function requireSide(scenario: ScenarioDef, side: unknown): string {
  const s = scenario.sides.find((x) => x.side === side);
  if (!s) throw new HttpsError('invalid-argument', 'Unknown side.');
  return s.side;
}

/** A side id, or RANDOM_SIDE for a draw later. */
export function requireSideChoice(scenario: ScenarioDef, side: unknown): string {
  return side === RANDOM_SIDE ? RANDOM_SIDE : requireSide(scenario, side);
}

/** Draw one of the scenario's sides at random. */
export function drawSide(scenario: ScenarioDef): string {
  return scenario.sides[randomInt(scenario.sides.length)]!.side;
}

export function otherSide(scenario: ScenarioDef, side: string): string {
  return scenario.sides.find((s) => s.side !== side)!.side;
}

/** Replay recorded actions from the seed; the engine is deterministic so this reproduces the game exactly. */
export function replay(scenario: ScenarioDef, seed: string, actions: Action[]): { engine: Engine; state: GameState } {
  const { engine, state: s0 } = newSk1Game(scenario, seed);
  let state = s0;
  for (const a of actions) state = engine.submit(state, a).state;
  return { engine, state };
}

/** The lobby's view of a position, including whose decision the engine is waiting on. */
export function summaryOf(engine: Engine, state: GameState): MatchSummary {
  return { turn: state.turn, phase: state.phase, attacker: state.attacker, seq: state.seq, toMove: state.result ? null : (engine.currentDecision(state)?.owner ?? null) };
}
