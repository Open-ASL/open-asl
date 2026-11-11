import type { Ctx, Decision, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, isVehicleDef, statics, swHeldBy } from '../common/pieces';
import { SETUP_PLACED, type SetupAction, type SetupPlacedFn } from '../sk1/scenario';
import { gun, mmc, pieceOf, setTags, smc, squadEquivalents } from '../sk1/status';
import { hasFeature } from '../sk1/terrain';
import { revealUnit, seenInOpen } from './hip';
import { T2, isHidden } from './status';

/*
 * Hidden units by special rule (S23 SSR 1: "All British units (and the weapons they possess) may set up
 * hidden in non-Open Ground hexes, although Guns may not be hidden on a paved road. Record their hexes
 * secretly. All such units (including Gun crews) are placed on the mapboard with their weapons when they
 * fire or move or a German unit enters or attempts to enter their hex. If a German Infantry unit attempts
 * to enter such a hex during the MPh, return it to its previously occupied hex, where it ends its
 * movement."), as the full ASL HIP (A12.3) the Starter Kits give Guns alone (SK4 6.4).
 *
 * The side's setup marks units hidden (`SetupAction.hidden`); their weapons hide with them. The SK2 HIP
 * module does the rest for any hidden unit, Gun or not: the other side does not see them, an enemy
 * entering (or advancing into) the hex reveals them, Infantry trying to enter in the MPh is turned back,
 * a router may not enter, an attack that affects them reveals them. This module adds the reveals the
 * card adds for units: firing (or directing fire) and moving. As with hidden Guns, only the screen
 * hides them, and online each seat receives only its redacted view (`redactState`), so the setup never reaches the other browser.
 *
 * Vehicles may be hidden too (ASLRB A12.3: HIP records "the TCA/VCA for AFVs"; LMA4 SSR 2: "ALL German units
 * are to set up HIP"), with their MGs; one is revealed when it fires, starts, moves, turns its hull or turret, or
 * an enemy enters its hex (A12.32: a hidden unit may not move, "even ... to change a CA", and remain hidden).
 * `forces` makes hiding compulsory for every unit of those forces (the card's "set up HIP"): the engine hides
 * them as the setup is placed, with no choice to make.
 */

declare module '@asl/engine' {
  interface QueryCatalog {
    /** Who may set up hidden units and how: the `hidden-units` SSR's parameters, or what a rule pack grants (SK4 8.1.8.5). */
    'hiddenUnits.params': { ctx: Record<string, never>; value: HiddenUnitsParams | null };
  }
}

export const HIDDEN_UNITS_MODULE = 'hidden-units';

export interface HiddenUnitsParams {
  side: SideId;
  /** Only in hexes that are not Open Ground. */
  notOpenGround?: boolean;
  /**
   * At most this many squad equivalents of MMC hidden (SK4 8.1.8.5: 10% of the on-board OB, fractions rounded up); a
   * SMC or SW stacked with a hidden MMC is free.
   */
  quota?: number;
  /** Every unit of these forces sets up hidden (compulsory, done by the engine) rather than by the player's choice. */
  forces?: string[];
  /**
   * Only in Concealment Terrain (SK4 8.3); with `forces`, those units hide wherever they are placed in it and set up
   * normally elsewhere (S66: "set up ... using HIP (6.4) if in Concealment Terrain (8.3)").
   */
  inConcealmentTerrain?: boolean;
  /** The card's name for the rule, e.g. 'SSR 1'. */
  rule?: string;
}

export function hiddenUnitsParams(env: QueryEnv): HiddenUnitsParams | null {
  const s = statics(env).scenario.ssr.find((r) => r.module === HIDDEN_UNITS_MODULE);
  return env.query('hiddenUnits.params', {}, s ? (s.params as unknown as HiddenUnitsParams) : null);
}

