import type { Action, Ctx, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, hexOf, isPersonnelDef, otherSide, personnelAt, statics, swHeldBy } from '../common/pieces';
import { hexOfLoc, locExists, locOf, type LocId } from '../common/location';
import { capturedUseExempt, targetThDrm } from '../sk1/forceRules';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import type { AmmoKind, GunDef, IftResult, Mount } from '../common/statics';
import {
  FP,
  fpfCheck,
  iftColumn,
  markFirers,
  onRoadInTheOpen,
  onWoodsRoad,
  outsideDrm,
  residualFpLeft,
  type ApplyResultFn,
  type AttackResolvedFn,
  type FireAttackCtx,
  type FireDeclaration,
  type FireMode,
  type ResolveFireFn,
} from '../sk1/fire';
import { PHASE_FIRE_MODE, fireTargets, phaseOwner } from '../sk1/firePhases';
import { P as MP, type CasualtyFn, type CheckGroupFn, type FlushFn, type RandomSelectFn } from '../sk1/morale';
import { FIRST_FIRE, finishDefensiveFire, firstFireIllegal, firstFireTargets, firstFireMode, moveLoc, moveState, movingInfo, plausibleShot, recordRofChoice } from '../sk1/movement';
import { hasLos, visibleEnemyAt, isKnownTo, knownEnemyAt } from '../sk1/known';
import {
  T,
  drmNotes,
  fireMarker,
  gun,
  gunHeldBy,
  hasDm,
  inMelee,
  isBroken,
  isCaptured,
  isCx,
  isGoodOrder,
  isMalf,
  isPinned,
  mmc,
  pieceOf,
  setTags,
  sideNationalities,
  smc,
  vehicleIfe,
  actionIllegal,
} from '../sk1/status';
import { smoke58Counters, smoke58Markers, terrainOf } from '../sk1/terrain';
import { AMMO_NAME, AMMO_OUT, ammoColumn, ammoKinds, ammoOut, ammoStatus, defaultAmmo, isSmokeAmmo, leavesResidual, specialAmmoOf } from './ammo';
import { caChangeDrm, inCoveredArc, mountLabel, nearestSpine, spineChange } from './arc';
import { emplacementThDrm, revealGun } from './guns';
import { T2, caTurnedIllegal, coveredArc, isHidden, ACQ_CLEAR, acquisitionOf, ordnanceHeldBy, ordnanceOf } from './status';

/*
 * Ordnance (SK4 3.2.4, 6.0–6.12): a Gun must secure a hit on the To Hit Chart before its effect
 * is resolved on the IFT. One action, `fire.ordnance`, fires a Gun in every way it can: on the
 * Infantry Target Type (TEM on the To Hit DR), the Area Target Type (red TH#, TEM on the IFT DR,
 * half the column, no ROF for a non-mortar) or as Infantry Firepower Equivalent (IFE, 6.8: on the
 * IFT like a MG, through the ordinary fire procedure). `defFire.ordnance` is the same during the
 * enemy MPh. The Gun may turn to face its target first (case 8 DRM) and, having lost ROF, fire
 * once more as Intensive Fire (+2, B# -2). The shot names its ammunition (`ammo.ts`): HE by default,
 * AP, Special Ammo with its depletion, or Smoke/WP that place a ⅝" counter instead of attacking.
 */

export type TargetType = 'ITT' | 'ATT' | 'IFE' | 'VTT';

export interface OrdnanceShot {
  /** The Gun (or the vehicle whose Main Armament fires, SK3). */
  weapon: PieceId;
  /** The target Location (a hex id at ground level). */
  target: LocId;
  targetType: TargetType;
  /** Vehicle Target Type (SK4 3.2.4): the vehicle aimed at (the one enemy vehicle in the hex when absent). */
  targetUnit?: PieceId;
  /** Turn the Gun to this hexspine before firing (SK4 3.2.4). */
  ca?: number;
  /** Intensive Fire after losing ROF this phase (3.2.4). */
  intensive?: boolean;
  /** A leader in the Gun's hex directing the shot (leadership DRM on the To Hit DR). */
  director?: PieceId;
  /** The ammunition announced before the To Hit DR (SK4 6.2); HE (AP for a Gun without HE) when absent. */
  ammo?: AmmoKind;
  /**
   * A BAZ/PSK fired from inside a building (SK4 4.4.3): true takes the Backblast attack on the firer's
   * hex instead of the +2 To Hit DRM (a pinned firer must take it).
   */
  backblast?: boolean;
}

/** Everything the To Hit queries need to know about a shot. */
export interface ShotCtx {
  shot: OrdnanceShot;
  side: SideId;
  mode: FireMode;
  weapon: PieceId;
  def: GunDef;
  firer: PieceId;
  hex: HexId;
  /** The firing Location where it is not the hex itself (a SW such as a PSK fired from an upper level): LOS starts there. */
  loc?: LocId;
  /** The target Location (a hex id at ground level). */
  target: LocId;
  range: number;
  /** Hexspine changes made for this shot. */
  spines: number;
  /** Defensive First Fire vs these moving units. */
  moving?: PieceId[];
  movingInfo?: FireAttackCtx['moving'];
  hindrance: number;
  nonQualified: boolean;
  captured: boolean;
  /** The ammunition the shot uses. */
  ammo: AmmoKind;
  /** A vehicle's Main Armament firing (SK3): the vehicle piece. */
  firerVehicle?: PieceId;
  /** The vehicle a Vehicle Target Type shot is aimed at. */
  targetVehicle?: PieceId;
}

/** What a resolved To Hit roll hands to the hit resolution (`OP.resolveHit`). */
export interface HitInfo {
  hit: boolean;
  ch: boolean;
  dice: [number, number];
  original: number;
  drm: number;
  mode: FireMode;
  movingInfo?: FireAttackCtx['moving'];
}

export interface OrdnanceOutcome {
  hit: boolean;
  ch: boolean;
  th: number | null;
  dr: [number, number];
  drm: number;
  rofKept: boolean;
  malfunctioned: boolean;
  removed: boolean;
  results: Record<PieceId, IftResult>;
  blocked?: string;
  /** The Gun never had the Special Ammo it announced and has not fired (SK4 6.2). */
  noAmmo?: boolean;
  /** Defensive fire with ROF kept: the Residual FP the hit would leave if the Gun chose not to retain its ROF (SK4 3.3.5). */
  rofResidual?: number;
}

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Why an ordnance shot is illegal, or null. */
    'ordnance.illegal': { ctx: { shot: OrdnanceShot; mode: FireMode; side: SideId; moving?: PieceId[] }; value: string | null };
    /** To Hit DRM of a shot (chart cases 1–25 as they apply). */
    'ordnance.thDrm': { ctx: ShotCtx; value: number };
    /** Whether the shot uses the red To Hit numbers. */
    'ordnance.redTh': { ctx: ShotCtx; value: boolean };
    /** Effective ROF for the shot. */
    'ordnance.rof': { ctx: ShotCtx; value: number };
    /** Effective breakdown number for the shot (original TH DR ≥ it malfunctions the Gun). */
    'ordnance.breakdown': { ctx: ShotCtx; value: number };
    /** Added to the final To Hit DR besides the DRM (SK3 case 16: the lower die again for Motion/Non-Stopped fire). */
    'ordnance.thExtra': { ctx: { sc: ShotCtx; dice: [number, number] }; value: number };
    /** Whether this shot gains Target Acquisition (never Bounding First Fire or a Motion vehicle, SK4 6.10). */
    'ordnance.acquires': { ctx: ShotCtx; value: boolean };
    /** Whether a special rule lets this leader modify this Gun's To Hit DR as if it were a SW (S23 SSR 2); never by default (ASL A7.531). */
    'ordnance.leaderDirects': { ctx: { weapon: PieceId; leader: PieceId }; value: boolean };
    /** Why a vehicle's Main Armament may not fire this shot, or null (SK3; replaces the Gun's manning checks). */
    'ordnance.maIllegal': { ctx: { shot: OrdnanceShot; mode: FireMode; side: SideId; moving?: PieceId[] }; value: string | null };
  }
}

export const OP = {
  /** (ctx, shot, mode, opts) => OrdnanceOutcome */
  fire: 'sk2.ordnance.fire',
  /** (ctx, sc, hit, targets, results) => IFT columns used (for Residual FP): the effect of a To Hit roll. SK3 wraps it for the Vehicle Target Type. */
  resolveHit: 'sk2.ordnance.resolveHit',
} as const;
export type ResolveHitFn = (ctx: Ctx, sc: ShotCtx, hit: HitInfo, targets: PieceId[], results: Record<PieceId, IftResult>) => number[];

export type OrdnanceFireFn = (
  ctx: Ctx,
  shot: OrdnanceShot,
  mode: FireMode,
  opts?: { moving?: PieceId[]; movingInfo?: FireAttackCtx['moving'] },
) => OrdnanceOutcome;

export type OrdnanceAction = Action & { shot: OrdnanceShot };

/** The year of the scenario, from its dateline ("26 April 1941"); undefined when not given. */
const scenarioYear = (env: QueryEnv): number | undefined => {
  const m = /\b(19\d\d)\b/.exec(statics(env).scenario.date ?? '');
  return m ? Number(m[1]) : undefined;
};

/** Build the shot context (no legality checks). */
export function shotContext(env: QueryEnv, shot: OrdnanceShot, mode: FireMode, side: SideId, opts: { moving?: PieceId[]; movingInfo?: FireAttackCtx['moving'] } = {}): ShotCtx {
  const g = pieceOf(env, shot.weapon);
  const def = ordnanceOf(env, g)!;
  const firer = g.loc.kind === 'held' ? g.loc.by : g.id;
  const hex = hexOf(env.state, g)!;
  const loc = locOf(env.state, g)!;
  const map = statics(env).map;
  const range = map.distance(hex, hexOfLoc(shot.target));
  const spines = shot.ca !== undefined ? spineChange(coveredArc(g), shot.ca) : 0;
  const los = env.query('los.trace', { from: loc, to: shot.target }, { clear: true, hindrance: 0, parts: [] });
  const manner = env.state.pieces[firer];
  const targetVehicle = shot.targetType === 'VTT' ? (shot.targetUnit ?? enemyVehicleAt(env, shot.target, side)?.id) : undefined;
  return {
    shot,
    side,
    mode,
    weapon: g.id,
    def,
    firer,
    hex,
    ...(loc !== hex ? { loc } : {}),
    target: shot.target,
    range,
    spines,
    ...(opts.moving ? { moving: opts.moving } : {}),
    ...(opts.movingInfo ? { movingInfo: opts.movingInfo } : {}),
    hindrance: los.hindrance,
    // Any squad, HS or SMC fires a Light Mortar with no detriment (SK4 4.5); a vehicle's crew mans its own MA.
    nonQualified: !def.light && !def.vehicle && (!manner || mmc(env, manner)?.kind !== 'crew'),
    // A special rule may let some units fire a captured weapon without the penalties (S27 SSR 3).
    captured: isCaptured(env, g) && !capturedUseExempt(env, g.id, firer),
    // Against a vehicle the natural round is AP (SK4 6.2); HE where the weapon has no AP.
    ammo: shot.ammo ?? (shot.targetType === 'VTT' && def.ammo.ap && !def.latw ? 'AP' : defaultAmmo(env, g, def)),
    ...(def.vehicle ? { firerVehicle: g.id } : {}),
    ...(targetVehicle ? { targetVehicle } : {}),
  };
}

/** The one enemy vehicle (not a wreck) in a hex, if any (SK4 3.3.2: a side has one vehicle per hex). */
export function enemyVehicleAt(env: QueryEnv, hex: HexId, side: SideId): Piece | undefined {
  return Object.values(env.state.pieces)
    .filter((p) => p.side !== side && locOf(env.state, p) === hex && defOf(env, p).kind === 'vehicle' && p.tags['wreck'] !== true)
    .sort(byId)[0];
}

