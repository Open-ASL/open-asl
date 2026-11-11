import type { Ctx, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { hexOf, statics } from '../common/pieces';
import type { AmmoKind, IftResult } from '../common/statics';
import { iftColumn } from '../sk1/fire';
import { pieceOf } from '../sk1/status';
import { ammoColumn } from '../sk2/ammo';
import { OP, type HitInfo, type ResolveHitFn, type ShotCtx } from '../sk2/ordnance';
import { facingBySameHexDie, facingOf, hitLocation, type Facing } from './facing';
import { T3, isCe, tcaOf, vcaOf, vehicle } from './status';
import { applyVehicleEffect, crewTakesResult, possibleShock } from './vehicleStatus';

/*
 * The To Kill process (SK4 3.2.4, 7.9, 7.10, 7.12): a Vehicle Target Type hit strikes the hull or the
 * turret (colored vs white To Hit die) on the front, side or rear (the LOS against the VCA or TCA);
 * the To Kill number of the ammunition at that range, +1 for a rear hit and doubled for a Critical
 * Hit, less the Armor Factor is the Final TK#. A To Kill DR below it destroys the vehicle; equal
 * to it Immobilizes (hull) or Shocks (turret); one more with HE Immobilizes/Shocks likewise, with
 * other ammunition is a Possible Shock (NTC); a MG hit equal to the Final TK# Stuns. A hit that
 * does none of this still attacks a CE crew collaterally with the same DR.
 */

export type TkResult = 'kill' | 'immobilized' | 'shock' | 'possibleShock' | 'stun' | 'dud' | 'none';

export interface ToKillOutcome {
  location: 'hull' | 'turret';
  facing: Facing;
  af: number;
  tk: number;
  modifiedTk: number;
  finalTk: number;
  dr: [number, number];
  result: TkResult;
  shocked?: boolean;
}

/** TK ammunition the tables know; Smoke and WP never reach a To Kill roll. */
/** Ordnance ammunition with a To Kill table; Flamethrowers and DCs roll on the HE & Flame table too (reported with their own labels). */
export type TkAmmo = 'AP' | 'APCR' | 'APDS' | 'HEAT' | 'HE';
export type TkWeaponAmmo = TkAmmo | 'FT' | 'DC';

/** Which aspect and facing a shot at `target` from `firerHex` strikes, and the Armor Factor there. */
export function aspectHit(env: QueryEnv, target: PieceId, firerHex: string, dice: [number, number]): { location: 'hull' | 'turret'; facing: Facing; af: number } {
  const map = statics(env).map;
  const p = pieceOf(env, target);
  const d = vehicle(env, p)!;
  const [white, colored] = dice;
  const location = hitLocation(white, colored);
  const at = hexOf(env.state, p)!;
  const spine = location === 'turret' ? tcaOf(env, p) : vcaOf(p);
  const afs = location === 'turret' ? d.af.turret : d.af.hull;
  const facing = firerHex === at ? facingBySameHexDie(colored) : facingOf(map.hex(at)!.cube, spine, map.hex(firerHex)!.cube, afs);
  return { location, facing, af: afs[facing] };
}

/** The To Kill numbers of a shot against `target` for every aspect, for previews (null when the ammunition has no TK#). */
export function toKillNumbers(env: QueryEnv, sc: ShotCtx): { tk: number | null; hull: Record<Facing, number>; turret: Record<Facing, number> } | null {
  const d = vehicle(env, pieceOf(env, sc.targetVehicle!));
  if (!d) return null;
  const tk = statics(env).tables.toKill(sc.def, sc.ammo as TkAmmo, sc.range);
  return { tk, hull: d.af.hull, turret: d.af.turret };
}

function resolveToKill(ctx: Ctx, sc: ShotCtx, h: HitInfo, results: Record<PieceId, IftResult>): number[] {
  const target = sc.targetVehicle!;
  const p = pieceOf(ctx, target);
  const d = vehicle(ctx, p)!;
  const ammo = sc.ammo as TkAmmo;
  const { location, facing, af } = aspectHit(ctx, target, sc.hex, h.dice);
  const tk = statics(ctx).tables.toKill(sc.def, ammo, sc.range);
  if (tk === null) {
    ctx.emit('sk3.toKill', { weapon: sc.weapon, target, ammo, location, facing, af, tk: null, modifiedTk: null, finalTk: null, dr: null, result: 'none', ch: h.ch });
    return [];
  }
  const modifiedTk = (tk + (facing === 'rear' ? 1 : 0)) * (h.ch ? 2 : 1);
  const finalTk = modifiedTk - af;
  const roll = ctx.roll(`To Kill ${target} (${location} ${facing}, Final TK ${finalTk})`);
  const dr = roll.total;
  const mg = sc.def.type === 'MG';
  let result: TkResult;
  if (dr === 12) result = 'dud';
  else if (dr < finalTk) result = 'kill';
  else if (dr === finalTk) result = mg ? 'stun' : location === 'hull' ? 'immobilized' : 'shock';
  else if (dr === finalTk + 1 && !mg) result = ammo === 'HE' ? (location === 'hull' ? 'immobilized' : 'shock') : 'possibleShock';
  else result = 'none';
  const out: ToKillOutcome = { location, facing, af, tk, modifiedTk, finalTk, dr: roll.dice as [number, number], result };
  const by = `${ammo} hit (${location} ${facing}, TK ${finalTk}, DR ${dr})`;
  // A Possible Shock is settled by the crew's NTC before the result is reported.
  if (result === 'possibleShock') out.shocked = possibleShock(ctx, target, by);
  ctx.emit('sk3.toKill', { weapon: sc.weapon, target, ammo, ch: h.ch, ...out });
  switch (result) {
    case 'kill':
      applyVehicleEffect(ctx, target, 'wreck', by);
      break;
    case 'immobilized':
      applyVehicleEffect(ctx, target, 'immobilized', by);
      break;
    case 'shock':
      applyVehicleEffect(ctx, target, 'shock', by);
      break;
    case 'stun':
      applyVehicleEffect(ctx, target, 'stun', by);
      break;
  }
  // Collateral Attack (7.12): a hit that did not destroy, Shock or Stun the AFV attacks its CE crew with the same DR.
  if ((result === 'none' || result === 'dud' || result === 'immobilized' || (result === 'possibleShock' && !out.shocked)) && isCe(pieceOf(ctx, target))) {
    const column = ammoColumn(ctx, sc.def, ammo as Exclude<AmmoKind, 'SMOKE' | 'WP'>, 'ITT', false);
    const col = column === null ? null : iftColumn(ctx, column);
    if (col !== null) {
      const final = dr + d.ceDrm;
      const res = statics(ctx).tables.ift(col, final);
      ctx.emit('sk3.collateral', { weapon: sc.weapon, target, column: col, dr: roll.dice as [number, number], drm: d.ceDrm, result: res });
      results[target] = res;
      crewTakesResult(ctx, target, res, 'Collateral Attack');
    }
  }
  // Residual FP (3.3.5): a HE or HEAT To Kill attempt leaves it like an IFT attack on the weapon's column.
  if (ammo === 'HE' || ammo === 'HEAT') {
    const column = ammoColumn(ctx, sc.def, ammo, 'ITT', false);
    return column === null ? [] : [column];
  }
  return [];
}

export const toKillModule: RuleModule = {
  id: 'sk3.toKill',
  ref: 'SK4 3.2.4, 6.1, 7.1, 7.9, 7.10, 7.12',
  summary: 'The To Kill process: hit location and facing, Armor Factors, the AFV Destruction Table, Collateral Attacks.',
  requires: ['sk2.ordnance', 'sk3.vehicleStatus'],
  install(r) {
    r.event<{ weapon: PieceId; target: PieceId; ammo: TkWeaponAmmo; ch: boolean; location: 'hull' | 'turret'; facing: Facing; af: number; tk: number | null; modifiedTk: number | null; finalTk: number | null; dr: [number, number] | null; result: TkResult; shocked?: boolean; explain?: { id: string; label: string }[] }>({ type: 'sk3.toKill', apply() {} });
    r.event<{ weapon: PieceId; target: PieceId; column: number; dr: [number, number]; drm: number; result: IftResult }>({ type: 'sk3.collateral', apply() {} });
    r.procedure<ResolveHitFn>(OP.resolveHit, (next) => (ctx, sc, hit, targets, results) => {
      if (sc.shot.targetType !== 'VTT') return next!(ctx, sc, hit, targets, results);
      if (!hit.hit || !sc.targetVehicle) return [];
      return resolveToKill(ctx, sc, hit, results);
    });
    // The vehicle keeps its tags; nothing else to do when it is "eliminated" as a wreck (it is not).
    void T3;
  },
};
