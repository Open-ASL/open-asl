import type { Action, Ctx, Decision, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, statics } from '../common/pieces';
import { setTags } from './status';

/*
 * Reinforcement groups whose entry turns a side assigns secretly before setup (S26 SSR 1: "Prior to
 * setup, the German player secretly chooses which group will enter on Turn 1 and which will enter on
 * Turn 2. Each group may only be selected once."). A general rule: the side gives each listed force
 * one of the listed turns, each turn once. The forces keep the edge the card gives them. The choice is
 * secret until a group sets up offboard to enter: the other side does not see the waiting counters
 * (online, the `ssr.entryTurns` redactor keeps it out of the other seat's view).
 */

export const SECRET_ENTRY_TURNS_MODULE = 'secret-entry-turns';
export const SECRET_ENTRY_TURNS_DECISION = 'entryTurns';
const EXT = 'ssr.entryTurns';

export interface SecretEntryTurnsParams {
  side: SideId;
  /** Ids of the forces to assign. */
  forces: string[];
  /** The turns to hand out, one per force. */
  turns: number[];
  /** The card's name for the rule, e.g. 'SSR 1'. */
  rule?: string;
}

export type SecretEntryTurnsAction = Action & { turns: Record<string, number> };

export function secretEntryTurnsParams(env: QueryEnv): SecretEntryTurnsParams | null {
  const s = statics(env).scenario.ssr.find((r) => r.module === SECRET_ENTRY_TURNS_MODULE);
  return s ? (s.params as unknown as SecretEntryTurnsParams) : null;
}

/** The turns chosen, once they are. */
export const secretEntryTurnsState = (env: QueryEnv): Record<string, number> | null => (env.state.ext[EXT] as Record<string, number> | undefined) ?? null;

/** Why an assignment is illegal, or null. */
export function secretEntryTurnsIllegal(env: QueryEnv, side: SideId, turns: Record<string, number>): string | null {
  const p = secretEntryTurnsParams(env);
  if (!p || p.side !== side) return 'This side does not choose entry turns';
  const given = p.forces.map((f) => turns[f]);
  if (given.some((t) => t === undefined)) return 'Give every group its turn';
  if (Object.keys(turns).some((f) => !p.forces.includes(f))) return 'Not a group to assign';
  const left = [...p.turns];
  for (const t of given) {
    const i = left.indexOf(t!);
    if (i < 0) return `Each of Turn ${p.turns.join(' and ')} goes to one group`;
    left.splice(i, 1);
  }
  return null;
}

export const secretEntryTurnsModule: RuleModule = {
  id: 'ssr.secret-entry-turns',
  ref: 'S26 SSR 1',
  summary: 'Reinforcement groups given their entry turns secretly before setup (SSR).',
  requires: ['sk1.scenario'],
  install(r) {
    // The assignment is one side's secret until each force enters; the other side sees nothing of it.
    r.redact({
      id: 'ssr.entryTurns.redact',
      ext: EXT,
      redactExt: (slice, viewer, env) => (viewer === secretEntryTurnsParams(env)?.side ? slice : null),
      events: ['ssr.entryTurns'],
      redactEvent: (ev, viewer, env) => (viewer === secretEntryTurnsParams(env)?.side ? ev : null),
    });
    r.event<{ turns: Record<string, number> }>({
      type: 'ssr.entryTurns',
      apply(d, p) {
        d.ext[EXT] = p.turns;
      },
    });

    // "Prior to setup": asked before every other setup step.
    r.setup({
      id: 'ssr.secret-entry-turns.ask',
      priority: 40,
      run(ctx) {
        const p = secretEntryTurnsParams(ctx);
        if (p) ctx.pushDecision({ kind: SECRET_ENTRY_TURNS_DECISION, owner: p.side, deadlineClass: 'turn', data: {} });
      },
    });

    r.action<SecretEntryTurnsAction>({
      type: 'entryTurns.choose',
      decisionKinds: [SECRET_ENTRY_TURNS_DECISION],
      legal(env) {
        const p = secretEntryTurnsParams(env)!;
        return [{ type: 'entryTurns.choose', turns: Object.fromEntries(p.forces.map((f, i) => [f, p.turns[i]!])) }];
      },
      validate: (env, a, d) => secretEntryTurnsIllegal(env, d.owner, a.turns),
      resolve(ctx, a, d: Decision) {
        const p = secretEntryTurnsParams(ctx)!;
        const turns = Object.fromEntries(p.forces.map((f) => [f, a.turns[f]!]));
        ctx.emit('ssr.entryTurns', { turns });
        const forces = statics(ctx).scenario.forces;
        for (const piece of Object.values(ctx.state.pieces).sort(byId)) {
          const force = forces[piece.tags['force'] as number]?.id;
          if (piece.side === p.side && force && turns[force] !== undefined && piece.loc.kind === 'offboard') setTags(ctx, piece.id, { entryTurn: turns[force]! });
        }
        ctx.popDecision(d.id);
        if (ctx.state.decisions.length === 0) ctx.proc<(c: Ctx) => void>('sk1.scenario.begin')(ctx);
      },
    });

    // The waiting groups are a secret from the other side until they set up offboard to enter.
    r.contribute({
      id: 'ssr.secret-entry-turns.hidden',
      query: 'piece.visibleTo',
      layer: 10,
      apply(v, { piece, viewer }, env) {
        const p = secretEntryTurnsParams(env);
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
