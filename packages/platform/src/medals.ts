import { COMPUTER_NAME } from './computer';
import type { AwardedMedal, MatchAwards, MatchMode, MedalId, ServiceRecord, UserDoc } from './types';

/**
 * When the beta closed, as an ISO date, or null while it runs. Set it the day the beta ends and
 * deploy: from then on the beta ribbons can never be earned again, which is the point of them.
 */
export const BETA_CLOSED_AT: string | null = null;

/** Whether the beta is open at `at` (ms since the epoch). */
export const betaOpen = (at: number = Date.now()): boolean => BETA_CLOSED_AT === null || at < Date.parse(BETA_CLOSED_AT);

/** Online matches, each in a different scenario, that the Beta Campaign Ribbon asks for. */
export const BETA_CAMPAIGN_GOAL = 10;

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

// ---------------------------------------------------------------------------------------------------------------------
// The service record: what a finished match adds.

/** Where results come from: ranked matches against players, or games against the computer opponent. */
export type Pool = 'human' | 'bot';

export const serviceKey = (scenarioId: string, side: string) => `${scenarioId} ${side}`;

export const emptyServiceRecord = (): ServiceRecord => ({
  human: {},
  bot: {},
  balanceWins: { human: 0, bot: 0 },
  suddenDeath: { human: [], bot: [] },
  winRun: [],
  winRuns: 0,
  conductRun: 0,
  conductBlocks: 0,
});

/** A deep copy: every part of the record is fresh, so a caller's copy is never changed. */
const cloneRecord = (r: ServiceRecord): ServiceRecord => ({
  human: Object.fromEntries(Object.entries(r.human).map(([k, t]) => [k, { ...t }])),
  bot: { ...r.bot },
  balanceWins: { ...r.balanceWins },
  suddenDeath: { human: [...r.suddenDeath.human], bot: [...r.suddenDeath.bot] },
  winRun: [...r.winRun],
  winRuns: r.winRuns,
  conductRun: r.conductRun,
  conductBlocks: r.conductBlocks,
});

/** Wins in a row, each in a different scenario, for the Silver Star. */
export const WIN_RUN = 7;
/** Counted matches without an early concession or a timeout, for the Good Conduct Medal. */
export const CONDUCT_BLOCK = 30;

/**
 * A finished match as the record takes it. Only matches that count reach it: a ranked match against a player played
 * to its result or given up (conceded, or lost on the clock) after half its turns, or a game against the computer
 * played to its result.
 */
export interface ServiceResult {
  pool: Pool;
  scenarioId: string;
  side: string;
  outcome: 'win' | 'loss' | 'draw';
  /** The result's reason: 'scenario end' or 'sudden death' from the engine, 'concession' or 'timeout' from a player. */
  reason: string;
  /** The opponent played with its scenario's balance option. */
  opponentBalance: boolean;
}

/**
 * The record after a counted match.
 * - A win counts in every case. A loss counts unless it was on the clock; a conceded loss counts.
 * - The Silver Star's run grows with each win in a scenario not yet in it; a loss or a draw ends it.
 * - Good Conduct: the player's own timeout starts the count again, the opponent's is neutral, everything else counts.
 * - Against the computer only wins are kept.
 */
export function recordResult(before: ServiceRecord | undefined, r: ServiceResult): ServiceRecord {
  const s = cloneRecord(before ?? emptyServiceRecord());
  const key = serviceKey(r.scenarioId, r.side);
  const won = r.outcome === 'win';
  if (r.pool === 'bot') {
    if (!won) return s;
    s.bot[key] = (s.bot[key] ?? 0) + 1;
    if (r.opponentBalance) s.balanceWins.bot++;
    if (r.reason === 'sudden death' && !s.suddenDeath.bot.includes(r.scenarioId)) s.suddenDeath.bot.push(r.scenarioId);
    return s;
  }
  const tally = (s.human[key] ??= {});
  const ownTimeout = r.outcome === 'loss' && r.reason === 'timeout';
  if (won) tally.w = (tally.w ?? 0) + 1;
  else if (r.outcome === 'draw') tally.d = (tally.d ?? 0) + 1;
  else if (!ownTimeout) tally.l = (tally.l ?? 0) + 1;
  if (Object.keys(tally).length === 0) delete s.human[key];
  if (won && r.opponentBalance) s.balanceWins.human++;
  if (won && r.reason === 'sudden death' && !s.suddenDeath.human.includes(r.scenarioId)) s.suddenDeath.human.push(r.scenarioId);
  if (won) {
    s.winRun = s.winRun.includes(r.scenarioId) ? [r.scenarioId] : [...s.winRun, r.scenarioId];
    if (s.winRun.length >= WIN_RUN) {
      s.winRuns++;
      s.winRun = [];
    }
  } else s.winRun = [];
  if (ownTimeout) s.conductRun = 0;
  else if (!(won && r.reason === 'timeout')) {
    s.conductRun++;
    if (s.conductRun >= CONDUCT_BLOCK) {
      s.conductBlocks++;
      s.conductRun = 0;
    }
  }
  return s;
}

