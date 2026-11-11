import { Layer, type QueryEnv, type RuleModule } from '@asl/engine';
import { defOf, statics } from '../common/pieces';
import { mmc, pieceOf, smc } from '../sk1/status';
import type { SetupAction } from '../sk1/scenario';
import { gunsOf } from './status';

/*
 * Scenario special rules the SK2 cards use, as general modules switched on by a scenario's `ssr`
 * list; their parameters are read from the scenario at query time (so the ruleset hash is the
 * same whichever scenario installs them).
 */

export interface NoCowerParams {
  side: string;
  /** The side's crews do not cower. */
  crews?: boolean;
  /** Counter defs that do not cower (e.g. the Australian 1st Line 4-5-7 and 2-4-7 of S13). */
  defs?: string[];
  /** MMC of these qualities do not cower (S23: "Elite and 1st Line British MMC": ['E', '1']). */
  qualities?: string[];
}

/** S13 SSR 3: "British crews and Australian First Line units do not cower (3.2.2)". */
export const noCowerModule: RuleModule = {
  id: 'ssr.no-cower',
  summary: 'Listed units of a side do not cower (SSR).',
  requires: ['sk1.fire'],
  install(r) {
    r.contribute({
      id: 'ssr.no-cower.apply',
      query: 'fire.cowerShift',
      layer: 950,
      label: 'no cowering (SSR)',
      when({ attack }, env) {
        const rules = statics(env).scenario.ssr.filter((s) => s.module === 'no-cower').map((s) => s.params as unknown as NoCowerParams);
        const firers = attack.parts.map((p) => pieceOf(env, p.firer)).filter((p) => mmc(env, p));
        if (firers.length === 0) return false;
        return firers.every((p) =>
          rules.some((q) => q.side === p.side && ((q.crews && mmc(env, p)?.kind === 'crew') || q.defs?.includes(p.defId) || q.qualities?.includes(mmc(env, p)!.quality))),
        );
      },
      apply: () => 0,
    });
  },
};

export interface CrossNationalityLeadershipParams {
  side: string;
  /** DRM added when a leader rallies or directs a unit of another counter nationality. */
  add: number;
}

/** S13 SSR 1: "Allied Leaders incur a +1 DRM penalty when attempting to rally or direct units of a different nationality". */
export const crossNationalityLeadershipModule: RuleModule = {
  id: 'ssr.cross-nationality-leadership',
  summary: 'Leaders of a mixed side pay a DRM to rally or direct units of another nationality (SSR).',
  requires: ['sk1.rally', 'sk1.fire'],
  install(r) {
    const penalty = (env: QueryEnv, side: string): number =>
      statics(env)
        .scenario.ssr.filter((s) => s.module === 'cross-nationality-leadership')
        .map((s) => s.params as unknown as CrossNationalityLeadershipParams)
        .filter((q) => q.side === side)
        .reduce((a, q) => a + q.add, 0);
    const differ = (env: QueryEnv, leader: string, unit: string) =>
      defOf(env, pieceOf(env, leader)).nationality !== defOf(env, pieceOf(env, unit)).nationality;
    r.contribute({
      id: 'ssr.cross-nationality.rally',
      query: 'rally.drm',
      label: (_c, env) => `+${penalty(env, _c.leader ? pieceOf(env, _c.leader).side : '')} rallying another nationality (SSR)`,
      when: ({ unit, leader, self }, env) => !!leader && !self && penalty(env, pieceOf(env, leader).side) !== 0 && differ(env, leader, unit),
      apply: (v, { leader }, env) => v + penalty(env, pieceOf(env, leader!).side),
    });
    r.contribute({
      id: 'ssr.cross-nationality.fire',
      query: 'fire.drm',
      label: ({ attack }, env) => `+${penalty(env, attack.side)} directing another nationality (SSR)`,
      when: ({ attack }, env) =>
        !!attack.directors?.length &&
        penalty(env, attack.side) !== 0 &&
        attack.directors.some((d) => attack.parts.some((p) => mmc(env, pieceOf(env, p.firer)) && differ(env, d, p.firer))),
      apply: (v, { attack }, env) => v + penalty(env, attack.side),
    });
    r.contribute({
      id: 'ssr.cross-nationality.tohit',
      query: 'ordnance.thDrm',
      label: (sc, env) => `+${penalty(env, sc.side)} directing another nationality (SSR)`,
      when: (sc, env) => sc.shot.director !== undefined && !!smc(env, pieceOf(env, sc.shot.director)) && penalty(env, sc.side) !== 0 && differ(env, sc.shot.director, sc.firer),
      apply: (v, sc, env) => v + penalty(env, sc.side),
    });
  },
};