/** Why `unit` may not set up hidden in `hex`, or null (the weapons it holds hide with it). */
export function hideIllegal(env: QueryEnv, unit: PieceId, hex: HexId, sw: Record<PieceId, PieceId> = {}): string | null {
  const p = hiddenUnitsParams(env);
  const u = env.state.pieces[unit];
  if (!p || !u || u.side !== p.side) return 'Only the units a special rule names may set up hidden';
  if (!hideableUnit(env, u)) return 'Only personnel and vehicles set up hidden (their weapons go with them)';
  if (p.forces && !p.forces.includes(statics(env).scenario.forces[u.tags['force'] as number]?.id ?? '')) return 'Only the units a special rule names may set up hidden';
  if (p.notOpenGround && env.query('hex.openGround', { hex }, false)) return 'Hidden units may not set up in Open Ground';
  if (p.inConcealmentTerrain && !env.query('hex.concealmentTerrain', { hex }, false)) return 'Hidden units set up only in Concealment Terrain';
  // A Gun the unit mans hides with it, but never on a paved road (SK4 6.4).
  const weapons = [...swHeldBy(env.state, unit).map((w) => w.id), ...Object.entries(sw).filter(([, by]) => by === unit).map(([w]) => w)];
  for (const w of new Set(weapons)) {
    const g = env.state.pieces[w];
    if (g && gun(env, g) && hasFeature(env, hex, 'road:paved')) return 'A Gun may not be hidden on a paved road';
  }
  return null;
}

/** Personnel and vehicles may hide; weapons hide with the unit holding them. */
export const hideableUnit = (env: QueryEnv, p: Piece) => !!(mmc(env, p) || smc(env, p) || isVehicleDef(defOf(env, p)));

/** The units of `todo` the rule hides by itself (every unit of its `forces` placed on the map), sorted. */
export function compulsoryHidden(env: QueryEnv, todo: PieceId[], placements: Record<PieceId, HexId>): PieceId[] {
  const p = hiddenUnitsParams(env);
  if (!p?.forces?.length) return [];
  const forces = statics(env).scenario.forces;
  return todo
    .filter((id) => {
      const u = env.state.pieces[id];
      if (!u || u.side !== p.side || !placements[id] || !statics(env).map.hex(placements[id]!) || !hideableUnit(env, u)) return false;
      if (p.inConcealmentTerrain && !env.query('hex.concealmentTerrain', { hex: placements[id]! }, false)) return false;
      const force = forces[u.tags['force'] as number]?.id;
      return !!force && p.forces!.includes(force);
    })
    .sort();
}

