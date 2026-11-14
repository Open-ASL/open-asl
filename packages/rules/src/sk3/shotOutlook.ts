import type { PieceId, QueryEnv, SideId } from '@asl/engine';
import type { FireMode } from '../sk1/fire';
import { withoutSecrets } from '../sk1/fire';
import { shotContext, toHitNumber, type OrdnanceShot } from '../sk2/ordnance';
import { vehicle } from './status';
import { toKillNumbers } from './toKill';
import type { Facing } from './facing';

/**
 * What a shot would need, before it is fired: the To Hit number, the DRM the engine would apply
 * (hindrance apart, since the LOS is only traced when the shot is fired), the original DR a hit
 * needs, and against a vehicle the To Kill number with the target's Armor Factors (SK4 7.9). The
 * same reading serves the shot composer and any player's planning.
 */
export interface ShotOutlook {
  illegal: string | null;
  th: number | null;
  red: boolean;
  ch: number | null;
  drm: number;
  parts: string[];
  /** The original DR a hit needs (TH − DRM). */
  hitOn: number | null;
  caChange: number;
  /** The firer is a Non-Stopped or Motion vehicle: the lower die is added to the DR again (SK4 case 16). */
  nonStopped: boolean;
  /** A Vehicle Target Type shot: the To Kill number and the target's Armor Factors per aspect. */
  tk?: { target: string; tk: number | null; hull: Record<Facing, number>; turret: Record<Facing, number>; turretType: string } | null;
}

export function shotOutlook(env: QueryEnv, shot: OrdnanceShot, mode: FireMode, side: SideId, moving?: PieceId[]): ShotOutlook {
  const illegal = env.query('ordnance.illegal', { shot, mode, side, ...(moving ? { moving } : {}) }, null);
  const none: ShotOutlook = { illegal, th: null, red: false, ch: null, drm: 0, parts: [], hitOn: null, caChange: 0, nonStopped: false };
  if (shot.targetType === 'IFE') return none;
  try {
    const sc = { ...shotContext(env, shot, mode, side, moving ? { moving } : {}), hindrance: 0 };
    const thn = toHitNumber(env, sc);
    const drm = withoutSecrets(env.explain('ordnance.thDrm', sc, 0));
    // Case 16 shows as an extra on the dice: with a 1 and a 1 the extra is the lower die, 1.
    const nonStopped = env.query('ordnance.thExtra', { sc, dice: [1, 1] as [number, number] }, 0) > 0;
    const tv = sc.targetVehicle ? env.state.pieces[sc.targetVehicle] : undefined;
    const tvd = tv ? vehicle(env, tv) : null;
    const tkn = tvd ? toKillNumbers(env, sc) : null;
    return {
      illegal,
      th: thn?.th ?? null,
      red: thn?.red ?? false,
      ch: thn?.ch ?? null,
      drm: drm.value,
      parts: drm.trace.filter((t) => !t.suppressedBy && t.label).map((t) => t.label!),
      hitOn: thn ? thn.th - drm.value : null,
      caChange: sc.spines,
      nonStopped,
      ...(shot.targetType === 'VTT' ? { tk: tvd && tkn ? { target: tvd.name, tk: tkn.tk, hull: tkn.hull, turret: tkn.turret, turretType: tvd.turret } : null } : {}),
    };
  } catch (e) {
    return { ...none, illegal: illegal ?? (e as Error).message };
  }
}
