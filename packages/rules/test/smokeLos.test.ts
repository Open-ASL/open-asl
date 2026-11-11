import { describe, expect, it } from 'vitest';
import { statics } from '../src';
import { GE_VS_BR, makeEngine } from './fixtures';

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
