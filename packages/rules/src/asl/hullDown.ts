import type { Ctx, Piece, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { byId, otherSide, statics, swHeldBy } from '../common/pieces';
import { hexOfLoc, locOf, type LocId } from '../common/location';
import type { HexsideObstacle } from '../common/statics';
import type { FireAttackCtx } from '../sk1/fire';
import { pieceOf } from '../sk1/status';
import { heightOf } from '../sk2/elevation';
import { OP, type ResolveHitFn, type ShotCtx } from '../sk2/ordnance';
import { hitLocation } from '../sk3/facing';
import { isWreck, vehicle } from '../sk3/status';
import { vehicleMgOf } from '../sk3/vehicleMg';
import { isEntrenchedVehicle } from './entrenchments';
import { vehicleWallTem } from './roadblocks';
import { hasWaOver } from './wallAdvantage';

/*
 * Hull Down (ASLRB D4.2–D4.223, C3.9) for the two fortification cases that make a vehicle HD: a vehicle beneath a trench
 * or A-T Ditch (B27.52 "is considered HD") and one fired on through a roadblock (wall) hexside whose TEM it is subject to
 * (B9.36, D4.21). Nothing is recorded: the status is worked out from the board for each firer.
 * - Only Direct Fire ordnance (D4.2 "making that portion of the target incapable of being hit by Direct Fire ordnance"):
 *   never Indirect Fire (D4.2, B9.34), never small arms or MG fire (B9.36: a non-ordnance attack meets the wall TEM).
 * - A hit counts only on the turret/upper superstructure (D4.2): the colored dr of the Original To Hit DR less than the
 *   white dr (C3.9); a CH is always a turret hit (C3.9 EXC, C3.7). On the Vehicle Target Type a hull hit is a miss; on a
 *   Direct Fire Area Target Type hit the HD vehicle is spared a hull hit, the other units of the hex attacked as hit
 *   (D4.2 speaks of any Direct Fire hit; C3.331: TEM that grants HD does not reach the Effects DR).
 * - No Case Q TEM with HD, though the owner may take the in-hex Case Q instead (D4.2, B9.36; the choice is
 *   `asl/hullDownChoice.ts`); no Height Advantage against a target HD to the firer (D4.22).
 * - B9.33: the firer's elevation advantage reduces the wall's TEM, and "in a similar manner" the trench's: at 0 HD is
 *   negated; at +1 the colored dr is one less for the Location of Hit only.
 * - D4.223: a non-MA/CMG bow-mounted weapon (the BMG) may not fire at a target the firing vehicle is HD to.
 * The trench +2 is the vehicle's TEM against everything else (B27.3: Indirect Fire, IFT attacks on its crew; Q&A [K33] to
 * B27.52, C1.55 & D9.54), in `asl/entrenchments.ts`. Not here: the HD Maneuver Attempt on a Crest Line (D4.22–D4.222),
 * aircraft (D4.2's Aerial AF), and the Dug-In AFV of D9.54 (the Starter Kit's dig-in SSR stays as it is).
 */

export interface HullDown {
  /** Beneath a trench (B27.52) or behind a wall/roadblock hexside (B9.36). */
  kind: 'trench' | 'wall';
  /** The TEM that makes it HD after the firer's elevation advantage (B9.33): 2, or 1 for the -1 colored dr. */
  tem: number;
  /** The wall hexside (B9.36). */
  obstacle?: HexsideObstacle;
}

/** A vehicle's owner who chose the in-hex TEM over HD for the shot now being resolved (B9.36, D4.2): `asl/hullDownChoice.ts`. */
export const HD_CHOICE_EXT = 'asl.hd.choice';
export type HdChoiceState = { vehicle: PieceId; choice: 'hd' | 'tem' } | undefined;
const choseTem = (env: QueryEnv, vehicleId: PieceId) => {
  const c = env.state.ext[HD_CHOICE_EXT] as HdChoiceState;
  return !!c && c.vehicle === vehicleId && c.choice === 'tem';
};

/**
 * Whether vehicle `vehicleId` is Hull Down to Direct Fire ordnance from Location `from`, and why; `firerWaOver` says
 * whether the firer holds WA over a wall hexside (B9.31). `choice: false` ignores the owner's choice of in-hex TEM.
 */
export function hullDownTo(env: QueryEnv, vehicleId: PieceId, from: LocId, firerWaOver: (o: HexsideObstacle) => boolean, opts: { choice?: boolean } = {}): HullDown | null {
  const v = env.state.pieces[vehicleId];
  if (!v || !vehicle(env, v) || isWreck(v) || v.loc.kind !== 'hex') return null;
  if (opts.choice !== false && choseTem(env, vehicleId)) return null;
  const hex = v.loc.hex;
  const out: HullDown[] = [];
  if (isEntrenchedVehicle(env, v)) {
    // B9.33 "in a similar manner": one less per full level of the firer's height above the hex's base level beyond the range.
    const red = Math.max(0, Math.floor(heightOf(env, from) - heightOf(env, hex)) - statics(env).map.distance(hexOfLoc(from), hex));
    if (2 - red > 0) out.push({ kind: 'trench', tem: 2 - red });
  }
  const wall = vehicleWallTem(env, vehicleId, from, firerWaOver);
  if (wall) out.push({ kind: 'wall', tem: wall.tem, obstacle: wall.o });
  return out.sort((a, b) => b.tem - a.tem)[0] ?? null;
}

/** HD to a piece firing from its own Location (its WA over a wall hexside counts, B9.31). */
export function hullDownToFirer(env: QueryEnv, vehicleId: PieceId, firer: PieceId, opts: { choice?: boolean } = {}): HullDown | null {
  const f = env.state.pieces[firer];
  const from = f && locOf(env.state, f);
  if (!from) return null;
  return hullDownTo(env, vehicleId, from, (o) => hasWaOver(env, f, o), opts);
}

/** HD to whatever is at Location `loc` (D4.223 "HD to that target's position"): any unit there holding WA over the wall counts. */
export function hullDownToLoc(env: QueryEnv, vehicleId: PieceId, loc: LocId): HullDown | null {
  const v = pieceOf(env, vehicleId);
  const there = Object.values(env.state.pieces).filter((p) => p.side === otherSide(env.state, v.side) && locOf(env.state, p) === loc).sort(byId);
  return hullDownTo(env, vehicleId, loc, (o) => there.some((p) => hasWaOver(env, p, o)));
}

/** HD against an ordnance shot: Direct Fire only (a mortar's fire is Indirect, C.1). */
export function shotHullDown(env: QueryEnv, sc: ShotCtx, vehicleId: PieceId | undefined, opts: { choice?: boolean } = {}): HullDown | null {
  if (!vehicleId || sc.def.type === 'MTR') return null;
  return hullDownToFirer(env, vehicleId, sc.firer, opts);
}

/** The aspect a hit strikes on a HD target (C3.9; B9.33's -1 to the colored dr at a +1 TEM): a CH is always a turret hit. */
export function hdHitLocation(dice: [number, number], ch: boolean, hd: HullDown): 'hull' | 'turret' {
  if (ch) return 'turret';
  return hitLocation(dice[0], dice[1] - (hd.tem === 1 ? 1 : 0));
}

/** How the HD status reads in a DRM list or log line. */
export function hullDownLabel(hd: HullDown): string {
  const why = hd.kind === 'trench' ? 'beneath the trench (B27.52)' : 'behind the roadblock (B9.36)';
  return `Hull Down ${why}: only a turret hit counts${hd.tem === 1 ? '; -1 colored dr for its Location (B9.33)' : ''}`;
}

/** The HD of a vehicle against an Area Target Type attack resolved now: the firer of its single ordnance part. */
function attackHullDown(env: QueryEnv, attack: FireAttackCtx, vehicleId: PieceId): HullDown | null {
  if (!attack.ordnance || attack.ordnance.indirect) return null;
  const part = attack.parts[0];
  return part ? hullDownToFirer(env, vehicleId, part.firer) : null;
}

export const aslHullDownModule: RuleModule = {
  id: 'asl.hullDown',
  ref: 'ASLRB D4.2–D4.223, C3.9, B9.33, B9.36, B27.52',
  summary: 'Hull Down vehicles beneath a trench or behind a roadblock: only turret hits count against Direct Fire ordnance, no Case Q or Height Advantage, no BMG fire.',
  requires: ['asl.entrenchments', 'asl.roadblocks', 'sk1.fire'],
  install(r) {
    r.event<{ weapon: PieceId; target: PieceId; dice: [number, number]; kind: 'trench' | 'wall'; tem: number }>({ type: 'asl.hd.hullHit', apply() {} });

    // The Vehicle Target Type: a hit on the hull of a HD target is a miss (D4.2): no To Kill DR, no Collateral Attack, no
    // Residual FP. A turret hit goes on, its Location by the HD rules (`vehicle.hitLocation` below).
    r.procedure<ResolveHitFn>(OP.resolveHit, (next) => (ctx: Ctx, sc, hit, targets, results) => {
      if (sc.shot.targetType !== 'VTT' || !hit.hit) return next!(ctx, sc, hit, targets, results);
      const hd = shotHullDown(ctx, sc, sc.targetVehicle);
      if (hd && hdHitLocation(hit.dice, hit.ch, hd) === 'hull') {
        ctx.emit('asl.hd.hullHit', { weapon: sc.weapon, target: sc.targetVehicle!, dice: hit.dice, kind: hd.kind, tem: hd.tem });
        return [];
      }
      return next!(ctx, sc, hit, targets, results);
    });
    r.contribute({
      id: 'asl.hd.hitLocation',
      query: 'vehicle.hitLocation',
      ref: 'ASLRB C3.9, B9.33',
      apply(v, { vehicle: vid, dice, ch, from }, env) {
        if (!from) return v;
        const hd = hullDownToLoc(env, vid, from);
        return hd ? hdHitLocation(dice, ch, hd) : v;
      },
    });
    // A Direct Fire Area Target Type hit (D4.2, C3.331): the HD vehicle is spared a hull hit.
    r.contribute({
      id: 'asl.hd.areaHit.hd',
      query: 'vehicle.areaHit',
      ref: 'ASLRB D4.2, C3.9, C3.331',
      apply(v, { attack, vehicle: vid }, env) {
        const hd = attackHullDown(env, attack, vid);
        if (!hd) return v;
        const location = hdHitLocation(attack.ordnance?.thDice ?? [1, 1], !!attack.ordnance?.ch, hd);
        return location === 'hull' ? { location, spared: `hull hit: no effect (${hullDownLabel(hd)})` } : { location };
      },
    });

    // To Hit: no Case Q TEM with HD, nor Height Advantage (D4.2, D4.22). The preview names the HD status (`shotHullDown`).
    // A preview before the declaration (`losBlind`) reads it too: the trench needs no LOS, and whether a line crosses a wall
    // hexside tells nothing of what blocks it (A6.11).
    const vttHd = (sc: ShotCtx, env: QueryEnv) => (sc.shot.targetType === 'VTT' ? shotHullDown(env, sc, sc.targetVehicle) : null);
    r.suppress<'ordnance.thDrm'>({ id: 'asl.hd.noCaseQ', query: 'ordnance.thDrm', target: 'sk2.th.tem', ref: 'ASLRB D4.2', when: (sc, env) => !!vttHd(sc, env) });
    r.suppress<'ordnance.thDrm'>({ id: 'asl.hd.noHa', query: 'ordnance.thDrm', target: 'sk2.th.heightAdvantage', ref: 'ASLRB D4.22', when: (sc, env) => !!vttHd(sc, env) });
    r.suppress<'fire.unitDrm'>({
      id: 'asl.hd.noHaArea',
      query: 'fire.unitDrm',
      target: 'sk2.drm.height-advantage',
      ref: 'ASLRB D4.22',
      when: ({ attack, unit }, env) => attack.ordnance?.targetType === 'ATT' && !!vehicle(env, pieceOf(env, unit)) && !!attackHullDown(env, attack, unit),
    });

    // D4.223: "Non- MA/CMG bow-mounted weapons cannot be used against a target if the firing vehicle is HD to that
    // target's position."
    r.contribute({
      id: 'asl.hd.bmg',
      query: 'fire.illegal',
      ref: 'ASLRB D4.223',
      apply(v, { decl }, env) {
        if (v) return v;
        for (const id of decl.sw) {
          const mg = vehicleMgOf(env, id);
          if (mg?.kind !== 'bmg') continue;
          const hd = hullDownToLoc(env, mg.vehicle, decl.target);
          if (hd) return `Hull Down ${hd.kind === 'trench' ? 'beneath the trench' : 'behind the roadblock'}: the bow MG cannot fire at ${hexOfLoc(decl.target)} (ASLRB D4.223)`;
        }
        return null;
      },
    });
  },
};

/** The BMG of a vehicle, and why it may not fire at `loc` while the vehicle is HD to it (D4.223), for the wheel. */
export function bmgHullDownIllegal(env: QueryEnv, v: Piece, loc: LocId): string | null {
  const bmg = swHeldBy(env.state, v.id).find((w) => vehicleMgOf(env, w.id)?.kind === 'bmg');
  if (!bmg) return null;
  const hd = hullDownToLoc(env, v.id, loc);
  return hd ? `Hull Down: the bow MG cannot fire (ASLRB D4.223)` : null;
}