export interface NoHipParams {
  /** The side whose Guns may not use HIP; every side when omitted. */
  side?: string;
  /**
   * Its units rather than its Guns: no unit of the side sets up hidden (S67 SSR 2: "Japanese HIP (8.1.8.5) is NA", the
   * Japanese 10%); its Guns keep their own HIP (6.4).
   */
  units?: boolean;
}

/** S13 SSR 2: "Guns may not use HIP (6.4)". */
export const noHipModule: RuleModule = {
  id: 'ssr.no-hip',
  summary: 'Guns may not use Hidden Initial Placement (SSR).',
  requires: ['sk2.guns'],
  install(r) {
    r.contribute({
      id: 'ssr.no-hip.apply',
      query: 'hip.allowed',
      layer: 900,
      label: 'no HIP (SSR)',
      when: ({ gun }, env) => {
        const side = env.state.pieces[gun]?.side;
        return statics(env).scenario.ssr.some((s) => s.module === 'no-hip' && !(s.params as NoHipParams | undefined)?.units && (!(s.params as NoHipParams | undefined)?.side || (s.params as NoHipParams).side === side));
      },
      apply: () => false,
    });
    r.contribute({
      id: 'ssr.no-hip.units',
      query: 'hiddenUnits.params',
      layer: 900,
      apply: (v, _c, env) =>
        v && statics(env).scenario.ssr.some((s) => s.module === 'no-hip' && (s.params as NoHipParams | undefined)?.units && (!(s.params as NoHipParams).side || (s.params as NoHipParams).side === v.side)) ? null : v,
    });
  },
};

export const HIP_REQUIRED_MODULE = 'hip-required';

export interface HipRequiredParams {
  /** The side whose Guns must set up hidden. */
  side: string;
  /** The Gun counters that must (every Gun of the side when omitted). */
  defs?: string[];
  /** The card's name for the rule, e.g. 'SSR 1'. */
  rule?: string;
}

const hipRequired = (env: QueryEnv, gunId: string): HipRequiredParams | null => {
  const g = env.state.pieces[gunId];
  if (!g) return null;
  for (const s of statics(env).scenario.ssr) {
    if (s.module !== HIP_REQUIRED_MODULE) continue;
    const p = s.params as unknown as HipRequiredParams;
    if (p.side === g.side && (!p.defs || p.defs.includes(g.defId))) return p;
  }
  return null;
};

/**
 * LMA2 SSR 1: "the German AT Gun is set up HIP in a single-hex building". A Gun the card puts in Hidden Initial
 * Placement (SK4 6.4) must use it: a setup that leaves it in the open is refused, and the default placement hides it.
 */
