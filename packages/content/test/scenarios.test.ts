import { describe, expect, it } from 'vitest';
import { STRAY_HIT_EVENT, T, T2, T3, TAG_LIFECYCLE, moveState, overstackEntryMf, pieceOf, sideToward, statics, vehiclesAt } from '@asl/rules';
import type { Action, Engine, GameState } from '@asl/engine';
import { ALL_SCENARIOS, PLAYABLE_SCENARIOS, applyBalance, isPlayable, mulberry, newSk1Game, playRandom, scenarioById, sk1Ruleset, staticsFor, weightedPicker } from '../src';
import { skLocationViolation, tankWeights, turnBoundaryCheck } from './randomPlayChecks';

describe('tag lifecycles', () => {
  it('lists every declared tag (T, T2, T3) in TAG_LIFECYCLE', () => {
    const declared = [...Object.values(T), ...Object.values(T2), ...Object.values(T3)];
    expect(declared.filter((k) => !TAG_LIFECYCLE[k])).toEqual([]);
  });
});

/**
 * Whether `a` overstacks a Location (full ASL A5.1, A5.2): an Infantry step, advance or rout step that pays the A5.11 MF,
 * or a vehicle step into a hex holding a friendly vehicle. The runs of other features weigh these at zero, so that they
 * play as they did under the stacking cap; the stacking test bed has its own run.
 */
