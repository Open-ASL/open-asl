import { describe, expect, it } from 'vitest';
import { ALL_SCENARIOS, SCENARIO_CATALOG } from '../src';

describe('scenario atlas catalogue', () => {
  it('gives every historical scenario one reviewed pin', () => {
    const historical = ALL_SCENARIOS.filter((scenario) => scenario.place && !scenario.devOnly);
    expect(SCENARIO_CATALOG).toHaveLength(historical.length);
    expect(new Set(SCENARIO_CATALOG.map((scenario) => scenario.id)).size).toBe(historical.length);
  });

  it('builds useful search facets', () => {
    const plouzane = SCENARIO_CATALOG.find((scenario) => scenario.id === 'sk-s7')!;
    expect(plouzane.place).toContain('Plouzane');
    expect(plouzane.nations).toEqual(expect.arrayContaining(['am', 'ge']));
    expect(plouzane.unitCount).toBeGreaterThan(0);
    expect(plouzane.dateISO).toBe('1944-08-26');
  });
});
