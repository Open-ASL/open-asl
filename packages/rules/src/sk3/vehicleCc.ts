import type { Action, Ctx, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { locOf } from '../common/location';
import { byId, defOf, hexOf, isVehicleDef, otherSide, personnelAt, statics, swHeldBy, unitsAt, vehiclesAt } from '../common/pieces';
import { CCP, ccStateOf, ccUnits, promotionBase, type CcAttack, type ResolveCcAttackFn } from '../sk1/closeCombat';
import { fpfCheck } from '../sk1/fire';
import { FIRST_FIRE, finishDefensiveFire, moveState } from '../sk1/movement';
import { P as MP, type CasualtyFn, type RandomSelectFn } from '../sk1/morale';
import { RP, type FieldPromotionFn } from '../sk1/rally';
import { T, fireMarker, inMelee, isBroken, isCx, isGoodOrder, isPinned, mmc, pieceOf, setTags, smc, sw } from '../sk1/status';
import { T3, crewCanAct, hasStunPlus1, inMotion, isCe, isImmobile, isWreck, vehicle, vehicleMgs } from './status';
import { paatc } from './paatc';
import { applyVehicleEffect } from './vehicleStatus';

/*
 * Infantry against vehicles in and around Close Combat (SK4 3.3.4, 3.8, 3.2.2.1, 3.6):
 *  - CC attacks on a vehicle use the attacker's Close Combat Value (squad 5, crew 4, HS 3, SMC 2;
 *    a SMC joining an MMC adds 1), one unit or an MMC with a SMC, never mixed with personnel targets;
 *    DR < CCV eliminates the vehicle, = CCV Immobilizes it; an original 2 that could not otherwise
 *    succeed rolls a third die; an original 12 is a Casualty Reduction for the attacker.
 *  - A vehicle attacks Infantry with its CMG, AAMG (CE), RMG and small IFE as FP against their CCV.
 *  - With a vehicle in the hex the attacks are sequential (the SK1 module alternates them).
 *  - CC Reaction Fire: Infantry in the hex of a moving vehicle attack it as Defensive First Fire.
 *  - A vehicle is never held in Melee but holds enemy Infantry unless in Motion; AFVs never fight
 *    each other in CC; fire into the firer's own hex is Triple Point Blank Fire; a unit with an enemy
 *    unit in its hex may only fire at that hex; vehicles are Known Enemy Units for Interdiction.
 */

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Close Combat Value of a unit attacking a vehicle (SK4 3.8). */
    'cc.ccv': { ctx: { unit: PieceId; combined: boolean }; value: number };
  }
}

export const ccvBase = (env: QueryEnv, p: Piece): number => {
  const m = mmc(env, p);
  if (!m) return smc(env, p) ? 2 : 0;
  return m.kind === 'squad' ? 5 : m.kind === 'crew' ? 4 : 3;
};

/** The CCV of an attack on a vehicle: one unit's, or an MMC's plus 1 for the SMC with it; −1 per Area Fire reason (pinned). */
export function attackCcv(env: QueryEnv, attackers: PieceId[]): { ccv: number; explain: { id: string; label: string }[] } {
  const ps = attackers.map((id) => pieceOf(env, id));
  const explain: { id: string; label: string }[] = [];
  const anchor = ps.find((p) => mmc(env, p)) ?? ps[0]!;
  const combined = ps.length > 1;
  let ccv = env.query('cc.ccv', { unit: anchor.id, combined }, ccvBase(env, anchor));
  explain.push({ id: 'sk3.ccv.base', label: `CCV ${ccv}` });
  if (combined) {
    ccv += 1;
    explain.push({ id: 'sk3.ccv.smc', label: '+1 SMC combining' });
  }
  for (const p of ps) {
    if (isPinned(p)) {
      ccv -= 1;
      explain.push({ id: 'sk3.ccv.pinned', label: `-1 ${p.id} pinned (Area Fire)` });
    }
    // Inexperienced Infantry: the CCV is one less (SK4 5.4; ASLRB A19.34).
    if (mmc(env, p) && env.query('unit.inexperienced', { unit: p.id }, false)) {
      ccv -= 1;
      explain.push({ id: 'sk3.ccv.inexperienced', label: `-1 ${p.id} Inexperienced` });
    }
  }
  return { ccv, explain };
}