export const hiddenUnitsModule: RuleModule = {
  id: 'ssr.hidden-units',
  ref: 'S23 SSR 1; ASL A12.3',
  summary: 'A side’s units may set up hidden with their weapons, revealed when they fire, move or are found (SSR).',
  requires: ['sk2.hip', 'sk1.scenario', 'sk1.fire'],
  install(r) {
    r.contribute({
      id: 'ssr.hidden-units.setup',
      query: 'setup.illegal',
      apply(v, { todo, action }, env) {
        if (v) return v;
        const a = action as SetupAction;
        // A force the card sets up hidden must be placed where it can hide (no Gun on a paved road).
        for (const id of compulsoryHidden(env, todo, a.placements)) {
          const why = hideIllegal(env, id, a.placements[id]!, a.sw);
          if (why) return `${why} (${hiddenUnitsParams(env)?.rule ?? 'SSR'}: these units set up hidden)`;
        }
        for (const id of a.hidden ?? []) {
          if (!todo.includes(id)) return `${id} is not being set up`;
          const hex = a.placements[id];
          if (!hex) return `${id} must be placed to set up hidden`;
          const why = hideIllegal(env, id, hex, a.sw);
          if (why) return why;
        }
        // A quota (SK4 8.1.8.5): so many squad equivalents of MMC; a SMC hides only with a hidden MMC in its hex.
        const quota = hiddenUnitsParams(env)?.quota;
        if (quota !== undefined && a.hidden?.length) {
          const hidden = a.hidden.map((id) => env.state.pieces[id]).filter((p): p is Piece => !!p);
          const se = squadEquivalents(env, hidden.filter((p) => mmc(env, p)));
          if (se > quota) return `Only ${quota} squad equivalent${quota === 1 ? '' : 's'} may set up hidden (${hiddenUnitsParams(env)?.rule ?? 'SSR'}): ${se} chosen`;
          for (const p of hidden) if (smc(env, p) && !hidden.some((q) => q.id !== p.id && mmc(env, q) && a.placements[q.id] === a.placements[p.id])) return `${p.id} may only set up hidden stacked with a hidden MMC (${hiddenUnitsParams(env)?.rule ?? 'SSR'})`;
        }
        return null;
      },
    });
    // After the placements and weapon assignments: the unit, its weapons and any Gun it mans hide.
    r.procedure<SetupPlacedFn>(SETUP_PLACED, (next) => (ctx, action, decision: Decision) => {
      next?.(ctx, action, decision);
      const todo = Object.keys(action.placements);
      for (const id of [...new Set([...(action.hidden ?? []), ...compulsoryHidden(ctx, todo, action.placements)])].sort()) {
        if (!ctx.state.pieces[id]) continue;
        setTags(ctx, id, { [T2.hip]: true });
        for (const w of swHeldBy(ctx.state, id)) if (!isHidden(w)) setTags(ctx, w.id, { [T2.hip]: true });
      }
    });

    const revealFirer = (ctx: Ctx, id: PieceId) => {
      const w = ctx.state.pieces[id];
      const firer = w && w.loc.kind === 'held' ? w.loc.by : id;
      const u = ctx.state.pieces[firer];
      if (u && isHidden(u) && hideableUnit(ctx, u)) revealUnit(ctx, u.id, 'fire');
      // A vehicle's MA shot reveals the vehicle as a Gun would be (sk2/guns.ts); its MGs come out with it.
      else if (u && isVehicleDef(defOf(ctx, u))) for (const m of swHeldBy(ctx.state, u.id)) if (isHidden(m)) setTags(ctx, m.id, { [T2.hip]: null });
    };
    // An attack with no LOS has still been fired (ASLRB A6.11).
    for (const event of ['sk1.fire.attack', 'sk1.fire.noLos'])
      r.on<{ attack: { parts: PieceId[]; directors?: PieceId[] } }>({
        id: event === 'sk1.fire.attack' ? 'ssr.hidden-units.fired' : 'ssr.hidden-units.fired-noLos',
        event,
        handler(ctx, ev) {
          for (const id of [...ev.payload.attack.parts, ...(ev.payload.attack.directors ?? [])].sort()) revealFirer(ctx, id);
        },
      });
    for (const event of ['sk2.ordnance.shot', 'sk2.ordnance.noLos'])
      r.on<{ weapon: PieceId }>({
        id: event === 'sk2.ordnance.shot' ? 'ssr.hidden-units.shot' : 'ssr.hidden-units.shot-noLos',
        event,
        handler(ctx, ev) {
          revealFirer(ctx, ev.payload.weapon);
        },
      });
    r.on<{ id: PieceId }>({
      id: 'ssr.hidden-units.moved',
      event: 'piece.moved',
      handler(ctx, ev) {
        if (ctx.state.phase === 'setup') return;
        const u = ctx.state.pieces[ev.payload.id];
        if (u && isHidden(u) && hideableUnit(ctx, u)) revealUnit(ctx, u.id, 'moved');
      },
    });
    // Where the rule lets units hide in Open Ground too (LMA4 SSR 2 names no terrain), one standing there cannot stay
    // hidden from a Good Order enemy that sees it within 16 hexes (SK4 6.4, as for a Gun; ASLRB A12.3 has HIP only in
    // Concealment Terrain). A unit manning a hidden Gun goes with the Gun (sk2/hip.ts).
    const sweep = (ctx: Ctx) => {
      const p = hiddenUnitsParams(ctx);
      if (!p || p.notOpenGround || ctx.state.phase === 'setup') return;
      for (const u of Object.values(ctx.state.pieces).filter((x) => x.loc.kind === 'hex' && x.side === p.side && isHidden(x) && hideableUnit(ctx, x)).sort(byId)) {
        if (!isHidden(pieceOf(ctx, u.id)) || swHeldBy(ctx.state, u.id).some((w) => gun(ctx, w))) continue;
        const hex = u.loc.kind === 'hex' ? u.loc.hex : null;
        if (!hex || !ctx.query('hex.openGround', { hex }, false) || !seenInOpen(ctx, hex, u.side)) continue;
        revealUnit(ctx, u.id, 'seen');
      }
    };
    for (const event of ['piece.moved', 'piece.tagged', 'turn.phaseStarted']) r.on({ id: `ssr.hidden-units.sweep.${event}`, event, handler: (ctx) => sweep(ctx) });
    // A hidden vehicle that starts, stops, turns its hull or turret or attempts Motion is revealed (A12.32).
    r.on<{ vehicle: PieceId }>({
      id: 'ssr.hidden-units.vehicle-moved',
      event: 'sk3.vehicle.move',
      handler(ctx, ev) {
        if (ctx.state.phase === 'setup') return;
        const v = ctx.state.pieces[ev.payload.vehicle];
        if (v && isHidden(v)) revealUnit(ctx, v.id, 'moved');
      },
    });
  },
};

export const isHiddenUnit = (env: QueryEnv, id: PieceId) => {
  const p = pieceOf(env, id);
  return isHidden(p) && hideableUnit(env, p);
};
