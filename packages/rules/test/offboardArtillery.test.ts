import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { artilleryCallIllegal, artilleryImpact, artilleryMissions, artilleryObservers, offboardArtilleryModule } from '../src/sk1/offboardArtillery';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/* LMA9 SSR 2: two off-board 120mm mortar missions, called by a leader at the start of the PFPh, landing in the AFPh. */

const oba = { module: 'offboard-artillery', params: { side: 'ge', label: '120mm Mortar', missions: 2, fp: 12, contact: 4, driftDrm: -2, rule: 'SSR 2' }, text: '' };
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const check = (engine: Engine, s: GameState, a: Record<string, unknown>) => engine.validate(s, { ...a, side: engine.currentDecision(s)!.owner, decisionId: engine.currentDecision(s)!.id } as never);
/** End phases until `phase` begins. */
function until(engine: Engine, state: GameState, phase: string) {
  let r = { state, events: [] as { type: string; payload: unknown }[] };
  const events: { type: string; payload: unknown }[] = [];
  for (let i = 0; i < 10 && r.state.phase !== phase; i++) {
    r = act(engine, r.state, { type: 'endPhase' }) as typeof r;
    events.push(...r.events);
  }
  return { state: r.state, events };
}

describe('Off-board artillery (SSR)', () => {
  const pieces: PieceSpec[] = [
    { id: 'gl', def: 'ge.L91', side: 'ge', hex: 'yM2' },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yM6' },
    { id: 'r0', def: 'ru.447', side: 'ru', hex: 'yM5' },
    { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yM7' },
    { id: 'r2', def: 'ru.447', side: 'ru', hex: 'yM8' },
  ];
  const game = (dice: number[], extra: PieceSpec[] = []) =>
    makeEngine({ pieces: [...pieces, ...extra], scenario: { ...RU_VS_GE, firstSide: 'ge', ssr: [oba] }, extra: [offboardArtilleryModule], startPhase: 'PFPh', dice });

  it('a leader with a LOS calls a mission at the start of the PFPh; contact on dr ≤ 4; he is marked Prep Fire', () => {
    const { engine, state } = game([3]);
    const env = engine.env(state);
    expect(artilleryMissions(env, 'ge')).toMatchObject({ left: 2, total: 2, pending: null });
    expect(artilleryMissions(env, 'ru')).toBeNull();
    expect(artilleryObservers(env, 'ge', 'yM5').map((p) => p.id)).toEqual(['gl']);
    const r = act(engine, state, { type: 'ssr.oba', hex: 'yM5', observer: 'gl' });
    expect(ev(r, 'ssr.oba.contact')[0]).toMatchObject({ dr: 3, contact: true, left: 1, hex: 'yM5' });
    expect(r.state.pieces['gl']!.tags['fire']).toBe('prep');
    expect(artilleryMissions(engine.env(r.state), 'ge')).toMatchObject({ left: 1, pending: { target: 'yM5', observer: 'gl' } });
    expect(check(engine, r.state, { type: 'ssr.oba', hex: 'yM6', observer: 'gl' })).toMatch(/already on its way/);
  });

  it('no contact on dr 5-6: the mission is kept for a later PFPh; one attempt per PFPh', () => {
    const { engine, state } = game([5]);
    const r = act(engine, state, { type: 'ssr.oba', hex: 'yM5', observer: 'gl' });
    expect(ev(r, 'ssr.oba.contact')[0]).toMatchObject({ dr: 5, contact: false, left: 2 });
    expect(r.state.pieces['gl']!.tags['fire']).toBe('prep');
    expect(artilleryCallIllegal(engine.env(r.state), 'ge', 'yM5')).toMatch(/One contact attempt per Prep Fire Phase|Good Order leader/);
  });

  it('only before any fire in the PFPh, only by the side the rule names, only with a Good Order leader', () => {
    const { engine, state } = game([6, 6]);
    expect(check(engine, state, { type: 'ssr.oba', hex: 'yM5', observer: 'g1' })).toMatch(/Good Order leader/);
    const fired = act(engine, state, { type: 'fire', decl: { target: 'yM5', units: ['g1'], sw: [], directors: [] } } as never);
    expect(artilleryCallIllegal(engine.env(fired.state), 'ge', 'yM7')).toMatch(/before any fire/);
    const broken = engine.env({ ...state, pieces: { ...state.pieces, gl: { ...state.pieces['gl']!, tags: { broken: true } } } });
    expect(artilleryCallIllegal(broken, 'ge', 'yM5')).toMatch(/No Good Order leader/);
    expect(artilleryCallIllegal(engine.env(state), 'ru', 'yM5')).toMatch(/No special rule/);
  });

  it('lands at the start of the AFPh: drift by dr -2 and direction, 12 FP on each Location with units in the seven hexes', () => {
    // Contact 1; drift dr 4 → 2 hexes, direction 4 = south: M5 → M7. Then one DR per hex with units: M7, M6 (north), M8 (south).
    const { engine, state } = game([1, 4, 4, 1, 1, 1, 1, 1, 1]);
    const called = act(engine, state, { type: 'ssr.oba', hex: 'yM5', observer: 'gl' });
    const { state: afph, events } = until(engine, called.state, 'AFPh');
    const landed = ev({ events }, 'ssr.oba.landed')[0]!;
    expect(landed).toMatchObject({ target: 'yM5', landing: 'yM7', distance: 2, direction: 4, dr: 4 });
    expect(landed['hexes']).toHaveLength(7);
    expect([...(landed['hexes'] as string[])].sort()).toEqual(['yL6', 'yL7', 'yM6', 'yM7', 'yM8', 'yN6', 'yN7'].sort());
    const attacks = ev({ events }, 'sk1.fire.attack').map((a) => (a['attack'] as { target: string }).target);
    expect(attacks).toEqual(['yM7', 'yM6', 'yM8']);
    // Friend and foe alike; the target hex itself is outside the blast.
    expect(afph.pieces['r0']!.loc.kind).toBe('hex');
    expect(afph.pieces['r0']!.tags['broken']).toBeUndefined();
    for (const id of ['r1', 'r2', 'g1']) expect(afph.pieces[id]!.loc.kind === 'eliminated' || !!afph.pieces[id]!.tags['broken']).toBe(true);
    const env = engine.env(afph);
    expect(artilleryMissions(env, 'ge')).toMatchObject({ left: 1, pending: null });
    expect(artilleryImpact(env, 'ge')).toMatchObject({ target: 'yM5', landing: 'yM7' });
  });

  it('a drift dr of 1 or 2 is 0: the target hex is hit, with no direction roll', () => {
    const { engine, state } = game([2, 2, 6, 6]);
    const called = act(engine, state, { type: 'ssr.oba', hex: 'yM5', observer: 'gl' });
    const { events } = until(engine, called.state, 'AFPh');
    expect(ev({ events }, 'ssr.oba.landed')[0]).toMatchObject({ landing: 'yM5', distance: 0 });
    expect(ev({ events }, 'ssr.oba.landed')[0]!['direction']).toBeUndefined();
  });
});
