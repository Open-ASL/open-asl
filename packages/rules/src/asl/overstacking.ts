import { Layer, type Ctx, type Piece, type PieceId, type QueryEnv, type RuleModule, type SideId } from '@asl/engine';
import { hexOfLoc, isGroundLoc, locOf, type LocId } from '../common/location';
import { byId, defOf, isVehicleDef, otherSide, personnelAt, statics, vehiclesAt } from '../common/pieces';
import { hasLos, isKnownTo } from '../sk1/known';
import type { FireAttackCtx } from '../sk1/fire';
import { OPEN_STACK_LIMIT, firstFireTargets, moveLoc, moveState, offboardOccupants, stackLimit } from '../sk1/movement';
import { OP, toHitNumber, type ResolveHitFn, type ShotCtx } from '../sk2/ordnance';
import { activeRout } from '../sk1/rout';
import { isGoodOrder, mmc, pieceOf, smc, squadEquivalents } from '../sk1/status';
import { revealUnit } from '../sk2/hip';
import { isHidden } from '../sk2/status';
import { terrainOf } from '../sk1/terrain';

/*
 * Overstacking (ASLRB A5.1, A5.11, A5.5, A5.6). Full ASL only: the Starter Kit has a hard cap ("Each side may have up to
 * three MMC squad equivalents per hex plus up to four SMC", SK1/SK4 glossary; SK4 3.3: units "may not move into a hex that
 * would violate stacking limits at any time during the move").
 * - A5.1: each side may stack "up to three squads or their equivalents (5.5) plus up to four SMC per Location without
 *   penalty"; the limits "can be exceeded only at increased risk and inconvenience to all of the friendly units therein, and
 *   never during initial or offboard setup" (A2.9). So no entry in play is refused for stacking (`stack.cap` answers null),
 *   except where the limit is a capacity: a pillbox "can never be overstacked" (A5.6, B30.111), nor a Location whose capacity
 *   a card's SSR states. An entrenchment keeps its own capacity check (B27.12: the overstacking "occurs outside" it).
 *   Offboard units "move normally" (A2.51): offboard too.
 * - A5.5: "Five SMC equal a HS, and two non-Inherent-crews/HS equal a squad, but ≤ 4 SMC count as zero squad-equivalents": each
 *   full five SMC count as a HS (½); fewer than five left over count nothing (`stackingEquivalents`). A crew/HS manning a
 *   Gun counts as a squad (`squadEquivalents`).
 * - A5.11: "Entrance of a Location overstacked by Personnel (even if overstacked only due to the moving unit's entry) costs
 *   one additional MF for each squad (or its equivalent; FRU) in the Location that exceeds normal Personnel stacking
 *   limits". Each side's excess is counted against its own limit (A5.1 "Each side may stack") and the excesses added: the
 *   mover's own units all (its hidden ones included), the enemy's as far as they are Known to it (an unknown unit can
 *   change no cost, as A4.14 refuses only Known enemies). Every entry of a new Location pays it: a MPh step (the stairs,
 *   a Bypass of a hex whose obstacle holds friendly units, an OVR, which doubles it with the rest, A4.15), an advance
 *   (counting the units that advanced there earlier in the APh, the A5.11 EX), a rout step (A10.51 counts it in the nearest
 *   shelter: Q&A to A5.11 and A10.51). Leaving a Location, and going beneath an entrenchment within one, is no entry. The
 *   road rate and road bonus are kept (A4.132 makes only terrain non-cumulative). The cost can force a Minimum Move
 *   (A4.134) or an advance's CX (A4.72).
 * - A5.11: vehicles pay one MP per Personnel excess, "in addition to any overstacking movement cost for vehicles (D2.14)";
 *   "Personnel movement into a Location overstacked by vehicles is not penalized": only Personnel are counted.
 * - A5.12: "+1 to their IFT/CC DR (or +1 to their To Hit DR for ordnance) for each vehicle and squad equivalent (FRU) by
 *   which they exceed normal stacking limits", once per attack (A7.3), the worst firing Location of a Fire Group (A7.52), in
 *   every phase; it lowers the Residual FP of a firer outside the target hex (A8.26).
 * - A5.131: Personnel attacked in a Location their side has overstacked: -1 To Hit vs ordnance, else -1 IFT/CC DR, per
 *   excess squad-equivalent (FRU); A5.13: in the MPh only the moving units. A vehicle is "not directly penalized" (A5.132),
 *   nor is an attack on the IFT's Vehicle line. Interdiction is a NMC, not an IFT DR: untouched.
 * - A5.2: friendly vehicles may share a Location (with the A5.12 penalty per vehicle beyond one); A5.132: a Vehicle Target
 *   Type miss by less than the vehicles there may hit another of them (`OP.resolveHit` below).
 * Not here (not in play): sewers and tunnels (A5.6, B8.2), PRC (A5.3), prisoners and their Guards (A20.51), Cavalry (A13.2),
 * Depressions, Steeples, Towers (B20.98, B31.21, B34.21).
 */

