import { describe, expect, it } from 'vitest';
import { COUNTERS, scenarioById } from '@asl/content';
import { counterNotes } from '../src/game/counterNotes';
import { describeVictory, monthConditions, setupRule } from '../src/panels/Briefing';

describe('victory conditions in words', () => {
  it('names buildings by the hexes the card uses, never by engine ids', () => {
    const s29 = scenarioById('sk-s29')!;
    const text = describeVictory(s29.victory[0]!, s29);
    expect(text).toBe('The Americans win at game end if they control all of the buildings at P1 (O3/P1/P2), and they control at least 5 of 9 buildings.');
    expect(text).not.toMatch(/[a-z]-B\d+/);
  });

  it('keeps hex lists as hex names', () => {
    const demo = scenarioById('demo-crossroads')!;
    expect(describeVictory(demo.victory[0]!, demo)).toBe('The Americans win at game end if they control all of P5, P6.');
  });
});

describe('immediate control victories', () => {
  it('says so, naming the building as the card does', () => {
    const s31 = scenarioById('sk-s31')!;
    expect(describeVictory(s31.victory[0]!, s31)).toBe('The Italians win immediately if they control all of the buildings at EE7.');
  });
});

describe('setup in words', () => {
  it('words an entry along every edge as any edge', () => {
    const s29 = scenarioById('sk-s29')!;
    const am = s29.forces.find((f) => f.id === 'am')!;
    expect(setupRule(am, s29)).toBe('enter on Turn 1 along the north edge');
    expect(setupRule({ ...am, setup: { kind: 'enter', turn: 1, edge: 'N,E,S,W' } }, s29)).toBe('Enter on Turn 1 along any edge');
  });
});

describe('counter notes', () => {
  it('Backblast is a BAZ or PSK note only: a PIAT fires from inside a building with no penalty (SK4 4.4.3)', () => {
    for (const id of ['am.BAZ43', 'ge.PSK']) expect(counterNotes(COUNTERS[id]!)).toContain('Backblast from inside a building: +2 To Hit or a 1 FP attack on the hex');
    const piat = counterNotes(COUNTERS['br.PIAT']!);
    expect(piat).toContain('No Backblast: fires from inside a building with no penalty');
    expect(piat.some((n) => /^Backblast/.test(n))).toBe(false);
  });
});

describe("the month's conditions", () => {
  // Grain is in season June–September and Open Ground otherwise (SK1 terrain).
  it('says what the month does to grain', () => {
    const s29 = scenarioById('sk-s29')!;
    expect(s29.month).toBe(8);
    expect(monthConditions(s29)).toBe('grain in season: Hindrance, 1½ MF');
    expect(monthConditions({ ...s29, month: 10 })).toBe('grain is Open Ground');
    expect(monthConditions({ ...s29, month: 6 })).toBe('grain in season: Hindrance, 1½ MF');
    expect(monthConditions({ ...s29, month: 5 })).toBe('grain is Open Ground');
  });

  it('says nothing on boards without grain, or where an SSR makes the grain another terrain', () => {
    const s29 = scenarioById('sk-s29')!;
    expect(monthConditions({ ...s29, boards: [{ board: 'z', position: '0,0' }] })).toBeNull();
    expect(monthConditions(scenarioById('sk-s33')!)).toBeNull();
  });
});
