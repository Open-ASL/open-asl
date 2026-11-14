import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState } from '@asl/engine';
import { activeRout, activeRoutEnds, pendingRouts, routEscorts, routMfLeft } from '../src';
import { RU_VS_GE, act, makeEngine, testMap } from './fixtures';

/** The legal `rout.step` of `unit` into `to` (normal or Low Crawl). */
const stepTo = (engine: Engine, s: GameState, side: string, unit: string, to: string, lowCrawl = false) =>
  engine.legalActions(s, side).find((a) => a.type === 'rout.step' && a['unit'] === unit && a['to'] === to && !!a['lowCrawl'] === lowCrawl);
const stepTargets = (engine: Engine, s: GameState, side: string, unit: string, lowCrawl = false) =>
  engine
    .legalActions(s, side)
    .filter((a) => a.type === 'rout.step' && a['unit'] === unit && !!a['lowCrawl'] === lowCrawl)
    .map((a) => a['to'] as string)
    .sort();

/** Board y, American (attacker) routs first. */
describe('Rout Phase', () => {
  it('a broken unit in Open Ground where an enemy could Interdict it must rout (SK1 3.6)', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RtPh',
      terrain: { yL5: { terrain: 'woods' } },
      // The Interdiction NMC in the open hex M5 on the way: DR 3, passed.
      dice: [2, 1],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
    });
    const env = engine.env(state);
    expect(pendingRouts(env)).toEqual([{ unit: 'a1', must: true, reason: { kind: 'openGround', enemy: 'g1', hex: 'yP5' }, done: false }]);
    expect(state.pieces['a1']!.tags['dm']).toBe(true);
    // Neither staying put nor ending the phase is allowed while it has not routed.
    expect(() => act(engine, state, { type: 'rout.stay', unit: 'a1' })).toThrow(/must rout/);
    expect(() => act(engine, state, { type: 'endPhase' })).toThrow(/must rout first/);
    expect(engine.legalActions(state, 'am').some((a) => a.type === 'endPhase')).toBe(false);
    // The rout is walked a hex at a time toward the woods: any way that does not close on the enemy will do.
    const targets = stepTargets(engine, state, 'am', 'a1');
    expect(targets).toContain('yM5');
    expect(targets.some((h) => h.startsWith('yO'))).toBe(false);
    const s1 = act(engine, state, stepTo(engine, state, 'am', 'a1', 'yM5')!).state;
    expect(s1.pieces['a1']!.loc).toEqual({ kind: 'hex', hex: 'yM5' });
    expect(activeRout(engine.env(s1))).toMatchObject({ unit: 'a1', path: ['yM5'], spent: 1, reached: false });
    expect(routMfLeft(engine.env(s1), 'a1')).toBe(5);
    // Mid-rout nothing else may happen: no stopping short of the woods, no other unit, no ending the phase.
    expect(engine.legalActions(s1, 'am').some((a) => a.type === 'rout.stop')).toBe(false);
    expect(() => act(engine, s1, { type: 'endPhase' })).toThrow(/not finished routing/);
    expect(stepTargets(engine, s1, 'am', 'a1')).toContain('yL5');
    const s2 = act(engine, s1, stepTo(engine, s1, 'am', 'a1', 'yL5')!).state;
    expect(s2.pieces['a1']!.loc).toEqual({ kind: 'hex', hex: 'yL5' });
    // Nowhere further to go: the rout ended by itself.
    expect(activeRout(engine.env(s2))).toBeUndefined();
  });

  it('SK1 3.6: Open Ground forces a rout only where Interdiction could happen: not through a Hindrance, nor from a pinned or CX enemy', () => {
    const must = (terrain: Record<string, { terrain: string }>, tags: Record<string, boolean> = {}) => {
      const { engine, state } = makeEngine({
        startPhase: 'RtPh',
        terrain: { yL5: { terrain: 'woods' }, ...terrain },
        pieces: [
          { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true } },
          { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5', tags },
        ],
      });
      // A unit that need not rout (and is not under DM) has nothing pending.
      return !!pendingRouts(engine.env(state))[0]?.must;
    };
    expect(must({})).toBe(true);
    // Orchard between: a Hindrance, so no Interdiction and no forced rout (full ASL A10.5 would force it).
    expect(must({ yO5: { terrain: 'orchard' } })).toBe(false);
    expect(must({}, { pinned: true })).toBe(false);
    expect(must({}, { cx: true })).toBe(false);
  });

  it('the player picks the path: Open Ground under the enemy guns is a legal (and Interdicted) way to a building the cover hex also reaches', () => {
    // From L3 the broken leader may make for the stone building in K4 (2 MF) at once,
    // or step into the open in K3 first, under the guns of the American squad in N3, and reach K4 from there.
    const build = (dice: number[]) =>
      makeEngine({
        startPhase: 'RtPh',
        dice,
        terrain: { yK4: { terrain: 'building-stone', buildingId: 'B11' }, yJ3: { terrain: 'building-stone', buildingId: 'B9' } },
        pieces: [
          { id: 'gL', def: 'ge.L80', side: 'ge', hex: 'yL3', tags: { broken: true, dm: true } },
          { id: 'a1', def: 'am.747', side: 'am', hex: 'yN3' },
        ],
      });
    const { engine, state } = build([6, 6]);
    expect(engine.currentDecision(state)!.owner).toBe('ge');
    const s0 = state;
    const targets = stepTargets(engine, s0, 'ge', 'gL');
    expect(targets).toContain('yK4');
    expect(targets).toContain('yK3');
    expect(targets.some((h) => h === 'yM3' || h === 'yM4' || h === 'yM2')).toBe(false);
    // Through K3: Interdicted there (NMC vs morale 8, a 12 is rolled: eliminated).
    const bad = act(engine, s0, stepTo(engine, s0, 'ge', 'gL', 'yK3')!);
    expect(bad.events.some((e) => e.type === 'dice.rolled')).toBe(true);
    expect(bad.state.pieces['gL']!.loc.kind).toBe('eliminated');
    // The careful way: K4, where the rout may stop or go on into the next building hex J3 (SK1 3.6).
    const careful = build([]);
    const c0 = careful.state;
    const c1 = act(careful.engine, c0, stepTo(careful.engine, c0, 'ge', 'gL', 'yK4')!);
    expect(c1.events.some((e) => e.type === 'dice.rolled')).toBe(false);
    expect(activeRout(careful.engine.env(c1.state))).toMatchObject({ unit: 'gL', reached: true });
    expect(careful.engine.legalActions(c1.state, 'ge').some((a) => a.type === 'rout.stop' && a['unit'] === 'gL')).toBe(true);
    // Only shelter hexes from here: J3 (building) yes, open K3/L4 no.
    expect(stepTargets(careful.engine, c1.state, 'ge', 'gL')).toEqual(['yJ3']);
    const c2 = act(careful.engine, c1.state, stepTo(careful.engine, c1.state, 'ge', 'gL', 'yJ3')!).state;
    expect(c2.pieces['gL']!.loc).toEqual({ kind: 'hex', hex: 'yJ3' });
    // And stopping in K4 is just as legal.
    const stopped = act(careful.engine, c1.state, { type: 'rout.stop', unit: 'gL' }).state;
    expect(stopped.pieces['gL']!.loc).toEqual({ kind: 'hex', hex: 'yK4' });
    expect(activeRout(careful.engine.env(stopped))).toBeUndefined();
  });

  it('a broken unit under cover and not adjacent to the enemy may stay', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RtPh',
      terrain: { yN5: { terrain: 'woods' } },
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
    });
    expect(pendingRouts(engine.env(state))[0]).toMatchObject({ unit: 'a1', must: false });
    const t = act(engine, state, { type: 'rout.stay', unit: 'a1' });
    expect(t.state.pieces['a1']!.loc).toEqual({ kind: 'hex', hex: 'yN5' });
  });

  it('a unit that must rout but has no legal rout path is eliminated for failure to rout', () => {
    const neighbours = testMap().neighbors('yN5');
    const { engine, state } = makeEngine({
      startPhase: 'RtPh',
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true } },
        ...neighbours.map((h, i) => ({ id: `g${i}`, def: 'ge.467', side: 'ge', hex: h })),
      ],
    });
    expect(state.pieces['a1']!.loc.kind).toBe('eliminated');
  });

  it('a rout may not enter a hex it would overstack, so a full shelter is ignored (SK1 3.6)', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RtPh',
      terrain: { yO5: { terrain: 'orchard' }, yL5: { terrain: 'woods' } },
      pieces: [
        // Under DM, so it may rout (the orchard's Hindrance means it need not: SK1 3.6).
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        // The woods at L5 already hold three squads: full.
        { id: 'f1', def: 'am.747', side: 'am', hex: 'yL5' },
        { id: 'f2', def: 'am.747', side: 'am', hex: 'yL5' },
        { id: 'f3', def: 'am.747', side: 'am', hex: 'yL5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
    });
    const env = engine.env(state);
    expect(pendingRouts(env)[0]).toMatchObject({ unit: 'a1' });
    // Walk the rout wherever it may go: it never ends in L5.
    let s = state;
    for (let i = 0; i < 8; i++) {
      const steps = engine.legalActions(s, 'am').filter((a) => a.type === 'rout.step' && a['unit'] === 'a1' && !a['lowCrawl']);
      expect(steps.some((a) => a['to'] === 'yL5')).toBe(false);
      if (!steps.length) break;
      s = act(engine, s, steps[0]!).state;
    }
    expect(s.pieces['a1']!.loc).not.toEqual({ kind: 'hex', hex: 'yL5' });
  });

  it('failure to rout that takes another unit with it (Leader Loss) leaves no rout to plan for the dead', () => {
    const neighbours = testMap().neighbors('yN5');
    const { engine, state } = makeEngine({
      startPhase: 'RtPh',
      // The leader is eliminated first; the Leader Loss Morale Check rolls an original 12 and kills the broken half-squad.
      dice: [6, 6, 6, 6],
      pieces: [
        { id: 'a0', def: 'am.L91', side: 'am', hex: 'yN5', tags: { broken: true } },
        { id: 'a1', def: 'am.347', side: 'am', hex: 'yN5', tags: { broken: true } },
        ...neighbours.map((h, i) => ({ id: `g${i}`, def: 'ge.467', side: 'ge', hex: h })),
      ],
    });
    expect(state.pieces['a0']!.loc.kind).toBe('eliminated');
    expect(state.pieces['a1']!.loc.kind).toBe('eliminated');
  });

  it('a Good Order leader may rout with a broken unit, adds his DRM to the Interdiction NMC, and dies if it fails (SK1 3.6)', () => {
    // Open Ground all the way from yN5 to the woods at yL5, German squad at yP5 in LOS: both steps are interdicted.
    const build = (dice: number[]) =>
      makeEngine({
        startPhase: 'RtPh',
        terrain: { yL5: { terrain: 'woods' } },
        dice,
        pieces: [
          { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
          { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5' },
          { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
        ],
      });
    const { engine, state } = build([3, 4, 3, 4]);
    expect(routEscorts(engine.env(state), 'a1')).toEqual(['aL']);
    const first = stepTo(engine, state, 'am', 'a1', 'yM5')!;
    // A 7 against morale 7 pins the unit at the first hex; with the leader's -1 it passes and the rout goes on.
    const alone = act(engine, state, first).state;
    expect(alone.pieces['a1']!.loc).toEqual({ kind: 'hex', hex: 'yM5' });
    expect(activeRout(engine.env(alone))).toBeUndefined();
    const together = act(engine, state, { ...first, leaders: ['aL'] }).state;
    expect(together.pieces['aL']!.loc).toEqual({ kind: 'hex', hex: 'yM5' });
    expect(activeRout(engine.env(together))).toMatchObject({ unit: 'a1', escort: ['aL'] });
    // Leaders join at the first hex only.
    expect(() => act(engine, together, { ...stepTo(engine, together, 'am', 'a1', 'yL5')!, leaders: ['aL'] })).toThrow(/first hex/);
    const done = act(engine, together, stepTo(engine, together, 'am', 'a1', 'yL5')!).state;
    expect(done.pieces['a1']!.loc).toEqual({ kind: 'hex', hex: 'yL5' });
    expect(done.pieces['aL']!.loc).toEqual({ kind: 'hex', hex: 'yL5' });
    expect(done.pieces['aL']!.tags['broken']).toBeFalsy();
    expect(routEscorts(engine.env(done), 'a1')).toEqual([]);
    // A failed Interdiction MC reduces the unit and eliminates the leader with it.
    const bad = build([6, 5]);
    const t = act(bad.engine, bad.state, { ...first, leaders: ['aL'] });
    expect(t.state.pieces['aL']!.loc.kind).toBe('eliminated');
    expect(t.state.pieces['a1']!.loc.kind).not.toBe('eliminated');
    // A pinned or broken leader may not go along.
    const pinned = makeEngine({
      startPhase: 'RtPh',
      terrain: { yL5: { terrain: 'woods' } },
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5', tags: { pinned: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
    });
    expect(routEscorts(pinned.engine.env(pinned.state), 'a1')).toEqual([]);
    expect(() => act(pinned.engine, pinned.state, { ...first, leaders: ['aL'] })).toThrow(/cannot rout with/);
  });

  it('a stack routs one unit at a time, each walked to the woods: MMC with a Good Order leader along, then another MMC, then a broken leader (SK1 3.6)', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RtPh',
      terrain: { yL5: { terrain: 'woods' } },
      dice: Array(12).fill(1),
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'a2', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'aB', def: 'am.L91', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
    });
    // The broken leader routs in his own right; the Good Order one only as an escort.
    expect(pendingRouts(engine.env(state)).map((r) => r.unit)).toEqual(['a1', 'a2', 'aB']);
    let s = act(engine, state, { ...stepTo(engine, state, 'am', 'a1', 'yM5')!, leaders: ['aL'] }).state;
    // While a1 is on its way nobody else may start.
    expect(stepTargets(engine, s, 'am', 'a2')).toEqual([]);
    expect(() => act(engine, s, { type: 'rout.step', unit: 'a2', to: 'yM5' })).toThrow(/not finished routing/);
    s = act(engine, s, stepTo(engine, s, 'am', 'a1', 'yL5')!).state;
    for (const u of ['a2', 'aB']) {
      s = act(engine, s, stepTo(engine, s, 'am', u, 'yM5')!).state;
      s = act(engine, s, stepTo(engine, s, 'am', u, 'yL5')!).state;
    }
    for (const id of ['a1', 'a2', 'aB', 'aL']) expect(s.pieces[id]!.loc).toEqual({ kind: 'hex', hex: 'yL5' });
    expect(s.pieces['aL']!.tags['broken']).toBeFalsy();
    expect(pendingRouts(engine.env(s)).every((r) => r.done)).toBe(true);
  });

  it('Low Crawl is a one-hex rout that uses every MF and cannot be Interdicted', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RtPh',
      terrain: { yL5: { terrain: 'woods' } },
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
    });
    expect(stepTargets(engine, state, 'am', 'a1', true)).toContain('yM5');
    const t = act(engine, state, stepTo(engine, state, 'am', 'a1', 'yM5', true)!);
    expect(t.events.some((e) => e.type === 'dice.rolled')).toBe(false);
    expect(t.state.pieces['a1']!.loc).toEqual({ kind: 'hex', hex: 'yM5' });
    expect(activeRout(engine.env(t.state))).toBeUndefined();
  });

  it('each rout step says on its state event whether it was a Low Crawl and why it was or was not open to Interdiction', () => {
    const stepOf = (t: { events: { type: string; payload: unknown }[] }) => (t.events.find((e) => e.type === 'sk1.rout.state' && (e.payload as { step?: unknown }).step)?.payload as { step?: unknown }).step;
    const opts = (g1: string) => ({
      startPhase: 'RtPh',
      terrain: { yL5: { terrain: 'woods' } },
      dice: [2, 1],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: g1 },
      ],
    });
    // Into Open Ground in the German's Normal Range and clear LOS: Interdiction, by g1.
    const { engine, state } = makeEngine(opts('yP5'));
    const t1 = act(engine, state, stepTo(engine, state, 'am', 'a1', 'yM5')!);
    expect(stepOf(t1)).toEqual({ unit: 'a1', to: 'yM5', lowCrawl: false, interdiction: 'checked', by: ['g1'] });
    // On into the woods: not Open Ground.
    const t2 = act(engine, t1.state, stepTo(engine, t1.state, 'am', 'a1', 'yL5')!);
    expect(stepOf(t2)).toEqual({ unit: 'a1', to: 'yL5', lowCrawl: false, interdiction: 'notOpen' });
    // A Low Crawl into the same Open Ground hex: never Interdicted.
    const t3 = act(engine, state, stepTo(engine, state, 'am', 'a1', 'yM5', true)!);
    expect(stepOf(t3)).toEqual({ unit: 'a1', to: 'yM5', lowCrawl: true, interdiction: 'lowCrawl' });
    // Open Ground with the only German far out of Normal Range (the rout runs away from it, east): no enemy able to interdict.
    const far = makeEngine(opts('yA1'));
    const t4 = act(far.engine, far.state, stepTo(far.engine, far.state, 'am', 'a1', 'yO5')!);
    expect(stepOf(t4)).toEqual({ unit: 'a1', to: 'yO5', lowCrawl: false, interdiction: 'none' });
    // The step rides on the state event the step always emitted: no event of its own.
    expect(t4.events.map((e) => e.type)).not.toContain('sk1.rout.step');
  });

  it('two broken units of one hex both Low Crawl into the same hex, neither Interdicted (tester report)', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RtPh',
      terrain: { yL5: { terrain: 'woods' } },
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'a2', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
    });
    let s = state;
    for (const u of ['a1', 'a2']) {
      const t = act(engine, s, stepTo(engine, s, 'am', u, 'yM5', true)!);
      expect(t.events.some((e) => e.type === 'dice.rolled'), u).toBe(false);
      s = t.state;
      expect(s.pieces[u]!.loc).toEqual({ kind: 'hex', hex: 'yM5' });
      expect(activeRout(engine.env(s))).toBeUndefined();
    }
  });

  it('with no building or woods within reach the unit may rout up to its MF in any legal direction and stop where it likes', () => {
    // The test board is Open Ground throughout: the plan has no shelters, so any hex away from the enemy will do.
    // Interdicted at every hex (low dice: passed).
    const { engine, state } = makeEngine({
      startPhase: 'RtPh',
      dice: Array(12).fill(1),
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
    });
    let s = state;
    for (const h of ['yM5', 'yL5', 'yK5']) s = act(engine, s, stepTo(engine, s, 'am', 'a1', h)!).state;
    expect(activeRout(engine.env(s))).toMatchObject({ unit: 'a1', spent: 3, sheltered: false });
    expect(stepTargets(engine, s, 'am', 'a1').length).toBeGreaterThan(0);
    expect(engine.legalActions(s, 'am').some((a) => a.type === 'rout.stop')).toBe(true);
    const stopped = act(engine, s, { type: 'rout.stop', unit: 'a1' }).state;
    expect(stopped.pieces['a1']!.loc).toEqual({ kind: 'hex', hex: 'yK5' });
  });

  it('a rout ends in the first building or woods it reaches unless the next hex is one too, MF left or not (SK1 3.6, A10.51)', () => {
    // I3 (open) to the stone building in I4 (2 MF), straight on into the next building in I5 (4 MF), and
    // no further: nothing beside I5 is a building or woods here (H7 and J7 are two hexes on), so the 2 MF
    // left are forfeit.
    const { engine, state } = makeEngine({
      startPhase: 'RtPh',
      terrain: {
        yI4: { terrain: 'building-stone', buildingId: 'B6' },
        yI5: { terrain: 'building-stone', buildingId: 'B7' },
        yH7: { terrain: 'woods' },
        yJ7: { terrain: 'woods' },
      },
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yI3', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yI1' },
      ],
    });
    expect(routMfLeft(engine.env(state), 'a1')).toBe(6);
    let s = act(engine, state, stepTo(engine, state, 'am', 'a1', 'yI4')!).state;
    // In I4 the rout may stop, or go on directly into the next building.
    expect(engine.legalActions(s, 'am').some((a) => a.type === 'rout.stop')).toBe(true);
    expect(stepTargets(engine, s, 'am', 'a1')).toEqual(['yI5']);
    s = act(engine, s, stepTo(engine, s, 'am', 'a1', 'yI5')!).state;
    expect(s.pieces['a1']!.loc).toEqual({ kind: 'hex', hex: 'yI5' });
    // 4 MF spent, 2 left, but no building or woods next door: the rout ended by itself.
    expect(activeRout(engine.env(s))).toBeUndefined();
  });

  it('a rout from building to building runs to its full 6 MF: J3, I4, I5 and I6 on board y (tester report, ASLRB B23.1)', () => {
    // Board y as printed: I6 holds three small buildings, none touching the centre dot, which still makes
    // it a building hex (B23.1). The import once read I6 as open ground and stopped this rout in I5.
    const { engine, state } = makeEngine({
      startPhase: 'RtPh',
      terrain: {
        yJ3: { terrain: 'building-stone', buildingId: 'B9' },
        yI4: { terrain: 'building-stone', buildingId: 'B6' },
        yI5: { terrain: 'building-stone', buildingId: 'B7' },
        yI6: { terrain: 'building-stone', buildingId: 'B39' },
      },
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yJ3', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yK3' },
      ],
    });
    let s = state;
    for (const h of ['yI4', 'yI5', 'yI6']) {
      expect(activeRout(engine.env(s))?.spent ?? 0).toBeLessThan(6);
      s = act(engine, s, stepTo(engine, s, 'am', 'a1', h)!).state;
    }
    expect(s.pieces['a1']!.loc).toEqual({ kind: 'hex', hex: 'yI6' });
    expect(activeRout(engine.env(s))).toBeUndefined();
  });

  it('a step that brings an enemy into view closes the ROUT END toward it; the rout doubles back through its start to the other (ASLRB A10.51)', () => {
    // S3 on boards y/z: a broken squad routed out of a woods hex into an orchard, from where an enemy far off came
    // into view. The woods ahead was toward it, so the only way on was back through the start hex to a building;
    // the board still marked the closed woods as ROUT END and the game looked frozen. Here: woods M5 (start),
    // open L5, woods K5 (toward the German in H5, out of M5's view) and the building O5 the other way.
    const { engine, state } = makeEngine({
      startPhase: 'RtPh',
      terrain: { yM5: { terrain: 'woods' }, yK5: { terrain: 'woods' }, yO5: { terrain: 'building-stone', buildingId: 'B1' } },
      // The Interdiction NMCs entering L5 and N5 in the German's view: DR 2, passed.
      dice: [1, 1, 1, 1],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yM5', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yH5' },
      ],
    });
    expect(stepTargets(engine, state, 'am', 'a1')).toEqual(expect.arrayContaining(['yL5', 'yN5']));
    let s = act(engine, state, stepTo(engine, state, 'am', 'a1', 'yL5')!).state;
    const env = engine.env(s);
    expect(activeRout(env)).toMatchObject({ destinations: ['yK5', 'yO5'], seen: [], spent: 1 });
    // From L5 the German is in view and K5 is closer to him: closed. O5 is still in reach, back through M5 (6 MF).
    expect(stepTargets(engine, s, 'am', 'a1')).not.toContain('yK5');
    expect(stepTargets(engine, s, 'am', 'a1')).toContain('yM5');
    expect([...activeRoutEnds(env)!]).toEqual(['yO5']);
    s = act(engine, s, stepTo(engine, s, 'am', 'a1', 'yM5')!).state;
    // Back in the start hex it may not stop: it walks on to the building.
    expect(engine.legalActions(s, 'am').some((a) => a.type === 'rout.stop')).toBe(false);
    expect([...activeRoutEnds(engine.env(s))!]).toEqual(['yO5']);
    for (const h of ['yN5', 'yO5']) s = act(engine, s, stepTo(engine, s, 'am', 'a1', h)!).state;
    expect(s.pieces['a1']!.loc).toEqual({ kind: 'hex', hex: 'yO5' });
    expect(activeRout(engine.env(s))).toBeUndefined();
    expect(activeRoutEnds(engine.env(s))).toBeNull();
  });

  it('a rout may chain building/woods hexes, one entered directly after another, until its MF run out (SK1 3.6, A10.51)', () => {
    // I3 open, then I4 and I5 (buildings) and I6 (woods): 2 + 2 + 2 = 6 MF, every step straight into more cover.
    const { engine, state } = makeEngine({
      startPhase: 'RtPh',
      terrain: {
        yI4: { terrain: 'building-stone', buildingId: 'B6' },
        yI5: { terrain: 'building-stone', buildingId: 'B7' },
        yI6: { terrain: 'woods' },
        yI7: { terrain: 'woods' },
      },
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yI3', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yI1' },
      ],
    });
    let s = state;
    for (const h of ['yI4', 'yI5']) {
      s = act(engine, s, stepTo(engine, s, 'am', 'a1', h)!).state;
      expect(activeRout(engine.env(s))).toBeDefined();
    }
    expect(stepTargets(engine, s, 'am', 'a1')).toEqual(['yI6']);
    s = act(engine, s, stepTo(engine, s, 'am', 'a1', 'yI6')!).state;
    // Woods in I7 is next, but 6 MF are spent.
    expect(s.pieces['a1']!.loc).toEqual({ kind: 'hex', hex: 'yI6' });
    expect(activeRout(engine.env(s))).toBeUndefined();
  });

  it('a whole-path rout (older recordings) is still accepted and walked the same way', () => {
    const { engine, state } = makeEngine({
      startPhase: 'RtPh',
      terrain: { yL5: { terrain: 'woods' } },
      dice: [1, 1, 1, 1],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
    });
    expect(engine.legalActions(state, 'am').some((a) => a.type === 'rout')).toBe(false);
    const whole: Omit<Action, 'decisionId' | 'side'> = { type: 'rout', unit: 'a1', path: ['yM5', 'yL5'] };
    const t = act(engine, state, whole);
    expect(t.state.pieces['a1']!.loc).toEqual({ kind: 'hex', hex: 'yL5' });
    expect(activeRout(engine.env(t.state))).toBeUndefined();
    expect(() => act(engine, state, { type: 'rout', unit: 'a1', path: ['yM5'] })).toThrow(/nearest legal building or woods/);
  });
});

