import { describe, expect, it } from 'vitest';
import type { MatchDoc } from '@asl/platform';
import { matchIdle } from '../src/lobby/idle';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const at = (iso: string) => ({ toDate: () => new Date(iso) });
const match = (over: Partial<MatchDoc>): MatchDoc => ({
  mode: 'online', status: 'active', pace: 'live', updatedAt: at('2026-11-11T11:55:00Z'),
  deadline: { at: at('2026-11-11T12:05:00Z'), class: 'turn', side: 'ge', seq: 4 },
  ...over,
} as MatchDoc);

describe('matchIdle', () => {
  it('a running clock is a live table', () => {
    expect(matchIdle(match({}), NOW)).toBe(false);
  });
  it('a clock that ran out with nobody moving or claiming is idle', () => {
    expect(matchIdle(match({ deadline: { at: at('2026-11-06T20:03:52Z'), class: 'turn', side: 'am', seq: 0 } }), NOW)).toBe(true);
  });
  it('a match without a clock is idle once a day passes without an action', () => {
    expect(matchIdle(match({ deadline: null, updatedAt: at('2026-11-11T02:00:00Z') }), NOW)).toBe(false);
    expect(matchIdle(match({ deadline: null, updatedAt: at('2026-11-09T12:00:00Z') }), NOW)).toBe(true);
  });
  it('open seats, finished, hotseat and computer games are never idle', () => {
    const lapsed = { at: at('2026-11-01T00:00:00Z'), class: 'turn' as const, side: 'ge', seq: 0 };
    expect(matchIdle(match({ status: 'open', deadline: lapsed }), NOW)).toBe(false);
    expect(matchIdle(match({ status: 'complete', deadline: lapsed }), NOW)).toBe(false);
    expect(matchIdle(match({ mode: 'hotseat', deadline: lapsed }), NOW)).toBe(false);
    expect(matchIdle(match({ mode: 'computer', deadline: lapsed }), NOW)).toBe(false);
  });
});