/** A ranked match the player gave up (conceded, or ran out of time) before half its turns: Good Conduct starts again. */
export function recordEarlyQuit(before: ServiceRecord | undefined): ServiceRecord {
  return { ...cloneRecord(before ?? emptyServiceRecord()), conductRun: 0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// The scenarios as the decorations see them.

/** One side of a scenario: its id, the army it fields and the card's name for it. */
export interface ServiceSide {
  side: string;
  army: string;
  name: string;
}

/** A scenario's place in the war, from its card: theatre, US campaign, a battle with its own decoration, year, armies. */
export interface ServiceScenario {
  id: string;
  number: string;
  title: string;
  theatre: string;
  campaign?: string;
  battle?: string;
  year: number;
  sides: ServiceSide[];
  /** The computer opponent can play this side. */
  botSides: string[];
}

export const THEATRES: { id: string; name: string }[] = [
  { id: 'nw-europe', name: 'Northwest Europe' },
  { id: 'eastern-front', name: 'Eastern Front' },
  { id: 'mediterranean', name: 'Mediterranean' },
  { id: 'pacific', name: 'Pacific' },
];

/** The US campaigns with a battle star, Europe and the Mediterranean first, then the Pacific. */
export const CAMPAIGNS: { id: string; name: string; pacific?: true }[] = [
  { id: 'sicily', name: 'Sicily' },
  { id: 'rome-arno', name: 'Rome-Arno' },
  { id: 'normandy', name: 'Normandy' },
  { id: 'northern-france', name: 'Northern France' },
  { id: 'southern-france', name: 'Southern France' },
  { id: 'rhineland', name: 'Rhineland' },
  { id: 'ardennes-alsace', name: 'Ardennes-Alsace' },
  { id: 'guadalcanal', name: 'Guadalcanal', pacific: true },
  { id: 'india-burma', name: 'India-Burma', pacific: true },
  { id: 'western-pacific', name: 'Western Pacific', pacific: true },
  { id: 'luzon', name: 'Luzon', pacific: true },
];

export const ARMY_NAMES: Record<string, string> = {
  american: 'Americans', german: 'Germans', russian: 'Russians', british: 'British', canadian: 'Canadians',
  'free-french': 'Free French', italian: 'Italians', greek: 'Greeks', dutch: 'Dutch', japanese: 'Japanese',
};

const AXIS = new Set(['german', 'italian', 'japanese']);
const COMMONWEALTH = new Set(['british', 'canadian']);
const SMALLER_ALLIES = ['dutch', 'greek', 'free-french', 'canadian'];
const allied = (army: string) => !AXIS.has(army);

// ---------------------------------------------------------------------------------------------------------------------
// The decorations.

export type Nation = 'us' | 'uk' | 'de' | 'su' | 'jp' | 'it' | 'fr' | 'nl' | 'gr' | 'be' | 'beta';

export const NATIONS: Record<Nation, string> = {
  us: 'United States', uk: 'United Kingdom', de: 'Germany', su: 'Soviet Union', jp: 'Japan', it: 'Italy', fr: 'France',
  nl: 'Netherlands', gr: 'Greece', be: 'Belgium', beta: 'Open ASL',
};

export type Tier = 'supreme' | 'valour' | 'merit' | 'campaign' | 'battle' | 'service' | 'beta';

export const TIERS: { id: Tier; name: string }[] = [
  { id: 'supreme', name: 'Supreme decorations' },
  { id: 'valour', name: 'High valour' },
  { id: 'merit', name: 'Valour and merit' },
  { id: 'campaign', name: 'Campaign and theatre' },
  { id: 'battle', name: 'Battle honours' },
  { id: 'service', name: 'Service' },
  { id: 'beta', name: 'Beta' },
];

/** What a decoration is measured from. */
export interface AwardContext {
  record: ServiceRecord;
  catalogue: ServiceScenario[];
  betaScenarios: string[];
}

/** One count toward a decoration's next level, e.g. "wins 23 of 160". */
export interface MeasurePart {
  label: string;
  value: number;
  goal: number;
}

/** A scenario on a decoration's checklist: the sides that count there and the player's wins from each. */
export interface ChecklistRow {
  scenario: ServiceScenario;
  sides: { side: string; army: string; name: string; wins: number }[];
  /** It counts as one of the different scenarios the decoration asks for. */
  done: boolean;
}

/** A group a decoration asks wins in: a year, a theatre, an army, a campaign. */
export interface GroupRow {
  label: string;
  value: number;
  goal: number;
}

export interface Measure {
  /** Times earned (stars) or class reached; 0 while not yet earned. */
  level: number;
  /** Toward the next level (the first award, or the next star or class). Empty once there is nothing further. */
  parts: MeasurePart[];
  checklist?: ChecklistRow[];
  groups?: GroupRow[];
  /** What the groups are, e.g. "Wins in each year". */
  groupsTitle?: string;
}

export interface Medal {
  id: MedalId;
  name: string;
  /** Short name for the ribbon rack tooltip. */
  short: string;
  nation: Nation;
  tier: Tier;
  /** How it is earned, in a sentence. */
  criteria: string;
  /** Order of precedence on the rack (lower is worn higher). */
  precedence: number;
  /** Shown as a picture of the medal itself (`/medals/<id>.webp`) rather than its ribbon. */
  art?: true;
  /** The ribbon as CSS stripes, left to right, mirrored. Decorations without it use the ribbon image `/ribbons/<file>`. */
  stripes?: string[];
  /** What each level beyond the first adds: a star, an oak leaf, or a class (named in `classes`). */
  device?: 'star' | 'oak-leaf' | 'class';
  classes?: string[];
  /** Only while the beta is open. */
  beta?: true;
  /** Where the results it counts come from; absent for the beta ribbons. */
  pool?: Pool;
  measure(ctx: AwardContext): Measure;
}

type Filter = (sc: ServiceScenario, side: ServiceSide) => boolean;

const winsIn = (record: ServiceRecord, pool: Pool, scenarioId: string, side: string): number =>
  pool === 'bot' ? (record.bot[serviceKey(scenarioId, side)] ?? 0) : (record.human[serviceKey(scenarioId, side)]?.w ?? 0);

/** Earned at `first`, then once more for every further `every`; 0 before. */
const repeatLevel = (value: number, first: number, every?: number) =>
  value < first ? 0 : 1 + (every ? Math.floor((value - first) / every) : 0);

/** The count toward the next level of a repeating measure. */
function nextPart(label: string, value: number, first: number, every: number | undefined, level: number): MeasurePart[] {
  if (level === 0) return [{ label, value, goal: first }];
  if (!every) return [];
  return [{ label: `${label} toward the next`, value: value - first - (level - 1) * every, goal: every }];
}

function checklist(ctx: AwardContext, pool: Pool, filter: Filter, bothSides: boolean): ChecklistRow[] {
  const rows: ChecklistRow[] = [];
  for (const sc of ctx.catalogue) {
    // Against the computer a side can be won only where the computer plays the other one.
    const sides = sc.sides.filter((sd) => filter(sc, sd) && (pool === 'human' || sc.sides.some((o) => o.side !== sd.side && sc.botSides.includes(o.side))));
    if (!sides.length) continue;
    const counted = sides.map((sd) => ({ ...sd, wins: winsIn(ctx.record, pool, sc.id, sd.side) }));
    const done = bothSides ? sc.sides.length === counted.length && counted.every((c) => c.wins > 0) : counted.some((c) => c.wins > 0);
    rows.push({ scenario: sc, sides: counted, done });
  }
  return rows;
}

/** "N wins in K different scenarios" (from both sides with `bothSides`), and with `every` a star for every further N. */
function wins(o: { pool: Pool; filter?: Filter; wins: number; distinct?: number; bothSides?: boolean; every?: number }) {
  return (ctx: AwardContext): Measure => {
    const rows = checklist(ctx, o.pool, o.filter ?? (() => true), !!o.bothSides);
    const total = rows.reduce((n, r) => n + r.sides.reduce((m, s) => m + s.wins, 0), 0);
    const distinct = rows.filter((r) => r.done).length;
    const met = distinct >= (o.distinct ?? 0);
    const level = met ? repeatLevel(total, o.wins, o.every) : 0;
    const parts: MeasurePart[] = level === 0
      ? [{ label: 'Wins', value: total, goal: o.wins }, ...(o.distinct ? [{ label: o.bothSides ? 'Scenarios won from both sides' : 'Different scenarios', value: distinct, goal: o.distinct }] : [])]
      : nextPart('Wins', total, o.wins, o.every, level);
    return { level, parts, ...(o.distinct || o.bothSides ? { checklist: rows } : {}) };
  };
}

/** Wins in every one of the named groups, or in any `any` of them, `per` wins each. */
function groups(o: { pool: Pool; title: string; filter?: Filter; key: (sc: ServiceScenario, side: ServiceSide) => string | null; groups: { id: string; label: string }[]; per: number; any?: number }) {
  return (ctx: AwardContext): Measure => {
    const counts = new Map<string, number>();
    for (const sc of ctx.catalogue) {
      for (const sd of sc.sides) {
        if (o.filter && !o.filter(sc, sd)) continue;
        const k = o.key(sc, sd);
        if (k !== null) counts.set(k, (counts.get(k) ?? 0) + winsIn(ctx.record, o.pool, sc.id, sd.side));
      }
    }
    const rows = o.groups.map((g) => ({ label: g.label, value: counts.get(g.id) ?? 0, goal: o.per }));
    const met = rows.filter((r) => r.value >= r.goal).length;
    const need = o.any ?? rows.length;
    const level = met >= need ? 1 : 0;
    return { level, parts: level ? [] : [{ label: o.title, value: met, goal: need }], groups: rows, groupsTitle: o.title };
  };
}

/** A campaign medal: `first` wins in its theatres, then a battle star for each campaign with `perStar` wins. */
function campaignMedal(o: { pacific: boolean; first: number; perStar: number }) {
  return (ctx: AwardContext): Measure => {
    const inTheatre = (sc: ServiceScenario) => (sc.theatre === 'pacific') === o.pacific;
    let total = 0;
    const byCampaign = new Map<string, number>();
    for (const sc of ctx.catalogue) {
      if (!inTheatre(sc)) continue;
      const w = sc.sides.reduce((n, sd) => n + winsIn(ctx.record, 'human', sc.id, sd.side), 0);
      total += w;
      if (sc.campaign) byCampaign.set(sc.campaign, (byCampaign.get(sc.campaign) ?? 0) + w);
    }
    const campaigns = CAMPAIGNS.filter((c) => !!c.pacific === o.pacific && ctx.catalogue.some((sc) => sc.campaign === c.id));
    const rows = campaigns.map((c) => ({ label: c.name, value: byCampaign.get(c.id) ?? 0, goal: o.perStar }));
    const stars = rows.filter((r) => r.value >= r.goal).length;
    const level = total >= o.first ? 1 + stars : 0;
    const parts = level === 0 ? [{ label: 'Wins', value: total, goal: o.first }] : stars < rows.length ? [{ label: 'Campaign stars', value: stars, goal: rows.length }] : [];
    return { level, parts, groups: rows, groupsTitle: `Battle stars: ${o.perStar} wins in a campaign` };
  };
}

/** A count that earns the decoration at `first` and again for every further `every`. */
function counter(label: string, value: (ctx: AwardContext) => number, first: number, every?: number) {
  return (ctx: AwardContext): Measure => {
    const v = value(ctx);
    const level = repeatLevel(v, first, every);
    return { level, parts: nextPart(label, v, first, every, level) };
  };
}

const army = (...armies: string[]): Filter => (_sc, sd) => armies.includes(sd.army);
const theatre = (t: string, f?: Filter): Filter => (sc, sd) => sc.theatre === t && (!f || f(sc, sd));
const humanLosses = (ctx: AwardContext) => Object.values(ctx.record.human).reduce((n, t) => n + (t.l ?? 0), 0);
const scenariosPlayed = (ctx: AwardContext) =>
  new Set(Object.entries(ctx.record.human).filter(([, t]) => (t.w ?? 0) + (t.l ?? 0) + (t.d ?? 0) > 0).map(([k]) => k.split(' ')[0])).size;

const YEARS = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: String(from + i), label: String(from + i) }));

