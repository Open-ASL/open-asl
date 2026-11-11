import { cubeDistance, cubeNeighbors, type Action, type Cube, type Ctx, type Decision, type HexId, type PieceId, type QueryEnv, type RuleModule, type SideId } from '@asl/engine';
import { byId, statics } from '../common/pieces';
import { mmc, pieceOf, setTags, smc, T } from './status';

/*
 * A setup by scatter (S22 SSR 1 and 3: paratroopers formed up around a "rendezvous" hex). The side
 * divides any pool forces between its groups, splits each group into stacks of at most one MMC, one
 * SMC and one SW, and picks a different rendezvous hex for each group: the first openly, the others
 * secretly. Each stack of a group is then placed by two dice from its group's rendezvous hex: the
 * colored die gives the direction (1 the card's north, 2 one hexside clockwise, and so on), the white
 * die the distance in hexes. A stack that lands off the map is placed on the nearest map edge hex and
 * starts the game pinned and CX.
 *
 * A group marked `later` is rolled in a step of its own below the plan, after any setup steps the
 * other rules put between them (S22: the German secret entry choices of SSR 2 come before Group 2
 * lands). Until a group is rolled its counters wait offboard (`edge: 'scatter'`). The secret
 * rendezvous hexes and the stacks of the groups still to land are hidden by the client only: the
 * module's redactor keeps the plan out of the other seat's online view until each group lands.
 */

export const SCATTER_MODULE = 'scatter-setup';
export const SCATTER_PLAN_DECISION = 'scatterPlan';
export const SCATTER_ROLL_DECISION = 'scatterRoll';
const EXT = 'ssr.scatter';

export interface ScatterGroup {
  /** The force whose counters make up the group. */
  force: string;
  /** The card's name for it, e.g. 'Group 1'. */
  label: string;
  /** Rolled in its own step after the other setup steps (S22 SSR 3), not with the plan. */
  later?: boolean;
  /** The rule that places it, e.g. 'SSR 3'. */
  rule?: string;
}

export interface ScatterParams {
  side: SideId;
  groups: ScatterGroup[];
  /** Forces the player divides "in any way" between the groups. */
  pool?: string[];
  /** Most MMC, SMC and SW in one stack. */
  stack: { mmc: number; smc: number; sw: number };
  /** The card's name for the rule, e.g. 'SSR 1'. */
  rule?: string;
}

/** The player's plan: each group's stacks (piece ids), and each group's rendezvous hex. */
export interface ScatterPlan {
  groups: PieceId[][][];
  rendezvous: HexId[];
}

export type ScatterPlanAction = Action & ScatterPlan;

export interface ScatterState extends ScatterPlan {
  side: SideId;
  /** Indexes of the groups already on the map. */
  rolled: number[];
}

export interface ScatterLanding {
  side: SideId;
  group: number;
  label: string;
  rule: string;
  stack: PieceId[];
  from: HexId;
  /** [white, colored]. */
  dice: [number, number];
  /** 1 (north) to 6, clockwise. */
  direction: number;
  distance: number;
  to: HexId;
  /** The roll took the stack off the map: it was put on the nearest edge hex, pinned and CX. */
  offMap: boolean;
}

export function scatterParams(env: QueryEnv): ScatterParams | null {
  const s = statics(env).scenario.ssr.find((r) => r.module === SCATTER_MODULE);
  return s ? (s.params as unknown as ScatterParams) : null;
}

export const scatterState = (env: QueryEnv): ScatterState | null => (env.state.ext[EXT] as ScatterState | undefined) ?? null;

const forceIndex = (env: QueryEnv, id: string) => statics(env).scenario.forces.findIndex((f) => f.id === id);

/** The counters of a force waiting to be scattered (units and the SW they hold), in id order. */
function forcePieces(env: QueryEnv, force: string): PieceId[] {
  const fi = forceIndex(env, force);
  const units = Object.values(env.state.pieces).filter((p) => p.tags['force'] === fi && p.loc.kind === 'offboard' && p.loc.edge === 'scatter');
  const ids = new Set(units.map((p) => p.id));
  const held = Object.values(env.state.pieces).filter((p) => p.loc.kind === 'held' && ids.has(p.loc.by));
  return [...units, ...held].sort(byId).map((p) => p.id);
}

