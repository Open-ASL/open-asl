import type { Ctx, HexId, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { hexPixel } from '../common/map';
import { acrossSide, cornerBetween, cornerHexes, cornerName, cornerPoint, mod6, sameCorner, sideToward } from '../common/hexCorners';
import { hexOfLoc, isGroundLoc, locationsOf, locOf, type LocId } from '../common/location';
import { personnelAt, statics } from '../common/pieces';
import type { FireAttackCtx } from '../sk1/fire';
import { FORTIFIED_DRM } from '../sk1/fortified';
import { visibleEnemyAt } from '../sk1/known';
import { MOVE_BYPASS, MOVE_ENTER, MOVE_FINISH, moveInternals, moveState, type BypassPos, type MoveBypassFn, type MoveEnterFn, type MoveFinishFn, type MoveState } from '../sk1/movement';
import { updateControl } from '../sk1/scenario';
import { isBroken, isPinned, pieceOf, smc, squadEquivalents } from '../sk1/status';
import { inPlay, smokeIn, terrainOf } from '../sk1/terrain';
import { heightOf, levelOf } from '../sk2/elevation';
import { hiddenGunsAt, hiddenUnitsAt, revealHex } from '../sk2/hip';

/**
 * Bypass movement in full ASL (ASLRB A4.3–A4.34, with A6.12, A8.2, A26.11, B13.3, B23.31, B23.4).
 *
 * Unbroken Infantry may move through a woods or building hex round its obstacle, along hexsides the obstacle's depiction
 * does not touch (the map's `bypassSides`, measured on the board art), instead of entering it. The stack is then in the
 * hex's Location (A7.212 EX), at a corner of the hex, not in the obstacle: its position lives on `MoveState.bypass`,
 * never on the pieces. The moves are all `move.step`:
 * - into Bypass: `{ to: 'uR3', bypass: ['uR4', 'uS4'] }`, along the hexsides R3 shares with R4 and S4 (A2.2 notation);
 * - further round: `{ to: 'uR3', bypass: ['uS3'] }`; into the obstacle: `{ to: 'uR3' }`; out at the corner: a step to
 *   one of the two other hexes there (or a Bypass of it).
 *
 * Cost (A4.31): the Open Ground the stack moves in, one MF (two uphill, B10.4; +1 in SMOKE, A24.7, doubled uphill as B.2)
 * for one or two hexsides of the hex, twice that for three or more (the doubling is charged once, on the third: the A4.31
 * example's "another MF" for both three and four hexsides). Entering the obstacle from Bypass costs its whole COT.
 * Infantry may not end its MPh in Bypass (A4.32): every Bypass step must leave the stack, with the MF it would have left,
 * a legal way to finish the move (read here as a full look-ahead). Broken or pinned there, a unit stays in the
 * open part of the hex for the rest of its MPh (A4.32, A4.33); afterwards it is simply in the hex, under its TEM.
 *
 * Fire (A4.34): each firing hex traces its LOS to the hex centre or to a corner of a hexside the targets went along,
 * chosen after the fire is declared (`FireDeclaration.at`). The centre is blocked unless the LOS
 * crosses a bypassed hexside to reach it. There is no obstacle TEM (B13.3, B23.31) except against Residual FP (A8.2), and
 * FFMO applies in the open portion. Residual FP fills the whole Location (A8.21). No Control is gained in Bypass (A26.11).
 *
 * Not here (later steps): A12.151/A12.42 concealment, vehicles (VBM), rubble/Wire/roadblocks/mines/Blaze, A2.6 exit.
 */

const BYPASS_TERRAIN = (id: string) => id === 'woods' || id.startsWith('building');

/** A woods or building hex that has a hexside open to Bypass (ASLRB A4.3). */
export function bypassable(env: QueryEnv, hex: HexId): boolean {
  const map = statics(env).map;
  return !!map.hex(hex) && BYPASS_TERRAIN(terrainOf(env, hex).id) && (map.bypassSides?.(hex) ?? 0) !== 0;
}
const sideFree = (env: QueryEnv, hex: HexId, k: number) => ((statics(env).map.bypassSides?.(hex) ?? 0) & (1 << mod6(k))) !== 0;

/** A Known enemy unit in any Location of the hex (the obstacle may not be bypassed: A4.3; nor its Location entered: A4.14). */
const enemyIn = (env: QueryEnv, hex: HexId) => locationsOf(env, hex).some((l) => visibleEnemyAt(env, l, env.state.attacker).length > 0);

/** The Bypass cost of a hex for one or two hexsides: Open Ground, doubled uphill from the hex the stack is in; SMOKE +1. */
function baseCost(env: QueryEnv, fromHex: HexId, hex: HexId): number {
  return (1 + (smokeIn(env, hex) ? 1 : 0)) * (levelOf(env, hex) > levelOf(env, fromHex) ? 2 : 1);
}
const costFor = (base: number, n: number) => (n === 0 ? 0 : n > 2 ? 2 * base : base);

/** MF the whole moving stack still has (the least of its units). */
const mfLeft = (ms: MoveState) => Math.min(...ms.units.map((u) => moveInternals.remaining(ms, u)));

/** The corners a Bypass of `hex` may start from: the stack's corner, or the two corners of the hexside it crosses. */
function startCorners(env: QueryEnv, ms: MoveState, hex: HexId): { corners: number[]; entrySide: number | null } {
  const map = statics(env).map;
  if (ms.bypass) {
    if (ms.bypass.hex === hex) return { corners: [ms.bypass.at], entrySide: null };
    const c = sameCorner(map, ms.bypass.hex, ms.bypass.at, hex);
    return { corners: c === null ? [] : [c], entrySide: null };
  }
  if (!ms.hex || ms.level || ms.sub) return { corners: [], entrySide: null };
  const s = sideToward(map, hex, ms.hex);
  return s === null ? { corners: [], entrySide: null } : { corners: [s, mod6(s + 1)], entrySide: s };
}

/**
 * Follows hexsides from a corner: each must touch the corner reached so far. Returns the corner reached, or null when the
 * hexsides are not one contiguous path from `start`.
 */
function walk(start: number, sides: number[]): number | null {
  let cur = start;
  for (const k of sides) {
    if (k === cur) cur = mod6(k + 1);
    else if (mod6(k + 1) === cur) cur = k;
    else return null;
  }
  return cur;
}

/** The Bypass position a step would reach (the stack's sides so far in that hex included) and its cost, or why it is refused. */
export function plan(env: QueryEnv, ms: MoveState, hex: HexId, via: HexId[]): { pos: BypassPos; cost: number } | string {
  const map = statics(env).map;
  const sides = via.map((nb) => sideToward(map, hex, nb));
  if (sides.some((k) => k === null) || via.length === 0) return 'Bypass goes along hexsides of the hex bypassed: name the hexes across them';
  const ks = sides as number[];
  const same = ms.bypass?.hex === hex;
  const before = same ? ms.bypass!.sides : [];
  if (new Set([...before, ...ks]).size !== before.length + ks.length) return 'Each hexside is gone along once';
  const blocked = ks.find((k) => !sideFree(env, hex, k));
  if (blocked !== undefined) return `The obstacle in ${hex} touches its hexside with ${acrossSide(map, hex, blocked) ?? '?'}: no Bypass along it (ASLRB A4.3)`;
  const { corners, entrySide } = startCorners(env, ms, hex);
  if (corners.length === 0) return ms.bypass ? `${hex} does not meet the stack's corner` : 'Bypass starts from the hex next to it, at ground level';
  if (entrySide !== null && ks.includes(entrySide)) return 'Bypass goes round the obstacle, not along the hexside crossed into the hex';
  const reached = corners.map((c) => walk(c, ks)).find((c) => c !== null);
  if (reached === undefined || reached === null) return 'The hexsides must follow one another round the hex from the corner the stack is at';
  const base = same ? ms.bypass!.base : baseCost(env, ms.hex!, hex);
  const cost = costFor(base, before.length + ks.length) - costFor(base, before.length);
  return { pos: { hex, sides: [...before, ...ks], at: reached, base }, cost };
}

/** Can a stack (`units`) step out of Bypass into hex `x` at its corner, `left` MF in hand? Cost, or null if it may not. */
function exitCost(env: QueryEnv, units: PieceId[], from: HexId, x: HexId): number | null {
  const map = statics(env).map;
  if (!map.hex(x) || !inPlay(env, x) || visibleEnemyAt(env, x, env.state.attacker).length > 0) return null;
  const here = personnelAt(env, x, env.state.attacker).filter((p) => !units.includes(p.id));
  const all = [...here, ...units.map((u) => pieceOf(env, u))];
  if (squadEquivalents(env, all) > 3 || all.filter((p) => smc(env, p)).length > 4) return null;
  return Math.max(...units.map((u) => env.query('move.cost', { unit: u, from, to: x, viaRoad: false }, 1)));
}

/**
 * Whether a stack in Bypass at `pos` with `left` MF can still end its move legally: enter the obstacle, step into a hex at
 * its corner, or go further round (or into Bypass of a hex at the corner) and do one of those later (ASLRB A4.32, read
 * here as a full look-ahead). Memoised on the position and MF, bounded by MF and the six hexsides of a hex.
 */
function canFinish(env: QueryEnv, ms: MoveState, pos: BypassPos, left: number, memo = new Map<string, boolean>()): boolean {
  const key = `${pos.hex}|${pos.at}|${[...pos.sides].sort().join('')}|${left}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  memo.set(key, false);
  const assault = ms.assault;
  const ok = (() => {
    const enter = terrainOf(env, pos.hex).mf;
    if (enter <= left && (!assault || left - enter >= 1)) return true;
    // Assault Movement allows one Location (ASLRB A4.61): out of the hex bypassed is a second.
    if (assault) return false;
    const map = statics(env).map;
    const exits = cornerHexes(map, pos.hex, pos.at);
    for (const x of exits) {
      const c = exitCost(env, ms.units, pos.hex, x);
      if (c !== null && c <= left) return true;
    }
    for (const dir of [1, -1]) {
      const k = dir > 0 ? pos.at : mod6(pos.at - 1);
      if (pos.sides.includes(k) || !sideFree(env, pos.hex, k)) continue;
      const c = costFor(pos.base, pos.sides.length + 1) - costFor(pos.base, pos.sides.length);
      if (c <= left && canFinish(env, ms, { ...pos, sides: [...pos.sides, k], at: mod6(dir > 0 ? pos.at + 1 : pos.at - 1) }, left - c, memo)) return true;
    }
    for (const x of exits) {
      if (!bypassable(env, x) || enemyIn(env, x)) continue;
      const c0 = sameCorner(map, pos.hex, pos.at, x);
      if (c0 === null) continue;
      const base = baseCost(env, pos.hex, x);
      if (base > left) continue;
      for (const dir of [1, -1]) {
        const k = dir > 0 ? c0 : mod6(c0 - 1);
        if (!sideFree(env, x, k)) continue;
        if (canFinish(env, ms, { hex: x, sides: [k], at: mod6(dir > 0 ? c0 + 1 : c0 - 1), base }, left - base, memo)) return true;
      }
    }
    return false;
  })();
  memo.set(key, ok);
  return ok;
}

/** Why a `move.step` is refused for Bypass reasons (see the `'move.bypassIllegal'` query), or null. */
function bypassIllegal(env: QueryEnv, ms: MoveState, to: LocId, via?: HexId[]): string | null {
  const map = statics(env).map;
  const hex = hexOfLoc(to);
  if (!via) {
    // A step of a stack in Bypass: into the obstacle of its hex, or out at its corner.
    const b = ms.bypass!;
    if (hex === b.hex) {
      if (!isGroundLoc(to)) return 'Enter the obstacle at ground level first';
      const cost = terrainOf(env, hex).mf;
      const left = mfLeft(ms);
      if (cost > left) return `Entering the ${terrainOf(env, hex).name.toLowerCase()} from Bypass costs its whole ${cost} MF (ASLRB A4.3); ${left} MF left`;
      if (ms.assault && left - cost < 1) return 'Assault Movement may not use all MF';
      return null;
    }
    const exits = cornerHexes(map, b.hex, b.at);
    if (!exits.includes(hex)) return `From its corner in ${b.hex} the stack may enter ${exits.join(' or ')}, or the obstacle of ${b.hex} (ASLRB A4.31)`;
    if (!isGroundLoc(to)) return 'From Bypass only the ground level of a hex at the corner can be entered';
    return null;
  }
  if (ms.vehicle) return 'Only Infantry may Bypass on foot (vehicle Bypass is Chapter D)';
  if (ms.manhandle) return 'A Gun may not be pushed into, out of, or along Bypass';
  if (ms.halted) return 'The stack has ended its movement';
  if (ms.dcPending) return 'Finish the DC placement first';
  if (ms.level || ms.sub) return 'Bypass is at ground level: come down the stairs first';
  if (!isGroundLoc(to) || !map.hex(hex)) return 'Bypass is of a hex on the map, at ground level';
  if (!BYPASS_TERRAIN(terrainOf(env, hex).id)) return 'Only a woods or building hex can be bypassed (ASLRB A4.3)';
  if (!bypassable(env, hex)) return `The obstacle in ${hex} touches every hexside: no Bypass (ASLRB A4.3)`;
  if (!inPlay(env, hex)) return 'That hex is not in play';
  if (ms.units.some((u) => isBroken(pieceOf(env, u)))) return 'Broken units may not Bypass (ASLRB A4.3, A10.5)';
  if (enemyIn(env, hex)) return 'An obstacle holding a Known enemy unit cannot be bypassed (ASLRB A4.3)';
  const p = plan(env, ms, hex, via);
  if (typeof p === 'string') return p;
  // Assault Movement: one Location (ASLRB A4.61); going further round the hex keeps the stack in it.
  if (ms.assault && ms.bypass?.hex !== hex && ms.hexesEntered >= 1) return 'Assault Movement is limited to one Location';
  const left = mfLeft(ms);
  if (p.cost > left) return `${left} MF left: the Bypass costs ${p.cost}`;
  if (ms.assault && left - p.cost < 1) return 'Assault Movement may not use all MF';
  if (!canFinish(env, ms, p.pos, left - p.cost)) return 'With the MF left it could not end its move outside Bypass: Infantry may not end its move in Bypass (ASLRB A4.32)';
  return null;
}

/** Every Bypass step the stack may take now (for `move.bypassSteps`): each simple path round each hex it can reach. */
function bypassSteps(env: QueryEnv, ms: MoveState): { type: 'move.step'; to: LocId; bypass: HexId[] }[] {
  const map = statics(env).map;
  if (!ms.hex || ms.level || ms.sub || ms.vehicle || ms.manhandle || ms.halted || ms.units.length === 0) return [];
  const hexes = ms.bypass ? [ms.bypass.hex, ...cornerHexes(map, ms.bypass.hex, ms.bypass.at)] : map.neighbors(ms.hex);
  const out: { type: 'move.step'; to: LocId; bypass: HexId[] }[] = [];
  for (const hex of hexes) {
    if (!map.hex(hex) || !bypassable(env, hex)) continue;
    const { corners, entrySide } = startCorners(env, ms, hex);
    const done = ms.bypass?.hex === hex ? ms.bypass.sides : [];
    for (const c of corners) {
      for (const dir of [1, -1]) {
        const path: number[] = [];
        let cur = c;
        for (let n = 0; n < 5; n++) {
          const k = dir > 0 ? cur : mod6(cur - 1);
          if (done.includes(k) || path.includes(k) || k === entrySide || !sideFree(env, hex, k)) break;
          path.push(k);
          cur = mod6(dir > 0 ? cur + 1 : cur - 1);
          const via = path.map((s) => acrossSide(map, hex, s));
          if (via.some((v) => !v)) break;
          const a = { type: 'move.step' as const, to: hex, bypass: via as HexId[] };
          if (!bypassIllegal(env, ms, hex, a.bypass)) out.push(a);
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ fire

/** The units of the moving stack in the target Location that are in Bypass there, with the hexsides each went along. */
function bypassTargets(env: QueryEnv, target: LocId): Map<PieceId, number[]> {
  const out = new Map<PieceId, number[]>();
  const ms = moveState(env);
  if (!ms || !isGroundLoc(target) || ms.hex !== target) return out;
  if (ms.bypass) for (const u of ms.units) out.set(u, ms.bypass.sides);
  for (const [u, sides] of Object.entries(ms.stoppedBypass ?? {})) if (env.state.pieces[u]?.loc.kind === 'hex') out.set(u, sides);
  return out;
}

/** Every Defensive First Fire target in the Location is in Bypass (no part of the stack is in the obstacle). */
function allInBypass(env: QueryEnv, attack: Pick<FireAttackCtx, 'target' | 'targets' | 'moving'>): boolean {
  if (!attack.moving) return false;
  const b = bypassTargets(env, attack.target);
  return attack.targets.length > 0 && attack.targets.every((u) => b.has(u));
}

/** The corners a firer may trace to instead of the centre (ASLRB A4.34): those of the hexsides the targets went along. */
export function bypassCorners(env: QueryEnv, target: LocId): [HexId, HexId][] {
  const map = statics(env).map;
  const hex = hexOfLoc(target);
  const ks = new Set<number>();
  for (const sides of bypassTargets(env, target).values()) for (const k of sides) ks.add(k).add(mod6(k + 1));
  return [...ks]
    .sort()
    .map((k) => cornerName(map, hex, k))
    .filter((n): n is [HexId, HexId] => !!n);
}

/** The hexsides of `hex` the straight line from `fromHex`'s centre crosses on its way to `hex`'s centre. */
function sidesCrossed(env: QueryEnv, fromHex: HexId, hex: HexId): number[] {
  const map = statics(env).map;
  const a = hexPixel(map.hex(fromHex)!.cube);
  const h = map.hex(hex)!;
  const b = hexPixel(h.cube);
  const cross = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const out: number[] = [];
  for (let k = 0; k < 6; k++) {
    const c = cornerPoint(h.cube, k);
    const d = cornerPoint(h.cube, k + 1);
    const d1 = cross(a, b, c);
    const d2 = cross(a, b, d);
    const d3 = cross(c, d, a);
    const d4 = cross(c, d, b);
    if (((d1 <= 0 && d2 >= 0) || (d1 >= 0 && d2 <= 0)) && ((d3 <= 0 && d4 >= 0) || (d3 >= 0 && d4 <= 0))) out.push(k);
  }
  return out;
}

/** Height Advantage for a target in Bypass on a hill (B10.31): every firer lower; the obstacle TEM does not count there. */
function heightAdvantageInBypass(env: QueryEnv, attack: FireAttackCtx): boolean {
  if (attack.residual || attack.ordnance?.indirect) return false;
  const lt = heightOf(env, attack.target);
  const locs = [...new Set(attack.parts.map((p) => locOf(env.state, pieceOf(env, p.firer))).filter((l): l is LocId => !!l))];
  return locs.length > 0 && locs.every((l) => heightOf(env, l) < lt);
}
/** FFMO in the open portion of the hex (ASLRB A4.34): Defensive First Fire at a stack in Bypass with no Hindrance. */
const ffmoInBypass = (env: QueryEnv, attack: FireAttackCtx) =>
  !!attack.moving && !attack.residual && !attack.moving.vehicle && !attack.moving.pinned && attack.hindrance === 0 && !attack.ordnance?.indirect && !heightAdvantageInBypass(env, attack);

const directFire = (attack: FireAttackCtx) => !attack.residual && !attack.ordnance?.indirect;

export const aslBypassModule: RuleModule = {
  id: 'asl.bypass',
  ref: 'ASLRB A4.3, A4.31, A4.32, A4.33, A4.34',
  summary: 'Bypass movement round woods and buildings: cost, the corner reached, must leave, LOS to corners, no obstacle TEM.',
  requires: ['sk1.movement', 'sk1.fire', 'sk1.terrain', 'asl.locations'],
  install(r) {
    // ---------------------------------------------------------------- movement
    r.contribute({ id: 'asl.bypass.steps', query: 'move.bypassSteps', ref: 'ASLRB A4.3', apply: (v, { ms }, env) => [...v, ...bypassSteps(env, ms)] });
    r.contribute({ id: 'asl.bypass.illegal', query: 'move.bypassIllegal', ref: 'ASLRB A4.3, A4.31, A4.32', apply: (_v, { ms, to, bypass }, env) => bypassIllegal(env, ms, to, bypass) });
    r.contribute({
      id: 'asl.bypass.must-leave',
      query: 'move.bypassMustLeave',
      ref: 'ASLRB A4.32',
      apply: (_v, { ms }, env) => !!ms.bypass && canFinish(env, ms, ms.bypass, mfLeft(ms)),
    });
    r.contribute({
      id: 'asl.bypass.cost',
      query: 'move.stepCost',
      layer: 500,
      ref: 'ASLRB A4.31, A4.3',
      when: ({ ms, to, bypass }) => !!bypass || (!!ms.bypass && hexOfLoc(to) === ms.bypass.hex),
      apply(v, { ms, to, bypass }, env) {
        const hex = hexOfLoc(to);
        if (!bypass) return terrainOf(env, hex).mf;
        const p = plan(env, ms, hex, bypass);
        return typeof p === 'string' ? v : p.cost;
      },
    });
    r.procedure<MoveBypassFn>(MOVE_BYPASS, () => (ctx, ms, to, via, cost) => bypassStep(ctx, ms, to, via, cost));
    // Ending the MPh in Bypass (stranded, or broken/pinned there): what hides in the obstacle is found (A12.151, interim
    // for hidden Guns until Phase 6 brings concealment).
    r.procedure<MoveFinishFn>(MOVE_FINISH, (next) => (ctx) => {
      const ms = moveState(ctx);
      if (ms?.bypass || Object.keys(ms?.stoppedBypass ?? {}).length) {
        const hex = ms!.hex!;
        if (hiddenGunsAt(ctx, hex, ctx.state.attacker).length || hiddenUnitsAt(ctx, hex, ctx.state.attacker).length) revealHex(ctx, hex, ctx.state.attacker, 'entered');
      }
      next?.(ctx);
    });
    // A26.11: Control comes when the MPh of the units in Bypass is over (see `updateControl`), which ends no piece event.
    r.on({ id: 'asl.bypass.control', event: 'sk1.move.state', handler: (ctx) => updateControl(ctx) });

    // ---------------------------------------------------------------- A4.132 b: the road point
    // Against a unit that entered a non-Open Ground hex at the road rate the firer may trace to the centre or to where
    // the hexside crossed meets the road; with the LOS to one blocked, to the other.
    r.contribute({
      id: 'asl.road-point',
      query: 'fire.roadPoint',
      ref: 'ASLRB A4.132',
      apply(v, { target }, env) {
        const ms = moveState(env);
        if (v || !ms?.viaRoad || !ms.from || ms.hex !== target || ms.bypass) return v;
        const side = sideToward(statics(env).map, target, ms.from);
        return side === null ? v : { side };
      },
    });
    r.contribute({
      id: 'asl.road-point.los',
      query: 'fire.los',
      ref: 'ASLRB A4.132',
      apply(v, { from, decl }, env) {
        if (v.clear || decl.at) return v;
        const pt = env.query('fire.roadPoint', { target: decl.target }, null);
        if (!pt) return v;
        const alt = env.query('los.trace', { from, to: decl.target, toAt: pt }, v);
        return alt.clear ? alt : v;
      },
    });

    // ---------------------------------------------------------------- fire
    r.contribute({ id: 'asl.bypass.target-points', query: 'fire.targetPoints', ref: 'ASLRB A4.34', apply: (v, { target }, env) => [...v, ...bypassCorners(env, target)] });
    r.contribute({
      id: 'asl.bypass.los',
      query: 'fire.los',
      ref: 'ASLRB A4.34, A6.12',
      apply(v, { from, decl }, env) {
        const targets = bypassTargets(env, decl.target);
        if (targets.size === 0) return v;
        const map = statics(env).map;
        const hex = hexOfLoc(decl.target);
        const fromHex = hexOfLoc(from);
        if (fromHex === hex) return v;
        const pt = decl.at?.[fromHex];
        if (pt) {
          const k = cornerBetween(map, hex, pt[0], pt[1]);
          if (k === null) return { clear: false, hindrance: 0, parts: [], blockedBy: 'no such corner' };
          return env.query('los.trace', { from, to: decl.target, toAt: { vertex: k } }, v);
        }
        // To the hex centre the LOS must cross a hexside the stack bypassed (A4.34), when every target is in Bypass.
        const ms = moveState(env)!;
        const everyone = [...ms.units, ...(ms.stopped ?? [])].filter((u) => env.state.pieces[u]?.loc.kind === 'hex');
        if (!v.clear || !everyone.every((u) => targets.has(u))) return v;
        const bypassed = new Set([...targets.values()].flat());
        if (sidesCrossed(env, fromHex, hex).some((k) => bypassed.has(k))) return v;
        return { clear: false, hindrance: 0, parts: [], blockedBy: `the obstacle in ${hex}: a LOS to the hex centre must cross a hexside the stack bypassed (ASLRB A4.34)` };
      },
    });
    r.contribute({
      id: 'asl.bypass.fire-at',
      query: 'fire.illegal',
      layer: 50,
      ref: 'ASLRB A4.34',
      apply(v, { decl }, env) {
        if (v || !decl.at) return v;
        const corners = bypassCorners(env, decl.target).map((c) => c.join('|'));
        if (corners.length === 0) return 'Only fire at a stack in Bypass is traced to a corner (ASLRB A4.34)';
        const firing = new Set([...decl.units, ...decl.sw].map((id) => hexOfLoc(locOf(env.state, pieceOf(env, id)) ?? '')));
        for (const [h, pt] of Object.entries(decl.at)) {
          if (!firing.has(h)) return `${h} is not a firing hex of this attack`;
          if (!corners.includes([...pt].sort().join('|'))) return 'The LOS may be traced only to a corner of a hexside the stack bypassed (ASLRB A4.34)';
        }
        return null;
      },
    });
    // No woods or building TEM against Direct Fire at a stack in Bypass (B13.3, B23.31), nor the fortification's;
    // Residual FP keeps it (A8.2, note 12), and Indirect Fire keeps the woods Air Burst (B13.3).
    r.suppress<'fire.drm'>({ id: 'asl.bypass.no-tem', query: 'fire.drm', target: 'sk1.drm.tem', ref: 'ASLRB B23.31, B13.3', when: ({ attack }, env) => directFire(attack) && allInBypass(env, attack) });
    r.suppress<'fire.drm'>({ id: 'asl.bypass.no-fortified', query: 'fire.drm', target: FORTIFIED_DRM, ref: 'ASLRB B23.31', when: ({ attack }, env) => directFire(attack) && allInBypass(env, attack) });
    r.contribute({
      id: 'asl.bypass.ffmo',
      query: 'fire.drm',
      ref: 'ASLRB A4.34',
      label: '-1 FFMO: in Bypass, in the open',
      when: ({ attack }, env) => allInBypass(env, attack) && ffmoInBypass(env, attack),
      apply: (v) => v - 1,
    });
    r.contribute({
      id: 'asl.bypass.height-advantage',
      query: 'fire.drm',
      ref: 'ASLRB B10.31, A4.34',
      label: '+1 Height Advantage TEM (in Bypass)',
      when: ({ attack }, env) => allInBypass(env, attack) && heightAdvantageInBypass(env, attack),
      apply: (v) => v + 1,
    });
    // Some targets in Bypass, some in the obstacle (a unit stopped in Bypass while the rest went in): per unit.
    r.contribute({
      id: 'asl.bypass.unit',
      query: 'fire.unitDrm',
      ref: 'ASLRB A4.32, A4.34, B23.31',
      label: 'in Bypass: no obstacle TEM, FFMO',
      when: ({ attack, unit }, env) => directFire(attack) && !!attack.moving && !allInBypass(env, attack) && bypassTargets(env, attack.target).has(unit),
      apply: (v, { attack, unit }, env) => v - env.query('hex.tem', { hex: attack.target }, 0) - (ffmoInBypass(env, attack) && !(isPinned(pieceOf(env, unit)) && !isBroken(pieceOf(env, unit))) ? 1 : 0),
    });
    // A target pinned in Bypass is not subject to FFMO while pinned (A7.83), as `sk1.drm.pinned-mover` gives back the rest.
    r.contribute({
      id: 'asl.bypass.pinned',
      query: 'fire.unitDrm',
      ref: 'ASLRB A7.83',
      label: 'pinned: no FFMO',
      when: ({ attack, unit }, env) => allInBypass(env, attack) && ffmoInBypass(env, attack) && isPinned(pieceOf(env, unit)) && !isBroken(pieceOf(env, unit)),
      apply: (v) => v + 1,
    });
  },
};

/** The `MOVE_BYPASS` procedure: into Bypass, further round, or into the obstacle of the hex bypassed. */
function bypassStep(ctx: Ctx, ms: MoveState, to: LocId, via: HexId[] | undefined, cost: number) {
  const hex = hexOfLoc(to);
  const spent = Object.fromEntries(ms.units.map((u) => [u, (ms.spent[u] ?? 0) + cost]));
  const trail = cost > 0 ? [...(ms.trail ?? []), { hex, mp: cost }] : ms.trail;
  if (!via) {
    // Into the obstacle (A4.3: its whole in-hex cost). The same Location: MF and First Fire counts carry on (A8.12).
    const { bypass: _b, ...rest } = ms;
    const guns = hiddenGunsAt(ctx, hex, ctx.state.attacker);
    if (guns.length || hiddenUnitsAt(ctx, hex, ctx.state.attacker).length) {
      // Hidden units in the obstacle bar the way (SK4 6.4): found, and the stack's move ends where it stands.
      revealHex(ctx, hex, ctx.state.attacker, 'entered');
      ctx.emit('sk1.move.state', { state: { ...ms, spent, mfHere: ms.mfHere + cost, ...(trail ? { trail } : {}), halted: true } });
      moveInternals.afterMfExpenditure(ctx);
      return;
    }
    ctx.emit('sk1.move.state', { state: { ...rest, spent, mfHere: ms.mfHere + cost, ...(trail ? { trail } : {}) } satisfies MoveState });
    moveInternals.afterMfExpenditure(ctx);
    return;
  }
  const p = plan(ctx, ms, hex, via);
  if (typeof p === 'string') throw new Error(p);
  if (ms.bypass?.hex === hex) {
    // Further round the same hex: a new expenditure in the same Location (none when it costs nothing more).
    ctx.emit('sk1.move.state', { state: { ...ms, bypass: p.pos, spent, mfHere: ms.mfHere + cost, ...(trail ? { trail } : {}) } });
    if (cost > 0) moveInternals.afterMfExpenditure(ctx);
    else moveInternals.reAskMover(ctx);
    return;
  }
  // Marked in Bypass before the pieces move, so that their entering gains no Control (A26.11; `updateControl`).
  ctx.emit('sk1.move.state', { state: { ...ms, bypass: p.pos } });
  ctx.proc<MoveEnterFn>(MOVE_ENTER)(ctx, ms, hex, cost, false, { bypass: p.pos, roadOnly: false, viaRoad: false });
}