/** Award definitions in order of precedence. */
const DEFS: Omit<Medal, 'precedence'>[] = [
  // Supreme
  { id: 'us-medal-of-honor', name: 'Medal of Honor', short: 'MoH', nation: 'us', tier: 'supreme', art: true, pool: 'human',
    criteria: '400 wins against players, from both sides in 50 different scenarios.',
    measure: wins({ pool: 'human', wins: 400, distinct: 50, bothSides: true }) },
  { id: 'uk-victoria-cross', name: 'Victoria Cross', short: 'VC', nation: 'uk', tier: 'supreme', art: true, pool: 'human',
    criteria: '250 wins against players in 50 different scenarios.',
    measure: wins({ pool: 'human', wins: 250, distinct: 50 }) },
  { id: 'de-knights-cross-diamonds', name: "Knight's Cross with Oak Leaves, Swords and Diamonds", short: 'RK-EL-S-B', nation: 'de', tier: 'supreme', art: true, pool: 'human',
    criteria: '160 wins against players as the Germans, in 40 different scenarios.',
    measure: wins({ pool: 'human', filter: army('german'), wins: 160, distinct: 40 }) },
  { id: 'su-hero-of-the-soviet-union', name: 'Hero of the Soviet Union', short: 'HSU', nation: 'su', tier: 'supreme', art: true, pool: 'human',
    criteria: '100 Eastern Front wins against players, from both sides in 10 different scenarios.',
    measure: wins({ pool: 'human', filter: theatre('eastern-front'), wins: 100, distinct: 10, bothSides: true }) },
  { id: 'jp-golden-kite', name: 'Order of the Golden Kite', short: 'OGK', nation: 'jp', tier: 'supreme', art: true, pool: 'human',
    criteria: '80 Pacific wins against players, from both sides in 8 different scenarios.',
    measure: wins({ pool: 'human', filter: theatre('pacific'), wins: 80, distinct: 8, bothSides: true }) },
  // High valour
  { id: 'us-distinguished-service-cross', name: 'Distinguished Service Cross', short: 'DSC', nation: 'us', tier: 'valour', pool: 'human',
    criteria: '80 wins against players as the Americans, in 20 different scenarios.',
    measure: wins({ pool: 'human', filter: army('american'), wins: 80, distinct: 20 }) },
  { id: 'us-navy-cross', name: 'Navy Cross', short: 'NC', nation: 'us', tier: 'valour', pool: 'human',
    criteria: '50 Pacific wins against players as the Americans, in 8 different scenarios.',
    measure: wins({ pool: 'human', filter: theatre('pacific', army('american')), wins: 50, distinct: 8 }) },
  { id: 'uk-distinguished-service-order', name: 'Distinguished Service Order', short: 'DSO', nation: 'uk', tier: 'valour', pool: 'human',
    criteria: '30 wins against players as the British or Commonwealth, in 6 different scenarios.',
    measure: wins({ pool: 'human', filter: (_sc, sd) => COMMONWEALTH.has(sd.army), wins: 30, distinct: 6 }) },
  { id: 'de-knights-cross-swords', name: "Knight's Cross with Oak Leaves and Swords", short: 'RK-EL-S', nation: 'de', tier: 'valour', pool: 'human',
    criteria: '100 wins against players as the Germans, in 30 different scenarios.',
    measure: wins({ pool: 'human', filter: army('german'), wins: 100, distinct: 30 }) },
  { id: 'de-knights-cross', name: "Knight's Cross of the Iron Cross", short: 'RK', nation: 'de', tier: 'valour', pool: 'human',
    criteria: '40 wins against players as the Germans, in 15 different scenarios.',
    measure: wins({ pool: 'human', filter: army('german'), wins: 40, distinct: 15 }) },
  { id: 'su-order-of-lenin', name: 'Order of Lenin', short: 'OL', nation: 'su', tier: 'valour', pool: 'human',
    criteria: '50 Eastern Front wins against players as the Russians, in 10 different scenarios.',
    measure: wins({ pool: 'human', filter: theatre('eastern-front', army('russian')), wins: 50, distinct: 10 }) },
  { id: 'it-gold-medal-military-valour', name: 'Gold Medal of Military Valour', short: 'MOVM', nation: 'it', tier: 'valour', pool: 'human',
    criteria: '15 wins against players as the Italians, in 3 different scenarios.',
    measure: wins({ pool: 'human', filter: army('italian'), wins: 15, distinct: 3 }) },
  { id: 'fr-legion-of-honour', name: "Légion d'honneur", short: 'LH', nation: 'fr', tier: 'valour', pool: 'human',
    criteria: '20 wins against players as the Free French, in 4 different scenarios.',
    measure: wins({ pool: 'human', filter: army('free-french'), wins: 20, distinct: 4 }) },
  { id: 'nl-military-william-order', name: 'Military William Order', short: 'MWO', nation: 'nl', tier: 'valour', pool: 'human',
    criteria: '3 wins against players as each of four smaller Allied armies: Dutch, Greek, Free French, Canadian.',
    measure: groups({ pool: 'human', title: 'Armies with 3 wins', key: (_sc, sd) => (SMALLER_ALLIES.includes(sd.army) ? sd.army : null), groups: SMALLER_ALLIES.map((a) => ({ id: a, label: ARMY_NAMES[a]! })), per: 3, any: 4 }) },
  { id: 'jp-order-of-the-rising-sun', name: 'Order of the Rising Sun', short: 'ORS', nation: 'jp', tier: 'valour', pool: 'human',
    criteria: '35 wins against players as the Japanese, in 6 different scenarios.',
    measure: wins({ pool: 'human', filter: army('japanese'), wins: 35, distinct: 6 }) },
  { id: 'us-silver-star', name: 'Silver Star', short: 'SS', nation: 'us', tier: 'valour', device: 'star', pool: 'human',
    criteria: `${WIN_RUN} wins in a row against players, each in a different scenario; a star for each further run.`,
    measure: (ctx) => ({ level: ctx.record.winRuns, parts: [{ label: 'Wins in a row, different scenarios', value: ctx.record.winRun.length, goal: WIN_RUN }] }) },
  { id: 'us-legion-of-merit', name: 'Legion of Merit', short: 'LM', nation: 'us', tier: 'valour', pool: 'bot',
    criteria: `850 wins over ${COMPUTER_NAME}, from both sides in 25 different scenarios.`,
    measure: wins({ pool: 'bot', wins: 850, distinct: 25, bothSides: true }) },
  { id: 'uk-defence-medal', name: 'Defence Medal', short: 'DM', nation: 'uk', tier: 'valour', pool: 'bot',
    criteria: `400 wins over ${COMPUTER_NAME} in 25 different scenarios.`,
    measure: wins({ pool: 'bot', wins: 400, distinct: 25 }) },
  // Valour and merit
  { id: 'us-bronze-star', name: 'Bronze Star Medal', short: 'BSM', nation: 'us', tier: 'merit', device: 'star', pool: 'human',
    criteria: '15 wins against players as the Americans; a star for every further 15.',
    measure: wins({ pool: 'human', filter: army('american'), wins: 15, every: 15 }) },
  { id: 'de-iron-cross-2nd-class', name: 'Iron Cross 2nd Class', short: 'EK II', nation: 'de', tier: 'merit', device: 'star', pool: 'human',
    criteria: '20 wins against players as the Germans; a star for every further 20.',
    measure: wins({ pool: 'human', filter: army('german'), wins: 20, every: 20 }) },
  { id: 'su-medal-for-courage', name: 'Medal "For Courage"', short: 'FC', nation: 'su', tier: 'merit', device: 'star', pool: 'human',
    criteria: '15 wins against players as the Russians; a star for every further 15.',
    measure: wins({ pool: 'human', filter: army('russian'), wins: 15, every: 15 }) },
  { id: 'su-order-of-glory', name: 'Order of Glory', short: 'OG', nation: 'su', tier: 'merit', device: 'class', classes: ['3rd Class', '2nd Class', '1st Class'], pool: 'human',
    criteria: 'Win the same Eastern Front scenario from both sides against players: 3rd Class in 3 scenarios, 2nd in 6, 1st in 9.',
    measure: (ctx) => {
      const rows = checklist(ctx, 'human', theatre('eastern-front'), true);
      const n = rows.filter((r) => r.done).length;
      const steps = [3, 6, 9];
      const level = steps.filter((s) => n >= s).length;
      return { level, parts: level < steps.length ? [{ label: 'Scenarios won from both sides', value: n, goal: steps[level]! }] : [], checklist: rows };
    } },
  { id: 'fr-croix-de-guerre', name: 'Croix de Guerre 1939–1945', short: 'CdG', nation: 'fr', tier: 'merit', device: 'star', pool: 'human',
    criteria: '8 wins against players as the Free French; a star for every further 8.',
    measure: wins({ pool: 'human', filter: army('free-french'), wins: 8, every: 8 }) },
  { id: 'uk-military-medal', name: 'Military Medal', short: 'MM', nation: 'uk', tier: 'merit', device: 'star', pool: 'human',
    criteria: '8 wins against players who had the balance option; a star for every further 8.',
    measure: counter('Wins against the balance option', (ctx) => ctx.record.balanceWins.human, 8, 8) },
  { id: 'us-presidential-unit-citation', name: 'Presidential Unit Citation', short: 'PUC', nation: 'us', tier: 'merit', device: 'star', pool: 'human',
    criteria: 'Sudden-death wins against players in 6 different scenarios; a star for every further 6.',
    measure: counter('Scenarios won by sudden death', (ctx) => ctx.record.suddenDeath.human.length, 6, 6) },
  { id: 'us-purple-heart', name: 'Purple Heart', short: 'PH', nation: 'us', tier: 'merit', device: 'star', pool: 'human',
    criteria: '20 losses against players (a late concession counts, a loss on the clock does not); a star for every further 20.',
    measure: counter('Losses', humanLosses, 20, 20) },
  { id: 'us-american-defense', name: 'American Defense Service Medal', short: 'ADSM', nation: 'us', tier: 'merit', pool: 'bot',
    criteria: `150 wins over ${COMPUTER_NAME} as the Americans, in 10 different scenarios.`,
    measure: wins({ pool: 'bot', filter: army('american'), wins: 150, distinct: 10 }) },
  { id: 'de-west-wall', name: 'West Wall Medal', short: 'WW', nation: 'de', tier: 'merit', pool: 'bot',
    criteria: `150 wins over ${COMPUTER_NAME} as the Germans, in 10 different scenarios.`,
    measure: wins({ pool: 'bot', filter: army('german'), wins: 150, distinct: 10 }) },
  { id: 'su-valiant-labour', name: 'Medal "For Valiant Labour"', short: 'VL', nation: 'su', tier: 'merit', pool: 'bot',
    criteria: `75 Eastern Front wins over ${COMPUTER_NAME} as the Russians, in 5 different scenarios.`,
    measure: wins({ pool: 'bot', filter: theatre('eastern-front', army('russian')), wins: 75, distinct: 5 }) },
  { id: 'jp-china-incident', name: 'China Incident War Medal', short: 'CIWM', nation: 'jp', tier: 'merit', pool: 'bot',
    criteria: `60 Pacific wins over ${COMPUTER_NAME} as the Japanese, in 4 different scenarios.`,
    measure: wins({ pool: 'bot', filter: theatre('pacific', army('japanese')), wins: 60, distinct: 4 }) },
  { id: 'uk-mention-in-despatches', name: 'Mention in Despatches', short: 'MiD', nation: 'uk', tier: 'merit', device: 'oak-leaf', pool: 'bot',
    criteria: `15 wins over ${COMPUTER_NAME} while it had the balance option; an oak leaf for every further 15.`,
    measure: counter('Wins against the balance option', (ctx) => ctx.record.balanceWins.bot, 15, 15) },
  { id: 'us-soldiers-medal', name: "Soldier's Medal", short: 'SM', nation: 'us', tier: 'merit', device: 'star', pool: 'bot',
    criteria: `Sudden-death wins over ${COMPUTER_NAME} in 6 different scenarios; a star for every further 6.`,
    measure: counter('Scenarios won by sudden death', (ctx) => ctx.record.suddenDeath.bot.length, 6, 6) },
  // Campaign and theatre
  { id: 'us-eame-campaign', name: 'European-African-Middle Eastern Campaign Medal', short: 'EAME', nation: 'us', tier: 'campaign', device: 'star', pool: 'human',
    criteria: '10 wins against players in Europe or the Mediterranean; a battle star for each US campaign with 5 wins in it.',
    measure: campaignMedal({ pacific: false, first: 10, perStar: 5 }) },
  { id: 'us-asiatic-pacific-campaign', name: 'Asiatic-Pacific Campaign Medal', short: 'APCM', nation: 'us', tier: 'campaign', device: 'star', pool: 'human',
    criteria: '10 Pacific wins against players; a battle star for each campaign with 5 wins in it.',
    measure: campaignMedal({ pacific: true, first: 10, perStar: 5 }) },
  { id: 'us-victory-medal', name: 'World War II Victory Medal', short: 'WWII', nation: 'us', tier: 'campaign', pool: 'human',
    criteria: '10 wins against players in each of four different theatres.',
    measure: groups({ pool: 'human', title: 'Theatres with 10 wins', key: (sc) => sc.theatre, groups: THEATRES.map((t) => ({ id: t.id, label: t.name })), per: 10, any: 4 }) },
  { id: 'uk-1939-1945-star', name: '1939–1945 Star', short: '39–45', nation: 'uk', tier: 'campaign', pool: 'human',
    criteria: '5 wins against players in scenarios set in each year from 1940 to 1945.',
    measure: groups({ pool: 'human', title: 'Years with 5 wins', key: (sc) => String(sc.year), groups: YEARS(1940, 1945), per: 5 }) },
  { id: 'uk-france-and-germany-star', name: 'France and Germany Star', short: 'F&G', nation: 'uk', tier: 'campaign', pool: 'human',
    criteria: '40 Northwest Europe wins against players as the Allies, in 10 different scenarios.',
    measure: wins({ pool: 'human', filter: theatre('nw-europe', (_sc, sd) => allied(sd.army)), wins: 40, distinct: 10 }) },
  { id: 'uk-italy-star', name: 'Italy Star', short: 'IS', nation: 'uk', tier: 'campaign', pool: 'human',
    criteria: '20 wins against players as the Allies in Sicily or Italy (1943 on), in 5 different scenarios.',
    measure: wins({ pool: 'human', filter: theatre('mediterranean', (sc, sd) => sc.year >= 1943 && allied(sd.army)), wins: 20, distinct: 5 }) },
  { id: 'uk-burma-star', name: 'Burma Star', short: 'BS', nation: 'uk', tier: 'campaign', pool: 'human',
    criteria: '10 Burma wins against players as the Allies, in 2 different scenarios.',
    measure: wins({ pool: 'human', filter: (sc, sd) => sc.campaign === 'india-burma' && allied(sd.army), wins: 10, distinct: 2 }) },
  { id: 'su-order-of-the-patriotic-war', name: 'Order of the Patriotic War', short: 'OPW', nation: 'su', tier: 'campaign', pool: 'human',
    criteria: '3 wins against players as the Russians in scenarios set in each year from 1941 to 1945.',
    measure: groups({ pool: 'human', title: 'Years with 3 Russian wins', filter: army('russian'), key: (sc) => String(sc.year), groups: YEARS(1941, 1945), per: 3 }) },
  { id: 'gr-war-cross', name: 'Greek War Cross', short: 'GWC', nation: 'gr', tier: 'campaign', pool: 'human',
    criteria: '12 wins against players as the Allies in the Balkans or Crete (1940–41), in 3 different scenarios.',
    measure: wins({ pool: 'human', filter: theatre('mediterranean', (sc, sd) => sc.year <= 1941 && allied(sd.army)), wins: 12, distinct: 3 }) },
  { id: 'uk-war-medal', name: 'War Medal 1939–1945', short: 'WM', nation: 'uk', tier: 'campaign', pool: 'bot',
    criteria: `25 wins over ${COMPUTER_NAME} in each of four different theatres.`,
    measure: groups({ pool: 'bot', title: 'Theatres with 25 wins', key: (sc) => sc.theatre, groups: THEATRES.map((t) => ({ id: t.id, label: t.name })), per: 25, any: 4 }) },
  // Battle honours
  { id: 'su-defence-of-stalingrad', name: 'Medal "For the Defence of Stalingrad"', short: 'DS', nation: 'su', tier: 'battle', pool: 'human',
    criteria: '12 Stalingrad wins against players as the Russians, in 3 different scenarios.',
    measure: wins({ pool: 'human', filter: (sc, sd) => sc.battle === 'stalingrad' && sd.army === 'russian', wins: 12, distinct: 3 }) },
  { id: 'be-croix-de-guerre', name: 'Belgian Croix de Guerre 1940', short: 'BCdG', nation: 'be', tier: 'battle', pool: 'human',
    criteria: '15 Ardennes wins against players as the Americans, in 4 different scenarios.',
    measure: wins({ pool: 'human', filter: (sc, sd) => sc.campaign === 'ardennes-alsace' && sd.army === 'american', wins: 15, distinct: 4 }) },
  { id: 'nl-bronze-lion', name: 'Bronze Lion', short: 'BL', nation: 'nl', tier: 'battle', pool: 'human',
    criteria: '12 Market Garden wins against players, either side, in 3 different scenarios.',
    measure: wins({ pool: 'human', filter: (sc) => sc.battle === 'market-garden', wins: 12, distinct: 3 }) },
  { id: 'fr-ordre-de-la-liberation', name: 'Ordre de la Libération', short: 'OL', nation: 'fr', tier: 'battle', pool: 'human',
    criteria: '25 Normandy wins against players, either side, in 6 different scenarios.',
    measure: wins({ pool: 'human', filter: (sc) => sc.campaign === 'normandy', wins: 25, distinct: 6 }) },
  { id: 'us-navy-unit-commendation', name: 'Navy Unit Commendation', short: 'NUC', nation: 'us', tier: 'battle', pool: 'human',
    criteria: '12 Guadalcanal wins against players, either side, in 3 different scenarios.',
    measure: wins({ pool: 'human', filter: (sc) => sc.campaign === 'guadalcanal', wins: 12, distinct: 3 }) },
  // Service
  { id: 'us-good-conduct', name: 'Good Conduct Medal', short: 'GCM', nation: 'us', tier: 'service', device: 'star', pool: 'human',
    criteria: `${CONDUCT_BLOCK} matches against players without conceding early or timing out; a star for every further ${CONDUCT_BLOCK}.`,
    measure: (ctx) => ({ level: ctx.record.conductBlocks, parts: [{ label: 'Matches in good conduct', value: ctx.record.conductRun, goal: CONDUCT_BLOCK }] }) },
  { id: 'su-battle-merit', name: 'Medal "For Battle Merit"', short: 'BM', nation: 'su', tier: 'service', device: 'star', pool: 'human',
    criteria: 'Play 20 different scenarios against players to a counted result; a star for every further 10.',
    measure: counter('Different scenarios played', scenariosPlayed, 20, 10) },
  { id: 'us-american-campaign', name: 'American Campaign Medal', short: 'ACM', nation: 'us', tier: 'service', device: 'star', pool: 'bot',
    criteria: `20 wins over ${COMPUTER_NAME}; a star for every further 40.`,
    measure: wins({ pool: 'bot', wins: 20, every: 40 }) },
  // Beta
  { id: 'beta-campaign', name: 'Beta Campaign Ribbon', short: 'BCR', nation: 'beta', tier: 'beta', beta: true,
    criteria: `Complete ${BETA_CAMPAIGN_GOAL} online matches during the beta, each in a different scenario.`,
    stripes: ['#141414', '#d4af37', '#141414', '#d4af37', '#141414'],
    measure: (ctx) => ({ level: ctx.betaScenarios.length >= BETA_CAMPAIGN_GOAL ? 1 : 0, parts: [{ label: 'Scenarios', value: Math.min(ctx.betaScenarios.length, BETA_CAMPAIGN_GOAL), goal: BETA_CAMPAIGN_GOAL }] }) },
  { id: 'beta-service', name: 'Beta Service Ribbon', short: 'BSR', nation: 'beta', tier: 'beta', beta: true,
    criteria: 'Complete an online match during the beta.',
    stripes: ['#f0c419', '#1d3f8a', '#ffffff', '#b22234', '#f0c419'],
    measure: (ctx) => ({ level: ctx.betaScenarios.length >= 1 ? 1 : 0, parts: [{ label: 'Online matches', value: Math.min(ctx.betaScenarios.length, 1), goal: 1 }] }) },
];

