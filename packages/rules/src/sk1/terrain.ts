import type { HexId, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { statics } from '../common/pieces';
import type { TerrainDef } from '../common/statics';
import { hexOfLoc, type LocId } from '../common/location';

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Effective terrain id of a hex (e.g. grain out of season becomes open ground). */
    /** The terrain of a hex; `loc` names a Location of it other than ground level (a cave, S70 SSR 2), when asked for one. */
    'hex.terrain': { ctx: { hex: HexId; loc?: LocId }; value: string };
    /** Base TEM of a Location for fire attacks into it (`hex` is a LocId: the hex id at ground level). */
    'hex.tem': { ctx: { hex: LocId }; value: number };
    /** Whether the Location counts as Open Ground for FFMO/Interdiction (before LOS hindrance); `hex` is a LocId. */
    'hex.openGround': { ctx: { hex: LocId }; value: boolean };
    /** Infantry MF to enter `to` from `from`. */
    /** `loc`: the Location entered in `to` when it is not the ground level (an upper floor, a cave). */
    'move.cost': { ctx: { unit: PieceId; from: HexId | null; to: HexId; viaRoad: boolean; loc?: LocId }; value: number };
    /**
     * Whether roads give their road movement rate (the Infantry road bonus, a vehicle's road MP): true unless a rule
     * treats them as Open Ground (LMA5 SSR 3: snow-covered roads).
     */
    'move.roadRate': { ctx: Record<string, never>; value: boolean };
    /** Whether a map hex is in play: true unless a rule shrinks the playing area during the game (S36). */
    'hex.inPlay': { ctx: { hex: HexId }; value: boolean };
    /**
     * Full LOS evaluation between two Locations including counters (Smoke). `noSmoke`: as if there were no
     * Smoke (S22's victory conditions: "a LOS (disregarding Smoke hindrances)"). `from`/`to` are LocIds
     * (a hex id is the ground Location); outside full ASL's LOS with heights it is traced between their hexes.
     * `fromAt`/`toAt` (full ASL only): a corner or hexside point of that end's hex instead of its centre dot (Bypass,
     * ASLRB A4.34; the A4.132 road point). The Starter Kit never sets them.
     */
    'los.trace': { ctx: { from: LocId; to: LocId; noSmoke?: boolean; fromAt?: LosPoint; toAt?: LosPoint }; value: LosTrace };
  }
}

/** A point of a hex other than its centre dot: a corner (0–5) or a hexside's road point (see `LosEnd`). */
export interface LosPoint {
  vertex?: number;
  side?: number;
}

export interface LosTrace {
  clear: boolean;
  /** Total LOS Hindrance DRM (terrain + Smoke). */
  hindrance: number;
  /** Labelled components of the hindrance DRM; `terrain` names the hindering terrain (not set for Smoke). */
  parts: { label: string; hex: HexId; drm: number; terrain?: string }[];
  /** Why the LOS is blocked, if it is. */
  blockedBy?: string;
  /** Blocked only just (see LosResult.near): fire may still be declared along it, and wasted. */
  near?: boolean;
  /** Where the thread met the obstacle, in map pixels, when the LOS data knows (see LosResult.blockedAt). */
  blockedAt?: { x: number; y: number };
  /** The end hexes whose woods depiction the thread crosses (see LosResult.woods). */
  woods?: HexId[];
  /** The end Orchard-Road hexes in which the thread leaves the road (see LosResult.orchard). */
  orchard?: HexId[];
}

export const terrainOf = (env: QueryEnv, loc: HexId | LocId): TerrainDef => {
  // A Location is in its hex's terrain (an upper building level is in the building).
  const hex = hexOfLoc(loc);
  // An offboard hex is Open Ground unless the map gives it its printed terrain (SSR "off-board terrain exists").
  const map = statics(env).map;
  const id = env.query('hex.terrain', { hex, ...(loc !== hex ? { loc } : {}) }, map.hex(hex)?.terrain ?? map.offboardHex(hex)?.terrain ?? 'open');
  const t = statics(env).terrain[id];
  if (!t) throw new Error(`Unknown terrain "${id}" in ${hex}`);
  return t;
};

export const hasFeature = (env: QueryEnv, hex: HexId, f: string) =>
  statics(env).map.hex(hex)?.features.some((x) => x === f || x.startsWith(`${f}:`)) ?? false;

