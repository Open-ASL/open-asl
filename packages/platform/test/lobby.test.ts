import { describe, expect, it } from 'vitest';
import { BOOKING_LEAD_MS, RULESETS, balanceLabel, bookableStarts, hasBookableStart, defaultScenarioDuration, lobbyChannelId, reachedOfficialProgress, rulesetOfLobbyChannel, rulesetsFor } from '../src';

describe('lobby policies', () => {
  it('opens Full ASL only behind the development gate', () => {
    expect(RULESETS.find((r) => r.id === 'full-asl')!.enabled).toBe(false);
    expect(rulesetsFor(false)).toBe(RULESETS);
    expect(rulesetsFor(true).map((r) => [r.id, r.enabled])).toEqual([['starter-kit', true], ['full-asl', true]]);
  });

  it('gives each ruleset its own lobby chat channel', () => {
    expect(lobbyChannelId('full-asl')).toBe('lobby_full-asl');
    expect(rulesetOfLobbyChannel('lobby_starter-kit')).toBe('starter-kit');
    expect(rulesetOfLobbyChannel('lobby_full-asl')).toBe('full-asl');
    expect(rulesetOfLobbyChannel('lobby_other')).toBeNull();
    expect(rulesetOfLobbyChannel('match123')).toBeNull();
  });

  it('rounds and clamps scenario duration estimates', () => {
    expect(defaultScenarioDuration(5, 24)).toBe(240);
    expect(defaultScenarioDuration(1, 0)).toBe(120);
    expect(defaultScenarioDuration(20, 200)).toBe(480);
  });

  it('withholds balance until ten ranked results', () => {
    expect(balanceLabel({ rankedResults: 9, draws: 0, sideWins: { ge: 9 } })).toBeNull();
    expect(balanceLabel({ rankedResults: 10, draws: 0, sideWins: { ge: 5, am: 5 } })).toBe('Balanced');
    expect(balanceLabel({ rankedResults: 10, draws: 0, sideWins: { ge: 6, am: 4 } })).toBe('Leans ge');
    expect(balanceLabel({ rankedResults: 10, draws: 0, sideWins: { ge: 7, am: 3 } })).toBe('ge favored');
  });

  it('requires half of the scheduled player-turns for early endings', () => {
    const scenario = { turns: 5, halfFinalTurn: false, firstSide: 'ge' };
    expect(reachedOfficialProgress({ turn: 3, attacker: 'ge' }, scenario)).toBe(false);
    expect(reachedOfficialProgress({ turn: 3, attacker: 'am' }, scenario)).toBe(true);
    expect(reachedOfficialProgress({ turn: 1, attacker: 'ge' }, scenario)).toBe(false);
  });

  it('offers a post\'s half-hour starts at least the booking lead ahead, and none once the last is too close', () => {
    const t = (hhmm: string) => Date.parse(`2026-11-06T${hhmm}:00Z`);
    // A window of starts from 10:00 to 12:00, seen at 09:00: every half hour.
    expect(bookableStarts(t('10:00'), t('12:00'), t('09:00')).map((ms) => new Date(ms).toISOString().slice(11, 16))).toEqual(['10:00', '10:30', '11:00', '11:30', '12:00']);
    // At 11:20 the next start is 11:35 at the earliest, so 12:00 is the only one left.
    expect(bookableStarts(t('10:00'), t('12:00'), t('11:20')).map((ms) => new Date(ms).toISOString().slice(11, 16))).toEqual(['12:00']);
    // At 11:50 the last start (12:00) is under the lead: the window is over, 10 minutes before it ends.
    expect(BOOKING_LEAD_MS).toBe(15 * 60_000);
    expect(bookableStarts(t('10:00'), t('12:00'), t('11:50'))).toEqual([]);
    expect(hasBookableStart([{ start: t('10:00'), end: t('12:00') }], t('11:50'))).toBe(false);
    // Another window later keeps the post open.
    expect(hasBookableStart([{ start: t('10:00'), end: t('12:00') }, { start: t('18:00'), end: t('19:00') }], t('11:50'))).toBe(true);
    expect(hasBookableStart([], t('11:50'))).toBe(false);
  });
});
