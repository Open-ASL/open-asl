import type { Ctx, HexId, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { statics } from '../common/pieces';
import { hexOfLoc, locId, locOf, type LocId } from '../common/location';
import { byId } from '../common/pieces';
import { isBroken, mmc, pieceOf, smc } from '../sk1/status';
import { eliminate } from '../sk1/morale';
import { FP, type AttackResolvedFn, type ResolveFireFn } from '../sk1/fire';
import { FPP, type ResolveDcFn } from '../sk1/firePhases';
import { moveLoc } from '../sk1/moveState';
import { MOVE_ENTERED, type MoveEnteredFn, type MoveState } from '../sk1/movement';
import { moveState } from '../sk1/moveState';
import { AP, type AdvanceEnterFn } from '../sk1/advance';
import { activeRout } from '../sk1/rout';
import { gainConcealment } from './concealment';
import type { SetupAction } from '../sk1/scenario';
import { levelOf } from '../sk2/elevation';

/*
 * Caves (S70 SSR 2; full ASL G11 where the card is silent).
 *
 * Each Cave hex (a hill hex, "in which no building exists") holds a separate Cave Location, `<hex>:cave` (a sub-Location,
 * ASLRB A2.8), with the `cave` terrain: +2 TEM, 2 MF, Concealment Terrain. It is ADJACENT to the ground-level (level 0)
 * neighbours of its hex and to the Connection Location; not to its own hill hex. "Treated as being at ground level for LOS
 * purposes" (`loc.height` 0): there is no LOS between it and a hill hex (its own included), and none to or from the
 * Connection. A full ASL cave's Covered Arc (G11.12) is optional data (`ca`); the card prints none, so S70's have none.
 *
 * The Connection Location ("a pseudo, off-map hex"; G11.2's Cave Complex) is one of the map's hidden hexes
 * (`HexGridMapOptions.hiddenHexes`, terrain `cave-complex`): units stand in it with a terrain, but it is on no board,
 * has no neighbours on the map and no LOS; this module makes it ADJACENT to the caves, and the caves to it.
 *
 * Once a Cave Location is eliminated (the lasting hex marker `caveGone`) its hex is a regular hill hex: the Location is
 * gone from `hex.locations` and from every adjacency.
 */

export const CAVES_MODULE = 'caves';
/** Hex marker: this hex's Cave Location has been eliminated (the counter flipped to its Open Ground side). Lasting. */
export const CAVE_GONE = 'caveGone';

export interface CavesParams {
  /** The Cave hexes (each holds a Cave Location). */
  caves: HexId[];
  /** The id of the Connection Location's hidden hex. */
  connection: HexId;
  /** The side whose units alone may enter the caves and the Connection. */
  side: SideId;
  /** Full ASL G11.12: a cave's Covered Arc (the hexes LOS to and from it may reach); none on the S70 card. */
  ca?: Record<HexId, HexId[]>;
  /** The card's name for the rule, e.g. 'SSR 2'. */
  rule?: string;
}

export const cavesParams = (env: QueryEnv): CavesParams | null => {
  const s = statics(env).scenario.ssr.find((r) => r.module === CAVES_MODULE && r.params);
  return s ? (s.params as unknown as CavesParams) : null;
};

/** The Cave Location of a hex. */
export const caveLoc = (hex: HexId): LocId => locId(hex, 0, 'cave');
/** Whether a Location is a Cave Location. */
export const isCaveLoc = (loc: LocId): boolean => loc.endsWith(':cave');
/** Whether a hex's Cave Location still exists. */
export const caveStands = (env: QueryEnv, hex: HexId): boolean => !!cavesParams(env)?.caves.includes(hex) && env.state.hexMarkers[hex]?.[CAVE_GONE] !== true;
/** The Cave Locations still standing. */
export const standingCaves = (env: QueryEnv): LocId[] => (cavesParams(env)?.caves ?? []).filter((h) => caveStands(env, h)).map(caveLoc);
/** Whether a Location is the Connection Location. */
export const isConnection = (env: QueryEnv, loc: LocId): boolean => cavesParams(env)?.connection === loc;
/** Whether a Location is underground: a Cave Location or the Connection. */
export const isUnderground = (env: QueryEnv, loc: LocId): boolean => isCaveLoc(loc) || isConnection(env, loc);

/** The card's name for the rule, for messages. */
const ruleName = (q: CavesParams) => q.rule ?? 'SSR';
const sideName = (env: QueryEnv, side: SideId) => statics(env).scenario.sides.find((s) => s.side === side)?.name ?? side;

/**
 * Why these units may not step from `from` into `to` for cave reasons (MPh, APh and RtPh alike), or null. Only the
 * card's side, and only Infantry, enter a cave or the Connection (card; G11.7); a Gun never does (G11.76 is not on the
 * card). Entering or leaving the Connection is a unit's "sole action" of the phase: in the MPh it must not have spent
 * any MF (`fresh`), and it spends them all (`'move.cost'`).
 */
export function caveStepIllegal(env: QueryEnv, units: PieceId[], from: LocId | null, to: LocId, fresh = true): string | null {
  const q = cavesParams(env);
  if (!q) return null;
  const intoCave = isCaveLoc(to) || to === q.connection;
  const viaConnection = to === q.connection || from === q.connection;
  if (!intoCave && !viaConnection) return null;
  for (const u of units) {
    const p = pieceOf(env, u);
    if (intoCave && p.side !== q.side) return `${sideName(env, p.side)} units may not enter a Cave (${ruleName(q)})`;
    if (!mmc(env, p) && !smc(env, p)) return `Only Infantry may enter a Cave or the Connection Location (${ruleName(q)})`;
  }
  if (viaConnection && !fresh) return `Entering or leaving the Connection Location must be the unit's sole action this phase (${ruleName(q)})`;
  return null;
}

/** Whether a move or rout step enters or leaves the Connection: the unit's sole action, all its MF. */
const connectionStep = (env: QueryEnv, from: HexId | null, to: HexId) => {
  const q = cavesParams(env);
  return !!q && (to === q.connection || from === q.connection);
};

/** Units out of the Connection into a cave "emerge from it concealed" (card; G11.75). */
const emerge = (ctx: Ctx, units: PieceId[]) => {
  const q = cavesParams(ctx)!;
  gainConcealment(ctx, units, `emerged from the Connection Location (${ruleName(q)})`);
};

/** Whether a cave holds an unbroken unit of the cave side (a DC or FT attack on one that holds none eliminates it). */
const unbrokenIn = (env: QueryEnv, loc: LocId) => {
  const q = cavesParams(env)!;
  return Object.values(env.state.pieces).some((p) => p.side === q.side && (mmc(env, p) || smc(env, p)) && !isBroken(p) && locOf(env.state, p) === loc);
};

/**
 * Eliminate a cave: everything in it goes (its weapons first, so none is left lying in a Location that no longer exists),
 * the counter flips to its Open Ground side (`caveGone`), and once no cave stands the Connection's contents go too (card).
 */
export function eliminateCave(ctx: Ctx, hex: HexId, reason: string) {
  const q = cavesParams(ctx);
  if (!q || !caveStands(ctx, hex)) return;
  const purge = (loc: LocId, why: string) => {
    const there = Object.values(ctx.state.pieces).filter((p) => p.loc.kind !== 'eliminated' && locOf(ctx.state, p) === loc).sort(byId);
    for (const w of there.filter((p) => p.loc.kind === 'held')) ctx.emit('piece.eliminated', { id: w.id, reason: why });
    for (const p of there.filter((x) => x.loc.kind !== 'held')) {
      if (mmc(ctx, p) || smc(ctx, p)) eliminate(ctx, p.id, why);
      else ctx.emit('piece.eliminated', { id: p.id, reason: why });
    }
  };
  purge(caveLoc(hex), `Cave ${hex} eliminated: ${reason}`);
  ctx.emit('hex.marker', { hex, key: CAVE_GONE, value: true });
  if (standingCaves(ctx).length === 0) purge(q.connection, `both Caves eliminated (${ruleName(q)})`);
}

const freshStack = (ms: MoveState) => ms.hexesEntered === 0 && ms.units.every((u) => !(ms.spent[u] ?? 0));

/** The ground-level hexes a cave is ADJACENT to: its hex's neighbours at level 0. */
const caveMouths = (env: QueryEnv, hex: HexId): HexId[] => statics(env).map.neighbors(hex).filter((n) => levelOf(env, n) === 0);

export const cavesModule: RuleModule = {
  id: 'ssr.caves',
  ref: 'S70 SSR 2; ASLRB G11',
  summary: 'Cave Locations in hill hexes and the hidden Connection Location between them (SSR; full ASL G11).',
  requires: ['sk1.terrain', 'sk2.elevation', 'sk1.movement', 'sk1.advance', 'sk1.rout', 'sk1.fire', 'sk1.firePhases'],
  install(r) {
    r.contribute({
      id: 'ssr.caves.locations',
      query: 'hex.locations',
      ref: 'S70 SSR 2',
      apply: (v, { hex }, env) => (caveStands(env, hex) ? [...v, caveLoc(hex)] : v),
    });
    r.contribute({
      id: 'ssr.caves.adjacent',
      query: 'loc.adjacent',
      ref: 'S70 SSR 2',
      layer: 50,
      apply(v, { loc }, env) {
        const q = cavesParams(env);
        if (!q) return v;
        // The Connection: the caves only.
        if (loc === q.connection) return standingCaves(env);
        // A cave: its hex's ground-level neighbours and the Connection.
        if (isCaveLoc(loc)) {
          const hex = hexOfLoc(loc);
          return caveStands(env, hex) ? [...caveMouths(env, hex), q.connection] : [];
        }
        // A ground-level hex beside a cave hex (not the cave's own hill hex): also that cave.
        const near = standingCaves(env).filter((c) => hexOfLoc(c) !== loc && caveMouths(env, hexOfLoc(c)).includes(loc));
        return near.length ? [...v, ...near] : v;
      },
    });
    r.contribute({
      id: 'ssr.caves.height',
      query: 'loc.height',
      ref: 'S70 SSR 2',
      apply: (v, { loc }) => (isCaveLoc(loc) ? 0 : v),
    });
    r.contribute({
      id: 'ssr.caves.terrain',
      query: 'hex.terrain',
      ref: 'S70 SSR 2',
      layer: 20,
      apply: (v, { loc }) => (loc && isCaveLoc(loc) ? 'cave' : v),
    });
    // ---------------------------------------------------------------- entry (card; G11.7)
    r.contribute({
      id: 'ssr.caves.step',
      query: 'move.stepIllegal',
      ref: 'S70 SSR 2',
      apply: (v, { ms, to }, env) => v ?? (ms.manhandle && isUnderground(env, to) ? `A Gun may not enter a Cave (${ruleName(cavesParams(env)!)})` : caveStepIllegal(env, ms.units, moveLoc(ms), to, freshStack(ms))),
    });
    r.contribute({
      id: 'ssr.caves.advance',
      query: 'advance.illegal',
      ref: 'S70 SSR 2',
      apply: (v, { units, to }, env) => v ?? caveStepIllegal(env, units, locOf(env.state, pieceOf(env, units[0]!)), to),
    });
    r.contribute({
      id: 'ssr.caves.rout',
      query: 'rout.stepIllegal',
      ref: 'S70 SSR 2',
      apply(v, { unit, from, to }, env) {
        if (v) return v;
        const act = activeRout(env);
        return caveStepIllegal(env, [unit], from, to, !act || act.unit !== unit || act.spent === 0);
      },
    });
    // ---------------------------------------------------------------- the Connection: secret, and left concealed
    // "Units in the Connection Location are secretly recorded": the other side sees nothing of them or what they hold.
    r.contribute({
      id: 'ssr.caves.secret',
      query: 'piece.visibleTo',
      ref: 'S70 SSR 2',
      apply(v, { piece, viewer }, env) {
        const p = env.state.pieces[piece];
        const q = cavesParams(env);
        if (!p || !q) return v;
        const loc = locOf(env.state, p);
        return loc === q.connection ? viewer === p.side : v;
      },
    });
    // Nor a "?" in its place (a concealed stack in the Connection would otherwise leave its counter there).
    r.contribute({
      id: 'ssr.caves.secret-stand-in',
      query: 'piece.standIn',
      ref: 'S70 SSR 2',
      layer: 900,
      apply(v, { piece, viewer }, env) {
        const p = env.state.pieces[piece];
        const q = cavesParams(env);
        return p && q && viewer !== p.side && locOf(env.state, p) === q.connection ? null : v;
      },
    });
    r.procedure<MoveEnteredFn>(MOVE_ENTERED, (next) => (ctx, ms) => {
      next?.(ctx, ms);
      const cur = moveState(ctx);
      if (cur?.sub === 'cave' && cur.from && isConnection(ctx, cur.from)) emerge(ctx, cur.units);
    });
    r.procedure<AdvanceEnterFn>(AP.enter, (next) => (ctx, a) => {
      const from = locOf(ctx.state, pieceOf(ctx, a.units[0]!));
      next?.(ctx, a);
      if (from && isConnection(ctx, from) && isCaveLoc(a.to)) emerge(ctx, a.units.filter((u) => locOf(ctx.state, pieceOf(ctx, u)) === a.to));
    });
    // ---------------------------------------------------------------- the end of a cave
    // "Any HE, DC or FT KIA eliminates the Cave and its contents"; "a DC or FT attack that does not malfunction against a
    // Cave with no unbroken Japanese eliminates it" (judged as the attack is made: `emptyAtAttack`). DC attacks on a cave
    // get -2. Units in a cave not eliminated by these keep their ordinary IFT results.
    const emptyAtAttack: boolean[] = [];
    const judged = (env: QueryEnv, target: LocId) => {
      const q = cavesParams(env);
      return !!q && isCaveLoc(target) && caveStands(env, hexOfLoc(target)) && !unbrokenIn(env, target);
    };
    r.procedure<ResolveFireFn>(FP.resolve, (next) => (ctx, decl, mode, opts) => {
      emptyAtAttack.push(judged(ctx, decl.target));
      try {
        return next!(ctx, decl, mode, opts);
      } finally {
        emptyAtAttack.pop();
      }
    });
    r.procedure<ResolveDcFn>(FPP.resolveDc, (next) => (ctx, dc) => {
      emptyAtAttack.push(dc.loc.kind === 'hex' && judged(ctx, locOf(ctx.state, dc)!));
      try {
        next!(ctx, dc);
      } finally {
        emptyAtAttack.pop();
      }
    });
    r.procedure<AttackResolvedFn>(FP.attackResolved, (next) => (ctx, info) => {
      next?.(ctx, info);
      const q = cavesParams(ctx);
      if (!q || !isCaveLoc(info.target) || !caveStands(ctx, hexOfLoc(info.target)) || info.by === 'other') return;
      const what = info.by === 'he' ? 'HE' : info.by === 'dc' ? 'DC' : 'FT';
      if (info.result === 'KIA') eliminateCave(ctx, hexOfLoc(info.target), `${what} KIA (${ruleName(q)})`);
      else if (info.by !== 'he' && !info.malfunctioned && emptyAtAttack[emptyAtAttack.length - 1]) eliminateCave(ctx, hexOfLoc(info.target), `${what} attack on a Cave with no unbroken ${sideName(ctx, q.side)} (${ruleName(q)})`);
    });
    // "In a different hex for all purposes except an ATT attack with LOS to the Cave": an ATT hit on either Location of a
    // Cave hex also attacks the other one the firer has a LOS to.
    r.contribute({
      id: 'ssr.caves.att',
      query: 'fire.areaLocations',
      ref: 'S70 SSR 2',
      apply(v, { target, from }, env) {
        const hex = hexOfLoc(target);
        if (!caveStands(env, hex)) return v;
        const other = isCaveLoc(target) ? hex : caveLoc(hex);
        if (v.includes(other)) return v;
        const seen = env.query('los.trace', { from, to: other }, { clear: true, hindrance: 0, parts: [] }).clear;
        return seen ? [...v, other] : v;
      },
    });
    r.contribute({
      id: 'ssr.caves.dc',
      query: 'dc.drm',
      ref: 'S70 SSR 2',
      label: '-2 DC vs a Cave',
      when: ({ target }, env) => !!cavesParams(env) && isCaveLoc(target),
      apply: (v) => v - 2,
    });

    // Setup (G11.3): the side's Infantry in a cave or the Connection, nobody else.
    r.contribute({
      id: 'ssr.caves.setup',
      query: 'setup.illegal',
      ref: 'S70 SSR 2; ASLRB G11.3',
      apply(v, { action }, env) {
        if (v) return v;
        for (const [id, loc] of Object.entries((action as SetupAction).placements).sort()) {
          if (!isUnderground(env, loc)) continue;
          const why = caveStepIllegal(env, [id], null, loc);
          if (why) return why.replace('enter', 'set up in');
        }
        return null;
      },
    });
    // A cave costs 2 MF from a ground-level hex whatever the hill (it is at ground level); the Connection, in or out, all
    // of a unit's MF (its "sole action"). In the APh an advance is one Location anyway: it costs no more than the
    // Location's MF, so it does not make the unit CX.
    r.contribute({
      id: 'ssr.caves.cost',
      query: 'move.cost',
      ref: 'S70 SSR 2',
      layer: 800,
      label: 'Cave',
      when: ({ to, from, loc }, env) => (!!loc && isCaveLoc(loc)) || connectionStep(env, from, to),
      apply(v, { unit, from, to, loc }, env) {
        // RtPh: "treat the Connection Location as a building for rout": a building's 2 MF, as the rout's first and only step.
        if (connectionStep(env, from, to) && env.state.phase === 'RtPh') return 2;
        if (connectionStep(env, from, to) && env.state.phase !== 'APh') return Math.max(1, env.query('unit.mf', { unit, stack: [unit], doubleTime: false }, 0));
        if (connectionStep(env, from, to)) return 1;
        return loc ? statics(env).terrain['cave']?.mf ?? v : v;
      },
    });
    r.contribute({
      id: 'ssr.caves.step-cost',
      query: 'move.stepCost',
      ref: 'S70 SSR 2',
      layer: 800,
      label: 'all MF (Connection Location)',
      when: ({ ms, to }, env) => connectionStep(env, ms.hex, hexOfLoc(to)),
      apply: (_v, { ms }) => Math.max(1, ...ms.units.map((u) => ms.allowance[u] ?? 0)),
    });
    // Stacking (card silent; G11.4): a cave holds one squad-equivalent, the Connection two per cave.
    r.contribute({
      id: 'ssr.caves.stacking',
      query: 'stack.limit',
      ref: 'ASLRB G11.4',
      layer: 900,
      apply(v, { hex }, env) {
        const q = cavesParams(env);
        if (!q) return v;
        if (isCaveLoc(hex)) return { ...v, se: 1 };
        if (hex === q.connection) return { ...v, se: 2 * q.caves.length };
        return v;
      },
    });

    // LOS (card): none between a hill hex and a cave, none to or from the Connection; otherwise traced from the cave's hex
    // centre at ground level. A full ASL Covered Arc, when given, limits it further.
    r.contribute({
      id: 'ssr.caves.los',
      query: 'los.trace',
      ref: 'S70 SSR 2; ASLRB G11.5',
      layer: 900,
      apply(v, { from, to }, env) {
        const q = cavesParams(env);
        if (!q) return v;
        const ends = [from, to];
        if (!ends.some((e) => isCaveLoc(e) || e === q.connection)) return v;
        const blocked = (why: string) => ({ ...v, clear: false, hindrance: 0, parts: [], blockedBy: why });
        if (ends.includes(q.connection)) return from === to ? v : blocked('The Connection Location has no LOS');
        if (from === to) return v;
        const [cave, other] = isCaveLoc(from) ? [from, to] : [to, from];
        const caveHex = hexOfLoc(cave);
        const otherHex = hexOfLoc(other);
        if (isCaveLoc(other)) return blocked('No LOS between caves');
        if (levelOf(env, otherHex) >= 1) return blocked('No LOS between a hill hex and a Cave Location');
        const arc = q.ca?.[caveHex];
        if (arc && !arc.includes(otherHex)) return blocked('Outside the cave’s Covered Arc (ASLRB G11.5)');
        const map = statics(env).map;
        if (!map.losAt) return v;
        const res = map.losAt({ hex: caveHex, height: 0 }, { hex: otherHex, height: levelOf(env, otherHex) });
        return res.clear ? { ...v, clear: true } : blocked(res.obstacle ? `${res.obstacle.terrain} in ${res.obstacle.hex}` : 'Blocked');
      },
    });
  },
};