/** The To Hit number and Critical Hit number of a shot, or null when the chart has no entry. */
export function toHitNumber(env: QueryEnv, sc: ShotCtx): { th: number; ch: number; red: boolean } | null {
  if (sc.shot.targetType === 'IFE') return null;
  // A LATW's own To Hit Table (counter back), at Infantry or a vehicle; its Critical Hit is an original 2 that hits (SK4 6.1).
  if (sc.def.latw) {
    const th = sc.shot.targetType === 'ITT' || sc.shot.targetType === 'VTT' ? sc.def.latw.th[sc.range] : undefined;
    return th === undefined ? null : { th, ch: 2, red: false };
  }
  const entry = statics(env).tables.toHit(sc.def, sc.shot.targetType, sc.range);
  if (!entry) return null;
  const red = env.query('ordnance.redTh', sc, false);
  // A MG firing as ordnance has no Critical Hit (chart note Ω).
  const noCh = sc.def.type === 'MG';
  return { th: red ? (entry.red ?? entry.black) : entry.black, ch: noCh ? 0 : red ? (entry.chRed ?? entry.ch) : entry.ch, red };
}

/** Targets of a shot at a hex: the moving stack during the MPh, otherwise the enemy personnel there (everyone in a Melee hex). */
function shotTargets(env: QueryEnv, side: SideId, target: HexId, moving?: PieceId[], targetVehicle?: PieceId): PieceId[] {
  // A Vehicle Target Type hit affects that vehicle alone (SK4 3.2.4).
  if (targetVehicle) return env.state.pieces[targetVehicle]?.loc.kind === 'hex' ? [targetVehicle] : [];
  // A mover wrecked on its way is no longer a target (sk1 buildAttack).
  if (moving) return moving.filter((u) => env.state.pieces[u]?.loc.kind === 'hex' && env.state.pieces[u]?.tags['wreck'] !== true);
  return (inMelee(env, target) ? personnelAt(env, target) : personnelAt(env, target, otherSide(env.state, side))).map((p) => p.id).sort();
}

/**
 * A Panzerfaust hit on Infantry affects one unit in the hex (SK4 4.4.2): the one the firer named when it
 * mans a Gun or SW (`shot.targetUnit`), otherwise one picked at random (a dr until it falls on one).
 */
function pfTarget(ctx: Ctx, sc: ShotCtx, targets: PieceId[]): PieceId[] {
  if (sc.def.type !== 'PF' || sc.shot.targetType !== 'ITT' || targets.length <= 1) return targets;
  const named = sc.shot.targetUnit;
  if (named && targets.includes(named) && swHeldBy(ctx.state, named).length > 0) return [named];
  for (;;) {
    const dr = ctx.roll(`Panzerfaust: which unit (1-${targets.length})`, 1).total;
    if (dr <= targets.length) return [targets[dr - 1]!];
  }
}

/** The leadership DRM a directing leader gives the firer (his printed DRM, as the rules adjust it). */
const directorDrm = (env: QueryEnv, leader: PieceId, firer: PieceId) => env.query('unit.leadership', { unit: leader, for: firer }, smc(env, pieceOf(env, leader))?.leadership ?? 0);

/** A BAZ, PSK (or PF) fired from inside a building brings Backblast or the +2 DRM; a PIAT does not (SK4 4.4.3). */
const hasBackblast = (def: GunDef) => !!def.latw && def.type !== 'PIAT';
/** A building a BAZ/PSK fired from has Backblast (SK4 4.4.3), except a PTO hut (SK4 8.2.1: "no Backblast penalty for firing from a hut"). */
const backblastHex = (env: QueryEnv, hex: HexId) => isBuildingHex(env, hex) && !terrainOf(env, hex).building;
/** A Light Anti-Tank Weapon (SK4 4.4): a BAZ/PSK/PIAT on its own To Hit Table, or an ATR (4.4.4) on the chart's ATR row. */
const isLatw = (def: GunDef) => !!def.latw || def.type === 'ATR';

/**
 * Why a leader may not modify this weapon's To Hit DR, or null. A leader affects the To Hit DR of
 * ordnance SW only, a Light Mortar or a LATW (ASL A7.531; SK4 is silent), never a Gun's or a
 * vehicle's, unless a special rule says so (`ordnance.leaderDirects`, S23 SSR 2). He must stand in the
 * weapon's hex, Good Order and unpinned, not have used a weapon himself, and not fire it himself.
 */
export function ordnanceDirectorIllegal(env: QueryEnv, weapon: PieceId, leader: PieceId, side: SideId, targetType: TargetType): string | null {
  const g = env.state.pieces[weapon];
  const def = g ? ordnanceOf(env, g) : null;
  const l = env.state.pieces[leader];
  if (!g || !def) return 'Not a Gun';
  if (!l || !smc(env, l) || l.side !== side) return 'Director must be a friendly leader';
  if (targetType === 'IFE') return 'Leadership never modifies IFE';
  if (!def.light && !def.latw && !env.query('ordnance.leaderDirects', { weapon, leader }, false)) return 'A leader modifies the To Hit DR of SW ordnance only, never a Gun\'s (ASL A7.531)';
  return swDirectorIllegal(env, leader, side, hexOf(env.state, g), g.loc.kind === 'held' ? g.loc.by : g.id);
}

/**
 * The leader's side of directing an ordnance SW shot fired from `hex` by `firer` (ASL A7.531): a friendly leader in
 * that hex, Good Order and unpinned, who has not used a weapon this phase and is not the firer. Shared with the
 * Panzerfaust, whose weapon only exists once its check is made.
 */
export function swDirectorIllegal(env: QueryEnv, leader: PieceId, side: SideId, hex: HexId | null | undefined, firer: PieceId): string | null {
  const l = env.state.pieces[leader];
  if (!l || !smc(env, l) || l.side !== side) return 'Director must be a friendly leader';
  if (hexOf(env.state, l) !== hex) return 'Director must be in the firer\'s hex';
  if (isBroken(l) || isPinned(l) || !isGoodOrder(env, l)) return 'Director must be Good Order and unpinned';
  if (l.tags[T.firedSw]) return 'A leader who used a weapon this phase cannot direct fire';
  if (firer === l.id) return 'A leader cannot direct his own fire';
  return null;
}

/**
 * Why a Gun, Mortar or LATW cannot fire at all in `mode`, whatever the target: who mans it, a malfunction, having
 * moved or been manhandled before the AFPh. The wheel greys its "Fire …" entry with this reason (otherwise
 * a Mortar that moved can be lined up in the AFPh, and only the shot itself says it cannot fire).
 * Not for a vehicle's Main Armament, which the vehicle rules judge.
 */
export function ordnanceWeaponIllegal(env: QueryEnv, weapon: PieceId, mode: FireMode, side: SideId): string | null {
  const g = env.state.pieces[weapon];
  const def = g ? ordnanceOf(env, g) : null;
  if (!g || !def || def.vehicle) return null;
  const what = def.latw ? def.type : def.light ? 'Mortar' : 'Gun';
  if (g.side !== side) return `Not your ${what}`;
  if (g.loc.kind !== 'held') return def.light ? `Nobody possesses the ${what}` : 'The Gun is not manned';
  const manner = pieceOf(env, g.loc.by);
  if (!mmc(env, manner) && !(def.light && smc(env, manner))) return 'Only a MMC may fire a Gun';
  if (!isGoodOrder(env, manner)) return `The ${def.light ? 'possessing' : 'manning'} unit is not in Good Order`;
  if (isMalf(g)) return `The ${what} is malfunctioned`;
  const turned = caTurnedIllegal(env, g) ?? caTurnedIllegal(env, manner);
  if (turned) return turned;
  if (mode === 'advancing' && !isLatw(def) && (g.tags[T.moved] || manner.tags[T.moved])) return `A ${def.light ? 'Mortar' : 'Gun'} that moved cannot fire in the AFPh`;
  if (mode === 'advancing' && (g.tags[T2.manhandled] || manner.tags[T2.manhandled])) return 'A manhandled Gun cannot fire in the AFPh';
  return null;
}

