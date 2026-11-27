import type { Ctx, HexId, Piece, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { byId, hexOf, isVehicleDef, defOf, otherSide, statics, swHeldBy } from '../common/pieces';
import type { IftResult } from '../common/statics';
import { hexOfLoc, locOf } from '../common/location';
import { FP, attackFp, iftColumn, type ApplyResultFn, type FireAttackCtx, type FireMode } from '../sk1/fire';
import { hasLos } from '../sk1/known';
import { moveState } from '../sk1/movement';
import { fireMarker, inMelee, pieceOf, setTags } from '../sk1/status';
import { terrainOf } from '../sk1/terrain';
import { woodsBuildingOrRubble, type OrdnanceShot, type ShotCtx } from '../sk2/ordnance';
import { BOW_TURN, T3, crewCanAct, firedThisPhase, inMotion, isCe, isMovingTarget, isWreck, stunWord, vehicle } from './status';
import { T } from '../sk1/status';
import { applyVehicleEffect, crewTakesResult } from './vehicleStatus';
import { closeTerrain, hullTurnRefusal, turnRiskingBog } from './vehicleMove';
import { T2, caTurnedIllegal } from '../sk2/status';
import { hitLocation } from './facing';
import { installVehicleFacing } from './vehicleFacing';
import { confiningEnemies } from './vehicleCc';
import { hexName } from '../labels';

declare module '@asl/engine' {
  interface QueryCatalog {
    /**
     * The parts of an IFT attack a Buttoned Up Open-Topped crew is vulnerable to (SK4 7.13 "fire from its own hex"): by
     * default all of them when every part fires from its hex, else none; full ASL takes the parts that do (A7.211).
     */
    'fire.otExposedParts': { ctx: { attack: FireAttackCtx; unit: PieceId }; value: PieceId[] };
    /**
     * Where an Area Target Type hit strikes a vehicle (the turret when the colored dr of the Original To Hit DR is less than
     * the white dr, SK4 7.11), and why the hit does not count against it at all (full ASL: a hull hit on a Hull Down target,
     * D4.2), or none.
     */
    'vehicle.areaHit': { ctx: { attack: FireAttackCtx; vehicle: PieceId }; value: { location: 'hull' | 'turret'; spared?: string } };
  }
}

/** The parts (their pieces) of `attack` a BU Open-Topped AFV's crew is vulnerable to (SK4 7.13; ASLRB A7.211). */
export function otExposedParts(env: QueryEnv, attack: FireAttackCtx, unit: PieceId): PieceId[] {
  const p = pieceOf(env, unit);
  if (isCe(p) || !vehicle(env, p)?.openTopped || attack.parts.length === 0) return [];
  const all = attack.parts.every((part) => part.dist === 0) ? attack.parts.map((part) => part.piece) : [];
  return env.query('fire.otExposedParts', { attack, unit }, all);
}

/** A Buttoned Up Open-Topped AFV fired on from its own hex: its crew is still vulnerable (SK4 7.13; ASLRB A7.211). */
const otOwnHex = (env: QueryEnv, attack: FireAttackCtx, unit: PieceId) => otExposedParts(env, attack, unit).length > 0;

/** Whether an IFT attack on a vehicle's crew takes the CE DRM (SK4 7.7, 7.13): CE, or BU Open-Topped fired on from its own hex, not vs the ATT, never on top of a positive hex TEM (a Snap Shot ignores that TEM, ASLRB A8.15; so does fire at a unit in Bypass, B23.31, when `noHexTem`). */
export const ceDrmApplies = (env: QueryEnv, attack: FireAttackCtx, unit: PieceId, noHexTem = false): boolean =>
  !!vehicle(env, pieceOf(env, unit)) && (isCe(pieceOf(env, unit)) || otOwnHex(env, attack, unit)) && attack.ordnance?.targetType !== 'ATT' && (noHexTem || !!attack.snap || env.query('hex.tem', { hex: attack.target }, 0) <= 0);

/*
 * Fire by and at vehicles (SK4 3.2.4, 7.2, 7.7, 7.11, 7.12; To Hit cases 10, 13, 15, 22, 24, 25).
 * A vehicle's Main Armament fires through the SK2 ordnance module as a Gun whose "manning unit" is
 * the vehicle itself; this module says when it may, adds the vehicle To Hit cases, and decides what
 * IFT fire does to a vehicle: nothing to a Buttoned Up AFV, a crew check to a Crew Exposed one, and
 * the Area Target Type's Shock/Immobilization/destruction.
 */

/** MP a vehicle has spent in the LOS of `firerHex` this move: its current trail, or the one its last move left (SK4 case 24). */
export function mpInLosOf(env: QueryEnv, v: Piece, firerHex: HexId, blind = false): number {
  const ms = moveState(env);
  const trail: { hex: HexId; mp: number }[] = ms && ms.units[0] === v.id ? (ms.trail ?? []) : JSON.parse((v.tags[T3.mpTrail] as string | undefined) ?? '[]');
  // A preview before the shot is declared may not trace the LOS (ASLRB A6.11): it counts every MP spent on the map.
  return trail.filter((t) => statics(env).map.hex(t.hex) && (blind || hasLos(env, firerHex, t.hex))).reduce((n, t) => n + t.mp, 0);
}

/**
 * Why a turreted vehicle's MA may not fire in this phase because its turret Rear MG fired in it (ASLRB D1.82; see
 * `FIRED_PHASE` in sk3/status), or null. Target-independent: the wheel greys the MA's entry with it.
 */
export function maRmgRefusal(env: QueryEnv, vehicleId: PieceId): string | null {
  const p = env.state.pieces[vehicleId];
  const d = p && vehicle(env, p);
  return d && d.turret !== 'NT' && firedThisPhase(env, p, 'rmg') ? 'The turret Rear MG fired this phase: the Main Armament may not fire in the same phase (ASLRB D1.82)' : null;
}

/** Why a vehicle's Main Armament may not fire now (SK4 7.2, 7.10, 3.2.5, 3.5), or null. */
export function maIllegal(env: QueryEnv, shot: OrdnanceShot, mode: FireMode): string | null {
  const p = env.state.pieces[shot.weapon];
  const d = p && vehicle(env, p);
  if (!p || !d || !d.ma) return 'The vehicle has no Main Armament';
  if (isWreck(p)) return 'A wreck does not fire';
  if (p.tags[T3.maDisabled]) return 'The Main Armament is disabled';
  if (!crewCanAct(p)) return p.tags[T3.shock] ? 'A Shocked crew cannot fire' : `A ${stunWord(p, 'Stunned')} crew cannot fire this Player Turn`;
  if (isCe(p) && (d.turret === 'RST' || d.turret === '1MT')) return 'A Restricted Slow Traverse or One Man Turret cannot fire its MA while Crew Exposed: Button Up first';
  if (mode === 'prep' && inMotion(p)) return 'A vehicle in Motion may not Prep Fire: it must move first';
  // Turned without MP at the end of this phase (SK4 3.3.2): it fires no more in it.
  const turned = caTurnedIllegal(env, p);
  if (turned) return turned;
  const rmg = maRmgRefusal(env, p.id);
  if (rmg) return rmg;
  // An NT vehicle's MA turns its hull to fire outside the CA, so the hull must be free to turn: not Immobilized, Bogged or
  // dug in (SK4 glossary "Immobilized: ... may not change hexes, turn its VCA, or start"; 7.6).
  if (shot.ca !== undefined && d.turret === 'NT' && shot.ca !== (p.tags[T2.ca] as number | undefined)) {
    const never = hullTurnRefusal(env, p);
    if (never) return never;
  }
  // With an enemy unit in its Location (or in Melee) the vehicle fires into that Location only (SK4 3.2.2.1, 3.8;
  // ASLRB A7.212).
  const at = locOf(env.state, p);
  if (at && shot.target !== at && (inMelee(env, at) || confiningEnemies(env, at, otherSide(env.state, p.side)).length > 0)) return 'An enemy unit is in its hex: the Main Armament may only fire at that hex';
  if (mode === 'advancing' && p.tags[T3.bff] && !p.tags[T3.bffRof]) return 'The vehicle fired Bounding First Fire this MPh (and lost ROF or fired another weapon)';
  // A vehicle fires in both the MPh and the AFPh only if it fired just its MA in the MPh and kept ROF (SK4 3.3.2.2): MGs
  // that fired first and an MA that kept ROF after them do not qualify.
  if (mode === 'advancing' && p.tags[T3.bff] && swHeldBy(env.state, p.id).some((w) => fireMarker(w) === 'bff')) return 'The vehicle fired its MGs as Bounding First Fire this MPh: no Advancing Fire';
  // Same fire phase as its MGs, MPh and DFPh counting as one (7.8).
  const mgClass = swHeldBy(env.state, p.id).map((w) => fireMarker(w)).filter(Boolean).map((m) => (m === 'prep' ? 'PFPh' : m === 'adv' ? 'AFPh' : 'DF'))[0];
  const myClass = mode === 'prep' ? 'PFPh' : mode === 'advancing' ? 'AFPh' : 'DF';
  if (mgClass && mgClass !== myClass) return 'The Main Armament fires in the same fire phase as the vehicle\'s MGs';
  if (mode === 'bounding') return maBffRefusal(env, p.id);
  return null;
}

/**
 * Why the moving vehicle's MA may not fire Bounding First Fire now, whatever the target (SK4 3.3.2.2), or null: the
 * checks that rest on its move so far. The wheel greys its MA entry with this.
 */
export function maBffRefusal(env: QueryEnv, vehicleId: PieceId): string | null {
  const p = pieceOf(env, vehicleId);
  const ms = moveState(env);
  if (!ms?.vehicle || ms.units[0] !== p.id) return 'Bounding First Fire is for the vehicle that is moving';
  if (!ms.vehicle.started && !ms.vehicle.stopped) return 'Start the vehicle first';
  // With ROF kept the MA carries no fire marker yet: `maBff` says the MA has fired this MPh. The vehicle's BFF tag
  // alone is not enough: its MGs firing first set it too, and the MA may still fire after them (SK4 3.3.2.2).
  if (ms.vehicle.maBff && !p.tags[T3.bffRof]) return 'The MA fired Bounding First Fire and lost ROF';
  if (ms.vehicle.maBff && ms.vehicle.sinceBff === 0) return 'Spend another MP before firing again';
  // Its MGs fired first: the first MA shot is from their hex, as "all other Weapons must be fired from the same hex as
  // the first MA shot" (SK4 3.3.2.2). After it, an MA that kept ROF may fire again from another hex (ASLRB D3.3, C2.24).
  if (!ms.vehicle.maBff && ms.vehicle.bffFrom && ms.hex !== ms.vehicle.bffFrom) return `Its MGs fired from ${hexName(env, ms.vehicle.bffFrom)}: in its MPh a vehicle fires every weapon from the hex of its first MA shot`;
  return null;
}

/** Case 14: the Bounding (First) Fire DRM by turret type and the MP spent in the target's LOS; a Motion firer counts as ≤ 2 MP. */
export function boundingDrm(sc: ShotCtx, env: QueryEnv): number {
  const f = firerVehicleOf(sc, env);
  if (!f) return 0;
  const d = vehicle(env, f)!;
  const nt = d.turret === 'NT' ? 1 : 0;
  const bff = sc.mode === 'bounding' || (sc.mode === 'advancing' && !!f.tags[T.moved]) || inMotion(f);
  if (!bff) return 0;
  // The MP rows are Bounding First Fire's; Bounding Fire in the AFPh and a Motion vehicle's fire in any
  // other phase (case 16 "add case 14") take the first row (reading of the chart's "In AFPh or BFF > 3 MP").
  const mp = sc.mode === 'bounding' ? mpInLosOf(env, f, sc.target, !!sc.losBlind) : 99;
  return (mp > 3 ? 4 : mp >= 2.5 ? 5 : 6) + nt;
}

const targetVehicleOf = (sc: ShotCtx, env: QueryEnv): Piece | null => (sc.targetVehicle ? (env.state.pieces[sc.targetVehicle] ?? null) : null);
const firerVehicleOf = (sc: ShotCtx, env: QueryEnv): Piece | null => (sc.firerVehicle ? (env.state.pieces[sc.firerVehicle] ?? null) : null);

const DEFENSIVE_FIRST_FIRE: FireMode[] = ['first', 'subsequentFirst', 'fpf'];

/**
 * The MP a moving vehicle has just spent in the firer's continuous LOS, for Restricted (≤ 3) and Limited (≤ 1) Aim, or
 * null when neither may apply: only Defensive First Fire takes them (ASLRB C6.11, C6.12), and only for MP spent since
 * the vehicle's last hex out of that LOS; one that began its MPh in view and has not left it is spared (C6.15). The
 * vehicle now moving reads its move; a pose (`mpTrail`, the computer opponent's estimates) its trail alone. A preview
 * before the shot (`blind`) may not trace the LOS (ASLRB A6.11): it counts every MP spent on the map, as if the vehicle
 * had come from out of view, and the shot itself settles the rest.
 */
function continuousMpInLos(env: QueryEnv, sc: ShotCtx, v: Piece): number | null {
  if (!DEFENSIVE_FIRST_FIRE.includes(sc.mode)) return null;
  const ms = moveState(env);
  const moving = !!ms && ms.units[0] === v.id;
  const trail: { hex: HexId; mp: number }[] = moving ? (ms.trail ?? []) : JSON.parse((v.tags[T3.mpTrail] as string | undefined) ?? '[]');
  const seen = (hex: HexId) => !!statics(env).map.hex(hex) && (!!sc.losBlind || hasLos(env, sc.hex, hex));
  const origin = moving && !sc.losBlind ? ms.vehicle?.origin : undefined;
  let mp: number | null = origin && seen(origin) ? null : 0;
  for (const t of trail) {
    if (!seen(t.hex)) mp = 0;
    else if (mp !== null) mp += t.mp;
  }
  return mp;
}

/**
 * Case 24 vs a Motion or moving vehicle (ASLRB C6.1 Case J): +2, or in Defensive First Fire +3 at ≤ 3 MP spent in the
 * firer's continuous LOS and +4 at ≤ 1 (C6.11 J1, C6.12 J2; a Motion vehicle on the move included).
 */
function movingTargetDrm(sc: ShotCtx, env: QueryEnv): number {
  const t = targetVehicleOf(sc, env);
  if (!t || isWreck(t) || (!inMotion(t) && !isMovingTarget(t))) return 0;
  const mp = continuousMpInLos(env, sc, t);
  return mp === null ? 2 : mp <= 1 ? 4 : mp <= 3 ? 3 : 2;
}
/** Case 22 for a vehicle target: its printed size. */
function vehicleSizeDrm(sc: ShotCtx, env: QueryEnv): number {
  const t = targetVehicleOf(sc, env);
  const d = t && vehicle(env, t);
  if (!d) return 0;
  return d.targetSize === 'veryLarge' ? -2 : d.targetSize === 'large' ? -1 : d.targetSize === 'small' ? 1 : d.targetSize === 'verySmall' ? 2 : 0;
}
/** A "stopped" vehicle for case 25: neither in Motion nor still moving unstopped. */
function targetStopped(sc: ShotCtx, env: QueryEnv): boolean {
  const t = targetVehicleOf(sc, env);
  if (!t || inMotion(t)) return false;
  const ms = moveState(env);
  if (ms?.vehicle && ms.units[0] === t.id && !ms.vehicle.stopped) return false;
  return true;
}
/** The firer is a vehicle in Motion or moving without having stopped (cases 16 and 25). */
export function firerNonStopped(sc: ShotCtx, env: QueryEnv): boolean {
  const f = firerVehicleOf(sc, env);
  if (!f) return false;
  if (inMotion(f)) return true;
  const ms = moveState(env);
  return !!ms?.vehicle && ms.units[0] === f.id && !ms.vehicle.stopped;
}

/** The attack's firing vehicle is in Motion or moving unstopped (for MG fire in the MPh). */
export function firerNonStoppedVehicle(env: QueryEnv, attack: FireAttackCtx): boolean {
  const holders = new Set(attack.parts.map((p) => env.state.pieces[p.piece]).filter((p): p is Piece => !!p && p.loc.kind === 'held').map((p) => (p.loc as { by: PieceId }).by));
  for (const h of holders) {
    const v = env.state.pieces[h];
    if (!v || !vehicle(env, v)) continue;
    if (inMotion(v)) return true;
    const ms = moveState(env);
    if (ms?.vehicle && ms.units[0] === v.id && !ms.vehicle.stopped) return true;
  }
  return false;
}

/** Vehicles among an attack's targets (hull or crew), by id. */
const vehicleTargets = (env: QueryEnv, attack: FireAttackCtx): Piece[] => attack.targets.map((u) => env.state.pieces[u]).filter((p): p is Piece => !!p && isVehicleDef(defOf(env, p)) && !isWreck(p)).sort(byId);

export const vehicleFireModule: RuleModule = {
  id: 'sk3.vehicleFire',
  ref: 'SK4 3.2.2.1, 3.2.4, 6.10, 7.2, 7.7, 7.11, 7.12',
  summary: 'Main Armament fire, the vehicle To Hit cases, and IFT fire against vehicles and their crews.',
  requires: ['sk2.ordnance', 'sk3.vehicleStatus'],
  install(r) {
    // The end-of-phase turn without MP (SK4 3.3.2) lives here so the module list, and so the ruleset hash, stays as it was.
    installVehicleFacing(r);
    r.event<{ vehicle: PieceId; column: number; dr: [number, number]; drm: number; location: 'hull' | 'turret'; result: IftResult; effect: 'kill' | 'shock' | 'immobilized' | 'none'; spared?: string }>({ type: 'sk3.areaHit', apply() {} });
    // IFT fire does nothing to a Buttoned Up AFV (SK4 3.2.3, 7.7) unless its Open-Topped crew is fired on from its own hex (7.13).
    r.contribute({
      id: 'sk3.fire.immune.bu',
      query: 'fire.immune',
      ref: 'SK4 3.2.3, 7.7',
      apply: (v, { attack, unit }, env) => {
        const p = env.state.pieces[unit];
        const d = p && vehicle(env, p);
        return v || (!!d && !d.unarmored && !isCe(p) && otExposedParts(env, attack, unit).length === 0);
      },
    });

    // An Infantry Target Type hit "cannot affect an AFV, only its CE crew" (SK4 7.12; 3.2.4 "All enemy targets except for BU
    // AFV ... including any Crew Exposed (7.7) units"): the crew of a CE AFV, or of a BU Open-Topped one fired on from its own
    // hex (7.13), is attacked with the other units hit, with its CE DRM (applyResult below; ASLRB C3.32, D.8B).
    r.contribute({
      id: 'sk3.ordnance.ittCrew',
      query: 'ordnance.ittCrew',
      ref: 'SK4 3.2.4, 7.12, 7.13',
      apply: (v, { vehicle: id, target, from }, env) => {
        const p = env.state.pieces[id];
        const d = p && vehicle(env, p);
        if (v || !p || !d || isWreck(p)) return v;
        return isCe(p) || (!!d.openTopped && from !== undefined && hexOfLoc(from) === hexOfLoc(target));
      },
    });

    // ---------------------------------------------------------------- the Main Armament
    r.contribute({ id: 'sk3.ordnance.maIllegal.base', query: 'ordnance.maIllegal', layer: 0, apply: (v, { shot, mode }, env) => v ?? maIllegal(env, shot, mode) });
    // The Infantry Target Type is for Infantry and Guns: a hex holding nothing but enemy vehicles takes the Vehicle (or Area) Target Type (SK4 3.2.4).
    r.contribute({
      id: 'sk3.ordnance.illegal.ittVsVehicle',
      query: 'ordnance.illegal',
      ref: 'SK4 3.2.4',
      apply(v, { shot, side }, env) {
        if (v !== null || shot.targetType !== 'ITT') return v;
        const enemy = Object.values(env.state.pieces).filter((p) => p.side !== side && p.loc.kind === 'hex' && p.loc.hex === shot.target);
        if (enemy.length === 0 || !enemy.every((p) => isVehicleDef(defOf(env, p)))) return v;
        return 'Only vehicles are in the target hex: use the Vehicle Target Type (or the Area Target Type)';
      },
    });
    // The MA's breakdown number: its printed B# (12 when none), one less under Low Ammo (SK4 7.2.1).
    r.contribute({
      id: 'sk3.sw.breakdown.ma',
      query: 'sw.breakdown',
      layer: 5,
      when: ({ sw: id }, env) => !!vehicle(env, pieceOf(env, id)),
      apply: (_v, { sw: id }, env) => {
        const p = pieceOf(env, id);
        const b = vehicle(env, p)!.ma?.b ?? 12;
        return p.tags[T3.lowAmmo] ? b - 1 : b;
      },
    });
    // No acquisition for Bounding First Fire or a Motion firer (SK4 6.10).
    r.contribute({
      id: 'sk3.ordnance.acquires.vehicle',
      query: 'ordnance.acquires',
      when: (sc, env) => !!firerVehicleOf(sc, env) && (inMotion(firerVehicleOf(sc, env)!) || sc.mode === 'bounding'),
      apply: () => false,
    });

    // ---------------------------------------------------------------- To Hit cases
    const th = (id: string, ref: string, label: string | ((sc: ShotCtx, env: QueryEnv) => string), when: (sc: ShotCtx, env: QueryEnv) => boolean, drm: (sc: ShotCtx, env: QueryEnv) => number) =>
      r.contribute({ id: `sk3.th.${id}`, query: 'ordnance.thDrm', ref, label, when, apply: (v, sc, env) => v + drm(sc, env) });
    th('withinHex', 'case 10', (sc, env) => `+${woodsBuildingOrRubble(env, sc.hex) ? 4 : 2} fire within the hex`, (sc) => sc.range === 0, (sc, env) => (woodsBuildingOrRubble(env, sc.hex) ? 4 : 2));
    th('bu', 'case 13', '+1 Buttoned Up', (sc, env) => !!firerVehicleOf(sc, env) && !isCe(firerVehicleOf(sc, env)!), () => 1);
    th('stun', 'case 15', (sc, env) => `+1 ${stunWord(firerVehicleOf(sc, env)!, 'Stun')}`, (sc, env) => firerVehicleOf(sc, env)?.tags[T3.stun] === 'plus1', () => 1);
    th('bounding', 'case 14', (sc, env) => `+${boundingDrm(sc, env)} Bounding ${sc.mode === 'bounding' ? 'First ' : ''}Fire (${vehicle(env, firerVehicleOf(sc, env)!)!.turret === 'NT' ? 'NT' : 'turret'}${sc.mode === 'bounding' ? (sc.losBlind ? `, ${mpInLosOf(env, firerVehicleOf(sc, env)!, sc.target, true)} MP spent; those in the target's LOS count when you fire` : `, ${mpInLosOf(env, firerVehicleOf(sc, env)!, sc.target)} MP in the target's LOS`) : ''})`, (sc, env) => boundingDrm(sc, env) > 0, boundingDrm);
    // Case 8 never applies to Bounding First Fire (SK4 3.3.2.2).
    r.suppress<'ordnance.thDrm'>({ id: 'sk3.th.suppress.ca-bff', query: 'ordnance.thDrm', target: 'sk2.th.caChange', when: (sc) => sc.mode === 'bounding' });
    // Case 16: Motion/Non-Stopped fire adds the lower die again, and +2/+1 on the ITT at 1/2 hexes.
    th('motionFire', 'case 16', (sc) => `+${sc.range === 1 ? 2 : 1} Non-Stopped fire on the Infantry Target Type at ${sc.range} hex${sc.range === 1 ? '' : 'es'}`, (sc, env) => sc.shot.targetType === 'ITT' && (sc.range === 1 || sc.range === 2) && firerNonStopped(sc, env), (sc) => (sc.range === 1 ? 2 : 1));
    r.contribute({
      id: 'sk3.th.extra.lower-die',
      query: 'ordnance.thExtra',
      ref: 'case 16',
      when: ({ sc }, env) => firerNonStopped(sc, env),
      apply: (v, { dice }) => v + Math.min(dice[0], dice[1]),
    });
    th('vehicleSize', 'case 22', (sc, env) => `${vehicleSizeDrm(sc, env) > 0 ? '+' : ''}${vehicleSizeDrm(sc, env)} vehicle target size`, (sc, env) => sc.shot.targetType === 'VTT' && vehicleSizeDrm(sc, env) !== 0, vehicleSizeDrm);
    r.suppress<'ordnance.thDrm'>({ id: 'sk3.th.suppress.gun-size-on-vtt', query: 'ordnance.thDrm', target: 'sk2.th.targetSize', when: (sc) => sc.shot.targetType === 'VTT' });
    th(
      'movingVehicle',
      'case 24',
      (sc, env) => {
        const t = targetVehicleOf(sc, env)!;
        const mp = continuousMpInLos(env, sc, t);
        if (mp === null) return inMotion(t) ? '+2 target in Motion' : '+2 moving vehicle';
        return sc.losBlind ? `+${movingTargetDrm(sc, env)} moving vehicle (${mp} MP spent; those in your LOS count when you fire)` : `+${movingTargetDrm(sc, env)} moving vehicle (${mp} MP in your LOS)`;
      },
      (sc, env) => sc.shot.targetType === 'VTT' && movingTargetDrm(sc, env) > 0,
      movingTargetDrm,
    );
    th('pointBlank', 'case 25', (sc) => `${sc.range === 1 ? '-2' : '-1'} ${sc.range}-hex range vs a stopped vehicle`, (sc, env) => sc.shot.targetType === 'VTT' && (sc.range === 1 || sc.range === 2) && targetStopped(sc, env) && !firerNonStopped(sc, env) && !(sc.def.latw && sc.def.type !== 'ATR'), (sc) => (sc.range === 1 ? -2 : -1));
    // FFNAM/FFMO never apply against a moving vehicle (they are Infantry DRM): the SK2 cases read `movingInfo`, which marks a vehicle.
    r.suppress<'ordnance.thDrm'>({ id: 'sk3.th.suppress.ffnam-vehicle', query: 'ordnance.thDrm', target: 'sk2.th.ffnam', when: (sc) => !!sc.movingInfo?.vehicle });
    r.suppress<'ordnance.thDrm'>({ id: 'sk3.th.suppress.ffmo-vehicle', query: 'ordnance.thDrm', target: 'sk2.th.ffmo', when: (sc) => !!sc.movingInfo?.vehicle });

    // ---------------------------------------------------------------- IFT fire at vehicles
    // A Crew Exposed crew is protected by +2 (SK4 7.7), never on top of other positive TEM.
    r.contribute({
      id: 'sk3.drm.ce',
      query: 'fire.unitDrm',
      ref: 'SK4 7.7',
      label: ({ unit }, env) => `+${vehicle(env, pieceOf(env, unit))!.ceDrm} Crew Exposed`,
      // A Buttoned Up Open-Topped crew fired on from its own hex is vulnerable with the same DRM (SK4 7.13 "normal CE DRM
      // applies"; ASLRB A7.211). A full ASL Snap Shot ignores the hex's TEM (ASLRB A8.15), so the CE DRM is not on top of it.
      when: ({ unit, attack }, env) => ceDrmApplies(env, attack, unit),
      apply: (v, { unit }, env) => v + vehicle(env, pieceOf(env, unit))!.ceDrm,
    });
    // Area Target Type vs an AFV (7.11): -1 when all its Armor Factors are ≤ 4, +1 when all are ≥ 8.
    r.contribute({
      id: 'sk3.drm.att-armor',
      query: 'fire.unitDrm',
      ref: 'SK4 7.11',
      label: ({ unit }, env) => (attArmorDrm(env, unit) > 0 ? '+1 all Armor Factors ≥ 8' : '-1 all Armor Factors ≤ 4'),
      when: ({ unit, attack }, env) => attack.ordnance?.targetType === 'ATT' && !!vehicle(env, pieceOf(env, unit)) && attArmorDrm(env, unit) !== 0,
      apply: (v, { unit }, env) => v + attArmorDrm(env, unit),
    });
    function attArmorDrm(env: QueryEnv, unit: PieceId): number {
      const d = vehicle(env, pieceOf(env, unit))!;
      const all = [d.af.hull.front, d.af.hull.side, d.af.hull.rear, d.af.turret.front, d.af.turret.side, d.af.turret.rear];
      if (all.every((a) => a <= 4)) return -1;
      if (all.every((a) => a >= 8)) return 1;
      return 0;
    }
    // Vehicles among the targets are the vehicle rules' to resolve; the Infantry go on through SK1/SK2.
    r.procedure<ApplyResultFn>(FP.applyResult, (next) => (ctx, attack, column, baseFinal, out) => {
      const vs = vehicleTargets(ctx, attack);
      if (vs.length === 0) {
        next?.(ctx, attack, column, baseFinal, out);
        return;
      }
      const tables = statics(ctx).tables;
      for (const v of vs) {
        const extra = ctx.explain('fire.unitDrm', { attack, unit: v.id }, 0);
        const final = baseFinal + extra.value;
        if (attack.ordnance?.targetType === 'ATT') {
          // 7.11: a KIA destroys; a K/# or the result one above it Shocks (turret) or Immobilizes (hull); the crew takes the rest.
          const res = tables.ift(column, final);
          out[v.id] = res;
          const [white, colored] = attack.ordnance.thDice ?? [1, 1];
          const aim = ctx.query('vehicle.areaHit', { attack, vehicle: v.id }, { location: hitLocation(white, colored) });
          const location = aim.location;
          if (aim.spared) {
            out[v.id] = { kind: 'none' };
            ctx.emit('sk3.areaHit', { vehicle: v.id, column, dr: [white, colored], drm: extra.value, location, result: { kind: 'none' }, effect: 'none', spared: aim.spared });
            continue;
          }
          const kDr = kResultDr(tables, column);
          const effect = res.kind === 'KIA' ? 'kill' : kDr !== null && final <= kDr + 1 ? (location === 'turret' ? 'shock' : 'immobilized') : 'none';
          ctx.emit('sk3.areaHit', { vehicle: v.id, column, dr: [white, colored], drm: extra.value, location, result: res, effect });
          if (effect === 'kill') applyVehicleEffect(ctx, v.id, 'wreck', 'Area Target Type hit (KIA)');
          else if (effect === 'shock') applyVehicleEffect(ctx, v.id, 'shock', 'Area Target Type turret hit');
          else if (effect === 'immobilized') {
            applyVehicleEffect(ctx, v.id, 'immobilized', 'Area Target Type hull hit');
            crewTakesResult(ctx, v.id, res, 'Area Target Type hit');
          } else crewTakesResult(ctx, v.id, res, 'Area Target Type hit');
          continue;
        }
        // Infantry fire, MG fire and the Infantry Target Type: no effect on a BU AFV; a CE crew takes the result (3.2.3, 7.7).
        // A BU Open-Topped crew is still vulnerable to fire from its own hex (7.13).
        const exposedParts = otExposedParts(ctx, attack, v.id);
        const otExposed = exposedParts.length > 0;
        // Only the FP of the parts it is vulnerable to attacks the BU Open-Topped crew (ASLRB A7.211): the column those
        // parts alone reach, any column shift the attack took (cowering) kept.
        const partial = otExposed && exposedParts.length < attack.parts.length;
        const crewColumn = partial ? partsColumn(ctx, attack, column, exposedParts) : column;
        if ((!isCe(v) && !otExposed) || crewColumn === null) {
          out[v.id] = { kind: 'none' };
          ctx.emit('sk1.fire.result', { unit: v.id, result: { kind: 'none' }, finalDr: final, explain: [{ id: 'sk3.bu', label: crewColumn === null ? 'Buttoned Up: the FP from its own hex is below the first column' : 'Buttoned Up: no effect' }] });
          continue;
        }
        const res = tables.ift(crewColumn, final);
        out[v.id] = res;
        const notes = [...(partial ? [{ id: 'sk3.ot-own-hex', label: `only the FP fired from its own hex (${crewColumn} column)` }] : []), ...extra.trace.filter((t) => !t.suppressedBy && t.label).map((t) => ({ id: t.id, label: t.label! }))];
        ctx.emit('sk1.fire.result', { unit: v.id, result: res, finalDr: final, ...(extra.value || partial ? { drm: extra.value, explain: notes } : {}) });
        crewTakesResult(ctx, v.id, res, otExposed ? 'fire from its own hex on the Open-Topped crew' : 'fire on the CE crew', otExposed);
      }
      const rest = attack.targets.filter((u) => !vs.some((v) => v.id === u));
      if (rest.length) next?.(ctx, { ...attack, targets: rest }, column, baseFinal, out);
    });
    /** The IFT column the `pieces` among an attack's parts reach alone, any column shift the attack took kept. */
    function partsColumn(env: QueryEnv, attack: FireAttackCtx, column: number, pieces: PieceId[]): number | null {
      const cols = statics(env).tables.iftColumns;
      const base = iftColumn(env, attackFp(env, attack));
      const shift = base === null ? 0 : Math.max(0, cols.indexOf(base) - cols.indexOf(column));
      return iftColumn(env, attackFp(env, attack, attack.parts.filter((p) => !pieces.includes(p.piece)).map((p) => p.piece)), shift);
    }
    /** The highest final DR that is still a K (or KIA) result on a column, or null when the column has none. */
    function kResultDr(tables: { ift(column: number, dr: number): IftResult }, column: number): number | null {
      let best: number | null = null;
      for (let dr = -4; dr <= 20; dr++) {
        const k = tables.ift(column, dr).kind;
        if (k === 'K' || k === 'KIA') best = dr;
      }
      return best;
    }

    // ---------------------------------------------------------------- Bounding First Fire bookkeeping
    const bffFired = (ctx: Ctx, weapon: PieceId) => {
      const p = ctx.state.pieces[weapon];
      if (!p || !vehicle(ctx, p)) return;
      setTags(ctx, p.id, { [T3.bff]: true });
      const ms = moveState(ctx);
      if (ms?.vehicle && ms.units[0] === p.id) ctx.emit('sk1.move.state', { state: { ...ms, vehicle: { ...ms.vehicle, sinceBff: 0, bffFrom: ms.vehicle.bffFrom ?? ms.hex ?? undefined, maBff: true } } });
    };
    r.on<{ weapon: PieceId; mode: string; outcome: string }>({
      id: 'sk3.vehicleFire.bff',
      event: 'sk2.ordnance.shot',
      handler(ctx, ev) {
        if (ev.payload.mode !== 'bounding' || ev.payload.outcome === 'noAmmo') return;
        bffFired(ctx, ev.payload.weapon);
      },
    });
    // A shot with no LOS was still fired (ASLRB A6.11), unless the ammo was never there (SK4 6.2).
    r.on<{ weapon: PieceId; noAmmo?: boolean }>({
      id: 'sk3.vehicleFire.bff-noLos',
      event: 'sk2.ordnance.noLos',
      handler(ctx, ev) {
        if (ev.payload.noAmmo) return;
        const ms = moveState(ctx);
        if (ctx.state.phase !== 'MPh' || !ms?.vehicle || ms.units[0] !== ev.payload.weapon) return;
        bffFired(ctx, ev.payload.weapon);
      },
    });
    r.on<{ weapon: PieceId; kept: boolean }>({
      id: 'sk3.vehicleFire.bff-rof',
      event: 'sk2.ordnance.rof',
      handler(ctx, ev) {
        const p = ctx.state.pieces[ev.payload.weapon];
        // The ROF event comes before the fire marker: a Bounding First Fire shot is the moving vehicle's own.
        const ms = moveState(ctx);
        if (!p || !vehicle(ctx, p) || !ms?.vehicle || ms.units[0] !== p.id) return;
        setTags(ctx, p.id, { [T3.bffRof]: ev.payload.kept ? true : null });
      },
    });

    // An NT vehicle firing outside its CA turns its hull: the VCA follows the weapon's CA (SK4 3.3.2.1 "A
    // TCA/VCA may also be changed ... as a result of firing outside the CA"), and turns back with it when
    // the ammo was never there. The CA change is paid for and the VCA turns with it.
    // A turn to fire is kept with the VCA, in the same change, for the vehicle's other bow weapon (the BMG) firing in
    // that VCA later this phase (SK4 7.8; `sk3.vehicleMg`); a turn undone (no ammo) takes the record with it.
    r.on<{ gun: PieceId; to: number; reason: string; spines: number }>({
      id: 'sk3.vehicleFire.nt-vca',
      event: 'sk2.gun.ca',
      handler(ctx, ev) {
        const p = ctx.state.pieces[ev.payload.gun];
        if (!p || vehicle(ctx, p)?.turret !== 'NT' || p.tags[T3.vca] === ev.payload.to) return;
        // Only a BMG still to fire this phase could owe it: no record otherwise.
        const bmgToFire = swHeldBy(ctx.state, p.id).some((w) => (defOf(ctx, w) as { type?: string }).type === 'BMG' && !fireMarker(w) && w.tags['malf'] !== true);
        const record: Record<string, string | number | null> =
          ev.payload.reason === 'fire' && bmgToFire
            ? { [BOW_TURN.phase]: `${ctx.state.turn}${ctx.state.attacker}${ctx.state.phase}`, [BOW_TURN.spines]: ev.payload.spines, [BOW_TURN.paid]: p.id }
            : ev.payload.reason === 'noAmmo' && p.tags[BOW_TURN.phase] !== undefined
              ? { [BOW_TURN.phase]: null, [BOW_TURN.spines]: null, [BOW_TURN.paid]: null }
              : {};
        // Pivoting in woods or a building to fire takes a Bog Check per hexspine first (SK4 7.6; ASLRB C5.11, D8.2;
        // tester report 2026-11-06). Bogging stops the hull where it is, and its CA with it: the shot is not taken.
        const hex = hexOf(ctx.state, p);
        if (ev.payload.reason === 'fire' && closeTerrain(ctx, hex)) {
          const turn = turnRiskingBog(ctx, p, hex!, ev.payload.to);
          setTags(ctx, p.id, { [T3.vca]: turn.vca, ...(turn.bogged ? { [T2.ca]: turn.vca } : record) });
          return;
        }
        setTags(ctx, p.id, { [T3.vca]: ev.payload.to, ...record });
      },
    });

    // ---------------------------------------------------------------- the moving-target trail
    // When a vehicle's move ends, its trail stays on it: the record of where it spent its MP, read by poses (`mpTrail`).
    // The Defensive Fire Phase's case 24 is +2 whatever the trail (Restricted/Limited Aim are Defensive First Fire only).
    r.on<{ vehicle: PieceId; kind: string }>({
      id: 'sk3.vehicleFire.trail',
      event: 'sk3.vehicle.move',
      handler(ctx, ev) {
        if (ev.payload.kind !== 'end' && ev.payload.kind !== 'motion') return;
        const ms = moveState(ctx);
        if (ms && ms.units[0] === ev.payload.vehicle) setTags(ctx, ev.payload.vehicle, { [T3.mpTrail]: JSON.stringify(ms.trail ?? []) });
      },
    });
    // The Bounding First Fire record (fired, ROF kept) is for its own Player Turn: the MPh, and the AFPh it may forfeit.
    r.on<{ phase: string }>({
      id: 'sk3.vehicleFire.bff-clear',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'AFPh') return;
        for (const p of Object.values(ctx.state.pieces).sort(byId))
          if (p.tags[T3.bff] !== undefined || p.tags[T3.bffRof] !== undefined) setTags(ctx, p.id, { [T3.bff]: null, [T3.bffRof]: null });
      },
    });
    r.on<{ phase: string }>({
      id: 'sk3.vehicleFire.trail-clear',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'CCPh') return;
        for (const p of Object.values(ctx.state.pieces).sort(byId)) if (p.tags[T3.mpTrail] !== undefined) setTags(ctx, p.id, { [T3.mpTrail]: null });
      },
    });
    void hexOf;
  },
};