export const isRoadHex = (env: QueryEnv, hex: HexId) => hasFeature(env, hex, 'road');
/** Whether a map hex is in play (S36: the boards a secret game length leaves out are not). */
export const inPlay = (env: QueryEnv, hex: HexId) => env.query('hex.inPlay', { hex }, true);
export const isWoodsRoad = (env: QueryEnv, hex: HexId) => hasFeature(env, hex, 'woods-road');
/** A tree-lined road: an orchard hex with a road (SK4 1.1.1 Orchard-Road, ASLRB B14.6). */
export const isOrchardRoad = (env: QueryEnv, hex: HexId) => hasFeature(env, hex, 'orchard-road');

/** Is it grain season (June–September)? */
export const grainInSeason = (env: QueryEnv) => {
  const m = statics(env).scenario.month;
  return m >= 6 && m <= 9;
};

/**
 * Smoke counters in a hex (SK1 3.3, SK4 1.2.5): `smoke` is the ½" grenade counter (MPh only); `smoke58` the ⅝"
 * Ordnance and vehicle counters (see `smoke58Counters`). Older states held one ⅝" counter as `smoke58` ('smoke' or
 * 'wp') with `smoke58Disp` its Dispersed side and `smoke58Side` the side that placed it.
 */
export const SMOKE58 = { kind: 'smoke58', dispersed: 'smoke58Disp', side: 'smoke58Side' } as const;

/** One ⅝" Smoke or WP counter: it disperses at the start of the placing side's next PFPh (SK4 1.2.5). */
export interface Smoke58 { kind: 'smoke' | 'wp'; dispersed: boolean; side: string }

/**
 * The ⅝" counters in a hex, oldest first. Any number may be placed in a hex (ASLRB A24.2), each with its own side
 * and Dispersed state, so `smoke58` holds them all as `kind[.d]@side` joined by commas ("smoke@ge,wp.d@ru").
 */
export function smoke58Counters(m: Record<string, unknown> | undefined): Smoke58[] {
  const v = m?.[SMOKE58.kind];
  if (typeof v !== 'string' || v === '') return [];
  if (!v.includes('@')) return [{ kind: v === 'wp' ? 'wp' : 'smoke', dispersed: m?.[SMOKE58.dispersed] === true, side: String(m?.[SMOKE58.side] ?? '') }];
  return v.split(',').map((t) => {
    const [k, side = ''] = t.split('@');
    return { kind: k!.startsWith('wp') ? 'wp' : 'smoke', dispersed: k!.endsWith('.d'), side };
  });
}

/** The `hex.marker` events that store `counters` as the hex's ⅝" Smoke (clearing the older single-counter keys). */
export function smoke58Markers(hex: HexId, m: Record<string, unknown> | undefined, counters: Smoke58[]): { hex: HexId; key: string; value: string | null }[] {
  const value = counters.map((c) => `${c.kind}${c.dispersed ? '.d' : ''}@${c.side}`).join(',') || null;
  const out: { hex: HexId; key: string; value: string | null }[] = [];
  if ((m?.[SMOKE58.kind] ?? null) !== value) out.push({ hex, key: SMOKE58.kind, value });
  for (const key of [SMOKE58.dispersed, SMOKE58.side]) if (m?.[key] !== undefined) out.push({ hex, key, value: null });
  return out;
}

/** A ⅝" counter's Hindrance DRM: full Smoke +3, Dispersed Smoke or full WP +2, Dispersed WP +1 (SK4 1.2.5). */
export const smoke58CounterDrm = (c: Smoke58) => (c.kind === 'wp' ? (c.dispersed ? 1 : 2) : c.dispersed ? 2 : 3);

/**
 * How many ½" Smoke grenade counters a hex holds: the `smoke` marker is their count (`true` in older states: one).
 * Any number may be placed in a hex (ASLRB A24.2); they come off at the end of the MPh (SK1 3.3).
 */
export function smokeGrenades(m: Record<string, unknown> | undefined): number {
  const v = m?.['smoke'];
  return v === true ? 1 : typeof v === 'number' ? v : 0;
}

export const smokeIn = (env: QueryEnv, hex: HexId) => smokeGrenades(env.state.hexMarkers[hex]) > 0 || smoke58Counters(env.state.hexMarkers[hex]).length > 0;