function ordnanceIllegal(env: QueryEnv, shot: OrdnanceShot, mode: FireMode, side: SideId, moving?: PieceId[]): string | null {
  const g = env.state.pieces[shot.weapon];
  const def = g ? ordnanceOf(env, g) : null;
  if (!g || !def) return 'Not a Gun';
  const what = def.vehicle ? 'Main Armament' : def.latw ? def.type : def.light ? 'Mortar' : 'Gun';
  if (g.side !== side) return `Not your ${what}`;
  let manner: Piece;
  if (def.vehicle) {
    // A vehicle's MA is manned by its inherent crew (SK4 7.2): the vehicle rules say whether it may fire.
    const why = env.query('ordnance.maIllegal', { shot, mode, side, ...(moving ? { moving } : {}) }, null);
    if (why) return why;
    manner = g;
  } else {
    if (g.loc.kind !== 'held') return def.light ? `Nobody possesses the ${what}` : 'The Gun is not manned';
    manner = pieceOf(env, g.loc.by);
    // A Light Mortar is fired by a squad, HS or SMC (SK4 4.5); a Gun by a MMC.
    if (!mmc(env, manner) && !(def.light && smc(env, manner))) return 'Only a MMC may fire a Gun';
    // A BAZ is fired by any unbroken Infantry MMC, or by two SMC; never by a single SMC (SK4 4.4.1). A PIAT
    // may be used by a SMC at full effect (4.4.5), a PF by a SMC that passes its PF check (+2, 4.4.2).
    if (def.latw && def.type !== 'PIAT' && def.type !== 'PF' && smc(env, manner) && !personnelAt(env, locOf(env.state, manner)!, side).some((p) => p.id !== manner.id && smc(env, p) && isGoodOrder(env, p) && !isPinned(p))) {
      return `A single SMC may not fire a ${what}`;
    }
    if (!isGoodOrder(env, manner)) return `The ${def.light ? 'possessing' : 'manning'} unit is not in Good Order`;
  }
  if (isMalf(g)) return `The ${what} is malfunctioned`;
  const turned = caTurnedIllegal(env, g) ?? caTurnedIllegal(env, manner);
  if (turned) return turned;
  const map = statics(env).map;
  if (!locExists(env, shot.target)) return 'Unknown target hex';
  const sc = shotContext(env, shot, mode, side, moving ? { moving } : {});
  if (sc.range === 0 && shot.targetType !== 'VTT') return 'Cannot fire into own hex';
  if (shot.targetType === 'VTT') {
    // The Vehicle Target Type is fired at one enemy vehicle that is not a wreck (SK4 3.2.4); never by a Mortar.
    const tv = sc.targetVehicle ? env.state.pieces[sc.targetVehicle] : undefined;
    if (!tv || locOf(env.state, tv) !== shot.target || tv.side === side || defOf(env, tv).kind !== 'vehicle') return 'No enemy vehicle there to aim at';
    if (tv.tags['wreck']) return 'That vehicle is a wreck';
    if (!env.query('piece.visibleTo', { piece: tv.id, viewer: side }, true)) return 'No target there';
    if (def.type === 'MTR') return 'A Mortar cannot use the Vehicle Target Type';
  }
  if (def.light) {
    // A SW has no Covered Arc (SK4 4.5).
    if (shot.ca !== undefined) return `A ${def.latw ? def.type : 'Light Mortar'} has no Covered Arc`;
  } else if (shot.ca !== undefined) {
    if (!Number.isInteger(shot.ca) || shot.ca < 0 || shot.ca > 5) return 'Covered Arc is a hexspine 0-5';
    if (isPinned(manner)) return 'A pinned Gun cannot change its Covered Arc';
    if (!inCoveredArc(map.hex(sc.hex)!.cube, shot.ca, map.hex(hexOfLoc(shot.target))!.cube)) return 'The target is outside the new Covered Arc';
  } else if (!inCoveredArc(map.hex(sc.hex)!.cube, coveredArc(g), map.hex(hexOfLoc(shot.target))!.cube)) {
    return 'The target is outside the Covered Arc (turn the Gun first)';
  }
  if (sc.def.minRange !== undefined && sc.range < sc.def.minRange) return 'Inside the minimum range';
  if (sc.def.maxRange !== undefined && sc.range > sc.def.maxRange) return 'Beyond the maximum range';
  // A LATW may Advancing Fire after moving (+2, chart case 12); a Gun or Mortar that moved may not.
  if (mode === 'advancing' && !isLatw(def) && !def.vehicle && (g.tags[T.moved] || manner.tags[T.moved])) return `A ${def.light ? 'Mortar' : 'Gun'} that moved cannot fire in the AFPh`;
  if (mode === 'advancing' && (g.tags[T2.manhandled] || manner.tags[T2.manhandled])) return 'A manhandled Gun cannot fire in the AFPh';
  if (shot.director !== undefined) {
    const why = ordnanceDirectorIllegal(env, shot.weapon, shot.director, side, shot.targetType);
    if (why) return why;
  }
  // A Mortar may not fire from a building (SK4 1.1.1, 6.9).
  if (sc.def.type === 'MTR' && isBuildingHex(env, sc.hex)) return 'A Mortar may not fire from a building';
  if (sc.def.type === 'MTR' && shot.targetType !== 'ATT') return 'A Mortar must use the Area Target Type';
  if (sc.def.latw && shot.targetType !== 'ITT' && shot.targetType !== 'VTT') return `A ${sc.def.type} fires on its own To Hit Table at units (Infantry Target Type) or at a vehicle`;
  if (shot.backblast !== undefined && !(hasBackblast(sc.def) && backblastHex(env, sc.hex))) return 'Backblast only arises firing a BAZ or PSK from inside a building';
  if (hasBackblast(sc.def) && backblastHex(env, sc.hex) && isPinned(manner) && shot.backblast === false) return 'A pinned firer cannot take the +2 to avoid Backblast';
  // SK4 4.4.5: "A PIAT may not fire at a unit one level lower and in an adjacent hex."
  if (sc.def.type === 'PIAT' && sc.range === 1 && (map.hex(hexOfLoc(shot.target))!.elevation ?? 0) === (map.hex(sc.hex)!.elevation ?? 0) - 1) return 'A PIAT may not fire at an adjacent unit one level lower';
  const marker = fireMarker(g);
  if (shot.targetType === 'IFE') {
    if (!sc.def.ife) return 'The Gun has no Infantry Firepower Equivalent';
    if (shot.ammo !== undefined) return 'IFE fires no ammunition';
    const decl = ifeDeclaration(env, shot, sc);
    return env.query('fire.illegal', { decl, mode, side, ...(moving ? { moving } : {}) }, null);
  }
  const why = ammoIllegal(env, g, sc, mode, side);
  if (why) return why;
  if (!toHitNumber(env, sc)) return sc.shot.targetType === 'ATT' ? 'This Gun cannot use the Area Target Type at that range' : sc.shot.targetType === 'VTT' ? 'The Vehicle Target Type has no To Hit number at that range' : 'Out of range';
  // ITT needs a Known Enemy Unit; the ATT may fire at any hex (SK4 6.11), hidden Guns included (+2, 6.4).
  if (!moving && shot.targetType === 'ITT' && knownEnemyAt(env, shot.target, side).length === 0) return 'No target there';
  if (g.tags[T2.intensive]) return 'The Gun has used Intensive Fire this Player Turn';
  if (shot.intensive) {
    if (def.light) return 'A SW cannot use Intensive Fire';
    if (sc.def.noIntensive) return 'This Gun may not use Intensive Fire ("No IF" on the counter)';
    if (!marker) return 'Intensive Fire is only possible after the Gun has fired and lost ROF';
    if (mode === 'advancing') return 'No Intensive Fire in the AFPh';
    if (mode === 'final' && sc.range > 1) return 'Intensive Fire in the DFPh is only possible against an adjacent hex';
    if (isPinned(manner)) return 'A pinned Gun cannot use Intensive Fire';
  } else {
    switch (mode) {
      case 'prep':
      case 'advancing':
      case 'first':
        if (marker) return 'The Gun has already fired this phase';
        break;
      case 'subsequentFirst':
      case 'fpf':
        return def.light ? 'A Light Mortar marked First Fire cannot fire again this MPh' : 'A Gun marked First Fire may only fire again as Intensive Fire';
      case 'final':
        if (marker) return 'The Gun has already fired this Player Turn';
        break;
      case 'bounding':
        // Bounding First Fire again only with ROF kept, after another MP (SK4 3.3.2.2): the vehicle rules decide.
        if (marker && marker !== 'bff') return 'The vehicle has already fired this Player Turn';
        break;
    }
  }
  return null;
}

/** A second Good Order friendly SMC in the firer's hex, so a SMC's Light Mortar is not fired by a lone SMC (SK4 4.5). */
const otherSmcHelps = (env: QueryEnv, sc: ShotCtx) =>
  personnelAt(env, locOf(env.state, pieceOf(env, sc.firer)) ?? sc.hex, sc.side).some((p) => p.id !== sc.firer && smc(env, p) && isGoodOrder(env, p) && !isPinned(p));

/** Case 8: the Covered Arc change DRM, doubled for a firer in a building. */
const caDrm = (env: QueryEnv, hex: HexId, mount: Mount, spines: number) => caChangeDrm(mount, spines) * (isBuildingHex(env, hex) ? 2 : 1);
const ifeCaDrm = (env: QueryEnv, attack: FireAttackCtx) => {
  const hex = hexOf(env.state, pieceOf(env, attack.caChange!.weapon));
  return hex ? caDrm(env, hex, attack.caChange!.mount, attack.caChange!.spines) : caChangeDrm(attack.caChange!.mount, attack.caChange!.spines);
};

const isBuildingHex = (env: QueryEnv, hex: HexId) => !!statics(env).map.hex(hex)?.buildingId || terrainOf(env, hex).id.startsWith('building');

/**
 * Whether a Gun may fire this ammunition on this Target Type now, whatever the target (SK4 3.2.4,
 * 6.2): available at this date and not depleted; Smoke and WP only on the Area Target Type,
 * AP/HEAT/APCR/APDS never on it; Smoke at the start of the PFPh/DFPh (before the Gun fires
 * anything else that phase), WP then or as Defensive First Fire.
 */
export function ammoUseIllegal(env: QueryEnv, g: Piece, def: GunDef, ammo: AmmoKind, targetType: TargetType, mode: FireMode): string | null {
  const st = ammoStatus(env, g, def, ammo);
  if (!st.available) return st.why ?? `No ${AMMO_NAME[ammo]}`;
  if (targetType === 'IFE') return 'IFE fires no ammunition';
  if (targetType === 'ATT') {
    if (ammo !== 'HE' && !isSmokeAmmo(ammo)) return `${AMMO_NAME[ammo]} cannot be fired on the Area Target Type`;
  } else if (isSmokeAmmo(ammo)) return `${AMMO_NAME[ammo]} is fired on the Area Target Type`;
  if (ammo === 'SMOKE' && mode !== 'prep' && mode !== 'final') return 'Smoke is fired at the start of the PFPh or DFPh';
  if (ammo === 'WP' && mode === 'advancing') return 'WP is fired at the start of the PFPh or DFPh, or as Defensive First Fire';
  if (isSmokeAmmo(ammo) && (mode === 'prep' || mode === 'final') && g.tags[T2.firedNonSmoke]) return `${AMMO_NAME[ammo]} must be fired before the Gun fires anything else this phase`;
  if (targetType === 'VTT') return null;
  if (!isSmokeAmmo(ammo) && ammoColumn(env, def, ammo, targetType, false) === null) return `This Gun has no ${targetType} column`;
  return null;
}

/** The ammunition check of a shot: `ammoUseIllegal`, and HEAT only at Infantry in a building or at a Gun. */
function ammoIllegal(env: QueryEnv, g: Piece, sc: ShotCtx, mode: FireMode, side: SideId): string | null {
  const why = ammoUseIllegal(env, g, sc.def, sc.ammo, sc.shot.targetType, mode);
  if (why) return why;
  if (sc.ammo === 'HEAT' && sc.shot.targetType !== 'VTT' && !isBuildingHex(env, hexOfLoc(sc.shot.target)) && !enemyGunAt(env, sc.shot.target, side)) return 'HEAT may only be fired at Infantry in a building or at a Gun (or at a vehicle)';
  // SK4 8.2.1: "HEAT cannot be used against Infantry in a hut."
  if (sc.ammo === 'HEAT' && sc.shot.targetType === 'ITT' && terrainOf(env, sc.shot.target).building && !enemyGunAt(env, sc.shot.target, side)) return 'HEAT cannot be used against Infantry in a hut';
  return null;
}

const enemyGunAt = (env: QueryEnv, hex: HexId, side: SideId) =>
  Object.values(env.state.pieces).some((p) => p.side !== side && p.loc.kind !== 'eliminated' && gun(env, p) && locOf(env.state, p) === hex);

/** A Gun's IFE shot as an ordinary fire declaration (the Gun alone; no leadership, SK4 6.8). */
export function ifeDeclaration(env: QueryEnv, shot: OrdnanceShot, sc: ShotCtx): FireDeclaration {
  return {
    units: [],
    sw: [shot.weapon],
    target: shot.target,
    ...(sc.spines > 0 ? { caChange: { weapon: shot.weapon, spines: sc.spines, mount: sc.def.mount } } : {}),
  };
}

/** Residual FP left by an ordnance hit (SK4 3.3.5): half the column, one column less per positive outside DRM. */
function placeOrdnanceResidual(ctx: Ctx, target: HexId, column: number, outsidePoints: number, bonusColumns = 0) {
  const fp = residualFpLeft(ctx, column, outsidePoints, bonusColumns);
  const existing = (ctx.state.hexMarkers[target]?.['residualFp'] as number | undefined) ?? 0;
  if (fp > existing) ctx.emit('hex.marker', { hex: target, key: 'residualFp', value: fp });
}

/**
 * A Smoke or WP hit places a ⅝" counter in the target hex (SK4 1.2.5, 6.2): full in the PFPh (+3
 * Smoke, +2 WP), Dispersed in the DFPh or as Defensive First Fire (+2 Smoke, +1 WP). It joins any
 * counters already there: there is no limit on SMOKE counters in a hex, and their DRM add up to at most
 * +3 (ASLRB A24.2), each dispersing on its own side's schedule.
 */
function placeOrdnanceSmoke(ctx: Ctx, hex: HexId, ammo: AmmoKind, mode: FireMode, side: SideId) {
  const kind = ammo === 'WP' ? 'wp' : 'smoke';
  const dispersed = mode !== 'prep';
  const m = ctx.state.hexMarkers[hex];
  for (const e of smoke58Markers(hex, m, [...smoke58Counters(m), { kind, dispersed, side }])) ctx.emit('hex.marker', e);
  ctx.emit('sk2.smoke.placed', { hex, kind, dispersed, side });
}

/**
 * Units hit by WP take a NMC with the TEM subtracted from the DR; a Mortar's Air Burst in woods adds
 * +1 instead; a WP Critical Hit adds the positive TEM (SK4 6.2).
 */
