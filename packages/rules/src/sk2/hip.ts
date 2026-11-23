import type { Ctx, HexId, Location, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, hexOf, isVehicleDef, otherSide, personnelAt, statics, swHeldBy, unitsAt } from '../common/pieces';
import { hexOfLoc, levelOfLoc, locOf, type LocId } from '../common/location';
import { FP, iftColumn, type ApplyResultFn, type FireAttackCtx } from '../sk1/fire';
import { hasLos, isVisibleTo } from '../sk1/known';
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
  const guns = Object.values(ctx.state.pieces).filter((g) => g.side === u.side && g.loc.kind !== 'eliminated' && gun(ctx, g) && isHidden(g)
    && ((g.loc.kind === 'held' && g.loc.by === unit) || g.tags[T2.hipCrew] === unit)).sort(byId);
  for (const g of guns) {
    ctx.proc<(c: Ctx, gun: PieceId, reason: string) => void>(REVEAL_GUN)(ctx, g.id, reason);
  }
  if (isHidden(pieceOf(ctx, unit))) {
    ctx.emit('sk2.hip.unitRevealed', { unit, hex: hexOf(ctx.state, u), reason });
    setTags(ctx, unit, { [T2.hip]: null });
  }
  for (const w of held) if (isHidden(w)) setTags(ctx, w.id, { [T2.hip]: null });
}

/**
 * Reveal everything hidden in a hex from `side`: Guns first (with their crews), then any other hidden units. `loc`: only
 * what is in that one Location of the hex (full ASL, e.g. A12.151 "all concealment in that Location is lost").
 */
