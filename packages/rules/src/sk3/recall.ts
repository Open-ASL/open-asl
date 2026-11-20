import type { HexId, Piece, PieceId, QueryEnv, RuleBuilder, SideId } from '@asl/engine';
import { statics } from '../common/pieces';
import { knownEnemyAt } from '../sk1/known';
import { moveInternals, moveState, type MoveState, type VehicleMoveState } from '../sk1/movement';
import { T, pieceOf } from '../sk1/status';
import { inPlay } from '../sk1/terrain';
import { arcNeighbours, spineChange } from '../sk2/arc';
import { isBogged, isRecalled, isWreck, vcaOf, vehicle } from './status';
import { vehicleEntryCost, vehicleTurnCost } from './vehicleMove';

/*
 * Recall (SK4 7.10; ASLRB D5.341): a Recalled AFV "must attempt to exit the playing area along a friendly board edge ...
 * via the shortest route in MP using Motion status ... as fast as possible". Readings:
 * - The friendly board edge (SK4 7.10, ASLRB A20.53): the edge the side's forces entered by; for a side that only set
 *   up on the map, each edge its setup area reaches that the enemy neither enters by nor sets up against, or, where its
 *   setup reaches none, each edge its forces are nearer on average than the enemy's.
 * - The shortest route is measured in MP by terrain from each hex to the edge (`recallDistances`), facing aside: every
 *   hex the AFV enters must lie on such a route, and it may leave the map off a friendly edge whatever the scenario's
 *   exit rules say (it earns no VP for it, 7.10).
 * - "As fast as possible": while it can make progress, it may not stop, Delay or end its move, and the MPh does not end
 *   until it has moved. A bogged Recalled AFV still tries to free itself (SK4 has no Abandonment, ASLRB D5.341).
 */

/** The friendly board edges of `side` (SK4 7.10; ASLRB A20.53). */
export function friendlyEdges(env: QueryEnv, side: SideId): string[] {
  const sc = statics(env).scenario;
  const map = statics(env).map;
  const entered = new Set<string>();
  for (const f of sc.forces) if (f.side === side && f.setup.kind === 'enter') entered.add(f.setup.edge);
  if (entered.size) return [...entered].sort();
  const touches = (hexes: HexId[], edge: string) => {
    const along = new Set(map.edge(edge));
    return hexes.some((h) => along.has(h));
  };
  const edges: string[] = [];
  for (const edge of ['N', 'E', 'S', 'W']) {
    if (!map.edge(edge).length) continue;
    let mine = false;
    let theirs = false;
    for (const f of sc.forces) {
      if (f.setup.kind === 'enter') {
        if (f.side !== side && f.setup.edge === edge) theirs = true;
        continue;
      }
      if (f.setup.kind !== 'area' && f.setup.kind !== 'hexes') continue;
      if (!touches(f.setup.hexes, edge)) continue;
      if (f.side === side) mine = true;
      else theirs = true;
    }
    if (mine && !theirs) edges.push(edge);
  }
  if (edges.length) return edges;
  // Set up clear of every edge (fixed hexes): the edges its forces stand in front of, nearer them on average than the
  // enemy's setup or entry hexes are.
  const hexesOf = (mine: boolean) =>
    sc.forces.filter((f) => (f.side === side) === mine).flatMap((f) => (f.setup.kind === 'enter' ? (f.setup.hexes?.length ? f.setup.hexes : map.edge(f.setup.edge)) : f.setup.kind === 'scatter' ? [] : f.setup.hexes)).filter((h) => map.hex(h));
  const own = hexesOf(true);
  const enemy = hexesOf(false);
  const mean = (hexes: HexId[], edge: string) => {
    const along = map.edge(edge);
    return hexes.reduce((a, h) => a + Math.min(...along.map((e) => map.distance(h, e))), 0) / hexes.length;
  };
  if (!own.length || !enemy.length) return [];
  return ['N', 'E', 'S', 'W'].filter((edge) => map.edge(edge).length && mean(own, edge) < mean(enemy, edge));
}

/** The offboard hexes beyond `side`'s friendly board edges. */
const friendlyExits = (env: QueryEnv, side: SideId): Set<HexId> => new Set(friendlyEdges(env, side).flatMap((e) => statics(env).map.offboard(e).map((o) => o.id)));

