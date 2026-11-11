import { describe, expect, it } from 'vitest';
import { T, T2, T3, TAG_LIFECYCLE } from '@asl/rules';
import { ALL_SCENARIOS, PLAYABLE_SCENARIOS, applyBalance, isPlayable, mulberry, newSk1Game, playRandom, scenarioById, sk1Ruleset, staticsFor, weightedPicker } from '../src';
import { skLocationViolation, tankWeights, turnBoundaryCheck } from './randomPlayChecks';

describe('tag lifecycles', () => {
  it('lists every declared tag (T, T2, T3) in TAG_LIFECYCLE', () => {
    const declared = [...Object.values(T), ...Object.values(T2), ...Object.values(T3)];
    expect(declared.filter((k) => !TAG_LIFECYCLE[k])).toEqual([]);
  });
});

describe('catalogued scenarios', () => {
  it('marks every coming-soon card with what it needs and no forces', () => {
    for (const s of ALL_SCENARIOS.filter((x) => !isPlayable(x))) {
      expect(s.needs?.length, s.id).toBeGreaterThan(0);
      expect(s.forces, s.id).toEqual([]);
      expect(s.place, s.id).toBeTruthy();
    }
    expect(PLAYABLE_SCENARIOS.map((s) => s.id)).toEqual(expect.arrayContaining(['sk-s7', 'sk-s8', 'sk-s17', 'sk-s18', 'sk-s19', 'sk-s28', 'sk-s29', 'sk-s30', 'sk-s31', 'sk-s32', 'sk-s33', 'sk-s34', 'sk-s35', 'sk-s36', 'lma-10', 'lma-8', 'lma-6', 'lma-2', 'lma-9', 'lma-5', 'lma-7', 'lma-4']));
  });

  it('fields only counters its game loads', () => {
    for (const s of PLAYABLE_SCENARIOS) {
      const counters = staticsFor(s, { los: 'grid' }).counters;
      for (const f of s.forces) for (const u of f.units) for (const id of [u.def, ...(u.withSw ?? [])]) expect(counters[id], `${s.id}: ${id}`).toBeDefined();
    }
  });

  it('treats off-board hexes as Open Ground (SK4 3.x) except where an SSR says off-board terrain exists', () => {
    for (const s of PLAYABLE_SCENARIOS) {
      const ssr = s.ssr.some((r) => r.module === 'offboard-terrain');
      const off = staticsFor(s, { los: 'grid' }).map.offboard('N,E,S,W');
      expect(off.length, s.id).toBeGreaterThan(0);
      if (ssr) expect(off.some((h) => h.terrain !== 'open'), s.id).toBe(true);
      else expect(off.filter((h) => h.terrain !== 'open').map((h) => `${h.id}:${h.terrain}`), s.id).toEqual([]);
    }
  });

  it('demo-armor: weighted random play between the tank forces produces shots, Bounding First Fire, To Kill rolls and wrecks', () => {
    const scenario = scenarioById('demo-armor')!;
    let wrecks = 0;
    let toKill = 0;
    let shots = 0;
    let bff = 0;
    // The tanks start in range of each other: often skip the PFPh so they move, and fire on the move.
    const weigh = weightedPicker((a, legal, state, engine) => (state.phase === 'PFPh' && a.type === 'endPhase' ? 20 : tankWeights(a, legal, state, engine)));
    for (const seed of [1, 2]) {
      const check = turnBoundaryCheck(`demo-armor seed ${seed}`);
      const { state, steps } = playRandom(scenario, `armor-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 8000,
        pick: weigh,
        onStep: (s, events, a) => {
          if (a.type === 'vmove.bff' || a.type === 'vmove.bffMg') bff++;
          for (const ev of events) {
            if (ev.type === 'sk3.toKill') toKill++;
            if (ev.type === 'sk2.ordnance.shot') shots++;
          }
          check(s);
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
      wrecks += Object.values(state.pieces).filter((p) => p.tags['wreck']).length;
    }
    expect(shots).toBeGreaterThan(10);
    expect(bff).toBeGreaterThan(0);
    expect(toKill).toBeGreaterThan(0);
    expect(wrecks).toBeGreaterThan(0);
  }, 60_000);

  for (const s of PLAYABLE_SCENARIOS) {
    it(`${s.id}: builds, applies every balance option, and plays through at random`, () => {
      expect(() => sk1Ruleset(s)).not.toThrow();
      for (const b of s.balance ?? []) {
        if (b.unavailable) expect(() => applyBalance(s, [b.side]), `${s.id} unavailable balance ${b.side}`).toThrow();
        else expect(() => newSk1Game(applyBalance(s, [b.side]), 'x', { los: 'grid' }), `${s.id} balance ${b.side}`).not.toThrow();
      }
      const check = turnBoundaryCheck(s.id);
      const { state, steps } = playRandom(s, 'seed-7', { rand: mulberry(7), maxSteps: 6000, onStep: check });
      expect(state.result, `${s.id} reached no result in ${steps} steps`).not.toBeNull();
      if (s.ruleset !== 'full-asl') expect(skLocationViolation(state)).toBeNull();
      expect(s.sides.map((x) => x.side)).toContain(state.result!.winner ?? s.sides[0]!.side);
    });
  }
});
