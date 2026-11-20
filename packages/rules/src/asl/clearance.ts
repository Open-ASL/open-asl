import type { Action, Ctx, HexId, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, otherSide, personnelAt } from '../common/pieces';
import { hexOfLoc, isGroundLoc, levelOfLoc, locOf, type LocId } from '../common/location';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import { moveInternals, type MoveState } from '../sk1/movement';
import { moveLoc, moveState } from '../sk1/moveState';
import { T, fireMarker, isGoodOrder, isPinned, mmc, pieceOf, setTags, smc } from '../sk1/status';
import { T2 } from '../sk2/status';
import { clearanceDrm } from './fire';
import { removeFortification, roadblocks, shownCounter, wireAt, type FortRecord } from './fortifications';
import { laborTag, parseLabor, tiIllegal } from './labor';
import { roadblockObstacles } from './roadblocks';
import { rubbleClearable, trailBreaksAt } from './rubble';

/*
 * Clearance Tasks (ASLRB B24.7, B24.71, B24.73, B24.76, B24.8; full ASL only) for Wire, roadblocks and rubble. Flames keep their own
 * at-once DR (B24.72, `asl/fire.ts`), on the same DRM (`clearanceDrm`).
 * - Declared (B24.73, B24.76) by the ATTACKER in his MPh before any stack moves, or by the DEFENDER in the DFPh: unpinned,
 *   Good Order Infantry MMC (a leader only directs, B24.7 +y) that have not moved or fired (or directed fire) this Player
 *   Turn and are not TI; for Wire only units beneath it, for a roadblock units in either hex of its hexside. Every
 *   participant is TI at once (A4.8); a roadblock's are under Hazardous Movement too (B24.76, A4.62: -2 to attacks on
 *   them, no FFMO/FFNAM) while engaged, until their DR (B24.7). Declaring spends no MF, so it draws no Defensive First Fire
 *   (A8.1; Q&A [K33] to B24.7 & E1.21).
 * - One Task per item, Location, side and phase: a later declaration joins it (B24.7 "combined into one DR"); a roadblock's
 *   two Locations are two Tasks (B29.5 "separate stacks must use separate DR").
 * - A unit pinned, broken or gone from the Location leaves the Task (B24.7); a roadblock clearer pinned also ends its
 *   Hazardous Movement.
 * - At the end of the CCPh each Task with an MMC still engaged makes one Clearance DR: Final DR ≤ 2 removes the counter;
 *   a failure puts its MMC under Labor -1, then -2 (B24.8). No EC DRM (B24.7 †: Flames only); CX +1 (A4.51). Every Task is
 *   gone with the CCPh.
 * - Rubble (B24.71): only the ATTACKER, in his MPh, by Infantry MMC that spend all their MF to enter (the stack whose whole
 *   move is the entry into the hex) or to remain in (declared before any stack moves) a non-building hex's fallen rubble, as
 *   Hazardous Movement; the declaration names the two hexsides the TB will cross (the clearing player's choice), no two TB on
 *   the exact same hexsides (B13.4211).
 * Minefields (B24.74) and Set DC (B24.75) join this model with their counters.
 */

export const CLEARANCE_EXT = 'asl.clearance';
export type ClearanceKind = 'wire' | 'roadblock' | 'rubble';
export interface ClearanceTask {
  key: string;
  kind: ClearanceKind;
  counter: string;
  loc: LocId;
  side: SideId;
  units: PieceId[];
  director?: PieceId;
  phase: string;
  /** Rubble (B24.71): the two hexsides of the hex the TB will cross, the clearing player's choice. */
  hexsides?: [number, number];
}
/** `counter`: the Fortification's id; for rubble (B24.71) the rubble hex itself. */
export type ClearanceDeclare = Action & { type: 'clearance.declare'; kind: ClearanceKind; counter: string; loc: LocId; units: PieceId[]; director?: PieceId; hexsides?: [number, number] };
/** The rule each kind of Task is declared under. */
export const CLEARANCE_RULE: Record<ClearanceKind, string> = { wire: 'B24.73', roadblock: 'B24.76', rubble: 'B24.71' };
const KIND_NAME: Record<ClearanceKind, string> = { wire: 'Wire', roadblock: 'roadblock', rubble: 'rubble' };

