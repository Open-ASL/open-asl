import type { HexId, Piece, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { byId } from '../common/pieces';
import { locOf } from '../common/location';
import { MOVE_FINISH, moveState, type MoveFinishFn } from '../sk1/movement';
import { isCx, pieceOf, setTags } from '../sk1/status';
import { shownCounter } from './fortifications';
import { laborLoc, laborTag, parseLabor } from './labor';
import { roadblockBetween } from './roadblocks';

/*
 * Full ASL Manhandling beyond the Starter Kit's (ASLRB C10.3, B24.8, A4.51; SK4 6.5 has no Labor, TI or CX penalty):
 * - Labor (B24.8, C10.3): "If the Final Manhandling DR is > the M# ... the pushing unit(s) receives a -1 Labor counter for
 *   use in its next attempt"; a second failure of the same DR flips it to -2. The Task is pushing that Gun out of its
 *   Location: the counter goes on every unit of the failed attempt and on the Gun (Q&A [Hadady to Cocke, ASLML 2000] to
 *   C6.43, C6.5, C10.3 & C11.3), key `manhandle:<Location>`; the next attempt from that Location takes the best Labor
 *   among its pushers "even if joined by new units" (B24.8), provided the Gun is the one that earned it; it stays until
 *   the Task is achieved (the push leaves the Location) or the units leave the Location (`asl.labor.left`). A Labor of
 *   another Task (Entrenching, Clearance) gives nothing to a push.
 * - TI (C10.3, A4.8): "In all three cases, the Gun and its pushing Infantry become TI for the rest of that Player Turn when
 *   their pushing/hooking up has ended": every unit of a stack that made a Manhandling DR, and the Gun, when its move ends;
 *   the helpers too (the DRM row: "such units also become TI").
 * - The DRM (C10.3 MANHANDLING DRM): "+X is positive TEM of hexside crossed plus that of hex entered" (a known roadblock
 *   hexside: +2, its wall TEM, B29.3; Q&A [Gen24.2; An95w; An96] to C10.3: none through a road gap, and a roadblock fills
 *   its road), "-1 or -2 Per Labor Status (B24.8)", and +1 for a CX pusher (A4.51 "any labor task"; Q&A [K33] to A4.51 &
 *   C10.3).
 * Not here: the chart's "-1 if only pushing MMC is squad" and "-2 Low Ammo" rows and +3 for mud or deep snow.
 */

const TASK = 'manhandle';
const taskOf = (loc: string) => `${TASK}:${loc}`;
/** The Labor DRM `p` holds for pushing out of Location `loc` (0 when none). */
const laborFor = (p: Piece | undefined, loc: string): number => {
  const l = p ? parseLabor(p.tags['labor']) : null;
  return l && l.task === taskOf(loc) ? l.drm : 0;
};

/** The Manhandling Labor DRM of a push by `units` of `gun` out of `from` (B24.8): the best among the pushers, when the Gun earned it there. */
export function manhandleLabor(env: QueryEnv, gun: PieceId, units: PieceId[], from: HexId): number {
  const loc = locOf(env.state, pieceOf(env, units[0]!)) ?? from;
  if (laborFor(env.state.pieces[gun], loc) === 0) return 0;
  return Math.min(0, ...units.map((u) => laborFor(env.state.pieces[u], loc)));
}

export const aslManhandleModule: RuleModule = {
  id: 'asl.manhandle',
  ref: 'ASLRB C10.3, B24.8, A4.51, A4.8',
  summary: 'Manhandling in full ASL: Labor after a failed push, TI for the Gun and its pushers, CX +1 and a roadblock hexside +2 on the Manhandling DR.',
  requires: ['asl.labor', 'asl.roadblocks', 'sk1.movement'],
  install(r) {
    r.contribute({
      id: 'asl.manhandle.labor',
      query: 'manhandle.drm',
      ref: 'ASLRB B24.8, C10.3',
      label: ({ gun, units, from }, env) => `${manhandleLabor(env, gun, units, from)} Labor (ASLRB B24.8)`,
      when: ({ gun, units, from }, env) => manhandleLabor(env, gun, units, from) < 0,
      apply: (v, { gun, units, from }, env) => v + manhandleLabor(env, gun, units, from),
    });
    r.contribute({
      id: 'asl.manhandle.cx',
      query: 'manhandle.drm',
      ref: 'ASLRB A4.51',
      label: '+1 CX (ASLRB A4.51)',
      when: ({ units }, env) => units.some((u) => isCx(pieceOf(env, u))),
      apply: (v) => v + 1,
    });
    r.contribute({
      id: 'asl.manhandle.hexside',
      query: 'manhandle.drm',
      ref: 'ASLRB C10.3, B29.3',
      label: '+2 roadblock hexside crossed (ASLRB C10.3)',
      when: ({ from, to }, env) => {
        const c = roadblockBetween(env, from, to);
        return !!c && !!shownCounter(c, env.state.attacker);
      },
      apply: (v) => v + 2,
    });

    // A failed push: Labor on every unit of the attempt and on the Gun, -1, or -2 when it had failed there before.
    r.on<{ gun: PieceId; units: PieceId[]; from: HexId; outcome: 'moved' | 'stopped' | 'failed' }>({
      id: 'asl.manhandle.failed',
      event: 'sk2.gun.manhandle',
      handler(ctx, ev) {
        const { gun, units, outcome } = ev.payload;
        const g = ctx.state.pieces[gun];
        if (!g) return;
        if (outcome !== 'failed') {
          // The Task is achieved: the Gun leaves the Location (its pushers' Labor goes as they leave it, `asl.labor.left`).
          if (parseLabor(g.tags['labor'])?.task.startsWith(`${TASK}:`)) setTags(ctx, gun, { labor: null });
          return;
        }
        const loc = locOf(ctx.state, pieceOf(ctx, units[0]!));
        if (!loc) return;
        const before = Math.min(laborFor(g, loc), ...units.map((u) => laborFor(ctx.state.pieces[u], loc)));
        const drm = before < 0 ? -2 : -1;
        for (const id of [...units, gun].sort()) if (ctx.state.pieces[id]) setTags(ctx, id, { labor: laborTag(taskOf(loc), drm) });
      },
    });
    // A Gun's Labor goes when no unit holding it is in the Location of its Task any more (B24.8).
    r.on<{ id: PieceId }>({
      id: 'asl.manhandle.gunLeft',
      event: 'piece.moved',
      handler(ctx) {
        for (const g of Object.values(ctx.state.pieces).sort(byId)) {
          const l = parseLabor(g.tags['labor']);
          if (!l || !l.task.startsWith(`${TASK}:`) || g.loc.kind !== 'held') continue;
          if (locOf(ctx.state, g) !== laborLoc(l.task)) setTags(ctx, g.id, { labor: null });
        }
      },
    });

    // TI once the pushing has ended: the stack's move is over and it made at least one Manhandling DR.
    r.procedure<MoveFinishFn>(MOVE_FINISH, (next) => (ctx) => {
      const ms = moveState(ctx);
      const pushed = !!ms?.manhandle && (ms.hexesEntered > 0 || ms.manhandle.mustStop);
      const ids = pushed ? [...ms!.units, ms!.manhandle!.gun] : [];
      next?.(ctx);
      for (const id of ids.sort()) {
        const p = ctx.state.pieces[id];
        if (p && p.loc.kind !== 'eliminated' && p.tags['ti'] !== true) setTags(ctx, id, { ti: true });
      }
      if (ids.length) ctx.emit('asl.manhandle.ti', { units: ids.filter((id) => ctx.state.pieces[id]?.tags['ti'] === true) });
    });
    r.event<{ units: PieceId[] }>({ type: 'asl.manhandle.ti', apply() {} });
  },
};