function wpEffect(ctx: Ctx, sc: ShotCtx, targets: PieceId[], ch: boolean) {
  const units = targets.filter((u) => ctx.state.pieces[u]?.loc.kind === 'hex');
  if (units.length === 0) return;
  const tem = ctx.query('hex.tem', { hex: sc.target }, 0);
  const airBurst = sc.def.type === 'MTR' && !!terrainOf(ctx, sc.target).airBursts;
  const mod = airBurst ? 1 : ch ? Math.max(0, tem) : -tem;
  ctx.emit('sk2.ordnance.wp', { weapon: sc.weapon, target: sc.target, units, mod, ch, airBurst });
  ctx.proc<CheckGroupFn>(MP.checkGroup)(ctx, units, { kind: 'MC', mod, reason: ch ? 'WP Critical Hit NMC' : 'WP NMC' });
}

/** The fire marker a shot leaves (as `markFirers` decides it). */
const markerFor = (mode: FireMode): 'prep' | 'adv' | 'first' | 'final' | 'bff' =>
  mode === 'prep' ? 'prep' : mode === 'advancing' ? 'adv' : mode === 'bounding' ? 'bff' : mode === 'first' ? 'first' : 'final';

function fireOrdnance(ctx: Ctx, shot: OrdnanceShot, mode: FireMode, opts: { moving?: PieceId[]; movingInfo?: FireAttackCtx['moving'] } = {}): OrdnanceOutcome {
  const g = pieceOf(ctx, shot.weapon);
  const side = g.side;
  const sc = shotContext(ctx, shot, mode, side, opts);
  const nothing: OrdnanceOutcome = { hit: false, ch: false, th: null, dr: [0, 0], drm: 0, rofKept: false, malfunctioned: false, removed: false, results: {} };
  const caBefore = coveredArc(g);

  // Turning to face the target comes first (and gives the Gun away).
  if (shot.ca !== undefined && sc.spines > 0) {
    ctx.emit('sk2.gun.ca', { gun: g.id, from: coveredArc(g), to: shot.ca, spines: sc.spines, reason: 'fire' });
    // The turn can stop short (a vehicle bogging as it pivots in woods or a building, SK4 7.6): the target is
    // still outside the CA, so there is no shot.
    if (coveredArc(pieceOf(ctx, g.id)) !== shot.ca) return nothing;
  }
  if (isHidden(g)) revealGun(ctx, g.id, 'fire');

  // IFE: on the IFT like a MG, through the ordinary fire procedure.
  if (shot.targetType === 'IFE') {
    const decl = ifeDeclaration(ctx, shot, sc);
    const out = ctx.proc<ResolveFireFn>(FP.resolve)(ctx, decl, mode, opts);
    // IFE loses whatever acquisition the Gun had (SK4 6.8, 6.10).
    setTags(ctx, g.id, { ...ACQ_CLEAR, [T2.firedNonSmoke]: true });
    return {
      hit: out.column !== null,
      ch: false,
      th: null,
      dr: out.dr,
      drm: 0,
      rofKept: out.rofKept.includes(g.id),
      malfunctioned: out.malfunctioned.includes(g.id),
      removed: ctx.state.pieces[g.id]?.loc.kind === 'eliminated',
      results: out.results,
    };
  }

  // LOS: a blocked shot is still a shot (SK1 3.2, ASLRB A6.11). The Gun has fired "for all purposes",
  // so its To Hit DR is still made for breakdown, Special Ammo depletion and ROF; it cannot hit.
  const los = ctx.query('los.trace', { from: sc.loc ?? sc.hex, to: shot.target }, { clear: true, hindrance: 0, parts: [] });
  const part = { piece: g.id, firer: sc.firer, kind: 'ordnance' as const, hex: sc.hex, range: 99, dist: sc.range };
  const blind = los.clear ? null : (los.blockedBy ?? 'blocked');

  // The To Hit roll.
  const thn = toHitNumber(ctx, sc)!;
  const drmRes = ctx.explain('ordnance.thDrm', sc, 0);
  const drm = drmRes.value;
  const roll = ctx.roll(`To Hit ${shot.target}`);
  const [white, colored] = roll.dice as [number, number];
  const original = roll.total;
  // SK3 case 16 adds the lower die again for a Motion/Non-Stopped firer.
  const extra = ctx.query('ordnance.thExtra', { sc, dice: [white, colored] }, 0);
  const final = original + drm + extra;
  const ammo = sc.ammo;
  const targets = blind ? [] : pfTarget(ctx, sc, shotTargets(ctx, side, shot.target, opts.moving, sc.targetVehicle));

  // Breakdown (SK4 6.12): on the original TH DR.
  const b = ctx.query('ordnance.breakdown', sc, 12);
  const printedB = sc.def.b ?? 12;
  let malfunctioned = false;
  let removed = false;
  if (original >= b && sc.def.latw?.x !== undefined) {
    // A LATW is removed on an original TH DR ≥ its X# (SK4 4.4.1); a PIAT's B# malfunctions it (4.4.5).
    removed = true;
  } else if (original >= b) {
    // Intensive Fire, Non-Qualified or captured use, or a SW fired by an Inexperienced MMC: an original
    // DR ≥ the printed B# removes the weapon for good (SK4 6.12).
    const inexperienced = !!sc.def.light && ctx.query('unit.inexperienced', { unit: sc.firer }, false);
    if ((shot.intensive || sc.nonQualified || sc.captured || inexperienced) && original >= printedB) removed = true;
    else malfunctioned = true;
  }

  // Limited ammunition (SK4 6.2): the original TH DR against the Depletion Number. Below it the Gun
  // has the ammo; equal, for this shot only; above, it never had it and has not fired. A malfunction
  // fires the shot and uses the ammo up.
  let depletion: 'kept' | 'last' | 'never' | 'malf' | null = null;
  const depletionN = specialAmmoOf(sc.def, ammo) ? ammoStatus(ctx, g, sc.def, ammo).depletion! : null;
  if (depletionN !== null) depletion = malfunctioned || removed ? 'malf' : original > depletionN ? 'never' : original === depletionN ? 'last' : 'kept';

  const hit = !blind && depletion !== 'never' && final <= thn.th;
  const ch = hit && thn.ch > 0 && (shot.targetType === 'ATT' || shot.targetType === 'VTT' || sc.def.latw ? original === 2 : final <= thn.ch);
  if (blind) ctx.emit('sk2.ordnance.noLos', { weapon: g.id, firer: sc.firer, from: sc.hex, target: shot.target, blockedBy: blind, dr: [white, colored], ammo, ...(depletion === 'never' ? { noAmmo: true } : {}) });
  else ctx.emit('sk2.ordnance.shot', {
    weapon: g.id,
    firer: sc.firer,
    ...(shot.director !== undefined ? { director: shot.director } : {}),
    from: sc.hex,
    mode,
    target: shot.target,
    targetType: shot.targetType,
    ammo,
    range: sc.range,
    th: thn.th,
    red: thn.red,
    ch: thn.ch,
    dr: [white, colored],
    drm: drm + extra,
    explain: [...drmNotes(drmRes), ...(extra ? [{ id: 'sk3.th.lowerDie', label: `+${extra} lower die again (Motion/Non-Stopped fire)` }] : [])],
    outcome: depletion === 'never' ? 'noAmmo' : ch ? 'ch' : hit ? 'hit' : 'miss',
    intensive: !!shot.intensive,
    caChange: sc.spines,
    targets,
    ...(sc.targetVehicle ? { targetUnit: sc.targetVehicle } : {}),
  });
  if (depletion !== null) {
    if (depletion !== 'kept') setTags(ctx, g.id, { [AMMO_OUT]: [...ammoOut(pieceOf(ctx, g.id)), ammo].join(',') });
    ctx.emit('sk2.ordnance.ammo', { weapon: g.id, ammo, depletion: depletionN!, dr: original, result: depletion });
  }
  // Never had it: the Gun has not fired (no ROF spent, no marker, acquisition kept), and a turn
  // made for the shot is undone: the Gun may fire again from its old Covered Arc.
  if (depletion === 'never') {
    if (shot.ca !== undefined && sc.spines > 0) ctx.emit('sk2.gun.ca', { gun: g.id, from: shot.ca, to: caBefore, spines: sc.spines, reason: 'noAmmo' });
    return { ...nothing, th: thn.th, dr: [white, colored], drm, noAmmo: true, ...(blind ? { blocked: blind } : {}) };
  }

  // ROF (SK4 1.2.4.1, 3.2.4): kept when the colored dr is within the effective ROF.
  const rof = ctx.query('ordnance.rof', sc, 0);
  const manner = pieceOf(ctx, sc.firer);
  const why = shot.intensive ? 'intensive' : malfunctioned || removed ? 'malfunction' : colored > rof ? 'exceeded' : isPinned(manner) ? 'pinned' : null;
  const rofKept = why === null && rof > 0;
  if (sc.def.rof || shot.intensive) ctx.emit('sk2.ordnance.rof', { weapon: g.id, colored, rof, kept: rofKept, why });

  // Acquisition (SK4 6.10, 6.11): every TH DR places a -1 Acquired Target counter on the target
  // (ITT: the ½" one on the units there; ATT: the ⅝" one on the hex) or flips the one already
  // there to -2. Set after the hit resolves, since an IFT attack with the Gun as a part clears it.
  const acqLevel = g.tags[T2.acqHex] === shot.target ? 2 : 1;

  // The effect of a hit (the Vehicle Target Type's To Kill is the SK3 module's).
  const results: Record<PieceId, IftResult> = {};
  const hitInfo: HitInfo = { hit, ch, dice: [white, colored], original, drm: drm + extra, mode, ...(opts.movingInfo ? { movingInfo: opts.movingInfo } : {}) };
  const usedColumns = ctx.proc<ResolveHitFn>(OP.resolveHit)(ctx, sc, hitInfo, targets, results);
  // Residual FP (SK4 3.3.5): none when the Gun malfunctions, uses Intensive Fire, or fires AP/APCR/APDS
  // (6.2); from the highest column used; Air Bursts add a column. A Gun that kept ROF leaves none
  // unless its owner "chooses" not to retain the ROF: the amount is reported for that choice.
  let rofResidual: number | undefined;
  if (usedColumns.length && (mode === 'first' || mode === 'subsequentFirst' || mode === 'fpf') && !malfunctioned && !removed && !shot.intensive && leavesResidual(ammo) && sc.def.type !== 'PF') {
    const column = Math.max(...usedColumns);
    const airBurst = sc.def.type === 'MTR' && !!terrainOf(ctx, shot.target).airBursts;
    const bonus = ctx.query('fire.residualBonus', { target: shot.target, ordnance: { ammo, airBurst } }, 0);
    if (!rofKept) placeOrdnanceResidual(ctx, shot.target, iftColumn(ctx, column) ?? column, outsideDrm(drmRes, OUTSIDE_TH), bonus);
    else rofResidual = residualFpLeft(ctx, iftColumn(ctx, column) ?? column, outsideDrm(drmRes, OUTSIDE_TH), bonus);
  }

  // Smoke and WP use an acquisition but never gain one, and lose what there was (SK4 6.10, 6.11).
  // A LATW never gains Acquisition (SK4 4.5 grants it to Light Mortars alone among SW).
  // The ½" counter sits on the units it acquired, so a shot that eliminates every one of them leaves
  // no counter behind (the hex keeps one only when its target leaves the LOS).
  // Only Known units are acquired (SK4 8.3.2: a concealed target is acquired by the Area Target Type, or once the shot made it drop its "?").
  const survivors = targets.filter((u) => ctx.state.pieces[u] && ctx.state.pieces[u].loc.kind !== 'eliminated' && ctx.state.pieces[u].tags['wreck'] !== true && (shot.targetType === 'ATT' || isKnownTo(ctx, ctx.state.pieces[u]!, side)));
  const acquires = ctx.query('ordnance.acquires', sc, true);
  // A blocked shot acquires nothing; it keeps an acquisition of that same target and loses any other (6.10).
  if (blind) {
    if (g.tags[T2.acqHex] !== shot.target) setTags(ctx, g.id, ACQ_CLEAR);
  } else if (acquires && !malfunctioned && !removed && !isSmokeAmmo(ammo) && !isLatw(sc.def) && (shot.targetType === 'ATT' || survivors.length > 0)) {
    // A Vehicle Target Type acquisition is the ½" counter on the vehicle, like the Infantry Target Type's.
    const type = shot.targetType === 'ATT' ? 'ATT' : 'ITT';
    const units = type === 'ATT' ? [] : survivors;
    setTags(ctx, g.id, { [T2.acq]: type, [T2.acqHex]: shot.target, [T2.acqUnits]: units.join(','), [T2.acqLevel]: acqLevel });
    ctx.emit('sk2.acquired', { weapon: g.id, hex: shot.target, type, units, level: acqLevel });
  } else setTags(ctx, g.id, ACQ_CLEAR);

  // Markers and the Gun's state.
  // A leader who directed the shot is marked as having fired too (ASL A7.531).
  const attackForMarks: FireAttackCtx = { mode, side, target: shot.target, parts: [part], targets, hindrance: 0, ...(shot.director !== undefined ? { directors: [shot.director] } : {}) };
  markFirers(ctx, attackForMarks, mode, false, rofKept ? [g.id] : []);
  if (!isSmokeAmmo(ammo)) setTags(ctx, g.id, { [T2.firedNonSmoke]: true });
  if (shot.intensive) setTags(ctx, g.id, { [T2.intensive]: true, [T.fire]: markerFor(mode) });
  // A Gun with no ROF that changed its CA for the shot cannot fire again that Player Turn (SK4 3.2.4).
  else if (!sc.def.rof && sc.spines > 0) setTags(ctx, g.id, { [T2.intensive]: true });
  if (malfunctioned) {
    setTags(ctx, g.id, { [T.malf]: true });
    ctx.emit('sk2.gun.malf', { gun: g.id, dr: original, removed: false });
  }
  if (removed) {
    ctx.emit('sk2.gun.malf', { gun: g.id, dr: original, removed: true });
    // A vehicle's MA is disabled for good and the vehicle Recalled (SK4 3.2.4, 7.10); a Gun or LATW leaves play.
    if (sc.def.vehicle) setTags(ctx, g.id, { [T.malf]: null, maDisabled: true, recall: true });
    else ctx.emit('piece.eliminated', { id: g.id, reason: sc.def.latw ? `${sc.def.type} removed (X#)` : 'Gun removed (breakdown)' });
  }
  // Backblast (SK4 4.4.3): everyone in the firer's building hex takes a 1 FP attack on the colored dr, no TEM.
  if (hasBackblast(sc.def) && shot.backblast && backblastHex(ctx, sc.hex)) {
    const occupants = personnelAt(ctx, locOf(ctx.state, pieceOf(ctx, sc.firer)) ?? sc.hex).map((p) => p.id).sort();
    const attack: FireAttackCtx = { mode, side, target: sc.hex, parts: [], targets: occupants, hindrance: 0 };
    ctx.emit('sk1.fire.attack', {
      attack: { mode, target: sc.hex, parts: [g.id] },
      fp: 1,
      column: iftColumn(ctx, 1),
      dr: [colored, 0],
      drm: 0,
      cowered: false,
      explain: [{ id: 'sk2.latw.backblast', label: `Backblast: 1 FP column on the colored dr (${colored}), no TEM` }],
    });
    ctx.proc<ApplyResultFn>(FP.applyResult)(ctx, attack, 1, colored, results);
  }
  if (mode === 'fpf') fpfCheck(ctx, sc.firer, original, shot.director !== undefined ? directorDrm(ctx, shot.director, sc.firer) : 0);
  ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);

  return { hit, ch, th: thn.th, dr: [white, colored], drm, rofKept, malfunctioned, removed, results, ...(blind ? { blocked: blind } : {}), ...(rofResidual !== undefined ? { rofResidual } : {}) };
}


