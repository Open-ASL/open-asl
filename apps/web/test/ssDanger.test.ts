import { describe, expect, it } from 'vitest';
import type { HexId } from '@asl/engine';
import { makeEngine } from '../../../packages/rules/test/fixtures';
import { buildAttack, shotOdds } from '@asl/rules';
import { chanceColor, dangerColor, dangerSteps, harmChance, nextHeat, typicalMorale, type DangerCell } from '../src/superSpectator/danger';

/** Run the danger map to the end. */
function dangerMap(...args: Parameters<typeof dangerSteps>): Map<HexId, DangerCell> {
  const gen = dangerSteps(...args);
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}

describe("a commentator's danger map", () => {
  // A German 4-6-7 (4 FP, range 6) and an MMG (5 FP, range 12) in yK5; the Americans are the side under threat.
  const pieces = [
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yK5' },
    { id: 'mg', def: 'ge.MMG', side: 'ge', heldBy: 'g1' },
    { id: 'a1', def: 'am.747', side: 'am', hex: 'yA1' },
  ];

  it("puts the enemy's FP on each hex it can reach: doubled point blank, halved at long range, nothing beyond", () => {
    const { engine, state } = makeEngine({ pieces });
    const map = dangerMap(engine.env(state), engine, { side: 'am', mode: 'prep', sw: false, visible: null, secrets: true });
    const at = (hex: string) => map.get(hex as HexId)?.fp ?? 0;
    expect(at('yL5')).toBe(8);
    expect(at('yN5')).toBe(4);
    expect(at('yT5')).toBe(2);
    expect(at('yY5')).toBe(0);
    expect(map.get('yN5' as HexId)!.sources).toMatchObject([{ hex: 'yK5', fp: 4 }]);
    // Not its own hex: no unit fires into its own Location.
    expect(at('yK5')).toBe(0);
  });

  it('adds the Support Weapons when asked, and halves it all for Advancing Fire', () => {
    const { engine, state } = makeEngine({ pieces });
    const env = engine.env(state);
    const withSw = dangerMap(env, engine, { side: 'am', mode: 'prep', sw: true, visible: null, secrets: true });
    expect(withSw.get('yN5' as HexId)!.fp).toBe(9);
    // The MMG's 12 hexes (24 at long range) reach where the squad's 6 (12) do not.
    expect(withSw.get('yY5' as HexId)!.fp).toBeGreaterThan(0);
    const adv = dangerMap(env, engine, { side: 'am', mode: 'advancing', sw: false, visible: null, secrets: true });
    expect(adv.get('yN5' as HexId)!.fp).toBe(2);
  });

  it('counts only hexes the firers see, and no hidden firer', () => {
    const { engine, state } = makeEngine({ pieces, terrain: { yK6: { terrain: 'building-stone' } } });
    const env = engine.env(state);
    const map = dangerMap(env, engine, { side: 'am', mode: 'prep', sw: false, visible: null, secrets: true });
    expect(map.get('yK8' as HexId)).toBeUndefined();
    expect(map.get('yK6' as HexId)!.fp).toBe(8);
    expect(map.get('yK4' as HexId)!.fp).toBe(8);
    const hidden = dangerMap(env, engine, { side: 'am', mode: 'prep', sw: false, visible: new Set(['a1']), secrets: true });
    expect(hidden.size).toBe(0);
  });

  it('colours a hex by the IFT column its FP reaches, and nothing under 1 FP', () => {
    expect(dangerColor(0.5)).toBeNull();
    expect(dangerColor(1)).not.toBeNull();
    expect(dangerColor(7)).toBe(dangerColor(6));
    expect(dangerColor(8)).not.toBe(dangerColor(6));
  });
});