const cache = new WeakMap<object, Map<PieceId, Map<HexId, number>>>();

/**
 * The fewest MP the vehicle `p` needs from each hex to leave the map off a friendly board edge, by terrain (its own
 * table, a road along road hexsides), around hexes it knows hold the enemy; facing is not counted. Hexes with no
 * route are missing.
 */
export function recallDistances(env: QueryEnv, p: Piece): Map<HexId, number> {
  let byPiece = cache.get(env.state);
  if (!byPiece) cache.set(env.state, (byPiece = new Map()));
  const known = byPiece.get(p.id);
  if (known) return known;
  const map = statics(env).map;
  const dist = new Map<HexId, number>();
  const open = (h: HexId) => !!map.hex(h) && inPlay(env, h) && knownEnemyAt(env, h, p.side).length === 0;
  for (const o of friendlyExits(env, p.side)) {
    for (const h of map.offboardNeighbors(o).onboard) {
      if (!open(h)) continue;
      const c = vehicleEntryCost(env, p, h, o, { viaRoad: map.roadHexside?.(h, o) ?? false });
      if (Number.isFinite(c) && c < (dist.get(h) ?? Infinity)) dist.set(h, c);
    }
  }
  // Dijkstra outward from the edge: a hex's distance is the cost of entering a neighbour plus that neighbour's.
  const done = new Set<HexId>();
  for (;;) {
    let n: HexId | null = null;
    for (const [h, d] of dist) if (!done.has(h) && (n === null || d < dist.get(n)!)) n = h;
    if (n === null) break;
    done.add(n);
    const dn = dist.get(n)!;
    for (const h of map.neighbors(n)) {
      if (done.has(h) || !open(h)) continue;
      const c = vehicleEntryCost(env, p, h, n, { viaRoad: map.roadHexside?.(h, n) ?? false });
      if (Number.isFinite(c) && dn + c < (dist.get(h) ?? Infinity)) dist.set(h, dn + c);
    }
  }
  byPiece.set(p.id, dist);
  return dist;
}

const EPS = 1e-6;

/** Why the Recalled vehicle `p` may not step from `from` into map hex `to`: it is off every shortest route to its edge. */
export function recallStepIllegal(env: QueryEnv, p: Piece, from: HexId, to: HexId): string | null {
  const dist = recallDistances(env, p);
  const here = dist.get(from);
  if (here === undefined) return null;
  const map = statics(env).map;
  const there = dist.get(to);
  const c = vehicleEntryCost(env, p, from, to, { viaRoad: map.roadHexside?.(from, to) ?? false });
  if (there !== undefined && there + c <= here + EPS) return null;
  return `A Recalled AFV heads for its friendly board edge by the shortest route (SK4 7.10)`;
}

/**
 * Why the moving Recalled vehicle may not stop, Delay or end its move yet: it can still make progress toward its friendly
 * board edge with the MP it has (turning first if it must), or leave the map. Null when it may.
 */
export function recallMustMoveOn(env: QueryEnv, ms: MoveState & { vehicle: VehicleMoveState }, p: Piece): string | null {
  if (!isRecalled(p) || !ms.hex || ms.halted || isBogged(p) || ms.vehicle.ending) return null;
  const dist = recallDistances(env, p);
  if (!dist.has(ms.hex)) return null;
  const map = statics(env).map;
  const left = moveInternals.remaining(ms, p.id) + (ms.vehicle.stopped ? -1 : 0);
  const at = map.hex(ms.hex)!;
  const exits = friendlyExits(env, p.side);
  for (const o of map.offboard('N,E,S,W')) {
    if (exits.has(o.id) && map.offboardNeighbors(o.id).onboard.includes(ms.hex) && vehicleEntryCost(env, p, ms.hex, o.id) <= left + EPS) return 'A Recalled AFV leaves the map now, off its friendly board edge (SK4 7.10)';
  }
  for (const to of map.neighbors(ms.hex)) {
    if (!map.hex(to) || recallStepIllegal(env, p, ms.hex, to)) continue;
    const cost = vehicleEntryCost(env, p, ms.hex, to, { viaRoad: map.roadHexside?.(ms.hex, to) ?? false, remaining: left });
    // The cheapest turn that brings the hex into its Vehicle Covered Arc.
    let turn = Infinity;
    for (let vca = 0; vca < 6; vca++) {
      const cube = map.hex(to)!.cube;
      if (!arcNeighbours(at.cube, vca).some((c) => c.q === cube.q && c.r === cube.r)) continue;
      turn = Math.min(turn, vehicleTurnCost(env, ms.hex, spineChange(vcaOf(p), vca)));
    }
    if (cost + turn <= left + EPS) return `A Recalled AFV keeps moving toward its friendly board edge while it can (SK4 7.10)`;
  }
  return null;
}

