import { describe, expect, it } from 'vitest';
import { statics } from '../src';
import { GE_VS_BR, act, makeEngine } from './fixtures';

describe('Smoke along a hexside (ASLRB A24.2, B.6)', () => {
  const game = (markers: Record<string, Record<string, unknown>>) => {
    const { engine, state } = makeEngine({ scenario: GE_VS_BR, pieces: [{ id: 'e1', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
    const env = engine.env({ ...state, hexMarkers: { ...state.hexMarkers, ...markers } } as typeof state);
    return { env, los: (from: string, to: string) => env.query('los.trace', { from, to }, { clear: true, hindrance: 0, parts: [] }) };
  };

  it('a LOS exactly along a hexside of a Smoke hex is hindered by it', () => {
    const { env, los } = game({ yM6: { smoke58: 'smoke', smoke58Disp: true } });
    // N6 to L6 runs along the hexside between M6 and its neighbour.
    expect(statics(env).map.lineSteps!('yN6', 'yL6')).toEqual([expect.arrayContaining(['yM6'])]);
    expect(statics(env).map.lineSteps!('yN6', 'yL6')[0]).toHaveLength(2);
    expect(los('yN6', 'yL6')).toMatchObject({ clear: true, hindrance: 2 });
  });

  it('Smoke on both sides of the hexside counts once, the larger DRM', () => {
    const { env, los } = game({});
    const [pair] = statics(env).map.lineSteps!('yN6', 'yL6');
    const both = game({ [pair![0]!]: { smoke58: 'smoke', smoke58Disp: true }, [pair![1]!]: { smoke58: 'smoke' } });
    expect(los('yN6', 'yL6').hindrance).toBe(0);
    expect(both.los('yN6', 'yL6').hindrance).toBe(3);
  });
});

// ASLRB A24.2: "the application of SMOKE Hindrance DRM is cumulative for each SMOKE counter" and any number may be
// placed in a hex, but one Location's SMOKE DRM is never more than +3; SK4 1.2.5 "up to a maximum of +3 per hex". The
// outgoing +1 comes on top (A24.8). A Smoke grenade counter is +2 (SK1 3.3, A24.5).
describe('Several Smoke counters in one hex (ASLRB A24.2, SK4 1.2.5)', () => {
  const game = (markers: Record<string, Record<string, unknown>>) => {
    const { engine, state } = makeEngine({ scenario: GE_VS_BR, pieces: [{ id: 'e1', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
    const env = engine.env({ ...state, hexMarkers: { ...state.hexMarkers, ...markers } } as typeof state);
    return { env, los: (from: string, to: string) => env.query('los.trace', { from, to }, { clear: true, hindrance: 0, parts: [] }) };
  };
  const base = game({}).los('yN6', 'yL6').hindrance;
  const pair = (env: ReturnType<typeof game>['env']) => statics(env).map.lineSteps!('yN6', 'yL6')[0]!;
  const through = (smoke: Record<string, unknown>) => {
    const { env } = game({});
    return game({ [pair(env)[0]!]: smoke }).los('yN6', 'yL6').hindrance - base;
  };

  it('one grenade counter is +2; two or more add up to the +3 cap', () => {
    expect(through({ smoke: 1 })).toBe(2);
    expect(through({ smoke: true })).toBe(2);
    expect(through({ smoke: 2 })).toBe(3);
    expect(through({ smoke: 4 })).toBe(3);
  });

  it('a grenade counter adds to a ⅝" counter, still at most +3', () => {
    expect(through({ smoke: 1, smoke58: 'wp', smoke58Disp: true })).toBe(3);
    expect(through({ smoke: 1, smoke58: 'smoke' })).toBe(3);
  });

  it('⅝" counters add up too: two Dispersed Smoke +2 make +3, two Dispersed WP +1 make +2', () => {
    expect(through({ smoke58: 'smoke.d@ge' })).toBe(2);
    expect(through({ smoke58: 'smoke.d@ge,smoke.d@br' })).toBe(3);
    expect(through({ smoke58: 'wp.d@ge,wp.d@br' })).toBe(2);
    expect(through({ smoke58: 'wp.d@ge,wp.d@br,wp.d@ge' })).toBe(3);
  });

  it('firing out of the hex adds +1 beyond the cap (A24.8)', () => {
    const one = game({ yN6: { smoke: 1 } }).los('yN6', 'yL6').hindrance;
    const four = game({ yN6: { smoke: 4 } }).los('yN6', 'yL6').hindrance;
    expect(one - base).toBe(3);
    expect(four - base).toBe(4);
  });
});

describe('Smoke grenades placed by several units in one hex', () => {
  // German squads in yN6 Smoke yM6 one after the other; the British squad in yL6 is seen through it.
  const setup = () =>
    makeEngine({
      scenario: GE_VS_BR,
      startPhase: 'MPh',
      dice: [1, 1, 1],
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN6' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yN6' },
        { id: 'g3', def: 'ge.467', side: 'ge', hex: 'yN6' },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yA1' },
      ],
    });
  const smokeFrom = (engine: ReturnType<typeof setup>['engine'], s: ReturnType<typeof setup>['state'], unit: string, target: string) => {
    s = act(engine, s, { type: 'move.start', units: [unit] }).state;
    s = act(engine, s, { type: 'move.smoke', unit, target }).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    s = act(engine, s, { type: 'move.end' }).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    return s;
  };
  const hindrance = (engine: ReturnType<typeof setup>['engine'], s: ReturnType<typeof setup>['state']) =>
    engine.env(s).query('los.trace', { from: 'yL6', to: 'yN6' }, { clear: true, hindrance: 0, parts: [] }).hindrance;

  it('each success is another counter: +2, then +3, and +3 stays the most; all gone after the MPh', () => {
    const { engine, state } = setup();
    const target = statics(engine.env(state)).map.lineSteps!('yL6', 'yN6')[0]![0]!;
    const base = hindrance(engine, state);
    let s = smokeFrom(engine, state, 'g1', target);
    expect(s.hexMarkers[target]?.['smoke']).toBe(1);
    expect(hindrance(engine, s) - base).toBe(2);
    s = smokeFrom(engine, s, 'g2', target);
    expect(s.hexMarkers[target]?.['smoke']).toBe(2);
    expect(hindrance(engine, s) - base).toBe(3);
    s = smokeFrom(engine, s, 'g3', target);
    expect(s.hexMarkers[target]?.['smoke']).toBe(3);
    expect(hindrance(engine, s) - base).toBe(3);
    // SK1 3.3: grenade Smoke comes off at the end of the MPh, every counter of it.
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).not.toBe('MPh');
    expect(s.hexMarkers[target]?.['smoke']).toBeUndefined();
    expect(hindrance(engine, s)).toBe(base);
  });
});
