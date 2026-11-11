import { Immer, produce, type Draft } from 'immer';
import type { Ctx, DiceRoll } from './context';
import { QueryPipeline, type QueryEnv, type QueryName, type QueryCtx, type QueryValue, type Statics } from './query';
import type { Ruleset } from './registry';
import { rollDie, seedRng } from './rng';
import {
  RuleError,
  type Action,
  type Decision,
  type GameEvent,
  type GameResult,
  type GameState,
  type LoggedEvent,
  type RngState,
  type SideId,
} from './types';
import { applyPatch, deepEqual, diffStates, mentionsAny, type ViewPatch } from './view';

export interface EngineOptions {
  /**
   * Test hook: dice values consumed in order instead of the RNG. The rolled
   * values are still recorded as events, so logs stay replayable.
   */
  forcedDice?: number[];
  /** Safety valve for runaway trigger chains. */
  maxEventsPerAction?: number;
  /**
   * Bot engines only (hypothetical play): states are not deep-frozen. The same states and events,
   * faster; nothing then stops code from mutating a state it was handed, so the live game never uses it.
   */
  unfrozen?: boolean;
}

const unfrozen = new Immer({ autoFreeze: false });

export interface GameInit {
  scenarioId: string;
  sides: string[];
  attacker: string;
  seed: string;
}

export interface Transition {
  state: GameState;
  events: LoggedEvent[];
}

interface BuiltinPayloads {
  /** `rng` is the generator state after the roll; a redacted view carries the dice without it. */
  'dice.rolled': { label: string; dice: number[]; rng?: RngState };
  'decision.pushed': { decision: Decision };
  'decision.popped': { id: string };
  'game.ended': { result: GameResult };
  /** A redacted view's stand-in for an event it may not see (`redactTransition`). */
  'view.patch': ViewPatch;
}

const BUILTIN_EVENTS: { [K in keyof BuiltinPayloads]: (d: Draft<GameState>, p: BuiltinPayloads[K]) => void } = {
  'dice.rolled': (d, p) => {
    if (p.rng) d.rng = p.rng;
  },
  'view.patch': applyPatch,
  'decision.pushed': (d, p) => {
    d.decisions.push(p.decision);
  },
  'decision.popped': (d, p) => {
    const i = d.decisions.findIndex((x) => x.id === p.id);
    if (i >= 0) d.decisions.splice(i, 1);
  },
  'game.ended': (d, p) => {
    d.result = p.result;
    d.decisions = [];
  },
};

function stripRng(p: BuiltinPayloads['dice.rolled']): BuiltinPayloads['dice.rolled'] {
  const { rng: _rng, ...rest } = p;
  void _rng;
  return rest;
}

export class Engine {
  readonly pipeline: QueryPipeline;
  private forced: number[];
  private readonly produce: typeof produce;

  constructor(
    readonly ruleset: Ruleset,
    readonly statics: Statics,
    private readonly options: EngineOptions = {},
  ) {
    this.pipeline = new QueryPipeline(ruleset.contributions, ruleset.suppressions);
    this.forced = [...(options.forcedDice ?? [])];
    this.produce = options.unfrozen ? unfrozen.produce : produce;
  }

  /** Queue more forced dice (tests). */
  forceDice(...values: number[]) {
    this.forced.push(...values);
  }

  env(state: GameState): QueryEnv {
    const pipeline = this.pipeline;
    const statics = this.statics;
    let depth = 0;
    const env: QueryEnv = {
      state,
      statics,
      query: (name, ctx, base) => env.explain(name, ctx, base).value,
      explain: (name, ctx, base) => {
        depth++;
        try {
          return pipeline.run(name, ctx, base, env, depth);
        } finally {
          depth--;
        }
      },
    };
    return env;
  }

  query<Q extends QueryName>(state: GameState, name: Q, ctx: QueryCtx<Q>, base: QueryValue<Q>) {
    return this.env(state).explain(name, ctx, base);
  }

  /** The pristine pre-setup state. Folding a game's full event log over this reproduces it. */
  initialState(init: GameInit): GameState {
    return {
      rulesetId: this.ruleset.id,
      scenarioId: init.scenarioId,
      seq: 0,
      turn: 1,
      phase: 'setup',
      attacker: init.attacker,
      sides: init.sides,
      pieces: {},
      hexMarkers: {},
      decisions: [],
      rng: seedRng(init.seed),
      result: null,
      ext: {},
    };
  }

  /** Create a fresh game and run every setup hook (scenario placement, first phase, ...). */
  createGame(init: GameInit): Transition {
    return this.run(this.initialState(init), (ctx) => {
      for (const hook of this.ruleset.setupHooks) hook.run(ctx);
    });
  }