/** Stacking equivalents of a side's Personnel (A5.5): the squad-equivalents, plus a HS for each full five SMC. */
export function stackingEquivalents(env: QueryEnv, pieces: Piece[]): number {
  const smcs = pieces.filter((p) => !!smc(env, p)).length;
  return squadEquivalents(env, pieces) + 0.5 * Math.floor(smcs / 5);
}

/** Whether `loc` is an offboard hex (offboard units wait there, A2.51). */
const offboard = (env: QueryEnv, loc: LocId) => {
  const map = statics(env).map;
  return isGroundLoc(loc) && !map.hex(loc) && !!map.offboardHex(loc);
};

/** A side's Personnel in Location `loc` (an offboard hex included); `viewer`: only those Known to that side. */
function occupants(env: QueryEnv, loc: LocId, side: SideId, viewer?: SideId): Piece[] {
  const all = offboard(env, loc) ? offboardOccupants(env, loc, side) : personnelAt(env, loc, side);
  return viewer === undefined || viewer === side ? all : all.filter((p) => isKnownTo(env, p, viewer));
}

/** The Personnel limit of a side in `loc`: squad-equivalents (A5.1; a lower limit where a rule sets one). */
const personnelLimit = (env: QueryEnv, loc: LocId, side: SideId) => (offboard(env, loc) ? OPEN_STACK_LIMIT : stackLimit(env, loc, side)).se;

/** Squad-equivalents by which `pieces` (of `side`) exceed its Personnel limit in `loc`, rounded up (FRU, A5.11, A5.12). */
function excessOf(env: QueryEnv, loc: LocId, side: SideId, pieces: Piece[]): number {
  return Math.ceil(Math.max(0, stackingEquivalents(env, pieces) - personnelLimit(env, loc, side)));
}

/**
 * By how much `side` has overstacked Location `loc` (A5.1, A5.2): squad-equivalents of Personnel (FRU) beyond its limit,
 * and vehicles beyond one (wrecks never count, A5.2).
 */
export function overstackBy(env: QueryEnv, loc: LocId, side: SideId, viewer?: SideId): { personnel: number; vehicles: number } {
  const vs = offboard(env, loc) ? [] : vehiclesAt(env, loc, side, true).filter((p) => viewer === undefined || viewer === side || isKnownTo(env, p, viewer));
  return { personnel: excessOf(env, loc, side, occupants(env, loc, side, viewer)), vehicles: Math.max(0, vs.length - 1) };
}

/** The A5.12 attack penalty of `side` firing from `loc`: one per excess vehicle and squad-equivalent (FRU). */
export function firerPenalty(env: QueryEnv, loc: LocId, side: SideId, viewer?: SideId): number {
  const o = overstackBy(env, loc, side, viewer);
  return o.personnel + o.vehicles;
}

/**
 * The A5.131 defense penalty of Personnel `unit` (as a positive number): its side's Personnel excess in its Location (FRU),
 * counted with every unit there; in the MPh only for the units of the moving stack (A5.13). `viewer`: as Known to that side.
 */
