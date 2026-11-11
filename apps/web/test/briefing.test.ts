import { describe, expect, it } from 'vitest';
import { scenarioById } from '@asl/content';
import { describeVictory, setupRule } from '../src/panels/Briefing';

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
    const am = scenarioById('sk-s29')!.forces.find((f) => f.id === 'am')!;
    expect(setupRule(am)).toBe('enter on Turn 1 along the north edge');
    expect(setupRule({ ...am, setup: { kind: 'enter', turn: 1, edge: 'N,E,S,W' } })).toBe('Enter on Turn 1 along any edge');
  });
});
