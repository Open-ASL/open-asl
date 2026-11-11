import type { Action, Ctx, Decision, HexId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, statics } from '../common/pieces';
import { setTags } from './status';

/*
 * Groups of reinforcements a side picks secretly, each with its turn and hex of entry (S22 SSR 2:
 * "The German player then secretly chooses 3 groups and their turn of entry. The German player may
 * delay the entry of one or two groups until Turn 3. For every group delayed until Turn 3, the German
 * may bring on an additional group which also enters on Turn 3. The German player secretly records
 * the hex along any board edge on which each group will enter. Each German group enters on Turn 1 or
 * 3 on or adjacent to its recorded hex of entry.") A general rule: the parameters name the side, its
 * candidate forces, how many it picks, the two entry turns and how many picks may be delayed.
 *
 * The groups not picked take no part (their counters are set aside offboard, not eliminated). The
 * picked ones are retagged to enter on their turn from the edge(s) of their hex, onto that hex or an
 * edge hex adjacent to it. The choice is secret until a group sets up offboard to enter: the client
 * hides the waiting counters and the choice from the other side (online, the module's redactor keeps them out of the other seat's view).
 */

export const ENTRY_GROUPS_MODULE = 'entry-groups';
export const ENTRY_GROUPS_DECISION = 'entryGroups';
const EXT = 'ssr.entryGroups';

export interface EntryGroupsParams {
  side: SideId;
  /** Ids of the forces the side picks from. */
  forces: string[];
  /** How many it picks before any delay. */
  choose: number;
  /** The normal entry turn and the turn delayed groups (and the extra ones) enter on. */
  turn: number;
  laterTurn: number;
  /** Most picks that may be delayed; each delayed one brings an extra group on the later turn. */
  maxDelayed: number;
  /** The card's name for the rule, e.g. 'SSR 2'. */
  rule?: string;
}

export interface EntryPick {
  force: string;
  turn: number;
  /** The recorded map edge hex. */
  hex: HexId;
}

export type EntryGroupsAction = Action & { picks: EntryPick[] };

export interface EntryGroupsState {
  side: SideId;
  picks: EntryPick[];
}

export function entryGroupsParams(env: QueryEnv): EntryGroupsParams | null {
  const s = statics(env).scenario.ssr.find((r) => r.module === ENTRY_GROUPS_MODULE);
  return s ? (s.params as unknown as EntryGroupsParams) : null;
}

export const entryGroupsState = (env: QueryEnv): EntryGroupsState | null => (env.state.ext[EXT] as EntryGroupsState | undefined) ?? null;

/** Every hex on a map edge (any of the four). */
export const entryEdgeHexes = (env: QueryEnv): HexId[] => statics(env).map.edge('N,E,S,W');

/** The card's edges a map edge hex lies on (a corner hex is on two). */
export function edgesOf(env: QueryEnv, hex: HexId): string[] {
  const map = statics(env).map;
  const id = map.hex(hex)?.id;
  return ['N', 'E', 'S', 'W'].filter((e) => !!id && map.edge(e).includes(id));
}

/** Where a group recorded at `hex` may enter: that hex and the edge hexes adjacent to it. */
export function entryHexesFor(env: QueryEnv, hex: HexId): HexId[] {
  const map = statics(env).map;
  const id = map.hex(hex)!.id;
  const edge = new Set(entryEdgeHexes(env));
  return [id, ...map.neighbors(id).filter((n) => edge.has(n))].sort();
}

/** How many picks each turn takes: k delayed picks bring k extra groups, all on the later turn. */
export function entryCountsLegal(p: EntryGroupsParams, first: number, later: number): boolean {
  for (let k = 0; k <= p.maxDelayed; k++) if (first === p.choose - k && later === 2 * k) return true;
  return false;
}

/** Why a choice is illegal, or null. `partial` allows a choice still being made. */
export function entryGroupsIllegal(env: QueryEnv, side: SideId, picks: EntryPick[], partial = false): string | null {
  const p = entryGroupsParams(env);
  if (!p || p.side !== side) return 'This side does not pick entry groups';
  const edge = new Set(entryEdgeHexes(env));
  const map = statics(env).map;
  const seen = new Set<string>();
  for (const pick of picks) {
    if (!p.forces.includes(pick.force)) return `${pick.force} is not a group to pick`;
    if (seen.has(pick.force)) return 'Groups may only be picked once';
    seen.add(pick.force);
    if (pick.turn !== p.turn && pick.turn !== p.laterTurn) return `Groups enter on Turn ${p.turn} or ${p.laterTurn}`;
    const id = map.hex(pick.hex)?.id;
    if (!id || !edge.has(id)) return 'The entry hex must be a hex along a board edge';
  }
  if (partial) return null;
  const first = picks.filter((x) => x.turn === p.turn).length;
  const later = picks.filter((x) => x.turn === p.laterTurn).length;
  if (!entryCountsLegal(p, first, later)) {
    const options = Array.from({ length: p.maxDelayed + 1 }, (_, k) => `${p.choose - k} on Turn ${p.turn} and ${2 * k} on Turn ${p.laterTurn}`);
    return `Pick ${options.join(', or ')}`;
  }
  return null;
}

