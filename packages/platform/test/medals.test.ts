import { describe, expect, it } from 'vitest';
import {
  BETA_CAMPAIGN_GOAL,
  CONDUCT_BLOCK,
  MEDALS,
  WIN_RUN,
  advancedBy,
  applyAwardChanges,
  awardChanges,
  awardProgress,
  betaOpen,
  betaProgress,
  countsForBeta,
  emptyServiceRecord,
  medalById,
  recordEarlyQuit,
  recordResult,
  type AwardContext,
  type ServiceResult,
  type ServiceScenario,
} from '../src/medals';
import type { MedalId, ServiceRecord } from '../src/types';

// A made-up catalogue with every theatre, campaign, battle and army the decorations name.
const sc = (id: string, theatre: string, year: number, a: [string, string], b: [string, string], extra: Partial<ServiceScenario> = {}): ServiceScenario => ({
  id, number: id.toUpperCase(), title: id, theatre, year,
  sides: [{ side: a[0], army: a[1], name: a[1] }, { side: b[0], army: b[1], name: b[1] }],
  botSides: [a[0], b[0]],
  ...extra,
});
const CATALOGUE: ServiceScenario[] = [
  sc('nw1', 'nw-europe', 1944, ['am', 'american'], ['ge', 'german'], { campaign: 'normandy' }),
  sc('nw2', 'nw-europe', 1944, ['br', 'british'], ['ge', 'german'], { campaign: 'rhineland', battle: 'market-garden' }),
  sc('nw3', 'nw-europe', 1940, ['al', 'dutch'], ['ge', 'german']),
  sc('nw4', 'nw-europe', 1944, ['br', 'canadian'], ['ge', 'german'], { campaign: 'normandy' }),
  sc('ef1', 'eastern-front', 1942, ['ru', 'russian'], ['ge', 'german'], { battle: 'stalingrad' }),
  sc('ef2', 'eastern-front', 1941, ['ru', 'russian'], ['ge', 'german']),
  sc('me1', 'mediterranean', 1940, ['it', 'italian'], ['al', 'greek']),
  sc('me2', 'mediterranean', 1944, ['br', 'free-french'], ['ge', 'german'], { campaign: 'rome-arno' }),
  sc('pa1', 'pacific', 1942, ['am', 'american'], ['ja', 'japanese'], { campaign: 'guadalcanal' }),
  sc('pa2', 'pacific', 1945, ['am', 'american'], ['ja', 'japanese'], { campaign: 'luzon' }),
];
const ctx = (record: ServiceRecord = emptyServiceRecord(), betaScenarios: string[] = []): AwardContext => ({ record, catalogue: CATALOGUE, betaScenarios });
const result = (r: Partial<ServiceResult> & Pick<ServiceResult, 'scenarioId' | 'side'>): ServiceResult => ({ pool: 'human', outcome: 'win', reason: 'scenario end', opponentBalance: false, ...r });
const play = (results: ServiceResult[], start: ServiceRecord = emptyServiceRecord()) => results.reduce(recordResult, start);
const times = (n: number, r: ServiceResult) => Array.from({ length: n }, () => r);
const level = (id: MedalId, record: ServiceRecord) => medalById(id).measure(ctx(record)).level;