export const clearanceTasks = (env: QueryEnv): ClearanceTask[] => ((env.state.ext[CLEARANCE_EXT] as { tasks: ClearanceTask[] } | undefined)?.tasks ?? []);
/** The Labor key of a Task (B24.8): the kind and its Location. */
export const clearanceLaborKey = (kind: ClearanceKind, loc: LocId) => `${kind}:${loc}`;

/**
 * Whose Clearance declaration of `kind` it could be now: Wire and roadblocks, the ATTACKER's in his MPh before a stack moves
 * and the DEFENDER's in the DFPh; rubble only the ATTACKER's MPh (B24.71: "by expending ALL of their MF to enter (or remain
 * in) the hex during their MPh"), also by the stack moving now.
 */
export function clearanceSideFor(env: QueryEnv, kind: ClearanceKind): SideId | null {
  if (kind === 'rubble') return env.state.phase === 'MPh' ? env.state.attacker : null;
  return clearanceSide(env);
}
/** Whose Wire or roadblock Clearance declaration it could be now: the ATTACKER's in his MPh before a stack moves, the DEFENDER's in the DFPh. */
export function clearanceSide(env: QueryEnv): SideId | null {
  if (env.state.phase === 'MPh') return moveState(env) ? null : env.state.attacker;
  if (env.state.phase === 'DFPh') return otherSide(env.state, env.state.attacker);
  return null;
}

/** The counters of `loc` `side` may declare a Task against: Wire in its hex, roadblocks on a hexside of it (known to it). */
export function clearanceTargets(env: QueryEnv, loc: LocId, side: SideId): { kind: ClearanceKind; counter: { id: string } }[] {
  if (!isGroundLoc(loc)) return [];
  const hex = hexOfLoc(loc);
  const out: { kind: ClearanceKind; counter: { id: string } }[] = [];
  if (rubbleClearable(env, hex)) out.push({ kind: 'rubble', counter: { id: hex } });
  const w = wireAt(env, hex);
  if (w && shownCounter(w, side)) out.push({ kind: 'wire', counter: w });
  for (const o of roadblockObstacles(env)) {
    if (o.a !== hex && o.b !== hex) continue;
    const c = roadblocks(env).find((x) => x.id === o.id);
    if (c && shownCounter(c, side)) out.push({ kind: 'roadblock', counter: c });
  }
  return out;
}

/** Why `p` may not take part in a Clearance Task of `kind` in `loc` now (B24.7, B24.73, B24.76), or null. */
export function clearanceUnitIllegal(env: QueryEnv, p: Piece, kind: ClearanceKind, loc: LocId, asDirector = false): string | null {
  if (locOf(env.state, p) !== loc) return `${p.id} is not in ${loc}`;
  if (asDirector ? defOf(env, p).kind !== 'leader' : !mmc(env, p)) return asDirector ? `${p.id} is not a leader` : `${p.id} is not an Infantry MMC: a leader may only direct (ASLRB B24.7)`;
  if (!isGoodOrder(env, p) || isPinned(p)) return `${p.id} must be unpinned and in Good Order (ASLRB B24.7)`;
  const rule = CLEARANCE_RULE[kind];
  if (kind === 'rubble') {
    // B24.71: all of its MF spent to enter (or remain in) the rubble hex: the stack moving now may declare once its whole
    // move is the entry into this hex; any other unit only before it moves.
    const ms = moveState(env);
    if (ms?.units.includes(p.id)) {
      if (moveLoc(ms) !== loc || ms.hexesEntered !== 1 || (ms.spent[p.id] ?? 0) !== ms.mfHere) return `${p.id} must spend all of its MF entering (or remaining in) the rubble hex (ASLRB B24.71)`;
    } else if (p.tags[T.moved]) return `${p.id} has moved this Player Turn: all of its MF go to entering or remaining in the rubble hex (ASLRB B24.71)`;
    else if (ms) return 'A unit remaining in the rubble hex declares before any stack moves (ASLRB B24.71)';
  } else if (p.tags[T.moved]) return `${p.id} has moved this Player Turn (ASLRB ${rule})`;
  if (fireMarker(p) || p.tags[T.firedSw]) return `${p.id} has fired this Player Turn (ASLRB ${rule})`;
  const ti = tiIllegal(p);
  if (ti) return ti;
  if (p.tags[T2.manhandled]) return `${p.id} is manhandling a Gun`;
  if (kind === 'wire' && p.loc.kind === 'hex' && p.loc.pos?.wire !== 'beneath') return `${p.id} is on top of the Wire: only units beneath it clear it (ASLRB B24.73)`;
  return null;
}