export const hipRequiredModule: RuleModule = {
  id: 'ssr.hip-required',
  summary: 'Listed Guns must set up using Hidden Initial Placement (SSR).',
  requires: ['sk2.guns'],
  install(r) {
    r.contribute({
      id: 'ssr.hip-required.illegal',
      query: 'setup.illegal',
      layer: 900,
      apply(v, { todo, action }, env) {
        if (v) return v;
        const a = action as SetupAction;
        for (const id of todo) {
          if (!a.placements[id]) continue;
          for (const g of gunsOf(env)) {
            const by = a.sw?.[g.id] ?? (g.loc.kind === 'held' ? g.loc.by : null);
            if (by !== id) continue;
            const p = hipRequired(env, g.id);
            if (p && !a.guns?.[g.id]?.hip) return `${defOf(env, g).id.replace(/^\w+\./, '')} must set up hidden (HIP${p.rule ? `, ${p.rule}` : ''})`;
          }
        }
        return null;
      },
    });
    r.contribute({
      id: 'ssr.hip-required.defaults',
      query: 'setup.defaults',
      layer: 900,
      apply(v, { placements }, env) {
        const guns = v.guns as Record<string, { ca: number; hip?: boolean }> | undefined;
        if (!guns) return v;
        const out = { ...guns };
        for (const id of Object.keys(guns)) {
          const g = env.state.pieces[id];
          const holder = g?.loc.kind === 'held' ? g.loc.by : null;
          const hex = holder ? placements[holder] : undefined;
          if (hipRequired(env, id) && hex && env.query('hip.allowed', { gun: id, hex }, false)) out[id] = { ...out[id]!, hip: true };
        }
        return { ...v, guns: out };
      },
    });
  },
};

export interface SeasonOverrideParams {
  /** Grain is in season whatever the month (true) or out of season (false). */
  grain?: boolean;
  /** Orchards are in season (hills' different-level LOS obstacle) whatever the month. */
  orchard?: boolean;
}

/** S13 SSR 4: "Grain is in season" (in April). */
export const seasonOverrideModule: RuleModule = {
  id: 'ssr.season-override',
  summary: 'Grain (or orchards) in or out of season regardless of the month (SSR).',
  requires: ['sk1.terrain'],
  install(r) {
    const grain = (env: QueryEnv): boolean | undefined => {
      let out: boolean | undefined;
      for (const s of statics(env).scenario.ssr) if (s.module === 'season-override') out = (s.params as SeasonOverrideParams | undefined)?.grain ?? out;
      return out;
    };
    // In season by SSR: the month rule that turns grain into Open Ground is switched off.
    r.suppress({
      id: 'ssr.season-override.grain-in',
      query: 'hex.terrain',
      target: 'sk1.terrain.grain-season',
      label: 'grain is in season (SSR)',
      when: (_c, env) => grain(env) === true,
    });
    // Out of season by SSR: grain plays as Open Ground whatever the month.
    r.contribute({
      id: 'ssr.season-override.grain-out',
      query: 'hex.terrain',
      label: 'grain out of season (SSR)',
      when: ({ hex }, env) => grain(env) === false && statics(env).map.hex(hex)?.terrain === 'grain',
      apply: () => 'open',
    });
  },
};

/** Whether a scenario's orchards are in season (April–October, or as an SSR says). */
export function orchardsInSeason(env: QueryEnv): boolean {
  for (const s of statics(env).scenario.ssr) {
    const p = s.module === 'season-override' ? (s.params as SeasonOverrideParams | undefined) : undefined;
    if (p?.orchard !== undefined) return p.orchard;
  }
  const m = statics(env).scenario.month;
  return m >= 4 && m <= 10;
}

export interface RainParams {
  /** "no Smoke can be placed": no Smoke grenades, no Smoke or WP ordnance. */
  noSmoke?: boolean;
  /** Extra MF per elevation change (up or down), unless the step follows a paved road. */
  elevationMf?: number;
}

