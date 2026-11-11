import type { Ctx, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, statics } from '../common/pieces';
import { setTags } from './status';

/*
 * Reinforcement groups whose entry turns a dr decides (LMA6 SSR 1: "On turn 1, during his RPh, the French player
 * rolls a dr: on 1-4 Group A enters on turn 1 and Group B on turn 2; on 5-6 the reverse"). A general rule: in the
 * side's Rally Phase of `turn`, before the offboard setup of the reinforcements due, the side rolls a dr and each
 * outcome row gives every listed force its entry turn. The forces keep the edge and hexes the card gives them; until
 * the roll they carry the turns of their ScenarioDef entry (a placeholder, the briefing says "see SSR").
 */

export const ENTRY_ORDER_DR_MODULE = 'entry-order-dr';
const EXT = 'ssr.entryOrderDr';

export interface EntryOrderDrParams {
  side: SideId;
  /** The side's Player Turn whose RPh the dr is made in (default 1). */
  turn?: number;
  /** The card's name for the rule, e.g. 'SSR 1'. */
  rule?: string;
  /** dr ranges (inclusive) and the entry turn each one gives each force (by force id). */
  outcomes: { dr: [number, number]; turns: Record<string, number> }[];
}

export interface EntryOrderDrEvent {
  side: SideId;
  dr: number;
  turns: Record<string, number>;
  rule: string;
}

export function entryOrderDrParams(env: QueryEnv): EntryOrderDrParams | null {
  const s = statics(env).scenario.ssr.find((r) => r.module === ENTRY_ORDER_DR_MODULE);
  return s ? (s.params as unknown as EntryOrderDrParams) : null;
}

/** The roll made and the turns it gave, once it is made. */
export const entryOrderDrResult = (env: QueryEnv): EntryOrderDrEvent | null => (env.state.ext[EXT] as EntryOrderDrEvent | undefined) ?? null;

/** Forces whose entry turn the dr has still to decide (empty once rolled or without the rule). */
export function entryOrderDrPending(env: QueryEnv): string[] {
  const p = entryOrderDrParams(env);
  if (!p || entryOrderDrResult(env)) return [];
  return [...new Set(p.outcomes.flatMap((o) => Object.keys(o.turns)))];
}

/** The outcomes in words: "dr 1–4: Group A Turn 1, Group B Turn 2 · dr 5–6: ...". */
export function entryOrderLabel(env: QueryEnv, p: EntryOrderDrParams): string {
  const forces = statics(env).scenario.forces;
  const name = (id: string) => forces.find((f) => f.id === id)?.group ?? id;
  return p.outcomes
    .map((o) => `dr ${o.dr[0] === o.dr[1] ? o.dr[0] : `${o.dr[0]}–${o.dr[1]}`}: ${Object.entries(o.turns).map(([f, t]) => `${name(f)} Turn ${t}`).join(', ')}`)
    .join(' · ');
}

export const entryOrderDrModule: RuleModule = {
  id: 'ssr.entry-order-dr',
  ref: 'LMA6 SSR 1',
  summary: 'Reinforcement groups whose entry turns a dr decides in the Rally Phase (SSR).',
  requires: ['sk1.scenario'],
  install(r) {
    r.event<EntryOrderDrEvent>({
      type: 'ssr.entryOrderDr',
      apply(d, p) {
        d.ext[EXT] = p;
      },
    });
    // In the RPh, before the reinforcements due are set up offboard (sk1.scenario.offboard-setup, priority 0).
    r.on<{ phase: string }>({
      id: 'ssr.entry-order-dr.roll',
      event: 'turn.phaseStarted',
      priority: -2,
      handler(ctx: Ctx, ev) {
        if (ev.payload.phase !== 'RPh') return;
        const p = entryOrderDrParams(ctx);
        if (!p || p.side !== ctx.state.attacker || ctx.state.turn !== (p.turn ?? 1) || entryOrderDrResult(ctx)) return;
        const rule = p.rule ?? 'SSR';
        const dr = ctx.roll(`${rule}: order of entry (${entryOrderLabel(ctx, p)})`, 1).dice[0]!;
        const row = p.outcomes.find((o) => dr >= o.dr[0] && dr <= o.dr[1]);
        const turns = row?.turns ?? {};
        ctx.emit('ssr.entryOrderDr', { side: p.side, dr, turns, rule });
        const forces = statics(ctx).scenario.forces;
        for (const piece of Object.values(ctx.state.pieces).sort(byId)) {
          const force = forces[piece.tags['force'] as number]?.id;
          if (piece.side === p.side && force && turns[force] !== undefined && piece.loc.kind === 'offboard' && !piece.loc.hex) setTags(ctx, piece.id, { entryTurn: turns[force]! });
        }
      },
    });
  },
};
