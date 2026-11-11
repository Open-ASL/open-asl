import type { Ctx, QueryEnv, RuleModule } from '@asl/engine';
import { statics } from '../common/pieces';
import type { Ground, Sky, Weather, WindForce, WindFrom } from '../common/statics';

/*
 * Weather (ASL E3, in outline). Every game has weather: the card's, or the default of a clear
 * sky, dry ground and a mild breeze from the west. It lives in the game state, the HUD shows it,
 * and rules change it (a scenario's "snow begins falling" special rule, later the full ASL
 * weather tables). The Starter Kit has no weather of its own, so the only effect enforced here is
 * the one its cards state: Falling Snow is a +1 Hindrance to attacks at six or more hexes (S4
 * SSR 1), which like any Hindrance also denies FFMO (SK1 3.3.1). Rain, fog, mist, mud and wind
 * are kept and shown but their full ASL effects are not yet applied.
 */

export const WEATHER_EXT = 'weather';

export const DEFAULT_WEATHER: Weather = { sky: 'clear', ground: 'normal', wind: { from: 'W', force: 'breeze' } };

/** The weather now: the state's, or the scenario's start weather before the game begins. */
export function weatherOf(env: QueryEnv): Weather {
  return (env.state.ext[WEATHER_EXT] as Weather | undefined) ?? startWeather(env);
}

export function startWeather(env: QueryEnv): Weather {
  const w = statics(env).scenario.weather;
  return { ...DEFAULT_WEATHER, ...w, wind: { ...DEFAULT_WEATHER.wind, ...w?.wind } };
}

export const SKY_NAME: Record<Sky, string> = { clear: 'Clear', overcast: 'Overcast', rain: 'Rain', fallingSnow: 'Falling Snow', fog: 'Fog', mist: 'Mist' };
export const GROUND_NAME: Record<Ground, string> = { normal: 'dry ground', mud: 'Mud', snow: 'Ground Snow' };
export const WIND_FORCE_NAME: Record<WindForce, string> = { calm: 'no wind', breeze: 'mild breeze', heavy: 'heavy winds', gusts: 'gusts' };
export const WIND_FROM_NAME: Record<WindFrom, string> = { N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west' };

/** "Falling Snow · Ground Snow · mild breeze from the west". */
export function weatherLabel(w: Weather): string {
  const parts = [SKY_NAME[w.sky]];
  if (w.ground !== 'normal') parts.push(GROUND_NAME[w.ground]);
  parts.push(w.wind.force === 'calm' ? WIND_FORCE_NAME.calm : `${WIND_FORCE_NAME[w.wind.force]} from the ${WIND_FROM_NAME[w.wind.from]}`);
  return parts.join(' · ');
}

/** Falling Snow is a +1 Hindrance to attacks from six or more hexes away (S4 SSR 1; ASL E3.71 in outline). */
export const SNOW_HINDRANCE_RANGE = 6;
const snowHinders = (env: QueryEnv, parts: { dist: number }[]) => weatherOf(env).sky === 'fallingSnow' && parts.some((p) => p.dist >= SNOW_HINDRANCE_RANGE);

export const weatherModule: RuleModule = {
  id: 'sk1.weather',
  ref: 'ASL E3',
  summary: 'Weather: sky, ground and wind in the game state; Falling Snow hinders long-range fire.',
  requires: ['sk1.fire'],
  install(r) {
    r.event<{ weather: Weather; reason?: string }>({
      type: 'weather.changed',
      apply(d, p) {
        d.ext[WEATHER_EXT] = p.weather;
      },
    });
    r.setup({
      id: 'sk1.weather.start',
      priority: -10,
      run(ctx) {
        ctx.emit('weather.changed', { weather: startWeather(ctx), reason: 'start' });
      },
    });
    r.contribute({
      id: 'sk1.weather.fallingSnow',
      query: 'fire.drm',
      ref: 'S4 SSR 1',
      label: `+1 Falling Snow (${SNOW_HINDRANCE_RANGE}+ hexes)`,
      when: ({ attack }, env) => snowHinders(env, attack.parts),
      apply: (v) => v + 1,
    });
    // A Hindrance of any kind denies FFMO (SK1 3.3.1).
    r.suppress({
      id: 'sk1.weather.noFfmo',
      query: 'fire.drm',
      target: 'sk1.drm.ffmo',
      label: 'Falling Snow hinders',
      when: ({ attack }, env) => snowHinders(env, attack.parts),
    });
  },
};

// ---------------------------------------------------------------- SSR: weather that comes and goes by DR

export const WEATHER_DR_MODULE = 'weather-dr';

export interface WeatherDrParams {
  /** The sky condition the DR brings on and takes away (e.g. 'fallingSnow'). */
  sky: Sky;
  /** A DR of at least this begins it... */
  startOn: number;
  /** ...and, once it is on, a DR of at most this ends it. */
  stopOn: number;
}

export function weatherDrParams(env: QueryEnv): WeatherDrParams | null {
  const s = statics(env).scenario.ssr.find((r) => r.module === WEATHER_DR_MODULE);
  return s ? (s.params as unknown as WeatherDrParams) : null;
}

/**
 * "Each Rally Phase the ATTACKER makes a DR. If the DR is ≥ 10, snow begins falling; if it is
 * currently snowing and the DR is ≤ 3 then it stops snowing." (S4 SSR 1) as a general rule: the
 * sky condition and both thresholds come from the scenario's parameters.
 */
export const weatherDrModule: RuleModule = {
  id: 'ssr.weather-dr',
  ref: 'SK S4 SSR 1',
  summary: 'Weather that begins or ends on the attacker’s Rally Phase DR (SSR).',
  requires: ['sk1.weather', 'sk1.rally'],
  install(r) {
    r.event<{ dr: number; sky: Sky; change: 'begins' | 'ends' | null }>({ type: 'weather.dr', apply() {} });
    r.on<{ phase: string }>({
      id: 'ssr.weather-dr.rph',
      event: 'turn.phaseStarted',
      handler(ctx: Ctx, ev) {
        if (ev.payload.phase !== 'RPh') return;
        const p = weatherDrParams(ctx);
        if (!p) return;
        const w = weatherOf(ctx);
        const on = w.sky === p.sky;
        const dr = ctx.roll(`Weather DR (${SKY_NAME[p.sky]})`).total;
        const change: 'begins' | 'ends' | null = !on && dr >= p.startOn ? 'begins' : on && dr <= p.stopOn ? 'ends' : null;
        ctx.emit('weather.dr', { dr, sky: p.sky, change });
        if (change === 'begins') ctx.emit('weather.changed', { weather: { ...w, sky: p.sky }, reason: 'dr' });
        if (change === 'ends') ctx.emit('weather.changed', { weather: { ...w, sky: startWeather(ctx).sky === p.sky ? 'clear' : startWeather(ctx).sky }, reason: 'dr' });
      },
    });
  },
};
