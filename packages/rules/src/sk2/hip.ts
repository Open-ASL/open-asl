import type { Ctx, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, hexOf, isVehicleDef, otherSide, personnelAt, statics, swHeldBy } from '../common/pieces';
import { FP, iftColumn, type ApplyResultFn } from '../sk1/fire';
import { hasLos, isVisibleTo, visibleEnemyAt } from '../sk1/known';
import { MOVE_ENTER, moveInternals, moveState, type MoveEnterFn } from '../sk1/movement';
import { ROUT_ENTER, type RoutEnterFn } from '../sk1/rout';
import { gun, isGoodOrder, mmc, pieceOf, setTags, smc } from '../sk1/status';
import { REVEAL_GUN } from './guns';
import { T2, gunManner, isHidden } from './status';

/*
 * Hidden Initial Placement (SK4 6.4): an Emplaced Gun and its crew may set up hidden (not on a
 * paved road). They stay off the board for the other side until the Gun fires, changes its
 * Covered Arc, moves, stands in Open Ground (unpaved road included) within 16 hexes and in the
 * LOS of a Good Order enemy, or an attack affects them. Enemy Infantry trying to enter the hex
 * in the MPh is turned back and stops; a router trying to is eliminated for failure to rout; an
 * advancing unit stays for Close Combat, in which the Gun's side gets a -2 ambush drm. Attacks
 * against a hidden Gun are Area Fire (half FP) or take a +2 To Hit DRM.
 *
 * The client hides what the engine marks hidden; online, each seat receives only its redacted view
 * (`redactState`), so the other player's browser never holds the hidden pieces, and the recording stays
 * closed until the match ends.
 */


/** Hidden enemy Guns of the other side in a hex (held or not). */
export function hiddenGunsAt(env: QueryEnv, hex: HexId, side: SideId): Piece[] {
  const enemy = otherSide(env.state, side);
  return Object.values(env.state.pieces)
    .filter((p) => p.side === enemy && gun(env, p) && isHidden(p) && hexOf(env.state, p) === hex)
    .sort(byId);
}

/** A unit that hides on its own (not a weapon): personnel, or a vehicle (ASLRB A12.3). */
const hidingUnit = (env: QueryEnv, p: Piece) => !!(mmc(env, p) || smc(env, p) || isVehicleDef(defOf(env, p)));

/**
 * Hidden enemy personnel and vehicles in a hex that no hidden Gun accounts for: the units a special rule let set
 * up hidden on their own (S23 SSR 1, "All British units (and the weapons they possess) may set up hidden"; LMA4
 * SSR 2, every German unit HIP).
 */
export function hiddenUnitsAt(env: QueryEnv, hex: HexId, side: SideId): Piece[] {
  const enemy = otherSide(env.state, side);
  return Object.values(env.state.pieces)
    .filter((p) => p.side === enemy && p.loc.kind === 'hex' && p.loc.hex === hex && hidingUnit(env, p) && isHidden(p))
    .sort(byId);
}

/** Whether an enemy of `side` is in `hex`, or a Good Order enemy MMC/SMC within 16 hexes has a LOS to it (SK4 6.4). */
export function seenInOpen(ctx: Ctx, hex: HexId, side: SideId): boolean {
  const map = statics(ctx).map;
  const enemy = otherSide(ctx.state, side);
  return personnelAt(ctx, hex, enemy).length > 0 || Object.values(ctx.state.pieces).some((e) => {
    if (e.side !== enemy || e.loc.kind !== 'hex' || !(mmc(ctx, e) || smc(ctx, e)) || !isGoodOrder(ctx, e)) return false;
    return map.distance(e.loc.hex, hex) <= 16 && hasLos(ctx, e.loc.hex, hex);
  });
}

/** Take a hidden unit and the weapons it holds out of hiding (a unit manning a hidden Gun: the Gun's reveal). */
export function revealUnit(ctx: Ctx, unit: PieceId, reason: string) {
  const u = ctx.state.pieces[unit];
  if (!u || !isHidden(u)) return;
  const held = swHeldBy(ctx.state, unit);
  const g = held.find((w) => gun(ctx, w) && isHidden(w));
  if (g) {
    ctx.proc<(c: Ctx, gun: PieceId, reason: string) => void>(REVEAL_GUN)(ctx, g.id, reason);
    return;
  }
  ctx.emit('sk2.hip.unitRevealed', { unit, hex: hexOf(ctx.state, u), reason });
  setTags(ctx, unit, { [T2.hip]: null });
  for (const w of held) if (isHidden(w)) setTags(ctx, w.id, { [T2.hip]: null });
}

