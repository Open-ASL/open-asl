import type { Action, Ctx, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { hexOfLoc, locOf, type LocId } from '../common/location';
import { byId, defOf, isVehicleDef, otherSide, personnelAt, swHeldBy, unitsAt } from '../common/pieces';
import { FP, directorsOf, type FireDeclaration, type ResolveFireFn } from '../sk1/fire';
import { MOVE_BEFORE_FIRST_FIRE, MOVE_FINISH, finishDefensiveFire, firstFireIllegal, firstFireMode, leftUnits, movingInfo, recordRofChoice, type MoveFinishFn, type MoveHoldFn } from '../sk1/movement';
import { firstFireTargets, moveLoc, moveState } from '../sk1/moveState';
import { T, fireMarker, inMelee, isBroken, mmc, pieceOf, smc, sw } from '../sk1/status';
import { heightOf } from '../sk2/elevation';
import { isHidden } from '../sk2/status';
import { isWreck } from '../sk3/status';

/*
 * Triple Point Blank Fire in full ASL (ASLRB A7.21, A7.211, A8.31, A8.4, A12.151).
 * - Fire into one's own Location is allowed at any enemy unit there that is not in Melee (A7.21: "on those rare instances
 *   when fire attacks are allowed vs units in the same Location"), in every fire phase: Defensive First Fire, SFF and FPF
 *   at a stack that is there in the MPh, Final Fire ("an adjacent (or same) hex", A8.4) and the ATTACKER's Prep and
 *   Advancing Fire. The Starter Kit allows it only at a vehicle (SK4 3.2.2.1). A hidden unit does not fire into its own
 *   Location to stay hidden: a voluntary reveal waits for concealment (A12.14).
 * - TPBF vs PRC from a higher Location of the hex (A7.211: "from enemy units in that Location or any higher Location in
 *   that hex"): an attack whose every target is a vehicle (its crew) is tripled, not doubled, from the level above. Against
 *   Infantry on another floor it stays PBF (A7.21: TPBF needs the same Location).
 * - A BU Open-Topped AFV's crew is subject to TPBF "from enemy units in that Location or any higher Location in that
 *   hex" (A7.211): in a Fire Group with parts outside the hex it is attacked by the FP of the parts in its hex alone,
 *   not spared the whole attack (the Starter Kit, SK4 7.13, exposes it only when every part fires from its hex).
 * - When an Infantry stack's MPh ends in a Location it shares with enemy units outside Melee, that Location gets a CC
 *   counter: they are not held in Melee until after the CCPh, and broken units may rout away in the RtPh (A12.151, A7.211,
 *   A8.31; the CC marker goes on "not until the ... unit end[s] its MPh in the defender's Location").
 * - Mandatory TPBF (A8.312): "An armed, unbroken Infantry DEFENDER not in Melee must after all Residual-FP/minefield/OBA
 *   attacks then immediately attack any Infantry/Cavalry MMC unit that enters its Location during the MPh whether it uses
 *   Defensive First Fire, Subsequent First Fire, or FPF [EXC: A SMC with a MG/IFE already marked with a First Fire counter
 *   may not use Subsequent First Fire or FPF because it cannot use Sustained Fire; 9.3] ... All such FPF and any
 *   Defensive/Subsequent First Fire must be combined into one Mandatory FG (7.55)." A DEFENDER decision opened before any
 *   other First Fire at that entry ("immediately": before any DEFENDER unit elsewhere fires at that ATTACKER, Q&A [An93b;
 *   An96]), with no Pass. Its fire group: every MMC's inherent FP must fire; a SW is optional (A8.312 names none), except
 *   that every usable MG of a unit using SFF or FPF fires (A8.3, A8.31) and a SMC whose only FP is a SW fires one (it is
 *   armed and must attack); a leader with no SW is armed (Q&A to A1.11) but has no FP to attack with (A4.151), so nothing
 *   is asked of him. A hidden unit is not obliged (A12.151, G.4; Q&A [K33-ML]): it does not fire into its own Location to
 *   stay hidden. Opened from any MPh entry of a MMC into a Location holding such DEFENDER units (first reached by Infantry
 *   OVR, A4.15; Berserk and Human Wave use it too), after the Residual FP attack; nothing is opened if that attack
 *   eliminated the movers (Q&A [K33]).
 */

/** Decision kind of mandatory TPBF (A8.312). */
export const MANDATORY_TPBF = 'mandatoryTpbf';
export type MandatoryTpbfAction = Action & { type: 'tpbf.fire'; decl: FireDeclaration };

const isMg = (env: QueryEnv, id: PieceId) => ['LMG', 'MMG', 'HMG'].includes(sw(env, pieceOf(env, id))?.type ?? '');

/**
 * What A8.312 asks of the DEFENDER's units in `loc` now: the MMC whose inherent FP must fire, the SW that must fire with
 * them (`sw`), the SMC that must fire one of their SW (`pickOne`), and the SW that may join (`optional`). Null when it
 * asks nothing (no armed, unbroken, unhidden Infantry there with FP, or the Location is in Melee).
 */
export function mandatoryTpbfOf(env: QueryEnv, loc: LocId): { units: PieceId[]; sw: PieceId[]; pickOne: Record<PieceId, PieceId[]>; optional: PieceId[] } | null {
  const ms = moveState(env);
  if (!ms?.hex || inMelee(env, loc)) return null;
  const side = otherSide(env.state, env.state.attacker);
  const out = { units: [] as PieceId[], sw: [] as PieceId[], pickOne: {} as Record<PieceId, PieceId[]>, optional: [] as PieceId[] };
  const alone = (decl: Partial<FireDeclaration>) => !firstFireIllegal(env, ms, { units: [], sw: [], target: loc, ...decl }, side);
  for (const p of personnelAt(env, loc, side).sort(byId)) {
    if (isBroken(p) || isHidden(p)) continue;
    const weapons = swHeldBy(env.state, p.id).sort(byId).map((w) => w.id).filter((w) => !pieceOf(env, w).tags[T.malf] && alone({ sw: [w] }));
    if (mmc(env, p)) {
      // A unit using SFF or FPF fires every usable MG with it (A8.3, A8.31).
      const sustained = !!fireMarker(p);
      const mgs = sustained ? swHeldBy(env.state, p.id).sort(byId).map((w) => w.id).filter((w) => isMg(env, w) && !pieceOf(env, w).tags[T.malf] && !pieceOf(env, w).tags['mgDisabled']) : [];
      if (!alone({ units: [p.id], sw: mgs })) continue;
      out.units.push(p.id);
      out.sw.push(...mgs);
      out.optional.push(...weapons.filter((w) => !mgs.includes(w)));
    } else if (smc(env, p)) {
      // EXC: a SMC whose MG/IFE is already marked First Fire cannot use Sustained Fire (A9.3): not obliged.
      if (swHeldBy(env.state, p.id).some((w) => isMg(env, w.id) && fireMarker(w) === 'first')) continue;
      if (weapons.length) out.pickOne[p.id] = weapons;
    }
  }
  if (!out.units.length && !Object.keys(out.pickOne).length) return null;
  return out;
}

/** The smallest declaration A8.312 accepts: the required units and SW, each SMC's first SW. */
export function mandatoryTpbfDecl(env: QueryEnv, loc: LocId): FireDeclaration | null {
  const m = mandatoryTpbfOf(env, loc);
  if (!m) return null;
  return { units: m.units, sw: [...m.sw, ...Object.values(m.pickOne).map((ws) => ws[0]!)].sort(), target: loc };
}

/** Why a mandatory TPBF declaration is refused (A8.312), or null. */
export function mandatoryTpbfIllegal(env: QueryEnv, decl: FireDeclaration): string | null {
  const ms = moveState(env);
  const loc = ms && moveLoc(ms);
  if (!ms || !loc) return 'Nothing is moving';
  if (decl.target !== loc) return `Mandatory TPBF attacks the units that entered ${loc} (ASLRB A8.312)`;
  const m = mandatoryTpbfOf(env, loc);
  if (!m) return 'Nothing is obliged to fire (ASLRB A8.312)';
  const side = otherSide(env.state, env.state.attacker);
  for (const id of [...decl.units, ...decl.sw]) {
    const p = env.state.pieces[id];
    if (!p || p.side !== side || locOf(env.state, p) !== loc) return `${id} is not in ${loc}: the Mandatory Fire Group is the units in that Location (ASLRB A8.312, A7.55)`;
  }
  const missing = [...m.units.filter((u) => !decl.units.includes(u)), ...m.sw.filter((w) => !decl.sw.includes(w))];
  if (missing.length) return `${missing.join(', ')} must fire in the Mandatory Fire Group (ASLRB A8.312)`;
  for (const [leader, ws] of Object.entries(m.pickOne)) if (!ws.some((w) => decl.sw.includes(w))) return `${leader} is armed and must attack with a SW (ASLRB A8.312)`;
  return firstFireIllegal(env, ms, decl, side);
}

/** Opens mandatory TPBF at the moving stack's Location when A8.312 asks for it: true when the decision was pushed. */
export function openMandatoryTpbf(ctx: Ctx): boolean {
  const ms = moveState(ctx);
  const loc = ms && moveLoc(ms);
  if (!ms || !loc || ms.vehicle) return false;
  // An Infantry MMC that enters (A8.312: "any Infantry/Cavalry MMC unit").
  if (!firstFireTargets(ctx, ms).some((u) => !!mmc(ctx, pieceOf(ctx, u)))) return false;
  const decl = mandatoryTpbfDecl(ctx, loc);
  if (!decl || mandatoryTpbfIllegal(ctx, decl)) return false;
  const top = ctx.state.decisions[ctx.state.decisions.length - 1];
  if (top?.kind === 'phase') ctx.popDecision(top.id);
  ctx.pushDecision({ kind: MANDATORY_TPBF, owner: otherSide(ctx.state, ctx.state.attacker), deadlineClass: 'interrupt', data: { hex: loc, units: firstFireTargets(ctx, ms), decl } });
  return true;
}

/** The latest expenditure of the moving stack entered its Location (not MF spent within it). */
const justEntered = (ms: NonNullable<ReturnType<typeof moveState>>) => {
  const last = ms.trail?.[ms.trail.length - 1];
  return !!ms.hex && ms.hexesEntered > 0 && !!last && last.hex === ms.hex && last.mp === ms.mfHere;
};

/** Enemy units of `side` in `loc` that fire into it may attack (not in Melee). */
function ownLocationFire(env: QueryEnv, loc: LocId, side: string, firer?: PieceId): boolean {
  if (inMelee(env, loc)) return false;
  if (firer && env.state.pieces[firer] && isHidden(pieceOf(env, firer))) return false;
  return unitsAt(env, loc, otherSide(env.state, side)).length > 0;
}

/** Every target of an attack is a vehicle, so the attack is on its PRC (A7.211). */
const allVehicles = (env: QueryEnv, targets: PieceId[]) =>
  targets.length > 0 && targets.every((u) => { const p = env.state.pieces[u]; return !!p && isVehicleDef(defOf(env, p)) && !isWreck(p); });

/** The firer of a part stands in a higher Location of the target's hex. */
const fromAbove = (env: QueryEnv, firer: PieceId, target: LocId) => {
  const from = locOf(env.state, pieceOf(env, firer));
  return !!from && from !== target && hexOfLoc(from) === hexOfLoc(target) && heightOf(env, from) > heightOf(env, target);
};

/** Locations where the finished stack's units now share a Location with enemy units outside Melee or CC. */
function sharedLocations(ctx: Ctx, units: PieceId[]): LocId[] {
  const out = new Set<LocId>();
  for (const u of units) {
    const p = ctx.state.pieces[u];
    if (!p || p.loc.kind !== 'hex') continue;
    const loc = locOf(ctx.state, p)!;
    const m = ctx.state.hexMarkers[loc];
    if (m?.['melee'] || m?.['cc']) continue;
    if (unitsAt(ctx, loc, otherSide(ctx.state, p.side)).length) out.add(loc);
  }
  return [...out].sort();
}

export const aslTpbfModule: RuleModule = {
  id: 'asl.tpbf',
  ref: 'ASLRB A7.21, A7.211, A8.4, A12.151',
  summary: 'TPBF in full ASL: fire into one\'s own Location at enemy units not in Melee, TPBF at PRC from above, the CC counter.',
  requires: ['sk1.fire', 'sk1.movement', 'asl.locations'],
  install(r) {
    r.contribute({
      id: 'asl.tpbf.ot-crew-parts',
      query: 'fire.otExposedParts',
      ref: 'ASLRB A7.211',
      apply: (_v, { attack }, env) => attack.parts.filter((part) => part.dist === 0 && !!pieceOf(env, part.firer)).map((part) => part.piece),
    });
    r.contribute({ id: 'asl.tpbf.own-location', query: 'fire.ownLocation', ref: 'ASLRB A7.21, A8.4', apply: (v, { target, side, firer }, env) => v || ownLocationFire(env, target, side, firer) });
    // A7.211: TPBF at PRC from a higher Location of the hex, instead of the PBF between levels.
    const tpbfAbove = (part: { dist: number; firer: PieceId; kind: string; piece: PieceId }, attack: { target: LocId; targets: PieceId[]; residual?: boolean }, env: QueryEnv) =>
      part.dist === 0 &&
      !attack.residual &&
      !(part.kind === 'sw' && ['FT', 'DC'].includes(sw(env, pieceOf(env, part.piece))?.type ?? '')) &&
      fromAbove(env, part.firer, attack.target) &&
      allVehicles(env, attack.targets);
    r.suppress<'fire.partFp'>({ id: 'asl.tpbf.prc-not-pbf', query: 'fire.partFp', target: 'asl.levels.pbf-between-levels', ref: 'ASLRB A7.211', when: ({ part, attack }, env) => tpbfAbove(part, attack, env) });
    r.contribute({
      id: 'asl.tpbf.prc-above',
      query: 'fire.partFp',
      layer: 200,
      ref: 'ASLRB A7.211',
      label: 'x3 TPBF at the crew from the level above (ASLRB A7.211)',
      when: ({ part, attack }, env) => tpbfAbove(part, attack, env),
      apply: (v) => v * 3,
    });
    // A8.312: an entry into a Location of armed DEFENDER Infantry opens mandatory TPBF before any other First Fire.
    r.procedure<MoveHoldFn>(MOVE_BEFORE_FIRST_FIRE, (next) => (ctx) => {
      if (next?.(ctx)) return true;
      const ms = moveState(ctx);
      return !!ms && justEntered(ms) && openMandatoryTpbf(ctx);
    });
    r.event<{ hex: LocId; units: PieceId[]; sw: PieceId[] }>({ type: 'asl.tpbf.mandatory', apply() {} });
    r.action<MandatoryTpbfAction>({
      type: 'tpbf.fire',
      decisionKinds: [MANDATORY_TPBF],
      legal(env) {
        const ms = moveState(env);
        const loc = ms && moveLoc(ms);
        const base = loc ? mandatoryTpbfDecl(env, loc) : null;
        if (!base || !loc) return [];
        const all = { ...base, sw: [...new Set([...base.sw, ...mandatoryTpbfOf(env, loc)!.optional])].sort() };
        return [base, ...(all.sw.length !== base.sw.length ? [all] : [])].filter((decl) => !mandatoryTpbfIllegal(env, decl)).map((decl) => ({ type: 'tpbf.fire', decl }));
      },
      validate: (env, a) => mandatoryTpbfIllegal(env, a.decl),
      resolve(ctx, a) {
        const ms = moveState(ctx)!;
        ctx.emit('asl.tpbf.mandatory', { hex: a.decl.target, units: a.decl.units, sw: a.decl.sw });
        const out = ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, firstFireMode(ctx, a.decl), { moving: firstFireTargets(ctx, ms), movingInfo: movingInfo(ctx, ms) });
        recordRofChoice(ctx, a.decl.target, a.decl.sw, out.rofResidual);
        finishDefensiveFire(ctx, [...a.decl.units, ...a.decl.sw, ...directorsOf(a.decl)]);
      },
    });
    // No Pass: a clock running out fires the smallest Mandatory Fire Group.
    r.autoResolver({
      id: 'asl.tpbf.mandatory-timeout',
      decisionKind: MANDATORY_TPBF,
      resolve: (env, _d, reason) => {
        if (reason !== 'timeout') return null;
        const ms = moveState(env);
        const decl = ms && moveLoc(ms) ? mandatoryTpbfDecl(env, moveLoc(ms)!) : null;
        return decl ? { type: 'tpbf.fire', decl } : null;
      },
    });
    // The CC counter when an Infantry stack's MPh ends in a Location shared with the enemy.
    r.procedure<MoveFinishFn>(MOVE_FINISH, (next) => (ctx) => {
      const ms = moveState(ctx);
      const units = ms && !ms.vehicle ? [...ms.units, ...(ms.stopped ?? []), ...(ms.leftBypass ?? []).flatMap((r) => leftUnits(ctx, r))] : [];
      next?.(ctx);
      for (const loc of sharedLocations(ctx, units)) ctx.emit('hex.marker', { hex: loc, key: 'cc', value: true });
    });
  },
};
