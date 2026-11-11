import { describe, expect, it } from 'vitest';
import type { Action } from '@asl/engine';
import type { ScenarioDef } from '@asl/rules';
import { newSk1Game } from '../src';
import { hexesWhere } from '../src/scenarios/areas';
import { SK_S7 } from '../src/scenarios/skFree';

describe('S7 Prelude to Festung Brest', () => {
  // North was once the wrong way round. The card's diagram puts the unplayable hexrows A–G at
  // the east end, so the board is turned 180° and the two setup areas lie apart (they overlapped in R–Z before).
  it('turns board z so hexrow A faces east: Germans in H–R, Americans in Z–GG', () => {
    expect(SK_S7.compass).toEqual({ N: 'S', E: 'W', S: 'N', W: 'E' });
    const area = (side: string) => new Set((SK_S7.forces.find((f) => f.side === side)!.setup as { hexes: string[] }).hexes);
    const ge = area('ge');
    const am = area('am');
    for (const h of ['zH5', 'zR5']) expect(ge.has(h), h).toBe(true);
    for (const h of ['zS5', 'zZ5', 'zGG5']) expect(ge.has(h), h).toBe(false);
    for (const h of ['zZ5', 'zGG5']) expect(am.has(h), h).toBe(true);
    for (const h of ['zY5', 'zR5', 'zH5']) expect(am.has(h), h).toBe(false);
    expect([...ge].some((h) => am.has(h))).toBe(false);
  });

  it('the side setting up second may not set up in a hex the enemy already holds', () => {
    // A variant whose areas overlap, as S7's did when read without the turned board.
    const overlap: ScenarioDef = {
      ...SK_S7,
      forces: SK_S7.forces.map((f) => ({ ...f, setup: { kind: 'area' as const, description: f.setup.description ?? '', hexes: hexesWhere('z', { rows: ['H', 'GG'] }) } })),
    };
    const { engine, state: s0 } = newSk1Game(overlap, 's7');
    const ge = engine.legalActions(s0, 'ge').find((x) => x.type === 'setup.place')!;
    const held = 'zS5';
    const geUnit = Object.keys(ge['placements'] as Record<string, string>)[0]!;
    const state = engine.submit(s0, { ...ge, placements: { ...(ge['placements'] as Record<string, string>), [geUnit]: held } } as Action).state;

    const am = engine.legalActions(state, 'am').find((x) => x.type === 'setup.place')!;
    const placements = am['placements'] as Record<string, string>;
    expect(Object.values(placements)).not.toContain(held);
    expect(engine.validate(state, am)).toBeNull();
    const amUnit = Object.keys(placements)[0]!;
    expect(engine.validate(state, { ...am, placements: { ...placements, [amUnit]: 'zT5' } } as Action)).toBeNull();
    expect(engine.validate(state, { ...am, placements: { ...placements, [amUnit]: held } } as Action)).toBe('zS5 is held by the enemy');
  });
});
