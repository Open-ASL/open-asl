import type { Action, Ctx, Decision, HexId, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, defOf, statics, swHeldBy } from '../common/pieces';
import { SETUP_PLACED, type SetupPlacedFn } from './scenario';
import { mmc, pieceOf, setTags } from './status';

/*
 * A game length a side records secretly before setup, which also sets the playing area and its order of battle (S36 SSR 1:
 * "Prior to setup, the Russian player secretly records if the game will be 4.5, 5.5, or 6.5 turns long and reveals this
 * after the German player has set up. The following table displays which boards are in play and which forces are
 * removed from the Russian OB based on the selected game length.").
 *
 * The map holds every board; the choice is revealed as the named side's setup ends. Then the game takes the option's
 * length (`game.turns`), hexes outside its area are out of play (`hex.inPlay`: no movement, advance or rout into them),
 * the listed counters leave the order of battle, and the listed forces enter along the option's edge (a staging edge of
 * the map for a playing area smaller than the map). The choice is hidden by the client until revealed; the shared
 * recording carries it.
 */

export const SECRET_LENGTH_MODULE = 'secret-length';
export const SECRET_LENGTH_DECISION = 'secretLength';
const EXT = 'ssr.length';

export interface SecretLengthOption {
  /** The card's name for it, e.g. '4.5'. */
  label: string;
  turns: number;
  halfFinalTurn: boolean;
  /** Hexes in play (every map hex when absent), and the card's words for them. */
  area?: HexId[];
  boards: string;
  /** Counters that leave the order of battle (a SW is taken from whoever holds it). */
  remove?: { force: string; def: string; count: number }[];
  /**
   * Forces that enter along another edge, as the card's edge does for this area: a staging edge of the map named `edge`
   * along `hexes` (the area's edge hexes), its offboard hexes on the board-relative side `beyond`.
   */
  entry?: { forces: string[]; edge: string; hexes: HexId[]; beyond: 'N' | 'E' | 'S' | 'W' };
}

export interface SecretLengthParams {
  side: SideId;
  /** The choice is revealed once this side has set up. */
  revealAfterSetupOf: SideId;
  options: SecretLengthOption[];
  rule?: string;
}

export interface SecretLengthState {
  option: number;
  revealed: boolean;
}

export function secretLengthParams(env: QueryEnv): SecretLengthParams | null {
  const s = statics(env).scenario.ssr.find((r) => r.module === SECRET_LENGTH_MODULE);
  return s ? (s.params as unknown as SecretLengthParams) : null;
}

export const secretLengthState = (env: QueryEnv): SecretLengthState | null => (env.state.ext[EXT] as SecretLengthState | undefined) ?? null;

/** The option in force once revealed. */
export function revealedLength(env: QueryEnv): SecretLengthOption | null {
  const st = secretLengthState(env);
  const p = secretLengthParams(env);
  return st?.revealed && p ? (p.options[st.option] ?? null) : null;
}