const isPersonnel = (env: QueryEnv, p: Piece) => !!(mmc(env, p) || smc(env, p));
const vehicleOf = (env: QueryEnv, id: PieceId): Piece | null => {
  const p = env.state.pieces[id];
  return p && vehicle(env, p) && !isWreck(p) ? p : null;
};

/** A vehicle on the move that has not stopped (its own MPh), or in Motion. */
export function nonStopped(env: QueryEnv, v: Piece): boolean {
  if (inMotion(v)) return true;
  const ms = moveState(env);
  return !!ms?.vehicle && ms.units[0] === v.id && !ms.vehicle.stopped;
}

/** MG/IFE FP a vehicle may use in Close Combat (SK4 3.8): CMG (not a hull-mounted one), AAMG when CE, RMG, turreted IFE ≤ 15mm; halved in Motion; nothing when Shocked/Stunned. */
export function vehicleCcFp(env: QueryEnv, v: Piece): { fp: number; parts: string[] } {
  const d = vehicle(env, v)!;
  if (!crewCanAct(v)) return { fp: 0, parts: [] };
  const parts: string[] = [];
  let fp = 0;
  const mgs = vehicleMgs(env, v.id);
  for (const kind of ['cmg', 'aamg', 'rmg'] as const) {
    const mg = mgs[kind];
    if (!mg || mg.tags[T.malf] || mg.tags[T3.mgDisabled]) continue;
    if (kind === 'cmg' && d.turret === 'NT') continue;
    if (kind === 'aamg' && !isCe(v)) continue;
    const def = sw(env, mg);
    if (!def) continue;
    fp += def.fp;
    parts.push(`${kind.toUpperCase()} ${def.fp}`);
  }
  if (d.ma?.ife && d.ma.caliber <= 15 && d.turret !== 'NT' && !v.tags[T.malf] && !v.tags[T3.maDisabled]) {
    fp += d.ma.ife;
    parts.push(`IFE ${d.ma.ife}`);
  }
  if (inMotion(v) && fp) {
    fp /= 2;
    parts.push('½ Motion');
  }
  return { fp, parts };
}

/** Whether a vehicle has a working MG at all (a BMG counts: it cannot attack in CC but spares the vehicle the "no MG" DRM). */
export function hasUsableMg(env: QueryEnv, v: Piece): boolean {
  return Object.values(vehicleMgs(env, v.id)).some((mg) => mg && !mg.tags[T.malf] && !mg.tags[T3.mgDisabled]);
}

export type CcVsVehicleResult = 'eliminated' | 'immobilized' | 'none' | 'casualtyReduction';

/**
 * One CC (or CC Reaction Fire) attack on a vehicle (SK4 3.8): DR + DRM against the attackers' CCV.
 * Returns the original DR so Final Protective Fire can take its Morale Check on it.
 */
