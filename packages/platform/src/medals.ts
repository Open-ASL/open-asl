import type { MatchMode, MedalId, UserDoc } from './types';

/**
 * When the beta closed, as an ISO date, or null while it runs. Set it the day the beta ends and
 * deploy: from then on the beta ribbons can never be earned again, which is the point of them.
 */
export const BETA_CLOSED_AT: string | null = null;

/** Whether the beta is open at `at` (ms since the epoch). */
export const betaOpen = (at: number = Date.now()): boolean => BETA_CLOSED_AT === null || at < Date.parse(BETA_CLOSED_AT);

/** Online matches, each in a different scenario, that the Beta Campaign Ribbon asks for. */
export const BETA_CAMPAIGN_GOAL = 10;

/**
 * Decorations, named after the real US WW2 awards. The criteria are placeholders until the
 * achievement system is designed; the UI says so. The beta ribbons are the exception: they are
 * real, and limited to the beta.
 */
export interface Medal {
  id: MedalId;
  name: string;
  /** Short name for the ribbon rack tooltip. */
  short: string;
  criteria: string;
  /** Ribbon stripes, left to right, as CSS colours. Mirrored to keep the ribbon symmetric. */
  ribbon: string[];
  /** Order of precedence on the rack (lower is worn higher). */
  precedence: number;
  /** Earnable only while the beta is open; never again once it has closed. */
  beta?: true;
}

export const MEDALS: readonly Medal[] = [
  { id: 'moh', name: 'Medal of Honor', short: 'MoH', criteria: 'Reach a rating of 1800.', ribbon: ['#7fb3ff', '#ffffff', '#7fb3ff', '#ffffff'], precedence: 1 },
  { id: 'dsc', name: 'Distinguished Service Cross', short: 'DSC', criteria: 'Defeat an opponent rated 200 or more above you.', ribbon: ['#1d3f8a', '#ffffff', '#b22234'], precedence: 2 },
  { id: 'silver-star', name: 'Silver Star', short: 'SS', criteria: 'Win three matches against other players in a row.', ribbon: ['#b22234', '#ffffff', '#1d3f8a', '#ffffff', '#b22234'], precedence: 3 },
  { id: 'bronze-star', name: 'Bronze Star Medal', short: 'BSM', criteria: 'Win five matches against other players.', ribbon: ['#b22234', '#ffffff', '#1d3f8a'], precedence: 4 },
  { id: 'purple-heart', name: 'Purple Heart', short: 'PH', criteria: 'Lose a match against another player. Wounds heal.', ribbon: ['#ffffff', '#6a1b9a', '#6a1b9a'], precedence: 5 },
  { id: 'puc', name: 'Presidential Unit Citation', short: 'PUC', criteria: 'Play 25 matches.', ribbon: ['#1d3f8a', '#1d3f8a'], precedence: 6 },
  { id: 'good-conduct', name: 'Good Conduct Medal', short: 'GCM', criteria: 'Complete ten matches without abandoning any.', ribbon: ['#ffffff', '#b22234', '#ffffff', '#b22234', '#ffffff', '#b22234'], precedence: 7 },
  { id: 'cib', name: 'Combat Infantryman Badge', short: 'CIB', criteria: 'Complete your first match against another player.', ribbon: ['#4a6fa5', '#c0c0c0', '#4a6fa5'], precedence: 8 },
  { id: 'eame-campaign', name: 'European-African-Middle Eastern Campaign Medal', short: 'EAME', criteria: 'Complete every Starter Kit scenario at least once.', ribbon: ['#5d8a3a', '#ffffff', '#b22234', '#ffffff', '#5d8a3a', '#8b5a2b'], precedence: 9 },
  { id: 'american-campaign', name: 'American Campaign Medal', short: 'ACM', criteria: 'Complete five hotseat games. Training counts.', ribbon: ['#1d3f8a', '#ffffff', '#b22234', '#ffffff', '#1d3f8a'], precedence: 10 },
  {
    id: 'beta-campaign',
    name: 'Beta Campaign Ribbon',
    short: 'BCR',
    criteria: `Complete ${BETA_CAMPAIGN_GOAL} online matches during the beta, each in a different scenario.`,
    ribbon: ['#141414', '#d4af37', '#141414', '#d4af37', '#141414'],
    precedence: 11,
    beta: true,
  },
  {
    id: 'beta-service',
    name: 'Beta Service Ribbon',
    short: 'BSR',
    criteria: 'Complete an online match during the beta.',
    ribbon: ['#f0c419', '#1d3f8a', '#ffffff', '#b22234', '#f0c419'],
    precedence: 12,
    beta: true,
  },
];

