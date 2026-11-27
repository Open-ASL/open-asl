import type { Action, Ctx, Decision, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, hexOf, isPersonnelDef, isVehicleDef, otherSide, personnelAt, statics, swHeldBy } from '../common/pieces';
import { hexOfLoc, locExists, locOf, type LocId } from '../common/location';
import { capturedUseExempt, targetThDrm } from '../sk1/forceRules';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import type { AmmoKind, GunDef, IftResult, Mount } from '../common/statics';
import {
  FP,
  discloseDrm,
  fireTargetsAt,
  firedOwnFpThisPhase,
  fpfCheck,
  iftColumn,
  markFirers,
  onRoadInTheOpen,
  onWoodsRoad,
  outsideDrm,
  residualFpLeft,
  type ApplyResultFn,
  type AttackResolvedFn,
  type BeforeApplyFn,
  type FireAttackCtx,
  type FireDeclaration,
  type FireMode,
  type ResolveFireFn,
  withoutSecrets,
} from '../sk1/fire';
import { PHASE_FIRE_MODE, fireTargets, phaseOwner } from '../sk1/firePhases';
import { P as MP, type CasualtyFn, type CheckGroupFn, type FlushFn, type RandomSelectFn } from '../sk1/morale';
import { FIRST_FIRE, finishDefensiveFire, firstFireIllegal, firstFireLocations, firstFireTargets, firstFireMode, firstFireView, moveState, movingInfo, plausibleShot, recordRofChoice } from '../sk1/movement';
import { hasLos, visibleEnemyAt, isKnownTo, knownEnemyAt } from '../sk1/known';
import {
  T,
  drmNotes,
  fireMarker,
  finalFireMarker,
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
import { isWoodsRoad, smoke58Counters, smoke58Markers, terrainOf } from '../sk1/terrain';
import { AMMO_NAME, AMMO_OUT, ammoColumn, ammoKinds, ammoOut, ammoStatus, defaultAmmo, isSmokeAmmo, leavesResidual, specialAmmoOf } from './ammo';
import { caChangeDrm, inCoveredArc, mountLabel, nearestSpine, spineChange } from './arc';
import { emplacementThDrm, revealGun } from './guns';
import { T2, caTurnedIllegal, coveredArc, isHidden, isMgOrdnance, ACQ_CLEAR, acqCandidates, acquisitionOf, ordnanceHeldBy, ordnanceOf, shotWeaponOf } from './status';

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
  /** A preview before the shot is declared: nothing that needs the LOS is worked out (ASLRB A6.11; `FireAttackCtx`). */
  losBlind?: boolean;
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
    /**
     * Whether a BAZ, PSK or PF fired from Location `loc` brings its Backblast (SK4 4.4.3; ASLRB C13.8): 'choice' (inside a
     * building: the Backblast attack or the +2 To Hit DRM), 'desperation' (only the Backblast attack, C13.81: full ASL, from
     * inside a pillbox) or null.
     */
    'ordnance.backblastAt': { ctx: { loc: LocId }; value: 'choice' | 'desperation' | null };
    /**
     * Whether HEAT may fire at the Infantry in `target` for a cover other than a building (ASLRB C8.31: "Infantry/Cavalry
     * receiving a wall/building/rubble/pillbox TEM"); false in the Starter Kit.
     */
    'ordnance.heatTarget': { ctx: { target: LocId; side: SideId }; value: boolean };
    /** Why an ordnance shot is illegal, or null. */
    'ordnance.illegal': { ctx: { shot: OrdnanceShot; mode: FireMode; side: SideId; moving?: PieceId[] }; value: string | null };
    /** To Hit DRM of a shot (chart cases 1–25 as they apply). */
    'ordnance.thDrm': { ctx: ShotCtx; value: number };
    /**
     * The vehicles in Location `target` a Vehicle Target Type shot by `side` names one by one (`OrdnanceShot.targetUnit`):
     * none in the Starter Kit (a side has one vehicle per hex at the end of the MPh, SK4 3.3.2, so the shot takes the
     * enemy vehicle there); full ASL each of several enemy vehicles in one Location (ASLRB A5.2).
     */
    'ordnance.vttTargets': { ctx: { target: LocId; side: SideId }; value: PieceId[] };
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
    /** Why an Infantry Target Type shot at a Location with no Known enemy unit is illegal; null when it has another target there (ASLRB B29.5: a roadblock). */
    'ordnance.noUnitTarget': { ctx: { shot: OrdnanceShot; mode: FireMode; side: SideId }; value: string | null };
    /** What else the shot attacks, for the shot composer and log (ASLRB B29.5: the roadblock and the To Hit DR it needs). */
    'ordnance.alsoAttacks': { ctx: ShotCtx; value: string[] };
    /**
     * Whether an Infantry Target Type hit in `target`, fired from `from`, attacks this vehicle's crew (SK4 3.2.4: "All enemy
     * targets except for BU AFV in the target hex can be affected by a hit including any Crew Exposed (7.7) units"; 7.12;
     * ASLRB C3.32, D.8B). The AFV itself is never harmed. None without the vehicle rules.
     */
    'ordnance.ittCrew': { ctx: { vehicle: PieceId; target: LocId; from?: LocId }; value: boolean };
    /** Why a vehicle's Main Armament may not fire this shot, or null (SK3; replaces the Gun's manning checks). */
    'ordnance.maIllegal': { ctx: { shot: OrdnanceShot; mode: FireMode; side: SideId; moving?: PieceId[] }; value: string | null };
  }
}

export const OP = {
  /** (ctx, shot, mode, opts) => OrdnanceOutcome */
  fire: 'sk2.ordnance.fire',
  /** (ctx, sc, hit, targets, results) => IFT columns used (for Residual FP): the effect of a To Hit roll. SK3 wraps it for the Vehicle Target Type. */
  resolveHit: 'sk2.ordnance.resolveHit',
  /**
   * (ctx, action, decision) => boolean: asked first by every action that fires ordnance; true holds the action back
   * (full ASL: the target's owner first chooses between Hull Down and in-hex TEM, ASLRB B9.36, D4.2). The Starter Kit
   * never holds one back.
   */
  pause: 'sk2.ordnance.pause',
  /** (ctx, action, decision) => void: resolves an ordnance action that was held back, each module its own action types. */
  resume: 'sk2.ordnance.resume',
} as const;
export type OrdnancePauseFn = (ctx: Ctx, action: Action, decision: Decision) => boolean;
export type OrdnanceResumeFn = (ctx: Ctx, action: Action, decision: Decision) => void;
export type ResolveHitFn = (ctx: Ctx, sc: ShotCtx, hit: HitInfo, targets: PieceId[], results: Record<PieceId, IftResult>) => number[];