/** Which group each counter must join (`null`: a pool counter, either group). */
export function scatterMembers(env: QueryEnv): { piece: PieceId; group: number | null }[] {
  const p = scatterParams(env);
  if (!p) return [];
  return [
    ...p.groups.flatMap((g, gi) => forcePieces(env, g.force).map((piece) => ({ piece, group: gi as number | null }))),
    ...(p.pool ?? []).flatMap((f) => forcePieces(env, f).map((piece) => ({ piece, group: null }))),
  ];
}

export type ScatterKind = 'mmc' | 'smc' | 'sw';
export function scatterKind(env: QueryEnv, id: PieceId): ScatterKind {
  const p = pieceOf(env, id);
  if (mmc(env, p)) return 'mmc';
  if (smc(env, p)) return 'smc';
  return 'sw';
}

const KIND_NAME: Record<ScatterKind, string> = { mmc: 'MMC', smc: 'SMC', sw: 'SW' };

/** Why a stack breaks the card's limits, or null. */
export function stackIllegal(env: QueryEnv, stack: PieceId[]): string | null {
  const p = scatterParams(env);
  if (!p) return 'No scatter setup in this scenario';
  if (stack.length === 0) return 'A stack needs at least one counter';
  for (const k of ['mmc', 'smc', 'sw'] as const) {
    const n = stack.filter((id) => scatterKind(env, id) === k).length;
    if (n > p.stack[k]) return `No more than ${p.stack[k]} ${KIND_NAME[k]} in a stack`;
  }
  return null;
}

/** Why a plan is illegal, or null. `partial` allows counters not yet put in a stack (a plan being built). */
export function scatterPlanIllegal(env: QueryEnv, side: SideId, plan: ScatterPlan, partial = false): string | null {
  const p = scatterParams(env);
  if (!p || p.side !== side) return 'This side does not set up by scatter';
  if (plan.groups.length !== p.groups.length) return `Divide the units into ${p.groups.length} groups`;
  const members = new Map(scatterMembers(env).map((m) => [m.piece, m.group]));
  const seen = new Set<PieceId>();
  for (const [gi, stacks] of plan.groups.entries()) {
    for (const stack of stacks) {
      const why = stackIllegal(env, stack);
      if (why) return `${p.groups[gi]!.label}: ${why}`;
      for (const id of stack) {
        if (!members.has(id)) return `${id} does not set up by scatter`;
        if (seen.has(id)) return `${id} is in two stacks`;
        seen.add(id);
        const g = members.get(id);
        if (g !== null && g !== gi) return `${id} belongs to ${p.groups[g!]!.label}`;
      }
    }
  }
  if (!partial && seen.size !== members.size) return 'Put every unit and SW in a stack';
  const map = statics(env).map;
  const hexes = plan.rendezvous.map((h) => map.hex(h)?.id);
  if (!partial || plan.rendezvous.length) {
    if (hexes.length !== p.groups.length || hexes.some((h) => !h)) return `Pick a rendezvous hex for each group`;
    if (new Set(hexes).size !== hexes.length) return 'Each group needs a different rendezvous hex';
  }
  return null;
}

