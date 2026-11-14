import { describe, expect, it } from 'vitest';
import type { GameState } from '@asl/engine';
import { statics } from '@asl/rules';
import { DEMO_JUNGLE_SCENARIO, newGame } from '../src';

/**
 * AFV/Wreck LOS Hindrance (SK4 7.4.1): +1 to a same-level LOS through (not into or out of) a hex holding a wreck or a
 * non-Moving-Target AFV, friendly or enemy, unless the firer or the target cannot see that hex. The whole hex hinders:
 * the line need only pass through it, not over the counter or any hindering art. On board o (Demo 5) the CHI-HA stands
 * in the open village hex oZ7, and the line oAA9–oY7 passes through it.
 */
describe('AFV and wreck LOS Hindrance on the pixel map (SK4 7.4.1)', () => {
  const game = () => newGame(DEMO_JUNGLE_SCENARIO, 'jungle', { los: 'pixel' });
  const tank = (s: GameState) => Object.values(s.pieces).find((p) => p.defId === 'ja.ty97Bchiha')!;
  const withTank = (s: GameState, tags: Record<string, unknown>, hex = 'oZ7') => {
    const t = tank(s);
    return { ...s, pieces: { ...s.pieces, [t.id]: { ...t, loc: { kind: 'hex', hex }, tags: { ...t.tags, ...tags } } } } as GameState;
  };
  const trace = (engine: ReturnType<typeof game>['engine'], s: GameState, from: string, to: string) =>
    engine.env(s).query('los.trace', { from, to }, { clear: true, hindrance: 0, parts: [] });

  it('the line passes through the open hex oZ7, whose art does not hinder', () => {
    const { engine, state } = game();
    const map = statics(engine.env(state)).map;
    expect(map.lineSteps!('oAA9', 'oY7').flat()).toContain('oZ7');
    expect(map.hex('oZ7')!.terrain).toBe('open');
    expect(map.los('oAA9', 'oY7').crossed.map((c) => c.hex)).not.toContain('oZ7');
  });

  it('the CHI-HA in oZ7 hinders a shot oAA9 → oY7 +1, either way, though it is the firer’s own', () => {
    const { engine, state } = game();
    for (const [a, b] of [['oAA9', 'oY7'], ['oY7', 'oAA9']] as const) {
      const r = trace(engine, state, a, b);
      expect(r.clear).toBe(true);
      expect(r.parts).toEqual([expect.objectContaining({ hex: 'oZ7', drm: 1, label: '+1 vehicle hindrance' })]);
    }
  });

  it('its wreck hinders the same; a Moving Target does not; nor anything into or out of its hex', () => {
    const { engine, state } = game();
    expect(trace(engine, withTank(state, { wreck: true }), 'oAA9', 'oY7').parts).toEqual([expect.objectContaining({ hex: 'oZ7', label: '+1 wreck hindrance' })]);
    expect(trace(engine, withTank(state, { movingTarget: true }), 'oAA9', 'oY7').parts).toEqual([]);
    expect(trace(engine, state, 'oAA9', 'oZ7').parts.filter((p) => p.hex === 'oZ7')).toEqual([]);
    expect(trace(engine, state, 'oZ7', 'oY7').parts.filter((p) => p.hex === 'oZ7')).toEqual([]);
  });

  it('a vehicle hex the firer or the target cannot see does not hinder', () => {
    const { engine, state } = game();
    const env = engine.env(state);
    const map = statics(env).map;
    // A clear LOS through a hex one end of it cannot see (the thread to that hex's centre is blocked).
    const ids = [...map.hexes()].map((h) => h.id);
    let found: [string, string, string] | null = null;
    for (const a of ids) {
      for (const b of ids) {
        if (a >= b || map.distance(a, b) > 4 || !map.los(a, b).clear) continue;
        const hidden = map.lineSteps!(a, b).flat().find((h) => !map.los(a, h).clear || !map.los(b, h).clear);
        if (hidden && map.hex(hidden)!.elevation === map.hex(a)!.elevation && map.hex(a)!.elevation === map.hex(b)!.elevation) {
          found = [a, b, hidden];
          break;
        }
      }
      if (found) break;
    }
    expect(found).not.toBeNull();
    const [a, b, hidden] = found!;
    expect(trace(engine, withTank(state, { wreck: true }, hidden), a, b).parts.filter((p) => p.hex === hidden)).toEqual([]);
  });
});
