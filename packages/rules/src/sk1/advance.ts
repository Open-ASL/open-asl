declare module '@asl/engine' {
  interface QueryCatalog {
    /** Why these units may not advance into `to` beyond the base rules, or null (PTO: a CX unit into bamboo). */
    'advance.illegal': { ctx: { units: PieceId[]; to: LocId; side: SideId }; value: string | null };
    /**
     * Why these units may not advance off the map into offboard hex `to` (ASLRB A2.6: units leave the mapboard "using
     * normal MPh/APh capabilities"; SK4 3.3: only Good Order units exiting as part of the VC). The scenario rules answer.
     */
    'advance.exitIllegal': { ctx: { units: PieceId[]; to: HexId; side: SideId }; value: string | null };
    /** Why a unit may not advance in the APh (SK2: manhandlers, Gun possessors), or null. */
    'unit.cannotAdvance': { ctx: { unit: PieceId }; value: string | null };
  }
}

import type { Action, Ctx, HexId, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, hexOf, otherSide, personnelAt, statics, unitsAt, vehiclesAt } from '../common/pieces';
import { LEVEL_CHANGE_MF, adjacentLocs, hexOfLoc, isGroundLoc, locExists, locKey, locOf, locationAt, type LocId } from '../common/location';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import { T, actionIllegal, isCx, isGoodOrder, isPinned, mmc, pieceOf, restack, setTags, smc, squadEquivalents } from './status';
import { stackLimit } from './movement';
import { inPlay } from './terrain';

/** `to`: the ADJACENT Location advanced into (ASLRB A4.7, A.8; a hex id at ground level). */
export type AdvanceAction = Action & { units: PieceId[]; to: LocId };

export const AP = {
  /** (ctx, action) => void: move the advancing units (the vehicle rules put the PAATC in front). */
  enter: 'sk1.advance.enter',
  /** (ctx, units, to) => void: the units advance off the map into offboard hex `to` (the scenario rules exit them). */
  exit: 'sk1.advance.exit',
  /**
   * (ctx, unit, vehicle, reason) => passed: the Pre-AFV Advance/Attack Task Check an MMC takes before
   * advancing into, placing a DC on, or Reaction Firing at an enemy AFV (SK4 3.7). Always passes
   * until the vehicle rules are installed (there are no AFV to check for without them).
   */
  paatc: 'sk1.paatc',
} as const;
export type AdvanceEnterFn = (ctx: Ctx, a: AdvanceAction) => void;
export type AdvanceExitFn = (ctx: Ctx, units: PieceId[], to: HexId) => void;

/** The offboard hexes beyond an edge hex: where a unit standing in it would leave the map. */
const offboardBeyond = (env: QueryEnv, hex: HexId): HexId[] => {
  const map = statics(env).map;
  return map.offboard('N,E,S,W').filter((o) => map.offboardNeighbors(o.id).onboard.includes(hex)).map((o) => o.id);
};
export type PaatcFn = (ctx: Ctx, unit: PieceId, vehicle: PieceId, reason: 'advance' | 'dc' | 'reactionFire') => boolean;