export const MEDALS: readonly Medal[] = DEFS.map((d, i) => ({ ...d, precedence: i + 1 }));

const BY_ID = new Map(MEDALS.map((m) => [m.id, m]));
export const medalById = (id: MedalId): Medal => BY_ID.get(id)!;
/** Whether an id on a stored record is a current decoration (records may still hold retired ones). */
export const isMedalId = (id: string): id is MedalId => BY_ID.has(id as MedalId);

/** The name a level is worn under: the class for the Order of Glory, the decoration's own name otherwise. */
export const levelName = (m: Medal, level: number): string => (m.classes ? `${m.name}, ${m.classes[Math.max(0, Math.min(level, m.classes.length) - 1)]}` : m.name);

/** Every decoration measured against a record. */
export function measureAll(ctx: AwardContext): Map<MedalId, Measure> {
  return new Map(MEDALS.map((m) => [m.id, m.measure(ctx)]));
}

/** Decorations whose level rose above what the player holds: newly earned, a further star, or a higher class. */
export function awardChanges(held: readonly AwardedMedal[], ctx: AwardContext): { id: MedalId; level: number }[] {
  const have = new Map(held.filter((h) => isMedalId(h.id)).map((h) => [h.id, h.level ?? 1]));
  const out: { id: MedalId; level: number }[] = [];
  for (const m of MEDALS) {
    // The beta ribbons stop with the beta: betaScenarios only grows while it is open (countsForBeta).
    const { level } = m.measure(ctx);
    if (level > (have.get(m.id) ?? 0)) out.push({ id: m.id, level });
  }
  return out;
}