/** The ⅝" counters' Hindrance DRM, added up (ASLRB A24.2; `smokeDrm` applies the +3 cap). */
export function smoke58Drm(env: QueryEnv, hex: HexId): number {
  return smoke58Counters(env.state.hexMarkers[hex]).reduce((n, c) => n + smoke58CounterDrm(c), 0);
}

/**
 * Smoke Hindrance DRM of a hex: +2 per ½" Smoke grenade counter plus each ⅝" counter's, at most +3 per hex (SK4 1.2.5
 * "up to a maximum of +3 per hex"; ASLRB A24.2: cumulative for each SMOKE counter, never more than +3 for one Location).
 * Fire traced out of the hex adds its +1 on top of this (A24.8).
 */
export function smokeDrm(env: QueryEnv, hex: HexId): number {
  const half = 2 * smokeGrenades(env.state.hexMarkers[hex]);
  return Math.min(3, half + smoke58Drm(env, hex));
}

function smoke58Label(env: QueryEnv, hex: HexId): string {
  const counters = smoke58Counters(env.state.hexMarkers[hex]);
  if (counters.length !== 1) return 'Smoke';
  return `${counters[0]!.dispersed ? 'Dispersed ' : ''}${counters[0]!.kind === 'wp' ? 'WP' : 'Smoke'}`;
}