/** Reveal everything hidden in a hex from `side`: Guns first (with their crews), then any other hidden units. */
export function revealHex(ctx: Ctx, hex: HexId, side: SideId, reason: string): boolean {
  const guns = hiddenGunsAt(ctx, hex, side);
  for (const g of guns) ctx.proc<(c: Ctx, gun: PieceId, reason: string) => void>(REVEAL_GUN)(ctx, g.id, reason);
  const units = hiddenUnitsAt(ctx, hex, side);
  for (const u of units) revealUnit(ctx, u.id, reason);
  return guns.length + units.length > 0;
}

export const hipModule: RuleModule = {
  id: 'sk2.hip',
  ref: 'SK4 6.4',
  summary: 'Hidden Initial Placement for Guns: hidden from the other side until revealed.',
  requires: ['sk2.guns', 'sk1.movement', 'sk1.rout', 'sk1.cc'],
  install(r) {
    r.event<{ gun: PieceId; crew: PieceId | null; hex: HexId | null; reason: string }>({ type: 'sk2.hip.revealed', apply() {} });
    r.event<{ units: PieceId[]; hex: HexId; gun: PieceId | null }>({ type: 'sk2.hip.bounce', apply() {} });
    r.event<{ unit: PieceId; hex: HexId | null; reason: string }>({ type: 'sk2.hip.unitRevealed', apply() {} });

    // ---------------------------------------------------------------- what the other side sees
    r.contribute({
      id: 'sk2.hip.visible',
      query: 'piece.visibleTo',
      layer: 0,
      apply(v, { piece, viewer }, env) {
        const p = env.state.pieces[piece];
        if (!p || !isHidden(p)) return v;
        return viewer === p.side;
      },
    });

    // Telling of a reveal: the base procedure clears the tags; this wraps it with the event.
    r.procedure<(c: Ctx, gun: PieceId, reason: string) => void>(REVEAL_GUN, (next) => (ctx, gunId, reason) => {
      const g = ctx.state.pieces[gunId];
      if (!g || !isHidden(g)) return;
      const crew = gunManner(ctx, g);
      ctx.emit('sk2.hip.revealed', { gun: gunId, crew: crew?.id ?? null, hex: hexOf(ctx.state, g), reason });
      next?.(ctx, gunId, reason);
    });
    const reveal = (ctx: Ctx, gunId: PieceId, reason: string) => ctx.proc<(c: Ctx, gun: PieceId, reason: string) => void>(REVEAL_GUN)(ctx, gunId, reason);

    // ---------------------------------------------------------------- seen in Open Ground
    const sweep = (ctx: Ctx) => {
      if (ctx.state.phase === 'setup') return;
      for (const g of Object.values(ctx.state.pieces).filter((p) => gun(ctx, p) && isHidden(p)).sort(byId)) {
        const hex = hexOf(ctx.state, g);
        if (!hex || !ctx.query('hex.openGround', { hex }, false)) continue;
        if (seenInOpen(ctx, hex, g.side)) reveal(ctx, g.id, 'seen');
      }
    };
    for (const event of ['piece.moved', 'piece.tagged', 'turn.phaseStarted']) r.on({ id: `sk2.hip.sweep.${event}`, event, handler: (ctx) => sweep(ctx) });

    // An attack that affects a hidden unit reveals it.
    r.on<{ unit: PieceId; result: { kind: string } }>({
      id: 'sk2.hip.hit',
      event: 'sk1.fire.result',
      handler(ctx, ev) {
        if (ev.payload.result.kind === 'none') return;
        const u = ctx.state.pieces[ev.payload.unit];
        if (!u || !isHidden(u)) return;
        const hex = hexOf(ctx.state, u);
        for (const g of Object.values(ctx.state.pieces).filter((p) => p.side === u.side && gun(ctx, p) && isHidden(p) && hexOf(ctx.state, p) === hex)) reveal(ctx, g.id, 'hit');
        if (isHidden(pieceOf(ctx, u.id))) setTags(ctx, u.id, { [T2.hip]: null });
        // A hidden vehicle's MGs come out with it.
        if (isVehicleDef(defOf(ctx, u))) for (const w of swHeldBy(ctx.state, u.id)) if (isHidden(w)) setTags(ctx, w.id, { [T2.hip]: null });
      },
    });

    // ---------------------------------------------------------------- the MPh bounce (SK4 6.4)
    r.procedure<MoveEnterFn>(MOVE_ENTER, (next) => (ctx, ms, to, cost, woods, extra) => {
      // Full ASL: a stack bypassing the hex does not find what hides in its building or woods (ASLRB A12.151).
      if (extra?.bypass) {
        next?.(ctx, ms, to, cost, woods, extra);
        return;
      }
      const guns = hiddenGunsAt(ctx, to, ctx.state.attacker);
      const units = guns.length ? [] : hiddenUnitsAt(ctx, to, ctx.state.attacker);
      if (guns.length === 0 && units.length === 0) {
        next?.(ctx, ms, to, cost, woods, extra);
        return;
      }
      if (guns.length === 0 && ms.vehicle) {
        // A vehicle entering the hex of hidden Infantry finds them and goes on (S23 SSR 1: only Infantry is turned back).
        revealHex(ctx, to, ctx.state.attacker, 'entered');
        next?.(ctx, ms, to, cost, woods, extra);
        return;
      }
      if (guns.length) for (const g of guns) reveal(ctx, g.id, 'entered');
      else revealHex(ctx, to, ctx.state.attacker, 'entered');
      ctx.emit('sk2.hip.bounce', { units: ms.units, hex: to, gun: guns[0]?.id ?? null });
      // The MF are spent in the hex the stack was in; it may be fired on there (FFMO/FFNAM apply) and its move is over.
      moveInternals.spendInPlace(ctx, ms, cost, { halted: true });
      moveInternals.afterMfExpenditure(ctx);
      const after = moveState(ctx);
      if (after && ctx.state.decisions[ctx.state.decisions.length - 1]?.kind !== 'firstFire') {
        moveInternals.finishStack(ctx);
        moveInternals.reAskMover(ctx);
      }
    });

    // ---------------------------------------------------------------- RtPh and APh
    r.procedure<RoutEnterFn>(ROUT_ENTER, (next) => (ctx, unit, hex) => {
      const p = pieceOf(ctx, unit);
      const guns = hiddenGunsAt(ctx, hex, p.side);
      if (guns.length === 0 && hiddenUnitsAt(ctx, hex, p.side).length === 0) return next?.(ctx, unit, hex) ?? true;
      if (guns.length) for (const g of guns) reveal(ctx, g.id, 'entered');
      else revealHex(ctx, hex, p.side, 'entered');
      return false;
    });
    r.on<{ id: PieceId; loc: { kind: string; hex?: HexId } }>({
      id: 'sk2.hip.advanced',
      event: 'piece.moved',
      handler(ctx, ev) {
        if (ctx.state.phase !== 'APh' || ev.payload.loc.kind !== 'hex' || !ev.payload.loc.hex) return;
        const p = ctx.state.pieces[ev.payload.id];
        if (!p || !(mmc(ctx, p) || smc(ctx, p))) return;
        const guns = hiddenGunsAt(ctx, ev.payload.loc.hex, p.side);
        const units = guns.length ? [] : hiddenUnitsAt(ctx, ev.payload.loc.hex, p.side);
        if (guns.length === 0 && units.length === 0) return;
        if (guns.length) for (const g of guns) reveal(ctx, g.id, 'advanced');
        else revealHex(ctx, ev.payload.loc.hex, p.side, 'advanced');
        ctx.emit('hex.marker', { hex: ev.payload.loc.hex, key: 'hipAmbush', value: (guns[0] ?? units[0])!.side });
      },
    });
    r.contribute({
      id: 'sk2.hip.ambush',
      query: 'cc.ambushDrm',
      ref: 'SK4 6.4',
      label: '-2 hidden Gun ambush',
      when: ({ hex, side }, env) => env.state.hexMarkers[hex]?.['hipAmbush'] === side,
      apply: (v) => v - 2,
    });

    // ---------------------------------------------------------------- attacks against hidden units
    // Small arms vs a hex whose enemies the firer cannot see: Area Fire, half FP (one or two columns down).
    r.procedure<ApplyResultFn>(FP.applyResult, (next) => (ctx, attack, column, baseFinal, out) => {
      const hidden = attack.targets.filter((u) => !isVisibleTo(ctx, pieceOf(ctx, u), attack.side));
      if (hidden.length === 0 || attack.ordnance) {
        next?.(ctx, attack, column, baseFinal, out);
        return;
      }
      const visible = attack.targets.filter((u) => !hidden.includes(u));
      if (visible.length) next?.(ctx, { ...attack, targets: visible }, column, baseFinal, out);
      const half = iftColumn(ctx, column / 2);
      if (half !== null) next?.(ctx, { ...attack, targets: hidden }, half, baseFinal, out);
    });
    r.contribute({
      id: 'sk2.th.hip-target',
      query: 'ordnance.thDrm',
      ref: 'SK4 6.4 (case 23)',
      label: '+2 firing at a hex with no known enemy',
      when: (sc, env) => !sc.moving && visibleEnemyAt(env, sc.target, sc.side).length === 0,
      apply: (v) => v + 2,
    });

    // The ext slot records nothing yet; kept for the client to find a reveal log if needed.
  },
};
