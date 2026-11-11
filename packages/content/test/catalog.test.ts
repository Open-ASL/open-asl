import { describe, expect, it } from 'vitest';
import { ALL_SCENARIOS, COMMERCIAL_SCENARIOS, PRODUCTS, compareNumbers, productById, scenarioName, scenarioNumber, searchScenarios } from '../src';

describe('scenario catalogue', () => {
  it('gives every scenario a known product and a unique id and number within it', () => {
    const seen = new Set<string>();
    for (const s of ALL_SCENARIOS) {
      expect(productById(s.product), `${s.id} product`).toBeDefined();
      const key = `${s.product}/${scenarioNumber(s)}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
    expect(new Set(ALL_SCENARIOS.map((s) => s.id)).size).toBe(ALL_SCENARIOS.length);
    expect(new Set(PRODUCTS.map((p) => p.id)).size).toBe(PRODUCTS.length);
  });

  it('orders card numbers naturally', () => {
    expect(['S10', 'S2', 'A1', 'S1', 'J45'].sort(compareNumbers)).toEqual(['A1', 'J45', 'S1', 'S2', 'S10']);
  });

  it('strips the card number from the title', () => {
    const s7 = ALL_SCENARIOS.find((s) => s.id === 'sk-s7')!;
    expect(scenarioNumber(s7)).toBe('S7');
    expect(scenarioName(s7)).toBe('Prelude to Festung Brest');
  });

  it('searches by number, place, designer, product and nation', () => {
    const ids = (q: Parameters<typeof searchScenarios>[0]) => searchScenarios(q).map((s) => s.id);
    const commercial = new Set(COMMERCIAL_SCENARIOS.map((s) => s.id));
    const free = (q: Parameters<typeof searchScenarios>[0]) => ids(q).filter((id) => !commercial.has(id));
    expect(ids({ text: 's7' })).toContain('sk-s7');
    expect(ids({ text: 'plouzane 1944' })).toEqual(['sk-s7']);
    expect(free({ text: 'closier' })).toEqual(['sk-s7']);
    expect(ids({ text: 'starter kit' })).toContain('sk-s7');
    expect(ids({ text: 'starter kit' })).not.toContain('demo-crossroads');
    expect(ids({ text: 'brest' })).toEqual(['sk-s7']);
    expect(ids({ text: 'stalingrad' })).toContain('sk-s18');
    expect(ids({ text: 'stalingrad' }).length).toBeGreaterThan(1);
    expect(free({ text: 'stalingrad', playableOnly: true })).toEqual(['sk-s18', 'sk-s35']);
    expect(ids({ text: 'german' })).toEqual(ALL_SCENARIOS.filter((s) => s.sides.some((x) => x.name === 'German')).map((s) => s.id));
    expect(ids({ text: 'german', product: 'demo' })).toEqual(['demo-crossroads', 'demo-gun-line', 'demo-armor', 'asl-testbed']);
    expect(ids({ text: 'nothing matches this' })).toEqual([]);
  });
});