export type OrdnanceFireFn = (
  ctx: Ctx,
  shot: OrdnanceShot,
  mode: FireMode,
  opts?: { moving?: PieceId[]; movingInfo?: FireAttackCtx['moving'] },
) => OrdnanceOutcome;

export type OrdnanceAction = Action & { shot: OrdnanceShot };
/** The question put to a Gun's owner when its acquired stack scatters (SK4 6.10): which hex keeps the counter. */
export const ACQ_CHOICE_DECISION = 'acqChoice';
export type AcqChooseAction = Action & { type: 'acq.choose'; gun: PieceId; hex: HexId };

/** The year of the scenario, from its dateline ("26 April 1941"); undefined when not given. */
const scenarioYear = (env: QueryEnv): number | undefined => {
  const m = /\b(19\d\d)\b/.exec(statics(env).scenario.date ?? '');
  return m ? Number(m[1]) : undefined;
};

/** Build the shot context (no legality checks). */
export function shotContext(env: QueryEnv, shot: OrdnanceShot, mode: FireMode, side: SideId, opts: { moving?: PieceId[]; movingInfo?: FireAttackCtx['moving'] } = {}): ShotCtx {
  const g = pieceOf(env, shot.weapon);
  const def = shotWeaponOf(env, g)!;
  const firer = g.loc.kind === 'held' ? g.loc.by : g.id;
  const hex = hexOf(env.state, g)!;
  const loc = locOf(env.state, g)!;
  const map = statics(env).map;
  const range = map.distance(hex, hexOfLoc(shot.target));
  const spines = shot.ca !== undefined ? spineChange(coveredArc(g), shot.ca) : 0;
  const los = env.query('los.trace', { from: loc, to: shot.target }, { clear: true, hindrance: 0, parts: [] });
  const manner = env.state.pieces[firer];
  const targetVehicle = shot.targetType === 'VTT' ? (shot.targetUnit ?? enemyVehicleAt(env, shot.target, side, opts.moving)?.id) : undefined;
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
export function enemyVehicleAt(env: QueryEnv, hex: HexId, side: SideId, moving?: PieceId[]): Piece | undefined {
  const there = Object.values(env.state.pieces)
    .filter((p) => p.side !== side && locOf(env.state, p) === hex && defOf(env, p).kind === 'vehicle' && p.tags['wreck'] !== true)
    .sort(byId);
  // During an enemy move the vehicle aimed at by default is the one moving (Defensive First Fire, SK4 3.3.3).
  return there.find((p) => moving?.includes(p.id)) ?? there[0];
}

/**
 * Whether the target's TEM is a To Hit DRM (case 17 "TEM (NA for ATT)"; ASLRB C6.8 Case Q): on the Infantry and the
 * Vehicle Target Type, a vehicle in Motion included. On the Area Target Type it modifies the IFT DR instead.
 */
export const temOnToHit = (sc: ShotCtx) => sc.shot.targetType === 'ITT' || sc.shot.targetType === 'VTT';

/**
 * Who a Woods-Road hex's TEM is judged for: the moving Infantry unit that entered it along the road, or, on the Vehicle
 * Target Type, the vehicle, which is always on the road there (ASLRB B13.31): either has the woods TEM only against a
 * firer whose LOS crosses the woods art.
 */
export function woodsRoadMover(env: QueryEnv, sc: ShotCtx): ShotCtx['movingInfo'] {
  if (sc.shot.targetType === 'VTT' && isWoodsRoad(env, hexOfLoc(sc.target))) return { ...sc.movingInfo, assault: !!sc.movingInfo?.assault, viaRoadIntoWoodsRoad: true };
  return sc.movingInfo;
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

/**
 * Targets of a shot at a hex: the moving stack during the MPh, otherwise the personnel there (`fireTargetsAt`: everyone in a
 * Melee hex; the firer's own Infantry too unless the shot comes from inside that Location). An Area Target Type hit "can
 * potentially affect all units in the hex" (SK4 3.2.4), so it attacks the vehicles there too (SK4 7.11, 7.12). An Infantry
 * Target Type hit attacks the vulnerable crews of the AFV there, never the AFV (`ordnance.ittCrew`; SK4 3.2.4, 7.12).
 */
function shotTargets(env: QueryEnv, side: SideId, target: HexId, moving?: PieceId[], targetVehicle?: PieceId, from?: LocId, area = false): PieceId[] {
  // A Vehicle Target Type hit affects that vehicle alone (SK4 3.2.4).
  if (targetVehicle) return env.state.pieces[targetVehicle]?.loc.kind === 'hex' ? [targetVehicle] : [];
  // A mover wrecked on its way is no longer a target (sk1 buildAttack).
  if (moving) return moving.filter((u) => env.state.pieces[u]?.loc.kind === 'hex' && env.state.pieces[u]?.tags['wreck'] !== true);
  return fireTargetsAt(env, target, side, from === target)
    .filter((p) => isPersonnelDef(defOf(env, p)) || (isVehicleDef(defOf(env, p)) && p.tags['wreck'] !== true && (area || env.query('ordnance.ittCrew', { vehicle: p.id, target, ...(from ? { from } : {}) }, false))))
    .map((p) => p.id)
    .sort();
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
/** The Backblast a BAZ/PSK/PF fired from Location `loc` brings (`'ordnance.backblastAt'`): in a building the choice (SK4 4.4.3, 8.2.1). */
export const backblastFrom = (env: QueryEnv, loc: LocId): 'choice' | 'desperation' | null => env.query('ordnance.backblastAt', { loc }, backblastHex(env, hexOfLoc(loc)) ? 'choice' : null);
/** The Backblast firing this weapon where it is now brings: a BAZ or PSK (not a PIAT) in a building (not a hut), or full ASL's Desperation (C13.81). */
export function latwBackblast(env: QueryEnv, weapon: PieceId): 'choice' | 'desperation' | null {
  const w = env.state.pieces[weapon];
  const d = w ? ordnanceOf(env, w) : null;
  const at = w ? locOf(env.state, w) : null;
  return !!d && !!at && hasBackblast(d) ? backblastFrom(env, at) : null;
}
/** The Backblast of a shot (`backblastFrom` of its firer's Location), null for a weapon without one. */
const shotBackblast = (env: QueryEnv, sc: ShotCtx) => (hasBackblast(sc.def) ? backblastFrom(env, locOf(env.state, pieceOf(env, sc.firer)) ?? sc.hex) : null);
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
  const def = g ? shotWeaponOf(env, g) : null;
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
/**
 * A HS or crew fires one weapon "but forfeits its own FP" (SK4 4.0): in a fire phase it uses one or the other. Having
 * fired its own FP this phase it may not fire a Gun, Mortar or LATW too, not even later in the MPh, since only Small
 * Arms, MG and IFE fire as Subsequent First Fire (ASLRB A8.3). A squad fires one weapon at no cost to its own FP.
 * Prep Fire marks "the firing unit (and Weapon)" (SK4 3.2.2) and only units "which did not fire in the PFPh" fire in
 * the AFPh (ASLRB A3.5), so one that fired its own FP in the PFPh fires its weapon in the AFPh no more than in the PFPh.
 */
function ownFpSpent(env: QueryEnv, manner: Piece, what: string, mode: FireMode): string | null {
  const kind = mmc(env, manner)?.kind;
  if (kind !== 'hs' && kind !== 'crew') return null;
  const unit = kind === 'hs' ? 'half-squad' : 'crew';
  if (firedOwnFpThisPhase(env, manner.id)) return `A ${unit} that fired its own FP this phase may not also fire its ${what}`;
  if (mode === 'advancing' && fireMarker(manner) === 'prep') return `A ${unit} that fired its own FP in the PFPh may not fire its ${what} in the AFPh`;
  return null;
}

/**
 * A unit's weapon uses this phase other than this weapon: weapons it holds that fired (marked, or unmarked with ROF
 * kept) and uses whose weapon is gone (a SW destroyed, a PF check; SK4 4.4.2). A HS, crew or SMC fires one weapon a
 * phase and a squad at most two, the second only while its own FP is unspent (SK4 4.0; ASLRB A7.35, A7.351). The
 * same weapon firing again with ROF is not another use. A squad manning a Gun is left to the Gun rules: only its SW
 * (a Mortar, a LATW, a MG fired as ordnance) count against it here.
 */
function otherWeaponUsed(env: QueryEnv, manner: Piece, g: Piece, light: boolean, what: string): string | null {
  const others = swHeldBy(env.state, manner.id).filter((w) => w.id !== g.id && (fireMarker(w) !== undefined || w.tags[T.rofFired] !== undefined)).length;
  const used = others + ((manner.tags[T.swDestroyed] as number | undefined) ?? 0);
  if (used === 0) return null;
  const kind = mmc(env, manner)?.kind;
  if (kind === 'hs' || kind === 'crew' || smc(env, manner)) return `A ${kind === 'hs' ? 'half-squad' : kind === 'crew' ? 'crew' : 'SMC'} that used another weapon this phase may not also fire its ${what}`;
  if (kind === 'squad' && light) {
    if (used >= 2) return 'A squad may use at most two SW per phase';
    if (firedOwnFpThisPhase(env, manner.id) || manner.tags[T.ownFpForfeit]) return 'A squad that fired its own FP may use only one SW';
  }
  return null;
}

export function ordnanceWeaponIllegal(env: QueryEnv, weapon: PieceId, mode: FireMode, side: SideId): string | null {
  const g = env.state.pieces[weapon];
  const def = g ? shotWeaponOf(env, g) : null;
  if (!g || !def || def.vehicle) return null;
  const what = weaponName(def);
  if (g.side !== side) return `Not your ${what}`;
  if (g.loc.kind !== 'held') return def.light ? `Nobody possesses the ${what}` : 'The Gun is not manned';
  const manner = pieceOf(env, g.loc.by);
  if (!mmc(env, manner) && !(def.light && smc(env, manner))) return 'Only a MMC may fire a Gun';
  if (!isGoodOrder(env, manner)) return `The ${def.light ? 'possessing' : 'manning'} unit is not in Good Order`;
  const spent = ownFpSpent(env, manner, what, mode) ?? otherWeaponUsed(env, manner, g, !!def.light, what);
  if (spent) return spent;
  if (isMalf(g)) return `The ${what} is malfunctioned`;
  const halved = isMgOrdnance(def) ? mgHalvedFp(env, manner, mode, side) : null;
  if (halved) return halved;
  const turned = caTurnedIllegal(env, g) ?? caTurnedIllegal(env, manner);
  if (turned) return turned;
  if (mode === 'advancing' && !isLatw(def) && env.query('fire.weaponMovedForAfph', { sw: g.id, holder: manner.id }, !!(g.tags[T.moved] || manner.tags[T.moved]))) return `A ${def.light ? 'Mortar' : 'Gun'} that moved cannot fire in the AFPh`;
  if (mode === 'advancing' && (g.tags[T2.manhandled] || manner.tags[T2.manhandled])) return 'A manhandled Gun cannot fire in the AFPh';
  return null;
}

/** What the messages call a weapon: a Gun, a Light Mortar, or a SW by its type (BAZ, ATR, MG ...). */
const weaponName = (def: GunDef) => (def.latw || def.type === 'ATR' || isMgOrdnance(def) ? def.type : def.light ? 'Mortar' : 'Gun');

/**
 * Why an Infantry MG may not fire as ordnance now: the attack must be made "without any form of halved FP penalty"
 * (SK4 4.1; ASLRB A9.61), so not in the AFPh (SK1 3.5), not by a pinned unit (3.2.1), not by a lone SMC (4.1),
 * and not as Subsequent First Fire or FPF (3.3.1). A MG marked First Fire fires no more in the DFPh at full FP
 * either; the fire marker check below covers that.
 */
function mgHalvedFp(env: QueryEnv, manner: Piece, mode: FireMode, side: SideId): string | null {
  const why = 'A MG fires as ordnance only without halved FP (SK4 4.1)';
  if (mode === 'advancing') return `${why}: all fire is halved in the AFPh`;
  if (mode === 'subsequentFirst' || mode === 'fpf') return `${why}: Subsequent First Fire and FPF are halved`;
  if (isPinned(manner)) return `${why}: a pinned unit fires at half FP`;
  const hex = locOf(env.state, manner);
  if (smc(env, manner) && hex && !personnelAt(env, hex, side).some((p) => p.id !== manner.id && smc(env, p) && isGoodOrder(env, p))) return `${why}: a lone SMC fires a MG at half FP`;
  return null;
}

function ordnanceIllegal(env: QueryEnv, shot: OrdnanceShot, mode: FireMode, side: SideId, moving?: PieceId[]): string | null {
  const g = env.state.pieces[shot.weapon];
  const def = g ? shotWeaponOf(env, g) : null;
  if (!g || !def) return 'Not a Gun';
  const what = def.vehicle ? 'Main Armament' : weaponName(def);
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
    const spent = ownFpSpent(env, manner, what, mode) ?? otherWeaponUsed(env, manner, g, !!def.light, what);
    if (spent) return spent;
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
    // Defensive First Fire attacks only the moving unit, never a vehicle that sits in its hex (SK4 3.3.3, ASLRB A8.1).
    if (moving && !moving.includes(tv.id)) return 'Defensive First Fire may attack only the moving unit: that vehicle is not moving';
    if (def.type === 'MTR') return 'A Mortar cannot use the Vehicle Target Type';
  } else if (isMgOrdnance(def)) return 'A MG fires as ordnance only at an AFV (SK4 4.1); at anything else it fires on the IFT';
  if (isMgOrdnance(def)) {
    const halved = mgHalvedFp(env, manner, mode, side);
    if (halved) return halved;
  }
  if (def.light) {
    // A SW has no Covered Arc (SK4 4.5).
    if (shot.ca !== undefined) return `A ${def.type === 'MTR' ? 'Light Mortar' : def.type} has no Covered Arc`;
  } else if (shot.ca !== undefined) {
    if (!Number.isInteger(shot.ca) || shot.ca < 0 || shot.ca > 5) return 'Covered Arc is a hexspine 0-5';
    if (isPinned(manner)) return 'A pinned Gun cannot change its Covered Arc';
    if (!inCoveredArc(map.hex(sc.hex)!.cube, shot.ca, map.hex(hexOfLoc(shot.target))!.cube)) return 'The target is outside the new Covered Arc';
  } else if (!inCoveredArc(map.hex(sc.hex)!.cube, coveredArc(g), map.hex(hexOfLoc(shot.target))!.cube)) {
    return 'The target is outside the Covered Arc (turn the Gun first)';
  }
  if (sc.def.minRange !== undefined && sc.range < sc.def.minRange) return 'Inside the minimum range';
  if (sc.def.maxRange !== undefined && sc.range > sc.def.maxRange) return isMgOrdnance(sc.def) ? `A MG fires as ordnance only within its normal range (${sc.def.maxRange} hexes, SK4 4.1)` : 'Beyond the maximum range';
  // A LATW may Advancing Fire after moving (+2, chart case 12); a Gun or Mortar that moved may not.
  if (mode === 'advancing' && !isLatw(def) && !def.vehicle && env.query('fire.weaponMovedForAfph', { sw: g.id, holder: manner.id }, !!(g.tags[T.moved] || manner.tags[T.moved]))) return `A ${def.light ? 'Mortar' : 'Gun'} that moved cannot fire in the AFPh`;
  if (mode === 'advancing' && (g.tags[T2.manhandled] || manner.tags[T2.manhandled])) return 'A manhandled Gun cannot fire in the AFPh';
  if (shot.director !== undefined) {
    const why = ordnanceDirectorIllegal(env, shot.weapon, shot.director, side, shot.targetType);
    if (why) return why;
  }
  // A Mortar may not fire from a building (SK4 1.1.1, 6.9).
  if (sc.def.type === 'MTR' && isBuildingHex(env, sc.hex)) return 'A Mortar may not fire from a building';
  if (sc.def.type === 'MTR' && shot.targetType !== 'ATT') return 'A Mortar must use the Area Target Type';
  if (sc.def.latw && shot.targetType !== 'ITT' && shot.targetType !== 'VTT') return `A ${sc.def.type} fires on its own To Hit Table at units (Infantry Target Type) or at a vehicle`;
  const bb = shotBackblast(env, sc);
  if (shot.backblast !== undefined && !bb) return 'Backblast only arises firing a BAZ or PSK from inside a building';
  if (bb === 'choice' && isPinned(manner) && shot.backblast === false) return 'A pinned firer cannot take the +2 to avoid Backblast';
  if (bb === 'desperation' && shot.backblast !== true) return 'Fired from here only with the Desperation penalty: the Backblast attack on everyone in the firing Location (ASLRB C13.8, C13.81)';
  // SK4 4.4.5: "A PIAT may not fire at a unit one level lower and in an adjacent hex."
  if (sc.def.type === 'PIAT' && sc.range === 1 && (map.hex(hexOfLoc(shot.target))!.elevation ?? 0) === (map.hex(sc.hex)!.elevation ?? 0) - 1) return 'A PIAT may not fire at an adjacent unit one level lower';
  // In Final Fire a Gun fires under its manning unit's First or Final Fire marker as well as its own (SK4 3.3.3), so a
  // crew marked First Fire in the MPh leaves its unfired Gun only Intensive Fire at an adjacent hex.
  const marker = mode === 'final' && !def.vehicle ? finalFireMarker(env, g) : fireMarker(g);
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
  if (!moving && shot.targetType === 'ITT' && knownEnemyAt(env, shot.target, side).length === 0) {
    // No Known enemy unit there: another target may be (full ASL: a roadblock, ASLRB B29.5).
    const why = env.query('ordnance.noUnitTarget', { shot, mode, side }, 'No target there');
    if (why) return why;
  }
  if (g.tags[T2.intensive]) return 'The Gun has used Intensive Fire this Player Turn';
  if (shot.intensive) {
    if (def.light) return 'A SW cannot use Intensive Fire';
    if (sc.def.noIntensive) return 'This Gun may not use Intensive Fire ("No IF" on the counter)';
    if (!marker) return 'Intensive Fire is only possible after the Gun has fired and lost ROF';
    if (mode === 'advancing') return 'No Intensive Fire in the AFPh';
    // "A unit already marked with Final Fire cannot fire during Final Fire" (SK4 3.3.3).
    if (mode === 'final' && marker === 'final') return 'The Gun is marked Final Fire';
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
        if (marker === 'first' && !fireMarker(g))
          return def.light
            ? `The possessing unit is marked First Fire, and its ${what} with it: no more fire at full strength this Player Turn (SK4 3.3.3)`
            : 'The manning unit is marked First Fire: its Gun may fire only as Intensive Fire at an adjacent hex (SK4 3.3.3)';
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

const WOODS_LIKE = new Set(['woods', 'jungle', 'jungle-light', 'bamboo']);
/**
 * Woods (under PTO Terrain jungle and bamboo, "treated as woods", SK4 8.2.1), a building or rubble: where the To Hit
 * chart's "woods/building" cases bite (case 1 +3, case 8 doubled, case 10 +4; ASLRB C5.11 "woods/building/rubble").
 */
export const woodsBuildingOrRubble = (env: QueryEnv, hex: HexId): boolean => {
  const t = terrainOf(env, hex).id;
  return WOODS_LIKE.has(t) || t.startsWith('rubble') || isBuildingHex(env, hex);
};
const closeName = (env: QueryEnv, hex: HexId) => (isBuildingHex(env, hex) ? 'a building' : terrainOf(env, hex).id.startsWith('rubble') ? 'rubble' : terrainOf(env, hex).name.toLowerCase());
/**
 * Case 8 doubles for a firer in woods, a building or rubble, but not for a vehicle on the road in a Woods-Road hex
 * (ASLRB C5.11; the engine keeps vehicles on the road there).
 */
const caDoubled = (env: QueryEnv, hex: HexId, vehicle: boolean) => woodsBuildingOrRubble(env, hex) && !(vehicle && isWoodsRoad(env, hex));
/** Case 8: the Covered Arc change DRM, doubled for a firer in woods, a building or rubble. */
const caDrm = (env: QueryEnv, hex: HexId, mount: Mount, spines: number, vehicle: boolean) => caChangeDrm(mount, spines) * (caDoubled(env, hex, vehicle) ? 2 : 1);
const ifeCaDrm = (env: QueryEnv, attack: FireAttackCtx) => {
  const hex = hexOf(env.state, pieceOf(env, attack.caChange!.weapon));
  return hex ? caDrm(env, hex, attack.caChange!.mount, attack.caChange!.spines, true) : caChangeDrm(attack.caChange!.mount, attack.caChange!.spines);
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
  if (isSmokeAmmo(ammo) && (mode === 'prep' || mode === 'final') && firerFiredNonSmoke(env, g)) return `${AMMO_NAME[ammo]} must be fired before the firer fires anything else this phase (SK4 6.2)`;
  if (targetType === 'VTT') return null;
  if (!isSmokeAmmo(ammo) && ammoColumn(env, def, ammo, targetType, false) === null) return `This Gun has no ${targetType} column`;
  return null;
}

/**
 * Whether the firer of a Smoke shot has fired anything other than Smoke this phase (SK4 6.2: "Once the firer has
 * fired anything other than Smoke during that PFPh/DFPh no more Smoke may be fired in that phase"). SK4 says "the
 * firer" where ASLRB C8.5 says "any unit", so the bar is per firer, not side-wide: the Gun or vehicle with
 * everything that fires with it. A vehicle with its MG, a Gun with its manning crew, a Mortar with the unit that
 * possesses it and that unit's other weapons. A MG burst, the crew's own FP or the MA's IFE ends the Smoke for all.
 */
function firerFiredNonSmoke(env: QueryEnv, g: Piece): boolean {
  const holder = g.loc.kind === 'held' ? env.state.pieces[g.loc.by] : undefined;
  const group = [g, ...swHeldBy(env.state, g.id), ...(holder ? [holder, ...swHeldBy(env.state, holder.id)] : [])];
  // An ordnance shot other than Smoke marks its weapon; an IFT attack (a MG, a unit's own FP, IFE) is never Smoke, and
  // the phase's fire log names every unit and weapon that made one.
  return group.some((p) => !!p.tags[T2.firedNonSmoke] || firedOwnFpThisPhase(env, p.id));
}

/** The ammunition check of a shot: `ammoUseIllegal`, and HEAT only at Infantry in a building or at a Gun. */
function ammoIllegal(env: QueryEnv, g: Piece, sc: ShotCtx, mode: FireMode, side: SideId): string | null {
  const why = ammoUseIllegal(env, g, sc.def, sc.ammo, sc.shot.targetType, mode);
  if (why) return why;
  if (sc.ammo === 'HEAT' && sc.shot.targetType !== 'VTT' && !isBuildingHex(env, hexOfLoc(sc.shot.target)) && !enemyGunAt(env, sc.shot.target, side) && !env.query('ordnance.heatTarget', { target: sc.shot.target, side }, false)) return 'HEAT may only be fired at Infantry in a building or at a Gun (or at a vehicle)';
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
  if (fp > existing) ctx.emit('hex.marker', { hex: target, key: 'residualFp', value: fp, residual: { column, outside: outsidePoints, bonus: bonusColumns } });
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
  const fullDrmRes = ctx.explain('ordnance.thDrm', sc, 0);
  const roll = ctx.roll(`To Hit ${shot.target}`);
  const [white, colored] = roll.dice as [number, number];
  const original = roll.total;
  // SK3 case 16 adds the lower die again for a Motion/Non-Stopped firer.
  const extra = ctx.query('ordnance.thExtra', { sc, dice: [white, colored] }, 0);
  // A secret part of the DRM (an unrevealed fortified building's +1) is applied, and told of, only when it decides
  // the hit or the Critical Hit; otherwise the shot is resolved with the visible DRM, which gives the same outcome.
  const hitWith = (drm: number) => {
    const f = original + drm + extra;
    const h = f <= thn.th;
    return { hit: h, ch: h && thn.ch > 0 && (shot.targetType === 'ATT' || shot.targetType === 'VTT' || sc.def.latw ? original === 2 : f <= thn.ch) };
  };
  const shownRes = withoutSecrets(fullDrmRes);
  const full = hitWith(fullDrmRes.value);
  const shown = hitWith(shownRes.value);
  const drmRes = full.hit === shown.hit && full.ch === shown.ch ? shownRes : fullDrmRes;
  const drm = drmRes.value;
  const final = original + drm + extra;
  const ammo = sc.ammo;
  const targets = blind ? [] : pfTarget(ctx, sc, shotTargets(ctx, side, shot.target, opts.moving, sc.targetVehicle, sc.loc ?? sc.hex, shot.targetType === 'ATT'));

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

  // ROF (SK4 1.2.4.1, 3.2.4): kept when the colored dr is within the effective ROF, never in the AFPh ("may fire again
  // in that phase (except the AFPh)", SK4 1.2.4.1).
  const rof = ctx.query('ordnance.rof', sc, 0);
  const manner = pieceOf(ctx, sc.firer);
  // Fire on the Area Target Type by other than a Mortar consumes all of the Gun's ROF (SK4 3.2.4; ASLRB C3.33: Intensive
  // Fire excepted): said as such, not as a colored dr above a ROF of 0.
  const areaFire = shot.targetType === 'ATT' && sc.def.type !== 'MTR';
  const why = shot.intensive ? 'intensive' : malfunctioned || removed ? 'malfunction' : mode === 'advancing' ? 'afph' : areaFire ? 'area' : colored > rof ? 'exceeded' : isPinned(manner) ? 'pinned' : null;
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
  // A LATW or an Infantry MG never gains Acquisition (SK4 4.5 grants it to Light Mortars alone among SW).
  // The ½" counter sits on the units it acquired, so a shot that eliminates every one of them leaves
  // no counter behind (the hex keeps one only when its target leaves the LOS).
  // Only Known units are acquired (SK4 8.3.2: a concealed target is acquired by the Area Target Type, or once the shot made it drop its "?").
  const survivors = targets.filter((u) => ctx.state.pieces[u] && ctx.state.pieces[u].loc.kind !== 'eliminated' && ctx.state.pieces[u].tags['wreck'] !== true && (shot.targetType === 'ATT' || isKnownTo(ctx, ctx.state.pieces[u]!, side)));
  const acquires = ctx.query('ordnance.acquires', sc, true);
  // A blocked shot acquires nothing; it keeps an acquisition of that same target and loses any other (6.10).
  if (blind) {
    if (g.tags[T2.acqHex] !== shot.target) setTags(ctx, g.id, ACQ_CLEAR);
  } else if (acquires && !malfunctioned && !removed && !isSmokeAmmo(ammo) && !isLatw(sc.def) && !isMgOrdnance(sc.def) && (shot.targetType === 'ATT' || survivors.length > 0)) {
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
  if (shot.backblast && shotBackblast(ctx, sc)) {
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
    ...hitLocs.filter((l) => l !== shot.target).map((loc) => ({ ch: false, units: shotTargets(ctx, side, loc, undefined, undefined, sc.loc ?? sc.hex, shot.targetType === 'ATT'), loc })),
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
  for (const { grp, column, attack, iftDrmRes: fullIftRes, desperate } of planned) {
    // A secret part of the IFT DRM (a fortified building's reversed +1 on a Critical Hit) is disclosed only when it
    // changes a result, or whether a broken target became DM (`discloseDrm`, as for small arms).
    const nmcAt = (drm: number) => {
      const k = statics(ctx).tables.ift(column, 2 + drm).kind;
      return k !== 'none' && k !== 'PTC';
    };
    const forced = grp.units.some((u) => isBroken(pieceOf(ctx, u))) && nmcAt(fullIftRes.value) !== nmcAt(withoutSecrets(fullIftRes).value);
    const iftDrmRes = discloseDrm(ctx, attack, column, ift.total, fullIftRes, forced);
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
    // Full ASL: a HE or HEAT KIA on the Original DR may collapse a building Location into rubble before the attack reaches
    // its occupants (ASLRB B24.11); the base procedure never does.
    const by = ammo === 'HE' || ammo === 'HEAT' ? 'he' : 'other';
    const rubbled = ctx.proc<BeforeApplyFn>(FP.beforeApply)(ctx, { target: grp.loc, by, column, originalDr: ift.total, caliber: sc.def.caliber, heat: ammo === 'HEAT', side, from: sc.hex, ...(planned.length > 1 ? { group: planned.map((x) => x.grp.loc) } : {}) });
    if (!rubbled) ctx.proc<ApplyResultFn>(FP.applyResult)(ctx, attack, column, ift.total + iftDrm, results);
    ctx.proc<AttackResolvedFn>(FP.attackResolved)(ctx, {
      target: grp.loc,
      by,
      result: statics(ctx).tables.ift(column, ift.total + iftDrm).kind,
      malfunctioned: false,
      from: sc.hex,
      side,
      originalResult: statics(ctx).tables.ift(column, ift.total).kind,
      originalDr: ift.total,
      heat: ammo === 'HEAT',
      ...(rubbled ? { rubbled: true } : {}),
    });
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
      const bbMode = hasBackblast(def) ? backblastFrom(env, locOf(env.state, g) ?? hex) : null;
      const backblasts: (boolean | undefined)[] = bbMode === 'choice' ? [false, true] : bbMode === 'desperation' ? [true] : [undefined];
      // The default ammunition, then each other kind the Gun could announce (SK4 6.2).
      const dflt = defaultAmmo(env, g, def);
      const ammos: (AmmoKind | undefined)[] = [undefined, ...ammoKinds(def).filter((k) => k !== dflt && ammoStatus(env, g, def, k).available)];
      const named = vehicleThere ? env.query('ordnance.vttTargets', { target: t, side }, []) : [];
      for (const targetType of types) {
        for (const ammo of targetType === 'IFE' ? [undefined] : ammos) {
          for (const intensive of [false, true]) {
            for (const backblast of backblasts) for (const targetUnit of targetType === 'VTT' && named.length ? named : [undefined]) {
              const shot: OrdnanceShot = {
                weapon: g.id,
                target: t,
                targetType,
                ...(targetUnit ? { targetUnit } : {}),
                ...(ca !== undefined ? { ca } : {}),
                ...(intensive ? { intensive } : {}),
                ...(ammo ? { ammo } : {}),
                ...(backblast !== undefined ? { backblast } : {}),
              };
              if (targetType === 'IFE' && intensive) continue;
              // IFE marked First (Final) Fire fires again like a MG, as Subsequent First Fire (FPF), not as Intensive Fire
              // (SK4 6.8; ASLRB C2.29): its Defensive First Fire mode is the ordinary one, as the move's own check reads it.
              const m = moving && mode === 'first' && targetType === 'IFE' ? gunFirstFireMode(env, shot) : mode;
              if (!env.query('ordnance.illegal', { shot, mode: m, side, ...(moving ? { moving } : {}) }, null)) out.push(shot);
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
    r.procedure<OrdnancePauseFn>(OP.pause, () => () => false);
    r.procedure<OrdnanceResumeFn>(OP.resume, (next) => (ctx, a, d) => {
      if (a.type === 'fire.ordnance') resolveFire(ctx, a as OrdnanceAction);
      else if (a.type === 'defFire.ordnance') resolveDefFire(ctx, a as OrdnanceAction);
      else next?.(ctx, a, d);
    });
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
        // Nationality picks red only for a MA or Gun; an Infantry MG uses the black numbers (SK4 3.2.4; ASLRB A9.61).
        if (isMgOrdnance(sc.def)) return false;
        const year = scenarioYear(env);
        // U.S.-built ordnance used by another nationality (the "(a)" in its name) is red before 1944 and black after
        // (ASLRB A25.32), shown as "Red TH#s (Pre44)" on its counter back (SK3 Russian Vehicle Note 50).
        const v = statics(env).counters[sc.def.id];
        if (v?.kind === 'vehicle' && v.redThBefore !== undefined) return year !== undefined && year < v.redThBefore;
        const nat = sc.def.nationality;
        if (['ru', 'it', 'al', 'ax'].includes(nat)) return true;
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
      (sc, env) => `+${caDrm(env, sc.hex, sc.def.mount, sc.spines, !!sc.def.vehicle)} Covered Arc change (${sc.spines} hexspine${sc.spines === 1 ? '' : 's'}, ${mountLabel(sc.def.mount)}${caDoubled(env, sc.hex, !!sc.def.vehicle) ? `, ×2 in ${closeName(env, sc.hex)}` : ''})`,
      (sc) => sc.spines > 0,
      (sc, env) => caDrm(env, sc.hex, sc.def.mount, sc.spines, !!sc.def.vehicle),
    );
    th('smoke', 'case 7', '-2 Smoke at under 13 hexes', (sc) => isSmokeAmmo(sc.ammo) && sc.range < 13, () => -2);
    th('apcr-range', 'case 11', (sc) => `+1 ${AMMO_NAME[sc.ammo]} at 13 hexes or more`, (sc) => (sc.ammo === 'APCR' || sc.ammo === 'APDS') && sc.range >= 13, () => 1);
    th('intensive', 'case 9', '+2 Intensive Fire', (sc) => !!sc.shot.intensive, () => 2);
    th('backblast', 'SK4 4.4.3', '+2 firing from a building (no Backblast)', (sc, env) => !sc.shot.backblast && shotBackblast(env, sc) === 'choice', () => 2);
    th('tem', 'case 17', (sc, env) => `+${env.query('hex.tem', { hex: sc.target }, 0)} TEM (${terrainOf(env, sc.target).name})`, (sc, env) => temOnToHit(sc) && env.query('hex.tem', { hex: sc.target }, 0) !== 0 && !onWoodsRoad(env, woodsRoadMover(env, sc), [sc.loc ?? sc.hex], sc.target, !!sc.losBlind), (sc, env) => env.query('hex.tem', { hex: sc.target }, 0));
    th('emplacement', 'SK4 6.3', (sc, env) => `+${emplacementThDrm(env, sc.target, sc.side)} Emplacement TEM`, (sc, env) => sc.shot.targetType === 'ITT' && emplacementThDrm(env, sc.target, sc.side) > 0, (sc, env) => emplacementThDrm(env, sc.target, sc.side));
    th('hindrance', 'case 18', (sc) => `+${sc.hindrance} LOS Hindrance`, (sc) => sc.hindrance > 0, (sc) => sc.hindrance);
    th('ffnam', 'case 19', '-1 FFNAM', (sc) => !!sc.movingInfo && !sc.movingInfo.assault && !sc.movingInfo.pinned && !hazardousMover(sc), () => -1);
    th('ffmo', 'case 19', '-1 FFMO', (sc, env) => !!sc.movingInfo && !sc.movingInfo.pinned && sc.hindrance === 0 && (env.query('hex.openGround', { hex: sc.target }, false) || onRoadInTheOpen(env, sc.movingInfo, [sc.loc ?? sc.hex], sc.target, !!sc.losBlind)) && !hazardousMover(sc), () => -1);
    th('acquired', 'case 20', (sc, env) => `-${acquisition(sc, env)} Acquired Target`, (sc, env) => acquisition(sc, env) > 0, (sc, env) => -acquisition(sc, env));
    th('hazardous', 'case 21', '-2 target using Hazardous Movement', (sc) => hazardousMover(sc), () => -2);
    th('targetSize', 'case 22', (sc, env) => `${targetSizeDrm(sc, env) > 0 ? '+' : ''}${targetSizeDrm(sc, env)} target size`, (sc, env) => targetSizeDrm(sc, env) !== 0, targetSizeDrm);

    function afphDrm(sc: ShotCtx, env: QueryEnv): number {
      return woodsBuildingOrRubble(env, sc.hex) ? 3 : 2;
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
            if (to && gh && hasLos(ctx, gh, to)) {
              // An acquired stack that scatters into different hexes keeps one counter, on the target of the firer's
              // choice (SK4 6.10; ASLRB C6.5): while some acquired units are still elsewhere the counter stays put, and
              // the firer is asked once the move is done (below). A stack moving together is apart only for a moment
              // (each unit's move is its own event), and the counter goes with the last of them.
              const elsewhere = a.units.some((u) => u !== p.id && ctx.state.pieces[u] && hexOf(ctx.state, ctx.state.pieces[u]!) !== to);
              setTags(ctx, g.id, { [T2.acqHex]: elsewhere ? a.hex : to });
            } else setTags(ctx, g.id, { [T2.acqUnits]: a.units.filter((u) => u !== p.id).join(',') });
          } else if (a.type === 'ITT' && a.units.length === 0 && to === a.hex && p.side !== g.side && isPersonnelDef(defOf(ctx, p))) {
            setTags(ctx, g.id, { [T2.acqUnits]: p.id });
          }
        }
      },
    });
    // The firer is asked which hex keeps a scattered acquisition as soon as the move that scattered it is done, before
    // anything else that follows it (Defensive First Fire, the mover's next order): on top of the next decision pushed.
    r.on<{ decision: { kind: string } }>({
      id: 'sk2.ordnance.acq.ask',
      event: 'decision.pushed',
      handler(ctx, ev) {
        if (ev.payload.decision.kind === ACQ_CHOICE_DECISION) return;
        for (const g of gunsWithAcquisition(ctx).filter((x) => acqCandidates(ctx, x).length > 1)) {
          const asked = ctx.state.decisions.find((d) => d.kind === ACQ_CHOICE_DECISION && d.data?.['gun'] === g.id);
          if (asked) ctx.popDecision(asked.id);
          ctx.pushDecision({ kind: ACQ_CHOICE_DECISION, owner: g.side, deadlineClass: 'turn', data: { gun: g.id } });
        }
      },
    });
    // The firer's choice of the hex that keeps a scattered acquisition (SK4 6.10).
    r.event<{ weapon: PieceId; hex: HexId; units: PieceId[] }>({ type: 'sk2.acq.kept', apply() {} });
    r.action<AcqChooseAction>({
      type: 'acq.choose',
      decisionKinds: [ACQ_CHOICE_DECISION],
      legal(env, d) {
        const g = env.state.pieces[d.data?.['gun'] as PieceId];
        return g ? acqCandidates(env, g).map((hex) => ({ type: 'acq.choose' as const, gun: g.id, hex })) : [];
      },
      validate(env, a, d) {
        if (a.gun !== d.data?.['gun']) return 'Not the Gun asked about';
        const g = env.state.pieces[a.gun];
        if (!g) return null;
        const a0 = acquisitionOf(g);
        // Nothing left to choose (they came together again, or one side of the split is gone): the counter stays.
        if (acqCandidates(env, g).length < 2) return a0 === null || a.hex === a0.hex ? null : 'The acquisition is no longer split';
        return acqCandidates(env, g).includes(a.hex) ? null : 'None of the acquired units is in that hex';
      },
      resolve(ctx, a, d) {
        ctx.popDecision(d.id);
        const g = ctx.state.pieces[a.gun];
        const acq = g && acquisitionOf(g);
        if (!g || !acq || acqCandidates(ctx, g).length < 2) return;
        const units = acq.units.filter((u) => ctx.state.pieces[u] && hexOf(ctx.state, ctx.state.pieces[u]!) === a.hex);
        setTags(ctx, g.id, { [T2.acqHex]: a.hex, [T2.acqUnits]: units.join(',') });
        ctx.emit('sk2.acq.kept', { weapon: g.id, hex: a.hex, units });
      },
    });
    r.autoResolver({
      id: 'sk2.acq.choice.auto',
      decisionKind: ACQ_CHOICE_DECISION,
      resolve(env, d, reason) {
        const g = env.state.pieces[d.data?.['gun'] as PieceId];
        const a = g && acquisitionOf(g);
        // Moot: the Gun or its acquisition is gone, or the units are together again (or a shot chose for him).
        if (!g || !a || acqCandidates(env, g).length < 2) return { type: 'acq.choose', gun: d.data?.['gun'], hex: a?.hex ?? '' };
        // Time ran out: the counter stays where it was if any acquired unit is still there.
        if (reason === 'timeout') {
          const c = acqCandidates(env, g);
          return { type: 'acq.choose', gun: g.id, hex: c.includes(a.hex) ? a.hex : c[0]! };
        }
        return null;
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
      resolve(ctx, a, d) {
        if (!ctx.proc<OrdnancePauseFn>(OP.pause)(ctx, a, d)) resolveFire(ctx, a);
      },
    });
    function resolveFire(ctx: Ctx, a: OrdnanceAction) {
      ctx.proc<OrdnanceFireFn>(OP.fire)(ctx, a.shot, PHASE_FIRE_MODE[ctx.state.phase]!);
      if (!ctx.state.result) {
        ctx.popDecision();
        askPhaseOwner(ctx, phaseOwner(ctx));
      }
    }

    r.action<OrdnanceAction>({
      type: 'defFire.ordnance',
      decisionKinds: [FIRST_FIRE],
      legal(env) {
        const ms = moveState(env);
        if (!ms || !ms.hex) return [];
        const side = otherSide(env.state, env.state.attacker);
        const out: OrdnanceAction[] = [];
        // The moving stack, and (full ASL) units it left in Bypass of another hex (ASLRB A4.32, A4.33).
        for (const target of firstFireLocations(env, ms)) {
          const view = firstFireView(env, ms, target)!;
          for (const shot of simpleShots(env, side, [target], 'first', firstFireTargets(env, view))) {
            if (!defShotIllegal(env, shot, side)) out.push({ type: 'defFire.ordnance', shot } as OrdnanceAction);
          }
        }
        return out;
      },
      validate(env, a) {
        const ms = moveState(env);
        if (!ms || !ms.hex) return 'Nothing is moving';
        if (!firstFireView(env, ms, a.shot.target)) return 'Defensive First Fire must target the moving stack';
        return defShotIllegal(env, a.shot, a.side);
      },
      resolve(ctx, a, d) {
        if (!ctx.proc<OrdnancePauseFn>(OP.pause)(ctx, a, d)) resolveDefFire(ctx, a);
      },
    });
    function resolveDefFire(ctx: Ctx, a: OrdnanceAction) {
      const ms = moveState(ctx)!;
      const view = firstFireView(ctx, ms, a.shot.target) ?? ms;
      const mode = gunFirstFireMode(ctx, a.shot);
      const targets = firstFireTargets(ctx, view);
      const out = ctx.proc<OrdnanceFireFn>(OP.fire)(ctx, a.shot, mode, { moving: targets, movingInfo: movingInfo(ctx, view) });
      const g = ctx.state.pieces[a.shot.weapon];
      const firer = g && g.loc.kind === 'held' ? g.loc.by : a.shot.weapon;
      recordRofChoice(ctx, a.shot.target, [a.shot.weapon], out.rofResidual !== undefined ? [{ sws: [a.shot.weapon], residual: out.rofResidual }] : undefined);
      // A Gun that never had the Special Ammo has not fired (SK4 6.2), so the shot does not count
      // against this location: it may fire again here with other ammo.
      finishDefensiveFire(ctx, out.noAmmo ? [] : [a.shot.weapon, firer, ...(a.shot.director !== undefined ? [a.shot.director] : [])], view === ms ? undefined : a.shot.target);
    }

    function defShotIllegal(env: QueryEnv, shot: OrdnanceShot, side: SideId): string | null {
      const moving = moveState(env);
      if (!moving || !moving.hex) return 'Nothing is moving';
      // At units left in Bypass of another hex: that Location's MF and First Fire counts (ASLRB A4.32, A4.33).
      const ms = firstFireView(env, moving, shot.target) ?? moving;
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