/** The held decorations with `changes` applied, retired ids dropped. `at` stamps what changed. */
export function applyAwardChanges(held: readonly AwardedMedal[], changes: { id: MedalId; level: number }[], at: unknown): AwardedMedal[] {
  const out = held.filter((h) => isMedalId(h.id)).map((h) => ({ ...h }));
  for (const c of changes) {
    const prev = out.find((h) => h.id === c.id);
    if (prev) Object.assign(prev, { level: c.level, levelAt: at });
    else out.push({ id: c.id, awardedAt: at, ...(c.level > 1 ? { level: c.level, levelAt: at } : {}) });
  }
  return out;
}

/** Each decoration's headline count and goal, for the public profile (no scenario detail). */
export function awardProgress(ctx: AwardContext): Partial<Record<MedalId, [number, number]>> {
  const out: Partial<Record<MedalId, [number, number]>> = {};
  for (const [id, m] of measureAll(ctx)) {
    const p = m.parts[0];
    if (p) out[id] = [Math.min(p.value, p.goal), p.goal];
  }
  return out;
}

/** How far one part has come, 0 to 1. */
export const partShare = (p: MeasurePart) => (p.goal > 0 ? Math.min(1, p.value / p.goal) : 1);

/** How far a measure has come toward its next level, 0 to 1: its parts' average. */
export const measureShare = (m: Measure) => (m.parts.length ? m.parts.reduce((n, p) => n + partShare(p), 0) / m.parts.length : 1);

