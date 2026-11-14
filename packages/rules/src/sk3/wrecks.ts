import type { PieceId, RuleModule } from '@asl/engine';
import { isVehicleDef, defOf, statics, vehiclesInHex } from '../common/pieces';
import { pieceOf } from '../sk1/status';
import { hexOfLoc } from '../common/location';
import { isMovingTarget, isWreck, vehicle } from './status';
import { heightOf } from '../sk2/elevation';

/*
 * AFVs and wrecks as terrain (SK4 7.4, 7.4.1): Infantry in a hex with a friendly AFV or a wreck get
 * +1 TEM when they have no other positive TEM (and FFMO does not apply to them); a same-level LOS
 * through (not into or out of) a hex holding an AFV or wreck is hindered +1. A Moving Target gives
 * neither until the Advancing Fire Phase after it stops.
 */

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Whether a vehicle (or its wreck) gives cover and hinders LOS (an SSR may say not: S35's dug-in T-34). */
    'vehicle.isTerrain': { ctx: { vehicle: PieceId }; value: boolean };
  }
}

export const wrecksModule: RuleModule = {
  id: 'sk3.wrecks',
  ref: 'SK4 7.4, 7.4.1',
  summary: 'AFVs and wrecks as cover and as LOS Hindrances.',
  requires: ['sk1.terrain', 'sk1.fire', 'sk3.vehicles'],
  install(r) {
    /** A vehicle or wreck in `hex` that counts as cover/hindrance now (not a Moving Target this turn). */
    const coverAt = (env: Parameters<typeof vehiclesInHex>[0], hex: string, side?: string) =>
      vehiclesInHex(env, hex, side).filter((v) => (isWreck(v) || !isMovingTarget(v)) && env.query('vehicle.isTerrain', { vehicle: v.id }, true));
    r.contribute({
      id: 'sk3.los.vehicles',
      query: 'los.trace',
      ref: 'SK4 7.4.1',
      apply(v, ctx, env) {
        if (!v.clear) return v;
        const [from, to] = [hexOfLoc(ctx.from), hexOfLoc(ctx.to)];
        const map = statics(env).map;
        // The lower end's level: its Location's height (hex elevation plus building level; the hex's in SK). ASLRB A6.7.
        const lo = Math.min(heightOf(env, ctx.from), heightOf(env, ctx.to));
        // Every hex the line passes through, whatever its terrain: the pixel trace's `crossed` lists only hexes whose
        // art hinders, and a vehicle in open ground hinders all the same. A line exactly along a hexside is hindered by a
        // vehicle on either side, once (as Smoke, ASLRB B.6).
        const steps = map.lineSteps ? map.lineSteps(from, to) : map.los(from, to).crossed.filter((c) => c.hex !== from && c.hex !== to).map((c) => [c.hex]);
        // "The Hindrance does not apply if the wreck/AFV hex cannot be seen by both the firer and the target" (SK4 7.4.1).
        const seenByBoth = (hex: string) => map.los(from, hex).clear && map.los(to, hex).clear;
        const parts = [...v.parts];
        for (const step of steps) {
          const hex = step.find((h) => (map.hex(h)?.elevation ?? 0) === lo && coverAt(env, h).length && seenByBoth(h));
          if (!hex) continue;
          parts.push({ label: `+1 ${coverAt(env, hex).some(isWreck) ? 'wreck' : 'vehicle'} hindrance`, hex, drm: 1 });
        }
        return parts.length === v.parts.length ? v : { ...v, parts, hindrance: parts.reduce((a, p) => a + p.drm, 0) };
      },
    });
    r.contribute({
      id: 'sk3.drm.afv-cover',
      query: 'fire.unitDrm',
      ref: 'SK4 7.4',
      label: '+1 behind a vehicle or wreck',
      when: ({ unit, attack }, env) => {
        const p = pieceOf(env, unit);
        if (isVehicleDef(defOf(env, p)) || p.loc.kind !== 'hex') return false;
        if (env.query('hex.tem', { hex: attack.target }, 0) > 0) return false;
        // On the Infantry Target Type the TEM went on the To Hit DR.
        if (attack.ordnance?.targetType === 'ITT') return false;
        return coverAt(env, p.loc.hex).some((v) => isWreck(v) || v.side === p.side);
      },
      apply: (v) => v + 1,
    });
    // Cover from an AFV or wreck is a positive TEM: no FFMO (SK4 7.4 "negating FFMO").
    r.suppress<'fire.drm'>({
      id: 'sk3.suppress.ffmo-afv-cover',
      query: 'fire.drm',
      target: 'sk1.drm.ffmo',
      ref: 'SK4 7.4',
      when: ({ attack }, env) => attack.targets.some((u) => {
        const p = env.state.pieces[u];
        return !!p && p.loc.kind === 'hex' && !vehicle(env, p) && coverAt(env, p.loc.hex).some((v) => isWreck(v) || v.side === p.side);
      }),
    });
  },
};
