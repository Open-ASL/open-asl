import type { Action, Ctx, Decision, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, isVehicleDef, otherSide, statics, swHeldBy } from '../common/pieces';
import { locOf, type LocId } from '../common/location';
import type { HexsideObstacle } from '../common/statics';
import { PHASE_DECISION, PHASE_DONE, type PhaseDoneFn } from '../common/turn';
import { knownEnemyAt } from '../sk1/known';
import { fireMarker, isBroken, isPinned, mmc, pieceOf, setTags, smc } from '../sk1/status';
import { levelOf } from '../sk2/elevation';
import { isTi } from './labor';

/*
 * Wall Advantage (ASLRB B9.32–B9.323, B9.41) over the hexside obstacles in play: today the roadblocks (B29.3, a stone wall
 * "in all respects"); printed walls and hedges reuse it when a board has them.
 *
 * A unit claiming WA carries the `wa` tag (the Location it claimed in): it has WA over every wall hexside of its hex at
 * its level (B9.321), takes the wall TEM against fire across those hexsides and no in-hex TEM at all (B9.31), and denies
 * WA to every enemy unit across a shared wall hexside, which then may claim it over none of its hexsides (B9.321).
 * - Who may claim (B9.32): an armed, unbroken ground-level Infantry unit not in a pillbox, beneath an entrenchment, on top
 *   of Wire, nor in a Location holding a Known enemy unit, at the level of the wall (a Hillside wall: only from the higher
 *   hex, B9.6). Broken or unarmed units may (must, under B9.323) claim it beside a unit of theirs claiming it there.
 * - Mandatory WA (B9.323): a unit unable to claim an in-hex TEM of at least +1 claims WA as soon as it can, and cannot
 *   forfeit it voluntarily; the engine grants it after every move, status change and phase start, ATTACKER first.
 * - Voluntary claim and forfeit (B9.322): in the owner's MPh and APh, and at the end of any RPh (ASOP 1.32B,
 *   ATTACKER first): a `waRph` decision for the ATTACKER, then the DEFENDER, once both have done their rallying, offered
 *   only to a side with a claim or forfeit open to it; never by a pinned or TI unit.
 * - Loss (B9.32, B9.41): at once when the unit no longer qualifies (broken, pinned beneath nothing changes this, moved to
 *   another Location, an enemy in its Location), or when its hex has no wall hexside left (the roadblock removed).
 * Vehicles (B9.36, D4.2 HD), concealment (B9.324) and Deluxe ASL per-hexside WA wait for their chapters.
 */

export const WA_TAG = 'wa';
export type WaAction = Action & { type: 'wa.claim' | 'wa.forfeit'; unit: PieceId };
/** The end-of-RPh WA step (B9.322, ASOP 1.32B): the ATTACKER's, then the DEFENDER's. */
export const WA_RPH_DECISION = 'waRph';
const WA_RPH_EXT = 'asl.wa.rph';

const obstacles = (env: QueryEnv): HexsideObstacle[] => env.query('los.hexsides', {}, []);
/** The hex across obstacle `o` from `hex` (one of its two hexes). */
export const acrossObstacle = (o: HexsideObstacle, hex: HexId): HexId => (o.a === hex ? o.b : o.a);

/** The wall hexsides of a unit's hex it could have WA over: at its level, from the higher hex of a Hillside wall (B9.32, B9.6). */
export function wallSidesOf(env: QueryEnv, p: Piece): HexsideObstacle[] {
  if (p.loc.kind !== 'hex' || p.loc.level || p.loc.sub) return [];
  const hex = p.loc.hex;
  return obstacles(env).filter((o) => (o.a === hex || o.b === hex) && levelOf(env, hex) === o.level);
}

/** Holds WA in the Location it claimed it in. */
export const hasWa = (env: QueryEnv, p: Piece | undefined): boolean => !!p && typeof p.tags[WA_TAG] === 'string' && locOf(env.state, p) === p.tags[WA_TAG];
/** Holds WA over `o` (B9.321: over every possible wall hexside of its hex). */
export const hasWaOver = (env: QueryEnv, p: Piece, o: HexsideObstacle): boolean => hasWa(env, p) && wallSidesOf(env, p).some((x) => x.id === o.id);

