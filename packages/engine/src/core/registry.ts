import type { Draft } from 'immer';
import { hashValue } from './hash';
import type { Contribution, QueryEnv, QueryName, Suppression } from './query';
import type { Action, Decision, GameEvent, GameState, SideId } from './types';
import type { Ctx } from './context';

/**
 * A rule module is the unit of extension. Each SK, chapter, scenario SSR or
 * campaign rule set is one or more modules. Everything a module registers has an
 * id, so later modules can disable or override it (`builder.disable(id)`).
 */
export interface RuleModule {
  id: string;
  version?: string;
  /** Rule reference, e.g. "SK1 3.3.1". */
  ref?: string;
  /** Our own one-line summary (never rulebook text). */
  summary?: string;
  /** Module ids that must be installed earlier in the ruleset. */
  requires?: string[];
  install(r: RuleBuilder): void;
}

export interface EventDef<P = unknown> {
  type: string;
  apply(draft: Draft<GameState>, payload: P): void;
}

export interface ActionDef<A extends Action = Action> {
  /** Action type string; also its registry id. */
  type: string;
  /** Decision kinds this action can answer. */
  decisionKinds: string[];
  /**
   * Enumerate concrete legal actions (used by AI and simple UIs). May return a
   * representative subset when the full space is combinatorial; `validate` is
   * authoritative.
   */
  legal?(env: QueryEnv, decision: Decision): Omit<A, 'side' | 'decisionId'>[];
  /** Return an error message if illegal, otherwise null. */
  validate?(env: QueryEnv, action: A, decision: Decision): string | null;
  resolve(ctx: Ctx, action: A, decision: Decision): void;
}

export interface TriggerDef<P = unknown> {
  id: string;
  event: string;
  priority?: number;
  handler(ctx: Ctx, event: GameEvent<P>): void;
}

export interface ReplacementDef<P = unknown> {
  id: string;
  event: string;
  priority?: number;
  when?(env: QueryEnv, event: GameEvent<P>): boolean;
  /** Return the events to apply instead. Returning `[event]` unchanged is a no-op. */
  replace(env: QueryEnv, event: GameEvent<P>): GameEvent[];
}

export interface InvariantDef {
  id: string;
  /** Return a violation message, or null. Checked after every action. */
  check(env: QueryEnv): string | null;
}

/**
 * Supplies an action automatically for a decision (standing orders, timeouts,
 * decisions with exactly one sensible answer). Returning null means "ask the player".
 */
export interface AutoResolverDef {
  priority?: number;
  id: string;
  decisionKind: string;
  resolve(env: QueryEnv, decision: Decision, reason: 'auto' | 'timeout'): Omit<Action, 'side' | 'decisionId'> | null;
}

export interface SetupHookDef {
  id: string;
  priority?: number;
  run(ctx: Ctx): void;
}

/**
 * How a module's secrets are hidden from a viewer (a side, or `null` for a spectator) when the server builds
 * that viewer's redacted snapshot and event stream (see `view.ts`). Hidden *pieces* need no redactor: the
 * rules' visibility query removes them. A redactor is for an `ext` slice that holds one side's secret, and for
 * events whose payload would leak it. Redactors are not part of the ruleset's version hash.
 */
export interface RedactorDef {
  id: string;
  /** The `ext` slice this redactor owns. */
  ext?: string;
  /** The slice as `viewer` may see it (the owner sees it whole). */
  redactExt?(slice: unknown, viewer: SideId | null, env: QueryEnv): unknown;
  /** Event types whose payload must be rewritten for other viewers. */
  events?: string[];
  /** The event as `viewer` may see it; `null` replaces it with a `view.patch`. */
  redactEvent?(event: GameEvent, viewer: SideId | null, env: QueryEnv): GameEvent | null;
  /** A pending decision as `viewer` may see it (its `data` may name hidden pieces). */
  redactDecision?(decision: Decision, viewer: SideId | null, env: QueryEnv): Decision;
}

/**
 * A named, overridable rule procedure (e.g. "morale.check", "fire.resolve").
 * Each registration receives the previous implementation (`next`) so later
 * modules can wrap, adjust or completely replace earlier behaviour.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProcedureFn = (...args: any[]) => any;
export interface ProcedureDef<F extends ProcedureFn = ProcedureFn> {
  id: string;
  impl(next: F | undefined): F;
}

export interface RuleBuilder {
  /**
   * Register or wrap a named procedure. Unlike other registrations, the same
   * procedure id may be provided by several modules; each wraps the previous.
   */
  procedure<F extends ProcedureFn>(id: string, impl: (next: F | undefined) => F): void;
  readonly moduleId: string;
  event<P>(def: EventDef<P>): void;
  action<A extends Action>(def: ActionDef<A>): void;
  contribute<Q extends QueryName>(def: Contribution<Q>): void;
  suppress<Q extends QueryName>(def: Suppression<Q> & { query?: Q }): void;
  on<P>(def: TriggerDef<P>): void;
  replace<P>(def: ReplacementDef<P>): void;
  invariant(def: InvariantDef): void;
  autoResolver(def: AutoResolverDef): void;
  setup(def: SetupHookDef): void;
  redact(def: RedactorDef): void;
  /** Remove anything previously registered with this id (action type, contribution, trigger, ...). */
  disable(id: string): void;
}