describe('the service record', () => {
  it('keeps wins, losses and draws by scenario and side', () => {
    const r = play([result({ scenarioId: 'nw1', side: 'am' }), result({ scenarioId: 'nw1', side: 'am', outcome: 'loss' }), result({ scenarioId: 'nw1', side: 'ge', outcome: 'draw' })]);
    expect(r.human).toEqual({ 'nw1 am': { w: 1, l: 1 }, 'nw1 ge': { d: 1 } });
  });
  it('a loss on the clock is not a counted loss, and starts Good Conduct again', () => {
    const r = play([result({ scenarioId: 'nw1', side: 'am' }), result({ scenarioId: 'nw1', side: 'am', outcome: 'loss', reason: 'timeout' })]);
    expect(r.human['nw1 am']).toEqual({ w: 1 });
    expect(r.conductRun).toBe(0);
  });
  it('a late concession is a counted loss and keeps Good Conduct going', () => {
    const r = play([result({ scenarioId: 'nw1', side: 'am', outcome: 'loss', reason: 'concession' })]);
    expect(r.human['nw1 am']).toEqual({ l: 1 });
    expect(r.conductRun).toBe(1);
  });
  it('a win on the opponent’s clock counts as a win but leaves Good Conduct where it was', () => {
    const r = play([result({ scenarioId: 'nw1', side: 'am' }), result({ scenarioId: 'nw2', side: 'br', reason: 'timeout' })]);
    expect(r.human['nw2 br']).toEqual({ w: 1 });
    expect(r.conductRun).toBe(1);
  });
  it('an early concession or timeout starts Good Conduct again and changes nothing else', () => {
    const before = play(times(5, result({ scenarioId: 'nw1', side: 'am' })));
    const after = recordEarlyQuit(before);
    expect(after.conductRun).toBe(0);
    expect(after.human).toEqual(before.human);
    expect(before.conductRun).toBe(5);
  });
  it(`completes a block of Good Conduct every ${CONDUCT_BLOCK} matches`, () => {
    const r = play(times(CONDUCT_BLOCK + 2, result({ scenarioId: 'nw1', side: 'am', outcome: 'draw' })));
    expect([r.conductBlocks, r.conductRun]).toEqual([1, 2]);
  });
  it('against the computer only wins are kept, and none of them count against players', () => {
    const r = play([result({ pool: 'bot', scenarioId: 'nw1', side: 'am' }), result({ pool: 'bot', scenarioId: 'nw1', side: 'am', outcome: 'loss' })]);
    expect(r.bot).toEqual({ 'nw1 am': 1 });
    expect(r.human).toEqual({});
    expect(r.conductRun).toBe(0);
  });
  it('balance and sudden-death wins are kept per pool, sudden death once per scenario', () => {
    const r = play([
      result({ scenarioId: 'nw1', side: 'am', opponentBalance: true, reason: 'sudden death' }),
      result({ scenarioId: 'nw1', side: 'am', reason: 'sudden death' }),
      result({ pool: 'bot', scenarioId: 'nw2', side: 'br', opponentBalance: true }),
      result({ scenarioId: 'nw1', side: 'am', outcome: 'loss', opponentBalance: true }),
    ]);
    expect(r.balanceWins).toEqual({ human: 1, bot: 1 });
    expect(r.suddenDeath).toEqual({ human: ['nw1'], bot: [] });
  });
  it(`the Silver Star run needs ${WIN_RUN} wins in different scenarios: a repeat starts it again, a loss ends it`, () => {
    const ids = ['nw1', 'nw2', 'nw3', 'nw4', 'ef1', 'ef2', 'me1', 'me2'];
    const win = (id: string) => result({ scenarioId: id, side: CATALOGUE.find((s) => s.id === id)!.sides[0]!.side });
    expect(play([win('nw1'), win('nw2'), win('nw1')]).winRun).toEqual(['nw1']);
    expect(play([win('nw1'), win('nw2'), result({ scenarioId: 'nw3', side: 'al', outcome: 'loss' })]).winRun).toEqual([]);
    const r = play(ids.slice(0, WIN_RUN).map(win));
    expect([r.winRuns, r.winRun]).toEqual([1, []]);
    expect(level('us-silver-star', r)).toBe(1);
  });
  it('never changes the record it was given', () => {
    const before = play([result({ scenarioId: 'nw1', side: 'am' })]);
    const copy = JSON.parse(JSON.stringify(before));
    recordResult(before, result({ scenarioId: 'nw1', side: 'am' }));
    recordEarlyQuit(before);
    expect(before).toEqual(copy);
  });
});