/** The effect of a hit on the Infantry or Area Target Type (SK4 3.2.4): Smoke placement, or the IFT attack; returns the columns used. */
function resolveHitBase(ctx: Ctx, sc: ShotCtx, h: HitInfo, targets: PieceId[], results: Record<PieceId, IftResult>): number[] {
  const { shot, side, ammo } = sc;
  const { hit, ch, mode } = h;
  if (!hit || shot.targetType === 'VTT') return [];
  if (isSmokeAmmo(ammo)) {
    placeOrdnanceSmoke(ctx, hexOfLoc(shot.target), ammo, mode, side);
    if (ammo === 'WP') wpEffect(ctx, sc, targets, ch);
    return [];
  }
  // Air Bursts (SK4 1.1.1): Mortar fire into woods (PTO: jungle, 8.2.1) takes -1 instead of the TEM.
  const airBurst = sc.def.type === 'MTR' && !!terrainOf(ctx, shot.target).airBursts;
  // A Critical Hit's special provisions apply to one randomly determined target (6.1); the rest
  // take a normal hit with the same IFT DR.
  const chTarget = ch && targets.length > 1 ? ctx.proc<RandomSelectFn>(MP.randomSelect)(ctx, targets, 1, 'Critical Hit')[0]! : null;
  const hitGroups: { ch: boolean; units: PieceId[]; loc: LocId }[] = !ch
    ? [{ ch: false, units: targets, loc: shot.target }]
    : chTarget
      ? [{ ch: true, units: [chTarget], loc: shot.target }, { ch: false, units: targets.filter((u) => u !== chTarget), loc: shot.target }]
      : [{ ch: true, units: targets, loc: shot.target }];
  // Mortar fire is Indirect Fire (ASLRB C.1): in full ASL a hit on a building hex attacks each of its levels with the
  // same IFT DR (B23.32; only the highest level of an Interior Building Hex). A Starter Kit hex has one Location.
  const indirect = sc.def.type === 'MTR';
  const indirectLocs = indirect && !h.movingInfo ? ctx.query('fire.indirectLocations', { target: shot.target }, [shot.target]) : [shot.target];
  // An Area Target Type hit may reach other Locations of the hex (S70: a cave and its hill, "except an ATT attack with LOS").
  const hitLocs = shot.targetType === 'ATT' && !h.movingInfo ? ctx.query('fire.areaLocations', { target: shot.target, from: sc.loc ?? sc.hex }, indirectLocs) : indirectLocs;
  const groups = [
    ...hitGroups.filter((g) => hitLocs.includes(g.loc)),
    ...hitLocs.filter((l) => l !== shot.target).map((loc) => ({ ch: false, units: shotTargets(ctx, side, loc), loc })),
  ].filter((g) => g.units.length > 0 || g.loc === shot.target);
  const planned = groups.flatMap((grp) => {
    const column = ammoColumn(ctx, sc.def, ammo as Exclude<AmmoKind, 'SMOKE' | 'WP'>, shot.targetType as 'ITT' | 'ATT', grp.ch);
    if (column === null) return [];
    const attack: FireAttackCtx = {
      mode,
      side,
      target: grp.loc,
      parts: [{ piece: sc.weapon, firer: sc.firer, kind: 'ordnance' as const, hex: sc.hex, range: 99, dist: sc.range }],
      targets: grp.units,
      ...(h.movingInfo ? { moving: h.movingInfo } : {}),
      hindrance: 0,
      ordnance: {
        targetType: shot.targetType as 'ITT' | 'ATT',
        ch: grp.ch,
        column,
        thDice: h.dice,
        ...(ammo !== 'HE' ? { ammo: ammo as 'AP' | 'HEAT' | 'APCR' | 'APDS' } : {}),
        ...(airBurst ? { airBurst } : {}),
        ...(indirect ? { indirect } : {}),
      },
    };
    const iftDrmRes = ctx.explain('fire.drm', { attack }, 0);
    // A broken target not under DM becomes DM if the attack could possibly inflict a NMC.
    const best = statics(ctx).tables.ift(column, 2 + iftDrmRes.value).kind;
    const desperate = best !== 'none' && best !== 'PTC' ? grp.units.filter((u) => isBroken(pieceOf(ctx, u)) && !hasDm(pieceOf(ctx, u))) : [];
    for (const u of desperate) setTags(ctx, u, { [T.dm]: true });
    return [{ grp, column, attack, iftDrmRes, desperate }];
  });
  if (!planned.length) return [];
  const ift = ctx.roll(`${ch ? 'Critical Hit' : 'Hit'} on ${shot.target}`);
  for (const { grp, column, attack, iftDrmRes, desperate } of planned) {
    const iftDrm = iftDrmRes.value;
    ctx.emit('sk1.fire.attack', {
      attack: { mode, target: grp.loc, parts: [sc.weapon] },
      from: [sc.hex],
      fp: column,
      column: iftColumn(ctx, column),
      dr: ift.dice as [number, number],
      drm: iftDrm,
      cowered: false,
      explain: [
        { id: 'sk2.ordnance.hit', label: `${grp.ch ? 'Critical Hit' : 'Hit'} (${shot.targetType}${ammo !== 'HE' ? `, ${AMMO_NAME[ammo]}` : ''}): ${column} column` },
        ...drmNotes(iftDrmRes),
      ],
    });
    ctx.emit('sk2.ordnance.hit', { weapon: sc.weapon, target: grp.loc, targetType: shot.targetType, ammo, ch: grp.ch, column, dr: ift.dice as [number, number], drm: iftDrm, units: grp.units });
    if (desperate.length) ctx.emit('sk1.fire.dm', { units: desperate });
    ctx.proc<ApplyResultFn>(FP.applyResult)(ctx, attack, column, ift.total + iftDrm, results);
    ctx.proc<AttackResolvedFn>(FP.attackResolved)(ctx, { target: grp.loc, by: ammo === 'HE' ? 'he' : 'other', result: statics(ctx).tables.ift(column, ift.total + iftDrm).kind, malfunctioned: false });
  }
  return planned.map((p) => p.column);
}

/** To Hit DRM contribution ids caused by conditions outside the target hex (they cut Residual FP, SK4 3.3.5). */
const OUTSIDE_TH = new Set(['sk2.th.latwAfph', 'sk2.th.backblast', 'sk2.th.cx', 'sk2.th.apcr-range', 'sk2.th.hindrance', 'sk2.th.leadership', 'sk2.th.caChange', 'sk2.th.intensive', 'sk2.th.nonQualified', 'sk2.th.captured', 'sk2.th.afph', 'sk2.th.pinned']);