export function revealHex(ctx: Ctx, hex: HexId, side: SideId, reason: string, loc?: LocId): boolean {
  const inLoc = (p: Piece) => loc === undefined || locOf(ctx.state, p) === loc;
  const guns = hiddenGunsAt(ctx, hex, side).filter(inLoc);
  for (const g of guns) ctx.proc<(c: Ctx, gun: PieceId, reason: string) => void>(REVEAL_GUN)(ctx, g.id, reason);
  const units = hiddenUnitsAt(ctx, hex, side).filter(inLoc);
  for (const u of units) revealUnit(ctx, u.id, reason);
  return guns.length + units.length > 0;
}

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Whether an attack on a hidden unit is Area Fire (half FP; SK4 6.4, ASLRB A12.3): yes, unless a rule says otherwise (full ASL: B30.7, in a pillbox). */
    'hip.areaFire': { ctx: { attack: FireAttackCtx; unit: PieceId }; value: boolean };
  }
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

    // SK4 6.4: the Gun loses HIP when its crew moves, even after dropping it. Retain that
    // association while unmanned; do not reveal another hidden crew sharing the Location.
    r.replace<{ id: PieceId; loc: Location }>({
      id: 'sk2.hip.dropped-crew', event: 'piece.moved',
      when: (env, ev) => {
        const p = env.state.pieces[ev.payload.id];
        return env.state.phase !== 'setup' && !!p && !!gun(env, p) && isHidden(p);
      },
      replace(env, ev) {
        const p = env.state.pieces[ev.payload.id]!;
        const crew = p.loc.kind === 'held' && ev.payload.loc.kind === 'hex' ? p.loc.by : null;
        if (!crew && p.tags[T2.hipCrew] === undefined) return [ev];
        return [{ type: 'piece.tagged', payload: { id: p.id, tags: { [T2.hipCrew]: crew } } }, ev];
      },
    });
    // SK4 6.4; ASLRB A12.32: moving or advancing personnel cannot retain HIP. This
    // includes a Gun crew without the hidden-units SSR installed, and a routing crew.
    r.on<{ id: PieceId }>({
      id: 'sk2.hip.unit-moved', event: 'piece.moved',
      handler(ctx, ev) {
        if (ctx.state.phase === 'setup') return;
        const u = ctx.state.pieces[ev.payload.id];
        if (u && isHidden(u) && hidingUnit(ctx, u)) revealUnit(ctx, u.id, 'moved');
      },
    });

    // ---------------------------------------------------------------- seen in Open Ground
    const sweep = (ctx: Ctx) => {
      if (ctx.state.phase === 'setup') return;
      for (const g of Object.values(ctx.state.pieces).filter((p) => gun(ctx, p) && isHidden(p)).sort(byId)) {
        const hex = hexOf(ctx.state, g);
        // Open Ground by its Location (a Starter Kit hex is one; full ASL: a pillbox is Concealment Terrain, B30.7).
        if (!hex || !ctx.query('hex.openGround', { hex: locOf(ctx.state, g) ?? hex }, false)) continue;
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

    // ---------------------------------------------------------------- firing on the IFT
    // SK4 6.4 reveals a Gun that fires but says nothing of its crew firing its own FP, or of the Gun's IFE (6.8),
    // which resolve on the IFT, not by To Hit. Full ASL decides: hidden status is concealment (ASLRB A12.3), a
    // concealed unit that fires in the LOS of a Good Order enemy ground unit loses it (A12.121 Concealment Table), a
    // Gun firing its IFE so is always revealed (A12.34), and a Gun and its manning Infantry share their status (A12.2).
    // The shot's own target sees it, so any IFT attack by the crew, the Gun or a SW the crew holds reveals both.
    for (const event of ['sk1.fire.attack', 'sk1.fire.noLos'])
      r.on<{ attack: { parts: PieceId[]; directors?: PieceId[] } }>({
        id: event === 'sk1.fire.attack' ? 'sk2.hip.fired' : 'sk2.hip.fired-noLos',
        event,
        handler(ctx, ev) {
          for (const id of [...ev.payload.attack.parts, ...(ev.payload.attack.directors ?? [])].sort()) {
            const p = ctx.state.pieces[id];
            if (!p) continue;
            const firer = p.loc.kind === 'held' ? ctx.state.pieces[p.loc.by] : p;
            for (const x of [p, firer]) {
              if (!x || !isHidden(x)) continue;
              if (gun(ctx, x)) reveal(ctx, x.id, 'fire');
              else if (mmc(ctx, x) || smc(ctx, x)) revealUnit(ctx, x.id, 'fire');
            }
          }
        },
      });

    // ---------------------------------------------------------------- the MPh bounce (SK4 6.4)
    r.procedure<MoveEnterFn>(MOVE_ENTER, (next) => (ctx, ms, to, cost, woods, extra) => {
      // Full ASL: a stack bypassing the hex does not find what hides in its building or woods (ASLRB A12.151).
      if (extra?.bypass) {
        next?.(ctx, ms, to, cost, woods, extra);
        return;
      }
      // What hides in the Location entered (ASLRB A12.15: "attempts to move into a Location containing a concealed unit"): a
      // Starter Kit hex is one Location; in full ASL another Location of the hex (a pillbox, B30.43) is not entered.
      const here = (p: Piece) => locOf(ctx.state, p) === to;
      const hex = hexOfLoc(to);
      const guns = hiddenGunsAt(ctx, hex, ctx.state.attacker).filter(here);
      const units = guns.length ? [] : hiddenUnitsAt(ctx, hex, ctx.state.attacker).filter(here);
      if (guns.length === 0 && units.length === 0) {
        next?.(ctx, ms, to, cost, woods, extra);
        return;
      }
      if (guns.length === 0 && ms.vehicle) {
        // A vehicle entering the hex of hidden Infantry finds them and goes on (S23 SSR 1: only Infantry is turned back).
        revealHex(ctx, hex, ctx.state.attacker, 'entered', to);
        next?.(ctx, ms, to, cost, woods, extra);
        return;
      }
      if (guns.length) for (const g of guns) reveal(ctx, g.id, 'entered');
      else revealHex(ctx, hex, ctx.state.attacker, 'entered', to);
      ctx.emit('sk2.hip.bounce', { units: ms.units, hex, gun: guns[0]?.id ?? null });
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
    r.procedure<RoutEnterFn>(ROUT_ENTER, (next) => (ctx, unit, loc) => {
      const p = pieceOf(ctx, unit);
      // Per Location (A12.15), as in the MPh: the rout's node (an upper building level goes with its hex there), not another
      // Location of the hex such as a pillbox (B30.43). A Starter Kit hex is one Location.
      const here = (x: Piece) => {
        const l = locOf(ctx.state, x);
        return l === loc || (!!l && levelOfLoc(l) > 0 && hexOfLoc(l) === loc);
      };
      const hex = hexOfLoc(loc);
      const guns = hiddenGunsAt(ctx, hex, p.side).filter(here);
      if (guns.length === 0 && hiddenUnitsAt(ctx, hex, p.side).filter(here).length === 0) return next?.(ctx, unit, loc) ?? true;
      if (guns.length) for (const g of guns) reveal(ctx, g.id, 'entered');
      else revealHex(ctx, hex, p.side, 'entered', loc);
      return false;
    });
    r.on<{ id: PieceId; loc: { kind: string; hex?: HexId } }>({
      id: 'sk2.hip.advanced',
      event: 'piece.moved',
      handler(ctx, ev) {
        if (ctx.state.phase !== 'APh' || ev.payload.loc.kind !== 'hex' || !ev.payload.loc.hex) return;
        const p = ctx.state.pieces[ev.payload.id];
        if (!p || !(mmc(ctx, p) || smc(ctx, p))) return;
        // The Location advanced into (A12.15; a Starter Kit hex is one Location).
        const to = locOf(ctx.state, p);
        const here = (x: Piece) => locOf(ctx.state, x) === to;
        const guns = hiddenGunsAt(ctx, ev.payload.loc.hex, p.side).filter(here);
        const units = guns.length ? [] : hiddenUnitsAt(ctx, ev.payload.loc.hex, p.side).filter(here);
        if (guns.length === 0 && units.length === 0) return;
        if (guns.length) for (const g of guns) reveal(ctx, g.id, 'advanced');
        else revealHex(ctx, ev.payload.loc.hex, p.side, 'advanced', to ?? undefined);
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
    // Small arms vs a hex whose enemies the firer cannot see: Area Fire, half FP (one or two columns down). Only hidden
    // units: a concealed one is out of sight too, but its "?" is on the board and concealment halves that fire itself
    // (SK4 8.3.2); halving it here as well would quarter it.
    r.procedure<ApplyResultFn>(FP.applyResult, (next) => (ctx, attack, column, baseFinal, out) => {
      const hidden = attack.targets.filter((u) => isHidden(pieceOf(ctx, u)) && !isVisibleTo(ctx, pieceOf(ctx, u), attack.side) && ctx.query('hip.areaFire', { attack, unit: u }, true));
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
      // An empty hex as far as the firer can tell: nothing there but hidden units. A concealed stack's "?" is on the
      // board, and its +2 is concealment's own (SK4 8.3.2); the chart has one case for both, so they never stack.
      when: (sc, env) => !sc.moving && unitsAt(env, sc.target, otherSide(env.state, sc.side)).every(isHidden),
      apply: (v) => v + 2,
    });

    // The ext slot records nothing yet; kept for the client to find a reveal log if needed.
  },
};