function advanceIllegal(env: QueryEnv, a: { units: PieceId[]; to: LocId; side: string }): string | null {
  if (env.state.phase !== 'APh') return 'Not the Advance Phase';
  if (a.units.length === 0) return 'Select units to advance';
  const map = statics(env).map;
  // Off the map from an edge hex (ASLRB A2.6): the scenario's exit rules decide.
  if (map.offboardHex(a.to) && !map.hex(a.to)) {
    for (const id of a.units) {
      const p = env.state.pieces[id];
      if (!p || p.side !== a.side || p.side !== env.state.attacker) return `${id} is not yours`;
      if (p.loc.kind !== 'hex') return `${id} is not on the map`;
      if (!offboardBeyond(env, p.loc.hex).includes(a.to)) return 'Advance is one hex';
      if (!mmc(env, p) && !smc(env, p)) return `${id} is not Infantry`;
      if (!isGoodOrder(env, p) || isPinned(p)) return `${id} must be Good Order and unpinned`;
      if (p.tags['advanced']) return `${id} already advanced`;
      const why = env.query('unit.cannotAdvance', { unit: id }, null);
      if (why) return `${id}: ${why}`;
    }
    if (new Set(a.units.map((u) => locOf(env.state, pieceOf(env, u)))).size > 1) return 'Units advancing together must start together';
    return actionIllegal(env, a.units) ?? env.query('advance.exitIllegal', { units: a.units, to: a.to, side: a.side }, 'Units may not leave the map');
  }
  if (!locExists(env, a.to)) return 'No such hex';
  const toHex = hexOfLoc(a.to);
  if (!inPlay(env, toHex)) return 'That hex is not in play';
  const froms = new Set<string>();
  for (const id of a.units) {
    const p = env.state.pieces[id];
    if (!p || p.side !== a.side || p.side !== env.state.attacker) return `${id} is not yours`;
    if (!mmc(env, p) && !smc(env, p)) return `${id} is not Infantry`;
    if (!isGoodOrder(env, p) || isPinned(p)) return `${id} must be Good Order and unpinned`;
    const why = env.query('unit.cannotAdvance', { unit: id }, null);
    if (why) return `${id}: ${why}`;
    if (p.tags['advanced']) return `${id} already advanced`;
    if (p.loc.kind === 'offboard') {
      // Units set up offboard may enter in the APh of their turn of entry (SK1 3.3).
      const edge = p.loc.edge ?? (p.tags['entryEdge'] as string | undefined);
      if (!p.loc.hex || (p.tags['entryTurn'] as number | undefined ?? Infinity) > env.state.turn) return `${id} cannot enter now`;
      if (!edge || !isGroundLoc(a.to) || !map.edge(edge).includes(a.to) || !map.offboardNeighbors(p.loc.hex).onboard.includes(a.to))
        return `${id} must enter beside its offboard hex`;
      froms.add(`off:${p.loc.hex}`);
      continue;
    }
    const h = locOf(env.state, p);
    if (!h) return `${id} is not on the map`;
    if (!adjacentLocs(env, h).includes(a.to)) return 'Advance is one hex';
    froms.add(h);
  }
  if (froms.size > 1) return 'Units advancing together must start together';
  // MF check: must have the MF; advancing with all MF forces CX; CX units cannot do so.
  for (const id of a.units) {
    const p = pieceOf(env, id);
    const mf = env.query('unit.mf', { unit: id, stack: a.units, doubleTime: false }, 0);
    const from = hexOf(env.state, p);
    // Up or down the stairs of its own hex: one MF (full ASL, ASLRB B23.4; never in the Starter Kit).
    const cost = from === toHex ? LEVEL_CHANGE_MF : env.query('move.cost', { unit: id, from, to: toHex, viaRoad: false, ...(isGroundLoc(a.to) ? {} : { loc: a.to }) }, 1);
    if (cost >= mf && isCx(p)) return `${id} is CX and cannot advance into a hex costing all its MF`;
  }
  // Stacking limits.
  const here = personnelAt(env, a.to, a.side).filter((p) => !a.units.includes(p.id));
  const all = [...here, ...a.units.map((u) => pieceOf(env, u))];
  const se = squadEquivalents(env, all);
  const limit = stackLimit(env, a.to, a.side);
  if (se > limit.se) return `Stacking limit: ${limit.se} squad-equivalents`;
  if (all.filter((p) => smc(env, p)).length > limit.smc) return `Stacking limit: ${limit.smc} SMC`;
  return actionIllegal(env, a.units) ?? env.query('advance.illegal', { units: a.units, to: a.to, side: a.side }, null);
}