export interface Ruleset {
  id: string;
  /** Hash of module ids + versions; pinned by every game for replay. */
  versionHash: string;
  modules: { id: string; version?: string }[];
  events: Map<string, EventDef>;
  actions: Map<string, ActionDef>;
  contributions: Contribution[];
  suppressions: Suppression[];
  triggers: Map<string, TriggerDef[]>;
  replacements: Map<string, ReplacementDef[]>;
  invariants: InvariantDef[];
  autoResolvers: Map<string, AutoResolverDef[]>;
  setupHooks: SetupHookDef[];
  procedures: Map<string, ProcedureFn>;
  redactors: RedactorDef[];
}

export function buildRuleset(id: string, modules: RuleModule[]): Ruleset {
  const events = new Map<string, EventDef>();
  const actions = new Map<string, ActionDef>();
  let contributions: Contribution[] = [];
  let suppressions: Suppression[] = [];
  let triggers: TriggerDef[] = [];
  let replacements: ReplacementDef[] = [];
  let invariants: InvariantDef[] = [];
  let autoResolvers: AutoResolverDef[] = [];
  let setupHooks: SetupHookDef[] = [];
  let redactors: RedactorDef[] = [];
  const installed = new Set<string>();
  const procedures = new Map<string, ProcedureFn>();

  const owner = new Map<string, string>();
  const claim = (itemId: string, moduleId: string, kind: string) => {
    const prev = owner.get(`${kind}:${itemId}`);
    if (prev) {
      throw new Error(
        `Module "${moduleId}" registers ${kind} "${itemId}" already registered by "${prev}". ` +
          `Call disable("${itemId}") first to override it.`,
      );
    }
    owner.set(`${kind}:${itemId}`, moduleId);
  };

  for (const mod of modules) {
    if (installed.has(mod.id)) throw new Error(`Module "${mod.id}" installed twice`);
    for (const req of mod.requires ?? []) {
      if (!installed.has(req)) {
        throw new Error(`Module "${mod.id}" requires "${req}", which must come earlier in the ruleset`);
      }
    }
    const builder: RuleBuilder = {
      moduleId: mod.id,
      procedure(procId, impl) {
        procedures.set(procId, impl(procedures.get(procId) as never));
      },
      event(def) {
        claim(def.type, mod.id, 'event');
        events.set(def.type, def as EventDef);
      },
      action(def) {
        claim(def.type, mod.id, 'action');
        actions.set(def.type, def as unknown as ActionDef);
      },
      contribute(def) {
        claim(def.id, mod.id, 'contribution');
        contributions.push(def as unknown as Contribution);
      },
      suppress(def) {
        claim(def.id, mod.id, 'suppression');
        suppressions.push(def as unknown as Suppression);
      },
      on(def) {
        claim(def.id, mod.id, 'trigger');
        triggers.push(def as TriggerDef);
      },
      replace(def) {
        claim(def.id, mod.id, 'replacement');
        replacements.push(def as ReplacementDef);
      },
      invariant(def) {
        claim(def.id, mod.id, 'invariant');
        invariants.push(def);
      },
      autoResolver(def) {
        claim(def.id, mod.id, 'autoResolver');
        autoResolvers.push(def);
      },
      setup(def) {
        claim(def.id, mod.id, 'setup');
        setupHooks.push(def);
      },
      redact(def) {
        claim(def.id, mod.id, 'redactor');
        redactors.push(def);
      },
      disable(itemId) {
        let found = false;
        const drop = <T>(list: T[], key: (t: T) => string) =>
          list.filter((t) => {
            if (key(t) === itemId) {
              found = true;
              return false;
            }
            return true;
          });
        if (actions.delete(itemId)) found = true;
        contributions = drop(contributions, (c) => c.id);
        suppressions = drop(suppressions, (s) => s.id);
        triggers = drop(triggers, (t) => t.id);
        replacements = drop(replacements, (r) => r.id);
        invariants = drop(invariants, (i) => i.id);
        autoResolvers = drop(autoResolvers, (a) => a.id);
        setupHooks = drop(setupHooks, (s) => s.id);
        redactors = drop(redactors, (r) => r.id);
        if (!found) throw new Error(`Module "${mod.id}" tried to disable unknown id "${itemId}"`);
        for (const key of [...owner.keys()]) {
          if (key.endsWith(`:${itemId}`) && !key.startsWith('event:')) owner.delete(key);
        }
      },
    };
    mod.install(builder);
    installed.add(mod.id);
  }

  const group = <T extends { priority?: number }>(list: T[], key: (t: T) => string) => {
    const map = new Map<string, T[]>();
    for (const item of list) {
      const k = key(item);
      map.set(k, [...(map.get(k) ?? []), item]);
    }
    for (const l of map.values()) l.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    return map;
  };

  const moduleList = modules.map((m) => ({ id: m.id, ...(m.version ? { version: m.version } : {}) }));
  return {
    id,
    versionHash: hashValue({ id, modules: moduleList }),
    modules: moduleList,
    events,
    actions,
    contributions,
    suppressions,
    triggers: group(triggers, (t) => t.event),
    replacements: group(replacements, (r) => r.event),
    invariants,
    autoResolvers: group(autoResolvers, (a) => a.decisionKind),
    setupHooks: [...setupHooks].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)),
    procedures,
    redactors,
  };
}
