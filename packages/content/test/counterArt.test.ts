import { describe, expect, it } from 'vitest';
import { ALL_SCENARIOS, ASSETS, COUNTERS, SK1_NATIONALITY_CHART, SK2_NATIONALITY_CHART, SK4_NATIONALITY_CHART } from '../src';
import { SK1_TABLES } from '../src';

// Vite's `import.meta.glob` (Vitest runs on Vite); content has no Vite or Node types of its own.
declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

/** The committed art, by its path under apps/web/art (Vite lists the files; nothing is loaded). */
const ART = new Set(Object.keys(import.meta.glob('../../../apps/web/art/counters/*')).map((k) => k.replace('../../../apps/web/art/', '')));
const CHARTS = [SK1_NATIONALITY_CHART, SK2_NATIONALITY_CHART, SK4_NATIONALITY_CHART];

/** Every counter id named anywhere in a scenario: forces, SW, balance, special rules, reinforcement tables. */
function namedIn(value: unknown, out: Set<string>) {
  if (typeof value === 'string') {
    if (COUNTERS[value]) out.add(value);
  } else if (Array.isArray(value)) for (const v of value) namedIn(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) namedIn(v, out);
}

/**
 * Every counter a game can put on the board: the scenarios' own, then whatever they can become (Casualty
 * Reduction, ELR, Step Reduction, Deployment, a Commissar's or leader's replacement: the counters' own
 * `reducesTo` / `elrReplacement` / `stepTo` / `fullOf`, and the Nationality Charts' chains) and the leaders
 * Leader Creation makes for each army that can make one.
 */
function reachableCounters(): Set<string> {
  const ids = new Set<string>();
  for (const sc of ALL_SCENARIOS) namedIn(sc, ids);
  for (let grew = true; grew; ) {
    const before = ids.size;
    for (const id of [...ids]) {
      for (const v of Object.values(COUNTERS[id]!)) if (typeof v === 'string' && COUNTERS[v]) ids.add(v);
      for (const chart of CHARTS)
        for (const [k, chains] of Object.entries(chart)) {
          if (k === 'leaders') continue;
          for (const chain of chains) {
            const at = chain.indexOf(id);
            if (at >= 0) for (const next of chain.slice(at)) ids.add(next);
          }
        }
    }
    // Leader Creation (SK1 5.3; never for the Japanese, SK4 5.3): every row of the table, for each army with MMC.
    for (const nat of new Set([...ids].map((id) => COUNTERS[id]!).filter((d) => (d.kind === 'squad' || d.kind === 'hs') && d.nationality !== 'ja').map((d) => d.nationality)))
      for (let dr = -3; dr <= 6; dr++) {
        const leader = SK1_TABLES.leaderCreation(nat, 7, dr);
        if (leader) ids.add(leader);
      }
    grew = ids.size > before;
  }
  return ids;
}

describe('Counter art', () => {
  // A unit drawn without its own counter art reads as a counter that does not exist. Every unit, weapon and
  // vehicle comes from the VASL counter set, so each one a game can reach must have its picture.
  it('every counter a game can put on the board has its art, front and back, in apps/web/art', () => {
    const missing: string[] = [];
    for (const id of [...reachableCounters()].sort()) {
      const d = COUNTERS[id]!;
      const a = ASSETS.counters[id];
      if (!a) {
        missing.push(`${id}: no art in the asset manifest`);
        continue;
      }
      for (const path of [a.front, a.back].filter((x): x is string => !!x)) if (!ART.has(path)) missing.push(`${id}: ${path} is missing`);
      // A unit that can break is drawn by its back then (Japanese counters have none: they Step Reduce, SK4 8.1).
      const breaks = (d.kind === 'squad' || d.kind === 'hs' || d.kind === 'crew' || d.kind === 'leader') && !('noBrokenSide' in d && d.noBrokenSide);
      if (!a.back && breaks) missing.push(`${id}: no broken side`);
    }
    expect(missing).toEqual([]);
  });

  it('Leader Creation makes only leaders the army has (never a counter made up from the pattern)', () => {
    for (const nat of ['ge', 'am', 'ru', 'br', 'it', 'al'])
      for (let dr = -3; dr <= 6; dr++) {
        const leader = SK1_TABLES.leaderCreation(nat, 7, dr);
        if (leader) expect(COUNTERS[leader], leader).toBeDefined();
      }
    expect(() => SK1_TABLES.leaderCreation('ja', 7, 0)).toThrow(/no L81 counter/);
  });
});