/** A plan the engine accepts as is: pool counters shared out, one MMC, SMC and SW per stack, rendezvous hexes near the middle. */
export function defaultScatterPlan(env: QueryEnv): ScatterPlan {
  const p = scatterParams(env)!;
  const members = scatterMembers(env);
  const byGroup: PieceId[][] = p.groups.map((_, gi) => members.filter((m) => m.group === gi).map((m) => m.piece));
  members.filter((m) => m.group === null).forEach((m, i) => byGroup[i % p.groups.length]!.push(m.piece));
  const groups = byGroup.map((ids) => {
    const of = (k: ScatterKind) => ids.filter((id) => scatterKind(env, id) === k);
    const lists = [of('mmc'), of('smc'), of('sw')];
    const stacks: PieceId[][] = [];
    for (const [k, list] of lists.entries()) {
      const cap = [p.stack.mmc, p.stack.smc, p.stack.sw][k]!;
      list.forEach((id, i) => {
        const si = Math.floor(i / cap);
        (stacks[si] ??= []).push(id);
      });
    }
    return stacks;
  });
  const map = statics(env).map;
  const all = [...map.hexes()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const qs = all.map((h) => h.cube.q);
  const rs = all.map((h) => h.cube.r);
  const mid = { q: Math.round((Math.min(...qs) + Math.max(...qs)) / 2), r: Math.round((Math.min(...rs) + Math.max(...rs)) / 2) };
  const centre = all.reduce((best, h) => (dist2(h.cube, mid) < dist2(best.cube, mid) ? h : best));
  const rendezvous = p.groups.map((_, gi) => {
    const want = { q: centre.cube.q + gi * 6, r: centre.cube.r - gi * 3 };
    return all.reduce((best, h) => (dist2(h.cube, want) < dist2(best.cube, want) ? h : best)).id;
  });
  return { groups, rendezvous };
}
const dist2 = (c: { q: number; r: number }, m: { q: number; r: number }) => cubeDistance(c as Cube, { q: m.q, r: m.r, s: -m.q - m.r });

/** Direction index (0 = north of the assembled map, clockwise) of the card's north, from the scenario compass. */
export function northIndex(env: QueryEnv): number {
  const n = statics(env).scenario.compass?.N ?? 'N';
  // A card whose north is a hexspine (boards turned 90°) has no straight north: the next hexside clockwise stands in.
  return { N: 0, E: 1, S: 3, W: 4 }[n] ?? 0;
}

/** Roll for and place every stack of a group. */
function land(ctx: Ctx, gi: number) {
  const p = scatterParams(ctx)!;
  const st = scatterState(ctx)!;
  const g = p.groups[gi]!;
  const map = statics(ctx).map;
  const from = map.hex(st.rendezvous[gi]!)!;
  const rule = g.rule ?? p.rule ?? 'SSR';
  const edgeHexes = map.edge('N,E,S,W').map((h) => map.hex(h)!);
  for (const [si, stack] of st.groups[gi]!.entries()) {
    const [white, colored] = ctx.roll(`${rule}: ${g.label} stack ${si + 1} of ${st.groups[gi]!.length} (colored: direction, white: distance)`, 2).dice as [number, number];
    const dir = (northIndex(ctx) + colored - 1) % 6;
    let c: Cube = from.cube;
    for (let i = 0; i < white; i++) c = cubeNeighbors(c)[dir]!;
    const onMap = [...map.hexes()].find((h) => h.cube.q === c.q && h.cube.r === c.r);
    const to = onMap ?? edgeHexes.reduce((best, h) => (cubeDistance(h.cube, c) < cubeDistance(best.cube, c) || (cubeDistance(h.cube, c) === cubeDistance(best.cube, c) && h.id < best.id) ? h : best));
    const landing: ScatterLanding = { side: p.side, group: gi, label: g.label, rule, stack, from: from.id, dice: [white, colored], direction: colored, distance: white, to: to.id, offMap: !onMap };
    ctx.emit('ssr.scatter.landed', landing);
    const units = stack.filter((id) => scatterKind(ctx, id) !== 'sw');
    const holder = units.find((id) => scatterKind(ctx, id) === 'mmc') ?? units[0];
    for (const id of units) ctx.emit('piece.moved', { id, loc: { kind: 'hex', hex: to.id } });
    for (const id of stack.filter((x) => scatterKind(ctx, x) === 'sw')) {
      const now = pieceOf(ctx, id).loc;
      if (holder && now.kind === 'held' && now.by === holder) continue;
      ctx.emit('piece.moved', { id, loc: holder ? { kind: 'held', by: holder } : { kind: 'hex', hex: to.id } });
    }
    if (!onMap) for (const id of units) setTags(ctx, id, { [T.pinned]: true, [T.cx]: true });
  }
  ctx.emit('ssr.scatter', { state: { ...scatterState(ctx)!, rolled: [...st.rolled, gi].sort() } });
}

const begin = (ctx: Ctx) => {
  if (ctx.state.decisions.length === 0) ctx.proc<(c: Ctx) => void>('sk1.scenario.begin')(ctx);
};

export const scatterSetupModule: RuleModule = {
  id: 'ssr.scatter-setup',
  ref: 'S22 SSR 1, 3',
  summary: 'Setup by scatter (SSR): stacks placed by a direction and distance roll from each group’s rendezvous hex.',
  requires: ['sk1.scenario'],
  install(r) {
    // The plan (which stacks form each group, and where each is heading) is the owner's secret until a group lands.
    const shown = (st: ScatterState, viewer: SideId | null): ScatterState =>
      viewer === st.side ? st : { ...st, groups: st.groups.map((g, i) => (st.rolled.includes(i) ? g : [])), rendezvous: st.rendezvous.map((h, i) => (st.rolled.includes(i) ? h : '')) };
    r.redact({
      id: 'ssr.scatter.redact',
      ext: EXT,
      redactExt: (slice, viewer) => shown(slice as ScatterState, viewer),
      events: ['ssr.scatter'],
      redactEvent: (ev, viewer) => ({ ...ev, payload: { state: shown((ev.payload as { state: ScatterState }).state, viewer) } }),
    });
    r.event<{ state: ScatterState }>({
      type: 'ssr.scatter',
      apply(d, p) {
        d.ext[EXT] = p.state;
      },
    });
    r.event<ScatterLanding>({ type: 'ssr.scatter.landed', apply() {} });

    // The later groups' rolls sit lowest (priority 5: below other rules' setup steps, above none of
    // the scenario's own placements, which a scatter side does not have); the plan goes on top.
    r.setup({
      id: 'ssr.scatter.later',
      priority: 5,
      run(ctx) {
        const p = scatterParams(ctx);
        if (!p) return;
        for (const [gi, g] of [...p.groups.entries()].reverse()) {
          if (g.later) ctx.pushDecision({ kind: SCATTER_ROLL_DECISION, owner: p.side, deadlineClass: 'turn', data: { group: gi } });
        }
      },
    });
    r.setup({
      id: 'ssr.scatter.plan',
      priority: 30,
      run(ctx) {
        const p = scatterParams(ctx);
        if (!p) return;
        ctx.pushDecision({ kind: SCATTER_PLAN_DECISION, owner: p.side, deadlineClass: 'turn', data: {} });
      },
    });

    r.action<ScatterPlanAction>({
      type: 'scatter.plan',
      decisionKinds: [SCATTER_PLAN_DECISION],
      legal: (env) => [{ type: 'scatter.plan', ...defaultScatterPlan(env) }],
      validate: (env, a, d) => scatterPlanIllegal(env, d.owner, a),
      resolve(ctx, a, d: Decision) {
        const map = statics(ctx).map;
        ctx.emit('ssr.scatter', { state: { side: d.owner, groups: a.groups, rendezvous: a.rendezvous.map((h) => map.hex(h)!.id), rolled: [] } });
        ctx.popDecision(d.id);
        const p = scatterParams(ctx)!;
        p.groups.forEach((g, gi) => {
          if (!g.later) land(ctx, gi);
        });
        begin(ctx);
      },
    });
    r.action<Action & { group: number }>({
      type: 'scatter.roll',
      decisionKinds: [SCATTER_ROLL_DECISION],
      legal: (_env, d) => [{ type: 'scatter.roll', group: d.data?.['group'] as number }],
      validate: (_env, a, d) => (a.group === d.data?.['group'] ? null : 'Roll for the group whose turn it is'),
      resolve(ctx, a, d: Decision) {
        ctx.popDecision(d.id);
        land(ctx, a.group);
        begin(ctx);
      },
    });
  },
};