/** Shots the AI/tests can take: one per Gun, target hex and usable Target Type (turning the Gun if it must). */
export function simpleShots(env: QueryEnv, side: SideId, targets: HexId[], mode: FireMode, moving?: PieceId[]): OrdnanceShot[] {
  const out: OrdnanceShot[] = [];
  const map = statics(env).map;
  for (const g of Object.values(env.state.pieces).filter((p) => p.side === side && ordnanceOf(env, p) && (p.loc.kind === 'held' || (p.loc.kind === 'hex' && ordnanceOf(env, p)!.vehicle))).sort(byId)) {
    const def = ordnanceOf(env, g)!;
    const hex = hexOf(env.state, g);
    if (!hex) continue;
    for (const t of targets) {
      const th = map.hex(hexOfLoc(t));
      if (!th) continue;
      const vehicleThere = !!enemyVehicleAt(env, t, side);
      if (t === hex && !vehicleThere) continue;
      // A Light Mortar has no Covered Arc: every hex is covered.
      const covered = !!def.light || inCoveredArc(map.hex(hex)!.cube, coveredArc(g), th.cube);
      const near = covered ? null : nearestSpine(map.hex(hex)!.cube, coveredArc(g), th.cube);
      if (!covered && near === null) continue;
      const ca = near ?? undefined;
      const types: TargetType[] = [];
      if (def.latw) types.push('ITT');
      else {
        if (statics(env).tables.gunColumn(def, 'ITT') !== null) types.push('ITT');
        if (statics(env).tables.gunColumn(def, 'ATT') !== null) types.push('ATT');
        if (def.ife) types.push('IFE');
      }
      if (vehicleThere && def.type !== 'MTR') types.push('VTT');
      // From inside a building a LATW chooses the +2 DRM or the Backblast (SK4 4.4.3).
      const backblasts: (boolean | undefined)[] = hasBackblast(def) && backblastHex(env, hex) ? [false, true] : [undefined];
      // The default ammunition, then each other kind the Gun could announce (SK4 6.2).
      const dflt = defaultAmmo(env, g, def);
      const ammos: (AmmoKind | undefined)[] = [undefined, ...ammoKinds(def).filter((k) => k !== dflt && ammoStatus(env, g, def, k).available)];
      for (const targetType of types) {
        for (const ammo of targetType === 'IFE' ? [undefined] : ammos) {
          for (const intensive of [false, true]) {
            for (const backblast of backblasts) {
              const shot: OrdnanceShot = {
                weapon: g.id,
                target: t,
                targetType,
                ...(ca !== undefined ? { ca } : {}),
                ...(intensive ? { intensive } : {}),
                ...(ammo ? { ammo } : {}),
                ...(backblast !== undefined ? { backblast } : {}),
              };
              if (targetType === 'IFE' && intensive) continue;
              if (!env.query('ordnance.illegal', { shot, mode, side, ...(moving ? { moving } : {}) }, null)) out.push(shot);
            }
          }
        }
      }
    }
  }
  return out;
}

/** The Defensive First Fire mode of a Gun shot: by the Gun's marker (First → Intensive as SFF), IFE by the ordinary rule. */
export function gunFirstFireMode(env: QueryEnv, shot: OrdnanceShot): FireMode {
  if (shot.targetType === 'IFE') return firstFireMode(env, { units: [], sw: [shot.weapon], target: shot.target });
  const m = fireMarker(pieceOf(env, shot.weapon));
  return m === 'first' ? 'subsequentFirst' : m === 'final' ? 'fpf' : 'first';
}