/**
 * The decorations a result would move forward (a part's count rises), for the lobby's hints and the result screen.
 * Measured before and after on the same catalogue, so it can never disagree with the awarding itself.
 */
export function advancedBy(ctx: AwardContext, result: ServiceResult): { id: MedalId; before: Measure; after: Measure }[] {
  const after = { ...ctx, record: recordResult(ctx.record, result) };
  const out: { id: MedalId; before: Measure; after: Measure }[] = [];
  for (const m of MEDALS) {
    if (m.beta) continue;
    const b = m.measure(ctx);
    const a = m.measure(after);
    const moved = a.level > b.level
      || a.parts.some((p, i) => p.label === b.parts[i]?.label && p.value > b.parts[i]!.value)
      // A win in a group still short of its count (one year of the 1939–1945 Star) moves no headline part.
      || (a.parts.length > 0 && (a.groups ?? []).some((g, i) => g.value > (b.groups?.[i]?.value ?? 0) && b.groups![i]!.value < g.goal));
    if (moved) out.push({ id: m.id, before: b, after: a });
  }
  return out;
}

/**
 * A counted result applied to a player: the new service record, the decorations held after it (newly earned ones and
 * further stars stamped `at`), the public progress counts, and what the match did for the result screen.
 */
export function serviceAfter(user: Pick<UserDoc, 'service' | 'medals' | 'betaScenarios'>, result: ServiceResult, at: unknown, catalogue: ServiceScenario[]) {
  const before: AwardContext = { record: user.service ?? emptyServiceRecord(), catalogue, betaScenarios: user.betaScenarios ?? [] };
  const service = recordResult(user.service, result);
  const after: AwardContext = { ...before, record: service };
  const changes = awardChanges(user.medals, after);
  const awards: MatchAwards = {
    earned: changes,
    advanced: advancedBy(before, result).filter((a) => a.after.parts.length > 0).map((a) => ({ id: a.id, value: a.after.parts[0]!.value, goal: a.after.parts[0]!.goal })),
  };
  return { service, medals: applyAwardChanges(user.medals, changes, at), awardProgress: awardProgress(after), awards };
}