describe('the decorations', () => {
  it('each has a unique precedence, a nation and a tier, and every non-beta one counts one pool', () => {
    expect(new Set(MEDALS.map((m) => m.precedence)).size).toBe(MEDALS.length);
    expect(new Set(MEDALS.map((m) => m.id)).size).toBe(MEDALS.length);
    for (const m of MEDALS) if (!m.beta) expect(['human', 'bot']).toContain(m.pool);
    expect(MEDALS.filter((m) => !m.beta)).toHaveLength(50);
  });
  it('only the supreme decorations are shown as medals', () => {
    expect(MEDALS.filter((m) => m.art).map((m) => m.tier)).toEqual(Array(5).fill('supreme'));
  });
  it('none is earned by a single result, from either side of any scenario, against players or the computer', () => {
    for (const s of CATALOGUE) for (const sd of s.sides) for (const pool of ['human', 'bot'] as const) for (const outcome of ['win', 'loss', 'draw'] as const) {
      for (const reason of ['scenario end', 'sudden death']) {
        const r = recordResult(undefined, result({ pool, scenarioId: s.id, side: sd.side, outcome, reason, opponentBalance: true }));
        expect(awardChanges([], ctx(r)), `${pool} ${outcome} ${s.id} ${sd.side} ${reason}`).toEqual([]);
      }
    }
  });
  it('counts wins and the different scenarios they came in', () => {
    // Knight's Cross: 40 German wins in 15 different scenarios. The catalogue has 7 German sides, so it never comes.
    const r = play(times(40, result({ scenarioId: 'nw1', side: 'ge' })));
    const m = medalById('de-knights-cross').measure(ctx(r));
    expect(m.level).toBe(0);
    expect(m.parts).toEqual([{ label: 'Wins', value: 40, goal: 40 }, { label: 'Different scenarios', value: 1, goal: 15 }]);
    expect(m.checklist!.filter((c) => c.done).map((c) => c.scenario.id)).toEqual(['nw1']);
    // Every scenario with a German side is on its checklist, with the German side only.
    expect(m.checklist!.map((c) => c.scenario.id)).toEqual(['nw1', 'nw2', 'nw3', 'nw4', 'ef1', 'ef2', 'me2']);
    expect(m.checklist!.every((c) => c.sides.length === 1 && c.sides[0]!.army === 'german')).toBe(true);
  });
  it('the Gold Medal of Military Valour: 15 Italian wins in 3 scenarios is out of reach with one Italian scenario', () => {
    expect(level('it-gold-medal-military-valour', play(times(15, result({ scenarioId: 'me1', side: 'it' }))))).toBe(0);
  });
  it('the Légion d’honneur needs its wins as the Free French', () => {
    const m = medalById('fr-legion-of-honour').measure(ctx(play(times(3, result({ scenarioId: 'me2', side: 'br' })))));
    expect(m.parts[0]).toEqual({ label: 'Wins', value: 3, goal: 20 });
  });
  it('from both sides: a scenario counts once each side has won it', () => {
    const r = play([result({ scenarioId: 'ef1', side: 'ru' }), result({ scenarioId: 'ef2', side: 'ru' }), result({ scenarioId: 'ef2', side: 'ge' })]);
    const m = medalById('su-hero-of-the-soviet-union').measure(ctx(r));
    expect(m.checklist!.map((c) => [c.scenario.id, c.done])).toEqual([['ef1', false], ['ef2', true]]);
    expect(m.parts[1]).toEqual({ label: 'Scenarios won from both sides', value: 1, goal: 10 });
  });
  it('a star for every further count: the Bronze Star at 15, 30 and 45 American wins', () => {
    const am = result({ scenarioId: 'nw1', side: 'am' });
    expect([14, 15, 29, 30, 45].map((n) => level('us-bronze-star', play(times(n, am))))).toEqual([0, 1, 1, 2, 3]);
    expect(medalById('us-bronze-star').measure(ctx(play(times(20, am)))).parts).toEqual([{ label: 'Wins toward the next', value: 5, goal: 15 }]);
  });
  it('the Order of Glory rises a class at 3, 6 and 9 scenarios won from both sides', () => {
    const m = medalById('su-order-of-glory');
    expect(m.classes).toEqual(['3rd Class', '2nd Class', '1st Class']);
    expect(m.measure(ctx()).parts[0]).toEqual({ label: 'Scenarios won from both sides', value: 0, goal: 3 });
  });
  it('the 1939–1945 Star needs 5 wins in a scenario of each year from 1940 to 1945', () => {
    const m = medalById('uk-1939-1945-star').measure(ctx(play(times(5, result({ scenarioId: 'nw3', side: 'ge' })))));
    expect(m.groups!.map((g) => [g.label, g.value])).toEqual([['1940', 5], ['1941', 0], ['1942', 0], ['1943', 0], ['1944', 0], ['1945', 0]]);
    expect(m.parts).toEqual([{ label: 'Years with 5 wins', value: 1, goal: 6 }]);
  });
  it('the Military William Order counts any four smaller Allied armies with 3 wins each', () => {
    const r = play([...times(3, result({ scenarioId: 'nw3', side: 'al' })), ...times(3, result({ scenarioId: 'me1', side: 'al' })), ...times(3, result({ scenarioId: 'me2', side: 'br' })), ...times(2, result({ scenarioId: 'nw4', side: 'br' }))]);
    expect(medalById('nl-military-william-order').measure(ctx(r)).parts).toEqual([{ label: 'Armies with 3 wins', value: 3, goal: 4 }]);
    expect(level('nl-military-william-order', recordResult(r, result({ scenarioId: 'nw4', side: 'br' })))).toBe(1);
  });
  it('a campaign medal: 10 wins in its theatres, then a battle star for each campaign with 5 wins', () => {
    const nine = play(times(9, result({ scenarioId: 'nw1', side: 'am' })));
    expect(level('us-eame-campaign', nine)).toBe(0);
    // 10 wins, 10 of them in Normandy: the medal and its Normandy star.
    expect(level('us-eame-campaign', recordResult(nine, result({ scenarioId: 'nw1', side: 'am' })))).toBe(2);
    // Pacific wins count only for the Asiatic-Pacific medal.
    expect(level('us-eame-campaign', play(times(20, result({ scenarioId: 'pa1', side: 'am' }))))).toBe(0);
    expect(level('us-asiatic-pacific-campaign', play(times(20, result({ scenarioId: 'pa1', side: 'am' }))))).toBe(2);
  });
  it('a checklist against the computer lists the sides the player can take against it', () => {
    const one = CATALOGUE.map((s) => (s.id === 'nw1' ? { ...s, botSides: ['ge'] } : s));
    const rows = medalById('us-american-defense').measure({ ...ctx(), catalogue: one }).checklist!;
    expect(rows.find((r) => r.scenario.id === 'nw1')!.sides.map((s) => s.side)).toEqual(['am']);
    const german = medalById('de-west-wall').measure({ ...ctx(), catalogue: one }).checklist!;
    expect(german.find((r) => r.scenario.id === 'nw1')).toBeUndefined();
  });
  it('wins over the computer count only for its decorations', () => {
    const r = play(times(20, result({ pool: 'bot', scenarioId: 'nw1', side: 'am' })));
    expect(awardChanges([], ctx(r))).toEqual([{ id: 'us-american-campaign', level: 1 }]);
  });
  it('the Purple Heart counts losses, with a star for every further 20', () => {
    const loss = result({ scenarioId: 'nw1', side: 'am', outcome: 'loss' });
    expect([19, 20, 40].map((n) => level('us-purple-heart', play(times(n, loss))))).toEqual([0, 1, 2]);
  });
  it('the beta ribbons follow the beta scenarios', () => {
    const nine = Array.from({ length: BETA_CAMPAIGN_GOAL - 1 }, (_, i) => `s${i}`);
    expect(awardChanges([], ctx(undefined, ['s0'])).map((c) => c.id)).toEqual(['beta-service']);
    expect(awardChanges([], ctx(undefined, nine)).map((c) => c.id)).toEqual(['beta-service']);
    expect(awardChanges([], ctx(undefined, [...nine, 'x'])).map((c) => c.id)).toEqual(['beta-campaign', 'beta-service']);
  });
});