export function resolveVsVehicle(
  ctx: Ctx,
  side: SideId,
  attackers: PieceId[],
  vehicleId: PieceId,
  opts: { reaction?: boolean; alreadyFired?: boolean; ccv?: { value: number; label: string }; extraDrm?: { value: number; label: string } } = {},
): { dr: number; result: CcVsVehicleResult } {
  const v = pieceOf(ctx, vehicleId);
  const hex = hexOf(ctx.state, v)!;
  // A card may fix the CCV (S71 SSR 2: "using a CCV of 5").
  const { ccv: base, explain } = opts.ccv ? { ccv: opts.ccv.value, explain: [{ id: 'ssr.ccv', label: opts.ccv.label }] } : attackCcv(ctx, attackers);
  let ccv = base;
  if (opts.alreadyFired) {
    ccv -= 1;
    explain.push({ id: 'sk3.ccv.fired', label: '-1 already fired this Player Turn' });
  }
  const drmRes = ctx.explain('cc.drm', { hex, attackers, targets: [vehicleId], side }, 0);
  const drm = drmRes.value + (opts.extraDrm?.value ?? 0);
  const drmExplain = [...drmRes.trace.filter((t) => !t.suppressedBy && t.label).map((t) => ({ id: t.id, label: t.label! })), ...(opts.extraDrm ? [{ id: 'ssr.cc.drm', label: opts.extraDrm.label }] : [])];
  const roll = ctx.roll(`CC ${side} vs ${vehicleId} in ${hex}`);
  let result: CcVsVehicleResult = 'none';
  let third: number | undefined;
  if (roll.total === 12 && crewCanAct(v)) {
    // An original 12 is a Casualty Reduction for the attacker (a random one of a pair).
    const [victim] = ctx.proc<RandomSelectFn>(MP.randomSelect)(ctx, attackers, 1, 'CC vs vehicle casualty');
    ctx.proc<CasualtyFn>(MP.casualtyReduce)(ctx, victim!, 'Close Combat vs a vehicle (original 12)');
    result = 'casualtyReduction';
  } else if (roll.total === 2 && ccv - drm <= 2) {
    // An original 2 always has a chance: a third die, 1-2 eliminates, 3 Immobilizes (SK4 3.8).
    third = ctx.roll(`CC third die vs ${vehicleId}`, 1).total;
    result = third <= 2 ? 'eliminated' : third === 3 ? 'immobilized' : 'none';
  } else {
    const final = roll.total + drm;
    result = final < ccv ? 'eliminated' : final === ccv ? 'immobilized' : 'none';
  }
  // Leader Creation on an original 2 (SK1 5.3), with the chart's -1 for "CC vs AFV or per odds column < 1-1"
  // (ASLRB A18.2; the SK text gives no drm list), one row with the odds drm, so it counts as one column.
  // The base MMC is the best by Morale in SK (SK1 5.3), the highest BPV in full ASL (A18.2): `promotionBase`.
  if (roll.total === 2) {
    const bestId = promotionBase(ctx, attackers.filter((id) => mmc(ctx, pieceOf(ctx, id))));
    const best = bestId ? pieceOf(ctx, bestId) : undefined;
    if (best && ctx.state.pieces[best.id]?.loc.kind === 'hex') ctx.proc<FieldPromotionFn>(RP.fieldPromotion)(ctx, best.id, mmc(ctx, best)!.morale, { ccColumnsBelowEven: 1 });
  }
  ctx.emit('sk3.cc.vsVehicle', { hex, side, attackers, vehicle: vehicleId, ccv, explain, drm, drmExplain, dr: roll.dice as [number, number], ...(third !== undefined ? { third } : {}), result, reaction: !!opts.reaction });
  if (result === 'eliminated') applyVehicleEffect(ctx, vehicleId, 'wreck', `${opts.reaction ? 'CC Reaction Fire' : 'Close Combat'} (CCV ${ccv}, DR ${roll.total})`);
  else if (result === 'immobilized') applyVehicleEffect(ctx, vehicleId, 'immobilized', `${opts.reaction ? 'CC Reaction Fire' : 'Close Combat'} (CCV ${ccv}, DR ${roll.total})`);
  return { dr: roll.total, result };
}

/** Why `unit` may not make a CC Reaction Fire attack on the moving vehicle now (SK4 3.3.4), or null. */
export function reactionFireIllegal(env: QueryEnv, unit: PieceId, side: SideId): string | null {
  const ms = moveState(env);
  if (!ms?.vehicle || !ms.hex) return 'No vehicle is moving';
  const v = env.state.pieces[ms.units[0]!];
  if (!v || !vehicle(env, v) || isWreck(v)) return 'No vehicle is moving';
  const p = env.state.pieces[unit];
  if (!p || p.side !== side) return 'Not your unit';
  if (!isPersonnel(env, p)) return 'Only Infantry may Reaction Fire';
  // In the vehicle's Location (a vehicle is always at ground level).
  if (locOf(env.state, p) !== ms.hex) return 'Only Infantry in the vehicle\'s hex may Reaction Fire';
  if (isBroken(p) || isPinned(p)) return 'The unit must be Good Order and unpinned';
  const m = fireMarker(p);
  if (m === 'prep' || m === 'adv' || m === 'bff') return 'The unit has fired this Player Turn';
  if ((ms.firedHere[unit] ?? 0) >= ms.mfHere) return 'No more attacks here than MP the vehicle spent here';
  return null;
}

