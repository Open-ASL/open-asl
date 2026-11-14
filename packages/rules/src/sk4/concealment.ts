import type { Action, Ctx, Decision, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, hexOf, isVehicleDef, otherSide, personnelAt, statics, swHeldBy, unitsAt } from '../common/pieces';
import { hexOfLoc, locKey, locOf, type LocId } from '../common/location';
import { UNKNOWN_DEF_ID } from '../common/statics';
import { PHASE_DECISION, PHASE_DONE, type PhaseDoneFn } from '../common/turn';
import { FP, iftColumn, type ApplyResultFn, type FireMode } from '../sk1/fire';
import { hasLos, isVisibleTo, knownEnemyAt } from '../sk1/known';
import { MOVE_ENTER, moveInternals, moveState, type MoveEnterFn } from '../sk1/movement';
import { P as MP, type CasualtyFn, type UnitFn } from '../sk1/morale';
import { ROUT_ENTER, ROUT_START_SIDE, type RoutEnterFn, type RoutStartSideFn } from '../sk1/rout';
import { OFFBOARD_SETUP_DECISION, SETUP_PLACED, type SetupAction, type SetupPlacedFn } from '../sk1/scenario';
import { gun, isBroken, isGoodOrder, mmc, pieceOf, setTags, smc, sw } from '../sk1/status';
import { isWoodsRoad, terrainOf } from '../sk1/terrain';
import { REVEAL_GUN } from '../sk2/guns';
import { revealHex } from '../sk2/hip';
import { isEmplaced, isHidden } from '../sk2/status';
import { PTO_TERRAIN_MODULE } from './pto';
import { T4, concealedAt, isConcealed } from './status';

export const CONCEALMENT_MODULE = 'concealment';
/** The RtPh offer to a side with concealed units in LOS of an enemy broken unit: drop the "?" now, or keep it (SK4 8.3.4). */
export const CONCEAL_RTPH_DECISION = 'concealRtPh';
const EXT = 'sk4.concealment';

interface ConcealmentState {
  /** OB concealment counters each side has used at setup (SK4 8.3: "one (only) concealment counter" per stack). */
  obUsed: Record<SideId, number>;
  /** The rout step ("turn:attacker:side") whose 8.3.4 offer has been made, so it is asked once. */
  rtphOffered?: string;
}

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Whether a Location is Concealment Terrain (SK4 8.3: jungle, palm trees, kunai, bamboo, huts, buildings). */
    'hex.concealmentTerrain': { ctx: { hex: HexId }; value: boolean };
  }
}

/** Concealment is in play: PTO Terrain is in effect, or the card says so by SSR (SK4 8.3). */
export const concealmentActive = (env: QueryEnv) => statics(env).scenario.ssr.some((s) => s.module === PTO_TERRAIN_MODULE || s.module === CONCEALMENT_MODULE);

const isInfantry = (env: QueryEnv, p: Piece) => !!mmc(env, p) || !!smc(env, p);
const stateOf = (env: QueryEnv): ConcealmentState => (env.state.ext[EXT] as ConcealmentState | undefined) ?? { obUsed: {} };

/**
 * Enemies of `side` whose LOS to `hex` denies or costs Concealment: non-HIP enemy ground units in Good Order (loss, SK4
 * 8.3) or merely unbroken (gain, 8.3.1). Vehicles count as Known Enemy Units (SK4 glossary) unless wrecked.
 */
export function enemyLosTo(env: QueryEnv, hex: LocId, side: SideId, who: 'goodOrder' | 'unbroken'): Piece[] {
  const enemy = otherSide(env.state, side);
  return Object.values(env.state.pieces)
    .filter((e) => {
      if (e.side !== enemy || e.loc.kind !== 'hex' || isHidden(e)) return false;
      if (isInfantry(env, e)) {
        if (isBroken(e)) return false;
        if (who === 'goodOrder' && !isGoodOrder(env, e)) return false;
      } else if (!isVehicleDef(defOf(env, e)) || e.tags['wreck'] === true) return false;
      return hasLos(env, locKey(e.loc), hex);
    })
    .sort(byId);
}

/** A unit with the Gun it mans (8.3.3: "Guns share the concealment status of their manning Infantry"). */
const withGun = (env: QueryEnv, unit: PieceId): PieceId[] => [unit, ...swHeldBy(env.state, unit).filter((w) => gun(env, w)).map((w) => w.id)];