  currentDecision(state: GameState): Decision | undefined {
    return state.decisions[state.decisions.length - 1];
  }

  /** Concrete legal actions for `side` (empty when it's not their decision). */
  legalActions(state: GameState, side: string): Action[] {
    const decision = this.currentDecision(state);
    if (!decision || decision.owner !== side || state.result) return [];
    const env = this.env(state);
    const out: Action[] = [];
    for (const def of this.ruleset.actions.values()) {
      if (!def.decisionKinds.includes(decision.kind) || !def.legal) continue;
      for (const a of def.legal(env, decision)) {
        out.push({ ...a, side, decisionId: decision.id } as Action);
      }
    }
    return out;
  }

  validate(state: GameState, action: Action): string | null {
    if (state.result) return 'Game is over';
    const decision = this.currentDecision(state);
    if (!decision) return 'No decision is pending';
    if (decision.id !== action.decisionId) return 'Action answers a stale decision';
    if (decision.owner !== action.side) return `It is ${decision.owner}'s decision`;
    const def = this.ruleset.actions.get(action.type);
    if (!def) return `Unknown action "${action.type}"`;
    if (!def.decisionKinds.includes(decision.kind)) {
      return `"${action.type}" cannot answer a "${decision.kind}" decision`;
    }
    return def.validate?.(this.env(state), action, decision) ?? null;
  }

  /** Apply a player action, then any automatic decisions that follow. */
  submit(state: GameState, action: Action): Transition {
    const err = this.validate(state, action);
    if (err) throw new RuleError(err);
    const first = this.run(state, (ctx) => {
      const decision = this.currentDecision(ctx.state)!;
      this.ruleset.actions.get(action.type)!.resolve(ctx, action, decision);
    });
    return this.autoResolve(first, 'auto');
  }

  /** Answer the current decision as if its deadline expired (default policy). */
  timeout(state: GameState): Transition | null {
    const decision = this.currentDecision(state);
    if (!decision) return null;
    const auto = this.findAuto(state, decision, 'timeout');
    if (!auto) return null;
    return this.submit(state, auto);
  }

  private findAuto(state: GameState, decision: Decision, reason: 'auto' | 'timeout'): Action | null {
    const env = this.env(state);
    for (const r of this.ruleset.autoResolvers.get(decision.kind) ?? []) {
      const a = r.resolve(env, decision, reason);
      if (a) return { ...a, side: decision.owner, decisionId: decision.id } as Action;
    }
    return null;
  }

  private autoResolve(t: Transition, reason: 'auto'): Transition {
    let { state } = t;
    const events = [...t.events];
    for (let guard = 0; guard < 10_000; guard++) {
      const decision = this.currentDecision(state);
      if (!decision || state.result) break;
      const auto = this.findAuto(state, decision, reason);
      if (!auto) break;
      const err = this.validate(state, auto);
      if (err) throw new Error(`Auto-resolver produced an illegal action for "${decision.kind}": ${err}`);
      const next = this.run(state, (ctx) => {
        this.ruleset.actions.get(auto.type)!.resolve(ctx, auto, decision);
      });
      state = next.state;
      events.push(...next.events);
    }
    return { state, events };
  }

  /** Fold already-recorded events (replay fast path; no rules are re-run). */
  applyEvents(state: GameState, events: GameEvent[]): GameState {
    let s = state;
    for (const ev of events) s = this.applyOne(s, ev);
    return s;
  }

  /**
   * The events of a transition as `viewer` may see them: one per real event, same `seq`. `redact` turns a full
   * state into that viewer's snapshot (the rules' `redactState`); it must be a pure function of the state. An
   * event is passed through (a `dice.rolled` without its `rng`, or as a module's redactor rewrites it) only when
   * it names no piece the viewer cannot see and folding it over the previous redacted snapshot gives exactly the
   * next one; otherwise the viewer gets a `view.patch` with the difference. So for every prefix,
   * `applyEvents(redact(before), redacted) ≡ redact(after)`.
   */
  redactTransition(viewer: SideId | null, redact: (state: GameState) => GameState, before: GameState, events: LoggedEvent[]): LoggedEvent[] {
    const byEvent = new Map<string, (typeof this.ruleset.redactors)[number]>();
    for (const r of this.ruleset.redactors) for (const t of r.events ?? []) byEvent.set(t, r);
    const out: LoggedEvent[] = [];
    let full = before;
    let view = redact(before);
    for (const ev of events) {
      const nextFull = this.applyOne(full, ev);
      const nextView = redact(nextFull);
      const hidden = new Set<string>();
      for (const id of Object.keys(full.pieces)) if (!(id in view.pieces)) hidden.add(id);
      for (const id of Object.keys(nextFull.pieces)) if (!(id in nextView.pieces)) hidden.add(id);
      let candidate: GameEvent | null = ev.type === 'dice.rolled' ? { ...ev, payload: stripRng(ev.payload as BuiltinPayloads['dice.rolled']) } : ev;
      const redactor = byEvent.get(ev.type);
      if (candidate && redactor?.redactEvent) candidate = redactor.redactEvent(candidate, viewer, this.env(nextFull));
      let accepted: GameEvent | null = null;
      if (candidate && !mentionsAny(candidate.payload, hidden)) {
        try {
          if (deepEqual(this.applyOne(view, candidate), nextView)) accepted = candidate;
        } catch {
          accepted = null;
        }
      }
      const { seq: _seq, ...rest } = ev;
      void _seq;
      out.push(accepted ? { ...rest, ...accepted, seq: ev.seq } : { type: 'view.patch', payload: diffStates(view, nextView), seq: ev.seq });
      full = nextFull;
      view = nextView;
    }
    return out;
  }