describe('Rout within the starting building (tester report, 2026-11-03)', () => {
  // S2 on board z: two broken German squads in the stone building B31 (L6 and L7), Russians in N7
  // and in the building across the road (O6, O7). L7 is the nearest building hex to L6 and not beside
  // an enemy: SK1 3.6 names "the nearest (in MF) building or woods hex" and only *permits* routing
  // out of the starting building ("may always rout out"); ASLRB A10.51 says a unit "need not consider"
  // a hex of its own building as closest only "if it prefers to rout out of that building altogether".
  const setup = () =>
    makeEngine({
      board: 'z',
      scenario: { ...RU_VS_GE, firstSide: 'ru' },
      startPhase: 'RtPh',
      terrain: {
        zL5: { terrain: 'building-stone', buildingId: 'z-B31' },
        zL6: { terrain: 'building-stone', buildingId: 'z-B31' },
        zL7: { terrain: 'building-stone', buildingId: 'z-B31' },
        zM6: { terrain: 'building-stone', buildingId: 'z-B31' },
        zM7: { terrain: 'building-stone', buildingId: 'z-B31' },
        zL8: { terrain: 'building-stone', buildingId: 'z-B27' },
        zM8: { terrain: 'building-stone', buildingId: 'z-B33' },
        zO6: { terrain: 'building-stone', buildingId: 'z-B37' },
        zO7: { terrain: 'building-stone', buildingId: 'z-B37' },
      },
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'zL6', tags: { broken: true, dm: true } },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'zL7', tags: { broken: true, dm: true } },
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'zN7' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'zO6' },
        { id: 'r3', def: 'ru.447', side: 'ru', hex: 'zO7' },
      ],
    });

  it('L6 may rout to L7, the nearest building hex of its own building', () => {
    const { engine, state: s } = setup();
    // Russians rout first (ATTACKER); nothing of theirs is broken, so it is the Germans' step at once.
    expect(s.phase).toBe('RtPh');
    expect(stepTargets(engine, s, 'ge', 'g1')).toContain('zL7');
    const s1 = act(engine, s, stepTo(engine, s, 'ge', 'g1', 'zL7')!).state;
    expect(s1.pieces['g1']!.loc).toEqual({ kind: 'hex', hex: 'zL7' });
    // L7 is a destination: the rout may end there.
    expect(engine.legalActions(s1, 'ge').some((a) => a.type === 'rout.stop' && a['unit'] === 'g1')).toBe(true);
  });

  it('L6 may instead leave the building altogether (SK1 3.6 "may always rout out of a building")', () => {
    const { engine, state: s } = setup();
    // Out through K6/K7 (open) away from the Russians: a legal first step, not only L7.
    const targets = stepTargets(engine, s, 'ge', 'g1');
    expect(targets.some((h) => h.startsWith('zK'))).toBe(true);
  });
});