export const advanceModule: RuleModule = {
  id: 'sk1.advance',
  ref: 'SK1 3.7',
  summary: 'Advance Phase: one-hex advance (into enemy hexes too), CX when using all MF, SW transfer.',
  requires: ['sk1.movement', 'common.turn'],
  install(r) {
    r.procedure<PaatcFn>(AP.paatc, () => () => true);
    r.procedure<AdvanceEnterFn>(AP.enter, () => (ctx, a) => advanceEnter(ctx, a));
    r.procedure<AdvanceExitFn>(AP.exit, () => () => {});
    r.on<{ phase: string }>({
      id: 'sk1.advance.start',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        if (ev.payload.phase === 'APh') askPhaseOwner(ctx, ctx.state.attacker);
      },
    });
    r.on<{ phase: string }>({
      id: 'sk1.advance.end',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'APh') return;
        for (const p of Object.values(ctx.state.pieces).filter((x) => x.tags['advanced']).sort(byId)) {
          setTags(ctx, p.id, { advanced: null });
        }
        // Units due to enter that never did are eliminated (SK1 3.3).
        for (const p of Object.values(ctx.state.pieces)
          .filter((x) => x.side === ctx.state.attacker && x.loc.kind === 'offboard' && x.tags['entryTurn'] === ctx.state.turn)
          .sort(byId)) {
          ctx.emit('piece.eliminated', { id: p.id, reason: 'failed to enter' });
        }
      },
    });

    r.action<AdvanceAction>({
      type: 'advance',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        if (env.state.phase !== 'APh') return [];
        const side = env.state.attacker;
        const out: { type: 'advance'; units: PieceId[]; to: LocId }[] = [];
        // Stacks by Location; each may advance into an ADJACENT Location.
        const byHex = new Map<LocId, PieceId[]>();
        for (const p of Object.values(env.state.pieces).sort(byId)) {
          if (p.side !== side || p.loc.kind !== 'hex' || !(mmc(env, p) || smc(env, p)) || p.tags['advanced']) continue;
          if (!isGoodOrder(env, p) || isPinned(p)) continue;
          const loc = locKey(p.loc);
          byHex.set(loc, [...(byHex.get(loc) ?? []), p.id]);
        }
        // Offboard units that may still enter this turn.
        const offStacks = new Map<HexId, PieceId[]>();
        for (const p of Object.values(env.state.pieces).sort(byId)) {
          if (p.side !== side || p.loc.kind !== 'offboard' || !p.loc.hex || p.tags['advanced'] || !(mmc(env, p) || smc(env, p))) continue;
          if ((p.tags['entryTurn'] as number | undefined ?? Infinity) > env.state.turn) continue;
          offStacks.set(p.loc.hex, [...(offStacks.get(p.loc.hex) ?? []), p.id]);
        }
        const stacks: [HexId, PieceId[], HexId[]][] = [
          ...[...byHex].map(([h, ids]) => [h, ids, [...adjacentLocs(env, h), ...(isGroundLoc(h) ? offboardBeyond(env, h) : [])]] as [HexId, PieceId[], HexId[]]),
          ...[...offStacks].map(([h, ids]) => [h, ids, statics(env).map.offboardNeighbors(h).onboard] as [HexId, PieceId[], HexId[]]),
        ];
        for (const [, ids, near] of stacks) {
          for (const n of [...near].sort()) {
            for (const units of ids.length > 1 ? [ids, ...ids.map((i) => [i])] : [ids]) {
              if (!advanceIllegal(env, { units, to: n, side })) out.push({ type: 'advance', units, to: n });
            }
          }
        }
        return out;
      },
      validate: (env, a) => advanceIllegal(env, a),
      resolve(ctx, a) {
        ctx.proc<AdvanceEnterFn>(AP.enter)(ctx, a);
      },
    });
  },
};

/** Move the advancing units: MMC first pass a PAATC when an enemy AFV holds the hex (SK4 3.7), the rest advance. */
function advanceEnter(ctx: Ctx, a: AdvanceAction) {
  const map = statics(ctx).map;
  if (map.offboardHex(a.to) && !map.hex(a.to)) {
    for (const id of a.units) setTags(ctx, id, { advanced: true });
    ctx.proc<AdvanceExitFn>(AP.exit)(ctx, [...a.units].sort(), a.to);
    ctx.popDecision();
    askPhaseOwner(ctx, ctx.state.attacker);
    return;
  }
  const enemy = otherSide(ctx.state, a.side);
  const afv = vehiclesAt(ctx, a.to, enemy, true)[0];
  // Each MMC rolls in turn and, passing, must enter; a failure pins it where it stands (the leader may still advance).
  const units = a.units.filter((id) => !(afv && mmc(ctx, pieceOf(ctx, id))) || ctx.proc<PaatcFn>(AP.paatc)(ctx, id, afv.id, 'advance'));
  if (units.length === 0) {
    ctx.popDecision();
    askPhaseOwner(ctx, ctx.state.attacker);
    return;
  }
  const enemyThere = unitsAt(ctx, a.to, enemy).length > 0;
  // Advancing into an enemy-occupied hex starts a Close Combat there: the CC counter goes on
  // at once (unless the hex is already in Melee, which the advancing units simply join).
  if (enemyThere && !ctx.state.hexMarkers[a.to]?.['melee'] && !ctx.state.hexMarkers[a.to]?.['cc']) {
    ctx.emit('hex.marker', { hex: a.to, key: 'cc', value: true });
  }
  restack(ctx, units);
  for (const id of [...units].sort()) {
    const p = pieceOf(ctx, id);
    const mf = ctx.query('unit.mf', { unit: id, stack: units, doubleTime: false }, 0);
    const cost = ctx.query('move.cost', { unit: id, from: hexOf(ctx.state, p), to: hexOfLoc(a.to), viaRoad: false, ...(isGroundLoc(a.to) ? {} : { loc: a.to }) }, 1);
    ctx.emit('piece.moved', { id, loc: locationAt(a.to) });
    setTags(ctx, id, {
      advanced: true,
      ...(cost >= mf ? { [T.cx]: true } : {}),
      ...(enemyThere ? { [T.advancedInto]: a.to } : {}),
    });
  }
  ctx.popDecision();
  askPhaseOwner(ctx, ctx.state.attacker);
}