export const terrainModule: RuleModule = {
  id: 'sk1.terrain',
  ref: 'SK1 1.1.1',
  summary: 'Terrain types: MF cost, TEM, LOS obstacles and hindrances, grain season.',
  requires: ['common.pieces'],
  install(r) {
    r.contribute({
      id: 'sk1.terrain.grain-season',
      query: 'hex.terrain',
      ref: 'SK1 1.1.1',
      label: 'grain out of season = Open Ground',
      when: ({ hex }, env) => !grainInSeason(env) && statics(env).map.hex(hex)?.terrain === 'grain',
      apply: () => 'open',
    });
    r.contribute({
      id: 'sk1.terrain.tem',
      query: 'hex.tem',
      layer: 0,
      apply: (_v, { hex }, env) => terrainOf(env, hex).tem,
    });
    r.contribute({
      id: 'sk1.terrain.open-ground',
      query: 'hex.openGround',
      layer: 0,
      apply: (_v, { hex }, env) => terrainOf(env, hex).openGround,
    });
    r.contribute({
      id: 'sk1.move.terrain-cost',
      query: 'move.cost',
      layer: 0,
      apply(_v, { to, viaRoad, loc }, env) {
        // Woods-Road entered along the road costs the road (Open Ground) rate.
        if (viaRoad && (isRoadHex(env, to) || isWoodsRoad(env, to))) return 1;
        return terrainOf(env, loc ?? to).mf;
      },
    });
    r.contribute({
      id: 'sk1.move.smoke-cost',
      query: 'move.cost',
      ref: 'SK1 3.3',
      label: '+1 MF entering Smoke',
      when: ({ to }, env) => smokeIn(env, to),
      apply: (v) => v + 1,
    });

    r.contribute({
      id: 'sk1.los.terrain',
      query: 'los.trace',
      layer: 0,
      ref: 'SK1 3.2',
      apply(_v, c, env) {
        const [from, to] = [hexOfLoc(c.from), hexOfLoc(c.to)];
        const map = statics(env).map;
        const res = map.los(from, to);
        if (!res.clear) {
          return {
            clear: false,
            hindrance: 0,
            parts: [],
            blockedBy: res.crest ? 'higher ground (Crest Line)' : 'terrain obstacle',
            ...(res.near ? { near: true } : {}),
            ...(res.blockedAt ? { blockedAt: res.blockedAt } : {}),
          };
        }
        // SK4 1.1.1: a hex is at the level of its centre dot. Terrain below both hexes is overlooked
        // (two hill units see across the valley between them); with hex-level LOS, ground above the
        // lower hex in between is a hill in the way or a second Crest Line (pixel LOS has judged this).
        const lo = Math.min(map.hex(from)?.elevation ?? 0, map.hex(to)?.elevation ?? 0);
        const parts: LosTrace['parts'] = [];
        const seen = new Set<HexId>();
        for (const c of res.crossed) {
          if (seen.has(c.hex) || c.hex === from || c.hex === to) continue;
          const level = map.hex(c.hex)?.elevation ?? 0;
          if (level < lo) continue;
          if (level > lo && map.losMode !== 'pixel') {
            return { clear: false, hindrance: 0, parts: [], blockedBy: `higher ground in ${c.hex} (Crest Line)` };
          }
          const t = terrainOf(env, c.hex);
          if (t.los === 'obstacle') {
            return { clear: false, hindrance: 0, parts: [], blockedBy: `${t.name} in ${c.hex}` };
          }
          // The hex's own terrain hinders, or (pixel LOS) a hindrance depiction the thread crossed
          // inside a hex whose terrain at its centre is something else: grain spilling into open ground.
          const depicted = c.terrain !== statics(env).map.hex(c.hex)?.terrain ? statics(env).terrain[c.terrain] : undefined;
          const hind = t.los === 'hindrance' ? t : depicted?.los === 'hindrance' ? depicted : null;
          if (hind) {
            seen.add(c.hex);
            parts.push({ label: `+1 ${hind.name} hindrance`, hex: c.hex, drm: 1, terrain: hind.id });
          }
        }
        return { clear: true, hindrance: parts.reduce((a, p) => a + p.drm, 0), parts, ...(res.woods ? { woods: res.woods } : {}), ...(res.orchard ? { orchard: res.orchard } : {}) };
      },
    });
    r.contribute({
      id: 'sk1.los.smoke',
      query: 'los.trace',
      ref: 'SK1 3.3',
      apply(v, c, env) {
        if (!v.clear || c.noSmoke) return v;
        const [from, to] = [hexOfLoc(c.from), hexOfLoc(c.to)];
        const parts = [...v.parts];
        // Fire traced out of a Smoke hex takes that hex's Smoke DRM +1 (SK1 3.3: "+3" for ½" Smoke).
        if (smokeIn(env, from)) parts.push({ label: `+${smokeDrm(env, from) + 1} firing out of Smoke`, hex: from, drm: smokeDrm(env, from) + 1 });
        // Every hex the line passes through, whatever its terrain. A line exactly along a hexside is
        // affected by Smoke on either side, as one hex: the larger DRM (ASLRB A24.2, B.6).
        const map = statics(env).map;
        const steps = map.lineSteps
          ? map.lineSteps(from, to)
          : map.los(from, to).crossed.filter((c) => c.hex !== from && c.hex !== to).map((c) => [c.hex]);
        for (const step of [...steps, [to]]) {
          const h = step.filter((x) => smokeIn(env, x)).sort((x, y) => smokeDrm(env, y) - smokeDrm(env, x))[0];
          if (h) parts.push({ label: `+${smokeDrm(env, h)} ${smoke58Label(env, h)}`, hex: h, drm: smokeDrm(env, h) });
        }
        return { ...v, parts, hindrance: parts.reduce((a, p) => a + p.drm, 0) };
      },
    });
    // Two Hindrance hexes at the same range from the firer (the LOS crossing both, or running along
    // their shared hexside) count once: the hex with the larger Hindrance DRM (ASLRB A6.7; SK4 is
    // silent). So the Hindrance hexes never outnumber the range. Hindrances in one hex still add up.
    r.contribute({
      id: 'sk1.los.hindrance-per-range',
      query: 'los.trace',
      layer: 850,
      ref: 'ASLRB A6.7',
      apply(v, { from }, env) {
        if (!v.clear || v.parts.length < 2) return v;
        const map = statics(env).map;
        const byHex = new Map<HexId, number>();
        for (const p of v.parts) byHex.set(p.hex, (byHex.get(p.hex) ?? 0) + p.drm);
        const best = new Map<number, HexId>();
        for (const [hex, drm] of byHex) {
          const range = map.distance(hexOfLoc(from), hex);
          const kept = best.get(range);
          if (kept === undefined || drm > byHex.get(kept)!) best.set(range, hex);
        }
        const keep = new Set(best.values());
        const parts = v.parts.filter((p) => keep.has(p.hex));
        return parts.length === v.parts.length ? v : { ...v, parts, hindrance: parts.reduce((a, p) => a + p.drm, 0) };
      },
    });
    r.contribute({
      id: 'sk1.los.hindrance-blocks-at-6',
      query: 'los.trace',
      layer: 900,
      ref: 'SK1 3.2',
      apply: (v) =>
        v.clear && v.hindrance >= 6 ? { ...v, clear: false, blockedBy: 'Hindrance DRM of +6 or more' } : v,
    });
  },
};