describe('awarding', () => {
  const twenty = play(times(20, result({ scenarioId: 'nw1', side: 'ge' })));
  const ironCross = (changes: { id: MedalId; level: number }[]) => changes.filter((c) => c.id === 'de-iron-cross-2nd-class');
  it('never re-awards a held decoration, and raises its level for a further star', () => {
    expect(ironCross(awardChanges([{ id: 'de-iron-cross-2nd-class', awardedAt: 0 }], ctx(twenty)))).toEqual([]);
    const forty = play(times(20, result({ scenarioId: 'nw1', side: 'ge' })), twenty);
    expect(ironCross(awardChanges([{ id: 'de-iron-cross-2nd-class', awardedAt: 0 }], ctx(forty)))).toEqual([{ id: 'de-iron-cross-2nd-class', level: 2 }]);
  });
  it('20 German wins in Normandy also earn the EAME Campaign Medal with its Normandy star', () => {
    expect(awardChanges([], ctx(twenty))).toEqual([{ id: 'de-iron-cross-2nd-class', level: 1 }, { id: 'us-eame-campaign', level: 2 }]);
  });
  it('a retired decoration on the record is dropped and does not block anything', () => {
    const held = [{ id: 'cib' as MedalId, awardedAt: 0 }];
    expect(ironCross(awardChanges(held, ctx(twenty)))).toEqual([{ id: 'de-iron-cross-2nd-class', level: 1 }]);
    expect(applyAwardChanges(held, [], 1)).toEqual([]);
  });
  it('stamps a new decoration with when it was earned, and a further star with when it came', () => {
    const one = applyAwardChanges([], [{ id: 'de-iron-cross-2nd-class', level: 1 }], 'day 1');
    expect(one).toEqual([{ id: 'de-iron-cross-2nd-class', awardedAt: 'day 1' }]);
    expect(applyAwardChanges(one, [{ id: 'de-iron-cross-2nd-class', level: 2 }], 'day 9')).toEqual([{ id: 'de-iron-cross-2nd-class', awardedAt: 'day 1', level: 2, levelAt: 'day 9' }]);
  });
  it('publishes each decoration’s headline count and goal', () => {
    const p = awardProgress(ctx(twenty));
    expect(p['de-knights-cross']).toEqual([20, 40]);
    expect(p['de-iron-cross-2nd-class']).toEqual([0, 20]);
    expect(p['us-medal-of-honor']).toEqual([20, 400]);
  });
});

