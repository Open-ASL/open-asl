import type { Action, Ctx, Decision, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { otherSide, statics } from './pieces';

declare module '@asl/engine' {
  interface QueryCatalog {
    /** The game's length: the scenario's, unless a rule changes it during play (S36's secretly chosen length). */
    'game.turns': { ctx: Record<string, never>; value: { turns: number; halfFinalTurn: boolean } };
    /** Ordered phase ids of one Player Turn. Rule packs insert their phases here. */
    'turn.phases': { ctx: Record<string, never>; value: string[] };
    /** Decide the winner when the game ends (after the last Player Turn or a sudden-death check). */
    'game.winner': { ctx: { reason: string }; value: SideId | null };
    /** Whether a side still has reinforcements to come that do not exist yet (a dr creates them). */
    'side.reinforcementsPending': { ctx: { side: SideId }; value: boolean };
    /** Sudden-death/early victory check after each phase; return a winner to end the game. */
    'game.suddenDeath': { ctx: { phase: string }; value: SideId | null };
    /** Why the current phase cannot be ended yet (e.g. units that must still rout), or null. */
    'phase.endBlocked': { ctx: Record<string, never>; value: string | null };
  }
}

/** Decision kind used for "the phase owner's main choice" in every phase. */
export const PHASE_DECISION = 'phase';

export interface PhaseDecisionData {
  phase: string;
  [k: string]: unknown;
}

export interface TurnEvents {
  'turn.phaseEnded': { phase: string; turn: number; attacker: SideId };
  'turn.phaseStarted': { phase: string; turn: number; attacker: SideId };
  'turn.playerTurn': { turn: number; attacker: SideId };
}

/**
 * Advance to the next phase, skipping phases that need no decisions.
 * Phase modules react to `turn.phaseStarted` (push decisions, run automatic steps)
 * and to `turn.phaseEnded` (marker cleanup).
 */
export function advancePhase(ctx: Ctx) {
  for (let guard = 0; guard < 1000; guard++) {
    const s = ctx.state;
    if (s.result) return;
    const phases = ctx.query('turn.phases', {}, []);
    if (s.phase !== 'setup') {
      ctx.emit('turn.phaseEnded', { phase: s.phase, turn: s.turn, attacker: s.attacker });
      const winner = ctx.query('game.suddenDeath', { phase: s.phase }, null);
      if (winner !== null) {
        ctx.endGame({ winner, reason: 'sudden death' });
        return;
      }
    }
    const idx = phases.indexOf(s.phase);
    if (s.phase !== 'setup' && idx === phases.length - 1) {
      if (!nextPlayerTurn(ctx)) return;
    }
    const next = s.phase === 'setup' || idx === phases.length - 1 ? phases[0]! : phases[idx + 1]!;
    ctx.emit('turn.phaseStarted', { phase: next, turn: ctx.state.turn, attacker: ctx.state.attacker });
    if (ctx.state.decisions.length > 0 || ctx.state.result) return;
  }
  throw new Error('advancePhase: no phase produced a decision');
}

/** The game's length in force: the scenario's unless a rule has changed it. */
export const gameTurns = (env: QueryEnv) => {
  const sc = statics(env).scenario;
  return env.query('game.turns', {}, { turns: sc.turns, halfFinalTurn: sc.halfFinalTurn });
};

/** Returns false if the game ended. */
function nextPlayerTurn(ctx: Ctx): boolean {
  const s = ctx.state;
  const sc = statics(ctx).scenario;
  const first = sc.firstSide;
  const nextAttacker = otherSide(s, s.attacker);
  const nextTurn = nextAttacker === first ? s.turn + 1 : s.turn;
  const { turns, halfFinalTurn } = gameTurns(ctx);
  const over = nextTurn > turns || (halfFinalTurn && nextTurn === turns && nextAttacker !== first);
  if (over) {
    const winner = ctx.query('game.winner', { reason: 'end of game' }, null);
    ctx.endGame({ winner, reason: 'scenario end' });
    return false;
  }
  ctx.emit('turn.playerTurn', { turn: nextTurn, attacker: nextAttacker });
  return true;
}

/** Push the standard "main choice" decision for the current phase. */
export function askPhaseOwner(ctx: Ctx, owner: SideId, data: Record<string, unknown> = {}) {
  ctx.pushDecision({
    kind: PHASE_DECISION,
    owner,
    deadlineClass: 'turn',
    data: { phase: ctx.state.phase, ...data },
  });
}

/** (ctx, answeredDecision) => void — called when a phase owner ends their part of a phase. */
export const PHASE_DONE = 'turn.phaseDone';
export type PhaseDoneFn = (ctx: Ctx, decision: Decision) => void;

export const inPhase = (env: QueryEnv, phase: string) => env.state.phase === phase;

export const turnModule: RuleModule = {
  id: 'common.turn',
  requires: ['common.pieces'],
  install(r) {
    r.event<TurnEvents['turn.phaseEnded']>({ type: 'turn.phaseEnded', apply() {} });
    r.event<TurnEvents['turn.phaseStarted']>({
      type: 'turn.phaseStarted',
      apply(d, p) {
        d.phase = p.phase;
      },
    });
    r.event<TurnEvents['turn.playerTurn']>({
      type: 'turn.playerTurn',
      apply(d, p) {
        d.turn = p.turn;
        d.attacker = p.attacker;
      },
    });

    // The phase owner declares they are done with the current phase. What happens
    // next is the `turn.phaseDone` procedure, which multi-step phases wrap.
    r.procedure<PhaseDoneFn>(PHASE_DONE, () => (ctx) => {
      if (ctx.state.decisions.length === 0) advancePhase(ctx);
    });
    r.action<Action>({
      type: 'endPhase',
      decisionKinds: [PHASE_DECISION],
      legal: (env) => (env.query('phase.endBlocked', {}, null) ? [] : [{ type: 'endPhase' }]),
      validate: (env) => env.query('phase.endBlocked', {}, null),
      resolve(ctx, _a, decision) {
        ctx.popDecision();
        ctx.proc<PhaseDoneFn>(PHASE_DONE)(ctx, decision);
      },
    });

    // Concede at any decision.
    r.action<Action>({
      type: 'concede',
      decisionKinds: [PHASE_DECISION],
      resolve(ctx, a) {
        ctx.endGame({ winner: otherSide(ctx.state, a.side), reason: 'concession' });
      },
    });

    // Runs last: start the first Player Turn once scenario setup hooks are done.
    r.setup({
      id: 'common.turn.start',
      priority: 1000,
      run(ctx) {
        if (ctx.state.decisions.length === 0) advancePhase(ctx);
      },
    });
  },
};