/** Why a declaration is refused, or null. */
export function clearanceIllegal(env: QueryEnv, a: { kind: ClearanceKind; counter: string; loc: LocId; units: PieceId[]; director?: PieceId; side: SideId; hexsides?: [number, number] }): string | null {
  const side = clearanceSideFor(env, a.kind);
  if (!side)
    return a.kind === 'rubble'
      ? 'Rubble is cleared by spending all MF in the hex in your own MPh (ASLRB B24.71)'
      : env.state.phase === 'MPh'
        ? 'Clearance is declared before any stack moves in the MPh, or in the DFPh (ASLRB B24.73, B24.76)'
        : 'Clearance is declared in the MPh or the DFPh (ASLRB B24.73, B24.76)';
  if (a.side !== side) return 'Not your phase';
  if (!clearanceTargets(env, a.loc, side).some((t) => t.kind === a.kind && t.counter.id === a.counter))
    return a.kind === 'rubble' ? `No fallen rubble to clear in ${a.loc}: only a non-building hex's rubble, with a hexside not yet crossed by a TB (ASLRB B24.71)` : `No ${KIND_NAME[a.kind]} to clear from ${a.loc}`;
  if (a.kind === 'rubble') {
    const k = a.hexsides;
    if (!k || k.length !== 2 || k[0] === k[1] || k.some((x) => !Number.isInteger(x) || x < 0 || x > 5)) return 'Name the two hexsides the Trail Break will cross (ASLRB B24.71)';
    if (trailBreaksAt(env, hexOfLoc(a.loc)).some((t) => t.includes(k[0]) && t.includes(k[1]))) return 'No two Trail Breaks mark the exact same hexsides (ASLRB B13.4211)';
    const ms = moveState(env);
    if (ms && a.units.some((u) => !ms.units.includes(u))) return 'Only the units of the stack moving now may join it now (ASLRB B24.71)';
    if (ms && ms.units.some((u) => !a.units.includes(u) && u !== a.director)) return 'The whole moving stack spends its MF in the rubble hex: declare it for every unit (ASLRB B24.71)';
  } else if (a.hexsides) return 'Only a rubble Clearance names hexsides';
  if (!a.units.length) return 'At least one MMC must take part in a Clearance attempt (ASLRB B24.7)';
  const all = [...a.units, ...(a.director ? [a.director] : [])];
  if (new Set(all).size !== all.length) return 'A unit is listed twice';
  for (const id of a.units) {
    const p = env.state.pieces[id];
    if (!p || p.side !== side) return `${id} is not your unit`;
    const why = clearanceUnitIllegal(env, p, a.kind, a.loc);
    if (why) return why;
  }
  if (a.director) {
    const d = env.state.pieces[a.director];
    if (!d || d.side !== side) return `${a.director} is not your unit`;
    const why = clearanceUnitIllegal(env, d, a.kind, a.loc, true);
    if (why) return why;
    const task = clearanceTasks(env).find((t) => t.key === taskKey(a.kind, a.counter, a.loc, side, env.state.phase));
    if (task?.director && task.director !== a.director) return 'One leader directs a Clearance DR (ASLRB B24.7)';
  }
  return null;
}