const armed = (env: QueryEnv, p: Piece): boolean => {
  const m = mmc(env, p);
  if (m) return (m.fp ?? 0) > 0 || swHeldBy(env.state, p.id).length > 0;
  return swHeldBy(env.state, p.id).length > 0;
};

/** The enemy units across a wall hexside of `p`'s hex that claim WA (and so deny it to `p`, B9.321). */
export function waDeniers(env: QueryEnv, p: Piece): Piece[] {
  if (p.loc.kind !== 'hex') return [];
  const hex = p.loc.hex;
  const enemy = otherSide(env.state, p.side);
  const across = new Set(wallSidesOf(env, p).map((o) => acrossObstacle(o, hex)));
  return Object.values(env.state.pieces)
    .filter((e) => e.side === enemy && e.loc.kind === 'hex' && across.has(e.loc.hex) && hasWa(env, e))
    .sort(byId);
}

/**
 * Why `p` may not hold WA (B9.32), or null. `withOthers`: units of its side in its Location claim WA, which lets a broken or
 * unarmed unit claim it too.
 */
export function waIneligible(env: QueryEnv, p: Piece, withOthers = false): string | null {
  if (p.loc.kind !== 'hex') return 'Not on the map';
  if (isVehicleDef(defOf(env, p))) return 'Vehicles and WA wait for Chapter D (ASLRB B9.32, B9.36)';
  if (!mmc(env, p) && !smc(env, p)) return 'Not an Infantry unit';
  if (p.loc.level || p.loc.sub === 'pb') return p.loc.sub === 'pb' ? 'A unit in a pillbox may not claim WA (ASLRB B9.32)' : 'Only a ground-level unit may claim WA (ASLRB B9.32)';
  if (wallSidesOf(env, p).length === 0) return 'No wall hexside of its hex at its level (ASLRB B9.32, B9.6)';
  if (p.loc.pos?.ent) return 'A unit beneath an entrenchment may not claim WA (ASLRB B9.32)';
  if (p.loc.pos?.wire === 'on') return 'A unit on top of Wire may not claim WA (ASLRB B9.32)';
  if (knownEnemyAt(env, locOf(env.state, p)!, p.side).length) return 'An enemy unit is in its Location (ASLRB B9.32)';
  if ((isBroken(p) || !armed(env, p)) && !withOthers) return `${isBroken(p) ? 'A broken' : 'An unarmed'} unit claims WA only beside a unit of its side claiming it (ASLRB B9.32)`;
  return null;
}

/** A unit unable to claim an in-hex TEM of at least +1 must claim WA (B9.323). */
export const mandatoryWa = (env: QueryEnv, p: Piece): boolean => p.loc.kind === 'hex' && env.query('hex.tem', { hex: locOf(env.state, p)! }, 0) < 1;

const othersClaim = (env: QueryEnv, p: Piece) => Object.values(env.state.pieces).some((q) => q.id !== p.id && q.side === p.side && locOf(env.state, q) === locOf(env.state, p) && hasWa(env, q) && !isBroken(q) && armed(env, q));

/** Why `p` may not claim WA now of its own choice (B9.32, B9.321, B9.322), or null. */
export function waClaimIllegal(env: QueryEnv, p: Piece): string | null {
  if (hasWa(env, p)) return 'Already claiming WA';
  const why = waIneligible(env, p, othersClaim(env, p));
  if (why) return why;
  if (isPinned(p) || isTi(p)) return 'A pinned or TI unit cannot voluntarily claim or forfeit WA (ASLRB B9.322)';
  // B9.322 ties a claim in the MPh to the unit's movement: one that Prep Fired may not claim it then (Q&A [K33] to B9.322).
  if (env.state.phase === 'MPh' && fireMarker(p) === 'prep') return 'A unit that Prep Fired cannot claim WA in its MPh (ASLRB B9.322)';
  const d = waDeniers(env, p);
  if (d.length) return `Denied: the enemy across ${d[0]!.loc.kind === 'hex' ? d[0]!.loc.hex : ''} claims WA over the shared hexside (ASLRB B9.321)`;
  return null;
}
/** Why `p` may not forfeit WA now of its own choice (B9.322, B9.323), or null. */
export function waForfeitIllegal(env: QueryEnv, p: Piece): string | null {
  if (!hasWa(env, p)) return 'Not claiming WA';
  if (isPinned(p) || isTi(p)) return 'A pinned or TI unit cannot voluntarily claim or forfeit WA (ASLRB B9.322)';
  if (mandatoryWa(env, p)) return 'Mandatory WA: with no in-hex TEM of +1 or more it cannot be forfeited (ASLRB B9.323)';
  return null;
}