/** S16 SSR 1: "Due to the rain, no Smoke can be placed and all units must expend one extra MF per elevation change (up/down) unless using a paved road." */
export const rainModule: RuleModule = {
  id: 'ssr.rain',
  summary: 'Rain (SSR): no Smoke can be placed; extra MF per elevation change except along a paved road.',
  requires: ['sk1.movement', 'sk2.ordnance'],
  install(r) {
    const rules = (env: QueryEnv) => statics(env).scenario.ssr.filter((s) => s.module === 'rain').map((s) => s.params as unknown as RainParams);
    const extraMf = (env: QueryEnv) => rules(env).reduce((a, p) => a + (p.elevationMf ?? 0), 0);
    r.contribute({
      id: 'ssr.rain.no-smoke',
      query: 'unit.smoke',
      layer: Layer.Clamp,
      label: 'no Smoke in the rain (SSR)',
      when: (_c, env) => rules(env).some((p) => p.noSmoke),
      apply: () => 0,
    });
    r.contribute({
      id: 'ssr.rain.no-smoke-ammo',
      query: 'ammo.denied',
      layer: 0,
      when: ({ kind }, env) => (kind === 'SMOKE' || kind === 'WP') && rules(env).some((p) => p.noSmoke),
      apply: () => 'No Smoke can be placed in the rain (SSR)',
    });
    r.contribute({
      id: 'ssr.rain.elevation-mf',
      query: 'move.cost',
      layer: Layer.Add,
      label: '+1 MF elevation change in the rain (SSR)',
      when: ({ from, to, viaRoad }, env) => {
        if (!from || extraMf(env) === 0) return false;
        const map = statics(env).map;
        const level = (h: string) => map.hex(h)?.elevation ?? map.offboardHex(h)?.elevation ?? 0;
        if (level(from) === level(to)) return false;
        return !(viaRoad && (map.hex(to)?.features ?? []).includes('road:paved'));
      },
      apply: (v, _c, env) => v + extraMf(env),
    });
  },
};

export interface AssaultFireParams {
  side: string;
  /** Squad counters granted Assault Fire capability (e.g. the German 4-4-7 of S16). */
  defs: string[];
}

/** S16 SSR 3: "German 4-4-7 squads have Assault Fire capability." */
export const assaultFireModule: RuleModule = {
  id: 'ssr.assault-fire',
  summary: 'Listed squads of a side have Assault Fire capability (SSR).',
  requires: ['sk1.fire'],
  install(r) {
    r.contribute({
      id: 'ssr.assault-fire.apply',
      query: 'unit.assaultFire',
      layer: 10,
      label: 'Assault Fire (SSR)',
      when({ unit }, env) {
        const p = pieceOf(env, unit);
        return statics(env).scenario.ssr.some((s) => {
          if (s.module !== 'assault-fire') return false;
          const q = s.params as unknown as AssaultFireParams;
          return q.side === p.side && q.defs.includes(p.defId);
        });
      },
      apply: () => true,
    });
  },
};

export interface LeaderDirectsGunParams {
  side: string;
  /** Leader counter defs that may direct, e.g. ['br.L91']. */
  leaders: string[];
  /** Gun counter defs they may direct, e.g. ['br.AT57L']. */
  guns: string[];
}

/**
 * S23 SSR 2: "The 9-1 British SMC may use his leadership DRM to modify the TH DR of a 6-pdr AT gun,
 * as if it were a SW, when he is stacked with the manning crew." Normally a leader modifies only an
 * ordnance SW's To Hit DR (ASL A7.531). The usual direction rules (in the Gun's hex, Good Order and
 * unpinned, marked as having fired) still apply.
 */
export const leaderDirectsGunModule: RuleModule = {
  id: 'ssr.leader-directs-gun',
  summary: 'A named leader may modify a named Gun’s To Hit DR as if it were a SW, stacked with its manning crew (SSR).',
  requires: ['sk2.ordnance'],
  install(r) {
    r.contribute({
      id: 'ssr.leader-directs-gun.allow',
      query: 'ordnance.leaderDirects',
      layer: 10,
      apply(v, { weapon, leader }, env) {
        if (v) return v;
        const g = env.state.pieces[weapon];
        const l = env.state.pieces[leader];
        if (!g || !l || g.loc.kind !== 'held') return v;
        const crew = pieceOf(env, g.loc.by);
        if (mmc(env, crew)?.kind !== 'crew') return v;
        return statics(env)
          .scenario.ssr.filter((s) => s.module === 'leader-directs-gun')
          .some((s) => {
            const q = s.params as unknown as LeaderDirectsGunParams;
            return q.side === g.side && q.leaders.includes(l.defId) && q.guns.includes(g.defId);
          });
      },
    });
  },
};