export function targetPenalty(env: QueryEnv, unit: PieceId, viewer?: SideId): number {
  const p = env.state.pieces[unit];
  if (!p || p.loc.kind !== 'hex' || !(mmc(env, p) || smc(env, p))) return 0;
  if (env.state.phase === 'MPh') {
    const ms = moveState(env);
    if (!ms || !firstFireTargets(env, ms).includes(unit)) return 0;
  }
  const loc = locOf(env.state, p)!;
  return overstackBy(env, loc, p.side, viewer).personnel;
}

/** Event: an A5.132 dr after a Vehicle Target Type miss by `by` with `vehicles` in the hex; `hit` the vehicle struck, or null. */
export const STRAY_HIT_EVENT = 'asl.overstack.strayHit';
export interface StrayHitEvent {
  weapon: PieceId;
  firer: PieceId;
  target: PieceId;
  by: number;
  vehicles: number;
  dr: number;
  hit: PieceId | null;
}

/** The reverse of a vehicle's Target Size modifier (A5.132): a large target +1 to its Random Selection dr, a small one -1. */
const reverseSize = (env: QueryEnv, id: PieceId): number => {
  const d = defOf(env, pieceOf(env, id));
  const size = d.kind === 'vehicle' ? d.targetSize : 'normal';
  return size === 'veryLarge' ? 2 : size === 'large' ? 1 : size === 'small' ? -1 : size === 'verySmall' ? -2 : 0;
};

/** Which of `ids` an A5.132 hit strikes: the one when alone, else Random Selection (A.9: the highest dr; ties roll again). */
function strayPick(ctx: Ctx, ids: PieceId[]): PieceId | null {
  let pool = [...ids].sort();
  while (pool.length > 1) {
    const rolls = pool.map((id) => ({ id, v: ctx.roll(`A5.132 Random Selection (${id})`, 1).total + reverseSize(ctx, id) }));
    const top = Math.max(...rolls.map((r) => r.v));
    pool = rolls.filter((r) => r.v === top).map((r) => r.id);
  }
  return pool[0] ?? null;
}

/** Whether a Good Order enemy ground unit (of `side`'s enemy) has a LOS to Location `loc` (A12.14). */
function seenByGoodOrder(env: QueryEnv, loc: LocId, side: SideId): boolean {
  const enemy = otherSide(env.state, side);
  return Object.values(env.state.pieces).some((e) => {
    if (e.side !== enemy || e.loc.kind !== 'hex') return false;
    const ground = mmc(env, e) || smc(env, e) ? isGoodOrder(env, e) : isVehicleDef(defOf(env, e)) && e.tags['wreck'] !== true;
    return ground && hasLos(env, locOf(env.state, e)!, loc);
  });
}

/** The Location a firing part fires from (its firer's), if on the map. */
const partLocOf = (env: QueryEnv, firer: PieceId): LocId | null => {
  const p = env.state.pieces[firer];
  return p && p.loc.kind === 'hex' ? locOf(env.state, p) : null;
};

/**
 * The A5.12 penalty of an IFT attack: the largest among its firing Locations, once (A7.3 "applied only once per attack";
 * A7.52: a detrimental DRM of any member applies to the whole FG).
 */
export function attackPenalty(env: QueryEnv, attack: FireAttackCtx, viewer?: SideId): number {
  const locs = [...new Set(attack.parts.map((p) => partLocOf(env, p.firer)).filter((l): l is LocId => !!l))];
  return Math.max(0, ...locs.map((l) => firerPenalty(env, l, attack.side, viewer)));
}

/** An IFT attack all of whose targets are vehicles: resolved on the IFT's Vehicle line, which overstacking never touches (A5.132). */
const vehicleLine = (env: QueryEnv, attack: FireAttackCtx) => attack.targets.length > 0 && attack.targets.every((u) => !!env.state.pieces[u] && isVehicleDef(defOf(env, env.state.pieces[u]!)));
/** The A5.131 penalty of a target an ordnance shot aims at: the enemy Personnel excess in the target Location (in the MPh, the moving stack's). */
function shotTargetPenalty(env: QueryEnv, sc: ShotCtx, viewer?: SideId): number {
  if (sc.shot.targetType !== 'ITT' && sc.shot.targetType !== 'ATT') return 0;
  const enemy = otherSide(env.state, sc.side);
  if (env.state.phase === 'MPh' && !sc.moving?.length) return 0;
  return overstackBy(env, sc.target, enemy, viewer).personnel;
}

