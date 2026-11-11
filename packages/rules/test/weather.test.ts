import { describe, expect, it } from 'vitest';
import type { Action, Ctx, GameState, RuleModule } from '@asl/engine';
import { DEFAULT_WEATHER, FP, WEATHER_DR_MODULE, weatherDrModule, weatherLabel, weatherOf, type FireAttackCtx, type FireDeclaration, type FireMode, type ResolveFireFn } from '../src';
import { act, makeEngine } from './fixtures';

/** Test-only actions: resolve a fire declaration; start another Rally Phase. */
const testMod: RuleModule = {
  id: 'test.weather',
  install(r) {
    r.action<Action & { decl: FireDeclaration; mode: FireMode }>({
      type: 'test.fire',
      decisionKinds: ['phase'],
      validate: (env, a) => env.query('fire.illegal', { decl: a.decl, mode: a.mode, side: a.side }, null),
      resolve(ctx: Ctx, a) {
        ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, a.mode);
      },
    });
    r.action<Action>({
      type: 'test.rph',
      decisionKinds: ['phase'],
      resolve(ctx: Ctx) {
        ctx.emit('turn.phaseStarted', { phase: 'RPh', turn: ctx.state.turn + 1, attacker: ctx.state.attacker });
      },
    });
  },
};

// a1 fires at g1 seven hexes away (A5 → H5), a2 at g2 from three (K5 → N5); every hex is open ground.
const pieces = [
  { id: 'a1', def: 'am.747', side: 'am', hex: 'yA5' },
  { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yH5' },
  { id: 'a2', def: 'am.666', side: 'am', hex: 'yK5' },
  { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yN5' },
];

const snowing = (state: GameState): GameState => ({ ...state, ext: { ...state.ext, weather: { ...DEFAULT_WEATHER, sky: 'fallingSnow' as const } } });

describe('weather', () => {
  it('is clear with a mild westerly breeze unless the card says otherwise', () => {
    const { engine, state } = makeEngine({ pieces, extra: [testMod] });
    expect(weatherOf(engine.env(state))).toEqual(DEFAULT_WEATHER);
    expect(weatherLabel(weatherOf(engine.env(state)))).toBe('Clear · mild breeze from the west');
    const { engine: e2, state: s2 } = makeEngine({ pieces, extra: [testMod], scenario: { weather: { sky: 'rain', ground: 'mud', wind: { from: 'NE', force: 'gusts' } } } });
    expect(weatherOf(e2.env(s2))).toEqual({ sky: 'rain', ground: 'mud', wind: { from: 'NE', force: 'gusts' } });
    expect(weatherLabel(weatherOf(e2.env(s2)))).toBe('Rain · Mud · gusts from the north-east');
  });

  it('Falling Snow is a +1 Hindrance to attacks from six or more hexes, and so denies FFMO', () => {
    const { engine, state } = makeEngine({ pieces, extra: [testMod], dice: [3, 3, 3, 3, 3, 3, 3, 3] });
    const s = snowing(state);
    const attackOf = (t: { events: { type: string; payload: unknown }[] }) => t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { drm: number; explain: { label?: string }[] };
    const far = act(engine, s, { type: 'test.fire', mode: 'prep', decl: { units: ['a1'], sw: [], target: 'yH5' } });
    expect(attackOf(far).drm).toBe(1);
    expect(attackOf(far).explain.map((n) => n.label)).toContain('+1 Falling Snow (6+ hexes)');
    const near = act(engine, s, { type: 'test.fire', mode: 'prep', decl: { units: ['a2'], sw: [], target: 'yN5' } });
    expect(attackOf(near).drm).toBe(0);
    // Not snowing: nothing.
    const dry = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1'], sw: [], target: 'yH5' } });
    expect(attackOf(dry).drm).toBe(0);
    // Defensive First Fire on a unit moving in the open at long range: FFNAM applies, FFMO does not.
    const env = engine.env(s);
    const attack: FireAttackCtx = { mode: 'first', side: 'am', target: 'yH5', parts: [{ piece: 'a1', firer: 'a1', kind: 'inherent', hex: 'yA5', range: 7, dist: 7 }], targets: ['g1'], moving: { assault: false, viaRoadIntoWoodsRoad: false }, hindrance: 0 };
    const res = env.explain('fire.drm', { attack }, 0);
    expect(res.value).toBe(0);
    expect(res.trace.find((t) => t.id === 'sk1.drm.ffnam')?.suppressedBy).toBeUndefined();
    expect(res.trace.find((t) => t.id === 'sk1.drm.ffmo')?.suppressedBy).toBe('sk1.weather.noFfmo');
    // Nearer than six hexes the snow does not hinder, so FFMO joins FFNAM.
    expect(env.explain('fire.drm', { attack: { ...attack, parts: [{ ...attack.parts[0]!, dist: 5 }] } }, 0).value).toBe(-2);
  });

  it('weather-dr (SSR): the attacker’s RPh DR brings the condition on at the start threshold and off at the stop threshold', () => {
    const scenario = { ssr: [{ module: WEATHER_DR_MODULE, params: { sky: 'fallingSnow', startOn: 10, stopOn: 3 } }] };
    // Turn 1 RPh: DR 9, nothing. Next RPh: DR 10, snow begins. Then DR 4 (stays), then DR 3 (stops).
    const { engine, state } = makeEngine({ pieces, extra: [weatherDrModule, testMod], scenario, startPhase: 'RPh', dice: [4, 5, 5, 5, 2, 2, 1, 2] });
    expect(weatherOf(engine.env(state)).sky).toBe('clear');
    const t1 = act(engine, state, { type: 'test.rph' });
    expect(t1.events.find((e) => e.type === 'weather.dr')!.payload).toMatchObject({ dr: 10, sky: 'fallingSnow', change: 'begins' });
    expect(weatherOf(engine.env(t1.state)).sky).toBe('fallingSnow');
    const t2 = act(engine, t1.state, { type: 'test.rph' });
    expect(t2.events.find((e) => e.type === 'weather.dr')!.payload).toMatchObject({ dr: 4, change: null });
    expect(weatherOf(engine.env(t2.state)).sky).toBe('fallingSnow');
    const t3 = act(engine, t2.state, { type: 'test.rph' });
    expect(t3.events.find((e) => e.type === 'weather.dr')!.payload).toMatchObject({ dr: 3, change: 'ends' });
    expect(weatherOf(engine.env(t3.state)).sky).toBe('clear');
  });
});