/** The attacker's Recalled AFV that has not yet moved this MPh and could set off for its edge. */
export function recalledToMove(env: QueryEnv): Piece[] {
  if (env.state.phase !== 'MPh' || moveState(env)) return [];
  return Object.values(env.state.pieces).filter(
    (p) =>
      p.side === env.state.attacker &&
      p.loc.kind === 'hex' &&
      !!vehicle(env, p) &&
      isRecalled(p) &&
      !isWreck(p) &&
      !p.tags[T.moved] &&
      !env.query('vehicle.cannotStart', { vehicle: p.id }, null) &&
      recallDistances(env, p).has(p.loc.hex),
  );
}

const onward = (env: QueryEnv, ms: MoveState) => (ms.vehicle ? recallMustMoveOn(env, ms as MoveState & { vehicle: VehicleMoveState }, pieceOf(env, ms.units[0]!)) : null);

/**
 * Installed by the vehicle movement module (`sk3.vehicleMove`), not as a module of its own: the ruleset's version hash
 * follows its module list, and live matches are pinned to it.
 */
export function installRecall(r: RuleBuilder): void {
  r.contribute({
    id: 'sk3.recall.step',
    query: 'vehicle.stepIllegal',
    layer: 900,
    apply: (v, { ms, to }, env) => {
      if (v || !ms.hex || !statics(env).map.hex(to)) return v;
      const p = pieceOf(env, ms.units[0]!);
      return isRecalled(p) ? recallStepIllegal(env, p, ms.hex, to) : null;
    },
  });
  // Off the map: only off a friendly board edge, and there whatever the scenario's exit rules say.
  r.contribute({
    id: 'sk3.recall.exit',
    query: 'move.exitIllegal',
    layer: 900,
    when: ({ ms }, env) => !!ms.vehicle && isRecalled(pieceOf(env, ms.units[0]!)),
    apply: (_v, { ms, to }, env) => {
      const p = pieceOf(env, ms.units[0]!);
      if (env.state.phase !== 'MPh') return 'Units exit during the MPh';
      if (!friendlyExits(env, p.side).has(to)) return `A Recalled AFV leaves only off its friendly board edge (${friendlyEdges(env, p.side).join(', ') || 'none'}; SK4 7.10)`;
      if (!ms.vehicle!.started) return 'The vehicle is stopped: start it first (1 MP)';
      const cost = vehicleEntryCost(env, p, ms.hex ?? null, to);
      const left = moveInternals.remaining(ms, p.id);
      return cost > left + EPS ? `Leaving the map costs ${cost} MP (${left} left)` : null;
    },
  });
  r.contribute({ id: 'sk3.recall.must-move-on', query: 'vehicle.mustMoveOn', layer: 900, apply: (v, { ms }, env) => v ?? onward(env, ms) });
  r.contribute({ id: 'sk3.recall.move-end', query: 'move.endIllegal', layer: 900, apply: (v, { ms }, env) => v ?? onward(env, ms) });
  r.contribute({
    id: 'sk3.recall.end-blocked',
    query: 'phase.endBlocked',
    when: (_c, env) => env.state.phase === 'MPh',
    apply: (v, _c, env) => {
      if (v) return v;
      const ms = moveState(env);
      if (ms) return onward(env, ms);
      const due = recalledToMove(env);
      return due.length ? `${due.map((p) => vehicle(env, p)!.name).join(', ')} is Recalled: it must move toward its friendly board edge first (SK4 7.10)` : null;
    },
  });
}