describe('what a result would move forward', () => {
  it('a German win in a Stalingrad scenario moves the German decorations, not the Russian ones', () => {
    const ids = advancedBy(ctx(), result({ scenarioId: 'ef1', side: 'ge' })).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['us-medal-of-honor', 'de-knights-cross', 'de-iron-cross-2nd-class', 'us-silver-star', 'us-good-conduct', 'su-battle-merit']));
    expect(ids).not.toContain('su-defence-of-stalingrad');
    expect(ids).not.toContain('su-order-of-lenin');
    expect(advancedBy(ctx(), result({ scenarioId: 'ef1', side: 'ru' })).map((a) => a.id)).toContain('su-defence-of-stalingrad');
  });
  it('a win in a year still short of its count moves the 1939–1945 Star', () => {
    expect(advancedBy(ctx(), result({ scenarioId: 'pa2', side: 'am' })).map((a) => a.id)).toContain('uk-1939-1945-star');
  });
  it('a win over the computer moves only its decorations', () => {
    const moved = advancedBy(ctx(), result({ pool: 'bot', scenarioId: 'nw1', side: 'ge' })).map((a) => medalById(a.id).pool);
    expect(new Set(moved)).toEqual(new Set(['bot']));
  });
  it('a decoration already complete does not move', () => {
    const r = play(times(40, result({ scenarioId: 'nw1', side: 'am' })));
    expect(advancedBy(ctx(r), result({ scenarioId: 'nw1', side: 'am' })).map((a) => a.id)).not.toContain('us-eame-campaign');
  });
});

describe('beta ribbons', () => {
  const facts = { mode: 'online' as const, reason: 'concession', firstSide: 'ge', turns: 6, halfFinalTurn: false };
  it('count only online matches', () => {
    expect(countsForBeta({ ...facts, mode: 'hotseat', reason: 'scenario end', turn: 6, attacker: 'am' })).toBe(false);
    expect(countsForBeta({ ...facts, reason: 'scenario end', turn: 6, attacker: 'am' })).toBe(true);
  });
  it('a game played to its result counts whenever it ends', () => {
    expect(countsForBeta({ ...facts, reason: 'sudden death', turn: 2, attacker: 'ge' })).toBe(true);
  });
  it('a concession or timeout counts only after half the turns', () => {
    // 6 turns = 12 player turns; conceding in the German half of turn 4 means 6 played.
    expect(countsForBeta({ ...facts, turn: 1, attacker: 'ge' })).toBe(false);
    expect(countsForBeta({ ...facts, turn: 3, attacker: 'am' })).toBe(false);
    expect(countsForBeta({ ...facts, turn: 4, attacker: 'ge' })).toBe(true);
    expect(countsForBeta({ ...facts, reason: 'timeout', turn: 4, attacker: 'ge' })).toBe(true);
    // 5½ turns = 11 player turns; 6 played is enough, 5 is not.
    expect(countsForBeta({ ...facts, turns: 6, halfFinalTurn: true, turn: 3, attacker: 'am' })).toBe(false);
    expect(countsForBeta({ ...facts, turns: 6, halfFinalTurn: true, turn: 4, attacker: 'ge' })).toBe(true);
  });
  it('nothing counts once the beta has closed', () => {
    // BETA_CLOSED_AT is null while the beta runs; the clock argument stands in for a closed date.
    expect(countsForBeta({ ...facts, reason: 'scenario end', turn: 6, attacker: 'am' }, Date.parse('2030-01-01'))).toBe(betaOpen(Date.parse('2030-01-01')));
  });
  it('progress toward the campaign ribbon', () => {
    const nine = Array.from({ length: 9 }, (_, i) => `s${i}`);
    expect(betaProgress({ betaScenarios: nine })).toEqual({ scenarios: nine, goal: BETA_CAMPAIGN_GOAL, remaining: 1 });
    expect(betaProgress({})).toMatchObject({ scenarios: [], remaining: 10 });
  });
});
