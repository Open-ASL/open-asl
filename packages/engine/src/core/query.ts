import type { GameState } from './types';

/**
 * Typed query catalog. Rule modules extend it with declaration merging:
 *
 *   declare module '@asl/engine' {
 *     interface QueryCatalog {
 *       'ift.drm': { ctx: FireAttackCtx; value: number };
 *     }
 *   }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface QueryCatalog {}

export type QueryName = keyof QueryCatalog & string;
export type QueryCtx<Q extends QueryName> = QueryCatalog[Q] extends { ctx: infer C } ? C : never;
export type QueryValue<Q extends QueryName> = QueryCatalog[Q] extends { value: infer V } ? V : never;

/** Read-only view of the game handed to queries, validators and legal-move generators. */
export interface QueryEnv {
  readonly state: GameState;
  readonly statics: Statics;
  query<Q extends QueryName>(name: Q, ctx: QueryCtx<Q>, base: QueryValue<Q>): QueryValue<Q>;
  explain<Q extends QueryName>(name: Q, ctx: QueryCtx<Q>, base: QueryValue<Q>): QueryResult<QueryValue<Q>>;
}

/**
 * Static (non-state) game data: map/terrain, counter catalog, scenario, tables.
 * Content packages fill this in; the engine never interprets it directly.
 */
export type Statics = object;

/** Conventional layers; lower layers apply first. */
export const Layer = {
  /** Establish or replace the base value. */
  Base: 0,
  /** Additive modifiers (most DRMs). */
  Add: 100,
  /** Multiplicative modifiers (halving/doubling FP). */
  Multiply: 200,
  /** Caps, floors and final overrides. */
  Clamp: 900,
} as const;

export interface Contribution<Q extends QueryName = QueryName> {
  /** Unique id; also the handle other modules use to suppress it. */
  id: string;
  query: Q;
  layer?: number;
  priority?: number;
  /** Short human-readable explanation shown in combat logs, e.g. "+3 stone building". */
  label?: string | ((ctx: QueryCtx<Q>, env: QueryEnv) => string);
  /** Rule reference, e.g. "SK1 3.3.1". */
  ref?: string;
  when?(ctx: QueryCtx<Q>, env: QueryEnv): boolean;
  /**
   * A modifier the players may not learn of (a hidden fortification's TEM, say). It still applies;
   * the trace marks its entry `secret`, and the rule resolving the query decides whether to show
   * it, typically only when it changes the outcome.
   */
  secret?: boolean | ((ctx: QueryCtx<Q>, env: QueryEnv) => boolean);
  apply(value: QueryValue<Q>, ctx: QueryCtx<Q>, env: QueryEnv): QueryValue<Q>;
}

export interface Suppression<Q extends QueryName = QueryName> {
  id: string;
  /** Contribution id that is switched off when `when` holds (always, if omitted). */
  target: string;
  label?: string;
  ref?: string;
  when?(ctx: QueryCtx<Q>, env: QueryEnv): boolean;
}

export interface TraceEntry {
  id: string;
  label?: string;
  ref?: string;
  before: unknown;
  after: unknown;
  /** Set when this entry records a suppression rather than an application. */
  suppressedBy?: string;
  /** Set when the contribution is one the players may not be shown (see `Contribution.secret`). */
  secret?: true;
}

export interface QueryResult<V> {
  value: V;
  trace: TraceEntry[];
}

const MAX_QUERY_DEPTH = 32;

export class QueryPipeline {
  private byQuery = new Map<string, Contribution[]>();
  private suppressions: Suppression[] = [];

  constructor(contributions: Contribution[], suppressions: Suppression[]) {
    for (const c of contributions) {
      const list = this.byQuery.get(c.query) ?? [];
      list.push(c);
      this.byQuery.set(c.query, list);
    }
    for (const list of this.byQuery.values()) {
      list.sort(
        (a, b) =>
          (a.layer ?? Layer.Add) - (b.layer ?? Layer.Add) || (a.priority ?? 0) - (b.priority ?? 0),
      );
    }
    this.suppressions = suppressions;
  }

  has(query: string): boolean {
    return this.byQuery.has(query);
  }

  run<Q extends QueryName>(
    name: Q,
    ctx: QueryCtx<Q>,
    base: QueryValue<Q>,
    env: QueryEnv,
    depth: number,
  ): QueryResult<QueryValue<Q>> {
    if (depth > MAX_QUERY_DEPTH) {
      throw new Error(`Query recursion too deep while evaluating "${name}"`);
    }
    const list = (this.byQuery.get(name) ?? []) as Contribution<Q>[];
    const trace: TraceEntry[] = [];
    let value = base;
    for (const c of list) {
      if (c.when && !c.when(ctx, env)) continue;
      const sup = this.suppressions.find(
        (s) => s.target === c.id && (!s.when || (s.when as Suppression<Q>['when'])!(ctx, env)),
      );
      if (sup) {
        trace.push({ id: c.id, label: labelOf(c, ctx, env), ref: c.ref, before: value, after: value, suppressedBy: sup.id });
        continue;
      }
      const before = value;
      value = c.apply(value, ctx, env);
      if (before !== value) {
        const secret = typeof c.secret === 'function' ? c.secret(ctx, env) : c.secret === true;
        trace.push({ id: c.id, label: labelOf(c, ctx, env), ref: c.ref, before, after: value, ...(secret ? { secret: true } : {}) });
      }
    }
    return { value, trace };
  }
}

function labelOf<Q extends QueryName>(c: Contribution<Q>, ctx: QueryCtx<Q>, env: QueryEnv) {
  return typeof c.label === 'function' ? c.label(ctx, env) : c.label;
}
