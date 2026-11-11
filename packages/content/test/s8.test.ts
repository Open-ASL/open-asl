import { describe, expect, it } from 'vitest';
import { defaultPlacement, piecesToPlace, placementHexes, statics } from '@asl/rules';
import { newSk1Game } from '../src';
import { SK_S8 } from '../src/scenarios/skFree';

describe('S8 Gavin-Maloney Force entry', () => {
  it('sets up offboard beside Y1-GG1 on the north edge and GG1-GG4 on the east edge, and nowhere else', () => {
    const { engine, state: s0 } = newSk1Game(SK_S8, 's8-entry');
    let state = s0;
    for (let i = 0; i < 50 && engine.currentDecision(state)?.kind !== 'offboardSetup'; i++) {
      const d = engine.currentDecision(state)!;
      state = engine.submit(state, engine.legalActions(state, d.owner)[0]!).state;
    }
    const d = engine.currentDecision(state)!;
    expect(d).toMatchObject({ kind: 'offboardSetup', owner: 'am' });
    const env = engine.env(state);
    const map = statics(env).map;
    const gavin = piecesToPlace(env, d).find((p) => SK_S8.forces[p.tags['force'] as number]!.id === 'am-gavin')!;
    const hexes = placementHexes(env, gavin);
    const beside = new Set(hexes.flatMap((h) => map.offboardNeighbors(h).onboard));
    const setup = SK_S8.forces[gavin.tags['force'] as number]!.setup;
    const entry = setup.kind === 'enter' ? setup.hexes! : [];
    expect(entry).toEqual(expect.arrayContaining(['yY1', 'yZ0', 'yGG1', 'yGG2', 'yGG3', 'yGG4']));
    expect(entry).not.toContain('yGG5');
    for (const h of entry) expect(beside, h).toContain(h);
    for (const h of hexes) expect(map.offboardNeighbors(h).onboard.some((n) => entry.includes(n)), h).toBe(true);
  });

  it('enters from an east-edge offboard hex into GG4, not GG5', () => {
    const { engine, state: s0 } = newSk1Game(SK_S8, 's8-entry');
    let state = s0;
    for (let i = 0; i < 50 && engine.currentDecision(state)?.kind !== 'offboardSetup'; i++) state = engine.submit(state, engine.legalActions(state, engine.currentDecision(state)!.owner)[0]!).state;
    const env = engine.env(state);
    const map = statics(env).map;
    const todo = piecesToPlace(env, engine.currentDecision(state)!);
    const off = (p: (typeof todo)[number], want: string) => placementHexes(env, p).find((h) => map.offboardNeighbors(h).onboard.includes(want));
    // Gavin's unit next to GG4; the rest wherever auto-place fits them (the stacking limits bind offboard, ASLRB A5.1).
    const first = todo.find((p) => p.tags['entryEdge'] === 'N,E')!;
    const placements = defaultPlacement(env, 'am', todo, { [first.id]: off(first, 'yGG4')! })!;
    const a = engine.legalActions(state, 'am').find((x) => x.type === 'setup.offboard')!;
    state = engine.submit(state, { ...a, placements }).state;
    for (let i = 0; i < 50 && state.phase !== 'MPh'; i++) {
      const d = engine.currentDecision(state)!;
      const l = engine.legalActions(state, d.owner);
      state = engine.submit(state, l.find((x) => x.type === 'endPhase') ?? l[0]!).state;
    }
    const gavin = todo.find((p) => p.tags['entryEdge'] === 'N,E')!;
    const start = engine.legalActions(state, 'am').find((x) => x.type === 'move.start' && (x['units'] as string[]).includes(gavin.id))!;
    state = engine.submit(state, { ...start, units: [gavin.id] }).state;
    const steps = engine.legalActions(state, 'am').filter((x) => x.type === 'move.step').map((x) => x['to']);
    expect(steps).toContain('yGG4');
    expect(steps).not.toContain('yGG5');
  });
});