/**
 * The A5.11 MF for `movers` (Personnel of `side`; none for a vehicle) entering Location `loc`: each side's Personnel excess
 * there, counted with the movers, against its own limit, the enemy's as Known to `side`.
 */
export function overstackEntryMf(env: QueryEnv, loc: LocId, movers: PieceId[], side: SideId): number {
  const moving = new Set(movers);
  const own = [...occupants(env, loc, side).filter((p) => !moving.has(p.id)), ...movers.map((u) => pieceOf(env, u)).filter((p) => !!(mmc(env, p) || smc(env, p)))];
  const enemy = otherSide(env.state, side);
  const theirs = occupants(env, loc, enemy).filter((p) => isKnownTo(env, p, side));
  return excessOf(env, loc, side, own) + excessOf(env, loc, enemy, theirs);
}

export const aslOverstackingModule: RuleModule = {
  id: 'asl.overstacking',
  ref: 'ASLRB A5.1, A5.11, A5.12, A5.13, A5.131, A5.132, A5.2, A5.5, A5.6, A10.62, A12.14',
  summary: 'Overstacking: no stacking cap in play (but a pillbox), five SMC equal a HS, +1 MF per excess squad-equivalent on entry, +1 to the attacks of an overstacked side and -1 to attacks on it.',
  requires: ['sk1.movement', 'sk1.advance', 'sk1.rout'],
  install(r) {
    // A5.1: only a capacity (a pillbox, A5.6; a card's footbridge or Cave) refuses an entry in play.
    r.contribute({
      id: 'asl.overstack.cap',
      query: 'stack.cap',
      layer: Layer.Clamp,
      ref: 'ASLRB A5.1, A5.6, B30.111',
      apply: (v, { limit }) => (limit.capacity ? v : null),
    });

    // A5.11 in the MPh: after the terrain and the Bypass cost (layer 500), before the Infantry OVR doubling (900). A Bypass
    // step pays it in `asl/bypass.ts` (the Bypass position's own cost); clearing a minefield takes every MF anyway.
    r.contribute({
      id: 'asl.overstack.mf',
      query: 'move.stepCost',
      layer: 600,
      ref: 'ASLRB A5.11',
      label: '+1 MF per excess squad-equivalent (overstacked)',
      when: ({ ms, to, bypass, mines }, env) => !ms.vehicle && !bypass && mines !== 'clear' && to !== moveLoc(ms) && !(ms.bypass && hexOfLoc(to) === ms.bypass.hex) && (!!statics(env).map.hex(hexOfLoc(to)) || !ms.hex),
      apply: (v, { ms, to }, env) => v + overstackEntryMf(env, to, ms.units, env.state.attacker),
    });
    // A5.11: a vehicle pays one MP per Personnel excess in the hex it enters.
    r.contribute({
      id: 'asl.overstack.vehicleMp',
      query: 'vehicle.extraMp',
      ref: 'ASLRB A5.11',
      apply: (v, { vehicle, hex }, env) => v + overstackEntryMf(env, hex, [], pieceOf(env, vehicle).side),
    });
    // A5.11 in the APh: the advance costs it too (the EX: the second squad "will have to become CX").
    r.contribute({
      id: 'asl.overstack.advance',
      query: 'advance.cost',
      ref: 'ASLRB A5.11',
      apply: (v, { unit, units, to }, env) => v + overstackEntryMf(env, to, units, pieceOf(env, unit).side),
    });
    // A5.11 in the RtPh: the rout step (with the leaders routing along), and the nearest shelter is reckoned with it (Q&A
    // to A5.11 and A10.51); the stairs too (B23.4).
    const routers = (env: QueryEnv, unit: PieceId) => {
      const act = activeRout(env);
      return act?.unit === unit ? [unit, ...act.escort] : [unit];
    };
    r.contribute({
      id: 'asl.overstack.rout',
      query: 'rout.enterMf',
      ref: 'ASLRB A5.11, A10.51',
      apply: (v, { unit, to }, env) => v + overstackEntryMf(env, to, routers(env, unit), pieceOf(env, unit).side),
    });
    r.contribute({
      id: 'asl.overstack.routStairs',
      query: 'rout.stairsMf',
      ref: 'ASLRB A5.11, B23.4',
      apply: (v, { unit, to }, env) => v + overstackEntryMf(env, to, routers(env, unit), pieceOf(env, unit).side),
    });

    // ---------------------------------------------------------------- A5.2, A5.132: vehicles
    // A5.2: each side may have "only one vehicle in each Location without suffering overstacking penalties": more may end
    // the MPh together (the Starter Kit's end-of-MPh rule and its wreck flip are gone; SK4 3.3.2).
    r.contribute({ id: 'asl.overstack.vehicles', query: 'vehicle.overstackAllowed', ref: 'ASLRB A5.2', apply: () => true });
    // The firer chooses which of several enemy vehicles in a Location its Vehicle Target Type shot aims at.
    r.contribute({
      id: 'asl.overstack.vttTargets',
      query: 'ordnance.vttTargets',
      ref: 'ASLRB A5.2, C3.3',
      apply(v, { target, side }, env) {
        const enemy = vehiclesAt(env, target, otherSide(env.state, side), true).filter((p) => isKnownTo(env, p, side));
        return enemy.length > 1 ? enemy.map((p) => p.id).sort() : v;
      },
    });
    // A Vehicle Target Type shot at a Location holding several enemy vehicles must name its target (C3.3: the shot is at one
    // vehicle); none is taken for the firer.
    r.contribute({
      id: 'asl.overstack.vttNamed',
      query: 'ordnance.illegal',
      ref: 'ASLRB A5.2, C3.3',
      when: ({ shot }) => shot.targetType === 'VTT' && !shot.targetUnit,
      apply(v, { shot, side }, env) {
        if (v) return v;
        return env.query('ordnance.vttTargets', { target: shot.target, side }, []).length > 1 ? 'Several enemy vehicles there: name the one the shot aims at (ASLRB A5.2)' : null;
      },
    });
    r.event<StrayHitEvent>({ type: STRAY_HIT_EVENT, apply() {} });
    // A5.132: a Vehicle Target Type Final To Hit DR that exceeds the Modified To Hit Number by less than the vehicles in the
    // hex (not the firer, wrecks, or those out of its LOS) "may still possibly hit another (even friendly) vehicle": a dr
    // less than that number hits one of the others (Random Selection among two or more, each dr modified by the reverse of
    // its size modifier). The vehicles of both sides are counted, the missed target among them (the EX: a tank and two
    // Kuebelwagens; an Original 8 or 9 against a Modified TH# of 8, with the woods' +1, "will hit one of the Kuebelwagens
    // instead on a subsequent dr < 3"). The hit is that shot's hit on the other vehicle: its To Kill with the same
    // ammunition, its Hit Location from the same To Hit DR's colored dr, its own facing; no Critical Hit (the DR missed by
    // its own numbers). Never the Infantry or Area Target Type (C3.32 EX).
    r.procedure<ResolveHitFn>(OP.resolveHit, (next) => (ctx, sc, hit, targets, results) => {
      if (sc.shot.targetType !== 'VTT' || hit.hit || !sc.targetVehicle || targets.length === 0) return next!(ctx, sc, hit, targets, results);
      const th = toHitNumber(ctx, sc);
      const by = hit.original + hit.drm - (th?.th ?? Infinity);
      const there = vehiclesAt(ctx, sc.target, undefined, true).filter((v) => v.id !== sc.firerVehicle).sort(byId);
      const n = there.length;
      if (!th || by < 1 || by >= n) return next!(ctx, sc, hit, targets, results);
      const dr = ctx.roll(`A5.132: does the shot hit another vehicle in ${sc.target} (dr < ${n})?`, 1).total;
      const others = there.filter((v) => v.id !== sc.targetVehicle).map((v) => v.id);
      const struck = dr < n ? strayPick(ctx, others) : null;
      ctx.emit(STRAY_HIT_EVENT, { weapon: sc.weapon, firer: sc.firer, target: sc.targetVehicle, by, vehicles: n, dr, hit: struck });
      if (!struck) return next!(ctx, sc, hit, targets, results);
      return next!(ctx, { ...sc, targetVehicle: struck }, { ...hit, hit: true, ch: false }, [struck], results);
    });

    // ---------------------------------------------------------------- A12.14, A12.3: overstacked hidden units are revealed
    // A concealed unit that "becomes berserk/overstacked" while in the LOS of a Good Order enemy ground unit loses its "?"
    // (A12.14); hidden units are treated as concealed for it (A12.3; its Q&A lists overstacking among the involuntary losses
    // of hidden status). Out of such LOS the unit stays hidden, until such a unit comes to see it (Q&A to A12.14: units that
    // overstacked out of LOS lose concealment when enemy units later advance into LOS). Looked for after every move.
    const sweep = (ctx: Ctx) => {
      if (ctx.state.phase === 'setup') return;
      const hidden = Object.values(ctx.state.pieces).filter((p) => p.loc.kind === 'hex' && isHidden(p) && !!(mmc(ctx, p) || smc(ctx, p))).sort(byId);
      for (const p of hidden) {
        if (!isHidden(pieceOf(ctx, p.id))) continue;
        const loc = locOf(ctx.state, p)!;
        if (overstackBy(ctx, loc, p.side).personnel === 0 || !seenByGoodOrder(ctx, loc, p.side)) continue;
        revealUnit(ctx, p.id, 'overstacked');
      }
    };
    for (const event of ['piece.moved', 'piece.created']) r.on({ id: `asl.overstack.reveal.${event}`, event, handler: (ctx) => sweep(ctx) });

    // ---------------------------------------------------------------- A10.62: an overstacked unit may keep its DM
    // "If overstacked in a woods/building, it may also opt to retain its DM status": the woods/building refusal (the base
    // answer) gives way while its side overstacks its Location; a pillbox or trench refuses it still (their own answers,
    // which come after).
    r.contribute({
      id: 'asl.overstack.dmKeep',
      query: 'rally.dmKeepIllegal',
      layer: Layer.Base,
      ref: 'ASLRB A10.62',
      when: ({ unit }, env) => {
        const p = env.state.pieces[unit];
        const loc = p && p.loc.kind === 'hex' ? locOf(env.state, p) : null;
        return !!loc && !!terrainOf(env, hexOfLoc(loc)).routShelter && overstackBy(env, loc, p!.side).personnel > 0;
      },
      apply: () => null,
    });

    // ---------------------------------------------------------------- A5.12, A5.13, A5.131: attack and defense
    // A5.12: "All units attacking from or within a Location which their side has currently overstacked must add one to their
    // IFT/CC DR (or +1 to their To Hit DR for ordnance) for each vehicle and squad equivalent (FRU) by which they exceed
    // normal stacking limits", in every phase (A5.13 limits only the defense penalty). Ordnance takes it on the To Hit DR
    // (the IFT chart's footnote a: "Not applicable to ordnance"), LATW and the Area Target Type included (C5 "Other"). An
    // attack resolved on the IFT's Vehicle line takes neither penalty (A5.132). Residual FP takes none (it has no firer).
    // Hidden units the opponent does not know of make a secret part of it (shown when it decides the outcome).
    r.contribute({
      id: 'asl.overstack.firer',
      query: 'fire.drm',
      ref: 'ASLRB A5.12',
      label: ({ attack }, env) => `+${attackPenalty(env, attack)} overstacked firer (A5.12)`,
      when: ({ attack }, env) => !attack.ordnance && !attack.residual && !vehicleLine(env, attack) && attackPenalty(env, attack) > 0,
      secret: ({ attack }, env) => attackPenalty(env, attack, otherSide(env.state, attack.side)) !== attackPenalty(env, attack),
      apply: (v, { attack }, env) => v + attackPenalty(env, attack),
    });
    // A8.26: a positive DRM "caused solely by conditions outside" the target hex lowers the Residual FP left a column per +1.
    r.contribute({
      id: 'asl.overstack.residual',
      query: 'fire.residualOutside',
      ref: 'ASLRB A8.26, A5.12',
      when: ({ attack }) => attack.parts.length > 0 && attack.parts.every((p) => p.hex !== hexOfLoc(attack.target)),
      apply: (v) => [...v, 'asl.overstack.firer'],
    });
    // A5.131: Personnel "attacked in a Location their side has overstacked" -1 per excess squad-equivalent (FRU) on the IFT DR
    // ("when attacked by any other means" than ordnance, which takes it on the To Hit DR); per unit (A.5: a Melee Location
    // holds both sides). A5.13: in the MPh only the moving units suffer it.
    r.contribute({
      id: 'asl.overstack.target',
      query: 'fire.unitDrm',
      ref: 'ASLRB A5.131, A5.13',
      label: ({ unit }, env) => `-${targetPenalty(env, unit)} vs overstacked (A5.131)`,
      when: ({ attack, unit }, env) => !attack.ordnance && targetPenalty(env, unit) > 0,
      secret: ({ attack, unit }, env) => targetPenalty(env, unit, attack.side) !== targetPenalty(env, unit),
      apply: (v, { unit }, env) => v - targetPenalty(env, unit),
    });
    const shotFrom = (sc: ShotCtx) => sc.loc ?? sc.hex;
    r.contribute({
      id: 'asl.overstack.firer.th',
      query: 'ordnance.thDrm',
      ref: 'ASLRB A5.12, C5',
      label: (sc, env) => `+${firerPenalty(env, shotFrom(sc), sc.side)} overstacked firer (A5.12)`,
      when: (sc, env) => firerPenalty(env, shotFrom(sc), sc.side) > 0,
      secret: (sc, env) => firerPenalty(env, shotFrom(sc), sc.side, otherSide(env.state, sc.side)) !== firerPenalty(env, shotFrom(sc), sc.side),
      apply: (v, sc, env) => v + firerPenalty(env, shotFrom(sc), sc.side),
    });
    // A5.131: "-1 To Hit DRM vs ordnance"; never against a vehicle (A5.132: "not directly penalized").
    r.contribute({
      id: 'asl.overstack.target.th',
      query: 'ordnance.thDrm',
      ref: 'ASLRB A5.131, A5.13, C6',
      label: (sc, env) => `-${shotTargetPenalty(env, sc)} vs overstacked (A5.131)`,
      when: (sc, env) => shotTargetPenalty(env, sc) > 0,
      secret: (sc, env) => shotTargetPenalty(env, sc, sc.side) !== shotTargetPenalty(env, sc),
      apply: (v, sc, env) => v - shotTargetPenalty(env, sc),
    });
    // Close Combat: +1 to the attackers' DR, -1 against the overstacked side's units (A5.12, A5.131; the CC Table DRM).
    const ccSide = (env: QueryEnv, attackers: PieceId[]) => env.state.pieces[attackers[0] ?? '']?.side;
    const ccPenalty = (env: QueryEnv, hex: LocId, attackers: PieceId[]) => {
      const side = ccSide(env, attackers);
      return side ? firerPenalty(env, hex, side) : 0;
    };
    r.contribute({
      id: 'asl.overstack.cc',
      query: 'cc.drm',
      ref: 'ASLRB A5.12',
      label: ({ hex, attackers }, env) => `+${ccPenalty(env, hex, attackers)} overstacked attacker (A5.12)`,
      when: ({ hex, attackers }, env) => ccPenalty(env, hex, attackers) > 0,
      apply: (v, { hex, attackers }, env) => v + ccPenalty(env, hex, attackers),
    });
    r.contribute({
      id: 'asl.overstack.ccTarget',
      query: 'cc.targetDrm',
      ref: 'ASLRB A5.131, A5.13',
      label: ({ target }, env) => `-${targetPenalty(env, target)} vs overstacked (A5.131)`,
      when: ({ target }, env) => targetPenalty(env, target) > 0,
      apply: (v, { target }, env) => v - targetPenalty(env, target),
    });
  },
};