export const ordnanceModule: RuleModule = {
  id: 'sk2.ordnance',
  ref: 'SK4 3.2.4, 3.3.3, 3.3.5, 6.1, 6.2, 6.8, 6.10–6.12',
  summary: 'Ordnance: the To Hit process for Guns, Intensive Fire, IFE, acquisition, breakdown.',
  requires: ['sk2.guns', 'sk1.movement', 'sk1.firePhases'],
  install(r) {
    r.event<{
      weapon: PieceId; firer: PieceId; director?: PieceId; mode: FireMode; target: HexId; targetType: TargetType; range: number;
      /** The hex fired from (since 2026-10-27), so the shot's LOS can be shown again later. */
      from?: HexId;
      th: number; red: boolean; ch: number; dr: [number, number]; drm: number; explain: { id: string; label?: string }[];
      outcome: 'miss' | 'hit' | 'ch' | 'noAmmo'; intensive: boolean; caChange: number; targets: PieceId[]; ammo: AmmoKind;
    }>({ type: 'sk2.ordnance.shot', apply() {} });
    r.event<{ weapon: PieceId; ammo: AmmoKind; depletion: number; dr: number; result: 'kept' | 'last' | 'never' | 'malf' }>({ type: 'sk2.ordnance.ammo', apply() {} });
    r.event<{ hex: HexId; kind: 'smoke' | 'wp'; dispersed: boolean; side: SideId }>({ type: 'sk2.smoke.placed', apply() {} });
    r.event<{ weapon: PieceId; target: HexId; units: PieceId[]; mod: number; ch: boolean; airBurst: boolean }>({ type: 'sk2.ordnance.wp', apply() {} });
    r.event<{ weapon: PieceId; firer: PieceId; /** The hex fired from (since 2026-10-27). */ from?: HexId; target: HexId; blockedBy: string; /** The To Hit DR still made (since 2026-11-01). */ dr?: [number, number]; ammo?: AmmoKind; noAmmo?: boolean }>({ type: 'sk2.ordnance.noLos', apply() {} });
    r.event<{ weapon: PieceId; target: HexId; targetType: TargetType; ammo: AmmoKind; ch: boolean; column: number; dr: [number, number]; drm: number; units: PieceId[] }>({ type: 'sk2.ordnance.hit', apply() {} });
    r.event<{ weapon: PieceId; colored: number; rof: number; kept: boolean; why: string | null }>({ type: 'sk2.ordnance.rof', apply() {} });
    r.event<{ weapon: PieceId; hex: HexId; type: 'ITT' | 'ATT'; units: PieceId[]; level: number }>({ type: 'sk2.acquired', apply() {} });
    r.event<{ gun: PieceId; dr: number; removed: boolean }>({ type: 'sk2.gun.malf', apply() {} });

    r.procedure<OrdnanceFireFn>(OP.fire, () => (ctx, shot, mode, opts) => fireOrdnance(ctx, shot, mode, opts));
    r.procedure<ResolveHitFn>(OP.resolveHit, () => (ctx, sc, hit, targets, results) => resolveHitBase(ctx, sc, hit, targets, results));

    // ---------------------------------------------------------------- legality
    r.contribute({
      id: 'sk2.ordnance.illegal.base',
      query: 'ordnance.illegal',
      layer: 0,
      apply: (v, { shot, mode, side, moving }, env) => v ?? ordnanceIllegal(env, shot, mode, side, moving),
    });
    // A Gun or vehicle whose crew or possessor may take no action (`unit.actionIllegal`) does not fire.
    r.contribute({
      id: 'sk2.ordnance.illegal.action',
      query: 'ordnance.illegal',
      layer: 0,
      apply: (v, { shot }, env) => {
        if (v) return v;
        const w = env.state.pieces[shot.weapon];
        return actionIllegal(env, [shot.weapon, ...(w?.loc.kind === 'held' ? [w.loc.by] : []), ...(shot.director ? [shot.director] : [])]);
      },
    });

    // ---------------------------------------------------------------- red To Hit numbers
    r.contribute({
      id: 'sk2.th.red.base',
      query: 'ordnance.redTh',
      ref: 'SK4 3.2.4',
      layer: 0,
      apply(_v, sc, env) {
        if (sc.shot.targetType === 'ATT') return true;
        if (sc.captured || sc.nonQualified) return true;
        const nat = sc.def.nationality;
        if (['ru', 'it', 'al', 'ax'].includes(nat)) return true;
        const year = scenarioYear(env);
        return nat === 'am' && year !== undefined && year < 1944;
      },
    });

    // ---------------------------------------------------------------- To Hit DRM (chart cases)
    const th = (id: string, ref: string, label: string | ((sc: ShotCtx, env: QueryEnv) => string), when: (sc: ShotCtx, env: QueryEnv) => boolean, drm: (sc: ShotCtx, env: QueryEnv) => number) =>
      r.contribute({ id: `sk2.th.${id}`, query: 'ordnance.thDrm', ref, label, when, apply: (v, sc, env) => v + drm(sc, env) });
    th('afph', 'case 1', (sc, env) => `+${afphDrm(sc, env)} fire in the AFPh`, (sc, env) => sc.mode === 'advancing' && !isLatw(sc.def) && !(sc.firerVehicle && pieceOf(env, sc.firerVehicle).tags[T.moved]), afphDrm);
    // S27 SSR 4: +1 To Hit against the units of listed forces on listed turns.
    th('targetDrm', 'SSR', (sc, env) => `+${targetThDrm(env, sc.side, sc.target)} SSR vs these troops (Turn ${env.state.turn})`, (sc, env) => (sc.shot.targetType === 'ITT' || sc.shot.targetType === 'ATT') && targetThDrm(env, sc.side, sc.target) > 0, (sc, env) => targetThDrm(env, sc.side, sc.target));
    th('latwAfph', 'case 12', '+2 LATW fire in the AFPh', (sc) => sc.mode === 'advancing' && isLatw(sc.def), () => 2);
    th('pinned', 'case 2', '+2 pinned firer', (sc, env) => isPinned(pieceOf(env, sc.firer)), () => 2);
    th('nonQualified', 'case 3', '+2 Non-Qualified Use', (sc) => sc.nonQualified, () => 2);
    th('captured', 'case 4', '+2 captured use', (sc) => sc.captured, () => 2);
    th('cx', 'case 5', '+1 CX', (sc, env) => isCx(pieceOf(env, sc.firer)) || (sc.shot.director !== undefined && isCx(pieceOf(env, sc.shot.director))), () => 1);
    th(
      'leadership',
      'case 6',
      (sc, env) => `${directorDrm(env, sc.shot.director!, sc.firer)} leadership`,
      (sc, env) => sc.shot.director !== undefined && directorDrm(env, sc.shot.director!, sc.firer) !== 0,
      (sc, env) => directorDrm(env, sc.shot.director!, sc.firer),
    );
    th(
      'caChange',
      'case 8',
      (sc, env) => `+${caDrm(env, sc.hex, sc.def.mount, sc.spines)} Covered Arc change (${sc.spines} hexspine${sc.spines === 1 ? '' : 's'}, ${mountLabel(sc.def.mount)}${isBuildingHex(env, sc.hex) ? ', ×2 in a building' : ''})`,
      (sc) => sc.spines > 0,
      (sc, env) => caDrm(env, sc.hex, sc.def.mount, sc.spines),
    );
    th('smoke', 'case 7', '-2 Smoke at under 13 hexes', (sc) => isSmokeAmmo(sc.ammo) && sc.range < 13, () => -2);
    th('apcr-range', 'case 11', (sc) => `+1 ${AMMO_NAME[sc.ammo]} at 13 hexes or more`, (sc) => (sc.ammo === 'APCR' || sc.ammo === 'APDS') && sc.range >= 13, () => 1);
    th('intensive', 'case 9', '+2 Intensive Fire', (sc) => !!sc.shot.intensive, () => 2);
    th('backblast', 'SK4 4.4.3', '+2 firing from a building (no Backblast)', (sc, env) => hasBackblast(sc.def) && !sc.shot.backblast && backblastHex(env, sc.hex), () => 2);
    th('tem', 'case 17', (sc, env) => `+${env.query('hex.tem', { hex: sc.target }, 0)} TEM (${terrainOf(env, sc.target).name})`, (sc, env) => sc.shot.targetType === 'ITT' && env.query('hex.tem', { hex: sc.target }, 0) !== 0 && !onWoodsRoad(env, sc.movingInfo, [sc.loc ?? sc.hex], sc.target), (sc, env) => env.query('hex.tem', { hex: sc.target }, 0));
    th('emplacement', 'SK4 6.3', (sc, env) => `+${emplacementThDrm(env, sc.target, sc.side)} Emplacement TEM`, (sc, env) => sc.shot.targetType === 'ITT' && emplacementThDrm(env, sc.target, sc.side) > 0, (sc, env) => emplacementThDrm(env, sc.target, sc.side));
    th('hindrance', 'case 18', (sc) => `+${sc.hindrance} LOS Hindrance`, (sc) => sc.hindrance > 0, (sc) => sc.hindrance);
    th('ffnam', 'case 19', '-1 FFNAM', (sc) => !!sc.movingInfo && !sc.movingInfo.assault && !sc.movingInfo.pinned && !hazardousMover(sc), () => -1);
    th('ffmo', 'case 19', '-1 FFMO', (sc, env) => !!sc.movingInfo && !sc.movingInfo.pinned && sc.hindrance === 0 && (env.query('hex.openGround', { hex: sc.target }, false) || onRoadInTheOpen(env, sc.movingInfo, [sc.loc ?? sc.hex], sc.target)) && !hazardousMover(sc), () => -1);
    th('acquired', 'case 20', (sc, env) => `-${acquisition(sc, env)} Acquired Target`, (sc, env) => acquisition(sc, env) > 0, (sc, env) => -acquisition(sc, env));
    th('hazardous', 'case 21', '-2 target using Hazardous Movement', (sc) => hazardousMover(sc), () => -2);
    th('targetSize', 'case 22', (sc, env) => `${targetSizeDrm(sc, env) > 0 ? '+' : ''}${targetSizeDrm(sc, env)} target size`, (sc, env) => targetSizeDrm(sc, env) !== 0, targetSizeDrm);

    function afphDrm(sc: ShotCtx, env: QueryEnv): number {
      const t = terrainOf(env, sc.hex);
      return t.id === 'woods' || t.id.startsWith('building') ? 3 : 2;
    }
    function hazardousMover(sc: ShotCtx): boolean {
      return !!sc.moving && sc.moving.length > 0 && sc.moving.every((u) => !!u) && !!sc.movingInfo && (sc.movingInfo as { hazardous?: boolean }).hazardous === true;
    }
    function acquisition(sc: ShotCtx, env: QueryEnv): number {
      const a = acquisitionOf(pieceOf(env, sc.weapon));
      return a && a.hex === sc.target ? a.level : 0;
    }
    /** Case 22 vs a Gun in the target hex: small target +1, large -1 (the first enemy Gun there). */
    function targetSizeDrm(sc: ShotCtx, env: QueryEnv): number {
      const enemy = otherSide(env.state, sc.side);
      const target = Object.values(env.state.pieces).find((p) => p.side === enemy && gun(env, p) && locOf(env.state, p) === sc.target);
      const size = target ? gun(env, target)!.targetSize : 'normal';
      return size === 'small' ? 1 : size === 'large' ? -1 : 0;
    }

    // ---------------------------------------------------------------- ROF and breakdown
    r.contribute({
      id: 'sk2.ordnance.rof.base',
      query: 'ordnance.rof',
      layer: 0,
      apply(_v, sc, env) {
        if (sc.shot.targetType === 'ATT' && sc.def.type !== 'MTR') return 0;
        let rof = sc.def.rof ?? 0;
        // A Light Mortar fired by a lone SMC has no ROF; two SMC fire it with no detriment (SK4 4.5).
        if (sc.def.light && smc(env, pieceOf(env, sc.firer)) && !otherSmcHelps(env, sc)) return 0;
        if (sc.captured) rof -= 1;
        if (sc.nonQualified) rof -= 1;
        if (sc.spines > 0 && sc.def.mount === 'NT' && sc.def.type !== 'MTR') rof -= 1;
        return Math.max(0, rof);
      },
    });
    r.contribute({
      id: 'sk2.ordnance.breakdown.base',
      query: 'ordnance.breakdown',
      layer: 0,
      apply(_v, sc, env) {
        let b = env.query('sw.breakdown', { sw: sc.weapon, user: sc.firer }, 12) ?? 12;
        if (sc.shot.intensive) b -= 2;
        return b;
      },
    });
    // Non-Qualified Use lowers the B# by 2 (SK4 3.2.4), for IFE too.
    r.contribute({
      id: 'sk2.sw.breakdown.nonQualified',
      query: 'sw.breakdown',
      ref: 'SK4 3.2.4',
      label: '-2 Non-Qualified Use',
      when: ({ sw: id, user }, env) => !!gun(env, pieceOf(env, id)) && !!user && mmc(env, pieceOf(env, user))?.kind !== 'crew',
      apply: (v) => (v === null ? v : v - 2),
    });
    // IFE use lowers the ROF by one (SK4 6.8); the IFT path reads `sw.rof`, the To Hit path `ordnance.rof`.
    r.contribute({
      id: 'sk2.sw.rof.ife',
      query: 'sw.rof',
      ref: 'SK4 6.8',
      when: ({ sw: id }, env) => !!gun(env, pieceOf(env, id)) || !!vehicleIfe(env, pieceOf(env, id)),
      apply: (v) => Math.max(0, v - 1),
    });
    r.contribute({
      id: 'sk2.sw.rof.nonQualified',
      query: 'sw.rof',
      ref: 'SK4 3.2.4',
      when: ({ sw: id, user }, env) => !!gun(env, pieceOf(env, id)) && !!user && mmc(env, pieceOf(env, user))?.kind !== 'crew',
      apply: (v) => Math.max(0, v - 1),
    });

    // A Light Mortar fires only through the To Hit process (SK4 4.5, 6.9), never with a fire group on the IFT.
    r.contribute({
      id: 'sk2.fire.illegal.light-mortar',
      query: 'fire.illegal',
      apply: (v, { decl }, env) =>
        v ??
        (() => {
          // An ATR is also a 1 FP SW on the IFT vs Infantry (SK4 4.4.4).
          const o = decl.sw.map((id) => ordnanceOf(env, env.state.pieces[id] ?? pieceOf(env, id))).find((d) => d?.light && d.type !== 'ATR');
          if (!o) return null;
          return o.latw ? `A ${o.type} fires on its own To Hit Table: use Fire ${o.type}` : 'A Light Mortar fires on the To Hit Table: use Fire Mortar';
        })(),
    });

    // ---------------------------------------------------------------- IFE on the IFT
    r.contribute({
      id: 'sk2.fire.illegal.ife',
      query: 'fire.illegal',
      apply(v, { decl, side, moving }, env) {
        if (v) return v;
        const guns = decl.sw.filter((id) => !!gun(env, env.state.pieces[id] ?? pieceOf(env, id)));
        if (guns.length === 0) return null;
        if (guns.length > 1 || decl.units.length > 0 || decl.sw.length > 1) return 'A Gun firing IFE may not form a Fire Group';
        if (decl.directors?.length || decl.director) return 'Leadership never modifies IFE';
        const g = pieceOf(env, guns[0]!);
        const def = gun(env, g)!;
        if (!def.ife) return 'The Gun has no Infantry Firepower Equivalent';
        const map = statics(env).map;
        const hex = hexOf(env.state, g)!;
        if (map.distance(hex, hexOfLoc(decl.target)) > 16) return 'IFE has a range of 16 hexes';
        if (!moving && g.tags[T2.intensive]) return 'The Gun has used Intensive Fire this Player Turn';
        if (!decl.caChange && !inCoveredArc(map.hex(hex)!.cube, coveredArc(g), map.hex(hexOfLoc(decl.target))!.cube)) return 'The target is outside the Covered Arc (turn the Gun first)';
        void side;
        return null;
      },
    });
    r.contribute({
      id: 'sk2.cower.ife',
      query: 'fire.cowerShift',
      layer: 950,
      ref: 'SK4 6.8',
      when: ({ attack }, env) => attack.parts.some((p) => p.kind === 'sw' && !!gun(env, pieceOf(env, p.piece))),
      apply: () => 0,
    });
    r.contribute({
      id: 'sk2.drm.ife-ca-change',
      query: 'fire.drm',
      ref: 'SK4 6.8 (case 8)',
      label: ({ attack }, env) => `+${ifeCaDrm(env, attack)} Covered Arc change`,
      when: ({ attack }) => !!attack.caChange && attack.caChange.spines > 0,
      apply: (v, { attack }, env) => v + ifeCaDrm(env, attack),
    });
    r.contribute({
      id: 'sk2.drm.ife-non-qualified',
      query: 'fire.drm',
      ref: 'SK4 3.2.4 (case 3)',
      label: '+2 Non-Qualified Use',
      when: ({ attack }, env) => attack.parts.some((p) => p.kind === 'sw' && !!gun(env, pieceOf(env, p.piece)) && mmc(env, pieceOf(env, p.firer))?.kind !== 'crew'),
      apply: (v) => v + 2,
    });

    // ---------------------------------------------------------------- ordnance hits on the IFT (SK4 3.2.4)
    // TEM was applied to the To Hit DR on the ITT; hindrance, CX, leadership and the moving-target
    // DRMs are To Hit matters; the IFT DR of a hit takes only the ATT's TEM (and a CH's reversed TEM).
    for (const target of ['sk1.drm.hindrance', 'sk1.drm.leadership', 'sk1.drm.cx', 'sk1.drm.ffnam', 'sk1.drm.ffmo', 'sk1.drm.woods-road']) {
      r.suppress<'fire.drm'>({ id: `sk2.ordnance.suppress.${target}`, query: 'fire.drm', target, ref: 'SK4 3.2.4', when: ({ attack }) => !!attack.ordnance });
    }
    for (const target of ['sk1.drm.tem', 'ssr.fortified.drm']) {
      r.suppress<'fire.drm'>({ id: `sk2.ordnance.suppress.${target}`, query: 'fire.drm', target, ref: 'SK4 3.2.4', when: ({ attack }) => attack.ordnance?.targetType === 'ITT' });
    }
    r.contribute({
      id: 'sk2.drm.ch-reversed-tem',
      query: 'fire.drm',
      ref: 'SK4 6.1',
      label: ({ attack }, env) => `-${Math.max(0, env.query('hex.tem', { hex: attack.target }, 0))} Critical Hit: TEM reversed`,
      when: ({ attack }, env) => !!attack.ordnance?.ch && !attack.ordnance.airBurst && env.query('hex.tem', { hex: attack.target }, 0) > 0,
      apply: (v, { attack }, env) => v - env.query('hex.tem', { hex: attack.target }, 0),
    });
    // Air Bursts (SK4 1.1.1): Mortar fire vs Infantry in woods takes -1 instead of the +1 woods TEM,
    // Critical Hit or not (6.1).
    r.suppress<'fire.drm'>({ id: 'sk2.ordnance.suppress.airBurst-tem', query: 'fire.drm', target: 'sk1.drm.tem', ref: 'SK4 1.1.1', when: ({ attack }) => !!attack.ordnance?.airBurst });
    r.contribute({
      id: 'sk2.drm.air-burst',
      query: 'fire.drm',
      ref: 'SK4 1.1.1',
      label: '-1 Air Burst (woods)',
      when: ({ attack }) => !!attack.ordnance?.airBurst,
      apply: (v) => v - 1,
    });

    // ⅝" Smoke disperses at the start of the placing side's next PFPh: Dispersed counters come off,
    // full ones flip (SK4 1.2.5). A Gun may fire Smoke again from the next phase (6.2).
    r.on<{ phase: string; attacker: SideId }>({
      id: 'sk2.smoke.disperse',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'PFPh') return;
        for (const [hex, m] of Object.entries(ctx.state.hexMarkers).sort()) {
          const counters = smoke58Counters(m);
          if (!counters.some((c) => c.side === ev.payload.attacker)) continue;
          const left = counters.flatMap((c) => (c.side !== ev.payload.attacker ? [c] : c.dispersed ? [] : [{ ...c, dispersed: true }]));
          for (const e of smoke58Markers(hex as HexId, m, left)) ctx.emit('hex.marker', e);
        }
      },
    });
    r.on<{ phase: string }>({
      id: 'sk2.smoke.phase-end',
      event: 'turn.phaseEnded',
      handler(ctx) {
        for (const p of Object.values(ctx.state.pieces).sort(byId)) if (p.tags[T2.firedNonSmoke] !== undefined) setTags(ctx, p.id, { [T2.firedNonSmoke]: null });
      },
    });

    // Acquisition is lost (SK4 6.10) when the Gun fires its IFE or its manning unit fires inherent FP...
    r.on<{ attack: { parts: PieceId[] } }>({
      id: 'sk2.ordnance.acq.ife',
      event: 'sk1.fire.attack',
      handler(ctx, ev) {
        for (const id of ev.payload.attack.parts) {
          const p = ctx.state.pieces[id];
          if (!p) continue;
          if (ordnanceOf(ctx, p) && p.tags[T2.acq] !== undefined) setTags(ctx, id, ACQ_CLEAR);
          const held = ordnanceHeldBy(ctx, id);
          if (held && held.tags[T2.acq] !== undefined && !ev.payload.attack.parts.includes(held.id)) setTags(ctx, held.id, ACQ_CLEAR);
        }
      },
    });
    // ...when the Gun or its manning Infantry leaves its location, or the manning unit breaks.
    r.on<{ id: PieceId; tags: Record<string, unknown> }>({
      id: 'sk2.ordnance.acq.broken',
      event: 'piece.tagged',
      handler(ctx, ev) {
        if (ev.payload.tags[T.broken] !== true) return;
        const held = ordnanceHeldBy(ctx, ev.payload.id);
        if (held && held.tags[T2.acq] !== undefined) setTags(ctx, held.id, ACQ_CLEAR);
      },
    });
    r.on<{ id: PieceId; reason: string }>({
      id: 'sk2.ordnance.acq.eliminated',
      event: 'piece.eliminated',
      handler(ctx, ev) {
        // An acquired unit that dies drops off the ½" counter, which goes when the last of them does:
        // it sits on its target, and only a target leaving the LOS leaves it in the hex (SK4 6.10).
        for (const g of gunsWithAcquisition(ctx)) {
          const a = acquisitionOf(g)!;
          if (!a.units.includes(ev.payload.id)) continue;
          const rest = a.units.filter((u) => u !== ev.payload.id);
          setTags(ctx, g.id, rest.length ? { [T2.acqUnits]: rest.join(',') } : ACQ_CLEAR);
        }
      },
    });
    // The ½" counter follows its target while the Gun keeps a LOS to it; when the target leaves the
    // LOS the counter stays in the last hex it had a LOS to, and the next enemy unit to enter that
    // hex receives it (SK4 6.10). The ⅝" counter belongs to its hex and tracks nothing (6.11).
    r.on<{ id: PieceId; loc: { kind: string; hex?: HexId } }>({
      id: 'sk2.ordnance.acq.moved',
      event: 'piece.moved',
      handler(ctx, ev) {
        const p = ctx.state.pieces[ev.payload.id];
        if (!p) return;
        // A Gun (or an AFV's MA) leaving its location loses its own acquisition; an AFV is also a target
        // that other Guns' counters follow, below.
        if (ordnanceOf(ctx, p)) {
          if (p.tags[T2.acq] !== undefined) setTags(ctx, p.id, { ...ACQ_CLEAR, [T2.emplaced]: null });
        } else {
          const held = ordnanceHeldBy(ctx, p.id);
          if (held && held.tags[T2.acq] !== undefined) setTags(ctx, held.id, ACQ_CLEAR);
        }
        const to = ev.payload.loc.kind === 'hex' ? ev.payload.loc.hex! : null;
        for (const g of gunsWithAcquisition(ctx)) {
          const a = acquisitionOf(g)!;
          if (a.units.includes(p.id)) {
            const gh = hexOf(ctx.state, g);
            if (to && gh && hasLos(ctx, gh, to)) setTags(ctx, g.id, { [T2.acqHex]: to });
            else setTags(ctx, g.id, { [T2.acqUnits]: a.units.filter((u) => u !== p.id).join(',') });
          } else if (a.type === 'ITT' && a.units.length === 0 && to === a.hex && p.side !== g.side && isPersonnelDef(defOf(ctx, p))) {
            setTags(ctx, g.id, { [T2.acqUnits]: p.id });
          }
        }
      },
    });
    function gunsWithAcquisition(env: QueryEnv): Piece[] {
      return Object.values(env.state.pieces).filter((g) => ordnanceOf(env, g) && g.tags[T2.acq] !== undefined).sort(byId);
    }

    // ---------------------------------------------------------------- Guns as targets (SK4 6.7)
    r.procedure<ApplyResultFn>(FP.applyResult, (next) => (ctx, attack, column, baseFinal, out) => {
      if (!attack.ordnance || !next) {
        next?.(ctx, attack, column, baseFinal, out);
        return;
      }
      const tables = statics(ctx).tables;
      const direct = tables.ift(column, baseFinal);
      const enemy = otherSide(ctx.state, attack.side);
      const handled = new Set<PieceId>();
      for (const g of Object.values(ctx.state.pieces).filter((p) => p.side === enemy && gun(ctx, p) && hexOf(ctx.state, p) === attack.target).sort(byId)) {
        const manner = g.loc.kind === 'held' ? g.loc.by : null;
        if (manner && !attack.targets.includes(manner)) continue;
        if (attack.ordnance.ch || direct.kind === 'KIA') {
          ctx.emit('sk2.gun.destroyed', { gun: g.id, reason: attack.ordnance.ch ? 'Critical Hit' : 'Direct Hit (KIA)' });
          ctx.emit('piece.eliminated', { id: g.id, reason: attack.ordnance.ch ? 'Critical Hit' : 'Direct Hit' });
          if (manner) {
            // A CH destroys the crew whatever the IFT DR (SK4 6.1, 6.7), so it is reported as a kill.
            const result: IftResult = attack.ordnance.ch ? { kind: 'KIA' } : direct;
            ctx.emit('sk1.fire.result', { unit: manner, result, finalDr: baseFinal, ...(attack.ordnance.ch ? { critical: true } : {}) });
            ctx.proc<CasualtyFn>(MP.casualtyReduce)(ctx, manner, 'Direct Hit');
            if (ctx.state.pieces[manner]?.loc.kind !== 'eliminated') ctx.proc<CasualtyFn>(MP.casualtyReduce)(ctx, manner, 'Direct Hit');
            handled.add(manner);
          }
        } else if (direct.kind === 'K') {
          setTags(ctx, g.id, { [T.malf]: true });
          ctx.emit('sk2.gun.malf', { gun: g.id, dr: baseFinal, removed: false });
          if (manner) {
            ctx.emit('sk1.fire.result', { unit: manner, result: direct, finalDr: baseFinal });
            ctx.proc<CasualtyFn>(MP.casualtyReduce)(ctx, manner, 'Direct Hit (K)');
            handled.add(manner);
          }
        }
      }
      next(ctx, { ...attack, targets: attack.targets.filter((u) => !handled.has(u)) }, column, baseFinal, out);
    });

    // ---------------------------------------------------------------- actions
    r.action<OrdnanceAction>({
      type: 'fire.ordnance',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const mode = PHASE_FIRE_MODE[env.state.phase];
        if (!mode) return [];
        const side = phaseOwner(env);
        return simpleShots(env, side, fireTargets(env, side), mode).map((shot) => ({ type: 'fire.ordnance', shot }));
      },
      validate(env, a) {
        const mode = PHASE_FIRE_MODE[env.state.phase];
        if (!mode) return 'No fire attacks in this phase';
        if (a.side !== phaseOwner(env)) return 'Not your fire phase';
        return env.query('ordnance.illegal', { shot: a.shot, mode, side: a.side }, null);
      },
      resolve(ctx, a) {
        ctx.proc<OrdnanceFireFn>(OP.fire)(ctx, a.shot, PHASE_FIRE_MODE[ctx.state.phase]!);
        if (!ctx.state.result) {
          ctx.popDecision();
          askPhaseOwner(ctx, phaseOwner(ctx));
        }
      },
    });

    r.action<OrdnanceAction>({
      type: 'defFire.ordnance',
      decisionKinds: [FIRST_FIRE],
      legal(env) {
        const ms = moveState(env);
        if (!ms || !ms.hex) return [];
        const side = otherSide(env.state, env.state.attacker);
        const out: OrdnanceAction[] = [];
        for (const shot of simpleShots(env, side, [moveLoc(ms)!], 'first', firstFireTargets(env, ms))) {
          if (!defShotIllegal(env, shot, side)) out.push({ type: 'defFire.ordnance', shot } as OrdnanceAction);
        }
        return out;
      },
      validate(env, a) {
        const ms = moveState(env);
        if (!ms || !ms.hex) return 'Nothing is moving';
        if (a.shot.target !== moveLoc(ms)) return 'Defensive First Fire must target the moving stack';
        return defShotIllegal(env, a.shot, a.side);
      },
      resolve(ctx, a) {
        const ms = moveState(ctx)!;
        const mode = gunFirstFireMode(ctx, a.shot);
        const targets = firstFireTargets(ctx, ms);
        const out = ctx.proc<OrdnanceFireFn>(OP.fire)(ctx, a.shot, mode, { moving: targets, movingInfo: movingInfo(ctx, ms) });
        const g = ctx.state.pieces[a.shot.weapon];
        const firer = g && g.loc.kind === 'held' ? g.loc.by : a.shot.weapon;
        recordRofChoice(ctx, a.shot.target, [a.shot.weapon], out.rofResidual !== undefined ? [{ sws: [a.shot.weapon], residual: out.rofResidual }] : undefined);
        // A Gun that never had the Special Ammo has not fired (SK4 6.2), so the shot does not count
        // against this location: it may fire again here with other ammo.
        finishDefensiveFire(ctx, out.noAmmo ? [] : [a.shot.weapon, firer, ...(a.shot.director !== undefined ? [a.shot.director] : [])]);
      },
    });

    function defShotIllegal(env: QueryEnv, shot: OrdnanceShot, side: SideId): string | null {
      const ms = moveState(env);
      if (!ms || !ms.hex) return 'Nothing is moving';
      const mode = gunFirstFireMode(env, shot);
      if (shot.targetType === 'IFE') {
        const sc = shotContext(env, shot, mode, side, { moving: firstFireTargets(env, ms) });
        const decl = ifeDeclaration(env, shot, sc);
        const why = firstFireIllegal(env, ms, decl, side);
        if (why) return why;
        return env.query('ordnance.illegal', { shot, mode, side, moving: firstFireTargets(env, ms) }, null);
      }
      // A Gun marked First Fire fires again only as Intensive Fire (SK4 3.3.3), at any range.
      if (mode === 'subsequentFirst' && !shot.intensive) return 'A Gun marked First Fire may only fire again as Intensive Fire';
      if (mode === 'fpf') return 'A Gun marked Final Fire cannot fire again';
      const why = env.query('ordnance.illegal', { shot, mode, side, moving: firstFireTargets(env, ms) }, null);
      if (why) return why;
      const g = pieceOf(env, shot.weapon);
      const firer = g.loc.kind === 'held' ? g.loc.by : g.id;
      for (const id of [g.id, firer, ...(shot.director !== undefined ? [shot.director] : [])]) {
        if ((ms.firedHere[id] ?? 0) >= ms.mfHere) return `${id} cannot fire again at this location`;
      }
      return null;
    }

    // The defender is interrupted for a Gun shot too.
    r.contribute({
      id: 'sk2.move.firstFire.ordnance',
      query: 'move.firstFireAvailable',
      apply(v, { hex, units, side }, env) {
        if (v) return v;
        return simpleShots(env, side, [hex], 'first', units).some((shot) => {
          if (defShotIllegal(env, shot, side)) return false;
          const g = pieceOf(env, shot.weapon);
          return plausibleShot(env, [locOf(env.state, g)!], hex);
        });
      },
    });
  },
};
