import type { Ctx, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, statics } from '../common/pieces';

/*
 * Losses a group has suffered before it arrives, rolled as it enters (LMA6 SSR 2: "To represent the losses of the
 * day's fighting, as each French group arrives a dr is made and divided by 2 (fractions rounded up): the number of
 * 4-5-8s that become 4-5-7s"). A general rule: in the side's Rally Phase of the Player Turn a listed force is due to
 * enter, before its offboard setup, the side rolls a dr per force; dr ÷ `divisor`, rounded up (or down), of the
 * force's `from` counters are replaced by `to` counters (never more than the force has).
 */

export const ENTRY_LOSSES_MODULE = 'entry-losses';
const EXT = 'ssr.entryLosses';

export interface EntryLossesParams {
  side: SideId;
  /** Ids of the forces that roll as they enter (a balance option may narrow the list). */
  forces: string[];
  /** The counter replaced, e.g. 'br.458', and its replacement, e.g. 'br.457'. */
  from: string;
  to: string;
  /** The dr is divided by this (default 2) ... */
  divisor?: number;
  /** ... and rounded up (the card's "FRU", the default) or down. */
  round?: 'up' | 'down';
  /** The card's name for the rule, e.g. 'SSR 2'. */
  rule?: string;
}

export interface EntryLossesEvent {
  side: SideId;
  force: string;
  dr: number;
  count: number;
  from: string;
  to: string;
  rule: string;
  pieces: PieceId[];
}

export function entryLossesParams(env: QueryEnv): EntryLossesParams | null {
  const s = statics(env).scenario.ssr.find((r) => r.module === ENTRY_LOSSES_MODULE);
  return s ? (s.params as unknown as EntryLossesParams) : null;
}

/** The forces already rolled for. */
export const entryLossesRolled = (env: QueryEnv): string[] => (env.state.ext[EXT] as string[] | undefined) ?? [];

/** How many counters a dr replaces. */
export function entryLossesCount(p: Pick<EntryLossesParams, 'divisor' | 'round'>, dr: number): number {
  const q = dr / (p.divisor ?? 2);
  return p.round === 'down' ? Math.floor(q) : Math.ceil(q);
}

export const entryLossesModule: RuleModule = {
  id: 'ssr.entry-losses',
  ref: 'LMA6 SSR 2',
  summary: 'A dr as a group enters replaces some of its counters with lesser ones (losses before arrival, SSR).',
  requires: ['sk1.scenario'],
  install(r) {
    r.event<EntryLossesEvent>({
      type: 'ssr.entryLosses',
      apply(d, p) {
        d.ext[EXT] = [...((d.ext[EXT] as string[] | undefined) ?? []), p.force];
      },
    });
    // In the RPh the group enters, after any entry-order dr (priority -2) and before its offboard setup (priority 0).
    r.on<{ phase: string }>({
      id: 'ssr.entry-losses.roll',
      event: 'turn.phaseStarted',
      priority: -1,
      handler(ctx: Ctx, ev) {
        if (ev.payload.phase !== 'RPh') return;
        const p = entryLossesParams(ctx);
        if (!p || p.side !== ctx.state.attacker) return;
        const forces = statics(ctx).scenario.forces;
        const rule = p.rule ?? 'SSR';
        for (const id of p.forces) {
          if (entryLossesRolled(ctx).includes(id)) continue;
          const fi = forces.findIndex((f) => f.id === id);
          const due = Object.values(ctx.state.pieces)
            .filter((x) => x.side === p.side && x.tags['force'] === fi && x.loc.kind === 'offboard' && !x.loc.hex && x.tags['entryTurn'] === ctx.state.turn)
            .sort(byId);
          if (due.length === 0) continue;
          const name = forces[fi]?.group ?? id;
          const dr = ctx.roll(`${rule}: ${name} losses (dr ÷ ${p.divisor ?? 2}, ${p.round === 'down' ? 'FRD' : 'FRU'})`, 1).dice[0]!;
          const candidates = due.filter((x) => x.defId === p.from);
          const pieces = candidates.slice(0, Math.min(candidates.length, entryLossesCount(p, dr))).map((x) => x.id);
          ctx.emit('ssr.entryLosses', { side: p.side, force: id, dr, count: pieces.length, from: p.from, to: p.to, rule, pieces });
          for (const piece of pieces) ctx.emit('piece.replaced', { id: piece, defId: p.to, from: p.from, reason: 'ssr' });
        }
      },
    });
  },
};