export const secretLengthModule: RuleModule = {
  id: 'ssr.secret-length',
  ref: 'S36 SSR 1',
  summary: 'A game length recorded secretly before setup, setting the turns, the boards in play and the order of battle (SSR).',
  requires: ['sk1.scenario', 'sk1.terrain', 'common.turn'],
  install(r) {
    r.event<{ side: SideId; option: number }>({
      type: 'ssr.length.recorded',
      apply(d, p) {
        d.ext[EXT] = { option: p.option, revealed: false } satisfies SecretLengthState;
      },
    });
    // Until revealed, the other side sees only that a choice was made (its index is the secret).
    const shown = (st: SecretLengthState, viewer: SideId | null, side: SideId): SecretLengthState | { revealed: false } => (st.revealed || viewer === side ? st : { revealed: false });
    r.redact({
      id: 'ssr.length.redact',
      ext: EXT,
      redactExt: (slice, viewer, env) => shown(slice as SecretLengthState, viewer, secretLengthParams(env)?.side ?? ''),
      events: ['ssr.length.recorded'],
      redactEvent: (ev, viewer) => ((ev.payload as { side: SideId }).side === viewer ? ev : null),
    });
    r.event<{ side: SideId; option: number; label: string; removed: PieceId[] }>({
      type: 'ssr.length.revealed',
      apply(d, p) {
        d.ext[EXT] = { option: p.option, revealed: true } satisfies SecretLengthState;
      },
    });

    // "Prior to setup": asked before every other setup step.
    r.setup({
      id: 'ssr.secret-length.ask',
      priority: 40,
      run(ctx) {
        const p = secretLengthParams(ctx);
        if (p) ctx.pushDecision({ kind: SECRET_LENGTH_DECISION, owner: p.side, deadlineClass: 'turn', data: {} });
      },
    });
    r.action<Action & { type: 'length.choose'; option: number }>({
      type: 'length.choose',
      decisionKinds: [SECRET_LENGTH_DECISION],
      legal: (env) => (secretLengthParams(env)?.options ?? []).map((_, option) => ({ type: 'length.choose', option })),
      validate(env, a, d) {
        const p = secretLengthParams(env);
        if (!p || p.side !== d.owner) return 'This side does not choose the game length';
        if (!Number.isInteger(a.option) || !p.options[a.option]) return 'Choose one of the card’s game lengths';
        return null;
      },
      resolve(ctx, a, d: Decision) {
        ctx.emit('ssr.length.recorded', { side: d.owner, option: a.option });
        ctx.popDecision(d.id);
        if (ctx.state.decisions.length === 0) ctx.proc<(c: Ctx) => void>('sk1.scenario.begin')(ctx);
      },
    });

    // Revealed as the named side's setup is placed: the length, the area and the order of battle take effect.
    r.procedure<SetupPlacedFn>(SETUP_PLACED, (next) => (ctx, action, decision) => {
      next?.(ctx, action, decision);
      const p = secretLengthParams(ctx);
      const st = secretLengthState(ctx);
      if (!p || !st || st.revealed || decision.owner !== p.revealAfterSetupOf) return;
      const opt = p.options[st.option]!;
      const forces = statics(ctx).scenario.forces;
      const removed: PieceId[] = [];
      const live = () => Object.values(ctx.state.pieces).filter((x) => x.side === p.side && x.loc.kind !== 'eliminated' && !removed.includes(x.id)).sort(byId);
      for (const rm of opt.remove ?? []) {
        const fi = forces.findIndex((f) => f.id === rm.force);
        const fromForce = (x: { tags: Record<string, unknown>; loc: { kind: string; by?: string } }) =>
          x.tags['force'] === fi || (x.loc.kind === 'held' && ctx.state.pieces[x.loc.by!]?.tags['force'] === fi);
        // Units holding nothing go first, so their weapons stay with the force.
        const cands = live()
          .filter((x) => x.defId === rm.def && fromForce(x))
          .sort((a, b) => swHeldBy(ctx.state, a.id).length - swHeldBy(ctx.state, b.id).length);
        removed.push(...cands.slice(0, rm.count).map((x) => x.id));
      }
      ctx.emit('ssr.length.revealed', { side: p.side, option: st.option, label: opt.label, removed });
      const reason = `${p.rule ?? 'SSR'}: ${opt.label} turns`;
      for (const id of removed) {
        const held = swHeldBy(ctx.state, id).filter((x) => !removed.includes(x.id));
        // A vehicle's own weapons go with it; a weapon of a removed unit passes to a unit of its force that stays.
        if (defOf(ctx, pieceOf(ctx, id)).kind === 'vehicle') for (const w of held) ctx.emit('piece.eliminated', { id: w.id, reason });
        else
          for (const w of held) {
            const keeper = live().find((x) => x.tags['force'] === ctx.state.pieces[id]!.tags['force'] && !!mmc(ctx, x));
            if (keeper) ctx.emit('piece.moved', { id: w.id, loc: { kind: 'held', by: keeper.id } });
          }
        ctx.emit('piece.eliminated', { id, reason });
      }
      if (opt.entry) {
        const fis = opt.entry.forces.map((f) => forces.findIndex((x) => x.id === f));
        for (const x of live()) {
          if (!fis.includes(x.tags['force'] as number) || x.loc.kind !== 'offboard') continue;
          // The waiting counters' edge is the area's own (their offboard setup and entry hexes follow it).
          ctx.emit('piece.moved', { id: x.id, loc: { kind: 'offboard', edge: opt.entry.edge } });
          setTags(ctx, x.id, { entryEdge: opt.entry.edge, entryHexes: null });
        }
      }
    });

    r.contribute({
      id: 'ssr.secret-length.turns',
      query: 'game.turns',
      when: (_c, env) => !!revealedLength(env),
      apply: (_v, _c, env) => ({ turns: revealedLength(env)!.turns, halfFinalTurn: revealedLength(env)!.halfFinalTurn }),
    });
    const areaOf = (env: QueryEnv) => {
      const opt = revealedLength(env);
      if (!opt?.area) return null;
      const map = statics(env).map;
      return new Set(opt.area.map((h) => map.hex(h)?.id ?? h));
    };
    r.contribute({
      id: 'ssr.secret-length.in-play',
      query: 'hex.inPlay',
      apply: (v, { hex }, env) => {
        const area = areaOf(env);
        return area ? area.has(statics(env).map.hex(hex)?.id ?? hex) : v;
      },
    });
    // Nothing moves, routs or advances into a hex out of play.
    r.contribute({
      id: 'ssr.secret-length.out-of-play-cost',
      query: 'move.cost',
      layer: 900,
      label: 'not in play (SSR)',
      when: ({ to }, env) => !!statics(env).map.hex(to) && !!areaOf(env) && !areaOf(env)!.has(statics(env).map.hex(to)!.id),
      apply: () => Infinity,
    });
  },
};