/** Whether `side` may claim or forfeit WA of its own choice in this decision (B9.322). */
const waPhase = (env: QueryEnv, side: SideId, d?: Pick<Decision, 'kind' | 'owner'>): boolean => {
  if (env.state.phase === 'MPh' || env.state.phase === 'APh') return env.state.attacker === side && (!d || d.kind === PHASE_DECISION);
  return env.state.phase === 'RPh' && !!d && d.kind === WA_RPH_DECISION && d.owner === side;
};
/** A claim or forfeit `side` could make of its own choice now (B9.32, B9.322, B9.323). */
const waChoices = (env: QueryEnv, side: SideId): boolean =>
  Object.values(env.state.pieces).some((p) => p.side === side && p.loc.kind === 'hex' && (!waClaimIllegal(env, p) || !waForfeitIllegal(env, p)));

function setWa(ctx: Ctx, p: Piece, on: boolean, reason: string, mandatory = false) {
  setTags(ctx, p.id, { [WA_TAG]: on ? (locOf(ctx.state, p) as string) : null });
  ctx.emit('asl.wa.changed', { unit: p.id, wa: on, reason, ...(mandatory ? { mandatory: true } : {}) });
}

/** The engine's part of WA: forfeits that are forced (B9.32, B9.41) and the mandatory claims (B9.323), ATTACKER first. */
function sweep(ctx: Ctx) {
  if (ctx.state.phase === 'setup') return;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    const pieces = Object.values(ctx.state.pieces).sort(byId);
    for (const p of pieces) {
      if (p.tags[WA_TAG] === undefined) continue;
      const moved = locOf(ctx.state, p) !== p.tags[WA_TAG];
      const why = moved ? 'entered another Location (ASLRB B9.41)' : waIneligible(ctx, p, othersClaim(ctx, p));
      if (why) {
        setWa(ctx, p, false, why);
        changed = true;
      }
    }
    const order = (q: Piece) => (q.side === ctx.state.attacker ? 0 : 1);
    for (const p of Object.values(ctx.state.pieces).sort((x, y) => order(x) - order(y) || byId(x, y))) {
      const fresh = ctx.state.pieces[p.id]!;
      if (hasWa(ctx, fresh) || fresh.loc.kind !== 'hex' || !mandatoryWa(ctx, fresh)) continue;
      if (waIneligible(ctx, fresh, othersClaim(ctx, fresh)) || waDeniers(ctx, fresh).length) continue;
      setWa(ctx, fresh, true, 'no in-hex TEM of +1 or more (ASLRB B9.323)', true);
      changed = true;
    }
    if (!changed) break;
  }
}