export const vehicleCcModule: RuleModule = {
  id: 'sk3.cc',
  ref: 'SK4 3.3.4, 3.8, 3.2.2.1',
  summary: 'Close Combat with vehicles: CCV attacks, vehicle MG attacks, sequential CC, Reaction Fire, Melee, TPBF, Interdiction by vehicles.',
  requires: ['sk1.cc', 'sk1.movement', 'sk3.vehicles', 'sk3.paatc', 'sk3.vehicleStatus'],
  install(r) {
    r.event<{
      hex: HexId; side: SideId; attackers: PieceId[]; vehicle: PieceId; ccv: number; explain: { id: string; label: string }[]; drm: number; drmExplain: { id: string; label: string }[];
      dr: [number, number]; third?: number; result: CcVsVehicleResult; reaction: boolean;
    }>({ type: 'sk3.cc.vsVehicle', apply() {} });

    // ---------------------------------------------------------------- who fights in CC
    r.contribute({
      id: 'sk3.cc.units.vehicles',
      query: 'cc.units',
      apply: (v, { hex, side }, env) => [...v, ...vehiclesAt(env, hex, side, true).map((p) => p.id).filter((id) => !v.includes(id))],
    });
    r.contribute({ id: 'sk3.cc.sequential', query: 'cc.sequential', apply: (v, { hex }, env) => v || vehiclesAt(env, hex, undefined, true).length > 0 });
    // Melee: Infantry are held by enemy Infantry, or by an enemy vehicle that is Stopped; vehicles are never held
    // (SK4 3.8). A vehicle that expends a Start MP lets them go (ASLRB A11.7 example, A11.15).
    r.contribute({
      id: 'sk3.cc.melee-holds',
      query: 'cc.meleeHolds',
      apply(v, { hex }, env) {
        if (vehiclesAt(env, hex, undefined, true).length === 0) return v;
        const sides = env.state.sides;
        const inf = (side: SideId) => personnelAt(env, hex, side);
        const holdingVehicle = (side: SideId) => vehiclesAt(env, hex, side, true).some((x) => !nonStopped(env, x));
        const unbroken = sides.some((s) => inf(s).some((p) => !isBroken(p)) || vehiclesAt(env, hex, s, true).length > 0);
        return unbroken && sides.some((s) => inf(s).length > 0 && (inf(otherSide(env.state, s)).length > 0 || holdingVehicle(otherSide(env.state, s))));
      },
    });

    // ---------------------------------------------------------------- strengths and DRM
    r.contribute({
      id: 'sk3.cc.vehicle-fp',
      query: 'cc.attackFp',
      layer: 0,
      when: ({ unit }, env) => !!vehicleOf(env, unit),
      apply: (_v, { unit }, env) => vehicleCcFp(env, pieceOf(env, unit)).fp,
    });
    // A vehicle's CC attack is odds of its FP against the defenders' CCV (SK4 3.8).
    r.contribute({
      id: 'sk3.cc.defend-ccv',
      query: 'cc.defenseFp',
      layer: 0,
      when: ({ attackers }, env) => !!attackers?.some((a) => vehicleOf(env, a)),
      apply: (_v, { unit }, env) => Math.max(0, env.query('cc.ccv', { unit, combined: false }, ccvBase(env, pieceOf(env, unit))) - (isPinned(pieceOf(env, unit)) ? 1 : 0)),
    });
    const vsVehicle = (id: string, label: string, when: (v: Piece, env: QueryEnv) => boolean, drm: number) =>
      r.contribute({
        id: `sk3.cc.drm.${id}`,
        query: 'cc.drm',
        ref: 'SK4 3.8',
        label,
        when: ({ targets }, env) => targets.length === 1 && !!vehicleOf(env, targets[0]!) && when(pieceOf(env, targets[0]!), env),
        apply: (v) => v + drm,
      });
    vsVehicle('ce', '-1 vs Crew Exposed AFV', (v) => isCe(v), -1);
    vsVehicle('motion', '+2 vs Motion/Non-Stopped vehicle', (v, env) => nonStopped(env, v), 2);
    vsVehicle('immobile', '-1 vs immobile AFV', (v) => isImmobile(v) || !crewCanAct(v), -1);
    vsVehicle('ot', '-2 vs Open-Topped AFV', (v, env) => !!vehicle(env, v)?.openTopped, -2);
    vsVehicle('no-mg', '-1 vs vehicle without a usable MG', (v, env) => !hasUsableMg(env, v), -1);
    r.contribute({
      id: 'sk3.cc.drm.stun',
      query: 'cc.drm',
      ref: 'SK4 7.10',
      label: '+1 Stunned crew (+1)',
      when: ({ attackers }, env) => attackers.some((a) => vehicleOf(env, a) && hasStunPlus1(pieceOf(env, a))),
      apply: (v) => v + 1,
    });
    // Infantry DRM that do not apply to a vehicle target.
    r.suppress<'cc.drm'>({ id: 'sk3.cc.suppress.cx-target', query: 'cc.drm', target: 'sk1.cc.cx-target', when: ({ targets }, env) => targets.some((t) => vehicleOf(env, t)) });
    r.suppress<'cc.drm'>({ id: 'sk3.cc.suppress.vs-broken', query: 'cc.drm', target: 'sk1.cc.vs-broken', when: ({ targets }, env) => targets.some((t) => vehicleOf(env, t)) });

    // ---------------------------------------------------------------- what may be declared
    r.contribute({
      id: 'sk3.cc.attackIllegal',
      query: 'cc.attackIllegal',
      apply(v, { attack, side }, env) {
        if (v) return v;
        const attackerVehicles = attack.attackers.filter((a) => vehicleOf(env, a));
        const targetVehicles = attack.targets.filter((t) => vehicleOf(env, t));
        if (attackerVehicles.length && targetVehicles.length) return 'AFVs may not attack each other in Close Combat';
        if (targetVehicles.length) {
          if (attack.targets.length !== 1) return 'A CC attack on a vehicle targets that vehicle alone';
          if (attack.attackers.length > 2) return 'At most two units may attack a vehicle together';
          const ps = attack.attackers.map((a) => pieceOf(env, a));
          if (ps.length === 2 && !(ps.some((p) => smc(env, p)) && ps.some((p) => mmc(env, p)))) return 'Two units may attack a vehicle together only as an MMC with a SMC';
          const veh = pieceOf(env, targetVehicles[0]!);
          // Infantry that came into the hex this APh passed their PAATC on the way in; nothing more to check here.
          void veh;
          return null;
        }
        if (attackerVehicles.length) {
          if (attack.attackers.length !== 1) return 'A vehicle attacks in Close Combat on its own';
          const veh = pieceOf(env, attackerVehicles[0]!);
          if (!crewCanAct(veh)) return 'A Shocked or Stunned crew cannot attack in Close Combat';
          const { fp } = vehicleCcFp(env, veh);
          if (fp <= 0) return 'The vehicle has no weapon it can use in Close Combat';
          const ccv = attack.targets.reduce((a, t) => a + env.query('cc.defenseFp', { unit: t, attackers: attack.attackers }, 0), 0);
          if (statics(env).tables.ccOddsColumns.length && fp / Math.max(1, ccv) < 1 / 8 - 1e-9) return 'Odds are too low for a CC attack';
          void side;
        }
        return null;
      },
    });

    // ---------------------------------------------------------------- resolution
    r.procedure<ResolveCcAttackFn>(CCP.resolveAttack, (next) => (ctx, side, at, plan) => {
      const target = at.targets.length === 1 ? vehicleOf(ctx, at.targets[0]!) : null;
      if (!target) {
        next?.(ctx, side, at, plan);
        return;
      }
      const attackers = at.attackers.filter((a) => ctx.state.pieces[a]?.loc.kind === 'hex');
      if (attackers.length === 0) return;
      resolveVsVehicle(ctx, side, attackers, target.id);
    });

    // ---------------------------------------------------------------- CC Reaction Fire (SK4 3.3.4)
    r.action<Action & { type: 'reactionFire'; unit: PieceId }>({
      type: 'reactionFire',
      decisionKinds: [FIRST_FIRE],
      legal(env) {
        const ms = moveState(env);
        if (!ms?.vehicle || !ms.hex) return [];
        const side = otherSide(env.state, env.state.attacker);
        return personnelAt(env, ms.hex, side)
          .filter((p) => !reactionFireIllegal(env, p.id, side))
          .sort(byId)
          .map((p) => ({ type: 'reactionFire' as const, unit: p.id }));
      },
      validate: (env, a) => reactionFireIllegal(env, a.unit, a.side),
      resolve(ctx, a) {
        const ms = moveState(ctx)!;
        const vehicleId = ms.units[0]!;
        const p = pieceOf(ctx, a.unit);
        // An MMC first passes its PAATC (once per AFV per Player Turn); a failure pins it and ends the attempt.
        if (mmc(ctx, p) && !paatc(ctx, a.unit, vehicleId, 'reactionFire')) {
          finishDefensiveFire(ctx, []);
          return;
        }
        const marker = fireMarker(p);
        const mode = marker === 'final' ? 'fpf' : marker === 'first' ? 'subsequentFirst' : 'first';
        const alreadyFired = !!marker || !!p.tags[T.firedSw] || swHeldBy(ctx.state, a.unit).some((w) => fireMarker(w));
        const { dr } = resolveVsVehicle(ctx, a.side, [a.unit], vehicleId, { reaction: true, alreadyFired });
        if (ctx.state.pieces[a.unit]?.loc.kind === 'hex') {
          setTags(ctx, a.unit, { [T.fire]: mode === 'first' ? 'first' : 'final' });
          // Final Protective Fire: the original DR is a NMC on the firer (SK1 3.3.3).
          if (mode === 'fpf') fpfCheck(ctx, a.unit, dr);
        }
        finishDefensiveFire(ctx, [a.unit]);
      },
    });

    // Infantry sharing the moving vehicle's hex get their Defensive First Fire chance (Reaction Fire or TPBF).
    r.contribute({
      id: 'sk3.move.firstFire.reaction',
      query: 'move.firstFireAvailable',
      apply: (v, { hex, side }, env) => v || personnelAt(env, hex, side).some((p) => !reactionFireIllegal(env, p.id, side)),
    });

    // ---------------------------------------------------------------- fire in and out of a hex shared with the enemy
    r.contribute({
      id: 'sk3.fp.tpbf',
      query: 'fire.partFp',
      layer: 200,
      ref: 'SK4 3.2.2.1',
      label: 'x3 Triple Point Blank Fire',
      // Within the firer's own Location (another Location of its hex is not TPBF, ASLRB A7.211).
      when: ({ part, attack }, env) => part.dist === 0 && locOf(env.state, pieceOf(env, part.firer)) === attack.target && !attack.residual && !(part.kind === 'sw' && ['FT', 'DC'].includes(sw(env, pieceOf(env, part.piece))?.type ?? '')),
      apply: (v) => v * 3,
    });
    // A unit sharing its Location with an enemy unit may attack only that Location (SK4 3.2.2.1 "hex"; ASLRB
    // A7.212 "Location": an enemy at another level of the hex does not hold it).
    r.contribute({
      id: 'sk3.fire.own-hex-only',
      query: 'fire.illegal',
      ref: 'SK4 3.2.2.1; ASLRB A7.212',
      apply(v, { decl, side }, env) {
        if (v) return v;
        const enemy = otherSide(env.state, side);
        for (const id of [...decl.units, ...decl.sw]) {
          const p = env.state.pieces[id];
          const loc = p && locOf(env.state, p);
          if (!loc || loc === decl.target) continue;
          if (unitsAt(env, loc, enemy).length) return `${id}: an enemy unit is in its hex, it may only fire at that hex`;
        }
        return null;
      },
    });

    // ---------------------------------------------------------------- Interdiction by vehicles (SK1 3.6, SK4 3.6)
    r.contribute({
      id: 'sk3.rout.interdictor',
      query: 'rout.canInterdict',
      when: ({ interdictor }, env) => !!vehicleOf(env, interdictor),
      apply(_v, { interdictor, hex }, env) {
        const v = pieceOf(env, interdictor);
        const d = vehicle(env, v)!;
        const at = hexOf(env.state, v);
        if (!at || inMotion(v) || !crewCanAct(v) || inMelee(env, at)) return false;
        const dist = statics(env).map.distance(at, hex);
        const mgs = vehicleMgs(env, v.id);
        for (const [kind, mg] of Object.entries(mgs)) {
          if (!mg || mg.tags[T.malf] || mg.tags[T3.mgDisabled]) continue;
          if (kind === 'aamg' && !isCe(v)) continue;
          const def = sw(env, mg);
          if (def && def.fp >= 1 && def.range >= dist) return true;
        }
        // A BU vehicle's MA fires with a +1 DRM and cannot interdict; a CE one can, within 17 hexes.
        if (d.ma && isCe(v) && !v.tags[T.malf] && !v.tags[T3.maDisabled] && dist < 17) return true;
        return false;
      },
    });
    // Vehicles are never Good Order "Infantry": the base rule's CX/pinned checks do not apply to them.
    void isCx;
    void isGoodOrder;
    void defOf;
    void isVehicleDef;
    void ccUnits;
    void ccStateOf;
  },
};

export type { CcAttack };