export const medalById = (id: MedalId): Medal => MEDALS.find((m) => m.id === id)!;

/** What the awarding function knows about the match that just finished. */
export interface MedalContext {
  mode: 'hotseat' | 'online';
  /** Set for vs-human results. */
  won?: boolean;
  lost?: boolean;
  /** Opponent's rating before the match. */
  opponentElo?: number;
  /** Own rating before the match. */
  ownEloBefore?: number;
  /** Every scenario id in the Starter Kit, so the campaign medal knows what "all" means. */
  allScenarioIds: string[];
}

/** What decides whether a finished match counts toward the beta ribbons. */
export interface BetaMatchFacts {
  mode: MatchMode;
  /** The result's reason: 'scenario end' or 'sudden death' from the engine, 'concession' or 'timeout' from a player. */
  reason: string;
  /** The position the match ended in. */
  turn: number;
  attacker: string;
  /** The scenario as played (balance applied). */
  firstSide: string;
  turns: number;
  halfFinalTurn: boolean;
}

/**
 * Whether a finished match counts toward the beta ribbons: an online match, finished while the
 * beta was open, played to a result under the rules or given up (conceded, or lost on the
 * clock) only after at least half of its turns had been played. A game thrown in at the start
 * earns nothing for either player.
 */
export function countsForBeta(m: BetaMatchFacts, at: number = Date.now()): boolean {
  if (m.mode !== 'online' || !betaOpen(at)) return false;
  if (m.reason !== 'concession' && m.reason !== 'timeout') return true;
  // In player turns: the whole game, and the part of it played before the match was given up.
  const length = 2 * m.turns - (m.halfFinalTurn ? 1 : 0);
  const played = 2 * (m.turn - 1) + (m.attacker !== m.firstSide ? 1 : 0);
  return played * 2 >= length;
}

/** Progress toward the Beta Campaign Ribbon. */
export function betaProgress(user: Pick<UserDoc, 'betaScenarios'>): { scenarios: string[]; goal: number; remaining: number } {
  const scenarios = user.betaScenarios ?? [];
  return { scenarios, goal: BETA_CAMPAIGN_GOAL, remaining: Math.max(0, BETA_CAMPAIGN_GOAL - scenarios.length) };
}

type Stats = Pick<UserDoc, 'elo' | 'wins' | 'losses' | 'draws' | 'onlineGames' | 'hotseatGames' | 'abandoned' | 'streak' | 'scenariosCompleted' | 'medals' | 'betaScenarios'>;

/**
 * Medals newly earned given the player's stats *after* the match has been applied.
 * Already-held medals are never returned.
 */
export function evaluateMedals(after: Stats, ctx: MedalContext): MedalId[] {
  const held = new Set(after.medals.map((m) => m.id));
  const earned: MedalId[] = [];
  const check = (id: MedalId, ok: boolean) => {
    if (ok && !held.has(id)) earned.push(id);
  };
  const played = after.onlineGames + after.hotseatGames;
  check('cib', after.onlineGames >= 1);
  check('purple-heart', after.losses >= 1);
  check('bronze-star', after.wins >= 5);
  check('silver-star', after.streak >= 3);
  check('dsc', ctx.mode === 'online' && !!ctx.won && ctx.opponentElo !== undefined && ctx.ownEloBefore !== undefined && ctx.opponentElo - ctx.ownEloBefore >= 200);
  check('moh', after.elo >= 1800);
  check('good-conduct', played >= 10 && after.abandoned === 0);
  check('american-campaign', after.hotseatGames >= 5);
  check('eame-campaign', ctx.allScenarioIds.length > 0 && ctx.allScenarioIds.every((id) => after.scenariosCompleted.includes(id)));
  check('puc', played >= 25);
  // betaScenarios only grows while the beta is open (countsForBeta), so these stop with it.
  const beta = after.betaScenarios ?? [];
  check('beta-service', beta.length >= 1);
  check('beta-campaign', beta.length >= BETA_CAMPAIGN_GOAL);
  return earned;
}