function overstacks(engine: Engine, state: GameState, a: Action): boolean {
  const env = engine.env(state);
  const to = typeof a['to'] === 'string' ? (a['to'] as string) : null;
  if (!to) return false;
  if (a.type === 'move.step') {
    const ms = moveState(env);
    if (!ms) return false;
    if (ms.vehicle) return vehiclesAt(env, to, state.attacker, true).some((v) => !ms.units.includes(v.id));
    return overstackEntryMf(env, to, ms.units, state.attacker) > 0;
  }
  if (a.type === 'advance') return overstackEntryMf(env, to, a['units'] as string[], state.attacker) > 0;
  if (a.type === 'rout.step') return overstackEntryMf(env, to, [a['unit'] as string], pieceOf(env, a['unit'] as string).side) > 0;
  return false;
}

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

  it('asl-testbed-fire: weighted random play kindles, spreads and fights fires, and every Player Turn boundary is clean', () => {
    const scenario = scenarioById('asl-testbed-fire')!;
    const counts: Record<string, number> = {};
    const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
    // Kindle whenever offered, fight a Flame whenever offered, otherwise mostly end phases so the AFPh ends come round.
    const weigh = weightedPicker((a) => (a.type === 'fire.kindle' ? 40 : a.type === 'fire.extinguish' ? 20 : a.type === 'endPhase' ? 6 : a.type === 'blaze.break' ? 5 : 1));
    for (const seed of [1, 2, 3]) {
      const check = turnBoundaryCheck(`asl-testbed-fire seed ${seed}`);
      const { state, steps } = playRandom(scenario, `fire-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 8000,
        pick: weigh,
        onStep: (st, events, a) => {
          bump(a.type);
          for (const ev of events) if (ev.type.startsWith('asl.fire') || ev.type.startsWith('asl.rubble') || ev.type.startsWith('asl.wind')) bump(ev.type);
          check(st, events);
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
    }
    expect(counts['fire.kindle'] ?? 0).toBeGreaterThan(0);
    expect(counts['asl.fire.blazeCheck'] ?? 0).toBeGreaterThan(0);
    expect(counts['asl.fire.spread'] ?? 0).toBeGreaterThan(0);
    expect(counts['asl.fire.blaze'] ?? 0).toBeGreaterThan(0);
    expect(counts['asl.wind.changeDr'] ?? 0).toBeGreaterThan(0);
  }, 120_000);

  it('asl-testbed: weighted random play places the fortification counters, and every Player Turn boundary is clean', () => {
    const scenario = scenarioById('asl-testbed')!;
    const counts: Record<string, number> = {};
    const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
    // Place the counters whenever the setup offers it, otherwise play as usual.
    const weigh = weightedPicker((a) => (a.type === 'fort.place' ? 400 : a.type === 'endPhase' ? 4 : 1));
    for (const seed of [1, 2]) {
      const check = turnBoundaryCheck(`asl-testbed forts seed ${seed}`);
      let placed = false;
      const { state, steps } = playRandom(scenario, `forts-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 8000,
        pick: weigh,
        onStep: (st, events, a) => {
          bump(a.type);
          for (const ev of events) if (ev.type.startsWith('asl.fort')) bump(ev.type);
          check(st, events);
          // Once this game's counters are placed they stay where they were put, whatever the turn.
          if (a.type === 'fort.place') placed = true;
          const forts = (st.ext['asl.fortifications'] as { counters: unknown[] } | undefined)?.counters ?? [];
          if (placed) expect(forts.length).toBeGreaterThan(0);
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
    }
    expect(counts['fort.place'] ?? 0).toBe(2);
    // The two setup placements, plus any foxhole dug in play (B27.11).
    expect(counts['asl.fort.placed'] ?? 0).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('asl-testbed: weighted random play entrenches, moves in and out of foxholes and routs beneath them, and every Player Turn boundary is clean', () => {
    const scenario = scenarioById('asl-testbed')!;
    const counts: Record<string, number> = {};
    const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
    // Dig whenever the PFPh offers it, go in and out of entrenchments and beneath them in the RtPh, else play as usual.
    const weigh = weightedPicker((a) => (a.type === 'fort.place' ? 400 : a.type === 'entrench.attempt' ? 80 : a.type === 'move.entrenchment' ? 30 : a['beneath'] !== undefined ? 30 : a.type === 'endPhase' ? 4 : 1));
    for (const seed of [11, 12, 13]) {
      const check = turnBoundaryCheck(`asl-testbed entrench seed ${seed}`);
      const { state, steps } = playRandom(scenario, `entrench-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 9000,
        pick: weigh,
        onStep: (st, events, a) => {
          bump(a.type);
          if (a['beneath'] !== undefined) bump(`${a.type}:beneath`);
          for (const ev of events) {
            if (ev.type === 'asl.entrench.attempt') bump((ev.payload as { success: boolean }).success ? 'dug' : 'failed');
            if (ev.type === 'asl.entrench.move') bump(`move:${(ev.payload as { phase: string }).phase}`);
            if (ev.type === 'asl.fort.grown') bump('grown');
          }
          check(st, events);
          // Every unit beneath an entrenchment stands in a hex that holds one, and a Labor counter names the Location its unit is in.
          const forts = (st.ext['asl.fortifications'] as { counters: { kind: string; hex: string }[] } | undefined)?.counters ?? [];
          for (const p of Object.values(st.pieces)) {
            if (p.loc.kind !== 'hex') continue;
            if (p.loc.pos?.ent) expect(forts.some((c) => c.hex === (p.loc as { hex: string }).hex && (c.kind === 'foxhole' || c.kind === 'trench' || c.kind === 'ditch')), `${p.id} beneath nothing in ${p.loc.hex}`).toBe(true);
            const labor = typeof p.tags['labor'] === 'string' ? p.tags['labor'] : null;
            if (labor) expect(labor.replace(/^[a-z]+:/, '').replace(/@.*$/, ''), `${p.id} carries Labor away`).toBe(p.loc.hex);
          }
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
    }
    expect(counts['entrench.attempt'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts['dug'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts['move.entrenchment'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect((counts['move:MPh'] ?? 0) + (counts['move:RtPh'] ?? 0) + (counts['move:APh'] ?? 0), JSON.stringify(counts)).toBeGreaterThan(0);
  }, 120_000);

  it('asl-testbed: weighted random play crosses Wire, makes Wire Exit drs in the MPh and RtPh, and every Player Turn boundary is clean', () => {
    const scenario = scenarioById('asl-testbed')!;
    const counts: Record<string, number> = {};
    const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
    // Head for the Wire hexes and roll whenever it is offered, else play as usual.
    const wireHexes = new Set<string>();
    const weigh = weightedPicker((a, _legal, state, engine) => {
      if (a.type === 'fort.place') return 400;
      // The movement options this run does not exercise (Double Time, Assault Movement, Dash, Minimum Move, Infantry
      // OVR; they have their own run on the movement test bed): never picked, so the run plays as it did without them.
      if (a.type === 'move.doubleTime' || a.type === 'move.dash' || (a.type === 'move.start' && (a['doubleTime'] || a['assault']))) return 0;
      if (a.type === 'move.step' && (a['ovr'] || (() => {
        const env = engine.env(state);
        const ms = moveState(env);
        const to = String(a['to']);
        const enemy = Object.values(state.pieces).some((p) => p.side !== state.attacker && p.loc.kind === 'hex' && p.loc.hex === to);
        return enemy || (!!ms && ms.units.some((u) => env.query('move.stepCost', { ms, to }, 1) > (ms.allowance[u] ?? 0) - (ms.spent[u] ?? 0)));
      })())) return 0;
      if (a.type === 'move.wire') return 40;
      if (a.type === 'clearance.declare') return 40;
      if (a.type === 'rout.wire') return 20;
      if (a.type === 'wire.drop' || a.type === 'wire.keep') return 5;
      if (a.type === 'move.start') return 20;
      if (a.type === 'move.step') {
        const to = String(a['to']);
        if (wireHexes.has(to)) return 80;
        if (to.includes(':')) return 1;
        const env = engine.env(state);
        const from = moveState(env)?.hex;
        const map = statics(env).map;
        const near = (h: string) => Math.min(99, ...[...wireHexes].map((w) => map.distance(h, w)));
        return from && map.hex(to) && near(to) < near(from) ? 20 : 1;
      }
      if (a.type === 'advance' && wireHexes.has(String(a['to']))) return 30;
      if (a.type === 'endPhase') return state.phase === 'MPh' ? 1 : 4;
      return 1;
    });
    // The Wire where the Germans meet it: the test bed's own placement puts it at P9 (open) and O4 (hidden).
    const toFront = ['uP9', 'uO4'];
    const pick: typeof weigh = (legal, state, engine, rand) => {
      const a = weigh(legal, state, engine, rand);
      const bad = engine.validate(state, a);
      if (bad) throw new Error(`listed but refused: ${JSON.stringify(a)}: ${bad}`);
      if (a.type !== 'fort.place') return a;
      let i = 0;
      const counters = (a['counters'] as { kind: string; hex: string }[]).map((c) => (c.kind === 'wire' && i < toFront.length ? { ...c, hex: toFront[i++]! } : c));
      const moved = { ...a, counters };
      return engine.validate(state, moved as never) ? a : (moved as typeof a);
    };
    for (const seed of [21, 22, 23]) {
      const check = turnBoundaryCheck(`asl-testbed wire seed ${seed}`);
      const { state, steps } = playRandom(scenario, `wire-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 9000,
        pick,
        onStep: (st, events, a) => {
          bump(a.type);
          const forts = (st.ext['asl.fortifications'] as { counters: { kind: string; hex: string }[] } | undefined)?.counters ?? [];
          for (const c of forts) if (c.kind === 'wire') wireHexes.add(c.hex);
          for (const ev of events) {
            if (ev.type === 'asl.wire.exit') for (const u of (ev.payload as { units: { outcome: string }[]; phase: string }).units) bump(`${(ev.payload as { phase: string }).phase}:${u.outcome}`);
            if (ev.type === 'asl.clearance.dr') bump((ev.payload as { abandoned?: true }).abandoned ? 'task:abandoned' : 'task:rolled');
          }
          check(st, events);
          // Every unit on or beneath Wire stands in a hex that holds Wire (B26.4: the position goes with the counter).
          for (const p of Object.values(st.pieces)) {
            if (p.loc.kind !== 'hex' || !p.loc.pos?.wire) continue;
            expect(forts.some((c) => c.hex === (p.loc as { hex: string }).hex && c.kind === 'wire'), `${p.id} on Wire that is not there in ${p.loc.hex}`).toBe(true);
          }
          // A Wire Exit dr is pending only while its owner decides whether to leave PP on top (B26.4).
          if (st.decisions[st.decisions.length - 1]?.kind !== 'wireDrop') expect(st.ext['asl.wire'], 'a Wire Exit dr left pending').toBeUndefined();
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
    }
    expect(counts['MPh:beneath'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts['MPh:hung'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect((counts['RtPh:beneath'] ?? 0) + (counts['RtPh:hung'] ?? 0), JSON.stringify(counts)).toBeGreaterThan(0);
  }, 120_000);

  it('asl-testbed-mines: weighted random play walks, advances and routs into minefields, clears them and uses their Trail Breaks, and every Player Turn boundary is clean', () => {
    const scenario = scenarioById('asl-testbed-mines')!;
    const counts: Record<string, number> = {};
    const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
    // Head for the minefield hexes (the test bed's own placement: P10 recorded, N9 Known with a TB, N10 the Dummy) and
    // take every minefield option offered, else play as usual.
    const mineHexes = new Set<string>();
    const weigh = weightedPicker((a, _legal, state, engine) => {
      if (a.type === 'fort.place') return 400;
      if (a.type === 'clearance.declare') return 60;
      if (a.type === 'move.removeMines') return 60;
      if (a.type === 'rout.endHere') return 10;
      if (a.type === 'move.start' || a.type === 'vmove.start') return 20;
      if (a.type === 'move.step') {
        const to = String(a['to']);
        if (mineHexes.has(to)) return a['mines'] ? 60 : 80;
        if (to.includes(':')) return 1;
        const env = engine.env(state);
        const from = moveState(env)?.hex;
        const map = statics(env).map;
        const near = (h: string) => Math.min(99, ...[...mineHexes].map((w) => map.distance(h, w)));
        return from && map.hex(to) && near(to) < near(from) ? 20 : 1;
      }
      if (a.type === 'advance' && mineHexes.has(String(a['to']))) return 30;
      if (a.type === 'endPhase') return state.phase === 'MPh' ? 1 : 4;
      return 1;
    });
    for (const seed of [31, 32, 33]) {
      const check = turnBoundaryCheck(`asl-testbed-mines seed ${seed}`);
      const { state, steps } = playRandom(scenario, `mines-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 9000,
        pick: (legal, st, engine, rand) => {
          const a = weigh(legal, st, engine, rand);
          const bad = engine.validate(st, a);
          if (bad) throw new Error(`listed but refused: ${JSON.stringify(a)}: ${bad}`);
          if (a.type !== 'fort.place') return a;
          // Minefields where the Germans meet them: recorded ones in P10 and O10, Known ones in N9 and M10, a Dummy in N10.
          const front = { hidden: ['uP10', 'uO10'], known: ['uN9', 'uM10'], dummy: ['uN10'] };
          const counters = (a['counters'] as { kind: string; hex: string; mines?: { known?: true; dummy?: true } }[]).map((c) => {
            if (c.kind !== 'mines') return c;
            const list = c.mines?.dummy ? front.dummy : c.mines?.known ? front.known : front.hidden;
            const hex = list.shift();
            return hex ? { ...c, hex } : c;
          });
          const moved = { ...a, counters };
          return engine.validate(st, moved as never) ? a : (moved as typeof a);
        },
        onStep: (st, events, a) => {
          bump(a.type);
          if (a.type === 'move.step' && a['mines']) bump(`step:${String(a['mines'])}`);
          for (const c of (st.ext['asl.fortifications'] as { counters: { kind: string; hex: string }[] } | undefined)?.counters ?? []) if (c.kind === 'mines') mineHexes.add(c.hex);
          for (const ev of events) {
            if (ev.type === 'asl.mines.attack') bump(`attack:${(ev.payload as { by: string }).by}:${(ev.payload as { way: string }).way}`);
            if (ev.type === 'asl.mines.vehicle') bump(`vehicle:${(ev.payload as { kind: string }).kind}`);
            if (ev.type === 'asl.clearance.dr' && (ev.payload as { task: { kind: string } }).task.kind === 'mines') bump('task:mines');
            if (ev.type === 'asl.boobyTrap') bump('boobyTrap');
          }
          check(st, events);
          // A partial TB lies only in a minefield hex, and its units are all there (B24.74).
          const partial = (st.ext['asl.mines.partial'] as Record<string, { units?: string[] }[]> | undefined) ?? {};
          for (const [hex, tbs] of Object.entries(partial))
            for (const t of tbs) for (const u of t.units ?? []) expect((st.pieces[u]?.loc as { hex?: string } | undefined)?.hex, `${u} on a partial TB of ${hex} it has left`).toBe(hex);
          // Nothing of a step's minefield attacks outlives its phase.
          if (st.phase !== 'MPh') expect(st.ext['asl.mines.last'], 'asl.mines.last left after the MPh').toBeUndefined();
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
    }
    expect(Object.keys(counts).filter((k) => k.startsWith('attack:')).length, JSON.stringify(counts)).toBeGreaterThan(0);
  }, 180_000);

  it('asl-testbed: weighted random play crosses the roadblock, claims and loses Wall Advantage, and every Player Turn boundary is clean', () => {
    const scenario = scenarioById('asl-testbed')!;
    const counts: Record<string, number> = {};
    const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
    const near = ['uO9', 'uP8'];
    const weigh = weightedPicker((a, _legal, state, engine) => {
      if (overstacks(engine, state, a)) return 0;
      if (a.type === 'fort.place') return 400;
      // Deploy and Recombine have their own run (T6): not here.
      if (a.type === 'setup.deploy' || a.type === 'rally.deploy' || a.type === 'rally.recombine') return 0;
      if (a.type === 'wa.claim' || a.type === 'wa.forfeit') return 10;
      if (a.type === 'clearance.declare') return 40;
      if (a.type === 'move.start') return 20;
      if (a.type === 'move.step') {
        const to = String(a['to']);
        if (near.includes(to)) return 60;
        if (to.includes(':')) return 1;
        const env = engine.env(state);
        const from = moveState(env)?.hex;
        const map = statics(env).map;
        const d = (h: string) => Math.min(...near.map((n) => map.distance(h, n)));
        return from && map.hex(to) && d(to) < d(from) ? 20 : 1;
      }
      if (a.type === 'endPhase') return state.phase === 'MPh' ? 1 : 4;
      return 1;
    });
    // The roadblock where the test bed's own placement has it: on the O9–P8 road hexside, open.
    const pick: typeof weigh = (legal, state, engine, rand) => {
      const a = weigh(legal, state, engine, rand);
      if (a.type !== 'fort.place') return a;
      const map = statics(engine.env(state)).map;
      const hexside = sideToward(map, 'uO9', 'uP8');
      const counters = (a['counters'] as { kind: string; hex: string; hidden: boolean }[]).map((c) => (c.kind === 'roadblock' ? { ...c, hex: 'uO9', hexside, hidden: false } : c));
      const moved = { ...a, counters };
      return engine.validate(state, moved as never) ? a : (moved as typeof a);
    };
    for (const seed of [31, 32, 33]) {
      const check = turnBoundaryCheck(`asl-testbed roadblock seed ${seed}`);
      const { state, steps } = playRandom(scenario, `roadblock-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 9000,
        pick,
        onStep: (st, events, a) => {
          bump(a.type);
          for (const ev of events) {
            if (ev.type === 'asl.wa.changed') bump((ev.payload as { wa: boolean }).wa ? 'wa:on' : 'wa:off');
            if (ev.type === 'asl.clearance.dr') bump((ev.payload as { abandoned?: true }).abandoned ? 'task:abandoned' : 'task:rolled');
            if (ev.type === 'sk1.move.state') {
              const ms = (ev.payload as { state: { hex?: string; from?: string } | null }).state;
              if (ms?.hex && ms.from && near.includes(ms.hex) && near.includes(ms.from) && ms.hex !== ms.from) bump('crossed');
            }
          }
          check(st, events);
          // Every unit claiming WA stands in the Location it claimed it in, a hex of the roadblock hexside (B9.32, B9.41).
          for (const p of Object.values(st.pieces)) {
            const wa = p.tags['wa'];
            if (typeof wa !== 'string' || p.loc.kind !== 'hex') continue;
            expect(near, `${p.id} claims WA in ${wa}`).toContain(wa);
          }
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
    }
    expect(counts['wa:on'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts['task:rolled'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
  }, 120_000);

  it('asl-testbed-pillbox: weighted random play goes into and out of the pillbox, fires at it and routs into it, and every Player Turn boundary is clean', () => {
    const scenario = scenarioById('asl-testbed-pillbox')!;
    const counts: Record<string, number> = {};
    const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
    // The pillbox in P6 facing east, open; stacks steered toward it, into and out of it, fire at it and routs into it.
    const near = ['uP6'];
    const weigh = weightedPicker((a, _legal, state, engine) => {
      if (a.type === 'fort.place') return 400;
      if (a.type === 'move.start' || a.type === 'vmove.start') return 20;
      if (a.type === 'move.step' || a.type === 'rout.step' || a.type === 'advance') {
        const to = String(a['to']);
        if (to.endsWith(':pb')) return 80;
        if (near.includes(to)) return 40;
        if (a.type !== 'move.step') return 1;
        if (to.includes(':')) return 1;
        const env = engine.env(state);
        const from = moveState(env)?.hex;
        const map = statics(env).map;
        return from && map.hex(to) && map.distance(to, 'uP6') < map.distance(from, 'uP6') ? 20 : 1;
      }
      if ((a.type === 'fire' || a.type === 'defFire') && String((a['decl'] as { target: string }).target).endsWith(':pb')) return 40;
      if ((a.type === 'fire.ordnance' || a.type === 'defFire.ordnance') && String((a['shot'] as { target: string }).target).endsWith(':pb')) return 40;
      if (a.type === 'endPhase') return state.phase === 'MPh' ? 1 : 4;
      return 1;
    });
    const pick: typeof weigh = (legal, state, engine, rand) => {
      const a = weigh(legal, state, engine, rand);
      const bad = engine.validate(state, a);
      if (bad) throw new Error(`listed but refused: ${JSON.stringify(a)}: ${bad}`);
      // A Russian squad set up inside it, for the Germans to fire at and assault.
      if (a.type === 'setup.place' && a.side === 'ru') {
        const placements = { ...(a['placements'] as Record<string, string>) };
        const squad = Object.keys(placements).sort().find((id) => state.pieces[id]?.defId === 'ru.447');
        if (squad) placements[squad] = 'uP6:pb';
        const moved = { ...a, placements };
        return engine.validate(state, moved as never) ? a : (moved as typeof a);
      }
      if (a.type !== 'fort.place') return a;
      const counters = (a['counters'] as { kind: string; hex: string; hidden: boolean; ca?: number }[]).map((c) => (c.kind === 'pillbox' ? { ...c, hex: 'uP6', hidden: false, ca: 0 } : c));
      const moved = { ...a, counters };
      return engine.validate(state, moved as never) ? a : (moved as typeof a);
    };
    for (const seed of [41, 42, 43]) {
      const check = turnBoundaryCheck(`asl-testbed-pillbox seed ${seed}`);
      const { state, steps } = playRandom(scenario, `pillbox-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 9000,
        pick,
        onStep: (st, events, a) => {
          bump(a.type);
          const to = String(a['to'] ?? '');
          if (a.type === 'move.step' && to.endsWith(':pb')) bump('pb:in');
          if (a.type === 'rout.step' && to.endsWith(':pb')) bump('pb:rout');
          if (a.type === 'advance' && to.endsWith(':pb')) bump('pb:advance');
          for (const ev of events) {
            if (ev.type === 'sk1.fire.attack' && String((ev.payload as { attack: { target: string } }).attack.target).endsWith(':pb')) bump('pb:fired');
            if (ev.type === 'sk2.ordnance.shot' && String((ev.payload as { target: string }).target).endsWith(':pb')) bump('pb:ordnance');
            if (ev.type === 'asl.pb.eliminated') bump('pb:eliminated');
          }
          check(st, events);
          // Units in a pillbox Location are in a pillbox that is there (B30.92: its contents go with it).
          for (const p of Object.values(st.pieces)) {
            if (p.loc.kind !== 'hex' || p.loc.sub !== 'pb') continue;
            const forts = (st.ext['asl.fortifications'] as { counters: { kind: string; hex: string }[] } | undefined)?.counters ?? [];
            expect(forts.some((c) => c.kind === 'pillbox' && c.hex === (p.loc as { hex: string }).hex), `${p.id} in a pillbox that is gone`).toBe(true);
          }
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
    }
    expect(counts['pb:in'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts['pb:fired'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
  }, 180_000);

  it('asl-testbed-vehicles: weighted random play with a tank beneath the P6 trench, a Gun pushed near the roadblock and armor steered at both; every Player Turn boundary is clean', () => {
    const scenario = scenarioById('asl-testbed-vehicles')!;
    const counts: Record<string, number> = {};
    const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
    const goal = (state: { attacker: string }) => (state.attacker === 'ge' ? 'uP6' : 'uO9');
    const weigh = weightedPicker((a, _legal, state, engine) => {
      if (overstacks(engine, state, a)) return 0;
      if (a.type === 'fort.place') return 400;
      // A vehicle MG turning its turret or hull to fire (SK4 3.2.4, 7.8): rarely, so the armor fights over the trench and
      // the Gun rather than spraying MG fire all round.
      if ((a.type === 'fire' || a.type === 'defFire') && ((a['decl'] as { tca?: number; vca?: number }).tca !== undefined || (a['decl'] as { vca?: number }).vca !== undefined)) return 0.1;
      // Pushes into the P7 and O8 buildings (their TEM and MF on the DR) fail often: Labor across the turns.
      if (a.type === 'move.manhandle') return ['uP7', 'uO8'].includes(String(a['to'])) ? 200 : 60;
      if (a.type === 'move.start' && a['manhandle']) return 80;
      if (a.type === 'move.start' || a.type === 'vmove.start') return 20;
      if (a.type === 'move.step') {
        const to = String(a['to']);
        if (to.includes(':')) return 1;
        const env = engine.env(state);
        const from = moveState(env)?.hex;
        const map = statics(env).map;
        return from && map.hex(to) && map.distance(to, goal(state)) < map.distance(from, goal(state)) ? 20 : 1;
      }
      if ((a.type === 'fire.ordnance' || a.type === 'defFire.ordnance' || a.type === 'vmove.bff') && (a['shot'] as { targetType: string }).targetType === 'VTT') return 60;
      if (a.type === 'endPhase') return state.phase === 'MPh' ? 1 : 4;
      return 1;
    });
    const pick: typeof weigh = (legal, state, engine, rand) => {
      const a = weigh(legal, state, engine, rand);
      const bad = engine.validate(state, a);
      if (bad) throw new Error(`listed but refused: ${JSON.stringify(a)}: ${bad}`);
      // The T-34 set up beneath the P6 trench (B27.51), the AT Gun's crew and a 4-4-7 beside the roadblock in P8.
      if (a.type === 'setup.place' && a.side === 'ru') {
        const placements = { ...(a['placements'] as Record<string, string>) };
        const id = (def: string) => Object.keys(placements).sort().find((x) => state.pieces[x]?.defId === def);
        const t34 = id('ru.T34M41');
        if (t34) placements[t34] = 'uP6';
        for (const def of ['ru.228c', 'ru.447']) if (id(def)) placements[id(def)!] = 'uP8';
        // The Gun set up in the Open Ground of P8 may not be hidden (A12.34).
        const guns = Object.fromEntries(Object.entries((a['guns'] as Record<string, { ca: number; hip?: boolean }> | undefined) ?? {}).map(([g, spec]) => [g, { ca: spec.ca }]));
        const moved = { ...a, placements, guns, beneath: [...((a['beneath'] as string[] | undefined) ?? []).filter((x) => placements[x] !== undefined), ...(t34 ? [t34] : [])] };
        return engine.validate(state, moved as never) ? a : (moved as typeof a);
      }
      if (a.type !== 'fort.place') return a;
      const map = statics(engine.env(state)).map;
      let trench = false;
      const counters = (a['counters'] as { kind: string; hex: string; hidden: boolean; hexside?: number }[]).map((c) => {
        if (c.kind === 'trench' && !trench) {
          trench = true;
          return { ...c, hex: 'uP6', hidden: false };
        }
        if (c.kind === 'roadblock') return { ...c, hex: 'uO9', hidden: false, hexside: sideToward(map, 'uO9', 'uP8')! };
        return c;
      });
      const moved = { ...a, counters };
      return engine.validate(state, moved as never) ? a : (moved as typeof a);
    };
    for (const seed of [51, 52, 53]) {
      const check = turnBoundaryCheck(`asl-testbed-vehicles seed ${seed}`);
      const { state, steps } = playRandom(scenario, `vehicles-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 9000,
        pick,
        onStep: (st, events, a) => {
          bump(a.type);
          for (const ev of events) {
            if (ev.type === 'asl.hd.hullHit') bump('hd:hullHit');
            if (ev.type === 'sk2.ordnance.shot' && (ev.payload as { target: string; targetType: string }).target === 'uP6' && (ev.payload as { targetType: string }).targetType === 'VTT') bump('hd:shot');
            if (ev.type === 'sk2.gun.manhandle') bump(`push:${(ev.payload as { outcome: string }).outcome}`);
            if (ev.type === 'asl.manhandle.ti') bump('push:ti');
            if (ev.type === 'piece.tagged' && typeof (ev.payload as { tags: Record<string, unknown> }).tags['labor'] === 'string' && String((ev.payload as { tags: Record<string, unknown> }).tags['labor']).startsWith('manhandle:')) bump('push:labor');
            if (ev.type === 'asl.wa.changed' && (ev.payload as { wa: boolean }).wa && st.pieces[(ev.payload as { unit: string }).unit]?.defId.match(/T34|pzivf2|psw/)) bump('wa:vehicle');
          }
          check(st, events);
          // A vehicle beneath the trench never leaves it (B27.52): it is in P6 beneath it, or gone.
          for (const p of Object.values(st.pieces)) {
            if (p.defId !== 'ru.T34M41' || p.loc.kind !== 'hex' || p.tags['wreck'] === true) continue;
            if ((p.loc as { pos?: { ent?: string } }).pos?.ent) expect(p.loc, `${p.id} beneath a trench`).toMatchObject({ hex: 'uP6' });
          }
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
    }
    expect(counts['move.manhandle'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts['push:ti'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts['hd:shot'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts['push:labor'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
  }, 180_000);

  it('asl-testbed-deploy: weighted random play deploys at setup and in the RPh, offboard too, and recombines HS of both sides; every Player Turn boundary is clean', () => {
    const scenario = scenarioById('asl-testbed-deploy')!;
    const counts: Record<string, number> = {};
    const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
    // Deploy and Recombine whenever offered (both are an RPh's sole action: the rest of play goes on as usual), the entering
    // group stacked so its leader may direct one offboard (A2.52).
    const weigh = weightedPicker((a) => (a.type === 'setup.deploy' ? 50 : a.type === 'rally.deploy' ? 60 : a.type === 'rally.recombine' ? 80 : a.type === 'endPhase' ? 4 : 1));
    const pick: typeof weigh = (legal, state, engine, rand) => {
      const a = weigh(legal, state, engine, rand);
      const bad = engine.validate(state, a);
      if (bad) throw new Error(`listed but refused: ${JSON.stringify(a)}: ${bad}`);
      // The Russian 2-2-6 set up with the 7-0, so that the Russians have a pair to Recombine (A25.2: their HS may).
      if (a.type === 'setup.place' && a.side === 'ru') {
        const placements = { ...(a['placements'] as Record<string, string>) };
        const ids = Object.keys(placements).sort();
        const l70 = ids.find((x) => state.pieces[x]?.defId === 'ru.L70');
        if (l70) for (const x of ids.filter((y) => state.pieces[y]?.defId === 'ru.226h')) placements[x] = placements[l70]!;
        const moved = { ...a, placements };
        return engine.validate(state, moved as never) ? a : (moved as typeof a);
      }
      if (a.type !== 'setup.offboard') return a;
      const placements = a['placements'] as Record<string, string>;
      const hex = Object.values(placements).sort()[0]!;
      const together = { ...a, placements: Object.fromEntries(Object.keys(placements).map((id) => [id, hex])) };
      return engine.validate(state, together as never) ? a : (together as typeof a);
    };
    for (const seed of [61, 62, 63]) {
      const check = turnBoundaryCheck(`asl-testbed-deploy seed ${seed}`);
      const { state, steps } = playRandom(scenario, `deploy-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 9000,
        pick,
        onStep: (st, events, a) => {
          bump(a.type);
          for (const ev of events) {
            if (ev.type === 'asl.deploy') bump((ev.payload as { passed: boolean; offboard?: boolean }).passed ? ((ev.payload as { offboard?: boolean }).offboard ? 'deploy:offboard' : 'deploy:passed') : 'deploy:failed');
            if (ev.type === 'asl.recombined') bump(`recombined:${st.pieces[(ev.payload as { squad: string }).squad]!.side}`);
          }
          check(st, events);
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
    }
    expect(counts['setup.deploy'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts['deploy:passed'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts['deploy:failed'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts['recombined:ru'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts['recombined:ge'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
  }, 180_000);

  it('asl-testbed-movement: weighted random play makes Minimum Moves, Double Time during the move, Dashes and Infantry OVR with their First Fire and CC; every Player Turn boundary is clean', () => {
    const scenario = scenarioById('asl-testbed-movement')!;
    const counts: Record<string, number> = {};
    const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
    const col = (h: unknown) => (typeof h === 'string' ? (/^u([A-Z]+)/.exec(h)?.[1] ?? '') : '');
    const colIndex = (c: string) => (c.length === 1 ? c.charCodeAt(0) - 64 : 26 + c.charCodeAt(1) - 64);
    // The Germans press west, into enemy Locations where the rules let them (Infantry OVR), Dash and Double Time when
    // offered; the Russians stay and fight an overrun leader as often as they slip away.
    const weigh = weightedPicker((a, _legal, state, engine) => {
      if (a.type === 'move.dash') return 60;
      if (a.type === 'move.doubleTime') return 15;
      if (a.type === 'move.step' && typeof a['to'] === 'string') {
        const to = a['to'] as string;
        const enemy = Object.values(state.pieces).some((p) => p.side !== state.attacker && p.loc.kind === 'hex' && p.loc.hex === to);
        if (enemy) return 400;
        const env = engine.env(state);
        const ms = moveState(env);
        const from = ms?.hex;
        // A step some unit cannot pay for is a Minimum Move (A4.134).
        if (ms && ms.units.some((u) => env.query('move.stepCost', { ms, to }, 1) > (ms.allowance[u] ?? 0) - (ms.spent[u] ?? 0))) return 80;
        // Toward the nearest Russian leader standing alone (to overrun him, A4.15).
        const map = statics(env).map;
        const lone = Object.values(state.pieces)
          .filter((p) => p.side === 'ru' && p.loc.kind === 'hex' && p.defId.startsWith('ru.L'))
          .map((p) => (p.loc as { hex: string }).hex)
          .filter((h) => Object.values(state.pieces).filter((q) => q.side === 'ru' && q.loc.kind === 'hex' && (q.loc as { hex: string }).hex === h).length === 1);
        const near = (h: string) => Math.min(99, ...lone.map((l) => map.distance(h, l)));
        if (from && state.attacker === 'ge' && map.hex(to) && near(to) < near(from)) return 30;
        return from && state.attacker === 'ge' && colIndex(col(to)) < colIndex(col(from)) ? 6 : 1;
      }
      if (a.type === 'cc.declare') return (a['attacks'] as unknown[]).length ? 10 : 1;
      // The Russians mostly stay put and hold their fire, so the Germans reach the leaders they overrun.
      if (a.type === 'move.start') return state.attacker === 'ge' ? 40 : 0.2;
      // Advancing into the leaders' hexes would take them in CC first: rarely.
      if (a.type === 'advance') return 0.2;
      if (a.type === 'endPhase') return state.phase === 'MPh' ? 1 : 3;
      // No German Prep Fire: a unit that fires there may not move (A3.2).
      if (a.type === 'fire') return state.phase === 'PFPh' && state.attacker === 'ge' ? 0 : 2;
      return a.type === 'defFire' ? 0.3 : 1;
    });
    const pick: typeof weigh = (legal, state, engine, rand) => {
      const a = weigh(legal, state, engine, rand);
      const bad = engine.validate(state, a);
      if (bad) throw new Error(`listed but refused: ${JSON.stringify(a)}: ${bad}`);
      // Russian leaders set up alone in the buildings on the front line (P5, P7), the 9-1 with his LMG, to be overrun.
      if (a.type === 'setup.place' && a.side === 'ru') {
        const placements = { ...(a['placements'] as Record<string, string>) };
        const of = (def: string) => Object.keys(placements).sort().find((x) => state.pieces[x]?.defId === def);
        const l70 = of('ru.L70');
        const l91 = of('ru.L91');
        if (l70) placements[l70] = 'uP7';
        if (l91) placements[l91] = 'uP5';
        for (const [id, hex] of Object.entries(placements)) if (id !== l70 && id !== l91 && (hex === 'uP7' || hex === 'uP5')) placements[id] = 'uK4';
        const moved = { ...a, placements };
        return engine.validate(state, moved as never) ? a : (moved as typeof a);
      }
      // The German 4-6-7 with three SW (one MF) beside the S3 woods, so that it has a Minimum Move to make.
      if (a.type === 'setup.place' && a.side === 'ge') {
        const placements = { ...(a['placements'] as Record<string, string>) };
        const ids = Object.keys(placements).sort();
        const heavy = ids.find((x) => Object.values(state.pieces).filter((w) => w.loc.kind === 'held' && w.loc.by === x).length === 3);
        // The rest along hexrow S facing the Russian leaders in P5 and P7.
        const front = ['uS5', 'uS6', 'uS7', 'uS8'];
        ids.filter((x) => x !== heavy).forEach((x, i) => (placements[x] = front[i % front.length]!));
        if (heavy) placements[heavy] = 'uS4';
        const moved = { ...a, placements };
        return engine.validate(state, moved as never) ? a : (moved as typeof a);
      }
      return a;
    };
    for (const seed of [71, 72, 73, 74, 75, 76]) {
      const check = turnBoundaryCheck(`asl-testbed-movement seed ${seed}`);
      const { state, steps } = playRandom(scenario, `movement-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 9000,
        pick,
        onStep: (st, events, a) => {
          bump(a.type);
          for (const ev of events) {
            if (ev.type === 'asl.move.minimum') bump('minimum');
            if (ev.type === 'asl.move.doubleTime') bump('doubleTime');
            if (ev.type === 'asl.move.dash') bump('dash');
            if (ev.type === 'asl.ovr.ntc') bump('ovr:ntc');
            if (ev.type === 'asl.ovr.answer') bump(`ovr:${(ev.payload as { choice: string }).choice}`);
            if (ev.type === 'asl.tpbf.mandatory') bump('tpbf');
            if (ev.type === 'asl.ovr.cc') bump(`ovr:cc:${(ev.payload as { outcome: string }).outcome}`);
          }
          check(st, events);
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
    }
    for (const k of ['minimum', 'doubleTime', 'dash', 'ovr:ntc', 'ovr:stay', 'ovr:slip', 'tpbf']) expect(counts[k] ?? 0, `${k}: ${JSON.stringify(counts)}`).toBeGreaterThan(0);
    expect((counts['ovr:cc:melee'] ?? 0) + (counts['ovr:cc:eliminated'] ?? 0), JSON.stringify(counts)).toBeGreaterThan(0);
  }, 240_000);

  it('asl-testbed-stacking: weighted random play overstacks by moving, advancing and routing, fires from and at overstacked Locations; every Player Turn boundary is clean', () => {
    const scenario = scenarioById('asl-testbed-stacking')!;
    const counts: Record<string, number> = {};
    const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
    const labelsOf = (p: unknown) => ((p as { explain?: { label?: string }[] }).explain ?? []).map((n) => n.label ?? '');
    // Every side presses into Locations its own units hold, so that they overstack; the rest heads for the enemy.
    const weigh = weightedPicker((a, _legal, state, engine) => {
      if (a.type === 'fort.place') return 400;
      if (a.type === 'move.step' || a.type === 'advance' || a.type === 'rout.step') {
        if (overstacks(engine, state, a)) return a.type === 'rout.step' ? 50 : 200;
        if (a.type !== 'move.step') return 1;
        const to = String(a['to']);
        const env = engine.env(state);
        const from = moveState(env)?.hex;
        const map = statics(env).map;
        const enemy = Object.values(state.pieces).filter((p) => p.side !== state.attacker && p.loc.kind === 'hex').map((p) => (p.loc as { hex: string }).hex);
        const near = (h: string) => Math.min(99, ...enemy.map((e) => map.distance(h, e)));
        return from && !to.includes(':') && map.hex(to) && near(to) < near(from) ? 10 : 1;
      }
      if (a.type === 'move.start') return 30;
      if (a.type === 'move.dash' || a.type === 'move.doubleTime') return 0;
      if (a.type === 'endPhase') return state.phase === 'MPh' ? 1 : 4;
      return 1;
    });
    const pick: typeof weigh = (legal, state, engine, rand) => {
      const a = weigh(legal, state, engine, rand);
      const bad = engine.validate(state, a);
      if (bad) throw new Error(`listed but refused: ${JSON.stringify(a)}: ${bad}`);
      if (overstacks(engine, state, a)) bump(`overstack:${a.type}`);
      return a;
    };
    for (const seed of [81, 82, 83, 84]) {
      const check = turnBoundaryCheck(`asl-testbed-stacking seed ${seed}`);
      const { state, steps } = playRandom(scenario, `stacking-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 9000,
        pick,
        onStep: (st, events) => {
          for (const ev of events) {
            if (ev.type === 'sk1.fire.attack' && labelsOf(ev.payload).some((l) => l.includes('overstacked firer'))) bump('firer');
            if (ev.type === 'sk1.fire.result' && labelsOf(ev.payload).some((l) => l.includes('vs overstacked'))) bump('target');
            if (ev.type === 'sk1.cc.attack' && labelsOf(ev.payload).some((l) => l.includes('overstacked'))) bump('cc');
          }
          check(st, events);
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
    }
    for (const k of ['overstack:move.step', 'overstack:advance', 'firer', 'target']) expect(counts[k] ?? 0, `${k}: ${JSON.stringify(counts)}`).toBeGreaterThan(0);
  }, 240_000);

  it('asl-testbed-vehicles: weighted random play stacks the German AFV in one hex and fires at them there on the Vehicle Target Type (A5.2, A5.132); every Player Turn boundary is clean', () => {
    const scenario = scenarioById('asl-testbed-vehicles')!;
    const counts: Record<string, number> = {};
    const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
    const weigh = weightedPicker((a, _legal, state, engine) => {
      if (a.type === 'fort.place') return 400;
      // A vehicle MG turning its turret or hull to fire (SK4 3.2.4, 7.8): rarely, so the ordnance keeps firing on the
      // Vehicle Target Type at the stacked AFV.
      if ((a.type === 'fire' || a.type === 'defFire') && ((a['decl'] as { tca?: number; vca?: number }).tca !== undefined || (a['decl'] as { vca?: number }).vca !== undefined)) return 0.1;
      if (a.type === 'vmove.start') {
        const v = state.pieces[a['vehicle'] as string];
        const sharing = !!v && v.loc.kind === 'hex' && vehiclesAt(engine.env(state), (v.loc as { hex: string }).hex, v.side, true).length > 1;
        return sharing ? 0 : state.attacker === 'ge' ? 60 : 5;
      }
      const ms = moveState(engine.env(state));
      const shared = !!ms?.vehicle && !!ms.hex && vehiclesAt(engine.env(state), ms.hex, state.attacker, true).length > 1;
      if (a.type === 'move.step') {
        if (ms?.vehicle) return shared ? 0.5 : overstacks(engine, state, a) ? 400 : 2;
        return overstacks(engine, state, a) ? 20 : 1;
      }
      if (a.type === 'vmove.turn') return 20;
      if ((a.type === 'vmove.stop' || a.type === 'vmove.end') && shared) return 400;
      // No German Prep Fire (a vehicle that fires then may not move); after that everyone fires on the Vehicle Target Type.
      if (state.phase === 'PFPh' && state.attacker === 'ge' && a.type !== 'endPhase') return 0;
      if ((a.type === 'fire.ordnance' || a.type === 'defFire.ordnance' || a.type === 'vmove.bff') && (a['shot'] as { targetType: string }).targetType === 'VTT') {
        const t = String((a['shot'] as { target: string }).target);
        return vehiclesAt(engine.env(state), t, undefined, true).filter((v) => v.side !== a.side).length > 1 ? 400 : 20;
      }
      if (a.type === 'endPhase') return state.phase === 'MPh' ? 2 : 4;
      return 1;
    });
    const pick: typeof weigh = (legal, state, engine, rand) => {
      const a = weigh(legal, state, engine, rand);
      const bad = engine.validate(state, a);
      if (bad) throw new Error(`listed but refused: ${JSON.stringify(a)}: ${bad}`);
      const sh = a['shot'] as { targetType?: string; target?: string } | undefined;
      if (sh?.targetType === 'VTT' && vehiclesAt(engine.env(state), sh.target!, undefined, true).filter((v) => v.side !== a.side).length > 1) bump('vttStacked');
      // The two German AFV set up side by side (a setup never overstacks, A2.9), one hex apart from the Russian Gun's view.
      if (a.type === 'setup.place' && a.side === 'ge') {
        const placements = { ...(a['placements'] as Record<string, string>) };
        const id = (def: string) => Object.keys(placements).sort().find((x) => state.pieces[x]?.defId === def);
        if (id('ge.pzivf2')) placements[id('ge.pzivf2')!] = 'uU6';
        if (id('ge.psw2341')) placements[id('ge.psw2341')!] = 'uV6';
        const moved = { ...a, placements };
        return engine.validate(state, moved as never) ? a : (moved as typeof a);
      }
      if (a.type === 'setup.place' && a.side === 'ru') {
        const placements = { ...(a['placements'] as Record<string, string>) };
        const crew = Object.keys(placements).sort().find((x) => state.pieces[x]?.defId === 'ru.228c');
        if (crew) placements[crew] = 'uO6';
        const guns = Object.fromEntries(Object.entries((a['guns'] as Record<string, { ca: number; hip?: boolean }> | undefined) ?? {}).map(([g, spec]) => [g, { ca: spec.ca }]));
        const moved = { ...a, placements, guns };
        return engine.validate(state, moved as never) ? a : (moved as typeof a);
      }
      return a;
    };
    for (const seed of [91, 92, 93, 94, 99, 108]) {
      const check = turnBoundaryCheck(`asl-testbed-vehicles stacking seed ${seed}`);
      const { state, steps } = playRandom(scenario, `vehicle-stacking-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 9000,
        pick,
        onStep: (st, events) => {
          for (const ev of events) if (ev.type === STRAY_HIT_EVENT) bump((ev.payload as { hit: string | null }).hit ? 'stray:hit' : 'stray:dr');
          const together = Object.values(st.pieces).filter((p) => p.side === 'ge' && p.loc.kind === 'hex' && (p.defId === 'ge.pzivf2' || p.defId === 'ge.psw2341') && p.tags['wreck'] !== true);
          if (st.phase === 'DFPh' && st.attacker === 'ge' && together.length === 2 && (together[0]!.loc as { hex: string }).hex === (together[1]!.loc as { hex: string }).hex) bump('together');
          check(st, events);
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
    }
    // The A5.132 dr needs a miss by exactly one here (two vehicles), rare at these ranges: seeds 99 and 108 reach it.
    expect(counts['together'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts['vttStacked'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect((counts['stray:dr'] ?? 0) + (counts['stray:hit'] ?? 0), JSON.stringify(counts)).toBeGreaterThan(0);
  }, 240_000);

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
    }, 60_000);
  }
});
