import type { Action, Ctx, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { hexOfLoc, isGroundLoc, locOf, parseLoc, type LocId } from '../common/location';
import { byId, personnelAt, statics, swHeldBy, unitsAt } from '../common/pieces';
import { PHASE_DECISION } from '../common/turn';
import { CC_MPH_DONE, beginMphCc, ccUnits, type CcMphDoneFn } from '../sk1/closeCombat';
import { firerLos } from '../sk1/fire';
import { knownEnemyAt } from '../sk1/known';
import { MOVE_BEFORE_FIRST_FIRE, MOVE_BEFORE_RESUME, MOVE_ENTER, moveInternals, moveLoc, moveState, stackCap, type MoveEnterFn, type MoveHoldFn, type MoveState, type OvrNtc } from '../sk1/movement';
import { T, fireMarker, inMelee, isBroken, isGoodOrder, isPinned, mmc, pieceOf, setTags, smc } from '../sk1/status';
import { grainInSeason, inPlay, smokeDrm, terrainOf } from '../sk1/terrain';
import { isTi } from './labor';
import { minefieldKnownTo } from './mineTb';
import { openMandatoryTpbf } from './tpbf';
import { wireKnownTo } from './wire';

/*
 * Infantry Overrun (ASLRB A4.15, A4.151, A4.152, footnote 3; A10.1, A10.2, A10.7, A11.1, A11.12, A11.4, A12.15).
 * Full ASL only: the Starter Kit never lets Infantry into an enemy hex in the MPh (SK1 3.3).
 * - "An Infantry MMC may enter in the MPh a Location containing only one Known enemy SMC (unless that SMC occupies an AFV)
 *   at double the total MF cost of entry provided it has passed a NTC to enable it to enter the Location": the
 *   `move.enemyEntryAllowed` query lets the step in, `move.stepCost` doubles it (a Minimum Move qualifies, Q&A [Gen22.5;
 *   An95w; An96]). Not into a pillbox held by a SMC (Q&A to A4.15 & B30.44), nor during a Dash (Q&A to A4.15 & A4.63).
 *   "More than one SMC must be revealed to deny a Location": two enemy units there refuse it.
 * - The NTC is taken with the step (one action: the NTC, then on a pass the entry), with the DRM of "the TEM (and any
 *   applicable LOS Hindrance in—not between—that Location such as SMOKE, grain, or orchard) of the enemy-occupied
 *   Location". "A leader may exempt all MMC he is stacked with and moves with from that NTC by passing it himself but if he
 *   fails, no unit in his stack may attempt a NTC individually nor may any of those units move or take any other action
 *   during that phase (10.1)": the leader's NTC by default when one moves with them (he takes no DRM of his own, A10.7);
 *   or each MMC its own, with the leader's DRM (A10.7). A failure stops the unit (or the leader's whole stack) where it is,
 *   its MPh over (`ovrFailed`, A10.1). The leader enters with the MMC he moves with; a SMC never overruns alone.
 * - Other hidden units in the Location: A12.15 (the stack is forced back, the MF spent; `sk2/hip.ts`).
 * - "the SMC ... may immediately, prior to any Defensive First Fire vs the ATTACKER, enter (free of all enemy fire) into
 *   any adjacent Accessible Location of the ATTACKER's choice which is not occupied by an enemy unit. The ATTACKER may not
 *   force the SMC into a minefield, FFE, Wire, or Open Ground hex if an alternate choice is available": after the
 *   Residual FP attack on the entry (A8.2 as on any entry), the DEFENDER chooses to stay or slip away, then the ATTACKER
 *   picks the hex. "Accessible": an adjacent hex the SMC could enter (not NA, within its stacking limit); the hex the
 *   movers came from is allowed (Q&A [Gen22.5; An95w; An96]); Open Ground judged against the ATTACKER's units that see it
 *   (A10.531). No slip-away if "broken, pinned, already held in Melee, TI, occupying a vehicle, or otherwise incapable of
 *   movement" (a First Fire counter included, Q&A to A4.151). Usable again that MPh if overrun again.
 * - Staying, an armed SMC with FP must attack at once by mandatory TPBF (A8.312, `asl/tpbf.ts`; a leader with no SW has no
 *   FP, A4.151), then the rest of the DEFENDER's First Fire.
 * - "If, after Defensive First Fire, the SMC remains in its Location with the entering MMC, normal CC immediately ensues
 *   during that MPh": the CCPh's declarations for that one Location (`beginMphCc`), simultaneous, no Ambush (A11.4), the
 *   usual CX and broken DRM. A First Fire counter does not affect the SMC's CC (Q&A to A4.152). If the SMC is eliminated
 *   the OVR units "may continue their MPh from that Location with any remaining MF allotment"; if it survives, they are in
 *   Melee, "subject to CC again in that Location in that turn's CCPh", and their MPh is over.
 * - "Another MMC OVR-ing a SMC in Melee may attack it in CC (even though the SMC has already been attacked during that MPh
 *   and may not attack back in that MPh) but only the newly arriving attacking unit(s) is eligible to continue movement":
 *   the CC is the newly arrived units' alone, and a SMC attacked in CC this MPh does not attack back.
 * - A11.12: units attacked in the MPh's CC are attacked again in the CCPh like any other: the CCPh keeps no record of it.
 * Not here: a concealed lone SMC or one revealed by Detection (A12.15, with concealment), capture of the SMC in that CC (A4.152,
 * prisoners), hexside TEM of a wall or hedge the LOS crosses (no such hexside on the boards), FFE, and Japanese, Human Wave
 * and Berserk OVR (G1.4, A25.234, A15.432).
 */

export const OVR_EVADE = 'ovrEvade';
export const OVR_PLACE = 'ovrPlace';
const ATTACKED = 'asl.ovr.attacked';
/** Tag: failed its Infantry OVR NTC (or its leader did): no more movement or other action this phase (A4.15, A10.1). */
export const OVR_FAILED = 'ovrFailed';

export type OvrStayAction = Action & { type: 'ovr.stay' };
export type OvrSlipAction = Action & { type: 'ovr.slip' };
export type OvrPlaceAction = Action & { type: 'ovr.place'; hex: HexId };

/** The lone Known enemy SMC in `to` an Infantry OVR could be made against, or null. */
export function ovrTarget(env: QueryEnv, to: LocId): Piece | null {
  const enemy = knownEnemyAt(env, to, env.state.attacker);
  return enemy.length === 1 && smc(env, enemy[0]!) ? enemy[0]! : null;
}

/** Why the moving stack may not make an Infantry OVR into `to`, or null (A4.15). */
export function ovrIllegal(env: QueryEnv, ms: MoveState, to: LocId): string | null {
  if (env.state.phase !== 'MPh') return 'Infantry OVR is made in the MPh (ASLRB A4.15)';
  if (ms.vehicle) return 'Only Infantry make an Infantry OVR (ASLRB A4.15)';
  const enemy = knownEnemyAt(env, to, env.state.attacker);
  if (enemy.length === 0) return 'No enemy unit there';
  if (enemy.length > 1) return `${enemy.length} enemy units there: only a Location holding one Known enemy SMC may be overrun (ASLRB A4.15)`;
  if (!smc(env, enemy[0]!)) return 'Only a lone enemy SMC may be overrun (ASLRB A4.15)';
  if (parseLoc(to).sub === 'pb') return 'A SMC in a pillbox may not be overrun (ASLRB A4.15, B30.44)';
  if (ms.dash) return 'Dashing: no Infantry OVR (ASLRB A4.15, A4.63)';
  if (ms.manhandle) return 'Not while pushing a Gun (ASLRB A4.15, C10.3)';
  if (!ms.units.some((u) => !!mmc(env, pieceOf(env, u)))) return 'Only a MMC may make an Infantry OVR (ASLRB A4.15)';
  return null;
}

/** The leader moving with the stack who may take the OVR NTC for it: a Good Order, unpinned one (A4.15, A10.2). */
const ntcLeader = (env: QueryEnv, ms: MoveState): PieceId | undefined =>
  ms.units.filter((u) => !!smc(env, pieceOf(env, u)) && isGoodOrder(env, pieceOf(env, u)) && !isPinned(pieceOf(env, u))).sort((a, b) => leadership(env, a) - leadership(env, b) || (a < b ? -1 : 1))[0];
const leadership = (env: QueryEnv, l: PieceId, unit?: PieceId) => env.query('unit.leadership', { unit: l, ...(unit ? { for: unit } : {}) }, smc(env, pieceOf(env, l))!.leadership);

/** The NTC DRM for entering `to` by Infantry OVR: its TEM and any LOS Hindrance in the Location (A4.15). */
export function ovrNtcDrm(env: QueryEnv, to: LocId): { drm: number; notes: string[] } {
  const hex = hexOfLoc(to);
  const tem = env.query('hex.tem', { hex: to }, 0);
  const t = terrainOf(env, to);
  const hindrance = smokeDrm(env, hex) + (isGroundLoc(to) && t.los === 'hindrance' && (t.id !== 'grain' || grainInSeason(env)) ? 1 : 0);
  return { drm: tem + hindrance, notes: [...(tem ? [`${tem > 0 ? '+' : ''}${tem} TEM (${t.name})`] : []), ...(hindrance ? [`+${hindrance} Hindrance in the Location`] : [])] };
}

/** Why the SMC being overrun may not slip away (A4.151), or null. */
export function slipAwayIllegal(env: QueryEnv, smcId: PieceId): string | null {
  const p = pieceOf(env, smcId);
  const loc = locOf(env.state, p);
  if (!loc || p.loc.kind !== 'hex') return `${smcId} occupies a vehicle (ASLRB A4.151)`;
  if (isBroken(p)) return `${smcId} is broken (ASLRB A4.151)`;
  if (isPinned(p)) return `${smcId} is pinned (ASLRB A4.151)`;
  if (inMelee(env, loc)) return `${smcId} is held in Melee (ASLRB A4.151)`;
  if (isTi(p)) return `${smcId} is TI (ASLRB A4.151)`;
  if (fireMarker(p) || swHeldBy(env.state, smcId).some((w) => !!fireMarker(w))) return `${smcId} is marked with a fire counter: incapable of movement (ASLRB A4.151)`;
  if (slipAwayHexes(env, smcId).length === 0) return `${smcId} has no adjacent Accessible Location free of enemy units (ASLRB A4.151)`;
  return null;
}

/** Whether `hex` is Open Ground to some ATTACKER unit on the map (A10.531: one that could apply FFMO there). */
function openToAttacker(env: QueryEnv, hex: HexId): boolean {
  if (!env.query('hex.openGround', { hex }, false)) return false;
  return Object.values(env.state.pieces).some((p) => {
    if (p.side !== env.state.attacker || p.loc.kind !== 'hex' || !(mmc(env, p) || smc(env, p))) return false;
    const los = firerLos(env, locOf(env.state, p)!, { target: hex });
    return los.clear && los.hindrance === 0;
  });
}

/** The hexes the ATTACKER may put the slipping SMC in (A4.151): the restricted kinds only when nothing else is left. */
export function slipAwayHexes(env: QueryEnv, smcId: PieceId): HexId[] {
  const p = pieceOf(env, smcId);
  const loc = locOf(env.state, p);
  if (!loc) return [];
  const map = statics(env).map;
  const from = hexOfLoc(loc);
  const attacker = env.state.attacker;
  const accessible = map
    .neighbors(from)
    .filter((h) => !!map.hex(h) && inPlay(env, h))
    .filter((h) => unitsAt(env, h, attacker).length === 0)
    .filter((h) => Number.isFinite(env.query('move.cost', { unit: smcId, from, to: h, viaRoad: false }, 1)))
    // Only a stacking cap refuses the SMC (full ASL: none but a capacity, A5.1); it may overstack the hex.
    .filter((h) => {
      const cap = stackCap(env, h, p.side);
      return !cap || personnelAt(env, h, p.side).filter((x) => !!smc(env, x)).length < cap.smc;
    })
    .sort();
  const restricted = (h: HexId) => !!minefieldKnownTo(env, h, attacker) || !!wireKnownTo(env, h, attacker) || openToAttacker(env, h);
  const free = accessible.filter((h) => !restricted(h));
  return free.length ? free : accessible;
}

/** Event: the OVR NTC(s) taken with the step. */
export interface OvrNtcEvent {
  smc: PieceId;
  loc: LocId;
  by: OvrNtc;
  rolls: { unit: PieceId; dr: [number, number]; drm: number; morale: number; passed: boolean }[];
  notes: string[];
}

const ovrUnitsHere = (env: QueryEnv, o: NonNullable<MoveState['ovr']>) => o.units.filter((u) => env.state.pieces[u]?.loc.kind === 'hex' && locOf(env.state, pieceOf(env, u)) === o.loc);
const smcHere = (env: QueryEnv, o: NonNullable<MoveState['ovr']>) => {
  const p = env.state.pieces[o.smc];
  return !!p && p.loc.kind === 'hex' && locOf(env.state, p) === o.loc;
};
const attackedSmcs = (env: QueryEnv) => (env.state.ext[ATTACKED] as PieceId[] | undefined) ?? [];
const withoutOvr = (ms: MoveState): MoveState => {
  const { ovr: _o, ...rest } = ms;
  void _o;
  return rest;
};

/** Units stopped by a failed OVR NTC: their MPh is over where they stand (A4.15, A10.1). */
function stopFailed(ctx: Ctx, units: PieceId[]) {
  for (const u of [...units].sort()) {
    setTags(ctx, u, { [T.moved]: true, [OVR_FAILED]: true });
    for (const s of swHeldBy(ctx.state, u)) setTags(ctx, s.id, { [T.moved]: true });
  }
}

/** The SMC has chosen to stay (or may not slip away): mandatory TPBF, else the ordinary First Fire. */
function afterEvade(ctx: Ctx): boolean {
  return openMandatoryTpbf(ctx);
}

export const aslInfantryOvrModule: RuleModule = {
  id: 'asl.infantryOvr',
  ref: 'ASLRB A4.15, A4.151, A4.152',
  summary: 'Infantry OVR of a lone SMC: NTC, double MF, the SMC slips away or fights, mandatory TPBF, CC in the MPh.',
  requires: ['sk1.movement', 'sk1.cc', 'asl.tpbf'],
  install(r) {
    r.event<OvrNtcEvent>({ type: 'asl.ovr.ntc', apply() {} });
    r.event<{ smc: PieceId; loc: LocId; choice: 'stay' | 'slip' }>({ type: 'asl.ovr.answer', apply() {} });
    r.event<{ smc: PieceId; from: LocId; to: HexId }>({ type: 'asl.ovr.slipped', apply() {} });
    r.event<{ loc: LocId; smc: PieceId; outcome: 'eliminated' | 'melee' | 'none'; goOn: PieceId[] }>({ type: 'asl.ovr.cc', apply() {} });
    r.event<{ units: PieceId[] | null }>({
      type: ATTACKED,
      apply(d, p) {
        if (p.units) d.ext[ATTACKED] = p.units;
        else delete d.ext[ATTACKED];
      },
    });

    r.contribute({
      id: 'asl.ovr.entry',
      query: 'move.enemyEntryAllowed',
      ref: 'ASLRB A4.14, A4.15',
      apply: (v, { ms, to }, env) => v || !ovrIllegal(env, ms, to),
    });
    // "at double the total MF cost of entry".
    r.contribute({
      id: 'asl.ovr.double-cost',
      query: 'move.stepCost',
      layer: 900,
      ref: 'ASLRB A4.15',
      label: '×2 Infantry OVR',
      when: ({ ms, to }, env) => !ovrIllegal(env, ms, to),
      apply: (v) => v * 2,
    });
    // Each MMC its own NTC, the alternative to the leader's (the plain step).
    r.contribute({
      id: 'asl.ovr.each',
      query: 'move.stepVariants',
      ref: 'ASLRB A4.15',
      apply: (v, { ms, to }, env) => (!ovrIllegal(env, ms, to) && ntcLeader(env, ms) ? [...v, { type: 'move.step' as const, to, ovr: 'each' as const }] : v),
    });

    // The NTC, taken with the step (A4.15).
    r.procedure<MoveEnterFn>(MOVE_ENTER, (next) => (ctx, ms, to, cost, woods, extra) => {
      const { ovrNtc, ...rest } = extra ?? {};
      const target = !ms.vehicle && ctx.state.phase === 'MPh' && !ovrIllegal(ctx, ms, to) ? ovrTarget(ctx, to) : null;
      if (!target) return next!(ctx, ms, to, cost, woods, extra ? rest : undefined);
      const leader = ntcLeader(ctx, ms);
      const by: OvrNtc = ovrNtc ?? (leader ? 'leader' : 'each');
      const { drm, notes } = ovrNtcDrm(ctx, to);
      const roll = (unit: PieceId, extraDrm: number) => {
        const p = pieceOf(ctx, unit);
        const morale = ctx.query('unit.morale', { unit }, (mmc(ctx, p) ?? smc(ctx, p))!.morale);
        const r0 = ctx.roll(`Infantry OVR NTC for ${unit}`);
        return { unit, dr: r0.dice as [number, number], drm: drm + extraDrm, morale, passed: r0.total + drm + extraDrm <= morale };
      };
      const mmcs = ms.units.filter((u) => !!mmc(ctx, pieceOf(ctx, u)));
      // A leader's DRM helps each MMC's own NTC (A10.7), never his own.
      const leaders = ms.units.filter((l) => !!smc(ctx, pieceOf(ctx, l)) && isGoodOrder(ctx, pieceOf(ctx, l)) && !isPinned(pieceOf(ctx, l)));
      const led = (u: PieceId) => Math.min(0, ...leaders.map((l) => leadership(ctx, l, u)));
      const rolls = by === 'leader' && leader ? [roll(leader, 0)] : mmcs.map((u) => roll(u, led(u)));
      ctx.emit('asl.ovr.ntc', { smc: target.id, loc: to, by: by === 'leader' && leader ? 'leader' : 'each', rolls, notes } satisfies OvrNtcEvent);
      const failed = by === 'leader' && leader ? (rolls[0]!.passed ? [] : ms.units) : rolls.filter((x) => !x.passed).map((x) => x.unit);
      const going = ms.units.filter((u) => !failed.includes(u));
      if (failed.length) stopFailed(ctx, failed);
      if (!going.some((u) => !!mmc(ctx, pieceOf(ctx, u)))) {
        // Nobody may enter: the stack stops where it is (a leader whose MMC all failed may go on elsewhere).
        const left = going.filter((u) => !pieceOf(ctx, u).tags[T.moved]);
        if (left.length) ctx.emit('sk1.move.state', { state: { ...ms, units: left } });
        else moveInternals.finishStack(ctx);
        moveInternals.reAskMover(ctx);
        return;
      }
      const entering: MoveState = { ...ms, units: going, ovr: { loc: to, smc: target.id, units: [...going].sort(), phase: 'evade' } };
      ctx.emit('sk1.move.state', { state: entering });
      next!(ctx, entering, to, cost, woods, rest);
    });

    // After the entry's Residual FP: the SMC's answer, then mandatory TPBF (A4.151, A8.312).
    r.procedure<MoveHoldFn>(MOVE_BEFORE_FIRST_FIRE, (next) => (ctx) => {
      const ms = moveState(ctx);
      const o = ms?.ovr;
      if (!ms || !o || o.phase !== 'evade') return next!(ctx);
      if (moveLoc(ms) !== o.loc || !smcHere(ctx, o) || ovrUnitsHere(ctx, o).length === 0) {
        ctx.emit('sk1.move.state', { state: withoutOvr(ms) });
        return next!(ctx);
      }
      ctx.emit('sk1.move.state', { state: { ...ms, ovr: { ...o, phase: 'fire' } } });
      if (!slipAwayIllegal(ctx, o.smc)) {
        const top = ctx.state.decisions[ctx.state.decisions.length - 1];
        if (top?.kind === 'phase') ctx.popDecision(top.id);
        ctx.pushDecision({ kind: OVR_EVADE, owner: pieceOf(ctx, o.smc).side, deadlineClass: 'interrupt', data: { hex: o.loc, smc: o.smc, units: o.units } });
        return true;
      }
      return afterEvade(ctx);
    });

    r.action<OvrStayAction>({
      type: 'ovr.stay',
      decisionKinds: [OVR_EVADE],
      legal: () => [{ type: 'ovr.stay' }],
      resolve(ctx, _a, d) {
        const o = moveState(ctx)!.ovr!;
        ctx.popDecision(d.id);
        ctx.emit('asl.ovr.answer', { smc: o.smc, loc: o.loc, choice: 'stay' });
        if (!afterEvade(ctx)) moveInternals.offerFirstFire(ctx);
      },
    });
    r.action<OvrSlipAction>({
      type: 'ovr.slip',
      decisionKinds: [OVR_EVADE],
      legal: (env) => (moveState(env)?.ovr && !slipAwayIllegal(env, moveState(env)!.ovr!.smc) ? [{ type: 'ovr.slip' }] : []),
      validate: (env) => {
        const o = moveState(env)?.ovr;
        return o ? slipAwayIllegal(env, o.smc) : 'No Infantry OVR in progress';
      },
      resolve(ctx, _a, d) {
        const o = moveState(ctx)!.ovr!;
        ctx.popDecision(d.id);
        ctx.emit('asl.ovr.answer', { smc: o.smc, loc: o.loc, choice: 'slip' });
        ctx.pushDecision({ kind: OVR_PLACE, owner: ctx.state.attacker, deadlineClass: 'interrupt', data: { hex: o.loc, smc: o.smc, hexes: slipAwayHexes(ctx, o.smc) } });
      },
    });
    r.autoResolver({ id: 'asl.ovr.evade-timeout', decisionKind: OVR_EVADE, resolve: (_env, _d, reason) => (reason === 'timeout' ? { type: 'ovr.stay' } : null) });
    r.action<OvrPlaceAction>({
      type: 'ovr.place',
      decisionKinds: [OVR_PLACE],
      legal: (env) => {
        const o = moveState(env)?.ovr;
        return o ? slipAwayHexes(env, o.smc).map((hex) => ({ type: 'ovr.place', hex })) : [];
      },
      validate: (env, a) => {
        const o = moveState(env)?.ovr;
        if (!o) return 'No Infantry OVR in progress';
        return slipAwayHexes(env, o.smc).includes(a.hex) ? null : `The SMC may not be put in ${a.hex}: an adjacent Accessible Location free of enemy units, not a minefield, Wire or Open Ground while another is left (ASLRB A4.151)`;
      },
      resolve(ctx, a, d) {
        const ms = moveState(ctx)!;
        const o = ms.ovr!;
        ctx.popDecision(d.id);
        // Free of all enemy fire (A4.151): the SMC simply goes, with what it holds.
        ctx.emit('piece.moved', { id: o.smc, loc: { kind: 'hex', hex: a.hex } });
        ctx.emit('asl.ovr.slipped', { smc: o.smc, from: o.loc, to: a.hex });
        ctx.emit('sk1.move.state', { state: withoutOvr(moveState(ctx)!) });
        moveInternals.offerFirstFire(ctx);
      },
    });
    r.autoResolver({
      id: 'asl.ovr.place-timeout',
      decisionKind: OVR_PLACE,
      resolve: (env, _d, reason) => {
        const o = moveState(env)?.ovr;
        const hex = o ? slipAwayHexes(env, o.smc)[0] : undefined;
        return reason === 'timeout' && hex ? { type: 'ovr.place', hex } : null;
      },
    });

    // After the DEFENDER's First Fire: CC at once in the MPh if the SMC is still there with them (A4.152).
    r.procedure<MoveHoldFn>(MOVE_BEFORE_RESUME, (next) => (ctx) => {
      const ms = moveState(ctx);
      const o = ms?.ovr;
      if (!ms || !o || o.phase !== 'fire') return next!(ctx);
      if (!smcHere(ctx, o) || ovrUnitsHere(ctx, o).length === 0) {
        ctx.emit('sk1.move.state', { state: withoutOvr(ms) });
        return next!(ctx);
      }
      ctx.emit('sk1.move.state', { state: { ...ms, ovr: { ...o, phase: 'cc' } } });
      const top = ctx.state.decisions[ctx.state.decisions.length - 1];
      if (top?.kind === 'phase') ctx.popDecision(top.id);
      const side: SideId = ctx.state.attacker;
      // Only the newly arrived units attack; a SMC already attacked in CC this MPh does not attack back (A4.152).
      const barred = [
        ...ccUnits(ctx, o.loc, side).map((p) => p.id).filter((u) => !o.units.includes(u)),
        ...(attackedSmcs(ctx).includes(o.smc) ? [o.smc] : []),
      ];
      beginMphCc(ctx, o.loc, barred);
      return true;
    });
    r.procedure<CcMphDoneFn>(CC_MPH_DONE, (next) => (ctx, hex) => {
      next?.(ctx, hex);
      const ms = moveState(ctx);
      const o = ms?.ovr;
      if (!ms || !o || o.phase !== 'cc' || o.loc !== hex) return;
      const smcLives = smcHere(ctx, o);
      if (smcLives) ctx.emit(ATTACKED, { units: [...new Set([...attackedSmcs(ctx), o.smc])].sort() });
      ctx.emit('sk1.move.state', { state: withoutOvr(ms) });
      moveInternals.pruneMovers(ctx);
      const cur = moveState(ctx);
      const goOn = !smcLives && cur ? cur.units.filter((u) => o.units.includes(u)) : [];
      ctx.emit('asl.ovr.cc', { loc: o.loc, smc: o.smc, outcome: smcLives ? (inMelee(ctx, o.loc) ? 'melee' : 'none') : 'eliminated', goOn });
      // The SMC gone: the OVR units go on with their MF (A4.152). Otherwise, in Melee (or with nobody to go on), their MPh is over.
      if (cur && !goOn.length) moveInternals.finishStack(ctx);
      moveInternals.reAskMover(ctx);
    });

    r.on<{ phase: string }>({
      id: 'asl.ovr.end',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'MPh') return;
        if (ctx.state.ext[ATTACKED]) ctx.emit(ATTACKED, { units: null });
        for (const p of Object.values(ctx.state.pieces).filter((x) => x.tags[OVR_FAILED] !== undefined).sort(byId)) setTags(ctx, p.id, { [OVR_FAILED]: null });
      },
    });
  },
};