const taskKey = (kind: ClearanceKind, counter: string, loc: LocId, side: SideId, phase: string) => `${kind}|${counter}|${loc}|${side}|${phase}`;

/** The two hexsides a rubble Task names by default (B24.71): the first two not yet crossed by a TB, else the first pair no TB marks. */
export function defaultTbHexsides(env: QueryEnv, hex: HexId): [number, number] {
  const tbs = trailBreaksAt(env, hex);
  const used = new Set(tbs.flat());
  const free = [0, 1, 2, 3, 4, 5].filter((k) => !used.has(k));
  if (free.length >= 2) return [free[0]!, free[1]!];
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) if ((free.length === 0 || a === free[0] || b === free[0]) && !tbs.some((t) => t.includes(a) && t.includes(b))) return [a, b];
  return [0, 1];
}

/** The units that may take part in a Task of `kind` in `loc` now, for the declaration panel and the default declaration. */
export function clearanceCandidates(env: QueryEnv, kind: ClearanceKind, loc: LocId, side: SideId): { mmcs: Piece[]; leaders: Piece[] } {
  const here = personnelAt(env, loc, side).sort(byId);
  return { mmcs: here.filter((p) => !clearanceUnitIllegal(env, p, kind, loc)), leaders: here.filter((p) => !clearanceUnitIllegal(env, p, kind, loc, true)) };
}

/** The DRM a Task would have now (B24.7), for the panel and the DR. */
export const taskDrm = (env: QueryEnv, t: Pick<ClearanceTask, 'kind' | 'loc' | 'units' | 'director'>) => clearanceDrm(env, t.loc, t.units, t.director, { task: clearanceLaborKey(t.kind, t.loc), ec: false });

function setTasks(ctx: Ctx, tasks: ClearanceTask[]) {
  ctx.emit('asl.clearance.tasks', { tasks });
}

/** The Clearance DRs at the end of the CCPh (B24.73, B24.76): one per Task with an MMC still engaged; then every Task is gone. */
function rollTasks(ctx: Ctx) {
  const tasks = clearanceTasks(ctx);
  if (!tasks.length) return;
  for (const t of tasks) {
    const units = t.units.filter((u) => {
      const p = ctx.state.pieces[u];
      return !!p && locOf(ctx.state, p) === t.loc && isGoodOrder(ctx, p) && !isPinned(p);
    });
    const director = t.director && ctx.state.pieces[t.director] && locOf(ctx.state, ctx.state.pieces[t.director]!) === t.loc && isGoodOrder(ctx, ctx.state.pieces[t.director]!) && !isPinned(ctx.state.pieces[t.director]!) ? t.director : undefined;
    const counter = t.kind === 'rubble' ? (rubbleClearable(ctx, hexOfLoc(t.loc)) ? { id: t.counter } : undefined) : [...roadblocks(ctx), ...(wireAt(ctx, hexOfLoc(t.loc)) ? [wireAt(ctx, hexOfLoc(t.loc))!] : [])].find((c) => c.id === t.counter);
    if (!counter || !units.some((u) => mmc(ctx, pieceOf(ctx, u)))) {
      ctx.emit('asl.clearance.dr', { task: t, units, abandoned: true });
      continue;
    }
    const { drm, explain, labor } = taskDrm(ctx, { ...t, units, ...(director ? { director } : {}) });
    const roll = ctx.roll(`Clearance DR: ${KIND_NAME[t.kind]} in ${t.loc} (ASLRB ${CLEARANCE_RULE[t.kind]})`);
    const success = roll.total + drm <= 2;
    const key = clearanceLaborKey(t.kind, t.loc);
    let nextLabor: number | undefined;
    if (success) {
      for (const p of personnelAt(ctx, t.loc, t.side)) if (parseLabor(p.tags['labor'])?.task === key) setTags(ctx, p.id, { labor: null });
    } else {
      nextLabor = Math.max(-2, labor - 1);
      for (const u of units) if (mmc(ctx, pieceOf(ctx, u))) setTags(ctx, u, { labor: laborTag(key, nextLabor) });
    }
    ctx.emit('asl.clearance.dr', { task: t, units, ...(director ? { director } : {}), dr: roll.dice as [number, number], drm, explain, success, ...(nextLabor !== undefined ? { labor: nextLabor } : {}) });
    // The units are engaged in the Task until its DR: their Hazardous Movement ends with it (B24.7; Q&A [K33] to B24.7 & E1.21).
    for (const u of [...units, ...(director ? [director] : [])]) if (ctx.state.pieces[u]?.tags[T2.hazardous]) setTags(ctx, u, { [T2.hazardous]: null });
    if (success && t.kind === 'rubble') {
      // B24.71: a TB across the two hexsides chosen; once every hexside is crossed, the rubble and the TB are removed.
      const hex = hexOfLoc(t.loc);
      const tbs: [number, number][] = [...trailBreaksAt(ctx, hex), t.hexsides ?? defaultTbHexsides(ctx, hex)];
      const all = new Set(tbs.flat()).size === 6;
      ctx.emit('asl.tb', { hex, tbs: all ? [] : tbs, ...(all ? { cleared: true as const } : {}) });
    } else if (success) removeFortification(ctx, counter.id, `cleared (ASLRB ${CLEARANCE_RULE[t.kind]})`);
  }
  setTasks(ctx, []);
}