  private applyOne(state: GameState, ev: GameEvent): GameState {
    const builtin = BUILTIN_EVENTS[ev.type as keyof BuiltinPayloads];
    const def = this.ruleset.events.get(ev.type);
    if (!builtin && !def) throw new Error(`No event definition for "${ev.type}"`);
    return this.produce(state, (draft) => {
      if (builtin) (builtin as (d: Draft<GameState>, p: unknown) => void)(draft, ev.payload);
      else def!.apply(draft, ev.payload);
      draft.seq++;
    });
  }

  private run(start: GameState, body: (ctx: Ctx) => void): Transition {
    const engine = this;
    const log: LoggedEvent[] = [];
    const limit = this.options.maxEventsPerAction ?? 50_000;
    let state = start;
    let env = this.env(state);

    const setState = (s: GameState) => {
      state = s;
      env = engine.env(s);
    };

    const emitRaw = (ev: GameEvent, applied: Set<string>) => {
      // Replacement effects get first look; each replacer sees an event lineage at most once.
      for (const r of engine.ruleset.replacements.get(ev.type) ?? []) {
        if (applied.has(r.id)) continue;
        if (r.when && !r.when(env, ev)) continue;
        const replaced = r.replace(env, ev);
        if (replaced.length === 1 && replaced[0] === ev) continue;
        const next = new Set(applied).add(r.id);
        for (const e of replaced) emitRaw(e, next);
        return;
      }
      setState(engine.applyOne(state, ev));
      log.push({ ...ev, seq: state.seq });
      if (log.length > limit) throw new Error('Event limit exceeded; probable trigger loop');
      for (const t of engine.ruleset.triggers.get(ev.type) ?? []) {
        t.handler(ctx, ev);
      }
    };

    const ctx: Ctx = {
      get state() {
        return state;
      },
      statics: this.statics,
      query: (name, c, base) => env.query(name, c, base),
      explain: (name, c, base) => env.explain(name, c, base),
      emit(type, payload, source) {
        emitRaw({ type, payload, ...(source ? { source } : {}) }, new Set());
      },
      roll(label, count = 2): DiceRoll {
        const dice: number[] = [];
        let rng = state.rng;
        for (let i = 0; i < count; i++) {
          const forced = engine.forced.shift();
          if (forced !== undefined) {
            dice.push(forced);
          } else {
            const [v, next] = rollDie(rng);
            dice.push(v);
            rng = next;
          }
        }
        ctx.emit('dice.rolled', { label, dice, rng });
        return { label, dice, total: dice.reduce((a, b) => a + b, 0) };
      },
      pushDecision(d) {
        const decision: Decision = { ...d, id: `d${state.seq + 1}` };
        ctx.emit('decision.pushed', { decision });
        return decision;
      },
      popDecision(id) {
        const target = id ?? state.decisions[state.decisions.length - 1]?.id;
        if (target) ctx.emit('decision.popped', { id: target });
      },
      endGame(result) {
        ctx.emit('game.ended', { result });
      },
      fail(message): never {
        throw new RuleError(message);
      },
      proc(id) {
        const fn = engine.ruleset.procedures.get(id);
        if (!fn) throw new Error(`No procedure "${id}" in ruleset ${engine.ruleset.id}`);
        return fn as never;
      },
    };

    body(ctx);

    const finalEnv = this.env(state);
    for (const inv of this.ruleset.invariants) {
      const violation = inv.check(finalEnv);
      if (violation) throw new Error(`Invariant "${inv.id}" violated: ${violation}`);
    }
    if (!state.result && state.decisions.length === 0 && state.phase !== 'setup') {
      throw new Error('Engine stalled: no pending decision and the game has not ended');
    }
    return { state, events: log };
  }
}