/** The "?" comes off these units (and the Guns they man). `ifSeen`: only when a Good Order enemy has a LOS to one of those hexes. */
export function dropConcealment(ctx: Ctx, units: PieceId[], reason: string, ifSeen?: HexId[]) {
  const dropping = [...new Set(units)].map((u) => ctx.state.pieces[u]).filter((p): p is Piece => !!p && isConcealed(p) && isInfantry(ctx, p));
  if (dropping.length === 0) return;
  if (ifSeen && !ifSeen.some((h) => enemyLosTo(ctx, h, dropping[0]!.side, 'goodOrder').length > 0)) return;
  const byHex = new Map<string, PieceId[]>();
  for (const p of dropping) {
    const hex = hexOf(ctx.state, p) ?? '';
    byHex.set(hex, [...(byHex.get(hex) ?? []), p.id]);
    for (const id of withGun(ctx, p.id)) if (isConcealed(pieceOf(ctx, id))) setTags(ctx, id, { [T4.concealed]: null });
  }
  for (const [hex, ids] of byHex) ctx.emit('sk4.concealment.lost', { units: ids, hex, side: dropping[0]!.side, reason });
}

/** The "?" goes on these units and the Guns they man. */
export function gainConcealment(ctx: Ctx, units: PieceId[], reason: string) {
  const gaining = [...new Set(units)].map((u) => ctx.state.pieces[u]).filter((p): p is Piece => !!p && !isConcealed(p) && isInfantry(ctx, p));
  if (gaining.length === 0) return;
  const byHex = new Map<string, PieceId[]>();
  for (const p of gaining) {
    const hex = hexOf(ctx.state, p) ?? (p.loc.kind === 'offboard' ? (p.loc.hex ?? '') : '');
    byHex.set(hex, [...(byHex.get(hex) ?? []), p.id]);
    for (const id of withGun(ctx, p.id)) setTags(ctx, id, { [T4.concealed]: true });
  }
  for (const [hex, ids] of byHex) ctx.emit('sk4.concealment.gained', { units: ids, hex, side: gaining[0]!.side, reason });
}

const isConcealmentTerrain = (env: QueryEnv, hex: HexId) => env.query('hex.concealmentTerrain', { hex }, !!terrainOf(env, hex).concealment);

/** Open Ground for Interdiction purposes (SK1 3.6): the hex's terrain, or a Woods-Road entered along its road. */
const openForInterdiction = (env: QueryEnv, hex: HexId, viaRoad: boolean) => env.query('hex.openGround', { hex }, false) || (viaRoad && isWoodsRoad(env, hex));

export type ConcealAction = Action & { type: 'conceal.drop'; units: PieceId[] };

/**
 * Concealment (SK4 8.3): a "?" on an Infantry stack hides its contents from the enemy and makes attacks on it Area Fire
 * (+2 To Hit for ordnance), at the price of coming off whenever the stack fires, moves in the open, is hit, and so on.
 * The tag `concealed` sits on each concealed unit (and the Gun it mans); the counter the board shows is the side's
 * concealed subset of a hex. In play only when PTO Terrain is in effect or the card says so by SSR.
 */