export const aslClearanceModule: RuleModule = {
  id: 'asl.clearance',
  ref: 'ASLRB B24.7, B24.73, B24.76, B24.8, A4.62',
  summary: 'Clearance Tasks for Wire and roadblocks: declared in the MPh or DFPh (TI; Hazardous Movement for a roadblock), one DR at the end of the CCPh, Labor.',
  requires: ['asl.labor', 'asl.fire', 'asl.wire', 'asl.roadblocks', 'asl.rubble', 'sk1.movement'],
  install(r) {
    r.event<{ tasks: ClearanceTask[] }>({
      type: 'asl.clearance.tasks',
      apply(d, p) {
        if (p.tasks.length) d.ext[CLEARANCE_EXT] = { tasks: p.tasks };
        else delete d.ext[CLEARANCE_EXT];
      },
    });
    r.event<{ task: ClearanceTask; joined?: true }>({ type: 'asl.clearance.declared', apply() {} });
    r.event<{ task: ClearanceTask; units: PieceId[]; director?: PieceId; dr?: [number, number]; drm?: number; explain?: string[]; success?: boolean; labor?: number; abandoned?: true }>({ type: 'asl.clearance.dr', apply() {} });

    r.action<ClearanceDeclare>({
      type: 'clearance.declare',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const side = clearanceSideFor(env, 'rubble') ?? clearanceSide(env);
        if (!side) return [];
        const out: ClearanceDeclare[] = [];
        const locs = new Set<LocId>();
        for (const p of Object.values(env.state.pieces)) if (p.side === side && p.loc.kind === 'hex' && !p.loc.level && !p.loc.sub) locs.add(p.loc.hex);
        for (const loc of [...locs].sort()) {
          for (const t of clearanceTargets(env, loc, side)) {
            const { mmcs, leaders } = clearanceCandidates(env, t.kind, loc, side);
            if (!mmcs.length) continue;
            const ms = t.kind === 'rubble' ? moveState(env) : undefined;
            const units = ms ? ms.units.filter((u) => mmcs.some((p) => p.id === u)) : mmcs.map((p) => p.id);
            const director = ms ? leaders.find((l) => ms.units.includes(l.id)) : leaders[0];
            const a = { type: 'clearance.declare', kind: t.kind, counter: t.counter.id, loc, units, ...(director ? { director: director.id } : {}), ...(t.kind === 'rubble' ? { hexsides: defaultTbHexsides(env, hexOfLoc(loc)) } : {}) } as ClearanceDeclare;
            if (!clearanceIllegal(env, { ...a, side })) out.push(a);
          }
        }
        return out;
      },
      validate: (env, a) => clearanceIllegal(env, a),
      resolve(ctx, a) {
        const side = a.side;
        const phase = ctx.state.phase;
        const key = taskKey(a.kind, a.counter, a.loc, side, phase);
        const tasks = clearanceTasks(ctx);
        const old = tasks.find((t) => t.key === key);
        const task: ClearanceTask = old
          ? { ...old, units: [...new Set([...old.units, ...a.units])].sort(), ...(old.director ?? a.director ? { director: old.director ?? a.director } : {}) }
          : { key, kind: a.kind, counter: a.counter, loc: a.loc, side, units: [...a.units].sort(), ...(a.director ? { director: a.director } : {}), phase, ...(a.hexsides ? { hexsides: a.hexsides } : {}) };
        setTasks(ctx, [...tasks.filter((t) => t.key !== key), task]);
        const all = [...a.units, ...(a.director ? [a.director] : [])].sort();
        // TI at once (A4.8); a roadblock's clearers are under Hazardous Movement as well (B24.76, A4.62).
        const hazardous = a.kind === 'roadblock' || a.kind === 'rubble';
        for (const id of all) setTags(ctx, id, { ti: true, ...(hazardous ? { [T2.hazardous]: true } : {}) });
        ctx.emit('asl.clearance.declared', { task, ...(old ? { joined: true as const } : {}) });
        const ms = moveState(ctx);
        if (a.kind === 'rubble' && ms) {
          // The stack moving now spends the rest of its MF in the rubble hex (B24.71) as Hazardous Movement: its move is over,
          // and the DEFENDER may First Fire at it on that expenditure (A4.62: -2, no FFNAM or FFMO).
          const left = Math.max(0, ...ms.units.map((u) => moveInternals.remaining(ms, u)));
          moveInternals.spendInPlace(ctx, ms, left, { halted: true, hazardous: true });
          const now = moveState(ctx)!;
          ctx.emit('sk1.move.state', { state: { ...now, spent: Object.fromEntries(now.units.map((u) => [u, now.allowance[u] ?? now.spent[u] ?? 0])) } });
          moveInternals.afterMfExpenditure(ctx);
          return;
        }
        ctx.popDecision();
        if (a.kind === 'rubble' && phase === 'MPh') {
          // Units remaining in the rubble hex spend ALL of their MF there (B24.71) as Hazardous Movement: the DEFENDER may
          // First Fire at them on that expenditure (-2, no FFNAM or FFMO); they stay where they are.
          const lvl = levelOfLoc(a.loc);
          const zero = Object.fromEntries(all.map((u) => [u, 0]));
          const clearing: MoveState = { units: [], stopped: all, started: all, hex: hexOfLoc(a.loc), ...(lvl ? { level: lvl } : {}), allowance: zero, spent: zero, doubleTime: false, assault: false, hexesEntered: 0, roadOnly: false, viaRoad: false, mfHere: 1, firedHere: {}, residualDrmHere: null, smokeTried: false, leaderBonus: [], halted: true, hazardous: true, from: null, trail: [] };
          ctx.emit('sk1.move.state', { state: clearing });
          moveInternals.offerFirstFire(ctx);
          return;
        }
        // A roadblock Task spends no MF: no Defensive First Fire is drawn by declaring it (A8.1; Q&A [K33] to B24.7 & E1.21,
        // the Flame case: no MF, so no fire before the DR). Its Hazardous Movement meets the attacks made on the units until
        // their DR (the DEFENDER's DFPh after an MPh declaration).
        askPhaseOwner(ctx, side);
      },
    });

    // A unit pinned or no longer Good Order leaves its Task (B24.7); a roadblock clearer pinned ends its Hazardous Movement.
    r.on<{ id: PieceId; tags: Record<string, unknown> }>({
      id: 'asl.clearance.dropOut',
      event: 'piece.tagged',
      handler(ctx, ev) {
        if (ev.payload.tags['pinned'] !== true && ev.payload.tags['broken'] !== true) return;
        const tasks = clearanceTasks(ctx);
        const id = ev.payload.id;
        if (!tasks.some((t) => t.units.includes(id) || t.director === id)) return;
        const p = ctx.state.pieces[id];
        if (p && p.tags[T2.hazardous] && tasks.some((t) => (t.kind === 'roadblock' || t.kind === 'rubble') && (t.units.includes(id) || t.director === id))) setTags(ctx, id, { [T2.hazardous]: null });
        setTasks(
          ctx,
          tasks.map((t) => {
            const { director: d, ...rest } = t;
            return { ...rest, units: t.units.filter((u) => u !== id), ...(d && d !== id ? { director: d } : {}) };
          }),
        );
      },
    });
    // A4.62's -2 against roadblock clearers, named for what they are doing (the SK4 6.5 contribution says manhandling).
    const roadblockClearer = (env: QueryEnv, unit: PieceId) => clearanceTasks(env).some((t) => (t.kind === 'roadblock' || t.kind === 'rubble') && (t.units.includes(unit) || t.director === unit));
    r.suppress({ id: 'asl.clearance.not-sk-hazardous', query: 'fire.unitDrm', target: 'sk2.drm.hazardous', ref: 'ASLRB B24.76', when: ({ unit }, env) => roadblockClearer(env, unit) });
    r.contribute({
      id: 'asl.clearance.hazardous',
      query: 'fire.unitDrm',
      ref: 'ASLRB B24.76, A4.62',
      label: ({ unit }, env) => `-2 Hazardous Movement (clearing ${clearanceTasks(env).some((t) => t.kind === 'rubble' && (t.units.includes(unit) || t.director === unit)) ? 'rubble, ASLRB B24.71' : 'a roadblock, ASLRB B24.76'})`,
      when: ({ unit }, env) => roadblockClearer(env, unit) && pieceOf(env, unit).tags[T2.hazardous] === true,
      apply: (v) => v - 2,
    });
    // The DRs at the end of the CCPh, before TI comes off (B24.73, B24.76); this module's handler runs on the event itself.
    r.on<{ phase: string }>({
      id: 'asl.clearance.ccphEnd',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase === 'CCPh') rollTasks(ctx);
      },
    });
    // The other side learns of a Task against a counter still hidden from it only when the counter is revealed.
    r.redact({
      id: 'asl.clearance.redact',
      ext: CLEARANCE_EXT,
      redactExt(slice, viewer, env) {
        const st = slice as { tasks: ClearanceTask[] };
        const tasks = st.tasks.filter((t) => t.side === viewer || t.kind === 'rubble' || [...roadblocks(env), wireAt(env, hexOfLoc(t.loc))].some((c) => c && c.id === t.counter && shownCounter(c, viewer)));
        return tasks.length ? { tasks } : undefined;
      },
      events: ['asl.clearance.declared', 'asl.clearance.dr'],
      redactEvent(ev, viewer, env) {
        const t = (ev.payload as { task: ClearanceTask }).task;
        if (t.side === viewer || t.kind === 'rubble') return ev;
        const c = [...roadblocks(env), wireAt(env, hexOfLoc(t.loc))].find((x) => x && x.id === t.counter);
        return !c || shownCounter(c, viewer) ? ev : null;
      },
    });
    void smc;
  },
};

/** The pending Task (if any) of a Location, for the board's chit tag and the orders panel. */
export const pendingTasksAt = (env: QueryEnv, hex: HexId): ClearanceTask[] => clearanceTasks(env).filter((t) => hexOfLoc(t.loc) === hex);
