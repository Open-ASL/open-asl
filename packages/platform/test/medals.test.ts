import { describe, expect, it } from 'vitest';
import { BETA_CAMPAIGN_GOAL, MEDALS, betaOpen, betaProgress, countsForBeta, evaluateMedals } from '../src/medals';

const base = { elo: 1200, wins: 0, losses: 0, draws: 0, onlineGames: 0, hotseatGames: 0, abandoned: 0, streak: 0, scenariosCompleted: [] as string[], medals: [] as { id: never; awardedAt: unknown }[] };
const ctx = { mode: 'online' as const, allScenarioIds: ['sk-s7'] };

describe('medals', () => {
  it('every medal has a symmetric-capable ribbon and a unique precedence', () => {
    const prec = new Set(MEDALS.map((m) => m.precedence));
    expect(prec.size).toBe(MEDALS.length);
    for (const m of MEDALS) expect(m.ribbon.length).toBeGreaterThan(0);
  });
  it('a first online game earns the CIB, a loss the Purple Heart', () => {
    expect(evaluateMedals({ ...base, onlineGames: 1, losses: 1 }, { ...ctx, lost: true })).toEqual(['cib', 'purple-heart']);
  });
  it('never re-awards a held medal', () => {
    const held = { ...base, onlineGames: 1, medals: [{ id: 'cib' as never, awardedAt: 0 }] };
    expect(evaluateMedals(held, ctx)).toEqual([]);
  });
  it('the DSC needs an upset of 200 points', () => {
    expect(evaluateMedals({ ...base, onlineGames: 1, wins: 1, streak: 1 }, { ...ctx, won: true, ownEloBefore: 1200, opponentElo: 1399 })).not.toContain('dsc');
    expect(evaluateMedals({ ...base, onlineGames: 1, wins: 1, streak: 1 }, { ...ctx, won: true, ownEloBefore: 1200, opponentElo: 1400 })).toContain('dsc');
  });
  it('the campaign medal needs every scenario', () => {
    expect(evaluateMedals({ ...base, hotseatGames: 1, scenariosCompleted: ['sk-s7'] }, { mode: 'hotseat', allScenarioIds: ['sk-s7', 'sk-s8'] })).not.toContain('eame-campaign');
    expect(evaluateMedals({ ...base, hotseatGames: 1, scenariosCompleted: ['sk-s7'] }, { mode: 'hotseat', allScenarioIds: ['sk-s7'] })).toContain('eame-campaign');
  });
  it('good conduct is lost to a single abandonment', () => {
    expect(evaluateMedals({ ...base, hotseatGames: 10 }, { mode: 'hotseat', allScenarioIds: [] })).toContain('good-conduct');
    expect(evaluateMedals({ ...base, hotseatGames: 10, abandoned: 1 }, { mode: 'hotseat', allScenarioIds: [] })).not.toContain('good-conduct');
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
  it('the service ribbon takes one beta match, the campaign ribbon ten scenarios', () => {
    expect(evaluateMedals({ ...base, onlineGames: 1, betaScenarios: ['sk-s7'] }, ctx)).toEqual(['cib', 'beta-service']);
    const nine = Array.from({ length: 9 }, (_, i) => `s${i}`);
    expect(evaluateMedals({ ...base, onlineGames: 9, betaScenarios: nine }, ctx)).not.toContain('beta-campaign');
    expect(evaluateMedals({ ...base, onlineGames: 10, betaScenarios: [...nine, 's9'] }, ctx)).toContain('beta-campaign');
    expect(betaProgress({ betaScenarios: nine })).toEqual({ scenarios: nine, goal: BETA_CAMPAIGN_GOAL, remaining: 1 });
    expect(betaProgress({})).toMatchObject({ scenarios: [], remaining: 10 });
  });
});
