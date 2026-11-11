import type { Ctx, HexId, Piece, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { byId, hexOf, isVehicleDef, defOf, otherSide, statics, swHeldBy, unitsAt } from '../common/pieces';
import type { IftResult } from '../common/statics';
import { locOf } from '../common/location';
import { FP, type ApplyResultFn, type FireAttackCtx, type FireMode } from '../sk1/fire';
import { hasLos } from '../sk1/known';
import { moveState } from '../sk1/movement';
import { fireMarker, inMelee, pieceOf, setTags } from '../sk1/status';
import { terrainOf } from '../sk1/terrain';
import type { OrdnanceShot, ShotCtx } from '../sk2/ordnance';
import { T3, crewCanAct, inMotion, isCe, isMovingTarget, isWreck, vehicle } from './status';
import { T } from '../sk1/status';
import { applyVehicleEffect, crewTakesResult } from './vehicleStatus';
import { closeTerrain, turnRiskingBog } from './vehicleMove';
import { T2 } from '../sk2/status';
import { hitLocation } from './facing';

/*
 * Fire by and at vehicles (SK4 3.2.4, 7.2, 7.7, 7.11, 7.12; To Hit cases 10, 13, 15, 22, 24, 25).
 * A vehicle's Main Armament fires through the SK2 ordnance module as a Gun whose "manning unit" is
 * the vehicle itself; this module says when it may, adds the vehicle To Hit cases, and decides what
 * IFT fire does to a vehicle: nothing to a Buttoned Up AFV, a crew check to a Crew Exposed one, and
 * the Area Target Type's Shock/Immobilization/destruction.
 */

/** MP a vehicle has spent in the LOS of `firerHex` this move: its current trail, or the one its last move left (SK4 case 24). */
export function mpInLosOf(env: QueryEnv, v: Piece, firerHex: HexId): number {
  const ms = moveState(env);
  const trail: { hex: HexId; mp: number }[] = ms && ms.units[0] === v.id ? (ms.trail ?? []) : JSON.parse((v.tags[T3.mpTrail] as string | undefined) ?? '[]');
  return trail.filter((t) => statics(env).map.hex(t.hex) && hasLos(env, firerHex, t.hex)).reduce((n, t) => n + t.mp, 0);
}

/** Why a vehicle's Main Armament may not fire now (SK4 7.2, 7.10, 3.2.5, 3.5), or null. */
export function maIllegal(env: QueryEnv, shot: OrdnanceShot, mode: FireMode): string | null {
  const p = env.state.pieces[shot.weapon];
  const d = p && vehicle(env, p);
  if (!p || !d || !d.ma) return 'The vehicle has no Main Armament';
  if (isWreck(p)) return 'A wreck does not fire';
  if (p.tags[T3.maDisabled]) return 'The Main Armament is disabled';
  if (!crewCanAct(p)) return p.tags[T3.shock] ? 'A Shocked crew cannot fire' : 'A Stunned crew cannot fire this Player Turn';
  if (isCe(p) && (d.turret === 'RST' || d.turret === '1MT')) return 'A Restricted Slow Traverse or One Man Turret cannot fire its MA while Crew Exposed: Button Up first';
  if (mode === 'prep' && inMotion(p)) return 'A vehicle in Motion may not Prep Fire: it must move first';
  // With an enemy unit in its Location (or in Melee) the vehicle fires into that Location only (SK4 3.2.2.1, 3.8;
  // ASLRB A7.212).
  const at = locOf(env.state, p);
  if (at && shot.target !== at && (inMelee(env, at) || unitsAt(env, at, otherSide(env.state, p.side)).length > 0)) return 'An enemy unit is in its hex: the Main Armament may only fire at that hex';
  if (mode === 'advancing' && p.tags[T3.bff] && !p.tags[T3.bffRof]) return 'The vehicle fired Bounding First Fire this MPh (and lost ROF or fired another weapon)';
  // Same fire phase as its MGs, MPh and DFPh counting as one (7.8).
  const mgClass = swHeldBy(env.state, p.id).map((w) => fireMarker(w)).filter(Boolean).map((m) => (m === 'prep' ? 'PFPh' : m === 'adv' ? 'AFPh' : 'DF'))[0];
  const myClass = mode === 'prep' ? 'PFPh' : mode === 'advancing' ? 'AFPh' : 'DF';
  if (mgClass && mgClass !== myClass) return 'The Main Armament fires in the same fire phase as the vehicle\'s MGs';
  if (mode === 'bounding') {
    const ms = moveState(env);
    if (!ms?.vehicle || ms.units[0] !== p.id) return 'Bounding First Fire is for the vehicle that is moving';
    if (!ms.vehicle.started && !ms.vehicle.stopped) return 'Start the vehicle first';
    // With ROF kept the MA carries no fire marker yet: the BFF tag says it has fired this MPh.
    if (p.tags[T3.bff] && !p.tags[T3.bffRof]) return 'The MA fired Bounding First Fire and lost ROF';
    if (p.tags[T3.bff] && ms.vehicle.sinceBff === 0) return 'Spend another MP before firing again';
  }
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
  const mp = sc.mode === 'bounding' ? mpInLosOf(env, f, sc.target) : 99;
  return (mp > 3 ? 4 : mp >= 2.5 ? 5 : 6) + nt;
}

const targetVehicleOf = (sc: ShotCtx, env: QueryEnv): Piece | null => (sc.targetVehicle ? (env.state.pieces[sc.targetVehicle] ?? null) : null);
const firerVehicleOf = (sc: ShotCtx, env: QueryEnv): Piece | null => (sc.firerVehicle ? (env.state.pieces[sc.firerVehicle] ?? null) : null);

/** Case 24 vs a Motion or moving vehicle: +2 in Motion or more than 3 MP in the firer's LOS, +3 for ≤ 3, +4 for ≤ 1. */
function movingTargetDrm(sc: ShotCtx, env: QueryEnv): number {
  const t = targetVehicleOf(sc, env);
  if (!t || isWreck(t)) return 0;
  if (inMotion(t)) return 2;
  if (!isMovingTarget(t)) return 0;
  const mp = mpInLosOf(env, t, sc.hex);
  return mp <= 1 ? 4 : mp <= 3 ? 3 : 2;
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
    r.event<{ vehicle: PieceId; column: number; dr: [number, number]; drm: number; location: 'hull' | 'turret'; result: IftResult; effect: 'kill' | 'shock' | 'immobilized' | 'none' }>({ type: 'sk3.areaHit', apply() {} });

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
    th('withinHex', 'case 10', (sc, env) => `+${terrainOf(env, sc.hex).id === 'woods' || !!statics(env).map.hex(sc.hex)?.buildingId ? 4 : 2} fire within the hex`, (sc) => sc.range === 0, (sc, env) => (terrainOf(env, sc.hex).id === 'woods' || !!statics(env).map.hex(sc.hex)?.buildingId ? 4 : 2));
    th('bu', 'case 13', '+1 Buttoned Up', (sc, env) => !!firerVehicleOf(sc, env) && !isCe(firerVehicleOf(sc, env)!), () => 1);
    th('stun', 'case 15', '+1 Stun', (sc, env) => firerVehicleOf(sc, env)?.tags[T3.stun] === 'plus1', () => 1);
    th('bounding', 'case 14', (sc, env) => `+${boundingDrm(sc, env)} Bounding ${sc.mode === 'bounding' ? 'First ' : ''}Fire (${vehicle(env, firerVehicleOf(sc, env)!)!.turret === 'NT' ? 'NT' : 'turret'}${sc.mode === 'bounding' ? `, ${mpInLosOf(env, firerVehicleOf(sc, env)!, sc.target)} MP in the target's LOS` : ''})`, (sc, env) => boundingDrm(sc, env) > 0, boundingDrm);
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
        return inMotion(t) ? '+2 target in Motion' : `+${movingTargetDrm(sc, env)} moving vehicle (${mpInLosOf(env, t, sc.hex)} MP in your LOS)`;
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
      when: ({ unit, attack }, env) => !!vehicle(env, pieceOf(env, unit)) && isCe(pieceOf(env, unit)) && attack.ordnance?.targetType !== 'ATT' && env.query('hex.tem', { hex: attack.target }, 0) <= 0,
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
          const location = hitLocation(white, colored);
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
        const sameHex = attack.parts.length > 0 && attack.parts.every((part) => part.dist === 0);
        if (!isCe(v) && !(vehicle(ctx, v)?.openTopped && sameHex)) {
          out[v.id] = { kind: 'none' };
          ctx.emit('sk1.fire.result', { unit: v.id, result: { kind: 'none' }, finalDr: final, explain: [{ id: 'sk3.bu', label: 'Buttoned Up: no effect' }] });
          continue;
        }
        const res = tables.ift(column, final);
        out[v.id] = res;
        ctx.emit('sk1.fire.result', { unit: v.id, result: res, finalDr: final, ...(extra.value ? { drm: extra.value, explain: extra.trace.filter((t) => !t.suppressedBy && t.label).map((t) => ({ id: t.id, label: t.label! })) } : {}) });
        crewTakesResult(ctx, v.id, res, 'fire on the CE crew');
      }
      const rest = attack.targets.filter((u) => !vs.some((v) => v.id === u));
      if (rest.length) next?.(ctx, { ...attack, targets: rest }, column, baseFinal, out);
    });
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
      if (ms?.vehicle && ms.units[0] === p.id) ctx.emit('sk1.move.state', { state: { ...ms, vehicle: { ...ms.vehicle, sinceBff: 0, bffFrom: ms.hex ?? undefined } } });
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
    r.on<{ gun: PieceId; to: number; reason: string }>({
      id: 'sk3.vehicleFire.nt-vca',
      event: 'sk2.gun.ca',
      handler(ctx, ev) {
        const p = ctx.state.pieces[ev.payload.gun];
        if (!p || vehicle(ctx, p)?.turret !== 'NT' || p.tags[T3.vca] === ev.payload.to) return;
        // Pivoting in woods or a building to fire takes a Bog Check per hexspine first (SK4 7.6; ASLRB C5.11, D8.2;
        // tester report 2026-11-06). Bogging stops the hull where it is, and its CA with it: the shot is not taken.
        const hex = hexOf(ctx.state, p);
        if (ev.payload.reason === 'fire' && closeTerrain(ctx, hex)) {
          const turn = turnRiskingBog(ctx, p, hex!, ev.payload.to);
          setTags(ctx, p.id, { [T3.vca]: turn.vca, ...(turn.bogged ? { [T2.ca]: turn.vca } : {}) });
          return;
        }
        setTags(ctx, p.id, { [T3.vca]: ev.payload.to });
      },
    });

    // ---------------------------------------------------------------- the moving-target trail
    // When a vehicle's move ends, its trail stays on it for the Defensive Fire Phase's case 24.
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