export const aslWallAdvantageModule: RuleModule = {
  id: 'asl.wallAdvantage',
  ref: 'ASLRB B9.32–B9.323, B9.41',
  summary: 'Wall Advantage over hexside obstacles: who may claim it, mandatory WA, denial across a shared hexside, loss on moving.',
  requires: ['sk1.movement', 'asl.labor'],
  install(r) {
    r.event<{ unit: PieceId; wa: boolean; reason: string; mandatory?: true }>({ type: 'asl.wa.changed', apply() {} });
    let busy = false;
    const run = (ctx: Ctx) => {
      if (busy || !obstacles(ctx).length) return;
      busy = true;
      try {
        sweep(ctx);
      } finally {
        busy = false;
      }
    };
    for (const event of ['piece.moved', 'piece.tagged', 'piece.eliminated', 'turn.phaseStarted', 'asl.fort.removed', 'asl.fort.revealed']) r.on({ id: `asl.wa.sweep.${event}`, event, handler: run });

    // B9.322: at the end of any RPh, ASOP 1.32B, the ATTACKER first: once the DEFENDER's rallying is done, the
    // ATTACKER's WA step and then the DEFENDER's, each only for a side with a claim or forfeit open to it.
    r.event<{ step: 'attacker' | 'defender' | null }>({
      type: 'asl.wa.rph',
      apply(d, p) {
        if (p.step) d.ext[WA_RPH_EXT] = p.step;
        else delete d.ext[WA_RPH_EXT];
      },
    });
    const askWa = (ctx: Ctx, side: SideId) => ctx.pushDecision({ kind: WA_RPH_DECISION, owner: side, deadlineClass: 'turn' });
    const nextWaStep = (ctx: Ctx) => {
      const att = ctx.state.attacker;
      const def = otherSide(ctx.state, att);
      const step = ctx.state.ext[WA_RPH_EXT] as 'attacker' | 'defender' | undefined;
      if (!step && waChoices(ctx, att)) {
        ctx.emit('asl.wa.rph', { step: 'attacker' });
        askWa(ctx, att);
        return;
      }
      if (step !== 'defender' && waChoices(ctx, def)) {
        ctx.emit('asl.wa.rph', { step: 'defender' });
        askWa(ctx, def);
        return;
      }
      if (step) ctx.emit('asl.wa.rph', { step: null });
      const decision: Decision = { id: 'auto', kind: PHASE_DECISION, owner: def, deadlineClass: 'turn' };
      ctx.proc<PhaseDoneFn>(PHASE_DONE)(ctx, { ...decision, data: { waDone: true } });
    };
    r.procedure<PhaseDoneFn>(PHASE_DONE, (next) => (ctx, decision) => {
      if (ctx.state.phase !== 'RPh' || decision.owner === ctx.state.attacker || decision.data?.['waDone'] || !obstacles(ctx).length) return next!(ctx, decision);
      nextWaStep(ctx);
    });
    r.action<Action & { type: 'wa.done' }>({
      type: 'wa.done',
      decisionKinds: [WA_RPH_DECISION],
      legal: () => [{ type: 'wa.done' }],
      resolve(ctx) {
        ctx.popDecision();
        nextWaStep(ctx);
      },
    });

    for (const type of ['wa.claim', 'wa.forfeit'] as const) {
      r.action<WaAction>({
        type,
        decisionKinds: [PHASE_DECISION, WA_RPH_DECISION],
        legal(env, d) {
          if (!obstacles(env).length || !waPhase(env, d.owner, d)) return [];
          return Object.values(env.state.pieces)
            .filter((p) => p.side === d.owner && p.loc.kind === 'hex')
            .sort(byId)
            .filter((p) => (type === 'wa.claim' ? !waClaimIllegal(env, p) : !waForfeitIllegal(env, p)))
            .map((p) => ({ type, unit: p.id }) as WaAction);
        },
        validate(env, a) {
          const p = env.state.pieces[a.unit];
          if (!p || p.side !== a.side) return 'Not your unit';
          const d = env.state.decisions[env.state.decisions.length - 1];
          if (!waPhase(env, a.side, d)) return env.state.phase === 'RPh' ? 'In the RPh WA is claimed or forfeited at its end, the ATTACKER first (ASLRB B9.322)' : 'WA is claimed or forfeited in your MPh or APh, or at the end of a RPh (ASLRB B9.322)';
          return type === 'wa.claim' ? waClaimIllegal(env, p) : waForfeitIllegal(env, p);
        },
        resolve(ctx, a) {
          setWa(ctx, pieceOf(ctx, a.unit), type === 'wa.claim', type === 'wa.claim' ? 'claimed (ASLRB B9.322)' : 'forfeited (ASLRB B9.322)');
          // The end-of-RPh step stays open for more claims until the side is done (or has nothing left to choose).
          const d = ctx.state.decisions[ctx.state.decisions.length - 1];
          if (d?.kind === WA_RPH_DECISION && !waChoices(ctx, a.side)) {
            ctx.popDecision();
            nextWaStep(ctx);
          }
        },
      });
    }
    void statics;
  },
};

/** The WA a viewer may see for the board's chits: the units claiming it, by Location. */
export function waUnits(env: QueryEnv): Record<LocId, PieceId[]> {
  const out: Record<LocId, PieceId[]> = {};
  for (const p of Object.values(env.state.pieces).sort(byId)) if (hasWa(env, p)) (out[locOf(env.state, p)!] ??= []).push(p.id);
  return out;
}
