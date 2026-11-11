import type { Ctx, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { byId, statics } from '../common/pieces';
import { setTags } from './status';

/*
 * Reinforcements whose entry turn an event of play sets (LMA4 SSR 4: "German reinforcements enter by the South
 * edge on the turn following the first German fire attack"). The force is listed as entering with `turn: 0` (not
 * due on any turn); the first fire attack made by a unit of `firedBy` (an IFT attack, an ordnance shot, one with no
 * LOS included: it has still been fired, ASLRB A6.11) fixes its entry on the next Game Turn, with a log line.
 */

export const ENTRY_AFTER_FIRE_MODULE = 'entry-after-fire';
const EXT = 'ssr.entryAfterFire';

export interface EntryAfterFireParams {
  /** Id of the force that waits. */
  force: string;
  /** The side whose first fire attack sets the turn. */
  firedBy: SideId;
  /** Game Turns after the one of that attack (default 1: "the turn following"). */
  turnsAfter?: number;
  /** The card's name for the rule, e.g. 'SSR 4'. */
  rule?: string;
}

export interface EntryAfterFireState {
  /** The Game Turn the force enters on. */
  turn: number;
  /** The Game Turn of the first fire attack. */
  firedOn: number;
  /** The piece whose attack it was. */
  firer: PieceId;
}

export function entryAfterFireParams(env: QueryEnv): EntryAfterFireParams | null {
  const s = statics(env).scenario.ssr.find((r) => r.module === ENTRY_AFTER_FIRE_MODULE);
  return s ? (s.params as unknown as EntryAfterFireParams) : null;
}

/** The entry turn once the triggering attack has been made, else null. */
export const entryAfterFireState = (env: QueryEnv): EntryAfterFireState | null => (env.state.ext[EXT] as EntryAfterFireState | undefined) ?? null;

export const entryAfterFireModule: RuleModule = {
  id: 'ssr.entry-after-fire',
  ref: 'LMA4 SSR 4',
  summary: 'Reinforcements enter on the turn after the first fire attack by a side (SSR).',
  requires: ['sk1.scenario', 'sk1.fire'],
  install(r) {
    r.event<EntryAfterFireState & { force: string; side: SideId }>({
      type: 'ssr.entryAfterFire',
      apply(d, p) {
        d.ext[EXT] = { turn: p.turn, firedOn: p.firedOn, firer: p.firer };
      },
    });

    const fired = (ctx: Ctx, firer: PieceId | undefined) => {
      const p = entryAfterFireParams(ctx);
      if (!p || !firer || entryAfterFireState(ctx) || ctx.state.phase === 'setup') return;
      const piece = ctx.state.pieces[firer];
      const holder = piece?.loc.kind === 'held' ? ctx.state.pieces[piece.loc.by] : piece;
      if (!holder || holder.side !== p.firedBy) return;
      const forces = statics(ctx).scenario.forces;
      const fi = forces.findIndex((f) => f.id === p.force);
      const force = forces[fi];
      if (!force) return;
      const turn = ctx.state.turn + (p.turnsAfter ?? 1);
      ctx.emit('ssr.entryAfterFire', { force: p.force, side: force.side, turn, firedOn: ctx.state.turn, firer: holder.id });
      for (const w of Object.values(ctx.state.pieces).sort(byId)) {
        if (w.tags['force'] !== fi || w.loc.kind !== 'offboard' || w.loc.hex || w.loc.edge === 'exited') continue;
        setTags(ctx, w.id, { entryTurn: turn });
      }
    };
    for (const event of ['sk1.fire.attack', 'sk1.fire.noLos'])
      r.on<{ attack: { parts: PieceId[] } }>({
        id: `ssr.entry-after-fire.${event === 'sk1.fire.attack' ? 'attack' : 'noLos'}`,
        event,
        handler: (ctx, ev) => fired(ctx, [...ev.payload.attack.parts].sort()[0]),
      });
    for (const event of ['sk2.ordnance.shot', 'sk2.ordnance.noLos'])
      r.on<{ weapon: PieceId }>({
        id: `ssr.entry-after-fire.${event === 'sk2.ordnance.shot' ? 'shot' : 'shot-noLos'}`,
        event,
        handler: (ctx, ev) => fired(ctx, ev.payload.weapon),
      });
  },
};