export const concealmentModule: RuleModule = {
  id: 'sk4.concealment',
  ref: 'SK4 8.3',
  summary: 'Concealment counters: setup under "?", loss by acting in enemy LOS, gain at the end of the Player Turn, Area Fire and ambush effects.',
  requires: ['sk1.scenario', 'sk1.fire', 'sk1.movement', 'sk1.rout', 'sk1.advance', 'sk1.cc', 'sk2.guns', 'sk2.hip', 'sk2.ordnance'],
  install(r) {
    r.event<{ units: PieceId[]; hex: string; side: SideId; reason: string }>({ type: 'sk4.concealment.gained', apply() {} });
    r.event<{ units: PieceId[]; hex: string; side: SideId; reason: string }>({ type: 'sk4.concealment.lost', apply() {} });
    r.event<{ units: PieceId[]; hex: HexId; side: SideId }>({ type: 'sk4.concealment.bounce', apply() {} });
    r.event<{ state: ConcealmentState }>({
      type: 'sk4.concealment.state',
      apply(d, p) {
        d.ext[EXT] = p.state;
      },
    });
    r.redact({ id: 'sk4.concealment.redact', ext: EXT, redactExt: () => undefined });
    // The module listens for the optional bookkeeping events (leader lending, Smoke and DC attempts): record them.
    r.contribute({ id: 'sk4.concealment.events', query: 'events.optional', apply: () => true });

    // ---------------------------------------------------------------- what the enemy sees: a "?" counter, nothing else
    r.contribute({
      id: 'sk4.concealment.visible',
      query: 'piece.visibleTo',
      layer: 1,
      apply(v, { piece, viewer }, env) {
        const p = env.state.pieces[piece];
        if (!v || !p || !isConcealed(p) || viewer === p.side || !concealmentActive(env)) return v;
        return false;
      },
    });
    r.contribute({
      id: 'sk4.concealment.standIn',
      query: 'piece.standIn',
      apply(v, { piece, viewer }, env) {
        const p = env.state.pieces[piece];
        if (!p || !isConcealed(p) || viewer === p.side || !isInfantry(env, p) || p.loc.kind !== 'hex' || !concealmentActive(env)) return v;
        // One stand-in per concealed stack of a side in a hex; 5/8" when a Gun is in it (8.3.3). It tells how many
        // counters lie under the "?" (the units and the weapons they hold): at the table the stack's height is plain to
        // see, only what the counters are is hidden (8.3, ASLRB A12.1).
        const stack = concealedAt(env, locOf(env.state, p)!, p.side).filter((q) => isInfantry(env, q));
        const big = stack.some((q) => swHeldBy(env.state, q.id).some((w) => gun(env, w)));
        const counters = stack.reduce((n, q) => n + 1 + swHeldBy(env.state, q.id).length, 0);
        return { id: `?:${p.side}:${locOf(env.state, p)!}`, defId: UNKNOWN_DEF_ID, side: p.side, loc: p.loc, tags: { [T4.concealed]: true, counters, ...(big ? { big: true } : {}) } };
      },
    });
    r.contribute({
      id: 'sk4.concealment.known',
      query: 'piece.knownTo',
      apply(v, { piece, viewer }, env) {
        const p = env.state.pieces[piece];
        return p && isConcealed(p) && viewer !== p.side && concealmentActive(env) ? false : v;
      },
    });
    r.contribute({ id: 'sk4.concealment.terrain', query: 'hex.concealmentTerrain', layer: 0, apply: (_v, { hex }, env) => !!terrainOf(env, hex).concealment });

    // ---------------------------------------------------------------- setup (SK4 8.3)
    const obBudget = (env: QueryEnv, side: SideId) => statics(env).scenario.forces.filter((f) => f.side === side).reduce((n, f) => n + (f.concealment ?? 0), 0);
    r.contribute({
      id: 'sk4.concealment.setup',
      query: 'setup.illegal',
      apply(v, { side, todo, action }, env) {
        if (v || !concealmentActive(env)) return v;
        const a = action as SetupAction;
        const chosen = a.concealed ?? [];
        if (chosen.length === 0) return null;
        const hexes = new Set<HexId>();
        for (const id of chosen) {
          if (!todo.includes(id)) return `${id} is not being set up`;
          const p = env.state.pieces[id];
          const loc = a.placements[id];
          if (!p || !loc) return `${id} must be placed to set up concealed`;
          if (!isInfantry(env, p)) return 'Only Infantry may be concealed (SK4 8.3)';
          const hex = hexOfLoc(loc);
          if (!statics(env).map.hex(hex)) return 'Units entering from offboard are concealed as they enter';
          if (!isConcealmentTerrain(env, hex)) return `${hex} is not Concealment Terrain (SK4 8.3): no OB concealment counter may be placed there`;
          hexes.add(hex);
        }
        const left = obBudget(env, side) - (stateOf(env).obUsed[side] ?? 0);
        if (hexes.size > left) return `The OB gives ${left} concealment counter${left === 1 ? '' : 's'} (one per stack); ${hexes.size} stacks chosen`;
        return null;
      },
    });
    r.procedure<SetupPlacedFn>(SETUP_PLACED, (next) => (ctx, action, decision: Decision) => {
      next?.(ctx, action, decision);
      if (!concealmentActive(ctx)) return;
      if (decision.kind === OFFBOARD_SETUP_DECISION) {
        // "Reinforcements entering the board may always set up concealed."
        const entering = Object.keys(action.placements).filter((id) => ctx.state.pieces[id] && isInfantry(ctx, pieceOf(ctx, id)) && pieceOf(ctx, id).loc.kind === 'offboard');
        gainConcealment(ctx, entering, 'reinforcement');
        return;
      }
      const chosen = (action.concealed ?? []).filter((id) => ctx.state.pieces[id]);
      if (chosen.length === 0) return;
      const hexes = new Set(chosen.map((id) => hexOf(ctx.state, pieceOf(ctx, id))!));
      const st = stateOf(ctx);
      ctx.emit('sk4.concealment.state', { state: { obUsed: { ...st.obUsed, [decision.owner]: (st.obUsed[decision.owner] ?? 0) + hexes.size } } });
      gainConcealment(ctx, chosen, 'setup');
    });
    // "after all setup, no enemy unit has a LOS to it" (and so every unit when the enemy sets up nothing on board).
    const concealUnseen = (ctx: Ctx) => {
      if (!concealmentActive(ctx)) return;
      for (const side of ctx.state.sides) {
        const enemy = otherSide(ctx.state, side);
        const unseen = Object.values(ctx.state.pieces)
          .filter((p) => p.side === side && p.loc.kind === 'hex' && isInfantry(ctx, p) && !isConcealed(p) && !isHidden(p))
          .filter((p) => !Object.values(ctx.state.pieces).some((e) => e.side === enemy && e.loc.kind === 'hex' && (isInfantry(ctx, e) || isVehicleDef(defOf(ctx, e))) && hasLos(ctx, locOf(ctx.state, e)!, locOf(ctx.state, p)!)))
          .map((p) => p.id);
        gainConcealment(ctx, unseen, 'setup-unseen');
      }
    };
    r.procedure<(c: Ctx) => void>('sk1.scenario.begin', (next) => (ctx) => {
      concealUnseen(ctx);
      next?.(ctx);
    });
    // A scenario whose every unit sets up in fixed hexes has no setup decision, so play starts from the turn
    // module's own start hook and never reaches `sk1.scenario.begin`: its setup ends here, before that hook.
    r.setup({
      id: 'sk4.concealment.fixedSetup',
      priority: 999,
      run(ctx) {
        if (ctx.state.decisions.length === 0) concealUnseen(ctx);
      },
    });

    // ---------------------------------------------------------------- loss in the LOS of a non-HIP Good Order enemy
    const firerOf = (env: QueryEnv, id: PieceId): PieceId => {
      const p = env.state.pieces[id];
      return p && p.loc.kind === 'held' ? p.loc.by : id;
    };
    const hexesOf = (env: QueryEnv, ids: PieceId[]): HexId[] => [...new Set(ids.map((id) => env.state.pieces[id] && hexOf(env.state, pieceOf(env, id))).filter((h): h is HexId => !!h))];
    const firedHandler = (ctx: Ctx, parts: PieceId[], directors: PieceId[]) => {
      if (!concealmentActive(ctx)) return;
      const units = [...new Set([...parts.map((id) => firerOf(ctx, id)), ...directors])];
      dropConcealment(ctx, units, 'fire', hexesOf(ctx, units));
    };
    for (const event of ['sk1.fire.attack', 'sk1.fire.noLos'])
      r.on<{ attack: { parts: PieceId[]; directors?: PieceId[] } }>({ id: `sk4.concealment.${event}`, event, handler: (ctx, ev) => firedHandler(ctx, ev.payload.attack.parts, ev.payload.attack.directors ?? []) });
    for (const event of ['sk2.ordnance.shot', 'sk2.ordnance.noLos'])
      r.on<{ weapon: PieceId; firer: PieceId; director?: PieceId; dr: [number, number] }>({
        id: `sk4.concealment.${event}`,
        event,
        handler(ctx, ev) {
          if (!concealmentActive(ctx)) return;
          const g = ctx.state.pieces[ev.payload.weapon];
          // A HIP Emplaced Gun placed on board concealed by its shot keeps the "?" unless the colored dr is 5 or 6 (8.3.3).
          if (g?.tags[T4.hipFired] === true) {
            setTags(ctx, g.id, { [T4.hipFired]: null });
            if (ev.payload.dr[1] < 5) {
              if (ev.payload.director !== undefined) dropConcealment(ctx, [ev.payload.director], 'fire', hexesOf(ctx, [ev.payload.director]));
              return;
            }
          }
          const units = [ev.payload.firer, ...(ev.payload.director !== undefined ? [ev.payload.director] : [])];
          dropConcealment(ctx, units, 'fire', hexesOf(ctx, units));
        },
      });
    // Any result on the IFT (KIA, K, MC, PTC) takes the "?" off before the check is rolled.
    r.on<{ unit: PieceId; result: { kind: string } }>({
      id: 'sk4.concealment.hit',
      event: 'sk1.fire.result',
      handler(ctx, ev) {
        if (!concealmentActive(ctx) || ev.payload.result.kind === 'none') return;
        dropConcealment(ctx, [ev.payload.unit], 'hit', hexesOf(ctx, [ev.payload.unit]));
      },
    });
    r.on<{ unit: PieceId; target: HexId; dr: number; placed: boolean }>({ id: 'sk4.concealment.smoke', event: 'sk1.move.smoke', handler: (ctx, ev) => concealmentActive(ctx) && dropConcealment(ctx, [ev.payload.unit], 'smoke', hexesOf(ctx, [ev.payload.unit])) });
    r.on<{ dc: PieceId; placer: PieceId; target: LocId }>({
      id: 'sk4.concealment.dc',
      event: 'sk1.move.dcAttempt',
      handler(ctx, ev) {
        if (!concealmentActive(ctx)) return;
        // A DC placed against a concealed stack attacks it as Area Fire even once the attempt has made it drop its "?" (8.3.2).
        if (concealedAt(ctx, ev.payload.target, otherSide(ctx.state, pieceOf(ctx, ev.payload.placer).side)).length) setTags(ctx, ev.payload.dc, { [T4.dcVsConcealed]: true });
        dropConcealment(ctx, [ev.payload.placer], 'dc', hexesOf(ctx, [ev.payload.placer]));
      },
    });
    r.on<{ gun: PieceId; reason: string }>({
      id: 'sk4.concealment.ca',
      event: 'sk2.gun.ca',
      handler(ctx, ev) {
        if (!concealmentActive(ctx) || ev.payload.reason === 'setup') return;
        const g = ctx.state.pieces[ev.payload.gun];
        const manner = g && g.loc.kind === 'held' ? g.loc.by : null;
        if (manner) dropConcealment(ctx, [manner], 'ca', hexesOf(ctx, [manner]));
      },
    });
    // Transferring or recovering a SW/Gun: the new possessor (the giver's loss is deferred: the event names only the receiver).
    r.on<{ id: PieceId; loc: { kind: string; by?: PieceId } }>({
      id: 'sk4.concealment.transfer',
      event: 'piece.moved',
      handler(ctx, ev) {
        if (!concealmentActive(ctx) || ctx.state.phase === 'setup' || ev.payload.loc.kind !== 'held' || !ev.payload.loc.by) return;
        const w = ctx.state.pieces[ev.payload.id];
        if (!w || !(sw(ctx, w) || gun(ctx, w))) return;
        dropConcealment(ctx, [ev.payload.loc.by], 'transfer', hexesOf(ctx, [ev.payload.loc.by]));
      },
    });
    r.on<{ id: PieceId; reason?: string }>({
      id: 'sk4.concealment.deploy',
      event: 'piece.replaced',
      handler(ctx, ev) {
        if (!concealmentActive(ctx) || ctx.state.phase === 'setup' || (ev.payload.reason !== 'deploy' && ev.payload.reason !== 'recombine')) return;
        dropConcealment(ctx, [ev.payload.id], ev.payload.reason, hexesOf(ctx, [ev.payload.id]));
      },
    });
    // A leader using his modifier: rallying, lending his DRM to a MC (fire direction is covered with the shot).
    r.on<{ unit: PieceId; kind: string; leader?: PieceId | null }>({
      id: 'sk4.concealment.rally-leader',
      event: 'sk1.check',
      handler(ctx, ev) {
        if (!concealmentActive(ctx) || ev.payload.kind !== 'rally' || !ev.payload.leader) return;
        dropConcealment(ctx, [ev.payload.leader], 'leadership', hexesOf(ctx, [ev.payload.leader]));
      },
    });
    r.on<{ leader: PieceId; to: PieceId }>({ id: 'sk4.concealment.lent', event: 'sk1.morale.lent', handler: (ctx, ev) => concealmentActive(ctx) && dropConcealment(ctx, [ev.payload.leader], 'leadership', hexesOf(ctx, [ev.payload.leader])) });

    // ---------------------------------------------------------------- movement (8.3, 8.3.2)
    r.procedure<MoveEnterFn>(MOVE_ENTER, (next) => (ctx, ms, to, cost, woods) => {
      if (!concealmentActive(ctx)) return next?.(ctx, ms, to, cost, woods);
      const toHex = hexOfLoc(to);
      const enemy = otherSide(ctx.state, ctx.state.attacker);
      const hidden = concealedAt(ctx, to, enemy).filter((p) => isInfantry(ctx, p));
      if (hidden.length && knownEnemyAt(ctx, to, ctx.state.attacker).length === 0) {
        // "A unit or stack in its MPh may attempt to enter a hex that contains only a concealed stack": both "?" go. An AFV
        // enters normally; Infantry stop where they are, having spent the entry MF there (attacked by Residual FP again).
        dropConcealment(ctx, hidden.map((p) => p.id), 'entered');
        dropConcealment(ctx, ms.units, 'entering', ms.hex ? [ms.hex] : undefined);
        revealHex(ctx, toHex, ctx.state.attacker, 'entered');
        if (ms.vehicle) return next?.(ctx, moveState(ctx) ?? ms, to, cost, woods);
        ctx.emit('sk4.concealment.bounce', { units: ms.units, hex: toHex, side: ctx.state.attacker });
        moveInternals.spendInPlace(ctx, moveState(ctx) ?? ms, cost, { halted: true, residualDrmHere: null });
        moveInternals.afterMfExpenditure(ctx);
        const after = moveState(ctx);
        if (after && ctx.state.decisions[ctx.state.decisions.length - 1]?.kind !== 'firstFire') {
          moveInternals.finishStack(ctx);
          moveInternals.reAskMover(ctx);
        }
        return;
      }
      next?.(ctx, ms, to, cost, woods);
      const cur = moveState(ctx);
      if (!cur) return;
      const seenAt = [...(ms.hex ? [ms.hex] : []), toHex];
      if (!cur.assault) dropConcealment(ctx, cur.units, 'moved', seenAt);
      else if (openForInterdiction(ctx, toHex, cur.viaRoad)) dropConcealment(ctx, cur.units, 'open', [toHex]);
    });
    // Advancing into Open Ground in the LOS of a Good Order enemy (8.3.2).
    r.on<{ id: PieceId; loc: { kind: string; hex?: HexId } }>({
      id: 'sk4.concealment.advanced',
      event: 'piece.moved',
      handler(ctx, ev) {
        if (!concealmentActive(ctx) || ctx.state.phase !== 'APh' || ev.payload.loc.kind !== 'hex' || !ev.payload.loc.hex) return;
        const p = ctx.state.pieces[ev.payload.id];
        if (!p || !isInfantry(ctx, p) || !isConcealed(p)) return;
        if (openForInterdiction(ctx, ev.payload.loc.hex, false)) dropConcealment(ctx, [p.id], 'open', [ev.payload.loc.hex]);
      },
    });
    // A router trying to enter a concealed stack's hex: the "?" comes off and the rout ends there (8.3.4).
    r.procedure<RoutEnterFn>(ROUT_ENTER, (next) => (ctx, unit, hex) => {
      if (!concealmentActive(ctx)) return next?.(ctx, unit, hex) ?? true;
      const p = pieceOf(ctx, unit);
      const hidden = concealedAt(ctx, hex, otherSide(ctx.state, p.side)).filter((q) => isInfantry(ctx, q));
      if (hidden.length === 0) return next?.(ctx, unit, hex) ?? true;
      dropConcealment(ctx, hidden.map((q) => q.id), 'entered');
      return false;
    });

    // ---------------------------------------------------------------- loss regardless of LOS: broken, wounded
    r.procedure<UnitFn>(MP.breakUnit, (next) => (ctx, unit, reason) => {
      next?.(ctx, unit, reason);
      if (concealmentActive(ctx) && ctx.state.pieces[unit] && isBroken(pieceOf(ctx, unit))) dropConcealment(ctx, [unit], 'broken');
    });
    r.procedure<CasualtyFn>(MP.casualtyReduce, (next) => (ctx, unit, reason) => {
      const out = next?.(ctx, unit, reason) ?? 'eliminated';
      if (concealmentActive(ctx) && out === 'wounded' && ctx.state.pieces[unit]) dropConcealment(ctx, [unit], 'wounded');
      return out;
    });

    // ---------------------------------------------------------------- voluntarily, at any time
    r.action<ConcealAction>({
      type: 'conceal.drop',
      decisionKinds: ['phase', 'firstFire', 'rofResidual', 'ccDeclare', 'ccArrange', CONCEAL_RTPH_DECISION],
      legal(env, d) {
        if (!concealmentActive(env)) return [];
        const byHex = new Map<string, PieceId[]>();
        for (const p of Object.values(env.state.pieces).filter((q) => q.side === d.owner && isConcealed(q) && isInfantry(env, q) && q.loc.kind === 'hex').sort(byId)) {
          const loc = locOf(env.state, p)!;
          byHex.set(loc, [...(byHex.get(loc) ?? []), p.id]);
        }
        return [...byHex.values()].map((units) => ({ type: 'conceal.drop' as const, units }));
      },
      validate(env, a) {
        if (!concealmentActive(env)) return 'Concealment is not in play';
        if (a.units.length === 0) return 'Choose the units dropping their concealment';
        for (const id of a.units) {
          const p = env.state.pieces[id];
          if (!p || p.side !== a.side) return `${id} is not yours`;
          if (!isConcealed(p)) return `${id} is not concealed`;
        }
        return null;
      },
      resolve(ctx, a, d) {
        dropConcealment(ctx, a.units, 'voluntary');
        if (d.kind === CONCEAL_RTPH_DECISION) finishRtphOffer(ctx, d);
      },
    });
    r.action<Action & { type: 'conceal.keep' }>({
      type: 'conceal.keep',
      decisionKinds: [CONCEAL_RTPH_DECISION],
      legal: () => [{ type: 'conceal.keep' }],
      resolve(ctx, _a, d) {
        finishRtphOffer(ctx, d);
      },
    });
    // The offer lapses as "keep" when the clock runs out; the computer opponent answers it the same way.
    r.autoResolver({ id: 'sk4.concealment.rtph-timeout', decisionKind: CONCEAL_RTPH_DECISION, resolve: (_env, _d, reason) => (reason === 'timeout' ? { type: 'conceal.keep' } : null) });
    // 8.3.4: before a side's rout step begins, the other side may drop the "?" of a concealed unit that sees one of its
    // broken units (to Interdict, or to be a Known Enemy Unit that forces a rout). Asked once per side and step.
    r.procedure<RoutStartSideFn>(ROUT_START_SIDE, (next) => (ctx, side) => {
      if (!concealmentActive(ctx)) return next?.(ctx, side);
      const key = `${ctx.state.turn}:${ctx.state.attacker}:${side}`;
      const st = stateOf(ctx);
      if (st.rtphOffered !== key) {
        const watcher = otherSide(ctx.state, side);
        const broken = Object.values(ctx.state.pieces).filter((p) => p.side === side && p.loc.kind === 'hex' && isInfantry(ctx, p) && isBroken(p));
        const watchers = broken.length
          ? Object.values(ctx.state.pieces).filter((p) => p.side === watcher && p.loc.kind === 'hex' && isInfantry(ctx, p) && isConcealed(p) && broken.some((b) => hasLos(ctx, locOf(ctx.state, p)!, locOf(ctx.state, b)!)))
          : [];
        ctx.emit('sk4.concealment.state', { state: { ...st, rtphOffered: key } });
        if (watchers.length) {
          ctx.pushDecision({ kind: CONCEAL_RTPH_DECISION, owner: watcher, deadlineClass: 'interrupt', data: { units: watchers.map((p) => p.id).sort(), side } });
          return;
        }
      }
      next?.(ctx, side);
    });
    function finishRtphOffer(ctx: Ctx, d: Decision) {
      ctx.popDecision(d.id);
      const side = d.data?.['side'] as SideId;
      ctx.proc<RoutStartSideFn>(ROUT_START_SIDE)(ctx, side);
      // Nobody of that side routs: carry on as if its rout step had ended (the other side's step, then the next phase).
      if (ctx.state.decisions.length === 0) ctx.proc<PhaseDoneFn>(PHASE_DONE)(ctx, { id: 'auto', kind: PHASE_DECISION, owner: side, deadlineClass: 'turn' });
    }

    // ---------------------------------------------------------------- Close Combat (8.3.2; ASLRB A11.19 reading)
    r.on<{ state: { hex?: HexId; step?: string; ambusher?: SideId | null } }>({
      id: 'sk4.concealment.cc',
      event: 'sk1.cc.state',
      handler(ctx, ev) {
        if (!concealmentActive(ctx)) return;
        const st = ev.payload.state;
        if (!st || !st.hex) return;
        const inHex = (side: SideId) => personnelAt(ctx, st.hex!, side).map((p) => p.id);
        // The enemy a concealed unit engages in CC is in its hex and sees it. That enemy is "in Melee", so not Good
        // Order, and would never count as the Good Order enemy whose LOS takes a "?" off (SK4 8.3); any unbroken,
        // non-HIP enemy in the hex does.
        const engaged = (side: SideId) => personnelAt(ctx, st.hex!, otherSide(ctx.state, side)).some((e) => !isBroken(e) && !isHidden(e));
        const drop = (side: SideId) => dropConcealment(ctx, inHex(side), 'cc', engaged(side) ? undefined : [st.hex!]);
        if (st.step === 'simultaneous-attacker' || st.step === 'sequential') {
          // Declarations begin with no ambush: every concealed unit engaging in CC drops its "?".
          for (const side of ctx.state.sides) drop(side);
        } else if (st.step === 'ambusher' && st.ambusher) {
          drop(otherSide(ctx.state, st.ambusher));
        } else if (st.step === 'other' && st.ambusher) {
          // The ambusher's attacks are done and an enemy still stands: it did not "both ambush and eliminate all enemy units".
          drop(st.ambusher);
        }
      },
    });
    r.contribute({
      id: 'sk4.concealment.ambush-possible',
      query: 'cc.ambushPossible',
      ref: 'SK4 8.3.2',
      when: ({ hex }, env) => concealmentActive(env) && ctxSides(env).some((side) => concealedAt(env, hex, side).length > 0),
      apply: () => true,
    });
    r.contribute({
      id: 'sk4.concealment.ambush-drm',
      query: 'cc.ambushDrm',
      ref: 'SK4 8.3.2',
      label: '-2 concealed',
      when: ({ units }, env) => concealmentActive(env) && units.some((u) => isConcealed(pieceOf(env, u))),
      apply: (v) => v - 2,
    });
    // A HIP unit walked into is placed on board concealed (8.3.3): its -2 is the concealment's, not a second one.
    r.suppress({ id: 'sk4.concealment.no-hip-ambush', query: 'cc.ambushDrm', target: 'sk2.hip.ambush', when: (_c, env) => concealmentActive(env) });
    // "A concealed unit is never held in Melee (nor does it hold an enemy unit in Melee)."
    r.contribute({
      id: 'sk4.concealment.melee',
      query: 'cc.meleeHolds',
      layer: 900,
      when: (_c, env) => concealmentActive(env),
      apply: (v, { hex }, env) => v && ctxSides(env).every((side) => personnelAt(env, hex, side).length === 0 || personnelAt(env, hex, side).some((p) => !isConcealed(p))),
    });
    // The end of the CCPh ends the Player Turn: "?" off any unit sharing a hex with an unbroken enemy, then gained by the
    // ATTACKER's Good Order Infantry in Concealment Terrain out of every unbroken non-HIP enemy's LOS (8.3.1).
    r.on<{ phase: string; attacker: SideId }>({
      id: 'sk4.concealment.turn-end',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (!concealmentActive(ctx)) return;
        const phases = ctx.query('turn.phases', {}, [] as string[]);
        if (ev.payload.phase !== phases[phases.length - 1]) return;
        for (const p of Object.values(ctx.state.pieces).filter((q) => q.loc.kind === 'hex' && isInfantry(ctx, q) && isConcealed(q)).sort(byId)) {
          const loc = locOf(ctx.state, p)!;
          if (unitsAt(ctx, loc, otherSide(ctx.state, p.side)).some((e) => isInfantry(ctx, e) && !isBroken(e))) dropConcealment(ctx, [p.id], 'melee');
        }
        const gainers = Object.values(ctx.state.pieces)
          .filter((p) => p.side === ev.payload.attacker && p.loc.kind === 'hex' && isInfantry(ctx, p) && !isConcealed(p) && !isHidden(p) && isGoodOrder(ctx, p))
          .filter((p) => isConcealmentTerrain(ctx, locOf(ctx.state, p)!) && enemyLosTo(ctx, locOf(ctx.state, p)!, p.side, 'unbroken').length === 0)
          .map((p) => p.id)
          .sort();
        gainConcealment(ctx, gainers, 'endOfTurn');
      },
    });

    // ---------------------------------------------------------------- effects of being fired at (8.3.2)
    // Small arms vs concealed units: Area Fire, half FP; a mixed hex is resolved once per kind with the same DR (A12.13).
    r.procedure<ApplyResultFn>(FP.applyResult, (next) => (ctx, attack, column, baseFinal, out) => {
      if (!concealmentActive(ctx) || attack.ordnance) return next?.(ctx, attack, column, baseFinal, out);
      const dcVs = attack.parts.some((p) => p.kind === 'sw' && ctx.state.pieces[p.piece]?.tags[T4.dcVsConcealed] === true);
      const concealed = attack.targets.filter((u) => dcVs || (isConcealed(pieceOf(ctx, u)) && !isVisibleTo(ctx, pieceOf(ctx, u), attack.side)));
      if (concealed.length === 0) return next?.(ctx, attack, column, baseFinal, out);
      const rest = attack.targets.filter((u) => !concealed.includes(u));
      if (rest.length) next?.(ctx, { ...attack, targets: rest }, column, baseFinal, out);
      const half = iftColumn(ctx, column / 2);
      if (half !== null) next?.(ctx, { ...attack, targets: concealed }, half, baseFinal, out);
    });
    r.contribute({
      id: 'sk4.th.concealed-target',
      query: 'ordnance.thDrm',
      ref: 'SK4 8.3.2',
      label: '+2 concealed target',
      when: (sc, env) => concealmentActive(env) && !sc.moving && knownEnemyAt(env, sc.target, sc.side).length === 0 && concealedAt(env, sc.target, otherSide(env.state, sc.side)).length > 0,
      apply: (v) => v + 2,
    });
    // HIP's "+2 at a hex with no known enemy" and this one never stack: a concealed stack is visible, so HIP's does not fire.

    // ---------------------------------------------------------------- 8.3.3 Guns and HIP
    r.procedure<(c: Ctx, gun: PieceId, reason: string) => void>(REVEAL_GUN, (next) => (ctx, gunId, reason) => {
      const g = ctx.state.pieces[gunId];
      const manner = g && g.loc.kind === 'held' ? g.loc.by : null;
      const emplaced = !!g && isEmplaced(g);
      // A Gun placed on board under a "?" gets the "?" before its HIP comes off: a view built event by event must
      // never show the real counter in between, so the crew and Gun go from hidden straight to concealed.
      const conceals = concealmentActive(ctx) && !!manner && !!ctx.state.pieces[manner] && (reason === 'seen' || reason === 'advanced' || (reason === 'fire' && emplaced));
      if (conceals) gainConcealment(ctx, [manner!], 'hip');
      next?.(ctx, gunId, reason);
      if (conceals && reason === 'fire') setTags(ctx, gunId, { [T4.hipFired]: true });
    });
    r.on<{ unit: PieceId; reason: string }>({
      id: 'sk4.concealment.hip-unit',
      event: 'sk2.hip.unitRevealed',
      handler(ctx, ev) {
        if (!concealmentActive(ctx) || !ctx.state.pieces[ev.payload.unit]) return;
        if (ev.payload.reason === 'seen' || ev.payload.reason === 'advanced') gainConcealment(ctx, [ev.payload.unit], 'hip');
      },
    });
  },
};

const ctxSides = (env: QueryEnv) => env.state.sides;

/** The units the RtPh offer is about (for the interface). */
export const concealRtphUnits = (d: Decision): PieceId[] => (d.data?.['units'] as PieceId[] | undefined) ?? [];

/** Whether `force` hands out OB concealment counters (for the setup tray). */
export const obConcealment = (env: QueryEnv, side: SideId): { total: number; used: number } => ({
  total: statics(env).scenario.forces.filter((f) => f.side === side).reduce((n, f) => n + (f.concealment ?? 0), 0),
  used: stateOf(env).obUsed[side] ?? 0,
});

export type { FireMode };