describe("the room's danger map setting", () => {
  it("shows one side's map at a time: the other side's button replaces it, its own hides it", () => {
    const ge = nextHeat(null, { side: 'ge' });
    expect(ge).toEqual({ side: 'ge', mode: 'prep', sw: true, measure: 'break' });
    const am = nextHeat({ ...ge!, mode: 'advancing', sw: false, measure: 'fp' }, { side: 'am' });
    expect(am).toEqual({ side: 'am', mode: 'advancing', sw: false, measure: 'fp' });
    expect(nextHeat(am, { side: 'am' })).toBeNull();
    expect(nextHeat(am, { side: null })).toBeNull();
  });

  it('changes the settings of the map shown, and shows none by a setting alone', () => {
    expect(nextHeat({ side: 'ge', mode: 'prep', sw: true, measure: 'break' }, { sw: false })).toEqual({ side: 'ge', mode: 'prep', sw: false, measure: 'break' });
    expect(nextHeat({ side: 'ge', mode: 'prep', sw: true, measure: 'break' }, { measure: 'fp' })?.measure).toBe('fp');
    expect(nextHeat(null, { mode: 'advancing' })).toBeNull();
  });
});

describe("the danger map's break chance", () => {
  const pieces = [
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yK5' },
    { id: 'a1', def: 'am.747', side: 'am', hex: 'yA1' },
  ];

  it("counts the hex's TEM: a stone building is safer than open ground at the same range", () => {
    const { engine, state } = makeEngine({ pieces, terrain: { yN4: { terrain: 'building-stone' } } });
    const map = dangerMap(engine.env(state), engine, { side: 'am', mode: 'prep', sw: false, visible: null, secrets: true });
    const open = map.get('yN5' as HexId)!;
    const stone = map.get('yN4' as HexId)!;
    expect(stone.fp).toBe(open.fp);
    expect(stone.sources[0]!.drm).toBe(open.sources[0]!.drm + 3);
    expect(stone.p).toBeLessThan(open.p);
  });

  it('counts the hindrance along the LOS', () => {
    const run = (terrain: Record<string, { terrain: string }>) => {
      const { engine, state } = makeEngine({ pieces, terrain });
      return dangerMap(engine.env(state), engine, { side: 'am', mode: 'prep', sw: false, visible: null, secrets: true }).get('yN5' as HexId)!;
    };
    const clear = run({});
    // Seen through the orchard in yM5: +1 hindrance.
    const hindered = run({ yM5: { terrain: 'orchard' } });
    expect(hindered.sources[0]!.drm).toBe(clear.sources[0]!.drm + 1);
    expect(hindered.p).toBeLessThan(clear.p);
  });

  it("is the shot check's chance for a lone squad standing there", () => {
    const { engine, state } = makeEngine({ pieces: [...pieces, { id: 'a2', def: 'am.747', side: 'am', hex: 'yN4' }], terrain: { yN4: { terrain: 'building-stone' } } });
    const env = engine.env(state);
    const map = dangerMap(env, engine, { side: 'am', mode: 'prep', sw: false, visible: null, secrets: true });
    const odds = shotOdds(env, buildAttack(env, { units: ['g1'], sw: [], target: 'yN4' }, 'prep', 'ge')).units['a2']!;
    expect(map.get('yN4' as HexId)!.p).toBeCloseTo(odds.broken + odds.reduced + odds.elim, 10);
  });

  it('combines the stacks as separate attacks', () => {
    const { engine, state } = makeEngine({ pieces: [...pieces, { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yK3' }] });
    const map = dangerMap(engine.env(state), engine, { side: 'am', mode: 'prep', sw: false, visible: null, secrets: true });
    const cell = map.get('yM4' as HexId)!;
    expect(cell.sources).toHaveLength(2);
    expect(cell.p).toBeCloseTo(1 - (1 - cell.sources[0]!.p) * (1 - cell.sources[1]!.p), 10);
  });

  it("works it out for the side's most common squad Morale, and colours by the chance", () => {
    const { engine, state } = makeEngine({ pieces });
    const env = engine.env(state);
    expect(typicalMorale(env, 'am')).toBe(7);
    expect(harmChance(env, 4, 0, 1, 7)).toBeGreaterThan(harmChance(env, 4, 3, 1, 7));
    expect(chanceColor(0.01)).toBeNull();
    expect(chanceColor(0.5)).not.toBe(chanceColor(0.05));
  });
});
