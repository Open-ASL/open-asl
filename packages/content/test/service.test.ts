import { describe, expect, it } from 'vitest';
import { ALL_SCENARIOS, armyOf, isPlayable, scenarioYear, serviceCatalogue } from '../src';

const ARMIES = ['american', 'german', 'russian', 'british', 'canadian', 'free-french', 'italian', 'greek', 'dutch', 'japanese'];
// Scenarios players can play: the decorations count every one of them, so each needs its place in the war.
const playable = ALL_SCENARIOS.filter((s) => isPlayable(s) && !s.devOnly && s.product !== 'demo');

describe('the decorations’ view of the scenarios', () => {
  it.each(playable.map((s) => [s.id, s] as const))('%s has a theatre, a year and an army for each side', (_id, s) => {
    expect(s.service, 'service tags').toBeDefined();
    const year = scenarioYear(s);
    expect(year).toBeGreaterThanOrEqual(1939);
    expect(year).toBeLessThanOrEqual(1945);
    for (const sd of s.sides) expect(ARMIES).toContain(armyOf(s, sd.side));
    // A scenario's two sides are never the same army.
    expect(new Set(s.sides.map((sd) => armyOf(s, sd.side))).size).toBe(s.sides.length);
  });

  it('a US campaign belongs to its theatre: Pacific campaigns only in the Pacific', () => {
    const pacific = new Set(['guadalcanal', 'india-burma', 'western-pacific', 'luzon']);
    for (const s of serviceCatalogue()) if (s.campaign) expect(pacific.has(s.campaign), s.id).toBe(s.theatre === 'pacific');
  });

  it('names the sides the computer opponent plays', () => {
    const [first] = serviceCatalogue();
    if (!first) return;
    const withBot = serviceCatalogue({ [first.id]: [first.sides[0]!.side] });
    expect(withBot[0]!.botSides).toEqual([first.sides[0]!.side]);
  });
});