/** A legal default: the first `choose` groups on the normal turn, from the middle of the first edge hex list. */
function defaultPicks(env: QueryEnv): EntryPick[] {
  const p = entryGroupsParams(env)!;
  const edge = entryEdgeHexes(env);
  return p.forces.slice(0, p.choose).map((force, i) => ({ force, turn: p.turn, hex: edge[Math.floor(((i + 1) * edge.length) / (p.choose + 1))]! }));
}

export const entryGroupsModule: RuleModule = {
  id: 'ssr.entry-groups',
  ref: 'S22 SSR 2',
  summary: 'Reinforcement groups picked secretly, each with its entry turn and recorded edge hex (SSR).',
  requires: ['sk1.scenario'],
  install(r) {
    // The other side learns a group's composition only as it enters: the picks of groups still waiting are hidden.
    const shown = (st: EntryGroupsState, viewer: SideId | null, env: QueryEnv): EntryGroupsState =>
      viewer === st.side ? st : { ...st, picks: st.picks.filter((pick) => !Object.values(env.state.pieces).some((p) => p.side === st.side && p.tags['force'] === pick.force && p.loc.kind === 'offboard')) };
    r.redact({
      id: 'ssr.entryGroups.redact',
      ext: EXT,
      redactExt: (slice, viewer, env) => shown(slice as EntryGroupsState, viewer, env),
      events: ['ssr.entryGroups'],
      redactEvent: (ev, viewer, env) => ((ev.payload as { state: EntryGroupsState }).state.side === viewer ? ev : { ...ev, payload: { state: shown((ev.payload as { state: EntryGroupsState }).state, viewer, env) } }),
    });
    r.event<{ state: EntryGroupsState }>({
      type: 'ssr.entryGroups',
      apply(d, p) {
        d.ext[EXT] = p.state;
      },
    });

    // Asked after the setup steps above priority 10 (S22: the American Group 1 plan and landing) and
    // before those below it (the Group 2 landing).
    r.setup({
      id: 'ssr.entry-groups.ask',
      priority: 10,
      run(ctx) {
        const p = entryGroupsParams(ctx);
        if (!p) return;
        ctx.pushDecision({ kind: ENTRY_GROUPS_DECISION, owner: p.side, deadlineClass: 'turn', data: {} });
      },
    });

    r.action<EntryGroupsAction>({
      type: 'entryGroups.choose',
      decisionKinds: [ENTRY_GROUPS_DECISION],
      legal: (env) => [{ type: 'entryGroups.choose', picks: defaultPicks(env) }],
      validate: (env, a, d) => entryGroupsIllegal(env, d.owner, a.picks),
      resolve(ctx, a, d: Decision) {
        const p = entryGroupsParams(ctx)!;
        const map = statics(ctx).map;
        const picks = a.picks.map((x) => ({ ...x, hex: map.hex(x.hex)!.id })).sort((x, y) => p.forces.indexOf(x.force) - p.forces.indexOf(y.force));
        ctx.emit('ssr.entryGroups', { state: { side: d.owner, picks } });
        retag(ctx, p, picks);
        ctx.popDecision(d.id);
        if (ctx.state.decisions.length === 0) ctx.proc<(c: Ctx) => void>('sk1.scenario.begin')(ctx);
      },
    });

    // The waiting groups are a secret from the other side until they set up offboard to enter.
    r.contribute({
      id: 'ssr.entry-groups.hidden',
      query: 'piece.visibleTo',
      layer: 10,
      apply(v, { piece, viewer }, env) {
        const p = entryGroupsParams(env);
        const pc = env.state.pieces[piece];
        if (!v || !p || !pc || pc.side !== p.side || viewer === p.side) return v;
        const force = statics(env).scenario.forces[pc.tags['force'] as number]?.id;
        if (!force || !p.forces.includes(force)) return v;
        const at = pc.loc.kind === 'held' ? env.state.pieces[pc.loc.by]?.loc : pc.loc;
        return !(at?.kind === 'offboard' && !at.hex);
      },
    });
  },
};

/** Picked groups enter on their turn at their hex; the rest are set aside. */
function retag(ctx: Ctx, p: EntryGroupsParams, picks: EntryPick[]) {
  const forces = statics(ctx).scenario.forces;
  for (const piece of Object.values(ctx.state.pieces).sort(byId)) {
    const force = forces[piece.tags['force'] as number]?.id;
    if (piece.side !== p.side || !force || !p.forces.includes(force) || piece.loc.kind !== 'offboard') continue;
    const pick = picks.find((x) => x.force === force);
    if (!pick) {
      setTags(ctx, piece.id, { entryTurn: null, entryEdge: null, entryHexes: null });
      ctx.emit('piece.moved', { id: piece.id, loc: { kind: 'offboard', edge: 'unused' } });
      continue;
    }
    setTags(ctx, piece.id, { entryTurn: pick.turn, entryEdge: edgesOf(ctx, pick.hex).join(','), entryHexes: entryHexesFor(ctx, pick.hex).join(',') });
  }
}
