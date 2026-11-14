import type { Action, Ctx, Decision, HexId, Piece, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, statics } from '../common/pieces';
import { setTags } from './status';

/*
 * An entry stretch the entering side picks for its whole force (LMA2: "Elements of Easy Company enter by the East
 * edge, either between hexrows I and Q inclusive or between Q and Y inclusive"). A general rule: the side picks one
 * of the card's stretches of the edge once every side has set up, before its forces enter; every unit of the listed
 * forces then enters through that stretch only. The pick is open (the card does not make it secret) and logged.
 *
 * A card that ties the choice to the entry itself ("Enter on Turn 3 on any one west edge hex ≥ 5 hexes from Z0") gives
 * no reason to commit before play: `when: 'entry'` asks in the RPh of the turn the forces are due, before they are set
 * up offboard (SK1 RPh step a), so the side picks with the board as it stands then.
 */

export const ENTRY_STRETCH_MODULE = 'entry-stretch';
export const ENTRY_STRETCH_DECISION = 'entryStretch';
const EXT = 'ssr.entryStretch';

export interface EntryStretchOption {
  /** The card's words for the stretch, e.g. 'between hexrows I and Q inclusive'. */
  label: string;
  /** The map hexes along the edge the units may enter by. */
  hexes: HexId[];
}

export interface EntryStretchParams {
  side: SideId;
  /** Ids of the forces that enter through the chosen stretch (all of them through the same one). */
  forces: string[];
  options: EntryStretchOption[];
  /** The card's name for the provision, e.g. 'Setup'. */
  rule?: string;
  /** When the side picks: once every side has set up (the default), or in the RPh of the forces' entry turn. */
  when?: 'setup' | 'entry';
}

export interface EntryStretchState {
  side: SideId;
  option: number;
}

export type EntryStretchAction = Action & { option: number };

export function entryStretchParams(env: QueryEnv): EntryStretchParams | null {
  const s = statics(env).scenario.ssr.find((r) => r.module === ENTRY_STRETCH_MODULE);
  return s ? (s.params as unknown as EntryStretchParams) : null;
}

/** The stretch chosen, once it is. */
export const entryStretchState = (env: QueryEnv): EntryStretchState | null => (env.state.ext[EXT] as EntryStretchState | undefined) ?? null;

/** The listed forces' units still waiting offboard, not yet set up along the edge. */
function stretchForces(env: QueryEnv, p: EntryStretchParams): Piece[] {
  const forces = statics(env).scenario.forces;
  return Object.values(env.state.pieces)
    .filter((q) => {
      const force = forces[q.tags['force'] as number]?.id;
      return q.side === p.side && !!force && p.forces.includes(force) && q.loc.kind === 'offboard' && !q.loc.hex;
    })
    .sort(byId);
}

/** Why a pick is illegal, or null. */
export function entryStretchIllegal(env: QueryEnv, side: SideId, option: number): string | null {
  const p = entryStretchParams(env);
  if (!p || p.side !== side) return 'This side does not choose an entry stretch';
  if (entryStretchState(env)) return 'The entry stretch is already chosen';
  if (!Number.isInteger(option) || !p.options[option]) return 'Choose one of the card’s entry stretches';
  return null;
}

export const entryStretchModule: RuleModule = {
  id: 'ssr.entry-stretch',
  ref: 'LMA2',
  summary: 'An entering force comes on through one of the card’s stretches of its edge, picked by its side before entry.',
  requires: ['sk1.scenario'],
  install(r) {
    r.event<EntryStretchState & { label: string }>({
      type: 'ssr.entryStretch',
      apply(d, p) {
        d.ext[EXT] = { side: p.side, option: p.option } satisfies EntryStretchState;
      },
    });

    // Asked once every side has set up (below the scenario's own setup decisions, priority 0), before the turn
    // sequence starts: the entering side sees the defence it will enter against, as at the table.
    r.setup({
      id: 'ssr.entry-stretch.ask',
      priority: -5,
      run(ctx) {
        const p = entryStretchParams(ctx);
        if (p && p.when !== 'entry') ctx.pushDecision({ kind: ENTRY_STRETCH_DECISION, owner: p.side, deadlineClass: 'turn', data: {} });
      },
    });

    // `when: 'entry'`: asked as the RPh of the forces' entry turn starts. Registered after the scenario's offboard setup
    // handler, so this decision sits on top of that one and the stretch is known before the units are placed offboard.
    r.on<{ phase: string }>({
      id: 'ssr.entry-stretch.ask-at-entry',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        const p = entryStretchParams(ctx);
        if (ev.payload.phase !== 'RPh' || p?.when !== 'entry' || ctx.state.attacker !== p.side || entryStretchState(ctx)) return;
        if (!stretchForces(ctx, p).some((q) => q.tags['entryTurn'] === ctx.state.turn)) return;
        ctx.pushDecision({ kind: ENTRY_STRETCH_DECISION, owner: p.side, deadlineClass: 'turn', data: {} });
      },
    });

    r.action<EntryStretchAction>({
      type: 'entryStretch.choose',
      decisionKinds: [ENTRY_STRETCH_DECISION],
      legal: (env) => (entryStretchParams(env)?.options ?? []).map((_, option) => ({ type: 'entryStretch.choose', option })),
      validate: (env, a, d) => entryStretchIllegal(env, d.owner, a.option),
      resolve(ctx, a, d: Decision) {
        const p = entryStretchParams(ctx)!;
        const opt = p.options[a.option]!;
        ctx.emit('ssr.entryStretch', { side: d.owner, option: a.option, label: opt.label });
        for (const piece of stretchForces(ctx, p)) setTags(ctx, piece.id, { entryHexes: opt.hexes.join(',') });
        ctx.popDecision(d.id);
        if (p.when !== 'entry' && ctx.state.decisions.length === 0) ctx.proc<(c: Ctx) => void>('sk1.scenario.begin')(ctx);
      },
    });
  },
};
